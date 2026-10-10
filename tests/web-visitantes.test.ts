/**
 * El canal web: los visitantes de la pagina del negocio chatean desde ahi.
 *
 * Lo que importa: que un visitante entre sin cuenta pero solo desde las webs
 * de la tienda, que su mensaje siga el mismo camino que uno de WhatsApp (lo
 * contesta el asistente, lo ve el equipo), que la respuesta le llegue a su
 * navegador y no a WhatsApp, y que nadie pueda leer la conversacion de
 * otro.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { createSettingsService } from '../src/settings/service.js';
import { crearBus } from '../src/eventos/bus.js';
import { observarRepos } from '../src/eventos/observar.js';
import { crearServicioAjustes } from '../src/ajustes/generales.js';
import { crearServicioIA } from '../src/ia/servicio.js';
import type { MensajeIA, ProveedorIA } from '../src/ia/proveedores.js';
import { esContactoWeb, firmarSesionWeb, leerSesionWeb, nombreDeVisitante, nuevoIdVisitante, origenPermitido, secretoDeCanalWeb } from '../src/web-visitantes/canal.js';
import { numeroPermitido } from '../src/salud/lista-blanca.js';
import { createFakeRepos, createFakeWhatsApp, createMemorySettingsRepo, TEST_SETTINGS_KEY, type FakeRepos, type FakeWhatsApp, CLAVE_API_PRUEBA as TODO } from './fakes.js';

const ENV = {
  PUBLIC_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'none',
  BUSINESS_NAME: 'Elysian',
  SOLO_NUMEROS: '51912000000',
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
const ORIGEN_TIENDA = 'https://holamellamobroaster.nom.pe';

let app: FastifyInstance;
let repos: FakeRepos;
let wa: FakeWhatsApp;
let bus: ReturnType<typeof crearBus>;
let direccion: string;
const modelo = { siguiente: 'Hola, soy Lucia de Elysian. ¿Qué reloj buscas?', recibido: [] as MensajeIA[][] };
const proveedor: ProveedorIA = {
  nombre: 'falso',
  async chat(m) {
    modelo.recibido.push(m);
    return modelo.siguiente;
  },
};

beforeAll(async () => {
  bus = crearBus();
  repos = observarRepos(createFakeRepos(), bus) as FakeRepos;
  wa = createFakeWhatsApp();
  const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2, soloNumeros: () => ['51912000000'] });
  const settingsRepo = createMemorySettingsRepo();
  const settings = await createSettingsService(settingsRepo, config, TEST_SETTINGS_KEY);
  const ajustes = await crearServicioAjustes({ repo: repos.ajustesGenerales, config });
  // Una tienda con «Todo el sistema»: con «Solo lo de GSG» la IA no conversa con clientes (regla del dueño).
  await ajustes.guardar({ modo: 'completo', embebido: { dominios: [ORIGEN_TIENDA] } });
  const ia = await crearServicioIA({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, repos, sender, config, nombreNegocio: () => 'Elysian', proveedor, modelosGratis: ['google/gemma-4-31b-it'] });
  await ia.guardar({ activa: true, token: 'tok', nombreAsistente: 'Lucia', conocimiento: 'Vendemos relojes originales.' });
  app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false, bus, ajustes, ia });
  await app.ready();
  direccion = await app.listen({ port: 0, host: '127.0.0.1' });
});

afterAll(async () => {
  await app.close();
});

describe('las piezas del canal', () => {
  it('el visitante tiene un id propio y una sesion firmada que caduca', () => {
    const id = nuevoIdVisitante();
    expect(esContactoWeb(id)).toBe(true);
    expect(esContactoWeb('51987654321')).toBe(false);
    expect(nombreDeVisitante(id)).toMatch(/^Visitante [0-9a-f]{4}$/);
    const secreto = secretoDeCanalWeb(config);
    const t = firmarSesionWeb(secreto, id, 1_000_000);
    expect(leerSesionWeb(secreto, t, 1_000_000 + 1000)).toMatchObject({ c: id });
    expect(leerSesionWeb(secreto, t, 1_000_000 + 31 * 24 * 3600_000)).toBeNull();
    expect(leerSesionWeb('otro', t, 1_000_000)).toBeNull();
    // Una sesion con un telefono de WhatsApp dentro no vale: solo visitantes.
    expect(leerSesionWeb(secreto, firmarSesionWeb(secreto, '51987654321', 1_000_000), 1_000_000)).toBeNull();
  });

  it('los origenes: la web de la tienda y el propio sitio, nadie mas', () => {
    expect(origenPermitido('https://holamellamobroaster.nom.pe/', 'http://localhost:3000', [ORIGEN_TIENDA])).toBe(true);
    expect(origenPermitido('HTTPS://HolaMellamoBroaster.nom.pe', 'http://localhost:3000', [ORIGEN_TIENDA])).toBe(true);
    expect(origenPermitido('http://localhost:3000', 'http://localhost:3000', [])).toBe(true);
    expect(origenPermitido('https://otra.com', 'http://localhost:3000', [ORIGEN_TIENDA])).toBe(false);
    expect(origenPermitido(undefined, 'http://localhost:3000', [ORIGEN_TIENDA])).toBe(false);
  });

  it('el modo prueba no calla a los visitantes web', () => {
    expect(numeroPermitido({ soloNumeros: ['51912000000'] }, 'web-abcdef0123456789')).toBe(true);
    expect(numeroPermitido({ soloNumeros: ['51912000000'] }, '51987654321')).toBe(false);
  });
});

describe('desde la web de la tienda', () => {
  const desde = { origin: ORIGEN_TIENDA, 'content-type': 'application/json' };

  it('otra web no puede usar el chat (403); la de la tienda si, con CORS', async () => {
    const ajena = await app.inject({ method: 'POST', url: '/web/sesion', headers: { origin: 'https://otra.com', 'content-type': 'application/json' }, payload: {} });
    expect(ajena.statusCode).toBe(403);
    expect(ajena.json().error).toContain('otra.com');
    const pre = await app.inject({ method: 'OPTIONS', url: '/web/sesion', headers: { origin: ORIGEN_TIENDA } });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe(ORIGEN_TIENDA);
  });

  it('un visitante abre sesion, escribe, el asistente le contesta por el flujo web (no por WhatsApp) y el equipo lo ve en Chats', async () => {
    const sesion = await app.inject({ method: 'POST', url: '/web/sesion', headers: desde, payload: { nombre: 'Carla', pagina: `${ORIGEN_TIENDA}/relojes` } });
    expect(sesion.statusCode).toBe(200);
    expect(sesion.headers['access-control-allow-origin']).toBe(ORIGEN_TIENDA);
    const s = sesion.json() as { sesion: string; contactoId: string; nombre: string; negocio: string };
    expect(s.sesion.startsWith('wvs_')).toBe(true);
    expect(s).toMatchObject({ nombre: 'Carla', negocio: 'Elysian' });

    const contacto = await repos.contacts.getById(s.contactoId);
    expect(contacto).toMatchObject({ name: 'Carla', optInSource: `chat web en ${ORIGEN_TIENDA}/relojes` });
    expect(esContactoWeb(contacto!.phone)).toBe(true);

    // El flujo en vivo del visitante, abierto antes de escribir.
    const control = new AbortController();
    const res = await fetch(`${direccion}/web/eventos?sesion=${encodeURIComponent(s.sesion)}`, { headers: { origin: ORIGEN_TIENDA }, signal: control.signal });
    expect(res.status).toBe(200);
    const lector = res.body!.getReader();
    const decoder = new TextDecoder();
    let visto = '';
    const leerHasta = async (texto: string) => {
      for (let i = 0; i < 30 && !visto.includes(texto); i++) {
        const { value, done } = await lector.read();
        if (done) break;
        visto += decoder.decode(value);
      }
    };
    await leerHasta(': conectado');

    modelo.siguiente = 'Hola Carla, tenemos relojes desde S/ 300. ¿Buscas para hombre o mujer?';
    const msg = await app.inject({ method: 'POST', url: '/web/mensajes', headers: desde, payload: { sesion: s.sesion, texto: 'hola, tienen relojes de mujer?' } });
    expect(msg.statusCode).toBe(200);
    await leerHasta('relojes desde S/ 300');
    expect(visto).toContain('event: mensaje');
    expect(visto).toContain('"direccion":"negocio"');
    control.abort();

    // Nada salio por WhatsApp; todo esta en el hilo, y lo ve el equipo.
    expect(wa.sent.filter((x) => x.kind !== 'read')).toHaveLength(0);
    const hilo = await app.inject({ method: 'GET', url: `/admin/chat/${s.contactoId}`, headers: { authorization: `Bearer ${TODO}` } });
    const textos = (hilo.json().messages as Array<{ direction: string; body: string }>).map((m) => `${m.direction}:${m.body}`);
    expect(textos).toEqual(['in:hola, tienen relojes de mujer?', 'out:Hola Carla, tenemos relojes desde S/ 300. ¿Buscas para hombre o mujer?']);
    expect(modelo.recibido.at(-1)![0]!.content).toContain('Vendemos relojes originales');

    // El historial para cuando vuelva, y la misma sesion reabre la misma conversacion.
    const hist = await app.inject({ method: 'GET', url: `/web/historial?sesion=${encodeURIComponent(s.sesion)}`, headers: { origin: ORIGEN_TIENDA } });
    expect((hist.json().mensajes as Array<{ direccion: string }>).map((m) => m.direccion)).toEqual(['yo', 'negocio']);
    const otra = await app.inject({ method: 'POST', url: '/web/sesion', headers: desde, payload: { sesion: s.sesion } });
    expect(otra.json().contactoId).toBe(s.contactoId);
  });

  it('el operador contesta desde Chats y le llega al visitante por el mismo canal', async () => {
    const sesion = (await app.inject({ method: 'POST', url: '/web/sesion', headers: desde, payload: { nombre: 'Luis' } })).json() as { sesion: string; contactoId: string };
    const r = await app.inject({ method: 'POST', url: '/admin/chat/send', headers: { authorization: `Bearer ${TODO}` }, payload: { contactId: sesion.contactoId, text: 'Hola Luis, ¿en qué te ayudo?' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true });
    expect(String(r.json().wamid)).toMatch(/^web\.out\./);
    expect(wa.sent.filter((x) => x.kind !== 'read')).toHaveLength(0);
    const hist = await app.inject({ method: 'GET', url: `/web/historial?sesion=${encodeURIComponent(sesion.sesion)}`, headers: { origin: ORIGEN_TIENDA } });
    expect(hist.json().mensajes[0]).toMatchObject({ direccion: 'negocio', texto: 'Hola Luis, ¿en qué te ayudo?' });
  });

  it('una sesion falsa o caducada no abre nada', async () => {
    expect((await app.inject({ method: 'POST', url: '/web/mensajes', headers: desde, payload: { sesion: 'wvs_falsa.firma', texto: 'x' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/web/historial?sesion=nada', headers: { origin: ORIGEN_TIENDA } })).statusCode).toBe(401);
    const vieja = firmarSesionWeb(secretoDeCanalWeb(config), nuevoIdVisitante(), Date.now() - 40 * 24 * 3600_000);
    expect((await app.inject({ method: 'POST', url: '/web/mensajes', headers: desde, payload: { sesion: vieja, texto: 'x' } })).statusCode).toBe(401);
  });

  it('el widget y la demo se sirven a cualquiera (son publicos), apuntando a este servidor', async () => {
    const w = await app.inject({ method: 'GET', url: '/web/widget.js' });
    expect(w.statusCode).toBe(200);
    expect(w.body).toContain('var ORIGEN = "http://localhost:3000"');
    expect(w.body).toContain('window.WAChat.montar = montar');
    const d = await app.inject({ method: 'GET', url: '/web/demo', headers: { origin: 'https://otra.com' } });
    expect(d.statusCode).toBe(200);
    expect(d.body).toContain('/web/widget.js');
    expect(d.body).toContain('Elysian');
  });
});
