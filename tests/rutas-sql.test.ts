/**
 * El SQL del modulo de rutas, contra Postgres de verdad (PGlite).
 *
 * Los dobles en memoria prueban las decisiones; esto prueba las consultas: el
 * `jsonb_object_agg` de las cifras por lote sobre cero filas, el orden de la
 * cola -que es lo que decide a quien le toca- y que los filtros de la bandeja
 * devuelven lo que dicen.
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
    const result = await db.query(text, params as never[], {
      parsers: { 20: (v: string) => Number.parseInt(v, 10) },
    });
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
  await db.exec('delete from rutas_reportes; delete from rutas_eventos; delete from rutas_solicitudes; delete from rutas_lotes;');
});

describe('lotes y solicitudes', () => {
  it('un lote recien creado cuenta cero sin romperse', async () => {
    await repos.rutas.crearLote({ nombre: 'Vacio' });
    const [lote] = await repos.rutas.listarLotes(10, 0);
    expect(lote).toMatchObject({ nombre: 'Vacio', total: 0, cifras: {} });
  });

  it('guarda las solicitudes con su incidencia y las cuenta por estado', async () => {
    const lote = await repos.rutas.crearLote({ nombre: 'Reparto' });
    await repos.rutas.agregarSolicitudes(lote.id, [
      { telefonoCrudo: '987654321', phone: '51987654321', referencia: 'P-1' },
      {
        telefonoCrudo: '98765432',
        phone: null,
        referencia: 'P-2',
        estado: 'incidencia',
        incidencia: 'numero_corto',
        incidenciaDetalle: 'falta 1 digito',
        requiereHumano: true,
      },
    ]);

    expect(await repos.rutas.cifrasPorEstado(lote.id)).toEqual({ pendiente: 1, incidencia: 1 });
    expect(await repos.rutas.cifrasPorIncidencia(lote.id)).toEqual({ numero_corto: 1 });

    const [conCifras] = await repos.rutas.listarLotes(10, 0);
    expect(conCifras?.total).toBe(2);
    expect(conCifras?.cifras).toMatchObject({ pendiente: 1, incidencia: 1 });
  });

  it('la cola solo saca lo de los lotes en marcha y en orden de espera', async () => {
    const parado = await repos.rutas.crearLote({ nombre: 'Parado' });
    const enMarcha = await repos.rutas.crearLote({ nombre: 'En marcha' });
    await repos.rutas.cambiarEstadoLote(enMarcha.id, 'enviando');

    await repos.rutas.agregarSolicitudes(parado.id, [
      { telefonoCrudo: '911111111', phone: '51911111111' },
    ]);
    const [primera, segunda, sinTelefono] = await repos.rutas.agregarSolicitudes(enMarcha.id, [
      { telefonoCrudo: '922222222', phone: '51922222222' },
      { telefonoCrudo: '933333333', phone: '51933333333' },
      { telefonoCrudo: 'nada', phone: null, estado: 'incidencia' },
    ]);

    // La segunda espera desde hace mas: le toca antes.
    await repos.rutas.actualizarSolicitud(primera!.id, {
      proximoIntentoAt: new Date('2026-03-10T12:00:00Z'),
    });
    await repos.rutas.actualizarSolicitud(segunda!.id, {
      proximoIntentoAt: new Date('2026-03-10T11:00:00Z'),
    });

    const cola = await repos.rutas.tocaIntentar(new Date('2026-03-10T13:00:00Z'), 10);

    expect(cola.map((s) => s.id)).toEqual([segunda!.id, primera!.id]);
    expect(cola.some((s) => s.id === sinTelefono!.id)).toBe(false);
  });

  it('lo que todavia no vence no sale en la cola', async () => {
    const lote = await repos.rutas.crearLote({ nombre: 'Reparto' });
    await repos.rutas.cambiarEstadoLote(lote.id, 'enviando');
    const [solicitud] = await repos.rutas.agregarSolicitudes(lote.id, [
      { telefonoCrudo: '922222222', phone: '51922222222' },
    ]);
    await repos.rutas.actualizarSolicitud(solicitud!.id, {
      proximoIntentoAt: new Date('2026-03-10T18:00:00Z'),
    });

    expect(await repos.rutas.tocaIntentar(new Date('2026-03-10T13:00:00Z'), 10)).toHaveLength(0);
  });

  it('la bandeja ensena primero lo que espera a una persona', async () => {
    const lote = await repos.rutas.crearLote({ nombre: 'Reparto' });
    const [normal, urgente] = await repos.rutas.agregarSolicitudes(lote.id, [
      { telefonoCrudo: '922222222', phone: '51922222222' },
      { telefonoCrudo: '933333333', phone: '51933333333' },
    ]);
    await repos.rutas.actualizarSolicitud(urgente!.id, {
      estado: 'supervision',
      requiereHumano: true,
      incidencia: 'numero_equivocado',
    });

    const lista = await repos.rutas.listarSolicitudes({ loteId: lote.id, limit: 10, offset: 0 });
    expect(lista[0]?.id).toBe(urgente!.id);
    expect(lista[1]?.id).toBe(normal!.id);

    const soloHumano = await repos.rutas.listarSolicitudes({
      requiereHumano: true,
      limit: 10,
      offset: 0,
    });
    expect(soloHumano).toHaveLength(1);
    expect(await repos.rutas.contarSolicitudes({ incidencia: 'numero_equivocado' })).toBe(1);
  });

  it('busca por telefono, nombre o referencia', async () => {
    const lote = await repos.rutas.crearLote({ nombre: 'Reparto' });
    await repos.rutas.agregarSolicitudes(lote.id, [
      { telefonoCrudo: '922222222', phone: '51922222222', nombre: 'Ana Ruiz', referencia: 'P-77' },
      { telefonoCrudo: '933333333', phone: '51933333333', nombre: 'Luis Paz', referencia: 'P-88' },
    ]);

    expect(await repos.rutas.listarSolicitudes({ q: 'ruiz', limit: 10, offset: 0 })).toHaveLength(1);
    expect(await repos.rutas.listarSolicitudes({ q: 'P-88', limit: 10, offset: 0 })).toHaveLength(1);
    expect(await repos.rutas.listarSolicitudes({ q: '9333', limit: 10, offset: 0 })).toHaveLength(1);
  });

  it('borrar el lote se lleva sus solicitudes, eventos y reportes', async () => {
    const lote = await repos.rutas.crearLote({ nombre: 'Reparto' });
    const [solicitud] = await repos.rutas.agregarSolicitudes(lote.id, [
      { telefonoCrudo: '922222222', phone: '51922222222' },
    ]);
    await repos.rutas.registrarEvento(solicitud!.id, 'envio', 'primera solicitud');
    await repos.rutas.encolarReporte({ solicitudId: solicitud!.id, loteId: lote.id, tipo: 'ubicacion', payload: {} });

    await repos.rutas.borrarLote(lote.id);

    expect(await repos.rutas.contarSolicitudes({})).toBe(0);
    expect(await repos.rutas.eventos(solicitud!.id)).toHaveLength(0);
    expect((await repos.rutas.cifrasReportes()).pendiente).toBe(0);
  });
});

describe('bitacora y cola de reportes', () => {
  it('guarda los eventos en orden con su payload', async () => {
    const lote = await repos.rutas.crearLote({ nombre: 'Reparto' });
    const [solicitud] = await repos.rutas.agregarSolicitudes(lote.id, [
      { telefonoCrudo: '922222222', phone: '51922222222' },
    ]);

    await repos.rutas.registrarEvento(solicitud!.id, 'envio', 'primera solicitud', { paso: 'solicitud' });
    await repos.rutas.registrarEvento(solicitud!.id, 'respuesta', 'contesto: "ahorita"');

    const eventos = await repos.rutas.eventos(solicitud!.id);
    expect(eventos.map((e) => e.tipo)).toEqual(['envio', 'respuesta']);
    expect(eventos[0]?.payload).toMatchObject({ paso: 'solicitud' });
  });

  it('la cola se marca enviada con el id de GSG', async () => {
    const reporte = await repos.rutas.encolarReporte({ tipo: 'resumen', payload: { total: 3 } });
    expect((await repos.rutas.reportesPendientes(10))).toHaveLength(1);

    await repos.rutas.marcarReporte(reporte.id, 'enviado', { externoId: 'GSG-1' });

    expect(await repos.rutas.reportesPendientes(10)).toHaveLength(0);
    expect(await repos.rutas.cifrasReportes()).toMatchObject({ enviado: 1, pendiente: 0 });
  });

  it('un fallo deja el error escrito y cuenta el intento', async () => {
    const reporte = await repos.rutas.encolarReporte({ tipo: 'incidencia', payload: {} });
    await repos.rutas.marcarReporte(reporte.id, 'pendiente', { error: 'GSG no responde' });

    const [pendiente] = await repos.rutas.reportesPendientes(10);
    expect(pendiente).toMatchObject({ intentos: 1, ultimoError: 'GSG no responde' });
  });
});
