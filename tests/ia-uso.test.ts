/**
 * Cuanto se usa la IA: el contador por dia (tipos, tokens, fallos, poda a 31
 * dias, persistencia en settings), que el servicio cuente cada llamada por
 * lo que era, la ruta /admin/ia/uso y el aviso de la campana cuando el
 * proveedor lleva tres fallos seguidos.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { createSettingsService } from '../src/settings/service.js';
import { crearServicioIA, type ServicioIA } from '../src/ia/servicio.js';
import { crearProveedorOpenAI, ErrorIA, type MensajeIA, type ProveedorIA } from '../src/ia/proveedores.js';
import { CLAVE_USO_IA, crearContadorUsoIA, diaEn } from '../src/ia/uso.js';
import { createFakeRepos, createFakeWhatsApp, createMemorySettingsRepo, TEST_SETTINGS_KEY, type FakeRepos, CLAVE_API_PRUEBA } from './fakes.js';

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
  TIMEZONE: 'America/Lima',
} as NodeJS.ProcessEnv;
const config = loadConfig(ENV);
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

describe('el contador por dia', () => {
  it('cuenta por tipo, suma tokens y tiempos, y guarda en settings', async () => {
    const settingsRepo = createMemorySettingsRepo();
    let ahora = new Date('2026-09-21T15:00:00Z');
    const c = await crearContadorUsoIA({ settingsRepo, timezone: 'America/Lima', ahora: () => ahora });
    c.anotar('respuestas', { ms: 800, tokensEntrada: 500, tokensSalida: 60 });
    c.anotar('respuestas', { ms: 400 });
    c.anotar('lecturas', { ms: 200, tokensEntrada: 100, tokensSalida: 10 });
    c.anotarFallo('ordenes', 'la API respondio 429');
    await c.guardado();
    const r = c.resumen();
    expect(r.hoy.dia).toBe('2026-09-21');
    expect(r.hoy).toMatchObject({ respuestas: 2, lecturas: 1, ordenes: 0, fallos: 1, tokensEntrada: 600, tokensSalida: 70 });
    expect(r.msMedioHoy).toBe(467);
    expect(r.fallosSeguidos).toBe(1);
    expect(r.ultimoFallo?.detalle).toContain('429');
    // Una buena reinicia la racha de fallos.
    c.anotar('ordenes');
    expect(c.resumen().fallosSeguidos).toBe(0);
    // Lo guardado sobrevive a un reinicio.
    await c.guardado();
    const guardado = (await settingsRepo.getAll()).find((s) => s.key === CLAVE_USO_IA);
    expect(guardado).toBeTruthy();
    const c2 = await crearContadorUsoIA({ settingsRepo, timezone: 'America/Lima', ahora: () => ahora });
    expect(c2.resumen().hoy.respuestas).toBe(2);
    expect(c2.resumen().mes.ordenes).toBe(1);
    // Al dia siguiente, "hoy" arranca en cero y el mes suma los dos dias.
    ahora = new Date('2026-09-22T15:00:00Z');
    c2.anotar('respuestas');
    expect(c2.resumen().hoy.respuestas).toBe(1);
    expect(c2.resumen().mes.respuestas).toBe(3);
    expect(c2.resumen().mes.diasConUso).toBe(2);
    expect(c2.resumen().dias.map((d) => d.dia)).toEqual(['2026-09-21', '2026-09-22']);
  });

  it('solo conserva los ultimos 31 dias', async () => {
    const settingsRepo = createMemorySettingsRepo();
    let ahora = new Date('2026-08-01T15:00:00Z');
    const c = await crearContadorUsoIA({ settingsRepo, timezone: 'America/Lima', ahora: () => ahora });
    c.anotar('respuestas');
    ahora = new Date('2026-09-21T15:00:00Z');
    c.anotar('respuestas');
    await c.guardado();
    const c2 = await crearContadorUsoIA({ settingsRepo, timezone: 'America/Lima', ahora: () => ahora });
    expect(c2.resumen().dias.map((d) => d.dia)).toEqual(['2026-09-21']);
    expect(c2.resumen().mes.respuestas).toBe(1);
  });

  it('el dia se cuenta en la hora del negocio, no en UTC', () => {
    // Las 23:30 de Lima del 21 son las 04:30Z del 22.
    expect(diaEn(new Date('2026-09-22T04:30:00Z'), 'America/Lima')).toBe('2026-09-21');
  });
});

describe('el servicio de IA cuenta cada llamada por lo que era', () => {
  let app: FastifyInstance;
  let repos: FakeRepos;
  let ia: ServicioIA;
  const estado = { fallar: false };
  const proveedor: ProveedorIA = {
    nombre: 'falso',
    async chat(_mensajes: MensajeIA[], o) {
      if (estado.fallar) throw new ErrorIA('la API respondio 401', 'falso', 'clave mala');
      o.alUso?.({ tokensEntrada: 120, tokensSalida: 20 });
      return 'Claro, con gusto.';
    },
  };
  const auth = { authorization: `Bearer ${CLAVE_API_PRUEBA}` };

  beforeAll(async () => {
    repos = createFakeRepos();
    const wa = createFakeWhatsApp();
    const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
    const settingsRepo = createMemorySettingsRepo();
    const settings = await createSettingsService(settingsRepo, config, TEST_SETTINGS_KEY);
    ia = await crearServicioIA({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, repos, sender, config, nombreNegocio: () => 'Zapateria Lima', proveedor, modelosGratis: ['google/gemma-4-31b-it'] });
    await ia.guardar({ activa: true, token: 'tok', conocimiento: 'Vendemos zapatos.' });
    app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false, ia });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('una respuesta a un cliente, una lectura, una orden de ayuda y una prueba, cada una en su sitio', async () => {
    const contact = await repos.contacts.upsertFromInbound('51987654321', 'Maria');
    await repos.contacts.setOptIn('51987654321', 'prueba');
    await repos.contacts.touchInbound('51987654321', new Date());
    await ia.turno(contact, 'hola');
    await ia.completar([{ role: 'user', content: 'resume esto' }]);
    await ia.ayuda([], '¿cómo conecto GSG?');
    await ia.probar([], 'hola');
    const u = ia.uso();
    expect(u.hoy).toMatchObject({ respuestas: 1, lecturas: 1, ordenes: 1, pruebas: 1, fallos: 0 });
    expect(u.hoy.tokensEntrada).toBe(480);
    expect(u.hoy.tokensSalida).toBe(80);
  });

  it('los fallos se cuentan, y tres seguidos avisan en la campana', async () => {
    estado.fallar = true;
    for (let i = 0; i < 3; i++) await ia.completar([{ role: 'user', content: 'x' }]).catch(() => undefined);
    const u = ia.uso();
    expect(u.hoy.fallos).toBe(3);
    expect(u.fallosSeguidos).toBe(3);
    expect(u.ultimoFallo?.detalle).toContain('401');
    const avisos = await app.inject({ method: 'GET', url: '/admin/avisos', headers: auth });
    const aviso = avisos.json().avisos.find((a: { tipo: string }) => a.tipo === 'ia_fallos');
    expect(aviso).toBeTruthy();
    expect(aviso.texto).toContain('3 veces seguidas');
    expect(aviso.href).toBe('/panel#ia');
    estado.fallar = false;
    await ia.completar([{ role: 'user', content: 'x' }]);
    expect(ia.uso().fallosSeguidos).toBe(0);
  });

  it('GET /admin/ia/uso lo ensena, sin membresia si la instancia es libre', async () => {
    const r = await app.inject({ method: 'GET', url: '/admin/ia/uso', headers: auth });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.hoy.respuestas).toBe(1);
    expect(j.hoy.fallos).toBe(3);
    expect(j.membresia).toBeNull();
    expect(j.cuentaTokens).toBe(false);
    expect(j.modelo).toBe('google/gemma-4-31b-it');
  });
});

describe('el proveedor compatible con OpenAI dice los tokens', () => {
  it('lee usage de la respuesta y lo pasa a alUso', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'Hola' } }], usage: { prompt_tokens: 33, completion_tokens: 7 } }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const p = crearProveedorOpenAI({ baseUrl: 'https://api.example/v1', clave: 'k', fetchImpl });
    let uso: { tokensEntrada: number; tokensSalida: number } | null = null;
    const texto = await p.chat([{ role: 'user', content: 'hola' }], { modelo: 'm', alUso: (u) => { uso = u; } });
    expect(texto).toBe('Hola');
    expect(uso).toEqual({ tokensEntrada: 33, tokensSalida: 7 });
  });
});
