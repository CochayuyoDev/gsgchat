import { describe, it, expect, vi } from 'vitest';
import { crearConsultaSeguimiento, leerSeguimiento, crearCalculadorGoogle, textoSeguimiento } from '../src/entregas/seguimiento-gsg.js';
import { crearGsgSimulado } from '../src/entregas/gsg-simulado.js';
import { crearEscenarioEntregas } from './escenario-entregas.js';
import { resolveShortLink, clearResolveCache } from '../src/geo/resolve.js';

const ahora = new Date('2026-10-07T17:00:00Z');
const ruta = { tracking: 'P-1', posicion: { lat: -12.1, lng: -77.1, actualizadaAt: ahora.toISOString() }, puntoActual: 2, puntoCliente: 4, paradas: [{ orden: 3, lat: -12.11, lng: -77.1 }, { orden: 4, lat: -12.12, lng: -77.1 }] };

describe('seguimiento avanzado', () => {
  it('rechaza un botón de propuesta anterior y acepta la revisión vigente', async () => {
    const e = await crearEscenarioEntregas();
    try {
      const c = await e.repos.contacts.upsertFromInbound('51987777999', 'Rosa');
      await e.entregas.crearAMano({ referencia: 'REV-1', telefono: c.phone, faltaUbicacion: true, faltaConfirmacion: false }, 'prueba');
      await e.entregas.revisarPin(c, { lat: -12.12, lng: -77.03, fuente: 'enlace de mapa (google)' });
      const p = (await e.entrega('REV-1'))!;
      const revision = p.pinPropuestoAt!.getTime();
      const r = await e.entregas.responderPinLejos(c.phone, 'si', '', 'botón', `entrega:pinsi:${p.id}:${revision - 1}`);
      expect(r?.tipo).toBe('repregunta');
      expect(await e.repos.rutas.reportesRecientes(50, 'ubicacion')).toHaveLength(0);
      await e.entregas.responderPinLejos(c.phone, 'si', '', 'botón', `entrega:pinsi:${p.id}:${revision}`);
      expect((await e.entrega('REV-1'))?.ubicacionEstado).toBe('recibida');
    } finally { await e.cerrar(); }
  });
  it('rechaza redirecciones a destinos ajenos a mapas y a HTTP', async () => {
    clearResolveCache();
    for (const destino of ['http://www.google.com/maps?q=-12,-77', 'https://127.0.0.1/admin', 'https://evil.example/']) {
      const url = `https://maps.app.goo.gl/Test-${encodeURIComponent(destino)}`;
      const pedir = vi.fn(async () => new Response(null, { status: 302, headers: { location: destino } })) as unknown as typeof fetch;
      expect(await resolveShortLink(url, { fetchImpl: pedir })).toBe(url);
      expect(pedir).toHaveBeenCalledTimes(1);
    }
  });
  it('acepta estados terminales sin GPS y no calcula una ruta', async () => {
    const calcular = vi.fn();
    for (const estado of ['entregado', 'cancelado', 'incidencia']) {
      const r = await leerSeguimiento({ tracking: 'P-1', estado }, 'P-1', calcular, ahora);
      expect(r).not.toBeNull();
      expect(textoSeguimiento('P-1', r!)).not.toContain('minutos');
    }
    expect(calcular).not.toHaveBeenCalled();
  });
  it('si ya está en el punto del cliente comunica llegada sin exigir paradas', async () => {
    const r = await leerSeguimiento({ ...ruta, puntoActual: 4, paradas: [] }, 'P-1', undefined, ahora);
    expect(textoSeguimiento('P-1', r!)).toContain('llegando');
  });
  it('distingue conducción de llegada cuando falta tiempo de atención', async () => {
    const google = (async () => new Response(JSON.stringify({ routes: [{ distanceMeters: 5000, duration: '600s' }] }))) as typeof fetch;
    const r = await leerSeguimiento(ruta, 'P-1', crearCalculadorGoogle('key', google), ahora);
    expect(r?.distancia).toMatchObject({ minutos: 10, soloConduccion: true });
    expect(textoSeguimiento('P-1', r!)).toContain('Falta el tiempo de atención');
  });
  it('deduplica consultas concurrentes, caduca y aísla las tiendas', async () => {
    let tiempo = ahora.getTime();
    const pedir = vi.fn(async () => ruta);
    const consulta = crearConsultaSeguimiento(pedir, undefined, () => new Date(tiempo));
    await Promise.all([consulta.consultar('P-1'), consulta.consultar('P-1')]);
    await consulta.consultar('P-1');
    expect(pedir).toHaveBeenCalledTimes(1);
    tiempo += 31_000;
    await consulta.consultar('P-1');
    expect(pedir).toHaveBeenCalledTimes(2);
    consulta.invalidar();
    await consulta.consultar('P-1');
    expect(pedir).toHaveBeenCalledTimes(3);
    const otraTienda = crearConsultaSeguimiento(() => ({ tracking: 'P-1', estado: 'cancelado' }));
    expect((await otraTienda.consultar('P-1'))?.ruta.estado).toBe('cancelado');
  });
  it('el simulador exige API key y no ofrece consulta de seguimiento (GSGchat no se la pide)', () => {
    const sim = crearGsgSimulado({ token: 'test', ahora: () => ahora });
    expect(sim.atender('GET', '/reparto/seguimiento/P-1', null, null).status).toBe(401);
    expect(sim.atender('GET', '/reparto/seguimiento/P-1', 'test', null).status).toBe(404);
  });
  it('sin fuente de seguimiento (producción) no hay seguimiento ni llamada a nadie', async () => {
    const consulta = crearConsultaSeguimiento(null);
    expect(await consulta.consultar('P-1')).toBeNull();
    expect(consulta.estado().conectado).toBe(false);
  });
  it('un sí ambiguo no confirma dos pedidos y una referencia confirma solo uno', async () => {
    const e = await crearEscenarioEntregas();
    try {
      const c = await e.repos.contacts.upsertFromInbound('51987777888', 'Rosa');
      for (const referencia of ['UNO-1', 'DOS-2']) await e.entregas.crearAMano({ referencia, telefono: c.phone, faltaUbicacion: true, faltaConfirmacion: false }, 'prueba');
      await e.entregas.revisarPin(c, { lat: -12.12, lng: -77.03, fuente: 'enlace de mapa (google)' });
      const ambiguo = await e.entregas.responderPinLejos(c.phone, 'si', 'sí', 'reglas');
      expect(ambiguo?.tipo).toBe('repregunta');
      expect(await e.repos.rutas.reportesRecientes(50, 'ubicacion')).toHaveLength(0);
      await Promise.all([e.entregas.responderPinLejos(c.phone, 'si', 'sí UNO-1', 'reglas'), e.entregas.responderPinLejos(c.phone, 'si', 'sí UNO-1', 'reglas')]);
      expect((await e.entrega('UNO-1'))?.ubicacionEstado).toBe('recibida');
      expect((await e.entrega('DOS-2'))?.ubicacionEstado).toBe('pendiente');
      expect(await e.repos.rutas.reportesRecientes(50, 'ubicacion')).toHaveLength(1);
    } finally { await e.cerrar(); }
  });
});
