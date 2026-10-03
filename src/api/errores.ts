/**
 * Los errores de la API, todos con la misma forma:
 *
 *   { ok: false, codigo: 'CLAVE_INVALIDA', error: 'La clave de API no existe…', detalles?: [...] }
 *
 * `error` sigue siendo el texto (lo que ya leian el panel y los clientes de
 * la API); `codigo` es estable y es lo que conviene comparar desde otro
 * sistema; `detalles` dice que campo fallo cuando aplica. Nunca lleva SQL,
 * trazas ni secretos: un error inesperado se apunta en el log y aqui sale
 * solo un texto general.
 */

import type { FastifyReply } from 'fastify';

export type CodigoError =
  | 'VALIDACION'
  | 'JSON_INVALIDO'
  | 'CLAVE_AUSENTE'
  | 'CLAVE_INVALIDA'
  | 'CLAVE_REVOCADA'
  | 'SIN_PERMISO'
  | 'TIENDA_SUSPENDIDA'
  | 'RUTA_NO_EXISTE'
  | 'NO_EXISTE'
  | 'CLAVE_AMBIGUA'
  | 'CONFLICTO'
  | 'MENSAJE_EN_CURSO'
  | 'MENSAJE_YA_ENVIADO'
  | 'RESULTADO_INCIERTO'
  | 'ESPERA_CONFIRMACION'
  | 'DEMASIADAS_PETICIONES'
  | 'BASE_NO_DISPONIBLE'
  | 'ERROR_INTERNO';

export interface DetalleCampo {
  /** Ruta del campo: "pedidos[2].telefono", "cuerpo"... */
  campo: string;
  mensaje: string;
}

export interface CuerpoError {
  ok: false;
  codigo: CodigoError;
  error: string;
  detalles?: DetalleCampo[] | Record<string, unknown>;
}

export function cuerpoError(codigo: CodigoError, error: string, detalles?: CuerpoError['detalles']): CuerpoError {
  return detalles === undefined ? { ok: false, codigo, error } : { ok: false, codigo, error, detalles };
}

export function enviarError(reply: FastifyReply, status: number, codigo: CodigoError, error: string, detalles?: CuerpoError['detalles']): FastifyReply {
  return reply.code(status).send(cuerpoError(codigo, error, detalles));
}

/** Codigos de mysql2/Node que significan "la base no contesta ahora", no "la consulta esta mal". */
const BASE_CAIDA = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_SEQUENCE_TIMEOUT',
  'ER_CON_COUNT_ERROR',
  'ER_SERVER_SHUTDOWN',
  'ER_LOCK_WAIT_TIMEOUT',
  'ER_LOCK_DEADLOCK',
  'ER_TOO_MANY_USER_CONNECTIONS',
  'POOL_CLOSED',
]);

/** Si el error viene de que la base de datos no esta disponible (503, reintentar), y no de un fallo propio (500). */
export function esBaseNoDisponible(error: unknown): boolean {
  const e = error as { code?: unknown; errno?: unknown; fatal?: unknown; message?: unknown } | null;
  if (!e || typeof e !== 'object') return false;
  if (typeof e.code === 'string' && BASE_CAIDA.has(e.code)) return true;
  if (e.fatal === true) return true;
  return typeof e.message === 'string' && /pool is closed|connect ETIMEDOUT|connection lost|Too many connections/i.test(e.message);
}

/** Segundos que se sugieren en Retry-After cuando la base no contesta. */
export const ESPERA_BASE_SEGUNDOS = 30;
