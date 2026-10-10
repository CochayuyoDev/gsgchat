/**
 * El SQL de la lista de envio automatico, contra MySQL/MariaDB de verdad
 * (tests/mysql.ts): el esquema, el "no se pisa" del mismo numero, el orden de la cola, el
 * patch parcial, los movimientos y las dos consultas nuevas del reparto.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

beforeEach(async () => {
  for (const tabla of ['envio_automatico_movimientos', 'envio_automatico', 'rutas_eventos', 'rutas_solicitudes', 'rutas_lotes']) await pool.query(`delete from ${tabla}`);
});

describe('la lista', () => {
  it('el mismo numero no se duplica: la segunda vez devuelve la que ya estaba', async () => {
    const a = await repos.envioAutomatico.agregar({ phone: '51987654321', nombre: 'Juan', que: 'ubicacion', hasta: 'ubicacion', origen: 'manual' });
    const b = await repos.envioAutomatico.agregar({ phone: '51987654321', nombre: 'Otro', que: 'mensaje', hasta: 'respuesta', origen: 'ia' });
    expect(a.nueva).toBe(true);
    expect(b.nueva).toBe(false);
    expect(b.entrada).toMatchObject({ id: a.entrada.id, nombre: 'Juan', origen: 'manual' });
    expect(await repos.envioAutomatico.listar()).toHaveLength(1);
  });

  it('la cola: primero el que lleva mas esperando; los pausados y los que no tocan, fuera', async () => {
    const ahora = new Date('2026-09-15T16:00:00Z');
    const luego = new Date(ahora.getTime() + 3 * 60 * 60_000);
    const { entrada: nuevo } = await repos.envioAutomatico.agregar({ phone: '51912000001', que: 'ubicacion', hasta: 'ubicacion', origen: 'manual' });
    const { entrada: viejo } = await repos.envioAutomatico.agregar({ phone: '51912000002', que: 'ubicacion', hasta: 'ubicacion', origen: 'manual', proximoEnvioAt: new Date(ahora.getTime() - 60_000) });
    const { entrada: pausado } = await repos.envioAutomatico.agregar({ phone: '51912000003', que: 'ubicacion', hasta: 'ubicacion', origen: 'manual' });
    await repos.envioAutomatico.agregar({ phone: '51912000004', que: 'ubicacion', hasta: 'ubicacion', origen: 'manual', proximoEnvioAt: luego });
    await repos.envioAutomatico.actualizar(pausado.id, { estado: 'pausado' });

    const cola = await repos.envioAutomatico.tocaEnviar(ahora, 10);
    expect(cola.map((e) => e.phone)).toEqual([viejo.phone, nuevo.phone]);
    expect(await repos.envioAutomatico.contar()).toEqual({ activos: 3, pausados: 1 });
  });

  it('actualizar solo toca lo que se manda, y quitar devuelve lo quitado', async () => {
    const { entrada } = await repos.envioAutomatico.agregar({ phone: '51987654321', nombre: 'Juan', que: 'ubicacion', hasta: 'ubicacion', origen: 'manual', maxEnvios: 2 });
    const cuando = new Date('2026-09-15T16:00:00Z');
    const e = await repos.envioAutomatico.actualizar(entrada.id, { enviados: 1, ultimoEnvioAt: cuando, proximoEnvioAt: new Date(cuando.getTime() + 60_000) });
    expect(e).toMatchObject({ enviados: 1, nombre: 'Juan', maxEnvios: 2 });
    expect(e!.ultimoEnvioAt!.toISOString()).toBe(cuando.toISOString());
    expect(await repos.envioAutomatico.actualizar(entrada.id, {})).toMatchObject({ id: entrada.id });
    const quitada = await repos.envioAutomatico.quitar(entrada.id);
    expect(quitada?.phone).toBe('51987654321');
    expect(await repos.envioAutomatico.quitar(entrada.id)).toBeNull();
    expect(await repos.envioAutomatico.porTelefono('51987654321')).toBeNull();
  });

  it('los movimientos se cuentan y se listan, los ultimos primero', async () => {
    const t0 = new Date('2026-09-15T14:00:00Z');
    await repos.envioAutomatico.anotarMovimiento({ phone: '51987654321', tipo: 'entro', motivo: 'x', origen: 'manual', at: t0 });
    await repos.envioAutomatico.anotarMovimiento({ phone: '51987654321', tipo: 'envio', motivo: 'y', origen: 'sistema', at: new Date(t0.getTime() + 1000) });
    await repos.envioAutomatico.anotarMovimiento({ phone: '51987654321', tipo: 'envio', motivo: 'z', origen: 'sistema', at: new Date(t0.getTime() + 2000) });
    const m = await repos.envioAutomatico.movimientos(10);
    expect(m.map((x) => x.motivo)).toEqual(['z', 'y', 'x']);
    expect(await repos.envioAutomatico.enviadosDesde(new Date(t0.getTime() + 500))).toBe(2);
  });
});

describe('las consultas nuevas del reparto', () => {
  it('las vivas de los lotes abiertos traen su lote; las de un lote terminado no', async () => {
    const abierto = await repos.rutas.crearLote({ nombre: 'Hoy' });
    const cerrado = await repos.rutas.crearLote({ nombre: 'Ayer' });
    await repos.rutas.cambiarEstadoLote(cerrado.id, 'terminado');
    await repos.rutas.agregarSolicitudes(abierto.id, [
      { telefonoCrudo: '1', phone: '51912000001', nombre: 'A' },
      { telefonoCrudo: '2', phone: '51912000002', nombre: 'B', estado: 'resuelto' },
    ]);
    await repos.rutas.agregarSolicitudes(cerrado.id, [{ telefonoCrudo: '3', phone: '51912000003', nombre: 'C' }]);
    const vivas = await repos.rutas.vivasEnLotesAbiertos(10);
    expect(vivas.map((s) => s.phone)).toEqual(['51912000001']);
    expect(vivas[0]!.lote).toMatchObject({ id: abierto.id, nombre: 'Hoy', estado: 'preparado' });
  });

  it('los eventos recientes llevan el cliente y el lote', async () => {
    const lote = await repos.rutas.crearLote({ nombre: 'Hoy' });
    const [s] = await repos.rutas.agregarSolicitudes(lote.id, [{ telefonoCrudo: '1', phone: '51912000001', nombre: 'A', referencia: 'P-1' }]);
    await repos.rutas.registrarEvento(s!.id, 'envio', 'primera solicitud');
    await repos.rutas.registrarEvento(s!.id, 'ubicacion', 'llego el pin');
    const ev = await repos.rutas.eventosRecientes(10);
    expect(ev.map((e) => e.tipo)).toEqual(['ubicacion', 'envio']);
    expect(ev[0]).toMatchObject({ phone: '51912000001', nombre: 'A', referencia: 'P-1', loteNombre: 'Hoy' });
  });
});
