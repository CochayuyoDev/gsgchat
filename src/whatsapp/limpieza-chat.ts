import type { FastifyInstance } from 'fastify';
import type { Repos } from '../db/repos.js';
import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { RETENCION_CHAT_MS } from './retencion-chat.js';
import { extensionDe, idDeMedia, type MediaKind } from './local/media.js';

/** Un fichero sin mensaje que lo nombre espera esto antes de borrarse: un envio o una descarga en curso aun no tiene su fila. */
export const GRACIA_HUERFANOS_MS = 60 * 60 * 1000;

/**
 * Borra del disco los ficheros que ningun mensaje nombra ya: los de mensajes
 * borrados (vencidos, «borrar chat», contactos eliminados), los de envios que
 * fallaron y los que quedaron a medias. Cubre todas las vias de borrado a la
 * vez, porque mira lo que queda en la base y no quien lo borro.
 */
export async function limpiarArchivosHuerfanos(dir: string, repos: Repos, ahora = new Date()): Promise<number> {
  const vivos = new Set<string>();
  for (const m of await repos.messages.mediaReferenciada()) {
    vivos.add(m.id);
    // Lo de Meta se guarda con el nombre derivado de su id (ver webhook.ts).
    vivos.add(idDeMedia(`meta:${m.id}`, extensionDe(m.mimeType ?? 'application/octet-stream', m.kind as MediaKind)));
  }
  const limite = ahora.getTime() - GRACIA_HUERFANOS_MS;
  let borrados = 0;
  for (const nombre of await readdir(dir).catch(() => [] as string[])) {
    const ruta = path.join(dir, nombre);
    const temporal = /^[0-9a-f]{24}\.[a-z0-9]{1,5}\.\d+\.tmp$/.test(nombre);
    if (!temporal && (!/^[0-9a-f]{24}\.[a-z0-9]{1,5}$/.test(nombre) || vivos.has(nombre))) continue;
    const info = await stat(ruta).catch(() => null);
    if (!info?.isFile() || info.mtimeMs >= limite) continue;
    await unlink(ruta).then(() => borrados++, () => undefined);
  }
  return borrados;
}

/**
 * Los ficheros del chat (fotos, audios, videos) viven lo mismo que sus mensajes:
 * pasadas las 72 horas se borran del disco. Solo los que nombra el propio
 * sistema (ver idDeMedia); la carpeta de stickers ni se mira.
 */
export async function limpiarArchivosAntes(dir: string, desde: Date): Promise<number> {
  let borrados = 0;
  const nombres = await readdir(dir).catch(() => [] as string[]);
  for (const nombre of nombres) {
    if (!/^[0-9a-f]{24}\.[a-z0-9]{1,5}$/.test(nombre)) continue;
    const ruta = path.join(dir, nombre);
    const info = await stat(ruta).catch(() => null);
    if (!info?.isFile() || info.mtime >= desde) continue;
    await unlink(ruta).then(() => borrados++, () => undefined);
  }
  return borrados;
}

/** Borra mensajes vencidos en lotes; conserva pedidos, coordenadas y auditoría. */
export function registrarLimpiezaChat(app: FastifyInstance, repos: Repos, mediaDir?: string): void {
  const LIMITE_LOTE = 1000;
  const INTERVALO_NORMAL_MS = 5 * 60_000;
  const INTERVALO_ATRASO_MS = 60_000;
  let trabajo: Promise<boolean> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  async function limpiar(): Promise<boolean> {
    if (trabajo) return true;
    const desde = new Date(Date.now() - RETENCION_CHAT_MS);
    trabajo = (async () => {
      const mensajes = await repos.messages.limpiarAntes(desde);
      // La deduplicación no comparte la retención de mensajes: 7 días cubren
      // las reentregas tardías y los reintentos de los proveedores comunes.
      const ahora = new Date();
      const recibos = await repos.messages.limpiarEntradasAntes(ahora);
      const acciones = await repos.messages.limpiarAccionesWhatsappAntes(ahora);
      if (mediaDir) {
        await limpiarArchivosAntes(mediaDir, desde);
        await limpiarArchivosHuerfanos(mediaDir, repos, ahora);
      }
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
