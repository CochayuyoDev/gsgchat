/**
 * GSG manda una foto, un video o un audio al cliente por `POST /api/v1/mensajes`
 * (`media.url`) y lo ve en el historial. Se prueba que el fichero se comprueba
 * de verdad, que se guarda, que un reintento no lo manda dos veces y que el
 * enlace del hilo no cambia entre consultas (si cambiara, el navegador
 * recargaria la foto, el video o el audio en cada sondeo).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { hashClaveApi, prefijoDeClave } from '../src/auth/claves-api.js';
import { mediaDirectory } from '../src/whatsapp/local/media.js';
import { formatoReal } from '../src/api/v1/media-saliente.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp, type FakeRepos, type FakeWhatsApp } from './fakes.js';

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

const queue: OutboundQueue = { async enqueue() {}, async enqueueMany(j) { return j.length; }, async pause() {}, async resume() {}, async counts() { return {}; }, async close() {} };

/** La clave de GSG: escribe y lee el chat. */
const GSG = 'wak_claveDeGsgConMensajes0123456789abcdefXY';
/** Una clave sin el permiso de enviar. */
const SOLO_LEER = 'wak_claveSoloLeerConversaciones0123456789ab';
const TELEFONO = '51987654321';

// Los primeros bytes reales de cada formato (lo que se mira, no la cabecera).
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), Buffer.from('JFIF-foto-de-prueba')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png-de-prueba')]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.from([0, 0, 0, 0]), Buffer.from('video-de-prueba')]);
const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.from([0, 2, 0, 0, 0, 0, 0, 0]), Buffer.from('audio-de-prueba')]);
const MOV = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypqt  '), Buffer.from([0, 0, 0, 0]), Buffer.from('mov')]);
const TEXTO = Buffer.from('esto no es una foto, es un texto que dice ser png');

/** Lo que "sirve" la web de GSG en cada URL. */
const archivos = new Map<string, { datos: Buffer; tipo: string; largo?: boolean }>();
let descargas = 0;
const fetchGsg = (async (url: string | URL | Request) => {
  descargas++;
  const f = archivos.get(String(url));
  if (!f) return new Response('no esta', { status: 404 });
  return new Response(f.datos, { status: 200, headers: { 'content-type': f.tipo, ...(f.largo === false ? {} : { 'content-length': String(f.datos.length) }) } });
}) as unknown as typeof fetch;

const config = loadConfig(ENV);
let app: FastifyInstance;
let repos: FakeRepos;
let wa: FakeWhatsApp;
const dir = mediaDirectory();
let antes: Set<string>;

const con = (clave: string, extra: Record<string, string> = {}) => ({ 'x-api-key': clave, 'content-type': 'application/json', ...extra });
const enviar = (media: Record<string, unknown>, extra: Record<string, string> = {}, clave = GSG) =>
  app.inject({ method: 'POST', url: '/api/v1/mensajes', headers: con(clave, extra), payload: { telefono: TELEFONO, autor: 'persona', autorNombre: 'Luis', media } });
const hilo = () => app.inject({ method: 'GET', url: `/api/v1/conversaciones/${TELEFONO}?limite=50`, headers: con(GSG) });
const ruta = (url: string) => new URL(url).pathname;

beforeAll(async () => {
  antes = new Set(await readdir(dir));
  repos = createFakeRepos();
  const permisos = ['mensajes:enviar', 'conversaciones:leer'];
  repos._claves.push(
    { id: 'gsg', nombre: 'GSG', prefijo: prefijoDeClave(GSG), hash: hashClaveApi(GSG), creadaPor: null, createdAt: new Date(), ultimoUsoAt: null, revocadaAt: null, permisos },
    { id: 'lee', nombre: 'Solo leer', prefijo: prefijoDeClave(SOLO_LEER), hash: hashClaveApi(SOLO_LEER), creadaPor: null, createdAt: new Date(), ultimoUsoAt: null, revocadaAt: null, permisos: ['conversaciones:leer'] },
  );
  wa = createFakeWhatsApp();
  const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
  const settings = await createFakeSettings(config);
  app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false, webhooks: { fetchImpl: fetchGsg, timeoutMs: 100 } });
  await app.ready();
  await repos.contacts.upsertFromInbound(TELEFONO, 'Maria');
  await repos.contacts.setOptIn(TELEFONO, 'prueba');
  await repos.contacts.touchInbound(TELEFONO, new Date());
  archivos.set('https://gsg.test/foto.jpg', { datos: JPEG, tipo: 'image/jpeg' });
  archivos.set('https://gsg.test/video.mp4', { datos: MP4, tipo: 'video/mp4' });
  archivos.set('https://gsg.test/audio.ogg', { datos: OGG, tipo: 'audio/ogg' });
});

afterAll(async () => {
  await app.close();
  // Solo se borra lo que crearon estas pruebas.
  for (const f of await readdir(dir)) if (!antes.has(f)) await rm(path.join(dir, f), { force: true });
});

describe('formatoReal: se mira el contenido, no la cabecera', () => {
  it('reconoce los formatos que WhatsApp admite', () => {
    expect(formatoReal(JPEG)).toEqual({ familia: 'image', mimeType: 'image/jpeg' });
    expect(formatoReal(PNG)).toEqual({ familia: 'image', mimeType: 'image/png' });
    expect(formatoReal(MP4)).toEqual({ familia: 'video', mimeType: 'video/mp4' });
    expect(formatoReal(OGG)).toEqual({ familia: 'audio', mimeType: 'audio/ogg' });
  });
  it('rechaza un texto, un QuickTime y un fichero demasiado corto', () => {
    expect(formatoReal(TEXTO)).toBeNull();
    expect(formatoReal(MOV)).toBeNull();
    expect(formatoReal(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});

describe('GSG manda una foto, un video y un audio', () => {
  it('sin el permiso mensajes:enviar, 403', async () => {
    const r = await enviar({ url: 'https://gsg.test/foto.jpg' }, {}, SOLO_LEER);
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toContain('mensajes:enviar');
    expect(wa.sent.filter((s) => s.kind === 'media')).toHaveLength(0);
  });

  it('cada uno sale por WhatsApp con su tipo real, y el resultado dice enviado', async () => {
    const foto = await enviar({ url: 'https://gsg.test/foto.jpg', tipo: 'imagen', caption: 'su pedido' });
    const video = await enviar({ url: 'https://gsg.test/video.mp4', tipo: 'video' });
    const audio = await enviar({ url: 'https://gsg.test/audio.ogg', tipo: 'audio', voz: true });
    for (const r of [foto, video, audio]) {
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ ok: true, estado: 'enviado', mensajeId: expect.stringMatching(/^wamid\./) });
    }
    const salidos = wa.sent.filter((s) => s.kind === 'media');
    expect(salidos.map((s) => [s.tipo, s.mimeType, s.bytes])).toEqual([
      ['image', 'image/jpeg', JPEG.length],
      ['video', 'video/mp4', MP4.length],
      ['audio', 'audio/ogg', OGG.length],
    ]);
    expect(salidos[0]).toMatchObject({ caption: 'su pedido' });
    expect(salidos[2]).toMatchObject({ voz: true });
  });

  it('queda en el historial con su archivo, y el enlace abre el fichero tal cual', async () => {
    const r = await hilo();
    expect(r.statusCode).toBe(200);
    const mensajes = (r.json().mensajes as Array<Record<string, any>>).filter((m) => m.direccion === 'saliente');
    expect(mensajes.map((m) => m.tipo)).toEqual(['image', 'video', 'audio']);
    expect(mensajes.map((m) => m.archivo.tipo)).toEqual(['imagen', 'video', 'audio']);
    expect(mensajes[0]).toMatchObject({ texto: 'su pedido', autor: 'persona', autorNombre: 'Luis', estado: 'sent' });
    const esperado = [JPEG, MP4, OGG];
    for (const [i, m] of mensajes.entries()) {
      const f = await app.inject({ method: 'GET', url: ruta(m.archivo.url) });
      expect(f.statusCode).toBe(200);
      expect(f.rawPayload.equals(esperado[i]!)).toBe(true);
      expect(f.headers['content-type']).toBe(m.archivo.mimeType);
    }
  });

  it('recargar o volver a abrir el chat devuelve los mismos mensajes y archivos, con el mismo enlace', async () => {
    const a = (await hilo()).json().mensajes as Array<Record<string, any>>;
    const b = (await hilo()).json().mensajes as Array<Record<string, any>>;
    expect(b.map((m) => [m.id, m.archivo?.url ?? null])).toEqual(a.map((m) => [m.id, m.archivo?.url ?? null]));
    expect(a.filter((m) => m.archivo).length).toBeGreaterThanOrEqual(3);
  });
});

describe('un fichero que no es lo que dice ser no sale', () => {
  const sinEnvios = () => wa.sent.filter((s) => s.kind === 'media').length;

  it('un texto con content-type image/png', async () => {
    archivos.set('https://gsg.test/falsa.png', { datos: TEXTO, tipo: 'image/png' });
    const n = sinEnvios();
    const r = await enviar({ url: 'https://gsg.test/falsa.png' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toContain('formato');
    expect(sinEnvios()).toBe(n);
  });

  it('un video pedido como foto', async () => {
    const n = sinEnvios();
    const r = await enviar({ url: 'https://gsg.test/video.mp4', tipo: 'imagen' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toContain('media.tipo');
    expect(sinEnvios()).toBe(n);
  });

  it('un QuickTime (la Cloud API solo admite mp4 y 3gp)', async () => {
    archivos.set('https://gsg.test/iphone.mov', { datos: MOV, tipo: 'video/quicktime' });
    const r = await enviar({ url: 'https://gsg.test/iphone.mov' });
    expect(r.statusCode).toBe(400);
  });

  it('mas de 16 MB aunque el servidor no diga el largo: se corta sin cargarlo entero', async () => {
    archivos.set('https://gsg.test/enorme.jpg', { datos: Buffer.concat([JPEG, Buffer.alloc(16 * 1024 * 1024 + 10)]), tipo: 'image/jpeg', largo: false });
    const n = sinEnvios();
    const r = await enviar({ url: 'https://gsg.test/enorme.jpg' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toContain('16 MB');
    expect(sinEnvios()).toBe(n);
  });

  it('una URL que no responde: 400 y no se manda nada', async () => {
    const n = sinEnvios();
    const r = await enviar({ url: 'https://gsg.test/no-existe.jpg' });
    expect(r.statusCode).toBe(400);
    expect(sinEnvios()).toBe(n);
  });
});

describe('un reintento no lo manda dos veces', () => {
  it('la misma Idempotency-Key devuelve la primera respuesta y no baja ni envia otra vez', async () => {
    const n = wa.sent.filter((s) => s.kind === 'media').length;
    const d = descargas;
    const clave = { 'idempotency-key': 'gsg-msg-0001' };
    const uno = await enviar({ url: 'https://gsg.test/foto.jpg', caption: 'reintento' }, clave);
    const dos = await enviar({ url: 'https://gsg.test/foto.jpg', caption: 'reintento' }, clave);
    expect(uno.statusCode).toBe(200);
    expect(dos.statusCode).toBe(200);
    expect(dos.headers['idempotent-replayed']).toBe('true');
    expect(dos.json().mensajeId).toBe(uno.json().mensajeId);
    expect(wa.sent.filter((s) => s.kind === 'media').length).toBe(n + 1);
    expect(descargas).toBe(d + 1);
    const mios = ((await hilo()).json().mensajes as Array<Record<string, any>>).filter((m) => m.texto === 'reintento');
    expect(mios).toHaveLength(1);
  });

  it('si WhatsApp falla, la respuesta dice error y reintentable, y el mensaje no se duplica al reintentar', async () => {
    wa.failNext = new Error('Meta caido');
    const fallo = await enviar({ url: 'https://gsg.test/foto.jpg', caption: 'con fallo' }, { 'idempotency-key': 'gsg-msg-0002' });
    expect(fallo.statusCode).toBe(502);
    expect(fallo.json()).toMatchObject({ ok: false, estado: 'error' });
    // Un 5xx no se recuerda: reintentar con la misma clave si lo manda.
    const bien = await enviar({ url: 'https://gsg.test/foto.jpg', caption: 'con fallo' }, { 'idempotency-key': 'gsg-msg-0002' });
    expect(bien.statusCode).toBe(200);
    const otra = await enviar({ url: 'https://gsg.test/foto.jpg', caption: 'con fallo' }, { 'idempotency-key': 'gsg-msg-0002' });
    expect(otra.headers['idempotent-replayed']).toBe('true');
    expect(wa.sent.filter((s) => s.kind === 'media' && s.caption === 'con fallo')).toHaveLength(1);
  });
});

describe('el hilo no cambia si nada cambio (sin parpadeos)', () => {
  it('dos consultas seguidas dan exactamente el mismo `archivo.url`', async () => {
    const a = ((await hilo()).json().mensajes as Array<Record<string, any>>).filter((m) => m.archivo).map((m) => m.archivo.url);
    const b = ((await hilo()).json().mensajes as Array<Record<string, any>>).filter((m) => m.archivo).map((m) => m.archivo.url);
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });
});
