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
