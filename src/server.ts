/**
 * Montaje del servidor HTTP. Todas las dependencias entran por parametro
 * para que los tests puedan inyectar dobles sin base de datos ni Redis.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import type { Repos } from './db/repos.js';
import { WhatsAppApiError, type WhatsAppClient } from './whatsapp/client.js';
import { NotConfiguredError } from './whatsapp/dynamic.js';
import type { Sender } from './outbound/sender.js';
import type { OutboundQueue } from './outbound/queue.js';
import { registerWebhookRoutes } from './whatsapp/webhook.js';
import { registerWahaWebhookRoutes } from './whatsapp/waha/webhook.js';
import { registerTrackingRoutes } from './tracking/routes.js';
import { registerAdminRoutes } from './admin/routes.js';
import { registerWebRoutes } from './web/routes.js';
import type { SettingsService } from './settings/service.js';
import { TrackingHub } from './tracking/realtime.js';
import { TemplateRenderError } from './templates/render.js';

export interface ServerDeps {
  config: Config;
  repos: Repos;
  settings: SettingsService;
  wa: WhatsAppClient;
  sender: Sender;
  queue: OutboundQueue;
  logger?: boolean;
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { config, repos, wa, sender, queue, settings } = deps;

  const app = Fastify({
    logger: deps.logger ?? true,
    trustProxy: true,
    bodyLimit: 4 * 1024 * 1024,
    // Los tokens de rastreo van en el path y superan los 100 caracteres del
    // limite por defecto de Fastify, que devolvia 414 en todos los enlaces.
    routerOptions: { maxParamLength: 512 },
  });

  // El cuerpo crudo hace falta para validar la firma del webhook: si se
  // reserializa el JSON parseado, el HMAC ya no cuadra.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    (request as unknown as { rawBody: Buffer }).rawBody = body as Buffer;
    try {
      done(null, (body as Buffer).length ? JSON.parse((body as Buffer).toString('utf8')) : {});
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  // Errores con un mensaje que el panel pueda ensenar tal cual. Sin esto, un
  // cuerpo mal formado o la falta de credenciales salian como 500 generico.
  app.setErrorHandler((raw: unknown, request, reply) => {
    const error = raw instanceof Error ? raw : new Error(String(raw));
    if (error instanceof ZodError) {
      const detail = error.issues.map((i) => `${i.path.join('.') || 'cuerpo'}: ${i.message}`).join('; ');
      return reply.code(400).send({ error: `datos invalidos: ${detail}` });
    }
    if (error instanceof NotConfiguredError) {
      return reply.code(409).send({ error: error.message });
    }
    if (error instanceof WhatsAppApiError) {
      return reply
        .code(502)
        .send({ error: `Meta respondio: ${error.message}`, code: error.code, title: error.title });
    }
    if (error instanceof TemplateRenderError) {
      return reply.code(400).send({ error: error.message });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: error.message });
    }
    request.log.error({ err: error }, 'error no controlado');
    return reply.code(500).send({ error: 'error interno; revisa el log del servidor' });
  });

  // Nada de /admin se cachea. El chat pide el mismo hilo cada pocos
  // segundos y el navegador reutilizaba la primera respuesta: la pantalla se
  // quedaba congelada aunque el mensaje ya estuviera enviado.
  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/admin')) reply.header('cache-control', 'no-store');
  });

  await app.register(websocket);

  const hub = new TrackingHub({ tracking: repos.tracking });

  app.get('/health', async () => ({ ok: true, configured: settings.isConfigured() }));

  // El orden importa: registerAdminRoutes instala el hook que exige el token
  // en todo /admin, y debe estar antes de que se sirva cualquier ruta /admin.
  await registerWebhookRoutes(app, { repos, config, sender, wa, settings });
  // El endpoint de WAHA convive con el de Meta: cambiar de proveedor no obliga
  // a reiniciar, y cada uno valida su propia firma antes de mirar el cuerpo.
  await registerWahaWebhookRoutes(app, {
    repos,
    config,
    sender,
    wa,
    settings,
    hmacKey: () => settings.current().verifyToken,
  });
  await registerTrackingRoutes(app, { repos, config, hub, settings });
  await registerAdminRoutes(app, {
    repos,
    config,
    queue,
    sender,
    settings,
    wa,
    hub,
    adminToken: config.ADMIN_TOKEN,
  });
  await registerWebRoutes(app, { config, settings, wa, sender, repos });

  return app;
}
