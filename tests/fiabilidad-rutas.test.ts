/**
 * La pantalla "Que todo funcione" contra el servidor real (WhatsApp falso,
 * Brevo falso, base en memoria): quién puede qué, y que cada botón hace lo
 * que dice sin dejar códigos a la vista.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { politicaDesdeConfig } from '../src/salud/politica.js';
import { crearMonitor } from '../src/salud/monitor.js';
import { crearServicioAjustes } from '../src/ajustes/generales.js';
import { crearFiabilidad, type ServicioFiabilidad } from '../src/salud/fiabilidad.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp, createMemorySettingsRepo, TEST_SETTINGS_KEY, CLAVE_API_PRUEBA } from './fakes.js';

const ENV = {
  PUBLIC_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'lima',
  BUSINESS_NAME: 'GSG',
  RUTAS_SUPERVISOR: '51912426667',
  DEMO_MODE: 'true',
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
  const set = res.headers['set-cookie'];
  const linea = Array.isArray(set) ? set[0] : (set as string | undefined);
  return (linea as string).split(';')[0]!;
}

describe('/fiabilidad y /admin/fiabilidad', () => {
  let app: FastifyInstance;
  let fiabilidad: ServicioFiabilidad;
  let admin = '';
  let operador = '';
  let carpeta: string;
  let archiveDir: string;
  let conectado = true;
  const correos: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    const config = loadConfig(ENV);
    const repos = createFakeRepos();
    const wa = createFakeWhatsApp();
    const settings = await createFakeSettings(config);
    const settingsRepo = createMemorySettingsRepo();
    const ajustes = await crearServicioAjustes({ repo: repos.ajustesGenerales, config, releerCadaMs: 0 });
    const politica = () => ajustes.politica(politicaDesdeConfig(config, 'cloud'));
    const salud = crearMonitor({ repos, politica, phoneNumberId: () => 'PNID' });
    const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2, salud, politica });
    carpeta = mkdtempSync(path.join(tmpdir(), 'gsgchat-copias-rutas-'));
    archiveDir = mkdtempSync(path.join(tmpdir(), 'gsgchat-respaldos-rutas-'));
    writeFileSync(path.join(archiveDir, 'uno.ndjson.gz'), 'x');
    fiabilidad = await crearFiabilidad({
      settingsRepo,
      settingsKeyBase64: TEST_SETTINGS_KEY,
      salud,
      timezone: config.timezone,
      demo: true,
      fetchImpl: (async (_url: unknown, init?: RequestInit) => {
        correos.push(JSON.parse(String(init?.body ?? '{}')));
        return new Response('{"messageId":"1"}', { status: 201, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch,
      vigilante: {
        conectado: () => conectado,
        proveedor: () => 'local',
        avisarWhatsApp: async (texto) => {
          const r = await sender.send({ phone: '51912426667', kind: 'freeform', category: 'UTILITY', text: texto, manual: true, origen: 'sistema' });
          return { ok: r.ok };
        },
      },
      humo: { sender, supervisor: () => ajustes.supervisor(), deliveries: repos.deliveries, entregas: null, conexionGsg: null, carpetas: () => [process.cwd()], esperaEntregaMs: 0 },
      cupo: {},
      respaldo: { baseDatos: () => ({ tipo: 'memoria' }), archiveDir, carpetaPorDefecto: carpeta },
    });
    app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false, salud, politica, ajustes, fiabilidad });
    await app.ready();
    admin = cookieDe(await app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { nombre: 'Ali', usuario: 'ali', clave: 'clave-segura-1' } }));
    await app.inject({ method: 'POST', url: '/admin/usuarios', headers: { cookie: admin }, payload: { nombre: 'Rosa', usuario: 'rosa', clave: 'rosa-clave-1' } });
    operador = cookieDe(await app.inject({ method: 'POST', url: '/login', payload: { usuario: 'rosa', clave: 'rosa-clave-1' }, remoteAddress: '10.0.0.5' }));
  });

  afterAll(async () => {
    await app.close();
    rmSync(carpeta, { recursive: true, force: true });
    rmSync(archiveDir, { recursive: true, force: true });
  });

  it('la pantalla es privada y, con sesión, se pinta con sus cuatro cajas', async () => {
    const sin = await app.inject({ method: 'GET', url: '/fiabilidad' });
    expect([302, 303]).toContain(sin.statusCode);
    const con = await app.inject({ method: 'GET', url: '/fiabilidad', headers: { cookie: operador } });
    expect(con.statusCode).toBe(200);
    for (const trozo of ['Que todo funcione', 'id="caja-wa"', 'id="caja-humo"', 'id="caja-cupo"', 'id="caja-copia"', 'Probar ahora', 'Hacer copia ahora', 'Cómo restaurar una copia']) {
      expect(con.body, trozo).toContain(trozo);
    }
  });

  it('GET /admin/fiabilidad trae todo, con frases y sin códigos', async () => {
    const r = await app.inject({ method: 'GET', url: '/admin/fiabilidad', headers: { cookie: operador } });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.demo).toBe(true);
    expect(j.vigilante.frase).toBeTruthy();
    expect(j.humo.proxima).toContain('07:00');
    expect(typeof j.cupo.frase).toBe('string');
    expect(j.copia.carpeta).toBe(carpeta);
    expect(j.copia.alerta).toContain('Todavía no hay ninguna copia');
    expect(j.brevo.configurada).toBe(false);
  });

  it('los ajustes solo los cambia un administrador; la clave de Brevo nunca vuelve al navegador', async () => {
    const op = await app.inject({ method: 'POST', url: '/admin/fiabilidad/ajustes', headers: { cookie: operador }, payload: { humo: { hora: '08:00' } } });
    expect(op.statusCode).toBe(403);
    expect(op.json().error).toContain('administrador');
    const token = await app.inject({ method: 'POST', url: '/admin/fiabilidad/ajustes', headers: { authorization: `Bearer ${CLAVE_API_PRUEBA}` }, payload: { humo: { hora: '08:00' } } });
    expect(token.statusCode).toBe(403);
    const ok = await app.inject({ method: 'POST', url: '/admin/fiabilidad/ajustes', headers: { cookie: admin }, payload: { humo: { hora: '08:00' }, vigilante: { correoAviso: 'dueno@gsg.pe', minutosAntesDeAvisar: 2 }, claveBrevo: 'xkeysib-secreta', copia: { hora: '04:00', conservar: 7 } } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().ajustes.humo.hora).toBe('08:00');
    expect(ok.json().brevo.configurada).toBe(true);
    expect(JSON.stringify(ok.json())).not.toContain('xkeysib');
    const todo = (await app.inject({ method: 'GET', url: '/admin/fiabilidad', headers: { cookie: admin } })).json();
    expect(JSON.stringify(todo)).not.toContain('xkeysib');
    expect(todo.ajustes.copia.conservar).toBe(7);
    const mala = await app.inject({ method: 'POST', url: '/admin/fiabilidad/ajustes', headers: { cookie: admin }, payload: { humo: { hora: '25:99' } } });
    expect(mala.statusCode).toBe(400);
  });

  it('"Probar el correo" manda por Brevo al correo de aviso', async () => {
    const r = await app.inject({ method: 'POST', url: '/admin/fiabilidad/correo/probar', headers: { cookie: admin } });
    expect(r.statusCode).toBe(200);
    expect(r.json().resultado.detalle).toContain('dueno@gsg.pe');
    expect(correos.at(-1)).toMatchObject({ to: [{ email: 'dueno@gsg.pe' }] });
  });

  it('simular una caída (solo demo): a los 2 minutos del ajuste sale el correo; "mirar ahora" refresca', async () => {
    let r = await app.inject({ method: 'POST', url: '/admin/fiabilidad/vigilante/mirar', headers: { cookie: operador } });
    expect(r.json().vigilante.conectado).toBe(true);
    r = await app.inject({ method: 'POST', url: '/admin/fiabilidad/vigilante/simular', headers: { cookie: operador }, payload: { caido: true } });
    expect(r.statusCode).toBe(200);
    expect(r.json().vigilante.conectado).toBe(false);
    expect(r.json().vigilante.simulando).toBe(true);
    r = await app.inject({ method: 'POST', url: '/admin/fiabilidad/vigilante/simular', headers: { cookie: operador }, payload: { caido: null } });
    expect(r.json().vigilante.conectado).toBe(true);
  });

  it('"Probar ahora" corre la pasada y la devuelve con sus pasos', async () => {
    const r = await app.inject({ method: 'POST', url: '/admin/fiabilidad/humo/probar', headers: { cookie: operador } });
    expect(r.statusCode).toBe(200);
    const pasos = r.json().resultado.pasos as Array<{ clave: string; ok: boolean; detalle: string }>;
    expect(pasos.map((p) => p.clave)).toEqual(['whatsapp', 'gsg', 'ia', 'entregas', 'disco']);
    expect(pasos[0]!.ok).toBe(true);
    expect(r.json().resultado.quien).toBe('Rosa');
    const cupo = await app.inject({ method: 'GET', url: '/admin/fiabilidad/cupo', headers: { cookie: operador } });
    expect(cupo.statusCode).toBe(200);
    expect(cupo.json().frase).toBeTruthy();
  });

  it('"Hacer copia ahora" (solo admin) deja los respaldos en la carpeta y se pueden descargar', async () => {
    const op = await app.inject({ method: 'POST', url: '/admin/fiabilidad/copia/ahora', headers: { cookie: operador } });
    expect(op.statusCode).toBe(403);
    const r = await app.inject({ method: 'POST', url: '/admin/fiabilidad/copia/ahora', headers: { cookie: admin } });
    expect(r.statusCode).toBe(200);
    const ficheros = r.json().resultado.ficheros as Array<{ nombre: string }>;
    expect(ficheros).toHaveLength(1);
    expect(ficheros[0]!.nombre).toMatch(/^respaldos-\d{4}-\d{2}-\d{2}\.tar\.gz$/);
    expect(r.json().resultado.notas.join(' ')).toContain('memoria');
    const bajada = await app.inject({ method: 'GET', url: `/admin/fiabilidad/copia/descargar/${ficheros[0]!.nombre}`, headers: { cookie: operador } });
    expect(bajada.statusCode).toBe(200);
    expect(bajada.headers['content-type']).toContain('gzip');
    expect(bajada.rawPayload.length).toBeGreaterThan(20);
    const mala = await app.inject({ method: 'GET', url: '/admin/fiabilidad/copia/descargar/..%2F..%2Fetc', headers: { cookie: operador } });
    expect(mala.statusCode).toBe(404);
    const c = await app.inject({ method: 'POST', url: '/admin/fiabilidad/copia/carpeta', headers: { cookie: admin }, payload: { carpeta: path.join(archiveDir, 'uno.ndjson.gz') } });
    expect(c.statusCode).toBe(400);
    expect(c.json().error).toContain('carpeta');
  });
});
