/**
 * Los chats de GSG: lo que usa el motorizado desde la web de GSG.
 *
 *  GET  /api/v1/chat?tracking=…   el historial de mensajes del WhatsApp de ese tracking (conversaciones:leer).
 *                                 GSG lo pide al abrir un chat y GSGchat responde en esa misma llamada.
 *  POST /api/v1/chat              un usuario de GSG escribe: GSGchat lo manda por WhatsApp al numero de ese
 *                                 tracking, lo apunta con quien lo escribio y calla al bot (mensajes:enviar).
 *
 * En las dos GSG manda SOLO el tracking: el telefono ya lo dio en POST /api/v1/entregas y esta guardado en el
 * pedido (si GSG lo corrigio despues, vale el corregido). Un cliente con varios trackings tiene un solo chat.
 *
 * Se registra desde src/server.ts, igual que las entregas de GSG (ver entregas-gsg.ts). Las claves y los
 * permisos son los de siempre: `conversaciones:leer` para leer y `mensajes:enviar` para escribir.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Repos } from '../../db/repos.js';
import type { Sender } from '../../outbound/sender.js';
import { respuestaDeEnvio } from './routes.js';
import { trackingDeEntrega } from '../../entregas/repo.js';

export interface ApiConversacionesGsgDeps {
  repos: Repos;
  sender: Sender;
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

const mensajeSchema = z.object({
  tracking: z.string().trim().min(1).max(191),
  texto: z.string().trim().min(1).max(4000),
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
});

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
    const p = (m.payload ?? {}) as { origen?: unknown; autorNombre?: unknown; transcripcion?: unknown; anuncio?: unknown; emisor?: unknown; media?: { voz?: unknown } };
    return {
      id: m.wamid,
      cursor: m.id,
      direccion: m.direction === 'in' ? 'entrante' : 'saliente',
      tipo: m.kind,
      texto: m.body,
      transcripcion: typeof p.transcripcion === 'string' ? p.transcripcion : null,
      anuncio: p.anuncio && typeof p.anuncio === 'object' ? p.anuncio : null,
      datos: m.payload,
      fecha: m.createdAt,
      // Quien lo mando (solo salientes): persona | ia | sistema. Si lo escribio un usuario de GSG, `emisor` dice cual.
      autor: m.direction === 'out' ? (p.origen === 'persona' || p.origen === 'ia' ? p.origen : 'sistema') : null,
      autorNombre: m.direction === 'out' && typeof p.autorNombre === 'string' ? p.autorNombre : null,
      emisor: m.direction === 'out' && p.emisor && typeof p.emisor === 'object' ? p.emisor : null,
      voz: p.media?.voz === true,
      estado: m.status,
    };
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
      mensajes: messages.map(mensajeDeChat),
      hayMas: messages.length === q.limite,
    };
  };
  app.get('/api/v1/chat', { config: { permiso: 'conversaciones:leer' } }, leerChat);
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
      const outcome = await sender.send({
        phone: entrega.phone,
        kind: 'freeform',
        category: 'UTILITY',
        text: b.texto,
        // Lo escribio una persona de GSG: sale firmado asi y el bot se calla en este chat.
        origen: 'persona',
        autorNombre: b.usuario.nombre,
        atiendePersona: true,
        // Y lo tecleo de verdad, en la pantalla de GSG: igual que en el chat de
        // aqui. Asi el envio no finge el tecleo (hasta 9 s de "escribiendo...")
        // ni espera turno detras de la cola automatica, y las guardas de
        // consentimiento y volumen no aplican, que son para las campanas.
        manual: true,
        emisor: { tipo: 'gsg', usuarioId: b.usuario.id, rol: b.usuario.rol ?? null, tracking, idExterno: b.idExterno },
      });
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
