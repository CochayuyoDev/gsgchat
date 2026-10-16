/** Regresión: los ajustes antiguos nunca permiten envíos ilimitados. */
import { describe, expect, it } from 'vitest';
import { crearMotor, pasoDe, OPCIONES_POR_DEFECTO } from '../src/rutas/motor.js';
import { ajustesPorDefecto, aplicarAjustes, createAjustesRepo } from '../src/rutas/ajustes.js';
import { crearPuertoEnEspera } from '../src/rutas/gsg.js';
import { createFakeRepos } from './fakes.js';
import type { Solicitud } from '../src/db/rutas.js';
import type { Pool } from '../src/db/pool.js';
import type { Sender, SendJob } from '../src/outbound/sender.js';

describe('insistencia con intervalo y máximo configurables', () => {
  it('un ajuste antiguo no anula el máximo de mensajes', () => {
    const opciones = { ...OPCIONES_POR_DEFECTO, pedirUbicacionCadaMinutos: 1440 };
    expect(pasoDe({ estado: 'enviado', intentos: 7 } as Solicitud, { ...opciones, maxIntentos: 7 })).toBe('derivar');
    expect(aplicarAjustes(opciones, { ...ajustesPorDefecto(opciones), pedirUbicacionCadaMinutos: 15, maxIntentos: 7 })).toMatchObject({ pedirUbicacionCadaMinutos: 0, maxIntentos: 7 });
  });

  it('leer ajustes persistidos desactiva el modo antiguo y conserva intervalo y máximo', async () => {
    const pool = { query: async () => ({ rows: [{ value: JSON.stringify({ pedirUbicacionCadaMinutos: 1440, esperaRespuestaMinutos: 12, maxIntentos: 7 }) }] }) } as unknown as Pool;
    expect(await createAjustesRepo(pool).get(ajustesPorDefecto(OPCIONES_POR_DEFECTO))).toMatchObject({ pedirUbicacionCadaMinutos: 0, esperaRespuestaMinutos: 12, maxIntentos: 7 });
  });

  it('envía exactamente siete mensajes cada cinco minutos y luego se detiene', async () => {
    let ahora = new Date('2026-10-14T15:00:00Z');
    const repos = createFakeRepos();
    const lote = await repos.rutas.crearLote({ nombre: 'Con límite' });
    await repos.rutas.agregarSolicitudes(lote.id, [{ telefonoCrudo: '987654321', phone: '51987654321', nombre: 'Ana' }]);
    await repos.rutas.cambiarEstadoLote(lote.id, 'enviando');
    await repos.rutas.ajustes.set({ esperaRespuestaMinutos: 5, maxIntentos: 7, esperaFinalMinutos: 0 }, ajustesPorDefecto(OPCIONES_POR_DEFECTO));
    const enviados: SendJob[] = [];
    const sender: Sender = { async send(job) { enviados.push(job); return { ok: true, wamid: `w.${enviados.length}`, deliveryId: enviados.length }; } };
    const motor = crearMotor({ repos, sender, gsg: crearPuertoEnEspera(), opciones: OPCIONES_POR_DEFECTO, usarPlantilla: () => false, ahora: () => ahora, azar: () => 0 });
    expect((await motor.tick()).accion).toBe('envio');
    for (let i = 1; i < 7; i++) {
      ahora = new Date(ahora.getTime() + 4 * 60_000);
      await motor.tick();
      expect(enviados).toHaveLength(i);
      ahora = new Date(ahora.getTime() + 60_000);
      expect((await motor.tick()).accion).toBe('envio');
      expect(enviados).toHaveLength(i + 1);
    }
    ahora = new Date(ahora.getTime() + 5 * 60_000);
    expect((await motor.tick()).accion).toBe('derivacion');
    ahora = new Date(ahora.getTime() + 60 * 60_000);
    await motor.tick();
    expect(enviados).toHaveLength(7);
    expect(repos.rutas._solicitudes[0]).toMatchObject({ intentos: 7, requiereHumano: true, proximoIntentoAt: null });
  });
});
