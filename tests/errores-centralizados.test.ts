/**
 * El manejo central de errores: el catalogo de GET /api/v1/errores y los
 * 400, 401, 402 y 404 con la misma forma ({ ok:false, codigo, error, ir? })
 * en la API, y lo que ve una persona en la web (pagina 404 y el `api()` del panel).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { crearEscenarioEntregas, type EscenarioEntregas } from './escenario-entregas.js';
import { generarClaveApi, hashClaveApi, prefijoDeClave } from '../src/auth/claves-api.js';
import { CATALOGO_ERRORES } from '../src/api/errores.js';
import { panelPage } from '../src/web/pages.js';
import type { ServicioPlan } from '../src/plan/servicio.js';

const MOTIVO_PLAN = 'La membresía venció el 1 de octubre: el asistente IA y las campañas están en pausa.';
const plan = { motivo: (que: string) => (que === 'ia' ? MOTIVO_PLAN : null), permite: (que: string) => que !== 'ia', estado: () => ({ origen: 'libre' }) } as unknown as ServicioPlan;

let esc: EscenarioEntregas, todo: string;

beforeAll(async () => {
  esc = await crearEscenarioEntregas({ agente: true, plan });
  todo = generarClaveApi();
  await esc.repos.claves.crear({ nombre: 'Pruebas', hash: hashClaveApi(todo), prefijo: prefijoDeClave(todo), creadaPor: null, permisos: ['*'] });
});
afterAll(async () => {
  await esc.cerrar();
});

const conClave = (extra: Record<string, string> = {}) => ({ 'x-api-key': todo, ...extra });

function forma(json: any, codigo: string) {
  expect(json).toMatchObject({ ok: false, codigo });
  expect(typeof json.error).toBe('string');
  expect(json.error.length).toBeGreaterThan(0);
  expect(CATALOGO_ERRORES[codigo as keyof typeof CATALOGO_ERRORES]).toBeTruthy();
}

describe('GET /api/v1/errores', () => {
  it('lista el catalogo sin clave, con su HTTP y que hacer', async () => {
    const r = await esc.app.inject({ method: 'GET', url: '/api/v1/errores' });
    expect(r.statusCode).toBe(200);
    const errores = r.json().errores as Array<{ codigo: string; status: number; significa: string; queHacer: string }>;
    expect(errores.length).toBe(Object.keys(CATALOGO_ERRORES).length);
    for (const s of [400, 401, 402, 404]) expect(errores.some((e) => e.status === s)).toBe(true);
    for (const e of errores) expect(e.significa && e.queHacer).toBeTruthy();
  });

  it('filtra por status y busca un codigo (sin distinguir mayusculas)', async () => {
    const pagos = (await esc.app.inject({ method: 'GET', url: '/api/v1/errores?status=402' })).json().errores;
    expect(pagos).toEqual([{ codigo: 'PAGO_REQUERIDO', ...CATALOGO_ERRORES.PAGO_REQUERIDO }]);
    const uno = await esc.app.inject({ method: 'GET', url: '/api/v1/errores/sesion_requerida' });
    expect(uno.statusCode).toBe(200);
    expect(uno.json()).toMatchObject({ codigo: 'SESION_REQUERIDA', status: 401 });
  });

  it('un codigo que no existe es 404 NO_EXISTE', async () => {
    const r = await esc.app.inject({ method: 'GET', url: '/api/v1/errores/INVENTADO' });
    expect(r.statusCode).toBe(404);
    forma(r.json(), 'NO_EXISTE');
  });
});

describe('400', () => {
  it('JSON roto: JSON_INVALIDO', async () => {
    const r = await esc.app.inject({ method: 'POST', url: '/api/v1/mensajes', headers: conClave({ 'content-type': 'application/json' }), payload: '{"telefono":' });
    expect(r.statusCode).toBe(400);
    forma(r.json(), 'JSON_INVALIDO');
  });

  it('campos que no valen: VALIDACION con detalles por campo', async () => {
    const r = await esc.app.inject({ method: 'POST', url: '/api/v1/webhooks', headers: conClave(), payload: { url: 'no-es-url' } });
    expect(r.statusCode).toBe(400);
    forma(r.json(), 'VALIDACION');
    expect(Array.isArray(r.json().detalles)).toBe(true);
  });
});

describe('401', () => {
  it('la API sin clave: CLAVE_* y WWW-Authenticate', async () => {
    const r = await esc.app.inject({ method: 'GET', url: '/api/v1/estado' });
    expect(r.statusCode).toBe(401);
    expect(r.json().codigo).toMatch(/^CLAVE_/);
    forma(r.json(), r.json().codigo);
    expect(r.headers['www-authenticate']).toBeTruthy();
  });

  it('una clave que no existe: CLAVE_INVALIDA', async () => {
    const r = await esc.app.inject({ method: 'GET', url: '/api/v1/estado', headers: { 'x-api-key': generarClaveApi() } });
    expect(r.statusCode).toBe(401);
    forma(r.json(), r.json().codigo);
  });

  it('el panel sin sesion: SESION_REQUERIDA y a donde ir', async () => {
    const r = await esc.app.inject({ method: 'GET', url: '/admin/ia' });
    expect(r.statusCode).toBe(401);
    forma(r.json(), 'SESION_REQUERIDA');
    expect(r.json().ir).toBe('/login');
  });
});

describe('402', () => {
  it('la membresia no cubre la IA: PAGO_REQUERIDO con el motivo y donde arreglarlo', async () => {
    for (const url of ['/api/v1/ia/ordenes', '/api/v1/ia/ordenes/confirmar']) {
      const r = await esc.app.inject({ method: 'POST', url, headers: conClave(), payload: url.endsWith('confirmar') ? { acciones: [] } : { texto: '¿cómo va el reparto?' } });
      expect(r.statusCode, url).toBe(402);
      forma(r.json(), 'PAGO_REQUERIDO');
      expect(r.json().error).toBe(MOTIVO_PLAN);
      expect(r.json().ir).toBe('/panel#configuracion');
    }
  });

  it('el catalogo de la IA se sigue pudiendo leer', async () => {
    const r = await esc.app.inject({ method: 'GET', url: '/api/v1/ia/ordenes/catalogo', headers: conClave() });
    expect(r.statusCode).toBe(200);
  });
});

describe('404', () => {
  it('una ruta de API que no existe: RUTA_NO_EXISTE en JSON', async () => {
    const r = await esc.app.inject({ method: 'GET', url: '/api/v1/no-existe', headers: conClave() });
    expect(r.statusCode).toBe(404);
    forma(r.json(), 'RUTA_NO_EXISTE');
  });

  it('una pantalla que no existe en el navegador: pagina HTML con el 404', async () => {
    const r = await esc.app.inject({ method: 'GET', url: '/pantalla-que-no-existe', headers: { accept: 'text/html,application/xhtml+xml' } });
    expect(r.statusCode).toBe(404);
    expect(r.headers['content-type']).toContain('text/html');
    expect(r.body).toContain('data-status="404"');
    expect(r.body).toContain('Esta página no existe');
    expect(r.body).toContain('/pantalla-que-no-existe');
  });

  it('el HTML escapa la ruta pedida', async () => {
    const r = await esc.app.inject({ method: 'GET', url: '/%3Cscript%3Ealert(1)%3C/script%3E', headers: { accept: 'text/html' } });
    expect(r.statusCode).toBe(404);
    expect(r.body).not.toContain('<script>alert(1)');
  });
});

describe('la web: api() del panel', () => {
  // La funcion api() tal cual sale en la pagina, con un fetch de mentira. Se llama con POST: los GET pasan por la cache de lecturas (window.leerPanel).
  const fuente = /async function api\(url,method,body\)\{[\s\S]*?return d;\}/.exec(panelPage({ configured: true, nombreNegocio: 'Prueba' }))![0];
  const llamar = async (status: number, cuerpo: string) => {
    const location = { href: '', pathname: '/panel', hash: '' };
    const fetch = async () => ({ status, ok: status < 400, json: async () => JSON.parse(cuerpo) });
    const api = runInNewContext(`(${fuente})`, { fetch, location, encodeURIComponent, JSON, Error }) as (u: string, m?: string, b?: unknown) => Promise<unknown>;
    try {
      return { ok: true, valor: await api('/admin/x', 'POST', {}), location };
    } catch (e) {
      return { ok: false, e: e as Error & { status?: number; codigo?: string; ir?: string }, location };
    }
  };

  it('401 manda a entrar', async () => {
    const r = await llamar(401, '{"ok":false,"codigo":"SESION_REQUERIDA","error":"x"}');
    expect(r.ok).toBe(false);
    expect(r.location.href).toBe('/login?next=%2Fpanel');
  });

  it('400 y 404 ensenan el mensaje del servidor y su codigo', async () => {
    const malo = await llamar(400, '{"ok":false,"codigo":"VALIDACION","error":"El teléfono no es válido."}');
    expect(malo.e!.message).toBe('El teléfono no es válido.');
    expect(malo.e!.codigo).toBe('VALIDACION');
    const falta = await llamar(404, 'no es json');
    expect(falta.e!.message).toBe('No existe (o ya no).');
    expect(falta.e!.status).toBe(404);
  });

  it('402 dice el motivo y a donde ir', async () => {
    const r = await llamar(402, JSON.stringify({ ok: false, codigo: 'PAGO_REQUERIDO', error: MOTIVO_PLAN, ir: '/panel#configuracion' }));
    expect(r.e!.message).toBe(MOTIVO_PLAN);
    expect(r.e!.ir).toBe('/panel#configuracion');
  });
});
