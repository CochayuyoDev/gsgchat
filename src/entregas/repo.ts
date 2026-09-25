/**
 * Las entregas del dia y los motorizados: las filas y su bitacora.
 *
 * Aqui no hay decisiones, solo consultas. Quien decide que se le manda a
 * quien y cuando es `motor.ts`; quien decide que pasa con cada respuesta
 * (un pin, un "si", un "40 minutos") es `servicio.ts`.
 */

import type { Pool } from '../db/pool.js';

export type EstadoUbicacion = 'no_hace_falta' | 'pendiente' | 'recibida';
export type EstadoConfirmacion = 'no_hace_falta' | 'pendiente' | 'pedida' | 'confirmada' | 'rechazada';
export type EstadoMotorizadoEnEntrega = 'sin_asignar' | 'enviado' | 'respondio' | 'sin_respuesta';
export type ComoConfirmo = 'boton' | 'reglas' | 'ia' | 'persona';
/** Como se supo que se entrego: lo dijo el motorizado (reglas/ia), mando foto, lo marco una persona, o lo dio por hecho el cierre del dia. */
export type ComoEntrego = 'reglas' | 'ia' | 'foto' | 'persona' | 'cierre';
/** Los urgentes salen primero hacia el motorizado y van primero en su ruta. */
export type PrioridadEntrega = 'normal' | 'urgente';

export type EstadoEntrega =
  | 'pendiente'
  | 'esperando_ubicacion'
  | 'esperando_confirmacion'
  | 'lista'
  | 'esperando_motorizado'
  | 'avisada'
  | 'entregada'
  | 'terminada'
  | 'cancelada'
  | 'incidencia';

export const ESTADOS_ENTREGA: EstadoEntrega[] = [
  'pendiente',
  'esperando_ubicacion',
  'esperando_confirmacion',
  'lista',
  'esperando_motorizado',
  'avisada',
  'entregada',
  'terminada',
  'cancelada',
  'incidencia',
];

/** Estados en los que la entrega sigue viva (todavia pasa algo con ella). */
export const ESTADOS_ENTREGA_VIVOS: EstadoEntrega[] = [
  'pendiente',
  'esperando_ubicacion',
  'esperando_confirmacion',
  'lista',
  'esperando_motorizado',
  'avisada',
];

export type EstadoMotorizado = 'activo' | 'descanso' | 'baja';

export interface Motorizado {
  id: number;
  phone: string;
  nombre: string;
  placa: string | null;
  zona: string | null;
  estado: EstadoMotorizado;
  entregasHoy: number;
  entregasHoyDia: string | null;
  ultimoEncargoAt: Date | null;
  /** Donde estuvo por ultima vez (el pin de su ultima entrega): para darle el pedido al mas cercano. */
  ultimaLat: number | null;
  ultimaLng: number | null;
  ultimaPosicionAt: Date | null;
  /** Su pagina sin instalar nada (/m/<token>): el token vigente y hasta cuando vale. */
  enlaceToken: string | null;
  enlaceVenceAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NuevoMotorizado {
  phone: string;
  nombre: string;
  placa?: string | null;
  zona?: string | null;
  estado?: EstadoMotorizado;
}

export interface PatchMotorizado {
  nombre?: string;
  placa?: string | null;
  zona?: string | null;
  estado?: EstadoMotorizado;
  entregasHoy?: number;
  entregasHoyDia?: string | null;
  ultimoEncargoAt?: Date | null;
  ultimaLat?: number | null;
  ultimaLng?: number | null;
  ultimaPosicionAt?: Date | null;
  enlaceToken?: string | null;
  enlaceVenceAt?: Date | null;
}

/**
 * Lo que GSG cuenta del envio para el primer mensaje al cliente
 * (textos.ts → solicitudUbicacion). Todo opcional: lo que falta no sale.
 */
export interface DatosEnvio {
  /** "Zapatillas talla 40". */
  producto?: string | null;
  /** La tienda que vende: codigo ("516") y nombre ("Zapatería Lima"). */
  empresaCodigo?: string | null;
  empresaNombre?: string | null;
  /** El codigo de seguimiento de GSG ("GSG-A-102345"). */
  tracking?: string | null;
  /** El numero de pedido de la tienda ("#1042"). */
  nroPedido?: string | null;
  /** "YAPE", "Efectivo", "Pagado"... */
  metodoPago?: string | null;
  /** Lo que el motorizado cobra, tal como lo manda GSG ("85.00"). */
  monto?: string | null;
  /** Quien firma el mensaje ("Juan Quispe"). */
  remitente?: string | null;
  /**
   * El motorizado que GSG ya asigno a ese pedido (si lo manda por la API):
   * su nombre y su telefono. El telefono es el que se le da al cliente en el
   * cierre y en UBI REGISTRADA si aqui no hay otro motorizado asignado.
   */
  motorizadoNombre?: string | null;
  telefonoMotorizado?: string | null;
}

const CLAVES_DATOS_ENVIO: Array<keyof DatosEnvio> = ['producto', 'empresaCodigo', 'empresaNombre', 'tracking', 'nroPedido', 'metodoPago', 'monto', 'remitente', 'motorizadoNombre', 'telefonoMotorizado'];

/** Solo los campos con texto (recortados a 200); null si no queda ninguno. */
export function datosEnvioLimpios(d: DatosEnvio | null | undefined): DatosEnvio | null {
  if (!d || typeof d !== 'object') return null;
  const limpio: DatosEnvio = {};
  for (const clave of CLAVES_DATOS_ENVIO) {
    const v = (d as Record<string, unknown>)[clave];
    if (v === null || v === undefined) continue;
    const texto = String(v).trim().slice(0, 200);
    if (texto) limpio[clave] = texto;
  }
  return Object.keys(limpio).length ? limpio : null;
}

/** La columna jsonb llega como objeto (pg) o como texto (algunas versiones de PGlite). */
function datosEnvioDeValor(v: unknown): DatosEnvio | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    try {
      return datosEnvioLimpios(JSON.parse(v) as DatosEnvio);
    } catch {
      return null;
    }
  }
  return datosEnvioLimpios(v as DatosEnvio);
}

export interface Entrega {
  id: number;
  /** AAAA-MM-DD del reparto. */
  dia: string;
  referencia: string;
  externoId: string | null;
  phone: string;
  nombre: string | null;
  direccion: string | null;
  distrito: string | null;
  notas: string | null;
  /** Lo que GSG cuenta del envio (producto, empresa, codigo, monto...). Ver DatosEnvio. */
  datosEnvio: DatosEnvio | null;

  ubicacionEstado: EstadoUbicacion;
  /** El lote del reparto que le pide la ubicacion, si hay uno. */
  loteId: string | null;
  lat: number | null;
  lng: number | null;
  mapsUrl: string | null;
  ubicacionFuente: string | null;
  ubicacionAt: Date | null;

  confirmacionEstado: EstadoConfirmacion;
  confirmacionIntentos: number;
  confirmacionPedidaAt: Date | null;
  confirmacionProximoAt: Date | null;
  confirmacionAt: Date | null;
  confirmacionRespuesta: string | null;
  confirmacionComo: ComoConfirmo | null;

  motorizadoId: number | null;
  motorizadoEstado: EstadoMotorizadoEnEntrega;
  motorizadoIntentos: number;
  motorizadoEnviadoAt: Date | null;
  motorizadoProximoAt: Date | null;
  motorizadoRespuesta: string | null;
  motorizadoRespondioAt: Date | null;
  minutosMotorizado: number | null;
  minutosAviso: number | null;
  llegaAproxAt: Date | null;
  avisoEnviadoAt: Date | null;
  motorizadosDescartados: number[];

  /** Cuando se entrego, como se supo y que dijo el motorizado. */
  entregadaAt: Date | null;
  entregadaComo: ComoEntrego | null;
  entregadaRespuesta: string | null;
  /** true = la cerro el cierre del dia (quedo sin terminar ayer). */
  cerradaPorDia: boolean;

  prioridad: PrioridadEntrega;
  /** Veces que el motorizado fue a la puerta sin poder entregar (0 o 1). */
  visitas: number;
  /** true = el cliente dijo que si volvamos hoy: esta en su segunda visita. */
  segundaVisita: boolean;
  /** Cuando se le pregunto al cliente si volvemos hoy, y hasta cuando se espera su respuesta. */
  segundaVisitaPedidaAt: Date | null;
  segundaVisitaVenceAt: Date | null;
  /** Cuando se le aviso al cliente que el motorizado esta cerca (una sola vez por entrega). */
  cercaAvisadoAt: Date | null;
  /** Cliente recurrente: cuando se le propuso su ultima direccion en vez de pedirle el pin, y cual era. */
  ubicacionPropuestaAt: Date | null;
  ubicacionPropuestaLat: number | null;
  ubicacionPropuestaLng: number | null;
  /** Cuando se le repregunto al motorizado un tiempo que no cuadra con la distancia (una sola vez), y lo que dijo. */
  motorizadoTiempoDudosoAt: Date | null;
  motorizadoTiempoDudosoMin: number | null;

  estado: EstadoEntrega;
  incidencia: string | null;
  incidenciaDetalle: string | null;
  requiereHumano: boolean;
  terminadaGsgAt: Date | null;
  /** «Ya contactado» puesto a mano desde Números del día, y quién lo puso. */
  contactadoAt?: Date | null;
  contactadoPor?: string | null;
  /** Mensajes automáticos en pausa (Números del día): no se le pide ubicación ni confirmación. */
  mensajesPausadosAt?: Date | null;
  /**
   * «Por confirmar el envío»: la lista de GSG espera a que una persona pulse
   * «Confirmar y enviar». Mientras tenga fecha no sale NADA hacia ese número
   * (ni ubicación, ni confirmación, ni motorizado). Ver migración 041.
   */
  envioRetenidoAt?: Date | null;
  /** Cuándo se confirmó su envío (null = nunca esperó, o todavía espera). */
  envioLiberadoAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NuevaEntrega {
  dia: string;
  referencia: string;
  externoId?: string | null;
  phone: string;
  nombre?: string | null;
  direccion?: string | null;
  distrito?: string | null;
  notas?: string | null;
  datosEnvio?: DatosEnvio | null;
  ubicacionEstado: EstadoUbicacion;
  lat?: number | null;
  lng?: number | null;
  confirmacionEstado: EstadoConfirmacion;
  estado: EstadoEntrega;
  prioridad?: PrioridadEntrega;
  /** Llega de la lista de GSG y espera a que se confirme su envío. */
  envioRetenidoAt?: Date | null;
}

export type PatchEntrega = Partial<
  Omit<Entrega, 'id' | 'dia' | 'referencia' | 'createdAt' | 'updatedAt'>
>;

export type TipoEventoEntrega =
  | 'sincronizada'
  | 'ubicacion'
  | 'confirmacion_pedida'
  | 'confirmada'
  | 'rechazada'
  | 'motorizado_enviado'
  | 'motorizado_respondio'
  | 'aviso'
  | 'entregada'
  | 'terminada'
  | 'cierre'
  | 'segunda_visita'
  | 'cerca'
  | 'incidencia'
  | 'nota'
  | 'ia'
  | 'reporte';

export interface EventoEntrega {
  id: number;
  entregaId: number;
  tipo: TipoEventoEntrega;
  detalle: string | null;
  payload: Record<string, unknown> | null;
  createdAt: Date;
}

export interface EntregasRepo {
  // --- motorizados
  crearMotorizado(input: NuevoMotorizado): Promise<{ motorizado: Motorizado; nuevo: boolean }>;
  motorizado(id: number): Promise<Motorizado | null>;
  motorizadoPorTelefono(phone: string): Promise<Motorizado | null>;
  /** El motorizado dueño de ese token de enlace (vigente o no: el servicio mira la fecha). */
  motorizadoPorEnlace(token: string): Promise<Motorizado | null>;
  listarMotorizados(): Promise<Motorizado[]>;
  actualizarMotorizado(id: number, patch: PatchMotorizado): Promise<Motorizado | null>;
  quitarMotorizado(id: number): Promise<Motorizado | null>;

  // --- entregas
  /** Crea la entrega del dia; si (dia, referencia) ya existe, la devuelve tal cual. */
  crearEntrega(input: NuevaEntrega): Promise<{ entrega: Entrega; nueva: boolean }>;
  entrega(id: number): Promise<Entrega | null>;
  porDiaYReferencia(dia: string, referencia: string): Promise<Entrega | null>;
  /** La entrega viva mas reciente de ese cliente. */
  vivaPorTelefono(phone: string): Promise<Entrega | null>;
  /** TODAS las vivas de un telefono (un cliente puede tener dos pedidos el mismo dia), de la mas antigua a la mas nueva. */
  vivasPorTelefono(phone: string): Promise<Entrega[]>;
  /**
   * La puntualidad real de cada motorizado desde `desde`: sobre las entregadas
   * con hora avisada, cuantas fueron y el desvio medio en minutos entre la hora
   * que se le dijo al cliente y la hora real (positivo = llego tarde).
   */
  puntualidadDeMotorizados(desde: Date): Promise<Array<{ motorizadoId: number; entregas: number; desvioMedioMin: number }>>;
  /** Las entregas del dia (o todas las vivas de cualquier dia si no se pasa dia). */
  listar(filtro: { dia?: string; estado?: EstadoEntrega; estados?: EstadoEntrega[]; q?: string; limit?: number }): Promise<Entrega[]>;
  actualizar(id: number, patch: PatchEntrega): Promise<Entrega | null>;
  quitar(id: number): Promise<Entrega | null>;
  cifras(dia: string): Promise<Record<string, number>>;
  /** Las que toca pedir confirmacion ahora. */
  tocaPedirConfirmacion(ahora: Date, limite: number): Promise<Entrega[]>;
  /** Las que estan listas para un motorizado, esperando uno que no contesta, o con el aviso de llegada por reintentar. */
  tocaMotorizado(ahora: Date, limite: number): Promise<Entrega[]>;
  /** Los clientes recurrentes a los que toca proponerles su ultima direccion (aun no se les pregunto y no estan en el reparto). */
  tocaProponerUbicacion(ahora: Date, limite: number): Promise<Entrega[]>;
  /** Las que se les propuso la direccion hace mas de `antesDe` y siguen sin pin ni reparto: toca pedirsela como siempre. */
  propuestasSinRespuesta(antesDe: Date, limite: number): Promise<Entrega[]>;
  /** Las que un motorizado tiene entre manos (enviadas y sin respuesta), la ultima primero. */
  enManosDeMotorizado(motorizadoId: number): Promise<Entrega[]>;
  /** Las que un motorizado ya tiene con hora avisada y aun no entregadas, la ultima primero. */
  avisadasDeMotorizado(motorizadoId: number): Promise<Entrega[]>;
  /** Todo lo que un motorizado lleva ahora mismo (esperando su tiempo o con hora avisada), en el orden en que se le dio. */
  vivasDeMotorizado(motorizadoId: number): Promise<Entrega[]>;
  /** Las vivas de dias anteriores a `diaHoy` (AAAA-MM-DD): lo que el cierre del dia tiene que resolver. */
  vivasDeDiasAnteriores(diaHoy: string, limite: number): Promise<Entrega[]>;
  /** Si ese telefono tiene alguna entrega viva con los mensajes automaticos en pausa (Numeros del dia): el reparto no le escribe. */
  pausadoPorTelefono(phone: string): Promise<boolean>;

  registrarEvento(entregaId: number, tipo: TipoEventoEntrega, detalle?: string | null, payload?: Record<string, unknown> | null, at?: Date): Promise<void>;
  eventos(entregaId: number, limite?: number): Promise<EventoEntrega[]>;
  eventosRecientes(limite: number): Promise<Array<EventoEntrega & { referencia: string; phone: string; nombre: string | null }>>;
}

// ------------------------------------------------------------- filas

interface MotorizadoRow {
  id: number | string;
  phone: string;
  nombre: string;
  placa: string | null;
  zona: string | null;
  estado: EstadoMotorizado;
  entregas_hoy: number | string;
  entregas_hoy_dia: string | Date | null;
  ultimo_encargo_at: Date | null;
  ultima_lat: number | string | null;
  ultima_lng: number | string | null;
  ultima_posicion_at: Date | null;
  enlace_token?: string | null;
  enlace_vence_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface EntregaRow {
  id: number | string;
  dia: string | Date;
  referencia: string;
  externo_id: string | null;
  phone: string;
  nombre: string | null;
  direccion: string | null;
  distrito: string | null;
  notas: string | null;
  datos_envio?: unknown;
  ubicacion_estado: EstadoUbicacion;
  lote_id: string | null;
  lat: number | string | null;
  lng: number | string | null;
  maps_url: string | null;
  ubicacion_fuente: string | null;
  ubicacion_at: Date | null;
  confirmacion_estado: EstadoConfirmacion;
  confirmacion_intentos: number | string;
  confirmacion_pedida_at: Date | null;
  confirmacion_proximo_at: Date | null;
  confirmacion_at: Date | null;
  confirmacion_respuesta: string | null;
  confirmacion_como: ComoConfirmo | null;
  motorizado_id: number | string | null;
  motorizado_estado: EstadoMotorizadoEnEntrega;
  motorizado_intentos: number | string;
  motorizado_enviado_at: Date | null;
  motorizado_proximo_at: Date | null;
  motorizado_respuesta: string | null;
  motorizado_respondio_at: Date | null;
  minutos_motorizado: number | string | null;
  minutos_aviso: number | string | null;
  llega_aprox_at: Date | null;
  aviso_enviado_at: Date | null;
  motorizados_descartados: unknown;
  entregada_at: Date | null;
  entregada_como: ComoEntrego | null;
  entregada_respuesta: string | null;
  cerrada_por_dia: boolean;
  prioridad: PrioridadEntrega | null;
  visitas: number | string | null;
  segunda_visita: boolean | null;
  segunda_visita_pedida_at: Date | null;
  segunda_visita_vence_at: Date | null;
  cerca_avisado_at: Date | null;
  ubicacion_propuesta_at: Date | null;
  ubicacion_propuesta_lat: number | string | null;
  ubicacion_propuesta_lng: number | string | null;
  motorizado_tiempo_dudoso_at: Date | null;
  motorizado_tiempo_dudoso_min: number | string | null;
  estado: EstadoEntrega;
  incidencia: string | null;
  incidencia_detalle: string | null;
  requiere_humano: boolean;
  terminada_gsg_at: Date | null;
  contactado_at?: Date | null;
  contactado_por?: string | null;
  mensajes_pausados_at?: Date | null;
  envio_retenido_at?: Date | null;
  envio_liberado_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface EventoRow {
  id: number | string;
  entrega_id: number | string;
  tipo: TipoEventoEntrega;
  detalle: string | null;
  payload: unknown;
  created_at: Date;
  referencia?: string;
  phone?: string;
  nombre?: string | null;
}

/** Un `date` de Postgres llega como Date (pg) o como string (PGlite): siempre AAAA-MM-DD. */
export function diaTexto(v: string | Date | null): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

const numOpc = (v: number | string | null): number | null => (v === null || v === undefined ? null : Number(v));

const motorizadoDeFila = (r: MotorizadoRow): Motorizado => ({
  id: Number(r.id),
  phone: r.phone,
  nombre: r.nombre,
  placa: r.placa,
  zona: r.zona,
  estado: r.estado,
  entregasHoy: Number(r.entregas_hoy),
  entregasHoyDia: diaTexto(r.entregas_hoy_dia),
  ultimoEncargoAt: r.ultimo_encargo_at,
  ultimaLat: numOpc(r.ultima_lat ?? null),
  ultimaLng: numOpc(r.ultima_lng ?? null),
  ultimaPosicionAt: r.ultima_posicion_at ?? null,
  enlaceToken: r.enlace_token ?? null,
  enlaceVenceAt: r.enlace_vence_at ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const entregaDeFila = (r: EntregaRow): Entrega => ({
  id: Number(r.id),
  dia: diaTexto(r.dia)!,
  referencia: r.referencia,
  externoId: r.externo_id,
  phone: r.phone,
  nombre: r.nombre,
  direccion: r.direccion,
  distrito: r.distrito,
  notas: r.notas,
  datosEnvio: datosEnvioDeValor(r.datos_envio),
  ubicacionEstado: r.ubicacion_estado,
  loteId: r.lote_id,
  lat: numOpc(r.lat),
  lng: numOpc(r.lng),
  mapsUrl: r.maps_url,
  ubicacionFuente: r.ubicacion_fuente,
  ubicacionAt: r.ubicacion_at,
  confirmacionEstado: r.confirmacion_estado,
  confirmacionIntentos: Number(r.confirmacion_intentos),
  confirmacionPedidaAt: r.confirmacion_pedida_at,
  confirmacionProximoAt: r.confirmacion_proximo_at,
  confirmacionAt: r.confirmacion_at,
  confirmacionRespuesta: r.confirmacion_respuesta,
  confirmacionComo: r.confirmacion_como,
  motorizadoId: numOpc(r.motorizado_id),
  motorizadoEstado: r.motorizado_estado,
  motorizadoIntentos: Number(r.motorizado_intentos),
  motorizadoEnviadoAt: r.motorizado_enviado_at,
  motorizadoProximoAt: r.motorizado_proximo_at,
  motorizadoRespuesta: r.motorizado_respuesta,
  motorizadoRespondioAt: r.motorizado_respondio_at,
  minutosMotorizado: numOpc(r.minutos_motorizado),
  minutosAviso: numOpc(r.minutos_aviso),
  llegaAproxAt: r.llega_aprox_at,
  avisoEnviadoAt: r.aviso_enviado_at,
  motorizadosDescartados: Array.isArray(r.motorizados_descartados) ? (r.motorizados_descartados as unknown[]).map(Number) : [],
  entregadaAt: r.entregada_at ?? null,
  entregadaComo: r.entregada_como ?? null,
  entregadaRespuesta: r.entregada_respuesta ?? null,
  cerradaPorDia: Boolean(r.cerrada_por_dia),
  prioridad: r.prioridad === 'urgente' ? 'urgente' : 'normal',
  visitas: Number(r.visitas ?? 0),
  segundaVisita: Boolean(r.segunda_visita),
  segundaVisitaPedidaAt: r.segunda_visita_pedida_at ?? null,
  segundaVisitaVenceAt: r.segunda_visita_vence_at ?? null,
  cercaAvisadoAt: r.cerca_avisado_at ?? null,
  ubicacionPropuestaAt: r.ubicacion_propuesta_at ?? null,
  ubicacionPropuestaLat: r.ubicacion_propuesta_lat == null ? null : Number(r.ubicacion_propuesta_lat),
  ubicacionPropuestaLng: r.ubicacion_propuesta_lng == null ? null : Number(r.ubicacion_propuesta_lng),
  motorizadoTiempoDudosoAt: r.motorizado_tiempo_dudoso_at ?? null,
  motorizadoTiempoDudosoMin: r.motorizado_tiempo_dudoso_min == null ? null : Number(r.motorizado_tiempo_dudoso_min),
  estado: r.estado,
  incidencia: r.incidencia,
  incidenciaDetalle: r.incidencia_detalle,
  requiereHumano: Boolean(r.requiere_humano),
  terminadaGsgAt: r.terminada_gsg_at,
  contactadoAt: r.contactado_at ?? null,
  contactadoPor: r.contactado_por ?? null,
  mensajesPausadosAt: r.mensajes_pausados_at ?? null,
  envioRetenidoAt: r.envio_retenido_at ?? null,
  envioLiberadoAt: r.envio_liberado_at ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const eventoDeFila = (r: EventoRow): EventoEntrega => ({
  id: Number(r.id),
  entregaId: Number(r.entrega_id),
  tipo: r.tipo,
  detalle: r.detalle,
  payload: r.payload && typeof r.payload === 'object' ? (r.payload as Record<string, unknown>) : typeof r.payload === 'string' ? (JSON.parse(r.payload) as Record<string, unknown>) : null,
  createdAt: r.created_at,
});

/** Las columnas de un patch de entrega, en el orden en que se escriben. */
const COLUMNAS_ENTREGA: Array<[keyof PatchEntrega, string]> = [
  ['externoId', 'externo_id'],
  ['phone', 'phone'],
  ['nombre', 'nombre'],
  ['direccion', 'direccion'],
  ['distrito', 'distrito'],
  ['notas', 'notas'],
  ['datosEnvio', 'datos_envio'],
  ['ubicacionEstado', 'ubicacion_estado'],
  ['loteId', 'lote_id'],
  ['lat', 'lat'],
  ['lng', 'lng'],
  ['mapsUrl', 'maps_url'],
  ['ubicacionFuente', 'ubicacion_fuente'],
  ['ubicacionAt', 'ubicacion_at'],
  ['confirmacionEstado', 'confirmacion_estado'],
  ['confirmacionIntentos', 'confirmacion_intentos'],
  ['confirmacionPedidaAt', 'confirmacion_pedida_at'],
  ['confirmacionProximoAt', 'confirmacion_proximo_at'],
  ['confirmacionAt', 'confirmacion_at'],
  ['confirmacionRespuesta', 'confirmacion_respuesta'],
  ['confirmacionComo', 'confirmacion_como'],
  ['motorizadoId', 'motorizado_id'],
  ['motorizadoEstado', 'motorizado_estado'],
  ['motorizadoIntentos', 'motorizado_intentos'],
  ['motorizadoEnviadoAt', 'motorizado_enviado_at'],
  ['motorizadoProximoAt', 'motorizado_proximo_at'],
  ['motorizadoRespuesta', 'motorizado_respuesta'],
  ['motorizadoRespondioAt', 'motorizado_respondio_at'],
  ['minutosMotorizado', 'minutos_motorizado'],
  ['minutosAviso', 'minutos_aviso'],
  ['llegaAproxAt', 'llega_aprox_at'],
  ['avisoEnviadoAt', 'aviso_enviado_at'],
  ['motorizadosDescartados', 'motorizados_descartados'],
  ['entregadaAt', 'entregada_at'],
  ['entregadaComo', 'entregada_como'],
  ['entregadaRespuesta', 'entregada_respuesta'],
  ['cerradaPorDia', 'cerrada_por_dia'],
  ['prioridad', 'prioridad'],
  ['visitas', 'visitas'],
  ['segundaVisita', 'segunda_visita'],
  ['segundaVisitaPedidaAt', 'segunda_visita_pedida_at'],
  ['segundaVisitaVenceAt', 'segunda_visita_vence_at'],
  ['cercaAvisadoAt', 'cerca_avisado_at'],
  ['ubicacionPropuestaAt', 'ubicacion_propuesta_at'],
  ['ubicacionPropuestaLat', 'ubicacion_propuesta_lat'],
  ['ubicacionPropuestaLng', 'ubicacion_propuesta_lng'],
  ['motorizadoTiempoDudosoAt', 'motorizado_tiempo_dudoso_at'],
  ['motorizadoTiempoDudosoMin', 'motorizado_tiempo_dudoso_min'],
  ['estado', 'estado'],
  ['incidencia', 'incidencia'],
  ['incidenciaDetalle', 'incidencia_detalle'],
  ['requiereHumano', 'requiere_humano'],
  ['terminadaGsgAt', 'terminada_gsg_at'],
  ['contactadoAt', 'contactado_at'],
  ['contactadoPor', 'contactado_por'],
  ['mensajesPausadosAt', 'mensajes_pausados_at'],
  ['envioRetenidoAt', 'envio_retenido_at'],
  ['envioLiberadoAt', 'envio_liberado_at'],
];

const COLUMNAS_MOTORIZADO: Array<[keyof PatchMotorizado, string]> = [
  ['nombre', 'nombre'],
  ['placa', 'placa'],
  ['zona', 'zona'],
  ['estado', 'estado'],
  ['entregasHoy', 'entregas_hoy'],
  ['entregasHoyDia', 'entregas_hoy_dia'],
  ['ultimoEncargoAt', 'ultimo_encargo_at'],
  ['ultimaLat', 'ultima_lat'],
  ['ultimaLng', 'ultima_lng'],
  ['ultimaPosicionAt', 'ultima_posicion_at'],
  ['enlaceToken', 'enlace_token'],
  ['enlaceVenceAt', 'enlace_vence_at'],
];

export function createEntregasRepo(pool: Pool): EntregasRepo {
  const repo: EntregasRepo = {
    // ------------------------------------------------------ motorizados
    async crearMotorizado(input) {
      const { rows } = await pool.query<MotorizadoRow>(
        `insert into motorizados (phone, nombre, placa, zona, estado)
         values ($1,$2,$3,$4,$5)
         on conflict (phone) do nothing
         returning *`,
        [input.phone, input.nombre, input.placa ?? null, input.zona ?? null, input.estado ?? 'activo'],
      );
      if (rows[0]) return { motorizado: motorizadoDeFila(rows[0]), nuevo: true };
      const existente = await repo.motorizadoPorTelefono(input.phone);
      if (!existente) return repo.crearMotorizado(input);
      return { motorizado: existente, nuevo: false };
    },
    async motorizado(id) {
      const { rows } = await pool.query<MotorizadoRow>('select * from motorizados where id = $1', [id]);
      return rows[0] ? motorizadoDeFila(rows[0]) : null;
    },
    async motorizadoPorTelefono(phone) {
      const { rows } = await pool.query<MotorizadoRow>('select * from motorizados where phone = $1', [phone]);
      return rows[0] ? motorizadoDeFila(rows[0]) : null;
    },
    async motorizadoPorEnlace(token) {
      if (!token) return null;
      const { rows } = await pool.query<MotorizadoRow>('select * from motorizados where enlace_token = $1', [token]);
      return rows[0] ? motorizadoDeFila(rows[0]) : null;
    },
    async listarMotorizados() {
      const { rows } = await pool.query<MotorizadoRow>(
        `select * from motorizados order by (estado = 'baja') asc, (estado = 'descanso') asc, nombre asc, id asc`,
      );
      return rows.map(motorizadoDeFila);
    },
    async actualizarMotorizado(id, patch) {
      const sets: string[] = [];
      const valores: unknown[] = [];
      for (const [clave, columna] of COLUMNAS_MOTORIZADO) {
        if (patch[clave] === undefined) continue;
        valores.push(patch[clave]);
        sets.push(`${columna} = $${valores.length}`);
      }
      if (!sets.length) return repo.motorizado(id);
      valores.push(id);
      const { rows } = await pool.query<MotorizadoRow>(
        `update motorizados set ${sets.join(', ')}, updated_at = now() where id = $${valores.length} returning *`,
        valores,
      );
      return rows[0] ? motorizadoDeFila(rows[0]) : null;
    },
    async quitarMotorizado(id) {
      const { rows } = await pool.query<MotorizadoRow>('delete from motorizados where id = $1 returning *', [id]);
      return rows[0] ? motorizadoDeFila(rows[0]) : null;
    },

    // --------------------------------------------------------- entregas
    async crearEntrega(input) {
      const { rows } = await pool.query<EntregaRow>(
        `insert into entregas
           (dia, referencia, externo_id, phone, nombre, direccion, distrito, notas, ubicacion_estado, lat, lng, confirmacion_estado, estado, prioridad, datos_envio, envio_retenido_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16)
         on conflict (dia, referencia) do nothing
         returning *`,
        [
          input.dia,
          input.referencia,
          input.externoId ?? null,
          input.phone,
          input.nombre ?? null,
          input.direccion ?? null,
          input.distrito ?? null,
          input.notas ?? null,
          input.ubicacionEstado,
          input.lat ?? null,
          input.lng ?? null,
          input.confirmacionEstado,
          input.estado,
          input.prioridad ?? 'normal',
          datosEnvioLimpios(input.datosEnvio) ? JSON.stringify(datosEnvioLimpios(input.datosEnvio)) : null,
          input.envioRetenidoAt ?? null,
        ],
      );
      if (rows[0]) return { entrega: entregaDeFila(rows[0]), nueva: true };
      const existente = await repo.porDiaYReferencia(input.dia, input.referencia);
      if (!existente) return repo.crearEntrega(input);
      return { entrega: existente, nueva: false };
    },
    async entrega(id) {
      const { rows } = await pool.query<EntregaRow>('select * from entregas where id = $1', [id]);
      return rows[0] ? entregaDeFila(rows[0]) : null;
    },
    async porDiaYReferencia(dia, referencia) {
      const { rows } = await pool.query<EntregaRow>('select * from entregas where dia = $1 and referencia = $2', [dia, referencia]);
      return rows[0] ? entregaDeFila(rows[0]) : null;
    },
    async vivaPorTelefono(phone) {
      const { rows } = await pool.query<EntregaRow>(
        `select * from entregas
          where phone = $1 and estado = any($2::text[])
          order by dia desc, id desc limit 1`,
        [phone, ESTADOS_ENTREGA_VIVOS],
      );
      return rows[0] ? entregaDeFila(rows[0]) : null;
    },
    async vivasPorTelefono(phone) {
      const { rows } = await pool.query<EntregaRow>(
        `select * from entregas
          where phone = $1 and estado = any($2::text[])
          order by dia asc, id asc`,
        [phone, ESTADOS_ENTREGA_VIVOS],
      );
      return rows.map(entregaDeFila);
    },
    async puntualidadDeMotorizados(desde) {
      const { rows } = await pool.query<{ motorizado_id: number; entregas: string | number; desvio: string | number | null }>(
        `select motorizado_id, count(*) as entregas,
                avg(extract(epoch from (entregada_at - llega_aprox_at)) / 60) as desvio
           from entregas
          where estado = 'entregada' and motorizado_id is not null and llega_aprox_at is not null and entregada_at is not null
            and entregada_como <> 'cierre' and entregada_at >= $1
          group by motorizado_id`,
        [desde],
      );
      return rows.map((r) => ({ motorizadoId: Number(r.motorizado_id), entregas: Number(r.entregas), desvioMedioMin: Math.round(Number(r.desvio ?? 0)) }));
    },
    async listar(filtro) {
      const condiciones: string[] = [];
      const valores: unknown[] = [];
      if (filtro.dia) {
        valores.push(filtro.dia);
        condiciones.push(`dia = $${valores.length}`);
      } else {
        valores.push(ESTADOS_ENTREGA_VIVOS);
        condiciones.push(`estado = any($${valores.length}::text[])`);
      }
      if (filtro.estado) {
        valores.push(filtro.estado);
        condiciones.push(`estado = $${valores.length}`);
      }
      if (filtro.estados?.length) {
        valores.push(filtro.estados);
        condiciones.push(`estado = any($${valores.length}::text[])`);
      }
      if (filtro.q?.trim()) {
        valores.push(`%${filtro.q.trim().toLowerCase()}%`);
        condiciones.push(`(lower(coalesce(nombre,'')) like $${valores.length} or phone like $${valores.length} or lower(referencia) like $${valores.length})`);
      }
      valores.push(filtro.limit ?? 500);
      const { rows } = await pool.query<EntregaRow>(
        `select * from entregas where ${condiciones.join(' and ')} order by id asc limit $${valores.length}`,
        valores,
      );
      return rows.map(entregaDeFila);
    },
    async actualizar(id, patch) {
      const sets: string[] = [];
      const valores: unknown[] = [];
      for (const [clave, columna] of COLUMNAS_ENTREGA) {
        if (patch[clave] === undefined) continue;
        const v = patch[clave];
        const esJson = clave === 'motorizadosDescartados' || clave === 'datosEnvio';
        valores.push(clave === 'motorizadosDescartados' ? JSON.stringify(v ?? []) : clave === 'datosEnvio' ? (v ? JSON.stringify(v) : null) : v);
        sets.push(`${columna} = $${valores.length}${esJson ? '::jsonb' : ''}`);
      }
      if (!sets.length) return repo.entrega(id);
      valores.push(id);
      const { rows } = await pool.query<EntregaRow>(
        `update entregas set ${sets.join(', ')}, updated_at = now() where id = $${valores.length} returning *`,
        valores,
      );
      return rows[0] ? entregaDeFila(rows[0]) : null;
    },
    async quitar(id) {
      const { rows } = await pool.query<EntregaRow>('delete from entregas where id = $1 returning *', [id]);
      return rows[0] ? entregaDeFila(rows[0]) : null;
    },
    async cifras(dia) {
      const { rows } = await pool.query<{ estado: string; n: number | string }>(
        'select estado, count(*)::int as n from entregas where dia = $1 group by estado',
        [dia],
      );
      const cifras: Record<string, number> = {};
      for (const r of rows) cifras[r.estado] = Number(r.n);
      return cifras;
    },
    async tocaPedirConfirmacion(ahora, limite) {
      const { rows } = await pool.query<EntregaRow>(
        `select * from entregas
          where estado in ('pendiente', 'esperando_confirmacion')
            and confirmacion_estado in ('pendiente', 'pedida')
            and ubicacion_estado <> 'pendiente'
            and mensajes_pausados_at is null
            and envio_retenido_at is null
            and (confirmacion_proximo_at is null or confirmacion_proximo_at <= $1)
          order by coalesce(confirmacion_proximo_at, created_at) asc, id asc
          limit $2`,
        [ahora, limite],
      );
      return rows.map(entregaDeFila);
    },
    async tocaProponerUbicacion(ahora, limite) {
      const { rows } = await pool.query<EntregaRow>(
        `select * from entregas
          where estado in ('pendiente', 'esperando_ubicacion')
            and ubicacion_estado = 'pendiente' and ubicacion_propuesta_lat is not null and ubicacion_propuesta_at is null and lote_id is null
            and mensajes_pausados_at is null
            and envio_retenido_at is null
            and (confirmacion_proximo_at is null or confirmacion_proximo_at <= $1)
          order by prioridad desc, id asc
          limit $2`,
        [ahora, limite],
      );
      return rows.map(entregaDeFila);
    },
    async propuestasSinRespuesta(antesDe, limite) {
      const { rows } = await pool.query<EntregaRow>(
        `select * from entregas
          where estado in ('pendiente', 'esperando_ubicacion')
            and ubicacion_estado = 'pendiente' and ubicacion_propuesta_at is not null and ubicacion_propuesta_at <= $1 and lote_id is null
          order by id asc
          limit $2`,
        [antesDe, limite],
      );
      return rows.map(entregaDeFila);
    },
    async tocaMotorizado(ahora, limite) {
      const { rows } = await pool.query<EntregaRow>(
        `select * from entregas
          where envio_retenido_at is null and ((estado = 'lista')
             or (estado = 'incidencia' and incidencia = 'sin_motorizado' and lat is not null and updated_at <= $1::timestamptz - interval '2 minutes')
             or (estado = 'esperando_motorizado' and motorizado_estado = 'enviado' and motorizado_proximo_at is not null and motorizado_proximo_at <= $1)
             or (estado = 'esperando_motorizado' and motorizado_estado = 'respondio' and aviso_enviado_at is null and motorizado_proximo_at is not null and motorizado_proximo_at <= $1))
          order by (prioridad = 'urgente') desc, coalesce(motorizado_proximo_at, updated_at) asc, id asc
          limit $2`,
        [ahora, limite],
      );
      return rows.map(entregaDeFila);
    },
    async enManosDeMotorizado(motorizadoId) {
      const { rows } = await pool.query<EntregaRow>(
        `select * from entregas
          where motorizado_id = $1 and estado = 'esperando_motorizado' and motorizado_estado = 'enviado'
          order by motorizado_enviado_at desc nulls last, id desc`,
        [motorizadoId],
      );
      return rows.map(entregaDeFila);
    },
    async avisadasDeMotorizado(motorizadoId) {
      const { rows } = await pool.query<EntregaRow>(
        `select * from entregas
          where motorizado_id = $1 and estado = 'avisada'
          order by aviso_enviado_at desc nulls last, id desc`,
        [motorizadoId],
      );
      return rows.map(entregaDeFila);
    },
    async vivasDeMotorizado(motorizadoId) {
      const { rows } = await pool.query<EntregaRow>(
        `select * from entregas
          where motorizado_id = $1 and estado in ('esperando_motorizado', 'avisada')
          order by (prioridad = 'urgente') desc, motorizado_enviado_at asc nulls last, id asc`,
        [motorizadoId],
      );
      return rows.map(entregaDeFila);
    },
    async vivasDeDiasAnteriores(diaHoy, limite) {
      const { rows } = await pool.query<EntregaRow>(
        `select * from entregas
          where dia < $1 and estado = any($2::text[])
          order by dia asc, id asc limit $3`,
        [diaHoy, ESTADOS_ENTREGA_VIVOS, limite],
      );
      return rows.map(entregaDeFila);
    },
    async pausadoPorTelefono(phone) {
      const { rows } = await pool.query<{ n: number | string }>(
        `select count(*)::int as n from entregas
          where phone = $1 and mensajes_pausados_at is not null and estado = any($2::text[])`,
        [phone, ESTADOS_ENTREGA_VIVOS],
      );
      return Number(rows[0]?.n ?? 0) > 0;
    },

    async registrarEvento(entregaId, tipo, detalle, payload, at) {
      await pool.query(
        `insert into entregas_eventos (entrega_id, tipo, detalle, payload, created_at) values ($1,$2,$3,$4,$5)`,
        [entregaId, tipo, detalle ?? null, payload ? JSON.stringify(payload) : null, at ?? new Date()],
      );
    },
    async eventos(entregaId, limite = 100) {
      const { rows } = await pool.query<EventoRow>(
        'select * from entregas_eventos where entrega_id = $1 order by id asc limit $2',
        [entregaId, limite],
      );
      return rows.map(eventoDeFila);
    },
    async eventosRecientes(limite) {
      const { rows } = await pool.query<EventoRow>(
        `select ev.*, e.referencia, e.phone, e.nombre
           from entregas_eventos ev join entregas e on e.id = ev.entrega_id
          order by ev.id desc limit $1`,
        [limite],
      );
      return rows.map((r) => ({ ...eventoDeFila(r), referencia: r.referencia!, phone: r.phone!, nombre: r.nombre ?? null }));
    },
  };
  return repo;
}
