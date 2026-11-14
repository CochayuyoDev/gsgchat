import type { InboundMessage } from './types.js';

/**
 * Lo que se recibe: texto, ubicaciones y controles, y las fotos, audios y
 * videos del cliente (regla del dueño, 28/10: GSG los ve y los escucha desde el
 * historial) y sus stickers. Los documentos y demas se ignoran antes de descargarse.
 * Una foto, un audio, un video o un sticker se guarda en el chat y nada mas: no se
 * transcribe, no se contesta y no mueve el pedido (ver src/handlers/inbound.ts).
 */
/** Los adjuntos que se reciben (y se guardan, sin contestar). */
const MEDIA_ADMITIDA = new Set(['image', 'audio', 'video', 'sticker']);
const TIPOS = new Set(['text', 'location', 'livelocation', 'interactive', 'button', 'reaction', 'revoke', ...MEDIA_ADMITIDA]);

export function esMediaAdmitida(message: Pick<InboundMessage, 'type'>): boolean {
  return MEDIA_ADMITIDA.has(message.type);
}
export function entradaAdmitida(message: Pick<InboundMessage, 'type'>): boolean {
  return TIPOS.has(message.type);
}

/** Se aplica al socket antes de resolver contactos o descargar contenido. */
export function contenidoLocalAdmitido(contenido: Record<string, unknown>): boolean {
  return typeof contenido.conversation === 'string'
    || Boolean((contenido.extendedTextMessage as { text?: unknown } | undefined)?.text)
    || ['locationMessage', 'liveLocationMessage', 'buttonsResponseMessage', 'templateButtonReplyMessage', 'listResponseMessage', 'interactiveResponseMessage', 'reactionMessage'].some(key => Boolean(contenido[key]))
    // Fotos, audios (notas de voz incluidas), videos (y los videos redondos) y stickers.
    || ['imageMessage', 'audioMessage', 'videoMessage', 'ptvMessage', 'stickerMessage'].some(key => Boolean(contenido[key]))
    || Boolean((contenido.protocolMessage as { key?: { id?: string }; type?: unknown } | undefined)?.key?.id && [0, 'REVOKE'].includes((contenido.protocolMessage as { type: number | string }).type));
}
