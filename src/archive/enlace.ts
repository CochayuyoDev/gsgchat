/**
 * Enlaces de evidencia: una conversacion guardada, de solo lectura, para
 * quien no tiene cuenta en el panel (el cliente que reclama, el motorizado,
 * el contador, un abogado).
 *
 * El enlace lleva un token firmado con la clave del sistema, igual que los
 * enlaces de rastreo: dentro va el id del respaldo y hasta cuando vale. No se
 * guarda nada en la base -no hay una tabla de enlaces- porque la firma ya
 * dice si el enlace es nuestro y la fecha ya dice si sigue vivo. Lo que si
 * se garantiza es que un enlace nunca ensena el telefono entero ni las notas
 * internas: `sinTelefono` va dentro del token y no se puede quitar sin
 * romper la firma.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface EnlacePayload {
  /** El id del respaldo. */
  a: number;
  /** Epoch en segundos. */
  exp: number;
  /** Siempre true: la copia publica tapa el telefono y omite las notas. */
  sinTelefono: true;
}

export type VerificacionEnlace = { ok: true; payload: EnlacePayload } | { ok: false; motivo: 'caducado' | 'no_valido' };

const b64url = (input: string): string => Buffer.from(input).toString('base64url');

function firma(cuerpo: string, secreto: string): string {
  return createHmac('sha256', `evidencia:${secreto}`).update(cuerpo).digest('base64url');
}

export function firmarEnlace(payload: EnlacePayload, secreto: string): string {
  const cuerpo = b64url(JSON.stringify(payload));
  return `${cuerpo}.${firma(cuerpo, secreto)}`;
}

/** Comprueba la firma y la fecha. Distingue "caducado" de "no es nuestro" para poder decirlo en pantalla. */
export function verificarEnlace(token: string, secreto: string, ahora: Date = new Date()): VerificacionEnlace {
  const partes = token.split('.');
  if (partes.length !== 2) return { ok: false, motivo: 'no_valido' };
  const [cuerpo, recibida] = partes as [string, string];
  const esperada = Buffer.from(firma(cuerpo, secreto));
  const dada = Buffer.from(recibida);
  if (esperada.length !== dada.length || !timingSafeEqual(esperada, dada)) return { ok: false, motivo: 'no_valido' };

  let payload: EnlacePayload;
  try {
    payload = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')) as EnlacePayload;
  } catch {
    return { ok: false, motivo: 'no_valido' };
  }
  if (!payload || !Number.isInteger(payload.a) || payload.sinTelefono !== true || typeof payload.exp !== 'number') return { ok: false, motivo: 'no_valido' };
  if (payload.exp * 1000 <= ahora.getTime()) return { ok: false, motivo: 'caducado' };
  return { ok: true, payload };
}

/** Un enlace para el respaldo `id` que vale `dias` dias desde ahora. */
export function crearEnlace(id: number, dias: number, secreto: string, ahora: Date = new Date()): { token: string; caducaEn: Date } {
  const caducaEn = new Date(ahora.getTime() + dias * 24 * 60 * 60 * 1000);
  return { token: firmarEnlace({ a: id, exp: Math.floor(caducaEn.getTime() / 1000), sinTelefono: true }, secreto), caducaEn };
}
