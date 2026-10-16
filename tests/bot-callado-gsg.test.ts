import { afterEach, describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG } from './escenario-entregas.js';
import { setFakeClock } from './fakes.js';

/**
 * El bot callado (regla del dueño, 16/10): con «Solo lo de GSG» y la IA
 * apagada, al cliente solo le llegan la solicitud de ubicacion, los
 * recordatorios y el agradecimiento tras su ubicacion actual. Lo demas que
 * escriba no recibe respuesta, pero se procesa igual.
 */
const telefono = '987601316';
const phone = '51' + telefono;
const fijo = { lat: -12.0464, lng: -77.0428 };
const pedido = { ...OBLIGATORIOS_GSG, tracking: 'GSG-CALLADO-1', cliente: 'Rosa', telefono, distrito: 'Lima' };
afterEach(() => setFakeClock(null));

describe('bot callado en «Solo lo de GSG» sin IA', () => {
  it('no contesta textos ni la ubicación en tiempo real; agradece la ubicación actual', async () => {
    const e = await crearEscenarioEntregas({ agente: true });
    try {
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      const inicio = e.mensajesA(telefono).length;
      expect(inicio).toBe(1);

      await e.contesta(telefono, { texto: '¿Por qué me piden la ubicación?' });
      await e.contesta(telefono, { texto: 'hola, quién es?' });
      await e.api.post('/admin/dev/inbound', { from: phone, location: { latitude: fijo.lat, longitude: fijo.lng }, enVivo: true });
      expect(e.mensajesA(telefono)).toHaveLength(inicio);
      expect((await e.entrega('GSG-CALLADO-1'))!.ubicacionEstado).toBe('pendiente');

      await e.contesta(telefono, { pin: fijo });
      expect((await e.entrega('GSG-CALLADO-1'))!.ubicacionEstado).toBe('recibida');
      expect(e.mensajesA(telefono)).toHaveLength(inicio + 1);
      expect(e.textosA(telefono).at(-1)).toMatch(/ubicación registrada/i);

      await e.contesta(telefono, { texto: '¿A qué hora llega mi pedido?' });
      await e.contesta(telefono, { texto: 'quiero cambiar mi ubicación' });
      await e.contesta(telefono, { texto: 'gracias' });
      expect(e.mensajesA(telefono)).toHaveLength(inicio + 1);

      // Pedir cambiar la ubicación no recibe respuesta, pero es una incidencia para GSG.
      const incidencias = (await e.repos.rutas.reportesRecientes(100, 'incidencia')).map((r) => r.payload as Record<string, unknown>);
      expect(incidencias.filter((p) => p.tracking === 'GSG-CALLADO-1' && p.codigo === 'cambio_ubicacion')).toHaveLength(1);
      await e.contesta(telefono, { texto: 'me equivoqué de dirección, quiero cambiarla' });
      const otraVez = (await e.repos.rutas.reportesRecientes(100, 'incidencia')).map((r) => r.payload as Record<string, unknown>);
      expect(otraVez.filter((p) => p.tracking === 'GSG-CALLADO-1' && p.codigo === 'cambio_ubicacion')).toHaveLength(1);
    } finally {
      await e.cerrar();
    }
  });

  it('«no soy yo» no recibe respuesta, pero el pedido pasa a incidencia y GSG se entera', async () => {
    const e = await crearEscenarioEntregas({ agente: true });
    try {
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      const inicio = e.mensajesA(telefono).length;

      await e.contesta(telefono, { texto: 'Número equivocado, ese no es mi pedido' });
      expect(e.mensajesA(telefono)).toHaveLength(inicio);
      expect((await e.entrega('GSG-CALLADO-1'))!.incidencia).toBe('no_soy_yo');

      // GSG lo recibe por los números reportados (error «no_soy_yo»).
      const reportados = (e.repos.reportados as unknown as { _filas: Array<{ clave: string; error: string }> })._filas;
      expect(reportados.filter((f) => f.clave === 'GSG-CALLADO-1' && f.error === 'no_soy_yo')).toHaveLength(1);

      // Y no se le vuelve a escribir: ni recordatorios.
      e.avanzar(120);
      await e.trabajar();
      expect(e.mensajesA(telefono)).toHaveLength(inicio);
    } finally {
      await e.cerrar();
    }
  });

  it('después de «no soy yo» registrado (ubicación ya dada), tampoco contesta', async () => {
    const e = await crearEscenarioEntregas({ agente: true });
    try {
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      await e.contesta(telefono, { pin: fijo });
      const tras = e.mensajesA(telefono).length;
      await e.contesta(telefono, { texto: 'yo no he pedido eso disculpa' });
      expect(e.mensajesA(telefono)).toHaveLength(tras);
      expect((await e.entrega('GSG-CALLADO-1'))!.incidencia).toBe('no_soy_yo');
      const reportados = (e.repos.reportados as unknown as { _filas: Array<{ clave: string; error: string }> })._filas;
      expect(reportados.filter((f) => f.clave === 'GSG-CALLADO-1' && f.error === 'no_soy_yo')).toHaveLength(1);
    } finally {
      await e.cerrar();
    }
  });
});
