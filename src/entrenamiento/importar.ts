/**
 * Importar lecciones en masa: de un Excel, un CSV, un JSON, un chat de
 * WhatsApp exportado o texto pegado.
 *
 * Se entiende lo que la gente tiene a mano, sin pedir un formato:
 *  - Una tabla (xlsx, csv, tsv o pegada de Excel) con cabecera
 *    (pregunta | respuesta | tema) o sin ella (dos columnas = pregunta y
 *    respuesta; una = datos sueltos).
 *  - Un JSON: una lista de objetos con esas mismas claves (o en ingles).
 *  - Un chat exportado de WhatsApp ("Exportar chat" del telefono): se
 *    aprende igual que de las conversaciones del sistema, sabiendo cual de
 *    los dos es el negocio.
 *  - Un dialogo escrito a mano: lineas "Cliente: ..." y "Tú: ...".
 *  - Lineas sueltas "pregunta => respuesta" o "pregunta | respuesta"; y una
 *    linea sin separador es un dato.
 */

import type { TipoLeccion } from './repo.js';
import { paresDeConversacion } from './aprender.js';
import { leerXlsx } from './xlsx.js';
import { normalizar } from './texto.js';

export interface FilaImportada {
  tipo: TipoLeccion;
  pregunta: string | null;
  respuesta: string;
  tema: string | null;
  mala: string | null;
}

export interface Lectura {
  filas: FilaImportada[];
  /** Como se entendio el fichero, para decirlo en pantalla. */
  formato: 'excel' | 'tabla' | 'json' | 'whatsapp' | 'dialogo' | 'lineas' | 'vacio';
  descartadas: Array<{ linea: number; texto: string; motivo: string }>;
  avisos: string[];
  /** En un chat exportado: quienes hablan, y a quien se tomo como negocio. */
  autores?: string[];
  negocio?: string;
}

export interface EntradaImportacion {
  texto?: string;
  /** El fichero tal cual (para .xlsx). */
  datos?: Buffer;
  nombre?: string;
  /** En un chat exportado: como aparece el negocio. */
  yoSoy?: string;
  temaPorDefecto?: string | null;
}

const ALIAS: Record<keyof FilaImportada, string[]> = {
  tipo: ['tipo', 'type', 'clase'],
  pregunta: ['pregunta', 'cliente', 'pregunta del cliente', 'mensaje', 'mensaje del cliente', 'question', 'q', 'input', 'consulta', 'dice el cliente', 'titulo', 'título'],
  respuesta: ['respuesta', 'contestacion', 'contestación', 'respuesta del negocio', 'answer', 'a', 'output', 'tu', 'tú', 'negocio', 'asistente', 'dato', 'regla', 'texto', 'hecho'],
  tema: ['tema', 'categoria', 'categoría', 'etiqueta', 'tag', 'topic', 'grupo', 'seccion', 'sección'],
  mala: ['mala', 'incorrecta', 'respuesta mala', 'respuesta incorrecta', 'no decir', 'error', 'lo que dijo'],
};

function limpiar(v: unknown): string {
  return String(v ?? '')
    .replace(/\r/g, '')
    .replace(/^﻿/, '')
    .trim();
}

function tipoDe(v: string, pregunta: string, respuesta: string): TipoLeccion {
  const n = normalizar(v);
  if (n.startsWith('regla') || n === 'rule' || n === 'instruccion') return 'regla';
  if (n.startsWith('dato') || n === 'fact' || n === 'hecho') return 'dato';
  if (n.startsWith('ejemplo') || n === 'example' || n === 'qa') return 'ejemplo';
  return pregunta && respuesta ? 'ejemplo' : 'dato';
}

/** Una fila ya con sus campos: se valida y se normaliza, o se descarta con motivo. */
function armar(campos: Partial<Record<keyof FilaImportada, string>>, temaPorDefecto: string | null | undefined): { fila?: FilaImportada; motivo?: string } {
  const pregunta = limpiar(campos.pregunta);
  let respuesta = limpiar(campos.respuesta);
  // Una "pregunta" sin respuesta que no pregunta nada es un dato suelto
  // ("Horario de 9 a 19"): el dato es la pregunta. Una pregunta de verdad
  // sin respuesta no vale.
  if (!respuesta && pregunta && !/[?¿]/.test(pregunta) && (!campos.tipo || /dato|regla/i.test(campos.tipo))) {
    respuesta = pregunta;
    return armar({ ...campos, pregunta: '', respuesta }, temaPorDefecto);
  }
  if (!respuesta) return { motivo: 'sin respuesta' };
  if (respuesta.length < 2) return { motivo: 'respuesta demasiado corta' };
  if (respuesta.length > 4000) return { motivo: 'respuesta demasiado larga (más de 4000 caracteres)' };
  if (pregunta.length > 1000) return { motivo: 'pregunta demasiado larga (más de 1000 caracteres)' };
  const tipo = tipoDe(limpiar(campos.tipo), pregunta, respuesta);
  if (tipo === 'ejemplo' && !pregunta) return { motivo: 'un ejemplo necesita la pregunta del cliente' };
  const tema = limpiar(campos.tema) || temaPorDefecto || null;
  const mala = limpiar(campos.mala) || null;
  return { fila: { tipo, pregunta: pregunta || null, respuesta, tema: tema ? tema.slice(0, 60) : null, mala } };
}

// ------------------------------------------------------------------ tablas

function separadorDe(linea: string): string {
  let mejor = ',';
  let mejorCuenta = 0;
  for (const sep of ['\t', ';', ',', '|']) {
    const cuenta = linea.split(sep).length - 1;
    if (cuenta > mejorCuenta) {
      mejor = sep;
      mejorCuenta = cuenta;
    }
  }
  return mejor;
}

/** Parte una linea respetando las comillas dobles de CSV. */
function partir(linea: string, sep: string): string[] {
  const celdas: string[] = [];
  let actual = '';
  let entreComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      if (entreComillas && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else entreComillas = !entreComillas;
      continue;
    }
    if (c === sep && !entreComillas) {
      celdas.push(actual);
      actual = '';
      continue;
    }
    actual += c;
  }
  celdas.push(actual);
  return celdas.map((c) => c.trim());
}

/** Un CSV puede llevar saltos de linea dentro de comillas: se juntan. */
function registrosCsv(texto: string): string[] {
  const salida: string[] = [];
  let actual = '';
  let entreComillas = false;
  for (const linea of texto.split('\n')) {
    actual = actual ? `${actual}\n${linea}` : linea;
    for (const c of linea) if (c === '"') entreComillas = !entreComillas;
    if (!entreComillas) {
      if (actual.trim()) salida.push(actual);
      actual = '';
    }
  }
  if (actual.trim()) salida.push(actual);
  return salida;
}

function columnaDe(nombre: string): keyof FilaImportada | null {
  const n = normalizar(nombre);
  for (const [campo, alias] of Object.entries(ALIAS) as Array<[keyof FilaImportada, string[]]>) {
    if (alias.some((a) => normalizar(a) === n)) return campo;
  }
  return null;
}

export function filasDeTabla(filas: string[][], temaPorDefecto: string | null | undefined, lectura: Lectura): void {
  const limpias = filas.map((f) => f.map(limpiar)).filter((f) => f.some(Boolean));
  if (!limpias.length) return;
  const primera = limpias[0]!;
  const mapa = primera.map(columnaDe);
  const conCabecera = mapa.filter(Boolean).length >= Math.min(2, primera.filter(Boolean).length) && (mapa.includes('respuesta') || mapa.includes('pregunta'));
  let desde = 0;
  let posiciones: Array<keyof FilaImportada | null>;
  if (conCabecera) {
    posiciones = mapa;
    desde = 1;
  } else {
    const ancho = Math.max(...limpias.map((f) => f.filter(Boolean).length));
    posiciones = ancho >= 3 ? ['pregunta', 'respuesta', 'tema'] : ancho === 2 ? ['pregunta', 'respuesta'] : ['respuesta'];
    lectura.avisos.push(ancho >= 2 ? 'Sin cabecera: se tomó la primera columna como la pregunta y la segunda como la respuesta.' : 'Sin cabecera y una sola columna: cada línea se guarda como un dato.');
  }
  for (let i = desde; i < limpias.length; i++) {
    const fila = limpias[i]!;
    const campos: Partial<Record<keyof FilaImportada, string>> = {};
    posiciones.forEach((campo, k) => {
      if (campo && fila[k] !== undefined && fila[k] !== '') campos[campo] = fila[k];
    });
    const r = armar(campos, temaPorDefecto);
    if (r.fila) lectura.filas.push(r.fila);
    else lectura.descartadas.push({ linea: i + 1, texto: fila.filter(Boolean).join(' | ').slice(0, 160), motivo: r.motivo! });
  }
}

// ------------------------------------------------------------------- json

function deJson(texto: string, temaPorDefecto: string | null | undefined, lectura: Lectura): boolean {
  let datos: unknown;
  try {
    datos = JSON.parse(texto);
  } catch {
    return false;
  }
  let lista: unknown[] | null = null;
  if (Array.isArray(datos)) lista = datos;
  else if (datos && typeof datos === 'object') {
    for (const clave of ['lecciones', 'items', 'datos', 'data', 'ejemplos', 'rows', 'filas']) {
      const v = (datos as Record<string, unknown>)[clave];
      if (Array.isArray(v)) {
        lista = v;
        break;
      }
    }
  }
  if (!lista) {
    lectura.avisos.push('El JSON no es una lista de lecciones: se esperaba [{"pregunta": ..., "respuesta": ...}, ...].');
    return true;
  }
  lista.forEach((item, i) => {
    if (typeof item === 'string') {
      const r = armar({ respuesta: item }, temaPorDefecto);
      if (r.fila) lectura.filas.push(r.fila);
      else lectura.descartadas.push({ linea: i + 1, texto: item.slice(0, 160), motivo: r.motivo! });
      return;
    }
    if (Array.isArray(item)) {
      const r = armar({ pregunta: String(item[0] ?? ''), respuesta: String(item[1] ?? ''), tema: String(item[2] ?? '') }, temaPorDefecto);
      if (r.fila) lectura.filas.push(r.fila);
      else lectura.descartadas.push({ linea: i + 1, texto: item.join(' | ').slice(0, 160), motivo: r.motivo! });
      return;
    }
    if (!item || typeof item !== 'object') {
      lectura.descartadas.push({ linea: i + 1, texto: String(item).slice(0, 160), motivo: 'no es una lección' });
      return;
    }
    const campos: Partial<Record<keyof FilaImportada, string>> = {};
    for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
      const campo = columnaDe(k);
      if (campo && v !== null && v !== undefined) campos[campo] = String(v);
    }
    const r = armar(campos, temaPorDefecto);
    if (r.fila) lectura.filas.push(r.fila);
    else lectura.descartadas.push({ linea: i + 1, texto: JSON.stringify(item).slice(0, 160), motivo: r.motivo! });
  });
  return true;
}

// -------------------------------------------------------------- whatsapp

/**
 * Una linea de un chat exportado de WhatsApp. Segun el telefono y el idioma:
 *   12/3/26, 10:15 - Juan: hola
 *   [12/03/2026, 10:15:22] Juan: hola
 *   12/3/26 10:15 a. m. - Juan: hola
 */
const LINEA_WA = /^\[?(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?\s?m\.?)?\]?\s*[-–]?\s*([^:]{1,60}?):\s(.*)$/i;

interface LineaWa {
  cuando: Date;
  autor: string;
  texto: string;
}

function leerLineasWa(texto: string): LineaWa[] {
  const salida: LineaWa[] = [];
  for (const cruda of texto.split('\n')) {
    const linea = cruda.replace(/^‎|‎/g, '').trimEnd();
    const m = LINEA_WA.exec(linea);
    if (!m) {
      // Continuacion del mensaje anterior (un salto de linea dentro del texto).
      if (salida.length && linea.trim()) salida[salida.length - 1]!.texto += `\n${linea.trim()}`;
      continue;
    }
    const [, d, mes, a, h, mi, s, ampm, autor, cuerpo] = m;
    let hora = Number(h);
    if (ampm && /p/i.test(ampm) && hora < 12) hora += 12;
    if (ampm && /a/i.test(ampm) && hora === 12) hora = 0;
    const anio = a!.length === 2 ? 2000 + Number(a) : Number(a);
    const cuando = new Date(anio, Number(mes) - 1, Number(d), hora, Number(mi), Number(s ?? 0));
    salida.push({ cuando, autor: autor!.trim(), texto: cuerpo!.trim() });
  }
  return salida;
}

function pareceExportadoWa(texto: string): boolean {
  const lineas = texto.split('\n').slice(0, 40);
  return lineas.filter((l) => LINEA_WA.test(l.replace(/‎/g, '').trimEnd())).length >= 3;
}

function deWhatsApp(texto: string, yoSoy: string | undefined, temaPorDefecto: string | null | undefined, lectura: Lectura): void {
  const lineas = leerLineasWa(texto);
  const cuenta = new Map<string, number>();
  for (const l of lineas) cuenta.set(l.autor, (cuenta.get(l.autor) ?? 0) + 1);
  const autores = [...cuenta.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a);
  lectura.autores = autores;
  if (autores.length < 2) {
    lectura.avisos.push('En el chat exportado solo habla una persona: no hay preguntas y respuestas que aprender.');
    return;
  }
  const quiero = yoSoy ? normalizar(yoSoy) : '';
  const pedido = quiero ? (autores.find((a) => normalizar(a) === quiero) ?? autores.find((a) => normalizar(a).includes(quiero))) : undefined;
  const negocio = pedido ?? autores.find((a) => /^(tu|tú|you|yo)$/i.test(a.trim())) ?? autores[0]!;
  lectura.negocio = negocio;
  if (!yoSoy) lectura.avisos.push(`Se tomó a "${negocio}" como el negocio (es quien más escribe). Si no es así, escribe tu nombre tal como aparece en el chat.`);
  else if (normalizar(negocio) !== quiero && !normalizar(negocio).includes(quiero)) lectura.avisos.push(`No aparece nadie llamado "${yoSoy}": se tomó a "${negocio}" como el negocio.`);
  const mensajes = lineas.map((l) => ({
    direction: (l.autor === negocio ? 'out' : 'in') as 'in' | 'out',
    body: l.texto,
    kind: 'text',
    createdAt: l.cuando,
    origen: null,
  }));
  for (const par of paresDeConversacion(mensajes)) {
    const r = armar({ pregunta: par.pregunta, respuesta: par.respuesta }, temaPorDefecto);
    if (r.fila) lectura.filas.push(r.fila);
  }
  const omitidos = mensajes.filter((m) => /<multimedia omitido>|<media omitted>|imagen omitida|image omitted/i.test(m.body ?? '')).length;
  if (omitidos) lectura.avisos.push(`${omitidos} mensaje${omitidos === 1 ? '' : 's'} con fotos o audios no se pueden aprender (solo el texto).`);
}

// --------------------------------------------------------------- dialogos

const ROL_CLIENTE = /^(cliente|c|pregunta|p|q|user|usuario|customer)\s*[:：]\s*(.*)$/i;
const ROL_NEGOCIO = /^(tu|tú|respuesta|r|a|negocio|asistente|bot|ia|tienda|vendedor|answer|assistant)\s*[:：]\s*(.*)$/i;

function pareceDialogo(texto: string): boolean {
  const lineas = texto.split('\n').map((l) => l.trim()).filter(Boolean);
  const c = lineas.filter((l) => ROL_CLIENTE.test(l)).length;
  const n = lineas.filter((l) => ROL_NEGOCIO.test(l)).length;
  return c >= 1 && n >= 1 && c + n >= lineas.length * 0.5;
}

function deDialogo(texto: string, temaPorDefecto: string | null | undefined, lectura: Lectura): void {
  let pregunta: string[] = [];
  let respuesta: string[] = [];
  let tema: string | null = null;
  const cerrar = () => {
    if (pregunta.length && respuesta.length) {
      const r = armar({ pregunta: pregunta.join('\n'), respuesta: respuesta.join('\n'), tema: tema ?? '' }, temaPorDefecto);
      if (r.fila) lectura.filas.push(r.fila);
    }
    pregunta = [];
    respuesta = [];
  };
  let ultimo: 'c' | 'n' | null = null;
  texto.split('\n').forEach((cruda) => {
    const linea = cruda.trim();
    if (!linea) return;
    const t = /^(tema|#)\s*[:：]?\s*(.+)$/i.exec(linea);
    if (t && !ROL_CLIENTE.test(linea) && !ROL_NEGOCIO.test(linea)) {
      cerrar();
      tema = t[2]!.trim();
      ultimo = null;
      return;
    }
    const c = ROL_CLIENTE.exec(linea);
    const n = ROL_NEGOCIO.exec(linea);
    if (c) {
      if (ultimo === 'n') cerrar();
      pregunta.push(c[2]!.trim());
      ultimo = 'c';
    } else if (n) {
      respuesta.push(n[2]!.trim());
      ultimo = 'n';
    } else if (ultimo === 'c') pregunta.push(linea);
    else if (ultimo === 'n') respuesta.push(linea);
  });
  cerrar();
}

// ----------------------------------------------------------------- lineas

function deLineas(texto: string, temaPorDefecto: string | null | undefined, lectura: Lectura): void {
  texto.split('\n').forEach((cruda, i) => {
    const linea = cruda.trim();
    if (!linea) return;
    const m = /^(.+?)\s*(?:=>|->|→|\|)\s*(.+)$/.exec(linea);
    const r = m ? armar({ pregunta: m[1], respuesta: m[2] }, temaPorDefecto) : armar({ respuesta: linea }, temaPorDefecto);
    if (r.fila) lectura.filas.push(r.fila);
    else lectura.descartadas.push({ linea: i + 1, texto: linea.slice(0, 160), motivo: r.motivo! });
  });
}

// ------------------------------------------------------------------ entrada

export function leerImportacion(entrada: EntradaImportacion): Lectura {
  const lectura: Lectura = { filas: [], formato: 'vacio', descartadas: [], avisos: [] };
  const nombre = (entrada.nombre ?? '').toLowerCase();

  if (entrada.datos && (nombre.endsWith('.xlsx') || nombre.endsWith('.xlsm') || (entrada.datos[0] === 0x50 && entrada.datos[1] === 0x4b))) {
    lectura.formato = 'excel';
    filasDeTabla(leerXlsx(entrada.datos), entrada.temaPorDefecto, lectura);
    return lectura;
  }

  const texto = (entrada.texto ?? entrada.datos?.toString('utf8') ?? '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  if (!texto.trim()) return lectura;

  const recortado = texto.trim();
  if ((recortado.startsWith('[') || recortado.startsWith('{')) && deJson(recortado, entrada.temaPorDefecto, lectura)) {
    lectura.formato = 'json';
    return lectura;
  }
  if (pareceExportadoWa(texto)) {
    lectura.formato = 'whatsapp';
    deWhatsApp(texto, entrada.yoSoy, entrada.temaPorDefecto, lectura);
    return lectura;
  }
  if (pareceDialogo(texto)) {
    lectura.formato = 'dialogo';
    deDialogo(texto, entrada.temaPorDefecto, lectura);
    return lectura;
  }
  const lineas = texto.split('\n').filter((l) => l.trim());
  const sep = separadorDe(lineas[0] ?? '');
  const conSep = lineas.filter((l) => l.includes(sep)).length;
  // Con tabuladores (pegado de Excel) o punto y coma es una tabla seguro; con
  // comas solo si la primera linea es una cabecera conocida, porque una
  // frase normal tambien lleva comas.
  const cabeceraConocida = partir(lineas[0] ?? '', sep).map(columnaDe).some((c) => c === 'respuesta' || c === 'pregunta');
  const esTabla =
    nombre.endsWith('.csv') ||
    nombre.endsWith('.tsv') ||
    (sep === '\t' && conSep >= 1) ||
    (sep === ';' && conSep >= lineas.length * 0.8) ||
    (sep === ',' && cabeceraConocida && conSep >= lineas.length * 0.8);
  if (esTabla) {
    lectura.formato = 'tabla';
    filasDeTabla(registrosCsv(texto).map((r) => partir(r, sep)), entrada.temaPorDefecto, lectura);
    return lectura;
  }
  lectura.formato = 'lineas';
  deLineas(texto, entrada.temaPorDefecto, lectura);
  return lectura;
}
