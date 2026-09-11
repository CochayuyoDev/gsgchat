/**
 * El indice de los respaldos de conversacion.
 *
 * Una fila por respaldo: de quien era el hilo, cuantos mensajes tenia, entre
 * que fechas y en que fichero quedo. El contenido no vive aqui -vive en disco,
 * comprimido- porque el objetivo de cerrar una conversacion es justamente que
 * la base deje de crecer.
 *
 * `Repos` lo expone como `repos.archives`.
 */

import type { Pool } from './pool.js';

/** Que disparo el respaldo. */
export type ArchiveReason = 'manual' | 'lead' | 'inactividad';

export interface ChatArchive {
  id: number;
  contactId: string;
  phone: string;
  name: string | null;
  /** Ruta relativa al directorio de respaldos. */
  file: string;
  bytes: number;
  messageCount: number;
  firstMessageAt: Date | null;
  lastMessageAt: Date | null;
  reason: ArchiveReason;
  sha256: string | null;
  createdAt: Date;
}

export type NewChatArchive = Omit<ChatArchive, 'id' | 'createdAt'>;

export interface ArchivesRepo {
  add(archive: NewChatArchive): Promise<ChatArchive>;
  get(id: number): Promise<ChatArchive | null>;
  list(query: { contactId?: string; q?: string; limit: number; offset: number }): Promise<ChatArchive[]>;
  /** Los respaldos de un contacto, del mas reciente al mas viejo. */
  byContact(contactId: string): Promise<ChatArchive[]>;
  remove(id: number): Promise<void>;
  /** Cuantos respaldos y cuanto ocupan: es lo que se ensena en el panel. */
  stats(): Promise<{ total: number; bytes: number; messages: number }>;
}

interface Row {
  id: number;
  contact_id: string;
  phone: string;
  name: string | null;
  file: string;
  bytes: number | string;
  message_count: number;
  first_message_at: Date | null;
  last_message_at: Date | null;
  reason: ArchiveReason;
  sha256: string | null;
  created_at: Date;
}

const toArchive = (r: Row): ChatArchive => ({
  id: r.id,
  contactId: r.contact_id,
  phone: r.phone,
  name: r.name,
  file: r.file,
  // bigint llega como cadena con el driver de pg; el panel lo quiere sumable.
  bytes: Number(r.bytes),
  messageCount: r.message_count,
  firstMessageAt: r.first_message_at,
  lastMessageAt: r.last_message_at,
  reason: r.reason,
  sha256: r.sha256,
  createdAt: r.created_at,
});

export function createArchivesRepo(pool: Pool): ArchivesRepo {
  return {
    async add(archive) {
      const { rows } = await pool.query<Row>(
        `insert into chat_archives
           (contact_id, phone, name, file, bytes, message_count,
            first_message_at, last_message_at, reason, sha256)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         returning *`,
        [
          archive.contactId,
          archive.phone,
          archive.name,
          archive.file,
          archive.bytes,
          archive.messageCount,
          archive.firstMessageAt,
          archive.lastMessageAt,
          archive.reason,
          archive.sha256,
        ],
      );
      return toArchive(rows[0]!);
    },

    async get(id) {
      const { rows } = await pool.query<Row>('select * from chat_archives where id = $1', [id]);
      return rows[0] ? toArchive(rows[0]) : null;
    },

    async list(query) {
      const params: unknown[] = [];
      const filtros: string[] = [];
      if (query.contactId) {
        params.push(query.contactId);
        filtros.push(`contact_id = $${params.length}`);
      }
      if (query.q?.trim()) {
        params.push(`%${query.q.trim()}%`);
        filtros.push(`(phone ilike $${params.length} or name ilike $${params.length})`);
      }
      const where = filtros.length ? `where ${filtros.join(' and ')}` : '';

      const { rows } = await pool.query<Row>(
        `select * from chat_archives ${where}
          order by created_at desc, id desc
          limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, query.limit, query.offset],
      );
      return rows.map(toArchive);
    },

    async byContact(contactId) {
      const { rows } = await pool.query<Row>(
        'select * from chat_archives where contact_id = $1 order by created_at desc, id desc',
        [contactId],
      );
      return rows.map(toArchive);
    },

    async remove(id) {
      await pool.query('delete from chat_archives where id = $1', [id]);
    },

    async stats() {
      const { rows } = await pool.query<{ total: number; bytes: string | number; messages: number }>(
        `select count(*)::int as total,
                coalesce(sum(bytes), 0) as bytes,
                coalesce(sum(message_count), 0)::int as messages
           from chat_archives`,
      );
      const r = rows[0];
      return {
        total: r?.total ?? 0,
        bytes: Number(r?.bytes ?? 0),
        messages: Number(r?.messages ?? 0),
      };
    },
  };
}
