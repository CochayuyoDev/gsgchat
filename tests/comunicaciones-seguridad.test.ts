/**
 * Las comunicaciones con fuera: lo que se arreglo en la revision de
 * seguridad, consistencia y estabilidad de las APIs.
 *
 *  - Un escape en la ruta (`/%61dmin`) ya no se salta la autorizacion: ni en
 *    /admin, ni en /api/v1, ni en la recepcion de pedidos de GSG.
 *  - El handshake de Meta no acepta un verify token vacio.
 *  - El simulador de GSG no se abre con el token fijo de antes.
 *  - Graph y WAHA se cortan por tiempo y un fallo de red es un error tipado.
 *  - `Idempotency-Key` en POST /api/v1/mensajes: el reintento no envia dos veces.
 *  - Un webhook saliente que no contesta no frena a los demas.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { hashClaveApi, prefijoDeClave } from '../src/auth/claves-api.js';
import { normalizarRuta } from '../src/util/ruta-normalizada.js';
import { igualSeguro } from '../src/util/comparar.js';
import { verifyChallenge } from '../src/whatsapp/signature.js';
import { TOKEN_SIMULADOR } from '../src/rutas/conexion-gsg.js';
import { crearGsgSimulado } from '../src/entregas/gsg-simulado.js';
import { createWhatsAppClient, WhatsAppApiError } from '../src/whatsapp/client.js';
import { createWahaClient } from '../src/whatsapp/waha/client.js';
import { despacharEntregas } from '../src/webhooks/despachador.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp, CLAVE_API_PRUEBA, type FakeRepos, type FakeWhatsApp } from './fakes.js';
import { createFakeWebhooks } from './fakes-webhooks.js';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG } from './escenario-entregas.js';

const ENV = {
  PUBLIC_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'mysql://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'none',
} as NodeJS.ProcessEnv;

const queue: OutboundQueue = {
  async enqueue() {},
  async enqueueMany(jobs) {
    return jobs.length;
  },
  async pause() {},
  async resume() {},
  async counts() {
    return { waiting: 0 };
  },
  async close() {},
};

const CLAVE = 'wak_claveDeEnvioSeguridad0123456789abcdefXY';
const con = (clave: string, extra: Record<string, string> = {}) => ({ 'x-api-key': clave, 'content-type': 'application/json', ...extra });

let app: FastifyInstance | null = null;
let repos: FakeRepos;
let wa: FakeWhatsApp;

async function build() {
  const config = loadConfig(ENV);
  repos = createFakeRepos();
  repos._claves.push({ id: 'clave-envio', nombre: 'Envio', prefijo: prefijoDeClave(CLAVE), hash: hashClaveApi(CLAVE), creadaPor: null, createdAt: new Date(), ultimoUsoAt: null, revocadaAt: null, permisos: ['mensajes:enviar', 'conversaciones:leer'] });
  wa = createFakeWhatsApp();
  const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
  const settings = await createFakeSettings(config);
  const a = await buildServer({ config, repos, settings, wa, sender, queue, logger: false });
  await a.ready();
  return a;
}

beforeEach(async () => {
  await app?.close();
  app = await build();
});

afterAll(async () => {
  await app?.close();
});

describe('la ruta que ven los ganchos es la que ve el enrutador', () => {
  it('decodifica solo lo no reservado y deja lo demas como viene', () => {
    expect(normalizarRuta('/%61dmin/usuarios')).toBe('/admin/usuarios');
    expect(normalizarRuta('/%61pi/v1/estado?q=%61')).toBe('/api/v1/estado?q=%61');
    expect(normalizarRuta('/t/abc%2Fdef%25')).toBe('/t/abc%2Fdef%25');
    expect(normalizarRuta('/admin')).toBe('/admin');
  });

  it('/%61dmin y /%61pi sin credenciales dan 401, como sin escape', async () => {
    for (const url of ['/admin/health', '/%61dmin/health', '/%61%64min/health', '/a%64min/health']) {
      expect((await app!.inject({ method: 'GET', url })).statusCode, url).toBe(401);
    }
    for (const url of ['/api/v1/estado', '/%61pi/v1/estado', '/api/v1/%65stado', '/%61%70%69/v1/conversaciones']) {
      expect((await app!.inject({ method: 'GET', url })).statusCode, url).toBe(401);
    }
  });

  it('una clave acotada no entra a /admin con escapes', async () => {
    for (const url of ['/admin/health', '/%61dmin/health']) {
      expect((await app!.inject({ method: 'GET', url, headers: con(CLAVE) })).statusCode, url).toBe(403);
    }
  });

  it('la recepcion de pedidos de GSG con escapes pasa por sus mismas reglas', async () => {
    const esc = await crearEscenarioEntregas({});
    try {
      const pedido = (tracking: string) => JSON.stringify({ ...OBLIGATORIOS_GSG, tracking, cliente: 'Cliente Escape', telefono: '987654321' });
      for (const url of ['/api/v1/entregas', '/%61pi/v1/entregas', '/api/v1/%65ntregas', '/api/%76%31/entregas']) {
        // Sin clave: 401 con el codigo de la recepcion.
        const sin = await esc.app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json' }, payload: pedido('ESC-1') });
        expect(sin.statusCode, url).toBe(401);
        expect(sin.json(), url).toMatchObject({ codigo: 'CLAVE_AUSENTE' });
        // Con clave pero sin JSON: la recepcion exige application/json (solo
        // la ve si el gancho reconoce la ruta).
        const texto = await esc.app.inject({ method: 'POST', url, headers: { 'x-api-key': CLAVE_API_PRUEBA, 'content-type': 'text/plain' }, payload: 'hola' });
        expect(texto.statusCode, url).toBe(415);
      }
      expect(await esc.entrega('ESC-1')).toBeFalsy();
      const ok = await esc.app.inject({ method: 'POST', url: '/%61pi/v1/entregas', headers: con(CLAVE_API_PRUEBA), payload: pedido('ESC-2') });
      expect(ok.statusCode).toBe(201);
      expect(await esc.entrega('ESC-2')).toBeTruthy();
    } finally {
      await esc.cerrar();
    }
  });
});

describe('handshake del webhook de Meta', () => {
  it('con el verify token correcto devuelve el challenge', () => {
    expect(verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '123' }, 'verify-me')).toBe('123');
    expect(verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'otro', 'hub.challenge': '123' }, 'verify-me')).toBeNull();
  });

  it('sin verify token configurado no se suscribe nadie, ni con uno vacio', () => {
    expect(verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '123' }, '')).toBeNull();
    expect(verifyChallenge({ 'hub.mode': 'subscribe', 'hub.challenge': '123' }, '')).toBeNull();
  });

  it('un challenge de mas de 200 caracteres no se devuelve', () => {
    expect(verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': 'x'.repeat(201) }, 'verify-me')).toBeNull();
  });

  it('igualSeguro: vacio o de otro tipo nunca coincide', () => {
    expect(igualSeguro('abc', 'abc')).toBe(true);
    expect(igualSeguro('abc', 'abd')).toBe(false);
    expect(igualSeguro('', '')).toBe(false);
    expect(igualSeguro(['abc'], 'abc')).toBe(false);
  });
});

describe('el simulador de GSG', () => {
  it('el token interno es al azar: el fijo de antes ya no abre nada', () => {
    expect(TOKEN_SIMULADOR).not.toBe('simulador-gsg-local');
    expect(TOKEN_SIMULADOR.length).toBeGreaterThan(40);
    const sim = crearGsgSimulado({ token: TOKEN_SIMULADOR });
    expect(sim.atender('GET', '/reparto/estado', 'simulador-gsg-local', null).status).toBe(401);
    expect(sim.atender('POST', '/reparto/cargar', 'simulador-gsg-local', { clientes: [{ referencia: 'X', telefono: '51987654321' }] }).status).toBe(401);
    expect(sim.atender('GET', '/reparto/estado', TOKEN_SIMULADOR, null).status).toBe(200);
  });
});

describe('los clientes de Meta y WAHA no se cuelgan', () => {
  const colgado = (async (_url: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })) as unknown as typeof fetch;

  it('Graph sin respuesta se corta y no se reintenta solo (pudo haber salido)', async () => {
    const meta = createWhatsAppClient({ token: 't', phoneNumberId: 'P', businessAccountId: 'W', fetchImpl: colgado, timeoutMs: 30 });
    const error = await meta.sendText('51987654321', 'hola').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WhatsAppApiError);
    expect(error).toMatchObject({ httpStatus: 504, retryable: false });
  });

  it('Graph sin conexion es reintentable; un 502 en HTML es un error tipado, no un SyntaxError', async () => {
    const rechazado = (async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }) as unknown as typeof fetch;
    const meta = createWhatsAppClient({ token: 't', phoneNumberId: 'P', businessAccountId: 'W', fetchImpl: rechazado });
    await expect(meta.sendText('51987654321', 'hola')).rejects.toMatchObject({ name: 'WhatsAppApiError', retryable: true });

    const html = (async () => new Response('<html>502 Bad Gateway</html>', { status: 502 })) as unknown as typeof fetch;
    const meta2 = createWhatsAppClient({ token: 't', phoneNumberId: 'P', businessAccountId: 'W', fetchImpl: html });
    await expect(meta2.sendText('51987654321', 'hola')).rejects.toMatchObject({ name: 'WhatsAppApiError', httpStatus: 502, retryable: true });

    const noJson = (async () => new Response('hola', { status: 200 })) as unknown as typeof fetch;
    const meta3 = createWhatsAppClient({ token: 't', phoneNumberId: 'P', businessAccountId: 'W', fetchImpl: noJson });
    await expect(meta3.sendText('51987654321', 'hola')).rejects.toMatchObject({ name: 'WhatsAppApiError', httpStatus: 502, retryable: false });
  });

  it('WAHA colgado se corta por tiempo', async () => {
    const waha = createWahaClient({ baseUrl: 'http://waha.test', fetchImpl: colgado, timeoutMs: 30 });
    await expect(waha.sendText('51987654321', 'hola')).rejects.toMatchObject({ name: 'WhatsAppApiError', httpStatus: 504 });
  });
});

describe('Idempotency-Key en POST /api/v1/mensajes', () => {
  async function clienteActivo(phone = '51987654321') {
    await repos.contacts.upsertFromInbound(phone, 'Maria');
    await repos.contacts.setOptIn(phone, 'prueba');
    await repos.contacts.touchInbound(phone, new Date());
  }
  const enviar = (clave?: string) =>
    app!.inject({ method: 'POST', url: '/api/v1/mensajes', headers: con(CLAVE, clave ? { 'idempotency-key': clave } : {}), payload: { telefono: '51987654321', texto: 'Tu pedido ya salio' } });

  it('el reintento con la misma clave no envia otra vez y devuelve la misma respuesta', async () => {
    await clienteActivo();
    const [a, b] = await Promise.all([enviar('pedido-1024'), enviar('pedido-1024')]);
    const c = await enviar('pedido-1024');
    expect(wa.sent).toHaveLength(1);
    expect(a.statusCode).toBe(200);
    expect(b.json()).toEqual(a.json());
    expect(c.json()).toEqual(a.json());
    expect([a, b, c].filter((r) => r.headers['idempotent-replayed'] === 'true')).toHaveLength(2);
  });

  it('otra clave, o sin clave, si envia', async () => {
    await clienteActivo();
    await enviar('k-1');
    await enviar('k-2');
    await enviar();
    expect(wa.sent).toHaveLength(3);
  });

  it('una clave mal formada es 400 y no envia', async () => {
    await clienteActivo();
    const r = await enviar('con espacios');
    expect(r.statusCode).toBe(400);
    expect(wa.sent).toHaveLength(0);
  });
});

describe('webhooks salientes', () => {
  it('un receptor que no contesta no se vuelve a probar en la pasada ni frena a los demas', async () => {
    const repo = createFakeWebhooks();
    const muerto = await repo.crear({ url: 'https://muerto.test/hook', descripcion: '', secreto: 'whsec_a', eventos: ['*'], creadoPor: null });
    const vivo = await repo.crear({ url: 'https://vivo.test/hook', descripcion: '', secreto: 'whsec_b', eventos: ['*'], creadoPor: null });
    const t0 = new Date();
    for (let i = 0; i < 3; i++) await repo.encolar(muerto.id, 'contacto.baja', { n: i }, t0);
    await repo.encolar(vivo.id, 'contacto.baja', { n: 9 }, t0);

    const llamadas: string[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      llamadas.push(String(url));
      if (String(url).includes('muerto')) {
        return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
      }
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;

    const r = await despacharEntregas({ repo, fetchImpl, ahora: () => t0, timeoutMs: 30 });
    expect(llamadas.filter((u) => u.includes('muerto'))).toHaveLength(1);
    expect(llamadas.filter((u) => u.includes('vivo'))).toHaveLength(1);
    expect(r).toMatchObject({ intentadas: 2, enviadas: 1, reintentar: 1 });
    // Las otras dos del muerto siguen pendientes y sin intento gastado.
    const delMuerto = await repo.entregas(muerto.id, 10);
    expect(delMuerto.filter((e) => e.intentos === 0 && e.estado === 'pendiente')).toHaveLength(2);
  });

  it('del cuerpo de la respuesta solo se lee el principio', async () => {
    const repo = createFakeWebhooks();
    const w = await repo.crear({ url: 'https://grande.test/hook', descripcion: '', secreto: 'whsec_c', eventos: ['*'], creadoPor: null });
    const t0 = new Date();
    await repo.encolar(w.id, 'contacto.baja', {}, t0);
    const fetchImpl = (async () => new Response('x'.repeat(5_000_000), { status: 200 })) as unknown as typeof fetch;
    await despacharEntregas({ repo, fetchImpl, ahora: () => t0, timeoutMs: 1000 });
    const e = (await repo.entregas(w.id, 10))[0]!;
    expect(e.estado).toBe('enviada');
    expect((e.respuesta ?? '').length).toBeLessThanOrEqual(500);
  });
});
