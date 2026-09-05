/**
 * Verificacion de la firma de los webhooks de Meta.
 *
 * Sin esto el endpoint acepta payloads de cualquiera: alguien podria
 * inventarse mensajes entrantes, marcar entregas como leidas o forzar
 * altas de contactos. La comparacion es en tiempo constante a proposito.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

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
  if (mode === 'subscribe' && token === verifyToken && typeof challenge === 'string') {
    return challenge;
  }
  return null;
}
