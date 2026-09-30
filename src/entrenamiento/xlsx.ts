/**
 * Un lector minimo de .xlsx, sin dependencias.
 *
 * Un .xlsx es un zip con XML dentro. Para importar una hoja de lecciones
 * (pregunta | respuesta | tema) basta con abrir el zip (directorio central +
 * inflate), leer las cadenas compartidas y recorrer las celdas de la primera
 * hoja. No entiende formulas ni estilos: devuelve el texto tal como se ve.
 */

import { inflateRawSync } from 'node:zlib';

/** Los ficheros del zip por nombre. Solo los que hacen falta se descomprimen. */
function abrirZip(datos: Buffer): Map<string, () => Buffer> {
  const salida = new Map<string, () => Buffer>();
  // El final del directorio central esta en los ultimos 64 KB (por el comentario).
  let eocd = -1;
  for (let i = datos.length - 22; i >= Math.max(0, datos.length - 65_557); i--) {
    if (datos.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('no es un fichero zip (o esta truncado)');
  const entradas = datos.readUInt16LE(eocd + 10);
  let pos = datos.readUInt32LE(eocd + 16);
  for (let n = 0; n < entradas; n++) {
    if (pos + 46 > datos.length || datos.readUInt32LE(pos) !== 0x02014b50) break;
    const metodo = datos.readUInt16LE(pos + 10);
    const tamanoComprimido = datos.readUInt32LE(pos + 20);
    const largoNombre = datos.readUInt16LE(pos + 28);
    const largoExtra = datos.readUInt16LE(pos + 30);
    const largoComentario = datos.readUInt16LE(pos + 32);
    const offsetLocal = datos.readUInt32LE(pos + 42);
    const nombre = datos.subarray(pos + 46, pos + 46 + largoNombre).toString('utf8');
    salida.set(nombre, () => {
      if (datos.readUInt32LE(offsetLocal) !== 0x04034b50) throw new Error(`entrada corrupta: ${nombre}`);
      const ln = datos.readUInt16LE(offsetLocal + 26);
      const le = datos.readUInt16LE(offsetLocal + 28);
      const inicio = offsetLocal + 30 + ln + le;
      const cuerpo = datos.subarray(inicio, inicio + tamanoComprimido);
      if (metodo === 0) return Buffer.from(cuerpo);
      if (metodo === 8) return inflateRawSync(cuerpo);
      throw new Error(`compresion no soportada (${metodo}) en ${nombre}`);
    });
    pos += 46 + largoNombre + largoExtra + largoComentario;
  }
  return salida;
}

function desentidad(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/** El texto de un <si> o un <is>: todos sus <t>, seguidos. */
function textoDe(xml: string): string {
  return desentidad([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]!).join(''));
}

function columna(ref: string): number {
  let n = 0;
  for (const c of ref.replace(/\d+/g, '')) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Las filas de la primera hoja, como texto. Las celdas vacias van como "";
 * las filas del todo vacias no se devuelven.
 */
export function leerXlsx(datos: Buffer): string[][] {
  const zip = abrirZip(datos);
  const leer = (nombre: string) => zip.get(nombre)?.().toString('utf8') ?? '';

  const compartidas: string[] = [];
  const ss = leer('xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) compartidas.push(textoDe(m[1]!));

  // La primera hoja segun el libro; si no se entiende, sheet1.xml.
  let hoja = 'xl/worksheets/sheet1.xml';
  const libro = leer('xl/workbook.xml');
  const rels = leer('xl/_rels/workbook.xml.rels');
  const primera = libro.match(/<sheet\s[^>]*r:id="([^"]+)"/)?.[1];
  if (primera && rels) {
    const destino = rels.match(new RegExp(`<Relationship\\s[^>]*Id="${primera}"[^>]*Target="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`<Relationship\\s[^>]*Target="([^"]+)"[^>]*Id="${primera}"`))?.[1];
    if (destino) hoja = destino.startsWith('/') ? destino.slice(1) : `xl/${destino.replace(/^\.?\//, '')}`;
  }
  if (!zip.has(hoja)) {
    const otra = [...zip.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
    if (!otra) throw new Error('el .xlsx no tiene hojas');
    hoja = otra;
  }

  const filas: string[][] = [];
  const xml = leer(hoja);
  for (const fila of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const celdas: string[] = [];
    for (const c of fila[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1] ?? '';
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1] ?? '';
      const tipo = attrs.match(/\bt="([^"]+)"/)?.[1] ?? '';
      const cuerpo = c[2] ?? '';
      let valor = '';
      if (tipo === 's') {
        const i = Number(cuerpo.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '-1');
        valor = compartidas[i] ?? '';
      } else if (tipo === 'inlineStr') {
        valor = textoDe(cuerpo);
      } else if (tipo === 'b') {
        valor = /<v>1<\/v>/.test(cuerpo) ? 'si' : 'no';
      } else {
        valor = desentidad(cuerpo.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
      }
      const col = ref ? columna(ref) : celdas.length;
      while (celdas.length < col) celdas.push('');
      celdas[col] = valor.trim();
    }
    if (celdas.some((v) => v !== '')) filas.push(celdas);
  }
  return filas;
}
