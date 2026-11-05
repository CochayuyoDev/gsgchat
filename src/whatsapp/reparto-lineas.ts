/**
 * Por que linea entra un cliente nuevo.
 *
 * Al azar entre las lineas conectadas: de cien clientes pueden caer 30, 25, 36 y
 * 9 en cuatro numeros, sin un patron de reparto. Solo decide para quien no tiene
 * linea: el que ya la tiene se queda con ella.
 */

import type { LineasContactoRepo } from '../db/lineas-contacto.js';
import type { Repos } from '../db/repos.js';
import { esPausaAutomatica, inicioDelDia } from '../salud/monitor.js';
import type { Politica } from '../salud/politica.js';
import { dailyCapFor } from '../outbound/throttle.js';
import type { Linea } from './lineas.js';
import type { RegistroClientes } from './registro.js';

export interface CargaDeLinea {
  id: string;
  etiqueta: string;
  numero: string;
  posicion: number;
  conectada: boolean;
  /** Clientes que lleva en total. */
  clientes: number;
  /** Clientes que recibio hoy. */
  nuevosHoy: number;
  /** Mensajes iniciados por la empresa hoy. */
  enviadosHoy: number;
  cupoDiario: number;
  /** Pausada a mano por quien opera: no recibe clientes nuevos. */
  pausada: boolean;
}

/**
 * La linea que toca, sorteada. Antes del sorteo se descartan las pausadas y las
 * que ya gastaron su cupo, porque de ellas no saldria el mensaje (si todas lo
 * gastaron, se sortea igual: el cupo solo frena, no pierde el mensaje).
 */
export function elegirLineaAlAzar(cargas: CargaDeLinea[], azar: () => number = Math.random): string | null {
  const activas = cargas.filter((c) => !c.pausada);
  const conCupo = activas.filter((c) => c.enviadosHoy < c.cupoDiario);
  const candidatas = conCupo.length ? conCupo : activas;
  return candidatas[Math.floor(azar() * candidatas.length)]?.id ?? null;
}

export interface RepartoDeLineas {
  /** Cada linea habilitada con lo que lleva hoy. */
  cargas(at?: Date): Promise<CargaDeLinea[]>;
  /** La linea conectada que toca para un cliente nuevo, sin contar `excluir`. */
  elegir(excluir?: string | null): Promise<string | null>;
  cambios: LineasContactoRepo['cambios'];
}

export function crearRepartoDeLineas(deps: {
  registro: RegistroClientes;
  repos: Pick<Repos, 'lineasContacto' | 'numberState' | 'counters'>;
  politica: () => Politica;
  /** Con que id lleva esa linea su cupo y su estado (ver `LineaDeEnvio.identidad`). */
  identidadDe: (linea: Linea) => string;
}): RepartoDeLineas {
  const { registro, repos, politica } = deps;

  async function cargas(at: Date = new Date()): Promise<CargaDeLinea[]> {
    const p = politica();
    const [estados, porLinea] = await Promise.all([registro.estados(), repos.lineasContacto.carga(inicioDelDia(at, p.timezone))]);
    return Promise.all(
      estados.map(async ({ linea, conectada }) => {
        const identidad = deps.identidadDe(linea);
        const [estado, enviadosHoy] = await Promise.all([repos.numberState.get(identidad), repos.counters.totalForDay(identidad, at)]);
        const propia = porLinea.find((c) => c.lineaId === linea.id);
        return {
          id: linea.id,
          etiqueta: linea.etiqueta,
          numero: linea.telefono,
          posicion: linea.posicion,
          conectada,
          clientes: propia?.clientes ?? 0,
          nuevosHoy: propia?.nuevos ?? 0,
          enviadosHoy,
          cupoDiario: dailyCapFor(estado.warmupStartedOn, at, p.warmup),
          // Igual que en las guardas: con «solo ritmo» una pausa automatica no frena nada.
          pausada: estado.paused && !(p.soloRitmo && esPausaAutomatica(estado.pausedReason)),
        };
      }),
    );
  }

  return {
    cargas,
    async elegir(excluir) {
      return elegirLineaAlAzar((await cargas()).filter((c) => c.conectada && c.id !== excluir));
    },
    cambios: (opciones) => repos.lineasContacto.cambios(opciones),
  };
}
