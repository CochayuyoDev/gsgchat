import { afterEach, describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG } from './escenario-entregas.js';
import { setFakeClock } from './fakes.js';
import type { Geocodificador } from '../src/entregas/geocodificar.js';
import { direccionDelEnlace } from '../src/geo/extract.js';

/**
 * El cliente manda un enlace de mapa en vez del pin, con el bot callado de
 * «Solo lo de GSG». Si del enlace sale su ubicación (sus coordenadas, o la
 * dirección que trae encontrada en el mapa con su puerta), se registra como un
 * pin. Si no sale o manda dos enlaces distintos, no se adivina y el bot NO
 * contesta: solo salen los mensajes del bot (regla del dueño, 29/10).
 */
const telefono = '987601388';
const pedido = { ...OBLIGATORIOS_GSG, tracking: 'GSG-ENLACE-1', cliente: 'Lucía', telefono, distrito: 'Miraflores' };
const MANANA = new Date('2026-10-28T15:00:00Z');
afterEach(() => setFakeClock(null));

const cuerpos = (ms: Array<Record<string, unknown>>): string[] => ms.map((m) => String(m.text ?? m.body ?? (m.interactive as { body?: string } | undefined)?.body ?? ''));

/** El mapa solo conoce la puerta de la Av. Jorge Chávez 865; lo demás, como mucho la calle. */
const mapa: Geocodificador = {
  async buscar(direccion) {
    return /jorge ch[aá]vez 865/i.test(direccion)
      ? { lat: -12.1318, lng: -76.9931, precision: 'alta', distrito: 'Santiago de Surco', texto: 'Av. Jorge Chávez 865' }
      : { lat: -12.1442, lng: -76.9918, precision: 'media', distrito: 'Santiago de Surco', texto: 'Avenida Antares' };
  },
};

describe('ubicación por enlace de mapa', () => {
  it('sin coordenadas o con dos enlaces el bot no contesta; el enlace bueno se registra', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: MANANA, geocodificador: mapa });
    try {
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      expect(e.mensajesA(telefono)).toHaveLength(1);

      // 1. Un lugar compartido sin coordenadas ni número de puerta: no se contesta.
      e.avanzar(5);
      await e.contesta(telefono, { texto: 'mi casa es esta https://www.google.com/maps/place/Av+Larco+Miraflores gracias' });
      expect(e.mensajesA(telefono)).toHaveLength(1);
      expect((await e.entrega('GSG-ENLACE-1'))!.ubicacionEstado).not.toBe('recibida');

      // 2. Una dirección que el mapa solo ubica por la calle (no la puerta): tampoco.
      await e.contesta(telefono, { texto: 'https://maps.google.com/?q=Calle+Las+Flores+120,+Santiago+de+Surco' });
      expect(e.mensajesA(telefono)).toHaveLength(1);

      // 3. Dos enlaces distintos: no se elige uno ni se contesta.
      e.avanzar(5);
      await e.contesta(telefono, { texto: 'https://www.google.com/maps?q=-12.0464,-77.0428 o https://www.google.com/maps?q=-12.1211,-77.0301' });
      expect(e.mensajesA(telefono)).toHaveLength(1);
      expect((await e.entrega('GSG-ENLACE-1'))!.ubicacionEstado).not.toBe('recibida');

      // 4. El enlace de un lugar compartido con su dirección exacta: se encuentra en el mapa y se registra.
      e.avanzar(5);
      await e.contesta(telefono, { texto: 'https://maps.google.com/?q=Av.+Jorge+Ch%C3%A1vez+865,+Santiago+de+Surco+15049&ftid=0x9105b7f5dd68e5b3:0x9e9a29ecf747c400' });
      expect(e.mensajesA(telefono)).toHaveLength(2);
      expect(cuerpos(e.mensajesA(telefono)).at(-1)).toMatch(/Ubicación registrada correctamente/);
      expect(await e.entrega('GSG-ENLACE-1')).toMatchObject({ ubicacionEstado: 'recibida', lat: -12.1318, lng: -76.9931 });
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('el enlace con el pin del lugar (!3d!4d) se registra, no el centro de la cámara (@)', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: MANANA });
    try {
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      await e.contesta(telefono, { texto: 'esta es https://www.google.com/maps/place/Casa/@-12.1211,-77.0296,15z/data=!3m1!4b1!8m2!3d-12.1191!4d-77.0286' });
      expect(cuerpos(e.mensajesA(telefono)).at(-1)).toMatch(/Ubicación registrada correctamente/);
      expect(await e.entrega('GSG-ENLACE-1')).toMatchObject({ ubicacionEstado: 'recibida', lat: -12.1191, lng: -77.0286 });
    } finally {
      await e.cerrar();
    }
  }, 60_000);
});

describe('la dirección que trae un enlace de lugar compartido', () => {
  it('se saca del ?q= cuando lleva número; coordenadas o un distrito suelto no cuentan', () => {
    expect(direccionDelEnlace('https://maps.google.com/?q=Av.+Jorge+Ch%C3%A1vez+865,+Santiago+de+Surco+15049&ftid=0x1:0x2')).toBe('Av. Jorge Chávez 865, Santiago de Surco 15049');
    expect(direccionDelEnlace('https://www.google.com/maps?q=-12.0464,-77.0428')).toBeNull();
    expect(direccionDelEnlace('https://maps.google.com/?q=Miraflores')).toBeNull();
    expect(direccionDelEnlace('https://otro.sitio/?q=Av.+Larco+123')).toBeNull();
  });
});
