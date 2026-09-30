/**
 * El horario de entregas manda sobre el del reparto: a las 20:30, con el
 * reparto configurado de 9 a 19 pero las entregas hasta las 22:00, el motor
 * sigue mandando pines a los motorizados; si el horario de entregas también
 * ha terminado, se para y dice por qué.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, PIN_LIMA, type EscenarioEntregas } from './escenario-entregas.js';

const SUPERVISOR = '51912426667';

/** Hoy a las 20:30 de Lima (01:30 UTC del día siguiente); si eso aún no llegó, ayer a esa hora. */
function hoyALas2030(): Date {
  const d = new Date();
  d.setUTCHours(25, 30, 0, 0);
  if (d.getTime() > Date.now()) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

describe('el horario de entregas amplía la franja del reparto', () => {
  let e: EscenarioEntregas;
  beforeAll(async () => {
    e = await crearEscenarioEntregas({ supervisor: SUPERVISOR, horario: [9, 19], arranque: hoyALas2030() });
    e.simulador.cargarDePrueba();
    await e.api.post('/admin/motorizados/de-prueba');
    await e.api.post('/admin/entregas/sincronizar');
  });
  afterAll(() => e.cerrar());

  it('a las 20:30, con entregas hasta las 22:00, el pin sale al motorizado', async () => {
    await e.entregas.guardarAjustes({ horarioEntregas: { desde: '14:00', hasta: '20:00', extendidoHasta: '22:00' } });
    expect(e.motorEntregas.enHorario()).toBe(true);
    await e.contesta('987000010', { pin: { lat: PIN_LIMA.lat + 0.01, lng: PIN_LIMA.lng - 0.01 } });
    await e.trabajar();
    const diego = await e.entrega('P-1010');
    expect(diego?.estado).toBe('esperando_motorizado');
    expect(diego?.motorizado).toBeTruthy();
  });

  it('con el horario de entregas ya terminado se para y lo dice en palabras', async () => {
    await e.entregas.guardarAjustes({ horarioEntregas: { desde: '14:00', hasta: '19:00', extendidoHasta: '19:00' } });
    expect(e.motorEntregas.enHorario()).toBe(false);
    const r = await e.motorEntregas.tick();
    expect(r.accion).toBe('nada');
    expect(r.motivo).toMatch(/fuera del horario de envío \(9:00 a 19:00\)/);
  });
});
