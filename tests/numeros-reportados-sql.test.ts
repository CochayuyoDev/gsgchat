/**
 * La bandeja de números reportados en MySQL (migración 007): una fila por
 * tracking + error, se reabre si el error vuelve tras corregirlo, y lo
 * reportado sale una sola vez a la cola hacia GSG.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';
import { createRepos, type Repos } from '../src/db/repos.js';
import { reportarNumero } from '../src/entregas/reportados.js';

describe('números reportados en MySQL', () => {
  let b: BaseDePrueba;
  let repos: Repos;

  beforeAll(async () => {
    b = await baseDePrueba();
    repos = createRepos(b.pool);
  }, 600_000);
  afterAll(async () => {
    await b?.cerrar();
  });

  it('una vez por tracking + error, con su pedido guardado; corregido y reabierto', async () => {
    const n = { error: 'telefono_invalido' as const, dia: '2026-10-10', tracking: 'SQL-1', referencia: 'SQL-1', telefono: '12', pedido: { tracking: 'SQL-1', telefono: '12', cliente: 'Ana' } };
    const primero = await reportarNumero({ repos }, n);
    expect(primero).toMatchObject({ clave: 'SQL-1', error: 'telefono_invalido', estado: 'pendiente', telefono: '12', dia: '2026-10-10', veces: 1 });
    expect(primero!.pedido).toEqual({ tracking: 'SQL-1', telefono: '12', cliente: 'Ana' });
    expect(await reportarNumero({ repos }, n)).toBeNull();
    // Otro error del mismo tracking es otro reporte.
    expect(await reportarNumero({ repos }, { ...n, error: 'sin_whatsapp' })).toBeTruthy();
    // Solo se guarda: a GSG no se le encola nada.
    expect(await repos.rutas.reportesPendientes(50)).toHaveLength(0);

    expect(await repos.reportados!.listar({ estado: 'pendiente' })).toHaveLength(2);
    const hechos = await repos.reportados!.marcarCorregidos('SQL-1', { telefono: '987000001', por: 'GSG' }, new Date('2026-10-10T15:00:00Z'));
    expect(hechos).toHaveLength(2);
    expect(await repos.reportados!.listar({ estado: 'pendiente' })).toHaveLength(0);
    const corregido = (await repos.reportados!.listar({ estado: 'corregido', clave: 'SQL-1' }))[0]!;
    expect(corregido.corregidoAt?.toISOString()).toBe('2026-10-10T15:00:00.000Z');
    expect(corregido.correccion).toMatchObject({ telefono: '987000001' });

    const otraVez = await reportarNumero({ repos }, n);
    expect(otraVez).toMatchObject({ estado: 'pendiente', veces: 2, corregidoAt: null });
    expect(await repos.reportados!.listar({ clave: 'SQL-1' })).toHaveLength(2);
  });

  it('sin tracking, la clave es la referencia o el teléfono', async () => {
    const r = await reportarNumero({ repos }, { error: 'tracking_falta', dia: '2026-10-10', telefono: '987000009' });
    expect(r!.clave).toBe('tel:987000009');
    expect(r!.tracking).toBeNull();
  });
});
