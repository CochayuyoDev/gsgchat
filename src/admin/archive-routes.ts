/**
 * API de los respaldos de conversacion.
 *
 * Cerrar un chat, ver lo guardado, descargarlo, devolverlo a la base y saber
 * si los ficheros siguen intactos. Todo detras del token de admin, como el
 * resto de /admin.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Repos } from '../db/repos.js';
import {
  archivarConversacion,
  barrerInactivas,
  leerRespaldo,
  restaurarRespaldo,
  revisarRespaldos,
  type ArchiveDeps,
} from '../archive/service.js';
import { borrarArchivo, leerCrudo } from '../archive/store.js';

export interface ArchiveRoutesDeps {
  repos: Repos;
  /** Directorio de respaldos. */
  dir: string;
  /** Dias de inactividad tras los que se cierra sola una conversacion. */
  dias: number;
}

const listQuery = z.object({
  contactId: z.string().optional(),
  q: z.string().max(120).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export async function registerArchiveRoutes(
  app: FastifyInstance,
  deps: ArchiveRoutesDeps,
): Promise<void> {
  const { repos, dir } = deps;
  const service: ArchiveDeps = {
    repos,
    dir,
    log: (mensaje, detalle) => app.log.info(detalle ?? {}, mensaje),
  };

  /** Cierra el chat: lo respalda entero y lo vacia de la base. */
  app.post<{ Params: { contactId: string } }>(
    '/admin/chat/:contactId/archive',
    async (request, reply) => {
      const salida = await archivarConversacion(service, request.params.contactId, 'manual');
      if (!salida.ok) return reply.code(409).send({ error: salida.motivo });
      return salida;
    },
  );

  app.get('/admin/archives', async (request) => {
    const query = listQuery.parse(request.query ?? {});
    return {
      items: await repos.archives.list(query),
      stats: await repos.archives.stats(),
      // Lo que el panel necesita para explicar la limpieza automatica.
      inactividadDias: deps.dias,
    };
  });

  /** El hilo guardado, para leerlo sin restaurarlo. */
  app.get<{ Params: { id: string } }>('/admin/archives/:id', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'Identificador no válido.' });
    const leido = await leerRespaldo(service, id);
    if (!leido) return reply.code(404).send({ error: 'Ese respaldo ya no existe.' });
    return leido;
  });

  /** El fichero tal cual, comprimido. Es la copia que se lleva uno de aqui. */
  app.get<{ Params: { id: string } }>('/admin/archives/:id/download', async (request, reply) => {
    const id = Number(request.params.id);
    const archive = Number.isInteger(id) ? await repos.archives.get(id) : null;
    if (!archive) return reply.code(404).send({ error: 'Ese respaldo ya no existe.' });

    const nombre = `chat-${archive.phone}-${archive.createdAt.toISOString().slice(0, 10)}.ndjson.gz`;
    return reply
      .type('application/gzip')
      .header('content-disposition', `attachment; filename="${nombre}"`)
      .send(leerCrudo(dir, archive.file));
  });

  app.post<{ Params: { id: string } }>('/admin/archives/:id/restore', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'Identificador no válido.' });
    const salida = await restaurarRespaldo(service, id);
    if (!salida.ok) return reply.code(409).send({ error: salida.motivo });
    return salida;
  });

  /**
   * Borra un respaldo, fichero incluido.
   *
   * Pide `?confirmar=si` a proposito: es la unica operacion del sistema tras
   * la cual esa conversacion no existe en ninguna parte.
   */
  app.delete<{ Params: { id: string } }>('/admin/archives/:id', async (request, reply) => {
    const query = z.object({ confirmar: z.string().optional() }).parse(request.query ?? {});
    if (query.confirmar !== 'si') {
      return reply.code(400).send({
        error: 'Esto borra la única copia que queda de esa conversación: repite con ?confirmar=si',
      });
    }
    const id = Number(request.params.id);
    const archive = Number.isInteger(id) ? await repos.archives.get(id) : null;
    if (!archive) return reply.code(404).send({ error: 'Ese respaldo ya no existe.' });

    await borrarArchivo(dir, archive.file);
    await repos.archives.remove(id);
    return { ok: true };
  });

  /** Barrido a mano de las conversaciones inactivas. */
  app.post('/admin/archives/barrer', async (request) => {
    const body = z
      .object({
        dias: z.coerce.number().int().positive().max(3650).optional(),
        limite: z.coerce.number().int().positive().max(500).default(50),
      })
      .parse(request.body ?? {});
    // Sin dias configurados, un barrido a mano sigue teniendo sentido: se
    // pide el plazo en la propia llamada.
    const dias = body.dias ?? deps.dias;
    if (!dias) {
      return { revisados: 0, archivados: 0, mensajes: 0, fallos: [], aviso: 'falta el plazo en dias' };
    }
    return barrerInactivas(service, dias, body.limite);
  });

  /** Estado de salud: los ficheros siguen ahi y con el mismo contenido. */
  app.get('/admin/archives-revision', async () => ({ items: await revisarRespaldos(service) }));
}
