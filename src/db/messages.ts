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
  storedAt?: Date;
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

function filtroVista(alias: string, desde: string): string {
  return `${alias}.created_at >= ${desde}
    and coalesce(json_unquote(json_extract(${alias}.payload, '$.historial')), 'false') <> 'true'
    and coalesce(json_unquote(json_extract(${alias}.payload, '$.autorNombre')), '') <> 'Teléfono'`;
}
function inicioSistema(alias: string, desde: string): string {
  return `${filtroVista(alias, desde)} and ${alias}.direction = 'out' and ${alias}.wamid is not null`;
}

export interface MessagesRepo {
  /** ID más alto, conservado como decimal para no perder precisión bigint. */
  ultimoId(): Promise<string>;
  /** Reserva un wamid entrante sin guardar su cuerpo; false significa reentrega. */
  reservarEntrada(provider: string, wamid: string, recibidoAt: Date, expiresAt: Date): Promise<boolean>;
  /** Resultado mínimo de la reserva, independiente del mensaje temporal. */
  finalizarEntrada(provider: string, wamid: string, estado: 'aceptado' | 'incierto'): Promise<void>;
  /** Borra tombstones vencidos por lotes, sin tocar pedidos ni mensajes recientes. */
  limpiarEntradasAntes(ahora: Date): Promise<number>;
  /** Reserva una acción por referencia estable, sin guardar su contenido. */
  reservarAccionWhatsapp(input: { key: string; tipo: string; referencia: string; ahora: Date; expira: Date }): Promise<boolean>;
  finalizarAccionWhatsapp(key: string, estado: 'aceptado' | 'fallido' | 'incierto', wamidSaliente?: string | null): Promise<void>;
  limpiarAccionesWhatsappAntes(ahora: Date): Promise<number>;
  add(message: NewMessage): Promise<number>;
  /** Estado de entrega que llega por webhook. */
  setStatusByWamid(wamid: string, status: string): Promise<void>;
  listConversations(query: { q?: string; limit: number; offset: number; incluirApartados?: boolean; desde?: Date | null; alcance?: { afterId: string; retenidosDesde: Date } }): Promise<Conversation[]>;
  listMessages(contactId: string, limit: number, beforeId?: number, desde?: Date | null, alcance?: { afterId: string; retenidosDesde: Date }): Promise<Message[]>;
  /** Novedades posteriores al cursor más estados vigentes de IDs conocidos. */
  syncMessages(contactId: string, afterId: string, knownIds: string[], limit: number, alcance: { afterId: string; retenidosDesde: Date }): Promise<Message[]>;
  inicioSistemaDesde(contactId: string, desde: Date): Promise<Date | null>;
  iniciadaEnAlcance(contactId: string, alcance: { afterId: string; retenidosDesde: Date }): Promise<boolean>;
  referenciaVisiblePorWamid(wamid: string, retenidosDesde: Date): Promise<{ contactId: string; id: string } | null>;
  limpiarAntes(desde: Date): Promise<number>;
  markRead(contactId: string, at: Date): Promise<void>;
  /** Total de mensajes entrantes sin leer, para el globo del menu. */
  unreadTotal(desde?: Date | null, alcance?: { afterId: string; retenidosDesde: Date }): Promise<number>;
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
  buscar(query: { contactId: string; q: string; limit: number; desde?: Date | null; alcance?: { afterId: string; retenidosDesde: Date } }): Promise<Message[]>;
  /** Los mensajes con estrella, de un chat o de todos, con de quien son. */
  destacados(query: { contactId?: string; limit: number; desde?: Date | null; alcance?: { afterId: string; retenidosDesde: Date } }): Promise<Array<Message & { phone: string; name: string | null }>>;

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
  storedAt: (r as Row & { stored_at?: Date }).stored_at ?? r.created_at,
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
    async ultimoId() {
      const { rows } = await pool.query<{ id: string | number | bigint }>('select coalesce(max(id), 0) as id from messages');
      return String(rows[0]?.id ?? '0');
    },
    async reservarEntrada(provider, wamid, recibidoAt, expiresAt) {
      const claveProveedor = provider.trim().slice(0, 24) || 'whatsapp';
      const insertada = await pool.query(
        `insert ignore into whatsapp_inbound_receipts (provider, wamid, estado, recibido_at, expires_at)
         values ($1,$2,'procesando',$3,$4)`,
        [claveProveedor, wamid, recibidoAt, expiresAt],
      );
      if (insertada.rowCount === 1) return true;
      const renovada = await pool.query(
        `update whatsapp_inbound_receipts
            set estado='procesando', recibido_at=$3, expires_at=$4
          where provider=$1 and wamid=$2 and expires_at <= $3`,
        [claveProveedor, wamid, recibidoAt, expiresAt],
      );
      return renovada.rowCount === 1;
    },
    async finalizarEntrada(provider, wamid, estado) {
      await pool.query(
        `update whatsapp_inbound_receipts set estado=$3
          where provider=$1 and wamid=$2 and estado='procesando'`,
        [provider.trim().slice(0, 24) || 'whatsapp', wamid, estado],
      );
    },
    async limpiarEntradasAntes(ahora) {
      const { rowCount } = await pool.query(
        'delete from whatsapp_inbound_receipts where expires_at <= $1 order by expires_at limit 1000',
        [ahora],
      );
      return rowCount;
    },
    async reservarAccionWhatsapp(input) {
      const insertada = await pool.query(
        `insert ignore into whatsapp_action_controls
          (action_key, tipo, referencia_operativa, estado, creado_at, actualizado_at, expires_at)
         values ($1,$2,$3,'procesando',$4,$4,$5)`,
        [input.key, input.tipo.slice(0, 40), input.referencia.slice(0, 500), input.ahora, input.expira],
      );
      if (insertada.rowCount === 1) return true;
      const renovada = await pool.query(
        `update whatsapp_action_controls
            set tipo=$2, referencia_operativa=$3, estado='procesando', wamid_saliente=null, actualizado_at=$4, expires_at=$5
          where action_key=$1 and (expires_at <= $4 or estado='fallido')`,
        [input.key, input.tipo.slice(0, 40), input.referencia.slice(0, 500), input.ahora, input.expira],
      );
      return renovada.rowCount === 1;
    },
    async finalizarAccionWhatsapp(key, estado, wamidSaliente = null) {
      await pool.query(
        `update whatsapp_action_controls set estado=$2, wamid_saliente=$3, actualizado_at=now(3)
          where action_key=$1 and estado='procesando'`,
        [key, estado, wamidSaliente],
      );
    },
    async limpiarAccionesWhatsappAntes(ahora) {
      const { rowCount } = await pool.query(
        'delete from whatsapp_action_controls where expires_at <= $1 order by expires_at limit 1000',
        [ahora],
      );
      return rowCount;
    },
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

      // Si el wamid ya estaba, se actualiza el estado y `last_insert_id(id)`
      // hace que insertId sea el id de la fila que ya existia.
      const { insertId } = await pool.query(
        `insert into messages
           (contact_id, direction, wamid, kind, body, payload, status, delivery_id, created_at, stored_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8, coalesce($9, now(3)), now(3))
         on duplicate key update id = last_insert_id(id), status = coalesce(values(status), status)`,
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
      return insertId;
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
      const alcance = query.alcance;
      const visibilidad = (alias: string, scope: { afterId: string; retenidosDesde: Date }) => {
        params.push(scope.afterId);
        const id = `$${params.length}`;
        params.push(scope.retenidosDesde);
        const at = `$${params.length}`;
        return `${alias}.id > ${id} and ${alias}.stored_at > ${at}
          and coalesce(json_unquote(json_extract(${alias}.payload, '$.historial')), 'false') <> 'true'
          and coalesce(json_unquote(json_extract(${alias}.payload, '$.autorNombre')), '') <> 'Teléfono'`;
      };
      const desde = query.desde ? (params.push(query.desde), `$${params.length}`) : null;
      if (alcance) condiciones.push(`exists (select 1 from messages s where s.contact_id = c.id and s.direction = 'out' and s.wamid is not null and coalesce(s.status,'') not in ('failed','blocked_by_gate') and ${visibilidad('s', alcance)})`);
      else if (desde) condiciones.push(`exists (select 1 from messages s where s.contact_id = c.id and ${inicioSistema('s', desde)})`);
      if (query.q?.trim()) {
        params.push(`%${query.q.trim()}%`);
        condiciones.push(`(lower(c.phone) like lower($${params.length}) or lower(c.name) like lower($${params.length}))`);
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
                (select count(*)
                   from messages u
                  where u.contact_id = c.id and u.direction = 'in'
                    ${alcance ? `and ${visibilidad('u', alcance)}` : desde ? `and ${filtroVista('u', desde)}` : ''}
                    and u.created_at > coalesce(c.chat_read_at, cast('1970-01-01' as datetime(3)))) as unread
           from contacts c
           -- El ultimo mensaje del hilo. MariaDB no tiene LATERAL: su id sale
           -- de una subconsulta que va por el indice (contact_id, created_at, id).
           left join messages m on m.id = (
             select m2.id from messages m2
              where m2.contact_id = c.id
                ${alcance ? `and ${visibilidad('m2', alcance)}` : desde ? `and ${filtroVista('m2', desde)}` : ''}
              order by m2.created_at desc, m2.id desc limit 1
           )
          ${where}
          -- Los chats con mensajes primero, y dentro de ellos el mas reciente.
          -- El desempate por id importa: WhatsApp marca la hora en SEGUNDOS,
          -- asi que dos mensajes seguidos comparten instante y sin el la lista
          -- se reordena sola en cada refresco.
          -- Lo fijado manda sobre la hora: es lo que pidio quien atiende.
          -- ("x is null, x desc" = de mayor a menor con los vacios al final.)
          order by c.chat_fijado_at is null, c.chat_fijado_at desc,
                   coalesce(m.created_at, c.last_inbound_at) is null, coalesce(m.created_at, c.last_inbound_at) desc,
                   m.id is null, m.id desc, c.created_at desc
          limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, Number(query.limit), Number(query.offset)],
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
        unread: Number(r.unread ?? 0),
        windowOpen: Boolean(r.last_inbound_at && now - r.last_inbound_at.getTime() < WINDOW_MS),
        fijadoAt: r.chat_fijado_at ?? null,
        silenciadoAt: r.chat_silenciado_at ?? null,
        apartadoAt: r.chat_apartado_at ?? null,
      }));
    },

    async inicioSistemaDesde(contactId, desde) {
      const { rows } = await pool.query<{ at: Date | null }>(`select min(s.created_at) as at from messages s where s.contact_id = $1 and ${inicioSistema('s', '$2')}`, [contactId, desde]);
      return rows[0]?.at ?? null;
    },
    async iniciadaEnAlcance(contactId, alcance) {
      const { rows } = await pool.query<{ existe: number }>(
        `select 1 as existe from messages s where s.contact_id=$1 and s.direction='out' and s.wamid is not null and coalesce(s.status,'') not in ('failed','blocked_by_gate') and s.id > $2 and s.stored_at > $3 and coalesce(json_unquote(json_extract(s.payload, '$.historial')), 'false') <> 'true' and coalesce(json_unquote(json_extract(s.payload, '$.autorNombre')), '') <> 'Teléfono' limit 1`,
        [contactId, alcance.afterId, alcance.retenidosDesde],
      );
      return rows.length > 0;
    },
    async referenciaVisiblePorWamid(wamid, retenidosDesde) {
      const { rows } = await pool.query<{ contact_id: string; id: string | number | bigint }>(
        `select contact_id, id from messages where wamid=$1 and stored_at > $2 and coalesce(json_unquote(json_extract(payload, '$.historial')), 'false') <> 'true' and coalesce(json_unquote(json_extract(payload, '$.autorNombre')), '') <> 'Teléfono' limit 1`,
        [wamid, retenidosDesde],
      );
      return rows[0] ? { contactId: rows[0].contact_id, id: String(rows[0].id) } : null;
    },
    async limpiarAntes(desde) {
      const { rowCount } = await pool.query('delete from messages where stored_at is null or stored_at <= $1 order by stored_at, id limit 1000', [desde]);
      return rowCount;
    },

    async listMessages(contactId, limit, beforeId, desde, alcance) {
      const params: unknown[] = [contactId];
      let cursor = '';
      if (beforeId) {
        params.push(beforeId);
        cursor = `and id < $${params.length}`;
      }
      if (desde) {
        params.push(desde);
        cursor += ` and ${filtroVista('messages', `$${params.length}`)} and exists (select 1 from messages s where s.contact_id = $1 and ${inicioSistema('s', `$${params.length}`)})`;
      }
      if (alcance) {
        const visibilidad = (alias: string) => {
          params.push(alcance.afterId); const id = `$${params.length}`;
          params.push(alcance.retenidosDesde); const at = `$${params.length}`;
          return `${alias}.id > ${id} and ${alias}.stored_at > ${at} and coalesce(json_unquote(json_extract(${alias}.payload, '$.historial')), 'false') <> 'true' and coalesce(json_unquote(json_extract(${alias}.payload, '$.autorNombre')), '') <> 'Teléfono'`;
        };
        cursor += ` and ${visibilidad('messages')} and exists (select 1 from messages s where s.contact_id = $1 and s.direction='out' and s.wamid is not null and coalesce(s.status,'') not in ('failed','blocked_by_gate') and ${visibilidad('s')})`;
      }
      const { rows } = await pool.query<Row>(
        // Lo "eliminado para mi" no se pinta, pero sigue en la tabla: el
        // respaldo y la traza lo necesitan (ver `ocultar`).
        `select * from messages
          where contact_id = $1 ${cursor}
            and not json_contains_path(coalesce(payload, '{}'), 'one', '$.eliminadoAqui')
          order by created_at desc, id desc
          limit $${params.length + 1}`,
        [...params, Number(limit)],
      );
      // Se consulta al reves para poder paginar hacia atras; se devuelve en
      // orden de lectura.
      return rows.reverse().map(toMessage);
    },

    async syncMessages(contactId, afterId, knownIds, limit, alcance) {
      const params: unknown[] = [contactId, afterId];
      const conocidos = knownIds.slice(0, 300);
      let ids = '';
      if (conocidos.length) {
        params.push(...conocidos);
        ids = ` or id in (${conocidos.map((_, i) => `$${i + 3}`).join(',')})`;
      }
      params.push(alcance.afterId, alcance.retenidosDesde);
      const scopeId = `$${params.length - 1}`, retained = `$${params.length}`;
      params.push(Number(limit));
      const { rows } = await pool.query<Row>(
        `select * from messages
          where contact_id=$1 and (id > $2${ids})
            and id > ${scopeId} and stored_at > ${retained}
            and coalesce(json_unquote(json_extract(payload, '$.historial')), 'false') <> 'true'
            and coalesce(json_unquote(json_extract(payload, '$.autorNombre')), '') <> 'Teléfono'
            and exists (select 1 from messages s where s.contact_id=$1 and s.direction='out' and s.wamid is not null and coalesce(s.status,'') not in ('failed','blocked_by_gate') and s.id > ${scopeId} and s.stored_at > ${retained} and coalesce(json_unquote(json_extract(s.payload, '$.historial')), 'false') <> 'true' and coalesce(json_unquote(json_extract(s.payload, '$.autorNombre')), '') <> 'Teléfono')
            and not json_contains_path(coalesce(payload, '{}'), 'one', '$.eliminadoAqui')
          order by id asc limit $${params.length}`,
        params,
      );
      return rows.map(toMessage);
    },

    async markRead(contactId, at) {
      await pool.query('update contacts set chat_read_at = $2 where id = $1', [contactId, at]);
    },

    async unreadTotal(desde, alcance) {
      const params: unknown[] = [];
      let filtro = '';
      if (desde) { params.push(desde); filtro += `and ${filtroVista('m', `$${params.length}`)} and exists (select 1 from messages sd where sd.contact_id=c.id and ${inicioSistema('sd', `$${params.length}`)})`; }
      if (alcance) {
        params.push(alcance.afterId); const id = `$${params.length}`;
        params.push(alcance.retenidosDesde); const at = `$${params.length}`;
        filtro += `and m.id > ${id} and m.stored_at > ${at} and coalesce(json_unquote(json_extract(m.payload, '$.historial')), 'false') <> 'true' and coalesce(json_unquote(json_extract(m.payload, '$.autorNombre')), '') <> 'Teléfono' and exists (select 1 from messages s where s.contact_id=c.id and s.direction='out' and s.wamid is not null and coalesce(s.status,'') not in ('failed','blocked_by_gate') and s.id > ${id} and s.stored_at > ${at})`;
      }
      const { rows } = await pool.query<{ total: number }>(
        `select count(*) as total
           from messages m
           join contacts c on c.id = m.contact_id
          where m.direction = 'in'
            ${filtro}
            and m.created_at > coalesce(c.chat_read_at, cast('1970-01-01' as datetime(3)))`,
        params,
      );
      return rows[0]?.total ?? 0;
    },
    async existsByWamid(wamid) {
      const { rows } = await pool.query<{ uno: number }>('select 1 as uno from messages where wamid = $1 limit 1', [wamid]);
      return rows.length > 0;
    },
    async tieneAdjunto(wamid) {
      const { rows } = await pool.query<{ uno: number }>(
        `select 1 as uno from messages where wamid = $1 and json_contains_path(payload, 'one', '$.media') limit 1`,
        [wamid],
      );
      return rows.length > 0;
    },
    async marcarBorradoPorRemitente(wamid, at) {
      const { rowCount } = await pool.query(
        `update messages
            set payload = json_set(coalesce(payload, '{}'), '$.borradoPorRemitente', $2)
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
            and (payload is null or not json_contains_path(payload, 'one', '$.media'))`,
        [wamid, datos.kind, datos.body, datos.payload ? JSON.stringify(datos.payload) : null],
      );
      return (rowCount ?? 0) > 0;
    },

    async contarEntrantesDesde(since) {
      const { rows } = await pool.query<{ total: number }>(
        // Sin los numeros del Modulo desarrollador: no cuentan en la salud del numero real.
        `select count(*) as total from messages m
          where m.direction = 'in' and m.created_at >= $1
            and not exists (select 1 from contacts c where c.id = m.contact_id and c.phone regexp '^51000[01][0-9]{5}$')`,
        [since],
      );
      return rows[0]?.total ?? 0;
    },

    async actividadPorDia(since) {
      const { rows } = await pool.query<{ dia: string; entrantes: number; salientes: number }>(
        // El dia sale en UTC, que es la zona de la sesion.
        `select date_format(created_at, '%Y-%m-%d') as dia,
                count(case when direction = 'in' then 1 end) as entrantes,
                count(case when direction = 'out' then 1 end) as salientes
           from messages
          where created_at >= $1
          group by dia
          order by dia`,
        [since],
      );
      return rows.map((r) => ({ dia: r.dia, entrantes: Number(r.entrantes), salientes: Number(r.salientes) }));
    },

    async contarEsperandoRespuesta() {
      // El ultimo mensaje del hilo es del cliente y es posterior a la ultima
      // lectura: alguien tiene que contestar (o al menos mirarlo).
      const { rows } = await pool.query<{ total: number }>(
        `select count(*) as total
           from contacts c
           join messages u on u.id = (
             select m.id from messages m
              where m.contact_id = c.id
              order by m.created_at desc, m.id desc
              limit 1
           )
          where u.direction = 'in'
            and u.created_at > coalesce(c.chat_read_at, cast('1970-01-01' as datetime(3)))`,
      );
      return rows[0]?.total ?? 0;
    },

    async pageForArchive(contactId, afterId, limit) {
      const { rows } = await pool.query<Row>(
        `select * from messages
          where contact_id = $1 and id > $2
          order by id asc
          limit $3`,
        [contactId, afterId, Number(limit)],
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
        `select count(*) as total, min(created_at) as first_at,
                max(created_at) as last_at, max(id) as last_id
           from messages where contact_id = $1`,
        [contactId],
      );
      const r = rows[0];
      return {
        count: Number(r?.total ?? 0),
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
        [before, Number(limit)],
      );
      return rows.map((r) => ({ contactId: r.contact_id, lastAt: r.last_at }));
    },

    // --- citar, reaccionar, destacar, buscar (ver la interfaz) -------------

    async reaccionar(wamid, quien, emoji, at) {
      const limpio = emoji.trim();
      // Quitarla es borrar la clave; ponerla, reemplazarla. En los dos casos
      // se funde sobre el payload que ya hubiera, sin pisar nada mas:
      // json_merge_patch funde objeto dentro de objeto, y un null en el
      // parche borra esa clave (asi no hay que armar una ruta JSON con el
      // telefono dentro).
      const { rowCount } = limpio
        ? await pool.query(
            `update messages
                set payload = json_merge_patch(coalesce(payload, '{}'),
                      json_object('reacciones', json_object($2, json_object('emoji', $3, 'at', $4))))
              where wamid = $1`,
            [wamid, quien, limpio, at.toISOString()],
          )
        : await pool.query(
            `update messages
                set payload = json_merge_patch(coalesce(payload, '{}'),
                      json_object('reacciones', json_object($2, null)))
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
        `select * from messages where contact_id = $1 and id in ($2)
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
                set payload = json_set(coalesce(payload, '{}'), '$.destacado', $3)
              where contact_id = $1 and id in ($2)`,
            [contactId, ids, at.toISOString()],
          )
        : await pool.query(
            `update messages set payload = json_remove(coalesce(payload, '{}'), '$.destacado')
              where contact_id = $1 and id in ($2)`,
            [contactId, ids],
          );
      return rowCount ?? 0;
    },

    async ocultar(contactId, ids, at) {
      if (!ids.length) return 0;
      const { rowCount } = await pool.query(
        `update messages
            set payload = json_set(coalesce(payload, '{}'), '$.eliminadoAqui', $3)
          where contact_id = $1 and id in ($2)`,
        [contactId, ids, at.toISOString()],
      );
      return rowCount ?? 0;
    },

    async editarCuerpo(contactId, id, texto, at) {
      const { rowCount } = await pool.query(
        `update messages
            set body = $3,
                payload = json_set(coalesce(payload, '{}'), '$.editadoAt', $4)
          where contact_id = $1 and id = $2`,
        [contactId, id, texto, at.toISOString()],
      );
      return (rowCount ?? 0) > 0;
    },

    async buscar(query) {
      const texto = query.q.trim();
      if (!texto) return [];
      const params: unknown[] = [query.contactId, `%${texto}%`, Number(query.limit)];
      let alcanceSql = '';
      if (query.desde) { params.push(query.desde); alcanceSql += ` and ${filtroVista('messages', `$${params.length}`)} and exists (select 1 from messages s where s.contact_id=$1 and ${inicioSistema('s', `$${params.length}`)})`; }
      if (query.alcance) {
        params.push(query.alcance.afterId); const id = `$${params.length}`;
        params.push(query.alcance.retenidosDesde); const at = `$${params.length}`;
        alcanceSql += ` and messages.id > ${id} and messages.stored_at > ${at} and coalesce(json_unquote(json_extract(messages.payload, '$.historial')), 'false') <> 'true' and coalesce(json_unquote(json_extract(messages.payload, '$.autorNombre')), '') <> 'Teléfono' and exists (select 1 from messages s where s.contact_id=$1 and s.direction='out' and s.wamid is not null and coalesce(s.status,'') not in ('failed','blocked_by_gate') and s.id > ${id} and s.stored_at > ${at})`;
      }
      const { rows } = await pool.query<Row>(
        `select * from messages
          where contact_id = $1 and lower(body) like lower($2)
            ${alcanceSql}
            and not json_contains_path(coalesce(payload, '{}'), 'one', '$.eliminadoAqui')
          order by created_at desc, id desc
          limit $3`,
        params,
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
      if (query.desde) {
        params.push(query.desde);
        filtro += ` and ${filtroVista('m', `$${params.length}`)} and exists (select 1 from messages s where s.contact_id = m.contact_id and ${inicioSistema('s', `$${params.length}`)})`;
      }
      if (query.alcance) {
        params.push(query.alcance.afterId); const id = `$${params.length}`;
        params.push(query.alcance.retenidosDesde); const at = `$${params.length}`;
        filtro += ` and m.id > ${id} and m.stored_at > ${at} and coalesce(json_unquote(json_extract(m.payload, '$.historial')), 'false') <> 'true' and coalesce(json_unquote(json_extract(m.payload, '$.autorNombre')), '') <> 'Teléfono' and exists (select 1 from messages s where s.contact_id=m.contact_id and s.direction='out' and s.wamid is not null and coalesce(s.status,'') not in ('failed','blocked_by_gate') and s.id > ${id} and s.stored_at > ${at})`;
      }
      const { rows } = await pool.query<Row & { phone: string; name: string | null }>(
        `select m.*, c.phone, c.name
           from messages m
           join contacts c on c.id = m.contact_id
          where json_contains_path(coalesce(m.payload, '{}'), 'one', '$.destacado')
            and not json_contains_path(coalesce(m.payload, '{}'), 'one', '$.eliminadoAqui')
            ${filtro}
          order by m.created_at desc, m.id desc
          limit $${params.length + 1}`,
        [...params, Number(query.limit)],
      );
      return rows.map((r) => ({ ...toMessage(r), phone: r.phone, name: r.name }));
    },
  };

  return repo;
}
