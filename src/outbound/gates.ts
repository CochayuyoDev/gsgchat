/**
 * Las guardas que mantienen vivo el numero.
 *
 * Son funciones puras sobre una foto del estado para poder probarlas sin
 * base de datos ni red. Van cableadas en el worker: no hay forma de mandar
 * un mensaje saltandoselas, y eso es intencionado. Lo que hunde un numero
 * no es el volumen, es la tasa de bloqueos y reportes; estas reglas atacan
 * exactamente eso.
 */

import type { Contact, NumberState, Template, TemplateCategory } from '../db/repos.js';
import type { DecisionRitmo } from '../salud/ritmo.js';
import { contactoSuprimido } from '../salud/supresion.js';

export type MessageKind = 'template' | 'freeform' | 'location' | 'interactive' | 'sticker';

export interface SendIntent {
  contact: Contact;
  kind: MessageKind;
  category: TemplateCategory;
  template?: Template | null;
  now: Date;
  /**
   * Una persona escribiendo a otra desde /chat, no una campana.
   *
   * Las guardas de abajo existen para que un envio automatico a una lista no
   * queme el numero. Escribirle a alguien a mano no es eso: es lo que hace
   * cualquiera con WhatsApp Web, y pedirle opt-in previo al operador para
   * poder contestar convierte la pantalla en un tramite. Asi que en manual se
   * saltan las guardas de consentimiento y volumen; NO la baja, que es una
   * peticion explicita de una persona, ni el freno de emergencia.
   */
  manual?: boolean;
}

export interface GateSnapshot {
  numberState: NumberState;
  /** Mensajes de marketing entregados a este contacto en los ultimos 7 dias. */
  marketingLast7d: number;
  /** Mensajes iniciados por la empresa ya enviados hoy con este numero. */
  sentToday: number;
  /** Cupo de hoy segun el warm-up. */
  dailyCap: number;
  maxMarketingPerContact7d: number;
  /**
   * Si la ventana de servicio de 24 h aplica.
   *
   * Es una regla de Meta, no una politica nuestra: la Cloud API rechaza el
   * texto libre pasadas 24 h del ultimo mensaje del cliente. Fuera de ella
   * -cliente local, WAHA- esa regla no existe, y aplicarla igual seria
   * inventarse una limitacion que el propio WhatsApp no tiene.
   *
   * Por defecto true: quien no lo diga, se comporta como Meta.
   */
  serviceWindowApplies?: boolean;

  // --- salud del numero (ver src/salud). Todo opcional: sin dato, no aplica. ---

  /** El monitor tiene el marketing en pausa (naranja/rojo o numero en amarillo). */
  sinMarketing?: boolean;
  /** Envios seguidos sin respuesta a partir de los cuales no sale mas marketing. */
  fatigaEnvios?: number;
  /** Mensajes iniciados por la empresa a este contacto hoy, y su techo. */
  sentToContactToday?: number;
  maxPorContactoDia?: number;
  /** Ultimo envio a este contacto y la separacion minima entre dos automaticos. */
  lastSentToContactAt?: Date | null;
  separacionContactoMs?: number;
  /** Lo que dice el marcapasos para este envio (solo iniciados por la empresa). */
  ritmo?: DecisionRitmo;
}

export type GateDecision =
  | { allow: true }
  | { allow: false; reason: string; code: GateCode; retryAfterMs?: number };

export type GateCode =
  | 'allowlist'
  | 'sin_conexion'
  | 'opt_out'
  | 'no_opt_in'
  | 'number_paused'
  | 'number_quality'
  | 'window_closed'
  | 'template_missing'
  | 'template_not_approved'
  | 'template_quality'
  | 'template_paused'
  | 'frequency_cap'
  | 'daily_cap'
  // salud del numero
  | 'contact_suppressed'
  | 'risk_marketing_paused'
  | 'fatigue'
  | 'contact_daily_cap'
  | 'contact_spacing'
  | 'rhythm';

const WINDOW_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** La ventana de servicio de 24 h la abre el ULTIMO mensaje del cliente. */
export function isWithinServiceWindow(contact: Contact, now: Date): boolean {
  if (!contact.lastInboundAt) return false;
  return now.getTime() - contact.lastInboundAt.getTime() < WINDOW_MS;
}

export function sevenDaysBefore(now: Date): Date {
  return new Date(now.getTime() - WEEK_MS);
}

/** Un mensaje iniciado por la empresa: fuera de ventana o con plantilla. */
function isBusinessInitiated(intent: SendIntent): boolean {
  return intent.kind === 'template' || !isWithinServiceWindow(intent.contact, intent.now);
}

export function evaluateGates(intent: SendIntent, snapshot: GateSnapshot): GateDecision {
  const { contact, category, template, now } = intent;

  // 1. Baja. Es la regla que no admite excepciones: un opt-out ignorado se
  //    convierte en bloqueo, y el bloqueo si castiga la calidad del numero.
  if (contact.optOutAt) {
    return { allow: false, code: 'opt_out', reason: 'el contacto se dio de baja' };
  }

  // 2. Circuit breaker manual o automatico sobre el numero.
  if (snapshot.numberState.paused) {
    return {
      allow: false,
      code: 'number_paused',
      reason: snapshot.numberState.pausedReason ?? 'el numero esta pausado',
      retryAfterMs: 30 * 60 * 1000,
    };
  }

  const manual = intent.manual === true;
  const businessInitiated = isBusinessInitiated(intent);

  // 2b. Contacto apartado por el monitor: no tiene WhatsApp, ya recibio
  //     demasiado marketing, o pidio no recibirlo. En manual se deja pasar:
  //     si el operador insiste a mano es porque sabe algo que el sistema no.
  if (!manual && contactoSuprimido(contact, category, now)) {
    const hasta = contact.suprimidoHasta!;
    return {
      allow: false,
      code: 'contact_suppressed',
      reason: `contacto apartado hasta ${hasta.toISOString().slice(0, 16).replace('T', ' ')}: ${
        contact.suprimidoMotivo ?? 'sin motivo anotado'
      }`,
      retryAfterMs: Math.max(60_000, hasta.getTime() - now.getTime()),
    };
  }

  // 3. Sin opt-in no sale nada que inicie la empresa. Responder dentro de la
  //    ventana si vale: ahi fue el cliente quien escribio primero.
  if (!manual && businessInitiated && !contact.optInAt) {
    return {
      allow: false,
      code: 'no_opt_in',
      reason: 'el contacto no tiene opt-in registrado',
    };
  }

  // 4. Fuera de la ventana solo se puede mandar plantilla.
  const ventanaAplica = snapshot.serviceWindowApplies !== false;
  if (!manual && ventanaAplica && intent.kind !== 'template' && !isWithinServiceWindow(contact, now)) {
    return {
      allow: false,
      code: 'window_closed',
      reason: 'la ventana de 24 h esta cerrada: hace falta una plantilla',
    };
  }

  if (intent.kind === 'template') {
    if (!template) {
      return { allow: false, code: 'template_missing', reason: 'la plantilla no existe en el registro' };
    }
    if (template.status !== 'APPROVED') {
      return {
        allow: false,
        code: 'template_not_approved',
        reason: `la plantilla esta en estado ${template.status}`,
      };
    }
    // Meta la pauso (3 h, 6 h): se respeta la pausa aunque el estado local
    // ya diga APPROVED, porque del final de la pausa Meta no avisa.
    if (template.pausadaHasta && template.pausadaHasta.getTime() > now.getTime()) {
      return {
        allow: false,
        code: 'template_paused',
        reason: `Meta tiene la plantilla pausada hasta ${template.pausadaHasta.toISOString().slice(0, 16).replace('T', ' ')}`,
        retryAfterMs: template.pausadaHasta.getTime() - now.getTime(),
      };
    }
    // Una plantilla en amarillo esta a un paso de que Meta la pause sola.
    if (template.quality === 'RED' || (template.quality === 'YELLOW' && category === 'MARKETING')) {
      return {
        allow: false,
        code: 'template_quality',
        reason: `calidad de la plantilla en ${template.quality}`,
      };
    }
  }

  // 5. Calidad del numero. En rojo se corta todo lo iniciado por la empresa;
  //    en amarillo solo se frena marketing, que es lo que mas reportes trae.
  const quality = snapshot.numberState.quality;
  if (businessInitiated) {
    if (quality === 'RED') {
      return {
        allow: false,
        code: 'number_quality',
        reason: 'calidad del numero en ROJO: solo respuestas dentro de ventana',
        retryAfterMs: 6 * 60 * 60 * 1000,
      };
    }
    if (quality === 'YELLOW' && category === 'MARKETING') {
      return {
        allow: false,
        code: 'number_quality',
        reason: 'calidad del numero en AMARILLO: marketing en pausa',
        retryAfterMs: 6 * 60 * 60 * 1000,
      };
    }
  }

  // 5b. El monitor de salud tiene el marketing parado (riesgo naranja o
  //     rojo). Lo transaccional sigue: un aviso de pedido no es lo que trae
  //     reportes.
  if (!manual && businessInitiated && category === 'MARKETING' && snapshot.sinMarketing) {
    return {
      allow: false,
      code: 'risk_marketing_paused',
      reason: 'el monitor de salud tiene el marketing en pausa',
      retryAfterMs: 60 * 60 * 1000,
    };
  }

  // 6. Frecuencia por contacto. Meta ademas limita por su cuenta cuantos
  //    mensajes de marketing recibe una persona; pasarse solo suma bloqueos.
  if (!manual && category === 'MARKETING' && snapshot.marketingLast7d >= snapshot.maxMarketingPerContact7d) {
    return {
      allow: false,
      code: 'frequency_cap',
      reason: `ya recibio ${snapshot.marketingLast7d} mensajes de marketing en 7 dias`,
    };
  }

  // 6b. Fatiga: N mensajes de negocio seguidos sin que conteste nada. Al
  //     siguiente de marketing es cuando la gente bloquea. Se corta en firme
  //     y se levanta solo cuando el contacto escriba (touchInbound lo resetea).
  if (
    !manual &&
    businessInitiated &&
    category === 'MARKETING' &&
    snapshot.fatigaEnvios !== undefined &&
    snapshot.fatigaEnvios > 0 &&
    (contact.sinRespuestaSeguidas ?? 0) >= snapshot.fatigaEnvios
  ) {
    return {
      allow: false,
      code: 'fatigue',
      reason: `lleva ${contact.sinRespuestaSeguidas} mensajes seguidos sin contestar: descansa de marketing hasta que escriba`,
    };
  }

  // 6c. Techo por contacto y dia, y separacion entre dos automaticos al
  //     mismo contacto. Es lo que evita el 131056 de Meta (pair rate limit)
  //     y, en un cliente no oficial, la queja de "me escribe cada rato".
  if (!manual && businessInitiated) {
    if (
      snapshot.maxPorContactoDia !== undefined &&
      snapshot.sentToContactToday !== undefined &&
      snapshot.sentToContactToday >= snapshot.maxPorContactoDia
    ) {
      return {
        allow: false,
        code: 'contact_daily_cap',
        reason: `ya recibio ${snapshot.sentToContactToday} mensajes de negocio hoy (techo ${snapshot.maxPorContactoDia})`,
        retryAfterMs: 6 * 60 * 60 * 1000,
      };
    }
    if (snapshot.separacionContactoMs && snapshot.lastSentToContactAt) {
      const transcurrido = now.getTime() - snapshot.lastSentToContactAt.getTime();
      if (transcurrido < snapshot.separacionContactoMs) {
        return {
          allow: false,
          code: 'contact_spacing',
          reason: `hace ${Math.round(transcurrido / 60_000)} min que se le escribio: se espera la separacion minima`,
          retryAfterMs: snapshot.separacionContactoMs - transcurrido,
        };
      }
    }
  }

  // 7. Techo diario del numero (warm-up).
  if (!manual && businessInitiated && snapshot.sentToday >= snapshot.dailyCap) {
    return {
      allow: false,
      code: 'daily_cap',
      reason: `cupo diario alcanzado (${snapshot.sentToday}/${snapshot.dailyCap})`,
      retryAfterMs: 60 * 60 * 1000,
    };
  }

  // 8. El marcapasos: horario, tier de Meta, cupos por minuto y hora,
  //    contactos nuevos y la pausa entre envios. Va el ultimo porque es el
  //    unico rechazo que no dice nada del contacto: solo "todavia no".
  if (!manual && businessInitiated && snapshot.ritmo && !snapshot.ritmo.ok) {
    return {
      allow: false,
      code: 'rhythm',
      reason: `${snapshot.ritmo.codigo}: ${snapshot.ritmo.motivo}`,
      retryAfterMs: snapshot.ritmo.esperaMs,
    };
  }

  return { allow: true };
}

/** Un rechazo con `retryAfterMs` se reintenta; el resto se descarta. */
export function isRetryable(decision: GateDecision): boolean {
  return !decision.allow && decision.retryAfterMs !== undefined;
}
