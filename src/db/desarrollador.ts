/**
 * El acceso a la base del Modulo desarrollador (src/desarrollador): borrar
 * lo de prueba y adelantar el tiempo de lo de prueba. Es SQL directo sobre
 * la base de ESTA tienda, y solo lo usa ese modulo, siempre acotado a los
 * numeros y referencias de prueba (ver src/desarrollador/numeros.ts).
 */

import type { Pool } from './pool.js';

export interface DesarrolladorRepo {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}

export function createDesarrolladorRepo(pool: Pool): DesarrolladorRepo {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await pool.query(sql, params);
      return { rows: r.rows as T[], rowCount: r.rowCount ?? r.rows.length };
    },
  };
}
