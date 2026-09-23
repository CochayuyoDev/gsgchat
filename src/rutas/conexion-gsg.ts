/**
 * La conexión con el sistema de GSG, configurable desde la pantalla.
 *
 * Antes la dirección y el token de GSG solo vivían en el `.env` (GSG_URL,
 * GSG_TOKEN) y cambiarlos obligaba a reiniciar. Ahora viven en `settings`
 * (`gsg.conexion` en claro, `gsg.token` cifrado) y se cambian desde
 * Entregas del día; el `.env` es el valor inicial para quien ya lo tenía.
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
import { crearPuertoEnEspera, crearPuertoHttp, RUTA_GSG_PENDIENTES, type PuertoGsg, type ResultadoConsulta, type ResultadoEnvio } from './gsg.js';
import { crearGsgExtras, type ServicioGsgExtras } from './gsg-extras.js';

const CLAVE_CONEXION = 'gsg.conexion';
const CLAVE_TOKEN = 'gsg.token';

/** El token con el que este servidor habla con su propio simulador. */
export const TOKEN_SIMULADOR = 'simulador-gsg-local';
/** Donde se monta el simulador dentro de este mismo servidor. */
export const RUTA_SIMULADOR = '/simulador/gsg';

const conexionSchema = z.object({
  /** real = la API de GSG; simulador = la copia de mentira de este servidor; ninguna = solo encolar. */
  modo: z.enum(['ninguna', 'real', 'simulador']).default('ninguna'),
  url: z.string().trim().max(300).default(''),
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
  url: string;
  tieneToken: boolean;
  /** true = hay a donde mandar y de donde traer. */
  conectada: boolean;
  /** De donde salio lo vigente. */
  origen: 'pantalla' | 'env' | 'ninguna';
  descripcion: string;
  conectadoEn: string | null;
  ultimaPrueba: PruebaGsg | null;
}

export interface ServicioConexionGsg {
  estado(): EstadoConexionGsg;
  /** El puerto para el resto del sistema: siempre el mismo objeto, apunta a lo vigente. */
  puerto(): PuertoGsg;
  /** Conecta con la API real. Sin `token` conserva el que había. */
  conectarReal(input: { url: string; token?: string | null }): Promise<EstadoConexionGsg>;
  /** Apunta al simulador de este servidor. */
  usarSimulador(): Promise<EstadoConexionGsg>;
  /** Quita la conexión de la pantalla; si el `.env` tenía una, vuelve a mandar esa. */
  quitar(): Promise<EstadoConexionGsg>;
  /** Pide los pendientes a lo vigente (o a lo que se le pase, sin guardar) y dice qué contestó. */
  probar(candidata?: { url: string; token: string }): Promise<PruebaGsg>;
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
  config: { GSG_URL: string; GSG_TOKEN: string; PUBLIC_BASE_URL: string; timezone?: string };
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
  let token = '';
  let ultimaPrueba: PruebaGsg | null = null;
  let vigente: { url: string; token: string; puerto: PuertoGsg } | null = null;

  const urlSimulador = () => `${deps.config.PUBLIC_BASE_URL.replace(/\/+$/, '')}${RUTA_SIMULADOR}`;

  /** Lo que manda: la pantalla, y si no hay nada, el .env. */
  const efectiva = (): { modo: EstadoConexionGsg['modo']; url: string; token: string; origen: EstadoConexionGsg['origen'] } => {
    if (guardada.modo === 'simulador') return { modo: 'simulador', url: urlSimulador(), token: TOKEN_SIMULADOR, origen: 'pantalla' };
    if (guardada.modo === 'real' && guardada.url) return { modo: 'real', url: guardada.url, token, origen: 'pantalla' };
    if (deps.config.GSG_URL.trim()) return { modo: 'real', url: deps.config.GSG_URL.trim(), token: deps.config.GSG_TOKEN, origen: 'env' };
    return { modo: 'ninguna', url: '', token: '', origen: 'ninguna' };
  };

  const actual = (): PuertoGsg => {
    const e = efectiva();
    if (!e.url) {
      vigente = null;
      return enEspera;
    }
    if (!vigente || vigente.url !== e.url || vigente.token !== e.token) {
      vigente = { url: e.url, token: e.token, puerto: crearPuertoHttp({ url: e.url, token: e.token, fetchImpl: deps.fetchImpl }) };
    }
    return vigente.puerto;
  };
  const enEspera = crearPuertoEnEspera();

  async function recargar(): Promise<void> {
    guardada = conexionSchema.parse({});
    token = '';
    for (const row of await deps.settingsRepo.getAll()) {
      if (row.key === CLAVE_CONEXION) {
        try {
          guardada = conexionSchema.parse(JSON.parse(row.value));
        } catch {
          log('la conexión con GSG guardada no se pudo leer: se ignora');
        }
      } else if (row.key === CLAVE_TOKEN) {
        try {
          token = row.encrypted ? decrypt(row.value, key) : row.value;
        } catch {
          log('no se pudo descifrar el token de GSG: se ignora');
        }
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
      tieneToken: Boolean(e.token),
      conectada: Boolean(e.url),
      origen: e.origen,
      descripcion: proxy.descripcion(),
      conectadoEn: guardada.conectadoEn,
      ultimaPrueba,
    };
  };

  async function persistir(): Promise<void> {
    await deps.settingsRepo.put(CLAVE_CONEXION, JSON.stringify(guardada), false);
  }

  async function probar(candidata?: { url: string; token: string }): Promise<PruebaGsg> {
    const puerto = candidata ? crearPuertoHttp({ url: candidata.url, token: candidata.token, fetchImpl: deps.fetchImpl, timeoutSegundos: 10 }) : actual();
    const at = new Date().toISOString();
    if (!puerto.conectado()) {
      ultimaPrueba = { ok: false, detalle: 'No hay ninguna conexión con GSG: elige el simulador o pega la dirección de su API.', at };
      return ultimaPrueba;
    }
    const r = await puerto.consultar<PendientesGsg>(RUTA_GSG_PENDIENTES);
    if (!r.ok) {
      const detalle =
        r.status === 401 || r.status === 403
          ? 'GSG rechazó el token: revisa que sea el que te dieron.'
          : r.status === 404
            ? `GSG respondió pero no tiene la ruta ${RUTA_GSG_PENDIENTES}: revisa la dirección (tiene que ser la base de su API).`
            : `No se pudo consultar a GSG: ${r.error ?? 'sin respuesta'}.`;
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
      if (!url) throw new Error('Falta la dirección de la API de GSG.');
      if (!/^https?:\/\//i.test(url)) throw new Error('La dirección tiene que empezar por http:// o https://.');
      guardada = { modo: 'real', url, conectadoEn: new Date().toISOString() };
      if (input.token !== undefined && input.token !== null) {
        token = input.token.trim();
        if (token) await deps.settingsRepo.put(CLAVE_TOKEN, encrypt(token, key), true);
        else await deps.settingsRepo.remove(CLAVE_TOKEN);
      }
      await persistir();
      vigente = null;
      return estado();
    },
    async usarSimulador() {
      guardada = { modo: 'simulador', url: '', conectadoEn: new Date().toISOString() };
      await persistir();
      vigente = null;
      return estado();
    },
    async quitar() {
      guardada = conexionSchema.parse({});
      token = '';
      await deps.settingsRepo.remove(CLAVE_CONEXION);
      await deps.settingsRepo.remove(CLAVE_TOKEN);
      ultimaPrueba = null;
      vigente = null;
      return estado();
    },
  };
  vigenteCreada = servicio;
  return servicio;
}
