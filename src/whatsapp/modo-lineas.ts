/**
 * Que lineas usa la tienda: las de WhatsApp normal (QR / WAHA), las de la API
 * oficial de Meta, o las dos juntas.
 *
 * El modo NO desconecta nada: una linea que queda fuera sigue vinculada y
 * recibiendo, pero no entra en el reparto de clientes nuevos ni sirve de
 * alternativa. A sus clientes con el chat abierto (escribieron hace menos de
 * 24 h) se les sigue contestando por ella hasta que el chat se cierra; despues
 * salen por una linea del modo. Asi pasar de un modo a otro no corta ninguna
 * conversacion a la mitad y volver atras deja todo como estaba.
 */

import type { Provider } from '../settings/service.js';

export type ModoLineas = 'normal' | 'api' | 'ambos';
export type TipoLinea = 'normal' | 'api';

export const MODOS_LINEAS: readonly ModoLineas[] = ['normal', 'api', 'ambos'];

/** Hasta hoy todas las lineas se usaban juntas: ese es el valor por defecto. */
export const MODO_LINEAS_POR_DEFECTO: ModoLineas = 'ambos';

/** No empieza por `whatsapp.`: esas claves las lee el servicio de ajustes como credenciales. */
export const CLAVE_MODO_LINEAS = 'lineas.modo';

export function esModoLineas(valor: unknown): valor is ModoLineas {
  return typeof valor === 'string' && (MODOS_LINEAS as readonly string[]).includes(valor);
}

/** La API oficial (cloud) es «api»; el QR (local) y WAHA son WhatsApp normal. */
export function tipoDeProveedor(proveedor: Provider): TipoLinea {
  return proveedor === 'cloud' ? 'api' : 'normal';
}

/** Si una linea de ese tipo esta en uso con ese modo. */
export function admiteTipo(modo: ModoLineas, tipo: TipoLinea): boolean {
  return modo === 'ambos' || modo === tipo;
}

/** Lo que dice la pantalla de cada modo. */
export const TEXTO_MODO_LINEAS: Record<ModoLineas, { titulo: string; frase: string }> = {
  normal: {
    titulo: 'Solo WhatsApp normal',
    frase: 'Se usan las líneas vinculadas con QR. Las de la API quedan conectadas pero en pausa.',
  },
  api: {
    titulo: 'Solo WhatsApp API',
    frase: 'Se usan las líneas de la API de Meta. Las normales siguen vinculadas, pero no reciben clientes nuevos; los chats que ya estaban abiertos en ellas siguen hasta que se cierran (24 h sin que el cliente escriba).',
  },
  ambos: {
    titulo: 'Los dos juntos',
    frase: 'Se usan todas las líneas. Cada cliente sigue con su línea; si un cliente de la API lleva más de 24 h sin escribir y no hay plantilla, el mensaje sale por una línea normal.',
  },
};

/** Por que una linea en pausa por el modo no envia (lo que se ve en el chat y en la busqueda). */
export function motivoFueraDeModo(modo: ModoLineas, etiqueta: string): string {
  return `La línea «${etiqueta}» está en pausa porque Conexión tiene elegido «${TEXTO_MODO_LINEAS[modo].titulo}». ` +
    'Solo contesta a los chats que siguen abiertos. Elige otra línea o cambia el modo en Conexión.';
}
