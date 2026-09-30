/**
 * Leer un chat exportado desde el telefono ("Exportar chat" de WhatsApp).
 *
 * Para las conversaciones que pasaron por el celular del negocio antes de
 * conectar el sistema: se exportan sin archivos, se pegan aqui y quedan como
 * una conversacion guardada mas, con su resumen, sus etiquetas y su busqueda.
 *
 * El formato cambia con el telefono y el idioma, asi que se aceptan las
 * cuatro formas habituales:
 *   12/3/26, 10:15 - Juan: hola                 (Android)
 *   12/03/2026, 10:15 - Juan: hola
 *   [12/03/26, 10:15:22] Juan: hola             (iPhone)
 *   12/3/26 10:15 a. m. - Juan: hola            (12 horas)
 * Una linea sin fecha es la continuacion del mensaje anterior. Las horas se
 * leen como hora de Lima, que es la del telefono del negocio.
 */

import type { Message } from '../db/messages.js';

const LINEA = /^\[?(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?\s?m\.?)?\]?\s*[-–]?\s*([^:]{1,60}?):\s(.*)$/i;

/** Lo que WhatsApp escribe en vez del fichero cuando se exporta "sin archivos". */
const MULTIMEDIA = /^<(multimedia omitido|media omitted|archivo omitido|imagen omitida|image omitted|audio omitido|audio omitted|video omitido|video omitted|documento omitido|document omitted|sticker omitido|sticker omitted|gif omitido|gif omitted)>$/i;
const TIPO_MULTIMEDIA: Array<[RegExp, Message['kind']]> = [
  [/audio/i, 'audio'],
  [/video/i, 'video'],
  [/documento|document/i, 'document'],
  [/sticker/i, 'sticker'],
];

/** Las lineas de sistema que no son de nadie. */
const RUIDO = /cifrados? de extremo a extremo|end-to-end encrypted|creó el grupo|created group|cambió el asunto|changed the subject|se unió|joined using|añadió a|added|salió del grupo|left$/i;

export interface LineaChat {
  cuando: Date;
  autor: string;
  texto: string;
}

export interface ChatLeido {
  /** Los mensajes ya con direccion, en orden. */
  mensajes: Array<Pick<Message, 'direction' | 'kind' | 'body' | 'createdAt'>>;
  /** Quienes hablan, del que mas escribe al que menos. */
  autores: string[];
  /** A quien se tomo como cliente y como negocio. */
  cliente: string | null;
  negocio: string | null;
  desde: Date | null;
  hasta: Date | null;
  /** Lineas que no se entendieron (fuera del formato y sin mensaje anterior al que pegarse). */
  descartadas: number;
  avisos: string[];
}

const llano = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/** Las lineas con fecha, autor y texto; las de continuacion se pegan a la anterior. */
export function leerLineasDeWhatsApp(texto: string): { lineas: LineaChat[]; descartadas: number } {
  const lineas: LineaChat[] = [];
  let descartadas = 0;
  for (const cruda of texto.replace(/\r/g, '').split('\n')) {
    // WhatsApp mete marcas invisibles de direccion de texto delante de algunas lineas.
    const linea = cruda.replace(/[‎‏‪-‮]/g, '').trimEnd();
    if (!linea.trim()) continue;
    const m = LINEA.exec(linea);
    if (!m) {
      if (lineas.length) lineas[lineas.length - 1]!.texto += `\n${linea.trim()}`;
      else descartadas++;
      continue;
    }
    const [, d, mes, a, h, mi, s, ampm, autor, cuerpo] = m;
    let hora = Number(h);
    if (ampm && /p/i.test(ampm) && hora < 12) hora += 12;
    if (ampm && /a/i.test(ampm) && hora === 12) hora = 0;
    const anio = a!.length === 2 ? 2000 + Number(a) : Number(a);
    // Hora de Lima (UTC-5, sin cambios de horario).
    const cuando = new Date(Date.UTC(anio, Number(mes) - 1, Number(d), hora + 5, Number(mi), Number(s ?? 0)));
    if (Number.isNaN(cuando.getTime())) {
      descartadas++;
      continue;
    }
    lineas.push({ cuando, autor: autor!.trim(), texto: cuerpo!.trim() });
  }
  return { lineas, descartadas };
}

export interface OpcionesLectura {
  /** El nombre del cliente tal como sale en el chat (si se sabe). */
  nombreCliente?: string | null;
  /** El nombre del negocio (tal como sale en el chat, o el del sistema). */
  nombreNegocio?: string | null;
}

/**
 * Convierte el texto exportado en mensajes con direccion.
 *
 * Quien es el cliente: el que se llama como `nombreCliente`; si no, el que
 * NO se llama como el negocio; si tampoco, el que mas escribe (en un chat
 * de soporte el cliente suele preguntar mas de lo que el negocio contesta).
 */
export function leerChatDeWhatsApp(texto: string, opts: OpcionesLectura = {}): ChatLeido {
  const { lineas: crudas, descartadas } = leerLineasDeWhatsApp(texto);
  const avisos: string[] = [];
  const lineas = crudas.filter((l) => !RUIDO.test(l.texto) || l.texto.length > 160);

  const cuenta = new Map<string, number>();
  for (const l of lineas) cuenta.set(l.autor, (cuenta.get(l.autor) ?? 0) + 1);
  const autores = [...cuenta.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a);

  const buscar = (nombre: string | null | undefined): string | undefined => {
    const q = nombre ? llano(nombre) : '';
    if (!q) return undefined;
    return autores.find((a) => llano(a) === q) ?? autores.find((a) => llano(a).includes(q) || q.includes(llano(a)));
  };

  let cliente = buscar(opts.nombreCliente) ?? null;
  const negocioDicho = buscar(opts.nombreNegocio) ?? autores.find((a) => /^(tu|tú|you|yo)$/i.test(a)) ?? null;
  if (!cliente && negocioDicho) cliente = autores.find((a) => a !== negocioDicho) ?? null;
  if (!cliente) cliente = autores[0] ?? null;
  const negocio = negocioDicho ?? autores.find((a) => a !== cliente) ?? null;

  if (autores.length > 2) avisos.push(`En el chat hablan ${autores.length} personas: todo lo que no escribió ${negocio ?? 'el negocio'} se tomó como del cliente.`);
  if (autores.length === 1) avisos.push('En el chat solo escribe una persona.');
  if (opts.nombreCliente && !buscar(opts.nombreCliente)) avisos.push(`No aparece nadie llamado "${opts.nombreCliente}": se tomó a "${cliente ?? '?'}" como el cliente.`);

  const mensajes = lineas.map((l) => {
    const direction: 'in' | 'out' = negocio && l.autor === negocio ? 'out' : 'in';
    const multimedia = MULTIMEDIA.exec(l.texto);
    if (multimedia) {
      const kind = TIPO_MULTIMEDIA.find(([re]) => re.test(multimedia[1]!))?.[1] ?? 'image';
      return { direction, kind, body: null, createdAt: l.cuando };
    }
    return { direction, kind: 'text' as Message['kind'], body: l.texto, createdAt: l.cuando };
  });

  return {
    mensajes,
    autores,
    cliente,
    negocio,
    desde: mensajes[0]?.createdAt ?? null,
    hasta: mensajes[mensajes.length - 1]?.createdAt ?? null,
    descartadas,
    avisos,
  };
}
