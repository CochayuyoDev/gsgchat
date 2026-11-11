/**
 * ¿Le llegó el mensaje al WhatsApp del cliente? La respuesta única que
 * comparten la API (historial de GSG, envíos), el evento `mensaje.estado` y
 * el chat.
 *
 * Por qué hace falta: un mensaje se guarda en el hilo en cuanto el proveedor
 * lo ACEPTA (Meta devuelve su id, el WhatsApp normal lo pone en cola). Eso no
 * significa que llegara: Meta puede rechazarlo minutos después (fuera de la
 * ventana de 24 h, límite de marketing, número sin WhatsApp...) y ese rechazo
 * llega por el webhook como `failed`. Antes el historial devolvía la fila tal
 * cual y quien lo leía (GSG) lo pintaba como enviado aunque nunca llegó.
 *
 * Los estados guardados (los de Meta, que los tres proveedores comparten):
 *   sent      → WhatsApp lo tiene, el teléfono del cliente aún no confirmó (un check).
 *   delivered → llegó al teléfono del cliente (dos checks).
 *   read      → el cliente lo abrió.
 *   failed    → WhatsApp no lo entregó; el porqué va en `deliveries`.
 *   null/otro → sin confirmación todavía.
 *
 * Nunca lanza: con datos raros o incompletos responde «sin confirmar», que es
 * la única respuesta honesta cuando no se sabe.
 */

import { errorDeEnvio, type ErrorDeEnvio } from './errores-envio.js';

export type EstadoEntrega =
  /** El proveedor lo aceptó, pero WhatsApp todavía no confirmó nada. */
  | 'sin_confirmar'
  /** WhatsApp lo recibió; el teléfono del cliente aún no confirmó (un check). */
  | 'enviado'
  /** Llegó al WhatsApp del cliente (dos checks). */
  | 'entregado'
  /** El cliente lo abrió (dos checks azules). */
  | 'leido'
  /** WhatsApp no se lo entregó al cliente: ver `error`. */
  | 'no_entregado';

export interface EntregaDelMensaje {
  /**
   * La respuesta corta: ¿llegó al WhatsApp del cliente?
   *   true  = sí (entregado o leído)
   *   false = no, y no va a llegar (WhatsApp lo rechazó)
   *   null  = todavía no se sabe (esperando la confirmación de WhatsApp)
   */
  llegoAWhatsapp: boolean | null;
  estado: EstadoEntrega;
  /** Lo mismo, en palabras, para enseñarlo tal cual. */
  descripcion: string;
  /**
   * Minutos que lleva sin confirmación. Solo en `sin_confirmar` y `enviado`;
   * null en los demás. Sirve para avisar de un mensaje que se quedó colgado.
   */
  minutosSinConfirmar: number | null;
  /** Con `no_entregado`: código, motivo, qué hacer y si conviene reintentar. */
  error: ErrorDeEnvio | null;
}

/** A partir de cuántos minutos sin confirmación se avisa de que algo va mal. */
export const MINUTOS_SIN_CONFIRMAR_PREOCUPANTE = 30;

const DESCRIPCIONES: Record<EstadoEntrega, string> = {
  sin_confirmar: 'Salió hacia WhatsApp; esperando la confirmación de que lo recibió.',
  enviado: 'WhatsApp lo recibió; todavía no confirma que llegó al teléfono del cliente.',
  entregado: 'Llegó al WhatsApp del cliente.',
  leido: 'Llegó al WhatsApp del cliente y lo abrió.',
  no_entregado: 'No le llegó: WhatsApp no se lo entregó al cliente.',
};

function minutosDesde(fecha: Date | string | null | undefined, ahora: Date): number | null {
  if (!fecha) return null;
  const t = fecha instanceof Date ? fecha.getTime() : new Date(fecha).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((ahora.getTime() - t) / 60_000));
}

function conEspera(base: string, minutos: number | null): string {
  if (minutos === null || minutos < MINUTOS_SIN_CONFIRMAR_PREOCUPANTE) return base;
  const cuanto = minutos >= 120 ? `${Math.floor(minutos / 60)} horas` : `${minutos} minutos`;
  return `${base} Lleva ${cuanto} así: puede que el teléfono esté apagado o sin internet, o que el número ya no use WhatsApp.`;
}

/**
 * El estado de entrega de un mensaje SALIENTE. Para uno entrante devuelve null
 * (lo mandó el cliente: ya está aquí).
 *
 * `error` es lo apuntado en el envío (código y título de Meta, o el bloqueo
 * interno); si falta con un `failed`, se dice que no quedó el motivo.
 */
export function entregaDelMensaje(
  m: { direction: string; status: string | null | undefined; createdAt?: Date | string | null },
  error?: ErrorDeEnvio | { code?: string | null; title?: string | null } | null,
  ahora: Date = new Date(),
): EntregaDelMensaje | null {
  if (m.direction !== 'out') return null;
  const status = typeof m.status === 'string' ? m.status.trim().toLowerCase() : '';

  if (status === 'failed' || status === 'blocked_by_gate') {
    const explicado = explicarError(error);
    return {
      llegoAWhatsapp: false,
      estado: 'no_entregado',
      descripcion: `${DESCRIPCIONES.no_entregado} ${explicado.motivo}`,
      minutosSinConfirmar: null,
      error: explicado,
    };
  }
  if (status === 'read' || status === 'played') {
    return { llegoAWhatsapp: true, estado: 'leido', descripcion: DESCRIPCIONES.leido, minutosSinConfirmar: null, error: null };
  }
  if (status === 'delivered') {
    return { llegoAWhatsapp: true, estado: 'entregado', descripcion: DESCRIPCIONES.entregado, minutosSinConfirmar: null, error: null };
  }
  const minutos = minutosDesde(m.createdAt, ahora);
  const estado: EstadoEntrega = status === 'sent' ? 'enviado' : 'sin_confirmar';
  return { llegoAWhatsapp: null, estado, descripcion: conEspera(DESCRIPCIONES[estado], minutos), minutosSinConfirmar: minutos, error: null };
}

function esErrorExplicado(e: unknown): e is ErrorDeEnvio {
  return Boolean(e && typeof e === 'object' && 'motivo' in e && 'queHacer' in e && 'codigo' in e);
}

function explicarError(error: ErrorDeEnvio | { code?: string | null; title?: string | null } | null | undefined): ErrorDeEnvio {
  if (esErrorExplicado(error)) return error;
  try {
    const e = error ? errorDeEnvio(error.code ?? null, error.title ?? null) : null;
    if (e) return e;
  } catch {
    // El catálogo no debería fallar; si falla, se responde igual sin motivo.
  }
  return {
    codigo: 'desconocido',
    tipo: 'meta',
    titulo: null,
    motivo: 'WhatsApp no dio el motivo.',
    queHacer: 'Confirmar el número con el cliente por llamada y volver a escribirle desde GSGchat.',
    reintentar: 'no',
  };
}
