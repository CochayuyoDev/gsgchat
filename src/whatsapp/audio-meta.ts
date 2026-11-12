/**
 * Audios para la Cloud API de Meta.
 *
 * Meta solo admite como audio: aac, mp4 (m4a), mpeg (mp3), amr y ogg con opus.
 * El micro del navegador graba webm, y otras apps mandan wav, flac o webm: Meta
 * los rechaza al subirlos y el audio nunca llega. Todo audio que no sea ya
 * ogg/opus se pasa a ogg/opus con ffmpeg: es lo unico que WhatsApp muestra como
 * nota de voz (con su onda y su micro) y lo que Meta admite como tal.
 */

import { spawn } from 'node:child_process';
import { webmOpusAOgg } from './audio-saliente.js';

export interface AudioListo {
  datos: Buffer;
  mimeType: string;
  filename?: string;
  /** true = sale como nota de voz (solo un ogg/opus puede serlo); false = audio normal con su tipo. */
  voz: boolean;
}

/** Ya es ogg con opus dentro (un ogg con vorbis no vale): se mira la cabecera "OpusHead". */
export function esOggOpus(datos: Buffer): boolean {
  return datos.subarray(0, 4).toString('latin1') === 'OggS' && datos.subarray(0, 128).includes('OpusHead');
}

export function audioNecesitaConversion(datos: Buffer): boolean {
  return !esOggOpus(datos);
}

/** Pasa el audio a ogg/opus. Falla con un mensaje claro si ffmpeg no esta o no puede leerlo. */
export function convertirAOggOpus(datos: Buffer, timeoutMs = 60_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', '-application', 'voip', '-f', 'ogg', 'pipe:1'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const salida: Buffer[] = [];
    let errores = '';
    const reloj = setTimeout(() => {
      ff.kill('SIGKILL');
      reject(new Error('ffmpeg tardo demasiado convirtiendo el audio'));
    }, timeoutMs);
    ff.stdout.on('data', (c: Buffer) => salida.push(c));
    ff.stderr.on('data', (c: Buffer) => { errores += c.toString(); });
    ff.on('error', (e) => {
      clearTimeout(reloj);
      reject(new Error(`no se pudo convertir el audio: ffmpeg no esta disponible (${e.message})`));
    });
    ff.on('close', (codigo) => {
      clearTimeout(reloj);
      const fuera = Buffer.concat(salida);
      if (codigo === 0 && fuera.length) resolve(fuera);
      else reject(new Error(`no se pudo convertir el audio a ogg/opus: ${errores.trim().slice(0, 200) || `ffmpeg salio con ${codigo}`}`));
    });
    ff.stdin.on('error', () => undefined);
    ff.stdin.end(datos);
  });
}

const FIRMA_WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

/** Los formatos que Meta y WhatsApp reproducen tal cual (aac, m4a, mp3, amr): si no se pueden pasar a ogg, salen como audio normal. */
function formatoNativo(datos: Buffer, mimeType: string): { mimeType: string; extension: string } | null {
  const tipo = mimeType.split(';')[0]!.trim().toLowerCase();
  const cab = datos.subarray(0, 12);
  const esMp3 = tipo === 'audio/mpeg' || tipo === 'audio/mp3' || cab.subarray(0, 3).toString('latin1') === 'ID3' || (cab[0] === 0xff && ((cab[1] ?? 0) & 0xe0) === 0xe0);
  if (esMp3) return { mimeType: 'audio/mpeg', extension: 'mp3' };
  if (['audio/mp4', 'audio/x-m4a', 'audio/m4a'].includes(tipo) || cab.subarray(4, 8).toString('latin1') === 'ftyp') return { mimeType: 'audio/mp4', extension: 'm4a' };
  if (tipo === 'audio/aac' || tipo === 'audio/x-aac') return { mimeType: 'audio/aac', extension: 'aac' };
  if (tipo === 'audio/amr' || cab.subarray(0, 5).toString('latin1') === '#!AMR') return { mimeType: 'audio/amr', extension: 'amr' };
  return null;
}

/**
 * Deja el audio listo para que WhatsApp lo entregue y lo reproduzca:
 * 1. ogg/opus: tal cual, como nota de voz.
 * 2. webm/opus (lo que graba Chrome): se pasa a ogg/opus sin ffmpeg ni recodificar.
 * 3. Otro formato: ffmpeg a ogg/opus; si no esta o falla, y el formato ya lo acepta
 *    WhatsApp (mp3, m4a, aac, amr), sale como audio normal con su tipo.
 * Nunca sale un audio que WhatsApp no pueda reproducir: si no hay forma, falla y se dice.
 */
export async function audioParaMeta(media: { datos: Buffer; mimeType: string; filename?: string; voz?: boolean }): Promise<AudioListo> {
  if (!audioNecesitaConversion(media.datos)) {
    return { datos: media.datos, mimeType: 'audio/ogg', filename: media.filename, voz: true };
  }
  const base = (media.filename ?? 'audio').replace(/\.[^.]+$/, '') || 'audio';
  const esWebm = media.datos.subarray(0, 4).equals(FIRMA_WEBM) || media.mimeType.split(';')[0]!.trim().toLowerCase() === 'audio/webm';
  if (esWebm) {
    const ogg = webmOpusAOgg(media.datos);
    if (ogg && esOggOpus(ogg)) return { datos: ogg, mimeType: 'audio/ogg', filename: `${base}.ogg`, voz: true };
  }
  try {
    const datos = await convertirAOggOpus(media.datos);
    if (esOggOpus(datos)) return { datos, mimeType: 'audio/ogg', filename: `${base}.ogg`, voz: true };
    throw new Error('ffmpeg no dejo un ogg con opus');
  } catch (error) {
    const nativo = esWebm ? null : formatoNativo(media.datos, media.mimeType);
    if (nativo) return { datos: media.datos, mimeType: nativo.mimeType, filename: `${base}.${nativo.extension}`, voz: false };
    if (esWebm) throw new Error('No se pudo preparar este audio para WhatsApp. Grábalo de nuevo o usa un fichero mp3, m4a u ogg.');
    throw error;
  }
}
