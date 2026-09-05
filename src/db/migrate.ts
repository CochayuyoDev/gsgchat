/**
 * Migrador minimo: aplica en orden los .sql de db/migrations que aun no
 * esten registrados. Suficiente para este tamano de proyecto y sin
 * dependencias nuevas.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { createPool } from './pool.js';

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'db',
  'migrations',
);

export async function migrate(connectionString: string): Promise<string[]> {
  const pool = createPool(connectionString);
  const applied: string[] = [];

  try {
    await pool.query(
      `create table if not exists schema_migrations (
         name text primary key,
         applied_at timestamptz not null default now()
       )`,
    );

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      const { rowCount } = await pool.query('select 1 from schema_migrations where name = $1', [file]);
      if (rowCount) continue;

      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
        applied.push(file);
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }

  return applied;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const config = loadConfig();
  const applied = await migrate(config.DATABASE_URL);
  console.log(applied.length ? `Aplicadas: ${applied.join(', ')}` : 'Sin migraciones pendientes.');
}
