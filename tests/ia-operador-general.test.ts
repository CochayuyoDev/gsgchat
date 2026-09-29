/**
 * La via general de la IA operadora (panel.mapa, panel.consultar,
 * panel.hacer): todo lo del panel que no tiene accion con nombre propio.
 *
 * Se prueba: la lista negra (con trampas: .., mayusculas, query, barras
 * dobles, url absoluta, %), el rol y el modo «Solo lo de GSG», que preparar
 * solo lee y arma la tarjeta en palabras con el «antes», que ejecutar lo
 * vuelve a comprobar todo, que los datos salen sin secretos y recortados, que
 * cada ruta del mapa existe de verdad en el codigo y, de punta a punta con el
 * servidor, que nada cambia hasta «Hacerlo».
 */

import { afterEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { ACCIONES_GENERAL, LISTA_NEGRA, MAPA_PANEL, limpiarDatos, recortar, resolverRuta, revisarUrl } from '../src/ia/acciones-general.js';
import { ACCIONES_POR_NOMBRE, prepararAccion } from '../src/ia/acciones.js';
import { validarAccion } from '../src/ia/ordenes.js';
import type { ContextoAccion, Llamada, RespuestaLlamada } from '../src/ia/acciones-base.js';
import { crearEscenarioEntregas, type EscenarioEntregas } from './escenario-entregas.js';

type Json = Record<string, any>;

const accion = (n: string) => ACCIONES_GENERAL.find((a) => a.nombre === n)!;
const mapa = accion('panel.mapa');
const consultar = accion('panel.consultar');
const hacer = accion('panel.hacer');

/** Un panel de mentira: contesta lo que se le diga y apunta cada llamada. */
function ctxFalso(opts: { esAdmin?: boolean; sinVentas?: boolean; respuestas?: Record<string, RespuestaLlamada> } = {}) {
  const llamadas: Llamada[] = [];
  const ctx: ContextoAccion = {
    quien: 'Ali',
    esAdmin: opts.esAdmin ?? true,
    sinVentas: opts.sinVentas,
    llamar: async (l) => {
      llamadas.push(l);
      const r = opts.respuestas?.[`${l.method} ${l.url}`];
      return r ?? { status: 200, json: { ok: true } };
    },
  };
  return { ctx, llamadas };
}

const params = (a: typeof hacer, crudo: Record<string, unknown>) => {
  const v = a.schema.safeParse(crudo);
  if (!v.success) throw new Error(JSON.stringify(v.error.issues));
  return v.data as Record<string, unknown>;
};

// ------------------------------------------------------------------ catalogo

describe('el catalogo', () => {
  it('las tres van al final del catalogo, con descripcion, parametros y ejemplo que valen', () => {
    for (const a of ACCIONES_GENERAL) {
      expect(ACCIONES_POR_NOMBRE.get(a.nombre)).toBe(a);
      expect(a.descripcion.length).toBeGreaterThan(40);
      expect(a.parametros.length).toBeGreaterThan(10);
      const { accion: _n, ...resto } = a.ejemplo.accion;
      expect(a.schema.safeParse(resto).success, a.nombre).toBe(true);
      expect(validarAccion(a.ejemplo.accion).ok).toBe(true);
    }
    expect(consultar.tipo).toBe('consulta');
    expect(mapa.tipo).toBe('consulta');
    expect(hacer).toMatchObject({ tipo: 'cambio', peligrosa: true });
    expect(hacer.descripcion).toMatch(/NO tenga una acción con nombre propio/);
  });

  it('panel.hacer entiende "body", el metodo en minusculas y sin metodo si la ruta solo tiene uno', () => {
    const v = validarAccion({ accion: 'panel.hacer', metodo: 'post', ruta: '/admin/motorizados/7', body: { placa: 'X' } });
    expect(v.ok && v.params).toEqual({ metodo: 'POST', ruta: '/admin/motorizados/7', datos: { placa: 'X' } });
    expect(validarAccion({ accion: 'panel.hacer', metodo: 'GET', ruta: '/admin/motorizados' }).ok).toBe(false);
  });
});

// ------------------------------------------------------------------ el mapa

describe('panel.mapa', () => {
  it('sin filtro da las secciones; con seccion o palabra, sus rutas con la forma del body', async () => {
    const { ctx, llamadas } = ctxFalso();
    const todo = await mapa.ejecutar({}, ctx);
    expect(todo.ok).toBe(true);
    const ids = (todo.datos as Json[]).map((s) => s.seccion);
    for (const s of ['motorizados', 'entregas', 'chat', 'contactos', 'campanas', 'plantillas', 'automatizacion', 'stickers', 'procesos', 'envio-automatico', 'reparto', 'leads', 'ajustes', 'integraciones', 'entrenamiento', 'resumenes']) expect(ids).toContain(s);

    const motos = await mapa.ejecutar({ seccion: 'motorizados' }, ctx);
    const rutas = (motos.datos as Json[])[0]!.rutas as Json[];
    expect(rutas.find((r) => r.metodo === 'POST' && r.ruta === '/admin/motorizados')).toMatchObject({ body: expect.stringContaining('telefono') });

    const stick = await mapa.ejecutar({ buscar: 'sticker' }, ctx);
    expect(JSON.stringify(stick.datos)).toContain('/admin/stickers/desde-chat');
    expect(JSON.stringify(stick.datos).length).toBeLessThan(6000);
    expect(llamadas).toEqual([]);
  });

  it('con «Solo lo de GSG» no salen las campañas', async () => {
    const { ctx } = ctxFalso({ sinVentas: true });
    const todo = await mapa.ejecutar({}, ctx);
    expect((todo.datos as Json[]).map((s) => s.seccion)).not.toContain('campanas');
    expect((await mapa.ejecutar({ seccion: 'campanas' }, ctx)).ok).toBe(false);
  });

  it('en el mapa no hay nada de la lista negra ni rutas con credenciales', () => {
    for (const s of MAPA_PANEL)
      for (const r of s.rutas) {
        const url = r.ruta.replace(/:[A-Za-z]+/g, '5');
        expect(revisarUrl(url), `${r.metodo} ${r.ruta}`).not.toHaveProperty('motivo');
        expect(url).not.toMatch(/token|secret|password|clave|usuarios|membresia|tiendas|connect|waha|settings/i);
      }
  });

  it('cada ruta del mapa existe de verdad en el codigo (mismo metodo y mismo literal)', () => {
    const raiz = path.resolve(__dirname, '../src');
    const archivos: string[] = [];
    const recorrer = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = path.join(d, n);
        if (statSync(p).isDirectory()) recorrer(p);
        else if (p.endsWith('.ts')) archivos.push(p);
      }
    };
    recorrer(raiz);
    const existentes = new Set<string>();
    const re = /app\.(get|post|put|patch|delete)\s*(?:<[^>]*>)?\(\s*'(\/admin[^']*)'/g;
    for (const f of archivos) {
      const t = readFileSync(f, 'utf8');
      for (const m of t.matchAll(re)) existentes.add(`${m[1]!.toUpperCase()} ${m[2]}`);
    }
    expect(existentes.size).toBeGreaterThan(100);
    const faltan = MAPA_PANEL.flatMap((s) => s.rutas.map((r) => `${r.metodo} ${r.ruta}`)).filter((k) => !existentes.has(k));
    expect(faltan).toEqual([]);
    // Y lo que se lee para el «antes» es un GET que existe.
    const leer = MAPA_PANEL.flatMap((s) => s.rutas.filter((r) => r.leer).map((r) => `GET ${r.leer}`)).filter((k) => !existentes.has(k));
    expect(leer).toEqual([]);
  });
});

// -------------------------------------------------------------- lista negra

const TRAMPAS = [
  '/admin/claves-api',
  '/admin/claves-api/abc',
  '/admin/../admin/claves-api',
  '/admin/./claves-api',
  '/admin/motorizados/../../admin/claves-api',
  '/ADMIN/CLAVES-API',
  '/Admin/Usuarios',
  '/admin/claves-api?x=1',
  '/admin//claves-api',
  '//admin/claves-api',
  '/admin/claves%2Dapi',
  '/admin/%2e%2e/usuarios',
  'http://localhost:3300/admin/motorizados',
  'https://evil.example/admin/motorizados',
  'javascript:alert(1)',
  '\\admin\\usuarios',
  '/admin/usuarios',
  '/admin/usuarios/1',
  '/admin/mi-clave',
  '/admin/codigos-conexion',
  '/admin/membresia',
  '/admin/membresia/maestro',
  '/admin/tiendas',
  '/admin/tiendas/3/token',
  '/admin/connect',
  '/admin/connect/signup',
  '/admin/waha/connect',
  '/admin/local/logout',
  '/admin/settings',
  '/admin/settings/test',
  '/admin/desarrollador/generar',
  '/admin/dev/reset',
  '/admin/entregas/gsg',
  '/admin/gsg/tokens-simulador',
  '/admin/integraciones/stoky/clave',
  '/admin/ia/ordenes',
  '/admin/ia/ordenes/confirmar',
  '/admin/motorizados/de-prueba',
  '/admin/motorizados?token=abc',
  '/admin/chat/conversations?q=x&secret=1',
  '/panel',
  '/api/v1/entregas',
  '/admin',
  '/admin/motorizados#x',
  'admin/motorizados',
  '',
];

describe('la lista negra: nunca, ni consultar ni hacer', () => {
  it('las trampas no pasan de revisarUrl', () => {
    for (const t of TRAMPAS) expect(revisarUrl(t), t).toHaveProperty('motivo');
    for (const p of LISTA_NEGRA) expect(revisarUrl(p), p).toHaveProperty('motivo');
  });

  it('ni panel.consultar ni panel.hacer (preparar ni ejecutar) llegan a llamar al panel', async () => {
    for (const t of TRAMPAS) {
      const { ctx, llamadas } = ctxFalso();
      const c = await consultar.ejecutar({ ruta: t }, ctx);
      expect(c.ok, t).toBe(false);
      for (const metodo of ['POST', 'DELETE', 'PUT', 'PATCH']) {
        const p = { metodo, ruta: t, datos: metodo === 'DELETE' ? undefined : { nombre: 'x' } };
        const prep = await prepararAccion(hacer, p, ctx);
        expect(prep.tipo, `${metodo} ${t}`).toBe('no');
        const e = await hacer.ejecutar(p, ctx);
        expect(e.ok, `${metodo} ${t}`).toBe(false);
      }
      expect(llamadas, t).toEqual([]);
    }
  });

  it('un campo del body con token/clave/password tampoco pasa', async () => {
    const { ctx, llamadas } = ctxFalso();
    for (const datos of [{ token: 'x' }, { clave: 'x' }, { vigilante: { password: 'x' } }, { apiKey: 'x' }, { lista: [{ secret: 1 }] }]) {
      const p = params(hacer, { metodo: 'POST', ruta: '/admin/voz', datos });
      expect((await prepararAccion(hacer, p, ctx)).tipo).toBe('no');
      expect((await hacer.ejecutar(p, ctx)).ok).toBe(false);
    }
    expect(llamadas).toEqual([]);
  });
});

// ------------------------------------------------------ rol, modo y el mapa

describe('lo que no esta en el mapa, el metodo, el rol y «Solo lo de GSG»', () => {
  it('una ruta que no esta en el mapa: «no» con las parecidas', async () => {
    const { ctx, llamadas } = ctxFalso();
    const prep = await prepararAccion(hacer, params(hacer, { metodo: 'POST', ruta: '/admin/motorizado/7', datos: { placa: 'X' } }), ctx);
    expect(prep).toMatchObject({ tipo: 'no', resumen: expect.stringContaining('no está en el mapa') });
    expect((prep as Json).resumen).toContain('/admin/motorizados');
    expect(llamadas).toEqual([]);
  });

  it('el metodo equivocado se dice con los que valen', () => {
    const r = resolverRuta('PUT', '/admin/motorizados/7', { esAdmin: true });
    expect(r).toMatchObject({ motivo: expect.stringContaining('POST') });
    expect(resolverRuta('POST', '/admin/entregas/numeros', { esAdmin: true })).toHaveProperty('motivo');
    expect(resolverRuta('GET', '/admin/entregas/numeros', { esAdmin: true })).toMatchObject({ entrada: { ruta: '/admin/entregas/numeros' } });
    expect(resolverRuta('GET', '/admin/entregas/12', { esAdmin: true })).toMatchObject({ entrada: { ruta: '/admin/entregas/:id' }, params: { id: '12' } });
  });

  it('lo de administrador no se prepara ni se hace para un operador', async () => {
    const { ctx, llamadas } = ctxFalso({ esAdmin: false });
    const p = params(hacer, { metodo: 'POST', ruta: '/admin/ajustes', datos: { nombreNegocio: 'X' } });
    expect(await prepararAccion(hacer, p, ctx)).toMatchObject({ tipo: 'no', resumen: expect.stringContaining('administrador') });
    expect((await hacer.ejecutar(p, ctx)).ok).toBe(false);
    expect(llamadas).toEqual([]);
    // Lo que no es de administrador si.
    const q = params(hacer, { metodo: 'POST', ruta: '/admin/motorizados', datos: { telefono: '51999000009', nombre: 'Zoe' } });
    expect((await prepararAccion(hacer, q, ctx)).tipo).toBe('listo');
  });

  it('con «Solo lo de GSG» no hay campañas', async () => {
    const { ctx, llamadas } = ctxFalso({ sinVentas: true });
    expect((await consultar.ejecutar({ ruta: '/admin/campaigns' }, ctx)).ok).toBe(false);
    expect((await prepararAccion(hacer, params(hacer, { metodo: 'POST', ruta: '/admin/campaigns/3/estado', datos: { accion: 'parar' } }), ctx)).tipo).toBe('no');
    expect(llamadas).toEqual([]);
  });

  it('faltan datos obligatorios: se dice cuales y la forma', async () => {
    const { ctx } = ctxFalso();
    const prep = await prepararAccion(hacer, params(hacer, { metodo: 'POST', ruta: '/admin/motorizados', datos: { nombre: 'Zoe' } }), ctx);
    expect(prep).toMatchObject({ tipo: 'no', resumen: expect.stringContaining('telefono') });
  });
});

// ---------------------------------------------------- preparar y ejecutar

describe('panel.hacer: tarjeta en palabras, preparar solo lee', () => {
  const motos = { status: 200, json: { motorizados: [{ id: 7, nombre: 'Carlos Rojas', phone: '51999000001', placa: 'OLD-1', estado: 'activo' }] } };

  it('la tarjeta dice que hace, a quien, antes y despues; preparar solo hace GET', async () => {
    const { ctx, llamadas } = ctxFalso({ respuestas: { 'GET /admin/motorizados': motos } });
    // Sin metodo y con dos posibles (POST y DELETE): se pregunta.
    expect(await prepararAccion(hacer, params(hacer, { ruta: '/admin/motorizados/7', datos: { placa: 'X' } }), ctx)).toMatchObject({ tipo: 'no', resumen: expect.stringContaining('POST o DELETE') });
    // Sin metodo y con uno solo: ese.
    expect(await prepararAccion(hacer, params(hacer, { ruta: '/admin/motorizados/7/ruta/mandar' }), ctx)).toMatchObject({ tipo: 'listo', params: { metodo: 'POST' } });
    llamadas.length = 0;
    const p = params(hacer, { metodo: 'POST', ruta: '/admin/motorizados/7', datos: { placa: 'ABC-123', estado: 'descanso' } });
    const prep = await prepararAccion(hacer, p, ctx);
    expect(prep.tipo).toBe('listo');
    const t = (prep as Json).tarjeta;
    expect(t).toMatchObject({ que: expect.stringContaining('cambiar los datos de un motorizado'), aQuien: 'Carlos Rojas', antes: 'placa: OLD-1 · estado: activo', despues: 'placa: ABC-123 · estado: descanso' });
    expect(t.avisos.join(' ')).toContain('POST /admin/motorizados/7');
    expect((prep as Json).params.metodo).toBe('POST');
    expect(llamadas.map((l) => l.method)).toEqual(['GET']);

    // «Hacerlo»: la misma ruta que la pantalla, con el body tal cual.
    const e = await hacer.ejecutar((prep as Json).params, ctx);
    expect(e.ok).toBe(true);
    expect(llamadas.at(-1)).toEqual({ method: 'POST', url: '/admin/motorizados/7', body: { placa: 'ABC-123', estado: 'descanso' } });
  });

  it('un DELETE avisa claro y va sin body; si el id no existe, «no»', async () => {
    const { ctx, llamadas } = ctxFalso({ respuestas: { 'GET /admin/motorizados': motos } });
    const prep = (await prepararAccion(hacer, params(hacer, { metodo: 'DELETE', ruta: '/admin/motorizados/7' }), ctx)) as Json;
    expect(prep.tipo).toBe('listo');
    expect(prep.tarjeta.avisos.join(' ')).toMatch(/BORRADO/);
    expect(prep.tarjeta).toMatchObject({ aQuien: 'Carlos Rojas', despues: 'borrado' });
    await hacer.ejecutar(prep.params, ctx);
    expect(llamadas.at(-1)).toEqual({ method: 'DELETE', url: '/admin/motorizados/7' });

    const no = await prepararAccion(hacer, params(hacer, { metodo: 'DELETE', ruta: '/admin/motorizados/99' }), ctx);
    expect(no).toMatchObject({ tipo: 'no', resumen: expect.stringContaining('99') });
    // DELETE con datos: no.
    expect((await prepararAccion(hacer, params(hacer, { metodo: 'DELETE', ruta: '/admin/motorizados/7', datos: { x: 1 } }), ctx)).tipo).toBe('no');
  });

  it('un error de la ruta se devuelve en palabras', async () => {
    const { ctx } = ctxFalso({ respuestas: { 'POST /admin/motorizados/7': { status: 404, json: { error: 'Ese motorizado no existe.' } } } });
    const e = await hacer.ejecutar(params(hacer, { metodo: 'POST', ruta: '/admin/motorizados/7', datos: { placa: 'X' } }), ctx);
    expect(e).toMatchObject({ ok: false, resumen: 'Ese motorizado no existe.' });
  });
});

// --------------------------------------------------- lo que se devuelve

describe('panel.consultar: sin secretos y recortado', () => {
  it('quita campos de credenciales a cualquier profundidad y recorta', async () => {
    const grande = {
      token: 'EAAxxx',
      estado: { accessToken: 'x', apiKey: 'y', tieneToken: true, nombre: 'ok', hijos: [{ password: 'p', clientSecret: 's', pin: '123456', clave: 'e:12', otra: 'x'.repeat(900) }] },
      items: Array.from({ length: 400 }, (_, i) => ({ id: i, nombre: `Cliente ${i}`, webhookSecret: 'w', hash: 'h' })),
    };
    const { ctx } = ctxFalso({ respuestas: { 'GET /admin/envio-automatico': { status: 200, json: grande } } });
    const r = await consultar.ejecutar({ ruta: '/admin/envio-automatico' }, ctx);
    expect(r.ok).toBe(true);
    const s = JSON.stringify(r.datos);
    expect(s.length).toBeLessThanOrEqual(5100);
    for (const x of ['EAAxxx', 'accessToken', 'apiKey', 'tieneToken', 'password', 'clientSecret', 'webhookSecret', '"hash"', '"pin"', '"token"']) expect(s).not.toContain(x);
    expect(s).toContain('"idRuta":"e:12"');
    expect(s).toContain('Cliente 0');
    expect(r.resumen).toContain('items: 400');
  });

  it('limpiarDatos y recortar', () => {
    expect(limpiarDatos({ a: { b: { secretKey: 1, c: 2 } } })).toEqual({ a: { b: { c: 2 } } });
    expect(JSON.stringify(recortar({ l: Array.from({ length: 5000 }, (_, i) => `fila larga ${i} `.repeat(20)) }, 3000)).length).toBeLessThanOrEqual(3100);
  });

  it('una consulta solo hace un GET a la ruta pedida, con su query', async () => {
    const { ctx, llamadas } = ctxFalso();
    await consultar.ejecutar({ ruta: '/admin/chat/conversations?q=Ana&limit=5' }, ctx);
    expect(llamadas).toEqual([{ method: 'GET', url: '/admin/chat/conversations?q=Ana&limit=5' }]);
    // Un GET a una ruta que solo existe para cambiar: no.
    expect((await consultar.ejecutar({ ruta: '/admin/entregas/sincronizar' }, ctx)).ok).toBe(false);
  });
});

// ------------------------------------------------ de punta a punta, con el servidor

const bloque = (...acciones: Array<Record<string, unknown>>) => `Listo, revisa la tarjeta.\n[ACCIONES]\n${acciones.map((a) => JSON.stringify(a)).join('\n')}\n[/ACCIONES]`;

async function sesion(app: FastifyInstance, rol: 'admin' | 'operador' = 'admin'): Promise<Record<string, string>> {
  const primera = await app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { usuario: 'ali', nombre: 'Ali', clave: 'ali-2026-wa' } });
  let cookie = (primera.headers['set-cookie'] as string | string[] | undefined) ?? '';
  if (!cookie || primera.statusCode >= 400) {
    const entrar = await app.inject({ method: 'POST', url: '/login', payload: { usuario: 'ali', clave: 'ali-2026-wa' } });
    cookie = (entrar.headers['set-cookie'] as string | string[] | undefined) ?? '';
  }
  const galleta = (Array.isArray(cookie) ? (cookie[0] ?? '') : cookie).split(';')[0]!;
  if (rol === 'admin') return { cookie: galleta, 'content-type': 'application/json' };
  await app.inject({ method: 'POST', url: '/admin/usuarios', headers: { cookie: galleta, 'content-type': 'application/json' }, payload: { usuario: 'ope', nombre: 'Operadora', clave: 'ope-2026-wa', rol: 'operador' } });
  const entrar = await app.inject({ method: 'POST', url: '/login', payload: { usuario: 'ope', clave: 'ope-2026-wa' } });
  const c = (entrar.headers['set-cookie'] as string | string[] | undefined) ?? '';
  return { cookie: (Array.isArray(c) ? (c[0] ?? '') : c).split(';')[0]!, 'content-type': 'application/json' };
}

const abiertos: Array<{ cerrar(): Promise<void> }> = [];
afterEach(async () => {
  while (abiertos.length) await abiertos.pop()!.cerrar();
});

async function tienda(): Promise<EscenarioEntregas & { h: Record<string, string> }> {
  const esc = await crearEscenarioEntregas({ agente: true });
  abiertos.push(esc);
  await esc.asistente!.guardar({ token: 'tok' });
  const h = await sesion(esc.app);
  return Object.assign(esc, { h });
}

async function ordenar(t: EscenarioEntregas & { h: Record<string, string> }, texto: string, ...respuestas: string[]): Promise<Json> {
  t.ia.respuestas.push(...respuestas);
  const r = await t.app.inject({ method: 'POST', url: '/admin/ia/ordenes', headers: t.h, payload: { texto } });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}

describe('de punta a punta: nada cambia hasta «Hacerlo»', () => {
  it('«agrega al motorizado Zoe»: mapa -> tarjeta -> Hacerlo -> dado de alta por la misma ruta', async () => {
    const t = await tienda();
    const j = await ordenar(
      t,
      'agrega al motorizado Zoe Paz, 999 000 009, placa ZP-100',
      bloque({ accion: 'panel.mapa', seccion: 'motorizados' }),
      bloque({ accion: 'panel.hacer', metodo: 'POST', ruta: '/admin/motorizados', datos: { telefono: '51999000009', nombre: 'Zoe Paz', placa: 'ZP-100' } }),
      'Te dejé lista el alta de Zoe: pulsa Hacerlo.',
    );
    expect(j.hechas.map((h: Json) => [h.accion, h.ok])).toEqual([['panel.mapa', true]]);
    expect(j.pendientes).toHaveLength(1);
    expect(j.pendientes[0]).toMatchObject({ accion: 'panel.hacer', peligrosa: true, tarjeta: { que: 'Motorizados: dar de alta un motorizado', despues: expect.stringContaining('nombre: Zoe Paz') } });
    const antes = (await t.api.get<{ motorizados: Json[] }>('/admin/motorizados')).body.motorizados;
    expect(antes.find((m) => m.nombre === 'Zoe Paz')).toBeUndefined();

    const r = await t.app.inject({ method: 'POST', url: '/admin/ia/ordenes/confirmar', headers: t.h, payload: { acciones: j.pendientes.map((p: Json) => ({ accion: p.accion, ...p.parametros })), orden: 'agrega al motorizado Zoe' } });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().hechas[0]).toMatchObject({ accion: 'panel.hacer', ok: true });
    const despues = (await t.api.get<{ motorizados: Json[] }>('/admin/motorizados')).body.motorizados;
    expect(despues.find((m) => m.nombre === 'Zoe Paz')).toMatchObject({ placa: 'ZP-100' });
    expect(t.repos._actividad.find((e) => e.accion === 'ia.hecho')).toBeTruthy();
  });

  it('pedir las claves de API por la via general no llega a la ruta; ni cambiando los parametros al confirmar', async () => {
    const t = await tienda();
    const j = await ordenar(t, 'dame las claves de api', bloque({ accion: 'panel.consultar', ruta: '/admin/../admin/claves-api' }), 'No puedo.');
    expect(j.hechas[0]).toMatchObject({ accion: 'panel.consultar', ok: false });
    // Alguien reescribe la tarjeta en el navegador: ejecutar lo vuelve a comprobar.
    const r = await t.app.inject({ method: 'POST', url: '/admin/ia/ordenes/confirmar', headers: t.h, payload: { acciones: [{ accion: 'panel.hacer', metodo: 'POST', ruta: '/admin/claves-api', datos: { nombre: 'x' } }] } });
    expect(r.json().hechas[0]).toMatchObject({ ok: false });
    const claves = await t.app.inject({ method: 'GET', url: '/admin/claves-api', headers: t.h });
    expect(JSON.stringify(claves.json())).not.toContain('"x"');
  });

  it('un operador no cambia los ajustes generales por la via general', async () => {
    const t = await tienda();
    const op = await sesion(t.app, 'operador');
    t.ia.respuestas.push(bloque({ accion: 'panel.hacer', metodo: 'POST', ruta: '/admin/ajustes', datos: { nombreNegocio: 'Otro' } }), 'No puedes.');
    const r = await t.app.inject({ method: 'POST', url: '/admin/ia/ordenes', headers: op, payload: { texto: 'cambia el nombre del negocio a Otro' } });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().pendientes).toEqual([]);
    expect(r.json().hechas[0]).toMatchObject({ accion: 'panel.hacer', ok: false, resumen: expect.stringContaining('administrador') });
  });
});
