/**
 * API de operacion: campanas, estado del numero, plantillas y enlaces de
 * rastreo. Protegida con un token de administracion; no esta pensada para
 * quedar expuesta a internet sin un proxy delante.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Repos, TemplateCategory } from '../db/repos.js';
import type { OutboundQueue } from '../outbound/queue.js';
import { dailyCapFor } from '../outbound/throttle.js';
import { createTrackingSession } from '../tracking/routes.js';
import type { Sender } from '../outbound/sender.js';
import { extractLocation } from '../geo/extract.js';
import type { SettingsService } from '../settings/service.js';

export interface AdminDeps {
  repos: Repos;
  config: Config;
  settings: SettingsService;
  queue: OutboundQueue;
  sender: Sender;
  adminToken: string;
}

const campaignSchema = z.object({
  name: z.string().min(1),
  templateName: z.string().min(1),
  templateLanguage: z.string().default('es_MX'),
  category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']).default('MARKETING'),
  /** Destinatarios explicitos; si se omite, va a todos los que tienen opt-in. */
  recipients: z
    .array(z.object({ phone: z.string().min(6), variables: z.array(z.string()).default([]) }))
    .optional(),
});

const trackingSchema = z.object({
  phone: z.string().min(6).optional(),
  label: z.string().max(120).optional(),
  ttlMinutes: z.number().int().positive().max(24 * 60).optional(),
  /** Manda el enlace de seguimiento al contacto por WhatsApp. */
  notify: z.boolean().default(false),
});

export async function registerAdminRoutes(app: FastifyInstance, deps: AdminDeps): Promise<void> {
  const { repos, config, queue, sender, adminToken, settings } = deps;
  const phoneNumberId = () => settings.current().phoneNumberId;

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/admin')) return;
    const header = request.headers.authorization;
    if (header !== `Bearer ${adminToken}`) {
      return reply.code(401).send({ error: 'no autorizado' });
    }
  });

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
    };
  });

  app.get('/admin/templates', async () => repos.templates.list());

  app.post('/admin/pause', async (request) => {
    const body = z.object({ paused: z.boolean(), reason: z.string().optional() }).parse(request.body);
    await repos.numberState.setPaused(phoneNumberId(), body.paused, body.reason);
    if (body.paused) await queue.pause();
    else await queue.resume();
    return { ok: true };
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

    await repos.campaigns.setStatus(campaignId, 'running');
    return { campaignId, enqueued };
  });

  app.get('/admin/campaigns', async () => repos.campaigns.list());

  app.get<{ Params: { id: string } }>('/admin/campaigns/:id/stats', async (request) => {
    return repos.deliveries.campaignStats(request.params.id);
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

    if (body.notify && contact) {
      await sender.send({
        phone: contact.phone,
        kind: 'freeform',
        category: 'UTILITY',
        text: `Sigue la entrega en vivo aqui:\n${session.viewUrl}\n\nEl enlace caduca el ${session.expiresAt.toLocaleString('es-MX')}.`,
      });
    }

    return session;
  });

  app.delete<{ Params: { id: string } }>('/admin/tracking/:id', async (request) => {
    await repos.tracking.revoke(request.params.id);
    return { ok: true };
  });

  // --- envios sueltos desde el panel ------------------------------------
  app.post('/admin/messages/text', async (request) => {
    const body = z.object({ phone: z.string().min(6), text: z.string().min(1) }).parse(request.body);
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
      .object({ phone: z.string().min(6), input: z.string().min(1), name: z.string().optional() })
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
      .object({ phone: z.string().min(6), text: z.string().optional() })
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
  app.post('/admin/contacts/opt-in', async (request) => {
    const body = z.object({ phone: z.string(), source: z.string().min(1) }).parse(request.body);
    await repos.contacts.upsertFromInbound(body.phone);
    await repos.contacts.setOptIn(body.phone, body.source);
    return { ok: true };
  });

  app.post('/admin/contacts/opt-out', async (request) => {
    const body = z.object({ phone: z.string() }).parse(request.body);
    await repos.contacts.setOptOut(body.phone);
    return { ok: true };
  });
}
