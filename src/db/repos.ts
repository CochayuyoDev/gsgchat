/**
 * Acceso a datos.
 *
 * Cada repositorio es una interfaz + una implementacion sobre Postgres.
 * Las interfaces existen para que los gates y el router se puedan probar
 * con dobles en memoria (`tests/fakes.ts`) sin levantar la base.
 */

import { toleranteAlUuid, type Pool } from './pool.js';
import { createDesarrolladorRepo, type DesarrolladorRepo } from './desarrollador.js';
import type { ExtractionSuccess } from '../types.js';
import { createAutomationRepo, type AutomationRepo } from './automation.js';
import { createMessagesRepo, type MessagesRepo } from './messages.js';
import { createLeadsRepo, type LeadsRepo } from './leads.js';
import { createArchivesRepo, type ArchivesRepo } from './archives.js';
import { createRutasRepo, type RutasRepo } from './rutas.js';
import { createUsuariosRepo, type UsuariosRepo } from '../auth/usuarios.js';
import { createClavesApiRepo, type ClavesApiRepo } from '../auth/claves-api.js';
import { createAjustesGeneralesRepo, type AjustesGeneralesRepo } from '../ajustes/generales.js';
import { createActividadRepo, type ActividadRepo } from '../auth/actividad.js';
import { createStickersRepo, type StickersRepo } from '../stickers/stickers.js';
import { createWebhooksRepo, type WebhooksRepo } from '../webhooks/repo.js';
import { createConectoresRepo, type ConectoresRepo } from '../conectores/repo.js';
import { createEnvioAutomaticoRepo, type EnvioAutomaticoRepo } from '../envio-automatico/repo.js';
import { createPedidosRepo, type PedidosRepo } from '../pedidos/repo.js';
import { createEntrenamientoRepo, type EntrenamientoRepo } from '../entrenamiento/repo.js';
import { createCodigosConexionRepo, type CodigosConexionRepo } from '../auth/codigos-conexion.js';
import { createTiendasRepo, type TiendasRepo } from '../tiendas/repo.js';
import { createEntregasRepo, type EntregasRepo } from '../entregas/repo.js';
import { createProcesosRepo, type ProcesosRepo } from '../procesos/repo.js';

// ---------------------------------------------------------------- modelos

export interface Contact {
  id: string;
  /** Digitos del telefono; en un grupo, su jid (`...@g.us`). */
  phone: string;
  name: string | null;
  /**
   * 'persona' es un cliente; 'grupo' es un grupo de WhatsApp en el que esta
   * el numero. Un grupo se lee y se contesta a mano desde el chat, y queda
   * fuera de todo lo demas: libreta, grupos de envio, reparto, asistente.
   * Ausente = persona.
   */
  tipo?: 'persona' | 'grupo';
  optInAt: Date | null;
  optInSource: string | null;
  optOutAt: Date | null;
  lastInboundAt: Date | null;
  /**
   * Hasta cuando no se le escribe, y por que. Ver src/salud/supresion.ts.
   *
   * `null` = sin supresion. `suprimidoAmbito` distingue "nada de nada" (el
   * numero no tiene WhatsApp) de "nada de marketing" (Meta dice que ya
   * recibio demasiado: 131049, o pidio no recibirlo: 131050).
   */
  suprimidoHasta?: Date | null;
  suprimidoMotivo?: string | null;
  suprimidoAmbito?: 'todo' | 'marketing' | null;
  /**
   * Cuando se paro el bot en ESTE chat. `null` = contesta como siempre.
   *
   * Es cosa del operador, no del sistema: una conversacion que se tuerce
   * se atiende a mano, y el bot no puede meterse por encima.
   */
  botPausadoAt?: Date | null;
  /** El agente operativo cerro este chat (mando su cierre): la IA calla, lo ve una persona. */
  iaCerradaAt?: Date | null;
  iaCerradaMotivo?: string | null;
  /**
   * Como quiere ver esta conversacion quien atiende (ver migracion 037).
   *
   * Fijada arriba, silenciada (cuenta pero no grita) o apartada de la lista.
   * "Apartada" no es "guardada": guardar un chat lo respalda y lo vacia; esto
   * solo lo quita de la vista y vuelve en cuanto el cliente escribe.
   */
  chatFijadoAt?: Date | null;
  chatSilenciadoAt?: Date | null;
  chatApartadoAt?: Date | null;
  /** Envios iniciados por la empresa seguidos sin que conteste nada. */
  sinRespuestaSeguidas?: number;
  ultimoEnvioAt?: Date | null;
  /** Primer mensaje iniciado por la empresa: define si es un contacto nuevo hoy. */
  primerEnvioAt?: Date | null;
  enviosIniciados?: number;
}

/** Contacto tal como lo lista el panel: con su ultima ubicacion conocida. */
export interface ContactListItem extends Contact {
  createdAt: Date;
  lastLocation: { lat: number; lng: number; at: Date } | null;
}

export type ContactState = 'all' | 'opted_in' | 'opted_out' | 'pending';

export interface ContactListQuery {
  /** Busca por telefono o nombre (subcadena, sin distinguir mayusculas). */
  q?: string;
  /** all | opted_in | opted_out | pending (sin opt-in ni baja). */
  state?: ContactState;
  /**
   * Solo los que nunca mandaron su ubicacion.
   *
   * Es la lista a la que hay que insistirle: se pide el pin y, en cuanto
   * llega, el contacto desaparece de aqui solo. No hace falta marcarlo ni
   * sacarlo a mano de ninguna parte.
   */
  sinUbicacion?: boolean;
  limit: number;
  offset: number;
}

export interface ContactImportEntry {
  phone: string;
  name?: string | null;
}

export type TemplateStatus = 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED';
export type TemplateQuality = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
export type TemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';

export interface Template {
  name: string;
  language: string;
  category: TemplateCategory;
  status: TemplateStatus;
  quality: TemplateQuality | null;
  variables: number;
  body: string | null;
  /**
   * Hasta cuando la tiene pausada Meta. El webhook avisa de la pausa (3 h la
   * primera vez, 6 h la segunda) pero no de que termino: se calcula aqui.
   */
  pausadaHasta?: Date | null;
  /** Cuantas veces la pausaron: a la tercera Meta la deshabilita para siempre. */
  pausas?: number;
  motivo?: string | null;
  /** Desde cuando esta aprobada: una plantilla nueva sale con ritmo (pacing). */
  aprobadaAt?: Date | null;
  /** Creada desde el panel: se puede editar y borrar desde ahi. */
  propia?: boolean;
  /** Que significa cada {{n}}; son los ejemplos que ve el revisor de Meta. */
  variablesDoc?: string[] | null;
  footer?: string | null;
}

export type NivelRiesgo = 'verde' | 'amarillo' | 'naranja' | 'rojo';

/** CONNECTED | FLAGGED | RESTRICTED | BANNED | DISCONNECTED | UNKNOWN. */
export type EstadoNumero = string;

export interface NumberState {
  phoneNumberId: string;
  quality: 'GREEN' | 'YELLOW' | 'RED';
  paused: boolean;
  pausedReason: string | null;
  warmupStartedOn: Date;
  /** Tier de envio que reporta Meta (TIER_250, TIER_1K, ...). */
  tier: string | null;
  /** Estado que reporta Meta (o el proveedor): CONNECTED, FLAGGED, RESTRICTED, BANNED... */
  estado?: EstadoNumero;
  /** Riesgo calculado por el monitor de salud. Ver src/salud/riesgo.ts. */
  riesgo?: number;
  nivel?: NivelRiesgo;
  /** Multiplicador de velocidad del marcapasos: 1 normal, 0.5 mitad, 0 parado. */
  factor?: number;
  motivos?: string[] | null;
  /** Pausa automatica: hasta cuando. */
  pausadaHasta?: Date | null;
  /** Cuando empezo la rampa de vuelta tras una pausa. */
  rampaDesde?: Date | null;
  /** Limite numerico de destinatarios unicos por 24 h, si Meta lo dijo como numero. */
  limite24h?: number | null;
  ultimaEvaluacion?: Date | null;
}

export interface RiesgoPatch {
  riesgo: number;
  nivel: NivelRiesgo;
  factor: number;
  motivos: string[];
  pausadaHasta: Date | null;
  rampaDesde: Date | null;
  ultimaEvaluacion: Date;
}

export type DeliveryStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'blocked_by_gate';

export interface DeliveryListItem {
  id: number;
  campaignId: string | null;
  campaignName: string | null;
  contactId: string;
  phone: string;
  name: string | null;
  wamid: string | null;
  kind: string;
  templateName: string | null;
  category: TemplateCategory;
  status: DeliveryStatus;
  errorCode: string | null;
  errorTitle: string | null;
  queuedAt: Date;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  failedAt: Date | null;
}

export interface DeliveryListQuery {
  status?: DeliveryStatus;
  campaignId?: string;
  phone?: string;
  limit: number;
  offset: number;
}

export interface LocationListItem {
  id: number;
  contactId: string;
  phone: string;
  name: string | null;
  lat: number;
  lng: number;
  source: string;
  confidence: string;
  precisionMeters: number;
  rawInput: string | null;
  resolvedUrl: string | null;
  confirmed: boolean;
  createdAt: Date;
}

export interface Campaign {
  id: string;
  name: string;
  templateName: string;
  templateLanguage: string;
  category: TemplateCategory;
  /** draft | running | canary | paused | finished | empty | stopped */
  status: string;
  createdAt: Date;
  /** Goteo: cuantos por hora como mucho. null = el ritmo general. */
  ritmoPorHora?: number | null;
  /** Cuantos salen primero para mirar como cae la plantilla. 0 = sin canario. */
  canario?: number;
  canarioEsperaMin?: number;
  canarioEnviadoAt?: Date | null;
  motivoPausa?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
}

export type EstadoDestinatario = 'pendiente' | 'enviado' | 'bloqueado' | 'fallido' | 'cancelado';

export interface CampaignRecipient {
  id: number;
  campaignId: string;
  phone: string;
  variables: string[];
  estado: EstadoDestinatario;
  orden: number;
  canario: boolean;
  deliveryId: number | null;
  detalle: string | null;
  posponerHasta: Date | null;
  intentos: number;
  enviadoAt: Date | null;
}

/** Cifras de un envio para las ventanas de riesgo. */
export interface ResumenEntregas {
  enviados: number;
  entregados: number;
  leidos: number;
  fallidos: number;
  /** Fallos por codigo de error (131026, 131049, ...). */
  porCodigo: Record<string, number>;
  /** Destinatarios distintos entre los iniciados por la empresa. */
  destinatariosUnicos: number;
}

export interface SaludEvento {
  id: number;
  phoneNumberId: string;
  at: Date;
  tipo: string;
  codigo: string | null;
  detalle: string | null;
  contactId: string | null;
  campaignId: string | null;
  payload: Record<string, unknown> | null;
}

export interface NuevoSaludEvento {
  phoneNumberId?: string;
  at?: Date;
  tipo: string;
  codigo?: string | null;
  detalle?: string | null;
  contactId?: string | null;
  campaignId?: string | null;
  payload?: Record<string, unknown> | null;
}

export interface CampaignWithStats extends Campaign {
  stats: Record<string, number>;
  /** Destinatarios por estado (pendiente, enviado, bloqueado, fallido, cancelado). */
  destinatarios: Record<string, number>;
}

export interface TrackingLink {
  id: string;
  contactId: string | null;
  label: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface TrackingLinkListItem extends TrackingLink {
  createdAt: Date;
  phone: string | null;
  name: string | null;
  pointCount: number;
  lastPoint: { lat: number; lng: number; at: Date } | null;
}

export interface TrackPoint {
  lat: number;
  lng: number;
  accuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
  recordedAt?: Date;
}

// ------------------------------------------------------------ interfaces

export interface ContactsRepo {
  getByPhone(phone: string): Promise<Contact | null>;
  getById(id: string): Promise<Contact | null>;
  upsertFromInbound(phone: string, name?: string): Promise<Contact>;
  /** Un grupo de WhatsApp, por su jid. El nombre solo se pisa si viene. */
  upsertGrupo(jid: string, nombre?: string | null): Promise<Contact>;
  setOptIn(phone: string, source: string): Promise<void>;
  setOptOut(phone: string): Promise<void>;
  touchInbound(phone: string, at: Date): Promise<void>;
  listOptedIn(limit: number, offset: number): Promise<Contact[]>;
  list(query: ContactListQuery): Promise<{ items: ContactListItem[]; total: number }>;
  /** Alta masiva con opt-in: crea los que faltan y registra el consentimiento. */
  bulkOptIn(entries: ContactImportEntry[], source: string): Promise<number>;

  // --- salud del numero (ver src/salud) ---

  /** Deja de escribirle hasta esa fecha. `ambito` todo | marketing. */
  suprimir(phone: string, hasta: Date, motivo: string, ambito: 'todo' | 'marketing'): Promise<void>;
  levantarSupresion(phone: string): Promise<void>;
  /**
   * Para o suelta el bot en un chat.
   *
   * No es una supresion: al contacto se le puede seguir escribiendo a mano
   * y entran sus mensajes como siempre. Lo unico que se calla es la
   * respuesta automatica.
   */
  pausarBot(contactId: string, pausado: boolean, at: Date): Promise<void>;
  /**
   * El agente operativo ya mando su cierre en este chat: la IA deja de
   * contestar (lo ve una persona). No es "parar el bot": el sistema sigue con
   * lo automatico (confirmacion, hora de llegada, entregado).
   */
  cerrarIA(contactId: string, cerrada: boolean, at: Date, motivo?: string | null): Promise<void>;
  /**
   * Como se ve el chat en la lista: fijado, silenciado o apartado.
   *
   * Lo que no venga no se toca, para poder cambiar una sola cosa sin tener
   * que mandar las tres y pisar lo que otro puso.
   */
  ajustesChat(contactId: string, ajustes: { fijado?: boolean; silenciado?: boolean; apartado?: boolean }, at: Date): Promise<void>;
  /**
   * Devuelve el chat a "sin leer" moviendo el puntero de lectura hacia atras.
   *
   * No hay marca por mensaje: `chat_read_at` es un puntero por conversacion
   * (ver `messages.markRead`), asi que marcar como no leido es retrasarlo.
   */
  marcarNoLeido(contactId: string, at: Date | null): Promise<void>;
  /** Un envio iniciado por la empresa salio hacia este contacto. */
  anotarEnvioIniciado(contactId: string, at: Date): Promise<void>;
  /** Cuantos contactos recibieron su PRIMER mensaje de negocio desde esa fecha. */
  contarNuevosEscritosDesde(since: Date): Promise<number>;
  contarSuprimidos(now: Date): Promise<number>;
  contarBajasDesde(since: Date): Promise<number>;
}

export interface LocationsRepo {
  save(contactId: string, result: ExtractionSuccess, rawInput: string): Promise<number>;
  confirm(locationId: number): Promise<void>;
  latestFor(contactId: string): Promise<{ lat: number; lng: number } | null>;
  listRecent(query: { limit: number; offset: number; phone?: string }): Promise<LocationListItem[]>;
}

export interface DeliveriesRepo {
  create(input: {
    contactId: string;
    campaignId?: string | null;
    kind: string;
    templateName?: string | null;
    category: TemplateCategory;
    variables?: unknown;
    /** Fuera de ventana o con plantilla: lo que cuenta para el limite de Meta. */
    businessInitiated?: boolean;
  }): Promise<number>;
  markSent(id: number, wamid: string): Promise<void>;
  markBlocked(id: number, reason: string): Promise<void>;
  /** Marca fallido un envio que salio hacia Meta y Meta rechazo, con su codigo. */
  markFailed(id: number, code: string | null, title: string): Promise<void>;
  updateByWamid(wamid: string, status: DeliveryStatus, error?: { code?: string; title?: string }): Promise<void>;
  countMarketingSince(contactId: string, since: Date): Promise<number>;
  campaignStats(campaignId: string): Promise<Record<string, number>>;
  listRecent(query: DeliveryListQuery): Promise<DeliveryListItem[]>;

  // --- salud del numero (ver src/salud) ---

  /** Cifras de lo que salio (o fallo en Meta) desde esa fecha. */
  resumenDesde(since: Date): Promise<ResumenEntregas>;
  /** Cifras de los ultimos N envios que salieron o fallaron en Meta (opcionalmente solo desde una fecha). */
  resumenUltimos(n: number, desde?: Date | null): Promise<ResumenEntregas>;
  /** Ultimo envio que salio hacia ese contacto. */
  ultimoEnvioA(contactId: string): Promise<Date | null>;
  /** Envios iniciados por la empresa hacia ese contacto desde esa fecha. */
  contarIniciadosAContactoDesde(contactId: string, since: Date): Promise<number>;
  /** Cuando salio el ultimo envio iniciado por la empresa. */
  ultimoIniciadoAt(): Promise<Date | null>;
  /** Envios de una campana que salieron desde esa fecha (para su ritmo por hora). */
  contarCampanaDesde(campaignId: string, since: Date): Promise<number>;
  /** Envios iniciados por la empresa que salieron desde esa fecha. */
  contarIniciadosDesde(since: Date): Promise<number>;
  /** Envios de una plantilla que salieron desde esa fecha. */
  contarPlantillaDesde(templateName: string, since: Date): Promise<number>;
}

export interface TemplatesRepo {
  get(name: string, language: string): Promise<Template | null>;
  upsert(template: Template): Promise<void>;
  setStatus(name: string, language: string, status: TemplateStatus, motivo?: string | null): Promise<void>;
  setQuality(name: string, language: string, quality: TemplateQuality): Promise<void>;
  /** Meta la pauso: hasta cuando, y cuantas van. */
  marcarPausa(name: string, language: string, hasta: Date | null, pausas: number, motivo: string | null): Promise<void>;
  list(): Promise<Template[]>;
  /** Solo las propias (creadas desde el panel) se pueden borrar. */
  remove(name: string, language: string): Promise<boolean>;
}

export interface NumberStateRepo {
  get(phoneNumberId: string): Promise<NumberState>;
  setQuality(phoneNumberId: string, quality: NumberState['quality']): Promise<void>;
  setPaused(phoneNumberId: string, paused: boolean, reason?: string): Promise<void>;
  setTier(phoneNumberId: string, tier: string | null): Promise<void>;
  /** Estado que reporta Meta o el proveedor: CONNECTED, FLAGGED, RESTRICTED, BANNED... */
  setEstado(phoneNumberId: string, estado: EstadoNumero): Promise<void>;
  setRiesgo(phoneNumberId: string, patch: RiesgoPatch): Promise<void>;
  setLimite24h(phoneNumberId: string, limite: number | null): Promise<void>;
  /** Vuelve a empezar el warm-up (numero inactivo demasiados dias). */
  reiniciarWarmup(phoneNumberId: string, day: Date): Promise<void>;
}

export interface CountersRepo {
  /** Suma 1 y devuelve el total del dia para esa categoria. */
  increment(phoneNumberId: string, category: TemplateCategory, day: Date): Promise<number>;
  totalForDay(phoneNumberId: string, day: Date): Promise<number>;
}

export interface TrackingRepo {
  createLink(contactId: string | null, label: string | null, expiresAt: Date): Promise<TrackingLink>;
  getLink(id: string): Promise<TrackingLink | null>;
  revoke(id: string): Promise<void>;
  addPoint(linkId: string, point: TrackPoint): Promise<void>;
  listPoints(linkId: string, limit?: number): Promise<TrackPoint[]>;
  /** Sesiones vigentes: ni revocadas ni caducadas. */
  listActive(now: Date): Promise<TrackingLinkListItem[]>;
}

export interface CampaignsRepo {
  create(input: {
    name: string;
    templateName: string;
    templateLanguage: string;
    category: TemplateCategory;
    ritmoPorHora?: number | null;
    canario?: number;
    canarioEsperaMin?: number;
  }): Promise<string>;
  setStatus(id: string, status: string, motivo?: string | null): Promise<void>;
  get(id: string): Promise<Campaign | null>;
  list(): Promise<CampaignWithStats[]>;

  // --- goteo (ver src/campanas/goteo.ts) ---

  /** Guarda los destinatarios en orden; los `canario` salen antes que nadie. */
  agregarDestinatarios(
    campaignId: string,
    entries: Array<{ phone: string; variables: string[]; orden: number; canario: boolean }>,
  ): Promise<number>;
  /** Los siguientes que toca mandar ahora (no pospuestos), en orden. Con `soloCanario`, solo los del primer grupo. */
  siguientesPendientes(campaignId: string, limit: number, soloCanario?: boolean, ahora?: Date): Promise<CampaignRecipient[]>;
  /** Lo deja pendiente pero no antes de esa hora. */
  posponerDestinatario(id: number, hasta: Date, detalle: string | null): Promise<void>;
  /** Pendientes que quedan, pospuestos incluidos; `soloCanario` cuenta solo el grupo canario. */
  contarPendientes(campaignId: string, soloCanario?: boolean): Promise<number>;
  marcarDestinatario(
    id: number,
    estado: EstadoDestinatario,
    detalle: string | null,
    deliveryId: number | null,
    at?: Date,
  ): Promise<void>;
  cifrasDestinatarios(campaignId: string): Promise<Record<string, number>>;
  cancelarPendientes(campaignId: string, motivo: string): Promise<number>;
  /** Campanas que el goteo tiene que mirar: running, canary y paused. */
  listarActivas(): Promise<Campaign[]>;
  setCanarioEnviado(id: string, at: Date): Promise<void>;
  /** Cifras de las entregas SOLO del grupo canario. */
  resumenCanario(campaignId: string): Promise<ResumenEntregas>;
}

export interface SaludRepo {
  registrar(evento: NuevoSaludEvento): Promise<number>;
  /** Cuantos eventos desde esa fecha, por tipo y opcionalmente por codigo. */
  contar(since: Date, tipo?: string, codigo?: string): Promise<number>;
  /** Conteo por `tipo:codigo` desde esa fecha. */
  resumen(since: Date): Promise<Record<string, number>>;
  ultimos(limit: number): Promise<SaludEvento[]>;
  purgar(before: Date): Promise<number>;
}

export interface Repos {
  contacts: ContactsRepo;
  locations: LocationsRepo;
  deliveries: DeliveriesRepo;
  templates: TemplatesRepo;
  numberState: NumberStateRepo;
  counters: CountersRepo;
  tracking: TrackingRepo;
  campaigns: CampaignsRepo;
  automation: AutomationRepo;
  messages: MessagesRepo;
  leads: LeadsRepo;
  /** Indice de conversaciones respaldadas. Ver src/archive. */
  archives: ArchivesRepo;
  /** Lotes de solicitud de ubicacion. Ver src/rutas. */
  rutas: RutasRepo;
  /** Senales de riesgo del numero. Ver src/salud. */
  salud: SaludRepo;
  /** Cuentas con las que se entra al panel. Ver src/auth. */
  usuarios: UsuariosRepo;
  /** Claves con las que entran los programas (GSG, scripts). Ver src/auth. */
  claves: ClavesApiRepo;
  /** Ajustes generales editables desde la pantalla. Ver src/ajustes. */
  ajustesGenerales: AjustesGeneralesRepo;
  /** Bitacora: quien hizo que. Ver src/auth/actividad.ts. */
  actividad: ActividadRepo;
  /** La biblioteca de stickers. Ver src/stickers. */
  stickers: StickersRepo;
  /** Webhooks salientes: a quien se le cuenta lo que pasa. Ver src/webhooks. */
  webhooks: WebhooksRepo;
  /** Conectores de tiendas (WooCommerce, Shopify). Ver src/conectores. */
  conectores: ConectoresRepo;
  /** La lista de numeros a los que el sistema escribe solo. Ver src/envio-automatico. */
  envioAutomatico: EnvioAutomaticoRepo;
  /** Pedidos tomados en el chat. Ver src/pedidos. */
  pedidos: PedidosRepo;
  /** Lo que se le enseno al asistente de IA y sus examenes. Ver src/entrenamiento. */
  entrenamiento: EntrenamientoRepo;
  /** Codigos cortos con fecha limite para que otro sistema se conecte. Ver src/auth/codigos-conexion.ts. */
  codigosConexion: CodigosConexionRepo;
  /** Las tiendas que controla el superadministrador. Ver src/tiendas. */
  tiendas: TiendasRepo;
  /** Las entregas del dia y los motorizados. Ver src/entregas. */
  entregas: EntregasRepo;
  /** SQL acotado del Modulo desarrollador (borrar y adelantar lo de prueba). Sin base real (pruebas en memoria), no esta. */
  desarrollador?: DesarrolladorRepo;
  /** Los procesos (pedir datos, confirmar, avisos al personal, cobranza) y sus corridas. Ver src/procesos. */
  procesos?: ProcesosRepo;
}

/** Deja solo digitos: "+52 1 55 1234 5678" y "5215512345678" son el mismo numero. */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D+/g, '');
}

// ------------------------------------------------------- impl. Postgres

interface ContactRow {
  id: string;
  phone: string;
  name: string | null;
  tipo?: string | null;
  opt_in_at: Date | null;
  opt_in_source: string | null;
  opt_out_at: Date | null;
  last_inbound_at: Date | null;
  suprimido_hasta?: Date | null;
  suprimido_motivo?: string | null;
  suprimido_ambito?: string | null;
  bot_pausado_at?: Date | null;
  ia_cerrada_at?: Date | null;
  ia_cerrada_motivo?: string | null;
  chat_fijado_at?: Date | null;
  chat_silenciado_at?: Date | null;
  chat_apartado_at?: Date | null;
  sin_respuesta_seguidas?: number;
  ultimo_envio_at?: Date | null;
  primer_envio_at?: Date | null;
  envios_iniciados?: number;
}

const toContact = (row: ContactRow): Contact => ({
  id: row.id,
  phone: row.phone,
  name: row.name,
  tipo: row.tipo === 'grupo' ? 'grupo' : 'persona',
  optInAt: row.opt_in_at,
  optInSource: row.opt_in_source,
  optOutAt: row.opt_out_at,
  lastInboundAt: row.last_inbound_at,
  suprimidoHasta: row.suprimido_hasta ?? null,
  suprimidoMotivo: row.suprimido_motivo ?? null,
  botPausadoAt: row.bot_pausado_at ?? null,
  iaCerradaAt: row.ia_cerrada_at ?? null,
  iaCerradaMotivo: row.ia_cerrada_motivo ?? null,
  chatFijadoAt: row.chat_fijado_at ?? null,
  chatSilenciadoAt: row.chat_silenciado_at ?? null,
  chatApartadoAt: row.chat_apartado_at ?? null,
  suprimidoAmbito: row.suprimido_ambito === 'marketing' ? 'marketing' : row.suprimido_ambito === 'todo' ? 'todo' : null,
  sinRespuestaSeguidas: row.sin_respuesta_seguidas ?? 0,
  ultimoEnvioAt: row.ultimo_envio_at ?? null,
  primerEnvioAt: row.primer_envio_at ?? null,
  enviosIniciados: row.envios_iniciados ?? 0,
});

interface NumberStateRow {
  phone_number_id: string;
  quality: NumberState['quality'];
  paused: boolean;
  paused_reason: string | null;
  warmup_started_on: Date;
  tier: string | null;
  estado?: string;
  riesgo?: number;
  nivel?: string;
  factor?: number;
  motivos?: string[] | null;
  pausada_hasta?: Date | null;
  rampa_desde?: Date | null;
  limite_24h?: number | null;
  ultima_evaluacion?: Date | null;
}

const toNumberState = (row: NumberStateRow): NumberState => ({
  phoneNumberId: row.phone_number_id,
  quality: row.quality,
  paused: row.paused,
  pausedReason: row.paused_reason,
  warmupStartedOn: row.warmup_started_on,
  tier: row.tier,
  estado: row.estado ?? 'CONNECTED',
  riesgo: row.riesgo ?? 0,
  nivel: (row.nivel as NivelRiesgo | undefined) ?? 'verde',
  factor: row.factor ?? 1,
  motivos: Array.isArray(row.motivos) ? row.motivos : null,
  pausadaHasta: row.pausada_hasta ?? null,
  rampaDesde: row.rampa_desde ?? null,
  limite24h: row.limite_24h ?? null,
  ultimaEvaluacion: row.ultima_evaluacion ?? null,
});

interface LinkRow {
  id: string;
  contact_id: string | null;
  label: string | null;
  expires_at: Date;
  revoked_at: Date | null;
}

const toLink = (row: LinkRow): TrackingLink => ({
  id: row.id,
  contactId: row.contact_id,
  label: row.label,
  expiresAt: row.expires_at,
  revokedAt: row.revoked_at,
});

interface CampaignRow {
  id: string;
  name: string;
  template_name: string;
  template_language: string;
  category: TemplateCategory;
  status: string;
  created_at: Date;
  ritmo_por_hora?: number | null;
  canario?: number;
  canario_espera_min?: number;
  canario_enviado_at?: Date | null;
  motivo_pausa?: string | null;
  started_at?: Date | null;
  finished_at?: Date | null;
}

const toCampaign = (row: CampaignRow): Campaign => ({
  id: row.id,
  name: row.name,
  templateName: row.template_name,
  templateLanguage: row.template_language,
  category: row.category,
  status: row.status,
  createdAt: row.created_at,
  ritmoPorHora: row.ritmo_por_hora ?? null,
  canario: row.canario ?? 0,
  canarioEsperaMin: row.canario_espera_min ?? 60,
  canarioEnviadoAt: row.canario_enviado_at ?? null,
  motivoPausa: row.motivo_pausa ?? null,
  startedAt: row.started_at ?? null,
  finishedAt: row.finished_at ?? null,
});

interface RecipientRow {
  id: number;
  campaign_id: string;
  phone: string;
  variables: string[] | null;
  estado: EstadoDestinatario;
  orden: number;
  canario: boolean;
  delivery_id: number | null;
  detalle: string | null;
  posponer_hasta: Date | null;
  intentos: number;
  enviado_at: Date | null;
}

const toRecipient = (row: RecipientRow): CampaignRecipient => ({
  id: row.id,
  campaignId: row.campaign_id,
  phone: row.phone,
  variables: Array.isArray(row.variables) ? row.variables : [],
  estado: row.estado,
  orden: row.orden,
  canario: row.canario,
  deliveryId: row.delivery_id,
  detalle: row.detalle,
  posponerHasta: row.posponer_hasta,
  intentos: row.intentos ?? 0,
  enviadoAt: row.enviado_at,
});

/** Orden de los acuses: nada se mueve hacia atras. */
const RANGO_ESTADO = (expr: string): string =>
  `(case ${expr} when 'read' then 3 when 'delivered' then 2 when 'sent' then 1 else 0 end)`;

interface ResumenRow {
  enviados: number;
  entregados: number;
  leidos: number;
  fallidos: number;
  unicos: number;
}

/** El SELECT que resume entregas; se comparte entre las ventanas. */
const RESUMEN_SELECT = `
  count(*) filter (where status in ('sent','delivered','read','failed'))::int as enviados,
  count(*) filter (where status in ('delivered','read'))::int as entregados,
  count(*) filter (where status = 'read')::int as leidos,
  count(*) filter (where status = 'failed')::int as fallidos,
  count(distinct contact_id) filter (where business_initiated and status in ('sent','delivered','read'))::int as unicos`;

const toResumen = (row: ResumenRow | undefined, porCodigo: Array<{ code: string; count: number }>): ResumenEntregas => ({
  enviados: row?.enviados ?? 0,
  entregados: row?.entregados ?? 0,
  leidos: row?.leidos ?? 0,
  fallidos: row?.fallidos ?? 0,
  porCodigo: Object.fromEntries(porCodigo.map((r) => [r.code, r.count])),
  destinatariosUnicos: row?.unicos ?? 0,
});

interface SaludRow {
  id: number;
  phone_number_id: string;
  at: Date;
  tipo: string;
  codigo: string | null;
  detalle: string | null;
  contact_id: string | null;
  campaign_id: string | null;
  payload: Record<string, unknown> | null;
}

const toSaludEvento = (row: SaludRow): SaludEvento => ({
  id: row.id,
  phoneNumberId: row.phone_number_id,
  at: row.at,
  tipo: row.tipo,
  codigo: row.codigo,
  detalle: row.detalle,
  contactId: row.contact_id,
  campaignId: row.campaign_id,
  payload: row.payload,
});

export function createRepos(poolCrudo: Pool): Repos {
  // Campanas, webhooks y conectores tienen id uuid: uno mal pegado en la
  // URL ("None", "undefined") es un 404, no un 500 (ver toleranteAlUuid).
  const pool = toleranteAlUuid(poolCrudo);
  const contacts: ContactsRepo = {
    async getByPhone(phone) {
      const { rows } = await pool.query<ContactRow>('select * from contacts where phone = $1', [phone]);
      return rows[0] ? toContact(rows[0]) : null;
    },
    async getById(id) {
      const { rows } = await pool.query<ContactRow>('select * from contacts where id = $1', [id]);
      return rows[0] ? toContact(rows[0]) : null;
    },
    async upsertFromInbound(phone, name) {
      const { rows } = await pool.query<ContactRow>(
        `insert into contacts (phone, name)
         values ($1, $2)
         on conflict (phone) do update set name = coalesce(excluded.name, contacts.name)
         returning *`,
        [phone, name ?? null],
      );
      return toContact(rows[0]!);
    },
    async upsertGrupo(jid, nombre) {
      const { rows } = await pool.query<ContactRow>(
        `insert into contacts (phone, name, tipo)
         values ($1, $2, 'grupo')
         on conflict (phone) do update set name = coalesce(excluded.name, contacts.name), tipo = 'grupo'
         returning *`,
        [jid, nombre?.trim() || null],
      );
      return toContact(rows[0]!);
    },
    async setOptIn(phone, source) {
      // Un alta borra la baja previa: el contacto acaba de decir que si.
      await pool.query(
        `update contacts
            set opt_in_at = now(), opt_in_source = $2, opt_out_at = null
          where phone = $1`,
        [phone, source],
      );
    },
    async setOptOut(phone) {
      await pool.query('update contacts set opt_out_at = now() where phone = $1', [phone]);
    },
    async touchInbound(phone, at) {
      // Contestar corta la racha de "sin respuesta": la fatiga se mide en
      // envios seguidos que el cliente ignoro, no en envios totales.
      await pool.query(
        'update contacts set last_inbound_at = $2, sin_respuesta_seguidas = 0 where phone = $1',
        [phone, at],
      );
    },
    async listOptedIn(limit, offset) {
      const { rows } = await pool.query<ContactRow>(
        `select * from contacts
          where opt_in_at is not null and opt_out_at is null and tipo <> 'grupo'
          order by created_at
          limit $1 offset $2`,
        [limit, offset],
      );
      return rows.map(toContact);
    },
    async list(query) {
      // La libreta son personas: un grupo no se importa, no da su
      // consentimiento ni entra en un lote de reparto.
      const conditions: string[] = ["c.tipo <> 'grupo'"];
      const params: unknown[] = [];
      if (query.q?.trim()) {
        params.push(`%${query.q.trim()}%`);
        conditions.push(`(c.phone ilike $${params.length} or c.name ilike $${params.length})`);
      }
      switch (query.state ?? 'all') {
        case 'opted_in':
          conditions.push('c.opt_in_at is not null and c.opt_out_at is null');
          break;
        case 'opted_out':
          conditions.push('c.opt_out_at is not null');
          break;
        case 'pending':
          conditions.push('c.opt_in_at is null and c.opt_out_at is null');
          break;
        default:
          break;
      }
      // Los que nunca mandaron ubicacion. `not exists` y no un left join:
      // la lista se pide para escribirles, y un join que duplica filas
      // acabaria mandandole dos mensajes al mismo.
      if (query.sinUbicacion) {
        conditions.push('not exists (select 1 from locations l2 where l2.contact_id = c.id)');
      }

      const where = conditions.length ? `where ${conditions.join(' and ')}` : '';

      const total = await pool.query<{ total: number }>(
        `select count(*)::int as total from contacts c ${where}`,
        params,
      );

      const { rows } = await pool.query<
        ContactRow & {
          created_at: Date;
          loc_lat: number | null;
          loc_lng: number | null;
          loc_at: Date | null;
        }
      >(
        `select c.*, l.lat as loc_lat, l.lng as loc_lng, l.created_at as loc_at
           from contacts c
           left join lateral (
             select lat, lng, created_at from locations
              where contact_id = c.id order by created_at desc, id desc limit 1
           ) l on true
          ${where}
          order by coalesce(c.last_inbound_at, c.created_at) desc
          limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, query.limit, query.offset],
      );

      return {
        total: total.rows[0]?.total ?? 0,
        items: rows.map((row) => ({
          ...toContact(row),
          createdAt: row.created_at,
          lastLocation:
            row.loc_lat !== null && row.loc_lng !== null && row.loc_at
              ? { lat: row.loc_lat, lng: row.loc_lng, at: row.loc_at }
              : null,
        })),
      };
    },
    async bulkOptIn(entries, source) {
      const cleaned = new Map<string, string | null>();
      for (const entry of entries) {
        const phone = normalizePhone(entry.phone);
        if (phone.length < 6) continue;
        cleaned.set(phone, entry.name?.trim() || cleaned.get(phone) || null);
      }
      if (!cleaned.size) return 0;

      const phones = [...cleaned.keys()];
      const names = phones.map((p) => cleaned.get(p) ?? null);
      const { rowCount } = await pool.query(
        `insert into contacts (phone, name, opt_in_at, opt_in_source, opt_out_at)
         select p, n, now(), $3, null
           from unnest($1::text[], $2::text[]) as t(p, n)
         on conflict (phone) do update set
           name = coalesce(excluded.name, contacts.name),
           opt_in_at = now(),
           opt_in_source = excluded.opt_in_source,
           opt_out_at = null`,
        [phones, names, source],
      );
      return rowCount ?? phones.length;
    },

    async suprimir(phone, hasta, motivo, ambito) {
      await pool.query(
        `update contacts
            set suprimido_hasta = $2, suprimido_motivo = $3, suprimido_ambito = $4
          where phone = $1`,
        [phone, hasta, motivo.slice(0, 300), ambito],
      );
    },
    async pausarBot(contactId, pausado, at) {
      await pool.query('update contacts set bot_pausado_at = $2 where id = $1', [
        contactId,
        pausado ? at : null,
      ]);
    },
    async cerrarIA(contactId, cerrada, at, motivo) {
      await pool.query('update contacts set ia_cerrada_at = $2, ia_cerrada_motivo = $3 where id = $1', [
        contactId,
        cerrada ? at : null,
        cerrada ? (motivo ?? '').slice(0, 300) || null : null,
      ]);
    },
    async ajustesChat(contactId, ajustes, at) {
      const sets: string[] = [];
      const params: unknown[] = [contactId];
      const poner = (columna: string, valor: boolean | undefined) => {
        if (valor === undefined) return;
        params.push(valor ? at : null);
        sets.push(`${columna} = $${params.length}`);
      };
      poner('chat_fijado_at', ajustes.fijado);
      poner('chat_silenciado_at', ajustes.silenciado);
      poner('chat_apartado_at', ajustes.apartado);
      if (!sets.length) return;
      await pool.query(`update contacts set ${sets.join(', ')} where id = $1`, params);
    },
    async marcarNoLeido(contactId, at) {
      await pool.query('update contacts set chat_read_at = $2 where id = $1', [contactId, at]);
    },
    async levantarSupresion(phone) {
      await pool.query(
        `update contacts
            set suprimido_hasta = null, suprimido_motivo = null, suprimido_ambito = null
          where phone = $1`,
        [phone],
      );
    },
    async anotarEnvioIniciado(contactId, at) {
      await pool.query(
        `update contacts
            set ultimo_envio_at = $2,
                primer_envio_at = coalesce(primer_envio_at, $2),
                envios_iniciados = envios_iniciados + 1,
                sin_respuesta_seguidas = sin_respuesta_seguidas + 1
          where id = $1`,
        [contactId, at],
      );
    },
    async contarNuevosEscritosDesde(since) {
      const { rows } = await pool.query<{ total: number }>(
        // Sin los numeros del Modulo desarrollador: no cuentan en la salud del numero real.
        "select count(*)::int as total from contacts where primer_envio_at >= $1 and phone !~ '^51000[01][0-9]{5}$'",
        [since],
      );
      return rows[0]?.total ?? 0;
    },
    async contarSuprimidos(now) {
      const { rows } = await pool.query<{ total: number }>(
        "select count(*)::int as total from contacts where suprimido_hasta > $1 and phone !~ '^51000[01][0-9]{5}$'",
        [now],
      );
      return rows[0]?.total ?? 0;
    },
    async contarBajasDesde(since) {
      const { rows } = await pool.query<{ total: number }>(
        "select count(*)::int as total from contacts where opt_out_at >= $1 and phone !~ '^51000[01][0-9]{5}$'",
        [since],
      );
      return rows[0]?.total ?? 0;
    },
  };

  const locations: LocationsRepo = {
    async save(contactId, result, rawInput) {
      const { rows } = await pool.query<{ id: number }>(
        `insert into locations
           (contact_id, lat, lng, source, confidence, precision_meters, raw_input, resolved_url)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         returning id`,
        [
          contactId,
          result.lat,
          result.lng,
          result.source,
          result.confidence,
          result.precisionMeters,
          rawInput.slice(0, 4000),
          result.resolvedUrl ?? null,
        ],
      );
      return rows[0]!.id;
    },
    async confirm(locationId) {
      await pool.query('update locations set confirmed = true where id = $1', [locationId]);
    },
    async latestFor(contactId) {
      const { rows } = await pool.query<{ lat: number; lng: number }>(
        'select lat, lng from locations where contact_id = $1 order by created_at desc, id desc limit 1',
        [contactId],
      );
      return rows[0] ?? null;
    },
    async listRecent(query) {
      const params: unknown[] = [];
      let where = '';
      if (query.phone) {
        params.push(query.phone);
        where = `where c.phone = $${params.length}`;
      }
      const { rows } = await pool.query<{
        id: number;
        contact_id: string;
        phone: string;
        name: string | null;
        lat: number;
        lng: number;
        source: string;
        confidence: string;
        precision_meters: number;
        raw_input: string | null;
        resolved_url: string | null;
        confirmed: boolean;
        created_at: Date;
      }>(
        `select l.id, l.contact_id, c.phone, c.name, l.lat, l.lng, l.source, l.confidence,
                l.precision_meters, l.raw_input, l.resolved_url, l.confirmed, l.created_at
           from locations l
           join contacts c on c.id = l.contact_id
          ${where}
          order by l.created_at desc, l.id desc
          limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, query.limit, query.offset],
      );
      return rows.map((r) => ({
        id: r.id,
        contactId: r.contact_id,
        phone: r.phone,
        name: r.name,
        lat: r.lat,
        lng: r.lng,
        source: r.source,
        confidence: r.confidence,
        precisionMeters: r.precision_meters,
        rawInput: r.raw_input,
        resolvedUrl: r.resolved_url,
        confirmed: r.confirmed,
        createdAt: r.created_at,
      }));
    },
  };

  const deliveries: DeliveriesRepo = {
    async create(input) {
      const { rows } = await pool.query<{ id: number }>(
        `insert into deliveries
           (contact_id, campaign_id, kind, template_name, category, variables, business_initiated)
         values ($1,$2,$3,$4,$5,$6,$7)
         returning id`,
        [
          input.contactId,
          input.campaignId ?? null,
          input.kind,
          input.templateName ?? null,
          input.category,
          input.variables ? JSON.stringify(input.variables) : null,
          input.businessInitiated ?? false,
        ],
      );
      return rows[0]!.id;
    },
    async markSent(id, wamid) {
      await pool.query(
        `update deliveries set status = 'sent', wamid = $2, sent_at = now() where id = $1`,
        [id, wamid],
      );
    },
    async markBlocked(id, reason) {
      await pool.query(
        `update deliveries
            set status = 'blocked_by_gate', error_title = $2, failed_at = now()
          where id = $1`,
        [id, reason],
      );
    },
    async markFailed(id, code, title) {
      // `sent_at` se rellena tambien: el envio SALIO hacia Meta y Meta lo
      // rechazo. Es lo que separa un fallo real (cuenta para el riesgo) de
      // un bloqueo de guarda propia (no salio nada).
      await pool.query(
        `update deliveries
            set status = 'failed', error_code = $2, error_title = $3,
                sent_at = coalesce(sent_at, now()), failed_at = now()
          where id = $1`,
        [id, code, title.slice(0, 500)],
      );
    },
    async updateByWamid(wamid, status, error) {
      const column =
        status === 'delivered'
          ? 'delivered_at'
          : status === 'read'
            ? 'read_at'
            : status === 'failed'
              ? 'failed_at'
              : 'sent_at';
      // Los acuses no van hacia atras ni mueven fechas ya puestas: al
      // reconectar, WhatsApp Web vuelve a mandar el "sent" de mensajes de
      // hace horas, y con un `sent_at = now()` a secas esos envios parecian
      // recientes (la separacion por contacto los veia como "hace 1 min").
      // Un `failed` si manda siempre: es informacion nueva.
      await pool.query(
        `update deliveries
            set status = case
                  when $2 = 'failed' then 'failed'
                  when ${RANGO_ESTADO('status')} >= ${RANGO_ESTADO('$2')} then status
                  else $2 end,
                ${column} = coalesce(${column}, now()),
                error_code = coalesce($3, error_code),
                error_title = coalesce($4, error_title)
          where wamid = $1`,
        [wamid, status, error?.code ?? null, error?.title ?? null],
      );
    },
    async countMarketingSince(contactId, since) {
      const { rows } = await pool.query<{ count: number }>(
        `select count(*)::int as count
           from deliveries
          where contact_id = $1
            and category = 'MARKETING'
            and status in ('sent','delivered','read')
            and queued_at >= $2`,
        [contactId, since],
      );
      return rows[0]?.count ?? 0;
    },
    async campaignStats(campaignId) {
      const { rows } = await pool.query<{ status: string; count: number }>(
        `select status, count(*)::int as count
           from deliveries where campaign_id = $1 group by status`,
        [campaignId],
      );
      return Object.fromEntries(rows.map((r) => [r.status, r.count]));
    },
    async resumenDesde(since) {
      const { rows } = await pool.query<ResumenRow>(
        `select ${RESUMEN_SELECT} from deliveries where sent_at >= $1`,
        [since],
      );
      const codes = await pool.query<{ code: string; count: number }>(
        `select error_code as code, count(*)::int as count
           from deliveries
          where sent_at >= $1 and status = 'failed' and error_code is not null
          group by error_code`,
        [since],
      );
      return toResumen(rows[0], codes.rows);
    },
    async resumenUltimos(n, desde) {
      const params: unknown[] = [n, desde ?? new Date(0)];
      const { rows } = await pool.query<ResumenRow>(
        `select ${RESUMEN_SELECT}
           from (select * from deliveries where sent_at is not null and sent_at >= $2
                  order by sent_at desc, id desc limit $1) d`,
        params,
      );
      const codes = await pool.query<{ code: string; count: number }>(
        `select error_code as code, count(*)::int as count
           from (select * from deliveries where sent_at is not null and sent_at >= $2
                  order by sent_at desc, id desc limit $1) d
          where status = 'failed' and error_code is not null
          group by error_code`,
        params,
      );
      return toResumen(rows[0], codes.rows);
    },
    async contarCampanaDesde(campaignId, since) {
      const { rows } = await pool.query<{ total: number }>(
        `select count(*)::int as total from deliveries
          where campaign_id = $1 and sent_at >= $2 and status in ('sent','delivered','read','failed')`,
        [campaignId, since],
      );
      return rows[0]?.total ?? 0;
    },
    async ultimoIniciadoAt() {
      const { rows } = await pool.query<{ at: Date | null }>(
        'select max(sent_at) as at from deliveries where business_initiated and sent_at is not null',
      );
      return rows[0]?.at ?? null;
    },
    async contarIniciadosAContactoDesde(contactId, since) {
      const { rows } = await pool.query<{ total: number }>(
        `select count(*)::int as total from deliveries
          where contact_id = $1 and business_initiated and sent_at >= $2
            and status in ('sent','delivered','read','failed')`,
        [contactId, since],
      );
      return rows[0]?.total ?? 0;
    },
    async ultimoEnvioA(contactId) {
      const { rows } = await pool.query<{ at: Date | null }>(
        `select max(sent_at) as at from deliveries
          where contact_id = $1 and sent_at is not null and status in ('sent','delivered','read')`,
        [contactId],
      );
      return rows[0]?.at ?? null;
    },
    async contarIniciadosDesde(since) {
      const { rows } = await pool.query<{ total: number }>(
        `select count(*)::int as total from deliveries
          where business_initiated and sent_at >= $1 and status in ('sent','delivered','read','failed')`,
        [since],
      );
      return rows[0]?.total ?? 0;
    },
    async contarPlantillaDesde(templateName, since) {
      const { rows } = await pool.query<{ total: number }>(
        `select count(*)::int as total from deliveries
          where template_name = $1 and sent_at >= $2 and status in ('sent','delivered','read')`,
        [templateName, since],
      );
      return rows[0]?.total ?? 0;
    },
    async listRecent(query) {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (query.status) {
        params.push(query.status);
        conditions.push(`d.status = $${params.length}`);
      }
      if (query.campaignId) {
        params.push(query.campaignId);
        conditions.push(`d.campaign_id = $${params.length}`);
      }
      if (query.phone) {
        params.push(query.phone);
        conditions.push(`c.phone = $${params.length}`);
      }
      const where = conditions.length ? `where ${conditions.join(' and ')}` : '';
      const { rows } = await pool.query<{
        id: number;
        campaign_id: string | null;
        campaign_name: string | null;
        contact_id: string;
        phone: string;
        name: string | null;
        wamid: string | null;
        kind: string;
        template_name: string | null;
        category: TemplateCategory;
        status: DeliveryStatus;
        error_code: string | null;
        error_title: string | null;
        queued_at: Date;
        sent_at: Date | null;
        delivered_at: Date | null;
        read_at: Date | null;
        failed_at: Date | null;
      }>(
        `select d.id, d.campaign_id, k.name as campaign_name, d.contact_id, c.phone, c.name,
                d.wamid, d.kind, d.template_name, d.category, d.status, d.error_code,
                d.error_title, d.queued_at, d.sent_at, d.delivered_at, d.read_at, d.failed_at
           from deliveries d
           join contacts c on c.id = d.contact_id
           left join campaigns k on k.id = d.campaign_id
          ${where}
          order by d.queued_at desc, d.id desc
          limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, query.limit, query.offset],
      );
      return rows.map((r) => ({
        id: r.id,
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        contactId: r.contact_id,
        phone: r.phone,
        name: r.name,
        wamid: r.wamid,
        kind: r.kind,
        templateName: r.template_name,
        category: r.category,
        status: r.status,
        errorCode: r.error_code,
        errorTitle: r.error_title,
        queuedAt: r.queued_at,
        sentAt: r.sent_at,
        deliveredAt: r.delivered_at,
        readAt: r.read_at,
        failedAt: r.failed_at,
      }));
    },
  };

  interface TemplateRow {
    name: string;
    language: string;
    category: TemplateCategory;
    status: TemplateStatus;
    quality: TemplateQuality | null;
    variables: number;
    body: string | null;
    pausada_hasta: Date | null;
    pausas: number;
    motivo: string | null;
    aprobada_at: Date | null;
    propia: boolean;
    variables_doc: string[] | null;
    footer: string | null;
  }
  const TEMPLATE_COLS =
    'name, language, category, status, quality, variables, body, pausada_hasta, pausas, motivo, aprobada_at, propia, variables_doc, footer';
  const toTemplate = (r: TemplateRow): Template => ({
    name: r.name,
    language: r.language,
    category: r.category,
    status: r.status,
    quality: r.quality,
    variables: r.variables,
    body: r.body,
    pausadaHasta: r.pausada_hasta,
    pausas: r.pausas ?? 0,
    motivo: r.motivo,
    aprobadaAt: r.aprobada_at,
    propia: r.propia ?? false,
    variablesDoc: Array.isArray(r.variables_doc) ? r.variables_doc : null,
    footer: r.footer,
  });

  const templates: TemplatesRepo = {
    async get(name, language) {
      const { rows } = await pool.query<TemplateRow>(
        `select ${TEMPLATE_COLS} from templates where name = $1 and language = $2`,
        [name, language],
      );
      return rows[0] ? toTemplate(rows[0]) : null;
    },
    async upsert(t) {
      await pool.query(
        `insert into templates
           (name, language, category, status, quality, variables, body, propia, variables_doc, footer, synced_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), now())
         on conflict (name, language) do update set
           category = excluded.category,
           status = excluded.status,
           quality = coalesce(excluded.quality, templates.quality),
           variables = excluded.variables,
           body = excluded.body,
           -- Propia se queda propia: una sincronizacion con Meta no la
           -- convierte en "del catalogo".
           propia = templates.propia or excluded.propia,
           variables_doc = coalesce(excluded.variables_doc, templates.variables_doc),
           footer = coalesce(excluded.footer, templates.footer),
           -- Desde cuando esta aprobada: se fija la primera vez que se ve
           -- APPROVED y no se toca mas. Una plantilla nueva sale con ritmo.
           aprobada_at = case
             when excluded.status = 'APPROVED' then coalesce(templates.aprobada_at, now())
             else templates.aprobada_at end,
           synced_at = now(),
           updated_at = now()`,
        [
          t.name,
          t.language,
          t.category,
          t.status,
          t.quality,
          t.variables,
          t.body,
          t.propia ?? false,
          t.variablesDoc ? JSON.stringify(t.variablesDoc) : null,
          t.footer ?? null,
        ],
      );
      if (t.status === 'APPROVED') {
        await pool.query(
          'update templates set aprobada_at = coalesce(aprobada_at, now()) where name = $1 and language = $2',
          [t.name, t.language],
        );
      }
    },
    async setStatus(name, language, status, motivo) {
      await pool.query(
        `update templates
            set status = $3,
                motivo = coalesce($4, motivo),
                aprobada_at = case when $3 = 'APPROVED' then coalesce(aprobada_at, now()) else aprobada_at end,
                -- Aprobada o reinstaurada: ya no esta pausada.
                pausada_hasta = case when $3 = 'APPROVED' then null else pausada_hasta end
          where name = $1 and language = $2`,
        [name, language, status, motivo ?? null],
      );
    },
    async marcarPausa(name, language, hasta, pausas, motivo) {
      await pool.query(
        `update templates set pausada_hasta = $3, pausas = $4, motivo = $5
          where name = $1 and language = $2`,
        [name, language, hasta, pausas, motivo],
      );
    },
    async setQuality(name, language, quality) {
      await pool.query('update templates set quality = $3 where name = $1 and language = $2', [
        name,
        language,
        quality,
      ]);
    },
    async list() {
      const { rows } = await pool.query<TemplateRow>(`select ${TEMPLATE_COLS} from templates order by name`);
      return rows.map(toTemplate);
    },
    async remove(name, language) {
      const { rowCount } = await pool.query('delete from templates where name = $1 and language = $2 and propia', [name, language]);
      return (rowCount ?? 0) > 0;
    },
  };

  const numberState: NumberStateRepo = {
    async get(phoneNumberId) {
      const { rows } = await pool.query<NumberStateRow>(
        `insert into number_state (phone_number_id) values ($1)
         on conflict (phone_number_id) do update set updated_at = now()
         returning *`,
        [phoneNumberId],
      );
      return toNumberState(rows[0]!);
    },
    async setQuality(phoneNumberId, quality) {
      await pool.query(
        `insert into number_state (phone_number_id, quality) values ($1,$2)
         on conflict (phone_number_id) do update set quality = $2, updated_at = now()`,
        [phoneNumberId, quality],
      );
    },
    async setPaused(phoneNumberId, paused, reason) {
      await pool.query(
        `insert into number_state (phone_number_id, paused, paused_reason) values ($1,$2,$3)
         on conflict (phone_number_id) do update set
           paused = $2, paused_reason = $3, updated_at = now()`,
        [phoneNumberId, paused, reason ?? null],
      );
    },
    async setTier(phoneNumberId, tier) {
      await pool.query(
        `insert into number_state (phone_number_id, tier) values ($1,$2)
         on conflict (phone_number_id) do update set tier = $2, updated_at = now()`,
        [phoneNumberId, tier],
      );
    },
    async setEstado(phoneNumberId, estado) {
      await pool.query(
        `insert into number_state (phone_number_id, estado) values ($1,$2)
         on conflict (phone_number_id) do update set estado = $2, updated_at = now()`,
        [phoneNumberId, estado],
      );
    },
    async setRiesgo(phoneNumberId, patch) {
      await pool.query(
        `insert into number_state
           (phone_number_id, riesgo, nivel, factor, motivos, pausada_hasta, rampa_desde, ultima_evaluacion)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (phone_number_id) do update set
           riesgo = $2, nivel = $3, factor = $4, motivos = $5,
           pausada_hasta = $6, rampa_desde = $7, ultima_evaluacion = $8, updated_at = now()`,
        [
          phoneNumberId,
          patch.riesgo,
          patch.nivel,
          patch.factor,
          JSON.stringify(patch.motivos),
          patch.pausadaHasta,
          patch.rampaDesde,
          patch.ultimaEvaluacion,
        ],
      );
    },
    async setLimite24h(phoneNumberId, limite) {
      await pool.query(
        `insert into number_state (phone_number_id, limite_24h) values ($1,$2)
         on conflict (phone_number_id) do update set limite_24h = $2, updated_at = now()`,
        [phoneNumberId, limite],
      );
    },
    async reiniciarWarmup(phoneNumberId, day) {
      await pool.query(
        `insert into number_state (phone_number_id, warmup_started_on) values ($1,$2)
         on conflict (phone_number_id) do update set warmup_started_on = $2, updated_at = now()`,
        [phoneNumberId, day],
      );
    },
  };

  const counters: CountersRepo = {
    async increment(phoneNumberId, category, day) {
      const { rows } = await pool.query<{ sent: number }>(
        `insert into send_counters (phone_number_id, day, category, sent)
         values ($1,$2,$3,1)
         on conflict (phone_number_id, day, category)
           do update set sent = send_counters.sent + 1
         returning sent`,
        [phoneNumberId, day, category],
      );
      return rows[0]!.sent;
    },
    async totalForDay(phoneNumberId, day) {
      const { rows } = await pool.query<{ total: number }>(
        `select coalesce(sum(sent),0)::int as total
           from send_counters where phone_number_id = $1 and day = $2`,
        [phoneNumberId, day],
      );
      return rows[0]?.total ?? 0;
    },
  };

  const tracking: TrackingRepo = {
    async createLink(contactId, label, expiresAt) {
      const { rows } = await pool.query<LinkRow>(
        `insert into tracking_links (contact_id, label, expires_at)
         values ($1,$2,$3) returning *`,
        [contactId, label, expiresAt],
      );
      return toLink(rows[0]!);
    },
    async getLink(id) {
      const { rows } = await pool.query<LinkRow>('select * from tracking_links where id = $1', [id]);
      return rows[0] ? toLink(rows[0]) : null;
    },
    async revoke(id) {
      await pool.query('update tracking_links set revoked_at = now() where id = $1', [id]);
    },
    async addPoint(linkId, p) {
      await pool.query(
        `insert into track_points (link_id, lat, lng, accuracy, heading, speed)
         values ($1,$2,$3,$4,$5,$6)`,
        [linkId, p.lat, p.lng, p.accuracy ?? null, p.heading ?? null, p.speed ?? null],
      );
    },
    async listPoints(linkId, limit = 500) {
      const { rows } = await pool.query<TrackPoint>(
        // El desempate por id importa: dos posiciones seguidas pueden caer en
        // el mismo instante y sin el la polilinea del mapa se dibuja al reves.
        `select lat, lng, accuracy, heading, speed, recorded_at as "recordedAt"
           from track_points where link_id = $1
          order by recorded_at desc, id desc limit $2`,
        [linkId, limit],
      );
      return rows.reverse();
    },
    async listActive(now) {
      const { rows } = await pool.query<
        LinkRow & {
          created_at: Date;
          phone: string | null;
          name: string | null;
          point_count: number;
          last_lat: number | null;
          last_lng: number | null;
          last_at: Date | null;
        }
      >(
        `select t.*, c.phone, c.name,
                (select count(*)::int from track_points p where p.link_id = t.id) as point_count,
                lp.lat as last_lat, lp.lng as last_lng, lp.recorded_at as last_at
           from tracking_links t
           left join contacts c on c.id = t.contact_id
           left join lateral (
             select lat, lng, recorded_at from track_points
              where link_id = t.id order by recorded_at desc, id desc limit 1
           ) lp on true
          where t.revoked_at is null and t.expires_at > $1
          order by t.created_at desc`,
        [now],
      );
      return rows.map((row) => ({
        ...toLink(row),
        createdAt: row.created_at,
        phone: row.phone,
        name: row.name,
        pointCount: row.point_count,
        lastPoint:
          row.last_lat !== null && row.last_lng !== null && row.last_at
            ? { lat: row.last_lat, lng: row.last_lng, at: row.last_at }
            : null,
      }));
    },
  };

  const campaigns: CampaignsRepo = {
    async create(input) {
      const { rows } = await pool.query<{ id: string }>(
        `insert into campaigns
           (name, template_name, template_language, category, ritmo_por_hora, canario, canario_espera_min)
         values ($1,$2,$3,$4,$5,$6,$7) returning id`,
        [
          input.name,
          input.templateName,
          input.templateLanguage,
          input.category,
          input.ritmoPorHora ?? null,
          input.canario ?? 0,
          input.canarioEsperaMin ?? 60,
        ],
      );
      return rows[0]!.id;
    },
    async setStatus(id, status, motivo) {
      await pool.query(
        `update campaigns
            set status = $2,
                motivo_pausa = $3,
                started_at = case when $2 in ('running','canary') then coalesce(started_at, now()) else started_at end,
                finished_at = case when $2 in ('finished','stopped','empty') then coalesce(finished_at, now()) else null end
          where id = $1`,
        [id, status, motivo ?? null],
      );
    },
    async get(id) {
      const { rows } = await pool.query<CampaignRow>('select * from campaigns where id = $1', [id]);
      return rows[0] ? toCampaign(rows[0]) : null;
    },
    async list() {
      const { rows } = await pool.query<
        CampaignRow & { stats: Record<string, number> | null; destinatarios: Record<string, number> | null }
      >(
        `select k.*,
                (select jsonb_object_agg(s.status, s.count)
                   from (select status, count(*)::int as count
                           from deliveries where campaign_id = k.id group by status) s) as stats,
                (select jsonb_object_agg(r.estado, r.count)
                   from (select estado, count(*)::int as count
                           from campaign_recipients where campaign_id = k.id group by estado) r) as destinatarios
           from campaigns k
          order by k.created_at desc`,
      );
      return rows.map((row) => ({
        ...toCampaign(row),
        stats: row.stats ?? {},
        destinatarios: row.destinatarios ?? {},
      }));
    },

    async agregarDestinatarios(campaignId, entries) {
      if (!entries.length) return 0;
      const phones = entries.map((e) => e.phone);
      const variables = entries.map((e) => JSON.stringify(e.variables ?? []));
      const ordenes = entries.map((e) => e.orden);
      const canarios = entries.map((e) => e.canario);
      const { rowCount } = await pool.query(
        `insert into campaign_recipients (campaign_id, phone, variables, orden, canario)
         select $1, p, v::jsonb, o, c
           from unnest($2::text[], $3::text[], $4::int[], $5::boolean[]) as t(p, v, o, c)
         on conflict (campaign_id, phone) do nothing`,
        [campaignId, phones, variables, ordenes, canarios],
      );
      return rowCount ?? 0;
    },
    async siguientesPendientes(campaignId, limit, soloCanario = false, ahora = new Date()) {
      const { rows } = await pool.query<RecipientRow>(
        `select * from campaign_recipients
          where campaign_id = $1 and estado = 'pendiente' ${soloCanario ? 'and canario' : ''}
            and (posponer_hasta is null or posponer_hasta <= $3)
          order by canario desc, orden, id
          limit $2`,
        [campaignId, limit, ahora],
      );
      return rows.map(toRecipient);
    },
    async posponerDestinatario(id, hasta, detalle) {
      await pool.query(
        `update campaign_recipients
            set posponer_hasta = $2, detalle = $3, intentos = intentos + 1
          where id = $1`,
        [id, hasta, detalle],
      );
    },
    async contarPendientes(campaignId, soloCanario = false) {
      const { rows } = await pool.query<{ total: number }>(
        `select count(*)::int as total from campaign_recipients
          where campaign_id = $1 and estado = 'pendiente' ${soloCanario ? 'and canario' : ''}`,
        [campaignId],
      );
      return rows[0]?.total ?? 0;
    },
    async marcarDestinatario(id, estado, detalle, deliveryId, at) {
      await pool.query(
        `update campaign_recipients
            set estado = $2, detalle = $3, delivery_id = $4,
                enviado_at = case when $2 = 'enviado' then coalesce($5, now()) else enviado_at end
          where id = $1`,
        [id, estado, detalle, deliveryId, at ?? null],
      );
    },
    async cifrasDestinatarios(campaignId) {
      const { rows } = await pool.query<{ estado: string; count: number }>(
        `select estado, count(*)::int as count from campaign_recipients
          where campaign_id = $1 group by estado`,
        [campaignId],
      );
      return Object.fromEntries(rows.map((r) => [r.estado, r.count]));
    },
    async cancelarPendientes(campaignId, motivo) {
      const { rowCount } = await pool.query(
        `update campaign_recipients set estado = 'cancelado', detalle = $2
          where campaign_id = $1 and estado = 'pendiente'`,
        [campaignId, motivo],
      );
      return rowCount ?? 0;
    },
    async listarActivas() {
      const { rows } = await pool.query<CampaignRow>(
        `select * from campaigns where status in ('running','canary','paused') order by created_at`,
      );
      return rows.map(toCampaign);
    },
    async setCanarioEnviado(id, at) {
      await pool.query('update campaigns set canario_enviado_at = $2 where id = $1', [id, at]);
    },
    async resumenCanario(campaignId) {
      const { rows } = await pool.query<ResumenRow>(
        `select ${RESUMEN_SELECT}
           from deliveries d
          where d.campaign_id = $1
            and d.id in (select delivery_id from campaign_recipients
                          where campaign_id = $1 and canario and delivery_id is not null)`,
        [campaignId],
      );
      const codes = await pool.query<{ code: string; count: number }>(
        `select error_code as code, count(*)::int as count
           from deliveries d
          where d.campaign_id = $1 and d.status = 'failed' and d.error_code is not null
            and d.id in (select delivery_id from campaign_recipients
                          where campaign_id = $1 and canario and delivery_id is not null)
          group by error_code`,
        [campaignId],
      );
      return toResumen(rows[0], codes.rows);
    },
  };

  const salud: SaludRepo = {
    async registrar(evento) {
      const { rows } = await pool.query<{ id: number }>(
        `insert into salud_eventos
           (phone_number_id, at, tipo, codigo, detalle, contact_id, campaign_id, payload)
         values ($1, coalesce($2, now()), $3, $4, $5, $6, $7, $8)
         returning id`,
        [
          evento.phoneNumberId ?? '',
          evento.at ?? null,
          evento.tipo,
          evento.codigo ?? null,
          evento.detalle?.slice(0, 500) ?? null,
          evento.contactId ?? null,
          evento.campaignId ?? null,
          evento.payload ? JSON.stringify(evento.payload) : null,
        ],
      );
      return rows[0]!.id;
    },
    async contar(since, tipo, codigo) {
      const params: unknown[] = [since];
      let where = 'at >= $1';
      if (tipo) {
        params.push(tipo);
        where += ` and tipo = $${params.length}`;
      }
      if (codigo) {
        params.push(codigo);
        where += ` and codigo = $${params.length}`;
      }
      const { rows } = await pool.query<{ total: number }>(
        `select count(*)::int as total from salud_eventos where ${where}`,
        params,
      );
      return rows[0]?.total ?? 0;
    },
    async resumen(since) {
      const { rows } = await pool.query<{ clave: string; count: number }>(
        `select tipo || ':' || coalesce(codigo, '') as clave, count(*)::int as count
           from salud_eventos where at >= $1 group by 1`,
        [since],
      );
      return Object.fromEntries(rows.map((r) => [r.clave, r.count]));
    },
    async ultimos(limit) {
      const { rows } = await pool.query<SaludRow>(
        'select * from salud_eventos order by at desc, id desc limit $1',
        [limit],
      );
      return rows.map(toSaludEvento);
    },
    async purgar(before) {
      const { rowCount } = await pool.query('delete from salud_eventos where at < $1', [before]);
      return rowCount ?? 0;
    },
  };

  return {
    contacts,
    locations,
    deliveries,
    templates,
    numberState,
    counters,
    tracking,
    campaigns,
    automation: createAutomationRepo(pool),
    messages: createMessagesRepo(pool),
    leads: createLeadsRepo(pool),
    archives: createArchivesRepo(pool),
    rutas: createRutasRepo(pool),
    salud,
    usuarios: createUsuariosRepo(pool),
    claves: createClavesApiRepo(pool),
    ajustesGenerales: createAjustesGeneralesRepo(pool),
    actividad: createActividadRepo(pool),
    stickers: createStickersRepo(pool),
    webhooks: createWebhooksRepo(pool),
    conectores: createConectoresRepo(pool),
    envioAutomatico: createEnvioAutomaticoRepo(pool),
    pedidos: createPedidosRepo(pool),
    entrenamiento: createEntrenamientoRepo(pool),
    codigosConexion: createCodigosConexionRepo(pool),
    tiendas: createTiendasRepo(pool),
    entregas: createEntregasRepo(pool),
    desarrollador: createDesarrolladorRepo(pool),
    procesos: createProcesosRepo(pool),
  };
}

// ------------------------------------------------------ ajustes editables

/** Repositorio de la tabla `settings` (credenciales editables desde /setup). */
export function createSettingsRepo(pool: Pool) {
  return {
    async getAll() {
      const { rows } = await pool.query<{ key: string; value: string; encrypted: boolean }>(
        'select key, value, encrypted from settings',
      );
      return rows;
    },
    async put(key: string, value: string, encrypted: boolean) {
      await pool.query(
        `insert into settings (key, value, encrypted, updated_at)
         values ($1,$2,$3, now())
         on conflict (key) do update set
           value = excluded.value, encrypted = excluded.encrypted, updated_at = now()`,
        [key, value, encrypted],
      );
    },
    async remove(key: string) {
      await pool.query('delete from settings where key = $1', [key]);
    },
  };
}
