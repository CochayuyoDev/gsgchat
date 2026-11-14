import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { webmOpusAOgg } from '../../src/whatsapp/audio-saliente.js';

/**
 * Un ogg/opus de verdad: sale de una nota de voz grabada por Chrome (tests/fixtures/nota-de-voz-chrome.webm)
 * pasada a ogg por el conversor propio, asi que las pruebas de audio no necesitan ffmpeg ni su PATH.
 * Una firma "OggS" suelta no vale: el envio mira que lleve la cabecera "OpusHead".
 */
export const OGG_REAL: Buffer = (() => {
  const ogg = webmOpusAOgg(readFileSync(join(__dirname, 'nota-de-voz-chrome.webm')));
  if (!ogg) throw new Error('no se pudo sacar un ogg/opus de la muestra de Chrome');
  return ogg;
})();
