/**
 * La bitacora: que cada accion que cambia algo quede apuntada sola, con quien
 * la hizo y sin secretos; que las lecturas y lo que falla no; y que solo un
 * administrador de carne y hueso la lea.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { accionDe, detalleSeguro, ETIQUETAS } from '../src/auth/actividad.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp, type FakeRepos, CLAVE_API_PRUEBA } from './fakes.js';

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

function cookieDe(res: { headers: Record<string, unknown> }): string {
  const set = res.headers['set-cookie'];
  const linea = Array.isArray(set) ? set[0] : (set as string | undefined);
  return (linea as string).split(';')[0]!;
}

describe('que se apunta y como', () => {
  it('cada ruta que cambia algo tiene su codigo; las lecturas y las ruidosas no', () => {
    expect(accionDe('POST', '/login')).toBe('entrar');
    expect(accionDe('POST', '/admin/usuarios/:id')).toBe('usuario.cambiar');
    expect(accionDe('DELETE', '/admin/claves-api/:id')).toBe('clave.revocar');
    expect(accionDe('POST', '/admin/rutas/lotes')).toBe('lote.crear');
    expect(accionDe('POST', '/admin/rutas/previsualizar')).toBeNull();
    expect(accionDe('POST', '/admin/chat/:contactId/read')).toBeNull();
    expect(accionDe('POST', '/admin/lo-que-sea')).toBe('otro');
    // Pausar/parar una campana, el bot por chat y los borrados del asistente
    // salian como "Otra accion" (visto el 2026-09-17).
    expect(accionDe('POST', '/admin/campaigns/:id/estado')).toBe('campana.estado');
    expect(accionDe('POST', '/admin/chat/:contactId/bot')).toBe('chat.bot');
    expect(accionDe('DELETE', '/admin/automation/rules/:id')).toBe('automatizacion.regla.borrar');
    expect(accionDe('PUT', '/admin/leads/:contactId')).toBe('ficha');
    expect(accionDe('POST', '/admin/ia/ayuda')).toBeNull();
    expect(accionDe('POST', '/admin/ia')).toBe('ia.configurar');
    for (const accion of ['campana.estado', 'chat.bot', 'chat.adjunto', 'solicitud.cambiar', 'respaldo.borrar', 'rastreo.cerrar', 'dev.simular']) expect(ETIQUETAS[accion]).toBeTruthy();
    expect(accionDe('POST', '/webhooks/whatsapp')).toBeNull();
    for (const accion of ['entrar', 'lote.crear', 'ajustes.guardar', 'otro']) expect(ETIQUETAS[accion]).toBeTruthy();
  });

  it('el detalle nunca lleva contrasenas, tokens ni claves, y recorta los textos largos', () => {
    const d = detalleSeguro({ usuario: 'ali', clave: 'secreta', token: 'x', appSecret: 'y', nombre: 'a'.repeat(200), lista: [1, 2, 3], obj: { a: 1 }, n: 3, ok: true }, { id: '7' });
    expect(d).toMatchObject({ id: '7', usuario: 'ali', lista: '[3]', obj: '{...}', n: 3, ok: true });
    expect(d).not.toHaveProperty('clave');
    expect(d).not.toHaveProperty('token');
    expect(d).not.toHaveProperty('appSecret');
    expect((d!.nombre as string).length).toBe(120);
    expect(detalleSeguro(undefined)).toBeNull();
    // Cambiar la contraseña manda { actual, nueva }: ninguna puede quedar en la bitacora.
    expect(detalleSeguro({ actual: 'vieja-123', nueva: 'nueva-456', contrasena: 'x', pin: '1234' })).toBeNull();
  });
});

describe('/admin/actividad', () => {
  let app: FastifyInstance;
  let repos: FakeRepos;
  let admin = '';

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

  it('apunta la primera cuenta, un login fallido, la creacion de un usuario y una pausa, sin secretos', async () => {
    admin = cookieDe(await app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { nombre: 'Ali', usuario: 'ali', clave: 'clave-segura-1' } }));
    await app.inject({ method: 'POST', url: '/login', payload: { usuario: 'ali', clave: 'mala' }, remoteAddress: '10.0.0.7' });
    await app.inject({ method: 'POST', url: '/admin/usuarios', headers: { cookie: admin }, payload: { nombre: 'Rosa', usuario: 'rosa', clave: 'rosa-clave-1' } });
    await app.inject({ method: 'POST', url: '/admin/pause', headers: { cookie: admin }, payload: { paused: true, reason: 'prueba' } });
    // Una lectura no deja rastro.
    await app.inject({ method: 'GET', url: '/admin/health', headers: { cookie: admin } });

    const res = await app.inject({ method: 'GET', url: '/admin/actividad', headers: { cookie: admin } });
    expect(res.statusCode).toBe(200);
    const r = res.json() as { items: Array<{ accion: string; usuario: string; detalle: Record<string, unknown> | null; ip: string | null }>; total: number; acciones: string[]; etiquetas: Record<string, string> };
    const acciones = r.items.map((i) => i.accion);
    expect(acciones).toEqual(['envios.pausa', 'usuario.crear', 'entrar.fallido', 'cuenta.primera']);
    expect(r.acciones).toContain('usuario.crear');
    expect(r.etiquetas['usuario.crear']).toBe('Creo un usuario');
    const creado = r.items.find((i) => i.accion === 'usuario.crear')!;
    expect(creado.usuario).toBe('Ali');
    expect(creado.detalle).toMatchObject({ nombre: 'Rosa', usuario: 'rosa' });
    expect(creado.detalle).not.toHaveProperty('clave');
    const fallido = r.items.find((i) => i.accion === 'entrar.fallido')!;
    expect(fallido.usuario).toBe('ali');
    expect(fallido.ip).toBe('10.0.0.7');
    expect(JSON.stringify(r)).not.toContain('clave-segura-1');
    expect(JSON.stringify(r)).not.toContain('rosa-clave-1');
  });

  it('se filtra por accion y por quien, y pagina', async () => {
    const porAccion = (await app.inject({ method: 'GET', url: '/admin/actividad?accion=usuario.crear', headers: { cookie: admin } })).json();
    expect(porAccion.total).toBe(1);
    const porQuien = (await app.inject({ method: 'GET', url: '/admin/actividad?usuario=ali&limit=2', headers: { cookie: admin } })).json();
    expect(porQuien.items).toHaveLength(2);
    expect(porQuien.total).toBeGreaterThanOrEqual(3);
  });

  it('un operador o una clave de API no la leen', async () => {
    const rosa = cookieDe(await app.inject({ method: 'POST', url: '/login', payload: { usuario: 'rosa', clave: 'rosa-clave-1' }, remoteAddress: '10.0.0.8' }));
    expect((await app.inject({ method: 'GET', url: '/admin/actividad', headers: { cookie: rosa } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/admin/actividad', headers: { authorization: `Bearer ${CLAVE_API_PRUEBA}` } })).statusCode).toBe(403);
    // Pero su entrada si quedo apuntada, con su nombre.
    const r = (await app.inject({ method: 'GET', url: '/admin/actividad?accion=entrar', headers: { cookie: admin } })).json();
    expect(r.items[0]).toMatchObject({ usuario: 'Rosa', accion: 'entrar' });
  });
});
