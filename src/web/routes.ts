/**
 * Rutas de la interfaz web: las paginas y los endpoints que consumen.
 *
 * Las paginas HTML son publicas pero van vacias; todo dato real se pide con
 * el token de administracion desde el navegador.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { FIELD_LABELS, type CredentialField, type SettingsService } from '../settings/service.js';
import { checkConnection } from '../whatsapp/dynamic.js';
import { panelPage, setupPage } from './pages.js';

export interface WebDeps {
  config: Config;
  settings: SettingsService;
}

const credentialsSchema = z.object({
  token: z.string().optional(),
  phoneNumberId: z.string().optional(),
  businessAccountId: z.string().optional(),
  appSecret: z.string().optional(),
  verifyToken: z.string().optional(),
  mapsApiKey: z.string().optional(),
});

export async function registerWebRoutes(app: FastifyInstance, deps: WebDeps): Promise<void> {
  const { config, settings } = deps;
  const webhookUrl = `${config.PUBLIC_BASE_URL.replace(/\/+$/, '')}/webhooks/whatsapp`;

  const html = (body: string) => ({ body, type: 'text/html; charset=utf-8' });

  app.get('/', async (_request, reply) => reply.redirect(settings.isConfigured() ? '/panel' : '/setup'));

  app.get('/setup', async (_request, reply) => {
    const page = html(setupPage(FIELD_LABELS));
    return reply.type(page.type).header('cache-control', 'no-store').send(page.body);
  });

  app.get('/panel', async (_request, reply) => {
    const page = html(panelPage(settings.isConfigured()));
    return reply.type(page.type).header('cache-control', 'no-store').send(page.body);
  });

  // --- datos de configuracion (detras del token de admin) ---------------
  app.get('/admin/settings', async () => ({
    masked: settings.masked(),
    missing: settings.missing(),
    labels: FIELD_LABELS,
    webhookUrl,
    verifyToken: settings.current().verifyToken,
    configured: settings.isConfigured(),
  }));

  /** Guarda y prueba. Solo llegan los campos que el usuario relleno. */
  app.post('/admin/settings', async (request) => {
    const body = credentialsSchema.parse(request.body ?? {});
    await settings.save(body as Partial<Record<CredentialField, string>>);
    await settings.reload();

    const current = settings.current();
    const check = await checkConnection({
      token: current.token,
      phoneNumberId: current.phoneNumberId,
      businessAccountId: current.businessAccountId,
      graphVersion: current.graphVersion,
    });

    return { ...check, missing: settings.missing(), saved: true };
  });

  /** Prueba sin guardar: los campos vacios caen a lo ya almacenado. */
  app.post('/admin/settings/test', async (request) => {
    const body = credentialsSchema.parse(request.body ?? {});
    const current = settings.current();

    const check = await checkConnection({
      token: body.token?.trim() || current.token,
      phoneNumberId: body.phoneNumberId?.trim() || current.phoneNumberId,
      businessAccountId: body.businessAccountId?.trim() || current.businessAccountId,
      graphVersion: current.graphVersion,
    });

    return { ...check, saved: false };
  });
}
