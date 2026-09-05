/**
 * Tokens firmados para las paginas de rastreo.
 *
 * Cada sesion de rastreo emite DOS tokens distintos: uno para quien publica
 * su posicion (el repartidor) y otro para quien la mira (el cliente). Que
 * sean distintos es lo que impide que quien recibe el link pueda falsear la
 * posicion, y permite caducar o revocar cada lado por separado.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export type TrackRole = 'publish' | 'view';

export interface TrackTokenPayload {
  linkId: string;
  role: TrackRole;
  /** Epoch en segundos. */
  exp: number;
}

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64url');

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function signTrackToken(payload: TrackTokenPayload, secret: string): string {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

export function verifyTrackToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): TrackTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [body, signature] = parts as [string, string];
  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  let payload: TrackTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TrackTokenPayload;
  } catch {
    return null;
  }

  if (!payload?.linkId || (payload.role !== 'publish' && payload.role !== 'view')) return null;
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now.getTime()) return null;

  return payload;
}

export interface TrackingUrls {
  linkId: string;
  publishUrl: string;
  viewUrl: string;
  expiresAt: Date;
}

export function buildTrackingUrls(
  linkId: string,
  expiresAt: Date,
  secret: string,
  baseUrl: string,
): TrackingUrls {
  const exp = Math.floor(expiresAt.getTime() / 1000);
  const base = baseUrl.replace(/\/+$/, '');
  return {
    linkId,
    publishUrl: `${base}/t/${signTrackToken({ linkId, role: 'publish', exp }, secret)}`,
    viewUrl: `${base}/t/${signTrackToken({ linkId, role: 'view', exp }, secret)}`,
    expiresAt,
  };
}
