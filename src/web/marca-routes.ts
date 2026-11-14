/**
 * El favicon, los iconos del celular y el logo de GSGchat.
 *
 * Los sirven igual la plataforma (portada, login, paginas legales) y cada
 * tienda (el panel), asi que las rutas y la cabecera <link> viven aqui.
 */

import type { FastifyInstance } from 'fastify';
import { FAVICON_32_PNG_BASE64, ICONO_180_PNG_BASE64, ICONO_192_PNG_BASE64, ICONO_512_PNG_BASE64, LOGO_MARCA_PNG_BASE64 } from './iconos.js';

/** La ruta del logo (hexagono verde) para los <img> de la web. */
export const RUTA_LOGO = '/logo.png';

/** Las rutas de los iconos: las atiende la plataforma sin sesion ni tienda. */
export const RUTAS_MARCA: ReadonlyArray<readonly [string, string]> = [
  ['/favicon.ico', FAVICON_32_PNG_BASE64],
  ['/favicon.png', FAVICON_32_PNG_BASE64],
  ['/apple-touch-icon.png', ICONO_180_PNG_BASE64],
  ['/icono-192.png', ICONO_192_PNG_BASE64],
  ['/icono-512.png', ICONO_512_PNG_BASE64],
  [RUTA_LOGO, LOGO_MARCA_PNG_BASE64],
];

/** Va en el <head> de cada pagina: el favicon de la pestana y el del iPhone. */
export const ICONOS_HEAD =
  '<link rel="icon" type="image/png" sizes="32x32" href="/favicon.png">' +
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">';

export function registerMarcaRoutes(app: FastifyInstance): void {
  for (const [ruta, base64] of RUTAS_MARCA) {
    const bytes = Buffer.from(base64, 'base64');
    app.get(ruta, async (_request, reply) => reply.type('image/png').header('cache-control', 'public, max-age=86400').send(bytes));
  }
}
