import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeRepos } from './fakes.js';
import { startMotorRutas, OPCIONES_POR_DEFECTO } from '../src/rutas/motor.js';
import { crearPuertoEnEspera } from '../src/rutas/gsg.js';
import { Marcapasos, decidirRitmo, type FotoRitmo } from '../src/salud/ritmo.js';
import { POLITICA_CLOUD } from '../src/salud/politica.js';
import type { Monitor } from '../src/salud/monitor.js';
import type { Sender } from '../src/outbound/sender.js';

afterEach(() => vi.useRealTimers());

describe('cola de pedidos: cadencia con reloj simulado y sin WhatsApp real', () => {
  for (const cantidad of [10, 100, 1000]) {
    for (const segundos of [15, 22.5, 30]) {
      it(`${cantidad} pedidos, ${segundos} segundos entre mensajes, sin demora adicional`, async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-15T05:00:00Z'));
        const inicio = Date.now();
        const repos = createFakeRepos();
        const politica = {
          ...POLITICA_CLOUD, soloRitmo: true, horaInicio: 0, horaFin: 24,
          diasPermitidos: [], pausaMinMs: 15_000, pausaMaxMs: 30_000,
        };
        const azar = () => (segundos - 15) / 15;
        const marcapasos = new Marcapasos(() => politica, azar);
        const foto = (ahora: Date): FotoRitmo => ({
          ahora, factor: 1, ultimoMinuto: marcapasos.enUltimoMinuto(ahora),
          ultimaHora: marcapasos.enUltimaHora(ahora),
          ultimoEnvioAt: marcapasos.ultimoEnvioAt(),
          pausaSorteadaMs: marcapasos.pausaSorteadaMs(),
          destinatariosUnicos24h: 0, limiteTier: null,
          nuevosContactosHoy: 0, esContactoNuevo: true,
        });
        const salud = {
          marcapasos, factor: () => 1,
          fotoRitmo: async (_contacto: unknown, ahora: Date) => foto(ahora),
        } as unknown as Monitor;
        const enviados: Array<{ phone: string; at: number }> = [];
        const sender: Sender = {
          async send(job) {
            expect(decidirRitmo(foto(new Date()), politica)).toEqual({ ok: true });
            enviados.push({ phone: job.phone, at: Date.now() });
            marcapasos.anotar(new Date());
            return { ok: true, wamid: `simulado.${enviados.length}`, deliveryId: enviados.length };
          },
        };
        const lote = await repos.rutas.crearLote({ nombre: 'Simulación sin envíos reales' });
        const telefonos = Array.from({ length: cantidad }, (_, i) => String(51910000000 + i));
        await repos.rutas.agregarSolicitudes(lote.id, telefonos.map((phone, i) => ({
          phone, telefonoCrudo: phone, referencia: `SIM-${i + 1}`,
        })));
        await repos.rutas.cambiarEstadoLote(lote.id, 'enviando');
        const parar = startMotorRutas({
          repos, sender, salud, politica: () => politica,
          wa: { conectado: () => true } as never,
          gsg: crearPuertoEnEspera(), usarPlantilla: () => false,
          ahora: () => new Date(), azar,
          opciones: { ...OPCIONES_POR_DEFECTO, horaInicio: 0, horaFin: 24,
            esperaRespuestaMinutos: 1440 },
        });
        try {
          await vi.advanceTimersByTimeAsync(0);
          expect(enviados).toHaveLength(1);
          for (let i = 1; i < cantidad; i++) {
            await vi.advanceTimersByTimeAsync(segundos * 1000 - 1);
            expect(enviados).toHaveLength(i);
            await vi.advanceTimersByTimeAsync(1);
            expect(enviados).toHaveLength(i + 1);
            expect(enviados[i]!.at - enviados[i - 1]!.at).toBe(segundos * 1000);
          }
          expect(enviados.map((e) => e.phone)).toEqual(telefonos);
          expect(new Set(enviados.map((e) => e.phone)).size).toBe(cantidad);
          expect(enviados.at(-1)!.at - inicio).toBe((cantidad - 1) * segundos * 1000);
          expect(repos.rutas._solicitudes.every((s) => s.intentos === 1 && s.estado === 'enviado')).toBe(true);
          console.log(JSON.stringify({ cantidad, intervaloSegundos: segundos,
            primerEnvioSegundos: (enviados[0]!.at - inicio) / 1000,
            ultimoEnvioSegundos: (enviados.at(-1)!.at - inicio) / 1000,
            duplicados: 0, pausasAdicionales: 0 }));
        } finally {
          parar();
        }
      }, 30_000);
    }
  }
});
