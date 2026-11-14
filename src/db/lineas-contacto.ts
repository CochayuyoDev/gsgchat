/**
 * Que linea de WhatsApp lleva a cada cliente, y por que cambio.
 *
 * Un cliente se queda con su linea: cambiarle el numero en medio de un
 * seguimiento confunde y parece otra empresa. Cada movimiento pasa por aqui y
 * se hace con la condicion de que siga en la linea de la que se parte, asi dos
 * envios a la vez no pueden dejar al mismo cliente en dos lineas.
 */

import type { Queryable } from './pool.js';

export type MotivoCambioLinea =
  /** El sistema le eligio linea por primera vez. */
  | 'primer_contacto'
  /** El cliente escribio por otra linea: se le contesta por donde escribio. */
  | 'cliente_escribio'
  /** Una persona eligio la linea en el chat (o escribio desde ese telefono). */
  | 'persona'
  /** Su linea se quito o se deshabilito. */
  | 'linea_no_disponible'
  /** Su linea paso sin conexion mas tiempo del que se espera. */
  | 'linea_caida';

export interface CambioDeLinea {
  id: number;
  contactId: string;
  telefono: string;
  nombre: string | null;
  desdeLineaId: string | null;
  desdeEtiqueta: string | null;
  aLineaId: string;
  aEtiqueta: string | null;
  motivo: MotivoCambioLinea;
  createdAt: Date;
}

export interface CargaPorLinea {
  lineaId: string;
  /** Clientes que lleva esta linea. */
  clientes: number;
  /** De esos, cuantos le llegaron desde `desde`. */
  nuevos: number;
}

export interface LineasContactoRepo {
  /** Le pone linea a un cliente que no tiene. Devuelve la que tiene al terminar (otro envio pudo ganar). */
  fijarSiNoTiene(contactId: string, lineaId: string, at: Date): Promise<string | null>;
  /** Lo pasa de `desde` a `a` si sigue en `desde` (o sin linea). Devuelve la que tiene al terminar. */
  cambiar(contactId: string, desde: string | null, a: string, motivo: MotivoCambioLinea, at: Date): Promise<string | null>;
  carga(desde: Date): Promise<CargaPorLinea[]>;
  /** Los cambios de verdad, del mas nuevo al mas viejo (no cuenta el primer contacto). */
  cambios(opciones?: { limite?: number; contactId?: string }): Promise<CambioDeLinea[]>;
}

async function mover(pool: Queryable, contactId: string, desde: string | null, a: string, motivo: MotivoCambioLinea, at: Date): Promise<boolean> {
  const { rowCount } = await pool.query(
    'update contacts set whatsapp_number_id = $3, linea_asignada_at = $4 where id = $1 and (whatsapp_number_id is null or whatsapp_number_id <=> $2)',
    [contactId, desde, a, at],
  );
  if (!rowCount) return false;
  // La etiqueta se copia: la linea se puede renombrar o quitar y el registro tiene que seguir diciendo cual era.
  await pool.query(
    `insert into contacto_linea_cambios (contact_id, desde_linea_id, desde_etiqueta, a_linea_id, a_etiqueta, motivo, created_at)
     values ($1, $2, (select label from whatsapp_numbers where id = $2), $3, (select label from whatsapp_numbers where id = $3), $4, $5)`,
    [contactId, desde, a, motivo, at],
  );
  return true;
}

async function lineaActual(pool: Queryable, contactId: string): Promise<{ linea: string | null; desde: Date | null } | null> {
  const { rows } = await pool.query<{ whatsapp_number_id: string | null; linea_asignada_at: Date | null }>(
    'select whatsapp_number_id, linea_asignada_at from contacts where id = $1',
    [contactId],
  );
  return rows[0] ? { linea: rows[0].whatsapp_number_id, desde: rows[0].linea_asignada_at } : null;
}

/**
 * Lo que un mensaje guardado le hace a la linea del cliente: si el cliente
 * escribe por otra, se le sigue por esa. Un mensaje anterior a la asignacion
 * no mueve nada: al vincular un numero llega su historial, y sin esta guarda
 * todos sus chats viejos se pasarian a esa linea de golpe.
 */
export async function seguirLineaDelMensaje(pool: Queryable, m: { contactId: string; lineaId: string; direction: string; createdAt?: Date | null }): Promise<void> {
  const actual = await lineaActual(pool, m.contactId);
  if (!actual || actual.linea === m.lineaId) return;
  const fecha = m.createdAt ?? new Date();
  if (actual.linea && actual.desde && fecha.getTime() < actual.desde.getTime()) return;
  await mover(pool, m.contactId, actual.linea, m.lineaId, m.direction === 'in' ? 'cliente_escribio' : 'persona', fecha);
}

export function createLineasContactoRepo(pool: Queryable): LineasContactoRepo {
  return {
    async fijarSiNoTiene(contactId, lineaId, at) {
      await mover(pool, contactId, null, lineaId, 'primer_contacto', at);
      return (await lineaActual(pool, contactId))?.linea ?? null;
    },

    async cambiar(contactId, desde, a, motivo, at) {
      await mover(pool, contactId, desde, a, motivo, at);
      return (await lineaActual(pool, contactId))?.linea ?? null;
    },

    async carga(desde) {
      // Los grupos no cuentan: no se reparten, viven en la linea de la que son miembros.
      const { rows } = await pool.query<{ linea: string; clientes: number; nuevos: number | null }>(
        `select whatsapp_number_id as linea, count(*) as clientes, sum(linea_asignada_at >= $1) as nuevos
           from contacts
          where whatsapp_number_id is not null and tipo <> 'grupo'
          group by whatsapp_number_id`,
        [desde],
      );
      return rows.map((r) => ({ lineaId: r.linea, clientes: Number(r.clientes), nuevos: Number(r.nuevos ?? 0) }));
    },

    async cambios(opciones = {}) {
      const limite = Math.min(Math.max(opciones.limite ?? 20, 1), 200);
      const { rows } = await pool.query<{
        id: number; contact_id: string; phone: string; name: string | null; desde_linea_id: string | null; desde_etiqueta: string | null;
        a_linea_id: string; a_etiqueta: string | null; motivo: MotivoCambioLinea; created_at: Date;
      }>(
        `select l.id, l.contact_id, c.phone, c.name, l.desde_linea_id, l.desde_etiqueta, l.a_linea_id, l.a_etiqueta, l.motivo, l.created_at
           from contacto_linea_cambios l
           join contacts c on c.id = l.contact_id
          where l.desde_linea_id is not null ${opciones.contactId ? 'and l.contact_id = $1' : ''}
          order by l.created_at desc, l.id desc
          limit ${limite}`,
        opciones.contactId ? [opciones.contactId] : [],
      );
      return rows.map((r) => ({
        id: r.id,
        contactId: r.contact_id,
        telefono: r.phone,
        nombre: r.name,
        desdeLineaId: r.desde_linea_id,
        desdeEtiqueta: r.desde_etiqueta,
        aLineaId: r.a_linea_id,
        aEtiqueta: r.a_etiqueta,
        motivo: r.motivo,
        createdAt: r.created_at,
      }));
    },
  };
}
