/** Dobles en memoria: permiten probar gates, sender y webhook sin Postgres. */

/**
 * Reloj de los dobles. Por defecto el real; las pruebas que mueven el tiempo
 * (monitor de salud, goteo) lo fijan con `setFakeClock` para que las fechas
 * que escriben los dobles (sent_at, opt_in_at...) vivan en el mismo tiempo
 * que el resto de la prueba.
 */
let fakeClock: (() => Date) | null = null;
export function setFakeClock(clock: (() => Date) | null): void {
  fakeClock = clock;
}
export const fakeNow = (): Date => (fakeClock ? fakeClock() : new Date());

import type {
  Campaign,
  CampaignRecipient,
  Contact,
  ContactListItem,
  DeliveryListItem,
  DeliveryStatus,
  LocationListItem,
  Repos,
  ResumenEntregas,
  SaludEvento,
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
import { createFakeLeads } from './fakes-leads.js';
import { createFakeArchives, type FakeArchives } from './fakes-archives.js';
import { createFakeRutas, type FakeRutas } from './fakes-rutas.js';
import type { Usuario, UsuarioConClave, UsuariosRepo } from '../src/auth/usuarios.js';
import type { ClaveApi, ClavesApiRepo } from '../src/auth/claves-api.js';
import { hashClaveApi, prefijoDeClave } from '../src/auth/claves-api.js';
import { AJUSTES_GENERALES_VACIOS, fusionarAjustes, type AjustesGenerales, type AjustesGeneralesRepo } from '../src/ajustes/generales.js';
import type { ActividadRepo, EntradaActividad } from '../src/auth/actividad.js';

export interface FakeRepos extends Repos {
  automation: FakeAutomation;
  messages: FakeMessages;
  archives: FakeArchives;
  rutas: FakeRutas;
  _contacts: Map<string, Contact>;
  _deliveries: Array<Record<string, unknown>>;
  _locations: Array<Record<string, unknown>>;
  _templates: Map<string, Template>;
  _points: Map<string, TrackPoint[]>;
  _campaigns: Map<string, Campaign>;
  _links: Map<string, TrackingLink>;
  _recipients: CampaignRecipient[];
  _salud: SaludEvento[];
  _usuarios: UsuarioConClave[];
  _claves: Array<ClaveApi & { hash: string }>;
  _ajustesGenerales: { valor: AjustesGenerales };
  _actividad: EntradaActividad[];
}

/**
 * La clave de API con la que las pruebas entran como "un programa" (lo que
 * hara el sistema de GSG). createFakeRepos la deja creada.
 */
export const CLAVE_API_PRUEBA = 'wak_pruebasDeIntegracion0123456789abcdefXYZ';

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
  const recipients: CampaignRecipient[] = [];
  const saludEventos: SaludEvento[] = [];
  const usuariosMem: UsuarioConClave[] = [];
  const sinClave = (u: UsuarioConClave): Usuario => {
    const { clave: _clave, ...resto } = u;
    return resto;
  };
  const usuarios: UsuariosRepo = {
    async contar() {
      return usuariosMem.length;
    },
    async porUsuario(usuario) {
      return usuariosMem.find((u) => u.usuario === usuario.trim().toLowerCase()) ?? null;
    },
    async porId(id) {
      const u = usuariosMem.find((x) => x.id === id);
      return u ? sinClave(u) : null;
    },
    async crear(input) {
      const u: UsuarioConClave = {
        id: `u${seq++}`,
        usuario: input.usuario.trim().toLowerCase(),
        nombre: input.nombre.trim(),
        clave: input.clave,
        rol: input.rol,
        activo: true,
        sesionVersion: 1,
        ultimoLoginAt: null,
        createdAt: fakeNow(),
      };
      usuariosMem.push(u);
      return sinClave(u);
    },
    async listar() {
      return usuariosMem.map(sinClave);
    },
    async cambiarClave(id, clave) {
      const u = usuariosMem.find((x) => x.id === id);
      if (u) {
        u.clave = clave;
        u.sesionVersion++;
      }
    },
    async setActivo(id, activo) {
      const u = usuariosMem.find((x) => x.id === id);
      if (u) {
        u.activo = activo;
        if (!activo) u.sesionVersion++;
      }
    },
    async setRol(id, rol) {
      const u = usuariosMem.find((x) => x.id === id);
      if (u) u.rol = rol;
    },
    async tocarLogin(id, at) {
      const u = usuariosMem.find((x) => x.id === id);
      if (u) u.ultimoLoginAt = at;
    },
  };

  const actividadMem: EntradaActividad[] = [];
  const actividad: ActividadRepo = {
    async anotar(e) {
      actividadMem.push({ id: actividadMem.length + 1, at: e.at ?? new Date(), usuarioId: e.usuarioId, usuario: e.usuario, accion: e.accion, detalle: e.detalle, ip: e.ip });
    },
    async listar(query) {
      let items = [...actividadMem].reverse();
      if (query.accion) items = items.filter((x) => x.accion === query.accion);
      if (query.usuario) items = items.filter((x) => x.usuario.toLowerCase().includes(query.usuario!.toLowerCase()));
      return { total: items.length, items: items.slice(query.offset, query.offset + query.limit) };
    },
    async acciones() {
      return [...new Set(actividadMem.map((x) => x.accion))].sort();
    },
  };
  const ajustesGeneralesMem = { valor: AJUSTES_GENERALES_VACIOS };
  const ajustesGenerales: AjustesGeneralesRepo = {
    async get() {
      return ajustesGeneralesMem.valor;
    },
    async set(patch) {
      ajustesGeneralesMem.valor = fusionarAjustes(ajustesGeneralesMem.valor, patch);
      return ajustesGeneralesMem.valor;
    },
    async reset() {
      ajustesGeneralesMem.valor = AJUSTES_GENERALES_VACIOS;
    },
  };
  const clavesMem: Array<ClaveApi & { hash: string }> = [
    {
      id: 'clave-prueba',
      nombre: 'Pruebas',
      prefijo: prefijoDeClave(CLAVE_API_PRUEBA),
      hash: hashClaveApi(CLAVE_API_PRUEBA),
      creadaPor: null,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      ultimoUsoAt: null,
      revocadaAt: null,
    },
  ];
  const sinHash = (c: ClaveApi & { hash: string }): ClaveApi => {
    const { hash: _hash, ...resto } = c;
    return resto;
  };
  const claves: ClavesApiRepo = {
    async crear(input) {
      const c = { id: `clave-${seq++}`, nombre: input.nombre, prefijo: input.prefijo, hash: input.hash, creadaPor: input.creadaPor, createdAt: new Date(), ultimoUsoAt: null, revocadaAt: null };
      clavesMem.push(c);
      return sinHash(c);
    },
    async listar() {
      return [...clavesMem].reverse().map(sinHash);
    },
    async porHash(hash) {
      const c = clavesMem.find((x) => x.hash === hash && !x.revocadaAt);
      return c ? sinHash(c) : null;
    },
    async revocar(id) {
      const c = clavesMem.find((x) => x.id === id && !x.revocadaAt);
      if (!c) return false;
      c.revocadaAt = new Date();
      return true;
    },
    async tocarUso(id, at) {
      const c = clavesMem.find((x) => x.id === id);
      if (c) c.ultimoUsoAt = at;
    },
  };

  let numberState: NumberState = {
    phoneNumberId: 'PNID',
    quality: 'GREEN',
    paused: false,
    pausedReason: null,
    warmupStartedOn: new Date('2020-01-01T00:00:00Z'),
    tier: null,
    estado: 'CONNECTED',
    riesgo: 0,
    nivel: 'verde',
    factor: 1,
    motivos: null,
    pausadaHasta: null,
    rampaDesde: null,
    limite24h: null,
    ultimaEvaluacion: null,
    ...overrides,
  };

  /** Mismo resumen que el SQL, sobre las filas en memoria. */
  const resumir = (rows: Array<Record<string, unknown>>): ResumenEntregas => {
    const salidos = rows.filter((d) => ['sent', 'delivered', 'read', 'failed'].includes(String(d.status)));
    const porCodigo: Record<string, number> = {};
    for (const d of salidos) {
      if (d.status === 'failed' && d.errorCode) {
        porCodigo[String(d.errorCode)] = (porCodigo[String(d.errorCode)] ?? 0) + 1;
      }
    }
    return {
      enviados: salidos.length,
      entregados: salidos.filter((d) => d.status === 'delivered' || d.status === 'read').length,
      leidos: salidos.filter((d) => d.status === 'read').length,
      fallidos: salidos.filter((d) => d.status === 'failed').length,
      porCodigo,
      destinatariosUnicos: new Set(
        salidos
          .filter((d) => d.businessInitiated && d.status !== 'failed')
          .map((d) => String(d.contactId)),
      ).size,
    };
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
    _recipients: recipients,
    _salud: saludEventos,
    _usuarios: usuariosMem,
    usuarios,
    _claves: clavesMem,
    claves,
    _ajustesGenerales: ajustesGeneralesMem,
    ajustesGenerales,
    _actividad: actividadMem,
    actividad,
    automation: createFakeAutomation(contactById),
    messages: createFakeMessages(() => [...contactsByPhone.values()]),
    archives: createFakeArchives(),
    rutas: createFakeRutas(),
    leads: createFakeLeads((id) => {
      const contacto = contactById(id);
      return contacto ? { phone: contacto.phone, name: contacto.name } : undefined;
    }),

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
          suprimidoHasta: null,
          suprimidoMotivo: null,
          suprimidoAmbito: null,
          sinRespuestaSeguidas: 0,
          ultimoEnvioAt: null,
          primerEnvioAt: null,
          enviosIniciados: 0,
          createdAt: fakeNow(),
        };
        contactsByPhone.set(phone, contact);
        return contact;
      },
      async setOptIn(phone, source) {
        const c = await repos.contacts.upsertFromInbound(phone);
        c.optInAt = fakeNow();
        c.optInSource = source;
        c.optOutAt = null;
      },
      async setOptOut(phone) {
        const c = await repos.contacts.upsertFromInbound(phone);
        c.optOutAt = fakeNow();
      },
      async touchInbound(phone, at) {
        const c = await repos.contacts.upsertFromInbound(phone);
        c.lastInboundAt = at;
        c.sinRespuestaSeguidas = 0;
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
          c.optInAt = fakeNow();
          c.optInSource = source;
          c.optOutAt = null;
          count++;
        }
        return count;
      },
      async suprimir(phone, hasta, motivo, ambito) {
        const c = contactsByPhone.get(phone);
        if (!c) return;
        c.suprimidoHasta = hasta;
        c.suprimidoMotivo = motivo;
        c.suprimidoAmbito = ambito;
      },
      async levantarSupresion(phone) {
        const c = contactsByPhone.get(phone);
        if (!c) return;
        c.suprimidoHasta = null;
        c.suprimidoMotivo = null;
        c.suprimidoAmbito = null;
      },
      async anotarEnvioIniciado(contactId, at) {
        const c = contactById(contactId);
        if (!c) return;
        c.ultimoEnvioAt = at;
        c.primerEnvioAt = c.primerEnvioAt ?? at;
        c.enviosIniciados = (c.enviosIniciados ?? 0) + 1;
        c.sinRespuestaSeguidas = (c.sinRespuestaSeguidas ?? 0) + 1;
      },
      async contarNuevosEscritosDesde(since) {
        return [...contactsByPhone.values()].filter((c) => c.primerEnvioAt && c.primerEnvioAt >= since).length;
      },
      async contarSuprimidos(now) {
        return [...contactsByPhone.values()].filter((c) => c.suprimidoHasta && c.suprimidoHasta > now).length;
      },
      async contarBajasDesde(since) {
        return [...contactsByPhone.values()].filter((c) => c.optOutAt && c.optOutAt >= since).length;
      },
    },

    locations: {
      async save(contactId, result, rawInput) {
        const id = seq++;
        locations.push({ id, contactId, ...result, rawInput, confirmed: false, createdAt: fakeNow() });
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
        deliveries.push({ id, status: 'queued', queuedAt: fakeNow(), ...input });
        return id;
      },
      async markSent(id, wamid) {
        const row = deliveries.find((d) => d.id === id);
        if (row) Object.assign(row, { status: 'sent', wamid, sentAt: fakeNow() });
      },
      async markBlocked(id, reason) {
        const row = deliveries.find((d) => d.id === id);
        if (row) Object.assign(row, { status: 'blocked_by_gate', reason, errorTitle: reason, failedAt: fakeNow() });
      },
      async markFailed(id, code, title) {
        const row = deliveries.find((d) => d.id === id);
        if (row) {
          Object.assign(row, {
            status: 'failed',
            errorCode: code,
            errorTitle: title,
            sentAt: (row.sentAt as Date | undefined) ?? fakeNow(),
            failedAt: fakeNow(),
          });
        }
      },
      async updateByWamid(wamid, status, error) {
        const row = deliveries.find((d) => d.wamid === wamid);
        if (!row) return;
        const rango = (s: unknown) => ({ read: 3, delivered: 2, sent: 1 })[String(s)] ?? 0;
        const nuevo = status === 'failed' || rango(status) > rango(row.status) ? status : row.status;
        Object.assign(row, {
          status: nuevo,
          error,
          errorCode: error?.code ?? row.errorCode ?? null,
          errorTitle: error?.title ?? row.errorTitle ?? null,
          sentAt: row.sentAt ?? fakeNow(),
        });
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
      async resumenDesde(since) {
        return resumir(deliveries.filter((d) => d.sentAt && (d.sentAt as Date) >= since));
      },
      async resumenUltimos(n, desde) {
        const salidos = deliveries.filter((d) => d.sentAt && (!desde || (d.sentAt as Date) >= desde));
        return resumir(salidos.slice(-n));
      },
      async contarCampanaDesde(campaignId, since) {
        return deliveries.filter(
          (d) => d.campaignId === campaignId && d.sentAt && (d.sentAt as Date) >= since &&
            ['sent', 'delivered', 'read', 'failed'].includes(String(d.status)),
        ).length;
      },
      async ultimoIniciadoAt() {
        const rows = deliveries.filter((d) => d.businessInitiated && d.sentAt);
        if (!rows.length) return null;
        return rows.reduce<Date>((max, d) => ((d.sentAt as Date) > max ? (d.sentAt as Date) : max), rows[0]!.sentAt as Date);
      },
      async contarIniciadosAContactoDesde(contactId, since) {
        return deliveries.filter(
          (d) => d.contactId === contactId && d.businessInitiated && d.sentAt && (d.sentAt as Date) >= since &&
            ['sent', 'delivered', 'read', 'failed'].includes(String(d.status)),
        ).length;
      },
      async ultimoEnvioA(contactId) {
        const rows = deliveries.filter(
          (d) => d.contactId === contactId && d.sentAt && ['sent', 'delivered', 'read'].includes(String(d.status)),
        );
        if (!rows.length) return null;
        return rows.reduce<Date>((max, d) => ((d.sentAt as Date) > max ? (d.sentAt as Date) : max), rows[0]!.sentAt as Date);
      },
      async contarIniciadosDesde(since) {
        return deliveries.filter(
          (d) => d.businessInitiated && d.sentAt && (d.sentAt as Date) >= since &&
            ['sent', 'delivered', 'read', 'failed'].includes(String(d.status)),
        ).length;
      },
      async contarPlantillaDesde(templateName, since) {
        return deliveries.filter(
          (d) => d.templateName === templateName && d.sentAt && (d.sentAt as Date) >= since &&
            ['sent', 'delivered', 'read'].includes(String(d.status)),
        ).length;
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
        const previa = templates.get(`${t.name}/${t.language}`);
        templates.set(`${t.name}/${t.language}`, {
          ...t,
          propia: Boolean(previa?.propia || t.propia),
          aprobadaAt: t.status === 'APPROVED' ? (previa?.aprobadaAt ?? t.aprobadaAt ?? fakeNow()) : (previa?.aprobadaAt ?? t.aprobadaAt ?? null),
        });
      },
      async setStatus(name, language, status, motivo) {
        const t = templates.get(`${name}/${language}`);
        if (!t) return;
        t.status = status;
        if (motivo) t.motivo = motivo;
        if (status === 'APPROVED') {
          t.pausadaHasta = null;
          t.aprobadaAt = t.aprobadaAt ?? fakeNow();
        }
      },
      async setQuality(name, language, quality) {
        const t = templates.get(`${name}/${language}`);
        if (t) t.quality = quality;
      },
      async marcarPausa(name, language, hasta, pausas, motivo) {
        const t = templates.get(`${name}/${language}`);
        if (!t) return;
        t.pausadaHasta = hasta;
        t.pausas = pausas;
        t.motivo = motivo;
      },
      async remove(name, language) {
        const t = templates.get(`${name}/${language}`);
        if (!t?.propia) return false;
        templates.delete(`${name}/${language}`);
        return true;
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
      async setEstado(_id, estado) {
        numberState = { ...numberState, estado };
      },
      async setRiesgo(_id, patch) {
        numberState = { ...numberState, ...patch };
      },
      async setLimite24h(_id, limite) {
        numberState = { ...numberState, limite24h: limite };
      },
      async reiniciarWarmup(_id, day) {
        numberState = { ...numberState, warmupStartedOn: day };
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
        const link = { id: `l${seq++}`, contactId, label, expiresAt, revokedAt: null, createdAt: fakeNow() };
        links.set(link.id, link);
        return link;
      },
      async getLink(id) {
        return links.get(id) ?? null;
      },
      async revoke(id) {
        const link = links.get(id);
        if (link) link.revokedAt = fakeNow();
      },
      async addPoint(linkId, point) {
        const list = points.get(linkId) ?? [];
        list.push({ ...point, recordedAt: point.recordedAt ?? fakeNow() });
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
              lastPoint: last ? { lat: last.lat, lng: last.lng, at: last.recordedAt ?? fakeNow() } : null,
            };
          });
      },
    },

    campaigns: {
      async create(input) {
        const id = `camp${seq++}`;
        campaigns.set(id, {
          id,
          name: input.name,
          templateName: input.templateName,
          templateLanguage: input.templateLanguage,
          category: input.category,
          status: 'draft',
          createdAt: fakeNow(),
          ritmoPorHora: input.ritmoPorHora ?? null,
          canario: input.canario ?? 0,
          canarioEsperaMin: input.canarioEsperaMin ?? 60,
          canarioEnviadoAt: null,
          motivoPausa: null,
          startedAt: null,
          finishedAt: null,
        });
        return id;
      },
      async setStatus(id, status, motivo) {
        const c = campaigns.get(id);
        if (!c) return;
        c.status = status;
        c.motivoPausa = motivo ?? null;
        if ((status === 'running' || status === 'canary') && !c.startedAt) c.startedAt = fakeNow();
        if (status === 'finished' || status === 'stopped' || status === 'empty') c.finishedAt = c.finishedAt ?? fakeNow();
      },
      async agregarDestinatarios(campaignId, entries) {
        let added = 0;
        for (const e of entries) {
          if (recipients.some((r) => r.campaignId === campaignId && r.phone === e.phone)) continue;
          recipients.push({
            id: seq++,
            campaignId,
            phone: e.phone,
            variables: e.variables ?? [],
            estado: 'pendiente',
            orden: e.orden,
            canario: e.canario,
            deliveryId: null,
            detalle: null,
            posponerHasta: null,
            intentos: 0,
            enviadoAt: null,
          });
          added++;
        }
        return added;
      },
      async siguientesPendientes(campaignId, limit, soloCanario = false, ahora = fakeNow()) {
        return recipients
          .filter(
            (r) =>
              r.campaignId === campaignId &&
              r.estado === 'pendiente' &&
              (!soloCanario || r.canario) &&
              (!r.posponerHasta || r.posponerHasta <= ahora),
          )
          .sort((a, b) => Number(b.canario) - Number(a.canario) || a.orden - b.orden || a.id - b.id)
          .slice(0, limit);
      },
      async posponerDestinatario(id, hasta, detalle) {
        const r = recipients.find((x) => x.id === id);
        if (!r) return;
        r.posponerHasta = hasta;
        r.detalle = detalle;
        r.intentos++;
      },
      async contarPendientes(campaignId) {
        return recipients.filter((r) => r.campaignId === campaignId && r.estado === 'pendiente').length;
      },
      async marcarDestinatario(id, estado, detalle, deliveryId, at) {
        const r = recipients.find((x) => x.id === id);
        if (!r) return;
        r.estado = estado;
        r.detalle = detalle;
        r.deliveryId = deliveryId;
        if (estado === 'enviado') r.enviadoAt = at ?? fakeNow();
      },
      async cifrasDestinatarios(campaignId) {
        const cifras: Record<string, number> = {};
        for (const r of recipients.filter((x) => x.campaignId === campaignId)) {
          cifras[r.estado] = (cifras[r.estado] ?? 0) + 1;
        }
        return cifras;
      },
      async cancelarPendientes(campaignId, motivo) {
        let n = 0;
        for (const r of recipients) {
          if (r.campaignId !== campaignId || r.estado !== 'pendiente') continue;
          r.estado = 'cancelado';
          r.detalle = motivo;
          n++;
        }
        return n;
      },
      async listarActivas() {
        return [...campaigns.values()].filter((c) => ['running', 'canary', 'paused'].includes(c.status));
      },
      async setCanarioEnviado(id, at) {
        const c = campaigns.get(id);
        if (c) c.canarioEnviadoAt = at;
      },
      async resumenCanario(campaignId) {
        const ids = new Set(
          recipients.filter((r) => r.campaignId === campaignId && r.canario && r.deliveryId).map((r) => r.deliveryId),
        );
        return resumir(deliveries.filter((d) => ids.has(d.id as number)));
      },
      async get(id) {
        return campaigns.get(id) ?? null;
      },
      async list() {
        const all = [...campaigns.values()].sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        );
        return Promise.all(
          all.map(async (c) => ({
            ...c,
            stats: await repos.deliveries.campaignStats(c.id),
            destinatarios: await repos.campaigns.cifrasDestinatarios(c.id),
          })),
        );
      },
    },

    salud: {
      async registrar(evento) {
        const id = seq++;
        saludEventos.push({
          id,
          phoneNumberId: evento.phoneNumberId ?? '',
          at: evento.at ?? fakeNow(),
          tipo: evento.tipo,
          codigo: evento.codigo ?? null,
          detalle: evento.detalle ?? null,
          contactId: evento.contactId ?? null,
          campaignId: evento.campaignId ?? null,
          payload: evento.payload ?? null,
        });
        return id;
      },
      async contar(since, tipo, codigo) {
        return saludEventos.filter(
          (e) => e.at >= since && (!tipo || e.tipo === tipo) && (!codigo || e.codigo === codigo),
        ).length;
      },
      async resumen(since) {
        const out: Record<string, number> = {};
        for (const e of saludEventos.filter((x) => x.at >= since)) {
          const key = `${e.tipo}:${e.codigo ?? ''}`;
          out[key] = (out[key] ?? 0) + 1;
        }
        return out;
      },
      async ultimos(limit) {
        return [...saludEventos].sort((a, b) => b.at.getTime() - a.at.getTime() || b.id - a.id).slice(0, limit);
      },
      async purgar(before) {
        const antes = saludEventos.length;
        for (let i = saludEventos.length - 1; i >= 0; i--) {
          if (saludEventos[i]!.at < before) saludEventos.splice(i, 1);
        }
        return antes - saludEventos.length;
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
    language: 'es',
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
