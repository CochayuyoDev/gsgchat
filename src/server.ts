/**
 * Montaje del servidor HTTP. Todas las dependencias entran por parametro
 * para que los tests puedan inyectar dobles sin base de datos ni Redis.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
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
import { CABECERA_INTERNA, CABECERA_USUARIO_INTERNO, registerAuth } from './auth/routes.js';
import { registerWebRoutes } from './web/routes.js';
import type { SettingsService } from './settings/service.js';
import type { StokyClient } from './stoky/client.js';
import { TrackingHub } from './tracking/realtime.js';
import { TemplateRenderError } from './templates/render.js';
import { crearPuertoGsg } from './rutas/gsg.js';
import { instalarMensajesEnEspanol } from './util/mensajes-zod.js';
import type { Monitor } from './salud/monitor.js';
import type { Politica } from './salud/politica.js';
import type { ServicioAjustes } from './ajustes/generales.js';
import { instalarBitacora } from './auth/actividad.js';
import type { ServicioStickers } from './stickers/stickers.js';
import { registerStickersRoutes } from './admin/stickers-routes.js';
import { registerApiV1 } from './api/v1/routes.js';
import type { Bus } from './eventos/bus.js';
import { registerEmbedRoutes } from './embed/routes.js';
import { registerConectoresRoutes } from './conectores/routes.js';
import { registerWebVisitantesRoutes } from './web-visitantes/routes.js';
import type { ServicioIA } from './ia/servicio.js';
import { registerIaRoutes } from './ia/routes.js';
import type { ServicioEnvioAutomatico } from './envio-automatico/servicio.js';
import { registerEnvioAutomaticoRoutes } from './envio-automatico/routes.js';

export interface ServerDeps {
  config: Config;
  repos: Repos;
  /** El catalogo de Stoky, si esta conectado. Ver InboundDeps. */
  catalogo?: StokyClient;
  settings: SettingsService;
  wa: WhatsAppClient;
  sender: Sender;
  queue: OutboundQueue;
  logger?: boolean;
  /** El monitor de salud y la politica de ritmo. Ver src/salud. */
  salud?: Monitor;
  politica?: () => Politica;
  /** Los ajustes generales editables desde la pantalla. Ver src/ajustes. */
  ajustes?: ServicioAjustes;
  /** La biblioteca de stickers y los automaticos. Ver src/stickers. */
  stickers?: ServicioStickers;
  /** Donde viven los adjuntos que llegaron por el chat. Ver src/whatsapp/local/media.ts. */
  mediaDir?: string;
  /** Como se prueban los webhooks desde la API (fetch de pruebas, timeout). Ver src/webhooks. */
  webhooks?: { fetchImpl?: typeof fetch; timeoutMs?: number; version?: string };
  /** El bus de eventos: alimenta el flujo en vivo de la API y el chat embebido. Ver src/eventos. */
  bus?: Bus;
  /** El asistente de IA de la tienda. Ver src/ia. */
  ia?: ServicioIA;
  /** Reabrir la sesion local (Baileys) al arrancar si hay vinculacion guardada. */
  autoConectarLocal?: boolean;
  /** La lista de numeros a los que el sistema escribe solo. Ver src/envio-automatico. */
  lista?: ServicioEnvioAutomatico;
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { config, repos, wa, sender, queue, settings, catalogo, salud, politica, ajustes, stickers, mediaDir, ia, lista } = deps;

  // Los errores de validacion salen en espanol: son los que acaban en la
  // pantalla del operador, no en un log para programadores.
  instalarMensajesEnEspanol();

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
      const detail = error.issues.map((i) => `${i.path.join('.') || 'el cuerpo'}: ${i.message}`).join('; ');
      return reply.code(400).send({ error: `Revisa los datos - ${detail}` });
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
    if (request.url.startsWith('/admin') || request.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
  });

  await app.register(websocket);

  const hub = new TrackingHub({ tracking: repos.tracking });
  // La puerta a GSG: sin credenciales no manda nada y los reportes se quedan
  // en la cola, que es como funciona hasta que GSG publique su API.
  const gsg = crearPuertoGsg(config);

  // `connected` distingue "tiene proveedor" de "el telefono esta vinculado":
  // con el cliente local, configurado no significa conectado hasta escanear el QR.
  app.get('/health', async () => ({ ok: true, configured: settings.isConfigured(), connected: settings.isConfigured() && (wa.conectado?.() ?? true) }));

  // El orden importa: registerAuth instala el hook que resuelve quien pide
  // (cookie de sesion o clave de API) y exige sesion en /admin y en las
  // pantallas privadas; va antes de cualquier ruta que lo necesite.
  const secretoInterno = randomBytes(24).toString('hex');
  await registerAuth(app, { config, usuarios: repos.usuarios, claves: repos.claves, actividad: repos.actividad, nombreNegocio: () => ajustes?.nombreNegocio() ?? config.businessName, secretoInterno });
  // La bitacora anota sola cada accion que cambia algo (POST/DELETE que acaban bien).
  instalarBitacora(app, repos.actividad, (m, d) => app.log.warn(d ?? {}, m));
  if (stickers) await registerStickersRoutes(app, { stickers, ajustes, mediaDir });
  await registerWebhookRoutes(app, { repos, config, sender, wa, settings, catalogo, gsg, salud, ajustes, stickers, ia, lista });
  if (ia) await registerIaRoutes(app, { ia });
  if (lista) await registerEnvioAutomaticoRoutes(app, { repos, lista });
  // El endpoint de WAHA convive con el de Meta: cambiar de proveedor no obliga
  // a reiniciar, y cada uno valida su propia firma antes de mirar el cuerpo.
  await registerWahaWebhookRoutes(app, {
    repos,
    config,
    sender,
    wa,
    settings,
    catalogo,
    gsg,
    salud,
    ajustes,
    stickers,
    ia,
    lista,
    // Contestar a cada trozo de una rafaga le manda al cliente tres mensajes
    // seguidos sin que el haya escrito nada en medio (ver rafaga.ts).
    rafagaMs: config.RAFAGA_MS,
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
    salud,
    politica,
    ajustes,
    stickers,
    ia,
    lista,
    mediaDir,
  });
  // La API publica para otros sistemas (Stoky, GSG, scripts): pocos caminos,
  // nombres estables y un permiso por ruta. Ver src/api/v1.
  await registerApiV1(app, { repos, config, settings, sender, queue, wa, politica, webhooks: deps.webhooks, bus: deps.bus, ia });
  // El chat embebido en otras webs (iframe + embed.js). Ver src/embed.
  await registerEmbedRoutes(app, { config, ajustes });
  // El chat para los visitantes de la web del negocio (widget.js). Ver src/web-visitantes.
  await registerWebVisitantesRoutes(app, { repos, config, sender, wa, settings, catalogo, gsg, salud, ajustes, stickers, ia, lista, bus: deps.bus, rafagaMs: config.RAFAGA_MS });
  // Conectores de tiendas (WooCommerce, Shopify): su webhook entra por /conectores/:id. Ver src/conectores.
  await registerConectoresRoutes(app, { repos, sender, settings, config, nombreNegocio: () => ajustes?.nombreNegocio() ?? config.businessName });
  await registerWebRoutes(app, {
    config,
    settings,
    wa,
    sender,
    repos,
    catalogo,
    salud,
    ajustes,
    stickers,
    ia,
    lista,
    autoConectarLocal: deps.autoConectarLocal,
  });

  // La IA operadora ejecuta las ordenes por las mismas rutas que las
  // pantallas, con la identidad de quien ordena (y en la bitacora se ve
  // "(por la IA)"). Ver src/ia/ordenes.ts.
  if (ia) {
    ia.conectarOperador((usuario) => async (llamada) => {
      const identidad = { ...usuario, nombre: `${usuario.nombre || usuario.usuario} (por la IA)` };
      const res = await app.inject({
        method: llamada.method,
        url: llamada.url,
        headers: { [CABECERA_INTERNA]: secretoInterno, [CABECERA_USUARIO_INTERNO]: JSON.stringify(identidad), 'content-type': 'application/json' },
        payload: llamada.body === undefined ? undefined : JSON.stringify(llamada.body),
      });
      let json: unknown;
      try {
        json = res.body ? JSON.parse(res.body) : {};
      } catch {
        json = { error: res.body.slice(0, 300) };
      }
      return { status: res.statusCode, json };
    });
  }

  return app;
}
