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
import { createServer, type Server } from 'node:http';
import { crearPuertoGsg } from '../src/rutas/gsg.js';
import { buildServer } from '../src/server.js';
import { crearServicioAjustes, type ServicioAjustes } from '../src/ajustes/generales.js';
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

// Un GSG de mentira: guarda lo que le llega para ver que saldria al real.
const recibido: Array<{ metodo: string; url: string; clave: string | undefined; cuerpo: Record<string, unknown> }> = [];
let responder: { status: number; cuerpo: unknown } = { status: 200, cuerpo: { ok: true, id: 'gsg-123' } };
let mock: Server;
let mockPort = 0;
let app: FastifyInstance;
let repos: FakeRepos;
let ajustes: ServicioAjustes;
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
  ajustes = await crearServicioAjustes({ repo: repos.ajustesGenerales, config });
  await ajustes.guardar({ erroresManuales: [{ id: 'manual-numero', nombre: 'Número ajeno al cliente', activo: true }] });
  const settings = await createFakeSettings(config);
  deps = { repos, wa, sender, config, settings };
  const gsg = crearPuertoGsg({ GSG_URL: `http://127.0.0.1:${mockPort}/api/`, GSG_TOKEN: '', GSG_API_KEY: 'clave-de-prueba-gsg' });
  return buildServer({ config, repos, settings, wa, sender, queue, logger: false, mediaDir, gsg, ajustes });
}


beforeAll(async () => {
  mock = createServer((req, res) => {
    let texto = '';
    req.on('data', (c) => (texto += c));
    req.on('end', () => {
      recibido.push({ metodo: req.method ?? '', url: req.url ?? '', clave: req.headers['x-api-key'] as string | undefined, cuerpo: texto ? JSON.parse(texto) : {} });
      res.writeHead(responder.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(responder.cuerpo));
    });
  });
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', () => r()));
  mockPort = (mock.address() as { port: number }).port;
  app = await build(); await app.ready();
});
afterAll(async () => { await app.close(); mock.close(); });
let entregaGuardada: { id: number };
beforeEach(async () => {
  recibido.length = 0; responder = { status: 200, cuerpo: { ok: true, id: 'gsg-123' } };
  await app.close(); app = await build(); await app.ready();
  // El cliente tiene su pedido guardado: de ahi sale siempre el tracking.
  entregaGuardada = (await repos.entregas.crearEntrega({ dia: '2026-10-20', referencia: 'GSG-1', phone: '51987654321', nombre: 'Rosa', ubicacionEstado: 'pendiente', estado: 'esperando_ubicacion' } as never)).entrega;
});

describe('incidencia manual', () => {
  const telefono = '51987654321';
  const cuerpo = { phone: telefono, tipo: 'manual-numero', tracking: 'GSG-1', resumen: 'El numero no corresponde al cliente' };

  it('rechaza errores automáticos, desactivados y eliminados sin enviar a GSG', async () => {
    for (const tipo of ['sin_whatsapp', 'incidencia-manual', 'manual-inexistente']) {
      expect((await app.inject({ method: 'POST', url: '/admin/incidencia-manual', headers: auth, payload: { ...cuerpo, tipo } })).statusCode).toBe(400);
    }
    await ajustes.guardar({ erroresManuales: [{ id: 'manual-numero', nombre: 'Número ajeno al cliente', activo: false }] });
    expect((await app.inject({ method: 'POST', url: '/admin/incidencia-manual', headers: auth, payload: cuerpo })).statusCode).toBe(400);
    await ajustes.guardar({ erroresManuales: [] });
    expect((await app.inject({ method: 'POST', url: '/admin/incidencia-manual', headers: auth, payload: cuerpo })).statusCode).toBe(400);
    expect(recibido).toHaveLength(0);
  });

  it('conserva el nombre enviado aunque se renombre o elimine el error', async () => {
    await app.inject({ method: 'POST', url: '/admin/incidencia-manual', headers: auth, payload: cuerpo });
    await ajustes.guardar({ erroresManuales: [{ id: 'manual-numero', nombre: 'Otro nombre', activo: true }] });
    await ajustes.guardar({ erroresManuales: [] });
    const opciones = await app.inject({ url: '/admin/incidencia-manual?phone='+telefono, headers: auth });
    expect(opciones.json().enviadas[0].tipo).toBe('Número ajeno al cliente');
    expect(opciones.json().tipos).toEqual([]);
  });

  it('exige resumen, calla al bot, encola para GSG y no duplica', async () => {
    const sin = await app.inject({ method: 'POST', url: '/admin/incidencia-manual', headers: auth, payload: { ...cuerpo, resumen: '' } });
    expect(sin.statusCode).toBe(400);

    const ok = await app.inject({ method: 'POST', url: '/admin/incidencia-manual', headers: auth, payload: cuerpo });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ ok: true, duplicada: false, botPausado: true });
    expect((await repos.contacts.getByPhone(telefono))?.botPausadoAt).toBeTruthy();
    const cola = await repos.rutas.reportesRecientes(10, 'incidencia');
    expect(cola).toHaveLength(1);
    expect(cola[0]!.payload).toMatchObject({ tracking: 'GSG-1', codigo: 'Número ajeno al cliente', comentario: cuerpo.resumen });

    const otra = await app.inject({ method: 'POST', url: '/admin/incidencia-manual', headers: auth, payload: cuerpo });
    expect(otra.json()).toMatchObject({ duplicada: true });
    expect(await repos.rutas.reportesRecientes(10, 'incidencia')).toHaveLength(1);

    const op = await app.inject({ method: 'GET', url: `/admin/incidencia-manual?phone=${telefono}`, headers: auth });
    expect(op.json().tipos.map((t: { codigo: string }) => t.codigo)).toEqual(['manual-numero']);
  });

  it('lo que le llega a GSG: ruta, clave y cuerpo; y el estado queda Enviada', async () => {
    await app.inject({ method: 'POST', url: '/admin/incidencia-manual', headers: auth, payload: cuerpo });
    expect(recibido).toHaveLength(1);
    const r = recibido[0]!;
    console.log('GSG RECIBE:', r.metodo, r.url, 'x-api-key:', r.clave, JSON.stringify(r.cuerpo, null, 2));
    expect(r.metodo).toBe('POST');
    expect(r.url).toBe('/api/reported');
    expect(r.clave).toBe('clave-de-prueba-gsg');
    expect(r.cuerpo).toMatchObject({ tracking: 'GSG-1', tipo: 'PROBLEMA', motivo: 'OTRO', codigo: 'Número ajeno al cliente', comentario: cuerpo.resumen, telefonoOrigen: '987654321' });
    expect(String(r.cuerpo.eventoId)).toMatch(/^gsgchat-GSG-1-incidencia-manual-/);
    const op = await app.inject({ method: 'GET', url: `/admin/incidencia-manual?phone=${telefono}`, headers: auth });
    expect(op.json().enviadas[0]).toMatchObject({ estado: 'Enviada', tipo: 'Número ajeno al cliente' });
  });

  it('si GSG rechaza, queda Fallida o Pendiente de reintento y se puede reintentar sin duplicar', async () => {
    responder = { status: 500, cuerpo: { error: 'caido' } };
    await app.inject({ method: 'POST', url: '/admin/incidencia-manual', headers: auth, payload: cuerpo });
    const op = await app.inject({ method: 'GET', url: `/admin/incidencia-manual?phone=${telefono}`, headers: auth });
    console.log('ESTADO CON GSG CAIDO:', JSON.stringify(op.json().enviadas));
    expect(op.json().enviadas[0].estado).not.toBe('Enviada');
    const reintento = await app.inject({ method: 'POST', url: '/admin/incidencia-manual', headers: auth, payload: cuerpo });
    expect(reintento.json()).toMatchObject({ duplicada: true });
  });

  it('el pedido y la solicitud pasan a «reportada a GSG» solos', async () => {
    const lote = await repos.rutas.crearLote({ nombre: 'Reparto' });
    const [sol] = await repos.rutas.agregarSolicitudes(lote.id, [{ telefonoCrudo: '987654321', phone: telefono, nombre: 'Rosa', referencia: 'GSG-1', estado: 'respondio' }]);

    await app.inject({ method: 'POST', url: '/admin/incidencia-manual', headers: auth, payload: cuerpo });

    expect(await repos.rutas.solicitud(sol!.id)).toMatchObject({ estado: 'incidencia', incidencia: 'incidencia_manual', requiereHumano: true });
    expect(await repos.entregas.entrega(entregaGuardada.id)).toMatchObject({ estado: 'incidencia', incidencia: 'incidencia_manual', requiereHumano: true });
  });

  it('el tracking sale siempre del guardado: no se acepta otro ni se inventa', async () => {
    const otro = await app.inject({ method: 'POST', url: '/admin/incidencia-manual', headers: auth, payload: { ...cuerpo, tracking: 'INVENTADO-9' } });
    expect(otro.statusCode).toBe(400);
    expect(recibido).toHaveLength(0);

    // Sin decir cual, y con un solo pedido guardado, usa ese.
    const { tracking: _omitido, ...sinTracking } = cuerpo;
    const ok = await app.inject({ method: 'POST', url: '/admin/incidencia-manual', headers: auth, payload: sinTracking });
    expect(ok.statusCode).toBe(200);
    expect(recibido[0]!.cuerpo.tracking).toBe('GSG-1');

    const sinPedido = await app.inject({ method: 'POST', url: '/admin/incidencia-manual', headers: auth, payload: { ...cuerpo, phone: '51900000000' } });
    expect(sinPedido.statusCode).toBe(400);
  });
});
