/**
 * Revisar el flujo y hacer reportes: lo que la IA operadora contesta cuando
 * le preguntan «¿qué pasó con el pedido de Ana?», «¿qué está atascado?» o
 * «dame el reporte de hoy».
 *
 *  - `flujo.revisar`: la linea de tiempo de UN pedido contada en palabras (lo
 *    que se le mando, lo que contesto, ubicacion, confirmacion, motorizado,
 *    avisos) y lo que esta mal o atascado, con que hacer. Sin pedido, revisa
 *    el dia entero y lista los atascados.
 *  - `reportes.dia`: el reporte de hoy (o de un rango de fechas: de los dias
 *    pasados solo hay mensajes, no pedidos).
 *  - `reportes.mandar`: manda ahora el resumen del dia al WhatsApp del
 *    supervisor (cambio: tarjeta + «Hacerlo»).
 *
 * Todo sale de las rutas GET que ya pintan las pantallas (Hoy, Inicio,
 * Reparto, Historial, Ajustes → Resumen del dia): aqui solo se junta y se
 * dice en palabras. Nada de esto escribe, salvo `reportes.mandar` al pulsar.
 */

import { z } from 'zod';
import { horaEnReloj, minutosEnPalabras } from '../entregas/textos.js';
import {
  acortar,
  avisosDeEnvio,
  candidatosEntrega,
  def,
  errorDe,
  estadoEnPalabras,
  idOpcional,
  lineaEntrega,
  ok,
  telefonoBonito,
  type Accion,
  type ContextoAccion,
  type EntregaVista,
  type ResultadoAccion,
} from './acciones-base.js';

const FINALES = ['entregada', 'terminada', 'cancelada'];
const ESTADOS = new Set(['pendiente', 'esperando_ubicacion', 'esperando_confirmacion', 'lista', 'esperando_motorizado', 'avisada', 'entregada', 'terminada', 'cancelada', 'incidencia']);

/** Una fila de Hoy tal como llega por JSON (fechas como texto). */
interface FilaHoy extends EntregaVista {
  createdAt?: string;
  envioRetenidoAt?: string | null;
  mensajesPausadosAt?: string | null;
  requiereHumano?: boolean;
  incidencia?: string | null;
  incidenciaDetalle?: string | null;
  motorizadoEstado?: string;
  motorizadoEnviadoAt?: string | null;
  motorizadoIntentos?: number;
  segundaVisitaPedidaAt?: string | null;
  ubicacionPropuestaAt?: string | null;
  contactadoAt?: string | null;
  motorizadoSinUbicacionAt?: string | null;
  confirmacionIntentos?: number;
  solicitud?: { estado: string; intentos: number; incidencia: string | null } | null;
}

interface MotorizadoHoy {
  id: number;
  nombre: string;
  estado?: string;
  entregasHoy?: number;
  enManos?: number;
  puntualidad?: { texto: string } | null;
}

interface AlertaJson {
  tipo: string;
  entregaId: number;
  referencia: string;
  texto: string;
}

interface Hoy {
  dia: string;
  cifras: Record<string, number>;
  entregas: FilaHoy[];
  motorizados: MotorizadoHoy[];
  ajustes: { reasignarMotorizadoMin?: number; alertaEnCaminoMin?: number; confirmacionMaxIntentos?: number; horarioEntregas?: { desde?: string; hasta?: string; extendidoHasta?: string } };
  motor?: { enHorario?: boolean; parado?: string | null };
  alertas?: AlertaJson[];
  porConfirmarEnvio?: { total: number; aviso?: string };
  cierrePendiente?: number;
  gsgCola?: { pendiente: number; fallido: number; atascado: number } | null;
}

/** Lo de hoy (Hoy) + el horario y la zona horaria del envio (Reparto). */
interface Lectura {
  hoy: Hoy;
  tz: string;
  /** La franja en la que sale algo: la del reparto ampliada con el horario de entregas (como el motor). */
  ventana: { inicio: number; fin: number };
}

async function leer(ctx: ContextoAccion): Promise<Lectura | { error: ResultadoAccion }> {
  const [r, rutas] = await Promise.all([ctx.llamar({ method: 'GET', url: '/admin/entregas' }), ctx.llamar({ method: 'GET', url: '/admin/rutas' }).catch(() => null)]);
  if (!ok(r)) return { error: errorDe(r, 'No se pudieron leer los pedidos de hoy.') };
  const hoy = r.json as Hoy;
  hoy.entregas ??= [];
  hoy.motorizados ??= [];
  hoy.ajustes ??= {};
  const motor = rutas && ok(rutas) ? ((rutas.json as { motor?: { horario?: [number, number]; timezone?: string } }).motor ?? {}) : {};
  const tz = motor.timezone || process.env.TIMEZONE || 'America/Lima';
  const [hi, hf] = motor.horario ?? [9, 19];
  const h = hoy.ajustes.horarioEntregas ?? {};
  const desde = Number((h.desde ?? '').slice(0, 2));
  const hasta = Number((h.extendidoHasta ?? h.hasta ?? '').slice(0, 2));
  const minHasta = Number((h.extendidoHasta ?? h.hasta ?? '').slice(3, 5));
  const ventana = {
    inicio: Number.isFinite(desde) && (h.desde ?? '') ? Math.min(hi, Math.max(0, desde)) : hi,
    fin: Number.isFinite(hasta) && (h.extendidoHasta ?? h.hasta ?? '') ? Math.max(hf, Math.min(24, hasta + (minHasta > 0 ? 1 : 0))) : hf,
  };
  return { hoy, tz, ventana };
}

const hora = (iso: string | null | undefined, tz: string): string => (iso ? horaEnReloj(new Date(iso), tz) : '?');
const horaNum = (iso: string, tz: string): number => Number(hora(iso, tz).slice(0, 2));
const minutosDesde = (iso: string | null | undefined): number => (iso ? (Date.now() - new Date(iso).getTime()) / 60_000 : 0);
const quienEs = (e: FilaHoy): string => e.nombre ?? telefonoBonito(e.phone);

/** AAAA-MM-DD de una fecha en el reloj del negocio. */
function diaDe(fecha: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(fecha);
  } catch {
    return fecha.toISOString().slice(0, 10);
  }
}

/** Si al cliente todavia no se le escribio nada (ni ubicacion, ni confirmacion). */
function sinEscribirle(e: FilaHoy): boolean {
  if (e.envioRetenidoAt || FINALES.includes(e.estado)) return false;
  if (e.estado === 'pendiente') return true;
  if (e.estado === 'esperando_ubicacion') {
    const s = e.solicitud;
    return !e.ubicacionPropuestaAt && !(s && (s.intentos > 0 || s.estado === 'enviado' || s.estado === 'respondio' || s.incidencia === 'ya_en_curso'));
  }
  return e.estado === 'esperando_confirmacion' && e.confirmacionEstado === 'pendiente';
}

export interface Problema {
  problema: string;
  hacer: string;
}

/**
 * Lo que esta mal o atascado en un pedido, con que hacer. Solo mira lo que
 * ya dice la pantalla Hoy (estado, alertas, horario, motor): no adivina.
 */
export function problemasDe(e: FilaHoy, l: Lectura): Problema[] {
  if (FINALES.includes(e.estado)) return [];
  const p: Problema[] = [];
  const { hoy, ventana } = l;
  const aj = hoy.ajustes;
  if (e.envioRetenidoAt) {
    p.push({ problema: 'Está «por confirmar el envío»: no se le escribe nada hasta que alguien lo confirme.', hacer: 'Confírmalo en Números del día (o pídeme «confirma el envío de este pedido»).' });
  }
  if (e.mensajesPausadosAt) {
    p.push({ problema: 'Tiene los mensajes automáticos en pausa: no se le pide ubicación ni confirmación.', hacer: 'Si ya toca, reanúdalo en Números del día.' });
  }
  const segundaVisita = e.estado === 'incidencia' && Boolean(e.segundaVisitaPedidaAt) && !e.requiereHumano;
  if ((e.estado === 'incidencia' || e.requiereHumano) && !segundaVisita && !e.contactadoAt) {
    p.push({ problema: `Necesita una persona: ${e.incidenciaDetalle ?? e.incidencia ?? 'incidencia'}.`, hacer: 'Llámalo o escríbele desde Chats; después márcalo como contactado, reasígnalo o cancélalo.' });
  } else if (e.ubicacionEstado === 'pendiente' && e.solicitud && e.solicitud.incidencia !== 'ya_en_curso' && ['supervision', 'derivado', 'incidencia'].includes(e.solicitud.estado) && !e.contactadoAt) {
    p.push({ problema: `El reparto lo dejó para una persona (pedirle la ubicación no funcionó${e.solicitud.incidencia ? `: ${e.solicitud.incidencia.replace(/_/g, ' ')}` : ''}).`, hacer: 'Llámalo o atiéndelo desde Chats.' });
  }
  if (sinEscribirle(e) && !e.mensajesPausadosAt) {
    if (hoy.motor?.enHorario === false) {
      p.push({ problema: `Todavía no se le escribió y ahora está fuera del horario de envío (${ventana.inicio}:00 a ${ventana.fin}:00): sale a las ${ventana.inicio}:00.`, hacer: `Nada: sale solo a las ${ventana.inicio}:00. Si es urgente, llámalo.` });
    } else if (hoy.motor?.parado && !/horario/i.test(hoy.motor.parado)) {
      p.push({ problema: `Todavía no se le escribió: los envíos están frenados (${hoy.motor.parado}).`, hacer: 'Mira el estado del número (Salud) o pregúntame «¿cómo está el número?».' });
    }
  }
  const alertas = (hoy.alertas ?? []).filter((a) => a.entregaId === e.id);
  for (const a of alertas) {
    p.push({
      problema: a.texto,
      hacer: a.tipo === 'sin_ubicacion' ? 'Asígnale un motorizado sin ubicación o llámalo.' : a.tipo === 'en_camino_tarde' ? 'Llama al motorizado o márcalo como entregado.' : 'Llama al motorizado o pásale el pedido a otro.',
    });
  }
  return p;
}

/** Cada evento de la bitacora de un pedido, en palabras. */
const EVENTO: Record<string, string> = {
  sincronizada: 'llegó de GSG',
  ubicacion: 'ubicación',
  confirmacion_pedida: 'se le pidió confirmar',
  confirmada: 'confirmó',
  rechazada: 'dijo que no',
  motorizado_enviado: 'se le mandó al motorizado',
  motorizado_respondio: 'el motorizado contestó',
  aviso: 'aviso al cliente',
  entregada: 'entregado',
  terminada: 'GSG lo marcó terminado',
  cierre: 'cierre del día',
  segunda_visita: 'segunda visita',
  cerca: 'el motorizado ya está cerca',
  incidencia: 'incidencia',
  nota: 'nota',
  ia: 'la IA',
  reporte: 'aviso a GSG',
};

// ====================================================================== FLUJO

const flujoRevisar = def({
  nombre: 'flujo.revisar',
  tipo: 'consulta',
  descripcion:
    'Revisar el flujo: con un pedido, cuenta paso a paso qué pasó (qué se le mandó, qué contestó, ubicación, confirmación, motorizado, avisos) y dice qué está mal o atascado y qué hacer. Sin pedido, revisa el día entero y lista los pedidos atascados con el motivo.',
  parametros: 'cliente (opcional: código del pedido, nombre o teléfono; vacío = todo el día)',
  ejemplo: { orden: '¿por qué no avanza el pedido de Ana?', accion: { accion: 'flujo.revisar', cliente: 'Ana' } },
  schema: z.object({ cliente: z.string().trim().max(120).optional(), entregaId: idOpcional }),
  async ejecutar(p, ctx) {
    const l = await leer(ctx);
    if ('error' in l) return l.error;
    if (!p.cliente && !p.entregaId) return revisarDia(l, ctx);
    let e = p.entregaId ? l.hoy.entregas.find((x) => x.id === p.entregaId) : undefined;
    if (!e) {
      const c = candidatosEntrega(l.hoy.entregas, p.cliente ?? '') as FilaHoy[];
      if (!c.length) return { ok: false, resumen: `No encuentro ningún pedido de hoy para "${p.cliente}". Dime el código del pedido o el teléfono.`, ir: '/hoy' };
      if (c.length > 1) return { ok: true, resumen: `Hay ${c.length} pedidos que coinciden con "${p.cliente}": ${c.slice(0, 8).map(lineaEntrega).join(' | ')}. ¿Cuál reviso?`, datos: c.slice(0, 8).map((x) => ({ pedido: x.referencia, cliente: x.nombre, estado: x.estado })), ir: '/hoy' };
      e = c[0]!;
    }
    return revisarPedido(e, l, ctx);
  },
});

async function revisarPedido(fila: FilaHoy, l: Lectura, ctx: ContextoAccion): Promise<ResultadoAccion> {
  const { tz, ventana } = l;
  const r = await ctx.llamar({ method: 'GET', url: `/admin/entregas/${fila.id}` });
  if (!ok(r)) return errorDe(r, 'No se pudo leer ese pedido.');
  const j = r.json as { entrega: FilaHoy; eventos?: Array<{ tipo: string; detalle: string | null; createdAt?: string; at?: string }> };
  const e = { ...fila, ...j.entrega };

  // La linea de tiempo: cuando se creo y cada evento de su bitacora, en orden.
  const linea: string[] = [];
  if (e.createdAt) {
    const h = horaNum(e.createdAt, tz);
    const fuera = h < ventana.inicio || h >= ventana.fin;
    linea.push(`${hora(e.createdAt, tz)} · se creó el pedido${fuera ? ` (fuera del horario de envío, ${ventana.inicio}:00 a ${ventana.fin}:00)` : ''}`);
  }
  const eventos = [...(j.eventos ?? [])].map((ev) => ({ ...ev, cuando: ev.createdAt ?? ev.at ?? '' })).sort((a, b) => a.cuando.localeCompare(b.cuando));
  for (const ev of eventos.slice(-25)) linea.push(`${hora(ev.cuando, tz)} · ${EVENTO[ev.tipo] ?? ev.tipo}${ev.detalle ? `: ${acortar(ev.detalle, 140)}` : ''}`);

  // Lo ultimo que se hablo con el cliente (si hay chat).
  let chat: Array<{ quien: string; hora: string; texto: string }> = [];
  const conv = await ctx.llamar({ method: 'GET', url: `/admin/chat/conversations?q=${encodeURIComponent(e.phone)}&limit=5` }).catch(() => null);
  const item = conv && ok(conv) ? ((conv.json as { items?: Array<{ contactId: string; phone: string }> }).items ?? []).find((c) => c.phone === e.phone) : undefined;
  if (item) {
    const m = await ctx.llamar({ method: 'GET', url: `/admin/chat/${encodeURIComponent(item.contactId)}?limit=8` }).catch(() => null);
    if (m && ok(m)) chat = ((m.json as { messages?: Array<{ direction: string; body: string | null; kind: string; createdAt: string }> }).messages ?? []).map((x) => ({ quien: x.direction === 'in' ? 'cliente' : 'nosotros', hora: hora(x.createdAt, tz), texto: acortar(x.body ?? `(${x.kind})`, 140) }));
  }

  const problemas = problemasDe(e, l);
  if (!FINALES.includes(e.estado)) {
    // Modo prueba, numero pausado, en rojo o sin cupo: lo que frenaria el proximo mensaje.
    const avisos = (await avisosDeEnvio(ctx, [e.phone]).catch(() => [] as string[])).filter((a) => !/horario/i.test(a) && !/sí le sale/.test(a));
    for (const a of avisos) anadir(problemas, { problema: a, hacer: 'Mira el estado del número o el modo prueba en Ajustes.' });
  }
  const pasos = `Ubicación: ${e.ubicacionEstado === 'recibida' ? 'sí' : e.ubicacionEstado === 'no_hace_falta' ? 'no hacía falta' : 'no'}; confirmación: ${e.confirmacionEstado ?? '?'}; motorizado: ${e.motorizado?.nombre ?? 'ninguno'}${e.llegaAproxAt && !FINALES.includes(e.estado) ? `; llega hacia las ${hora(e.llegaAproxAt, tz)}` : ''}.`;
  const resumen = `${lineaEntrega(e)}. ${e.situacion ?? ''} ${pasos} ${problemas.length ? `Lo que está mal: ${problemas.map((x) => x.problema).join(' ')}` : FINALES.includes(e.estado) ? 'Ya está cerrado.' : 'No veo nada atascado: va por su camino.'}`.replace(/\s+/g, ' ').trim();
  return {
    ok: true,
    resumen,
    datos: { pedido: e.referencia, cliente: quienEs(e), telefono: e.phone, estado: estadoEnPalabras(e.estado), situacion: e.situacion, lineaDeTiempo: linea, ultimosMensajes: chat, problemas },
    ir: '/hoy',
  };
}

const anadir = (lista: Problema[], x: Problema) => {
  if (!lista.some((y) => y.problema === x.problema)) lista.push(x);
};

async function revisarDia(l: Lectura, ctx: ContextoAccion): Promise<ResultadoAccion> {
  const { hoy, ventana } = l;
  const vivas = hoy.entregas.filter((e) => !FINALES.includes(e.estado));
  const atascados = vivas
    .map((e) => ({ e, problemas: problemasDe(e, l) }))
    .filter((x) => x.problemas.length)
    .map((x) => ({ pedido: x.e.referencia, cliente: quienEs(x.e), estado: estadoEnPalabras(x.e.estado), motivo: x.problemas[0]!.problema, problema: x.problemas.map((y) => y.problema).join(' '), hacer: [...new Set(x.problemas.map((y) => y.hacer))].join(' ') }));

  // Lo que afecta a todos, no a un pedido.
  const general: string[] = [];
  const sinEscribir = vivas.filter((e) => sinEscribirle(e) && !e.mensajesPausadosAt).length;
  if (hoy.motor?.enHorario === false) general.push(`Ahora está fuera del horario de envío (${ventana.inicio}:00 a ${ventana.fin}:00)${sinEscribir ? `: ${sinEscribir} pedido(s) sin escribir salen a las ${ventana.inicio}:00` : ''}.`);
  else if (hoy.motor?.parado && !/horario/i.test(hoy.motor.parado)) general.push(`Los envíos están frenados: ${hoy.motor.parado}.`);
  if (hoy.porConfirmarEnvio?.total) general.push(hoy.porConfirmarEnvio.aviso || `${hoy.porConfirmarEnvio.total} pedido(s) esperan «Confirmar y enviar» en Números del día.`);
  if (hoy.cierrePendiente) general.push(`Quedan ${hoy.cierrePendiente} pedido(s) vivos de días anteriores: falta cerrar el día.`);
  if (hoy.gsgCola && (hoy.gsgCola.fallido || hoy.gsgCola.atascado)) general.push(`GSG no aceptó ${hoy.gsgCola.fallido + hoy.gsgCola.atascado} aviso(s) (fallidos o atascados en la cola).`);
  if (vivas.length) {
    const avisos = (await avisosDeEnvio(ctx, [...new Set(vivas.map((e) => e.phone))]).catch(() => [] as string[])).filter((a) => !/horario/i.test(a) && !/sí le sale/.test(a));
    general.push(...avisos);
  }

  const c = hoy.cifras ?? {};
  const cabeza = `Hoy (${hoy.dia}): ${c.total ?? hoy.entregas.length} pedido(s), ${vivas.length} en marcha, ${c.entregada ?? 0} entregado(s), ${c.cancelada ?? 0} cancelado(s).`;
  // Agrupados por el motivo principal: «sale a las 9:00: GSG-1, GSG-2, GSG-3».
  const porMotivo = new Map<string, string[]>();
  for (const a of atascados) porMotivo.set(a.motivo, [...(porMotivo.get(a.motivo) ?? []), a.pedido]);
  const grupos = [...porMotivo].slice(0, 5).map(([m, refs]) => `${refs.slice(0, 8).join(', ')}${refs.length > 8 ? ` y ${refs.length - 8} más` : ''} → ${acortar(m.replace(/\.$/, ''), 160)}`);
  const lista = atascados.length ? `${atascados.length} atascado(s): ${grupos.join('; ')}${porMotivo.size > 5 ? '; y otros' : ''}.` : 'Ningún pedido atascado.';
  return { ok: true, resumen: [cabeza, lista, general.join(' ')].filter(Boolean).join(' '), datos: { general, atascados: atascados.slice(0, 40).map(({ motivo: _m, ...a }) => a) }, ir: '/hoy' };
}

// =================================================================== REPORTES

const fecha = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$|^(hoy|ayer)$/i, 'la fecha va como AAAA-MM-DD, "hoy" o "ayer"');

/** "ayer" / "hoy" / AAAA-MM-DD -> AAAA-MM-DD, contando desde el dia de Hoy. */
function aDia(v: string | undefined, hoyDia: string): string | undefined {
  if (!v) return undefined;
  const t = v.toLowerCase();
  if (t === 'hoy') return hoyDia;
  if (t === 'ayer') return new Date(Date.parse(`${hoyDia}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return v;
}

const reportesDia = def({
  nombre: 'reportes.dia',
  tipo: 'consulta',
  descripcion:
    'El reporte del día: pedidos por estado, entregados, cancelados, incidencias, sin ubicación, lo de cada motorizado (entregas y tiempo medio) y los mensajes enviados y frenados. También de un rango de fechas (de los días pasados solo hay cifras de mensajes).',
  parametros: 'dia (opcional: "hoy", "ayer" o AAAA-MM-DD; por defecto hoy), desde y hasta (opcionales, AAAA-MM-DD, para un rango)',
  ejemplo: { orden: 'dame el reporte de hoy', accion: { accion: 'reportes.dia' } },
  schema: z.object({ dia: fecha.optional(), desde: fecha.optional(), hasta: fecha.optional() }),
  async ejecutar(p, ctx) {
    const l = await leer(ctx);
    if ('error' in l) return l.error;
    const { hoy, tz } = l;
    const dia = aDia(p.dia, hoy.dia);
    let desde = aDia(p.desde, hoy.dia) ?? dia ?? hoy.dia;
    let hasta = aDia(p.hasta, hoy.dia) ?? dia ?? hoy.dia;
    if (desde > hasta) [desde, hasta] = [hasta, desde];
    const incluyeHoy = desde <= hoy.dia && hoy.dia <= hasta;

    // Los mensajes: los de hoy con detalle (Inicio) y los de cada dia de la ultima semana.
    const res = await ctx.llamar({ method: 'GET', url: '/admin/resumen' }).catch(() => null);
    const inicio = res && ok(res) ? (res.json as { hoy?: { enviados: number; entregados: number; leidos: number; fallidos: number; entrantes: number; cupo?: number; usados?: number }; semana?: Array<{ dia: string; entrantes: number; salientes: number }> }) : {};
    const semana = (inicio.semana ?? []).filter((d) => d.dia >= desde && d.dia <= hasta);

    if (!incluyeHoy) {
      const salientes = semana.reduce((s, d) => s + d.salientes, 0);
      const entrantes = semana.reduce((s, d) => s + d.entrantes, 0);
      const rango = desde === hasta ? `el ${desde}` : `del ${desde} al ${hasta}`;
      return {
        ok: true,
        resumen: `${semana.length ? `Mensajes ${rango}: ${salientes} enviados y ${entrantes} recibidos.` : `No tengo cifras de mensajes ${rango} (solo guardo la última semana).`} El detalle de pedidos (entregados, cancelados, motorizados) solo lo tengo de hoy: de días pasados pregúntame «¿cuadra el día ${desde} con GSG?».`,
        datos: { desde, hasta, mensajesPorDia: semana },
        ir: '/panel#inicio',
      };
    }

    const c = hoy.cifras ?? {};
    const porEstado = Object.fromEntries(Object.entries(c).filter(([k, v]) => v && ESTADOS.has(k)).map(([k, v]) => [estadoEnPalabras(k), v]));
    const incidencias = hoy.entregas.filter((e) => e.estado === 'incidencia').map((e) => ({ pedido: e.referencia, cliente: quienEs(e), motivo: acortar(e.incidenciaDetalle ?? e.incidencia ?? 'incidencia', 120) }));
    const canceladas = hoy.entregas.filter((e) => e.estado === 'cancelada').map((e) => ({ pedido: e.referencia, cliente: quienEs(e), motivo: acortar(e.incidenciaDetalle ?? 'sin motivo', 120) }));
    const porMotorizado = hoy.motorizados
      .map((m) => {
        const suyas = hoy.entregas.filter((e) => e.motorizado?.id === m.id);
        const entregadas = suyas.filter((e) => e.estado === 'entregada');
        const tiempos = entregadas.filter((e) => e.motorizadoEnviadoAt && e.entregadaAt).map((e) => (new Date(e.entregadaAt!).getTime() - new Date(e.motorizadoEnviadoAt!).getTime()) / 60_000).filter((x) => x >= 0);
        return {
          motorizado: m.nombre,
          entregadas: entregadas.length,
          lleva: suyas.filter((e) => !FINALES.includes(e.estado) && e.estado !== 'incidencia').length,
          tiempoMedio: tiempos.length ? minutosEnPalabras(tiempos.reduce((s, x) => s + x, 0) / tiempos.length) : null,
          puntualidad: m.puntualidad?.texto ?? null,
        };
      })
      .filter((f) => f.entregadas || f.lleva);

    // Lo que el sistema freno hoy (guardas: horario, modo prueba, cupo, baja...), por motivo.
    let frenados = 0;
    const motivos: Record<string, number> = {};
    const bloq = await ctx.llamar({ method: 'GET', url: '/admin/deliveries?status=blocked_by_gate&limit=500' }).catch(() => null);
    if (bloq && ok(bloq)) {
      const items = (Array.isArray(bloq.json) ? bloq.json : ((bloq.json as { items?: unknown[] }).items ?? [])) as Array<{ queuedAt?: string; errorTitle?: string | null; errorCode?: string | null }>;
      for (const d of items) {
        if (!d.queuedAt || diaDe(new Date(d.queuedAt), tz) !== hoy.dia) continue;
        frenados++;
        const m = acortar(d.errorTitle ?? d.errorCode ?? 'sin motivo', 80);
        motivos[m] = (motivos[m] ?? 0) + 1;
      }
    }
    const h = inicio.hoy;
    const mensajes = h ? { enviados: h.enviados, entregadosPorWhatsApp: h.entregados, leidos: h.leidos, fallidos: h.fallidos, recibidos: h.entrantes, frenados, porQueFrenados: motivos, cupo: h.cupo != null ? `${h.usados ?? 0} de ${h.cupo}` : null } : { frenados, porQueFrenados: motivos };

    const mejor = [...porMotorizado].sort((a, b) => b.entregadas - a.entregadas)[0];
    const frases = [
      `Hoy (${hoy.dia}): ${c.total ?? hoy.entregas.length} pedido(s); ${c.entregada ?? 0} entregado(s), ${(c.avisada ?? 0) + (c.terminada ?? 0) + (c.esperando_motorizado ?? 0) + (c.lista ?? 0)} en camino o por salir, ${c.cancelada ?? 0} cancelado(s), ${c.incidencia ?? 0} con incidencia y ${c.faltaUbicacion ?? 0} sin ubicación.`,
      h ? `Mensajes: ${h.enviados} enviados, ${h.entrantes} recibidos, ${h.fallidos} fallidos y ${frenados} frenados por el sistema.` : frenados ? `${frenados} mensaje(s) frenados por el sistema.` : '',
    ];
    const otros = desde !== hasta ? { mensajesPorDia: semana, aviso: 'De los días pasados del rango solo hay cifras de mensajes; los pedidos son solo de hoy.' } : {};
    return {
      ok: true,
      resumen: frases.filter(Boolean).join(' '),
      datos: { dia: hoy.dia, pedidos: { total: c.total ?? hoy.entregas.length, porEstado, sinUbicacion: c.faltaUbicacion ?? 0, sinConfirmar: c.faltaConfirmacion ?? 0, urgentes: c.urgente ?? 0 }, incidencias: incidencias.slice(0, 20), canceladas: canceladas.slice(0, 20), porMotorizado, mensajes, gsgNoAcepto: hoy.gsgCola ? hoy.gsgCola.fallido + hoy.gsgCola.atascado : 0, ...otros },
      ir: '/hoy',
    };
  },
});

// ------------------------------------------------ mandar el resumen al supervisor

const FRANJA_EN_PALABRAS = { manana: 'de la mañana («cómo arranca el día»)', tarde: 'de la tarde («cómo cerró el día»)' } as const;

const reportesMandar = def({
  nombre: 'reportes.mandar',
  tipo: 'cambio',
  descripcion: 'Mandar AHORA el resumen del día al WhatsApp del supervisor (el mismo de Ajustes → Resumen del día), con las cifras de este momento.',
  parametros: 'franja (opcional: "manana" = cómo arranca el día, "tarde" = cómo cerró; por defecto según la hora)',
  ejemplo: { orden: 'mándale el resumen del día al supervisor', accion: { accion: 'reportes.mandar' } },
  schema: z.object({ franja: z.enum(['manana', 'tarde']).optional() }),
  async preparar(p, ctx) {
    const r = await ctx.llamar({ method: 'GET', url: '/admin/resumenes' });
    if (!ok(r)) return { tipo: 'no', resumen: errorDe(r, 'No se pudo leer el resumen del día.').resumen, ir: '/panel#configuracion' };
    const j = r.json as { supervisor?: string; ultimos?: Record<string, { dia: string; cuando: string; ok: boolean } | null>; conIA?: boolean };
    const supervisor = String(j.supervisor ?? '').replace(/\D+/g, '');
    if (!supervisor) return { tipo: 'no', resumen: 'No hay un número de supervisor: ponlo en Ajustes → Avisos y luego te lo mando.', ir: '/panel#configuracion' };
    const l = await leer(ctx);
    const tz = 'error' in l ? process.env.TIMEZONE || 'America/Lima' : l.tz;
    const franja = p.franja ?? (Number(horaEnReloj(new Date(), tz).slice(0, 2)) < 14 ? 'manana' : 'tarde');
    const avisos: string[] = [];
    const u = j.ultimos?.[franja];
    if (u?.ok && !('error' in l) && u.dia === l.hoy.dia) avisos.push(`Hoy ya salió a las ${hora(u.cuando, tz)}: se manda otra vez con las cifras de ahora.`);
    avisos.push(j.conIA ? 'Lo redacta la IA con las cifras del sistema (si cambia alguna cifra, sale el texto fijo).' : 'Sale el texto fijo con las cifras del sistema.');
    const c = 'error' in l ? null : l.hoy.cifras;
    return {
      tipo: 'listo',
      params: { ...p, franja },
      tarjeta: {
        que: `Mandar ahora el resumen ${FRANJA_EN_PALABRAS[franja]} al supervisor`,
        aQuien: `supervisor (${telefonoBonito(supervisor)})`,
        ...(c ? { antes: `cifras de ahora: ${c.total ?? 0} pedido(s), ${c.entregada ?? 0} entregado(s), ${c.faltaUbicacion ?? 0} sin ubicación, ${c.incidencia ?? 0} con incidencia, ${c.cancelada ?? 0} cancelado(s)` } : {}),
        despues: 'le llega por WhatsApp el resumen del día',
        avisos,
      },
    };
  },
  async ejecutar(p, ctx) {
    const franja = p.franja ?? (Number(horaEnReloj(new Date(), process.env.TIMEZONE || 'America/Lima').slice(0, 2)) < 14 ? 'manana' : 'tarde');
    const r = await ctx.llamar({ method: 'POST', url: '/admin/resumenes/mandar', body: { franja } });
    if (!ok(r)) return errorDe(r, 'No salió el resumen.');
    const j = r.json as { texto?: string; conIA?: boolean };
    return { ok: true, resumen: `Resumen ${franja === 'manana' ? 'de la mañana' : 'de la tarde'} mandado al supervisor${j.conIA ? ' (redactado por la IA)' : ''}.`, datos: { texto: acortar(j.texto ?? '', 1200) }, ir: '/panel#configuracion' };
  },
});

export const ACCIONES_INFORMES: Accion[] = [flujoRevisar, reportesDia, reportesMandar];
