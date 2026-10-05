import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Script } from 'node:vm';
import { crearEscenarioEntregas, type EscenarioEntregas } from './escenario-entregas.js';
import { hashClave } from '../src/auth/usuarios.js';
import { CLAVE_API_PRUEBA } from './fakes.js';
import { EJEMPLO_COURIER } from '../src/web/gsg-courier-page.js';

let esc: EscenarioEntregas;
let cookie: string;
let operador: string;
beforeAll(async () => {
  esc = await crearEscenarioEntregas({ confirmarLista: true });
  for (const [usuario, rol] of [['courieradmin', 'admin'], ['courieroperador', 'operador']] as const) {
    await esc.repos.usuarios.crear({ usuario, nombre: usuario, rol, clave: hashClave('prueba-courier-123') });
    const r = await esc.app.inject({ method: 'POST', url: '/login', payload: { usuario, clave: 'prueba-courier-123' } });
    expect(r.statusCode).toBe(200);
    const sesion = String(r.headers['set-cookie']).split(';')[0]!;
    if (rol === 'admin') cookie = sesion; else operador = sesion;
  }
});
afterAll(async () => { await esc.cerrar(); });

describe('modulo especializado GSG Courier', () => {
  it('protege el modulo y la validacion: administrador humano, nunca una clave', async () => {
    expect((await esc.app.inject('/conexion-gsg')).statusCode).toBe(302);
    expect((await esc.app.inject({ url: '/conexion-gsg', headers: { cookie: operador } })).statusCode).toBe(403);
    expect((await esc.app.inject({ url: '/conexion-gsg', headers: { authorization: 'Bearer ' + CLAVE_API_PRUEBA } })).statusCode).toBe(403);
    expect((await esc.app.inject({ method: 'POST', url: '/admin/gsg-courier/validar', payload: EJEMPLO_COURIER })).statusCode).toBe(401);
    expect((await esc.app.inject({ method: 'POST', url: '/admin/gsg-courier/validar', headers: { cookie: operador }, payload: EJEMPLO_COURIER })).statusCode).toBe(403);
  });
  it('abre la pantalla con script valido y el contrato completo', async () => {
    const r = await esc.app.inject({ url: '/conexion-gsg', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body).toContain('Validar sin encolar');
    expect(r.body).toContain('agenciaDestino');
    for (const m of r.body.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) expect(() => new Script(m[1]!)).not.toThrow();
  });
  it('valida el JSON completo, muestra descartes y duplicados y no crea pedidos ni envia mensajes', async () => {
    const antes = (await esc.resumen()).entregas.length;
    const mensajes = esc.wa.sent.length;
    const validar = (payload: unknown) => esc.app.inject({ method: 'POST', url: '/admin/gsg-courier/validar', headers: { cookie, 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
    const ok = await validar(EJEMPLO_COURIER);
    expect(ok.json()).toMatchObject({ ok: true, validos: 1, guardados: 0 });
    const p = EJEMPLO_COURIER.pedidos[0]!;
    const malo = await validar({ pedidos: [p, p, { ...p, tracking: 'GSG-MALO', telefono: '12' }] });
    expect(malo.json()).toMatchObject({ ok: false, total: 3, validos: 1, repetidas: [p.tracking], descartadas: [{ referencia: 'GSG-MALO', motivo: expect.any(String) }] });
    expect((await validar({ pedidos: Array.from({ length: 601 }, () => p) })).statusCode).toBe(400);
    expect((await validar({ pedidos: [] })).statusCode).toBe(400);
    expect((await esc.resumen()).entregas.length).toBe(antes);
    expect(esc.wa.sent.length).toBe(mensajes);
  });
  it('la clave de Courier permite recepcion; revocarla bloquea pedidos nuevos', async () => {
    const nueva = await esc.app.inject({ method: 'POST', url: '/admin/claves-api', headers: { cookie }, payload: { nombre: 'GSG Courier', permisos: ['entregas:gestionar'] } });
    const { clave, registro } = nueva.json();
    expect(registro.permisos).toEqual(['entregas:gestionar']);
    const recibir = () => esc.app.inject({ method: 'POST', url: '/api/v1/entregas', headers: { authorization: 'Bearer ' + clave }, payload: EJEMPLO_COURIER });
    expect((await recibir()).statusCode).toBe(201);
    expect(esc.wa.sent).toHaveLength(0);
    const listado = await esc.app.inject({ url: '/admin/claves-api', headers: { cookie } });
    expect(listado.body).not.toContain(clave);
    expect((await esc.app.inject({ method: 'DELETE', url: '/admin/claves-api/' + registro.id, headers: { cookie } })).statusCode).toBe(200);
    const revocada = await recibir();
    expect(revocada.statusCode).toBe(401);
    expect(revocada.json()).toMatchObject({ ok: false, codigo: 'CLAVE_REVOCADA' });
  });
});
