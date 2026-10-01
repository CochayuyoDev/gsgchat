/**
 * El indice de los respaldos de conversacion.
 *
 * Una fila por respaldo: de quien era el hilo, cuantos mensajes tenia, entre
 * que fechas y en que fichero quedo. El contenido no vive aqui -vive en disco,
 * comprimido- porque el objetivo de cerrar una conversacion es justamente que
 * la base deje de crecer. Lo que si vive aqui (migraciones 026 y 028) es lo
 * que hace falta para encontrarla y entenderla sin abrir el fichero: el texto
 * plano recortado para buscar, el resumen y las etiquetas que puso la IA, el
 * pedido de GSG al que pertenece, las notas de una persona, la papelera, la
 * lista de adjuntos copiados y cuanto se tardo en contestar.
 *
 * `Repos` lo expone como `repos.archives`.
 */

import type { Pool } from './pool.js';

/** Que disparo el respaldo. */
export type ArchiveReason = 'manual' | 'lead' | 'inactividad' | 'entrega';

/** Un fichero copiado junto al respaldo (o que no se pudo copiar, con `omitido`). */
export interface ArchiveAdjunto {
  /** El id del media tal y como lo apunta el mensaje (`payload.media.id`). */
  id: string;
  kind: string;
  mimeType: string;
  bytes: number;
  /** Nombre original, solo en documentos. */
  nombre?: string;
  /** Por que no se copio, cuando no se copio ("muy grande", "no estaba en el servidor"). */
  omitido?: string;
}

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
  /** Lo que la IA entendio (o una persona escribio) de la conversacion. */
  resumen: string | null;
  etiquetas: string[];
  /** El pedido de GSG al que pertenece, si se supo al guardar. */
  pedido: string | null;
  notas: string | null;
  cerradoPor: string | null;
  /** En la papelera desde... (null = viva). */
  deletedAt: Date | null;
  /** Los ficheros copiados junto al respaldo. */
  adjuntos: ArchiveAdjunto[];
  /** Segundos desde el primer mensaje del cliente hasta la primera respuesta de una persona (null si no la hubo). */
  primeraRespuestaSeg: number | null;
  /** De donde salio, cuando no salio del chat vivo (`importado_txt`). */
  origen: string | null;
  createdAt: Date;
}

export type NewChatArchive = Omit<
  ChatArchive,
  'id' | 'createdAt' | 'resumen' | 'etiquetas' | 'pedido' | 'notas' | 'cerradoPor' | 'deletedAt' | 'adjuntos' | 'primeraRespuestaSeg' | 'origen'
> & {
  /** El texto plano de los mensajes, recortado, para buscar dentro. */
  textoBusqueda?: string | null;
  pedido?: string | null;
  cerradoPor?: string | null;
  adjuntos?: ArchiveAdjunto[];
  primeraRespuestaSeg?: number | null;
  origen?: string | null;
};

export interface ArchivePatch {
  resumen?: string | null;
  etiquetas?: string[];
  pedido?: string | null;
  notas?: string | null;
  deletedAt?: Date | null;
  adjuntos?: ArchiveAdjunto[];
}

export interface ArchiveQuery {
  contactId?: string;
  /** Por nombre o telefono. */
  q?: string;
  /** Dentro del texto de los mensajes, del resumen y de las notas. */
  texto?: string;
  etiqueta?: string;
  pedido?: string;
  reason?: ArchiveReason;
  desde?: Date;
  hasta?: Date;
  /** true = solo la papelera; por defecto, solo las vivas. */
  papelera?: boolean;
  limit: number;
  offset: number;
}

export interface ArchiveStats {
  total: number;
  bytes: number;
  messages: number;
  enPapelera: number;
  porMotivo: Record<string, number>;
  porEtiqueta: Record<string, number>;
  /** Las ultimas 8 semanas (lunes, en fecha de Lima), con ceros donde no hubo nada; la mas vieja primero. */
  porSemana: Array<{ semana: string; n: number }>;
  /** Media de segundos hasta la primera respuesta de una persona (null si ninguna la tiene). */
  primeraRespuestaMedioSeg: number | null;
  /** Porcentaje (0-100) de conversaciones con la etiqueta reclamo. */
  pctReclamo: number;
  conAdjuntos: number;
}

export interface ArchivesRepo {
  add(archive: NewChatArchive): Promise<ChatArchive>;
  get(id: number): Promise<ChatArchive | null>;
  list(query: ArchiveQuery): Promise<ChatArchive[]>;
  count(query: Omit<ArchiveQuery, 'limit' | 'offset'>): Promise<number>;
  /** Los respaldos vivos de un contacto, del mas reciente al mas viejo. */
  byContact(contactId: string): Promise<ChatArchive[]>;
  update(id: number, patch: ArchivePatch): Promise<ChatArchive | null>;
  /**
   * Pone el resumen y las etiquetas SOLO si aun no tiene resumen, en una sola
   * sentencia: el resumen automatico (que llega en segundo plano) nunca pisa
   * el que una persona puso entre medias. Devuelve como quedo.
   */
  ponerResumenSiFalta(id: number, resumen: string, etiquetas: string[]): Promise<ChatArchive | null>;
  remove(id: number): Promise<void>;
  /** Los de la papelera con mas de `dias` dias: toca borrarlos de verdad. */
  papeleraVencida(dias: number, limite: number): Promise<ChatArchive[]>;
  /** Los que aun no tienen resumen de la IA (para ponerselo despues). */
  sinResumen(limite: number): Promise<ChatArchive[]>;
  /** Cuantos respaldos y cuanto ocupan, y las cifras de la caja de estadisticas. */
  stats(): Promise<ArchiveStats>;
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
  resumen: string | null;
  etiquetas: unknown;
  pedido: string | null;
  notas: string | null;
  cerrado_por: string | null;
  deleted_at: Date | null;
  adjuntos: unknown;
  primera_respuesta_seg: number | null;
  origen: string | null;
  created_at: Date;
}

/** Una columna json llega ya leida (ver pool.ts); por si llegara como cadena, se aceptan las dos formas. */
function listaJson<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === 'string') {
    try {
      const j = JSON.parse(v) as unknown;
      return Array.isArray(j) ? (j as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

const toArchive = (r: Row): ChatArchive => ({
  id: Number(r.id),
  contactId: r.contact_id,
  phone: r.phone,
  name: r.name,
  file: r.file,
  // bigint: el pool ya lo da como numero; el Number() es por si acaso, el panel lo quiere sumable.
  bytes: Number(r.bytes),
  messageCount: Number(r.message_count),
  firstMessageAt: r.first_message_at,
  lastMessageAt: r.last_message_at,
  reason: r.reason,
  sha256: r.sha256,
  resumen: r.resumen ?? null,
  etiquetas: listaJson<unknown>(r.etiquetas).map(String),
  pedido: r.pedido ?? null,
  notas: r.notas ?? null,
  cerradoPor: r.cerrado_por ?? null,
  deletedAt: r.deleted_at ?? null,
  adjuntos: listaJson<ArchiveAdjunto>(r.adjuntos),
  primeraRespuestaSeg: r.primera_respuesta_seg === null || r.primera_respuesta_seg === undefined ? null : Number(r.primera_respuesta_seg),
  origen: r.origen ?? null,
  createdAt: r.created_at,
});

/** Las condiciones de una consulta, sin limit/offset. */
function condiciones(query: Omit<ArchiveQuery, 'limit' | 'offset'>): { where: string; params: unknown[] } {
  const params: unknown[] = [];
  const filtros: string[] = [query.papelera ? 'deleted_at is not null' : 'deleted_at is null'];
  if (query.contactId) {
    params.push(query.contactId);
    filtros.push(`contact_id = $${params.length}`);
  }
  if (query.q?.trim()) {
    params.push(`%${query.q.trim()}%`);
    filtros.push(`(lower(phone) like lower($${params.length}) or lower(name) like lower($${params.length}))`);
  }
  if (query.texto?.trim()) {
    params.push(`%${query.texto.trim()}%`);
    const p = `lower($${params.length})`;
    filtros.push(`(lower(texto_busqueda) like ${p} or lower(resumen) like ${p} or lower(notas) like ${p})`);
  }
  if (query.etiqueta?.trim()) {
    params.push(JSON.stringify([query.etiqueta.trim()]));
    filtros.push(`json_contains(etiquetas, $${params.length})`);
  }
  if (query.pedido?.trim()) {
    params.push(query.pedido.trim());
    filtros.push(`pedido = $${params.length}`);
  }
  if (query.reason) {
    params.push(query.reason);
    filtros.push(`reason = $${params.length}`);
  }
  if (query.desde) {
    params.push(query.desde);
    filtros.push(`created_at >= $${params.length}`);
  }
  if (query.hasta) {
    params.push(query.hasta);
    filtros.push(`created_at < $${params.length}`);
  }
  return { where: `where ${filtros.join(' and ')}`, params };
}

/** Peru no cambia de hora: el lunes de la semana de una fecha, en Lima, sale con un desfase fijo. */
const LIMA_MS = -5 * 60 * 60 * 1000;

/** Los lunes (AAAA-MM-DD, en Lima) de las ultimas `n` semanas, la mas vieja primero. */
export function lunesRecientes(n = 8, ahora = new Date()): string[] {
  const local = new Date(ahora.getTime() + LIMA_MS);
  // getUTCDay sobre la fecha desplazada = dia de la semana en Lima (0 = domingo).
  const dia = (local.getUTCDay() + 6) % 7;
  const lunes = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - dia);
  const salida: string[] = [];
  for (let i = n - 1; i >= 0; i--) salida.push(new Date(lunes - i * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  return salida;
}

export function createArchivesRepo(pool: Pool): ArchivesRepo {
  const repo: ArchivesRepo = {
    async add(archive) {
      const { insertId } = await pool.query(
        `insert into chat_archives
           (contact_id, phone, name, file, bytes, message_count,
            first_message_at, last_message_at, reason, sha256, texto_busqueda, pedido, cerrado_por,
            adjuntos, primera_respuesta_seg, origen)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
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
          archive.textoBusqueda ?? null,
          archive.pedido ?? null,
          archive.cerradoPor ?? null,
          JSON.stringify(archive.adjuntos ?? []),
          archive.primeraRespuestaSeg ?? null,
          archive.origen ?? null,
        ],
      );
      return (await repo.get(insertId))!;
    },

    async get(id) {
      const { rows } = await pool.query<Row>('select * from chat_archives where id = $1', [id]);
      return rows[0] ? toArchive(rows[0]) : null;
    },

    async list(query) {
      const { where, params } = condiciones(query);
      const { rows } = await pool.query<Row>(
        `select * from chat_archives ${where}
          order by created_at desc, id desc
          limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, Number(query.limit), Number(query.offset)],
      );
      return rows.map(toArchive);
    },

    async count(query) {
      const { where, params } = condiciones(query);
      const { rows } = await pool.query<{ n: number | string }>(`select count(*) as n from chat_archives ${where}`, params);
      return Number(rows[0]?.n ?? 0);
    },

    async byContact(contactId) {
      const { rows } = await pool.query<Row>(
        'select * from chat_archives where contact_id = $1 and deleted_at is null order by created_at desc, id desc',
        [contactId],
      );
      return rows.map(toArchive);
    },

    async update(id, patch) {
      const sets: string[] = [];
      const valores: unknown[] = [];
      if (patch.resumen !== undefined) {
        valores.push(patch.resumen);
        sets.push(`resumen = $${valores.length}`);
      }
      if (patch.etiquetas !== undefined) {
        valores.push(JSON.stringify(patch.etiquetas));
        sets.push(`etiquetas = $${valores.length}`);
      }
      if (patch.pedido !== undefined) {
        valores.push(patch.pedido);
        sets.push(`pedido = $${valores.length}`);
      }
      if (patch.notas !== undefined) {
        valores.push(patch.notas);
        sets.push(`notas = $${valores.length}`);
      }
      if (patch.deletedAt !== undefined) {
        valores.push(patch.deletedAt);
        sets.push(`deleted_at = $${valores.length}`);
      }
      if (patch.adjuntos !== undefined) {
        valores.push(JSON.stringify(patch.adjuntos));
        sets.push(`adjuntos = $${valores.length}`);
      }
      if (!sets.length) return repo.get(id);
      valores.push(id);
      await pool.query(`update chat_archives set ${sets.join(', ')} where id = $${valores.length}`, valores);
      return repo.get(id);
    },

    async ponerResumenSiFalta(id, resumen, etiquetas) {
      await pool.query('update chat_archives set resumen = $1, etiquetas = $2 where id = $3 and resumen is null', [resumen, JSON.stringify(etiquetas), id]);
      return repo.get(id);
    },

    async remove(id) {
      await pool.query('delete from chat_archives where id = $1', [id]);
    },

    async papeleraVencida(dias, limite) {
      const { rows } = await pool.query<Row>(
        `select * from chat_archives where deleted_at is not null and deleted_at < $1 order by deleted_at asc limit $2`,
        [new Date(Date.now() - dias * 24 * 60 * 60 * 1000), Number(limite)],
      );
      return rows.map(toArchive);
    },

    async sinResumen(limite) {
      const { rows } = await pool.query<Row>(
        `select * from chat_archives where deleted_at is null and resumen is null and message_count > 0 order by created_at desc limit $1`,
        [Number(limite)],
      );
      return rows.map(toArchive);
    },

    async stats() {
      const { rows } = await pool.query<{
        total: number;
        bytes: string | number;
        messages: number;
        en_papelera: number;
        con_reclamo: number;
        con_adjuntos: number;
        primera_respuesta: number | string | null;
      }>(
        `select count(case when deleted_at is null then 1 end) as total,
                coalesce(sum(case when deleted_at is null then bytes end), 0) as bytes,
                coalesce(sum(case when deleted_at is null then message_count end), 0) as messages,
                count(case when deleted_at is not null then 1 end) as en_papelera,
                count(case when deleted_at is null and json_contains(etiquetas, '["reclamo"]') then 1 end) as con_reclamo,
                count(case when deleted_at is null and json_length(adjuntos) > 0 then 1 end) as con_adjuntos,
                avg(case when deleted_at is null then primera_respuesta_seg end) as primera_respuesta
           from chat_archives`,
      );
      const motivos = await pool.query<{ reason: string; n: number | string }>(
        `select reason, count(*) as n from chat_archives where deleted_at is null group by reason`,
      );
      // MariaDB 10.4 no tiene JSON_TABLE para abrir la lista en filas: se
      // traen las listas y se cuentan aqui. Gana la que mas sale; a igualdad,
      // la que aparecio antes.
      const conEtiquetas = await pool.query<{ etiquetas: unknown }>(
        `select etiquetas from chat_archives where deleted_at is null and json_length(etiquetas) > 0`,
      );
      const cuentaEtiquetas = new Map<string, number>();
      for (const fila of conEtiquetas.rows) {
        for (const e of listaJson<unknown>(fila.etiquetas)) {
          const clave = typeof e === 'string' ? e : JSON.stringify(e);
          cuentaEtiquetas.set(clave, (cuentaEtiquetas.get(clave) ?? 0) + 1);
        }
      }
      const etiquetas = [...cuentaEtiquetas].sort((a, b) => b[1] - a[1]).slice(0, 30);
      // Las semanas se cuentan por su lunes en hora de Lima, que es donde
      // esta el negocio; el lunes de cada fila lo calcula la base para que
      // coincida con el que calcula `lunesRecientes`. Lima va a UTC-5 todo el
      // ano (sin horario de verano), asi que no hacen falta las tablas de zonas.
      const lunes = lunesRecientes(8);
      const semanas = await pool.query<{ semana: string; n: number | string }>(
        `select date_format(date_sub(date(convert_tz(created_at, '+00:00', '-05:00')),
                                     interval weekday(convert_tz(created_at, '+00:00', '-05:00')) day), '%Y-%m-%d') as semana,
                count(*) as n
           from chat_archives
          where deleted_at is null and created_at >= $1
          group by semana`,
        [new Date(`${lunes[0]}T00:00:00-05:00`)],
      );
      const porSemanaMapa = new Map(semanas.rows.map((s) => [s.semana, Number(s.n)]));
      const r = rows[0];
      const total = Number(r?.total ?? 0);
      return {
        total,
        bytes: Number(r?.bytes ?? 0),
        messages: Number(r?.messages ?? 0),
        enPapelera: Number(r?.en_papelera ?? 0),
        porMotivo: Object.fromEntries(motivos.rows.map((m) => [m.reason, Number(m.n)])),
        porEtiqueta: Object.fromEntries(etiquetas),
        porSemana: lunes.map((semana) => ({ semana, n: porSemanaMapa.get(semana) ?? 0 })),
        primeraRespuestaMedioSeg: r?.primera_respuesta === null || r?.primera_respuesta === undefined ? null : Math.round(Number(r.primera_respuesta)),
        pctReclamo: total ? Math.round((Number(r?.con_reclamo ?? 0) * 100) / total) : 0,
        conAdjuntos: Number(r?.con_adjuntos ?? 0),
      };
    },
  };
  return repo;
}
