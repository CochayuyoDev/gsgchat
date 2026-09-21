/**
 * El cupo del dia, contado por adelantado.
 *
 * El numero tiene un cupo de mensajes iniciados por la empresa (el warm-up
 * de `src/outbound/throttle.ts`, que el monitor de salud ensena como
 * `ritmo.cupoHoy`). Lo que faltaba era la otra mitad de la cuenta: cuantos
 * mensajes van a NECESITAR los pedidos que ya estan cargados. Si no alcanza,
 * mejor saberlo a las nueve de la manana que descubrirlo a las cuatro con
 * los ultimos veinte clientes sin avisar.
 *
 * La estimacion es por entrega viva y por lo que le falta:
 *   - ubicacion pendiente: 1 mensaje + las insistencias del reparto;
 *   - confirmacion pendiente: 1 + los reintentos de la pregunta;
 *   - motorizado por asignar: 2 (el pin y la pregunta) + el aviso al cliente;
 *   - avisada: el "gracias" al entregar, si esta encendido;
 * mas lo que la lista de envio automatico puede llegar a mandar hoy.
 */

import type { Monitor } from './monitor.js';

export interface DepsCupo {
  salud: Monitor;
  entregas?: {
    resumen(): Promise<{
      ajustes: { confirmacionMaxIntentos: number; motorizadoMaxIntentos: number; avisarEntregado: boolean };
      entregas: Array<{ estado: string; ubicacionEstado: string; confirmacionEstado: string; motorizadoEstado: string; confirmacionIntentos: number; motorizadoIntentos: number }>;
    }>;
  } | null;
  /** La lista de envio automatico: lo que puede llegar a salir hoy por ella. */
  lista?: { resumen(): Promise<{ cifras: { hoyComoMucho: number; hoyEnviados: number } }> } | null;
  /** Insistencias del reparto al pedir la ubicacion (maxIntentos), tal como estan en la pantalla. */
  reparto?: () => { maxIntentos: number } | Promise<{ maxIntentos: number }>;
  ahora: () => Date;
}

export interface ConceptoCupo {
  concepto: string;
  cantidad: number;
}

export interface CupoPrevisto {
  cupoHoy: number;
  usadosHoy: number;
  puedenSalir: number;
  necesitan: number;
  alcanza: boolean;
  /** Cuanto sobra (o falta, en negativo). */
  margen: number;
  detalle: ConceptoCupo[];
  queRecortar: string[];
  frase: string;
  at: string;
}

const VIVAS_SIN_TERMINAR = new Set(['pendiente', 'esperando_ubicacion', 'esperando_confirmacion', 'lista', 'esperando_motorizado', 'avisada']);

export async function cupoPrevisto(deps: DepsCupo): Promise<CupoPrevisto> {
  const foto = await deps.salud.snapshot();
  const cupoHoy = Math.max(0, foto.ritmo.cupoHoy);
  const usadosHoy = Math.max(0, foto.ritmo.hoy);
  const puedenSalir = Math.max(0, cupoHoy - usadosHoy);
  const detalle: ConceptoCupo[] = [];
  const queRecortar: string[] = [];

  const insistencias = Math.max(0, ((await deps.reparto?.())?.maxIntentos ?? 3) - 1);

  if (deps.entregas) {
    const r = await deps.entregas.resumen();
    const vivas = r.entregas.filter((e) => VIVAS_SIN_TERMINAR.has(e.estado));
    let ubicacion = 0;
    let confirmacion = 0;
    let motorizado = 0;
    let avisos = 0;
    let gracias = 0;
    for (const e of vivas) {
      if (e.ubicacionEstado === 'pendiente') ubicacion += 1 + insistencias;
      if (e.confirmacionEstado === 'pendiente') confirmacion += 1 + Math.max(0, r.ajustes.confirmacionMaxIntentos - 1);
      else if (e.confirmacionEstado === 'pedida') confirmacion += Math.max(0, r.ajustes.confirmacionMaxIntentos - e.confirmacionIntentos);
      if (e.motorizadoEstado === 'sin_asignar' || e.motorizadoEstado === 'sin_respuesta') motorizado += 2 + Math.max(0, r.ajustes.motorizadoMaxIntentos - 1);
      else if (e.motorizadoEstado === 'enviado') motorizado += Math.max(0, r.ajustes.motorizadoMaxIntentos - e.motorizadoIntentos);
      if (e.estado !== 'avisada') avisos += 1;
      if (r.ajustes.avisarEntregado) gracias += 1;
    }
    if (ubicacion) detalle.push({ concepto: `Pedir la ubicación (con ${insistencias} ${insistencias === 1 ? 'insistencia' : 'insistencias'})`, cantidad: ubicacion });
    if (confirmacion) detalle.push({ concepto: 'Preguntar si reciben hoy (con sus repreguntas)', cantidad: confirmacion });
    if (motorizado) detalle.push({ concepto: 'Mandar el pin al motorizado y preguntarle la hora', cantidad: motorizado });
    if (avisos) detalle.push({ concepto: 'Avisar al cliente la hora de llegada', cantidad: avisos });
    if (gracias) detalle.push({ concepto: 'Dar las gracias al entregar', cantidad: gracias });
    if (insistencias > 1) queRecortar.push(`Bajar las insistencias del reparto (ahora ${insistencias}): en Hoy → Ajustes de las entregas.`);
    if (r.ajustes.confirmacionMaxIntentos > 2) queRecortar.push(`Repreguntar menos veces la confirmación (ahora ${r.ajustes.confirmacionMaxIntentos}).`);
    if (r.ajustes.avisarEntregado && gracias) queRecortar.push(`Apagar el "gracias" al entregar (ahorra ${gracias}).`);
  }

  if (deps.lista) {
    const l = await deps.lista.resumen();
    const pendiente = Math.max(0, l.cifras.hoyComoMucho - l.cifras.hoyEnviados);
    if (pendiente) {
      detalle.push({ concepto: 'Otros clientes a los que se les escribe solo (envío automático)', cantidad: pendiente });
      queRecortar.push('Pausar los otros clientes del envío automático hasta mañana (en Hoy).');
    }
  }

  const necesitan = detalle.reduce((s, c) => s + c.cantidad, 0);
  const margen = puedenSalir - necesitan;
  const alcanza = margen >= 0;
  if (!alcanza) queRecortar.push('Si el número ya lleva semanas escribiendo, subir el cupo en Riesgo y ritmo (con "Todo el sistema").');

  const frase = !cupoHoy
    ? 'Todavía no se sabe el cupo de hoy: el número no ha mandado nada o no está conectado.'
    : alcanza
      ? `Hoy pueden salir ${puedenSalir} mensajes más; los pedidos cargados necesitan unos ${necesitan}. Alcanza${margen > 0 ? ` y sobran ${margen}` : ' justo'}.`
      : `Hoy pueden salir ${puedenSalir} mensajes más, pero los pedidos cargados necesitan unos ${necesitan}: faltan ${-margen}.`;

  return { cupoHoy, usadosHoy, puedenSalir, necesitan, alcanza, margen, detalle, queRecortar: alcanza ? [] : queRecortar, frase, at: deps.ahora().toISOString() };
}
