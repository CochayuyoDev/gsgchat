/**
 * El cliente escribe su dirección en vez de mandar el pin («Av. Larco 345,
 * Miraflores», «jr puno 340 altura del mercado, cercado», «mz B lote 5 urb
 * los jardines SJL»). Eso NO es «otra cosa»: es su respuesta a lo que se le
 * pidió, y no gasta una insistencia (pedido del dueño, 25/09).
 *
 * Aquí solo están las reglas que la reconocen (la IA, si hay clave, la
 * clasifica como DIRECCION en src/ia/agente-operativo.ts) y cómo se guarda.
 */

import { distritoEnDireccion } from './distritos-centro.js';

const sinTildes = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Las vías y lugares que casi siempre son el comienzo de una dirección. */
const VIA_FUERTE = /\b(av|avda|avenida|jr|jiron|psje|pje|pasaje|prolongacion|prolong|prol|carretera|carret|malecon|urb|urbanizacion|asoc|asociacion|aa ?hh|asentamiento|cooperativa|coop|residencial|condominio|alameda|ovalo)\b/;
/** Las que también se dicen de otra forma («estoy en la calle»): solo cuentan con un número. */
const VIA_DEBIL = /\b(calle|ca|cl|sector|etapa|block|bloque|km|kilometro|edificio|edif|torre|dpto|departamento|interior|int)\b/;
const MANZANA = /\b(mz|mza|manzana)\b/;
const LOTE = /\b(lt|lte|lote)\b/;
/** «altura del mercado», «frente al parque», «cuadra 5», «esquina con». */
const REFERENCIA = /\b(altura|frente|cuadra|esquina|espalda|costado|cerca|al lado|referencia|ref)\b/;
const NUMERO = /\b\d{1,5}\b|\bn[°ºo]\s*\d/;

/**
 * Si el texto parece una dirección escrita. Estricto a propósito: «estoy en
 * la calle», «no estoy en mi casa» o «vivo en Surco» NO lo son (sin vía,
 * número o manzana/lote); una pregunta tampoco.
 */
export function pareceDireccion(texto: string): boolean {
  const crudo = (texto ?? '').trim();
  if (crudo.length < 6 || crudo.length > 300) return false;
  // Una pregunta no es una dirección («¿dónde queda la av. larco?»).
  if (/^[¿?]/.test(crudo) || /\?\s*$/.test(crudo)) return false;
  const t = sinTildes(crudo).replace(/[.,;:#/()\-]/g, ' ').replace(/\s+/g, ' ').trim();
  const conNumero = NUMERO.test(t);
  const conDistrito = Boolean(distritoEnDireccion(crudo));
  if (MANZANA.test(t) && LOTE.test(t)) return true;
  if (VIA_FUERTE.test(t) && (conNumero || conDistrito || REFERENCIA.test(t))) return true;
  if (VIA_DEBIL.test(t) && conNumero && (conDistrito || /\b(calle|ca|cl)\b/.test(t))) return true;
  if ((MANZANA.test(t) || LOTE.test(t)) && conNumero && conDistrito) return true;
  return false;
}

/** La dirección tal como se guarda y se enseña: una línea, sin espacios de más, 200 caracteres como mucho. */
export function limpiarDireccion(texto: string): string {
  return (texto ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
}
