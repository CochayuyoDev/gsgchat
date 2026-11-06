/**
 * Audios para la Cloud API de Meta.
 *
 * Meta solo admite como audio: aac, mp4 (m4a), mpeg (mp3), amr y ogg con opus.
 * El micro del navegador graba webm, y otras apps mandan wav, flac o webm: Meta
 * los rechaza al subirlos y el audio nunca llega. Todo audio que no sea ya mp3
 * se pasa a mp3 con ffmpeg antes de subirlo.
 */

import { spawn } from 'node:child_process';

export interface AudioListo {
  datos: Buffer;
  mimeType: string;
  filename?: string;
}

export function audioNecesitaConversion(mimeType: string): boolean {
  const mime = mimeType.split(';')[0]!.trim().toLowerCase();
  return mime !== 'audio/mpeg' && mime !== 'audio/mp3';
}

/** Pasa el audio a mp3. Falla con un mensaje claro si ffmpeg no esta o no puede leerlo. */
export function convertirAMp3(datos: Buffer, timeoutMs = 60_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-c:a', 'libmp3lame', '-b:a', '64k', '-ar', '44100', '-ac', '1', '-f', 'mp3', 'pipe:1'], {
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
      else reject(new Error(`no se pudo convertir el audio a mp3: ${errores.trim().slice(0, 200) || `ffmpeg salio con ${codigo}`}`));
    });
    ff.stdin.on('error', () => undefined);
    ff.stdin.end(datos);
  });
}

/** Deja el audio siempre en mp3. */
export async function audioParaMeta(media: { datos: Buffer; mimeType: string; filename?: string; voz?: boolean }): Promise<AudioListo> {
  if (!audioNecesitaConversion(media.mimeType)) {
    return { datos: media.datos, mimeType: 'audio/mpeg', filename: media.filename };
  }
  const datos = await convertirAMp3(media.datos);
  const base = (media.filename ?? 'audio').replace(/\.[^.]+$/, '') || 'audio';
  return { datos, mimeType: 'audio/mpeg', filename: `${base}.mp3` };
}
