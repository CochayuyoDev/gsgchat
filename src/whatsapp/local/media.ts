/**
 * Fotos, audios, videos y documentos que llegan por el socket.
 *
 * WhatsApp no manda el fichero: manda las llaves para descargarlo de sus
 * servidores, y ese enlace caduca. Asi que se baja en cuanto llega y se guarda
 * en disco; lo que se apunta en la conversacion es solo el identificador.
 *
 * Sin esto, un audio o una foto aparecen en el chat como "(audio)" y no hay
 * forma de verlos: el operador tiene que ir al telefono, que es justo lo que
 * esta pantalla viene a evitar.
 */

import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

/** Cuantas descargas de adjuntos corren a la vez; las demas esperan turno. */
export const DESCARGAS_SIMULTANEAS = 3;

/** Cola con cupo: como mucho `limite` tareas a la vez, el resto espera en orden. */
export function crearCupo(limite: number) {
  let activas = 0;
  const cola: Array<() => void> = [];
  return async function conCupo<T>(tarea: () => Promise<T>): Promise<T> {
    if (activas >= limite) await new Promise<void>((seguir) => cola.push(seguir));
    activas++;
    try {
      return await tarea();
    } finally {
      activas--;
      cola.shift()?.();
    }
  };
}

/** El cupo compartido por todas las descargas de adjuntos (QR y Meta). */
export const conCupoDeDescarga = crearCupo(DESCARGAS_SIMULTANEAS);

/**
 * Pasa un flujo al disco sin tenerlo entero en memoria, del tamaño que sea.
 * Escribe a un fichero temporal y lo renombra al terminar: nunca queda un
 * fichero a medias con el nombre final. Si el flujo se queda mudo 60 s o falla,
 * se borra lo escrito.
 */
export async function guardarFlujo(flujo: Readable | NodeJS.ReadableStream, destino: string): Promise<number> {
  const temporal = `${destino}.${process.pid}.tmp`;
  let total = 0;
  const controlador = new AbortController();
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const vigilar = () => {
    if (reloj) clearTimeout(reloj);
    reloj = setTimeout(() => controlador.abort(), 60_000);
  };
  const contador = new Transform({
    transform(trozo: Buffer, _codificacion, listo) {
      total += trozo.length;
      vigilar();
      listo(null, trozo);
    },
  });
  vigilar();
  try {
    await pipeline(flujo as Readable, contador, createWriteStream(temporal), { signal: controlador.signal });
    await rename(temporal, destino);
    return total;
  } catch (error) {
    await unlink(temporal).catch(() => undefined);
    throw error;
  } finally {
    if (reloj) clearTimeout(reloj);
  }
}


/** Los tipos de mensaje de WhatsApp que traen un fichero adjunto. */
const CON_FICHERO: Record<string, MediaKind> = {
  imageMessage: 'image',
  audioMessage: 'audio',
  videoMessage: 'video',
  documentMessage: 'document',
  stickerMessage: 'sticker',
  ptvMessage: 'video',
};

export type MediaKind = 'image' | 'audio' | 'video' | 'document' | 'sticker';

/**
 * Los envoltorios con los que WhatsApp manda lo mismo de otra forma: "ver
 * una vez" (tres versiones segun la app), mensajes temporales, un documento
 * con pie de foto, un mensaje editado. Dentro va el mensaje de siempre.
 */
const ENVOLTORIOS = [
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'ephemeralMessage',
  'documentWithCaptionMessage',
  'editedMessage',
] as const;

const VER_UNA_VEZ = new Set<string>(['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension']);

export interface ContenidoDesenvuelto {
  contenido: Record<string, unknown>;
  /**
   * Llego como "ver una vez". En el telefono desaparece al abrirla; aqui se
   * baja y se guarda como cualquier otra, que es lo que hace falta para que
   * el operador la vea cuando le toque y no solo en el instante que llega.
   */
  verUnaVez: boolean;
}

/** Quita los envoltorios hasta llegar al mensaje de verdad. */
export function desenvolver(contenido: Record<string, unknown> | null | undefined): ContenidoDesenvuelto {
  let actual: Record<string, unknown> = contenido ?? {};
  let verUnaVez = false;
  // Con tope: un mensaje mal formado no puede dejar esto girando.
  for (let vuelta = 0; vuelta < 5; vuelta++) {
    const clave = ENVOLTORIOS.find((k) => actual[k]);
    if (!clave) break;
    const dentro = (actual[clave] as { message?: Record<string, unknown> } | undefined)?.message;
    if (!dentro) break;
    if (VER_UNA_VEZ.has(clave)) verUnaVez = true;
    actual = dentro;
  }
  // La app tambien lo marca en la propia foto o video, aunque venga sin envoltorio.
  for (const clave of Object.keys(CON_FICHERO)) {
    const detalle = actual[clave] as { viewOnce?: boolean } | undefined;
    if (detalle?.viewOnce) verUnaVez = true;
  }
  return { contenido: actual, verUnaVez };
}

export interface MediaInfo {
  /** Nombre del fichero en disco; tambien la ruta publica. */
  id: string;
  kind: MediaKind;
  mimeType: string;
  /** Nombre original, solo en documentos. */
  filename?: string;
  /** Duracion en segundos, en audio y video. */
  seconds?: number;
  /** Si el audio se grabo con el microfono (nota de voz) o es un fichero. */
  voice?: boolean;
  caption?: string;
  bytes: number;
  /** Llego como "ver una vez": en el telefono ya no se puede abrir; aqui si. */
  verUnaVez?: boolean;
}

/** El tipo de adjunto de un mensaje, o null si no lleva ninguno. Mira dentro de los envoltorios. */
export function tipoDeAdjunto(contenido: Record<string, unknown>): MediaKind | null {
  const { contenido: real } = desenvolver(contenido);
  for (const [clave, kind] of Object.entries(CON_FICHERO)) {
    if (real[clave]) return kind;
  }
  return null;
}

/** La extension que le toca, para que el navegador sepa abrirlo. */
export function extensionDe(mimeType: string, kind: MediaKind): string {
  const conocidas: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
    'video/3gpp': '.3gp',
    'audio/ogg': '.ogg',
    'audio/ogg; codecs=opus': '.ogg',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'audio/aac': '.aac',
    'application/pdf': '.pdf',
  };
  const limpio = mimeType.split(';')[0]?.trim() ?? '';
  return (
    conocidas[mimeType] ??
    conocidas[limpio] ??
    (kind === 'image' ? '.jpg' : kind === 'audio' ? '.ogg' : kind === 'video' ? '.mp4' : '.bin')
  );
}

export function mediaDirectory(base = process.cwd()): string {
  const dir = path.join(base, '.wa-media');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * El id se saca del wamid, no de un contador: asi bajar dos veces el mismo
 * mensaje -pasa en las resincronizaciones- reescribe el mismo fichero en vez
 * de dejar copias sueltas.
 */
export function idDeMedia(wamid: string, extension: string): string {
  return createHash('sha1').update(wamid).digest('hex').slice(0, 24) + extension;
}

export interface GuardarMediaDeps {
  dir: string;
  /** Baja el fichero. Se inyecta para poder probar sin red. */
  descargar: (mensaje: unknown) => Promise<Buffer | Readable>;
}

/**
 * Baja el adjunto y lo deja en disco.
 *
 * Devuelve null si el mensaje no lleva ninguno; lanza si la descarga falla,
 * porque el llamador tiene que poder guardar el mensaje igual -aunque sea sin
 * fichero- en vez de perderlo entero.
 */
export async function guardarMedia(
  mensaje: unknown,
  wamid: string,
  deps: GuardarMediaDeps,
): Promise<MediaInfo | null> {
  const m = mensaje as { message?: Record<string, unknown> };
  const { contenido, verUnaVez } = desenvolver(m.message);
  const kind = tipoDeAdjunto(contenido);
  if (!kind) return null;

  const clave = Object.keys(CON_FICHERO).find((k) => contenido[k]) as string;
  const detalle = contenido[clave] as {
    mimetype?: string;
    fileName?: string;
    seconds?: number;
    ptt?: boolean;
    caption?: string;
  };

  const mimeType = detalle.mimetype ?? 'application/octet-stream';
  const id = idDeMedia(wamid, extensionDe(mimeType, kind));

  const bytes = await conCupoDeDescarga(async () => {
    const datos = await deps.descargar(mensaje);
    if (Buffer.isBuffer(datos)) {
      await writeFile(path.join(deps.dir, id), datos);
      return datos.length;
    }
    return guardarFlujo(datos, path.join(deps.dir, id));
  });

  return {
    id,
    kind,
    mimeType,
    filename: detalle.fileName,
    seconds: detalle.seconds,
    voice: detalle.ptt,
    caption: detalle.caption,
    bytes,
    ...(verUnaVez ? { verUnaVez: true } : {}),
  };
}

const NOMBRE_VALIDO = /^[0-9a-f]{24}\.[a-z0-9]{1,5}$/;

/** Abre un fichero ya guardado como flujo, sin leerlo entero. Null si no existe. */
export async function abrirMedia(dir: string, id: string, rango?: { inicio: number; fin: number }): Promise<{ flujo: Readable; bytes: number } | null> {
  if (!NOMBRE_VALIDO.test(id)) return null;
  const ruta = path.join(dir, id);
  const info = await stat(ruta).catch(() => null);
  if (!info?.isFile()) return null;
  const { createReadStream } = await import('node:fs');
  return { flujo: createReadStream(ruta, rango ? { start: rango.inicio, end: rango.fin } : undefined), bytes: info.size };
}

/**
 * El `Range: bytes=a-b` de una peticion, para servir solo ese trozo. Sin el, el
 * navegador no puede saltar a otro punto de un audio o un video ni saber cuanto
 * dura una nota de voz. null = sin rango (se manda entero); 'invalido' = 416.
 */
export function rangoDe(cabecera: string | undefined, total: number): { inicio: number; fin: number } | 'invalido' | null {
  if (!cabecera) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(cabecera.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let inicio: number, fin: number;
  if (m[1] === '') {
    const ultimos = Number(m[2]);
    inicio = Math.max(0, total - ultimos);
    fin = total - 1;
  } else {
    inicio = Number(m[1]);
    fin = m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1);
  }
  if (!Number.isFinite(inicio) || inicio >= total || inicio > fin) return 'invalido';
  return { inicio, fin };
}

/** Cuanto pesa un fichero guardado, o null si no esta. */
export async function tamanoMedia(dir: string, id: string): Promise<number | null> {
  if (!NOMBRE_VALIDO.test(id)) return null;
  const info = await stat(path.join(dir, id)).catch(() => null);
  return info?.isFile() ? info.size : null;
}

/** Borra un fichero guardado. Devuelve si existia. */
export async function borrarMedia(dir: string, id: string): Promise<boolean> {
  if (!NOMBRE_VALIDO.test(id)) return false;
  return unlink(path.join(dir, id)).then(() => true, () => false);
}

/** Lee un fichero ya guardado. `id` viene de la URL, asi que se acota. */
export async function leerMedia(dir: string, id: string): Promise<Buffer | null> {
  // Solo el nombre que genera `idDeMedia`: ni rutas, ni "..", ni nada raro.
  if (!/^[0-9a-f]{24}\.[a-z0-9]{1,5}$/.test(id)) return null;
  try {
    return await readFile(path.join(dir, id));
  } catch {
    return null;
  }
}
