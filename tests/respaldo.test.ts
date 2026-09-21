/**
 * La copia de seguridad: "Hacer copia ahora" deja dos .tar.gz en la carpeta
 * (la base de PGlite y los respaldos de chats), el tar propio se puede leer
 * de vuelta, una carpeta imposible se explica, y con quince copias quedan
 * catorce. El ticker la hace una vez por noche a su hora.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { PGlite } from '@electric-sql/pglite';
import { crearRespaldo, carpetaDeCopiasPorDefecto, explicarErrorDeCarpeta, type ServicioRespaldo } from '../src/respaldo/servicio.js';
import { empaquetarCarpeta, cabeceraTar } from '../src/respaldo/tar.js';
import { createMemorySettingsRepo } from './fakes.js';

/** Lee un tar (ya descomprimido) y devuelve sus entradas: nombre, tamaño y contenido. */
function leerTar(tar: Buffer): Array<{ nombre: string; tamano: number; tipo: string; contenido: Buffer }> {
  const entradas: Array<{ nombre: string; tamano: number; tipo: string; contenido: Buffer }> = [];
  let pos = 0;
  while (pos + 512 <= tar.length) {
    const cab = tar.subarray(pos, pos + 512);
    if (cab.every((b) => b === 0)) break;
    const campo = (desde: number, ancho: number) => cab.subarray(desde, desde + ancho).toString('utf8').replace(/\0.*$/s, '');
    const prefijo = campo(345, 155);
    const nombre = (prefijo ? `${prefijo}/` : '') + campo(0, 100);
    const tamano = parseInt(campo(124, 12).trim() || '0', 8);
    const tipo = campo(156, 1) || '0';
    // La suma de control: la escribe la cabecera y la comprueba cualquier tar.
    let suma = 0;
    for (let i = 0; i < 512; i++) suma += i >= 148 && i < 156 ? 32 : cab[i]!;
    expect(parseInt(campo(148, 8).trim(), 8)).toBe(suma);
    pos += 512;
    const contenido = Buffer.from(tar.subarray(pos, pos + tamano));
    pos += Math.ceil(tamano / 512) * 512;
    entradas.push({ nombre, tamano, tipo, contenido });
  }
  return entradas;
}

describe('el tar escrito a mano', () => {
  it('cabecera ustar con suma de control y nombres largos partidos en prefijo', () => {
    const cab = cabeceraTar({ nombre: 'a/b.txt', tamano: 5, mtime: new Date(0), directorio: false });
    expect(cab.length).toBe(512);
    expect(cab.subarray(257, 263).toString()).toBe('ustar\0');
    const largo = `${'carpeta-larga-'.repeat(8)}/${'fichero-largo-'.repeat(5)}.txt`;
    const cab2 = cabeceraTar({ nombre: largo, tamano: 0, mtime: new Date(0), directorio: false });
    const e = leerTar(Buffer.concat([cab2, Buffer.alloc(1024)]));
    expect(e[0]!.nombre).toBe(largo);
  });

  it('empaqueta una carpeta con subcarpetas y ficheros de varios tamaños, y se lee de vuelta igual', async () => {
    const origen = mkdtempSync(path.join(tmpdir(), 'tar-origen-'));
    const destino = mkdtempSync(path.join(tmpdir(), 'tar-destino-'));
    try {
      mkdirSync(path.join(origen, 'sub', 'hondo'), { recursive: true });
      writeFileSync(path.join(origen, 'uno.txt'), 'hola');
      writeFileSync(path.join(origen, 'sub', 'dos.bin'), Buffer.alloc(513, 7));
      writeFileSync(path.join(origen, 'sub', 'hondo', 'tres.json'), JSON.stringify({ ok: true }));
      writeFileSync(path.join(origen, 'vacio.txt'), '');
      const salida = path.join(destino, 'x.tar.gz');
      const r = await empaquetarCarpeta(origen, salida, { raizDentro: 'respaldos' });
      expect(r.ficheros).toBe(4);
      expect(r.bytes).toBe(4 + 513 + 11 + 0);
      const entradas = leerTar(gunzipSync(readFileSync(salida)));
      const porNombre = Object.fromEntries(entradas.map((e) => [e.nombre, e]));
      expect(porNombre['respaldos/']?.tipo).toBe('5');
      expect(porNombre['respaldos/sub/']?.tipo).toBe('5');
      expect(porNombre['respaldos/uno.txt']?.contenido.toString()).toBe('hola');
      expect(porNombre['respaldos/sub/dos.bin']?.tamano).toBe(513);
      expect(porNombre['respaldos/sub/dos.bin']?.contenido.every((b) => b === 7)).toBe(true);
      expect(porNombre['respaldos/sub/hondo/tres.json']?.contenido.toString()).toBe('{"ok":true}');
      expect(porNombre['respaldos/vacio.txt']?.tamano).toBe(0);
    } finally {
      rmSync(origen, { recursive: true, force: true });
      rmSync(destino, { recursive: true, force: true });
    }
  });
});

describe('la copia de seguridad', () => {
  let db: PGlite;
  let carpeta: string;
  let archiveDir: string;
  let respaldo: ServicioRespaldo;
  let ahora = new Date('2026-09-21T07:30:00Z'); // 02:30 Lima
  const ajustes = { activa: true, hora: '03:00', carpeta: '', conservar: 14 };
  const settingsRepo = createMemorySettingsRepo();

  beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec('create table prueba (id int); insert into prueba values (1), (2), (3);');
    carpeta = mkdtempSync(path.join(tmpdir(), 'gsgchat-copias-'));
    archiveDir = mkdtempSync(path.join(tmpdir(), 'gsgchat-respaldos-'));
    writeFileSync(path.join(archiveDir, '51987654321-2026-09-01.ndjson.gz'), Buffer.from('gz-de-mentira'));
    mkdirSync(path.join(archiveDir, '51987654321-2026-09-01-adjuntos'));
    writeFileSync(path.join(archiveDir, '51987654321-2026-09-01-adjuntos', 'foto.jpg'), Buffer.alloc(2000, 1));
    respaldo = await crearRespaldo({
      baseDatos: () => ({ tipo: 'pglite', dump: () => db.dumpDataDir('gzip'), dataDir: '.wa-data' }),
      archiveDir,
      carpetaPorDefecto: carpeta,
      ajustes: () => ajustes,
      settingsRepo,
      ahora: () => ahora,
      log: () => undefined,
      timezone: 'America/Lima',
    });
  });
  afterAll(async () => {
    await db.close();
    rmSync(carpeta, { recursive: true, force: true });
    rmSync(archiveDir, { recursive: true, force: true });
  });

  it('antes de la primera copia la pantalla avisa en amarillo y explica cómo restaurar', async () => {
    const e = await respaldo.estado();
    expect(e.alerta).toContain('Todavía no hay ninguna copia');
    expect(e.carpeta).toBe(carpeta);
    expect(e.carpetaEsLaDeSiempre).toBe(true);
    expect(e.carpetaComprobada.ok).toBe(true);
    expect(e.base.tipo).toBe('pglite');
    expect(e.restaurar.pasos.length).toBeGreaterThan(3);
    expect(e.proxima).toBe('hoy a las 03:00');
  });

  it('"Hacer copia ahora" deja la base y los respaldos en la carpeta, y lo apunta', async () => {
    const r = await respaldo.hacerCopia('Ali');
    expect(r.ok).toBe(true);
    expect(r.error).toBeNull();
    expect(r.ficheros.map((f) => f.nombre).sort()).toEqual(['base-2026-09-21.tar.gz', 'respaldos-2026-09-21.tar.gz']);
    expect(r.notas.some((n) => n.includes('.wa-auth'))).toBe(true);
    const nombres = readdirSync(carpeta).sort();
    expect(nombres).toEqual(['base-2026-09-21.tar.gz', 'respaldos-2026-09-21.tar.gz']);
    // La base es el volcado de PGlite: un tar.gz con la carpeta de datos dentro.
    const base = gunzipSync(readFileSync(path.join(carpeta, 'base-2026-09-21.tar.gz')));
    expect(leerTar(base).length).toBeGreaterThan(5);
    // Los respaldos: lo que había, con sus adjuntos.
    const entradas = leerTar(gunzipSync(readFileSync(path.join(carpeta, 'respaldos-2026-09-21.tar.gz'))));
    expect(entradas.map((e) => e.nombre)).toContain('respaldos/51987654321-2026-09-01.ndjson.gz');
    expect(entradas.map((e) => e.nombre)).toContain('respaldos/51987654321-2026-09-01-adjuntos/foto.jpg');
    const guardada = (await settingsRepo.getAll()).find((x) => x.key === 'respaldo.ultima');
    expect(guardada).toBeTruthy();
    const e = await respaldo.estado();
    expect(e.alerta).toBeNull();
    expect(e.ultima?.quien).toBe('Ali');
    expect(e.copias).toHaveLength(2);
    const f = await respaldo.ficheroDeCopia('base-2026-09-21.tar.gz');
    expect(f.ok).toBe(true);
    expect((await respaldo.ficheroDeCopia('../../etc/passwd')).ok).toBe(false);
    expect((await respaldo.ficheroDeCopia('base-2026-01-01.tar.gz')).ok).toBe(false);
  });

  it('con quince días de copias quedan catorce (las más viejas se borran)', async () => {
    for (let i = 1; i <= 15; i++) {
      const dia = `2026-08-${String(i).padStart(2, '0')}`;
      writeFileSync(path.join(carpeta, `base-${dia}.tar.gz`), 'x');
      writeFileSync(path.join(carpeta, `respaldos-${dia}.tar.gz`), 'x');
    }
    const r = await respaldo.hacerCopia('Ali');
    expect(r.ok).toBe(true);
    const bases = readdirSync(carpeta).filter((n) => n.startsWith('base-'));
    expect(bases).toHaveLength(14);
    expect(bases).toContain('base-2026-09-21.tar.gz');
    expect(bases).not.toContain('base-2026-08-01.tar.gz');
    expect(bases).not.toContain('base-2026-08-02.tar.gz');
    expect(r.notas.some((n) => n.includes('copias viejas'))).toBe(true);
  });

  it('una carpeta imposible se explica en cristiano y la copia queda como fallida', async () => {
    const fichero = path.join(carpeta, 'base-2026-09-21.tar.gz');
    const r = await respaldo.comprobarCarpeta(fichero);
    expect(r.ok).toBe(false);
    expect(r.detalle).toContain('No se pudo usar la carpeta');
    ajustes.carpeta = fichero;
    const c = await respaldo.hacerCopia('Ali');
    expect(c.ok).toBe(false);
    expect(c.error).toContain('carpeta');
    expect((await respaldo.estado()).alerta).toContain('La última copia falló');
    ajustes.carpeta = '';
    expect(explicarErrorDeCarpeta({ code: 'EACCES' }, 'D:\\x')).toContain('permisos');
    expect(explicarErrorDeCarpeta({ code: 'ENOSPC' }, 'D:\\x')).toContain('espacio');
  });

  it('el ticker copia una vez por noche a su hora', async () => {
    const antes = statSync(path.join(carpeta, 'base-2026-09-21.tar.gz')).mtimeMs;
    expect(await respaldo.tick()).toBe(false);
    ahora = new Date('2026-09-21T08:00:00Z'); // 03:00 Lima
    expect(await respaldo.tick()).toBe(true);
    expect(statSync(path.join(carpeta, 'base-2026-09-21.tar.gz')).mtimeMs).toBeGreaterThanOrEqual(antes);
    expect((await respaldo.estado()).ultima?.quien).toBe('cada noche');
    ahora = new Date('2026-09-21T09:00:00Z');
    expect(await respaldo.tick()).toBe(false);
    ajustes.activa = false;
    ahora = new Date('2026-09-22T08:30:00Z');
    expect(await respaldo.tick()).toBe(false);
    expect((await respaldo.estado()).proxima).toContain('apagada');
  });

  it('la carpeta de siempre está dentro de la casa del usuario', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'casa-'));
    try {
      expect(carpetaDeCopiasPorDefecto(base).endsWith('GSGchat-copias')).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('con Postgres de verdad y sin pg_dump, solo se copian los respaldos y se dice', async () => {
    const carpeta2 = mkdtempSync(path.join(tmpdir(), 'gsgchat-copias-pg-'));
    try {
      const r2 = await crearRespaldo({
        baseDatos: () => ({ tipo: 'postgres', url: 'postgres://x/y' }),
        archiveDir,
        carpetaPorDefecto: carpeta2,
        ajustes: () => ({ activa: true, hora: '03:00', carpeta: '', conservar: 14 }),
        settingsRepo: createMemorySettingsRepo(),
        ahora: () => ahora,
        log: () => undefined,
        timezone: 'America/Lima',
        ejecutar: async () => ({ ok: false, error: 'spawn pg_dump ENOENT' }),
      });
      const r = await r2.hacerCopia('Ali');
      expect(r.ok).toBe(true);
      expect(r.ficheros.map((f) => f.nombre)).toEqual([`respaldos-2026-09-22.tar.gz`]);
      expect(r.notas.some((n) => n.includes('pg_dump'))).toBe(true);
    } finally {
      rmSync(carpeta2, { recursive: true, force: true });
    }
  });
});
