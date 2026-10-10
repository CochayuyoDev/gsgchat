/**
 * La migración 006 (el cliente que cambió su ubicación) contra MySQL/MariaDB
 * de verdad (tests/mysql.ts): las columnas existen y el repositorio las lee y
 * las escribe.
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
  for (const tabla of ['entregas_eventos', 'entregas']) await pool.query(`delete from ${tabla}`);
}, 300_000);

afterAll(async () => {
  await b?.cerrar();
});

describe('migración 006: el cambio de ubicación en el pedido', () => {
  it('está aplicada y crea sus columnas', async () => {
    const hechas = await pool.query<{ name: string }>('select name from schema_migrations order by name');
    expect(hechas.rows.map((r) => r.name)).toContain('006_cambio_ubicacion.sql');
    const cols = await pool.query<{ c: string }>(
      `select column_name as c from information_schema.columns where table_schema = database() and table_name = 'entregas' and column_name like 'ubicacion\\_%'`,
    );
    const nombres = cols.rows.map((r) => r.c);
    for (const c of ['ubicacion_cambio_pedido_at', 'ubicacion_cambiada_at', 'ubicacion_cambios', 'ubicacion_anterior_lat', 'ubicacion_anterior_lng']) expect(nombres).toContain(c);
  });

  it('un pedido nuevo empieza sin cambios; el repositorio guarda y lee la marca', async () => {
    const { entrega } = await repos.entregas.crearEntrega({ dia: '2026-10-10', referencia: 'CU-1', phone: '51987000101', nombre: 'Rosa', ubicacionEstado: 'recibida', lat: -12.12, lng: -77.03, confirmacionEstado: 'no_hace_falta', estado: 'pendiente' });
    expect(entrega).toMatchObject({ ubicacionCambios: 0, ubicacionCambiadaAt: null, ubicacionCambioPedidoAt: null, ubicacionAnteriorLat: null, ubicacionAnteriorLng: null });
    const pidio = new Date('2026-10-10T15:00:00Z');
    expect((await repos.entregas.actualizar(entrega.id, { ubicacionCambioPedidoAt: pidio }))?.ubicacionCambioPedidoAt?.toISOString()).toBe(pidio.toISOString());
    const cambio = new Date('2026-10-10T15:05:00Z');
    const act = await repos.entregas.registrarUbicacionAtomica(
      entrega.id,
      { ubicacionEstado: 'recibida', lat: -12.125, lng: -77.035, ubicacionCambiadaAt: cambio, ubicacionCambios: 1, ubicacionCambioPedidoAt: null, ubicacionAnteriorLat: -12.12, ubicacionAnteriorLng: -77.03 },
      null,
    );
    expect(act).toMatchObject({ ubicacionCambios: 1, ubicacionCambioPedidoAt: null, ubicacionAnteriorLat: -12.12, ubicacionAnteriorLng: -77.03, lat: -12.125 });
    expect(act!.ubicacionCambiadaAt!.toISOString()).toBe(cambio.toISOString());
  });
});
