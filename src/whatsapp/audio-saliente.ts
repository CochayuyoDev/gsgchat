/**
 * El audio que sale: dejarlo en un formato que WhatsApp entregue de verdad.
 *
 * Chrome y Edge solo graban en webm, y una nota de voz de WhatsApp es ogg/opus:
 * con otro contenedor, el mensaje sale pero al cliente no le aparece o no le
 * suena. El sonido ya viene en opus, asi que no hace falta recodificar ni
 * instalar ffmpeg: basta con sacar los paquetes del webm y meterlos en un ogg.
 */

const ID_SEGMENT = 0x18538067;
const ID_TRACKS = 0x1654ae6b;
const ID_TRACK_ENTRY = 0xae;
const ID_TRACK_NUMBER = 0xd7;
const ID_CODEC_ID = 0x86;
const ID_CODEC_PRIVATE = 0x63a2;
const ID_CLUSTER = 0x1f43b675;
const ID_SIMPLE_BLOCK = 0xa3;
const ID_BLOCK_GROUP = 0xa0;
const ID_BLOCK = 0xa1;

/** Los contenedores en los que se entra; el resto de elementos se salta entero. */
const SE_ENTRA = new Set([ID_SEGMENT, ID_TRACKS, ID_TRACK_ENTRY, ID_CLUSTER, ID_BLOCK_GROUP]);

const FIRMA_WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const PAQUETES_POR_PAGINA = 50;
const MAX_SEGMENTOS = 255;
const SERIAL_OGG = 0x47534763; // "GSGc": con un solo flujo por fichero, vale cualquiera.

interface Pista {
  numero?: number;
  codec?: string;
  privado?: Buffer;
}

/** Un numero de tamano variable de EBML. `valor` null es el "tamano desconocido" de un directo. */
function leerVint(buf: Buffer, pos: number, conMarca: boolean): { valor: number | null; largo: number } | null {
  if (pos >= buf.length) return null;
  const primero = buf[pos]!;
  let largo = 1;
  while (largo <= 8 && !(primero & (0x80 >> (largo - 1)))) largo++;
  if (largo > 8 || pos + largo > buf.length) return null;

  let valor = conMarca ? primero : primero & (0xff >> largo);
  let todoUnos = (primero & (0xff >> largo)) === 0xff >> largo;
  for (let i = 1; i < largo; i++) {
    const b = buf[pos + i]!;
    if (b !== 0xff) todoUnos = false;
    valor = valor * 256 + b;
  }
  return { valor: !conMarca && todoUnos ? null : valor, largo };
}

/** Lo que dura un paquete opus, en muestras a 48 kHz (RFC 6716, seccion 3.1). */
function muestrasDelPaquete(paquete: Buffer): number {
  const toc = paquete[0] ?? 0;
  const config = toc >> 3;
  const porTrama =
    config < 12 ? [480, 960, 1920, 2880][config & 3]!
    : config < 16 ? [480, 960][config & 1]!
    : [120, 240, 480, 960][config & 3]!;
  const codigo = toc & 3;
  const tramas = codigo === 0 ? 1 : codigo === 3 ? (paquete[1] ?? 0) & 0x3f : 2;
  return porTrama * tramas;
}

let tablaCrc: Uint32Array | null = null;

/** El CRC de una pagina ogg: polinomio 0x04C11DB7, sin reflejar y sin xor final. */
function crcOgg(datos: Buffer): number {
  if (!tablaCrc) {
    tablaCrc = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let r = i << 24;
      for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
      tablaCrc[i] = r >>> 0;
    }
  }
  let crc = 0;
  for (const byte of datos) crc = ((crc << 8) ^ tablaCrc[((crc >>> 24) ^ byte) & 0xff]!) >>> 0;
  return crc;
}

function paginaOgg(paquetes: Buffer[], flags: number, granulo: bigint, secuencia: number): Buffer {
  const segmentos: number[] = [];
  for (const paquete of paquetes) {
    for (let resto = paquete.length; ; resto -= 255) {
      if (resto < 255) { segmentos.push(resto); break; }
      segmentos.push(255);
    }
  }
  const cabecera = Buffer.alloc(27 + segmentos.length);
  cabecera.write('OggS', 0, 'latin1');
  cabecera[5] = flags;
  cabecera.writeBigInt64LE(granulo, 6);
  cabecera.writeUInt32LE(SERIAL_OGG, 14);
  cabecera.writeUInt32LE(secuencia, 18);
  cabecera[26] = segmentos.length;
  segmentos.forEach((s, i) => { cabecera[27 + i] = s; });
  const pagina = Buffer.concat([cabecera, ...paquetes]);
  pagina.writeUInt32LE(crcOgg(pagina), 22);
  return pagina;
}

function etiquetasOpus(): Buffer {
  const vendedor = Buffer.from('GSGchat', 'latin1');
  const largo = Buffer.alloc(4);
  largo.writeUInt32LE(vendedor.length);
  return Buffer.concat([Buffer.from('OpusTags', 'latin1'), largo, vendedor, Buffer.alloc(4)]);
}

/** Cuantos segmentos ocupa un paquete en la tabla de la pagina. */
function segmentosDe(paquete: Buffer): number {
  return Math.floor(paquete.length / 255) + 1;
}

/**
 * De webm/opus a ogg/opus, sin tocar el sonido. Devuelve null si no es un webm
 * con opus que se pueda leer: quien llama decide como decirlo.
 */
export function webmOpusAOgg(webm: Buffer): Buffer | null {
  const pistas: Pista[] = [];
  const bloques: Buffer[] = [];

  // Sin arbol: se entra en los contenedores y se salta lo demas. MediaRecorder
  // escribe Segment y Cluster con tamano desconocido, y asi no importa.
  let pos = 0;
  while (pos < webm.length) {
    const id = leerVint(webm, pos, true);
    if (!id || id.valor === null) break;
    const tam = leerVint(webm, pos + id.largo, false);
    if (!tam) break;
    const inicio = pos + id.largo + tam.largo;

    if (SE_ENTRA.has(id.valor)) {
      if (id.valor === ID_TRACK_ENTRY) pistas.push({});
      pos = inicio;
      continue;
    }
    if (tam.valor === null) break;
    const fin = inicio + tam.valor;
    if (fin > webm.length) break; // cortado a media escritura: vale lo leido hasta aqui
    const cuerpo = webm.subarray(inicio, fin);

    const pista = pistas[pistas.length - 1];
    if (pista && id.valor === ID_TRACK_NUMBER) pista.numero = cuerpo.reduce((n, b) => n * 256 + b, 0);
    else if (pista && id.valor === ID_CODEC_ID) pista.codec = cuerpo.toString('latin1').replace(/\0+$/, '');
    else if (pista && id.valor === ID_CODEC_PRIVATE) pista.privado = cuerpo;
    else if (id.valor === ID_SIMPLE_BLOCK || id.valor === ID_BLOCK) bloques.push(cuerpo);
    pos = fin;
  }

  const opus = pistas.find((p) => p.codec === 'A_OPUS');
  if (!opus || opus.numero === undefined || !opus.privado) return null;
  if (opus.privado.subarray(0, 8).toString('latin1') !== 'OpusHead') return null;

  const paquetes: Buffer[] = [];
  for (const bloque of bloques) {
    const pista = leerVint(bloque, 0, false);
    if (!pista || pista.valor !== opus.numero) continue;
    const banderas = bloque[pista.largo + 2];
    if (banderas === undefined) continue;
    if (banderas & 0x06) return null; // "lacing": MediaRecorder no lo usa y no merece un lector propio
    const paquete = bloque.subarray(pista.largo + 3);
    if (paquete.length) paquetes.push(paquete);
  }
  if (!paquetes.length) return null;

  const paginas = [paginaOgg([opus.privado], 0x02, 0n, 0), paginaOgg([etiquetasOpus()], 0, 0n, 1)];
  let secuencia = 2;
  let granulo = 0n;
  let tanda: Buffer[] = [];
  let segmentos = 0;
  paquetes.forEach((paquete, i) => {
    tanda.push(paquete);
    segmentos += segmentosDe(paquete);
    granulo += BigInt(muestrasDelPaquete(paquete));
    const ultimo = i === paquetes.length - 1;
    const siguiente = paquetes[i + 1];
    const noCabe = siguiente !== undefined && segmentos + segmentosDe(siguiente) > MAX_SEGMENTOS;
    if (ultimo || noCabe || tanda.length >= PAQUETES_POR_PAGINA) {
      paginas.push(paginaOgg(tanda, ultimo ? 0x04 : 0, granulo, secuencia++));
      tanda = [];
      segmentos = 0;
    }
  });
  return Buffer.concat(paginas);
}

export type AudioPreparado =
  | { ok: true; datos: Buffer; mimeType: string; voz: boolean; filename: string | undefined }
  | { ok: false; error: string };

/**
 * Lo que pasa todo audio antes de salir, venga del micro, del clip o de la API.
 *
 * Un webm se convierte. Y solo un ogg sale como nota de voz: otro formato (el
 * m4a que graba Safari, un mp3) llega mejor como audio normal que como una nota
 * de voz que WhatsApp no sabe reproducir.
 */
export function prepararAudioSaliente(audio: { datos: Buffer; mimeType: string; voz?: boolean; filename?: string }): AudioPreparado {
  const mimeType = audio.mimeType.split(';')[0]!.trim().toLowerCase();
  const esWebm = mimeType === 'audio/webm' || audio.datos.subarray(0, 4).equals(FIRMA_WEBM);
  if (!esWebm) {
    return { ok: true, datos: audio.datos, mimeType: audio.mimeType, voz: Boolean(audio.voz) && mimeType === 'audio/ogg', filename: audio.filename };
  }
  const ogg = webmOpusAOgg(audio.datos);
  if (!ogg) return { ok: false, error: 'No se pudo preparar este audio para WhatsApp. Grábalo de nuevo o usa un fichero mp3, m4a u ogg.' };
  return { ok: true, datos: ogg, mimeType: 'audio/ogg', voz: Boolean(audio.voz), filename: audio.filename?.replace(/\.[^.]*$/, '.ogg') };
}
