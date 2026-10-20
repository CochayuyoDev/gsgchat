/**
 * El chat: conversaciones, hilo y envio.
 *
 * Lo que se prueba aqui no es la pantalla, es que la conversacion se GUARDE
 * sola: un mensaje que entra por el webhook y una respuesta que sale por el
 * sender tienen que aparecer los dos en el hilo, en orden y con su estado.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { processChange } from '../src/whatsapp/webhook.js';
import { readInbound } from '../src/handlers/inbound.js';
import {
  approvedTemplate,
  createFakeRepos,
  createFakeSettings,
  createFakeWhatsApp,
  type FakeRepos,
  type FakeWhatsApp,
  CLAVE_API_PRUEBA as ADMIN,
} from './fakes.js';
import type { ChangeValue, InboundMessage } from '../src/whatsapp/types.js';
import type { Sender } from '../src/outbound/sender.js';

const auth = { 'x-api-key': ADMIN };

const ENV = {
  PUBLIC_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'mysql://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_ID: '123456',
  WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'mexico',
} as NodeJS.ProcessEnv;

const queue: OutboundQueue = {
  async enqueue() {},
  async enqueueMany(jobs) {
    return jobs.length;
  },
  async pause() {},
  async resume() {},
  async counts() {
    return {};
  },
  async close() {},
};

// Los adjuntos que se mandan desde el chat se escriben a disco: en una
// carpeta temporal, no en la .wa-media de verdad.
const mediaDir = mkdtempSync(join(tmpdir(), 'wa-chat-media-'));

let app: FastifyInstance;
let repos: FakeRepos;
let wa: FakeWhatsApp;
let sender: Sender;
let deps: Parameters<typeof processChange>[2];
const config = loadConfig(ENV);

async function build() {
  repos = createFakeRepos();
  wa = createFakeWhatsApp();
  sender = createSender({
    repos,
    wa,
    phoneNumberId: 'PNID',
    warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 },
    maxMarketingPerContact7d: 2,
  });
  const settings = await createFakeSettings(config);
  deps = { repos, wa, sender, config, settings };
  return buildServer({ config, repos, settings, wa, sender, queue, logger: false, mediaDir });
}


beforeAll(async () => { app = await build(); await app.ready(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => { await app.close(); app = await build(); await app.ready(); });

describe('incidencia manual', () => {
  const telefono = '51987654321';
  const cuerpo = { phone: telefono, tipo: 'incidencia-manual', tracking: 'GSG-1', resumen: 'El numero no corresponde al cliente' };

  it('exige resumen, calla al bot, encola para GSG y no duplica', async () => {
    const sin = await app.inject({ method: 'POST', url: '/admin/incidencia-manual', headers: auth, payload: { ...cuerpo, resumen: '' } });
    expect(sin.statusCode).toBe(400);

    const ok = await app.inject({ method: 'POST', url: '/admin/incidencia-manual', headers: auth, payload: cuerpo });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ ok: true, duplicada: false, botPausado: true });
    expect((await repos.contacts.getByPhone(telefono))?.botPausadoAt).toBeTruthy();
    const cola = await repos.rutas.reportesRecientes(10, 'incidencia');
    expect(cola).toHaveLength(1);
    expect(cola[0]!.payload).toMatchObject({ tracking: 'GSG-1', codigo: 'incidencia-manual', comentario: cuerpo.resumen });

    const otra = await app.inject({ method: 'POST', url: '/admin/incidencia-manual', headers: auth, payload: cuerpo });
    expect(otra.json()).toMatchObject({ duplicada: true });
    expect(await repos.rutas.reportesRecientes(10, 'incidencia')).toHaveLength(1);

    const op = await app.inject({ method: 'GET', url: `/admin/incidencia-manual?phone=${telefono}`, headers: auth });
    expect(op.json().tipos.map((t: { codigo: string }) => t.codigo)).toContain('incidencia-manual');
  });
});
