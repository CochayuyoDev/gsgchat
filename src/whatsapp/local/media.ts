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
import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
  descargar: (mensaje: unknown) => Promise<Buffer>;
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

  const datos = await deps.descargar(mensaje);
  await writeFile(path.join(deps.dir, id), datos);

  return {
    id,
    kind,
    mimeType,
    filename: detalle.fileName,
    seconds: detalle.seconds,
    voice: detalle.ptt,
    caption: detalle.caption,
    bytes: datos.length,
    ...(verUnaVez ? { verUnaVez: true } : {}),
  };
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
