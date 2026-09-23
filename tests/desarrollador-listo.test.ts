/**
 * «¿Está listo para GSG?» del Modulo desarrollador, sobre una tienda de verdad
 * (armarTienda: base PGlite, API, cola, simulador) con un WhatsApp de mentira.
 *
 * Lo que tiene que cumplir:
 *  - con todo en orden, el recorrido entero da verde y dice «Listo…»;
 *  - un fallo (un GSG que rechaza lo que se le manda) sale en rojo y en la lista de lo que falta;
 *  - la conexion de la tienda (aqui, una API «real» de mentira) queda exactamente igual
 *    y la API real no recibe NI UNA llamada durante la comprobacion;
 *  - no quedan pedidos, clientes, reportes ni claves temporales de la prueba;
 *  - la lectura contra la API real no se hace sin confirmar, y con confirmacion es solo un GET;
 *  - un operador no entra.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { armarTienda, type TiendaViva } from '../src/plataforma/tienda.js';
import { bootstrapSecrets } from '../src/settings/crypto.js';
import { crearGsgSimulado } from '../src/entregas/gsg-simulado.js';
import { recorrerContrato } from '../src/desarrollador/comprobaciones.js';
import { compararContrato, leerContrato } from '../src/desarrollador/contrato.js';
import { createFakeWhatsApp } from './fakes.js';

describe('Módulo desarrollador: ¿está listo para GSG?', () => {
  let raiz: string;
  let tienda: TiendaViva;
  let cookie: string;
  // La «API real de GSG»: un servidor aparte que apunta cada llamada.
  const llamadasReales: Array<{ metodo: string; ruta: string }> = [];
  let real: http.Server;
  let urlReal: string;

  const api = async (method: 'GET' | 'POST', url: string, payload?: unknown, conCookie = cookie) => {
    const r = await tienda.app.inject({ method, url, headers: { cookie: conCookie, ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) }, payload: payload === undefined ? undefined : JSON.stringify(payload) });
    return { status: r.statusCode, body: r.body ? (JSON.parse(r.body) as Record<string, any>) : {} };
  };
  const sql = async <T = Record<string, unknown>>(q: string, p: unknown[] = []) => (await tienda.pglite!.db.query<T>(q, p)).rows;

  beforeAll(async () => {
    real = http.createServer((req, res) => {
      llamadasReales.push({ metodo: req.method ?? '', ruta: req.url ?? '' });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ faltaUbicacion: [], faltaConfirmacion: [], terminados: [] }));
    });
    await new Promise<void>((r) => real.listen(0, '127.0.0.1', () => r()));
    urlReal = `http://127.0.0.1:${(real.address() as AddressInfo).port}/v1`;

    raiz = mkdtempSync(path.join(tmpdir(), 'dev-listo-'));
    const secretos = bootstrapSecrets(raiz);
    tienda = await armarTienda({
      id: 'listo',
      slug: 'listo',
      env: { PUBLIC_BASE_URL: 'https://chat.gsg.pe', DATABASE_URL: `pglite://${path.join(raiz, 'datos')}`, TRACKING_SECRET: secretos.trackingSecret, WHATSAPP_PROVIDER: 'local', BUSINESS_NAME: 'GSG', TIMEZONE: 'America/Lima', RAFAGA_MS: '0' } as NodeJS.ProcessEnv,
      secretos,
      base: { tipo: 'pglite', dir: path.join(raiz, 'datos') },
      authDir: path.join(raiz, 'auth'),
      mediaDir: path.join(raiz, 'medios'),
      carpetaCopias: path.join(raiz, 'copias'),
      primeraCuentaRol: 'superadmin',
      autoConectarLocal: false,
      sembrarPlantillasLocales: true,
      prefijoLog: '[listo] ',
      waParaPruebas: createFakeWhatsApp(),
    });
    const alta = await tienda.app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { nombre: 'Ali', usuario: 'ali', clave: 'ali-2026-wa' } });
    cookie = String(alta.headers['set-cookie']).split(';')[0]!;
    // Lo que la tienda hace sola con su GSG conectado (y que es lo correcto en
    // produccion) tambien llama a la API real: el motor de entregas pide la
    // lista del dia cada 5 minutos y la prueba de cada manana hace un ping.
    // Aqui se mide SOLO el modulo, asi que esas dos se apartan: con la maquina
    // cargada la prueba pasa de 5 minutos y la sincronizacion caia en medio.
    expect((await api('POST', '/admin/entregas/ajustes', { sincronizarCadaMin: 24 * 60 })).status).toBe(200);
    expect((await api('POST', '/admin/fiabilidad/ajustes', { humo: { activo: false } })).status).toBe(200);
    // La tienda, conectada a su «API real» de GSG.
    const c = await api('POST', '/admin/entregas/gsg', { modo: 'real', url: urlReal, token: 'token-real-de-gsg' });
    expect(c.status).toBe(200);
    llamadasReales.length = 0;
  }, 180_000);

  afterAll(async () => {
    await tienda?.parar();
    await new Promise<void>((r) => real?.close(() => r()));
    rmSync(raiz, { recursive: true, force: true });
  });

  it('el contrato escrito coincide con el código campo por campo', async () => {
    const md = await leerContrato();
    expect(md).toBeTruthy();
    const diferencias = compararContrato(md!).filter((d) => !d.ok);
    expect(diferencias, JSON.stringify(diferencias, null, 2)).toEqual([]);
  });

  it('con todo en orden: verde entero y «Listo para conectar con GSG»', async () => {
    const r = await api('POST', '/admin/desarrollador/listo/comprobar', {});
    expect(r.status).toBe(200);
    const res = r.body.resultado;
    expect(res.faltan, res.faltan.join('\n')).toEqual([]);
    expect(res.listo).toBe(true);
    expect(res.titular).toBe('Listo para conectar con GSG: solo falta pegar la dirección y el token.');
    expect(res.total).toBeGreaterThanOrEqual(30);
    const ids = res.grupos.flatMap((g: { comprobaciones: Array<{ id: string }> }) => g.comprobaciones.map((c) => c.id));
    for (const id of ['sin_clave', 'clave_revocada', 'permiso_faltante', 'json_roto', 'campo_faltante', 'telefono_invalido', 'idempotencia', 'lista_vacia', 'cancelado', 'limite', 'cambiar', 'reporte_ubicacion', 'reporte_confirmacion', 'reporte_entrega', 'reporte_incidencia', 'reintenta_caido', 'reintenta_sin_red', 'rechazado_visible', 'no_duplica', 'prueba_nunca_real', 'webhook_formato', 'webhook_firma', 'webhook_reintentos', 'contrato_descarga']) {
      expect(ids).toContain(id);
    }
    // Y el último resultado se puede volver a ver.
    const u = await api('GET', '/admin/desarrollador/listo/ultimo');
    expect(u.body.resultado.listo).toBe(true);
  }, 180_000);

  it('la conexión de la tienda queda igual y la API real no recibe ninguna llamada', async () => {
    expect(llamadasReales).toEqual([]);
    const g = await api('GET', '/admin/entregas/gsg');
    expect(g.body.gsg).toMatchObject({ modo: 'real', url: urlReal, tieneToken: true, conectada: true });
  });

  it('no deja pedidos, clientes, reportes ni claves temporales de la prueba', async () => {
    expect(await sql("select referencia from entregas where referencia like 'PRUEBA-LISTO-%'")).toEqual([]);
    expect(await sql("select referencia from rutas_solicitudes where referencia like 'PRUEBA-LISTO-%'")).toEqual([]);
    expect(await sql("select id from rutas_reportes where payload->>'referencia' like 'PRUEBA-LISTO-%'")).toEqual([]);
    expect(await sql("select phone from contacts where phone like '5190009%'")).toEqual([]);
    expect(await sql("select nombre from claves_api where nombre like 'Comprobación GSG (temporal)%'")).toEqual([]);
  });

  it('un GSG que rechaza lo que se le manda sale en rojo, en la lista de lo que falta', async () => {
    const sim = crearGsgSimulado({ token: 'comprobacion-listo' });
    const atender = sim.atender.bind(sim);
    sim.atender = (m, ruta, token, cuerpo) => (m === 'POST' && ruta === '/ubicaciones' ? { status: 422, body: { error: 'no aceptamos ubicaciones' } } : atender(m, ruta, token, cuerpo));
    const res = await recorrerContrato({ app: tienda.app, repos: tienda.repos, hayEntregas: true, simuladorDePrueba: sim });
    expect(res.listo).toBe(false);
    const c = res.grupos.flatMap((g) => g.comprobaciones).find((x) => x.id === 'reporte_ubicacion')!;
    expect(c.ok).toBe(false);
    expect(res.faltan.some((f) => f.startsWith('GSG recibe la ubicación'))).toBe(true);
    expect(res.titular).toMatch(/Todavía no está listo/);
    expect(llamadasReales).toEqual([]);
  }, 180_000);

  it('la lectura contra la API real pide confirmación y, confirmada, es solo un GET de la lista del día', async () => {
    const sin = await api('POST', '/admin/desarrollador/listo/ping-real', {});
    expect(sin.status).toBe(400);
    expect(llamadasReales).toEqual([]);
    const con = await api('POST', '/admin/desarrollador/listo/ping-real', { confirmar: true });
    expect(con.status).toBe(200);
    expect(con.body).toMatchObject({ ok: true });
    expect(con.body.detalle).toContain('GSG responde');
    expect(llamadasReales).toEqual([{ metodo: 'GET', ruta: '/v1/reparto/pendientes' }]);
  });

  it('un operador no usa el módulo', async () => {
    const alta = await api('POST', '/admin/usuarios', { nombre: 'Oper', usuario: 'oper', clave: 'oper-2026-wa', rol: 'operador' });
    expect(alta.status).toBe(200);
    const login = await tienda.app.inject({ method: 'POST', url: '/login', payload: { usuario: 'oper', clave: 'oper-2026-wa' } });
    const cOper = String(login.headers['set-cookie']).split(';')[0]!;
    const r = await api('POST', '/admin/desarrollador/listo/comprobar', {}, cOper);
    expect(r.status).toBe(403);
  });
});
