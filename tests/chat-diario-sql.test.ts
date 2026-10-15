import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';
import { createRepos, type Repos } from '../src/db/repos.js';

let db: BaseDePrueba, repos: Repos;
beforeAll(async () => { db = await baseDePrueba(); repos = createRepos(db.pool); }, 180000);
afterAll(async () => { await db?.cerrar(); });

describe('SQL del chat diario', () => {
  it('filtra en la base, pagina solo el día actual y limpia sin borrar contactos ni envíos', async () => {
    const desde = new Date('2026-10-14T18:00:00Z');
    const vieja = new Date('2026-10-13T18:00:00Z');
    const c = await repos.contacts.upsertFromInbound('51987603111');
    const personal = await repos.contacts.upsertFromInbound('51987603222');
    const antiguo = await repos.contacts.upsertFromInbound('51987603333');
    const add = (id: string, direction: 'in' | 'out', body: string, createdAt: Date, payload = {}) => repos.messages.add({ contactId: id, direction, body, kind: 'text', wamid: body, createdAt, payload });
    await add(antiguo.id, 'out', 'pedido ayer', vieja);
    await add(c.id, 'out', 'mensaje antiguo del cliente', vieja);
    // created_at conserva el reloj original del proveedor. Para simular
    // retención, el test fija además la hora en que el sistema incorporó
    // estos dos mensajes (stored_at).
    await db.pool.query('update messages set stored_at = ? where wamid in (?)', [vieja, ['pedido ayer', 'mensaje antiguo del cliente']]);
    await add(personal.id, 'out', 'conversación personal', desde, { autorNombre: 'Teléfono', origen: 'persona' });
    await add(c.id, 'out', 'pedido de hoy', desde, { origen: 'sistema' });
    await add(c.id, 'in', 'respuesta de hoy', new Date(desde.getTime()+1000));
    await add(c.id, 'in', 'historial importado', new Date(desde.getTime()+2000), { historial: true });
    expect((await repos.messages.listConversations({ desde, limit: 100, offset: 0 })).map(x => x.contactId)).toEqual([c.id]);
    expect((await repos.messages.listMessages(c.id, 80, undefined, desde)).map(x => x.body)).toEqual(['pedido de hoy', 'respuesta de hoy']);
    expect(await repos.messages.listMessages(personal.id, 80, undefined, desde)).toEqual([]);
    expect(await repos.messages.unreadTotal(desde)).toBe(1);
    expect(await repos.messages.buscar({ contactId: c.id, q: 'antiguo', limit: 80, desde })).toEqual([]);
    expect((await repos.messages.buscar({ contactId: c.id, q: 'pedido', limit: 80, desde })).map(m => m.body)).toEqual(['pedido de hoy']);
    for (const contact of [c, personal, antiguo]) {
      const ids = (await repos.messages.listMessages(contact.id, 80)).map(m => m.id);
      await repos.messages.destacar(contact.id, ids, true, desde);
    }
    expect((await repos.messages.destacados({ limit: 80, desde })).map(m => m.body)).toEqual(['respuesta de hoy', 'pedido de hoy']);
    expect((await db.pool.query("show index from messages where Key_name = 'messages_day_idx'")).rows).toHaveLength(2);
    expect((await repos.messages.inicioSistemaDesde(c.id, desde))?.toISOString()).toBe(desde.toISOString());
    const ultima = (await repos.messages.listMessages(c.id, 1, undefined, desde))[0]!;
    expect((await repos.messages.listMessages(c.id, 80, ultima.id, desde)).map(x => x.body)).toEqual(['pedido de hoy']);
    expect(await repos.messages.limpiarAntes(desde)).toBe(2);
    expect(await repos.messages.listMessages(antiguo.id, 80)).toEqual([]);
    expect(await repos.contacts.getByPhone(antiguo.phone)).toBeTruthy();
    expect(await repos.messages.limpiarAntes(desde)).toBe(0);
  });

  it('mantiene el recibo deduplicador después de expirar el mensaje y separa proveedores', async () => {
    const contact = await repos.contacts.upsertFromInbound('51987603999');
    const ahora = new Date('2026-10-14T18:00:00.000Z');
    const expiracion = new Date(ahora.getTime() + 7 * 24 * 60 * 60_000);
    expect(await repos.messages.reservarEntrada('meta', 'wamid-retenido-7d', ahora, expiracion)).toBe(true);
    await repos.messages.finalizarEntrada('meta', 'wamid-retenido-7d', 'aceptado');
    expect(await repos.messages.reservarEntrada('meta', 'wamid-retenido-7d', ahora, expiracion)).toBe(false);
    expect(await repos.messages.reservarEntrada('waha', 'wamid-retenido-7d', ahora, expiracion)).toBe(true);
    await repos.messages.add({ contactId: contact.id, direction: 'in', wamid: 'wamid-retenido-7d', kind: 'text', body: 'temporal', createdAt: new Date(ahora.getTime() - 25 * 60 * 60_000) });
    await db.pool.query('update messages set stored_at = ? where wamid = ?', [new Date(ahora.getTime() - 25 * 60 * 60_000), 'wamid-retenido-7d']);
    expect(await repos.messages.limpiarAntes(new Date(ahora.getTime() - 24 * 60 * 60_000))).toBe(1);
    const reposTrasReinicio = createRepos(db.pool);
    expect(await reposTrasReinicio.messages.reservarEntrada('meta', 'wamid-retenido-7d', ahora, expiracion)).toBe(false);
    expect(await repos.messages.limpiarEntradasAntes(new Date(ahora.getTime() + 8 * 24 * 60 * 60_000))).toBe(2);

    const controlA = { key: 'a'.repeat(64), tipo: 'confirmacion_ubicacion', referencia: 'ACUSE-A', ahora, expira: expiracion };
    const controlB = { ...controlA, key: 'b'.repeat(64), referencia: 'ACUSE-B' };
    expect(await repos.messages.reservarAccionWhatsapp(controlA)).toBe(true);
    await repos.messages.finalizarAccionWhatsapp(controlA.key, 'aceptado', 'wamid-saliente-a');
    expect(await repos.messages.reservarAccionWhatsapp(controlA)).toBe(false);
    // Otro tracking del mismo contacto es una acción distinta.
    expect(await repos.messages.reservarAccionWhatsapp(controlB)).toBe(true);
    expect(await repos.messages.limpiarAccionesWhatsappAntes(new Date(ahora.getTime() + 8 * 24 * 60 * 60_000))).toBe(2);
    expect(await repos.messages.reservarAccionWhatsapp(controlA)).toBe(true);
  });
});
