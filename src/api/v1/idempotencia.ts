/**
 * `Idempotency-Key` en los POST que mandan algo a un cliente.
 *
 * Otro sistema que llama a `POST /api/v1/mensajes` y no recibe respuesta (se
 * corto la red, salto su timeout) reintenta, y el cliente recibia el mismo
 * mensaje dos veces. Con la cabecera `Idempotency-Key: <lo que sea unico>`,
 * la repeticion (de la misma clave de API, durante 24 h) no vuelve a enviar:
 * devuelve la respuesta de la primera, con `Idempotent-Replayed: true`. Si la
 * primera sigue en curso, la segunda la espera en vez de enviar otra vez.
 *
 * Un 5xx no se recuerda: ahi el envio no salio y reintentar es lo correcto.
 * Vive en memoria: tras un reinicio la clave se olvida (es un seguro contra
 * reintentos inmediatos, no un registro).
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { TtlCache } from '../../util/cache.js';

export const CABECERA_IDEMPOTENCIA = 'idempotency-key';

interface Respuesta {
  status: number;
  cuerpo: string;
  tipo: string | undefined;
}

type ConClave = FastifyRequest & { idempotencia?: { clave: string; listo: (r: Respuesta | null) => void } };

export function crearIdempotencia(opts: { ttlMs?: number; max?: number; esperaMaxMs?: number } = {}) {
  const esperaMaxMs = opts.esperaMaxMs ?? 90_000;
  const vistas = new TtlCache<Promise<Respuesta | null>>(opts.ttlMs ?? 24 * 60 * 60 * 1000, opts.max ?? 10_000);

  async function preHandler(request: FastifyRequest, reply: FastifyReply) {
    const crudo = request.headers[CABECERA_IDEMPOTENCIA];
    if (crudo === undefined) return;
    const valor = Array.isArray(crudo) ? crudo[0] : crudo;
    if (typeof valor !== 'string' || !/^[\x21-\x7e]{1,200}$/.test(valor)) {
      return reply.code(400).send({ error: 'Idempotency-Key tiene que ser texto sin espacios, de 1 a 200 caracteres' });
    }
    // Por quien pide: la misma clave de dos sistemas distintos no se pisa.
    const clave = `${request.usuario?.id ?? request.ip}:${valor}`;
    const previa = vistas.get(clave);
    if (previa) {
      // La primera sigue en curso: se espera, pero no para siempre.
      let corte: NodeJS.Timeout | undefined;
      const r = await Promise.race([previa, new Promise<'en_curso'>((resolve) => (corte = setTimeout(() => resolve('en_curso'), esperaMaxMs)))]);
      clearTimeout(corte);
      if (r === 'en_curso') {
        return reply.code(409).send({ error: 'Una peticion con esta Idempotency-Key sigue en curso: vuelve a intentarlo en unos segundos.' });
      }
      if (r) {
        reply.header('idempotent-replayed', 'true').code(r.status);
        if (r.tipo) reply.type(r.tipo);
        return reply.send(r.cuerpo);
      }
    }
    let listo!: (r: Respuesta | null) => void;
    vistas.set(clave, new Promise<Respuesta | null>((resolve) => (listo = resolve)));
    (request as ConClave).idempotencia = { clave, listo };
  }

  async function onSend(request: FastifyRequest, reply: FastifyReply, payload: unknown) {
    const marca = (request as ConClave).idempotencia;
    if (!marca) return payload;
    (request as ConClave).idempotencia = undefined;
    if (reply.statusCode >= 500 || (typeof payload !== 'string' && !Buffer.isBuffer(payload))) {
      vistas.delete(marca.clave);
      marca.listo(null);
      return payload;
    }
    const tipo = reply.getHeader('content-type');
    marca.listo({ status: reply.statusCode, cuerpo: payload.toString(), tipo: typeof tipo === 'string' ? tipo : undefined });
    return payload;
  }

  return { preHandler, onSend };
}
