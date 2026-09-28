/**
 * «Mis casos»: conversaciones de prueba que escribe la persona, en palabras,
 * una linea por mensaje. Se convierten en un guion (guiones.ts) y se corren
 * igual que los que vienen hechos. Se guardan por tienda (settings).
 *
 * El formato, pensado para escribirse sin aprender nada:
 *
 *   inicio: sin ubicación            (o «con ubicación»: GSG ya la tenía)
 *   cliente: ¿Por qué me piden mi ubicación?
 *   => dice: Es necesaria
 *   cliente: [ubicación]             ([ubicación] [enlace] [foto] [audio: lo que dice])
 *   => dice: Ubicación registrada    (lo que el sistema le tiene que contestar)
 *   esperar motorizado
 *   cliente: ¿a qué hora llega?
 *   => dice: se entrega hoy entre (la pregunta por su pedido o la hora: SIEMPRE la hora estimada, o el horario si el motorizado aún no dio su tiempo)
 *   cliente: ¿cuánto cuesta el envío?
 *   => dice: no se reciben consultas (regla del dueño: tras el agradecimiento, otra consulta recibe el cierre UNA vez…)
 *   => con el número del motorizado  (…con el número del motorizado asignado)
 *   cliente: hola?
 *   => calla                         (y desde ahí, silencio)
 *   (antes de su ubicación, «otra cosa» recibe primero 3 insistencias:
 *    «=> dice: Para entregarte tu pedido», «=> dice: Aún no nos llega»,
 *    «=> dice: Último aviso»; recién a la 4.ª «no se reciben consultas»)
 *   motorizado: 40                  (espera solo a que un motorizado de prueba tenga el pedido)
 *   => estado: en camino             (entregado, en camino, con motorizado, para una persona, cancelado…)
 *   adelantar: 2 h                   (30 min, 2 h, o «pasada la hora»)
 *   cliente: ya pasó la hora y no llega
 *   => estado: para una persona
 *
 * Tambien se puede describir el caso con palabras y la IA de la tienda lo
 * escribe en este formato (si la IA esta conectada).
 */

import { randomBytes } from 'node:crypto';
import type { SettingsRepo } from '../settings/service.js';
import type { Guion } from './guiones.js';

export const CLAVE_CASOS = 'desarrollador.casos';
export const MAX_CASOS = 50;
export const MAX_LINEAS = 60;

export interface CasoGuardado {
  id: string;
  titulo: string;
  texto: string;
  creadoEn: string;
}

export const EJEMPLO_CASO = `inicio: sin ubicación
cliente: ¿Por qué me piden mi ubicación?
=> dice: Es necesaria para calcular la ruta
cliente: [ubicación]
=> dice: Ubicación registrada
esperar motorizado
cliente: ¿a qué hora llega?
=> dice: se entrega hoy entre
cliente: ¿cuánto cuesta el envío?
=> dice: no se reciben consultas
=> con el número del motorizado
cliente: hola?
=> calla
motorizado: 30
=> estado: en camino
motorizado: entregado
=> estado: entregado`;

/** Estados en palabras -> estados del sistema. */
const ESTADOS: Array<[RegExp, string[]]> = [
  [/^entregad[oa]s?$/, ['entregada']],
  [/^(en camino|avisad[oa]|con hora)$/, ['avisada']],
  [/^(con (el )?motorizado|esperando (al )?motorizado)$/, ['esperando_motorizado', 'avisada']],
  [/^(list[oa]|confirmad[oa])$/, ['lista', 'esperando_motorizado', 'avisada']],
  [/^(para una persona|incidencia|derivad[oa]|problema)$/, ['incidencia']],
  [/^(cancelad[oa]|anulad[oa])$/, ['cancelada']],
  [/^(terminad[oa]|cerrad[oa])$/, ['terminada']],
  [/^(esperando (la )?confirmacion|falta confirmar|sin confirmar)$/, ['esperando_confirmacion']],
  [/^(esperando (la )?ubicacion|falta (la )?ubicacion|sin ubicacion)$/, ['esperando_ubicacion']],
];
const ESTADOS_CRUDOS = new Set(['pendiente', 'esperando_ubicacion', 'esperando_confirmacion', 'lista', 'esperando_motorizado', 'avisada', 'entregada', 'terminada', 'incidencia', 'cancelada']);

export const sinTildes = (t: string): string => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

function estadosDe(texto: string): string[] | null {
  const partes = sinTildes(texto).split(/\s*(?:,| o | u |\/)\s*/).filter(Boolean);
  const out = new Set<string>();
  for (const p of partes) {
    if (ESTADOS_CRUDOS.has(p.replace(/ /g, '_'))) {
      out.add(p.replace(/ /g, '_'));
      continue;
    }
    const hit = ESTADOS.find(([re]) => re.test(p));
    if (!hit) return null;
    hit[1].forEach((e) => out.add(e));
  }
  return out.size ? [...out] : null;
}

function minutosDe(texto: string): number | 'pasada_la_hora' | null {
  const t = sinTildes(texto);
  if (/pasad[ao] la hora|despues de la hora|que pase la hora/.test(t)) return 'pasada_la_hora';
  const m = /^(\d+(?:[.,]\d+)?)\s*(min|minutos?|m|h|horas?|hr?s?)?$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  const unidad = m[2] ?? 'min';
  const min = /^h/.test(unidad) ? n * 60 : n;
  return min >= 1 && min <= 24 * 60 ? Math.round(min) : null;
}

export class ErrorDeCaso extends Error {
  constructor(
    readonly linea: number,
    mensaje: string,
  ) {
    super(linea ? `Línea ${linea}: ${mensaje}` : mensaje);
  }
}

/** El texto de un caso -> un guion. Lanza ErrorDeCaso con la linea y que hacer. */
export function interpretarCaso(texto: string, titulo = 'Mi caso', id = 'propio'): Guion {
  const lineas = texto.split(/\r?\n/);
  if (lineas.filter((l) => l.trim()).length > MAX_LINEAS) throw new ErrorDeCaso(0, `El caso es muy largo: como mucho ${MAX_LINEAS} líneas.`);
  const pasos: Guion['pasos'] = [];
  let inicio: Guion['inicio'] | null = null;
  let nombre = titulo;
  let primeraDelCliente: string | null = null;

  lineas.forEach((cruda, i) => {
    const n = i + 1;
    const l = cruda.trim();
    if (!l || l.startsWith('#')) return;
    let m: RegExpExecArray | null;

    if ((m = /^inicio\s*:\s*(.+)$/i.exec(l))) {
      const t = sinTildes(m[1]!);
      if (/sin (ubicacion|pin)|falta (la )?ubicacion/.test(t)) inicio = 'sin_pin';
      else if (/con (ubicacion|pin)|falta confirmar|ya (dio|tiene) (la )?ubicacion/.test(t)) inicio = 'con_pin';
      else throw new ErrorDeCaso(n, 'en «inicio» escribe «sin ubicación» (se le va a pedir) o «con ubicación» (GSG ya la tenía).');
      return;
    }
    if ((m = /^t[ií]tulo\s*:\s*(.+)$/i.exec(l))) {
      nombre = m[1]!.trim().slice(0, 80);
      return;
    }
    if ((m = /^(=>|→|->)\s*(.+)$/.exec(l))) {
      const anterior = pasos[pasos.length - 1];
      if (!anterior || anterior.tipo === 'adelantar') throw new ErrorDeCaso(n, '«=>» dice lo que se espera del mensaje de la línea de arriba: ponlo debajo de una línea de «cliente:» o «motorizado:».');
      const actual = anterior.espera ?? { que: '' };
      // Regla del dueño: «=> calla» (o «silencio», «no contesta»): a ese número no se le contesta nada.
      if (/^(calla|silencio|no contesta|no le contesta|no responde|nada)$/.test(sinTildes(m[2]!))) {
        actual.calla = true;
        actual.que = [actual.que, 'que NO se le conteste nada (silencio)'].filter(Boolean).join(' y ');
        anterior.espera = actual;
        return;
      }
      // «=> con el número del motorizado»: la respuesta lleva el número del motorizado asignado a ese pedido.
      if (/^(con |lleva |trae )?(el )?(numero|telefono) del motorizado( asignado)?$/.test(sinTildes(m[2]!))) {
        actual.numeroDelMotorizado = true;
        actual.que = [actual.que, 'que lleve el número del motorizado asignado'].filter(Boolean).join(' y ');
        anterior.espera = actual;
        return;
      }
      const esp = /^(estado|queda|dice|debe decir|responde|contesta)\s*:?\s*(.+)$/i.exec(m[2]!.trim());
      if (!esp) throw new ErrorDeCaso(n, 'después de «=>» escribe «estado: …» (entregado, en camino, para una persona…), «dice: …» (un trozo de lo que tiene que contestar) o «calla» (no se le contesta nada).');
      if (/^(estado|queda)$/i.test(esp[1]!)) {
        const estados = estadosDe(esp[2]!);
        if (!estados) throw new ErrorDeCaso(n, `no conozco el estado «${esp[2]}». Usa: entregado, en camino, con motorizado, listo, para una persona, cancelado, terminado, esperando confirmación o esperando ubicación.`);
        actual.estado = estados;
        actual.que = [actual.que, `que quede ${esp[2]!.trim()}`].filter(Boolean).join(' y ');
      } else {
        actual.contiene = esp[2]!.replace(/^[«"']|[»"']$/g, '').trim();
        actual.que = [actual.que, `que conteste algo con «${actual.contiene}»`].filter(Boolean).join(' y ');
      }
      anterior.espera = actual;
      return;
    }
    if ((m = /^adelantar\s*:?\s*(.+)$/i.exec(l))) {
      const min = minutosDe(m[1]!);
      if (min === null) throw new ErrorDeCaso(n, 'en «adelantar» escribe cuánto: «30 min», «2 h» o «pasada la hora».');
      pasos.push({ tipo: 'adelantar', minutos: min, que: min === 'pasada_la_hora' ? 'pasa la hora que se le prometió' : `pasan ${min >= 60 && min % 60 === 0 ? `${min / 60} h` : `${min} min`}` });
      return;
    }
    if (/^esperar (al |el |a un )?motorizado$/i.test(sinTildes(l))) {
      pasos.push({ tipo: 'esperar_motorizado', espera: { estado: ['esperando_motorizado', 'avisada'], que: 'el pedido le llega a un motorizado de prueba' } });
      return;
    }
    if ((m = /^(cliente|c|motorizado|moto|m)\s*:\s*(.+)$/i.exec(l))) {
      const quien = /^c/i.test(m[1]!) ? 'cliente' : 'motorizado';
      const dice = m[2]!.trim();
      let paso: Extract<Guion['pasos'][number], { tipo: 'escribe' }>;
      const especial = /^\[(.+?)\]$/.exec(dice);
      if (especial) {
        const t = sinTildes(especial[1]!);
        const audio = t.startsWith('audio') ? /^\[\s*audio\s*:?\s*(.*)\]$/i.exec(dice) : null;
        if (/^(ubicacion|pin|mi ubicacion)$/.test(t)) paso = { tipo: 'escribe', quien, dice: { tipo: 'pin' } };
        else if (/^(enlace|maps|google maps|link)$/.test(t)) paso = { tipo: 'escribe', quien, dice: { tipo: 'enlace' } };
        else if (/^foto$/.test(t)) paso = { tipo: 'escribe', quien, dice: { tipo: 'foto' } };
        else if (audio) paso = { tipo: 'escribe', quien, dice: { tipo: 'audio', texto: audio[1]!.trim() || 'Hola, ya estoy en casa' } };
        else throw new ErrorDeCaso(n, `no conozco «[${especial[1]}]». Usa [ubicación], [enlace], [foto] o [audio: lo que dice].`);
      } else {
        paso = { tipo: 'escribe', quien, dice: { tipo: 'texto', texto: dice.slice(0, 1000) } };
      }
      if (quien === 'cliente' && primeraDelCliente === null) primeraDelCliente = paso.dice.tipo;
      pasos.push(paso);
      return;
    }
    throw new ErrorDeCaso(n, `no entiendo «${l.slice(0, 60)}». Empieza la línea con «cliente:», «motorizado:», «=>», «adelantar:», «esperar motorizado» o «inicio:».`);
  });

  if (!pasos.length) throw new ErrorDeCaso(0, 'El caso está vacío: escribe al menos una línea de «cliente:».');
  // Sin «inicio», se deduce: si lo primero que hace el cliente es mandar su ubicacion, empieza sin ella.
  const empieza: Guion['inicio'] = inicio ?? (primeraDelCliente === 'pin' || primeraDelCliente === 'enlace' ? 'sin_pin' : 'con_pin');
  return { id, titulo: nombre, resumen: 'Caso escrito a mano.', inicio: empieza, pasos };
}

// ------------------------------------------------------------ guardarlos

export function crearAlmacenCasos(settings: SettingsRepo | undefined) {
  const leer = async (): Promise<CasoGuardado[]> => {
    if (!settings) return [];
    const fila = (await settings.getAll()).find((x) => x.key === CLAVE_CASOS);
    if (!fila) return [];
    try {
      const v = JSON.parse(fila.value) as CasoGuardado[];
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  const escribir = async (casos: CasoGuardado[]) => {
    if (!settings) throw new Error('En este arranque no se pueden guardar casos.');
    await settings.put(CLAVE_CASOS, JSON.stringify(casos), false);
  };
  return {
    listar: leer,
    async guardar(caso: { id?: string; titulo: string; texto: string }): Promise<CasoGuardado> {
      interpretarCaso(caso.texto, caso.titulo); // que se entienda antes de guardarlo
      const casos = await leer();
      const existente = caso.id ? casos.find((c) => c.id === caso.id) : undefined;
      if (!existente && casos.length >= MAX_CASOS) throw new ErrorDeCaso(0, `Ya hay ${MAX_CASOS} casos guardados: borra alguno antes de guardar otro.`);
      const nuevo: CasoGuardado = { id: existente?.id ?? randomBytes(4).toString('hex'), titulo: caso.titulo.trim().slice(0, 80) || 'Mi caso', texto: caso.texto, creadoEn: existente?.creadoEn ?? new Date().toISOString() };
      await escribir(existente ? casos.map((c) => (c.id === nuevo.id ? nuevo : c)) : [...casos, nuevo]);
      return nuevo;
    },
    async borrar(id: string): Promise<boolean> {
      const casos = await leer();
      if (!casos.some((c) => c.id === id)) return false;
      await escribir(casos.filter((c) => c.id !== id));
      return true;
    },
  };
}

// --------------------------------------------------- escribirlo con la IA

export const INSTRUCCIONES_IA = `Conviertes la descripción de un caso de prueba de un sistema de reparto por WhatsApp (Perú, español) en un guion con este formato EXACTO, una instrucción por línea, sin nada más (ni explicaciones, ni comillas, ni markdown):

inicio: sin ubicación | con ubicación      (sin ubicación = hay que pedírsela; con ubicación = GSG ya la tenía)
cliente: <lo que escribe el cliente, como lo escribiría por WhatsApp>
cliente: [ubicación] | [enlace] | [foto] | [audio: lo que dice]
motorizado: <lo que escribe el motorizado: minutos como «40», «estoy cerca», «entregado», «no estaba nadie»>
=> estado: entregado | en camino | con motorizado | listo | para una persona | cancelado | terminado | esperando confirmación | esperando ubicación
=> dice: <un trozo corto de lo que el sistema debería contestar a la línea de arriba>
=> calla      (el sistema no le contesta nada a la línea de arriba)
=> con el número del motorizado      (la respuesta lleva el número del motorizado asignado)
adelantar: 30 min | 2 h | pasada la hora
esperar motorizado

Reglas (regla del dueño): al cliente solo se le pide la ubicación; no hay pregunta SÍ/NO. Si pregunta por qué se le pide, se le explica («=> dice: Es necesaria»). Si manda su ubicación recibe «Ubicación registrada» con «¡Muchas gracias!» (con ubicación: si dice SÍ, recibe «queda confirmado»). Si DESPUÉS de ese agradecimiento pregunta cualquier cosa, recibe UNA vez «no se reciben consultas» con el número del motorizado asignado, y desde ahí «=> calla». Cualquier otra cosa antes de la ubicación (un saludo, un sticker, una consulta) NO recibe el cierre de inmediato: las 3 primeras veces se le vuelve a pedir la ubicación («=> dice: Para entregarte tu pedido necesitamos tu ubicación», luego «=> dice: Aún no nos llega tu ubicación», luego «=> dice: Último aviso»); recién a la 4.ª recibe una vez «no se reciben consultas» con el número, y luego «=> calla». Si en medio manda su ubicación, recibe «Ubicación registrada». El pedido llega al motorizado cuando ya tiene la ubicación; lo del motorizado sigue igual. Usa «=>» solo cuando la descripción diga qué debe pasar. Máximo 30 líneas.

Ejemplo:
${EJEMPLO_CASO}`;

/** Quita lo que la IA pueda añadir alrededor (```, comillas). */
export function limpiarRespuestaIA(texto: string): string {
  return texto
    .replace(/```[a-z]*\n?/gi, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*]\s+/, '').trimEnd())
    .filter((l) => l.trim())
    .join('\n')
    .trim();
}
