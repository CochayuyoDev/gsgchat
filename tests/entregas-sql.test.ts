/**
 * El SQL de las entregas y los motorizados, contra Postgres de verdad (PGlite):
 * la migracion, el "no se pisa" de (dia, referencia) y del telefono del
 * motorizado, las colas (a quien toca pedir confirmacion, a quien toca
 * motorizado), el patch parcial con el JSON de descartados y la bitacora.
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

beforeAll(async () => {
  db = new PGlite();
  pool = asPool(db);
  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) await db.exec(await readFile(path.join(MIGRATIONS, file), 'utf8'));
  repos = createRepos(pool);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await db.exec('delete from entregas_eventos; delete from entregas; delete from motorizados;');
});

const nueva = (referencia: string, phone: string, extra: Partial<Parameters<Repos['entregas']['crearEntrega']>[0]> = {}) =>
  repos.entregas.crearEntrega({ dia: '2026-09-21', referencia, phone, nombre: `Cliente ${referencia}`, ubicacionEstado: 'pendiente', confirmacionEstado: 'pendiente', estado: 'pendiente', ...extra });

describe('motorizados', () => {
  it('el mismo telefono no se duplica y se actualiza por partes', async () => {
    const a = await repos.entregas.crearMotorizado({ phone: '51999000001', nombre: 'Carlos', placa: 'M1A-101', zona: 'Miraflores' });
    const b = await repos.entregas.crearMotorizado({ phone: '51999000001', nombre: 'Otro' });
    expect(a.nuevo).toBe(true);
    expect(b.nuevo).toBe(false);
    expect(b.motorizado.nombre).toBe('Carlos');
    const cuando = new Date('2026-09-21T15:00:00Z');
    const m = await repos.entregas.actualizarMotorizado(a.motorizado.id, { entregasHoy: 2, entregasHoyDia: '2026-09-21', ultimoEncargoAt: cuando, estado: 'descanso' });
    expect(m).toMatchObject({ entregasHoy: 2, entregasHoyDia: '2026-09-21', estado: 'descanso', placa: 'M1A-101' });
    expect(m!.ultimoEncargoAt!.toISOString()).toBe(cuando.toISOString());
    expect(await repos.entregas.motorizadoPorTelefono('51999000001')).toMatchObject({ id: a.motorizado.id });
    // Los de baja y en descanso van al final de la lista.
    await repos.entregas.crearMotorizado({ phone: '51999000002', nombre: 'Álvaro' });
    expect((await repos.entregas.listarMotorizados()).map((x) => x.nombre)).toEqual(['Álvaro', 'Carlos']);
    expect((await repos.entregas.quitarMotorizado(a.motorizado.id))?.phone).toBe('51999000001');
    expect(await repos.entregas.quitarMotorizado(a.motorizado.id)).toBeNull();
  });
});

describe('entregas', () => {
  it('(dia, referencia) no se duplica; la misma referencia otro dia es otra entrega', async () => {
    const a = await nueva('P-1', '51987000001');
    const b = await nueva('P-1', '51987000001');
    const c = await repos.entregas.crearEntrega({ dia: '2026-09-22', referencia: 'P-1', phone: '51987000001', ubicacionEstado: 'pendiente', confirmacionEstado: 'pendiente', estado: 'pendiente' });
    expect(a.nueva).toBe(true);
    expect(b.nueva).toBe(false);
    expect(b.entrega.id).toBe(a.entrega.id);
    expect(c.nueva).toBe(true);
    expect(a.entrega.dia).toBe('2026-09-21');
    expect(await repos.entregas.porDiaYReferencia('2026-09-21', 'P-1')).toMatchObject({ id: a.entrega.id });
  });

  it('la viva por telefono es la mas reciente que sigue viva; las terminadas no cuentan', async () => {
    const vieja = await nueva('P-1', '51987000001');
    await repos.entregas.actualizar(vieja.entrega.id, { estado: 'terminada' });
    const viva = await nueva('P-2', '51987000001', { estado: 'esperando_confirmacion' });
    expect((await repos.entregas.vivaPorTelefono('51987000001'))?.id).toBe(viva.entrega.id);
    await repos.entregas.actualizar(viva.entrega.id, { estado: 'cancelada' });
    expect(await repos.entregas.vivaPorTelefono('51987000001')).toBeNull();
  });

  it('actualizar toca solo lo mandado, incluido el JSON de descartados y las coordenadas', async () => {
    const { entrega } = await nueva('P-1', '51987000001');
    const cuando = new Date('2026-09-21T15:00:00Z');
    const e = await repos.entregas.actualizar(entrega.id, { lat: -12.1211, lng: -77.0301, ubicacionEstado: 'recibida', ubicacionAt: cuando, motorizadosDescartados: [3, 5], minutosAviso: 100, llegaAproxAt: cuando });
    expect(e).toMatchObject({ lat: -12.1211, lng: -77.0301, ubicacionEstado: 'recibida', motorizadosDescartados: [3, 5], minutosAviso: 100, nombre: 'Cliente P-1', confirmacionEstado: 'pendiente' });
    expect(e!.ubicacionAt!.toISOString()).toBe(cuando.toISOString());
    expect(await repos.entregas.actualizar(entrega.id, {})).toMatchObject({ id: entrega.id, motorizadosDescartados: [3, 5] });
    expect((await repos.entregas.entrega(entrega.id))?.motorizadosDescartados).toEqual([3, 5]);
  });

  it('la cola de confirmaciones: solo las que tienen ubicacion, en orden de espera, y no las que aun no tocan', async () => {
    const ahora = new Date('2026-09-21T16:00:00Z');
    const sinPin = await nueva('P-1', '51987000001');
    const lista = await nueva('P-2', '51987000002', { ubicacionEstado: 'recibida' });
    // Sin proximo_at cuenta desde que se creo; aqui se fija para no depender del reloj real.
    await repos.entregas.actualizar(lista.entrega.id, { confirmacionProximoAt: new Date(ahora.getTime() - 30_000) });
    const yaPedida = await nueva('P-3', '51987000003', { ubicacionEstado: 'recibida', estado: 'esperando_confirmacion' });
    await repos.entregas.actualizar(yaPedida.entrega.id, { confirmacionEstado: 'pedida', confirmacionProximoAt: new Date(ahora.getTime() - 60_000) });
    const todaviaNo = await nueva('P-4', '51987000004', { ubicacionEstado: 'recibida', estado: 'esperando_confirmacion' });
    await repos.entregas.actualizar(todaviaNo.entrega.id, { confirmacionEstado: 'pedida', confirmacionProximoAt: new Date(ahora.getTime() + 60 * 60_000) });
    const confirmada = await nueva('P-5', '51987000005', { ubicacionEstado: 'recibida', confirmacionEstado: 'confirmada', estado: 'lista' });

    const cola = await repos.entregas.tocaPedirConfirmacion(ahora, 10);
    expect(cola.map((e) => e.referencia)).toEqual(['P-3', 'P-2']);
    void sinPin;
    void confirmada;
  });

  it('la cola de motorizados: las listas y las que esperan a uno que no contesta', async () => {
    const ahora = new Date('2026-09-21T16:00:00Z');
    const lista = await nueva('P-1', '51987000001', { ubicacionEstado: 'recibida', confirmacionEstado: 'confirmada', estado: 'lista' });
    const esperando = await nueva('P-2', '51987000002', { ubicacionEstado: 'recibida', confirmacionEstado: 'confirmada', estado: 'esperando_motorizado' });
    const { motorizado } = await repos.entregas.crearMotorizado({ phone: '51999000001', nombre: 'Carlos' });
    await repos.entregas.actualizar(esperando.entrega.id, { motorizadoId: motorizado.id, motorizadoEstado: 'enviado', motorizadoEnviadoAt: new Date(ahora.getTime() - 20 * 60_000), motorizadoProximoAt: new Date(ahora.getTime() - 60_000) });
    const reciente = await nueva('P-3', '51987000003', { ubicacionEstado: 'recibida', confirmacionEstado: 'confirmada', estado: 'esperando_motorizado' });
    await repos.entregas.actualizar(reciente.entrega.id, { motorizadoId: motorizado.id, motorizadoEstado: 'enviado', motorizadoEnviadoAt: ahora, motorizadoProximoAt: new Date(ahora.getTime() + 10 * 60_000) });

    const cola = await repos.entregas.tocaMotorizado(ahora, 10);
    expect(cola.map((e) => e.referencia).sort()).toEqual(['P-1', 'P-2']);
    // Lo que Carlos tiene entre manos, la ultima primero.
    expect((await repos.entregas.enManosDeMotorizado(motorizado.id)).map((e) => e.referencia)).toEqual(['P-3', 'P-2']);
    void lista;
  });

  it('listar por dia, por estado y por texto; cifras por estado', async () => {
    await nueva('P-1', '51987000001', { estado: 'esperando_ubicacion' });
    await nueva('P-2', '51987000002', { nombre: 'Ana Quispe', estado: 'lista' });
    await nueva('P-3', '51987000003', { estado: 'lista' });
    expect((await repos.entregas.listar({ dia: '2026-09-21' })).map((e) => e.referencia)).toEqual(['P-1', 'P-2', 'P-3']);
    expect((await repos.entregas.listar({ dia: '2026-09-21', estado: 'lista' })).map((e) => e.referencia)).toEqual(['P-2', 'P-3']);
    expect((await repos.entregas.listar({ dia: '2026-09-21', q: 'quispe' })).map((e) => e.referencia)).toEqual(['P-2']);
    expect((await repos.entregas.listar({ dia: '2026-09-21', q: '987000003' })).map((e) => e.referencia)).toEqual(['P-3']);
    expect(await repos.entregas.cifras('2026-09-21')).toEqual({ esperando_ubicacion: 1, lista: 2 });
    // Sin dia: las vivas de cualquier dia.
    expect((await repos.entregas.listar({ estados: ['lista'] })).length).toBe(2);
  });

  it('la bitacora guarda el payload y sale con el cliente en los recientes', async () => {
    const { entrega } = await nueva('P-1', '51987000001');
    const cuando = new Date('2026-09-21T15:00:00Z');
    await repos.entregas.registrarEvento(entrega.id, 'ubicacion', 'pin recibido', { lat: -12.1, lng: -77 }, cuando);
    await repos.entregas.registrarEvento(entrega.id, 'confirmada', 'dijo que sí');
    const eventos = await repos.entregas.eventos(entrega.id);
    expect(eventos.map((e) => e.tipo)).toEqual(['ubicacion', 'confirmada']);
    expect(eventos[0]!.payload).toEqual({ lat: -12.1, lng: -77 });
    expect(eventos[0]!.createdAt.toISOString()).toBe(cuando.toISOString());
    const recientes = await repos.entregas.eventosRecientes(5);
    expect(recientes[0]).toMatchObject({ tipo: 'confirmada', referencia: 'P-1', phone: '51987000001', nombre: 'Cliente P-1' });
    // Borrar la entrega se lleva su bitacora (cascada).
    await repos.entregas.quitar(entrega.id);
    expect(await repos.entregas.eventos(entrega.id)).toEqual([]);
  });

  it('entregada: la hora, el como y el texto se guardan; la ultima posicion del motorizado tambien (migracion 027)', async () => {
    const en = new Date('2026-09-21T20:05:00Z');
    const { motorizado } = await repos.entregas.crearMotorizado({ phone: '51999000001', nombre: 'Carlos' });
    const { entrega } = await nueva('P-1', '51987000001', { ubicacionEstado: 'recibida', confirmacionEstado: 'confirmada', estado: 'avisada' });
    const act = await repos.entregas.actualizar(entrega.id, { estado: 'entregada', entregadaAt: en, entregadaComo: 'foto', entregadaRespuesta: '[foto]', cerradaPorDia: false });
    expect(act).toMatchObject({ estado: 'entregada', entregadaComo: 'foto', entregadaRespuesta: '[foto]', cerradaPorDia: false });
    expect(act?.entregadaAt?.toISOString()).toBe(en.toISOString());
    const m = await repos.entregas.actualizarMotorizado(motorizado.id, { ultimaLat: -12.1211, ultimaLng: -77.0301, ultimaPosicionAt: en });
    expect(m?.ultimaLat).toBeCloseTo(-12.1211, 6);
    expect(m?.ultimaLng).toBeCloseTo(-77.0301, 6);
    expect(m?.ultimaPosicionAt?.toISOString()).toBe(en.toISOString());
    // Entregada es final: ya no es viva ni sale en la cola de nadie.
    expect(await repos.entregas.vivaPorTelefono('51987000001')).toBeNull();
    expect((await repos.entregas.listar({ dia: '2026-09-21', estados: ['entregada'], limit: 10 })).map((e) => e.referencia)).toEqual(['P-1']);
  });

  it('las avisadas de un motorizado (la ultima primero) y las vivas de dias anteriores (para el cierre)', async () => {
    const ahora = new Date('2026-09-22T05:10:00Z');
    const { motorizado } = await repos.entregas.crearMotorizado({ phone: '51999000001', nombre: 'Carlos' });
    const a1 = await nueva('A-1', '51987000001', { ubicacionEstado: 'recibida', confirmacionEstado: 'confirmada', estado: 'avisada' });
    const a2 = await nueva('A-2', '51987000002', { ubicacionEstado: 'recibida', confirmacionEstado: 'confirmada', estado: 'avisada' });
    await repos.entregas.actualizar(a1.entrega.id, { motorizadoId: motorizado.id, motorizadoEstado: 'respondio', avisoEnviadoAt: new Date(ahora.getTime() - 60 * 60_000) });
    await repos.entregas.actualizar(a2.entrega.id, { motorizadoId: motorizado.id, motorizadoEstado: 'respondio', avisoEnviadoAt: new Date(ahora.getTime() - 10 * 60_000) });
    // Una entregada del mismo motorizado no cuenta como avisada.
    const a3 = await nueva('A-3', '51987000003', { ubicacionEstado: 'recibida', confirmacionEstado: 'confirmada', estado: 'entregada' });
    await repos.entregas.actualizar(a3.entrega.id, { motorizadoId: motorizado.id, motorizadoEstado: 'respondio', avisoEnviadoAt: ahora });
    expect((await repos.entregas.avisadasDeMotorizado(motorizado.id)).map((e) => e.referencia)).toEqual(['A-2', 'A-1']);

    // Las vivas de ayer (2026-09-21) salen para el cierre; las de hoy y las finales, no.
    await nueva('V-1', '51987000011', { estado: 'esperando_ubicacion' });
    await repos.entregas.crearEntrega({ dia: '2026-09-22', referencia: 'V-2', phone: '51987000012', ubicacionEstado: 'pendiente', confirmacionEstado: 'pendiente', estado: 'pendiente' });
    await nueva('V-3', '51987000013', { estado: 'cancelada' });
    const vivas = await repos.entregas.vivasDeDiasAnteriores('2026-09-22', 100);
    expect(vivas.map((e) => e.referencia).sort()).toEqual(['A-1', 'A-2', 'V-1']);
    expect((await repos.entregas.vivasDeDiasAnteriores('2026-09-22', 1)).length).toBe(1);
    expect(await repos.entregas.vivasDeDiasAnteriores('2026-09-21', 100)).toEqual([]);
    // Cerrada por el dia: el flag se guarda.
    const cerrada = await repos.entregas.actualizar(a1.entrega.id, { estado: 'incidencia', incidencia: 'dia_cerrado', cerradaPorDia: true });
    expect(cerrada?.cerradaPorDia).toBe(true);
  });

  it('segunda ronda (migracion 029): prioridad, segunda visita y cerca se guardan; los urgentes salen primero; las vivas de un motorizado', async () => {
    const normal = (await nueva('P-1', '51987000001', { ubicacionEstado: 'recibida', confirmacionEstado: 'confirmada', estado: 'lista' })).entrega;
    const urgente = (await nueva('P-2', '51987000002', { ubicacionEstado: 'recibida', confirmacionEstado: 'confirmada', estado: 'lista', prioridad: 'urgente' })).entrega;
    expect(normal.prioridad).toBe('normal');
    expect(urgente.prioridad).toBe('urgente');
    expect(normal.visitas).toBe(0);
    expect(normal.segundaVisita).toBe(false);
    const cola = await repos.entregas.tocaMotorizado(new Date(), 10);
    expect(cola.map((e) => e.referencia)).toEqual(['P-2', 'P-1']);

    const cuando = new Date('2026-09-21T16:00:00Z');
    const act = await repos.entregas.actualizar(normal.id, { visitas: 1, segundaVisita: true, segundaVisitaPedidaAt: cuando, segundaVisitaVenceAt: new Date(cuando.getTime() + 30 * 60_000), cercaAvisadoAt: cuando });
    expect(act).toMatchObject({ visitas: 1, segundaVisita: true, prioridad: 'normal' });
    expect(act!.segundaVisitaPedidaAt!.toISOString()).toBe(cuando.toISOString());
    expect(act!.cercaAvisadoAt!.toISOString()).toBe(cuando.toISOString());

    const m = (await repos.entregas.crearMotorizado({ phone: '51999000009', nombre: 'Ruta' })).motorizado;
    await repos.entregas.actualizar(normal.id, { motorizadoId: m.id, motorizadoEstado: 'respondio', estado: 'avisada', motorizadoEnviadoAt: new Date('2026-09-21T15:00:00Z') });
    await repos.entregas.actualizar(urgente.id, { motorizadoId: m.id, motorizadoEstado: 'enviado', estado: 'esperando_motorizado', motorizadoEnviadoAt: new Date('2026-09-21T15:30:00Z') });
    const otra = (await nueva('P-3', '51987000003', { ubicacionEstado: 'recibida', confirmacionEstado: 'confirmada', estado: 'entregada' })).entrega;
    await repos.entregas.actualizar(otra.id, { motorizadoId: m.id });
    const vivas = await repos.entregas.vivasDeMotorizado(m.id);
    // Las dos vivas (no la entregada), la urgente primero.
    expect(vivas.map((e) => e.referencia)).toEqual(['P-2', 'P-1']);
  });

  it('quitar un motorizado deja la entrega sin el (no revienta la clave foranea)', async () => {
    const { motorizado } = await repos.entregas.crearMotorizado({ phone: '51999000001', nombre: 'Carlos' });
    const { entrega } = await nueva('P-1', '51987000001');
    await repos.entregas.actualizar(entrega.id, { motorizadoId: motorizado.id, motorizadoEstado: 'enviado' });
    await repos.entregas.quitarMotorizado(motorizado.id);
    expect((await repos.entregas.entrega(entrega.id))?.motorizadoId).toBeNull();
  });
});
