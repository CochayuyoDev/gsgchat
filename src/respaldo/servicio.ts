/**
 * La copia de seguridad diaria: la base y los respaldos de chats, cada
 * noche, a una carpeta que elige el dueno.
 *
 * Que se copia y como:
 *  - la base (MySQL/MariaDB) -> `base-AAAA-MM-DD.sql.gz`: un volcado SQL
 *    comprimido, con `mysqldump` si esta (MYSQLDUMP_PATH, el PATH o el de
 *    XAMPP en C:\xampp\mysql\bin) y si no con un volcado propio escrito aqui
 *    (cada tabla con su `create table` y sus filas en INSERT). Se restaura
 *    con phpMyAdmin (Importar acepta el .sql.gz tal cual) o con `mysql`;
 *  - los respaldos de chats y sus adjuntos (`ARCHIVE_DIR`) ->
 *    `respaldos-AAAA-MM-DD.tar.gz` (tar propio, ver tar.ts);
 *  - la vinculacion del telefono (`.wa-auth`) NO se copia: es la sesion de
 *    WhatsApp de ese servidor; en otro sitio hay que escanear el QR igual.
 *
 * Se conservan las ultimas N copias (14) y las demas se borran. Restaurar es
 * con el servidor parado, y la pantalla explica los pasos y da el fichero.
 */

import { access, constants, mkdir, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import mysql from 'mysql2';
import type { SettingsRepo } from '../settings/service.js';
import { bytesEnPalabras, diaEn, minutosDe, minutosDelDia } from '../salud/fiabilidad.js';
import { empaquetarCarpeta } from './tar.js';

export const CLAVE_ULTIMA_COPIA = 'respaldo.ultima';
export const CLAVE_ULTIMO_DIA_COPIA = 'respaldo.ultimoDia';
const NOMBRE_COPIA = /^(base|respaldos)-(\d{4}-\d{2}-\d{2})\.(tar\.gz|sql\.gz)$/;

/** `base`: la de la tienda en ese servidor; sin ella, la de la URL. */
export type FuenteBase = { tipo: 'mysql'; url: string; base?: string } | { tipo: 'memoria' };

/** Donde se busca mysqldump, en orden: MYSQLDUMP_PATH, el PATH y el de XAMPP. */
export function candidatosMysqldump(env: NodeJS.ProcessEnv = process.env): string[] {
  const lista: string[] = [];
  const elegido = env.MYSQLDUMP_PATH?.trim();
  if (elegido) lista.push(elegido);
  lista.push('mysqldump');
  for (const xampp of ['C:\\xampp\\mysql\\bin\\mysqldump.exe', '/opt/lampp/bin/mysqldump']) {
    if (existsSync(xampp)) lista.push(xampp);
  }
  return lista;
}

interface DatosConexion {
  host: string;
  port: number;
  user: string;
  password: string;
  base: string;
}

function datosDe(fuente: { url: string; base?: string }): DatosConexion {
  const u = new URL(fuente.url.trim().replace(/^mariadb:/i, 'mysql:'));
  const base = fuente.base ?? decodeURIComponent(u.pathname.replace(/^\/+/, ''));
  if (!base) throw new Error('La dirección de la base (DATABASE_URL) no dice qué base copiar.');
  return {
    host: u.hostname || 'localhost',
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username || 'root'),
    password: decodeURIComponent(u.password || ''),
    base,
  };
}

/** Lo que va delante y detras de un volcado: sin comprobar claves ajenas mientras se cargan las tablas. */
const CABECERA_VOLCADO = `/*!40101 SET NAMES utf8mb4 */;
SET time_zone = '+00:00';
SET FOREIGN_KEY_CHECKS = 0;
SET UNIQUE_CHECKS = 0;
SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';
`;
const PIE_VOLCADO = `
SET FOREIGN_KEY_CHECKS = 1;
SET UNIQUE_CHECKS = 1;
`;

/**
 * El volcado propio, para cuando no hay mysqldump: cada tabla con su
 * `create table` (el que da el servidor) y sus filas en INSERT de a varias,
 * comprimido. Las filas se leen en streaming (una tabla grande no se carga
 * entera en memoria) y los valores salen tal cual estan guardados: las fechas
 * como texto, los JSON como texto, los numeros grandes sin redondear.
 */
export async function volcarBaseEnJs(fuente: { url: string; base?: string }, destino: string): Promise<{ tablas: number; filas: number }> {
  const d = datosDe(fuente);
  const conexion = mysql.createConnection({
    host: d.host,
    port: d.port,
    user: d.user,
    password: d.password,
    database: d.base,
    charset: 'UTF8MB4_BIN',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    connectTimeout: 5_000,
    // Los JSON como texto (en MySQL 8 llegarian como objeto).
    typeCast(field, next) {
      if (field.type === 'JSON') return field.string('utf8');
      return next();
    },
  });
  // Primero se conecta: si la base no contesta, no se deja ni un fichero a medias.
  try {
    await new Promise<void>((ok, mal) => conexion.connect((error) => (error ? mal(error) : ok())));
  } catch (error) {
    conexion.destroy();
    throw error;
  }
  const promesa = conexion.promise();
  const salida = createGzip();
  const escrito = pipeline(salida, createWriteStream(destino));
  const escribir = async (texto: string) => {
    if (!salida.write(texto)) await once(salida, 'drain');
  };
  let tablas = 0;
  let filas = 0;
  try {
    await promesa.query("set time_zone = '+00:00'");
    const [lista] = (await promesa.query(
      `select table_name as t from information_schema.tables where table_schema = database() and table_type = 'BASE TABLE' order by table_name`,
    )) as unknown as [Array<{ t: string }>];
    await escribir(`-- Copia de la base ${d.base} hecha por GSGchat el ${new Date().toISOString()} (volcado propio, sin mysqldump).\n`);
    await escribir(CABECERA_VOLCADO);
    for (const { t } of lista) {
      const id = conexion.escapeId(t);
      const [crear] = (await promesa.query(`show create table ${id}`)) as unknown as [Array<Record<string, string>>];
      const ddl = crear[0]?.['Create Table'];
      if (!ddl) continue;
      tablas += 1;
      await escribir(`\n-- Tabla ${t}\nDROP TABLE IF EXISTS ${id};\n${ddl};\n`);
      let lote: string[] = [];
      let bytes = 0;
      let columnas = '';
      const vaciarLote = async () => {
        if (!lote.length) return;
        await escribir(`INSERT INTO ${id} (${columnas}) VALUES\n${lote.join(',\n')};\n`);
        lote = [];
        bytes = 0;
      };
      const filasDeLaTabla = conexion.query(`select * from ${id}`).stream({ highWaterMark: 200 }) as unknown as AsyncIterable<Record<string, unknown>>;
      for await (const fila of filasDeLaTabla) {
        if (!columnas) columnas = Object.keys(fila).map((c) => conexion.escapeId(c)).join(', ');
        const valores = `(${Object.values(fila).map((v) => conexion.escape(v)).join(', ')})`;
        lote.push(valores);
        bytes += valores.length;
        filas += 1;
        // Sentencias de ~512 KB como mucho: por debajo del max_allowed_packet de cualquier servidor.
        if (lote.length >= 500 || bytes > 512 * 1024) await vaciarLote();
      }
      await vaciarLote();
    }
    await escribir(PIE_VOLCADO);
    salida.end();
    await escrito;
  } catch (error) {
    salida.destroy();
    await escrito.catch(() => undefined);
    await rm(destino, { force: true }).catch(() => undefined);
    throw error;
  } finally {
    await promesa.end().catch(() => undefined);
  }
  return { tablas, filas };
}

export interface AjustesCopia {
  activa: boolean;
  hora: string;
  carpeta: string;
  conservar: number;
}

export interface DepsRespaldo {
  baseDatos: () => FuenteBase;
  /** Carpeta de los respaldos de chats (ARCHIVE_DIR). */
  archiveDir: string;
  carpetaPorDefecto: string;
  /**
   * Si nunca se copio, la primera copia es la de la PROXIMA noche y no la de
   * ahora. Lo pide la plataforma para cada tienda que arma: una tienda recien
   * creada no tiene nada que guardar, y volcar su base al nacer congelaba el
   * alta (ver src/plataforma/tienda.ts).
   */
  primeraCopiaLaProximaNoche?: boolean;
  ajustes: () => AjustesCopia;
  settingsRepo: SettingsRepo;
  ahora: () => Date;
  log: (m: string, d?: Record<string, unknown>) => void;
  /** Zona horaria, o una funcion que la da (la elegida en Ajustes). */
  timezone: string | (() => string);
  /** Inyectable: como se lanza mysqldump. `noEncontrado`: ese programa no esta (se prueba el siguiente). */
  ejecutar?: (cmd: string, args: string[], opciones?: { env?: NodeJS.ProcessEnv }) => Promise<{ ok: boolean; error?: string; noEncontrado?: boolean }>;
  /** Inyectable: donde se busca mysqldump (por defecto, candidatosMysqldump()). */
  mysqldump?: () => string[];
  cadaMs?: number;
}

export interface FicheroCopia {
  nombre: string;
  bytes: number;
  que: string;
}

export interface ResultadoCopia {
  at: string;
  quien: string;
  carpeta: string;
  ok: boolean;
  ficheros: FicheroCopia[];
  notas: string[];
  error: string | null;
  ms: number;
}

export interface CopiaGuardada {
  nombre: string;
  bytes: number;
  dia: string;
  que: 'base' | 'respaldos';
}

export interface EstadoCopia {
  ajustes: AjustesCopia;
  carpeta: string;
  carpetaEsLaDeSiempre: boolean;
  carpetaComprobada: { ok: boolean; detalle: string };
  base: { tipo: FuenteBase['tipo']; detalle: string };
  ultima: ResultadoCopia | null;
  copias: CopiaGuardada[];
  enMarcha: boolean;
  proxima: string;
  /** Rojo: no hay copia o la ultima tiene mas de dos dias. */
  alerta: string | null;
  restaurar: { pasos: string[] };
}

export interface ServicioRespaldo {
  hacerCopia(quien?: string): Promise<ResultadoCopia>;
  tick(): Promise<boolean>;
  estado(): Promise<EstadoCopia>;
  comprobarCarpeta(ruta?: string): Promise<{ ok: boolean; detalle: string; carpeta: string }>;
  /** La ruta de una copia para descargarla, o por que no. */
  ficheroDeCopia(nombre: string): Promise<{ ok: true; ruta: string; bytes: number } | { ok: false; error: string }>;
  carpeta(): string;
  recargar(): Promise<void>;
  arrancar(): () => void;
}

/** Donde van las copias si el dueno no dice otra cosa: OneDrive si lo hay, si no Documentos. */
export function carpetaDeCopiasPorDefecto(base = homedir()): string {
  const oneDrive = process.env.OneDrive || process.env.OneDriveConsumer || path.join(base, 'OneDrive');
  if (existsSync(oneDrive)) return path.join(oneDrive, 'GSGchat-copias');
  const documentos = path.join(base, 'Documents');
  if (existsSync(documentos)) return path.join(documentos, 'GSGchat-copias');
  return path.join(base, 'GSGchat-copias');
}

function ejecutarPorDefecto(cmd: string, args: string[], opciones: { env?: NodeJS.ProcessEnv } = {}): Promise<{ ok: boolean; error?: string; noEncontrado?: boolean }> {
  return new Promise((resolve) => {
    let hijo: ReturnType<typeof spawn>;
    try {
      hijo = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, env: opciones.env ?? process.env });
    } catch (error) {
      resolve({ ok: false, error: error instanceof Error ? error.message : String(error), noEncontrado: (error as { code?: string }).code === 'ENOENT' });
      return;
    }
    let err = '';
    hijo.stderr?.on('data', (d: Buffer) => (err += d.toString()));
    hijo.on('error', (error) => resolve({ ok: false, error: error.message, noEncontrado: (error as { code?: string }).code === 'ENOENT' }));
    hijo.on('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: err.trim() || `salió con código ${code}` }));
  });
}

export function explicarErrorDeCarpeta(error: unknown, carpeta: string): string {
  const code = (error as { code?: string })?.code ?? '';
  if (code === 'EACCES' || code === 'EPERM') return `No se puede escribir en ${carpeta}: Windows no deja (permisos). Elige otra carpeta, por ejemplo dentro de Documentos.`;
  if (code === 'ENOENT') return `La carpeta ${carpeta} no existe y no se pudo crear (¿la unidad está desconectada?).`;
  if (code === 'ENOSPC') return `No queda espacio en el disco de ${carpeta}.`;
  if (code === 'EROFS') return `${carpeta} es de solo lectura.`;
  return `No se pudo usar la carpeta ${carpeta}: ${error instanceof Error ? error.message : String(error)}.`;
}

export async function crearRespaldo(deps: DepsRespaldo): Promise<ServicioRespaldo> {
  const tz = (): string => (typeof deps.timezone === 'function' ? deps.timezone() : deps.timezone);
  const { ahora, log } = deps;
  const cadaMs = deps.cadaMs ?? 60_000;
  const ejecutar = deps.ejecutar ?? ejecutarPorDefecto;
  const dondeMysqldump = deps.mysqldump ?? (() => candidatosMysqldump());

  let ultima: ResultadoCopia | null = null;
  let ultimoDia = '';
  let enMarcha = false;

  async function recargar(): Promise<void> {
    ultima = null;
    ultimoDia = '';
    for (const row of await deps.settingsRepo.getAll()) {
      if (row.key === CLAVE_ULTIMA_COPIA) {
        try {
          ultima = JSON.parse(row.value) as ResultadoCopia;
        } catch {
          ultima = null;
        }
      } else if (row.key === CLAVE_ULTIMO_DIA_COPIA) ultimoDia = row.value;
    }
  }
  await recargar();
  // Una tienda recien creada (nunca se copio) no se copia al nacer: no hay
  // nada que guardar todavia y la copia congelaba el alta (volcar la base
  // ocupa el proceso). Su primera copia es la de la proxima noche.
  if (deps.primeraCopiaLaProximaNoche && !ultimoDia && !ultima) {
    ultimoDia = diaEn(ahora(), tz());
    await deps.settingsRepo.put(CLAVE_ULTIMO_DIA_COPIA, ultimoDia, false).catch(() => undefined);
  }

  const carpeta = () => deps.ajustes().carpeta.trim() || deps.carpetaPorDefecto;

  async function comprobarCarpeta(ruta?: string): Promise<{ ok: boolean; detalle: string; carpeta: string }> {
    const dir = (ruta ?? '').trim() || carpeta();
    try {
      await mkdir(dir, { recursive: true });
      const prueba = path.join(dir, `.gsgchat-prueba-${process.pid}`);
      await writeFile(prueba, 'ok');
      await unlink(prueba);
      await access(dir, constants.W_OK);
      return { ok: true, detalle: `Se puede escribir en ${dir}.`, carpeta: dir };
    } catch (error) {
      return { ok: false, detalle: explicarErrorDeCarpeta(error, dir), carpeta: dir };
    }
  }

  async function listarCopias(dir: string): Promise<CopiaGuardada[]> {
    let nombres: string[];
    try {
      nombres = await readdir(dir);
    } catch {
      return [];
    }
    const salida: CopiaGuardada[] = [];
    for (const nombre of nombres) {
      const m = NOMBRE_COPIA.exec(nombre);
      if (!m) continue;
      try {
        const s = await stat(path.join(dir, nombre));
        salida.push({ nombre, bytes: s.size, dia: m[2]!, que: m[1] as 'base' | 'respaldos' });
      } catch {
        // Se fue mientras se miraba.
      }
    }
    return salida.sort((a, b) => (a.dia === b.dia ? a.nombre.localeCompare(b.nombre) : b.dia.localeCompare(a.dia)));
  }

  async function podar(dir: string): Promise<number> {
    const conservar = Math.max(2, deps.ajustes().conservar);
    const copias = await listarCopias(dir);
    let borradas = 0;
    for (const que of ['base', 'respaldos'] as const) {
      const de = copias.filter((c) => c.que === que);
      for (const vieja of de.slice(conservar)) {
        try {
          await rm(path.join(dir, vieja.nombre));
          borradas += 1;
        } catch {
          // Si no se puede borrar, se queda: no es grave.
        }
      }
    }
    return borradas;
  }

  async function copiarBase(dir: string, dia: string, ficheros: FicheroCopia[], notas: string[]): Promise<void> {
    const fuente = deps.baseDatos();
    if (fuente.tipo === 'mysql') {
      const d = datosDe(fuente);
      const nombre = `base-${dia}.sql.gz`;
      const destino = path.join(dir, nombre);
      const que = 'La base de datos (contactos, chats, entregas, ajustes)';
      // 1. mysqldump, si esta: es quien mejor conoce al servidor. Deja un .sql
      //    al lado, que se comprime y se borra.
      const temporal = path.join(dir, `.base-${dia}-${process.pid}.sql`);
      let fallo: string | null = null;
      for (const programa of dondeMysqldump()) {
        const r = await ejecutar(
          programa,
          ['--host', d.host, '--port', String(d.port), '--user', d.user, '--single-transaction', '--no-tablespaces', '--hex-blob', '--default-character-set=utf8mb4', `--result-file=${temporal}`, d.base],
          // La clave va por el entorno y no en la linea de comandos (que la ve cualquiera en el administrador de tareas).
          { env: { ...process.env, MYSQL_PWD: d.password } },
        );
        if (r.ok) {
          try {
            await pipeline(createReadStream(temporal), createGzip(), createWriteStream(destino));
            const s = await stat(destino);
            ficheros.push({ nombre, bytes: s.size, que: `${que}, copiada con mysqldump` });
            return;
          } catch (error) {
            fallo = error instanceof Error ? error.message : String(error);
          } finally {
            await rm(temporal, { force: true }).catch(() => undefined);
          }
          break;
        }
        await rm(temporal, { force: true }).catch(() => undefined);
        if (r.noEncontrado || /ENOENT/.test(r.error ?? '')) continue;
        fallo = r.error ?? 'falló';
        break;
      }
      // 2. Sin mysqldump (o si fallo): el volcado propio.
      try {
        await volcarBaseEnJs(fuente, destino);
      } catch (error) {
        const e = error as { code?: string; message?: string };
        const porque = e?.code === 'ECONNREFUSED' ? `no hay ningún MySQL/MariaDB escuchando en ${d.host}:${d.port}` : (e?.message ?? String(error));
        throw new Error(`No se pudo leer la base «${d.base}» para copiarla: ${porque}.`);
      }
      const s = await stat(destino);
      ficheros.push({ nombre, bytes: s.size, que: `${que}, copiada con el volcado propio de GSGchat` });
      notas.push(
        fallo
          ? `mysqldump no pudo hacer la copia (${fallo}): la base se copió con el volcado propio de GSGchat, que se restaura igual.`
          : 'En este servidor no está mysqldump: la base se copió con el volcado propio de GSGchat, que se restaura igual. (Si lo instalas, o pones su ruta en MYSQLDUMP_PATH, se usa ese.)',
      );
      return;
    }
    notas.push('En la demostración la base está en memoria: no hay base que copiar.');
  }

  async function copiarRespaldos(dir: string, dia: string, ficheros: FicheroCopia[], notas: string[]): Promise<void> {
    const origen = path.resolve(deps.archiveDir);
    try {
      const s = await stat(origen);
      if (!s.isDirectory()) throw new Error('no es una carpeta');
    } catch {
      notas.push('Todavía no hay respaldos de chats que copiar (se crean al guardar la primera conversación).');
      return;
    }
    const nombre = `respaldos-${dia}.tar.gz`;
    const destino = path.join(dir, nombre);
    const r = await empaquetarCarpeta(origen, destino, { raizDentro: 'respaldos' });
    const s = await stat(destino);
    ficheros.push({ nombre, bytes: s.size, que: `Los respaldos de chats y sus adjuntos (${r.ficheros} ${r.ficheros === 1 ? 'fichero' : 'ficheros'}, ${bytesEnPalabras(r.bytes)} sin comprimir)` });
  }

  let enCurso: Promise<ResultadoCopia> | null = null;

  /** Una copia a la vez: quien llega mientras hay una en marcha espera a esa misma (no arranca otra). */
  function hacerCopia(quien = 'cada noche'): Promise<ResultadoCopia> {
    if (enCurso) return enCurso;
    enCurso = hacerCopiaDeVerdad(quien).finally(() => {
      enCurso = null;
    });
    return enCurso;
  }

  async function hacerCopiaDeVerdad(quien: string): Promise<ResultadoCopia> {
    enMarcha = true;
    const t0 = Date.now();
    const dir = carpeta();
    const dia = diaEn(ahora(), tz());
    const ficheros: FicheroCopia[] = [];
    const notas: string[] = ['La vinculación del teléfono (.wa-auth) no se copia: es la sesión de WhatsApp de este servidor; si se restaura en otro, se escanea el QR otra vez.'];
    let error: string | null = null;
    try {
      const c = await comprobarCarpeta(dir);
      if (!c.ok) throw new Error(c.detalle);
      // Un respiro antes del volcado (lo mas pesado): lo que estaba en cola
      // (una peticion, un mensaje entrante) sale primero.
      await new Promise((r) => setImmediate(r));
      await copiarBase(dir, dia, ficheros, notas);
      await new Promise((r) => setImmediate(r));
      await copiarRespaldos(dir, dia, ficheros, notas);
      const borradas = await podar(dir);
      if (borradas) notas.push(`Se borraron ${borradas} ${borradas === 1 ? 'copia vieja' : 'copias viejas'} (se conservan las últimas ${deps.ajustes().conservar}).`);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    ultima = { at: ahora().toISOString(), quien, carpeta: dir, ok: !error, ficheros, notas, error, ms: Date.now() - t0 };
    enMarcha = false;
    await deps.settingsRepo.put(CLAVE_ULTIMA_COPIA, JSON.stringify(ultima), false).catch(() => undefined);
    log(error ? 'copia de seguridad: falló' : 'copia de seguridad: hecha', { quien, carpeta: dir, ficheros: ficheros.length, error });
    return ultima;
  }

  async function tick(): Promise<boolean> {
    const a = deps.ajustes();
    if (!a.activa || enMarcha) return false;
    const t = ahora();
    const dia = diaEn(t, tz());
    if (ultimoDia === dia) return false;
    if (minutosDelDia(t, tz()) < minutosDe(a.hora)) return false;
    ultimoDia = dia;
    await deps.settingsRepo.put(CLAVE_ULTIMO_DIA_COPIA, dia, false).catch(() => undefined);
    await hacerCopia('cada noche');
    return true;
  }

  function describirBase(): { tipo: FuenteBase['tipo']; detalle: string } {
    const f = deps.baseDatos();
    if (f.tipo === 'mysql') {
      try {
        const d = datosDe(f);
        return { tipo: 'mysql', detalle: `La base es «${d.base}», en el servidor MySQL/MariaDB ${d.host}:${d.port}: se copia entera a base-AAAA-MM-DD.sql.gz (con mysqldump si está; si no, con el volcado propio de GSGchat).` };
      } catch (error) {
        return { tipo: 'mysql', detalle: error instanceof Error ? error.message : String(error) };
      }
    }
    return { tipo: 'memoria', detalle: 'En la demostración la base está en memoria: no hay nada que copiar.' };
  }

  function pasosParaRestaurar(): string[] {
    const f = deps.baseDatos();
    let base = '';
    try {
      if (f.tipo === 'mysql') base = datosDe(f).base;
    } catch {
      // Sin nombre: se dice en general.
    }
    return [
      'Para el servidor de GSGchat (cierra la ventana o Ctrl+C).',
      'Descarga la copia base-…sql.gz de aquí abajo.',
      `Abre phpMyAdmin (con XAMPP: http://localhost/phpmyadmin), elige la base ${base ? `«${base}»` : 'de GSGchat'}, entra en «Importar», elige el fichero base-…sql.gz tal cual (no hace falta descomprimirlo) y pulsa «Continuar». La copia trae cada tabla entera: reemplaza lo que haya en ellas.`,
      `Sin phpMyAdmin: descomprime el .sql.gz (con 7-Zip, por ejemplo) y ejecuta: mysql -u usuario -p ${base || 'nombre_de_la_base'} < base-….sql`,
      'Si también quieres los chats guardados, descomprime respaldos-…tar.gz encima de la carpeta de respaldos.',
      'Arranca el servidor otra vez y entra en Conexión: si pide el QR, escanéalo con el teléfono del número.',
    ];
  }

  return {
    hacerCopia,
    tick,
    async estado() {
      const a = deps.ajustes();
      const dir = carpeta();
      const [comprobada, copias] = await Promise.all([comprobarCarpeta(dir), listarCopias(dir)]);
      const t = ahora();
      let alerta: string | null = null;
      if (!ultima && !copias.length) alerta = a.activa ? `Todavía no hay ninguna copia: la primera se hará hoy a las ${a.hora}, o pulsa "Hacer copia ahora".` : 'La copia diaria está apagada y no hay ninguna copia hecha.';
      else if (ultima && !ultima.ok) alerta = `La última copia falló: ${ultima.error}`;
      else if (ultima && t.getTime() - new Date(ultima.at).getTime() > 2 * 24 * 60 * 60_000) alerta = `La última copia tiene más de dos días (${diaEn(new Date(ultima.at), tz())}): revisa que la hora y la carpeta sigan bien.`;
      let proxima: string;
      const dia = diaEn(t, tz());
      if (!a.activa) proxima = 'apagada: no se copia nada solo';
      else if (ultimoDia === dia || minutosDelDia(t, tz()) >= minutosDe(a.hora)) proxima = `mañana a las ${a.hora}`;
      else proxima = `hoy a las ${a.hora}`;
      return {
        ajustes: a,
        carpeta: dir,
        carpetaEsLaDeSiempre: !a.carpeta.trim(),
        carpetaComprobada: { ok: comprobada.ok, detalle: comprobada.detalle },
        base: describirBase(),
        ultima,
        copias,
        enMarcha,
        proxima,
        alerta,
        restaurar: { pasos: pasosParaRestaurar() },
      };
    },
    comprobarCarpeta,
    async ficheroDeCopia(nombre) {
      if (!NOMBRE_COPIA.test(nombre)) return { ok: false, error: 'Ese nombre no es de una copia de aquí.' };
      const ruta = path.join(carpeta(), nombre);
      try {
        const s = await stat(ruta);
        return { ok: true, ruta, bytes: s.size };
      } catch {
        return { ok: false, error: 'Esa copia ya no está en la carpeta.' };
      }
    },
    carpeta,
    recargar,
    arrancar() {
      const timer = setInterval(() => {
        void tick().catch((error) => log('copia de seguridad: fallo en la vuelta', { detalle: error instanceof Error ? error.message : String(error) }));
      }, cadaMs);
      timer.unref?.();
      return () => clearInterval(timer);
    },
  };
}
