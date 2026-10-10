/**
 * Regla del dueño (29/09): el cliente que ya dio su ubicación y la quiere
 * cambiar.
 *
 *  - Antes de la 1:00 PM: «¡Claro! Entiendo. Mándame la nueva ubicación…» y
 *    el pin nuevo se registra como siempre.
 *  - Después de la 1:00 PM: «…comunícate directamente con el motorizado…»
 *    con el número del motorizado que manda la API de GSG. Un pin nuevo NO se
 *    registra (sigue el anterior) y al cliente se le contesta lo mismo.
 *  - Al motorizado GSGchat no le escribe nada por esto.
 *  - Se contesta aunque el chat esté en silencio tras UBI REGISTRADA.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, PIN_LIMA, conPais, type EscenarioEntregas } from './escenario-entregas.js';

function hoyALas9(): Date {
  const d = new Date();
  d.setUTCHours(14, 0, 0, 0);
  if (d.getTime() > Date.now()) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

const TEL = '987430001';
const MOTO_GSG = '999888777';
const OTRO_PIN = { lat: PIN_LIMA.lat + 0.003, lng: PIN_LIMA.lng + 0.003 };
const TARDE_PIN = { lat: PIN_LIMA.lat - 0.003, lng: PIN_LIMA.lng - 0.003 };

describe('cambio de ubicación antes y después de la 1:00 PM', () => {
  let e: EscenarioEntregas;
  const pide = async (r: Parameters<EscenarioEntregas['contesta']>[1]): Promise<string[]> => {
    const a = e.textosA(conPais(TEL)).length;
    await e.contesta(TEL, r);
    return e.textosA(conPais(TEL)).slice(a);
  };
  const alMotorizado = () => e.mensajesA(conPais(MOTO_GSG)).length;

  beforeAll(async () => {
    e = await crearEscenarioEntregas({ arranque: hoyALas9(), agente: true });
    await e.entregas.guardarAjustes({ soporte: { whatsapp: '987654321', llamadas: '' } });
    await e.api.post('/admin/motorizados/de-prueba');
    e.simulador.cargar([{ referencia: 'C-1', telefono: TEL, nombre: 'Rosa Cambio', direccion: 'Av. Larco 1', distrito: 'Miraflores', faltaUbicacion: true, faltaConfirmacion: false, telefonoMotorizado: MOTO_GSG } as never]);
    await e.gsgManda();
    await e.trabajar();
    await e.contesta(TEL, { pin: PIN_LIMA });
    await e.trabajar();
    expect((await e.entrega('C-1'))?.ubicacionEstado).toBe('recibida');
  });
  afterAll(() => e?.cerrar());

  it('antes de la 1:00 PM: se le pide la nueva y el pin nuevo se registra', async () => {
    expect(await pide({ texto: 'me equivoqué de ubicación' })).toEqual(['¡Claro! Entiendo. Mándame la nueva ubicación para tenerla en cuenta para el mismo día.']);
    await e.contesta(TEL, { pin: OTRO_PIN });
    const c1 = await e.entrega('C-1');
    expect(c1?.lat).toBeCloseTo(OTRO_PIN.lat, 5);
  });

  it('después de la 1:00 PM: que coordine con el motorizado, con el número que manda GSG', async () => {
    e.avanzar(5 * 60); // ~14:0x en Lima
    const r = await pide({ texto: 'oe la ubi q te mande esta mal' });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/^Entiendo que deseas cambiar tu ubicación, pero al ser después de la 1:00 PM, por favor comunícate directamente con el motorizado para coordinar la entrega\. Número del motorizado: .*999 ?888 ?777/);
  });

  it('después de la 1:00 PM un pin nuevo NO se registra, se le contesta lo mismo y al motorizado no se le escribe', async () => {
    const antes = alMotorizado();
    const r = await pide({ pin: TARDE_PIN });
    const c1 = await e.entrega('C-1');
    expect(c1?.lat).toBeCloseTo(OTRO_PIN.lat, 5);
    expect(r.at(-1)).toMatch(/comunícate directamente con el motorizado.*999 ?888 ?777/);
    expect(alMotorizado()).toBe(antes);
    const ficha = await e.api.get<{ eventos: Array<{ detalle: string }> }>(`/admin/entregas/${c1!.id}`);
    expect(ficha.body.eventos.some((ev) => /mandó otra ubicación después de la 1:00 PM .*NO se cambió/.test(ev.detalle))).toBe(true);
  });
});
