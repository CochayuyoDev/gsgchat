/**
 * El webhook de GSG: la suscripcion de webhooks salientes (src/webhooks) que
 * apunta a base + ruta de Conexion GSG. Una sola, reconocida por su descripcion.
 *
 * El secreto solo se devuelve cuando nace o se rota: es lo unico que ve la
 * pantalla, una vez. Guardar otra vez la misma ruta no lo cambia.
 */

import type { WebhooksRepo } from '../webhooks/repo.js';
import { generarSecretoWebhook } from '../webhooks/firma.js';

export const DESCRIPCION_WEBHOOK_GSG = 'GSG (Conexión GSG)';

export interface ResultadoWebhookGsg {
  /** La suscripcion vigente, o null si no hay ruta (queda apagada si existia). */
  webhook: { id: string; url: string; activo: boolean } | null;
  /** El secreto nuevo, una sola vez; null si la suscripcion ya existia. */
  secreto: string | null;
  creado: boolean;
}

async function buscar(repo: WebhooksRepo) {
  return (await repo.listar()).find((w) => w.descripcion === DESCRIPCION_WEBHOOK_GSG) ?? null;
}

/** Deja la suscripcion de GSG apuntando a `destino` (null = sin ruta: se apaga). */
export async function sincronizarWebhookGsg(repo: WebhooksRepo, destino: string | null, creadoPor: string | null = null): Promise<ResultadoWebhookGsg> {
  const existente = await buscar(repo);
  if (!destino) {
    if (!existente) return { webhook: null, secreto: null, creado: false };
    const apagado = existente.activo ? await repo.actualizar(existente.id, { activo: false }) : existente;
    return { webhook: apagado ? { id: apagado.id, url: apagado.url, activo: apagado.activo } : null, secreto: null, creado: false };
  }
  if (!existente) {
    const secreto = generarSecretoWebhook();
    const w = await repo.crear({ url: destino, descripcion: DESCRIPCION_WEBHOOK_GSG, secreto, eventos: ['*'], creadoPor });
    return { webhook: { id: w.id, url: w.url, activo: w.activo }, secreto, creado: true };
  }
  const w = existente.url === destino && existente.activo ? existente : await repo.actualizar(existente.id, { url: destino, activo: true });
  return { webhook: w ? { id: w.id, url: w.url, activo: w.activo } : null, secreto: null, creado: false };
}

/** Un secreto nuevo para el webhook de GSG (el anterior deja de valer). null = no hay webhook. */
export async function rotarSecretoWebhookGsg(repo: WebhooksRepo): Promise<string | null> {
  const existente = await buscar(repo);
  if (!existente) return null;
  const secreto = generarSecretoWebhook();
  return (await repo.rotarSecreto(existente.id, secreto)) ? secreto : null;
}
