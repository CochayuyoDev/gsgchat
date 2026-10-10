/**
 * La plataforma: muchas tiendas independientes en un mismo servidor.
 *
 * Cada registro en /registro es una tienda NUEVA, con su base, su WhatsApp,
 * sus carpetas y sus secretos (ver tienda.ts). Aqui se decide:
 *
 *   - donde vive cada tienda (una carpeta por tienda bajo `raiz`, y en
 *     Postgres un esquema tienda_<id>);
 *   - que tiendas estan cargadas (todas las activas se cargan al arrancar:
 *     su WhatsApp tiene que recibir mensajes aunque nadie haya entrado);
 *   - a que tienda va cada usuario al entrar (el directorio);
 *   - como nace una tienda: fila en el directorio, usuario apartado,
 *     carpetas, base con sus migraciones, datos principales (nombre, celular
 *     de avisos) y la cuenta de su dueño, ya con la sesion abierta.
 *
 * La tienda de siempre (la instalacion de antes de la plataforma) sigue
 * igual, con sus carpetas y su base de siempre: es la "principal", y a ella
 * va todo lo que llega sin decir tienda (sus webhooks, sus claves de API).
 */

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { bootstrapSecrets } from '../settings/crypto.js';
import { claveAceptable, usuarioAceptable } from '../auth/usuarios.js';
import { asPool, firmaDeMigraciones, openPglite } from '../db/pglite.js';
import { createPool, esquemaSeguro, type Pool } from '../db/pool.js';
import { RUBROS } from '../web/login-page.js';
import { crearDirectorio, type Directorio, type TiendaRegistrada } from './directorio.js';
import { entornoDeTienda, lugarDeTienda, pareceSlug, slugDe } from './entorno.js';
import { armarTienda, type BaseDeTienda, type OpcionesTienda, type TiendaViva } from './tienda.js';
import { enTienda } from './contexto.js';
import type { DirectorioUsuarios } from '../auth/routes.js';

/** Lo que la instalacion de siempre aporta como tienda principal. */
export type OpcionesPrincipal = Omit<OpcionesTienda, 'id' | 'slug' | 'primeraCuentaRol' | 'directorio'>;

export interface OpcionesPlataforma {
  /** Carpeta de las tiendas nuevas (una subcarpeta por tienda) y del directorio en PGlite. */
  raiz: string;
  /** La URL publica del servidor, sin barra al final. La de cada tienda es esta + /tienda/<slug>. */
  publicBaseUrl: string;
  /** El entorno del proceso: de aqui solo se hereda lo de la lista cerrada (ver entorno.ts). */
  proceso: NodeJS.ProcessEnv;
  /** Lo que el arranque fuerza en todas las tiendas nuevas (p. ej. simular entrantes en el arranque corto). */
  extraTiendas?: NodeJS.ProcessEnv;
  /** Donde van las bases: carpetas PGlite o esquemas de un Postgres. */
  base: { tipo: 'pglite' } | { tipo: 'postgres'; url: string };
  redisUrl?: string | null;
  /** La tienda de siempre, si esta instalacion ya tenia una. */
  principal?: OpcionesPrincipal | null;
  logger?: boolean;
  autoConectarLocal: boolean;
  sembrarPlantillasLocales: boolean;
  /** Carpeta de copias de la principal; las demas usan <esta>/<slug>. */
  carpetaCopias: string;
  /** Registros por IP y hora (freno a quien crea tiendas en bucle). */
  registrosPorHora?: number;
  log?: (m: string) => void;
  ahora?: () => number;
}

export interface ResultadoRegistro {
  ok: boolean;
  status: number;
  error?: string;
  tienda?: TiendaRegistrada;
  /** Las cookies de sesion que puso la tienda al crear la cuenta de su dueño. */
  setCookie?: string[];
  next?: string;
}

export interface ResultadoEntrada {
  status: number;
  body: Record<string, unknown>;
  tienda?: TiendaRegistrada;
  setCookie?: string[];
}

export interface Plataforma {
  directorio: Directorio;
  arrancar(): Promise<void>;
  /** La tienda viva por slug (la carga si hace falta). null si no existe o esta suspendida. */
  tiendaPorSlug(slug: string): Promise<TiendaViva | null>;
  tiendaPrincipal(): Promise<TiendaViva | null>;
  registrar(datos: unknown, ip: string): Promise<ResultadoRegistro>;
  entrar(datos: { usuario: string; clave: string; next?: string }, ip: string): Promise<ResultadoEntrada>;
  usuarioLibre(usuario: string): Promise<boolean>;
  /** Cuantas tiendas hay registradas (0 = plataforma recien puesta). */
  cuantas(): Promise<number>;
  parar(): Promise<void>;
}

export const ID_PRINCIPAL = 'principal';

/** Lo que manda el formulario "Crear mi tienda". */
export const registroSchema = z.object({
  tienda: z.string().trim().min(1, 'Escribe el nombre de tu tienda.').max(80, 'El nombre de la tienda es demasiado largo (80 letras como mucho).'),
  rubro: z.enum(RUBROS).nullable().optional(),
  nombre: z.string().trim().min(1, 'Escribe tu nombre.').max(80, 'Tu nombre es demasiado largo.'),
  celular: z.string().trim().max(20).nullable().optional(),
  usuario: z.string().trim().min(1, 'Elige un usuario para entrar.').max(60),
  clave: z.string().min(1, 'Elige una contraseña.').max(200),
});

/** "987 654 321" -> "51987654321". null si no parece un celular. */
export function celularDe(texto: string | null | undefined): string | null | 'mal' {
  const digitos = (texto ?? '').replace(/\D+/g, '');
  if (!digitos) return null;
  // Un celular de Peru sin el codigo de pais: 9 digitos empezando por 9.
  if (/^9\d{8}$/.test(digitos)) return `51${digitos}`;
  if (digitos.length >= 10 && digitos.length <= 15) return digitos;
  return 'mal';
}

export async function crearPlataforma(opciones: OpcionesPlataforma): Promise<Plataforma> {
  // `principal` puede quedar aparcada al arrancar (sin cuentas): por eso es una copia.
  const o: OpcionesPlataforma = { ...opciones };
  const log = o.log ?? ((m: string) => console.log(`[plataforma] ${m}`));
  const ahora = o.ahora ?? (() => Date.now());
  mkdirSync(o.raiz, { recursive: true });

  // --- el directorio ---------------------------------------------------------
  let poolDirectorio: Pool;
  let cerrarDirectorio: () => Promise<void>;
  if (o.base.tipo === 'pglite') {
    const h = await openPgliteSinMigraciones(path.join(o.raiz, 'plataforma'));
    poolDirectorio = h.pool;
    cerrarDirectorio = h.cerrar;
  } else {
    const admin = createPool(o.base.url);
    await admin.query('create schema if not exists plataforma');
    await admin.end();
    poolDirectorio = createPool(o.base.url, 'plataforma');
    cerrarDirectorio = () => poolDirectorio.end();
  }
  const directorio = await crearDirectorio(poolDirectorio);

  const vivas = new Map<string, Promise<TiendaViva>>();

  /** El directorio visto desde una tienda: reserva para ELLA. */
  const directorioDe = (tiendaId: string): DirectorioUsuarios => ({
    reservar: async (usuario) => (await directorio.reservar(usuario, tiendaId)) || (await directorio.tiendaDe(usuario)) === tiendaId,
    liberar: (usuario) => directorio.liberar(usuario, tiendaId),
  });

  const esquemaDe = (id: string) => esquemaSeguro(`tienda_${id}`);

  // --- el molde ----------------------------------------------------------------
  // Una base PGlite nueva tarda ~8 s en aplicar todas las migraciones; abrir
  // una ya migrada, 0,2 s. Se prepara una vez (en segundo plano, al arrancar)
  // y cada tienda nueva empieza COPIANDOLA: quien se registra no espera. Si
  // las migraciones cambian, la huella no cuadra y se rehace. El molde no
  // tiene datos de nadie: es la base vacia recien migrada.
  const MOLDE = path.join(o.raiz, '.molde');
  let moldeListo: Promise<boolean> = Promise.resolve(false);
  async function prepararMolde(): Promise<boolean> {
    if (o.base.tipo !== 'pglite') return false;
    const firma = await firmaDeMigraciones();
    const ficheroFirma = path.join(MOLDE, 'firma.txt');
    if (existsSync(ficheroFirma) && readFileSync(ficheroFirma, 'utf8') === firma) return true;
    const temporal = `${MOLDE}-${randomBytes(3).toString('hex')}`;
    // PGlite crea su carpeta, pero no la de encima.
    mkdirSync(temporal, { recursive: true });
    const h = await openPglite(path.join(temporal, 'datos'));
    await h.db.close();
    writeFileSync(path.join(temporal, 'firma.txt'), firma);
    await rm(MOLDE, { recursive: true, force: true });
    await rename(temporal, MOLDE);
    return true;
  }
  /** Deja la base de una tienda nueva copiada del molde (si esta listo y la tienda aun no tiene base). */
  async function desdeElMolde(datos: string): Promise<void> {
    if (existsSync(datos)) return;
    const listo = await moldeListo.catch(() => false);
    if (listo && existsSync(path.join(MOLDE, 'datos'))) cpSync(path.join(MOLDE, 'datos'), datos, { recursive: true });
  }

  function opcionesDe(t: TiendaRegistrada, primeraCuentaRol: 'superadmin' | 'admin'): OpcionesTienda {
    if (t.principal && o.principal) {
      return { ...o.principal, id: t.id, slug: t.slug, primeraCuentaRol: 'superadmin', directorio: directorioDe(t.id) };
    }
    const lugar = lugarDeTienda(o.raiz, t.id);
    for (const dir of [lugar.dir, lugar.medios, lugar.respaldos]) mkdirSync(dir, { recursive: true });
    const secretos = bootstrapSecrets(lugar.dir);
    const base: BaseDeTienda = o.base.tipo === 'pglite' ? { tipo: 'pglite', dir: lugar.datos } : { tipo: 'postgres', url: o.base.url, esquema: esquemaDe(t.id) };
    const publicBaseUrl = `${o.publicBaseUrl.replace(/\/+$/, '')}/tienda/${t.slug}`;
    return {
      id: t.id,
      slug: t.slug,
      env: entornoDeTienda(
        o.proceso,
        {
          publicBaseUrl,
          databaseUrl: o.base.tipo === 'pglite' ? `pglite://${lugar.datos}` : o.base.url,
          trackingSecret: secretos.trackingSecret,
          archiveDir: lugar.respaldos,
          nombre: t.nombre,
        },
        o.extraTiendas,
      ),
      secretos,
      base,
      authDir: lugar.vinculacion,
      mediaDir: lugar.medios,
      carpetaCopias: path.join(o.carpetaCopias, t.slug),
      redisUrl: o.redisUrl ?? null,
      nombreCola: `wa-outbound-${t.id}`,
      primeraCuentaRol,
      directorio: directorioDe(t.id),
      autoConectarLocal: o.autoConectarLocal,
      sembrarPlantillasLocales: o.sembrarPlantillasLocales,
      logger: o.logger,
      prefijoLog: `[${t.slug}] `,
    };
  }

  /** Arma la tienda una sola vez aunque la pidan dos peticiones a la vez. */
  function cargar(t: TiendaRegistrada, primeraCuentaRol: 'superadmin' | 'admin' = 'admin'): Promise<TiendaViva> {
    const ya = vivas.get(t.id);
    if (ya) return ya;
    const promesa = (async () => {
      const viva = await armarTienda(opcionesDe(t, primeraCuentaRol));
      // Las cuentas que ya tenia (la principal al pasar a la plataforma, o una
      // tienda tras un corte a medias) quedan en el directorio.
      const ajenos = await directorio.sincronizar(t.id, await viva.usuarios());
      if (ajenos.length) log(`la tienda ${t.slug} tiene usuarios que ya son de otra tienda y no podran entrar por /login: ${ajenos.join(', ')}`);
      return viva;
    })();
    vivas.set(t.id, promesa);
    promesa.catch(() => vivas.delete(t.id));
    return promesa;
  }

  // --- registrar -------------------------------------------------------------
  const registrosPorIp = new Map<string, number[]>();
  const LIMITE = o.registrosPorHora ?? 5;

  async function slugUnico(nombre: string): Promise<string> {
    const base = slugDe(nombre);
    if (await directorio.slugLibre(base)) return base;
    for (let n = 2; n < 1000; n++) {
      const candidato = `${base.slice(0, 26)}-${n}`;
      if (await directorio.slugLibre(candidato)) return candidato;
    }
    return `${base.slice(0, 20)}-${randomBytes(3).toString('hex')}`;
  }

  async function deshacer(id: string, viva: TiendaViva | null): Promise<void> {
    vivas.delete(id);
    await viva?.parar().catch(() => undefined);
    await directorio.borrar(id).catch(() => undefined);
    await rm(lugarDeTienda(o.raiz, id).dir, { recursive: true, force: true }).catch(() => undefined);
    if (o.base.tipo === 'postgres') {
      const admin = createPool(o.base.url);
      await admin.query(`drop schema if exists ${esquemaDe(id)} cascade`).catch(() => undefined);
      await admin.end();
    }
  }

  async function registrar(datos: unknown, ip: string): Promise<ResultadoRegistro> {
    const leido = registroSchema.safeParse(datos ?? {});
    if (!leido.success) return { ok: false, status: 400, error: leido.error.issues[0]?.message ?? 'Revisa los datos del formulario.' };
    const d = leido.data;
    const usuario = d.usuario.toLowerCase();
    const malUsuario = usuarioAceptable(usuario);
    if (malUsuario) return { ok: false, status: 400, error: malUsuario };
    const malClave = claveAceptable(d.clave);
    if (malClave) return { ok: false, status: 400, error: malClave };
    const celular = celularDe(d.celular);
    if (celular === 'mal') return { ok: false, status: 400, error: 'Tu celular no se entiende: escríbelo con sus 9 números (987 654 321) o con el código de país.' };

    // Freno a quien crea tiendas en bucle desde la misma direccion.
    const t0 = ahora();
    const recientes = (registrosPorIp.get(ip) ?? []).filter((t) => t > t0 - 60 * 60_000);
    if (recientes.length >= LIMITE) {
      return { ok: false, status: 429, error: 'Se crearon demasiadas tiendas desde esta conexión en la última hora. Espera un rato y vuelve a intentarlo.' };
    }
    // El hueco se aparta YA, sin nada asincrono entre mirar y apartar: dos
    // registros simultaneos desde la misma conexion ya no pasan los dos. Si
    // el registro no llega a crear la tienda, se devuelve.
    const hueco = t0 + Math.random();
    recientes.push(hueco);
    registrosPorIp.set(ip, recientes);
    const devolverHueco = () => {
      const lista = registrosPorIp.get(ip);
      const i = lista?.indexOf(hueco) ?? -1;
      if (lista && i >= 0) lista.splice(i, 1);
    };
    try {
      const r = await crearTiendaNueva(d, usuario, celular, ip);
      if (!r.ok) devolverHueco();
      return r;
    } catch (error) {
      devolverHueco();
      throw error;
    }
  }

  async function crearTiendaNueva(d: z.infer<typeof registroSchema>, usuario: string, celular: string | null, ip: string): Promise<ResultadoRegistro> {

    if (await directorio.tiendaDe(usuario)) return { ok: false, status: 400, error: 'Ese usuario ya lo usa otra cuenta. Elige otro.' };

    // La primera tienda de una plataforma recien puesta es la de su dueño.
    const primeraCuentaRol = (await directorio.tiendas()).length === 0 ? 'superadmin' : 'admin';
    const id = randomBytes(6).toString('hex');
    // El slug se elige libre, pero otro registro simultaneo con el mismo
    // nombre puede ganarlo entre medias: se reintenta con el siguiente.
    let registrada: TiendaRegistrada | null = null;
    for (let intento = 0; !registrada && intento < 5; intento++) {
      try {
        registrada = await directorio.crear({ id, slug: await slugUnico(d.tienda), nombre: d.tienda, rubro: d.rubro ?? null, ip });
      } catch (error) {
        if ((error as { code?: string }).code !== '23505' && !/duplicate key|unique/i.test(String((error as Error).message))) throw error;
      }
    }
    if (!registrada) return { ok: false, status: 409, error: 'Justo se estaba creando otra tienda con ese nombre. Vuelve a intentarlo.' };
    if (!(await directorio.reservar(usuario, id))) {
      await deshacer(id, null);
      return { ok: false, status: 400, error: 'Ese usuario ya lo usa otra cuenta. Elige otro.' };
    }

    let viva: TiendaViva | null = null;
    try {
      if (o.base.tipo === 'pglite') await desdeElMolde(lugarDeTienda(o.raiz, id).datos);
      viva = await cargar(registrada, primeraCuentaRol);
      const tienda = viva;
      return await enTienda(tienda.contexto, async () => {
        // Los datos principales de la tienda, en su propia configuracion.
        await tienda.ajustes.guardar({ nombreNegocio: d.tienda, modo: 'completo', ...(celular ? { avisos: { supervisor: celular } } : {}) });
        const alta = await tienda.app.inject({
          method: 'POST',
          url: '/login/primera-cuenta',
          payload: { nombre: d.nombre, usuario, clave: d.clave },
          remoteAddress: ip,
        });
        if (alta.statusCode !== 200) {
          const motivo = (() => {
            try {
              return (alta.json() as { error?: string }).error;
            } catch {
              return undefined;
            }
          })();
          throw new ErrorDeRegistro(alta.statusCode, motivo ?? 'No se pudo crear la cuenta de la tienda.');
        }
        log(`tienda nueva: ${registrada.slug} (${registrada.nombre}) por ${usuario}`);
        return { ok: true, status: 200, tienda: registrada, setCookie: cookiesDe(alta.headers['set-cookie']), next: '/panel' };
      });
    } catch (error) {
      await deshacer(id, viva);
      if (error instanceof ErrorDeRegistro) return { ok: false, status: error.status >= 500 ? 500 : 400, error: error.message };
      log(`no se pudo crear la tienda ${registrada.slug}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      return { ok: false, status: 500, error: 'No se pudo crear tu tienda por un fallo del servidor. Vuelve a intentarlo en un momento.' };
    }
  }

  // --- entrar ----------------------------------------------------------------
  const fallos = new Map<string, { n: number; hasta: number }>();

  async function entrar(datos: { usuario: string; clave: string; next?: string }, ip: string): Promise<ResultadoEntrada> {
    const f = fallos.get(ip);
    if (f && f.hasta > ahora()) return { status: 429, body: { error: `Demasiados intentos. Espera ${Math.ceil((f.hasta - ahora()) / 60_000)} minuto(s).` } };
    const usuario = String(datos.usuario ?? '').trim().toLowerCase();
    const tiendaId = usuario ? await directorio.tiendaDe(usuario) : null;
    const registrada = tiendaId ? await directorio.porId(tiendaId) : null;
    if (!registrada) {
      // El mismo mensaje que una contraseña mala: no se dice que usuarios existen.
      const g = fallos.get(ip) ?? { n: 0, hasta: 0 };
      g.n += 1;
      if (g.n >= 5) {
        g.hasta = ahora() + 5 * 60_000;
        g.n = 0;
      }
      fallos.set(ip, g);
      return { status: 401, body: { error: 'Usuario o contraseña incorrectos.' } };
    }
    if (registrada.estado === 'suspendida') return { status: 403, body: { error: 'Esta tienda está suspendida. Escribe a soporte para reactivarla.' } };
    const viva = await cargar(registrada);
    const res = await enTienda(viva.contexto, () =>
      viva.app.inject({ method: 'POST', url: '/login', payload: { usuario, clave: datos.clave, next: datos.next }, remoteAddress: ip }),
    );
    let body: Record<string, unknown>;
    try {
      body = res.json() as Record<string, unknown>;
    } catch {
      body = { error: 'No se pudo entrar. Vuelve a intentarlo.' };
    }
    if (res.statusCode === 200) fallos.delete(ip);
    return { status: res.statusCode, body, tienda: registrada, setCookie: cookiesDe(res.headers['set-cookie']) };
  }

  return {
    directorio,
    arrancar: async () => {
      // El molde se prepara mientras tanto; el primer registro lo espera si hace falta.
      moldeListo = prepararMolde().catch((error: unknown) => {
        log(`no se pudo preparar el molde de las tiendas nuevas (se crearan de cero): ${error instanceof Error ? error.message : String(error)}`);
        return false;
      });
      // La tienda de siempre: se apunta en el directorio la primera vez. Si
      // no tiene ninguna cuenta (una carpeta de datos de una prueba, una base
      // vacia), no es una tienda de nadie: se aparca y la primera que se
      // registre sera la del dueño de la plataforma.
      if (o.principal) {
        const existia = await directorio.porId(ID_PRINCIPAL);
        if (!existia) await directorio.crear({ id: ID_PRINCIPAL, slug: ID_PRINCIPAL, nombre: o.principal.env.BUSINESS_NAME?.trim() || 'Tienda principal', rubro: null, principal: true });
        const fila = (await directorio.porId(ID_PRINCIPAL))!;
        const viva = await cargar(fila);
        if ((await viva.usuarios()).length === 0) {
          log('la instalacion de antes no tiene cuentas: no se usa como tienda principal');
          vivas.delete(ID_PRINCIPAL);
          await viva.parar();
          await directorio.borrar(ID_PRINCIPAL);
          o.principal = null;
        }
      }
      for (const t of await directorio.tiendas()) {
        if (t.estado !== 'activa') continue;
        if (t.principal && !o.principal) continue;
        try {
          await cargar(t);
          log(`tienda cargada: ${t.slug}${t.principal ? ' (principal)' : ''}`);
        } catch (error) {
          log(`no se pudo cargar la tienda ${t.slug}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    },
    tiendaPorSlug: async (slug) => {
      if (!pareceSlug(slug)) return null;
      const t = await directorio.porSlug(slug);
      if (!t || t.estado !== 'activa' || (t.principal && !o.principal)) return null;
      return cargar(t);
    },
    tiendaPrincipal: async () => {
      if (!o.principal) return null;
      const t = await directorio.porId(ID_PRINCIPAL);
      return t && t.estado === 'activa' ? cargar(t) : null;
    },
    registrar,
    entrar,
    usuarioLibre: async (usuario) => !(await directorio.tiendaDe(usuario)),
    cuantas: async () => (await directorio.tiendas()).length,
    parar: async () => {
      await moldeListo.catch(() => false);
      const todas = await Promise.allSettled([...vivas.values()]);
      for (const r of todas) if (r.status === 'fulfilled') await r.value.parar();
      vivas.clear();
      await cerrarDirectorio();
    },
  };
}

class ErrorDeRegistro extends Error {
  constructor(
    readonly status: number,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

function cookiesDe(cabecera: string | string[] | undefined): string[] {
  if (!cabecera) return [];
  return Array.isArray(cabecera) ? cabecera : [cabecera];
}

/** El directorio en su propia carpeta PGlite, sin las migraciones de una tienda. */
async function openPgliteSinMigraciones(dir: string): Promise<{ pool: Pool; cerrar: () => Promise<void> }> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(dir);
  await db.waitReady;
  return { pool: asPool(db), cerrar: () => db.close() };
}
