/**
 * Rutas de la interfaz web: las paginas y los endpoints que consumen.
 *
 * Las paginas HTML son publicas pero van vacias; todo dato real se pide con
 * el token de administracion desde el navegador.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { normalizePhone, type Repos } from '../db/repos.js';
import type { Sender } from '../outbound/sender.js';
import {
  FIELD_LABELS,
  providerOf,
  type CredentialField,
  type SettingsService,
} from '../settings/service.js';
import { syncTemplates } from '../templates/registry.js';
import type { WhatsAppClient } from '../whatsapp/client.js';
import { checkConnection } from '../whatsapp/dynamic.js';
import { panelPage } from './pages.js';
import { connectPage } from './connect-page.js';
import { chatPage } from './chat-page.js';
import { registerConnectRoutes } from './connect-routes.js';
import { registerDevRoutes } from './dev-routes.js';
import { registerLocalRoutes } from './local-routes.js';
import { registerWahaRoutes } from './waha-routes.js';

export interface WebDeps {
  config: Config;
  settings: SettingsService;
  wa: WhatsAppClient;
  sender: Sender;
  repos: Repos;
}

/**
 * Campos que /admin/settings acepta.
 *
 * Zod descarta en silencio lo que no este aqui, asi que un campo que falte no
 * da error: simplemente no se guarda nunca. Le pasaba a `signupConfigId`, y
 * por eso el boton de conexion rapida no llegaba a activarse desde la web.
 */
const credentialsSchema = z.object({
  token: z.string().optional(),
  phoneNumberId: z.string().optional(),
  businessAccountId: z.string().optional(),
  appId: z.string().optional(),
  signupConfigId: z.string().optional(),
  appSecret: z.string().optional(),
  verifyToken: z.string().optional(),
  mapsApiKey: z.string().optional(),
  provider: z.enum(['cloud', 'waha', 'local']).optional(),
  wahaUrl: z.string().optional(),
  wahaApiKey: z.string().optional(),
  wahaSession: z.string().optional(),
  wahaEngine: z.string().optional(),
});

/** Plantilla que Meta crea en toda cuenta nueva: sirve para la primera prueba. */
const TEST_TEMPLATE = { name: 'hello_world', language: 'en_US' };

export async function registerWebRoutes(app: FastifyInstance, deps: WebDeps): Promise<void> {
  const { config, settings, wa, sender, repos } = deps;
  const publicBase = config.PUBLIC_BASE_URL.replace(/\/+$/, '');
  // Cada proveedor tiene su endpoint: la pantalla debe enseñar el del activo,
  // porque es la direccion que hay que pegar en Meta o darle a WAHA.
  const webhookUrlFor = () =>
    providerOf(settings.current()) === 'waha'
      ? `${publicBase}/webhooks/waha`
      : `${publicBase}/webhooks/whatsapp`;

  const html = (body: string) => ({ body, type: 'text/html; charset=utf-8' });

  // Con ADMIN_TOKEN_AUTOFILL las pantallas traen el token puesto y no lo piden.
  // Ver el porque en config.ts; en un servidor accesible desde fuera va vacio.
  const tokenParaLaPagina = () => (config.ADMIN_TOKEN_AUTOFILL ? config.ADMIN_TOKEN : '');

  // Conectado, lo primero que se quiere ver son los chats.
  app.get('/', async (_request, reply) => reply.redirect(settings.isConfigured() ? '/chat' : '/setup'));

  app.get('/setup', async (_request, reply) => {
    const page = html(connectPage(FIELD_LABELS, tokenParaLaPagina()));
    return reply.type(page.type).header('cache-control', 'no-store').send(page.body);
  });

  app.get('/chat', async (_request, reply) => {
    const page = html(chatPage(settings.isConfigured(), tokenParaLaPagina()));
    return reply.type(page.type).header('cache-control', 'no-store').send(page.body);
  });

  await registerConnectRoutes(app, { config, settings, wa });
  await registerWahaRoutes(app, { config, settings });
  await registerLocalRoutes(app, { config, repos, sender, wa, settings });
  await registerDevRoutes(app, { config, repos, sender, wa, settings });

  app.get('/panel', async (_request, reply) => {
    const page = html(panelPage(settings.isConfigured(), tokenParaLaPagina()));
    return reply.type(page.type).header('cache-control', 'no-store').send(page.body);
  });

  // --- datos de configuracion (detras del token de admin) ---------------
  app.get('/admin/settings', async () => ({
    masked: settings.masked(),
    missing: settings.missing(),
    labels: FIELD_LABELS,
    webhookUrl: webhookUrlFor(),
    verifyToken: settings.current().verifyToken,
    configured: settings.isConfigured(),
  }));

  /** Guarda y prueba. Solo llegan los campos que el usuario relleno. */
  app.post('/admin/settings', async (request) => {
    const body = credentialsSchema.parse(request.body ?? {});
    await settings.save(body as Partial<Record<CredentialField, string>>);
    await settings.reload();

    const current = settings.current();

    // `checkConnection` habla con la Graph API: con WAHA no hay nada que
    // preguntar ahi, y hacerlo reportaria un fallo que no existe.
    if (providerOf(current) === 'waha') {
      const missing = settings.missing();
      return {
        ok: missing.length === 0,
        detail: missing.length ? `faltan datos: ${missing.join(', ')}` : 'guardado',
        missing,
        saved: true,
      };
    }

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

  // --- conexion de la cuenta -------------------------------------------

  /**
   * Radiografia de la conexion: credenciales, numero (calidad y tier) y si
   * la app esta suscrita a la cuenta de negocio. Es lo que hay que mirar
   * cuando "no llegan los mensajes".
   */
  app.get('/admin/settings/status', async () => {
    const current = settings.current();
    const missing = settings.missing();

    const status: Record<string, unknown> = {
      ok: false,
      detail: missing.length ? `faltan datos: ${missing.join(', ')}` : 'credenciales validas',
      missing,
      webhookUrl: webhookUrlFor(),
      verifyTokenSet: Boolean(current.verifyToken),
      appSecretSet: Boolean(current.appSecret),
      subscribed: null,
      apps: [],
      phone: null,
    };
    if (missing.length) return status;

    // Se pregunta con el mismo cliente que usa el resto del sistema, no con
    // un fetch aparte: si aqui responde, los envios tambien deberian.
    try {
      const phone = await wa.getPhoneNumber();
      status.phone = phone;
      status.ok = true;
      status.displayName = phone.verifiedName;
      status.phoneNumber = phone.displayPhoneNumber;
    } catch (error) {
      status.detail = error instanceof Error ? error.message : String(error);
      status.phoneError = status.detail;
      return status;
    }
    try {
      const apps = await wa.listSubscribedApps();
      status.apps = apps;
      status.subscribed = apps.length > 0;
    } catch (error) {
      status.subscribedError = error instanceof Error ? error.message : String(error);
    }
    return status;
  });

  app.post('/admin/settings/subscribe', async () => {
    const result = await wa.subscribeApp();
    const apps = await wa.listSubscribedApps();
    return { ...result, apps, subscribed: apps.length > 0 };
  });

  app.post('/admin/settings/register', async (request) => {
    const body = z
      .object({ pin: z.string().regex(/^\d{6}$/, 'el PIN son 6 digitos') })
      .parse(request.body ?? {});
    return wa.registerPhone(body.pin);
  });

  /**
   * Manda la plantilla hello_world al telefono del operador. Pasa por las
   * mismas guardas que cualquier envio: el numero de prueba queda con opt-in
   * (origen "numero de prueba del operador") para que el gate lo deje pasar.
   */
  app.post('/admin/settings/test-message', async (request) => {
    const body = z.object({ phone: z.string().min(6) }).parse(request.body ?? {});
    const phone = normalizePhone(body.phone);

    // Trae el catalogo real para que hello_world este en el registro local
    // con su categoria de verdad; si Meta no responde, se intenta igual.
    let syncError: string | null = null;
    try {
      await syncTemplates(wa, repos);
    } catch (error) {
      syncError = error instanceof Error ? error.message : String(error);
    }

    let template = await repos.templates.get(TEST_TEMPLATE.name, TEST_TEMPLATE.language);
    if (!template) {
      template = {
        ...TEST_TEMPLATE,
        category: 'UTILITY',
        status: 'APPROVED',
        quality: null,
        variables: 0,
        body: 'Welcome and congratulations!! This message demonstrates your ability to send a WhatsApp message notification from the Cloud API.',
      };
      await repos.templates.upsert(template);
    }

    await repos.contacts.upsertFromInbound(phone);
    await repos.contacts.setOptIn(phone, 'numero de prueba del operador');

    const outcome = await sender.send({
      phone,
      kind: 'template',
      category: template.category,
      templateName: template.name,
      templateLanguage: template.language,
      variables: [],
    });
    return { ...outcome, template: template.name, syncError };
  });
}
