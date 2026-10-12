/**
 * Los tres modulos, cada uno con lo suyo (pedido del dueño, 12/10):
 *  - Conexión WhatsApp (/setup): solo WhatsApp.
 *  - Conexión con GSG (/conexion-gsg): lo que GSGchat le manda y le pregunta a GSG.
 *  - Nuestra API (/api-gsgchat): nuestro endpoint, claves, validar, recepciones, campos y respuestas.
 *
 * Cada pantalla se carga con un DOM de mentira en el que solo existen los ids
 * de SU html: si su script toca un elemento de otra pantalla, la prueba falla.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createContext, Script } from 'node:vm';
import { crearEscenarioEntregas, type EscenarioEntregas } from './escenario-entregas.js';
import { hashClave } from '../src/auth/usuarios.js';
import { MENU_GSG } from '../src/web/shell.js';

let esc: EscenarioEntregas;
let cookie: string;

beforeAll(async () => {
  esc = await crearEscenarioEntregas();
  await esc.repos.usuarios.crear({ usuario: 'modulosadmin', nombre: 'Admin', rol: 'admin', clave: hashClave('prueba-modulos-123') });
  const r = await esc.app.inject({ method: 'POST', url: '/login', payload: { usuario: 'modulosadmin', clave: 'prueba-modulos-123' } });
  cookie = String(r.headers['set-cookie']).split(';')[0]!;
});
afterAll(async () => { await esc.cerrar(); });

const pagina = async (url: string) => {
  const r = await esc.app.inject({ url, headers: { cookie } });
  expect(r.statusCode, url).toBe(200);
  return r.body;
};
const ids = (html: string) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!));

/** Un elemento de mentira: acepta lo que el script le haga. */
function elemento(): Record<string, unknown> {
  const clases = new Set<string>();
  const base: Record<string, unknown> = {
    value: '', textContent: '', innerHTML: '', checked: true, disabled: false, hidden: false, open: false, dataset: {}, style: {},
    classList: { add: (c: string) => clases.add(c), remove: (c: string) => clases.delete(c), toggle: (c: string) => clases.has(c) ? clases.delete(c) : clases.add(c), contains: (c: string) => clases.has(c) },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null, addEventListener() {}, appendChild() {}, focus() {}, querySelectorAll: () => [], querySelector: () => null, closest: () => null,
  };
  return new Proxy(base, { get: (o, k) => (k in o ? o[k as string] : undefined), set: (o, k, v) => { o[k as string] = v; return true; } });
}

/** Corre los scripts de la pagina; devuelve los errores (sincronos y de promesas). */
async function correr(html: string): Promise<string[]> {
  const existentes = ids(html);
  const cache = new Map<string, unknown>();
  const errores: string[] = [];
  const document = {
    getElementById: (id: string) => (existentes.has(id) ? (cache.get(id) ?? (cache.set(id, elemento()), cache.get(id))) : null),
    querySelectorAll: () => [],
    // Una clase o un id que esten en el html; lo demas no existe.
    querySelector: (sel: string) => {
      const m = /^([.#])([\w-]+)/.exec(sel.trim());
      if (!m) return null;
      if (m[1] === '#') return existentes.has(m[2]!) ? elemento() : null;
      return html.includes(m[2]!) && new RegExp('class="[^"]*\\b' + m[2] + '\\b').test(html) ? elemento() : null;
    },
    addEventListener() {}, createElement: () => elemento(),
    documentElement: elemento(), body: elemento(), hidden: false, cookie: '',
  };
  const respuesta = { ok: true, status: 200, json: async () => ({}), text: async () => '' };
  const ctx = createContext({
    document, window: { addEventListener() {}, location: { origin: 'http://x', pathname: '/', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }) },
    location: { origin: 'http://x', pathname: '/', hash: '', href: '' }, navigator: { clipboard: { writeText: async () => undefined } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {} },
    fetch: async () => respuesta, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    console: { log() {}, error() {}, warn() {} }, URL, Blob: class {}, Promise, JSON, Math, Date, Object, Array, String, Number, Boolean, Error, encodeURIComponent, decodeURIComponent, isNaN, parseInt, parseFloat,
    confirmarDialogo: async () => false, history: { replaceState() {} }, requestAnimationFrame: () => 0, matchMedia: () => ({ matches: false, addEventListener() {} }),
  });
  (ctx as Record<string, unknown>).window = Object.assign((ctx as Record<string, unknown>).window as object, ctx);
  const alRechazo = (e: unknown) => errores.push(`promesa: ${String((e as Error)?.stack ?? e).split('\n')[0]}`);
  process.on('unhandledRejection', alRechazo);
  try {
    for (const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
      if (!m[1]!.trim()) continue;
      try { new Script(m[1]!).runInContext(ctx); } catch (e) { errores.push(`script: ${String((e as Error).message)}`); }
    }
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    process.off('unhandledRejection', alRechazo);
  }
  return errores;
}

describe('cada módulo con lo suyo', () => {
  it('Conexión WhatsApp: solo WhatsApp, nada de GSG ni de nuestra API', async () => {
    const html = await pagina('/setup');
    const hay = ids(html);
    for (const id of ['card-wa', 'paso1', 'qr-connect']) expect(hay.has(id), id).toBe(true);
    for (const id of ['gsg', 'gsg-form', 'gsg-consulta', 'gsg-avanzado', 'gsg-endpoints', 'courier-claves']) expect(hay.has(id), id).toBe(false);
    expect(html).toContain('Conexión WhatsApp');
    expect(await correr(html)).toEqual([]);
  });

  it('Conexión con GSG: URL, API Key, ubicación, consulta de estado y lo enviado; sin WhatsApp ni nuestra API', async () => {
    const html = await pagina('/conexion-gsg');
    const hay = ids(html);
    for (const id of ['gsg', 'gsg-form', 'gsg-url', 'gsg-ruta', 'gsg-token', 'gsg-ruta-estado', 'gsg-consulta-form', 'gsg-envios', 'seguimiento-refrescar']) expect(hay.has(id), id).toBe(true);
    for (const id of ['card-wa', 'paso1', 'gsg-avanzado', 'gsg-endpoints', 'courier-claves', 'courier-validar']) expect(hay.has(id), id).toBe(false);
    expect(await correr(html)).toEqual([]);
  });

  it('Nuestra API: dirección, claves, validar, últimas recepciones, campos, respuestas y probar cancelar/reintentar', async () => {
    const html = await pagina('/api-gsgchat');
    const hay = ids(html);
    for (const id of ['api-1', 'api-2', 'courier-url', 'courier-url-2', 'courier-form', 'courier-claves', 'courier-json', 'courier-validar', 'courier-bitacora', 'courier-campos', 'courier-respuestas', 'np-flujo-form']) expect(hay.has(id), id).toBe(true);
    // Las dos APIs, cada una con su tarjeta.
    expect(html).toContain('API 1</span> Recibir pedidos');
    expect(html).toContain('API 2</span> Cancelar o reintentar un pedido');
    // Cómo probar cada una en Postman, y el validador de la API 2.
    for (const id of ['postman-1', 'postman-2', 'validar-2', 'courier-json-2', 'courier-validar-2', 'courier-descargar-2']) expect(hay.has(id), id).toBe(true);
    expect(html).toContain('data-url="/api/v1/flujo"');
    // Cada API dice como sacar TODAS sus respuestas, no solo el 405.
    for (const codigo of ['201', '400', '401', '403', '404', '405', '413', '415', '429']) expect(html).toContain(`<tr><td><b>${codigo}</b></td>`);
    expect((html.match(/Cómo sacar <b>cada<\/b> respuesta/g) ?? []).length).toBe(2);
    expect(html).not.toContain('(con GET responde 405)');
    // Cada API con su dirección.
    expect(html).toContain("location.origin + '/api/v1/entregas'");
    expect(html).toContain("location.origin + '/api/v1/flujo'");
    for (const id of ['card-wa', 'gsg-form', 'gsg-ruta-estado', 'courier-envios']) expect(hay.has(id), id).toBe(false);
    expect(html).toContain('Campos que envía Courier');
    expect(await correr(html)).toEqual([]);
  });

  it('el menú: tres entradas, cada una a su pantalla', () => {
    const porId = Object.fromEntries(MENU_GSG.map((i) => [i.id, i]));
    expect(porId.conexion).toMatchObject({ href: '/setup', etiqueta: 'Conexión WhatsApp' });
    expect(porId['gsg-courier']).toMatchObject({ href: '/conexion-gsg', etiqueta: 'Conexión con GSG' });
    expect(porId['api-gsgchat']).toMatchObject({ href: '/api-gsgchat', etiqueta: 'Nuestra API' });
  });

  it('Nuestra API y Conexión con GSG son solo de administradores', async () => {
    for (const url of ['/api-gsgchat', '/conexion-gsg']) {
      expect((await esc.app.inject({ url })).statusCode, url).toBe(302);
    }
  });
});
