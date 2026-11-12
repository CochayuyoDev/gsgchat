/**
 * La nota «Mensaje no llegó al cliente» (pedido del dueño, 12/11).
 *
 * Cuando un mensaje no le llega al cliente, el chat queda con esta nota para
 * que el motorizado (o quien escribio desde GSG) lo sepa y se comunique por su
 * cuenta:
 *
 *   «Mensaje no llegó al cliente, por favor comunícate con tu número personal
 *    por mensaje o llamada de saldo.»
 *
 * Va por EL MISMO CAMINO que las notas de la IA (regla del dueño): es la nota
 * del chat que GSG lee en el historial (`nota` en GET /api/v1/historial, ver
 * src/api/v1/conversaciones-gsg.ts), con `origen: "reglas"`. GSG no necesita
 * nada nuevo.
 *
 * Reglas:
 *  - Es una nota DEL SISTEMA: no esta en el catalogo que la IA usa para
 *    clasificar (la IA no puede ponerla por su cuenta).
 *  - No pisa una nota puesta a mano por una persona.
 *  - Se pone cuando un mensaje escrito por GSG (API 4) no sale, y cuando
 *    WhatsApp avisa despues que no entrego un mensaje (`mensaje.estado` con
 *    llegoAWhatsapp false).
 *  - Nunca tumba a quien la pide: si falla, se anota en el log y sigue.
 */
import type { Repos } from '../db/repos.js';
import type { Bus } from '../eventos/bus.js';
import { numeroNormalizado } from './etiquetar.js';
import { fechaDelNegocio } from '../ajustes/generales.js';

export const CODIGO_NO_LLEGO = 'mensaje_no_llego';
export const NOMBRE_NO_LLEGO = 'Mensaje no llegó al cliente';
export const TEXTO_NO_LLEGO = 'Mensaje no llegó al cliente, por favor comunícate con tu número personal por mensaje o llamada de saldo.';

/**
 * La nota tal como la ve GSG: la misma forma que la `nota` del historial
 * (src/api/v1/conversaciones-gsg.ts). Viaja ademas empujada en el webhook
 * `mensaje.estado` y en la respuesta de la API 4 cuando el mensaje no sale.
 */
export function notaNoLlegoParaGsg(ahora: Date = new Date(), timezone?: string) {
  return {
    codigo: CODIGO_NO_LLEGO,
    nombre: NOMBRE_NO_LLEGO,
    descripcion: TEXTO_NO_LLEGO,
    dia: fechaDelNegocio(ahora, timezone || 'America/Lima'),
    origen: 'reglas' as const,
    actualizadaEn: ahora.toISOString(),
  };
}

export interface DepsNotaNoLlego {
  repos: Pick<Repos, 'chatEtiquetas' | 'contacts' | 'messages'>;
  /** Zona horaria del negocio: la nota es del dia del negocio, como las de la IA. */
  timezone?: string;
  ahora?: () => Date;
  log?: (mensaje: string, detalle?: Record<string, unknown>) => void;
}

/** Pone la nota en el chat de ese telefono. Devuelve si quedo puesta. */
export async function anotarMensajeNoLlego(deps: DepsNotaNoLlego, phone: string, porQue?: string | null): Promise<boolean> {
  const etiquetas = deps.repos.chatEtiquetas;
  if (!etiquetas || !phone) return false;
  try {
    const ahora = deps.ahora?.() ?? new Date();
    const numero = numeroNormalizado(phone);
    const dia = fechaDelNegocio(ahora, deps.timezone || 'America/Lima');
    const ya = (await etiquetas.delDia(dia, [numero]))[0];
    // Lo que una persona puso a mano manda.
    if (ya?.origen === 'manual') return false;
    const motivo = porQue ? String(porQue).replace(/\s+/g, ' ').trim().slice(0, 300) : null;
    await etiquetas.guardar({ phone: numero, dia, etiqueta: CODIGO_NO_LLEGO, origen: 'reglas', huella: `mensaje-no-llego-${ahora.getTime()}`, mensajes: ya?.mensajes ?? 0, motivo, loteId: null });
    await etiquetas.registrar({ loteId: null, phone: numero, fase: 'analisis', nivel: 'aviso', codigo: 'etiqueta_bot', detalle: `El sistema puso «${CODIGO_NO_LLEGO}»: un mensaje no le llegó al cliente${motivo ? ` (${motivo})` : ''}.` });
    return true;
  } catch (error) {
    deps.log?.('no se pudo poner la nota «mensaje no llegó»', { detalle: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/**
 * Escucha `mensaje.estado`: un mensaje que WhatsApp no entrego (failed) deja la
 * nota en su chat. Devuelve la funcion que deja de escuchar.
 */
export function vigilarNotaNoLlego(bus: Bus, deps: DepsNotaNoLlego): () => void {
  return bus.escuchar('mensaje.estado', async (ev) => {
    if (ev.llegoAWhatsapp !== false) return;
    try {
      const ref = await deps.repos.messages.referenciaVisiblePorWamid(ev.mensajeId, new Date(0));
      if (!ref) return;
      const contacto = await deps.repos.contacts.getById(ref.contactId);
      if (!contacto?.phone) return;
      await anotarMensajeNoLlego(deps, contacto.phone, ev.error?.motivo ?? null);
    } catch (error) {
      deps.log?.('no se pudo revisar un mensaje no entregado para la nota', { detalle: error instanceof Error ? error.message : String(error) });
    }
  });
}
