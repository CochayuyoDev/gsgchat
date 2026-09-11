/**
 * Lo que hace que un envio no parezca de maquina, con el cliente no oficial.
 *
 * WhatsApp Web sabe cuando alguien esta escribiendo: el cliente manda
 * "composing" mientras se teclea y "paused" al parar. Un mensaje que aparece
 * de la nada, sin que nadie escribiera, cientos de veces seguidas, tiene una
 * huella. Esto simula el teclado: se avisa de que se escribe, se espera lo
 * que tardaria una persona en escribir ese texto (con su variacion), se
 * para, y entonces sale.
 *
 * Con la Cloud API no tiene sentido: ahi Meta sabe que es un sistema y lo
 * que mira es otra cosa.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
export interface OpcionesEscritura {
  /** Palabras por minuto, con desviacion. */
  wpm?: number;
  desviacionWpm?: number;
  /** Cotas de la simulacion en ms: nadie espera un minuto a que "escriba" un bot. */
  minMs?: number;
  maxMs?: number;
  azar?: () => number;
}

const POR_DEFECTO: Required<OpcionesEscritura> = {
  wpm: 45,
  desviacionWpm: 12,
  minMs: 1_200,
  maxMs: 9_000,
  azar: Math.random,
};

/**
 * Un envio hecho a mano desde el chat (un boton, un texto tecleado por una
 * persona) no tiene que fingir que teclea: la persona ya lo hizo. El sender
 * envuelve esos envios en `aMano()` y la escritura simulada se queda en un
 * parpadeo. Va por AsyncLocalStorage para no tener que pasar una bandera
 * por todas las capas hasta el socket.
 */
const contextoEnvio = new AsyncLocalStorage<{ aMano: boolean }>();
const ESPERA_A_MANO_MS = 700;

export function aMano<T>(fn: () => Promise<T>): Promise<T> {
  return contextoEnvio.run({ aMano: true }, fn);
}

export function enviandoAMano(): boolean {
  return contextoEnvio.getStore()?.aMano === true;
}

/** Aproximacion a una normal (0,1) con Box-Muller. */
export function normal(azar: () => number = Math.random): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = azar();
  while (v === 0) v = azar();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Cuanto tardaria una persona en escribir ese texto, en ms.
 *
 * Velocidad normal alrededor de 45 palabras por minuto, mas alguna pausa
 * para pensar (un 8 % de probabilidad cada diez caracteres, de 0,8 a 3,5 s).
 */
export function duracionEscritura(texto: string, opts: OpcionesEscritura = {}): number {
  const o = { ...POR_DEFECTO, ...opts };
  const wpm = Math.max(15, o.wpm + normal(o.azar) * o.desviacionWpm);
  const caracteresPorSegundo = (wpm * 5) / 60;
  let ms = (texto.length / caracteresPorSegundo) * 1000;

  const bloques = Math.floor(texto.length / 10);
  for (let i = 0; i < bloques; i++) {
    if (o.azar() < 0.08) ms += 800 + o.azar() * 2700;
  }
  return Math.round(Math.max(o.minMs, Math.min(o.maxMs, ms)));
}

/** Una pausa corta de "leer antes de contestar", de 1,5 a 4 s. */
export function duracionLectura(azar: () => number = Math.random): number {
  return Math.round(1_500 + azar() * 2_500);
}

export const dormir = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    (t as { unref?: () => void }).unref?.();
  });

export interface Teclado {
  /** Avisar de que se esta escribiendo. */
  escribiendo(): Promise<void>;
  /** Avisar de que se paro. */
  parado(): Promise<void>;
}

/**
 * Escribe "como una persona" y luego ejecuta el envio.
 *
 * Un fallo al avisar de la escritura no puede impedir el envio: el aviso es
 * cosmetico para WhatsApp y vital para nosotros, pero nunca mas importante
 * que el mensaje.
 */
export async function escribirComoHumano<T>(
  teclado: Teclado,
  texto: string,
  enviar: () => Promise<T>,
  opts: OpcionesEscritura & { dormir?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const esperar = opts.dormir ?? dormir;
  await teclado.escribiendo().catch(() => undefined);
  // Lo que escribe una persona desde el chat no espera lo que tardaria en
  // teclearlo: ya lo tecleo (o pulso un boton). Solo un parpadeo de
  // "escribiendo..." para que no salga en seco.
  await esperar(enviandoAMano() ? Math.min(ESPERA_A_MANO_MS, duracionEscritura(texto, opts)) : duracionEscritura(texto, opts));
  await teclado.parado().catch(() => undefined);
  return enviar();
}
