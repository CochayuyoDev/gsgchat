/**
 * Cada pestaña del Modulo desarrollador es una seccion independiente: su
 * HTML, su JS (en String.raw, sin backticks ni `${`) y sus rutas. La pagina
 * (pagina.ts) solo las junta en pestañas. Asi cada parte vive en su fichero.
 */

import type { FastifyInstance } from 'fastify';
import type { WebDeps } from '../web/routes.js';
import type { PuertoGsg } from '../rutas/gsg.js';

export interface SeccionDesarrollador {
  /** El ancla de la pestaña: /desarrollador#<id>. */
  id: 'generar' | 'vivo' | 'listo' | 'procesos';
  titulo: string;
  /** Una linea bajo el titulo de la pestaña. */
  resumen: string;
  html: string;
  /** Se ejecuta una vez al cargar la pagina, dentro de su propio bloque. */
  js: string;
  css?: string;
}

/**
 * Lo que recibe el modulo: lo mismo que las pantallas (WebDeps) mas la puerta
 * a GSG vigente. `app` sirve para llamar a la API publica por dentro
 * (app.inject), que es justo lo que se quiere probar.
 */
export type DepsDesarrollador = WebDeps & { gsg?: PuertoGsg };

export type RegistrarSeccion = (app: FastifyInstance, deps: DepsDesarrollador) => Promise<void>;
