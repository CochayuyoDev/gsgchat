/**
 * Los numeros reportados a GSG («Luis») y lo que ya se hizo por WhatsApp
 * con cada tracking.
 *
 * Cuando un pedido que mando GSG trae un telefono o un tracking malo,
 * GSGchat se lo cuenta a GSG con su error concreto: UN reporte por tracking
 * + error (no uno en cada reintento ni en cada pasada del motor). El reporte
 * sale por la cola de siempre (`rutas_reportes`, tipo `numero_reportado`) a
 * la ruta configurable de GSG (URL base + ruta, como la ubicacion). Y se
 * guarda en `numeros_reportados` (migracion 006): es la bandeja que GSG lee
 * con GET /api/v1/reportados y que el equipo ve en Pedidos GSG. GSG corrige
 * con POST /api/v1/reportados/{tracking}/correccion o con PATCH
 * /api/v1/entregas/{referencia}.
 *
 * GSGchat nunca le pregunta nada a GSG: todo lo que GSG manda se guarda al
 * llegar y se usa desde la base. Lo que se le manda son POST sueltos.
 *
 * Ademas, el «mapa» de trackings del dia (GET /api/v1/trackings) y los
 * avisos por pedido que acompanan cada respuesta a GSG (ya_contactado,
 * agrupado_con, ubicacion_pedida...). Se calculan SOLO con el dia pedido: un
 * cliente que GSG vuelve a mandar otro dia es un intento nuevo y se le
 * escribe otra vez.
 */

import type { Pool } from '../db/pool.js';
import type { RutasRepo, Solicitud } from '../db/rutas.js';
import { despacharReportes, type PuertoGsg } from '../rutas/gsg.js';
import { diaTexto, type Entrega, type EntregasRepo } from './repo.js';

// ------------------------------------------------------------- errores

/** Los errores que se le reportan a GSG. Codigos estables: GSG los lee. */
export const ERRORES_REPORTADOS = [
  'telefono_invalido',
  'sin_whatsapp',
  'envio_fallido',
  'tracking_falta',
  'tracking_invalido',
  'tracking_duplicado',
  'tracking_de_otro_pedido',
  'telefono_de_motorizado',
  'no_soy_yo',
] as const;
export type ErrorReportado = (typeof ERRORES_REPORTADOS)[number];

interface DatosMensaje {
  tracking: string | null;
  telefono: string | null;
}

const tel = (d: DatosMensaje) => (d.telefono ? `«${d.telefono}»` : '(sin teléfono)');
const trk = (d: DatosMensaje) => (d.tracking ? `«${d.tracking}»` : '');

/** Que es cada error, en palabras para GSG y para el equipo. */
export const TEXTOS_REPORTADOS: Record<ErrorReportado, { titulo: string; mensaje: (d: DatosMensaje) => string }> = {
  telefono_invalido: {
    titulo: 'Teléfono inválido',
    mensaje: (d) => `El teléfono ${tel(d)} no es un número válido: no se le puede escribir. Corrígelo y vuelve a mandarlo.`,
  },
  sin_whatsapp: {
    titulo: 'Número sin WhatsApp',
    mensaje: (d) => `El número ${tel(d)} no tiene WhatsApp: no se le puede pedir la ubicación. Manda otro número del cliente.`,
  },
  envio_fallido: {
    titulo: 'Falló el envío por WhatsApp',
    mensaje: (d) => `El mensaje por WhatsApp al ${tel(d)} falló y no se reintenta solo. Revisa el número y mándalo corregido.`,
  },
  tracking_falta: {
    titulo: 'Falta el tracking',
    mensaje: () => 'El pedido llegó sin tracking: no se puede seguir ni reportar su ubicación. Mándalo con su tracking.',
  },
  tracking_invalido: {
    titulo: 'Tracking inválido',
    mensaje: (d) => `El tracking ${trk(d) || '(vacío)'} no es válido (vacío, demasiado largo o con caracteres no permitidos). Mándalo corregido.`,
  },
  tracking_duplicado: {
    titulo: 'Tracking duplicado',
    mensaje: (d) => `El tracking ${trk(d)} vino repetido en la misma llamada con otro teléfono: no se sabe cuál es el bueno. Se guardó solo el primero.`,
  },
  tracking_de_otro_pedido: {
    titulo: 'Tracking de otro pedido',
    mensaje: (d) => `El tracking ${trk(d)} ya es de otro pedido de hoy con otro teléfono: este no se guardó. Revisa cuál es el bueno.`,
  },
  telefono_de_motorizado: {
    titulo: 'Teléfono de un motorizado',
    mensaje: (d) => `El teléfono ${tel(d)} es de un motorizado, no de un cliente: no se le escribe como cliente. Manda el número del cliente.`,
  },
  no_soy_yo: {
    titulo: '«No soy yo»',
    mensaje: (d) => `El ${tel(d)} contestó que no es el cliente (no hizo el pedido o el número no es suyo). Manda el número correcto.`,
  },
};

/** El error del primer mensaje (ver primer-mensaje.ts) que es un numero malo, o null si no lo es. */
export function errorDeEnvio(codigo: string | null | undefined): ErrorReportado | null {
  const c = codigo ?? '';
  if (c === 'sin_whatsapp') return 'sin_whatsapp';
  if (c === 'numero_invalido' || c === 'telefono_invalido') return 'telefono_invalido';
  // Fallos de WhatsApp que ya no se reintentan solos. Las guardas propias
  // (baja, modo prueba, plantilla, regla del dueño) no son culpa del numero.
  if (c.startsWith('rechazado') || c === 'reintentos_agotados') return 'envio_fallido';
  return null;
}

// --------------------------------------------------------------- modelo

export type EstadoReportado = 'pendiente' | 'corregido';

export interface NumeroReportado {
  id: number;
  /** El tracking; sin tracking, `ref:<referencia>` o `tel:<telefono>`. */
  clave: string;
  error: ErrorReportado;
  dia: string;
  tracking: string | null;
  referencia: string | null;
  /** El telefono tal como llego de GSG. */
  telefono: string | null;
  mensaje: string;
  detalle: string | null;
  entregaId: number | null;
  /** El pedido tal como lo mando GSG (para crearlo al corregirlo si no se guardo). */
  pedido: Record<string, unknown> | null;
  estado: EstadoReportado;
  reportadoAt: Date;
  corregidoAt: Date | null;
  correccion: Record<string, unknown> | null;
  /** Veces que se reporto (sube si el error vuelve despues de corregido). */
  veces: number;
}

export interface NuevoReportado {
  error: ErrorReportado;
  dia: string;
  tracking?: string | null;
  referencia?: string | null;
  telefono?: string | null;
  detalle?: string | null;
  entregaId?: number | null;
  pedido?: Record<string, unknown> | null;
}

export interface ReportadosRepo {
  /**
   * Lo apunta UNA vez por clave + error. Devuelve la fila si hay que
   * reportarlo ahora (nuevo, o reabierto porque ya se habia corregido) y null
   * si ya estaba pendiente (no se repite).
   */
  reportar(n: NuevoReportado & { clave: string; mensaje: string }, en: Date): Promise<NumeroReportado | null>;
  listar(filtro: { estado?: EstadoReportado; clave?: string; limit?: number }): Promise<NumeroReportado[]>;
  /** Marca corregidos los pendientes de esa clave. Devuelve los que cambiaron. */
  marcarCorregidos(clave: string, correccion: Record<string, unknown>, en: Date): Promise<NumeroReportado[]>;
}

/** La clave de un reporte: el tracking; si no hay, la referencia; si tampoco, el telefono. */
export function claveDe(n: { tracking?: string | null; referencia?: string | null; telefono?: string | null }): string {
  const t = String(n.tracking ?? '').trim();
  if (t) return t.slice(0, 191);
  const r = String(n.referencia ?? '').trim();
  if (r) return `ref:${r}`.slice(0, 191);
  return `tel:${String(n.telefono ?? '').trim() || '?'}`.slice(0, 191);
}

const textoONulo = (v: unknown, max = 191): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

// ------------------------------------------------------------ MySQL

interface FilaReportado {
  id: number | string;
  clave: string;
  error: ErrorReportado;
  dia: string | Date;
  tracking: string | null;
  referencia: string | null;
  telefono: string | null;
  mensaje: string;
  detalle: string | null;
  entrega_id: number | string | null;
  pedido: unknown;
  estado: EstadoReportado;
  reportado_at: Date;
  corregido_at: Date | null;
  correccion: unknown;
  veces: number;
}

const json = (v: unknown): Record<string, unknown> | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return typeof v === 'object' ? (v as Record<string, unknown>) : null;
};

const deFila = (r: FilaReportado): NumeroReportado => ({
  id: Number(r.id),
  clave: r.clave,
  error: r.error,
  dia: diaTexto(r.dia) ?? '',
  tracking: r.tracking,
  referencia: r.referencia,
  telefono: r.telefono,
  mensaje: r.mensaje,
  detalle: r.detalle,
  entregaId: r.entrega_id == null ? null : Number(r.entrega_id),
  pedido: json(r.pedido),
  estado: r.estado,
  reportadoAt: new Date(r.reportado_at),
  corregidoAt: r.corregido_at ? new Date(r.corregido_at) : null,
  correccion: json(r.correccion),
  veces: Number(r.veces ?? 1),
});

export function crearReportadosRepo(pool: Pool): ReportadosRepo {
  const porClaveYError = async (clave: string, error: string): Promise<NumeroReportado | null> => {
    const { rows } = await pool.query<FilaReportado>('select * from numeros_reportados where clave = $1 and error = $2', [clave, error]);
    return rows[0] ? deFila(rows[0]) : null;
  };
  return {
    async reportar(n, en) {
      const valores = [n.clave, n.error, n.dia, textoONulo(n.tracking), textoONulo(n.referencia), textoONulo(n.telefono), n.mensaje.slice(0, 500), textoONulo(n.detalle, 500), n.entregaId ?? null, n.pedido ? JSON.stringify(n.pedido) : null, en];
      const nuevo = await pool.query(
        `insert ignore into numeros_reportados (clave, error, dia, tracking, referencia, telefono, mensaje, detalle, entrega_id, pedido, reportado_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        valores,
      );
      if (nuevo.rowCount === 1) return porClaveYError(n.clave, n.error);
      // Ya estaba: si se habia corregido y el error vuelve, se reabre (y se reporta otra vez).
      const reabierto = await pool.query(
        `update numeros_reportados
            set estado = 'pendiente', dia = $3, tracking = $4, referencia = $5, telefono = $6, mensaje = $7, detalle = $8,
                entrega_id = coalesce($9, entrega_id), pedido = coalesce($10, pedido), reportado_at = $11,
                corregido_at = null, correccion = null, veces = veces + 1
          where clave = $1 and error = $2 and estado = 'corregido'`,
        valores,
      );
      return reabierto.rowCount === 1 ? porClaveYError(n.clave, n.error) : null;
    },
    async listar(filtro) {
      const condiciones: string[] = [];
      const params: unknown[] = [];
      if (filtro.estado) {
        params.push(filtro.estado);
        condiciones.push(`estado = $${params.length}`);
      }
      if (filtro.clave) {
        params.push(filtro.clave, filtro.clave);
        condiciones.push(`(clave = $${params.length - 1} or referencia = $${params.length})`);
      }
      params.push(Math.min(Math.max(Number(filtro.limit ?? 500), 1), 2000));
      const { rows } = await pool.query<FilaReportado>(
        `select * from numeros_reportados ${condiciones.length ? `where ${condiciones.join(' and ')}` : ''}
          order by reportado_at desc, id desc limit $${params.length}`,
        params,
      );
      return rows.map(deFila);
    },
    async marcarCorregidos(clave, correccion, en) {
      const { rows } = await pool.query<FilaReportado>(`select * from numeros_reportados where (clave = $1 or referencia = $1) and estado = 'pendiente'`, [clave]);
      const hechos: NumeroReportado[] = [];
      for (const r of rows) {
        const u = await pool.query(`update numeros_reportados set estado = 'corregido', corregido_at = $2, correccion = $3 where id = $1 and estado = 'pendiente'`, [r.id, en, JSON.stringify(correccion)]);
        if (u.rowCount === 1) hechos.push({ ...deFila(r), estado: 'corregido', corregidoAt: en, correccion });
      }
      return hechos;
    },
  };
}

// --------------------------------------------------------- en memoria

/** Lo mismo sin base: para las pruebas y la demo. */
export function crearReportadosEnMemoria(): ReportadosRepo & { _filas: NumeroReportado[] } {
  const filas: NumeroReportado[] = [];
  let seq = 1;
  const copia = (r: NumeroReportado): NumeroReportado => structuredClone(r);
  return {
    _filas: filas,
    async reportar(n, en) {
      const ya = filas.find((f) => f.clave === n.clave && f.error === n.error);
      const datos = {
        dia: n.dia,
        tracking: textoONulo(n.tracking),
        referencia: textoONulo(n.referencia),
        telefono: textoONulo(n.telefono),
        mensaje: n.mensaje.slice(0, 500),
        detalle: textoONulo(n.detalle, 500),
        reportadoAt: en,
      };
      if (!ya) {
        const fila: NumeroReportado = { id: seq++, clave: n.clave, error: n.error, ...datos, entregaId: n.entregaId ?? null, pedido: n.pedido ? structuredClone(n.pedido) : null, estado: 'pendiente', corregidoAt: null, correccion: null, veces: 1 };
        filas.push(fila);
        return copia(fila);
      }
      if (ya.estado !== 'corregido') return null;
      Object.assign(ya, datos, { estado: 'pendiente', corregidoAt: null, correccion: null, veces: ya.veces + 1, entregaId: n.entregaId ?? ya.entregaId, pedido: n.pedido ? structuredClone(n.pedido) : ya.pedido });
      return copia(ya);
    },
    async listar(filtro) {
      return filas
        .filter((f) => (!filtro.estado || f.estado === filtro.estado) && (!filtro.clave || f.clave === filtro.clave || f.referencia === filtro.clave))
        .sort((a, b) => b.reportadoAt.getTime() - a.reportadoAt.getTime() || b.id - a.id)
        .slice(0, filtro.limit ?? 500)
        .map(copia);
    },
    async marcarCorregidos(clave, correccion, en) {
      const hechos: NumeroReportado[] = [];
      for (const f of filas) {
        if ((f.clave !== clave && f.referencia !== clave) || f.estado !== 'pendiente') continue;
        Object.assign(f, { estado: 'corregido', corregidoAt: en, correccion: structuredClone(correccion) });
        hechos.push(copia(f));
      }
      return hechos;
    },
  };
}

// ------------------------------------------------------------ reportar

export interface DepsReportar {
  repos: { rutas: RutasRepo; reportados?: ReportadosRepo };
  /** Con puerto, el reporte sale al momento (una vez); si falla, lo reintenta la cola. */
  gsg?: PuertoGsg | null;
  ahora?: () => Date;
  log?: (m: string, d?: Record<string, unknown>) => void;
}

/** Lo que se le manda a GSG (POST a la ruta de reportados). Es el contrato: ver PAYLOADS en src/rutas/gsg.ts. */
export function payloadReportado(r: NumeroReportado): Record<string, unknown> {
  return {
    tipo: 'numero_reportado',
    tracking: r.tracking,
    referencia: r.referencia,
    telefono: r.telefono,
    error: r.error,
    mensaje: r.mensaje,
    detalle: r.detalle,
    reportadoAt: r.reportadoAt.toISOString(),
    dia: r.dia,
    // Estable por reporte: si GSG lo recibe dos veces (un reintento tras un corte), es el mismo.
    idReporte: `gsgchat-reportado-${r.id}-${r.veces}`,
  };
}

/**
 * Reporta un numero malo a GSG: lo guarda en la bandeja y encola UN POST.
 * Si ese tracking ya tiene ese error pendiente, no hace nada (null).
 */
export async function reportarNumero(deps: DepsReportar, n: NuevoReportado): Promise<NumeroReportado | null> {
  const repo = deps.repos.reportados;
  if (!repo) return null;
  const en = (deps.ahora ?? (() => new Date()))();
  const datos = { tracking: textoONulo(n.tracking), telefono: textoONulo(n.telefono) };
  const fila = await repo.reportar({ ...n, clave: claveDe(n), mensaje: TEXTOS_REPORTADOS[n.error].mensaje(datos) }, en);
  if (!fila) return null;
  await deps.repos.rutas.encolarReporte({ solicitudId: null, loteId: null, tipo: 'numero_reportado', payload: payloadReportado(fila) });
  deps.log?.('número reportado a GSG', { error: fila.error, tracking: fila.tracking });
  if (deps.gsg) void despacharReportes({ rutas: deps.repos.rutas }, deps.gsg, 25, ['numero_reportado']).catch(() => undefined);
  return fila;
}

/** Un reportado tal como lo leen GSG (GET /api/v1/reportados) y la pantalla. */
export function reportadoParaApi(r: NumeroReportado): Record<string, unknown> {
  return {
    id: r.id,
    clave: r.clave,
    tracking: r.tracking,
    referencia: r.referencia,
    telefono: r.telefono,
    error: r.error,
    titulo: TEXTOS_REPORTADOS[r.error]?.titulo ?? r.error,
    mensaje: r.mensaje,
    detalle: r.detalle,
    dia: r.dia,
    reportadoAt: r.reportadoAt.toISOString(),
    estado: r.estado,
    corregidoAt: r.corregidoAt ? r.corregidoAt.toISOString() : null,
    correccion: r.correccion ? { telefono: r.correccion.telefono ?? null, tracking: r.correccion.tracking ?? null, por: r.correccion.por ?? null } : null,
    veces: r.veces,
  };
}

// ------------------------------------------------- lo hecho por WhatsApp

/** Codigos estables de lo que ya se hizo con un tracking (el mismo dia). */
export type CodigoAviso = 'ya_contactado' | 'agrupado_con' | 'ubicacion_pedida' | 'ubicacion_registrada' | 'ubicacion_cambiada' | 'confirmado' | 'reportado' | 'corregido';

export interface AvisoWhatsapp {
  codigo: CodigoAviso;
  mensaje: string;
  en: string | null;
  /** agrupado_con: el otro tracking del mismo telefono. */
  con?: string;
  /** ubicacion_pedida: cuantas veces se le pidio. */
  veces?: number;
  /** reportado / corregido: el error. */
  error?: string;
}

export interface FichaTracking {
  tracking: string;
  referencia: string;
  telefono: string;
  nombre: string | null;
  dia: string;
  estado: string;
  mensaje: { estado: string; enviadoEn: string | null };
  contactado: boolean;
  contactadoEn: string | null;
  /** Los otros trackings de hoy con el mismo telefono (un solo mensaje para todos). */
  agrupadoCon: string[];
  ubicacion: {
    estado: 'no_hace_falta' | 'pendiente' | 'registrada' | 'cambiada';
    pedida: boolean;
    pedidaEn: string | null;
    ultimaPeticionEn: string | null;
    veces: number;
    registradaEn: string | null;
    cambiadaEn: string | null;
  };
  confirmacion: { estado: string; en: string | null };
  reportes: Array<{ error: string; mensaje: string; reportadoAt: string; estado: EstadoReportado; corregidoAt: string | null }>;
  avisos: AvisoWhatsapp[];
}

export interface DepsMapa {
  repo: Pick<EntregasRepo, 'listar' | 'eventos'>;
  rutas: Pick<RutasRepo, 'listarSolicitudes'>;
  reportados?: ReportadosRepo;
  timezone: () => string;
}

/** «10/10/2026 a las 09:15» en la hora del negocio. */
export function fechaEnPalabras(d: Date, tz: string): string {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('es-PE', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.day}/${p.month}/${p.year} a las ${p.hour}:${p.minute}`;
  } catch {
    return d.toISOString();
  }
}

const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);
const trackingDe = (e: Pick<Entrega, 'referencia' | 'datosEnvio'>): string => e.datosEnvio?.tracking || e.referencia;
const FINALES = new Set(['cancelada']);

async function solicitudDe(rutas: DepsMapa['rutas'], e: Entrega): Promise<Solicitud | null> {
  if (!e.loteId) return null;
  const lista = await rutas.listarSolicitudes({ loteId: e.loteId, q: e.phone, limit: 5, offset: 0 }).catch(() => [] as Solicitud[]);
  return lista.find((s) => s.phone === e.phone) ?? null;
}

/**
 * La ficha de cada entrega de `dia` (todas, o solo las de `soloIds`): lo que
 * ya se hizo por WhatsApp y sus avisos. `delDia` son TODAS las del dia (para
 * saber quien comparte telefono).
 */
export async function fichasDeTrackings(deps: DepsMapa, delDia: Entrega[], soloIds?: Set<number>): Promise<FichaTracking[]> {
  const tz = deps.timezone();
  const porTelefono = new Map<string, Entrega[]>();
  for (const e of delDia) {
    if (FINALES.has(e.estado)) continue;
    porTelefono.set(e.phone, [...(porTelefono.get(e.phone) ?? []), e]);
  }
  const solicitudes = new Map<number, Solicitud | null>();
  const solicitud = async (e: Entrega) => {
    if (!solicitudes.has(e.id)) solicitudes.set(e.id, await solicitudDe(deps.rutas, e));
    return solicitudes.get(e.id) ?? null;
  };
  const reportes = deps.reportados ? await deps.reportados.listar({ limit: 2000 }).catch(() => []) : [];

  const fichas: FichaTracking[] = [];
  for (const e of delDia) {
    if (soloIds && !soloIds.has(e.id)) continue;
    const tracking = trackingDe(e);
    const hermanas = (porTelefono.get(e.phone) ?? []).filter((x) => x.id !== e.id);
    const propia = await solicitud(e);
    // La peticion de ubicacion que vale para este telefono: la suya, o la del pedido con el que va agrupado.
    let pedidaPor = propia && (propia.ultimoEnvioAt || propia.intentos > 0) ? propia : null;
    if (!pedidaPor) {
      for (const h of hermanas) {
        const s = await solicitud(h);
        if (s && (s.ultimoEnvioAt || s.intentos > 0) && (!pedidaPor || s.intentos > pedidaPor.intentos)) pedidaPor = s;
      }
    }
    const enviadoAt = e.mensajeEnviadoAt ?? (e.mensajeEstado === 'enviado' ? pedidaPor?.ultimoEnvioAt ?? null : null);
    const contactadoAt = enviadoAt ?? e.contactadoAt ?? pedidaPor?.ultimoEnvioAt ?? null;
    const contactado = Boolean(contactadoAt);

    let cambiadaAt: Date | null = null;
    if (e.ubicacionEstado === 'recibida') {
      const eventos = await deps.repo.eventos(e.id, 200).catch(() => []);
      const cambios = eventos.filter((ev) => ev.tipo === 'ubicacion' && /corregida|cambi/i.test(ev.detalle ?? ''));
      const ultimo = cambios.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      cambiadaAt = ultimo ? new Date(ultimo.createdAt) : null;
    }
    const estadoUbicacion: FichaTracking['ubicacion']['estado'] = e.ubicacionEstado === 'recibida' ? (cambiadaAt ? 'cambiada' : 'registrada') : e.ubicacionEstado === 'pendiente' ? 'pendiente' : 'no_hace_falta';
    const pedidaEn = e.mensajeVia === 'ubicacion' && enviadoAt ? enviadoAt : pedidaPor?.ultimoEnvioAt && pedidaPor.intentos <= 1 ? pedidaPor.ultimoEnvioAt : (enviadoAt ?? pedidaPor?.ultimoEnvioAt ?? null);
    const veces = pedidaPor?.intentos ?? (e.mensajeVia === 'ubicacion' && enviadoAt ? 1 : 0);
    const pedida = Boolean(pedidaEn) && e.ubicacionEstado !== 'no_hace_falta';
    const deEste = reportes.filter((r) => r.clave === tracking || r.clave === e.referencia || r.referencia === e.referencia);

    const avisos: AvisoWhatsapp[] = [];
    // Un pedido anterior de hoy con el mismo telefono (dos trackings de dos
    // tiendas): va en el mismo mensaje y, si ese ya tenia su ubicacion, este
    // la toma (la ubicacion vale por dia, regla del dueño del 10/10).
    const agrupadoCon = hermanas.filter((h) => h.id < e.id && !['cancelada'].includes(h.estado));
    if (contactado) {
      avisos.push({ codigo: 'ya_contactado', en: iso(contactadoAt), mensaje: `Este tracking ya se le envió mensaje por WhatsApp el ${fechaEnPalabras(new Date(contactadoAt!), tz)}. No se le manda otro.` });
    }
    if (agrupadoCon.length) {
      const otro = trackingDe(agrupadoCon[0]!);
      const tomoLaDeOtro = agrupadoCon[0]!.ubicacionEstado === 'recibida' && e.ubicacionEstado === 'recibida';
      avisos.push({ codigo: 'agrupado_con', con: otro, en: iso(contactadoAt), mensaje: tomoLaDeOtro ? `Este teléfono ya tiene hoy el tracking «${otro}» con la ubicación registrada: este tracking toma la misma, el cliente no recibe otro mensaje y se reporta la lat/lng a los dos.` : `Este teléfono ya tiene hoy el tracking «${otro}»: va agrupado con ese y el cliente recibe un solo mensaje por los dos.` });
    }
    if (pedida && estadoUbicacion === 'pendiente') {
      avisos.push({ codigo: 'ubicacion_pedida', veces, en: iso(pedidaPor?.ultimoEnvioAt ?? pedidaEn), mensaje: `Ya se pidió la ubicación (${veces === 1 ? '1 vez' : `${veces} veces`}, la última el ${fechaEnPalabras(new Date(pedidaPor?.ultimoEnvioAt ?? pedidaEn!), tz)}).` });
    }
    if (estadoUbicacion === 'registrada' && e.ubicacionAt) {
      avisos.push({ codigo: 'ubicacion_registrada', en: iso(e.ubicacionAt), mensaje: `Ubicación registrada el ${fechaEnPalabras(e.ubicacionAt, tz)}.` });
    }
    if (estadoUbicacion === 'cambiada' && cambiadaAt) {
      avisos.push({ codigo: 'ubicacion_cambiada', en: iso(cambiadaAt), mensaje: `El cliente cambió su ubicación el ${fechaEnPalabras(cambiadaAt, tz)}.` });
    }
    if (e.confirmacionEstado === 'confirmada' && e.confirmacionAt) {
      avisos.push({ codigo: 'confirmado', en: iso(e.confirmacionAt), mensaje: `El cliente confirmó el pedido el ${fechaEnPalabras(e.confirmacionAt, tz)}.` });
    }
    for (const r of deEste) {
      if (r.estado === 'pendiente') avisos.push({ codigo: 'reportado', error: r.error, en: iso(r.reportadoAt), mensaje: `Reportado el ${fechaEnPalabras(r.reportadoAt, tz)}: ${r.mensaje}` });
      else if (r.corregidoAt) avisos.push({ codigo: 'corregido', error: r.error, en: iso(r.corregidoAt), mensaje: `Corregido el ${fechaEnPalabras(r.corregidoAt, tz)} (${TEXTOS_REPORTADOS[r.error]?.titulo ?? r.error}).` });
    }

    fichas.push({
      tracking,
      referencia: e.referencia,
      telefono: e.phone,
      nombre: e.nombre,
      dia: e.dia,
      estado: e.estado,
      mensaje: { estado: e.mensajeEstado ?? 'no_aplica', enviadoEn: iso(enviadoAt) },
      contactado,
      contactadoEn: iso(contactadoAt),
      agrupadoCon: hermanas.map(trackingDe),
      ubicacion: { estado: estadoUbicacion, pedida, pedidaEn: pedida ? iso(pedidaEn) : null, ultimaPeticionEn: pedida ? iso(pedidaPor?.ultimoEnvioAt ?? pedidaEn) : null, veces: pedida ? veces : 0, registradaEn: e.ubicacionEstado === 'recibida' ? iso(e.ubicacionAt) : null, cambiadaEn: iso(cambiadaAt) },
      confirmacion: { estado: e.confirmacionEstado, en: iso(e.confirmacionAt) },
      reportes: deEste.map((r) => ({ error: r.error, mensaje: r.mensaje, reportadoAt: r.reportadoAt.toISOString(), estado: r.estado, corregidoAt: iso(r.corregidoAt) })),
      avisos,
    });
  }
  return fichas;
}

/** Lo que va en cada respuesta a GSG: por pedido, lo que ya se hizo hoy por WhatsApp. */
export function avisosParaApi(f: FichaTracking): Record<string, unknown> {
  return { tracking: f.tracking, referencia: f.referencia, contactado: f.contactado, contactadoEn: f.contactadoEn, avisos: f.avisos };
}
