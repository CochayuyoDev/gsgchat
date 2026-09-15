/**
 * El chat embebido: el token, su alcance, la pagina y el flujo en vivo.
 *
 * Lo que importa es que una web ajena pueda mostrar el chat sin ver mas de
 * lo que el token dice: un token para un telefono no abre otro, uno
 * caducado no abre nada, y sin dominios configurados nadie puede enmarcar
 * la pagina.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { crearBus } from '../src/eventos/bus.js';
import { observarRepos } from '../src/eventos/observar.js';
import { crearServicioAjustes } from '../src/ajustes/generales.js';
import { firmarTokenEmbebido, leerTokenEmbebido, pareceTokenEmbebido, secretoDeEmbebido } from '../src/embed/token.js';
import { frameAncestors } from '../src/embed/routes.js';
import { hashClaveApi, prefijoDeClave } from '../src/auth/claves-api.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp, type FakeRepos, CLAVE_API_PRUEBA as TODO } from './fakes.js';

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
  BUSINESS_NAME: 'La Tienda',
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

/** La clave del servidor de Stoky: emite tokens y nada mas. */
const EMISORA = 'wak_claveQueEmiteTokens0123456789abcdefXYZ0';

const config = loadConfig(ENV);
const con = (clave: string) => ({ authorization: `Bearer ${clave}`, 'content-type': 'application/json' });

let app: FastifyInstance;
let repos: FakeRepos;
let bus: ReturnType<typeof crearBus>;
let ajustes: Awaited<ReturnType<typeof crearServicioAjustes>>;

beforeAll(async () => {
  bus = crearBus();
  repos = observarRepos(createFakeRepos(), bus) as FakeRepos;
  repos._claves.push({ id: 'clave-emisora', nombre: 'Stoky servidor', prefijo: prefijoDeClave(EMISORA), hash: hashClaveApi(EMISORA), creadaPor: null, createdAt: new Date(), ultimoUsoAt: null, revocadaAt: null, permisos: ['embed:emitir', 'mensajes:enviar', 'conversaciones:leer'] });
  const wa = createFakeWhatsApp();
  const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
  const settings = await createFakeSettings(config);
  ajustes = await crearServicioAjustes({ repo: repos.ajustesGenerales, config });
  app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false, bus, ajustes });
  await app.ready();

  for (const [phone, name] of [['51987654321', 'Maria'], ['51911111111', 'Luis']] as const) {
    const c = await repos.contacts.upsertFromInbound(phone, name);
    await repos.contacts.setOptIn(phone, 'prueba');
    await repos.contacts.touchInbound(phone, new Date());
    await repos.messages.add({ contactId: c.id, direction: 'in', wamid: `w-${phone}`, kind: 'text', body: `hola soy ${name}` });
  }
});

afterAll(async () => {
  await app.close();
});

describe('el token', () => {
  const secreto = secretoDeEmbebido(config);

  it('se firma, se lee, caduca y no se puede fabricar', () => {
    const t = firmarTokenEmbebido(secreto, { operador: 'ana', telefono: '51987654321', permisos: ['conversaciones:leer'] }, 30, 1_000_000);
    expect(pareceTokenEmbebido(t)).toBe(true);
    expect(leerTokenEmbebido(secreto, t, 1_000_000 + 29 * 60_000)).toMatchObject({ operador: 'ana', telefono: '51987654321', permisos: ['conversaciones:leer'] });
    expect(leerTokenEmbebido(secreto, t, 1_000_000 + 31 * 60_000)).toBeNull();
    expect(leerTokenEmbebido('otro-secreto', t, 1_000_000)).toBeNull();
    expect(leerTokenEmbebido(secreto, t.slice(0, -2) + 'zz', 1_000_000)).toBeNull();
    expect(leerTokenEmbebido(secreto, 'emb_basura', 1_000_000)).toBeNull();
    expect(leerTokenEmbebido(secreto, undefined)).toBeNull();
  });

  it('la duracion se acota a 12 h', () => {
    const t = firmarTokenEmbebido(secreto, { operador: 'ana', telefono: null, permisos: ['*'] }, 99_999, 0);
    expect(leerTokenEmbebido(secreto, t, 12 * 3600_000 - 1)).toBeTruthy();
    expect(leerTokenEmbebido(secreto, t, 12 * 3600_000 + 1)).toBeNull();
  });
});

describe('POST /api/v1/embed/token', () => {
  it('exige el permiso embed:emitir', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/embed/token', headers: con(TODO), payload: { operador: 'ana' } });
    expect(r.statusCode).toBe(200);
    const sin = await app.inject({ method: 'POST', url: '/api/v1/embed/token', headers: { authorization: 'Bearer wak_noExiste00000000000000000000000000' }, payload: { operador: 'ana' } });
    expect(sin.statusCode).toBe(401);
  });

  it('emite lo justo: permisos del chat, acotados a los de la clave', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/embed/token', headers: con(EMISORA), payload: { operador: 'ana', telefono: '+51 987 654 321' } });
    expect(r.statusCode).toBe(200);
    const cuerpo = r.json() as { token: string; permisos: string[]; telefono: string; url: string; caduca: string };
    expect(cuerpo.token.startsWith('emb_')).toBe(true);
    // La clave emisora no tiene contactos:leer ni plantillas:leer: el token tampoco.
    expect(cuerpo.permisos.sort()).toEqual(['conversaciones:leer', 'mensajes:enviar']);
    expect(cuerpo.telefono).toBe('51987654321');
    expect(cuerpo.url).toBe('http://localhost:3000/embed/chat');
    expect(new Date(cuerpo.caduca).getTime() - Date.now()).toBeGreaterThan(50 * 60_000);

    // Pedir webhooks:gestionar en un token no da nada: no es cosa del chat.
    const nada = await app.inject({ method: 'POST', url: '/api/v1/embed/token', headers: con(EMISORA), payload: { operador: 'ana', permisos: ['webhooks:gestionar'] } });
    expect(nada.statusCode).toBe(400);
  });
});

describe('con un token embebido', () => {
  async function token(telefono?: string) {
    const r = await app.inject({ method: 'POST', url: '/api/v1/embed/token', headers: con(EMISORA), payload: { operador: 'ana', telefono } });
    return (r.json() as { token: string }).token;
  }

  it('limitado a un telefono: ve y escribe solo ese hilo', async () => {
    const t = await token('51987654321');
    const lista = await app.inject({ method: 'GET', url: '/api/v1/conversaciones', headers: con(t) });
    expect(lista.statusCode).toBe(200);
    expect(lista.json().conversaciones.map((c: { telefono: string }) => c.telefono)).toEqual(['51987654321']);

    expect((await app.inject({ method: 'GET', url: '/api/v1/conversaciones/51987654321', headers: con(t) })).statusCode).toBe(200);
    const otro = await app.inject({ method: 'GET', url: '/api/v1/conversaciones/51911111111', headers: con(t) });
    expect(otro.statusCode).toBe(403);
    expect(otro.json().error).toContain('se emitio');

    const envioOtro = await app.inject({ method: 'POST', url: '/api/v1/mensajes', headers: con(t), payload: { telefono: '51911111111', texto: 'hola' } });
    expect(envioOtro.statusCode).toBe(403);
    const envio = await app.inject({ method: 'POST', url: '/api/v1/mensajes', headers: con(t), payload: { telefono: '51987654321', texto: 'hola Maria' } });
    expect(envio.statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/v1/conversaciones/51911111111/leido', headers: con(t) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/v1/conversaciones/51987654321/leido', headers: con(t) })).statusCode).toBe(200);
  });

  it('sin telefono: la bandeja entera, pero nada fuera del chat', async () => {
    const t = await token();
    const lista = await app.inject({ method: 'GET', url: '/api/v1/conversaciones', headers: con(t) });
    expect(lista.json().conversaciones.length).toBe(2);
    // Ni /admin ni webhooks ni contactos (la clave emisora no los tenia).
    expect((await app.inject({ method: 'GET', url: '/admin/health', headers: con(t) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/webhooks', headers: con(t) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/contactos', headers: con(t) })).statusCode).toBe(403);
  });

  it('caducado o manipulado: 401', async () => {
    const viejo = firmarTokenEmbebido(secretoDeEmbebido(config), { operador: 'ana', telefono: null, permisos: ['conversaciones:leer'] }, 1, Date.now() - 10 * 60_000);
    expect((await app.inject({ method: 'GET', url: '/api/v1/conversaciones', headers: con(viejo) })).statusCode).toBe(401);
    const t = await token();
    expect((await app.inject({ method: 'GET', url: '/api/v1/conversaciones', headers: con(t.slice(0, -3) + 'abc') })).statusCode).toBe(401);
  });

  it('el flujo en vivo entrega solo lo del telefono del token, y acepta el token en la query', async () => {
    const t = await token('51987654321');
    const direccion = await app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const control = new AbortController();
      const res = await fetch(`${direccion}/api/v1/eventos/stream?token=${encodeURIComponent(t)}`, { signal: control.signal });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const lector = res.body!.getReader();
      const decoder = new TextDecoder();
      let visto = '';
      const leerHasta = async (texto: string) => {
        for (let i = 0; i < 20 && !visto.includes(texto); i++) {
          const { value, done } = await lector.read();
          if (done) break;
          visto += decoder.decode(value);
        }
      };
      await leerHasta(': conectado');

      // Uno de otro telefono no llega; el del token si.
      bus.emitir('contacto.baja', { contacto: { telefono: '51911111111' }, fecha: 'f' });
      bus.emitir('contacto.baja', { contacto: { telefono: '51987654321' }, fecha: 'f' });
      await leerHasta('51987654321');
      expect(visto).toContain('event: contacto.baja');
      expect(visto).toContain('"telefono":"51987654321"');
      expect(visto).not.toContain('51911111111');
      control.abort();
    } finally {
      // El servidor sigue vivo para el resto (inject no necesita el puerto).
    }
  });

  it('un token en la query solo vale para el flujo, no para el resto', async () => {
    const t = await token();
    const r = await app.inject({ method: 'GET', url: `/api/v1/conversaciones?token=${encodeURIComponent(t)}` });
    expect(r.statusCode).toBe(401);
  });
});

describe('la pagina y el script', () => {
  it('frame-ancestors: solo este sitio y los dominios del ajuste', async () => {
    expect(frameAncestors([])).toBe("frame-ancestors 'self'");
    expect(frameAncestors(['https://stoky.app', 'basura', 'https://tienda.com/'])).toBe("frame-ancestors 'self' https://stoky.app https://tienda.com/");

    const sin = await app.inject({ method: 'GET', url: '/embed/chat' });
    expect(sin.statusCode).toBe(200);
    expect(sin.headers['content-security-policy']).toBe("frame-ancestors 'self'");
    expect(sin.body).toContain('La Tienda');
    expect(sin.body).toContain('var TELEFONO_FIJO = null;');

    await ajustes.guardar({ embebido: { dominios: ['https://stoky.app/', 'HTTPS://Tienda.com'] } });
    const con = await app.inject({ method: 'GET', url: '/embed/chat?telefono=%2B51%20987%20654%20321' });
    expect(con.headers['content-security-policy']).toBe("frame-ancestors 'self' https://stoky.app https://tienda.com");
    expect(con.body).toContain('var TELEFONO_FIJO = "51987654321";');
    expect(con.headers['cache-control']).toBe('no-store');
  });

  it('embed.js apunta a este servidor y expone WA.montar', async () => {
    const r = await app.inject({ method: 'GET', url: '/embed.js' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('javascript');
    expect(r.body).toContain('var ORIGEN = "http://localhost:3000"');
    expect(r.body).toContain('window.WA.montar = montar');
    expect(r.body).toContain('window.WA.flotante = flotante');
    expect(r.body).toContain("'/embed/chat'");
  });

  it('la pagina no necesita sesion ni redirige al login', async () => {
    const r = await app.inject({ method: 'GET', url: '/embed/chat' });
    expect(r.statusCode).toBe(200);
    expect(r.headers.location).toBeUndefined();
  });
});
