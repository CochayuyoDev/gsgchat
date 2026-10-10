/**
 * Regla del dueño (29/09): «cuando un cliente se sale fuera de la ruta de
 * Lima o Callao, se le dice que se le brindará un extra dependiendo de su
 * ubicación, y eso lo brindará el motorizado».
 *
 *  - Pin fuera de Lima y Callao pero cerca (Huaral): se registra, sigue hacia
 *    el motorizado, el cliente recibe «Ubicación registrada» y debajo el
 *    aviso del costo extra; al motorizado GSGchat no le dice nada de esto;
 *    la bitácora lo apunta.
 *  - Pin dentro de Lima: nada de extra.
 *  - Pin lejísimos (Arequipa): como siempre, no se registra y pasa a una persona.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, PIN_LIMA, conPais, type EscenarioEntregas } from './escenario-entregas.js';

function hoyALas9(): Date {
  const d = new Date();
  d.setUTCHours(14, 0, 0, 0);
  if (d.getTime() > Date.now()) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

const HUARAL = { lat: -11.4955, lng: -77.2078 };
const AREQUIPA = { lat: -16.409, lng: -71.537 };
const MOTO = '987666001';

describe('pin fuera de Lima y Callao: se registra con un extra que cobra el motorizado', () => {
  let e: EscenarioEntregas;

  beforeAll(async () => {
    e = await crearEscenarioEntregas({ arranque: hoyALas9() });
    await e.api.post('/admin/motorizados', { telefono: MOTO, nombre: 'Chesco Prueba', zona: 'Norte' });
    e.simulador.cargar([
      { referencia: 'X-1', telefono: '987420001', nombre: 'Rosa Huaral', direccion: 'Av. Principal 10', distrito: 'Lima', faltaUbicacion: true, faltaConfirmacion: false },
      { referencia: 'X-2', telefono: '987420002', nombre: 'Ana Lince', direccion: 'Jr. Uno 2', distrito: 'Lince', faltaUbicacion: true, faltaConfirmacion: false },
      { referencia: 'X-3', telefono: '987420003', nombre: 'Juan Arequipa', direccion: 'Calle 3', distrito: 'Lima', faltaUbicacion: true, faltaConfirmacion: false },
    ]);
    await e.gsgManda();
    await e.trabajar();
  });
  afterAll(() => e?.cerrar());

  it('Huaral: se registra y al cliente se le avisa del extra; al motorizado no se le dice nada de eso', async () => {
    await e.contesta('987420001', { pin: HUARAL });
    const x1 = await e.entrega('X-1');
    expect(x1?.ubicacionEstado).toBe('recibida');
    expect(x1?.estado).not.toBe('incidencia');
    const alCliente = e.textosA(conPais('987420001')).at(-1) ?? '';
    expect(alCliente).toMatch(/^✅ Ubicación registrada/);
    expect(alCliente).toMatch(/fuera de Lima y Callao: la entrega de X-1 tiene un costo extra según la distancia, que le indicará el motorizado/);

    await e.trabajar();
    expect((await e.entrega('X-1'))?.motorizado?.phone).toBe(conPais(MOTO));
    expect(e.textosA(conPais(MOTO)).some((t) => /X-1/.test(t) && /extra|Fuera de Lima/i.test(t))).toBe(false);

    const ficha = await e.api.get<{ eventos: Array<{ detalle: string }> }>(`/admin/entregas/${x1!.id}`);
    expect(ficha.body.eventos.some((ev) => /fuera de Lima y Callao/.test(ev.detalle))).toBe(true);
  });

  it('dentro de Lima: sin extra ni para el cliente ni para el motorizado', async () => {
    await e.contesta('987420002', { pin: PIN_LIMA });
    expect((await e.entrega('X-2'))?.ubicacionEstado).toBe('recibida');
    expect(e.textosA(conPais('987420002')).some((t) => /costo extra/.test(t))).toBe(false);
    await e.trabajar();
    expect(e.textosA(conPais(MOTO)).some((t) => /X-2/.test(t) && /extra/i.test(t))).toBe(false);
  });

  it('Arequipa (muy lejos): no se registra y pasa a una persona, como siempre', async () => {
    await e.contesta('987420003', { pin: AREQUIPA });
    const x3 = await e.entrega('X-3');
    expect(x3?.ubicacionEstado).toBe('pendiente');
    expect(x3?.incidencia).toBe('ubicacion_fuera_de_zona');
    expect(e.textosA(conPais('987420003')).at(-1)).toMatch(/fuera de la zona/i);
  });
});
