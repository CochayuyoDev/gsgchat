/**
 * La copia de seguridad diaria: la base y los respaldos de chats, cada
 * noche, a una carpeta que elige el dueno.
 *
 * Que se copia y como:
 *  - la base: con PGlite, un volcado de su carpeta de datos (`dumpDataDir`,
 *    ya comprimido) -> `base-AAAA-MM-DD.tar.gz`; con Postgres de verdad,
 *    `pg_dump` si esta en el PATH, y si no se dice claro que la copia de la
 *    base la hace el servidor de Postgres y aqui solo van los respaldos;
 *  - los respaldos de chats y sus adjuntos (`ARCHIVE_DIR`) ->
 *    `respaldos-AAAA-MM-DD.tar.gz` (tar propio, ver tar.ts);
 *  - la vinculacion del telefono (`.wa-auth`) NO se copia: es la sesion de
 *    WhatsApp de ese servidor; en otro sitio hay que escanear el QR igual.
 *
 * Se conservan las ultimas N copias (14) y las demas se borran. Restaurar es
 * con el servidor parado, y la pantalla explica los pasos y da el fichero.
 */

import { access, constants, mkdir, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { SettingsRepo } from '../settings/service.js';
import { bytesEnPalabras, diaEn, minutosDe, minutosDelDia } from '../salud/fiabilidad.js';
import { empaquetarCarpeta } from './tar.js';

export const CLAVE_ULTIMA_COPIA = 'respaldo.ultima';
export const CLAVE_ULTIMO_DIA_COPIA = 'respaldo.ultimoDia';
const NOMBRE_COPIA = /^(base|respaldos)-(\d{4}-\d{2}-\d{2})\.(tar\.gz|dump)$/;

export type FuenteBase = { tipo: 'pglite'; dump: () => Promise<Blob | File>; dataDir?: string } | { tipo: 'postgres'; url: string } | { tipo: 'memoria' };

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
  ajustes: () => AjustesCopia;
  settingsRepo: SettingsRepo;
  ahora: () => Date;
  log: (m: string, d?: Record<string, unknown>) => void;
  timezone: string;
  /** Inyectable: como se lanza pg_dump. */
  ejecutar?: (cmd: string, args: string[]) => Promise<{ ok: boolean; error?: string }>;
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

function ejecutarPorDefecto(cmd: string, args: string[]): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    let hijo: ReturnType<typeof spawn>;
    try {
      hijo = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    } catch (error) {
      resolve({ ok: false, error: error instanceof Error ? error.message : String(error) });
      return;
    }
    let err = '';
    hijo.stderr?.on('data', (d: Buffer) => (err += d.toString()));
    hijo.on('error', (error) => resolve({ ok: false, error: error.message }));
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
  const { ahora, log } = deps;
  const cadaMs = deps.cadaMs ?? 60_000;
  const ejecutar = deps.ejecutar ?? ejecutarPorDefecto;

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
    if (fuente.tipo === 'pglite') {
      const blob = await fuente.dump();
      const nombre = `base-${dia}.tar.gz`;
      const datos = Buffer.from(await blob.arrayBuffer());
      await writeFile(path.join(dir, nombre), datos);
      ficheros.push({ nombre, bytes: datos.length, que: 'La base de datos (contactos, chats, entregas, ajustes)' });
      return;
    }
    if (fuente.tipo === 'postgres') {
      const nombre = `base-${dia}.dump`;
      const destino = path.join(dir, nombre);
      const r = await ejecutar('pg_dump', ['--dbname', fuente.url, '-Fc', '-f', destino]);
      if (r.ok) {
        const s = await stat(destino);
        ficheros.push({ nombre, bytes: s.size, que: 'La base de datos (volcado de Postgres, se restaura con pg_restore)' });
      } else {
        await rm(destino, { force: true }).catch(() => undefined);
        notas.push('Con Postgres la copia de la base la hace tu servidor de Postgres (aquí no está pg_dump): aquí solo se copian los respaldos de chats.');
      }
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

  async function hacerCopia(quien = 'cada noche'): Promise<ResultadoCopia> {
    if (enMarcha && ultima) return ultima;
    enMarcha = true;
    const t0 = Date.now();
    const dir = carpeta();
    const dia = diaEn(ahora(), deps.timezone);
    const ficheros: FicheroCopia[] = [];
    const notas: string[] = ['La vinculación del teléfono (.wa-auth) no se copia: es la sesión de WhatsApp de este servidor; si se restaura en otro, se escanea el QR otra vez.'];
    let error: string | null = null;
    try {
      const c = await comprobarCarpeta(dir);
      if (!c.ok) throw new Error(c.detalle);
      await copiarBase(dir, dia, ficheros, notas);
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
    const dia = diaEn(t, deps.timezone);
    if (ultimoDia === dia) return false;
    if (minutosDelDia(t, deps.timezone) < minutosDe(a.hora)) return false;
    ultimoDia = dia;
    await deps.settingsRepo.put(CLAVE_ULTIMO_DIA_COPIA, dia, false).catch(() => undefined);
    await hacerCopia('cada noche');
    return true;
  }

  function describirBase(): { tipo: FuenteBase['tipo']; detalle: string } {
    const f = deps.baseDatos();
    if (f.tipo === 'pglite') return { tipo: 'pglite', detalle: `La base vive en la carpeta ${f.dataDir ?? '.wa-data'} de este servidor y se copia entera.` };
    if (f.tipo === 'postgres') return { tipo: 'postgres', detalle: 'La base es un Postgres aparte: se copia con pg_dump si está instalado en este servidor.' };
    return { tipo: 'memoria', detalle: 'En la demostración la base está en memoria: no hay nada que copiar.' };
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
      else if (ultima && t.getTime() - new Date(ultima.at).getTime() > 2 * 24 * 60 * 60_000) alerta = `La última copia tiene más de dos días (${diaEn(new Date(ultima.at), deps.timezone)}): revisa que la hora y la carpeta sigan bien.`;
      let proxima: string;
      const dia = diaEn(t, deps.timezone);
      if (!a.activa) proxima = 'apagada: no se copia nada solo';
      else if (ultimoDia === dia || minutosDelDia(t, deps.timezone) >= minutosDe(a.hora)) proxima = `mañana a las ${a.hora}`;
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
        restaurar: {
          pasos: [
            'Para el servidor de GSGchat (cierra la ventana o Ctrl+C).',
            'Cambia el nombre de la carpeta .wa-data actual (por ejemplo a .wa-data-vieja) por si acaso.',
            'Descarga la copia base-…tar.gz de aquí abajo y descomprímela: dentro viene la carpeta de la base; ponla donde estaba .wa-data, con ese mismo nombre.',
            'Si también quieres los chats guardados, descomprime respaldos-…tar.gz encima de la carpeta de respaldos.',
            'Arranca el servidor otra vez y entra en Conexión: si pide el QR, escanéalo con el teléfono del número.',
          ],
        },
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
