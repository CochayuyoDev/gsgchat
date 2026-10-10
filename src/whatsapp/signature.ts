/**
 * Verificacion de la firma de los webhooks de Meta.
 *
 * Sin esto el endpoint acepta payloads de cualquiera: alguien podria
 * inventarse mensajes entrantes, marcar entregas como leidas o forzar
 * altas de contactos. La comparacion es en tiempo constante a proposito.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { igualSeguro } from '../util/comparar.js';

const PREFIX = 'sha256=';

export function signPayload(rawBody: Buffer | string, appSecret: string): string {
  const hmac = createHmac('sha256', appSecret);
  hmac.update(rawBody);
  return PREFIX + hmac.digest('hex');
}

export function verifySignature(
  rawBody: Buffer | string,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!header || !header.startsWith(PREFIX)) return false;

  const expected = Buffer.from(signPayload(rawBody, appSecret));
  const received = Buffer.from(header);

  // timingSafeEqual exige la misma longitud; si difiere, ya no coincide.
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

/**
 * Handshake GET del webhook: Meta llama una vez con el verify token y
 * espera que le devuelvas el challenge tal cual.
 */
export function verifyChallenge(
  query: Record<string, unknown>,
  verifyToken: string,
): string | null {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  // Sin verify token configurado no se suscribe nadie: antes, con el ajuste
  // vacio, un `hub.verify_token=` vacio pasaba el handshake.
  if (mode === 'subscribe' && igualSeguro(token, verifyToken) && typeof challenge === 'string' && challenge.length <= 200) {
    return challenge;
  }
  return null;
}

/**
 * Firma de los webhooks de WAHA.
 *
 * WAHA firma distinto que Meta: sha512 en hexadecimal pelado, en la cabecera
 * `X-Webhook-Hmac`, sin el prefijo `sha512=`. Se comprueba igual de estricto
 * porque el endpoint tiene las mismas consecuencias: quien pueda falsificarlo
 * puede inventarse mensajes entrantes y dar de alta contactos.
 */
export function signWahaPayload(rawBody: Buffer | string, key: string): string {
  const hmac = createHmac('sha512', key);
  hmac.update(rawBody);
  return hmac.digest('hex');
}

export function verifyWahaSignature(
  rawBody: Buffer | string,
  header: string | undefined,
  key: string,
): boolean {
  if (!header) return false;

  const expected = Buffer.from(signWahaPayload(rawBody, key));
  const received = Buffer.from(header.trim().toLowerCase());

  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}
