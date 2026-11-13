/**
 * Lo que la API dice de cada mensaje saliente: si llegó al WhatsApp del
 * cliente (`llegoAWhatsapp`), su estado en palabras (`entrega`) y, si no
 * llegó, el porqué (`error`). Lo usan el historial de GSG
 * (src/api/v1/conversaciones-gsg.ts) y el hilo por teléfono
 * (src/api/v1/routes.ts), para que las dos respondan exactamente igual.
 *
 * Regla: este cálculo nunca tumba la respuesta. Si no se puede leer el motivo
 * o el estado, el mensaje sale como «sin confirmar», que es lo único honesto
 * cuando no se sabe.
 */

import type { Repos } from '../../db/repos.js';
import type { Message } from '../../db/messages.js';
import { errorDeEnvio, type ErrorDeEnvio } from '../../whatsapp/errores-envio.js';
import { entregaDelMensaje, type EntregaDelMensaje } from '../../whatsapp/estado-entrega.js';

export interface EntregaEnApi {
  /** null en los entrantes y en los salientes cuya confirmación aún no llegó. */
  llegoAWhatsapp: boolean | null;
  entrega: EntregaDelMensaje | null;
  /** Solo en los salientes que no llegaron. */
  error: ErrorDeEnvio | null;
}

const SIN_LEER: EntregaDelMensaje = {
  llegoAWhatsapp: null,
  estado: 'sin_confirmar',
  descripcion: 'No se pudo leer el estado de este mensaje.',
  minutosSinConfirmar: null,
  error: null,
};

/** Una sola fila, con el error ya buscado (o null). */
export function entregaParaApi(
  m: { direction: string; status: string | null; createdAt?: Date | string | null },
  error: ErrorDeEnvio | null,
  ahora: Date,
): EntregaEnApi {
  try {
    const entrega = entregaDelMensaje(m, error, ahora);
    return { llegoAWhatsapp: entrega?.llegoAWhatsapp ?? null, entrega, error: entrega?.error ?? null };
  } catch {
    if (m.direction !== 'out') return { llegoAWhatsapp: null, entrega: null, error: null };
    return { llegoAWhatsapp: null, entrega: SIN_LEER, error: null };
  }
}

const noLlego = (status: string | null) => status === 'failed' || status === 'blocked_by_gate';

/**
 * Un saliente que no salió por WhatsApp (rechazado o frenado). Regla de GSG
 * (12/11): si no sale en WhatsApp, no sale en GSG; ni el historial ni los
 * webhooks lo muestran. GSGchat sí lo sigue mostrando en su propio chat.
 */
export const noSalioPorWhatsapp = (m: { direction: string; status: string | null }): boolean => m.direction === 'out' && noLlego(m.status);

/**
 * Todo el hilo de una vez. Los motivos salen de `deliveries` (código y texto
 * de Meta, o el bloqueo interno), y solo se consultan si hay algún saliente que
 * no llegó: leer el historial no tiene que costar más por esto.
 */
export async function entregasDelHilo(
  repos: Pick<Repos, 'deliveries'>,
  phone: string,
  messages: Message[],
  ahora: Date = new Date(),
): Promise<Map<number, EntregaEnApi>> {
  const conError = new Map<string, ErrorDeEnvio>();
  if (messages.some((m) => m.direction === 'out' && noLlego(m.status))) {
    try {
      const envios = await repos.deliveries.listRecent({ phone, limit: 300, offset: 0 });
      for (const d of envios) {
        if (d.status !== 'failed' && d.status !== 'blocked_by_gate') continue;
        const e = errorDeEnvio(d.errorCode, d.errorTitle);
        if (!e) continue;
        if (d.wamid) conError.set('w:' + d.wamid, e);
        conError.set('d:' + d.id, e);
      }
    } catch {
      // Sin los motivos el historial sale igual: cada uno dice que no quedó el porqué.
    }
  }
  const salida = new Map<number, EntregaEnApi>();
  for (const m of messages) {
    const error =
      m.direction === 'out' && noLlego(m.status)
        ? (m.wamid ? conError.get('w:' + m.wamid) : undefined) ??
          (m.deliveryId ? conError.get('d:' + m.deliveryId) : undefined) ??
          errorDeEnvio(null, 'No salió y no quedó apuntado el motivo.')
        : null;
    salida.set(m.id, entregaParaApi(m, error, ahora));
  }
  return salida;
}

/** Lo que va en cada mensaje de la respuesta (los tres campos, siempre presentes). */
export function camposDeEntrega(mapa: Map<number, EntregaEnApi>, m: { id: number; direction: string }): EntregaEnApi {
  return mapa.get(m.id) ?? (m.direction === 'out' ? { llegoAWhatsapp: null, entrega: SIN_LEER, error: null } : { llegoAWhatsapp: null, entrega: null, error: null });
}
