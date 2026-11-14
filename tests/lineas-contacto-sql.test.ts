/**
 * La asignacion de lineas contra MySQL/MariaDB de verdad: dos envios a la vez no
 * dejan a un cliente en dos lineas, el historial viejo no mueve a nadie, el
 * reparto cuenta bien y la migracion respeta a los clientes de antes.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRepos, type Repos } from '../src/db/repos.js';
import { ID_LINEA_PRINCIPAL } from '../src/whatsapp/lineas.js';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';

let b: BaseDePrueba;
let repos: Repos;
const OTRA = '00000000-0000-0000-0000-0000000000aa';
const TERCERA = '00000000-0000-0000-0000-0000000000bb';
const HOY = new Date('2026-11-04T15:00:00Z');

beforeAll(async () => {
  b = await baseDePrueba();
  repos = createRepos(b.pool);
});
afterAll(async () => {
  await b?.cerrar();
});
beforeEach(async () => {
  await b.vaciar();
  await b.pool.query(`insert into whatsapp_numbers (id, label, provider, is_primary, position) values (?, 'Principal', 'local', 1, 0), (?, 'wsp-ali', 'local', 0, 1), (?, 'wsp-kevin', 'local', 0, 2)`, [ID_LINEA_PRINCIPAL, OTRA, TERCERA]);
});

async function contacto(): Promise<string> {
  const phone = `5191${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  return (await repos.contacts.upsertFromInbound(phone)).id;
}

describe('asignar y cambiar la linea de un cliente', () => {
  it('veinte envios simultaneos dejan al cliente en una sola linea y un solo registro', async () => {
    const id = await contacto();
    const vigentes = await Promise.all(Array.from({ length: 20 }, (_, i) => repos.lineasContacto.fijarSiNoTiene(id, i % 2 ? OTRA : TERCERA, HOY)));
    expect(new Set(vigentes).size).toBe(1);
    const { rows } = await b.pool.query<{ n: number }>('select count(*) as n from contacto_linea_cambios where contact_id = ?', [id]);
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it('un cambio que parte de una linea que ya no es la suya no hace nada', async () => {
    const id = await contacto();
    await repos.lineasContacto.fijarSiNoTiene(id, OTRA, HOY);
    expect(await repos.lineasContacto.cambiar(id, TERCERA, ID_LINEA_PRINCIPAL, 'linea_caida', HOY)).toBe(OTRA);
    expect(await repos.lineasContacto.cambios({ contactId: id })).toHaveLength(0);
  });

  it('el registro conserva la etiqueta aunque despues quiten la linea', async () => {
    const id = await contacto();
    await repos.lineasContacto.fijarSiNoTiene(id, OTRA, HOY);
    expect(await repos.lineasContacto.cambiar(id, OTRA, TERCERA, 'linea_caida', HOY)).toBe(TERCERA);
    await b.pool.query('delete from whatsapp_numbers where id = ?', [OTRA]);
    const [cambio] = await repos.lineasContacto.cambios({ contactId: id });
    expect(cambio).toMatchObject({ desdeEtiqueta: 'wsp-ali', aEtiqueta: 'wsp-kevin', motivo: 'linea_caida', aLineaId: TERCERA });
    expect(cambio!.createdAt.getTime()).toBe(HOY.getTime());
  });

  it('el primer contacto no sale en los cambios, y borrar al cliente borra su registro', async () => {
    const id = await contacto();
    await repos.lineasContacto.fijarSiNoTiene(id, OTRA, HOY);
    expect(await repos.lineasContacto.cambios()).toHaveLength(0);
    await b.pool.query('delete from contacts where id = ?', [id]);
    const { rows } = await b.pool.query<{ n: number }>('select count(*) as n from contacto_linea_cambios');
    expect(Number(rows[0]!.n)).toBe(0);
  });
});

describe('lo que hace cada mensaje guardado', () => {
  const entrante = (contactId: string, lineaId: string, createdAt: Date, extra = {}) =>
    repos.messages.add({ contactId, direction: 'in', wamid: randomUUID(), kind: 'text', body: 'hola', lineaId, createdAt, ...extra });

  it('si el cliente escribe por otra linea se le sigue por esa, y queda el motivo', async () => {
    const id = await contacto();
    await repos.lineasContacto.fijarSiNoTiene(id, OTRA, HOY);
    await entrante(id, TERCERA, new Date(HOY.getTime() + 60_000));
    expect(await repos.messages.lineaDeLaConversacion(id)).toBe(TERCERA);
    expect(await repos.lineasContacto.cambios({ contactId: id })).toMatchObject([{ desdeLineaId: OTRA, aLineaId: TERCERA, motivo: 'cliente_escribio' }]);
  });

  it('el historial viejo de otra linea no le cambia la suya', async () => {
    const id = await contacto();
    await repos.lineasContacto.fijarSiNoTiene(id, OTRA, HOY);
    await entrante(id, TERCERA, new Date(HOY.getTime() - 30 * 24 * 3600_000), { payload: { historial: true } });
    expect(await repos.messages.lineaDeLaConversacion(id)).toBe(OTRA);
  });

  it('un mensaje por su misma linea no toca nada ni deja registro', async () => {
    const id = await contacto();
    await repos.lineasContacto.fijarSiNoTiene(id, OTRA, HOY);
    await entrante(id, OTRA, new Date(HOY.getTime() + 60_000));
    const { rows } = await b.pool.query<{ n: number }>('select count(*) as n from contacto_linea_cambios where contact_id = ?', [id]);
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it('lo que el sistema manda con la linea ya decidida no mueve al cliente', async () => {
    const id = await contacto();
    await repos.lineasContacto.fijarSiNoTiene(id, OTRA, HOY);
    await repos.messages.add({ contactId: id, direction: 'out', wamid: randomUUID(), kind: 'text', body: 'reintento', lineaId: TERCERA, createdAt: new Date(HOY.getTime() + 60_000), conservarLinea: true });
    expect(await repos.messages.lineaDeLaConversacion(id)).toBe(OTRA);
  });

  it('la linea se recuerda aunque el chat ya se haya borrado', async () => {
    const id = await contacto();
    await entrante(id, TERCERA, HOY);
    await b.pool.query('delete from messages where contact_id = ?', [id]);
    expect(await repos.messages.lineaDeLaConversacion(id)).toBe(TERCERA);
  });
});

describe('el reparto', () => {
  it('cuenta clientes y nuevos de hoy por linea, sin los grupos', async () => {
    const ayer = new Date(HOY.getTime() - 24 * 3600_000);
    await repos.lineasContacto.fijarSiNoTiene(await contacto(), OTRA, ayer);
    await repos.lineasContacto.fijarSiNoTiene(await contacto(), OTRA, HOY);
    await repos.lineasContacto.fijarSiNoTiene(await contacto(), TERCERA, HOY);
    const grupo = await contacto();
    await repos.lineasContacto.fijarSiNoTiene(grupo, TERCERA, HOY);
    await b.pool.query(`update contacts set tipo = 'grupo' where id = ?`, [grupo]);
    await contacto();
    const carga = await repos.lineasContacto.carga(new Date(HOY.getTime() - 3600_000));
    expect(carga.find((c) => c.lineaId === OTRA)).toEqual({ lineaId: OTRA, clientes: 2, nuevos: 1 });
    expect(carga.find((c) => c.lineaId === TERCERA)).toEqual({ lineaId: TERCERA, clientes: 1, nuevos: 1 });
    expect(carga).toHaveLength(2);
  });
});

describe('la migracion 018 con los clientes de antes', () => {
  const sql = readFileSync(new URL('../db/migrations/018_reparto_de_lineas.sql', import.meta.url), 'utf8');
  const relleno = sql.slice(sql.indexOf('update contacts c')).split(/;\s*(?:\r?\n|$)/).map((s) => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean);

  it('cada cliente sigue por donde se le venia escribiendo, y no cuenta como nuevo de hoy', async () => {
    const hace = new Date(HOY.getTime() - 10 * 24 * 3600_000);
    const conLinea = await contacto();
    const sinLinea = await contacto();
    const sinContacto = await contacto();
    await b.pool.query('update contacts set whatsapp_number_id = null, linea_asignada_at = null, last_inbound_at = null, created_at = ?', [hace]);
    await repos.messages.add({ contactId: conLinea, direction: 'out', wamid: randomUUID(), kind: 'text', body: 'x', lineaId: OTRA, createdAt: hace, conservarLinea: true });
    await repos.messages.add({ contactId: sinLinea, direction: 'in', wamid: randomUUID(), kind: 'text', body: 'x', createdAt: hace });

    expect(relleno).toHaveLength(3);
    for (const s of relleno) await b.pool.query(s);

    const leer = async (id: string) => (await b.pool.query<{ whatsapp_number_id: string | null; linea_asignada_at: Date | null }>('select whatsapp_number_id, linea_asignada_at from contacts where id = ?', [id])).rows[0]!;
    expect((await leer(conLinea)).whatsapp_number_id).toBe(OTRA);
    expect((await leer(sinLinea)).whatsapp_number_id).toBe(ID_LINEA_PRINCIPAL);
    // Nunca se le escribio: sigue sin linea y le tocara la del reparto.
    expect((await leer(sinContacto)).whatsapp_number_id).toBeNull();
    expect((await leer(conLinea)).linea_asignada_at!.getTime()).toBe(hace.getTime());
    expect(await repos.lineasContacto.cambios()).toHaveLength(0);
  });
});
