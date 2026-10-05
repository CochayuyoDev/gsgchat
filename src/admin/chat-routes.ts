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
import { readFile, writeFile } from 'node:fs/promises';
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

/**
 * Lo que la pantalla puede ofrecer con el proveedor que hay puesto.
 *
 * La regla es simple y vale la pena repetirla: es mejor una accion que no
 * esta que una que esta y falla. La pantalla se dibuja a partir de esto, asi
 * que un boton solo aparece donde de verdad hace algo.
 *
 *  - eliminar para todos: la Cloud API de Meta NO lo permite; un mensaje
 *    enviado por ahi no se puede retirar, punto. Con WAHA depende del motor
 *    del contenedor, y "depende" no es suficiente para pintar un boton.
 *  - editar: idem. Solo el cliente local (Baileys) lo tiene.
 *  - presencia ("escribiendo...", "ult. vez"): solo el que tiene sesion
 *    propia y puede suscribirse al contacto.
 */
export function capacidadesDelChat(proveedor: string): {
  citar: boolean;
  reaccionar: boolean;
  eliminarParaTodos: boolean;
  editar: boolean;
  presencia: boolean;
} {
  const local = proveedor === 'local';
  return {
    citar: true,
    reaccionar: true,
    eliminarParaTodos: local,
    editar: local,
    presencia: local,
  };
}

/** Un wamid inventado por nosotros (no vino de WhatsApp): no sirve para actuar sobre el mensaje. */
export function esWamidPropio(wamid: string | null): boolean {
  return !wamid || /^(local:|web:|waha:local:)/.test(wamid);
}

const adjuntoSchema = z.object({
  contactId: z.string().min(1),
  /** El fichero en base64 (con o sin el prefijo data:...;base64,). */
  datos: z.string().min(1),
  mimeType: z.string().trim().min(3).max(120),
  filename: z.string().trim().max(200).optional(),
  caption: z.string().trim().max(1024).optional(),
  /** Un audio grabado aqui mismo: sale como nota de voz, con su onda y su play. */
  voz: z.boolean().optional(),
  citaId: z.coerce.number().int().positive().optional(),
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
  /** Responder citando un mensaje del hilo (su id de fila, no el wamid). */
  citaId: z.coerce.number().int().positive().optional(),
  /** Fuera de la ventana de 24 h solo sale una plantilla aprobada. */
  templateName: z.string().optional(),
  templateLanguage: z.string().default('es'),
  variables: z.array(z.string()).default([]),
});

/**
 * Las entidades HTML de una etiqueta <meta> o <title> ya como texto.
 *
 * Google Maps manda el titulo como `12°04&#39;39.0"S`: la pagina del chat lo
 * escapa otra vez al pintarlo y se veia `&#39;` tal cual (30/09). Se decodifica
 * aqui, una sola vez; el que pinta sigue escapando como siempre.
 */
export function decodificarEntidades(texto: string): string {
  const nombradas: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entera, cuerpo: string) => {
    if (cuerpo[0] === '#') {
      const n = cuerpo[1] === 'x' || cuerpo[1] === 'X' ? parseInt(cuerpo.slice(2), 16) : parseInt(cuerpo.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : entera;
    }
    return nombradas[cuerpo.toLowerCase()] ?? entera;
  });
}

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

  /**
   * El mensaje del hilo, listo para citarlo, reaccionarlo, borrarlo o editarlo.
   *
   * Se busca SIEMPRE dentro de la conversacion, no por id suelto: asi un id
   * inventado no deja actuar sobre el mensaje de otro cliente. Y se comprueba
   * que tenga identificador de WhatsApp de verdad: sobre un mensaje que solo
   * existe aqui (los importados, los de la web) WhatsApp no sabe actuar.
   */
  const citaDelHilo = async (
    contactId: string,
    mensajeId: number,
  ): Promise<{ id: string; fromMe: boolean; texto: string; participant?: string; autor?: string } | { error: string }> => {
    const m = await repos.messages.porId(contactId, mensajeId);
    if (!m) return { error: 'ese mensaje no está en esta conversación' };
    if (esWamidPropio(m.wamid)) {
      return { error: 'ese mensaje no tiene identificador de WhatsApp (llegó importado): no se puede responder ni actuar sobre él' };
    }
    // En un grupo, quien lo escribio: sin esto la cita sale sin autor.
    const autor = (m.payload as { autor?: { telefono?: string | null; nombre?: string | null } } | null)?.autor;
    return {
      id: m.wamid!,
      fromMe: m.direction === 'out',
      texto: (m.body ?? '').slice(0, 300),
      ...(autor?.telefono ? { participant: `${autor.telefono}@s.whatsapp.net` } : {}),
      ...(autor?.nombre ? { autor: autor.nombre } : {}),
    };
  };

  app.get('/admin/chat/conversations', async (request) => {
    const query = z
      .object({
        q: z.string().max(120).optional(),
        limit: z.coerce.number().int().positive().max(200).default(50),
        offset: z.coerce.number().int().nonnegative().default(0),
        /** Los chats apartados solo salen cuando se piden. */
        incluirApartados: z.coerce.boolean().default(false),
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
      contacto: { id: contact.id, phone: contact.phone, name: contact.name, tipo: contact.tipo ?? 'persona', optInAt: contact.optInAt, optOutAt: contact.optOutAt, lastInboundAt: contact.lastInboundAt, botPausadoAt: contact.botPausadoAt ?? null, iaCerradaAt: contact.iaCerradaAt ?? null },
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
    // Lo que este proveedor sabe hacer, para que la pantalla no pinte botones
    // que no funcionan. Se manda con el hilo porque cambia al cambiar de
    // proveedor, y la pantalla no tiene por que saber cual hay puesto.
    const puede = capacidadesDelChat(providerOf(settings.current()));

    if (contact.tipo === 'grupo') {
      return {
        contact,
        reparto: null,
        windowOpen: true,
        canWrite: gruposDisponibles(),
        blockedReason: gruposDisponibles() ? null : SIN_GRUPOS,
        messages,
        hasMore: messages.length === query.limit,
        puede,
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
      puede,
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
   * El agente operativo cerro este chat (mando su cierre): una persona lo
   * atiende. `cerrado: false` se lo devuelve al asistente; `true` lo cierra a mano.
   */
  app.post('/admin/chat/:contactId/asistente', async (request, reply) => {
    const { contactId } = request.params as { contactId: string };
    const body = z.object({ cerrado: z.boolean() }).safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'Falta decir si el asistente atiende o no este chat.' });
    const contact = await repos.contacts.getById(contactId);
    if (!contact) return reply.code(404).send({ error: 'Ese chat ya no existe.' });
    await repos.contacts.cerrarIA(contact.id, body.data.cerrado, new Date(), body.data.cerrado ? 'lo cerró una persona desde Chats' : null);
    return { ok: true, cerrado: body.data.cerrado };
  });

  /**
   * Volver a empezar con un cliente con el que ya se termino: el asistente
   * vuelve a atenderlo, el bot deja de estar callado y se levanta cualquier
   * freno, para que su siguiente pedido corra desde el principio. Sus
   * mensajes y sus pedidos se quedan como estan.
   */
  app.post('/admin/chat/:contactId/volver-a-empezar', async (request, reply) => {
    const { contactId } = request.params as { contactId: string };
    const contact = await repos.contacts.getById(contactId);
    if (!contact) return reply.code(404).send({ error: 'Ese chat ya no existe.' });
    if (contact.tipo === 'grupo') return reply.code(400).send({ error: 'Un grupo no tiene flujo que reiniciar.' });
    const ahora = new Date();
    await repos.contacts.cerrarIA(contact.id, false, ahora, null);
    await repos.contacts.pausarBot(contact.id, false, ahora);
    await repos.contacts.levantarSupresion(contact.phone);
    return { ok: true };
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

    // La cita: se resuelve aqui, contra el hilo, para que nadie pueda citar
    // un mensaje de otra conversacion pasando un id a mano.
    let cita;
    if (body.citaId) {
      if (!body.contactId) return reply.code(400).send({ error: 'para citar hace falta la conversación' });
      cita = await citaDelHilo(body.contactId, body.citaId);
      if ('error' in cita) return reply.code(400).send({ error: cita.error });
    }

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

    return sender.send({ phone, kind: 'freeform', category: 'UTILITY', text: body.text, manual: aMano(), ...firma, ...(cita && !('error' in cita) ? { cita } : {}) });
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

    let cita;
    if (body.citaId) {
      cita = await citaDelHilo(contact.id, body.citaId);
      if ('error' in cita) return reply.code(400).send({ error: cita.error });
    }

    return sender.send({
      phone: contact.phone,
      kind: 'media',
      category: 'UTILITY',
      manual: aMano(),
      ...quien(request, body),
      ...(cita && !('error' in cita) ? { cita } : {}),
      // Una nota de voz grabada aqui va como nota de voz de verdad (ptt), no
      // como fichero de audio: es la diferencia entre la onda con el play y
      // un adjunto que hay que descargar.
      media: { id, kind, datos, mimeType, filename: body.filename || undefined, caption: body.caption || undefined, voz: body.voz === true && kind === 'audio' },
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

  // --------------------------------------------- acciones sobre un mensaje

  /**
   * Reaccionar con un emoji, o quitar la propia reaccion (emoji vacio).
   *
   * Sale por el proveedor y ADEMAS se cuelga del mensaje aqui: si solo se
   * mandara, la reaccion propia no se veria hasta que WhatsApp la devolviera,
   * y con la Cloud API no la devuelve nunca.
   */
  app.post<{ Params: { contactId: string } }>('/admin/chat/:contactId/reaccion', async (request, reply) => {
    const body = z.object({ mensajeId: z.coerce.number().int().positive(), emoji: z.string().max(16) }).parse(request.body ?? {});
    const contact = await repos.contacts.getById(request.params.contactId);
    if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });
    if (!capacidadesDelChat(providerOf(settings.current())).reaccionar || !sender.accion) {
      return reply.code(400).send({ error: 'este WhatsApp no puede mandar reacciones' });
    }

    const mensaje = await citaDelHilo(contact.id, body.mensajeId);
    if ('error' in mensaje) return reply.code(400).send({ error: mensaje.error });

    const emoji = body.emoji.trim();
    await sender.accion({ phone: contact.phone, mensaje, tipo: 'reaccion', emoji });
    await repos.messages.reaccionar(mensaje.id, 'yo', emoji, new Date());
    return { ok: true, emoji };
  });

  /**
   * Quitar mensajes: "para mi" siempre, "para todos" solo donde el proveedor
   * lo permite (ver `capacidadesDelChat`).
   *
   * Ni un caso ni el otro borran la fila: se marcan y el hilo deja de
   * pintarlas. El respaldo y la traza siguen completos, que es lo que hace
   * falta el dia que alguien pregunta que se dijo.
   */
  app.post<{ Params: { contactId: string } }>('/admin/chat/:contactId/eliminar', async (request, reply) => {
    const body = z
      .object({ ids: z.array(z.coerce.number().int().positive()).min(1).max(50), paraTodos: z.boolean().default(false) })
      .parse(request.body ?? {});
    const contact = await repos.contacts.getById(request.params.contactId);
    if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });

    const fallos: string[] = [];
    if (body.paraTodos) {
      if (!capacidadesDelChat(providerOf(settings.current())).eliminarParaTodos || !sender.accion) {
        return reply.code(400).send({ error: 'este WhatsApp no puede eliminar un mensaje para todos: solo se puede quitar de aquí' });
      }
      for (const id of body.ids) {
        const mensaje = await citaDelHilo(contact.id, id);
        if ('error' in mensaje) { fallos.push(mensaje.error); continue; }
        try {
          await sender.accion({ phone: contact.phone, mensaje, tipo: 'eliminar' });
          await repos.messages.marcarBorradoPorRemitente(mensaje.id, new Date());
        } catch (error) {
          fallos.push(error instanceof Error ? error.message : 'no se pudo eliminar');
        }
      }
    }

    const quitados = await repos.messages.ocultar(contact.id, body.ids, new Date());
    return { ok: true, quitados, paraTodos: body.paraTodos, fallos };
  });

  /** Cambiar el texto de un mensaje ya enviado, donde el proveedor lo permita. */
  app.post<{ Params: { contactId: string } }>('/admin/chat/:contactId/editar', async (request, reply) => {
    const body = z.object({ mensajeId: z.coerce.number().int().positive(), texto: z.string().trim().min(1).max(4000) }).parse(request.body ?? {});
    const contact = await repos.contacts.getById(request.params.contactId);
    if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });
    if (!capacidadesDelChat(providerOf(settings.current())).editar || !sender.accion) {
      return reply.code(400).send({ error: 'este WhatsApp no puede editar un mensaje ya enviado' });
    }

    const mensaje = await citaDelHilo(contact.id, body.mensajeId);
    if ('error' in mensaje) return reply.code(400).send({ error: mensaje.error });
    if (!mensaje.fromMe) return reply.code(400).send({ error: 'solo se pueden editar los mensajes que mandaste tú' });

    await sender.accion({ phone: contact.phone, mensaje, tipo: 'editar', texto: body.texto });
    await repos.messages.editarCuerpo(contact.id, body.mensajeId, body.texto, new Date());
    return { ok: true };
  });

  /** La estrella: marcar o desmarcar mensajes para encontrarlos luego. */
  app.post<{ Params: { contactId: string } }>('/admin/chat/:contactId/destacar', async (request, reply) => {
    const body = z
      .object({ ids: z.array(z.coerce.number().int().positive()).min(1).max(100), destacado: z.boolean().default(true) })
      .parse(request.body ?? {});
    const contact = await repos.contacts.getById(request.params.contactId);
    if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });
    const cambiados = await repos.messages.destacar(contact.id, body.ids, body.destacado, new Date());
    return { ok: true, cambiados };
  });

  /** Los mensajes destacados: de este chat o de todos. */
  app.get('/admin/chat/destacados', async (request) => {
    const query = z
      .object({ contactId: z.string().optional(), limit: z.coerce.number().int().positive().max(200).default(60) })
      .parse(request.query ?? {});
    return { items: await repos.messages.destacados(query) };
  });

  /** Buscar dentro de una conversacion. Devuelve los mensajes que coinciden. */
  app.get<{ Params: { contactId: string } }>('/admin/chat/:contactId/buscar', async (request, reply) => {
    const query = z
      .object({ q: z.string().trim().min(1).max(120), limit: z.coerce.number().int().positive().max(200).default(100) })
      .parse(request.query ?? {});
    const contact = await repos.contacts.getById(request.params.contactId);
    if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });
    return { items: await repos.messages.buscar({ contactId: contact.id, q: query.q, limit: query.limit }) };
  });

  /**
   * Reenviar mensajes a otras conversaciones.
   *
   * Se reenvia el CONTENIDO, no el mensaje: WhatsApp no tiene "reenviar" en
   * ninguna de las tres APIs, asi que se vuelve a mandar. Por eso el globo
   * lleva la marca "Reenviado": para que quien lo lee sepa que no se escribio
   * para el.
   */
  app.post('/admin/chat/reenviar', async (request, reply) => {
    const body = z
      .object({
        origenId: z.string().min(1),
        ids: z.array(z.coerce.number().int().positive()).min(1).max(20),
        destinos: z.array(z.string().min(1)).min(1).max(20),
      })
      .parse(request.body ?? {});

    const origen = await repos.contacts.getById(body.origenId);
    if (!origen) return reply.code(404).send({ error: 'conversación de origen no encontrada' });
    const mensajes = await repos.messages.porIds(origen.id, body.ids);
    if (!mensajes.length) return reply.code(400).send({ error: 'no hay nada que reenviar' });

    const firma = quien(request, {});
    let enviados = 0;
    const fallos: string[] = [];

    for (const destinoId of body.destinos) {
      const destino = await repos.contacts.getById(destinoId);
      if (!destino) { fallos.push('una conversación ya no existe'); continue; }
      if (destino.tipo === 'grupo' && !gruposDisponibles()) { fallos.push(SIN_GRUPOS); continue; }

      for (const m of mensajes) {
        const media = (m.payload as { media?: { id: string; kind?: string; mimeType?: string; filename?: string; url?: string } } | null)?.media;
        try {
          // Un adjunto se reenvia leyendo el fichero de donde ya esta; lo demas
          // (texto, una ubicacion escrita, una plantilla ya renderizada) va como
          // texto, que es lo que el cliente vio.
          if (media?.id && media.kind !== 'sticker') {
            const datos = await readFile(path.join(deps.mediaDir ?? mediaDirectory(), media.id));
            const outcome = await sender.send({
              phone: destino.phone,
              kind: 'media',
              category: 'UTILITY',
              manual: aMano(),
              reenviado: true,
              ...firma,
              media: {
                id: media.id,
                kind: (media.kind as 'image' | 'video' | 'audio' | 'document') ?? 'document',
                datos,
                mimeType: media.mimeType ?? 'application/octet-stream',
                filename: media.filename,
                caption: (m.body ?? '').trim() || undefined,
              },
            });
            if (outcome.ok) enviados++;
            else fallos.push('reason' in outcome ? outcome.reason : outcome.error);
            continue;
          }

          const texto = (m.body ?? '').trim();
          if (!texto) { fallos.push('un mensaje sin texto no se puede reenviar'); continue; }
          const outcome = await sender.send({
            phone: destino.phone,
            kind: 'freeform',
            category: 'UTILITY',
            manual: aMano(),
            reenviado: true,
            ...firma,
            text: texto,
          });
          if (outcome.ok) enviados++;
          else fallos.push('reason' in outcome ? outcome.reason : outcome.error);
        } catch (error) {
          fallos.push(error instanceof Error ? error.message : 'no se pudo reenviar');
        }
      }
    }

    return { ok: enviados > 0, enviados, fallos };
  });

  /**
   * Como se ve el chat en la lista: fijado, silenciado, apartado, o de vuelta
   * a "sin leer". Lo que no venga en el cuerpo no se toca.
   */
  app.post<{ Params: { contactId: string } }>('/admin/chat/:contactId/lista', async (request, reply) => {
    const body = z
      .object({
        fijado: z.boolean().optional(),
        silenciado: z.boolean().optional(),
        apartado: z.boolean().optional(),
        noLeido: z.boolean().optional(),
      })
      .parse(request.body ?? {});
    const contact = await repos.contacts.getById(request.params.contactId);
    if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });

    await repos.contacts.ajustesChat(contact.id, body, new Date());
    if (body.noLeido === true) {
      // "Sin leer" es mover el puntero de lectura ANTES del ultimo entrante:
      // no hay marca por mensaje (ver `marcarNoLeido`).
      await repos.contacts.marcarNoLeido(contact.id, null);
    } else if (body.noLeido === false) {
      await repos.messages.markRead(contact.id, new Date());
    }
    return { ok: true };
  });

  /**
   * Si el otro lado esta escribiendo o en linea.
   *
   * Solo con el proveedor que puede saberlo. `null` es "no se sabe", y la
   * pantalla lo respeta: no inventa un "en línea" que no existe.
   */
  app.get<{ Params: { contactId: string } }>('/admin/chat/:contactId/presencia', async (request, reply) => {
    const contact = await repos.contacts.getById(request.params.contactId);
    if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });
    if (!capacidadesDelChat(providerOf(settings.current())).presencia || !sender.presencia) return { presencia: null };
    return { presencia: await sender.presencia(contact.phone) };
  });

  /**
   * La previa de un enlace: titulo, descripcion e imagen.
   *
   * Se pide desde el servidor porque el navegador no puede (el otro sitio no
   * deja). Con candado: solo http/https, solo hacia fuera (nada de la red
   * interna, que seria un agujero para leer servicios privados), un tope de
   * tamano y un plazo corto. Lo que no se pueda leer, no se pinta.
   */
  const previas = new Map<string, { titulo: string | null; descripcion: string | null; imagen: string | null; sitio: string }>();
  app.get('/admin/chat/previa', async (request, reply) => {
    const query = z.object({ url: z.string().url().max(600) }).parse(request.query ?? {});
    const cacheada = previas.get(query.url);
    if (cacheada) return cacheada;

    let destino: URL;
    try {
      destino = new URL(query.url);
    } catch {
      return reply.code(400).send({ error: 'ese enlace no se entiende' });
    }
    if (destino.protocol !== 'http:' && destino.protocol !== 'https:') {
      return reply.code(400).send({ error: 'solo se pueden previsualizar enlaces web' });
    }
    // La red de casa no se toca desde aqui: un enlace pegado por un cliente
    // no puede servir para leer un servicio interno.
    if (/^(localhost$|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1)/i.test(destino.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(destino.hostname)) {
      return reply.code(400).send({ error: 'ese enlace apunta a la red interna' });
    }

    try {
      const corte = AbortSignal.timeout(4000);
      const res = await fetch(destino, { signal: corte, redirect: 'follow', headers: { 'user-agent': 'WhatsApp/2.0' } });
      if (!res.ok) return reply.code(404).send({ error: 'el enlace no respondió' });
      const tipo = res.headers.get('content-type') ?? '';
      if (!tipo.includes('text/html')) return reply.code(415).send({ error: 'el enlace no es una página' });
      // 200 KB de cabecera bastan: las etiquetas og: van siempre arriba.
      const html = (await res.text()).slice(0, 200_000);
      const meta = (nombre: string) => {
        const re = new RegExp(`<meta[^>]+(?:property|name)=["']${nombre}["'][^>]*content=["']([^"']+)["']`, 'i');
        const alReves = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${nombre}["']`, 'i');
        return decodificarEntidades(html.match(re)?.[1] ?? html.match(alReves)?.[1] ?? '').trim() || null;
      };
      const previa = {
        titulo: meta('og:title') ?? (decodificarEntidades(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '').trim() || null),
        descripcion: meta('og:description') ?? meta('description'),
        imagen: meta('og:image'),
        sitio: destino.hostname.replace(/^www\./, ''),
      };
      previas.set(query.url, previa);
      // La memoria no es infinita: con mil enlaces cacheados se suelta el mas viejo.
      if (previas.size > 1000) previas.delete(previas.keys().next().value!);
      return previa;
    } catch (error) {
      return reply.code(504).send({ error: 'no se pudo leer el enlace: ' + (error instanceof Error ? error.message : 'sin respuesta') });
    }
  });
}
