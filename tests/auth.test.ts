/**
 * Entrar al sistema: la primera cuenta, el login con cookie firmada, el
 * token de API para integraciones, los roles y el cierre de sesion.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { COOKIE_SESION, firmarSesion, leerCookies, leerSesion } from '../src/auth/sesion.js';
import { claveAceptable, hashClave, usuarioAceptable, verificarClave } from '../src/auth/usuarios.js';
import { generarClaveApi, hashClaveApi, pareceClaveApi, prefijoDeClave } from '../src/auth/claves-api.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp, type FakeRepos, CLAVE_API_PRUEBA as ADMIN } from './fakes.js';

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

let app: FastifyInstance;
let repos: FakeRepos;

/** La cookie de sesion que devuelve una respuesta, lista para reenviar. */
function cookieDe(res: { headers: Record<string, unknown> }): string {
  const set = res.headers['set-cookie'];
  const linea = Array.isArray(set) ? set[0] : (set as string | undefined);
  expect(linea, 'la respuesta trae Set-Cookie').toBeTruthy();
  return (linea as string).split(';')[0]!;
}

beforeAll(async () => {
  const config = loadConfig(ENV);
  repos = createFakeRepos();
  const wa = createFakeWhatsApp();
  const settings = await createFakeSettings(config);
  const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
  app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('contrasenas y cookies', () => {
  it('el hash no guarda la contrasena y se verifica en tiempo constante', () => {
    const h = hashClave('mi-clave-larga');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(h).not.toContain('mi-clave-larga');
    expect(verificarClave('mi-clave-larga', h)).toBe(true);
    expect(verificarClave('otra', h)).toBe(false);
    expect(verificarClave('x', 'basura')).toBe(false);
    expect(hashClave('a'.repeat(8))).not.toBe(hashClave('a'.repeat(8)));
  });

  it('reglas de usuario y contrasena', () => {
    expect(claveAceptable('1234')).toMatch(/8/);
    expect(claveAceptable('12345678')).toBeNull();
    expect(usuarioAceptable('Ali')).toMatch(/minúsculas/);
    expect(usuarioAceptable('ali.reparto')).toBeNull();
  });

  it('las claves de API nacen distintas, se reconocen por el prefijo y se guardan por hash', () => {
    const a = generarClaveApi();
    const b = generarClaveApi();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^wak_[A-Za-z0-9]{40}$/);
    expect(pareceClaveApi(a)).toBe(true);
    expect(pareceClaveApi('admin-token-de-antes')).toBe(false);
    expect(hashClaveApi(a)).toHaveLength(64);
    expect(hashClaveApi(a)).not.toContain(a.slice(4, 20));
    expect(prefijoDeClave(a)).toBe(a.slice(0, 12) + '…');
  });

  it('la cookie firmada se lee, y una alterada o caducada no', () => {
    const ahora = Date.now();
    const token = firmarSesion('secreto', { u: 'u1', v: 1 }, ahora);
    expect(leerSesion('secreto', token, ahora)).toMatchObject({ u: 'u1', v: 1 });
    expect(leerSesion('otro', token, ahora)).toBeNull();
    expect(leerSesion('secreto', token.slice(0, -2) + 'zz', ahora)).toBeNull();
    expect(leerSesion('secreto', token, ahora + 8 * 24 * 60 * 60 * 1000)).toBeNull();
    expect(leerSesion('secreto', undefined, ahora)).toBeNull();
    expect(leerCookies('a=1; wa_sesion=abc%2Ed; b=x=y')).toEqual({ a: '1', wa_sesion: 'abc.d', b: 'x=y' });
  });
});

describe('entrar al sistema', () => {
  let cookie = '';

  it('la portada es publica y lleva a /login; sin usuarios, /login ofrece registrarse', async () => {
    const portada = await app.inject({ method: 'GET', url: '/' });
    expect(portada.statusCode).toBe(200);
    expect(portada.body).toContain('href="/login"');
    expect(portada.body).toContain('La Tienda');
    const login = await app.inject({ method: 'GET', url: '/login' });
    expect(login.statusCode).toBe(200);
    // Las dos pestañas se ofrecen siempre; lo que cambia es si el registro
    // trae formulario. Se comprueba el formulario y no el texto: el rotulo
    // se reescribe cada dos por tres y la prueba no puede caerse por eso.
    expect(login.body).toContain('id="f-registro"');
    expect(login.body).toContain('Inicio de sesión');
  });

  it('sin sesion, las pantallas redirigen a /login y /admin responde 401', async () => {
    const panel = await app.inject({ method: 'GET', url: '/panel' });
    expect(panel.statusCode).toBe(302);
    expect(panel.headers.location).toBe('/login?next=%2Fpanel');
    const chat = await app.inject({ method: 'GET', url: '/chat' });
    expect(chat.statusCode).toBe(302);
    const admin = await app.inject({ method: 'GET', url: '/admin/health' });
    expect(admin.statusCode).toBe(401);
  });

  it('una clave de API entra como programa; una desconocida no; y no gestiona cuentas ni claves', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/health', headers: { authorization: `Bearer ${ADMIN}` } });
    expect(res.statusCode).toBe(200);
    const yo = await app.inject({ method: 'GET', url: '/admin/yo', headers: { authorization: `Bearer ${ADMIN}` } });
    expect(yo.json()).toMatchObject({ porToken: true, rol: 'admin', nombre: 'Pruebas' });
    expect(repos._claves[0]?.ultimoUsoAt).toBeInstanceOf(Date);
    const mal = await app.inject({ method: 'GET', url: '/admin/health', headers: { authorization: 'Bearer wak_nope' } });
    expect(mal.statusCode).toBe(401);
    const viejo = await app.inject({ method: 'GET', url: '/admin/health', headers: { authorization: 'Bearer admin-token-de-antes-1234' } });
    expect(viejo.statusCode).toBe(401);
    const cuentas = await app.inject({ method: 'GET', url: '/admin/usuarios', headers: { authorization: `Bearer ${ADMIN}` } });
    expect(cuentas.statusCode).toBe(403);
    const claves = await app.inject({ method: 'GET', url: '/admin/claves-api', headers: { authorization: `Bearer ${ADMIN}` } });
    expect(claves.statusCode).toBe(403);
  });

  it('la primera cuenta se crea una sola vez, es superadministrador (entra como admin) y deja la sesion abierta', async () => {
    const corta = await app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { nombre: 'Ali', usuario: 'ali', clave: '123' } });
    expect(corta.statusCode).toBe(400);
    const res = await app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { nombre: 'Ali', usuario: 'Ali', clave: 'clave-segura-1' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().usuario).toMatchObject({ usuario: 'ali', rol: 'superadmin' });
    cookie = cookieDe(res);
    expect(cookie.startsWith(`${COOKIE_SESION}=`)).toBe(true);

    const otra = await app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { nombre: 'X', usuario: 'x', clave: 'clave-segura-2' } });
    expect(otra.statusCode).toBe(409);

    // Con la cookie, el panel y /admin abren.
    const panel = await app.inject({ method: 'GET', url: '/panel', headers: { cookie } });
    expect(panel.statusCode).toBe(200);
    const yo = await app.inject({ method: 'GET', url: '/admin/yo', headers: { cookie } });
    expect(yo.json()).toMatchObject({ usuario: 'ali', nombre: 'Ali', rol: 'admin', porToken: false });
    // Y /login ya no ofrece registrarse: la pestaña sigue ahi, pero sin
    // formulario, porque el servidor ya solo devuelve 409.
    const login = await app.inject({ method: 'GET', url: '/login' });
    expect(login.body).not.toContain('id="f-registro"');
    expect(login.body).toContain('id="f-entrar"');
  });

  it('login con contrasena mala falla; cinco fallos seguidos bloquean unos minutos', async () => {
    for (let i = 0; i < 5; i++) {
      const mal = await app.inject({ method: 'POST', url: '/login', payload: { usuario: 'ali', clave: 'mala' } });
      expect(mal.statusCode).toBe(401);
    }
    const bloqueado = await app.inject({ method: 'POST', url: '/login', payload: { usuario: 'ali', clave: 'clave-segura-1' } });
    expect(bloqueado.statusCode).toBe(429);
  });

  it('un admin crea usuarios; un operador no puede, pero entra y cambia su contrasena', async () => {
    const creado = await app.inject({ method: 'POST', url: '/admin/usuarios', headers: { cookie }, payload: { nombre: 'Rosa', usuario: 'rosa', clave: 'rosa-clave-1', rol: 'operador' } });
    expect(creado.statusCode).toBe(200);
    const repetido = await app.inject({ method: 'POST', url: '/admin/usuarios', headers: { cookie }, payload: { nombre: 'Rosa', usuario: 'rosa', clave: 'rosa-clave-1' } });
    expect(repetido.statusCode).toBe(400);

    // Rosa entra desde otra IP (el bloqueo de arriba era por IP).
    const login = await app.inject({ method: 'POST', url: '/login', payload: { usuario: 'rosa', clave: 'rosa-clave-1', next: '/rutas' }, remoteAddress: '10.0.0.2' });
    expect(login.statusCode).toBe(200);
    expect(login.json().next).toBe('/rutas');
    const cookieRosa = cookieDe(login);

    const usuarios = await app.inject({ method: 'GET', url: '/admin/usuarios', headers: { cookie: cookieRosa } });
    expect(usuarios.statusCode).toBe(403);
    const salud = await app.inject({ method: 'GET', url: '/admin/health', headers: { cookie: cookieRosa } });
    expect(salud.statusCode).toBe(200);

    const cambio = await app.inject({ method: 'POST', url: '/admin/mi-clave', headers: { cookie: cookieRosa }, payload: { actual: 'rosa-clave-1', nueva: 'rosa-clave-2' } });
    expect(cambio.statusCode).toBe(200);
    // La cookie vieja ya no vale (subio la version); la nueva que devolvio, si.
    const vieja = await app.inject({ method: 'GET', url: '/admin/health', headers: { cookie: cookieRosa } });
    expect(vieja.statusCode).toBe(401);
    const nueva = await app.inject({ method: 'GET', url: '/admin/health', headers: { cookie: cookieDe(cambio) } });
    expect(nueva.statusCode).toBe(200);
  });

  it('un admin crea una clave de API, se ve entera una sola vez, sirve, y revocada deja de servir', async () => {
    const sinNombre = await app.inject({ method: 'POST', url: '/admin/claves-api', headers: { cookie }, payload: { nombre: ' ' } });
    expect(sinNombre.statusCode).toBe(400);
    const creada = await app.inject({ method: 'POST', url: '/admin/claves-api', headers: { cookie }, payload: { nombre: 'Sistema GSG' } });
    expect(creada.statusCode).toBe(200);
    const { clave, registro } = creada.json() as { clave: string; registro: { id: string; prefijo: string; nombre: string } };
    expect(clave.startsWith('wak_')).toBe(true);
    expect(clave.length).toBeGreaterThan(30);
    expect(registro.prefijo.startsWith('wak_')).toBe(true);
    expect(clave.startsWith(registro.prefijo.replace('…', ''))).toBe(true);

    const lista = await app.inject({ method: 'GET', url: '/admin/claves-api', headers: { cookie } });
    const filas = lista.json() as Array<Record<string, unknown>>;
    expect(filas.find((f) => f.id === registro.id)).toMatchObject({ nombre: 'Sistema GSG' });
    expect(JSON.stringify(filas)).not.toContain(clave);

    const usa = await app.inject({ method: 'GET', url: '/admin/yo', headers: { authorization: `Bearer ${clave}` } });
    expect(usa.json()).toMatchObject({ porToken: true, nombre: 'Sistema GSG' });

    const rosa = repos._usuarios.find((u) => u.usuario === 'rosa')!;
    const loginRosa = await app.inject({ method: 'POST', url: '/login', payload: { usuario: 'rosa', clave: 'rosa-clave-2' }, remoteAddress: '10.0.0.9' });
    const cookieRosa = cookieDe(loginRosa);
    const operadorNo = await app.inject({ method: 'DELETE', url: `/admin/claves-api/${registro.id}`, headers: { cookie: cookieRosa } });
    expect(operadorNo.statusCode).toBe(403);
    void rosa;

    const revocada = await app.inject({ method: 'DELETE', url: `/admin/claves-api/${registro.id}`, headers: { cookie } });
    expect(revocada.statusCode).toBe(200);
    const yaNo = await app.inject({ method: 'GET', url: '/admin/yo', headers: { authorization: `Bearer ${clave}` } });
    expect(yaNo.statusCode).toBe(401);
    const otraVez = await app.inject({ method: 'DELETE', url: `/admin/claves-api/${registro.id}`, headers: { cookie } });
    expect(otraVez.statusCode).toBe(404);
  });

  it('desactivar cierra la sesion; un admin no puede desactivarse a si mismo; el next no sale del sitio', async () => {
    const rosa = repos._usuarios.find((u) => u.usuario === 'rosa')!;
    const login = await app.inject({ method: 'POST', url: '/login', payload: { usuario: 'rosa', clave: 'rosa-clave-2' }, remoteAddress: '10.0.0.3' });
    const cookieRosa = cookieDe(login);
    await app.inject({ method: 'POST', url: `/admin/usuarios/${rosa.id}`, headers: { cookie }, payload: { activo: false } });
    expect((await app.inject({ method: 'GET', url: '/admin/health', headers: { cookie: cookieRosa } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/login', payload: { usuario: 'rosa', clave: 'rosa-clave-2' }, remoteAddress: '10.0.0.4' })).statusCode).toBe(401);

    const ali = repos._usuarios.find((u) => u.usuario === 'ali')!;
    const yoNo = await app.inject({ method: 'POST', url: `/admin/usuarios/${ali.id}`, headers: { cookie }, payload: { activo: false } });
    expect(yoNo.statusCode).toBe(400);

    const fuera = await app.inject({ method: 'GET', url: '/login?next=https://malo.example', headers: { cookie } });
    expect(fuera.statusCode).toBe(302);
    expect(fuera.headers.location).toBe('/panel');
  });

  it('el inicio del panel, el manual y soporte responden con sesion; el resumen trae lo que pinta la pantalla', async () => {
    for (const url of ['/panel', '/manual', '/soporte', '/chat', '/rutas', '/setup']) {
      const res = await app.inject({ method: 'GET', url, headers: { cookie } });
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).toContain('id="s-app"');
      expect(res.body, url).toContain('Buscar módulo');
    }
    expect((await app.inject({ method: 'GET', url: '/manual' })).statusCode).toBe(302);
    const resumen = await app.inject({ method: 'GET', url: '/admin/resumen', headers: { cookie } });
    expect(resumen.statusCode).toBe(200);
    const r = resumen.json();
    expect(r.hoy).toMatchObject({ enviados: expect.any(Number), entrantes: expect.any(Number), cupo: expect.any(Number) });
    expect(r.semana).toHaveLength(7);
    expect(r.numero).toMatchObject({ nivel: expect.any(String) });
    expect(r.chats).toMatchObject({ sinLeer: expect.any(Number), esperandoRespuesta: expect.any(Number) });
    expect(r.reparto).toMatchObject({ requierenPersona: expect.any(Number) });
    expect(r.primerosPasos).toMatchObject({ usuarios: 2, proveedor: 'cloud' });
  });

  it('salir borra la cookie', async () => {
    const res = await app.inject({ method: 'POST', url: '/logout', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const set = String(res.headers['set-cookie']);
    expect(set).toContain('Max-Age=0');
    // La portada con sesion ofrece ir al panel.
    const portada = await app.inject({ method: 'GET', url: '/', headers: { cookie } });
    expect(portada.body).toContain('Ir al panel');
  });
});
