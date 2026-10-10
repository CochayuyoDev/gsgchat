/**
 * Montaje del servidor HTTP. Todas las dependencias entran por parametro
 * para que los tests puedan inyectar dobles sin base de datos ni Redis.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { moduloRetirado } from './modulos-retirados.js';
import { randomBytes } from 'node:crypto';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import { cuerpoError, esBaseNoDisponible, ESPERA_BASE_SEGUNDOS, type CodigoError } from './api/errores.js';
import type { Config } from './config.js';
import type { Repos } from './db/repos.js';
import { WhatsAppApiError, type WhatsAppClient } from './whatsapp/client.js';
import { NotConfiguredError } from './whatsapp/dynamic.js';
import type { Sender } from './outbound/sender.js';
import type { OutboundQueue } from './outbound/queue.js';
import { registerWebhookRoutes } from './whatsapp/webhook.js';
import { registerWahaWebhookRoutes } from './whatsapp/waha/webhook.js';

import { registerAdminRoutes } from './admin/routes.js';
import { CABECERA_INTERNA, CABECERA_USUARIO_INTERNO, registerAuth, type DirectorioUsuarios } from './auth/routes.js';
import type { SesionLocal } from './whatsapp/local/session.js';
import { registerWebRoutes } from './web/routes.js';
import type { SettingsRepo, SettingsService } from './settings/service.js';
import type { StokyClient } from './stoky/client.js';
import { TrackingHub } from './tracking/realtime.js';
import { TemplateRenderError } from './templates/render.js';
import { crearPuertoGsg } from './rutas/gsg.js';
import { explicarErrorZod, instalarMensajesEnEspanol } from './util/mensajes-zod.js';
import type { Monitor } from './salud/monitor.js';
import type { Politica } from './salud/politica.js';
import type { ServicioAjustes } from './ajustes/generales.js';
import { instalarBitacora } from './auth/actividad.js';
import type { ServicioStickers } from './stickers/stickers.js';
import { registerStickersRoutes } from './admin/stickers-routes.js';
import { registerApiV1 } from './api/v1/routes.js';
import { registerApiEntregasGsg } from './api/v1/entregas-gsg.js';
import type { Bus } from './eventos/bus.js';



import type { ServicioIA } from './ia/servicio.js';
import type { ServicioPlan } from './plan/servicio.js';
import { registerIaRoutes } from './ia/routes.js';
import { VERSION } from './version.js';
import type { ServicioEnvioAutomatico } from './envio-automatico/servicio.js';

import type { ServicioEntrenamiento } from './entrenamiento/servicio.js';
import { registerEntrenamientoRoutes } from './entrenamiento/routes.js';
import type { ServicioConexionStoky } from './stoky/conexion.js';

import { registerSuperRoutes } from './auth/super-routes.js';

import { type ServicioTiendas } from './tiendas/servicio.js';

import { type Alojamiento } from './tiendas/alojamiento.js';
import type { ServicioVoz } from './voz/servicio.js';
import { registerVozRoutes } from './voz/routes.js';
import type { ServicioEntregas } from './entregas/servicio.js';
import { registerEntregasRoutes } from './entregas/routes.js';
import type { GsgSimulado } from './entregas/gsg-simulado.js';

import type { ServicioConexionGsg } from './rutas/conexion-gsg.js';

import type { PuertoGsg } from './rutas/gsg.js';
import type { ServicioFiabilidad } from './salud/fiabilidad.js';
import { registerFiabilidadRoutes } from './salud/routes-fiabilidad.js';
import type { ServicioResumenes } from './resumenes/servicio.js';
import { registerResumenesRoutes } from './resumenes/routes.js';
import { type ServicioProcesos } from './procesos/servicio.js';



import { fijarGsgVigente } from './web/shell.js';
import { normalizarRuta } from './util/ruta-normalizada.js';

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
  /** El plan de la tienda en el SaaS. Ver src/plan. */
  plan?: ServicioPlan;
  /** Reabrir la sesion local (Baileys) al arrancar si hay vinculacion guardada. */
  autoConectarLocal?: boolean;
  /** La lista de numeros a los que el sistema escribe solo. Ver src/envio-automatico. */
  lista?: ServicioEnvioAutomatico;
  /** Lo que se le enseno al asistente a gran escala. Ver src/entrenamiento. */
  entrenamiento?: ServicioEntrenamiento;
  /** La conexion con Stoky, configurable desde la pantalla. Ver src/stoky/conexion.ts. */
  conexionStoky?: ServicioConexionStoky;
  /** Las tiendas del superadministrador (para pruebas con reloj propio; si no, se crea aqui). */
  tiendas?: ServicioTiendas;
  /** Levantar instalaciones de tiendas en este servidor (Docker). Para pruebas; si no, se detecta por saas/.env. */
  alojamiento?: Alojamiento;
  /** La voz del asistente (ElevenLabs): notas de voz y transcripcion. Ver src/voz. */
  voz?: ServicioVoz;
  /** Las entregas del dia: confirmacion, motorizados y hora de llegada. Ver src/entregas. */
  entregas?: ServicioEntregas;
  /** La conexion con GSG configurable desde la pantalla (su puerto manda sobre el del .env). Ver src/rutas/conexion-gsg.ts. */
  conexionGsg?: ServicioConexionGsg;
  /** La puerta a GSG ya hecha (pruebas); si no, la de la conexion o la del .env. */
  gsg?: PuertoGsg;
  /** El simulador del sistema de GSG, montado en /simulador/gsg. Ver src/entregas/gsg-simulado.ts. */
  simuladorGsg?: GsgSimulado;
  /** El repo de settings, para lo que se guarda por clave (perfil de instalacion). */
  settingsRepo?: SettingsRepo;
  /** "Que todo funcione": vigilante del WhatsApp, pruebas de la manana, cupo y copia. Ver src/salud/fiabilidad.ts. */
  fiabilidad?: ServicioFiabilidad;
  /** El secreto del bucle interno (app.inject con identidad); si no se pasa, se genera uno. Lo usa el vigilante para pedir la reconexion. */
  secretoInterno?: string;
  /** El resumen de la mañana y de la tarde al supervisor. Ver src/resumenes. */
  resumenes?: ServicioResumenes;
  /** Los procesos (pedir datos, confirmar, avisos al personal, cobranza). Si no se pasa, se arma aqui sin motor. Ver src/procesos. */
  procesos?: ServicioProcesos;
  /**
   * Lo propio de cada tienda de la plataforma (ver src/plataforma): su sesion
   * de WhatsApp, su carpeta de vinculacion, el rol de su primera cuenta y el
   * directorio de usuarios compartido. Sin esto, una instalacion suelta.
   */
  sesionLocal?: SesionLocal;
  authDir?: string;
  prefijoLog?: string;
  primeraCuentaRol?: 'superadmin' | 'admin';
  directorio?: DirectorioUsuarios;
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { config, repos, wa, sender, queue, settings, catalogo, salud, politica, ajustes, stickers, mediaDir, ia, lista, entrenamiento, voz, entregas } = deps;

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
    // Que los ganchos de autorizacion vean la misma ruta que el enrutador
    // (sin esto, `/%61dmin/...` se saltaba el de /admin). Ver util/ruta-normalizada.ts.
    rewriteUrl: (req) => normalizarRuta(req.url ?? '/'),
  });

  app.addHook('onRequest', async (request, reply) => {
    if (moduloRetirado(request.url)) return reply.code(404).send({ ok: false, codigo: 'RUTA_NO_EXISTE', error: 'Este módulo fue retirado. Usa API, WhatsApp o Pedidos GSG.' });
  });

  // El cuerpo crudo hace falta para validar la firma del webhook: si se
  // reserializa el JSON parseado, el HMAC ya no cuadra.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    (request as unknown as { rawBody: Buffer }).rawBody = body as Buffer;
    try {
      done(null, (body as Buffer).length ? JSON.parse((body as Buffer).toString('utf8')) : {});
    } catch {
      // Un JSON roto es culpa de quien lo manda: 400 con el motivo, no un
      // 500 «error interno» (lo destapo la comprobacion «¿Está listo para GSG?»).
      const error = new Error('El cuerpo no es un JSON válido: revisa comillas, comas y llaves.') as Error & { statusCode: number; codigo: CodigoError };
      error.statusCode = 400;
      error.codigo = 'JSON_INVALIDO';
      done(error, undefined);
    }
  });

  // Errores con un mensaje que el panel pueda ensenar tal cual. Sin esto, un
  // cuerpo mal formado o la falta de credenciales salian como 500 generico.
  app.setErrorHandler((raw: unknown, request, reply) => {
    const error = raw instanceof Error ? raw : new Error(String(raw));
    if (error instanceof ZodError) {
      return reply.code(400).send(cuerpoError('VALIDACION', explicarErrorZod(error), error.issues.map((i) => ({ campo: i.path.join('.') || 'cuerpo', mensaje: i.message }))));
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
      const propio = (error as { codigo?: CodigoError }).codigo;
      const codigo: CodigoError = propio ?? (status === 401 ? 'CLAVE_INVALIDA' : status === 403 ? 'SIN_PERMISO' : status === 404 ? 'NO_EXISTE' : status === 409 ? 'CONFLICTO' : status === 413 ? 'CUERPO_DEMASIADO_GRANDE' : status === 415 ? 'TIPO_CONTENIDO_NO_SOPORTADO' : status === 429 ? 'DEMASIADAS_PETICIONES' : 'VALIDACION');
      const mensaje = status === 413 ? 'El cuerpo supera el límite de 4 MiB: divide los pedidos en llamadas más pequeñas.'
        : status === 415 ? 'El tipo de contenido no está soportado: usa Content-Type: application/json.' : error.message;
      // El parser puede rechazar por Content-Length antes de leer un byte.
      // Drenar evita dejar la petición pausada mientras se devuelve el 413.
      if (status === 413) request.raw.resume();
      return reply.code(status).send(cuerpoError(codigo, mensaje));
    }
    request.log.error({ err: error }, 'error no controlado');
    // La base que no contesta no es un fallo nuestro: 503 y cuando volver.
    if (esBaseNoDisponible(error)) {
      reply.header('retry-after', String(ESPERA_BASE_SEGUNDOS));
      return reply.code(503).send(cuerpoError('BASE_NO_DISPONIBLE', 'La base de datos no responde ahora mismo: vuelve a intentarlo en unos segundos.'));
    }
    return reply.code(500).send(cuerpoError('ERROR_INTERNO', 'error interno; revisa el log del servidor'));
  });

  // Una ruta de la API que no existe: JSON con su codigo, no la pagina de 404.
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/') || request.url.startsWith('/admin/')) {
      // Una ruta existente con otro método es 405, no 404. Allow enumera
      // solo los métodos realmente registrados (incluido HEAD cuando existe).
      const url = request.url.split('?')[0]!;
      const permitidos = (['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const)
        .filter((method) => app.findRoute({ method, url }) !== null);
      if (permitidos.length) {
        return reply.header('allow', permitidos.join(', ')).code(405)
          .send(cuerpoError('METODO_NO_PERMITIDO', `No se permite ${request.method} en ${url}. Métodos permitidos: ${permitidos.join(', ')}.`));
      }
      return reply.code(404).send(cuerpoError('RUTA_NO_EXISTE', `No existe ${request.method} ${request.url.split('?')[0]}.`));
    }
    // Lo demas, como lo contestaba Fastify.
    return reply.code(404).send({ message: `Route ${request.method}:${request.url} not found`, error: 'Not Found', statusCode: 404 });
  });

  // Nada de /admin se cachea. El chat pide el mismo hilo cada pocos
  // segundos y el navegador reutilizaba la primera respuesta: la pantalla se
  // quedaba congelada aunque el mensaje ya estuviera enviado.
  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/admin') || request.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
  });

  await app.register(websocket);

  // GSG está disponible en todas las cuentas, sin el editor de procesos.
  fijarGsgVigente(() => true);

  const hub = new TrackingHub({ tracking: repos.tracking });
  // La puerta a GSG: sin credenciales no manda nada y los reportes se quedan
  // en la cola, que es como funciona hasta que GSG publique su API.
  const gsg = deps.gsg ?? deps.conexionGsg?.puerto() ?? crearPuertoGsg(config);

  // `connected` distingue "tiene proveedor" de "el telefono esta vinculado":
  // con el cliente local, configurado no significa conectado hasta escanear el QR.
  app.get('/health', async () => ({ ok: true, version: VERSION, configured: settings.isConfigured(), connected: settings.isConfigured() && (wa.conectado?.() ?? true) }));

  // El orden importa: registerAuth instala el hook que resuelve quien pide
  // (cookie de sesion o clave de API) y exige sesion en /admin y en las
  // pantallas privadas; va antes de cualquier ruta que lo necesite.
  const secretoInterno = deps.secretoInterno ?? randomBytes(24).toString('hex');
  await registerAuth(app, { config, usuarios: repos.usuarios, claves: repos.claves, actividad: repos.actividad, nombreNegocio: () => ajustes?.nombreNegocio() ?? config.businessName, modo: () => ajustes?.modo() ?? 'gsg', secretoInterno, plan: deps.plan, primeraCuentaRol: deps.primeraCuentaRol, directorio: deps.directorio });
  // La bitacora anota sola cada accion que cambia algo (POST/DELETE que acaban bien).
  instalarBitacora(app, repos.actividad, (m, d) => app.log.warn(d ?? {}, m));
  if (stickers) await registerStickersRoutes(app, { stickers, ajustes, mediaDir });
  await registerWebhookRoutes(app, { repos, config, sender, wa, settings, catalogo, gsg, salud, ajustes, stickers, ia, lista, voz, entregas });
  // Las entregas del dia y los motorizados, y el simulador de GSG si se monto. Ver src/entregas.
  if (entregas) await registerEntregasRoutes(app, { entregas, conexionGsg: deps.conexionGsg, simulador: deps.simuladorGsg, config });
  if (ia) await registerIaRoutes(app, { ia, plan: deps.plan, actividad: repos.actividad });
  // El resumen del dia por WhatsApp (Ajustes → Resumen del dia). Ver src/resumenes.
  if (deps.resumenes) await registerResumenesRoutes(app, { resumenes: deps.resumenes });
  // La voz del asistente (Mi asistente IA → Voz). Ver src/voz.
  if (voz) await registerVozRoutes(app, { voz });
  // Lo que el sistema vigila de si mismo (la pantalla /fiabilidad). Ver src/salud/fiabilidad.ts.
  if (deps.fiabilidad) await registerFiabilidadRoutes(app, { fiabilidad: deps.fiabilidad });

  if (entrenamiento) await registerEntrenamientoRoutes(app, { entrenamiento });
  // Membresia y codigos de conexion (superadministrador). Ver src/auth/super-routes.ts.
  await registerSuperRoutes(app, { plan: deps.plan, codigos: repos.codigosConexion, claves: repos.claves, config });
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
    voz,
    entregas,
    // Contestar a cada trozo de una rafaga le manda al cliente tres mensajes
    // seguidos sin que el haya escrito nada en medio (ver rafaga.ts).
    rafagaMs: config.RAFAGA_MS,
    hmacKey: () => settings.current().verifyToken,
  });

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
    plan: deps.plan,
    fiabilidad: deps.fiabilidad,
    conexionStoky: deps.conexionStoky,
    entrenamiento,
    voz,
    gsg,
    entregas,
    conexionGsg: deps.conexionGsg,
  });
  // La API publica para otros sistemas (Stoky, GSG, scripts): pocos caminos,
  // nombres estables y un permiso por ruta. Ver src/api/v1.
  await registerApiV1(app, { repos, config, settings, sender, queue, wa, politica, webhooks: deps.webhooks, bus: deps.bus, ia, voz, mediaDir, fetchImpl: deps.webhooks?.fetchImpl });
  // GSG empuja sus pedidos por la API (POST /api/v1/entregas) en vez de esperar la consulta. Ver src/api/v1/entregas-gsg.ts.
  if (entregas) await registerApiEntregasGsg(app, { entregas, repo: repos.entregas, actividad: repos.actividad });
  // Los procesos: sus pantallas, lo que ellas piden y POST /api/v1/procesos/:id/personas. Ver src/procesos.

  // El chat embebido en otras webs (iframe + embed.js). Ver src/embed.

  // El chat para los visitantes de la web del negocio (widget.js). Ver src/web-visitantes.

  // Conectores de tiendas (WooCommerce, Shopify): su webhook entra por /conectores/:id. Ver src/conectores.

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
    entrenamiento,
    voz,
    entregas,
    autoConectarLocal: deps.autoConectarLocal,
    fiabilidad: Boolean(deps.fiabilidad),
    simulador: deps.simuladorGsg,
    settingsRepo: deps.settingsRepo,
    conexionGsg: deps.conexionGsg,
    sesionLocal: deps.sesionLocal,
    authDir: deps.authDir,
    mediaDir,
    prefijoLog: deps.prefijoLog,
    // La misma puerta a GSG que el webhook de Meta: la de la conexion vigente.
    gsg,

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
