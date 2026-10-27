/**
 * Las etiquetas de las conversaciones del dia en Chats (migraciones 013 y 014).
 *
 * Una fila por numero normalizado y dia: la etiqueta que puso la IA (o las
 * reglas, si la IA fallo), de donde salio, la huella de los mensajes que se
 * miraron y el estado de su envio a GSG. Ver src/chat/etiquetar.ts, que es
 * quien decide cuando reutilizarla y cuando mandarla.
 *
 * Tambien los lotes (cada «Etiquetar» y cada reintento de envios) y su
 * registro de eventos, para seguir el flujo y saber por que fallo algo.
 *
 * Aqui tambien vive la lectura de los mensajes del dia, porque es la unica
 * consulta que necesita el etiquetado y asi `messages.ts` no crece mas.
 */

import { randomUUID } from 'node:crypto';
import type { Pool } from './pool.js';
import type { Direction, MessageKind } from './messages.js';

/**
 * El envio a GSG de una etiqueta:
 *  - pendiente: hay que mandarla (nueva, cambiada, o no se llego a intentar).
 *  - enviado: GSG la acepto (2xx) con esta huella.
 *  - fallido: GSG la rechazo o no respondio; `syncError` dice por que. Solo
 *    estas (y las pendientes) se reintentan, sin volver a la IA.
 *  - no_aplica: no hay etiqueta que mandar (no se pudo clasificar).
 */
export type EstadoSync = 'pendiente' | 'enviado' | 'fallido' | 'no_aplica';

export interface EtiquetaChat {
  /** Numero normalizado (51987654321), no el `phone` tal cual de un contacto. */
  phone: string;
  /** AAAA-MM-DD en la zona del negocio. */
  dia: string;
  /** null = no se pudo clasificar. */
  etiqueta: string | null;
  origen: 'ia' | 'reglas';
  huella: string;
  mensajes: number;
  motivo: string | null;
  updatedAt: Date;
  /** El lote que la clasifico por ultima vez. */
  loteId: string | null;
  syncEstado: EstadoSync;
  syncIntentos: number;
  syncError: string | null;
  syncAt: Date | null;
  /** La huella con la que GSG la acepto (null = nunca enviada). */
  syncHuella: string | null;
}

/** Lo que escribe la clasificacion; el estado del envio lo decide el repo. */
export type EtiquetaNueva = Pick<EtiquetaChat, 'phone' | 'dia' | 'etiqueta' | 'origen' | 'huella' | 'mensajes' | 'motivo'> & { loteId?: string | null };

export interface MensajeDelDia {
  id: number;
  contactId: string;
  phone: string;
  name: string | null;
  direction: Direction;
  kind: MessageKind;
  body: string | null;
  createdAt: Date;
}

/** Lo mismo que limita la bandeja (src/web/alcance-chat.ts). */
export interface AlcanceMensajes {
  afterId: string;
  retenidosDesde: Date;
}

export type TipoLote = 'completo' | 'reintento';
/**
 * en_curso; completado (todo bien); completado_con_errores (termino, pero hay
 * conversaciones sin clasificar o envios fallidos/pendientes); fallido (el
 * lote entero no pudo hacerse: sin IA, error al leer...).
 */
export type EstadoLote = 'en_curso' | 'completado' | 'completado_con_errores' | 'fallido';

export interface LoteEtiquetas {
  id: string;
  dia: string;
  tipo: TipoLote;
  estado: EstadoLote;
  total: number;
  reutilizadas: number;
  clasificadas: number;
  porIA: number;
  sinClasificar: number;
  syncEnviadas: number;
  syncFallidas: number;
  syncPendientes: number;
  error: string | null;
  iniciadoPor: string | null;
  empezoAt: Date;
  terminoAt: Date | null;
}

export type FaseEvento = 'lote' | 'analisis' | 'sincronizacion';
export type NivelEvento = 'info' | 'aviso' | 'error';

export interface EventoEtiquetas {
  id: number;
  loteId: string | null;
  phone: string | null;
  fase: FaseEvento;
  nivel: NivelEvento;
  /** Un codigo estable para filtrar (lote_inicio, ia_fallo, gsg_rechazo...). */
  codigo: string;
  detalle: string | null;
  createdAt: Date;
}

export interface ChatEtiquetasRepo {
  /**
   * Los mensajes desde `desde` de los chats que se ven en la bandeja (los que
   * empezo el sistema, sin grupos), del mas viejo al mas nuevo. Como mucho `tope`.
   */
  mensajesDelDia(desde: Date, alcance: AlcanceMensajes, tope: number): Promise<MensajeDelDia[]>;
  /** Las etiquetas ya puestas ese dia a esos numeros (sin numeros: todas las del dia). */
  delDia(dia: string, phones?: string[]): Promise<EtiquetaChat[]>;
  /**
   * Guarda la clasificacion. Si la etiqueta y la huella son las que GSG ya
   * acepto, el envio sigue 'enviado'; si cambiaron, vuelve a 'pendiente'; sin
   * etiqueta, 'no_aplica'.
   */
  guardar(e: EtiquetaNueva): Promise<void>;
  /** La mas reciente de cada numero (la de hoy si la hay). */
  ultimas(phones: string[]): Promise<Map<string, EtiquetaChat>>;
  /** Las de ese dia con etiqueta y el envio en alguno de esos estados. */
  porSincronizar(dia: string, estados: EstadoSync[]): Promise<EtiquetaChat[]>;
  /** Apunta el resultado de un intento de envio (suma un intento). */
  marcarSync(phone: string, dia: string, r: { estado: Exclude<EstadoSync, 'no_aplica'>; error?: string | null; huella?: string | null; contarIntento?: boolean }): Promise<void>;

  crearLote(l: Pick<LoteEtiquetas, 'dia' | 'tipo'> & { iniciadoPor?: string | null }): Promise<LoteEtiquetas>;
  actualizarLote(id: string, patch: Partial<Omit<LoteEtiquetas, 'id' | 'dia' | 'tipo' | 'empezoAt'>>): Promise<void>;
  lote(id: string): Promise<LoteEtiquetas | null>;
  /** Los ultimos lotes, el mas reciente primero. */
  lotes(limite: number): Promise<LoteEtiquetas[]>;
  /** Los lotes que quedaron 'en_curso' (un reinicio a mitad): se cierran como fallidos al arrancar. */
  cerrarLotesColgados(error: string): Promise<number>;

  registrar(e: Omit<EventoEtiquetas, 'id' | 'createdAt'>): Promise<void>;
  /** El registro, el mas reciente primero. */
  eventos(q: { loteId?: string; nivel?: NivelEvento; phone?: string; fase?: FaseEvento; limite: number }): Promise<EventoEtiquetas[]>;
}

interface Fila {
  phone: string;
  dia: string | Date;
  etiqueta: string | null;
  origen: string;
  huella: string;
  mensajes: number | string;
  motivo: string | null;
  updated_at: Date;
  lote_id: string | null;
  sync_estado: string;
  sync_intentos: number | string;
  sync_error: string | null;
  sync_at: Date | null;
  sync_huella: string | null;
}

/** date llega como 'AAAA-MM-DD' (ver pool.ts); por si llegara como Date. */
const diaDe = (v: string | Date): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const ESTADOS_SYNC = new Set<string>(['pendiente', 'enviado', 'fallido', 'no_aplica']);
const corto = (t: string | null | undefined, n: number) => (t ? t.slice(0, n) : null);

const deFila = (r: Fila): EtiquetaChat => ({
  phone: r.phone,
  dia: diaDe(r.dia),
  etiqueta: r.etiqueta ?? null,
  origen: r.origen === 'reglas' ? 'reglas' : 'ia',
  huella: r.huella,
  mensajes: Number(r.mensajes),
  motivo: r.motivo ?? null,
  updatedAt: r.updated_at,
  loteId: r.lote_id ?? null,
  syncEstado: (ESTADOS_SYNC.has(r.sync_estado) ? r.sync_estado : 'pendiente') as EstadoSync,
  syncIntentos: Number(r.sync_intentos ?? 0),
  syncError: r.sync_error ?? null,
  syncAt: r.sync_at ?? null,
  syncHuella: r.sync_huella ?? null,
});

interface FilaLote {
  id: string;
  dia: string | Date;
  tipo: string;
  estado: string;
  total: number | string;
  reutilizadas: number | string;
  clasificadas: number | string;
  por_ia: number | string;
  sin_clasificar: number | string;
  sync_enviadas: number | string;
  sync_fallidas: number | string;
  sync_pendientes: number | string;
  error: string | null;
  iniciado_por: string | null;
  empezo_at: Date;
  termino_at: Date | null;
}

const deFilaLote = (r: FilaLote): LoteEtiquetas => ({
  id: r.id,
  dia: diaDe(r.dia),
  tipo: r.tipo === 'reintento' ? 'reintento' : 'completo',
  estado: r.estado as EstadoLote,
  total: Number(r.total),
  reutilizadas: Number(r.reutilizadas),
  clasificadas: Number(r.clasificadas),
  porIA: Number(r.por_ia),
  sinClasificar: Number(r.sin_clasificar),
  syncEnviadas: Number(r.sync_enviadas),
  syncFallidas: Number(r.sync_fallidas),
  syncPendientes: Number(r.sync_pendientes),
  error: r.error ?? null,
  iniciadoPor: r.iniciado_por ?? null,
  empezoAt: r.empezo_at,
  terminoAt: r.termino_at ?? null,
});

const COLUMNAS_LOTE: Record<string, string> = {
  estado: 'estado',
  total: 'total',
  reutilizadas: 'reutilizadas',
  clasificadas: 'clasificadas',
  porIA: 'por_ia',
  sinClasificar: 'sin_clasificar',
  syncEnviadas: 'sync_enviadas',
  syncFallidas: 'sync_fallidas',
  syncPendientes: 'sync_pendientes',
  error: 'error',
  iniciadoPor: 'iniciado_por',
  terminoAt: 'termino_at',
};

/** La mas reciente de cada numero: por dia y, en el mismo dia, la ultima escrita. */
function ultimaDeCada(filas: EtiquetaChat[]): Map<string, EtiquetaChat> {
  const salida = new Map<string, EtiquetaChat>();
  for (const f of filas) {
    const ya = salida.get(f.phone);
    if (!ya || f.dia > ya.dia || (f.dia === ya.dia && f.updatedAt > ya.updatedAt)) salida.set(f.phone, f);
  }
  return salida;
}

/** El estado del envio tras guardar una clasificacion (la misma regla en SQL y en memoria). */
function syncTrasGuardar(antes: EtiquetaChat | undefined, e: EtiquetaNueva): EstadoSync {
  if (!e.etiqueta) return 'no_aplica';
  if (antes && antes.syncEstado === 'enviado' && antes.syncHuella === e.huella && antes.etiqueta === e.etiqueta) return 'enviado';
  return 'pendiente';
}

export function crearChatEtiquetasRepo(pool: Pool): ChatEtiquetasRepo {
  const repo: ChatEtiquetasRepo = {
    async mensajesDelDia(desde, alcance, tope) {
      // La misma visibilidad que la bandeja (listConversations): lo importado
      // del historial y lo escrito desde el telefono no cuenta.
      const visible = (a: string) => `${a}.id > $2 and ${a}.stored_at > $3
          and coalesce(json_unquote(json_extract(${a}.payload, '$.historial')), 'false') <> 'true'
          and coalesce(json_unquote(json_extract(${a}.payload, '$.autorNombre')), '') <> 'Teléfono'`;
      const { rows } = await pool.query<{
        id: number;
        contact_id: string;
        phone: string;
        name: string | null;
        direction: Direction;
        kind: MessageKind;
        body: string | null;
        created_at: Date;
      }>(
        `select m.id, m.contact_id, c.phone, c.name, m.direction, m.kind, m.body, m.created_at
           from messages m
           join contacts c on c.id = m.contact_id
          where m.created_at >= $1
            and c.tipo <> 'grupo'
            and ${visible('m')}
            and m.contact_id in (
              select s.contact_id from messages s
               where s.direction = 'out' and s.wamid is not null
                 and coalesce(s.status, '') not in ('failed', 'blocked_by_gate')
                 and ${visible('s')}
            )
          order by m.created_at asc, m.id asc
          limit $4`,
        [desde, alcance.afterId, alcance.retenidosDesde, Number(tope)],
      );
      return rows.map((r) => ({
        id: Number(r.id),
        contactId: r.contact_id,
        phone: r.phone,
        name: r.name,
        direction: r.direction,
        kind: r.kind,
        body: r.body,
        createdAt: r.created_at,
      }));
    },

    async delDia(dia, phones) {
      if (phones && !phones.length) return [];
      const { rows } = phones
        ? await pool.query<Fila>('select * from chat_etiquetas where dia = $1 and phone in ($2) order by phone', [dia, phones])
        : await pool.query<Fila>('select * from chat_etiquetas where dia = $1 order by phone', [dia]);
      return rows.map(deFila);
    },

    async guardar(e) {
      // MySQL aplica las asignaciones de izquierda a derecha y cada una ve lo
      // ya cambiado: las del envio van ANTES de pisar etiqueta y huella.
      const sigueEnviado = `sync_estado = 'enviado' and sync_huella <=> values(huella) and etiqueta <=> values(etiqueta)`;
      await pool.query(
        `insert into chat_etiquetas (phone, dia, etiqueta, origen, huella, mensajes, motivo, lote_id, sync_estado, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(3))
         on duplicate key update
           sync_intentos = case when values(etiqueta) is null or ${sigueEnviado} then sync_intentos else 0 end,
           sync_error = case when values(etiqueta) is null or ${sigueEnviado} then sync_error else null end,
           sync_estado = case when values(etiqueta) is null then 'no_aplica' when ${sigueEnviado} then 'enviado' else 'pendiente' end,
           etiqueta = values(etiqueta), origen = values(origen), huella = values(huella),
           mensajes = values(mensajes), motivo = values(motivo), lote_id = values(lote_id), updated_at = now(3)`,
        [e.phone, e.dia, e.etiqueta, e.origen, e.huella, e.mensajes, corto(e.motivo, 255), e.loteId ?? null, e.etiqueta ? 'pendiente' : 'no_aplica'],
      );
    },

    async ultimas(phones) {
      if (!phones.length) return new Map();
      const { rows } = await pool.query<Fila>('select * from chat_etiquetas where phone in ($1)', [phones]);
      return ultimaDeCada(rows.map(deFila));
    },

    async porSincronizar(dia, estados) {
      if (!estados.length) return [];
      const { rows } = await pool.query<Fila>(
        'select * from chat_etiquetas where dia = $1 and etiqueta is not null and sync_estado in ($2) order by phone',
        [dia, estados],
      );
      return rows.map(deFila);
    },

    async marcarSync(phone, dia, r) {
      await pool.query(
        `update chat_etiquetas
            set sync_estado = $1, sync_error = $2, sync_at = now(3),
                sync_intentos = sync_intentos + $3,
                sync_huella = case when $1 = 'enviado' then coalesce($4, huella) else sync_huella end
          where phone = $5 and dia = $6`,
        [r.estado, corto(r.error, 500), r.contarIntento === false ? 0 : 1, r.huella ?? null, phone, dia],
      );
    },

    async crearLote(l) {
      const id = randomUUID();
      await pool.query(
        `insert into chat_etiquetas_lotes (id, dia, tipo, estado, iniciado_por, empezo_at) values ($1, $2, $3, 'en_curso', $4, now(3))`,
        [id, l.dia, l.tipo, corto(l.iniciadoPor, 191)],
      );
      return (await repo.lote(id))!;
    },

    async actualizarLote(id, patch) {
      const sets: string[] = [];
      const valores: unknown[] = [];
      for (const [clave, valor] of Object.entries(patch)) {
        const columna = COLUMNAS_LOTE[clave];
        if (!columna || valor === undefined) continue;
        valores.push(clave === 'error' ? corto(valor as string | null, 500) : valor);
        sets.push(`${columna} = $${valores.length}`);
      }
      if (!sets.length) return;
      valores.push(id);
      await pool.query(`update chat_etiquetas_lotes set ${sets.join(', ')} where id = $${valores.length}`, valores);
    },

    async lote(id) {
      const { rows } = await pool.query<FilaLote>('select * from chat_etiquetas_lotes where id = $1', [id]);
      return rows[0] ? deFilaLote(rows[0]) : null;
    },

    async lotes(limite) {
      const { rows } = await pool.query<FilaLote>('select * from chat_etiquetas_lotes order by empezo_at desc, id desc limit $1', [Number(limite)]);
      return rows.map(deFilaLote);
    },

    async cerrarLotesColgados(error) {
      const { rowCount } = await pool.query(
        `update chat_etiquetas_lotes set estado = 'fallido', error = $1, termino_at = now(3) where estado = 'en_curso'`,
        [corto(error, 500)],
      );
      return rowCount ?? 0;
    },

    async registrar(e) {
      await pool.query(
        `insert into chat_etiquetas_eventos (lote_id, phone, fase, nivel, codigo, detalle) values ($1, $2, $3, $4, $5, $6)`,
        [e.loteId, e.phone, e.fase, e.nivel, e.codigo.slice(0, 60), corto(e.detalle, 500)],
      );
    },

    async eventos(q) {
      const filtros: string[] = [];
      const valores: unknown[] = [];
      const poner = (columna: string, valor: unknown) => {
        valores.push(valor);
        filtros.push(`${columna} = $${valores.length}`);
      };
      if (q.loteId) poner('lote_id', q.loteId);
      if (q.nivel) poner('nivel', q.nivel);
      if (q.phone) poner('phone', q.phone);
      if (q.fase) poner('fase', q.fase);
      valores.push(Number(q.limite));
      const { rows } = await pool.query<{
        id: number;
        lote_id: string | null;
        phone: string | null;
        fase: FaseEvento;
        nivel: NivelEvento;
        codigo: string;
        detalle: string | null;
        created_at: Date;
      }>(
        `select * from chat_etiquetas_eventos ${filtros.length ? `where ${filtros.join(' and ')}` : ''} order by id desc limit $${valores.length}`,
        valores,
      );
      return rows.map((r) => ({ id: Number(r.id), loteId: r.lote_id, phone: r.phone, fase: r.fase, nivel: r.nivel, codigo: r.codigo, detalle: r.detalle, createdAt: r.created_at }));
    },
  };
  return repo;
}

/** En memoria, para las pruebas (y para quien arranca sin base). `mensajes` hace de tabla `messages`. */
export function crearChatEtiquetasEnMemoria(mensajes: () => MensajeDelDia[] = () => []): ChatEtiquetasRepo {
  const filas = new Map<string, EtiquetaChat>();
  const lotes = new Map<string, LoteEtiquetas>();
  const eventos: EventoEtiquetas[] = [];
  const clave = (phone: string, dia: string) => `${phone}|${dia}`;
  const repo: ChatEtiquetasRepo = {
    async mensajesDelDia(desde, _alcance, tope) {
      return mensajes()
        .filter((m) => m.createdAt >= desde)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id)
        .slice(0, tope);
    },
    async delDia(dia, phones) {
      return [...filas.values()].filter((f) => f.dia === dia && (!phones || phones.includes(f.phone))).map((f) => ({ ...f }));
    },
    async guardar(e) {
      const antes = filas.get(clave(e.phone, e.dia));
      const sync = syncTrasGuardar(antes, e);
      const sigue = sync === 'enviado' || sync === 'no_aplica';
      filas.set(clave(e.phone, e.dia), {
        phone: e.phone,
        dia: e.dia,
        etiqueta: e.etiqueta,
        origen: e.origen,
        huella: e.huella,
        mensajes: e.mensajes,
        motivo: corto(e.motivo, 255),
        updatedAt: new Date(),
        loteId: e.loteId ?? null,
        syncEstado: sync,
        syncIntentos: sigue ? antes?.syncIntentos ?? 0 : 0,
        syncError: sigue ? antes?.syncError ?? null : null,
        syncAt: antes?.syncAt ?? null,
        syncHuella: antes?.syncHuella ?? null,
      });
    },
    async ultimas(phones) {
      return ultimaDeCada([...filas.values()].filter((f) => phones.includes(f.phone)));
    },
    async porSincronizar(dia, estados) {
      return [...filas.values()].filter((f) => f.dia === dia && f.etiqueta && estados.includes(f.syncEstado)).map((f) => ({ ...f }));
    },
    async marcarSync(phone, dia, r) {
      const f = filas.get(clave(phone, dia));
      if (!f) return;
      f.syncEstado = r.estado;
      f.syncError = corto(r.error, 500);
      f.syncAt = new Date();
      if (r.contarIntento !== false) f.syncIntentos++;
      if (r.estado === 'enviado') f.syncHuella = r.huella ?? f.huella;
    },
    async crearLote(l) {
      const lote: LoteEtiquetas = { id: randomUUID(), dia: l.dia, tipo: l.tipo, estado: 'en_curso', total: 0, reutilizadas: 0, clasificadas: 0, porIA: 0, sinClasificar: 0, syncEnviadas: 0, syncFallidas: 0, syncPendientes: 0, error: null, iniciadoPor: l.iniciadoPor ?? null, empezoAt: new Date(), terminoAt: null };
      lotes.set(lote.id, lote);
      return { ...lote };
    },
    async actualizarLote(id, patch) {
      const l = lotes.get(id);
      if (!l) return;
      for (const [k, v] of Object.entries(patch)) if (v !== undefined && k in COLUMNAS_LOTE) (l as unknown as Record<string, unknown>)[k] = k === 'error' ? corto(v as string | null, 500) : v;
    },
    async lote(id) {
      const l = lotes.get(id);
      return l ? { ...l } : null;
    },
    async lotes(limite) {
      // Map conserva el orden de creacion: a igual hora, el creado despues va primero.
      const orden = [...lotes.keys()];
      return [...lotes.values()].sort((a, b) => b.empezoAt.getTime() - a.empezoAt.getTime() || orden.indexOf(b.id) - orden.indexOf(a.id)).slice(0, limite).map((l) => ({ ...l }));
    },
    async cerrarLotesColgados(error) {
      let n = 0;
      for (const l of lotes.values()) {
        if (l.estado !== 'en_curso') continue;
        Object.assign(l, { estado: 'fallido', error, terminoAt: new Date() });
        n++;
      }
      return n;
    },
    async registrar(e) {
      eventos.push({ ...e, codigo: e.codigo.slice(0, 60), detalle: corto(e.detalle, 500), id: eventos.length + 1, createdAt: new Date() });
    },
    async eventos(q) {
      return eventos
        .filter((e) => (!q.loteId || e.loteId === q.loteId) && (!q.nivel || e.nivel === q.nivel) && (!q.phone || e.phone === q.phone) && (!q.fase || e.fase === q.fase))
        .sort((a, b) => b.id - a.id)
        .slice(0, q.limite)
        .map((e) => ({ ...e }));
    },
  };
  return repo;
}
