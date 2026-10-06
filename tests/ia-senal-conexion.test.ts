/**
 * La señal «IA conectada / sin conexión» y la versión que corre: el estado
 * de conexión del servicio de IA (apagada, sin comprobar, conectada, sin
 * conexión con su motivo y sin claves), la comprobación sola (que no cuenta
 * como uso), la ruta /admin/ia/conexion, la versión en /health y
 * /admin/health, y que los <script> del panel con la señal compilan.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { createSettingsService } from '../src/settings/service.js';
import { crearServicioIA, motivoSinClaves, type ServicioIA } from '../src/ia/servicio.js';
import { ErrorIA, type MensajeIA, type ProveedorIA } from '../src/ia/proveedores.js';
import { VERSION } from '../src/version.js';
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
const CLAVE = 'sk-secreta-1234567890abcdef';
const auth = { 'x-api-key': CLAVE_API_PRUEBA };

function montarIA(proveedor: ProveedorIA, extra: { comprobarConexionCadaMs?: number | false } = {}) {
  const repos = createFakeRepos();
  const wa = createFakeWhatsApp();
  const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
  const settingsRepo = createMemorySettingsRepo();
  return { repos, wa, sender, settingsRepo, crear: () => crearServicioIA({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, repos, sender, config, nombreNegocio: () => 'Zapateria Lima', proveedor, modelosGratis: ['google/gemma-4-31b-it'], examenAutomatico: false, ...extra }) };
}

describe('la señal de conexión de la IA', () => {
  let app: FastifyInstance;
  let repos: FakeRepos;
  let ia: ServicioIA;
  const estado = { fallar: false as false | 'red' | 'saldo', llamadas: 0 };
  const proveedor: ProveedorIA = {
    nombre: 'falso',
    async chat(_mensajes: MensajeIA[]) {
      estado.llamadas++;
      // El servicio repite la clave en el error: no debe llegar a la pantalla.
      if (estado.fallar === 'red') throw new ErrorIA('no se pudo contactar con la IA', 'falso', `fetch failed ENOTFOUND (Authorization: Bearer ${CLAVE})`);
      if (estado.fallar === 'saldo') throw new ErrorIA('la API respondio 429', 'falso', `insufficient_quota for key ${CLAVE}`, 'sin_saldo');
      return 'hola, estoy listo';
    },
  };

  beforeAll(async () => {
    const m = montarIA(proveedor);
    repos = m.repos;
    ia = await m.crear();
    const settings = await createSettingsService(m.settingsRepo, config, TEST_SETTINGS_KEY);
    app = await buildServer({ config, repos, settings, wa: m.wa, sender: m.sender, queue, logger: false, ia });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('apagada mientras no está activa; sin comprobar al activarla', async () => {
    expect(ia.conexion().estado).toBe('apagada');
    expect(ia.estado().conexion.estado).toBe('apagada');
    await ia.guardar({ activa: true, token: CLAVE, conocimiento: 'Vendemos zapatos.' });
    expect(ia.conexion()).toMatchObject({ estado: 'sin_comprobar', motivo: null, comprobada: null });
  });

  it('conectada tras una llamada buena (también la del ayudante del panel)', async () => {
    await ia.ayuda([], '¿cómo conecto GSG?');
    const c = ia.conexion();
    expect(c.estado).toBe('conectada');
    expect(c.origen).toBe('llamada');
    expect(c.motivo).toBeNull();
    expect(Number.isNaN(Date.parse(c.comprobada!))).toBe(false);
  });

  it('sin conexión con el motivo en cristiano y sin la clave tras una mala', async () => {
    estado.fallar = 'red';
    await ia.completar([{ role: 'user', content: 'x' }]).catch(() => undefined);
    const c = ia.conexion();
    expect(c.estado).toBe('sin_conexion');
    expect(c.motivo).toContain('No se pudo llegar al servicio');
    expect(c.motivo).not.toContain(CLAVE);
    expect(JSON.stringify(ia.estado())).not.toContain(CLAVE);
    estado.fallar = false;
  });

  it('«Comprobar conexión» la actualiza; sin saldo dice dónde recargar, sin la clave', async () => {
    const buena = await app.inject({ method: 'POST', url: '/admin/ia/probar-conexion', headers: auth, payload: {} });
    expect(buena.json()).toMatchObject({ ok: true, conexion: { estado: 'conectada', origen: 'prueba' } });
    estado.fallar = 'saldo';
    const mala = await app.inject({ method: 'POST', url: '/admin/ia/probar-conexion', headers: auth, payload: {} });
    expect(mala.json().conexion.estado).toBe('sin_conexion');
    expect(mala.json().conexion.motivo).toContain('saldo');
    expect(mala.body).not.toContain(CLAVE);
    estado.fallar = false;
    await app.inject({ method: 'POST', url: '/admin/ia/probar-conexion', headers: auth, payload: {} });
    expect(ia.conexion().estado).toBe('conectada');
  });

  it('GET /admin/ia/conexion la devuelve con la versión, y GET /admin/ia también', async () => {
    const r = await app.inject({ method: 'GET', url: '/admin/ia/conexion', headers: auth });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ estado: 'conectada', version: VERSION });
    const cfg = await app.inject({ method: 'GET', url: '/admin/ia', headers: auth });
    expect(cfg.json()).toMatchObject({ conexion: { estado: 'conectada' }, version: VERSION });
    expect((await app.inject({ method: 'GET', url: '/admin/ia/conexion' })).statusCode).toBe(401);
  });

  it('otra clave o apagarla borra lo que se sabía', async () => {
    await ia.guardar({ token: 'sk-otra-clave-0000000000' });
    expect(ia.conexion().estado).toBe('sin_comprobar');
    await ia.guardar({ activa: false });
    expect(ia.conexion().estado).toBe('apagada');
    const r = await app.inject({ method: 'GET', url: '/admin/ia/conexion', headers: auth });
    expect(r.json().estado).toBe('apagada');
  });

  it('la versión sale en /health y en /admin/health', async () => {
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toMatchObject({ ok: true, version: VERSION });
    const h = await app.inject({ method: 'GET', url: '/admin/health', headers: auth });
    expect(h.statusCode).toBe(200);
    expect(h.json().version).toBe(VERSION);
  });

  it('el panel lleva la señal y la versión, y sus <script> compilan', async () => {
    const vm = await import('node:vm');
    const r = await app.inject({ method: 'GET', url: '/panel', headers: auth });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('id="s-ia-senal"');
    expect(r.body).toContain('id="ia-senal"');
    expect(r.body).toContain(`v${VERSION}`);
    let n = 0;
    for (const m of r.body.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
      n++;
      expect(() => new vm.Script(m[1]!, { filename: `/panel#${n}` }), `/panel script ${n}`).not.toThrow();
    }
    expect(n).toBeGreaterThan(0);
  });
});

describe('la comprobación sola', () => {
  it('al arrancar prueba la conexión sin contarla como uso, y calla si está apagada', async () => {
    let llamadas = 0;
    const proveedor: ProveedorIA = { nombre: 'falso', async chat() { llamadas++; return 'hola, estoy listo'; } };
    // Primero se guarda la configuración (sin comprobación) y luego arranca un servicio que sí comprueba.
    const m = montarIA(proveedor, { comprobarConexionCadaMs: false });
    const previo = await m.crear();
    await previo.guardar({ activa: true, token: CLAVE });
    const ia = await crearServicioIA({ settingsRepo: m.settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, repos: m.repos, sender: m.sender, config, nombreNegocio: () => 'Zapateria Lima', proveedor, modelosGratis: ['google/gemma-4-31b-it'], examenAutomatico: false, comprobarConexionCadaMs: 40 });
    expect(ia.conexion().estado).toBe('sin_comprobar');
    const hasta = Date.now() + 2_000;
    while (ia.conexion().estado === 'sin_comprobar' && Date.now() < hasta) await new Promise((r) => setTimeout(r, 10));
    expect(ia.conexion()).toMatchObject({ estado: 'conectada', origen: 'automatica' });
    expect(llamadas).toBeGreaterThan(0);
    const u = ia.uso().hoy;
    expect(u.respuestas + u.lecturas + u.ordenes + u.pruebas).toBe(0);
    // Apagada, la comprobación sola no llama al modelo.
    await ia.guardar({ activa: false });
    const antes = llamadas;
    await new Promise((r) => setTimeout(r, 150));
    expect(llamadas).toBe(antes);
  });

  it('en las pruebas está apagada por defecto', async () => {
    let llamadas = 0;
    const m = montarIA({ nombre: 'falso', async chat() { llamadas++; return 'ok'; } });
    const ia = await m.crear();
    await ia.guardar({ activa: true, token: CLAVE });
    await new Promise((r) => setTimeout(r, 100));
    expect(llamadas).toBe(0);
    expect(ia.conexion().estado).toBe('sin_comprobar');
  });

  it('motivoSinClaves tapa claves conocidas y las que lo parecen', () => {
    const t = motivoSinClaves(`fallo con Bearer abc.def y api_key=xyz123 y ${CLAVE} y sk-proj-ABCDEFGHIJKL`, ['clave-propia-123']);
    expect(t).not.toContain('abc.def');
    expect(t).not.toContain('xyz123');
    expect(t).not.toContain(CLAVE);
    expect(t).not.toContain('ABCDEFGHIJKL');
    expect(motivoSinClaves('va clave-propia-123 aqui', ['clave-propia-123'])).toBe('va *** aqui');
  });
});
