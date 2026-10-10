import { cuentasPage } from './cuentas-page.js';
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
import { registerGsgCourierRoutes } from './gsg-courier-routes.js';
import { chatPage } from './chat-page.js';
import { rutasPage } from './rutas-page.js';
import { manualPage, soportePage } from './ayuda-pages.js';
import { createRequire } from 'node:module';
import { registerConnectRoutes } from './connect-routes.js';
import { conexionGsgVigente, RUTA_SIMULADOR, type ServicioConexionGsg } from '../rutas/conexion-gsg.js';
import { registerGsgExtrasRoutes } from '../rutas/gsg-extras-routes.js';
import type { GsgSimulado } from '../entregas/gsg-simulado.js';
import type { PuertoGsg } from '../rutas/gsg.js';
import { crearServicioPerfiles } from '../perfiles/servicio.js';
import type { SettingsRepo } from '../settings/service.js';

/** Sin repo de settings (arranques viejos), el perfil se recuerda solo mientras corre el proceso. */
function memoriaDePerfil(): SettingsRepo {
  const m = new Map<string, string>();
  return {
    async getAll() {
      return [...m.entries()].map(([key, value]) => ({ key, value, encrypted: false }));
    },
    async put(key: string, value: string) {
      m.set(key, value);
    },
    async remove(key: string) {
      m.delete(key);
    },
  } as SettingsRepo;
}
import type { StokyClient } from '../stoky/client.js';
import { registerDevRoutes } from './dev-routes.js';

import { registerLocalRoutes } from './local-routes.js';
import type { SesionLocal } from '../whatsapp/local/session.js';
import type { Monitor } from '../salud/monitor.js';
import type { ServicioAjustes } from '../ajustes/generales.js';
import type { ServicioStickers } from '../stickers/stickers.js';
import type { ServicioIA } from '../ia/servicio.js';
import { registerWahaRoutes } from './waha-routes.js';
import type { ServicioEnvioAutomatico } from '../envio-automatico/servicio.js';
import type { ServicioVoz } from '../voz/servicio.js';
import type { ServicioEntregas } from '../entregas/servicio.js';
import { entregasPage } from './entregas-page.js';

import { fiabilidadPage } from './fiabilidad-page.js';
import { guardadosPage } from './guardados-page.js';
import { fijarModoVigente } from './shell.js';

import { entrenamientoPage } from './entrenamiento-page.js';

import { mapaPage } from './mapa-page.js';

import { ICONO_192_PNG_BASE64, ICONO_512_PNG_BASE64 } from './iconos.js';
import { NOMBRE_SISTEMA } from '../marca.js';
import type { ServicioEntrenamiento } from '../entrenamiento/servicio.js';

export interface WebDeps {
  config: Config;
  /** El catalogo de Stoky, si esta conectado. */
  catalogo?: StokyClient;
  settings: SettingsService;
  wa: WhatsAppClient;
  sender: Sender;
  repos: Repos;
  /** El monitor de salud, para que la sesion local le cuente sus cortes. */
  salud?: Monitor;
  /** Reabrir la sesion local al arrancar si hay vinculacion guardada. Solo arranques reales. */
  autoConectarLocal?: boolean;
  /** Los ajustes generales editables desde la pantalla. */
  ajustes?: ServicioAjustes;
  /** Los stickers automaticos, para el asistente. */
  stickers?: ServicioStickers;
  /** El asistente de IA de la tienda. */
  ia?: ServicioIA;
  /** La lista de envio automatico. */
  lista?: ServicioEnvioAutomatico;
  /** El entrenamiento del asistente (la pantalla /entrenamiento). */
  entrenamiento?: ServicioEntrenamiento;
  /** La voz del asistente: los entrantes del socket local se transcriben con ella. */
  voz?: ServicioVoz;
  /** Las entregas del dia (la pantalla /entregas y los entrantes del socket local). */
  entregas?: ServicioEntregas;
  /** "Que todo funcione" (la pantalla /fiabilidad): si esta montado en este arranque. */
  fiabilidad?: boolean;
  /** La conexion con GSG; si no viene, se usa la ultima creada en este proceso. */
  conexionGsg?: ServicioConexionGsg;
  /** Si el simulador de GSG esta montado en este arranque (para ofrecer tokens de prueba). */
  simuladorGsg?: boolean;
  /** El simulador mismo (si esta montado), para las pruebas desde Conexion. */
  simulador?: GsgSimulado;
  /** Para guardar por clave (perfil de instalacion). */
  settingsRepo?: SettingsRepo;
  /**
   * La sesion de WhatsApp de esta tienda y sus carpetas. Cada tienda de la
   * plataforma trae las suyas (ver src/plataforma); sin ellas, las de una
   * instalacion suelta.
   */
  sesionLocal?: SesionLocal;
  authDir?: string;
  mediaDir?: string;
  prefijoLog?: string;
  /** La puerta a GSG de esta tienda: la usan los entrantes del WhatsApp local y del simulador. */
  gsg?: PuertoGsg;
  /** Los procesos de esta tienda (el Modulo desarrollador simula sus corridas). Ver src/procesos. */
  procesos?: import('../procesos/servicio.js').ServicioProcesos;
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
  const { config, settings, wa, sender, repos, catalogo } = deps;
  const publicBase = config.PUBLIC_BASE_URL.replace(/\/+$/, '');
  // Cada proveedor tiene su endpoint: la pantalla debe enseñar el del activo,
  // porque es la direccion que hay que pegar en Meta o darle a WAHA.
  const webhookUrlFor = () =>
    providerOf(settings.current()) === 'waha'
      ? `${publicBase}/webhooks/waha`
      : `${publicBase}/webhooks/whatsapp`;

  const html = (body: string) => ({ body, type: 'text/html; charset=utf-8' });
  const negocio = () => deps.ajustes?.nombreNegocio() ?? config.businessName;
  await registerGsgCourierRoutes(app, { nombreNegocio: negocio, disponible: Boolean(deps.entregas), demo: config.DEMO_MODE });
  // El modo del sistema (gsg | completo) lo leen todas las paginas al pintar el armazon.
  fijarModoVigente(() => deps.ajustes?.modo() ?? 'gsg');

  // "Añadir a la pantalla de inicio" en el celular: el manifest y sus iconos.
  // Sin service worker: la app vive en el servidor y nada se cachea a ciegas.
  app.get('/manifest.webmanifest', async (_request, reply) => {
    return reply
      .type('application/manifest+json')
      .header('cache-control', 'public, max-age=3600')
      .send({
        name: NOMBRE_SISTEMA,
        short_name: NOMBRE_SISTEMA,
        description: 'Los pedidos de hoy, las ubicaciones y los chats, desde el celular.',
        start_url: '/hoy',
        scope: '/',
        display: 'standalone',
        background_color: '#f6f7f9',
        theme_color: '#0a7f55',
        lang: 'es-PE',
        icons: [
          { src: '/icono-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      });
  });
  for (const [ruta, base64] of [
    ['/icono-192.png', ICONO_192_PNG_BASE64],
    ['/icono-512.png', ICONO_512_PNG_BASE64],
  ] as const) {
    const bytes = Buffer.from(base64, 'base64');
    app.get(ruta, async (_request, reply) => reply.type('image/png').header('cache-control', 'public, max-age=86400').send(bytes));
  }

  // El icono de la pestaña, para todas las paginas: sin el, cada visita deja
  // un 404 en la consola del navegador.
  app.get('/favicon.ico', async (_request, reply) => {
    return reply
      .type('image/svg+xml')
      .header('cache-control', 'public, max-age=86400')
      .send(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#128c7e"/>` +
          `<text x="16" y="22" text-anchor="middle" font-family="system-ui,sans-serif" font-size="18" font-weight="700" fill="#fff">G</text></svg>`,
      );
  });

  app.get('/setup', async (_request, reply) => {
    const page = html(connectPage({ labels: FIELD_LABELS, nombreNegocio: negocio(), demo: config.DEMO_MODE, conGsg: Boolean(deps.entregas) }));
    return reply.type(page.type).header('cache-control', 'no-store').send(page.body);
  });

  app.get('/chat', async (_request, reply) => {
    const page = html(
      chatPage({ configured: settings.isConfigured(), proveedor: providerOf(settings.current()), demo: config.DEMO_MODE, nombreNegocio: negocio() }),
    );
    return reply.type(page.type).header('cache-control', 'no-store').send(page.body);
  });

  await registerConnectRoutes(app, { config, settings, wa, ajustes: deps.ajustes });
  // Perfiles de instalacion: "para que se usa GSGchat" (Conexion, arriba). Ver src/perfiles.
  const perfiles = await crearServicioPerfiles({
    settingsRepo: deps.settingsRepo ?? memoriaDePerfil(),
    ajustes: deps.ajustes,
    entregas: deps.entregas,
    automation: repos.automation,
  });
  app.get('/admin/perfil', async () => ({ ok: true, perfiles: perfiles.perfiles(), actual: perfiles.actual() }));
  app.post('/admin/perfil', async (request, reply) => {
    const u = request.usuario;
    if (!u || u.rol !== 'admin' || u.porToken) return reply.code(403).send({ error: 'Solo un administrador cambia el perfil de la instalación.' });
    const body = z.object({ perfil: z.enum(['reparto', 'tienda', 'chat']) }).parse(request.body ?? {});
    const r = await perfiles.aplicar(body.perfil, u.nombre ?? u.usuario ?? null);
    return { ok: true, ...r };
  });
  // Lo que rodea a GSG (descartes, contrato, tokens del simulador, bitacora, cuadre):
  // con la conexion vigente de este proceso. Ver src/rutas/gsg-extras-routes.ts.
  const conexionGsg = deps.conexionGsg ?? conexionGsgVigente();
  if (conexionGsg && deps.entregas) {
    await registerGsgExtrasRoutes(app, {
      conexion: conexionGsg,
      conSimulador: () => deps.simuladorGsg ?? (deps.simulador ? true : app.hasRoute({ method: 'GET', url: RUTA_SIMULADOR + '/*' })),
      simulador: deps.simulador,
      entregasDelDia: async (dia) => (await repos.entregas.listar({ dia, limit: 5000 })).map((e) => ({ referencia: e.referencia, estado: e.estado })),
    });
  }
  await registerWahaRoutes(app, { config, settings, repos });
  await registerLocalRoutes(app, {
    config,
    repos,
    sender,
    wa,
    settings,
    catalogo,
    salud: deps.salud,
    ajustes: deps.ajustes,
    stickers: deps.stickers,
    ia: deps.ia,
    lista: deps.lista,
    voz: deps.voz,
    entregas: deps.entregas,
    autoConectar: deps.autoConectarLocal,
    sesion: deps.sesionLocal,
    authDir: deps.authDir,
    mediaDir: deps.mediaDir,
    prefijoLog: deps.prefijoLog,
    gsg: deps.gsg,
  });
  // El simulador de entrantes pasa por las mismas piezas que un mensaje real
  // (monitor de salud, ajustes, stickers): si no, lo que se prueba con el no
  // es lo que pasa en la calle.
  if (process.env.NODE_ENV === 'test') await registerDevRoutes(app, { config, repos, sender, wa, settings, catalogo, salud: deps.salud, ajustes: deps.ajustes, stickers: deps.stickers, ia: deps.ia, lista: deps.lista, voz: deps.voz, entregas: deps.entregas, gsg: deps.gsg });

  // El Modulo desarrollador (solo administradores): probar todo sin WhatsApp
  // real y comprobar que esta listo para GSG. Ver src/desarrollador.


  app.get('/automatizacion-gsg', async (_request, reply) => {
    const page = html(rutasPage({ configured: settings.isConfigured(), demo: config.DEMO_MODE, nombreNegocio: negocio() }));
    return reply.type(page.type).header('cache-control', 'no-store').send(page.body);
  });

  app.get('/envio-automatico', async (_request, reply) => reply.redirect('/automatizacion-gsg'));

  // Hoy es la portada de GSGchat; /entregas es el mismo sitio con su nombre viejo.
  for (const ruta of ['/hoy', '/entregas']) {
    app.get(ruta, async (_request, reply) => {
      const page = html(entregasPage({ disponible: Boolean(deps.entregas), configured: settings.isConfigured(), demo: config.DEMO_MODE, nombreNegocio: negocio() }));
      return reply.type(page.type).header('cache-control', 'no-store').send(page.body);
    });
  }

  app.get('/salud', async (_request, reply) => {
    const page = html(fiabilidadPage({ disponible: Boolean(deps.fiabilidad), demo: config.DEMO_MODE, nombreNegocio: negocio() }));
    return reply.type(page.type).header('cache-control', 'no-store').send(page.body);
  });

  app.get('/numeros', async (request, reply) => reply.redirect('/hoy' + (request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '')));
  for (const [origen, destino] of [['/tiendas', '/cuentas'], ['/fiabilidad', '/salud'], ['/rutas', '/automatizacion-gsg']]) {
    app.get(origen!, async (_request, reply) => reply.redirect(destino!));
  }

  app.get('/guardados', async (_request, reply) => {
    const page = html(guardadosPage({ demo: config.DEMO_MODE, nombreNegocio: negocio(), conIA: Boolean(deps.ia?.estado().tieneToken) }));
    return reply.type(page.type).header('cache-control', 'no-store').send(page.body);
  });

  // El panel del dueño (solo superadministrador), el mapa del dia y la pantalla Pagar de esta instalacion. Constructor E.
  app.get('/cuentas', async (_request, reply) => {
    const page = html(cuentasPage({ nombreNegocio: negocio() }));
    return reply.type(page.type).header('cache-control', 'no-store').send(page.body);
  });

  app.get('/mapa', async (_request, reply) => {
    const page = html(mapaPage({ disponible: Boolean(deps.entregas), demo: config.DEMO_MODE, nombreNegocio: negocio() }));
    return reply.type(page.type).header('cache-control', 'no-store').send(page.body);
  });



  app.get('/entrenamiento', async (_request, reply) => {
    const page = html(entrenamientoPage({ disponible: Boolean(deps.entrenamiento), conIA: Boolean(deps.ia?.estado().tieneToken), demo: config.DEMO_MODE, nombreNegocio: negocio() }));
    return reply.type(page.type).header('cache-control', 'no-store').send(page.body);
  });

  app.get('/panel', async (_request, reply) => {
    const page = html(panelPage({ configured: settings.isConfigured(), nombreNegocio: negocio(), demo: config.DEMO_MODE }));
    return reply.type(page.type).header('cache-control', 'no-store').send(page.body);
  });

  // Las dos entradas de arriba del menu: que hace cada cosa, y que mirar si falla.
  app.get('/manual', async (_request, reply) => {
    const page = html(manualPage({ nombreNegocio: negocio(), demo: config.DEMO_MODE }));
    return reply.type(page.type).header('cache-control', 'no-store').send(page.body);
  });

  app.get('/soporte', async (_request, reply) => {
    const page = html(soportePage({ nombreNegocio: negocio(), demo: config.DEMO_MODE, version: versionDelPaquete() }));
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

/** La version del package.json, para el diagnostico de soporte. */
function versionDelPaquete(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../../package.json') as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
