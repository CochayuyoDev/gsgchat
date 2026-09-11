/**
 * La sesion: una cookie firmada, sin tabla.
 *
 * Dentro va el id del usuario, la version de su sesion y la caducidad; fuera,
 * un HMAC con el secreto del servidor. Nadie puede fabricar una sin el
 * secreto, y cambiar la contrasena (que sube la version) la invalida. La
 * cookie es HttpOnly y SameSite=Lax: el navegador la manda solo desde este
 * sitio y el JavaScript de la pagina no la ve.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE_SESION = 'wa_sesion';
const DURACION_MS = 7 * 24 * 60 * 60 * 1000;

export interface CargaSesion {
  /** Id del usuario. */
  u: string;
  /** Version de sesion del usuario al firmar. */
  v: number;
  /** Caducidad, ms desde epoch. */
  exp: number;
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');
const firma = (secreto: string, cuerpo: string) => createHmac('sha256', secreto).update(cuerpo).digest('base64url');

export function firmarSesion(secreto: string, carga: Omit<CargaSesion, 'exp'>, ahora = Date.now()): string {
  const cuerpo = b64(JSON.stringify({ ...carga, exp: ahora + DURACION_MS } satisfies CargaSesion));
  return `${cuerpo}.${firma(secreto, cuerpo)}`;
}

export function leerSesion(secreto: string, token: string | undefined, ahora = Date.now()): CargaSesion | null {
  if (!token) return null;
  const punto = token.lastIndexOf('.');
  if (punto <= 0) return null;
  const cuerpo = token.slice(0, punto);
  const dada = Buffer.from(token.slice(punto + 1));
  const esperada = Buffer.from(firma(secreto, cuerpo));
  if (dada.length !== esperada.length || !timingSafeEqual(dada, esperada)) return null;
  try {
    const carga = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')) as CargaSesion;
    if (typeof carga.u !== 'string' || typeof carga.v !== 'number' || typeof carga.exp !== 'number') return null;
    if (carga.exp <= ahora) return null;
    return carga;
  } catch {
    return null;
  }
}

/** Las cookies de la peticion, ya separadas. */
export function leerCookies(cabecera: string | undefined): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const parte of (cabecera ?? '').split(';')) {
    const i = parte.indexOf('=');
    if (i <= 0) continue;
    const nombre = parte.slice(0, i).trim();
    const valor = parte.slice(i + 1).trim();
    try {
      salida[nombre] = decodeURIComponent(valor);
    } catch {
      salida[nombre] = valor;
    }
  }
  return salida;
}

/** El valor de Set-Cookie para abrir la sesion. */
export function cookieDeSesion(token: string, segura: boolean): string {
  return `${COOKIE_SESION}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(DURACION_MS / 1000)}${segura ? '; Secure' : ''}`;
}

/** El valor de Set-Cookie para cerrarla. */
export function cookieDeCierre(segura: boolean): string {
  return `${COOKIE_SESION}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${segura ? '; Secure' : ''}`;
}
