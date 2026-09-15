/**
 * El canal web: los visitantes de la pagina del negocio chatean desde ahi.
 *
 * Un visitante es un contacto mas, con el mismo asistente de IA, las mismas
 * reglas y la misma pantalla de Chats para el equipo. Lo que cambia es el
 * transporte: en vez de WhatsApp, lo que sale hacia el va por el flujo de
 * eventos a su navegador. Para el resto del sistema es transparente.
 *
 * Como se reconoce: su "telefono" es `web-<16 hex>`. No hay columna nueva
 * ni migracion: la forma del identificador lo dice, y ningun numero de
 * WhatsApp puede colisionar (solo digitos).
 *
 * La sesion del visitante es un token firmado (HMAC con el secreto del
 * servidor) que lleva su id de contacto y caduca a los 30 dias: si vuelve
 * mañana, sigue su misma conversacion. Nadie fabrica uno sin el secreto.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Config } from '../config.js';

export const PREFIJO_WEB = 'web-';
export const PREFIJO_SESION = 'wvs_';
const DURACION_SESION_MS = 30 * 24 * 60 * 60 * 1000;

export function esContactoWeb(phone: string): boolean {
  return phone.startsWith(PREFIJO_WEB);
}

export function nuevoIdVisitante(): string {
  return PREFIJO_WEB + randomBytes(8).toString('hex');
}

/** "Visitante 4f2a": lo que se ve en Chats hasta que diga su nombre. */
export function nombreDeVisitante(phone: string): string {
  return `Visitante ${phone.slice(PREFIJO_WEB.length, PREFIJO_WEB.length + 4)}`;
}

export function secretoDeCanalWeb(config: Config): string {
  return createHmac('sha256', config.TRACKING_SECRET).update('canal-web-visitantes').digest('hex');
}

export interface SesionWeb {
  /** El id del contacto (`web-...`). */
  c: string;
  exp: number;
}

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const firma = (secreto: string, cuerpo: string) => createHmac('sha256', secreto).update(cuerpo).digest('base64url');

export function firmarSesionWeb(secreto: string, contacto: string, ahora = Date.now()): string {
  const cuerpo = b64(JSON.stringify({ c: contacto, exp: ahora + DURACION_SESION_MS } satisfies SesionWeb));
  return `${PREFIJO_SESION}${cuerpo}.${firma(secreto, cuerpo)}`;
}

export function leerSesionWeb(secreto: string, token: string | undefined, ahora = Date.now()): SesionWeb | null {
  if (!token || !token.startsWith(PREFIJO_SESION)) return null;
  const sinPrefijo = token.slice(PREFIJO_SESION.length);
  const punto = sinPrefijo.lastIndexOf('.');
  if (punto <= 0) return null;
  const cuerpo = sinPrefijo.slice(0, punto);
  const dada = Buffer.from(sinPrefijo.slice(punto + 1));
  const esperada = Buffer.from(firma(secreto, cuerpo));
  if (dada.length !== esperada.length || !timingSafeEqual(dada, esperada)) return null;
  try {
    const s = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')) as SesionWeb;
    if (typeof s.c !== 'string' || !esContactoWeb(s.c) || typeof s.exp !== 'number' || s.exp <= ahora) return null;
    return s;
  } catch {
    return null;
  }
}

/** Un id de mensaje del canal web, con la forma de un wamid para que todo lo trate igual. */
export function nuevoIdMensajeWeb(direccion: 'in' | 'out'): string {
  return `web.${direccion}.${Date.now().toString(36)}.${randomBytes(4).toString('hex')}`;
}

/**
 * Que origen puede usar el canal: los dominios del ajuste "webs que pueden
 * embeber", mas el propio sitio. Se compara el origen entero (esquema y
 * host), en minusculas y sin barra final.
 */
export function origenPermitido(origen: string | undefined, propio: string, dominios: string[]): boolean {
  if (!origen) return false;
  const o = origen.trim().toLowerCase().replace(/\/+$/, '');
  if (o === propio.toLowerCase().replace(/\/+$/, '')) return true;
  return dominios.some((d) => d.trim().toLowerCase().replace(/\/+$/, '') === o);
}
