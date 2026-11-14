import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { limpiarArchivosAntes } from '../src/whatsapp/limpieza-chat.js';

// Las fotos, audios y videos del chat viven lo mismo que sus mensajes (72 h).
let dir = '';
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('limpieza de los archivos del chat', () => {
  it('borra los vencidos que nombra el sistema; no toca los recientes, los stickers ni otros ficheros', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'medios-'));
    const viejo = 'a'.repeat(24) + '.jpg';
    const nuevo = 'b'.repeat(24) + '.ogg';
    await writeFile(path.join(dir, viejo), 'x');
    await writeFile(path.join(dir, nuevo), 'x');
    await writeFile(path.join(dir, 'notas.txt'), 'x');
    await mkdir(path.join(dir, 'stickers'));
    await writeFile(path.join(dir, 'stickers', 'c'.repeat(24) + '.webp'), 'x');
    const hace4dias = new Date(Date.now() - 4 * 24 * 3600 * 1000);
    for (const f of [viejo, 'notas.txt']) await utimes(path.join(dir, f), hace4dias, hace4dias);

    const borrados = await limpiarArchivosAntes(dir, new Date(Date.now() - 72 * 3600 * 1000));
    expect(borrados).toBe(1);
    expect((await readdir(dir)).sort()).toEqual([nuevo, 'notas.txt', 'stickers'].sort());
    expect(await readdir(path.join(dir, 'stickers'))).toHaveLength(1);
  });
});

describe('archivos huerfanos y limites', () => {
  it('borra los ficheros que ningun mensaje nombra; conserva los referenciados (tambien la copia de Meta) y los recientes', async () => {
    const { createFakeRepos } = await import('./fakes.js');
    const { limpiarArchivosHuerfanos } = await import('../src/whatsapp/limpieza-chat.js');
    const { idDeMedia } = await import('../src/whatsapp/local/media.js');
    const d = await mkdtemp(path.join(tmpdir(), 'huerfanos-'));
    try {
      const repos = createFakeRepos();
      const c = await repos.contacts.upsertFromInbound('51987603999');
      const propio = 'd'.repeat(24) + '.jpg';
      const deMeta = idDeMedia('meta:ID123', '.ogg');
      const huerfano = 'e'.repeat(24) + '.mp4';
      const reciente = 'f'.repeat(24) + '.png';
      const parcial = 'a1'.repeat(12) + '.ogg.123.tmp';
      await repos.messages.add({ contactId: c.id, direction: 'in', kind: 'image', wamid: 'w1', body: null, payload: { media: { id: propio, mimeType: 'image/jpeg' } } });
      await repos.messages.add({ contactId: c.id, direction: 'in', kind: 'audio', wamid: 'w2', body: null, payload: { media: { id: 'ID123', mimeType: 'audio/ogg' } } });
      for (const f of [propio, deMeta, huerfano, reciente, parcial]) await writeFile(path.join(d, f), 'x');
      const viejo = new Date(Date.now() - 3 * 3600 * 1000);
      for (const f of [propio, deMeta, huerfano, parcial]) await utimes(path.join(d, f), viejo, viejo);
      expect(await limpiarArchivosHuerfanos(d, repos)).toBe(2);
      expect((await readdir(d)).sort()).toEqual([propio, deMeta, reciente].sort());
      // Al borrarse el mensaje, su fichero ya es huerfano.
      repos.messages._all.length = 0;
      await utimes(path.join(d, propio), viejo, viejo);
      expect(await limpiarArchivosHuerfanos(d, repos)).toBe(2);
    } finally {
      await rm(d, { recursive: true, force: true });
    }
  });

  it('guardarFlujo escribe sin limite de tamano y no deja temporales si falla; el cupo limita las tareas a la vez', async () => {
    const { Readable } = await import('node:stream');
    const { guardarFlujo, crearCupo } = await import('../src/whatsapp/local/media.js');
    const d = await mkdtemp(path.join(tmpdir(), 'flujo-'));
    try {
      // 40 MB: pasa del antiguo tope de 16 MB sin problema
      const trozos = Array.from({ length: 40 }, () => Buffer.alloc(1024 * 1024));
      expect(await guardarFlujo(Readable.from(trozos), path.join(d, 'ok.bin'))).toBe(40 * 1024 * 1024);
      const roto = new Readable({ read() { this.destroy(new Error('se corto')); } });
      await expect(guardarFlujo(roto, path.join(d, 'x.bin'))).rejects.toThrow('se corto');
      expect(await readdir(d)).toEqual(['ok.bin']); // sin temporales

      const cupo = crearCupo(2);
      let activas = 0, maximo = 0;
      await Promise.all(Array.from({ length: 6 }, () => cupo(async () => { activas++; maximo = Math.max(maximo, activas); await new Promise((r) => setTimeout(r, 10)); activas--; })));
      expect(maximo).toBe(2);
    } finally {
      await rm(d, { recursive: true, force: true });
    }
  });
});

describe('rangos de los archivos (para saltar en audios y videos)', () => {
  it('rangoDe entiende bytes=a-b, a-, -n y rechaza lo imposible', async () => {
    const { rangoDe } = await import('../src/whatsapp/local/media.js');
    expect(rangoDe(undefined, 1000)).toBeNull();
    expect(rangoDe('bytes=0-99', 1000)).toEqual({ inicio: 0, fin: 99 });
    expect(rangoDe('bytes=900-', 1000)).toEqual({ inicio: 900, fin: 999 });
    expect(rangoDe('bytes=-50', 1000)).toEqual({ inicio: 950, fin: 999 });
    expect(rangoDe('bytes=500-5000', 1000)).toEqual({ inicio: 500, fin: 999 });
    expect(rangoDe('bytes=1000-', 1000)).toBe('invalido');
    expect(rangoDe('bytes=50-10', 1000)).toBe('invalido');
    expect(rangoDe('basura', 1000)).toBeNull();
  });
});
