/**
 * Guardar en la biblioteca un sticker que mandó un cliente.
 *
 * Pedido del dueño: ve un sticker que le gusta en un chat y quiere quedárselo.
 * El fichero YA está en el servidor —llegó con el mensaje—, así que obligarle
 * a descargarlo y volver a subirlo a mano por el panel era pedirle trabajo
 * para mover un archivo de una carpeta a la de al lado.
 */

import { mkdtempSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { crearServicioAjustes } from '../src/ajustes/generales.js';
import { crearServicioStickers } from '../src/stickers/stickers.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp } from './fakes.js';

const ENV = {
  PUBLIC_BASE_URL: 'https://wa.ejemplo.pe',
  DATABASE_URL: 'postgres://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'lima',
  BUSINESS_NAME: 'La Tienda',
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

function cookieDe(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const uno = Array.isArray(raw) ? raw[0] : String(raw ?? '');
  return uno.split(';')[0] ?? '';
}

/** Una imagen de verdad: el servicio la convierte a WebP 512x512. */
async function pngDePrueba(): Promise<Buffer> {
  return sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 10, g: 180, b: 120, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

describe('POST /admin/stickers/desde-chat', () => {
  let app: FastifyInstance;
  let operador = '';
  let mediaDir = '';

  /** El nombre que le pone `idDeMedia`: 24 hex y su extensión. */
  const MEDIA_ID = 'a1b2c3d4e5f60718293a4b5c.webp';

  beforeAll(async () => {
    const config = loadConfig(ENV);
    const repos = createFakeRepos();
    const wa = createFakeWhatsApp();
    const settings = await createFakeSettings(config);
    const ajustes = await crearServicioAjustes({ repo: repos.ajustesGenerales, config, releerCadaMs: 0 });
    const sender = createSender({
      repos,
      wa,
      phoneNumberId: 'PNID',
      warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 },
      maxMarketingPerContact7d: 2,
    });

    mediaDir = mkdtempSync(path.join(tmpdir(), 'chat-media-'));
    await writeFile(path.join(mediaDir, MEDIA_ID), await pngDePrueba());

    const stickers = crearServicioStickers({
      repo: repos.stickers,
      mediaDir: mkdtempSync(path.join(tmpdir(), 'st-')),
      sender,
      ajustes,
      publicBase: config.PUBLIC_BASE_URL,
    });

    app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false, ajustes, stickers, mediaDir });
    await app.ready();

    const admin = cookieDe(
      await app.inject({
        method: 'POST',
        url: '/login/primera-cuenta',
        payload: { nombre: 'Ali', usuario: 'ali', clave: 'clave-segura-1' },
      }),
    );
    await app.inject({
      method: 'POST',
      url: '/admin/usuarios',
      headers: { cookie: admin },
      payload: { nombre: 'Rosa', usuario: 'rosa', clave: 'rosa-clave-1' },
    });
    operador = cookieDe(
      await app.inject({
        method: 'POST',
        url: '/login',
        payload: { usuario: 'rosa', clave: 'rosa-clave-1' },
        remoteAddress: '10.0.0.7',
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('guarda el sticker del chat en la biblioteca y queda listo para mandarlo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/stickers/desde-chat',
      headers: { cookie: operador },
      payload: { mediaId: MEDIA_ID, nombre: 'El pulgar de Roberto' },
    });

    expect(res.statusCode).toBe(200);
    const creado = res.json().sticker;
    expect(creado.nombre).toBe('El pulgar de Roberto');

    // Ya está en la biblioteca, que es la que ve el botón de stickers del chat.
    const lista = (await app.inject({ method: 'GET', url: '/admin/stickers', headers: { cookie: operador } })).json();
    expect(lista.stickers.map((s: { id: string }) => s.id)).toContain(creado.id);

    // Y se sirve como sticker de verdad: WebP, que es lo único que acepta WhatsApp.
    const publico = await app.inject({ method: 'GET', url: '/stickers/' + creado.archivo });
    expect(publico.statusCode).toBe(200);
    expect(publico.headers['content-type']).toContain('image/webp');
  });

  it('sin nombre se guarda igual, con uno por defecto', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/stickers/desde-chat',
      headers: { cookie: operador },
      payload: { mediaId: MEDIA_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().sticker.nombre).toBe('Sticker del chat');
  });

  it('un adjunto que ya no está responde 404 y no inventa un sticker vacío', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/stickers/desde-chat',
      headers: { cookie: operador },
      payload: { mediaId: 'ffffffffffffffffffffffff.webp', nombre: 'Fantasma' },
    });

    expect(res.statusCode).toBe(404);
  });

  /**
   * El id viaja desde el navegador: si se aceptara cualquier cosa, se podría
   * pedir un fichero de fuera de la carpeta de adjuntos.
   */
  it('no deja escaparse de la carpeta de adjuntos', async () => {
    for (const mediaId of ['../.env', '..%2F.env', 'sub/dir.webp']) {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/stickers/desde-chat',
        headers: { cookie: operador },
        payload: { mediaId, nombre: 'Nope' },
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it('sin sesión no se guarda nada', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/stickers/desde-chat',
      payload: { mediaId: MEDIA_ID, nombre: 'Sin permiso' },
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});
