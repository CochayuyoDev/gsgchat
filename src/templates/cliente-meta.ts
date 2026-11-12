/**
 * Con qué cliente se le habla a Meta de plantillas, y si hay WhatsApp API en uso.
 *
 * Una tienda puede tener la conexión principal por QR y además una línea de
 * WhatsApp API (Conexión WhatsApp → Líneas). Antes las plantillas solo se
 * traían de Meta si la principal era la API: con la API en una línea aparte,
 * el registro quedaba vacío y el primer mensaje no salía (10/11). Aquí se
 * busca el cliente de Meta que haya: la principal si es la API, si no la
 * primera línea de API habilitada que el modo de Conexión deje en uso.
 */

import type { WhatsAppClient } from '../whatsapp/client.js';
import type { SettingsService } from '../settings/service.js';
import { providerOf } from '../settings/service.js';
import type { ServicioLineas } from '../whatsapp/lineas.js';
import type { RegistroClientes } from '../whatsapp/registro.js';
import { admiteTipo } from '../whatsapp/modo-lineas.js';

export interface FuentesMeta {
  settings: SettingsService;
  wa: WhatsAppClient;
  lineas?: ServicioLineas;
  registro?: RegistroClientes;
}

/** El cliente de Meta: la principal si es la API; si no, la primera línea de API en uso. null = no hay. */
export async function clienteDeMeta(f: FuentesMeta): Promise<WhatsAppClient | null> {
  if (providerOf(f.settings.current()) === 'cloud') return f.wa;
  if (!f.lineas || !f.registro) return null;
  const modo = (await f.lineas.modo?.().catch(() => null)) ?? 'ambos';
  if (!admiteTipo(modo, 'api')) return null;
  for (const linea of await f.lineas.listar().catch(() => [])) {
    if (linea.principal || !linea.habilitada || linea.proveedor !== 'cloud') continue;
    const t = await f.registro.transporte(linea.id).catch(() => null);
    if (t?.cliente) return t.cliente;
  }
  return null;
}

/** Si hay WhatsApp API en uso (la principal o una línea). */
export async function hayApiEnUso(f: FuentesMeta): Promise<boolean> {
  return (await clienteDeMeta(f)) !== null;
}
