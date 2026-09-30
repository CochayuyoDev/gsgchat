/**
 * Tu o usted.
 *
 * El negocio elige como se trata al cliente (Ajustes → "Cómo tratamos al
 * cliente"): de tu, de usted, o "según el cliente": de usted la primera
 * vez y, si el cliente tutea, de tu. El asistente lo recibe en su prompt;
 * los textos fijos de las entregas los redacta cada negocio en Ajustes de
 * las entregas, asi que ahi manda lo que escriba.
 */

export type Tono = 'tu' | 'usted' | 'auto';
export type TonoEfectivo = 'tu' | 'usted';

export const TONOS: Array<{ valor: Tono; etiqueta: string; detalle: string }> = [
  { valor: 'auto', etiqueta: 'Según el cliente (recomendado)', detalle: 'De usted la primera vez; si el cliente tutea, de tú.' },
  { valor: 'usted', etiqueta: 'Siempre de usted', detalle: 'Más formal: «¿nos confirma que lo recibe hoy?».' },
  { valor: 'tu', etiqueta: 'Siempre de tú', detalle: 'Más cercano: «¿nos confirmas que lo recibes hoy?».' },
];

/** Palabras que solo se dicen tuteando (verbos en segunda persona y pronombres). */
const TUTEO = /\b(t[uú]|te|tus?|tienes|puedes|quieres|sabes|dime|d[aá]me|m[aá]ndame|env[ií]ame|p[aá]same|av[ií]same|ll[aá]mame|escr[ií]beme|est[aá]s|eres|vas|haces|dices|ven|mira|oye)\b/i;
/** Palabras que solo se dicen de usted. */
const USTEDEO = /\b(usted|ustedes|tiene|puede|quiere|sabe|d[ií]game|env[ií]eme|m[aá]ndeme|p[aá]seme|av[ií]seme|ll[aá]meme|escr[ií]bame|disculpe|perd[oó]n(e|eme)|se[nñ]or(a|ita)?)\b/i;

/** Si el cliente tutea en lo que escribio (gana lo ultimo que dijo). */
export function pareceTuteo(textos: string[]): boolean | null {
  for (let i = textos.length - 1; i >= 0; i--) {
    const t = textos[i] ?? '';
    const tutea = TUTEO.test(t);
    const ustedea = USTEDEO.test(t);
    if (tutea && !ustedea) return true;
    if (ustedea && !tutea) return false;
  }
  return null;
}

/** El tratamiento que toca con este cliente. */
export function tonoEfectivo(tono: Tono | null | undefined, textosDelCliente: string[]): TonoEfectivo {
  if (tono === 'tu' || tono === 'usted') return tono;
  const tutea = pareceTuteo(textosDelCliente);
  return tutea === true ? 'tu' : 'usted';
}

/** La linea que va en el prompt del asistente. */
export function instruccionDeTono(t: TonoEfectivo): string {
  return t === 'tu'
    ? '- Trata al cliente de TÚ (tutea): «¿puedes…?», «te llevamos», «tu pedido». No mezcles con usted.'
    : '- Trata al cliente de USTED: «¿puede…?», «le llevamos», «su pedido». No tutees aunque el cliente sea informal, salvo que él mismo tutee de forma clara.';
}

/** Lee el ajuste tal como se guarda ('tu' | 'usted' | 'auto' | null). */
export function tonoDeValor(valor: unknown): Tono {
  return valor === 'tu' || valor === 'usted' ? valor : 'auto';
}
