/**
 * La regla del dueño en modo «Solo lo de GSG», puesta en la unica puerta por
 * la que se le escribe a un cliente (el sender):
 *
 *   «El único proceso de GSGchat es disparar mensajes. Una vez que la IA manda
 *   el mensaje de UBI REGISTRADA, ahí llega la IA: ya no vuelve a responder.
 *   Si el cliente pregunta algo, la IA no responde: deriva a un humano y dice
 *   que por este canal no se reciben consultas, y le da el número del
 *   motorizado. Si la IA pide la ubicación y el cliente pide otra cosa, igual.
 *   Si el cliente pregunta por qué le piden su ubicación, la IA explica por
 *   qué es necesaria. Hasta ahí llega la IA.»
 *
 * Dos cosas, para todo lo automatico (lo que escribe una persona a mano sale
 * siempre):
 *
 *  1. Con «Solo lo de GSG», ningun texto redactado por un modelo de IA le
 *     llega a un cliente, venga de donde venga (asistente, voz, fallbacks):
 *     con origen 'ia' solo salen los textos fijos (`textoFijo`). A un
 *     motorizado no le aplica.
 *  2. Con el ajuste «Después de UBI REGISTRADA, no escribirle más al cliente»
 *     (encendido de fabrica), un cliente que ya recibio UBI REGISTRADA o el
 *     cierre no recibe NADA mas por ese pedido: ni la pregunta SÍ/NO, ni la
 *     hora de llegada, ni «cerca», ni «entregado», ni recordatorios, ni
 *     stickers. El mensaje no sale pero quien lo mandaba lo da por hecho, asi
 *     que todo lo de dentro (el motorizado, los reportes a GSG) sigue igual.
 */

import { randomUUID } from 'node:crypto';
import type { Sender, SendJob, SendOutcome } from '../outbound/sender.js';

export interface PuertaReglaGsg {
  modoGsg(): boolean;
  reglaGsgActiva(): boolean;
  clienteEnSilencio(phone: string): Promise<boolean>;
  esMotorizado(phone: string): Promise<boolean>;
}

export interface OpcionesReglaGsg {
  /** Las entregas de la tienda (se crean despues del sender): null = todavia no. */
  entregas: () => PuertaReglaGsg | null | undefined;
  log?: (m: string, d?: Record<string, unknown>) => void;
}

const aMano = (job: SendJob): boolean => job.manual === true || job.origen === 'persona';

export function conReglaGsg(sender: Sender, opts: OpcionesReglaGsg): Sender {
  return {
    ...sender,
    async send(job: SendJob): Promise<SendOutcome> {
      const e = opts.entregas();
      if (!e || aMano(job) || !e.modoGsg()) return sender.send(job);
      if (job.origen === 'ia' && !job.textoFijo && !(await e.esMotorizado(job.phone).catch(() => false))) {
        opts.log?.('regla del dueño: un texto del modelo no sale a un cliente en «Solo lo de GSG»', { phone: job.phone });
        return { ok: false, blocked: true, code: 'regla_gsg', reason: 'con «Solo lo de GSG» la IA no le escribe al cliente: solo salen los textos fijos', deliveryId: -1 };
      }
      if (e.reglaGsgActiva() && (await e.clienteEnSilencio(job.phone).catch(() => false))) {
        opts.log?.('regla del dueño: tras UBI REGISTRADA (o el cierre) no se le escribe más al cliente', { phone: job.phone, que: (job.text ?? job.interactive?.body ?? job.kind).slice(0, 60) });
        return { ok: true, wamid: `silencio:${randomUUID()}`, deliveryId: -1 };
      }
      return sender.send(job);
    },
  };
}
