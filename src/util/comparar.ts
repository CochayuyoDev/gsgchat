/**
 * Comparar secretos sin filtrar por el tiempo cuanto se parecen.
 *
 * `a === b` corta en el primer caracter distinto: midiendo cuanto tarda, se
 * puede ir adivinando un token letra a letra. Se compara el sha256 de los dos
 * (misma longitud siempre) con `timingSafeEqual`. Un secreto vacio nunca
 * coincide: un ajuste sin rellenar no puede abrir nada.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

const resumen = (x: string) => createHash('sha256').update(x, 'utf8').digest();

export function igualSeguro(dado: unknown, esperado: string): boolean {
  if (typeof dado !== 'string' || !dado || !esperado) return false;
  return timingSafeEqual(resumen(dado), resumen(esperado));
}
