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

export interface AudioListo {
  datos: Buffer;
  mimeType: string;
  filename?: string;
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

/** Deja el audio siempre en ogg/opus. */
export async function audioParaMeta(media: { datos: Buffer; mimeType: string; filename?: string; voz?: boolean }): Promise<AudioListo> {
  if (!audioNecesitaConversion(media.datos)) {
    return { datos: media.datos, mimeType: 'audio/ogg', filename: media.filename };
  }
  const datos = await convertirAOggOpus(media.datos);
  const base = (media.filename ?? 'audio').replace(/\.[^.]+$/, '') || 'audio';
  return { datos, mimeType: 'audio/ogg', filename: `${base}.ogg` };
}
