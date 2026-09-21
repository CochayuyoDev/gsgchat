/**
 * La API publica: la puerta para otros sistemas.
 *
 * /admin es la API del panel: cambia cuando cambia la pantalla y lo puede
 * todo. Esto es lo contrario: pocos caminos, nombres que no se mueven, cada
 * ruta con el permiso que exige (ver src/auth/permisos.ts) y un contrato
 * escrito en /api/v1/openapi.json. Stoky, GSG o un script en cualquier
 * lenguaje entran por aqui con una clave acotada y no ven nada mas.
 *
 * Por dentro llama a lo mismo que el panel: `sender` con sus guardas y los
 * repositorios de siempre. No hay un segundo camino para enviar: un mensaje
 * bloqueado por un gate vuelve como 202 con su motivo, no como 200.
 */

import { NOMBRE_SISTEMA } from '../../marca.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../../config.js';
import { normalizePhone, type Repos } from '../../db/repos.js';
import type { Sender, SendOutcome } from '../../outbound/sender.js';
import type { OutboundQueue } from '../../outbound/queue.js';
import { providerOf, type SettingsService } from '../../settings/service.js';
import type { WhatsAppClient } from '../../whatsapp/client.js';
import type { Politica } from '../../salud/politica.js';
import { politicaDesdeConfig } from '../../salud/politica.js';
import { dailyCapFor } from '../../outbound/throttle.js';
import { extractLocation } from '../../geo/extract.js';
import { DESCRIPCION_EVENTOS, NOMBRES_EVENTOS, esNombreEvento, type Bus, type NombreEvento } from '../../eventos/bus.js';
import { permisosAceptables } from '../../auth/permisos.js';
import { DURACION_MAX_MIN, DURACION_POR_DEFECTO_MIN, firmarTokenEmbebido, PERMISOS_EMBEBIDO_MAX, secretoDeEmbebido } from '../../embed/token.js';
import { PERMISOS } from '../../auth/permisos.js';
import { generarSecretoWebhook } from '../../webhooks/firma.js';
import { entregarUna, type DespachadorDeps } from '../../webhooks/despachador.js';
import { openApi } from './openapi.js';
import { confirmacionSchema } from '../../ia/ordenes.js';
import type { ServicioIA } from '../../ia/servicio.js';
import { ErrorIA } from '../../ia/proveedores.js';
import type { ServicioVoz } from '../../voz/servicio.js';
import { extensionDe, idDeMedia, mediaDirectory } from '../../whatsapp/local/media.js';
import { MAX_BYTES_ADJUNTO, tipoDeAdjuntoSaliente } from '../../admin/chat-routes.js';

export interface ApiV1Deps {
  repos: Repos;
  config: Config;
  settings: SettingsService;
  sender: Sender;
  queue: OutboundQueue;
  wa: WhatsAppClient;
  politica?: () => Politica;
  /** Para "probar" un webhook desde la API: el mismo fetch del despachador. */
  webhooks?: Pick<DespachadorDeps, 'fetchImpl' | 'timeoutMs' | 'version'>;
  /** El bus de eventos, para el flujo en vivo (SSE). Sin el, la ruta responde 503. */
  bus?: Bus;
  /** La IA operadora, para que otro sistema le de ordenes con palabras. Sin ella, 503. */
  ia?: ServicioIA;
  /** La voz del asistente (ver src/voz): `voz: true` en POST /mensajes manda el texto como nota de voz. Sin ella, sale por escrito y se dice. */
  voz?: ServicioVoz;
  /** Donde se guardan los ficheros que llegan por URL (`media`), para que el chat los pinte. */
  mediaDir?: string;
  /** Con que se bajan los ficheros de `media.url`. Para pruebas. */
  fetchImpl?: typeof fetch;
  ahora?: () => Date;
}

/** Los tipos de fichero con nombres en espanol (y en ingles, por si acaso). */
const TIPOS_MEDIA: Record<string, 'image' | 'video' | 'audio' | 'document'> = {
  imagen: 'image',
  foto: 'image',
  image: 'image',
  video: 'video',
  audio: 'audio',
  documento: 'document',
  archivo: 'document',
  document: 'document',
  file: 'document',
};

const mediaSchema = z.object({
  /** De donde se baja el fichero (http o https). */
  url: z.string().trim().url().max(2000),
  /** imagen | video | audio | documento. Sin el, se deduce del tipo del fichero. */
  tipo: z.string().trim().toLowerCase().max(20).optional(),
  caption: z.string().max(1024).optional(),
  /** El nombre con el que se ensena un documento. */
  nombre: z.string().trim().max(200).optional(),
  /** Un audio como nota de voz (con la onda y el play). */
  voz: z.boolean().optional(),
});

const telefonoSchema = z.string().min(6).max(30).transform((v) => normalizePhone(v));

const paginaSchema = z.object({
  q: z.string().max(120).optional(),
  limite: z.coerce.number().int().positive().max(200).default(50),
  desde: z.coerce.number().int().nonnegative().default(0),
});

const mensajeSchema = z
  .object({
    telefono: telefonoSchema,
    nombre: z.string().max(200).optional(),
    texto: z.string().min(1).max(4000).optional(),
    /** UTILITY por defecto. Marketing pasa por sus propios topes. */
    categoria: z.enum(['UTILITY', 'MARKETING']).default('UTILITY'),
    plantilla: z
      .object({ nombre: z.string().min(1), idioma: z.string().default('es'), variables: z.array(z.string()).default([]) })
      .optional(),
    /** Coordenadas, o un link de mapa (se extraen igual que en el chat). */
    ubicacion: z
      .union([
        z.object({ lat: z.number(), lng: z.number(), nombre: z.string().max(200).optional(), direccion: z.string().max(300).optional() }),
        z.string().min(3).max(2000),
      ])
      .optional(),
    pedirUbicacion: z.boolean().optional(),
    /** Registrar el consentimiento en la misma llamada: de donde sale. */
    consentimiento: z.object({ origen: z.string().min(2).max(200) }).optional(),
    /** Una foto, un video, un audio o un documento, por URL. */
    media: mediaSchema.optional(),
    /** Mandar `texto` como nota de voz con la voz del asistente (ver Mi asistente IA → Voz). Si no se puede, sale por escrito y la respuesta lo dice. */
    voz: z.boolean().optional(),
    /** Quien lo manda, para el hilo y el webhook: 'persona' (un asesor escribiendo desde el otro sistema), 'ia' (una IA de alli) o 'sistema' (lo automatico; por defecto). */
    autor: z.enum(['persona', 'ia', 'sistema']).optional(),
    /** El nombre de pila de quien lo manda (un asesor): sale en el hilo y en el webhook. */
    autorNombre: z.string().trim().max(80).optional(),
  })
  .refine((b) => b.texto || b.plantilla || b.ubicacion || b.pedirUbicacion || b.media, {
    message: 'hace falta texto, plantilla, ubicacion, pedirUbicacion o media',
  });

/** Baja el fichero de `media.url`: como mucho 16 MB, y en 30 s. */
async function bajarMedia(url: string, fetchImpl: typeof fetch): Promise<{ ok: true; datos: Buffer; mimeType: string } | { ok: false; error: string }> {
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'media.url tiene que empezar por http:// o https://' };
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), 30_000);
  try {
    const r = await fetchImpl(url, { signal: controlador.signal, redirect: 'follow' });
    if (!r.ok) return { ok: false, error: `no se pudo bajar media.url: respondio ${r.status}` };
    const largo = Number(r.headers.get('content-length') ?? 0);
    if (largo > MAX_BYTES_ADJUNTO) return { ok: false, error: 'WhatsApp no acepta ficheros de mas de 16 MB' };
    const datos = Buffer.from(await r.arrayBuffer());
    if (!datos.length) return { ok: false, error: 'media.url devolvio un fichero vacio' };
    if (datos.length > MAX_BYTES_ADJUNTO) return { ok: false, error: 'WhatsApp no acepta ficheros de mas de 16 MB' };
    const mimeType = (r.headers.get('content-type') ?? 'application/octet-stream').split(';')[0]!.trim().toLowerCase();
    return { ok: true, datos, mimeType };
  } catch (error) {
    const abortado = error instanceof Error && error.name === 'AbortError';
    return { ok: false, error: abortado ? 'media.url tardo mas de 30 s en responder' : `no se pudo bajar media.url: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    clearTimeout(temporizador);
  }
}

/** Lo que devuelve un envio, con nombres que no cambian. */
function respuestaDeEnvio(outcome: SendOutcome) {
  if (outcome.ok) return { codigo: 200, cuerpo: { ok: true, estado: 'enviado', mensajeId: outcome.wamid, entregaId: outcome.deliveryId } };
  if (outcome.blocked) {
    return {
      codigo: 202,
      cuerpo: {
        ok: false,
        estado: 'bloqueado',
        codigo: outcome.code,
        motivo: outcome.reason,
        reintentarEnMs: outcome.retryAfterMs ?? null,
        entregaId: outcome.deliveryId,
      },
    };
  }
  return { codigo: 502, cuerpo: { ok: false, estado: 'error', error: outcome.error, reintentable: outcome.retryable, entregaId: outcome.deliveryId } };
}

const contactoHaciaFuera = (c: { id: string; phone: string; name: string | null; optInAt: Date | null; optInSource: string | null; optOutAt: Date | null; lastInboundAt: Date | null }) => ({
  id: c.id,
  telefono: c.phone,
  nombre: c.name,
  consentimiento: c.optInAt ? { desde: c.optInAt, origen: c.optInSource } : null,
  baja: c.optOutAt,
  ultimoMensajeAt: c.lastInboundAt,
});

declare module 'fastify' {
  interface FastifyInstance {
    /** Las rutas de /api/v1 tal como quedaron registradas: para comprobar el OpenAPI. */
    rutasApiV1: Array<{ metodo: string; ruta: string; permiso: string | null }>;
  }
}

export async function registerApiV1(app: FastifyInstance, deps: ApiV1Deps): Promise<void> {
  const { repos, config, settings, sender, queue, wa } = deps;

  const rutas: FastifyInstance['rutasApiV1'] = [];
  app.decorate('rutasApiV1', rutas);
  app.addHook('onRoute', (r) => {
    if (!r.url.startsWith('/api/v1')) return;
    for (const metodo of Array.isArray(r.method) ? r.method : [r.method]) {
      if (metodo === 'HEAD') continue;
      rutas.push({ metodo, ruta: r.url, permiso: (r.config as { permiso?: string } | undefined)?.permiso ?? null });
    }
  });
  const ventanaObliga = () => providerOf(settings.current()) === 'cloud';
  const phoneNumberId = () => settings.current().phoneNumberId || 'local';
  const politica = (): Politica =>
    deps.politica?.() ?? politicaDesdeConfig(config, providerOf(settings.current()) === 'cloud' ? 'cloud' : 'no_oficial');
  const ahora = () => deps.ahora?.() ?? new Date();

  /**
   * A que hilo se limita quien pide. Un token del chat embebido emitido para
   * un telefono solo ve y escribe ese telefono; todo lo demas, 403.
   */
  const fueraDeAlcance = (usuario: { embebido?: { telefono: string | null } } | null, phone: string): boolean =>
    Boolean(usuario?.embebido?.telefono && usuario.embebido.telefono !== phone);
  const ERROR_ALCANCE = { error: 'este token solo abre la conversacion para la que se emitio' };

  /**
   * Escrito a mano por una persona (chat embebido): se salta el ritmo y los
   * cupos, como en /chat, pero solo fuera de la Cloud API (ahi la ventana y
   * el opt-in los impone Meta y saltarselos aqui no cambia nada).
   */
  const aMano = (usuario: { embebido?: unknown } | null): boolean => Boolean(usuario?.embebido) && !ventanaObliga();

  // --- contrato ------------------------------------------------------------

  app.get('/api/v1', async () => ({
    nombre: NOMBRE_SISTEMA,
    version: 'v1',
    documentacion: '/api/v1/openapi.json',
    eventos: '/api/v1/eventos',
    permisos: PERMISOS,
  }));

  app.get('/api/v1/openapi.json', async () => openApi(config.PUBLIC_BASE_URL));

  app.get('/api/v1/eventos', async () => ({
    eventos: NOMBRES_EVENTOS.map((nombre) => ({ nombre, descripcion: DESCRIPCION_EVENTOS[nombre] })),
    firma: 'X-Firma: t=<segundos>,v1=<hmac sha256 hex de "<t>.<cuerpo>" con el secreto del webhook>',
  }));

  // --- estado --------------------------------------------------------------

  app.get('/api/v1/estado', { config: { permiso: 'estado:leer' } }, async () => {
    const ahora = new Date();
    const estado = await repos.numberState.get(phoneNumberId());
    const configurado = settings.isConfigured();
    return {
      proveedor: providerOf(settings.current()),
      configurado,
      conectado: configurado && (wa.conectado?.() ?? true),
      numero: {
        calidad: estado.quality,
        nivel: estado.nivel ?? 'verde',
        pausado: estado.paused,
        motivoPausa: estado.pausedReason,
        tier: estado.tier,
      },
      cupoDiario: dailyCapFor(estado.warmupStartedOn, ahora, politica().warmup),
      enviadosHoy: await repos.counters.totalForDay(phoneNumberId(), ahora),
      cola: await queue.counts(),
      ventana24hAplica: ventanaObliga(),
      fecha: ahora,
    };
  });

  // --- mensajes ------------------------------------------------------------

  app.post('/api/v1/mensajes', { config: { permiso: 'mensajes:enviar' } }, async (request, reply) => {
    const body = mensajeSchema.parse(request.body ?? {});
    const phone = body.telefono;
    if (fueraDeAlcance(request.usuario, phone)) return reply.code(403).send(ERROR_ALCANCE);
    const manual = aMano(request.usuario);

    // El contacto nace aqui si no existia; el consentimiento solo si lo dicen.
    await repos.contacts.upsertFromInbound(phone, body.nombre);
    if (body.consentimiento) await repos.contacts.setOptIn(phone, body.consentimiento.origen);
    // Quien lo manda, para el hilo (y el webhook): lo que diga el otro sistema; si no, es "sistema".
    const origen = body.autor;
    const autorNombre = body.autorNombre || undefined;
    // Si pidieron nota de voz: como salio al final, y por que, si fue por escrito.
    let voz: { pedida: boolean; enviada: boolean; motivo: string | null } | null = null;

    let outcome: SendOutcome;
    if (body.pedirUbicacion) {
      outcome = await sender.send({
        phone,
        kind: 'interactive',
        manual,
        origen,
        autorNombre,
        category: 'UTILITY',
        interactive: { body: body.texto?.trim() || 'Comparte tu ubicación con el botón de aquí abajo, por favor.', locationRequest: true },
      });
    } else if (body.media) {
      const kindPedido = body.media.tipo ? TIPOS_MEDIA[body.media.tipo] : undefined;
      if (body.media.tipo && !kindPedido) return reply.code(400).send({ error: 'media.tipo tiene que ser imagen, video, audio o documento' });
      const bajado = await bajarMedia(body.media.url, deps.fetchImpl ?? fetch);
      if (!bajado.ok) return reply.code(400).send({ error: bajado.error });
      const kind = kindPedido ?? tipoDeAdjuntoSaliente(bajado.mimeType);
      // Un tipo generico (octet-stream) con nombre: la extension del nombre manda.
      const extension = extensionDe(bajado.mimeType, kind) === '.bin' && body.media.nombre?.includes('.') ? `.${body.media.nombre.split('.').pop()!.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin'}` : extensionDe(bajado.mimeType, kind);
      const id = idDeMedia(`api:${randomUUID()}`, extension);
      await writeFile(path.join(deps.mediaDir ?? mediaDirectory(), id), bajado.datos);
      outcome = await sender.send({
        phone,
        kind: 'media',
        category: body.categoria,
        manual,
        origen,
        autorNombre,
        media: { id, kind, datos: bajado.datos, mimeType: bajado.mimeType, filename: body.media.nombre || undefined, caption: body.media.caption?.trim() || undefined, voz: kind === 'audio' && Boolean(body.media.voz) },
      });
    } else if (body.voz && body.texto) {
      if (!deps.voz) {
        outcome = await sender.send({ phone, kind: 'freeform', category: body.categoria, manual, origen, autorNombre, text: body.texto });
        voz = { pedida: true, enviada: false, motivo: 'La voz no está configurada en este sistema (Mi asistente IA → Voz): salió por escrito.' };
      } else {
        const r = await deps.voz.enviar({ phone, texto: body.texto, origen, autorNombre, manual, categoria: body.categoria });
        outcome = r.outcome;
        voz = { pedida: true, enviada: r.enviadoComo === 'audio', motivo: r.motivo };
      }
    } else if (body.ubicacion) {
      let location: { latitude: number; longitude: number; name?: string; address?: string };
      if (typeof body.ubicacion === 'string') {
        const r = await extractLocation(body.ubicacion, { bbox: config.bbox });
        if (!r.ok) return reply.code(400).send({ error: `no se encontraron coordenadas en la ubicacion: ${r.reason}` });
        location = { latitude: r.lat, longitude: r.lng };
      } else {
        location = { latitude: body.ubicacion.lat, longitude: body.ubicacion.lng, name: body.ubicacion.nombre, address: body.ubicacion.direccion };
      }
      outcome = await sender.send({ phone, kind: 'location', category: 'UTILITY', manual, origen, autorNombre, location });
    } else if (body.plantilla) {
      const template =
        (await repos.templates.get(body.plantilla.nombre, body.plantilla.idioma)) ??
        (await repos.templates.list()).find((t) => t.name === body.plantilla!.nombre) ??
        null;
      if (!template) return reply.code(400).send({ error: `la plantilla "${body.plantilla.nombre}" no existe en este sistema` });
      outcome = await sender.send({
        phone,
        kind: 'template',
        manual,
        origen,
        autorNombre,
        category: template.category,
        templateName: template.name,
        templateLanguage: template.language,
        variables: body.plantilla.variables,
      });
    } else {
      outcome = await sender.send({ phone, kind: 'freeform', category: body.categoria, manual, origen, autorNombre, text: body.texto! });
    }

    const r = respuestaDeEnvio(outcome);
    return reply.code(r.codigo).send(voz ? { ...r.cuerpo, voz } : r.cuerpo);
  });

  // --- conversaciones ------------------------------------------------------

  app.get('/api/v1/conversaciones', { config: { permiso: 'conversaciones:leer' } }, async (request) => {
    const q = paginaSchema.parse(request.query ?? {});
    // Un token limitado a un telefono ve solo ese chat: la lista es de uno.
    const limite = request.usuario?.embebido?.telefono;
    const items = (await repos.messages.listConversations({ q: limite ?? q.q, limit: q.limite, offset: q.desde })).filter((c) => !limite || c.phone === limite);
    return {
      conversaciones: items.map((c) => ({
        contactoId: c.contactId,
        telefono: c.phone,
        nombre: c.name,
        ventanaAbierta: c.windowOpen,
        noLeidos: c.unread,
        baja: c.optOutAt,
        ultimoMensaje: c.lastMessage
          ? { direccion: c.lastMessage.direction === 'in' ? 'entrante' : 'saliente', tipo: c.lastMessage.kind, texto: c.lastMessage.body, estado: c.lastMessage.status, fecha: c.lastMessage.createdAt }
          : null,
      })),
      limite: q.limite,
      desde: q.desde,
      hayMas: items.length === q.limite,
    };
  });

  app.get<{ Params: { telefono: string } }>('/api/v1/conversaciones/:telefono', { config: { permiso: 'conversaciones:leer' } }, async (request, reply) => {
    const q = z
      .object({
        limite: z.coerce.number().int().positive().max(200).default(60),
        antesDe: z.coerce.number().int().positive().optional(),
      })
      .parse(request.query ?? {});
    const phone = normalizePhone(request.params.telefono);
    if (fueraDeAlcance(request.usuario, phone)) return reply.code(403).send(ERROR_ALCANCE);
    const contact = await repos.contacts.getByPhone(phone);
    if (!contact) return reply.code(404).send({ error: 'no hay ningun contacto con ese telefono' });

    const messages = await repos.messages.listMessages(contact.id, q.limite, q.antesDe);
    const ventanaAbierta = Boolean(contact.lastInboundAt && Date.now() - contact.lastInboundAt.getTime() < 24 * 60 * 60 * 1000);
    const puedeEscribir = (ventanaAbierta || !ventanaObliga()) && !contact.optOutAt;
    return {
      contacto: contactoHaciaFuera(contact),
      ventanaAbierta,
      puedeEscribir,
      motivo: contact.optOutAt
        ? 'el contacto se dio de baja'
        : puedeEscribir
          ? null
          : 'la ventana de 24 h esta cerrada: solo se puede enviar una plantilla',
      mensajes: messages.map((m) => {
        const p = (m.payload ?? {}) as { origen?: unknown; autorNombre?: unknown; transcripcion?: unknown; anuncio?: unknown; media?: { voz?: unknown } };
        return {
          id: m.id,
          mensajeId: m.wamid,
          direccion: m.direction === 'in' ? 'entrante' : 'saliente',
          tipo: m.kind,
          texto: m.body,
          // Quien lo mando (solo salientes): persona | ia | sistema. Y lo que dijo en una nota de voz (solo entrantes transcritos).
          autor: m.direction === 'out' ? (p.origen === 'persona' || p.origen === 'ia' ? p.origen : 'sistema') : null,
          autorNombre: m.direction === 'out' && typeof p.autorNombre === 'string' ? p.autorNombre : null,
          transcripcion: typeof p.transcripcion === 'string' ? p.transcripcion : null,
          anuncio: p.anuncio && typeof p.anuncio === 'object' ? p.anuncio : null,
          voz: p.media?.voz === true,
          datos: m.payload,
          estado: m.status,
          fecha: m.createdAt,
        };
      }),
      hayMas: messages.length === q.limite,
    };
  });

  /** Abrir el chat en la pantalla embebida marca lo entrante como leido. */
  app.post<{ Params: { telefono: string } }>('/api/v1/conversaciones/:telefono/leido', { config: { permiso: 'conversaciones:leer' } }, async (request, reply) => {
    const phone = normalizePhone(request.params.telefono);
    if (fueraDeAlcance(request.usuario, phone)) return reply.code(403).send(ERROR_ALCANCE);
    const contact = await repos.contacts.getByPhone(phone);
    if (!contact) return reply.code(404).send({ error: 'no hay ningun contacto con ese telefono' });
    await repos.messages.markRead(contact.id, ahora());
    return { ok: true };
  });

  // --- chat embebido -------------------------------------------------------

  /**
   * Un token para la pantalla embebida. Lo pide el SERVIDOR del otro
   * sistema con su clave (la clave nunca viaja al navegador); el token si,
   * y caduca. Con `telefono`, solo abre ese hilo.
   */
  app.post('/api/v1/embed/token', { config: { permiso: 'embed:emitir' } }, async (request, reply) => {
    const body = z
      .object({
        operador: z.string().trim().min(1).max(80),
        telefono: telefonoSchema.optional(),
        permisos: z.array(z.string()).optional(),
        duracionMin: z.coerce.number().int().min(1).max(DURACION_MAX_MIN).default(DURACION_POR_DEFECTO_MIN),
      })
      .parse(request.body ?? {});
    // Lo que pida, acotado a lo que un chat puede necesitar y a lo que la
    // propia clave tiene: nadie emite mas de lo que es.
    const pedidos = permisosAceptables(body.permisos);
    if ('error' in pedidos) return reply.code(400).send({ error: pedidos.error });
    const propios = request.usuario?.permisos ?? [];
    const permisos = (pedidos.permisos.includes('*') ? [...PERMISOS_EMBEBIDO_MAX] : pedidos.permisos.filter((p) => (PERMISOS_EMBEBIDO_MAX as readonly string[]).includes(p))).filter(
      (p) => propios.includes('*') || propios.includes(p),
    );
    if (!permisos.length) return reply.code(400).send({ error: `el token necesita al menos un permiso de: ${PERMISOS_EMBEBIDO_MAX.join(', ')}` });
    const momento = ahora().getTime();
    const token = firmarTokenEmbebido(secretoDeEmbebido(config), { operador: body.operador, telefono: body.telefono ?? null, permisos }, body.duracionMin, momento);
    return { ok: true, token, caduca: new Date(momento + body.duracionMin * 60_000), permisos, telefono: body.telefono ?? null, url: `${config.PUBLIC_BASE_URL.replace(/\/+$/, '')}/embed/chat` };
  });

  /**
   * Lo que pasa, en vivo (Server-Sent Events). Es lo que mantiene al dia
   * la pantalla embebida sin preguntar cada pocos segundos. Un token
   * limitado a un telefono recibe solo lo de ese telefono.
   */
  app.get('/api/v1/eventos/stream', { config: { permiso: 'conversaciones:leer' } }, async (request, reply) => {
    const bus = deps.bus;
    if (!bus) return reply.code(503).send({ error: 'el flujo de eventos no esta activo en este arranque' });
    const limite = request.usuario?.embebido?.telefono ?? null;
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write(': conectado\n\n');
    const telefonoDe = (payload: unknown): string | null => {
      const p = payload as { contacto?: { telefono?: string } } | null;
      return p?.contacto?.telefono ?? null;
    };
    const soltar = bus.escucharTodo((evento: NombreEvento, payload) => {
      const tel = telefonoDe(payload);
      // mensaje.estado no trae telefono: pasa siempre (es un doble check).
      if (limite && tel && tel !== limite) return;
      reply.raw.write(`event: ${evento}\ndata: ${JSON.stringify(payload)}\n\n`);
    });
    const latido = setInterval(() => reply.raw.write(': latido\n\n'), 25_000);
    const cerrar = () => {
      clearInterval(latido);
      soltar();
    };
    request.raw.on('close', cerrar);
    request.raw.on('error', cerrar);
  });

  // --- contactos -----------------------------------------------------------

  app.get('/api/v1/contactos', { config: { permiso: 'contactos:leer' } }, async (request) => {
    const q = paginaSchema.parse(request.query ?? {});
    const { items, total } = await repos.contacts.list({ q: q.q, limit: q.limite, offset: q.desde });
    return { contactos: items.map(contactoHaciaFuera), total, limite: q.limite, desde: q.desde };
  });

  app.get<{ Params: { telefono: string } }>('/api/v1/contactos/:telefono', { config: { permiso: 'contactos:leer' } }, async (request, reply) => {
    const contact = await repos.contacts.getByPhone(normalizePhone(request.params.telefono));
    if (!contact) return reply.code(404).send({ error: 'no hay ningun contacto con ese telefono' });
    return { contacto: contactoHaciaFuera(contact) };
  });

  /**
   * Alta con consentimiento. El origen es obligatorio: es la prueba de por
   * que se le escribe, y sin el nada iniciado por la empresa puede salir.
   */
  app.post('/api/v1/contactos', { config: { permiso: 'contactos:escribir' } }, async (request, reply) => {
    const body = z
      .object({
        telefono: telefonoSchema,
        nombre: z.string().max(200).optional(),
        consentimiento: z.object({ origen: z.string().min(2).max(200) }).optional(),
      })
      .parse(request.body ?? {});
    const existia = await repos.contacts.getByPhone(body.telefono);
    await repos.contacts.upsertFromInbound(body.telefono, body.nombre);
    if (body.consentimiento) await repos.contacts.setOptIn(body.telefono, body.consentimiento.origen);
    const contact = await repos.contacts.getByPhone(body.telefono);
    return reply.code(existia ? 200 : 201).send({ ok: true, contacto: contact ? contactoHaciaFuera(contact) : null });
  });

  app.post<{ Params: { telefono: string } }>('/api/v1/contactos/:telefono/baja', { config: { permiso: 'contactos:escribir' } }, async (request, reply) => {
    const phone = normalizePhone(request.params.telefono);
    const contact = await repos.contacts.getByPhone(phone);
    if (!contact) return reply.code(404).send({ error: 'no hay ningun contacto con ese telefono' });
    await repos.contacts.setOptOut(phone);
    return { ok: true };
  });

  // --- plantillas ----------------------------------------------------------

  app.get('/api/v1/plantillas', { config: { permiso: 'plantillas:leer' } }, async () => {
    const todas = await repos.templates.list();
    return {
      plantillas: todas
        .filter((t) => t.status === 'APPROVED')
        .map((t) => ({
          nombre: t.name,
          idioma: t.language,
          categoria: t.category,
          variables: t.variables,
          cuerpo: t.body,
          calidad: t.quality,
          pausadaHasta: t.pausadaHasta ?? null,
        })),
    };
  });

  // --- pedidos del chat -----------------------------------------------------

  app.get('/api/v1/pedidos', { config: { permiso: 'pedidos:gestionar' } }, async (request) => {
    const q = z
      .object({ estado: z.enum(['nuevo', 'confirmado', 'cancelado', 'enviado_tienda']).optional(), limite: z.coerce.number().int().positive().max(200).default(50), desde: z.coerce.number().int().nonnegative().default(0) })
      .parse(request.query ?? {});
    const r = await repos.pedidos.listar({ estado: q.estado, limit: q.limite, offset: q.desde });
    return { pedidos: r.items, total: r.total, porEstado: await repos.pedidos.contarPorEstado() };
  });

  app.get<{ Params: { id: string } }>('/api/v1/pedidos/:id', { config: { permiso: 'pedidos:gestionar' } }, async (request, reply) => {
    const p = await repos.pedidos.obtener(Number(request.params.id));
    if (!p) return reply.code(404).send({ error: 'ese pedido no existe' });
    return { pedido: p };
  });

  /** Confirmar, cancelar o marcar que la tienda ya lo tiene (con su id). */
  app.patch<{ Params: { id: string } }>('/api/v1/pedidos/:id', { config: { permiso: 'pedidos:gestionar' } }, async (request, reply) => {
    const body = z.object({ estado: z.enum(['nuevo', 'confirmado', 'cancelado', 'enviado_tienda']), externoId: z.string().max(120).optional() }).parse(request.body ?? {});
    const p = await repos.pedidos.cambiarEstado(Number(request.params.id), body.estado, body.externoId);
    if (!p) return reply.code(404).send({ error: 'ese pedido no existe' });
    return { ok: true, pedido: p };
  });

  // --- webhooks ------------------------------------------------------------

  const eventosSchema = z
    .array(z.string())
    .default(['*'])
    .transform((lista) => [...new Set(lista.map((e) => e.trim()).filter(Boolean))])
    .refine((lista) => lista.every((e) => e === '*' || esNombreEvento(e)), {
      message: `eventos validos: ${NOMBRES_EVENTOS.join(', ')} o *`,
    })
    .transform((lista) => (lista.length === 0 || lista.includes('*') ? ['*'] : lista));

  const urlSchema = z
    .string()
    .url()
    .max(2000)
    .refine((u) => /^https?:\/\//i.test(u), { message: 'la URL tiene que empezar por http:// o https://' });

  // --- la IA operadora para otros sistemas ---------------------------------
  //
  // Stoky (o cualquier programa con clave) le manda una orden con palabras y
  // recibe lo hecho y lo pendiente. Ejecuta con los permisos de la clave:
  // una clave acotada solo llega a lo que /api/v1 le deja; con '*' opera el
  // panel entero. Lo pendiente de confirmar se confirma con una segunda
  // llamada (la persona lo vio en la pantalla del otro sistema).
  const ordenApiSchema = z.object({
    texto: z.string().trim().min(1).max(4000),
    historial: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(6000) })).max(24).default([]),
    simular: z.boolean().default(false),
  });

  app.post('/api/v1/ia/ordenes', { config: { permiso: 'ia:ordenar' } }, async (request, reply) => {
    if (!deps.ia) return reply.code(503).send({ error: 'la IA operadora no esta activa en este arranque' });
    if (!deps.ia.estado().tieneToken) return reply.code(409).send({ error: 'la IA no esta conectada: un administrador tiene que conectar Puter en Mi asistente IA' });
    const body = ordenApiSchema.parse(request.body ?? {});
    try {
      const r = await deps.ia.ordenar(body, request.usuario!);
      return { texto: r.texto, hechas: r.hechas, pendientes: r.pendientes, simulado: r.simulado };
    } catch (error) {
      if (error instanceof ErrorIA) return reply.code(error.detalle === 'operador' ? 429 : 502).send({ error: error.message });
      throw error;
    }
  });

  app.post('/api/v1/ia/ordenes/confirmar', { config: { permiso: 'ia:ordenar' } }, async (request, reply) => {
    if (!deps.ia) return reply.code(503).send({ error: 'la IA operadora no esta activa en este arranque' });
    const body = confirmacionSchema.parse(request.body ?? {});
    try {
      return { hechas: await deps.ia.ejecutarConfirmadas(body.acciones, request.usuario!) };
    } catch (error) {
      if (error instanceof ErrorIA) return reply.code(502).send({ error: error.message });
      throw error;
    }
  });

  app.get('/api/v1/ia/ordenes/catalogo', { config: { permiso: 'ia:ordenar' } }, async (_request, reply) => {
    if (!deps.ia) return reply.code(503).send({ error: 'la IA operadora no esta activa en este arranque' });
    return { acciones: deps.ia.catalogoOperador() };
  });

  app.get('/api/v1/webhooks', { config: { permiso: 'webhooks:gestionar' } }, async () => ({ webhooks: await repos.webhooks.listar() }));

  /** Crea el webhook y devuelve el secreto: es la unica vez que se ve. */
  app.post('/api/v1/webhooks', { config: { permiso: 'webhooks:gestionar' } }, async (request, reply) => {
    const body = z
      .object({ url: urlSchema, descripcion: z.string().max(200).default(''), eventos: eventosSchema })
      .parse(request.body ?? {});
    const secreto = generarSecretoWebhook();
    const webhook = await repos.webhooks.crear({
      url: body.url,
      descripcion: body.descripcion,
      secreto,
      eventos: body.eventos,
      creadoPor: request.usuario && !request.usuario.porToken ? request.usuario.id : null,
    });
    return reply.code(201).send({ ok: true, webhook, secreto });
  });

  app.get<{ Params: { id: string } }>('/api/v1/webhooks/:id', { config: { permiso: 'webhooks:gestionar' } }, async (request, reply) => {
    const webhook = await repos.webhooks.obtener(request.params.id);
    if (!webhook) return reply.code(404).send({ error: 'ese webhook no existe' });
    return { webhook };
  });

  app.patch<{ Params: { id: string } }>('/api/v1/webhooks/:id', { config: { permiso: 'webhooks:gestionar' } }, async (request, reply) => {
    const body = z
      .object({ url: urlSchema.optional(), descripcion: z.string().max(200).optional(), eventos: eventosSchema.optional(), activo: z.boolean().optional() })
      .parse(request.body ?? {});
    const webhook = await repos.webhooks.actualizar(request.params.id, body);
    if (!webhook) return reply.code(404).send({ error: 'ese webhook no existe' });
    return { ok: true, webhook };
  });

  app.delete<{ Params: { id: string } }>('/api/v1/webhooks/:id', { config: { permiso: 'webhooks:gestionar' } }, async (request, reply) => {
    const ok = await repos.webhooks.borrar(request.params.id);
    if (!ok) return reply.code(404).send({ error: 'ese webhook no existe' });
    return { ok: true };
  });

  /** Un secreto nuevo (el anterior deja de valer en el acto). */
  app.post<{ Params: { id: string } }>('/api/v1/webhooks/:id/secreto', { config: { permiso: 'webhooks:gestionar' } }, async (request, reply) => {
    const secreto = generarSecretoWebhook();
    const ok = await repos.webhooks.rotarSecreto(request.params.id, secreto);
    if (!ok) return reply.code(404).send({ error: 'ese webhook no existe' });
    return { ok: true, secreto };
  });

  app.get<{ Params: { id: string } }>('/api/v1/webhooks/:id/entregas', { config: { permiso: 'webhooks:gestionar' } }, async (request, reply) => {
    const q = z.object({ limite: z.coerce.number().int().positive().max(200).default(50) }).parse(request.query ?? {});
    const webhook = await repos.webhooks.obtener(request.params.id);
    if (!webhook) return reply.code(404).send({ error: 'ese webhook no existe' });
    return { entregas: await repos.webhooks.entregas(webhook.id, q.limite) };
  });

  /** Devuelve a la cola lo que fallo (tras arreglar el otro lado). */
  app.post<{ Params: { id: string } }>('/api/v1/webhooks/:id/reencolar', { config: { permiso: 'webhooks:gestionar' } }, async (request, reply) => {
    const webhook = await repos.webhooks.obtener(request.params.id);
    if (!webhook) return reply.code(404).send({ error: 'ese webhook no existe' });
    const n = await repos.webhooks.reencolarFallidas(webhook.id, new Date());
    return { ok: true, reencoladas: n };
  });

  /**
   * Manda un evento de prueba AHORA, sin pasar por la cola, y cuenta que
   * contesto el otro lado. Es lo primero que se hace al conectar un sistema.
   */
  app.post<{ Params: { id: string } }>('/api/v1/webhooks/:id/probar', { config: { permiso: 'webhooks:gestionar' } }, async (request, reply) => {
    const webhook = await repos.webhooks.conSecreto(request.params.id);
    if (!webhook) return reply.code(404).send({ error: 'ese webhook no existe' });
    const ahora = new Date();
    const resultado = await entregarUna(
      webhook,
      { id: 0, evento: 'prueba.ping', payload: { mensaje: `hola desde ${NOMBRE_SISTEMA}`, fecha: ahora.toISOString() }, createdAt: ahora, intentos: 0 },
      deps.webhooks ?? {},
    );
    return { ok: resultado.ok, codigo: resultado.codigo, respuesta: resultado.respuesta, error: resultado.error ?? null };
  });
}
