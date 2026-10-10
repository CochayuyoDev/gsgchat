/**
 * El resumen del dia por WhatsApp al supervisor, dos veces al dia.
 *
 * Por la mañana (08:30 si nadie lo cambio) le llega "como arranca el dia":
 * cuantos pedidos hay, a cuantos falta la ubicacion o confirmar, cuantos
 * motorizados estan activos, si GSG esta conectado. Por la tarde (18:30)
 * "como cerro": entregados, en camino todavia, sin terminar, incidencias,
 * cancelados, reportes que GSG no acepto y quien entrego mas.
 *
 * Las cifras las pone SIEMPRE el sistema. Si el asistente de IA esta
 * conectado, redacta el texto alrededor de esas cifras (mas natural, lo
 * urgente primero); despues se comprueba que no cambio ni invento ningun
 * numero, y si lo hizo sale el texto fijo. Sin IA, sale el texto fijo.
 *
 * Sale por el sender como `manual: true` (es al supervisor, no a un
 * cliente: no gasta cupo ni pasa por el marcapasos) y queda anotado en
 * `settings` (`resumenes.estado`) cuando salio cada uno, para no repetirlo
 * y para que la pantalla lo diga. Si WhatsApp estaba caido a esa hora, se
 * reintenta cada diez minutos durante hora y media; pasado eso, se deja para
 * mañana y la pantalla explica por que no salio.
 */

import { conexionGsgVigente } from '../rutas/conexion-gsg.js';
import { esNumeroDePrueba } from '../desarrollador/numeros.js';
import type { Sender } from '../outbound/sender.js';
import type { SettingsRepo } from '../settings/service.js';
import type { MensajeIA } from '../ia/proveedores.js';
import type { ResumenEntregas } from '../entregas/servicio.js';

export type Franja = 'manana' | 'tarde';
export const FRANJAS: Franja[] = ['manana', 'tarde'];

export const CLAVE_ESTADO_RESUMENES = 'resumenes.estado';

/** Durante cuanto se sigue intentando mandar un resumen pasada su hora. */
const VENTANA_MIN = 90;
/** Cada cuanto se reintenta un envio que no salio (WhatsApp caido, por ejemplo). */
const REINTENTO_MIN = 10;

export interface AjustesResumenes {
  activo: boolean;
  horaManana: string;
  horaTarde: string;
}

export interface EnvioResumen {
  dia: string;
  cuando: string;
  ok: boolean;
  /** Por que no salio, en cristiano. */
  motivo: string | null;
  texto: string;
  conIA: boolean;
  /** 'motor' o el nombre de quien pulso "Mandar ahora". */
  quien: string;
}

export interface CifrasResumen {
  dia: string;
  total: number;
  faltaUbicacion: number;
  faltaConfirmacion: number;
  listas: number;
  enCamino: number;
  entregadas: number;
  incidencia: number;
  canceladas: number;
  sinTerminar: number;
  motorizadosActivos: number;
  gsgConectada: boolean;
  gsgDescripcion: string;
  reportesFallidos: number;
  /** Referencias con incidencia (hasta cinco) y su motivo. */
  incidencias: Array<{ referencia: string; detalle: string }>;
  /** Referencias que siguen vivas (hasta cinco). */
  vivas: string[];
  mejorMotorizado: { nombre: string; entregas: number } | null;
  whatsappConectado: boolean;
  /** El cuadre de fin de dia con GSG, ya en palabras (solo por la tarde y con conexion). */
  cuadreGsg?: string | null;
}

export interface EstadoResumenes {
  ajustes: AjustesResumenes;
  supervisor: string;
  ultimos: Record<Franja, EnvioResumen | null>;
  /** La proxima franja que toca hoy (o mañana) y su hora. */
  proximo: { franja: Franja; hora: string; hoy: boolean } | null;
  /** Si hay asistente de IA para redactar. */
  conIA: boolean;
}

export interface ServicioResumenes {
  estado(): EstadoResumenes;
  /** Las cifras de ahora mismo, tal como las ve el sistema. */
  cifras(): Promise<CifrasResumen>;
  /** El texto que saldria ahora para esa franja: con IA si hay (y si respeta las cifras), si no el fijo. */
  redactar(franja: Franja): Promise<{ texto: string; conIA: boolean; cifras: CifrasResumen; textoFijo: string }>;
  /** Manda el resumen al supervisor ahora. `forzar` lo manda aunque hoy ya saliera. */
  mandar(franja: Franja, opts?: { quien?: string; forzar?: boolean }): Promise<{ ok: boolean; motivo?: string; texto?: string; conIA?: boolean }>;
  /** Lo llama el ticker: manda la franja que toque si aun no salio hoy. Devuelve que hizo. */
  tick(): Promise<{ franja: Franja; ok: boolean; motivo?: string } | null>;
}

export interface DepsResumenes {
  settingsRepo: SettingsRepo;
  sender: Sender;
  ajustes: () => AjustesResumenes;
  /** A quien se manda. Vacio = a nadie (y la pantalla lo dice). */
  supervisor: () => string;
  nombreNegocio: () => string;
  /** Las entregas del dia; sin ellas el resumen solo dice si WhatsApp esta conectado. */
  entregas?: Pick<import('../entregas/servicio.js').ServicioEntregas, 'resumen'>;
  /** La IA para redactar; null si no esta conectada. */
  ia?: () => { completar(mensajes: MensajeIA[], opts?: { maxTokens?: number }): Promise<string> } | null;
  whatsappConectado?: () => boolean;
  /** El cuadre con GSG (src/rutas/gsg-extras.ts); sin el, se usa la conexion vigente del proceso. */
  gsgExtras?: () => { cuadrar(dia?: string): Promise<{ resumen: string }> } | null;
  timezone?: string;
  /** La zona horaria vigente (Ajustes); si se da, manda sobre `timezone`. */
  zonaHoraria?: () => string;
  publicBaseUrl?: string;
  ahora?: () => Date;
  log?: (m: string, d?: Record<string, unknown>) => void;
}

/** AAAA-MM-DD y HH:MM en la zona horaria del negocio. */
export function diaYHora(fecha: Date, timezone: string): { dia: string; hora: string; minutos: number } {
  try {
    const dia = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(fecha);
    const partes = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(fecha);
    const h = Number(partes.find((p) => p.type === 'hour')?.value ?? '0') % 24;
    const m = Number(partes.find((p) => p.type === 'minute')?.value ?? '0');
    return { dia, hora: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, minutos: h * 60 + m };
  } catch {
    const dia = fecha.toISOString().slice(0, 10);
    return { dia, hora: fecha.toISOString().slice(11, 16), minutos: fecha.getUTCHours() * 60 + fecha.getUTCMinutes() };
  }
}

export function minutosDe(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

const VIVAS = new Set(['pendiente', 'esperando_ubicacion', 'esperando_confirmacion', 'lista', 'esperando_motorizado', 'avisada']);

/** Las cifras de Hoy, contadas de nuevo sobre una lista (sin lo de prueba). */
function recontar(entregas: ResumenEntregas['entregas']): ResumenEntregas['cifras'] {
  const c = { ...Object.fromEntries(Object.keys({ pendiente: 0, esperando_ubicacion: 0, esperando_confirmacion: 0, lista: 0, esperando_motorizado: 0, avisada: 0, entregada: 0, terminada: 0, cancelada: 0, incidencia: 0 }).map((k) => [k, 0])) } as Record<string, number>;
  let faltaUbicacion = 0;
  let faltaConfirmacion = 0;
  let enCamino = 0;
  for (const e of entregas) {
    c[e.estado] = (c[e.estado] ?? 0) + 1;
    const x = e as unknown as { ubicacionEstado?: string; confirmacionEstado?: string };
    if (x.ubicacionEstado === 'pendiente' && e.estado !== 'cancelada') faltaUbicacion++;
    if ((x.confirmacionEstado === 'pendiente' || x.confirmacionEstado === 'pedida') && e.estado !== 'cancelada') faltaConfirmacion++;
    if (e.estado === 'lista' || e.estado === 'esperando_motorizado' || e.estado === 'avisada' || e.estado === 'terminada') enCamino++;
  }
  return { ...c, total: entregas.length, faltaUbicacion, faltaConfirmacion, enCamino } as unknown as ResumenEntregas['cifras'];
}

/** Convierte lo que ensena Hoy en las cifras del resumen. */
export function cifrasDe(r: ResumenEntregas | null, extra: { whatsappConectado: boolean; dia: string }): CifrasResumen {
  if (!r) {
    return { dia: extra.dia, total: 0, faltaUbicacion: 0, faltaConfirmacion: 0, listas: 0, enCamino: 0, entregadas: 0, incidencia: 0, canceladas: 0, sinTerminar: 0, motorizadosActivos: 0, gsgConectada: false, gsgDescripcion: 'sin conexión', reportesFallidos: 0, incidencias: [], vivas: [], mejorMotorizado: null, whatsappConectado: extra.whatsappConectado };
  }
  // Lo del Modulo desarrollador (numeros de prueba) no entra en el resumen
  // que recibe el supervisor real: se recuentan las cifras sin ello.
  const reales = r.entregas.filter((e) => !esNumeroDePrueba(e.phone));
  const c = reales.length === r.entregas.length ? r.cifras : recontar(reales);
  const vivas = reales.filter((e) => VIVAS.has(e.estado));
  const conIncidencia = reales.filter((e) => e.estado === 'incidencia');
  const motorizados = r.motorizados.filter((m) => !esNumeroDePrueba(m.phone));
  const activos = motorizados.filter((m) => m.estado === 'activo');
  const mejor = [...motorizados].filter((m) => (m.entregasHoy ?? 0) > 0).sort((a, b) => (b.entregasHoy ?? 0) - (a.entregasHoy ?? 0))[0] ?? null;
  return {
    dia: r.dia,
    total: c.total,
    faltaUbicacion: c.faltaUbicacion,
    faltaConfirmacion: c.faltaConfirmacion,
    listas: c.lista,
    enCamino: c.enCamino,
    entregadas: c.entregada + c.terminada,
    incidencia: c.incidencia,
    canceladas: c.cancelada,
    sinTerminar: vivas.length,
    motorizadosActivos: activos.length,
    gsgConectada: r.gsg?.conectada ?? false,
    gsgDescripcion: r.gsg?.descripcion ?? 'sin conexión',
    reportesFallidos: r.gsgCola?.fallido ?? 0,
    incidencias: conIncidencia.slice(0, 5).map((e) => ({ referencia: e.referencia, detalle: e.incidenciaDetalle || e.incidencia || 'necesita a alguien' })),
    vivas: vivas.slice(0, 5).map((e) => e.referencia),
    mejorMotorizado: mejor ? { nombre: mejor.nombre, entregas: mejor.entregasHoy ?? 0 } : null,
    whatsappConectado: extra.whatsappConectado,
  };
}

const plural = (n: number, uno: string, varios: string): string => (n === 1 ? uno : varios);

function fechaLarga(dia: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('es-PE', { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${dia}T12:00:00Z`));
  } catch {
    return dia;
  }
}

/** El texto fijo, sin IA: lo que sale si no hay asistente o si el asistente toco una cifra. */
export function textoFijo(franja: Franja, c: CifrasResumen, ctx: { negocio: string; timezone: string; url: string }): string {
  const lineas: string[] = [];
  const fecha = fechaLarga(c.dia, ctx.timezone);
  if (franja === 'manana') {
    lineas.push(`Buenos días. Así arranca el día en ${ctx.negocio} (${fecha}):`);
    if (!c.whatsappConectado) lineas.push('⚠ WhatsApp no está conectado: no sale ni entra nada hasta vincularlo.');
    if (c.total === 0) lineas.push(c.gsgConectada ? '• Todavía no hay pedidos de hoy en GSG.' : '• Todavía no hay pedidos de hoy: GSG no está conectado, hay que pegar la lista del día en Hoy.');
    else {
      lineas.push(`• Pedidos de hoy: ${c.total} (falta ubicación: ${c.faltaUbicacion} · falta confirmar: ${c.faltaConfirmacion} · ubicación y confirmación registradas: ${c.listas} · en camino: ${c.enCamino}).`);
      if (c.gsgConectada) lineas.push(`• GSG: ${c.gsgDescripcion}.`);
      else lineas.push('• GSG sin conectar: los pedidos se pegan a mano.');
    }
    if (c.incidencia) lineas.push(`• Necesitan a alguien: ${c.incidencia} (${c.incidencias.map((i) => i.referencia).join(', ')}).`);
    if (c.reportesFallidos) lineas.push(`• Reportes que GSG no aceptó: ${c.reportesFallidos}.`);
  } else {
    lineas.push(`Buenas tardes. Así va cerrando el día en ${ctx.negocio} (${fecha}):`);
    if (c.total === 0) lineas.push('• Hoy no hubo pedidos en el sistema.');
    else {
      lineas.push(`• Entregados: ${c.entregadas} de ${c.total}.`);
      if (c.enCamino) lineas.push(`• En camino todavía: ${c.enCamino}.`);
      if (c.sinTerminar) lineas.push(`• Sin terminar: ${c.sinTerminar}${c.vivas.length ? ` (${c.vivas.join(', ')}${c.sinTerminar > c.vivas.length ? '…' : ''})` : ''}: al cierre del día pasan a «necesitan a alguien».`);
      if (c.incidencia) lineas.push(`• Necesitan a alguien: ${c.incidencia}${c.incidencias.length ? ' — ' + c.incidencias.map((i) => `${i.referencia}: ${i.detalle}`).join('; ') : ''}.`);
      if (c.canceladas) lineas.push(`• ${plural(c.canceladas, 'Cancelado', 'Cancelados')}: ${c.canceladas}.`);
      if (c.reportesFallidos) lineas.push(`• Reportes que GSG no aceptó: ${c.reportesFallidos} (en Hoy se reintentan).`);
    }
    if (c.cuadreGsg) lineas.push(`• Cuadre con GSG: ${c.cuadreGsg}`);
    if (!c.whatsappConectado) lineas.push('⚠ WhatsApp no está conectado.');
  }
  lineas.push(`Lo ves en ${ctx.url.replace(/\/+$/, '')}/hoy`);
  return lineas.join('\n');
}

/** Los numeros de un texto, tal cual (62, 1003, 30...). */
export function numerosDe(texto: string): string[] {
  return (texto.match(/\d+/g) ?? []).map((n) => n.replace(/^0+(?=\d)/, ''));
}

/**
 * Si lo que redacto la IA respeta las cifras: todas las del texto fijo
 * (menos la URL) tienen que estar, y no puede aparecer ninguna que no
 * estuviera. Un "62 pedidos" convertido en "60" o un "unos 50" inventado no
 * pasan.
 */
export function respetaLasCifras(redactado: string, fijo: string, url: string): boolean {
  const sinUrl = (t: string) => t.split(url.replace(/\/+$/, '')).join(' ');
  const permitidos = new Set(numerosDe(sinUrl(fijo)));
  const puestos = numerosDe(sinUrl(redactado));
  if (puestos.some((n) => !permitidos.has(n))) return false;
  const requeridos = new Set(numerosDe(sinUrl(fijo).split('\n').filter((l) => l.startsWith('•') || l.startsWith('⚠')).join('\n')));
  const enRedactado = new Set(puestos);
  for (const n of requeridos) if (!enRedactado.has(n)) return false;
  return true;
}

export async function crearServicioResumenes(deps: DepsResumenes): Promise<ServicioResumenes> {
  const zona = () => deps.zonaHoraria?.() ?? deps.timezone ?? 'America/Lima';
  const ahora = deps.ahora ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  const url = deps.publicBaseUrl ?? '';

  let ultimos: Record<Franja, EnvioResumen | null> = { manana: null, tarde: null };
  for (const row of await deps.settingsRepo.getAll()) {
    if (row.key !== CLAVE_ESTADO_RESUMENES) continue;
    try {
      const raw = JSON.parse(row.value) as Partial<Record<Franja, EnvioResumen | null>>;
      ultimos = { manana: raw.manana ?? null, tarde: raw.tarde ?? null };
    } catch {
      // Un valor roto se ignora: se vuelve a empezar.
    }
  }
  async function guardar(): Promise<void> {
    await deps.settingsRepo.put(CLAVE_ESTADO_RESUMENES, JSON.stringify(ultimos), false).catch((e) => log('no se pudo guardar el estado de los resumenes', { detalle: e instanceof Error ? e.message : String(e) }));
  }

  async function cifras(franja?: Franja): Promise<CifrasResumen> {
    const { dia } = diaYHora(ahora(), zona());
    const conectado = deps.whatsappConectado?.() ?? true;
    const r = deps.entregas ? await deps.entregas.resumen().catch(() => null) : null;
    const base = cifrasDe(r, { whatsappConectado: conectado, dia });
    // Por la tarde, el cuadre con GSG (lo que aqui figura cerrado frente a
    // lo que GSG tiene en terminados), en palabras y sin tocar las cifras.
    if (franja === 'tarde' && base.gsgConectada) {
      const extras = deps.gsgExtras?.() ?? conexionGsgVigente()?.extras ?? null;
      if (extras) base.cuadreGsg = await extras.cuadrar(dia).then((q) => q.resumen).catch(() => null);
    }
    return base;
  }

  async function redactar(franja: Franja) {
    const c = await cifras(franja);
    const fijo = textoFijo(franja, c, { negocio: deps.nombreNegocio(), timezone: zona(), url });
    const ia = deps.ia?.() ?? null;
    if (!ia) return { texto: fijo, conIA: false, cifras: c, textoFijo: fijo };
    try {
      const sistema = [
        `Eres el asistente de "${deps.nombreNegocio()}", un negocio de reparto en Lima. Redactas para el coordinador del reparto un mensaje de WhatsApp.`,
        'Reglas: máximo cinco frases, en español de Perú, claro y cálido, lo urgente primero (lo que necesita a alguien, lo que falta, lo que está sin conectar).',
        'Usa EXACTAMENTE las cifras y las referencias del resumen de abajo: no cambies ningún número, no inventes ninguno, no añadas cifras nuevas ni horas. Sin listas con viñetas: prosa corta.',
        'Termina con la misma última línea del resumen (la del enlace), tal cual.',
      ].join('\n');
      const cruda = (await ia.completar([{ role: 'system', content: sistema }, { role: 'user', content: fijo }], { maxTokens: 400 })).trim();
      if (cruda && respetaLasCifras(cruda, fijo, url)) return { texto: cruda, conIA: true, cifras: c, textoFijo: fijo };
      log('el resumen redactado por la IA no respetaba las cifras: sale el texto fijo', { franja });
    } catch (error) {
      log('la IA no pudo redactar el resumen: sale el texto fijo', { franja, detalle: error instanceof Error ? error.message : String(error) });
    }
    return { texto: fijo, conIA: false, cifras: c, textoFijo: fijo };
  }

  async function mandar(franja: Franja, opts: { quien?: string; forzar?: boolean } = {}) {
    const { dia } = diaYHora(ahora(), zona());
    const destino = deps.supervisor().replace(/\D+/g, '');
    if (!destino) return { ok: false, motivo: 'No hay un número de supervisor: ponlo en Ajustes → Avisos.' };
    if (!opts.forzar && ultimos[franja]?.dia === dia && ultimos[franja]?.ok) return { ok: false, motivo: 'Hoy ya salió ese resumen.' };
    const r = await redactar(franja);
    const quien = opts.quien ?? 'motor';
    let ok = false;
    let motivo: string | null = null;
    try {
      const envio = await deps.sender.send({ phone: destino, kind: 'freeform', category: 'UTILITY', text: r.texto, manual: true, origen: 'sistema' });
      ok = envio.ok;
      if (!envio.ok) motivo = envio.blocked ? envio.reason : envio.error;
    } catch (error) {
      motivo = error instanceof Error ? error.message : String(error);
    }
    ultimos[franja] = { dia, cuando: ahora().toISOString(), ok, motivo, texto: r.texto, conIA: r.conIA, quien };
    await guardar();
    if (!ok) log('no salio el resumen del dia', { franja, motivo });
    return ok ? { ok: true, texto: r.texto, conIA: r.conIA } : { ok: false, motivo: motivo ?? 'no salió', texto: r.texto, conIA: r.conIA };
  }

  function estado(): EstadoResumenes {
    const a = deps.ajustes();
    const { dia, minutos } = diaYHora(ahora(), zona());
    let proximo: EstadoResumenes['proximo'] = null;
    if (a.activo) {
      const candidatos: Array<{ franja: Franja; hora: string }> = [
        { franja: 'manana' as Franja, hora: a.horaManana },
        { franja: 'tarde' as Franja, hora: a.horaTarde },
      ].sort((x, y) => minutosDe(x.hora) - minutosDe(y.hora));
      const hoy = candidatos.find((c) => minutosDe(c.hora) > minutos && !(ultimos[c.franja]?.dia === dia && ultimos[c.franja]?.ok));
      proximo = hoy ? { ...hoy, hoy: true } : { ...candidatos[0]!, hoy: false };
    }
    return { ajustes: a, supervisor: deps.supervisor(), ultimos: { manana: ultimos.manana, tarde: ultimos.tarde }, proximo, conIA: Boolean(deps.ia?.()) };
  }

  async function tick() {
    const a = deps.ajustes();
    if (!a.activo) return null;
    if (!deps.supervisor().replace(/\D+/g, '')) return null;
    const { dia, minutos } = diaYHora(ahora(), zona());
    for (const franja of FRANJAS) {
      const hora = minutosDe(franja === 'manana' ? a.horaManana : a.horaTarde);
      if (minutos < hora || minutos >= hora + VENTANA_MIN) continue;
      const u = ultimos[franja];
      if (u?.dia === dia) {
        if (u.ok) continue;
        // Fallo hace poco: se espera antes de volver a intentarlo.
        if (ahora().getTime() - new Date(u.cuando).getTime() < REINTENTO_MIN * 60_000) continue;
      }
      const r = await mandar(franja, { quien: 'motor' });
      return { franja, ok: r.ok, motivo: r.ok ? undefined : r.motivo };
    }
    return null;
  }

  return { estado, cifras, redactar, mandar, tick };
}

/** El ticker: mira cada minuto si toca mandar un resumen. Devuelve la funcion que lo para. */
export function startResumenes(servicio: ServicioResumenes, opts: { cadaMs?: number; log?: (m: string, d?: Record<string, unknown>) => void } = {}): () => void {
  const log = opts.log ?? (() => undefined);
  let ocupado = false;
  const timer = setInterval(() => {
    if (ocupado) return;
    ocupado = true;
    void servicio
      .tick()
      .then((r) => {
        if (r) log(r.ok ? 'salio el resumen del dia al supervisor' : 'no salio el resumen del dia', { franja: r.franja, motivo: r.motivo });
      })
      .catch((e) => log('fallo el resumen del dia', { detalle: e instanceof Error ? e.message : String(e) }))
      .finally(() => {
        ocupado = false;
      });
  }, opts.cadaMs ?? 60_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
