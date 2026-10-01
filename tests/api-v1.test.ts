/**
 * La API publica: lo que ve otro sistema con una clave acotada.
 *
 * Se prueba el contrato (nombres estables, codigos de respuesta), que los
 * permisos de la clave mandan, que enviar pasa por las mismas guardas que
 * el chat, y que el OpenAPI no se queda viejo respecto a las rutas.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { hashClaveApi, prefijoDeClave } from '../src/auth/claves-api.js';
import { NOMBRES_PERMISOS, permisosAceptables, tienePermiso } from '../src/auth/permisos.js';
import { verificarFirma } from '../src/webhooks/firma.js';
import { approvedTemplate, createFakeRepos, createFakeSettings, createFakeWhatsApp, type FakeRepos, type FakeWhatsApp, CLAVE_API_PRUEBA as TODO } from './fakes.js';
import { crearEscenarioEntregas } from './escenario-entregas.js';
import { despacharEntregas, encolarEventos } from '../src/webhooks/despachador.js';

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
} as NodeJS.ProcessEnv;

const queue: OutboundQueue = {
  async enqueue() {},
  async enqueueMany(jobs) {
    return jobs.length;
  },
  async pause() {},
  async resume() {},
  async counts() {
    return { waiting: 0 };
  },
  async close() {},
};

/** La clave de Stoky: solo mensajes, conversaciones y contactos. */
const STOKY = 'wak_claveDeStokyAcotada0123456789abcdefXYZ';
/** Una clave que solo gestiona webhooks. */
const SOLO_WEBHOOKS = 'wak_claveSoloWebhooks0123456789abcdefXYZ00';

let app: FastifyInstance;
let repos: FakeRepos;
let wa: FakeWhatsApp;
const config = loadConfig(ENV);

/** Lo que "contesta" la URL del webhook al probarlo. */
let respuestaWebhook: { status: number; body: string } = { status: 200, body: 'ok' };
const recibido: Array<{ url: string; cabeceras: Record<string, string>; cuerpo: string }> = [];
const fetchFalso = (async (url: string | URL | Request, init?: RequestInit) => {
  recibido.push({ url: String(url), cabeceras: (init?.headers ?? {}) as Record<string, string>, cuerpo: String(init?.body ?? '') });
  return new Response(respuestaWebhook.body, { status: respuestaWebhook.status });
}) as unknown as typeof fetch;

const con = (clave: string) => ({ authorization: `Bearer ${clave}`, 'content-type': 'application/json' });

async function build() {
  repos = createFakeRepos();
  repos._claves.push(
    { id: 'clave-stoky', nombre: 'Stoky', prefijo: prefijoDeClave(STOKY), hash: hashClaveApi(STOKY), creadaPor: null, createdAt: new Date(), ultimoUsoAt: null, revocadaAt: null, permisos: ['mensajes:enviar', 'conversaciones:leer', 'contactos:leer', 'contactos:escribir', 'plantillas:leer', 'estado:leer'] },
    { id: 'clave-wh', nombre: 'Solo webhooks', prefijo: prefijoDeClave(SOLO_WEBHOOKS), hash: hashClaveApi(SOLO_WEBHOOKS), creadaPor: null, createdAt: new Date(), ultimoUsoAt: null, revocadaAt: null, permisos: ['webhooks:gestionar'] },
  );
  wa = createFakeWhatsApp();
  const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
  const settings = await createFakeSettings(config);
  return buildServer({ config, repos, settings, wa, sender, queue, logger: false, webhooks: { fetchImpl: fetchFalso, timeoutMs: 100 } });
}

/** Un cliente con consentimiento que escribio hace un momento (ventana abierta). */
async function clienteActivo(phone = '51987654321', nombre = 'Maria') {
  const c = await repos.contacts.upsertFromInbound(phone, nombre);
  await repos.contacts.setOptIn(phone, 'prueba');
  await repos.contacts.touchInbound(phone, new Date());
  return c;
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
  recibido.length = 0;
  respuestaWebhook = { status: 200, body: 'ok' };
  app = await build();
  await app.ready();
});

describe('permisos', () => {
  it('las reglas: * lo abre todo, una lista acota, lo desconocido se rechaza', () => {
    expect(tienePermiso(['*'], 'mensajes:enviar')).toBe(true);
    expect(tienePermiso(['mensajes:enviar'], 'mensajes:enviar')).toBe(true);
    expect(tienePermiso(['mensajes:enviar'], 'webhooks:gestionar')).toBe(false);
    expect(tienePermiso(undefined, 'estado:leer')).toBe(false);
    expect(permisosAceptables(undefined)).toEqual({ permisos: ['*'] });
    expect(permisosAceptables([])).toEqual({ permisos: ['*'] });
    expect(permisosAceptables(['estado:leer', ' estado:leer ', '*'])).toEqual({ permisos: ['*'] });
    expect(permisosAceptables(['estado:leer', 'todo'])).toMatchObject({ error: expect.stringContaining('todo') });
    expect(permisosAceptables('x')).toMatchObject({ error: expect.any(String) });
    expect(NOMBRES_PERMISOS).toContain('*');
  });

  it('sin clave, 401; con una clave sin ese permiso, 403 que dice cual falta', async () => {
    const sin = await app.inject({ method: 'GET', url: '/api/v1/estado' });
    expect(sin.statusCode).toBe(401);
    const mal = await app.inject({ method: 'GET', url: '/api/v1/webhooks', headers: con(STOKY) });
    expect(mal.statusCode).toBe(403);
    expect(mal.json().error).toContain('webhooks:gestionar');
    const bien = await app.inject({ method: 'GET', url: '/api/v1/webhooks', headers: con(SOLO_WEBHOOKS) });
    expect(bien.statusCode).toBe(200);
  });

  it('una clave acotada no entra por /admin; una con * si', async () => {
    const acotada = await app.inject({ method: 'GET', url: '/admin/health', headers: con(STOKY) });
    expect(acotada.statusCode).toBe(403);
    expect(acotada.json().error).toContain('/api/v1');
    const total = await app.inject({ method: 'GET', url: '/admin/health', headers: con(TODO) });
    expect(total.statusCode).toBe(200);
    // Y la clave total entra tambien por la API publica.
    expect((await app.inject({ method: 'GET', url: '/api/v1/estado', headers: con(TODO) })).statusCode).toBe(200);
  });

  it('crear una clave con permisos desde el panel los guarda; permisos malos, 400', async () => {
    // Una cuenta admin: se crea la primera y se entra con su cookie.
    const alta = await app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { nombre: 'Ali', usuario: 'ali', clave: 'contrasena-larga' } });
    const cookie = (alta.headers['set-cookie'] as string).split(';')[0]!;
    const mal = await app.inject({ method: 'POST', url: '/admin/claves-api', headers: { cookie }, payload: { nombre: 'Stoky', permisos: ['volar'] } });
    expect(mal.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/admin/claves-api', headers: { cookie }, payload: { nombre: 'Stoky', permisos: ['mensajes:enviar'] } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().registro.permisos).toEqual(['mensajes:enviar']);
    const nueva = ok.json().clave as string;
    expect((await app.inject({ method: 'GET', url: '/api/v1/estado', headers: con(nueva) })).statusCode).toBe(403);
    // Y desde el panel, con cookie, la API publica tambien responde (la pantalla la usa).
    expect((await app.inject({ method: 'GET', url: '/api/v1/webhooks', headers: { cookie } })).statusCode).toBe(200);
  });
});

describe('estado y contrato', () => {
  it('GET /api/v1 y /api/v1/estado cuentan que hay', async () => {
    const raiz = await app.inject({ method: 'GET', url: '/api/v1', headers: con(STOKY) });
    expect(raiz.json()).toMatchObject({ version: 'v1', documentacion: '/api/v1/openapi.json' });
    const estado = await app.inject({ method: 'GET', url: '/api/v1/estado', headers: con(STOKY) });
    expect(estado.statusCode).toBe(200);
    expect(estado.json()).toMatchObject({ proveedor: 'cloud', configurado: true, numero: { nivel: 'verde', pausado: false }, ventana24hAplica: true });
    expect(estado.json().cupoDiario).toBeGreaterThan(0);
  });

  it('el OpenAPI cubre todas las rutas de /api/v1 y cada una lleva su permiso', async () => {
    const doc = (await app.inject({ method: 'GET', url: '/api/v1/openapi.json', headers: con(STOKY) })).json() as {
      paths: Record<string, Record<string, { 'x-permiso'?: string }>>;
      servers: Array<{ url: string }>;
    };
    expect(doc.servers[0]!.url).toBe('http://localhost:3000/api/v1');

    const registradas = app.rutasApiV1.map((r) => ({ ...r, ruta: r.ruta.replace('/api/v1', '').replace(/:(\w+)/g, '{$1}') || '/' }));
    expect(registradas.length).toBeGreaterThan(15);
    for (const { ruta, metodo, permiso } of registradas) {
      const operacion = doc.paths[ruta]?.[metodo.toLowerCase()];
      expect(operacion, `falta ${metodo} ${ruta} en el OpenAPI`).toBeTruthy();
      expect(operacion!['x-permiso'] ?? null, `${metodo} ${ruta}: el permiso del OpenAPI no es el de la ruta`).toBe(permiso);
    }
    // Las rutas con datos exigen permiso; las de contrato no.
    expect(doc.paths['/mensajes']!.post!['x-permiso']).toBe('mensajes:enviar');
    expect(doc.paths['/']!.get!['x-permiso']).toBeUndefined();
  });

  it('los eventos publicados coinciden con los del bus', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/eventos', headers: con(STOKY) });
    const nombres = (r.json().eventos as Array<{ nombre: string }>).map((e) => e.nombre);
    expect(nombres).toContain('mensaje.recibido');
    expect(nombres).toContain('salud.nivel');
  });
});

describe('POST /api/v1/mensajes', () => {
  it('manda un texto a un cliente con la ventana abierta y devuelve el id', async () => {
    await clienteActivo();
    const r = await app.inject({ method: 'POST', url: '/api/v1/mensajes', headers: con(STOKY), payload: { telefono: '+51 987 654 321', texto: 'Tu pedido P-1024 ya salio' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, estado: 'enviado', mensajeId: expect.any(String), entregaId: expect.any(Number) });
    expect(wa.sent[0]).toMatchObject({ to: '51987654321' });
    // Queda en el hilo como saliente.
    const hilo = await app.inject({ method: 'GET', url: '/api/v1/conversaciones/51987654321', headers: con(STOKY) });
    expect(hilo.json().mensajes.at(-1)).toMatchObject({ direccion: 'saliente', texto: 'Tu pedido P-1024 ya salio' });
  });

  it('una guarda lo frena: 202 con estado bloqueado y el motivo, nunca 200', async () => {
    // Nadie escribio nunca desde este numero y no hay opt-in: no sale nada.
    const r = await app.inject({ method: 'POST', url: '/api/v1/mensajes', headers: con(STOKY), payload: { telefono: '51911000001', texto: 'hola' } });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toMatchObject({ ok: false, estado: 'bloqueado', codigo: expect.any(String), motivo: expect.any(String) });
    expect(wa.sent).toHaveLength(0);
  });

  it('crea el contacto y registra el consentimiento en la misma llamada', async () => {
    await repos.templates.upsert(approvedTemplate({ name: 'confirmacion_pedido', category: 'UTILITY', variables: 1 }));
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/mensajes',
      headers: con(STOKY),
      payload: { telefono: '51912000002', nombre: 'Luis', consentimiento: { origen: 'pedido P-7 en la tienda web' }, plantilla: { nombre: 'confirmacion_pedido', variables: ['P-7'] } },
    });
    expect(r.statusCode).toBe(200);
    const c = await repos.contacts.getByPhone('51912000002');
    expect(c).toMatchObject({ name: 'Luis', optInSource: 'pedido P-7 en la tienda web' });
    expect(c!.optInAt).toBeTruthy();
  });

  it('sin texto ni plantilla ni ubicacion, 400; plantilla desconocida, 400', async () => {
    await clienteActivo();
    const vacio = await app.inject({ method: 'POST', url: '/api/v1/mensajes', headers: con(STOKY), payload: { telefono: '51987654321' } });
    expect(vacio.statusCode).toBe(400);
    const sinPlantilla = await app.inject({ method: 'POST', url: '/api/v1/mensajes', headers: con(STOKY), payload: { telefono: '51987654321', plantilla: { nombre: 'no_existe' } } });
    expect(sinPlantilla.statusCode).toBe(400);
    expect(sinPlantilla.json().error).toContain('no_existe');
  });

  it('manda un pin desde coordenadas o desde un link, y pide la ubicacion', async () => {
    await clienteActivo();
    const pin = await app.inject({ method: 'POST', url: '/api/v1/mensajes', headers: con(STOKY), payload: { telefono: '51987654321', ubicacion: { lat: -12.04, lng: -77.04, nombre: 'Tienda' } } });
    expect(pin.statusCode).toBe(200);
    expect(wa.sent[0]).toMatchObject({ location: { latitude: -12.04, longitude: -77.04 } });
    const link = await app.inject({ method: 'POST', url: '/api/v1/mensajes', headers: con(STOKY), payload: { telefono: '51987654321', ubicacion: 'https://www.google.com/maps/place/-12.05,-77.05' } });
    expect(link.statusCode).toBe(200);
    const malo = await app.inject({ method: 'POST', url: '/api/v1/mensajes', headers: con(STOKY), payload: { telefono: '51987654321', ubicacion: 'esto no es un mapa' } });
    expect(malo.statusCode).toBe(400);
    const pedir = await app.inject({ method: 'POST', url: '/api/v1/mensajes', headers: con(STOKY), payload: { telefono: '51987654321', pedirUbicacion: true } });
    expect(pedir.statusCode).toBe(200);
  });
});

describe('conversaciones y contactos', () => {
  it('lista los chats y el hilo con nombres estables', async () => {
    const c = await clienteActivo();
    await repos.messages.add({ contactId: c.id, direction: 'in', wamid: 'w1', kind: 'text', body: 'tienen la 40?' });
    const lista = await app.inject({ method: 'GET', url: '/api/v1/conversaciones', headers: con(STOKY) });
    expect(lista.statusCode).toBe(200);
    expect(lista.json().conversaciones[0]).toMatchObject({ telefono: '51987654321', nombre: 'Maria', ventanaAbierta: true, noLeidos: 1, ultimoMensaje: { direccion: 'entrante', texto: 'tienen la 40?' } });

    const hilo = await app.inject({ method: 'GET', url: '/api/v1/conversaciones/51987654321', headers: con(STOKY) });
    expect(hilo.json()).toMatchObject({ contacto: { telefono: '51987654321' }, ventanaAbierta: true, puedeEscribir: true, motivo: null });
    expect(hilo.json().mensajes[0]).toMatchObject({ mensajeId: 'w1', direccion: 'entrante', tipo: 'text' });

    const nadie = await app.inject({ method: 'GET', url: '/api/v1/conversaciones/51912000009', headers: con(STOKY) });
    expect(nadie.statusCode).toBe(404);
  });

  it('un contacto de baja o con la ventana cerrada lo dice', async () => {
    await repos.contacts.upsertFromInbound('51911111111', 'Callado');
    const cerrada = await app.inject({ method: 'GET', url: '/api/v1/conversaciones/51911111111', headers: con(STOKY) });
    expect(cerrada.json()).toMatchObject({ puedeEscribir: false, motivo: expect.stringContaining('24 h') });
    await repos.contacts.setOptOut('51911111111');
    const baja = await app.inject({ method: 'GET', url: '/api/v1/conversaciones/51911111111', headers: con(STOKY) });
    expect(baja.json()).toMatchObject({ puedeEscribir: false, motivo: expect.stringContaining('baja') });
  });

  it('alta con consentimiento (201 nuevo, 200 existente), consulta y baja', async () => {
    const nuevo = await app.inject({ method: 'POST', url: '/api/v1/contactos', headers: con(STOKY), payload: { telefono: '51922222222', nombre: 'Rosa', consentimiento: { origen: 'formulario web' } } });
    expect(nuevo.statusCode).toBe(201);
    expect(nuevo.json().contacto).toMatchObject({ telefono: '51922222222', nombre: 'Rosa', consentimiento: { origen: 'formulario web' }, baja: null });
    const otra = await app.inject({ method: 'POST', url: '/api/v1/contactos', headers: con(STOKY), payload: { telefono: '51922222222' } });
    expect(otra.statusCode).toBe(200);

    const uno = await app.inject({ method: 'GET', url: '/api/v1/contactos/51922222222', headers: con(STOKY) });
    expect(uno.json().contacto.nombre).toBe('Rosa');
    const lista = await app.inject({ method: 'GET', url: '/api/v1/contactos?q=rosa', headers: con(STOKY) });
    expect(lista.json().total).toBe(1);

    const baja = await app.inject({ method: 'POST', url: '/api/v1/contactos/51922222222/baja', headers: con(STOKY) });
    expect(baja.statusCode).toBe(200);
    expect((await repos.contacts.getByPhone('51922222222'))!.optOutAt).toBeTruthy();
    expect((await app.inject({ method: 'POST', url: '/api/v1/contactos/51912000000/baja', headers: con(STOKY) })).statusCode).toBe(404);
  });

  it('las plantillas: solo las aprobadas', async () => {
    await repos.templates.upsert(approvedTemplate({ name: 'aprobada' }));
    await repos.templates.upsert(approvedTemplate({ name: 'pendiente', status: 'PENDING' }));
    const r = await app.inject({ method: 'GET', url: '/api/v1/plantillas', headers: con(STOKY) });
    expect(r.json().plantillas.map((p: { nombre: string }) => p.nombre)).toEqual(['aprobada']);
  });
});

describe('webhooks por la API', () => {
  it('se registra, devuelve el secreto una vez, se prueba, se cambia y se borra', async () => {
    const alta = await app.inject({ method: 'POST', url: '/api/v1/webhooks', headers: con(SOLO_WEBHOOKS), payload: { url: 'https://stoky.test/webhooks/whatsapp', descripcion: 'Stoky', eventos: ['mensaje.recibido', 'ubicacion.recibida'] } });
    expect(alta.statusCode).toBe(201);
    const { webhook, secreto } = alta.json() as { webhook: { id: string; eventos: string[]; activo: boolean }; secreto: string };
    expect(secreto.startsWith('whsec_')).toBe(true);
    expect(webhook).toMatchObject({ eventos: ['mensaje.recibido', 'ubicacion.recibida'], activo: true });
    // En la lista no viaja el secreto.
    const lista = await app.inject({ method: 'GET', url: '/api/v1/webhooks', headers: con(SOLO_WEBHOOKS) });
    expect(JSON.stringify(lista.json())).not.toContain(secreto);

    // Probar: llega un prueba.ping firmado con ese secreto.
    const prueba = await app.inject({ method: 'POST', url: `/api/v1/webhooks/${webhook.id}/probar`, headers: con(SOLO_WEBHOOKS) });
    expect(prueba.json()).toMatchObject({ ok: true, codigo: 200, respuesta: 'ok' });
    expect(recibido).toHaveLength(1);
    expect(recibido[0]!.cabeceras['x-evento']).toBe('prueba.ping');
    expect(verificarFirma(secreto, recibido[0]!.cuerpo, recibido[0]!.cabeceras['x-firma'])).toBe(true);

    respuestaWebhook = { status: 500, body: 'se rompio' };
    const mal = await app.inject({ method: 'POST', url: `/api/v1/webhooks/${webhook.id}/probar`, headers: con(SOLO_WEBHOOKS) });
    expect(mal.json()).toMatchObject({ ok: false, codigo: 500, error: 'HTTP 500' });

    const cambio = await app.inject({ method: 'PATCH', url: `/api/v1/webhooks/${webhook.id}`, headers: con(SOLO_WEBHOOKS), payload: { activo: false, eventos: ['*'] } });
    expect(cambio.json().webhook).toMatchObject({ activo: false, eventos: ['*'] });

    const rotado = await app.inject({ method: 'POST', url: `/api/v1/webhooks/${webhook.id}/secreto`, headers: con(SOLO_WEBHOOKS) });
    expect(rotado.json().secreto).not.toBe(secreto);

    expect((await app.inject({ method: 'DELETE', url: `/api/v1/webhooks/${webhook.id}`, headers: con(SOLO_WEBHOOKS) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/v1/webhooks/${webhook.id}`, headers: con(SOLO_WEBHOOKS) })).statusCode).toBe(404);

    // Un id que no es uuid (pegado a medias) es un 404 normal, no un 500:
    // en Postgres la comparacion reventaba antes de llegar al repo (2026-09-17).
    for (const url of ['/api/v1/webhooks/no-es-uuid', '/api/v1/webhooks/no-es-uuid/entregas', '/api/v1/webhooks/undefined']) {
      const r = await app.inject({ method: 'GET', url, headers: con(SOLO_WEBHOOKS) });
      expect(r.statusCode, url).toBe(404);
    }
  });

  it('rechaza URLs raras y eventos que no existen', async () => {
    const url = await app.inject({ method: 'POST', url: '/api/v1/webhooks', headers: con(SOLO_WEBHOOKS), payload: { url: 'ftp://x' } });
    expect(url.statusCode).toBe(400);
    const evento = await app.inject({ method: 'POST', url: '/api/v1/webhooks', headers: con(SOLO_WEBHOOKS), payload: { url: 'https://x.test', eventos: ['mensaje.volador'] } });
    expect(evento.statusCode).toBe(400);
    expect(evento.json().error).toContain('mensaje.recibido');
  });

  it('las entregas se consultan y las fallidas se reencolan', async () => {
    const alta = await app.inject({ method: 'POST', url: '/api/v1/webhooks', headers: con(SOLO_WEBHOOKS), payload: { url: 'https://x.test' } });
    const id = alta.json().webhook.id as string;
    const e = await repos.webhooks.encolar(id, 'contacto.baja', { x: 1 });
    await repos.webhooks.marcarEntrega(e, { estado: 'fallida', codigo: 404, respuesta: null, error: 'HTTP 404' });
    const entregas = await app.inject({ method: 'GET', url: `/api/v1/webhooks/${id}/entregas`, headers: con(SOLO_WEBHOOKS) });
    expect(entregas.json().entregas[0]).toMatchObject({ evento: 'contacto.baja', estado: 'fallida', respuestaCodigo: 404 });
    const re = await app.inject({ method: 'POST', url: `/api/v1/webhooks/${id}/reencolar`, headers: con(SOLO_WEBHOOKS) });
    expect(re.json()).toMatchObject({ ok: true, reencoladas: 1 });
  });
});

// ---------------------------------------------------------------- GSG empuja (constructor E)

describe('GSG empuja sus pedidos por la API (POST /api/v1/entregas)', () => {
  type Escenario = Awaited<ReturnType<typeof crearEscenarioEntregas>>;
  let esc: Escenario;
  /** Una clave que solo lee entregas: no puede empujar. */
  const SOLO_LEER = 'wak_claveSoloLeerEntregas0123456789abcdefX';
  const conClave = (clave: string) => ({ authorization: `Bearer ${clave}`, 'content-type': 'application/json' });

  beforeAll(async () => {
    esc = await crearEscenarioEntregas({ supervisor: '51999888777' });
    esc.repos._claves.push({ id: 'clave-leer', nombre: 'Solo leer', prefijo: prefijoDeClave(SOLO_LEER), hash: hashClaveApi(SOLO_LEER), creadaPor: null, createdAt: new Date(), ultimoUsoAt: null, revocadaAt: null, permisos: ['entregas:leer'] });
  });
  afterAll(async () => {
    await esc.cerrar();
  });

  it('dos pedidos entran con sus banderas, el repetido no se duplica, el sin telefono se descarta con motivo, y sin permiso 403 en cristiano', async () => {
    const r = await esc.api.post<{ ok: boolean; creadas: Array<Record<string, unknown>>; repetidas: string[]; descartadas: Array<{ referencia: string; motivo: string }>; detalle: string }>('/api/v1/entregas', {
      pedidos: [
        { referencia: 'P-5001', telefono: '987000101', nombre: 'Ana Quispe', direccion: 'Av. Larco 123', distrito: 'Miraflores', faltaUbicacion: true, faltaConfirmar: true },
        { referencia: 'P-5002', telefono: '51987000102', nombre: 'Luis Rojas', lat: -12.1211, lng: -77.0301, faltaConfirmar: true, urgente: true },
        { referencia: 'P-5003', telefono: '12', nombre: 'Sin telefono' },
      ],
    });
    expect(r.status).toBe(201);
    expect(r.body.creadas.map((c) => c.referencia).sort()).toEqual(['P-5001', 'P-5002']);
    expect(r.body.descartadas).toHaveLength(1);
    expect(r.body.descartadas[0]!.motivo).toContain('tel');
    expect(r.body.detalle).toContain('2 pedidos nuevos');
    // En la pantalla, con lo que le falta a cada uno.
    const p1 = await esc.entrega('P-5001');
    expect(p1).toMatchObject({ ubicacionEstado: 'pendiente', confirmacionEstado: 'pendiente', estado: 'esperando_ubicacion' });
    const p2 = await esc.entrega('P-5002');
    expect(p2).toMatchObject({ ubicacionEstado: 'recibida', confirmacionEstado: 'pendiente', lat: -12.1211, prioridad: 'urgente' });
    const urgente = r.body.creadas.find((c) => c.referencia === 'P-5002')!;
    expect(urgente.prioridad).toBe('urgente');
    expect(urgente.ubicacion).toMatchObject({ estado: 'recibida', lat: -12.1211 });
    // Repetido: no se duplica.
    const otra = await esc.api.post<{ creadas: unknown[]; repetidas: string[] }>('/api/v1/entregas', { referencia: 'P-5001', telefono: '987000101' });
    expect(otra.status).toBe(200);
    expect(otra.body.creadas).toEqual([]);
    expect(otra.body.repetidas).toEqual(['P-5001']);
    expect((await esc.resumen()).entregas.filter((e) => e.referencia === 'P-5001')).toHaveLength(1);
    // Cuerpo vacio: 400 con explicacion.
    const vacio = await esc.app.inject({ method: 'POST', url: '/api/v1/entregas', headers: conClave(TODO), payload: {} });
    expect(vacio.statusCode).toBe(400);
    expect(vacio.json().error).toContain('Manda un pedido');
    // Sin permiso: 403.
    const sin = await esc.app.inject({ method: 'POST', url: '/api/v1/entregas', headers: conClave(SOLO_LEER), payload: { referencia: 'P-5009', telefono: '987000109' } });
    expect(sin.statusCode).toBe(403);
    expect(sin.json().error).toMatch(/permiso/i);
    // Pero si puede leer.
    const lee = await esc.app.inject({ method: 'GET', url: '/api/v1/entregas/P-5002', headers: conClave(SOLO_LEER) });
    expect(lee.statusCode).toBe(200);
    expect(lee.json().entrega).toMatchObject({ referencia: 'P-5002', nombre: 'Luis Rojas', prioridad: 'urgente' });
    expect(lee.json().eventos.length).toBeGreaterThan(0);
  });

  it('GET por referencia cuenta como va, DELETE cancela con motivo y un pedido cancelado no se cancela dos veces', async () => {
    const no = await esc.api.get<{ error: string }>('/api/v1/entregas/P-NADA');
    expect(no.status).toBe(404);
    expect(no.body.error).toContain('P-NADA');
    const del = await esc.app.inject({ method: 'DELETE', url: '/api/v1/entregas/P-5001?motivo=el%20cliente%20anulo', headers: conClave(TODO) });
    expect(del.statusCode).toBe(200);
    expect(del.json().entrega).toMatchObject({ referencia: 'P-5001', estado: 'cancelada' });
    expect(del.json().detalle).toContain('el cliente anulo');
    expect(await esc.entrega('P-5001')).toMatchObject({ estado: 'cancelada' });
    const otra = await esc.app.inject({ method: 'DELETE', url: '/api/v1/entregas/P-5001', headers: conClave(TODO) });
    expect(otra.statusCode).toBe(409);
    expect(otra.json().error).toContain('cancelado');
  });

  it('lo que pasa despues llega por webhook: entrega.confirmada a la URL suscrita, firmada', async () => {
    const soltar = encolarEventos(esc.bus, esc.repos.webhooks);
    const alta = await esc.api.post<{ webhook: { id: string }; secreto: string }>('/api/v1/webhooks', { url: 'https://gsg.test/avisos', eventos: ['entrega.confirmada', 'entrega.avisada', 'entrega.entregada', 'entrega.incidencia'] });
    expect(alta.status).toBe(201);
    const p2 = (await esc.entrega('P-5002'))!;
    await esc.entregas.confirmarAMano(p2.id, true, 'prueba');
    // Deja que el bus encole (es asincrono) y despacha.
    await new Promise((r) => setTimeout(r, 30));
    recibido.length = 0;
    respuestaWebhook = { status: 200, body: 'ok' };
    const despacho = await despacharEntregas({ repo: esc.repos.webhooks, fetchImpl: fetchFalso, timeoutMs: 100 });
    expect(despacho.enviadas).toBeGreaterThanOrEqual(1);
    const llegada = recibido.find((r) => r.url === 'https://gsg.test/avisos' && r.cuerpo.includes('entrega.confirmada'));
    expect(llegada).toBeTruthy();
    const cuerpo = JSON.parse(llegada!.cuerpo) as { evento: string; datos: Record<string, unknown> };
    expect(cuerpo.evento).toBe('entrega.confirmada');
    expect(JSON.stringify(cuerpo.datos)).toContain('P-5002');
    expect(verificarFirma(alta.body.secreto, llegada!.cuerpo, llegada!.cabeceras['x-firma'])).toBe(true);
    soltar();
  });

  it('el OpenAPI documenta /entregas, /entregas/{referencia} y /motorizados con su permiso, y cubre todas las rutas de este arranque', async () => {
    const doc = (await esc.app.inject({ method: 'GET', url: '/api/v1/openapi.json', headers: conClave(TODO) })).json() as { paths: Record<string, Record<string, { 'x-permiso'?: string }>> };
    expect(doc.paths['/entregas']!.post!['x-permiso']).toBe('entregas:gestionar');
    expect(doc.paths['/entregas']!.get!['x-permiso']).toBe('entregas:leer');
    expect(doc.paths['/entregas/{referencia}']!.get!['x-permiso']).toBe('entregas:leer');
    expect(doc.paths['/entregas/{referencia}']!.delete!['x-permiso']).toBe('entregas:gestionar');
    expect(doc.paths['/motorizados']!.post!['x-permiso']).toBe('entregas:gestionar');
    const registradas = esc.app.rutasApiV1.map((r) => ({ ...r, ruta: r.ruta.replace('/api/v1', '').replace(/:(\w+)/g, '{$1}') || '/' }));
    expect(registradas.some((r) => r.ruta === '/entregas' && r.metodo === 'POST')).toBe(true);
    for (const { ruta, metodo, permiso } of registradas) {
      const operacion = doc.paths[ruta]?.[metodo.toLowerCase()];
      expect(operacion, `falta ${metodo} ${ruta} en el OpenAPI`).toBeTruthy();
      expect(operacion!['x-permiso'] ?? null, `${metodo} ${ruta}`).toBe(permiso);
    }
  });
});
