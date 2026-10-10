/**
 * El cliente pregunta «¿dónde está mi pedido?» y se le contesta con la ruta
 * del motorizado (paradas, km y minutos) sacada de la base: lo que GSG empujó
 * por POST /api/v1/seguimiento o, si no, los datos propios de GSGchat. Nunca
 * se le pide nada a GSG ni se le pide al cliente su código de seguimiento.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { crearEscenarioEntregas, conPais, type EscenarioEntregas } from './escenario-entregas.js';
import type { CalcularRuta } from '../src/entregas/seguimiento-gsg.js';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';
import { crearSeguimientosRecibidosSql } from '../src/entregas/seguimiento-recibido.js';

const CLIENTE = '987650010';
const calcular = vi.fn<CalcularRuta>(async () => ({ km: 6.4, minutos: 31 }));

describe('¿dónde está mi pedido? con la ruta del motorizado', () => {
  let e: EscenarioEntregas;
  const llamadasDeRed: string[] = [];
  let fetchAntes: typeof fetch;

  beforeAll(async () => {
    e = await crearEscenarioEntregas({ calcularRuta: calcular });
    // Cualquier salida a la red despues de armar el escenario queda apuntada.
    fetchAntes = globalThis.fetch;
    const envuelto = fetchAntes;
    globalThis.fetch = (async (entrada: Parameters<typeof fetch>[0], init?: RequestInit) => {
      llamadasDeRed.push(typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : (entrada as Request).url);
      return envuelto(entrada, init);
    }) as typeof fetch;

    const dia = e.entregas.diaDeHoy();
    const repo = e.repos.entregas;
    const { motorizado } = await repo.crearMotorizado({ phone: '51911111111', nombre: 'Luis' });
    const base = e.ahora().getTime();
    // 20 paradas del mismo motorizado, asignadas en orden; las dos primeras ya entregadas.
    for (let i = 1; i <= 20; i++) {
      const telefono = i === 10 ? conPais(CLIENTE) : conPais(`9876500${String(i + 20).padStart(2, '0')}`);
      const { entrega } = await repo.crearEntrega({ dia, referencia: `R-${i}`, phone: telefono, nombre: `Cliente ${i}`, datosEnvio: { tracking: `TRK-${i}` }, ubicacionEstado: 'recibida', lat: -12 - i / 1000, lng: -77 - i / 1000, confirmacionEstado: 'no_hace_falta', estado: 'avisada' });
      await repo.actualizar(entrega.id, {
        motorizadoId: motorizado.id,
        motorizadoEstado: 'respondio',
        motorizadoEnviadoAt: new Date(base - (300 - i) * 60_000),
        ...(i <= 2 ? { estado: 'entregada' as const, entregadaAt: new Date(base - (10 - i) * 60_000) } : {}),
      });
    }
    await repo.actualizarMotorizado(motorizado.id, { ultimaLat: -12.002, ultimaLng: -77.002, ultimaPosicionAt: new Date(base - 3 * 60_000) });
  });

  afterAll(async () => {
    globalThis.fetch = fetchAntes;
    await e?.cerrar();
  });

  it('con datos propios: punto 2, su punto 10, 8 paradas y los km de Google', async () => {
    await e.contesta(CLIENTE, { texto: '¿dónde está mi pedido?' });
    const ultimo = e.textosA(CLIENTE).at(-1) ?? '';
    expect(ultimo).toContain('el motorizado está en el punto 2');
    expect(ultimo).toContain('tu entrega corresponde al punto 10');
    expect(ultimo).toContain('Quedan 8 paradas');
    expect(ultimo).toContain('6.4 km y 31 minutos');
    expect(ultimo).not.toMatch(/c[oó]digo de seguimiento/i);
  });

  it('el contexto de la IA trae el seguimiento y la orden de no pedir el código', async () => {
    const contexto = (await e.entregas.contextoDeCliente(conPais(CLIENTE))) ?? '';
    expect(contexto).toContain('punto 10');
    expect(contexto).toContain('nunca le pidas al cliente su código de seguimiento');
    const seguimientos = await e.entregas.seguimientoDeCliente(conPais(CLIENTE));
    expect(seguimientos).toHaveLength(1);
    expect(seguimientos[0]).toMatchObject({ referencia: 'R-10', tracking: 'TRK-10', seguimiento: { puntoActual: 2, puntoCliente: 10 } });
  });

  it('preguntar otra vez sin datos nuevos no vuelve a llamar a Google ni a nadie', async () => {
    const antes = calcular.mock.calls.length;
    const red = llamadasDeRed.length;
    for (let i = 0; i < 3; i++) {
      e.avanzar(1);
      await e.contesta(CLIENTE, { texto: '¿cuánto falta?' });
    }
    expect(calcular.mock.calls.length).toBe(antes);
    expect(llamadasDeRed.length).toBe(red);
  });

  it('GSG empuja su seguimiento y manda sobre los datos propios', async () => {
    const ahora = e.ahora().toISOString();
    const malo = await e.api.post('/api/v1/seguimiento', { tracking: 'TRK-10', puntoActual: 2, puntoCliente: 10, paradas: [] });
    expect(malo.status).toBe(422);
    const ajeno = await e.api.post('/api/v1/seguimiento', { tracking: 'NO-EXISTE', posicion: { lat: -12, lng: -77, actualizadaAt: ahora }, puntoActual: 1, puntoCliente: 2, paradas: [{ lat: -12, lng: -77, orden: 2 }] });
    expect(ajeno.status).toBe(404);
    const paradas = [3, 4, 5].map((orden) => ({ lat: -12 - orden / 100, lng: -77, orden }));
    const r = await e.api.post('/api/v1/seguimiento', { tracking: 'TRK-10', posicion: { lat: -12.02, lng: -77, actualizadaAt: ahora }, puntoActual: 2, puntoCliente: 10, secuenciaCompleta: true, paradas: [...paradas, { lat: -12.1, lng: -77, orden: 10 }] });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ ok: true, referencia: 'R-10', puntoActual: 2, puntoCliente: 10, paradas: 4 });
    calcular.mockResolvedValueOnce({ km: 9.9, minutos: 44 });
    await e.contesta(CLIENTE, { texto: '¿dónde está mi pedido?' });
    const ultimo = e.textosA(CLIENTE).at(-1) ?? '';
    expect(ultimo).toContain('punto 2');
    expect(ultimo).toContain('punto 10');
    expect(ultimo).toContain('9.9 km');
    expect((await e.entregas.seguimientoDeCliente(conPais(CLIENTE)))[0]?.seguimiento?.origen).toBe('gsg');
  });

  it('cero llamadas a GSG en todo el recorrido', () => {
    expect(e.llamadasAGsg).toEqual([]);
    expect(llamadasDeRed.filter((u) => !u.startsWith('https://routes.googleapis.com'))).toEqual([]);
  });
});

describe('el seguimiento empujado se guarda en MySQL', () => {
  let base: BaseDePrueba;
  beforeAll(async () => {
    base = await baseDePrueba();
  }, 600_000);
  afterAll(async () => {
    await base?.cerrar();
  });

  it('guarda el último de cada tracking y lo devuelve tal cual', async () => {
    const repo = crearSeguimientosRecibidosSql(base.pool);
    expect(await repo.leer('TRK-1')).toBeNull();
    const cuerpo = { tracking: 'TRK-1', puntoActual: 1, puntoCliente: 3, paradas: [{ lat: -12, lng: -77, orden: 2 }] };
    await repo.guardar({ tracking: 'TRK-1', cuerpo, recibidoAt: new Date('2026-10-10T10:00:00.000Z') });
    await repo.guardar({ tracking: 'TRK-1', cuerpo: { ...cuerpo, puntoActual: 2 }, recibidoAt: new Date('2026-10-10T10:05:00.000Z') });
    const leido = await repo.leer('TRK-1');
    expect(leido?.cuerpo).toMatchObject({ puntoActual: 2, puntoCliente: 3 });
    expect(leido?.recibidoAt.toISOString()).toBe('2026-10-10T10:05:00.000Z');
  });
});
