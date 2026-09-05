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

export type MessageKind = 'template' | 'freeform' | 'location' | 'interactive';

export interface SendIntent {
  contact: Contact;
  kind: MessageKind;
  category: TemplateCategory;
  template?: Template | null;
  now: Date;
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
}

export type GateDecision =
  | { allow: true }
  | { allow: false; reason: string; code: GateCode; retryAfterMs?: number };

export type GateCode =
  | 'opt_out'
  | 'no_opt_in'
  | 'number_paused'
  | 'number_quality'
  | 'window_closed'
  | 'template_missing'
  | 'template_not_approved'
  | 'template_quality'
  | 'frequency_cap'
  | 'daily_cap';

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

  const businessInitiated = isBusinessInitiated(intent);

  // 3. Sin opt-in no sale nada que inicie la empresa. Responder dentro de la
  //    ventana si vale: ahi fue el cliente quien escribio primero.
  if (businessInitiated && !contact.optInAt) {
    return {
      allow: false,
      code: 'no_opt_in',
      reason: 'el contacto no tiene opt-in registrado',
    };
  }

  // 4. Fuera de la ventana solo se puede mandar plantilla.
  if (intent.kind !== 'template' && !isWithinServiceWindow(contact, now)) {
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

  // 6. Frecuencia por contacto. Meta ademas limita por su cuenta cuantos
  //    mensajes de marketing recibe una persona; pasarse solo suma bloqueos.
  if (category === 'MARKETING' && snapshot.marketingLast7d >= snapshot.maxMarketingPerContact7d) {
    return {
      allow: false,
      code: 'frequency_cap',
      reason: `ya recibio ${snapshot.marketingLast7d} mensajes de marketing en 7 dias`,
    };
  }

  // 7. Techo diario del numero (warm-up).
  if (businessInitiated && snapshot.sentToday >= snapshot.dailyCap) {
    return {
      allow: false,
      code: 'daily_cap',
      reason: `cupo diario alcanzado (${snapshot.sentToday}/${snapshot.dailyCap})`,
      retryAfterMs: 60 * 60 * 1000,
    };
  }

  return { allow: true };
}

/** Un rechazo con `retryAfterMs` se reintenta; el resto se descarta. */
export function isRetryable(decision: GateDecision): boolean {
  return !decision.allow && decision.retryAfterMs !== undefined;
}
