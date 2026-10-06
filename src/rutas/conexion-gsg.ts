/**
 * La conexión con el sistema de GSG, configurable desde la pantalla.
 *
 * Antes la dirección y el token de GSG solo vivían en el `.env` (GSG_URL,
 * GSG_TOKEN) y cambiarlos obligaba a reiniciar. Ahora viven en `settings`
 * (`gsg.conexion` en claro: URL base + ruta de la ubicación; `gsg.apiKey`
 * cifrado: la API Key que da GSG) y se cambian desde Conexión; el `.env`
 * (GSG_URL, GSG_LOCATION_PATH, GSG_API_KEY) es el valor inicial.
 *
 * Esta es la conexión SALIENTE (GSGchat → GSG): la clave la genera GSG y se
 * guarda aquí. La entrante (GSG → GSGchat) usa otra clave, la que genera
 * GSGchat y se copia al .env de GSG.
 *
 * Compatibilidad (temporal): se sigue leyendo `GSG_TOKEN` (.env) y
 * `gsg.token` (settings, cifrado) si no hay API Key nueva, y la URL completa
 * de ubicación antigua (`urlUbicacion` guardada o GSG_SEND_LOCATION_URL) se
 * convierte a URL base + ruta solo si es inequívoco (ver
 * `migrarUbicacionAntigua` en gsg.ts). Si no lo es, la conexión queda con
 * un error a la vista y no se envía nada hasta corregirla.
 *
 * Tres formas de estar:
 *  - **Sin conexión**: lo reportable se encola y espera. Es como nació el
 *    sistema, porque GSG no tenía API.
 *  - **Con la API real de GSG**: dirección + token.
 *  - **Con el simulador**: el propio servidor levanta una copia de mentira
 *    del sistema de GSG (ver src/entregas/gsg-simulado.ts) con sus listas
 *    de quién falta ubicación, quién falta confirmar y quién ya terminó. Es
 *    para probar el flujo entero con números ficticios sin tocar a nadie.
 *
 * El puerto que ve el resto del sistema (`puerto()`) es siempre el mismo
 * objeto: apunta a lo vigente en cada llamada. Nada se reinicia al cambiar.
 */

import { z } from 'zod';
import type { SettingsRepo } from '../settings/service.js';
import { decrypt, encrypt, keyFromBase64 } from '../settings/crypto.js';
import { crearPuertoEnEspera, crearPuertoHttp, enmascararClave, migrarUbicacionAntigua, normalizarBaseGsg, RUTA_GSG_PENDIENTES, RUTA_UBICACION_POR_DEFECTO, unirUrlGsg, type PuertoGsg, type ResultadoConsulta, type ResultadoEnvio } from './gsg.js';
import { crearGsgExtras, type ServicioGsgExtras } from './gsg-extras.js';

const CLAVE_CONEXION = 'gsg.conexion';
/** La API Key de GSG (cifrada). */
const CLAVE_API_KEY = 'gsg.apiKey';
/** Donde se guardaba antes (cifrada): se lee si no hay `gsg.apiKey`. */
const CLAVE_TOKEN_ANTIGUA = 'gsg.token';

/** El token con el que este servidor habla con su propio simulador. */
export const TOKEN_SIMULADOR = 'simulador-gsg-local';
/** Donde se monta el simulador dentro de este mismo servidor. */
export const RUTA_SIMULADOR = '/simulador/gsg';

const conexionSchema = z.object({
  /** real = la API de GSG; simulador = la copia de mentira de este servidor; ninguna = solo encolar. */
  modo: z.enum(['ninguna', 'real', 'simulador']).default('ninguna'),
  /** La URL base de la API de GSG (p. ej. https://backend.gsg.pe/api). */
  url: z.string().trim().max(300).default(''),
  /** La ruta, relativa a la base, a la que se hace POST con la ubicacion (p. ej. v1/gsgchat/location). */
  rutaUbicacion: z.string().trim().max(300).default(''),
  /**
   * ANTIGUA: la URL completa de la ubicacion. Solo se lee para convertirla a
   * base + ruta (ver recargar); al guardar de nuevo se vacia.
   */
  urlUbicacion: z.string().trim().max(300).default(''),
  conectadoEn: z.string().nullable().default(null),
});
type ConexionGuardada = z.infer<typeof conexionSchema>;

export interface PruebaGsg {
  ok: boolean;
  detalle: string;
  /** Cuantos pendientes devolvio, si contesto. */
  faltaUbicacion?: number;
  faltaConfirmacion?: number;
  terminados?: number;
  at: string;
}

export interface EstadoConexionGsg {
  modo: 'ninguna' | 'real' | 'simulador';
  /** La URL base de GSG. */
  url: string;
  /** La ruta de la ubicacion, relativa a la base. */
  rutaUbicacion: string;
  /** La URL completa antigua, si sigue guardada sin poder convertirse ('' = ninguna). */
  urlUbicacion: string;
  /** A donde sale de verdad la ubicacion (base + ruta), o null si no hay o la configuracion no vale. */
  destinoUbicacion: string | null;
  tieneToken: boolean;
  /** La API Key de GSG enmascarada (solo los ultimos 4). Nunca la clave entera. */
  claveEnmascarada: string | null;
  /** De donde sale la clave: la pantalla, el .env o donde se guardaba antes. */
  origenClave: 'pantalla' | 'pantalla_antigua' | 'env' | 'env_antigua' | null;
  /** Por que la configuracion no vale (no se envia nada mientras), o null. */
  errorConfiguracion: string | null;
  /** true = hay a donde mandar y de donde traer. */
  conectada: boolean;
  /** De donde salio lo vigente. */
  origen: 'pantalla' | 'env' | 'ninguna';
  descripcion: string;
  conectadoEn: string | null;
  ultimaPrueba: PruebaGsg | null;
  /** Algo a revisar antes de producción, en palabras (API real sin https). null = nada. */
  aviso?: string | null;
}

export interface ServicioConexionGsg {
  estado(): EstadoConexionGsg;
  /** El puerto para el resto del sistema: siempre el mismo objeto, apunta a lo vigente. */
  puerto(): PuertoGsg;
  /**
   * Conecta con la API real: URL base + ruta de la ubicacion + API Key de
   * GSG (`apiKey`, o `token` por compatibilidad). Sin clave conserva la que
   * había; sin ruta conserva la guardada (o `sendLocation`). `urlUbicacion`
   * (la URL completa antigua) se acepta solo si se convierte sin adivinar.
   */
  conectarReal(input: { url: string; token?: string | null; apiKey?: string | null; rutaUbicacion?: string | null; urlUbicacion?: string | null }): Promise<EstadoConexionGsg>;
  /** Apunta al simulador de este servidor. */
  usarSimulador(): Promise<EstadoConexionGsg>;
  /** Quita la conexión de la pantalla; si el `.env` tenía una, vuelve a mandar esa. */
  quitar(): Promise<EstadoConexionGsg>;
  /** Pide los pendientes a lo vigente (o a lo que se le pase, sin guardar) y dice qué contestó. */
  probar(candidata?: { url: string; token: string; rutaUbicacion?: string | null }): Promise<PruebaGsg>;
  recargar(): Promise<void>;
  /**
   * Quien quiera ver lo que GSG contesta en /reparto/pendientes (por ejemplo,
   * para apuntar los pedidos que no se pueden usar). Se llama tras cada consulta
   * buena; un fallo del observador no rompe la consulta.
   */
  observar(fn: (cuerpo: unknown) => void | Promise<void>): () => void;
  /** Lo que rodea a la conexión: descartes, verificador del contrato, tokens del simulador, bitácora y cuadre. */
  extras: ServicioGsgExtras;
}

let vigenteCreada: ServicioConexionGsg | null = null;

/**
 * La última conexión creada en este proceso. Sirve para colgar rutas desde
 * sitios que no reciben la conexión por sus deps (ver src/rutas/gsg-extras-routes.ts).
 */
export function conexionGsgVigente(): ServicioConexionGsg | null {
  return vigenteCreada;
}

export interface DepsConexionGsg {
  settingsRepo: SettingsRepo;
  settingsKeyBase64: string;
  config: { GSG_SEND_LOCATION_URL?: string; GSG_LOCATION_PATH?: string; GSG_API_KEY?: string; GSG_URL: string; GSG_TOKEN: string; PUBLIC_BASE_URL: string; timezone?: string };
  fetchImpl?: typeof fetch;
  log?: (m: string, d?: Record<string, unknown>) => void;
  ahora?: () => Date;
}

export interface PendientesGsg {
  faltaUbicacion?: unknown[];
  faltaConfirmacion?: unknown[];
  terminados?: unknown[];
}

export async function crearConexionGsg(deps: DepsConexionGsg): Promise<ServicioConexionGsg> {
  const key = keyFromBase64(deps.settingsKeyBase64);
  const log = deps.log ?? (() => undefined);

  let guardada: ConexionGuardada = conexionSchema.parse({});
  /** La API Key de GSG guardada en la pantalla, y de donde salio (la nueva o la antigua `gsg.token`). */
  let token = '';
  let tokenAntiguo = false;
  let ultimaPrueba: PruebaGsg | null = null;
  let vigente: { firma: string; puerto: PuertoGsg } | null = null;

  const urlSimulador = () => `${deps.config.PUBLIC_BASE_URL.replace(/\/+$/, '')}${RUTA_SIMULADOR}`;

  interface Efectiva {
    modo: EstadoConexionGsg['modo'];
    url: string;
    rutaUbicacion: string;
    /** La URL completa antigua, solo si no hay ruta (se convierte en el puerto). */
    ubicacionUrl: string;
    token: string;
    origen: EstadoConexionGsg['origen'];
    origenClave: EstadoConexionGsg['origenClave'];
  }
  const ninguna: Efectiva = { modo: 'ninguna', url: '', rutaUbicacion: '', ubicacionUrl: '', token: '', origen: 'ninguna', origenClave: null };

  /** Lo que manda: la pantalla, y si no hay nada, el .env. */
  const efectiva = (): Efectiva => {
    if (guardada.modo === 'simulador') return ninguna;
    if (guardada.modo === 'real' && guardada.url) {
      return {
        modo: 'real',
        url: guardada.url,
        rutaUbicacion: guardada.rutaUbicacion,
        ubicacionUrl: guardada.rutaUbicacion ? '' : guardada.urlUbicacion || deps.config.GSG_SEND_LOCATION_URL || '',
        token,
        origen: 'pantalla',
        origenClave: token ? (tokenAntiguo ? 'pantalla_antigua' : 'pantalla') : null,
      };
    }
    if (deps.config.GSG_URL.trim()) {
      const nueva = (deps.config.GSG_API_KEY ?? '').trim();
      const clave = nueva || deps.config.GSG_TOKEN.trim();
      const ruta = (deps.config.GSG_LOCATION_PATH ?? '').trim();
      return {
        modo: 'real',
        url: deps.config.GSG_URL.trim(),
        rutaUbicacion: ruta,
        ubicacionUrl: ruta ? '' : deps.config.GSG_SEND_LOCATION_URL || '',
        token: clave,
        origen: 'env',
        origenClave: clave ? (nueva ? 'env' : 'env_antigua') : null,
      };
    }
    return ninguna;
  };

  const actual = (): PuertoGsg => {
    const e = efectiva();
    if (!e.url) {
      vigente = null;
      return enEspera;
    }
    const firma = JSON.stringify([e.url, e.rutaUbicacion, e.ubicacionUrl, e.token]);
    if (!vigente || vigente.firma !== firma) {
      vigente = { firma, puerto: crearPuertoHttp({ url: e.url, token: e.token, rutaUbicacion: e.rutaUbicacion || undefined, ubicacionUrl: e.ubicacionUrl || undefined, fetchImpl: deps.fetchImpl }) };
    }
    return vigente.puerto;
  };
  const enEspera = crearPuertoEnEspera();

  async function recargar(): Promise<void> {
    guardada = conexionSchema.parse({});
    token = '';
    tokenAntiguo = false;
    let antiguo = '';
    for (const row of await deps.settingsRepo.getAll()) {
      if (row.key === CLAVE_CONEXION) {
        try {
          guardada = conexionSchema.parse(JSON.parse(row.value));
        } catch {
          log('la conexión con GSG guardada no se pudo leer: se ignora');
        }
      } else if (row.key === CLAVE_API_KEY || row.key === CLAVE_TOKEN_ANTIGUA) {
        try {
          const valor = row.encrypted ? decrypt(row.value, key) : row.value;
          if (row.key === CLAVE_API_KEY) token = valor;
          else antiguo = valor;
        } catch {
          // Sin el valor: ni la clave ni un trozo de ella van al log.
          log('no se pudo descifrar la API Key de GSG: se ignora');
        }
      }
    }
    // Compatibilidad: la clave guardada donde antes (`gsg.token`), si no hay nueva.
    if (!token && antiguo) {
      token = antiguo;
      tokenAntiguo = true;
    }
    // Compatibilidad: la URL completa de ubicación de antes se convierte a
    // URL base + ruta SOLO si es inequívoco (reglas en migrarUbicacionAntigua).
    // Si no, se deja como estaba: el puerto da el error y no envía nada.
    if (guardada.modo === 'real' && guardada.url && !guardada.rutaUbicacion) {
      const m = migrarUbicacionAntigua(guardada.url, guardada.urlUbicacion || deps.config.GSG_SEND_LOCATION_URL || '');
      if (m.ok) {
        guardada = { ...guardada, url: m.base.replace(/\/+$/, ''), rutaUbicacion: m.ruta, urlUbicacion: '' };
        try {
          await persistir();
          // Solo la regla: ni URLs ni claves en el log.
          log('la URL antigua de ubicación de GSG se convirtió a URL base + ruta', { regla: m.regla });
        } catch {
          log('no se pudo guardar la conversión de la URL de GSG: se repetirá al arrancar');
        }
      } else {
        log('la URL antigua de ubicación de GSG no se puede convertir sin adivinar: no se envía nada hasta corregirla en Conexión');
      }
    }
  }
  await recargar();

  // El proxy: lo que ve el resto del sistema. Apunta a lo vigente en cada llamada.
  const proxy: PuertoGsg = {
    conectado: () => actual().conectado(),
    descripcion: () => {
      const e = efectiva();
      if (e.modo === 'simulador') return 'el simulador de GSG de este servidor (números ficticios)';
      if (e.modo === 'real') return `la API de GSG en ${e.url}`;
      return 'GSG no está conectado: lo reportable se guarda y saldrá entero al conectarlo';
    },
    enviar: (tipo, payload): Promise<ResultadoEnvio> => actual().enviar(tipo, payload),
    esSimulador: () => efectiva().modo === 'simulador',
    urlUbicacion: () => actual().urlUbicacion?.() ?? null,
    errorConfiguracion: () => actual().errorConfiguracion?.() ?? null,
    firma: () => actual().firma?.() ?? actual().descripcion(),
    consultar: async <T,>(ruta: string): Promise<ResultadoConsulta<T>> => {
      const r = await actual().consultar<T>(ruta);
      if (r.ok && ruta === RUTA_GSG_PENDIENTES && observadores.size) {
        for (const fn of observadores) {
          try {
            await fn(r.cuerpo);
          } catch (error) {
            log('un observador de los pendientes de GSG falló', { error: String(error) });
          }
        }
      }
      return r;
    },
  };
  const observadores = new Set<(cuerpo: unknown) => void | Promise<void>>();

  const estado = (): EstadoConexionGsg => {
    const e = efectiva();
    return {
      modo: e.modo,
      url: e.url,
      rutaUbicacion: e.rutaUbicacion,
      urlUbicacion: e.origen === 'pantalla' && !e.rutaUbicacion ? guardada.urlUbicacion : '',
      destinoUbicacion: proxy.urlUbicacion?.() ?? null,
      tieneToken: Boolean(e.token),
      claveEnmascarada: enmascararClave(e.token),
      origenClave: e.origenClave,
      errorConfiguracion: e.url ? proxy.errorConfiguracion?.() ?? null : null,
      conectada: Boolean(e.url) && !(proxy.errorConfiguracion?.() ?? null),
      origen: e.origen,
      descripcion: proxy.descripcion(),
      conectadoEn: guardada.conectadoEn,
      ultimaPrueba,
      aviso:
        e.url && proxy.errorConfiguracion?.()
          ? `La configuración de GSG no es válida: ${proxy.errorConfiguracion?.()} No se envía nada hasta corregirla.`
          : e.modo === 'real' && !/^https:\/\//i.test(e.url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(e.url)
          ? 'La dirección de GSG no usa https: los datos de los clientes viajarían sin cifrar. Pídele a GSG su dirección con https.'
          : e.modo === 'real' && !e.token
            ? 'Falta la API Key de GSG: sin ella, su API rechazará las llamadas.'
            : null,
    };
  };

  async function persistir(): Promise<void> {
    await deps.settingsRepo.put(CLAVE_CONEXION, JSON.stringify(guardada), false);
  }

  /**
   * La prueba de conexión: SOLO LECTURA. Un GET sin cuerpo a la consulta de
   * pendientes (la misma que hace la sincronización). Nunca crea pedidos ni
   * manda ubicaciones. La clave no aparece en ningún mensaje.
   */
  async function probar(candidata?: { url: string; token: string; rutaUbicacion?: string | null }): Promise<PruebaGsg> {
    const puerto = candidata
      ? crearPuertoHttp({
          url: candidata.url,
          // Sin clave nueva en la prueba, la guardada.
          token: candidata.token || efectiva().token,
          rutaUbicacion: candidata.rutaUbicacion || efectiva().rutaUbicacion || RUTA_UBICACION_POR_DEFECTO,
          fetchImpl: deps.fetchImpl,
          timeoutSegundos: 10,
        })
      : actual();
    const at = new Date().toISOString();
    if (!puerto.conectado()) {
      ultimaPrueba = { ok: false, detalle: 'No hay ninguna conexión con GSG: configura la URL base de su API.', at };
      return ultimaPrueba;
    }
    const errorConfig = puerto.errorConfiguracion?.() ?? null;
    if (errorConfig) {
      ultimaPrueba = { ok: false, detalle: `La configuración de GSG no es válida: ${errorConfig} No se envía nada hasta corregirla.`, at };
      return ultimaPrueba;
    }
    const r = await puerto.consultar<PendientesGsg>(RUTA_GSG_PENDIENTES);
    if (!r.ok) {
      const detalle =
        r.status === 401
          ? 'GSG rechazó la clave (error 401): la API Key de GSG es incorrecta. Revisa que sea la que te dio GSG.'
          : r.status === 403
            ? 'GSG rechazó la clave (error 403): la API Key de GSG no tiene permisos. Pide a GSG que le dé acceso.'
          : r.status === 404
            ? `GSG respondió con error 404: no tiene la ruta ${RUTA_GSG_PENDIENTES}. Revisa la dirección (tiene que ser la base de su API).`
            : `No se pudo consultar a GSG: ${r.error ?? 'sin respuesta'}.`;
      // Su API contesta y no rechaza la clave, solo no tiene la consulta de
      // pendientes: para mandar la ubicacion no hace falta, no es un fallo.
      if (r.status === 404) {
        const destino = puerto.urlUbicacion?.() ?? null;
        ultimaPrueba = { ok: true, detalle: `GSG responde. Su API no tiene la consulta ${RUTA_GSG_PENDIENTES} (error 404), que no hace falta para enviar ubicaciones.${destino ? ` Las ubicaciones se envían con POST a ${destino}.` : ''}`, at };
        return ultimaPrueba;
      }
      ultimaPrueba = { ok: false, detalle, at };
      return ultimaPrueba;
    }
    const c = r.cuerpo ?? {};
    const n = (x: unknown) => (Array.isArray(x) ? x.length : 0);
    ultimaPrueba = {
      ok: true,
      detalle: `GSG responde. Falta ubicación: ${n(c.faltaUbicacion)} · falta confirmar: ${n(c.faltaConfirmacion)} · terminados: ${n(c.terminados)}.`,
      faltaUbicacion: n(c.faltaUbicacion),
      faltaConfirmacion: n(c.faltaConfirmacion),
      terminados: n(c.terminados),
      at,
    };
    return ultimaPrueba;
  }

  const extras = await crearGsgExtras({ settingsRepo: deps.settingsRepo, puerto: () => proxy, ahora: deps.ahora, timezone: deps.config.timezone, log });

  const servicio: ServicioConexionGsg = {
    estado,
    puerto: () => proxy,
    recargar,
    probar,
    extras,
    observar(fn) {
      observadores.add(fn);
      return () => observadores.delete(fn);
    },
    async conectarReal(input) {
      const url = input.url.trim().replace(/\/+$/, '');
      if (!url) throw new Error('Falta la URL base de GSG.');
      if (!/^https?:\/\//i.test(url)) throw new Error('La URL base tiene que empezar por http:// o https://.');
      const base = normalizarBaseGsg(url);
      if (!base.ok) throw new Error(base.error);
      let urlBase = url;
      let ruta: string;
      if (input.rutaUbicacion !== undefined && input.rutaUbicacion !== null) {
        ruta = input.rutaUbicacion.trim();
        if (!ruta) throw new Error('Falta la ruta para enviar la ubicación (por ejemplo v1/gsgchat/location).');
      } else if ((input.urlUbicacion ?? '').trim()) {
        // Compatibilidad: quien aún manda la URL completa de la ubicación.
        const m = migrarUbicacionAntigua(url, input.urlUbicacion!.trim());
        if (!m.ok) throw new Error(m.error);
        urlBase = m.base.replace(/\/+$/, '');
        ruta = m.ruta;
      } else {
        ruta = (guardada.modo === 'real' && guardada.rutaUbicacion) || RUTA_UBICACION_POR_DEFECTO;
      }
      const destino = unirUrlGsg(urlBase, ruta);
      if (!destino.ok) throw new Error(destino.error);
      guardada = { modo: 'real', url: urlBase, rutaUbicacion: ruta, urlUbicacion: '', conectadoEn: new Date().toISOString() };
      const nueva = input.apiKey ?? input.token;
      if (nueva !== undefined && nueva !== null) {
        token = nueva.trim();
        tokenAntiguo = false;
        if (token) await deps.settingsRepo.put(CLAVE_API_KEY, encrypt(token, key), true);
        else await deps.settingsRepo.remove(CLAVE_API_KEY);
        // La antigua ya no se usa: la nueva (o ninguna) manda.
        await deps.settingsRepo.remove(CLAVE_TOKEN_ANTIGUA);
      }
      await persistir();
      vigente = null;
      return estado();
    },
    async usarSimulador() { throw new Error('El modo de prueba fue retirado. Configura la API real de GSG.'); },
    async quitar() {
      guardada = conexionSchema.parse({});
      token = '';
      await deps.settingsRepo.remove(CLAVE_CONEXION);
      await deps.settingsRepo.remove(CLAVE_API_KEY);
      await deps.settingsRepo.remove(CLAVE_TOKEN_ANTIGUA);
      tokenAntiguo = false;
      ultimaPrueba = null;
      vigente = null;
      return estado();
    },
  };
  vigenteCreada = servicio;
  return servicio;
}
