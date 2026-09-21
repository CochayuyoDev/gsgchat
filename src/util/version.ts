/**
 * La version del paquete, leida de package.json una sola vez. Vale igual
 * corriendo desde `src/` (tsx) que desde `dist/`: los dos estan un nivel por
 * debajo de la raiz.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let cache: string | null = null;

export function versionDelPaquete(): string {
  if (cache) return cache;
  try {
    const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const pkg = JSON.parse(readFileSync(path.join(raiz, 'package.json'), 'utf8')) as { version?: string };
    cache = pkg.version ?? '0.0.0';
  } catch {
    cache = process.env.npm_package_version ?? '0.0.0';
  }
  return cache;
}
