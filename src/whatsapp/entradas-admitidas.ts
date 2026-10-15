import type { InboundMessage } from './types.js';

/** Los controles actualizan texto/ubicaciones; nunca descargan archivos. */
const TIPOS = new Set(['text', 'location', 'livelocation', 'interactive', 'button', 'reaction', 'revoke']);
export function entradaAdmitida(message: Pick<InboundMessage, 'type'>): boolean {
  return TIPOS.has(message.type);
}

/** Se aplica al socket antes de resolver contactos o descargar contenido. */
export function contenidoLocalAdmitido(contenido: Record<string, unknown>): boolean {
  return typeof contenido.conversation === 'string'
    || Boolean((contenido.extendedTextMessage as { text?: unknown } | undefined)?.text)
    || ['locationMessage', 'liveLocationMessage', 'buttonsResponseMessage', 'templateButtonReplyMessage', 'listResponseMessage', 'interactiveResponseMessage', 'reactionMessage'].some(key => Boolean(contenido[key]))
    || Boolean((contenido.protocolMessage as { key?: { id?: string }; type?: unknown } | undefined)?.key?.id && [0, 'REVOKE'].includes((contenido.protocolMessage as { type: number | string }).type));
}
