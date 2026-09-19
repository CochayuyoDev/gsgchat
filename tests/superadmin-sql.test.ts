/**
 * El SQL del superadministrador contra Postgres de verdad (PGlite): la
 * migracion asciende a la primera cuenta admin (y solo una vez), y los
 * codigos de conexion se crean, se canjean sin colarse dos por el mismo
 * ultimo uso, y se anulan.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from '../src/db/pool.js';
import { createRepos, type Repos } from '../src/db/repos.js';

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');

function asPool(db: PGlite): Pool {
  const query = async (text: string, params?: unknown[]) => {
    const result = await db.query(text, params as never[], { parsers: { 20: (v: string) => Number.parseInt(v, 10) } });
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  };
  const client = { query, release: () => undefined };
  return { query, connect: async () => client, end: async () => db.close() } as unknown as Pool;
}

let db: PGlite;
let pool: Pool;
let repos: Repos;
let migracionSuper = '';

beforeAll(async () => {
  db = new PGlite();
  pool = asPool(db);
  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) await db.exec(await readFile(path.join(MIGRATIONS, file), 'utf8'));
  migracionSuper = await readFile(path.join(MIGRATIONS, '023_superadmin_y_codigos.sql'), 'utf8');
  repos = createRepos(pool);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.exec('delete from codigos_conexion; delete from tiendas; delete from usuarios;');
});

describe('la migracion', () => {
  it('asciende a superadmin a la primera cuenta admin, una sola vez', async () => {
    await db.exec(`insert into usuarios (usuario, nombre, clave, rol, created_at) values ('ali', 'Ali', 'x', 'admin', '2026-09-01'), ('rosa', 'Rosa', 'x', 'admin', '2026-09-05'), ('ope', 'Ope', 'x', 'operador', '2026-08-01')`);
    await db.exec(migracionSuper);
    const roles = async () => Object.fromEntries((await repos.usuarios.listar()).map((u) => [u.usuario, u.rol]));
    expect(await roles()).toEqual({ ali: 'superadmin', rosa: 'admin', ope: 'operador' });
    // Otra vez (la migracion es idempotente): nadie mas sube.
    await db.exec(migracionSuper);
    expect(await roles()).toEqual({ ali: 'superadmin', rosa: 'admin', ope: 'operador' });
  });
});

describe('codigos de conexion', () => {
  it('se crean, se listan del mas nuevo al mas viejo, se canjean con tope de usos y se anulan', async () => {
    const c = await repos.codigosConexion.crear({ codigo: 'WA-AAAA-BBBB', para: 'Stoky', permisos: ['*'], caducaAt: new Date('2027-01-01T00:00:00Z'), usosMax: 2, creadoPor: 'Ali' });
    expect(c).toMatchObject({ codigo: 'WA-AAAA-BBBB', para: 'Stoky', permisos: ['*'], usos: 0, usosMax: 2, estado: 'activo' });
    await repos.codigosConexion.crear({ codigo: 'WA-CCCC-DDDD', para: 'Otro', permisos: ['estado:leer'], caducaAt: new Date('2027-01-01T00:00:00Z'), usosMax: 1, creadoPor: null });
    expect((await repos.codigosConexion.listar()).map((x) => x.codigo)).toEqual(['WA-CCCC-DDDD', 'WA-AAAA-BBBB']);
    expect((await repos.codigosConexion.porCodigo('WA-CCCC-DDDD'))!.permisos).toEqual(['estado:leer']);

    const ahora = new Date('2026-09-18T12:00:00Z');
    const uno = await repos.codigosConexion.canjear(c.id, { por: 'Stoky', desde: '127.0.0.1', claveId: '11111111-1111-1111-1111-111111111111', ahora });
    expect(uno).toMatchObject({ usos: 1, canjeadoPor: 'Stoky', canjeadoDesde: '127.0.0.1' });
    // Dos a la vez por el ultimo uso: solo uno pasa.
    const [a, b] = await Promise.all([
      repos.codigosConexion.canjear(c.id, { por: 'A', desde: '1.1.1.1', claveId: '22222222-2222-2222-2222-222222222222', ahora }),
      repos.codigosConexion.canjear(c.id, { por: 'B', desde: '2.2.2.2', claveId: '33333333-3333-3333-3333-333333333333', ahora }),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect((await repos.codigosConexion.porId(c.id))!.usos).toBe(2);
    // Caducado: no se canjea aunque queden usos.
    const d = await repos.codigosConexion.porCodigo('WA-CCCC-DDDD');
    expect(await repos.codigosConexion.canjear(d!.id, { por: 'x', desde: 'x', claveId: '44444444-4444-4444-4444-444444444444', ahora: new Date('2027-02-01T00:00:00Z') })).toBeNull();
    expect(await repos.codigosConexion.anular(d!.id)).toBe(true);
    expect(await repos.codigosConexion.anular(d!.id)).toBe(false);
    expect((await repos.codigosConexion.porId(d!.id))!.estado).toBe('anulado');
  });
});

describe('tiendas', () => {
  it('se crean con su membresia en JSON, se listan por nombre, se actualizan por partes y anotan la consulta', async () => {
    const membresia = { plan: 'basico', nombre: 'Básico', limites: { iaTurnosMes: 2000, campanas: false, conectores: true, usuarios: 3 }, precioMes: 49, moneda: 'PEN', vencimiento: '2026-10-18T23:59:59.000Z', estado: 'activa' as const, contacto: null, aviso: null, pagos: [], actualizadoEn: '2026-09-18T12:00:00.000Z', actualizadoPor: 'Ali' };
    const b = await repos.tiendas.crear({ slug: 'bodega-b', nombre: 'Bodega B', membresia, tokenHash: 'h2', tokenPrefijo: 'plt_bbbbbb', creadoPor: 'Ali' });
    const a = await repos.tiendas.crear({ slug: 'almacen-a', nombre: 'almacén A', url: 'http://a.local', contacto: 'Rosa', membresia, tokenHash: 'h1', tokenPrefijo: 'plt_aaaaaa', creadoPor: 'Ali' });
    expect(a).toMatchObject({ slug: 'almacen-a', membresia: { plan: 'basico', limites: { usuarios: 3 } }, ultimaConsultaAt: null });
    expect((await repos.tiendas.listar()).map((t) => t.slug)).toEqual(['almacen-a', 'bodega-b']);
    expect((await repos.tiendas.porSlug('bodega-b'))!.id).toBe(b.id);
    const n = await repos.tiendas.actualizar(a.id, { nombre: 'Almacén A2', membresia: { ...membresia, estado: 'suspendida' }, tokenHash: 'h3', tokenPrefijo: 'plt_cccccc' });
    expect(n).toMatchObject({ nombre: 'Almacén A2', url: 'http://a.local', membresia: { estado: 'suspendida' }, tokenHash: 'h3' });
    await repos.tiendas.anotarConsulta(a.id, new Date('2026-09-18T12:05:00Z'), '10.0.0.7');
    const c = await repos.tiendas.porId(a.id);
    expect(c!.ultimaConsultaAt!.toISOString()).toBe('2026-09-18T12:05:00.000Z');
    expect(c!.ultimaConsultaIp).toBe('10.0.0.7');
    expect(await repos.tiendas.borrar(b.id)).toBe(true);
    expect(await repos.tiendas.borrar(b.id)).toBe(false);
    expect(await repos.tiendas.listar()).toHaveLength(1);
  });
});
