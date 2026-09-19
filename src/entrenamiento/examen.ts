/**
 * El examen de las lecciones: ¿responde el asistente como se le enseno?
 *
 * A cada leccion de tipo ejemplo se le hace su pregunta al modelo real y la
 * respuesta se compara con la ensenada. No se pide que sea identica (el
 * modelo escribe con sus palabras): se pide que diga LOS MISMOS DATOS
 * (precios, plazos, horas, tallas) y que hable de lo mismo. Y ademas lo de
 * siempre: que no invente precios, no deje marcas y no se vaya de largo.
 *
 * El resultado es un si o un no con motivos que una persona entiende
 * ("faltó decir S/ 120", "pasó con una persona en vez de responder").
 */

import { calificar } from '../ia/escenarios.js';
import { ACCIONES_IA } from '../ia/conocimiento-sistema.js';
import { cifrasQueFaltan, cobertura, similitud } from './texto.js';

export interface RespuestaExaminada {
  texto: string;
  derivar: boolean;
  pedirUbicacion: boolean;
}

export interface Nota {
  ok: boolean;
  motivos: string[];
  /** Que parte de las palabras de lo ensenado aparecen en la respuesta (0..1). */
  cobertura: number;
  parecido: number;
}

const QUIERE_PERSONA = /te paso con una persona|una persona (te|lo|del equipo)|te atiende una persona|te (contacta|escribe) (un|una) (asesor|persona)/i;

/** Umbral de cobertura para dar por buena una respuesta sin cifras que comprobar. */
export const COBERTURA_MINIMA = 0.4;

export function calificarLeccion(esperada: string, dada: RespuestaExaminada, contexto: { conocimiento: string }): Nota {
  const motivos: string[] = [];
  const esperadaLimpia = esperada.replaceAll(ACCIONES_IA.DERIVAR, '').replaceAll(ACCIONES_IA.PEDIR_UBICACION, '').trim();
  const debeDerivar = esperada.includes(ACCIONES_IA.DERIVAR) || QUIERE_PERSONA.test(esperada);
  const debePedirUbicacion = esperada.includes(ACCIONES_IA.PEDIR_UBICACION);

  if (!dada.texto.trim()) {
    return { ok: false, motivos: ['no respondió nada'], cobertura: 0, parecido: 0 };
  }

  const faltan = cifrasQueFaltan(esperadaLimpia, dada.texto);
  for (const c of faltan) motivos.push(`faltó decir «${c}»`);

  const cob = cobertura(esperadaLimpia, dada.texto);
  const parecido = similitud(esperadaLimpia, dada.texto);

  if (debeDerivar && !dada.derivar && !QUIERE_PERSONA.test(dada.texto)) motivos.push('tenía que pasar con una persona y no lo hizo');
  if (!debeDerivar && dada.derivar) motivos.push('pasó con una persona en vez de responder');
  if (debePedirUbicacion && !dada.pedirUbicacion && !/ubicaci[oó]n/i.test(dada.texto)) motivos.push('tenía que pedir la ubicación');

  // Lo de siempre: precios que no estan ni en lo que sabe ni en la leccion,
  // marcas, largo, el nombre del modelo.
  for (const a of calificar(dada, ['precios_del_conocimiento', 'sin_marcas', 'corto', 'no_modelo', 'en_espanol'], { conocimiento: `${contexto.conocimiento}\n${esperadaLimpia}` })) motivos.push(a);

  // Sin cifras que comprobar, manda que hable de lo mismo. Con cifras y
  // todas dichas, con menos palabras en comun basta: dijo los datos.
  const tieneCifras = faltan.length > 0 || cifrasQueFaltan(esperadaLimpia, '').length > 0;
  const minimo = tieneCifras ? 0.25 : COBERTURA_MINIMA;
  if (cob < minimo && parecido < 0.5 && !(debeDerivar && dada.derivar)) motivos.push(`se parece poco a lo enseñado (${Math.round(Math.max(cob, parecido) * 100)} %)`);

  return { ok: motivos.length === 0, motivos, cobertura: Number(cob.toFixed(2)), parecido: Number(parecido.toFixed(2)) };
}
