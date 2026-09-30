/**
 * Los ficheros de respaldo: escribir, leer y comprobar.
 *
 * Un respaldo es un .ndjson.gz: la primera linea describe el hilo (de quien
 * es, cuando se exporto, cuantos mensajes trae) y cada linea siguiente es un
 * mensaje. Se eligio NDJSON y no un JSON grande por dos razones que importan
 * el dia que haga falta de verdad: se escribe y se lee de a poco -un hilo de
 * cien mil mensajes no tiene por que caber en memoria- y si el fichero se
 * corta a la mitad, lo que hay antes del corte sigue siendo legible.
 *
 * Comprimido porque una conversacion es texto y el texto se encoge a la
 * decima parte; ese es justamente el ahorro que se busca al cerrar un chat.
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import type { Message } from '../db/messages.js';

/** Version del formato. Sube si cambia la forma de las lineas. */
export const FORMATO = 1;

export interface ArchiveHeader {
  tipo: 'wa-locator/chat';
  version: number;
  exportadoEn: string;
  contacto: {
    id: string;
    phone: string;
    name: string | null;
  };
  motivo: string;
  mensajes: number;
  desde: string | null;
  hasta: string | null;
}

export interface ArchiveContent {
  header: ArchiveHeader;
  messages: Message[];
}

export interface WrittenArchive {
  /** Ruta relativa al directorio de respaldos. */
  file: string;
  bytes: number;
  sha256: string;
}

/** Deja el nombre en algo que exista en cualquier sistema de ficheros. */
function seguro(texto: string): string {
  return texto.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'sin-numero';
}

/**
 * Donde va el fichero: una carpeta por mes.
 *
 * Con todo en un solo directorio, un `ls` deja de responder a los pocos miles
 * de respaldos y las copias de seguridad no pueden hacerse por tramos.
 */
export function nombreDeArchivo(phone: string, at: Date): string {
  const iso = at.toISOString();
  const mes = iso.slice(0, 7);
  const sello = iso.slice(0, 19).replace(/[:T]/g, '').replace(/-/g, '');
  const azar = Math.random().toString(36).slice(2, 6);
  return path.posix.join(mes, `${seguro(phone)}-${sello}-${azar}.ndjson.gz`);
}

/** Ruta absoluta de un respaldo. Rechaza rutas que se salgan del directorio. */
export function rutaDe(dir: string, file: string): string {
  const base = path.resolve(dir);
  const full = path.resolve(base, file);
  // Un `file` con ../ vendria de la base de datos, no del usuario, pero el
  // dia que alguien escriba ahi a mano esto es lo que evita servir /etc/passwd.
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error('ruta de respaldo fuera del directorio');
  }
  return full;
}

function hashDe(full: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(full)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Escribe el respaldo. `lineas` es la cabecera seguida de un mensaje por
 * linea; llega como iterable asincrono para poder venir de la base por
 * paginas y no de un array entero en memoria.
 */
export async function escribirArchivo(
  dir: string,
  file: string,
  lineas: AsyncIterable<string>,
): Promise<WrittenArchive> {
  const full = rutaDe(dir, file);
  mkdirSync(path.dirname(full), { recursive: true });

  const texto = (async function* () {
    for await (const linea of lineas) yield `${linea}\n`;
  })();

  try {
    await pipeline(Readable.from(texto), createGzip({ level: 9 }), createWriteStream(full));
  } catch (error) {
    // Un fichero a medias es peor que ninguno: el indice diria que hay
    // respaldo y al abrirlo estaria roto.
    await unlink(full).catch(() => undefined);
    throw error;
  }

  const { size } = await stat(full);
  return { file, bytes: size, sha256: await hashDe(full) };
}

/** Lee un respaldo entero. Para descargarlo tal cual, usa `leerCrudo`. */
export async function leerArchivo(dir: string, file: string): Promise<ArchiveContent> {
  const full = rutaDe(dir, file);
  if (!existsSync(full)) throw new Error(`el fichero del respaldo no esta en disco: ${file}`);

  const trozos: Buffer[] = [];
  await pipeline(createReadStream(full), createGunzip(), async function* (source) {
    for await (const trozo of source) trozos.push(trozo as Buffer);
    // pipeline necesita que el ultimo tramo consuma; no se escribe nada mas.
    yield* [];
  });

  const lineas = Buffer.concat(trozos).toString('utf8').split('\n').filter(Boolean);
  if (!lineas.length) throw new Error(`el respaldo esta vacio: ${file}`);

  const header = JSON.parse(lineas[0]!) as ArchiveHeader;
  const messages = lineas.slice(1).map((l) => {
    const raw = JSON.parse(l) as Message & { createdAt: string };
    return { ...raw, createdAt: new Date(raw.createdAt) } as Message;
  });
  return { header, messages };
}

/** El fichero comprimido tal cual, para descargarlo sin descomprimir. */
export function leerCrudo(dir: string, file: string): NodeJS.ReadableStream {
  return createReadStream(rutaDe(dir, file));
}

/** Comprueba que el fichero sigue en disco y con el mismo contenido. */
export async function comprobar(
  dir: string,
  file: string,
  sha256: string | null,
): Promise<{ ok: boolean; detalle: string }> {
  const full = rutaDe(dir, file);
  if (!existsSync(full)) return { ok: false, detalle: 'el fichero no esta en disco' };
  if (!sha256) return { ok: true, detalle: 'sin sha256 guardado: solo se comprobo que existe' };
  const actual = await hashDe(full);
  return actual === sha256
    ? { ok: true, detalle: 'intacto' }
    : { ok: false, detalle: 'el contenido cambio desde que se respaldo' };
}

/**
 * La carpeta hermana del respaldo donde van sus adjuntos (fotos, audios,
 * documentos): el mismo nombre sin la extension. Relativa al directorio de
 * respaldos, como `file`.
 */
export function carpetaDeAdjuntos(file: string): string {
  return file.replace(/\.ndjson\.gz$/, '') + '-adjuntos';
}

/** El nombre de fichero de un adjunto, ya acotado: nada de rutas ni de ".." (viene de la base, pero por si acaso). */
export function nombreDeAdjuntoSeguro(id: string): string | null {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(id) && !id.includes('..') ? id : null;
}

/** Ruta absoluta de un adjunto del respaldo, o null si el id no es de fiar. */
export function rutaDeAdjunto(dir: string, file: string, id: string): string | null {
  const nombre = nombreDeAdjuntoSeguro(id);
  return nombre ? rutaDe(dir, path.posix.join(carpetaDeAdjuntos(file), nombre)) : null;
}

/** Borra el fichero y su carpeta de adjuntos, si la habia. */
export async function borrarArchivo(dir: string, file: string): Promise<void> {
  await unlink(rutaDe(dir, file)).catch(() => undefined);
  await rm(rutaDe(dir, carpetaDeAdjuntos(file)), { recursive: true, force: true }).catch(() => undefined);
}
