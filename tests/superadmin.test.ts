/**
 * El superadministrador, la membresia local y los codigos de conexion.
 *
 * Lo que importa: la primera cuenta es superadmin; un admin no toca ni crea
 * superadmins ni la membresia (la ve); el ultimo superadmin no se degrada;
 * la membresia local manda igual que la del maestro (IA en pausa si vence o
 * se suspende, tope de cuentas), los pagos corren el vencimiento; y un
 * codigo corto con fecha limite se canjea UNA vez por una clave que vale,
 * sin clave previa, con tope de intentos.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender, type Sender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { createSettingsService, type SettingsRepo } from '../src/settings/service.js';
import { crearServicioIA, type ServicioIA } from '../src/ia/servicio.js';
import type { MensajeIA, ProveedorIA } from '../src/ia/proveedores.js';
import { crearServicioPlan, type ServicioPlan } from '../src/plan/servicio.js';
import { claveDeConexion, estadoDe, generarCodigoConexion, leerClaveDeConexion, normalizarCodigo } from '../src/auth/codigos-conexion.js';
import { createFakeRepos, createFakeWhatsApp, createMemorySettingsRepo, TEST_SETTINGS_KEY, type FakeRepos, type FakeWhatsApp } from './fakes.js';

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

const config = loadConfig(ENV);

describe('los codigos, a secas', () => {
  it('se generan sin letras que se confundan y se normalizan como los escribe la gente', () => {
    for (let i = 0; i < 50; i++) expect(generarCodigoConexion()).toMatch(/^WA-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
    expect(normalizarCodigo('wa-k7m3-9qxz')).toBe('WA-K7M3-9QXZ');
    expect(normalizarCodigo('k7m3 9qxz')).toBe('WA-K7M3-9QXZ');
    expect(normalizarCodigo('WA K7M39QXZ')).toBe('WA-K7M3-9QXZ');
    expect(normalizarCodigo('corto')).toBe('CORTO');
  });

  it('el estado real sale de los usos, la fecha y si se anulo', () => {
    const base = { id: '1', codigo: 'WA-AAAA-BBBB', para: 'x', permisos: ['*'], caducaAt: new Date('2026-09-20T00:00:00Z'), usosMax: 1, usos: 0, estado: 'activo' as const, creadoPor: null, canjeadoPor: null, canjeadoDesde: null, canjeadoAt: null, claveId: null, createdAt: new Date() };
    const ahora = new Date('2026-09-18T00:00:00Z');
    expect(estadoDe(base, ahora)).toBe('activo');
    expect(estadoDe({ ...base, usos: 1 }, ahora)).toBe('usado');
    expect(estadoDe(base, new Date('2026-09-21T00:00:00Z'))).toBe('caducado');
    expect(estadoDe({ ...base, estado: 'anulado' }, ahora)).toBe('anulado');
  });
});

let app: FastifyInstance;
let repos: FakeRepos;
let wa: FakeWhatsApp;
let sender: Sender;
let settingsRepo: SettingsRepo;
let ia: ServicioIA;
let plan: ServicioPlan;
let reloj = { ahora: new Date('2026-09-18T12:00:00Z') };
let modelo: { proveedor: ProveedorIA; recibido: MensajeIA[][] };

async function build() {
  repos = createFakeRepos();
  wa = createFakeWhatsApp();
  sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2, serviceWindowApplies: false });
  settingsRepo = createMemorySettingsRepo();
  const settings = await createSettingsService(settingsRepo, config, TEST_SETTINGS_KEY);
  await settings.save({ provider: 'local' });
  reloj = { ahora: new Date('2026-09-18T12:00:00Z') };
  plan = await crearServicioPlan({ settingsRepo, url: '', token: '', ahora: () => reloj.ahora });
  const recibido: MensajeIA[][] = [];
  modelo = { recibido, proveedor: { nombre: 'falso', async chat(m) { recibido.push(m); return 'Hola.'; } } };
  ia = await crearServicioIA({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, repos, sender, config, nombreNegocio: () => 'Zapateria Lima', proveedor: modelo.proveedor, modelosGratis: ['google/gemma-4-31b-it'], plan });
  await ia.guardar({ token: 'tok', activa: true, conocimiento: 'Zapateria.' });
  return buildServer({ config, repos, settings, wa, sender, queue, logger: false, ia, plan });
}

beforeAll(async () => {
  app = await build();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await app.close();
  app = await build();
  await app.ready();
});

const galletaDe = (r: { headers: Record<string, unknown> }) => {
  const c = (r.headers['set-cookie'] as string | string[] | undefined) ?? '';
  return (Array.isArray(c) ? (c[0] ?? '') : c).split(';')[0]!;
};
const json = { 'content-type': 'application/json' };

/** La primera cuenta (superadmin) y, si se pide, una de admin u operador creada por ella. */
async function sesion(rol: 'superadmin' | 'admin' | 'operador' = 'superadmin'): Promise<Record<string, string>> {
  let primera = await app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { usuario: 'ali', nombre: 'Ali', clave: 'ali-2026-wa' } });
  if (primera.statusCode !== 200) primera = await app.inject({ method: 'POST', url: '/login', payload: { usuario: 'ali', clave: 'ali-2026-wa' } });
  const superCookie = { cookie: galletaDe(primera), ...json };
  if (rol === 'superadmin') return superCookie;
  const nombre = rol === 'admin' ? 'dueno' : 'ope';
  const crear = await app.inject({ method: 'POST', url: '/admin/usuarios', headers: superCookie, payload: { usuario: nombre, nombre: rol === 'admin' ? 'Dueño' : 'Operadora', clave: `${nombre}-2026-wa`, rol } });
  expect([200, 400]).toContain(crear.statusCode);
  const entrar = await app.inject({ method: 'POST', url: '/login', payload: { usuario: nombre, clave: `${nombre}-2026-wa` } });
  return { cookie: galletaDe(entrar), ...json };
}

describe('roles', () => {
  it('la primera cuenta es superadministrador y entra como admin con la marca super', async () => {
    const r = await app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { usuario: 'ali', nombre: 'Ali', clave: 'ali-2026-wa' } });
    expect(r.json().usuario.rol).toBe('superadmin');
    const yo = await app.inject({ method: 'GET', url: '/admin/yo', headers: { cookie: galletaDe(r) } });
    expect(yo.json()).toMatchObject({ rol: 'admin', super: true });
    // Y pasa por las puertas de admin de siempre.
    expect((await app.inject({ method: 'GET', url: '/admin/usuarios', headers: { cookie: galletaDe(r) } })).statusCode).toBe(200);
  });

  it('un admin no crea ni toca superadministradores; un superadmin si', async () => {
    const sup = await sesion();
    const adm = await sesion('admin');
    expect((await app.inject({ method: 'GET', url: '/admin/yo', headers: adm })).json()).toMatchObject({ rol: 'admin', super: false });
    expect((await app.inject({ method: 'POST', url: '/admin/usuarios', headers: adm, payload: { usuario: 'otro', nombre: 'Otro', clave: 'otro-2026-wa', rol: 'superadmin' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/admin/usuarios', headers: adm, payload: { usuario: 'ope2', nombre: 'Ope', clave: 'ope2-2026-wa', rol: 'operador' } })).statusCode).toBe(200);
    const lista = (await app.inject({ method: 'GET', url: '/admin/usuarios', headers: adm })).json() as Array<{ id: string; usuario: string; rol: string }>;
    const ali = lista.find((u) => u.usuario === 'ali')!;
    expect(ali.rol).toBe('superadmin');
    expect((await app.inject({ method: 'POST', url: `/admin/usuarios/${ali.id}`, headers: adm, payload: { activo: false } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/admin/usuarios/${ali.id}`, headers: adm, payload: { clave: 'nueva-clave-123' } })).statusCode).toBe(403);
    // El superadmin crea otro superadmin y entonces si puede bajarse a admin.
    expect((await app.inject({ method: 'POST', url: `/admin/usuarios/${ali.id}`, headers: sup, payload: { rol: 'admin' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/admin/usuarios', headers: sup, payload: { usuario: 'super2', nombre: 'Super 2', clave: 'super2-2026-wa', rol: 'superadmin' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/admin/usuarios/${ali.id}`, headers: sup, payload: { rol: 'admin' } })).statusCode).toBe(200);
  });
});

describe('la membresia local', () => {
  it('sin membresia todo va; el superadmin la pone y manda; el admin la ve sin pagos', async () => {
    const sup = await sesion();
    const adm = await sesion('admin');
    let m = (await app.inject({ method: 'GET', url: '/admin/membresia', headers: adm })).json();
    expect(m).toMatchObject({ origen: 'libre', editable: true, soySuper: false, plan: null });
    expect(m.planes.map((p: { clave: string }) => p.clave)).toEqual(['prueba', 'basico', 'pro', 'personalizado']);
    expect((await app.inject({ method: 'POST', url: '/admin/membresia', headers: adm, payload: { plan: 'pro', vencimiento: '2026-12-31' } })).statusCode).toBe(403);

    const r = await app.inject({ method: 'POST', url: '/admin/membresia', headers: sup, payload: { plan: 'basico', vencimiento: '2026-10-18', contacto: 'Escríbenos al 987654321', limites: { usuarios: 3 } } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ origen: 'local', plan: { plan: 'basico', nombre: 'Básico', vencido: false, limites: { iaTurnosMes: 2000, usuarios: 3, campanas: false } } });
    // "Pagada hasta el 18/10" incluye el 18 entero (fin del dia en Lima): del 18/09 al 18/10 son 31 dias.
    expect(r.json().plan.diasRestantes).toBe(31);
    // El admin la ve, pero sin los pagos; y /admin/plan (la caja de Configuracion) tambien la enseña.
    m = (await app.inject({ method: 'GET', url: '/admin/membresia', headers: adm })).json();
    expect(m).toMatchObject({ origen: 'local', soySuper: false, plan: { nombre: 'Básico' } });
    expect(m.local.pagos).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/admin/plan', headers: adm })).json().origen).toBe('local');
    // Manda: sin campañas en el basico, y tope de 3 cuentas (ya hay 2).
    expect(plan.motivo('campanas')).toContain('no incluye campañas');
    expect((await app.inject({ method: 'POST', url: '/admin/usuarios', headers: sup, payload: { usuario: 'user3', nombre: 'U3', clave: 'user3-2026-wa', rol: 'operador' } })).statusCode).toBe(200);
    const tope = await app.inject({ method: 'POST', url: '/admin/usuarios', headers: sup, payload: { usuario: 'user4', nombre: 'U4', clave: 'user4-2026-wa', rol: 'operador' } });
    expect(tope.statusCode).toBe(400);
    expect(tope.json().error).toContain('permite 3 cuentas');
  });

  it('vencida o suspendida, la IA se calla; un pago corre el vencimiento; quitar vuelve a libre', async () => {
    const sup = await sesion();
    await app.inject({ method: 'POST', url: '/admin/membresia', headers: sup, payload: { plan: 'pro', vencimiento: '2026-09-20' } });
    const c = await repos.contacts.upsertFromInbound('51987654321', 'Maria');
    await repos.contacts.setOptIn('51987654321', 'prueba');
    expect((await ia.turno(c, 'hola')).resultado).toBe('respondio');
    // Se suspende: como vencida.
    await app.inject({ method: 'POST', url: '/admin/membresia', headers: sup, payload: { plan: 'pro', vencimiento: '2026-09-20', estado: 'suspendida' } });
    const t = await ia.turno(c, 'hola');
    expect(t.resultado).toBe('inactiva');
    expect(t.detalle).toContain('suspendida');
    expect(plan.estado().aviso?.texto).toContain('suspendida');
    // Vuelve a activa pero el tiempo pasa y vence.
    await app.inject({ method: 'POST', url: '/admin/membresia', headers: sup, payload: { plan: 'pro', vencimiento: '2026-09-20', estado: 'activa' } });
    reloj.ahora = new Date('2026-09-25T12:00:00Z');
    expect(plan.estado().plan).toMatchObject({ vencido: true });
    expect((await ia.turno(c, 'hola')).detalle).toContain('vencida');
    // Un pago de 2 meses desde hoy (ya habia vencido) → 25/11.
    const pago = await app.inject({ method: 'POST', url: '/admin/membresia/pagos', headers: sup, payload: { meses: 2, monto: 298, nota: 'Yape' } });
    expect(pago.statusCode).toBe(200);
    expect(pago.json().plan.vencimiento.slice(0, 10)).toBe('2026-11-25');
    expect(pago.json().local.pagos).toHaveLength(1);
    expect(pago.json().local.pagos[0]).toMatchObject({ meses: 2, monto: 298, nota: 'Yape', por: 'Ali (ali)' });
    expect((await ia.turno(c, 'hola')).resultado).toBe('respondio');
    // Aviso de "vence en N dias" a menos de una semana.
    reloj.ahora = new Date('2026-11-22T12:00:00Z');
    expect(plan.estado().aviso?.texto).toContain('vence en 3 días');
    // Quitar: libre.
    expect((await app.inject({ method: 'DELETE', url: '/admin/membresia', headers: sup })).json().origen).toBe('libre');
    expect(plan.limiteUsuarios()).toBeNull();
  });
});

describe('codigos de conexion', () => {
  it('se crea con fecha limite, se canjea una vez sin clave y la clave que sale vale con los permisos marcados', async () => {
    const h = await sesion('admin');
    const r = await app.inject({ method: 'POST', url: '/admin/codigos-conexion', headers: h, payload: { para: 'Stoky', dias: 7, permisos: ['estado:leer'] } });
    expect(r.statusCode).toBe(200);
    const c = r.json().codigo;
    expect(c).toMatchObject({ para: 'Stoky', estadoReal: 'activo', usosMax: 1, usos: 0, permisos: ['estado:leer'] });
    expect(r.json().pasos.join(' ')).toContain(c.codigo);
    expect(new Date(c.caducaAt).getTime() - Date.now()).toBeGreaterThan(6.9 * 86400000);

    // El canje: sin Authorization, y el codigo escrito de cualquier manera.
    const canje = await app.inject({ method: 'POST', url: '/api/v1/conexion/canjear', headers: json, payload: { codigo: c.codigo.toLowerCase().replace(/-/g, ' '), sistema: 'Stoky CRM 8102' } });
    expect(canje.statusCode).toBe(200);
    expect(canje.json()).toMatchObject({ ok: true, direccion: 'http://localhost:3000', para: 'Stoky', permisos: ['estado:leer'], usosRestantes: 0 });
    const clave = canje.json().clave as string;
    expect(clave).toMatch(/^wak_/);
    expect((await app.inject({ method: 'GET', url: '/api/v1/estado', headers: { 'x-api-key': clave } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/webhooks', headers: { 'x-api-key': clave } })).statusCode).toBe(403);
    // Segunda vez: ya no vale. Y en la lista queda quien lo canjeo.
    expect((await app.inject({ method: 'POST', url: '/api/v1/conexion/canjear', headers: json, payload: { codigo: c.codigo } })).statusCode).toBe(404);
    const lista = (await app.inject({ method: 'GET', url: '/admin/codigos-conexion', headers: h })).json().codigos;
    expect(lista[0]).toMatchObject({ estadoReal: 'usado', usos: 1, canjeadoPor: 'Stoky CRM 8102' });
    expect(lista[0].claveId).toBeTruthy();
  });

  it('la clave de conexion (wac_) lleva la direccion dentro y se canjea tal cual, en una sola pieza', async () => {
    expect(leerClaveDeConexion(claveDeConexion('http://localhost:3000/', 'WA-ABCD-2345'))).toEqual({ direccion: 'http://localhost:3000', codigo: 'WA-ABCD-2345' });
    expect(leerClaveDeConexion('wak_loquesea')).toBeNull();
    expect(leerClaveDeConexion('wac_' + Buffer.from('sin barra').toString('base64url'))).toBeNull();
    expect(leerClaveDeConexion('wac_' + Buffer.from('ftp://x|WA-ABCD-2345').toString('base64url'))).toBeNull();

    const h = await sesion('admin');
    const r = await app.inject({ method: 'POST', url: '/admin/codigos-conexion', headers: h, payload: { para: 'Stoky' } });
    expect(r.statusCode).toBe(200);
    const clave = r.json().claveConexion as string;
    expect(clave).toMatch(/^wac_/);
    expect(leerClaveDeConexion(clave)).toEqual({ direccion: 'http://localhost:3000', codigo: r.json().codigo.codigo });
    expect(r.json().pasos[0]).toContain('una sola cosa');

    const canje = await app.inject({ method: 'POST', url: '/api/v1/conexion/canjear', headers: json, payload: { codigo: `  ${clave}  `, sistema: 'Stoky' } });
    expect(canje.statusCode).toBe(200);
    expect(canje.json()).toMatchObject({ ok: true, direccion: 'http://localhost:3000', para: 'Stoky' });
    expect((await app.inject({ method: 'GET', url: '/api/v1/estado', headers: { 'x-api-key': canje.json().clave } })).statusCode).toBe(200);
    // Una clave que no descifra no revela nada: mismo 404 que un codigo inventado.
    expect((await app.inject({ method: 'POST', url: '/api/v1/conexion/canjear', headers: json, payload: { codigo: 'wac_zzzz' } })).statusCode).toBe(404);
    // La clave que salio aparece en Claves de API con el nombre del codigo.
    const claves = (await app.inject({ method: 'GET', url: '/admin/claves-api', headers: h })).json() as Array<{ nombre: string }>;
    expect(claves.some((k) => k.nombre === 'Stoky')).toBe(true);
  });

  it('caducado, anulado o inventado no se canjean; una fecha pasada no se acepta; y hay tope de intentos', async () => {
    const h = await sesion();
    expect((await app.inject({ method: 'POST', url: '/admin/codigos-conexion', headers: h, payload: { para: 'x', caducaAt: '2020-01-01' } })).statusCode).toBe(400);
    const corto = (await app.inject({ method: 'POST', url: '/admin/codigos-conexion', headers: h, payload: { para: 'Tienda', dias: 1 / 24, usosMax: 2 } })).json().codigo;
    const anulado = (await app.inject({ method: 'POST', url: '/admin/codigos-conexion', headers: h, payload: { para: 'Otro', caducaAt: '2027-01-01' } })).json().codigo;
    expect((await app.inject({ method: 'DELETE', url: `/admin/codigos-conexion/${anulado.id}`, headers: h })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/conexion/canjear', headers: json, payload: { codigo: anulado.codigo } })).statusCode).toBe(404);
    // Dos usos: dos canjes buenos y el tercero no.
    expect((await app.inject({ method: 'POST', url: '/api/v1/conexion/canjear', headers: json, payload: { codigo: corto.codigo } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/conexion/canjear', headers: json, payload: { codigo: corto.codigo } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/conexion/canjear', headers: json, payload: { codigo: corto.codigo } })).statusCode).toBe(404);
    // Un caducado (se cambia la fecha en el doble) tampoco.
    const cad = (await app.inject({ method: 'POST', url: '/admin/codigos-conexion', headers: h, payload: { para: 'Viejo', dias: 1 } })).json().codigo;
    repos.codigosConexion._codigos.find((x) => x.id === cad.id)!.caducaAt = new Date(Date.now() - 1000);
    expect((await app.inject({ method: 'POST', url: '/api/v1/conexion/canjear', headers: json, payload: { codigo: cad.codigo } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/admin/codigos-conexion', headers: h })).json().codigos.find((x: { id: string }) => x.id === cad.id).estadoReal).toBe('caducado');
    // Tope: a la vigesimoprimera, 429.
    let ultimo = 0;
    for (let i = 0; i < 25; i++) ultimo = (await app.inject({ method: 'POST', url: '/api/v1/conexion/canjear', headers: json, payload: { codigo: 'WA-ZZZZ-ZZZZ' } })).statusCode;
    expect(ultimo).toBe(429);
  });

  it('un operador no crea codigos; la pantalla tiene la membresia y los codigos', async () => {
    const ope = await sesion('operador');
    expect((await app.inject({ method: 'POST', url: '/admin/codigos-conexion', headers: ope, payload: { para: 'x' } })).statusCode).toBe(403);
    const sup = await sesion();
    const panel = await app.inject({ method: 'GET', url: '/panel', headers: sup });
    expect(panel.body).toContain('tab-membresia');
    expect(panel.body).toContain('Códigos de conexión');
    expect(panel.body).toContain('cc-crear-stoky');
  });
});
