/**
 * Lo que la IA (y las reglas) no entendieron.
 *
 * Cada vez que un cliente o un motorizado contesta algo que ni las reglas ni
 * la IA supieron leer, las entregas lo apuntan en su bitacora ("contestó
 * algo que no se entendió: …") y se le vuelve a preguntar. Aqui se recogen
 * esos casos —y lo que la IA si leyo, por si leyo mal— para que una persona
 * diga en un clic que era: un si, un no, N minutos, "entregado"… Lo que se
 * corrige queda en dos sitios:
 *
 *  - `entregas.frases` (settings): frases propias del negocio para el lector
 *    de respuestas, con esta forma:
 *      { si: string[], no: string[], duda: string[], entregado: string[],
 *        noEntregado: string[], minutos: Array<{ texto: string; minutos: number }> }
 *    El lector de src/entregas/interpretar.ts todavia no las lee: quedan
 *    guardadas para engancharlas (frase normalizada, sin tildes ni signos).
 *  - Entrenar a la IA, como una regla, si la persona lo marca.
 */

import type { EventoEntrega } from '../entregas/repo.js';
import type { SettingsRepo } from '../settings/service.js';

export const CLAVE_FRASES = 'entregas.frases';
export const CLAVE_REVISADOS = 'ia.noEntendidoRevisados';

export type QuienNoEntendido = 'cliente' | 'motorizado';
export type TemaNoEntendido = 'confirmacion' | 'segunda_visita' | 'tiempo' | 'entregado' | 'otro';
export type CorreccionNoEntendido = 'si' | 'no' | 'duda' | 'minutos' | 'entregado' | 'no_entregado' | 'ignorar';

export interface CasoNoEntendido {
  /** El id del evento de la bitacora: sirve para marcarlo revisado. */
  id: number;
  cuando: Date;
  quien: QuienNoEntendido;
  referencia: string;
  nombre: string | null;
  phone: string;
  /** Lo que escribio, tal cual. */
  texto: string;
  tema: TemaNoEntendido;
  /** Que hizo el sistema, en palabras. */
  loQueHizo: string;
  /** Lo leyo la IA (y puede haber leido mal) o nadie lo entendio. */
  leidoPorIA: boolean;
}

export interface FrasesPropias {
  si: string[];
  no: string[];
  duda: string[];
  entregado: string[];
  noEntregado: string[];
  minutos: Array<{ texto: string; minutos: number }>;
}

export const FRASES_VACIAS: FrasesPropias = { si: [], no: [], duda: [], entregado: [], noEntregado: [], minutos: [] };

/** Sin tildes ni eñes, sin signos, en minusculas: como normaliza el lector (ñ → n). */
export function normalizarFrase(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ENTRE_COMILLAS = /"([^"]*)"/;

/** Saca los casos de la bitacora de las entregas (los mas nuevos primero). */
export function extraerCasos(eventos: Array<EventoEntrega & { referencia: string; phone: string; nombre: string | null }>, desde: Date): CasoNoEntendido[] {
  const casos: CasoNoEntendido[] = [];
  for (const ev of eventos) {
    if (ev.createdAt < desde) continue;
    const detalle = ev.detalle ?? '';
    const base = { id: ev.id, cuando: ev.createdAt, referencia: ev.referencia, nombre: ev.nombre, phone: ev.phone };
    if (ev.tipo === 'nota') {
      const m = ENTRE_COMILLAS.exec(detalle);
      if (!m) continue;
      if (/^contestó algo que no se entendió/.test(detalle)) {
        const segunda = /segunda visita/.test(detalle);
        casos.push({ ...base, quien: 'cliente', texto: m[1]!, tema: segunda ? 'segunda_visita' : 'confirmacion', loQueHizo: 'se le preguntó otra vez', leidoPorIA: false });
      } else if (/contestó sin un tiempo claro|contestó varias veces sin un tiempo/.test(detalle)) {
        casos.push({ ...base, quien: 'motorizado', texto: m[1]!, tema: 'tiempo', loQueHizo: /varias veces/.test(detalle) ? 'el pedido pasó a otro motorizado' : 'se le preguntó otra vez', leidoPorIA: false });
      }
      continue;
    }
    if (ev.tipo === 'ia') {
      const texto = typeof ev.payload?.texto === 'string' ? ev.payload.texto : '';
      if (!texto.trim()) continue;
      const alMotorizado = /leyó al motorizado/.test(detalle);
      const segunda = /segunda visita/.test(detalle);
      const tema: TemaNoEntendido = alMotorizado ? (/entregado|no pudo entregar|está cerca/.test(detalle) ? 'entregado' : 'tiempo') : segunda ? 'segunda_visita' : 'confirmacion';
      const decidio = detalle.replace(/^la IA leyó (la respuesta( a la segunda visita)?|al motorizado): /, '');
      casos.push({ ...base, quien: alMotorizado ? 'motorizado' : 'cliente', texto, tema, loQueHizo: `la IA lo leyó como «${decidio}»`, leidoPorIA: true });
    }
  }
  return casos;
}

/** Las frases guardadas, o vacias. */
export async function leerFrases(settingsRepo: SettingsRepo): Promise<FrasesPropias> {
  for (const row of await settingsRepo.getAll()) {
    if (row.key !== CLAVE_FRASES) continue;
    try {
      const j = JSON.parse(row.value) as Partial<FrasesPropias>;
      return {
        si: Array.isArray(j.si) ? j.si : [],
        no: Array.isArray(j.no) ? j.no : [],
        duda: Array.isArray(j.duda) ? j.duda : [],
        entregado: Array.isArray(j.entregado) ? j.entregado : [],
        noEntregado: Array.isArray(j.noEntregado) ? j.noEntregado : [],
        minutos: Array.isArray(j.minutos) ? j.minutos.filter((x) => x && typeof x.texto === 'string' && typeof x.minutos === 'number') : [],
      };
    } catch {
      return { ...FRASES_VACIAS };
    }
  }
  return { ...FRASES_VACIAS };
}

/** Añade una frase a la lista que toca (sin repetir) y la guarda. */
export async function apuntarFrase(settingsRepo: SettingsRepo, texto: string, era: CorreccionNoEntendido, minutos?: number | null): Promise<FrasesPropias> {
  const frases = await leerFrases(settingsRepo);
  const frase = normalizarFrase(texto);
  if (!frase || era === 'ignorar') return frases;
  const sin = (lista: string[]) => lista.filter((x) => x !== frase);
  frases.si = sin(frases.si);
  frases.no = sin(frases.no);
  frases.duda = sin(frases.duda);
  frases.entregado = sin(frases.entregado);
  frases.noEntregado = sin(frases.noEntregado);
  frases.minutos = frases.minutos.filter((x) => x.texto !== frase);
  if (era === 'si') frases.si.push(frase);
  else if (era === 'no') frases.no.push(frase);
  else if (era === 'duda') frases.duda.push(frase);
  else if (era === 'entregado') frases.entregado.push(frase);
  else if (era === 'no_entregado') frases.noEntregado.push(frase);
  else if (era === 'minutos' && minutos != null && minutos > 0) frases.minutos.push({ texto: frase, minutos: Math.round(minutos) });
  await settingsRepo.put(CLAVE_FRASES, JSON.stringify(frases), false);
  return frases;
}

/** Los ids ya revisados (los ultimos 500). */
export async function leerRevisados(settingsRepo: SettingsRepo): Promise<number[]> {
  for (const row of await settingsRepo.getAll()) {
    if (row.key !== CLAVE_REVISADOS) continue;
    try {
      const j = JSON.parse(row.value) as unknown;
      return Array.isArray(j) ? j.filter((x): x is number => typeof x === 'number') : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function marcarRevisado(settingsRepo: SettingsRepo, id: number): Promise<void> {
  const lista = await leerRevisados(settingsRepo);
  if (!lista.includes(id)) lista.push(id);
  await settingsRepo.put(CLAVE_REVISADOS, JSON.stringify(lista.slice(-500)), false);
}

/** Lo que se le enseña a la IA cuando la persona marca "Enseñar como lección". */
export function textoDeLeccion(caso: Pick<CasoNoEntendido, 'quien' | 'texto' | 'tema'>, era: CorreccionNoEntendido, minutos?: number | null): string | null {
  const quien = caso.quien === 'motorizado' ? 'un motorizado' : 'un cliente';
  const frase = caso.texto.trim();
  switch (era) {
    case 'si':
      return `Cuando ${quien} contesta «${frase}» a la pregunta de si recibe hoy su pedido, es un SÍ: confirma la entrega.`;
    case 'no':
      return `Cuando ${quien} contesta «${frase}» a la pregunta de si recibe hoy su pedido, es un NO: no quiere el pedido hoy.`;
    case 'duda':
      return `Cuando ${quien} contesta «${frase}», no está decidiendo todavía: hay que volver a preguntar con las opciones (sí / no / otro día).`;
    case 'minutos':
      return minutos != null ? `Cuando ${quien} escribe «${frase}» al preguntarle en cuántos minutos entrega, quiere decir ${Math.round(minutos)} minutos.` : null;
    case 'entregado':
      return `Cuando ${quien} escribe «${frase}» sobre un pedido que lleva, quiere decir que YA lo entregó.`;
    case 'no_entregado':
      return `Cuando ${quien} escribe «${frase}» sobre un pedido que lleva, quiere decir que NO pudo entregarlo (no había nadie, no abrieron).`;
    default:
      return null;
  }
}

/** Como se dice cada tema en pantalla. */
export const TEMAS_EN_PALABRAS: Record<TemaNoEntendido, string> = {
  confirmacion: 'a la pregunta de si recibe hoy',
  segunda_visita: 'a la pregunta de si volvemos hoy',
  tiempo: 'al preguntarle en cuántos minutos entrega',
  entregado: 'sobre un pedido que lleva',
  otro: '',
};
