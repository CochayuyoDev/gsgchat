/**
 * El estado real de los mensajes contra MySQL de verdad (ver tests/mysql.ts):
 *  - el acuse que llega antes que la fila se aplica al guardarla, y un
 *    «failed» adelantado deja también su motivo en el envío (deliveries);
 *  - volver a guardar un mensaje (on duplicate key) no le baja el estado;
 *  - un acuse repetido sobre una fila que ya lo tiene no se aparta como si
 *    la fila no existiera (MySQL cuenta 0 filas cambiadas).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from '../src/db/pool.js';
import { createRepos, type Repos } from '../src/db/repos.js';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';

let b: BaseDePrueba;
let pool: Pool;
let repos: Repos;

beforeAll(async () => {
  b = await baseDePrueba();
  pool = b.pool;
  repos = createRepos(pool);
});
afterAll(async () => {
  await b?.cerrar();
});

const estadoDe = async (wamid: string) => (await pool.query<{ status: string | null }>('select status from messages where wamid = $1', [wamid])).rows[0]?.status ?? null;

describe('estado real de los mensajes (MySQL)', () => {
  it('un failed que llega antes que el mensaje queda puesto, con su motivo en el envío', async () => {
    const c = await repos.contacts.upsertFromInbound('51900333444');
    const deliveryId = await repos.deliveries.create({ contactId: c.id, kind: 'freeform', category: 'UTILITY' } as never);
    await repos.messages.setStatusByWamid('wamid.sql.adelantado', 'failed', { code: '131047', title: 'Re-engagement message' });
    await repos.deliveries.markSent(deliveryId, 'wamid.sql.adelantado');
    await repos.messages.add({ contactId: c.id, direction: 'out', wamid: 'wamid.sql.adelantado', kind: 'text', body: 'hola', status: 'sent', deliveryId });
    expect(await estadoDe('wamid.sql.adelantado')).toBe('failed');
    const d = (await pool.query<{ status: string; error_code: string | null; error_title: string | null }>('select status, error_code, error_title from deliveries where id = $1', [deliveryId])).rows[0]!;
    expect(d).toMatchObject({ status: 'failed', error_code: '131047', error_title: 'Re-engagement message' });
  });

  it('un delivered adelantado también se aplica', async () => {
    const c = await repos.contacts.upsertFromInbound('51900333445');
    await repos.messages.setStatusByWamid('wamid.sql.entregado', 'delivered');
    await repos.messages.add({ contactId: c.id, direction: 'out', wamid: 'wamid.sql.entregado', kind: 'text', body: 'hola', status: 'sent' });
    expect(await estadoDe('wamid.sql.entregado')).toBe('delivered');
  });

  it('volver a guardar no baja el estado ni quita un failed', async () => {
    const c = await repos.contacts.upsertFromInbound('51900333446');
    await repos.messages.add({ contactId: c.id, direction: 'out', wamid: 'wamid.sql.dup', kind: 'text', body: 'a', status: 'sent' });
    await repos.messages.setStatusByWamid('wamid.sql.dup', 'read');
    await repos.messages.add({ contactId: c.id, direction: 'out', wamid: 'wamid.sql.dup', kind: 'text', body: 'a', status: 'sent' });
    expect(await estadoDe('wamid.sql.dup')).toBe('read');
    await repos.messages.setStatusByWamid('wamid.sql.dup', 'failed');
    await repos.messages.add({ contactId: c.id, direction: 'out', wamid: 'wamid.sql.dup', kind: 'text', body: 'a', status: 'delivered' });
    expect(await estadoDe('wamid.sql.dup')).toBe('failed');
    // Sin estado nuevo se queda el que tenía; uno más alto sí entra.
    await repos.messages.add({ contactId: c.id, direction: 'out', wamid: 'wamid.sql.sube', kind: 'text', body: 'b', status: 'sent' });
    await repos.messages.add({ contactId: c.id, direction: 'out', wamid: 'wamid.sql.sube', kind: 'text', body: 'b', status: null });
    expect(await estadoDe('wamid.sql.sube')).toBe('sent');
    await repos.messages.add({ contactId: c.id, direction: 'out', wamid: 'wamid.sql.sube', kind: 'text', body: 'b', status: 'delivered' });
    expect(await estadoDe('wamid.sql.sube')).toBe('delivered');
  });

  it('un acuse repetido sobre una fila que ya lo tiene no queda apartado para otra', async () => {
    const c = await repos.contacts.upsertFromInbound('51900333447');
    await repos.messages.add({ contactId: c.id, direction: 'out', wamid: 'wamid.sql.rep', kind: 'text', body: 'a', status: 'delivered' });
    await repos.messages.setStatusByWamid('wamid.sql.rep', 'delivered');
    await repos.messages.setStatusByWamid('wamid.sql.rep', 'sent');
    expect(await estadoDe('wamid.sql.rep')).toBe('delivered');
  });
});
