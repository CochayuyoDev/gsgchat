/**
 * El fichero de `media.url` en `POST /api/v1/mensajes`: se baja y se comprueba
 * antes de mandarlo por WhatsApp.
 *
 * Lo que dice la otra web (la cabecera content-type, `media.tipo`) no basta:
 * se mira el contenido. Las fotos, videos y audios se aceptan solo en los
 * formatos que WhatsApp admite; cualquier otra cosa se rechaza con 400 antes
 * de gastar un envio. Un documento no se mira (ver `tipoDeAdjuntoSaliente`).
 */

import { MAX_BYTES_ADJUNTO } from '../../admin/chat-routes.js';

type Familia = 'image' | 'video' | 'audio';

/** Un formato admitido, reconocido por los primeros bytes del fichero. */
export interface FormatoMedia {
  familia: Familia;
  mimeType: string;
}

const ascii = (b: Buffer, desde: number, hasta: number) => b.subarray(desde, hasta).toString('latin1');

/** El formato real del fichero, o null si no es uno de los que WhatsApp admite para fotos, videos y audios. */
export function formatoReal(b: Buffer): FormatoMedia | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { familia: 'image', mimeType: 'image/jpeg' };
  if (b[0] === 0x89 && ascii(b, 1, 4) === 'PNG') return { familia: 'image', mimeType: 'image/png' };
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return { familia: 'image', mimeType: 'image/webp' };
  if (ascii(b, 4, 8) === 'ftyp') {
    const marca = ascii(b, 8, 12);
    if (marca === 'M4A ' || marca === 'M4B ') return { familia: 'audio', mimeType: 'audio/mp4' };
    if (marca.startsWith('3gp')) return { familia: 'video', mimeType: 'video/3gpp' };
    // El QuickTime de un iPhone ('qt  ') no lo admite la Cloud API: solo mp4 y 3gp.
    if (marca === 'qt  ') return null;
    return { familia: 'video', mimeType: 'video/mp4' };
  }
  if (ascii(b, 0, 4) === 'OggS') return { familia: 'audio', mimeType: 'audio/ogg' };
  if (ascii(b, 0, 5) === '#!AMR') return { familia: 'audio', mimeType: 'audio/amr' };
  if (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1]! & 0xf6) === 0xf2)) return { familia: 'audio', mimeType: 'audio/mpeg' };
  if (b[0] === 0xff && (b[1]! & 0xf6) === 0xf0) return { familia: 'audio', mimeType: 'audio/aac' };
  return null;
}

const FAMILIA_DE_TIPO: Record<string, Familia | 'document'> = { image: 'image', video: 'video', audio: 'audio', document: 'document' };

/**
 * Lo que se pidio (`media.tipo` o, si no vino, el content-type) contra lo que el
 * fichero es de verdad. Devuelve el mime real, o el motivo del rechazo.
 */
export function comprobarFormato(datos: Buffer, pedido: string | undefined, mimeDeclarado: string): { ok: true; mimeType: string } | { ok: false; error: string } {
  const familiaPedida = pedido ? FAMILIA_DE_TIPO[pedido] : undefined;
  const declarada = mimeDeclarado.startsWith('image/') ? 'image' : mimeDeclarado.startsWith('video/') ? 'video' : mimeDeclarado.startsWith('audio/') ? 'audio' : 'document';
  const esperada = familiaPedida ?? declarada;
  if (esperada === 'document') return { ok: true, mimeType: mimeDeclarado };
  const real = formatoReal(datos);
  if (!real) return { ok: false, error: `el fichero no es una ${{ image: 'foto', video: 'video', audio: 'audio' }[esperada]} en un formato que WhatsApp admita (fotos jpeg, png o webp; videos mp4 o 3gp; audios ogg, mp3, m4a, aac o amr)` };
  if (real.familia !== esperada) return { ok: false, error: `media.tipo dice ${esperada} pero el fichero es ${real.familia} (${real.mimeType})` };
  return { ok: true, mimeType: real.mimeType };
}

/** Lee el cuerpo por trozos y corta en cuanto pasa del tope: un servidor que no dice el largo no llena la memoria. */
async function leerConTope(r: Response, tope: number): Promise<Buffer | null> {
  if (!r.body) {
    const todo = Buffer.from(await r.arrayBuffer());
    return todo.length > tope ? null : todo;
  }
  const trozos: Buffer[] = [];
  let total = 0;
  const lector = r.body.getReader();
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.length;
    if (total > tope) {
      await lector.cancel().catch(() => undefined);
      return null;
    }
    trozos.push(Buffer.from(value));
  }
  return Buffer.concat(trozos);
}

/** Baja el fichero de `media.url`: como mucho 16 MB, en 30 s, y solo si es lo que dice ser. */
export async function bajarMedia(url: string, pedido: string | undefined, fetchImpl: typeof fetch): Promise<{ ok: true; datos: Buffer; mimeType: string } | { ok: false; error: string }> {
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'media.url tiene que empezar por http:// o https://' };
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), 30_000);
  try {
    const r = await fetchImpl(url, { signal: controlador.signal, redirect: 'follow' });
    if (!r.ok) return { ok: false, error: `no se pudo bajar media.url: respondio ${r.status}` };
    const largo = Number(r.headers.get('content-length') ?? 0);
    if (largo > MAX_BYTES_ADJUNTO) return { ok: false, error: 'WhatsApp no acepta ficheros de mas de 16 MB' };
    const datos = await leerConTope(r, MAX_BYTES_ADJUNTO);
    if (!datos) return { ok: false, error: 'WhatsApp no acepta ficheros de mas de 16 MB' };
    if (!datos.length) return { ok: false, error: 'media.url devolvio un fichero vacio' };
    const declarado = (r.headers.get('content-type') ?? 'application/octet-stream').split(';')[0]!.trim().toLowerCase();
    const v = comprobarFormato(datos, pedido, declarado);
    if (!v.ok) return v;
    return { ok: true, datos, mimeType: v.mimeType };
  } catch (error) {
    const abortado = error instanceof Error && error.name === 'AbortError';
    return { ok: false, error: abortado ? 'media.url tardo mas de 30 s en responder' : `no se pudo bajar media.url: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    clearTimeout(temporizador);
  }
}
