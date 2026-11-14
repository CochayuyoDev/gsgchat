/**
 * El cupo diario de cada linea de WhatsApp y la reserva de cada envio.
 *
 * `reservar` es atomico: primero asegura la fila del dia y despues sube el
 * contador con un UPDATE que solo acierta si `usados < limite` (0 = sin limite).
 * Dos envios a la vez que se disputan el ultimo cupo: uno suma, el otro no
 * cambia ninguna fila y se entera. La reserva se guarda por clave de
 * idempotencia: reservar dos veces con la misma clave no cuenta dos veces.
 */

import type { Pool, Queryable } from './pool.js';
import type { MotivoSeleccion } from '../whatsapp/limite-diario.js';

export type EstadoReserva = 'reservado' | 'aceptado' | 'liberado' | 'incierto' | 'sin_linea';

export interface ReservaDeEnvio {
  clave: string;
  lineaId: string | null;
  dia: string | null;
  estado: EstadoReserva;
  motivo: string | null;
  deliveryId: number | null;
  wamid: string | null;
}

export type ResultadoReserva =
  | { ok: true; reserva: ReservaDeEnvio; /** Ya existia (un reintento): no se volvio a contar. */ repetida: boolean }
  | { ok: false; razon: 'sin_cupo'; limite: number; usados: number };

export interface UsoLineasRepo {
  limite(lineaId: string): Promise<number>;
  fijarLimite(lineaId: string, limite: number): Promise<void>;
  /** Mensajes aceptados o reservados ese dia (de Lima) por cada linea. */
  usoDelDia(dia: string): Promise<Map<string, number>>;
  reservar(input: { clave: string; lineaId: string; dia: string; motivo: MotivoSeleccion; contactId?: string | null }): Promise<ResultadoReserva>;
  anotarEntrega(clave: string, deliveryId: number): Promise<void>;
  aceptar(clave: string, wamid: string): Promise<void>;
  /** El proveedor lo rechazo: devuelve el cupo. Solo actua sobre una reserva abierta (reservado o incierto). */
  liberar(clave: string): Promise<boolean>;
  /** No se sabe si salio: el cupo se queda gastado hasta que se reconcilie. */
  marcarIncierto(clave: string): Promise<void>;
  /** Un envio que se quedo sin ninguna linea con cupo: guarda su entrega para no abrir una nueva en cada reintento. */
  anotarSinLinea(clave: string, deliveryId: number, contactId?: string | null): Promise<void>;
  porClave(clave: string): Promise<ReservaDeEnvio | null>;
  /** Si la entrega de una reserva abierta ya salio (markSent), la pasa a aceptada. Devuelve la reserva al terminar. */
  reconciliar(clave: string): Promise<ReservaDeEnvio | null>;
}

interface FilaReserva {
  clave: string;
  linea_id: string | null;
  dia: string | Date | null;
  estado: EstadoReserva;
  motivo: string | null;
  delivery_id: number | null;
  wamid: string | null;
}

const aReserva = (f: FilaReserva): ReservaDeEnvio => ({
  clave: f.clave,
  lineaId: f.linea_id,
  dia: f.dia instanceof Date ? f.dia.toISOString().slice(0, 10) : f.dia,
  estado: f.estado,
  motivo: f.motivo,
  deliveryId: f.delivery_id === null ? null : Number(f.delivery_id),
  wamid: f.wamid,
});

async function enTransaccion<T>(pool: Pool, fn: (c: Queryable) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (error) {
    await c.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    c.release();
  }
}

/** Un bloqueo cruzado entre dos transacciones (1213) o una espera agotada (1205) se repite: MySQL lo pide. */
async function conReintento<T>(fn: () => Promise<T>): Promise<T> {
  for (let intento = 1; ; intento++) {
    try {
      return await fn();
    } catch (error) {
      const codigo = (error as { errno?: number }).errno;
      if ((codigo === 1213 || codigo === 1205) && intento < 5) continue;
      throw error;
    }
  }
}

export function createUsoLineasRepo(pool: Pool): UsoLineasRepo {
  async function leer(q: Queryable, clave: string, bloquear = false): Promise<ReservaDeEnvio | null> {
    const { rows } = await q.query<FilaReserva>(
      `select clave, linea_id, dia, estado, motivo, delivery_id, wamid from whatsapp_number_reservas where clave = $1${bloquear ? ' for update' : ''}`,
      [clave],
    );
    return rows[0] ? aReserva(rows[0]) : null;
  }

  return {
    async limite(lineaId) {
      const { rows } = await pool.query<{ daily_limit: number }>('select daily_limit from whatsapp_numbers where id = $1', [lineaId]);
      return Number(rows[0]?.daily_limit ?? 0);
    },

    async fijarLimite(lineaId, limite) {
      await pool.query('update whatsapp_numbers set daily_limit = $2, updated_at = now(3) where id = $1', [lineaId, limite]);
    },

    async usoDelDia(dia) {
      const { rows } = await pool.query<{ linea_id: string; usados: number }>('select linea_id, usados from whatsapp_number_uso where dia = $1', [dia]);
      return new Map(rows.map((r) => [r.linea_id, Number(r.usados)]));
    },

    async reservar({ clave, lineaId, dia, motivo, contactId }) {
      // La fila del dia se asegura fuera de la transaccion (idempotente, sin bloqueos largos).
      await pool.query('insert ignore into whatsapp_number_uso (linea_id, dia, usados) values ($1, $2, 0)', [lineaId, dia]);
      return conReintento(() =>
        enTransaccion(pool, async (c): Promise<ResultadoReserva> => {
          // Siempre el mismo orden de bloqueos (primero el contador de la linea y el dia, despues la
          // reserva): las reservas de un mismo numero se hacen de una en una y no se cruzan.
          const { rows: filas } = await c.query<{ usados: number; limite: number }>(
            `select u.usados, n.daily_limit as limite
               from whatsapp_number_uso u join whatsapp_numbers n on n.id = u.linea_id
              where u.linea_id = $1 and u.dia = $2 for update`,
            [lineaId, dia],
          );
          const fila = filas[0];
          if (!fila) return { ok: false, razon: 'sin_cupo', limite: 0, usados: 0 };

          // La clave manda: un reintento del mismo envio encuentra su reserva y no gasta otro cupo.
          const previa = await leer(c, clave);
          if (previa && previa.estado !== 'liberado' && previa.estado !== 'sin_linea') return { ok: true, reserva: previa, repetida: true };

          const limite = Number(fila.limite);
          const usados = Number(fila.usados);
          if (limite > 0 && usados >= limite) return { ok: false, razon: 'sin_cupo', limite, usados };

          await c.query('update whatsapp_number_uso set usados = usados + 1, updated_at = now(3) where linea_id = $1 and dia = $2', [lineaId, dia]);
          await c.query(
            `insert into whatsapp_number_reservas (clave, linea_id, dia, estado, motivo, contact_id)
             values ($1, $2, $3, 'reservado', $4, $5)
             on duplicate key update linea_id = values(linea_id), dia = values(dia), estado = 'reservado', motivo = values(motivo), contact_id = values(contact_id), wamid = null, updated_at = now(3)`,
            [clave, lineaId, dia, motivo, contactId ?? null],
          );
          const reserva: ReservaDeEnvio = { clave, lineaId, dia, estado: 'reservado', motivo, deliveryId: previa?.deliveryId ?? null, wamid: null };
          return { ok: true, reserva, repetida: false };
        }),
      );
    },

    async anotarEntrega(clave, deliveryId) {
      await pool.query('update whatsapp_number_reservas set delivery_id = $2, updated_at = now(3) where clave = $1', [clave, deliveryId]);
    },

    async aceptar(clave, wamid) {
      await pool.query(`update whatsapp_number_reservas set estado = 'aceptado', wamid = $2, updated_at = now(3) where clave = $1 and estado in ('reservado','incierto')`, [clave, wamid]);
    },

    async liberar(clave) {
      const r = await leer(pool, clave);
      if (!r || (r.estado !== 'reservado' && r.estado !== 'incierto') || !r.lineaId || !r.dia) return false;
      const { lineaId, dia } = r;
      return conReintento(() =>
        enTransaccion(pool, async (c) => {
          // Mismo orden que `reservar`: primero el contador, despues la reserva.
          await c.query('select usados from whatsapp_number_uso where linea_id = $1 and dia = $2 for update', [lineaId, dia]);
          const { rowCount } = await c.query(
            `update whatsapp_number_reservas set estado = 'liberado', updated_at = now(3) where clave = $1 and estado in ('reservado','incierto')`,
            [clave],
          );
          if (!rowCount) return false;
          await c.query('update whatsapp_number_uso set usados = greatest(usados - 1, 0), updated_at = now(3) where linea_id = $1 and dia = $2', [lineaId, dia]);
          return true;
        }),
      );
    },

    async marcarIncierto(clave) {
      await pool.query(`update whatsapp_number_reservas set estado = 'incierto', updated_at = now(3) where clave = $1 and estado = 'reservado'`, [clave]);
    },

    async anotarSinLinea(clave, deliveryId, contactId) {
      await pool.query(
        `insert into whatsapp_number_reservas (clave, estado, delivery_id, contact_id) values ($1, 'sin_linea', $2, $3)
         on duplicate key update estado = if(estado in ('reservado','incierto','aceptado'), estado, 'sin_linea'), delivery_id = values(delivery_id), updated_at = now(3)`,
        [clave, deliveryId, contactId ?? null],
      );
    },

    async porClave(clave) {
      return leer(pool, clave);
    },

    async reconciliar(clave) {
      const r = await leer(pool, clave);
      if (!r || (r.estado !== 'reservado' && r.estado !== 'incierto') || r.deliveryId === null) return r;
      const { rows } = await pool.query<{ status: string; wamid: string | null }>('select status, wamid from deliveries where id = $1', [r.deliveryId]);
      const d = rows[0];
      if (d && d.wamid && ['sent', 'delivered', 'read'].includes(d.status)) {
        await pool.query(`update whatsapp_number_reservas set estado = 'aceptado', wamid = $2, updated_at = now(3) where clave = $1`, [clave, d.wamid]);
        return { ...r, estado: 'aceptado' as const, wamid: d.wamid };
      }
      return r;
    },
  };
}
