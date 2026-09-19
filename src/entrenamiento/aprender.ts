/**
 * Aprender de una conversacion: sacar pares "el cliente dijo X, el negocio
 * contesto Y" de un hilo de mensajes.
 *
 * Es lo que convierte el historial real (miles de chats atendidos a mano
 * durante meses) en lecciones. Solo cuenta lo que contesto UNA PERSONA del
 * negocio: lo que mando el propio asistente, una plantilla, el reparto o
 * una campana no ensena nada nuevo (y lo del asistente podria ser justo lo
 * que se quiere corregir).
 *
 * Reglas:
 *  - Los mensajes seguidos del mismo lado se juntan en un bloque (el
 *    cliente escribe tres lineas, el negocio contesta con dos).
 *  - Un bloque de entrada seguido de un bloque de salida a menos de
 *    `maxEsperaHoras` es un par. Lo que el negocio dice sin que le
 *    preguntaran no se aprende: no hay pregunta.
 *  - Se tapan telefonos, DNI, correos y tarjetas: la leccion es "como se
 *    responde", no "a quien".
 *  - Las preguntas que no dicen nada ("ok", "gracias") y las respuestas de
 *    una palabra se descartan.
 */

import { esGenerica, taparDatosPersonales } from './texto.js';
import type { MensajeParaAprender } from './repo.js';

export interface ParAprendido {
  pregunta: string;
  respuesta: string;
  cuando: Date;
}

export interface OpcionesAprender {
  /** Cuanto puede tardar la respuesta para que aun cuente como respuesta (horas). */
  maxEsperaHoras?: number;
  /** Dos mensajes del mismo lado a menos de esto se juntan (minutos). */
  juntarMinutos?: number;
  minRespuesta?: number;
  maxRespuesta?: number;
  maxPregunta?: number;
}

/** Origenes de un saliente que NO son una persona del negocio. */
const NO_ES_PERSONA = new Set(['ia', 'sistema', 'campana', 'automatizacion', 'reparto', 'envio-automatico', 'secuencia', 'regla']);

export function loMandoUnaPersona(m: MensajeParaAprender): boolean {
  if (m.direction !== 'out') return false;
  if (!m.origen) return true;
  return !NO_ES_PERSONA.has(m.origen);
}

interface Bloque {
  direction: 'in' | 'out';
  textos: string[];
  desde: Date;
  hasta: Date;
  persona: boolean;
}

export function paresDeConversacion(mensajes: MensajeParaAprender[], opts: OpcionesAprender = {}): ParAprendido[] {
  const maxEspera = (opts.maxEsperaHoras ?? 12) * 3_600_000;
  const juntar = (opts.juntarMinutos ?? 30) * 60_000;
  const minRespuesta = opts.minRespuesta ?? 6;
  const maxRespuesta = opts.maxRespuesta ?? 1500;
  const maxPregunta = opts.maxPregunta ?? 600;

  const bloques: Bloque[] = [];
  for (const m of mensajes) {
    if (m.kind !== 'text') continue;
    const texto = (m.body ?? '').trim();
    if (!texto) continue;
    const persona = m.direction === 'in' ? true : loMandoUnaPersona(m);
    const ultimo = bloques[bloques.length - 1];
    if (ultimo && ultimo.direction === m.direction && ultimo.persona === persona && m.createdAt.getTime() - ultimo.hasta.getTime() <= juntar) {
      ultimo.textos.push(texto);
      ultimo.hasta = m.createdAt;
    } else {
      bloques.push({ direction: m.direction, textos: [texto], desde: m.createdAt, hasta: m.createdAt, persona });
    }
  }

  const pares: ParAprendido[] = [];
  for (let i = 0; i + 1 < bloques.length; i++) {
    const entrada = bloques[i]!;
    const salida = bloques[i + 1]!;
    if (entrada.direction !== 'in' || salida.direction !== 'out' || !salida.persona) continue;
    if (salida.desde.getTime() - entrada.hasta.getTime() > maxEspera) continue;
    const pregunta = taparDatosPersonales(entrada.textos.join('\n')).trim();
    const respuesta = taparDatosPersonales(salida.textos.join('\n')).trim();
    if (esGenerica(pregunta) || pregunta.length > maxPregunta) continue;
    if (respuesta.length < minRespuesta || respuesta.length > maxRespuesta) continue;
    if (respuesta.split(/\s+/).length < 2) continue;
    pares.push({ pregunta, respuesta, cuando: salida.desde });
  }
  return pares;
}
