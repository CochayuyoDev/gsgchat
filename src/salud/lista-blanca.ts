/**
 * Modo prueba: a quien se le puede escribir.
 *
 * `SOLO_NUMEROS` vacio es produccion: a todos. Con lista, nada sale a nadie
 * que no este en ella, venga de donde venga. Existe por un incidente
 * concreto: al reconectar, WhatsApp Web reentrego el historial reciente y el
 * asistente contesto a diez clientes en un segundo. La reentrega ya se
 * filtra (ver `esMensajeViejo`); esto es el cinturon ademas de los tirantes
 * mientras se prueba contra un WhatsApp de verdad.
 */

import type { Config } from '../config.js';

export function numeroPermitido(config: Pick<Config, 'soloNumeros'>, phone: string): boolean {
  if (!config.soloNumeros.length) return true;
  return config.soloNumeros.includes(phone.replace(/\D+/g, ''));
}
