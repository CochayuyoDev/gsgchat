/**
 * La administracion de lineas desde /setup: alta con tope de ocho, renombrar,
 * conectar solo lineas locales, y quitar una sin tocar a las otras.
 */

import { randomBytes } from 'node:crypto';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';
import { crearServicioLineas, ID_LINEA_PRINCIPAL, type ServicioLineas } from '../src/whatsapp/lineas.js';
import { crearRegistroClientes } from '../src/whatsapp/registro.js';
import { crearSesionLocal } from '../src/whatsapp/local/session.js';
import { registerLineasRoutes } from '../src/web/lineas-routes.js';
import type { WhatsAppClient } from '../src/whatsapp/client.js';

let b: BaseDePrueba;
let app: FastifyInstance;
let lineas: ServicioLineas;
const arrancadas: string[] = [];

beforeAll(async () => {
  b = await baseDePrueba();
  lineas = crearServicioLineas(b.pool, randomBytes(32), 'prueba_rutas');
  const registro = crearRegistroClientes({
    lineas,
    principal: { cliente: { conectado: () => true } as unknown as WhatsAppClient, sesion: crearSesionLocal() },
    authDir: path.join('x', 'auth'),
  });
  app = Fastify();
  await registerLineasRoutes(app, { lineas, registro, arrancarLinea: async (id) => { arrancadas.push(id); } });
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  await b?.cerrar();
});

const json = (r: { json: () => unknown }) => r.json() as Record<string, any>;

describe('rutas de lineas', () => {
  it('lista la principal y crea, renombra y quita una linea', async () => {
    expect(json(await app.inject({ method: 'GET', url: '/admin/lineas' })).lineas[0]).toMatchObject({ id: ID_LINEA_PRINCIPAL, principal: true });
    const creada = json(await app.inject({ method: 'POST', url: '/admin/lineas', payload: { etiqueta: 'wsp-ali' } })).linea;
    expect(creada).toMatchObject({ etiqueta: 'wsp-ali', proveedor: 'local' });
    const renombrada = json(await app.inject({ method: 'PATCH', url: `/admin/lineas/${creada.id}`, payload: { etiqueta: 'wsp-kevin' } })).linea;
    expect(renombrada.etiqueta).toBe('wsp-kevin');
    expect((await app.inject({ method: 'DELETE', url: `/admin/lineas/${creada.id}` })).statusCode).toBe(200);
  });

  it('rechaza la novena con 409', async () => {
    for (let i = 0; i < 7; i++) expect((await app.inject({ method: 'POST', url: '/admin/lineas', payload: { etiqueta: `L${i}` } })).statusCode).toBe(200);
    const novena = await app.inject({ method: 'POST', url: '/admin/lineas', payload: { etiqueta: 'sobra' } });
    expect(novena.statusCode).toBe(409);
    expect(json(novena).codigo).toBe('tope');
  });

  it('la principal no se quita, ni se deshabilita, ni se conecta por aqui', async () => {
    expect((await app.inject({ method: 'DELETE', url: `/admin/lineas/${ID_LINEA_PRINCIPAL}` })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: `/admin/lineas/${ID_LINEA_PRINCIPAL}`, payload: { habilitada: false } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `/admin/lineas/${ID_LINEA_PRINCIPAL}/conectar` })).statusCode).toBe(400);
  });

  it('conectar arranca solo la sesion de esa linea; una deshabilitada no', async () => {
    const todas = json(await app.inject({ method: 'GET', url: '/admin/lineas' })).lineas as Array<{ id: string; principal: boolean }>;
    const [a, c] = todas.filter((l) => !l.principal);
    expect((await app.inject({ method: 'POST', url: `/admin/lineas/${a!.id}/conectar` })).statusCode).toBe(200);
    expect(arrancadas).toContain(a!.id);
    expect(arrancadas).not.toContain(c!.id);
    await app.inject({ method: 'PATCH', url: `/admin/lineas/${c!.id}`, payload: { habilitada: false } });
    expect((await app.inject({ method: 'POST', url: `/admin/lineas/${c!.id}/conectar` })).statusCode).toBe(409);
  });
});
