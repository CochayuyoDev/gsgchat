/**
 * La pantalla de lineas: como van repartidos los clientes, cuanto se espera a
 * una linea caida y los ultimos cambios.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerLineasRoutes } from '../src/web/lineas-routes.js';
import type { RegistroClientes } from '../src/whatsapp/registro.js';
import type { RepartoDeLineas } from '../src/whatsapp/reparto-lineas.js';
import type { ServicioAjustes } from '../src/ajustes/generales.js';
import type { ServicioLineas } from '../src/whatsapp/lineas.js';

let app: FastifyInstance;
let sinReparto: FastifyInstance;
let espera = 30;
const CAIDA = new Date('2026-11-04T15:00:00Z');
const pedidos: Array<unknown> = [];

beforeAll(async () => {
  const comun = {
    lineas: {} as ServicioLineas,
    registro: { sinConexionDesde: (id: string) => (id === 'b' ? CAIDA : null) } as unknown as RegistroClientes,
    arrancarLinea: async () => undefined,
  };
  const reparto = {
    cargas: async () => [
      { id: 'a', etiqueta: 'wsp-ali', numero: '', posicion: 0, conectada: true, clientes: 12, nuevosHoy: 3, enviadosHoy: 8, cupoDiario: 200, pausada: false },
      { id: 'b', etiqueta: 'wsp-kevin', numero: '', posicion: 1, conectada: false, clientes: 9, nuevosHoy: 0, enviadosHoy: 0, cupoDiario: 50, pausada: false },
    ],
    elegir: async () => 'a',
    cambios: async (o: unknown) => {
      pedidos.push(o);
      return [];
    },
  } satisfies RepartoDeLineas;
  const ajustes = {
    esperaCambioLineaMin: () => espera,
    guardar: async (p: { lineas?: { esperaCambioMinutos: number | null } | null }) => {
      espera = p.lineas?.esperaCambioMinutos ?? espera;
    },
  } as unknown as ServicioAjustes;
  app = Fastify();
  await registerLineasRoutes(app, { ...comun, reparto, ajustes });
  await app.ready();
  sinReparto = Fastify();
  await registerLineasRoutes(sinReparto, comun);
  await sinReparto.ready();
});
afterAll(async () => {
  await app?.close();
  await sinReparto?.close();
});

describe('/admin/lineas/reparto', () => {
  it('da la carga de cada linea, desde cuando esta caida y la espera vigente', async () => {
    const r = await app.inject({ method: 'GET', url: '/admin/lineas/reparto' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.esperaCambioMinutos).toBe(30);
    expect(body.lineas[0]).toMatchObject({ etiqueta: 'wsp-ali', clientes: 12, nuevosHoy: 3, sinConexionDesde: null });
    expect(body.lineas[1]).toMatchObject({ etiqueta: 'wsp-kevin', conectada: false, sinConexionDesde: CAIDA.toISOString() });
  });

  it('filtra los cambios de un cliente', async () => {
    await app.inject({ method: 'GET', url: '/admin/lineas/reparto?contactId=c1' });
    expect(pedidos.at(-1)).toMatchObject({ contactId: 'c1' });
  });

  it('guarda la espera y rechaza lo que no tiene sentido, con palabras', async () => {
    const bien = await app.inject({ method: 'PATCH', url: '/admin/lineas/reparto', payload: { esperaCambioMinutos: 45 } });
    expect(bien.json()).toEqual({ ok: true, esperaCambioMinutos: 45 });
    for (const malo of [0, -5, 1441, 'mucho']) {
      const r = await app.inject({ method: 'PATCH', url: '/admin/lineas/reparto', payload: { esperaCambioMinutos: malo } });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toContain('1 a 1440');
    }
    expect(espera).toBe(45);
  });

  it('sin el reparto montado contesta 404 en vez de romperse', async () => {
    expect((await sinReparto.inject({ method: 'GET', url: '/admin/lineas/reparto' })).statusCode).toBe(404);
    expect((await sinReparto.inject({ method: 'PATCH', url: '/admin/lineas/reparto', payload: { esperaCambioMinutos: 10 } })).statusCode).toBe(404);
  });
});
