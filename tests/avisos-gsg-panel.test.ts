/**
 * Pedido de GSG (11/11): «que agregue mensaje.estado a los eventos del webhook
 * de GSG en el panel de GSGchat». En «Nuestra API → Avisos a GSG» se ven los
 * webhooks y se eligen sus eventos; el cambio vale al instante.
 */
import { describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, type EscenarioEntregas } from './escenario-entregas.js';
import { loadConfig } from '../src/config.js';
import { hashClave } from '../src/auth/usuarios.js';
import { COOKIE_SESION, firmarSesion } from '../src/auth/sesion.js';
import { secretoDeSesion } from '../src/auth/routes.js';

/** La cookie de sesión de un administrador del panel (como en archivos-historial-gsg.test.ts). */
async function cookieDeAdmin(e: EscenarioEntregas): Promise<string> {
  const config = loadConfig({ PUBLIC_BASE_URL: 'http://localhost:3000', DATABASE_URL: 'mysql://x/y', TIMEZONE: 'America/Lima', TRACKING_SECRET: 'x'.repeat(40) });
  const usuario = await e.repos.usuarios.crear({ usuario: 'adminavisos', nombre: 'Admin', rol: 'admin', clave: hashClave('Clave-123-segura') });
  return `${COOKIE_SESION}=${firmarSesion(secretoDeSesion(config), { u: usuario.id, v: usuario.sesionVersion })}`;
}

const crearHook = (e: EscenarioEntregas, eventos: string[]) =>
  e.repos.webhooks.crear({ url: 'https://gsg.example/hook', descripcion: 'GSG', secreto: 's', eventos, creadoPor: null });

describe('Avisos a GSG en el panel', () => {
  it('lista los webhooks con el catálogo, que incluye mensaje.estado', async () => {
    const e = await crearEscenarioEntregas();
    try {
      const cookie = await cookieDeAdmin(e);
      await crearHook(e, ['entrega.confirmada']);
      const r = await e.app.inject({ url: '/admin/webhooks-gsg', headers: { cookie } });
      expect(r.statusCode).toBe(200);
      expect(r.json().webhooks).toHaveLength(1);
      expect(r.json().eventos.map((x: { nombre: string }) => x.nombre)).toContain('mensaje.estado');
    } finally {
      await e.cerrar();
    }
  });

  it('agrega mensaje.estado a un webhook existente y desde ese momento lo recibe', async () => {
    const e = await crearEscenarioEntregas();
    try {
      const cookie = await cookieDeAdmin(e);
      const w = await crearHook(e, ['entrega.confirmada']);
      expect((await e.repos.webhooks.activosPara('mensaje.estado')).map((x) => x.id)).not.toContain(w.id);
      const r = await e.app.inject({ method: 'POST', url: `/admin/webhooks-gsg/${w.id}/eventos`, headers: { cookie }, payload: { eventos: ['entrega.confirmada', 'mensaje.estado'] } });
      expect(r.statusCode).toBe(200);
      expect(r.json().webhook.eventos).toEqual(['entrega.confirmada', 'mensaje.estado']);
      expect((await e.repos.webhooks.activosPara('mensaje.estado')).map((x) => x.id)).toContain(w.id);
    } finally {
      await e.cerrar();
    }
  });

  it('rechaza eventos que no existen, la lista vacía y un webhook que no existe, con el motivo', async () => {
    const e = await crearEscenarioEntregas();
    try {
      const cookie = await cookieDeAdmin(e);
      const w = await crearHook(e, ['*']);
      const malo = await e.app.inject({ method: 'POST', url: `/admin/webhooks-gsg/${w.id}/eventos`, headers: { cookie }, payload: { eventos: ['mensaje.inventado'] } });
      expect(malo.statusCode).toBe(400);
      expect(malo.json().error).toMatch(/mensaje\.inventado/);
      const vacio = await e.app.inject({ method: 'POST', url: `/admin/webhooks-gsg/${w.id}/eventos`, headers: { cookie }, payload: { eventos: [] } });
      expect(vacio.statusCode).toBe(400);
      const otro = await e.app.inject({ method: 'POST', url: '/admin/webhooks-gsg/no-existe/eventos', headers: { cookie }, payload: { eventos: ['mensaje.estado'] } });
      expect(otro.statusCode).toBe(404);
    } finally {
      await e.cerrar();
    }
  });

  it('sin una sesión de administrador no deja ver ni cambiar nada', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await cookieDeAdmin(e); // con cuentas creadas, el panel exige sesión
      const w = await crearHook(e, ['entrega.confirmada']);
      // Sin sesión: el panel corta antes (401).
      expect((await e.app.inject({ url: '/admin/webhooks-gsg' })).statusCode).toBe(401);
      expect((await e.app.inject({ method: 'POST', url: `/admin/webhooks-gsg/${w.id}/eventos`, payload: { eventos: ['mensaje.estado'] } })).statusCode).toBe(401);
      // Con sesión de operador (no administrador): 403.
      const config = loadConfig({ PUBLIC_BASE_URL: 'http://localhost:3000', DATABASE_URL: 'mysql://x/y', TIMEZONE: 'America/Lima', TRACKING_SECRET: 'x'.repeat(40) });
      const op = await e.repos.usuarios.crear({ usuario: 'operadoravisos', nombre: 'Op', rol: 'operador', clave: hashClave('Clave-123-segura') });
      const cookieOp = `${COOKIE_SESION}=${firmarSesion(secretoDeSesion(config), { u: op.id, v: op.sesionVersion })}`;
      expect((await e.app.inject({ url: '/admin/webhooks-gsg', headers: { cookie: cookieOp } })).statusCode).toBe(403);
      const r = await e.app.inject({ method: 'POST', url: `/admin/webhooks-gsg/${w.id}/eventos`, headers: { cookie: cookieOp }, payload: { eventos: ['mensaje.estado'] } });
      expect(r.statusCode).toBe(403);
      expect((await e.repos.webhooks.obtener(w.id))!.eventos).toEqual(['entrega.confirmada']);
    } finally {
      await e.cerrar();
    }
  });
});
