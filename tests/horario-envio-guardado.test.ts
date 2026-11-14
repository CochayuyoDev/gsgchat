/**
 * El horario de envío (Pedidos GSG → Ajustes de chat) se guarda, se vuelve a
 * leer igual y sobrevive a reiniciar el servicio de ajustes. Se prueba con el
 * servicio de ajustes generales puesto, como en producción.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { crearServicioAjustes } from '../src/ajustes/generales.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp, type FakeRepos, CLAVE_API_PRUEBA as ADMIN } from './fakes.js';

const ENV = {
  PUBLIC_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'mysql://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'lima',
  RUTAS_PAIS: 'peru',
} as NodeJS.ProcessEnv;

const queue: OutboundQueue = {
  async enqueue() {},
  async enqueueMany(jobs) { return jobs.length; },
  async pause() {},
  async resume() {},
  async counts() { return {}; },
  async close() {},
};

describe('horario de envío guardado', () => {
  const auth = { 'x-api-key': ADMIN };
  const config = loadConfig(ENV);
  let app: FastifyInstance;
  let repos: FakeRepos;

  beforeAll(async () => {
    repos = createFakeRepos();
    const wa = createFakeWhatsApp();
    const settings = await createFakeSettings(config);
    const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
    const ajustes = await crearServicioAjustes({ repo: repos.ajustesGenerales, config });
    app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false, ajustes });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it('guardar 8 a 20 lo deja guardado: la pantalla, el estado y un servicio nuevo lo leen igual', async () => {
    const r = await app.inject({ method: 'POST', url: '/admin/rutas/ajustes', headers: auth, payload: { horaInicio: 8, horaFin: 20 } });
    expect(r.statusCode).toBe(200);
    expect(r.json().ajustes).toMatchObject({ horaInicio: 8, horaFin: 20 });

    const leido = await app.inject({ method: 'GET', url: '/admin/rutas/ajustes', headers: auth });
    expect(leido.json().ajustes).toMatchObject({ horaInicio: 8, horaFin: 20 });

    const estado = await app.inject({ method: 'GET', url: '/admin/rutas', headers: auth });
    expect(estado.json().motor.horario).toEqual([8, 20]);

    const recargado = await crearServicioAjustes({ repo: repos.ajustesGenerales, config });
    expect(recargado.actual().horario).toMatchObject({ inicio: 8, fin: 20 });
  });

  it('guardar el resto de los ajustes después no devuelve el horario al de siempre', async () => {
    await app.inject({ method: 'POST', url: '/admin/rutas/ajustes', headers: auth, payload: { horaInicio: 7, horaFin: 21 } });
    const otro = await app.inject({ method: 'POST', url: '/admin/rutas/ajustes', headers: auth, payload: { maxIntentos: 5 } });
    expect(otro.statusCode).toBe(200);
    const leido = await app.inject({ method: 'GET', url: '/admin/rutas/ajustes', headers: auth });
    expect(leido.json().ajustes).toMatchObject({ horaInicio: 7, horaFin: 21, maxIntentos: 5 });
  });

  it('un fin que no es mayor que el inicio se rechaza y no pisa lo guardado', async () => {
    await app.inject({ method: 'POST', url: '/admin/rutas/ajustes', headers: auth, payload: { horaInicio: 9, horaFin: 19 } });
    const malo = await app.inject({ method: 'POST', url: '/admin/rutas/ajustes', headers: auth, payload: { horaInicio: 15, horaFin: 10 } });
    expect(malo.statusCode).toBe(400);
    const leido = await app.inject({ method: 'GET', url: '/admin/rutas/ajustes', headers: auth });
    expect(leido.json().ajustes).toMatchObject({ horaInicio: 9, horaFin: 19 });
  });
});
