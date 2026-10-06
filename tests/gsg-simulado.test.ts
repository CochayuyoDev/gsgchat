/**
 * El sistema de GSG de mentira: sus tres listas y cuando mueve a un cliente
 * de una a otra. Y la conexion con GSG configurable desde la pantalla.
 */

import { describe, expect, it } from 'vitest';
import { crearGsgSimulado } from '../src/entregas/gsg-simulado.js';
import { crearConexionGsg, TOKEN_SIMULADOR } from '../src/rutas/conexion-gsg.js';
import { createMemorySettingsRepo, TEST_SETTINGS_KEY } from './fakes.js';

const TOKEN = 'token-de-prueba';

describe('el simulador de GSG', () => {
  it('carga los diez clientes y los reparte en sus listas segun lo que les falta', () => {
    const sim = crearGsgSimulado({ token: TOKEN });
    expect(sim.cargarDePrueba()).toBe(10);
    expect(sim.cargarDePrueba()).toBe(0);
    const p = sim.pendientes();
    expect(p.faltaUbicacion.map((c) => c.referencia)).toEqual(['P-1001', 'P-1002', 'P-1003', 'P-1004', 'P-1005', 'P-1006', 'P-1010']);
    expect(p.faltaConfirmacion.map((c) => c.referencia)).toEqual(['P-1001', 'P-1002', 'P-1003', 'P-1004', 'P-1005', 'P-1006', 'P-1007', 'P-1008', 'P-1009']);
    expect(p.terminados).toEqual([]);
    // Quien ya dio su ubicacion viene con el pin; quien no, sin el.
    expect(p.faltaConfirmacion.find((c) => c.referencia === 'P-1007')).toMatchObject({ lat: -12.0977, lng: -77.0365 });
    expect(p.faltaConfirmacion.find((c) => c.referencia === 'P-1001')).not.toHaveProperty('lat');
  });

  it('exige el token y contesta 404 a lo que no conoce', () => {
    const sim = crearGsgSimulado({ token: TOKEN });
    expect(sim.atender('GET', '/reparto/pendientes', 'otro', undefined).status).toBe(401);
    expect(sim.atender('GET', '/reparto/pendientes', TOKEN, undefined).status).toBe(200);
    expect(sim.atender('POST', '/lo-que-sea', TOKEN, {}).status).toBe(404);
  });

  it('con ubicacion y confirmacion pasa a terminados; con un no, a cancelados', () => {
    const sim = crearGsgSimulado({ token: TOKEN });
    sim.cargarDePrueba();
    // P-1001 necesita las dos cosas: con una sola sigue pendiente.
    sim.atender('POST', '/ubicaciones', TOKEN, { referencia: 'P-1001', telefono: '51987000001', lat: -12.1, lng: -77 });
    expect(sim.pendientes().faltaUbicacion.map((c) => c.referencia)).not.toContain('P-1001');
    expect(sim.pendientes().faltaConfirmacion.map((c) => c.referencia)).toContain('P-1001');
    expect(sim.pendientes().terminados).toEqual([]);
    sim.atender('POST', '/confirmaciones', TOKEN, { referencia: 'P-1001', confirmada: true, como: 'reglas' });
    expect(sim.pendientes().terminados.map((c) => c.referencia)).toEqual(['P-1001']);
    // Ahora que la tiene, la lista de confirmacion la manda con el pin.
    // P-1007 solo necesitaba confirmar: con eso termina.
    sim.atender('POST', '/confirmaciones', TOKEN, { referencia: 'P-1007', confirmada: true });
    expect(sim.pendientes().terminados.map((c) => c.referencia)).toEqual(['P-1001', 'P-1007']);
    // P-1010 solo necesitaba la ubicacion.
    sim.atender('POST', '/ubicaciones', TOKEN, { referencia: 'P-1010', telefono: '51987000010', lat: -12, lng: -77 });
    expect(sim.pendientes().terminados.map((c) => c.referencia)).toContain('P-1010');
    // P-1008 dice que no: cancelado, fuera de las listas de pendientes.
    sim.atender('POST', '/confirmaciones', TOKEN, { referencia: 'P-1008', confirmada: false, motivo: 'cancela' });
    expect(sim.pendientes().cancelados.map((c) => c.referencia)).toEqual(['P-1008']);
    expect(sim.pendientes().faltaConfirmacion.map((c) => c.referencia)).not.toContain('P-1008');
    // "Sin respuesta" y "cambio" no cancelan: lo coordina una persona.
    sim.atender('POST', '/confirmaciones', TOKEN, { referencia: 'P-1009', confirmada: false, motivo: 'cambio' });
    expect(sim.pendientes().faltaConfirmacion.map((c) => c.referencia)).toContain('P-1009');
    // La entrega (hora de llegada) queda apuntada.
    sim.atender('POST', '/entregas', TOKEN, { referencia: 'P-1001', minutosMotorizado: 40, minutosAviso: 100, llegaAproxEn: '2026-09-21T20:40:00.000Z' });
    expect(sim.pendientes().terminados.find((c) => c.referencia === 'P-1001')).toMatchObject({ llegaAproxEn: '2026-09-21T20:40:00.000Z' });
    const e = sim.estado();
    expect(e.recibidos).toEqual({ ubicaciones: 2, confirmaciones: 4, entregas: 1, incidencias: 0, resumenes: 0 });
    expect(e.terminados).toBe(3);
    expect(e.cancelados).toBe(1);
  });

  it('encuentra al cliente por telefono cuando el reporte no trae la referencia que conoce', () => {
    const sim = crearGsgSimulado({ token: TOKEN });
    sim.cargar([{ referencia: 'X-1', telefono: '987000001', faltaConfirmacion: false }]);
    const r = sim.atender('POST', '/ubicaciones', TOKEN, { referencia: 'otra', telefono: '51987000001', lat: 1, lng: 2 });
    expect((r.body as { encontrado: boolean }).encontrado).toBe(true);
    expect(sim.pendientes().terminados.map((c) => c.referencia)).toEqual(['X-1']);
  });

  it('se puede poner caido o a rechazar, y reiniciar', () => {
    const sim = crearGsgSimulado({ token: TOKEN });
    sim.cargarDePrueba();
    sim.modo = 'caido';
    expect(sim.atender('GET', '/reparto/pendientes', TOKEN, undefined).status).toBe(502);
    sim.modo = 'rechaza';
    expect(sim.atender('POST', '/ubicaciones', TOKEN, { referencia: 'P-1001' }).status).toBe(422);
    expect(sim.atender('GET', '/reparto/pendientes', TOKEN, undefined).status).toBe(200);
    sim.reiniciar();
    expect(sim.modo).toBe('ok');
    expect(sim.estado().clientes).toEqual([]);
    expect(sim.estado().llamadas).toBe(0);
  });

  it('carga una lista propia por la API y rechaza filas sin lo minimo', () => {
    const sim = crearGsgSimulado({ token: TOKEN });
    const r = sim.atender('POST', '/reparto/cargar', TOKEN, { clientes: [{ referencia: 'A-1', telefono: '987111222', nombre: 'Prueba', faltaUbicacion: false, lat: -12, lng: -77 }] });
    expect(r.status).toBe(200);
    expect((r.body as { nuevos: number }).nuevos).toBe(1);
    expect(sim.pendientes().faltaConfirmacion.map((c) => c.referencia)).toEqual(['A-1']);
    expect(() => sim.atender('POST', '/reparto/cargar', TOKEN, { clientes: [{ telefono: '1' }] })).toThrow();
  });
});

describe('lo que GSG puede hacer con un pedido ya mandado (espejo de cambios)', () => {
  const TOKEN = 'tok-espejo';
  it('cancela un pedido por su cuenta: sale en cancelados con cancelado:true y su motivo, y deja de estar en las listas', () => {
    const sim = crearGsgSimulado({ token: TOKEN });
    sim.cargarDePrueba();
    expect(sim.cancelar('P-1003', 'el cliente anuló la venta')).toBe(true);
    const p = sim.pendientes();
    expect(p.faltaUbicacion.some((c) => c.referencia === 'P-1003')).toBe(false);
    expect(p.faltaConfirmacion.some((c) => c.referencia === 'P-1003')).toBe(false);
    const c = p.cancelados.find((x) => x.referencia === 'P-1003');
    expect(c).toMatchObject({ cancelado: true, motivoCancelacion: 'el cliente anuló la venta', motivo: 'cancelado_por_gsg' });
    // Cancelar dos veces no hace nada; un desconocido tampoco.
    expect(sim.cancelar('P-1003')).toBe(false);
    expect(sim.cancelar('NO-EXISTE')).toBe(false);
    // Los que el cliente cancelo por WhatsApp no llevan cancelado:true (los cancelo el cliente, no GSG).
    sim.atender('POST', '/confirmaciones', TOKEN, { referencia: 'P-1002', confirmada: false, motivo: 'cancela' });
    const c2 = sim.pendientes().cancelados.find((x) => x.referencia === 'P-1002');
    expect(c2).toBeDefined();
    expect(c2).not.toHaveProperty('cancelado');
  });

  it('cambia la direccion, el distrito o el telefono y la lista lo devuelve con los datos nuevos', () => {
    const sim = crearGsgSimulado({ token: TOKEN });
    sim.cargarDePrueba();
    const antes = sim.pendientes().faltaUbicacion.find((c) => c.referencia === 'P-1001')!;
    const r = sim.atender('POST', '/reparto/cambiar', TOKEN, { referencia: 'P-1001', direccion: 'Av. Nueva 100', distrito: 'San Isidro' });
    expect(r.status).toBe(200);
    const despues = sim.pendientes().faltaUbicacion.find((c) => c.referencia === 'P-1001')!;
    expect(despues.direccion).toBe('Av. Nueva 100');
    expect(despues.distrito).toBe('San Isidro');
    expect(despues.telefono).toBe(antes.telefono);
    expect(sim.atender('POST', '/reparto/cambiar', TOKEN, { referencia: 'NADIE', direccion: 'x' }).status).toBe(404);
    expect(sim.atender('POST', '/reparto/cancelar', TOKEN, { referencia: 'NADIE' }).status).toBe(404);
    // Un pedido cerrado no se cambia ni se vuelve a cancelar: 409, con el motivo en palabras.
    expect(sim.atender('POST', '/reparto/cancelar', TOKEN, { referencia: 'P-1001', motivo: 'prueba' }).status).toBe(200);
    const otra = sim.atender('POST', '/reparto/cambiar', TOKEN, { referencia: 'P-1001', direccion: 'y' });
    expect(otra.status).toBe(409);
    expect(String((otra.body as { error: string }).error)).toContain('ya estaba cerrado');
  });

  it('una lista vacia o un fallo no marcan nada como cancelado: solo cancelado:true pedido a pedido', () => {
    const sim = crearGsgSimulado({ token: TOKEN });
    sim.cargarDePrueba();
    sim.modo = 'caido';
    expect(sim.atender('GET', '/reparto/pendientes', TOKEN, null).status).toBe(502);
    sim.modo = 'ok';
    const p = sim.pendientes();
    expect(p.cancelados).toHaveLength(0);
    expect(p.faltaUbicacion.every((c) => !('cancelado' in c))).toBe(true);
  });
});

describe('la conexion con GSG desde la pantalla', () => {
  const config = { GSG_URL: '', GSG_TOKEN: '', PUBLIC_BASE_URL: 'http://localhost:3000' };

  it('sin nada, no esta conectada y lo dice; el .env es el valor inicial', async () => {
    const c = await crearConexionGsg({ settingsRepo: createMemorySettingsRepo(), settingsKeyBase64: TEST_SETTINGS_KEY, config });
    expect(c.estado()).toMatchObject({ modo: 'ninguna', conectada: false, origen: 'ninguna' });
    expect(c.puerto().conectado()).toBe(false);
    expect((await c.puerto().enviar('ubicacion', {})).ok).toBe(false);
    expect((await c.probar()).ok).toBe(false);

    const conEnv = await crearConexionGsg({ settingsRepo: createMemorySettingsRepo(), settingsKeyBase64: TEST_SETTINGS_KEY, config: { ...config, GSG_URL: 'https://gsg.pe/api', GSG_TOKEN: 't' } });
    expect(conEnv.estado()).toMatchObject({ modo: 'real', url: 'https://gsg.pe/api', origen: 'env', tieneToken: true, conectada: true });
  });

  it('el simulador apunta a este servidor con su token; la real guarda la URL y cifra el token; quitar vuelve al .env', async () => {
    const settingsRepo = createMemorySettingsRepo();
    const c = await crearConexionGsg({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, config });
    expect((await c.usarSimulador()).modo).toBe('simulador');
    expect(c.estado().url).toBe('http://localhost:3000/simulador/gsg');
    expect(c.puerto().descripcion()).toMatch(/simulador/);

    await c.conectarReal({ url: 'https://gsg.pe/api/', token: 'secreto' });
    expect(c.estado()).toMatchObject({ modo: 'real', url: 'https://gsg.pe/api', tieneToken: true, origen: 'pantalla' });
    const guardado = (await settingsRepo.getAll()).find((r) => r.key === 'gsg.apiKey');
    expect(guardado?.encrypted).toBe(true);
    expect(guardado?.value).not.toContain('secreto');
    // Lo guardado sobrevive a un reinicio.
    const otra = await crearConexionGsg({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, config });
    expect(otra.estado()).toMatchObject({ modo: 'real', url: 'https://gsg.pe/api', tieneToken: true });
    await expect(c.conectarReal({ url: 'gsg.pe' })).rejects.toThrow(/http/);
    expect((await c.quitar()).modo).toBe('ninguna');
    void TOKEN_SIMULADOR;
  });

  it('probar dice en cristiano que paso (token malo, ruta que no existe, todo bien)', async () => {
    const sim = crearGsgSimulado({ token: 'bueno' });
    sim.cargarDePrueba();
    const fetchFalso = (async (entrada: string | URL | Request, init?: RequestInit) => {
      const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
      const r = sim.atender('GET', url.replace('https://gsg.pe/api', ''), new Headers(init?.headers).get('x-api-key'), undefined);
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const c = await crearConexionGsg({ settingsRepo: createMemorySettingsRepo(), settingsKeyBase64: TEST_SETTINGS_KEY, config, fetchImpl: fetchFalso });
    expect((await c.probar({ url: 'https://gsg.pe/api', token: 'malo' })).detalle).toMatch(/rechazó la clave \(error 401\): la API Key de GSG es incorrecta/);
    // Sin la consulta de pendientes su API responde igual: no es un fallo para enviar ubicaciones.
    const sinPendientes = await c.probar({ url: 'https://gsg.pe/api/otra', token: 'bueno' });
    expect(sinPendientes.ok).toBe(true);
    expect(sinPendientes.detalle).toMatch(/no tiene la consulta \/reparto\/pendientes \(error 404\)/);
    const ok = await c.probar({ url: 'https://gsg.pe/api', token: 'bueno' });
    expect(ok.ok).toBe(true);
    expect(ok).toMatchObject({ faltaUbicacion: 7, faltaConfirmacion: 9, terminados: 0 });
  });
});

describe('reportes de un pedido que ya no existe', () => {
  it('la cancelación de un pedido viejo no cancela el pedido nuevo del mismo teléfono', () => {
    const sim = crearGsgSimulado({ token: TOKEN });
    sim.cargar([{ referencia: 'G-2002', telefono: '912426667', faltaConfirmacion: false }]);
    const r = sim.atender('POST', '/confirmaciones', TOKEN, { referencia: 'G-2001', telefono: '51912426667', confirmada: false, motivo: 'cancela' });
    expect((r.body as { encontrado: boolean }).encontrado).toBe(false);
    expect(sim.pendientes().cancelados).toHaveLength(0);
    expect(sim.pendientes().faltaUbicacion.map((c) => c.referencia)).toEqual(['G-2002']);
  });
});
