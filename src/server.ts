/**
 * Montaje del servidor HTTP. Todas las dependencias entran por parametro
 * para que los tests puedan inyectar dobles sin base de datos ni Redis.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { Config } from './config.js';
import type { Repos } from './db/repos.js';
import type { WhatsAppClient } from './whatsapp/client.js';
import type { Sender } from './outbound/sender.js';
import type { OutboundQueue } from './outbound/queue.js';
import { registerWebhookRoutes } from './whatsapp/webhook.js';
import { registerTrackingRoutes } from './tracking/routes.js';
import { registerAdminRoutes } from './admin/routes.js';
import { registerWebRoutes } from './web/routes.js';
import type { SettingsService } from './settings/service.js';
import { TrackingHub } from './tracking/realtime.js';

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
    bodyLimit: 2 * 1024 * 1024,
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

  await app.register(websocket);

  const hub = new TrackingHub({ tracking: repos.tracking });

  app.get('/health', async () => ({ ok: true, configured: settings.isConfigured() }));

  // El orden importa: registerAdminRoutes instala el hook que exige el token
  // en todo /admin, y debe estar antes de que se sirva cualquier ruta /admin.
  await registerWebhookRoutes(app, { repos, config, sender, wa, settings });
  await registerTrackingRoutes(app, { repos, config, hub, settings });
  await registerAdminRoutes(app, {
    repos,
    config,
    queue,
    sender,
    settings,
    adminToken: config.ADMIN_TOKEN,
  });
  await registerWebRoutes(app, { config, settings });

  return app;
}
