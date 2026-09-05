/** Dobles en memoria: permiten probar gates, sender y webhook sin Postgres. */

import type {
  Contact,
  Repos,
  Template,
  TemplateCategory,
  NumberState,
  TrackPoint,
  TrackingLink,
} from '../src/db/repos.js';
import type { WhatsAppClient } from '../src/whatsapp/client.js';
import type { Config } from '../src/config.js';
import { createSettingsService, type SettingsRepo, type SettingsService } from '../src/settings/service.js';

export interface FakeRepos extends Repos {
  _contacts: Map<string, Contact>;
  _deliveries: Array<Record<string, unknown>>;
  _locations: Array<Record<string, unknown>>;
  _templates: Map<string, Template>;
  _points: Map<string, TrackPoint[]>;
}

let seq = 1;

export function createFakeRepos(overrides: Partial<NumberState> = {}): FakeRepos {
  const contactsByPhone = new Map<string, Contact>();
  const deliveries: Array<Record<string, unknown>> = [];
  const locations: Array<Record<string, unknown>> = [];
  const templates = new Map<string, Template>();
  const points = new Map<string, TrackPoint[]>();
  const links = new Map<string, TrackingLink>();
  const counters = new Map<string, number>();

  let numberState: NumberState = {
    phoneNumberId: 'PNID',
    quality: 'GREEN',
    paused: false,
    pausedReason: null,
    warmupStartedOn: new Date('2020-01-01T00:00:00Z'),
    ...overrides,
  };

  const dayKey = (day: Date) => day.toISOString().slice(0, 10);

  const repos: FakeRepos = {
    _contacts: contactsByPhone,
    _deliveries: deliveries,
    _locations: locations,
    _templates: templates,
    _points: points,

    contacts: {
      async getByPhone(phone) {
        return contactsByPhone.get(phone) ?? null;
      },
      async getById(id) {
        return [...contactsByPhone.values()].find((c) => c.id === id) ?? null;
      },
      async upsertFromInbound(phone, name) {
        const existing = contactsByPhone.get(phone);
        if (existing) {
          if (name) existing.name = name;
          return existing;
        }
        const contact: Contact = {
          id: `c${seq++}`,
          phone,
          name: name ?? null,
          optInAt: null,
          optInSource: null,
          optOutAt: null,
          lastInboundAt: null,
        };
        contactsByPhone.set(phone, contact);
        return contact;
      },
      async setOptIn(phone, source) {
        const c = await repos.contacts.upsertFromInbound(phone);
        c.optInAt = new Date();
        c.optInSource = source;
        c.optOutAt = null;
      },
      async setOptOut(phone) {
        const c = await repos.contacts.upsertFromInbound(phone);
        c.optOutAt = new Date();
      },
      async touchInbound(phone, at) {
        const c = await repos.contacts.upsertFromInbound(phone);
        c.lastInboundAt = at;
      },
      async listOptedIn(limit, offset) {
        return [...contactsByPhone.values()]
          .filter((c) => c.optInAt && !c.optOutAt)
          .slice(offset, offset + limit);
      },
    },

    locations: {
      async save(contactId, result, rawInput) {
        const id = seq++;
        locations.push({ id, contactId, ...result, rawInput, confirmed: false });
        return id;
      },
      async confirm(locationId) {
        const row = locations.find((l) => l.id === locationId);
        if (row) row.confirmed = true;
      },
      async latestFor(contactId) {
        const row = [...locations].reverse().find((l) => l.contactId === contactId);
        return row ? { lat: row.lat as number, lng: row.lng as number } : null;
      },
    },

    deliveries: {
      async create(input) {
        const id = seq++;
        deliveries.push({ id, status: 'queued', queuedAt: new Date(), ...input });
        return id;
      },
      async markSent(id, wamid) {
        const row = deliveries.find((d) => d.id === id);
        if (row) Object.assign(row, { status: 'sent', wamid });
      },
      async markBlocked(id, reason) {
        const row = deliveries.find((d) => d.id === id);
        if (row) Object.assign(row, { status: 'blocked_by_gate', reason });
      },
      async updateByWamid(wamid, status, error) {
        const row = deliveries.find((d) => d.wamid === wamid);
        if (row) Object.assign(row, { status, error });
      },
      async countMarketingSince(contactId, since) {
        return deliveries.filter(
          (d) =>
            d.contactId === contactId &&
            d.category === 'MARKETING' &&
            d.status === 'sent' &&
            (d.queuedAt as Date) >= since,
        ).length;
      },
      async campaignStats(campaignId) {
        const stats: Record<string, number> = {};
        for (const d of deliveries.filter((x) => x.campaignId === campaignId)) {
          const key = String(d.status);
          stats[key] = (stats[key] ?? 0) + 1;
        }
        return stats;
      },
    },

    templates: {
      async get(name, language) {
        return templates.get(`${name}/${language}`) ?? null;
      },
      async upsert(t) {
        templates.set(`${t.name}/${t.language}`, t);
      },
      async setStatus(name, language, status) {
        const t = templates.get(`${name}/${language}`);
        if (t) t.status = status;
      },
      async setQuality(name, language, quality) {
        const t = templates.get(`${name}/${language}`);
        if (t) t.quality = quality;
      },
      async list() {
        return [...templates.values()];
      },
    },

    numberState: {
      async get() {
        return numberState;
      },
      async setQuality(_id, quality) {
        numberState = { ...numberState, quality };
      },
      async setPaused(_id, paused, reason) {
        numberState = { ...numberState, paused, pausedReason: reason ?? null };
      },
    },

    counters: {
      async increment(phoneNumberId, category: TemplateCategory, day) {
        const key = `${phoneNumberId}/${dayKey(day)}/${category}`;
        const next = (counters.get(key) ?? 0) + 1;
        counters.set(key, next);
        return next;
      },
      async totalForDay(phoneNumberId, day) {
        let total = 0;
        for (const [key, value] of counters) {
          if (key.startsWith(`${phoneNumberId}/${dayKey(day)}/`)) total += value;
        }
        return total;
      },
    },

    tracking: {
      async createLink(contactId, label, expiresAt) {
        const link: TrackingLink = { id: `l${seq++}`, contactId, label, expiresAt, revokedAt: null };
        links.set(link.id, link);
        return link;
      },
      async getLink(id) {
        return links.get(id) ?? null;
      },
      async revoke(id) {
        const link = links.get(id);
        if (link) link.revokedAt = new Date();
      },
      async addPoint(linkId, point) {
        const list = points.get(linkId) ?? [];
        list.push(point);
        points.set(linkId, list);
      },
      async listPoints(linkId, limit = 500) {
        return (points.get(linkId) ?? []).slice(-limit);
      },
    },

    campaigns: {
      async create() {
        return `camp${seq++}`;
      },
      async setStatus() {},
      async list() {
        return [];
      },
    },
  };

  return repos;
}

export interface FakeWhatsApp extends WhatsAppClient {
  sent: Array<Record<string, unknown>>;
  failNext?: Error;
}

export function createFakeWhatsApp(): FakeWhatsApp {
  const sent: Array<Record<string, unknown>> = [];
  let counter = 0;

  const record = async (entry: Record<string, unknown>) => {
    if (client.failNext) {
      const error = client.failNext;
      client.failNext = undefined;
      throw error;
    }
    sent.push(entry);
    return { wamid: `wamid.${++counter}` };
  };

  const client: FakeWhatsApp = {
    sent,
    sendText: (to, body) => record({ kind: 'text', to, body }),
    sendLocation: (to, location) => record({ kind: 'location', to, location }),
    sendLocationRequest: (to, body) => record({ kind: 'location_request', to, body }),
    sendButtons: (to, body, buttons) => record({ kind: 'buttons', to, body, buttons }),
    sendTemplate: (to, name, language, components) =>
      record({ kind: 'template', to, name, language, components }),
    async markAsRead(messageId) {
      sent.push({ kind: 'read', messageId });
    },
    async createTemplate(input) {
      sent.push({ kind: 'create_template', ...input });
      return { id: 'tpl_1', status: 'PENDING' };
    },
    async listTemplates() {
      return [];
    },
  };

  return client;
}

export function approvedTemplate(overrides: Partial<Template> = {}): Template {
  return {
    name: 'confirmacion_pedido',
    language: 'es_MX',
    category: 'UTILITY',
    status: 'APPROVED',
    quality: 'GREEN',
    variables: 3,
    body: 'Hola {{1}}, tu pedido #{{2}} va en camino. Sigue el envio aqui: {{3}}. Gracias.',
    ...overrides,
  };
}


/** Clave de cifrado fija para los tests: 32 bytes en base64. */
export const TEST_SETTINGS_KEY = Buffer.alloc(32, 7).toString('base64');

export function createMemorySettingsRepo(): SettingsRepo {
  const rows = new Map<string, { value: string; encrypted: boolean }>();
  return {
    async getAll() {
      return [...rows.entries()].map(([key, row]) => ({ key, ...row }));
    },
    async put(key, value, encrypted) {
      rows.set(key, { value, encrypted });
    },
    async remove(key) {
      rows.delete(key);
    },
  };
}

/** Servicio de ajustes real sobre un repositorio en memoria. */
export function createFakeSettings(config: Config): Promise<SettingsService> {
  return createSettingsService(createMemorySettingsRepo(), config, TEST_SETTINGS_KEY);
}
