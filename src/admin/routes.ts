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

export interface AdminDeps {
  repos: Repos;
  config: Config;
  settings: SettingsService;
  queue: OutboundQueue;
  sender: Sender;
  wa: WhatsAppClient;
  hub: TrackingHub;
  adminToken: string;
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
  const phoneNumberId = () => settings.current().phoneNumberId;

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/admin')) return;
    const header = request.headers.authorization;
    if (header !== `Bearer ${adminToken}`) {
      return reply.code(401).send({ error: 'no autorizado' });
    }
  });

  await registerAutomationRoutes(app, { repos, sender });
  await registerChatRoutes(app, { repos, sender, config });

  // --- salud del numero: lo primero que hay que mirar cada dia ----------
  app.get('/admin/health', async () => {
    const state = await repos.numberState.get(phoneNumberId());
    const now = new Date();
    const cap = dailyCapFor(state.warmupStartedOn, now, {
      startPerDay: config.WARMUP_START_PER_DAY,
      growth: config.WARMUP_GROWTH,
      hardCap: config.DAILY_SEND_CAP,
    });
    return {
      number: state,
      dailyCap: cap,
      sentToday: await repos.counters.totalForDay(phoneNumberId(), now),
      queue: await queue.counts(),
      configured: settings.isConfigured(),
      missing: settings.missing(),
    };
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

  // --- campanas ---------------------------------------------------------
  app.post('/admin/campaigns', async (request, reply) => {
    const body = campaignSchema.parse(request.body);

    const template = await repos.templates.get(body.templateName, body.templateLanguage);
    if (!template) {
      return reply.code(400).send({ error: 'la plantilla no existe en el registro local' });
    }
    if (template.status !== 'APPROVED') {
      return reply.code(400).send({ error: `la plantilla esta en estado ${template.status}` });
    }

    const campaignId = await repos.campaigns.create({
      name: body.name,
      templateName: body.templateName,
      templateLanguage: body.templateLanguage,
      category: body.category as TemplateCategory,
    });

    // Sin destinatarios explicitos se usa la lista con opt-in vigente. En
    // ningun caso se envia a quien no lo tenga: el gate lo bloquearia igual,
    // pero encolarlo solo ensucia las metricas.
    let jobs: Array<{ phone: string; variables: string[] }>;
    if (body.recipients?.length) {
      jobs = body.recipients;
    } else {
      const contacts: Array<{ phone: string }> = [];
      for (let offset = 0; ; offset += 500) {
        const page = await repos.contacts.listOptedIn(500, offset);
        if (!page.length) break;
        contacts.push(...page);
      }
      jobs = contacts.map((c) => ({ phone: c.phone, variables: [] }));
    }

    const enqueued = await queue.enqueueMany(
      jobs.map((job) => ({
        phone: job.phone,
        kind: 'template' as const,
        category: body.category as TemplateCategory,
        campaignId,
        templateName: body.templateName,
        templateLanguage: body.templateLanguage,
        variables: job.variables,
      })),
    );

    await repos.campaigns.setStatus(campaignId, enqueued ? 'running' : 'empty');
    return { campaignId, enqueued };
  });

  /** Lista con conteo por estado. `running` pasa a `finished` cuando ya no queda nada en cola. */
  app.get('/admin/campaigns', async () => {
    const list = await repos.campaigns.list();
    return list.map((campaign) => ({
      ...campaign,
      status:
        campaign.status === 'running' && !(campaign.stats.queued ?? 0) ? 'finished' : campaign.status,
    }));
  });

  app.get<{ Params: { id: string } }>('/admin/campaigns/:id', async (request, reply) => {
    const campaign = await repos.campaigns.get(request.params.id);
    if (!campaign) return reply.code(404).send({ error: 'campana no encontrada' });
    return { ...campaign, stats: await repos.deliveries.campaignStats(campaign.id) };
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
