/**
 * En que tienda se esta trabajando ahora mismo.
 *
 * Los DATOS de cada tienda no dependen de esto: cada una se arma con su base,
 * su sesion de WhatsApp y sus carpetas, y nada se busca "por la tienda
 * actual" (ver src/plataforma/tienda.ts). Esto solo sirve para lo que se pinta
 * y no recibe la tienda por parametro, como el modo del menu del armazon
 * (src/web/shell.ts), que antes era uno por proceso y con dos tiendas se lo
 * quedaba la ultima que arrancaba.
 *
 * La plataforma envuelve cada peticion y el arranque de cada tienda (timers,
 * sockets de WhatsApp) en `enTienda`, asi que todo lo que nace de ahi hereda
 * su tienda.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface ContextoTienda {
  id: string;
  slug: string;
  /** El modo del menu de esta tienda (gsg | completo). */
  modo?: () => 'gsg' | 'completo';
}

const almacen = new AsyncLocalStorage<ContextoTienda>();

export function enTienda<T>(contexto: ContextoTienda, fn: () => T): T {
  return almacen.run(contexto, fn);
}

export function tiendaActual(): ContextoTienda | undefined {
  return almacen.getStore();
}
