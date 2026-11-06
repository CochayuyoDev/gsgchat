import { spawnSync } from 'node:child_process';

/** Un ogg/opus de verdad (medio segundo): ahora todo audio saliente pasa por ffmpeg, y una firma "OggS" suelta no se convierte. */
export const OGG_REAL: Buffer = (() => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=d=0.5', '-c:a', 'libopus', '-f', 'ogg', 'pipe:1'], { maxBuffer: 10_000_000 });
  if (r.status !== 0 || !r.stdout.length) throw new Error('las pruebas de audio necesitan ffmpeg en el PATH');
  return r.stdout;
})();
