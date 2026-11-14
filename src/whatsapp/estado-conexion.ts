/**
 * ¿Hay WhatsApp? Con varias lineas la respuesta NO es la de la principal.
 *
 * Antes, cada pantalla (la campana, el inicio, /health, /api/v1/estado)
 * preguntaba solo a la principal (`wa.conectado()`). Con la principal caida y
 * WhatsApp 2 y 3 vivos se decia «WhatsApp desconectado» en todas partes, y el
 * sistema de GSG, que lee `/api/v1/estado`, dejaba de escribir aunque el
 * envio SI salia por la linea de cada cliente (ver `sender.ts`,
 * `lineaDelTrabajo`). Ahora «conectado» = queda al menos una linea viva, y la
 * principal se informa aparte.
 */

import type { WhatsAppClient } from './client.js';
import type { RegistroClientes } from './registro.js';

export interface FuentesConexion {
  settings: { isConfigured(): boolean };
  wa: Pick<WhatsAppClient, 'conectado'>;
  registro?: Pick<RegistroClientes, 'algunaConectada' | 'estados'> | null;
  /** La principal de uso (ver `ServicioLineas.preferida`); sin esto, la de /setup. */
  preferida?: (() => Promise<string>) | null;
}

/** La principal, como se preguntaba antes. */
export function principalConectada(f: FuentesConexion): boolean {
  if (!f.settings.isConfigured()) return false;
  try {
    return f.wa.conectado?.() ?? true;
  } catch {
    return false;
  }
}

/** Sincrono: si queda ALGUNA linea por la que pueda salir un mensaje. */
export function algunaLineaConectada(f: FuentesConexion): boolean {
  if (principalConectada(f)) return true;
  try {
    return f.registro?.algunaConectada() ?? false;
  } catch {
    return false;
  }
}

/** Si hay algo configurado: la principal, o alguna linea secundaria viva. */
export function algunaLineaConfigurada(f: FuentesConexion): boolean {
  return f.settings.isConfigured() || algunaLineaConectada(f);
}

export interface LineaEnEstado {
  id: string;
  etiqueta: string;
  numero: string;
  /** La principal de uso (la que eligio la tienda; por defecto, la de /setup). */
  principal: boolean;
  conectada: boolean;
}

export interface EstadoConexion {
  configurado: boolean;
  /** Al menos una linea puede enviar. */
  conectado: boolean;
  /** La principal de uso. */
  principalConectada: boolean;
  /** Cada linea habilitada con su estado; vacio si este arranque no tiene lineas. */
  lineas: LineaEnEstado[];
}

export async function estadoConexion(f: FuentesConexion): Promise<EstadoConexion> {
  const deSetup = principalConectada(f);
  let preferidaId: string | null = null;
  try {
    preferidaId = f.preferida ? await f.preferida() : null;
  } catch {
    preferidaId = null;
  }
  let lineas: LineaEnEstado[] = [];
  if (f.registro) {
    try {
      lineas = (await f.registro.estados()).map((e) => ({
        id: e.linea.id,
        etiqueta: e.linea.etiqueta,
        numero: e.linea.telefono ?? '',
        principal: preferidaId ? e.linea.id === preferidaId : e.linea.principal,
        // La de /setup manda con su propia comprobacion (ajustes + socket).
        conectada: e.linea.principal ? deSetup : e.conectada,
      }));
    } catch {
      lineas = [];
    }
  }
  const deUso = lineas.find((l) => l.principal);
  const conectado = deSetup || lineas.some((l) => l.conectada) || algunaLineaConectada(f);
  return { configurado: f.settings.isConfigured() || conectado, conectado, principalConectada: deUso ? deUso.conectada : deSetup, lineas };
}

/** «WhatsApp 2 y WhatsApp 3»: para los avisos en palabras. */
export function nombrarLineas(lineas: LineaEnEstado[]): string {
  const nombres = lineas.map((l) => `«${l.etiqueta || l.numero || 'sin nombre'}»`);
  if (nombres.length <= 1) return nombres.join('');
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}
