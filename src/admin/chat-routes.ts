/**
 * API del chat: conversaciones, hilo y envio.
 *
 * Es la misma tuberia que el resto del sistema (todo sale por `sender`, que
 * pasa por los gates), pero con la forma que necesita una pantalla de chat:
 * lista ordenada por lo mas reciente, hilo paginado hacia atras y no leidos.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { normalizePhone, type Repos } from '../db/repos.js';
import type { Sender } from '../outbound/sender.js';
import { providerOf, type SettingsService } from '../settings/service.js';
import { extractLocation } from '../geo/extract.js';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extensionDe, idDeMedia, mediaDirectory } from '../whatsapp/local/media.js';

export interface ChatDeps {
  repos: Repos;
  sender: Sender;
  config: Config;
  settings: SettingsService;
  /** Donde se guardan los ficheros que se mandan desde el chat (y los que llegan). */
  mediaDir?: string;
  /** La voz del asistente (ver src/voz): con `voz: true`, el texto sale como nota de voz. */
  voz?: import('../voz/servicio.js').ServicioVoz;
}

/** Lo maximo que se acepta desde el chat: el limite de video/documento de WhatsApp. */
export const MAX_BYTES_ADJUNTO = 16 * 1024 * 1024;

const adjuntoSchema = z.object({
  contactId: z.string().min(1),
  /** El fichero en base64 (con o sin el prefijo data:...;base64,). */
  datos: z.string().min(1),
  mimeType: z.string().trim().min(3).max(120),
  filename: z.string().trim().max(200).optional(),
  caption: z.string().trim().max(1024).optional(),
  autor: z.enum(['persona', 'ia', 'sistema']).optional(),
  autorNombre: z.string().trim().max(80).optional(),
});

/** Que es el fichero para WhatsApp, por su tipo. Un GIF va como documento: como foto llega quieto. */
export function tipoDeAdjuntoSaliente(mimeType: string): 'image' | 'video' | 'audio' | 'document' {
  const limpio = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (['image/jpeg', 'image/png', 'image/webp'].includes(limpio)) return 'image';
  if (limpio.startsWith('video/')) return 'video';
  if (limpio.startsWith('audio/')) return 'audio';
  return 'document';
}

const sendSchema = z.object({
  phone: z.string().min(6).optional(),
  contactId: z.string().optional(),
  text: z.string().min(1).max(4000).optional(),
  /** Link de mapa o coordenadas: se manda como pin de ubicacion. */
  location: z.string().min(1).optional(),
  /** Boton nativo para pedirle la ubicacion al cliente. */
  askLocation: z.boolean().optional(),
  /** Mandar el texto como nota de voz con la voz del asistente. Si no se puede, sale por escrito y se dice. */
  voz: z.boolean().optional(),
  /** Quien lo manda, si no es quien esta en sesion (el chat embebido de otro sistema lo dice). */
  autor: z.enum(['persona', 'ia', 'sistema']).optional(),
  autorNombre: z.string().trim().max(80).optional(),
  /** Fuera de la ventana de 24 h solo sale una plantilla aprobada. */
  templateName: z.string().optional(),
  templateLanguage: z.string().default('es'),
  variables: z.array(z.string()).default([]),
});

export async function registerChatRoutes(app: FastifyInstance, deps: ChatDeps): Promise<void> {
  const { repos, sender, config, settings } = deps;

  /**
   * Si la ventana de 24 h impide escribir texto libre.
   *
   * Es una regla de Meta, no nuestra: la Cloud API rechaza el mensaje. Con un
   * cliente no oficial no existe tal cosa, y aplicarla igual seria inventarse
   * una limitacion que el propio WhatsApp Web no tiene.
   */
  const ventanaObliga = () => providerOf(settings.current()) === 'cloud';

  /**
   * Si un envio escrito a mano puede saltarse las guardas de consentimiento y
   * volumen.
   *
   * Solo fuera de la Cloud API. Con Meta detras no es una decision nuestra:
   * la API rechaza el texto libre fuera de la ventana y exige el opt-in, asi
   * que saltarselo aqui solo serviria para mandar peticiones condenadas y
   * apuntar como enviado algo que no salio. Con un cliente no oficial no hay
   * tal regla, y el chat se comporta como el WhatsApp Web de siempre.
   */
  const aMano = () => !ventanaObliga();

  /**
   * Un grupo solo existe con el WhatsApp conectado por QR (Baileys): la
   * Cloud API de Meta no tiene grupos y WAHA no los trae por este camino.
   */
  const gruposDisponibles = () => providerOf(settings.current()) === 'local';
  const SIN_GRUPOS = 'Los grupos solo se pueden atender con el WhatsApp conectado por QR.';
  // Con la API de Meta hay boton nativo; con el QR no (llegan rotos a una
  // cuenta personal), asi que el texto explica el clip en vez de un boton
  // que no existe.
  const textoPedirUbicacion = () =>
    providerOf(settings.current()) === 'cloud' || config.WHATSAPP_NATIVE_BUTTONS
      ? 'Comparte tu ubicación con el botón de aquí abajo, por favor.'
      : '¿Nos compartes tu ubicación, por favor? Desde el clip 📎 → Ubicación → Enviar tu ubicación actual.';

  app.get('/admin/chat/conversations', async (request) => {
    const query = z
      .object({
        q: z.string().max(120).optional(),
        limit: z.coerce.number().int().positive().max(200).default(50),
        offset: z.coerce.number().int().nonnegative().default(0),
      })
      .parse(request.query ?? {});
    return {
      items: await repos.messages.listConversations(query),
      unread: await repos.messages.unreadTotal(),
    };
  });

  /**
   * La ficha del cliente para el panel lateral de Chats: quien es, si se le
   * puede escribir, su pedido de hoy (si lo hay), su ultima ubicacion y
   * cuantas conversaciones guardadas tiene. Solo lectura.
   */
  app.get<{ Params: { contactId: string } }>('/admin/chat/:contactId/ficha', async (request, reply) => {
    const contact = await repos.contacts.getById(request.params.contactId);
    if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });
    const ubicacion = await repos.locations.latestFor(contact.id).catch(() => null);
    let entrega: Record<string, unknown> | null = null;
    try {
      const viva = await repos.entregas.vivaPorTelefono(contact.phone);
      const e = viva ?? (await repos.entregas.listar({ estados: ['entregada'], limit: 500 })).filter((x) => x.phone === contact.phone).pop() ?? null;
      if (e) {
        const m = e.motorizadoId ? await repos.entregas.motorizado(e.motorizadoId).catch(() => null) : null;
        entrega = { id: e.id, referencia: e.referencia, estado: e.estado, direccion: e.direccion, distrito: e.distrito, ubicacionEstado: e.ubicacionEstado, confirmacionEstado: e.confirmacionEstado, motorizado: m ? { nombre: m.nombre, phone: m.phone } : null, llegaAproxAt: e.llegaAproxAt, entregadaAt: e.entregadaAt, incidencia: e.incidencia, prioridad: e.prioridad };
      }
    } catch {
      entrega = null;
    }
    const guardadas = await repos.archives.count({ contactId: contact.id }).catch(() => 0);
    return {
      contacto: { id: contact.id, phone: contact.phone, name: contact.name, tipo: contact.tipo ?? 'persona', optInAt: contact.optInAt, optOutAt: contact.optOutAt, lastInboundAt: contact.lastInboundAt, botPausadoAt: contact.botPausadoAt ?? null },
      ubicacion: ubicacion ? { lat: ubicacion.lat, lng: ubicacion.lng, mapa: `https://www.google.com/maps/search/?api=1&query=${ubicacion.lat},${ubicacion.lng}` } : null,
      entrega,
      guardadas,
    };
  });

  app.get<{ Params: { contactId: string } }>('/admin/chat/:contactId', async (request, reply) => {
    const query = z
      .object({
        limit: z.coerce.number().int().positive().max(200).default(60),
        before: z.coerce.number().int().positive().optional(),
        /** Abrir el chat marca lo entrante como leido; refrescar en segundo plano no. */
        read: z.coerce.boolean().default(false),
      })
      .parse(request.query ?? {});

    const contact = await repos.contacts.getById(request.params.contactId);
    if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });

    const messages = await repos.messages.listMessages(contact.id, query.limit, query.before);
    if (query.read) await repos.messages.markRead(contact.id, new Date());
    // La solicitud de reparto abierta, si la hay: el pedido y en que punto va,
    // para que quien atiende lo vea sin cambiar de pantalla (y para {pedido}).
    const abierta = await repos.rutas.abiertaPorTelefono(contact.phone).catch(() => null);
    const reparto = abierta ? { id: abierta.id, referencia: abierta.referencia, estado: abierta.estado, direccion: abierta.direccion, distrito: abierta.distrito, intentos: abierta.intentos } : null;

    const now = Date.now();
    const windowOpen = Boolean(
      contact.lastInboundAt && now - contact.lastInboundAt.getTime() < 24 * 60 * 60 * 1000,
    );

    // En un grupo no hay ventana de 24 h ni consentimiento: se escribe como
    // en el telefono, siempre que el proveedor tenga grupos.
    if (contact.tipo === 'grupo') {
      return {
        contact,
        reparto: null,
        windowOpen: true,
        canWrite: gruposDisponibles(),
        blockedReason: gruposDisponibles() ? null : SIN_GRUPOS,
        messages,
        hasMore: messages.length === query.limit,
      };
    }

    return {
      contact,
      reparto,
      windowOpen,
      // Lo que el operador puede escribir ahora mismo, y por que.
      canWrite: (windowOpen || !ventanaObliga()) && !contact.optOutAt,
      blockedReason: contact.optOutAt
        ? 'el contacto se dio de baja'
        : windowOpen || !ventanaObliga()
          ? null
          : 'la ventana de 24 h esta cerrada: solo se puede enviar una plantilla',
      messages,
      hasMore: messages.length === query.limit,
    };
  });

  app.post('/admin/chat/:contactId/read', async (request, reply) => {
    const { contactId } = request.params as { contactId: string };
    const contact = await repos.contacts.getById(contactId);
    if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });
    await repos.messages.markRead(contact.id, new Date());
    return { ok: true };
  });

  /**
   * Parar o soltar el bot en ESTE chat.
   *
   * Es la forma de decir "de esta conversacion me encargo yo": los mensajes
   * del cliente siguen entrando y guardandose, y se le puede escribir a mano
   * como siempre; lo unico que se calla es la respuesta automatica.
   *
   * No caduca. Un bot que vuelve a hablar solo al dia siguiente, en medio de
   * un reclamo que alguien estaba atendiendo, es peor que no haberlo parado.
   */
  app.post('/admin/chat/:contactId/bot', async (request, reply) => {
    const { contactId } = request.params as { contactId: string };
    const body = z.object({ pausado: z.boolean() }).parse(request.body ?? {});

    const contact = await repos.contacts.getById(contactId);
    if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });

    await repos.contacts.pausarBot(contact.id, body.pausado, new Date());
    return { ok: true, pausado: body.pausado };
  });

  /**
   * Envio desde el chat. Acepta texto, un link de mapa, el boton de ubicacion
   * o una plantilla; todo pasa por el sender, asi que las guardas siguen
   * puestas y el bloqueo se devuelve explicado.
   */
  /**
   * Quien manda desde el chat: la persona en sesion, con su nombre de pila,
   * salvo que el cuerpo diga otra cosa (el chat embebido de otro sistema
   * manda en nombre de su asesor). Va al hilo y al webhook (`autorNombre`).
   */
  const quien = (request: { usuario?: { nombre?: string | null; usuario?: string } | null }, body: { autor?: 'persona' | 'ia' | 'sistema'; autorNombre?: string }) => ({
    // Sin decir nada, quien escribe desde el chat es una persona: que el
    // hilo no lo apunte como 'sistema' solo porque la ventana de Meta obligue.
    origen: body.autor ?? 'persona',
    autorNombre: body.autorNombre?.trim() || (request.usuario?.nombre || request.usuario?.usuario || '').split(' ')[0] || undefined,
  });

  app.post('/admin/chat/send', async (request, reply) => {
    const body = sendSchema.parse(request.body);
    const firma = quien(request, body);

    let phone = body.phone ? normalizePhone(body.phone) : undefined;
    let esGrupo = false;
    if (!phone && body.contactId) {
      const contact = await repos.contacts.getById(body.contactId);
      if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });
      phone = contact.phone;
      esGrupo = contact.tipo === 'grupo';
    }
    if (!phone) return reply.code(400).send({ error: 'falta el telefono' });

    if (esGrupo) {
      if (!gruposDisponibles()) return reply.code(400).send({ error: SIN_GRUPOS });
      // Pedir la ubicacion o mandar una plantilla es cosa de un cliente, no
      // de un grupo: ahi solo tiene sentido escribir, un sticker o un pin.
      if (body.askLocation || body.templateName) {
        return reply.code(400).send({ error: 'En un grupo solo se puede escribir un mensaje, un sticker o mandar un pin.' });
      }
    }

    if (body.askLocation) {
      return sender.send({
        phone,
        kind: 'interactive',
        category: 'UTILITY',
        manual: aMano(),
        ...firma,
        interactive: {
          body: body.text?.trim() || textoPedirUbicacion(),
          locationRequest: true,
        },
      });
    }

    if (body.location) {
      const result = await extractLocation(body.location, { bbox: config.bbox });
      if (!result.ok) {
        return reply.code(400).send({ error: `no se encontraron coordenadas: ${result.reason}` });
      }
      const outcome = await sender.send({
        phone,
        kind: 'location',
        category: 'UTILITY',
        manual: aMano(),
        ...firma,
        location: { latitude: result.lat, longitude: result.lng },
      });
      return { ...outcome, location: result };
    }

    if (body.templateName) {
      /**
       * Se busca por nombre e idioma y, si no aparece, por nombre a secas.
       *
       * El catalogo del sistema esta en "es", pero una cuenta que venia de
       * antes puede tener la misma plantilla aprobada como "es_MX". Sin este
       * respaldo, el envio fallaba con un "no existe" que era mentira: existia,
       * con otra etiqueta de idioma.
       */
      const template =
        (await repos.templates.get(body.templateName, body.templateLanguage)) ??
        (await repos.templates.list()).find((t) => t.name === body.templateName) ??
        null;
      if (!template) {
        return reply.code(400).send({
          error: `La plantilla "${body.templateName}" no está dada de alta todavía. Sincronízala en el panel.`,
        });
      }
      return sender.send({
        phone,
        kind: 'template',
        category: template.category,
        manual: aMano(),
        ...firma,
        templateName: template.name,
        templateLanguage: template.language,
        variables: body.variables,
      });
    }

    if (!body.text?.trim()) return reply.code(400).send({ error: 'el mensaje va vacio' });

    if (body.voz) {
      if (!deps.voz) return reply.code(409).send({ error: 'La voz no está configurada: Mi asistente IA → Voz.' });
      const r = await deps.voz.enviar({ phone, texto: body.text, origen: firma.origen, autorNombre: firma.autorNombre, manual: aMano() });
      // Si salio por escrito, se dice: quien pulso "audio" tiene que saber que no fue audio.
      return { ...r.outcome, voz: { enviada: r.enviadoComo === 'audio', motivo: r.motivo } };
    }

    return sender.send({ phone, kind: 'freeform', category: 'UTILITY', text: body.text, manual: aMano(), ...firma });
  });

  /**
   * Una foto, un video, un audio o un documento escrito a mano desde el chat.
   *
   * Llega en base64 (pegado, arrastrado o elegido con el clip), se guarda en
   * la misma carpeta que los adjuntos que entran -con el mismo tipo de id,
   * para que el hilo lo pinte igual- y sale por el sender, con sus guardas.
   * El limite del cuerpo va aparte del general: 4 MB no dan para un video.
   */
  app.post('/admin/chat/adjunto', { bodyLimit: Math.ceil(MAX_BYTES_ADJUNTO * 1.4) + 64 * 1024 }, async (request, reply) => {
    const body = adjuntoSchema.parse(request.body ?? {});
    const contact = await repos.contacts.getById(body.contactId);
    if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });
    if (contact.tipo === 'grupo' && !gruposDisponibles()) return reply.code(400).send({ error: SIN_GRUPOS });

    const datos = Buffer.from(body.datos.replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!datos.length) return reply.code(400).send({ error: 'El fichero llegó vacío.' });
    if (datos.length > MAX_BYTES_ADJUNTO) return reply.code(400).send({ error: 'WhatsApp no acepta ficheros de más de 16 MB. Usa uno más ligero.' });

    const kind = tipoDeAdjuntoSaliente(body.mimeType);
    const mimeType = body.mimeType.split(';')[0]!.trim().toLowerCase();
    const extension = extensionDe(mimeType, kind === 'document' ? 'document' : kind) === '.bin' && body.filename?.includes('.')
      ? `.${body.filename.split('.').pop()!.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin'}`
      : extensionDe(mimeType, kind === 'document' ? 'document' : kind);
    const id = idDeMedia(`chat:${randomUUID()}`, extension);
    const dir = deps.mediaDir ?? mediaDirectory();
    await writeFile(path.join(dir, id), datos);

    return sender.send({
      phone: contact.phone,
      kind: 'media',
      category: 'UTILITY',
      manual: aMano(),
      ...quien(request, body),
      media: { id, kind, datos, mimeType, filename: body.filename || undefined, caption: body.caption || undefined },
    });
  });

  /** Abrir un chat con alguien que todavia no existe en la libreta. */
  app.post('/admin/chat/start', async (request) => {
    const body = z
      .object({ phone: z.string().min(6), name: z.string().max(200).optional() })
      .parse(request.body);
    const contact = await repos.contacts.upsertFromInbound(normalizePhone(body.phone), body.name);
    return { contact };
  });
}
