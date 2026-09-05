/**
 * Endpoint del webhook de Meta.
 *
 * Dos reglas que no son negociables:
 *  - se valida la firma antes de mirar el contenido;
 *  - se responde 200 de inmediato y se procesa despues. Meta reintenta y
 *    acaba desuscribiendo el webhook si tardas; procesar dentro del request
 *    es como se pierden mensajes en produccion.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import type { Repos, TemplateQuality, TemplateStatus } from '../db/repos.js';
import { verifyChallenge, verifySignature } from './signature.js';
import type { ChangeValue, WebhookPayload } from './types.js';
import { handleInboundMessage, type InboundDeps } from '../handlers/inbound.js';
import type { SettingsService } from '../settings/service.js';

export interface WebhookDeps extends InboundDeps {
  repos: Repos;
  config: Config;
  settings: SettingsService;
}

type RawRequest = FastifyRequest & { rawBody?: Buffer };

export async function registerWebhookRoutes(
  app: FastifyInstance,
  deps: WebhookDeps,
): Promise<void> {
  const { repos, settings } = deps;

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
      void processPayload(payload, deps).catch((error) => {
        request.log.error({ err: error }, 'fallo procesando el webhook');
      });
    });
  });

  void repos;
}

export async function processPayload(payload: WebhookPayload, deps: WebhookDeps): Promise<void> {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      await processChange(change.field, change.value, deps);
    }
  }
}

export async function processChange(
  field: string,
  value: ChangeValue,
  deps: WebhookDeps,
): Promise<void> {
  const { repos, settings } = deps;
  const phoneNumberId = settings.current().phoneNumberId;

  switch (field) {
    case 'messages': {
      for (const status of value.statuses ?? []) {
        await repos.deliveries.updateByWamid(status.id, status.status, {
          code: status.errors?.[0]?.code ? String(status.errors[0].code) : undefined,
          title: status.errors?.[0]?.title,
        });
      }

      const profileName = value.contacts?.[0]?.profile?.name;
      for (const message of value.messages ?? []) {
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

    // Circuit breaker del numero: en rojo se pausa todo lo saliente.
    case 'phone_number_quality_update': {
      const quality = (value.event ?? value.current_limit ?? '').toUpperCase();
      const mapped =
        quality.includes('RED') ? 'RED' : quality.includes('YELLOW') ? 'YELLOW' : 'GREEN';
      await repos.numberState.setQuality(phoneNumberId, mapped);
      if (mapped === 'RED') {
        await repos.numberState.setPaused(
          phoneNumberId,
          true,
          'calidad en ROJO reportada por Meta',
        );
      }
      return;
    }

    default:
      return;
  }
}
