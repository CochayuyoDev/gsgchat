import type { Repos } from '../db/repos.js';
import type { SettingsService } from '../settings/service.js';
import type { InboundMessage } from './types.js';

/**
 * Antes de crear contactos, descargar adjuntos o ejecutar IA.
 *
 * La regla de siempre: solo entra lo de un cliente al que el sistema le
 * escribió. Con el WhatsApp por QR, además, solo lo posterior al «corte» (el
 * momento en que se vinculó): así no se cuela el historial ni los chats
 * personales del celular.
 *
 * `sinCorte` (lo que llega por WhatsApp Business API de Meta): el corte del QR
 * no aplica. Es un número de empresa, Meta no manda historial, y el corte se
 * mueve cada vez que alguien pulsa «Conectar y mostrar el QR» en la principal:
 * con la principal sin vincular y una línea de API, las respuestas de los
 * clientes (textos, fotos, audios) se descartaban sin guardarse (10/11).
 */
export async function perteneceAlChatActual(
  repos: Repos,
  settings: SettingsService,
  message: Pick<InboundMessage, 'from' | 'timestamp' | 'historial' | 'viejo'>,
  opciones: { sinCorte?: boolean } = {},
): Promise<boolean> {
  const corte = settings.conexionChatDesde?.() ?? settings.vistaChatDesde?.();
  if (!corte) return true;
  if (message.historial || message.viejo) return false;
  const desde = opciones.sinCorte ? new Date(0) : corte;
  if (!opciones.sinCorte && Number(message.timestamp) < Math.floor(desde.getTime() / 1000)) return false;
  const contact = await repos.contacts.getByPhone(message.from);
  return Boolean(contact && await repos.messages.inicioSistemaDesde(contact.id, desde));
}
