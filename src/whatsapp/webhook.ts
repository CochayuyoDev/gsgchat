/**
 * Endpoint del webhook de Meta.
 *
 * Dos reglas que no son negociables:
 *  - se valida la firma antes de mirar el contenido;
 *  - se responde 200 de inmediato y se procesa despues. Meta reintenta y
 *    acaba desuscribiendo el webhook si tardas; procesar dentro del request
 *    es como se pierden mensajes en produccion.
 *
 * Y una tercera que evita respuestas dobles: Meta reintenta entregas que
 * cree perdidas, asi que el mismo mensaje puede llegar dos veces. Cada id
 * se recuerda un rato y la repeticion se ignora.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import type { Repos, TemplateQuality, TemplateStatus } from '../db/repos.js';
import { verifyChallenge, verifySignature } from './signature.js';
import type { ChangeValue, WebhookPayload } from './types.js';
import { handleInboundMessage, type InboundDeps } from '../handlers/inbound.js';
import type { SettingsService } from '../settings/service.js';
import { TtlCache } from '../util/cache.js';

export interface WebhookDeps extends InboundDeps {
  repos: Repos;
  config: Config;
  settings: SettingsService;
  /** Ids de mensajes ya procesados; si falta, no se deduplica. */
  seen?: TtlCache<true>;
}

type RawRequest = FastifyRequest & { rawBody?: Buffer };

/** Motivo con el que el sistema pausa solo; se usa para reanudar solo eso. */
export const AUTO_PAUSE_REASON = 'calidad en ROJO reportada por Meta';

export function createSeenCache(): TtlCache<true> {
  // Meta reintenta durante horas como mucho; 24 h y 20.000 ids cubren de sobra.
  return new TtlCache<true>(24 * 60 * 60 * 1000, 20_000);
}

export async function registerWebhookRoutes(
  app: FastifyInstance,
  deps: WebhookDeps,
): Promise<void> {
  const { settings } = deps;
  const withSeen: WebhookDeps = { ...deps, seen: deps.seen ?? createSeenCache() };

  // Handshake de verificacion.
  app.get('/webhooks/whatsapp', async (request, reply) => {
    const challenge = verifyChallenge(
      request.query as Record<string, unknown>,
      settings.current().verifyToken,
    );
    if (!challenge) return reply.code(403).send('forbidden');
    return reply.type('text/plain').send(challenge);
  });

  app.post('/webhooks/whatsapp', async (request, reply) => {
    const raw = (request as RawRequest).rawBody ?? Buffer.from(JSON.stringify(request.body ?? {}));
    const signature = request.headers['x-hub-signature-256'];

    const appSecret = settings.current().appSecret;
    if (!appSecret) {
      request.log.error('webhook recibido sin app secret configurado: revisa /setup');
      return reply.code(503).send('not configured');
    }

    if (!verifySignature(raw, typeof signature === 'string' ? signature : undefined, appSecret)) {
      request.log.warn('webhook con firma invalida');
      return reply.code(401).send('invalid signature');
    }

    // 200 primero, trabajo despues.
    void reply.code(200).send('ok');

    const payload = request.body as WebhookPayload;
    setImmediate(() => {
      void processPayload(payload, withSeen).catch((error) => {
        request.log.error({ err: error }, 'fallo procesando el webhook');
      });
    });
  });
}

export async function processPayload(payload: WebhookPayload, deps: WebhookDeps): Promise<void> {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      await processChange(change.field, change.value, deps);
    }
  }
}

/**
 * Traduce el evento de calidad del numero a un semaforo.
 *
 * El payload real de `phone_number_quality_update` no trae el color: trae
 * `event` = FLAGGED (el numero paso a rojo), UNFLAGGED (volvio a verde),
 * DOWNGRADE / UPGRADE (cambio de tier, que Meta solo baja cuando la calidad
 * flaquea) u ONBOARDING. Se admite ademas el color literal por si Meta lo
 * incluye en el futuro o alguien lo manda a mano.
 */
export function qualityFromEvent(event: string | undefined): 'GREEN' | 'YELLOW' | 'RED' | null {
  const value = (event ?? '').toUpperCase();
  if (!value) return null;
  if (value.includes('RED')) return 'RED';
  if (value.includes('YELLOW')) return 'YELLOW';
  if (value.includes('GREEN')) return 'GREEN';
  if (value.includes('UNFLAG')) return 'GREEN';
  if (value.includes('FLAG')) return 'RED';
  if (value.includes('DOWNGRADE')) return 'YELLOW';
  if (value.includes('UPGRADE')) return 'GREEN';
  return null;
}

export async function processChange(
  field: string,
  value: ChangeValue,
  deps: WebhookDeps,
): Promise<void> {
  const { repos, settings, seen } = deps;
  const phoneNumberId = settings.current().phoneNumberId;

  switch (field) {
    case 'messages': {
      for (const status of value.statuses ?? []) {
        await repos.deliveries.updateByWamid(status.id, status.status, {
          code: status.errors?.[0]?.code ? String(status.errors[0].code) : undefined,
          title: status.errors?.[0]?.title,
        });
        // El doble check del chat sale de aqui.
        await repos.messages.setStatusByWamid(status.id, status.status);
      }

      const profileName = value.contacts?.[0]?.profile?.name;
      for (const message of value.messages ?? []) {
        if (seen && message.id) {
          if (seen.get(message.id)) continue;
          seen.set(message.id, true);
        }
        await handleInboundMessage(message, profileName, deps);
      }
      return;
    }

    // Una plantilla rechazada o deshabilitada sale de circulacion sola.
    case 'message_template_status_update': {
      const name = value.message_template_name;
      const language = value.message_template_language;
      if (!name || !language) return;
      const status = (value.event ?? '').toUpperCase();
      const mapped: TemplateStatus =
        status.includes('APPROVE') ? 'APPROVED'
        : status.includes('REJECT') ? 'REJECTED'
        : status.includes('PAUSE') ? 'PAUSED'
        : status.includes('DISABLE') ? 'DISABLED'
        : 'PENDING';
      await repos.templates.setStatus(name, language, mapped);
      return;
    }

    // Amarillo en una plantilla es el aviso previo a que Meta la pause.
    case 'message_template_quality_update': {
      const name = value.message_template_name;
      const language = value.message_template_language;
      if (!name || !language) return;
      const quality = (value.new_quality_score ?? '').toUpperCase();
      const mapped: TemplateQuality =
        quality === 'GREEN' || quality === 'YELLOW' || quality === 'RED' ? quality : 'UNKNOWN';
      await repos.templates.setQuality(name, language, mapped);
      return;
    }

    // Circuit breaker del numero: en rojo se pausa todo lo saliente y, cuando
    // Meta lo levanta, se reanuda solo si fue el sistema quien pauso.
    case 'phone_number_quality_update': {
      if (value.current_limit) {
        await repos.numberState.setTier(phoneNumberId, value.current_limit);
      }
      const mapped = qualityFromEvent(value.event);
      if (!mapped) return;

      await repos.numberState.setQuality(phoneNumberId, mapped);
      if (mapped === 'RED') {
        await repos.numberState.setPaused(phoneNumberId, true, AUTO_PAUSE_REASON);
        return;
      }
      const state = await repos.numberState.get(phoneNumberId);
      if (state.paused && state.pausedReason === AUTO_PAUSE_REASON) {
        await repos.numberState.setPaused(phoneNumberId, false);
      }
      return;
    }

    default:
      return;
  }
}
