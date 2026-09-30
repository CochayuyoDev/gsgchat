/**
 * Lo que el cliente ya dijo en su mensaje, sin tener que preguntárselo.
 *
 * Un caso real: "quiero mandar una caja de documentos de Surco a Miraflores hoy
 * mismo" contestaba "no reconocí ese mensaje". El cliente había dicho el
 * origen, el destino, el contenido y la fecha en una frase, y el asistente le
 * pedía que empezara por el principio.
 *
 * Aquí se saca lo que se puede sacar CON SEGURIDAD. La regla es que ante la
 * duda no se rellena: preguntar algo que el cliente ya dijo molesta, pero
 * guardar un dato inventado sale mucho más caro —el reparto sale hacia el
 * sitio equivocado y nadie lo revisa—.
 */

import type { LeadPatch } from '../db/leads.js';
import { distritosEnTexto, normalizaFrase } from './distritos.js';

const normaliza = (texto: string): string =>
  texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');

/**
 * El origen y el destino, cuando vienen con "de X a Y".
 *
 * Solo con esa forma: es la única en la que se sabe cuál es cuál. "Surco
 * Miraflores" a secas no dice qué se recoge y qué se entrega, y adivinarlo
 * mandaría al repartidor al revés.
 */
export function extraerRuta(
  texto: string,
  distritos?: string[],
): { recojo: string; entrega: string } | null {
  // La MISMA limpieza que usa distritosEnTexto: las posiciones que devuelve
  // se cuentan sobre ese texto, y medirlas sobre otro descuadra el trozo de
  // en medio en cuanto la frase trae una coma.
  const limpio = normalizaFrase(texto);

  const encontrados = distritos ? distritosEnTexto(texto, distritos) : distritosEnTexto(texto);

  // Hacen falta DOS. Con uno solo no se sabe si es el origen o el destino, y
  // adivinarlo manda al repartidor al revés.
  if (encontrados.length !== 2) return null;

  const [primero, segundo] = encontrados;
  if (!primero || !segundo) return null;

  // Y que entre los dos haya una palabra de dirección: sin ella, "Surco
  // Miraflores" no dice cuál es cuál.
  const entre = limpio.slice(primero.posicion, segundo.posicion);
  if (!/\b(?:a|al|hasta|para|hacia)\b/.test(entre)) return null;

  return { recojo: primero.nombre, entrega: segundo.nombre };
}

/** Cuándo lo necesita, si lo dijo con una palabra que no admite duda. */
export function extraerCuando(texto: string): string | null {
  const limpio = normaliza(texto);
  if (/\bhoy\b/.test(limpio)) return 'Hoy';
  if (/\b(manana|mañana)\b/.test(limpio)) return 'Mañana';
  return null;
}

/**
 * Todo lo que se pueda sacar del mensaje.
 *
 * Solo se rellena lo que el lead no tenga ya: lo que el cliente contestó
 * expresamente a una pregunta manda sobre lo que se deduce de una frase.
 */
export function extraerDeMensaje(
  texto: string,
  yaSabido: { recojoDistrito?: string | null; entregaDistrito?: string | null; cuando?: string | null },
  distritos?: string[],
): LeadPatch {
  const patch: LeadPatch = {};

  const ruta = extraerRuta(texto, distritos);
  if (ruta) {
    if (!yaSabido.recojoDistrito?.trim()) patch.recojoDistrito = ruta.recojo;
    if (!yaSabido.entregaDistrito?.trim()) patch.entregaDistrito = ruta.entrega;
  }

  const cuando = extraerCuando(texto);
  if (cuando && !yaSabido.cuando?.trim()) patch.cuando = cuando;

  return patch;
}
