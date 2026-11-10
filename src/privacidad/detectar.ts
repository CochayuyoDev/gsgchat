/**
 * Reconocer cuando un cliente pide que no le escriban mas (BAJA) o que borren
 * sus datos.
 *
 * Primero las reglas, que reconocen las frases claras («BAJA», «no me
 * escriban mas», «borren mis datos»). Si no hay una frase clara pero el
 * mensaje habla de eso («ya no quiero esto», «saquen mi numero»), decide la
 * IA, si esta configurada. La IA solo CLASIFICA: nunca escribe al cliente ni
 * ejecuta nada; lo que reconoce pasa a una persona (regla del dueño, 09/11).
 */

import type { TipoPrivacidad } from './repo.js';

/** Minusculas, sin tildes y sin signos: «¡Bórrenme!» → «borrenme». */
export function normalizarTexto(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Borrar sus datos: va antes que la baja (quien pide borrar tambien deja de recibir). */
const REGLAS_BORRAR: RegExp[] = [
  /\b(borr|elimin|suprim|quit|retir)\w*\b.{0,30}\b(mis|todos mis|mi|toda mi)\b.{0,12}\b(datos|informacion|info|registro|registros|data)\b/,
  /\b(borr|elimin|suprim)\w*\b.{0,20}\b(mi|mis)\b.{0,10}\b(numero|telefono|celular|contacto|cuenta|historial|chat|conversacion)\b/,
  /\b(borr|elimin|suprim)\w*(me|nme|enme)\b.{0,20}\b(sistema|base|registro|lista)\b/,
  /\bno (quiero|deseo) que (tengan|guarden|conserven|usen)\b.{0,15}\b(mis datos|mi informacion|mi numero)\b/,
  /\b(derecho|solicitud) (de|a la) (cancelacion|supresion|eliminacion)\b/,
  /\beliminacion de (mis )?datos\b/,
  /\bley 29733\b/,
  /\b(arco)\b.{0,20}\b(derecho|derechos|datos)\b/,
];

const REGLAS_BAJA: RegExp[] = [
  /^(baja|stop|unsubscribe|darme de baja|dame de baja|denme de baja)$/,
  /\b(dar|darme|dame|denme|deme|den)\b.{0,6}\bde baja\b/,
  /\bno (me|nos) (escriban|escribas|escriba|manden|mandes|mande|envien|envies|envie|contacten|molesten|molestes)\b.{0,15}\b(mas mensajes|mas whatsapp|nunca mas|mas por aqui|mas)$/,
  // «No me escriban» solo, sin nada detrás: «no me manden al motorizado antes de las 3» no es una baja.
  /^(por favor |porfa )?(ya )?no (me|nos) (escriban|escribas|manden|mandes|envien|envies|contacten|molesten|molestes)( por favor| porfa| gracias| ok)*$/,
  /\b(dejen|deja|deje) de (escribir|mandar|enviar|molestar|contactar)\w*\b/,
  /\bno (quiero|deseo) (recibir )?(mas )?(mensajes|mensaje|notificaciones|whatsapp|publicidad|promociones)\b/,
  /\b(sacar|saquen|saca|quitar|quiten|quita|borrar|borren)\w*\b.{0,10}\b(de|de la|de su|de sus|de esta)\b.{0,6}\b(lista|listas|difusion|base)\b/,
  /\b(spam|acoso)\b/,
];

/** Palabras que hacen dudar: sin una regla clara, la IA decide si es eso. */
const PISTAS = /\b(baja|bloque\w*|mensaj\w*|escrib\w*|molest\w*|spam|datos|informacion|borr\w*|elimin\w*|lista|contact\w*|denuncia\w*|reporta\w*|indecopi|privacidad)\b/;

/** Lo que reconocen las reglas, o null si no hay una frase clara. */
export function privacidadPorReglas(texto: string): TipoPrivacidad | null {
  const t = normalizarTexto(texto);
  if (!t || t.length > 600) return null;
  if (REGLAS_BORRAR.some((r) => r.test(t))) return 'borrar_datos';
  if (REGLAS_BAJA.some((r) => r.test(t))) return 'baja';
  return null;
}

/** Si vale la pena preguntarle a la IA (para no gastar una llamada en cada «ok»). */
export function hayPistaDePrivacidad(texto: string): boolean {
  const t = normalizarTexto(texto);
  return t.length >= 3 && t.length <= 600 && PISTAS.test(t);
}

export function promptClasificadorPrivacidad(): string {
  return [
    'Clasificas UN mensaje que un cliente le escribio por WhatsApp a una empresa de reparto.',
    'Responde solo con una palabra:',
    'BAJA: pide que no le escriban mas, que lo saquen de la lista, que dejen de mandarle mensajes, o se queja de que le escriben (spam).',
    'BORRAR: pide que borren o eliminen sus datos, su numero, su informacion o su historial, o invoca sus derechos sobre sus datos personales.',
    'OTRA: cualquier otra cosa. Cancelar o reprogramar un pedido, decir que no esta en casa, preguntar por su pedido, quejarse del servicio o del motorizado, o mandar su direccion NO es BAJA ni BORRAR.',
    'Si pide las dos cosas, responde BORRAR. Si dudas, responde OTRA.',
  ].join('\n');
}

/** BAJA / BORRAR / OTRA → el tipo, o null. */
export function leerClasePrivacidad(respuesta: string): TipoPrivacidad | null {
  const r = normalizarTexto(String(respuesta)).split(' ')[0] ?? '';
  if (r === 'borrar') return 'borrar_datos';
  if (r === 'baja') return 'baja';
  return null;
}

export interface MensajeIA {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Reglas primero; si no, la IA (cuando hay pista y esta configurada). Un fallo
 * de la IA no rompe nada: se queda en «no es eso» y el mensaje sigue su camino.
 */
export async function detectarPrivacidad(
  texto: string,
  clasificar?: (mensajes: MensajeIA[]) => Promise<string>,
): Promise<{ tipo: TipoPrivacidad; como: 'reglas' | 'ia' } | null> {
  const porReglas = privacidadPorReglas(texto);
  if (porReglas) return { tipo: porReglas, como: 'reglas' };
  if (!clasificar || !hayPistaDePrivacidad(texto)) return null;
  try {
    const cruda = await clasificar([
      { role: 'system', content: promptClasificadorPrivacidad() },
      { role: 'user', content: texto.slice(0, 600) },
    ]);
    const tipo = leerClasePrivacidad(cruda);
    return tipo ? { tipo, como: 'ia' } : null;
  } catch {
    return null;
  }
}

/** Como se llama cada caso en pantalla (chips, avisos, bitacora). */
export const NOMBRE_PRIVACIDAD: Record<TipoPrivacidad, string> = {
  baja: 'Pidió la baja',
  borrar_datos: 'Pidió borrar sus datos',
};

/** Lo que se le contesta UNA vez al cliente: que se recibio y que lo ve una persona. */
export const RESPUESTA_PRIVACIDAD: Record<TipoPrivacidad, string> = {
  baja: 'Recibimos tu pedido de no recibir más mensajes. Una persona del equipo te quitará de la lista en breve.',
  borrar_datos: 'Recibimos tu pedido de eliminar tus datos. Una persona del equipo lo atenderá y te confirmará por aquí cuando esté hecho.',
};
