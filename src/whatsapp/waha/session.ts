/**
 * Ciclo de vida de una sesion de WAHA: crear, arrancar, sacar el QR y saber
 * en que estado esta.
 *
 * Estados que devuelve WAHA:
 *
 *   STOPPED → STARTING → SCAN_QR_CODE → WORKING
 *                            │
 *                            └─ FAILED (o PASSKEY_REQUIRED en el motor GOWS)
 *
 * La pantalla de /setup pregunta el estado cada pocos segundos y, mientras sea
 * SCAN_QR_CODE, enseña el QR. En cuanto pasa a WORKING deja de preguntar.
 *
 * El webhook se configura al crear la sesion, no suscribiendo una app como en
 * Meta: por eso `ensureSession` manda la URL y la clave del HMAC.
 */

import { DEFAULT_SESSION } from './client.js';

export type WahaStatus =
  | 'STOPPED'
  | 'STARTING'
  | 'SCAN_QR_CODE'
  | 'WORKING'
  | 'FAILED'
  | 'PASSKEY_REQUIRED'
  | 'PASSKEY_CONFIRMATION_REQUIRED';

export class WahaError extends Error {
  constructor(
    message: string,
    readonly step: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'WahaError';
  }
}

export interface WahaConnection {
  baseUrl: string;
  apiKey?: string;
  session?: string;
  fetchImpl?: typeof fetch;
}

export interface SessionInfo {
  name: string;
  status: WahaStatus;
  /** Numero conectado, cuando ya lo hay. `null` si la sesion no esta lista. */
  me?: { id?: string; pushName?: string } | null;
  config?: { webhooks?: Array<{ url?: string; hmac?: { key?: string } }> };
}

function headers(conn: WahaConnection): Record<string, string> {
  const out: Record<string, string> = { 'content-type': 'application/json' };
  if (conn.apiKey) out['X-Api-Key'] = conn.apiKey;
  return out;
}

async function request(
  conn: WahaConnection,
  path: string,
  step: string,
  init: RequestInit = {},
): Promise<Response> {
  const base = conn.baseUrl.replace(/\/+$/, '');
  const doFetch = conn.fetchImpl ?? fetch;
  try {
    return await doFetch(`${base}${path}`, { ...init, headers: headers(conn) });
  } catch (error) {
    throw new WahaError(
      `no se pudo contactar con WAHA en ${base}: ${error instanceof Error ? error.message : String(error)}`,
      step,
    );
  }
}

async function json<T>(response: Response, step: string): Promise<T> {
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    const detail =
      (typeof payload.message === 'string' && payload.message) ||
      (typeof payload.error === 'string' && payload.error) ||
      `HTTP ${response.status}`;
    throw new WahaError(detail, step, response.status);
  }
  return payload as T;
}

/** Estado actual, o null si la sesion todavia no existe. */
export async function getSession(conn: WahaConnection): Promise<SessionInfo | null> {
  const name = conn.session || DEFAULT_SESSION;
  const response = await request(
    conn,
    `/api/sessions/${encodeURIComponent(name)}`,
    'consultar la sesion',
    { method: 'GET' },
  );
  if (response.status === 404) return null;
  return json<SessionInfo>(response, 'consultar la sesion');
}

/**
 * Si la sesion ya manda sus eventos a donde toca y con la misma clave.
 *
 * Se compara para no mandar un PUT que reiniciaria la sesion sin necesidad.
 */
export function webhookYaApunta(
  session: SessionInfo,
  webhookUrl: string,
  hmacKey: string,
): boolean {
  return (session.config?.webhooks ?? []).some(
    (hook) => hook.url === webhookUrl && hook.hmac?.key === hmacKey,
  );
}

export interface EnsureSessionInput extends WahaConnection {
  /** A donde manda WAHA los mensajes entrantes. */
  webhookUrl: string;
  /** Clave del HMAC con el que firma ese webhook. */
  hmacKey: string;
  /** WEBJS | NOWEB | GOWS | WPP. Vacio = el que traiga el contenedor. */
  engine?: string;
}

/**
 * Deja la sesion creada y arrancada, con su webhook apuntando aqui.
 *
 * Es idempotente a proposito: si la sesion ya existe se le actualiza la
 * configuracion en vez de fallar, porque la pantalla llama a esto cada vez que
 * el usuario le da a conectar.
 */
export async function ensureSession(input: EnsureSessionInput): Promise<SessionInfo> {
  const name = input.session || DEFAULT_SESSION;
  const config = {
    webhooks: [
      {
        url: input.webhookUrl,
        // `message` trae lo que escribe el cliente; `message.ack` es el doble
        // check; `session.status` avisa de la desconexion del telefono.
        events: ['message', 'message.ack', 'session.status'],
        hmac: { key: input.hmacKey },
      },
    ],
    ...(input.engine ? { engine: input.engine } : {}),
  };

  const existing = await getSession(input);

  if (!existing) {
    const created = await request(input, '/api/sessions', 'crear la sesion', {
      method: 'POST',
      body: JSON.stringify({ name, start: true, config }),
    });
    return json<SessionInfo>(created, 'crear la sesion');
  }

  // Ya existe. Actualizar NO es gratis: WAHA para y arranca la sesion cuando
  // recibe un PUT y no estaba en STOPPED, asi que hacerlo siempre tumbaria una
  // sesion que ya funciona cada vez que el usuario pulsa "conectar". Solo se
  // actualiza si el webhook realmente cambio (tunel nuevo, otra clave).
  if (!webhookYaApunta(existing, input.webhookUrl, input.hmacKey)) {
    const updated = await request(
      input,
      `/api/sessions/${encodeURIComponent(name)}`,
      'actualizar la sesion',
      { method: 'PUT', body: JSON.stringify({ name, config }) },
    );
    await json<unknown>(updated, 'actualizar la sesion');
  }

  if (existing.status === 'STOPPED' || existing.status === 'FAILED') {
    const started = await request(
      input,
      `/api/sessions/${encodeURIComponent(name)}/start`,
      'arrancar la sesion',
      { method: 'POST' },
    );
    await json<unknown>(started, 'arrancar la sesion');
  }

  return (await getSession(input)) ?? { name, status: 'STARTING' };
}

/**
 * El QR en base64, listo para un `<img src="data:image/png;base64,...">`.
 *
 * Solo tiene sentido en SCAN_QR_CODE; en cualquier otro estado WAHA responde
 * un error y aqui se devuelve null para que la pantalla no pinte un hueco.
 */
export async function getQrCode(conn: WahaConnection): Promise<string | null> {
  const name = conn.session || DEFAULT_SESSION;
  const response = await request(
    conn,
    `/api/${encodeURIComponent(name)}/auth/qr?format=image`,
    'pedir el codigo QR',
    { method: 'GET' },
  );
  if (!response.ok) return null;

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) return null;
  return buffer.toString('base64');
}

/** Cierra la sesion y borra la vinculacion: obliga a escanear otro QR. */
export async function logoutSession(conn: WahaConnection): Promise<void> {
  const name = conn.session || DEFAULT_SESSION;
  const response = await request(
    conn,
    `/api/sessions/${encodeURIComponent(name)}/logout`,
    'cerrar la sesion',
    { method: 'POST' },
  );
  await json<unknown>(response, 'cerrar la sesion');
}
