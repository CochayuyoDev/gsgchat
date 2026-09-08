/**
 * Acceso a datos.
 *
 * Cada repositorio es una interfaz + una implementacion sobre Postgres.
 * Las interfaces existen para que los gates y el router se puedan probar
 * con dobles en memoria (`tests/fakes.ts`) sin levantar la base.
 */

import type { Pool } from './pool.js';
import type { ExtractionSuccess } from '../types.js';
import { createAutomationRepo, type AutomationRepo } from './automation.js';

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

/** Contacto tal como lo lista el panel: con su ultima ubicacion conocida. */
export interface ContactListItem extends Contact {
  createdAt: Date;
  lastLocation: { lat: number; lng: number; at: Date } | null;
}

export type ContactState = 'all' | 'opted_in' | 'opted_out' | 'pending';

export interface ContactListQuery {
  /** Busca por telefono o nombre (subcadena, sin distinguir mayusculas). */
  q?: string;
  /** all | opted_in | opted_out | pending (sin opt-in ni baja). */
  state?: ContactState;
  limit: number;
  offset: number;
}

export interface ContactImportEntry {
  phone: string;
  name?: string | null;
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
  /** Tier de envio que reporta Meta (TIER_250, TIER_1K, ...). */
  tier: string | null;
}

export type DeliveryStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'blocked_by_gate';

export interface DeliveryListItem {
  id: number;
  campaignId: string | null;
  campaignName: string | null;
  contactId: string;
  phone: string;
  name: string | null;
  wamid: string | null;
  kind: string;
  templateName: string | null;
  category: TemplateCategory;
  status: DeliveryStatus;
  errorCode: string | null;
  errorTitle: string | null;
  queuedAt: Date;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  failedAt: Date | null;
}

export interface DeliveryListQuery {
  status?: DeliveryStatus;
  campaignId?: string;
  phone?: string;
  limit: number;
  offset: number;
}

export interface LocationListItem {
  id: number;
  contactId: string;
  phone: string;
  name: string | null;
  lat: number;
  lng: number;
  source: string;
  confidence: string;
  precisionMeters: number;
  rawInput: string | null;
  resolvedUrl: string | null;
  confirmed: boolean;
  createdAt: Date;
}

export interface Campaign {
  id: string;
  name: string;
  templateName: string;
  templateLanguage: string;
  category: TemplateCategory;
  status: string;
  createdAt: Date;
}

export interface CampaignWithStats extends Campaign {
  stats: Record<string, number>;
}

export interface TrackingLink {
  id: string;
  contactId: string | null;
  label: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface TrackingLinkListItem extends TrackingLink {
  createdAt: Date;
  phone: string | null;
  name: string | null;
  pointCount: number;
  lastPoint: { lat: number; lng: number; at: Date } | null;
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
  list(query: ContactListQuery): Promise<{ items: ContactListItem[]; total: number }>;
  /** Alta masiva con opt-in: crea los que faltan y registra el consentimiento. */
  bulkOptIn(entries: ContactImportEntry[], source: string): Promise<number>;
}

export interface LocationsRepo {
  save(contactId: string, result: ExtractionSuccess, rawInput: string): Promise<number>;
  confirm(locationId: number): Promise<void>;
  latestFor(contactId: string): Promise<{ lat: number; lng: number } | null>;
  listRecent(query: { limit: number; offset: number; phone?: string }): Promise<LocationListItem[]>;
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
  listRecent(query: DeliveryListQuery): Promise<DeliveryListItem[]>;
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
  setTier(phoneNumberId: string, tier: string | null): Promise<void>;
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
  /** Sesiones vigentes: ni revocadas ni caducadas. */
  listActive(now: Date): Promise<TrackingLinkListItem[]>;
}

export interface CampaignsRepo {
  create(input: {
    name: string;
    templateName: string;
    templateLanguage: string;
    category: TemplateCategory;
  }): Promise<string>;
  setStatus(id: string, status: string): Promise<void>;
  get(id: string): Promise<Campaign | null>;
  list(): Promise<CampaignWithStats[]>;
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
  automation: AutomationRepo;
}

/** Deja solo digitos: "+52 1 55 1234 5678" y "5215512345678" son el mismo numero. */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D+/g, '');
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

interface NumberStateRow {
  phone_number_id: string;
  quality: NumberState['quality'];
  paused: boolean;
  paused_reason: string | null;
  warmup_started_on: Date;
  tier: string | null;
}

const toNumberState = (row: NumberStateRow): NumberState => ({
  phoneNumberId: row.phone_number_id,
  quality: row.quality,
  paused: row.paused,
  pausedReason: row.paused_reason,
  warmupStartedOn: row.warmup_started_on,
  tier: row.tier,
});

interface LinkRow {
  id: string;
  contact_id: string | null;
  label: string | null;
  expires_at: Date;
  revoked_at: Date | null;
}

const toLink = (row: LinkRow): TrackingLink => ({
  id: row.id,
  contactId: row.contact_id,
  label: row.label,
  expiresAt: row.expires_at,
  revokedAt: row.revoked_at,
});

interface CampaignRow {
  id: string;
  name: string;
  template_name: string;
  template_language: string;
  category: TemplateCategory;
  status: string;
  created_at: Date;
}

const toCampaign = (row: CampaignRow): Campaign => ({
  id: row.id,
  name: row.name,
  templateName: row.template_name,
  templateLanguage: row.template_language,
  category: row.category,
  status: row.status,
  createdAt: row.created_at,
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
    async list(query) {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (query.q?.trim()) {
        params.push(`%${query.q.trim()}%`);
        conditions.push(`(c.phone ilike $${params.length} or c.name ilike $${params.length})`);
      }
      switch (query.state ?? 'all') {
        case 'opted_in':
          conditions.push('c.opt_in_at is not null and c.opt_out_at is null');
          break;
        case 'opted_out':
          conditions.push('c.opt_out_at is not null');
          break;
        case 'pending':
          conditions.push('c.opt_in_at is null and c.opt_out_at is null');
          break;
        default:
          break;
      }
      const where = conditions.length ? `where ${conditions.join(' and ')}` : '';

      const total = await pool.query<{ total: number }>(
        `select count(*)::int as total from contacts c ${where}`,
        params,
      );

      const { rows } = await pool.query<
        ContactRow & {
          created_at: Date;
          loc_lat: number | null;
          loc_lng: number | null;
          loc_at: Date | null;
        }
      >(
        `select c.*, l.lat as loc_lat, l.lng as loc_lng, l.created_at as loc_at
           from contacts c
           left join lateral (
             select lat, lng, created_at from locations
              where contact_id = c.id order by created_at desc, id desc limit 1
           ) l on true
          ${where}
          order by coalesce(c.last_inbound_at, c.created_at) desc
          limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, query.limit, query.offset],
      );

      return {
        total: total.rows[0]?.total ?? 0,
        items: rows.map((row) => ({
          ...toContact(row),
          createdAt: row.created_at,
          lastLocation:
            row.loc_lat !== null && row.loc_lng !== null && row.loc_at
              ? { lat: row.loc_lat, lng: row.loc_lng, at: row.loc_at }
              : null,
        })),
      };
    },
    async bulkOptIn(entries, source) {
      const cleaned = new Map<string, string | null>();
      for (const entry of entries) {
        const phone = normalizePhone(entry.phone);
        if (phone.length < 6) continue;
        cleaned.set(phone, entry.name?.trim() || cleaned.get(phone) || null);
      }
      if (!cleaned.size) return 0;

      const phones = [...cleaned.keys()];
      const names = phones.map((p) => cleaned.get(p) ?? null);
      const { rowCount } = await pool.query(
        `insert into contacts (phone, name, opt_in_at, opt_in_source, opt_out_at)
         select p, n, now(), $3, null
           from unnest($1::text[], $2::text[]) as t(p, n)
         on conflict (phone) do update set
           name = coalesce(excluded.name, contacts.name),
           opt_in_at = now(),
           opt_in_source = excluded.opt_in_source,
           opt_out_at = null`,
        [phones, names, source],
      );
      return rowCount ?? phones.length;
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
        'select lat, lng from locations where contact_id = $1 order by created_at desc, id desc limit 1',
        [contactId],
      );
      return rows[0] ?? null;
    },
    async listRecent(query) {
      const params: unknown[] = [];
      let where = '';
      if (query.phone) {
        params.push(query.phone);
        where = `where c.phone = $${params.length}`;
      }
      const { rows } = await pool.query<{
        id: number;
        contact_id: string;
        phone: string;
        name: string | null;
        lat: number;
        lng: number;
        source: string;
        confidence: string;
        precision_meters: number;
        raw_input: string | null;
        resolved_url: string | null;
        confirmed: boolean;
        created_at: Date;
      }>(
        `select l.id, l.contact_id, c.phone, c.name, l.lat, l.lng, l.source, l.confidence,
                l.precision_meters, l.raw_input, l.resolved_url, l.confirmed, l.created_at
           from locations l
           join contacts c on c.id = l.contact_id
          ${where}
          order by l.created_at desc, l.id desc
          limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, query.limit, query.offset],
      );
      return rows.map((r) => ({
        id: r.id,
        contactId: r.contact_id,
        phone: r.phone,
        name: r.name,
        lat: r.lat,
        lng: r.lng,
        source: r.source,
        confidence: r.confidence,
        precisionMeters: r.precision_meters,
        rawInput: r.raw_input,
        resolvedUrl: r.resolved_url,
        confirmed: r.confirmed,
        createdAt: r.created_at,
      }));
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
    async listRecent(query) {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (query.status) {
        params.push(query.status);
        conditions.push(`d.status = $${params.length}`);
      }
      if (query.campaignId) {
        params.push(query.campaignId);
        conditions.push(`d.campaign_id = $${params.length}`);
      }
      if (query.phone) {
        params.push(query.phone);
        conditions.push(`c.phone = $${params.length}`);
      }
      const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
      const { rows } = await pool.query<{
        id: number;
        campaign_id: string | null;
        campaign_name: string | null;
        contact_id: string;
        phone: string;
        name: string | null;
        wamid: string | null;
        kind: string;
        template_name: string | null;
        category: TemplateCategory;
        status: DeliveryStatus;
        error_code: string | null;
        error_title: string | null;
        queued_at: Date;
        sent_at: Date | null;
        delivered_at: Date | null;
        read_at: Date | null;
        failed_at: Date | null;
      }>(
        `select d.id, d.campaign_id, k.name as campaign_name, d.contact_id, c.phone, c.name,
                d.wamid, d.kind, d.template_name, d.category, d.status, d.error_code,
                d.error_title, d.queued_at, d.sent_at, d.delivered_at, d.read_at, d.failed_at
           from deliveries d
           join contacts c on c.id = d.contact_id
           left join campaigns k on k.id = d.campaign_id
          ${where}
          order by d.queued_at desc, d.id desc
          limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, query.limit, query.offset],
      );
      return rows.map((r) => ({
        id: r.id,
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        contactId: r.contact_id,
        phone: r.phone,
        name: r.name,
        wamid: r.wamid,
        kind: r.kind,
        templateName: r.template_name,
        category: r.category,
        status: r.status,
        errorCode: r.error_code,
        errorTitle: r.error_title,
        queuedAt: r.queued_at,
        sentAt: r.sent_at,
        deliveredAt: r.delivered_at,
        readAt: r.read_at,
        failedAt: r.failed_at,
      }));
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
      const { rows } = await pool.query<NumberStateRow>(
        `insert into number_state (phone_number_id) values ($1)
         on conflict (phone_number_id) do update set updated_at = now()
         returning *`,
        [phoneNumberId],
      );
      return toNumberState(rows[0]!);
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
    async setTier(phoneNumberId, tier) {
      await pool.query(
        `insert into number_state (phone_number_id, tier) values ($1,$2)
         on conflict (phone_number_id) do update set tier = $2, updated_at = now()`,
        [phoneNumberId, tier],
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
      const { rows } = await pool.query<LinkRow>(
        `insert into tracking_links (contact_id, label, expires_at)
         values ($1,$2,$3) returning *`,
        [contactId, label, expiresAt],
      );
      return toLink(rows[0]!);
    },
    async getLink(id) {
      const { rows } = await pool.query<LinkRow>('select * from tracking_links where id = $1', [id]);
      return rows[0] ? toLink(rows[0]) : null;
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
        // El desempate por id importa: dos posiciones seguidas pueden caer en
        // el mismo instante y sin el la polilinea del mapa se dibuja al reves.
        `select lat, lng, accuracy, heading, speed, recorded_at as "recordedAt"
           from track_points where link_id = $1
          order by recorded_at desc, id desc limit $2`,
        [linkId, limit],
      );
      return rows.reverse();
    },
    async listActive(now) {
      const { rows } = await pool.query<
        LinkRow & {
          created_at: Date;
          phone: string | null;
          name: string | null;
          point_count: number;
          last_lat: number | null;
          last_lng: number | null;
          last_at: Date | null;
        }
      >(
        `select t.*, c.phone, c.name,
                (select count(*)::int from track_points p where p.link_id = t.id) as point_count,
                lp.lat as last_lat, lp.lng as last_lng, lp.recorded_at as last_at
           from tracking_links t
           left join contacts c on c.id = t.contact_id
           left join lateral (
             select lat, lng, recorded_at from track_points
              where link_id = t.id order by recorded_at desc, id desc limit 1
           ) lp on true
          where t.revoked_at is null and t.expires_at > $1
          order by t.created_at desc`,
        [now],
      );
      return rows.map((row) => ({
        ...toLink(row),
        createdAt: row.created_at,
        phone: row.phone,
        name: row.name,
        pointCount: row.point_count,
        lastPoint:
          row.last_lat !== null && row.last_lng !== null && row.last_at
            ? { lat: row.last_lat, lng: row.last_lng, at: row.last_at }
            : null,
      }));
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
    async get(id) {
      const { rows } = await pool.query<CampaignRow>('select * from campaigns where id = $1', [id]);
      return rows[0] ? toCampaign(rows[0]) : null;
    },
    async list() {
      const { rows } = await pool.query<CampaignRow & { stats: Record<string, number> | null }>(
        `select k.*,
                (select jsonb_object_agg(s.status, s.count)
                   from (select status, count(*)::int as count
                           from deliveries where campaign_id = k.id group by status) s) as stats
           from campaigns k
          order by k.created_at desc`,
      );
      return rows.map((row) => ({ ...toCampaign(row), stats: row.stats ?? {} }));
    },
  };

  return {
    contacts,
    locations,
    deliveries,
    templates,
    numberState,
    counters,
    tracking,
    campaigns,
    automation: createAutomationRepo(pool),
  };
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
