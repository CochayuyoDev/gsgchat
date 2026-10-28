/**
 * Las etiquetas de las conversaciones del dia en Chats (migraciones 013 y 014).
 *
 * Una fila por numero normalizado y dia: la etiqueta que puso la IA (o una
 * persona a mano), de donde salio y la huella de los mensajes que se miraron.
 * GSG la lee como la nota del chat en el historial (GET /api/v1/historial):
 * nada se le manda aparte. Ver src/chat/etiquetar.ts, que decide cuando
 * reutilizarla.
 *
 * Tambien los lotes (cada «Etiquetar») y su registro de eventos, para seguir
 * el flujo y saber por que fallo algo.
 *
 * Las columnas sync_* de la migracion 014 (y las sync_* de los lotes) son de
 * cuando las etiquetas se empujaban a una ruta de GSG: ya no se usan.
 *
 * Aqui tambien vive la lectura de los mensajes del dia, porque es la unica
 * consulta que necesita el etiquetado y asi `messages.ts` no crece mas.
 */

import { randomUUID } from 'node:crypto';
import type { Pool } from './pool.js';
import type { Direction, MessageKind } from './messages.js';
import type { Catalogo } from '../archive/clasificar.js';

export interface EtiquetaChat {
  /** Numero normalizado (51987654321), no el `phone` tal cual de un contacto. */
  phone: string;
  /** AAAA-MM-DD en la zona del negocio. */
  dia: string;
  /** null = no se pudo clasificar. */
  etiqueta: string | null;
  /** Quien la puso: la IA, las reglas (respaldo de antes) o una persona a mano. */
  origen: 'ia' | 'reglas' | 'manual';
  huella: string;
  mensajes: number;
  motivo: string | null;
  updatedAt: Date;
  /** El lote que la clasifico por ultima vez. */
  loteId: string | null;
}

/** Lo que escribe la clasificacion. */
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

/** `reintento` solo aparece en lotes viejos, de cuando se reintentaban los envios a GSG. */
export type TipoLote = 'completo' | 'reintento';
/**
 * en_curso; completado (todo bien); completado_con_errores (termino, pero hay
 * conversaciones que la IA no pudo clasificar); fallido (el lote entero no
 * pudo hacerse: sin IA, error al leer...).
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
  error: string | null;
  iniciadoPor: string | null;
  empezoAt: Date;
  terminoAt: Date | null;
}

/** `sincronizacion` solo aparece en eventos viejos, de cuando se mandaba a GSG. */
export type FaseEvento = 'lote' | 'analisis' | 'sincronizacion';
export type NivelEvento = 'info' | 'aviso' | 'error';

export interface EventoEtiquetas {
  id: number;
  loteId: string | null;
  phone: string | null;
  fase: FaseEvento;
  nivel: NivelEvento;
  /** Un codigo estable para filtrar (lote_inicio, ia_fallo, etiqueta_manual...). */
  codigo: string;
  detalle: string | null;
  createdAt: Date;
}

/** Un mensaje tal como quedo copiado en el lote (lo que se le mando a la IA). */
export interface MensajeCapturado {
  id: number;
  direction: Direction;
  kind: MessageKind;
  body: string | null;
  /** ISO. */
  createdAt: string;
}

/**
 * Como le fue a un chat dentro de un lote: pendiente (copiado, aun sin mirar),
 * reutilizada (no cambio: se uso la etiqueta de antes), clasificada (la IA
 * puso una) o error (la IA fallo o contesto algo que no vale). `solo_envio`
 * solo aparece en lotes viejos (reintentos de envio a GSG).
 */
export type EstadoChatLote = 'pendiente' | 'reutilizada' | 'clasificada' | 'error' | 'solo_envio';

export interface ChatDeLote {
  loteId: string;
  phone: string;
  dia: string;
  nombre: string | null;
  huella: string;
  totalMensajes: number;
  /** La copia de los mensajes; null si no se pidio o si ya paso la retencion. */
  mensajes: MensajeCapturado[] | null;
  estado: EstadoChatLote;
  etiqueta: string | null;
  error: string | null;
  procesadoAt: Date | null;
  createdAt: Date;
}

/**
 * Un ejemplo de etiquetado que enseño el negocio (Entrenamiento IA): una
 * conversacion escrita como «cliente: …» / «negocio: …» por linea y la
 * etiqueta que le toca. `fuente` es «telefono|dia» si salio de corregir a la
 * IA en un chat (para no ofrecer la misma correccion dos veces).
 */
export interface EjemploEtiquetado {
  id: string;
  texto: string;
  etiqueta: string;
  origen: 'manual' | 'correccion';
  fuente: string | null;
  creadoEn: string;
  creadoPor: string | null;
}

/** Donde se guardan los ejemplos: en `settings`, como el uso de la IA (sin tabla ni migracion). */
export const CLAVE_EJEMPLOS_ETIQUETADO = 'etiquetas.ejemplos';

function ejemplosDe(valor: string | null | undefined): EjemploEtiquetado[] {
  if (!valor) return [];
  try {
    const j = JSON.parse(valor) as unknown;
    if (!Array.isArray(j)) return [];
    return j.filter((e): e is EjemploEtiquetado => Boolean(e && typeof e === 'object' && typeof (e as EjemploEtiquetado).texto === 'string' && typeof (e as EjemploEtiquetado).etiqueta === 'string'));
  } catch {
    return [];
  }
}

export interface ChatEtiquetasRepo {
  /**
   * Los mensajes desde `desde` de los chats que se ven en la bandeja (los que
   * empezo el sistema, sin grupos), del mas viejo al mas nuevo. Como mucho `tope`.
   */
  mensajesDelDia(desde: Date, alcance: AlcanceMensajes, tope: number): Promise<MensajeDelDia[]>;
  /** Las etiquetas ya puestas ese dia a esos numeros (sin numeros: todas las del dia). */
  delDia(dia: string, phones?: string[]): Promise<EtiquetaChat[]>;
  /** Guarda la clasificacion (pisa la de ese numero y dia). */
  guardar(e: EtiquetaNueva): Promise<void>;
  /** La mas reciente de cada numero (la de hoy si la hay). */
  ultimas(phones: string[]): Promise<Map<string, EtiquetaChat>>;
  /** Quita la etiqueta de ese dia (el chat vuelve a «sin etiquetar»). */
  quitar(phone: string, dia: string): Promise<void>;

  crearLote(l: Pick<LoteEtiquetas, 'dia' | 'tipo'> & { iniciadoPor?: string | null }): Promise<LoteEtiquetas>;
  actualizarLote(id: string, patch: Partial<Omit<LoteEtiquetas, 'id' | 'dia' | 'tipo' | 'empezoAt'>>): Promise<void>;
  lote(id: string): Promise<LoteEtiquetas | null>;
  /** Los ultimos lotes, el mas reciente primero. */
  lotes(limite: number): Promise<LoteEtiquetas[]>;
  /** Los lotes que quedaron 'en_curso' (un reinicio a mitad): se cierran como fallidos al arrancar. */
  cerrarLotesColgados(error: string): Promise<number>;

  /** Guarda la copia de los chats de un lote al empezar (estado 'pendiente'). */
  capturar(loteId: string, dia: string, chats: Array<{ phone: string; nombre: string | null; huella: string; mensajes: MensajeCapturado[] }>): Promise<void>;
  /** Los chats de un lote, en orden de numero; con la copia de los mensajes solo si se pide. */
  chatsDelLote(loteId: string, conMensajes?: boolean): Promise<ChatDeLote[]>;
  chatDelLote(loteId: string, phone: string): Promise<ChatDeLote | null>;
  marcarChatLote(loteId: string, phone: string, r: { estado: EstadoChatLote; etiqueta?: string | null; error?: string | null }): Promise<void>;
  /** Vacia la copia de los mensajes de los lotes anteriores a `antes` (retencion del chat). Devuelve cuantas. */
  vaciarCopiasAntes(antes: Date): Promise<number>;

  /** El catalogo guardado por el negocio, en su orden; null = no guardo ninguno (vale el de fabrica). */
  catalogo(): Promise<Catalogo | null>;
  /** Sustituye el catalogo entero (ya validado con validarCatalogo). */
  guardarCatalogo(catalogo: Catalogo): Promise<void>;
  /** Vuelve al catalogo de fabrica. */
  borrarCatalogo(): Promise<void>;

  /** Los ejemplos de etiquetado del negocio, en su orden. */
  ejemplos(): Promise<EjemploEtiquetado[]>;
  /** Sustituye la lista entera. */
  guardarEjemplos(ejemplos: EjemploEtiquetado[]): Promise<void>;

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
}

/** date llega como 'AAAA-MM-DD' (ver pool.ts); por si llegara como Date. */
const diaDe = (v: string | Date): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const corto = (t: string | null | undefined, n: number) => (t ? t.slice(0, n) : null);

const deFila = (r: Fila): EtiquetaChat => ({
  phone: r.phone,
  dia: diaDe(r.dia),
  etiqueta: r.etiqueta ?? null,
  origen: r.origen === 'reglas' || r.origen === 'manual' ? r.origen : 'ia',
  huella: r.huella,
  mensajes: Number(r.mensajes),
  motivo: r.motivo ?? null,
  updatedAt: r.updated_at,
  loteId: r.lote_id ?? null,
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
  error: r.error ?? null,
  iniciadoPor: r.iniciado_por ?? null,
  empezoAt: r.empezo_at,
  terminoAt: r.termino_at ?? null,
});

interface FilaChatLote {
  lote_id: string;
  phone: string;
  dia: string | Date;
  nombre: string | null;
  huella: string;
  total_mensajes: number | string;
  mensajes?: unknown;
  estado: string;
  etiqueta: string | null;
  error: string | null;
  procesado_at: Date | null;
  created_at: Date;
}

/** Una columna json llega ya leida (ver pool.ts); por si llegara como cadena, se aceptan las dos formas. */
function mensajesDe(v: unknown): MensajeCapturado[] | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v as MensajeCapturado[];
  if (typeof v === 'string') {
    try {
      const j = JSON.parse(v) as unknown;
      return Array.isArray(j) ? (j as MensajeCapturado[]) : null;
    } catch {
      return null;
    }
  }
  return null;
}

const deFilaChatLote = (r: FilaChatLote): ChatDeLote => ({
  loteId: r.lote_id,
  phone: r.phone,
  dia: diaDe(r.dia),
  nombre: r.nombre ?? null,
  huella: r.huella,
  totalMensajes: Number(r.total_mensajes),
  mensajes: mensajesDe(r.mensajes),
  estado: r.estado as EstadoChatLote,
  etiqueta: r.etiqueta ?? null,
  error: r.error ?? null,
  procesadoAt: r.procesado_at ?? null,
  createdAt: r.created_at,
});

const COLUMNAS_LOTE: Record<string, string> = {
  estado: 'estado',
  total: 'total',
  reutilizadas: 'reutilizadas',
  clasificadas: 'clasificadas',
  porIA: 'por_ia',
  sinClasificar: 'sin_clasificar',
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
      await pool.query(
        `insert into chat_etiquetas (phone, dia, etiqueta, origen, huella, mensajes, motivo, lote_id, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, now(3))
         on duplicate key update
           etiqueta = values(etiqueta), origen = values(origen), huella = values(huella),
           mensajes = values(mensajes), motivo = values(motivo), lote_id = values(lote_id), updated_at = now(3)`,
        [e.phone, e.dia, e.etiqueta, e.origen, e.huella, e.mensajes, corto(e.motivo, 255), e.loteId ?? null],
      );
    },

    async ultimas(phones) {
      if (!phones.length) return new Map();
      const { rows } = await pool.query<Fila>('select * from chat_etiquetas where phone in ($1)', [phones]);
      return ultimaDeCada(rows.map(deFila));
    },

    async quitar(phone, dia) {
      await pool.query('delete from chat_etiquetas where phone = $1 and dia = $2', [phone, dia]);
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

    async capturar(loteId, dia, chats) {
      // De a 50 filas por sentencia: una conversacion larga ya pesa lo suyo.
      for (let i = 0; i < chats.length; i += 50) {
        const tanda = chats.slice(i, i + 50);
        const valores: unknown[] = [];
        const filas = tanda.map((c) => {
          valores.push(loteId, c.phone, dia, corto(c.nombre, 191), c.huella, c.mensajes.length, JSON.stringify(c.mensajes), 'pendiente');
          const n = valores.length;
          return `($${n - 7}, $${n - 6}, $${n - 5}, $${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}, $${n})`;
        });
        await pool.query(
          `insert into chat_etiquetas_lote_chats (lote_id, phone, dia, nombre, huella, total_mensajes, mensajes, estado) values ${filas.join(', ')}`,
          valores,
        );
      }
    },

    async chatsDelLote(loteId, conMensajes) {
      const columnas = conMensajes ? '*' : 'lote_id, phone, dia, nombre, huella, total_mensajes, estado, etiqueta, error, procesado_at, created_at';
      const { rows } = await pool.query<FilaChatLote>(`select ${columnas} from chat_etiquetas_lote_chats where lote_id = $1 order by phone`, [loteId]);
      return rows.map(deFilaChatLote);
    },

    async chatDelLote(loteId, phone) {
      const { rows } = await pool.query<FilaChatLote>('select * from chat_etiquetas_lote_chats where lote_id = $1 and phone = $2', [loteId, phone]);
      return rows[0] ? deFilaChatLote(rows[0]) : null;
    },

    async marcarChatLote(loteId, phone, r) {
      await pool.query(
        'update chat_etiquetas_lote_chats set estado = $1, etiqueta = $2, error = $3, procesado_at = now(3) where lote_id = $4 and phone = $5',
        [r.estado, r.etiqueta ?? null, corto(r.error, 500), loteId, phone],
      );
    },

    async vaciarCopiasAntes(antes) {
      const { rowCount } = await pool.query('update chat_etiquetas_lote_chats set mensajes = null where created_at < $1 and mensajes is not null', [antes]);
      return rowCount ?? 0;
    },

    async catalogo() {
      const { rows } = await pool.query<{ codigo: string; nombre: string; descripcion: string }>('select codigo, nombre, descripcion from chat_etiquetas_catalogo order by orden, codigo');
      return rows.length ? rows.map((r) => ({ codigo: r.codigo, nombre: r.nombre, descripcion: r.descripcion })) : null;
    },

    async guardarCatalogo(catalogo) {
      // Borrar y escribir en una conexion, en una transaccion: nadie lee un catalogo a medias.
      const cliente = await pool.connect();
      try {
        await cliente.query('start transaction');
        await cliente.query('delete from chat_etiquetas_catalogo');
        const valores: unknown[] = [];
        const filas = catalogo.map((e, i) => {
          valores.push(e.codigo, e.nombre, e.descripcion, i);
          const n = valores.length;
          return `($${n - 3}, $${n - 2}, $${n - 1}, $${n}, now(3))`;
        });
        await cliente.query(`insert into chat_etiquetas_catalogo (codigo, nombre, descripcion, orden, updated_at) values ${filas.join(', ')}`, valores);
        await cliente.query('commit');
      } catch (error) {
        await cliente.query('rollback').catch(() => undefined);
        throw error;
      } finally {
        cliente.release();
      }
    },

    async borrarCatalogo() {
      await pool.query('delete from chat_etiquetas_catalogo');
    },

    async ejemplos() {
      // `key` es palabra reservada en MySQL: siempre entre comillas invertidas.
      const { rows } = await pool.query<{ value: string }>('select value from settings where `key` = $1', [CLAVE_EJEMPLOS_ETIQUETADO]);
      return ejemplosDe(rows[0]?.value);
    },

    async guardarEjemplos(ejemplos) {
      await pool.query(
        `insert into settings (\`key\`, value, encrypted, updated_at)
         values ($1, $2, false, now(3))
         on duplicate key update value = values(value), encrypted = false, updated_at = now(3)`,
        [CLAVE_EJEMPLOS_ETIQUETADO, JSON.stringify(ejemplos)],
      );
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
  const chatsLote = new Map<string, ChatDeLote>();
  let catalogoGuardado: Catalogo | null = null;
  let ejemplosGuardados: EjemploEtiquetado[] = [];
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
      });
    },
    async ultimas(phones) {
      return ultimaDeCada([...filas.values()].filter((f) => phones.includes(f.phone)));
    },
    async quitar(phone, dia) {
      filas.delete(clave(phone, dia));
    },
    async crearLote(l) {
      const lote: LoteEtiquetas = { id: randomUUID(), dia: l.dia, tipo: l.tipo, estado: 'en_curso', total: 0, reutilizadas: 0, clasificadas: 0, porIA: 0, sinClasificar: 0, error: null, iniciadoPor: l.iniciadoPor ?? null, empezoAt: new Date(), terminoAt: null };
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
    async capturar(loteId, dia, chats) {
      for (const c of chats) {
        chatsLote.set(`${loteId}|${c.phone}`, { loteId, phone: c.phone, dia, nombre: c.nombre, huella: c.huella, totalMensajes: c.mensajes.length, mensajes: c.mensajes.map((m) => ({ ...m })), estado: 'pendiente', etiqueta: null, error: null, procesadoAt: null, createdAt: new Date() });
      }
    },
    async chatsDelLote(loteId, conMensajes) {
      return [...chatsLote.values()].filter((c) => c.loteId === loteId).sort((a, b) => a.phone.localeCompare(b.phone)).map((c) => ({ ...c, mensajes: conMensajes ? c.mensajes : null }));
    },
    async chatDelLote(loteId, phone) {
      const c = chatsLote.get(`${loteId}|${phone}`);
      return c ? { ...c } : null;
    },
    async marcarChatLote(loteId, phone, r) {
      const c = chatsLote.get(`${loteId}|${phone}`);
      if (!c) return;
      Object.assign(c, { estado: r.estado, etiqueta: r.etiqueta ?? null, error: corto(r.error, 500), procesadoAt: new Date() });
    },
    async vaciarCopiasAntes(antes) {
      let n = 0;
      for (const c of chatsLote.values()) {
        if (c.createdAt < antes && c.mensajes) {
          c.mensajes = null;
          n++;
        }
      }
      return n;
    },
    async catalogo() {
      return catalogoGuardado ? catalogoGuardado.map((e) => ({ ...e })) : null;
    },
    async guardarCatalogo(catalogo) {
      catalogoGuardado = catalogo.map((e) => ({ ...e }));
    },
    async borrarCatalogo() {
      catalogoGuardado = null;
    },
    async ejemplos() {
      return ejemplosGuardados.map((e) => ({ ...e }));
    },
    async guardarEjemplos(ejemplos) {
      ejemplosGuardados = ejemplos.map((e) => ({ ...e }));
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
