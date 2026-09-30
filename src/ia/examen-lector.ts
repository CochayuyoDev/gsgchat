/**
 * El examen del lector de respuestas.
 *
 * El lector (src/entregas/interpretar.ts) es el que decide, solo con reglas,
 * si un "ya pues" es un si, si "media hora" son 30 minutos o si "lo dejé con
 * el portero" es un entregado. Cada mañana —o cuando alguien pulsa "Examinar
 * ahora"— se le pasa este banco de frases y se cuenta cuantas acierta. Si el
 * porcentaje baja del umbral (alguien toco las listas y rompio algo), el
 * supervisor se entera por WhatsApp; si no, solo se enseña en Asistente IA.
 *
 * No usa la IA: mide las reglas, que es lo que lee la mayoria de respuestas.
 */

import { leerConfirmacionConReglas, leerEntregadoConReglas, leerTiempoConReglas } from '../entregas/interpretar.js';
import type { SettingsRepo } from '../settings/service.js';

export const CLAVE_EXAMEN_LECTOR = 'ia.examenLector';
export const UMBRAL_EXAMEN = 90;

type CasoConfirmacion = { tipo: 'confirmacion'; texto: string; espera: 'si' | 'no' | 'cambio' | 'no_claro' };
type CasoTiempo = { tipo: 'tiempo'; texto: string; espera: number | 'rechaza' | null };
type CasoEntregado = { tipo: 'entregado'; texto: string; espera: 'entregado' | 'no_entregado' | 'nada' };
export type CasoExamen = CasoConfirmacion | CasoTiempo | CasoEntregado;

/** El banco: lo que un cliente o un motorizado de Lima escribe de verdad. */
export const BANCO_EXAMEN: CasoExamen[] = [
  // Confirmacion: si
  { tipo: 'confirmacion', texto: 'si', espera: 'si' },
  { tipo: 'confirmacion', texto: 'Sí, dale', espera: 'si' },
  { tipo: 'confirmacion', texto: 'ok', espera: 'si' },
  { tipo: 'confirmacion', texto: 'claro', espera: 'si' },
  { tipo: 'confirmacion', texto: 'confirmo', espera: 'si' },
  { tipo: 'confirmacion', texto: 'Perfecto', espera: 'si' },
  { tipo: 'confirmacion', texto: 'aquí estaré', espera: 'si' },
  { tipo: 'confirmacion', texto: 'lo espero', espera: 'si' },
  { tipo: 'confirmacion', texto: 'manden nomás', espera: 'si' },
  { tipo: 'confirmacion', texto: '👍', espera: 'si' },
  // Confirmacion: no
  { tipo: 'confirmacion', texto: 'no', espera: 'no' },
  { tipo: 'confirmacion', texto: 'No, ya no lo quiero', espera: 'no' },
  { tipo: 'confirmacion', texto: 'cancelen', espera: 'no' },
  { tipo: 'confirmacion', texto: 'no gracias', espera: 'no' },
  { tipo: 'confirmacion', texto: 'yo no pedí nada', espera: 'no' },
  { tipo: 'confirmacion', texto: 'anular', espera: 'no' },
  // Confirmacion: cambio (otro dia / otra direccion)
  { tipo: 'confirmacion', texto: 'mañana mejor', espera: 'cambio' },
  { tipo: 'confirmacion', texto: 'otro día por favor', espera: 'cambio' },
  { tipo: 'confirmacion', texto: 'a mi oficina', espera: 'cambio' },
  { tipo: 'confirmacion', texto: 'el lunes', espera: 'cambio' },
  // Confirmacion: no esta claro
  { tipo: 'confirmacion', texto: 'no sé', espera: 'no_claro' },
  { tipo: 'confirmacion', texto: '¿qué pedido?', espera: 'no_claro' },
  { tipo: 'confirmacion', texto: 'depende', espera: 'no_claro' },
  { tipo: 'confirmacion', texto: 'te aviso', espera: 'no_claro' },
  { tipo: 'confirmacion', texto: 'cuánto cuesta', espera: 'no_claro' },
  // Tiempo del motorizado
  { tipo: 'tiempo', texto: '40', espera: 40 },
  { tipo: 'tiempo', texto: 'unos 35 minutos', espera: 35 },
  { tipo: 'tiempo', texto: 'media hora', espera: 30 },
  { tipo: 'tiempo', texto: '1h15', espera: 75 },
  { tipo: 'tiempo', texto: 'una hora', espera: 60 },
  { tipo: 'tiempo', texto: '20 min', espera: 20 },
  { tipo: 'tiempo', texto: 'en 15', espera: 15 },
  { tipo: 'tiempo', texto: 'no puedo', espera: 'rechaza' },
  { tipo: 'tiempo', texto: 'estoy muy lejos', espera: 'rechaza' },
  { tipo: 'tiempo', texto: 'que lo tome otro', espera: 'rechaza' },
  { tipo: 'tiempo', texto: 'hola', espera: null },
  // Entregado
  { tipo: 'entregado', texto: 'entregado', espera: 'entregado' },
  { tipo: 'entregado', texto: 'ya le entregué', espera: 'entregado' },
  { tipo: 'entregado', texto: 'lo dejé con el portero', espera: 'entregado' },
  { tipo: 'entregado', texto: 'recibido', espera: 'entregado' },
  { tipo: 'entregado', texto: 'no había nadie', espera: 'no_entregado' },
  { tipo: 'entregado', texto: 'no me abren', espera: 'no_entregado' },
  { tipo: 'entregado', texto: 'no pude entregarlo', espera: 'no_entregado' },
  { tipo: 'entregado', texto: 'voy en camino', espera: 'nada' },
];

export interface FalloExamen {
  tipo: CasoExamen['tipo'];
  texto: string;
  esperaba: string;
  leyo: string;
}

export interface ResultadoExamenLector {
  dia: string;
  cuando: string;
  total: number;
  aciertos: number;
  porcentaje: number;
  fallos: FalloExamen[];
  /** Si se aviso al supervisor por estar bajo el umbral. */
  avisado: boolean;
  /** 'manana' = la pasada automatica; 'mano' = "Examinar ahora". */
  origen: 'manana' | 'mano';
}

function enPalabras(v: unknown): string {
  if (v === null || v === undefined) return 'nada';
  if (typeof v === 'number') return `${v} min`;
  return String(v);
}

/** Corre el banco entero contra las reglas y cuenta. */
export function examinarLector(opts: { ahora: Date; timezone: string; origen: 'manana' | 'mano' }): Omit<ResultadoExamenLector, 'avisado'> {
  const fallos: FalloExamen[] = [];
  for (const caso of BANCO_EXAMEN) {
    if (caso.tipo === 'confirmacion') {
      const l = leerConfirmacionConReglas(caso.texto);
      if (l.decision !== caso.espera) fallos.push({ tipo: caso.tipo, texto: caso.texto, esperaba: caso.espera, leyo: l.decision });
    } else if (caso.tipo === 'tiempo') {
      const l = leerTiempoConReglas(caso.texto, { ahora: opts.ahora, timezone: opts.timezone });
      const leyo: number | 'rechaza' | null = l.rechaza ? 'rechaza' : l.minutos;
      if (leyo !== caso.espera) fallos.push({ tipo: caso.tipo, texto: caso.texto, esperaba: enPalabras(caso.espera), leyo: enPalabras(leyo) });
    } else {
      const l = leerEntregadoConReglas(caso.texto);
      const leyo: CasoEntregado['espera'] = l.entregado ? 'entregado' : l.noEntregado ? 'no_entregado' : 'nada';
      if (leyo !== caso.espera) fallos.push({ tipo: caso.tipo, texto: caso.texto, esperaba: caso.espera, leyo });
    }
  }
  const total = BANCO_EXAMEN.length;
  const aciertos = total - fallos.length;
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: opts.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(opts.ahora);
  return { dia, cuando: opts.ahora.toISOString(), total, aciertos, porcentaje: Math.round((100 * aciertos) / total), fallos, origen: opts.origen };
}

export async function leerExamenGuardado(settingsRepo: SettingsRepo): Promise<ResultadoExamenLector | null> {
  for (const row of await settingsRepo.getAll()) {
    if (row.key !== CLAVE_EXAMEN_LECTOR) continue;
    try {
      return JSON.parse(row.value) as ResultadoExamenLector;
    } catch {
      return null;
    }
  }
  return null;
}

export async function guardarExamen(settingsRepo: SettingsRepo, resultado: ResultadoExamenLector): Promise<void> {
  await settingsRepo.put(CLAVE_EXAMEN_LECTOR, JSON.stringify(resultado), false);
}

/** El texto que recibe el supervisor cuando el lector falla mas de la cuenta. */
export function avisoDeExamen(r: Pick<ResultadoExamenLector, 'porcentaje' | 'aciertos' | 'total' | 'fallos'>): string {
  const ejemplos = r.fallos
    .slice(0, 3)
    .map((f) => `«${f.texto}» (esperaba ${f.esperaba}, leyó ${f.leyo})`)
    .join('; ');
  return `El lector de respuestas de las entregas acierta hoy el ${r.porcentaje} % (${r.aciertos} de ${r.total}). Fallos: ${ejemplos}. Revisar en Asistente IA → Resultados → Examen del lector de reglas.`;
}

/** Como se resume en pantalla. */
export function examenEnPalabras(r: ResultadoExamenLector | null): string {
  if (!r) return 'Todavía no se ha examinado.';
  const base = `Acierta el ${r.porcentaje} % (${r.aciertos} de ${r.total})`;
  return r.fallos.length ? `${base}: ${r.fallos.length} fallo${r.fallos.length === 1 ? '' : 's'}.` : `${base}: sin fallos.`;
}
