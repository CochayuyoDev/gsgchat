/**
 * Regla del dueño (10/10): la ubicación vale por DÍA.
 *  - El mismo día, otro pedido del mismo número (dos trackings de dos
 *    tiendas) toma la ubicación ya registrada: un solo mensaje al cliente y
 *    la lat/lng va a GSG para cada tracking.
 *  - Otro día es un pedido nuevo: se le vuelve a pedir.
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

describe('la ubicación vale por día', () => {
  it('el mismo día, el segundo tracking toma la ubicación registrada: no se le escribe otra vez y GSG recibe la lat/lng de los dos', async () => {
    const e = await armar();
    try {
      const tel = '987720001';
      await pedidoAMano(e, tel, 'P-1');
      await e.contesta(tel, { pin: PIN_LIMA });
      await e.trabajar();
      const antes = e.mensajesA(tel).length;

      e.avanzar(20);
      await pedidoAMano(e, tel, 'P-2');
      for (let i = 0; i < 4; i++) {
        e.avanzar(ESPERA_MIN + 1);
        await e.trabajar();
      }

      expect(pidenUbicacion(e, tel, antes), 'no se le vuelve a pedir el mismo día').toEqual([]);
      const filas = (await e.entregas.resumen()).entregas.filter((f) => f.phone === conPais(tel));
      expect(filas.map((f) => [f.referencia, f.ubicacionEstado]).sort()).toEqual([['P-1', 'recibida'], ['P-2', 'recibida']]);
      // Un reporte de ubicación por tracking, los dos con el mismo punto.
      const reportes = await e.repos.rutas.reportesRecientes(50, 'ubicacion');
      const porTracking = new Map(reportes.map((r) => [String((r.payload as Record<string, unknown>).referencia), r.payload as Record<string, unknown>]));
      expect([...porTracking.keys()].sort()).toEqual(['P-1', 'P-2']);
      expect(porTracking.get('P-2')!.lat).toBe(porTracking.get('P-1')!.lat);
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('otro día se le vuelve a pedir la ubicación, aunque ayer la haya mandado', async () => {
    const e = await armar();
    try {
      const tel = '987720002';
      await pedidoAMano(e, tel, 'P-3');
      await e.contesta(tel, { pin: PIN_LIMA });
      await e.trabajar();
      const antes = e.mensajesA(tel).length;

      e.avanzar(24 * 60);
      await pedidoAMano(e, tel, 'P-3');
      for (let i = 0; i < 2; i++) {
        e.avanzar(ESPERA_MIN + 1);
        await e.trabajar();
      }

      expect(pidenUbicacion(e, tel, antes).length, 'el día siguiente se le pide otra vez').toBeGreaterThan(0);
    } finally {
      await e.cerrar();
    }
  }, 60_000);
});
