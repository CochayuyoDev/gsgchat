/**
 * El token con el que el chat embebido entra.
 *
 * Stoky (o cualquier web) no puede poner su clave `wak_` en el navegador:
 * la veria cualquiera. Lo que hace es pedir, desde SU servidor y con su
 * clave, un token corto para la persona que tiene la pantalla abierta
 * (`POST /api/v1/embed/token`), y ese token es lo que viaja al iframe.
 *
 * Es el mismo esquema que la cookie de sesion (ver auth/sesion.ts): un JSON
 * en base64url y un HMAC con un secreto del servidor. Dentro va quien es el
 * operador, a que telefono se limita (si se limita), que puede hacer y
 * cuando caduca. Nadie fabrica uno sin el secreto, y caduca solo.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Config } from '../config.js';

export const PREFIJO_EMBED = 'emb_';
export const DURACION_POR_DEFECTO_MIN = 60;
export const DURACION_MAX_MIN = 12 * 60;

export interface CargaEmbed {
  /** Quien tiene la pantalla abierta, como lo llama el otro sistema. */
  operador: string;
  /** Si viene, el token solo abre ESE hilo. */
  telefono: string | null;
  permisos: string[];
  /** Caducidad, ms desde epoch. */
  exp: number;
}

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const firma = (secreto: string, cuerpo: string) => createHmac('sha256', secreto).update(cuerpo).digest('base64url');

/** Derivado del secreto de rastreo, como el de las cookies: no se pide otro. */
export function secretoDeEmbebido(config: Config): string {
  return createHmac('sha256', config.TRACKING_SECRET).update('chat-embebido').digest('hex');
}

export function firmarTokenEmbebido(secreto: string, carga: Omit<CargaEmbed, 'exp'>, duracionMin = DURACION_POR_DEFECTO_MIN, ahora = Date.now()): string {
  const minutos = Math.min(Math.max(1, duracionMin), DURACION_MAX_MIN);
  const cuerpo = b64(JSON.stringify({ ...carga, exp: ahora + minutos * 60_000 } satisfies CargaEmbed));
  return `${PREFIJO_EMBED}${cuerpo}.${firma(secreto, cuerpo)}`;
}

export function pareceTokenEmbebido(valor: string): boolean {
  return valor.startsWith(PREFIJO_EMBED) && valor.includes('.');
}

export function leerTokenEmbebido(secreto: string, token: string | undefined, ahora = Date.now()): CargaEmbed | null {
  if (!token || !pareceTokenEmbebido(token)) return null;
  const sinPrefijo = token.slice(PREFIJO_EMBED.length);
  const punto = sinPrefijo.lastIndexOf('.');
  if (punto <= 0) return null;
  const cuerpo = sinPrefijo.slice(0, punto);
  const dada = Buffer.from(sinPrefijo.slice(punto + 1));
  const esperada = Buffer.from(firma(secreto, cuerpo));
  if (dada.length !== esperada.length || !timingSafeEqual(dada, esperada)) return null;
  try {
    const carga = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')) as CargaEmbed;
    if (typeof carga.operador !== 'string' || typeof carga.exp !== 'number' || !Array.isArray(carga.permisos)) return null;
    if (carga.telefono !== null && typeof carga.telefono !== 'string') return null;
    if (carga.exp <= ahora) return null;
    return carga;
  } catch {
    return null;
  }
}

/** Lo que un token embebido puede tener como mucho: el chat, nada mas. */
export const PERMISOS_EMBEBIDO_MAX = ['mensajes:enviar', 'conversaciones:leer', 'contactos:leer', 'plantillas:leer', 'estado:leer'] as const;
