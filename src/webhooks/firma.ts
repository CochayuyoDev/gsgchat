/**
 * La firma de cada entrega.
 *
 * El otro sistema recibe un POST de internet y tiene que saber que viene de
 * aqui y no de cualquiera que conozca su URL. Se firma el cuerpo exacto con
 * el secreto del webhook (HMAC sha256) y se manda en `X-Firma`. La marca de
 * tiempo va dentro de lo firmado, para que una entrega capturada no se pueda
 * reenviar horas despues.
 *
 *   X-Firma: t=1726400000,v1=3f2a...
 *
 * Del otro lado, en PHP:
 *
 *   [$t, $v1] = sscanf($_SERVER['HTTP_X_FIRMA'], 't=%d,v1=%s');
 *   $esperada = hash_hmac('sha256', $t . '.' . file_get_contents('php://input'), $secreto);
 *   if (!hash_equals($esperada, $v1)) { http_response_code(401); exit; }
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const PREFIJO = 'whsec_';

/** Un secreto nuevo: "whsec_" y 48 caracteres hex. */
export function generarSecretoWebhook(): string {
  return PREFIJO + randomBytes(24).toString('hex');
}

export function firmar(secreto: string, cuerpo: string, marcaTiempoSeg: number): string {
  const v1 = createHmac('sha256', secreto).update(`${marcaTiempoSeg}.${cuerpo}`).digest('hex');
  return `t=${marcaTiempoSeg},v1=${v1}`;
}

/**
 * Comprueba una firma. Sirve para las pruebas y para quien integre en Node;
 * el sistema no recibe sus propios webhooks.
 */
export function verificarFirma(
  secreto: string,
  cuerpo: string,
  cabecera: string | undefined,
  opts: { ahoraSeg?: number; toleranciaSeg?: number } = {},
): boolean {
  if (!cabecera) return false;
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(cabecera.trim());
  if (!m) return false;
  const t = Number(m[1]);
  const ahora = opts.ahoraSeg ?? Math.floor(Date.now() / 1000);
  if (Math.abs(ahora - t) > (opts.toleranciaSeg ?? 5 * 60)) return false;
  const esperada = Buffer.from(createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest('hex'));
  const dada = Buffer.from(m[2]!);
  return esperada.length === dada.length && timingSafeEqual(esperada, dada);
}
