import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

// Simula el WhatsApp Business por QR (Baileys) de punta a punta, sin telefono:
// el socket y la descarga de Baileys son de pega; todo lo demas es el codigo real
// (traductor del cliente local, guardado en disco, chat, eventos, enlaces firmados
// y el sender saliente con el cliente local).
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 1)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(300, 2)]);
const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(300, 3)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([7, 7, 7, 7]), Buffer.from('WEBP'), Buffer.alloc(300, 4)]);
const BYTES: Record<string, Buffer> = { imageMessage: JPEG, videoMessage: MP4, audioMessage: OGG, stickerMessage: WEBP };

vi.mock('@whiskeysockets/baileys', async (original) => ({
  ...(await original<typeof import('@whiskeysockets/baileys')>()),
  downloadMediaMessage: async (m: { message?: Record<string, unknown> }) => {
    const clave = Object.keys(m.message ?? {}).find((k) => BYTES[k]);
    if (!clave) throw new Error('sin fichero');
    return BYTES[clave];
  },
}));

import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { processChange } from '../src/whatsapp/webhook.js';
import { createLocalClient } from '../src/whatsapp/local/client.js';
import { resetLocalForTests, startLocal, type LocalSocket } from '../src/whatsapp/local/session.js';
import { crearBus } from '../src/eventos/bus.js';
import { observarRepos } from '../src/eventos/observar.js';
import { createFakeRepos, createFakeSettings, type FakeRepos } from './fakes.js';

const config = loadConfig({
  PUBLIC_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'mysql://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_ID: '123456',
  WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'none',
} as NodeJS.ProcessEnv);
const queue: OutboundQueue = { async enqueue() {}, async enqueueMany(j) { return j.length; }, async pause() {}, async resume() {}, async counts() { return {}; }, async close() {} };

const CLIENTE = '51987603111';
const mediaDir = mkdtempSync(join(tmpdir(), 'qr-media-'));
const authDir = mkdtempSync(join(tmpdir(), 'qr-auth-'));
const eventos: Array<{ nombre: string; payload: any }> = [];
const enviados: Array<{ jid: string; content: any; options?: unknown }> = [];
let app: FastifyInstance;
let repos: FakeRepos;
let sender: ReturnType<typeof createSender>;
let deps: Parameters<typeof processChange>[2];
const ruta = (url: string) => new URL(url).pathname;

function socketDePega() {
  const handlers = new Map<string, (arg: unknown) => void>();
  const sock: LocalSocket = {
    async sendMessage(jid, content, options) { enviados.push({ jid, content, options }); return { key: { id: `wamid-qr-${enviados.length}` } }; },
    async readMessages() {},
    async requestPairingCode() { return 'ABCD1234'; },
    async logout() {},
    end() {},
    ev: { on: (evento, handler) => handlers.set(evento, handler as (arg: unknown) => void) },
    user: { id: '51900000000:1@s.whatsapp.net', name: 'Mi Negocio' },
  };
  return { sock, emitir: (e: string, arg: unknown) => handlers.get(e)?.(arg), listo: async () => { for (let i = 0; i < 100 && !handlers.has('connection.update'); i++) await new Promise((r) => setTimeout(r, 5)); } };
}
let emitir: (e: string, arg: unknown) => void;

beforeAll(async () => {
  resetLocalForTests();
  const bus = crearBus();
  bus.escucharTodo((nombre, payload) => { eventos.push({ nombre, payload }); });
  repos = observarRepos(createFakeRepos(), bus, { publicBase: config.PUBLIC_BASE_URL, secreto: config.TRACKING_SECRET }) as FakeRepos;
  const settings = await createFakeSettings(config);
  const wa = createLocalClient();
  sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
  deps = { repos, wa, sender, config, settings };
  app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false, mediaDir });
  await app.ready();

  const s = socketDePega();
  emitir = s.emitir;
  const arranque = startLocal({
    authDir, mediaDir, importarHistorial: false, soloTextoUbicacion: true,
    aceptarEntrante: async (phone: string) => phone === CLIENTE,
    onChange: (change) => { void processChange('messages', change, deps); },
    createSocket: async () => ({ sock: s.sock, saveCreds: async () => {} }),
  });
  await s.listo();
  s.emitir('connection.update', { connection: 'open' });
  await arranque;
});
afterAll(async () => {
  await app.close();
  resetLocalForTests();
  rmSync(mediaDir, { recursive: true, force: true });
  rmSync(authDir, { recursive: true, force: true });
});

const entrante = (id: string, contenido: Record<string, unknown>) => ({ key: { id, remoteJid: `${CLIENTE}@s.whatsapp.net`, fromMe: false }, messageTimestamp: Math.floor(Date.now() / 1000), pushName: 'Rosa', message: contenido });

describe('QR: el cliente manda foto, video, audio y sticker', () => {
  it('cada uno se baja al llegar, queda en el chat, no se le contesta y le llega a GSG con un enlace que abre el fichero', async () => {
    emitir('messages.upsert', {
      type: 'notify',
      messages: [
        entrante('IN-FOTO', { imageMessage: { mimetype: 'image/jpeg', caption: 'el comprobante' } }),
        entrante('IN-VIDEO', { videoMessage: { mimetype: 'video/mp4', seconds: 5 } }),
        entrante('IN-AUDIO', { audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true, seconds: 3 } }),
        entrante('IN-STICKER', { stickerMessage: { mimetype: 'image/webp' } }),
      ],
    });
    await vi.waitFor(() => expect(repos.messages._all.filter((m) => m.direction === 'in')).toHaveLength(4), { timeout: 5000 });

    const recibidos = eventos.filter((e) => e.nombre === 'mensaje.recibido').map((e) => e.payload);
    expect(recibidos).toHaveLength(4);
    const esperado: Array<[string, string, Buffer]> = [['image', 'imagen', JPEG], ['video', 'video', MP4], ['audio', 'audio', OGG], ['sticker', 'sticker', WEBP]];
    for (const [kind, tipo, bytes] of esperado) {
      const ev = recibidos.find((r) => r.mensaje.tipo === kind);
      expect(ev, kind).toBeTruthy();
      expect(ev.mensaje.archivo, kind).toMatchObject({ tipo, bytes: bytes.length });
      // El fichero esta en el disco, tal cual llego.
      const guardado = repos.messages._all.find((m) => m.kind === kind && m.direction === 'in')!;
      const id = (guardado.payload as any).media.id as string;
      expect(existsSync(join(mediaDir, id)), kind).toBe(true);
      expect(readFileSync(join(mediaDir, id)).equals(bytes), kind).toBe(true);
      // Y el enlace que recibe GSG lo abre sin clave.
      const r = await app.inject({ method: 'GET', url: ruta(ev.mensaje.archivo.url) });
      expect(r.statusCode, kind).toBe(200);
      expect(r.rawPayload.equals(bytes), kind).toBe(true);
    }
    // El audio llega como nota de voz y la foto con su pie.
    expect((recibidos.find((r) => r.mensaje.tipo === 'audio').mensaje.archivo as any).voz).toBe(true);
    expect(repos.messages._all.find((m) => m.kind === 'image')!.body).toBe('el comprobante');
    // El bot no contesta a archivos.
    expect(enviados.filter((e) => e.content?.text)).toHaveLength(0);
  });
});

describe('QR: GSG manda foto, video y audio al cliente', () => {
  const mandar = (media: Record<string, unknown>) => sender.send({ phone: CLIENTE, kind: 'media', category: 'UTILITY', manual: true, origen: 'persona', autorNombre: 'Ana', atiendePersona: true, media: media as never });

  it('la foto y el video salen por el socket con su pie; el audio sale como nota de voz', async () => {
    const antes = enviados.length;
    expect((await mandar({ id: 'a'.repeat(24) + '.jpg', kind: 'image', datos: JPEG, mimeType: 'image/jpeg', caption: 'La puerta' })).ok).toBe(true);
    expect((await mandar({ id: 'b'.repeat(24) + '.mp4', kind: 'video', datos: MP4, mimeType: 'video/mp4', caption: 'Mira' })).ok).toBe(true);
    expect((await mandar({ id: 'c'.repeat(24) + '.ogg', kind: 'audio', datos: OGG, mimeType: 'audio/ogg', voz: true })).ok).toBe(true);
    const nuevos = enviados.slice(antes);
    expect(nuevos).toHaveLength(3);
    expect(nuevos[0]).toMatchObject({ jid: `${CLIENTE}@s.whatsapp.net`, content: { image: JPEG, mimetype: 'image/jpeg', caption: 'La puerta' } });
    expect(nuevos[1]).toMatchObject({ content: { video: MP4, mimetype: 'video/mp4', caption: 'Mira' } });
    expect(nuevos[2]).toMatchObject({ content: { audio: OGG, ptt: true } });
  });

  it('lo enviado queda en el chat firmado por la persona y GSG recibe el aviso con el enlace al mismo fichero', async () => {
    const salientes = eventos.filter((e) => e.nombre === 'mensaje.enviado').map((e) => e.payload).filter((p) => ['image', 'video', 'audio'].includes(p.mensaje.tipo));
    expect(salientes.length).toBeGreaterThanOrEqual(3);
    for (const p of salientes) expect(p.mensaje).toMatchObject({ autor: 'persona', autorNombre: 'Ana' });
    const foto = salientes.find((p) => p.mensaje.tipo === 'image')!;
    expect(foto.mensaje.archivo).toMatchObject({ tipo: 'imagen', bytes: JPEG.length });
  });
});
