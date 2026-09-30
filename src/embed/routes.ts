/**
 * Las rutas del chat embebido: la pagina, el script y las cabeceras.
 *
 * `/embed/chat` es publica (sin sesion): lo que la protege es que sin token
 * no ensena nada, y el token lo pone la web que la embebe. La cabecera
 * `Content-Security-Policy: frame-ancestors` dice desde que webs se puede
 * enmarcar: las del ajuste "dominios que pueden embeber" y este mismo
 * sitio. Sin dominios configurados, ninguna web ajena puede meterla en un
 * iframe, aunque tenga un token valido.
 *
 * El resto del sitio no cambia: /panel y /chat siguen sin poder enmarcarse.
 */

import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { ServicioAjustes } from '../ajustes/generales.js';
import { normalizePhone } from '../db/repos.js';
import { embedChatPage } from './page.js';
import { embedScript } from './embed-js.js';

export interface EmbedDeps {
  config: Config;
  ajustes?: ServicioAjustes;
}

/** La cabecera CSP para las paginas embebibles. */
export function frameAncestors(dominios: string[]): string {
  const limpios = dominios.map((d) => d.trim()).filter((d) => /^https?:\/\/[^\s'";]+$/i.test(d));
  return `frame-ancestors 'self'${limpios.length ? ' ' + limpios.join(' ') : ''}`;
}

export async function registerEmbedRoutes(app: FastifyInstance, deps: EmbedDeps): Promise<void> {
  const { config } = deps;
  const origen = config.PUBLIC_BASE_URL.replace(/\/+$/, '');
  const dominios = () => deps.ajustes?.dominiosEmbebido() ?? [];

  app.get('/embed.js', async (_request, reply) => {
    return reply
      .type('application/javascript; charset=utf-8')
      .header('cache-control', 'public, max-age=300')
      .send(embedScript(origen));
  });

  app.get('/embed/chat', async (request, reply) => {
    const query = request.query as { telefono?: string };
    const telefono = typeof query.telefono === 'string' && query.telefono.trim() ? normalizePhone(query.telefono) : null;
    return reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .header('content-security-policy', frameAncestors(dominios()))
      .send(embedChatPage({ nombreNegocio: deps.ajustes?.nombreNegocio() ?? config.businessName, telefono }));
  });
}
