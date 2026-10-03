/**
 * El primer mensaje de un pedido: el que le pide al cliente su ubicación (lo
 * manda el reparto) o su SÍ/NO (lo manda el motor de entregas).
 *
 * El pedido y su mensaje van por separado: el pedido se guarda primero y su
 * mensaje puede fallar sin que el pedido se pierda. Cada pedido lleva el
 * estado de su primer mensaje en la base (migración 002), y con eso:
 *
 *   no_aplica    no hay nada que mandarle (ni ubicación ni confirmación).
 *   retenido     espera «Confirmar y enviar» (ajuste de la tienda): NO sale.
 *   pendiente    toca dispararlo (ponerlo en el reparto o en la cola de confirmación).
 *   encolado     ya está en la cola de su motor; sale con el ritmo de siempre.
 *   enviando     el motor lo está mandando ahora mismo.
 *   enviado      WhatsApp lo aceptó (hay wamid).
 *   reintentando un fallo pasajero: vuelve a intentarse solo a `mensajeProximoAt`.
 *   fallido      un fallo que no se arregla insistiendo (teléfono inválido, sin
 *                WhatsApp, sin plantilla) o se agotaron los reintentos: a la bandeja.
 *   incierto     no se sabe si llegó (la red se cortó con el envío en el aire, o
 *                el proceso se reinició a mitad). NO se reenvía solo: una persona
 *                mira el chat y decide.
 *
 * Los cambios de estado son condicionales (repo.cambiarMensaje): dos intentos a
 * la vez —dos procesos, un doble clic, el motor y una persona— no pueden mandar
 * dos veces el mismo mensaje.
 */

import type { SendOutcome } from '../outbound/sender.js';
import { incidenciaDeErrorDeEnvio } from '../rutas/incidencias.js';
import type { Entrega, EstadoMensaje } from './repo.js';

/** Reintentos automáticos de un fallo pasajero: cuántos y con qué espera (exponencial, con techo). */
export interface ReintentosMensaje {
  /** Reintentos automáticos seguidos antes de pasarlo a la bandeja. */
  maximo: number;
  /** Espera antes del primer reintento (segundos); cada siguiente, el doble. */
  esperaBaseSeg: number;
  /** Techo de la espera entre reintentos (segundos). */
  esperaMaxSeg: number;
}

export const REINTENTOS_POR_DEFECTO: ReintentosMensaje = { maximo: 5, esperaBaseSeg: 60, esperaMaxSeg: 30 * 60 };

/** Cuánto esperar antes del reintento número `n` (1, 2, 3...): base, 2·base, 4·base... hasta el techo. */
export function esperaDelReintento(n: number, cfg: ReintentosMensaje, minimoMs = 0): number {
  const exponente = Math.max(0, Math.min(20, n - 1));
  const ms = Math.min(cfg.esperaMaxSeg * 1000, cfg.esperaBaseSeg * 1000 * 2 ** exponente);
  return Math.max(ms, minimoMs);
}

/** Lo que pasó con un intento, ya clasificado. */
export type Desenlace =
  | { tipo: 'enviado'; wamid: string | null }
  /** Pasajero: se reintenta solo. `cuenta`: si gastó un intento real (una guarda propia que frenó el envío no lo gasta). */
  | { tipo: 'transitorio'; codigo: string; motivo: string; esperaMinMs?: number; cuenta: boolean }
  | { tipo: 'permanente'; codigo: string; motivo: string }
  | { tipo: 'incierto'; codigo: string; motivo: string };

type SalidaEnvio = SendOutcome | { ok: false; sinPlantilla: true; reason: string };

const GUARDAS_PERMANENTES = new Set(['opt_out', 'no_opt_in', 'allowlist', 'window_closed', 'template_missing', 'template_not_approved', 'template_paused', 'regla_gsg']);

/** Clasifica lo que devolvió el sender. */
export function desenlaceDeEnvio(salida: SalidaEnvio): Desenlace {
  if (salida.ok) return { tipo: 'enviado', wamid: salida.wamid ?? null };
  if ('sinPlantilla' in salida) return { tipo: 'permanente', codigo: 'sin_plantilla', motivo: salida.reason };
  if (salida.blocked) {
    if (salida.code === 'contact_suppressed' && /131026|no tiene whatsapp/i.test(salida.reason)) return { tipo: 'permanente', codigo: 'sin_whatsapp', motivo: salida.reason };
    if (GUARDAS_PERMANENTES.has(salida.code)) return { tipo: 'permanente', codigo: salida.code, motivo: salida.reason };
    // Sin conexion, ritmo, cupo, calidad del numero...: nada salio, se espera y se vuelve.
    return { tipo: 'transitorio', codigo: salida.code, motivo: salida.reason, esperaMinMs: salida.retryAfterMs, cuenta: false };
  }
  if (salida.incierto) return { tipo: 'incierto', codigo: 'resultado_incierto', motivo: salida.error };
  const incidencia = incidenciaDeErrorDeEnvio(salida.error, salida.code);
  if (incidencia === 'sin_whatsapp' || incidencia === 'numero_invalido') return { tipo: 'permanente', codigo: incidencia, motivo: salida.error };
  if (salida.retryable) return { tipo: 'transitorio', codigo: salida.code ? `whatsapp_${salida.code}` : 'whatsapp_temporal', motivo: salida.error, cuenta: true };
  return { tipo: 'permanente', codigo: salida.code ? `rechazado_${salida.code}` : 'rechazado', motivo: salida.error };
}

/** El motivo en palabras para la bandeja: qué pasó y qué hacer. */
export function motivoLegible(codigo: string | null | undefined, detalle?: string | null): string {
  const c = codigo ?? '';
  const extra = detalle ? ` (${detalle.slice(0, 160)})` : '';
  if (c === 'numero_invalido' || c === 'telefono_invalido') return `El teléfono no es válido: corrígelo en GSG y vuelve a mandar el pedido.${extra}`;
  if (c === 'sin_whatsapp') return 'Ese número no tiene WhatsApp: hay que llamar al cliente o corregir el teléfono.';
  if (c === 'sin_plantilla' || c.startsWith('template_') || c === 'window_closed') return `Falta una plantilla aprobada para escribirle fuera de las 24 h: elige una en Hoy → Ajustes → Plantillas.${extra}`;
  if (c === 'opt_out' || c === 'no_opt_in') return 'El cliente pidió no recibir mensajes: no se le escribe.';
  if (c === 'allowlist') return 'El modo prueba está activo y este número no está en la lista de prueba.';
  if (c === 'regla_gsg') return 'La regla «Solo lo de GSG» no deja salir este mensaje.';
  if (c === 'sin_conexion') return 'WhatsApp está desconectado: se reintenta solo en cuanto vuelva.';
  if (c === 'resultado_incierto') return `No se sabe si le llegó: el envío se cortó a mitad. Revisa su chat antes de reintentar.${extra}`;
  if (c === 'reintentos_agotados') return `WhatsApp falló varias veces seguidas y se dejó de reintentar solo.${extra}`;
  if (c === 'no_encolado') return `No se pudo poner en la cola del reparto: se reintenta solo.${extra}`;
  if (c.startsWith('whatsapp_')) return `WhatsApp no pudo enviarlo ahora (fallo pasajero): se reintenta solo.${extra}`;
  if (c.startsWith('rechazado')) return `WhatsApp rechazó el mensaje.${extra}`;
  if (['frequency_cap', 'daily_cap', 'contact_daily_cap', 'contact_spacing', 'rhythm', 'fatigue', 'number_paused', 'number_quality', 'risk_marketing_paused', 'contact_suppressed'].includes(c)) return `Las guardas del número lo frenaron por ahora (ritmo o cupo): sale solo más tarde.${extra}`;
  return detalle ? detalle.slice(0, 300) : 'Falló el envío del mensaje.';
}

/** Los estados en los que hay un intento en marcha o programado: el botón «Reintentar» espera. */
export const MENSAJE_EN_CURSO: readonly EstadoMensaje[] = ['pendiente', 'encolado', 'enviando', 'reintentando'];
/** Desde donde una persona puede pedir otro intento. */
export const MENSAJE_REINTENTABLE: readonly EstadoMensaje[] = ['fallido', 'incierto'];

/** Lo que la pantalla y la API enseñan del primer mensaje de un pedido. */
export interface VistaMensaje {
  estado: EstadoMensaje;
  via: Entrega['mensajeVia'];
  intentos: number;
  ultimoIntentoEn: string | null;
  proximoIntentoEn: string | null;
  enviadoEn: string | null;
  codigo: string | null;
  motivo: string | null;
  permanente: boolean;
  puedeReintentar: boolean;
  /** Si el reintento necesita que alguien confirme que el cliente no lo recibió. */
  requiereConfirmar: boolean;
}

export function vistaMensaje(e: Entrega): VistaMensaje {
  const estado = e.mensajeEstado ?? 'no_aplica';
  return {
    estado,
    via: e.mensajeVia ?? null,
    intentos: e.mensajeIntentos ?? 0,
    ultimoIntentoEn: e.mensajeUltimoIntentoAt ? e.mensajeUltimoIntentoAt.toISOString() : null,
    proximoIntentoEn: e.mensajeProximoAt && (estado === 'reintentando' || estado === 'pendiente') ? e.mensajeProximoAt.toISOString() : null,
    enviadoEn: e.mensajeEnviadoAt ? e.mensajeEnviadoAt.toISOString() : null,
    codigo: e.mensajeErrorCodigo ?? null,
    motivo: e.mensajeErrorCodigo ? motivoLegible(e.mensajeErrorCodigo, e.mensajeError) : null,
    permanente: Boolean(e.mensajePermanente),
    puedeReintentar: MENSAJE_REINTENTABLE.includes(estado),
    requiereConfirmar: estado === 'incierto',
  };
}
