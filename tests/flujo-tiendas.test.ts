/**
 * Cada tienda de la plataforma ve SU flujo de GSGchat en el Inicio: su nombre,
 * su WhatsApp y sus pedidos del día, sin mezclarse con los de otra tienda. Y
 * lo ve cualquiera del equipo (administrador u operador), no solo el dueño.
 *
 * Dos tiendas de producción (armarTienda con su base MySQL de prueba cada
 * una) con un WhatsApp falso.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { armarTienda, type TiendaViva } from '../src/plataforma/tienda.js';
import { bootstrapSecrets } from '../src/settings/crypto.js';
import { createFakeWhatsApp } from './fakes.js';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';
import { OBLIGATORIOS_GSG } from './escenario-entregas.js';

const LENTO = Number(process.env.GSG_PRUEBAS_LENTO) || 1;

interface TiendaDePrueba {
  tienda: TiendaViva;
  base: BaseDePrueba;
  raiz: string;
  cookie: string;
  api: (method: 'GET' | 'POST', url: string, payload?: unknown, cookie?: string) => Promise<{ status: number; body: any; texto: string }>;
}

async function tiendaDePrueba(slug: string, nombre: string): Promise<TiendaDePrueba> {
  const base = await baseDePrueba();
  const raiz = mkdtempSync(path.join(tmpdir(), `flujo-${slug}-`));
  const secretos = bootstrapSecrets(raiz);
  const tienda = await armarTienda({
    id: slug,
    slug,
    env: {
      PUBLIC_BASE_URL: 'http://localhost:0',
      DATABASE_URL: base.url,
      TRACKING_SECRET: secretos.trackingSecret,
      WHATSAPP_PROVIDER: 'local',
      DEV_SIMULATE_INBOUND: 'true',
      RAFAGA_MS: '0',
      TIMEZONE: 'America/Lima',
      RUTAS_HORA_INICIO: '0',
      RUTAS_HORA_FIN: '24',
      HORARIO_ENVIO_INICIO: '0',
      HORARIO_ENVIO_FIN: '24',
    } as NodeJS.ProcessEnv,
    secretos,
    base: { url: base.url, base: base.base },
    authDir: path.join(raiz, 'auth'),
    mediaDir: path.join(raiz, 'medios'),
    carpetaCopias: path.join(raiz, 'copias'),
    primeraCuentaRol: 'superadmin',
    autoConectarLocal: false,
    sembrarPlantillasLocales: true,
    prefijoLog: `[${slug}] `,
    waParaPruebas: createFakeWhatsApp(),
  });
  const alta = await tienda.app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { nombre: 'Dueño ' + nombre, usuario: 'dueno', clave: 'clave-dueno-2026' } });
  const cookie = String(alta.headers['set-cookie']).split(';')[0]!;
  const api: TiendaDePrueba['api'] = async (method, url, payload, otra) => {
    const r = await tienda.app.inject({ method, url, headers: { cookie: otra ?? cookie, ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) }, payload: payload === undefined ? undefined : JSON.stringify(payload) });
    let body: any = {};
    try {
      body = r.body ? JSON.parse(r.body) : {};
    } catch {
      body = {};
    }
    return { status: r.statusCode, body, texto: r.body };
  };
  expect((await api('POST', '/admin/ajustes', { nombreNegocio: nombre })).status).toBe(200);
  return { tienda, base, raiz, cookie, api };
}

describe('todas las tiendas ven su propio flujo de GSGchat', () => {
  let a: TiendaDePrueba;
  let b: TiendaDePrueba;

  beforeAll(async () => {
    a = await tiendaDePrueba('flujo-rosa', 'Bodega Rosa');
    b = await tiendaDePrueba('flujo-lima', 'Courier Lima');
  }, 240_000 * LENTO);

  afterAll(async () => {
    for (const t of [a, b]) {
      if (!t) continue;
      await t.tienda.parar();
      await t.base.cerrar();
      rmSync(t.raiz, { recursive: true, force: true });
    }
  });

  it('el Inicio de cada tienda trae el diagrama', async () => {
    for (const t of [a, b]) {
      const panel = await t.api('GET', '/panel');
      expect(panel.status).toBe(200);
      expect(panel.texto).toContain('id="flujo-gsg"');
      expect(panel.texto).toContain('Flujo de GSGchat');
    }
  });

  it('cada una con su empresa y sus pedidos, sin mezclarse', async () => {
    // Como en la calle: la tienda crea la clave de GSG en «Nuestra API» y GSG manda sus pedidos con ella.
    const clave = await a.api('POST', '/admin/claves-api', { nombre: 'GSG', permisos: ['entregas:gestionar', 'entregas:leer'] });
    expect(clave.status, clave.texto).toBe(200);
    const alta = await a.tienda.app.inject({
      method: 'POST',
      url: '/api/v1/entregas',
      headers: { 'x-api-key': clave.body.clave, 'content-type': 'application/json' },
      payload: JSON.stringify({ pedidos: [{ ...OBLIGATORIOS_GSG, tracking: 'ROSA-1', cliente: 'Ana', telefono: '987500001' }, { ...OBLIGATORIOS_GSG, tracking: 'ROSA-2', cliente: 'Luis', telefono: '987500002' }] }),
    });
    expect(alta.statusCode, alta.body).toBeLessThan(300);

    const fa = await a.api('GET', '/admin/flujo');
    const fb = await b.api('GET', '/admin/flujo');
    expect(fa.status).toBe(200);
    expect(fb.status).toBe(200);
    expect(fa.body.empresa.nombre).toBe('Bodega Rosa');
    expect(fb.body.empresa.nombre).toBe('Courier Lima');
    expect(fa.body.cifras.recibidos).toBe(2);
    expect(fb.body.cifras.recibidos).toBe(0);
    expect(fa.body.whatsapp.lineas.length).toBeGreaterThanOrEqual(1);
    expect(fb.body.whatsapp.lineas.length).toBeGreaterThanOrEqual(1);
  }, 60_000 * LENTO);

  it('lo ve también un operador, no solo el administrador', async () => {
    const creado = await a.api('POST', '/admin/usuarios', { nombre: 'Rosa', usuario: 'rosa-op', clave: 'rosa-clave-2026', rol: 'operador' });
    expect(creado.status, creado.texto).toBeLessThan(300);
    const login = await a.tienda.app.inject({ method: 'POST', url: '/login', payload: { usuario: 'rosa-op', clave: 'rosa-clave-2026' } });
    expect(login.statusCode).toBe(200);
    const cookieOp = String(login.headers['set-cookie']).split(';')[0]!;
    const flujo = await a.api('GET', '/admin/flujo', undefined, cookieOp);
    expect(flujo.status).toBe(200);
    expect(flujo.body.empresa.nombre).toBe('Bodega Rosa');
    const panel = await a.api('GET', '/panel', undefined, cookieOp);
    expect(panel.texto).toContain('id="flujo-gsg"');
  });

  it('sin sesión no se ve el flujo de nadie', async () => {
    const r = await a.tienda.app.inject({ method: 'GET', url: '/admin/flujo' });
    expect(r.statusCode).toBe(401);
  });
});
