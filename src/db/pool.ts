import pg from 'pg';

/**
 * Postgres devuelve numeric/bigint como string para no perder precision.
 * Los conteos de este proyecto caben de sobra en un number, y recibirlos
 * como string rompe las comparaciones de los gates en silencio.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number.parseInt(value, 10));

export type Pool = pg.Pool;

/**
 * `esquema`: en la plataforma cada tienda vive en su propio esquema de la
 * misma base (tienda_<id>). Todas las consultas del proyecto nombran las
 * tablas sin esquema, asi que con el search_path apuntando al de la tienda
 * cada una ve SOLO sus tablas. `public` va detras para las extensiones.
 */
export function createPool(connectionString: string, esquema?: string): Pool {
  return new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...(esquema ? { options: `-c search_path=${esquemaSeguro(esquema)},public` } : {}),
  });
}

/** Un nombre de esquema que se puede pegar en SQL sin comillas: letras, numeros y _. */
export function esquemaSeguro(esquema: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(esquema)) throw new Error(`nombre de esquema no valido: ${esquema}`);
  return esquema;
}

/**
 * Un `pool` que trata un id que no es uuid como "no existe" en vez de
 * reventar. Postgres contesta 22P02 (invalid_text_representation) al comparar
 * una columna uuid con "no-es-uuid" o "undefined", y eso subia como 500
 * "error interno" a la API publica: quien pego mal un id de webhook o de
 * conector leia que el servidor estaba roto. Con esto la consulta devuelve
 * cero filas y las rutas contestan su 404 de siempre.
 */
export function toleranteAlUuid(pool: Pool): Pool {
  const query = async (text: unknown, params?: unknown) => {
    try {
      return await (pool.query as (t: unknown, p?: unknown) => Promise<unknown>)(text, params);
    } catch (error) {
      if ((error as { code?: string }).code === '22P02' && /uuid/.test(String((error as Error).message))) {
        return { rows: [], rowCount: 0 };
      }
      throw error;
    }
  };
  return new Proxy(pool, {
    get(target, prop, receiver) {
      return prop === 'query' ? query : Reflect.get(target, prop, receiver);
    },
  }) as Pool;
}
