/**
 * La conexion SALIENTE con GSG (GSGchat -> GSG): URL base + ruta, la API Key
 * solo en X-API-Key, la prueba de conexion de solo lectura, la compatibilidad
 * con lo guardado antes y la cola ante cada codigo de GSG.
 */

import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import {
  crearPuertoHttp,
  despacharReportes,
  migrarUbicacionAntigua,
  normalizarBaseGsg,
  paradaPorClave,
  unirUrlGsg,
  type ResultadoUrlGsg,
} from '../src/rutas/gsg.js';
import { crearConexionGsg } from '../src/rutas/conexion-gsg.js';
import { crearGsgSimulado, registerGsgSimulado } from '../src/entregas/gsg-simulado.js';
import { UNIR_URL_GSG_JS } from '../src/web/connect-page.js';
import { encrypt, keyFromBase64 } from '../src/settings/crypto.js';
import { createFakeRepos, createMemorySettingsRepo, TEST_SETTINGS_KEY } from './fakes.js';

const CLAVE = 'gsg-clave-secreta-0123456789ABCD';
const BASE = 'https://backend.developer.gsgcorp.pe/api/';
const RUTA = 'v1/gsgchat/location';
const FINAL = 'https://backend.developer.gsgcorp.pe/api/v1/gsgchat/location';
const config = { GSG_URL: '', GSG_TOKEN: '', PUBLIC_BASE_URL: 'http://localhost:3000' };

interface Llamada {
  url: string;
  metodo: string;
  cabeceras: Headers;
  cuerpo: unknown;
}

/** Un fetch de mentira que apunta cada llamada y contesta lo que diga `responder`. */
function fetchFalso(responder: (l: Llamada) => Response | Promise<Response> = () => new Response('{}', { status: 201 })) {
  const llamadas: Llamada[] = [];
  const impl = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const l = { url, metodo: init?.method ?? 'GET', cabeceras: new Headers(init?.headers), cuerpo: init?.body ?? undefined };
    llamadas.push(l);
    return responder(l);
  }) as typeof fetch;
  return { impl, llamadas };
}

// --------------------------------------------------------- URL base + ruta

const VALIDOS: Array<[string, string, string]> = [
  [BASE, RUTA, FINAL],
  ['https://backend.developer.gsgcorp.pe/api', RUTA, FINAL],
  ['https://backend.developer.gsgcorp.pe/api/', `/${RUTA}`, FINAL],
  ['https://backend.developer.gsgcorp.pe/api//', `//${RUTA}`.slice(1), FINAL],
  ['https://backend.developer.gsgcorp.pe//api/', 'v1//gsgchat///location/', FINAL],
  ['  https://backend.developer.gsgcorp.pe/api/  ', `  ${RUTA}/  `, FINAL],
  ['https://gsg.pe', 'sendLocation', 'https://gsg.pe/sendLocation'],
  ['http://127.0.0.1:3500/', '/reparto/pendientes', 'http://127.0.0.1:3500/reparto/pendientes'],
  ['HTTPS://GSG.PE/Api/', 'V1/Loc', 'https://gsg.pe/Api/V1/Loc'],
];

const INVALIDOS: Array<[string, string, RegExp]> = [
  [BASE, 'https://otro.pe/v1/location', /dirección completa/],
  [BASE, 'http://otro.pe', /dirección completa/],
  [BASE, 'javascript:alert(1)', /dirección completa/],
  [BASE, 'mailto:x@y.pe', /dirección completa/],
  [BASE, '//otro.pe/v1/location', /«\/\/»/],
  [BASE, 'v1\\location', /barras invertidas/],
  [BASE, 'v1/../admin', /«\.\.»/],
  [BASE, '../v1', /«\.\.»/],
  [BASE, 'v1/%2e%2e/admin', /«\.\.»/],
  [BASE, 'v1/./x', /«\.»/],
  [BASE, 'v1/location?x=1', /«\?» ni «#»/],
  [BASE, 'v1/location#frag', /«\?» ni «#»/],
  [BASE, 'v1/loca tion', /espacios/],
  [BASE, '', /Falta la ruta/],
  [BASE, '/', /Falta la ruta/],
  [BASE, '///', /«\/\/»/],
  ['', RUTA, /Falta la URL base/],
  ['backend.gsg.pe/api', RUTA, /empezar por https/],
  ['ftp://backend.gsg.pe/api', RUTA, /empezar por https/],
  ['https://', RUTA, /empezar por https/],
  ['https://gsg.pe/api?clave=1', RUTA, /«\?» ni «#»/],
  ['https://gsg.pe/api#x', RUTA, /«\?» ni «#»/],
  ['https://user:pass@gsg.pe/api', RUTA, /usuario ni clave/],
  ['https://gsg.pe/api/../x', RUTA, /«\.\.»/],
  ['https://gsg.pe/a pi', RUTA, /espacios/],
];

describe('unirUrlGsg: URL base + ruta', () => {
  it.each(VALIDOS)('%s + %s = %s', (base, ruta, final) => {
    expect(unirUrlGsg(base, ruta)).toEqual({ ok: true, url: final });
  });

  it.each(INVALIDOS)('rechaza base %s con ruta %s', (base, ruta, error) => {
    const r = unirUrlGsg(base, ruta);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(error);
  });

  it('la base siempre queda con barra final (se conserva /api/)', () => {
    expect(normalizarBaseGsg('https://x.pe/api')).toEqual({ ok: true, url: 'https://x.pe/api/' });
    expect(normalizarBaseGsg('https://x.pe')).toEqual({ ok: true, url: 'https://x.pe/' });
  });

  it('el navegador (vista previa de Conexión) da exactamente lo mismo que el servidor', () => {
    const navegador = new Function(`${UNIR_URL_GSG_JS}; return { unirUrlGsg: unirUrlGsg, normalizarBaseGsg: normalizarBaseGsg };`)() as {
      unirUrlGsg: (b: string, r: string) => ResultadoUrlGsg;
      normalizarBaseGsg: (b: string) => ResultadoUrlGsg;
    };
    const casos: Array<[string, string]> = [...VALIDOS.map(([b, r]) => [b, r] as [string, string]), ...INVALIDOS.map(([b, r]) => [b, r] as [string, string])];
    for (const [b, r] of casos) {
      expect(navegador.unirUrlGsg(b, r), `${b} + ${r}`).toEqual(unirUrlGsg(b, r));
      expect(navegador.normalizarBaseGsg(b), b).toEqual(normalizarBaseGsg(b));
    }
  });
});

describe('migrarUbicacionAntigua: la URL completa de antes a base + ruta', () => {
  it('sin URL antigua sale a donde salía: <dirección>/sendLocation', () => {
    expect(migrarUbicacionAntigua('https://gsg.pe/api', '')).toMatchObject({ ok: true, base: 'https://gsg.pe/api/', ruta: 'sendLocation' });
    expect(migrarUbicacionAntigua('https://gsg.pe/api/sendLocation', '')).toMatchObject({ ok: true, base: 'https://gsg.pe/api/', ruta: 'sendLocation' });
  });

  it('la URL antigua que cuelga de la dirección conserva la base', () => {
    expect(migrarUbicacionAntigua('https://x.pe/api/v1/gsgchat', 'https://x.pe/api/v1/gsgchat/location')).toMatchObject({ ok: true, base: 'https://x.pe/api/v1/gsgchat/', ruta: 'location', regla: 'prefijo' });
  });

  it('con un solo /api/ y nada que la contradiga, se parte ahí', () => {
    const m = migrarUbicacionAntigua(FINAL, FINAL);
    expect(m).toMatchObject({ ok: true, base: BASE, ruta: RUTA, regla: 'api' });
    expect(migrarUbicacionAntigua('', FINAL)).toMatchObject({ ok: true, base: BASE, ruta: RUTA });
  });

  it('ambigua: no se adivina', () => {
    // La dirección apunta a otro sitio que la URL de la ubicación.
    expect(migrarUbicacionAntigua('https://api.gsg.pe/v1', FINAL).ok).toBe(false);
    // Dos /api/.
    expect(migrarUbicacionAntigua('', 'https://x.pe/api/v1/api/location').ok).toBe(false);
    // Sin /api/ ni prefijo común.
    expect(migrarUbicacionAntigua('https://a.pe/b', 'https://c.pe/d/location').ok).toBe(false);
  });
});

// ------------------------------------------------------------ el envio

describe('lo que sale hacia GSG', () => {
  it('solo X-API-Key: sin Authorization, sin la clave en la URL ni en el cuerpo', async () => {
    const f = fetchFalso();
    const puerto = crearPuertoHttp({ url: BASE, rutaUbicacion: RUTA, token: CLAVE, fetchImpl: f.impl });
    expect(puerto.urlUbicacion?.()).toBe(FINAL);
    expect((await puerto.enviar('ubicacion', { tracking: 'T-1', lat: -12, lng: -77 })).ok).toBe(true);
    expect(f.llamadas).toHaveLength(1);
    expect(f.llamadas[0]).toMatchObject({ url: FINAL, metodo: 'POST' });
    for (const l of f.llamadas) {
      expect(l.cabeceras.get('x-api-key')).toBe(CLAVE);
      expect(l.cabeceras.has('authorization')).toBe(false);
      expect(l.url).not.toContain(CLAVE);
      expect(String(l.cuerpo ?? '')).not.toContain(CLAVE);
    }
    expect(JSON.parse(String(f.llamadas[0]!.cuerpo))).toEqual({ tracking: 'T-1', lat: -12, lng: -77 });
  });

  it('con la configuración mal no se manda nada: el reporte queda pendiente con el error a la vista', async () => {
    const f = fetchFalso();
    const puerto = crearPuertoHttp({ url: BASE, rutaUbicacion: '../admin', token: CLAVE, fetchImpl: f.impl });
    expect(puerto.errorConfiguracion?.()).toMatch(/«\.\.»/);
    const repos = createFakeRepos();
    await repos.rutas.encolarReporte({ tipo: 'ubicacion', payload: { tracking: 'T-1', lat: 1, lng: 2 } });
    const r = await despacharReportes(repos, puerto);
    expect(f.llamadas).toHaveLength(0);
    expect(r.enviados).toBe(0);
    expect(repos.rutas._reportes[0]).toMatchObject({ estado: 'pendiente' });
    expect(repos.rutas._reportes[0]!.ultimoError).toMatch(/Configuración de GSG no válida/);
  });
});

// --------------------------------------------------------- la cola

describe('la cola de reportes ante cada respuesta de GSG', () => {
  const encolar = async (repos: ReturnType<typeof createFakeRepos>, n: number) => {
    for (let i = 0; i < n; i++) await repos.rutas.encolarReporte({ tipo: 'ubicacion', payload: { tracking: `T-${i}`, lat: 1, lng: 2 } });
  };

  it.each([
    [401, /API Key de GSG es incorrecta/],
    [403, /no tiene permisos/],
  ] as const)('%i: fallido, sin reintento solo, hasta que cambie la configuración o se pida a mano', async (status, motivo) => {
    // GSG devuelve la clave en su error: no se guarda.
    let codigo: number = status;
    const f = fetchFalso((l) => new Response(JSON.stringify({ error: `clave ${l.cabeceras.get('x-api-key')} rechazada` }), { status: codigo }));
    const repos = createFakeRepos();
    await encolar(repos, 3);
    const puerto = crearPuertoHttp({ url: BASE, rutaUbicacion: RUTA, token: CLAVE, fetchImpl: f.impl });

    const primera = await despacharReportes(repos, puerto);
    expect(f.llamadas).toHaveLength(1); // los de detras no se intentan: fallarian igual
    expect(primera.errores?.[0]).toMatch(motivo);
    expect(repos.rutas._reportes[0]).toMatchObject({ estado: 'fallido' });
    expect(repos.rutas._reportes.slice(1).every((r) => r.estado === 'pendiente' && r.intentos === 0)).toBe(true);
    expect(paradaPorClave(repos, puerto)).toMatch(motivo);

    // Las pasadas automaticas no insisten con la misma configuracion.
    const segunda = await despacharReportes(repos, puerto);
    expect(segunda).toMatchObject({ intentados: 0, enviados: 0 });
    expect(f.llamadas).toHaveLength(1);

    // A mano («Enviar ahora») si se intenta.
    await despacharReportes(repos, puerto, 25, undefined, { manual: true });
    expect(f.llamadas).toHaveLength(2);

    // Ningun error guardado ni devuelto lleva la clave (GSG la devolvio en su respuesta).
    const guardados = repos.rutas._reportes.map((r) => r.ultimoError ?? '').join(' | ');
    expect(guardados).toMatch(/rechazada/);
    expect(guardados).not.toContain(CLAVE);
    expect(JSON.stringify(primera)).not.toContain(CLAVE);

    // Con otra clave (otra configuracion) la cola vuelve a salir sola.
    codigo = 201;
    const otra = crearPuertoHttp({ url: BASE, rutaUbicacion: RUTA, token: `${CLAVE}-nueva`, fetchImpl: f.impl });
    expect(paradaPorClave(repos, otra)).toBeNull();
    await repos.rutas.reencolarFallidos('ubicacion', 10);
    expect((await despacharReportes(repos, otra)).enviados).toBe(3);
  });

  it.each([
    ['429', () => new Response('despacio', { status: 429 })],
    ['500', () => new Response('<html>500</html>', { status: 500 })],
    ['503', () => new Response('mantenimiento', { status: 503 })],
    ['sin red', () => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))],
  ] as Array<[string, () => Response | Promise<Response>]>)('%s: se queda pendiente y se reintenta en la siguiente pasada', async (_n, fallo) => {
    let bien = false;
    const f = fetchFalso(() => (bien ? new Response('{"id":"GSG-1"}', { status: 200 }) : fallo()));
    const repos = createFakeRepos();
    await encolar(repos, 2);
    const puerto = crearPuertoHttp({ url: BASE, rutaUbicacion: RUTA, token: CLAVE, fetchImpl: f.impl, idempotenciaUbicacion: true });
    expect(await despacharReportes(repos, puerto)).toMatchObject({ intentados: 2, enviados: 0, fallidos: 0 });
    expect(repos.rutas._reportes.every((r) => r.estado === 'pendiente')).toBe(true);
    bien = true;
    expect(await despacharReportes(repos, puerto)).toMatchObject({ enviados: 2 });
    expect(repos.rutas._reportes.every((r) => r.estado === 'enviado' && r.externoId === 'GSG-1')).toBe(true);
    expect(repos.rutas._reportes.map((r) => r.ultimoError ?? '').join(' ')).not.toContain(CLAVE);
  });

  it('timeout: se queda pendiente y se reintenta', async () => {
    vi.useFakeTimers();
    try {
      const f = fetchFalso((l) => new Promise<Response>((_, rechazar) => {
        void l;
        setTimeout(() => rechazar(new DOMException('abortado', 'AbortError')), 5_000);
      }));
      const repos = createFakeRepos();
      await encolar(repos, 1);
      const puerto = crearPuertoHttp({ url: BASE, rutaUbicacion: RUTA, token: CLAVE, fetchImpl: f.impl, timeoutSegundos: 1, idempotenciaUbicacion: true });
      const p = despacharReportes(repos, puerto);
      await vi.advanceTimersByTimeAsync(6_000);
      const r = await p;
      expect(r).toMatchObject({ enviados: 0, fallidos: 0 });
      expect(repos.rutas._reportes[0]).toMatchObject({ estado: 'pendiente' });
      expect(repos.rutas._reportes[0]!.ultimoError).toMatch(/no respondió a tiempo/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('solo un 2xx marca enviado (un 304 o un 422 no)', async () => {
    const codigos = [304, 422, 204];
    const f = fetchFalso(() => {
      const s = codigos.shift()!;
      return new Response(s === 304 || s === 204 ? null : '{}', { status: s });
    });
    const repos = createFakeRepos();
    await encolar(repos, 3);
    const puerto = crearPuertoHttp({ url: BASE, rutaUbicacion: RUTA, token: CLAVE, fetchImpl: f.impl });
    await despacharReportes(repos, puerto);
    expect(repos.rutas._reportes.map((r) => r.estado)).toEqual(['fallido', 'fallido', 'enviado']);
  });
});

// ------------------------------------------- la conexion desde la pantalla

describe('la conexión saliente guardada', () => {
  it('guarda URL base + ruta, cifra la API Key y nunca la enseña entera', async () => {
    const settingsRepo = createMemorySettingsRepo();
    const c = await crearConexionGsg({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, config });
    const e = await c.conectarReal({ url: BASE, rutaUbicacion: RUTA, apiKey: CLAVE });
    expect(e).toMatchObject({ modo: 'real', rutaUbicacion: RUTA, destinoUbicacion: FINAL, tieneToken: true, claveEnmascarada: `••••${CLAVE.slice(-4)}`, errorConfiguracion: null, conectada: true });
    expect(JSON.stringify(e)).not.toContain(CLAVE);
    const filas = await settingsRepo.getAll();
    const fila = filas.find((r) => r.key === 'gsg.apiKey');
    expect(fila?.encrypted).toBe(true);
    expect(JSON.stringify(filas)).not.toContain(CLAVE);
    await expect(c.conectarReal({ url: BASE, rutaUbicacion: 'https://otro.pe/x' })).rejects.toThrow(/dirección completa/);
    await expect(c.conectarReal({ url: 'https://gsg.pe/api?x=1', rutaUbicacion: RUTA })).rejects.toThrow(/«\?» ni «#»/);
  });

  it('compatibilidad: GSG_TOKEN del .env y gsg.token guardado siguen valiendo, sin exponerse', async () => {
    const f = fetchFalso();
    const env = await crearConexionGsg({ settingsRepo: createMemorySettingsRepo(), settingsKeyBase64: TEST_SETTINGS_KEY, config: { ...config, GSG_URL: BASE, GSG_LOCATION_PATH: RUTA, GSG_TOKEN: CLAVE }, fetchImpl: f.impl });
    expect(env.estado()).toMatchObject({ origen: 'env', origenClave: 'env_antigua', tieneToken: true, destinoUbicacion: FINAL });
    expect(JSON.stringify(env.estado())).not.toContain(CLAVE);
    await env.puerto().enviar('ubicacion', { tracking: 'T', lat: 1, lng: 2 });
    expect(f.llamadas.at(-1)!.cabeceras.get('x-api-key')).toBe(CLAVE);

    // GSG_API_KEY manda sobre GSG_TOKEN.
    const nueva = await crearConexionGsg({ settingsRepo: createMemorySettingsRepo(), settingsKeyBase64: TEST_SETTINGS_KEY, config: { ...config, GSG_URL: BASE, GSG_LOCATION_PATH: RUTA, GSG_TOKEN: 'vieja-000000000000', GSG_API_KEY: CLAVE }, fetchImpl: f.impl });
    expect(nueva.estado().origenClave).toBe('env');
    await nueva.puerto().enviar('ubicacion', { tracking: 'T', lat: 1, lng: 2 });
    expect(f.llamadas.at(-1)!.cabeceras.get('x-api-key')).toBe(CLAVE);

    // La clave guardada antes en `gsg.token` (cifrada).
    const settingsRepo = createMemorySettingsRepo();
    await settingsRepo.put('gsg.conexion', JSON.stringify({ modo: 'real', url: 'https://gsg.pe/api', conectadoEn: null }), false);
    await settingsRepo.put('gsg.token', encrypt(CLAVE, keyFromBase64(TEST_SETTINGS_KEY)), true);
    const antigua = await crearConexionGsg({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, config, fetchImpl: f.impl });
    expect(antigua.estado()).toMatchObject({ origenClave: 'pantalla_antigua', tieneToken: true, rutaUbicacion: 'sendLocation', destinoUbicacion: 'https://gsg.pe/api/sendLocation' });
    expect(JSON.stringify(antigua.estado())).not.toContain(CLAVE);
    await antigua.puerto().enviar('ubicacion', { tracking: 'T', lat: 1, lng: 2 });
    expect(f.llamadas.at(-1)!.cabeceras.get('x-api-key')).toBe(CLAVE);
    // Al guardar una nueva, la antigua desaparece.
    await antigua.conectarReal({ url: BASE, rutaUbicacion: RUTA, apiKey: `${CLAVE}-2` });
    expect((await settingsRepo.getAll()).map((r) => r.key)).not.toContain('gsg.token');
  });

  it('migra la URL antigua de ubicación cuando es inequívoca (y lo guarda), sin registrar secretos', async () => {
    const settingsRepo = createMemorySettingsRepo();
    await settingsRepo.put('gsg.conexion', JSON.stringify({ modo: 'real', url: FINAL, urlUbicacion: FINAL, conectadoEn: null }), false);
    await settingsRepo.put('gsg.token', encrypt(CLAVE, keyFromBase64(TEST_SETTINGS_KEY)), true);
    const logs: string[] = [];
    const c = await crearConexionGsg({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, config, log: (m, d) => logs.push(`${m} ${JSON.stringify(d ?? {})}`) });
    expect(c.estado()).toMatchObject({ url: 'https://backend.developer.gsgcorp.pe/api', rutaUbicacion: RUTA, destinoUbicacion: FINAL, errorConfiguracion: null });
    const guardada = JSON.parse((await settingsRepo.getAll()).find((r) => r.key === 'gsg.conexion')!.value);
    expect(guardada).toMatchObject({ rutaUbicacion: RUTA, urlUbicacion: '' });
    expect(logs.join('\n')).toMatch(/se convirtió/);
    expect(logs.join('\n')).not.toContain(CLAVE);
  });

  it('URL antigua ambigua: error claro en el estado y en la prueba, y no se envía nada', async () => {
    const settingsRepo = createMemorySettingsRepo();
    await settingsRepo.put('gsg.conexion', JSON.stringify({ modo: 'real', url: 'https://api.gsg.pe/v1', urlUbicacion: 'https://otro.gsg.pe/recibir/ubicacion', conectadoEn: null }), false);
    const f = fetchFalso();
    const c = await crearConexionGsg({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, config, fetchImpl: f.impl });
    const e = c.estado();
    expect(e.errorConfiguracion).toMatch(/No se puede convertir sin adivinar/);
    expect(e.aviso).toMatch(/no es válida/);
    expect(e.conectada).toBe(false);
    expect(e.destinoUbicacion).toBeNull();
    expect((await c.probar()).detalle).toMatch(/no es válida/);
    const repos = createFakeRepos();
    await repos.rutas.encolarReporte({ tipo: 'ubicacion', payload: { tracking: 'T', lat: 1, lng: 2 } });
    await despacharReportes(repos, c.puerto());
    expect(f.llamadas).toHaveLength(0);
    expect(repos.rutas._reportes[0]).toMatchObject({ estado: 'pendiente' });
    expect(repos.rutas._reportes[0]!.ultimoError).toMatch(/No se puede convertir sin adivinar/);
    // Lo guardado no se toca: se corrige desde la pantalla.
    expect(JSON.parse((await settingsRepo.getAll()).find((r) => r.key === 'gsg.conexion')!.value).urlUbicacion).toBe('https://otro.gsg.pe/recibir/ubicacion');
  });

  it('la prueba de conexión no llama a GSG: revisa URL, ruta y clave sin red y no enseña la clave', async () => {
    const f = fetchFalso(() => new Response('{}', { status: 200 }));
    const c = await crearConexionGsg({ settingsRepo: createMemorySettingsRepo(), settingsKeyBase64: TEST_SETTINGS_KEY, config, fetchImpl: f.impl });
    await c.conectarReal({ url: BASE, rutaUbicacion: RUTA, apiKey: CLAVE });
    const bien = await c.probar();
    expect(bien.ok).toBe(true);
    expect(bien.detalle).toContain(FINAL);
    expect(bien.detalle).toMatch(/GSGchat no le pide nada a GSG/);
    // Candidata sin guardar: tampoco llama ni escribe nada.
    const otra = await c.probar({ url: 'https://otra.gsg.pe/api/', token: CLAVE, rutaUbicacion: RUTA });
    expect(otra.ok).toBe(true);
    const mala = await c.probar({ url: 'https://otra.gsg.pe/api/', token: CLAVE, rutaUbicacion: '../x' });
    expect(mala.ok).toBe(false);
    expect(f.llamadas).toEqual([]);
    expect(JSON.stringify([bien, otra, mala, c.estado()])).not.toContain(CLAVE);
  });
});

// ----------------------------------------------------------- el simulador

describe('el simulador de GSG exige X-API-Key', () => {
  it('con X-API-Key entra; con solo Bearer, no', async () => {
    const app = Fastify({ logger: false });
    const simulador = crearGsgSimulado({ token: CLAVE });
    await registerGsgSimulado(app, { simulador, prefijo: '/simulador/gsg' });
    await app.ready();
    try {
      const bien = await app.inject({ method: 'GET', url: '/simulador/gsg/reparto/estado', headers: { 'x-api-key': CLAVE } });
      expect(bien.statusCode).toBe(200);
      const bearer = await app.inject({ method: 'GET', url: '/simulador/gsg/reparto/estado', headers: { authorization: `Bearer ${CLAVE}` } });
      expect(bearer.statusCode).toBe(401);
      expect(bearer.json().error).toMatch(/X-API-Key/);
      const mala = await app.inject({ method: 'GET', url: '/simulador/gsg/reparto/estado', headers: { 'x-api-key': 'otra' } });
      expect(mala.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('el puerto real habla con el simulador sin cambiar nada', async () => {
    const sim = crearGsgSimulado({ token: CLAVE });
    sim.cargarDePrueba();
    const f = fetchFalso((l) => {
      const r = sim.atender(l.metodo, l.url.replace('https://gsg.pe/api', ''), l.cabeceras.get('x-api-key'), l.cuerpo ? JSON.parse(String(l.cuerpo)) : undefined);
      return new Response(JSON.stringify(r.body), { status: r.status });
    });
    const bueno = crearPuertoHttp({ url: 'https://gsg.pe/api', rutaUbicacion: 'ubicaciones', token: CLAVE, fetchImpl: f.impl });
    expect((await bueno.enviar('ubicacion', { tracking: 'GSG-PRUEBA-0001', referencia: 'GSG-PRUEBA-0001', lat: -12.1, lng: -77.03 })).ok).toBe(true);
    const malo = crearPuertoHttp({ url: 'https://gsg.pe/api', rutaUbicacion: 'ubicaciones', token: 'otra', fetchImpl: f.impl });
    expect((await malo.enviar('ubicacion', { tracking: 'GSG-PRUEBA-0001', lat: -12.1, lng: -77.03 })).autenticacion).toBe(401);
    // Solo POST: ninguna llamada de lectura a GSG.
    expect(f.llamadas.every((l) => l.metodo === 'POST')).toBe(true);
  });
});
