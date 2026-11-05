/**
 * La pantalla de lineas: como van repartidos los clientes y los ultimos cambios.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerLineasRoutes } from '../src/web/lineas-routes.js';
import type { RegistroClientes } from '../src/whatsapp/registro.js';
import type { RepartoDeLineas } from '../src/whatsapp/reparto-lineas.js';
import type { ServicioLineas } from '../src/whatsapp/lineas.js';

let app: FastifyInstance;
let sinReparto: FastifyInstance;
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
  app = Fastify();
  await registerLineasRoutes(app, { ...comun, reparto });
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
  it('da la carga de cada linea y desde cuando esta caida', async () => {
    const r = await app.inject({ method: 'GET', url: '/admin/lineas/reparto' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.lineas[0]).toMatchObject({ etiqueta: 'wsp-ali', clientes: 12, nuevosHoy: 3, sinConexionDesde: null });
    expect(body.lineas[1]).toMatchObject({ etiqueta: 'wsp-kevin', conectada: false, sinConexionDesde: CAIDA.toISOString() });
  });

  it('filtra los cambios de un cliente', async () => {
    await app.inject({ method: 'GET', url: '/admin/lineas/reparto?contactId=c1' });
    expect(pedidos.at(-1)).toMatchObject({ contactId: 'c1' });
  });

  it('sin el reparto montado contesta 404 en vez de romperse', async () => {
    expect((await sinReparto.inject({ method: 'GET', url: '/admin/lineas/reparto' })).statusCode).toBe(404);
  });
});
