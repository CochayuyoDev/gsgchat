/**
 * API de automatizacion: reglas de respuesta, secuencias, inscripciones y
 * mensajes programados. Se monta dentro de /admin, asi que hereda el token.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { normalizePhone, type Repos } from '../db/repos.js';
import type { Sender } from '../outbound/sender.js';
import { cancelEnrollment, enrollContact, runDueMessages } from '../automation/engine.js';

export interface AutomationDeps {
  repos: Repos;
  sender: Sender;
}

const ruleSchema = z.object({
  name: z.string().min(1).max(120),
  trigger: z.enum(['keyword', 'first_message', 'any']).default('keyword'),
  keyword: z.string().max(200).optional().nullable(),
  match: z.enum(['equals', 'contains', 'starts']).default('contains'),
  reply: z.string().max(4000).optional().nullable(),
  sequenceId: z.string().optional().nullable(),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(10_000).default(100),
});

const stepSchema = z.object({
  delayMinutes: z.number().int().min(0).max(60 * 24 * 365),
  kind: z.enum(['template', 'text']),
  templateName: z.string().optional().nullable(),
  templateLanguage: z.string().default('es_MX'),
  category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']).default('UTILITY'),
  variables: z.array(z.string()).default([]),
  text: z.string().max(4000).optional().nullable(),
});

const sequenceSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  stopOnReply: z.boolean().default(true),
  enabled: z.boolean().default(true),
  steps: z.array(stepSchema).min(1).max(50),
});

const pageSchema = z.object({
  limit: z.coerce.number().int().positive().max(500).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const scheduleSchema = z.object({
  phone: z.string().min(6),
  dueAt: z.coerce.date(),
  kind: z.enum(['template', 'freeform']),
  category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']).default('UTILITY'),
  templateName: z.string().optional().nullable(),
  templateLanguage: z.string().default('es_MX'),
  variables: z.array(z.string()).default([]),
  text: z.string().max(4000).optional().nullable(),
});

function validateSteps(steps: z.infer<typeof stepSchema>[]): string | null {
  for (const [index, step] of steps.entries()) {
    if (step.kind === 'template' && !step.templateName?.trim()) {
      return `el paso ${index + 1} es de plantilla pero no dice cual`;
    }
    if (step.kind === 'text' && !step.text?.trim()) {
      return `el paso ${index + 1} es de texto pero va vacio`;
    }
  }
  return null;
}

export async function registerAutomationRoutes(
  app: FastifyInstance,
  deps: AutomationDeps,
): Promise<void> {
  const { repos, sender } = deps;
  const engine = { repos, sender };

  // --- reglas -----------------------------------------------------------
  app.get('/admin/automation/rules', async () => repos.automation.listRules());

  app.post('/admin/automation/rules', async (request, reply) => {
    const body = ruleSchema.parse(request.body);
    if (body.trigger === 'keyword' && !body.keyword?.trim()) {
      return reply.code(400).send({ error: 'una regla por palabra clave necesita la palabra' });
    }
    if (!body.reply?.trim() && !body.sequenceId) {
      return reply.code(400).send({ error: 'la regla tiene que responder algo o inscribir en una secuencia' });
    }
    if (body.sequenceId && !(await repos.automation.getSequence(body.sequenceId))) {
      return reply.code(400).send({ error: 'esa secuencia no existe' });
    }
    return repos.automation.createRule({ ...body, keyword: body.keyword?.trim() || null });
  });

  app.put<{ Params: { id: string } }>('/admin/automation/rules/:id', async (request, reply) => {
    const body = ruleSchema.partial().parse(request.body ?? {});
    const updated = await repos.automation.updateRule(request.params.id, body);
    if (!updated) return reply.code(404).send({ error: 'regla no encontrada' });
    return updated;
  });

  app.delete<{ Params: { id: string } }>('/admin/automation/rules/:id', async (request) => {
    await repos.automation.deleteRule(request.params.id);
    return { ok: true };
  });

  // --- secuencias -------------------------------------------------------
  app.get('/admin/automation/sequences', async () => repos.automation.listSequences());

  app.post('/admin/automation/sequences', async (request, reply) => {
    const body = sequenceSchema.parse(request.body);
    const problem = validateSteps(body.steps);
    if (problem) return reply.code(400).send({ error: problem });
    return repos.automation.createSequence(body);
  });

  app.put<{ Params: { id: string } }>('/admin/automation/sequences/:id', async (request, reply) => {
    const body = sequenceSchema.parse(request.body);
    const problem = validateSteps(body.steps);
    if (problem) return reply.code(400).send({ error: problem });
    const updated = await repos.automation.updateSequence(request.params.id, body);
    if (!updated) return reply.code(404).send({ error: 'secuencia no encontrada' });
    return updated;
  });

  app.delete<{ Params: { id: string } }>('/admin/automation/sequences/:id', async (request) => {
    await repos.automation.deleteSequence(request.params.id);
    return { ok: true };
  });

  /** Inscribe una lista de telefonos. Los que no existan se crean sin opt-in. */
  app.post<{ Params: { id: string } }>('/admin/automation/sequences/:id/enroll', async (request, reply) => {
    const body = z
      .object({ phones: z.array(z.string()).min(1).max(5000), source: z.string().max(120).optional() })
      .parse(request.body);
    const sequence = await repos.automation.getSequence(request.params.id);
    if (!sequence) return reply.code(404).send({ error: 'secuencia no encontrada' });
    if (!sequence.steps.length) return reply.code(400).send({ error: 'la secuencia no tiene pasos' });

    let enrolled = 0;
    let already = 0;
    for (const raw of body.phones) {
      const phone = normalizePhone(raw);
      if (phone.length < 6) continue;
      const contact = await repos.contacts.upsertFromInbound(phone);
      const result = await enrollContact(engine, sequence, contact, body.source ?? 'panel');
      if (result.created) enrolled++;
      else already++;
    }
    return { enrolled, already };
  });

  app.get('/admin/automation/enrollments', async (request) => {
    const query = pageSchema
      .extend({
        sequenceId: z.string().optional(),
        status: z.enum(['active', 'completed', 'cancelled']).optional(),
        phone: z.string().optional(),
      })
      .parse(request.query ?? {});
    let contactId: string | undefined;
    if (query.phone) {
      const contact = await repos.contacts.getByPhone(normalizePhone(query.phone));
      if (!contact) return [];
      contactId = contact.id;
    }
    return repos.automation.listEnrollments({ ...query, contactId });
  });

  app.post<{ Params: { id: string } }>('/admin/automation/enrollments/:id/cancel', async (request, reply) => {
    const enrollment = await repos.automation.getEnrollment(request.params.id);
    if (!enrollment) return reply.code(404).send({ error: 'inscripcion no encontrada' });
    await cancelEnrollment(repos, enrollment.id);
    return { ok: true };
  });

  // --- mensajes programados --------------------------------------------
  app.get('/admin/automation/scheduled', async (request) => {
    const query = pageSchema
      .extend({
        status: z.enum(['pending', 'processing', 'sent', 'blocked', 'failed', 'cancelled']).optional(),
        phone: z.string().optional(),
      })
      .parse(request.query ?? {});
    let contactId: string | undefined;
    if (query.phone) {
      const contact = await repos.contacts.getByPhone(normalizePhone(query.phone));
      if (!contact) return [];
      contactId = contact.id;
    }
    return repos.automation.listScheduled({ ...query, contactId });
  });

  app.post('/admin/automation/scheduled', async (request, reply) => {
    const body = scheduleSchema.parse(request.body);
    if (body.kind === 'template' && !body.templateName?.trim()) {
      return reply.code(400).send({ error: 'falta la plantilla' });
    }
    if (body.kind === 'freeform' && !body.text?.trim()) {
      return reply.code(400).send({ error: 'falta el texto' });
    }
    if (body.kind === 'template') {
      const template = await repos.templates.get(body.templateName!, body.templateLanguage);
      if (!template) return reply.code(400).send({ error: 'la plantilla no existe en el registro local' });
    }
    const contact = await repos.contacts.upsertFromInbound(normalizePhone(body.phone));
    const id = await repos.automation.schedule({
      contactId: contact.id,
      dueAt: body.dueAt,
      kind: body.kind,
      category: body.category,
      templateName: body.templateName ?? null,
      templateLanguage: body.templateLanguage,
      variables: body.variables,
      text: body.text ?? null,
    });
    return { id, dueAt: body.dueAt };
  });

  app.post<{ Params: { id: string } }>('/admin/automation/scheduled/:id/cancel', async (request, reply) => {
    const id = Number.parseInt(request.params.id, 10);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id invalido' });
    const cancelled = await repos.automation.cancelScheduled(id);
    if (!cancelled) return reply.code(409).send({ error: 'ya no estaba pendiente' });
    return { ok: true };
  });

  /** Procesa ahora lo vencido, sin esperar al ticker. */
  app.post('/admin/automation/run', async () => runDueMessages(engine));

  // --- preferencias -----------------------------------------------------
  app.get('/admin/automation/prefs', async () => repos.automation.getPrefs());

  app.post('/admin/automation/prefs', async (request) => {
    const body = z.object({ askLocationFallback: z.boolean().optional() }).parse(request.body ?? {});
    return repos.automation.setPrefs(body);
  });
}
