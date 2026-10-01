/**
 * Datos del modulo de rutas: lotes, solicitudes de ubicacion, bitacora y la
 * cola de lo que hay que reportarle a GSG.
 *
 * `Repos` lo expone como `repos.rutas`.
 */

import { nuevoId, type Pool } from './pool.js';
import type { CodigoIncidencia } from '../rutas/incidencias.js';
import { createAjustesRepo, type AjustesRepo } from '../rutas/ajustes.js';

export type EstadoLote = 'preparado' | 'enviando' | 'pausado' | 'terminado';

export type EstadoSolicitud =
  | 'pendiente'
  | 'enviado'
  | 'respondio'
  | 'resuelto'
  | 'supervision'
  | 'derivado'
  | 'incidencia'
  | 'cancelado';

export const ESTADOS_SOLICITUD: EstadoSolicitud[] = [
  'pendiente',
  'enviado',
  'respondio',
  'resuelto',
  'supervision',
  'derivado',
  'incidencia',
  'cancelado',
];

/** Estados en los que el motor todavia tiene algo que hacer. */
export const ESTADOS_VIVOS: EstadoSolicitud[] = ['pendiente', 'enviado', 'respondio'];

/**
 * Estados de quien todavia no ha dado su ubicacion.
 *
 * Es la pregunta que hace GSG cada manana ("cuantos faltan") y no coincide
 * con ningun estado suelto: faltan los que esperan, los que contestaron
 * otra cosa, los que pasaron al repartidor y los numeros rotos. Solo
 * `resuelto` la tiene; `cancelado` ya no la va a dar y no cuenta.
 */
export const ESTADOS_SIN_UBICACION: EstadoSolicitud[] = ESTADOS_SOLICITUD.filter(
  (estado) => estado !== 'resuelto' && estado !== 'cancelado',
);

export interface Lote {
  id: string;
  nombre: string;
  origen: string;
  estado: EstadoLote;
  notas: string | null;
  externoId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LoteConCifras extends Lote {
  total: number;
  /** Cuantas hay en cada estado. */
  cifras: Record<string, number>;
}

export interface Solicitud {
  id: number;
  loteId: string;
  contactId: string | null;
  telefonoCrudo: string;
  phone: string | null;
  nombre: string | null;
  referencia: string | null;
  direccion: string | null;
  distrito: string | null;
  notas: string | null;
  estado: EstadoSolicitud;
  intentos: number;
  ultimoEnvioAt: Date | null;
  proximoIntentoAt: Date | null;
  primeraRespuestaAt: Date | null;
  resueltoAt: Date | null;
  lat: number | null;
  lng: number | null;
  precisionM: number | null;
  ubicacionFuente: string | null;
  mapsUrl: string | null;
  incidencia: CodigoIncidencia | null;
  incidenciaDetalle: string | null;
  requiereHumano: boolean;
  asignadoA: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NuevaSolicitud {
  telefonoCrudo: string;
  phone?: string | null;
  nombre?: string | null;
  referencia?: string | null;
  direccion?: string | null;
  distrito?: string | null;
  notas?: string | null;
  estado?: EstadoSolicitud;
  incidencia?: CodigoIncidencia | null;
  incidenciaDetalle?: string | null;
  requiereHumano?: boolean;
  proximoIntentoAt?: Date | null;
}

export type SolicitudPatch = Partial<
  Pick<
    Solicitud,
    | 'contactId'
    | 'phone'
    // Se corrige a mano cuando el numero vino mal en el fichero: es la
    // reparacion mas comun de todas.
    | 'telefonoCrudo'
    | 'nombre'
    | 'referencia'
    | 'direccion'
    | 'distrito'
    | 'notas'
    | 'estado'
    | 'intentos'
    | 'ultimoEnvioAt'
    | 'proximoIntentoAt'
    | 'primeraRespuestaAt'
    | 'resueltoAt'
    | 'lat'
    | 'lng'
    | 'precisionM'
    | 'ubicacionFuente'
    | 'mapsUrl'
    | 'incidencia'
    | 'incidenciaDetalle'
    | 'requiereHumano'
    | 'asignadoA'
  >
>;

export type TipoEvento =
  | 'envio'
  | 'respuesta'
  | 'ubicacion'
  | 'incidencia'
  | 'derivacion'
  | 'reporte'
  | 'nota';

export interface EventoSolicitud {
  id: number;
  solicitudId: number;
  tipo: TipoEvento;
  detalle: string | null;
  payload: Record<string, unknown> | null;
  createdAt: Date;
}

/**
 * Lo que se le cuenta a GSG. Los dos ultimos son del modulo de entregas
 * (src/entregas): que el cliente confirmo su pedido, y a que hora le llega.
 */
export type TipoReporte = 'ubicacion' | 'incidencia' | 'resumen' | 'confirmacion' | 'entrega';
export type EstadoReporte = 'pendiente' | 'enviado' | 'fallido';

export type CifrasReportes = Record<EstadoReporte, number> & { atascado: number };

export interface Reporte {
  id: number;
  solicitudId: number | null;
  loteId: string | null;
  tipo: TipoReporte;
  payload: Record<string, unknown>;
  estado: EstadoReporte;
  intentos: number;
  ultimoError: string | null;
  externoId: string | null;
  enviadoAt: Date | null;
  createdAt: Date;
}

export interface ConsultaSolicitudes {
  loteId?: string;
  estado?: EstadoSolicitud;
  /** Varios a la vez: "sin ubicacion todavia" son seis estados distintos. */
  estados?: EstadoSolicitud[];
  incidencia?: CodigoIncidencia;
  /** Varias a la vez: "numero mal escrito" son cuatro codigos distintos. */
  incidencias?: CodigoIncidencia[];
  requiereHumano?: boolean;
  q?: string;
  limit: number;
  offset: number;
}

/** Una solicitud viva con el lote al que pertenece (para la lista de envio automatico). */
export interface SolicitudConLote extends Solicitud {
  lote: Pick<Lote, 'id' | 'nombre' | 'estado'>;
}

/** Un evento del reparto con el cliente al que se refiere. */
export interface EventoReciente extends EventoSolicitud {
  phone: string | null;
  nombre: string | null;
  referencia: string | null;
  loteNombre: string;
}

export interface RutasRepo {
  /** Los ajustes del reparto que se cambian desde la pantalla. */
  ajustes: AjustesRepo;
  crearLote(datos: { nombre: string; origen?: string; notas?: string | null; externoId?: string | null }): Promise<Lote>;
  lote(id: string): Promise<Lote | null>;
  listarLotes(limit: number, offset: number): Promise<LoteConCifras[]>;
  cambiarEstadoLote(id: string, estado: EstadoLote): Promise<Lote | null>;
  borrarLote(id: string): Promise<void>;
  /** Lotes que el motor debe trabajar ahora mismo. */
  lotesActivos(): Promise<Lote[]>;

  agregarSolicitudes(loteId: string, filas: NuevaSolicitud[]): Promise<Solicitud[]>;
  solicitud(id: number): Promise<Solicitud | null>;
  listarSolicitudes(query: ConsultaSolicitudes): Promise<Solicitud[]>;
  contarSolicitudes(query: Omit<ConsultaSolicitudes, 'limit' | 'offset'>): Promise<number>;
  actualizarSolicitud(id: number, patch: SolicitudPatch): Promise<Solicitud>;
  cifrasPorEstado(loteId?: string): Promise<Record<string, number>>;
  cifrasPorIncidencia(loteId?: string): Promise<Record<string, number>>;
  /** Las que toca intentar ahora, de los lotes en marcha y en orden de espera. */
  tocaIntentar(ahora: Date, limite: number): Promise<Solicitud[]>;
  /** La solicitud viva de un contacto: con esto se lee su respuesta. */
  abiertaPorContacto(contactId: string): Promise<Solicitud | null>;
  /** Con `excluirLoteId`, la abierta en OTRO lote: para no escribir dos veces por lo mismo. */
  abiertaPorTelefono(phone: string, excluirLoteId?: string): Promise<Solicitud | null>;
  /**
   * La ultima solicitud YA RESUELTA de ese telefono en un lote que sigue en
   * marcha: para cuando el cliente manda un segundo pin corrigiendo el
   * primero. Con el lote terminado ya no hay nada que corregir.
   */
  resueltaRecientePorTelefono(phone: string): Promise<Solicitud | null>;
  telefonosDelLote(loteId: string): Promise<string[]>;

  registrarEvento(
    solicitudId: number,
    tipo: TipoEvento,
    detalle?: string | null,
    payload?: Record<string, unknown> | null,
  ): Promise<void>;
  eventos(solicitudId: number, limite?: number): Promise<EventoSolicitud[]>;
  /**
   * Las solicitudes a las que el reparto todavia les esta escribiendo (o
   * les va a escribir), con su lote: pendientes, enviadas y respondidas de
   * los lotes que no terminaron. Es lo que la lista de envio automatico
   * ensena como "puestos por el reparto".
   */
  vivasEnLotesAbiertos(limite: number): Promise<SolicitudConLote[]>;
  /** Los ultimos eventos de todo el reparto, con el cliente de cada uno. */
  eventosRecientes(limite: number): Promise<EventoReciente[]>;

  encolarReporte(reporte: {
    solicitudId?: number | null;
    loteId?: string | null;
    tipo: TipoReporte;
    payload: Record<string, unknown>;
  }): Promise<Reporte>;
  reportesPendientes(limite: number): Promise<Reporte[]>;
  marcarReporte(
    id: number,
    estado: EstadoReporte,
    extra?: { externoId?: string | null; error?: string | null },
  ): Promise<void>;
  /**
   * Cuantos hay en cada estado. `atascado` son los pendientes que ya se
   * intentaron mandar y GSG no acepto (no respondio): siguen en cola, pero
   * la pantalla tiene que avisar, no esperar a que sean veinte.
   */
  cifrasReportes(): Promise<CifrasReportes>;
}

// ------------------------------------------------------------- mapeo

interface LoteRow {
  id: string;
  nombre: string;
  origen: string;
  estado: EstadoLote;
  notas: string | null;
  externo_id: string | null;
  created_at: Date;
  updated_at: Date;
}

const toLote = (r: LoteRow): Lote => ({
  id: r.id,
  nombre: r.nombre,
  origen: r.origen,
  estado: r.estado,
  notas: r.notas,
  externoId: r.externo_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

interface SolicitudRow {
  id: number;
  lote_id: string;
  contact_id: string | null;
  telefono_crudo: string;
  phone: string | null;
  nombre: string | null;
  referencia: string | null;
  direccion: string | null;
  distrito: string | null;
  notas: string | null;
  estado: EstadoSolicitud;
  intentos: number;
  ultimo_envio_at: Date | null;
  proximo_intento_at: Date | null;
  primera_respuesta_at: Date | null;
  resuelto_at: Date | null;
  lat: number | string | null;
  lng: number | string | null;
  precision_m: number | null;
  ubicacion_fuente: string | null;
  maps_url: string | null;
  incidencia: CodigoIncidencia | null;
  incidencia_detalle: string | null;
  requiere_humano: boolean;
  asignado_a: string | null;
  created_at: Date;
  updated_at: Date;
}

const toSolicitud = (r: SolicitudRow): Solicitud => ({
  id: Number(r.id),
  loteId: r.lote_id,
  contactId: r.contact_id,
  telefonoCrudo: r.telefono_crudo,
  phone: r.phone,
  nombre: r.nombre,
  referencia: r.referencia,
  direccion: r.direccion,
  distrito: r.distrito,
  notas: r.notas,
  estado: r.estado,
  intentos: r.intentos,
  ultimoEnvioAt: r.ultimo_envio_at,
  proximoIntentoAt: r.proximo_intento_at,
  primeraRespuestaAt: r.primera_respuesta_at,
  resueltoAt: r.resuelto_at,
  lat: r.lat == null ? null : Number(r.lat),
  lng: r.lng == null ? null : Number(r.lng),
  precisionM: r.precision_m,
  ubicacionFuente: r.ubicacion_fuente,
  mapsUrl: r.maps_url,
  incidencia: r.incidencia,
  incidenciaDetalle: r.incidencia_detalle,
  requiereHumano: r.requiere_humano,
  asignadoA: r.asignado_a,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Nombre de columna por campo. Unico sitio donde se casan los dos nombres. */
const COLUMNAS: Record<keyof SolicitudPatch, string> = {
  contactId: 'contact_id',
  phone: 'phone',
  telefonoCrudo: 'telefono_crudo',
  nombre: 'nombre',
  referencia: 'referencia',
  direccion: 'direccion',
  distrito: 'distrito',
  notas: 'notas',
  estado: 'estado',
  intentos: 'intentos',
  ultimoEnvioAt: 'ultimo_envio_at',
  proximoIntentoAt: 'proximo_intento_at',
  primeraRespuestaAt: 'primera_respuesta_at',
  resueltoAt: 'resuelto_at',
  lat: 'lat',
  lng: 'lng',
  precisionM: 'precision_m',
  ubicacionFuente: 'ubicacion_fuente',
  mapsUrl: 'maps_url',
  incidencia: 'incidencia',
  incidenciaDetalle: 'incidencia_detalle',
  requiereHumano: 'requiere_humano',
  asignadoA: 'asignado_a',
};

interface ReporteRow {
  id: number;
  solicitud_id: number | null;
  lote_id: string | null;
  tipo: TipoReporte;
  payload: Record<string, unknown>;
  estado: EstadoReporte;
  intentos: number;
  ultimo_error: string | null;
  externo_id: string | null;
  enviado_at: Date | null;
  created_at: Date;
}

const toReporte = (r: ReporteRow): Reporte => ({
  id: Number(r.id),
  solicitudId: r.solicitud_id == null ? null : Number(r.solicitud_id),
  loteId: r.lote_id,
  tipo: r.tipo,
  payload: r.payload,
  estado: r.estado,
  intentos: r.intentos,
  ultimoError: r.ultimo_error,
  externoId: r.externo_id,
  enviadoAt: r.enviado_at,
  createdAt: r.created_at,
});

// -------------------------------------------------------- implementacion

export function createRutasRepo(pool: Pool): RutasRepo {
  /** Filtros comunes de la lista de solicitudes. */
  function filtros(query: Omit<ConsultaSolicitudes, 'limit' | 'offset'>) {
    const params: unknown[] = [];
    const partes: string[] = [];
    if (query.loteId) {
      params.push(query.loteId);
      partes.push(`lote_id = $${params.length}`);
    }
    if (query.estado) {
      params.push(query.estado);
      partes.push(`estado = $${params.length}`);
    }
    if (query.estados?.length) {
      params.push(query.estados);
      partes.push(`estado in ($${params.length})`);
    }
    if (query.incidencia) {
      params.push(query.incidencia);
      partes.push(`incidencia = $${params.length}`);
    }
    if (query.incidencias?.length) {
      params.push(query.incidencias);
      partes.push(`incidencia in ($${params.length})`);
    }
    if (query.requiereHumano !== undefined) {
      params.push(query.requiereHumano);
      partes.push(`requiere_humano = $${params.length}`);
    }
    if (query.q?.trim()) {
      // La colacion es binaria (distingue mayusculas): el ilike de antes es
      // lower(...) like lower(...).
      params.push(`%${query.q.trim()}%`);
      const n = params.length;
      partes.push(
        `(lower(telefono_crudo) like lower($${n}) or lower(phone) like lower($${n})` +
          ` or lower(nombre) like lower($${n}) or lower(referencia) like lower($${n}))`,
      );
    }
    return { where: partes.length ? `where ${partes.join(' and ')}` : '', params };
  }

  async function solicitud(id: number): Promise<Solicitud | null> {
    const { rows } = await pool.query<SolicitudRow>('select * from rutas_solicitudes where id = $1', [id]);
    return rows[0] ? toSolicitud(rows[0]) : null;
  }

  return {
    ajustes: createAjustesRepo(pool),

    // ------------------------------------------------------------ lotes

    async crearLote(datos) {
      const id = nuevoId();
      await pool.query(
        `insert into rutas_lotes (id, nombre, origen, notas, externo_id)
         values ($1, $2, $3, $4, $5)`,
        [id, datos.nombre, datos.origen ?? 'csv', datos.notas ?? null, datos.externoId ?? null],
      );
      const { rows } = await pool.query<LoteRow>('select * from rutas_lotes where id = $1', [id]);
      return toLote(rows[0]!);
    },

    async lote(id) {
      const { rows } = await pool.query<LoteRow>('select * from rutas_lotes where id = $1', [id]);
      return rows[0] ? toLote(rows[0]) : null;
    },

    async listarLotes(limit, offset) {
      // Sin LATERAL ni jsonb_object_agg (MariaDB no los tiene): la pagina de
      // lotes y, aparte, el conteo por estado de esos lotes, que se junta aqui.
      const { rows } = await pool.query<LoteRow>(
        `select * from rutas_lotes order by created_at desc limit $1 offset $2`,
        [Number(limit), Number(offset)],
      );
      const cifrasPorLote = new Map<string, Record<string, number>>();
      if (rows.length) {
        const conteo = await pool.query<{ lote_id: string; estado: string; n: number }>(
          `select lote_id, estado, count(*) as n
             from rutas_solicitudes where lote_id in ($1) group by lote_id, estado`,
          [rows.map((r) => r.id)],
        );
        for (const c of conteo.rows) {
          const cifras = cifrasPorLote.get(c.lote_id) ?? {};
          cifras[c.estado] = Number(c.n);
          cifrasPorLote.set(c.lote_id, cifras);
        }
      }
      return rows.map((r) => {
        const cifras = cifrasPorLote.get(r.id) ?? {};
        return {
          ...toLote(r),
          total: Object.values(cifras).reduce((a, b) => a + b, 0),
          cifras,
        };
      });
    },

    async cambiarEstadoLote(id, estado) {
      await pool.query('update rutas_lotes set estado = $2, updated_at = now(3) where id = $1', [id, estado]);
      const { rows } = await pool.query<LoteRow>('select * from rutas_lotes where id = $1', [id]);
      return rows[0] ? toLote(rows[0]) : null;
    },

    async borrarLote(id) {
      await pool.query('delete from rutas_lotes where id = $1', [id]);
    },

    async lotesActivos() {
      const { rows } = await pool.query<LoteRow>(
        `select * from rutas_lotes where estado = 'enviando' order by created_at`,
      );
      return rows.map(toLote);
    },

    // ------------------------------------------------------- solicitudes

    async agregarSolicitudes(loteId, filas) {
      if (!filas.length) return [];
      const creadas: Solicitud[] = [];
      for (const fila of filas) {
        const { insertId } = await pool.query(
          `insert into rutas_solicitudes
             (lote_id, telefono_crudo, phone, nombre, referencia, direccion, distrito, notas,
              estado, incidencia, incidencia_detalle, requiere_humano, proximo_intento_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            loteId,
            fila.telefonoCrudo,
            fila.phone ?? null,
            fila.nombre ?? null,
            fila.referencia ?? null,
            fila.direccion ?? null,
            fila.distrito ?? null,
            fila.notas ?? null,
            fila.estado ?? 'pendiente',
            fila.incidencia ?? null,
            fila.incidenciaDetalle ?? null,
            fila.requiereHumano ?? false,
            fila.proximoIntentoAt ?? null,
          ],
        );
        creadas.push((await solicitud(insertId))!);
      }
      return creadas;
    },

    solicitud,

    async listarSolicitudes(query) {
      const { where, params } = filtros(query);
      const { rows } = await pool.query<SolicitudRow>(
        `select * from rutas_solicitudes ${where}
          order by
            -- Primero lo que espera a una persona, que es lo que se mira.
            requiere_humano desc,
            case estado
              when 'supervision' then 0 when 'incidencia' then 1 when 'derivado' then 2
              when 'respondio' then 3 when 'enviado' then 4 when 'pendiente' then 5
              else 6 end,
            id asc
          limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, Number(query.limit), Number(query.offset)],
      );
      return rows.map(toSolicitud);
    },

    async contarSolicitudes(query) {
      const { where, params } = filtros(query);
      const { rows } = await pool.query<{ total: number }>(
        `select count(*) as total from rutas_solicitudes ${where}`,
        params,
      );
      return Number(rows[0]?.total ?? 0);
    },

    async actualizarSolicitud(id, patch) {
      const campos = Object.keys(patch) as Array<keyof SolicitudPatch>;
      const asignaciones: string[] = [];
      const valores: unknown[] = [id];

      for (const campo of campos) {
        const columna = COLUMNAS[campo];
        if (!columna) continue;
        valores.push(patch[campo] ?? null);
        asignaciones.push(`${columna} = $${valores.length}`);
      }
      if (!asignaciones.length) return (await solicitud(id))!;

      await pool.query(
        `update rutas_solicitudes set ${asignaciones.join(', ')}, updated_at = now(3)
          where id = $1`,
        valores,
      );
      return (await solicitud(id))!;
    },

    async cifrasPorEstado(loteId) {
      const { rows } = await pool.query<{ estado: string; total: number }>(
        `select estado, count(*) as total from rutas_solicitudes
          ${loteId ? 'where lote_id = $1' : ''}
          group by estado`,
        loteId ? [loteId] : [],
      );
      return Object.fromEntries(rows.map((r) => [r.estado, Number(r.total)]));
    },

    async cifrasPorIncidencia(loteId) {
      const { rows } = await pool.query<{ incidencia: string; total: number }>(
        `select incidencia, count(*) as total from rutas_solicitudes
          where incidencia is not null ${loteId ? 'and lote_id = $1' : ''}
          group by incidencia`,
        loteId ? [loteId] : [],
      );
      return Object.fromEntries(rows.map((r) => [r.incidencia, Number(r.total)]));
    },

    async tocaIntentar(ahora, limite) {
      const { rows } = await pool.query<SolicitudRow>(
        `select s.* from rutas_solicitudes s
           join rutas_lotes l on l.id = s.lote_id
          where l.estado = 'enviando'
            and s.estado in ('pendiente','enviado','respondio')
            and s.phone is not null
            and (s.proximo_intento_at is null or s.proximo_intento_at <= $1)
          -- El que lleva mas esperando, primero. Sin esto un lote nuevo
          -- adelanta a los recordatorios del anterior y nadie recibe el suyo.
          order by coalesce(s.proximo_intento_at, s.created_at) asc, s.id asc
          limit $2`,
        [ahora, Number(limite)],
      );
      return rows.map(toSolicitud);
    },

    async abiertaPorContacto(contactId) {
      const { rows } = await pool.query<SolicitudRow>(
        `select * from rutas_solicitudes
          where contact_id = $1 and estado in ('pendiente','enviado','respondio','supervision','derivado')
          order by id desc limit 1`,
        [contactId],
      );
      return rows[0] ? toSolicitud(rows[0]) : null;
    },

    async abiertaPorTelefono(phone, excluirLoteId) {
      const { rows } = await pool.query<SolicitudRow>(
        `select * from rutas_solicitudes
          where phone = $1 and estado in ('pendiente','enviado','respondio','supervision','derivado')
            and ($2 is null or lote_id <> $2)
          order by id desc limit 1`,
        [phone, excluirLoteId ?? null],
      );
      return rows[0] ? toSolicitud(rows[0]) : null;
    },

    async resueltaRecientePorTelefono(phone) {
      const { rows } = await pool.query<SolicitudRow>(
        `select s.* from rutas_solicitudes s
          join rutas_lotes l on l.id = s.lote_id
          where s.phone = $1 and s.estado = 'resuelto' and l.estado <> 'terminado'
          order by s.id desc limit 1`,
        [phone],
      );
      return rows[0] ? toSolicitud(rows[0]) : null;
    },

    async telefonosDelLote(loteId) {
      const { rows } = await pool.query<{ phone: string | null; telefono_crudo: string }>(
        'select phone, telefono_crudo from rutas_solicitudes where lote_id = $1',
        [loteId],
      );
      return rows.map((r) => r.phone ?? r.telefono_crudo);
    },

    // ---------------------------------------------------------- bitacora

    async registrarEvento(solicitudId, tipo, detalle, payload) {
      await pool.query(
        `insert into rutas_eventos (solicitud_id, tipo, detalle, payload)
         values ($1,$2,$3,$4)`,
        [solicitudId, tipo, detalle ?? null, payload ? JSON.stringify(payload) : null],
      );
    },

    async eventos(solicitudId, limite = 200) {
      const { rows } = await pool.query<{
        id: number;
        solicitud_id: number;
        tipo: TipoEvento;
        detalle: string | null;
        payload: Record<string, unknown> | null;
        created_at: Date;
      }>(
        `select * from rutas_eventos where solicitud_id = $1
          order by created_at asc, id asc limit $2`,
        [solicitudId, Number(limite)],
      );
      return rows.map((r) => ({
        id: Number(r.id),
        solicitudId: Number(r.solicitud_id),
        tipo: r.tipo,
        detalle: r.detalle,
        payload: r.payload,
        createdAt: r.created_at,
      }));
    },

    // ---------------------------------------------------------- reportes

    async vivasEnLotesAbiertos(limite) {
      const { rows } = await pool.query<SolicitudRow & { lote_nombre: string; lote_estado: EstadoLote }>(
        `select s.*, l.nombre as lote_nombre, l.estado as lote_estado
           from rutas_solicitudes s
           join rutas_lotes l on l.id = s.lote_id
          where l.estado <> 'terminado'
            and s.estado in ('pendiente','enviado','respondio')
          order by coalesce(s.proximo_intento_at, s.created_at) asc, s.id asc
          limit $1`,
        [Number(limite)],
      );
      return rows.map((r) => ({ ...toSolicitud(r), lote: { id: r.lote_id, nombre: r.lote_nombre, estado: r.lote_estado } }));
    },

    async eventosRecientes(limite) {
      const { rows } = await pool.query<{
        id: number;
        solicitud_id: number;
        tipo: TipoEvento;
        detalle: string | null;
        payload: Record<string, unknown> | null;
        created_at: Date;
        phone: string | null;
        nombre: string | null;
        referencia: string | null;
        lote_nombre: string;
      }>(
        `select e.*, s.phone, s.nombre, s.referencia, l.nombre as lote_nombre
           from rutas_eventos e
           join rutas_solicitudes s on s.id = e.solicitud_id
           join rutas_lotes l on l.id = s.lote_id
          order by e.id desc
          limit $1`,
        [Number(limite)],
      );
      return rows.map((r) => ({
        id: Number(r.id),
        solicitudId: Number(r.solicitud_id),
        tipo: r.tipo,
        detalle: r.detalle,
        payload: r.payload,
        createdAt: r.created_at,
        phone: r.phone,
        nombre: r.nombre,
        referencia: r.referencia,
        loteNombre: r.lote_nombre,
      }));
    },

    async encolarReporte(reporte) {
      const { insertId } = await pool.query(
        `insert into rutas_reportes (solicitud_id, lote_id, tipo, payload)
         values ($1,$2,$3,$4)`,
        [
          reporte.solicitudId ?? null,
          reporte.loteId ?? null,
          reporte.tipo,
          JSON.stringify(reporte.payload),
        ],
      );
      const { rows } = await pool.query<ReporteRow>('select * from rutas_reportes where id = $1', [insertId]);
      return toReporte(rows[0]!);
    },

    async reportesPendientes(limite) {
      const { rows } = await pool.query<ReporteRow>(
        `select * from rutas_reportes where estado = 'pendiente'
          order by created_at asc, id asc limit $1`,
        [Number(limite)],
      );
      return rows.map(toReporte);
    },

    async marcarReporte(id, estado, extra) {
      await pool.query(
        `update rutas_reportes
            set estado = $2,
                intentos = intentos + 1,
                externo_id = coalesce($3, externo_id),
                ultimo_error = $4,
                enviado_at = case when $2 = 'enviado' then now(3) else enviado_at end
          where id = $1`,
        [id, estado, extra?.externoId ?? null, extra?.error?.slice(0, 500) ?? null],
      );
    },

    async cifrasReportes() {
      const { rows } = await pool.query<{ estado: EstadoReporte; total: number; atascados: number }>(
        `select estado, count(*) as total,
                sum(case when estado = 'pendiente' and intentos > 0 then 1 else 0 end) as atascados
           from rutas_reportes group by estado`,
      );
      const cifras: CifrasReportes = { pendiente: 0, enviado: 0, fallido: 0, atascado: 0 };
      for (const r of rows) {
        cifras[r.estado] = Number(r.total);
        if (r.estado === 'pendiente') cifras.atascado = Number(r.atascados);
      }
      return cifras;
    },
  };
}
