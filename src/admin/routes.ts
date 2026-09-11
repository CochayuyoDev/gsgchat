/**
 * API de operacion: campanas, estado del numero, contactos, ubicaciones,
 * entregas, plantillas y enlaces de rastreo. Protegida con un token de
 * administracion; no esta pensada para quedar expuesta a internet sin un
 * proxy delante.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { normalizePhone, type Repos, type TemplateCategory } from '../db/repos.js';
import type { OutboundQueue } from '../outbound/queue.js';
import { dailyCapFor } from '../outbound/throttle.js';
import { createTrackingSession } from '../tracking/routes.js';
import { buildTrackingUrls } from '../tracking/tokens.js';
import type { TrackingHub } from '../tracking/realtime.js';
import type { Sender } from '../outbound/sender.js';
import { extractLocation } from '../geo/extract.js';
import type { SettingsService } from '../settings/service.js';
import type { WhatsAppClient } from '../whatsapp/client.js';
import { CATALOG } from '../templates/catalog.js';
import { lintTemplate } from '../templates/lint.js';
import { syncTemplates } from '../templates/registry.js';
import { pushTemplates } from '../templates/push.js';
import { registerAutomationRoutes } from './automation-routes.js';
import { registerChatRoutes } from './chat-routes.js';
import { registerLeadsRoutes } from './leads-routes.js';
import { registerArchiveRoutes } from './archive-routes.js';
import { archivarConversacion } from '../archive/service.js';
import { registerRutasRoutes } from './rutas-routes.js';
import { crearPuertoGsg } from '../rutas/gsg.js';
import { opcionesDesdeConfig } from '../rutas/motor.js';
import type { Monitor } from '../salud/monitor.js';
import { politicaDesdeConfig, type Politica } from '../salud/politica.js';
import { providerOf } from '../settings/service.js';
import { canarioPorDefecto, correrGoteo, ordenarPorCompromiso } from '../campanas/goteo.js';

export interface AdminDeps {
  repos: Repos;
  config: Config;
  settings: SettingsService;
  queue: OutboundQueue;
  sender: Sender;
  wa: WhatsAppClient;
  hub: TrackingHub;
  adminToken: string;
  /** El monitor de salud y la politica de ritmo. Ver src/salud. */
  salud?: Monitor;
  politica?: () => Politica;
}

const phoneSchema = z
  .string()
  .min(6)
  .transform((value) => normalizePhone(value))
  .refine((value) => value.length >= 6, 'telefono demasiado corto');

const campaignSchema = z.object({
  name: z.string().min(1),
  templateName: z.string().min(1),
  templateLanguage: z.string().default('es_MX'),
  category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']).default('MARKETING'),
  /** Destinatarios explicitos; si se omite, va a todos los que tienen opt-in. */
  recipients: z
    .array(z.object({ phone: phoneSchema, variables: z.array(z.string()).default([]) }))
    .optional(),
  /** Goteo: como mucho tantos por hora. Vacio = el ritmo general del marcapasos. */
  ritmoPorHora: z.coerce.number().int().positive().optional(),
  /** Cuantos salen primero para mirar como cae. Vacio = 10 % (5-20); 0 = sin canario. */
  canario: z.coerce.number().int().nonnegative().optional(),
  canarioEsperaMin: z.coerce.number().int().positive().default(60),
});

const trackingSchema = z.object({
  phone: phoneSchema.optional(),
  label: z.string().max(120).optional(),
  ttlMinutes: z.number().int().positive().max(24 * 60).optional(),
  /** Manda el enlace de seguimiento al contacto por WhatsApp. */
  notify: z.boolean().default(false),
});

const pageSchema = z.object({
  limit: z.coerce.number().int().positive().max(500).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const importSchema = z.object({
  source: z.string().min(1).max(120),
  contacts: z
    .array(z.object({ phone: z.string().min(1), name: z.string().max(200).optional() }))
    .max(20_000)
    .optional(),
  /** Alternativa: una linea por contacto, "telefono,nombre". */
  text: z.string().max(2_000_000).optional(),
});

/** "5215512345678, Ana Perez" -> { phone, name }. Ignora lineas vacias y cabeceras. */
export function parseContactLines(text: string): Array<{ phone: string; name?: string }> {
  const out: Array<{ phone: string; name?: string }> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const [first, ...rest] = line.split(/[,;\t]/).map((cell) => cell.trim());
    const phone = normalizePhone(first ?? '');
    if (phone.length < 6) continue;
    const name = rest.filter(Boolean).join(' ').trim();
    out.push(name ? { phone, name } : { phone });
  }
  return out;
}

export async function registerAdminRoutes(app: FastifyInstance, deps: AdminDeps): Promise<void> {
  const { repos, config, queue, sender, adminToken, settings, wa, hub } = deps;
  // Sin Meta (cliente local o WAHA) no hay id de numero: se usa una clave fija
  // para que el estado, la pausa y el monitor hablen de la misma fila.
  const phoneNumberId = () => settings.current().phoneNumberId || 'local';

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/admin')) return;
    const header = request.headers.authorization;
    if (header !== `Bearer ${adminToken}`) {
      return reply.code(401).send({ error: 'no autorizado' });
    }
  });

  await registerAutomationRoutes(app, { repos, sender });
  await registerChatRoutes(app, { repos, sender, config, settings });
  await registerLeadsRoutes(app, {
    repos,
    panelStoky: config.STOKY_PANEL_URL,
    // Cerrar la ficha cierra tambien la conversacion: se respalda y se limpia.
    alCerrarFicha: config.ARCHIVE_ON_LEAD_CLOSE
      ? async (contactId) => {
          try {
            await archivarConversacion(
              { repos, dir: config.ARCHIVE_DIR, log: (m, d) => app.log.info(d ?? {}, m) },
              contactId,
              'lead',
            );
          } catch (error) {
            // Que falle el respaldo no puede tumbar el guardado de la ficha:
            // el operador acaba de cerrar una venta, no un backup.
            app.log.warn(
              { contactId, detalle: error instanceof Error ? error.message : String(error) },
              'no se pudo respaldar la conversacion al cerrar la ficha',
            );
          }
        }
      : undefined,
  });
  await registerArchiveRoutes(app, {
    repos,
    dir: config.ARCHIVE_DIR,
    dias: config.ARCHIVE_INACTIVE_DAYS,
  });
  await registerRutasRoutes(app, {
    repos,
    config,
    gsg: crearPuertoGsg(config),
    opciones: opcionesDesdeConfig(config),
    salud: deps.salud,
  });

  // --- salud del numero: lo primero que hay que mirar cada dia ----------
  const politicaVigente = (): Politica =>
    deps.politica?.() ??
    politicaDesdeConfig(config, providerOf(settings.current()) === 'cloud' ? 'cloud' : 'no_oficial');

  app.get('/admin/health', async () => {
    const state = await repos.numberState.get(phoneNumberId());
    const now = new Date();
    const politica = politicaVigente();
    const cap = dailyCapFor(state.warmupStartedOn, now, politica.warmup);
    return {
      number: state,
      dailyCap: cap,
      sentToday: await repos.counters.totalForDay(phoneNumberId(), now),
      queue: await queue.counts(),
      configured: settings.isConfigured(),
      missing: settings.missing(),
      salud: deps.salud
        ? { nivel: state.nivel ?? 'verde', factor: deps.salud.factor(), motivos: state.motivos ?? [] }
        : null,
    };
  });

  // --- salud del numero: lo que mira el monitor y por que frena ---------
  app.get('/admin/salud', async (_request, reply) => {
    if (!deps.salud) return reply.code(404).send({ error: 'el monitor de salud no esta activo en este arranque' });
    return deps.salud.snapshot();
  });

  /** Recalcular ahora, sin esperar al minuto. */
  app.post('/admin/salud/evaluar', async (_request, reply) => {
    if (!deps.salud) return reply.code(404).send({ error: 'el monitor de salud no esta activo en este arranque' });
    const riesgo = await deps.salud.evaluar();
    return { ok: true, riesgo };
  });

  /** Una persona levanta la pausa automatica; se vuelve despacio (rampa). */
  app.post('/admin/salud/reanudar', async (request, reply) => {
    if (!deps.salud) return reply.code(404).send({ error: 'el monitor de salud no esta activo en este arranque' });
    const body = z.object({ motivo: z.string().max(200).optional() }).parse(request.body ?? {});
    await deps.salud.reanudar(body.motivo?.trim() || 'desde el panel');
    await queue.resume();
    return { ok: true, snapshot: await deps.salud.snapshot() };
  });

  /** Levantar la supresion de un contacto a mano (p. ej. ya instalo WhatsApp). */
  app.post('/admin/salud/contactos/levantar', async (request) => {
    const body = z.object({ phone: phoneSchema }).parse(request.body);
    await repos.contacts.levantarSupresion(body.phone);
    await deps.salud?.registrarEvento('supresion', 'LEVANTADA', `${body.phone}: a mano desde el panel`);
    return { ok: true };
  });

  /**
   * Pide a Meta la calidad y el tier reales del numero. Los webhooks solo
   * avisan de cambios: si el numero ya estaba en amarillo antes de suscribir
   * el webhook, esta es la unica forma de enterarse.
   */
  app.post('/admin/number/sync', async () => {
    const info = await wa.getPhoneNumber();
    const id = phoneNumberId();
    const quality = info.qualityRating;
    if (quality === 'GREEN' || quality === 'YELLOW' || quality === 'RED') {
      await repos.numberState.setQuality(id, quality);
    }
    await repos.numberState.setTier(id, info.messagingLimitTier || null);
    return { number: await repos.numberState.get(id), info };
  });

  app.post('/admin/pause', async (request) => {
    const body = z.object({ paused: z.boolean(), reason: z.string().optional() }).parse(request.body);
    await repos.numberState.setPaused(phoneNumberId(), body.paused, body.reason);
    if (body.paused) await queue.pause();
    else await queue.resume();
    return { ok: true };
  });

  // --- plantillas -------------------------------------------------------
  app.get('/admin/templates', async () => repos.templates.list());

  /** El catalogo local con su lint y, si ya esta en Meta, su estado. */
  app.get('/admin/templates/catalog', async () => {
    const local = await repos.templates.list();
    return CATALOG.map((template) => ({
      ...template,
      issues: lintTemplate(template),
      registry:
        local.find((t) => t.name === template.name && t.language === template.language) ?? null,
    }));
  });

  app.post('/admin/templates/sync', async () => {
    const templates = await syncTemplates(wa, repos);
    return { synced: templates.length, templates };
  });

  app.post('/admin/templates/push', async (request, reply) => {
    const body = z.object({ names: z.array(z.string()).optional() }).parse(request.body ?? {});
    const selected = body.names?.length
      ? CATALOG.filter((t) => body.names!.includes(t.name))
      : CATALOG;
    if (!selected.length) {
      return reply.code(400).send({ error: 'ninguna de esas plantillas esta en el catalogo' });
    }
    const results = await pushTemplates(wa, repos, selected);
    return { results, ok: results.every((r) => r.ok) };
  });

  // --- campanas: por goteo y con canario. Ver src/campanas/goteo.ts -----
  app.post('/admin/campaigns', async (request, reply) => {
    const body = campaignSchema.parse(request.body);

    const template = await repos.templates.get(body.templateName, body.templateLanguage);
    if (!template) {
      return reply.code(400).send({ error: 'la plantilla no existe en el registro local' });
    }
    if (template.status !== 'APPROVED') {
      return reply.code(400).send({ error: `la plantilla esta en estado ${template.status}` });
    }

    // Sin destinatarios explicitos se usa la lista con opt-in vigente. En
    // ningun caso se envia a quien no lo tenga: el gate lo bloquearia igual,
    // pero encolarlo solo ensucia las metricas.
    const variablesPorPhone = new Map<string, string[]>();
    const contactos: Array<{ phone: string; lastInboundAt: Date | null; optInAt: Date | null }> = [];
    if (body.recipients?.length) {
      for (const r of body.recipients) {
        if (variablesPorPhone.has(r.phone)) continue;
        variablesPorPhone.set(r.phone, r.variables);
        const c = await repos.contacts.getByPhone(r.phone);
        contactos.push({ phone: r.phone, lastInboundAt: c?.lastInboundAt ?? null, optInAt: c?.optInAt ?? null });
      }
    } else {
      for (let offset = 0; ; offset += 500) {
        const page = await repos.contacts.listOptedIn(500, offset);
        if (!page.length) break;
        for (const c of page) {
          variablesPorPhone.set(c.phone, []);
          contactos.push({ phone: c.phone, lastInboundAt: c.lastInboundAt, optInAt: c.optInAt });
        }
      }
    }

    const canario = body.canario ?? canarioPorDefecto(contactos.length);
    const campaignId = await repos.campaigns.create({
      name: body.name,
      templateName: body.templateName,
      templateLanguage: body.templateLanguage,
      category: body.category as TemplateCategory,
      ritmoPorHora: body.ritmoPorHora ?? null,
      canario,
      canarioEsperaMin: body.canarioEsperaMin,
    });

    const ordenados = ordenarPorCompromiso(contactos);
    const enqueued = await repos.campaigns.agregarDestinatarios(
      campaignId,
      ordenados.map((c, i) => ({
        phone: c.phone,
        variables: variablesPorPhone.get(c.phone) ?? [],
        orden: i,
        canario: i < canario,
      })),
    );

    await repos.campaigns.setStatus(campaignId, !enqueued ? 'empty' : canario > 0 ? 'canary' : 'running');
    return { campaignId, enqueued, canario, ritmoPorHora: body.ritmoPorHora ?? null };
  });

  /** Lista con conteo por estado de entrega y de destinatarios. */
  app.get('/admin/campaigns', async () => repos.campaigns.list());

  /** Pausar, reanudar o parar del todo una campana. */
  app.post<{ Params: { id: string } }>('/admin/campaigns/:id/estado', async (request, reply) => {
    const body = z.object({ accion: z.enum(['pausar', 'reanudar', 'parar']), motivo: z.string().max(200).optional() }).parse(request.body);
    const campaign = await repos.campaigns.get(request.params.id);
    if (!campaign) return reply.code(404).send({ error: 'campana no encontrada' });

    if (body.accion === 'pausar') {
      if (!['running', 'canary'].includes(campaign.status)) {
        return reply.code(400).send({ error: `la campana esta ${campaign.status}: no se puede pausar` });
      }
      await repos.campaigns.setStatus(campaign.id, 'paused', body.motivo?.trim() || 'pausa manual');
    } else if (body.accion === 'reanudar') {
      if (campaign.status !== 'paused') {
        return reply.code(400).send({ error: `la campana esta ${campaign.status}: no hay nada que reanudar` });
      }
      // Reanudar a mano tras el canario es decir "vi las cifras y sigo".
      await repos.campaigns.setStatus(campaign.id, 'running');
      await deps.salud?.registrarEvento('campana', 'REANUDADA', `${campaign.name}: a mano (${body.motivo ?? 'sin motivo'})`, {
        campaignId: campaign.id,
      });
    } else {
      const cancelados = await repos.campaigns.cancelarPendientes(campaign.id, body.motivo?.trim() || 'campana parada');
      await repos.campaigns.setStatus(campaign.id, 'stopped', body.motivo?.trim() || 'parada a mano');
      return { ok: true, cancelados, campaign: await repos.campaigns.get(campaign.id) };
    }
    return { ok: true, campaign: await repos.campaigns.get(campaign.id) };
  });

  /** Un tick del goteo ahora mismo, sin esperar al ticker. */
  app.post('/admin/campaigns/goteo', async () => {
    const resultado = await correrGoteo({ repos, sender, salud: deps.salud, politica: deps.politica });
    return { ok: true, ...resultado };
  });

  app.get<{ Params: { id: string } }>('/admin/campaigns/:id', async (request, reply) => {
    const campaign = await repos.campaigns.get(request.params.id);
    if (!campaign) return reply.code(404).send({ error: 'campana no encontrada' });
    return {
      ...campaign,
      stats: await repos.deliveries.campaignStats(campaign.id),
      destinatarios: await repos.campaigns.cifrasDestinatarios(campaign.id),
      canarioCifras: campaign.canario ? await repos.campaigns.resumenCanario(campaign.id) : null,
    };
  });

  app.get<{ Params: { id: string } }>('/admin/campaigns/:id/stats', async (request) => {
    return repos.deliveries.campaignStats(request.params.id);
  });

  // --- entregas: cada intento, salga o no ---------------------------------
  app.get('/admin/deliveries', async (request) => {
    const query = pageSchema
      .extend({
        status: z
          .enum(['queued', 'sent', 'delivered', 'read', 'failed', 'blocked_by_gate'])
          .optional(),
        campaignId: z.string().optional(),
        phone: z.string().optional(),
      })
      .parse(request.query ?? {});
    return repos.deliveries.listRecent({
      ...query,
      phone: query.phone ? normalizePhone(query.phone) : undefined,
    });
  });

  // --- ubicaciones recibidas --------------------------------------------
  app.get('/admin/locations', async (request) => {
    const query = pageSchema.extend({ phone: z.string().optional() }).parse(request.query ?? {});
    return repos.locations.listRecent({
      ...query,
      phone: query.phone ? normalizePhone(query.phone) : undefined,
    });
  });

  // --- rastreo en vivo --------------------------------------------------
  app.post('/admin/tracking', async (request, reply) => {
    const body = trackingSchema.parse(request.body);

    const contact = body.phone ? await repos.contacts.getByPhone(body.phone) : null;
    if (body.phone && !contact) return reply.code(404).send({ error: 'contacto no encontrado' });

    const session = await createTrackingSession(
      { repos, config },
      { contactId: contact?.id ?? null, label: body.label, ttlMinutes: body.ttlMinutes },
    );

    let notified: Awaited<ReturnType<Sender['send']>> | null = null;
    if (body.notify && contact) {
      notified = await sender.send({
        phone: contact.phone,
        kind: 'freeform',
        category: 'UTILITY',
        text: `Sigue la entrega en vivo aqui:\n${session.viewUrl}\n\nEl enlace caduca el ${session.expiresAt.toLocaleString('es-MX')}.`,
      });
    }

    return { ...session, notified };
  });

  /** Sesiones vigentes con sus enlaces regenerados y cuantos las miran. */
  app.get('/admin/tracking', async () => {
    const active = await repos.tracking.listActive(new Date());
    return active.map((link) => {
      const urls = buildTrackingUrls(
        link.id,
        link.expiresAt,
        config.TRACKING_SECRET,
        config.PUBLIC_BASE_URL,
      );
      return {
        ...link,
        publishUrl: urls.publishUrl,
        viewUrl: urls.viewUrl,
        viewers: hub.viewerCount(link.id),
      };
    });
  });

  app.delete<{ Params: { id: string } }>('/admin/tracking/:id', async (request) => {
    await repos.tracking.revoke(request.params.id);
    hub.close(request.params.id, 'revocada desde el panel');
    return { ok: true };
  });

  // --- envios sueltos desde el panel ------------------------------------
  app.post('/admin/messages/text', async (request) => {
    const body = z.object({ phone: phoneSchema, text: z.string().min(1) }).parse(request.body);
    const outcome = await sender.send({
      phone: body.phone,
      kind: 'freeform',
      category: 'UTILITY',
      text: body.text,
    });
    return outcome;
  });

  /**
   * Acepta un link de mapa o unas coordenadas: el geo core saca lat/lng y se
   * manda el pin. Es la misma extraccion que corre sobre los mensajes
   * entrantes, asi que lo que se ve aqui es lo que hara el bot.
   */
  app.post('/admin/messages/location', async (request, reply) => {
    const body = z
      .object({ phone: phoneSchema, input: z.string().min(1), name: z.string().optional() })
      .parse(request.body);

    const result = await extractLocation(body.input, { bbox: config.bbox });
    if (!result.ok) {
      return reply.code(400).send({ error: `no se encontraron coordenadas: ${result.reason}`, result });
    }

    const outcome = await sender.send({
      phone: body.phone,
      kind: 'location',
      category: 'UTILITY',
      location: { latitude: result.lat, longitude: result.lng, name: body.name },
    });

    return { ...outcome, location: result };
  });

  /**
   * Un mensaje con botones de respuesta rapida.
   *
   * Es lo que usa la preventa para no obligar al cliente a escribir: pulsa y
   * la respuesta vuelve como si la hubiera tecleado. Donde WhatsApp no los
   * pinte, el cliente ve una lista numerada y responde con el numero.
   */
  app.post('/admin/messages/buttons', async (request) => {
    const body = z
      .object({
        phone: phoneSchema,
        body: z.string().min(1).max(1024),
        // WhatsApp no pinta mas de tres; pedir mas es pedir que se corten.
        buttons: z
          .array(z.object({ id: z.string().min(1).max(256), title: z.string().min(1).max(20) }))
          .min(1)
          .max(3),
      })
      .parse(request.body);

    return sender.send({
      phone: body.phone,
      kind: 'interactive',
      category: 'UTILITY',
      interactive: { body: body.body, buttons: body.buttons },
    });
  });

  app.post('/admin/messages/ask-location', async (request) => {
    const body = z
      .object({ phone: phoneSchema, text: z.string().optional() })
      .parse(request.body);

    return sender.send({
      phone: body.phone,
      kind: 'interactive',
      category: 'UTILITY',
      interactive: {
        body: body.text ?? 'Comparte tu ubicacion con el boton de abajo, por favor.',
        locationRequest: true,
      },
    });
  });

  /** Extractor de coordenadas expuesto tal cual; no envia nada. */
  app.post('/admin/geo/extract', async (request) => {
    const body = z.object({ input: z.string().min(1) }).parse(request.body);
    return extractLocation(body.input, { bbox: config.bbox });
  });

  // --- contactos --------------------------------------------------------
  app.get('/admin/contacts', async (request) => {
    const query = pageSchema
      .extend({
        q: z.string().max(120).optional(),
        state: z.enum(['all', 'opted_in', 'opted_out', 'pending']).default('all'),
      })
      .parse(request.query ?? {});
    return repos.contacts.list(query);
  });

  /** Alta masiva con consentimiento: es el paso 6 de la puesta en marcha. */
  app.post('/admin/contacts/import', async (request, reply) => {
    const body = importSchema.parse(request.body);
    const entries = [...(body.contacts ?? []), ...(body.text ? parseContactLines(body.text) : [])];
    if (!entries.length) {
      return reply.code(400).send({ error: 'no llego ningun contacto valido' });
    }
    const imported = await repos.contacts.bulkOptIn(entries, body.source);
    return { imported, received: entries.length };
  });

  app.post('/admin/contacts/opt-in', async (request) => {
    const body = z
      .object({ phone: phoneSchema, source: z.string().min(1), name: z.string().optional() })
      .parse(request.body);
    await repos.contacts.upsertFromInbound(body.phone, body.name);
    await repos.contacts.setOptIn(body.phone, body.source);
    return { ok: true, contact: await repos.contacts.getByPhone(body.phone) };
  });

  app.post('/admin/contacts/opt-out', async (request) => {
    const body = z.object({ phone: phoneSchema }).parse(request.body);
    await repos.contacts.upsertFromInbound(body.phone);
    await repos.contacts.setOptOut(body.phone);
    return { ok: true, contact: await repos.contacts.getByPhone(body.phone) };
  });
}
