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

export function createOutboundQueue(redisUrl: string): OutboundQueue {
  const redis = connection(redisUrl);
  const queue = new Queue<SendJob>(OUTBOUND_QUEUE, { connection: redis });

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
}

export function createOutboundWorker(opts: OutboundWorkerOptions): Worker<SendJob> {
  const { redisUrl, sender, queue, messagesPerSecond = 10, concurrency = 5 } = opts;
  const redis = connection(redisUrl);

  const worker = new Worker<SendJob>(
    OUTBOUND_QUEUE,
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
