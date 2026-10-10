/**
 * Bases de MySQL/MariaDB para las pruebas.
 *
 * Las pruebas de SQL corren contra un servidor de verdad (por defecto el de
 * esta maquina, root sin clave en 127.0.0.1:3306; otro con
 * GSG_TEST_MYSQL_URL). Crear las ~50 tablas cuesta DDL -en un disco lento,
 * mas de un minuto-, asi que las bases de prueba NO se crean en cada
 * ejecucion: hay unas cuantas fijas (`gsgchat_prueba_<n>`) que se reutilizan.
 * Cada fichero de pruebas aparta una con GET_LOCK (dos ficheros en paralelo
 * nunca comparten base), la vacia y la usa. Solo se rehacen cuando cambian
 * las migraciones.
 */

import { createPool, type Pool } from '../src/db/pool.js';
import { borrarBase, devolverAlBanco, vaciar, type OpcionesBanco } from '../src/db/bases.js';
import { firmaDeMigraciones, migrate, nombresDeMigraciones } from '../src/db/migrate.js';

export const URL_PRUEBAS = process.env.GSG_TEST_MYSQL_URL?.trim() || 'mysql://root@127.0.0.1:3306/';

/** Prefijo de TODAS las bases que crean las pruebas (bancos de tiendas incluidos). */
export const PREFIJO_PRUEBAS = 'gsgchat_prueba_';

export interface BaseDePrueba {
  pool: Pool;
  /** URL con la base puesta: mysql://.../gsgchat_prueba_3 */
  url: string;
  base: string;
  /** Vacia la base (sin borrar la estructura). */
  vaciar(): Promise<void>;
  /** Cierra el pool y suelta la base para otro fichero. */
  cerrar(): Promise<void>;
}

/** La URL del servidor de pruebas apuntando a una base. */
export function urlConBase(base: string): string {
  const u = new URL(URL_PRUEBAS.replace(/^mariadb:/i, 'mysql:'));
  u.pathname = `/${base}`;
  return u.toString();
}

async function lista(admin: Pool, base: string): Promise<boolean> {
  const existe = await admin.query('select 1 from information_schema.schemata where schema_name = ?', [base]);
  if (!existe.rowCount) return false;
  const hechas = await admin.query<{ name: string }>(`select name from \`${base}\`.schema_migrations order by name`).catch(() => null);
  if (!hechas) return false;
  const firma = await admin.query<{ firma: string }>(`select firma from \`${base}\`.gsgchat_banco limit 1`).catch(() => null);
  return (
    hechas.rows.map((r) => r.name).join('\n') === (await nombresDeMigraciones()).join('\n') &&
    firma?.rows[0]?.firma === (await firmaDeMigraciones())
  );
}

/**
 * Aparta una base de prueba vacia y con todas las migraciones.
 * `hookTimeout` de vitest esta alto porque la PRIMERA vez hay que crearla.
 */
export async function baseDePrueba(): Promise<BaseDePrueba> {
  const admin = createPool(URL_PRUEBAS, null);
  const candado = await admin.connect();
  let base: string | null = null;
  for (let n = 1; n <= 64 && !base; n++) {
    const nombre = `${PREFIJO_PRUEBAS}${n}`;
    const { rows } = await candado.query<{ ok: number | null }>('select get_lock(?, 0) as ok', [nombre]);
    if (rows[0]?.ok === 1) base = nombre;
  }
  if (!base) throw new Error('las 64 bases de prueba estan ocupadas');

  try {
    if (await lista(admin, base)) {
      await vaciar(admin, base);
    } else {
      await borrarBase(URL_PRUEBAS, base);
      await migrate(URL_PRUEBAS, base);
      const firma = await firmaDeMigraciones();
      await admin.query(`create table if not exists \`${base}\`.gsgchat_banco (firma varchar(64) not null) engine=InnoDB`);
      await admin.query(`insert into \`${base}\`.gsgchat_banco (firma) values (?)`, [firma]);
    }
  } catch (error) {
    candado.release();
    await admin.end();
    throw error;
  }

  const pool = createPool(URL_PRUEBAS, base);
  const nombre = base;
  return {
    pool,
    url: urlConBase(base),
    base,
    vaciar: () => vaciar(admin, nombre),
    async cerrar() {
      await pool.end().catch(() => undefined);
      await candado.query('select release_lock(?)', [nombre]).catch(() => undefined);
      candado.release();
      await admin.end();
    },
  };
}

/**
 * El banco de bases de tienda de las pruebas de la plataforma: las tiendas
 * que se crean en una prueba se DEVUELVEN al banco al terminar (con
 * `devolverBasesDePrueba`), y la siguiente ejecucion las reutiliza.
 */
export function bancoDePrueba(prefijo: string, reserva = 0): OpcionesBanco {
  if (!prefijo.startsWith(PREFIJO_PRUEBAS)) throw new Error(`el prefijo de las pruebas tiene que empezar por ${PREFIJO_PRUEBAS}`);
  return { url: URL_PRUEBAS, prefijo, reserva };
}

/** Devuelve al banco (vaciadas) todas las bases que empiezan por `prefijo` y no son del banco. */
export async function devolverBasesDePrueba(o: OpcionesBanco): Promise<void> {
  const admin = createPool(URL_PRUEBAS, null);
  try {
    const { rows } = await admin.query<{ b: string }>('select schema_name as b from information_schema.schemata where schema_name like ?', [
      `${o.prefijo.replace(/_/g, '\\_')}%`,
    ]);
    for (const { b } of rows) {
      if (b.startsWith(`${o.prefijo}banco_`)) continue;
      await devolverAlBanco(o, b);
    }
  } finally {
    await admin.end();
  }
}
