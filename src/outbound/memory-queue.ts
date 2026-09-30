/**
 * Cola de salida en memoria: la misma interfaz que la de BullMQ, sin Redis.
 *
 * Existe porque Redis no siempre se puede instalar (en Windows no hay build
 * oficial) y sin cola el proceso ni siquiera arranca. Antes eso dejaba el
 * sistema entero inservible por una dependencia que, para un despliegue de un
 * solo proceso, no aporta nada que no se pueda hacer aqui.
 *
 * Hace lo mismo que la de Redis en lo que importa: ritmo constante de envio,
 * reprogramar lo bloqueado con espera y poder frenar en seco.
 *
 * Lo que NO hace, y por eso la de Redis sigue siendo la buena en produccion:
 *
 *  - no sobrevive al reinicio: lo encolado y no enviado se pierde;
 *  - no se reparte entre varios procesos.
 *
 * Los mensajes programados y los pasos de las secuencias NO dependen de esto:
 * viven en la base de datos y los recupera el ticker de `automation/engine`.
 * Lo que se pierde al reiniciar son los envios ya encolados pendientes de su
 * turno, cosa de segundos.
 */

import type { OutboundQueue } from './queue.js';
import type { SendJob, Sender } from './sender.js';

interface Pendiente {
  job: SendJob;
  /** Momento a partir del cual se puede enviar. */
  readyAt: number;
  jobId?: string;
  intentos: number;
}

export interface MemoryQueueOptions {
  sender: Sender;
  /** Mensajes por segundo. El mismo valor conservador que la de Redis. */
  messagesPerSecond?: number;
  /** Reintentos ante fallo transitorio antes de descartar. */
  maxAttempts?: number;
  onResult?: (job: SendJob, outcome: Awaited<ReturnType<Sender['send']>>) => void;
  onError?: (error: unknown, job: SendJob) => void;
}

export interface MemoryOutboundQueue extends OutboundQueue {
  /** Cuantos hay esperando; para los tests y el panel. */
  size(): number;
}

export function createMemoryOutboundQueue(opts: MemoryQueueOptions): MemoryOutboundQueue {
  const { sender, messagesPerSecond = 10, maxAttempts = 5 } = opts;
  const intervalo = Math.max(1, Math.floor(1000 / messagesPerSecond));

  const pendientes: Pendiente[] = [];
  let pausada = false;
  let cerrada = false;
  let procesando = false;

  function meter(entrada: Pendiente): void {
    // Mismo jobId = mismo envio: no se duplica, igual que hace BullMQ.
    if (entrada.jobId && pendientes.some((p) => p.jobId === entrada.jobId)) return;
    pendientes.push(entrada);
  }

  /** El primero cuyo turno ya llego. */
  function siguiente(now: number): Pendiente | undefined {
    const index = pendientes.findIndex((p) => p.readyAt <= now);
    if (index < 0) return undefined;
    return pendientes.splice(index, 1)[0];
  }

  async function tick(): Promise<void> {
    if (cerrada || pausada || procesando) return;
    const entrada = siguiente(Date.now());
    if (!entrada) return;

    procesando = true;
    try {
      const outcome = await sender.send(entrada.job);
      opts.onResult?.(entrada.job, outcome);

      if (outcome.ok) return;

      // Bloqueo con espera (cupo diario, calidad en amarillo): se reprograma.
      // Bloqueo en firme (baja, sin opt-in): se descarta, insistir suma bloqueos.
      if (outcome.blocked) {
        if (outcome.retryAfterMs) {
          meter({ ...entrada, readyAt: Date.now() + outcome.retryAfterMs });
        }
        return;
      }

      if (outcome.retryable && entrada.intentos + 1 < maxAttempts) {
        // Espera creciente, igual que el backoff exponencial de la otra cola.
        const espera = 5_000 * 2 ** entrada.intentos;
        meter({ ...entrada, intentos: entrada.intentos + 1, readyAt: Date.now() + espera });
      }
    } catch (error) {
      opts.onError?.(error, entrada.job);
    } finally {
      procesando = false;
    }
  }

  const timer = setInterval(() => void tick(), intervalo);
  // El ticker no debe impedir que el proceso termine.
  timer.unref?.();

  return {
    async enqueue(job, options) {
      meter({
        job,
        readyAt: Date.now() + (options?.delayMs ?? 0),
        jobId: options?.jobId,
        intentos: 0,
      });
    },

    async enqueueMany(jobs) {
      const now = Date.now();
      for (const job of jobs) meter({ job, readyAt: now, intentos: 0 });
      return jobs.length;
    },

    async pause() {
      pausada = true;
    },

    async resume() {
      pausada = false;
    },

    async counts() {
      const now = Date.now();
      return {
        waiting: pendientes.filter((p) => p.readyAt <= now).length,
        delayed: pendientes.filter((p) => p.readyAt > now).length,
        active: procesando ? 1 : 0,
        paused: pausada ? pendientes.length : 0,
        completed: 0,
        failed: 0,
      };
    },

    async close() {
      cerrada = true;
      clearInterval(timer);
    },

    size: () => pendientes.length,
  };
}
