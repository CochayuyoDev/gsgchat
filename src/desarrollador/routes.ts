/**
 * El Modulo desarrollador: la pagina /desarrollador y sus rutas
 * /admin/desarrollador/*. Solo lo usa una PERSONA con rol de administrador
 * (admin o superadmin): ni operadores ni claves de API.
 *
 * Funciona por tienda: se registra dentro de cada tienda de la plataforma, con
 * sus repos, su sender y su simulador; nada de aqui ve otra tienda.
 */

import type { FastifyInstance } from 'fastify';
import { desarrolladorPage } from './pagina.js';
import { registerGenerar } from './generar.js';
import { registerVivo } from './vivo.js';
import { registerListo } from './listo.js';
import type { DepsDesarrollador } from './seccion.js';

export const PREFIJO_ADMIN_DESARROLLADOR = '/admin/desarrollador';

export async function registerDesarrollador(app: FastifyInstance, deps: DepsDesarrollador): Promise<void> {
  // La puerta: persona y administrador. El hook de auth ya exige sesion en /admin.
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith(PREFIJO_ADMIN_DESARROLLADOR)) return;
    const u = request.usuario;
    if (!u) return; // auth ya contesto 401
    if (u.porToken) return reply.code(403).send({ error: 'El módulo desarrollador lo usa una persona desde el panel, no una clave de API.' });
    if (u.rol !== 'admin') return reply.code(403).send({ error: 'Solo un administrador usa el módulo desarrollador.' });
  });

  app.get('/desarrollador', async (request, reply) => {
    const page = desarrolladorPage({
      nombreNegocio: deps.ajustes?.nombreNegocio() ?? deps.config.businessName,
      demo: deps.config.DEMO_MODE,
      esAdmin: request.usuario?.rol === 'admin' && !request.usuario.porToken,
    });
    return reply.type('text/html; charset=utf-8').header('cache-control', 'no-store').send(page);
  });

  await registerGenerar(app, deps);
  await registerVivo(app, deps);
  await registerListo(app, deps);
}
