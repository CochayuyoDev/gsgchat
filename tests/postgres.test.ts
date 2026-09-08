/**
 * Pruebas de la capa de datos contra Postgres de verdad.
 *
 * Los dobles en memoria comprueban la logica, pero no el SQL: un lateral
 * join mal escrito, un `unnest` con los tipos cambiados o un `jsonb_object_agg`
 * sobre cero filas solo fallan cuando hay un motor detras. PGlite es el mismo
 * Postgres compilado a WebAssembly, asi que estas pruebas corren en cualquier
 * maquina sin Docker y sin servidor.
 *
 * Se aplican las migraciones reales del directorio db/migrations.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from '../src/db/pool.js';
import { createRepos, createSettingsRepo, type Repos } from '../src/db/repos.js';
import { createSettingsService } from '../src/settings/service.js';
import { loadConfig } from '../src/config.js';
import { TEST_SETTINGS_KEY } from './fakes.js';

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');

/**
 * Adaptador de PGlite a la interfaz de `pg.Pool` que usan los repositorios.
 * Solo se usan `query`, `connect` y `end`.
 */
function asPool(db: PGlite): Pool {
  const query = async (text: string, params?: unknown[]) => {
    const result = await db.query(text, params as never[], {
      // pg entrega bigint/numeric como string para no perder precision, y
      // src/db/pool.ts los convierte a number. Aqui se hace lo mismo para
      // que los repositorios vean exactamente los mismos tipos.
      parsers: { 20: (v: string) => Number.parseInt(v, 10) },
    });
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  };
  const client = { query, release: () => undefined };
  return {
    query,
    connect: async () => client,
    end: async () => db.close(),
  } as unknown as Pool;
}

let db: PGlite;
let pool: Pool;
let repos: Repos;

beforeAll(async () => {
  db = new PGlite();
  pool = asPool(db);

  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    await db.exec(await readFile(path.join(MIGRATIONS, file), 'utf8'));
  }
  repos = createRepos(pool);
});

afterAll(async () => {
  await db.close();
});

describe('migraciones', () => {
  it('crean todas las tablas del sistema', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    const tables = rows.map((r) => r.table_name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'auto_replies',
        'campaigns',
        'contacts',
        'deliveries',
        'enrollments',
        'locations',
        'number_state',
        'scheduled_messages',
        'send_counters',
        'sequence_steps',
        'sequences',
        'settings',
        'templates',
        'track_points',
        'tracking_links',
      ]),
    );
  });
});

describe('contactos sobre Postgres', () => {
  it('el alta masiva inserta, actualiza y no duplica', async () => {
    const first = await repos.contacts.bulkOptIn(
      [
        { phone: '+52 1 55 1000 0001', name: 'Ana' },
        { phone: '5215510000002', name: 'Luis' },
        { phone: '123', name: 'muy corto' },
        // Repetido en la misma tanda: unnest con dos veces la misma clave
        // reventaria el on conflict si no se deduplicase antes.
        { phone: '5215510000002', name: 'Luis otra vez' },
      ],
      'formulario web',
    );
    expect(first).toBe(2);

    const ana = await repos.contacts.getByPhone('5215510000001');
    expect(ana).toMatchObject({ name: 'Ana', optInSource: 'formulario web' });
    expect(ana?.optInAt).toBeInstanceOf(Date);

    // Segunda pasada sobre uno que ya existe y estaba dado de baja: el alta
    // vuelve a abrir y conserva el nombre si el nuevo viene vacio.
    await repos.contacts.setOptOut('5215510000001');
    await repos.contacts.bulkOptIn([{ phone: '5215510000001' }], 'evento');
    const again = await repos.contacts.getByPhone('5215510000001');
    expect(again).toMatchObject({ name: 'Ana', optInSource: 'evento', optOutAt: null });
  });

  it('lista con su ultima ubicacion, busca y filtra', async () => {
    const contact = (await repos.contacts.getByPhone('5215510000001'))!;
    await repos.locations.save(
      contact.id,
      {
        ok: true,
        lat: 19.4326,
        lng: -99.1332,
        source: 'query_param',
        confidence: 'high',
        precisionMeters: 11,
        mapsUrl: 'https://maps',
        warnings: [],
        needsConfirmation: false,
      },
      'https://maps.google.com/?q=19.4326,-99.1332',
    );
    await repos.locations.save(
      contact.id,
      {
        ok: true,
        lat: 19.5,
        lng: -99.2,
        source: 'bare_text',
        confidence: 'medium',
        precisionMeters: 20,
        mapsUrl: 'https://maps',
        warnings: [],
        needsConfirmation: false,
      },
      '19.5, -99.2',
    );

    const all = await repos.contacts.list({ limit: 50, offset: 0 });
    expect(all.total).toBe(2);
    const listed = all.items.find((c) => c.phone === '5215510000001');
    // El lateral join debe traer la MAS reciente, no la primera.
    expect(listed?.lastLocation).toMatchObject({ lat: 19.5, lng: -99.2 });

    const search = await repos.contacts.list({ q: 'luis', limit: 50, offset: 0 });
    expect(search.items.map((c) => c.phone)).toEqual(['5215510000002']);

    await repos.contacts.upsertFromInbound('5215510000009', 'Sin consentimiento');
    const pending = await repos.contacts.list({ state: 'pending', limit: 50, offset: 0 });
    expect(pending.items.map((c) => c.phone)).toEqual(['5215510000009']);

    await repos.contacts.setOptOut('5215510000009');
    const out = await repos.contacts.list({ state: 'opted_out', limit: 50, offset: 0 });
    expect(out.total).toBe(1);

    // La busqueda y el filtro se combinan sin romper la numeracion de $n.
    const combined = await repos.contacts.list({ q: '5215510000002', state: 'opted_in', limit: 50, offset: 0 });
    expect(combined.total).toBe(1);
  });

  it('lista las ubicaciones recientes con su contacto', async () => {
    const recent = await repos.locations.listRecent({ limit: 10, offset: 0 });
    expect(recent[0]).toMatchObject({ phone: '5215510000001', source: 'bare_text', confirmed: false });

    await repos.locations.confirm(recent[0]!.id);
    const filtered = await repos.locations.listRecent({ limit: 10, offset: 0, phone: '5215510000002' });
    expect(filtered).toHaveLength(0);
  });
});

describe('entregas y campanas sobre Postgres', () => {
  it('el conteo por estado y el listado con joins funcionan, incluso sin entregas', async () => {
    const empty = await repos.campaigns.list();
    expect(empty).toEqual([]);

    const campaignId = await repos.campaigns.create({
      name: 'Marzo',
      templateName: 'recordatorio_cita',
      templateLanguage: 'es_MX',
      category: 'UTILITY',
    });

    // jsonb_object_agg sobre cero filas devuelve null: el repositorio debe
    // traducirlo a un objeto vacio y no a null.
    const noDeliveries = await repos.campaigns.list();
    expect(noDeliveries[0]).toMatchObject({ id: campaignId, name: 'Marzo', stats: {} });

    const contact = (await repos.contacts.getByPhone('5215510000001'))!;
    const sent = await repos.deliveries.create({
      contactId: contact.id,
      campaignId,
      kind: 'template',
      templateName: 'recordatorio_cita',
      category: 'UTILITY',
      variables: ['Ana', 'lunes', '10:00'],
    });
    await repos.deliveries.markSent(sent, 'wamid.1');
    const blocked = await repos.deliveries.create({
      contactId: contact.id,
      campaignId,
      kind: 'template',
      category: 'MARKETING',
    });
    await repos.deliveries.markBlocked(blocked, 'no_opt_in: el contacto no tiene opt-in');

    const withStats = await repos.campaigns.list();
    expect(withStats[0]!.stats).toEqual({ sent: 1, blocked_by_gate: 1 });
    expect(await repos.deliveries.campaignStats(campaignId)).toEqual({ sent: 1, blocked_by_gate: 1 });

    const listed = await repos.deliveries.listRecent({ limit: 10, offset: 0 });
    expect(listed[0]).toMatchObject({ campaignName: 'Marzo', phone: '5215510000001' });

    const onlyBlocked = await repos.deliveries.listRecent({ status: 'blocked_by_gate', limit: 10, offset: 0 });
    expect(onlyBlocked).toHaveLength(1);
    expect(onlyBlocked[0]!.errorTitle).toContain('no_opt_in');

    const byPhoneAndCampaign = await repos.deliveries.listRecent({
      phone: '5215510000001',
      campaignId,
      status: 'sent',
      limit: 10,
      offset: 0,
    });
    expect(byPhoneAndCampaign).toHaveLength(1);

    // El webhook actualiza por wamid.
    await repos.deliveries.updateByWamid('wamid.1', 'read');
    const read = await repos.deliveries.listRecent({ status: 'read', limit: 10, offset: 0 });
    expect(read[0]!.readAt).toBeInstanceOf(Date);
  });

  it('los contadores diarios y el estado del numero se mantienen', async () => {
    const day = new Date('2026-03-10T12:00:00Z');
    expect(await repos.counters.increment('PNID', 'UTILITY', day)).toBe(1);
    expect(await repos.counters.increment('PNID', 'UTILITY', day)).toBe(2);
    expect(await repos.counters.increment('PNID', 'MARKETING', day)).toBe(1);
    // La suma cruza categorias pero no dias.
    expect(await repos.counters.totalForDay('PNID', day)).toBe(3);
    expect(await repos.counters.totalForDay('PNID', new Date('2026-03-11T12:00:00Z'))).toBe(0);

    const fresh = await repos.numberState.get('PNID');
    expect(fresh).toMatchObject({ quality: 'GREEN', paused: false, tier: null });
    expect(fresh.warmupStartedOn).toBeInstanceOf(Date);

    await repos.numberState.setQuality('PNID', 'YELLOW');
    await repos.numberState.setTier('PNID', 'TIER_1K');
    await repos.numberState.setPaused('PNID', true, 'prueba');
    expect(await repos.numberState.get('PNID')).toMatchObject({
      quality: 'YELLOW',
      tier: 'TIER_1K',
      paused: true,
      pausedReason: 'prueba',
    });
  });
});

describe('rastreo sobre Postgres', () => {
  it('lista solo las sesiones vigentes con su ultimo punto', async () => {
    const contact = (await repos.contacts.getByPhone('5215510000001'))!;
    const now = new Date();
    const live = await repos.tracking.createLink(contact.id, 'Vigente', new Date(now.getTime() + 3_600_000));
    const expired = await repos.tracking.createLink(null, 'Caducada', new Date(now.getTime() - 1000));
    const revoked = await repos.tracking.createLink(null, 'Revocada', new Date(now.getTime() + 3_600_000));
    await repos.tracking.revoke(revoked.id);

    await repos.tracking.addPoint(live.id, { lat: 19.4, lng: -99.1, accuracy: 10 });
    await repos.tracking.addPoint(live.id, { lat: 19.41, lng: -99.11 });

    const active = await repos.tracking.listActive(now);
    expect(active.map((l) => l.label)).toEqual(['Vigente']);
    expect(active[0]).toMatchObject({ phone: '5215510000001', pointCount: 2 });
    expect(active[0]!.lastPoint).toMatchObject({ lat: 19.41, lng: -99.11 });

    // listPoints devuelve en orden cronologico aunque consulte al reves.
    const points = await repos.tracking.listPoints(live.id);
    expect(points.map((p) => p.lat)).toEqual([19.4, 19.41]);
    void expired;
  });
});

describe('automatizacion sobre Postgres', () => {
  it('guarda secuencias con sus pasos y las devuelve ordenadas', async () => {
    const sequence = await repos.automation.createSequence({
      name: 'Seguimiento',
      description: 'dos pasos',
      steps: [
        {
          delayMinutes: 60,
          kind: 'template',
          templateName: 'seguimiento_entrega',
          variables: ['{nombre}', '{fecha}'],
        },
        { delayMinutes: 1440, kind: 'text', text: 'ultimo aviso' },
      ],
    });

    expect(sequence.steps.map((s) => s.position)).toEqual([1, 2]);
    // Las variables viajan como jsonb: deben volver como array, no como texto.
    expect(sequence.steps[0]!.variables).toEqual(['{nombre}', '{fecha}']);
    expect(sequence.steps[1]!.text).toBe('ultimo aviso');

    const listed = await repos.automation.listSequences();
    expect(listed[0]).toMatchObject({ name: 'Seguimiento', activeEnrollments: 0, totalEnrollments: 0 });

    // Editar reemplaza los pasos sin dejar huerfanos ni chocar con la clave
    // unica (sequence_id, position).
    const updated = await repos.automation.updateSequence(sequence.id, {
      name: 'Seguimiento corto',
      steps: [{ delayMinutes: 30, kind: 'text', text: 'unico paso' }],
    });
    expect(updated?.steps).toHaveLength(1);
    expect(updated?.name).toBe('Seguimiento corto');
  });

  it('inscribe, programa, reclama lo vencido y avanza', async () => {
    const sequence = await repos.automation.createSequence({
      name: 'Con pasos',
      steps: [
        { delayMinutes: 0, kind: 'text', text: 'primero' },
        { delayMinutes: 60, kind: 'text', text: 'segundo' },
      ],
    });
    const contact = (await repos.contacts.getByPhone('5215510000002'))!;

    const first = await repos.automation.enroll(sequence.id, contact.id, 'test');
    expect(first.created).toBe(true);
    const again = await repos.automation.enroll(sequence.id, contact.id, 'test');
    expect(again.created).toBe(false);
    expect(again.enrollment.id).toBe(first.enrollment.id);

    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 3_600_000);
    const dueId = await repos.automation.schedule({
      contactId: contact.id,
      enrollmentId: first.enrollment.id,
      stepPosition: 1,
      dueAt: past,
      kind: 'freeform',
      category: 'UTILITY',
      text: 'primero',
    });
    await repos.automation.schedule({
      contactId: contact.id,
      enrollmentId: first.enrollment.id,
      stepPosition: 2,
      dueAt: future,
      kind: 'freeform',
      category: 'UTILITY',
      text: 'segundo',
    });

    // Solo se reclama lo vencido, y una segunda llamada no lo repite.
    const claimed = await repos.automation.claimDue(new Date(), 10);
    expect(claimed.map((m) => m.id)).toEqual([dueId]);
    expect(claimed[0]!.variables).toEqual([]);
    expect(await repos.automation.claimDue(new Date(), 10)).toHaveLength(0);

    await repos.automation.markScheduled(dueId, 'sent', null, 42);
    const sent = await repos.automation.listScheduled({ status: 'sent', limit: 10, offset: 0 });
    expect(sent[0]).toMatchObject({ id: dueId, deliveryId: 42, sequenceName: 'Con pasos', phone: '5215510000002' });

    const enrollments = await repos.automation.listEnrollments({ status: 'active', limit: 10, offset: 0 });
    expect(enrollments[0]).toMatchObject({ sequenceName: 'Con pasos', totalSteps: 2 });
    expect(enrollments[0]!.nextDueAt).toBeInstanceOf(Date);

    // Cancelar la inscripcion arrastra lo que quedaba pendiente.
    expect(await repos.automation.cancelPendingForEnrollment(first.enrollment.id)).toBe(1);
    await repos.automation.finishEnrollment(first.enrollment.id, 'cancelled');
    expect((await repos.automation.getEnrollment(first.enrollment.id))?.status).toBe('cancelled');
    expect(await repos.automation.listScheduled({ status: 'pending', limit: 10, offset: 0 })).toHaveLength(0);
  });

  it('cancelar un programado solo funciona mientras esta pendiente', async () => {
    const contact = (await repos.contacts.getByPhone('5215510000002'))!;
    const id = await repos.automation.schedule({
      contactId: contact.id,
      dueAt: new Date(Date.now() + 3_600_000),
      kind: 'freeform',
      category: 'UTILITY',
      text: 'manual',
    });
    expect(await repos.automation.cancelScheduled(id)).toBe(true);
    expect(await repos.automation.cancelScheduled(id)).toBe(false);
  });

  it('las reglas se crean, se editan campo a campo y se borran', async () => {
    const sequence = (await repos.automation.listSequences())[0]!;
    const rule = await repos.automation.createRule({
      name: 'Cotizar',
      trigger: 'keyword',
      keyword: 'cotizar',
      match: 'contains',
      reply: 'Con gusto',
      sequenceId: sequence.id,
      priority: 10,
    });
    expect(rule).toMatchObject({ keyword: 'cotizar', sequenceId: sequence.id, enabled: true });

    // Un patch parcial no debe borrar lo que no menciona.
    const disabled = await repos.automation.updateRule(rule.id, { enabled: false });
    expect(disabled).toMatchObject({ enabled: false, keyword: 'cotizar', reply: 'Con gusto' });

    // Pero si debe permitir vaciar un campo explicitamente.
    const cleared = await repos.automation.updateRule(rule.id, { sequenceId: null });
    expect(cleared?.sequenceId).toBeNull();
    expect(cleared?.reply).toBe('Con gusto');

    expect(await repos.automation.updateRule('00000000-0000-0000-0000-000000000000', { enabled: true })).toBeNull();

    await repos.automation.deleteRule(rule.id);
    expect(await repos.automation.listRules()).toHaveLength(0);
  });

  it('borrar una secuencia se lleva sus inscripciones y sus programados', async () => {
    const sequence = await repos.automation.createSequence({
      name: 'Temporal',
      steps: [{ delayMinutes: 0, kind: 'text', text: 'x' }],
    });
    const contact = (await repos.contacts.getByPhone('5215510000002'))!;
    const { enrollment } = await repos.automation.enroll(sequence.id, contact.id, null);
    await repos.automation.schedule({
      contactId: contact.id,
      enrollmentId: enrollment.id,
      stepPosition: 1,
      dueAt: new Date(),
      kind: 'freeform',
      category: 'UTILITY',
      text: 'x',
    });

    await repos.automation.deleteSequence(sequence.id);
    expect(await repos.automation.getSequence(sequence.id)).toBeNull();
    expect(await repos.automation.getEnrollment(enrollment.id)).toBeNull();
    const left = await repos.automation.listScheduled({ limit: 50, offset: 0 });
    expect(left.some((m) => m.enrollmentId === enrollment.id)).toBe(false);
  });

  it('las preferencias se guardan en la tabla settings y sobreviven a una relectura', async () => {
    expect(await repos.automation.getPrefs()).toEqual({ askLocationFallback: true });
    expect(await repos.automation.setPrefs({ askLocationFallback: false })).toEqual({
      askLocationFallback: false,
    });
    expect(await repos.automation.getPrefs()).toEqual({ askLocationFallback: false });
  });
});

describe('conversaciones sobre Postgres', () => {
  it('guarda entrantes y salientes y arma el hilo en orden', async () => {
    const contact = (await repos.contacts.getByPhone('5215510000001'))!;
    const base = new Date('2026-03-10T12:00:00Z');
    const en = (segundos: number) => new Date(base.getTime() + segundos * 1000);

    await repos.messages.add({ contactId: contact.id, direction: 'in', wamid: 'w1', kind: 'text', body: 'hola', createdAt: en(0) });
    await repos.messages.add({ contactId: contact.id, direction: 'out', wamid: 'w2', kind: 'text', body: 'que tal', status: 'sent', createdAt: en(1) });
    // Mismo segundo que el anterior: el orden lo tiene que desempatar el id.
    await repos.messages.add({ contactId: contact.id, direction: 'out', wamid: 'w3', kind: 'text', body: 'te ayudo?', status: 'sent', createdAt: en(1) });

    const hilo = await repos.messages.listMessages(contact.id, 50);
    expect(hilo.map((m) => m.body)).toEqual(['hola', 'que tal', 'te ayudo?']);
    expect(hilo[0]).toMatchObject({ direction: 'in', kind: 'text' });
  });

  it('el payload vuelve como objeto, no como texto', async () => {
    const contact = (await repos.contacts.getByPhone('5215510000001'))!;
    await repos.messages.add({
      contactId: contact.id,
      direction: 'in',
      wamid: 'w-loc',
      kind: 'location',
      body: 'Ubicacion: 19.43, -99.13',
      payload: { location: { latitude: 19.43, longitude: -99.13 } },
    });

    const hilo = await repos.messages.listMessages(contact.id, 50);
    const ubicacion = hilo.find((m) => m.wamid === 'w-loc')!;
    expect(ubicacion.payload).toMatchObject({ location: { latitude: 19.43 } });
  });

  it('el mismo wamid dos veces no duplica: actualiza el estado', async () => {
    const contact = (await repos.contacts.getByPhone('5215510000001'))!;
    const antes = (await repos.messages.listMessages(contact.id, 200)).length;

    await repos.messages.add({ contactId: contact.id, direction: 'out', wamid: 'w2', kind: 'text', body: 'que tal', status: 'delivered' });

    const despues = await repos.messages.listMessages(contact.id, 200);
    expect(despues).toHaveLength(antes);
    expect(despues.find((m) => m.wamid === 'w2')?.status).toBe('delivered');

    await repos.messages.setStatusByWamid('w2', 'read');
    const hilo = await repos.messages.listMessages(contact.id, 200);
    expect(hilo.find((m) => m.wamid === 'w2')?.status).toBe('read');
  });

  it('la lista de chats trae el ultimo mensaje y los no leidos', async () => {
    const contact = (await repos.contacts.getByPhone('5215510000001'))!;
    const chats = await repos.messages.listConversations({ limit: 50, offset: 0 });
    const mio = chats.find((c) => c.contactId === contact.id)!;

    expect(mio.lastMessage).not.toBeNull();
    expect(mio.unread).toBeGreaterThan(0);
    expect(await repos.messages.unreadTotal()).toBeGreaterThan(0);

    // Marcar leido baja el contador de ese chat y el total.
    await repos.messages.markRead(contact.id, new Date());
    const despues = await repos.messages.listConversations({ limit: 50, offset: 0 });
    expect(despues.find((c) => c.contactId === contact.id)!.unread).toBe(0);
  });

  it('un contacto sin mensajes aparece igual, al final', async () => {
    const chats = await repos.messages.listConversations({ limit: 50, offset: 0 });
    const sinMensajes = chats.filter((c) => c.lastMessage === null);
    expect(sinMensajes.length).toBeGreaterThan(0);
    expect(chats[0]!.lastMessage).not.toBeNull();
  });

  it('la busqueda filtra por telefono y por nombre', async () => {
    expect(await repos.messages.listConversations({ q: '0000001', limit: 50, offset: 0 })).toHaveLength(1);
    expect(await repos.messages.listConversations({ q: 'luis', limit: 50, offset: 0 })).toHaveLength(1);
  });

  it('el hilo se pagina hacia atras', async () => {
    const contact = (await repos.contacts.getByPhone('5215510000001'))!;
    const todos = await repos.messages.listMessages(contact.id, 200);
    const ultimos = await repos.messages.listMessages(contact.id, 2);
    expect(ultimos).toHaveLength(2);
    expect(ultimos.at(-1)!.id).toBe(todos.at(-1)!.id);

    const anteriores = await repos.messages.listMessages(contact.id, 2, ultimos[0]!.id);
    expect(anteriores.every((m) => m.id < ultimos[0]!.id)).toBe(true);
  });
});

describe('credenciales sobre Postgres', () => {
  it('se guardan cifradas y se releen', async () => {
    const config = loadConfig({
      PUBLIC_BASE_URL: 'http://localhost:3000',
      DATABASE_URL: 'postgres://x/y',
      ADMIN_TOKEN: 'admin-token-largo-1234',
      TRACKING_SECRET: 'x'.repeat(40),
    } as NodeJS.ProcessEnv);

    const repo = createSettingsRepo(pool);
    const settings = await createSettingsService(repo, config, TEST_SETTINGS_KEY);
    expect(settings.isConfigured()).toBe(false);

    await settings.save({
      token: 'EAAG-token-secreto',
      phoneNumberId: '123',
      businessAccountId: '456',
      appSecret: 'secreto',
      verifyToken: 'verifica',
    });
    expect(settings.isConfigured()).toBe(true);

    const row = (await repo.getAll()).find((r) => r.key === 'whatsapp.token');
    expect(row?.encrypted).toBe(true);
    expect(row?.value).not.toContain('EAAG');

    // Un servicio nuevo sobre la misma base ve lo guardado: es lo que pasa
    // al reiniciar el proceso.
    const reloaded = await createSettingsService(createSettingsRepo(pool), config, TEST_SETTINGS_KEY);
    expect(reloaded.current().token).toBe('EAAG-token-secreto');
    expect(reloaded.current().phoneNumberId).toBe('123');
  });
});
