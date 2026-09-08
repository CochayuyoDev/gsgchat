/** Dobles en memoria: permiten probar gates, sender y webhook sin Postgres. */

import type {
  Campaign,
  Contact,
  ContactListItem,
  DeliveryListItem,
  DeliveryStatus,
  LocationListItem,
  Repos,
  Template,
  TemplateCategory,
  NumberState,
  TrackPoint,
  TrackingLink,
} from '../src/db/repos.js';
import { normalizePhone } from '../src/db/repos.js';
import type { PhoneNumberInfo, WhatsAppClient } from '../src/whatsapp/client.js';
import type { Config } from '../src/config.js';
import { createSettingsService, type SettingsRepo, type SettingsService } from '../src/settings/service.js';
import { createFakeAutomation, type FakeAutomation } from './fakes-automation.js';
import { createFakeMessages, type FakeMessages } from './fakes-messages.js';

export interface FakeRepos extends Repos {
  automation: FakeAutomation;
  messages: FakeMessages;
  _contacts: Map<string, Contact>;
  _deliveries: Array<Record<string, unknown>>;
  _locations: Array<Record<string, unknown>>;
  _templates: Map<string, Template>;
  _points: Map<string, TrackPoint[]>;
  _campaigns: Map<string, Campaign>;
  _links: Map<string, TrackingLink>;
}

let seq = 1;

export function createFakeRepos(overrides: Partial<NumberState> = {}): FakeRepos {
  const contactsByPhone = new Map<string, Contact & { createdAt: Date; chatReadAt?: Date | null }>();
  const deliveries: Array<Record<string, unknown>> = [];
  const locations: Array<Record<string, unknown>> = [];
  const templates = new Map<string, Template>();
  const points = new Map<string, TrackPoint[]>();
  const links = new Map<string, TrackingLink & { createdAt: Date }>();
  const campaigns = new Map<string, Campaign>();
  const counters = new Map<string, number>();

  let numberState: NumberState = {
    phoneNumberId: 'PNID',
    quality: 'GREEN',
    paused: false,
    pausedReason: null,
    warmupStartedOn: new Date('2020-01-01T00:00:00Z'),
    tier: null,
    ...overrides,
  };

  const dayKey = (day: Date) => day.toISOString().slice(0, 10);
  const contactById = (id: string) => [...contactsByPhone.values()].find((c) => c.id === id);

  const repos: FakeRepos = {
    _contacts: contactsByPhone,
    _deliveries: deliveries,
    _locations: locations,
    _templates: templates,
    _points: points,
    _campaigns: campaigns,
    _links: links,
    automation: createFakeAutomation(contactById),
    messages: createFakeMessages(() => [...contactsByPhone.values()]),

    contacts: {
      async getByPhone(phone) {
        return contactsByPhone.get(phone) ?? null;
      },
      async getById(id) {
        return contactById(id) ?? null;
      },
      async upsertFromInbound(phone, name) {
        const existing = contactsByPhone.get(phone);
        if (existing) {
          if (name) existing.name = name;
          return existing;
        }
        const contact: Contact & { createdAt: Date; chatReadAt?: Date | null } = {
          id: `c${seq++}`,
          phone,
          name: name ?? null,
          optInAt: null,
          optInSource: null,
          optOutAt: null,
          lastInboundAt: null,
          createdAt: new Date(),
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
      async list(query) {
        const q = query.q?.trim().toLowerCase();
        const all = [...contactsByPhone.values()]
          .filter((c) => {
            if (q && !c.phone.includes(q) && !(c.name ?? '').toLowerCase().includes(q)) return false;
            switch (query.state ?? 'all') {
              case 'opted_in':
                return Boolean(c.optInAt && !c.optOutAt);
              case 'opted_out':
                return Boolean(c.optOutAt);
              case 'pending':
                return !c.optInAt && !c.optOutAt;
              default:
                return true;
            }
          })
          .sort(
            (a, b) =>
              (b.lastInboundAt ?? b.createdAt).getTime() - (a.lastInboundAt ?? a.createdAt).getTime(),
          );
        const items: ContactListItem[] = all.slice(query.offset, query.offset + query.limit).map((c) => {
          const last = [...locations].reverse().find((l) => l.contactId === c.id);
          return {
            ...c,
            lastLocation: last
              ? { lat: last.lat as number, lng: last.lng as number, at: last.createdAt as Date }
              : null,
          };
        });
        return { items, total: all.length };
      },
      async bulkOptIn(entries, source) {
        let count = 0;
        for (const entry of entries) {
          const phone = normalizePhone(entry.phone);
          if (phone.length < 6) continue;
          const c = await repos.contacts.upsertFromInbound(phone, entry.name?.trim() || undefined);
          c.optInAt = new Date();
          c.optInSource = source;
          c.optOutAt = null;
          count++;
        }
        return count;
      },
    },

    locations: {
      async save(contactId, result, rawInput) {
        const id = seq++;
        locations.push({ id, contactId, ...result, rawInput, confirmed: false, createdAt: new Date() });
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
      async listRecent(query) {
        const items: LocationListItem[] = [];
        for (const row of [...locations].reverse()) {
          const contact = contactById(row.contactId as string);
          if (!contact) continue;
          if (query.phone && contact.phone !== query.phone) continue;
          items.push({
            id: row.id as number,
            contactId: contact.id,
            phone: contact.phone,
            name: contact.name,
            lat: row.lat as number,
            lng: row.lng as number,
            source: row.source as string,
            confidence: row.confidence as string,
            precisionMeters: row.precisionMeters as number,
            rawInput: (row.rawInput as string) ?? null,
            resolvedUrl: (row.resolvedUrl as string) ?? null,
            confirmed: Boolean(row.confirmed),
            createdAt: row.createdAt as Date,
          });
        }
        return items.slice(query.offset, query.offset + query.limit);
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
        if (row) Object.assign(row, { status: 'sent', wamid, sentAt: new Date() });
      },
      async markBlocked(id, reason) {
        const row = deliveries.find((d) => d.id === id);
        if (row) Object.assign(row, { status: 'blocked_by_gate', reason, errorTitle: reason, failedAt: new Date() });
      },
      async updateByWamid(wamid, status, error) {
        const row = deliveries.find((d) => d.wamid === wamid);
        if (row) Object.assign(row, { status, error, errorCode: error?.code ?? null, errorTitle: error?.title ?? null });
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
      async listRecent(query) {
        const items: DeliveryListItem[] = [];
        for (const d of [...deliveries].reverse()) {
          const contact = contactById(d.contactId as string);
          if (!contact) continue;
          if (query.status && d.status !== query.status) continue;
          if (query.campaignId && d.campaignId !== query.campaignId) continue;
          if (query.phone && contact.phone !== query.phone) continue;
          const campaign = d.campaignId ? campaigns.get(d.campaignId as string) : undefined;
          items.push({
            id: d.id as number,
            campaignId: (d.campaignId as string) ?? null,
            campaignName: campaign?.name ?? null,
            contactId: contact.id,
            phone: contact.phone,
            name: contact.name,
            wamid: (d.wamid as string) ?? null,
            kind: d.kind as string,
            templateName: (d.templateName as string) ?? null,
            category: d.category as TemplateCategory,
            status: d.status as DeliveryStatus,
            errorCode: (d.errorCode as string) ?? null,
            errorTitle: (d.errorTitle as string) ?? null,
            queuedAt: d.queuedAt as Date,
            sentAt: (d.sentAt as Date) ?? null,
            deliveredAt: null,
            readAt: null,
            failedAt: (d.failedAt as Date) ?? null,
          });
        }
        return items.slice(query.offset, query.offset + query.limit);
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
      async setTier(_id, tier) {
        numberState = { ...numberState, tier };
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
        const link = { id: `l${seq++}`, contactId, label, expiresAt, revokedAt: null, createdAt: new Date() };
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
        list.push({ ...point, recordedAt: point.recordedAt ?? new Date() });
        points.set(linkId, list);
      },
      async listPoints(linkId, limit = 500) {
        return (points.get(linkId) ?? []).slice(-limit);
      },
      async listActive(now) {
        return [...links.values()]
          .filter((l) => !l.revokedAt && l.expiresAt.getTime() > now.getTime())
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((l) => {
            const contact = l.contactId ? contactById(l.contactId) : undefined;
            const list = points.get(l.id) ?? [];
            const last = list.at(-1);
            return {
              ...l,
              phone: contact?.phone ?? null,
              name: contact?.name ?? null,
              pointCount: list.length,
              lastPoint: last ? { lat: last.lat, lng: last.lng, at: last.recordedAt ?? new Date() } : null,
            };
          });
      },
    },

    campaigns: {
      async create(input) {
        const id = `camp${seq++}`;
        campaigns.set(id, { id, ...input, status: 'draft', createdAt: new Date() });
        return id;
      },
      async setStatus(id, status) {
        const c = campaigns.get(id);
        if (c) c.status = status;
      },
      async get(id) {
        return campaigns.get(id) ?? null;
      },
      async list() {
        const all = [...campaigns.values()].sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        );
        return Promise.all(
          all.map(async (c) => ({ ...c, stats: await repos.deliveries.campaignStats(c.id) })),
        );
      },
    },
  };

  return repos;
}

export interface FakeWhatsApp extends WhatsAppClient {
  sent: Array<Record<string, unknown>>;
  failNext?: Error;
  /** Lo que devuelve getPhoneNumber; editable desde los tests. */
  phoneInfo: PhoneNumberInfo;
  /** Lo que devuelve listTemplates; editable desde los tests. */
  remoteTemplates: Awaited<ReturnType<WhatsAppClient['listTemplates']>>;
  subscribedApps: Array<{ id: string; name: string }>;
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
    phoneInfo: {
      displayPhoneNumber: '+52 1 55 0000 0000',
      verifiedName: 'Demo',
      qualityRating: 'GREEN',
      messagingLimitTier: 'TIER_1K',
    },
    remoteTemplates: [],
    subscribedApps: [],
    sendText: (to, body) => record({ kind: 'text', to, body }),
    sendLocation: (to, location) => record({ kind: 'location', to, location }),
    sendLocationRequest: (to, body) => record({ kind: 'location_request', to, body }),
    sendButtons: (to, body, buttons) => record({ kind: 'buttons', to, body, buttons }),
    sendTemplate: (to, name, language, components) =>
      record({ kind: 'template', to, name, language, components }),
    async markAsRead(messageId) {
      sent.push({ kind: 'read', messageId });
    },
    async getPhoneNumber() {
      if (client.failNext) {
        const error = client.failNext;
        client.failNext = undefined;
        throw error;
      }
      return client.phoneInfo;
    },
    async subscribeApp() {
      sent.push({ kind: 'subscribe_app' });
      client.subscribedApps = [{ id: 'app_demo', name: 'wa-locator' }];
      return { success: true };
    },
    async listSubscribedApps() {
      return client.subscribedApps;
    },
    async registerPhone(pin) {
      sent.push({ kind: 'register_phone', pin });
      return { success: true };
    },
    async createTemplate(input) {
      if (client.failNext) {
        const error = client.failNext;
        client.failNext = undefined;
        throw error;
      }
      sent.push({ kind: 'create_template', ...input });
      return { id: `tpl_${++counter}`, status: 'PENDING' };
    },
    async listTemplates() {
      return client.remoteTemplates;
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
