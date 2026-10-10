/**
 * Stickers: un toque humano despues de un saludo, un "gracias" o una despedida.
 *
 * La biblioteca la arma quien opera desde el panel (sube un PNG, JPG, GIF o
 * WebP y aqui se convierte a lo que WhatsApp pide: WebP de 512x512 con fondo
 * transparente). Cada sticker tiene un uso -inicio, gracias, despedida,
 * otro- y la configuracion dice cual sale solo en cada momento:
 *
 *   - inicio:     tras el primer mensaje del asistente a un cliente nuevo
 *                 (y, si se marca, tras el primer mensaje del reparto);
 *   - gracias:    cuando el cliente manda su ubicacion o completa su ficha;
 *   - despedida:  cuando el reparto pasa el caso al repartidor.
 *
 * Desde el chat se manda cualquiera a mano, y una respuesta rapida puede
 * llevar uno pegado. Un sticker nunca frena nada: si las guardas lo bloquean
 * (ritmo, ventana cerrada con la API de Meta) simplemente no sale.
 */

import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from '../db/pool.js';
import type { Sender, SendOutcome } from '../outbound/sender.js';
import type { ServicioAjustes } from '../ajustes/generales.js';

export type UsoSticker = 'inicio' | 'gracias' | 'despedida' | 'otro';
export const USOS: UsoSticker[] = ['inicio', 'gracias', 'despedida', 'otro'];
export const ETIQUETA_USO: Record<UsoSticker, string> = {
  inicio: 'Saludo / inicio',
  gracias: 'Gracias',
  despedida: 'Despedida',
  otro: 'Otro',
};

export interface Sticker {
  id: string;
  nombre: string;
  uso: UsoSticker;
  archivo: string;
  bytes: number;
  createdAt: Date;
}

export interface StickersRepo {
  listar(): Promise<Sticker[]>;
  get(id: string): Promise<Sticker | null>;
  crear(s: Omit<Sticker, 'createdAt'>): Promise<Sticker>;
  borrar(id: string): Promise<boolean>;
}

/** El tamaño maximo que se acepta subir (antes de convertir). */
export const MAX_BYTES_SUBIDA = 4 * 1024 * 1024;
/** Lo que WhatsApp tolera para un sticker estatico. */
export const MAX_BYTES_STICKER = 500 * 1024;
export const LADO = 512;

/**
 * De cualquier imagen a un sticker: WebP 512x512, la imagen entera dentro
 * (sin recortar) y transparente alrededor. Si ya venia asi, se deja igual.
 */
export async function prepararSticker(datos: Buffer): Promise<Buffer> {
  const { default: sharp } = await import('sharp');
  const meta = await sharp(datos, { animated: false }).metadata();
  if (meta.format === 'webp' && meta.width === LADO && meta.height === LADO && datos.length <= MAX_BYTES_STICKER) return datos;
  let calidad = 85;
  for (;;) {
    const salida = await sharp(datos, { animated: false })
      .resize(LADO, LADO, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: calidad, alphaQuality: 90 })
      .toBuffer();
    if (salida.length <= MAX_BYTES_STICKER || calidad <= 40) return salida;
    calidad -= 15;
  }
}

export function idDeSticker(datos: Buffer): string {
  return 'st-' + createHash('sha1').update(datos).digest('hex').slice(0, 12);
}

export function carpetaDeStickers(mediaDir: string): string {
  const dir = path.join(mediaDir, 'stickers');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Solo el nombre que genera el propio sistema: ni rutas ni nada raro. */
export function archivoValido(archivo: string): boolean {
  return /^st-[0-9a-f]{12}\.webp$/.test(archivo);
}

interface Row {
  id: string;
  nombre: string;
  uso: UsoSticker;
  archivo: string;
  bytes: number;
  created_at: Date;
}

const deFila = (r: Row): Sticker => ({ id: r.id, nombre: r.nombre, uso: r.uso, archivo: r.archivo, bytes: r.bytes, createdAt: r.created_at });

export function createStickersRepo(pool: Pool): StickersRepo {
  return {
    async listar() {
      const { rows } = await pool.query<Row>('select * from stickers order by uso, created_at');
      return rows.map(deFila);
    },
    async get(id) {
      const { rows } = await pool.query<Row>('select * from stickers where id = $1', [id]);
      return rows[0] ? deFila(rows[0]) : null;
    },
    async crear(s) {
      const { rows } = await pool.query<Row>(
        `insert into stickers (id, nombre, uso, archivo, bytes) values ($1,$2,$3,$4,$5)
         on conflict (id) do update set nombre = excluded.nombre, uso = excluded.uso
         returning *`,
        [s.id, s.nombre, s.uso, s.archivo, s.bytes],
      );
      return deFila(rows[0]!);
    },
    async borrar(id) {
      const { rowCount } = await pool.query('delete from stickers where id = $1', [id]);
      return (rowCount ?? 0) > 0;
    },
  };
}

export type MomentoSticker = 'inicio' | 'gracias' | 'despedida';

export interface ServicioStickers {
  listar(): Promise<Sticker[]>;
  /** Sube una imagen (base64) y la deja convertida y registrada. */
  subir(input: { nombre: string; uso: UsoSticker; datosBase64: string }): Promise<Sticker>;
  borrar(id: string): Promise<boolean>;
  /** El fichero, para servirlo. */
  leer(archivo: string): Promise<Buffer | null>;
  /** Manda ese sticker a ese telefono. `manual`: desde el chat. */
  enviar(phone: string, id: string, opts?: { manual?: boolean }): Promise<SendOutcome | { ok: false; error: string }>;
  /**
   * El sticker automatico de ese momento, si esta configurado. Nunca lanza:
   * un adorno no puede romper el mensaje al que acompaña.
   */
  automatico(momento: MomentoSticker, phone: string, contexto?: { reparto?: boolean }): Promise<void>;
  /** La configuracion vigente (que sticker en cada momento). */
  configuracion(): ConfigStickers;
}

export interface ConfigStickers {
  inicio: string | null;
  inicioEnReparto: boolean;
  gracias: string | null;
  despedida: string | null;
}

export const CONFIG_STICKERS_VACIA: ConfigStickers = { inicio: null, inicioEnReparto: false, gracias: null, despedida: null };

export interface StickersDeps {
  repo: StickersRepo;
  mediaDir: string;
  sender: Sender;
  ajustes?: ServicioAjustes;
  /** La URL publica del sistema, para que la API de Meta baje el fichero. */
  publicBase: string;
  log?: (mensaje: string, detalle?: Record<string, unknown>) => void;
}

export function crearServicioStickers(deps: StickersDeps): ServicioStickers {
  const { repo, sender } = deps;
  const dir = carpetaDeStickers(deps.mediaDir);
  const log = deps.log ?? (() => undefined);

  const configuracion = (): ConfigStickers => {
    const a = deps.ajustes?.actual().stickers;
    return a ? { ...CONFIG_STICKERS_VACIA, ...a } : CONFIG_STICKERS_VACIA;
  };

  async function leer(archivo: string): Promise<Buffer | null> {
    if (!archivoValido(archivo)) return null;
    try {
      return await readFile(path.join(dir, archivo));
    } catch {
      return null;
    }
  }

  async function enviar(phone: string, id: string, opts: { manual?: boolean } = {}) {
    const s = await repo.get(id);
    if (!s) return { ok: false as const, error: 'Ese sticker ya no existe.' };
    const datos = await leer(s.archivo);
    if (!datos) return { ok: false as const, error: 'No se encuentra el fichero del sticker.' };
    return sender.send({
      phone,
      kind: 'sticker',
      category: 'UTILITY',
      manual: opts.manual,
      // Va pegado al mensaje anterior: no cuenta como "otro mensaje" para la
      // separacion minima ni para el techo diario por contacto.
      limitesContacto: { separacionMs: 0, maxPorDia: 100 },
      sticker: { id: s.id, archivo: s.archivo, datos, mimeType: 'image/webp', url: `${deps.publicBase.replace(/\/$/, '')}/stickers/${s.archivo}` },
    });
  }

  return {
    listar: () => repo.listar(),
    async subir(input) {
      const crudo = Buffer.from(input.datosBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
      if (!crudo.length) throw new Error('El fichero llegó vacío.');
      if (crudo.length > MAX_BYTES_SUBIDA) throw new Error('La imagen pesa más de 4 MB: usa una más ligera.');
      let webp: Buffer;
      try {
        webp = await prepararSticker(crudo);
      } catch (error) {
        throw new Error('No se pudo leer la imagen (vale PNG, JPG, GIF o WebP): ' + (error instanceof Error ? error.message : String(error)));
      }
      const id = idDeSticker(webp);
      const archivo = `${id}.webp`;
      await writeFile(path.join(dir, archivo), webp);
      return repo.crear({ id, nombre: input.nombre.trim() || 'Sticker', uso: input.uso, archivo, bytes: webp.length });
    },
    async borrar(id) {
      const s = await repo.get(id);
      if (!s) return false;
      await repo.borrar(id);
      await unlink(path.join(dir, s.archivo)).catch(() => undefined);
      return true;
    },
    leer,
    enviar,
    async automatico(momento, phone, contexto = {}) {
      const cfg = configuracion();
      if (momento === 'inicio' && contexto.reparto && !cfg.inicioEnReparto) return;
      const id = cfg[momento];
      if (!id) return;
      try {
        const r = await enviar(phone, id);
        if (!r.ok) log('sticker automatico no salio', { momento, phone, motivo: 'reason' in r ? r.reason : r.error });
      } catch (error) {
        log('sticker automatico fallo', { momento, phone, detalle: error instanceof Error ? error.message : String(error) });
      }
    },
    configuracion,
  };
}
