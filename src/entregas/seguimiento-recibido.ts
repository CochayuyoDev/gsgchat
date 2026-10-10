/**
 * El seguimiento que GSG EMPUJA (POST /api/v1/seguimiento): GSGchat no se lo
 * pide nunca; si GSG lo manda, se guarda el ultimo de cada tracking y manda
 * sobre el armado con datos propios mientras sea reciente y valido.
 */
import type { Pool } from '../db/pool.js';
import { leerSeguimiento, type FuenteSeguimiento } from './seguimiento-gsg.js';

export interface SeguimientoRecibido {
  tracking: string;
  cuerpo: unknown;
  recibidoAt: Date;
}

export interface SeguimientosRecibidosRepo {
  /** Guarda (o reemplaza) el ultimo seguimiento de ese tracking. */
  guardar(s: SeguimientoRecibido): Promise<void>;
  leer(tracking: string): Promise<SeguimientoRecibido | null>;
}

/** Cuanto vale un seguimiento empujado por GSG sin que mande otro. */
export const VIGENCIA_RECIBIDO_MS = 30 * 60_000;

export function crearSeguimientosRecibidosMemoria(): SeguimientosRecibidosRepo {
  const guardados = new Map<string, SeguimientoRecibido>();
  return {
    async guardar(s) {
      if (guardados.size >= 5000 && !guardados.has(s.tracking)) guardados.delete(guardados.keys().next().value!);
      guardados.set(s.tracking, { ...s });
    },
    async leer(tracking) {
      return guardados.get(tracking) ?? null;
    },
  };
}

interface FilaSeguimiento {
  tracking: string;
  cuerpo: unknown;
  recibido_at: Date | string;
}

export function crearSeguimientosRecibidosSql(pool: Pool): SeguimientosRecibidosRepo {
  return {
    async guardar(s) {
      await pool.query(
        `insert into seguimientos_gsg (tracking, cuerpo, recibido_at) values ($1, $2, $3)
         on duplicate key update cuerpo = values(cuerpo), recibido_at = values(recibido_at)`,
        [s.tracking, JSON.stringify(s.cuerpo), s.recibidoAt],
      );
    },
    async leer(tracking) {
      const { rows } = await pool.query<FilaSeguimiento>('select tracking, cuerpo, recibido_at from seguimientos_gsg where tracking = $1', [tracking]);
      const r = rows[0];
      if (!r) return null;
      let cuerpo: unknown = r.cuerpo;
      if (typeof cuerpo === 'string') {
        try {
          cuerpo = JSON.parse(cuerpo);
        } catch {
          return null;
        }
      }
      return { tracking: r.tracking, cuerpo, recibidoAt: r.recibido_at instanceof Date ? r.recibido_at : new Date(r.recibido_at) };
    },
  };
}

/**
 * Primero lo que GSG empujo (si es reciente y pasa la validacion); si no, lo
 * que arma GSGchat con sus datos. Ninguna de las dos llama a GSG.
 */
export function crearFuenteCombinada(recibidos: SeguimientosRecibidosRepo, propia: FuenteSeguimiento | null, reloj: () => Date = () => new Date()): FuenteSeguimiento {
  return async (tracking: string) => {
    const ahora = reloj();
    const recibido = await recibidos.leer(tracking).catch(() => null);
    if (recibido && ahora.getTime() - recibido.recibidoAt.getTime() <= VIGENCIA_RECIBIDO_MS && (await leerSeguimiento(recibido.cuerpo, tracking, undefined, ahora))) {
      return recibido.cuerpo;
    }
    return propia ? propia(tracking) : null;
  };
}
