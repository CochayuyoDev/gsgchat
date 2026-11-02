/**
 * Entrega un fichero guardado al navegador con soporte de `Range`.
 *
 * Sin rangos el navegador no puede saltar a otro punto de un audio o un video,
 * ni saber cuanto dura una nota de voz (Chrome pide el final del fichero para
 * medirla). Con ellos, la onda, el tiempo y el salto del reproductor funcionan.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { abrirMedia, rangoDe, tamanoMedia } from './media.js';

export async function servirMedia(
  request: FastifyRequest,
  reply: FastifyReply,
  dir: string,
  id: string,
  cabeceras: Record<string, string>,
): Promise<FastifyReply> {
  const total = await tamanoMedia(dir, id);
  if (total === null) return reply.code(404).send({ error: 'ese archivo no existe' });
  const rango = rangoDe(typeof request.headers.range === 'string' ? request.headers.range : undefined, total);
  for (const [k, v] of Object.entries(cabeceras)) reply.header(k, v);
  reply.header('accept-ranges', 'bytes');
  if (rango === 'invalido') return reply.code(416).header('content-range', `bytes */${total}`).send();
  const abierto = await abrirMedia(dir, id, rango ?? undefined);
  if (!abierto) return reply.code(404).send({ error: 'ese archivo no existe' });
  if (rango) {
    return reply
      .code(206)
      .header('content-range', `bytes ${rango.inicio}-${rango.fin}/${total}`)
      .header('content-length', rango.fin - rango.inicio + 1)
      .send(abierto.flujo);
  }
  return reply.header('content-length', total).send(abierto.flujo);
}
