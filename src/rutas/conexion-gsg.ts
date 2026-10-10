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
 *  - **Con la API real de GSG**: dirección + token. Solo para MANDARLE los
 *    reportes (ubicaciones, confirmaciones, entregas, incidencias,
 *    resúmenes). GSGchat nunca le pide nada a GSG: los pedidos llegan cuando
 *    GSG los empuja a POST /api/v1/entregas.
 *  - **Con el simulador**: el propio servidor levanta una copia de mentira
 *    del sistema de GSG (ver src/entregas/gsg-simulado.ts) con sus listas
 *    de quién falta ubicación, quién falta confirmar y quién ya terminó. Es
 *    para probar el flujo entero con números ficticios sin tocar a nadie;
 *    lo que se carga en él entra al momento, sin preguntarle nada.
 *
 * El puerto que ve el resto del sistema (`puerto()`) es siempre el mismo
 * objeto: apunta a lo vigente en cada llamada. Nada se reinicia al cambiar.
 */

import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { SettingsRepo } from '../settings/service.js';
import { decrypt, encrypt, keyFromBase64 } from '../settings/crypto.js';
import { crearPuertoEnEspera, crearPuertoHttp, type PuertoGsg, type ResultadoEnvio } from './gsg.js';
import { crearGsgExtras, type ServicioGsgExtras } from './gsg-extras.js';

const CLAVE_CONEXION = 'gsg.conexion';
const CLAVE_TOKEN = 'gsg.token';

/**
 * El token con el que este servidor habla con su propio simulador.
 *
 * Al azar en cada arranque: el simulador va montado en produccion y antes el
 * token era fijo y publico (salia en el contrato). Con el, cualquiera podia
 * cargar pedidos con telefonos de verdad (y, en modo simulador, el sistema
 * les escribia por WhatsApp) o leer las ubicaciones que se le mandaron. Desde
 * fuera se entra con los tokens caducables «gsgsim_…» (Conexion → Para los
 * programadores de GSG), que el gancho de gsg-extras-routes.ts traduce a este.
 */
export const TOKEN_SIMULADOR = `simulador-gsg-local-${randomBytes(24).toString('hex')}`;
/** Donde se monta el simulador dentro de este mismo servidor. */
export const RUTA_SIMULADOR = '/simulador/gsg';

const conexionSchema = z.object({
  /** real = la API de GSG; simulador = la copia de mentira de este servidor; ninguna = solo encolar. */
  modo: z.enum(['ninguna', 'real', 'simulador']).default('ninguna'),
  url: z.string().trim().max(300).default(''),
  conectadoEn: z.string().nullable().default(null),
});
type ConexionGuardada = z.infer<typeof conexionSchema>;

/**
 * Lo que dice «Probar». No llama a GSG: revisa que la dirección y el token
 * tengan buena forma y explica cómo se hablan los dos sistemas.
 */
export interface PruebaGsg {
  ok: boolean;
  detalle: string;
  at: string;
}

export interface EstadoConexionGsg {
  modo: 'ninguna' | 'real' | 'simulador';
  url: string;
  tieneToken: boolean;
  /** true = hay a donde mandar los reportes. */
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
  /** Conecta con la API real. Sin `token` conserva el que había. */
  conectarReal(input: { url: string; token?: string | null }): Promise<EstadoConexionGsg>;
  /** Apunta al simulador de este servidor. */
  usarSimulador(): Promise<EstadoConexionGsg>;
  /** Quita la conexión de la pantalla; si el `.env` tenía una, vuelve a mandar esa. */
  quitar(): Promise<EstadoConexionGsg>;
  /**
   * Revisa lo vigente (o lo que se le pase, sin guardar): que la dirección y
   * el token tengan buena forma. Sin red: a GSG no se le pregunta nada.
   */
  probar(candidata?: { url: string; token: string }): Promise<PruebaGsg>;
  recargar(): Promise<void>;
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
  };

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
      aviso:
        e.modo === 'real' && !/^https:\/\//i.test(e.url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(e.url)
          ? 'La dirección de GSG no usa https: los datos de los clientes viajarían sin cifrar. Pídele a GSG su dirección con https.'
          : e.modo === 'real' && !e.token
            ? 'Falta el token de GSG: sin él, su API rechazará las llamadas.'
            : null,
    };
  };

  async function persistir(): Promise<void> {
    await deps.settingsRepo.put(CLAVE_CONEXION, JSON.stringify(guardada), false);
  }

  async function probar(candidata?: { url: string; token: string }): Promise<PruebaGsg> {
    const at = new Date().toISOString();
    const e = efectiva();
    // Sin red: ni un GET. Solo la forma de lo que hay (o de lo que se quiere poner).
    const probada = candidata ? { modo: 'real' as const, url: candidata.url.trim().replace(/\/+$/, ''), token: candidata.token.trim() } : e;
    if (probada.modo === 'ninguna' || !probada.url) {
      ultimaPrueba = { ok: false, detalle: 'No hay ninguna conexión con GSG: elige el simulador o pega la dirección de su API.', at };
      return ultimaPrueba;
    }
    if (probada.modo === 'simulador') {
      ultimaPrueba = { ok: true, detalle: 'Se usa el simulador de GSG de este servidor (números ficticios). Lo que cargues en él entra al momento; los reportes le llegan a él.', at };
      return ultimaPrueba;
    }
    const sinPedir = 'GSGchat no le pide nada a GSG: los pedidos llegan solo cuando GSG los manda a POST /api/v1/entregas (con su clave de API), y GSGchat le manda a esta dirección los reportes (ubicaciones, confirmaciones, entregas, incidencias y resúmenes).';
    let url: URL | null = null;
    try {
      url = new URL(probada.url);
    } catch {
      url = null;
    }
    if (!url || !/^https?:$/.test(url.protocol) || !url.hostname) {
      ultimaPrueba = { ok: false, detalle: 'La dirección de GSG no es una dirección web válida: tiene que empezar por https:// (por ejemplo https://api.gsg.pe/v1).', at };
      return ultimaPrueba;
    }
    if (!probada.token) {
      ultimaPrueba = { ok: false, detalle: `Falta el token de GSG: sin él, su API rechazará los reportes. ${sinPedir}`, at };
      return ultimaPrueba;
    }
    if (/\s/.test(probada.token) || probada.token.length < 8) {
      ultimaPrueba = { ok: false, detalle: 'El token de GSG no tiene buena forma (tiene espacios o es demasiado corto): cópialo otra vez tal cual te lo dieron.', at };
      return ultimaPrueba;
    }
    const local = /^(localhost|127\.0\.0\.1)$/i.test(url.hostname);
    const aviso = url.protocol === 'https:' || local ? '' : ' Ojo: la dirección no usa https y los datos de los clientes viajarían sin cifrar.';
    ultimaPrueba = { ok: true, detalle: `La dirección y el token tienen buena forma. ${sinPedir}${aviso}`, at };
    return ultimaPrueba;
  }

  const extras = await crearGsgExtras({ settingsRepo: deps.settingsRepo, ahora: deps.ahora, timezone: deps.config.timezone, log });

  const servicio: ServicioConexionGsg = {
    estado,
    puerto: () => proxy,
    recargar,
    probar,
    extras,
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
