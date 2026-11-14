/**
 * El audio que sale. La muestra es un webm de verdad, grabado por Chrome con
 * MediaRecorder (3 s de pitidos del microfono simulado): un webm armado a mano
 * no probaria lo que importa, que es leer lo que el navegador escribe.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateWAMessageContent } from '@whiskeysockets/baileys';
import { parseBuffer } from 'music-metadata';
import { prepararAudioSaliente, webmOpusAOgg } from '../src/whatsapp/audio-saliente.js';

const webm = readFileSync(join(__dirname, 'fixtures', 'nota-de-voz-chrome.webm'));

interface Pagina { flags: number; granulo: bigint; secuencia: number; segmentos: number[]; cuerpo: Buffer; crc: number; crudo: Buffer }

/** Lector ogg independiente del escritor: lo que se comprueba es el formato, no el codigo. */
function leerPaginas(ogg: Buffer): Pagina[] {
  const paginas: Pagina[] = [];
  let pos = 0;
  while (pos < ogg.length) {
    expect(ogg.subarray(pos, pos + 4).toString('latin1')).toBe('OggS');
    const n = ogg[pos + 26]!;
    const segmentos = [...ogg.subarray(pos + 27, pos + 27 + n)];
    const largo = segmentos.reduce((a, b) => a + b, 0);
    const fin = pos + 27 + n + largo;
    paginas.push({
      flags: ogg[pos + 5]!,
      granulo: ogg.readBigInt64LE(pos + 6),
      secuencia: ogg.readUInt32LE(pos + 18),
      segmentos,
      cuerpo: ogg.subarray(pos + 27 + n, fin),
      crc: ogg.readUInt32LE(pos + 22),
      crudo: ogg.subarray(pos, fin),
    });
    pos = fin;
  }
  return paginas;
}

function crcEsperado(pagina: Buffer): number {
  const copia = Buffer.from(pagina);
  copia.writeUInt32LE(0, 22);
  let crc = 0;
  for (const byte of copia) {
    crc = (crc ^ (byte << 24)) >>> 0;
    for (let i = 0; i < 8; i++) crc = (crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1) >>> 0;
  }
  return crc;
}

describe('de webm a ogg', () => {
  const ogg = webmOpusAOgg(webm)!;

  it('saca un ogg/opus bien formado: cabeceras, orden, cierre y CRC de cada pagina', () => {
    expect(ogg).not.toBeNull();
    const paginas = leerPaginas(ogg);
    expect(paginas[0]!.flags).toBe(0x02);
    expect(paginas[0]!.cuerpo.subarray(0, 8).toString('latin1')).toBe('OpusHead');
    expect(paginas[1]!.cuerpo.subarray(0, 8).toString('latin1')).toBe('OpusTags');
    expect(paginas.at(-1)!.flags).toBe(0x04);
    paginas.forEach((p, i) => {
      expect(p.secuencia).toBe(i);
      expect(p.crc).toBe(crcEsperado(p.crudo));
      if (i > 2) expect(p.granulo).toBeGreaterThanOrEqual(paginas[i - 1]!.granulo);
    });
  });

  it('dura lo que duraba el webm, y otro lector de audio lo confirma', async () => {
    const meta = await parseBuffer(ogg, { mimeType: 'audio/ogg' }, { duration: true });
    expect(meta.format.codec?.toLowerCase()).toContain('opus');
    expect(meta.format.container?.toLowerCase()).toContain('ogg');
    expect(meta.format.duration).toBeGreaterThan(2.5);
    expect(meta.format.duration).toBeLessThan(3.5);
  });

  it('no pierde sonido: el peso casi no cambia', () => {
    expect(ogg.length).toBeGreaterThan(webm.length * 0.8);
    expect(ogg.length).toBeLessThan(webm.length * 1.2);
  });

  it('lo que no es un webm con opus se rechaza en vez de mandar basura', () => {
    expect(webmOpusAOgg(Buffer.from('dataaudio/webm;'))).toBeNull();
    expect(webmOpusAOgg(Buffer.alloc(0))).toBeNull();
    expect(webmOpusAOgg(webm.subarray(0, 40))).toBeNull();
  });

  it('un webm cortado a media escritura se aprovecha hasta donde llegó', () => {
    const corto = webmOpusAOgg(webm.subarray(0, Math.floor(webm.length / 2)))!;
    expect(leerPaginas(corto).at(-1)!.flags).toBe(0x04);
    expect(corto.length).toBeLessThan(ogg.length);
  });
});

describe('prepararAudioSaliente', () => {
  it('un webm sale como ogg y conserva la nota de voz', () => {
    const r = prepararAudioSaliente({ datos: webm, mimeType: 'audio/webm;codecs=opus', voz: true, filename: 'nota-de-voz.webm' });
    expect(r).toMatchObject({ ok: true, mimeType: 'audio/ogg', voz: true, filename: 'nota-de-voz.ogg' });
    if (r.ok) expect(r.datos.subarray(0, 4).toString('latin1')).toBe('OggS');
  });

  it('un webm etiquetado con otro tipo también se detecta por su firma', () => {
    expect(prepararAudioSaliente({ datos: webm, mimeType: 'audio/x-desconocido' })).toMatchObject({ ok: true, mimeType: 'audio/ogg' });
  });

  it('un webm ilegible se dice, no sale', () => {
    const r = prepararAudioSaliente({ datos: Buffer.from('basura'), mimeType: 'audio/webm', voz: true });
    expect(r.ok).toBe(false);
  });

  it('un ogg o un mp3 no se tocan; solo el ogg puede ser nota de voz', () => {
    const datos = Buffer.from('cualquier cosa');
    expect(prepararAudioSaliente({ datos, mimeType: 'audio/ogg', voz: true })).toMatchObject({ ok: true, datos, voz: true });
    expect(prepararAudioSaliente({ datos, mimeType: 'audio/mpeg', voz: true })).toMatchObject({ ok: true, datos, mimeType: 'audio/mpeg', voz: false });
    expect(prepararAudioSaliente({ datos, mimeType: 'audio/mp4', voz: true })).toMatchObject({ ok: true, mimeType: 'audio/mp4', voz: false });
  });
});

describe('lo que Baileys arma con el audio convertido', () => {
  it('es una nota de voz con su tipo, su duración y su peso real', async () => {
    const ogg = webmOpusAOgg(webm)!;
    const subidas: string[] = [];
    const mensaje = await generateWAMessageContent(
      { audio: ogg, mimetype: 'audio/ogg; codecs=opus', ptt: true },
      {
        upload: async (ruta: string) => {
          subidas.push(ruta);
          return { mediaUrl: 'https://mmg.whatsapp.net/prueba', directPath: '/prueba' };
        },
      } as never,
    );
    const audio = mensaje.audioMessage!;
    expect(subidas).toHaveLength(1);
    expect(audio.ptt).toBe(true);
    expect(audio.mimetype).toBe('audio/ogg; codecs=opus');
    expect(Number(audio.fileLength)).toBe(ogg.length);
    expect(audio.seconds).toBeGreaterThanOrEqual(2);
    expect(audio.seconds).toBeLessThanOrEqual(4);
  });
});
