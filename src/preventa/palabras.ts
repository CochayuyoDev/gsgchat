/**
 * Si lo que escribió el cliente son palabras de verdad.
 *
 * No es un diccionario, y a propósito: un diccionario rechazaría "Sublime",
 * "iPhone 15", "polos oversize" y la mitad de lo que la gente envía de verdad.
 * Lo que se comprueba es la FORMA de la palabra, que es lo que separa
 * "documentos" de "asdasd" sin tener que conocer ninguna de las dos.
 *
 * Las reglas salen de cómo se construye una palabra en español:
 *
 *  - lleva vocales, y no una cada seis letras;
 *  - no repite la misma letra tres veces seguidas ("aaaa");
 *  - no encadena cuatro consonantes ("sdfgh");
 *  - no es una risa ni un relleno ("jajaja", "xd").
 *
 * Y se aplica con una regla generosa: basta UNA palabra plausible para que la
 * respuesta valga. "una caja de documentos xd" es una respuesta legítima con
 * una coletilla; rechazarla sería pedantear.
 */

const VOCALES = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

/**
 * Tramos de teclado de tres letras.
 *
 * Los de cuatro ya los caza la regla de las consonantes seguidas; estos de
 * tres son los que forman "asdasd" y "qweqwe", que por separado tienen
 * vocales suficientes para colarse.
 */
const TRAMOS = [
  'qwe', 'wer', 'ert', 'rty', 'tyu', 'yui', 'uio', 'iop',
  'asd', 'sdf', 'dfg', 'fgh', 'ghj', 'hjk', 'jkl',
  'zxc', 'xcv', 'cvb', 'vbn', 'bnm',
];

/**
 * Si la palabra es un trozo corto repetido: "asdasd", "papapa".
 *
 * Se exige ademas poca vocal, porque en español hay palabras que son un
 * trozo repetido y existen: papa, coco, bebe, mama. Sin esa condicion,
 * rechazariamos la mitad de los apodos.
 */
function esTrozoRepetido(palabra: string, proporcionVocales: number): boolean {
  if (proporcionVocales >= 0.4) return false;

  for (const trozo of [2, 3, 4]) {
    if (palabra.length < trozo * 2 || palabra.length % trozo !== 0) continue;
    const primero = palabra.slice(0, trozo);
    const partes = palabra.match(new RegExp(`.{${trozo}}`, 'g')) ?? [];
    if (partes.every((x) => x === primero)) return true;
  }

  return false;
}

/** Risas y coletillas. Se entienden, pero no contestan nada. */
const RELLENO = new Set([
  'jaja', 'jajaja', 'jajajaja', 'jeje', 'jejeje', 'jiji', 'jojo', 'haha',
  'hahaha', 'lol', 'xd', 'xdd', 'xddd', 'ajaja', 'jsjs', 'jsjsjs', 'ptm',
  'aaa', 'eee', 'mmm', 'hmm', 'ummm', 'ajá', 'aja', 'uhm',
]);

const normaliza = (texto: string): string =>
  texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Si esa palabra suelta podría existir.
 *
 * Los números pasan: "500mg", "2m", "15" son parte de lo que la gente envía.
 */
export function palabraPlausible(palabra: string): boolean {
  if (!palabra) return false;
  if (RELLENO.has(palabra)) return false;

  // Con dígitos dentro, es una medida o un modelo: no se le pide estructura
  // de palabra española a "65W" ni a "iPhone15".
  if (/\d/.test(palabra)) return true;

  if (palabra.length < 3) return false;

  // La misma letra tres veces seguidas no ocurre en español.
  if (/(.)\1\1/.test(palabra)) return false;

  // Cuatro consonantes seguidas tampoco.
  if (/[bcdfghjklmnpqrstvwxyzñ]{4,}/.test(palabra)) return false;

  const vocales = [...palabra].filter((c) => VOCALES.has(c)).length;
  if (vocales === 0) return false;

  const proporcion = vocales / palabra.length;

  // Un tramo de teclado con poca vocal: "asdasd" tiene "asd" dentro y dos
  // vocales de seis. "casa" no tiene tramo, y "aeiou" no tiene poca vocal.
  if (proporcion < 0.45 && TRAMOS.some((t) => palabra.includes(t))) return false;

  if (esTrozoRepetido(palabra, proporcion)) return false;

  // Una vocal cada cinco letras o menos. "documentos" tiene 4 de 10.
  return proporcion >= 0.2 && proporcion <= 0.8;
}

/**
 * Si el mensaje entero contiene al menos una palabra que podría existir.
 *
 * Es deliberadamente permisivo: basta una. El objetivo es cazar la respuesta
 * que no dice NADA, no corregirle el castellano al cliente.
 */
export function pareceTextoReal(texto: string): boolean {
  const palabras = normaliza(texto).split(' ').filter(Boolean);
  if (!palabras.length) return false;
  return palabras.some((p) => palabraPlausible(p));
}
