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

export interface ActividadDia {
  /** YYYY-MM-DD */
  dia: string;
  entrantes: number;
  salientes: number;
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
  /** 'grupo' = un grupo de WhatsApp: `phone` es su jid y no se le automatiza nada. */
  tipo: 'persona' | 'grupo';
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
  /** Ajustes de la lista (ver migracion 037). Fecha = puesto; null = no. */
  fijadoAt: Date | null;
  silenciadoAt: Date | null;
  apartadoAt: Date | null;
}

export interface MessagesRepo {
  add(message: NewMessage): Promise<number>;
  /** Estado de entrega que llega por webhook. */
  setStatusByWamid(wamid: string, status: string): Promise<void>;
  listConversations(query: { q?: string; limit: number; offset: number; incluirApartados?: boolean }): Promise<Conversation[]>;
  listMessages(contactId: string, limit: number, beforeId?: number): Promise<Message[]>;
  markRead(contactId: string, at: Date): Promise<void>;
  /** Total de mensajes entrantes sin leer, para el globo del menu. */
  unreadTotal(): Promise<number>;
  /** Entrantes desde esa fecha: la otra mitad del ratio salientes/entrantes. */
  contarEntrantesDesde(since: Date): Promise<number>;
  /**
   * Mensajes por dia desde esa fecha, entrantes y salientes, para la grafica
   * del inicio. Los dias sin nada no aparecen: la pantalla los rellena.
   */
  actividadPorDia(since: Date): Promise<ActividadDia[]>;
  /** Conversaciones cuyo ultimo mensaje es del cliente y nadie ha leido. */
  contarEsperandoRespuesta(): Promise<number>;
  /**
   * Si ese mensaje ya esta guardado. Tras un reinicio, WhatsApp Web vuelve a
   * entregar lo reciente: lo que ya se atendio no se atiende dos veces.
   */
  existsByWamid(wamid: string): Promise<boolean>;
  /** Si ese mensaje ya tiene su fichero (foto, audio...) guardado. */
  tieneAdjunto(wamid: string): Promise<boolean>;
  /**
   * El remitente lo "elimino para todos": se marca (payload.borradoPorRemitente)
   * y se conserva tal cual. Devuelve si existia.
   */
  marcarBorradoPorRemitente(wamid: string, at: Date): Promise<boolean>;
  /**
   * Completa un mensaje que se guardo sin contenido con lo que llego despues.
   *
   * Es el caso del "ver una vez": primero entra el sobre vacio y, si el
   * telefono lo reenvia, la foto. Solo completa, nunca degrada: si la fila
   * ya tiene fichero no se toca. Devuelve si cambio algo.
   */
  completarPorWamid(wamid: string, datos: { kind: MessageKind; body: string | null; payload: Record<string, unknown> | null }): Promise<boolean>;

  // --- lo que el chat necesita para citar, reaccionar, destacar y buscar ---

  /**
   * Cuelga una reaccion DEL mensaje reaccionado, no como mensaje suelto.
   *
   * Se guarda en `payload.reacciones` como un objeto {quien: {emoji, at}}:
   * asi reaccionar dos veces reemplaza en vez de acumular, y quitarla es
   * borrar la clave. `emoji` vacio = la quito. Devuelve si el mensaje existia.
   */
  reaccionar(wamid: string, quien: string, emoji: string, at: Date): Promise<boolean>;
  /** Un mensaje por su id, dentro de su conversacion (para citar o reenviar). */
  porId(contactId: string, id: number): Promise<Message | null>;
  /** Varios mensajes por id, en orden de lectura. Ignora los que no son del chat. */
  porIds(contactId: string, ids: number[]): Promise<Message[]>;
  /** Estrella: `payload.destacado` con la fecha. Devuelve cuantos cambiaron. */
  destacar(contactId: string, ids: number[], destacado: boolean, at: Date): Promise<number>;
  /**
   * "Eliminar para mi": aqui tampoco se borra la fila.
   *
   * Se marca `payload.eliminadoAqui` y el hilo deja de pintarlo, igual que
   * `borradoPorRemitente`. Un borrado de verdad se llevaria por delante el
   * respaldo y la traza, que es justo lo que nadie quiere al pulsar sin mirar.
   */
  ocultar(contactId: string, ids: number[], at: Date): Promise<number>;
  /** El mensaje se edito en WhatsApp: cuerpo nuevo y `payload.editadoAt`. */
  editarCuerpo(contactId: string, id: number, texto: string, at: Date): Promise<boolean>;
  /** Busca texto dentro de una conversacion. Del mas nuevo al mas viejo. */
  buscar(query: { contactId: string; q: string; limit: number }): Promise<Message[]>;
  /** Los mensajes con estrella, de un chat o de todos, con de quien son. */
  destacados(query: { contactId?: string; limit: number }): Promise<Array<Message & { phone: string; name: string | null }>>;

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
   * El mensaje mas antiguo del hilo POR FECHA, con id de WhatsApp.
   *
   * No es el de menor `id`: el historial que manda el telefono entra
   * despues (ids mas altos) con fechas mas viejas. Es el ancla para pedirle
   * al telefono "lo anterior a esto".
   */
  masAntiguo(contactId: string): Promise<Message | null>;
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

/**
 * Quien reacciono, para poder agrupar y para poder quitar la suya.
 *
 * En un grupo reaccionan varios, y ahi el telefono del autor es lo unico que
 * los distingue. Fuera de un grupo basta con "el cliente" o "yo": la
 * conversacion tiene dos lados.
 */
function quienReacciona(message: NewMessage): string {
  const autor = (message.payload as { autor?: { telefono?: string | null } } | null)?.autor;
  return autor?.telefono || (message.direction === 'in' ? 'cliente' : 'yo');
}

/** El id del mensaje al que se reacciono, si el entrante lo trae. */
function reaccionDe(message: NewMessage): { emoji: string; sobre: string } | null {
  const reaction = (message.payload as { reaction?: { emoji?: string; message_id?: string } } | null)?.reaction;
  if (!reaction || !reaction.message_id) return null;
  return { emoji: String(reaction.emoji ?? ''), sobre: reaction.message_id };
}

export function createMessagesRepo(pool: Pool): MessagesRepo {
  const repo: MessagesRepo = {
    async add(message) {
      /**
       * Una reaccion no es un mensaje: es una marca sobre otro.
       *
       * Antes entraba como una fila mas ("(reaccion a un mensaje)") y el hilo
       * se llenaba de globos sueltos que no se sabia a que contestaban. Se
       * intercepta aqui, en el unico sitio por el que pasa TODO lo que se
       * guarda, para no tener que tocar cada camino de entrada.
       */
      const reaccion = reaccionDe(message);
      if (reaccion) {
        await repo.reaccionar(reaccion.sobre, quienReacciona(message), reaccion.emoji, message.createdAt ?? new Date());
        // No hay fila nueva que devolver: el 0 dice "no se guardo nada".
        return 0;
      }

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
      // El doble check no retrocede: un "sent" reenviado tras un "read" no
      // puede quitarle el azul al mensaje. Un "failed" si se impone.
      await pool.query(
        `update messages
            set status = case
                  when $2 = 'failed' then 'failed'
                  when (case status when 'read' then 3 when 'delivered' then 2 when 'sent' then 1 else 0 end)
                    >= (case $2 when 'read' then 3 when 'delivered' then 2 when 'sent' then 1 else 0 end) then status
                  else $2 end
          where wamid = $1`,
        [wamid, status],
      );
    },

    async listConversations(query) {
      const params: unknown[] = [];
      const condiciones: string[] = [];
      if (query.q?.trim()) {
        params.push(`%${query.q.trim()}%`);
        condiciones.push(`(c.phone ilike $${params.length} or c.name ilike $${params.length})`);
      }
      // Un chat apartado no sale en la lista normal, pero vuelve solo en
      // cuanto el cliente escribe: apartar no es dejar de atender.
      if (!query.incluirApartados) {
        condiciones.push(`(c.chat_apartado_at is null or m.created_at > c.chat_apartado_at)`);
      }
      const where = condiciones.length ? `where ${condiciones.join(' and ')}` : '';

      const { rows } = await pool.query<{
        contact_id: string;
        phone: string;
        name: string | null;
        tipo: string | null;
        opt_in_at: Date | null;
        opt_out_at: Date | null;
        last_inbound_at: Date | null;
        chat_fijado_at: Date | null;
        chat_silenciado_at: Date | null;
        chat_apartado_at: Date | null;
        direction: Direction | null;
        kind: MessageKind | null;
        body: string | null;
        status: string | null;
        message_at: Date | null;
        message_id: number | null;
        unread: number;
      }>(
        `select c.id as contact_id, c.phone, c.name, c.tipo, c.opt_in_at, c.opt_out_at, c.last_inbound_at,
                c.chat_fijado_at, c.chat_silenciado_at, c.chat_apartado_at,
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
          -- Lo fijado manda sobre la hora: es lo que pidio quien atiende.
          order by c.chat_fijado_at desc nulls last,
                   coalesce(m.created_at, c.last_inbound_at) desc nulls last,
                   m.id desc nulls last, c.created_at desc
          limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, query.limit, query.offset],
      );

      const now = Date.now();
      return rows.map((r) => ({
        contactId: r.contact_id,
        phone: r.phone,
        name: r.name,
        tipo: r.tipo === 'grupo' ? 'grupo' : 'persona',
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
        fijadoAt: r.chat_fijado_at ?? null,
        silenciadoAt: r.chat_silenciado_at ?? null,
        apartadoAt: r.chat_apartado_at ?? null,
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
        // Lo "eliminado para mi" no se pinta, pero sigue en la tabla: el
        // respaldo y la traza lo necesitan (ver `ocultar`).
        `select * from messages
          where contact_id = $1 ${cursor}
            and not (coalesce(payload, '{}'::jsonb) ? 'eliminadoAqui')
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
    async existsByWamid(wamid) {
      const { rows } = await pool.query<{ uno: number }>('select 1 as uno from messages where wamid = $1 limit 1', [wamid]);
      return rows.length > 0;
    },
    async tieneAdjunto(wamid) {
      const { rows } = await pool.query<{ uno: number }>(
        `select 1 as uno from messages where wamid = $1 and payload ? 'media' limit 1`,
        [wamid],
      );
      return rows.length > 0;
    },
    async marcarBorradoPorRemitente(wamid, at) {
      const { rowCount } = await pool.query(
        `update messages
            set payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('borradoPorRemitente', $2::text)
          where wamid = $1`,
        [wamid, at.toISOString()],
      );
      return (rowCount ?? 0) > 0;
    },
    async completarPorWamid(wamid, datos) {
      const { rowCount } = await pool.query(
        `update messages
            set kind = $2, body = $3, payload = $4
          where wamid = $1
            and (payload is null or not (payload ? 'media'))`,
        [wamid, datos.kind, datos.body, datos.payload ? JSON.stringify(datos.payload) : null],
      );
      return (rowCount ?? 0) > 0;
    },

    async contarEntrantesDesde(since) {
      const { rows } = await pool.query<{ total: number }>(
        `select count(*)::int as total from messages where direction = 'in' and created_at >= $1`,
        [since],
      );
      return rows[0]?.total ?? 0;
    },

    async actividadPorDia(since) {
      const { rows } = await pool.query<{ dia: string; entrantes: number; salientes: number }>(
        `select to_char(created_at, 'YYYY-MM-DD') as dia,
                count(*) filter (where direction = 'in')::int as entrantes,
                count(*) filter (where direction = 'out')::int as salientes
           from messages
          where created_at >= $1
          group by 1
          order by 1`,
        [since],
      );
      return rows.map((r) => ({ dia: r.dia, entrantes: r.entrantes, salientes: r.salientes }));
    },

    async contarEsperandoRespuesta() {
      // El ultimo mensaje del hilo es del cliente y es posterior a la ultima
      // lectura: alguien tiene que contestar (o al menos mirarlo).
      const { rows } = await pool.query<{ total: number }>(
        `select count(*)::int as total
           from contacts c
           join lateral (
             select direction, created_at from messages m
              where m.contact_id = c.id
              order by created_at desc, id desc
              limit 1
           ) u on true
          where u.direction = 'in'
            and u.created_at > coalesce(c.chat_read_at, to_timestamp(0))`,
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

    async masAntiguo(contactId) {
      const { rows } = await pool.query<Row>(
        `select * from messages
          where contact_id = $1 and wamid is not null
            and wamid not like 'local:%' and wamid not like 'web:%'
          order by created_at asc, id asc
          limit 1`,
        [contactId],
      );
      return rows[0] ? toMessage(rows[0]) : null;
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

    // --- citar, reaccionar, destacar, buscar (ver la interfaz) -------------

    async reaccionar(wamid, quien, emoji, at) {
      const limpio = emoji.trim();
      // Quitarla es borrar la clave; ponerla, reemplazarla. En los dos casos
      // se funde sobre el payload que ya hubiera, sin pisar nada mas.
      const { rowCount } = limpio
        ? await pool.query(
            `update messages
                set payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
                      'reacciones',
                      coalesce(payload->'reacciones', '{}'::jsonb) ||
                        jsonb_build_object($2::text, jsonb_build_object('emoji', $3::text, 'at', $4::text)))
              where wamid = $1`,
            [wamid, quien, limpio, at.toISOString()],
          )
        : await pool.query(
            `update messages
                set payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
                      'reacciones', coalesce(payload->'reacciones', '{}'::jsonb) - $2::text)
              where wamid = $1`,
            [wamid, quien],
          );
      return (rowCount ?? 0) > 0;
    },

    async porId(contactId, id) {
      const { rows } = await pool.query<Row>('select * from messages where contact_id = $1 and id = $2', [contactId, id]);
      return rows[0] ? toMessage(rows[0]) : null;
    },

    async porIds(contactId, ids) {
      if (!ids.length) return [];
      const { rows } = await pool.query<Row>(
        `select * from messages where contact_id = $1 and id = any($2::bigint[])
          order by created_at asc, id asc`,
        [contactId, ids],
      );
      return rows.map(toMessage);
    },

    async destacar(contactId, ids, destacado, at) {
      if (!ids.length) return 0;
      const { rowCount } = destacado
        ? await pool.query(
            `update messages
                set payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('destacado', $3::text)
              where contact_id = $1 and id = any($2::bigint[])`,
            [contactId, ids, at.toISOString()],
          )
        : await pool.query(
            `update messages set payload = coalesce(payload, '{}'::jsonb) - 'destacado'
              where contact_id = $1 and id = any($2::bigint[])`,
            [contactId, ids],
          );
      return rowCount ?? 0;
    },

    async ocultar(contactId, ids, at) {
      if (!ids.length) return 0;
      const { rowCount } = await pool.query(
        `update messages
            set payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('eliminadoAqui', $3::text)
          where contact_id = $1 and id = any($2::bigint[])`,
        [contactId, ids, at.toISOString()],
      );
      return rowCount ?? 0;
    },

    async editarCuerpo(contactId, id, texto, at) {
      const { rowCount } = await pool.query(
        `update messages
            set body = $3,
                payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('editadoAt', $4::text)
          where contact_id = $1 and id = $2`,
        [contactId, id, texto, at.toISOString()],
      );
      return (rowCount ?? 0) > 0;
    },

    async buscar(query) {
      const texto = query.q.trim();
      if (!texto) return [];
      const { rows } = await pool.query<Row>(
        `select * from messages
          where contact_id = $1 and body ilike $2
            and not (coalesce(payload, '{}'::jsonb) ? 'eliminadoAqui')
          order by created_at desc, id desc
          limit $3`,
        [query.contactId, `%${texto}%`, query.limit],
      );
      // Se consulta del mas nuevo al mas viejo (lo reciente importa mas) y se
      // devuelve en orden de lectura, como el hilo.
      return rows.reverse().map(toMessage);
    },

    async destacados(query) {
      const params: unknown[] = [];
      let filtro = '';
      if (query.contactId) {
        params.push(query.contactId);
        filtro = `and m.contact_id = $${params.length}`;
      }
      const { rows } = await pool.query<Row & { phone: string; name: string | null }>(
        `select m.*, c.phone, c.name
           from messages m
           join contacts c on c.id = m.contact_id
          where coalesce(m.payload, '{}'::jsonb) ? 'destacado'
            and not (coalesce(m.payload, '{}'::jsonb) ? 'eliminadoAqui')
            ${filtro}
          order by m.created_at desc, m.id desc
          limit $${params.length + 1}`,
        [...params, query.limit],
      );
      return rows.map((r) => ({ ...toMessage(r), phone: r.phone, name: r.name }));
    },
  };

  return repo;
}
