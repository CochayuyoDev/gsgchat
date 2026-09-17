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
      templateLanguage: 'es',
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
    // Apagado de fabrica: contestar a todo mensaje sin coordenadas es ruido.
    // Apagado de fabrica: contestar a todo mensaje sin coordenadas es ruido.
    expect(await repos.automation.getPrefs()).toMatchObject({ askLocationFallback: false });
    expect(await repos.automation.setPrefs({ askLocationFallback: true })).toMatchObject({
      askLocationFallback: true,
    });
    expect(await repos.automation.getPrefs()).toMatchObject({ askLocationFallback: true });
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

  it('un "ver una vez" que llego vacio se completa con la foto cuando el telefono la reenvia, y solo una vez', async () => {
    const contact = (await repos.contacts.getByPhone('5215510000001'))!;
    await repos.messages.add({ contactId: contact.id, direction: 'in', wamid: 'vo1', kind: 'unknown', body: '👁 Foto de "ver una vez"', payload: { viewOnce: { kind: 'unknown' } } });
    expect(await repos.messages.tieneAdjunto('vo1')).toBe(false);

    const foto = { kind: 'image' as const, body: 'foto · ver una vez', payload: { media: { id: 'a.jpg', kind: 'image', verUnaVez: true } } };
    expect(await repos.messages.completarPorWamid('vo1', foto)).toBe(true);
    expect(await repos.messages.tieneAdjunto('vo1')).toBe(true);
    const fila = (await repos.messages.listMessages(contact.id, 200)).find((m) => m.wamid === 'vo1')!;
    expect(fila).toMatchObject({ kind: 'image', body: 'foto · ver una vez', payload: { media: { id: 'a.jpg' } } });

    // Ya con fichero no se degrada: ni por otro completar ni por la reentrega del sobre vacio.
    expect(await repos.messages.completarPorWamid('vo1', { kind: 'unknown', body: 'sobre', payload: null })).toBe(false);
    await repos.messages.add({ contactId: contact.id, direction: 'in', wamid: 'vo1', kind: 'unknown', body: 'sobre', payload: { viewOnce: { kind: 'unknown' } } });
    expect((await repos.messages.listMessages(contact.id, 200)).find((m) => m.wamid === 'vo1')!.kind).toBe('image');
    expect(await repos.messages.completarPorWamid('no-existe', foto)).toBe(false);
  });
});

describe('el ancla del historial sobre Postgres', () => {
  it('el mas antiguo es por fecha, no por orden de llegada, y con id de WhatsApp', async () => {
    const contact = await repos.contacts.upsertFromInbound('5215510007777', 'Ancla');
    // Llega primero lo de hoy; el historial del telefono entra despues con fechas viejas.
    await repos.messages.add({ contactId: contact.id, direction: 'in', wamid: 'hoy-1', kind: 'text', body: 'hoy', createdAt: new Date('2026-09-16T21:00:00Z') });
    await repos.messages.add({ contactId: contact.id, direction: 'out', wamid: 'viejo-1', kind: 'text', body: 'de antes', createdAt: new Date('2026-09-05T10:00:00Z') });
    await repos.messages.add({ contactId: contact.id, direction: 'in', wamid: 'web:abc', kind: 'text', body: 'web', createdAt: new Date('2026-09-01T10:00:00Z') });
    await repos.messages.add({ contactId: contact.id, direction: 'in', wamid: null, kind: 'text', body: 'sin id', createdAt: new Date('2026-08-01T10:00:00Z') });
    const ancla = await repos.messages.masAntiguo(contact.id);
    expect(ancla).toMatchObject({ wamid: 'viejo-1', direction: 'out' });
    expect(await repos.messages.masAntiguo('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('grupos de WhatsApp sobre Postgres', () => {
  const JID = '120363412332267099@g.us';

  it('la migracion 019 deja a los contactos de antes como personas', async () => {
    const { rows } = await pool.query<{ tipo: string }>(`select tipo from contacts where phone = '5215510000001'`);
    expect(rows[0]!.tipo).toBe('persona');
    expect((await repos.contacts.getByPhone('5215510000001'))!.tipo).toBe('persona');
  });

  it('un grupo se guarda por su jid, con su nombre, y el nombre no se pisa con vacio', async () => {
    const g = await repos.contacts.upsertGrupo(JID, 'Reparto Lima Norte');
    expect(g).toMatchObject({ phone: JID, name: 'Reparto Lima Norte', tipo: 'grupo' });
    const otraVez = await repos.contacts.upsertGrupo(JID, '');
    expect(otraVez.id).toBe(g.id);
    expect(otraVez.name).toBe('Reparto Lima Norte');
    expect((await repos.contacts.upsertGrupo(JID, 'Reparto Lima Sur')).name).toBe('Reparto Lima Sur');
    // Un entrante del grupo lo encuentra por el jid, sin crear otro.
    const porEntrante = await repos.contacts.upsertFromInbound(JID);
    expect(porEntrante.id).toBe(g.id);
    expect(porEntrante.tipo).toBe('grupo');
  });

  it('esta en la lista de chats como grupo y fuera de la libreta y de los suscritos', async () => {
    const g = (await repos.contacts.getByPhone(JID))!;
    await repos.messages.add({ contactId: g.id, direction: 'in', wamid: 'g1', kind: 'text', body: 'hola grupo', payload: { autor: { telefono: '5215510000009', nombre: 'Pepe' } } });
    const chats = await repos.messages.listConversations({ limit: 50, offset: 0 });
    expect(chats.find((c) => c.contactId === g.id)).toMatchObject({ tipo: 'grupo', name: 'Reparto Lima Sur', lastMessage: { body: 'hola grupo' } });
    expect(chats.find((c) => c.phone === '5215510000001')!.tipo).toBe('persona');

    const libreta = await repos.contacts.list({ limit: 200, offset: 0 });
    expect(libreta.items.some((c) => c.phone === JID)).toBe(false);
    expect(libreta.total).toBe(libreta.items.length);
    await repos.contacts.setOptIn(JID, 'prueba');
    expect((await repos.contacts.listOptedIn(200, 0)).some((c) => c.phone === JID)).toBe(false);
  });
});

describe('credenciales sobre Postgres', () => {
  it('se guardan cifradas y se releen', async () => {
    const config = loadConfig({
      PUBLIC_BASE_URL: 'http://localhost:3000',
      DATABASE_URL: 'postgres://x/y',
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

describe('integraciones sobre Postgres', () => {
  it('la migracion 017 deja permisos en las claves y crea las tablas de webhooks', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' and table_name in ('webhooks', 'webhook_entregas')`,
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual(['webhook_entregas', 'webhooks']);

    // Una clave de antes (sin permisos) sigue pudiendo todo.
    await db.exec(`insert into claves_api (nombre, prefijo, hash) values ('vieja', 'wak_vieja…', 'hash-vieja')`);
    expect((await repos.claves.porHash('hash-vieja'))?.permisos).toEqual(['*']);
    const acotada = await repos.claves.crear({ nombre: 'Stoky', prefijo: 'wak_stoky…', hash: 'hash-stoky', creadaPor: null, permisos: ['mensajes:enviar', 'conversaciones:leer'] });
    expect(acotada.permisos).toEqual(['mensajes:enviar', 'conversaciones:leer']);
    expect((await repos.claves.listar()).find((c) => c.id === acotada.id)?.permisos).toEqual(['mensajes:enviar', 'conversaciones:leer']);
  });

  it('webhooks: alta, suscripcion por evento, cola de entregas, reintento, fallo y apagado', async () => {
    const w = repos.webhooks;
    const todo = await w.crear({ url: 'https://a.test/wh', descripcion: 'todo', secreto: 'whsec_a', eventos: ['*'], creadoPor: null });
    const solo = await w.crear({ url: 'https://b.test/wh', descripcion: 'solo mensajes', secreto: 'whsec_b', eventos: ['mensaje.recibido'], creadoPor: null });
    expect(todo).toMatchObject({ activo: true, motivoPausa: null, fallosSeguidos: 0, ultimoOkAt: null });
    expect(JSON.stringify(await w.listar())).not.toContain('whsec_');

    const paraMensajes = (await w.activosPara('mensaje.recibido')).map((x) => x.id).sort();
    expect(paraMensajes).toEqual([todo.id, solo.id].sort());
    const paraBajas = (await w.activosPara('contacto.baja')).map((x) => x.id);
    expect(paraBajas).toEqual([todo.id]);
    expect((await w.conSecreto(solo.id))?.secreto).toBe('whsec_b');

    const t0 = new Date('2026-09-15T10:00:00Z');
    const e1 = await w.encolar(todo.id, 'mensaje.recibido', { texto: 'hola' }, t0);
    const e2 = await w.encolar(todo.id, 'contacto.baja', { telefono: '1' }, new Date(t0.getTime() + 1000));
    // Lo que toca ahora, en orden, y con el payload como objeto.
    const pendientes = await w.pendientes(new Date(t0.getTime() + 5000), 10);
    expect(pendientes.map((e) => e.id)).toEqual([e1, e2]);
    expect(pendientes[0]!.payload).toEqual({ texto: 'hola' });
    expect(await w.pendientes(t0, 10)).toHaveLength(1);

    // Reintento: se queda pendiente para mas tarde, con lo que contesto.
    const luego = new Date(t0.getTime() + 60_000);
    await w.marcarEntrega(e1, { estado: 'pendiente', codigo: 503, respuesta: 'caido', error: 'HTTP 503', proximoIntentoAt: luego });
    expect(await w.pendientes(new Date(t0.getTime() + 5000), 10)).toHaveLength(1);
    expect((await w.entregas(todo.id, 10)).find((e) => e.id === e1)).toMatchObject({ estado: 'pendiente', intentos: 1, respuestaCodigo: 503, error: 'HTTP 503' });

    // Exito y fallo definitivo, y el resumen del webhook.
    await w.marcarEntrega(e1, { estado: 'enviada', codigo: 200, respuesta: 'ok', at: luego });
    expect(await w.anotarResultado(todo.id, true, luego)).toEqual({ fallosSeguidos: 0, ultimoOkAt: luego });
    await w.marcarEntrega(e2, { estado: 'fallida', codigo: 404, respuesta: null, error: 'HTTP 404' });
    expect((await w.anotarResultado(todo.id, false, luego)).fallosSeguidos).toBe(1);
    expect((await w.obtener(todo.id))).toMatchObject({ fallosSeguidos: 1, ultimoOkAt: luego, ultimoFalloAt: luego });
    expect(await w.contarPendientes()).toBe(0);

    // Reencolar lo fallido, y apagar/encender.
    expect(await w.reencolarFallidas(todo.id, luego)).toBe(1);
    expect(await w.contarPendientes()).toBe(1);
    await w.pausar(todo.id, 'sin una entrega buena en 24 h');
    expect(await w.pendientes(new Date(luego.getTime() + 1), 10)).toHaveLength(0);
    expect(await w.activosPara('contacto.baja')).toHaveLength(0);
    expect(await w.actualizar(todo.id, { activo: true })).toMatchObject({ activo: true, motivoPausa: null, fallosSeguidos: 0 });
    expect(await w.actualizar(todo.id, { url: 'https://a.test/v2', eventos: ['salud.nivel'] })).toMatchObject({ url: 'https://a.test/v2', eventos: ['salud.nivel'] });

    expect(await w.rotarSecreto(solo.id, 'whsec_c')).toBe(true);
    expect((await w.conSecreto(solo.id))?.secreto).toBe('whsec_c');

    // Borrar se lleva las entregas.
    expect(await w.borrar(todo.id)).toBe(true);
    expect(await w.borrar(todo.id)).toBe(false);
    expect(await w.entregas(todo.id, 10)).toHaveLength(0);
    expect(await w.contarPendientes()).toBe(0);
  });
  it('un id que no es uuid es "no existe", no un 500 (webhooks y conectores)', async () => {
    // Postgres contesta 22P02 al comparar la columna uuid con "no-es-uuid";
    // antes subia hasta la API como "error interno" (visto el 2026-09-17).
    expect(await repos.webhooks.obtener('no-es-uuid')).toBeNull();
    expect(await repos.webhooks.conSecreto('undefined')).toBeNull();
    expect(await repos.webhooks.entregas('no-es-uuid', 10)).toEqual([]);
    expect(await repos.webhooks.actualizar('no-es-uuid', { url: 'https://a.test/x' })).toBeNull();
    expect(await repos.webhooks.borrar('no-es-uuid')).toBe(false);
    expect(await repos.webhooks.reencolarFallidas('no-es-uuid', new Date())).toBe(0);
    expect(await repos.conectores.obtener('no-es-uuid')).toBeNull();
    expect(await repos.conectores.borrar('no-es-uuid')).toBe(false);
    // Las campanas tambien van por uuid: /admin/campaigns/None daba 500.
    expect(await repos.campaigns.get('None')).toBeNull();
    expect(await repos.deliveries.campaignStats('None')).toEqual({});
    expect(await repos.campaigns.cifrasDestinatarios('undefined')).toEqual({});
    expect(await repos.campaigns.cancelarPendientes('None', 'x')).toBe(0);
  });
});

describe('conectores de tiendas sobre Postgres', () => {
  it('alta, reglas en jsonb, secreto, entradas y borrado en cascada', async () => {
    const c = repos.conectores;
    const regla = { evento: 'pedido.creado' as const, activo: true, plantilla: { nombre: 'confirmacion_pedido', idioma: 'es' }, variables: ['{nombre}', '{numero}'], texto: null };
    const woo = await c.crear({ tipo: 'woocommerce', nombre: 'Tienda Woo', secreto: 'wcs_abc', reglas: [regla], creadoPor: null });
    expect(woo).toMatchObject({ tipo: 'woocommerce', activo: true, reglas: [regla], eventosRecibidos: 0, ultimoEventoAt: null });
    expect(JSON.stringify(await c.listar())).not.toContain('wcs_abc');
    expect((await c.conSecreto(woo.id))?.secreto).toBe('wcs_abc');

    const cambiado = await c.actualizar(woo.id, { nombre: 'Woo 2', reglas: [{ ...regla, texto: 'Gracias {nombre}' }], activo: false });
    expect(cambiado).toMatchObject({ nombre: 'Woo 2', activo: false });
    expect(cambiado?.reglas[0]?.texto).toBe('Gracias {nombre}');
    // Un parche sin reglas no las toca.
    expect((await c.actualizar(woo.id, { activo: true }))?.reglas[0]?.texto).toBe('Gracias {nombre}');
    expect(await c.cambiarSecreto(woo.id, 'shpss_x')).toBe(true);
    expect((await c.conSecreto(woo.id))?.secreto).toBe('shpss_x');

    const t = new Date('2026-09-15T12:00:00Z');
    await c.anotarEntrada({ conectorId: woo.id, evento: 'pedido.creado', eventoOrigen: 'order.created', pedido: '1024', telefono: '51987654321', resultado: 'enviado', detalle: 'mensaje wamid.1', at: t });
    await c.anotarEntrada({ conectorId: woo.id, evento: 'pedido.pagado', eventoOrigen: 'order.updated', pedido: '1024', telefono: '51987654321', resultado: 'sin_regla', detalle: null });
    const entradas = await c.entradas(woo.id, 10);
    expect(entradas.map((e) => e.resultado)).toEqual(['sin_regla', 'enviado']);
    expect(entradas[1]).toMatchObject({ pedido: '1024', eventoOrigen: 'order.created', createdAt: t });
    expect(await c.obtener(woo.id)).toMatchObject({ eventosRecibidos: 2 });

    expect(await c.borrar(woo.id)).toBe(true);
    expect(await c.borrar(woo.id)).toBe(false);
    expect(await c.entradas(woo.id, 10)).toHaveLength(0);
  });
});

describe('fichas de preventa sobre Postgres', () => {
  it('una lista en ultimasOpciones entra como JSON', async () => {
    const c = await repos.contacts.upsertFromInbound('51955555555', 'Ficha');
    const lead = await repos.leads.update(c.id, { ultimasOpciones: ['pv_cotizar', 'pv_datos'], nombre: 'Ficha' });
    expect(lead.ultimasOpciones).toEqual(['pv_cotizar', 'pv_datos']);
    const otra = await repos.leads.update(c.id, { ultimasOpciones: null });
    expect(otra.ultimasOpciones).toBeNull();
  });
});

describe('pedidos del chat sobre Postgres', () => {
  it('alta con items en jsonb, lista con el contacto, cambio de estado y conteo', async () => {
    const c = await repos.contacts.upsertFromInbound('51966666666', 'Compradora');
    const items = [{ sku: 'EFR-S108D-2AV', nombre: 'Casio Edifice azul', cantidad: 2, precio: 749, subtotal: 1498, url: 'https://elysian.pe/producto/efr-s108d-2av' }];
    const p = await repos.pedidos.crear({ contactId: c.id, items, total: 1498, moneda: 'PEN', nombre: 'Maria', telefono: c.phone, direccion: 'Av. Larco 123', pago: 'yape', origen: 'ia' });
    expect(p).toMatchObject({ estado: 'nuevo', items, total: 1498, moneda: 'PEN', nombre: 'Maria', externoId: null });
    expect(p.createdAt).toBeInstanceOf(Date);

    const visto = await repos.pedidos.obtener(p.id);
    expect(visto).toMatchObject({ id: p.id, contactoTelefono: '51966666666', contactoNombre: 'Compradora', items });
    expect(await repos.pedidos.obtener(999999)).toBeNull();

    const lista = await repos.pedidos.listar({ limit: 10, offset: 0 });
    expect(lista.total).toBeGreaterThanOrEqual(1);
    expect(lista.items[0]).toMatchObject({ id: p.id, contactoTelefono: '51966666666' });
    expect((await repos.pedidos.listar({ estado: 'cancelado', limit: 10, offset: 0 })).items.find((x) => x.id === p.id)).toBeUndefined();
    expect((await repos.pedidos.porContacto(c.id, 5)).map((x) => x.id)).toEqual([p.id]);

    const cambiado = await repos.pedidos.cambiarEstado(p.id, 'enviado_tienda', 'EL-1001');
    expect(cambiado).toMatchObject({ estado: 'enviado_tienda', externoId: 'EL-1001' });
    expect(cambiado!.updatedAt.getTime()).toBeGreaterThanOrEqual(p.updatedAt.getTime());
    // Sin externoId nuevo se conserva el anterior.
    expect((await repos.pedidos.cambiarEstado(p.id, 'confirmado'))?.externoId).toBe('EL-1001');
    expect(await repos.pedidos.cambiarEstado(999999, 'cancelado')).toBeNull();
    expect((await repos.pedidos.contarPorEstado()).confirmado).toBeGreaterThanOrEqual(1);
  });
});
