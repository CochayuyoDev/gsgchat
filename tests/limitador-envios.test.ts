import { describe, expect, it } from 'vitest';
import { crearLimitadorEnvios } from '../src/outbound/limitador-envios.js';

describe('límite de envíos por instancia', () => {
  it('no supera la concurrencia configurada y libera permisos aunque falle un envío', async () => {
    const limitar = crearLimitadorEnvios({ concurrencia: 2, porSegundo: 20, esperar: async () => undefined });
    let activos = 0, maximos = 0;
    const tareas = Array.from({ length: 7 }, (_, i) => limitar(async () => {
      activos++;
      maximos = Math.max(maximos, activos);
      await new Promise((resolve) => setTimeout(resolve, 2));
      activos--;
      if (i === 3) throw new Error('fallo simulado');
      return i;
    }).catch(() => null));
    await Promise.all(tareas);
    expect(maximos).toBe(2);
    expect(activos).toBe(0);
  });

  it('separa los inicios de proveedor según la tasa configurada', async () => {
    let reloj = 0;
    const esperas: number[] = [];
    const limitar = crearLimitadorEnvios({ concurrencia: 2, porSegundo: 2, ahora: () => reloj, esperar: async (ms) => { esperas.push(ms); reloj += ms; } });
    await Promise.all([limitar(async () => 1), limitar(async () => 2)]);
    expect(esperas).toEqual([500]);
  });
});
