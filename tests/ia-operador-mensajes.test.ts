/**
 * La IA operadora mandandole a un numero lo que se le pida (29/09): «si le
 * pido que a tal numero le mande un mensaje, plantilla o lo que quiera, que
 * si pueda».
 *
 * Lo que se prueba: plantilla aprobada con sus variables (la tarjeta enseña
 * el texto final; faltan datos, no aprobada, no existe o hay varias ->
 * se dice o se pregunta), sticker de la biblioteca, pin de ubicacion, el
 * mismo texto a varios numeros sueltos con una sola tarjeta, responder
 * citando y reenviar lo que mando otro chat. Siempre: sin «Hacerlo» no sale
 * nada; con «Hacerlo» sale por la misma ruta que el chat del panel.
 *
 * El modelo es un doble que contesta lo que la prueba le diga.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { createSettingsService } from '../src/settings/service.js';
import { crearServicioAjustes } from '../src/ajustes/generales.js';
import { crearServicioIA } from '../src/ia/servicio.js';
import type { ProveedorIA } from '../src/ia/proveedores.js';
import { ACCIONES, prepararAccion } from '../src/ia/acciones.js';
import { ACCIONES_MENSAJES, candidatasPlantilla, textoDePlantilla } from '../src/ia/acciones-mensajes.js';
import { crearServicioStickers, type ServicioStickers } from '../src/stickers/stickers.js';
import type { Template } from '../src/db/repos.js';
import { createFakeRepos, createFakeWhatsApp, createMemorySettingsRepo, TEST_SETTINGS_KEY, type FakeRepos, type FakeWhatsApp } from './fakes.js';

type Json = Record<string, any>;
const bloque = (...acciones: Array<Record<string, unknown>>) => `Listo, revisa la tarjeta.\n[ACCIONES]\n${acciones.map((a) => JSON.stringify(a)).join('\n')}\n[/ACCIONES]`;

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
} as NodeJS.ProcessEnv;

const cola: OutboundQueue = {
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

async function sesion(app: FastifyInstance): Promise<Record<string, string>> {
  const primera = await app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { usuario: 'ali', nombre: 'Ali', clave: 'ali-2026-wa' } });
  const cookie = (primera.headers['set-cookie'] as string | string[] | undefined) ?? '';
  return { cookie: (Array.isArray(cookie) ? (cookie[0] ?? '') : cookie).split(';')[0]!, 'content-type': 'application/json' };
}

async function ordenar(t: Tienda, texto: string, ...respuestas: string[]): Promise<Json> {
  t.respuestas.push(...respuestas);
  const r = await t.app.inject({ method: 'POST', url: '/admin/ia/ordenes', headers: t.h, payload: { texto } });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}
async function hacer(t: Tienda, pendientes: Json[]): Promise<Json[]> {
  const r = await t.app.inject({ method: 'POST', url: '/admin/ia/ordenes/confirmar', headers: t.h, payload: { acciones: pendientes.map((p) => ({ accion: p.accion, ...p.parametros })), orden: '' } });
  expect(r.statusCode, r.body).toBe(200);
  return r.json().hechas;
}

interface Tienda {
  app: FastifyInstance;
  repos: FakeRepos;
  wa: FakeWhatsApp;
  h: Record<string, string>;
  respuestas: string[];
  stickers: ServicioStickers;
  cerrar(): Promise<void>;
}

const abiertas: Tienda[] = [];
afterEach(async () => {
  while (abiertas.length) await abiertas.pop()!.cerrar();
});

async function tienda(): Promise<Tienda> {
  const dir = mkdtempSync(path.join(tmpdir(), 'ia-mensajes-'));
  const config = { ...loadConfig(ENV), ARCHIVE_DIR: dir };
  const repos = createFakeRepos();
  const wa = createFakeWhatsApp();
  const settingsRepo = createMemorySettingsRepo();
  const settings = await createSettingsService(settingsRepo, config, TEST_SETTINGS_KEY);
  await settings.save({ provider: 'local' });
  const ajustes = await crearServicioAjustes({ repo: repos.ajustesGenerales, config, releerCadaMs: 0 });
  const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 500, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2, serviceWindowApplies: false, soloNumeros: () => ajustes.soloNumeros() });
  const stickers = crearServicioStickers({ repo: repos.stickers, mediaDir: dir, sender, ajustes, publicBase: 'http://localhost:3000' });
  const respuestas: string[] = [];
  const proveedor: ProveedorIA = { nombre: 'falso', async chat() { return respuestas.shift() ?? 'No sé.'; } };
  const ia = await crearServicioIA({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, repos, sender, config, nombreNegocio: () => 'Zapateria Lima', proveedor, modelosGratis: ['google/gemma-4-31b-it'] });
  await ia.guardar({ token: 'tok' });
  const app = await buildServer({ config, repos, settings, wa, sender, queue: cola, logger: false, ia, ajustes, stickers, mediaDir: dir });
  await app.ready();
  const t: Tienda = { app, repos, wa, h: await sesion(app), respuestas, stickers, async cerrar() { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
  abiertas.push(t);
  return t;
}

const plantilla = (name: string, body: string, variables: number, extra: Partial<Template> = {}): Template => ({ name, language: 'es', category: 'UTILITY', status: 'APPROVED', quality: null, variables, body, ...extra });

async function conPlantillas(t: Tienda): Promise<void> {
  await t.repos.templates.upsert(plantilla('aviso_pedido', 'Hola {{1}}, tu pedido {{2}} sale hoy.', 2, { variablesDoc: ['nombre del cliente', 'número de pedido'] }));
  await t.repos.templates.upsert(plantilla('recordatorio_pago', 'Te recordamos tu pago pendiente.', 0));
  await t.repos.templates.upsert(plantilla('recordatorio_entrega', 'Mañana te llevamos tu pedido.', 0));
  await t.repos.templates.upsert(plantilla('promo_octubre', 'Descuentos de octubre para ti, {{1}}.', 1, { status: 'PENDING', category: 'MARKETING' }));
}

/** Un chat con un mensaje del cliente, para encontrarlo por su nombre. */
async function chat(t: Tienda, phone: string, nombre: string, texto: string) {
  const c = await t.repos.contacts.upsertFromInbound(phone, nombre);
  await t.repos.messages.add({ contactId: c.id, direction: 'in', wamid: `w-${phone}-${Math.random()}`, kind: 'text', body: texto, payload: null, createdAt: new Date() });
  return c;
}

describe('plantillas: la aprobada, con sus variables, y el texto final en la tarjeta', () => {
  it('«mándale al 51912426667 la plantilla Aviso Pedido con Ana y P-1003»: tarjeta con el texto final; nada sale hasta Hacerlo', async () => {
    const t = await tienda();
    await conPlantillas(t);
    const j = await ordenar(t, 'mándale al 51912426667 la plantilla Aviso Pedido con Ana y P-1003', bloque({ accion: 'mensaje.plantilla', telefono: '51912426667', plantilla: 'Aviso Pedido', variables: ['Ana', 'P-1003'] }));
    expect(j.pendientes).toHaveLength(1);
    expect(j.pendientes[0].tarjeta).toMatchObject({ que: 'Mandar la plantilla «aviso_pedido» a 51 912 426 667', cuantos: 1, mensaje: 'Hola Ana, tu pedido P-1003 sale hoy.' });
    expect(t.wa.sent).toEqual([]);

    const hechas = await hacer(t, j.pendientes);
    expect(hechas[0]).toMatchObject({ accion: 'mensaje.plantilla', ok: true });
    const salio = t.wa.sent.find((s) => s.to === '51912426667');
    expect(salio).toBeTruthy();
    expect(JSON.stringify(salio)).toContain('Ana');
  });

  it('las variables también valen como {"1": ..., "2": ...}', async () => {
    const t = await tienda();
    await conPlantillas(t);
    const j = await ordenar(t, 'plantilla aviso_pedido al 912426667 para Beto, pedido P-7', bloque({ accion: 'mensaje.plantilla', telefono: '912426667', plantilla: 'aviso_pedido', variables: { '2': 'P-7', '1': 'Beto' } }));
    expect(j.pendientes[0].tarjeta.mensaje).toBe('Hola Beto, tu pedido P-7 sale hoy.');
  });

  it('faltan datos, no aprobada, no existe o hay varias: lo dice o pregunta, y no sale nada', async () => {
    const t = await tienda();
    await conPlantillas(t);
    const j = await ordenar(
      t,
      'plantillas varias',
      bloque(
        { accion: 'mensaje.plantilla', telefono: '912426667', plantilla: 'aviso_pedido', variables: ['Ana'] },
        { accion: 'mensaje.plantilla', telefono: '912426667', plantilla: 'promo octubre', variables: ['Ana'] },
        { accion: 'mensaje.plantilla', telefono: '912426667', plantilla: 'bienvenida_vip' },
        { accion: 'mensaje.plantilla', telefono: '912426667', plantilla: 'recordatorio' },
      ),
    );
    const todo = JSON.stringify(j);
    expect(todo).toContain('pide 2 dato(s)');
    expect(todo).toContain('nombre del cliente');
    expect(todo).toContain('pendiente de aprobar');
    expect(todo).toContain('No encuentro ninguna plantilla que se llame');
    expect(todo).toContain('aviso_pedido');
    expect(j.pendientes).toEqual([]);
    expect(j.elegir).toHaveLength(1);
    expect(j.elegir[0].opciones.map((o: Json) => o.parametros.plantilla).sort()).toEqual(['recordatorio_entrega', 'recordatorio_pago']);
    expect(t.wa.sent).toEqual([]);
  });

  it('piezas: encontrar por parecido y poner las variables', () => {
    const lista = [plantilla('confirmacion_pedido', 'x', 0), plantilla('aviso_pedido', 'y', 0)];
    expect(candidatasPlantilla(lista, 'Confirmación Pedido').map((t) => t.name)).toEqual(['confirmacion_pedido']);
    expect(candidatasPlantilla(lista, 'confirmasion pedido').map((t) => t.name)).toEqual(['confirmacion_pedido']);
    expect(candidatasPlantilla(lista, 'pedido').map((t) => t.name).sort()).toEqual(['aviso_pedido', 'confirmacion_pedido']);
    expect(textoDePlantilla('Hola {{1}}, {{ 2 }} y {{3}}', ['Ana', 'P-1'])).toBe('Hola Ana, P-1 y {{3}}');
  });
});

describe('stickers, pin, varios números, responder citando y reenviar', () => {
  it('«mándale el sticker de gracias a Rosa»: por el nombre del chat; sale el sticker al pulsar', async () => {
    const t = await tienda();
    await chat(t, '51912426667', 'Rosa', 'buenas');
    const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 10, g: 180, b: 120, alpha: 1 } } }).png().toBuffer();
    await t.stickers.subir({ nombre: 'Gracias corazón', uso: 'gracias', datosBase64: png.toString('base64') });
    const j = await ordenar(t, 'mándale el sticker de gracias a Rosa', bloque({ accion: 'mensaje.sticker', telefono: 'Rosa', sticker: 'gracias' }));
    expect(j.pendientes[0].tarjeta).toMatchObject({ que: 'Mandar el sticker «Gracias corazón» a Rosa', mensaje: '[sticker: Gracias corazón]' });
    expect(t.wa.sent.filter((s) => s.kind === 'sticker')).toEqual([]);
    const hechas = await hacer(t, j.pendientes);
    expect(hechas[0]!.ok, hechas[0]!.resumen).toBe(true);
    expect(t.wa.sent.find((s) => s.kind === 'sticker')).toMatchObject({ to: '51912426667' });
  });

  it('pin de ubicación con coordenadas; la voz sin configurar se dice antes', async () => {
    const t = await tienda();
    const j = await ordenar(t, 'mándale la ubicación de la tienda al 987654321 y un audio', bloque({ accion: 'mensaje.ubicacion', telefono: '987654321', lugar: '-12.0464,-77.0428' }, { accion: 'mensaje.voz', telefono: '987654321', texto: 'Hola' }));
    expect(j.pendientes).toHaveLength(1);
    expect(j.pendientes[0].tarjeta.mensaje).toContain('-12.0464, -77.0428');
    expect(JSON.stringify(j)).toContain('La voz no está configurada');
    const hechas = await hacer(t, j.pendientes);
    expect(hechas[0]!.ok, hechas[0]!.resumen).toBe(true);
    expect(t.wa.sent.find((s) => s.kind === 'location')).toMatchObject({ to: '51987654321' });
  });

  it('«mándales a 912000111, Rosa y Nadie: hoy no hay reparto»: una sola tarjeta con los que sí, y dice a quién no', async () => {
    const t = await tienda();
    await chat(t, '51912426667', 'Rosa', 'hola');
    const j = await ordenar(t, 'mándales a 912000111, Rosa y Nadie: hoy no hay reparto', bloque({ accion: 'mensaje.varios', telefonos: ['912000111', 'Rosa', 'Nadie', '51912000111'], texto: 'Hoy no hay reparto.' }));
    expect(j.pendientes).toHaveLength(1);
    const tj = j.pendientes[0].tarjeta;
    expect(tj).toMatchObject({ que: 'Mandar el mismo WhatsApp a 2 número(s)', cuantos: 2, mensaje: 'Hoy no hay reparto.' });
    expect(tj.avisos.join(' ')).toContain('NO se les manda: Nadie');
    expect(t.wa.sent).toEqual([]);
    const hechas = await hacer(t, j.pendientes);
    expect(hechas[0]!.ok, hechas[0]!.resumen).toBe(true);
    expect(t.wa.sent.filter((s) => s.kind === 'text').map((s) => s.to).sort()).toEqual(['51912000111', '51912426667']);
  });

  it('«respóndele a Luis citando su mensaje» y «reenvíale al 999000001 lo último que mandó Luis»', async () => {
    const t = await tienda();
    await chat(t, '51913000111', 'Luis Huamán', 'mi dirección es Av. Sol 123');
    const j = await ordenar(
      t,
      'respóndele a Luis citando su mensaje: ya va en camino, y reenvíale al 999000001 lo último que mandó Luis',
      bloque({ accion: 'mensaje.responder', telefono: 'Luis', texto: 'Ya va en camino.', citar: true }, { accion: 'mensaje.reenviar', desde: 'Luis', telefono: '999000001' }),
    );
    expect(j.pendientes).toHaveLength(2);
    expect(j.pendientes[0].tarjeta).toMatchObject({ que: 'Responder citando en el chat de Luis Huamán', mensaje: 'Ya va en camino.' });
    expect(j.pendientes[0].tarjeta.avisos.join(' ')).toContain('Av. Sol 123');
    expect(j.pendientes[1].tarjeta).toMatchObject({ que: 'Reenviar 1 mensaje(s) de Luis Huamán a 51 999 000 001', mensaje: 'mi dirección es Av. Sol 123' });
    expect(t.wa.sent).toEqual([]);
    const hechas = await hacer(t, j.pendientes);
    expect(hechas.map((h) => h.ok), JSON.stringify(hechas)).toEqual([true, true]);
    expect(t.wa.sent.find((s) => s.to === '51913000111')).toMatchObject({ kind: 'text', body: 'Ya va en camino.' });
    expect(t.wa.sent.find((s) => s.to === '51999000001')).toMatchObject({ kind: 'text' });
    expect(String(t.wa.sent.find((s) => s.to === '51999000001')!.body)).toContain('Av. Sol 123');
  });
});

describe('catálogo', () => {
  it('las acciones de mensajes están, son cambios, y preparar solo lee', async () => {
    const nombres = ACCIONES.map((a) => a.nombre);
    for (const n of ['mensaje.plantilla', 'mensaje.sticker', 'mensaje.ubicacion', 'mensaje.voz', 'mensaje.varios', 'mensaje.responder', 'mensaje.reenviar']) expect(nombres).toContain(n);
    expect(new Set(nombres).size).toBe(nombres.length);
    for (const a of ACCIONES_MENSAJES) {
      expect(a.tipo, a.nombre).toBe('cambio');
      expect(a.preparar, a.nombre).toBeTruthy();
      expect(a.schema.safeParse(a.ejemplo.accion).success, a.nombre).toBe(true);
      const llamadas: string[] = [];
      await prepararAccion(a, a.ejemplo.accion, { quien: 'ali', esAdmin: true, llamar: async (l) => { llamadas.push(l.method); return { status: 200, json: {} }; } });
      expect(llamadas.every((m) => m === 'GET'), `${a.nombre}: ${llamadas.join(',')}`).toBe(true);
    }
  });
});
