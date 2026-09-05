import pg from 'pg';

/**
 * Postgres devuelve numeric/bigint como string para no perder precision.
 * Los conteos de este proyecto caben de sobra en un number, y recibirlos
 * como string rompe las comparaciones de los gates en silencio.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number.parseInt(value, 10));

export type Pool = pg.Pool;

export function createPool(connectionString: string): Pool {
  return new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}
