/**
 * La voz del asistente (ElevenLabs): notas de voz y transcripcion.
 *
 * ElevenLabs se sustituye por un fetch de mentira que apunta lo que se le
 * pide, y por un cliente falso en las pruebas del servicio. Lo que importa:
 *  - el cliente pide Opus/Ogg (lo que WhatsApp entiende como nota de voz),
 *    se cae a MP3 si el plan no lo permite, y explica en palabras una clave
 *    mala o la cuota agotada;
 *  - la clave se guarda cifrada y nunca vuelve a la pantalla;
 *  - un audio del cliente se transcribe al llegar: el hilo lleva lo que dijo,
 *    el webhook lo lleva como `transcripcion`, y el asistente lo atiende como
 *    texto y contesta con audio segun "cuando";
 *  - la voz nunca calla al asistente: sin clave, con el texto muy largo o con
 *    ElevenLabs caido, sale por escrito;
 *  - POST /api/v1/mensajes: `voz: true` manda nota de voz y dice como salio,
 *    `media.url` baja el fichero y lo manda, `autor` queda en el hilo y en el
 *    webhook.
 */

import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender, type Sender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { createSettingsService, type SettingsRepo } from '../src/settings/service.js';
import { processChange } from '../src/whatsapp/webhook.js';
import type { ChangeValue, InboundMessage } from '../src/whatsapp/types.js';
import { crearServicioIA, type ServicioIA } from '../src/ia/servicio.js';
import { ErrorIA, type MensajeIA, type ProveedorIA } from '../src/ia/proveedores.js';
import { crearClienteElevenLabs, ErrorVoz, type ClienteVoz } from '../src/voz/elevenlabs.js';
import { crearServicioVoz, type ServicioVoz } from '../src/voz/servicio.js';
import { crearBus, type Bus } from '../src/eventos/bus.js';
import { observarRepos } from '../src/eventos/observar.js';
import { createFakeRepos, createFakeWhatsApp, createMemorySettingsRepo, TEST_SETTINGS_KEY, type FakeRepos, type FakeWhatsApp, CLAVE_API_PRUEBA as TODO } from './fakes.js';

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
  BUSINESS_NAME: 'Zapateria Lima',
  BUSINESS_HOURS: 'lunes a sabado de 9 a 19',
  RUTAS_SUPERVISOR: '51912000000',
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

const config = loadConfig(ENV);
const con = (clave: string) => ({ 'x-api-key': clave, 'content-type': 'application/json' });

/** Un Ogg/Opus de mentira: lo unico que se mira es la firma "OggS". */
const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(200, 7)]);
const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(120, 3)]);

// ------------------------------------------------------------- el cliente

/** ElevenLabs de mentira: apunta cada llamada y contesta segun el estado. */
function elevenFalso() {
  const llamadas: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }> = [];
  const estado = { sinOpus: false, status: 200 as number, detalle: null as unknown, texto: 'quiero dos pares talla cuarenta y dos' };
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    let body: unknown = null;
    if (typeof init?.body === 'string') body = JSON.parse(init.body);
    else if (init?.body instanceof FormData) body = Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, v instanceof Blob ? { blob: true, tipo: v.type, bytes: v.size } : v]));
    llamadas.push({ url, method: init?.method ?? 'GET', headers, body });
    const json = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
    if (estado.status !== 200) return json(estado.status, estado.detalle ?? { detail: { status: 'error', message: 'algo' } });
    if (url.includes('/v1/text-to-speech/')) {
      const opus = url.includes('output_format=opus');
      if (opus && estado.sinOpus) return json(400, { detail: { status: 'invalid_output_format', message: 'output_format opus_48000_64 is not available on your tier' } });
      return new Response(new Uint8Array(opus ? OGG : MP3), { status: 200, headers: { 'content-type': opus ? 'audio/ogg' : 'audio/mpeg' } });
    }
    if (url.endsWith('/v1/speech-to-text')) return json(200, { text: estado.texto, language_code: 'spa' });
    if (url.endsWith('/v1/voices')) return json(200, { voices: [{ voice_id: 'v-lucia', name: 'Lucía', category: 'premade', labels: { gender: 'female', accent: 'latin american' }, preview_url: 'https://x/l.mp3' }, { voice_id: 'v-mateo', name: 'Mateo', labels: {} }] });
    if (url.endsWith('/v1/user/subscription')) return json(200, { tier: 'starter', character_count: 1200, character_limit: 30000, next_character_count_reset_unix: 1_800_000_000 });
    return json(404, { detail: 'no' });
  }) as typeof fetch;
  return { fetchImpl, llamadas, estado };
}

describe('el cliente de ElevenLabs', () => {
  it('pide la nota de voz en Opus/Ogg con la clave en la cabecera, y la devuelve como audio/ogg', async () => {
    const e = elevenFalso();
    const c = crearClienteElevenLabs({ apiKey: 'xi-secreta', fetchImpl: e.fetchImpl });
    const r = await c.hablar('Hola, ¿en qué te ayudo?', { vozId: 'v-lucia', modelo: 'eleven_flash_v2_5', idioma: 'es' });
    expect(r).toMatchObject({ mimeType: 'audio/ogg; codecs=opus', formato: 'opus' });
    expect(r.datos.equals(OGG)).toBe(true);
    const l = e.llamadas[0]!;
    expect(l.url).toBe('https://api.elevenlabs.io/v1/text-to-speech/v-lucia?output_format=opus_48000_64');
    expect(l.headers['xi-api-key']).toBe('xi-secreta');
    expect(l.body).toMatchObject({ text: 'Hola, ¿en qué te ayudo?', model_id: 'eleven_flash_v2_5', language_code: 'es' });
  });

  it('si el plan no tiene Opus, se cae a MP3 (llega como audio normal, pero llega)', async () => {
    const e = elevenFalso();
    e.estado.sinOpus = true;
    const c = crearClienteElevenLabs({ apiKey: 'k', fetchImpl: e.fetchImpl });
    const r = await c.hablar('hola', { vozId: 'v', modelo: 'eleven_multilingual_v2' });
    expect(r).toMatchObject({ mimeType: 'audio/mpeg', formato: 'mp3' });
    expect(e.llamadas.map((l) => l.url.split('output_format=')[1])).toEqual(['opus_48000_64', 'mp3_44100_64']);
    // El multilingue no lleva idioma: lo detecta solo.
    expect((e.llamadas[0]!.body as Record<string, unknown>).language_code).toBeUndefined();
  });

  it('una clave mala y la cuota agotada se explican en palabras, sin reintentar', async () => {
    const e = elevenFalso();
    e.estado.status = 401;
    e.estado.detalle = { detail: { status: 'invalid_api_key', message: 'Invalid API key' } };
    const c = crearClienteElevenLabs({ apiKey: 'mala', fetchImpl: e.fetchImpl });
    await expect(c.hablar('hola', { vozId: 'v', modelo: 'm' })).rejects.toMatchObject({ codigo: 'clave', message: expect.stringContaining('no acepta la clave') });
    expect(e.llamadas).toHaveLength(1);

    e.llamadas.length = 0;
    e.estado.status = 401;
    e.estado.detalle = { detail: { status: 'quota_exceeded', message: 'This request exceeds your quota of 10000.' } };
    await expect(c.hablar('hola', { vozId: 'v', modelo: 'm' })).rejects.toMatchObject({ codigo: 'cuota', message: expect.stringContaining('caracteres') });
    expect(e.llamadas).toHaveLength(1);

    e.estado.status = 200;
    e.estado.detalle = null;
  });

  it('transcribe un audio por multipart con el modelo scribe, y lee la cuenta y las voces', async () => {
    const e = elevenFalso();
    const c = crearClienteElevenLabs({ apiKey: 'k', fetchImpl: e.fetchImpl });
    const t = await c.transcribir(OGG, 'audio/ogg; codecs=opus', { idioma: 'es' });
    expect(t).toEqual({ texto: 'quiero dos pares talla cuarenta y dos', idioma: 'spa' });
    expect(e.llamadas[0]!.body).toMatchObject({ model_id: 'scribe_v1', language_code: 'es', file: { blob: true, tipo: 'audio/ogg', bytes: OGG.length } });

    expect(await c.cuenta()).toMatchObject({ plan: 'starter', caracteresUsados: 1200, caracteresLimite: 30000 });
    const voces = await c.voces();
    expect(voces).toHaveLength(2);
    expect(voces[0]).toMatchObject({ id: 'v-lucia', nombre: 'Lucía', etiquetas: { gender: 'female' }, muestraUrl: 'https://x/l.mp3' });
  });

  it('sin red o con timeout, un error en palabras (no una excepcion cruda)', async () => {
    const c = crearClienteElevenLabs({
      apiKey: 'k',
      fetchImpl: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });
    await expect(c.cuenta()).rejects.toBeInstanceOf(ErrorVoz);
    await expect(c.cuenta()).rejects.toMatchObject({ codigo: 'red', message: expect.stringContaining('No se pudo llegar a ElevenLabs') });
  });
});

// ------------------------------------------------------------- el sistema

/** El cliente de ElevenLabs de mentira para el servicio: cuenta lo que se le pide. */
function clienteFalso() {
  const estado = { fallar: null as ErrorVoz | null, transcripcion: 'quiero dos pares talla cuarenta y dos', hablado: [] as string[], transcritos: 0 };
  const cliente: ClienteVoz = {
    async voces() {
      return [{ id: 'v-lucia', nombre: 'Lucía', categoria: 'premade', etiquetas: { gender: 'female' }, muestraUrl: null }];
    },
    async hablar(texto) {
      if (estado.fallar) throw estado.fallar;
      estado.hablado.push(texto);
      return { datos: OGG, mimeType: 'audio/ogg; codecs=opus', formato: 'opus' };
    },
    async transcribir() {
      if (estado.fallar) throw estado.fallar;
      estado.transcritos++;
      return { texto: estado.transcripcion, idioma: 'spa' };
    },
    async cuenta() {
      if (estado.fallar) throw estado.fallar;
      return { plan: 'starter', caracteresUsados: 100, caracteresLimite: 30000, renuevaEl: new Date('2026-10-01T00:00:00Z') };
    },
  };
  return { cliente, estado, fabricadas: [] as string[] };
}

function modeloFalso() {
  const recibido: MensajeIA[][] = [];
  const estado = { siguiente: 'Claro, tenemos talla 42 en negro y marrón.', fallar: null as string | null };
  const proveedor: ProveedorIA = {
    nombre: 'falso',
    async chat(mensajes) {
      recibido.push(mensajes);
      if (estado.fallar) throw new ErrorIA(estado.fallar, 'falso');
      return estado.siguiente;
    },
  };
  return { proveedor, recibido, estado };
}

let app: FastifyInstance;
let repos: FakeRepos;
let wa: FakeWhatsApp;
let sender: Sender;
let settingsRepo: SettingsRepo;
let ia: ServicioIA;
let voz: ServicioVoz;
let eleven: ReturnType<typeof clienteFalso>;
let modelo: ReturnType<typeof modeloFalso>;
let bus: Bus;
let mediaDir: string;
let deps: Parameters<typeof processChange>[2];
let eventos: Array<{ nombre: string; datos: Record<string, unknown> }> = [];

async function build() {
  bus = crearBus();
  eventos = [];
  bus.escucharTodo((nombre, payload) => {
    eventos.push({ nombre, datos: payload as unknown as Record<string, unknown> });
  });
  repos = observarRepos(createFakeRepos(), bus) as FakeRepos;
  wa = createFakeWhatsApp();
  sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2, serviceWindowApplies: false });
  settingsRepo = createMemorySettingsRepo();
  const settings = await createSettingsService(settingsRepo, config, TEST_SETTINGS_KEY);
  eleven = clienteFalso();
  voz = await crearServicioVoz({
    settingsRepo,
    settingsKeyBase64: TEST_SETTINGS_KEY,
    sender,
    mediaDir,
    fabrica: (apiKey) => {
      eleven.fabricadas.push(apiKey);
      return eleven.cliente;
    },
  });
  modelo = modeloFalso();
  ia = await crearServicioIA({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, repos, sender, config, nombreNegocio: () => 'Zapateria Lima', supervisor: () => '51912000000', proveedor: modelo.proveedor, modelosGratis: ['google/gemma-4-31b-it'], voz });
  const server = await buildServer({ config, repos, settings, wa, sender, queue, logger: false, ia, voz, mediaDir, bus, webhooks: { fetchImpl: fetchDeFicheros } });
  deps = { repos, wa, sender, config, settings, ia, voz };
  return server;
}

/** Los ficheros que `media.url` puede bajar. */
const fetchDeFicheros = (async (input: string | URL | Request) => {
  const url = String(input);
  if (url === 'https://stoky.test/fotos/zapato.png') return new Response(new Uint8Array(Buffer.from('PNGFALSO'.repeat(10))), { status: 200, headers: { 'content-type': 'image/png' } });
  if (url === 'https://stoky.test/nota.ogg') return new Response(new Uint8Array(OGG), { status: 200, headers: { 'content-type': 'audio/ogg' } });
  return new Response('no', { status: 404 });
}) as typeof fetch;

const galletaDe = (r: { headers: Record<string, unknown> }) => {
  const c = (r.headers['set-cookie'] as string | string[] | undefined) ?? '';
  return (Array.isArray(c) ? (c[0] ?? '') : c).split(';')[0]!;
};

async function admin(): Promise<Record<string, string>> {
  let r = await app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { usuario: 'ali', nombre: 'Ali', clave: 'ali-2026-wa' } });
  if (r.statusCode !== 200) r = await app.inject({ method: 'POST', url: '/login', payload: { usuario: 'ali', clave: 'ali-2026-wa' } });
  return { cookie: galletaDe(r), 'content-type': 'application/json' };
}

/** Lo que salio de verdad (el acuse de lectura no cuenta). */
const enviados = () => wa.sent.filter((s) => s.kind !== 'read');

async function cliente(phone = '51987654321', nombre = 'Maria') {
  const c = await repos.contacts.upsertFromInbound(phone, nombre);
  await repos.contacts.setOptIn(phone, 'prueba');
  await repos.contacts.touchInbound(phone, new Date());
  return c;
}

function entranteTexto(texto: string, phone = '51987654321'): ChangeValue {
  return {
    contacts: [{ wa_id: phone, profile: { name: 'Maria' } }],
    messages: [{ id: `wamid.${Math.random()}`, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: texto } } as InboundMessage],
  };
}

/** Una nota de voz que ya se bajo a .wa-media (como hace el cliente local). */
function entranteAudio(phone = '51987654321'): ChangeValue {
  const id = 'a'.repeat(24) + '.ogg';
  writeFileSync(path.join(mediaDir, id), OGG);
  return {
    contacts: [{ wa_id: phone, profile: { name: 'Maria' } }],
    messages: [{ id: `wamid.${Math.random()}`, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), type: 'audio', media: { id, mimeType: 'audio/ogg; codecs=opus', seconds: 4, voice: true, bytes: OGG.length } } as InboundMessage],
  };
}

beforeAll(async () => {
  mediaDir = mkdtempSync(path.join(tmpdir(), 'wa-voz-'));
  app = await build();
  await app.ready();
});
afterAll(async () => {
  await app.close();
  rmSync(mediaDir, { recursive: true, force: true });
});
beforeEach(async () => {
  await app.close();
  app = await build();
  await app.ready();
});

describe('la pantalla: clave, voz y cuando', () => {
  it('sin clave no esta lista y lo dice; la clave se guarda cifrada y no vuelve; probar lee la cuenta', async () => {
    const h = await admin();
    let e = (await app.inject({ method: 'GET', url: '/admin/voz', headers: h })).json();
    expect(e).toMatchObject({ lista: false, tieneClave: false, motivo: 'Falta la clave de ElevenLabs.', cuando: 'si-manda-audio', transcribir: true, maxCaracteres: 600 });
    expect(e.modelos.map((m: { id: string }) => m.id)).toContain('eleven_multilingual_v2');

    // Sin voz elegida, sigue sin estar lista aunque haya clave.
    const g = await app.inject({ method: 'POST', url: '/admin/voz', headers: h, payload: { clave: 'xi-clave-secreta-1234', activa: true } });
    expect(g.statusCode).toBe(200);
    expect(g.json().estado).toMatchObject({ tieneClave: true, claveTermina: '1234', lista: false, motivo: 'Falta elegir una voz.' });
    expect(JSON.stringify(g.json())).not.toContain('xi-clave-secreta');
    const fila = (await settingsRepo.getAll()).find((r) => r.key === 'voz.clave')!;
    expect(fila.encrypted).toBe(true);
    expect(fila.value).not.toContain('xi-clave-secreta');

    const voces = (await app.inject({ method: 'GET', url: '/admin/voz/voces', headers: h })).json();
    expect(voces.voces[0]).toMatchObject({ id: 'v-lucia', nombre: 'Lucía' });

    const p = (await app.inject({ method: 'POST', url: '/admin/voz/probar', headers: h, payload: {} })).json();
    expect(p.ok).toBe(true);
    expect(p.detalle).toContain('quedan 29,900');
    expect(eleven.fabricadas).toEqual(['xi-clave-secreta-1234']);

    const g2 = await app.inject({ method: 'POST', url: '/admin/voz', headers: h, payload: { vozId: 'v-lucia', vozNombre: 'Lucía', cuando: 'siempre' } });
    expect(g2.json().estado).toMatchObject({ lista: true, motivo: null, vozId: 'v-lucia', cuando: 'siempre' });
    expect(g2.json().mensaje).toContain('contesta siempre con audio');
    e = (await app.inject({ method: 'GET', url: '/admin/voz', headers: h })).json();
    expect(e.cuenta).toMatchObject({ plan: 'starter' });

    // La muestra vuelve en base64 para el <audio> de la pantalla.
    const m = (await app.inject({ method: 'POST', url: '/admin/voz/muestra', headers: h, payload: { vozId: 'v-lucia' } })).json();
    expect(m).toMatchObject({ ok: true, mimeType: 'audio/ogg; codecs=opus', formato: 'opus', bytes: OGG.length });
    expect(Buffer.from(m.audioBase64, 'base64').equals(OGG)).toBe(true);
    expect(eleven.estado.hablado[0]).toContain('Soy la voz de tu asistente');

    // Quitar la clave: se borra la fila y deja de estar lista.
    await app.inject({ method: 'POST', url: '/admin/voz', headers: h, payload: { clave: '' } });
    expect((await settingsRepo.getAll()).some((r) => r.key === 'voz.clave')).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/admin/voz', headers: h })).json()).toMatchObject({ lista: false, tieneClave: false });
  });

  it('solo un administrador cambia la voz', async () => {
    const h = await admin();
    await app.inject({ method: 'POST', url: '/admin/usuarios', headers: h, payload: { usuario: 'rosa', nombre: 'Rosa', clave: 'rosa-1234-clave', rol: 'operador' } });
    const r = await app.inject({ method: 'POST', url: '/login', payload: { usuario: 'rosa', clave: 'rosa-1234-clave' } });
    const ho = { cookie: galletaDe(r), 'content-type': 'application/json' };
    expect((await app.inject({ method: 'POST', url: '/admin/voz', headers: ho, payload: { activa: true } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/admin/voz', headers: ho })).statusCode).toBe(200);
  });
});

describe('el asistente con voz', () => {
  beforeEach(async () => {
    await ia.guardar({ activa: true, token: 'tok', nombreAsistente: 'Lucia', conocimiento: 'Vendemos zapatos. Tallas 35 a 45.', memoria: 6 });
    await voz.guardar({ clave: 'xi-1234-5678', vozId: 'v-lucia', vozNombre: 'Lucía', activa: true, cuando: 'si-manda-audio' });
  });

  it('una nota de voz del cliente se transcribe, el asistente la lee y contesta con audio; el hilo y el webhook lo llevan', async () => {
    await cliente();
    await processChange('messages', entranteAudio(), deps);
    // Se transcribio una vez y el modelo recibio lo que dijo, no "(audio)".
    expect(eleven.estado.transcritos).toBe(1);
    expect(modelo.recibido[0]!.at(-1)).toEqual({ role: 'user', content: 'quiero dos pares talla cuarenta y dos' });
    // La respuesta salio como nota de voz (ptt) con el texto de pie, marcada como del asistente.
    const salida = enviados()[0]!;
    expect(salida).toMatchObject({ kind: 'media', tipo: 'audio', voz: true, mimeType: 'audio/ogg; codecs=opus', caption: 'Claro, tenemos talla 42 en negro y marrón.' });
    expect(eleven.estado.hablado).toEqual(['Claro, tenemos talla 42 en negro y marrón.']);
    // El hilo: el entrante con lo que dijo, el saliente como audio del asistente.
    const c = (await repos.contacts.getByPhone('51987654321'))!;
    const hilo = await repos.messages.listMessages(c.id, 10);
    const entrante = hilo.find((m) => m.direction === 'in')!;
    expect(entrante).toMatchObject({ kind: 'audio', body: 'quiero dos pares talla cuarenta y dos', payload: { transcripcion: 'quiero dos pares talla cuarenta y dos', media: { transcripcion: 'quiero dos pares talla cuarenta y dos' } } });
    const saliente = hilo.find((m) => m.direction === 'out')!;
    expect(saliente).toMatchObject({ kind: 'audio', body: 'Claro, tenemos talla 42 en negro y marrón.', payload: { origen: 'ia', media: { kind: 'audio', voz: true } } });
    expect(existsSync(path.join(mediaDir, (saliente.payload as { media: { id: string } }).media.id))).toBe(true);
    // Los eventos para los webhooks: transcripcion en lo recibido, autor y voz en lo enviado.
    const recibido = eventos.find((e) => e.nombre === 'mensaje.recibido')!;
    expect(recibido.datos.mensaje).toMatchObject({ tipo: 'audio', texto: 'quiero dos pares talla cuarenta y dos', transcripcion: 'quiero dos pares talla cuarenta y dos' });
    const enviado = eventos.find((e) => e.nombre === 'mensaje.enviado')!;
    expect(enviado.datos.mensaje).toMatchObject({ tipo: 'audio', autor: 'ia', voz: true, texto: 'Claro, tenemos talla 42 en negro y marrón.' });
    // Y la API de conversaciones lo expone con nombres fijos.
    const conv = (await app.inject({ method: 'GET', url: '/api/v1/conversaciones/51987654321', headers: con(TODO) })).json();
    expect(conv.mensajes.find((m: { direccion: string }) => m.direccion === 'entrante')).toMatchObject({ tipo: 'audio', transcripcion: 'quiero dos pares talla cuarenta y dos', autor: null });
    expect(conv.mensajes.find((m: { direccion: string }) => m.direccion === 'saliente')).toMatchObject({ tipo: 'audio', autor: 'ia', voz: true });
  });

  it('con "si manda audio", a un texto se contesta por escrito; con "siempre", con audio; con "nunca", nunca', async () => {
    await cliente();
    await processChange('messages', entranteTexto('tienen talla 42?'), deps);
    expect(enviados()[0]).toMatchObject({ kind: 'text', body: 'Claro, tenemos talla 42 en negro y marrón.' });
    expect(eleven.estado.hablado).toEqual([]);

    await voz.guardar({ cuando: 'siempre' });
    await processChange('messages', entranteTexto('y en marrón?'), deps);
    expect(enviados()[1]).toMatchObject({ kind: 'media', tipo: 'audio', voz: true });

    await voz.guardar({ cuando: 'nunca' });
    await processChange('messages', entranteAudio(), deps);
    expect(enviados()[2]).toMatchObject({ kind: 'text' });
    // Pero el audio se sigue entendiendo.
    expect(modelo.recibido.at(-1)!.at(-1)).toEqual({ role: 'user', content: 'quiero dos pares talla cuarenta y dos' });
  });

  it('si ElevenLabs falla o el texto es largo, la respuesta sale por escrito y queda el motivo', async () => {
    await cliente();
    eleven.estado.fallar = new ErrorVoz('Se acabaron los caracteres del plan de ElevenLabs por este mes.', 402, 'cuota');
    await processChange('messages', entranteAudio(), deps);
    // Sin transcripcion posible es un archivo sin texto: no se contesta (pedido del dueño, 06/10).
    expect(enviados()).toHaveLength(0);
    expect(voz.estado().ultimoError?.detalle).toContain('caracteres');

    eleven.estado.fallar = null;
    modelo.estado.siguiente = 'x'.repeat(700);
    await voz.guardar({ cuando: 'siempre', maxCaracteres: 600 });
    await processChange('messages', entranteTexto('hola'), deps);
    expect(enviados()[0]).toMatchObject({ kind: 'text' });
    expect(eleven.estado.hablado).toEqual([]);
  });

  it('sin voz configurada, un audio sin transcribir no se contesta (archivo sin texto)', async () => {
    await voz.guardar({ clave: '' });
    await cliente();
    await processChange('messages', entranteAudio(), deps);
    expect(eleven.estado.transcritos).toBe(0);
    expect(enviados()).toHaveLength(0);
  });

  it('desde el chat, "mandar como audio" manda lo escrito como nota de voz de una persona; si no se puede, lo dice', async () => {
    const h = await admin();
    const c = await cliente();
    const r = await app.inject({ method: 'POST', url: '/admin/chat/send', headers: h, payload: { contactId: c.id, text: 'Ya salió tu pedido, llega mañana.', voz: true } });
    expect(r.json()).toMatchObject({ ok: true, voz: { enviada: true, motivo: null } });
    expect(enviados()[0]).toMatchObject({ kind: 'media', tipo: 'audio', voz: true, caption: 'Ya salió tu pedido, llega mañana.' });
    const hilo = await repos.messages.listMessages(c.id, 5);
    // Firmado por quien esta en sesion, con su nombre de pila.
    expect(hilo.find((m) => m.direction === 'out')!.payload).toMatchObject({ origen: 'persona', autorNombre: 'Ali', media: { voz: true } });
    expect(eventos.find((e) => e.nombre === 'mensaje.enviado')!.datos.mensaje).toMatchObject({ autor: 'persona', autorNombre: 'Ali', voz: true });

    await voz.guardar({ activa: false });
    const r2 = await app.inject({ method: 'POST', url: '/admin/chat/send', headers: h, payload: { contactId: c.id, text: 'Otra cosa.', voz: true } });
    expect(r2.json()).toMatchObject({ ok: true, voz: { enviada: false, motivo: 'La voz está apagada.' } });
    expect(enviados()[1]).toMatchObject({ kind: 'text', body: 'Otra cosa.' });

    // El chat embebido de otro sistema puede decir en nombre de quien escribe.
    await app.inject({ method: 'POST', url: '/admin/chat/send', headers: h, payload: { contactId: c.id, text: 'Soy Rosa de la tienda.', autor: 'persona', autorNombre: 'Rosa' } });
    expect((await repos.messages.listMessages(c.id, 10)).find((m) => m.body === 'Soy Rosa de la tienda.')!.payload).toMatchObject({ origen: 'persona', autorNombre: 'Rosa' });
  });
});

describe('la API para otros sistemas', () => {
  beforeEach(async () => {
    await voz.guardar({ clave: 'xi-1234-5678', vozId: 'v-lucia', activa: true, cuando: 'nunca' });
  });

  it('voz: true manda el texto como nota de voz y dice como salio; autor queda en el hilo y en el webhook', async () => {
    await cliente();
    const r = await app.inject({ method: 'POST', url: '/api/v1/mensajes', headers: con(TODO), payload: { telefono: '51987654321', texto: 'Tu pedido ya está en camino.', voz: true, autor: 'persona', autorNombre: 'Rosa' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, estado: 'enviado', voz: { pedida: true, enviada: true, motivo: null } });
    expect(enviados()[0]).toMatchObject({ kind: 'media', tipo: 'audio', voz: true, caption: 'Tu pedido ya está en camino.' });
    const enviado = eventos.find((e) => e.nombre === 'mensaje.enviado')!;
    expect(enviado.datos.mensaje).toMatchObject({ autor: 'persona', autorNombre: 'Rosa', voz: true });
    const conv = (await app.inject({ method: 'GET', url: '/api/v1/conversaciones/51987654321', headers: con(TODO) })).json();
    expect(conv.mensajes.find((m: { direccion: string }) => m.direccion === 'saliente')).toMatchObject({ autor: 'persona', autorNombre: 'Rosa', voz: true });

    // Muy largo: por escrito, y la respuesta lo explica.
    const largo = await app.inject({ method: 'POST', url: '/api/v1/mensajes', headers: con(TODO), payload: { telefono: '51987654321', texto: 'y'.repeat(650), voz: true } });
    expect(largo.json()).toMatchObject({ ok: true, estado: 'enviado', voz: { pedida: true, enviada: false } });
    expect(largo.json().voz.motivo).toContain('tope para audios');
    expect(enviados()[1]).toMatchObject({ kind: 'text' });

    // Sin voz pedida, ni rastro del campo, y el autor por defecto es "sistema".
    const normal = await app.inject({ method: 'POST', url: '/api/v1/mensajes', headers: con(TODO), payload: { telefono: '51987654321', texto: 'hola' } });
    expect(normal.json().voz).toBeUndefined();
    expect(eventos.filter((e) => e.nombre === 'mensaje.enviado').at(-1)!.datos.mensaje).toMatchObject({ autor: 'sistema', autorNombre: null, voz: false });
  });

  it('media.url baja el fichero y lo manda con su tipo; un audio con voz va como nota de voz; una URL rota se explica', async () => {
    await cliente();
    const foto = await app.inject({ method: 'POST', url: '/api/v1/mensajes', headers: con(TODO), payload: { telefono: '51987654321', media: { url: 'https://stoky.test/fotos/zapato.png', caption: 'Zapato negro 42' }, autor: 'ia' } });
    expect(foto.statusCode).toBe(200);
    expect(enviados()[0]).toMatchObject({ kind: 'media', tipo: 'image', mimeType: 'image/png', caption: 'Zapato negro 42', voz: false });
    const c = (await repos.contacts.getByPhone('51987654321'))!;
    const guardado = (await repos.messages.listMessages(c.id, 5)).find((m) => m.direction === 'out')!;
    expect(guardado).toMatchObject({ kind: 'image', body: 'Zapato negro 42', payload: { origen: 'ia', media: { kind: 'image', mimeType: 'image/png' } } });
    expect(existsSync(path.join(mediaDir, (guardado.payload as { media: { id: string } }).media.id))).toBe(true);

    const nota = await app.inject({ method: 'POST', url: '/api/v1/mensajes', headers: con(TODO), payload: { telefono: '51987654321', media: { url: 'https://stoky.test/nota.ogg', tipo: 'audio', voz: true } } });
    expect(nota.statusCode).toBe(200);
    expect(enviados()[1]).toMatchObject({ kind: 'media', tipo: 'audio', voz: true, mimeType: 'audio/ogg' });

    const rota = await app.inject({ method: 'POST', url: '/api/v1/mensajes', headers: con(TODO), payload: { telefono: '51987654321', media: { url: 'https://stoky.test/no-existe.png' } } });
    expect(rota.statusCode).toBe(400);
    expect(rota.json().error).toContain('respondio 404');

    const tipoMalo = await app.inject({ method: 'POST', url: '/api/v1/mensajes', headers: con(TODO), payload: { telefono: '51987654321', media: { url: 'https://stoky.test/nota.ogg', tipo: 'cancion' } } });
    expect(tipoMalo.statusCode).toBe(400);
    expect(tipoMalo.json().error).toContain('imagen, video, audio o documento');
  });

  it('el contrato OpenAPI documenta voz, media y autor', async () => {
    const doc = (await app.inject({ method: 'GET', url: '/api/v1/openapi.json', headers: con(TODO) })).json();
    // El cuerpo es una referencia a components.schemas.NuevoMensaje.
    expect(doc.paths['/mensajes'].post.requestBody.content['application/json'].schema).toEqual({ $ref: '#/components/schemas/NuevoMensaje' });
    const props = doc.components.schemas.NuevoMensaje.properties;
    expect(props.voz).toBeTruthy();
    expect(props.media).toBeTruthy();
    expect(props.autor).toBeTruthy();
    const mensaje = doc.components.schemas.Mensaje.properties;
    expect(mensaje.autor).toBeTruthy();
    expect(mensaje.transcripcion).toBeTruthy();
  });
});
