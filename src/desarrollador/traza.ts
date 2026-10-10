/**
 * La traza de un turno, en palabras: que llego, que entendio el sistema (y
 * con que seguridad), que decidio, que estado cambio, que contesto, que se
 * encolo para GSG (y si salio al simulador) y que webhook salio.
 *
 * No se inventa nada: se hace una foto de lo que hay en la base de ESTA tienda
 * antes del mensaje y otra despues, y se cuenta la diferencia (mensajes,
 * eventos de entregas y del reparto, estados, reportes a GSG, webhooks). La
 * interpretacion la cuentan los propios eventos del sistema ("confirmó
 * (reglas: …)", "la IA leyó …"); ademas se enseña lo que lee el lector de
 * reglas por su cuenta y si el escudo ve un intento de manipulacion, que son
 * funciones puras y no cambian nada.
 */

import type { DesarrolladorRepo } from '../db/desarrollador.js';
import { leerConfirmacionConReglas, leerEntregadoConReglas, leerPreguntaPorPedido, leerTiempoConReglas } from '../entregas/interpretar.js';
import { detectarManipulacion } from '../ia/seguridad.js';
import { clasificarConfirmarGsg, clasificarReglaGsg, INSISTENCIAS_UBICACION } from '../ia/agente-operativo.js';
import type { EntranteDePrueba } from './simular.js';

export type Tono = 'ok' | 'info' | 'warn' | 'bad' | 'muted';

export interface PasoTraza {
  tono: Tono;
  /** El paso en una frase. */
  titulo: string;
  detalle?: string;
}

export interface Traza {
  telefono: string;
  cuando: string;
  quien: 'cliente' | 'motorizado';
  entrada: string;
  pasos: PasoTraza[];
  /** Para el plegable «Ver lo técnico». */
  tecnico: Record<string, unknown>;
}

interface FilaEntregaCorta {
  id: number;
  referencia: string;
  estado: string;
  ubicacion_estado: string;
  confirmacion_estado: string;
  motorizado_estado: string;
}

interface FilaSolicitudCorta {
  id: number;
  referencia: string | null;
  estado: string;
  intentos: number;
}

interface Foto {
  contactoId: string | null;
  maxMensaje: number;
  maxEventoEntrega: number;
  maxEventoRuta: number;
  maxReporte: number;
  maxWebhook: number;
  entregas: FilaEntregaCorta[];
  solicitudes: FilaSolicitudCorta[];
}

export const ESTADO_ENTREGA: Record<string, string> = {
  pendiente: 'pendiente',
  esperando_ubicacion: 'esperando su ubicación',
  esperando_confirmacion: 'esperando que confirme',
  lista: 'lista para el motorizado',
  esperando_motorizado: 'esperando al motorizado',
  avisada: 'avisada (el cliente ya sabe la hora)',
  entregada: 'entregada',
  terminada: 'terminada',
  cancelada: 'cancelada',
  incidencia: 'necesita a una persona',
};

export const ESTADO_SOLICITUD: Record<string, string> = {
  pendiente: 'todavía no se le escribió',
  enviado: 'se le pidió la ubicación',
  respondio: 'contestó, pero sin ubicación',
  resuelto: 'ubicación recibida',
  supervision: 'lo revisa una persona',
  derivado: 'pasó al repartidor (no dio la ubicación)',
  incidencia: 'con un problema',
  cancelado: 'cancelado',
};

const QUE_REPORTE: Record<string, string> = {
  ubicacion: 'la ubicación',
  confirmacion: 'la confirmación',
  entrega: 'la entrega',
  incidencia: 'una incidencia',
  resumen: 'el resumen del lote',
};

const esEntrega = (e: string) => ESTADO_ENTREGA[e] ?? e;
const esSolicitud = (e: string) => ESTADO_SOLICITUD[e] ?? e;

async function uno<T>(db: DesarrolladorRepo, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await db.query<T>(sql, params)).rows[0];
}

async function maxId(db: DesarrolladorRepo, tabla: string): Promise<number> {
  const r = await uno<{ m: number | string | null }>(db, `select coalesce(max(id), 0) as m from ${tabla}`);
  return Number(r?.m ?? 0);
}

export async function fotoDe(db: DesarrolladorRepo, telefono: string, quien: 'cliente' | 'motorizado'): Promise<Foto> {
  const contacto = await uno<{ id: string }>(db, 'select id from contacts where phone = $1', [telefono]);
  const entregas =
    quien === 'motorizado'
      ? (await db.query<FilaEntregaCorta>('select e.id, e.referencia, e.estado, e.ubicacion_estado, e.confirmacion_estado, e.motorizado_estado from entregas e join motorizados m on m.id = e.motorizado_id where m.phone = $1 order by e.id desc limit 30', [telefono])).rows
      : (await db.query<FilaEntregaCorta>('select id, referencia, estado, ubicacion_estado, confirmacion_estado, motorizado_estado from entregas where phone = $1 order by id desc limit 30', [telefono])).rows;
  const solicitudes = (await db.query<FilaSolicitudCorta>('select id, referencia, estado, intentos from rutas_solicitudes where phone = $1 order by id desc limit 30', [telefono])).rows;
  return {
    contactoId: contacto?.id ?? null,
    maxMensaje: await maxId(db, 'messages'),
    maxEventoEntrega: await maxId(db, 'entregas_eventos'),
    maxEventoRuta: await maxId(db, 'rutas_eventos'),
    maxReporte: await maxId(db, 'rutas_reportes'),
    maxWebhook: await maxId(db, 'webhook_entregas'),
    entregas: entregas.map((e) => ({ ...e, id: Number(e.id) })),
    solicitudes: solicitudes.map((s) => ({ ...s, id: Number(s.id), intentos: Number(s.intentos) })),
  };
}

/** Como se dice lo que se mando. */
export function entradaEnPalabras(e: EntranteDePrueba): string {
  if (e.location) return `📍 Mandó su ubicación (pin en ${e.location.latitude.toFixed(4)}, ${e.location.longitude.toFixed(4)})`;
  if (e.adjunto === 'audio') return `🎤 Mandó un audio${e.transcripcion ? `: «${e.transcripcion}»` : ''}`;
  if (e.adjunto === 'image') return '📷 Mandó una foto';
  if (e.adjunto) return `📎 Mandó un ${e.adjunto}`;
  if (e.boton) return `🔘 Pulsó el botón «${e.boton.title || e.boton.id}»`;
  return `💬 Escribió: «${(e.text ?? '').slice(0, 300)}»`;
}

/** La regla del dueño en «Solo lo de GSG», tal como se aplica al cliente (lo que la traza cuenta). */
export interface ReglaEnTraza {
  /** La regla está activa (modo «Solo lo de GSG» + el ajuste encendido). */
  activa: boolean;
  /** Ese cliente ya recibió UBI REGISTRADA o el cierre ANTES de este mensaje. */
  enSilencio: boolean;
  /** Lo último que recibió fue el agradecimiento (UBI REGISTRADA o «queda confirmado»), todavía sin el cierre. */
  trasGracias?: boolean;
  /** Es de «falta confirmar» y ya se le preguntó SÍ/NO (GSG ya tiene su dirección). */
  confirmar?: boolean;
  /** Todavía se espera su ubicación (se le pidió y no la mandó). */
  esperaUbicacion?: boolean;
  /** Cuántas de las 3 insistencias fijas ya recibió por este pedido ANTES de este mensaje. */
  insistencias?: number;
}

/** Cómo decide: la IA primero (solo clasifica), las reglas de respaldo. */
const IA_PRIMERO = 'Con clave de IA, la IA clasifica primero (por qué / la hora / SÍ / NO / otra cosa) y las reglas quedan de respaldo si falla o se acaba el saldo; nunca redacta nada.';

/** Qué hace la regla del dueño con lo que mandó el cliente (funcion pura: no cambia nada). */
function lecturaDeLaRegla(e: EntranteDePrueba, regla: ReglaEnTraza): PasoTraza {
  const texto = (e.text ?? e.transcripcion ?? e.boton?.title ?? '').trim();
  const esUbicacion = Boolean(e.location) || /https?:\/\/\S*(maps|goo\.gl)/i.test(texto);
  const pideHora = !esUbicacion && Boolean(texto) && leerPreguntaPorPedido(texto).pregunta && !(regla.confirmar && clasificarConfirmarGsg(texto, e.boton?.id) === 'si');
  if (pideHora && (!regla.enSilencio || regla.trasGracias)) {
    return { tono: 'info', titulo: 'Regla del dueño: pregunta por su pedido o la hora → SIEMPRE la hora estimada (texto fijo), sin gastar el cierre', detalle: `${IA_PRIMERO} Sin IA lo reconocen las reglas, aunque venga con faltas de tipeo o insultos.` };
  }
  if (regla.enSilencio && regla.trasGracias && !esUbicacion) {
    return { tono: 'info', titulo: 'Regla del dueño: ya recibió el agradecimiento y ahora pregunta otra cosa (no la hora) → el cierre UNA vez con el número del motorizado asignado, pasa a una persona y desde ahí silencio', detalle: 'Sin motorizado asignado todavía, va el número que mandó GSG o el de soporte.' };
  }
  if (regla.enSilencio) return { tono: 'muted', titulo: 'Regla del dueño: ya recibió el cierre (o el agradecimiento, si esto es su ubicación) → silencio, no se le contesta', detalle: esUbicacion ? 'Su ubicación igual se registra por dentro (y GSG se entera), pero no se le escribe nada.' : 'Lo que escriba queda en el chat para que lo vea una persona.' };
  if (esUbicacion) return { tono: 'info', titulo: 'Regla del dueño: es su ubicación → UBI REGISTRADA con «¡Muchas gracias!» (sin el cierre); si después pregunta algo, el cierre UNA vez con el número del motorizado' };
  if (regla.confirmar) {
    const c = texto || e.boton?.id ? clasificarConfirmarGsg(texto, e.boton?.id) : 'otra';
    if (c === 'si') return { tono: 'info', titulo: 'Regla del dueño («falta confirmar»): dice SÍ → «queda confirmado. ¡Muchas gracias!» (sin el cierre) y GSG se entera; si después pregunta algo, el cierre UNA vez con el número del motorizado' };
    if (c === 'no' || c === 'cambio') return { tono: 'info', titulo: 'Regla del dueño («falta confirmar»): dice NO (u otro día / otra dirección) → el cierre corto, pasa a una persona, GSG se entera y silencio' };
    if (c === 'por_que') return { tono: 'info', titulo: 'Regla del dueño («falta confirmar»): pregunta por qué → la explicación fija y otra vez SÍ o NO' };
    return { tono: 'info', titulo: 'Regla del dueño («falta confirmar»): es otra cosa → el cierre UNA vez con el número y pasa a una persona', detalle: c === null ? IA_PRIMERO : 'Lo decidieron las reglas, sin IA.' };
  }
  const clase = texto ? clasificarReglaGsg(texto) : 'otra';
  if (clase === 'por_que') return { tono: 'info', titulo: 'Regla del dueño: pregunta por qué se le pide la ubicación → la explicación fija y se le vuelve a pedir', detalle: 'No cuenta como insistencia.' };
  const total = INSISTENCIAS_UBICACION.length;
  const hechas = regla.insistencias ?? 0;
  if (regla.esperaUbicacion && hechas < total) {
    return {
      tono: 'info',
      titulo: `Regla del dueño: es otra cosa sin mandar la ubicación → insistencia ${hechas + 1} de ${total}: se le vuelve a pedir la ubicación (texto fijo, con el botón)`,
      detalle: `${hechas + 1 < total ? `Le quedan ${total - hechas - 1} antes del cierre. ` : 'Es la última: lo siguiente que no sea su ubicación recibe el cierre. '}${clase === null ? IA_PRIMERO : 'Lo decidieron las reglas, sin IA.'}`,
    };
  }
  return {
    tono: 'info',
    titulo: regla.esperaUbicacion ? `Regla del dueño: otra cosa y ya recibió las ${total} insistencias → el cierre UNA vez con el número y pasa a una persona` : 'Regla del dueño: es otra cosa → el cierre UNA vez con el número y pasa a una persona',
    detalle: clase === null ? IA_PRIMERO : 'Lo decidieron las reglas, sin IA.',
  };
}

/** Lo que leen las reglas por su cuenta (funciones puras: no cambian nada). */
function lecturas(e: EntranteDePrueba, quien: 'cliente' | 'motorizado', regla?: ReglaEnTraza): PasoTraza[] {
  const texto = e.text ?? e.transcripcion ?? '';
  const pasos: PasoTraza[] = [];
  if (quien === 'cliente' && regla?.activa) {
    const manip = texto.trim() ? detectarManipulacion(texto) : null;
    if (manip) pasos.push({ tono: 'warn', titulo: `El escudo ve un intento de manipulación (${manip.tipo.replace(/_/g, ' ')})`, detalle: 'No se obedece: se contesta con el texto fijo y no se toca ningún pedido.' });
    pasos.push(lecturaDeLaRegla(e, regla));
    return pasos;
  }
  if (!texto.trim()) return pasos;
  const manip = detectarManipulacion(texto);
  if (manip) pasos.push({ tono: 'warn', titulo: `El escudo ve un intento de manipulación (${manip.tipo.replace(/_/g, ' ')})`, detalle: 'No se obedece: se contesta con el texto fijo y no se toca ningún pedido.' });
  if (quien === 'cliente') {
    const l = leerConfirmacionConReglas(texto);
    const que = l.decision === 'si' ? 'que SÍ confirma' : l.decision === 'no' ? 'que NO lo quiere' : l.decision === 'cambio' ? 'que quiere cambiar algo (otro día u otra dirección)' : 'nada claro (no es un sí ni un no)';
    pasos.push({
      tono: l.decision === 'no_claro' ? 'muted' : 'info',
      titulo: `El lector de reglas entiende ${que}`,
      detalle: l.frase ? `Seguridad alta: coincide con la frase «${l.frase}».` : l.decision === 'no_claro' ? 'Seguridad baja: si hay IA conectada, se le pregunta a ella; si no, se le vuelve a preguntar al cliente.' : l.detalle,
    });
  } else {
    const t = leerTiempoConReglas(texto);
    const d = leerEntregadoConReglas(texto);
    if (d.entregado || d.flojo) pasos.push({ tono: 'info', titulo: `El lector de reglas entiende que ya ENTREGÓ${d.flojo ? ' (un «listo» a secas: vale si no tiene otro pedido esperando su tiempo)' : ''}` });
    else if (d.noEntregado) pasos.push({ tono: 'info', titulo: 'El lector de reglas entiende que NO pudo entregar', detalle: d.detalle });
    else if (t.minutos != null) pasos.push({ tono: 'info', titulo: `El lector de reglas entiende ${t.minutos} minutos para entregar` });
    else if (t.rechaza) pasos.push({ tono: 'info', titulo: 'El lector de reglas entiende que no puede llevarlo' });
    else pasos.push({ tono: 'muted', titulo: 'El lector de reglas no ve ni un tiempo ni un «entregado»' });
  }
  return pasos;
}

/** Espera (poco) a que lo que se encolo para GSG salga o falle, para contarlo ya. */
async function esperarReportes(db: DesarrolladorRepo, desde: number, ms = 2500): Promise<void> {
  const hasta = Date.now() + ms;
  while (Date.now() < hasta) {
    const r = await uno<{ n: number | string }>(db, "select count(*) as n from rutas_reportes where id > $1 and tipo = 'ubicacion' and estado = 'pendiente'", [desde]);
    if (Number(r?.n ?? 0) === 0) return;
    await new Promise((res) => setTimeout(res, 150));
  }
}

export async function trazaDe(db: DesarrolladorRepo, telefono: string, quien: 'cliente' | 'motorizado', entrada: EntranteDePrueba, antes: Foto, gsgConectado: boolean, regla?: ReglaEnTraza): Promise<Traza> {
  await esperarReportes(db, antes.maxReporte);
  const despues = await fotoDe(db, telefono, quien);
  const leidas = lecturas(entrada, quien, regla);
  const pasos: PasoTraza[] = [{ tono: 'info', titulo: entradaEnPalabras(entrada) }, ...leidas];

  const idsEntregas = [...new Set([...antes.entregas, ...despues.entregas].map((e) => e.id))];
  const idsSolicitudes = [...new Set([...antes.solicitudes, ...despues.solicitudes].map((s) => s.id))];
  const referencias = [...new Set([...despues.entregas.map((e) => e.referencia), ...despues.solicitudes.map((s) => s.referencia ?? '')].filter(Boolean))];

  // Lo que el reparto y las entregas apuntaron (ahi va lo que decidieron y como leyeron).
  const evRutas = idsSolicitudes.length
    ? (await db.query<{ tipo: string; detalle: string | null }>(`select tipo, detalle from rutas_eventos where id > $1 and solicitud_id = any($2::bigint[]) order by id`, [antes.maxEventoRuta, idsSolicitudes])).rows
    : [];
  for (const ev of evRutas) pasos.push({ tono: 'info', titulo: `Reparto: ${ev.detalle || ev.tipo.replace(/_/g, ' ')}` });
  const evEntregas = idsEntregas.length
    ? (await db.query<{ tipo: string; detalle: string | null; referencia: string }>(`select v.tipo, v.detalle, e.referencia from entregas_eventos v join entregas e on e.id = v.entrega_id where v.id > $1 and v.entrega_id = any($2::bigint[]) order by v.id`, [antes.maxEventoEntrega, idsEntregas])).rows
    : [];
  for (const ev of evEntregas) {
    const tono: Tono = ev.tipo === 'incidencia' || ev.tipo === 'rechazada' ? 'warn' : ev.tipo === 'ia' ? 'info' : 'ok';
    pasos.push({ tono, titulo: `${ev.tipo === 'ia' ? 'IA' : 'Decidió'} (${ev.referencia}): ${ev.detalle || ev.tipo.replace(/_/g, ' ')}` });
  }

  // Estados que cambiaron.
  for (const d of despues.entregas) {
    const a = antes.entregas.find((x) => x.id === d.id);
    if (!a) pasos.push({ tono: 'ok', titulo: `Nuevo pedido ${d.referencia}: ${esEntrega(d.estado)}` });
    else if (a.estado !== d.estado) pasos.push({ tono: d.estado === 'incidencia' || d.estado === 'cancelada' ? 'warn' : 'ok', titulo: `El pedido ${d.referencia} pasó de «${esEntrega(a.estado)}» a «${esEntrega(d.estado)}»` });
  }
  for (const d of despues.solicitudes) {
    const a = antes.solicitudes.find((x) => x.id === d.id);
    if (a && a.estado !== d.estado) pasos.push({ tono: d.estado === 'resuelto' ? 'ok' : 'info', titulo: `Reparto ${d.referencia ?? ''}: de «${esSolicitud(a.estado)}» a «${esSolicitud(d.estado)}»` });
  }

  // Lo que contesto el sistema (a este numero).
  const contacto = despues.contactoId;
  const salientes = contacto
    ? (await db.query<{ body: string | null; kind: string; payload: Record<string, unknown> | null }>(`select body, kind, payload from messages where id > $1 and contact_id = $2 and direction = 'out' order by id`, [antes.maxMensaje, contacto])).rows
    : [];
  for (const m of salientes) {
    const origen = (m.payload as { origen?: string } | null)?.origen;
    const quienEscribe = origen !== 'ia' ? '' : regla?.activa ? ' (texto fijo: la IA solo clasificó)' : ' (con la IA)';
    pasos.push({ tono: 'ok', titulo: `Contestó${quienEscribe}: «${(m.body ?? `(${m.kind})`).slice(0, 400)}»`, detalle: 'Número de prueba: no salió al WhatsApp real, quedó en el hilo como enviado.' });
  }
  // Lo que se le mando a OTROS numeros por este turno (el motorizado, el cliente del motorizado, el supervisor).
  const aOtros = contacto
    ? (await db.query<{ body: string | null; phone: string }>(`select m.body, c.phone from messages m join contacts c on c.id = m.contact_id where m.id > $1 and m.contact_id <> $2 and m.direction = 'out' order by m.id limit 20`, [antes.maxMensaje, contacto])).rows
    : [];
  for (const m of aOtros) pasos.push({ tono: 'info', titulo: `Le escribió al ${m.phone}: «${(m.body ?? '').slice(0, 200)}»` });

  // Lo que se encolo para GSG por esto.
  const reportes = (
    await db.query<{ id: number; tipo: string; estado: string; ultimo_error: string | null; externo_id: string | null; payload: Record<string, unknown> }>(
      `select id, tipo, estado, ultimo_error, externo_id, payload from rutas_reportes where id > $1 order by id`,
      [antes.maxReporte],
    )
  ).rows.filter((r) => r.payload?.telefono === telefono || referencias.includes(String(r.payload?.referencia ?? '')));
  for (const r of reportes) {
    const que = `${QUE_REPORTE[r.tipo] ?? r.tipo}${r.payload?.referencia ? ` de ${r.payload.referencia}` : ''}`;
    if (r.estado === 'enviado') pasos.push({ tono: 'ok', titulo: `A GSG: ${que} — ya salió${r.externo_id ? ` (GSG la apuntó como ${r.externo_id})` : ''}` });
    else if (r.estado === 'fallido') pasos.push({ tono: 'bad', titulo: `A GSG: ${que} — GSG la rechazó`, detalle: r.ultimo_error ?? undefined });
    else pasos.push({ tono: 'warn', titulo: `A GSG: ${que} — en la cola`, detalle: gsgConectado ? (r.tipo === 'ubicacion' ? 'Sale al momento; si GSG no contestó, se reintenta cada minuto.' : 'Sale en la próxima pasada (cada minuto) o con «Mandar ya lo que espera».') : 'GSG no está conectado: se queda guardado y sale entero cuando se conecte.' });
  }

  // Webhooks que salieron por esto.
  const webhooks = (
    await db.query<{ evento: string; estado: string; payload: unknown }>(`select evento, estado, payload from webhook_entregas where id > $1 order by id limit 50`, [antes.maxWebhook])
  ).rows.filter((w) => {
    const t = JSON.stringify(w.payload ?? '');
    return t.includes(telefono) || referencias.some((ref) => t.includes(ref));
  });
  for (const w of webhooks) pasos.push({ tono: 'info', titulo: `Webhook «${w.evento}»: ${w.estado === 'enviada' || w.estado === 'ok' ? 'entregado' : w.estado === 'pendiente' ? 'en camino' : w.estado}` });

  if (quien === 'cliente' && regla?.activa && !salientes.length) {
    pasos.push({ tono: 'muted', titulo: 'Silencio: al cliente no se le escribió nada', detalle: 'Regla del dueño: después del cierre (el que sale una sola vez) el sistema ya no le escribe por este pedido. Lo del motorizado sigue igual por dentro.' });
  } else if (pasos.length <= 1 + leidas.length) {
    pasos.push({ tono: 'muted', titulo: 'No cambió nada: ningún pedido se movió y el sistema no contestó.', detalle: 'Pasa, por ejemplo, con un sticker, con algo fuera del flujo o si el número no tiene pedido de hoy.' });
  }

  return {
    telefono,
    cuando: new Date().toISOString(),
    quien,
    entrada: entradaEnPalabras(entrada),
    pasos,
    tecnico: { entrada, antes, despues, reportes, webhooks: webhooks.map((w) => ({ evento: w.evento, estado: w.estado })) },
  };
}
