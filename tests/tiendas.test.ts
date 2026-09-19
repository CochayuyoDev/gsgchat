/**
 * Las tiendas del superadministrador, de punta a punta.
 *
 * Dos instancias en el mismo test: el MAESTRO (donde el superadmin da de
 * alta la tienda, le pone plan y la suspende) y la TIENDA (otra instancia
 * que se conecta al maestro desde su Membresia con la URL y el token). Lo
 * que importa: que la tienda tome su plan de alli y lo aplique (IA en pausa
 * si el maestro la suspende), que el maestro vea a la tienda en linea, que
 * un token rotado deje fuera al anterior, y que un admin no vea Tiendas.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender, type Sender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { createSettingsService, type SettingsRepo } from '../src/settings/service.js';
import { crearServicioIA, type ServicioIA } from '../src/ia/servicio.js';
import type { ProveedorIA } from '../src/ia/proveedores.js';
import { crearServicioPlan, type ServicioPlan } from '../src/plan/servicio.js';
import { crearServicioTiendas, slugDe, slugValido, type ServicioTiendas } from '../src/tiendas/servicio.js';
import { createFakeRepos, createFakeWhatsApp, createMemorySettingsRepo, TEST_SETTINGS_KEY, type FakeRepos, type FakeWhatsApp } from './fakes.js';

const ENV = {
  PUBLIC_BASE_URL: 'http://maestro.local',
  DATABASE_URL: 'postgres://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'none',
  BUSINESS_NAME: 'Maestro',
  RUTAS_PAIS: 'peru',
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

describe('las piezas', () => {
  it('el identificador sale del nombre y se valida', () => {
    expect(slugDe('Zapatería Lima — Sucursal Norte')).toBe('zapateria-lima-sucursal-norte');
    expect(slugValido('zapateria-lima')).toBeNull();
    expect(slugValido('Zapatería')).toContain('minúsculas');
    expect(slugValido('a')).toContain('entre 2 y 30');
  });
});

const reloj = { ahora: new Date('2026-09-18T12:00:00Z') };

interface Instancia {
  app: FastifyInstance;
  repos: FakeRepos;
  wa: FakeWhatsApp;
  sender: Sender;
  settingsRepo: SettingsRepo;
  ia: ServicioIA;
  plan: ServicioPlan;
  tiendas: ServicioTiendas;
}

/** Una instancia entera, con reloj compartido. La tienda habla con el maestro por su `app.inject`. */
async function instancia(nombre: string, baseUrl: string, fetchAlMaestro?: typeof fetch): Promise<Instancia> {
  const config = loadConfig({ ...ENV, PUBLIC_BASE_URL: baseUrl, BUSINESS_NAME: nombre });
  const repos = createFakeRepos();
  const wa = createFakeWhatsApp();
  const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2, serviceWindowApplies: false });
  const settingsRepo = createMemorySettingsRepo();
  const settings = await createSettingsService(settingsRepo, config, TEST_SETTINGS_KEY);
  await settings.save({ provider: 'local' });
  const plan = await crearServicioPlan({ settingsRepo, url: '', token: '', ahora: () => reloj.ahora, fetchImpl: fetchAlMaestro, cadaMs: 60_000_000 });
  const proveedor: ProveedorIA = { nombre: 'falso', async chat() { return 'Hola.'; } };
  const ia = await crearServicioIA({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, repos, sender, config, nombreNegocio: () => nombre, proveedor, modelosGratis: ['google/gemma-4-31b-it'], plan });
  await ia.guardar({ token: 'tok', activa: true, conocimiento: 'x' });
  const tiendas = crearServicioTiendas({ repo: repos.tiendas, baseUrl, ahora: () => reloj.ahora });
  const app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false, ia, plan, tiendas });
  await app.ready();
  return { app, repos, wa, sender, settingsRepo, ia, plan, tiendas };
}

const galletaDe = (r: { headers: Record<string, unknown> }) => {
  const c = (r.headers['set-cookie'] as string | string[] | undefined) ?? '';
  return (Array.isArray(c) ? (c[0] ?? '') : c).split(';')[0]!;
};
const json = { 'content-type': 'application/json' };

async function superDe(i: Instancia, usuario = 'ali'): Promise<Record<string, string>> {
  let r = await i.app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { usuario, nombre: usuario, clave: `${usuario}-2026-wa` } });
  if (r.statusCode !== 200) r = await i.app.inject({ method: 'POST', url: '/login', payload: { usuario, clave: `${usuario}-2026-wa` } });
  return { cookie: galletaDe(r), ...json };
}

let maestro: Instancia;
let tienda: Instancia;

/** La tienda llama al maestro: `fetch` que en realidad hace inject sobre la app del maestro. */
const fetchAlMaestro: typeof fetch = async (url, init) => {
  const u = new URL(String(url));
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const r = await maestro.app.inject({ method: 'GET', url: u.pathname + u.search, headers });
  return new Response(r.body, { status: r.statusCode, headers: { 'content-type': 'application/json' } });
};

beforeAll(async () => {
  maestro = await instancia('Maestro', 'http://maestro.local');
  tienda = await instancia('Zapateria Lima', 'http://zapateria.local', fetchAlMaestro);
});
afterAll(async () => {
  await maestro.app.close();
  await tienda.app.close();
});
beforeEach(async () => {
  reloj.ahora = new Date('2026-09-18T12:00:00Z');
  await maestro.app.close();
  await tienda.app.close();
  maestro = await instancia('Maestro', 'http://maestro.local');
  tienda = await instancia('Zapateria Lima', 'http://zapateria.local', fetchAlMaestro);
});

describe('el superadministrador controla las tiendas', () => {
  it('da de alta una tienda con su plan, la tienda se conecta con el token y toma el plan; suspenderla la para; el token rotado la deja fuera', async () => {
    const sup = await superDe(maestro);
    // Un admin del maestro no ve Tiendas.
    await maestro.app.inject({ method: 'POST', url: '/admin/usuarios', headers: sup, payload: { usuario: 'dueno', nombre: 'Dueño', clave: 'dueno-2026-wa', rol: 'admin' } });
    const adm = { cookie: galletaDe(await maestro.app.inject({ method: 'POST', url: '/login', payload: { usuario: 'dueno', clave: 'dueno-2026-wa' } })), ...json };
    expect((await maestro.app.inject({ method: 'GET', url: '/admin/tiendas', headers: adm })).statusCode).toBe(403);

    // Alta.
    const alta = await maestro.app.inject({ method: 'POST', url: '/admin/tiendas', headers: sup, payload: { nombre: 'Zapatería Lima', url: 'http://zapateria.local', contacto: 'Rosa', membresia: { plan: 'basico', vencimiento: '2026-10-18T23:59:59', contacto: 'Escríbenos al 987654321' } } });
    expect(alta.statusCode).toBe(200);
    const { tienda: t, token, pasos } = alta.json();
    expect(t).toMatchObject({ slug: 'zapateria-lima', semaforo: 'ambar', enLinea: false, urlPlan: 'http://maestro.local/api/plan/zapateria-lima', plan: { nombre: 'Básico', vencido: false } });
    expect(token).toMatch(/^plt_/);
    expect(pasos.join(' ')).toContain('http://maestro.local/api/plan/zapateria-lima');
    expect(JSON.stringify(t)).not.toContain('tokenHash');
    // Repetida: no.
    expect((await maestro.app.inject({ method: 'POST', url: '/admin/tiendas', headers: sup, payload: { nombre: 'Zapateria Lima', membresia: { plan: 'pro', vencimiento: '2027-01-01' } } })).statusCode).toBe(400);

    // Lo que pregunta la tienda: sin token 401; con el suyo, su plan.
    expect((await maestro.app.inject({ method: 'GET', url: '/api/plan/zapateria-lima' })).statusCode).toBe(401);
    expect((await maestro.app.inject({ method: 'GET', url: '/api/plan/zapateria-lima', headers: { authorization: 'Bearer plt_otro' } })).statusCode).toBe(401);
    const p = await maestro.app.inject({ method: 'GET', url: '/api/plan/zapateria-lima', headers: { authorization: `Bearer ${token}` } });
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({ plan: 'basico', nombre: 'Básico', vencido: false, diasRestantes: 31, limites: { iaTurnosMes: 2000 }, contacto: 'Escríbenos al 987654321' });
    // Y el maestro la ve en linea.
    let lista = (await maestro.app.inject({ method: 'GET', url: '/admin/tiendas', headers: sup })).json();
    expect(lista.tiendas[0]).toMatchObject({ enLinea: true, semaforo: 'verde' });
    expect(lista.resumen).toMatchObject({ total: 1, activas: 1, enLinea: 1, ingresosMes: 49 });

    // La tienda, desde su Membresia, se conecta al maestro.
    const supTienda = await superDe(tienda, 'rosa');
    expect(tienda.plan.estado().origen).toBe('libre');
    const mal = await tienda.app.inject({ method: 'POST', url: '/admin/membresia/maestro', headers: supTienda, payload: { url: 'http://maestro.local/api/plan/zapateria-lima', token: 'plt_malo' } });
    expect(mal.statusCode).toBe(400);
    expect(mal.json().error).toContain('no respondió con un plan');
    const con = await tienda.app.inject({ method: 'POST', url: '/admin/membresia/maestro', headers: supTienda, payload: { url: 'http://maestro.local/api/plan/zapateria-lima', token } });
    expect(con.statusCode).toBe(200);
    expect(con.json()).toMatchObject({ origen: 'maestro', editable: false, maestro: { url: 'http://maestro.local/api/plan/zapateria-lima', origen: 'pantalla' }, plan: { nombre: 'Básico' } });
    // Aqui ya no se edita la membresia.
    expect((await tienda.app.inject({ method: 'POST', url: '/admin/membresia', headers: supTienda, payload: { plan: 'pro', vencimiento: '2027-01-01' } })).statusCode).toBe(400);
    expect(tienda.plan.motivo('campanas')).toContain('no incluye campañas');
    const c = await tienda.repos.contacts.upsertFromInbound('51987654321', 'Maria');
    await tienda.repos.contacts.setOptIn('51987654321', 'prueba');
    expect((await tienda.ia.turno(c, 'hola')).resultado).toBe('respondio');

    // El maestro la suspende: al refrescar, la tienda para la IA.
    const susp = await maestro.app.inject({ method: 'POST', url: `/admin/tiendas/${t.id}/suspender`, headers: sup, payload: { suspendida: true } });
    expect(susp.json().tienda).toMatchObject({ semaforo: 'rojo', membresia: { estado: 'suspendida' } });
    await tienda.plan.refrescar();
    const turno = await tienda.ia.turno(c, 'hola');
    expect(turno.resultado).toBe('inactiva');
    expect(turno.detalle).toContain('vencido');
    expect(tienda.plan.estado().aviso?.texto).toContain('suspendida');
    // Un pago la reactiva y corre el vencimiento 2 meses desde la fecha pagada.
    const pago = await maestro.app.inject({ method: 'POST', url: `/admin/tiendas/${t.id}/pagos`, headers: sup, payload: { meses: 2, monto: 98, nota: 'Yape' } });
    expect(pago.json().tienda.membresia).toMatchObject({ estado: 'activa' });
    expect(new Date(pago.json().tienda.membresia.vencimiento).toLocaleDateString('es-PE')).toBe('18/12/2026');
    await tienda.plan.refrescar();
    expect((await tienda.ia.turno(c, 'hola')).resultado).toBe('respondio');

    // Token nuevo: el viejo ya no vale; la tienda se queda con lo ultimo que supo.
    const rot = await maestro.app.inject({ method: 'POST', url: `/admin/tiendas/${t.id}/token`, headers: sup, payload: {} });
    expect(rot.json().token).toMatch(/^plt_/);
    expect((await maestro.app.inject({ method: 'GET', url: '/api/plan/zapateria-lima', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
    await tienda.plan.refrescar();
    expect(tienda.plan.estado().error).toBeTruthy();
    expect(tienda.plan.permite('ia')).toBe(true);
    // Desconectar del maestro: la tienda vuelve a ser libre.
    expect((await tienda.app.inject({ method: 'DELETE', url: '/admin/membresia/maestro', headers: supTienda })).json().origen).toBe('libre');
    // Cambiar plan y borrar.
    const cambio = await maestro.app.inject({ method: 'POST', url: `/admin/tiendas/${t.id}`, headers: sup, payload: { nombre: 'Zapatería Lima Norte', membresia: { plan: 'pro', vencimiento: '2027-03-01T23:59:59' } } });
    expect(cambio.json().tienda).toMatchObject({ nombre: 'Zapatería Lima Norte', plan: { nombre: 'Pro' } });
    expect((await maestro.app.inject({ method: 'DELETE', url: `/admin/tiendas/${t.id}`, headers: sup })).statusCode).toBe(200);
    lista = (await maestro.app.inject({ method: 'GET', url: '/admin/tiendas', headers: sup })).json();
    expect(lista.tiendas).toEqual([]);
  });

  it('el semaforo: verde al dia y en linea, ambar por vencer o sin conectar, rojo vencida', async () => {
    const sup = await superDe(maestro);
    const a = (await maestro.app.inject({ method: 'POST', url: '/admin/tiendas', headers: sup, payload: { nombre: 'Tienda A', membresia: { plan: 'pro', vencimiento: '2026-09-22T23:59:59' } } })).json();
    const b = (await maestro.app.inject({ method: 'POST', url: '/admin/tiendas', headers: sup, payload: { nombre: 'Tienda B', membresia: { plan: 'prueba', vencimiento: '2026-09-10T23:59:59' } } })).json();
    await maestro.app.inject({ method: 'GET', url: '/api/plan/tienda-a', headers: { authorization: `Bearer ${a.token}` } });
    const lista = (await maestro.app.inject({ method: 'GET', url: '/admin/tiendas', headers: sup })).json();
    const porNombre = Object.fromEntries(lista.tiendas.map((t: { nombre: string; semaforo: string }) => [t.nombre, t.semaforo]));
    expect(porNombre).toEqual({ 'Tienda A': 'ambar', 'Tienda B': 'rojo' });
    expect(lista.resumen).toMatchObject({ total: 2, porVencer: 1, vencidas: 1, enLinea: 1 });
    // Pasan 25 minutos: A deja de estar en linea.
    reloj.ahora = new Date('2026-09-18T12:25:00Z');
    expect((await maestro.app.inject({ method: 'GET', url: '/admin/tiendas', headers: sup })).json().resumen.enLinea).toBe(0);
    void b;
    const panel = await maestro.app.inject({ method: 'GET', url: '/panel', headers: sup });
    expect(panel.body).toContain('tab-tiendas');
    expect(panel.body).toContain('Esta instalación depende de un maestro');
  });
});
