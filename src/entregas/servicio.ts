/**
 * Las entregas del dia: que pasa con cada pedido desde que GSG lo manda
 * hasta que el cliente sabe a que hora le llega.
 *
 * El flujo, en el orden en que pasa:
 *
 *  1. **GSG manda los pedidos.** GSGchat nunca le pide nada a GSG: los
 *     pedidos llegan cuando GSG los empuja (POST /api/v1/entregas, ver
 *     src/api/v1/entregas-gsg.ts) o, en pruebas, cuando se cargan en el
 *     simulador de GSG (`recibirListaGsg`). Cada uno dice si falta pedirle
 *     la UBICACION, si falta que CONFIRME, o las dos cosas. Los de ubicacion
 *     entran en un lote del reparto (que ya sabe pedirla con ritmo, insistir
 *     y reportar); los de confirmacion los atiende este modulo.
 *  2. **La ubicacion llega** (el reparto la resuelve y avisa aqui). Si
 *     ademas falta confirmar, el "gracias" lleva la pregunta pegada.
 *  3. **La confirmacion**: se lee lo que contesta (reglas, y la IA si no
 *     esta claro). Un "si" la confirma; un "no" la cancela; "manana" o
 *     "a otra direccion" la pasa a una persona. Todo se le cuenta a GSG.
 *  4. **Con las dos cosas** (ubicacion + confirmacion) la entrega esta
 *     LISTA: se elige un motorizado (el menos cargado, y de la zona si se
 *     puede), se le manda el pin y se le pregunta en cuantos minutos
 *     entrega. Si no contesta, se insiste; si sigue sin contestar o dice que
 *     no puede, el pedido pasa a otro.
 *  5. **El motorizado contesta** ("40", "media hora"): a esos minutos se les
 *     suma el margen (una hora, editable) y al cliente se le avisa a que
 *     hora le llega aproximadamente. GSG recibe la entrega con todo (quien
 *     la lleva, cuanto dijo, cuanto se le dijo al cliente) y, como ya tiene
 *     ubicacion y confirmacion, la pasa a "terminados".
 *  6. **El motorizado dice "entregado"** (o manda la foto): la entrega queda
 *     ENTREGADA, GSG recibe la hora y al cliente se le da las gracias. Si
 *     dice que no pudo ("no estaba nadie"), pasa a una persona.
 *  7. **El cierre del dia** (a la hora del ajuste): lo que quedo vivo de
 *     ayer se aparta con una incidencia y lo avisado sin "entregado" se da
 *     por entregado, para que la pantalla de hoy arranque limpia.
 *
 * Y alrededor de eso, lo que pasa en la calle de verdad:
 *
 *  - **La segunda visita.** Si el motorizado dice "no habia nadie", al
 *    cliente se le pregunta si volvemos hoy (con botones si se puede). Un si
 *    manda otra vez al mismo motorizado; un no (u otro dia) pasa a una
 *    persona; sin respuesta en media hora, tambien. Solo una por pedido.
 *  - **"Cerca".** El motorizado escribe "cerca" o "llegando" y al cliente le
 *    llega el aviso para que este atento. Una vez por entrega.
 *  - **"Me quedo sin moto".** Todos sus pedidos pasan a otros, el queda en
 *    descanso y el supervisor se entera con un solo mensaje.
 *  - **Urgentes.** GSG (o una persona) marca un pedido urgente: sale primero
 *    hacia el motorizado y va primero en su ruta.
 *  - **La ruta del dia.** Sus pedidos en orden de cercania, en un mensaje;
 *    el mismo motorizado la pide escribiendo "ruta".
 *
 * Ademas, un cliente que pregunta "¿donde esta mi pedido?" recibe la
 * respuesta segun el estado, sin gastar un turno de la IA.
 *
 * Lo que este fichero NO hace es esperar ni pausar: eso es de `motor.ts`.
 * Aqui estan las decisiones; el motor decide cuando toca cada una.
 */

import type { Contact, Repos } from '../db/repos.js';
import { esNumeroDePrueba } from '../desarrollador/numeros.js';

/** Los dos son de prueba o los dos son de verdad. Ver elegirMotorizado. */
const mismoMundo = (a: string, b: string): boolean => esNumeroDePrueba(a) === esNumeroDePrueba(b);
const MEZCLA_PRUEBA = 'No se mezcla lo de prueba con lo real: los pedidos de prueba van solo a motorizados de prueba (51 000 1…) y los de verdad solo a motorizados de verdad.';
import type { Sender } from '../outbound/sender.js';
import type { SettingsRepo } from '../settings/service.js';
import { despacharReportes, payloadConfirmacion, payloadEntrega, payloadIncidencia, payloadUbicacion, type PuertoGsg } from '../rutas/gsg.js';
import type { ServicioConexionGsg } from '../rutas/conexion-gsg.js';
import type { CargaLote, ResultadoCarga } from '../rutas/cargar.js';
import { revisarTelefono, PLANES, type PlanNumeracion } from '../rutas/telefono.js';
import type { Solicitud } from '../db/rutas.js';
import { CLAVE_FRASES_PROPIAS, leerConfirmacion, leerConfirmacionConReglas, leerEntregado, leerEntregadoConReglas, leerFrasesPropias, leerMotorizadoCorta, leerMotorizadoFueraDeFlujo, leerPreguntaPorPedido, leerTiempo, tiempoDudoso, type FrasesPropias, type LectorIA } from './interpretar.js';
import { randomBytes } from 'node:crypto';
import type { BoundingBox } from '../types.js';
import { dentroDe } from '../geo/validate.js';
import { distanciaEnPalabras, haversineKm } from './geo.js';
import type { Bus, EventoEntregaDelDia } from '../eventos/bus.js';
import { leerLote, type FilaLote } from '../rutas/lote.js';
import { leerListaMotorizados } from './lote-motorizados.js';
import { CLIENTES_DE_PRUEBA } from './datos-de-prueba.js';
import {
  AJUSTES_ENTREGAS_POR_DEFECTO,
  ajustesEntregasSchema,
  contextoMotorizado,
  DESCRIPCION_TEXTOS,
  horaEnReloj,
  minutosEnPalabras,
  rellenar,
  TEXTOS_PARA_MOTORIZADO,
  TEXTOS_POR_DEFECTO,
  textoDe,
  VARIABLES_TEXTOS,
  type AjustesEntregas,
  type ContextoTexto,
  horaEnPalabras,
  soporteEnPalabras,
  telefonoEnPalabras,
} from './textos.js';
import type { ComoEntrego, DatosEnvio, Entrega, EntregasRepo, EstadoEntrega, EventoEntrega, Motorizado, NuevoMotorizado, PatchEntrega, PatchMotorizado } from './repo.js';
import { datosEnvioDeCrudo, fusionarDatosEnvio } from './datos-envio.js';
import { apartarPorMotorizado, resolverPorUbicacion, soltarSolicitudes, solicitudesAbiertasDe } from './ubicacion-unica.js';
import { pareceNoSoyYo, TEXTO_NO_SOY_YO } from '../rutas/inbound.js';
import { distanciaAlDistrito, distritoDePedido, distritoEnDireccion } from './distritos-centro.js';
import { limpiarDireccion } from './direccion-escrita.js';
import type { Geocodificador, ResultadoGeo } from './geocodificar.js';
import { calcularAlertas, type AlertaHoy } from './alertas-hoy.js';

/** La fuente de una ubicación que salió de la dirección escrita (no es un pin: es aproximada). */
export const FUENTE_DIRECCION_ESCRITA = 'dirección escrita (aproximada)';
/** Una dirección escrita vale si el mapa la pone a menos de esto (km) de su distrito. */
const KM_DIRECCION_EN_SU_DISTRITO = 1;

const CLAVE_AJUSTES = 'entregas.ajustes';
const CLAVE_CIERRE = 'entregas.ultimoCierre';
/** Un motorizado cuya ultima posicion de hoy esta a menos de esto del pin va primero. */
const KM_CERCA = 6;
/** Pasada la hora avisada mas esto, un "no llegó" del cliente pasa a una persona. */
const MINUTOS_TOLERANCIA_LLEGADA = 30;

/** Un pedido tal como lo manda GSG (o el simulador). */
export interface ClienteGsg {
  referencia: string;
  telefono: string;
  nombre?: string | null;
  direccion?: string | null;
  distrito?: string | null;
  notas?: string | null;
  /** Si GSG ya tiene la ubicacion (entonces solo falta confirmar). */
  lat?: number | null;
  lng?: number | null;
  id?: string | number | null;
  /** GSG lo marca urgente: sale primero hacia el motorizado. */
  urgente?: boolean | null;
  /** GSG lo cancelo: aqui se cancela tambien (y al cliente que ya tenia hora se le avisa). */
  cancelado?: boolean | null;
  /** Por que lo cancelo GSG (en palabras): va a la bitacora y a la incidencia. */
  motivoCancelacion?: string | null;
  /** El motorizado que GSG ya asigno (opcional): su numero es el que se le da al cliente en el cierre y en UBI REGISTRADA. */
  motorizado?: { nombre?: string | null; telefono?: string | null } | string | null;
  telefonoMotorizado?: string | null;
}

/** La lista del dia del simulador de GSG, con sus apartados. Ver recibirListaGsg. */
export interface PendientesGsg {
  faltaUbicacion?: ClienteGsg[];
  faltaConfirmacion?: ClienteGsg[];
  terminados?: Array<ClienteGsg | { referencia: string }>;
  /** Lo que GSG cancelo (referencias): se cancela aqui. Una lista vacia no cancela nada. */
  cancelados?: Array<{ referencia: string; motivoCancelacion?: string | null; motivo?: string | null } | string>;
  /** El dia al que se refieren (AAAA-MM-DD). Sin el, hoy. */
  dia?: string;
}

export interface ResultadoSincronizacion {
  ok: boolean;
  detalle: string;
  dia: string;
  nuevas: number;
  actualizadas: number;
  ubicacionesPedidas: number;
  confirmacionesPendientes: number;
  terminadas: number;
  /** Las nuevas que esperan que una persona confirme su envío (ajuste «Confirmar la lista de GSG antes de enviar»). */
  retenidas?: number;
  /** Las que GSG cancelo o cambio (telefono, direccion, distrito) en esta pasada. */
  canceladas?: number;
  cambiadas?: number;
  lote?: { id: string; nombre: string; total: number } | null;
  at: string;
}

export interface RespuestaEntregas {
  /** false = este mensaje no era de entregas: sigue su camino. */
  atendida: boolean;
  /** Lo que conviene contestarle ahora mismo, si algo. */
  responder?: string;
  /** Si la respuesta lleva botones (SI / NO): quien la manda los pone si el WhatsApp puede. */
  botones?: Array<{ id: string; title: string }>;
  entrega?: Entrega;
  /** Que se decidio, para la bitacora y las pruebas. */
  resultado?: string;
}

/** Lo que se hace cuando el cliente en silencio pregunta por la hora (ver `horaPedidaEnSilencio`). */
export type HoraPedidaEnSilencio =
  | { responder: string; entrega: Entrega; tipo: 'con_hora' | 'pasada' | 'sin_tiempo' }
  | { callar: string; entrega: Entrega };

/** La misma respuesta de la hora no se repite antes de esto (varias preguntas en ráfaga = una respuesta). */
export const HORA_PEDIDA_REPETIDA_MS = 10 * 60_000;
/** Como mucho estas respuestas de la hora por pedido y día. */
export const HORA_PEDIDA_MAX_POR_DIA = 4;

/** Una parada de la ruta de un motorizado. */
export interface ParadaRuta {
  orden: number;
  entrega: Entrega;
  /** Kilometros desde la parada anterior (o desde su ultima posicion); null si no se sabe de donde sale. */
  km: number | null;
  distancia: string | null;
  mapa: string | null;
  /** esperando_tiempo (aun no dijo en cuanto), con_hora (ya se aviso al cliente), cerca (ya aviso que esta cerca). */
  situacion: 'esperando_tiempo' | 'con_hora' | 'cerca';
  llega: string | null;
}

export interface RutaMotorizado {
  motorizado: Motorizado;
  /** De donde sale: su ultima posicion de hoy, si la hay. */
  desde: { lat: number; lng: number; en: Date } | null;
  paradas: ParadaRuta[];
  totalKm: number;
  /** El mensaje tal como se le manda por WhatsApp. */
  texto: string;
}

export type AccionEnlace = 'minutos' | 'cerca' | 'entregado' | 'no_estaba' | 'no_puedo';

export interface PaginaMotorizado {
  ok: true;
  motorizado: { id: number; nombre: string; placa: string | null };
  negocio: string;
  /** Hasta cuando vale el enlace. */
  venceAt: Date;
  ruta: RutaMotorizado;
  /** Pedidos suyos sin pin (esperando la ubicacion del cliente): se enseñan, sin botones de camino. */
  sinPin: Entrega[];
  /** Que puede hacer con cada parada, ya decidido aqui. */
  acciones: Record<number, AccionEnlace[]>;
}

export interface ResultadoLoteMotorizados {
  creados: Motorizado[];
  repetidos: Motorizado[];
  descartados: Array<{ linea: number; texto: string; motivo: string }>;
  detalle: string;
}

export interface ResultadoTraspaso {
  motorizado: Motorizado;
  traspasadas: Entrega[];
  /** A quien fueron a parar (si se eligio uno). */
  destino: Motorizado | null;
}

/** La puntualidad real de un motorizado (ultimos 30 dias), en palabras. */
export interface PuntualidadMotorizado {
  entregas: number;
  /** Minutos de desvio medio entre la hora avisada y la real; positivo = tarde. */
  desvioMedioMin: number;
  texto: string;
}

export interface FilaEntrega extends Entrega {
  motorizado: Pick<Motorizado, 'id' | 'nombre' | 'phone' | 'placa'> | null;
  /** En cristiano: que le esta pasando ahora mismo. */
  situacion: string;
  /** Que puede hacer una persona con ella. */
  acciones: string[];
  /** Si el reparto la tiene entre manos, su solicitud. */
  solicitud?: Pick<Solicitud, 'id' | 'estado' | 'intentos' | 'incidencia' | 'loteId'> | null;
  /** Las referencias de los OTROS pedidos vivos de hoy del mismo cliente (mismo telefono). */
  mismoCliente: string[];
}

/** Lo que hizo el ultimo cierre del dia. */
export interface ResultadoCierre {
  /** El dia (AAAA-MM-DD) en que se ejecuto: no se repite dentro del mismo dia. */
  dia: string;
  cuando: string;
  /** Referencias que quedaron sin terminar (pasaron a incidencia `dia_cerrado`). */
  sinTerminar: string[];
  /** Referencias avisadas que nadie marco como entregadas: se dieron por entregadas. */
  dadasPorEntregadas: string[];
  /** Quien lo lanzo: 'motor' o el nombre de la persona. */
  quien: string;
}

export interface FilaPegada {
  telefono: string;
  nombre?: string;
  referencia?: string;
  direccion?: string;
  distrito?: string;
  notas?: string;
  /** Si viene, manda sobre las casillas generales. */
  faltaUbicacion?: boolean;
  faltaConfirmacion?: boolean;
  /** Lo que GSG cuenta del envio (producto, empresa, codigo, monto...), si viene. */
  datosEnvio?: DatosEnvio | null;
}

export interface ResultadoCargaVarias {
  creadas: Entrega[];
  /** Referencias que ya existian hoy. */
  repetidas: string[];
  descartadas: Array<{ linea: number; texto: string; motivo: string }>;
  lote: { id: string; nombre: string; total: number } | null;
}

/**
 * Por que una accion de Numeros del dia se hizo o se salto con un numero.
 * El endpoint en masa las cuenta y lo dice en palabras (src/entregas/numeros.ts).
 */
export type MotivoNumero =
  | 'hecho'
  | 'no_existe'
  | 'cerrada'
  | 'ya_tiene_ubicacion'
  | 'ya_confirmo'
  | 'no_hace_falta'
  | 'falta_ubicacion'
  | 'pausado'
  | 'ya_marcado'
  | 'sin_marca'
  | 'ya_pausado'
  | 'no_pausado'
  | 'no_retenido'
  | 'fallo';

export interface ResultadoNumero {
  hecho: boolean;
  motivo: MotivoNumero;
  entrega: Entrega | null;
}

/** «Por confirmar el envío»: lo que llegó de GSG y espera el visto bueno de una persona. */
export interface PorConfirmarEnvio {
  total: number;
  /** Los que al confirmar reciben el pedido de ubicación. */
  ubicacion: number;
  /** Los que al confirmar reciben solo la pregunta SÍ/NO (GSG ya tiene su dirección). */
  confirmar: number;
  /** true = ya se confirmó otra tanda hoy: el aviso dice «Llegaron M más». */
  mas: boolean;
  /** El aviso tal como se enseña arriba (vacío si no espera nada). */
  aviso: string;
}

export interface ResultadoLiberar {
  ok: true;
  liberadas: number;
  ubicacion: number;
  confirmar: number;
  /** Los que no esperaban (ya se habían confirmado, cancelados...). */
  saltadas: number;
  aviso: string;
}

/** En qué punto va un cliente con la regla del dueño (src/ia/agente-operativo.ts). */
export interface SituacionGsg {
  /** Un pedido de «falta confirmar» al que ya se le preguntó SÍ/NO ('pedida') o todavía no ('sin_pedir'). */
  confirmar: 'pedida' | 'sin_pedir' | null;
  /** Lo de la ubicación (sin contar lo que espera confirmar el envío ni los de «falta confirmar»). */
  ubicacion: 'sin_entrega' | 'pendiente' | 'registrada';
}

export type ClaseConfirmarGsg = 'si' | 'no' | 'cambio' | 'por_que' | 'otra';

/** El grupo de un pedido: pedirle la ubicación, o solo preguntarle SÍ/NO (GSG ya tiene su dirección). */
export function grupoDe(e: Pick<Entrega, 'ubicacionEstado' | 'confirmacionEstado' | 'ubicacionFuente'>): 'ubicacion' | 'confirmar' {
  if (e.ubicacionEstado === 'pendiente') return 'ubicacion';
  if (e.confirmacionEstado === 'no_hace_falta') return 'ubicacion';
  // El pin lo mandó el propio cliente: era del grupo de la ubicación.
  const fuente = String(e.ubicacionFuente ?? '');
  if (e.ubicacionEstado === 'recibida' && fuente && fuente !== 'gsg' && !fuente.startsWith('a mano')) return 'ubicacion';
  return 'confirmar';
}

/** «Llegaron N números de GSG: X para pedir ubicación · Y para confirmar». */
export function avisoPorConfirmar(total: number, ubicacion: number, confirmar: number, mas: boolean): string {
  if (!total) return '';
  const numeros = total === 1 ? '1 número' : `${total} números`;
  const cabeza = mas ? `Llegaron ${total} más de GSG` : `Llegaron ${numeros} de GSG`;
  return `${cabeza}: ${ubicacion} para pedir ubicación · ${confirmar} para confirmar`;
}

export interface ResumenEntregas {
  dia: string;
  /** Lo que llegó de GSG y espera que una persona confirme el envío. */
  porConfirmarEnvio: PorConfirmarEnvio;
  ajustes: AjustesEntregas;
  cifras: Record<EstadoEntrega, number> & { total: number; faltaUbicacion: number; faltaConfirmacion: number; conMotorizado: number; enCamino: number; urgente: number; esperandoSegundaVisita: number };
  entregas: FilaEntrega[];
  motorizados: Array<Motorizado & { enManos: number; puntualidad: PuntualidadMotorizado | null }>;
  eventos: Array<{ at: Date; referencia: string; phone: string; nombre: string | null; tipo: string; detalle: string | null }>;
  gsg: ReturnType<ServicioConexionGsg['estado']> | null;
  ultimaSincronizacion: ResultadoSincronizacion | null;
  /** Si el proveedor exige plantillas fuera de la ventana (API de Meta) y cuales hay aprobadas. */
  plantillas: { hacenFalta: boolean; aprobadas: string[] };
  motor: { enHorario: boolean; parado: string | null };
  textos: { porDefecto: typeof TEXTOS_POR_DEFECTO; variables: typeof VARIABLES_TEXTOS; descripcion: typeof DESCRIPCION_TEXTOS };
  /** El ultimo cierre del dia que se hizo, si alguno. */
  ultimoCierre: ResultadoCierre | null;
  /** Si el cierre de ayer esta pendiente (hay vivas de dias anteriores). */
  cierrePendiente: number;
  /** La cola de reportes hacia GSG: lo que no se acepto se ve aqui. */
  gsgCola: { pendiente: number; enviado: number; fallido: number; atascado: number } | null;
  /** «Hay que mirar»: los pedidos trabados (ver src/entregas/alertas-hoy.ts). Vacío = no se enseña nada. */
  alertas: AlertaHoy[];
}

/** Lo que se le contesta al cliente que tenía un pin lejano por confirmar (la IA solo clasificó SÍ / NO / otra cosa). */
export interface RespuestaPinLejos {
  /** registrada = SÍ; no = se le pide otro pin; repregunta = otra cosa por primera vez; persona = otra cosa por segunda vez (no se le escribe nada). */
  tipo: 'registrada' | 'no' | 'repregunta' | 'persona';
  texto: string;
  botones?: Array<{ id: string; title: string }>;
  entrega: Entrega;
}

/** Lo que pasó con la dirección que escribió el cliente. */
export interface RespuestaDireccionEscrita {
  /** registrada = se ubicó en el mapa y cae en su distrito; anotada = se guardó y se le pide el pin. */
  tipo: 'registrada' | 'anotada';
  texto: string;
  entrega: Entrega;
}

export interface ServicioEntregas {
  /** El reloj del servicio (en produccion, la hora real): el agente lo usa para que sus fechas cuadren con las del reparto. */
  ahora?(): Date;
  ajustes(): AjustesEntregas;
  guardarAjustes(patch: Partial<AjustesEntregas>): Promise<AjustesEntregas>;
  recargar(): Promise<void>;
  /** El dia del reparto de hoy, AAAA-MM-DD en el reloj del negocio. */
  hoy(): string;

  /**
   * Mete en el sistema una lista del dia ya recibida (la del simulador de
   * GSG): crea lo nuevo, refleja lo cambiado, cancela lo cancelado y marca lo
   * terminado. No llama a nadie: GSGchat nunca le pide nada a GSG. Los
   * pedidos de verdad entran por POST /api/v1/entregas.
   */
  recibirListaGsg(cuerpo: PendientesGsg): Promise<ResultadoSincronizacion>;
  ultimaSincronizacion(): ResultadoSincronizacion | null;
  /** Mira las que el reparto dio por perdidas (sin WhatsApp, numero mal...) y las marca aqui. */
  revisarReparto(): Promise<number>;

  /** El cliente mando su ubicacion (la trae el reparto o el chat). */
  alUbicacion(contact: Pick<Contact, 'id' | 'phone' | 'name'>, ubicacion: { lat: number; lng: number; mapsUrl?: string | null; fuente?: string | null; yaReportada?: boolean }): Promise<RespuestaEntregas>;
  /** El «ubicación registrada» (enlace, horario y soporte) para un cliente sin entrega de hoy. */
  textoUbicacionRegistrada(datos: { nombre?: string | null; mapa?: string | null }): string;
  /**
   * El pin tiene que tener sentido: si cae a más de «Distancia máxima entre el
   * pin y el distrito» del distrito de su pedido, NO se registra: queda
   * propuesto y se devuelve la pregunta SÍ/NO (con botones). atendida false =
   * el pin está bien (o no hay distrito con qué comparar): sigue el camino de siempre.
   */
  revisarPin(contact: Pick<Contact, 'id' | 'phone' | 'name'>, ubicacion: { lat: number; lng: number; mapsUrl?: string | null; fuente?: string | null }): Promise<RespuestaEntregas>;
  /** Si ese cliente tiene un pin lejano esperando su SÍ o su NO. */
  pinLejosPendiente(phone: string): Promise<boolean>;
  /** Su respuesta a «¿es ahí donde recibes tu pedido?». null = no tenía nada por confirmar. */
  responderPinLejos(phone: string, clase: 'si' | 'no' | 'otra', texto: string, como: string): Promise<RespuestaPinLejos | null>;
  /**
   * Escribió su dirección en vez del pin: se guarda en el pedido y, si el mapa
   * gratuito la ubica bien y cae en su distrito, se registra como ubicación
   * aproximada. null = no tiene ningún pedido esperando la ubicación.
   */
  alDireccionEscrita(contact: Pick<Contact, 'id' | 'phone' | 'name'>, texto: string, como: string): Promise<RespuestaDireccionEscrita | null>;
  /**
   * El primer mensaje que le pide la ubicacion a un cliente con entrega (la
   * plantilla «solicitudUbicacion» con los datos del envio de GSG). null =
   * ese telefono no tiene entrega viva: el reparto usa su texto de siempre.
   */
  textoSolicitudUbicacion(solicitud: { phone: string | null; referencia?: string | null; loteId?: string | null }): Promise<string | null>;
  /** Los textos del agente operativo (por qué la ubicación, el cierre), con los datos de la entrega viva de ese teléfono si hay. */
  textoAgente(clave: 'porQueUbicacion' | 'cierreAgente', phone: string, nombre?: string | null): Promise<string>;
  /**
   * El cliente, con su ubicación ya registrada, pide cambiarla («me equivoqué
   * de ubicación»). Antes de la hora límite: que mande la nueva. Después:
   * que coordine con el motorizado (con su número). null = no tiene ninguna
   * ubicación registrada hoy (no es un cambio).
   */
  cambioDeUbicacion(phone: string): Promise<string | null>;
  /** Lo que hizo el agente operativo con un cliente queda en la bitácora de sus entregas vivas. */
  anotarAgente(phone: string, detalle: string): Promise<void>;
  /** Si ese teléfono tiene hoy una entrega viva, y si ya mandó su ubicación. */
  estadoUbicacionDe(phone: string): Promise<'sin_entrega' | 'pendiente' | 'registrada'>;
  /** Con la regla del dueño: si tiene un pedido de «falta confirmar» y en qué punto va lo de la ubicación. */
  situacionGsg(phone: string): Promise<SituacionGsg>;
  /**
   * El cliente de «falta confirmar» contestó (la IA solo clasificó): se hace
   * lo que toca y se devuelve el texto fijo que se le manda. null = no tiene
   * ningún pedido al que se le haya preguntado.
   */
  responderConfirmacionGsg(phone: string, clase: ClaseConfirmarGsg, texto: string, como: string): Promise<{ texto: string; botones?: Array<{ id: string; title: string }>; cerrar: boolean; entrega: Entrega } | null>;
  /** Confirma el envío de lo que llegó de GSG (todo lo que espera, o esos ids): pasa al reparto con el ritmo de siempre. */
  liberarEnvio(ids: number[] | 'todos', quien: string): Promise<ResultadoLiberar>;
  /** Lo que espera confirmar el envío ahora mismo. */
  porConfirmarEnvio(): Promise<PorConfirmarEnvio>;
  /** El cliente o un motorizado escribio algo (o pulso un boton: `boton` trae su id). */
  alTexto(contact: Pick<Contact, 'id' | 'phone' | 'name'>, texto: string, opts?: { boton?: string; citaId?: string | null }): Promise<RespuestaEntregas>;
  /** Un motorizado mando una foto (o un video o documento): si tiene un pedido con hora avisada, es la prueba de entrega. */
  alAdjuntoDeMotorizado(contact: Pick<Contact, 'id' | 'phone' | 'name'>, tipo: string, texto?: string | null): Promise<RespuestaEntregas>;
  /** Como se llama el negocio (para las paginas sueltas). */
  nombreNegocio?: () => string;
  /** El pin del cliente cae fuera de la zona: no se registra, la entrega pasa a una persona y se le explica. */
  alUbicacionFueraDeZona(contact: Pick<Contact, 'id' | 'phone' | 'name'>, ubicacion: { lat: number; lng: number; fuente?: string | null }): Promise<RespuestaEntregas>;
  /** La pagina del motorizado sin instalar nada: crea (o renueva) su enlace de 7 dias y, si se pide, se lo manda por WhatsApp. */
  crearEnlaceMotorizado(id: number, opts: { mandar?: boolean; quien: string }): Promise<{ ok: true; url: string; venceAt: Date; enviado: boolean; motivo?: string } | { ok: false; motivo: string }>;
  /** Lo que ve el motorizado en su pagina: sus paradas de hoy en orden y lo que puede hacer con cada una. */
  paginaDeMotorizado(token: string): Promise<PaginaMotorizado | { ok: false; motivo: string }>;
  /** Un boton de la pagina del motorizado: entra por el mismo camino que su respuesta por WhatsApp. */
  accionDesdeEnlace(token: string, accion: AccionEnlace, datos: { referencia: string; minutos?: number }): Promise<{ ok: true; respuesta: string; resultado?: string } | { ok: false; motivo: string }>;
  /** Si este telefono es un motorizado (para que el asistente no le venda nada). */
  esMotorizado(phone: string): Promise<boolean>;
  /**
   * Regla del dueño en modo «Solo lo de GSG» (ajuste silencioTrasUbi): «El
   * único proceso de GSGchat es disparar mensajes. Una vez que la IA manda el
   * mensaje de UBI REGISTRADA, ahí llega la IA: ya no vuelve a responder.»
   */
  reglaGsgActiva(): boolean;
  /** «Solo lo de GSG»: ningun texto del modelo le llega a un cliente. */
  modoGsg(): boolean;
  /**
   * Si a este cliente ya no se le escribe nada por su pedido: recibio UBI
   * REGISTRADA o el cierre, y no ha llegado un pedido nuevo despues. Solo con
   * la regla del dueño activa; un motorizado nunca.
   */
  clienteEnSilencio(phone: string): Promise<boolean>;
  /** Una persona le escribió al cliente: lo que necesitaba a alguien queda atendido. Devuelve cuántos pedidos cambió. */
  atendidoPorPersona(phone: string, quien?: string): Promise<number>;
  /**
   * «No soy yo» (antes o después del pin, o en «falta confirmar»): sus pedidos
   * pasan a «Necesita a alguien», GSG se entera, el reparto deja de escribirle
   * y el chat se calla. `responder` es el texto fijo que se le manda UNA vez
   * (ninguno si ya lo había dicho). atendida false = no tiene nada en curso.
   */
  alNoSoyYo(contact: Pick<Contact, 'id' | 'phone' | 'name'>, texto: string, como: string): Promise<RespuestaEntregas>;
  /** Antes del pin escribió otra cosa y recibió el cierre: sus pedidos sin ubicación pasan a una persona. */
  pasarAPersona(phone: string, codigo: string, detalle: string): Promise<number>;
  /**
   * Si ese cliente ya tiene HOY su ubicación registrada: true, y de paso
   * cierra lo que todavía se la pidiera (solicitudes del reparto, la lista de
   * envío automático). Lo usa el agente antes de decidir si «falta la ubicación».
   */
  sanarUbicacion(phone: string): Promise<boolean>;
  /** Si el cliente pregunta por su pedido o la hora: el texto fijo con la hora estimada (null = no es esa pregunta). */
  /** orzar: la IA ya dijo que pregunta por su pedido o la hora (no hace falta que lo reconozcan las reglas). */
  respuestaPorPedido(phone: string, texto: string, opts?: { forzar?: boolean }): Promise<string | null>;
  /**
   * Excepción al silencio tras UBI (pedido del dueño, 28/09): el cliente
   * pregunta cuándo llega / dónde está su pedido. `responder` = el texto fijo
   * con la hora (minutos del motorizado + margen) o el horario de entrega;
   * `callar` = ya se le contestó lo mismo hace poco o llegó al tope del día;
   * null = no es esa pregunta o no hay pedido al que aplicarla (sigue el
   * camino de siempre). Solo con la regla del dueño activa.
   */
  horaPedidaEnSilencio(phone: string, texto: string): Promise<HoraPedidaEnSilencio | null>;

  // --- lo que hace el motor
  pedirConfirmacion(entrega: Entrega): Promise<{ ok: boolean; motivo?: string; retryAfterMs?: number }>;
  /** Cliente recurrente: le propone su ultima direccion en vez de pedirle el pin (lo llama el motor). */
  proponerUbicacion(entrega: Entrega): Promise<{ ok: boolean; motivo?: string; retryAfterMs?: number }>;
  /** Las propuestas sin respuesta que ya vencieron pasan al reparto para pedir el pin como siempre. Devuelve cuantas. */
  revisarPropuestas(): Promise<number>;
  mandarAMotorizado(entrega: Entrega): Promise<{ ok: boolean; motivo?: string; retryAfterMs?: number; motorizado?: Motorizado }>;
  /**
   * El cierre antes del pin: le asigna un motorizado SIN ubicación (antes de
   * mandar el cierre, para que el número sea el suyo). null = no hay ninguno
   * activo (el motor se lo asigna en cuanto haya uno).
   */
  asignarSinUbicacion(phone: string, motivo: string): Promise<Motorizado | null>;
  /** «Asignar motorizado sin ubicación» desde la ficha de Hoy o Números del día. */
  asignarSinUbicacionAMano(id: number, motorizadoId: number | null, quien: string): Promise<{ ok: true; entrega: Entrega; motorizado: Motorizado } | { ok: false; motivo: string }>;
  /** Si ese cliente tiene un pedido que ya lleva un motorizado sin ubicación. */
  tieneMotorizadoSinUbicacion(phone: string): Promise<boolean>;
  atenderMotorizadoQueNoContesta(entrega: Entrega): Promise<{ ok: boolean; motivo?: string; retryAfterMs?: number }>;
  /** El motorizado ya dio su tiempo pero el aviso al cliente no pudo salir (el ritmo del numero lo freno): se vuelve a intentar. */
  reintentarAviso(entrega: Entrega): Promise<{ ok: boolean; motivo?: string; retryAfterMs?: number }>;
  /** El cierre del dia: lo vivo de ayer a incidencia, lo avisado a entregada. No se repite el mismo dia salvo `forzar`. */
  /**
   * `soloPrueba`: cierra SOLO lo del Modulo desarrollador (numeros de prueba),
   * sin avisar a nadie y sin contar como el cierre del dia (el de verdad sigue
   * a su hora). Ver src/desarrollador/reloj.ts.
   */
  cerrarDia(opts?: { forzar?: boolean; quien?: string; soloPrueba?: boolean }): Promise<{ ok: boolean; motivo?: string; resultado?: ResultadoCierre }>;
  /** Lo llama el motor en cada pasada: cierra si esta activo, aun no se cerro hoy y ya es la hora. */
  cerrarDiaSiToca(): Promise<boolean>;
  ultimoCierre(): ResultadoCierre | null;
  /** Las segundas visitas que el cliente no contesto a tiempo pasan a una persona. Devuelve cuantas. */
  revisarSegundasVisitas(): Promise<number>;

  // --- lo que hace una persona desde la pantalla
  confirmarAMano(id: number, confirmada: boolean, quien: string): Promise<Entrega | null>;
  cancelar(id: number, motivo: string, quien: string): Promise<Entrega | null>;
  ponerUbicacion(id: number, lat: number, lng: number, quien: string): Promise<Entrega | null>;
  /** Vuelve a repartir (a cualquiera, o a ese motorizado concreto). `{ error }` si el motorizado no existe o no esta activo. */
  reasignar(id: number, motorizadoId: number | null, quien: string): Promise<Entrega | null | { error: string }>;
  reintentar(id: number, quien: string): Promise<Entrega | null>;
  /** Una persona la da por entregada (el motorizado avisó por telefono, por ejemplo). */
  marcarEntregada(id: number, quien: string): Promise<Entrega | null>;
  /** Una persona fuerza la segunda visita (el cliente llamo): vuelve al motorizado sin preguntarle al cliente. */
  segundaVisitaAMano(id: number, quien: string): Promise<{ ok: true; entrega: Entrega } | { ok: false; motivo: string }>;
  /** Marcar o quitar "urgente". Si un motorizado ya la lleva, se le avisa. */
  marcarPrioridad(id: number, urgente: boolean, quien: string): Promise<Entrega | null>;
  /** Una lista pegada (Excel, CSV o lineas): varias entregas de golpe y UN lote del reparto para las que necesitan ubicacion. */
  /** `retener`: es la lista de GSG (la API): espera a que se confirme el envío si el ajuste lo pide. */
  crearVarias(filas: FilaPegada[], quien: string, opts?: { faltaUbicacion?: boolean; faltaConfirmacion?: boolean; descartadas?: ResultadoCargaVarias['descartadas']; retener?: boolean }): Promise<ResultadoCargaVarias>;
  /** Lee un texto pegado (cabecera opcional) y lo convierte en filas; reconoce columnas "ubicacion"/"confirmar" con si/no. */
  leerListaPegada(texto: string): { filas: FilaPegada[]; descartadas: ResultadoCargaVarias['descartadas'] };
  /** Como queda un texto con los datos de una entrega de hoy (o de ejemplo). */
  previsualizar(clave: keyof AjustesEntregas['textos'], texto: string): Promise<string>;
  // --- Numeros del dia: una accion sobre UN numero; el endpoint en masa las repite (ver numeros.ts)
  /** Le pide (o le vuelve a pedir) la ubicacion: primero en la cola del reparto, que la manda con su ritmo. */
  pedirUbicacionAhora(id: number, quien: string): Promise<ResultadoNumero>;
  /** Le pide (o le vuelve a pedir) que confirme: primero en la cola del motor de entregas. */
  pedirConfirmacionAhora(id: number, quien: string): Promise<ResultadoNumero>;
  /** Pone o quita la marca «ya contactado» (se le llamo, se hablo por otro lado). */
  marcarContactado(id: number, marcar: boolean, quien: string): Promise<ResultadoNumero>;
  /** Detiene o reanuda los mensajes automaticos a ese numero (ubicacion y confirmacion). Sus respuestas se siguen leyendo. */
  pausarMensajes(id: number, pausar: boolean, quien: string): Promise<ResultadoNumero>;
  /** Un pedido metido a mano (sin GSG). */
  /** Un pedido a mano. Sin `referencia`, el sistema la inventa (M-HHMM-N) para que la pantalla solo pida nombre, telefono y direccion. */
  crearAMano(input: { referencia?: string; telefono: string; nombre?: string; direccion?: string; distrito?: string; notas?: string; faltaUbicacion: boolean; faltaConfirmacion: boolean; lat?: number; lng?: number; datosEnvio?: DatosEnvio | null; retener?: boolean }, quien: string): Promise<{ ok: true; entrega: Entrega } | { ok: false; motivo: string }>;

  // --- motorizados
  motorizados(): Promise<Motorizado[]>;
  /** Sus pedidos de hoy en orden de cercania (urgentes primero), con el mensaje listo para mandar. */
  rutaDeMotorizado(id: number): Promise<RutaMotorizado | null>;
  /** Le manda su ruta por WhatsApp. */
  mandarRuta(id: number, quien: string): Promise<{ ok: boolean; motivo?: string; ruta?: RutaMotorizado }>;
  /** Le quita todos sus pedidos vivos y los reparte (a uno concreto o al que toque); opcionalmente lo manda a descanso. */
  traspasarPedidos(id: number, opts: { destino?: number | null; descanso?: boolean; quien: string; motivo?: string; avisarMotorizado?: boolean }): Promise<{ ok: true; resultado: ResultadoTraspaso } | { ok: false; motivo: string }>;
  crearMotorizado(input: NuevoMotorizado): Promise<{ ok: true; motorizado: Motorizado; nuevo: boolean } | { ok: false; motivo: string }>;
  /** Varios motorizados de un texto pegado (una linea por motorizado: nombre, WhatsApp, placa, zona). */
  crearMotorizadosDesdeTexto(texto: string): Promise<ResultadoLoteMotorizados>;
  editarMotorizado(id: number, patch: PatchMotorizado): Promise<Motorizado | null>;
  quitarMotorizado(id: number): Promise<Motorizado | null>;

  /** Todo lo que ensena la pantalla. */
  resumen(): Promise<ResumenEntregas>;
  entrega(id: number): Promise<{ entrega: FilaEntrega; eventos: Awaited<ReturnType<EntregasRepo['eventos']>> } | null>;
  /** Para el prompt de la IA operadora y del asistente. */
  descripcionParaIA(): Promise<string>;
  /** Lo que el asistente puede decirle a ESTE cliente sobre su pedido de hoy. */
  contextoDeCliente(phone: string): Promise<string | null>;
  /** El pedido (referencia) mas reciente de ese telefono, de hoy o de ayer, para ligarle una conversacion guardada. */
  pedidoDe(phone: string): Promise<string | null>;
  /** Los pedidos de hoy que ya terminaron (avisados o terminados) con su telefono: para guardar sus conversaciones de golpe. */
  telefonosTerminadosHoy(): Promise<Array<{ phone: string; referencia: string }>>;
  /** Cuanto queda hasta el proximo envio del motor (lo pone el motor). */
  conectarMotor(m: { proximoEnvioEn(): number; parado(): string | null; enHorario(): boolean }): void;
}

export interface DepsEntregas {
  repos: Repos;
  /** Cuánto espera el cierre a que el reparto asigne motorizado (ver `textoAgente`). 0 en las pruebas. */
  esperaMotorizadoMs?: number;
  repo: EntregasRepo;
  sender: Sender;
  settingsRepo: SettingsRepo;
  /** La puerta a GSG (el proxy configurable). */
  gsg: PuertoGsg;
  conexionGsg?: ServicioConexionGsg;
  /** Como se carga un lote del reparto (ver src/rutas/cargar.ts). */
  cargarLote: (body: CargaLote) => Promise<ResultadoCarga>;
  nombreNegocio: () => string;
  /** A quien se avisa cuando algo necesita una persona. Vacio = a nadie. */
  supervisor?: () => string;
  /** La IA, si hay: lee lo que las reglas no entienden y, si se pide, redacta el aviso. */
  ia?: () => LectorIA | null;
  /**
   * Si el proveedor exige plantilla fuera de la ventana de 24 h (la API de
   * Meta). Con el cliente no oficial no existe esa regla. Ver src/rutas/motor.ts.
   */
  usarPlantilla?: () => boolean;
  timezone?: string;
  /** La zona horaria elegida en Ajustes (manda sobre `timezone` si esta). */
  zonaHoraria?: () => string;
  plan?: PlanNumeracion;
  publicBaseUrl?: string;
  /** El bus de eventos: los webhooks salientes se enteran de confirmaciones, avisos, entregas e incidencias. */
  bus?: Bus;
  /** El gancho de Ajustes para ampliar el horario del numero con el de entregas (Hoy → Ajustes). */
  ampliarHorario?: (fn: () => { desde: string; hasta: string } | null) => void;
  /**
   * La zona que se cubre: un pin fuera de `bbox` no se registra, se aparta
   * para una persona. Uno dentro de `bbox` pero fuera de `zonaSinExtra` (Lima
   * y Callao) se registra, y al cliente se le avisa del costo extra que le
   * dira el motorizado (a el GSGchat no le escribe nada de esto).
   */
  geo?: { bbox?: BoundingBox; zonaSinExtra?: BoundingBox; cobertura?: string };
  /**
   * El modo de la tienda ("gsg" = «Solo lo de GSG»). Con "gsg" manda la regla
   * del dueño: la IA no redacta nada para el cliente y, con el ajuste
   * «Después de UBI REGISTRADA, no escribirle más al cliente», tras UBI
   * REGISTRADA (o el cierre) no se le escribe nada más por ese pedido.
   */
  modo?: () => string;
  /** El numero del WhatsApp de la tienda: el ultimo recurso del numero que se le da al cliente. */
  numeroPropio?: () => string | null | undefined;
  /**
   * El buscador de direcciones gratuito (Nominatim de OpenStreetMap, ver
   * src/entregas/geocodificar.ts). Sin él, la dirección escrita se guarda y se
   * le pide el pin al cliente, como si el mapa no la encontrara.
   */
  geocodificador?: Geocodificador | null;
  ahora?: () => Date;
  log?: (m: string, d?: Record<string, unknown>) => void;
}

/** Como se llama el motorizado en los textos: "Carlos (ABC-123)". */
function firmaMotorizado(m: Motorizado | null | undefined): string {
  if (!m) return '';
  return m.placa ? `${m.nombre} (${m.placa})` : m.nombre;
}

/**
 * Donde nombra el motorizado un pedido, por palabra completa (-1 si no lo
 * nombra): «P-1001 20» nombra a P-1001 y NO a P-100.
 */
export function posicionDeReferencia(texto: string, referencia: string): number {
  const ref = referencia.trim().toLowerCase();
  if (!ref) return -1;
  const escapada = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(^|[^\\p{L}\\p{N}])${escapada}(?![\\p{L}\\p{N}])`, 'u').exec(texto.toLowerCase());
  return m ? m.index + m[1]!.length : -1;
}

/**
 * Un trozo de «P-1001 20, P-2001 30 y P-1002 no voy» sin lo que lo une al
 * siguiente: la coma, el punto y coma o la «y» SUELTA. Nunca la «y» final
 * de una palabra («no voy» sigue siendo «no voy»).
 */
export function sinUnionFinal(trozo: string): string {
  return trozo.replace(/[\s,;]+$/, '').replace(/[\s,;]+y$/i, '').replace(/[\s,;]+$/, '');
}

/** Los wamid que guarda un evento «motorizado_enviado»: el del mensaje y el del pin aparte. */
export function wamidsDelEvento(payload: unknown): string[] {
  const p = (payload ?? {}) as { wamid?: unknown; wamids?: unknown };
  const lista = [p.wamid, ...(Array.isArray(p.wamids) ? p.wamids : [])];
  return [...new Set(lista.filter((w): w is string => typeof w === 'string' && w.length > 0))];
}

/**
 * Si dos ids son el mismo mensaje. WAHA da el id completo al enviar
 * («true_51987…@c.us_3EB0…») y en la cita a veces solo la ultima parte
 * («3EB0…»): se comparan tambien por esa parte.
 */
export function mismoMensaje(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const cola = (x: string) => x.split('_').pop() ?? x;
  const ca = cola(a);
  return ca.length >= 8 && ca === cola(b);
}

/** El enlace al pin, el que abre Google Maps en cualquier telefono. */
export function enlaceMapa(lat: number, lng: number): string {
  return `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** Que le pasa a una entrega, en cristiano. */
/**
 * `silencio`: la regla del dueño está activa («Solo lo de GSG» + silencio tras
 * UBI): el aviso de llegada y el «cerca» NO le salen al cliente, y la ficha no
 * puede decir que se le avisó (28/09).
 */
export function situacionDe(e: Entrega, motorizado: Motorizado | null, ajustes: AjustesEntregas, timezone: string, silencio = false): string {
  if (e.envioRetenidoAt && !['cancelada', 'terminada', 'entregada'].includes(e.estado)) {
    return grupoDe(e) === 'confirmar'
      ? 'Por confirmar el envío: todavía no se le escribe. Al confirmar se le pregunta SÍ o NO (GSG ya tiene su dirección).'
      : 'Por confirmar el envío: todavía no se le escribe. Al confirmar se le pide la ubicación.';
  }
  // Mandó un pin lejos de su distrito: se le preguntó si es ahí.
  if (e.pinPropuestoAt && e.ubicacionEstado === 'pendiente' && !['cancelada', 'terminada', 'entregada', 'incidencia'].includes(e.estado)) {
    return `Mandó un pin que queda lejos de ${distritoDePedido(e) ?? 'su distrito'} (${horaEnReloj(e.pinPropuestoAt, timezone)}): se le preguntó si es ahí donde recibe su pedido y se espera su SÍ o su NO.`;
  }
  if (e.direccionCliente && e.ubicacionEstado === 'pendiente' && (e.estado === 'esperando_ubicacion' || e.estado === 'pendiente')) {
    return `Escribió su dirección («${e.direccionCliente}») pero no se pudo ubicar con seguridad: se le pidió el pin para llegar exacto.`;
  }
  switch (e.estado) {
    case 'pendiente':
      return 'Recién llegada de GSG: todavía no se le ha escrito.';
    case 'esperando_ubicacion':
      if (e.ubicacionPropuestaAt && e.ubicacionPropuestaLat != null) return `Se le propuso la dirección de la última vez (${horaEnReloj(e.ubicacionPropuestaAt, timezone)}); se espera que diga si es la misma o mande otro pin.`;
      if (e.ubicacionPropuestaLat != null && !e.loteId) return 'Ya mandó su ubicación otro día: se le va a proponer esa dirección en cuanto toque.';
      if (e.ubicacionPropuestaAt && !e.loteId) return 'Dijo que hoy es otra dirección: se espera su pin.';
      return e.confirmacionEstado === 'pendiente' ? 'El reparto le está pidiendo la ubicación; después se le pedirá confirmar.' : 'El reparto le está pidiendo la ubicación.';
    case 'esperando_confirmacion':
      if (e.confirmacionEstado === 'pedida') return `Se le pidió confirmar (${e.confirmacionIntentos} de ${ajustes.confirmacionMaxIntentos}); se espera su SÍ o NO.`;
      return 'Ubicación lista; falta pedirle que confirme.';
    case 'lista':
      return motorizado ? `Ubicación y confirmación listas: reservada para ${firmaMotorizado(motorizado)}, se le manda en cuanto toque.` : 'Ubicación y confirmación listas: se le va a mandar a un motorizado.';
    case 'esperando_motorizado':
      if (motorizado && e.ubicacionEstado === 'pendiente' && e.motorizadoSinUbicacionAt && e.motorizadoEstado === 'enviado') return `Esperando ubicación · con motorizado: ${firmaMotorizado(motorizado)} tiene el pedido SIN ubicación (coordina con el cliente por teléfono); se espera que diga en cuánto entrega (aviso ${e.motorizadoIntentos} de ${ajustes.motorizadoMaxIntentos}).`;
      if (motorizado && e.motorizadoEstado === 'respondio' && !e.avisoEnviadoAt) return `${firmaMotorizado(motorizado)} dijo ${e.minutosMotorizado != null ? minutosEnPalabras(e.minutosMotorizado) : '?'}; el aviso de llegada al cliente sale en cuanto el ritmo del número lo permita.`;
      return motorizado ? `${e.segundaVisita ? 'Segunda visita: ' : ''}${firmaMotorizado(motorizado)} tiene el pin; se espera que diga en cuánto entrega (aviso ${e.motorizadoIntentos} de ${ajustes.motorizadoMaxIntentos}).` : 'Esperando motorizado.';
    case 'avisada':
      if (silencio) return `${e.segundaVisita ? 'Segunda visita: ' : ''}${firmaMotorizado(motorizado) || 'El motorizado'} dijo ${e.minutosMotorizado != null ? minutosEnPalabras(e.minutosMotorizado) : '?'}: llega hacia las ${e.llegaAproxAt ? horaEnReloj(e.llegaAproxAt, timezone) : '?'}. Al cliente NO se le escribió (silencio tras ubicación registrada): se le dice la hora si la pregunta${e.terminadaGsgAt ? '' : ' (GSG aún no la marcó terminada)'}${e.cercaAvisadoAt ? `; a las ${horaEnReloj(e.cercaAvisadoAt, timezone)} el motorizado dijo que ya está cerca` : ''}. Falta que el motorizado diga "entregado".`;
      return `${e.segundaVisita ? 'Segunda visita: ' : ''}${firmaMotorizado(motorizado) || 'El motorizado'} dijo ${e.minutosMotorizado != null ? minutosEnPalabras(e.minutosMotorizado) : '?'}; al cliente se le avisó que llega hacia las ${e.llegaAproxAt ? horaEnReloj(e.llegaAproxAt, timezone) : '?'}${e.terminadaGsgAt ? '' : ' (GSG aún no la marcó terminada)'}${e.cercaAvisadoAt ? `; a las ${horaEnReloj(e.cercaAvisadoAt, timezone)} se le avisó que ya está cerca` : ''}. Falta que el motorizado diga "entregado".`;
    case 'entregada': {
      const hora = e.entregadaAt ? horaEnReloj(e.entregadaAt, timezone) : '?';
      const quien = firmaMotorizado(motorizado) || 'el motorizado';
      switch (e.entregadaComo) {
        case 'foto':
          return `Entregada a las ${hora}: ${quien} mandó la foto.`;
        case 'persona':
          return `Entregada a las ${hora}: la marcó una persona desde el panel.`;
        case 'cierre':
          return `Se dio por entregada al cerrar el día (${quien} avisó la hora pero nadie escribió "entregado").`;
        default:
          return `Entregada a las ${hora} por ${quien}.`;
      }
    }
    case 'terminada':
      return `Terminada: llega hacia las ${e.llegaAproxAt ? horaEnReloj(e.llegaAproxAt, timezone) : '?'} con ${firmaMotorizado(motorizado) || 'el motorizado'}.`;
    case 'cancelada':
      return `Cancelada: ${e.incidenciaDetalle ?? 'el cliente no la quiso'}.`;
    case 'incidencia':
      if (e.segundaVisitaPedidaAt && !e.requiereHumano) {
        if (e.motorizadoProximoAt) return 'El motorizado pasó y no había nadie; se le va a preguntar al cliente si volvemos hoy en cuanto el ritmo del número lo permita.';
        return `El motorizado pasó y no había nadie; se le preguntó al cliente si volvemos hoy (se espera su respuesta hasta las ${e.segundaVisitaVenceAt ? horaEnReloj(e.segundaVisitaVenceAt, timezone) : '?'}).`;
      }
      return `Necesita una persona: ${e.incidenciaDetalle ?? e.incidencia ?? 'incidencia'}.`;
    default:
      return e.estado;
  }
}

function accionesDe(e: Entrega): string[] {
  const acciones: string[] = [];
  if (e.estado === 'terminada' || e.estado === 'cancelada' || e.estado === 'entregada') return acciones;
  if (e.envioRetenidoAt) acciones.push('confirmar_envio');
  if (e.ubicacionEstado === 'pendiente') acciones.push('poner_ubicacion');
  if (e.confirmacionEstado === 'pendiente' || e.confirmacionEstado === 'pedida') acciones.push('confirmar', 'no_confirmar');
  if (['lista', 'esperando_motorizado', 'avisada'].includes(e.estado)) acciones.push('reasignar');
  // «Asignar motorizado sin ubicación»: espera la ubicación y todavía no lo lleva nadie.
  if (e.ubicacionEstado === 'pendiente' && !e.envioRetenidoAt && !(e.motorizadoId && (e.motorizadoEstado === 'enviado' || e.motorizadoEstado === 'respondio'))) acciones.push('sin_ubicacion');
  if (e.estado === 'avisada' || (e.estado === 'esperando_motorizado' && e.motorizadoEstado === 'respondio') || (e.estado === 'incidencia' && e.motorizadoId && ['no_entregado', 'no_llego', 'aviso_no_enviado'].includes(e.incidencia ?? ''))) acciones.push('marcar_entregada');
  if (e.estado === 'incidencia') acciones.push('reintentar');
  // La segunda visita a mano: cuando el motorizado no pudo entregar y todavia no se hizo una.
  if (e.estado === 'incidencia' && ['no_entregado', 'no_llego', 'reprogramar'].includes(e.incidencia ?? '') && !e.segundaVisita) acciones.push('segunda_visita');
  acciones.push('prioridad');
  acciones.push('cancelar');
  return acciones;
}

/** Los botones SI / NO de la pregunta de confirmar y de la segunda visita: el id lleva la entrega. */
const botonesConfirmacion = (e: Entrega) => [
  { id: `entrega:si:${e.id}`, title: 'Sí, recibo hoy' },
  { id: `entrega:no:${e.id}`, title: 'No' },
];
const botonesSegundaVisita = (e: Entrega) => [
  { id: `entrega:si2:${e.id}`, title: 'Sí, vuelvan hoy' },
  { id: `entrega:no2:${e.id}`, title: 'No, otro día' },
];

/** Las frases de la lista de "no" que son cancelar de verdad (y no "hoy no"). */
const CANCELA_FUERTE = new Set(['ya no', 'ya no quiero', 'ya no lo quiero', 'no lo quiero', 'no quiero', 'cancela', 'cancelar', 'cancelen', 'cancelenlo', 'cancelalo', 'cancelado', 'anula', 'anular', 'anulen', 'anulalo', 'no me interesa', 'no lo necesito', 'no lo voy a querer', 'me arrepenti', 'no pedi', 'no pedi nada', 'no he pedido', 'yo no pedi', 'no es mio', 'no soy yo', 'se equivocaron', 'numero equivocado', 'no compre', 'ya compre en otro lado', 'ya lo compre']);

const ESTADOS_FINALES: EstadoEntrega[] = ['entregada', 'terminada', 'cancelada'];

/**
 * Las incidencias que eran SOLO por no tener la ubicacion: cuando el cliente
 * manda su pin, la entrega sale de «necesita a alguien» y sigue sola. Las
 * demas («no soy yo», baja, un cambio...) las sigue viendo una persona.
 */
const LIBERA_CON_PIN = new Set(['sin_ubicacion', 'sin_respuesta', 'respondio_sin_ubicacion', 'consulta_ajena', 'ya_en_curso', 'ubicacion_fuera_de_zona', 'sin_whatsapp', 'envio_bloqueado', 'error_envio']);

/** «No soy yo»: la incidencia con la que se aparta el pedido (y lo que cuenta la bitacora). */
const INCIDENCIA_NO_SOY_YO = 'no_soy_yo';

export async function crearServicioEntregas(deps: DepsEntregas): Promise<ServicioEntregas> {
  const { repos, repo, sender } = deps;
  /** Los avisos «ya no lo llevas tú» que van en camino (ver `avisarCancelado`). */
  const avisosCanceladoEnCamino = new Set<string>();
  const log = deps.log ?? (() => undefined);
  const ahora = deps.ahora ?? (() => new Date());
  const zonaBase = deps.timezone ?? 'America/Lima';
  /** La zona horaria de cada momento: la de Ajustes si la hay, si no la de arranque. */
  const tz = (): string => (deps.zonaHoraria ? deps.zonaHoraria() || zonaBase : zonaBase);
  const plan = deps.plan ?? PLANES.peru!;

  let ajustes: AjustesEntregas = AJUSTES_ENTREGAS_POR_DEFECTO;
  // El marcapasos del numero deja pasar los mensajes de las entregas hasta
  // el horario extendido: sin esto, a las 20:00 se frenaban los pines.
  deps.ampliarHorario?.(() => ({ desde: ajustes.horarioEntregas.desde, hasta: ajustes.horarioEntregas.extendidoHasta }));
  let ultimaSync: ResultadoSincronizacion | null = null;
  let ultimoCierre: ResultadoCierre | null = null;
  let motor: { proximoEnvioEn(): number; parado(): string | null; enHorario(): boolean } | null = null;
  /** Pedido:motorizado que ya quedó anotado como «sin otro a quien pasárselo» (para no repetir la nota en cada vuelta). */
  const sinOtroAvisados = new Set<string>();

  async function recargar(): Promise<void> {
    ajustes = AJUSTES_ENTREGAS_POR_DEFECTO;
    ultimoCierre = null;
    for (const row of await deps.settingsRepo.getAll()) {
      if (row.key === CLAVE_AJUSTES) {
        try {
          ajustes = ajustesEntregasSchema.parse(JSON.parse(row.value));
        } catch {
          log('los ajustes de entregas guardados no se pudieron leer: se usan los de siempre');
        }
      }
      if (row.key === CLAVE_CIERRE) {
        try {
          const v = JSON.parse(row.value) as ResultadoCierre;
          if (v && typeof v.dia === 'string') ultimoCierre = { dia: v.dia, cuando: String(v.cuando ?? ''), sinTerminar: Array.isArray(v.sinTerminar) ? v.sinTerminar.map(String) : [], dadasPorEntregadas: Array.isArray(v.dadasPorEntregadas) ? v.dadasPorEntregadas.map(String) : [], quien: String(v.quien ?? 'motor') };
        } catch {
          log('el último cierre del día guardado no se pudo leer');
        }
      }
    }
  }
  await recargar();

  /** La hora local (0-23) en el reloj del negocio. */
  const horaLocal = (): number => {
    try {
      return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz(), hour: '2-digit', hour12: false }).format(ahora()).slice(0, 2)) % 24;
    } catch {
      return ahora().getHours();
    }
  };

  const hoy = (): string => {
    try {
      const partes = new Intl.DateTimeFormat('en-CA', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora());
      return partes.slice(0, 10);
    } catch {
      return ahora().toISOString().slice(0, 10);
    }
  };

  const ia = (): LectorIA | null => (ajustes.leerConIA ? (deps.ia?.() ?? null) : null);

  /** «Solo lo de GSG»: la IA no redacta nada para el cliente (solo clasifica). */
  const modoGsg = (): boolean => (deps.modo?.() ?? 'completo') === 'gsg';
  /** La regla del dueño: tras UBI REGISTRADA (o el cierre) no se le escribe más al cliente. */
  const reglaGsgActiva = (): boolean => modoGsg() && ajustes.silencioTrasUbi !== false;

  /**
   * El numero que se le da al cliente ({telefonoMotorizado}): el del
   * motorizado asignado a ese pedido; si no, el que GSG mando con el pedido;
   * si no, el de soporte; si tampoco, el del WhatsApp de la tienda. Nunca vacio.
   */
  function numeroParaCliente(e: Entrega | null, m: Motorizado | null | undefined): string {
    const t = (x?: string | null): string => (x ? telefonoEnPalabras(x) : '');
    // Nunca el número del propio WhatsApp: el cliente lo leería como el del
    // motorizado. Sin motorizado ni soporte, vacío (la frase se quita).
    return t(m?.phone) || t(e?.datosEnvio?.telefonoMotorizado) || t(ajustes.soporte.whatsapp) || t(ajustes.soporte.llamadas) || '';
  }

  const contexto = (e: Entrega, m?: Motorizado | null): ContextoTexto => ({
    nombre: e.nombre,
    pedido: e.referencia,
    negocio: deps.nombreNegocio(),
    direccion: e.direccion,
    distrito: e.distrito,
    mapa: e.lat != null && e.lng != null ? enlaceMapa(e.lat, e.lng) : e.mapsUrl,
    lat: e.lat,
    lng: e.lng,
    minutos: e.minutosAviso,
    hora: e.llegaAproxAt ? horaEnReloj(e.llegaAproxAt, tz()) : null,
    faltan: faltanPara(e.llegaAproxAt),
    motorizado: m ? firmaMotorizado(m) : null,
    placa: m?.placa ?? null,
    minutosMotorizado: e.minutosMotorizado,
    horaLimite: horaEnPalabras(ajustes.cambioUbicacionHasta),
    notas: e.notas,
    horaEntregada: e.entregadaAt ? horaEnReloj(e.entregadaAt, tz()) : null,
    situacion: situacionDe(e, m ?? null, ajustes, tz(), reglaGsgActiva()),
    urgente: e.prioridad === 'urgente',
    desde: horaEnPalabras(ajustes.horarioEntregas.desde),
    hasta: horaEnPalabras(ajustes.horarioEntregas.hasta),
    hastaExtendido: horaEnPalabras(ajustes.horarioEntregas.extendidoHasta),
    soporte: soporteEnPalabras(ajustes.soporte),
    telefonoMotorizado: numeroParaCliente(e, m),
    telefonoCliente: telefonoEnPalabras(e.phone),
    envio: e.datosEnvio ?? null,
  });

  /** " (faltan unos 25 min)" hasta la hora de llegada; vacio si ya paso o falta menos de 3 min. */
  function faltanPara(llega: Date | null): string {
    if (!llega) return '';
    const min = Math.round((llega.getTime() - ahora().getTime()) / 60_000);
    return min >= 3 ? ` (faltan unos ${minutosEnPalabras(min)})` : '';
  }

  /**
   * El «ubicación registrada» para un cliente que NO tiene entrega de hoy (el
   * chat normal en modo GSG): mismo texto, con su nombre y su enlace.
   */
  function textoUbicacionRegistrada(datos: { nombre?: string | null; mapa?: string | null }): string {
    return textoDe('ubicacionRegistrada', ajustes, {
      nombre: datos.nombre ?? null,
      negocio: deps.nombreNegocio(),
      mapa: datos.mapa ?? null,
      desde: horaEnPalabras(ajustes.horarioEntregas.desde),
      hasta: horaEnPalabras(ajustes.horarioEntregas.hasta),
      hastaExtendido: horaEnPalabras(ajustes.horarioEntregas.extendidoHasta),
      soporte: soporteEnPalabras(ajustes.soporte),
      telefonoMotorizado: numeroParaCliente(null, null),
    });
  }

  /** La entrega tal como viaja por el bus (webhooks salientes). */
  function emitir(nombre: 'entrega.confirmada' | 'entrega.avisada' | 'entrega.entregada' | 'entrega.incidencia', e: Entrega, m?: Motorizado | null): void {
    if (!deps.bus) return;
    const payload: EventoEntregaDelDia = {
      entrega: {
        id: e.id,
        referencia: e.referencia,
        telefono: e.phone,
        nombre: e.nombre,
        estado: e.estado,
        lat: e.lat,
        lng: e.lng,
        motorizado: m ? { nombre: m.nombre, telefono: m.phone } : null,
        minutosAviso: e.minutosAviso,
        llegaAproxEn: e.llegaAproxAt?.toISOString() ?? null,
        entregadoEn: e.entregadaAt?.toISOString() ?? null,
        incidencia: e.incidencia,
        incidenciaDetalle: e.incidenciaDetalle,
      },
      fecha: ahora().toISOString(),
    };
    try {
      deps.bus.emitir(nombre, payload);
    } catch (error) {
      log('no se pudo anunciar el evento de la entrega', { nombre, detalle: error instanceof Error ? error.message : String(error) });
    }
  }

  const motorizadoDe = async (e: Entrega): Promise<Motorizado | null> => (e.motorizadoId ? await repo.motorizado(e.motorizadoId) : null);

  async function evento(e: Entrega | number, tipo: Parameters<EntregasRepo['registrarEvento']>[1], detalle?: string | null, payload?: Record<string, unknown> | null): Promise<void> {
    await repo.registrarEvento(typeof e === 'number' ? e : e.id, tipo, detalle ?? null, payload ?? null, ahora());
  }

  /** El estado general que le corresponde a lo que tiene. Los finales no se tocan. */
  function estadoQueToca(e: Entrega): EstadoEntrega {
    if (e.estado === 'terminada' || e.estado === 'cancelada' || e.estado === 'incidencia' || e.estado === 'entregada') return e.estado;
    // Con motorizado sin ubicación (el cierre le dio su número): sigue el camino del motorizado.
    if (e.ubicacionEstado === 'pendiente' && !e.motorizadoSinUbicacionAt) return 'esperando_ubicacion';
    if (e.confirmacionEstado === 'rechazada') return 'cancelada';
    if (e.confirmacionEstado === 'pendiente' || e.confirmacionEstado === 'pedida') return 'esperando_confirmacion';
    if (e.motorizadoEstado === 'sin_asignar') return 'lista';
    if (e.motorizadoEstado === 'enviado') return 'esperando_motorizado';
    if (e.motorizadoEstado === 'respondio') return e.avisoEnviadoAt ? (e.terminadaGsgAt ? 'terminada' : 'avisada') : 'esperando_motorizado';
    return 'lista';
  }

  async function recalcular(e: Entrega): Promise<Entrega> {
    const estado = estadoQueToca(e);
    if (estado === e.estado) return e;
    return (await repo.actualizar(e.id, { estado })) ?? e;
  }

  /**
   * Manda un texto a alguien respetando la regla de Meta: dentro de la
   * ventana de 24 h (o con el cliente no oficial), texto libre; fuera, la
   * plantilla configurada para ese caso; sin plantilla, no se manda y se
   * dice por que (`sinPlantilla`), para que la entrega se aparte con una
   * incidencia en vez de reintentar a ciegas cada cinco segundos.
   */
  async function enviarA(
    phone: string,
    texto: string,
    plantilla: keyof AjustesEntregas['plantillas'],
    variables: string[],
    limites: { separacionMs: number; maxPorDia: number },
    botones?: Array<{ id: string; title: string }>,
    /** La pregunta SÍ/NO a los de «falta confirmar»: la regla del dueño la deja pasar. */
    opts: { conReglaGsg?: boolean } = {},
  ): Promise<Awaited<ReturnType<Sender['send']>> | { ok: false; sinPlantilla: true; reason: string }> {
    // Regla del dueño («Solo lo de GSG»): al cliente solo se le pide la
    // ubicación (eso lo manda el reparto), se le explica por qué, se le da UBI
    // REGISTRADA o el cierre. Ni confirmación, ni hora de llegada, ni «cerca»,
    // ni «entregado», ni cambios de motorizado: no sale, pero se da por hecho
    // para que todo lo de dentro (motorizado, reportes a GSG) siga igual.
    if (plantilla !== 'motorizado' && reglaGsgActiva() && !opts.conReglaGsg) {
      log('regla del dueño: al cliente no se le escribe esto en «Solo lo de GSG»', { phone, plantilla, texto: texto.slice(0, 60) });
      return { ok: true, wamid: `regla-gsg:${randomBytes(6).toString('hex')}`, deliveryId: -1 };
    }
    const base = { phone, category: 'UTILITY' as const, origen: 'sistema', limitesContacto: limites };
    // Texto libre: con botones SI / NO si el ajuste lo dice y el WhatsApp
    // puede; si el proveedor los rechaza, sale el mismo texto sin botones.
    // Nunca se queda sin mandar por culpa de un boton.
    const libre = async () => {
      if (botones?.length && ajustes.usarBotones) {
        const r = await sender.send({ ...base, kind: 'interactive', interactive: { body: texto, buttons: botones } });
        // Un fallo pasajero (ritmo, red, 429) no es culpa del boton: se devuelve
        // tal cual para que quien llama lo reintente; solo el rechazo definitivo
        // de los botones cae al texto.
        if (r.ok || r.blocked || r.retryable) return r;
        log('los botones no salieron: el mismo texto va sin botones', { detalle: r.error });
        return sender.send({ ...base, kind: 'freeform', text: texto });
      }
      return sender.send({ ...base, kind: 'freeform', text: texto });
    };
    if (!deps.usarPlantilla?.()) return libre();
    const contacto = await repos.contacts.getByPhone(phone).catch(() => null);
    const ventanaAbierta = Boolean(contacto?.lastInboundAt && ahora().getTime() - contacto.lastInboundAt.getTime() < 24 * 60 * 60 * 1000);
    if (ventanaAbierta) return libre();
    const nombre = ajustes.plantillas[plantilla];
    if (!nombre) {
      return { ok: false, sinPlantilla: true, reason: `con la API de Meta hace falta una plantilla aprobada para escribirle fuera de la ventana de 24 h: elige una en Entregas del día → Ajustes → Plantillas (${plantilla})` };
    }
    const registrada = await repos.templates.get(nombre, 'es').catch(() => null);
    const cuantas = registrada?.variables ?? variables.length;
    return sender.send({ ...base, kind: 'template', templateName: nombre, templateLanguage: registrada?.language ?? 'es', variables: variables.slice(0, Math.max(0, cuantas)) });
  }

  /**
   * Si un envío al cliente que «salió bien» en realidad NO salió porque lo
   * frenó la regla del dueño (enviarA en «Solo lo de GSG», o la puerta del
   * sender con el silencio tras UBI): el motivo en palabras. null = salió de
   * verdad. Así la bitácora no dice «avisado al cliente» cuando no se le
   * escribió (28/09, GSG-IA-001).
   */
  async function noSalioAlCliente(phone: string, salida: { ok: boolean; wamid?: string }): Promise<string | null> {
    const wamid = salida.ok ? String(salida.wamid ?? '') : '';
    if (!wamid.startsWith('regla-gsg:') && !wamid.startsWith('silencio:')) return null;
    const c = await repos.contacts.getByPhone(phone).catch(() => null);
    const motivo = String(c?.iaCerradaMotivo ?? '');
    if (wamid.startsWith('silencio:') || motivo.startsWith('ubicación registrada')) return 'silencio tras ubicación registrada';
    if (c?.iaCerradaAt) return 'silencio tras el cierre del chat';
    return '«Solo lo de GSG»: al cliente solo se le pide la ubicación';
  }

  const variablesCliente = (e: Entrega): string[] => [(e.nombre ?? '').trim().split(/\s+/)[0] || 'buenas tardes', e.referencia, deps.nombreNegocio()];

  /**
   * `sobre`: los numeros de los que trata el aviso. Si todos son del Modulo
   * desarrollador (clientes o motorizados de prueba), no se molesta a la
   * persona real: lo de prueba se mira en su pantalla.
   */
  async function avisarSupervisor(texto: string, sobre: Array<string | null | undefined> = []): Promise<void> {
    if (sobre.length && sobre.every((t) => esNumeroDePrueba(t))) return;
    const destino = deps.supervisor?.();
    if (!destino) return;
    await sender.send({ phone: destino, kind: 'freeform', category: 'UTILITY', text: texto, manual: true, origen: 'sistema' }).catch(() => undefined);
  }

  async function marcarIncidencia(e: Entrega, codigo: string, detalle: string, opts: { avisar?: boolean; cerradaPorDia?: boolean } = {}): Promise<Entrega> {
    const actualizada = (await repo.actualizar(e.id, { estado: 'incidencia', incidencia: codigo, incidenciaDetalle: detalle, requiereHumano: true, ...(opts.cerradaPorDia ? { cerradaPorDia: true } : {}) })) ?? e;
    await evento(e, 'incidencia', `${codigo}: ${detalle}`);
    if (opts.avisar ?? true) {
      const quien = e.nombre ? `${e.nombre} (${e.phone})` : e.phone;
      await avisarSupervisor(`Entrega ${e.referencia} de ${quien}: ${detalle}. Mírala en ${(deps.publicBaseUrl ?? '').replace(/\/+$/, '')}/hoy`, [e.phone]);
    }
    emitir('entrega.incidencia', actualizada, await motorizadoDe(actualizada));
    return actualizada;
  }

  /** El reporte de entrega para GSG con todo lo que se sabe de ella. */
  const payloadEntregaDe = (e: Entrega, m: Motorizado | null, extra: { entregadoAt?: Date | null; entregadaComo?: string | null; incidencia?: string | null } = {}): Record<string, unknown> =>
    payloadEntrega({
      referencia: e.referencia,
      phone: e.phone,
      nombre: e.nombre,
      lat: e.lat,
      lng: e.lng,
      motorizado: m ? { phone: m.phone, nombre: m.nombre, placa: m.placa } : null,
      minutosMotorizado: e.minutosMotorizado,
      margenMinutos: ajustes.margenMinutos,
      minutosAviso: e.minutosAviso,
      llegaAproxAt: e.llegaAproxAt,
      avisadoAt: e.avisoEnviadoAt,
      // El cierre manda entregadoEn null a proposito: nadie dijo la hora.
      entregadoAt: 'entregadoAt' in extra ? (extra.entregadoAt ?? null) : (e.entregadaAt ?? null),
      entregadaComo: extra.entregadaComo ?? e.entregadaComo ?? null,
      incidencia: extra.incidencia ?? null,
      prioridad: e.prioridad,
      visitas: e.visitas,
      segundaVisita: e.segundaVisita,
    });

  async function reportar(e: Entrega, tipo: 'confirmacion' | 'entrega' | 'ubicacion', payload: Record<string, unknown>): Promise<void> {
    await repos.rutas.encolarReporte({ solicitudId: null, loteId: e.loteId ?? null, tipo, payload });
    await evento(e, 'reporte', `encolado para GSG: ${tipo}`);
    // La ubicacion sale YA, como en el reparto (rutas/inbound.ts): con el pin
    // confirmado a mano o por el SI del pin lejano esperaba a la pasada de
    // cada minuto. Un fallo se queda en la cola y lo reintenta esa pasada.
    if (tipo === 'ubicacion') {
      void despacharReportes({ rutas: repos.rutas }, deps.gsg, 25, ['ubicacion']).catch(() => undefined);
    }
  }

  // ------------------------------------------------- la lista recibida

  function leerCliente(c: ClienteGsg): { ok: true; phone: string; referencia: string } | { ok: false; motivo: string } {
    const referencia = String(c.referencia ?? '').trim();
    if (!referencia) return { ok: false, motivo: 'sin referencia' };
    const revision = revisarTelefono(String(c.telefono ?? ''), plan);
    if (!revision.ok) return { ok: false, motivo: `teléfono inválido: ${revision.detalle}` };
    return { ok: true, phone: revision.phone, referencia };
  }

  async function recibirListaGsg(recibido: PendientesGsg): Promise<ResultadoSincronizacion> {
    const dia = hoy();
    const at = ahora().toISOString();
    const base: ResultadoSincronizacion = { ok: false, detalle: '', dia, nuevas: 0, actualizadas: 0, ubicacionesPedidas: 0, confirmacionesPendientes: 0, terminadas: 0, lote: null, at };
    const cuerpo: PendientesGsg = recibido && typeof recibido === 'object' ? recibido : {};
    // Lo que no se puede usar queda apuntado (Conexión → GSG y la campana).
    await deps.conexionGsg?.extras.observarPendientes(cuerpo).catch((error) => log('no se pudieron apuntar los descartes de GSG', { detalle: String(error) }));
    const diaGsg = typeof cuerpo.dia === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cuerpo.dia) ? cuerpo.dia : dia;
    const resultado: ResultadoSincronizacion = { ...base, ok: true, dia: diaGsg };

    const tocadas = new Map<number, Entrega>();

    // «Revisar y confirmar antes de enviar»: lo nuevo espera el visto bueno de una persona.
    const retener = ajustes.confirmarListaGsg !== false;
    const upsert = async (c: ClienteGsg, que: 'ubicacion' | 'confirmacion'): Promise<Entrega | null> => {
      // Lo que GSG manda ya cancelado no se crea; si existia, lo cancela el paso de abajo.
      if (c.cancelado === true) return null;
      const lectura = leerCliente(c);
      if (!lectura.ok) {
        log('GSG mandó un cliente que no se puede usar', { referencia: c.referencia, motivo: lectura.motivo });
        return null;
      }
      const conPin = typeof c.lat === 'number' && typeof c.lng === 'number' && Number.isFinite(c.lat) && Number.isFinite(c.lng);
      const { entrega, nueva } = await repo.crearEntrega({
        dia: diaGsg,
        referencia: lectura.referencia,
        externoId: c.id != null ? String(c.id) : null,
        phone: lectura.phone,
        nombre: c.nombre ?? null,
        direccion: c.direccion ?? null,
        distrito: c.distrito ?? null,
        notas: c.notas ?? null,
        // «Falta confirmar»: GSG ya tiene su dirección; se le pregunta SÍ/NO, nunca la ubicación.
        ubicacionEstado: que === 'ubicacion' ? 'pendiente' : conPin ? 'recibida' : 'no_hace_falta',
        lat: conPin ? c.lat! : null,
        lng: conPin ? c.lng! : null,
        confirmacionEstado: que === 'confirmacion' ? 'pendiente' : 'no_hace_falta',
        estado: 'pendiente',
        prioridad: c.urgente === true ? 'urgente' : 'normal',
        datosEnvio: datosEnvioDeCrudo(c),
        envioRetenidoAt: retener ? ahora() : null,
      });
      let e = entrega;
      if (!nueva) {
        // Los datos del envio (producto, empresa, monto...) se reflejan tal
        // cual los mande GSG: lo que llega manda, lo que no llega no borra.
        const datos = fusionarDatosEnvio(e.datosEnvio, datosEnvioDeCrudo(c));
        if (datos && !ESTADOS_FINALES.includes(e.estado)) e = (await repo.actualizar(e.id, { datosEnvio: datos })) ?? e;
      }
      if (nueva) {
        resultado.nuevas++;
        if (e.envioRetenidoAt) resultado.retenidas = (resultado.retenidas ?? 0) + 1;
        if (conPin && que !== 'ubicacion') e = (await repo.actualizar(e.id, { ubicacionFuente: 'gsg', ubicacionAt: ahora(), mapsUrl: enlaceMapa(c.lat!, c.lng!) })) ?? e;
        await evento(e, 'sincronizada', `llegó de GSG: falta ${que === 'ubicacion' ? 'la ubicación' : 'confirmar'}`);
      } else {
        // Ya la teniamos: GSG puede decir ahora que ademas falta lo otro.
        const patch: Partial<Entrega> = {};
        if (que === 'ubicacion' && e.ubicacionEstado === 'no_hace_falta') patch.ubicacionEstado = 'pendiente';
        if (que === 'confirmacion' && e.confirmacionEstado === 'no_hace_falta') patch.confirmacionEstado = 'pendiente';
        // GSG la sube a urgente cuando quiere; bajarla es cosa de una persona.
        if (c.urgente === true && e.prioridad !== 'urgente') patch.prioridad = 'urgente';
        // El espejo: si GSG cambio la direccion, el distrito o el telefono de
        // un pedido vivo, aqui se refleja y queda apuntado. Un campo vacio no
        // borra nada.
        if (!ESTADOS_FINALES.includes(e.estado)) {
          const cambios: string[] = [];
          const direccion = (c.direccion ?? '').trim();
          if (direccion && direccion !== (e.direccion ?? '').trim()) {
            patch.direccion = direccion;
            cambios.push(`dirección «${e.direccion ?? '—'}» → «${direccion}»`);
          }
          const distrito = (c.distrito ?? '').trim();
          if (distrito && distrito !== (e.distrito ?? '').trim()) {
            patch.distrito = distrito;
            cambios.push(`distrito «${e.distrito ?? '—'}» → «${distrito}»`);
          }
          if (lectura.phone !== e.phone) {
            patch.phone = lectura.phone;
            cambios.push(`teléfono ${e.phone} → ${lectura.phone}`);
            // Al numero viejo ya no se le pide nada: su solicitud del reparto se
            // cierra y la ubicacion se vuelve a encaminar con el nuevo.
            if (e.loteId && e.ubicacionEstado === 'pendiente') {
              const abiertas = await repos.rutas.listarSolicitudes({ loteId: e.loteId, q: e.phone, limit: 5, offset: 0 }).catch(() => []);
              for (const sol of abiertas) {
                if (sol.phone === e.phone && ['pendiente', 'enviado', 'respondio'].includes(sol.estado)) await repos.rutas.actualizarSolicitud(sol.id, { estado: 'cancelado', incidencia: 'numero_equivocado', incidenciaDetalle: 'GSG cambió el teléfono del pedido' }).catch(() => undefined);
              }
              patch.loteId = null;
            }
          }
          if (cambios.length) {
            resultado.cambiadas = (resultado.cambiadas ?? 0) + 1;
            await evento(e, 'sincronizada', `GSG cambió: ${cambios.join('; ')}`);
            // El motorizado que ya lo lleva se entera del cambio de direccion.
            if ((patch.direccion || patch.distrito) && e.motorizadoId && (e.motorizadoEstado === 'enviado' || e.motorizadoEstado === 'respondio')) {
              const m = await repo.motorizado(e.motorizadoId);
              if (m) await sender.send({ phone: m.phone, kind: 'freeform', category: 'UTILITY', origen: 'sistema', text: `📍 ${e.referencia} (${e.nombre ?? e.phone}): GSG cambió la dirección a «${patch.direccion ?? e.direccion ?? ''}${patch.distrito ? `, ${patch.distrito}` : ''}». El pin sigue siendo el del cliente.`, limitesContacto: { separacionMs: 0, maxPorDia: 500 } }).catch(() => undefined);
            }
          }
        }
        if (que === 'confirmacion' && conPin && e.ubicacionEstado === 'pendiente' && e.lat == null) {
          patch.ubicacionEstado = 'recibida';
          patch.lat = c.lat!;
          patch.lng = c.lng!;
          patch.ubicacionFuente = 'gsg';
          patch.ubicacionAt = ahora();
          patch.mapsUrl = enlaceMapa(c.lat!, c.lng!);
        }
        if (Object.keys(patch).length) {
          e = (await repo.actualizar(e.id, patch)) ?? e;
          resultado.actualizadas++;
          await evento(e, 'sincronizada', `GSG añadió: falta ${que === 'ubicacion' ? 'la ubicación' : 'confirmar'}`);
        }
      }
      tocadas.set(e.id, e);
      return e;
    };

    for (const c of cuerpo.faltaUbicacion ?? []) await upsert(c, 'ubicacion');
    for (const c of cuerpo.faltaConfirmacion ?? []) await upsert(c, 'confirmacion');

    // Lo que GSG ya da por terminado.
    for (const t of cuerpo.terminados ?? []) {
      const referencia = String((t as { referencia?: unknown }).referencia ?? '').trim();
      if (!referencia) continue;
      const e = await repo.porDiaYReferencia(diaGsg, referencia);
      if (!e || e.terminadaGsgAt) continue;
      const patch: Partial<Entrega> = { terminadaGsgAt: ahora() };
      if (e.estado === 'avisada') patch.estado = 'terminada';
      const act = (await repo.actualizar(e.id, patch)) ?? e;
      await evento(act, 'terminada', 'GSG la pasó a terminados');
      resultado.terminadas++;
      tocadas.set(act.id, act);
    }

    // Lo que GSG cancelo: en una lista (`cancelados`) o marcado en el pedido
    // (`cancelado: true`). Solo referencias explicitas: una lista vacia o un
    // pedido que simplemente ya no viene NO cancela nada.
    const canceladasGsg = new Map<string, string>();
    for (const c of [...(cuerpo.faltaUbicacion ?? []), ...(cuerpo.faltaConfirmacion ?? [])]) if (c.cancelado === true) canceladasGsg.set(String(c.referencia ?? '').trim(), String(c.motivoCancelacion ?? '').trim());
    for (const t of Array.isArray(cuerpo.cancelados) ? cuerpo.cancelados : []) {
      const ref = typeof t === 'string' ? t : String(t.referencia ?? '');
      const motivo = typeof t === 'string' ? '' : String(t.motivoCancelacion ?? t.motivo ?? '').trim();
      if (ref.trim()) canceladasGsg.set(ref.trim(), motivo || canceladasGsg.get(ref.trim()) || '');
    }
    canceladasGsg.delete('');
    for (const [ref, motivo] of canceladasGsg) {
      const e = await repo.porDiaYReferencia(diaGsg, ref);
      if (!e || ESTADOS_FINALES.includes(e.estado)) continue;
      const teniaHora = e.estado === 'avisada' || e.llegaAproxAt != null;
      await avisarMotorizadoQueSeCancela(e);
      const act = (await repo.actualizar(e.id, { estado: 'cancelada', confirmacionEstado: e.confirmacionEstado === 'confirmada' ? 'confirmada' : 'rechazada', confirmacionProximoAt: null, motorizadoProximoAt: null, requiereHumano: false, incidencia: 'cancela', incidenciaDetalle: motivo ? `GSG lo canceló: ${motivo}` : 'GSG lo canceló' })) ?? e;
      await evento(act, 'rechazada', motivo ? `GSG lo canceló (${motivo}): se cancela aquí también` : 'GSG lo canceló: se cancela aquí también');
      // Ya no se le pide la ubicacion por este pedido (ni recordatorios).
      await soltarDeLaEntrega(act, `GSG canceló el pedido ${act.referencia}`);
      if (teniaHora) {
        const salida = await enviarA(act.phone, textoDe('clienteCanceladoGsg', ajustes, contexto(act)), 'aviso', [act.nombre ?? '', act.referencia, ''], { separacionMs: 0, maxPorDia: 20 });
        const callado = await noSalioAlCliente(act.phone, salida);
        await evento(act, 'nota', callado ? `al cliente NO se le escribió que GSG canceló su pedido (${callado})` : salida.ok ? 'al cliente se le avisó que GSG canceló su pedido' : `no se pudo avisar al cliente de la cancelación: ${'reason' in salida ? salida.reason : salida.error}`);
      }
      resultado.canceladas = (resultado.canceladas ?? 0) + 1;
      tocadas.set(act.id, act);
    }

    // Las que necesitan ubicacion y todavia no estan en un lote del reparto
    // (lo que espera confirmar el envio, no: sale al confirmarlo).
    const encaminado = await encaminarUbicaciones([...tocadas.values()], `Entregas GSG ${diaGsg} · ${horaEnReloj(ahora(), tz())}`, 'gsg', `gsg-entregas:${diaGsg}:${Date.now()}`, 'Cargado de la lista de GSG (Entregas del día).');
    for (const act of encaminado.entregas) tocadas.set(act.id, act);
    resultado.lote = encaminado.lote;
    resultado.ubicacionesPedidas += encaminado.pedidas;
    if (encaminado.error) resultado.detalle = `No se pudo cargar el lote del reparto: ${encaminado.error}. `;

    // Consentimiento de quien solo tiene que confirmar: dejo su telefono para
    // coordinar la entrega; eso es el consentimiento, y queda apuntado.
    for (const e of tocadas.values()) {
      if (e.confirmacionEstado !== 'pendiente') continue;
      const previo = await repos.contacts.getByPhone(e.phone);
      if (previo?.optOutAt) {
        await marcarIncidencia(e, 'rechaza_contacto', 'el cliente se dio de baja antes: no se le escribe; coordinar por teléfono', { avisar: false });
        await reportar(e, 'confirmacion', payloadConfirmacion({ referencia: e.referencia, phone: e.phone, nombre: e.nombre, confirmada: false, respuesta: null, como: null, motivo: 'baja', en: ahora() }));
        continue;
      }
      const contacto = await repos.contacts.upsertFromInbound(e.phone, e.nombre ?? undefined);
      if (!contacto.optInAt) await repos.contacts.setOptIn(e.phone, `entrega: pedido ${e.referencia} (GSG ${diaGsg})`);
      // Las que se pueden pedir ya (tienen ubicacion); a las demas se les pide
      // cuando manden el pin, pegado al gracias.
      if (e.ubicacionEstado !== 'pendiente' && !e.envioRetenidoAt) resultado.confirmacionesPendientes++;
    }

    for (const e of tocadas.values()) {
      const fresca = await repo.entrega(e.id);
      if (fresca) await recalcular(fresca);
    }

    resultado.detalle += `Lista recibida: ${resultado.nuevas} nuevas, ${resultado.actualizadas} actualizadas, ${resultado.ubicacionesPedidas} al reparto para pedir ubicación, ${resultado.confirmacionesPendientes} por pedir confirmación ya, ${resultado.terminadas} terminadas${resultado.retenidas ? `, ${resultado.retenidas} esperan que confirmes el envío en Números del día` : ''}${resultado.canceladas ? `, ${resultado.canceladas} canceladas por GSG` : ''}${resultado.cambiadas ? `, ${resultado.cambiadas} con datos cambiados por GSG` : ''}.`;
    ultimaSync = resultado;
    return resultado;
  }

  /**
   * Las que necesitan ubicacion y todavia no estan en un lote del reparto: al
   * reparto (que la pide con su ritmo), salvo que el reparto ya se la pida por
   * otro lote o sea un cliente recurrente (se le propone su direccion). Lo que
   * espera confirmar el envio no se toca.
   */
  async function encaminarUbicaciones(lista: Entrega[], nombreLote: string, origen: 'gsg' | 'entregas', externoId?: string, notas?: string): Promise<{ entregas: Entrega[]; lote: ResultadoSincronizacion['lote']; pedidas: number; error?: string }> {
    const salida: Entrega[] = [];
    const paraLote: Array<{ telefono: string; nombre?: string; referencia?: string; direccion?: string; distrito?: string; notas?: string }> = [];
    const candidatas: Entrega[] = [];
    for (const e of lista) {
      if (e.ubicacionEstado !== 'pendiente' || e.loteId || e.envioRetenidoAt || e.estado === 'cancelada' || e.estado === 'terminada') continue;
      // Hoy ya mando su ubicacion (por otro pedido): vale la misma, no se le pide.
      const conocida = await aplicarUbicacionConocida(e);
      if (conocida) {
        salida.push(conocida);
        continue;
      }
      const abierta = await repos.rutas.abiertaPorTelefono(e.phone);
      if (abierta && ['pendiente', 'enviado', 'respondio', 'supervision'].includes(abierta.estado)) {
        // El reparto ya se lo esta pidiendo por otro lote: se apunta y listo.
        salida.push((await repo.actualizar(e.id, { loteId: abierta.loteId })) ?? e);
        await evento(e, 'nota', `el reparto ya le pide la ubicación (lote ${abierta.loteId})`);
        continue;
      }
      // Ya se le propuso su direccion (o esta por proponerse): no se repite
      // en cada lista que llega; si no contesta, revisarPropuestas la pasa al reparto.
      if (e.ubicacionPropuestaAt || e.ubicacionPropuestaLat != null) continue;
      // Cliente recurrente: ya nos mando su ubicacion hace poco. En vez de
      // pedirle el pin se le propone esa direccion; el motor le pregunta.
      const recurrente = await apuntarRecurrente(e, origen === 'gsg' ? `GSG ${e.dia}` : 'lista');
      if (recurrente) {
        salida.push(recurrente);
        continue;
      }
      candidatas.push(e);
      paraLote.push({ telefono: e.phone, nombre: e.nombre ?? undefined, referencia: e.referencia, direccion: e.direccion ?? undefined, distrito: e.distrito ?? undefined, notas: e.notas ?? undefined });
    }
    if (!paraLote.length) return { entregas: salida, lote: null, pedidas: 0 };
    try {
      const carga = await deps.cargarLote({ nombre: nombreLote, filas: paraLote, ...(externoId ? { externoId } : {}), origen, arrancar: true, ...(notas ? { notas } : {}) });
      let pedidas = 0;
      for (const sol of carga.solicitudes) {
        const e = candidatas.find((x) => x.phone === sol.phone && x.referencia === sol.referencia) ?? candidatas.find((x) => x.phone === sol.phone);
        if (!e) continue;
        const act = (await repo.actualizar(e.id, { loteId: carga.lote.id })) ?? e;
        await evento(act, 'nota', `entra en el lote del reparto "${carga.lote.nombre}" para pedirle la ubicación`);
        salida.push(act);
        pedidas++;
      }
      return { entregas: salida, lote: { id: carga.lote.id, nombre: carga.lote.nombre, total: carga.total }, pedidas };
    } catch (error) {
      log('no se pudo cargar el lote del reparto', { detalle: error instanceof Error ? error.message : String(error) });
      return { entregas: salida, lote: null, pedidas: 0, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Lo que espera confirmar el envio hoy (y si ya se confirmo otra tanda). */
  async function porConfirmarEnvio(): Promise<PorConfirmarEnvio> {
    const deHoy = await repo.listar({ dia: hoy(), limit: 2000 });
    const esperan = deHoy.filter((e) => e.envioRetenidoAt && !ESTADOS_FINALES.includes(e.estado));
    const confirmar = esperan.filter((e) => grupoDe(e) === 'confirmar').length;
    const ubicacion = esperan.length - confirmar;
    const mas = deHoy.some((e) => Boolean(e.envioLiberadoAt));
    return { total: esperan.length, ubicacion, confirmar, mas, aviso: avisoPorConfirmar(esperan.length, ubicacion, confirmar, mas) };
  }

  /**
   * «Confirmar y enviar»: lo que llego de GSG deja de esperar y pasa al
   * reparto con el ritmo seguro de siempre (el reparto pide la ubicacion; el
   * motor de entregas pregunta SÍ/NO a los de «falta confirmar»).
   */
  async function liberarEnvio(ids: number[] | 'todos', quien: string): Promise<ResultadoLiberar> {
    const deHoy = await repo.listar({ dia: hoy(), limit: 2000 });
    const lista = ids === 'todos' ? deHoy.filter((e) => e.envioRetenidoAt) : ((await Promise.all([...new Set(ids)].map((id) => repo.entrega(id)))).filter(Boolean) as Entrega[]);
    const en = ahora();
    const liberadas: Entrega[] = [];
    let saltadas = 0;
    for (const e of lista) {
      if (!e.envioRetenidoAt || ESTADOS_FINALES.includes(e.estado)) {
        saltadas++;
        continue;
      }
      const act = (await repo.actualizar(e.id, { envioRetenidoAt: null, envioLiberadoAt: en })) ?? e;
      await evento(act, 'nota', `${quien} confirmó el envío: ${grupoDe(act) === 'confirmar' ? 'se le pregunta SÍ o NO' : 'se le pide la ubicación'} con el ritmo de siempre`);
      liberadas.push(act);
    }
    const hora = horaEnReloj(en, tz());
    const encaminado = await encaminarUbicaciones(liberadas, `Entregas GSG ${hoy()} · ${hora} (envío confirmado)`, 'gsg', `gsg-entregas:${hoy()}:confirmado:${en.getTime()}`, `Envío confirmado por ${quien} en Números del día.`);
    const porId = new Map(encaminado.entregas.map((x) => [x.id, x]));
    for (const e of liberadas) {
      const fresca = (await repo.entrega(e.id)) ?? porId.get(e.id) ?? e;
      await recalcular(fresca);
    }
    const confirmar = liberadas.filter((e) => grupoDe(e) === 'confirmar').length;
    const ubicacion = liberadas.length - confirmar;
    const partes: string[] = [];
    if (liberadas.length) partes.push(`Envío confirmado a ${liberadas.length === 1 ? '1 número' : `${liberadas.length} números`}: ${ubicacion} para pedir ubicación · ${confirmar} para confirmar. Salen de uno en uno, con la pausa de siempre entre mensaje y mensaje.`);
    else partes.push('No había ningún número esperando que confirmes el envío.');
    if (saltadas) partes.push(`${saltadas} ya ${saltadas === 1 ? 'estaba enviado o cerrado' : 'estaban enviados o cerrados'} y se ${saltadas === 1 ? 'saltó' : 'saltaron'}.`);
    if (encaminado.error) partes.push(`Ojo: no se pudo pasar al reparto (${encaminado.error}); inténtalo otra vez en un momento.`);
    log('envío de la lista de GSG confirmado', { quien, liberadas: liberadas.length, ubicacion, confirmar });
    return { ok: true, liberadas: liberadas.length, ubicacion, confirmar, saltadas, aviso: partes.join(' ') };
  }

  async function revisarReparto(): Promise<number> {
    let marcadas = 0;
    const esperando = await repo.listar({ estados: ['esperando_ubicacion', 'pendiente'], limit: 500 });
    for (const e of esperando) {
      if (!e.loteId || e.ubicacionEstado !== 'pendiente') continue;
      const solicitudes = await repos.rutas.listarSolicitudes({ loteId: e.loteId, q: e.phone, limit: 5, offset: 0 }).catch(() => []);
      const s = solicitudes.find((x) => x.phone === e.phone);
      if (!s) continue;
      if (s.estado === 'resuelto' && s.lat != null && s.lng != null) {
        // La ubicacion llego por el reparto y este modulo no se entero (un
        // reinicio en medio): se recoge de ahi.
        await alUbicacion({ id: s.contactId ?? '', phone: e.phone, name: e.nombre }, { lat: s.lat, lng: s.lng, mapsUrl: s.mapsUrl, fuente: s.ubicacionFuente ?? 'reparto', yaReportada: true });
        marcadas++;
        continue;
      }
      // Otro pedido del MISMO cliente que ya se le está pidiendo: no es algo que
      // «necesite a alguien» (el cliente no hizo nada). Va junto con el otro:
      // su pin sirve para los dos. Si ya estaba apartado por eso, se devuelve.
      if (s.incidencia === 'ya_en_curso') {
        if (e.estado === 'incidencia' && e.incidencia === 'ya_en_curso') {
          await repo.actualizar(e.id, { estado: 'esperando_ubicacion', incidencia: null, incidenciaDetalle: null, requiereHumano: false });
          marcadas++;
        }
        continue;
      }
      // Una persona ya lo atendio (le escribio): no vuelve a «necesita a alguien» solo.
      if ((s.estado === 'derivado' || s.estado === 'supervision') && !s.requiereHumano && e.contactadoAt) continue;
      if (['incidencia', 'derivado', 'supervision', 'cancelado'].includes(s.estado) && e.estado !== 'incidencia') {
        const detalle = s.estado === 'derivado' ? `el reparto la pasó a una persona (${s.incidenciaDetalle ?? 'sin ubicación tras los intentos'})` : `el reparto la apartó: ${s.incidenciaDetalle ?? s.incidencia ?? s.estado}`;
        await marcarIncidencia(e, s.incidencia ?? 'sin_ubicacion', detalle, { avisar: false });
        marcadas++;
      }
    }
    return marcadas;
  }

  // ------------------------------------------------------------ ubicacion

  /**
   * Las frases propias del negocio (lo corregido en «Lo que la IA no
   * entendió»), leidas de settings con una cache corta: cambian poco y se
   * consultan en cada respuesta.
   */
  let frasesCache: { at: number; valor: FrasesPropias } | null = null;
  async function frasesPropias(): Promise<FrasesPropias> {
    if (frasesCache && Date.now() - frasesCache.at < 20_000) return frasesCache.valor;
    let valor: FrasesPropias = {};
    try {
      const fila = (await deps.settingsRepo.getAll()).find((r) => r.key === CLAVE_FRASES_PROPIAS);
      if (fila) valor = leerFrasesPropias(fila.value);
    } catch (error) {
      log('no se pudieron leer las frases propias', { detalle: String(error) });
    }
    frasesCache = { at: Date.now(), valor };
    return valor;
  }

  /** Si el punto cae fuera de la zona que se cubre (sin zona configurada, nada cae fuera). */
  function fueraDeZona(lat: number, lng: number): boolean {
    const b = deps.geo?.bbox;
    if (!b) return false;
    return lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng;
  }

  /** Dentro de la zona que se cubre pero fuera de Lima y Callao: se registra y lleva un extra. */
  function fueraDeLima(lat: number, lng: number): boolean {
    const b = deps.geo?.zonaSinExtra;
    return Boolean(b) && !fueraDeZona(lat, lng) && !dentroDe(b!, lat, lng);
  }

  async function alUbicacionFueraDeZona(contact: Pick<Contact, 'id' | 'phone' | 'name'>, ubicacion: { lat: number; lng: number; fuente?: string | null }): Promise<RespuestaEntregas> {
    const vivas = await repo.vivasPorTelefono(contact.phone);
    const e = vivas.find((x) => x.ubicacionEstado === 'pendiente') ?? vivas[0];
    if (!e) return { atendida: false };
    const detalle = `su pin cae fuera de la zona que se cubre (${ubicacion.lat.toFixed(5)}, ${ubicacion.lng.toFixed(5)}; ${ubicacion.fuente ?? 'whatsapp'}): coordinar por teléfono`;
    const act = e.estado === 'incidencia' && e.incidencia === 'ubicacion_fuera_de_zona' ? e : await marcarIncidencia(e, 'ubicacion_fuera_de_zona', detalle);
    const cobertura = deps.geo?.cobertura ? ` (${deps.geo.cobertura})` : '';
    return { atendida: true, entrega: act, resultado: 'ubicacion_fuera_de_zona', responder: textoDe('ubicacionFueraDeZona', ajustes, { ...contexto(act), cobertura }) };
  }

  /**
   * Cliente recurrente: si ya nos mando su ubicacion hace poco, en vez de
   * meterlo en el lote del reparto se le apunta esa direccion para que el
   * motor se la proponga. Vale para lo que llega de GSG, la lista pegada y
   * el pedido a mano. Devuelve la entrega apuntada, o null si no toca.
   */
  async function apuntarRecurrente(e: Entrega, origen: string): Promise<Entrega | null> {
    // Con la regla del dueño no hay preguntas SÍ/NO al cliente: se le pide el pin como a todos.
    if (reglaGsgActiva()) return null;
    if (e.ubicacionEstado !== 'pendiente' || e.loteId || e.ubicacionPropuestaAt || e.ubicacionPropuestaLat != null) return null;
    const ultima = await ultimaUbicacionDe(e.phone);
    if (!ultima) return null;
    const previo = await repos.contacts.getByPhone(e.phone);
    if (previo?.optOutAt) return null;
    // Dejo su telefono para coordinar la entrega (y ya nos escribio antes):
    // ese es su consentimiento, y queda apuntado como en el reparto.
    const contacto = previo ?? (await repos.contacts.upsertFromInbound(e.phone, e.nombre ?? undefined));
    if (!contacto.optInAt) await repos.contacts.setOptIn(e.phone, `entrega: pedido ${e.referencia} (${origen})`);
    const act = (await repo.actualizar(e.id, { ubicacionPropuestaLat: ultima.lat, ubicacionPropuestaLng: ultima.lng, ubicacionPropuestaAt: null })) ?? e;
    await evento(act, 'nota', `ya mandó su ubicación hace ${ultima.dias} día${ultima.dias === 1 ? '' : 's'}: se le propone esa dirección en vez de pedirle el pin`);
    return act;
  }

  /** La ultima ubicacion confirmada de ese telefono, si es de hace menos de `diasMaximo` dias. */
  async function ultimaUbicacionDe(phone: string): Promise<{ lat: number; lng: number; dias: number } | null> {
    if (!ajustes.clienteRecurrente.activo) return null;
    const recientes = await repos.locations.listRecent({ limit: 5, offset: 0, phone }).catch(() => []);
    const buena = recientes.find((l) => l.confirmed && Number.isFinite(l.lat) && Number.isFinite(l.lng));
    if (!buena) return null;
    const dias = Math.max(0, Math.floor((ahora().getTime() - new Date(buena.createdAt).getTime()) / 86_400_000));
    if (dias > ajustes.clienteRecurrente.diasMaximo) return null;
    return { lat: buena.lat, lng: buena.lng, dias };
  }

  const botonesPropuesta = (e: Entrega) => [
    { id: `entrega:misma:${e.id}`, title: 'Sí, la misma' },
    { id: `entrega:otra:${e.id}`, title: 'Es otra' },
  ];

  async function proponerUbicacion(e: Entrega): Promise<{ ok: boolean; motivo?: string; retryAfterMs?: number }> {
    if (e.ubicacionPropuestaLat == null || e.ubicacionPropuestaLng == null) return { ok: false, motivo: 'no hay dirección que proponer' };
    const en = ahora();
    const ctx = { ...contexto(e), mapa: enlaceMapa(e.ubicacionPropuestaLat, e.ubicacionPropuestaLng) };
    const salida = await enviarA(e.phone, textoDe('proponerUbicacion', ajustes, ctx), 'confirmacion', variablesCliente(e), { separacionMs: 60_000, maxPorDia: 6 }, ajustes.usarBotones ? botonesPropuesta(e) : undefined);
    if (!salida.ok) {
      if ('sinPlantilla' in salida) {
        // Sin plantilla no se puede proponer nada: que el reparto se la pida como siempre.
        await alLoteDelReparto(e, 'no hay plantilla para proponer la dirección');
        return { ok: false, motivo: salida.reason };
      }
      const esperaMs = ('retryAfterMs' in salida && salida.retryAfterMs) || 3 * 60_000;
      await repo.actualizar(e.id, { confirmacionProximoAt: new Date(en.getTime() + esperaMs) });
      return { ok: false, motivo: 'reason' in salida ? salida.reason : salida.error, retryAfterMs: esperaMs };
    }
    const act = (await repo.actualizar(e.id, { ubicacionPropuestaAt: en, confirmacionProximoAt: null, estado: 'esperando_ubicacion' })) ?? e;
    await evento(act, 'nota', 'se le propuso la dirección de la última vez; se espera que diga si es la misma o mande otro pin', { wamid: salida.wamid });
    return { ok: true };
  }

  /** La mete en un lote del reparto para que le pida el pin como siempre. */
  async function alLoteDelReparto(e: Entrega, porQue: string): Promise<Entrega> {
    // Hoy ya la mando (por otro pedido): no se le vuelve a pedir.
    const conocida = await aplicarUbicacionConocida(e);
    if (conocida) return conocida;
    try {
      const carga = await deps.cargarLote({ nombre: `Entregas GSG ${e.dia} · ${horaEnReloj(ahora(), tz())} (pedir el pin)`, filas: [{ telefono: e.phone, nombre: e.nombre ?? undefined, referencia: e.referencia, direccion: e.direccion ?? undefined, distrito: e.distrito ?? undefined, notas: e.notas ?? undefined }], externoId: `gsg-entregas:${e.dia}:${e.id}:${Date.now()}`, origen: 'gsg', arrancar: true });
      const act = (await repo.actualizar(e.id, { loteId: carga.lote.id, ubicacionPropuestaLat: null, ubicacionPropuestaLng: null })) ?? e;
      await evento(act, 'nota', `${porQue}: el reparto le pide la ubicación (lote "${carga.lote.nombre}")`);
      return act;
    } catch (error) {
      log('no se pudo pasar al reparto una propuesta sin respuesta', { detalle: String(error) });
      return e;
    }
  }

  async function revisarPropuestas(): Promise<number> {
    const antesDe = new Date(ahora().getTime() - ajustes.clienteRecurrente.esperaMin * 60_000);
    let pasadas = 0;
    for (const e of await repo.propuestasSinRespuesta(antesDe, 100)) {
      await alLoteDelReparto(e, 'no contestó a la dirección propuesta');
      pasadas++;
    }
    return pasadas;
  }

  /** El cliente contesta a "¿la misma dirección de la última vez?". */
  async function respuestaAPropuesta(e: Entrega, contact: Pick<Contact, 'id' | 'phone' | 'name'>, texto: string, opts: { boton?: string } = {}): Promise<RespuestaEntregas> {
    const boton = opts.boton ?? '';
    const reglas = leerConfirmacionConReglas(texto, await frasesPropias());
    const misma = boton.startsWith('entrega:misma:') || (!boton && reglas.decision === 'si');
    const otra = boton.startsWith('entrega:otra:') || (!boton && (reglas.decision === 'no' || reglas.decision === 'cambio'));
    if (misma && e.ubicacionPropuestaLat != null && e.ubicacionPropuestaLng != null) {
      await evento(e, 'nota', `dijo que es la misma dirección de la última vez${boton ? ' (botón)' : ''}`);
      return alUbicacion(contact, { lat: e.ubicacionPropuestaLat, lng: e.ubicacionPropuestaLng, fuente: 'la misma dirección de la última vez' });
    }
    if (otra) {
      const act = (await repo.actualizar(e.id, { ubicacionPropuestaLat: null, ubicacionPropuestaLng: null })) ?? e;
      await evento(act, 'nota', 'dijo que hoy es otra dirección: se le pide el pin');
      return { atendida: true, entrega: act, resultado: 'ubicacion_otra', responder: textoDe('ubicacionOtra', ajustes, contexto(act)) };
    }
    // No esta claro: se le vuelve a preguntar con los botones (una vez; despues el reparto insiste solo).
    await evento(e, 'nota', `contestó algo que no se entendió a la dirección propuesta: "${texto.slice(0, 120)}"`);
    const ctx = { ...contexto(e), mapa: enlaceMapa(e.ubicacionPropuestaLat ?? 0, e.ubicacionPropuestaLng ?? 0) };
    return { atendida: true, entrega: e, resultado: 'propuesta_no_clara', responder: textoDe('proponerUbicacion', ajustes, ctx), ...(ajustes.usarBotones ? { botones: botonesPropuesta(e) } : {}) };
  }

  /** "P-1001 y P-1002" / "P-1001, P-1002 y P-1003". */
  const enLista = (refs: string[]): string => (refs.length <= 1 ? refs.join('') : `${refs.slice(0, -1).join(', ')} y ${refs[refs.length - 1]}`);
  /** Las referencias de un grupo de entregas del mismo cliente, en el orden en que llegaron. */
  const refsDe = (grupo: Entrega[]): string[] => [...grupo].sort((a, b) => a.id - b.id).map((x) => x.referencia);
  /** Como se nombra un grupo al cliente: "P-1001 y P-1002 (sus 2 pedidos)". */
  const nombreDelGrupo = (grupo: Entrega[]): string => (grupo.length <= 1 ? (grupo[0]?.referencia ?? '') : `${enLista(refsDe(grupo))} (sus ${grupo.length} pedidos)`);

  async function alUbicacion(contact: Pick<Contact, 'id' | 'phone' | 'name'>, ubicacion: { lat: number; lng: number; mapsUrl?: string | null; fuente?: string | null; yaReportada?: boolean; aMano?: boolean }): Promise<RespuestaEntregas> {
    // Un pin fuera de la zona que se cubre no se registra: se aparta para
    // una persona y al cliente se le explica (venga por donde venga).
    if (fueraDeZona(ubicacion.lat, ubicacion.lng)) return alUbicacionFueraDeZona(contact, ubicacion);
    // Otro pin después de la hora límite, con la ubicación ya registrada: no
    // se cambia; se le pasa al motorizado y el cliente coordina con él.
    if (!ubicacion.aMano && pasoLaHoraDeCambio()) {
      const tardio = await pinTardio(contact, ubicacion);
      if (tardio) return tardio;
    }
    const r = await registrarUbicacion(contact, ubicacion);
    // Fuera de Lima y Callao (pero cerca): se registra igual y sigue hacia el
    // motorizado; al cliente se le avisa, debajo del gracias, del costo extra
    // que le dira el motorizado (regla del dueño, 29/09). Al motorizado
    // GSGchat no le dice nada de esto.
    if (!r.atendida || !r.entrega || !fueraDeLima(ubicacion.lat, ubicacion.lng)) return r;
    await evento(r.entrega, 'nota', `su pin cae fuera de Lima y Callao: se registra igual y va al motorizado; lleva un extra según la distancia${ubicacion.aMano ? '' : ' (al cliente se le avisó que se lo dirá el motorizado)'}`);
    if (ubicacion.aMano) return r;
    const aviso = textoDe('ubicacionFueraDeLima', ajustes, contexto(r.entrega));
    return { ...r, responder: r.responder ? `${r.responder}\n\n${aviso}` : aviso };
  }

  /** Ya pasó la hora límite para cambiar la ubicación (1:00 PM por defecto, en el reloj de la tienda). */
  function pasoLaHoraDeCambio(): boolean {
    return horaEnReloj(ahora(), tz()) >= ajustes.cambioUbicacionHasta;
  }

  /**
   * El número que se le da al cliente para coordinar un cambio de ubicación
   * tardío: el del motorizado que manda la API de GSG; si GSG no lo manda,
   * el del motorizado de aquí, y si no, soporte.
   */
  function numeroDeGsg(e: Entrega, m: Motorizado | null): string {
    return e.datosEnvio?.telefonoMotorizado ? telefonoEnPalabras(e.datosEnvio.telefonoMotorizado) : numeroParaCliente(e, m);
  }

  /**
   * Regla del dueño (29/09): pasada la hora límite, un pin distinto del que ya
   * estaba registrado no se registra, y al cliente se le da el número del
   * motorizado (el de GSG) para que coordine con él. Al motorizado no se le
   * escribe nada. Sin ningún número que darle, lo ve una persona. null = no
   * es un cambio (le falta la ubicación a alguno de sus pedidos, o es el
   * mismo punto): sigue normal.
   */
  async function pinTardio(contact: Pick<Contact, 'id' | 'phone' | 'name'>, ubicacion: { lat: number; lng: number; fuente?: string | null }): Promise<RespuestaEntregas | null> {
    const vivas = (await repo.vivasPorTelefono(contact.phone)).filter((x) => !ESTADOS_FINALES.includes(x.estado));
    if (!vivas.length || vivas.some((x) => x.ubicacionEstado !== 'recibida')) return null;
    const mismo = (x: Entrega) => x.lat != null && x.lng != null && Math.abs(x.lat - ubicacion.lat) < 1e-6 && Math.abs(x.lng - ubicacion.lng) < 1e-6;
    if (vivas.every(mismo)) return null;
    const e = vivas.find((x) => x.datosEnvio?.telefonoMotorizado) ?? vivas.find((x) => x.motorizadoId) ?? vivas[0]!;
    const m = await motorizadoDe(e).catch(() => null);
    const numero = numeroDeGsg(e, m);
    const detalle = `mandó otra ubicación después de la ${horaEnPalabras(ajustes.cambioUbicacionHasta)} (${ubicacion.lat.toFixed(5)}, ${ubicacion.lng.toFixed(5)}; ${ubicacion.fuente ?? 'whatsapp'}): NO se cambió`;
    for (const x of vivas) {
      if (!numero) await repo.actualizar(x.id, { requiereHumano: true });
      await evento(x, 'nota', numero ? `${detalle}; se le dio el número del motorizado (${numero}) para que coordine con él` : `${detalle} y no hay número de motorizado que darle: necesita a alguien`);
    }
    return { atendida: true, entrega: e, resultado: 'ubicacion_tardia', responder: textoDe('cambioUbicacionTarde', ajustes, { ...contexto(e, m), telefonoMotorizado: numero }) };
  }

  async function registrarUbicacion(contact: Pick<Contact, 'id' | 'phone' | 'name'>, ubicacion: { lat: number; lng: number; mapsUrl?: string | null; fuente?: string | null; yaReportada?: boolean; aMano?: boolean }): Promise<RespuestaEntregas> {
    // Un cliente puede tener dos pedidos hoy: su pin vale para todos (es la
    // misma direccion), y a GSG se le reporta cada uno. Tambien los de hoy que
    // se apartaron SOLO por no tener la ubicacion (no contesto, contesto otra
    // cosa, el reparto lo paso a una persona): con el pin ya no necesitan a
    // nadie y siguen su camino hacia el motorizado.
    const vivas = await repo.vivasPorTelefono(contact.phone);
    // (Las apartadas por otra cosa -«no soy yo», baja- tambien guardan el pin,
    // para que la ubicacion sea UNA en todo el sistema, pero siguen con una persona.)
    const apartadas = (await repo.listar({ dia: hoy(), estados: ['incidencia'], q: contact.phone, limit: 50 }).catch(() => [] as Entrega[])).filter(
      (x) => x.phone === contact.phone && x.ubicacionEstado === 'pendiente' && !x.envioRetenidoAt,
    );
    const todas = [...vivas, ...apartadas.filter((x) => !vivas.some((v) => v.id === x.id))];
    if (!todas.length) return { atendida: false };
    // A quien YA se le estaba pidiendo confirmar y manda su ubicacion, eso
    // vale como su SI: quiere el pedido en esa direccion (regla del dueño,
    // Numeros del dia). Si el pin lo pone una persona desde el panel, no: el
    // cliente no ha dicho nada.
    const yaSeLePedia = new Set(ubicacion.aMano ? [] : todas.filter((x) => x.confirmacionEstado === 'pedida').map((x) => x.id));
    const mapsUrl = ubicacion.mapsUrl ?? enlaceMapa(ubicacion.lat, ubicacion.lng);
    // El mismo punto que ya tenia no es una correccion: ni se reporta otra vez
    // a GSG ni se le avisa al motorizado.
    const mismoPunto = (x: Entrega): boolean => x.ubicacionEstado === 'recibida' && x.lat != null && x.lng != null && Math.abs(x.lat - ubicacion.lat) < 1e-6 && Math.abs(x.lng - ubicacion.lng) < 1e-6;
    const primeraQueCambia = todas.find((x) => !mismoPunto(x));
    const tocadas: Entrega[] = [];
    let corrigeAlguna = false;
    for (const e of todas) {
      if (mismoPunto(e)) {
        tocadas.push(e);
        continue;
      }
      const corrige = e.ubicacionEstado === 'recibida';
      corrigeAlguna = corrigeAlguna || corrige;
      const liberada = e.estado === 'incidencia' && LIBERA_CON_PIN.has(e.incidencia ?? '');
      let act = (await repo.actualizar(e.id, { ubicacionEstado: 'recibida', lat: ubicacion.lat, lng: ubicacion.lng, mapsUrl, ubicacionFuente: ubicacion.fuente ?? 'whatsapp', ubicacionAt: ahora(), ubicacionPropuestaAt: null, ...(e.pinPropuestoAt ? { pinPropuestoLat: null, pinPropuestoLng: null, pinPropuestoAt: null, pinPropuestoFuente: null, pinPropuestoDudas: 0 } : {}), ...(liberada ? { estado: 'pendiente' as const, incidencia: null, incidenciaDetalle: null, requiereHumano: false } : {}) })) ?? e;
      await evento(act, 'ubicacion', corrige ? `ubicación corregida por el cliente (${ubicacion.fuente ?? 'whatsapp'})` : `ubicación recibida (${ubicacion.fuente ?? 'whatsapp'})${todas.length > 1 ? ` (vale para sus ${todas.length} pedidos de hoy)` : ''}${liberada ? `: ya no necesita a nadie (estaba apartada: ${e.incidenciaDetalle ?? e.incidencia ?? 'sin ubicación'})` : ''}`, { lat: ubicacion.lat, lng: ubicacion.lng });
      if (!ubicacion.yaReportada || e.id !== primeraQueCambia?.id) {
        // Sin solicitud del reparto de por medio (o para el segundo pedido del
        // mismo cliente, que el reparto no conoce), GSG se entera por aqui.
        const falsa = { id: 0, loteId: act.loteId ?? '', contactId: contact.id, telefonoCrudo: act.phone, phone: act.phone, nombre: act.nombre, referencia: act.referencia, direccion: act.direccion, distrito: act.distrito, notas: act.notas, estado: 'resuelto', intentos: 0, ultimoEnvioAt: null, proximoIntentoAt: null, primeraRespuestaAt: null, resueltoAt: ahora(), lat: ubicacion.lat, lng: ubicacion.lng, precisionM: null, ubicacionFuente: ubicacion.fuente ?? 'whatsapp', mapsUrl, incidencia: null, incidenciaDetalle: null, requiereHumano: false, asignadoA: null, createdAt: ahora(), updatedAt: ahora() } as Solicitud;
        await reportar(act, 'ubicacion', { ...payloadUbicacion(falsa, { id: act.loteId ?? 'entregas', nombre: 'Entregas del día', externoId: null, origen: 'gsg', estado: 'enviando', notas: null, createdAt: ahora(), updatedAt: ahora() }), ...(corrige ? { corregida: true } : {}) });
      }

      // Lo llevaba un motorizado SIN ubicación: sigue con el mismo, y solo se le
      // dice que GSG ya la tiene (sin coordenadas ni mapa). Si aún no dio sus
      // minutos, se le siguen esperando.
      if (!corrige && e.ubicacionEstado === 'pendiente' && act.motorizadoSinUbicacionAt && act.motorizadoId && (act.motorizadoEstado === 'enviado' || act.motorizadoEstado === 'respondio')) {
        const m = await repo.motorizado(act.motorizadoId);
        if (m) {
          await sender.send({ phone: m.phone, kind: 'freeform', category: 'UTILITY', origen: 'sistema', text: `${act.referencia}: el cliente ya mandó su ubicación, GSG la tiene.`, limitesContacto: { separacionMs: 0, maxPorDia: 500 } }).catch(() => undefined);
          await evento(act, 'nota', `el cliente mandó su ubicación: sigue con ${firmaMotorizado(m)} (se le avisó que GSG ya la tiene)`);
        }
      }
      // Un motorizado ya la tenia y el cliente corrige el pin: se le manda el nuevo.
      if (corrige && act.motorizadoId && (act.motorizadoEstado === 'enviado' || act.motorizadoEstado === 'respondio') && act.estado !== 'terminada') {
        const m = await repo.motorizado(act.motorizadoId);
        if (m) {
          await sender.send({ phone: m.phone, kind: 'freeform', category: 'UTILITY', origen: 'sistema', text: `${act.referencia} (${act.nombre ?? act.phone}): el cliente corrigió su ubicación; GSG ya tiene la nueva.`, limitesContacto: { separacionMs: 0, maxPorDia: 500 } }).catch(() => undefined);
        }
      }
      tocadas.push(await recalcular(act));
    }

    // La «única verdad»: desde aqui nadie le vuelve a pedir la ubicacion. Las
    // solicitudes abiertas del reparto de este telefono (de cualquier lote)
    // pasan a resueltas y la lista de envio automatico lo suelta. Vale para el
    // pin, el enlace, el pin con el bot en pausa y la que pone una persona.
    await resolverPorUbicacion(repos, contact.phone, { lat: ubicacion.lat, lng: ubicacion.lng, mapsUrl, fuente: ubicacion.fuente ?? 'whatsapp' }, { ahora: ahora(), motivo: 'registrada en Entregas del día' }).catch((error) => log('no se pudieron cerrar las solicitudes del reparto de ese número', { detalle: String(error) }));

    // Regla del dueño («Solo lo de GSG»): UBI REGISTRADA y nada más. Ni la
    // pregunta SÍ/NO: la confirmacion ya no hace falta y el pedido sigue solo
    // hacia el motorizado. Lo que se hace con el motorizado y lo que se le
    // reporta a GSG sigue igual por dentro.
    if (reglaGsgActiva()) {
      for (let i = 0; i < tocadas.length; i++) {
        const t = tocadas[i]!;
        if (t.confirmacionEstado !== 'pendiente' && t.confirmacionEstado !== 'pedida') continue;
        // Se le preguntaba SÍ/NO y manda su pin: eso vale como su SÍ (y GSG se entera).
        if (yaSeLePedia.has(t.id) && t.confirmacionEstado === 'pedida') {
          const en = ahora();
          const respuesta = `mandó su ubicación (${ubicacion.fuente ?? 'whatsapp'}) cuando se le preguntaba SÍ o NO`;
          let act = (await repo.actualizar(t.id, { confirmacionEstado: 'confirmada', confirmacionAt: en, confirmacionRespuesta: respuesta, confirmacionComo: 'reglas', confirmacionProximoAt: null })) ?? t;
          await evento(act, 'confirmada', 'confirmó al mandar su ubicación: se le preguntaba SÍ o NO');
          await reportar(act, 'confirmacion', payloadConfirmacion({ referencia: act.referencia, phone: act.phone, nombre: act.nombre, confirmada: true, respuesta, como: 'reglas', en }));
          act = await recalcular(act);
          emitir('entrega.confirmada', act);
          tocadas[i] = act;
          continue;
        }
        let act = (await repo.actualizar(t.id, { confirmacionEstado: 'no_hace_falta', confirmacionProximoAt: null })) ?? t;
        await evento(act, 'nota', 'no se le pregunta SÍ/NO: con «Solo lo de GSG», tras UBI REGISTRADA no se le escribe más al cliente');
        act = await recalcular(act);
        tocadas[i] = act;
      }
      const act = tocadas[0]!;
      const m = await motorizadoDe(act).catch(() => null);
      return { atendida: true, entrega: act, resultado: corrigeAlguna ? 'ubicacion_corregida' : 'ubicacion', responder: textoDe('ubicacionRegistrada', ajustes, { ...contexto(act, m), pedido: nombreDelGrupo(tocadas) }) };
    }

    // Su ubicacion, cuando ya se le pedia confirmar, cuenta como confirmacion.
    const confirmadasConPin: Entrega[] = [];
    for (let i = 0; i < tocadas.length; i++) {
      const t = tocadas[i]!;
      if (!yaSeLePedia.has(t.id) || t.confirmacionEstado !== 'pedida') continue;
      const en = ahora();
      const respuesta = `mandó su ubicación (${ubicacion.fuente ?? 'whatsapp'}) cuando se le pedía confirmar`;
      let act = (await repo.actualizar(t.id, { confirmacionEstado: 'confirmada', confirmacionAt: en, confirmacionRespuesta: respuesta, confirmacionComo: 'reglas', confirmacionProximoAt: null })) ?? t;
      await evento(act, 'confirmada', `confirmó al mandar su ubicación: se le estaba pidiendo confirmar`);
      await reportar(act, 'confirmacion', payloadConfirmacion({ referencia: act.referencia, phone: act.phone, nombre: act.nombre, confirmada: true, respuesta, como: 'reglas', en }));
      act = await recalcular(act);
      emitir('entrega.confirmada', act);
      tocadas[i] = act;
      confirmadasConPin.push(act);
    }
    if (confirmadasConPin.length) {
      const act = confirmadasConPin[0]!;
      return preguntarPorElSiguiente(act, { atendida: true, entrega: act, resultado: 'ubicacion_y_confirmada', responder: textoDe('confirmada', ajustes, { ...contexto(act), pedido: nombreDelGrupo(confirmadasConPin) }) });
    }

    const refs = tocadas.map((x) => x.referencia);
    const necesitan = tocadas.filter((x) => x.estado !== 'incidencia' && (x.confirmacionEstado === 'pendiente' || x.confirmacionEstado === 'pedida'));
    if (necesitan.length) {
      // La pregunta va pegada al gracias: el cliente esta ahi mismo. Con
      // varios pedidos se pregunta por el primero; el siguiente, al contestar.
      const primera = necesitan[0]!;
      const act = (await repo.actualizar(primera.id, { confirmacionEstado: 'pedida', confirmacionIntentos: primera.confirmacionIntentos + 1, confirmacionPedidaAt: ahora(), confirmacionProximoAt: new Date(ahora().getTime() + ajustes.confirmacionEsperaMin * 60_000), estado: 'esperando_confirmacion' })) ?? primera;
      await evento(act, 'confirmacion_pedida', tocadas.length > 1 ? `se le pidió confirmar junto con el gracias por la ubicación (tiene ${tocadas.length} pedidos hoy: se pregunta uno por uno)` : 'se le pidió confirmar junto con el gracias por la ubicación');
      const texto = tocadas.length > 1 ? textoDe('graciasYConfirmarVarios', ajustes, { ...contexto(act), pedidos: enLista(refs) }) : textoDe('graciasYConfirmar', ajustes, contexto(act));
      return { atendida: true, entrega: act, resultado: 'ubicacion_y_pedir_confirmacion', responder: texto, ...(ajustes.usarBotones ? { botones: botonesConfirmacion(act) } : {}) };
    }
    const act = tocadas[0]!;
    const m = await motorizadoDe(act).catch(() => null);
    return { atendida: true, entrega: act, resultado: corrigeAlguna ? 'ubicacion_corregida' : 'ubicacion', responder: textoDe('ubicacionRegistrada', ajustes, { ...contexto(act, m), pedido: nombreDelGrupo(tocadas) }) };
  }

  // ------------------------------------------- el pin tiene que tener sentido

  const botonesPinLejos = (e: Entrega) => [
    { id: `entrega:pinsi:${e.id}`, title: 'Sí, es ahí' },
    { id: `entrega:pinno:${e.id}`, title: 'No' },
  ];

  /** Sus pedidos que esperan la ubicación (lo que espera confirmar el envío no cuenta: aún no se le escribió). */
  async function esperandoUbicacionDe(phone: string): Promise<Entrega[]> {
    return (await repo.vivasPorTelefono(phone).catch(() => [] as Entrega[])).filter((x) => !x.envioRetenidoAt && x.ubicacionEstado === 'pendiente');
  }

  async function revisarPin(contact: Pick<Contact, 'id' | 'phone' | 'name'>, ubicacion: { lat: number; lng: number; mapsUrl?: string | null; fuente?: string | null }): Promise<RespuestaEntregas> {
    if (!reglaGsgActiva()) return { atendida: false };
    const vivas = await esperandoUbicacionDe(contact.phone);
    if (!vivas.length) return { atendida: false };
    const punto = { lat: ubicacion.lat, lng: ubicacion.lng };
    // Vuelve a mandar el MISMO pin que ya se le preguntó: es ahí, se registra.
    const yaPreguntado = vivas.find((x) => x.pinPropuestoAt && x.pinPropuestoLat != null && x.pinPropuestoLng != null);
    if (yaPreguntado && haversineKm(punto, { lat: yaPreguntado.pinPropuestoLat!, lng: yaPreguntado.pinPropuestoLng! }) < 0.1) {
      await evento(yaPreguntado, 'nota', 'volvió a mandar el mismo pin lejano: es ahí, se registra');
      return { atendida: false };
    }
    // El distrito del pedido (el de GSG o el que nombra su dirección). Sin distrito conocido, se acepta como siempre.
    const comparado = vivas.map((e) => ({ e, d: distanciaAlDistrito(punto, distritoDePedido(e)) })).find((x) => x.d);
    if (!comparado || comparado.d!.kmFuera <= ajustes.pinDistanciaMaxKm) return { atendida: false };
    const { e, d } = comparado as { e: Entrega; d: NonNullable<typeof comparado.d> };
    const en = ahora();
    for (const x of vivas) await repo.actualizar(x.id, { pinPropuestoLat: punto.lat, pinPropuestoLng: punto.lng, pinPropuestoAt: en, pinPropuestoFuente: ubicacion.fuente ?? 'pin de whatsapp', pinPropuestoDudas: 0 });
    const km = `${d.kmCentro.toFixed(1).replace('.', ',')} km`;
    for (const x of vivas) await evento(x, 'nota', `mandó un pin a ${km} de ${d.distrito} (${ubicacion.fuente ?? 'pin de whatsapp'}; más de ${ajustes.pinDistanciaMaxKm} km fuera del distrito): no se da por bueno a ciegas, se le pregunta si es ahí`, { lat: punto.lat, lng: punto.lng });
    // El reparto deja de recordarle mientras decide (pausadoPorTelefono lo ve); su solicitud queda como «contestó».
    for (const s of await solicitudesAbiertasDe(repos, contact.phone)) {
      if (s.estado === 'enviado') await repos.rutas.actualizarSolicitud(s.id, { estado: 'respondio', ...(s.primeraRespuestaAt ? {} : { primeraRespuestaAt: en }) }).catch(() => undefined);
      await repos.rutas.registrarEvento(s.id, 'respuesta', `mandó un pin lejos de ${d.distrito}: se le pregunta si es ahí (SÍ/NO)`, { lat: punto.lat, lng: punto.lng }).catch(() => undefined);
    }
    const act = (await repo.entrega(e.id)) ?? e;
    log('pin lejos de su distrito: se le pregunta si es ahí', { phone: contact.phone, distrito: d.distrito, km: d.kmCentro });
    return { atendida: true, entrega: act, resultado: 'pin_lejos', responder: textoDe('pinLejos', ajustes, { ...contexto(act), distrito: d.distrito }), botones: botonesPinLejos(act) };
  }

  async function responderPinLejos(phone: string, clase: 'si' | 'no' | 'otra', texto: string, como: string): Promise<RespuestaPinLejos | null> {
    const vivas = (await esperandoUbicacionDe(phone)).filter((x) => x.pinPropuestoAt && x.pinPropuestoLat != null && x.pinPropuestoLng != null);
    if (!vivas.length) return null;
    const e = vivas[0]!;
    const que = texto ? `«${texto.slice(0, 120)}»` : 'sin texto';
    const distrito = distritoDePedido(e) ?? 'su distrito';
    // Otra cosa, la primera vez: se le vuelve a preguntar (con los botones).
    if (clase === 'otra' && (e.pinPropuestoDudas ?? 0) < 1) {
      for (const x of vivas) await repo.actualizar(x.id, { pinPropuestoDudas: (x.pinPropuestoDudas ?? 0) + 1 });
      await evento(e, 'nota', `contestó otra cosa a «¿es ahí?» (${que}; ${como}): se le vuelve a preguntar una vez`);
      // Nunca el mismo mensaje dos veces seguidas: se nota que no se le entendió.
      return { tipo: 'repregunta', texto: `Perdona, no te entendí. ${textoDe('pinLejos', ajustes, { ...contexto(e), distrito })}`, botones: botonesPinLejos(e), entrega: e };
    }
    if (clase === 'no') {
      for (const x of vivas) await repo.actualizar(x.id, { pinPropuestoLat: null, pinPropuestoLng: null, pinPropuestoAt: null, pinPropuestoFuente: null, pinPropuestoDudas: 0 });
      await evento(e, 'nota', `dijo que NO es ahí (${que}; ${como}): se le pide la ubicación correcta`);
      return { tipo: 'no', texto: textoDe('pinLejosNo', ajustes, contexto(e)), entrega: (await repo.entrega(e.id)) ?? e };
    }
    // Otra cosa por segunda vez: NO se da el pin por bueno (26/09: tras varios
    // «2» sin entender, un pin que el cliente había negado se registró). El
    // pin queda propuesto y lo decide una persona; al cliente no se le repite nada.
    // La segunda vez, antes de pasarlo a una persona, se le da una salida
    // clara (regla del dueño, 26/09): «¿Todo correcto o prefieres empezar de
    // nuevo?». «Todo correcto» registra su pin; «Empezar de nuevo» le pide
    // la ubicación otra vez desde cero.
    if (clase === 'otra' && (e.pinPropuestoDudas ?? 0) < 2) {
      for (const x of vivas) await repo.actualizar(x.id, { pinPropuestoDudas: 2 });
      await evento(e, 'nota', `volvió a contestar otra cosa a «¿es ahí?» (${que}; ${como}): se le pregunta si está todo correcto o prefiere empezar de nuevo`);
      return {
        tipo: 'repregunta',
        texto: `¿Está todo correcto con la ubicación que nos enviaste, o prefieres empezar de nuevo y mandarla otra vez?`,
        botones: [
          { id: `entrega:pinsi:${e.id}`, title: 'Todo correcto' },
          { id: `entrega:pinno:${e.id}`, title: 'Empezar de nuevo' },
        ],
        entrega: e,
      };
    }
    if (clase === 'otra') {
      await evento(e, 'nota', `volvió a contestar otra cosa a «¿es ahí?» (${que}; ${como}): el pin queda sin registrar y lo decide una persona`);
      await pasarAPersona(phone, 'pin_lejos_sin_respuesta', `no aclaró si su pin lejos de ${distrito} es el bueno: ${que}`).catch(() => 0);
      // El reparto deja de pedirle la ubicación: su solicitud pasa a «lo ve
      // una persona» (si no, volvía a insistirle «necesitamos tu ubicación»).
      await soltarSolicitudes(repos, phone, { ahora: ahora(), motivo: `no aclaró si su pin lejos de ${distrito} es el bueno (lo decide una persona)`, estado: 'supervision' }).catch(() => []);
      return { tipo: 'persona', texto: '', entrega: (await repo.entrega(e.id)) ?? e };
    }
    // SÍ: se registra como siempre.
    await evento(e, 'nota', `confirmó que es ahí (${que}; ${como}): se registra el pin`);
    const contacto = await repos.contacts.getByPhone(phone).catch(() => null);
    const r = await alUbicacion({ id: contacto?.id ?? '', phone, name: contacto?.name ?? e.nombre }, { lat: e.pinPropuestoLat!, lng: e.pinPropuestoLng!, fuente: e.pinPropuestoFuente ?? 'pin de whatsapp' });
    const act = r.entrega ?? (await repo.entrega(e.id)) ?? e;
    return { tipo: 'registrada', texto: r.responder ?? textoDe('ubicacionRegistrada', ajustes, contexto(act)), entrega: act };
  }

  // ------------------------------------------------ la dirección escrita

  async function alDireccionEscrita(contact: Pick<Contact, 'id' | 'phone' | 'name'>, texto: string, como: string): Promise<RespuestaDireccionEscrita | null> {
    const vivas = await esperandoUbicacionDe(contact.phone);
    if (!vivas.length) return null;
    const e = vivas[0]!;
    const direccion = limpiarDireccion(texto);
    if (!direccion) return null;
    const en = ahora();
    for (const x of vivas) await repo.actualizar(x.id, { direccionCliente: direccion, direccionClienteAt: en });
    for (const x of vivas) await evento(x, 'nota', `escribió su dirección en vez del pin (${como}): «${direccion}» (no cuenta como insistencia)`);
    const distritoEscrito = distritoEnDireccion(direccion);
    const distritoPedido = distritoDePedido(e);
    const distritoRef = distritoPedido ?? distritoEscrito;
    const buscar = Boolean(deps.geocodificador) && ajustes.buscarDireccionEnMapa;
    const ubicada: ResultadoGeo | null = buscar ? await deps.geocodificador!.buscar(direccion, distritoEscrito ?? distritoPedido).catch(() => null) : null;
    let porQue: string | null = null;
    if (!buscar) porQue = 'la búsqueda en el mapa está apagada';
    else if (!ubicada) porQue = 'el mapa no la encontró (o no hubo red)';
    else if (ubicada.precision === 'baja') porQue = 'el mapa solo la ubica por la zona';
    else if (!distritoRef) porQue = 'no se sabe su distrito para comprobarla';
    else if (distritoPedido && distritoEscrito && distritoPedido !== distritoEscrito) porQue = `escribió ${distritoEscrito} pero el pedido es de ${distritoPedido}`;
    else if (fueraDeZona(ubicada.lat, ubicada.lng)) porQue = 'cae fuera de la zona que se cubre';
    else {
      const d = distanciaAlDistrito(ubicada, distritoRef);
      if (!d || d.kmFuera > KM_DIRECCION_EN_SU_DISTRITO) porQue = `el mapa la pone fuera de ${distritoRef}`;
    }
    if (!porQue && ubicada) {
      const r = await alUbicacion(contact, { lat: ubicada.lat, lng: ubicada.lng, fuente: FUENTE_DIRECCION_ESCRITA });
      if (r.atendida) {
        const act = r.entrega ?? (await repo.entrega(e.id)) ?? e;
        await evento(act, 'ubicacion', `su dirección escrita se ubicó en el mapa (${ubicada.precision === 'alta' ? 'con el número' : 'por la calle'}, en ${distritoRef}): queda como ubicación aproximada`, { lat: ubicada.lat, lng: ubicada.lng });
        const gracias = r.responder ?? textoDe('ubicacionRegistrada', ajustes, contexto(act));
        return { tipo: 'registrada', texto: `${gracias}\n\n${textoDe('direccionTomada', ajustes, { ...contexto(act), direccion })}`, entrega: act };
      }
    }
    await evento(e, 'nota', `su dirección escrita no se pudo ubicar con seguridad (${porQue ?? 'sin motivo'}): queda anotada y se le pide el pin con amabilidad`);
    return { tipo: 'anotada', texto: textoDe('direccionAnotada', ajustes, { ...contexto(e), direccion }), entrega: (await repo.entrega(e.id)) ?? e };
  }

  // ---------------------------------------------------------------- texto

  /**
   * «Yo no he pedido eso», «no soy yo», «número equivocado», «no conozco esa
   * tienda» (regla del dueño, 25/09). Antes o despues del pin, y tambien en
   * «falta confirmar»: el cliente recibe UNA vez el texto fijo, sus pedidos
   * vivos pasan a «Necesita a alguien» con ese motivo, GSG se entera, y NO se
   * le vuelve a escribir: ni recordatorios, ni insistencias, ni la pregunta
   * SÍ/NO. Si un motorizado ya lo llevaba, se le dice que espere.
   */
  async function alNoSoyYo(contact: Pick<Contact, 'id' | 'phone' | 'name'>, texto: string, como: string): Promise<RespuestaEntregas> {
    const en = ahora();
    // Sus pedidos en curso, y los de hoy que ya estaban apartados por falta de
    // la ubicacion (no contesto, contesto otra cosa): pasan a este motivo.
    const enCurso = (await repo.vivasPorTelefono(contact.phone).catch(() => [] as Entrega[])).filter((x) => !x.envioRetenidoAt);
    const apartadas = (await repo.listar({ dia: hoy(), estados: ['incidencia'], q: contact.phone, limit: 50 }).catch(() => [] as Entrega[])).filter((x) => x.phone === contact.phone && x.ubicacionEstado === 'pendiente' && LIBERA_CON_PIN.has(x.incidencia ?? ''));
    const vivas = [...enCurso, ...apartadas.filter((x) => !enCurso.some((v) => v.id === x.id))];
    const abiertas = await solicitudesAbiertasDe(repos, contact.phone);
    const pendientes = abiertas.filter((s) => !(s.estado === 'supervision' && s.incidencia === 'numero_equivocado'));
    // Ya lo dijo antes (y ya se le contesto): nada mas que hacer ni decir.
    if (!vivas.length && !pendientes.length) {
      if (abiertas.length) await repos.rutas.registrarEvento(abiertas[0]!.id, 'respuesta', `volvió a decir que no es el cliente: "${texto.slice(0, 160)}"`).catch(() => undefined);
      return abiertas.length ? { atendida: true, resultado: 'no_soy_yo_repetido' } : { atendida: false };
    }
    const comoConfirmo = como.includes('modelo') ? 'ia' : 'reglas';
    const detalle = `el cliente dice que no hizo este pedido o que el número no es suyo (${como}): "${texto.slice(0, 160)}"`;
    const tocadas: Entrega[] = [];
    for (const e of vivas) {
      const conMotorizado = e.motorizadoId && (e.motorizadoEstado === 'enviado' || e.motorizadoEstado === 'respondio');
      if (conMotorizado) {
        const m = await repo.motorizado(e.motorizadoId!);
        if (m) await sender.send({ phone: m.phone, kind: 'freeform', category: 'UTILITY', origen: 'sistema', text: `⚠️ ${e.referencia} (${e.nombre ?? e.phone}): el cliente dice que no hizo este pedido. No lo lleves por ahora: lo revisa una persona.`, limitesContacto: { separacionMs: 0, maxPorDia: 500 } }).catch(() => undefined);
      }
      let act = (await repo.actualizar(e.id, { confirmacionProximoAt: null, motorizadoProximoAt: null, ...(conMotorizado ? { motorizadoId: null, motorizadoEstado: 'sin_asignar' as const } : {}) })) ?? e;
      act = await marcarIncidencia(act, INCIDENCIA_NO_SOY_YO, detalle);
      await reportar(act, 'confirmacion', payloadConfirmacion({ referencia: act.referencia, phone: act.phone, nombre: act.nombre, confirmada: false, respuesta: texto.slice(0, 300), como: comoConfirmo, motivo: 'numero_equivocado', en }));
      tocadas.push(act);
    }
    const soltadas = await soltarSolicitudes(repos, contact.phone, { ahora: en, motivo: `dijo que no es el cliente: "${texto.slice(0, 120)}"`, estado: 'supervision', incidencia: 'numero_equivocado' }).catch(() => []);
    // Sin pedido del dia (solo el reparto): GSG se entera por la solicitud.
    if (!vivas.length) {
      for (const s of soltadas) {
        const lote = await repos.rutas.lote(s.loteId).catch(() => null);
        if (lote) await repos.rutas.encolarReporte({ solicitudId: s.id, loteId: lote.id, tipo: 'incidencia', payload: payloadIncidencia(s, lote) }).catch(() => undefined);
      }
    }
    // El chat se calla: desde aqui lo ve una persona.
    if (contact.id) await repos.contacts.cerrarIA(contact.id, true, en, `no soy yo: "${texto.slice(0, 100)}"`).catch(() => undefined);
    log('el cliente dice que no es él: pasa a una persona y no se le vuelve a escribir', { phone: contact.phone, pedidos: tocadas.map((x) => x.referencia) });
    return { atendida: true, entrega: tocadas[0], resultado: 'no_soy_yo', responder: TEXTO_NO_SOY_YO };
  }

  /**
   * Antes del pin, el cliente escribio otra cosa (y ya recibio el cierre): sus
   * pedidos que esperan la ubicacion pasan a una persona con ese motivo.
   */
  async function pasarAPersona(phone: string, codigo: string, detalle: string): Promise<number> {
    let n = 0;
    for (const e of await repo.vivasPorTelefono(phone).catch(() => [] as Entrega[])) {
      if (e.envioRetenidoAt || e.ubicacionEstado !== 'pendiente') continue;
      await marcarIncidencia(e, codigo, detalle);
      n++;
    }
    return n;
  }

  /**
   * Un pedido que ya no va (cancelado, cerrado por el dia) deja de pedir la
   * ubicacion: sus solicitudes del reparto se cancelan, salvo que otro pedido
   * vivo del mismo cliente siga esperando ese mismo pin.
   */
  async function soltarDeLaEntrega(e: Entrega, motivo: string): Promise<void> {
    try {
      const otras = (await repo.vivasPorTelefono(e.phone)).filter((x) => x.id !== e.id && x.ubicacionEstado === 'pendiente');
      if (!otras.length) {
        await soltarSolicitudes(repos, e.phone, { ahora: ahora(), motivo, estado: 'cancelado' });
        return;
      }
      if (!e.loteId || otras.some((x) => x.loteId === e.loteId)) return;
      const deSuLote = (await repos.rutas.listarSolicitudes({ loteId: e.loteId, q: e.phone, limit: 10, offset: 0 })).filter((s) => s.phone === e.phone && ['pendiente', 'enviado', 'respondio', 'supervision', 'derivado'].includes(s.estado));
      for (const s of deSuLote) {
        await repos.rutas.actualizarSolicitud(s.id, { estado: 'cancelado', proximoIntentoAt: null, requiereHumano: false, incidenciaDetalle: motivo.slice(0, 300) });
        await repos.rutas.registrarEvento(s.id, 'nota', `${motivo}: ya no se le pide la ubicación`);
      }
    } catch (error) {
      log('no se pudieron soltar las solicitudes del reparto de un pedido cerrado', { detalle: String(error) });
    }
  }

  /**
   * Un pedido nuevo de un cliente que HOY ya mando su ubicacion (por otro
   * pedido): vale la misma, no se le vuelve a pedir. GSG se entera.
   */
  async function aplicarUbicacionConocida(e: Entrega): Promise<Entrega | null> {
    if (e.ubicacionEstado !== 'pendiente' || e.envioRetenidoAt || ESTADOS_FINALES.includes(e.estado)) return null;
    const conocida = await repo.ubicacionDelClienteDelDia(e.phone, e.dia).catch(() => null);
    if (!conocida || conocida.id === e.id || conocida.lat == null || conocida.lng == null) return null;
    const fuente = conocida.ubicacionFuente ?? 'whatsapp';
    let act = (await repo.actualizar(e.id, { ubicacionEstado: 'recibida', lat: conocida.lat, lng: conocida.lng, mapsUrl: conocida.mapsUrl ?? enlaceMapa(conocida.lat, conocida.lng), ubicacionFuente: fuente, ubicacionAt: ahora(), ubicacionPropuestaAt: null, ubicacionPropuestaLat: null, ubicacionPropuestaLng: null, ...(e.estado === 'incidencia' ? { estado: 'pendiente' as const, incidencia: null, incidenciaDetalle: null, requiereHumano: false } : {}) })) ?? e;
    await evento(act, 'ubicacion', `hoy ya mandó su ubicación (pedido ${conocida.referencia}): vale para este pedido y no se le vuelve a pedir`, { lat: conocida.lat, lng: conocida.lng });
    await reportarUbicacion(act, null, fuente, false);
    // Con la regla del dueño, tras UBI REGISTRADA no se le pregunta SÍ/NO.
    if (reglaGsgActiva() && act.confirmacionEstado === 'pendiente') act = (await repo.actualizar(act.id, { confirmacionEstado: 'no_hace_falta', confirmacionProximoAt: null })) ?? act;
    await resolverPorUbicacion(repos, e.phone, { lat: conocida.lat, lng: conocida.lng, mapsUrl: conocida.mapsUrl, fuente }, { ahora: ahora(), motivo: `ya la había mandado (pedido ${conocida.referencia})` }).catch(() => []);
    return recalcular(act);
  }

  /** La ubicacion de una entrega hacia GSG (sin solicitud del reparto de por medio). */
  async function reportarUbicacion(act: Entrega, contactId: string | null, fuente: string, corregida: boolean): Promise<void> {
    if (act.lat == null || act.lng == null) return;
    const mapsUrl = act.mapsUrl ?? enlaceMapa(act.lat, act.lng);
    const falsa = { id: 0, loteId: act.loteId ?? '', contactId, telefonoCrudo: act.phone, phone: act.phone, nombre: act.nombre, referencia: act.referencia, direccion: act.direccion, distrito: act.distrito, notas: act.notas, estado: 'resuelto', intentos: 0, ultimoEnvioAt: null, proximoIntentoAt: null, primeraRespuestaAt: null, resueltoAt: ahora(), lat: act.lat, lng: act.lng, precisionM: null, ubicacionFuente: fuente, mapsUrl, incidencia: null, incidenciaDetalle: null, requiereHumano: false, asignadoA: null, createdAt: ahora(), updatedAt: ahora() } as Solicitud;
    await reportar(act, 'ubicacion', { ...payloadUbicacion(falsa, { id: act.loteId ?? 'entregas', nombre: 'Entregas del día', externoId: null, origen: 'gsg', estado: 'enviando', notas: null, createdAt: ahora(), updatedAt: ahora() }), ...(corregida ? { corregida: true } : {}) });
  }

  async function alTexto(contact: Pick<Contact, 'id' | 'phone' | 'name'>, texto: string, opts: { boton?: string; citaId?: string | null } = {}): Promise<RespuestaEntregas> {
    const motorizado = await repo.motorizadoPorTelefono(contact.phone);
    if (motorizado) return respuestaDeMotorizado(motorizado, texto, { citaId: opts.citaId ?? null });
    // «No soy yo» va antes que todo: antes o despues del pin, y en «falta confirmar».
    if (!opts.boton && pareceNoSoyYo(texto)) {
      const r = await alNoSoyYo(contact, texto, 'reglas');
      if (r.atendida) return r;
    }
    const vivas = await repo.vivasPorTelefono(contact.phone);
    // ¿A cual de sus pedidos contesta? Si pulso un boton, al de ese boton; si
    // nombra la referencia, a ese; si no, al ultimo por el que se le pregunto.
    const limpio = texto.toLowerCase();
    const idDelBoton = opts.boton ? Number((/^entrega:(?:si|no):(\d+)$/.exec(opts.boton) ?? [])[1]) : NaN;
    const nombrada = vivas.find((x) => limpio.includes(x.referencia.toLowerCase()));
    const pedidas = vivas.filter((x) => x.confirmacionEstado === 'pedida').sort((a, b) => (b.confirmacionPedidaAt?.getTime() ?? 0) - (a.confirmacionPedidaAt?.getTime() ?? 0));
    const e = (Number.isFinite(idDelBoton) ? pedidas.find((x) => x.id === idDelBoton) : undefined) ?? (nombrada && nombrada.confirmacionEstado === 'pedida' ? nombrada : undefined) ?? pedidas[0] ?? nombrada ?? vivas[0] ?? null;
    if (e && e.confirmacionEstado === 'pedida') return respuestaDeConfirmacion(e, texto, opts);
    // ¿Se le propuso la direccion de la ultima vez y esta contestando a eso?
    const propuesta = vivas.find((x) => x.ubicacionEstado === 'pendiente' && x.ubicacionPropuestaAt && x.ubicacionPropuestaLat != null);
    if (propuesta && (!opts.boton || /^entrega:(misma|otra):/.test(opts.boton))) return respuestaAPropuesta(propuesta, contact, texto, opts);
    // ¿Se le pregunto si volvemos hoy (segunda visita)? Esa entrega esta
    // apartada, no viva, asi que se busca aparte.
    const esperandoSegunda = await esperandoSegundaVisitaDe(contact.phone);
    if (esperandoSegunda) return respuestaDeSegundaVisita(esperandoSegunda, texto, opts);
    // "¿Dónde está mi pedido?": se contesta segun el estado, sin IA. Vale
    // para la viva de hoy y para la que ya figura como entregada hoy.
    if (ajustes.responderDondeEsta) {
      const pregunta = leerPreguntaPorPedido(texto);
      if (pregunta.pregunta) {
        const objetivo = e ?? (await entregadaHoyDe(contact.phone));
        if (objetivo) return respuestaDondeEsta(objetivo, texto, pregunta.noLlego);
      }
    }
    return { atendida: false };
  }

  /** La entrega de hoy de ese telefono que ya figura como entregada (la ultima). */
  async function entregadaHoyDe(phone: string): Promise<Entrega | null> {
    const deHoy = (await repo.listar({ dia: hoy(), estados: ['entregada'], limit: 1000 })).filter((x) => x.phone === phone);
    return deHoy.length ? deHoy[deHoy.length - 1]! : null;
  }

  /** Le dice al cliente donde esta su pedido segun el estado; un "no llegó" pasada la hora avisa a una persona. */
  async function respuestaDondeEsta(e: Entrega, texto: string, noLlego: boolean): Promise<RespuestaEntregas> {
    const m = await motorizadoDe(e);
    const en = ahora();
    const horaPasada = e.llegaAproxAt ? en.getTime() - e.llegaAproxAt.getTime() > MINUTOS_TOLERANCIA_LLEGADA * 60_000 : false;
    if (noLlego && ((e.estado === 'avisada' && horaPasada) || e.estado === 'entregada')) {
      const detalle = e.estado === 'entregada' ? `el cliente dice que NO le llegó aunque figura entregada${e.entregadaAt ? ` a las ${horaEnReloj(e.entregadaAt, tz())}` : ''}: "${texto.slice(0, 120)}"` : `el cliente dice que no le llegó; se le avisó para las ${e.llegaAproxAt ? horaEnReloj(e.llegaAproxAt, tz()) : '?'}: "${texto.slice(0, 120)}"`;
      const act = await marcarIncidencia(e, 'no_llego', detalle);
      return { atendida: true, entrega: act, resultado: 'no_llego', responder: textoDe('dondeEstaNoLlego', ajustes, contexto(act, m)) };
    }
    let clave: keyof AjustesEntregas['textos'];
    switch (e.estado) {
      case 'entregada':
        clave = 'dondeEstaEntregada';
        break;
      case 'avisada':
        // Si el motorizado ya dijo que esta cerca, eso es lo que el cliente quiere oir.
        clave = e.cercaAvisadoAt ? 'dondeEstaCerca' : 'dondeEstaAvisada';
        break;
      case 'lista':
      case 'esperando_motorizado':
        clave = 'dondeEstaMotorizado';
        break;
      case 'incidencia':
      case 'cancelada':
      case 'terminada':
        // Lo esta viendo una persona (o ya termino): que lo atienda el asistente o alguien.
        return { atendida: false };
      default:
        if (e.ubicacionEstado === 'pendiente') clave = 'dondeEstaUbicacion';
        else if (e.confirmacionEstado === 'pendiente' || e.confirmacionEstado === 'pedida') clave = 'dondeEstaConfirmacion';
        else clave = 'dondeEstaMotorizado';
    }
    await evento(e, 'nota', `preguntó por su pedido ("${texto.slice(0, 80)}"); se le contestó según el estado (${e.estado})`);
    return { atendida: true, entrega: e, resultado: `donde_esta_${e.estado}`, responder: textoDe(clave, ajustes, contexto(e, m)) };
  }

  /** Un motorizado mando una foto: con un pedido avisado entre manos, es la prueba de entrega. */
  async function alAdjuntoDeMotorizado(contact: Pick<Contact, 'id' | 'phone' | 'name'>, tipo: string, texto?: string | null): Promise<RespuestaEntregas> {
    // Un audio del motorizado que NO se pudo transcribir (con transcripcion
    // entra como texto por alTexto): se le pide que lo escriba o mande otro.
    if (tipo === 'audio') {
      const m = await repo.motorizadoPorTelefono(contact.phone);
      if (!m) return { atendida: false };
      const donde = (await repo.enManosDeMotorizado(m.id))[0] ?? (await repo.avisadasDeMotorizado(m.id))[0];
      if (donde) await evento(donde, 'nota', `${firmaMotorizado(m)} mandó un audio que no se pudo entender; se le pidió que lo escriba`);
      return { atendida: true, entrega: donde, resultado: 'motorizado_audio_sin_texto', responder: textoDe('motorizadoAudioSinTexto', ajustes, { negocio: deps.nombreNegocio(), motorizado: m.nombre.split(' ')[0] || m.nombre }) };
    }
    if (!['image', 'video', 'document'].includes(tipo)) return { atendida: false };
    const m = await repo.motorizadoPorTelefono(contact.phone);
    if (!m) return { atendida: false };
    const avisadas = await repo.avisadasDeMotorizado(m.id);
    if (!avisadas.length) return { atendida: false };
    const pie = (texto ?? '').toLowerCase();
    const e = avisadas.find((x) => pie.includes(x.referencia.toLowerCase())) ?? avisadas[0]!;
    const que = tipo === 'image' ? '[foto]' : tipo === 'video' ? '[video]' : '[archivo]';
    const act = await darPorEntregada(e, m, 'foto', texto ? `${que} ${texto.slice(0, 280)}` : que);
    return { atendida: true, entrega: act, resultado: 'motorizado_entregado_foto', responder: respuestaEntregadoAlMotorizado(act, m, avisadas.length > 1 && !pie.includes(e.referencia.toLowerCase())) };
  }

  /** "Perfecto, P-1001 entregado", y si tenia varias sin nombrar cual, la puerta para corregir. */
  function respuestaEntregadoAlMotorizado(e: Entrega, m: Motorizado, ambigua: boolean): string {
    const base = textoDe('motorizadoEntregado', ajustes, contexto(e, m));
    return ambigua ? `Anotado como entregado ${e.referencia}. Si era otro, dime cuál (por ejemplo "entregado P-1002").` : base;
  }

  /**
   * La entrega queda entregada: se apunta como se supo, GSG recibe la hora,
   * el motorizado deja su ultima posicion en ese pin (para elegirlo despues
   * por cercania) y al cliente se le da las gracias si el ajuste lo dice.
   */
  async function darPorEntregada(e: Entrega, m: Motorizado | null, como: ComoEntrego, respuesta: string | null, opts: { sinGracias?: boolean } = {}): Promise<Entrega> {
    const en = ahora();
    let act = (await repo.actualizar(e.id, { estado: 'entregada', entregadaAt: en, entregadaComo: como, entregadaRespuesta: respuesta?.slice(0, 300) ?? null, motorizadoProximoAt: null, confirmacionProximoAt: null, requiereHumano: false })) ?? e;
    const comoTexto = como === 'foto' ? 'mandó la foto' : como === 'persona' ? `la marcó ${respuesta ?? 'una persona'}` : como === 'cierre' ? 'se dio por entregada al cerrar el día' : `dijo "${(respuesta ?? '').slice(0, 80)}"`;
    await evento(act, 'entregada', `${m ? firmaMotorizado(m) : 'el motorizado'} ${comoTexto} (${como})`);
    if (m && act.lat != null && act.lng != null && como !== 'cierre') {
      await repo.actualizarMotorizado(m.id, { ultimaLat: act.lat, ultimaLng: act.lng, ultimaPosicionAt: en });
    }
    await reportar(act, 'entrega', payloadEntregaDe(act, m, { entregadoAt: como === 'cierre' ? null : en, entregadaComo: como }));
    emitir('entrega.entregada', act, m);
    if (ajustes.avisarEntregado && como !== 'cierre' && !opts.sinGracias) {
      const ctx = contexto(act, m);
      const salida = await enviarA(act.phone, textoDe('clienteEntregado', ajustes, ctx), 'aviso', [(act.nombre ?? '').trim().split(/\s+/)[0] || 'buenas tardes', act.referencia, ctx.horaEntregada ?? ''], { separacionMs: 0, maxPorDia: 20 });
      const callado = await noSalioAlCliente(act.phone, salida);
      if (callado) await evento(act, 'nota', `al cliente NO se le escribió el «entregado» (${callado})`);
      else if (salida.ok) await evento(act, 'aviso', 'se le dio las gracias al cliente: pedido entregado');
      else await evento(act, 'nota', `no se pudo avisar al cliente de la entrega: ${'reason' in salida ? salida.reason : salida.error}`);
    }
    act = (await repo.entrega(act.id)) ?? act;
    return act;
  }

  /**
   * El motorizado no pudo entregar. Si todavia no hubo segunda visita y el
   * ajuste lo permite, al cliente se le pregunta si volvemos hoy y la entrega
   * queda apartada pero sin pedirle nada a nadie (`preguntada: true`). Si no,
   * pasa a una persona. GSG se entera en los dos casos.
   */
  async function noPudoEntregar(e: Entrega, m: Motorizado, texto: string, detalle?: string): Promise<{ entrega: Entrega; preguntada: boolean }> {
    await repo.actualizar(e.id, { entregadaRespuesta: texto.slice(0, 300), visitas: e.visitas + 1 });
    const conVisita = { ...e, visitas: e.visitas + 1 };
    if (ajustes.segundaVisita.activa && !e.segundaVisita && e.visitas === 0) {
      const preguntada = await preguntarSegundaVisita(conVisita, m, texto, detalle);
      if (preguntada) return { entrega: preguntada, preguntada: true };
    }
    const act = await marcarIncidencia(conVisita, 'no_entregado', `${firmaMotorizado(m)} no pudo entregar${e.segundaVisita ? ' (tampoco en la segunda visita)' : ''}${detalle ? ` (${detalle})` : ''}: "${texto.slice(0, 160)}"`);
    await reportar(act, 'entrega', payloadEntregaDe(act, m, { entregadoAt: null, incidencia: 'no_entregado' }));
    return { entrega: act, preguntada: false };
  }

  /** Le pregunta al cliente si volvemos hoy. Devuelve la entrega apartada, o null si no se le pudo escribir. */
  async function preguntarSegundaVisita(e: Entrega, m: Motorizado, texto: string, detalle?: string): Promise<Entrega | null> {
    const en = ahora();
    const salida = await mandarPreguntaSegundaVisita(e, m);
    const porQue = `${firmaMotorizado(m)} pasó y no había nadie${detalle ? ` (${detalle})` : ''}: "${texto.slice(0, 120)}"`;
    const vence = new Date(en.getTime() + ajustes.segundaVisita.esperaMin * 60_000);
    if (!salida.ok) {
      // Frenada por el ritmo del numero (o un fallo pasajero de WhatsApp): la
      // pregunta queda apuntada y el motor la vuelve a mandar en cuanto toque.
      // Solo lo definitivo (sin plantilla, numero rechazado) pasa a una persona.
      const pasajero = !('sinPlantilla' in salida) && (salida.blocked ? salida.retryAfterMs !== undefined : salida.retryable);
      if (!pasajero) {
        await evento(e, 'nota', `no se le pudo preguntar al cliente por la segunda visita: ${'reason' in salida ? salida.reason : salida.error}`);
        return null;
      }
      const enMs = ('retryAfterMs' in salida && salida.retryAfterMs) || 60_000;
      const act =
        (await repo.actualizar(e.id, {
          estado: 'incidencia',
          incidencia: 'no_entregado',
          incidenciaDetalle: `${porQue}; la pregunta al cliente (si volvemos hoy) sale en cuanto el ritmo del número lo permita`,
          requiereHumano: false,
          segundaVisitaPedidaAt: en,
          segundaVisitaVenceAt: vence,
          motorizadoProximoAt: new Date(en.getTime() + enMs),
        })) ?? e;
      await evento(act, 'nota', `la pregunta de la segunda visita espera su turno (${'reason' in salida ? salida.reason : salida.error}); se reintenta en ${Math.max(1, Math.round(enMs / 1000))} s`);
      await reportar(act, 'entrega', payloadEntregaDe(act, m, { entregadoAt: null, incidencia: 'no_entregado' }));
      emitir('entrega.incidencia', act, m);
      return act;
    }
    const act =
      (await repo.actualizar(e.id, {
        estado: 'incidencia',
        incidencia: 'no_entregado',
        incidenciaDetalle: `${porQue}; se le preguntó al cliente si volvemos hoy`,
        requiereHumano: false,
        segundaVisitaPedidaAt: en,
        segundaVisitaVenceAt: vence,
        motorizadoProximoAt: null,
      })) ?? e;
    const calladoSv = await noSalioAlCliente(act.phone, salida);
    await evento(act, 'segunda_visita', calladoSv ? `al cliente NO se le preguntó si volvemos hoy (${calladoSv}); si nadie lo resuelve, a las ${horaEnReloj(vence, tz())} pasa a una persona` : `se le preguntó al cliente si volvemos hoy; se espera su respuesta hasta las ${horaEnReloj(vence, tz())}`, { wamid: salida.wamid });
    await reportar(act, 'entrega', payloadEntregaDe(act, m, { entregadoAt: null, incidencia: 'no_entregado' }));
    emitir('entrega.incidencia', act, m);
    return act;
  }

  /** El mensaje "¿volvemos hoy?" al cliente, con sus botones (o la plantilla, con la API de Meta fuera de la ventana). */
  function mandarPreguntaSegundaVisita(e: Entrega, m: Motorizado) {
    return enviarA(e.phone, textoDe('segundaVisitaPreguntar', ajustes, contexto(e, m)), 'confirmacion', variablesCliente(e), { separacionMs: 0, maxPorDia: 20 }, botonesSegundaVisita(e));
  }

  /** Una pregunta de segunda visita que quedo esperando su turno: sale ahora si el numero puede. */
  async function reintentarPreguntaSegundaVisita(e: Entrega): Promise<void> {
    const en = ahora();
    const m = await motorizadoDe(e);
    if (!m) {
      await marcarIncidencia({ ...e, motorizadoProximoAt: null }, 'no_entregado', 'el motorizado pasó y no había nadie; no se le pudo preguntar al cliente si volvemos hoy (el motorizado ya no existe)');
      return;
    }
    const salida = await mandarPreguntaSegundaVisita(e, m);
    if (salida.ok) {
      const vence = new Date(en.getTime() + ajustes.segundaVisita.esperaMin * 60_000);
      const act =
        (await repo.actualizar(e.id, {
          incidenciaDetalle: `${firmaMotorizado(m)} pasó y no había nadie; se le preguntó al cliente si volvemos hoy`,
          segundaVisitaPedidaAt: en,
          segundaVisitaVenceAt: vence,
          motorizadoProximoAt: null,
        })) ?? e;
      const calladoSv = await noSalioAlCliente(act.phone, salida);
      await evento(act, 'segunda_visita', calladoSv ? `al cliente NO se le preguntó si volvemos hoy (${calladoSv}); si nadie lo resuelve, a las ${horaEnReloj(vence, tz())} pasa a una persona` : `se le preguntó al cliente si volvemos hoy; se espera su respuesta hasta las ${horaEnReloj(vence, tz())}`, { wamid: salida.wamid });
      return;
    }
    const pasajero = !('sinPlantilla' in salida) && (salida.blocked ? salida.retryAfterMs !== undefined : salida.retryable);
    if (pasajero) {
      const enMs = ('retryAfterMs' in salida && salida.retryAfterMs) || 60_000;
      await repo.actualizar(e.id, { motorizadoProximoAt: new Date(en.getTime() + enMs) });
      return;
    }
    await repo.actualizar(e.id, { motorizadoProximoAt: null });
    await marcarIncidencia({ ...e, motorizadoProximoAt: null }, 'no_entregado', `el motorizado pasó y no había nadie; no se le pudo preguntar al cliente si volvemos hoy: ${'reason' in salida ? salida.reason : salida.error}`);
  }

  /** La entrega de hoy de ese telefono a la que se le pregunto por la segunda visita y todavia puede contestar. */
  async function esperandoSegundaVisitaDe(phone: string): Promise<Entrega | null> {
    const en = ahora().getTime();
    const deHoy = (await repo.listar({ dia: hoy(), estados: ['incidencia'], limit: 1000 })).filter(
      (x) => x.phone === phone && x.segundaVisitaPedidaAt && !x.requiereHumano && (!x.segundaVisitaVenceAt || x.segundaVisitaVenceAt.getTime() > en),
    );
    return deHoy.length ? deHoy[deHoy.length - 1]! : null;
  }

  /** Lo que contesta el cliente a "¿volvemos hoy?": si, no (u otro dia), cancelar del todo, o nada claro. */
  async function respuestaDeSegundaVisita(e: Entrega, texto: string, opts: { boton?: string } = {}): Promise<RespuestaEntregas> {
    // Si la pregunta seguia esperando su turno, ya no hace falta mandarla: el cliente se adelanto.
    if (e.motorizadoProximoAt) e = (await repo.actualizar(e.id, { motorizadoProximoAt: null })) ?? { ...e, motorizadoProximoAt: null };
    const leida = await leerConfirmacion(texto, ia(), log, await frasesPropias());
    const como = opts.boton && leida.decision !== 'no_claro' ? 'boton' : leida.como;
    const m = await motorizadoDe(e);
    if (leida.como === 'ia') await evento(e, 'ia', `la IA leyó la respuesta a la segunda visita: ${leida.decision}${leida.detalle ? ` (${leida.detalle})` : ''}`, { texto: texto.slice(0, 300) });
    if (leida.decision === 'si') {
      const act = await arrancarSegundaVisita(e, `el cliente dijo que sí (${como}): "${texto.slice(0, 120)}"`);
      return { atendida: true, entrega: act, resultado: 'segunda_visita_si', responder: textoDe('segundaVisitaSi', ajustes, contexto(act, await motorizadoDe(act))) };
    }
    if (leida.decision === 'no' && leida.frase && CANCELA_FUERTE.has(leida.frase)) {
      // Cancela del todo: como un "no" a la confirmacion.
      const act = (await cancelar(e.id, `el cliente ya no lo quiere (segunda visita, ${como}): "${texto.slice(0, 120)}"`, 'el cliente')) ?? e;
      return { atendida: true, entrega: act, resultado: 'segunda_visita_cancela', responder: textoDe('cancelada', ajustes, contexto(act, m)) };
    }
    if (leida.decision === 'no' || leida.decision === 'cambio') {
      await repo.actualizar(e.id, { segundaVisitaVenceAt: null, confirmacionRespuesta: texto.slice(0, 300) });
      const act = await marcarIncidencia({ ...e, segundaVisitaVenceAt: null }, 'reprogramar', `el motorizado pasó y no había nadie; el cliente no quiere que vuelva hoy (${como}${leida.detalle ? `: ${leida.detalle}` : ''}): "${texto.slice(0, 120)}"`);
      await reportar(act, 'confirmacion', payloadConfirmacion({ referencia: act.referencia, phone: act.phone, nombre: act.nombre, confirmada: false, respuesta: texto.slice(0, 300), como, motivo: 'reprogramar', en: ahora() }));
      return { atendida: true, entrega: act, resultado: 'segunda_visita_no', responder: textoDe('segundaVisitaNo', ajustes, contexto(act, m)) };
    }
    await evento(e, 'nota', `contestó algo que no se entendió a la segunda visita: "${texto.slice(0, 120)}"; se le pregunta otra vez`);
    return { atendida: true, entrega: e, resultado: 'segunda_visita_no_claro', responder: textoDe('segundaVisitaPreguntar', ajustes, contexto(e, m)), ...(ajustes.usarBotones ? { botones: botonesSegundaVisita(e) } : {}) };
  }

  /**
   * La segunda visita arranca: la entrega vuelve a "lista" limpia de la
   * primera vuelta y, si el mismo motorizado sigue activo, se le manda ya
   * (con el texto de "vuelve a pasar"); si no, el motor busca otro.
   */
  async function arrancarSegundaVisita(e: Entrega, porQue: string): Promise<Entrega> {
    const anterior = await motorizadoDe(e);
    const mismo = anterior && anterior.estado === 'activo' ? anterior : null;
    const patch: PatchEntrega = {
      segundaVisita: true,
      segundaVisitaVenceAt: null,
      estado: 'lista',
      incidencia: null,
      incidenciaDetalle: null,
      requiereHumano: false,
      motorizadoId: null,
      motorizadoEstado: 'sin_asignar',
      motorizadoIntentos: 0,
      motorizadoEnviadoAt: null,
      motorizadoProximoAt: null,
      motorizadoRespuesta: null,
      motorizadoRespondioAt: null,
      minutosMotorizado: null,
      minutosAviso: null,
      llegaAproxAt: null,
      avisoEnviadoAt: null,
      cercaAvisadoAt: null,
      terminadaGsgAt: null,
    };
    let act = (await repo.actualizar(e.id, patch)) ?? e;
    await evento(act, 'segunda_visita', `${porQue}; ${mismo ? `${firmaMotorizado(mismo)} vuelve a pasar` : 'se busca un motorizado'}`);
    if (mismo) act = await mandarAEste(act, mismo.id);
    return act;
  }

  /** Las segundas visitas sin respuesta del cliente a tiempo pasan a una persona. */
  async function revisarSegundasVisitas(): Promise<number> {
    const en = ahora().getTime();
    let n = 0;
    for (const e of await repo.listar({ dia: hoy(), estados: ['incidencia'], limit: 1000 })) {
      if (!e.segundaVisitaPedidaAt || e.requiereHumano) continue;
      // La pregunta todavia no salio (la freno el ritmo del numero): se vuelve a intentar hasta que venza el plazo.
      if (e.motorizadoProximoAt) {
        if (e.segundaVisitaVenceAt && e.segundaVisitaVenceAt.getTime() <= en) {
          await repo.actualizar(e.id, { segundaVisitaVenceAt: null, motorizadoProximoAt: null });
          await marcarIncidencia({ ...e, segundaVisitaVenceAt: null, motorizadoProximoAt: null }, 'no_entregado', `el motorizado pasó y no había nadie; la pregunta al cliente no pudo salir en ${ajustes.segundaVisita.esperaMin} min (el número no dio abasto)`);
          n++;
        } else if (e.motorizadoProximoAt.getTime() <= en) {
          await reintentarPreguntaSegundaVisita(e);
        }
        continue;
      }
      if (!e.segundaVisitaVenceAt || e.segundaVisitaVenceAt.getTime() > en) continue;
      await repo.actualizar(e.id, { segundaVisitaVenceAt: null });
      await marcarIncidencia({ ...e, segundaVisitaVenceAt: null }, 'no_entregado', `el motorizado pasó y no había nadie; el cliente no contestó si volvemos hoy (se esperó ${ajustes.segundaVisita.esperaMin} min)`);
      n++;
    }
    return n;
  }

  /**
   * Manda la entrega a ESE motorizado. Queda reservada para el (motorizadoId
   * con `sin_asignar`): si el envio no puede salir ahora (el ritmo del numero
   * lo frena), el motor lo reintenta con el mismo, no con cualquiera.
   */
  async function mandarAEste(e: Entrega, motorizadoId: number): Promise<Entrega> {
    const reservada = (await repo.actualizar(e.id, { motorizadoId, motorizadoEstado: 'sin_asignar' })) ?? { ...e, motorizadoId, motorizadoEstado: 'sin_asignar' as const };
    await mandarAMotorizado(reservada);
    return (await repo.entrega(e.id)) ?? reservada;
  }

  /** "Cerca" / "llegando": al cliente de esa entrega se le avisa, una sola vez. */
  async function avisarCerca(m: Motorizado, avisadas: Entrega[], nombro: Entrega | undefined, texto: string): Promise<RespuestaEntregas> {
    // La mas antigua sin aviso de cerca (las avisadas vienen la ultima primero).
    const objetivo = nombro ?? [...avisadas].reverse().find((x) => !x.cercaAvisadoAt) ?? avisadas[avisadas.length - 1]!;
    const nombre = (objetivo.nombre ?? '').trim().split(/\s+/)[0] || 'el cliente';
    if (!ajustes.avisarCerca) return { atendida: true, entrega: objetivo, resultado: 'motorizado_cerca_apagado', responder: `Gracias por avisar, ${m.nombre.split(' ')[0]}. Cuando lo dejes, escríbeme "entregado".` };
    if (objetivo.cercaAvisadoAt) return { atendida: true, entrega: objetivo, resultado: 'motorizado_cerca_repetido', responder: `Ya le avisé a ${nombre} que estabas cerca (${objetivo.referencia}). Cuando lo dejes, escríbeme "entregado".` };
    const ctx = contexto(objetivo, m);
    const salida = await enviarA(objetivo.phone, textoDe('clienteCerca', ajustes, ctx), 'aviso', [nombre, objetivo.referencia, ctx.hora ?? ''], { separacionMs: 0, maxPorDia: 20 });
    if (!salida.ok) {
      await evento(objetivo, 'nota', `no se le pudo avisar al cliente que el motorizado está cerca: ${'reason' in salida ? salida.reason : salida.error}`);
      return { atendida: true, entrega: objetivo, resultado: 'motorizado_cerca_no_enviado', responder: `No pude avisarle a ${nombre} por WhatsApp; sigue nomás y escríbeme "entregado" cuando lo dejes.` };
    }
    const act = (await repo.actualizar(objetivo.id, { cercaAvisadoAt: ahora() })) ?? objetivo;
    const calladoCerca = await noSalioAlCliente(act.phone, salida);
    await evento(act, 'cerca', calladoCerca ? `${firmaMotorizado(m)} avisó que está cerca ("${texto.slice(0, 80)}"); al cliente NO se le escribió (${calladoCerca})` : `${firmaMotorizado(m)} avisó que está cerca ("${texto.slice(0, 80)}"); al cliente se le avisó`);
    const ambigua = avisadas.length > 1 && !nombro;
    return { atendida: true, entrega: act, resultado: 'motorizado_cerca', responder: textoDe('motorizadoCerca', ajustes, contexto(act, m)) + (ambigua ? ` Si era otro pedido, dime cuál (por ejemplo "cerca ${avisadas.find((x) => x.id !== act.id)?.referencia ?? 'P-1002'}").` : '') };
  }

  async function respuestaDeConfirmacion(e: Entrega, texto: string, opts: { boton?: string } = {}): Promise<RespuestaEntregas> {
    const leida = await leerConfirmacion(texto, ia(), log, await frasesPropias());
    // Un boton pulsado no se interpreta: es lo que dice el boton.
    const lectura = opts.boton && leida.decision !== 'no_claro' ? { ...leida, como: 'boton' as const } : leida;
    const en = ahora();
    if (lectura.como === 'ia') await evento(e, 'ia', `la IA leyó la respuesta: ${lectura.decision}${lectura.detalle ? ` (${lectura.detalle})` : ''}`, { texto: texto.slice(0, 300) });

    if (lectura.decision === 'si') {
      let act = (await repo.actualizar(e.id, { confirmacionEstado: 'confirmada', confirmacionAt: en, confirmacionRespuesta: texto.slice(0, 300), confirmacionComo: lectura.como, confirmacionProximoAt: null })) ?? e;
      await evento(act, 'confirmada', `confirmó (${lectura.como}${lectura.detalle ? `: ${lectura.detalle}` : ''}): "${texto.slice(0, 120)}"`);
      await reportar(act, 'confirmacion', payloadConfirmacion({ referencia: act.referencia, phone: act.phone, nombre: act.nombre, confirmada: true, respuesta: texto.slice(0, 300), como: lectura.como, en }));
      act = await recalcular(act);
      emitir('entrega.confirmada', act);
      // Si mando su ubicacion por el chat ya recibio el aviso completo (motorizado, horario, soporte): no se repite.
      const yaAvisado = act.ubicacionEstado === 'recibida' && Boolean(act.ubicacionFuente) && act.ubicacionFuente !== 'gsg' && !String(act.ubicacionFuente).startsWith('a mano');
      return preguntarPorElSiguiente(act, { atendida: true, entrega: act, resultado: 'confirmada', responder: textoDe(yaAvisado ? 'confirmadaYaAvisado' : 'confirmada', ajustes, contexto(act)) });
    }
    if (lectura.decision === 'no') {
      let act = (await repo.actualizar(e.id, { confirmacionEstado: 'rechazada', confirmacionAt: en, confirmacionRespuesta: texto.slice(0, 300), confirmacionComo: lectura.como, confirmacionProximoAt: null, estado: 'cancelada', incidencia: 'cancela', incidenciaDetalle: `el cliente no lo quiso: "${texto.slice(0, 120)}"` })) ?? e;
      await evento(act, 'rechazada', `no lo quiere (${lectura.como}${lectura.detalle ? `: ${lectura.detalle}` : ''}): "${texto.slice(0, 120)}"`);
      await reportar(act, 'confirmacion', payloadConfirmacion({ referencia: act.referencia, phone: act.phone, nombre: act.nombre, confirmada: false, respuesta: texto.slice(0, 300), como: lectura.como, motivo: 'cancela', en }));
      await avisarMotorizadoQueSeCancela(act);
      await soltarDeLaEntrega(act, `el cliente no quiso el pedido ${act.referencia}`);
      act = (await repo.entrega(act.id)) ?? act;
      return preguntarPorElSiguiente(act, { atendida: true, entrega: act, resultado: 'cancelada', responder: textoDe('cancelada', ajustes, contexto(act)) });
    }
    if (lectura.decision === 'cambio') {
      let act = (await repo.actualizar(e.id, { confirmacionRespuesta: texto.slice(0, 300), confirmacionComo: lectura.como, confirmacionProximoAt: null })) ?? e;
      act = await marcarIncidencia(act, 'cambio', `pide un cambio (${lectura.detalle ?? 'otro día, hora o dirección'}): "${texto.slice(0, 160)}"`);
      await reportar(act, 'confirmacion', payloadConfirmacion({ referencia: act.referencia, phone: act.phone, nombre: act.nombre, confirmada: false, respuesta: texto.slice(0, 300), como: lectura.como, motivo: 'cambio', en }));
      return { atendida: true, entrega: act, resultado: 'cambio', responder: textoDe('cambio', ajustes, contexto(act)) };
    }
    // No esta claro: se pregunta otra vez con las opciones, hasta un tope.
    const intentos = e.confirmacionIntentos + 1;
    if (intentos > ajustes.confirmacionMaxIntentos + 1) {
      const act = await marcarIncidencia(e, 'sin_confirmacion', `contestó varias veces sin decir sí ni no; lo último: "${texto.slice(0, 120)}"`);
      await reportar(act, 'confirmacion', payloadConfirmacion({ referencia: act.referencia, phone: act.phone, nombre: act.nombre, confirmada: false, respuesta: texto.slice(0, 300), como: lectura.como, motivo: 'sin_respuesta', en }));
      return { atendida: true, entrega: act, resultado: 'no_claro_agotado', responder: textoDe('cambio', ajustes, contexto(act)) };
    }
    const act = (await repo.actualizar(e.id, { confirmacionIntentos: intentos, confirmacionRespuesta: texto.slice(0, 300), confirmacionProximoAt: new Date(en.getTime() + ajustes.confirmacionEsperaMin * 60_000) })) ?? e;
    await evento(act, 'nota', `contestó algo que no se entendió${lectura.detalle ? ` (${lectura.detalle})` : ''}: "${texto.slice(0, 120)}"; se le pregunta otra vez`);
    return { atendida: true, entrega: act, resultado: 'no_claro', responder: textoDe('preguntarOtraVez', ajustes, contexto(act)) };
  }

  /**
   * Los de «falta confirmar» con la regla del dueño: la IA solo clasificó
   * (SI / NO / POR QUÉ / OTRA); aquí se hace lo que toca y se devuelve el
   * texto fijo. SÍ y NO se reportan a GSG; tras SÍ, NO u OTRA, silencio.
   */
  async function responderConfirmacionGsg(phone: string, clase: ClaseConfirmarGsg, texto: string, como: string): Promise<{ texto: string; botones?: Array<{ id: string; title: string }>; cerrar: boolean; entrega: Entrega } | null> {
    const vivas = (await repo.vivasPorTelefono(phone)).filter((e) => !e.envioRetenidoAt && e.confirmacionEstado === 'pedida' && grupoDe(e) === 'confirmar');
    const e = vivas.sort((a, b) => (b.confirmacionPedidaAt?.getTime() ?? 0) - (a.confirmacionPedidaAt?.getTime() ?? 0))[0];
    if (!e) return null;
    const en = ahora();
    const respuesta = texto.slice(0, 300);
    const comoConfirmo: 'boton' | 'reglas' | 'ia' = como.includes('botón') ? 'boton' : como.includes('modelo') ? 'ia' : 'reglas';
    if (clase === 'si') {
      let act = (await repo.actualizar(e.id, { confirmacionEstado: 'confirmada', confirmacionAt: en, confirmacionRespuesta: respuesta, confirmacionComo: comoConfirmo, confirmacionProximoAt: null })) ?? e;
      await evento(act, 'confirmada', `confirmó (${como}): "${texto.slice(0, 120)}"; desde aquí no se le escribe más`);
      await reportar(act, 'confirmacion', payloadConfirmacion({ referencia: act.referencia, phone: act.phone, nombre: act.nombre, confirmada: true, respuesta, como: comoConfirmo, en }));
      act = await recalcular(act);
      emitir('entrega.confirmada', act);
      // El mismo cliente con otro pedido de «falta confirmar»: vale el mismo SÍ (nunca dos preguntas).
      for (const otra of (await repo.vivasPorTelefono(phone)).filter((x) => x.id !== act.id && !x.envioRetenidoAt && (x.confirmacionEstado === 'pendiente' || x.confirmacionEstado === 'pedida') && grupoDe(x) === 'confirmar')) {
        let o = (await repo.actualizar(otra.id, { confirmacionEstado: 'confirmada', confirmacionAt: en, confirmacionRespuesta: respuesta, confirmacionComo: comoConfirmo, confirmacionProximoAt: null })) ?? otra;
        await evento(o, 'confirmada', `confirmó junto con ${act.referencia} (el mismo cliente): "${texto.slice(0, 120)}"`);
        await reportar(o, 'confirmacion', payloadConfirmacion({ referencia: o.referencia, phone: o.phone, nombre: o.nombre, confirmada: true, respuesta, como: comoConfirmo, en }));
        o = await recalcular(o);
        emitir('entrega.confirmada', o);
      }
      const m = await motorizadoDe(act).catch(() => null);
      return { texto: textoDe('confirmadaGsg', ajustes, contexto(act, m)), cerrar: true, entrega: act };
    }
    if (clase === 'no' || clase === 'cambio') {
      const motivo = clase === 'no' ? 'no_confirma' : 'cambio';
      let act = (await repo.actualizar(e.id, { confirmacionEstado: 'rechazada', confirmacionAt: en, confirmacionRespuesta: respuesta, confirmacionComo: comoConfirmo, confirmacionProximoAt: null })) ?? e;
      act = await marcarIncidencia(act, motivo, clase === 'no' ? `dijo que NO lo recibe hoy (${como}): "${texto.slice(0, 160)}"` : `pide otro día u otra dirección (${como}): "${texto.slice(0, 160)}"`);
      await reportar(act, 'confirmacion', payloadConfirmacion({ referencia: act.referencia, phone: act.phone, nombre: act.nombre, confirmada: false, respuesta, como: comoConfirmo, motivo, en }));
      const m = await motorizadoDe(act).catch(() => null);
      return { texto: textoDe('noConfirmaGsg', ajustes, contexto(act, m)), cerrar: true, entrega: act };
    }
    if (clase === 'por_que') {
      await evento(e, 'nota', `preguntó por qué se le escribe (${como}): se le explicó y se le volvió a pedir SÍ o NO ("${texto.slice(0, 120)}")`);
      const ctx = contexto(e);
      // Sin empresa en los datos del envío, la de la tienda (la línea no se pierde).
      const envio = ctx.envio && (ctx.envio.empresaNombre || ctx.envio.empresaCodigo) ? ctx.envio : { ...(ctx.envio ?? {}), empresaNombre: deps.nombreNegocio() };
      return { texto: textoDe('porQueConfirmar', ajustes, { ...ctx, envio }), botones: ajustes.usarBotones ? botonesConfirmacion(e) : undefined, cerrar: false, entrega: e };
    }
    // Cualquier otra cosa: el cierre UNA vez, una persona y silencio.
    const act = await marcarIncidencia((await repo.actualizar(e.id, { confirmacionProximoAt: null, confirmacionRespuesta: respuesta })) ?? e, 'consulta', `escribió otra cosa en vez de SÍ o NO (${como}): "${texto.slice(0, 160)}"`);
    const m = await motorizadoDe(act).catch(() => null);
    return { texto: textoDe('cierreAgente', ajustes, contexto(act, m)), cerrar: true, entrega: act };
  }

  /**
   * El mismo cliente con otro pedido hoy que aun no confirmo: en cuanto
   * contesta por uno, se le pregunta por el siguiente en el mismo mensaje
   * (con sus botones), para no hacerle dos preguntas a la vez.
   */
  async function preguntarPorElSiguiente(act: Entrega, base: RespuestaEntregas): Promise<RespuestaEntregas> {
    const siguiente = (await repo.vivasPorTelefono(act.phone)).find((x) => x.id !== act.id && x.confirmacionEstado === 'pendiente' && x.ubicacionEstado !== 'pendiente');
    if (!siguiente) return base;
    const en = ahora();
    const pedida = (await repo.actualizar(siguiente.id, { confirmacionEstado: 'pedida', confirmacionIntentos: siguiente.confirmacionIntentos + 1, confirmacionPedidaAt: en, confirmacionProximoAt: new Date(en.getTime() + ajustes.confirmacionEsperaMin * 60_000), estado: 'esperando_confirmacion' })) ?? siguiente;
    await evento(pedida, 'confirmacion_pedida', `se le preguntó a continuación de ${act.referencia} (el mismo cliente tiene varios pedidos hoy)`);
    return { ...base, responder: `${base.responder ?? ''}\n\n${textoDe('confirmarOtroPedido', ajustes, contexto(pedida))}`.trim(), botones: ajustes.usarBotones ? botonesConfirmacion(pedida) : undefined };
  }

  /**
   * Un motorizado contesta: el tiempo de la entrega que tiene entre manos, o
   * el "entregado" (o el "no estaba nadie") de la que ya lleva con hora.
   */
  /**
   * `fija`: el pedido al que va este trozo, ya decidido (cuando el motorizado
   * mandó varios pedidos en un mensaje). Con ella no se adivina nada.
   */
  async function respuestaDeMotorizado(m: Motorizado, texto: string, opts: { citaId?: string | null; fija?: number } = {}): Promise<RespuestaEntregas> {
    const enManos = await repo.enManosDeMotorizado(m.id);
    const avisadas = await repo.avisadasDeMotorizado(m.id);
    const limpio = texto.toLowerCase();
    // Por palabra completa: «P-1001» no nombra a «P-100».
    const nombrada = (lista: Entrega[]) => lista.find((x) => posicionDeReferencia(limpio, x.referencia) >= 0);
    const corta = leerMotorizadoCorta(texto);

    // El escudo: por este chat no se dan datos de clientes ni se atienden
    // enlaces u ordenes raras. Respuesta fija, sin IA, y queda apuntado.
    const escudo = leerMotorizadoFueraDeFlujo(texto);
    if (escudo.fuera) {
      const donde = enManos[0] ?? avisadas[0];
      if (donde) await evento(donde, 'nota', `${firmaMotorizado(m)} escribió algo fuera del flujo (${escudo.motivo}); se le contestó con el texto fijo: "${texto.slice(0, 120)}"`);
      log('un motorizado escribió fuera del flujo', { motorizado: m.nombre, motivo: escudo.motivo });
      return { atendida: true, resultado: 'motorizado_fuera_de_flujo', responder: textoDe('motorizadoFueraDeFlujo', ajustes, { negocio: deps.nombreNegocio(), motorizado: firmaMotorizado(m) }) };
    }

    // 0. "Me quedo sin moto": hoy no reparte mas. Todo lo suyo pasa a otros.
    if (corta.sinMoto) {
      const r = await traspasarPedidos(m.id, { descanso: true, quien: 'el motorizado', motivo: `avisó que no puede seguir ("${texto.slice(0, 80)}")`, avisarMotorizado: false });
      const pila = m.nombre.split(' ')[0];
      if (!r.ok) return { atendida: true, resultado: 'motorizado_sin_moto', responder: `Entendido, ${pila}. ${r.motivo}` };
      if (!r.resultado.traspasadas.length) return { atendida: true, resultado: 'motorizado_sin_moto', responder: `Entendido, ${pila}: quedas en descanso por hoy, no tenías ningún pedido entre manos. Avísanos cuando puedas volver.` };
      const pedidos = r.resultado.traspasadas.map((x) => x.referencia).join(', ');
      return { atendida: true, entrega: r.resultado.traspasadas[0], resultado: 'motorizado_sin_moto', responder: textoDe('motorizadoTraspaso', ajustes, { ...contexto(r.resultado.traspasadas[0]!, m), pedidos }) };
    }

    // 0b. "Ruta": su lista del dia, en orden.
    if (corta.pideRuta) {
      const ruta = await rutaDeMotorizado(m.id);
      if (ruta && ruta.paradas.length) await evento(ruta.paradas[0]!.entrega, 'nota', `${firmaMotorizado(m)} pidió su ruta (${ruta.paradas.length} paradas)`);
      return { atendida: true, resultado: 'motorizado_ruta', responder: ruta?.texto ?? `Ahora mismo no tienes ningún pedido en camino, ${m.nombre.split(' ')[0]}.` };
    }

    // 1. ¿Dice que entrego (o que no pudo)? Solo cuenta si lleva alguna con hora.
    if (avisadas.length) {
      const nombro = nombrada(avisadas);
      const objetivo = nombro ?? avisadas[0]!;
      const reglas = leerEntregadoConReglas(texto, await frasesPropias());
      // Un "listo" a secas es "entregado" solo si no tiene otro pedido esperando su tiempo.
      const entregado = reglas.entregado || (reglas.flojo && !enManos.length);
      // "Cerca" / "llegando" con un pedido avisado: al cliente se le avisa.
      // Con otro pin esperando su tiempo solo cuenta si nombra el avisado.
      if (!entregado && !reglas.noEntregado && corta.cerca && (!enManos.length || nombro)) return avisarCerca(m, avisadas, nombro, texto);
      let lectura = reglas;
      if (!entregado && !reglas.noEntregado && !enManos.length) {
        lectura = await leerEntregado(texto, ia(), log, await frasesPropias());
        if (lectura.como === 'ia') await evento(objetivo, 'ia', `la IA leyó al motorizado: ${lectura.entregado ? 'entregado' : lectura.noEntregado ? 'no pudo entregar' : lectura.cerca ? 'está cerca' : 'no está claro'}${lectura.detalle ? ` (${lectura.detalle})` : ''}`, { texto: texto.slice(0, 300) });
        if (lectura.cerca && !lectura.entregado && !lectura.noEntregado) return avisarCerca(m, avisadas, nombro, texto);
      }
      if (lectura.noEntregado) {
        const r = await noPudoEntregar(objetivo, m, texto, lectura.detalle);
        return { atendida: true, entrega: r.entrega, resultado: r.preguntada ? 'motorizado_no_entregado_preguntamos' : 'motorizado_no_entregado', responder: textoDe(r.preguntada ? 'motorizadoNoEntregadoPreguntamos' : 'motorizadoNoEntregado', ajustes, contexto(r.entrega, m)) };
      }
      if (entregado || lectura.entregado) {
        const act = await darPorEntregada(objetivo, m, lectura.como === 'ia' ? 'ia' : 'reglas', texto);
        // Los otros pedidos del mismo cliente que llevaba en el mismo viaje se
        // entregaron en la misma puerta: se cierran juntos (un solo gracias).
        const juntas = avisadas.filter((x) => x.id !== objetivo.id && x.phone === objetivo.phone);
        for (const h of juntas) await darPorEntregada(h, m, lectura.como === 'ia' ? 'ia' : 'reglas', texto, { sinGracias: true });
        const otras = avisadas.filter((x) => x.phone !== objetivo.phone);
        return { atendida: true, entrega: act, resultado: 'motorizado_entregado', responder: respuestaEntregadoAlMotorizado(act, m, otras.length > 0 && !nombro) };
      }
    }

    if (!enManos.length) {
      if (avisadas.length) {
        const lista = avisadas.map((x) => x.referencia).join(', ');
        return { atendida: true, resultado: 'motorizado_sin_pendientes', responder: `Gracias, ${m.nombre.split(' ')[0]}. Tienes en camino ${lista}. Cuando lo dejes, escríbeme "entregado" (o "entregado ${avisadas[0]!.referencia}" si llevas varios), o mándame la foto.` };
      }
      return { atendida: true, resultado: 'motorizado_sin_pendientes', responder: `Gracias, ${m.nombre.split(' ')[0]}. Ahora mismo no tienes ningún pedido esperando tu tiempo; te escribo en cuanto haya uno.` };
    }
    // Varios pedidos en un mensaje («G-3002 20, G-3001 45»): cada trozo va a
    // SU pedido, ya fijado. El que quedó resuelto por otro trozo del mismo
    // mensaje (iba en el mismo viaje) se salta: nunca se le pasa a otro.
    const nombradas = opts.fija == null ? enManos.filter((x) => posicionDeReferencia(limpio, x.referencia) >= 0) : [];
    if (nombradas.length > 1) {
      const cortes = nombradas.map((x) => ({ x, i: posicionDeReferencia(limpio, x.referencia) })).sort((a, b) => a.i - b.i);
      const respuestas: string[] = [];
      let ultima: RespuestaEntregas | null = null;
      for (let k = 0; k < cortes.length; k++) {
        const { x } = cortes[k]!;
        if (k > 0 && !(await repo.enManosDeMotorizado(m.id)).some((y) => y.id === x.id)) continue;
        const trozo = sinUnionFinal(texto.slice(cortes[k]!.i, k + 1 < cortes.length ? cortes[k + 1]!.i : undefined));
        ultima = await respuestaDeMotorizado(m, trozo, { fija: x.id });
        if ('responder' in ultima && ultima.responder) respuestas.push(ultima.responder);
      }
      return { ...(ultima ?? { atendida: true }), atendida: true, responder: respuestas.join('\n\n') } as RespuestaEntregas;
    }
    // Respondió citando el mensaje de un pedido: ese.
    // (Vale el mensaje del pedido y también el pin que se le mandó aparte.)
    let porCita: Entrega | null = null;
    if (opts.citaId && opts.fija == null) {
      for (const x of enManos) {
        const evs = await repo.eventos(x.id, 40).catch(() => [] as EventoEntrega[]);
        if (evs.some((ev) => ev.tipo === 'motorizado_enviado' && wamidsDelEvento(ev.payload).some((w) => mismoMensaje(w, opts.citaId!)))) { porCita = x; break; }
      }
    }
    // Si nombra el pedido ("P-1002 40") o cita su mensaje, ese. Con un solo
    // viaje pendiente, ese. Con VARIOS clientes esperando su tiempo y sin
    // decir cuál, se le pregunta: adivinar le ponía el tiempo (o el «no») al
    // pedido equivocado (26/09: un «no» de Chesco soltó G-3001 al azar).
    // Con el pedido ya fijado (un trozo de un mensaje con varios), ese y
    // ningún otro: «si queda un solo cliente, ese» le daba los minutos de
    // P-2001 a P-1002 y a su cliente un aviso de llegada falso.
    const clientes = new Set(enManos.map((x) => x.phone));
    if (opts.fija != null && !enManos.some((x) => x.id === opts.fija)) {
      return { atendida: true, resultado: 'motorizado_sin_pendientes', responder: '' };
    }
    const elegido = opts.fija != null ? enManos.find((x) => x.id === opts.fija)! : (nombrada(enManos) ?? porCita ?? (clientes.size === 1 ? enManos[0]! : null));
    if (!elegido) {
      const lista = enManos.filter((x, i, arr) => arr.findIndex((y) => y.phone === x.phone) === i).map((x) => `• ${x.referencia} — ${x.nombre ?? x.phone}${x.distrito ? ` (${x.distrito})` : ''}`).join('\n');
      await evento(enManos[0]!, 'nota', `${firmaMotorizado(m)} contestó sin decir a qué pedido ("${texto.slice(0, 80)}") y tiene ${clientes.size} esperando su tiempo: se le pregunta cuál`);
      return { atendida: true, resultado: 'motorizado_cual', responder: `${m.nombre.split(' ')[0]}, tienes ${clientes.size} pedidos esperando tu tiempo:
${lista}

¿Para cuál es? Responde con el pedido y los minutos, por ejemplo «${enManos[0]!.referencia} 30» (puedes mandar varios: «${enManos[0]!.referencia} 30, ${enManos.find((x) => x.phone !== enManos[0]!.phone)!.referencia} 45»), o responde citando el mensaje del pedido. Si no puedes llevar uno, escribe «no» y su pedido.` };
    }
    const e = elegido;
    const lectura = await leerTiempo(texto, { ahora: ahora(), timezone: tz(), ia: ia(), log, propias: await frasesPropias() });
    const en = ahora();
    if (lectura.como === 'ia') await evento(e, 'ia', `la IA leyó al motorizado: ${lectura.rechaza ? 'no puede' : lectura.minutos != null ? `${lectura.minutos} min` : 'no está claro'}${lectura.detalle ? ` (${lectura.detalle})` : ''}`, { texto: texto.slice(0, 300) });

    if (lectura.rechaza) {
      await evento(e, 'motorizado_respondio', `${firmaMotorizado(m)} no puede llevarlo: "${texto.slice(0, 120)}"`);
      const act = await descartarMotorizado(e, m, 'no puede llevarlo');
      return { atendida: true, entrega: act, resultado: 'motorizado_rechaza', responder: `Ok, ${m.nombre.split(' ')[0]}: ${e.referencia} se lo paso a otro. Gracias por avisar.` };
    }
    if (lectura.minutos === null) {
      const intentos = e.motorizadoIntentos + 1;
      if (intentos > ajustes.motorizadoMaxIntentos + 1) {
        await evento(e, 'motorizado_respondio', `${firmaMotorizado(m)} contestó varias veces sin un tiempo: "${texto.slice(0, 120)}"`);
        const act = await descartarMotorizado(e, m, 'no dio un tiempo');
        return { atendida: true, entrega: act, resultado: 'motorizado_no_claro_agotado', responder: `No te entendí y ${e.referencia} se lo paso a otro. Cuando puedas, responde solo con los minutos.` };
      }
      const act = (await repo.actualizar(e.id, { motorizadoIntentos: intentos, motorizadoRespuesta: texto.slice(0, 300), motorizadoProximoAt: new Date(en.getTime() + ajustes.motorizadoEsperaMin * 60_000) })) ?? e;
      await evento(act, 'nota', `${firmaMotorizado(m)} contestó sin un tiempo claro: "${texto.slice(0, 120)}"; se le pregunta otra vez`);
      return { atendida: true, entrega: act, resultado: 'motorizado_no_claro', responder: textoDe('motorizadoPreguntarOtraVez', ajustes, contextoMotorizado(contexto(act, m))) };
    }

    // ¿El tiempo cuadra con la distancia? Si no, se le pregunta "¿seguro?"
    // una sola vez; si insiste, vale lo que diga.
    const kmHastaElPin = e.lat != null && e.lng != null && m.ultimaLat != null && m.ultimaLng != null && m.ultimaPosicionAt && ahora().getTime() - m.ultimaPosicionAt.getTime() < 12 * 3_600_000 ? haversineKm({ lat: m.ultimaLat, lng: m.ultimaLng }, { lat: e.lat, lng: e.lng }) : null;
    if (!e.motorizadoTiempoDudosoAt && tiempoDudoso(lectura.minutos, kmHastaElPin)) {
      const act = (await repo.actualizar(e.id, { motorizadoTiempoDudosoAt: en, motorizadoTiempoDudosoMin: lectura.minutos, motorizadoRespuesta: texto.slice(0, 300) })) ?? e;
      await evento(act, 'nota', `${firmaMotorizado(m)} dijo ${minutosEnPalabras(lectura.minutos)} para ${distanciaEnPalabras(kmHastaElPin!)}: no cuadra, se le pregunta "¿seguro?" una vez`);
      return { atendida: true, entrega: act, resultado: 'motorizado_tiempo_dudoso', responder: textoDe('motorizadoTiempoDudoso', ajustes, { ...contexto(act, m), km: distanciaEnPalabras(kmHastaElPin!).replace(/^a /, '') }) };
    }

    // Tiene tiempo: el margen encima y el aviso al cliente.
    const minutosAviso = lectura.minutos + ajustes.margenMinutos;
    const llegaAproxAt = new Date(en.getTime() + minutosAviso * 60_000);
    let act = (await repo.actualizar(e.id, {
      motorizadoEstado: 'respondio',
      motorizadoRespuesta: texto.slice(0, 300),
      motorizadoRespondioAt: en,
      motorizadoProximoAt: null,
      minutosMotorizado: lectura.minutos,
      minutosAviso,
      llegaAproxAt,
      // «Urgente» se quita solo: el pedido ya tiene quien lo lleve (pedido del dueño, 25/09).
      ...(e.prioridad === 'urgente' ? { prioridad: 'normal' as const } : {}),
    })) ?? e;
    if (e.prioridad === 'urgente') await evento(act, 'nota', `deja de ser urgente: ${firmaMotorizado(m)} ya lo lleva`);
    await evento(act, 'motorizado_respondio', `${firmaMotorizado(m)} dijo ${minutosEnPalabras(lectura.minutos)} (${lectura.como}${lectura.detalle ? `: ${lectura.detalle}` : ''}); con el margen de ${ajustes.margenMinutos} min, al cliente se le dice ${minutosEnPalabras(minutosAviso)} (hacia las ${horaEnReloj(llegaAproxAt, tz())})`);
    // Su ultima posicion conocida pasa a ser el pin de este pedido: hacia ahi va.
    await repo.actualizarMotorizado(m.id, { entregasHoy: (m.entregasHoyDia === hoy() ? m.entregasHoy : 0) + 1, entregasHoyDia: hoy(), ultimoEncargoAt: en, ...(act.lat != null && act.lng != null ? { ultimaLat: act.lat, ultimaLng: act.lng, ultimaPosicionAt: en } : {}) });

    // Los otros pedidos del mismo cliente que iban en el mismo viaje: misma
    // hora, un solo aviso al cliente (nombrando a todos) y GSG se entera de cada uno.
    const mismoViaje = enManos.filter((x) => x.id !== act.id && x.phone === act.phone);
    for (const h of mismoViaje) {
      await repo.actualizar(h.id, { motorizadoEstado: 'respondio', motorizadoRespuesta: texto.slice(0, 300), motorizadoRespondioAt: en, motorizadoProximoAt: null, minutosMotorizado: lectura.minutos, minutosAviso, llegaAproxAt, ...(h.prioridad === 'urgente' ? { prioridad: 'normal' as const } : {}) });
      await evento(h, 'motorizado_respondio', `mismo viaje que ${act.referencia}: ${minutosEnPalabras(lectura.minutos)}`);
    }
    act = await avisarLlegada(act, m, mismoViaje);
    return { atendida: true, entrega: act, resultado: 'motorizado_tiempo', responder: textoDe('motorizadoGracias', ajustes, { ...contexto(act, m), pedido: mismoViaje.length ? enLista(refsDe([act, ...mismoViaje])) : act.referencia }) };
  }

  /** Redacta y manda el aviso de llegada al cliente; lo cuenta a GSG. */
  async function avisarLlegada(e: Entrega, m: Motorizado, mismoViaje: Entrega[] = []): Promise<Entrega> {
    const ctx = mismoViaje.length ? { ...contexto(e, m), pedido: nombreDelGrupo([e, ...mismoViaje]) } : contexto(e, m);
    let texto = textoDe('avisoLlegada', ajustes, ctx);
    // Con «Solo lo de GSG» ningun texto del modelo le llega a un cliente.
    if (ajustes.redactarConIA && !modoGsg()) {
      const modelo = deps.ia?.();
      if (modelo) {
        try {
          const cruda = await modelo.completar(
            [
              { role: 'system', content: `Eres el asistente de WhatsApp de "${deps.nombreNegocio()}" en Perú. Reescribe el aviso de abajo para el cliente de forma natural y cálida, en una o dos frases, tuteando o tratando de usted igual que el original. OBLIGATORIO: conserva exactamente el tiempo "${ctx.minutos != null ? minutosEnPalabras(ctx.minutos) : ''}" y la hora "${ctx.hora ?? ''}" tal cual. No añadas datos ni promesas. Devuelve solo el mensaje.` },
              { role: 'user', content: texto },
            ],
            { maxTokens: 160 },
          );
          const limpia = cruda.trim();
          if (limpia && (!ctx.hora || limpia.includes(ctx.hora)) && (ctx.minutos == null || limpia.includes(minutosEnPalabras(ctx.minutos)))) texto = limpia;
          else await evento(e, 'ia', 'la IA redactó el aviso pero le faltaba la hora o los minutos: sale el texto de siempre');
        } catch (error) {
          log('la IA no pudo redactar el aviso de llegada: sale el texto de siempre', { detalle: error instanceof Error ? error.message : String(error) });
        }
      }
    }
    const salida = await enviarA(e.phone, texto, 'aviso', [(e.nombre ?? '').trim().split(/\s+/)[0] || 'buenas tardes', e.referencia, ctx.hora ?? ''], { separacionMs: 0, maxPorDia: 20 });
    if (!salida.ok) {
      // Frenado por el ritmo del numero (o un fallo pasajero de WhatsApp): el
      // motor lo vuelve a intentar en cuanto toque. Solo lo definitivo (sin
      // plantilla, numero rechazado) se aparta para una persona.
      const pasajero = !('sinPlantilla' in salida) && (salida.blocked ? salida.retryAfterMs !== undefined : salida.retryable);
      if (pasajero) {
        const enMs = ('retryAfterMs' in salida && salida.retryAfterMs) || 60_000;
        const act = (await repo.actualizar(e.id, { motorizadoProximoAt: new Date(ahora().getTime() + enMs) })) ?? e;
        await evento(act, 'nota', `el aviso de llegada espera su turno (${'reason' in salida ? salida.reason : salida.error}); se reintenta en ${Math.max(1, Math.round(enMs / 1000))} s`);
        return act;
      }
      const motivo = 'reason' in salida ? salida.reason : salida.error;
      await evento(e, 'incidencia', `no se pudo avisar al cliente: ${motivo}`);
      const act = await marcarIncidencia(e, 'aviso_no_enviado', `el aviso de llegada no salió: ${motivo}`);
      return act;
    }
    let act = (await repo.actualizar(e.id, { avisoEnviadoAt: ahora() })) ?? e;
    // Frenado por la regla del dueño: la bitácora lo dice tal cual (28/09:
    // decía «avisado al cliente» y el mensaje nunca salió).
    const callado = await noSalioAlCliente(e.phone, salida);
    if (callado) await evento(act, 'nota', `no se le escribe al cliente la hora (${callado}); se le dirá si lo pregunta: llega hacia las ${ctx.hora ?? '?'}`, { avisoNoEnviado: true, motivo: callado });
    else await evento(act, 'aviso', `avisado al cliente: "${texto.slice(0, 200)}"`);
    await reportar(act, 'entrega', payloadEntregaDe(act, m));
    act = await recalcular(act);
    emitir('entrega.avisada', act, m);
    for (const h of mismoViaje) {
      let hAct = (await repo.actualizar(h.id, { avisoEnviadoAt: ahora() })) ?? h;
      if (callado) await evento(hAct, 'nota', `no se le escribe al cliente la hora (${callado}), igual que ${e.referencia} (mismo viaje); se le dirá si lo pregunta`, { avisoNoEnviado: true, motivo: callado });
      else await evento(hAct, 'aviso', `avisado al cliente junto con ${e.referencia} (mismo viaje)`);
      await reportar(hAct, 'entrega', payloadEntregaDe(hAct, m));
      hAct = await recalcular(hAct);
      emitir('entrega.avisada', hAct, m);
    }
    return act;
  }

  /**
   * «Ojo: {pedido} ya no lo llevas tú», UNA vez.
   *
   * Cancelar dos veces seguidas (o cancelar mientras se reasigna) lo mandaba
   * dos veces al mismo motorizado (26/09): el envío tarda unos segundos y la
   * segunda vuelta leía el pedido todavía asignado. Se descarta si ya va uno
   * igual en camino o si ese mismo texto ya le salió DESPUÉS de la última vez
   * que se le mandó este pedido: si se le vuelve a dar y se le vuelve a
   * quitar, el aviso sale otra vez (una ventana ciega de 24 h lo callaba).
   */
  async function avisarCancelado(e: Entrega, m: Motorizado): Promise<void> {
    const texto = textoDe('motorizadoCancelado', ajustes, contexto(e, m));
    // La última vez que se le mandó este pedido a ESTE motorizado (sus mensajes).
    const evs = await repo.eventos(e.id, 500).catch(() => [] as EventoEntrega[]);
    const ultimoEnvio = [...evs].reverse().find((ev) => ev.tipo === 'motorizado_enviado' && (ev.payload as { motorizadoId?: number } | null)?.motorizadoId === m.id && wamidsDelEvento(ev.payload).length > 0);
    const deEseEnvio = ultimoEnvio ? wamidsDelEvento(ultimoEnvio.payload) : [];
    const clave = `${m.phone}|${texto}|${ultimoEnvio?.id ?? ''}`;
    if (avisosCanceladoEnCamino.has(clave)) return;
    avisosCanceladoEnCamino.add(clave);
    try {
      const c = await repos.contacts.getByPhone(m.phone).catch(() => null);
      const recientes = c ? await repos.messages.listMessages(c.id, 40).catch(() => []) : [];
      // Solo cuenta lo que salió después de ese envío (el hilo viene en orden de lectura).
      let corte = -1;
      recientes.forEach((x, i) => {
        if (x.wamid && deEseEnvio.some((w) => mismoMensaje(w, x.wamid!))) corte = i;
      });
      if (recientes.slice(corte + 1).some((x) => x.direction === 'out' && String(x.body ?? '').trim() === texto.trim())) return;
      const salida = await sender.send({ phone: m.phone, kind: 'freeform', category: 'UTILITY', origen: 'sistema', text: texto, limitesContacto: { separacionMs: 0, maxPorDia: 500 } }).catch((error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }));
      if (!salida.ok) {
        // Que se vea: el motorizado puede seguir yendo a un pedido que ya no es suyo.
        const motivo = 'reason' in salida ? salida.reason : 'error' in salida ? salida.error : 'no se pudo enviar';
        await evento(e, 'incidencia', `no se le pudo avisar a ${firmaMotorizado(m)} que ya no lleva ${e.referencia}: ${String(motivo).slice(0, 160)}. Llámalo para avisarle.`).catch(() => undefined);
      }
    } finally {
      // Un rato más: lo enviado tarda en quedar guardado en el hilo.
      setTimeout(() => avisosCanceladoEnCamino.delete(clave), 60_000).unref?.();
    }
  }

  async function avisarMotorizadoQueSeCancela(e: Entrega): Promise<void> {
    if (!e.motorizadoId || e.motorizadoEstado === 'sin_asignar') return;
    const m = await repo.motorizado(e.motorizadoId);
    if (!m) return;
    await avisarCancelado(e, m);
    await repo.actualizar(e.id, { motorizadoEstado: 'sin_asignar', motorizadoId: null, motorizadoProximoAt: null });
  }

  /** Este motorizado no lo lleva: se apunta para no volver a darselo y queda lista para otro. */
  async function descartarMotorizado(e: Entrega, m: Motorizado, motivo: string): Promise<Entrega> {
    const descartados = [...new Set([...e.motorizadosDescartados, m.id])];
    const act = (await repo.actualizar(e.id, { motorizadosDescartados: descartados, motorizadoId: null, motorizadoEstado: 'sin_asignar', motorizadoIntentos: 0, motorizadoEnviadoAt: null, motorizadoProximoAt: null, motorizadoRespuesta: null, estado: 'lista' })) ?? e;
    await evento(act, 'nota', `${firmaMotorizado(m)} queda descartado para este pedido (${motivo}); se busca otro`);
    return act;
  }

  // ----------------------------------------------------------- el motor

  async function pedirConfirmacion(e: Entrega): Promise<{ ok: boolean; motivo?: string; retryAfterMs?: number }> {
    const en = ahora();
    // Lo que espera confirmar el envio no sale (el motor ya no lo trae, pero por si acaso).
    if (e.envioRetenidoAt) return { ok: false, motivo: 'espera que una persona confirme el envío' };
    // Regla del dueño: al grupo de la ubicación no se le pregunta SÍ/NO (tras UBI
    // REGISTRADA, silencio). Al de «falta confirmar» (GSG ya tiene su
    // dirección) SÍ: la pregunta SÍ/NO con los datos del envío, nunca la ubicación.
    const conRegla = reglaGsgActiva();
    if (conRegla && grupoDe(e) !== 'confirmar') {
      const act = (await repo.actualizar(e.id, { confirmacionEstado: 'no_hace_falta', confirmacionProximoAt: null })) ?? e;
      await evento(act, 'nota', 'no se le pregunta SÍ/NO: con «Solo lo de GSG» solo se le pide la ubicación');
      await recalcular(act);
      return { ok: true };
    }
    if (e.confirmacionIntentos >= ajustes.confirmacionMaxIntentos) {
      const act = await marcarIncidencia(e, 'sin_confirmacion', `no contestó a ${e.confirmacionIntentos} mensajes pidiendo confirmar`);
      await reportar(act, 'confirmacion', payloadConfirmacion({ referencia: act.referencia, phone: act.phone, nombre: act.nombre, confirmada: false, respuesta: null, como: null, motivo: 'sin_respuesta', en }));
      return { ok: false, motivo: 'agotó los intentos: pasa a una persona' };
    }
    // Si a este cliente ya se le pregunto por OTRO pedido y aun no contesto,
    // este espera su turno: una pregunta a la vez.
    const enCurso = (await repo.vivasPorTelefono(e.phone)).find((x) => x.id !== e.id && x.confirmacionEstado === 'pedida' && x.confirmacionProximoAt && x.confirmacionProximoAt.getTime() > en.getTime());
    if (enCurso) {
      const esperaMs = Math.max(60_000, enCurso.confirmacionProximoAt!.getTime() - en.getTime() + 60_000);
      await repo.actualizar(e.id, { confirmacionProximoAt: new Date(en.getTime() + esperaMs) });
      return { ok: false, motivo: `espera a que el cliente conteste por ${enCurso.referencia}`, retryAfterMs: esperaMs };
    }
    const primera = e.confirmacionIntentos === 0;
    const texto = conRegla
      ? textoDe(primera ? 'confirmarEntregaGsg' : 'recordarConfirmarGsg', ajustes, contexto(e))
      : textoDe(primera ? 'pedirConfirmacion' : 'insistirConfirmacion', ajustes, contexto(e));
    const salida = await enviarA(e.phone, texto, 'confirmacion', variablesCliente(e), { separacionMs: Math.min(ajustes.confirmacionEsperaMin * 60_000, 60_000), maxPorDia: ajustes.confirmacionMaxIntentos + 3 }, botonesConfirmacion(e), { conReglaGsg: conRegla });
    if (!salida.ok) {
      if ('sinPlantilla' in salida) {
        const act = await marcarIncidencia(e, 'sin_plantilla', salida.reason);
        await reportar(act, 'confirmacion', payloadConfirmacion({ referencia: act.referencia, phone: act.phone, nombre: act.nombre, confirmada: false, respuesta: null, como: null, motivo: 'sin_plantilla', en }));
        return { ok: false, motivo: salida.reason };
      }
      if (salida.blocked) {
        await repo.actualizar(e.id, { confirmacionProximoAt: new Date(en.getTime() + (salida.retryAfterMs ?? 15 * 60_000)) });
        return { ok: false, motivo: salida.reason, retryAfterMs: salida.retryAfterMs };
      }
      if (salida.retryable) {
        await repo.actualizar(e.id, { confirmacionProximoAt: new Date(en.getTime() + 3 * 60_000) });
        await evento(e, 'incidencia', `WhatsApp no pudo enviar (se reintenta): ${salida.error}`);
        return { ok: false, motivo: salida.error, retryAfterMs: 3 * 60_000 };
      }
      const act = await marcarIncidencia(e, 'error_envio', `WhatsApp rechazó el mensaje de confirmación: ${salida.error.slice(0, 200)}`);
      await reportar(act, 'confirmacion', payloadConfirmacion({ referencia: act.referencia, phone: act.phone, nombre: act.nombre, confirmada: false, respuesta: null, como: null, motivo: 'error_envio', en }));
      return { ok: false, motivo: salida.error };
    }
    const act = (await repo.actualizar(e.id, { confirmacionEstado: 'pedida', confirmacionIntentos: e.confirmacionIntentos + 1, confirmacionPedidaAt: en, confirmacionProximoAt: new Date(en.getTime() + ajustes.confirmacionEsperaMin * 60_000), estado: 'esperando_confirmacion' })) ?? e;
    await evento(act, 'confirmacion_pedida', primera ? 'se le pidió confirmar el pedido' : `se le volvió a pedir (intento ${act.confirmacionIntentos})`, { wamid: salida.wamid });
    return { ok: true };
  }

  /**
   * A quien se le da el pedido: primero el que hoy anda cerca (su ultima
   * posicion conocida -el pin de su ultimo pedido- a menos de 6 km del pin,
   * del mas cercano al mas lejano, y sin otro pin sin contestar), luego los
   * de la zona del distrito, luego el resto; y dentro de cada grupo el menos
   * cargado y el que lleva mas tiempo sin encargo.
   */
  async function elegirMotorizado(e: Entrega): Promise<Motorizado | null> {
    // Lo de prueba (Modulo desarrollador) con lo de prueba y lo real con lo
    // real: un pedido inventado no puede llegarle por WhatsApp a un motorizado
    // de verdad, ni un pedido de un cliente real quedarse en uno de prueba.
    // (El numero conectado puede ser motorizado para PRUEBAS: los pedidos le
    // llegan al chat «Tú» y lo que conteste ahí cuenta como del motorizado; ver
    // onPropio en src/web/local-routes.ts.)
    const todos = (await repo.listarMotorizados()).filter((m) => m.estado === 'activo' && !e.motorizadosDescartados.includes(m.id) && mismoMundo(e.phone, m.phone));
    if (!todos.length) return null;
    // Reservada para uno concreto (una persona la forzo y el envio quedo
    // para mas tarde): ese, mientras siga activo.
    if (e.motorizadoId && e.motorizadoEstado === 'sin_asignar') {
      const reservado = todos.find((m) => m.id === e.motorizadoId);
      if (reservado) return reservado;
    }
    const dia = hoy();
    const plano = (x: string | null | undefined): string => (x ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const distrito = plano(e.distrito);
    // Sin distrito (p. ej. un pedido sin ubicación): la dirección escrita
    // cuenta si nombra alguna de las zonas del motorizado.
    const direccion = plano(e.direccion);
    const deZona = (m: Motorizado) => {
      const zona = plano(m.zona);
      if (!zona) return false;
      if (distrito) return zona.includes(distrito);
      return Boolean(direccion) && zona.split(/[,;/|]+/).map((z) => z.trim()).some((z) => z.length >= 3 && direccion.includes(z));
    };
    const kmHasta = (m: Motorizado): number | null => {
      if (e.lat == null || e.lng == null || m.ultimaLat == null || m.ultimaLng == null || !m.ultimaPosicionAt) return null;
      const diaPosicion = new Intl.DateTimeFormat('en-CA', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(m.ultimaPosicionAt).slice(0, 10);
      if (diaPosicion !== dia) return null;
      return haversineKm({ lat: e.lat, lng: e.lng }, { lat: m.ultimaLat, lng: m.ultimaLng });
    };
    const enManos = new Map<number, number>();
    for (const m of todos) enManos.set(m.id, (await repo.enManosDeMotorizado(m.id)).length);
    const carga = (m: Motorizado) => (m.entregasHoyDia === dia ? m.entregasHoy : 0) + (enManos.get(m.id) ?? 0);
    const km = new Map(todos.map((m) => [m.id, kmHasta(m)]));
    // Cerca solo cuenta si no tiene otro pin sin contestar: al que aun no
    // dijo si lleva el anterior no se le apila un segundo.
    const grupo = (m: Motorizado): number => {
      const d = km.get(m.id) ?? null;
      if (d !== null && d <= KM_CERCA && (enManos.get(m.id) ?? 0) === 0) return 0;
      return deZona(m) ? 1 : 2;
    };
    return (
      [...todos].sort(
        (a, b) =>
          grupo(a) - grupo(b) ||
          (grupo(a) === 0 ? (km.get(a.id) ?? 0) - (km.get(b.id) ?? 0) : 0) ||
          carga(a) - carga(b) ||
          (a.ultimoEncargoAt?.getTime() ?? 0) - (b.ultimoEncargoAt?.getTime() ?? 0) ||
          a.id - b.id,
      )[0] ?? null
    );
  }

  async function mandarAMotorizado(e: Entrega): Promise<{ ok: boolean; motivo?: string; retryAfterMs?: number; motorizado?: Motorizado }> {
    // Va con motorizado sin ubicación (el cierre le dio su número): sin pin.
    if ((e.lat == null || e.lng == null) && e.motorizadoSinUbicacionAt && e.ubicacionEstado === 'pendiente') return mandarSinUbicacion(e);
    if (e.lat == null || e.lng == null) {
      await marcarIncidencia(e, 'sin_pin', 'está lista pero no tiene coordenadas: no se puede mandar a un motorizado');
      return { ok: false, motivo: 'sin coordenadas' };
    }
    const m = await elegirMotorizado(e);
    // Sin motorizado disponible NO es algo del cliente (él no pidió nada): el
    // pedido se queda como «ubicación registrada, esperando motorizado», sin
    // pasar a «necesita a alguien», y el motor lo reintenta solo cada pocos
    // minutos hasta que haya uno (queja del dueño, 25/09). La falta de
    // motorizados se ve en la franja de Hoy («Ningún motorizado activo»).
    if (!m) {
      if (e.estado === 'incidencia' && e.incidencia === 'sin_motorizado') {
        await repo.actualizar(e.id, { estado: 'lista', incidencia: null, incidenciaDetalle: null, requiereHumano: false });
      } else if (e.estado === 'lista' && !e.motorizadosDescartados.length && e.motorizadoEstado !== 'sin_asignar') {
        await evento(e, 'nota', 'no hay ningún motorizado activo: se le asigna uno en cuanto haya');
      }
      return { ok: false, motivo: e.motorizadosDescartados.length ? 'ningún motorizado activo puede llevarla' : 'no hay ningún motorizado activo', retryAfterMs: 3 * 60_000 };
    }
    // El motorizado es de la casa: su consentimiento es su alta.
    const contacto = await repos.contacts.upsertFromInbound(m.phone, m.nombre);
    if (!contacto.optInAt) await repos.contacts.setOptIn(m.phone, 'motorizado');

    const en = ahora();
    // Los otros pedidos LISTOS del mismo cliente van en el mismo viaje: un
    // solo pin y un solo mensaje al motorizado.
    const hermanas = (await repo.vivasPorTelefono(e.phone)).filter((x) => x.id !== e.id && x.estado === 'lista' && x.lat != null && x.lng != null && !x.segundaVisita && !(x.motorizadoId && x.motorizadoEstado === 'sin_asignar' && x.motorizadoId !== m.id));
    const refs = [e.referencia, ...hermanas.map((x) => x.referencia)];
    const pedidoTexto = hermanas.length ? `${enLista(refs)} (${refs.length} pedidos del mismo cliente, un solo pin)` : e.referencia;
    const ctx = contextoMotorizado({ ...contexto(e, m), pedido: pedidoTexto });
    // La ubicación salió de la dirección que escribió el cliente: va con él (es aproximada).
    const conDireccionEscrita = e.ubicacionFuente === FUENTE_DIRECCION_ESCRITA && e.direccionCliente ? `\n📍 Dirección que escribió el cliente (la ubicación es aproximada): ${e.direccionCliente}` : '';
    // Las coordenadas en texto y el enlace del mapa van en el mismo mensaje
    // (pedido del dueño, 26/09): se copian a cualquier app y no dependen de
    // que el pin de WhatsApp llegue o se abra.
    const conCoordenadas = e.lat != null && e.lng != null ? `\n📍 Ubicación: ${e.lat.toFixed(6)}, ${e.lng.toFixed(6)}\n${enlaceMapa(e.lat, e.lng)}` : '';
    // Ya tiene otro cliente esperando su tiempo: se le dice cómo contestar
    // para que cada tiempo vaya a su pedido.
    // Se cuentan TODOS sus pedidos esperando tiempo (los de este viaje y los
    // que ya tenía, también los de un mismo cliente): con P-1001 y P-2001 de
    // un cliente y P-1002 de otro son 3, no 2.
    const yaEnManos = (await repo.enManosDeMotorizado(m.id).catch(() => [] as Entrega[])).filter((x) => x.motorizadoEstado === 'enviado' && !refs.includes(x.referencia));
    const otrosPendientes = yaEnManos.filter((x) => x.phone !== e.phone);
    const todasLasRefs = [...refs, ...yaEnManos.map((x) => x.referencia)];
    const variosPendientes = otrosPendientes.length
      ? `\n\n📌 Tienes ${todasLasRefs.length} pedidos esperando tu tiempo (${enLista(todasLasRefs)}). Responde con el pedido y los minutos, por ejemplo «${e.referencia} 30», o responde citando este mensaje.`
      : '';
    const base = textoDe(e.segundaVisita ? 'motorizadoSegundaVisita' : 'motorizadoNuevo', ajustes, ctx);
    // Con varios, «Responde solo con los minutos (ej. 40).» contradice lo de
    // abajo: fuera hasta el fin de la línea (cortar en el primer punto dejaba «40).» colgando).
    const texto = (variosPendientes ? base.replace(/[ \t]*Responde solo con los minutos[^\n]*/i, '').replace(/[ \t]+$/gm, '') : base) + conCoordenadas + conDireccionEscrita + variosPendientes;
    // Con la plantilla de Meta (ventana cerrada) el texto es fijo: la marca de urgente va pegada a la referencia.
    const salida = await enviarA(m.phone, texto, 'motorizado', [(e.nombre ?? '').trim() || e.phone, e.prioridad === 'urgente' ? `URGENTE ${enLista(refs)}` : enLista(refs), enlaceMapa(e.lat, e.lng)], { separacionMs: 0, maxPorDia: 500 });
    if (!salida.ok) {
      if ('sinPlantilla' in salida) {
        await marcarIncidencia(e, 'sin_plantilla', `no se le puede escribir al motorizado ${firmaMotorizado(m)}: ${salida.reason}`);
        return { ok: false, motivo: salida.reason };
      }
      if (salida.blocked) return { ok: false, motivo: salida.reason, retryAfterMs: salida.retryAfterMs ?? 5 * 60_000 };
      if (salida.retryable) return { ok: false, motivo: salida.error, retryAfterMs: 3 * 60_000 };
      // Un numero de motorizado que WhatsApp rechaza: fuera de la lista para este pedido, y se avisa.
      await evento(e, 'incidencia', `WhatsApp rechazó el envío a ${firmaMotorizado(m)}: ${salida.error.slice(0, 160)}`);
      await avisarSupervisor(`El número del motorizado ${firmaMotorizado(m)} (${m.phone}) no recibe mensajes: ${salida.error.slice(0, 120)}. Revísalo en Entregas del día.`, [m.phone]);
      await descartarMotorizado(e, m, 'WhatsApp rechazó su número');
      return { ok: false, motivo: salida.error };
    }
    // El pin aparte también se guarda: si el motorizado contesta citando el
    // pin (y no el texto), la cita tiene que encontrar su pedido.
    const wamids = [salida.wamid];
    if (ajustes.mandarPinAlMotorizado) {
      const pin = await sender.send({ phone: m.phone, kind: 'location', category: 'UTILITY', origen: 'sistema', location: { latitude: e.lat, longitude: e.lng, name: `${e.referencia} · ${e.nombre ?? e.phone}`, address: [e.direccion, e.distrito].filter(Boolean).join(', ') || undefined }, limitesContacto: { separacionMs: 0, maxPorDia: 500 } }).catch(() => null);
      if (pin && pin.ok && pin.wamid) wamids.push(pin.wamid);
    }
    // Si estaba apartada por falta de motorizado, al asignarle uno deja de ser incidencia sola.
    const salioDeIncidencia = e.estado === 'incidencia' && e.incidencia === 'sin_motorizado';
    const act = (await repo.actualizar(e.id, { motorizadoId: m.id, motorizadoEstado: 'enviado', motorizadoIntentos: 1, motorizadoEnviadoAt: en, motorizadoProximoAt: new Date(en.getTime() + ajustes.motorizadoEsperaMin * 60_000), motorizadoRespuesta: null, estado: 'esperando_motorizado', ...(salioDeIncidencia ? { incidencia: null, incidenciaDetalle: null, requiereHumano: false } : {}) })) ?? e;
    await evento(act, 'motorizado_enviado', `${e.segundaVisita ? 'segunda visita: ' : ''}pin enviado a ${firmaMotorizado(m)}; se le preguntó en cuánto entrega${hermanas.length ? ` (junto con ${enLista(hermanas.map((x) => x.referencia))}: mismo cliente)` : ''}`, { motorizadoId: m.id, wamid: salida.wamid, wamids });
    for (const h of hermanas) {
      const hAct = (await repo.actualizar(h.id, { motorizadoId: m.id, motorizadoEstado: 'enviado', motorizadoIntentos: 1, motorizadoEnviadoAt: en, motorizadoProximoAt: new Date(en.getTime() + ajustes.motorizadoEsperaMin * 60_000), motorizadoRespuesta: null, estado: 'esperando_motorizado' })) ?? h;
      await evento(hAct, 'motorizado_enviado', `va en el mismo viaje que ${e.referencia} (mismo cliente): pin enviado a ${firmaMotorizado(m)}`, { motorizadoId: m.id, wamid: salida.wamid, wamids });
    }
    return { ok: true, motorizado: m };
  }

  /** Lleva un motorizado aunque falte la ubicación (y todavía falta). */
  const conMotorizadoSinUbicacion = (e: Entrega): boolean =>
    Boolean(e.motorizadoSinUbicacionAt) && e.ubicacionEstado === 'pendiente' && Boolean(e.motorizadoId) && (e.motorizadoEstado === 'enviado' || e.motorizadoEstado === 'respondio') && !ESTADOS_FINALES.includes(e.estado) && e.estado !== 'incidencia';

  /**
   * Los pedidos de hoy de ese cliente que esperan su ubicación y podrían ir con
   * un motorizado sin ella: los vivos y los apartados solo por el cierre.
   */
  async function sinPinDe(phone: string): Promise<Entrega[]> {
    const vivas = await repo.vivasPorTelefono(phone).catch(() => [] as Entrega[]);
    const apartadas = (await repo.listar({ dia: hoy(), estados: ['incidencia'], q: phone, limit: 50 }).catch(() => [] as Entrega[])).filter((x) => x.phone === phone && x.incidencia === 'consulta_ajena');
    return [...vivas, ...apartadas.filter((x) => !vivas.some((v) => v.id === x.id))].filter((x) => x.ubicacionEstado === 'pendiente' && !x.envioRetenidoAt && !ESTADOS_FINALES.includes(x.estado));
  }

  /**
   * «Esperando ubicación · con motorizado» (pedido del dueño, 25/09): el
   * motorizado recibe el pedido con el teléfono y la dirección escrita del
   * cliente, NUNCA una ubicación, y coordina por teléfono. Desde ahí sigue
   * igual que siempre: minutos, «cerca», «entregado», «no puedo». Se elige
   * como siempre (zona o distrito, o la dirección escrita, y la carga) salvo
   * que venga `forzado`. Al cliente no se le vuelve a recordar la ubicación.
   */
  async function mandarSinUbicacion(e: Entrega, forzado?: Motorizado): Promise<{ ok: boolean; motivo?: string; retryAfterMs?: number; motorizado?: Motorizado }> {
    const m = forzado ?? (await elegirMotorizado(e));
    if (!m) {
      return { ok: false, motivo: e.motorizadosDescartados.length ? 'ningún motorizado activo puede llevarla' : 'no hay ningún motorizado activo', retryAfterMs: 3 * 60_000 };
    }
    const contacto = await repos.contacts.upsertFromInbound(m.phone, m.nombre);
    if (!contacto.optInAt) await repos.contacts.setOptIn(m.phone, 'motorizado');
    const en = ahora();
    // Sus otros pedidos que también esperan la ubicación van en el mismo mensaje.
    const hermanas = (await sinPinDe(e.phone)).filter((x) => x.id !== e.id && !(x.motorizadoId && (x.motorizadoEstado === 'enviado' || x.motorizadoEstado === 'respondio')) && !x.segundaVisita);
    const refs = [e.referencia, ...hermanas.map((x) => x.referencia)];
    const pedidoTexto = hermanas.length ? `${enLista(refs)} (${refs.length} pedidos del mismo cliente)` : e.referencia;
    // Si el cliente escribió su dirección, esa es la que recibe el motorizado.
    const ctx = contextoMotorizado({ ...contexto(e, m), pedido: pedidoTexto, ...(e.direccionCliente ? { direccion: e.direccionCliente } : {}) });
    const texto = textoDe('motorizadoSinUbicacion', ajustes, ctx);
    const direccionEscrita = (e.direccionCliente ? [e.direccionCliente] : [e.direccion, e.distrito]).map((x) => (x ?? '').trim()).filter(Boolean).join(', ') || 'sin dirección escrita';
    const salida = await enviarA(m.phone, texto, 'motorizado', [(e.nombre ?? '').trim() || e.phone, e.prioridad === 'urgente' ? `URGENTE ${enLista(refs)}` : enLista(refs), `SIN ubicación · ${telefonoEnPalabras(e.phone)} · ${direccionEscrita}`], { separacionMs: 0, maxPorDia: 500 });
    if (!salida.ok) {
      if ('sinPlantilla' in salida) {
        await marcarIncidencia(e, 'sin_plantilla', `no se le puede escribir al motorizado ${firmaMotorizado(m)}: ${salida.reason}`);
        return { ok: false, motivo: salida.reason };
      }
      if (salida.blocked) return { ok: false, motivo: salida.reason, retryAfterMs: salida.retryAfterMs ?? 5 * 60_000 };
      if (salida.retryable) return { ok: false, motivo: salida.error, retryAfterMs: 3 * 60_000 };
      await evento(e, 'incidencia', `WhatsApp rechazó el envío a ${firmaMotorizado(m)}: ${salida.error.slice(0, 160)}`);
      await avisarSupervisor(`El número del motorizado ${firmaMotorizado(m)} (${m.phone}) no recibe mensajes: ${salida.error.slice(0, 120)}. Revísalo en Entregas del día.`, [m.phone]);
      await descartarMotorizado(e, m, 'WhatsApp rechazó su número');
      return { ok: false, motivo: salida.error };
    }
    const asignar = async (x: Entrega, detalle: string): Promise<Entrega> => {
      const act =
        (await repo.actualizar(x.id, {
          motorizadoId: m.id,
          motorizadoEstado: 'enviado',
          motorizadoIntentos: 1,
          motorizadoEnviadoAt: en,
          motorizadoProximoAt: new Date(en.getTime() + ajustes.motorizadoEsperaMin * 60_000),
          motorizadoRespuesta: null,
          motorizadoSinUbicacionAt: x.motorizadoSinUbicacionAt ?? en,
          estado: 'esperando_motorizado',
          // Ya no «necesita a alguien»: lo lleva un motorizado que coordina por teléfono.
          ...(x.estado === 'incidencia' || x.requiereHumano ? { incidencia: null, incidenciaDetalle: null, requiereHumano: false } : {}),
          // Con la regla del dueño no se le pregunta SÍ/NO (como tras UBI REGISTRADA).
          ...(reglaGsgActiva() && x.confirmacionEstado === 'pendiente' ? { confirmacionEstado: 'no_hace_falta' as const, confirmacionProximoAt: null } : {}),
        })) ?? x;
      await evento(act, 'motorizado_enviado', detalle, { motorizadoId: m.id, wamid: salida.wamid, sinUbicacion: true });
      return act;
    };
    await asignar(e, `sin ubicación: pedido enviado a ${firmaMotorizado(m)} con el teléfono y la dirección escrita del cliente (ningún pin); coordina por teléfono y se le preguntó en cuánto entrega${hermanas.length ? ` (junto con ${enLista(hermanas.map((x) => x.referencia))}: mismo cliente)` : ''}`);
    for (const h of hermanas) await asignar(h, `va en el mismo mensaje que ${e.referencia} (mismo cliente, sin ubicación): enviado a ${firmaMotorizado(m)}`);
    // Ni el reparto ni el envío automático le recuerdan la ubicación.
    await apartarPorMotorizado(repos, e.phone, { ahora: en, motivo: `va con el motorizado ${firmaMotorizado(m)} sin ubicación: coordina por teléfono` }).catch((error) => log('no se pudieron apartar las solicitudes del reparto de ese número', { detalle: String(error) }));
    log('pedido sin ubicación enviado a un motorizado', { referencia: e.referencia, motorizado: m.nombre });
    return { ok: true, motorizado: m };
  }

  /**
   * El cierre antes del pin (pedido del dueño): si hay motorizados activos, se
   * le asigna uno ANTES de mandar el cierre, para que el número del cierre sea
   * el suyo. Si ya lo llevaba uno, ese. Sin ninguno activo, sus pedidos quedan
   * marcados y el motor se lo asigna en cuanto haya uno. Devuelve el motorizado.
   */
  async function asignarSinUbicacion(phone: string, motivo: string): Promise<Motorizado | null> {
    const lista = await sinPinDe(phone);
    const ya = lista.find(conMotorizadoSinUbicacion);
    if (ya) return motorizadoDe(ya);
    const libres = lista.filter((x) => !(x.motorizadoId && (x.motorizadoEstado === 'enviado' || x.motorizadoEstado === 'respondio')));
    if (!libres.length) return null;
    const en = ahora();
    for (const x of libres) {
      if (!x.motorizadoSinUbicacionAt) {
        await repo.actualizar(x.id, { motorizadoSinUbicacionAt: en });
        await evento(x, 'nota', `recibió el cierre sin mandar su ubicación (${motivo.slice(0, 160)}): va con un motorizado aunque falte el pin`);
      }
    }
    const primera = (await repo.entrega(libres[0]!.id)) ?? libres[0]!;
    const r = await mandarSinUbicacion(primera);
    if (!r.ok) await evento(primera, 'nota', `no hay motorizado para llevarlo sin ubicación ahora (${r.motivo ?? 'sin motivo'}): se le asigna uno en cuanto haya`);
    return r.ok ? (r.motorizado ?? null) : null;
  }

  /** «Asignar motorizado sin ubicación» desde la ficha: lo mismo, con el motorizado elegido (o el que elija el sistema). */
  async function asignarSinUbicacionAMano(id: number, motorizadoId: number | null, quien: string): Promise<{ ok: true; entrega: Entrega; motorizado: Motorizado } | { ok: false; motivo: string }> {
    const e = await repo.entrega(id);
    if (!e) return { ok: false, motivo: 'Ese pedido ya no existe: recarga la lista.' };
    if (ESTADOS_FINALES.includes(e.estado)) return { ok: false, motivo: `El pedido ${e.referencia} ya está ${e.estado === 'cancelada' ? 'cancelado' : 'entregado'}: no hace falta un motorizado.` };
    if (e.ubicacionEstado !== 'pendiente') return { ok: false, motivo: `${e.referencia} ya tiene su ubicación: para cambiar de motorizado usa «Pasar a otro motorizado».` };
    if (e.envioRetenidoAt) return { ok: false, motivo: `${e.referencia} todavía espera que se confirme su envío: confírmalo primero.` };
    if (e.motorizadoId && (e.motorizadoEstado === 'enviado' || e.motorizadoEstado === 'respondio')) {
      const actual = await motorizadoDe(e);
      return { ok: false, motivo: `${e.referencia} ya lo lleva ${actual ? firmaMotorizado(actual) : 'un motorizado'}: para cambiarlo usa «Pasar a otro motorizado».` };
    }
    let forzado: Motorizado | undefined;
    if (motorizadoId) {
      const m = await repo.motorizado(motorizadoId);
      if (!m) return { ok: false, motivo: 'Ese motorizado no existe: elige uno de la lista de Motorizados.' };
      if (!mismoMundo(e.phone, m.phone)) return { ok: false, motivo: MEZCLA_PRUEBA };
      if (m.estado !== 'activo') return { ok: false, motivo: `${m.nombre} está en ${m.estado === 'descanso' ? 'descanso' : 'baja'} y no puede recibir pedidos: actívalo en Motorizados o elige otro.` };
      forzado = m;
    }
    const marcada = (await repo.actualizar(e.id, { motorizadoSinUbicacionAt: e.motorizadoSinUbicacionAt ?? ahora(), motorizadosDescartados: motorizadoId ? e.motorizadosDescartados.filter((x) => x !== motorizadoId) : e.motorizadosDescartados })) ?? e;
    await evento(marcada, 'nota', `${quien} le asigna un motorizado sin ubicación${forzado ? ` (${firmaMotorizado(forzado)})` : ''}`);
    const r = await mandarSinUbicacion(marcada, forzado);
    if (!r.ok || !r.motorizado) {
      const sinNadie = /ningún motorizado activo/.test(r.motivo ?? '');
      // No quedó con nadie: se deja como estaba (lo marcado a mano no se queda a medias).
      if (!e.motorizadoSinUbicacionAt) await repo.actualizar(e.id, { motorizadoSinUbicacionAt: null });
      return { ok: false, motivo: sinNadie ? 'No hay ningún motorizado activo que pueda llevarlo: activa uno en Motorizados y vuelve a intentarlo.' : `No se le pudo mandar al motorizado: ${r.motivo ?? 'inténtalo otra vez en un momento'}.` };
    }
    return { ok: true, entrega: (await repo.entrega(e.id)) ?? marcada, motorizado: r.motorizado };
  }

  async function reintentarAviso(e: Entrega): Promise<{ ok: boolean; motivo?: string; retryAfterMs?: number }> {
    const m = await motorizadoDe(e);
    if (!m) {
      await repo.actualizar(e.id, { motorizadoId: null, motorizadoEstado: 'sin_asignar', estado: 'lista', motorizadoProximoAt: null });
      return { ok: false, motivo: 'el motorizado ya no existe: vuelve a la cola' };
    }
    const act = await avisarLlegada(e, m);
    if (act.avisoEnviadoAt) return { ok: true };
    if (act.estado === 'incidencia') return { ok: false, motivo: act.incidenciaDetalle ?? 'el aviso no salió' };
    return { ok: false, motivo: 'el aviso de llegada sigue esperando su turno', retryAfterMs: Math.max(1000, (act.motorizadoProximoAt?.getTime() ?? 0) - ahora().getTime()) };
  }

  async function atenderMotorizadoQueNoContesta(e: Entrega): Promise<{ ok: boolean; motivo?: string; retryAfterMs?: number }> {
    if (!e.motorizadoId) return { ok: false, motivo: 'sin motorizado' };
    const m = await repo.motorizado(e.motorizadoId);
    if (!m) {
      await repo.actualizar(e.id, { motorizadoId: null, motorizadoEstado: 'sin_asignar', estado: 'lista' });
      return { ok: false, motivo: 'el motorizado ya no existe: vuelve a la cola' };
    }
    const en = ahora();
    // Sin sus minutos en «reasignarMotorizadoMin» (20 min), el pedido pasa SOLO a
    // otro motorizado activo (pedido del dueño, 25/09), aunque todavía le
    // quedaran avisos; antes de eso se le insiste como siempre.
    const limiteReasignar = e.motorizadoEnviadoAt ? e.motorizadoEnviadoAt.getTime() + ajustes.reasignarMotorizadoMin * 60_000 : Number.POSITIVE_INFINITY;
    const seAcaboElTiempo = en.getTime() >= limiteReasignar;
    if (e.motorizadoIntentos < ajustes.motorizadoMaxIntentos && !seAcaboElTiempo) {
      const salida = await enviarA(m.phone, textoDe('motorizadoInsistir', ajustes, contexto(e, m)), 'motorizado', [(e.nombre ?? '').trim() || e.phone, e.referencia, e.lat != null && e.lng != null ? enlaceMapa(e.lat, e.lng) : ''], { separacionMs: 0, maxPorDia: 500 });
      if (!salida.ok) {
        if ('sinPlantilla' in salida) {
          await marcarIncidencia(e, 'sin_plantilla', `no se le puede insistir al motorizado ${firmaMotorizado(m)}: ${salida.reason}`);
          return { ok: false, motivo: salida.reason };
        }
        return { ok: false, motivo: 'reason' in salida ? salida.reason : salida.error, retryAfterMs: 3 * 60_000 };
      }
      const proximo = Math.min(en.getTime() + ajustes.motorizadoEsperaMin * 60_000, limiteReasignar);
      const act = (await repo.actualizar(e.id, { motorizadoIntentos: e.motorizadoIntentos + 1, motorizadoProximoAt: new Date(proximo) })) ?? e;
      await evento(act, 'motorizado_enviado', `se le insistió a ${firmaMotorizado(m)} (aviso ${act.motorizadoIntentos})`);
      return { ok: true };
    }
    // ¿Hay otro motorizado activo a quien pasárselo? Si no, se queda con este
    // (no se le deja a nadie) y sale en «Hay que mirar» de Hoy y en la campana.
    const hayOtro = (await repo.listarMotorizados()).some((x) => x.estado === 'activo' && x.id !== m.id && !e.motorizadosDescartados.includes(x.id) && mismoMundo(e.phone, x.phone));
    if (!hayOtro) {
      const clave = `${e.id}:${m.id}`;
      if (!sinOtroAvisados.has(clave)) {
        sinOtroAvisados.add(clave);
        await evento(e, 'nota', `${firmaMotorizado(m)} no dio sus minutos${seAcaboElTiempo ? ` en ${ajustes.reasignarMotorizadoMin} min` : ` tras ${e.motorizadoIntentos} avisos`} y no hay otro motorizado activo para pasárselo: sigue con él y sale en «Hay que mirar»`);
      }
      await repo.actualizar(e.id, { motorizadoProximoAt: new Date(en.getTime() + Math.max(5, ajustes.motorizadoEsperaMin) * 60_000) });
      return { ok: false, motivo: 'no hay otro motorizado activo: sale en «Hay que mirar»', retryAfterMs: 5 * 60_000 };
    }
    // Se acabo la paciencia con este: a otro.
    await evento(e, 'nota', seAcaboElTiempo ? `${firmaMotorizado(m)} no dio sus minutos en ${ajustes.reasignarMotorizadoMin} min: pasa solo a otro motorizado` : `${firmaMotorizado(m)} no contestó a ${e.motorizadoIntentos} avisos`);
    await avisarCancelado(e, m);
    await repo.actualizar(e.id, { motorizadoEstado: 'sin_respuesta' });
    await descartarMotorizado({ ...e, motorizadoEstado: 'sin_respuesta' }, m, 'no contestó');
    return { ok: true, motivo: 'pasa a otro motorizado' };
  }

  // ------------------------------------------------------- desde la pantalla

  async function confirmarAMano(id: number, confirmada: boolean, quien: string): Promise<Entrega | null> {
    const e = await repo.entrega(id);
    if (!e) return null;
    const en = ahora();
    if (confirmada) {
      let act = (await repo.actualizar(e.id, { confirmacionEstado: 'confirmada', confirmacionAt: en, confirmacionComo: 'persona', confirmacionProximoAt: null, ...(e.estado === 'incidencia' ? { estado: 'pendiente', incidencia: null, incidenciaDetalle: null, requiereHumano: false } : {}) })) ?? e;
      await evento(act, 'confirmada', `confirmada a mano por ${quien}`);
      await reportar(act, 'confirmacion', payloadConfirmacion({ referencia: act.referencia, phone: act.phone, nombre: act.nombre, confirmada: true, respuesta: e.confirmacionRespuesta, como: 'persona', en }));
      act = await recalcular(act);
      emitir('entrega.confirmada', act);
      return act;
    }
    return cancelar(id, `no confirmada (${quien})`, quien);
  }

  async function cancelar(id: number, motivo: string, quien: string): Promise<Entrega | null> {
    const e = await repo.entrega(id);
    if (!e) return null;
    if (e.estado === 'cancelada') return e;
    const en = ahora();
    await avisarMotorizadoQueSeCancela(e);
    const act = (await repo.actualizar(e.id, { estado: 'cancelada', confirmacionEstado: e.confirmacionEstado === 'confirmada' ? 'confirmada' : 'rechazada', confirmacionProximoAt: null, motorizadoProximoAt: null, incidencia: 'cancela', incidenciaDetalle: motivo })) ?? e;
    await evento(act, 'rechazada', `cancelada por ${quien}: ${motivo}`);
    await soltarDeLaEntrega(act, `se canceló el pedido ${act.referencia}`);
    await reportar(act, 'confirmacion', payloadConfirmacion({ referencia: act.referencia, phone: act.phone, nombre: act.nombre, confirmada: false, respuesta: e.confirmacionRespuesta, como: 'persona', motivo: 'cancela', en }));
    return act;
  }

  async function ponerUbicacion(id: number, lat: number, lng: number, quien: string): Promise<Entrega | null> {
    const e = await repo.entrega(id);
    if (!e) return null;
    const r = await alUbicacion({ id: '', phone: e.phone, name: e.nombre }, { lat, lng, fuente: `a mano (${quien})`, aMano: true });
    if (r.responder) {
      // La pregunta de confirmar que iria pegada al gracias sale igual, porque
      // la ubicacion no la mando el cliente y no hay gracias que dar.
      await sender.send({ phone: e.phone, kind: 'freeform', category: 'UTILITY', origen: 'sistema', text: textoDe('pedirConfirmacion', ajustes, contexto(r.entrega ?? e)) }).catch(() => undefined);
    }
    return r.entrega ?? (await repo.entrega(id));
  }

  async function reasignar(id: number, motorizadoId: number | null, quien: string): Promise<Entrega | null | { error: string }> {
    const e = await repo.entrega(id);
    if (!e) return null;
    if (motorizadoId) {
      const destino = await repo.motorizado(motorizadoId);
      if (!destino) return { error: 'Ese motorizado no existe: elige uno de la lista de Motorizados.' };
      if (!mismoMundo(e.phone, destino.phone)) return { error: MEZCLA_PRUEBA };
      if (destino.estado !== 'activo') return { error: `${destino.nombre} está en ${destino.estado === 'descanso' ? 'descanso' : 'baja'} y no puede recibir pedidos: actívalo en Motorizados o elige otro.` };
    }
    if (e.motorizadoId) {
      const anterior = await repo.motorizado(e.motorizadoId);
      if (anterior) {
        await avisarCancelado(e, anterior);
      }
    }
    const descartados = motorizadoId === null ? e.motorizadosDescartados : e.motorizadosDescartados.filter((x) => x !== motorizadoId);
    let act = (await repo.actualizar(e.id, { motorizadoId: null, motorizadoEstado: 'sin_asignar', motorizadoIntentos: 0, motorizadoEnviadoAt: null, motorizadoProximoAt: null, motorizadoRespuesta: null, motorizadoRespondioAt: null, minutosMotorizado: null, minutosAviso: null, llegaAproxAt: null, avisoEnviadoAt: null, motorizadosDescartados: descartados, ...(e.estado === 'incidencia' ? { incidencia: null, incidenciaDetalle: null, requiereHumano: false } : {}), estado: 'lista' })) ?? e;
    await evento(act, 'nota', `${quien} la vuelve a repartir${motorizadoId ? ' a un motorizado concreto' : ''}`);
    // Se fuerza ese: los demas quedan descartados solo para esta eleccion.
    if (motorizadoId) act = await mandarAEste({ ...act, motorizadosDescartados: descartados }, motorizadoId);
    return act;
  }

  async function reintentar(id: number, quien: string): Promise<Entrega | null> {
    const e = await repo.entrega(id);
    if (!e) return null;
    let act = (await repo.actualizar(e.id, { estado: 'pendiente', incidencia: null, incidenciaDetalle: null, requiereHumano: false, confirmacionIntentos: 0, confirmacionProximoAt: null, motorizadoIntentos: 0, motorizadoProximoAt: null, segundaVisitaVenceAt: null, ...(e.confirmacionEstado === 'rechazada' ? { confirmacionEstado: 'pendiente' as const } : {}) })) ?? e;
    if (act.confirmacionEstado === 'pedida') act = (await repo.actualizar(act.id, { confirmacionEstado: 'pendiente' })) ?? act;
    await evento(act, 'nota', `${quien} la vuelve a poner en marcha`);
    return recalcular(act);
  }

  /** M-1432-1, M-1432-2...: la hora de Lima y un correlativo, sin chocar con las de hoy. */
  async function referenciaAutomatica(): Promise<string> {
    const deHoy = new Set((await repo.listar({ dia: hoy(), limit: 2000 })).map((x) => x.referencia));
    const hhmm = horaEnReloj(ahora(), tz()).replace(':', '');
    for (let n = 1; n < 1000; n++) {
      const ref = `M-${hhmm}-${n}`;
      if (!deHoy.has(ref)) return ref;
    }
    return `M-${Date.now()}`;
  }

  async function crearAMano(input: { referencia?: string; telefono: string; nombre?: string; direccion?: string; distrito?: string; notas?: string; faltaUbicacion: boolean; faltaConfirmacion: boolean; lat?: number; lng?: number; urgente?: boolean; datosEnvio?: DatosEnvio | null; retener?: boolean }, quien: string): Promise<{ ok: true; entrega: Entrega } | { ok: false; motivo: string }> {
    const referencia = (input.referencia ?? '').trim() || (await referenciaAutomatica());
    const lectura = leerCliente({ referencia, telefono: input.telefono });
    if (!lectura.ok) return { ok: false, motivo: lectura.motivo };
    const conPin = typeof input.lat === 'number' && typeof input.lng === 'number';
    const dia = hoy();
    const { entrega, nueva } = await repo.crearEntrega({
      dia,
      referencia: lectura.referencia,
      phone: lectura.phone,
      nombre: input.nombre ?? null,
      direccion: input.direccion ?? null,
      distrito: input.distrito ?? null,
      notas: input.notas ?? null,
      ubicacionEstado: input.faltaUbicacion && !conPin ? 'pendiente' : conPin ? 'recibida' : 'no_hace_falta',
      lat: conPin ? input.lat! : null,
      lng: conPin ? input.lng! : null,
      confirmacionEstado: input.faltaConfirmacion ? 'pendiente' : 'no_hace_falta',
      estado: 'pendiente',
      prioridad: input.urgente ? 'urgente' : 'normal',
      datosEnvio: input.datosEnvio ?? null,
      // Lo de la API de GSG espera a que se confirme el envío (si el ajuste lo pide); lo creado a mano, nunca.
      envioRetenidoAt: input.retener && ajustes.confirmarListaGsg !== false ? ahora() : null,
    });
    if (!nueva) return { ok: false, motivo: `Ya existe la entrega ${lectura.referencia} de hoy.` };
    let e = entrega;
    if (conPin) e = (await repo.actualizar(e.id, { mapsUrl: enlaceMapa(input.lat!, input.lng!), ubicacionFuente: `a mano (${quien})`, ubicacionAt: ahora() })) ?? e;
    await evento(e, 'sincronizada', `creada a mano por ${quien}`);
    const contacto = await repos.contacts.upsertFromInbound(e.phone, e.nombre ?? undefined);
    if (!contacto.optInAt) await repos.contacts.setOptIn(e.phone, `entrega: pedido ${e.referencia} (a mano)`);
    // Hoy ya mando su ubicacion (por otro pedido): vale la misma, no se le pide.
    const conocida = e.ubicacionEstado === 'pendiente' && !e.envioRetenidoAt ? await aplicarUbicacionConocida(e) : null;
    const recurrente = !conocida && e.ubicacionEstado === 'pendiente' && !e.envioRetenidoAt ? await apuntarRecurrente(e, 'a mano') : null;
    if (conocida) e = conocida;
    else if (recurrente) e = recurrente;
    else if (e.ubicacionEstado === 'pendiente' && !e.envioRetenidoAt) {
      try {
        const carga = await deps.cargarLote({ nombre: `Entrega a mano ${e.referencia}`, filas: [{ telefono: e.phone, nombre: e.nombre ?? undefined, referencia: e.referencia, direccion: e.direccion ?? undefined, distrito: e.distrito ?? undefined }], origen: 'entregas', arrancar: true });
        e = (await repo.actualizar(e.id, { loteId: carga.lote.id })) ?? e;
        await evento(e, 'nota', `entra en el lote del reparto "${carga.lote.nombre}" para pedirle la ubicación`);
      } catch (error) {
        log('no se pudo cargar el lote para una entrega a mano', { detalle: String(error) });
      }
    }
    return { ok: true, entrega: await recalcular(e) };
  }

  async function marcarEntregada(id: number, quien: string): Promise<Entrega | null> {
    const e = await repo.entrega(id);
    if (!e) return null;
    if (e.estado === 'entregada' || e.estado === 'cancelada') return e;
    const m = await motorizadoDe(e);
    return darPorEntregada(e, m, 'persona', quien);
  }

  async function segundaVisitaAMano(id: number, quien: string): Promise<{ ok: true; entrega: Entrega } | { ok: false; motivo: string }> {
    const e = await repo.entrega(id);
    if (!e) return { ok: false, motivo: 'Esa entrega no existe.' };
    if (e.segundaVisita) return { ok: false, motivo: `${e.referencia} ya tuvo su segunda visita: solo hay una por pedido.` };
    if (ESTADOS_FINALES.includes(e.estado)) return { ok: false, motivo: `${e.referencia} ya está ${e.estado}: no hay nada que volver a llevar.` };
    if (e.lat == null || e.lng == null) return { ok: false, motivo: `${e.referencia} no tiene coordenadas: ponle el pin primero.` };
    const act = await arrancarSegundaVisita({ ...e, visitas: Math.max(1, e.visitas) }, `${quien} pidió la segunda visita desde el panel`);
    return { ok: true, entrega: act };
  }

  async function marcarPrioridad(id: number, urgente: boolean, quien: string): Promise<Entrega | null> {
    const e = await repo.entrega(id);
    if (!e) return null;
    const prioridad = urgente ? 'urgente' : 'normal';
    if (e.prioridad === prioridad) return e;
    const act = (await repo.actualizar(e.id, { prioridad })) ?? e;
    await evento(act, 'nota', `${quien} la marca como ${urgente ? 'URGENTE' : 'normal'}`);
    // Si un motorizado ya la lleva, que lo sepa: la lleva primero.
    if (urgente && act.motorizadoId && (act.motorizadoEstado === 'enviado' || act.motorizadoEstado === 'respondio') && !ESTADOS_FINALES.includes(act.estado) && act.estado !== 'incidencia') {
      const m = await repo.motorizado(act.motorizadoId);
      if (m) await sender.send({ phone: m.phone, kind: 'freeform', category: 'UTILITY', origen: 'sistema', text: `🔴 Ojo, ${m.nombre.split(' ')[0]}: ${act.referencia} (${act.nombre ?? act.phone}) ahora es URGENTE. Si puedes, llévalo primero.`, limitesContacto: { separacionMs: 0, maxPorDia: 500 } }).catch(() => undefined);
    }
    return act;
  }

  // ------------------------------------------------------- numeros del dia

  /** La solicitud del reparto que le pide la ubicacion a esta entrega, si hay una. */
  async function solicitudDe(e: Entrega): Promise<Solicitud | null> {
    if (!e.loteId) return null;
    const lista = await repos.rutas.listarSolicitudes({ loteId: e.loteId, q: e.phone, limit: 5, offset: 0 }).catch(() => []);
    return lista.find((x) => x.phone === e.phone) ?? null;
  }

  const DONDE = 'desde Números del día';

  async function pedirUbicacionAhora(id: number, quien: string): Promise<ResultadoNumero> {
    let e = await repo.entrega(id);
    if (!e) return { hecho: false, motivo: 'no_existe', entrega: null };
    if (ESTADOS_FINALES.includes(e.estado)) return { hecho: false, motivo: 'cerrada', entrega: e };
    if (e.ubicacionEstado !== 'pendiente') return { hecho: false, motivo: 'ya_tiene_ubicacion', entrega: e };
    if (e.mensajesPausadosAt) return { hecho: false, motivo: 'pausado', entrega: e };
    // Pedirla a mano es confirmar su envío.
    if (e.envioRetenidoAt) {
      await liberarEnvio([e.id], quien);
      return { hecho: true, motivo: 'hecho', entrega: (await repo.entrega(e.id)) ?? e };
    }
    // Apartada por una incidencia (sin ubicacion tras los intentos, por ejemplo):
    // vuelve a ponerse en marcha, lo mismo que «Reintentar» en Hoy.
    if (e.estado === 'incidencia') e = (await reintentar(e.id, quien)) ?? e;
    // Hoy ya mando su ubicacion (por otro pedido): esa vale, no se le pide otra vez.
    const conocida = await aplicarUbicacionConocida(e);
    if (conocida) return { hecho: false, motivo: 'ya_tiene_ubicacion', entrega: conocida };
    const s = await solicitudDe(e);
    if (s && s.estado === 'resuelto') return { hecho: false, motivo: 'ya_tiene_ubicacion', entrega: e };
    if (s) {
      if (s.estado === 'enviado' || s.estado === 'respondio') {
        // Ya se le escribio: sale el recordatorio ahora, sin esperar su turno.
        await repos.rutas.actualizarSolicitud(s.id, { proximoIntentoAt: null, intentos: Math.min(s.intentos, 1) });
      } else {
        // Lo mismo que «Devolver a la cola» del reparto: desde el primer mensaje.
        await repos.rutas.actualizarSolicitud(s.id, { estado: 'pendiente', intentos: 0, requiereHumano: false, incidencia: null, incidenciaDetalle: null, proximoIntentoAt: null });
      }
      await repos.rutas.registrarEvento(s.id, 'nota', `${quien} volvió a pedir la ubicación ${DONDE}`);
      const lote = await repos.rutas.lote(s.loteId).catch(() => null);
      if (lote && lote.estado !== 'enviando') await repos.rutas.cambiarEstadoLote(lote.id, 'enviando');
      await evento(e, 'nota', `${quien} pidió la ubicación ${DONDE}: sale en cuanto le toque, con la pausa de siempre entre mensajes`);
      return { hecho: true, motivo: 'hecho', entrega: await recalcular(e) };
    }
    // Sin reparto de por medio (o con la direccion de la ultima vez aun sin
    // proponer): a un lote del reparto, como el pedido metido a mano.
    const act = await alLoteDelReparto(e, `${quien} pidió la ubicación ${DONDE}`);
    if (!act.loteId) return { hecho: false, motivo: 'fallo', entrega: act };
    return { hecho: true, motivo: 'hecho', entrega: await recalcular(act) };
  }

  async function pedirConfirmacionAhora(id: number, quien: string): Promise<ResultadoNumero> {
    let e = await repo.entrega(id);
    if (!e) return { hecho: false, motivo: 'no_existe', entrega: null };
    if (ESTADOS_FINALES.includes(e.estado)) return { hecho: false, motivo: 'cerrada', entrega: e };
    if (e.confirmacionEstado === 'confirmada') return { hecho: false, motivo: 'ya_confirmo', entrega: e };
    if (e.confirmacionEstado === 'no_hace_falta') return { hecho: false, motivo: 'no_hace_falta', entrega: e };
    // La confirmacion va despues de la ubicacion (pegada al gracias del pin).
    if (e.ubicacionEstado === 'pendiente') return { hecho: false, motivo: 'falta_ubicacion', entrega: e };
    if (e.mensajesPausadosAt) return { hecho: false, motivo: 'pausado', entrega: e };
    // Pedirla a mano es confirmar su envío.
    if (e.envioRetenidoAt) e = (await liberarEnvio([e.id], quien), (await repo.entrega(e.id)) ?? e);
    if (e.estado === 'incidencia') {
      // Lo mismo que «Reintentar» en Hoy: vuelve a pedirse desde el primer mensaje.
      e = (await reintentar(e.id, quien)) ?? e;
    } else {
      // Primera en la cola del motor de entregas, que la manda con su ritmo;
      // si ya gasto los intentos, le queda uno mas (el que se pide ahora).
      const tope = ajustes.confirmacionMaxIntentos;
      e = (await repo.actualizar(e.id, { confirmacionProximoAt: null, ...(e.confirmacionIntentos >= tope ? { confirmacionIntentos: Math.max(0, tope - 1) } : {}) })) ?? e;
    }
    await evento(e, 'nota', `${quien} pidió la confirmación ${DONDE}: sale en cuanto le toque, con la pausa de siempre entre mensajes`);
    return { hecho: true, motivo: 'hecho', entrega: e };
  }

  async function marcarContactado(id: number, marcar: boolean, quien: string): Promise<ResultadoNumero> {
    const e = await repo.entrega(id);
    if (!e) return { hecho: false, motivo: 'no_existe', entrega: null };
    if (marcar && e.contactadoAt) return { hecho: false, motivo: 'ya_marcado', entrega: e };
    if (!marcar && !e.contactadoAt) return { hecho: false, motivo: 'sin_marca', entrega: e };
    const act = (await repo.actualizar(e.id, marcar ? { contactadoAt: ahora(), contactadoPor: quien } : { contactadoAt: null, contactadoPor: null })) ?? e;
    await evento(act, 'nota', marcar ? `${quien} lo marcó como ya contactado ${DONDE}` : `${quien} le quitó la marca de ya contactado ${DONDE}`);
    return { hecho: true, motivo: 'hecho', entrega: act };
  }

  async function pausarMensajes(id: number, pausar: boolean, quien: string): Promise<ResultadoNumero> {
    const e = await repo.entrega(id);
    if (!e) return { hecho: false, motivo: 'no_existe', entrega: null };
    if (pausar && e.mensajesPausadosAt) return { hecho: false, motivo: 'ya_pausado', entrega: e };
    if (!pausar && !e.mensajesPausadosAt) return { hecho: false, motivo: 'no_pausado', entrega: e };
    if (pausar && ESTADOS_FINALES.includes(e.estado)) return { hecho: false, motivo: 'cerrada', entrega: e };
    const act = (await repo.actualizar(e.id, { mensajesPausadosAt: pausar ? ahora() : null })) ?? e;
    if (!pausar) {
      // El reparto lo aparto unos minutos al verlo en pausa: vuelve a su turno ya.
      const s = await solicitudDe(act);
      const en = ahora().getTime();
      if (s && ['pendiente', 'enviado', 'respondio'].includes(s.estado) && s.proximoIntentoAt && s.proximoIntentoAt.getTime() > en && s.proximoIntentoAt.getTime() <= en + 5 * 60_000) {
        await repos.rutas.actualizarSolicitud(s.id, { proximoIntentoAt: null });
      }
    }
    await evento(act, 'nota', pausar ? `${quien} detuvo los mensajes automáticos a este número ${DONDE}` : `${quien} reanudó los mensajes automáticos a este número ${DONDE}`);
    return { hecho: true, motivo: 'hecho', entrega: act };
  }

  // ------------------------------------------------- la ruta del motorizado

  const esDeHoy = (fecha: Date | null): boolean => {
    if (!fecha) return false;
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(fecha).slice(0, 10) === hoy();
    } catch {
      return false;
    }
  };

  /**
   * Sus pedidos vivos en el orden en que conviene hacerlos: los urgentes
   * primero y, dentro de cada grupo, el vecino mas proximo desde donde esta
   * (su ultima posicion de hoy) o, si no se sabe, desde el primero que se le
   * dio. Los que no tienen pin van al final.
   */
  async function rutaDeMotorizado(id: number): Promise<RutaMotorizado | null> {
    const m = await repo.motorizado(id);
    if (!m) return null;
    const vivas = await repo.vivasDeMotorizado(m.id);
    const conPin = vivas.filter((e) => e.lat != null && e.lng != null);
    const sinPin = vivas.filter((e) => e.lat == null || e.lng == null);
    const desde = m.ultimaLat != null && m.ultimaLng != null && m.ultimaPosicionAt && esDeHoy(m.ultimaPosicionAt) ? { lat: m.ultimaLat, lng: m.ultimaLng, en: m.ultimaPosicionAt } : null;
    const pendientes = [...conPin];
    const paradas: ParadaRuta[] = [];
    let actual: { lat: number; lng: number } | null = desde ? { lat: desde.lat, lng: desde.lng } : null;
    let totalKm = 0;
    while (pendientes.length) {
      const urgentes = pendientes.filter((e) => e.prioridad === 'urgente');
      const grupo = urgentes.length ? urgentes : pendientes;
      let mejor = grupo[0]!;
      let mejorKm: number | null = null;
      if (actual) {
        for (const e of grupo) {
          const km = haversineKm(actual, { lat: e.lat!, lng: e.lng! });
          if (mejorKm === null || km < mejorKm) {
            mejorKm = km;
            mejor = e;
          }
        }
      }
      pendientes.splice(pendientes.indexOf(mejor), 1);
      if (mejorKm !== null) totalKm += mejorKm;
      paradas.push({
        orden: paradas.length + 1,
        entrega: mejor,
        km: mejorKm,
        distancia: mejorKm !== null ? distanciaEnPalabras(mejorKm) : null,
        mapa: enlaceMapa(mejor.lat!, mejor.lng!),
        situacion: mejor.cercaAvisadoAt ? 'cerca' : mejor.avisoEnviadoAt ? 'con_hora' : 'esperando_tiempo',
        llega: mejor.llegaAproxAt ? horaEnReloj(mejor.llegaAproxAt, tz()) : null,
      });
      actual = { lat: mejor.lat!, lng: mejor.lng! };
    }
    for (const e of sinPin) {
      paradas.push({ orden: paradas.length + 1, entrega: e, km: null, distancia: null, mapa: e.mapsUrl, situacion: e.cercaAvisadoAt ? 'cerca' : e.avisoEnviadoAt ? 'con_hora' : 'esperando_tiempo', llega: e.llegaAproxAt ? horaEnReloj(e.llegaAproxAt, tz()) : null });
    }
    const cabecera = textoDe('motorizadoRuta', ajustes, { negocio: deps.nombreNegocio(), motorizado: firmaMotorizado(m), paradas: paradas.length });
    const lineas = paradas.map((p) => {
      const e = p.entrega;
      const que = p.situacion === 'esperando_tiempo' ? 'falta tu tiempo' : p.situacion === 'cerca' ? `llega ${p.llega ?? '?'} (ya avisaste que estás cerca)` : `llega ${p.llega ?? '?'}`;
      return `${p.orden}) ${e.prioridad === 'urgente' ? '🔴 URGENTE · ' : ''}${e.referencia} ${(e.nombre ?? '').trim() || e.phone}${e.distrito ? ` · ${e.distrito}` : ''}${p.distancia ? ` (${p.distancia})` : ''} — ${que}${e.segundaVisita ? ' · segunda visita' : ''}${p.mapa ? `\n   📍 ${p.mapa}` : ''}${e.notas ? `\n   Nota: ${e.notas}` : ''}`;
    });
    const texto = paradas.length ? `${cabecera}\n${lineas.join('\n')}${totalKm >= 0.05 ? `\nEn total ${distanciaEnPalabras(totalKm).replace(/^a /, '')} de recorrido aproximado.` : ''}` : `Ahora mismo no tienes ningún pedido en camino, ${m.nombre.split(' ')[0]}.`;
    return { motorizado: m, desde, paradas, totalKm, texto };
  }

  // ------------------------------------------- la pagina del motorizado

  const ENLACE_DIAS = 7;
  const urlEnlace = (token: string): string => `${(deps.publicBaseUrl ?? '').replace(/\/+$/, '')}/m/${token}`;

  async function crearEnlaceMotorizado(id: number, opts: { mandar?: boolean; quien: string }): Promise<{ ok: true; url: string; venceAt: Date; enviado: boolean; motivo?: string } | { ok: false; motivo: string }> {
    const m = await repo.motorizado(id);
    if (!m) return { ok: false, motivo: 'Ese motorizado no existe.' };
    if (m.estado === 'baja') return { ok: false, motivo: `${m.nombre} ya no reparte: dalo de alta antes de mandarle su enlace.` };
    const token = randomBytes(18).toString('base64url');
    const venceAt = new Date(ahora().getTime() + ENLACE_DIAS * 86_400_000);
    await repo.actualizarMotorizado(m.id, { enlaceToken: token, enlaceVenceAt: venceAt });
    const url = urlEnlace(token);
    let enviado = false;
    let motivo: string | undefined;
    if (opts.mandar) {
      // Lo manda una persona desde el panel: sale ya, sin esperar el ritmo del
      // numero (como cualquier mensaje escrito a mano), y al motorizado no le
      // aplica la ventana de 24 h de un cliente: es de la casa.
      const salida = await sender.send({ phone: m.phone, kind: 'freeform', category: 'UTILITY', origen: 'persona', manual: true, text: textoDe('motorizadoEnlace', ajustes, { negocio: deps.nombreNegocio(), motorizado: m.nombre.split(' ')[0] || m.nombre, enlace: url }), limitesContacto: { separacionMs: 0, maxPorDia: 500 } });
      enviado = salida.ok;
      if (!salida.ok) motivo = salida.blocked ? `no salió: ${salida.reason}` : salida.error;
    }
    log('enlace del motorizado creado', { motorizado: m.nombre, por: opts.quien, enviado });
    return { ok: true, url, venceAt, enviado, motivo };
  }

  async function motorizadoDelEnlace(token: string): Promise<{ ok: true; motorizado: Motorizado } | { ok: false; motivo: string }> {
    const limpio = (token ?? '').trim();
    if (!limpio || limpio.length > 80) return { ok: false, motivo: 'Este enlace no vale. Pídele al coordinador que te mande uno nuevo.' };
    const m = await repo.motorizadoPorEnlace(limpio);
    if (!m || m.enlaceToken !== limpio) return { ok: false, motivo: 'Este enlace no vale. Pídele al coordinador que te mande uno nuevo.' };
    if (!m.enlaceVenceAt || m.enlaceVenceAt.getTime() < ahora().getTime()) return { ok: false, motivo: 'Este enlace ya caducó (vale 7 días). Pídele al coordinador que te mande uno nuevo.' };
    if (m.estado === 'baja') return { ok: false, motivo: 'Hoy no estás repartiendo. Si es un error, habla con el coordinador.' };
    return { ok: true, motorizado: m };
  }

  async function paginaDeMotorizado(token: string): Promise<PaginaMotorizado | { ok: false; motivo: string }> {
    const r = await motorizadoDelEnlace(token);
    if (!r.ok) return r;
    const ruta = await rutaDeMotorizado(r.motorizado.id);
    if (!ruta) return { ok: false, motivo: 'Este enlace no vale. Pídele al coordinador que te mande uno nuevo.' };
    const vivas = await repo.vivasDeMotorizado(r.motorizado.id);
    const sinPin = vivas.filter((e) => e.lat == null || e.lng == null);
    const acciones: Record<number, AccionEnlace[]> = {};
    for (const parada of ruta.paradas) {
      const e = parada.entrega;
      const lista: AccionEnlace[] = [];
      if (e.motorizadoEstado === 'enviado' || e.motorizadoEstado === 'sin_respuesta' || e.minutosMotorizado == null) lista.push('minutos');
      if (e.estado === 'avisada' || e.minutosMotorizado != null) {
        if (!e.cercaAvisadoAt) lista.push('cerca');
        lista.push('entregado', 'no_estaba');
      }
      lista.push('no_puedo');
      acciones[e.id] = lista;
    }
    return { ok: true, motorizado: { id: r.motorizado.id, nombre: r.motorizado.nombre, placa: r.motorizado.placa }, negocio: deps.nombreNegocio(), venceAt: r.motorizado.enlaceVenceAt!, ruta, sinPin, acciones };
  }

  async function accionDesdeEnlace(token: string, accion: AccionEnlace, datos: { referencia: string; minutos?: number }): Promise<{ ok: true; respuesta: string; resultado?: string } | { ok: false; motivo: string }> {
    const r = await motorizadoDelEnlace(token);
    if (!r.ok) return r;
    const referencia = (datos.referencia ?? '').trim();
    if (!referencia) return { ok: false, motivo: 'Falta saber de qué pedido hablas.' };
    const suyas = await repo.vivasDeMotorizado(r.motorizado.id);
    if (!suyas.some((e) => e.referencia.toLowerCase() === referencia.toLowerCase())) return { ok: false, motivo: `${referencia} ya no está entre tus pedidos. Recarga la página.` };
    let texto: string;
    switch (accion) {
      case 'minutos': {
        const min = Number(datos.minutos);
        if (!Number.isFinite(min) || min < 1 || min > 600) return { ok: false, motivo: 'Escribe los minutos que te faltan (entre 1 y 600).' };
        texto = `${referencia} ${Math.round(min)}`;
        break;
      }
      case 'cerca':
        texto = `cerca ${referencia}`;
        break;
      case 'entregado':
        texto = `entregado ${referencia}`;
        break;
      case 'no_estaba':
        texto = `no estaba nadie ${referencia}`;
        break;
      case 'no_puedo':
        texto = `no puedo ${referencia}`;
        break;
      default:
        return { ok: false, motivo: 'Ese botón no existe.' };
    }
    // El mismo camino que su respuesta por WhatsApp: mismos lectores, mismo
    // escudo, mismos eventos. Solo cambia por donde entro.
    const resp = await respuestaDeMotorizado(r.motorizado, texto);
    if (resp.entrega) await evento(resp.entrega, 'nota', `${firmaMotorizado(r.motorizado)} lo hizo desde su página (botón «${accion}»)`);
    return { ok: true, respuesta: resp.responder ?? 'Anotado.', resultado: resp.resultado };
  }

  async function mandarRuta(id: number, quien: string): Promise<{ ok: boolean; motivo?: string; ruta?: RutaMotorizado }> {
    const ruta = await rutaDeMotorizado(id);
    if (!ruta) return { ok: false, motivo: 'Ese motorizado no existe.' };
    if (!ruta.paradas.length) return { ok: false, motivo: `${ruta.motorizado.nombre} no tiene ningún pedido en camino ahora mismo.`, ruta };
    const salida = await enviarA(ruta.motorizado.phone, ruta.texto, 'motorizado', [ruta.motorizado.nombre, `${ruta.paradas.length} paradas`, ruta.paradas[0]!.mapa ?? ''], { separacionMs: 0, maxPorDia: 500 });
    if (!salida.ok) return { ok: false, motivo: 'reason' in salida ? salida.reason : salida.error, ruta };
    await evento(ruta.paradas[0]!.entrega, 'nota', `${quien} le mandó su ruta del día a ${firmaMotorizado(ruta.motorizado)} (${ruta.paradas.length} paradas)`, { wamid: salida.wamid });
    return { ok: true, ruta };
  }

  /**
   * Le quita a un motorizado todo lo que lleva y lo reparte. El cliente que
   * ya tenia hora se entera del cambio; el motorizado recibe UN mensaje con
   * la lista (si `avisarMotorizado`) y el supervisor otro.
   */
  async function traspasarPedidos(id: number, opts: { destino?: number | null; descanso?: boolean; quien: string; motivo?: string; avisarMotorizado?: boolean }): Promise<{ ok: true; resultado: ResultadoTraspaso } | { ok: false; motivo: string }> {
    const m = await repo.motorizado(id);
    if (!m) return { ok: false, motivo: 'Ese motorizado no existe.' };
    let destino: Motorizado | null = null;
    if (opts.destino) {
      destino = await repo.motorizado(opts.destino);
      if (!destino) return { ok: false, motivo: 'El motorizado al que quieres pasárselos no existe.' };
      if (destino.id === m.id) return { ok: false, motivo: 'Es el mismo motorizado.' };
      if (!mismoMundo(m.phone, destino.phone)) return { ok: false, motivo: MEZCLA_PRUEBA };
      if (destino.estado !== 'activo') return { ok: false, motivo: `${destino.nombre} no está activo: actívalo primero o deja que el sistema elija.` };
    }
    const vivas = await repo.vivasDeMotorizado(m.id);
    if (opts.descanso && m.estado === 'activo') await repo.actualizarMotorizado(m.id, { estado: 'descanso' });
    const motivo = opts.motivo ?? `${opts.quien} le traspasó sus pedidos`;
    const traspasadas: Entrega[] = [];
    for (const e of vivas) {
      const teniaHora = Boolean(e.avisoEnviadoAt);
      let act =
        (await repo.actualizar(e.id, {
          motorizadosDescartados: [...new Set([...e.motorizadosDescartados, m.id])],
          motorizadoId: null,
          motorizadoEstado: 'sin_asignar',
          motorizadoIntentos: 0,
          motorizadoEnviadoAt: null,
          motorizadoProximoAt: null,
          motorizadoRespuesta: null,
          motorizadoRespondioAt: null,
          minutosMotorizado: null,
          minutosAviso: null,
          llegaAproxAt: null,
          avisoEnviadoAt: null,
          cercaAvisadoAt: null,
          estado: 'lista',
        })) ?? e;
      await evento(act, 'nota', `${firmaMotorizado(m)} ya no lo lleva (${motivo}); ${destino ? `pasa a ${firmaMotorizado(destino)}` : 'se busca otro'}`);
      if (teniaHora) {
        const salida = await enviarA(act.phone, textoDe('clienteCambioMotorizado', ajustes, contexto(act)), 'aviso', variablesCliente(act), { separacionMs: 0, maxPorDia: 20 });
        const callado = await noSalioAlCliente(act.phone, salida);
        await evento(act, salida.ok && !callado ? 'aviso' : 'nota', callado ? `al cliente NO se le escribió el cambio de motorizado (${callado})` : salida.ok ? 'se le avisó al cliente del cambio de motorizado' : `no se le pudo avisar al cliente del cambio: ${'reason' in salida ? salida.reason : salida.error}`);
      }
      if (destino) act = await mandarAEste(act, destino.id);
      traspasadas.push(act);
    }
    const lista = traspasadas.map((x) => x.referencia).join(', ');
    if (traspasadas.length && (opts.avisarMotorizado ?? true)) {
      await sender.send({ phone: m.phone, kind: 'freeform', category: 'UTILITY', origen: 'sistema', text: textoDe('motorizadoTraspaso', ajustes, { ...contexto(traspasadas[0]!, m), pedidos: lista }), limitesContacto: { separacionMs: 0, maxPorDia: 500 } }).catch(() => undefined);
    }
    if (traspasadas.length || opts.descanso) {
      await avisarSupervisor(`${firmaMotorizado(m)} ${motivo}: ${opts.descanso ? 'pasa a descanso' : 'sigue activo'}${traspasadas.length ? ` y ${traspasadas.length === 1 ? 'su pedido' : `sus ${traspasadas.length} pedidos`} (${lista}) ${destino ? `pasa${traspasadas.length === 1 ? '' : 'n'} a ${firmaMotorizado(destino)}` : `se reparte${traspasadas.length === 1 ? '' : 'n'} entre los demás`}` : ' sin pedidos entre manos'}. Míralo en ${(deps.publicBaseUrl ?? '').replace(/\/+$/, '')}/motorizados`, [m.phone]);
    }
    const fresco = (await repo.motorizado(m.id)) ?? m;
    return { ok: true, resultado: { motorizado: fresco, traspasadas, destino } };
  }

  // ------------------------------------------------------ lista pegada

  const SI_NO = { si: ['si', 'sí', 's', 'x', '1', 'true', 'yes', 'ok', 'falta', 'pedir'], no: ['no', 'n', '0', 'false', '-', 'tiene', 'ya'] };
  function leerSiNo(valor: string | undefined): boolean | undefined {
    const v = (valor ?? '').trim().toLowerCase();
    if (!v) return undefined;
    if (SI_NO.si.includes(v)) return true;
    if (SI_NO.no.includes(v)) return false;
    return undefined;
  }

  /**
   * Un texto pegado (Excel, CSV, lineas) hecho filas. Ademas de las columnas
   * que ya entiende el reparto (telefono, nombre, pedido, direccion,
   * distrito, notas), reconoce "ubicacion" y "confirmar" con si/no para
   * decidir por fila que le falta a cada uno.
   */
  function leerListaPegada(texto: string): { filas: FilaPegada[]; descartadas: ResultadoCargaVarias['descartadas'] } {
    const lectura = leerLote(texto);
    const filas: FilaPegada[] = lectura.filas.map((f: FilaLote) => ({ ...f }));
    // Las columnas extra se leen a mano: el lector del reparto no las conoce.
    const lineas = (texto ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lectura.conCabecera && lineas.length > 1) {
      const sep = [';', '\t', ','].sort((a, b) => lineas[0]!.split(b).length - lineas[0]!.split(a).length)[0]!;
      const cabecera = lineas[0]!.split(sep).map((c) => c.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
      const iUbi = cabecera.findIndex((c) => /^(ubicacion|ubi|pedir ubicacion|falta ubicacion|pin)$/.test(c));
      const iConf = cabecera.findIndex((c) => /^(confirmar|confirmacion|pedir confirmacion|falta confirmar|falta confirmacion)$/.test(c));
      if (iUbi >= 0 || iConf >= 0) {
        const cuerpo = lineas.slice(1);
        // Las filas leidas van en el mismo orden que las lineas no descartadas.
        const descartadasIdx = new Set(lectura.descartadas.map((d) => d.linea));
        let k = 0;
        cuerpo.forEach((linea, i) => {
          const numeroLinea = i + 2;
          if (descartadasIdx.has(numeroLinea)) return;
          const fila = filas[k++];
          if (!fila) return;
          const celdas = linea.split(sep);
          if (iUbi >= 0) {
            const v = leerSiNo(celdas[iUbi]);
            if (v !== undefined) fila.faltaUbicacion = v;
          }
          if (iConf >= 0) {
            const v = leerSiNo(celdas[iConf]);
            if (v !== undefined) fila.faltaConfirmacion = v;
          }
        });
      }
    }
    return { filas, descartadas: lectura.descartadas };
  }

  async function crearVarias(filas: FilaPegada[], quien: string, opts: { faltaUbicacion?: boolean; faltaConfirmacion?: boolean; descartadas?: ResultadoCargaVarias['descartadas']; retener?: boolean } = {}): Promise<ResultadoCargaVarias> {
    const dia = hoy();
    const retener = Boolean(opts.retener) && ajustes.confirmarListaGsg !== false;
    const resultado: ResultadoCargaVarias = { creadas: [], repetidas: [], descartadas: [...(opts.descartadas ?? [])], lote: null };
    const paraLote: Array<{ telefono: string; nombre?: string; referencia?: string; direccion?: string; distrito?: string; notas?: string }> = [];
    const conUbicacion: Entrega[] = [];
    const vistas = new Set<string>();
    for (const [i, f] of filas.entries()) {
      const revision = revisarTelefono(String(f.telefono ?? ''), plan);
      if (!revision.ok) {
        resultado.descartadas.push({ linea: i + 1, texto: [f.telefono, f.nombre, f.referencia].filter(Boolean).join(', '), motivo: `teléfono inválido: ${revision.detalle}` });
        continue;
      }
      // Sin numero de pedido, el telefono hace de referencia: asi no se pierde la fila.
      const referencia = (f.referencia ?? '').trim() || `S/N-${revision.phone.slice(-9)}`;
      if (vistas.has(referencia)) {
        resultado.repetidas.push(referencia);
        continue;
      }
      vistas.add(referencia);
      const faltaUbicacion = f.faltaUbicacion ?? opts.faltaUbicacion ?? true;
      const faltaConfirmacion = f.faltaConfirmacion ?? opts.faltaConfirmacion ?? true;
      const { entrega, nueva } = await repo.crearEntrega({
        dia,
        referencia,
        phone: revision.phone,
        nombre: f.nombre?.trim() || null,
        direccion: f.direccion?.trim() || null,
        distrito: f.distrito?.trim() || null,
        notas: f.notas?.trim() || null,
        ubicacionEstado: faltaUbicacion ? 'pendiente' : 'no_hace_falta',
        lat: null,
        lng: null,
        confirmacionEstado: faltaConfirmacion ? 'pendiente' : 'no_hace_falta',
        estado: 'pendiente',
        datosEnvio: f.datosEnvio ?? null,
        envioRetenidoAt: retener ? ahora() : null,
      });
      if (!nueva) {
        resultado.repetidas.push(referencia);
        // El espejo: si llegan datos del envio nuevos para un pedido que ya estaba, se guardan.
        const datos = fusionarDatosEnvio(entrega.datosEnvio, f.datosEnvio ?? null);
        if (datos && !ESTADOS_FINALES.includes(entrega.estado)) await repo.actualizar(entrega.id, { datosEnvio: datos });
        continue;
      }
      await evento(entrega, 'sincronizada', `creada desde la lista pegada por ${quien}`);
      const contacto = await repos.contacts.upsertFromInbound(entrega.phone, entrega.nombre ?? undefined);
      if (!contacto.optInAt) await repos.contacts.setOptIn(entrega.phone, `entrega: pedido ${entrega.referencia} (lista pegada)`);
      resultado.creadas.push(entrega);
      if (entrega.ubicacionEstado === 'pendiente' && !entrega.envioRetenidoAt) {
        // Hoy ya mando su ubicacion (por otro pedido): vale la misma. Si no,
        // cliente recurrente: se le propone su ultima direccion en vez de meterlo al lote.
        const recurrente = (await aplicarUbicacionConocida(entrega)) ?? (await apuntarRecurrente(entrega, 'lista pegada'));
        if (!recurrente) {
          conUbicacion.push(entrega);
          paraLote.push({ telefono: entrega.phone, nombre: entrega.nombre ?? undefined, referencia: entrega.referencia, direccion: entrega.direccion ?? undefined, distrito: entrega.distrito ?? undefined, notas: entrega.notas ?? undefined });
        }
      }
    }
    if (paraLote.length) {
      try {
        const nombre = `Lista pegada ${dia} ${horaEnReloj(ahora(), tz())}`;
        const carga = await deps.cargarLote({ nombre, filas: paraLote, origen: 'entregas', arrancar: true });
        resultado.lote = { id: carga.lote.id, nombre: carga.lote.nombre, total: paraLote.length };
        for (const e of conUbicacion) {
          await repo.actualizar(e.id, { loteId: carga.lote.id });
          await evento(e, 'nota', `entra en el lote del reparto "${carga.lote.nombre}" para pedirle la ubicación`);
        }
      } catch (error) {
        log('no se pudo cargar el lote de la lista pegada', { detalle: String(error) });
      }
    }
    const creadas: Entrega[] = [];
    for (const e of resultado.creadas) creadas.push(await recalcular((await repo.entrega(e.id)) ?? e));
    resultado.creadas = creadas;
    return resultado;
  }

  // ------------------------------------------------------ cierre del dia

  async function cerrarDia(opts: { forzar?: boolean; quien?: string; soloPrueba?: boolean } = {}): Promise<{ ok: boolean; motivo?: string; resultado?: ResultadoCierre }> {
    const dia = hoy();
    if (!opts.soloPrueba && !opts.forzar && ultimoCierre?.dia === dia) return { ok: false, motivo: `El día ya se cerró hoy a las ${ultimoCierre.cuando ? horaEnReloj(new Date(ultimoCierre.cuando), tz()) : '?'}.`, resultado: ultimoCierre };
    const todas = await repo.vivasDeDiasAnteriores(dia, 500);
    const vivas = opts.soloPrueba ? todas.filter((e) => esNumeroDePrueba(e.phone)) : todas;
    const resultado: ResultadoCierre = { dia, cuando: ahora().toISOString(), sinTerminar: [], dadasPorEntregadas: [], quien: opts.quien ?? 'motor' };
    for (const e of vivas) {
      const m = await motorizadoDe(e);
      if (e.estado === 'avisada') {
        await darPorEntregada(e, m, 'cierre', null);
        await repo.actualizar(e.id, { cerradaPorDia: true });
        resultado.dadasPorEntregadas.push(e.referencia);
        continue;
      }
      const situacion = situacionDe(e, m, ajustes, tz(), reglaGsgActiva());
      const act = await marcarIncidencia(e, 'dia_cerrado', `quedó sin terminar el ${e.dia}: ${situacion}`, { avisar: false, cerradaPorDia: true });
      // El dia se cerro: el reparto deja de pedirle la ubicacion por ese pedido (lo ve una persona).
      if (e.ubicacionEstado === 'pendiente') await soltarDeLaEntrega(act, `el día ${e.dia} se cerró sin su ubicación`);
      await reportar(act, 'confirmacion', payloadConfirmacion({ referencia: act.referencia, phone: act.phone, nombre: act.nombre, confirmada: false, respuesta: act.confirmacionRespuesta, como: act.confirmacionComo, motivo: 'dia_cerrado', en: ahora() }));
      if (m && e.motorizadoEstado === 'enviado') {
        await avisarCancelado(act, m);
      }
      resultado.sinTerminar.push(e.referencia);
    }
    // El cierre de prueba no cuenta como el del dia: el de verdad sigue a su hora.
    if (opts.soloPrueba) {
      log('cierre del día de prueba hecho', { sinTerminar: resultado.sinTerminar.length, dadasPorEntregadas: resultado.dadasPorEntregadas.length });
      return { ok: true, resultado };
    }
    ultimoCierre = resultado;
    await deps.settingsRepo.put(CLAVE_CIERRE, JSON.stringify(resultado), false);
    // Al supervisor, solo lo real: lo de prueba se cierra en silencio.
    const deVerdad = new Set(vivas.filter((e) => !esNumeroDePrueba(e.phone)).map((e) => e.referencia));
    const sinTerminar = resultado.sinTerminar.filter((r) => deVerdad.has(r));
    const dadas = resultado.dadasPorEntregadas.filter((r) => deVerdad.has(r));
    if (sinTerminar.length || dadas.length) {
      const partes: string[] = [];
      if (sinTerminar.length) partes.push(`${sinTerminar.length} ${sinTerminar.length === 1 ? 'pedido quedó' : 'pedidos quedaron'} sin terminar (${sinTerminar.slice(0, 12).join(', ')}${sinTerminar.length > 12 ? '…' : ''}) y ${sinTerminar.length === 1 ? 'necesita' : 'necesitan'} a alguien`);
      if (dadas.length) partes.push(`${dadas.length} se ${dadas.length === 1 ? 'dio' : 'dieron'} por ${dadas.length === 1 ? 'entregado' : 'entregados'} (${dadas.slice(0, 12).join(', ')}${dadas.length > 12 ? '…' : ''})`);
      await avisarSupervisor(`Cierre del día: ${partes.join('; ')}. Míralo en ${(deps.publicBaseUrl ?? '').replace(/\/+$/, '')}/hoy`);
    }
    log('cierre del día hecho', { sinTerminar: resultado.sinTerminar.length, dadasPorEntregadas: resultado.dadasPorEntregadas.length });
    return { ok: true, resultado };
  }

  async function cerrarDiaSiToca(): Promise<boolean> {
    if (!ajustes.cierreDelDia.activo) return false;
    if (ultimoCierre?.dia === hoy()) return false;
    if (horaLocal() < ajustes.cierreDelDia.hora) return false;
    const r = await cerrarDia();
    return r.ok;
  }

  // ------------------------------------------------------ vista previa

  async function previsualizar(clave: keyof AjustesEntregas['textos'], texto: string): Promise<string> {
    const dia = hoy();
    const deHoy = await repo.listar({ dia, limit: 50 });
    // La mas avanzada de hoy ensena mas variables rellenas; si no hay, una de ejemplo.
    const orden: EstadoEntrega[] = ['entregada', 'avisada', 'terminada', 'esperando_motorizado', 'lista', 'esperando_confirmacion', 'esperando_ubicacion', 'pendiente', 'incidencia', 'cancelada'];
    const e = [...deHoy].sort((a, b) => orden.indexOf(a.estado) - orden.indexOf(b.estado))[0] ?? null;
    const m = e ? await motorizadoDe(e) : null;
    const en = ahora();
    const ejemplo = CLIENTES_DE_PRUEBA[0]!;
    const minutosMotorizado = e?.minutosMotorizado ?? 40;
    const minutosAviso = e?.minutosAviso ?? minutosMotorizado + ajustes.margenMinutos;
    const llega = e?.llegaAproxAt ?? new Date(en.getTime() + minutosAviso * 60_000);
    const base: ContextoTexto = e
      ? contexto(e, m)
      : {
          nombre: ejemplo.nombre,
          pedido: ejemplo.referencia,
          negocio: deps.nombreNegocio(),
          direccion: ejemplo.direccion,
          distrito: ejemplo.distrito,
          mapa: enlaceMapa(ejemplo.lat, ejemplo.lng),
          lat: ejemplo.lat,
          lng: ejemplo.lng,
          notas: ejemplo.notas ?? null,
          situacion: 'Ubicación y confirmación listas: se le va a mandar a un motorizado.',
        };
    const ctx: ContextoTexto = {
      ...base,
      minutos: base.minutos ?? minutosAviso,
      hora: base.hora ?? horaEnReloj(llega, tz()),
      motorizado: base.motorizado ?? 'Carlos Rojas (M1A-101)',
      placa: base.placa ?? 'M1A-101',
      minutosMotorizado: base.minutosMotorizado ?? minutosMotorizado,
      horaEntregada: base.horaEntregada ?? horaEnReloj(en, tz()),
      paradas: 3,
      pedidos: 'P-1001, P-1004, P-1009',
      telefonoCliente: base.telefonoCliente ?? '+51 987 654 321',
      // Sin entrega de hoy, el ejemplo no traia el horario ni el soporte y la
      // vista previa enseñaba «desde las hasta las».
      desde: base.desde ?? horaEnPalabras(ajustes.horarioEntregas.desde),
      hasta: base.hasta ?? horaEnPalabras(ajustes.horarioEntregas.hasta),
      hastaExtendido: base.hastaExtendido ?? horaEnPalabras(ajustes.horarioEntregas.extendidoHasta),
      soporte: base.soporte ?? soporteEnPalabras(ajustes.soporte),
      // Los datos del envio de ejemplo (los de GSG si la entrega los trae).
      envio: base.envio ?? { producto: 'Zapatillas talla 40', empresaCodigo: '516', empresaNombre: 'Zapatería Lima', tracking: 'GSG-A-102345', nroPedido: '#1042', metodoPago: 'YAPE', monto: '85.00', remitente: 'Juan Quispe' },
      enCuanto: minutosEnPalabras(Math.max(1, Math.ceil((llega.getTime() - en.getTime()) / 60_000))),
    };
    // La hora pedida en silencio va con AM/PM («11:05 AM»), como la verá el cliente.
    if (clave.startsWith('horaEnSilencio')) ctx.hora = horaEnPalabras(horaEnReloj(llega, tz()));
    const propio = texto.trim() || ajustes.textos[clave]?.trim() || TEXTOS_POR_DEFECTO[clave];
    return rellenar(propio, TEXTOS_PARA_MOTORIZADO.has(clave) ? contextoMotorizado(ctx) : ctx);
  }

  // ----------------------------------------------------------- pantalla

  async function fila(e: Entrega, motorizados: Map<number, Motorizado>): Promise<FilaEntrega> {
    const m = e.motorizadoId ? (motorizados.get(e.motorizadoId) ?? null) : null;
    let solicitud: FilaEntrega['solicitud'] = null;
    if (e.loteId && e.ubicacionEstado === 'pendiente') {
      const s = (await repos.rutas.listarSolicitudes({ loteId: e.loteId, q: e.phone, limit: 5, offset: 0 }).catch(() => [])).find((x) => x.phone === e.phone);
      if (s) solicitud = { id: s.id, estado: s.estado, intentos: s.intentos, incidencia: s.incidencia, loteId: s.loteId };
    }
    return { ...e, motorizado: m ? { id: m.id, nombre: m.nombre, phone: m.phone, placa: m.placa } : null, situacion: situacionDe(e, m, ajustes, tz(), reglaGsgActiva()), acciones: accionesDe(e), solicitud, mismoCliente: [] };
  }

  async function resumen(): Promise<ResumenEntregas> {
    const dia = hoy();
    const entregas = await repo.listar({ dia, limit: 1000 });
    const motorizados = await repo.listarMotorizados();
    const porId = new Map(motorizados.map((m) => [m.id, m]));
    const filas: FilaEntrega[] = [];
    for (const e of entregas) filas.push(await fila(e, porId));
    // Un cliente con varios pedidos hoy: cada fila sabe de las otras.
    const porTelefono = new Map<string, string[]>();
    for (const e of entregas) if (!ESTADOS_FINALES.includes(e.estado)) porTelefono.set(e.phone, [...(porTelefono.get(e.phone) ?? []), e.referencia]);
    for (const f of filas) f.mismoCliente = (porTelefono.get(f.phone) ?? []).filter((r) => r !== f.referencia);
    const cifras = { pendiente: 0, esperando_ubicacion: 0, esperando_confirmacion: 0, lista: 0, esperando_motorizado: 0, avisada: 0, entregada: 0, terminada: 0, cancelada: 0, incidencia: 0, total: entregas.length, faltaUbicacion: 0, faltaConfirmacion: 0, conMotorizado: 0, enCamino: 0, urgente: 0, esperandoSegundaVisita: 0 };
    for (const e of entregas) {
      // Una entrega apartada mientras el cliente decide si volvemos hoy no
      // necesita a nadie todavia: cuenta aparte.
      if (e.estado === 'incidencia' && e.segundaVisitaPedidaAt && !e.requiereHumano) cifras.esperandoSegundaVisita++;
      else cifras[e.estado]++;
      if (e.prioridad === 'urgente' && !ESTADOS_FINALES.includes(e.estado)) cifras.urgente++;
      if (e.ubicacionEstado === 'pendiente' && e.estado !== 'cancelada') cifras.faltaUbicacion++;
      if ((e.confirmacionEstado === 'pendiente' || e.confirmacionEstado === 'pedida') && e.estado !== 'cancelada') cifras.faltaConfirmacion++;
      if (e.motorizadoId && e.motorizadoEstado !== 'sin_asignar') cifras.conMotorizado++;
      if (e.estado === 'lista' || e.estado === 'esperando_motorizado' || e.estado === 'avisada' || e.estado === 'terminada') cifras.enCamino++;
    }
    const cola = await repos.rutas.cifrasReportes().catch(() => null);
    const cierrePendiente = (await repo.vivasDeDiasAnteriores(dia, 500).catch(() => [])).length;
    const enManos = new Map<number, number>();
    for (const e of entregas) if (e.motorizadoId && e.motorizadoEstado === 'enviado') enManos.set(e.motorizadoId, (enManos.get(e.motorizadoId) ?? 0) + 1);
    const eventos = (await repo.eventosRecientes(40)).map((ev) => ({ at: ev.createdAt, referencia: ev.referencia, phone: ev.phone, nombre: ev.nombre, tipo: ev.tipo, detalle: ev.detalle }));
    // La puntualidad real de cada motorizado en los ultimos 30 dias, en palabras.
    const puntualidad = new Map<number, PuntualidadMotorizado>();
    for (const p of await repo.puntualidadDeMotorizados(new Date(ahora().getTime() - 30 * 86_400_000)).catch(() => [])) {
      if (p.entregas < 2) continue;
      const d = p.desvioMedioMin;
      const texto = d <= -5 ? `suele llegar ${minutosEnPalabras(-d)} antes de la hora avisada` : d >= 5 ? `suele llegar ${minutosEnPalabras(d)} después de la hora avisada` : 'suele llegar a la hora avisada';
      puntualidad.set(p.motorizadoId, { entregas: p.entregas, desvioMedioMin: d, texto: `${texto} (${p.entregas} entregas en 30 días)` });
    }
    const esperan = entregas.filter((e) => e.envioRetenidoAt && !ESTADOS_FINALES.includes(e.estado));
    const esperanConfirmar = esperan.filter((e) => grupoDe(e) === 'confirmar').length;
    const yaSeConfirmo = entregas.some((e) => Boolean(e.envioLiberadoAt));
    return {
      dia,
      porConfirmarEnvio: { total: esperan.length, ubicacion: esperan.length - esperanConfirmar, confirmar: esperanConfirmar, mas: yaSeConfirmo, aviso: avisoPorConfirmar(esperan.length, esperan.length - esperanConfirmar, esperanConfirmar, yaSeConfirmo) },
      ajustes,
      cifras,
      entregas: filas,
      motorizados: motorizados.map((m) => ({ ...m, entregasHoy: m.entregasHoyDia === dia ? m.entregasHoy : 0, enManos: enManos.get(m.id) ?? 0, puntualidad: puntualidad.get(m.id) ?? null })),
      eventos,
      gsg: deps.conexionGsg?.estado() ?? null,
      ultimaSincronizacion: ultimaSync,
      plantillas: { hacenFalta: Boolean(deps.usarPlantilla?.()), aprobadas: (await repos.templates.list().catch(() => [])).filter((t) => t.status === 'APPROVED').map((t) => t.name) },
      motor: { enHorario: motor?.enHorario() ?? true, parado: motor?.parado() ?? null },
      textos: { porDefecto: TEXTOS_POR_DEFECTO, variables: VARIABLES_TEXTOS, descripcion: DESCRIPCION_TEXTOS },
      ultimoCierre,
      cierrePendiente,
      gsgCola: cola ? { pendiente: cola.pendiente ?? 0, enviado: cola.enviado ?? 0, fallido: cola.fallido ?? 0, atascado: cola.atascado ?? 0 } : null,
      alertas: calcularAlertas(entregas, motorizados, ajustes, ahora(), tz()),
    };
  }

  async function crearMotorizado(input: NuevoMotorizado): Promise<{ ok: true; motorizado: Motorizado; nuevo: boolean } | { ok: false; motivo: string }> {
    const revision = revisarTelefono(input.phone, plan);
    if (!revision.ok) return { ok: false, motivo: `El teléfono no vale: ${revision.detalle}` };
    // El motorizado no puede ser el mismo WhatsApp conectado al sistema: el
    // sistema no se escribe a sí mismo y lo que se conteste desde ese teléfono
    // cuenta como escrito por la tienda (nunca le llegaría el pedido).
    // El numero conectado se admite como motorizado para pruebas (pedido del
    // dueño, 25/09): contesta desde el chat «Tú» de su propio WhatsApp.
    const nombre = input.nombre.trim();
    if (!nombre) return { ok: false, motivo: 'Falta el nombre del motorizado.' };
    const r = await repo.crearMotorizado({ ...input, phone: revision.phone, nombre });
    const contacto = await repos.contacts.upsertFromInbound(revision.phone, nombre);
    if (!contacto.optInAt) await repos.contacts.setOptIn(revision.phone, 'motorizado');
    return { ok: true, motorizado: r.motorizado, nuevo: r.nuevo };
  }

  return {
    ahora,
    ajustes: () => ajustes,
    async guardarAjustes(patch) {
      const siguiente = ajustesEntregasSchema.parse({ ...ajustes, ...patch, textos: { ...ajustes.textos, ...(patch.textos ?? {}) }, plantillas: { ...ajustes.plantillas, ...(patch.plantillas ?? {}) }, cierreDelDia: { ...ajustes.cierreDelDia, ...(patch.cierreDelDia ?? {}) }, segundaVisita: { ...ajustes.segundaVisita, ...(patch.segundaVisita ?? {}) }, horarioEntregas: { ...ajustes.horarioEntregas, ...(patch.horarioEntregas ?? {}) }, soporte: { ...ajustes.soporte, ...(patch.soporte ?? {}) }, clienteRecurrente: { ...ajustes.clienteRecurrente, ...(patch.clienteRecurrente ?? {}) } });
      await deps.settingsRepo.put(CLAVE_AJUSTES, JSON.stringify(siguiente), false);
      ajustes = siguiente;
      return ajustes;
    },
    recargar,
    hoy,
    recibirListaGsg,
    ultimaSincronizacion: () => ultimaSync,
    revisarReparto,
    alUbicacion,
    revisarPin,
    async pinLejosPendiente(phone) {
      return (await esperandoUbicacionDe(phone)).some((x) => Boolean(x.pinPropuestoAt) && x.pinPropuestoLat != null);
    },
    responderPinLejos,
    alDireccionEscrita,
    alTexto,
    alAdjuntoDeMotorizado,
    nombreNegocio: () => deps.nombreNegocio(),
    alUbicacionFueraDeZona,
    crearEnlaceMotorizado,
    paginaDeMotorizado,
    accionDesdeEnlace,
    textoUbicacionRegistrada,
    async textoSolicitudUbicacion(solicitud) {
      if (!solicitud.phone) return null;
      const vivas = await repo.vivasPorTelefono(solicitud.phone).catch(() => [] as Entrega[]);
      const e =
        vivas.find((x) => solicitud.loteId && x.loteId === solicitud.loteId && (!solicitud.referencia || x.referencia === solicitud.referencia)) ??
        vivas.find((x) => solicitud.referencia && x.referencia === solicitud.referencia) ??
        vivas.find((x) => solicitud.loteId && x.loteId === solicitud.loteId) ??
        null;
      if (!e) return null;
      return textoDe('solicitudUbicacion', ajustes, contexto(e));
    },
    async textoAgente(clave, phone, nombre) {
      const vivas = await repo.vivasPorTelefono(phone).catch(() => [] as Entrega[]);
      let e = vivas[vivas.length - 1] ?? null;
      // Con la ubicación ya registrada, el motorizado se asigna en segundos.
      // El número que se le da al cliente tiene que ser el SUYO: se espera un
      // momento a que el reparto lo asigne en vez de dar otro número como si
      // fuera del motorizado (26/09: el cierre salió 3 s antes de asignar a
      // Chesco y llevó el número del propio WhatsApp).
      // Fuera del horario de envío el reparto no asigna a nadie: esperar solo
      // retrasaba la respuesta. La espera es a trozos de medio segundo con un
      // temporizador (nunca mirando el reloj en bucle).
      const repartoEnHorario = motor?.enHorario() ?? true;
      if (e && repartoEnHorario && !e.motorizadoId && e.ubicacionEstado === 'recibida' && !ESTADOS_FINALES.includes(e.estado) && !e.datosEnvio?.telefonoMotorizado) {
        const hayActivos = (await repo.listarMotorizados().catch(() => [] as Motorizado[])).some((m) => m.estado === 'activo' && mismoMundo(e!.phone, m.phone));
        const esperaMs = hayActivos ? (deps.esperaMotorizadoMs ?? (process.env.VITEST ? 0 : 8_000)) : 0;
        for (let esperado = 0; esperado < esperaMs; esperado += 500) {
          await new Promise((r) => setTimeout(r, Math.min(500, esperaMs - esperado)));
          const x = await repo.entrega(e.id).catch(() => null);
          if (x?.motorizadoId) { e = x; break; }
        }
      }
      if (e) return textoDe(clave, ajustes, contexto(e, await motorizadoDe(e).catch(() => null)));
      return textoDe(clave, ajustes, { nombre: nombre ?? null, negocio: deps.nombreNegocio(), soporte: soporteEnPalabras(ajustes.soporte), telefonoMotorizado: numeroParaCliente(null, null) });
    },
    async cambioDeUbicacion(phone) {
      const vivas = (await repo.vivasPorTelefono(phone).catch(() => [] as Entrega[])).filter((x) => !ESTADOS_FINALES.includes(x.estado) && x.ubicacionEstado === 'recibida');
      if (!vivas.length) return null;
      const e = vivas.find((x) => x.motorizadoId) ?? vivas[0]!;
      const limite = horaEnPalabras(ajustes.cambioUbicacionHasta);
      if (!pasoLaHoraDeCambio()) {
        for (const x of vivas) await evento(x, 'nota', `pidió cambiar su ubicación antes de la ${limite}: se le pidió la nueva`).catch(() => undefined);
        return textoDe('cambioUbicacionAntes', ajustes, contexto(e));
      }
      const g = vivas.find((x) => x.datosEnvio?.telefonoMotorizado) ?? e;
      const m = await motorizadoDe(g).catch(() => null);
      const numero = numeroDeGsg(g, m);
      for (const x of vivas) await evento(x, 'nota', `pidió cambiar su ubicación después de la ${limite}: ${numero ? `se le dio el número del motorizado (${numero}) para que coordine con él` : 'no hay número de motorizado que darle'}`).catch(() => undefined);
      return textoDe('cambioUbicacionTarde', ajustes, { ...contexto(g, m), telefonoMotorizado: numero });
    },
    async anotarAgente(phone, detalle) {
      for (const e of await repo.vivasPorTelefono(phone).catch(() => [] as Entrega[])) {
        await evento(e, 'ia', detalle).catch(() => undefined);
      }
    },
    async estadoUbicacionDe(phone) {
      // Lo que espera confirmar el envío no cuenta: todavía no se le escribió.
      const vivas = (await repo.vivasPorTelefono(phone).catch(() => [] as Entrega[])).filter((e) => !e.envioRetenidoAt);
      if (!vivas.length) return 'sin_entrega';
      return vivas.some((e) => e.ubicacionEstado === 'pendiente') ? 'pendiente' : 'registrada';
    },
    async situacionGsg(phone) {
      const vivas = (await repo.vivasPorTelefono(phone).catch(() => [] as Entrega[])).filter((e) => !e.envioRetenidoAt);
      const deConfirmar = vivas.filter((e) => (e.confirmacionEstado === 'pendiente' || e.confirmacionEstado === 'pedida') && grupoDe(e) === 'confirmar');
      const confirmar = deConfirmar.some((e) => e.confirmacionEstado === 'pedida') ? 'pedida' : deConfirmar.length ? 'sin_pedir' : null;
      const resto = vivas.filter((e) => !deConfirmar.includes(e));
      const ubicacion = !resto.length ? 'sin_entrega' : resto.some((e) => e.ubicacionEstado === 'pendiente') ? 'pendiente' : 'registrada';
      return { confirmar, ubicacion };
    },
    responderConfirmacionGsg,
    alNoSoyYo,
    pasarAPersona,
    async sanarUbicacion(phone) {
      const conocida = await repo.ubicacionDelClienteDelDia(phone, hoy()).catch(() => null);
      if (!conocida || conocida.lat == null || conocida.lng == null) return false;
      const cerradas = await resolverPorUbicacion(repos, phone, { lat: conocida.lat, lng: conocida.lng, mapsUrl: conocida.mapsUrl, fuente: conocida.ubicacionFuente }, { ahora: ahora(), motivo: `ya estaba registrada (pedido ${conocida.referencia})` }).catch(() => []);
      if (cerradas.length) log('habia solicitudes del reparto abiertas para un cliente con la ubicación ya registrada: se cerraron', { phone, solicitudes: cerradas.map((s) => s.id) });
      return true;
    },
    liberarEnvio,
    porConfirmarEnvio,
    proponerUbicacion,
    revisarPropuestas,
    esMotorizado: async (phone) => (await repo.motorizadoPorTelefono(phone)) !== null,
    reglaGsgActiva,
    modoGsg,
    /**
     * Una PERSONA le escribió al cliente (desde el panel o desde el teléfono):
     * lo que «necesitaba a alguien» ya está atendido, deja de figurar ahí
     * solo (pedido del dueño, 25/09). No toca pedidos sin nada pendiente.
     */
    /**
     * El cliente pregunta por su pedido o la hora («¿en cuánto llega?», «¿cómo
     * va mi pedido?», «¿ya sale?»…): el texto fijo según el estado, con la hora
     * que calculó el sistema (minutos del motorizado + margen). null = no es
     * esa pregunta o no tiene pedido de hoy. Sin IA.
     */
    async respuestaPorPedido(phone: string, texto: string, opts: { forzar?: boolean } = {}) {
      if (!ajustes.responderDondeEsta) return null;
      const p = leerPreguntaPorPedido(texto);
      if (!p.pregunta && !opts.forzar) return null;
      const vivas = await repo.vivasPorTelefono(phone).catch(() => [] as Entrega[]);
      const e = vivas[0] ?? (await entregadaHoyDe(phone));
      if (!e) return null;
      const r = await respuestaDondeEsta(e, texto, p.noLlego);
      return r.responder ?? null;
    },
    /**
     * Caso real del 28/09 (GSG-IA-001): el motorizado dio «30», el aviso de
     * llegada no salió por el silencio tras UBI y el cliente preguntó «¿cuánto
     * tiempo se tarda el pedido?» sin que nadie le contestara. Con el silencio
     * activo, ESTA pregunta (y solo esta) se contesta con la hora que ya se
     * calculó, recalculando cuánto falta; sin minutos del motorizado, con el
     * horario de entrega. Ni IA ni stickers. La misma respuesta no se repite
     * antes de 10 min (una ráfaga de preguntas = una respuesta) y como mucho 4
     * por pedido al día. Queda en la bitácora del pedido (y así sobrevive a un
     * reinicio).
     */
    async horaPedidaEnSilencio(phone: string, texto: string): Promise<HoraPedidaEnSilencio | null> {
      if (!reglaGsgActiva()) return null;
      const p = leerPreguntaPorPedido(texto);
      if (!p.pregunta) return null;
      const en = ahora();
      const dia = hoy();
      const vivas = (await repo.vivasPorTelefono(phone).catch(() => [] as Entrega[])).filter((x) => !x.envioRetenidoAt);
      // Las que GSG ya dio por terminadas hoy siguen teniendo su hora.
      const terminadas = (await repo.listar({ dia, estados: ['terminada'], q: phone, limit: 50 }).catch(() => [] as Entrega[])).filter((x) => x.phone === phone && x.llegaAproxAt);
      const candidatas = [...vivas, ...terminadas];
      if (!candidatas.length) return null;
      // ¿De cuál pregunta? La que nombra; si no, la que tiene hora (la próxima
      // por llegar; si todas pasaron, la última); si ninguna, la más reciente.
      const limpio = texto.toLowerCase();
      const nombrada = candidatas.find((x) => x.referencia && limpio.includes(x.referencia.toLowerCase()));
      const conHora = candidatas.filter((x) => x.llegaAproxAt).sort((a, b) => a.llegaAproxAt!.getTime() - b.llegaAproxAt!.getTime());
      const porLlegar = conHora.find((x) => x.llegaAproxAt!.getTime() > en.getTime());
      const e = nombrada ?? porLlegar ?? conHora[conHora.length - 1] ?? candidatas[candidatas.length - 1]!;
      const llega = e.llegaAproxAt;
      // «Ya pasó la hora y no llega»: eso es un reclamo para una persona (el camino de siempre).
      if (p.noLlego && llega && en.getTime() - llega.getTime() > MINUTOS_TOLERANCIA_LLEGADA * 60_000) return null;
      const tipo: 'con_hora' | 'pasada' | 'sin_tiempo' = !llega ? 'sin_tiempo' : llega.getTime() > en.getTime() ? 'con_hora' : 'pasada';
      const horaAmPm = llega ? horaEnPalabras(horaEnReloj(llega, tz())) : null;

      // Anti-repetición, contra la bitácora del pedido.
      const diaDe = (f: Date): string => {
        try {
          return new Intl.DateTimeFormat('en-CA', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(f).slice(0, 10);
        } catch {
          return f.toISOString().slice(0, 10);
        }
      };
      const dadas = (await repo.eventos(e.id, 2000).catch(() => []))
        .filter((ev) => (ev.payload as { horaPedida?: unknown } | null)?.horaPedida && diaDe(new Date(ev.createdAt)) === dia);
      const ultima = dadas[dadas.length - 1];
      const que = `"${texto.slice(0, 80)}"`;
      if (ultima) {
        const pl = ultima.payload as { tipo?: string; hora?: string | null };
        const hace = en.getTime() - new Date(ultima.createdAt).getTime();
        if (hace < HORA_PEDIDA_REPETIDA_MS && pl.tipo === tipo && (pl.hora ?? null) === horaAmPm) {
          const min = Math.max(1, Math.round(hace / 60_000));
          await evento(e, 'nota', `preguntó otra vez por la hora (${que}): no se le repite, ya se le contestó hace ${min} min`, { horaPedidaCallada: 'repetida' });
          return { callar: 'repetida', entrega: e };
        }
      }
      if (dadas.length >= HORA_PEDIDA_MAX_POR_DIA) {
        await evento(e, 'nota', `preguntó otra vez por la hora (${que}): no se le contesta, ya se le dio ${dadas.length} veces hoy`, { horaPedidaCallada: 'tope' });
        return { callar: 'tope', entrega: e };
      }

      const m = await motorizadoDe(e);
      const ctx: ContextoTexto = {
        ...contexto(e, m),
        hora: horaAmPm,
        enCuanto: llega ? minutosEnPalabras(Math.max(1, Math.ceil((llega.getTime() - en.getTime()) / 60_000))) : null,
      };
      const clave = tipo === 'con_hora' ? 'horaEnSilencio' : tipo === 'pasada' ? 'horaEnSilencioPasada' : 'horaEnSilencioSinTiempo';
      const responder = textoDe(clave, ajustes, ctx);
      const cual = tipo === 'con_hora' ? `la hora (${horaAmPm}, en aprox. ${ctx.enCuanto})` : tipo === 'pasada' ? `que debería estar por llegar (era para las ${horaAmPm})` : 'el horario de entrega (el motorizado aún no dio su tiempo)';
      await evento(e, 'aviso', `preguntó por su pedido (${que}): se le contestó ${cual}. Es lo único que se le contesta con el silencio tras la ubicación`, { horaPedida: true, tipo, hora: horaAmPm });
      return { responder, entrega: e, tipo };
    },
    async atendidoPorPersona(phone: string, quien = 'una persona') {
      // Las vivas NO incluyen las apartadas ('incidencia'): esas se buscan aparte (las de hoy).
      const vivas = await repo.vivasPorTelefono(phone).catch(() => [] as Entrega[]);
      const apartadas = (await repo.listar({ dia: hoy(), estados: ['incidencia'], q: phone, limit: 50 }).catch(() => [] as Entrega[])).filter((x) => x.phone === phone);
      let n = 0;
      for (const e of [...vivas, ...apartadas]) {
        if (!e.requiereHumano && e.estado !== 'incidencia') continue;
        // Esperando que el cliente diga si volvemos hoy: eso no «necesita a alguien».
        if (e.estado === 'incidencia' && e.segundaVisitaPedidaAt && !e.requiereHumano) continue;
        // «No soy yo»: una persona lo atiende, pero el pedido NO se libera solo
        // (decisión del dueño): queda «Ya contactado», sin motorizado, hasta que
        // alguien lo libere a mano («Volver a intentar» / «Pedir ubicación ahora»).
        if (e.estado === 'incidencia' && e.incidencia === INCIDENCIA_NO_SOY_YO) {
          await repo.actualizar(e.id, { requiereHumano: false, contactadoAt: e.contactadoAt ?? ahora(), contactadoPor: e.contactadoPor ?? quien });
          await evento(e, 'nota', `la atendió ${quien}: le escribió al cliente; como dijo «no soy yo», el pedido espera a que alguien lo libere a mano`);
          n++;
          continue;
        }
        // Queda como «ya contactado» (Números del día) y su estado vuelve a ser
        // el que le toca por lo que tiene (ubicación, confirmación, motorizado).
        const act = (await repo.actualizar(e.id, { ...(e.estado === 'incidencia' ? { estado: 'pendiente' as const } : {}), requiereHumano: false, incidencia: null, incidenciaDetalle: null, contactadoAt: e.contactadoAt ?? ahora(), contactadoPor: e.contactadoPor ?? quien })) ?? e;
        await recalcular(act);
        await evento(e, 'nota', `la atendió ${quien}: le escribió al cliente, ya no necesita a alguien`);
        n++;
      }
      // Lo que el reparto habia dejado «para una persona» tambien queda atendido (todas sus solicitudes).
      for (const s of await solicitudesAbiertasDe(repos, phone)) {
        if (s.requiereHumano) await repos.rutas.actualizarSolicitud(s.id, { requiereHumano: false }).catch(() => undefined);
      }
      return n;
    },
    async clienteEnSilencio(phone) {
      if (!reglaGsgActiva()) return false;
      const c = await repos.contacts.getByPhone(phone).catch(() => null);
      const en = c?.iaCerradaAt ? new Date(c.iaCerradaAt) : null;
      if (!en || Number.isNaN(en.getTime())) return false;
      if (await repo.motorizadoPorTelefono(phone).catch(() => null)) return false;
      // Un pedido nuevo (llegado despues del cierre) vuelve a abrir el chat;
      // uno que todavia espera confirmar su envio, no (aun no se le escribio).
      const vivas = (await repo.vivasPorTelefono(phone).catch(() => [] as Entrega[])).filter((e) => !e.envioRetenidoAt);
      // Solo si ese pedido nuevo le pide algo al cliente: uno que ya tomó la
      // ubicación de hoy (no se le pide nada) no reabre el chat.
      const pideAlgo = (v: Entrega): boolean => v.ubicacionEstado === 'pendiente' || ((v.confirmacionEstado === 'pendiente' || v.confirmacionEstado === 'pedida') && grupoDe(v) === 'confirmar');
      if (vivas.some((v) => v.createdAt && new Date(v.createdAt).getTime() > en.getTime() && pideAlgo(v))) return false;
      const abierta = await repos.rutas.abiertaPorTelefono(phone).catch(() => null);
      if (abierta?.createdAt && new Date(abierta.createdAt).getTime() > en.getTime()) return false;
      return true;
    },
    pedirConfirmacion,
    mandarAMotorizado,
    asignarSinUbicacion,
    asignarSinUbicacionAMano,
    async tieneMotorizadoSinUbicacion(phone) {
      return (await sinPinDe(phone)).some(conMotorizadoSinUbicacion);
    },
    atenderMotorizadoQueNoContesta,
    reintentarAviso,
    cerrarDia,
    cerrarDiaSiToca,
    ultimoCierre: () => ultimoCierre,
    revisarSegundasVisitas,
    confirmarAMano,
    cancelar,
    ponerUbicacion,
    reasignar,
    reintentar,
    marcarEntregada,
    segundaVisitaAMano,
    marcarPrioridad,
    pedirUbicacionAhora,
    pedirConfirmacionAhora,
    marcarContactado,
    pausarMensajes,
    crearVarias,
    leerListaPegada,
    previsualizar,
    crearAMano,
    motorizados: () => repo.listarMotorizados(),
    crearMotorizado,
    async crearMotorizadosDesdeTexto(texto) {
      const lectura = leerListaMotorizados(texto);
      const salida: ResultadoLoteMotorizados = { creados: [], repetidos: [], descartados: [...lectura.descartadas], detalle: '' };
      const vistos = new Set<string>();
      let linea = lectura.conCabecera ? 1 : 0;
      for (const f of lectura.filas) {
        linea++;
        const r = await crearMotorizado({ phone: f.telefono, nombre: f.nombre, placa: f.placa ?? null, zona: f.zona ?? null });
        if (!r.ok) {
          salida.descartados.push({ linea, texto: `${f.nombre} · ${f.telefono}`, motivo: r.motivo });
          continue;
        }
        if (vistos.has(r.motorizado.phone) || !r.nuevo) salida.repetidos.push(r.motorizado);
        else salida.creados.push(r.motorizado);
        vistos.add(r.motorizado.phone);
      }
      const partes = [`${salida.creados.length} dado${salida.creados.length === 1 ? '' : 's'} de alta`];
      if (salida.repetidos.length) partes.push(`${salida.repetidos.length} ya estaba${salida.repetidos.length === 1 ? '' : 'n'}`);
      if (salida.descartados.length) partes.push(`${salida.descartados.length} descartado${salida.descartados.length === 1 ? '' : 's'}`);
      salida.detalle = partes.join(', ') + '.';
      return salida;
    },
    editarMotorizado: async (id, patch) => {
      // A descanso o de baja con pedidos entre manos: primero se reparten
      // entre los demas (y el cliente con hora se entera), y despues el cambio.
      if (patch.estado === 'baja' || patch.estado === 'descanso') {
        const vivas = await repo.vivasDeMotorizado(id);
        if (vivas.length) await traspasarPedidos(id, { descanso: patch.estado === 'descanso', quien: 'una persona', motivo: patch.estado === 'baja' ? 'lo dieron de baja con pedidos entre manos' : 'lo pusieron en descanso con pedidos entre manos' });
      }
      return repo.actualizarMotorizado(id, patch);
    },
    quitarMotorizado: (id) => repo.quitarMotorizado(id),
    rutaDeMotorizado,
    mandarRuta,
    traspasarPedidos,
    resumen,
    async entrega(id) {
      const e = await repo.entrega(id);
      if (!e) return null;
      const motorizados = new Map((await repo.listarMotorizados()).map((m) => [m.id, m]));
      return { entrega: await fila(e, motorizados), eventos: await repo.eventos(id, 200) };
    },
    async descripcionParaIA() {
      const r = await resumen();
      const c = r.cifras;
      const partes = [`Entregas de hoy (${r.dia}): ${c.total} en total; ${c.faltaUbicacion} sin ubicación, ${c.faltaConfirmacion} sin confirmar, ${c.lista} listas para motorizado, ${c.esperando_motorizado} esperando al motorizado, ${c.avisada + c.terminada} avisadas con hora de llegada, ${c.entregada} entregadas, ${c.cancelada} canceladas, ${c.incidencia} que necesitan una persona${c.esperandoSegundaVisita ? `, ${c.esperandoSegundaVisita} esperando que el cliente diga si volvemos hoy (segunda visita)` : ''}${c.urgente ? `; ${c.urgente} urgentes` : ''}.`];
      if (r.ultimoCierre && r.ultimoCierre.dia === r.dia) partes.push(`Cierre del día de ayer hecho a las ${horaEnReloj(new Date(r.ultimoCierre.cuando), tz())}: ${r.ultimoCierre.sinTerminar.length} sin terminar, ${r.ultimoCierre.dadasPorEntregadas.length} dadas por entregadas.`);
      partes.push(`Motorizados: ${r.motorizados.filter((m) => m.estado === 'activo').length} activos de ${r.motorizados.length}.`);
      partes.push(`GSG: ${r.gsg?.descripcion ?? 'sin conexión'}.`);
      if (c.incidencia) partes.push('Con incidencia: ' + r.entregas.filter((e) => e.estado === 'incidencia').slice(0, 8).map((e) => `${e.referencia} (${e.nombre ?? e.phone}): ${e.incidenciaDetalle ?? e.incidencia}`).join('; ') + '.');
      return partes.join('\n');
    },
    async contextoDeCliente(phone) {
      const e = (await repo.vivaPorTelefono(phone)) ?? (await entregadaHoyDe(phone));
      if (!e) return null;
      const m = e.motorizadoId ? await repo.motorizado(e.motorizadoId) : null;
      const situacion = situacionDe(e, m, ajustes, tz(), reglaGsgActiva());
      return `Este cliente tiene hoy el pedido ${e.referencia}${e.nombre ? ` (a nombre de ${e.nombre})` : ''}. Situación: ${situacion}${e.llegaAproxAt && e.estado !== 'entregada' ? ` Hora aproximada de llegada: ${horaEnReloj(e.llegaAproxAt, tz())}.` : ''} Si pregunta por su pedido, responde con esto; no prometas otra hora ni otro día: eso lo coordina una persona.`;
    },
    async pedidoDe(phone) {
      const viva = await repo.vivaPorTelefono(phone);
      if (viva) return viva.referencia;
      const dia = hoy();
      const deHoy = (await repo.listar({ dia, limit: 1000 })).filter((e) => e.phone === phone);
      if (deHoy.length) return deHoy[deHoy.length - 1]!.referencia;
      const ayer = new Date(ahora().getTime() - 24 * 60 * 60 * 1000);
      const diaAyer = new Intl.DateTimeFormat('en-CA', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(ayer).slice(0, 10);
      const deAyer = (await repo.listar({ dia: diaAyer, limit: 1000 })).filter((e) => e.phone === phone);
      return deAyer.length ? deAyer[deAyer.length - 1]!.referencia : null;
    },
    async telefonosTerminadosHoy() {
      const dia = hoy();
      return (await repo.listar({ dia, estados: ['avisada', 'entregada', 'terminada'], limit: 1000 })).map((e) => ({ phone: e.phone, referencia: e.referencia }));
    },
    conectarMotor(m) {
      motor = m;
    },
  };
}
