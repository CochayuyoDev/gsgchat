/**
 * Endpoint del webhook de WAHA.
 *
 * Traduce los eventos de WAHA a la misma forma que ya consume el sistema
 * (`ChangeValue`) y los mete por `processChange`. Asi el geo core, las reglas,
 * las secuencias, el chat y la deduplicacion funcionan igual vengan de Meta o
 * de WAHA: lo unico que cambia es el traductor.
 *
 * Las tres reglas del endpoint de Meta valen aqui igual: firma antes de mirar
 * el contenido, 200 inmediato y trabajo despues, y deduplicar por id.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { verifyWahaSignature } from '../signature.js';
import { processChange, createSeenCache, type WebhookDeps } from '../webhook.js';
import type { ChangeValue, InboundMessage, StatusUpdate } from '../types.js';
import { fromChatId } from './client.js';

type RawRequest = FastifyRequest & { rawBody?: Buffer };

/** Lo que manda WAHA en cada entrega. */
export interface WahaEvent {
  event?: string;
  session?: string;
  payload?: Record<string, unknown>;
}

/** Los acks de WAHA son numeros; el sistema los guarda con el nombre de Meta. */
export function ackToStatus(ack: unknown): StatusUpdate['status'] | null {
  switch (Number(ack)) {
    case 1:
      return 'sent';
    case 2:
      return 'delivered';
    case 3:
    case 4:
      return 'read';
    case -1:
      return 'failed';
    default:
      return null;
  }
}

function texto(payload: Record<string, unknown>): string {
  const body = payload.body;
  return typeof body === 'string' ? body : '';
}

/**
 * Un evento de WAHA en la forma que ya entiende `processChange`.
 *
 * Devuelve null para lo que no interesa (reacciones, presencia, llamadas): el
 * sistema no las trata y traducirlas seria inventar.
 */
export function toChangeValue(event: WahaEvent): ChangeValue | null {
  const payload = event.payload ?? {};

  if (event.event === 'message') {
    // `fromMe` llega en los eventos `message.any`; si se colara uno propio,
    // procesarlo seria contestarse a si mismo.
    if (payload.fromMe === true) return null;

    const from = typeof payload.from === 'string' ? fromChatId(payload.from) : '';
    const id = typeof payload.id === 'string' ? payload.id : '';
    if (!from || !id) return null;

    const location = payload.location as
      | { latitude?: number; longitude?: number; name?: string; address?: string }
      | undefined;

    const message: InboundMessage = {
      id,
      from,
      timestamp: String(payload.timestamp ?? Math.floor(Date.now() / 1000)),
      type: location ? 'location' : payload.hasMedia === true ? 'image' : 'text',
      ...(location?.latitude !== undefined && location?.longitude !== undefined
        ? {
            location: {
              latitude: Number(location.latitude),
              longitude: Number(location.longitude),
              name: location.name,
              address: location.address,
            },
          }
        : { text: { body: texto(payload) } }),
    };

    const nombre = typeof payload.notifyName === 'string' ? payload.notifyName : undefined;

    return {
      messages: [message],
      ...(nombre ? { contacts: [{ profile: { name: nombre }, wa_id: from }] } : {}),
    };
  }

  if (event.event === 'message.ack') {
    const status = ackToStatus(payload.ack);
    const id = typeof payload.id === 'string' ? payload.id : '';
    if (!status || !id) return null;

    return {
      statuses: [
        {
          id,
          status,
          timestamp: String(payload.timestamp ?? Math.floor(Date.now() / 1000)),
          recipient_id: typeof payload.to === 'string' ? fromChatId(payload.to) : '',
        },
      ],
    };
  }

  return null;
}

export interface WahaWebhookDeps extends WebhookDeps {
  /** Clave del HMAC; la misma que se le dio a la sesion al crearla. */
  hmacKey: () => string;
}

export async function registerWahaWebhookRoutes(
  app: FastifyInstance,
  deps: WahaWebhookDeps,
): Promise<void> {
  const withSeen: WebhookDeps = { ...deps, seen: deps.seen ?? createSeenCache() };

  app.post('/webhooks/waha', async (request, reply) => {
    const raw = (request as RawRequest).rawBody ?? Buffer.from(JSON.stringify(request.body ?? {}));
    const signature = request.headers['x-webhook-hmac'];

    const key = deps.hmacKey();
    if (!key) {
      request.log.error('webhook de WAHA sin clave HMAC configurada: revisa /setup');
      return reply.code(503).send('not configured');
    }

    if (!verifyWahaSignature(raw, typeof signature === 'string' ? signature : undefined, key)) {
      request.log.warn('webhook de WAHA con firma invalida');
      return reply.code(401).send('invalid signature');
    }

    void reply.code(200).send('ok');

    const event = request.body as WahaEvent;
    setImmediate(() => {
      void (async () => {
        const value = toChangeValue(event);
        if (!value) return;
        await processChange('messages', value, withSeen);
      })().catch((error) => {
        request.log.error({ err: error }, 'fallo procesando el webhook de WAHA');
      });
    });
  });
}
