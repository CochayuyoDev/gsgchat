/**
 * La ventana de llegada de un pedido (regla del dueño: GSGchat nunca le pide
 * nada a GSG; la información vive aquí). Al cliente se le dice una hora
 * aproximada por distrito: «Ancón de 6 a 8 de la noche, Jesús María de 3 a 5
 * de la tarde, Comas de 5 a 7 de la noche».
 *
 * Quién manda, en orden:
 *   1. la ventana que GSG mandó para ESE pedido (datosEnvio.horarioEntrega*);
 *   2. la del distrito del pedido en `horariosPorDistrito` (el distrito que
 *      trae el pedido o, si no, el que se nombra en su dirección);
 *   3. el horario general (`horarioEntregas`).
 *
 * Todo lo que enseña el horario (los textos al cliente y el contexto de la
 * IA) pasa por `ventanaDeEntrega`: así nunca se dicen dos horarios distintos.
 */

import { distritoDePedido } from './distritos-centro.js';
import { horaEnPalabras, horarioEnPalabras, type AjustesEntregas } from './textos.js';
import type { DatosEnvio } from './repo.js';

export type FuenteHorario = 'gsg' | 'distrito' | 'general';

export interface VentanaEntrega {
  /** "HH:MM" del reloj del negocio. */
  desde: string;
  hasta: string;
  /** Hasta dónde se puede estirar «por algunas casuísticas». */
  extendidoHasta: string;
  fuente: FuenteHorario;
  /** El distrito del pedido con su nombre de siempre (aunque la ventana no salga de él), o null. */
  distrito: string | null;
  /** Solo en una ventana fechada de GSG. */
  fechaDesde: string | null;
  fechaHasta: string | null;
  zonaHoraria: string | null;
}

/** Lo justo de un pedido para saber su ventana. */
export interface PedidoConHorario {
  distrito?: string | null;
  direccion?: string | null;
  datosEnvio?: DatosEnvio | null;
}

const masTarde = (a: string, b: string): string => (a >= b ? a : b);

/** La ventana de llegada de un pedido: la de GSG, si no la de su distrito, si no la general. */
export function ventanaDeEntrega(e: PedidoConHorario | null | undefined, ajustes: Pick<AjustesEntregas, 'horarioEntregas'> & { horariosPorDistrito?: AjustesEntregas['horariosPorDistrito'] }): VentanaEntrega {
  const general = ajustes.horarioEntregas;
  const distrito = e ? distritoDePedido(e) : null;
  const d = e?.datosEnvio;
  if (d?.horarioEntregaDesde && d.horarioEntregaHasta) {
    return {
      desde: d.horarioEntregaDesde,
      hasta: d.horarioEntregaHasta,
      extendidoHasta: d.horarioEntregaHasta,
      fuente: 'gsg',
      distrito,
      fechaDesde: d.horarioEntregaFechaDesde ?? null,
      fechaHasta: d.horarioEntregaFechaHasta ?? null,
      zonaHoraria: d.horarioEntregaZonaHoraria ?? null,
    };
  }
  const fila = distrito ? (ajustes.horariosPorDistrito ?? []).find((f) => f.distrito === distrito) : undefined;
  if (fila) {
    // El «se puede extender» sigue siendo el del negocio, nunca antes del fin de la ventana.
    return { desde: fila.desde, hasta: fila.hasta, extendidoHasta: masTarde(fila.hasta, general.extendidoHasta), fuente: 'distrito', distrito, fechaDesde: null, fechaHasta: null, zonaHoraria: null };
  }
  return { desde: general.desde, hasta: general.hasta, extendidoHasta: general.extendidoHasta, fuente: 'general', distrito, fechaDesde: null, fechaHasta: null, zonaHoraria: null };
}

/** Las variables {desde}, {hasta}, {hastaExtendido} y {horario} de los textos al cliente. */
export function variablesDeVentana(v: VentanaEntrega): { desde: string; hasta: string; hastaExtendido: string; horario: string } {
  const desde = horaEnPalabras(v.desde) + (v.fechaDesde ? ` del ${v.fechaDesde}` : '');
  const hasta = horaEnPalabras(v.hasta) + (v.fechaHasta ? ` del ${v.fechaHasta}${v.zonaHoraria ? ` (${v.zonaHoraria})` : ''}` : '');
  return {
    desde,
    hasta,
    hastaExtendido: horaEnPalabras(v.extendidoHasta),
    // Con fechas de por medio no se acorta: «de 6:00 PM del 2026-10-11 a ...».
    horario: v.fechaDesde || v.fechaHasta ? `de ${desde} a ${hasta}` : horarioEnPalabras(v.desde, v.hasta),
  };
}

/** De dónde sale la ventana, dicho para la IA. */
export function fuenteEnPalabras(v: VentanaEntrega): string {
  if (v.fuente === 'gsg') return 'la ventana que GSG mandó para este pedido';
  if (v.fuente === 'distrito') return `el horario por distrito de ${v.distrito}`;
  return v.distrito ? `el horario general (${v.distrito} no tiene horario propio)` : 'el horario general (no se sabe el distrito del pedido)';
}
