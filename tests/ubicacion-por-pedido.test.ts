/**
 * Regla del dueño (10/10): cada pedido pide SU ubicación. Un cliente que ya
 * tiene una registrada hoy (por otro pedido) recibe igual la solicitud del
 * pedido nuevo: puede ser otra dirección. No se le copia la de antes.
 */

import { describe, expect, it } from 'vitest';
import { OPCIONES_POR_DEFECTO } from '../src/rutas/motor.js';
import { ajustesPorDefecto } from '../src/rutas/ajustes.js';
import { crearEscenarioEntregas, PAUSA_SEGUNDOS, PIN_LIMA, conPais, type EscenarioEntregas } from './escenario-entregas.js';

const ESPERA_MIN = 30;

function hoyALas9(): Date {
  const d = new Date();
  d.setUTCHours(14, 0, 0, 0);
  if (d.getTime() > Date.now()) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

async function armar(): Promise<EscenarioEntregas> {
  const e = await crearEscenarioEntregas({ arranque: hoyALas9(), agente: true, geocodificador: null });
  await e.entregas.guardarAjustes({ soporte: { whatsapp: '987654321', llamadas: '' } });
  const base = ajustesPorDefecto({ ...OPCIONES_POR_DEFECTO, pausaMinSegundos: PAUSA_SEGUNDOS, pausaMaxSegundos: PAUSA_SEGUNDOS, horaInicio: 0, horaFin: 24 });
  await e.repos.rutas.ajustes.set({ esperaRespuestaMinutos: ESPERA_MIN, maxIntentos: 3 }, base);
  return e;
}

async function pedidoAMano(e: EscenarioEntregas, tel: string, referencia: string): Promise<void> {
  const r = await e.entregas.crearAMano({ referencia, telefono: tel, nombre: 'Cliente', faltaUbicacion: true, faltaConfirmacion: false }, 'prueba');
  expect(r.ok, `crear ${referencia}`).toBe(true);
  await e.trabajar();
}

const pidenUbicacion = (e: EscenarioEntregas, tel: string, desde: number) => e.mensajesA(tel).slice(desde).filter((m) => String(m.kind) === 'location_request');

describe('cada pedido pide su ubicación', () => {
  it('con la ubicación de hoy ya registrada por otro pedido, el pedido nuevo se la pide igual y no copia la anterior', async () => {
    const e = await armar();
    try {
      const tel = '987720001';
      await pedidoAMano(e, tel, 'P-1');
      await e.contesta(tel, { pin: PIN_LIMA });
      await e.trabajar();
      const antes = e.mensajesA(tel).length;

      // Un rato después llega otro pedido del mismo cliente.
      e.avanzar(20);
      await pedidoAMano(e, tel, 'P-2');
      for (let i = 0; i < 4; i++) {
        e.avanzar(ESPERA_MIN + 1);
        await e.trabajar();
      }

      expect(pidenUbicacion(e, tel, antes).length, 'al pedido nuevo se le pide la ubicación').toBeGreaterThan(0);
      const filas = (await e.entregas.resumen()).entregas.filter((f) => f.phone === conPais(tel));
      const nuevo = filas.find((f) => f.referencia === 'P-2')!;
      expect(nuevo.ubicacionEstado, 'no hereda la ubicación del otro pedido').toBe('pendiente');
      expect(filas.find((f) => f.referencia === 'P-1')!.ubicacionEstado).toBe('recibida');
    } finally {
      await e.cerrar();
    }
  }, 60_000);
});
