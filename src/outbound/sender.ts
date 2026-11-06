/**
 * Envio de un mensaje, con las guardas por delante.
 *
 * Todo lo que sale del sistema pasa por aqui. No hay atajo que se salte
 * `evaluateGates`, y cada intento deja una fila en `deliveries` aunque el
 * mensaje no llegue a salir: los bloqueos son la senal mas util que hay
 * para saber si una lista esta sucia antes de quemar el numero con ella.
 */

import type { Repos, TemplateCategory } from '../db/repos.js';
import { esNumeroDePrueba } from '../desarrollador/numeros.js';
import { randomUUID } from 'node:crypto';
import type { CitaSaliente, WhatsAppClient } from '../whatsapp/client.js';
import { WhatsAppApiError } from '../whatsapp/client.js';
import { renderTemplate, TemplateRenderError } from '../templates/render.js';
import type { Monitor } from '../salud/monitor.js';
import type { Politica } from '../salud/politica.js';
import { decidirRitmo, type DecisionRitmo } from '../salud/ritmo.js';
import { aMano, envioProgramado } from '../salud/humano.js';
import { codigoDeError } from '../salud/supresion.js';
import { inicioDelDia } from '../salud/monitor.js';
import { dailyCapFor, type WarmupPolicy } from './throttle.js';
import { crearLimitadorEnvios } from './limitador-envios.js';
import { audioParaMeta } from '../whatsapp/audio-meta.js';
import { esContactoWeb, nuevoIdMensajeWeb } from '../web-visitantes/canal.js';
import {
  evaluateGates,
  isWithinServiceWindow,
  sevenDaysBefore,
  type GateCode,
  type MessageKind,
} from './gates.js';

export interface SendJob {
  phone: string;
  kind: MessageKind;
  category: TemplateCategory;
  campaignId?: string | null;
  /**
   * Por que linea de WhatsApp sale. Indicarla es elegirla (una persona, desde el
   * chat): si no esta disponible no se sustituye. Sin indicarla: la que el
   * cliente tiene asignada o, si es nuevo, una conectada al azar.
   */
  whatsappNumberId?: string | null;
  /**
   * `whatsappNumberId` lo fijo la cola para que un reintento no cambie de numero,
   * no lo eligio nadie: si esa linea deja de estar disponible, se puede cambiar.
   */
  lineaDelSistema?: boolean;
  /** Escrito a mano desde /chat: ver `SendIntent.manual` en gates. */
  manual?: boolean;
  /** Envío con cadencia propia: el transporte no añade escritura artificial. */
  programado?: boolean;
  /**
   * Quien lo manda, para el hilo (payload.origen): 'ia' el asistente,
   * 'sistema' lo automatico (reglas, reparto, campanas). Lo manual va como
   * 'persona'. El entrenamiento aprende solo de lo que contesto una persona.
   */
  origen?: string;
  /** El nombre de pila de quien lo manda (un asesor), para el hilo y el webhook. */
  autorNombre?: string;
  /**
   * Lo escribio una persona de verdad (en el chat de GSGchat o en el de GSG): al salir, el bot se
   * calla en ese chat hasta que alguien lo reactive. No es lo mismo que `origen: 'persona'`, que
   * tambien usan envios automaticos que pasan como si fueran a mano.
   */
  atiendePersona?: boolean;
  /** Si lo escribio un usuario de otro sistema (GSG): quien, con que rol y para que tracking. Se guarda en el hilo (payload.emisor). */
  emisor?: { tipo: string; usuarioId: string; rol: string | null; tracking: string; idExterno: string };
  /** El rol de quien escribe desde el chat de aqui ('admin' u 'operador'): se guarda para que el hilo diga quien fue. */
  autorRol?: string;
  /**
   * Limites por contacto propios de quien manda, por encima de la politica.
   *
   * El motor de rutas lleva su propia cadencia (la espera entre mensajes y
   * los intentos por cliente los fija quien opera, desde la pantalla): si
   * ademas se le aplicara la separacion general de 10 min y el techo de 3 al
   * dia, "cada 5 minutos, 4 mensajes" seria imposible sin que nadie lo dijera.
   */
  limitesContacto?: { separacionMs?: number; maxPorDia?: number };

  templateName?: string;
  templateLanguage?: string;
  variables?: string[];

  /**
   * Responder citando otro mensaje.
   *
   * Cada proveedor la arma a su manera (ver `CitaSaliente`), pero el hilo la
   * guarda igual para todos, en `payload.cita`: asi el globo pinta el bloque
   * citado al recargar, aunque el proveedor no lo devuelva.
   */
  cita?: CitaSaliente & { autor?: string };
  /** Se reenvio desde otro chat: el globo lo dice, como en WhatsApp. */
  reenviado?: boolean;
  /**
   * Un texto fijo (escrito por el negocio, no por el modelo) aunque lo mande
   * el asistente: la explicacion de «¿por qué?» y el cierre. En «Solo lo de
   * GSG» es lo unico con origen 'ia' que puede salir a un cliente.
   */
  textoFijo?: boolean;
  /**
   * Regla del dueño: el cierre que se manda UNA vez cuando el cliente pregunta
   * algo después del agradecimiento. Es lo único que sale a un cliente en silencio.
   */
  cierreTrasGracias?: boolean;
  /** Acuse de una ubicación recibida; queda identificado en el historial real. */
  confirmacionUbicacion?: boolean;
  /** Respuesta a lo que el cliente contesto con el bot callado (ubicacion pedida, boton de entrega): sale igual. */
  traspasaPausa?: boolean;
  /**
   * La respuesta del bot a «cambiar ubicación» (regla del dueño, 28/10: el
   * cambio lo atiende el bot): sale también con el bot callado de «Solo lo de GSG».
   */
  cambioUbicacion?: boolean;
  /**
   * La respuesta del bot a un enlace de mapa del que no sale una ubicación segura
   * (se le pide el pin): sale también con el bot callado, como la de cambiar ubicación.
   */
  respuestaUbicacion?: boolean;
  /** Huella de coordenadas normalizadas para distinguir una corrección del mismo pedido. */
  confirmationScope?: string;
  /**
   * Regla del dueño (10/10): tras UBI REGISTRADA, la respuesta de la IA a una
   * consulta del cliente sobre SU pedido (dónde está, cuándo llega, la
   * ventana). Redactada por el modelo con el contexto del pedido y revisada
   * en código (ver src/ia/consulta-pedido.ts): sale aunque el chat esté en
   * silencio y aunque sea «Solo lo de GSG».
   */
  consultaCliente?: boolean;

  text?: string;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  interactive?: {
    body: string;
    buttons?: Array<{ id: string; title: string }>;
    locationRequest?: boolean;
  };
  /** Un sticker de la biblioteca (ver src/stickers): el fichero ya leido. */
  sticker?: { id: string; archivo: string; datos: Buffer; mimeType: string; url: string };
  /**
   * Una foto, un video, un audio o un documento escrito a mano desde el chat.
   * `id` es el nombre con el que ya quedo guardado en .wa-media, para que el
   * hilo lo pinte igual que uno recibido.
   */
  media?: {
    id: string;
    kind: 'image' | 'video' | 'audio' | 'document';
    datos: Buffer;
    mimeType: string;
    filename?: string;
    caption?: string;
    /**
     * Un audio que es nota de voz (grabada, o generada por la voz del
     * asistente): el cliente lo ve con la onda y el play, no como fichero.
     * En el hilo, `caption` es lo que se dijo.
     */
    voz?: boolean;
  };
}

/**
 * El hilo guarda quien mando cada saliente: una persona (a mano desde el
 * chat), el asistente ('ia') o lo automatico ('sistema'). Es lo que permite
 * que el entrenamiento aprenda de las respuestas humanas y no de las suyas.
 */
function conOrigen(job: SendJob, payload: Record<string, unknown> | null): Record<string, unknown> {
  // Lo que diga quien manda vale; sin decirlo, a mano es una persona y lo demas, el sistema.
  const origen = job.origen ?? (job.manual ? 'persona' : 'sistema');
  const nombre = job.autorNombre?.trim();
  return {
    ...(payload ?? {}),
    origen,
    ...(job.confirmacionUbicacion ? { confirmacionUbicacion: true } : {}),
    // Un texto fijo del negocio que manda el asistente: en el chat y para GSG es del sistema, no de la IA.
    ...(job.textoFijo ? { textoFijo: true } : {}),
    ...(nombre ? { autorNombre: nombre } : {}),
    ...(job.autorRol ? { autorRol: job.autorRol } : {}),
    ...(job.emisor ? { emisor: job.emisor } : {}),
    // La cita se guarda con lo justo para pintarla: de quien era y que decia.
    // El id tambien, para poder saltar al original si sigue en el hilo.
    ...(job.cita ? { cita: { id: job.cita.id, deMi: job.cita.fromMe, texto: job.cita.texto ?? '', autor: job.cita.autor ?? null } } : {}),
    ...(job.reenviado ? { reenviado: true } : {}),
  };
}

/**
 * Lo que se puede hacer SOBRE un mensaje ya enviado: reaccionar, quitarlo o
 * cambiarlo.
 *
 * No pasa por los gates ni deja fila en `deliveries` a proposito: no es un
 * mensaje nuevo que gaste cupo ni que abra una conversacion con Meta, es una
 * marca sobre uno que ya salio. Contarlo como envio ensuciaria el warm-up y
 * el marcapasos con pulgares arriba.
 */
export interface AccionMensaje {
  phone: string;
  /** La linea por la que se hace; la del mensaje original. Sin ella, la principal. */
  whatsappNumberId?: string | null;
  mensaje: CitaSaliente;
  tipo: 'reaccion' | 'eliminar' | 'editar';
  /** Para 'reaccion'. Cadena vacia = quitarla. */
  emoji?: string;
  /** Para 'editar'. */
  texto?: string;
}

export type SendOutcome =
  | { ok: true; wamid: string; deliveryId: number; whatsappNumberId?: string | null }
  | {
      ok: false;
      blocked: true;
      code: GateCode;
      reason: string;
      retryAfterMs?: number;
      deliveryId: number;
      /** La linea del intento: la cola la fija en el trabajo para que el reintento no cambie de numero. */
      whatsappNumberId?: string | null;
    }
  | {
      ok: false;
      blocked: false;
      error: string;
      retryable: boolean;
      deliveryId: number | null;
      whatsappNumberId?: string | null;
      /** Codigo de Meta (131026...) o del cliente, normalizado; null si no se reconocio. */
      code?: string | null;
      /**
       * No se sabe si salio: la peticion se corto sin respuesta del proveedor
       * (red, tiempo agotado) o contesto sin id de mensaje. Reenviar a ciegas
       * puede duplicar el mensaje: quien llama decide (ver src/entregas/primer-mensaje.ts).
       */
      incierto?: boolean;
    };

/** Una linea de WhatsApp lista para enviar: su cliente y lo que la identifica ante los controles. */
export interface LineaDeEnvio {
  id: string;
  etiqueta: string;
  numero: string;
  cliente: WhatsAppClient;
  /** Con que id se llevan su estado, su cupo y su calentamiento (numberState, counters). */
  identidad: string;
  /** Si la ventana de 24 h de Meta aplica a esta linea (solo la API oficial). */
  ventanaAplica: boolean;
  /** Desde cuando esta sin conexion; null si esta conectada o aun no se sabe. */
  noDisponibleDesde?: Date | null;
  /** WhatsApp rechazo este numero: sus clientes pasan a otra linea sin esperar. */
  bloqueada?: boolean;
}

/** Lo que dura sin conexion una linea antes de pasar sus clientes a otra: un corte breve no los mueve. */
const ESPERA_CAMBIO_LINEA_MS = 2 * 60_000;

export interface SenderDeps {
  /**
   * Resuelve una linea (null = la principal). Devuelve null si no existe, esta
   * deshabilitada o no se puede armar. Sin esto, todo sale por `wa`, como siempre.
   */
  resolverLinea?: (id: string | null) => Promise<LineaDeEnvio | null>;
  /**
   * La linea conectada que toca (ver src/whatsapp/reparto-lineas.ts), sin contar
   * `excluir`. Se usa con un cliente nuevo o cuando la suya ya no esta
   * disponible. Null = ninguna disponible.
   */
  elegirLinea?: (excluir: string | null) => Promise<LineaDeEnvio | null>;
  repos: Repos;
  wa: WhatsAppClient;
  /** Funcion si el numero puede cambiar desde /setup sin reiniciar. */
  phoneNumberId: string | (() => string);
  warmup: WarmupPolicy;
  maxMarketingPerContact7d: number;
  maxConcurrentSends?: number;
  sendsPerSecond?: number;
  /** Si la ventana de 24 h de Meta aplica. Ver `GateSnapshot`. */
  serviceWindowApplies?: boolean | (() => boolean);
  now?: () => Date;
  /**
   * El monitor de salud y la politica de ritmo. Opcionales para que las
   * pruebas de los gates de siempre no tengan que montarlos; en el sistema
   * real van siempre, y con ellos entran el marcapasos, la supresion por
   * contacto, la fatiga y el techo del tier.
   */
  salud?: Monitor;
  politica?: () => Politica;
  /** Modo prueba (SOLO_NUMEROS): a quien no este aqui no se le escribe. Vacio = a todos. */
  soloNumeros?: string[] | (() => string[]);
}

export interface Sender {
  send(job: SendJob): Promise<SendOutcome>;
  /**
   * Reaccionar, eliminar para todos o editar un mensaje ya enviado.
   *
   * Opcional para no obligar a los dobles de prueba que solo mandan mensajes.
   * Quien la llame comprueba antes que exista; la pantalla, ademas, esconde
   * lo que el proveedor no sabe hacer.
   */
  accion?(accion: AccionMensaje): Promise<{ ok: true; wamid?: string }>;
  /**
   * Si el otro lado esta escribiendo o en linea. `null` = no se sabe.
   *
   * Va aqui, y no en una dependencia aparte, porque el sender es la unica
   * puerta al cliente de WhatsApp que tienen las pantallas: meter una segunda
   * seria abrir dos caminos hacia lo mismo.
   */
  presencia?(phone: string, whatsappNumberId?: string | null): Promise<{ estado: string; desde: string } | null>;
}

export function createSender(deps: SenderDeps): Sender {
  const { repos, wa, warmup, maxMarketingPerContact7d } = deps;
  const limitarEnvio = crearLimitadorEnvios({
    concurrencia: deps.maxConcurrentSends ?? (process.env.VITEST ? 10 : 2),
    porSegundo: deps.sendsPerSecond ?? (process.env.VITEST ? 20 : 2),
  });
  const now = deps.now ?? (() => new Date());
  const phoneId = () =>
    typeof deps.phoneNumberId === 'function' ? deps.phoneNumberId() : deps.phoneNumberId;
  const ventanaAplica = () =>
    typeof deps.serviceWindowApplies === 'function'
      ? deps.serviceWindowApplies()
      : deps.serviceWindowApplies !== false;

  /** El cliente de una linea (null = la principal); undefined si no hay lineas montadas o no existe. */
  const clienteDeLinea = async (id: string | null | undefined): Promise<WhatsAppClient | undefined> =>
    deps.resolverLinea ? (await deps.resolverLinea(id ?? null))?.cliente : undefined;

  const estaConectada = (linea: LineaDeEnvio) => linea.cliente.conectado?.() !== false;

  /** Una linea distinta de `excluir` que pueda enviar ahora mismo. */
  async function otraLineaViva(excluir: string | null): Promise<LineaDeEnvio | null> {
    const elegida = deps.elegirLinea ? await deps.elegirLinea(excluir) : null;
    if (elegida) return elegida;
    const principal = await deps.resolverLinea!(null);
    return principal && principal.id !== excluir && estaConectada(principal) ? principal : null;
  }

  /**
   * Por que linea sale un trabajo. La regla: un cliente no cambia de numero sin
   * necesidad.
   *
   *  - Una linea PEDIDA por una persona manda, y si no esta disponible no se
   *    sustituye: seria salir desde un numero que nadie eligio.
   *  - Un cliente con linea sigue por ella. Un corte breve se espera; un cupo
   *    gastado o una pausa de salud tampoco lo mueven (pasar sus mensajes a otro
   *    numero solo quemaria ese tambien).
   *  - La excepcion: su linea lleva mas de 2 minutos sin conexion, WhatsApp la
   *    bloqueo, o se quito o se deshabilito. Ahi pasa a otra linea activa y se
   *    queda en ella.
   *  - Un grupo vive en la linea de la que es miembro: nunca se reparte ni se cambia.
   *
   * `confirmar` guarda la decision justo antes de enviar, para que lo que frena
   * el modo prueba no cuente como cliente repartido. `pedida` y `sinAsignar` le
   * dicen al envio que no debe fijar esa linea ni al cliente ni al reintento.
   */
  async function lineaDelTrabajo(job: SendJob, contact: { id: string; tipo?: string }, at: Date): Promise<{
    linea: LineaDeEnvio | null;
    pedida?: boolean;
    sinAsignar?: boolean;
    confirmar?: () => Promise<LineaDeEnvio | null>;
  }> {
    if (!deps.resolverLinea) return { linea: { id: '', etiqueta: '', numero: '', cliente: wa, identidad: phoneId(), ventanaAplica: ventanaAplica() } };
    const resolver = deps.resolverLinea;
    if (job.whatsappNumberId && !job.lineaDelSistema) return { linea: await resolver(job.whatsappNumberId), pedida: true };

    const propia = job.whatsappNumberId ?? (await repos.messages.lineaDeLaConversacion(contact.id));
    if (contact.tipo === 'grupo') return { linea: (propia ? await resolver(propia) : null) ?? (await resolver(null)) };

    /** Lo que quedo guardado manda: otro envio a la vez pudo decidir antes. */
    const conLaVigente = (elegida: LineaDeEnvio, vigente: string | null) => (vigente && vigente !== elegida.id ? resolver(vigente) : Promise.resolve(elegida));

    if (!propia) {
      const nueva = await otraLineaViva(null);
      if (!nueva) return { linea: await resolver(null), sinAsignar: true };
      return { linea: nueva, confirmar: async () => conLaVigente(nueva, await repos.lineasContacto.fijarSiNoTiene(contact.id, nueva.id, at)) };
    }

    const actual = await resolver(propia);
    const caidaDeMas = Boolean(
      actual && !estaConectada(actual) && (actual.bloqueada || (actual.noDisponibleDesde && at.getTime() - actual.noDisponibleDesde.getTime() >= ESPERA_CAMBIO_LINEA_MS)),
    );
    if (actual && !caidaDeMas) return { linea: actual };

    const otra = await otraLineaViva(propia);
    // No hay ninguna otra: no se le toca la asignacion y se espera a que vuelva alguna.
    if (!otra) return actual ? { linea: actual } : { linea: await resolver(null), sinAsignar: true };
    const motivo = actual ? 'linea_caida' : 'linea_no_disponible';
    return { linea: otra, confirmar: async () => conLaVigente(otra, await repos.lineasContacto.cambiar(contact.id, propia, otra.id, motivo, at)) };
  }

  const permitidos = () => (typeof deps.soloNumeros === 'function' ? deps.soloNumeros() : deps.soloNumeros) ?? [];

  const puerto: Sender = {
    /**
     * Las acciones sobre un mensaje van directas al proveedor.
     *
     * Si el proveedor no sabe hacerlo, el error lo dice con sus palabras (ver
     * `dynamic.ts`) y la pantalla lo ensena: es preferible a callarse y dejar
     * al operador creyendo que borro algo que sigue en el telefono del cliente.
     */
    async accion(accion) {
      const wa = (await clienteDeLinea(accion.whatsappNumberId)) ?? deps.wa;
      if (accion.tipo === 'reaccion') {
        if (!wa.sendReaction) throw new Error('este proveedor no manda reacciones');
        const r = await wa.sendReaction(accion.phone, accion.mensaje, accion.emoji ?? '');
        return { ok: true, wamid: r.wamid };
      }
      if (accion.tipo === 'eliminar') {
        if (!wa.borrarParaTodos) throw new Error('este proveedor no puede eliminar un mensaje para todos');
        await wa.borrarParaTodos(accion.phone, accion.mensaje);
        return { ok: true };
      }
      if (!wa.editarMensaje) throw new Error('este proveedor no puede editar un mensaje ya enviado');
      const r = await wa.editarMensaje(accion.phone, accion.mensaje, accion.texto ?? '');
      return { ok: true, wamid: r.wamid };
    },

    async presencia(phone, lineaId) {
      const wa = (await clienteDeLinea(lineaId)) ?? deps.wa;
      // Sin soporte del proveedor no se inventa nada: null es "no se sabe".
      return (await wa.presencia?.(phone).catch(() => null)) ?? null;
    },

    async send(job) {
      const at = now();
      const contact = await repos.contacts.upsertFromInbound(job.phone);

      // Un visitante de la web: no va por WhatsApp, va a su navegador por el
      // flujo de eventos (ver src/web-visitantes). Sin gates de WhatsApp
      // (no hay numero que proteger); solo se respeta que se haya ido.
      // Un numero del Modulo desarrollador va por el mismo camino: NUNCA sale
      // al WhatsApp real (ni con el modo prueba apagado), no gasta el cupo ni
      // el ritmo del numero y queda en el hilo como enviado. Ver src/desarrollador.
      const dePrueba = process.env.NODE_ENV === 'test' && esNumeroDePrueba(contact.phone);
      if (esContactoWeb(contact.phone) || dePrueba) {
        // Lo de prueba no deja fila en `deliveries`: es de donde salen el cupo
        // diario y por hora, el marcapasos y la salud del numero real, y nada
        // de prueba puede gastarlos ni moverlos. -1 = "sin envio" (como sin conexion).
        const deliveryId = dePrueba ? -1 : await repos.deliveries.create({
          contactId: contact.id,
          campaignId: job.campaignId ?? null,
          kind: job.kind,
          templateName: job.templateName ?? null,
          category: job.category,
          variables: job.variables,
          businessInitiated: false,
        });
        if (contact.optOutAt) {
          const reason = dePrueba ? 'el cliente de prueba pidio no recibir mas mensajes' : 'el visitante pidio no recibir mas mensajes';
          if (!dePrueba) await repos.deliveries.markBlocked(deliveryId, `opt_out: ${reason}`);
          return { ok: false, blocked: true, code: 'opt_out', reason, deliveryId };
        }
        const template = job.kind === 'template' && job.templateName ? await repos.templates.get(job.templateName, job.templateLanguage ?? 'es') : null;
        const wamid = dePrueba ? `prueba:${randomUUID()}` : nuevoIdMensajeWeb('out');
        if (!dePrueba) await repos.deliveries.markSent(deliveryId, wamid);
        // La fila del hilo es lo que el visitante recibe: el flujo de eventos
        // la anuncia (mensaje.enviado) y su navegador la pinta.
        await repos.messages.add({
          contactId: contact.id,
          direction: 'out',
          wamid,
          kind: job.kind === 'freeform' ? 'text' : job.kind === 'media' ? (job.media?.kind ?? 'document') : job.kind,
          body: describeOutgoing(job, template),
          // El visitante de la web ve el fichero por el mismo id que el chat.
          payload: conOrigen(
            job,
            job.location
              ? { location: job.location }
              : job.interactive
                ? { interactive: job.interactive }
                : job.media
                  ? { media: { id: job.media.id, kind: job.media.kind, mimeType: job.media.mimeType, filename: job.media.filename, caption: job.media.caption, bytes: job.media.datos.length, ...(job.media.voz ? { voz: true } : {}) } }
                  : null,
          ),
          status: 'sent',
          deliveryId: dePrueba ? null : deliveryId,
          createdAt: at,
        });
        return { ok: true, wamid, deliveryId };
      }

      // "De este me encargo yo": con el bot callado en este chat no sale nada
      // automatico (respuestas, seguimientos, rutas, campanas), venga de la
      // cola que venga. Lo escrito a mano (manual u origen 'persona', que es lo de la
      // Cloud API) pasa, y el acuse de una ubicacion
      // recibida tambien (regla del dueño, 25/09). No se reintenta: al volver a
      // activar el bot no tiene que salir lo que quedo pendiente durante la pausa.
      if (contact.botPausadoAt && job.manual !== true && job.origen !== 'persona' && job.confirmacionUbicacion !== true && job.traspasaPausa !== true) {
        const deliveryId = await repos.deliveries.create({
          contactId: contact.id,
          campaignId: job.campaignId ?? null,
          kind: job.kind,
          templateName: job.templateName ?? null,
          category: job.category,
          variables: job.variables,
          businessInitiated: false,
        });
        const reason = 'el bot esta callado en este chat: lo atiende una persona';
        await repos.deliveries.markBlocked(deliveryId, `bot_pausado: ${reason}`);
        return { ok: false, blocked: true, code: 'bot_pausado', reason, deliveryId };
      }

      // Sin socket no hay nada que intentar: se devuelve "espera" sin dejar
      // una entrega fallida que el monitor contaria como rechazo de WhatsApp
      // y que el motor de rutas contaria como intento gastado.
      const decidida = await lineaDelTrabajo(job, contact, at);
      const candidata = decidida.linea;
      if (!candidata) {
        return {
          ok: false,
          blocked: true,
          code: 'sin_conexion',
          reason: 'La linea de WhatsApp elegida no esta disponible (no existe, esta deshabilitada o le faltan datos)',
          retryAfterMs: 2 * 60_000,
          deliveryId: -1,
          whatsappNumberId: job.whatsappNumberId ?? null,
        };
      }
      // Sin linea asignada todavia, el reintento vuelve a decidir: la cola no la fija.
      const sinConexion = (l: LineaDeEnvio): SendOutcome => ({
        ok: false,
        blocked: true,
        code: 'sin_conexion',
        reason: `${l.etiqueta ? `La linea «${l.etiqueta}»` : 'WhatsApp'} no esta conectada: se reintenta en cuanto vuelva la sesion`,
        retryAfterMs: 2 * 60_000,
        deliveryId: -1,
        whatsappNumberId: decidida.sinAsignar ? null : l.id || null,
      });
      if (candidata.cliente.conectado?.() === false) return sinConexion(candidata);

      // La lista blanca va por delante de todo, manual incluido: en modo
      // prueba no sale nada a nadie que no este en ella, y queda anotado.
      //
      // La unica excepcion es lo que una persona escribe a mano en un GRUPO:
      // el modo prueba existe para que el sistema no le hable solo a los
      // clientes, y en un grupo el sistema no habla solo nunca. Un grupo
      // tampoco cabe en una lista de numeros.
      const lista = permitidos();
      const grupoAMano = contact.tipo === 'grupo' && job.manual === true;
      if (lista.length && !lista.includes(contact.phone) && !grupoAMano) {
        const deliveryId = await repos.deliveries.create({
          contactId: contact.id,
          campaignId: job.campaignId ?? null,
          kind: job.kind,
          templateName: job.templateName ?? null,
          category: job.category,
          variables: job.variables,
          businessInitiated: false,
          whatsappNumberId: candidata.id || null,
        });
        const reason = `modo prueba: a ${contact.phone} no se le escribe porque no esta en la lista de numeros permitidos`;
        await repos.deliveries.markBlocked(deliveryId, `allowlist: ${reason}`);
        return { ok: false, blocked: true, code: 'allowlist', reason, deliveryId, whatsappNumberId: candidata.id || null };
      }

      // Desde aqui el trabajo queda atado a esta linea: si espera o se reintenta,
      // sale por el mismo numero y no por otro (la cola copia este id al trabajo).
      const linea = (await decidida.confirmar?.()) ?? candidata;
      if (linea !== candidata && linea.cliente.conectado?.() === false) return sinConexion(linea);
      const lineaId = linea.id || null;
      const wa = linea.cliente;
      const phoneId = () => linea.identidad;
      const ventanaAplica = () => linea.ventanaAplica;

      const template =
        job.kind === 'template' && job.templateName
          ? await repos.templates.get(job.templateName, job.templateLanguage ?? 'es')
          : null;

      // Iniciado por la empresa: con plantilla o fuera de la ventana. Es lo
      // que cuenta para el tier de Meta, el warm-up y el marcapasos.
      const businessInitiated = job.kind === 'template' || !isWithinServiceWindow(contact, at);
      const automatico = (businessInitiated || job.programado === true) && job.manual !== true;

      const [numberState, marketingLast7d, sentToday] = await Promise.all([
        repos.numberState.get(phoneId()),
        repos.deliveries.countMarketingSince(contact.id, sevenDaysBefore(at)),
        repos.counters.totalForDay(phoneId(), at),
      ]);

      // Lo que aporta la capa de salud, solo cuando esta y solo para lo
      // automatico: responderle a un cliente no pasa por el marcapasos.
      const politica = deps.politica?.();
      let ritmo: DecisionRitmo | undefined;
      let sentToContactToday: number | undefined;
      let lastSentToContactAt: Date | null | undefined;
      if (automatico && politica) {
        [sentToContactToday, lastSentToContactAt] = await Promise.all([
          repos.deliveries.contarIniciadosAContactoDesde(contact.id, inicioDelDia(at, politica.timezone)),
          repos.deliveries.ultimoEnvioA(contact.id),
        ]);
        if (deps.salud) ritmo = decidirRitmo(await deps.salud.fotoRitmo(contact, at), politica);
      }

      const deliveryId = await repos.deliveries.create({
        contactId: contact.id,
        campaignId: job.campaignId ?? null,
        kind: job.kind,
        templateName: job.templateName ?? null,
        category: job.category,
        variables: job.variables,
        businessInitiated,
        whatsappNumberId: lineaId,
      });

      const decision = evaluateGates(
        { contact, kind: job.kind, category: job.category, template, now: at, manual: job.manual, programado: job.programado },
        {
          sinControlCuenta: politica?.soloRitmo,
          numberState,
          marketingLast7d,
          sentToday,
          dailyCap: dailyCapFor(numberState.warmupStartedOn, at, politica?.warmup ?? warmup),
          maxMarketingPerContact7d,
          serviceWindowApplies: ventanaAplica(),
          sinMarketing: deps.salud?.sinMarketing(),
          fatigaEnvios: politica?.fatigaEnvios,
          sentToContactToday,
          maxPorContactoDia: job.limitesContacto?.maxPorDia ?? politica?.maxPorContactoDia,
          lastSentToContactAt,
          separacionContactoMs: job.limitesContacto?.separacionMs ?? politica?.separacionContactoMs,
          ritmo,
        },
      );

      if (!decision.allow) {
        await repos.deliveries.markBlocked(deliveryId, `${decision.code}: ${decision.reason}`);
        return {
          ok: false,
          blocked: true,
          code: decision.code,
          reason: decision.reason,
          retryAfterMs: decision.retryAfterMs,
          deliveryId,
          whatsappNumberId: lineaId,
        };
      }

      try {
        const result = await limitarEnvio(() => job.manual ? aMano(() => dispatch(wa, job, template)) : job.programado ? envioProgramado(() => dispatch(wa, job, template)) : dispatch(wa, job, template));
        const enviadoAt = now();
        await repos.deliveries.markSent(deliveryId, result.wamid);

        // El chat lee de `messages`: sin esta fila el operador manda algo y no
        // lo ve aparecer en la conversacion.
        await repos.messages.add({
          contactId: contact.id,
          direction: 'out',
          wamid: result.wamid,
          // Un fichero se guarda con su tipo real (foto, video...): es lo que
          // el chat sabe pintar.
          kind: job.kind === 'freeform' ? 'text' : job.kind === 'media' ? (job.media?.kind ?? 'document') : job.kind,
          // Lo que el cliente REALMENTE recibio, si el proveedor lo dice.
          body: result.body ?? describeOutgoing(job, template),
          payload: conOrigen(
            job,
            job.location
              ? { location: job.location }
              : job.interactive
                ? { interactive: job.interactive }
                : job.sticker
                  ? { media: { id: job.sticker.archivo, kind: 'sticker', mimeType: job.sticker.mimeType, url: `/stickers/${job.sticker.archivo}` } }
                  : job.media
                    ? { media: { id: job.media.id, kind: job.media.kind, mimeType: job.media.mimeType, filename: job.media.filename, caption: job.media.caption, bytes: job.media.datos.length, ...(job.media.voz ? { voz: true } : {}) } }
                    : null,
          ),
          status: 'sent',
          deliveryId,
          createdAt: enviadoAt,
          lineaId,
          lineaEtiqueta: linea.etiqueta || null,
          lineaNumero: linea.numero || null,
          // Solo una linea elegida por una persona le cambia la suya al cliente.
          conservarLinea: !decidida.pedida,
        });

        // Solo lo iniciado por la empresa consume cupo diario: responder
        // dentro de la ventana de servicio no gasta warm-up. Y es lo unico
        // que mueve el marcapasos y la cuenta de "sin respuesta" del contacto.
        if (businessInitiated) {
          await repos.counters.increment(phoneId(), job.category, enviadoAt);
          await repos.contacts.anotarEnvioIniciado(contact.id, enviadoAt);
        }
        if (automatico) deps.salud?.marcapasos.anotar(enviadoAt);
        // Una persona acaba de escribir en este chat: el bot se calla (lo atiende ella). Se reactiva a mano.
        if (job.atiendePersona) await repos.contacts.pausarBot(contact.id, true, enviadoAt).catch(() => undefined);

        return { ok: true, wamid: result.wamid, deliveryId, whatsappNumberId: lineaId };
      } catch (error) {
        const retryable = error instanceof WhatsAppApiError ? error.retryable : false;
        const message = error instanceof Error ? error.message : 'error desconocido';
        const rawCode = error instanceof WhatsAppApiError ? error.code : undefined;
        const code = codigoDeError(rawCode, message) ?? (rawCode !== undefined ? String(rawCode) : null);

        // Un fallo del proveedor es un envio que SALIO y volvio con error: se
        // apunta como `failed` con su codigo, que es lo que el monitor mira.
        // No es un bloqueo de guarda propia, donde no salio nada.
        await repos.deliveries.markFailed(deliveryId, code, message);
        if (deps.salud) {
          await deps.salud
            .registrarErrorEnvio({
              codigo: rawCode ?? code,
              mensaje: message,
              contact,
              category: job.category,
              campaignId: job.campaignId ?? null,
            })
            .catch(() => null);
        }
        // Un error que apunta al contacto (no tiene WhatsApp, esta saturado)
        // no se reintenta: insistir es exactamente lo que hay que evitar.
        const insistir = retryable && !NO_REINTENTAR.has(code ?? '');
        // Sin respuesta del proveedor (no es un WhatsAppApiError: red, tiempo
        // agotado) o un 200 sin wamid: puede que el mensaje si saliera.
        const incierto = !(error instanceof WhatsAppApiError) || error.httpStatus === 200;
        return { ok: false, blocked: false, error: message, retryable: insistir, deliveryId, whatsappNumberId: lineaId, code, ...(incierto ? { incierto: true } : {}) };
      }
    },
  };
  // La evaluación y el envío comparten turno: dos motores no pueden aprobar
  // la misma pausa global en paralelo. Las respuestas manuales no esperan.
  let turnoAutomatico: Promise<unknown> = Promise.resolve();
  return { ...puerto, send(job) {
    if (job.manual || !deps.salud || !deps.politica) return puerto.send(job);
    const turno = turnoAutomatico.catch(() => undefined).then(() => puerto.send(job));
    turnoAutomatico = turno.then(() => undefined, () => undefined);
    return turno;
  } };
}

/** Codigos con los que reintentar en la misma cola no tiene sentido. */
const NO_REINTENTAR = new Set(['131026', '131049', '131050', '131056', '130403', '131048', '131031', '368', '403', '131021', '131009']);

/**
 * Como se lee ese mensaje en la conversacion. Una plantilla se guarda ya
 * renderizada: en el chat interesa lo que le llego al cliente, no el nombre
 * de la plantilla ni sus variables sueltas.
 */
function describeOutgoing(
  job: SendJob,
  template: Awaited<ReturnType<Repos['templates']['get']>>,
): string {
  switch (job.kind) {
    case 'template':
      if (!template) return job.templateName ?? 'plantilla';
      try {
        return renderTemplate(template, job.variables ?? []).preview;
      } catch {
        return template.body ?? (job.templateName ?? 'plantilla');
      }
    case 'sticker':
      return '';
    case 'media':
      // Como un adjunto recibido: el pie, o el nombre del documento, o la
      // etiqueta para la lista de chats.
      return job.media?.caption?.trim() || job.media?.filename || { image: '(foto)', video: '(video)', audio: '(audio)', document: '(documento)' }[job.media?.kind ?? 'document'];
    case 'location':
      return job.location
        ? `Ubicacion: ${job.location.name ? `${job.location.name} — ` : ''}${job.location.latitude}, ${job.location.longitude}`
        : 'Ubicacion';
    case 'interactive': {
      // Con las opciones incluidas: en el chat tiene que leerse lo mismo que
      // le llego al cliente, no el cuerpo a secas. Si no, el operador no
      // entiende que significa el "2" que le acaban de contestar.
      const body = job.interactive?.body ?? '';
      const opciones = job.interactive?.buttons ?? [];
      if (opciones.length) {
        const lista = opciones.map((b, i) => `${i + 1}. ${b.title}`).join('\n');
        return `${body}\n\n${lista}`;
      }
      // Sin `body` del proveedor -la Cloud API manda un boton nativo, que no
      // es texto- se anota que se pidio, para que el hilo no parezca cortado.
      return job.interactive?.locationRequest ? `${body}\n\n(se pidio la ubicacion)` : body;
    }
    default:
      return job.text ?? '';
  }
}

async function dispatch(
  wa: WhatsAppClient,
  job: SendJob,
  template: Awaited<ReturnType<Repos['templates']['get']>>,
) {
  switch (job.kind) {
    case 'template': {
      if (!template) throw new TemplateRenderError('plantilla no encontrada');
      const rendered = renderTemplate(template, job.variables ?? []);
      return wa.sendTemplate(job.phone, rendered.name, rendered.language, rendered.components);
    }
    case 'location': {
      if (!job.location) throw new Error('falta el campo location');
      return wa.sendLocation(job.phone, job.location);
    }
    case 'interactive': {
      if (!job.interactive) throw new Error('falta el campo interactive');
      if (job.interactive.locationRequest) {
        return wa.sendLocationRequest(job.phone, job.interactive.body);
      }
      return wa.sendButtons(job.phone, job.interactive.body, job.interactive.buttons ?? []);
    }
    case 'sticker': {
      if (!job.sticker) throw new Error('falta el campo sticker');
      if (!wa.sendSticker) throw new Error('este proveedor no manda stickers');
      return wa.sendSticker(job.phone, { datos: job.sticker.datos, mimeType: job.sticker.mimeType, url: job.sticker.url });
    }
    case 'media': {
      if (!job.media) throw new Error('falta el campo media');
      if (!wa.sendMedia) throw new Error('este proveedor no manda fotos ni archivos');
      // Todo audio sale en mp3, sea cual sea el proveedor (Meta, QR o WAHA): el webm del navegador no lo reproduce nadie.
      // Un mp3 no es nota de voz (eso exige ogg/opus), asi que sale como audio normal.
      const audio = job.media.kind === 'audio' ? await audioParaMeta(job.media).catch((e: unknown) => { throw new Error(e instanceof Error ? e.message : 'no se pudo preparar el audio'); }) : null;
      return wa.sendMedia(job.phone, audio
        ? { kind: 'audio', datos: audio.datos, mimeType: audio.mimeType, filename: audio.filename, voz: false, cita: job.cita }
        : { kind: job.media.kind, datos: job.media.datos, mimeType: job.media.mimeType, filename: job.media.filename, caption: job.media.caption, voz: job.media.voz, cita: job.cita });
    }
    case 'freeform':
    default: {
      if (!job.text) throw new Error('falta el campo text');
      // El cuarto parametro es la cita: los tres clientes la arman a su
      // manera y aqui solo se pasa. Sin cita, es el envio de siempre.
      return wa.sendText(job.phone, job.text, undefined, job.cita);
    }
  }
}
