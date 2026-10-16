import type { Repos } from '../db/repos.js';
import type { Monitor, SnapshotSalud } from './monitor.js';
import { esPausaAutomatica } from './monitor.js';
import type { Politica } from './politica.js';
import { enHorario, Marcapasos } from './ritmo.js';

/** Control compartido de horario y pausa. No evalúa riesgo ni aplica rampas. */
export async function crearControlEnvios(deps: {
  repos: Repos; politica: () => Politica; phoneNumberId: () => string;
  ahora?: () => Date; azar?: () => number; reanudarCola?: () => Promise<void>;
}): Promise<Monitor> {
  const ahora = deps.ahora ?? (() => new Date());
  const marcapasos = new Marcapasos(deps.politica, deps.azar);
  const estado = await deps.repos.numberState.get(deps.phoneNumberId());
  await Promise.all([deps.repos.rutas.liberarFrenosCuenta(), deps.repos.entregas.liberarFrenosCuenta()]);
  if (estado.paused && esPausaAutomatica(estado.pausedReason)) await deps.repos.numberState.setPaused(deps.phoneNumberId(), false);
  await deps.repos.numberState.setRiesgo(deps.phoneNumberId(), {
    riesgo: 0, nivel: 'verde', factor: 1, motivos: [], pausadaHasta: null, rampaDesde: null, ultimaEvaluacion: ahora(),
  });
  const ultimo = await deps.repos.deliveries.ultimoIniciadoAt();
  if (ultimo) marcapasos.sembrar(ultimo);
  const neutro = () => ({ puntos: 0, nivel: 'verde' as const, factor: 1, factorEfectivo: 1, sinMarketing: false, motivos: [], descansoMs: null });
  const vacio = async () => undefined;
  return {
    soloRitmo: true,
    marcapasos, factor: () => 1, sinMarketing: () => false,
    evaluar: async () => neutro(), registrarEvento: vacio,
    registrarErrorEnvio: async () => null, registrarFalloWebhook: vacio,
    registrarDesconexion: vacio, registrarBaja: vacio, registrarQueja: vacio,
    async reanudar() {
      await deps.repos.numberState.setPaused(deps.phoneNumberId(), false);
      await deps.reanudarCola?.();
    },
    resumen: async () => ({ nivel: 'verde', factor: 1, motivos: [], pausadaHasta: null }),
    async fotoRitmo(_contacto, momento) {
      return { ahora: momento, factor: 1, ultimoMinuto: 0, ultimaHora: 0, ultimoEnvioAt: marcapasos.ultimoEnvioAt(),
        pausaSorteadaMs: marcapasos.pausaSorteadaMs(), destinatariosUnicos24h: 0, limiteTier: null,
        nuevosContactosHoy: 0, esContactoNuevo: false };
    },
    async snapshot(): Promise<SnapshotSalud> {
      const momento = ahora();
      const politica = deps.politica();
      return { ...neutro(), pausadaHasta: null, rampaDesde: null, rampaHasta: null,
        numero: await deps.repos.numberState.get(deps.phoneNumberId()), politica,
        ritmo: { ultimoMinuto: marcapasos.enUltimoMinuto(momento), ultimaHora: marcapasos.enUltimaHora(momento),
          hoy: await deps.repos.counters.totalForDay(deps.phoneNumberId(), momento), cupoHoy: Number.MAX_SAFE_INTEGER,
          proximoEnvioMs: marcapasos.proximoEnvioEn(momento, 1), destinatariosUnicos24h: 0, limiteTier: null,
          nuevosContactosHoy: 0, enHorario: enHorario(momento, politica) },
        ventanas: { ultimos50: { enviados: 0, fallidos: 0, porCodigo: {} },
          dia: { enviados: 0, entregados: 0, enviadosMaduros: 0, entregadosMaduros: 0, bajas: 0, quejas: 0, entrantes: 0, porCodigo: {} },
          hora: { fallidos: 0, porCodigo: {}, desconexiones: 0 } },
        contactosSuprimidos: 0, plantillas: [], eventos: [], ultimaEvaluacion: null };
    },
  };
}
