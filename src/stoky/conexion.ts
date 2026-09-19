/**
 * La conexión con Stoky, configurable desde la pantalla.
 *
 * Antes, la dirección de Stoky y su token solo se podían poner en el `.env`
 * (STOKY_URL, STOKY_TOKEN, STOKY_PANEL_URL) y había que reiniciar. Eso está
 * bien para quien programa y mal para quien atiende: la tienda no toca
 * ficheros. Ahora viven en `settings` (`stoky.conexion` en claro y
 * `stoky.token` cifrado con la clave de la instancia), se cambian desde
 * Conectar mi web y tienda, y el `.env` queda como valor inicial para quien
 * ya lo tenía.
 *
 * Dos direcciones, y esta es UNA de ellas:
 *  - Stoky → este WhatsApp: Stoky escribe y lee por la API pública con una
 *    clave `wak_…` que se crea aquí (Claves de API). Eso no lo guarda este
 *    fichero: lo guarda Stoky.
 *  - Este WhatsApp → Stoky: el asistente consulta precios y stock en el
 *    catálogo de Stoky y manda a registrar la venta en su panel. Para eso hace
 *    falta la dirección de la API de Stoky y un token `stk_…` de una "conexión
 *    de tienda" de Stoky. Eso es lo que vive aquí.
 *
 * El cliente que ve el resto del sistema (`cliente()`) es siempre el mismo
 * objeto: por dentro apunta a la conexión vigente y, si no hay ninguna, se
 * comporta como un catálogo vacío y `disponible()` dice false. Así nada se
 * reinicia al conectar o desconectar Stoky.
 */

import { z } from 'zod';
import type { Config } from '../config.js';
import type { SettingsRepo } from '../settings/service.js';
import { decrypt, encrypt, keyFromBase64 } from '../settings/crypto.js';
import { createStokyClient, type ConsultaCatalogo, type ProductoStoky, type StokyClient } from './client.js';

const CLAVE_CONEXION = 'stoky.conexion';
const CLAVE_TOKEN = 'stoky.token';

const conexionSchema = z.object({
  url: z.string().trim().max(300).default(''),
  panelUrl: z.string().trim().max(300).default(''),
  /** Como llegó: la pantalla de aquí o Stoky al vincularse. */
  origenAlta: z.enum(['pantalla', 'stoky']).nullable().default(null),
  conectadoEn: z.string().nullable().default(null),
  /** El nombre de la tienda y el almacén que dijo Stoky la última vez que respondió. */
  tienda: z.string().nullable().default(null),
  almacen: z.string().nullable().default(null),
});
type ConexionGuardada = z.infer<typeof conexionSchema>;

export interface PruebaStoky {
  ok: boolean;
  tienda?: string;
  almacen?: string;
  productos?: number;
  detalle?: string;
  at: string;
}

export interface EstadoConexionStoky {
  /** La API de Stoky (la que consulta este servidor). */
  url: string;
  /** El panel de Stoky (el que abre el operador en su navegador). */
  panelUrl: string;
  tieneToken: boolean;
  /** true = hay URL y token: el catálogo se consulta. */
  configurada: boolean;
  /** De dónde salió lo vigente. */
  origen: 'pantalla' | 'stoky' | 'env' | 'ninguna';
  conectadoEn: string | null;
  tienda: string | null;
  almacen: string | null;
  ultimaPrueba: PruebaStoky | null;
}

export interface ServicioConexionStoky {
  estado(): EstadoConexionStoky;
  /** El catálogo para el resto del sistema: siempre el mismo objeto, apunta a lo vigente. */
  cliente(): StokyClient;
  /** Guarda (o cambia) la conexión. Sin `token` conserva el que había. */
  guardar(input: { url: string; token?: string | null; panelUrl?: string | null; origenAlta?: 'pantalla' | 'stoky' }): Promise<EstadoConexionStoky>;
  /** Quita la conexión de la pantalla; si el `.env` tenía una, vuelve a mandar esa. */
  quitar(): Promise<EstadoConexionStoky>;
  /** Llama a Stoky con lo vigente (o con lo que se le pase, sin guardar) y dice qué contestó. */
  probar(candidata?: { url: string; token: string }): Promise<PruebaStoky>;
  recargar(): Promise<void>;
}

export interface DepsConexionStoky {
  settingsRepo: SettingsRepo;
  settingsKeyBase64: string;
  config: Pick<Config, 'STOKY_URL' | 'STOKY_TOKEN' | 'STOKY_PANEL_URL'>;
  fetchImpl?: typeof fetch;
  /** Para pruebas: quién fabrica el cliente. */
  fabrica?: (opts: { baseUrl: string; token: string }) => StokyClient;
  log?: (m: string, d?: Record<string, unknown>) => void;
}

/** Si ese catálogo existe y está conectado de verdad (el proxy puede estar vacío). */
export function hayCatalogo(c: StokyClient | undefined | null): c is StokyClient {
  return Boolean(c && (c.disponible?.() ?? true));
}

export async function crearConexionStoky(deps: DepsConexionStoky): Promise<ServicioConexionStoky> {
  const key = keyFromBase64(deps.settingsKeyBase64);
  const log = deps.log ?? (() => undefined);
  const fabrica = deps.fabrica ?? ((o) => createStokyClient({ baseUrl: o.baseUrl, token: o.token, fetchImpl: deps.fetchImpl }));

  let guardada: ConexionGuardada = conexionSchema.parse({});
  let token = '';
  let ultimaPrueba: PruebaStoky | null = null;
  let vigente: { url: string; token: string; cliente: StokyClient } | null = null;

  /** Lo que manda: la pantalla, y si no hay nada, el .env. */
  const efectiva = (): { url: string; token: string; panelUrl: string; origen: EstadoConexionStoky['origen'] } => {
    if (guardada.url && token) return { url: guardada.url, token, panelUrl: guardada.panelUrl || deps.config.STOKY_PANEL_URL, origen: guardada.origenAlta ?? 'pantalla' };
    if (deps.config.STOKY_URL && deps.config.STOKY_TOKEN) return { url: deps.config.STOKY_URL, token: deps.config.STOKY_TOKEN, panelUrl: deps.config.STOKY_PANEL_URL, origen: 'env' };
    return { url: guardada.url || deps.config.STOKY_URL, token: '', panelUrl: guardada.panelUrl || deps.config.STOKY_PANEL_URL, origen: 'ninguna' };
  };

  const actual = (): StokyClient | null => {
    const e = efectiva();
    if (!e.url || !e.token) {
      vigente = null;
      return null;
    }
    if (!vigente || vigente.url !== e.url || vigente.token !== e.token) vigente = { url: e.url, token: e.token, cliente: fabrica({ baseUrl: e.url, token: e.token }) };
    return vigente.cliente;
  };

  async function recargar(): Promise<void> {
    guardada = conexionSchema.parse({});
    token = '';
    for (const row of await deps.settingsRepo.getAll()) {
      if (row.key === CLAVE_CONEXION) {
        try {
          guardada = conexionSchema.parse(JSON.parse(row.value));
        } catch {
          log('la conexión con Stoky guardada no se pudo leer: se ignora');
        }
      } else if (row.key === CLAVE_TOKEN) {
        try {
          token = row.encrypted ? decrypt(row.value, key) : row.value;
        } catch {
          log('no se pudo descifrar el token de Stoky: se ignora');
        }
      }
    }
  }
  await recargar();

  const vacio: ConsultaCatalogo = { disponibles: [], agotados: [], similares: [], otrasVariantes: [] };

  // El proxy: lo que ve el resto del sistema. Apunta a lo vigente en cada
  // llamada, y sin conexión responde como un catálogo vacío.
  const proxy: StokyClient = {
    disponible: () => actual() !== null,
    async ping() {
      const c = actual();
      return c ? c.ping() : { ok: false, detail: 'Stoky no está conectado: falta la dirección o el token (Conectar mi web y tienda → Stoky).' };
    },
    async productos(): Promise<ProductoStoky[]> {
      const c = actual();
      return c ? c.productos() : [];
    },
    async buscar(texto, limite) {
      const c = actual();
      return c ? c.buscar(texto, limite) : [];
    },
    async consultar(texto) {
      const c = actual();
      return c ? c.consultar(texto) : vacio;
    },
    async precargar() {
      const c = actual();
      return c ? c.precargar() : { ok: false, total: 0, detail: 'sin conexión con Stoky' };
    },
  };

  const estado = (): EstadoConexionStoky => {
    const e = efectiva();
    return {
      url: e.url,
      panelUrl: e.panelUrl,
      tieneToken: Boolean(e.token),
      configurada: Boolean(e.url && e.token),
      origen: e.origen,
      conectadoEn: guardada.conectadoEn,
      tienda: guardada.tienda,
      almacen: guardada.almacen,
      ultimaPrueba,
    };
  };

  async function persistir(): Promise<void> {
    await deps.settingsRepo.put(CLAVE_CONEXION, JSON.stringify(guardada), false);
  }

  return {
    estado,
    cliente: () => proxy,
    recargar,
    async guardar(input) {
      const url = input.url.trim().replace(/\/+$/, '');
      if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error('La dirección de Stoky tiene que empezar por http:// o https:// (por ejemplo http://localhost:8102).');
      const panelUrl = (input.panelUrl ?? guardada.panelUrl ?? '').trim().replace(/\/+$/, '');
      if (panelUrl && !/^https?:\/\/[^\s]+$/i.test(panelUrl)) throw new Error('La dirección del panel de Stoky tiene que empezar por http:// o https://.');
      if (input.token !== undefined && input.token !== null && input.token.trim()) {
        token = input.token.trim();
        await deps.settingsRepo.put(CLAVE_TOKEN, encrypt(token, key), true);
      }
      if (!token && !deps.config.STOKY_TOKEN) throw new Error('Falta el token de Stoky: se crea en Stoky → Integraciones → Conexiones de tienda (empieza por stk_).');
      guardada = { ...guardada, url, panelUrl: panelUrl || url, origenAlta: input.origenAlta ?? 'pantalla', conectadoEn: new Date().toISOString() };
      await persistir();
      vigente = null;
      return estado();
    },
    async quitar() {
      guardada = conexionSchema.parse({});
      token = '';
      ultimaPrueba = null;
      vigente = null;
      await deps.settingsRepo.remove(CLAVE_CONEXION);
      await deps.settingsRepo.remove(CLAVE_TOKEN);
      return estado();
    },
    async probar(candidata) {
      const c = candidata ? fabrica({ baseUrl: candidata.url.trim().replace(/\/+$/, ''), token: candidata.token.trim() }) : actual();
      const at = new Date().toISOString();
      if (!c) {
        ultimaPrueba = { ok: false, detalle: 'Falta la dirección o el token de Stoky.', at };
        return ultimaPrueba;
      }
      const ping = await c.ping();
      if (!ping.ok) {
        const r: PruebaStoky = { ok: false, detalle: traducir(ping.detail), at };
        if (!candidata) ultimaPrueba = r;
        return r;
      }
      const carga = await c.precargar();
      const r: PruebaStoky = { ok: carga.ok, tienda: ping.tenant, almacen: ping.warehouse, productos: carga.total, detalle: carga.ok ? undefined : traducir(carga.detail), at };
      if (!candidata) {
        ultimaPrueba = r;
        if (r.ok && (guardada.url || guardada.origenAlta) && (guardada.tienda !== (ping.tenant ?? null) || guardada.almacen !== (ping.warehouse ?? null))) {
          guardada = { ...guardada, tienda: ping.tenant ?? null, almacen: ping.warehouse ?? null };
          await persistir().catch(() => undefined);
        }
      }
      return r;
    },
  };
}

/** El fallo de Stoky dicho para quien atiende, no para quien programa. */
function traducir(detalle: string | undefined): string {
  const d = detalle ?? '';
  if (/401|403|unauth|token/i.test(d)) return 'Stoky no acepta el token: créalo de nuevo en Stoky → Integraciones → Conexiones de tienda y pégalo aquí.';
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|network|timeout|abort/i.test(d)) return 'No se pudo llegar a Stoky: comprueba que esté encendido y que la dirección sea la correcta.';
  if (/404/.test(d)) return 'Esa dirección responde, pero no es la API de Stoky (404): revisa que no le falte o le sobre nada.';
  return d || 'Stoky no respondió.';
}
