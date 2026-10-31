/**
 * Los chats de GSG: lo que usa el motorizado desde la web de GSG.
 *
 *  GET  /api/v1/historial?tracking=…  el historial de mensajes del WhatsApp de ese tracking (conversaciones:leer).
 *                                 GSG lo pide al abrir un chat y GSGchat responde en esa misma llamada, con
 *                                 la nota automatica del chat (`nota`: la etiqueta que le puso la IA).
 *  POST /api/v1/chat              un usuario de GSG escribe: GSGchat lo manda por WhatsApp al numero de ese
 *                                 tracking, lo apunta con quien lo escribio y calla al bot (mensajes:enviar).
 *
 * En las dos GSG manda SOLO el tracking: el telefono ya lo dio en POST /api/v1/entregas y esta guardado en el
 * pedido (si GSG lo corrigio despues, vale el corregido). Un cliente con varios trackings tiene un solo chat.
 *
 * Se registra desde src/server.ts, igual que las entregas de GSG (ver entregas-gsg.ts). Las claves y los
 * permisos son los de siempre: `conversaciones:leer` para leer y `mensajes:enviar` para escribir.
 */

import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Repos } from '../../db/repos.js';
import type { Sender } from '../../outbound/sender.js';
import { respuestaDeEnvio, mediaSchema, TIPOS_MEDIA } from './routes.js';
import { bajarMedia } from './media-saliente.js';
import { tipoDeAdjuntoSaliente } from '../../admin/chat-routes.js';
import { extensionDe, idDeMedia, mediaDirectory } from '../../whatsapp/local/media.js';
import { archivoDeMensaje } from './archivos-gsg.js';
import { trackingDeEntrega } from '../../entregas/repo.js';
import { nombreDeEtiqueta } from '../../archive/clasificar.js';
import { catalogoVigente, numeroNormalizado } from '../../chat/etiquetar.js';

export interface ApiConversacionesGsgDeps {
  repos: Repos;
  sender: Sender;
  /**
   * Para los enlaces de los archivos del chat (`archivo.url`): la direccion
   * publica de la tienda y la clave que los firma. Sin ellos el historial sale
   * sin enlaces. Ver src/api/v1/archivos-gsg.ts.
   */
  archivos?: { publicBase: string; secreto: string };
  /** Donde se guardan los ficheros que GSG manda por URL (`media`), para que el chat los pinte. */
  mediaDir?: string;
  /** Con que se bajan los ficheros de `media.url`. Para pruebas. */
  fetchImpl?: typeof fetch;
}

/** Un token del chat embebido solo abre la conversacion para la que se emitio. */
const fueraDeAlcance = (usuario: { embebido?: { telefono: string | null } } | null | undefined, phone: string): boolean =>
  Boolean(usuario?.embebido?.telefono && usuario.embebido.telefono !== phone);
const ERROR_ALCANCE = { error: 'este token solo abre la conversacion para la que se emitio' };

const consultaSchema = z.object({
  tracking: z.string().trim().min(1).max(191),
  limite: z.coerce.number().int().positive().max(200).default(60),
  antesDe: z.coerce.number().int().positive().optional(),
});

/** Un id que GSG puede mandar como texto o como numero. */
const idDeGsg = z.union([z.string(), z.number()]).transform((v) => String(v).trim()).pipe(z.string().min(1).max(191));

const mensajeSchema = z
  .object({
  tracking: z.string().trim().min(1).max(191),
  /** El mensaje; con `media` es el pie de la foto, el video o el documento. */
  texto: z.string().trim().min(1).max(4000).optional(),
  /** Una foto, un video, un audio o un documento, por URL. */
  media: mediaSchema.optional(),
  /** El id que GSG le puso a este mensaje: con el, un reintento no se manda dos veces. */
  idExterno: idDeGsg,
  /** Quien escribe en GSG. */
  usuario: z.object({
    id: idDeGsg,
    /** El nombre que se ve en el chat (p. ej. el del motorizado). */
    nombre: z.string().trim().max(80).optional(),
    /** Su rol en GSG al momento de escribir (p. ej. motorizado, operador). */
    rol: z.string().trim().max(60).optional(),
  }),
  })
  .refine((b) => b.texto || b.media, { message: 'hace falta texto o media' });

/** `chat_id` (el nombre del diagrama de integracion) es el tracking: si no viene `tracking`, vale este. */
const conChatId = (entrada: unknown): Record<string, unknown> => {
  const e = entrada && typeof entrada === 'object' ? { ...(entrada as Record<string, unknown>) } : {};
  if (e.tracking === undefined && e.chat_id !== undefined) e.tracking = e.chat_id;
  delete e.chat_id;
  return e;
};

export async function registerApiConversacionesGsg(app: FastifyInstance, deps: ApiConversacionesGsgDeps): Promise<void> {
  const { repos, sender } = deps;
  /** Los idExterno que se estan enviando ahora mismo: dos llamadas iguales a la vez no mandan dos veces. */
  const enCurso = new Set<string>();

  const trackingDe = trackingDeEntrega;

  const mensajeDeChat = (m: Awaited<ReturnType<Repos['messages']['listMessages']>>[number]) => {
    const p = (m.payload ?? {}) as { origen?: unknown; textoFijo?: unknown; autorNombre?: unknown; transcripcion?: unknown; anuncio?: unknown; emisor?: unknown; media?: { voz?: unknown; transcripcion?: unknown } };
    // GSG no recibe la transcripción de los audios (regla del dueño, 28/10): el
    // audio se escucha con `archivo.url`. Un audio transcrito se guarda con lo que
    // dijo como cuerpo; aquí sale como «(audio)» y sin la transcripción en `datos`.
    const audio = m.kind === 'audio';
    let datos = m.payload;
    if (audio && datos) {
      const { transcripcion: _t, ...resto } = datos as Record<string, unknown>;
      const media = resto.media && typeof resto.media === 'object' ? (({ transcripcion: _mt, ...r }) => r)(resto.media as Record<string, unknown>) : resto.media;
      datos = { ...resto, ...(media !== undefined ? { media } : {}) };
    }
    return {
      id: m.wamid,
      cursor: m.id,
      direccion: m.direction === 'in' ? 'entrante' : 'saliente',
      tipo: m.kind,
      texto: audio && typeof p.transcripcion === 'string' ? '(audio)' : m.body,
      anuncio: p.anuncio && typeof p.anuncio === 'object' ? p.anuncio : null,
      datos,
      fecha: m.createdAt,
      // Quien lo mando (solo salientes): persona | ia | sistema. Si lo escribio un usuario de GSG, `emisor` dice cual.
      autor: m.direction === 'out' ? (p.origen === 'persona' || (p.origen === 'ia' && !p.textoFijo) ? p.origen : 'sistema') : null,
      autorNombre: m.direction === 'out' && typeof p.autorNombre === 'string' ? p.autorNombre : null,
      emisor: m.direction === 'out' && p.emisor && typeof p.emisor === 'object' ? p.emisor : null,
      voz: p.media?.voz === true,
      // La foto, el video, el audio o el documento: un enlace firmado que abre el fichero tal cual.
      archivo: deps.archivos ? archivoDeMensaje(m, deps.archivos) : null,
      estado: m.status,
    };
  };

  /**
   * La nota automatica del chat: la ultima etiqueta que le puso la IA (o una
   * persona a mano) a ese WhatsApp, con su nombre del catalogo del negocio.
   * Viaja en el historial que GSG ya pide al abrir el chat: GSG no necesita
   * otro endpoint. null si el chat aun no tiene etiqueta.
   */
  const notaDe = async (phone: string) => {
    const repo = repos.chatEtiquetas;
    if (!repo) return null;
    try {
      const e = (await repo.ultimas([numeroNormalizado(phone)])).get(numeroNormalizado(phone));
      if (!e?.etiqueta) return null;
      const catalogo = await catalogoVigente(repo);
      return {
        codigo: e.etiqueta,
        nombre: nombreDeEtiqueta(e.etiqueta, catalogo),
        descripcion: catalogo.find((x) => x.codigo === e.etiqueta)?.descripcion ?? null,
        dia: e.dia,
        origen: e.origen,
        actualizadaEn: e.updatedAt,
      };
    } catch {
      // La nota es un extra: si falla, el historial sale igual.
      return null;
    }
  };

  // --- GET: el historial -----------------------------------------------------

  const leerChat = async (request: FastifyRequest, reply: FastifyReply) => {
    const q = consultaSchema.parse(conChatId(request.query));
    const entrega = await repos.entregas.porTracking(q.tracking);
    if (!entrega) return reply.code(404).send({ error: 'no hay ningun pedido con ese tracking' });
    if (fueraDeAlcance(request.usuario, entrega.phone)) return reply.code(403).send(ERROR_ALCANCE);
    const contact = await repos.contacts.getByPhone(entrega.phone);
    if (!contact) return reply.code(404).send({ error: 'este pedido todavia no tiene chat' });
    const messages = await repos.messages.listMessages(contact.id, q.limite, q.antesDe);
    // Los trackings de ese WhatsApp: primero el pedido por el que se pregunto (aunque ya no este en curso) y
    // luego los demas en curso. Todos comparten este chat.
    const vivos = await repos.entregas.vivasPorTelefono(entrega.phone).catch(() => []);
    const tracking = [...new Set([trackingDe(entrega), ...vivos.map(trackingDe)])];
    return {
      tracking,
      contacto: { id: contact.id, telefono: contact.phone, nombre: contact.name },
      nota: await notaDe(contact.phone),
      mensajes: messages.map(mensajeDeChat),
      hayMas: messages.length === q.limite,
    };
  };
  app.get('/api/v1/historial', { config: { permiso: 'conversaciones:leer' } }, leerChat);
  // Los mismos handlers con los nombres del diagrama de integracion: `chat_id` es el tracking.
  app.get('/api/v1/messages', { config: { permiso: 'conversaciones:leer' } }, leerChat);

  // --- POST: un usuario de GSG escribe ----------------------------------------

  const escribirChat = async (request: FastifyRequest, reply: FastifyReply) => {
    const b = mensajeSchema.parse(conChatId(request.body));
    const guardados = repos.mensajesGsg;
    if (!guardados) return reply.code(503).send({ error: 'este arranque no guarda los mensajes de GSG: no se puede recibir' });

    const entrega = await repos.entregas.porTracking(b.tracking);
    if (!entrega) return reply.code(404).send({ error: 'no hay ningun pedido con ese tracking' });
    if (fueraDeAlcance(request.usuario, entrega.phone)) return reply.code(403).send(ERROR_ALCANCE);
    const tracking = trackingDe(entrega);

    // Un reintento de GSG: el mensaje ya salio, no se manda otra vez.
    const previo = await guardados.porIdExterno(b.idExterno);
    if (previo) {
      if (previo.tracking.toLowerCase() !== tracking.toLowerCase()) {
        return reply.code(409).send({ ok: false, codigo: 'ID_EXTERNO_REPETIDO', error: 'ese idExterno ya se uso con otro tracking' });
      }
      return { ok: true, estado: 'enviado', duplicado: true, mensajeId: previo.wamid };
    }
    if (enCurso.has(b.idExterno)) {
      return reply.code(409).send({ ok: false, codigo: 'EN_CURSO', error: 'ese mensaje se esta enviando ahora mismo: vuelve a intentarlo en unos segundos' });
    }

    enCurso.add(b.idExterno);
    try {
      // Lo escribio una persona de GSG: sale firmado asi y el bot se calla en este chat.
      // Y lo tecleo de verdad, en la pantalla de GSG: igual que en el chat de
      // aqui. Asi el envio no finge el tecleo (hasta 9 s de "escribiendo...")
      // ni espera turno detras de la cola automatica, y las guardas de
      // consentimiento y volumen no aplican, que son para las campanas.
      const comun = {
        phone: entrega.phone,
        category: 'UTILITY' as const,
        origen: 'persona' as const,
        autorNombre: b.usuario.nombre,
        atiendePersona: true,
        manual: true,
        emisor: { tipo: 'gsg' as const, usuarioId: b.usuario.id, rol: b.usuario.rol ?? null, tracking, idExterno: b.idExterno },
      };
      let outcome;
      if (b.media) {
        const kindPedido = b.media.tipo ? TIPOS_MEDIA[b.media.tipo] : undefined;
        if (b.media.tipo && !kindPedido) return reply.code(400).send({ error: 'media.tipo tiene que ser imagen, video, audio o documento' });
        const bajado = await bajarMedia(b.media.url, kindPedido, deps.fetchImpl ?? fetch);
        if (!bajado.ok) return reply.code(400).send({ error: bajado.error });
        const kind = kindPedido ?? tipoDeAdjuntoSaliente(bajado.mimeType);
        const pie = (b.texto ?? b.media.caption)?.trim() || undefined;
        if (kind === 'audio' && b.texto) return reply.code(400).send({ error: 'un audio no lleva texto: manda el audio solo y el texto en otro mensaje' });
        // Un tipo generico (octet-stream) con nombre: la extension del nombre manda.
        const porMime = extensionDe(bajado.mimeType, kind);
        const extension = porMime === '.bin' && b.media.nombre?.includes('.') ? `.${b.media.nombre.split('.').pop()!.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin'}` : porMime;
        const id = idDeMedia(`api:${randomUUID()}`, extension);
        await writeFile(path.join(deps.mediaDir ?? mediaDirectory(), id), bajado.datos);
        outcome = await sender.send({
          ...comun,
          kind: 'media',
          media: { id, kind, datos: bajado.datos, mimeType: bajado.mimeType, filename: b.media.nombre || undefined, caption: kind === 'audio' ? undefined : pie, voz: kind === 'audio' && Boolean(b.media.voz) },
        });
      } else {
        outcome = await sender.send({ ...comun, kind: 'freeform', text: b.texto! });
      }
      if (outcome.ok) {
        await guardados
          .guardar({ idExterno: b.idExterno, tracking, usuarioId: b.usuario.id, usuarioNombre: b.usuario.nombre ?? null, rol: b.usuario.rol ?? null, phone: entrega.phone, wamid: outcome.wamid ?? null })
          .catch(() => undefined);
      }
      const r = respuestaDeEnvio(outcome);
      return reply.code(r.codigo).send(outcome.ok ? { ...r.cuerpo, duplicado: false } : r.cuerpo);
    } finally {
      enCurso.delete(b.idExterno);
    }
  };
  app.post('/api/v1/chat', { config: { permiso: 'mensajes:enviar' } }, escribirChat);
  app.post('/api/v1/send-message', { config: { permiso: 'mensajes:enviar' } }, escribirChat);
}
