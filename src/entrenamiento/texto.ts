/**
 * Las herramientas de texto del entrenamiento: normalizar, partir en
 * palabras, comparar y tapar datos personales.
 *
 * Todo es lexico y en memoria, sin modelos ni dependencias: es lo que hace
 * que buscar entre diez mil lecciones tarde un milisegundo y que el sistema
 * funcione igual sin conexion a la IA. Se tolera lo que escribe un cliente
 * real: sin tildes, en mayusculas, con faltas ("zapatiyas") y con signos.
 */

import { createHash } from 'node:crypto';

/** Minusculas, sin tildes ni signos, con un solo espacio entre palabras. */
export function normalizar(texto: string): string {
  return (texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Palabras que no dicen nada de que va la frase. Se quitan antes de indexar
 * y de comparar: "cuanto cuesta el envio a trujillo" queda en
 * "cuanto cuesta envio trujillo".
 */
const VACIAS = new Set(
  (
    'a al algo alguna algunas alguno algunos ante antes aqui asi aun como con contra cual cuales cuando de del desde donde dos e el ella ellas ellos en entre era eran es esa esas ese eso esos esta estaba estan estar este esto estos fue fueron ha haber habia hace hacen hacer han hasta hay he la las le les lo los mas me mi mis mucho muy nada ni no nos nosotros o os otra otras otro otros para pero poco por porque que quien quienes se sea sean segun ser si sin sobre son soy su sus tambien tanto te tendra tener tengo ti tiene tienen todo todos tu tus un una unas uno unos usted ustedes vosotros ya yo hola buenas buenos dias tardes noches gracias porfa porfavor favor ok oka okey vale dale ah eh mmm jaja jajaja xd' +
    ' me lo la dime dame quiero quisiera puede pueden podria podrian puedo'
  ).split(/\s+/),
);

/**
 * Una raiz burda para que "envios", "envio" y "enviar" cuenten como lo
 * mismo. No es un stemmer de verdad: quita plurales y terminaciones
 * frecuentes del espanol, lo justo para que dos frases sobre lo mismo se
 * parezcan.
 */
export function raiz(palabra: string): string {
  let p = palabra;
  if (p.length <= 3) return p;
  let recortada = false;
  for (const fin of ['aciones', 'amiento', 'imiento', 'ciones', 'mente', 'idades', 'amos', 'emos', 'imos', 'aron', 'ieron', 'idad', 'cion', 'sion', 'ando', 'iendo', 'ados', 'idos', 'adas', 'idas', 'ales', 'eros', 'eras', 'ado', 'ido', 'ada', 'ida', 'aba', 'ian', 'ero', 'era', 'ito', 'ita', 'es', 'ar', 'er', 'ir', 'os', 'as', 'an', 'en', 's']) {
    if (p.length - fin.length >= 3 && p.endsWith(fin)) {
      p = p.slice(0, -fin.length);
      recortada = true;
      break;
    }
  }
  // Sin terminacion que quitar, la vocal final sobra: envio y envios (ya sin
  // "os") quedan en "envi"; talla y tallas, en "tall".
  if (!recortada && p.length >= 4 && /[aeiou]$/.test(p)) p = p.slice(0, -1);
  return p;
}

/** Las palabras con peso de una frase, ya normalizadas y con su raiz. */
export function palabras(texto: string): string[] {
  return normalizar(texto)
    .split(' ')
    .filter((p) => p.length >= 2 && !VACIAS.has(p))
    .map(raiz)
    .filter((p) => p.length >= 2);
}

/** Trigramas de letras: lo que hace que "zapatiyas" se parezca a "zapatillas". */
export function trigramas(texto: string): Set<string> {
  const salida = new Set<string>();
  for (const palabra of normalizar(texto).split(' ')) {
    if (palabra.length < 2 || VACIAS.has(palabra)) continue;
    const p = ` ${palabra} `;
    for (let i = 0; i + 3 <= p.length; i++) salida.add(p.slice(i, i + 3));
  }
  return salida;
}

/** Coeficiente de Dice entre dos conjuntos: 0 nada en comun, 1 iguales. */
export function dice<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size || !b.size) return 0;
  let comunes = 0;
  for (const x of a) if (b.has(x)) comunes++;
  return (2 * comunes) / (a.size + b.size);
}

/** Cuanto se parecen dos textos (0..1), mezclando palabras y trigramas. */
export function similitud(a: string, b: string): number {
  const pa = new Set(palabras(a));
  const pb = new Set(palabras(b));
  const porPalabras = dice(pa, pb);
  const porTrigramas = dice(trigramas(a), trigramas(b));
  return Math.max(porPalabras, porTrigramas * 0.9);
}

/**
 * Que parte de las palabras de `esperado` aparecen en `dado` (0..1). Es la
 * medida del examen: una respuesta con otras palabras pero los mismos
 * datos cubre bien; una que se fue por otro lado, no.
 */
export function cobertura(esperado: string, dado: string): number {
  const pe = new Set(palabras(esperado));
  if (!pe.size) return 1;
  const pd = new Set(palabras(dado));
  const td = trigramas(dado);
  let cubiertas = 0;
  for (const p of pe) {
    if (pd.has(p)) {
      cubiertas++;
      continue;
    }
    // Una palabra con falta de ortografia cuenta si sus trigramas estan.
    const tp = trigramas(p);
    if (tp.size && [...tp].filter((t) => td.has(t)).length / tp.size >= 0.6) cubiertas++;
  }
  return cubiertas / pe.size;
}

/**
 * Los datos duros de una frase: cifras (precios, horas, dias, tallas) tal
 * como hay que decirlas. "S/ 120", "2 a 3 dias", "24 h", "9 a 19".
 */
export function cifras(texto: string): string[] {
  const n = normalizar(texto.replace(/(\d)[.,](\d{3})\b/g, '$1$2').replace(/(\d)[.,](\d{1,2})\b/g, '$1p$2'));
  const salida = new Set<string>();
  for (const m of n.matchAll(/\b\d+(?:p\d+)?\b/g)) salida.add(m[0].replace('p', ','));
  return [...salida];
}

/** Si la respuesta dice cada cifra de lo esperado; devuelve las que faltan. */
export function cifrasQueFaltan(esperado: string, dado: string): string[] {
  const dadas = new Set(cifras(dado));
  return cifras(esperado).filter((c) => !dadas.has(c));
}

/**
 * Tapa lo que identifica a una persona: telefonos, DNI, correos, tarjetas.
 * Se aplica a todo lo que se aprende de una conversacion real antes de
 * guardarlo: la leccion es "como se responde", no "a quien".
 *
 * Los precios y las cantidades se quedan: un numero de 1 a 6 cifras es un
 * precio, una talla o una cantidad; 8 cifras es un DNI; 9 o mas, un
 * telefono; 13 a 19, una tarjeta.
 */
export function taparDatosPersonales(texto: string): string {
  return (texto ?? '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[correo]')
    .replace(/https?:\/\/(?:wa\.me|api\.whatsapp\.com)\/\S+/gi, '[enlace de WhatsApp]')
    .replace(/(?:\+?\d[\d\s.-]{7,21}\d)/g, (m) => {
      const digitos = m.replace(/\D+/g, '');
      const grupos = m.trim().split(/[\s.-]+/).length;
      if (digitos.length >= 13 && digitos.length <= 19 && grupos <= 5) return '[tarjeta]';
      // Un celular peruano (9 cifras y empieza por 9, o 51 delante) o
      // cualquier numero con el + del pais. Una lista de precios
      // ("120 130 140 150") tiene mas grupos y no empieza por 9: se queda.
      if (m.trim().startsWith('+') && digitos.length >= 9) return '[teléfono]';
      if (digitos.length === 9 && digitos.startsWith('9') && grupos <= 3) return '[teléfono]';
      if (digitos.length === 11 && digitos.startsWith('51') && grupos <= 4) return '[teléfono]';
      return m;
    })
    .replace(/\b\d{9,12}\b/g, '[teléfono]')
    .replace(/\b\d{8}\b/g, '[DNI]');
}

/** La huella con la que una leccion no entra dos veces. */
export function huellaDe(pregunta: string | null | undefined, respuesta: string): string {
  return createHash('sha1').update(`${normalizar(pregunta ?? '')}|${normalizar(respuesta)}`).digest('hex');
}

/**
 * Frases que no ensenan nada por si solas ("ok", "gracias", "si"): no se
 * aprenden como pregunta. Un cliente que solo dice "ok" no esta preguntando.
 */
const GENERICAS = new Set(['ok', 'oka', 'okey', 'okay', 'vale', 'dale', 'si', 'no', 'ya', 'gracias', 'muchas', 'mil', 'listo', 'bien', 'bueno', 'buena', 'claro', 'perfecto', 'hola', 'holi', 'buenas', 'buenos', 'buen', 'dias', 'dia', 'tardes', 'tarde', 'noches', 'noche', 'de', 'nada', 'genial', 'excelente', 'jaja', 'jajaja', 'jeje', 'xd', 'chau', 'chao', 'adios', 'hasta', 'luego', 'mañana', 'manana', 'muy', 'amable', 'gracia', 'grax', 'thanks', 'entendido', 'entiendo', 'ah', 'oh', 'mmm', 'ok ok', 'a', 'y', 'e', 'o', 'que', 'bn', 'oki']);

export function esGenerica(texto: string): boolean {
  const n = normalizar(texto);
  if (!n) return true;
  // Solo emojis, solo signos o un par de letras.
  if (n.replace(/[^a-z]/g, '').length < 2) return true;
  // "ok gracias", "muchas gracias", "buenas tardes": todas las palabras son de relleno.
  return n.split(' ').every((w) => GENERICAS.has(w) || w.length <= 1);
}

/** Acorta para las pantallas y los resumenes. */
export function acortar(texto: string, largo = 120): string {
  const t = (texto ?? '').replace(/\s+/g, ' ').trim();
  return t.length > largo ? `${t.slice(0, largo - 1)}…` : t;
}
