import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeRepos } from './fakes.js';
import { OPCIONES_POR_DEFECTO, startMotorRutas } from '../src/rutas/motor.js';
import { crearPuertoEnEspera } from '../src/rutas/gsg.js';
import { despertarMotorRutas } from '../src/rutas/despertador.js';

afterEach(() => vi.useRealTimers());

describe('motor de rutas sin sondeo en vacío', () => {
  it('se duerme con la cola vacía y despierta al recibir una señal', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T15:00:00Z'));
    const repos = createFakeRepos();
    const consultarCola = vi.spyOn(repos.rutas, 'tocaIntentar');
    const parar = startMotorRutas({
      repos,
      sender: { send: vi.fn() } as never,
      wa: { conectado: () => true } as never,
      gsg: crearPuertoEnEspera(),
      opciones: { ...OPCIONES_POR_DEFECTO, horaInicio: 0, horaFin: 24 },
      ahora: () => new Date(),
      usarPlantilla: () => false,
    });
    const vaciarMicrotareas = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

    try {
      await vaciarMicrotareas();
      expect(consultarCola).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(consultarCola).toHaveBeenCalledTimes(1);

      despertarMotorRutas();
      await vaciarMicrotareas();
      expect(consultarCola).toHaveBeenCalledTimes(2);
    } finally {
      parar();
    }
  });
});
