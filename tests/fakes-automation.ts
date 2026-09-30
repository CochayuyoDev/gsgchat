/** Doble en memoria del repositorio de automatizacion. */

import type { Contact } from '../src/db/repos.js';
import {
  DEFAULT_PREFS,
  type AutoReply,
  type AutomationPrefs,
  type AutomationRepo,
  type Enrollment,
  type ScheduledMessage,
  type Sequence,
  type SequenceStep,
} from '../src/db/automation.js';

let seq = 1;

export interface FakeAutomation extends AutomationRepo {
  _rules: Map<string, AutoReply>;
  _sequences: Map<string, Sequence>;
  _enrollments: Map<string, Enrollment>;
  _scheduled: Map<number, ScheduledMessage>;
}

export function createFakeAutomation(contactById: (id: string) => Contact | undefined): FakeAutomation {
  const rules = new Map<string, AutoReply>();
  const sequences = new Map<string, Sequence>();
  const enrollments = new Map<string, Enrollment>();
  const scheduled = new Map<number, ScheduledMessage>();
  let prefs: AutomationPrefs = { ...DEFAULT_PREFS };

  const toSteps = (input: Sequence['steps'] | Array<Partial<SequenceStep>>): SequenceStep[] =>
    input.map((s, index) => ({
      position: index + 1,
      delayMinutes: s.delayMinutes ?? 0,
      kind: s.kind ?? 'template',
      templateName: s.templateName ?? null,
      templateLanguage: s.templateLanguage ?? 'es',
      category: s.category ?? 'UTILITY',
      variables: s.variables ?? [],
      text: s.text ?? null,
    }));

  const repo: FakeAutomation = {
    _rules: rules,
    _sequences: sequences,
    _enrollments: enrollments,
    _scheduled: scheduled,

    async listRules() {
      return [...rules.values()].sort((a, b) => a.priority - b.priority);
    },
    async createRule(input) {
      const rule: AutoReply = {
        id: `rule${seq++}`,
        name: input.name,
        trigger: input.trigger,
        keyword: input.keyword ?? null,
        match: input.match ?? 'contains',
        reply: input.reply ?? null,
        sequenceId: input.sequenceId ?? null,
        enabled: input.enabled ?? true,
        priority: input.priority ?? 100,
        createdAt: new Date(),
      };
      rules.set(rule.id, rule);
      return rule;
    },
    async updateRule(id, patch) {
      const rule = rules.get(id);
      if (!rule) return null;
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) (rule as unknown as Record<string, unknown>)[key] = value;
      }
      return rule;
    },
    async deleteRule(id) {
      rules.delete(id);
    },

    async listSequences() {
      return [...sequences.values()]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((s) => {
          const all = [...enrollments.values()].filter((e) => e.sequenceId === s.id);
          return {
            ...s,
            activeEnrollments: all.filter((e) => e.status === 'active').length,
            totalEnrollments: all.length,
          };
        });
    },
    async getSequence(id) {
      return sequences.get(id) ?? null;
    },
    async createSequence(input) {
      const sequence: Sequence = {
        id: `seq${seq++}`,
        name: input.name,
        description: input.description ?? null,
        stopOnReply: input.stopOnReply ?? true,
        enabled: input.enabled ?? true,
        createdAt: new Date(),
        steps: toSteps(input.steps),
      };
      sequences.set(sequence.id, sequence);
      return sequence;
    },
    async updateSequence(id, input) {
      const existing = sequences.get(id);
      if (!existing) return null;
      Object.assign(existing, {
        name: input.name,
        description: input.description ?? null,
        stopOnReply: input.stopOnReply ?? true,
        enabled: input.enabled ?? true,
        steps: toSteps(input.steps),
      });
      return existing;
    },
    async deleteSequence(id) {
      sequences.delete(id);
      for (const rule of rules.values()) if (rule.sequenceId === id) rule.sequenceId = null;
      for (const [eid, e] of enrollments) if (e.sequenceId === id) enrollments.delete(eid);
    },

    async enroll(sequenceId, contactId, source) {
      const existing = [...enrollments.values()].find(
        (e) => e.sequenceId === sequenceId && e.contactId === contactId && e.status === 'active',
      );
      if (existing) return { enrollment: existing, created: false };
      const enrollment: Enrollment = {
        id: `enr${seq++}`,
        sequenceId,
        contactId,
        status: 'active',
        currentStep: 0,
        source,
        startedAt: new Date(),
        finishedAt: null,
      };
      enrollments.set(enrollment.id, enrollment);
      return { enrollment, created: true };
    },
    async getEnrollment(id) {
      return enrollments.get(id) ?? null;
    },
    async listEnrollments(query) {
      return [...enrollments.values()]
        .filter(
          (e) =>
            (!query.sequenceId || e.sequenceId === query.sequenceId) &&
            (!query.contactId || e.contactId === query.contactId) &&
            (!query.status || e.status === query.status),
        )
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
        .slice(query.offset, query.offset + query.limit)
        .map((e) => {
          const contact = contactById(e.contactId);
          const sequence = sequences.get(e.sequenceId);
          const pending = [...scheduled.values()]
            .filter((m) => m.enrollmentId === e.id && m.status === 'pending')
            .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
          return {
            ...e,
            sequenceName: sequence?.name ?? '',
            phone: contact?.phone ?? '',
            name: contact?.name ?? null,
            totalSteps: sequence?.steps.length ?? 0,
            nextDueAt: pending[0]?.dueAt ?? null,
          };
        });
    },
    async activeEnrollmentsFor(contactId) {
      return [...enrollments.values()]
        .filter((e) => e.contactId === contactId && e.status === 'active')
        .map((e) => ({ ...e, stopOnReply: sequences.get(e.sequenceId)?.stopOnReply ?? true }));
    },
    async setEnrollmentStep(id, step) {
      const e = enrollments.get(id);
      if (e) e.currentStep = step;
    },
    async finishEnrollment(id, status) {
      const e = enrollments.get(id);
      if (e && e.status === 'active') {
        e.status = status;
        e.finishedAt = new Date();
      }
    },

    async schedule(input) {
      const id = seq++;
      scheduled.set(id, {
        id,
        contactId: input.contactId,
        enrollmentId: input.enrollmentId ?? null,
        stepPosition: input.stepPosition ?? null,
        dueAt: input.dueAt,
        kind: input.kind,
        category: input.category,
        templateName: input.templateName ?? null,
        templateLanguage: input.templateLanguage ?? null,
        variables: input.variables ?? [],
        text: input.text ?? null,
        status: 'pending',
        deliveryId: null,
        detail: null,
        createdAt: new Date(),
        processedAt: null,
      });
      return id;
    },
    async listScheduled(query) {
      return [...scheduled.values()]
        .filter(
          (m) =>
            (!query.status || m.status === query.status) &&
            (!query.contactId || m.contactId === query.contactId),
        )
        .sort((a, b) => {
          const pa = a.status === 'pending' ? 0 : 1;
          const pb = b.status === 'pending' ? 0 : 1;
          return pa - pb || b.dueAt.getTime() - a.dueAt.getTime();
        })
        .slice(query.offset, query.offset + query.limit)
        .map((m) => {
          const contact = contactById(m.contactId);
          const enrollment = m.enrollmentId ? enrollments.get(m.enrollmentId) : undefined;
          return {
            ...m,
            phone: contact?.phone ?? '',
            name: contact?.name ?? null,
            sequenceName: enrollment ? (sequences.get(enrollment.sequenceId)?.name ?? null) : null,
          };
        });
    },
    async cancelScheduled(id) {
      const m = scheduled.get(id);
      if (!m || m.status !== 'pending') return false;
      m.status = 'cancelled';
      m.processedAt = new Date();
      return true;
    },
    async cancelPendingForEnrollment(enrollmentId) {
      let count = 0;
      for (const m of scheduled.values()) {
        if (m.enrollmentId === enrollmentId && m.status === 'pending') {
          m.status = 'cancelled';
          m.processedAt = new Date();
          count++;
        }
      }
      return count;
    },
    async claimDue(now, limit) {
      const due = [...scheduled.values()]
        .filter((m) => m.status === 'pending' && m.dueAt.getTime() <= now.getTime())
        .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
        .slice(0, limit);
      for (const m of due) m.status = 'processing';
      return due.map((m) => ({ ...m }));
    },
    async markScheduled(id, status, detail, deliveryId) {
      const m = scheduled.get(id);
      if (!m) return;
      m.status = status;
      m.detail = detail ?? null;
      m.deliveryId = deliveryId ?? null;
      m.processedAt = new Date();
    },

    async getPrefs() {
      return { ...prefs };
    },
    async setPrefs(patch) {
      prefs = { ...prefs, ...patch };
      return { ...prefs };
    },
  };

  return repo;
}
