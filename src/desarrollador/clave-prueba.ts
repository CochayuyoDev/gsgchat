/**
 * La clave de API de prueba del Modulo desarrollador.
 *
 * Los pedidos de prueba entran por la API publica igual que llegarian de GSG
 * (POST /api/v1/entregas con `Authorization: Bearer wak_...`), asi el
 * generador prueba tambien el endpoint, la clave y sus permisos. La clave se
 * crea para cada tanda, solo con permisos de entregas, se usa por dentro
 * (app.inject) y se revoca al terminar: nunca sale a la pantalla y no queda
 * ninguna viva que alguien pueda copiar.
 */

import type { ClavesApiRepo } from '../auth/claves-api.js';
import { generarClaveApi, hashClaveApi, prefijoDeClave } from '../auth/claves-api.js';

export const NOMBRE_CLAVE_PRUEBA = 'Módulo desarrollador (prueba)';
export const PERMISOS_CLAVE_PRUEBA = ['entregas:leer', 'entregas:gestionar'];

/** Crea la clave, la presta a `fn` y la revoca pase lo que pase. */
export async function conClaveDePrueba<T>(claves: ClavesApiRepo, creadaPor: string | null, fn: (clave: string) => Promise<T>): Promise<T> {
  const clave = generarClaveApi();
  const registro = await claves.crear({ nombre: NOMBRE_CLAVE_PRUEBA, prefijo: prefijoDeClave(clave), hash: hashClaveApi(clave), creadaPor, permisos: PERMISOS_CLAVE_PRUEBA });
  try {
    return await fn(clave);
  } finally {
    await claves.revocar(registro.id).catch(() => undefined);
  }
}
