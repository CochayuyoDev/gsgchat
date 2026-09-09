/**
 * Postgres de verdad, en un fichero, sin instalar nada.
 *
 * PGlite es Postgres compilado a WebAssembly: el mismo SQL, las mismas
 * migraciones y los mismos repositorios que en produccion, pero guardando en
 * una carpeta local en vez de en un servidor.
 *
 * Existe para el arranque corto (`npm run quick`): sin esto la unica
 * alternativa sin Docker era la capa en memoria, y ahi cada reinicio se lleva
 * por delante los contactos y el historial. Los tests ya corrian las
 * migraciones sobre PGlite, asi que el motor estaba probado antes de usarse
 * aqui.
 *
 * No es un sustituto de Postgres para produccion: es un proceso, un fichero y
 * sin concurrencia entre servidores.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from './pool.js';

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations');

/**
 * Adaptador de PGlite a la interfaz de `pg.Pool` que usan los repositorios.
 * Solo se usan `query`, `connect` y `end`.
 */
export function asPool(db: PGlite): Pool {
  const query = async (text: string, params?: unknown[]) => {
    const result = await db.query(text, params as never[], {
      // pg entrega bigint/numeric como string para no perder precision, y
      // src/db/pool.ts los convierte a number. Aqui se hace lo mismo para que
      // los repositorios vean exactamente los mismos tipos.
      parsers: { 20: (v: string) => Number.parseInt(v, 10) },
    });
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  };
  const client = { query, release: () => undefined };
  return {
    query,
    connect: async () => client,
    end: async () => db.close(),
  } as unknown as Pool;
}

export interface PgliteHandle {
  pool: Pool;
  db: PGlite;
  /** Migraciones aplicadas en este arranque. */
  applied: string[];
}

/**
 * Abre (o crea) la base en `dataDir` y deja las migraciones aplicadas.
 *
 * Las migraciones son idempotentes -todas usan `if not exists`-, asi que
 * pasarlas en cada arranque es seguro y ahorra tener que llevar la cuenta.
 */
export async function openPglite(dataDir: string): Promise<PgliteHandle> {
  const db = new PGlite(dataDir);
  await db.waitReady;

  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    await db.exec(await readFile(path.join(MIGRATIONS, file), 'utf8'));
  }

  return { pool: asPool(db), db, applied: files };
}
