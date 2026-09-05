/**
 * Acceso a datos.
 *
 * Cada repositorio es una interfaz + una implementacion sobre Postgres.
 * Las interfaces existen para que los gates y el router se puedan probar
 * con dobles en memoria (`tests/fakes.ts`) sin levantar la base.
 */

import type { Pool } from './pool.js';
import type { ExtractionSuccess } from '../types.js';

// ---------------------------------------------------------------- modelos

export interface Contact {
  id: string;
  phone: string;
  name: string | null;
  optInAt: Date | null;
  optInSource: string | null;
  optOutAt: Date | null;
  lastInboundAt: Date | null;
}

export type TemplateStatus = 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED';
export type TemplateQuality = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
export type TemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';

export interface Template {
  name: string;
  language: string;
  category: TemplateCategory;
  status: TemplateStatus;
  quality: TemplateQuality | null;
  variables: number;
  body: string | null;
}

export interface NumberState {
  phoneNumberId: string;
  quality: 'GREEN' | 'YELLOW' | 'RED';
  paused: boolean;
  pausedReason: string | null;
  warmupStartedOn: Date;
}

export type DeliveryStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'blocked_by_gate';

export interface TrackingLink {
  id: string;
  contactId: string | null;
  label: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface TrackPoint {
  lat: number;
  lng: number;
  accuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
  recordedAt?: Date;
}

// ------------------------------------------------------------ interfaces

export interface ContactsRepo {
  getByPhone(phone: string): Promise<Contact | null>;
  getById(id: string): Promise<Contact | null>;
  upsertFromInbound(phone: string, name?: string): Promise<Contact>;
  setOptIn(phone: string, source: string): Promise<void>;
  setOptOut(phone: string): Promise<void>;
  touchInbound(phone: string, at: Date): Promise<void>;
  listOptedIn(limit: number, offset: number): Promise<Contact[]>;
}

export interface LocationsRepo {
  save(contactId: string, result: ExtractionSuccess, rawInput: string): Promise<number>;
  confirm(locationId: number): Promise<void>;
  latestFor(contactId: string): Promise<{ lat: number; lng: number } | null>;
}

export interface DeliveriesRepo {
  create(input: {
    contactId: string;
    campaignId?: string | null;
    kind: string;
    templateName?: string | null;
    category: TemplateCategory;
    variables?: unknown;
  }): Promise<number>;
  markSent(id: number, wamid: string): Promise<void>;
  markBlocked(id: number, reason: string): Promise<void>;
  updateByWamid(wamid: string, status: DeliveryStatus, error?: { code?: string; title?: string }): Promise<void>;
  countMarketingSince(contactId: string, since: Date): Promise<number>;
  campaignStats(campaignId: string): Promise<Record<string, number>>;
}

export interface TemplatesRepo {
  get(name: string, language: string): Promise<Template | null>;
  upsert(template: Template): Promise<void>;
  setStatus(name: string, language: string, status: TemplateStatus): Promise<void>;
  setQuality(name: string, language: string, quality: TemplateQuality): Promise<void>;
  list(): Promise<Template[]>;
}

export interface NumberStateRepo {
  get(phoneNumberId: string): Promise<NumberState>;
  setQuality(phoneNumberId: string, quality: NumberState['quality']): Promise<void>;
  setPaused(phoneNumberId: string, paused: boolean, reason?: string): Promise<void>;
}

export interface CountersRepo {
  /** Suma 1 y devuelve el total del dia para esa categoria. */
  increment(phoneNumberId: string, category: TemplateCategory, day: Date): Promise<number>;
  totalForDay(phoneNumberId: string, day: Date): Promise<number>;
}

export interface TrackingRepo {
  createLink(contactId: string | null, label: string | null, expiresAt: Date): Promise<TrackingLink>;
  getLink(id: string): Promise<TrackingLink | null>;
  revoke(id: string): Promise<void>;
  addPoint(linkId: string, point: TrackPoint): Promise<void>;
  listPoints(linkId: string, limit?: number): Promise<TrackPoint[]>;
}

export interface CampaignsRepo {
  create(input: {
    name: string;
    templateName: string;
    templateLanguage: string;
    category: TemplateCategory;
  }): Promise<string>;
  setStatus(id: string, status: string): Promise<void>;
  list(): Promise<Array<{ id: string; name: string; status: string; createdAt: Date }>>;
}

export interface Repos {
  contacts: ContactsRepo;
  locations: LocationsRepo;
  deliveries: DeliveriesRepo;
  templates: TemplatesRepo;
  numberState: NumberStateRepo;
  counters: CountersRepo;
  tracking: TrackingRepo;
  campaigns: CampaignsRepo;
}

// ------------------------------------------------------- impl. Postgres

interface ContactRow {
  id: string;
  phone: string;
  name: string | null;
  opt_in_at: Date | null;
  opt_in_source: string | null;
  opt_out_at: Date | null;
  last_inbound_at: Date | null;
}

const toContact = (row: ContactRow): Contact => ({
  id: row.id,
  phone: row.phone,
  name: row.name,
  optInAt: row.opt_in_at,
  optInSource: row.opt_in_source,
  optOutAt: row.opt_out_at,
  lastInboundAt: row.last_inbound_at,
});

export function createRepos(pool: Pool): Repos {
  const contacts: ContactsRepo = {
    async getByPhone(phone) {
      const { rows } = await pool.query<ContactRow>('select * from contacts where phone = $1', [phone]);
      return rows[0] ? toContact(rows[0]) : null;
    },
    async getById(id) {
      const { rows } = await pool.query<ContactRow>('select * from contacts where id = $1', [id]);
      return rows[0] ? toContact(rows[0]) : null;
    },
    async upsertFromInbound(phone, name) {
      const { rows } = await pool.query<ContactRow>(
        `insert into contacts (phone, name)
         values ($1, $2)
         on conflict (phone) do update set name = coalesce(excluded.name, contacts.name)
         returning *`,
        [phone, name ?? null],
      );
      return toContact(rows[0]!);
    },
    async setOptIn(phone, source) {
      // Un alta borra la baja previa: el contacto acaba de decir que si.
      await pool.query(
        `update contacts
            set opt_in_at = now(), opt_in_source = $2, opt_out_at = null
          where phone = $1`,
        [phone, source],
      );
    },
    async setOptOut(phone) {
      await pool.query('update contacts set opt_out_at = now() where phone = $1', [phone]);
    },
    async touchInbound(phone, at) {
      await pool.query('update contacts set last_inbound_at = $2 where phone = $1', [phone, at]);
    },
    async listOptedIn(limit, offset) {
      const { rows } = await pool.query<ContactRow>(
        `select * from contacts
          where opt_in_at is not null and opt_out_at is null
          order by created_at
          limit $1 offset $2`,
        [limit, offset],
      );
      return rows.map(toContact);
    },
  };

  const locations: LocationsRepo = {
    async save(contactId, result, rawInput) {
      const { rows } = await pool.query<{ id: number }>(
        `insert into locations
           (contact_id, lat, lng, source, confidence, precision_meters, raw_input, resolved_url)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         returning id`,
        [
          contactId,
          result.lat,
          result.lng,
          result.source,
          result.confidence,
          result.precisionMeters,
          rawInput.slice(0, 4000),
          result.resolvedUrl ?? null,
        ],
      );
      return rows[0]!.id;
    },
    async confirm(locationId) {
      await pool.query('update locations set confirmed = true where id = $1', [locationId]);
    },
    async latestFor(contactId) {
      const { rows } = await pool.query<{ lat: number; lng: number }>(
        'select lat, lng from locations where contact_id = $1 order by created_at desc limit 1',
        [contactId],
      );
      return rows[0] ?? null;
    },
  };

  const deliveries: DeliveriesRepo = {
    async create(input) {
      const { rows } = await pool.query<{ id: number }>(
        `insert into deliveries
           (contact_id, campaign_id, kind, template_name, category, variables)
         values ($1,$2,$3,$4,$5,$6)
         returning id`,
        [
          input.contactId,
          input.campaignId ?? null,
          input.kind,
          input.templateName ?? null,
          input.category,
          input.variables ? JSON.stringify(input.variables) : null,
        ],
      );
      return rows[0]!.id;
    },
    async markSent(id, wamid) {
      await pool.query(
        `update deliveries set status = 'sent', wamid = $2, sent_at = now() where id = $1`,
        [id, wamid],
      );
    },
    async markBlocked(id, reason) {
      await pool.query(
        `update deliveries
            set status = 'blocked_by_gate', error_title = $2, failed_at = now()
          where id = $1`,
        [id, reason],
      );
    },
    async updateByWamid(wamid, status, error) {
      const column =
        status === 'delivered'
          ? 'delivered_at'
          : status === 'read'
            ? 'read_at'
            : status === 'failed'
              ? 'failed_at'
              : 'sent_at';
      await pool.query(
        `update deliveries
            set status = $2, ${column} = now(), error_code = $3, error_title = $4
          where wamid = $1`,
        [wamid, status, error?.code ?? null, error?.title ?? null],
      );
    },
    async countMarketingSince(contactId, since) {
      const { rows } = await pool.query<{ count: number }>(
        `select count(*)::int as count
           from deliveries
          where contact_id = $1
            and category = 'MARKETING'
            and status in ('sent','delivered','read')
            and queued_at >= $2`,
        [contactId, since],
      );
      return rows[0]?.count ?? 0;
    },
    async campaignStats(campaignId) {
      const { rows } = await pool.query<{ status: string; count: number }>(
        `select status, count(*)::int as count
           from deliveries where campaign_id = $1 group by status`,
        [campaignId],
      );
      return Object.fromEntries(rows.map((r) => [r.status, r.count]));
    },
  };

  const templates: TemplatesRepo = {
    async get(name, language) {
      const { rows } = await pool.query<Template>(
        'select name, language, category, status, quality, variables, body from templates where name = $1 and language = $2',
        [name, language],
      );
      return rows[0] ?? null;
    },
    async upsert(t) {
      await pool.query(
        `insert into templates (name, language, category, status, quality, variables, body, synced_at)
         values ($1,$2,$3,$4,$5,$6,$7, now())
         on conflict (name, language) do update set
           category = excluded.category,
           status = excluded.status,
           quality = coalesce(excluded.quality, templates.quality),
           variables = excluded.variables,
           body = excluded.body,
           synced_at = now()`,
        [t.name, t.language, t.category, t.status, t.quality, t.variables, t.body],
      );
    },
    async setStatus(name, language, status) {
      await pool.query('update templates set status = $3 where name = $1 and language = $2', [
        name,
        language,
        status,
      ]);
    },
    async setQuality(name, language, quality) {
      await pool.query('update templates set quality = $3 where name = $1 and language = $2', [
        name,
        language,
        quality,
      ]);
    },
    async list() {
      const { rows } = await pool.query<Template>(
        'select name, language, category, status, quality, variables, body from templates order by name',
      );
      return rows;
    },
  };

  const numberState: NumberStateRepo = {
    async get(phoneNumberId) {
      const { rows } = await pool.query<{
        phone_number_id: string;
        quality: NumberState['quality'];
        paused: boolean;
        paused_reason: string | null;
        warmup_started_on: Date;
      }>(
        `insert into number_state (phone_number_id) values ($1)
         on conflict (phone_number_id) do update set updated_at = now()
         returning *`,
        [phoneNumberId],
      );
      const row = rows[0]!;
      return {
        phoneNumberId: row.phone_number_id,
        quality: row.quality,
        paused: row.paused,
        pausedReason: row.paused_reason,
        warmupStartedOn: row.warmup_started_on,
      };
    },
    async setQuality(phoneNumberId, quality) {
      await pool.query(
        `insert into number_state (phone_number_id, quality) values ($1,$2)
         on conflict (phone_number_id) do update set quality = $2, updated_at = now()`,
        [phoneNumberId, quality],
      );
    },
    async setPaused(phoneNumberId, paused, reason) {
      await pool.query(
        `insert into number_state (phone_number_id, paused, paused_reason) values ($1,$2,$3)
         on conflict (phone_number_id) do update set
           paused = $2, paused_reason = $3, updated_at = now()`,
        [phoneNumberId, paused, reason ?? null],
      );
    },
  };

  const counters: CountersRepo = {
    async increment(phoneNumberId, category, day) {
      const { rows } = await pool.query<{ sent: number }>(
        `insert into send_counters (phone_number_id, day, category, sent)
         values ($1,$2,$3,1)
         on conflict (phone_number_id, day, category)
           do update set sent = send_counters.sent + 1
         returning sent`,
        [phoneNumberId, day, category],
      );
      return rows[0]!.sent;
    },
    async totalForDay(phoneNumberId, day) {
      const { rows } = await pool.query<{ total: number }>(
        `select coalesce(sum(sent),0)::int as total
           from send_counters where phone_number_id = $1 and day = $2`,
        [phoneNumberId, day],
      );
      return rows[0]?.total ?? 0;
    },
  };

  const tracking: TrackingRepo = {
    async createLink(contactId, label, expiresAt) {
      const { rows } = await pool.query<{
        id: string;
        contact_id: string | null;
        label: string | null;
        expires_at: Date;
        revoked_at: Date | null;
      }>(
        `insert into tracking_links (contact_id, label, expires_at)
         values ($1,$2,$3) returning *`,
        [contactId, label, expiresAt],
      );
      const row = rows[0]!;
      return {
        id: row.id,
        contactId: row.contact_id,
        label: row.label,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
      };
    },
    async getLink(id) {
      const { rows } = await pool.query<{
        id: string;
        contact_id: string | null;
        label: string | null;
        expires_at: Date;
        revoked_at: Date | null;
      }>('select * from tracking_links where id = $1', [id]);
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        contactId: row.contact_id,
        label: row.label,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
      };
    },
    async revoke(id) {
      await pool.query('update tracking_links set revoked_at = now() where id = $1', [id]);
    },
    async addPoint(linkId, p) {
      await pool.query(
        `insert into track_points (link_id, lat, lng, accuracy, heading, speed)
         values ($1,$2,$3,$4,$5,$6)`,
        [linkId, p.lat, p.lng, p.accuracy ?? null, p.heading ?? null, p.speed ?? null],
      );
    },
    async listPoints(linkId, limit = 500) {
      const { rows } = await pool.query<TrackPoint>(
        `select lat, lng, accuracy, heading, speed, recorded_at as "recordedAt"
           from track_points where link_id = $1
          order by recorded_at desc limit $2`,
        [linkId, limit],
      );
      return rows.reverse();
    },
  };

  const campaigns: CampaignsRepo = {
    async create(input) {
      const { rows } = await pool.query<{ id: string }>(
        `insert into campaigns (name, template_name, template_language, category)
         values ($1,$2,$3,$4) returning id`,
        [input.name, input.templateName, input.templateLanguage, input.category],
      );
      return rows[0]!.id;
    },
    async setStatus(id, status) {
      await pool.query('update campaigns set status = $2 where id = $1', [id, status]);
    },
    async list() {
      const { rows } = await pool.query<{
        id: string;
        name: string;
        status: string;
        created_at: Date;
      }>('select id, name, status, created_at from campaigns order by created_at desc');
      return rows.map((r) => ({ id: r.id, name: r.name, status: r.status, createdAt: r.created_at }));
    },
  };

  return { contacts, locations, deliveries, templates, numberState, counters, tracking, campaigns };
}

// ------------------------------------------------------ ajustes editables

/** Repositorio de la tabla `settings` (credenciales editables desde /setup). */
export function createSettingsRepo(pool: Pool) {
  return {
    async getAll() {
      const { rows } = await pool.query<{ key: string; value: string; encrypted: boolean }>(
        'select key, value, encrypted from settings',
      );
      return rows;
    },
    async put(key: string, value: string, encrypted: boolean) {
      await pool.query(
        `insert into settings (key, value, encrypted, updated_at)
         values ($1,$2,$3, now())
         on conflict (key) do update set
           value = excluded.value, encrypted = excluded.encrypted, updated_at = now()`,
        [key, value, encrypted],
      );
    },
    async remove(key: string) {
      await pool.query('delete from settings where key = $1', [key]);
    },
  };
}
