import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Script } from 'node:vm';
import { crearEscenarioEntregas, type EscenarioEntregas } from './escenario-entregas.js';
import { hashClave } from '../src/auth/usuarios.js';
import { ACCIONES } from '../src/ia/acciones.js';

let esc: EscenarioEntregas;
const cookies: string[] = [];
beforeAll(async () => {
  esc = await crearEscenarioEntregas({ confirmarLista: true });
  for (const rol of ['superadmin', 'admin', 'operador'] as const) {
    await esc.repos.usuarios.crear({ usuario: 'prueba-' + rol, nombre: rol, rol, clave: hashClave('clave-segura-123') });
    const r = await esc.app.inject({ method: 'POST', url: '/login', payload: { usuario: 'prueba-' + rol, clave: 'clave-segura-123' } });
    expect(r.statusCode).toBe(200);
    cookies.push(String(r.headers['set-cookie']).split(';')[0]!);
  }
});
afterAll(async () => esc?.cerrar());

describe('flujo de pedidos sin gestión de repartidores', () => {
  it.each(['superadmin', 'admin', 'operador'])('retira el menú y las rutas para %s', async (rol) => {
    const cookie = cookies[['superadmin', 'admin', 'operador'].indexOf(rol)]!;
    for (const url of ['/panel', '/hoy', '/mapa', '/setup']) {
      const r = await esc.app.inject({ url, headers: { cookie } });
      expect(r.statusCode).toBe(200);
      expect(r.body).not.toContain('href="/motorizados"');
      expect(r.body).not.toContain('Motorizados activos');
      expect(r.body).not.toContain('Dar de alta a los motorizados');
      expect(r.body).not.toContain('id="cf-mp-activo"');
      expect(r.body).not.toContain('id="gsg-simulador"');
      expect(r.body).not.toContain('href="/desarrollador');
      for (const m of r.body.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) expect(() => new Script(m[1]!)).not.toThrow();
    }
    expect((await esc.app.inject({ url: '/numeros', headers: { cookie } })).headers.location).toBe('/hoy');
    for (const url of ['/motorizados', '/admin/motorizados', '/api/v1/motorizados', '/desarrollador', '/admin/entregas/simulador', '/simulador/gsg/reparto/pendientes']) {
      expect((await esc.app.inject({ url, headers: { cookie } })).statusCode).toBe(404);
    }
    for (const url of ['/admin/motorizados', '/admin/entregas/1/reasignar', '/admin/entregas/1/sin-ubicacion', '/admin/entregas/1/segunda-visita']) {
      expect((await esc.app.inject({ method: 'POST', url, headers: { cookie }, payload: {} })).statusCode).toBe(404);
    }
  });
  it('mantiene los pedidos listos sin asignaciones ni mensajes de reparto', async () => {
    const phone = '51987600111';
    const legacy = await esc.repos.entregas.crearMotorizado({ phone, nombre: 'Registro histórico' });
    expect(legacy.nuevo).toBe(true);
    const nueva = await esc.entregas.crearAMano({ referencia: 'SIN-REPARTO', telefono: '987600222', nombre: 'Cliente', faltaUbicacion: false, faltaConfirmacion: false, lat: -12.0464, lng: -77.0428 }, 'prueba');
    expect(nueva.ok).toBe(true);
    await esc.trabajar();
    const pedido = await esc.entrega('SIN-REPARTO');
    expect(pedido?.estado).toBe('lista');
    expect(pedido?.motorizadoId).toBeNull();
    expect(pedido?.situacion).toBe('Ubicación y confirmación registradas.');
    expect(pedido?.acciones).not.toContain('reasignar');
    expect(esc.mensajesA(phone)).toHaveLength(0);
    expect(await esc.entregas.esMotorizado(phone)).toBe(false);
    expect((await esc.entregas.resumen()).motorizados).toEqual([]);
    expect((await esc.entregas.alTexto({ id: 'historico', phone, name: 'Registro histórico' }, '40')).atendida).toBe(false);
  });
  it('mantiene la recepción, confirmación del envío y consulta del estado', async () => {
    const payload = { tracking: 'NUEVO-FLUJO', cliente: 'Ana', telefono: '987600333', empresa: { codigo: 'T01', nombre: 'Tienda' }, metodoPago: 'Contraentrega', montoCobrar: 10 };
    const r = await esc.api.post('/api/v1/entregas', payload);
    expect(r.status).toBe(201);
    const id = (r.body as any).creadas[0].id;
    expect((await esc.api.post('/admin/entregas/confirmar-envio', { ids: [id] })).status).toBe(200);
    await esc.trabajar();
    await esc.contesta(payload.telefono, { pin: { lat: -12.0464, lng: -77.0428 } });
    await esc.contesta(payload.telefono, { texto: 'sí' });
    await esc.trabajar();
    const e = await esc.entrega(payload.tracking);
    expect(e?.ubicacionEstado).toBe('recibida');
    expect(e?.motorizadoId).toBeNull();
    expect((await esc.api.get('/api/v1/entregas/' + payload.tracking)).status).toBe(200);
  });
  it('la IA ya no ofrece altas, asignación o segunda visita', () => {
    expect(ACCIONES.some((a) => a.nombre.startsWith('motorizados.'))).toBe(false);
    expect(ACCIONES.some((a) => ['entregas.reasignar', 'entregas.segundaVisita'].includes(a.nombre))).toBe(false);
  });
  it('el cierre diario conserva lo registrado sin marcar una entrega física ni rechazar la confirmación', async () => {
    const antes = await esc.entrega('SIN-REPARTO');
    expect(antes).toBeDefined();
    esc.avanzar(24 * 60);
    const r = await esc.entregas.cerrarDia({ forzar: true, quien: 'prueba' });
    expect(r.ok).toBe(true);
    expect(r.resultado?.sinTerminar).not.toContain('SIN-REPARTO');
    expect(r.resultado?.dadasPorEntregadas).not.toContain('SIN-REPARTO');
    const fila = await esc.repos.entregas.entrega(antes!.id);
    expect(fila?.estado).toBe('terminada');
    expect(fila?.entregadaAt).toBeNull();
  });
});
