/**
 * Mensajes y conversaciones: lo que alimenta la pantalla de chat.
 *
 * Va en su propio fichero, como `automation`, porque es un modulo entero.
 * `Repos` lo expone como `repos.messages`.
 */

import type { Pool } from './pool.js';

export type Direction = 'in' | 'out';

export type MessageKind =
  | 'text'
  | 'location'
  | 'interactive'
  | 'template'
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'sticker'
  | 'unknown';

export interface Message {
  id: number;
  contactId: string;
  direction: Direction;
  wamid: string | null;
  kind: MessageKind;
  body: string | null;
  payload: Record<string, unknown> | null;
  status: string | null;
  deliveryId: number | null;
  createdAt: Date;
}

export interface NewMessage {
  contactId: string;
  direction: Direction;
  wamid?: string | null;
  kind: MessageKind;
  body?: string | null;
  payload?: Record<string, unknown> | null;
  status?: string | null;
  deliveryId?: number | null;
  createdAt?: Date;
}

/** Una fila de la lista de chats. */
export interface Conversation {
  contactId: string;
  phone: string;
  name: string | null;
  optInAt: Date | null;
  optOutAt: Date | null;
  lastInboundAt: Date | null;
  lastMessage: {
    direction: Direction;
    kind: MessageKind;
    body: string | null;
    status: string | null;
    createdAt: Date;
  } | null;
  unread: number;
  /** true si el cliente escribio en las ultimas 24 h. */
  windowOpen: boolean;
}

export interface MessagesRepo {
  add(message: NewMessage): Promise<number>;
  /** Estado de entrega que llega por webhook. */
  setStatusByWamid(wamid: string, status: string): Promise<void>;
  listConversations(query: { q?: string; limit: number; offset: number }): Promise<Conversation[]>;
  listMessages(contactId: string, limit: number, beforeId?: number): Promise<Message[]>;
  markRead(contactId: string, at: Date): Promise<void>;
  /** Total de mensajes entrantes sin leer, para el globo del menu. */
  unreadTotal(): Promise<number>;
  /** Entrantes desde esa fecha: la otra mitad del ratio salientes/entrantes. */
  contarEntrantesDesde(since: Date): Promise<number>;

  // --- respaldo y limpieza (ver src/archive) ---

  /**
   * El hilo entero, del mas viejo al mas nuevo, en paginas.
   *
   * `listMessages` no sirve para respaldar: pagina hacia atras y esta pensada
   * para la pantalla. Esta va hacia delante para poder recorrer un hilo de
   * miles de mensajes sin cargarlo todo en memoria.
   */
  pageForArchive(contactId: string, afterId: number, limit: number): Promise<Message[]>;
  /**
   * Borra los mensajes del contacto hasta `upToId` incluido.
   *
   * El tope importa: entre que se lee el hilo y se borra puede entrar un
   * mensaje nuevo, y ese no esta en el respaldo. Sin el tope se perderia.
   */
  deleteByContact(contactId: string, upToId: number): Promise<number>;
  /**
   * Lo que hace falta saber del hilo antes de respaldarlo: cuantos mensajes
   * tiene, entre que fechas y cual es el ultimo id.
   *
   * Ese ultimo id es el tope del borrado: lo que entre despues de leerlo no
   * esta en el respaldo y por eso no se borra.
   */
  summaryByContact(contactId: string): Promise<{
    count: number;
    firstAt: Date | null;
    lastAt: Date | null;
    lastId: number;
  }>;
  /**
   * Contactos cuyo ultimo mensaje es anterior a `before`, para el barrido
   * por inactividad. Solo los que tienen mensajes: los vacios no se archivan.
   */
  staleContacts(before: Date, limit: number): Promise<Array<{ contactId: string; lastAt: Date }>>;
}

interface Row {
  id: number;
  contact_id: string;
  direction: Direction;
  wamid: string | null;
  kind: MessageKind;
  body: string | null;
  payload: Record<string, unknown> | null;
  status: string | null;
  delivery_id: number | null;
  created_at: Date;
}

const toMessage = (r: Row): Message => ({
  id: r.id,
  contactId: r.contact_id,
  direction: r.direction,
  wamid: r.wamid,
  kind: r.kind,
  body: r.body,
  payload: r.payload,
  status: r.status,
  deliveryId: r.delivery_id,
  createdAt: r.created_at,
});

const WINDOW_MS = 24 * 60 * 60 * 1000;

export function createMessagesRepo(pool: Pool): MessagesRepo {
  return {
    async add(message) {
      const { rows } = await pool.query<{ id: number }>(
        `insert into messages
           (contact_id, direction, wamid, kind, body, payload, status, delivery_id, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8, coalesce($9, now()))
         on conflict (wamid) do update set status = coalesce(excluded.status, messages.status)
         returning id`,
        [
          message.contactId,
          message.direction,
          message.wamid ?? null,
          message.kind,
          message.body ?? null,
          message.payload ? JSON.stringify(message.payload) : null,
          message.status ?? null,
          message.deliveryId ?? null,
          message.createdAt ?? null,
        ],
      );
      return rows[0]!.id;
    },

    async setStatusByWamid(wamid, status) {
      await pool.query('update messages set status = $2 where wamid = $1', [wamid, status]);
    },

    async listConversations(query) {
      const params: unknown[] = [];
      let where = '';
      if (query.q?.trim()) {
        params.push(`%${query.q.trim()}%`);
        where = `where c.phone ilike $${params.length} or c.name ilike $${params.length}`;
      }

      const { rows } = await pool.query<{
        contact_id: string;
        phone: string;
        name: string | null;
        opt_in_at: Date | null;
        opt_out_at: Date | null;
        last_inbound_at: Date | null;
        direction: Direction | null;
        kind: MessageKind | null;
        body: string | null;
        status: string | null;
        message_at: Date | null;
        message_id: number | null;
        unread: number;
      }>(
        `select c.id as contact_id, c.phone, c.name, c.opt_in_at, c.opt_out_at, c.last_inbound_at,
                m.direction, m.kind, m.body, m.status, m.created_at as message_at, m.id as message_id,
                coalesce(u.unread, 0) as unread
           from contacts c
           left join lateral (
             select id, direction, kind, body, status, created_at
               from messages where contact_id = c.id
              order by created_at desc, id desc limit 1
           ) m on true
           left join lateral (
             select count(*)::int as unread
               from messages
              where contact_id = c.id and direction = 'in'
                and created_at > coalesce(c.chat_read_at, to_timestamp(0))
           ) u on true
          ${where}
          -- Los chats con mensajes primero, y dentro de ellos el mas reciente.
          -- El desempate por id importa: WhatsApp marca la hora en SEGUNDOS,
          -- asi que dos mensajes seguidos comparten instante y sin el la lista
          -- se reordena sola en cada refresco.
          order by coalesce(m.created_at, c.last_inbound_at) desc nulls last,
                   m.id desc nulls last, c.created_at desc
          limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, query.limit, query.offset],
      );

      const now = Date.now();
      return rows.map((r) => ({
        contactId: r.contact_id,
        phone: r.phone,
        name: r.name,
        optInAt: r.opt_in_at,
        optOutAt: r.opt_out_at,
        lastInboundAt: r.last_inbound_at,
        lastMessage: r.message_at
          ? {
              direction: r.direction!,
              kind: r.kind!,
              body: r.body,
              status: r.status,
              createdAt: r.message_at,
            }
          : null,
        unread: r.unread,
        windowOpen: Boolean(r.last_inbound_at && now - r.last_inbound_at.getTime() < WINDOW_MS),
      }));
    },

    async listMessages(contactId, limit, beforeId) {
      const params: unknown[] = [contactId];
      let cursor = '';
      if (beforeId) {
        params.push(beforeId);
        cursor = `and id < $${params.length}`;
      }
      const { rows } = await pool.query<Row>(
        `select * from messages
          where contact_id = $1 ${cursor}
          order by created_at desc, id desc
          limit $${params.length + 1}`,
        [...params, limit],
      );
      // Se consulta al reves para poder paginar hacia atras; se devuelve en
      // orden de lectura.
      return rows.reverse().map(toMessage);
    },

    async markRead(contactId, at) {
      await pool.query('update contacts set chat_read_at = $2 where id = $1', [contactId, at]);
    },

    async unreadTotal() {
      const { rows } = await pool.query<{ total: number }>(
        `select count(*)::int as total
           from messages m
           join contacts c on c.id = m.contact_id
          where m.direction = 'in'
            and m.created_at > coalesce(c.chat_read_at, to_timestamp(0))`,
      );
      return rows[0]?.total ?? 0;
    },
    async contarEntrantesDesde(since) {
      const { rows } = await pool.query<{ total: number }>(
        `select count(*)::int as total from messages where direction = 'in' and created_at >= $1`,
        [since],
      );
      return rows[0]?.total ?? 0;
    },

    async pageForArchive(contactId, afterId, limit) {
      const { rows } = await pool.query<Row>(
        `select * from messages
          where contact_id = $1 and id > $2
          order by id asc
          limit $3`,
        [contactId, afterId, limit],
      );
      return rows.map(toMessage);
    },

    async deleteByContact(contactId, upToId) {
      const { rowCount } = await pool.query(
        'delete from messages where contact_id = $1 and id <= $2',
        [contactId, upToId],
      );
      return rowCount ?? 0;
    },

    async summaryByContact(contactId) {
      const { rows } = await pool.query<{
        total: number;
        first_at: Date | null;
        last_at: Date | null;
        last_id: number | null;
      }>(
        `select count(*)::int as total, min(created_at) as first_at,
                max(created_at) as last_at, max(id) as last_id
           from messages where contact_id = $1`,
        [contactId],
      );
      const r = rows[0];
      return {
        count: r?.total ?? 0,
        firstAt: r?.first_at ?? null,
        lastAt: r?.last_at ?? null,
        lastId: Number(r?.last_id ?? 0),
      };
    },

    async staleContacts(before, limit) {
      const { rows } = await pool.query<{ contact_id: string; last_at: Date }>(
        `select contact_id, max(created_at) as last_at
           from messages
          group by contact_id
         having max(created_at) < $1
          order by max(created_at) asc
          limit $2`,
        [before, limit],
      );
      return rows.map((r) => ({ contactId: r.contact_id, lastAt: r.last_at }));
    },
  };
}
