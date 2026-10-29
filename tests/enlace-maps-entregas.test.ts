import { afterEach, describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG } from './escenario-entregas.js';
import { setFakeClock } from './fakes.js';

/**
 * El cliente manda un enlace de mapa en vez del pin (como GSG, 26/10), con el
 * bot callado de «Solo lo de GSG». Si del enlace sale su ubicación, se
 * registra como un pin. Si no sale (un lugar compartido como dirección) o
 * manda dos enlaces distintos, no se adivina: se le pide el pin con el botón.
 */
const telefono = '987601388';
const pedido = { ...OBLIGATORIOS_GSG, tracking: 'GSG-ENLACE-1', cliente: 'Lucía', telefono, distrito: 'Miraflores' };
const MANANA = new Date('2026-10-28T15:00:00Z');
afterEach(() => setFakeClock(null));

const cuerpos = (ms: Array<Record<string, unknown>>): string[] => ms.map((m) => String(m.text ?? m.body ?? (m.interactive as { body?: string } | undefined)?.body ?? ''));

describe('ubicación por enlace de mapa', () => {
  it('sin coordenadas → se pide el pin; dos enlaces → se pide el pin; el enlace bueno → se registra', async () => {
    const e = await crearEscenarioEntregas({ agente: true, arranque: MANANA });
    try {
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      expect(e.mensajesA(telefono)).toHaveLength(1);

      // 1. Un lugar compartido como dirección: no hay coordenadas que leer.
      e.avanzar(5);
      await e.contesta(telefono, { texto: 'mi casa es esta https://www.google.com/maps/place/Av+Larco+123+Miraflores gracias' });
      let ultimo = e.mensajesA(telefono).at(-1)!;
      expect(cuerpos([ultimo])[0]).toMatch(/No pudimos sacar la ubicación exacta de ese enlace/);
      expect(JSON.stringify(ultimo)).toMatch(/locationRequest|location_request/);
      let ent = (await e.entrega('GSG-ENLACE-1'))!;
      expect(ent.ubicacionEstado).not.toBe('recibida');

      // 2. Dos enlaces distintos: no se elige uno.
      e.avanzar(5);
      await e.contesta(telefono, { texto: 'https://www.google.com/maps?q=-12.0464,-77.0428 o https://www.google.com/maps?q=-12.1211,-77.0301' });
      ultimo = e.mensajesA(telefono).at(-1)!;
      expect(cuerpos([ultimo])[0]).toMatch(/más de un enlace de mapa/);
      ent = (await e.entrega('GSG-ENLACE-1'))!;
      expect(ent.ubicacionEstado).not.toBe('recibida');

      // 3. El enlace bueno: el pin del lugar (!3d!4d), no el centro de la cámara (@).
      e.avanzar(5);
      await e.contesta(telefono, { texto: 'esta es https://www.google.com/maps/place/Casa/@-12.1211,-77.0296,15z/data=!3m1!4b1!8m2!3d-12.1191!4d-77.0286' });
      expect(cuerpos(e.mensajesA(telefono)).at(-1)).toMatch(/Ubicación registrada correctamente/);
      ent = (await e.entrega('GSG-ENLACE-1'))!;
      expect(ent).toMatchObject({ ubicacionEstado: 'recibida', lat: -12.1191, lng: -77.0286 });
    } finally {
      await e.cerrar();
    }
  }, 60_000);
});
