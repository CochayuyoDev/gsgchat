/**
 * Dónde dejó cada cuadro del flujo de Inicio el administrador de la tienda
 * (src/web/flujo-inicio.ts). Se guarda en la tabla `settings` de la propia
 * tienda, así que cada tienda tiene su orden y nadie pisa el de otra.
 */

import type { Pool } from './pool.js';

export const CLAVE_DISPOSICION_FLUJO = 'flujo.disposicion';

/** id del cuadro → [x, y] en el lienzo. Solo los que se movieron. */
export type DisposicionFlujo = Record<string, [number, number]>;

export interface FlujoDisposicionRepo {
  leer(): Promise<DisposicionFlujo | null>;
  guardar(d: DisposicionFlujo): Promise<void>;
  borrar(): Promise<void>;
}

/** La misma cosa en memoria, para las pruebas y el escenario de demostración. */
export function crearFlujoDisposicionEnMemoria(): FlujoDisposicionRepo {
  let guardada: DisposicionFlujo | null = null;
  return {
    async leer() {
      return guardada ? JSON.parse(JSON.stringify(guardada)) : null;
    },
    async guardar(d) {
      guardada = JSON.parse(JSON.stringify(d));
    },
    async borrar() {
      guardada = null;
    },
  };
}

export function crearFlujoDisposicionRepo(pool: Pool): FlujoDisposicionRepo {
  return {
    async leer() {
      const { rows } = await pool.query<{ value: string }>('select value from settings where `key` = $1', [CLAVE_DISPOSICION_FLUJO]);
      if (!rows[0]) return null;
      try {
        const v = JSON.parse(rows[0].value);
        return v && typeof v === 'object' && !Array.isArray(v) ? (v as DisposicionFlujo) : null;
      } catch {
        return null;
      }
    },
    async guardar(d) {
      await pool.query(
        `insert into settings (\`key\`, value, encrypted, updated_at) values ($1,$2,false,now(3))
         on duplicate key update value = values(value), updated_at = now(3)`,
        [CLAVE_DISPOSICION_FLUJO, JSON.stringify(d)],
      );
    },
    async borrar() {
      await pool.query('delete from settings where `key` = $1', [CLAVE_DISPOSICION_FLUJO]);
    },
  };
}
