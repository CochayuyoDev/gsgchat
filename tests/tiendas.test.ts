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
import { crearServicioPlan, type EstadoInstancia, type ServicioPlan } from '../src/plan/servicio.js';
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
  RUTAS_SUPERVISOR: '51999000111',
} as NodeJS.ProcessEnv;

/** El parte de salud que manda la tienda con cada consulta (la prueba lo cambia a su gusto). */
const parte: { valor: EstadoInstancia } = { valor: { whatsapp: 'conectado', mensajesHoy: 12, fallosIA: 0, entregasHoy: 3, version: '1.2.3' } };

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
  const plan = await crearServicioPlan({ settingsRepo, url: '', token: '', ahora: () => reloj.ahora, fetchImpl: fetchAlMaestro, cadaMs: 60_000_000, estado: () => parte.valor });
  const proveedor: ProveedorIA = { nombre: 'falso', async chat() { return 'Hola.'; } };
  const ia = await crearServicioIA({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, repos, sender, config, nombreNegocio: () => nombre, proveedor, modelosGratis: ['google/gemma-4-31b-it'], plan });
  await ia.guardar({ token: 'tok', activa: true, conocimiento: 'x' });
  const tiendas = crearServicioTiendas({ repo: repos.tiendas, baseUrl, ahora: () => reloj.ahora, actividad: repos.actividad, sender });
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
  const method = ((init?.method ?? 'GET').toUpperCase()) as 'GET' | 'POST';
  const r = await maestro.app.inject({ method, url: u.pathname + u.search, headers, ...(init?.body ? { payload: String(init.body) } : {}) });
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

// ---------------------------------------------------------------- el panel del dueño (constructor E)

/** Un PNG de 1x1 como data URL: la "captura" del pago. */
const CAPTURA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('el panel del dueño: salud, avisos, historial, cobro por captura', () => {
  it('la tienda manda su parte de salud con cada consulta y el maestro lo enseña en palabras', async () => {
    const sup = await superDe(maestro);
    const alta = await maestro.app.inject({ method: 'POST', url: '/admin/tiendas', headers: sup, payload: { nombre: 'Zapatería Lima', contacto: 'Rosa · 987 654 321', membresia: { plan: 'basico', vencimiento: '2026-10-18T23:59:59' } } });
    const { tienda: t, token } = alta.json();
    // Antes de que la tienda pregunte: sin parte.
    let lista = (await maestro.app.inject({ method: 'GET', url: '/admin/tiendas', headers: sup })).json();
    expect(lista.tiendas[0].salud).toMatchObject({ whatsapp: { nivel: 'sin', texto: 'Sin parte todavía' }, parteAt: null });
    expect(lista.tiendas[0].telefonoContacto).toBe('51987654321');
    // La tienda se conecta: con la consulta va la cabecera x-gsgchat-estado.
    const supTienda = await superDe(tienda, 'rosa');
    parte.valor = { whatsapp: 'caido', mensajesHoy: 40, fallosIA: 2, entregasHoy: 9, version: '1.2.3' };
    const con = await tienda.app.inject({ method: 'POST', url: '/admin/membresia/maestro', headers: supTienda, payload: { url: 'http://maestro.local/api/plan/zapateria-lima', token } });
    expect(con.statusCode).toBe(200);
    lista = (await maestro.app.inject({ method: 'GET', url: '/admin/tiendas', headers: sup })).json();
    const salud = lista.tiendas[0].salud;
    expect(salud.whatsapp).toMatchObject({ nivel: 'bad' });
    expect(salud.whatsapp.texto).toContain('WhatsApp caído');
    expect(salud.mensajes.texto).toBe('40 mensajes hoy');
    expect(salud.ia).toMatchObject({ nivel: 'warn', texto: '2 fallos de IA hoy' });
    expect(salud).toMatchObject({ entregasHoy: 9, version: '1.2.3', parteViejo: false, hace: 'ahora mismo' });
    expect(lista.resumen.conProblemas).toBe(1);
    expect(JSON.stringify(lista)).not.toContain('"wa":');
    // Se recupera: en el siguiente parte, verde.
    parte.valor = { ...parte.valor, whatsapp: 'conectado', fallosIA: 0 };
    await tienda.plan.refrescar();
    lista = (await maestro.app.inject({ method: 'GET', url: '/admin/tiendas', headers: sup })).json();
    expect(lista.tiendas[0].salud.whatsapp).toEqual({ nivel: 'ok', texto: 'WhatsApp conectado' });
    expect(lista.tiendas[0].salud.ia.texto).toBe('IA sin fallos hoy');
    expect(lista.resumen.conProblemas).toBe(0);
    // Pasan 50 minutos sin partes: se dice.
    reloj.ahora = new Date('2026-09-18T12:50:00Z');
    lista = (await maestro.app.inject({ method: 'GET', url: '/admin/tiendas', headers: sup })).json();
    expect(lista.tiendas[0].salud.parteViejo).toBe(true);
    expect(lista.tiendas[0].salud.whatsapp.texto).toContain('último parte');
    // Un parte roto en la cabecera no rompe la consulta del plan.
    const raro = await maestro.app.inject({ method: 'GET', url: '/api/plan/zapateria-lima', headers: { authorization: `Bearer ${token}`, 'x-gsgchat-estado': 'esto no es json' } });
    expect(raro.statusCode).toBe(200);
    void t;
  });

  it('avisos de vencimiento: a 7 días se manda uno solo a la tienda y al dueño, no dos; los textos se editan y se previsualizan', async () => {
    const sup = await superDe(maestro);
    // Vence el 24/09 (fin del dia en Lima): desde el 18/09 son 7 dias contados como los cuenta la membresia.
    await maestro.app.inject({ method: 'POST', url: '/admin/tiendas', headers: sup, payload: { nombre: 'Tienda Siete', contacto: 'Rosa · 987 654 321', membresia: { plan: 'basico', vencimiento: '2026-09-24', contacto: 'Escríbenos al 900 000 000' } } });
    // Otra que vence en 20 dias: no toca.
    await maestro.app.inject({ method: 'POST', url: '/admin/tiendas', headers: sup, payload: { nombre: 'Tienda Veinte', membresia: { plan: 'pro', vencimiento: '2026-10-08' } } });
    const antes = maestro.wa.sent.length;
    const r1 = await maestro.app.inject({ method: 'POST', url: '/admin/tiendas/avisos/revisar', headers: sup, payload: {} });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().revision).toMatchObject({ revisadas: 2, yaAvisadas: 0 });
    expect(r1.json().revision.mandados).toHaveLength(1);
    expect(r1.json().revision.mandados[0]).toMatchObject({ tienda: 'Tienda Siete', tipo: 'vence7', aTienda: '51987654321', alDueno: true, fallo: null });
    expect(r1.json().mensaje).toContain('1 aviso mandado');
    const salidos = maestro.wa.sent.slice(antes).filter((m) => m.kind !== 'read');
    const aTienda = salidos.find((m) => String(m.to) === '51987654321');
    const alDueno = salidos.find((m) => String(m.to) === '51999000111');
    expect(String(aTienda?.body)).toContain('Tienda Siete');
    expect(String(aTienda?.body)).toContain('en 7 días');
    expect(String(aTienda?.body)).toContain('24/09/2026');
    expect(String(aTienda?.body)).toContain('Escríbenos al 900 000 000');
    expect(String(alDueno?.body)).toContain('Tienda Siete');
    expect(String(alDueno?.body)).toContain('avisada');
    // Otra vez: nada nuevo.
    const r2 = await maestro.app.inject({ method: 'POST', url: '/admin/tiendas/avisos/revisar', headers: sup, payload: {} });
    expect(r2.json().revision).toMatchObject({ yaAvisadas: 1, mandados: [] });
    expect(r2.json().mensaje).toContain('ya se avisó');
    // El dia antes: toca el de 1 dia (otro tipo, otro aviso).
    reloj.ahora = new Date('2026-09-24T14:00:00Z');
    const r3 = await maestro.app.inject({ method: 'POST', url: '/admin/tiendas/avisos/revisar', headers: sup, payload: {} });
    expect(r3.json().revision.mandados.map((m: { tipo: string }) => m.tipo)).toEqual(['vence1']);
    // Textos editables con vista previa; apagados, no sale nada.
    const guardar = await maestro.app.inject({ method: 'POST', url: '/admin/tiendas/avisos', headers: sup, payload: { vence7: 'Hola {tienda}: {dias} días, vence el {fecha}.', activo: false } });
    expect(guardar.statusCode).toBe(200);
    expect(guardar.json().textos).toMatchObject({ activo: false, vence7: 'Hola {tienda}: {dias} días, vence el {fecha}.' });
    const vista = await maestro.app.inject({ method: 'POST', url: '/admin/tiendas/avisos/previsualizar', headers: sup, payload: { tipo: 'vence7', texto: 'Hola {tienda}: {dias} días, vence el {fecha}.' } });
    expect(vista.json().texto).toMatch(/^Hola Tienda (Siete|Veinte): 7 días, vence el \d{2}\/\d{2}\/\d{4}\.$/);
    reloj.ahora = new Date('2026-09-25T14:00:00Z');
    const r4 = await maestro.app.inject({ method: 'POST', url: '/admin/tiendas/avisos/revisar', headers: sup, payload: {} });
    expect(r4.json().revision).toMatchObject({ apagado: true, mandados: [] });
    expect(r4.json().mensaje).toContain('apagados');
    // Un admin normal no puede.
    await maestro.app.inject({ method: 'POST', url: '/admin/usuarios', headers: sup, payload: { usuario: 'dueno', nombre: 'Dueño', clave: 'dueno-2026-wa', rol: 'admin' } });
    const adm = { cookie: galletaDe(await maestro.app.inject({ method: 'POST', url: '/login', payload: { usuario: 'dueno', clave: 'dueno-2026-wa' } })), ...json };
    expect((await maestro.app.inject({ method: 'GET', url: '/admin/tiendas/avisos', headers: adm })).statusCode).toBe(403);
  });

  it('el historial de la tienda lista el alta, el pago apuntado y la suspensión; y se le escribe por WhatsApp desde la fila', async () => {
    const sup = await superDe(maestro);
    const alta = (await maestro.app.inject({ method: 'POST', url: '/admin/tiendas', headers: sup, payload: { nombre: 'Tienda Historial', contacto: 'Rosa · 987 654 321', membresia: { plan: 'basico', vencimiento: '2026-10-18' } } })).json();
    const id = alta.tienda.id as string;
    await maestro.app.inject({ method: 'POST', url: `/admin/tiendas/${id}/pagos`, headers: sup, payload: { meses: 1, monto: 49, nota: 'Yape' } });
    await maestro.app.inject({ method: 'POST', url: `/admin/tiendas/${id}/suspender`, headers: sup, payload: { suspendida: true } });
    const h = await maestro.app.inject({ method: 'GET', url: `/admin/tiendas/${id}/historial`, headers: sup });
    expect(h.statusCode).toBe(200);
    const acciones = (h.json().historial as Array<{ accion: string; etiqueta: string; usuario: string }>).map((x) => x.accion);
    expect(acciones).toContain('tienda.alta');
    expect(acciones).toContain('tienda.pago');
    expect(acciones).toContain('tienda.suspender');
    expect(acciones.filter((a) => a === 'tienda.pago')).toHaveLength(1);
    expect(h.json().historial.every((x: { usuario: string }) => x.usuario)).toBe(true);
    expect(h.json().historial.find((x: { accion: string }) => x.accion === 'tienda.pago').etiqueta).toBe('Apuntó un pago');
    // Avisar por WhatsApp.
    const antes = maestro.wa.sent.length;
    const av = await maestro.app.inject({ method: 'POST', url: `/admin/tiendas/${id}/avisar`, headers: sup, payload: { texto: 'Hola Rosa, te escribo de GSGchat: ¿todo bien con el sistema?' } });
    expect(av.statusCode).toBe(200);
    expect(av.json().mensaje).toContain('+51987654321');
    const salido = maestro.wa.sent.slice(antes).find((m) => String(m.to) === '51987654321');
    expect(String(salido?.body)).toContain('te escribo de GSGchat');
    // Sin telefono en el contacto: se explica.
    const sinTel = (await maestro.app.inject({ method: 'POST', url: '/admin/tiendas', headers: sup, payload: { nombre: 'Tienda Muda', contacto: 'Pepe', membresia: { plan: 'prueba', vencimiento: '2026-10-18' } } })).json();
    const no = await maestro.app.inject({ method: 'POST', url: `/admin/tiendas/${sinTel.tienda.id}/avisar`, headers: sup, payload: { texto: 'hola' } });
    expect(no.statusCode).toBe(400);
    expect(no.json().error).toContain('no tiene un WhatsApp');
    // La otra tienda no ve el historial de esta (solo super del maestro).
    const otro = await maestro.app.inject({ method: 'GET', url: '/admin/tiendas/no-existe/historial', headers: sup });
    expect(otro.statusCode).toBe(404);
  });

  it('cómo me pagan + captura: el dueño configura Yape/Plin, la tienda lo ve en /pagar, manda su captura, el dueño la ve y un clic apunta el pago; rechazo con motivo', async () => {
    const sup = await superDe(maestro);
    const alta = (await maestro.app.inject({ method: 'POST', url: '/admin/tiendas', headers: sup, payload: { nombre: 'Zapatería Lima', membresia: { plan: 'basico', vencimiento: '2026-10-18T23:59:59' } } })).json();
    const { tienda: t, token } = alta;
    // Como me pagan.
    const cobro = await maestro.app.inject({ method: 'POST', url: '/admin/tiendas/cobro', headers: sup, payload: { activo: true, numero: '987 111 222', texto: 'Yape o Plin a nombre de Ali. Manda la captura aquí.', qr: CAPTURA } });
    expect(cobro.statusCode).toBe(200);
    expect(cobro.json().cobro).toMatchObject({ activo: true, numero: '987 111 222' });
    expect((await maestro.app.inject({ method: 'POST', url: '/admin/tiendas/cobro', headers: sup, payload: { qr: 'data:text/plain;base64,aGk=' } })).statusCode).toBe(400);
    // La tienda se conecta y lo ve en su pantalla Pagar.
    const supTienda = await superDe(tienda, 'rosa');
    await tienda.app.inject({ method: 'POST', url: '/admin/membresia/maestro', headers: supTienda, payload: { url: 'http://maestro.local/api/plan/zapateria-lima', token } });
    let pagar = (await tienda.app.inject({ method: 'GET', url: '/admin/membresia/pagar', headers: supTienda })).json();
    expect(pagar).toMatchObject({ origen: 'maestro', puedeMandarCaptura: true, cobro: { numero: '987 111 222', qr: CAPTURA }, ultimoPago: null });
    expect(pagar.plan.nombre).toBe('Básico');
    // Manda la captura (2 meses).
    const mala = await tienda.app.inject({ method: 'POST', url: '/admin/membresia/pago-captura', headers: supTienda, payload: { imagen: 'no-es-imagen', meses: 2 } });
    expect(mala.statusCode).toBe(400);
    expect(mala.json().error).toContain('imagen');
    const env = await tienda.app.inject({ method: 'POST', url: '/admin/membresia/pago-captura', headers: supTienda, payload: { imagen: CAPTURA, meses: 2, monto: 98, nota: 'Op. 12345' } });
    expect(env.statusCode).toBe(200);
    expect(env.json().pago).toMatchObject({ estado: 'pendiente', meses: 2, monto: 98 });
    pagar = (await tienda.app.inject({ method: 'GET', url: '/admin/membresia/pagar', headers: supTienda })).json();
    expect(pagar.ultimoPago).toMatchObject({ estado: 'pendiente', meses: 2 });
    // El dueño la ve.
    let lista = (await maestro.app.inject({ method: 'GET', url: '/admin/tiendas', headers: sup })).json();
    expect(lista.resumen.pagosPendientes).toBe(1);
    expect(lista.pagosPendientes[0]).toMatchObject({ meses: 2, monto: 98, nota: 'Op. 12345', estado: 'pendiente', tienda: { nombre: 'Zapatería Lima' } });
    expect(lista.pagosPendientes[0].imagen).toBeUndefined();
    expect(lista.tiendas[0].pagosPendientes).toBe(1);
    const pagoId = lista.pagosPendientes[0].id as number;
    const conImagen = await maestro.app.inject({ method: 'GET', url: `/admin/tiendas/pagos/${pagoId}`, headers: sup });
    expect(conImagen.json().pago.imagen).toBe(CAPTURA);
    // Un clic: apuntado, y el vencimiento corre dos meses (18/10 → 18/12).
    const ok = await maestro.app.inject({ method: 'POST', url: `/admin/tiendas/pagos/${pagoId}/aceptar`, headers: sup, payload: { tiendaId: t.id } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().mensaje).toContain('18/12/2026');
    expect(ok.json().tienda.membresia.pagos).toHaveLength(1);
    expect(ok.json().tienda.membresia.pagos[0]).toMatchObject({ meses: 2, monto: 98 });
    expect((await maestro.app.inject({ method: 'POST', url: `/admin/tiendas/pagos/${pagoId}/aceptar`, headers: sup, payload: {} })).statusCode).toBe(400);
    lista = (await maestro.app.inject({ method: 'GET', url: '/admin/tiendas', headers: sup })).json();
    expect(lista.resumen.pagosPendientes).toBe(0);
    // La tienda se entera.
    await tienda.plan.refrescar();
    pagar = (await tienda.app.inject({ method: 'GET', url: '/admin/membresia/pagar', headers: supTienda })).json();
    expect(pagar.ultimoPago).toMatchObject({ estado: 'aceptado', meses: 2 });
    expect(new Date(pagar.plan.vencimiento).toLocaleDateString('es-PE', { timeZone: 'America/Lima' })).toBe('18/12/2026');
    // Otra captura, rechazada con motivo: la tienda lo lee.
    await tienda.app.inject({ method: 'POST', url: '/admin/membresia/pago-captura', headers: supTienda, payload: { imagen: CAPTURA, meses: 1 } });
    lista = (await maestro.app.inject({ method: 'GET', url: '/admin/tiendas', headers: sup })).json();
    const segunda = lista.pagosPendientes[0].id as number;
    expect((await maestro.app.inject({ method: 'POST', url: `/admin/tiendas/pagos/${segunda}/rechazar`, headers: sup, payload: { motivo: '' } })).statusCode).toBe(400);
    const rech = await maestro.app.inject({ method: 'POST', url: `/admin/tiendas/pagos/${segunda}/rechazar`, headers: sup, payload: { tiendaId: t.id, motivo: 'La captura no se ve entera.' } });
    expect(rech.statusCode).toBe(200);
    await tienda.plan.refrescar();
    pagar = (await tienda.app.inject({ method: 'GET', url: '/admin/membresia/pagar', headers: supTienda })).json();
    expect(pagar.ultimoPago).toMatchObject({ estado: 'rechazado', motivo: 'La captura no se ve entera.' });
    // Sin token, la captura no entra al maestro.
    expect((await maestro.app.inject({ method: 'POST', url: '/api/plan/zapateria-lima/pago', headers: { authorization: 'Bearer plt_malo', ...json }, payload: { imagen: CAPTURA, meses: 1 } })).statusCode).toBe(401);
    // Sin maestro (instancia libre), /pagar lo dice.
    await tienda.app.inject({ method: 'DELETE', url: '/admin/membresia/maestro', headers: supTienda });
    pagar = (await tienda.app.inject({ method: 'GET', url: '/admin/membresia/pagar', headers: supTienda })).json();
    expect(pagar).toMatchObject({ origen: 'libre', puedeMandarCaptura: false });
    expect(pagar.motivo).toContain('no tiene membresía');
    const sinM = await tienda.app.inject({ method: 'POST', url: '/admin/membresia/pago-captura', headers: supTienda, payload: { imagen: CAPTURA, meses: 1 } });
    expect(sinM.statusCode).toBe(400);
  });

  it('las páginas /tiendas, /mapa y /pagar responden con sesión, redirigen sin ella, sus scripts compilan y el mapa no lleva clave de Google', async () => {
    const vm = await import('node:vm');
    const sup = await superDe(maestro);
    for (const url of ['/tiendas', '/mapa', '/pagar']) {
      const sin = await maestro.app.inject({ method: 'GET', url });
      expect(sin.statusCode, `${url} sin sesión`).toBe(302);
      const r = await maestro.app.inject({ method: 'GET', url, headers: sup });
      expect(r.statusCode, url).toBe(200);
      let n = 0;
      for (const m of r.body.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
        n++;
        expect(() => new vm.Script(m[1]!, { filename: `${url}#${n}` }), `${url} script ${n}`).not.toThrow();
      }
      expect(n, url).toBeGreaterThan(0);
      expect(r.body).not.toContain('maps.googleapis.com');
    }
    const mapa = (await maestro.app.inject({ method: 'GET', url: '/mapa', headers: sup })).body;
    expect(mapa).toContain('tile.openstreetmap.org');
    expect(mapa).toContain('Todavía no hay ubicaciones hoy');
    const tiendasHtml = (await maestro.app.inject({ method: 'GET', url: '/tiendas', headers: sup })).body;
    expect(tiendasHtml).toContain('Cómo me pagan');
    expect(tiendasHtml).toContain('Avisos de vencimiento');
    expect(tiendasHtml).toContain('Pagos por revisar');
    const pagarHtml = (await maestro.app.inject({ method: 'GET', url: '/pagar', headers: sup })).body;
    expect(pagarHtml).toContain('Ya pagué: mandar mi captura');
  });

  it('/tiendas y /pagar dicen el estado de la membresía con las mismas palabras, y una suspendida no se lee como vencida', async () => {
    const vm = await import('node:vm');
    const sup = await superDe(maestro);

    /* Corre solo el JS de una pantalla (va tras su marca) con un DOM de
       mentira, y devuelve sus funciones para preguntarles. */
    const funcionesDe = async (url: string, marca: string) => {
      const body = (await maestro.app.inject({ method: 'GET', url, headers: sup })).body;
      const js = body.split(marca)[1]!.split('</script>')[0]!;
      const elFalso = (): Record<string, unknown> => ({
        value: '', textContent: '', innerHTML: '', checked: false, disabled: false, title: '', placeholder: '',
        style: {}, className: '', classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        setAttribute() {}, getAttribute: () => '', querySelectorAll: () => [], querySelector: () => null,
        scrollIntoView() {}, focus() {}, remove() {}, appendChild() {},
      });
      const ctx: Record<string, unknown> = {
        document: { getElementById: elFalso, querySelector: () => null, querySelectorAll: () => [], createElement: elFalso, body: { appendChild() {}, contains: () => true } },
        window: {}, setTimeout: () => 0, setInterval: () => 0,
        navigator: { clipboard: { writeText: () => Promise.resolve() } },
        FileReader: function () {}, fetch: () => Promise.reject(new Error('sin red')),
        irAlLogin() {}, errorHttp: (n: number) => 'error ' + n,
        confirmarDialogo: () => Promise.resolve(false), pedirDato: () => Promise.resolve(null),
      };
      ctx.globalThis = ctx;
      vm.createContext(ctx);
      vm.runInContext(js, ctx);
      return ctx as { estadoMembresia?: Function; estadoPlan?: Function; urgencia?: Function; dinero?: Function };
    };

    const t = await funcionesDe('/tiendas', '/* === pantalla Tiendas === */');
    const p = await funcionesDe('/pagar', '/* === pantalla Pagar === */');
    const tienda = (estado: string, dias: number, vencido: boolean) => ({
      membresia: { estado, vencimiento: '2026-10-18T23:59:59.000Z', moneda: 'S/', precioMes: 49 },
      plan: { vencido, diasRestantes: dias, nombre: 'Básico' },
      pagosPendientes: 0,
      salud: { whatsapp: { nivel: 'ok' } },
    });
    const plan = (dias: number, vencido: boolean) => ({ diasRestantes: dias, vencido, aviso: null, contacto: null });

    // Las dos caras del mismo asunto dicen lo mismo, con el mismo color.
    for (const [dias, vencido, estado] of [[30, false, 'activa'], [1, false, 'activa'], [5, false, 'activa'], [-3, true, 'activa'], [15, true, 'suspendida']] as const) {
      const a = t.estadoMembresia!(tienda(estado, dias, vencido));
      const b = p.estadoPlan!(plan(dias, vencido));
      expect(a.texto, `${dias} días, ${estado}`).toBe(b.texto);
      expect(a.tono).toBe(b.tono);
    }
    expect(t.estadoMembresia!(tienda('activa', 30, false)).texto).toBe('Al día');
    expect(t.estadoMembresia!(tienda('activa', 1, false)).texto).toBe('Vence mañana');
    expect(t.estadoMembresia!(tienda('activa', -3, true)).texto).toBe('Vencida');
    // El servidor marca `vencido` también al suspender: si aún quedan días, está suspendida, no vencida.
    expect(t.estadoMembresia!(tienda('suspendida', 15, true)).texto).toBe('Suspendida');
    expect(p.estadoPlan!(plan(15, true)).texto).toBe('Suspendida');

    // Lo urgente sube: primero las capturas por revisar, luego vencidas, suspendidas y por vencer.
    const conPago = { ...tienda('activa', 30, false), pagosPendientes: 2 };
    expect(t.urgencia!(conPago)).toBeLessThan(t.urgencia!(tienda('activa', -1, true)));
    expect(t.urgencia!(tienda('activa', -1, true))).toBeLessThan(t.urgencia!(tienda('suspendida', 10, true)));
    expect(t.urgencia!(tienda('suspendida', 10, true))).toBeLessThan(t.urgencia!(tienda('activa', 3, false)));
    expect(t.urgencia!(tienda('activa', 3, false))).toBeLessThan(t.urgencia!(tienda('activa', 30, false)));

    // Los importes salen siempre con dos decimales en las dos pantallas.
    expect(t.dinero!('S/', 49)).toBe('S/ 49.00');
    expect(p.dinero!('S/', 1234.5)).toBe('S/ 1,234.50');
  });

  it('acceso de soporte: la tienda lo concede desde /pagar, el maestro ve el enlace, el dueño entra como administrador y al quitarlo el enlace deja de valer', async () => {
    const sup = await superDe(maestro);
    const alta = await maestro.app.inject({ method: 'POST', url: '/admin/tiendas', headers: sup, payload: { nombre: 'Zapatería Lima', contacto: 'Rosa · 987 654 321', membresia: { plan: 'basico', vencimiento: '2026-10-18T23:59:59' } } });
    const { token } = alta.json();
    const supTienda = await superDe(tienda, 'rosa');
    parte.valor = { whatsapp: 'conectado', mensajesHoy: 1, fallosIA: 0, entregasHoy: 0, version: '1.0.0' };
    expect((await tienda.app.inject({ method: 'POST', url: '/admin/membresia/maestro', headers: supTienda, payload: { url: 'http://maestro.local/api/plan/zapateria-lima', token } })).statusCode).toBe(200);
    // Sin acceso todavia.
    expect((await tienda.app.inject({ method: 'GET', url: '/admin/membresia/soporte', headers: supTienda })).json().soporte).toBeNull();
    // Un administrador que no es superadministrador no puede concederlo.
    await tienda.app.inject({ method: 'POST', url: '/admin/usuarios', headers: supTienda, payload: { usuario: 'juan', nombre: 'Juan', clave: 'juan-2026-wa', rol: 'admin' } });
    const admTienda = { cookie: galletaDe(await tienda.app.inject({ method: 'POST', url: '/login', payload: { usuario: 'juan', clave: 'juan-2026-wa' } })), ...json };
    expect((await tienda.app.inject({ method: 'POST', url: '/admin/membresia/soporte', headers: admTienda, payload: {} })).statusCode).toBe(403);
    // La tienda concede 24 h.
    const dado = await tienda.app.inject({ method: 'POST', url: '/admin/membresia/soporte', headers: supTienda, payload: { horas: 24 } });
    expect(dado.statusCode).toBe(200);
    expect(dado.json().mensaje).toContain('Acceso concedido hasta');
    const enlace: string = dado.json().soporte.enlace;
    expect(enlace).toMatch(/\/soporte\/sop_/);
    // El maestro lo ve en la salud de la tienda (viaja con el parte).
    const lista = (await maestro.app.inject({ method: 'GET', url: '/admin/tiendas', headers: sup })).json();
    expect(lista.tiendas[0].salud.soporte).toMatchObject({ enlace });
    // El dueño entra con el enlace: sesion abierta como "soporte" (administrador, no superadministrador).
    const ruta = new URL(enlace, 'http://zapateria.local').pathname;
    const entra = await tienda.app.inject({ method: 'GET', url: ruta });
    expect(entra.statusCode).toBe(302);
    expect(entra.headers.location).toBe('/panel');
    const galleta = { cookie: galletaDe(entra), ...json };
    const yo = (await tienda.app.inject({ method: 'GET', url: '/admin/yo', headers: galleta })).json();
    expect(yo).toMatchObject({ usuario: 'soporte', rol: 'admin' });
    expect(yo.super).toBeFalsy();
    // Un codigo inventado no entra.
    expect((await tienda.app.inject({ method: 'GET', url: '/soporte/sop_inventado' })).statusCode).toBe(410);
    // La tienda lo quita: el enlace deja de valer y la sesion de soporte se cierra.
    expect((await tienda.app.inject({ method: 'DELETE', url: '/admin/membresia/soporte', headers: supTienda })).statusCode).toBe(200);
    expect((await tienda.app.inject({ method: 'GET', url: ruta })).statusCode).toBe(410);
    expect((await tienda.app.inject({ method: 'GET', url: '/admin/yo', headers: galleta })).statusCode).toBe(401);
    // Y caduca solo: se concede otra vez y se adelanta el reloj 25 h.
    const otra = await tienda.app.inject({ method: 'POST', url: '/admin/membresia/soporte', headers: supTienda, payload: { horas: 24 } });
    const ruta2 = new URL(otra.json().soporte.enlace, 'http://zapateria.local').pathname;
    reloj.ahora = new Date(reloj.ahora.getTime() + 25 * 3600_000);
    expect((await tienda.app.inject({ method: 'GET', url: ruta2 })).statusCode).toBe(410);
    expect((await tienda.app.inject({ method: 'GET', url: '/admin/membresia/soporte', headers: supTienda })).json().soporte).toBeNull();
  });

  it('recibo de pago: al apuntar un pago la tienda recibe por WhatsApp su recibo (editable, con vista previa) y se puede apagar', async () => {
    const sup = await superDe(maestro);
    const alta = await maestro.app.inject({ method: 'POST', url: '/admin/tiendas', headers: sup, payload: { nombre: 'Tienda Recibo', contacto: 'Rosa · 987 654 322', membresia: { plan: 'basico', vencimiento: '2026-10-18T23:59:59', precioMes: 49 } } });
    const { tienda: t } = alta.json();
    const antes = maestro.wa.sent.length;
    const pago = await maestro.app.inject({ method: 'POST', url: `/admin/tiendas/${t.id}/pagos`, headers: sup, payload: { meses: 2, monto: 98 } });
    expect(pago.statusCode).toBe(200);
    expect(pago.json().mensaje).toContain('Recibo enviado por WhatsApp');
    const recibo = maestro.wa.sent.slice(antes).find((m) => String(m.to) === '51987654322');
    expect(String(recibo?.body)).toContain('Tienda Recibo');
    expect(String(recibo?.body)).toContain('98');
    expect(String(recibo?.body)).toContain('2 mes(es)');
    // Vista previa del recibo y apagarlo.
    const vp = await maestro.app.inject({ method: 'POST', url: '/admin/tiendas/avisos/previsualizar', headers: sup, payload: { tipo: 'recibo', texto: 'Pago de {monto} {moneda} para {tienda}: hasta el {fecha}.' } });
    expect(vp.statusCode).toBe(200);
    expect(vp.json().texto).toMatch(/Pago de \d+ PEN para .+: hasta el \d{2}\/\d{2}\/\d{4}\./);
    await maestro.app.inject({ method: 'POST', url: '/admin/tiendas/avisos', headers: sup, payload: { reciboActivo: false } });
    const antes2 = maestro.wa.sent.length;
    const pago2 = await maestro.app.inject({ method: 'POST', url: `/admin/tiendas/${t.id}/pagos`, headers: sup, payload: { meses: 1, monto: 49 } });
    expect(pago2.json().mensaje).toContain('está apagado');
    expect(maestro.wa.sent.slice(antes2).filter((m) => String(m.to) === '51987654322')).toHaveLength(0);
    await maestro.app.inject({ method: 'POST', url: '/admin/tiendas/avisos', headers: sup, payload: { reciboActivo: true } });
  });

  it('latido: una tienda que lleva más de una hora sin preguntar por su plan en horario de trabajo se avisa al dueño una vez al día', async () => {
    const sup = await superDe(maestro);
    const alta = await maestro.app.inject({ method: 'POST', url: '/admin/tiendas', headers: sup, payload: { nombre: 'Tienda Callada', membresia: { plan: 'basico', vencimiento: '2026-12-18T23:59:59' } } });
    const { token } = alta.json();
    // 10:00 de Lima: la tienda pregunta una vez y luego se calla.
    reloj.ahora = new Date('2026-09-18T15:00:00Z');
    expect((await maestro.app.inject({ method: 'GET', url: '/api/plan/tienda-callada', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200);
    // Media hora despues: todavia no.
    reloj.ahora = new Date('2026-09-18T15:30:00Z');
    let r = await maestro.app.inject({ method: 'POST', url: '/admin/tiendas/avisos/revisar', headers: sup, payload: {} });
    expect(r.json().revision.sinLatido.join(' ')).not.toContain('Tienda Callada');
    // Hora y media despues, en horario: se avisa al dueño una vez.
    reloj.ahora = new Date('2026-09-18T16:31:00Z');
    const antes = maestro.wa.sent.length;
    r = await maestro.app.inject({ method: 'POST', url: '/admin/tiendas/avisos/revisar', headers: sup, payload: {} });
    expect(r.json().revision.sinLatido).toHaveLength(1);
    expect(r.json().revision.sinLatido[0]).toContain('Tienda Callada');
    const alDueno = maestro.wa.sent.slice(antes).find((m) => String(m.to) === '51999000111' && String(m.body).includes('sin dar señales'));
    expect(String(alDueno?.body)).toContain('Tienda Callada');
    // Otra revision el mismo dia: no se repite.
    reloj.ahora = new Date('2026-09-18T18:00:00Z');
    r = await maestro.app.inject({ method: 'POST', url: '/admin/tiendas/avisos/revisar', headers: sup, payload: {} });
    expect(r.json().revision.sinLatido).toHaveLength(0);
    // De noche no es noticia.
    reloj.ahora = new Date('2026-09-19T03:00:00Z');
    r = await maestro.app.inject({ method: 'POST', url: '/admin/tiendas/avisos/revisar', headers: sup, payload: {} });
    expect(r.json().revision.sinLatido).toHaveLength(0);
    // Con el ajuste en 0, nunca.
    await maestro.app.inject({ method: 'POST', url: '/admin/tiendas/avisos', headers: sup, payload: { sinLatidoHoras: 0 } });
    reloj.ahora = new Date('2026-09-19T16:00:00Z');
    r = await maestro.app.inject({ method: 'POST', url: '/admin/tiendas/avisos/revisar', headers: sup, payload: {} });
    expect(r.json().revision.sinLatido).toHaveLength(0);
    await maestro.app.inject({ method: 'POST', url: '/admin/tiendas/avisos', headers: sup, payload: { sinLatidoHoras: 1 } });
  });
});
