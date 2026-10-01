/**
 * El SQL del superadministrador contra MySQL/MariaDB de verdad: el esquema
 * trae los valores por defecto de cuentas y codigos, y los codigos de
 * conexion se crean, se canjean sin colarse dos por el mismo ultimo uso, y
 * se anulan.
 *
 * (Con Postgres habia una migracion que ascendia a superadmin a la primera
 * cuenta admin de una instalacion vieja. En MySQL la base nace con el esquema
 * entero y la primera cuenta ya se crea superadmin: ver auth/routes.)
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from '../src/db/pool.js';
import { createRepos, type Repos } from '../src/db/repos.js';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';

let base: BaseDePrueba;
let pool: Pool;
let repos: Repos;

beforeAll(async () => {
  base = await baseDePrueba();
  pool = base.pool;
  repos = createRepos(pool);
});

afterAll(async () => {
  await base?.cerrar();
});

beforeEach(async () => {
  await base.vaciar();
});

describe('el esquema', () => {
  it('una cuenta sin rol nace operador y un codigo sin mas datos vale para todo, una vez', async () => {
    await pool.query(`insert into usuarios (id, usuario, nombre, clave) values ('aaaaaaaa-0000-0000-0000-000000000001', 'ope', 'Ope', 'x')`);
    expect((await repos.usuarios.porUsuario('ope'))).toMatchObject({ rol: 'operador', activo: true, sesionVersion: 1 });
    await pool.query(`insert into codigos_conexion (id, codigo, para, caduca_at) values ('aaaaaaaa-0000-0000-0000-000000000002', 'WA-EEEE-FFFF', 'Stoky', '2027-01-01 00:00:00')`);
    expect(await repos.codigosConexion.porCodigo('WA-EEEE-FFFF')).toMatchObject({ permisos: ['*'], usosMax: 1, usos: 0, estado: 'activo', canjeadoAt: null });
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

describe('las tiendas del dueño (migracion 031)', () => {
  const membresia = { plan: 'basico', nombre: 'Básico', limites: { iaTurnosMes: 2000, campanas: true, conectores: true, usuarios: 3 }, precioMes: 49, moneda: 'PEN', vencimiento: '2026-10-18T23:59:59.000Z', estado: 'activa' as const, contacto: null, aviso: null, pagos: [], actualizadoEn: '2026-09-18T12:00:00.000Z', actualizadoPor: 'ali' };

  it('guarda el parte de salud de la tienda y lo devuelve como objeto', async () => {
    const t = await repos.tiendas.crear({ slug: 'zapateria', nombre: 'Zapatería', membresia, tokenHash: 'h', tokenPrefijo: 'plt_abc' });
    expect(t.estado).toBeNull();
    const at = new Date('2026-09-18T12:05:00Z');
    await repos.tiendas.anotarEstado(t.id, { whatsapp: 'caido', mensajesHoy: 40, fallosIA: 2, entregasHoy: 9, version: '1.2.3' }, at);
    const leida = await repos.tiendas.porId(t.id);
    expect(leida!.estado).toEqual({ whatsapp: 'caido', mensajesHoy: 40, fallosIA: 2, entregasHoy: 9, version: '1.2.3' });
    expect(leida!.estadoAt?.toISOString()).toBe('2026-09-18T12:05:00.000Z');
    expect((await repos.tiendas.listar())[0]!.estado?.whatsapp).toBe('caido');
  });

  it('apunta los avisos por tienda y los borra con ella; la config es una fila por clave', async () => {
    const t = await repos.tiendas.crear({ slug: 'tienda-a', nombre: 'Tienda A', membresia, tokenHash: 'h', tokenPrefijo: 'plt_a' });
    expect(await repos.tiendas.avisos(t.id)).toEqual([]);
    await repos.tiendas.anotarAviso(t.id, 'vence7:2026-10-18', new Date('2026-10-11T13:00:00Z'));
    await repos.tiendas.anotarAviso(t.id, 'vence1:2026-10-18', new Date('2026-10-17T13:00:00Z'));
    const avisos = await repos.tiendas.avisos(t.id);
    expect(avisos.map((a) => a.tipo)).toEqual(['vence1:2026-10-18', 'vence7:2026-10-18']);
    expect(await repos.tiendas.config('cobro')).toBeNull();
    await repos.tiendas.guardarConfig('cobro', { activo: true, numero: '987 111 222', texto: 'Yape', qr: '' });
    await repos.tiendas.guardarConfig('cobro', { activo: true, numero: '987 111 333', texto: 'Yape', qr: '' });
    expect(await repos.tiendas.config<{ numero: string }>('cobro')).toMatchObject({ numero: '987 111 333' });
    await repos.tiendas.borrar(t.id);
    const { rows } = await pool.query<{ n: number }>('select count(*) as n from tiendas_avisos');
    expect(rows[0]!.n).toBe(0);
  });

  it('las capturas de pago: se crean pendientes, se listan sin la imagen, se leen con ella y se resuelven', async () => {
    const t = await repos.tiendas.crear({ slug: 'tienda-b', nombre: 'Tienda B', membresia, tokenHash: 'h', tokenPrefijo: 'plt_b' });
    const p = await repos.tiendas.crearPago({ tiendaId: t.id, meses: 2, monto: 98, moneda: 'PEN', nota: 'Op. 1', imagen: 'data:image/png;base64,AAAA' }, new Date('2026-09-18T12:00:00Z'));
    expect(p).toMatchObject({ meses: 2, monto: 98, estado: 'pendiente', imagen: 'data:image/png;base64,AAAA' });
    const lista = await repos.tiendas.pagos({ estado: 'pendiente' });
    expect(lista).toHaveLength(1);
    expect(lista[0]!.imagen).toBeNull();
    expect(lista[0]!.monto).toBe(98);
    expect((await repos.tiendas.pago(p.id))!.imagen).toBe('data:image/png;base64,AAAA');
    const r = await repos.tiendas.resolverPago(p.id, { estado: 'rechazado', motivo: 'No se ve', por: 'ali', at: new Date('2026-09-18T13:00:00Z') });
    expect(r).toMatchObject({ estado: 'rechazado', motivo: 'No se ve', resueltoPor: 'ali' });
    expect(await repos.tiendas.pagos({ tiendaId: t.id, estado: 'pendiente' })).toEqual([]);
    expect((await repos.tiendas.pagos({ tiendaId: t.id }))[0]!.estado).toBe('rechazado');
    expect(await repos.tiendas.pago(999)).toBeNull();
  });
});
