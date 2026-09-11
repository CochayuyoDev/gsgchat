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

export interface ChatDeps {
  repos: Repos;
  sender: Sender;
  config: Config;
  settings: SettingsService;
}

const sendSchema = z.object({
  phone: z.string().min(6).optional(),
  contactId: z.string().optional(),
  text: z.string().min(1).max(4000).optional(),
  /** Link de mapa o coordenadas: se manda como pin de ubicacion. */
  location: z.string().min(1).optional(),
  /** Boton nativo para pedirle la ubicacion al cliente. */
  askLocation: z.boolean().optional(),
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
   * Envio desde el chat. Acepta texto, un link de mapa, el boton de ubicacion
   * o una plantilla; todo pasa por el sender, asi que las guardas siguen
   * puestas y el bloqueo se devuelve explicado.
   */
  app.post('/admin/chat/send', async (request, reply) => {
    const body = sendSchema.parse(request.body);

    let phone = body.phone ? normalizePhone(body.phone) : undefined;
    if (!phone && body.contactId) {
      const contact = await repos.contacts.getById(body.contactId);
      if (!contact) return reply.code(404).send({ error: 'contacto no encontrado' });
      phone = contact.phone;
    }
    if (!phone) return reply.code(400).send({ error: 'falta el telefono' });

    if (body.askLocation) {
      return sender.send({
        phone,
        kind: 'interactive',
        category: 'UTILITY',
        manual: aMano(),
        interactive: {
          body: body.text?.trim() || 'Comparte tu ubicacion con el boton de abajo, por favor.',
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
        templateName: template.name,
        templateLanguage: template.language,
        variables: body.variables,
      });
    }

    if (!body.text?.trim()) return reply.code(400).send({ error: 'el mensaje va vacio' });

    return sender.send({ phone, kind: 'freeform', category: 'UTILITY', text: body.text, manual: aMano() });
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
