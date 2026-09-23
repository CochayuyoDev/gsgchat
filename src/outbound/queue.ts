/**
 * Cola de salida sobre BullMQ.
 *
 * La cola existe por dos motivos que no son "escalar": aplicar un ritmo
 * constante de envio (los picos son lo que dispara los limites de Meta) y
 * poder frenar en seco cuando la calidad del numero baja, sin perder los
 * mensajes que ya estaban encolados.
 */

import { Queue, Worker, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import type { SendJob, Sender } from './sender.js';

export const OUTBOUND_QUEUE = 'wa-outbound';

export interface OutboundQueue {
  enqueue(job: SendJob, opts?: { delayMs?: number; jobId?: string }): Promise<void>;
  enqueueMany(jobs: SendJob[]): Promise<number>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  counts(): Promise<Record<string, number>>;
  close(): Promise<void>;
}

function connection(redisUrl: string): Redis {
  // BullMQ exige maxRetriesPerRequest: null en la conexion de los workers.
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}

/**
 * `nombre`: cada tienda de la plataforma tiene su propia cola (wa-outbound-<id>);
 * la de una instalacion suelta se sigue llamando wa-outbound.
 */
export function createOutboundQueue(redisUrl: string, nombre: string = OUTBOUND_QUEUE): OutboundQueue {
  const redis = connection(redisUrl);
  const queue = new Queue<SendJob>(nombre, { connection: redis });

  const defaults: JobsOptions = {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 7 * 24 * 3600, count: 10_000 },
    removeOnFail: { age: 30 * 24 * 3600 },
  };

  return {
    async enqueue(job, opts) {
      await queue.add('send', job, {
        ...defaults,
        delay: opts?.delayMs,
        jobId: opts?.jobId,
      });
    },
    async enqueueMany(jobs) {
      if (!jobs.length) return 0;
      await queue.addBulk(jobs.map((data) => ({ name: 'send', data, opts: defaults })));
      return jobs.length;
    },
    pause: () => queue.pause(),
    resume: () => queue.resume(),
    async counts() {
      return queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed', 'paused');
    },
    async close() {
      await queue.close();
      await redis.quit();
    },
  };
}

export interface OutboundWorkerOptions {
  redisUrl: string;
  sender: Sender;
  queue: OutboundQueue;
  /** Mensajes por segundo. Conservador a proposito. */
  messagesPerSecond?: number;
  concurrency?: number;
  onResult?: (job: SendJob, outcome: Awaited<ReturnType<Sender['send']>>) => void;
  /** El nombre de la cola de esta tienda (ver createOutboundQueue). */
  nombre?: string;
}

export function createOutboundWorker(opts: OutboundWorkerOptions): Worker<SendJob> {
  const { redisUrl, sender, queue, messagesPerSecond = 10, concurrency = 5 } = opts;
  const redis = connection(redisUrl);

  const worker = new Worker<SendJob>(
    opts.nombre ?? OUTBOUND_QUEUE,
    async (job) => {
      const outcome = await sender.send(job.data);
      opts.onResult?.(job.data, outcome);

      if (outcome.ok) return outcome;

      // Un bloqueo con espera (cupo diario, calidad en amarillo) se reprograma;
      // uno definitivo (baja, sin opt-in) se descarta sin reintentos.
      if (outcome.blocked) {
        if (outcome.retryAfterMs) {
          await queue.enqueue(job.data, { delayMs: outcome.retryAfterMs });
        }
        return outcome;
      }

      if (outcome.retryable) throw new Error(outcome.error);
      return outcome;
    },
    {
      connection: redis,
      concurrency,
      limiter: { max: messagesPerSecond, duration: 1000 },
    },
  );

  return worker;
}

/**
 * Si hay un Redis vivo en esa URL.
 *
 * Se comprueba al arrancar para poder caer a la cola en memoria en vez de
 * reventar. BullMQ no falla al construirse: reintenta en segundo plano para
 * siempre, asi que sin esta comprobacion el sintoma seria un sistema que
 * arranca, acepta mensajes y no envia ninguno, sin decir por que.
 */
export async function redisReachable(redisUrl: string, timeoutMs = 1500): Promise<boolean> {
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    connectTimeout: timeoutMs,
  });

  // Sin este manejador ioredis escupe un "Unhandled error event: ECONNREFUSED"
  // en la consola antes de que lleguemos al catch. Aqui no hay Redis es una
  // respuesta valida, no un incidente: el aviso lo damos nosotros, formateado.
  redis.on('error', () => {});

  try {
    await redis.connect();
    await redis.ping();
    return true;
  } catch {
    return false;
  } finally {
    redis.disconnect();
  }
}
