/**
 * «Ver qué pasó con este pedido»: la historia de una solicitud del reparto,
 * contada en palabras, con un diagnóstico arriba que dice qué pasó y por qué.
 *
 * El caso que lo motivó (11/11): un pedido salió como «no contestó» y en su
 * chat no había ningún mensaje. Nadie podía saber si se le escribió, si
 * WhatsApp lo rechazó o si el mensaje quedó en otro chat.
 *
 * Reglas:
 *  - Solo lee. No cambia nada y no escribe a nadie.
 *  - Solo usa lo que ya se guarda (bitácora del reparto, intentos de envío de
 *    `deliveries`, mensajes del chat, pedido de GSG y cola de reportes): por eso
 *    sirve igual con pedidos viejos, de antes de que existiera esta pantalla.
 *  - No inventa: si un dato no está (borrado por antigüedad, otro formato), lo dice.
 *  - Nunca lanza por una pieza que falle: esa parte sale como «no se pudo leer».
 */

import type { Repos } from '../db/repos.js';
import type { Solicitud } from '../db/rutas.js';
import type { Message } from '../db/messages.js';
import { INCIDENCIAS, type CodigoIncidencia } from './incidencias.js';
import { revisarEnviosContados } from './motor.js';
import { esperaDeEnvio } from './espera-envio.js';
import { errorDeEnvio } from '../whatsapp/errores-envio.js';
import { entregaDelMensaje } from '../whatsapp/estado-entrega.js';

export type Tono = 'ok' | 'warn' | 'bad' | 'muted';

export interface PasoQuePaso {
  cuando: string | null;
  tono: Tono;
  que: string;
  detalle?: string | null;
}

export interface QuePaso {
  diagnostico: { tono: Tono; titulo: string; porque: string; queHacer: string | null };
  /** Otras cosas que conviene saber (pueden ser varias a la vez). */
  avisos: Array<{ tono: Tono; texto: string }>;
  cifras: { intentosContados: number; mensajesEnSuChat: number; leLlegaron: number; leidos: number; noLlegaron: number; sinConfirmar: number; escribioElCliente: number; envioFrenado: number };
  linea: PasoQuePaso[];
  /** Lo que no se pudo leer (para no fingir que no pasó nada). */
  faltan: string[];
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const recorte = (t: string | null | undefined, n = 120) => {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

/** Lo que mandó el cliente, en pocas palabras. */
function queMando(m: Message): string {
  if (m.kind === 'location') return 'mandó una ubicación';
  if (m.kind === 'text' || m.kind === 'interactive') return m.body ? `escribió: «${recorte(m.body, 80)}»` : 'escribió';
  if (m.kind === 'image') return 'mandó una foto';
  if (m.kind === 'audio') return 'mandó un audio';
  if (m.kind === 'video') return 'mandó un video';
  if (m.kind === 'document') return 'mandó un archivo';
  if (m.kind === 'sticker') return 'mandó un sticker';
  return `mandó un mensaje (${m.kind})`;
}

const NOMBRE_ESTADO: Record<string, string> = {
  pendiente: 'en cola, todavía sin escribirle',
  enviado: 'se le escribió y se espera su respuesta',
  respondio: 'contestó, falta la ubicación',
  resuelto: 'dio su ubicación',
  derivado: 'pasado a una persona',
  incidencia: 'con un problema',
  supervision: 'en revisión por una persona',
  cancelado: 'quitado de la automatización',
};

export async function quePasoConSolicitud(
  repos: Repos,
  solicitud: Solicitud,
  ahora: Date = new Date(),
): Promise<QuePaso> {
  const faltan: string[] = [];
  const linea: PasoQuePaso[] = [];
  const avisos: QuePaso['avisos'] = [];
  const desde = new Date(solicitud.createdAt.getTime() - 60_000);
  const leer = async <T>(que: string, fn: () => Promise<T>, vacio: T): Promise<T> => {
    try {
      return await fn();
    } catch {
      faltan.push(que);
      return vacio;
    }
  };

  const [eventos, envios, mensajes, pedido, reportes, revision] = await Promise.all([
    leer('la bitácora del reparto', () => repos.rutas.eventos(solicitud.id, 500), []),
    solicitud.phone
      ? leer('los intentos de envío', () => repos.deliveries.listRecent({ phone: solicitud.phone!, limit: 200, offset: 0 }), [])
      : Promise.resolve([]),
    solicitud.contactId
      ? leer('los mensajes del chat', () => repos.messages.listMessages(solicitud.contactId!, 300, undefined, desde), [] as Message[])
      : Promise.resolve([] as Message[]),
    solicitud.referencia && repos.entregas
      ? leer('el pedido de GSG', async () => (await repos.entregas.porTracking(solicitud.referencia!)) ?? null, null)
      : Promise.resolve(null),
    leer('la cola de reportes a GSG', async () => {
      const tipos = ['ubicacion', 'incidencia', 'confirmacion', 'entrega'] as const;
      const listas = await Promise.all(tipos.map((t) => repos.rutas.reportesRecientes(5000, t)));
      return listas.flat().filter((r) => r.solicitudId === solicitud.id);
    }, [] as import('../db/rutas.js').Reporte[]),
    leer('la revisión de los mensajes contados', () => revisarEnviosContados(repos, solicitud, ahora), null),
  ]);

  // ---- Bitácora del reparto
  for (const e of eventos) {
    const tono: Tono = e.tipo === 'incidencia' ? 'bad' : e.tipo === 'envio' ? 'ok' : e.tipo === 'derivacion' ? 'warn' : 'muted';
    linea.push({ cuando: iso(e.createdAt), tono, que: e.detalle || e.tipo, detalle: e.tipo === 'envio' && e.payload?.via ? `por ${String(e.payload.via)}` : null });
  }

  // ---- Cada intento de envío a este teléfono desde que existe la solicitud
  const delPedido = envios.filter((d) => d.queuedAt.getTime() >= desde.getTime());
  const porWamid = new Map(mensajes.filter((m) => m.wamid).map((m) => [m.wamid!, m]));
  let envioFrenado = 0;
  for (const d of delPedido) {
    // «la plantilla X» / «el mensaje …»: con su artículo, y quién lo escribió si fue una persona.
    const delChat = d.wamid ? porWamid.get(d.wamid) : undefined;
    const autor = delChat?.payload?.origen === 'persona' ? String(delChat.payload.autorNombre ?? 'Una persona') : null;
    const como = d.templateName
      ? `la plantilla «${d.templateName}»`
      : d.kind === 'interactive'
        ? 'el mensaje con botón de ubicación'
        : autor
          ? `el mensaje que escribió ${autor} desde el panel${delChat?.body ? ` («${recorte(delChat.body, 80)}»)` : ''}`
          : d.kind === 'freeform' || d.kind === 'text'
            ? 'un mensaje de texto'
            : `un mensaje (${d.kind})`;
    if (d.status === 'blocked_by_gate' || (d.status === 'failed' && !d.sentAt)) {
      envioFrenado++;
      const e = errorDeEnvio(d.errorCode, d.errorTitle);
      linea.push({
        cuando: iso(d.failedAt ?? d.queuedAt),
        tono: 'bad',
        que: `No salió ${como}`,
        detalle: e ? `${e.motivo} Qué hacer: ${e.queHacer}` : recorte(d.errorTitle ?? d.errorCode ?? 'sin motivo apuntado', 300),
      });
      continue;
    }
    if (d.sentAt) linea.push({ cuando: iso(d.sentAt), tono: 'ok', que: `Salió ${como} hacia WhatsApp` });
    if (d.deliveredAt) linea.push({ cuando: iso(d.deliveredAt), tono: 'ok', que: `WhatsApp confirmó que le llegó (dos checks)` });
    if (d.readAt) linea.push({ cuando: iso(d.readAt), tono: 'ok', que: `Lo leyó (checks azules)` });
    if (d.status === 'failed') {
      const e = errorDeEnvio(d.errorCode, d.errorTitle);
      linea.push({ cuando: iso(d.failedAt), tono: 'bad', que: `WhatsApp NO se lo entregó`, detalle: e ? `${e.motivo} Qué hacer: ${e.queHacer}` : recorte(d.errorTitle ?? 'sin motivo apuntado', 300) });
    }
  }

  // ---- Lo que hay en su chat
  const salientes = mensajes.filter((m) => m.direction === 'out');
  const entrantes = mensajes.filter((m) => m.direction !== 'out');
  let llegaron = 0, leidos = 0, noLlegaron = 0, sinConfirmar = 0, sinConfirmarViejos = 0;
  for (const m of salientes) {
    const ent = entregaDelMensaje(m, null, ahora);
    if (!ent) continue;
    if (ent.llegoAWhatsapp === true) { llegaron++; if (ent.estado === 'leido') leidos++; }
    else if (ent.llegoAWhatsapp === false) noLlegaron++;
    else { sinConfirmar++; if ((ent.minutosSinConfirmar ?? 0) >= 30) sinConfirmarViejos++; }
  }
  for (const m of entrantes) linea.push({ cuando: iso(m.createdAt), tono: m.kind === 'location' ? 'ok' : 'muted', que: `El cliente ${queMando(m)}` });

  // ---- El pedido de GSG (primer mensaje)
  if (pedido) {
    if (pedido.mensajeError && pedido.mensajeEstado !== 'enviado') {
      linea.push({ cuando: iso(pedido.mensajeUltimoIntentoAt ?? null), tono: 'bad', que: `Primer mensaje del pedido: ${pedido.mensajeEstado ?? 'sin estado'}`, detalle: pedido.mensajeError });
    }
  }

  // ---- Reportes a GSG
  for (const r of reportes) {
    const que = r.tipo === 'incidencia' ? `incidencia «${String(r.payload?.codigo ?? '')}»` : r.tipo;
    const tono: Tono = r.estado === 'enviado' ? 'ok' : r.estado === 'fallido' ? 'bad' : r.estado === 'superado' ? 'muted' : 'warn';
    const estado = r.estado === 'enviado' ? 'GSG lo recibió' : r.estado === 'fallido' ? 'GSG no lo aceptó' : r.estado === 'superado' ? 'ya no hacía falta' : 'esperando a salir';
    linea.push({ cuando: iso(r.createdAt), tono, que: `Reporte a GSG: ${que} — ${estado}`, detalle: r.ultimoError ?? null });
    if (r.estado === 'fallido') avisos.push({ tono: 'bad', texto: `GSG no recibió el reporte de ${que}: ${r.ultimoError ?? 'sin motivo apuntado'}.` });
    if (r.estado === 'pendiente' && r.intentos > 0) avisos.push({ tono: 'warn', texto: `El reporte de ${que} lleva ${r.intentos} intentos sin llegar a GSG${r.ultimoError ? `: ${r.ultimoError}` : ''}.` });
  }

  linea.sort((a, b) => (a.cuando ?? '').localeCompare(b.cuando ?? ''));

  const cifras = {
    intentosContados: solicitud.intentos,
    mensajesEnSuChat: salientes.length,
    leLlegaron: llegaron,
    leidos,
    noLlegaron,
    sinConfirmar,
    escribioElCliente: entrantes.length,
    envioFrenado,
  };

  // ---- Avisos que no son el diagnóstico principal
  if (sinConfirmarViejos > 0) avisos.push({ tono: 'warn', texto: `${sinConfirmarViejos} mensaje${sinConfirmarViejos === 1 ? '' : 's'} lleva${sinConfirmarViejos === 1 ? '' : 'n'} más de 30 minutos sin que WhatsApp confirme que ${sinConfirmarViejos === 1 ? 'llegó' : 'llegaron'}: teléfono apagado o sin internet, número que ya no usa WhatsApp, o los avisos de Meta no están llegando a GSGchat.` });
  const ultimoEnvio = solicitud.ultimoEnvioAt?.getTime() ?? 0;
  const escribioDespues = entrantes.filter((m) => m.createdAt.getTime() > ultimoEnvio - 60_000);
  if (escribioDespues.length && !solicitud.primeraRespuestaAt && ultimoEnvio) {
    avisos.push({ tono: 'bad', texto: `El cliente escribió ${escribioDespues.length} vez${escribioDespues.length === 1 ? '' : 'es'} después del último mensaje, pero el reparto no lo tiene como respuesta: puede que lo mandara desde otro número o que llegara a otro chat. Revisa su chat.` });
  }
  if (!solicitud.contactId) faltan.push('el chat (la solicitud no está ligada a un contacto)');
  if (solicitud.intentos > 0 && solicitud.phone && !delPedido.length) {
    avisos.push({ tono: 'muted', texto: 'No quedan registros de los intentos de envío de este pedido (pueden haberse borrado por antigüedad): lo de abajo sale de la bitácora y del chat.' });
  }

  const diagnostico = diagnosticar(solicitud, { revision, cifras, envioFrenado, ahora, ultimoFrenado: delPedido.filter((d) => d.status === 'blocked_by_gate' || (d.status === 'failed' && !d.sentAt)).at(-1) ?? null, repos });

  return { diagnostico, avisos, cifras, linea, faltan };
}

function diagnosticar(
  s: Solicitud,
  c: {
    revision: { visibles: number; problemas: string[]; sinComprobar: number } | null;
    cifras: QuePaso['cifras'];
    envioFrenado: number;
    ahora: Date;
    ultimoFrenado: { errorCode: string | null; errorTitle: string | null } | null;
    repos: Repos;
  },
): QuePaso['diagnostico'] {
  const ficha = s.incidencia ? INCIDENCIAS[s.incidencia as CodigoIncidencia] : null;
  const estado = NOMBRE_ESTADO[s.estado] ?? s.estado;

  if (s.estado === 'resuelto' && s.lat != null) {
    return { tono: 'ok', titulo: 'Dio su ubicación', porque: `El cliente mandó su ubicación${s.resueltoAt ? ` a las ${horaLima(s.resueltoAt)}` : ''}${s.ubicacionFuente ? ` (${s.ubicacionFuente})` : ''}.`, queHacer: null };
  }
  if (s.estado === 'cancelado') {
    return { tono: 'muted', titulo: 'Quitado de la automatización', porque: 'Una persona lo quitó: ya no se le escribe por este pedido.', queHacer: null };
  }

  // Ya no queda registro para saberlo (pedido de más de 72 h sin intentos guardados): se dice tal cual.
  if (s.intentos > 0 && c.revision && c.revision.visibles === 0 && c.revision.sinComprobar > 0 && c.revision.sinComprobar === c.revision.problemas.length) {
    return {
      tono: 'warn',
      titulo: 'Ya no se puede comprobar si le llegó',
      porque: `Se contaron ${s.intentos} mensaje${s.intentos === 1 ? '' : 's'}, pero de ninguno queda registro: el chat se borra a las 72 h y no hay intentos de envío guardados para este teléfono.${s.incidenciaDetalle ? ` Lo que quedó apuntado: ${s.incidenciaDetalle}.` : ''}`,
      queHacer: 'Si hay dudas, llamar al cliente.',
    };
  }
  // Se contó como «se le escribió» pero no tiene nada: lo más grave, primero.
  if (s.intentos > 0 && c.revision && c.revision.visibles === 0 && c.revision.problemas.length > c.revision.sinComprobar) {
    return {
      tono: 'bad',
      titulo: 'No se le llegó a escribir',
      porque: `El sistema contó ${s.intentos} mensaje${s.intentos === 1 ? '' : 's'}, pero el cliente no recibió ninguno: ${c.revision.problemas.join('; ')}.${s.incidencia === 'sin_respuesta' ? ' Por eso decía «no contestó», y no era cierto.' : ''}`,
      queHacer: 'Reintentar esta solicitud (si el número está bien) o llamar al cliente.',
    };
  }

  if (c.cifras.noLlegaron > 0 && c.cifras.leLlegaron === 0) {
    return {
      tono: 'bad',
      titulo: 'WhatsApp no le entregó los mensajes',
      porque: `Salieron ${c.cifras.mensajesEnSuChat} mensaje${c.cifras.mensajesEnSuChat === 1 ? '' : 's'} y WhatsApp rechazó ${c.cifras.noLlegaron}. ${s.incidenciaDetalle ? `Detalle: ${s.incidenciaDetalle}.` : 'El motivo de cada uno está abajo.'}`,
      queHacer: ficha?.queHacer ?? 'Mirar el motivo de abajo; si es el número, corregirlo; si no, llamar al cliente.',
    };
  }

  if (ficha && s.incidencia === 'sin_respuesta') {
    const llegaron = c.cifras.leLlegaron;
    const porque = llegaron > 0
      ? `Le llegaron ${llegaron} mensaje${llegaron === 1 ? '' : 's'}${c.cifras.leidos ? ` (leyó ${c.cifras.leidos})` : ' (ninguno leído)'} y no contestó.`
      : `Se le mandaron ${c.cifras.mensajesEnSuChat} mensaje${c.cifras.mensajesEnSuChat === 1 ? '' : 's'}, pero WhatsApp nunca confirmó que le llegaran: puede tener el teléfono apagado o sin WhatsApp, o los avisos de Meta no llegan a GSGchat.`;
    return { tono: 'warn', titulo: ficha.titulo, porque, queHacer: ficha.queHacer };
  }

  if (ficha) {
    return { tono: ficha.requiereHumano ? 'bad' : 'warn', titulo: ficha.titulo, porque: `${ficha.explicacion}${s.incidenciaDetalle ? ` Detalle: ${s.incidenciaDetalle}.` : ''}`, queHacer: ficha.queHacer };
  }

  if (s.estado === 'pendiente' && s.intentos === 0) {
    const espera = esperaDeEnvio(c.repos.rutas, s, c.ahora.getTime());
    if (espera) {
      return { tono: 'warn', titulo: 'Todavía no se le escribe', porque: `${espera.motivo}${espera.hasta ? ` Vuelve a intentarlo a las ${horaLima(espera.hasta)}.` : ''}`, queHacer: null };
    }
    if (c.ultimoFrenado) {
      const e = errorDeEnvio(c.ultimoFrenado.errorCode, c.ultimoFrenado.errorTitle);
      return { tono: 'bad', titulo: 'El último intento no salió', porque: e?.motivo ?? recorte(c.ultimoFrenado.errorTitle ?? 'sin motivo apuntado', 300), queHacer: e?.queHacer ?? null };
    }
    return {
      tono: 'muted',
      titulo: 'En cola',
      porque: `Todavía no se le escribió${s.proximoIntentoAt ? `: le toca a las ${horaLima(s.proximoIntentoAt)}` : ': sale en cuanto le toque (si es fuera del horario de envío, al abrir)'}.`,
      queHacer: null,
    };
  }

  if (s.estado === 'enviado' || s.estado === 'respondio') {
    const llegaron = c.cifras.leLlegaron;
    return {
      tono: llegaron || c.cifras.sinConfirmar ? 'ok' : 'warn',
      titulo: s.estado === 'respondio' ? 'Contestó: falta la ubicación' : 'Esperando su respuesta',
      porque: `Se le escribieron ${s.intentos} mensaje${s.intentos === 1 ? '' : 's'}; ${llegaron} confirmado${llegaron === 1 ? '' : 's'} por WhatsApp${c.cifras.leidos ? `, ${c.cifras.leidos} leído${c.cifras.leidos === 1 ? '' : 's'}` : ''}.${s.proximoIntentoAt ? ` El siguiente recordatorio, a las ${horaLima(s.proximoIntentoAt)}.` : ''}`,
      queHacer: null,
    };
  }

  return { tono: 'muted', titulo: `Estado: ${estado}`, porque: s.incidenciaDetalle ?? 'Sin incidencias apuntadas.', queHacer: null };
}

function horaLima(d: Date): string {
  try {
    return new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  } catch {
    return d.toISOString().slice(11, 16);
  }
}
