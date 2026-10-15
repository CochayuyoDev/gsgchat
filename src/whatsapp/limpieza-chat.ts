import type { FastifyInstance } from 'fastify';
import type { Repos } from '../db/repos.js';

/** Borra mensajes vencidos en lotes; conserva pedidos, coordenadas y auditoría. */
export function registrarLimpiezaChat(app: FastifyInstance, repos: Repos): void {
  let trabajo: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  async function limpiar() {
    if (trabajo) return;
    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000);
    trabajo = (async () => {
      await repos.messages.limpiarAntes(desde);
      // La deduplicación no comparte la retención de mensajes: 7 días cubren
      // las reentregas tardías y los reintentos de los proveedores comunes.
      await repos.messages.limpiarEntradasAntes(new Date());
      await repos.messages.limpiarAccionesWhatsappAntes(new Date());
    })().catch(error => app.log.error({ err: error }, 'no se pudo limpiar el chat del día anterior')).finally(() => { trabajo = null; });
    await trabajo;
  }
  app.addHook('onReady', async () => {
    await limpiar();
    timer = setInterval(() => { void limpiar(); }, 60_000);
    timer.unref();
  });
  app.addHook('onClose', async () => { if (timer) clearInterval(timer); await trabajo; });
}
