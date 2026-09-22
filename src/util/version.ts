/**
 * La version del paquete, leida de package.json una sola vez. Vale igual
 * corriendo desde `src/` (tsx) que desde `dist/`: los dos estan un nivel por
 * debajo de la raiz.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let cache: string | null = null;

export function versionDelPaquete(): string {
  if (cache) return cache;
  try {
    // src/util → ../../package.json; dist/src/util → ../../../package.json.
    let dir = path.dirname(fileURLToPath(import.meta.url));
    let ruta = '';
    for (let i = 0; i < 5 && !ruta; i++) {
      const candidato = path.join(dir, 'package.json');
      if (existsSync(candidato)) ruta = candidato;
      else dir = path.dirname(dir);
    }
    if (!ruta) throw new Error('sin package.json');
    const pkg = JSON.parse(readFileSync(ruta, 'utf8')) as { version?: string };
    cache = pkg.version ?? '0.0.0';
  } catch {
    cache = process.env.npm_package_version ?? '0.0.0';
  }
  return cache;
}
