/**
 * Stickers: que una imagen cualquiera se vuelva un sticker de WhatsApp (WebP
 * 512x512), que se guarde y se sirva, que se mande por el sender como un
 * mensaje mas (y se vea en el chat), que salga solo tras el saludo, el gracias
 * y la despedida segun la configuracion, y que la API lo exponga bien.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import type { Pool } from '../src/db/pool.js';
import { crearServicioAjustes } from '../src/ajustes/generales.js';
import { archivoValido, crearServicioStickers, createStickersRepo, idDeSticker, prepararSticker, type ServicioStickers } from '../src/stickers/stickers.js';
import { turnoDePreventa } from '../src/handlers/inbound.js';
import { processChange } from '../src/whatsapp/webhook.js';
import type { ChangeValue } from '../src/whatsapp/types.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp, type FakeRepos, type FakeWhatsApp } from './fakes.js';

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

/** Una imagen de prueba: un rectangulo rojo de 300x200 en PNG. */
async function pngDePrueba(): Promise<Buffer> {
  return sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 220, g: 30, b: 30, alpha: 1 } } }).png().toBuffer();
}

function cookieDe(res: { headers: Record<string, unknown> }): string {
  const set = res.headers['set-cookie'];
  const linea = Array.isArray(set) ? set[0] : (set as string | undefined);
  return (linea as string).split(';')[0]!;
}

describe('convertir a sticker', () => {
  it('un PNG apaisado sale como WebP 512x512 con transparencia y ligero', async () => {
    const webp = await prepararSticker(await pngDePrueba());
    const meta = await sharp(webp).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
    expect(meta.hasAlpha).toBe(true);
    expect(webp.length).toBeLessThan(500 * 1024);
    // El id sale del contenido: la misma imagen, el mismo id.
    expect(idDeSticker(webp)).toBe(idDeSticker(webp));
    expect(idDeSticker(webp)).toMatch(/^st-[0-9a-f]{12}$/);
    expect(archivoValido(idDeSticker(webp) + '.webp')).toBe(true);
    expect(archivoValido('../x.webp')).toBe(false);
    // Uno que ya es sticker se deja tal cual.
    expect(await prepararSticker(webp)).toBe(webp);
  });

  it('algo que no es una imagen se rechaza con un mensaje claro', async () => {
    const repos = createFakeRepos();
    const sender = createSender({ repos, wa: createFakeWhatsApp(), phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
    const servicio = crearServicioStickers({ repo: repos.stickers, mediaDir: mkdtempSync(path.join(tmpdir(), 'st-')), sender, publicBase: 'https://wa.ejemplo.pe' });
    await expect(servicio.subir({ nombre: 'x', uso: 'otro', datosBase64: Buffer.from('esto no es una imagen').toString('base64') })).rejects.toThrow(/No se pudo leer la imagen/);
  });
});

describe('servicio: guardar, mandar y automaticos', () => {
  let repos: FakeRepos;
  let wa: FakeWhatsApp;
  let servicio: ServicioStickers;
  let ajustes: Awaited<ReturnType<typeof crearServicioAjustes>>;

  beforeAll(async () => {
    const config = loadConfig(ENV);
    repos = createFakeRepos();
    wa = createFakeWhatsApp();
    ajustes = await crearServicioAjustes({ repo: repos.ajustesGenerales, config, releerCadaMs: 0 });
    const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2, serviceWindowApplies: () => false });
    servicio = crearServicioStickers({ repo: repos.stickers, mediaDir: mkdtempSync(path.join(tmpdir(), 'st-')), sender, ajustes, publicBase: 'https://wa.ejemplo.pe/' });
  });

  it('sube, lista, sirve y manda; el chat lo ve como sticker con su url publica', async () => {
    const s = await servicio.subir({ nombre: 'Hola', uso: 'inicio', datosBase64: 'data:image/png;base64,' + (await pngDePrueba()).toString('base64') });
    expect(s).toMatchObject({ nombre: 'Hola', uso: 'inicio' });
    expect(s.archivo).toBe(s.id + '.webp');
    expect((await servicio.listar()).map((x) => x.id)).toEqual([s.id]);
    const fichero = await servicio.leer(s.archivo);
    expect(fichero && fichero.length).toBe(s.bytes);

    const contacto = await repos.contacts.upsertFromInbound('51912426667', 'Luis');
    await repos.contacts.setOptIn(contacto.phone, 'prueba');
    const r = await servicio.enviar('51912426667', s.id, { manual: true });
    expect(r).toMatchObject({ ok: true });
    const ultimo = wa.sent.at(-1)!;
    expect(ultimo).toMatchObject({ kind: 'sticker', to: '51912426667', bytes: s.bytes, url: 'https://wa.ejemplo.pe/stickers/' + s.archivo });
    const guardado = repos.messages._all.at(-1)!;
    expect(guardado.kind).toBe('sticker');
    expect(guardado.payload).toMatchObject({ media: { kind: 'sticker', url: '/stickers/' + s.archivo } });

    expect(await servicio.enviar('51912426667', 'st-no-existe')).toMatchObject({ ok: false, error: expect.stringContaining('no existe') });
  });

  it('los automaticos salen solo si estan configurados, y el del reparto solo si se marca', async () => {
    const s = (await servicio.listar())[0]!;
    const antes = wa.sent.length;
    await servicio.automatico('inicio', '51912426667');
    expect(wa.sent.length).toBe(antes); // sin configurar, nada
    await ajustes.guardar({ stickers: { inicio: s.id, inicioEnReparto: false, gracias: null, despedida: s.id } });
    await servicio.automatico('inicio', '51912426667');
    expect(wa.sent.length).toBe(antes + 1);
    await servicio.automatico('inicio', '51912426667', { reparto: true });
    expect(wa.sent.length).toBe(antes + 1); // en el reparto no, salvo que se marque
    await ajustes.guardar({ stickers: { inicio: s.id, inicioEnReparto: true, gracias: null, despedida: s.id } });
    await servicio.automatico('inicio', '51912426667', { reparto: true });
    expect(wa.sent.length).toBe(antes + 2);
    await servicio.automatico('gracias', '51912426667');
    expect(wa.sent.length).toBe(antes + 2);
    await servicio.automatico('despedida', '51912426667');
    expect(wa.sent.length).toBe(antes + 3);
    // Uno bloqueado por las guardas no lanza: un adorno no rompe nada.
    await repos.contacts.setOptOut('51912426667');
    await expect(servicio.automatico('despedida', '51912426667')).resolves.toBeUndefined();
  });

  it('borrar quita el fichero y la fila', async () => {
    const s = (await servicio.listar())[0]!;
    expect(await servicio.borrar(s.id)).toBe(true);
    expect(await servicio.listar()).toEqual([]);
    expect(await servicio.leer(s.archivo)).toBeNull();
    expect(await servicio.borrar(s.id)).toBe(false);
  });
});

describe('tras el saludo del asistente', () => {
  it('a un cliente nuevo le llega el saludo y, detras, el sticker de inicio', async () => {
    const config = loadConfig(ENV);
    const repos = createFakeRepos();
    const wa = createFakeWhatsApp();
    const settings = await createFakeSettings(config);
    const ajustes = await crearServicioAjustes({ repo: repos.ajustesGenerales, config, releerCadaMs: 0 });
    const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
    const stickers = crearServicioStickers({ repo: repos.stickers, mediaDir: mkdtempSync(path.join(tmpdir(), 'st-')), sender, ajustes, publicBase: 'https://wa.ejemplo.pe' });
    const s = await stickers.subir({ nombre: 'Hola', uso: 'inicio', datosBase64: (await pngDePrueba()).toString('base64') });
    await ajustes.guardar({ stickers: { inicio: s.id, inicioEnReparto: false, gracias: null, despedida: null } });

    const contact = await repos.contacts.upsertFromInbound('51987654321', 'Ana');
    contact.lastInboundAt = new Date();
    await turnoDePreventa(contact, { texto: 'hola', esPrimerMensaje: true }, { repos, sender, wa, config, stickers });
    const tipos = wa.sent.map((m) => m.kind);
    expect(tipos.length).toBeGreaterThanOrEqual(2);
    expect(tipos.at(-1)).toBe('sticker');
    expect(tipos.at(-2)).not.toBe('sticker');
    // El segundo mensaje del mismo cliente ya no lleva sticker.
    const n = wa.sent.length;
    await turnoDePreventa(contact, { texto: 'quiero enviar un paquete', esPrimerMensaje: false }, { repos, sender, wa, config, stickers });
    expect(wa.sent.slice(n).map((m) => m.kind)).not.toContain('sticker');
  });

  it('cuando el cliente manda su ubicacion para el reparto, sale el gracias y su sticker', async () => {
    const config = loadConfig(ENV);
    const repos = createFakeRepos();
    const wa = createFakeWhatsApp();
    const settings = await createFakeSettings(config);
    const ajustes = await crearServicioAjustes({ repo: repos.ajustesGenerales, config, releerCadaMs: 0 });
    const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
    const stickers = crearServicioStickers({ repo: repos.stickers, mediaDir: mkdtempSync(path.join(tmpdir(), 'st-')), sender, ajustes, publicBase: 'https://wa.ejemplo.pe' });
    const s = await stickers.subir({ nombre: 'Gracias', uso: 'gracias', datosBase64: (await pngDePrueba()).toString('base64') });
    await ajustes.guardar({ stickers: { inicio: null, inicioEnReparto: false, gracias: s.id, despedida: null } });

    const lote = await repos.rutas.crearLote({ nombre: 'Hoy' });
    await repos.rutas.agregarSolicitudes(lote.id, [{ telefonoCrudo: '51987654321', phone: '51987654321', nombre: 'Ana', referencia: 'P-1', estado: 'enviado' }]);
    const cambio: ChangeValue = {
      contacts: [{ wa_id: '51987654321', profile: { name: 'Ana' } }],
      messages: [{ id: 'wamid.ubi.1', from: '51987654321', timestamp: String(Math.floor(Date.now() / 1000)), type: 'location', location: { latitude: -12.0464, longitude: -77.0428 } } as never],
    };
    await processChange('messages', cambio, { repos, wa, sender, config, settings, stickers });
    const tipos = wa.sent.map((m) => m.kind).filter((k) => k !== 'read');
    expect(tipos).toEqual(['text', 'sticker']);
    expect(String(wa.sent.find((m) => m.kind === 'text')!.body)).toContain('recibimos su ubicación');
  });
});

describe('/admin/stickers', () => {
  let app: FastifyInstance;
  let admin = '';
  let operador = '';
  let servicio: ServicioStickers;

  beforeAll(async () => {
    const config = loadConfig(ENV);
    const repos = createFakeRepos();
    const wa = createFakeWhatsApp();
    const settings = await createFakeSettings(config);
    const ajustes = await crearServicioAjustes({ repo: repos.ajustesGenerales, config, releerCadaMs: 0 });
    const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
    servicio = crearServicioStickers({ repo: repos.stickers, mediaDir: mkdtempSync(path.join(tmpdir(), 'st-')), sender, ajustes, publicBase: config.PUBLIC_BASE_URL });
    app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false, ajustes, stickers: servicio });
    await app.ready();
    admin = cookieDe(await app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { nombre: 'Ali', usuario: 'ali', clave: 'clave-segura-1' } }));
    await app.inject({ method: 'POST', url: '/admin/usuarios', headers: { cookie: admin }, payload: { nombre: 'Rosa', usuario: 'rosa', clave: 'rosa-clave-1' } });
    operador = cookieDe(await app.inject({ method: 'POST', url: '/login', payload: { usuario: 'rosa', clave: 'rosa-clave-1' }, remoteAddress: '10.0.0.6' }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('sube, lista, sirve en publico, configura (solo admin) y borra limpiando la configuracion', async () => {
    const subida = await app.inject({ method: 'POST', url: '/admin/stickers', headers: { cookie: operador }, payload: { nombre: 'Adiós', uso: 'despedida', datos: 'data:image/png;base64,' + (await pngDePrueba()).toString('base64') } });
    expect(subida.statusCode).toBe(200);
    const s = subida.json().sticker as { id: string; archivo: string };
    const lista = (await app.inject({ method: 'GET', url: '/admin/stickers', headers: { cookie: operador } })).json();
    expect(lista.stickers.map((x: { id: string }) => x.id)).toEqual([s.id]);
    expect(lista.usos.map((u: { id: string }) => u.id)).toEqual(['inicio', 'gracias', 'despedida', 'otro']);

    const publico = await app.inject({ method: 'GET', url: '/stickers/' + s.archivo });
    expect(publico.statusCode).toBe(200);
    expect(publico.headers['content-type']).toContain('image/webp');
    expect((await app.inject({ method: 'GET', url: '/stickers/st-000000000000.webp' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/stickers/..%2Fx.webp' })).statusCode).toBe(404);

    const noAdmin = await app.inject({ method: 'POST', url: '/admin/stickers/configuracion', headers: { cookie: operador }, payload: { despedida: s.id } });
    expect(noAdmin.statusCode).toBe(403);
    const cfg = await app.inject({ method: 'POST', url: '/admin/stickers/configuracion', headers: { cookie: admin }, payload: { despedida: s.id, inicioEnReparto: true } });
    expect(cfg.json().configuracion).toMatchObject({ despedida: s.id, inicioEnReparto: true, inicio: null });
    expect(servicio.configuracion().despedida).toBe(s.id);
    const malo = await app.inject({ method: 'POST', url: '/admin/stickers/configuracion', headers: { cookie: admin }, payload: { inicio: 'st-no-existe' } });
    expect(malo.statusCode).toBe(400);

    const sinTelefono = await app.inject({ method: 'POST', url: `/admin/stickers/${s.id}/enviar`, headers: { cookie: operador }, payload: {} });
    expect(sinTelefono.statusCode).toBe(400);

    const borrado = await app.inject({ method: 'DELETE', url: `/admin/stickers/${s.id}`, headers: { cookie: admin } });
    expect(borrado.statusCode).toBe(200);
    expect(servicio.configuracion().despedida).toBeNull();
    expect((await app.inject({ method: 'GET', url: '/stickers/' + s.archivo })).statusCode).toBe(404);
  });

  it('una respuesta rapida puede llevar un sticker pegado', async () => {
    const r = await app.inject({ method: 'POST', url: '/admin/chat/atajos', headers: { cookie: admin }, payload: { atajos: [{ atajo: 'chau', texto: 'Hasta luego, {nombre}.', sticker: 'st-abc' }] } });
    expect(r.statusCode).toBe(200);
    expect(r.json().atajos[0]).toMatchObject({ atajo: 'chau', sticker: 'st-abc' });
  });
});

describe('stickers en SQL', () => {
  const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');
  let db: PGlite;
  let pool: Pool;

  beforeAll(async () => {
    db = new PGlite();
    const query = async (text: string, params?: unknown[]) => {
      const result = await db.query(text, params as never[], { parsers: { 20: (v: string) => Number.parseInt(v, 10) } });
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    };
    pool = { query, connect: async () => ({ query, release: () => undefined }), end: async () => db.close() } as unknown as Pool;
    const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) await db.exec(await readFile(path.join(MIGRATIONS, file), 'utf8'));
  });

  afterAll(async () => {
    await pool.end();
  });

  it('crea, lista ordenado por uso, actualiza por id y borra', async () => {
    const repo = createStickersRepo(pool);
    await repo.crear({ id: 'st-aaaaaaaaaaaa', nombre: 'Chau', uso: 'despedida', archivo: 'st-aaaaaaaaaaaa.webp', bytes: 100 });
    await repo.crear({ id: 'st-bbbbbbbbbbbb', nombre: 'Hola', uso: 'inicio', archivo: 'st-bbbbbbbbbbbb.webp', bytes: 200 });
    await repo.crear({ id: 'st-aaaaaaaaaaaa', nombre: 'Chau v2', uso: 'despedida', archivo: 'st-aaaaaaaaaaaa.webp', bytes: 100 });
    const lista = await repo.listar();
    expect(lista.map((s) => s.nombre)).toEqual(['Chau v2', 'Hola']);
    expect((await repo.get('st-bbbbbbbbbbbb'))?.bytes).toBe(200);
    expect(await repo.borrar('st-bbbbbbbbbbbb')).toBe(true);
    expect(await repo.borrar('st-bbbbbbbbbbbb')).toBe(false);
    expect((await repo.listar()).length).toBe(1);
  });
});
