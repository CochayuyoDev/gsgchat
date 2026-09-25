/**
 * Si lo que llego vale como respuesta al paso.
 *
 * Nada de aqui se inventa: el SI/NO sale del lector de las entregas
 * (`leerConfirmacionConReglas`), el «llegué / terminé / no pude» de lo que ya
 * lee a los motorizados (`leerMotorizadoCorta`, `leerEntregadoConReglas`), la
 * ubicacion llega ya detectada por el manejador de entrantes (pin nativo o
 * enlace de mapa, ver handlers/inbound.ts) y el telefono de la lista se revisa
 * con el plan de numeracion del reparto (src/rutas/telefono.ts). Lo propio de
 * este fichero son los datos nuevos: DNI/CE/RUC, numero, fecha u hora,
 * direccion escrita y los adjuntos.
 */

import { leerConfirmacionConReglas, leerEntregadoConReglas, leerMotorizadoCorta, normalizar } from '../entregas/interpretar.js';
import type { TipoDato } from './modelo.js';

/** Lo que trae un mensaje, ya leido por el manejador de entrantes. */
export interface EntradaProceso {
  /** El texto (o el pie de foto, o lo que dijo en el audio). */
  texto: string;
  /** Un pin o un enlace de mapa que se leyo bien y cae en la zona. */
  ubicacion?: { lat: number; lng: number; mapsUrl: string | null; fuente: string } | null;
  /** Mando una ubicacion, pero cae fuera de la zona configurada. */
  fueraDeZona?: boolean;
  /** Una foto, un documento, un audio... */
  adjunto?: { tipo: string; mediaId?: string | null; mimeType?: string | null; nombre?: string | null } | null;
  /** El id del boton que toco (proc:<persona>:si...). */
  boton?: string | null;
}

export type Lectura =
  | { ok: true; valor: string; extra?: Record<string, string | number | null> }
  | { ok: false; motivo: string };

// ------------------------------------------------------------ DNI / CE / RUC

/** El digito de control del RUC (modulo 11 de SUNAT). */
export function rucValido(ruc: string): boolean {
  if (!/^(10|15|16|17|20)\d{9}$/.test(ruc)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((s, p, i) => s + p * Number(ruc[i]), 0);
  const resto = 11 - (suma % 11);
  const control = resto === 10 ? 0 : resto === 11 ? 1 : resto;
  return control === Number(ruc[10]);
}

export function leerDocumentoIdentidad(texto: string): Lectura {
  const limpio = texto.toUpperCase().replace(/[.\-\s]/g, ' ');
  const grupos = [...limpio.matchAll(/[A-Z]?\d{5,13}/g)].map((m) => m[0]!);
  if (!grupos.length) return { ok: false, motivo: 'no encontré ningún número de documento en el mensaje' };
  for (const g of grupos) {
    const d = g.replace(/\D/g, '');
    if (d.length === 11 && /^(10|15|16|17|20)/.test(d)) {
      if (rucValido(d)) return { ok: true, valor: d, extra: { tipo: 'RUC' } };
      return { ok: false, motivo: `el RUC ${d} no es válido (revisa un dígito)` };
    }
    if (d.length === 8 && !/[A-Z]/.test(g)) return { ok: true, valor: d, extra: { tipo: 'DNI' } };
    if (d.length === 9 || (/^[A-Z]/.test(g) && d.length >= 8 && d.length <= 12)) return { ok: true, valor: g, extra: { tipo: 'Carné de extranjería' } };
  }
  const d = grupos[0]!.replace(/\D/g, '');
  if (d.length < 8) return { ok: false, motivo: `tiene ${d.length} dígitos y el DNI tiene 8` };
  return { ok: false, motivo: `tiene ${d.length} dígitos: el DNI tiene 8, el carné de extranjería 9 y el RUC 11` };
}

// ------------------------------------------------------------ numero

export function leerNumero(texto: string): Lectura {
  const t = texto.replace(/s\/\.?|soles?|pen|usd|\$/gi, ' ');
  const m = t.match(/-?\d{1,3}(?:[ ,.]\d{3})+(?:[.,]\d{1,2})?|-?\d+(?:[.,]\d+)?/);
  if (!m) return { ok: false, motivo: 'no encontré ningún número' };
  let crudo = m[0]!.replace(/ /g, '');
  // 1,250.50 / 1.250,50 / 1250,5: la ultima coma o punto con 1-2 cifras detras es el decimal.
  const dec = crudo.match(/[.,](\d{1,2})$/);
  if (dec) crudo = crudo.slice(0, -dec[0].length).replace(/[.,]/g, '') + '.' + dec[1];
  else crudo = crudo.replace(/[.,]/g, '');
  const n = Number(crudo);
  if (!Number.isFinite(n)) return { ok: false, motivo: 'no encontré ningún número' };
  return { ok: true, valor: String(n) };
}

// ------------------------------------------------------------ fecha y hora

const MESES: Record<string, number> = { ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4, may: 5, mayo: 5, jun: 6, junio: 6, jul: 7, julio: 7, ago: 8, agosto: 8, set: 9, sep: 9, sept: 9, setiembre: 9, septiembre: 9, oct: 10, octubre: 10, nov: 11, noviembre: 11, dic: 12, diciembre: 12 };
const DIAS: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };

/** La fecha de hoy (AAAA-MM-DD) y el dia de la semana en la zona del negocio. */
function hoyEn(ahora: Date, timezone: string): { y: number; m: number; d: number; dow: number } {
  try {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(ahora);
    const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(v('weekday'));
    return { y: Number(v('year')), m: Number(v('month')), d: Number(v('day')), dow: dow < 0 ? ahora.getDay() : dow };
  } catch {
    return { y: ahora.getFullYear(), m: ahora.getMonth() + 1, d: ahora.getDate(), dow: ahora.getDay() };
  }
}

const dos = (n: number) => String(n).padStart(2, '0');

function sumarDias(y: number, m: number, d: number, dias: number): { y: number; m: number; d: number } {
  const f = new Date(Date.UTC(y, m - 1, d + dias));
  return { y: f.getUTCFullYear(), m: f.getUTCMonth() + 1, d: f.getUTCDate() };
}

/** "25/09", "25/09/2026", "2026-09-25", "25 de setiembre", "mañana", "el lunes". */
export function leerFecha(texto: string, ahora = new Date(), timezone = 'America/Lima'): string | null {
  const t = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/(\d)[/.](\d)/g, '$1-$2')
    .replace(/[¡!¿?,;()"'«»*_~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const hoy = hoyEn(ahora, timezone);
  let m = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return valida(Number(m[1]), Number(m[2]), Number(m[3]));
  m = t.match(/\b(\d{1,2})-(\d{1,2})(?:-(\d{2,4}))?\b/);
  if (m) {
    const anio = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : hoy.y;
    return valida(anio, Number(m[2]), Number(m[1]));
  }
  m = t.match(/\b(\d{1,2}) (?:de )?([a-z]+)(?: (?:de |del )?(\d{4}))?\b/);
  if (m && MESES[m[2]!]) return valida(m[3] ? Number(m[3]) : hoy.y, MESES[m[2]!]!, Number(m[1]));
  if (/\bpasado manana\b/.test(t)) return fmt(sumarDias(hoy.y, hoy.m, hoy.d, 2));
  // "mañana" es el dia de mañana, salvo en "de/por/en la mañana" (la franja del dia).
  if (/\bmanana\b/.test(t.replace(/\b(de|por|en) la manana\b/g, ' '))) return fmt(sumarDias(hoy.y, hoy.m, hoy.d, 1));
  if (/\bhoy\b/.test(t)) return fmt(hoy);
  for (const [nombre, dow] of Object.entries(DIAS)) {
    if (new RegExp(`\\b${nombre}\\b`).test(t)) {
      const falta = ((dow - hoy.dow + 7) % 7) || 7;
      return fmt(sumarDias(hoy.y, hoy.m, hoy.d, falta));
    }
  }
  return null;

  function valida(y: number, mes: number, d: number): string | null {
    if (mes < 1 || mes > 12 || d < 1 || d > 31) return null;
    const f = new Date(Date.UTC(y, mes - 1, d));
    if (f.getUTCMonth() !== mes - 1) return null;
    return `${y}-${dos(mes)}-${dos(d)}`;
  }
  function fmt(x: { y: number; m: number; d: number }): string {
    return `${x.y}-${dos(x.m)}-${dos(x.d)}`;
  }
}

/** "10:30", "10h30", "3 pm", "a las 4 de la tarde", "15 horas". */
export function leerHora(texto: string): string | null {
  const t = normalizar(texto);
  let h: number | null = null;
  let min = 0;
  let sufijo = '';
  let exacta = false;
  const conMinutos = t.match(/\b([01]?\d|2[0-3])h([0-5]\d)\b\s*(am|pm|a m|p m|de la manana|de la tarde|de la noche)?/);
  if (conMinutos) {
    h = Number(conMinutos[1]);
    min = Number(conMinutos[2]);
    sufijo = conMinutos[3] ?? '';
    exacta = true;
  } else {
    const conSufijo = t.match(/\b(\d{1,2})\s*(am|pm|a m|p m|de la manana|de la tarde|de la noche|horas|hrs|hs)\b/);
    const suelta = t.match(/\ba (?:las|la) (\d{1,2})\b/);
    if (conSufijo) {
      h = Number(conSufijo[1]);
      sufijo = conSufijo[2] ?? '';
    } else if (suelta) h = Number(suelta[1]);
  }
  if (h === null || h > 23 || min > 59) return null;
  if (/pm|p m|tarde|noche/.test(sufijo) && h < 12) h += 12;
  if (/am|a m|manana/.test(sufijo) && h === 12) h = 0;
  // "a las 4" sin mas: en un negocio es de la tarde. "10:30" con los minutos, tal cual.
  if (!sufijo && !exacta && h >= 1 && h <= 7) h += 12;
  return `${dos(h)}:${dos(min)}`;
}

export function leerFechaHora(texto: string, ahora = new Date(), timezone = 'America/Lima'): Lectura {
  const fecha = leerFecha(texto, ahora, timezone);
  const hora = leerHora(texto);
  if (!fecha && !hora) return { ok: false, motivo: 'no encontré una fecha ni una hora' };
  return { ok: true, valor: [fecha, hora].filter(Boolean).join(' '), extra: { fecha: fecha ?? null, hora: hora ?? null } };
}

/**
 * El instante de una fecha y hora del negocio. La zona se resuelve con Intl
 * (Lima no cambia de hora, pero otra zona si podria).
 */
export function instanteEn(fecha: string, hora: string | null, timezone = 'America/Lima'): Date | null {
  const m = fecha.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [hh, mm] = (hora && /^\d{1,2}:\d{2}$/.test(hora) ? hora : '09:00').split(':').map(Number);
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hh!, mm!);
  // Lo que marca el reloj de la zona en ese instante UTC: la diferencia es el desfase.
  try {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(utc));
    const v = (t: string) => Number(p.find((x) => x.type === t)?.value ?? '0');
    const comoLocal = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour') % 24, v('minute'));
    return new Date(utc - (comoLocal - utc));
  } catch {
    return new Date(utc);
  }
}

// ------------------------------------------------------------ direccion

const PALABRAS_DIRECCION = /\b(av|avenida|jr|jiron|calle|ca|psje|pasaje|mz|manzana|lt|lote|urb|urbanizacion|asoc|aa ?hh|asentamiento|dpto|departamento|block|edificio|condominio|residencial|cruce|esquina|altura|carretera|km|sector|etapa|int|interior|piso|nro|numero)\b/;

export function leerDireccion(texto: string, distritos: string[] = []): Lectura {
  const t = normalizar(texto);
  if (t.length < 6) return { ok: false, motivo: 'es muy corta para ser una dirección' };
  const conNumero = /\d/.test(t);
  const conPalabra = PALABRAS_DIRECCION.test(t);
  if (!conNumero && !conPalabra) return { ok: false, motivo: 'no parece una dirección (falta la calle y el número)' };
  const distrito = distritos.find((d) => t.includes(normalizar(d)));
  return { ok: true, valor: texto.trim().slice(0, 300), extra: distrito ? { distrito } : undefined };
}

// ------------------------------------------------------------ el dato de un paso

export interface OpcionesLectura {
  ahora?: Date;
  timezone?: string;
  distritos?: string[];
}

/** Lee un dato. Los adjuntos solo valen para foto, documento y captura; un texto nunca vale como foto. */
export function leerDato(dato: TipoDato, e: EntradaProceso, o: OpcionesLectura = {}): Lectura {
  const texto = (e.texto ?? '').trim();
  const adj = e.adjunto ?? null;
  switch (dato) {
    case 'ubicacion':
      if (e.ubicacion) return { ok: true, valor: `${e.ubicacion.lat},${e.ubicacion.lng}`, extra: { lat: e.ubicacion.lat, lng: e.ubicacion.lng, mapa: e.ubicacion.mapsUrl ?? `https://www.google.com/maps?q=${e.ubicacion.lat},${e.ubicacion.lng}`, fuente: e.ubicacion.fuente } };
      if (e.fueraDeZona) return { ok: false, motivo: 'la ubicación cae fuera de la zona que atendemos' };
      return { ok: false, motivo: adj ? 'mandó un adjunto en vez de la ubicación' : 'no mandó la ubicación' };
    case 'foto':
      if (adj && adj.tipo === 'image') return { ok: true, valor: 'foto', extra: { mediaId: adj.mediaId ?? null } };
      return { ok: false, motivo: adj ? 'no es una foto' : 'no mandó la foto' };
    case 'documento':
      if (adj && (adj.tipo === 'image' || adj.tipo === 'document')) return { ok: true, valor: adj.tipo === 'image' ? 'foto' : adj.nombre || 'documento', extra: { mediaId: adj.mediaId ?? null } };
      return { ok: false, motivo: adj ? 'no es un documento ni una foto' : 'no mandó el documento' };
    case 'captura_pago':
      if (adj && (adj.tipo === 'image' || adj.tipo === 'document')) return { ok: true, valor: 'captura', extra: { mediaId: adj.mediaId ?? null } };
      return { ok: false, motivo: adj ? 'no es una captura ni una foto del comprobante' : 'no mandó la captura del pago' };
    case 'documento_identidad':
      return texto ? leerDocumentoIdentidad(texto) : { ok: false, motivo: 'no escribió su documento' };
    case 'numero':
      return texto ? leerNumero(texto) : { ok: false, motivo: 'no escribió un número' };
    case 'fecha_hora':
      return texto ? leerFechaHora(texto, o.ahora, o.timezone) : { ok: false, motivo: 'no escribió una fecha ni una hora' };
    case 'direccion':
      return texto ? leerDireccion(texto, o.distritos) : { ok: false, motivo: 'no escribió su dirección' };
    case 'texto':
    default: {
      const letras = texto.replace(/[\p{Extended_Pictographic}\s.,!?¡¿]/gu, '');
      if (letras.length < 2) return { ok: false, motivo: adj ? 'mandó un adjunto en vez de escribir' : 'la respuesta está vacía' };
      return { ok: true, valor: texto.slice(0, 1000) };
    }
  }
}

// ------------------------------------------------------------ SI / NO / reprogramar

export type Decision = 'si' | 'no' | 'reprogramar';

const REPROGRAMAR = /\b(reprogram\w*|otro dia|otra fecha|otra hora|otro horario|cambiar (la |de )?(fecha|hora|cita|dia)|mover (la )?cita|posponer|postergar|aplazar|mas tarde no|no puedo ese dia|no puedo a esa hora|no puedo ese horario)\b/;

/** Lo que dice el boton, o el texto leido con el lector de confirmaciones de las entregas. */
export function leerDecision(e: EntradaProceso): { decision: Decision | null; como: string } {
  const b = e.boton ?? '';
  if (/:si$/.test(b)) return { decision: 'si', como: 'boton' };
  if (/:no$/.test(b)) return { decision: 'no', como: 'boton' };
  if (/:reprogramar$/.test(b)) return { decision: 'reprogramar', como: 'boton' };
  const texto = (e.texto ?? '').trim();
  if (!texto) return { decision: null, como: 'reglas' };
  if (REPROGRAMAR.test(normalizar(texto))) return { decision: 'reprogramar', como: 'reglas' };
  const l = leerConfirmacionConReglas(texto);
  if (l.decision === 'si') return { decision: 'si', como: 'reglas' };
  if (l.decision === 'no') return { decision: 'no', como: 'reglas' };
  if (l.decision === 'cambio') return { decision: 'reprogramar', como: 'reglas' };
  return { decision: null, como: 'reglas' };
}

// ------------------------------------------------------------ llegué / terminé / no pude

export type Avance = 'llego' | 'termino' | 'no_pudo';

const NO_PUDO = /\b(no pude|no puedo|no se pudo|no podre|no voy a poder|no estaba nadie|no habia nadie|no hay nadie|no me abrieron|no abrieron|cancelado|cancelaron|no lo hice|no la hice|no termine|no logre|imposible)\b/;
const TERMINO = /\b(termine|terminado|terminada|ya termine|acabe|ya acabe|finalice|finalizado|complete|completado|trabajo hecho|tarea hecha|hecho|ya quedo|quedo listo|resuelto|listo ya|ya esta)\b/;
const LLEGO = /\b(llegue|ya llegue|ya estoy|estoy aqui|estoy aca|estoy en el lugar|en el lugar|en sitio|en la direccion|ya estoy en)\b/;

export function leerAvance(e: EntradaProceso): { avance: Avance | null; como: string } {
  const b = e.boton ?? '';
  if (/:llego$/.test(b)) return { avance: 'llego', como: 'boton' };
  if (/:termino$/.test(b)) return { avance: 'termino', como: 'boton' };
  if (/:no_pudo$/.test(b)) return { avance: 'no_pudo', como: 'boton' };
  const texto = (e.texto ?? '').trim();
  if (!texto) return { avance: null, como: 'reglas' };
  const t = normalizar(texto);
  const entregado = leerEntregadoConReglas(texto);
  if (NO_PUDO.test(t) || entregado.noEntregado) return { avance: 'no_pudo', como: 'reglas' };
  if (TERMINO.test(t) || entregado.entregado) return { avance: 'termino', como: 'reglas' };
  if (LLEGO.test(t) || leerMotorizadoCorta(texto).cerca) return { avance: 'llego', como: 'reglas' };
  return { avance: null, como: 'reglas' };
}
