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

/** Lo que un motorizado escribe por WhatsApp: el comando y, si lo dice, de qué pedido. */
export interface ComandoDeMotorizado {
  /**
   * Lo que nombra el pedido: tracking, referencia o teléfono del cliente
   * («proceder cambio de ubicación GSG-123», «P-1001 proceder cambio»).
   * Vacío = no dijo cuál.
   */
  senas: string[];
}

/** Palabras de relleno alrededor de la seña: «del pedido», «tracking», «cliente», «nro». */
const RELLENO = new Set(['de', 'del', 'el', 'la', 'al', 'a', 'para', 'pedido', 'pedidos', 'tracking', 'trackings', 'guia', 'cliente', 'clientes', 'nro', 'num', 'numero', 'n', 'y', 'e', 'por', 'favor', 'porfa', 'pf', 'pls', 'gracias']);

/**
 * El comando escrito por un motorizado (por WhatsApp, a la línea de GSGchat).
 * A diferencia del chat del panel, aquí no hay un cliente abierto: el
 * motorizado puede decir de qué pedido es con el tracking, la referencia o el
 * teléfono del cliente, antes o después del comando. Cualquier otra palabra
 * («puedes proceder cambio de ubicación?») deja de ser el comando.
 * Con o sin tildes, mayúsculas, «a»/«al», signos o emojis alrededor.
 */
export function leerComandoDeMotorizado(texto: string | null | undefined): ComandoDeMotorizado | null {
  if (!texto) return null;
  if (texto.length > 200) return null;
  if (esComandoCambioUbicacion(texto)) return { senas: [] };
  // Igual que `plano`, pero sin borrar guiones: «P-1001» y «GSG-123» son señas.
  const t = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const m = /(^|\s)proceder (?:(?:a|al|con el|con) )?(?:el )?cambio(?: de ubicacion)?(?=\s|$)/.exec(t);
  if (!m) return null;
  const resto = `${t.slice(0, m.index)} ${t.slice(m.index + m[0].length)}`;
  const palabras = resto.split(/\s+/).map((p) => p.replace(/^-+|-+$/g, '')).filter(Boolean);
  const senas: string[] = [];
  for (const p of palabras) {
    if (RELLENO.has(p)) continue;
    // Una seña lleva al menos un número (P-1001, GSG-123, 987601455).
    if (!/\d/.test(p) || p.length < 3) return null;
    senas.push(p);
  }
  return { senas: [...new Set(senas)] };
}
