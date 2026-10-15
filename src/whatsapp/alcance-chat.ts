import type { Repos } from '../db/repos.js';
import type { SettingsService } from '../settings/service.js';
import type { InboundMessage } from './types.js';

/** Antes de crear contactos, descargar adjuntos o ejecutar IA. */
export async function perteneceAlChatActual(repos: Repos, settings: SettingsService, message: Pick<InboundMessage, 'from' | 'timestamp' | 'historial' | 'viejo'>): Promise<boolean> {
  const desde = settings.conexionChatDesde?.() ?? settings.vistaChatDesde?.();
  if (!desde) return true;
  if (message.historial || message.viejo || Number(message.timestamp) < Math.floor(desde.getTime() / 1000)) return false;
  const contact = await repos.contacts.getByPhone(message.from);
  return Boolean(contact && await repos.messages.inicioSistemaDesde(contact.id, desde));
}
