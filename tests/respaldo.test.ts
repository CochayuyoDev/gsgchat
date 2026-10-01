/**
 * La copia de seguridad: "Hacer copia ahora" deja en la carpeta la base
 * (base-AAAA-MM-DD.sql.gz, con mysqldump o con el volcado propio) y los
 * respaldos de chats (.tar.gz); la copia de la base se restaura y deja lo
 * mismo que habia; el tar propio se puede leer de vuelta, una carpeta
 * imposible se explica, y con quince copias quedan catorce. El ticker la
 * hace una vez por noche a su hora.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import mysqlCrudo from 'mysql2/promise';
import { crearRespaldo, candidatosMysqldump, carpetaDeCopiasPorDefecto, explicarErrorDeCarpeta, type ServicioRespaldo } from '../src/respaldo/servicio.js';
import { borrarBase } from '../src/db/bases.js';
import { crearBaseSiNoExiste } from '../src/db/migrate.js';
import { PREFIJO_PRUEBAS, URL_PRUEBAS, urlConBase } from './mysql.js';
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

/**
 * Una base pequeña de verdad en el servidor de pruebas (dos tablas: crearla
 * es un instante, no el minuto de las ~50 de una tienda), con los valores que
 * un volcado suele romper: comillas, barras, saltos de linea, emojis, fechas
 * con milisegundos, JSON, decimales, numeros mas grandes que los de JS,
 * binarios y nulos.
 */
const BASE_COPIA = `${PREFIJO_PRUEBAS}respaldo`;
const URL_COPIA = urlConBase(BASE_COPIA);

const TABLAS_COPIA = `
create table clientes (
  id bigint not null auto_increment primary key,
  nombre varchar(191) not null,
  nota longtext,
  alta datetime(3) not null,
  activo tinyint(1) not null default 1,
  saldo decimal(12,2),
  grande bigint,
  datos json,
  foto varbinary(16),
  unique key clientes_nombre (nombre)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;
create table pedidos (
  id bigint not null auto_increment primary key,
  cliente_id bigint not null,
  total decimal(12,2) not null,
  constraint pedidos_cliente foreign key (cliente_id) references clientes (id) on delete cascade
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;
insert into clientes (nombre, nota, alta, activo, saldo, grande, datos, foto) values
  ('Rosa', 'dijo "hola" y luego \\'chau\\'\\ncon barra \\\\ y emoji 😀 ñ', '2026-09-21 07:30:00.123', 1, 1234.50, 9007199254740993, '{"a": [1, "dos"], "b": null}', x'00ff10'),
  ('Pedro', null, '2026-01-02 03:04:05.006', 0, null, null, null, null);
insert into pedidos (cliente_id, total) select id, 99.90 from clientes where nombre = 'Rosa';
`;

async function conexionCruda(multipleStatements = false) {
  const u = new URL(URL_COPIA);
  return mysqlCrudo.createConnection({
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username || 'root'),
    password: decodeURIComponent(u.password || ''),
    database: BASE_COPIA,
    charset: 'UTF8MB4_BIN',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    multipleStatements,
  });
}

/** Todo lo que hay en las dos tablas, tal cual (fechas y numeros como texto, binarios en hexadecimal). */
async function contenido(): Promise<unknown> {
  const c = await conexionCruda();
  try {
    const [clientes] = await c.query('select id, nombre, nota, alta, activo, saldo, grande, cast(datos as char) as datos, hex(foto) as foto from clientes order by id');
    const [pedidos] = await c.query('select * from pedidos order by id');
    return { clientes, pedidos };
  } finally {
    await c.end();
  }
}

/** Restaura un .sql.gz encima de la base (como lo haria phpMyAdmin o el cliente mysql). */
async function restaurar(fichero: string): Promise<void> {
  const sql = gunzipSync(readFileSync(fichero)).toString('utf8');
  const c = await conexionCruda(true);
  try {
    await c.query('set foreign_key_checks = 0; drop table if exists pedidos; drop table if exists clientes; set foreign_key_checks = 1');
    await c.query(sql);
  } finally {
    await c.end();
  }
}

describe('la copia de seguridad', () => {
  let carpeta: string;
  let archiveDir: string;
  let respaldo: ServicioRespaldo;
  let original: unknown;
  let ahora = new Date('2026-09-21T07:30:00Z'); // 02:30 Lima
  const ajustes = { activa: true, hora: '03:00', carpeta: '', conservar: 14 };
  const settingsRepo = createMemorySettingsRepo();

  beforeAll(async () => {
    await borrarBase(URL_PRUEBAS, BASE_COPIA);
    await crearBaseSiNoExiste(URL_PRUEBAS, BASE_COPIA);
    const c = await conexionCruda(true);
    try {
      await c.query(TABLAS_COPIA);
    } finally {
      await c.end();
    }
    original = await contenido();
    carpeta = mkdtempSync(path.join(tmpdir(), 'gsgchat-copias-'));
    archiveDir = mkdtempSync(path.join(tmpdir(), 'gsgchat-respaldos-'));
    writeFileSync(path.join(archiveDir, '51987654321-2026-09-01.ndjson.gz'), Buffer.from('gz-de-mentira'));
    mkdirSync(path.join(archiveDir, '51987654321-2026-09-01-adjuntos'));
    writeFileSync(path.join(archiveDir, '51987654321-2026-09-01-adjuntos', 'foto.jpg'), Buffer.alloc(2000, 1));
    respaldo = await crearRespaldo({
      baseDatos: () => ({ tipo: 'mysql', url: URL_COPIA }),
      archiveDir,
      carpetaPorDefecto: carpeta,
      ajustes: () => ajustes,
      settingsRepo,
      ahora: () => ahora,
      log: () => undefined,
      timezone: 'America/Lima',
    });
  }, 120_000);
  afterAll(async () => {
    await borrarBase(URL_PRUEBAS, BASE_COPIA).catch(() => undefined);
    rmSync(carpeta, { recursive: true, force: true });
    rmSync(archiveDir, { recursive: true, force: true });
  });

  it('antes de la primera copia la pantalla avisa en amarillo y explica cómo restaurar', async () => {
    const e = await respaldo.estado();
    expect(e.alerta).toContain('Todavía no hay ninguna copia');
    expect(e.carpeta).toBe(carpeta);
    expect(e.carpetaEsLaDeSiempre).toBe(true);
    expect(e.carpetaComprobada.ok).toBe(true);
    expect(e.base.tipo).toBe('mysql');
    expect(e.base.detalle).toContain(`«${BASE_COPIA}»`);
    expect(e.restaurar.pasos.length).toBeGreaterThan(3);
    expect(e.restaurar.pasos.join(' ')).toContain('phpMyAdmin');
    expect(e.restaurar.pasos.join(' ')).toContain(BASE_COPIA);
    expect(e.proxima).toBe('hoy a las 03:00');
  });

  it('"Hacer copia ahora" deja la base y los respaldos en la carpeta, y la copia de la base se restaura igual', async () => {
    const r = await respaldo.hacerCopia('Ali');
    expect(r.ok).toBe(true);
    expect(r.error).toBeNull();
    expect(r.ficheros.map((f) => f.nombre).sort()).toEqual(['base-2026-09-21.sql.gz', 'respaldos-2026-09-21.tar.gz']);
    // Con mysqldump si esta en esta maquina (XAMPP lo trae); si no, con el volcado propio.
    expect(r.ficheros.find((f) => f.nombre.startsWith('base-'))!.que).toMatch(/mysqldump|volcado propio/);
    expect(r.notas.some((n) => n.includes('.wa-auth'))).toBe(true);
    const nombres = readdirSync(carpeta).sort();
    expect(nombres).toEqual(['base-2026-09-21.sql.gz', 'respaldos-2026-09-21.tar.gz']);
    // La base: un volcado SQL comprimido con las dos tablas y sus filas...
    const sql = gunzipSync(readFileSync(path.join(carpeta, 'base-2026-09-21.sql.gz'))).toString('utf8');
    expect(sql).toMatch(/CREATE TABLE `clientes`/);
    expect(sql).toMatch(/CREATE TABLE `pedidos`/);
    // ...que se restaura y deja exactamente lo que habia.
    await restaurar(path.join(carpeta, 'base-2026-09-21.sql.gz'));
    expect(await contenido()).toEqual(original);
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
    const f = await respaldo.ficheroDeCopia('base-2026-09-21.sql.gz');
    expect(f.ok).toBe(true);
    expect((await respaldo.ficheroDeCopia('../../etc/passwd')).ok).toBe(false);
    expect((await respaldo.ficheroDeCopia('base-2026-01-01.sql.gz')).ok).toBe(false);
  }, 300_000);

  it('con quince días de copias quedan catorce (las más viejas se borran)', async () => {
    for (let i = 1; i <= 15; i++) {
      const dia = `2026-08-${String(i).padStart(2, '0')}`;
      writeFileSync(path.join(carpeta, `base-${dia}.sql.gz`), 'x');
      writeFileSync(path.join(carpeta, `respaldos-${dia}.tar.gz`), 'x');
    }
    const r = await respaldo.hacerCopia('Ali');
    expect(r.ok).toBe(true);
    const bases = readdirSync(carpeta).filter((n) => n.startsWith('base-'));
    expect(bases).toHaveLength(14);
    expect(bases).toContain('base-2026-09-21.sql.gz');
    expect(bases).not.toContain('base-2026-08-01.sql.gz');
    expect(bases).not.toContain('base-2026-08-02.sql.gz');
    expect(r.notas.some((n) => n.includes('copias viejas'))).toBe(true);
  }, 300_000);

  it('una carpeta imposible se explica en cristiano y la copia queda como fallida', async () => {
    const fichero = path.join(carpeta, 'base-2026-09-21.sql.gz');
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
    const antes = statSync(path.join(carpeta, 'base-2026-09-21.sql.gz')).mtimeMs;
    expect(await respaldo.tick()).toBe(false);
    ahora = new Date('2026-09-21T08:00:00Z'); // 03:00 Lima
    expect(await respaldo.tick()).toBe(true);
    expect(statSync(path.join(carpeta, 'base-2026-09-21.sql.gz')).mtimeMs).toBeGreaterThanOrEqual(antes);
    expect((await respaldo.estado()).ultima?.quien).toBe('cada noche');
    ahora = new Date('2026-09-21T09:00:00Z');
    expect(await respaldo.tick()).toBe(false);
    ajustes.activa = false;
    ahora = new Date('2026-09-22T08:30:00Z');
    expect(await respaldo.tick()).toBe(false);
    expect((await respaldo.estado()).proxima).toContain('apagada');
  }, 300_000);

  it('la carpeta de siempre está dentro de la casa del usuario', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'casa-'));
    try {
      expect(carpetaDeCopiasPorDefecto(base).endsWith('GSGchat-copias')).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('mysqldump se busca en MYSQLDUMP_PATH, en el PATH y en el de XAMPP, en ese orden', () => {
    const lista = candidatosMysqldump({ MYSQLDUMP_PATH: 'D:\\mi\\mysqldump.exe' });
    expect(lista.slice(0, 2)).toEqual(['D:\\mi\\mysqldump.exe', 'mysqldump']);
    expect(candidatosMysqldump({})[0]).toBe('mysqldump');
  });

  it('sin mysqldump la base se copia con el volcado propio, se dice, y se restaura igual', async () => {
    const carpeta2 = mkdtempSync(path.join(tmpdir(), 'gsgchat-copias-js-'));
    const probados: string[] = [];
    try {
      const r2 = await crearRespaldo({
        baseDatos: () => ({ tipo: 'mysql', url: URL_PRUEBAS, base: BASE_COPIA }),
        archiveDir,
        carpetaPorDefecto: carpeta2,
        ajustes: () => ({ activa: true, hora: '03:00', carpeta: '', conservar: 14 }),
        settingsRepo: createMemorySettingsRepo(),
        ahora: () => ahora,
        log: () => undefined,
        timezone: 'America/Lima',
        mysqldump: () => ['mysqldump', 'C:\\no\\existe\\mysqldump.exe'],
        ejecutar: async (cmd) => {
          probados.push(cmd);
          return { ok: false, error: `spawn ${cmd} ENOENT`, noEncontrado: true };
        },
      });
      const r = await r2.hacerCopia('Ali');
      expect(r.ok).toBe(true);
      // Se probaron todos los sitios antes de rendirse.
      expect(probados).toEqual(['mysqldump', 'C:\\no\\existe\\mysqldump.exe']);
      expect(r.ficheros.map((f) => f.nombre).sort()).toEqual(['base-2026-09-22.sql.gz', 'respaldos-2026-09-22.tar.gz']);
      expect(r.ficheros.find((f) => f.nombre.startsWith('base-'))!.que).toContain('volcado propio');
      expect(r.notas.some((n) => n.includes('no está mysqldump'))).toBe(true);
      const sql = gunzipSync(readFileSync(path.join(carpeta2, 'base-2026-09-22.sql.gz'))).toString('utf8');
      expect(sql).toContain('SET FOREIGN_KEY_CHECKS = 0');
      expect(sql).toContain('INSERT INTO `clientes`');
      await restaurar(path.join(carpeta2, 'base-2026-09-22.sql.gz'));
      expect(await contenido()).toEqual(original);
    } finally {
      rmSync(carpeta2, { recursive: true, force: true });
    }
  }, 300_000);

  it('si mysqldump falla, la base sale igual con el volcado propio y se dice por qué', async () => {
    const carpeta3 = mkdtempSync(path.join(tmpdir(), 'gsgchat-copias-falla-'));
    try {
      const r3 = await crearRespaldo({
        baseDatos: () => ({ tipo: 'mysql', url: URL_COPIA }),
        archiveDir,
        carpetaPorDefecto: carpeta3,
        ajustes: () => ({ activa: true, hora: '03:00', carpeta: '', conservar: 14 }),
        settingsRepo: createMemorySettingsRepo(),
        ahora: () => ahora,
        log: () => undefined,
        timezone: 'America/Lima',
        mysqldump: () => ['mysqldump'],
        ejecutar: async () => ({ ok: false, error: 'mysqldump: Got error: 1045: Access denied' }),
      });
      const r = await r3.hacerCopia('Ali');
      expect(r.ok).toBe(true);
      expect(r.ficheros.some((f) => f.nombre === 'base-2026-09-22.sql.gz')).toBe(true);
      expect(r.notas.some((n) => n.includes('mysqldump no pudo') && n.includes('Access denied'))).toBe(true);
    } finally {
      rmSync(carpeta3, { recursive: true, force: true });
    }
  }, 300_000);

  it('si la base no contesta, la copia queda como fallida y lo dice', async () => {
    const carpeta4 = mkdtempSync(path.join(tmpdir(), 'gsgchat-copias-sin-base-'));
    try {
      const r4 = await crearRespaldo({
        baseDatos: () => ({ tipo: 'mysql', url: urlConBase(`${PREFIJO_PRUEBAS}no_existe_nunca`) }),
        archiveDir,
        carpetaPorDefecto: carpeta4,
        ajustes: () => ({ activa: true, hora: '03:00', carpeta: '', conservar: 14 }),
        settingsRepo: createMemorySettingsRepo(),
        ahora: () => ahora,
        log: () => undefined,
        timezone: 'America/Lima',
        mysqldump: () => [],
      });
      const r = await r4.hacerCopia('Ali');
      expect(r.ok).toBe(false);
      expect(r.error).toContain(`No se pudo leer la base «${PREFIJO_PRUEBAS}no_existe_nunca»`);
      // No queda un fichero a medias que parezca una copia buena.
      expect(readdirSync(carpeta4).filter((n) => n.startsWith('base-'))).toEqual([]);
    } finally {
      rmSync(carpeta4, { recursive: true, force: true });
    }
  }, 300_000);
});
