/**
 * La conexion con Stoky configurable desde la pantalla.
 *
 * Lo que importa: que sin conexion el resto del sistema se comporte como
 * "no hay catalogo" (el asistente no ofrece tomar pedidos, la consulta de
 * precio no salta), que al guardar desde la pantalla o al presentarse Stoky
 * por la API todo empiece a usar el catalogo sin reiniciar, que el token
 * quede cifrado, que el .env sea solo el valor inicial, que la clave para
 * Stoky se cree con un boton (y sustituya a la anterior), y que el semaforo
 * diga la verdad sobre las dos direcciones.
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
import { crearConexionStoky, hayCatalogo, type ServicioConexionStoky } from '../src/stoky/conexion.js';
import type { ProductoStoky, StokyClient } from '../src/stoky/client.js';
import { COMO_TOMAR_PEDIDO } from '../src/ia/conocimiento-sistema.js';
import { crearClaveDePrueba, createFakeRepos, createFakeWhatsApp, createMemorySettingsRepo, TEST_SETTINGS_KEY, type FakeRepos, type FakeWhatsApp } from './fakes.js';

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

/** Un Stoky de mentira: responde segun el token, y apunta lo que se le pide. */
function stokyFalso() {
  const fabricados: Array<{ baseUrl: string; token: string }> = [];
  const productos: ProductoStoky[] = [
    { sku: 'ZN-40', name: 'Zapato negro — 40', product: 'Zapato negro', price: 120, stock: 3 },
    { sku: 'ZR-42', name: 'Zapatilla roja — 42', product: 'Zapatilla roja', price: 90, stock: 0 },
  ];
  const fabrica = (o: { baseUrl: string; token: string }): StokyClient => {
    fabricados.push(o);
    const vale = o.token === 'stk_bueno' && /8102/.test(o.baseUrl);
    return {
      async ping() {
        return vale ? { ok: true, tenant: 'Zapateria Lima', warehouse: 'Principal' } : { ok: false, detail: 'HTTP 401 Unauthorized' };
      },
      async productos() {
        return vale ? productos : [];
      },
      async buscar(texto) {
        const palabras = texto.toLowerCase().split(/\s+/);
        return vale ? productos.filter((p) => palabras.some((w) => w.length > 3 && p.name.toLowerCase().includes(w))) : [];
      },
      async consultar() {
        return { disponibles: vale ? [productos[0]!] : [], agotados: [], similares: [], otrasVariantes: [] };
      },
      async precargar() {
        return vale ? { ok: true, total: productos.length } : { ok: false, total: 0, detail: 'HTTP 401 Unauthorized' };
      },
    };
  };
  return { fabrica, fabricados };
}

describe('el servicio de conexion', () => {
  it('sin nada configurado no hay catalogo; al guardar desde la pantalla, si, sin reiniciar; el token queda cifrado', async () => {
    const settingsRepo = createMemorySettingsRepo();
    const stoky = stokyFalso();
    const conexion = await crearConexionStoky({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, config: { STOKY_URL: '', STOKY_TOKEN: '', STOKY_PANEL_URL: '' }, fabrica: stoky.fabrica });
    const cliente = conexion.cliente();
    expect(hayCatalogo(cliente)).toBe(false);
    expect(conexion.estado()).toMatchObject({ configurada: false, origen: 'ninguna', tieneToken: false });
    expect(await cliente.productos()).toEqual([]);
    expect((await cliente.ping()).ok).toBe(false);

    await expect(conexion.guardar({ url: 'localhost:8102', token: 'stk_bueno' })).rejects.toThrow(/http/);
    await expect(conexion.guardar({ url: 'http://localhost:8102' })).rejects.toThrow(/token/);
    const e = await conexion.guardar({ url: 'http://localhost:8102/', token: 'stk_bueno', panelUrl: 'https://stoky.pe' });
    expect(e).toMatchObject({ configurada: true, origen: 'pantalla', url: 'http://localhost:8102', panelUrl: 'https://stoky.pe', tieneToken: true });
    // El MISMO objeto ahora responde con el catalogo.
    expect(hayCatalogo(cliente)).toBe(true);
    expect(await cliente.productos()).toHaveLength(2);
    const prueba = await conexion.probar();
    expect(prueba).toMatchObject({ ok: true, tienda: 'Zapateria Lima', almacen: 'Principal', productos: 2 });
    expect(conexion.estado().ultimaPrueba).toMatchObject({ ok: true });
    expect(conexion.estado().tienda).toBe('Zapateria Lima');
    // En la base, el token va cifrado y la conexion en claro sin token.
    const filas = await settingsRepo.getAll();
    const tok = filas.find((f) => f.key === 'stoky.token')!;
    expect(tok.encrypted).toBe(true);
    expect(tok.value).not.toContain('stk_bueno');
    expect(filas.find((f) => f.key === 'stoky.conexion')!.value).not.toContain('stk_');

    // Otro arranque lee lo guardado.
    const otra = await crearConexionStoky({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, config: { STOKY_URL: '', STOKY_TOKEN: '', STOKY_PANEL_URL: '' }, fabrica: stoky.fabrica });
    expect(otra.estado()).toMatchObject({ configurada: true, url: 'http://localhost:8102', tienda: 'Zapateria Lima' });

    // Un token malo: se guarda pero la prueba lo dice en cristiano.
    await conexion.guardar({ url: 'http://localhost:8102', token: 'stk_malo' });
    const mala = await conexion.probar();
    expect(mala.ok).toBe(false);
    expect(mala.detalle).toContain('no acepta el token');
    // Probar algo en pantalla no pisa lo guardado.
    const candidata = await conexion.probar({ url: 'http://localhost:8102', token: 'stk_bueno' });
    expect(candidata.ok).toBe(true);
    expect(conexion.estado().ultimaPrueba!.ok).toBe(false);

    await conexion.quitar();
    expect(conexion.estado()).toMatchObject({ configurada: false, origen: 'ninguna' });
    expect(hayCatalogo(cliente)).toBe(false);
  });

  it('el .env es el valor inicial: manda si no hay nada en la pantalla, y la pantalla lo sustituye', async () => {
    const settingsRepo = createMemorySettingsRepo();
    const stoky = stokyFalso();
    const conexion = await crearConexionStoky({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, config: { STOKY_URL: 'http://viejo:8102', STOKY_TOKEN: 'stk_bueno', STOKY_PANEL_URL: 'http://panel-viejo' }, fabrica: stoky.fabrica });
    expect(conexion.estado()).toMatchObject({ configurada: true, origen: 'env', url: 'http://viejo:8102', panelUrl: 'http://panel-viejo' });
    await conexion.guardar({ url: 'http://nuevo:8102', token: 'stk_bueno' });
    expect(conexion.estado()).toMatchObject({ origen: 'pantalla', url: 'http://nuevo:8102', panelUrl: 'http://nuevo:8102' });
    expect(stoky.fabricados.at(-1)?.baseUrl ?? (await conexion.cliente().ping(), stoky.fabricados.at(-1)!.baseUrl)).toBe('http://nuevo:8102');
    await conexion.quitar();
    expect(conexion.estado()).toMatchObject({ origen: 'env', url: 'http://viejo:8102' });
  });
});

// ------------------------------------------------------------ con servidor
const config = loadConfig(ENV);

function modeloFalso() {
  const recibido: MensajeIA[][] = [];
  const proveedor: ProveedorIA = {
    nombre: 'falso',
    async chat(mensajes) {
      recibido.push(mensajes);
      return 'Hola, ¿en qué te ayudo?';
    },
  };
  return { proveedor, recibido };
}

let app: FastifyInstance;
let repos: FakeRepos;
let wa: FakeWhatsApp;
let sender: Sender;
let settingsRepo: SettingsRepo;
let ia: ServicioIA;
let conexion: ServicioConexionStoky;
let stoky: ReturnType<typeof stokyFalso>;
let modelo: ReturnType<typeof modeloFalso>;

async function build() {
  repos = createFakeRepos();
  wa = createFakeWhatsApp();
  sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2, serviceWindowApplies: false });
  settingsRepo = createMemorySettingsRepo();
  const settings = await createSettingsService(settingsRepo, config, TEST_SETTINGS_KEY);
  await settings.save({ provider: 'local' });
  stoky = stokyFalso();
  conexion = await crearConexionStoky({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, config: { STOKY_URL: '', STOKY_TOKEN: '', STOKY_PANEL_URL: '' }, fabrica: stoky.fabrica });
  modelo = modeloFalso();
  ia = await crearServicioIA({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, repos, sender, config, nombreNegocio: () => 'Zapateria Lima', proveedor: modelo.proveedor, modelosGratis: ['google/gemma-4-31b-it'], catalogo: conexion.cliente() });
  await ia.guardar({ token: 'tok', activa: true, conocimiento: 'Zapateria.' });
  return buildServer({ config, repos, settings, wa, sender, queue, logger: false, ia, conexionStoky: conexion, catalogo: conexion.cliente() });
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

async function sesion(rol: 'admin' | 'operador' = 'admin'): Promise<Record<string, string>> {
  let primera = await app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { usuario: 'ali', nombre: 'Ali', clave: 'ali-2026-wa' } });
  if (primera.statusCode !== 200) primera = await app.inject({ method: 'POST', url: '/login', payload: { usuario: 'ali', clave: 'ali-2026-wa' } });
  const galleta = galletaDe(primera);
  if (rol === 'admin') return { cookie: galleta, 'content-type': 'application/json' };
  const crear = await app.inject({ method: 'POST', url: '/admin/usuarios', headers: { cookie: galleta, 'content-type': 'application/json' }, payload: { usuario: 'ope', nombre: 'Operadora', clave: 'ope-2026-wa', rol: 'operador' } });
  expect([200, 409]).toContain(crear.statusCode);
  const entrar = await app.inject({ method: 'POST', url: '/login', payload: { usuario: 'ope', clave: 'ope-2026-wa' } });
  return { cookie: galletaDe(entrar), 'content-type': 'application/json' };
}

describe('desde la pantalla', () => {
  it('el semaforo empieza en rojo por los dos lados y explica que falta', async () => {
    const h = await sesion();
    const r = await app.inject({ method: 'GET', url: '/admin/integraciones/stoky', headers: h });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.miDireccion).toBe('http://localhost:3000');
    expect(j.haciaAqui).toMatchObject({ claves: [], claveUsada: false, webhook: null, recibeMensajes: false });
    expect(j.haciaStoky).toMatchObject({ configurada: false, origen: 'ninguna' });
  });

  it('la clave para Stoky se crea con un boton, con todos los permisos, y sustituye a la anterior', async () => {
    const h = await sesion();
    const ope = await sesion('operador');
    expect((await app.inject({ method: 'POST', url: '/admin/integraciones/stoky/clave', headers: ope, payload: {} })).statusCode).toBe(403);
    const a = await app.inject({ method: 'POST', url: '/admin/integraciones/stoky/clave', headers: h, payload: {} });
    expect(a.statusCode).toBe(200);
    expect(a.json().clave).toMatch(/^wak_/);
    expect(a.json().registro).toMatchObject({ nombre: 'Stoky', permisos: ['*'] });
    expect(a.json().pasos.join(' ')).toContain('http://localhost:3000');
    const b = await app.inject({ method: 'POST', url: '/admin/integraciones/stoky/clave', headers: h, payload: {} });
    expect(b.json().revocadas).toBe(1);
    // La vieja ya no entra; la nueva si, y el semaforo lo ve.
    const cab = (k: string) => ({ 'x-api-key': k });
    expect((await app.inject({ method: 'GET', url: '/api/v1/estado', headers: cab(a.json().clave) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/estado', headers: cab(b.json().clave) })).statusCode).toBe(200);
    const s = await app.inject({ method: 'GET', url: '/admin/integraciones/stoky', headers: h });
    expect(s.json().haciaAqui).toMatchObject({ claveUsada: true });
    expect(s.json().haciaAqui.claves).toHaveLength(1);
  });

  it('guardar la direccion y el token conecta al momento: el asistente pasa a ofrecer pedidos con el catalogo', async () => {
    const h = await sesion();
    const c = await repos.contacts.upsertFromInbound('51987654321', 'Maria');
    await repos.contacts.setOptIn('51987654321', 'prueba');
    // Sin Stoky: el prompt no ofrece tomar pedidos ni trae productos.
    await ia.turno(c, 'tienen zapato negro 40?');
    expect(modelo.recibido.at(-1)![0]!.content).not.toContain(COMO_TOMAR_PEDIDO.slice(0, 40));

    const ope = await sesion('operador');
    expect((await app.inject({ method: 'POST', url: '/admin/integraciones/stoky', headers: ope, payload: { url: 'http://localhost:8102', token: 'stk_bueno' } })).statusCode).toBe(403);
    const probar = await app.inject({ method: 'POST', url: '/admin/integraciones/stoky/probar', headers: h, payload: { url: 'http://localhost:8102', token: 'stk_bueno' } });
    expect(probar.json()).toMatchObject({ ok: true, tienda: 'Zapateria Lima', productos: 2 });
    expect(conexion.estado().configurada).toBe(false);

    const r = await app.inject({ method: 'POST', url: '/admin/integraciones/stoky', headers: h, payload: { url: 'http://localhost:8102', token: 'stk_bueno', panelUrl: 'https://stoky.pe' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().mensaje).toContain('2 productos');
    expect(r.json().haciaStoky).toMatchObject({ configurada: true, origen: 'pantalla', panelUrl: 'https://stoky.pe' });

    await ia.turno(c, 'tienen zapato negro 40?');
    const sistema = modelo.recibido.at(-1)![0]!.content;
    expect(sistema).toContain(COMO_TOMAR_PEDIDO.slice(0, 40));
    expect(sistema).toContain('Zapato negro');
    expect(sistema).toContain('120');

    // El enlace para registrar la venta ya sabe a donde ir.
    const derivar = await app.inject({ method: 'GET', url: `/admin/leads/${c.id}/derivar`, headers: h });
    expect(derivar.statusCode).toBe(200);
    expect(derivar.json().url).toContain('https://stoky.pe/admin/sales');

    // Quitar: vuelve a no haber catalogo.
    expect((await app.inject({ method: 'DELETE', url: '/admin/integraciones/stoky', headers: h })).statusCode).toBe(200);
    expect(hayCatalogo(conexion.cliente())).toBe(false);
    expect((await app.inject({ method: 'GET', url: `/admin/leads/${c.id}/derivar`, headers: h })).statusCode).toBe(409);
  });

  it('Stoky se presenta por la API con su clave y todo queda conectado; sin el permiso no', async () => {
    const h = await sesion();
    const sin = await crearClaveDePrueba(repos, ['estado:leer']);
    const con = await crearClaveDePrueba(repos, ['stoky:conectar'], 'Stoky');
    const cab = (k: string) => ({ 'x-api-key': k, 'content-type': 'application/json' });
    expect((await app.inject({ method: 'POST', url: '/api/v1/stoky/conexion', headers: cab(sin), payload: { url: 'http://localhost:8102', token: 'stk_bueno' } })).statusCode).toBe(403);
    const r = await app.inject({ method: 'POST', url: '/api/v1/stoky/conexion', headers: cab(con), payload: { url: 'http://localhost:8102', token: 'stk_bueno', panelUrl: 'https://stoky.pe' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, configurada: true, prueba: { tienda: 'Zapateria Lima', productos: 2 } });
    const estado = await app.inject({ method: 'GET', url: '/api/v1/stoky/conexion', headers: cab(con) });
    expect(estado.json()).toMatchObject({ configurada: true, origen: 'stoky', url: 'http://localhost:8102' });
    expect(JSON.stringify(estado.json())).not.toContain('stk_');
    const panel = await app.inject({ method: 'GET', url: '/admin/integraciones/stoky', headers: h });
    expect(panel.json().haciaStoky).toMatchObject({ origen: 'stoky', tienda: 'Zapateria Lima' });
    expect(panel.json().haciaAqui.claveUsada).toBe(true);
    // Un token que Stoky no acepta se guarda pero se dice.
    const malo = await app.inject({ method: 'POST', url: '/api/v1/stoky/conexion', headers: cab(con), payload: { url: 'http://localhost:8102', token: 'stk_malo' } });
    expect(malo.json()).toMatchObject({ ok: false });
    expect(malo.json().prueba.detalle).toContain('token');
  });

  it('si Stoky se presenta desde su propia peticion y no puede contestar a la vez, se guarda y la prueba sigue por detras', async () => {
    // Un Stoky que tarda (artisan serve atiende una peticion a la vez): la
    // presentacion no se queda colgada; contesta "pendiente" y prueba luego.
    const lento = stokyFalso();
    const fabricaLenta = (o: { baseUrl: string; token: string }): StokyClient => {
      const real = lento.fabrica(o);
      return { ...real, ping: () => new Promise((r) => setTimeout(() => real.ping().then(r), 120)) };
    };
    const settings2 = createMemorySettingsRepo();
    const conexion2 = await crearConexionStoky({ settingsRepo: settings2, settingsKeyBase64: TEST_SETTINGS_KEY, config: { STOKY_URL: '', STOKY_TOKEN: '', STOKY_PANEL_URL: '' }, fabrica: fabricaLenta });
    const { default: Fastify } = await import('fastify');
    const suelto = Fastify({ logger: false });
    const { registerStokyRoutes } = await import('../src/stoky/routes.js');
    await registerStokyRoutes(suelto, { conexion: conexion2, repos, config: { PUBLIC_BASE_URL: 'http://localhost:3000' }, esperaPruebaMs: 30, reintentoPruebaMs: 10 });
    await suelto.ready();
    const t0 = Date.now();
    const r = await suelto.inject({ method: 'POST', url: '/api/v1/stoky/conexion', payload: { url: 'http://localhost:8102', token: 'stk_bueno' } });
    expect(Date.now() - t0).toBeLessThan(110);
    expect(r.json()).toMatchObject({ ok: true, configurada: true, prueba: { pendiente: true } });
    expect(conexion2.estado().ultimaPrueba).toBeNull();
    await new Promise((res) => setTimeout(res, 400));
    expect(conexion2.estado().ultimaPrueba).toMatchObject({ ok: true, tienda: 'Zapateria Lima', productos: 2 });
    await suelto.close();
  });

  it('el semaforo ve el aviso hacia Stoky y si recibe mensajes', async () => {
    const h = await sesion();
    const wh = await repos.webhooks.crear({ url: 'https://stoky.pe/webhooks/wa-locator/abc', descripcion: 'Stoky360', eventos: ['mensaje.recibido'], secreto: 's', creadoPor: null });
    let r = await app.inject({ method: 'GET', url: '/admin/integraciones/stoky', headers: h });
    expect(r.json().haciaAqui.webhook).toMatchObject({ url: 'https://stoky.pe/webhooks/wa-locator/abc', activo: true });
    expect(r.json().haciaAqui.recibeMensajes).toBe(false);
    await repos.webhooks.anotarResultado(wh.id, true, new Date());
    r = await app.inject({ method: 'GET', url: '/admin/integraciones/stoky', headers: h });
    expect(r.json().haciaAqui.recibeMensajes).toBe(true);
    const panel = await app.inject({ method: 'GET', url: '/panel', headers: h });
    expect(panel.body).toContain('Stoky: tu inventario y tus ventas');
    expect(panel.body).toContain('/admin/integraciones/stoky');
    const manual = await app.inject({ method: 'GET', url: '/manual', headers: h });
    expect(manual.body).toContain('m-stoky');
  });
});
