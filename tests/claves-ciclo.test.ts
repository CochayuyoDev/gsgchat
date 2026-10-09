import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, type EscenarioEntregas } from './escenario-entregas.js';
import { hashClave } from '../src/auth/usuarios.js';
import { CLAVE_API_PRUEBA } from './fakes.js';
let esc: EscenarioEntregas, cookie: string;
beforeAll(async () => {
  esc = await crearEscenarioEntregas();
  await esc.repos.usuarios.crear({ usuario: 'keyadmin', nombre: 'Admin', rol: 'admin', clave: hashClave('prueba-claves-123') });
  const r = await esc.app.inject({ method: 'POST', url: '/login', payload: { usuario: 'keyadmin', clave: 'prueba-claves-123' } });
  cookie = String(r.headers['set-cookie']).split(';')[0]!;
});
afterAll(async () => esc.cerrar());
const panel = (method: 'POST' | 'PATCH' | 'GET', url: string, payload?: object) => esc.app.inject({ method, url, headers: { cookie }, payload });
const crear = async (extra = {}) => (await panel('POST', '/admin/claves-api', { nombre: 'GSG prueba', permisos: ['entregas:leer'], ...extra })).json();
const usar = (clave: string) => esc.app.inject({ url: '/api/v1/entregas', headers: { 'x-api-key': clave } });

describe('ciclo de vida de claves API', () => {
  it('solo entrega el secreto al crear y usa permisos mínimos', async () => {
    const r = await panel('POST', '/admin/claves-api', { nombre: 'Solo lectura' });
    expect(r.statusCode).toBe(200); expect(r.headers['cache-control']).toBe('no-store');
    const k = r.json(); expect(k.registro.permisos).toEqual(['entregas:leer']);
    expect((await usar(k.clave)).statusCode).toBe(200);
    expect((await panel('GET', '/admin/claves-api')).body).not.toContain(k.clave);
    expect(k.registro).not.toHaveProperty('hash');
  });
  it('desactiva y reactiva el acceso; editar no devuelve el secreto', async () => {
    const k = await crear(); const url = '/admin/claves-api/' + k.registro.id;
    expect((await panel('PATCH', url, { activo: false })).statusCode).toBe(200);
    expect((await usar(k.clave)).statusCode).toBe(401);
    const edit = await panel('PATCH', url, { nombre: 'Nueva etiqueta', permisos: ['entregas:gestionar'] });
    expect(edit.json()).not.toHaveProperty('clave');
    expect((await panel('PATCH', url, { activo: true })).statusCode).toBe(200);
    expect((await usar(k.clave)).statusCode).toBe(403);
  });
  it('renueva y la clave anterior deja de funcionar; conserva desactivación', async () => {
    const k = await crear(); const url = '/admin/claves-api/' + k.registro.id;
    await panel('PATCH', url, { activo: false });
    const n = (await panel('POST', url + '/renovar', {})).json();
    expect(n.clave).not.toBe(k.clave);
    expect((await usar(k.clave)).statusCode).toBe(401);
    expect((await usar(n.clave)).statusCode).toBe(401);
    await panel('PATCH', url, { activo: true });
    expect((await usar(n.clave)).statusCode).toBe(200);
  });
  it('elimina con nombre exacto y nunca permite recuperarla', async () => {
    const k = await crear(); const url = '/admin/claves-api/' + k.registro.id;
    expect((await panel('POST', url + '/eliminar', { nombre: 'incorrecto' })).statusCode).toBe(404);
    expect((await usar(k.clave)).statusCode).toBe(200);
    expect((await panel('POST', url + '/eliminar', { nombre: k.registro.nombre })).statusCode).toBe(200);
    expect((await usar(k.clave)).statusCode).toBe(401);
    expect((await panel('GET', '/admin/claves-api')).body).not.toContain(k.registro.id);
    expect((await panel('PATCH', url, { activo: true })).statusCode).toBe(404);
    expect((await panel('POST', url + '/renovar', {})).statusCode).toBe(404);
  });
  it('una revocada histórica no se reactiva ni renueva', async () => {
    const k = await crear(); const url = '/admin/claves-api/' + k.registro.id;
    await esc.app.inject({ method: 'DELETE', url, headers: { cookie } });
    expect((await panel('PATCH', url, { activo: true })).statusCode).toBe(404);
    expect((await panel('POST', url + '/renovar', {})).statusCode).toBe(404);
  });
  it('valida nombres, permisos y vencimientos y rechaza claves vencidas', async () => {
    for (const extra of [{ nombre: '' }, { permisos: [] }, { permisos: [' '] }, { permisos: ['inventado'] }, { venceAt: '2020-01-01T00:00:00Z' }]) {
      expect((await panel('POST', '/admin/claves-api', { nombre: 'Prueba', ...extra })).statusCode).toBe(400);
    }
    const k = await crear({ venceAt: new Date(Date.now() + 60000).toISOString() });
    expect(k.registro.venceAt).toBeTruthy();
    const row = esc.repos._claves.find(c => c.id === k.registro.id)!;
    row.venceAt = new Date(0);
    expect((await usar(k.clave)).statusCode).toBe(401);
  });
  it('no admite administración desde claves API ni desde otro origen', async () => {
    expect((await esc.app.inject({ method: 'POST', url: '/admin/claves-api', headers: { 'x-api-key': CLAVE_API_PRUEBA }, payload: { nombre: 'No permitido' } })).statusCode).toBe(403);
    expect((await esc.app.inject({ method: 'POST', url: '/admin/claves-api', headers: { cookie, origin: 'https://otro.example' }, payload: { nombre: 'No permitido' } })).statusCode).toBe(403);
    expect((await panel('PATCH', '/admin/claves-api/otra-cuenta', { activo: true })).statusCode).toBe(404);
  });
  it('limita intentos de autenticación antes de consultar la clave', async () => {
    const apiKey = 'a'.repeat(48);
    let ultimo;
    for (let i = 0; i < 121; i++) ultimo = await esc.app.inject({ url: '/api/v1/entregas', remoteAddress: '192.0.2.123', headers: { 'x-api-key': apiKey } });
    expect(ultimo!.statusCode).toBe(429);
    expect(Number(ultimo!.headers['retry-after'])).toBeGreaterThan(0);
  });
});
