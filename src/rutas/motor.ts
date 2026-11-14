/**
 * El que trabaja el lote: a quien le toca, que se le manda y que pasa despues.
 *
 * Tres reglas gobiernan esto, y las tres estan para lo mismo -que el numero
 * siga vivo manana-:
 *
 *  1. De uno en uno y despacio. Entre mensaje y mensaje pasan entre quince y
 *     treinta segundos, elegidos al azar dentro de ese rango. Doscientos
 *     mensajes identicos en un minuto es el patron exacto que WhatsApp busca
 *     para bloquear una cuenta.
 *  2. En horario. Fuera de la franja del negocio no sale nada: un mensaje
 *     comercial a las tres de la manana se responde con "reportar".
 *  3. Con final. Tres intentos y el caso pasa a una persona. Insistir mas no
 *     consigue ubicaciones, consigue bloqueos.
 *
 * Lo que este fichero NO hace es leer las respuestas: de eso se encarga
 * `inbound.ts`, porque una respuesta llega cuando llega y no cuando al motor
 * le toca mirar.
 */

import type { ServicioStickers } from '../stickers/stickers.js';
import type { Config } from '../config.js';
import type { Repos } from '../db/repos.js';
import type { Solicitud } from '../db/rutas.js';
import type { Sender, SendOutcome } from '../outbound/sender.js';
import type { Monitor } from '../salud/monitor.js';
import type { Politica } from '../salud/politica.js';
import { decidirRitmo } from '../salud/ritmo.js';
import { esNumeroDePrueba } from '../desarrollador/numeros.js';
import { anotarEsperaEnvio, anotarEsperaGlobal, limpiarEsperasEnvio } from './espera-envio.js';
import { RETENCION_CHAT_MS } from '../whatsapp/retencion-chat.js';
import { alDespertarMotorRutas } from './despertador.js';
import { esLoteDePrueba } from './alertas.js';
import { elegirPlantilla, elegirVariante } from '../salud/variantes.js';
import type { WhatsAppClient } from '../whatsapp/client.js';
import { ajustesPorDefecto, aplicarAjustes, conFranjaDeLaPolitica, rellenarTexto, type AjustesRutas } from './ajustes.js';
import { INCIDENCIAS, incidenciaDeErrorDeEnvio, type CodigoIncidencia } from './incidencias.js';
import { despacharReportes, encolarProblemaGsg, payloadIncidencia, payloadResumen, payloadUbicacionDelPedido, type PuertoGsg } from './gsg.js';
import { diaEnZona, resolverPorUbicacion, ubicacionYaRegistrada } from '../entregas/ubicacion-unica.js';
import { horaEnPalabras, horarioEnPalabras } from '../entregas/textos.js';
import {
  DESCRIPCION_PASO,
  PLANTILLAS,
  textoDerivacion,
  textoLibre,
  type ContextoMensaje,
  type PasoUbicacion,
} from './mensajes.js';

/** Las plantillas de recordatorio de GSG, en orden: recordatorio 1 y recordatorio 2. */
// Las dos plantillas del dueño (11/11): «solicitud_inicial» para el primer mensaje
// (entregas/textos.ts) y «recordatorio_inicial» para el recordatorio (si hay mas, se repite). Las de
// antes eran de categoría Marketing y Meta las frenaba (131049).
export const SEGUIMIENTOS_POR_DEFECTO = ['recordatorio_inicial'] as const;
/** Qué dato va en cada {{n}} (1 nombre, 2 producto, 3 empresa...): «seguimiento» lleva nombre y empresa. */
/** Que datos del pedido van en cada variable: recordatorio_inicial = {{1}} nombre, {{2}} producto, {{3}} tienda. */
export const DATOS_POR_DEFECTO: Record<string, number[]> = { seguimiento: [1, 3], recordatorio_inicial: [1, 2, 3] };

export interface OpcionesMotor {
  /** Pausa entre envios, en segundos: se sortea entre los dos. */
  pausaMinSegundos: number;
  pausaMaxSegundos: number;
  /** Cuanto se espera una respuesta antes de volver a escribir. */
  esperaRespuestaMinutos: number;
  /** Minutos que espera el primer mensaje desde que llega el pedido (0 o sin dar = de inmediato). */
  esperaPrimerMensajeMinutos?: number;
  esperaPrimerMensajeSegundos?: number;
  /** Espera específica después de cada mensaje enviado, del 1 al 2 en índice 0. */
  esperasMensajesMinutos?: number[];
  esperasMensajesSegundos?: number[];
  /** Mensajes por cliente antes de pasarlo a una persona. */
  maxIntentos: number;
  /** Minutos tras el último mensaje antes de darlo por «sin respuesta» (0 o sin dar = en el momento). */
  esperaFinalMinutos?: number;
  esperaFinalSegundos?: number;
  /** Campo antiguo conservado por compatibilidad; no activa otro modo de envío. */
  pedirUbicacionCadaMinutos: number;
  /** Franja horaria en la que se puede escribir, hora del negocio. */
  horaInicio: number;
  horaFin: number;
  timezone: string;
  /** Como se presenta el negocio al cliente. */
  negocio: string;
}

export const OPCIONES_POR_DEFECTO: OpcionesMotor = {
  pausaMinSegundos: 15,
  pausaMaxSegundos: 30,
  esperaRespuestaMinutos: 30,
  // Solo 2 mensajes por pedido (pedido del dueño, 11/11): «solicitud_inicial» y un «recordatorio_inicial».
  maxIntentos: 2,
  pedirUbicacionCadaMinutos: 0,
  horaInicio: 9,
  horaFin: 19,
  timezone: 'America/Lima',
  negocio: 'nuestra tienda',
};

/** Las opciones del motor, sacadas de la configuracion del proceso. */
export function opcionesDesdeConfig(config: Config): OpcionesMotor {
  return {
    pausaMinSegundos: config.RUTAS_PAUSA_MIN_SEG,
    // Si alguien pone el maximo por debajo del minimo, el minimo manda: es
    // mejor ir lento de mas que sortear una pausa negativa.
    pausaMaxSegundos: Math.max(config.RUTAS_PAUSA_MIN_SEG, config.RUTAS_PAUSA_MAX_SEG),
    esperaRespuestaMinutos: config.RUTAS_ESPERA_MIN,
    maxIntentos: config.RUTAS_MAX_INTENTOS,
    pedirUbicacionCadaMinutos: 0,
    horaInicio: config.RUTAS_HORA_INICIO,
    horaFin: config.RUTAS_HORA_FIN,
    timezone: config.timezone,
    negocio: config.businessName,
  };
}

export interface MotorDeps {
  esperaCambiada?: (solicitud: Solicitud) => void;
  repos: Repos;
  sender: Sender;
  wa?: WhatsAppClient;
  /**
   * Con varias lineas de WhatsApp: si queda alguna conectada. El motor solo se
   * para cuando no queda ninguna; una linea caida frena a sus clientes, no al resto.
   */
  hayLineaConectada?: () => boolean;
  gsg: PuertoGsg;
  opciones: OpcionesMotor;
  /** Como se llama el negocio ahora (se cambia desde la pantalla). */
  nombreNegocio?: () => string;
  /**
   * El horario de entregas (Hoy → Ajustes), "HH:MM": AMPLIA el horario del
   * reparto, nunca lo recorta. Sin el, a las 20:00 el reparto dejaba de pedir
   * pines aunque GSG entregue hasta las 22:00.
   */
  horarioExtra?: () => { desde: string; hasta: string } | null;
  /** Franja de Pedidos GSG para redactar las solicitudes y recordatorios. */
  horarioMensaje?: (pedido: Pick<Solicitud, 'distrito' | 'direccion'>) => { desde: string; hasta: string; extendidoHasta?: string } | null;
  /** Los stickers automaticos (tras el primer mensaje, tras la despedida). Ver src/stickers. */
  stickers?: ServicioStickers;
  /**
   * Si hay que mandar plantilla en vez de texto libre.
   *
   * Con la Cloud API fuera de la ventana de 24 h no hay alternativa. Con un
   * cliente no oficial no existe tal regla y se manda el texto con boton, que
   * al cliente le resulta mucho mas facil.
   *
   * Dentro de la ventana (el cliente escribio hace menos de 24 h) tampoco se
   * usa plantilla aunque el proveedor sea Meta: desde el 1/10/2026 una
   * plantilla de utilidad dentro de la ventana se cobra sin franquicia, y el
   * texto libre con boton (mensaje de servicio) entra en los 1 000 gratis del
   * mes y ademas le da al cliente el boton de un toque.
   */
  usarPlantilla: () => boolean;
  ahora?: () => Date;
  /** Inyectable para que las pruebas no dependan del azar. */
  azar?: () => number;
  log?: (mensaje: string, detalle?: Record<string, unknown>) => void;
  /**
   * El monitor de salud y la politica de ritmo. Con ellos el motor:
   *  - pregunta al marcapasos antes de intentar nada (cupos, horario, tier,
   *    factor de riesgo), en vez de descubrirlo en el rechazo del sender;
   *  - alterna entre las plantillas aprobadas de cada paso y deja fuera las
   *    que Meta tenga pausadas;
   *  - usa la pausa global, sin sortear una segunda pausa independiente.
   * Opcionales para que las pruebas del motor sigan siendo pequenas.
   */
  salud?: Monitor;
  politica?: () => Politica;
  /**
   * Si el texto libre va a llevar un boton nativo de ubicacion. Con la Cloud
   * API si; con el cliente no oficial solo si WHATSAPP_NATIVE_BUTTONS esta
   * encendido (y viene apagado porque llegan rotos a una cuenta personal).
   * Sin boton, el mensaje explica el camino del clip.
   */
  conBoton?: () => boolean;
  /**
   * El primer mensaje de una solicitud que es de una entrega de GSG (ver
   * entregas → textoSolicitudUbicacion): la plantilla con producto, empresa,
   * codigo, monto... null = no es de una entrega, va la redaccion de siempre.
   * Los recordatorios siguen con sus textos cortos de siempre.
   */
  textoSolicitud?: (solicitud: Solicitud) => Promise<string | null>;
  plantillaSolicitud?: (solicitud: Solicitud) => Promise<{ name: string; language?: string; variables: string[] } | null>;
  /** Los 8 datos del pedido de esa solicitud, en el orden de la plantilla de Pedidos GSG; null si no es de un pedido. */
  datosPedido?: (solicitud: Solicitud) => Promise<string[] | null>;
  /**
   * Con la conexión principal de QR y una línea de WhatsApp API en uso: si
   * hay plantilla aprobada por Meta en los ajustes (Pedidos GSG → Ajustes de
   * chat). Entonces, fuera de la ventana de 24 h, se manda plantilla aunque
   * `usarPlantilla` diga que no (si no, Meta rechazaría el texto libre).
   */
  plantillaMeta?: () => Promise<boolean>;
  /**
   * El seguimiento del primer mensaje de los pedidos (src/entregas/primer-mensaje.ts):
   * el reparto avisa antes y despues de mandar el primer mensaje de una
   * solicitud, y obedece cuando reintentar o que se pare.
   */
  primerMensaje?: PrimerMensajeReparto;
  /**
   * Justo antes de escribirle (primer mensaje o recordatorio): GSG dice si a
   * esos envios se les sigue escribiendo. false = no se manda nada (los envios
   * parados ya quedaron con su motivo). Un fallo de la consulta no para nada.
   */
  antesDeEscribir?: (solicitud: Solicitud) => Promise<boolean>;
}

/**
 * Segundo numero (pedido del dueño, 12/11): si el numero del cliente no es
 * accesible, el pedido pasa a su telefono2 (`segundoNumero`: no se marca
 * incidencia ni se reporta el numero viejo; el pedido sigue con el nuevo).
 * Si tampoco lo es (`inaccesible`), la incidencia es `numero_inaccesible`.
 */
export interface SegundoNumeroDecision {
  segundoNumero?: boolean;
  inaccesible?: boolean;
}

/** Ver MotorDeps.primerMensaje. */
export interface PrimerMensajeReparto {
  /** Justo antes del primer mensaje. false = no se manda ahora (otro intento en curso o espera a una persona). */
  antes(solicitud: Solicitud): Promise<boolean>;
  /** Lo que paso. `esperaMs`: cuando reintentar un fallo pasajero; `detener`: no insistir solo (incierto, permanente o tope de reintentos). */
  despues(solicitud: Solicitud, salida: SendOutcome): Promise<SegundoNumeroDecision & { esperaMs?: number; detener?: string } | void>;
  /** Antes de enviar ya se supo que el numero no tiene WhatsApp. */
  sinWhatsApp(solicitud: Solicitud, detalle: string): Promise<SegundoNumeroDecision | void>;
}

export interface ResultadoTick {
  /** Que se hizo: nada, un envio, una derivacion. */
  accion: 'nada' | 'envio' | 'derivacion' | 'incidencia';
  solicitudId?: number;
  paso?: PasoUbicacion;
  /** Por que no se hizo nada. */
  motivo?: string;
  /** Lotes que se dieron por terminados en esta pasada. */
  lotesCerrados?: string[];
  /**
   * Era un numero del Modulo desarrollador: no marco el ritmo del numero real,
   * asi que el ticker puede seguir con el siguiente en la misma pasada.
   */
  dePrueba?: boolean;
}

/** La hora del negocio, no la del servidor. */
export function horaLocal(fecha: Date, timezone: string): number {
  try {
    const formato = new Intl.DateTimeFormat('es-PE', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    return Number(formato.format(fecha)) % 24;
  } catch {
    // Zona horaria mal escrita: mejor la del servidor que reventar el motor.
    return fecha.getHours();
  }
}

export function enHorario(fecha: Date, opciones: OpcionesMotor): boolean {
  const hora = horaLocal(fecha, opciones.timezone);
  return hora >= opciones.horaInicio && hora < opciones.horaFin;
}

export interface ContextoIncidencia {
  repos: Repos;
  ahora: () => Date;
  log?: (mensaje: string, detalle?: Record<string, unknown>) => void;
}

/** Marca la incidencia, la apunta en la bitacora y la encola para GSG. */
export async function anotarIncidenciaDeSolicitud(
  ctx: ContextoIncidencia,
  solicitud: Solicitud,
  codigo: CodigoIncidencia,
  detalle: string,
  estado: 'incidencia' | 'supervision' | 'derivado' = 'incidencia',
): Promise<void> {
  const { repos } = ctx;
  const ficha = INCIDENCIAS[codigo];
  const actualizada = await repos.rutas.actualizarSolicitud(solicitud.id, {
    estado,
    incidencia: codigo,
    incidenciaDetalle: detalle,
    requiereHumano: ficha.requiereHumano,
    proximoIntentoAt: null,
  });

  await repos.rutas.registrarEvento(solicitud.id, 'incidencia', `${ficha.titulo}: ${detalle}`, {
    codigo,
    estado,
  });

  if (ficha.reportable) {
    const lote = await repos.rutas.lote(solicitud.loteId);
    if (lote) {
      // Un reporte por tracking: un mismo numero puede tener varios envios de GSG en ese lote.
      const ligadas = solicitud.phone && typeof repos.entregas?.vivasDeLoteYTelefono === 'function'
        ? await repos.entregas.vivasDeLoteYTelefono(solicitud.loteId, solicitud.phone).catch(() => [])
        : [];
      const trackings = [...new Set(ligadas.map((e) => e.datosEnvio?.tracking ?? e.referencia).filter(Boolean))];
      if (!trackings.length && solicitud.referencia) trackings.push(solicitud.referencia);
      for (const tracking of trackings) {
        await encolarProblemaGsg(repos.rutas, { ...payloadIncidencia(actualizada, lote), tracking, codigo }, { solicitudId: solicitud.id, loteId: lote.id, en: ctx.ahora() });
      }
    }
  }

  ctx.log?.('incidencia en una solicitud de ubicacion', {
    solicitud: solicitud.id,
    telefono: solicitud.phone,
    codigo,
    detalle,
  });
}

/** Pasa el caso a una persona: se acabaron los intentos del bot y su espera final. */
export async function derivarSolicitud(ctx: ContextoIncidencia, solicitud: Solicitud): Promise<void> {
  const respondio = Boolean(solicitud.primeraRespuestaAt);
  // «No contestó» solo si de verdad le llegó algo: si ninguno de los mensajes
  // contados está en su chat (o WhatsApp los rechazó), se dice eso, con el porqué.
  if (!respondio) {
    const revision = await revisarEnviosContados(ctx.repos, solicitud, ctx.ahora()).catch((error: unknown) => {
      ctx.log?.('no se pudo revisar los mensajes contados antes de «no contestó»', { solicitud: solicitud.id, detalle: String(error) });
      return null;
    });
    // Solo con pruebas: si de algún mensaje ya no queda registro, no se afirma nada.
    if (revision && revision.visibles === 0 && revision.sinComprobar === 0 && revision.problemas.length > 0) {
      const detalle = `se contaron ${solicitud.intentos} mensaje${solicitud.intentos === 1 ? '' : 's'}, pero no le llegó ninguno: ${revision.problemas.join('; ')}`.slice(0, 500);
      await anotarIncidenciaDeSolicitud(ctx, solicitud, 'no_se_le_escribio', detalle, 'derivado');
      await ctx.repos.rutas.registrarEvento(solicitud.id, 'derivacion', `Pendiente de atención: no se le llegó a escribir (${revision.problemas.length} problema${revision.problemas.length === 1 ? '' : 's'})`, { problemas: revision.problemas });
      return;
    }
  }
  const codigo: CodigoIncidencia = respondio ? 'respondio_sin_ubicacion' : 'sin_respuesta';
  const detalle = respondio
    ? `contestó pero no envió ubicación después de ${solicitud.intentos} mensajes`
    : `no contestó a ${solicitud.intentos} mensajes`;

  await anotarIncidenciaDeSolicitud(ctx, solicitud, codigo, detalle, 'derivado');
  await ctx.repos.rutas.registrarEvento(
    solicitud.id,
    'derivacion',
    `Pendiente de atención: ${solicitud.intentos} mensajes sin ubicación`,
  );
}

/**
 * Lo que pasó de verdad con los mensajes que el reparto contó como intentos.
 *
 * Un intento se cuenta cuando el proveedor acepta el envío, pero eso no
 * asegura que el cliente lo tenga: el mensaje puede no haberse guardado,
 * haber quedado en el chat de otro número o haberlo rechazado WhatsApp
 * después. `visibles` son los que le llegaron o pudieron llegarle (en su
 * chat sin fallar, o con WhatsApp confirmando el envío); `problemas`, qué pasó
 * con cada uno de los demás, en palabras.
 *
 * Pedidos viejos: el chat se borra a las 72 h (RETENCION_CHAT_MS), pero los
 * intentos de envío (`deliveries`) se guardan siempre, y se miran primero.
 * Si de un mensaje ya no queda nada en ninguno de los dos, es `sinComprobar`:
 * no se afirma que no se le escribió.
 */
export async function revisarEnviosContados(
  repos: Repos,
  solicitud: Solicitud,
  ahora: Date = new Date(),
): Promise<{ visibles: number; problemas: string[]; sinComprobar: number }> {
  const eventos = await repos.rutas.eventos(solicitud.id, 500);
  const envios = eventos.filter((e) => e.tipo === 'envio');
  const problemas: string[] = [];
  let visibles = 0;
  let sinComprobar = 0;
  // Lo que dice WhatsApp de cada envío a este teléfono (no se borra con el chat).
  const porWamid = new Map<string, { status: string; errorCode: string | null; errorTitle: string | null }>();
  if (solicitud.phone) {
    const lista = await repos.deliveries.listRecent({ phone: solicitud.phone, limit: 500, offset: 0 }).catch(() => []);
    for (const d of lista) if (d.wamid) porWamid.set(d.wamid, d);
  }
  for (const envio of envios) {
    const wamid = typeof envio.payload?.wamid === 'string' && envio.payload.wamid.trim() ? envio.payload.wamid.trim() : null;
    const cuando = horaDelNegocio(envio.createdAt);
    if (!wamid) {
      problemas.push(`el envío de las ${cuando} no trae identificador de WhatsApp`);
      continue;
    }
    const envioRegistrado = porWamid.get(wamid);
    if (envioRegistrado?.status === 'failed' || envioRegistrado?.status === 'blocked_by_gate') {
      const motivo = envioRegistrado.errorTitle || envioRegistrado.errorCode;
      problemas.push(`WhatsApp no entregó el mensaje de las ${cuando}${motivo ? ` (${String(motivo).slice(0, 120)})` : ''}`);
      continue;
    }
    const ref = await repos.messages.referenciaVisiblePorWamid(wamid, new Date(0));
    if (!ref) {
      if (envioRegistrado) {
        // Sin la fila del chat (borrada por antigüedad), pero WhatsApp lo aceptó.
        visibles++;
        continue;
      }
      if (ahora.getTime() - envio.createdAt.getTime() > RETENCION_CHAT_MS) {
        sinComprobar++;
        problemas.push(`del mensaje de las ${cuando} ya no queda registro para comprobarlo (el chat se borra a las 72 h)`);
        continue;
      }
      problemas.push(`el mensaje de las ${cuando} no quedó guardado en ningún chat (${wamid})`);
      continue;
    }
    if (solicitud.contactId && ref.contactId !== solicitud.contactId) {
      const otro = await repos.contacts.getById(ref.contactId).catch(() => null);
      problemas.push(`el mensaje de las ${cuando} quedó en el chat de otro número (${otro?.phone ?? ref.contactId})`);
      continue;
    }
    const mensaje = await repos.messages.porId(ref.contactId, Number(ref.id));
    if (mensaje?.status === 'failed') {
      problemas.push(`WhatsApp no entregó el mensaje de las ${cuando}`);
      continue;
    }
    visibles++;
  }
  function horaDelNegocio(d: Date): string {
    try {
      return new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
    } catch {
      return d.toISOString().slice(11, 16) + ' UTC';
    }
  }
  if (!envios.length && solicitud.intentos > 0) problemas.push(`hay ${solicitud.intentos} intento${solicitud.intentos === 1 ? '' : 's'} contado${solicitud.intentos === 1 ? '' : 's'} sin ningún envío anotado en la bitácora`);
  return { visibles, problemas, sinComprobar };
}

/**
 * Si ya agoto sus mensajes y vencio la espera final: le toca la incidencia.
 * Sin hora (`proximoIntentoAt` nulo) cuenta como vencida, igual que en la
 * cola del motor (`tocaIntentar`): «sale en cuanto le toque».
 */
export function plazoVencido(solicitud: Solicitud, maxIntentos: number, momento: Date): boolean {
  return (
    ['pendiente', 'enviado', 'respondio'].includes(solicitud.estado) &&
    solicitud.intentos >= maxIntentos &&
    (solicitud.proximoIntentoAt === null || solicitud.proximoIntentoAt.getTime() <= momento.getTime())
  );
}

/** El paso que le toca a una solicitud, o null si ya no le toca ninguno. */
export function pasoDe(solicitud: Solicitud, opciones: OpcionesMotor): PasoUbicacion | 'derivar' | null {
  if (solicitud.intentos >= opciones.maxIntentos) return 'derivar';
  if (solicitud.estado === 'pendiente') return 'solicitud';
  if (solicitud.estado === 'respondio') return 'insistencia';
  if (solicitud.estado === 'enviado') return 'recordatorio';
  return null;
}

export interface Motor {
  tick(): Promise<ResultadoTick>;
  /** Cuando podra salir el proximo mensaje, para ensenarlo en pantalla. */
  proximoEnvioEn(): number;
  /** Milisegundos hasta la próxima tarea; null significa esperar una señal nueva. */
  proximoDespertarEn(): Promise<number | null>;
}

/**
 * Sin socket de WhatsApp el motor no escribe. Excepcion: en una simulacion
 * (NODE_ENV=test) lo siguiente es un cliente de prueba (51 000 0…), que nunca
 * sale a WhatsApp (el sender lo guarda en el hilo): asi la demo enseña el
 * primer mensaje aunque la tienda no tenga el numero vinculado.
 */
const sinSocket = (deps: Pick<MotorDeps, 'wa' | 'hayLineaConectada'>): boolean =>
  deps.hayLineaConectada ? !deps.hayLineaConectada() : deps.wa?.conectado?.() === false;

async function sigueSinSocketPorPrueba(repos: Repos, momento: Date): Promise<boolean> {
  if (process.env.NODE_ENV !== 'test') return false;
  const [siguiente] = await repos.rutas.tocaIntentar(momento, 1);
  return Boolean(siguiente && esNumeroDePrueba(siguiente.phone));
}

export function crearMotor(deps: MotorDeps): Motor {
  const ahora = deps.ahora ?? (() => new Date());
  const azar = deps.azar ?? Math.random;
  const { repos, sender, gsg } = deps;
  function esperar(s: Solicitud, codigo: string, motivo: string, ms?: number): void {
    const en = ahora().getTime();
    if (anotarEsperaEnvio(repos.rutas, s, { codigo, motivo, hasta: ms == null ? null : new Date(en + ms) }, en)) deps.esperaCambiada?.(s);
  }

  /**
   * Las opciones vigentes: las de la configuracion con los ajustes que se
   * guardaron desde la pantalla por encima. Se refrescan en cada tick, asi
   * que cambiar la espera o el horario no obliga a reiniciar.
   */
  let ajustes: AjustesRutas = ajustesPorDefecto(deps.opciones);
  let opciones: OpcionesMotor = deps.opciones;

  async function refrescarAjustes(): Promise<void> {
    try {
      ajustes = await repos.rutas.ajustes.get(ajustesPorDefecto(deps.opciones));
      opciones = aplicarAjustes(deps.opciones, ajustes);
      // La franja de envio sale de los ajustes generales (una sola para todo
      // el sistema), no de los del reparto. Ver src/rutas/ajustes.ts.
      opciones = conFranjaDeLaPolitica(opciones, deps.politica?.());
      if (deps.nombreNegocio) opciones = { ...opciones, negocio: deps.nombreNegocio() };
      const extra = deps.horarioExtra?.();
      if (extra) {
        const desde = Number(extra.desde.slice(0, 2));
        const hasta = Number(extra.hasta.slice(0, 2)) + (Number(extra.hasta.slice(3, 5)) > 0 ? 1 : 0);
        if (Number.isFinite(desde) && Number.isFinite(hasta)) {
          opciones = { ...opciones, horaInicio: Math.min(opciones.horaInicio, Math.max(0, desde)), horaFin: Math.max(opciones.horaFin, Math.min(24, hasta)) };
        }
      }
    } catch (error) {
      // Sin ajustes legibles se sigue con los de la configuracion: el
      // reparto no se para por una fila corrupta en settings.
      deps.log?.('no se pudieron leer los ajustes de rutas', { detalle: String(error) });
    }
  }

  /** El primer intervalo es después del mensaje 1; si no hay secuencia, usar el valor antiguo. */
  const esperaHastaElSiguiente = (intentosPrevios: number): number =>
    intentosPrevios + 1 >= opciones.maxIntentos
      ? Math.max(0, opciones.esperaFinalSegundos ?? (opciones.esperaFinalMinutos ?? 0) * 60)
      : opciones.esperasMensajesSegundos?.[intentosPrevios] ?? (opciones.esperasMensajesMinutos?.[intentosPrevios] ?? opciones.esperaRespuestaMinutos) * 60;

  /** Cuando se mando el ultimo mensaje, para respetar la pausa. */
  let ultimoEnvio = 0;
  /** La pausa sorteada para el siguiente: cambia en cada envio. */
  let pausaActual = opciones.pausaMinSegundos * 1000;

  function sortearPausa(): number {
    const min = Math.max(1, opciones.pausaMinSegundos);
    const max = Math.max(min, opciones.pausaMaxSegundos);
    return Math.round((min + azar() * (max - min)) * 1000);
  }

  /**
   * El texto de un paso cuando se escribe libre: las redacciones guardadas
   * desde la pantalla si las hay, o las de siempre.
   */
  function textoDelPaso(paso: PasoUbicacion, ctx: ContextoMensaje, clave: string, intentosPrevios: number): string {
    const seguimiento = intentosPrevios > 0 && paso !== 'solicitud' ? ajustes.textosSeguimientos?.[intentosPrevios - 1] : undefined;
    if (seguimiento && paso !== 'solicitud') {
      const lineas = seguimiento[paso];
      if (lineas.length) return rellenarTexto(elegirVariante(lineas, clave), ctx);
      return textoLibre(paso, ctx, clave);
    }
    const adicional = intentosPrevios >= 3 ? ajustes.textosAdicionales[intentosPrevios - 3] : undefined;
    if (adicional?.length) return rellenarTexto(elegirVariante(adicional, clave), ctx);
    const propias = ajustes.textos[paso];
    if (propias.length) return rellenarTexto(elegirVariante(propias, clave), ctx);
    return textoLibre(paso, ctx, clave);
  }

  /**
   * Las variables de una plantilla, en su orden.
   *
   * Las del catalogo tienen su orden propio. Para una plantilla propia el
   * orden es fijo y esta escrito en la pantalla: {{1}} nombre, {{2}} pedido,
   * {{3}} negocio; se pasan tantas como la plantilla tenga.
   */
  function variablesPara(nombre: string, paso: PasoUbicacion, ctx: ContextoMensaje, cuantas: number): string[] {
    if (PLANTILLAS[paso].variantes.includes(nombre)) return PLANTILLAS[paso].variables(ctx);
    const nombreCliente = (ctx.nombre ?? '').trim().split(/\s+/)[0] || 'buenas tardes';
    const pedido = (ctx.referencia ?? '').trim() || 'su pedido';
    return [nombreCliente, pedido, ctx.negocio].slice(0, Math.max(0, cuantas));
  }

  /** Solo los arranques sin monitor necesitan un reloj de pausa local. */
  function pausaEfectiva(): number {
    return deps.salud && deps.politica ? 0 : pausaActual;
  }

  /**
   * La plantilla que toca para este paso: entre las variantes aprobadas y
   * no pausadas, la de mejor calidad y menos usada en 24 h. Si no hay
   * ninguna valida, la principal, para que el rechazo del sender diga por que.
   */
  async function plantillaPara(paso: PasoUbicacion, momento: Date): Promise<{ name: string; language: string; variables: number }> {
    const def = PLANTILLAS[paso];
    // Las que se eligieron desde la pantalla mandan sobre las del catalogo.
    const nombres = ajustes.plantillas[paso].length ? ajustes.plantillas[paso] : def.variantes;
    const todas = await repos.templates.list();
    const candidatas = todas.filter((t) => nombres.includes(t.name));
    if (!candidatas.length) return { name: nombres[0] ?? def.name, language: def.language, variables: def.variables({ negocio: '' }).length };

    const desde = new Date(momento.getTime() - 24 * 60 * 60 * 1000);
    const uso24h: Record<string, number> = {};
    for (const t of candidatas) uso24h[t.name] = await repos.deliveries.contarPlantillaDesde(t.name, desde);

    const politica = deps.politica?.();
    const eleccion = elegirPlantilla(candidatas, {
      ahora: momento,
      uso24h,
      plantillaNuevaDias: politica?.plantillaNuevaDias ?? 0,
      plantillaNuevaPorDia: politica?.plantillaNuevaPorDia ?? 0,
    });
    if (eleccion.plantilla) {
      return { name: eleccion.plantilla.name, language: eleccion.plantilla.language, variables: eleccion.plantilla.variables };
    }
    const primera = candidatas[0]!;
    return { name: primera.name, language: primera.language, variables: primera.variables };
  }

  /** Una plantilla con menos datos que los 8 del pedido recibe solo los primeros (Meta rechaza parámetros de más: #132000). */
  async function ajustarAlNumeroDeDatos(p: { name: string; language?: string; variables: string[] }): Promise<string[]> {
    const t = await repos.templates.get(p.name, p.language ?? 'es').catch(() => null);
    return t && t.variables > 0 && t.variables < p.variables.length ? p.variables.slice(0, t.variables) : p.variables;
  }

  /** Si el paso tiene alguna plantilla propia (elegida o del catálogo) ya aprobada por Meta. */
  async function hayAprobadaDelPaso(paso: PasoUbicacion): Promise<boolean> {
    const nombres = ajustes.plantillas[paso].length ? ajustes.plantillas[paso] : PLANTILLAS[paso].variantes;
    return (await repos.templates.list().catch(() => [])).some((t) => nombres.includes(t.name) && t.status === 'APPROVED');
  }

  /** La tienda y el producto del pedido de GSG de esa solicitud ({tienda}, {producto}); sin pedido, null. */
  async function datosDelPedido(solicitud: Solicitud): Promise<{ tienda: string | null; producto: string | null }> {
    if (!solicitud.phone || !repos.entregas) return { tienda: null, producto: null };
    const vinculadas = await repos.entregas.vivasDeLoteYTelefono(solicitud.loteId, solicitud.phone).catch(() => []);
    const pedido = vinculadas.find((e) => e.referencia === solicitud.referencia) ?? vinculadas[0];
    return { tienda: pedido?.datosEnvio?.empresaNombre?.trim() || null, producto: pedido?.datosEnvio?.producto?.trim() || null };
  }

  const contexto = (solicitud: Solicitud): ContextoMensaje => {
    const horario = deps.horarioMensaje?.(solicitud);
    return {
      nombre: solicitud.nombre,
      negocio: opciones.negocio,
      referencia: solicitud.referencia,
      direccion: solicitud.direccion,
      distrito: solicitud.distrito,
      ...(horario ? {
        desde: horaEnPalabras(horario.desde),
        hasta: horaEnPalabras(horario.hasta),
        hastaExtendido: horario.extendidoHasta ? horaEnPalabras(horario.extendidoHasta) : undefined,
        horario: horarioEnPalabras(horario.desde, horario.hasta),
      } : {}),
      // Sin boton nativo, el texto explica el clip en vez de un boton que no existe.
      conBoton: deps.conBoton?.() ?? false,
    };
  };

  const contextoIncidencia: ContextoIncidencia = { repos, ahora, log: deps.log };
  const anotarIncidencia = (
    solicitud: Solicitud,
    codigo: CodigoIncidencia,
    detalle: string,
    estado: 'incidencia' | 'supervision' | 'derivado' = 'incidencia',
  ): Promise<void> => anotarIncidenciaDeSolicitud(contextoIncidencia, solicitud, codigo, detalle, estado);

  /** Pasa el caso a una persona: se acabaron los intentos del bot. */
  async function derivar(solicitud: Solicitud): Promise<ResultadoTick> {
    await derivarSolicitud(contextoIncidencia, solicitud);
    return { accion: 'derivacion', solicitudId: solicitud.id };
  }

  // Numeros del dia: una persona detuvo los mensajes automaticos a ese
  // numero. No se le escribe; se aparta unos minutos para que no tape la
  // cola y se vuelve a mirar (al reanudarlo sale en cuanto le toque).
  const pausado = async (phone: string | null): Promise<boolean> =>
    Boolean(phone) && typeof repos.entregas?.pausadoPorTelefono === 'function' && (await repos.entregas.pausadoPorTelefono(phone!).catch(() => false));
  // La red de seguridad de la «única verdad» de la ubicacion: si ese
  // telefono ya tiene hoy su ubicacion registrada en las entregas (venga
  // por donde venga), NO se le pide otra vez: la solicitud (y cualquier
  // otra abierta de ese telefono) pasa a resuelta con ese punto y el motor
  // sigue con el siguiente. Asi un recordatorio nunca le llega a quien ya
  // mando su pin, aunque algun camino se haya olvidado de cerrarla.
  const yaTieneUbicacion = async (s: Solicitud, momento: Date): Promise<boolean> => {
    const registrada = await ubicacionYaRegistrada(repos, s.phone, diaEnZona(momento, opciones.timezone), s.referencia);
    if (!registrada || registrada.lat == null || registrada.lng == null) return false;
    const cerradas = await resolverPorUbicacion(repos, s.phone!, { lat: registrada.lat, lng: registrada.lng, mapsUrl: registrada.mapsUrl, fuente: registrada.ubicacionFuente }, { ahora: momento, motivo: `ya la había mandado (pedido ${registrada.referencia})`, referencias: [registrada.referencia] });
    // Si era de OTRO pedido del mismo cliente (que aun no la tenia), GSG se
    // entera por aqui, como cuando el reparto la resuelve.
    for (const c of cerradas) {
      if (!c.referencia || c.referencia === registrada.referencia) continue;
      const lote = await repos.rutas.lote(c.loteId).catch(() => null);
      if (lote) await repos.rutas.encolarReporte({ solicitudId: c.id, loteId: lote.id, tipo: 'ubicacion', payload: await payloadUbicacionDelPedido(repos, c, lote) }).catch(() => undefined);
    }
    // La ubicacion sale YA hacia GSG, sin esperar a la pasada de cada minuto.
    if (cerradas.length) void despacharReportes({ rutas: repos.rutas }, gsg, 25, ['ubicacion'], { alMomento: true }).catch(() => undefined);
    deps.log?.('el cliente ya tenía su ubicación registrada: no se le vuelve a pedir', { telefono: s.phone, solicitud: s.id });
    return true;
  };

  /**
   * Regla del dueño (20/10): la incidencia sale a la hora del plazo, no
   * cuando al motor le toca mirar. Va antes del horario, de la pausa entre
   * envios y del monitor de salud, porque marcarla no le escribe a nadie:
   * antes, un plazo que vencia de noche se marcaba a la apertura del dia
   * siguiente y mientras tanto el pin se seguia aceptando.
   */
  async function derivarVencidas(momento: Date): Promise<Solicitud[]> {
    if (typeof repos.rutas.plazosVencidos !== 'function') return [];
    const derivadas: Solicitud[] = [];
    for (const s of await repos.rutas.plazosVencidos(momento, opciones.maxIntentos, 50)) {
      // Lo mismo que antes de escribirle: quien ya tiene su ubicacion de hoy
      // queda resuelto, no en incidencia. Solo si de verdad quedo cerrada: si
      // no, se volveria a ver vencida en cada pasada.
      if ((await yaTieneUbicacion(s, momento)) && (await repos.rutas.solicitud(s.id))?.estado === 'resuelto') continue;
      // Un pin que espera su «¿es ahí?» o un numero que lleva una persona: la
      // incidencia no sale sola mientras tanto. Se vuelve a mirar en minutos.
      if (await pausado(s.phone)) {
        esperar(s, 'pausado', 'Mensajes detenidos o pin recibido pendiente de confirmación.', 5 * 60_000);
        await repos.rutas.actualizarSolicitud(s.id, { proximoIntentoAt: new Date(momento.getTime() + 5 * 60_000) });
        continue;
      }
      await derivar(s);
      derivadas.push(s);
    }
    return derivadas;
  }

  /** Manda el mensaje del paso y deja la solicitud como corresponda. */
  async function enviarPaso(solicitud: Solicitud, paso: PasoUbicacion): Promise<ResultadoTick> {
    const phone = solicitud.phone!;
    const ctx = { ...contexto(solicitud), ...(await datosDelPedido(solicitud)) };

    // GSG puede haber cancelado el envio (o marcado el numero como malo) despues de encolarlo.
    if (deps.antesDeEscribir && !(await deps.antesDeEscribir(solicitud).catch(() => true))) {
      return { accion: 'nada', solicitudId: solicitud.id, motivo: 'GSG indicó que no se le escriba por estos trackings' };
    }

    // Antes del primer mensaje, preguntar si ese numero tiene WhatsApp. Solo
    // lo saben los clientes no oficiales; con Meta devuelve null y se sigue.
    // Un numero de prueba no existe en WhatsApp y no sale nunca: ni se pregunta.
    if (solicitud.intentos === 0 && deps.wa?.tieneWhatsApp && !esNumeroDePrueba(phone)) {
      const tiene = await deps.wa.tieneWhatsApp(phone).catch(() => null);
      if (tiene === false) {
        // Primero el pedido: si tiene segundo numero, se le escribe a ese (sin incidencia).
        const segundo = paso === 'solicitud'
          ? ((await deps.primerMensaje?.sinWhatsApp(solicitud, `el número ${phone} no tiene una cuenta de WhatsApp`).catch((error: unknown) => {
              deps.log?.('no se pudo anotar el primer mensaje', { detalle: String(error) });
            })) ?? {})
          : {};
        if (!segundo.segundoNumero) {
          await anotarIncidencia(
            solicitud,
            segundo.inaccesible ? 'numero_inaccesible' : 'sin_whatsapp',
            segundo.inaccesible ? `número inaccesible: el ${phone} no tiene una cuenta de WhatsApp y era el segundo número del pedido` : `el número ${phone} no tiene una cuenta de WhatsApp`,
          );
        }
        // Que lo sepa el resto del sistema: una campana o una secuencia no
        // tienen por que volver a descubrirlo a base de intentos fallidos.
        await repos.contacts
          .suprimir(phone, new Date(ahora().getTime() + 30 * 24 * 60 * 60 * 1000), 'el numero no tiene WhatsApp (consulta al proveedor)', 'todo')
          .catch(() => undefined);
        return { accion: 'incidencia', solicitudId: solicitud.id };
      }
    }

    // Con la ventana de 24 h abierta, texto con boton aunque el proveedor
    // pida plantilla: es servicio (con franquicia) y no utilidad (sin ella).
    const contacto = await repos.contacts.getByPhone(phone).catch(() => null);
    const ventanaAbierta = Boolean(contacto?.lastInboundAt && ahora().getTime() - contacto.lastInboundAt.getTime() < 24 * 60 * 60 * 1000);
    const plantillaDeMeta = !ventanaAbierta && !deps.usarPlantilla() && deps.plantillaMeta ? await deps.plantillaMeta().catch(() => false) : false;
    const conPlantilla = (deps.usarPlantilla() || plantillaDeMeta) && !ventanaAbierta;
    // El primer mensaje de un pedido: queda «enviando» en la base antes de
    // salir. Si otro intento ya esta en marcha (otro proceso, un reintento
    // manual) o el pedido espera a una persona, no se manda.
    const esPrimero = paso === 'solicitud' && Boolean(deps.primerMensaje);
    if (esPrimero && !(await deps.primerMensaje!.antes(solicitud))) {
      await repos.rutas.actualizarSolicitud(solicitud.id, { proximoIntentoAt: new Date(ahora().getTime() + 2 * 60_000) });
      return { accion: 'nada', solicitudId: solicitud.id, motivo: 'el primer mensaje de ese pedido ya está en curso o espera a una persona' };
    }
    // La plantilla con los datos del pedido: siempre en la solicitud; en un
    // recordatorio, solo si ese paso no tiene una plantilla propia aprobada en
    // Meta (si no, el recordatorio pediría una que Meta no tiene: #132001).
    // También si en «Plantillas aprobadas por Meta» se eligió esa misma para los recordatorios.
    const delPedido = conPlantilla ? await deps.plantillaSolicitud?.(solicitud) : null;
    // Pantalla «Plantillas de Meta»: cada recordatorio tiene la suya, en orden
    // (la última se repite). Manda sobre todo lo demás y nunca cae en la del
    // primer mensaje: si falta o Meta no la tiene, el rechazo lo dice con su nombre.
    const registroPlantillas = conPlantilla && paso !== 'solicitud' ? await repos.templates.list().catch(() => []) : [];
    let lista = ajustes.plantillasSeguimientos ?? [];
    // Sin nada elegido en la pantalla: las dos plantillas de GSG, si la cuenta
    // las tiene aprobadas las dos; si no, como antes (nunca se pide una que Meta no tiene).
    if (!lista.length && SEGUIMIENTOS_POR_DEFECTO.every((n) => registroPlantillas.some((t) => t.name === n && t.status === 'APPROVED'))) lista = [...SEGUIMIENTOS_POR_DEFECTO];
    const nombreSeg = conPlantilla && paso !== 'solicitud' && lista.length ? lista[Math.min(Math.max(solicitud.intentos - 1, 0), lista.length - 1)] : undefined;
    const registroSeg = nombreSeg ? registroPlantillas.find((t) => t.name === nombreSeg) : undefined;
    const cuantasSeg = registroSeg?.variables ?? 2;
    const datosSeg = nombreSeg ? await deps.datosPedido?.(solicitud).catch(() => null) ?? null : null;
    const mapaSeg = (nombreSeg && (ajustes.datosPlantillas?.[nombreSeg] ?? DATOS_POR_DEFECTO[nombreSeg])) || [1, 2, 3, 4, 5, 6, 7, 8];
    const variablesSeg = nombreSeg
      ? datosSeg ? mapaSeg.slice(0, cuantasSeg).map((n) => datosSeg[n - 1] ?? '') : variablesPara(nombreSeg, paso, ctx, cuantasSeg)
      : null;
    const conDatosDelPedido = !nombreSeg && Boolean(delPedido) && (paso === 'solicitud' || ajustes.plantillas[paso].includes(delPedido!.name) || !(await hayAprobadaDelPaso(paso)));
    const agrupada = conDatosDelPedido ? delPedido : null;
    const elegida = conPlantilla ? (nombreSeg ? { name: nombreSeg, language: registroSeg?.language ?? 'es', variables: cuantasSeg } : agrupada ? { name: agrupada.name, language: agrupada.language ?? 'es', variables: agrupada.variables.length } : await plantillaPara(paso, ahora())) : null;
    // La primera solicitud de una entrega de GSG: la plantilla con los datos del envio.
    const deEntrega = !conPlantilla && paso === 'solicitud' && deps.textoSolicitud ? await deps.textoSolicitud(solicitud) : null;
    // La cadencia por cliente la fija el reparto (espera e intentos), no la
    // politica general: ver `SendJob.limitesContacto`.
    const limitesContacto = {
      separacionMs: Math.min(opciones.esperaRespuestaMinutos * 60_000, 60_000),
      maxPorDia: opciones.maxIntentos + 1,
    };
    const salida = conPlantilla
      ? await sender.send({
          phone,
          kind: 'template',
          programado: true,
          category: 'UTILITY',
          templateName: elegida!.name,
          templateLanguage: elegida!.language,
          variables: variablesSeg ?? (agrupada ? await ajustarAlNumeroDeDatos(agrupada) : variablesPara(elegida!.name, paso, ctx, elegida!.variables)),
          limitesContacto,
        })
      : await sender.send({
          phone,
          kind: 'interactive',
          programado: true,
          category: 'UTILITY',
          // La redaccion que le toca a este cliente en este intento.
          interactive: { body: deEntrega || textoDelPaso(paso, ctx, `${phone}:${solicitud.intentos}`, solicitud.intentos), locationRequest: true },
          limitesContacto,
        });

    const momento = ahora();
    const decision = esPrimero
      ? ((await deps.primerMensaje!.despues(solicitud, salida).catch((error: unknown) => {
          deps.log?.('no se pudo anotar el resultado del primer mensaje', { detalle: String(error) });
        })) ?? {})
      : {};

    if (salida.ok) {
      limpiarEsperasEnvio(repos.rutas, solicitud.id);
      // Lo de prueba no marca el ritmo del numero real (ver src/desarrollador).
      if (!esNumeroDePrueba(phone)) {
        ultimoEnvio = momento.getTime();
        pausaActual = sortearPausa();
      }

      await repos.rutas.actualizarSolicitud(solicitud.id, {
        estado: solicitud.estado === 'respondio' ? 'respondio' : 'enviado',
        intentos: solicitud.intentos + 1,
        ultimoEnvioAt: momento,
        proximoIntentoAt: new Date(momento.getTime() + esperaHastaElSiguiente(solicitud.intentos) * 1000),
        // Un envio que sale bien deja atras cualquier incidencia de envio
        // anterior: si antes fallo y ahora salio, ya no hay nada que reportar.
        incidencia: null,
        incidenciaDetalle: null,
      });
      await repos.rutas.registrarEvento(solicitud.id, 'envio', DESCRIPCION_PASO[paso], {
        paso,
        wamid: salida.wamid,
        via: conPlantilla ? `plantilla ${elegida!.name}` : ventanaAbierta && deps.usarPlantilla() ? 'texto con boton de ubicacion (ventana abierta: servicio, no plantilla)' : 'texto con boton de ubicacion',
      });

      return { accion: 'envio', solicitudId: solicitud.id, paso };
    }

    // El pedido paso a su segundo numero: esta solicitud (la del numero viejo) ya se solto y el pedido sigue con el nuevo.
    if (decision.segundoNumero) {
      return { accion: 'nada', solicitudId: solicitud.id, motivo: 'el número no es accesible: se le escribe al segundo número del pedido' };
    }

    if (salida.blocked) {
      // Sin socket no se toca la solicitud: no es una incidencia del cliente
      // ni del numero, es que WhatsApp esta cerrado. Se vuelve a intentar en
      // dos minutos y el motor no vuelve a mirar hasta entonces.
      // La ruta inactiva (webhook de rutas) tambien es una espera: el chat se abre
      // solo cuando GSG reactiva la ruta, y entonces se despierta el motor.
      if (salida.code === 'sin_conexion' || salida.code === 'sin_lineas_disponibles' || salida.code === 'limite_diario' || salida.code === 'ruta_inactiva') {
        esperar(solicitud, salida.code, salida.reason, salida.retryAfterMs ?? 2 * 60_000);
        await repos.rutas.actualizarSolicitud(solicitud.id, {
          proximoIntentoAt: new Date(momento.getTime() + (salida.retryAfterMs ?? 2 * 60_000)),
        });
        return { accion: 'nada', solicitudId: solicitud.id, motivo: salida.reason };
      }
      // «De este me encargo yo»: una persona atiende el chat. No es incidencia
      // ni intento gastado; se vuelve a mirar mas tarde, por si lo suelta.
      if (salida.code === 'bot_pausado') {
        esperar(solicitud, salida.code, salida.reason, 30 * 60_000);
        await repos.rutas.actualizarSolicitud(solicitud.id, { proximoIntentoAt: new Date(momento.getTime() + 30 * 60_000) });
        return { accion: 'nada', solicitudId: solicitud.id, motivo: salida.reason };
      }
      // El monitor aparto a este contacto porque Meta dijo que no tiene
      // WhatsApp: es una incidencia con nombre, no una espera de un mes.
      if (salida.code === 'contact_suppressed' && /131026|no tiene whatsapp/i.test(salida.reason)) {
        await anotarIncidencia(solicitud, decision.inaccesible ? 'numero_inaccesible' : 'sin_whatsapp', salida.reason.slice(0, 300));
        return { accion: 'incidencia', solicitudId: solicitud.id };
      }
      // Una guarda que no se va a abrir sola (baja del cliente, modo prueba,
      // sin plantilla) con el primer mensaje de un pedido: a la bandeja.
      if (decision.detener) {
        await anotarIncidencia(solicitud, 'envio_bloqueado', decision.detener.slice(0, 300));
        return { accion: 'incidencia', solicitudId: solicitud.id, motivo: decision.detener };
      }
      // Una guarda propia (cupo, calentamiento, opt-out). No cuenta como
      // intento: el cliente no ha recibido nada.
      const espera = salida.retryAfterMs ?? 15 * 60_000;
      esperar(solicitud, salida.code, salida.reason, espera);
      await repos.rutas.actualizarSolicitud(solicitud.id, {
        proximoIntentoAt: new Date(momento.getTime() + espera),
        incidencia: 'envio_bloqueado',
        incidenciaDetalle: `${salida.code}: ${salida.reason}`,
      });
      await repos.rutas.registrarEvento(
        solicitud.id,
        'incidencia',
        `envío detenido por una guarda propia: ${salida.reason}`,
        { code: salida.code },
      );
      return { accion: 'incidencia', solicitudId: solicitud.id, motivo: salida.reason };
    }

    // Error de WhatsApp. El codigo decide si es un numero imposible o un
    // tropiezo pasajero.
    const codigo = incidenciaDeErrorDeEnvio(salida.error, salida.code);
    if (codigo === 'sin_whatsapp' || codigo === 'numero_invalido') {
      await anotarIncidencia(solicitud, decision.inaccesible ? 'numero_inaccesible' : codigo, salida.error.slice(0, 300));
      return { accion: 'incidencia', solicitudId: solicitud.id };
    }
    // El primer mensaje de un pedido con un resultado incierto, un rechazo que
    // no se arregla insistiendo o el tope de reintentos: no se reenvia solo.
    // Queda en la bandeja de errores para que una persona decida.
    if (decision.detener) {
      await anotarIncidencia(solicitud, 'error_envio', decision.detener.slice(0, 300));
      return { accion: 'incidencia', solicitudId: solicitud.id, motivo: decision.detener };
    }

    // Un tropiezo pasajero (5xx, rate limit, socket caido a mitad) no gasta
    // un intento: el cliente no recibio nada. Se vuelve en unos minutos.
    if (salida.retryable) {
      esperar(solicitud, 'error_whatsapp', salida.error, decision.esperaMs ?? 3 * 60_000);
      await repos.rutas.actualizarSolicitud(solicitud.id, {
        // La espera la decide el seguimiento del primer mensaje (progresiva); si no, la de siempre.
        proximoIntentoAt: new Date(momento.getTime() + (decision.esperaMs ?? 3 * 60_000)),
        incidencia: 'error_envio',
        incidenciaDetalle: salida.error.slice(0, 300),
      });
      await repos.rutas.registrarEvento(solicitud.id, 'incidencia', `WhatsApp no pudo enviar (se reintenta): ${salida.error}`);
      // Lo de prueba no marca el ritmo del numero real (ver src/desarrollador).
      if (!esNumeroDePrueba(phone)) {
        ultimoEnvio = momento.getTime();
        pausaActual = sortearPausa();
      }
      return { accion: 'incidencia', solicitudId: solicitud.id, motivo: salida.error };
    }

    // Un error de PLANTILLA de Meta (#132000-#132999: no existe con ese idioma,
    // datos de más o de menos, pausada) no es del cliente: no le llegó nada.
    // No gasta un intento (antes el pedido acababa en «no contestó a 4
    // mensajes» habiendo recibido uno, 10/11); queda dicho qué arreglar y se
    // vuelve a probar en 15 minutos (por si se trae o aprueba la plantilla).
    if (/#?132\d{3}\b/.test(salida.error)) {
      const espera = 15 * 60_000;
      esperar(solicitud, 'plantilla_meta', salida.error, espera);
      await repos.rutas.actualizarSolicitud(solicitud.id, {
        proximoIntentoAt: new Date(momento.getTime() + espera),
        incidencia: 'envio_bloqueado',
        incidenciaDetalle: `Meta rechazó la plantilla (no le llegó al cliente): ${salida.error}`.slice(0, 300),
      });
      await repos.rutas.registrarEvento(solicitud.id, 'incidencia', `Meta rechazó la plantilla; no cuenta como intento: ${salida.error}`);
      return { accion: 'incidencia', solicitudId: solicitud.id, motivo: salida.error };
    }

    const intentos = solicitud.intentos + 1;
    await repos.rutas.actualizarSolicitud(solicitud.id, {
      intentos,
      ultimoEnvioAt: momento,
      proximoIntentoAt: new Date(momento.getTime() + esperaHastaElSiguiente(solicitud.intentos) * 1000),
      incidencia: 'error_envio',
      incidenciaDetalle: salida.error.slice(0, 300),
    });
    await repos.rutas.registrarEvento(solicitud.id, 'incidencia', `WhatsApp rechazó el envío: ${salida.error}`);
    // Lo de prueba no marca el ritmo del numero real (ver src/desarrollador).
    if (!esNumeroDePrueba(phone)) {
      ultimoEnvio = momento.getTime();
      pausaActual = sortearPausa();
    }

    return { accion: 'incidencia', solicitudId: solicitud.id, motivo: salida.error };
  }

  /** Cierra los lotes que ya no tienen nada vivo y encola su resumen. */
  async function cerrarLotesTerminados(): Promise<string[]> {
    const cerrados: string[] = [];
    for (const lote of await repos.rutas.lotesActivos()) {
      const cifras = await repos.rutas.cifrasPorEstado(lote.id);
      const vivos =
        (cifras.pendiente ?? 0) + (cifras.enviado ?? 0) + (cifras.respondio ?? 0);
      if (vivos > 0) continue;

      await repos.rutas.cambiarEstadoLote(lote.id, 'terminado');
      // El cierre de un lote de prueba no es asunto de GSG.
      if (await esLoteDePrueba(repos, lote.id)) {
        cerrados.push(lote.id);
        continue;
      }
      await repos.rutas.encolarReporte({
        loteId: lote.id,
        tipo: 'resumen',
        payload: payloadResumen(lote, cifras, await repos.rutas.cifrasPorIncidencia(lote.id)),
      });
      cerrados.push(lote.id);
      deps.log?.('lote terminado', { lote: lote.nombre, cifras });
    }
    return cerrados;
  }

  return {
    proximoEnvioEn: () => deps.salud && deps.politica
      ? deps.salud.marcapasos.proximoEnvioEn(ahora(), deps.salud.factor())
      : Math.max(0, ultimoEnvio + pausaEfectiva() - ahora().getTime()),

    async proximoDespertarEn() {
      // Con el horario de ahora, no con el de la ultima pasada.
      await refrescarAjustes();
      const momento = ahora();
      // El plazo de la incidencia despierta a su hora, con horario o sin el.
      const plazo = typeof repos.rutas.proximoPlazoAt === 'function' ? await repos.rutas.proximoPlazoAt(opciones.maxIntentos) : null;
      // Un segundo como minimo: si marcarla falla, no se reintenta en bucle.
      const hastaPlazo = plazo ? Math.max(1_000, plazo.getTime() - momento.getTime()) : null;
      const conPlazo = (espera: number | null): number | null =>
        hastaPlazo === null ? espera : espera === null ? hastaPlazo : Math.min(espera, hastaPlazo);
      const proximo = await repos.rutas.proximoIntentoAt();
      if (!proximo) return conPlazo(null);
      const pausaRestante = deps.salud && deps.politica
        ? deps.salud.marcapasos.proximoEnvioEn(momento, deps.salud.factor())
        : Math.max(0, ultimoEnvio + pausaEfectiva() - momento.getTime());
      let espera = Math.max(proximo.getTime() - momento.getTime(), pausaRestante);
      if (!enHorario(momento, opciones)) {
        // Busca la siguiente apertura sin despertar repetidamente durante la noche.
        let apertura: number | null = null;
        for (let salto = 15; salto <= 48 * 60; salto += 15) {
          if (enHorario(new Date(momento.getTime() + salto * 60_000), opciones)) {
            const inicio = Math.max(0, salto - 15);
            for (let minuto = inicio; minuto <= salto; minuto++) {
              if (enHorario(new Date(momento.getTime() + minuto * 60_000), opciones)) {
                apertura = minuto * 60_000;
                break;
              }
            }
            break;
          }
        }
        if (apertura != null) espera = Math.max(espera, apertura);
        else return conPlazo(null);
      }
      return conPlazo(Math.max(1, espera));
    },

    async tick() {
      const momento = ahora();
      await refrescarAjustes();
      // No inicia intentos ni escribe incidencias mientras no hay socket.
      // Al reconectarse continúa en la siguiente pasada, sin espera de 2 min.
      if (sinSocket(deps) && !(await sigueSinSocketPorPrueba(repos, momento))) {
        const motivo = 'WhatsApp está desconectado; el envío continúa al reconectarse.';
        anotarEsperaGlobal(repos.rutas, { codigo: 'sin_conexion', motivo, hasta: null });
        return { accion: 'nada', motivo };
      }
      anotarEsperaGlobal(repos.rutas, null);

      const derivadas = await derivarVencidas(momento);
      if (derivadas.length) return { accion: 'derivacion', solicitudId: derivadas[0]!.id };

      if (!enHorario(momento, opciones)) {
        // No consulta la cola fuera de horario: la API muestra la franja.
        return {
          accion: 'nada',
          motivo: `fuera del horario de envio (${opciones.horaInicio}:00 a ${opciones.horaFin}:00)`,
        };
      }

      let [siguiente] = await repos.rutas.tocaIntentar(momento, 1);
      // El primer mensaje espera lo configurado desde que llegó el pedido. Solo
      // si nadie le puso hora (un «reintentar ahora» la pone y sale ya).
      const esperaPrimero = Math.max(0, opciones.esperaPrimerMensajeSegundos ?? (opciones.esperaPrimerMensajeMinutos ?? 0) * 60) * 1000;
      const primeroTodaviaNo = (s: Solicitud): Date | null => {
        if (!esperaPrimero || s.estado !== 'pendiente' || s.intentos > 0 || s.proximoIntentoAt) return null;
        const sale = new Date(s.createdAt.getTime() + esperaPrimero);
        return sale.getTime() > momento.getTime() ? sale : null;
      };
      for (let vueltas = 0; siguiente && vueltas < 50; vueltas++) {
        const sale = primeroTodaviaNo(siguiente);
        if (sale) {
          await repos.rutas.actualizarSolicitud(siguiente.id, { proximoIntentoAt: sale });
          [siguiente] = await repos.rutas.tocaIntentar(momento, 1);
          continue;
        }
        if (await yaTieneUbicacion(siguiente, momento)) {
          [siguiente] = await repos.rutas.tocaIntentar(momento, 1);
          continue;
        }
        if (!(await pausado(siguiente.phone))) break;
        esperar(siguiente, 'pausado', 'Mensajes detenidos o pin recibido pendiente de confirmación.', 5 * 60_000);
        await repos.rutas.actualizarSolicitud(siguiente.id, { proximoIntentoAt: new Date(momento.getTime() + 5 * 60_000) });
        [siguiente] = await repos.rutas.tocaIntentar(momento, 1);
      }
      if (!siguiente) {
        const lotesCerrados = await cerrarLotesTerminados();
        return { accion: 'nada', motivo: 'no hay nada pendiente', lotesCerrados };
      }
      // Un numero del Modulo desarrollador no sale por WhatsApp (el sender lo
      // simula): ni la pausa, ni el monitor, ni el marcapasos del numero real
      // tienen nada que decir, y lo suyo no los consume.
      const dePrueba = esNumeroDePrueba(siguiente.phone);

      // El ritmo. Es lo que separa "un negocio escribiendo a sus clientes" de
      // "un robot", y lo unico que de verdad evita el bloqueo del numero.
      if (!dePrueba && ultimoEnvio && momento.getTime() - ultimoEnvio < pausaEfectiva()) {
        esperar(siguiente, 'pausa_entre_envios', 'Esperando la pausa configurada entre clientes.', ultimoEnvio + pausaEfectiva() - momento.getTime());
        return { accion: 'nada', motivo: 'esperando la pausa entre mensajes' };
      }

      // El monitor de salud manda sobre el ritmo propio: parado es parado.
      if (!dePrueba && deps.salud && deps.salud.factor() <= 0) {
        esperar(siguiente, 'riesgo_parado', 'El monitor de salud tiene el número detenido.');
        return { accion: 'nada', motivo: 'el monitor de salud tiene el numero parado' };
      }

      const paso = pasoDe(siguiente, opciones);
      if (paso === null) return { accion: 'nada', motivo: 'la solicitud ya no espera mensajes' };
      if (paso === 'derivar') return { ...(await derivar(siguiente)), ...(dePrueba ? { dePrueba: true } : {}) };

      // Sin telefono valido no se manda nada: eso ya se marco al cargar el
      // lote, pero mas vale no fiarse.
      if (!siguiente.phone) {
        await anotarIncidencia(siguiente, 'numero_invalido', 'la solicitud no tiene teléfono al que escribir');
        return { accion: 'incidencia', solicitudId: siguiente.id };
      }

      // El marcapasos global (cupos por minuto y hora, tier de Meta, contactos
      // nuevos) se consulta ANTES de tocar la solicitud: un "todavia no" no es
      // una incidencia y no tiene por que quedar en su bitacora.
      if (deps.salud && deps.politica && !dePrueba) {
        const contacto = await repos.contacts.upsertFromInbound(siguiente.phone);
        const decision = decidirRitmo(await deps.salud.fotoRitmo(contacto, momento), deps.politica());
        if (!decision.ok) {
          esperar(siguiente, decision.codigo, decision.motivo, decision.esperaMs);
          return { accion: 'nada', motivo: `${decision.codigo}: ${decision.motivo}` };
        }
      }

      const hecho = await enviarPaso(siguiente, paso);
      return dePrueba ? { ...hecho, dePrueba: true } : hecho;
    },
  };
}

/**
 * Trabajador del motor. Duerme si no hay tareas y se despierta por eventos o
 * por un temporizador al vencer el siguiente envío programado.
 */
export function startMotorRutas(deps: MotorDeps): () => void {
  const motor = crearMotor(deps);
  let corriendo = false;
  let parado = false;
  let despertarPendiente = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const programarDesconexion = () => {
    timer = setTimeout(() => {
      timer = null;
      void (async () => {
        if (sinSocket(deps) && !(await sigueSinSocketPorPrueba(deps.repos, new Date()).catch(() => false))) programarDesconexion();
        else void despertar();
      })();
    }, 30_000);
    timer.unref?.();
  };

  const dormirHastaProximaTarea = async () => {
    if (parado) return;
    if (sinSocket(deps) && !(await sigueSinSocketPorPrueba(deps.repos, new Date()).catch(() => false))) {
      // Solo se comprueba el estado en memoria del socket: sin consultas SQL
      // (salvo en una simulacion, ver sigueSinSocketPorPrueba).
      programarDesconexion();
      return;
    }
    const espera = await motor.proximoDespertarEn();
    if (espera == null || parado) return; // cola vacía: queda dormido hasta una señal.
    timer = setTimeout(() => {
      timer = null;
      void despertar();
    }, espera);
    timer.unref?.();
  };

  const despertar = async () => {
    if (parado) return;
    if (timer) clearTimeout(timer);
    timer = null;
    if (corriendo) {
      despertarPendiente = true;
      return;
    }
    corriendo = true;
    try {
      // Lo de prueba no consume el ritmo: en la misma pasada se sigue con el
      // siguiente mientras sean de prueba (con tope, para no acaparar el proceso).
      for (let i = 0; i < 25; i++) {
        const r = await motor.tick();
        if (!r.dePrueba) break;
      }
    } catch (error) {
      deps.log?.('fallo el motor de rutas', {
        detalle: error instanceof Error ? error.message : String(error),
      });
    } finally {
      corriendo = false;
      if (despertarPendiente) {
        despertarPendiente = false;
        void despertar();
      } else {
        void dormirHastaProximaTarea().catch((error) => deps.log?.('no se pudo programar el siguiente trabajo de rutas', { detalle: String(error) }));
      }
    }
  };
  const desuscribir = alDespertarMotorRutas(() => void despertar());
  void despertar(); // Una lectura al iniciar recupera lo pendiente del reinicio.
  return () => {
    parado = true;
    desuscribir();
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
