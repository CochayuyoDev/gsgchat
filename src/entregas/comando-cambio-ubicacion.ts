/**
 * «proceder cambio de ubicación» (pedido del dueño, 08/11): el comando con el
 * que una persona de este lado -quien atiende en el chat del panel, un usuario
 * o motorizado de GSG en su chat, o quien escribe desde el teléfono conectado-
 * da por bueno el cambio de ubicación de un cliente. El sistema toma la última
 * ubicación que el cliente mandó por WhatsApp y la registra en sus pedidos,
 * aunque haya pasado la hora límite o ya no le queden cambios.
 *
 * El CLIENTE nunca lo dispara: lo que entra de un cliente no pasa por aquí.
 *
 * Solo vale el mensaje entero (con o sin tildes, mayúsculas o el «a»): dentro
 * de una frase más larga es un mensaje normal.
 */

/** Lo que devuelve el comando a quien lo escribió (el panel lo enseña; la API de GSG lo devuelve). */
export interface ResultadoComandoCambio {
  ok: boolean;
  /**
   * cambiada: se registró la última ubicación del cliente.
   * sin_pedidos: ese número no tiene pedidos en curso.
   * sin_ubicacion: el cliente no ha mandado ninguna ubicación para sus pedidos.
   * sin_cambio: la última que mandó ya es la registrada.
   */
  resultado: 'cambiada' | 'sin_pedidos' | 'sin_ubicacion' | 'sin_cambio';
  /** En palabras, para quien lo escribió. */
  mensaje: string;
  referencias?: string[];
  lat?: number;
  lng?: number;
  mapa?: string;
}

/** Un atajo de comando del chat: no se le manda al cliente, lo ejecuta el sistema. */
export interface ComandoChat {
  /** Lo que se escribe después de «/». */
  atajo: string;
  /** El texto del comando (lo que se manda). */
  texto: string;
  /** El rótulo de la pastilla. */
  etiqueta: string;
  /** Qué hace, en palabras. */
  descripcion: string;
}

export const TEXTO_COMANDO_CAMBIO = 'proceder cambio de ubicación';

export const COMANDOS_CHAT: ComandoChat[] = [
  {
    atajo: 'cambio',
    texto: TEXTO_COMANDO_CAMBIO,
    etiqueta: '📍 Proceder cambio de ubicación',
    descripcion: 'Toma la última ubicación que mandó el cliente y la registra en sus pedidos de hoy (GSG y el motorizado se enteran). No se le manda al cliente.',
  },
];

const plano = (texto: string): string =>
  texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * «proceder cambio de ubicación», «proceder a cambio de ubicación», «proceder
 * al cambio de ubicación», «proceder cambio» (y «/cambio», el atajo). Con
 * signos o emojis alrededor también vale; con más palabras, no.
 */
export function esComandoCambioUbicacion(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const t = plano(texto);
  if (!t || t.length > 60) return false;
  if (t === 'cambio' && /^\s*\/\s*cambio\s*$/i.test(texto)) return true;
  return /^proceder (?:(?:a|al|con el|con) )?(?:el )?cambio(?: de ubicacion)?$/.test(t);
}
