/**
 * Repositorio de automatizacion: reglas de respuesta, secuencias de
 * seguimiento, inscripciones y mensajes programados.
 *
 * Va en su propio fichero porque es un modulo entero; `Repos` lo expone
 * como `repos.automation` y `tests/fakes.ts` tiene su doble en memoria.
 */

import { nuevoId, type Pool } from './pool.js';
import type { TemplateCategory } from './repos.js';

// ---------------------------------------------------------------- modelos

export type RuleTrigger = 'keyword' | 'first_message' | 'any';
export type RuleMatch = 'equals' | 'contains' | 'starts';

export interface AutoReply {
  id: string;
  name: string;
  trigger: RuleTrigger;
  keyword: string | null;
  match: RuleMatch;
  reply: string | null;
  sequenceId: string | null;
  enabled: boolean;
  priority: number;
  createdAt: Date;
}

export interface AutoReplyInput {
  name: string;
  trigger: RuleTrigger;
  keyword?: string | null;
  match?: RuleMatch;
  reply?: string | null;
  sequenceId?: string | null;
  enabled?: boolean;
  priority?: number;
}

export type StepKind = 'template' | 'text';

export interface SequenceStep {
  position: number;
  delayMinutes: number;
  kind: StepKind;
  templateName: string | null;
  templateLanguage: string;
  category: TemplateCategory;
  variables: string[];
  text: string | null;
}

export interface SequenceStepInput {
  delayMinutes: number;
  kind: StepKind;
  templateName?: string | null;
  templateLanguage?: string;
  category?: TemplateCategory;
  variables?: string[];
  text?: string | null;
}

export interface Sequence {
  id: string;
  name: string;
  description: string | null;
  stopOnReply: boolean;
  enabled: boolean;
  createdAt: Date;
  steps: SequenceStep[];
}

export interface SequenceWithCounts extends Sequence {
  activeEnrollments: number;
  totalEnrollments: number;
}

export interface SequenceInput {
  name: string;
  description?: string | null;
  stopOnReply?: boolean;
  enabled?: boolean;
  steps: SequenceStepInput[];
}

export type EnrollmentStatus = 'active' | 'completed' | 'cancelled';

export interface Enrollment {
  id: string;
  sequenceId: string;
  contactId: string;
  status: EnrollmentStatus;
  currentStep: number;
  source: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface EnrollmentListItem extends Enrollment {
  sequenceName: string;
  phone: string;
  name: string | null;
  totalSteps: number;
  nextDueAt: Date | null;
}

export type ScheduledStatus = 'pending' | 'processing' | 'sent' | 'blocked' | 'failed' | 'cancelled';

export interface ScheduledMessage {
  id: number;
  contactId: string;
  enrollmentId: string | null;
  stepPosition: number | null;
  dueAt: Date;
  kind: 'template' | 'freeform';
  category: TemplateCategory;
  templateName: string | null;
  templateLanguage: string | null;
  variables: string[];
  text: string | null;
  status: ScheduledStatus;
  deliveryId: number | null;
  detail: string | null;
  createdAt: Date;
  processedAt: Date | null;
}

export interface ScheduledListItem extends ScheduledMessage {
  phone: string;
  name: string | null;
  sequenceName: string | null;
}

export interface ScheduleInput {
  contactId: string;
  enrollmentId?: string | null;
  stepPosition?: number | null;
  dueAt: Date;
  kind: 'template' | 'freeform';
  category: TemplateCategory;
  templateName?: string | null;
  templateLanguage?: string | null;
  variables?: string[];
  text?: string | null;
}

export interface AutomationPrefs {
  /** Sin coordenadas ni regla que aplique, pedir la ubicacion con el boton nativo. */
  askLocationFallback: boolean;
  /**
   * El asistente de preventa: presenta la tienda, ofrece el menu y va llenando
   * la ficha (de donde, a donde, que envia, cuando, a nombre de quien).
   *
   * Encendido: es lo que hace que el bot sirva para algo en vez de solo
   * recibir mensajes. Se apaga desde /panel cuando la tienda prefiere que
   * conteste siempre una persona.
   */
  preventaActiva: boolean;
  /**
   * Servicios o couriers entre los que elige el cliente.
   *
   * La lista la pone cada tienda: GSG tendra los suyos y otra tienda otros.
   * Vacia significa que ese paso NO se pregunta, que es lo correcto para quien
   * solo ofrece un servicio: preguntar por algo que no hay que elegir es una
   * pregunta de mas en una conversacion que ya tiene seis.
   */
  serviciosPreventa: string[];
  /**
   * Los textos del asistente, reescritos por la tienda.
   *
   * Solo lo que cambio: lo que no este aqui usa el valor de fabrica, asi que
   * anadir un mensaje nuevo al sistema no obliga a nadie a reconfigurarlo.
   */
  mensajesPreventa: Record<string, string>;
}

/**
 * Apagado a proposito.
 *
 * Con esto encendido, CUALQUIER mensaje sin coordenadas recibe un "no
 * encontre coordenadas, comparte tu ubicacion": el cliente escribe "hola" y le
 * contesta un robot pidiendole el pin. Es ruido y confunde. Quien de verdad
 * quiera pedir la ubicacion siempre, lo enciende desde /panel.
 */
export const DEFAULT_PREFS: AutomationPrefs = {
  askLocationFallback: false,
  preventaActiva: true,
  serviciosPreventa: [],
  mensajesPreventa: {},
};

// ------------------------------------------------------------- interfaz

export interface AutomationRepo {
  listRules(): Promise<AutoReply[]>;
  createRule(input: AutoReplyInput): Promise<AutoReply>;
  updateRule(id: string, patch: Partial<AutoReplyInput>): Promise<AutoReply | null>;
  deleteRule(id: string): Promise<void>;

  listSequences(): Promise<SequenceWithCounts[]>;
  getSequence(id: string): Promise<Sequence | null>;
  createSequence(input: SequenceInput): Promise<Sequence>;
  updateSequence(id: string, input: SequenceInput): Promise<Sequence | null>;
  deleteSequence(id: string): Promise<void>;

  /** Devuelve la inscripcion activa si ya existia, o crea una nueva. */
  enroll(sequenceId: string, contactId: string, source: string | null): Promise<{ enrollment: Enrollment; created: boolean }>;
  getEnrollment(id: string): Promise<Enrollment | null>;
  listEnrollments(query: {
    sequenceId?: string;
    contactId?: string;
    status?: EnrollmentStatus;
    limit: number;
    offset: number;
  }): Promise<EnrollmentListItem[]>;
  activeEnrollmentsFor(contactId: string): Promise<Array<Enrollment & { stopOnReply: boolean }>>;
  setEnrollmentStep(id: string, step: number): Promise<void>;
  finishEnrollment(id: string, status: 'completed' | 'cancelled'): Promise<void>;

  schedule(input: ScheduleInput): Promise<number>;
  listScheduled(query: { status?: ScheduledStatus; contactId?: string; limit: number; offset: number }): Promise<ScheduledListItem[]>;
  cancelScheduled(id: number): Promise<boolean>;
  cancelPendingForEnrollment(enrollmentId: string): Promise<number>;
  /** Marca como `processing` y devuelve los pendientes vencidos. */
  claimDue(now: Date, limit: number): Promise<ScheduledMessage[]>;
  markScheduled(id: number, status: ScheduledStatus, detail?: string | null, deliveryId?: number | null): Promise<void>;

  getPrefs(): Promise<AutomationPrefs>;
  setPrefs(prefs: Partial<AutomationPrefs>): Promise<AutomationPrefs>;
}

// ---------------------------------------------------------- impl MySQL

interface RuleRow {
  id: string;
  name: string;
  trigger: RuleTrigger;
  keyword: string | null;
  match: RuleMatch;
  reply: string | null;
  sequence_id: string | null;
  enabled: boolean;
  priority: number;
  created_at: Date;
}

const toRule = (r: RuleRow): AutoReply => ({
  id: r.id,
  name: r.name,
  trigger: r.trigger,
  keyword: r.keyword,
  match: r.match,
  reply: r.reply,
  sequenceId: r.sequence_id,
  enabled: r.enabled,
  priority: r.priority,
  createdAt: r.created_at,
});

interface SequenceRow {
  id: string;
  name: string;
  description: string | null;
  stop_on_reply: boolean;
  enabled: boolean;
  created_at: Date;
}

interface StepRow {
  sequence_id: string;
  position: number;
  delay_minutes: number;
  kind: StepKind;
  template_name: string | null;
  template_language: string;
  category: TemplateCategory;
  variables: string[] | null;
  text: string | null;
}

const toStep = (r: StepRow): SequenceStep => ({
  position: r.position,
  delayMinutes: r.delay_minutes,
  kind: r.kind,
  templateName: r.template_name,
  templateLanguage: r.template_language,
  category: r.category,
  variables: r.variables ?? [],
  text: r.text,
});

interface EnrollmentRow {
  id: string;
  sequence_id: string;
  contact_id: string;
  status: EnrollmentStatus;
  current_step: number;
  source: string | null;
  started_at: Date;
  finished_at: Date | null;
}

const toEnrollment = (r: EnrollmentRow): Enrollment => ({
  id: r.id,
  sequenceId: r.sequence_id,
  contactId: r.contact_id,
  status: r.status,
  currentStep: r.current_step,
  source: r.source,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

interface ScheduledRow {
  id: number;
  contact_id: string;
  enrollment_id: string | null;
  step_position: number | null;
  due_at: Date;
  kind: 'template' | 'freeform';
  category: TemplateCategory;
  template_name: string | null;
  template_language: string | null;
  variables: string[] | null;
  text: string | null;
  status: ScheduledStatus;
  delivery_id: number | null;
  detail: string | null;
  created_at: Date;
  processed_at: Date | null;
}

const toScheduled = (r: ScheduledRow): ScheduledMessage => ({
  id: r.id,
  contactId: r.contact_id,
  enrollmentId: r.enrollment_id,
  stepPosition: r.step_position,
  dueAt: r.due_at,
  kind: r.kind,
  category: r.category,
  templateName: r.template_name,
  templateLanguage: r.template_language,
  variables: r.variables ?? [],
  text: r.text,
  status: r.status,
  deliveryId: r.delivery_id,
  detail: r.detail,
  createdAt: r.created_at,
  processedAt: r.processed_at,
});

const PREFS_KEY = 'automation.prefs';

export function createAutomationRepo(pool: Pool): AutomationRepo {
  async function stepsFor(sequenceIds: string[]): Promise<Map<string, SequenceStep[]>> {
    const map = new Map<string, SequenceStep[]>();
    if (!sequenceIds.length) return map;
    const { rows } = await pool.query<StepRow>(
      `select * from sequence_steps where sequence_id in ($1) order by sequence_id, position`,
      [sequenceIds],
    );
    for (const row of rows) {
      const list = map.get(row.sequence_id) ?? [];
      list.push(toStep(row));
      map.set(row.sequence_id, list);
    }
    return map;
  }

  async function insertSteps(sequenceId: string, steps: SequenceStepInput[]): Promise<void> {
    for (const [index, step] of steps.entries()) {
      await pool.query(
        `insert into sequence_steps
           (sequence_id, position, delay_minutes, kind, template_name, template_language, category, variables, text)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          sequenceId,
          index + 1,
          step.delayMinutes,
          step.kind,
          step.templateName ?? null,
          step.templateLanguage ?? 'es',
          step.category ?? 'UTILITY',
          JSON.stringify(step.variables ?? []),
          step.text ?? null,
        ],
      );
    }
  }

  const repo: AutomationRepo = {
    async listRules() {
      const { rows } = await pool.query<RuleRow>(
        'select * from auto_replies order by priority, created_at',
      );
      return rows.map(toRule);
    },
    async createRule(input) {
      // `trigger` y `match` son palabras reservadas en MySQL: van entre comillas invertidas.
      const id = nuevoId();
      await pool.query(
        `insert into auto_replies (id, name, \`trigger\`, keyword, \`match\`, reply, sequence_id, enabled, priority)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          id,
          input.name,
          input.trigger,
          input.keyword ?? null,
          input.match ?? 'contains',
          input.reply ?? null,
          input.sequenceId ?? null,
          input.enabled ?? true,
          input.priority ?? 100,
        ],
      );
      const { rows } = await pool.query<RuleRow>('select * from auto_replies where id = $1', [id]);
      return toRule(rows[0]!);
    },
    async updateRule(id, patch) {
      // Sin `returning`: se actualiza y se lee. Si el id no existe, el select
      // no trae nada (aunque el update no cambie ninguna columna, la fila sigue).
      await pool.query(
        `update auto_replies set
           name = coalesce($2, name),
           \`trigger\` = coalesce($3, \`trigger\`),
           keyword = case when $9 then $4 else keyword end,
           \`match\` = coalesce($5, \`match\`),
           reply = case when $10 then $6 else reply end,
           sequence_id = case when $11 then $7 else sequence_id end,
           enabled = coalesce($8, enabled),
           priority = coalesce($12, priority)
         where id = $1`,
        [
          id,
          patch.name ?? null,
          patch.trigger ?? null,
          patch.keyword ?? null,
          patch.match ?? null,
          patch.reply ?? null,
          patch.sequenceId ?? null,
          patch.enabled ?? null,
          'keyword' in patch,
          'reply' in patch,
          'sequenceId' in patch,
          patch.priority ?? null,
        ],
      );
      const { rows } = await pool.query<RuleRow>('select * from auto_replies where id = $1', [id]);
      return rows[0] ? toRule(rows[0]) : null;
    },
    async deleteRule(id) {
      await pool.query('delete from auto_replies where id = $1', [id]);
    },

    async listSequences() {
      const { rows } = await pool.query<SequenceRow & { active: number; total: number }>(
        `select s.*,
                (select count(*) from enrollments e where e.sequence_id = s.id and e.status = 'active') as active,
                (select count(*) from enrollments e where e.sequence_id = s.id) as total
           from sequences s order by s.created_at desc`,
      );
      const steps = await stepsFor(rows.map((r) => r.id));
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        stopOnReply: r.stop_on_reply,
        enabled: r.enabled,
        createdAt: r.created_at,
        steps: steps.get(r.id) ?? [],
        activeEnrollments: r.active,
        totalEnrollments: r.total,
      }));
    },
    async getSequence(id) {
      const { rows } = await pool.query<SequenceRow>('select * from sequences where id = $1', [id]);
      const row = rows[0];
      if (!row) return null;
      const steps = await stepsFor([id]);
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        stopOnReply: row.stop_on_reply,
        enabled: row.enabled,
        createdAt: row.created_at,
        steps: steps.get(id) ?? [],
      };
    },
    async createSequence(input) {
      const id = nuevoId();
      await pool.query(
        `insert into sequences (id, name, description, stop_on_reply, enabled)
         values ($1,$2,$3,$4,$5)`,
        [id, input.name, input.description ?? null, input.stopOnReply ?? true, input.enabled ?? true],
      );
      await insertSteps(id, input.steps);
      return (await repo.getSequence(id))!;
    },
    async updateSequence(id, input) {
      // En MySQL rowCount son las filas CAMBIADAS (0 si se guarda igual que
      // estaba): la existencia se mira aparte.
      const existe = await pool.query('select 1 from sequences where id = $1', [id]);
      if (!existe.rowCount) return null;
      await pool.query(
        `update sequences set name = $2, description = $3, stop_on_reply = $4, enabled = $5 where id = $1`,
        [id, input.name, input.description ?? null, input.stopOnReply ?? true, input.enabled ?? true],
      );
      await pool.query('delete from sequence_steps where sequence_id = $1', [id]);
      await insertSteps(id, input.steps);
      return repo.getSequence(id);
    },
    async deleteSequence(id) {
      await pool.query('delete from sequences where id = $1', [id]);
    },

    async enroll(sequenceId, contactId, source) {
      const existing = await pool.query<EnrollmentRow>(
        `select * from enrollments where sequence_id = $1 and contact_id = $2 and status = 'active' limit 1`,
        [sequenceId, contactId],
      );
      if (existing.rows[0]) return { enrollment: toEnrollment(existing.rows[0]), created: false };
      const id = nuevoId();
      await pool.query(
        `insert into enrollments (id, sequence_id, contact_id, source) values ($1,$2,$3,$4)`,
        [id, sequenceId, contactId, source],
      );
      const { rows } = await pool.query<EnrollmentRow>('select * from enrollments where id = $1', [id]);
      return { enrollment: toEnrollment(rows[0]!), created: true };
    },
    async getEnrollment(id) {
      const { rows } = await pool.query<EnrollmentRow>('select * from enrollments where id = $1', [id]);
      return rows[0] ? toEnrollment(rows[0]) : null;
    },
    async listEnrollments(query) {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (query.sequenceId) {
        params.push(query.sequenceId);
        conditions.push(`e.sequence_id = $${params.length}`);
      }
      if (query.contactId) {
        params.push(query.contactId);
        conditions.push(`e.contact_id = $${params.length}`);
      }
      if (query.status) {
        params.push(query.status);
        conditions.push(`e.status = $${params.length}`);
      }
      const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
      const { rows } = await pool.query<
        EnrollmentRow & {
          sequence_name: string;
          phone: string;
          name: string | null;
          total_steps: number;
          next_due_at: Date | null;
        }
      >(
        `select e.*, s.name as sequence_name, c.phone, c.name,
                (select count(*) from sequence_steps st where st.sequence_id = e.sequence_id) as total_steps,
                (select min(due_at) from scheduled_messages m
                  where m.enrollment_id = e.id and m.status = 'pending') as next_due_at
           from enrollments e
           join sequences s on s.id = e.sequence_id
           join contacts c on c.id = e.contact_id
          ${where}
          order by e.started_at desc
          limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, Number(query.limit), Number(query.offset)],
      );
      return rows.map((r) => ({
        ...toEnrollment(r),
        sequenceName: r.sequence_name,
        phone: r.phone,
        name: r.name,
        totalSteps: r.total_steps,
        nextDueAt: r.next_due_at,
      }));
    },
    async activeEnrollmentsFor(contactId) {
      const { rows } = await pool.query<EnrollmentRow & { stop_on_reply: boolean }>(
        `select e.*, s.stop_on_reply
           from enrollments e join sequences s on s.id = e.sequence_id
          where e.contact_id = $1 and e.status = 'active'`,
        [contactId],
      );
      return rows.map((r) => ({ ...toEnrollment(r), stopOnReply: r.stop_on_reply }));
    },
    async setEnrollmentStep(id, step) {
      await pool.query('update enrollments set current_step = $2 where id = $1', [id, step]);
    },
    async finishEnrollment(id, status) {
      await pool.query(
        `update enrollments set status = $2, finished_at = now(3) where id = $1 and status = 'active'`,
        [id, status],
      );
    },

    async schedule(input) {
      const { insertId } = await pool.query(
        `insert into scheduled_messages
           (contact_id, enrollment_id, step_position, due_at, kind, category,
            template_name, template_language, variables, text)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          input.contactId,
          input.enrollmentId ?? null,
          input.stepPosition ?? null,
          input.dueAt,
          input.kind,
          input.category,
          input.templateName ?? null,
          input.templateLanguage ?? null,
          JSON.stringify(input.variables ?? []),
          input.text ?? null,
        ],
      );
      return insertId;
    },
    async listScheduled(query) {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (query.status) {
        params.push(query.status);
        conditions.push(`m.status = $${params.length}`);
      }
      if (query.contactId) {
        params.push(query.contactId);
        conditions.push(`m.contact_id = $${params.length}`);
      }
      const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
      const { rows } = await pool.query<ScheduledRow & { phone: string; name: string | null; sequence_name: string | null }>(
        `select m.*, c.phone, c.name, s.name as sequence_name
           from scheduled_messages m
           join contacts c on c.id = m.contact_id
           left join enrollments e on e.id = m.enrollment_id
           left join sequences s on s.id = e.sequence_id
          ${where}
          order by case when m.status = 'pending' then 0 else 1 end, m.due_at desc
          limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, Number(query.limit), Number(query.offset)],
      );
      return rows.map((r) => ({ ...toScheduled(r), phone: r.phone, name: r.name, sequenceName: r.sequence_name }));
    },
    async cancelScheduled(id) {
      const { rowCount } = await pool.query(
        `update scheduled_messages set status = 'cancelled', processed_at = now(3)
          where id = $1 and status = 'pending'`,
        [id],
      );
      return Boolean(rowCount);
    },
    async cancelPendingForEnrollment(enrollmentId) {
      const { rowCount } = await pool.query(
        `update scheduled_messages set status = 'cancelled', processed_at = now(3)
          where enrollment_id = $1 and status = 'pending'`,
        [enrollmentId],
      );
      return rowCount ?? 0;
    },
    async claimDue(now, limit) {
      // Reparto sin SKIP LOCKED (MariaDB 10.4 no lo tiene) y sin bloquear a
      // nadie: se leen los candidatos y cada uno se reclama con un update
      // condicionado a que SIGA pendiente. El update de una fila es atomico,
      // asi que si dos workers ven el mismo mensaje solo a uno le afecta
      // (affectedRows = 1) y el otro lo deja pasar. Si se perdio alguno
      // frente a otro worker se vuelve a mirar, hasta llenar `limit` o no
      // quedar pendientes: lo mismo que daba SKIP LOCKED. Termina porque cada
      // vuelta deja menos pendientes (los reclamados por uno u otro).
      const tope = Number(limit);
      const reclamados: number[] = [];
      while (reclamados.length < tope) {
        const candidatos = await pool.query<{ id: number }>(
          `select id from scheduled_messages
            where status = 'pending' and due_at <= $1
            order by due_at, id
            limit $2`,
          [now, tope - reclamados.length],
        );
        let perdidos = 0;
        for (const { id } of candidatos.rows) {
          const { rowCount } = await pool.query(
            `update scheduled_messages set status = 'processing' where id = $1 and status = 'pending'`,
            [id],
          );
          if (rowCount === 1) reclamados.push(id);
          else perdidos++;
        }
        if (!perdidos) break;
      }
      if (!reclamados.length) return [];
      const { rows } = await pool.query<ScheduledRow>(
        `select * from scheduled_messages where id in ($1) order by due_at, id`,
        [reclamados],
      );
      return rows.map(toScheduled);
    },
    async markScheduled(id, status, detail, deliveryId) {
      await pool.query(
        `update scheduled_messages
            set status = $2, detail = $3, delivery_id = $4, processed_at = now(3)
          where id = $1`,
        [id, status, detail ?? null, deliveryId ?? null],
      );
    },

    async getPrefs() {
      const { rows } = await pool.query<{ value: string }>('select value from settings where `key` = $1', [PREFS_KEY]);
      if (!rows[0]) return { ...DEFAULT_PREFS };
      try {
        return { ...DEFAULT_PREFS, ...(JSON.parse(rows[0].value) as Partial<AutomationPrefs>) };
      } catch {
        return { ...DEFAULT_PREFS };
      }
    },
    async setPrefs(patch) {
      const merged = { ...(await repo.getPrefs()), ...patch };
      await pool.query(
        `insert into settings (\`key\`, value, encrypted, updated_at) values ($1,$2,false,now(3))
         on duplicate key update value = values(value), updated_at = now(3)`,
        [PREFS_KEY, JSON.stringify(merged)],
      );
      return merged;
    },
  };

  return repo;
}
