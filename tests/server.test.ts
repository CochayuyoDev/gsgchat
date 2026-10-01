import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import { buildTrackingUrls } from '../src/tracking/tokens.js';
import { signPayload } from '../src/whatsapp/signature.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp, type FakeRepos, CLAVE_API_PRUEBA as ADMIN } from './fakes.js';

const APP_SECRET = 'app-secret-de-prueba';

const ENV = {
  PUBLIC_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'mysql://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: APP_SECRET,
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  GOOGLE_MAPS_API_KEY: 'maps-key',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'mexico',
} as NodeJS.ProcessEnv;

const noopQueue: OutboundQueue = {
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

let app: FastifyInstance;
let repos: FakeRepos;
const config = loadConfig(ENV);

beforeAll(async () => {
  repos = createFakeRepos();
  const wa = createFakeWhatsApp();
  const sender = createSender({
    repos,
    wa,
    phoneNumberId: 'PNID',
    warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 },
    maxMarketingPerContact7d: 2,
  });
  const settings = await createFakeSettings(config);
  app = await buildServer({ config, repos, settings, wa, sender, queue: noopQueue, logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('rutas publicas', () => {
  it('responde el health check', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true });
  });

  it('completa el handshake del webhook', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=98765',
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('98765');
  });

  it('rechaza el handshake con token equivocado', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=1',
    });
    expect(response.statusCode).toBe(403);
  });

  it('rechaza un webhook sin firma valida', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=falsa' },
      payload: { object: 'whatsapp_business_account', entry: [] },
    });
    expect(response.statusCode).toBe(401);
  });

  it('acepta un webhook firmado', async () => {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signPayload(body, APP_SECRET),
      },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('paginas de rastreo', () => {
  async function session() {
    const expiresAt = new Date(Date.now() + 3600_000);
    const link = await repos.tracking.createLink(null, 'Pedido A-1024', expiresAt);
    return buildTrackingUrls(link.id, expiresAt, config.TRACKING_SECRET, config.PUBLIC_BASE_URL);
  }

  // Regresion: el token firmado pasa de 130 caracteres y el limite por
  // defecto de Fastify (100) devolvia 414 en todos los enlaces.
  it('sirve la pagina aunque el token sea largo', async () => {
    const urls = await session();
    const path = `/t/${urls.viewUrl.split('/t/')[1]}`;
    expect(path.length).toBeGreaterThan(100);

    const response = await app.inject({ method: 'GET', url: path });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('la pagina de publicar y la de ver son distintas', async () => {
    const urls = await session();
    const pub = await app.inject({ url: `/t/${urls.publishUrl.split('/t/')[1]}` });
    const view = await app.inject({ url: `/t/${urls.viewUrl.split('/t/')[1]}` });

    expect(pub.body).toContain('watchPosition');
    expect(view.body).not.toContain('watchPosition');
  });

  it('un token invalido devuelve 410 y no filtra la clave de Maps', async () => {
    const response = await app.inject({ method: 'GET', url: '/t/token-invalido' });
    expect(response.statusCode).toBe(410);
    expect(response.body).not.toContain('maps-key');
  });

  it('un enlace revocado deja de servirse', async () => {
    const urls = await session();
    await repos.tracking.revoke(urls.linkId);
    const response = await app.inject({ url: `/t/${urls.viewUrl.split('/t/')[1]}` });
    expect(response.statusCode).toBe(410);
  });
});

describe('api de administracion', () => {
  it('exige el bearer token', async () => {
    expect((await app.inject({ url: '/admin/health' })).statusCode).toBe(401);
    expect(
      (await app.inject({ url: '/admin/health', headers: { authorization: 'Bearer otro' } }))
        .statusCode,
    ).toBe(401);
  });

  it('devuelve la salud del numero', async () => {
    const response = await app.inject({
      url: '/admin/health',
      headers: { authorization: `Bearer ${ADMIN}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ number: { quality: 'GREEN' }, sentToday: 0 });
  });

  it('crea una sesion de rastreo con sus dos enlaces', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/tracking',
      headers: { authorization: `Bearer ${ADMIN}` },
      payload: { label: 'Pedido A-2048' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.publishUrl).not.toBe(body.viewUrl);
  });

  it('no lanza una campana con una plantilla que no existe', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/campaigns',
      headers: { authorization: `Bearer ${ADMIN}` },
      payload: { name: 'Prueba', templateName: 'no_existe' },
    });
    expect(response.statusCode).toBe(400);
  });
});
