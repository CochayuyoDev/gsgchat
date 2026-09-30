/**
 * Las rutas del canal web: lo que usa el widget de la pagina del negocio.
 *
 * Son publicas (un visitante no tiene cuenta) y por eso se cuidan de otra
 * forma: solo desde los origenes que la tienda escribio en "webs que pueden
 * embeber" (CORS), con un tope de mensajes por sesion y por IP, y con una
 * sesion firmada que solo abre la conversacion para la que se emitio.
 *
 *  POST /web/sesion       abre (o reabre) la conversacion del visitante
 *  POST /web/mensajes     el visitante escribe: entra como un entrante mas
 *  GET  /web/historial    lo hablado, para pintar al volver
 *  GET  /web/eventos      lo que le contestan, en vivo (SSE)
 *  GET  /web/widget.js    la burbuja que pega la pagina
 *  GET  /web/demo         una pagina de prueba con el widget puesto
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { ServicioAjustes } from '../ajustes/generales.js';
import type { Bus, NombreEvento } from '../eventos/bus.js';
import type { InboundDeps } from '../handlers/inbound.js';
import { handleInboundMessage } from '../handlers/inbound.js';
import type { SettingsService } from '../settings/service.js';
import type { InboundMessage } from '../whatsapp/types.js';
import { firmarSesionWeb, leerSesionWeb, nombreDeVisitante, nuevoIdMensajeWeb, nuevoIdVisitante, origenPermitido, secretoDeCanalWeb } from './canal.js';
import { widgetScript } from './widget-js.js';
import { paginaDemo } from './demo-page.js';

export interface WebVisitantesDeps extends InboundDeps {
  settings: SettingsService;
  bus?: Bus;
  ajustes?: ServicioAjustes;
  ahora?: () => Date;
}

/** Cuantos mensajes por minuto acepta una sesion, y una IP. */
const TOPE_SESION_MIN = 20;
const TOPE_IP_MIN = 60;

export async function registerWebVisitantesRoutes(app: FastifyInstance, deps: WebVisitantesDeps): Promise<void> {
  const { repos, config, ajustes } = deps;
  const secreto = secretoDeCanalWeb(config);
  const origenPropio = config.PUBLIC_BASE_URL.replace(/\/+$/, '');
  const dominios = () => ajustes?.dominiosEmbebido() ?? [];
  const ahora = () => deps.ahora?.() ?? new Date();

  // --- CORS: solo los origenes de la tienda -------------------------------
  const cors = (request: FastifyRequest, reply: FastifyReply): boolean => {
    const origen = request.headers.origin;
    // Sin cabecera Origin (misma pagina, curl): vale.
    if (!origen) return true;
    if (!origenPermitido(origen, origenPropio, dominios())) return false;
    reply.header('access-control-allow-origin', origen);
    reply.header('vary', 'Origin');
    reply.header('access-control-allow-methods', 'GET, POST, OPTIONS');
    reply.header('access-control-allow-headers', 'content-type');
    reply.header('access-control-max-age', '600');
    return true;
  };
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/web/')) return;
    if (request.url.startsWith('/web/widget.js') || request.url.startsWith('/web/demo')) return;
    if (!cors(request, reply)) {
      return reply.code(403).send({ error: `esta web no esta autorizada a usar el chat: agrega ${request.headers.origin} en Conectar mi web y tienda` });
    }
    if (request.method === 'OPTIONS') return reply.code(204).send();
  });
  app.options('/web/*', async (_request, reply) => reply.code(204).send());

  // --- tope de mensajes -----------------------------------------------------
  const ventanas = new Map<string, { n: number; hasta: number }>();
  const pasaTope = (clave: string, tope: number): boolean => {
    const t = ahora().getTime();
    const v = ventanas.get(clave);
    if (!v || v.hasta <= t) {
      ventanas.set(clave, { n: 1, hasta: t + 60_000 });
      return true;
    }
    v.n += 1;
    return v.n <= tope;
  };
  const limpiar = setInterval(() => {
    const t = ahora().getTime();
    for (const [k, v] of ventanas) if (v.hasta <= t) ventanas.delete(k);
  }, 60_000);
  limpiar.unref?.();
  app.addHook('onClose', async () => clearInterval(limpiar));

  const sesionDe = (token: unknown) => leerSesionWeb(secreto, typeof token === 'string' ? token : undefined, ahora().getTime());

  // --- sesion ----------------------------------------------------------------
  app.post('/web/sesion', async (request, reply) => {
    const body = z
      .object({
        sesion: z.string().max(400).optional(),
        nombre: z.string().trim().max(80).optional(),
        pagina: z.string().max(300).optional(),
      })
      .parse(request.body ?? {});
    if (!pasaTope(`ip:${request.ip}`, TOPE_IP_MIN)) return reply.code(429).send({ error: 'demasiadas peticiones, espera un momento' });

    // Con una sesion vigente se sigue la misma conversacion.
    const previa = sesionDe(body.sesion);
    let contacto = previa ? await repos.contacts.getByPhone(previa.c) : null;
    if (!contacto) {
      const id = nuevoIdVisitante();
      contacto = await repos.contacts.upsertFromInbound(id, body.nombre || nombreDeVisitante(id));
      // El consentimiento es implicito: escribio el desde la web del negocio.
      await repos.contacts.setOptIn(id, `chat web${body.pagina ? ` en ${body.pagina.slice(0, 200)}` : ''}`);
    } else if (body.nombre && body.nombre !== contacto.name) {
      contacto = await repos.contacts.upsertFromInbound(contacto.phone, body.nombre);
    }
    return {
      sesion: previa && contacto.phone === previa.c ? body.sesion : firmarSesionWeb(secreto, contacto.phone, ahora().getTime()),
      contactoId: contacto.id,
      nombre: contacto.name,
      negocio: ajustes?.nombreNegocio() ?? config.businessName,
      // Si el numero esta vinculado, el widget puede ofrecer seguir por WhatsApp.
      whatsappVinculado: deps.settings.isConfigured() && (deps.wa.conectado?.() ?? true),
    };
  });

  // --- mensajes ----------------------------------------------------------------
  app.post('/web/mensajes', async (request, reply) => {
    const body = z.object({ sesion: z.string().max(400), texto: z.string().trim().min(1).max(2000) }).parse(request.body ?? {});
    const sesion = sesionDe(body.sesion);
    if (!sesion) return reply.code(401).send({ error: 'la sesion del chat no vale o caduco' });
    if (!pasaTope(`s:${sesion.c}`, TOPE_SESION_MIN) || !pasaTope(`ip:${request.ip}`, TOPE_IP_MIN)) {
      return reply.code(429).send({ error: 'demasiados mensajes seguidos, espera un momento' });
    }
    const contacto = await repos.contacts.getByPhone(sesion.c);
    if (!contacto) return reply.code(401).send({ error: 'la conversacion ya no existe' });

    // El mismo camino que un mensaje de WhatsApp: se guarda, lo lee el
    // asistente o las reglas, y lo ve el equipo en Chats.
    const mensaje: InboundMessage = {
      id: nuevoIdMensajeWeb('in'),
      from: contacto.phone,
      timestamp: String(Math.floor(ahora().getTime() / 1000)),
      type: 'text',
      text: { body: body.texto },
    };
    // La respuesta al visitante sale por el flujo de eventos; aqui no se
    // espera a que el asistente termine, para que el widget no se quede
    // colgado mientras piensa el modelo.
    void handleInboundMessage(mensaje, contacto.name ?? undefined, deps).catch((error) =>
      request.log.warn({ err: error, contacto: contacto.id }, 'fallo un mensaje del canal web'),
    );
    return { ok: true, id: mensaje.id };
  });

  // --- historial ----------------------------------------------------------------
  app.get('/web/historial', async (request, reply) => {
    const q = z.object({ sesion: z.string().max(400), limite: z.coerce.number().int().positive().max(100).default(50) }).parse(request.query ?? {});
    const sesion = sesionDe(q.sesion);
    if (!sesion) return reply.code(401).send({ error: 'la sesion del chat no vale o caduco' });
    const contacto = await repos.contacts.getByPhone(sesion.c);
    if (!contacto) return reply.code(401).send({ error: 'la conversacion ya no existe' });
    const mensajes = await repos.messages.listMessages(contacto.id, q.limite);
    return {
      nombre: contacto.name,
      mensajes: mensajes.map((m) => ({ id: m.wamid ?? String(m.id), direccion: m.direction === 'in' ? 'yo' : 'negocio', texto: m.body, tipo: m.kind, datos: m.payload, fecha: m.createdAt })),
    };
  });

  // --- en vivo ------------------------------------------------------------------
  app.get('/web/eventos', async (request, reply) => {
    const q = z.object({ sesion: z.string().max(400) }).parse(request.query ?? {});
    const sesion = sesionDe(q.sesion);
    if (!sesion) return reply.code(401).send({ error: 'la sesion del chat no vale o caduco' });
    const bus = deps.bus;
    if (!bus) return reply.code(503).send({ error: 'el flujo en vivo no esta activo' });

    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      ...(request.headers.origin ? { 'access-control-allow-origin': request.headers.origin, vary: 'Origin' } : {}),
    });
    reply.raw.write(': conectado\n\n');
    const soltar = bus.escucharTodo((evento: NombreEvento, payload) => {
      if (evento !== 'mensaje.enviado') return;
      const p = payload as { contacto: { telefono: string }; mensaje: { id: string | null; tipo: string; texto: string | null; fecha: string } };
      if (p.contacto.telefono !== sesion.c) return;
      reply.raw.write(`event: mensaje\ndata: ${JSON.stringify({ id: p.mensaje.id, direccion: 'negocio', texto: p.mensaje.texto, tipo: p.mensaje.tipo, fecha: p.mensaje.fecha })}\n\n`);
    });
    const latido = setInterval(() => reply.raw.write(': latido\n\n'), 25_000);
    const cerrar = () => {
      clearInterval(latido);
      soltar();
    };
    request.raw.on('close', cerrar);
    request.raw.on('error', cerrar);
  });

  // --- el widget y la demo -------------------------------------------------------
  app.get('/web/widget.js', async (_request, reply) =>
    reply.type('application/javascript; charset=utf-8').header('cache-control', 'public, max-age=300').send(widgetScript(origenPropio)),
  );

  app.get('/web/demo', async (_request, reply) =>
    reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(paginaDemo({ origen: origenPropio, negocio: ajustes?.nombreNegocio() ?? config.businessName })),
  );
}
