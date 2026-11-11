/**
 * Que el audio siempre llegue: lo que graba Chrome (webm) sale como ogg/opus
 * sin depender de ffmpeg, un mp3/m4a sale como audio normal con su tipo, y lo
 * que no se puede preparar se dice en vez de mandar un audio roto.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { audioParaMeta, esOggOpus } from '../src/whatsapp/audio-meta.js';

const webm = readFileSync(join(__dirname, 'fixtures', 'nota-de-voz-chrome.webm'));

describe('audioParaMeta', () => {
  it('un webm de Chrome sale como ogg/opus y nota de voz, sin necesitar ffmpeg', async () => {
    const r = await audioParaMeta({ datos: webm, mimeType: 'audio/webm;codecs=opus', filename: 'nota-de-voz.webm', voz: true });
    expect(r).toMatchObject({ mimeType: 'audio/ogg', filename: 'nota-de-voz.ogg', voz: true });
    expect(esOggOpus(r.datos)).toBe(true);
    expect(r.datos.length).toBeGreaterThan(webm.length * 0.8);
  });

  it('un webm con el tipo mal puesto también se reconoce por su firma', async () => {
    const r = await audioParaMeta({ datos: webm, mimeType: 'application/octet-stream' });
    expect(r).toMatchObject({ mimeType: 'audio/ogg', voz: true });
    expect(esOggOpus(r.datos)).toBe(true);
  });

  it('un ogg/opus se queda como está', async () => {
    const ogg = (await audioParaMeta({ datos: webm, mimeType: 'audio/webm' })).datos;
    const r = await audioParaMeta({ datos: ogg, mimeType: 'audio/ogg', filename: 'a.ogg' });
    expect(r.datos).toBe(ogg);
    expect(r).toMatchObject({ mimeType: 'audio/ogg', voz: true });
  });

  it('un mp3 sale como audio normal con su tipo (no como nota de voz) aunque no haya ffmpeg', async () => {
    const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(200, 1)]);
    const r = await audioParaMeta({ datos: mp3, mimeType: 'audio/mpeg', filename: 'cancion.mp3', voz: true });
    expect(r).toMatchObject({ mimeType: 'audio/mpeg', filename: 'cancion.mp3', voz: false });
    expect(r.datos).toBe(mp3);
  });

  it('un m4a (lo que graba Safari o el teléfono) sale como audio normal', async () => {
    const m4a = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A '), Buffer.alloc(100, 2)]);
    const r = await audioParaMeta({ datos: m4a, mimeType: 'audio/x-m4a', filename: 'voz.m4a' });
    expect(r).toMatchObject({ mimeType: 'audio/mp4', filename: 'voz.m4a', voz: false });
  });

  it('un webm que no se puede leer se dice con claridad y no sale', async () => {
    const roto = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from('no soy audio')]);
    await expect(audioParaMeta({ datos: roto, mimeType: 'audio/webm' })).rejects.toThrow(/Grábalo de nuevo/);
  });
});
