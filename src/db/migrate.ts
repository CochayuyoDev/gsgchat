/**
 * Migrador minimo: aplica en orden los .sql de db/migrations que aun no
 * esten registrados. Suficiente para este tamano de proyecto y sin
 * dependencias nuevas.
 *
 * En MySQL/MariaDB el DDL no va dentro de una transaccion (cada `create` o
 * `alter` confirma solo), asi que una migracion que falla a medias NO se
 * deshace: se registra solo cuando termino entera, y las migraciones se
 * escriben para poder repetirse (`create table if not exists`...). Dos
 * procesos que arrancan a la vez no migran a la vez: se turnan con un
 * GET_LOCK por base.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { baseDeLaUrl, createPool, nombreDeBaseSeguro } from './pool.js';

/**
 * Los .sql viven en db/migrations. Con tsx este fichero esta en src/db y el
 * salto de dos niveles llega; compilado esta en dist/src/db y hacen falta
 * tres. Se prueban los dos y ademas el directorio de trabajo, que es lo que
 * usa la imagen de Docker.
 */
function findMigrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), 'db', 'migrations'),
    path.join(here, '..', '..', 'db', 'migrations'),
    path.join(here, '..', '..', '..', 'db', 'migrations'),
  ];
  const found = candidates.find((dir) => existsSync(dir));
  if (!found) throw new Error(`no encuentro db/migrations (busque en: ${candidates.join(', ')})`);
  return found;
}

const MIGRATIONS_DIR = findMigrationsDir();

/** Los nombres de las migraciones, en el orden en que se aplican. */
export async function nombresDeMigraciones(): Promise<string[]> {
  return ficheros();
}

async function ficheros(): Promise<string[]> {
  return (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
}

/**
 * Una huella de las migraciones (nombres y contenido). Si cambia, una base
 * preparada de antemano (ver src/db/bases.ts) ya no sirve y se rehace.
 */
export async function firmaDeMigraciones(): Promise<string> {
  const hash = createHash('sha256');
  for (const file of await ficheros()) {
    hash.update(file).update('\0').update(await readFile(path.join(MIGRATIONS_DIR, file))).update('\0');
  }
  return hash.digest('hex');
}

/** Crea la base si no existe, con el juego de caracteres del proyecto. */
export async function crearBaseSiNoExiste(connectionString: string, baseDeDatos: string): Promise<void> {
  const admin = createPool(connectionString, null);
  try {
    await admin.query(`create database if not exists \`${nombreDeBaseSeguro(baseDeDatos)}\` character set utf8mb4 collate utf8mb4_bin`);
  } finally {
    await admin.end();
  }
}

/**
 * `baseDeDatos`: la de una tienda de la plataforma (se crea si no existe). Sin
 * ella, la de la URL.
 */
export async function migrate(connectionString: string, baseDeDatos?: string): Promise<string[]> {
  const base = baseDeDatos ?? baseDeLaUrl(connectionString);
  if (!base) throw new Error('DATABASE_URL no dice que base usar: termina la URL con /nombre_de_la_base (por ejemplo mysql://root@localhost:3306/gsgchat)');
  await crearBaseSiNoExiste(connectionString, base);

  const pool = createPool(connectionString, base, { multiplesSentencias: true });
  const applied: string[] = [];
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ ok: number | null }>('select get_lock(?, 120) as ok', [`gsgchat_migrar_${base}`]);
    if (rows[0]?.ok !== 1) throw new Error(`otra instancia lleva mas de 2 minutos migrando la base ${base}`);
    try {
      await client.query(
        `create table if not exists schema_migrations (
           name varchar(191) not null primary key,
           applied_at datetime(3) not null default current_timestamp(3)
         ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin`,
      );
      const hechas = new Set((await client.query<{ name: string }>('select name from schema_migrations')).rows.map((r) => r.name));
      for (const file of await ficheros()) {
        if (hechas.has(file)) continue;
        const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values (?)', [file]);
        applied.push(file);
      }
    } finally {
      await client.query('select release_lock(?)', [`gsgchat_migrar_${base}`]).catch(() => undefined);
    }
  } finally {
    client.release();
    await pool.end();
  }
  return applied;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const config = loadConfig();
  const applied = await migrate(config.DATABASE_URL);
  console.log(applied.length ? `Aplicadas: ${applied.join(', ')}` : 'Sin migraciones pendientes.');
}
