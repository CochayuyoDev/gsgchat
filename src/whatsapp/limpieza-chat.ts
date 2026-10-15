import type { FastifyInstance } from 'fastify';
import type { Repos } from '../db/repos.js';

/** Borra mensajes vencidos en lotes; conserva pedidos, coordenadas y auditoría. */
export function registrarLimpiezaChat(app: FastifyInstance, repos: Repos): void {
  const LIMITE_LOTE = 1000;
  const INTERVALO_NORMAL_MS = 5 * 60_000;
  const INTERVALO_ATRASO_MS = 60_000;
  let trabajo: Promise<boolean> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  async function limpiar(): Promise<boolean> {
    if (trabajo) return true;
    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000);
    trabajo = (async () => {
      const mensajes = await repos.messages.limpiarAntes(desde);
      // La deduplicación no comparte la retención de mensajes: 7 días cubren
      // las reentregas tardías y los reintentos de los proveedores comunes.
      const ahora = new Date();
      const recibos = await repos.messages.limpiarEntradasAntes(ahora);
      const acciones = await repos.messages.limpiarAccionesWhatsappAntes(ahora);
      // Si se llenó algún lote, queda atraso; mantener el intervalo corto
      // hasta alcanzarlo y usar uno más largo cuando el servicio esté al día.
      return mensajes >= LIMITE_LOTE || recibos >= LIMITE_LOTE || acciones >= LIMITE_LOTE;
    })().catch(error => {
      app.log.error({ err: error }, 'no se pudo limpiar el chat vencido');
      return true; // reintentar pronto sin dejar la limpieza detenida
    }).finally(() => { trabajo = null; });
    return await trabajo;
  }
  function programar(reintentarPronto: boolean) {
    timer = setTimeout(async () => {
      timer = null;
      const atrasado = await limpiar();
      programar(atrasado);
    }, reintentarPronto ? INTERVALO_ATRASO_MS : INTERVALO_NORMAL_MS);
    timer.unref();
  }
  app.addHook('onReady', async () => {
    programar(await limpiar());
  });
  app.addHook('onClose', async () => { if (timer) clearTimeout(timer); await trabajo; });
}
