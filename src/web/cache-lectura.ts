import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** Evita reenviar el mismo contenido del chat/historial cuando no cambió. */
export function responderLectura(request: FastifyRequest, reply: FastifyReply, data: unknown): FastifyReply {
  const body = JSON.stringify(data);
  const etag = '"' + createHash('sha256').update(body).digest('hex') + '"';
  reply.header('cache-control', 'private, no-cache').header('etag', etag);
  if (request.headers['if-none-match'] === etag) return reply.code(304).send();
  return reply.type('application/json; charset=utf-8').send(body);
}
