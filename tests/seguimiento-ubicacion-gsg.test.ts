import { describe, expect, it, vi } from 'vitest';
import { analizarNumeracion, tieneNumeracion, pareceDireccion } from '../src/entregas/direccion-escrita.js';
import { crearGeocodificadorGoogle } from '../src/entregas/geocodificar.js';
import { consultarSeguimiento, crearCalculadorGoogle, textoSeguimiento } from '../src/entregas/seguimiento-gsg.js';
import { datosEnvioDeCrudo } from '../src/entregas/datos-envio.js';
import { crearPuertoHttp } from '../src/rutas/gsg.js';
import { crearEscenarioEntregas } from './escenario-entregas.js';

const ahora = new Date('2026-10-07T17:00:00Z');
const ruta = { tracking: 'GSG-1', distrito: 'Ancón', horario: { desde: '18:00', hasta: '20:00' }, posicion: { lat: -12.1, lng: -77.1, actualizadaAt: ahora.toISOString() }, puntoActual: 2, puntoCliente: 10, paradas: Array.from({ length: 8 }, (_, i) => ({ orden: i + 3, lat: -12.11 - i * 0.001, lng: -77.11, servicioMinutos: i === 0 ? 4 : 0 })) };

describe('dirección numerada y ubicación confirmada', () => {
  it('no confunde distrito, nombres con fecha, referencias y sin número con una puerta', async () => {
    for (const t of ['Ancón', 'Av. 28 de Julio', 'Av. Larco s/n', 'Av. Larco, cuadra 3']) expect(tieneNumeracion(t),t).toBe(false);
    expect(pareceDireccion('Ancón')).toBe(true);
    expect(pareceDireccion('Av. Larco')).toBe(true);
    for (const t of ['Av. Larco 345, Miraflores', 'Jr. Puno 340 Cercado', 'mz B lote 5 urb Jardines SJL']) expect(tieneNumeracion(t),t).toBe(true);
    expect(await analizarNumeracion('Ancón', { completar: async () => '{"numeracion":true}' })).toBe(false);
  });
  it('Google rechaza coincidencias parciales y resultados de zona', async () => {
    const pedir = vi.fn(async () => new Response(JSON.stringify({ status: 'OK', results: [{ partial_match: true, geometry: { location: { lat: -12.12, lng: -77.03 }, location_type: 'ROOFTOP' } }] }))) as unknown as typeof fetch;
    expect(await crearGeocodificadorGoogle('google-key', pedir).buscar('Av. Larco 345','Miraflores')).toBeNull();
  });
  it('no reporta la dirección a GSG hasta el sí; un no descarta la propuesta', async () => {
    const e = await crearEscenarioEntregas({ geocodificador: { buscar: async () => ({ lat: -12.1215, lng: -77.0302, precision: 'alta', distrito: 'Miraflores', texto: 'Av. Larco 345' }) } });
    try {
      const c = await e.repos.contacts.upsertFromInbound('51987777001', 'Rosa');
      await e.entregas.crearAMano({ referencia: 'DIR-1', telefono: c.phone, distrito: 'Miraflores', faltaUbicacion: true, faltaConfirmacion: false }, 'prueba');
      const r = await e.entregas.alDireccionEscrita(c, 'Av. Larco 345, Miraflores', 'reglas');
      expect(r?.texto).toContain('Responde SÍ o NO');
      expect((await e.entrega('DIR-1'))?.ubicacionEstado).toBe('pendiente');
      expect((await e.repos.rutas.reportesRecientes(50, 'ubicacion'))).toHaveLength(0);
      await e.entregas.alTexto(c, 'no');
      expect((await e.entrega('DIR-1'))?.pinPropuestoAt).toBeNull();
      await e.entregas.alDireccionEscrita(c, 'Av. Larco 345, Miraflores', 'reglas');
      await e.entregas.alTexto(c, 'sí');
      expect((await e.entrega('DIR-1'))?.ubicacionEstado).toBe('recibida');
      expect((await e.repos.rutas.reportesRecientes(50, 'ubicacion'))).toHaveLength(1);
    } finally { await e.cerrar(); }
  });
  it('un enlace de Maps también espera confirmación y conserva sus coordenadas', async () => {
    const e = await crearEscenarioEntregas();
    try {
      const c = await e.repos.contacts.upsertFromInbound('51987777002', 'Rosa');
      await e.entregas.crearAMano({ referencia: 'MAP-1', telefono: c.phone, faltaUbicacion: true, faltaConfirmacion: false }, 'prueba');
      const r = await e.entregas.revisarPin(c,{ lat: -12.12, lng: -77.03, fuente: 'enlace de mapa (google)' });
      expect(r.atendida).toBe(true);
      expect((await e.repos.rutas.reportesRecientes(50, 'ubicacion'))).toHaveLength(0);
      await e.entregas.alTexto(c,'sí');
      const entrega = await e.entrega('MAP-1');
      expect(entrega).toMatchObject({ lat: -12.12, lng: -77.03, ubicacionEstado: 'recibida' });
    } finally { await e.cerrar(); }
  });
  it('no busca una dirección sin número y pide que se complete', async () => {
    const buscar = vi.fn(async () => null);
    const e = await crearEscenarioEntregas({ geocodificador: { buscar } });
    try {
      const c = await e.repos.contacts.upsertFromInbound('51987777003','Rosa');
      await e.entregas.crearAMano({ referencia: 'INCOMPLETA', telefono: c.phone, distrito: 'Ancón', faltaUbicacion: true, faltaConfirmacion: false }, 'prueba');
      const r = await e.entregas.alDireccionEscrita(c,'Ancón','reglas');
      expect(r?.texto).toContain('falta el número');
      expect(buscar).not.toHaveBeenCalled();
    } finally { await e.cerrar(); }
  });
});

describe('GSG externo y recorrido de Google', () => {
  it('sin API key no consulta ni envía a GSG', async () => {
    const pedir = vi.fn();
    const gsg = crearPuertoHttp({ url: 'https://gsg.example', token: '', fetchImpl: pedir as typeof fetch });
    expect(gsg.conectado()).toBe(false);
    expect((await gsg.enviar('ubicacion',{ tracking: 'GSG-1', lat: -12, lng: -77 })).ok).toBe(false);
    expect((await gsg.consultar('/reparto/pendientes')).ok).toBe(false);
    expect(pedir).not.toHaveBeenCalled();
  });
  it('consulta por tracking con X-API-Key y usa todas las paradas en orden', async () => {
    const gsgFetch = vi.fn(async () => new Response(JSON.stringify(ruta))) as unknown as typeof fetch;
    const gsg = crearPuertoHttp({ url: 'https://gsg.example/api/', token: 'gsg-key', fetchImpl: gsgFetch });
    const googleFetch = vi.fn(async () => new Response(JSON.stringify({ routes: [{ distanceMeters: 20000, duration: '1200s' }] }))) as unknown as typeof fetch;
    const r = await consultarSeguimiento(gsg, 'GSG-1', crearCalculadorGoogle('google-key', googleFetch), ahora);
    expect(r?.distancia).toEqual({ km: 20, minutos: 24 });
    expect(textoSeguimiento('GSG-1',r!)).toContain('punto 2');
    expect(textoSeguimiento('GSG-1',r!)).toContain('punto 10');
    const [url, init] = vi.mocked(gsgFetch).mock.calls[0]!;
    expect(String(url)).toBe('https://gsg.example/api/reparto/seguimiento/GSG-1');
    expect(new Headers(init?.headers).get('x-api-key')).toBe('gsg-key');
    expect(new Headers(init?.headers).get('authorization')).toBeNull();
    const body = JSON.parse(String(vi.mocked(googleFetch).mock.calls[0]![1]?.body));
    expect(body.intermediates).toHaveLength(7);
    expect(body.optimizeWaypointOrder).toBe(false);
  });
  it('no calcula con posiciones antiguas, otro tracking ni paradas fuera de orden', async () => {
    for (const bad of [{ ...ruta, tracking: 'OTRO' }, { ...ruta, posicion: { ...ruta.posicion, actualizadaAt: '2026-10-06T17:00:00Z' } }, { ...ruta, paradas: [...ruta.paradas].reverse() }]) {
      const calcular = vi.fn();
      const gsg = crearPuertoHttp({ url: 'https://gsg.example', token: 'key', fetchImpl: (async () => new Response(JSON.stringify(bad))) as typeof fetch });
      expect(await consultarSeguimiento(gsg,'GSG-1',calcular,ahora)).toBeNull();
      expect(calcular).not.toHaveBeenCalled();
    }
  });
  it('conserva el horario específico de cada pedido y rechaza rangos inválidos', () => {
    expect(datosEnvioDeCrudo({ horarioEntrega: { desde: '18:00', hasta: '20:00' } })).toMatchObject({ horarioEntregaDesde: '18:00', horarioEntregaHasta: '20:00' });
    expect(datosEnvioDeCrudo({ horarioEntrega: { desde: '20:00', hasta: '18:00' } })).toBeNull();
  });
});
