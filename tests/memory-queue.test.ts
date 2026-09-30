/**
 * La cola en memoria.
 *
 * Sustituye a la de Redis cuando no hay Redis, asi que tiene que respetar las
 * mismas decisiones de la de BullMQ: un bloqueo con espera se reprograma, uno
 * en firme se descarta, y el mismo jobId no se encola dos veces. Si esto se
 * rompe, el sintoma en produccion es insistirle a quien se dio de baja.
 */

import { describe, expect, it, vi } from 'vitest';
import { createMemoryOutboundQueue } from '../src/outbound/memory-queue.js';
import type { SendJob, SendOutcome, Sender } from '../src/outbound/sender.js';

function senderFalso(respuestas: SendOutcome[]): { sender: Sender; enviados: SendJob[] } {
  const enviados: SendJob[] = [];
  let i = 0;
  return {
    enviados,
    sender: {
      async send(job) {
        enviados.push(job);
        return respuestas[Math.min(i++, respuestas.length - 1)] ?? { ok: true, wamid: 'm1' };
      },
    } as Sender,
  };
}

const JOB: SendJob = { phone: '5215512345678', kind: 'freeform', category: 'UTILITY', text: 'hola' };

/** Deja correr el ticker unas cuantas veces. */
async function correr(ms = 60): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe('cola en memoria', () => {
  it('envia lo que se encola', async () => {
    const { sender, enviados } = senderFalso([{ ok: true, wamid: 'm1', deliveryId: 1 }]);
    const queue = createMemoryOutboundQueue({ sender, messagesPerSecond: 100 });

    await queue.enqueue(JOB);
    await correr();

    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.phone).toBe('5215512345678');
    await queue.close();
  });

  it('respeta el retardo: no manda antes de tiempo', async () => {
    const { sender, enviados } = senderFalso([{ ok: true, wamid: 'm1', deliveryId: 1 }]);
    const queue = createMemoryOutboundQueue({ sender, messagesPerSecond: 100 });

    await queue.enqueue(JOB, { delayMs: 5000 });
    await correr();

    expect(enviados).toHaveLength(0);
    expect(queue.size()).toBe(1);
    await queue.close();
  });

  it('el mismo jobId no se encola dos veces', async () => {
    const { sender } = senderFalso([{ ok: true, wamid: 'm1', deliveryId: 1 }]);
    const queue = createMemoryOutboundQueue({ sender, messagesPerSecond: 1 });

    await queue.enqueue(JOB, { delayMs: 60_000, jobId: 'paso-7' });
    await queue.enqueue(JOB, { delayMs: 60_000, jobId: 'paso-7' });

    expect(queue.size()).toBe(1);
    await queue.close();
  });

  it('un bloqueo con espera se reprograma', async () => {
    const { sender, enviados } = senderFalso([
      { ok: false, blocked: true, code: 'daily_cap', reason: 'cupo diario', retryAfterMs: 60_000, deliveryId: 1 },
    ]);
    const queue = createMemoryOutboundQueue({ sender, messagesPerSecond: 100 });

    await queue.enqueue(JOB);
    await correr();

    expect(enviados).toHaveLength(1);
    // Sigue en la cola, esperando su nuevo turno.
    expect(queue.size()).toBe(1);
    await queue.close();
  });

  it('un bloqueo en firme se descarta: insistir solo suma bloqueos', async () => {
    const { sender, enviados } = senderFalso([
      { ok: false, blocked: true, code: 'opt_out', reason: 'dado de baja', deliveryId: 1 },
    ]);
    const queue = createMemoryOutboundQueue({ sender, messagesPerSecond: 100 });

    await queue.enqueue(JOB);
    await correr();

    expect(enviados).toHaveLength(1);
    expect(queue.size()).toBe(0);
    await queue.close();
  });

  it('un fallo transitorio se reintenta, uno definitivo no', async () => {
    const { sender: transitorio } = senderFalso([
      { ok: false, blocked: false, retryable: true, error: 'timeout', deliveryId: 1 },
    ]);
    const q1 = createMemoryOutboundQueue({ sender: transitorio, messagesPerSecond: 100 });
    await q1.enqueue(JOB);
    await correr();
    expect(q1.size()).toBe(1);
    await q1.close();

    const { sender: definitivo } = senderFalso([
      { ok: false, blocked: false, retryable: false, error: 'numero invalido', deliveryId: 1 },
    ]);
    const q2 = createMemoryOutboundQueue({ sender: definitivo, messagesPerSecond: 100 });
    await q2.enqueue(JOB);
    await correr();
    expect(q2.size()).toBe(0);
    await q2.close();
  });

  it('pausar frena en seco y reanudar sigue', async () => {
    const { sender, enviados } = senderFalso([{ ok: true, wamid: 'm1', deliveryId: 1 }]);
    const queue = createMemoryOutboundQueue({ sender, messagesPerSecond: 100 });

    await queue.pause();
    await queue.enqueue(JOB);
    await correr();
    expect(enviados).toHaveLength(0);

    await queue.resume();
    await correr();
    expect(enviados).toHaveLength(1);
    await queue.close();
  });

  it('cerrada ya no envia nada', async () => {
    const { sender, enviados } = senderFalso([{ ok: true, wamid: 'm1', deliveryId: 1 }]);
    const queue = createMemoryOutboundQueue({ sender, messagesPerSecond: 100 });

    await queue.close();
    await queue.enqueue(JOB);
    await correr();

    expect(enviados).toHaveLength(0);
  });

  it('un error inesperado del sender no tumba el ticker', async () => {
    const onError = vi.fn();
    const sender = {
      send: vi.fn(async () => {
        throw new Error('boom');
      }),
    } as unknown as Sender;
    const queue = createMemoryOutboundQueue({ sender, messagesPerSecond: 100, onError });

    await queue.enqueue(JOB);
    await correr();

    expect(onError).toHaveBeenCalled();

    // El ticker sigue vivo: lo siguiente se intenta igual.
    await queue.enqueue(JOB);
    await correr();
    expect(onError).toHaveBeenCalledTimes(2);
    await queue.close();
  });

  it('los conteos distinguen lo listo de lo aplazado', async () => {
    const { sender } = senderFalso([{ ok: true, wamid: 'm1', deliveryId: 1 }]);
    const queue = createMemoryOutboundQueue({ sender, messagesPerSecond: 1 });

    await queue.enqueue(JOB, { delayMs: 60_000, jobId: 'a' });
    await queue.enqueue(JOB, { delayMs: 60_000, jobId: 'b' });

    const counts = await queue.counts();
    expect(counts.delayed).toBe(2);
    expect(counts.waiting).toBe(0);
    await queue.close();
  });

  it('enqueueMany devuelve cuantos metio', async () => {
    const { sender } = senderFalso([{ ok: true, wamid: 'm1', deliveryId: 1 }]);
    const queue = createMemoryOutboundQueue({ sender, messagesPerSecond: 1 });

    await queue.pause();
    expect(await queue.enqueueMany([JOB, JOB, JOB])).toBe(3);
    expect(queue.size()).toBe(3);
    await queue.close();
  });
});
