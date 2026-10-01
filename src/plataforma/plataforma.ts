/**
 * La plataforma: muchas tiendas independientes en un mismo servidor.
 *
 * Cada registro en /registro es una tienda NUEVA, con su base, su WhatsApp,
 * sus carpetas y sus secretos (ver tienda.ts). Aqui se decide:
 *
 *   - donde vive cada tienda: una carpeta por tienda bajo `raiz` (WhatsApp,
 *     adjuntos, secretos) y una BASE propia en el servidor MySQL/MariaDB.
 *     Con DATABASE_URL=mysql://.../gsgchat: el directorio en
 *     `gsgchat_plataforma`, cada tienda en `gsgchat_t_<id>` y las bases
 *     listas de reserva en `gsgchat_banco_*` (ver src/db/bases.ts);
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

import { mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { bootstrapSecrets } from '../settings/crypto.js';
import { claveAceptable, usuarioAceptable } from '../auth/usuarios.js';
import { baseDeLaUrl, createPool, esDuplicado, nombreDeBaseSeguro } from '../db/pool.js';
import { crearBaseSiNoExiste } from '../db/migrate.js';
import { borrarBase, rellenarBanco, type OpcionesBanco } from '../db/bases.js';
import { explicarErrorDeBase } from '../runtime.js';
import { RUBROS } from '../web/login-page.js';
import { crearDirectorio, type Directorio, type TiendaRegistrada } from './directorio.js';
import { entornoDeTienda, lugarDeTienda, pareceSlug, slugDe } from './entorno.js';
import { armarTienda, type BaseDeTienda, type OpcionesTienda, type TiendaViva } from './tienda.js';
import { enTienda } from './contexto.js';
import type { DirectorioUsuarios } from '../auth/routes.js';

/** Lo que la instalacion de siempre aporta como tienda principal. */
export type OpcionesPrincipal = Omit<OpcionesTienda, 'id' | 'slug' | 'primeraCuentaRol' | 'directorio'>;

export interface OpcionesPlataforma {
  /** Carpeta de las tiendas nuevas: una subcarpeta por tienda (WhatsApp, adjuntos, secretos). */
  raiz: string;
  /** La URL publica del servidor, sin barra al final. La de cada tienda es esta + /tienda/<slug>. */
  publicBaseUrl: string;
  /** El entorno del proceso: de aqui solo se hereda lo de la lista cerrada (ver entorno.ts). */
  proceso: NodeJS.ProcessEnv;
  /** Lo que el arranque fuerza en todas las tiendas nuevas (p. ej. simular entrantes en el arranque corto). */
  extraTiendas?: NodeJS.ProcessEnv;
  /**
   * El servidor MySQL/MariaDB (la DATABASE_URL de siempre). Cada tienda nueva
   * va en una base propia de ese servidor: `<base de la URL>_t_<id>`.
   */
  base: { url: string };
  /**
   * El banco de bases listas (por defecto, prefijo `<base de la URL>_` y una
   * de reserva). Las pruebas pasan el suyo, sin reserva.
   */
  banco?: OpcionesBanco;
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

/**
 * Los nombres de las bases de la plataforma, a partir de la de la URL
 * (mysql://.../gsgchat): directorio `gsgchat_plataforma`, tiendas
 * `gsgchat_t_<id>` y banco `gsgchat_banco_*`.
 */
export function basesDeLaPlataforma(url: string): { raiz: string; directorio: string; tienda: (id: string) => string; prefijoBanco: string } {
  const deLaUrl = baseDeLaUrl(url);
  if (!deLaUrl) throw new Error('DATABASE_URL no dice qué base usar: termínala con /nombre_de_la_base (por ejemplo mysql://root@127.0.0.1:3306/gsgchat).');
  // Lo que va delante de cada base: minusculas, numeros y _, y corto (un nombre de base son 64 letras como mucho).
  const raiz = deLaUrl.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) || 'gsgchat';
  return {
    raiz,
    directorio: nombreDeBaseSeguro(`${raiz}_plataforma`),
    tienda: (id) => nombreDeBaseSeguro(`${raiz}_t_${id}`),
    prefijoBanco: `${raiz}_`,
  };
}

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
  const nombres = basesDeLaPlataforma(o.base.url);
  const banco: OpcionesBanco = o.banco ?? { url: o.base.url, prefijo: nombres.prefijoBanco, reserva: 1 };
  try {
    await crearBaseSiNoExiste(o.base.url, nombres.directorio);
  } catch (error) {
    throw new Error(`No se pudo preparar la base de la plataforma (${nombres.directorio}): ${explicarErrorDeBase(error, o.base.url)}`);
  }
  const poolDirectorio = createPool(o.base.url, nombres.directorio);
  const cerrarDirectorio = () => poolDirectorio.end();
  const directorio = await crearDirectorio(poolDirectorio);

  const vivas = new Map<string, Promise<TiendaViva>>();

  /** El directorio visto desde una tienda: reserva para ELLA. */
  const directorioDe = (tiendaId: string): DirectorioUsuarios => ({
    reservar: async (usuario) => (await directorio.reservar(usuario, tiendaId)) || (await directorio.tiendaDe(usuario)) === tiendaId,
    liberar: (usuario) => directorio.liberar(usuario, tiendaId),
  });

  // --- el banco de bases listas -------------------------------------------------
  // Crear las ~50 tablas de una tienda es DDL: en un disco lento, mas de un
  // minuto. Se tiene de reserva una base ya migrada y vacia; la tienda nueva
  // se queda con sus tablas al instante (ver src/db/bases.ts) y el banco se
  // rellena en segundo plano: al arrancar y despues de cada registro.
  function rellenar(): void {
    if (!(banco.reserva ?? 1)) return;
    rellenarBanco(banco).catch((error: unknown) => {
      log(`no se pudo dejar lista una base de reserva para las tiendas nuevas (se crearan de cero): ${explicarErrorDeBase(error, banco.url)}`);
    });
  }

  function opcionesDe(t: TiendaRegistrada, primeraCuentaRol: 'superadmin' | 'admin'): OpcionesTienda {
    if (t.principal && o.principal) {
      // La principal usa su base de siempre (la de la URL); si aun no existe, sale del banco.
      const base: BaseDeTienda = { ...o.principal.base, banco: o.principal.base.banco ?? banco };
      return { ...o.principal, base, id: t.id, slug: t.slug, primeraCuentaRol: 'superadmin', directorio: directorioDe(t.id) };
    }
    const lugar = lugarDeTienda(o.raiz, t.id);
    for (const dir of [lugar.dir, lugar.medios, lugar.respaldos]) mkdirSync(dir, { recursive: true });
    const secretos = bootstrapSecrets(lugar.dir);
    const base: BaseDeTienda = { url: o.base.url, base: nombres.tienda(t.id), banco };
    const publicBaseUrl = `${o.publicBaseUrl.replace(/\/+$/, '')}/tienda/${t.slug}`;
    return {
      id: t.id,
      slug: t.slug,
      env: entornoDeTienda(
        o.proceso,
        {
          publicBaseUrl,
          databaseUrl: urlConBase(o.base.url, base.base!),
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
    await borrarBase(o.base.url, nombres.tienda(id)).catch((error: unknown) => {
      log(`no se pudo borrar la base ${nombres.tienda(id)} de un registro a medias: ${explicarErrorDeBase(error, o.base.url)}`);
    });
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
        if (!esDuplicado(error)) throw error;
      }
    }
    if (!registrada) return { ok: false, status: 409, error: 'Justo se estaba creando otra tienda con ese nombre. Vuelve a intentarlo.' };
    if (!(await directorio.reservar(usuario, id))) {
      await deshacer(id, null);
      return { ok: false, status: 400, error: 'Ese usuario ya lo usa otra cuenta. Elige otro.' };
    }

    let viva: TiendaViva | null = null;
    try {
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
        // Se gasto la base de reserva: se prepara otra para el siguiente.
        rellenar();
        return { ok: true, status: 200, tienda: registrada, setCookie: cookiesDe(alta.headers['set-cookie']), next: '/panel' };
      });
    } catch (error) {
      await deshacer(id, viva);
      if (error instanceof ErrorDeRegistro) return { ok: false, status: error.status >= 500 ? 500 : 400, error: error.message };
      log(`no se pudo crear la tienda ${registrada.slug}: ${explicarErrorDeBase(error, o.base.url)}${error instanceof Error && error.stack ? `\n${error.stack}` : ''}`);
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
      // La base de reserva se prepara mientras tanto (si ya la hay, no hace nada).
      rellenar();
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
      // No se espera al relleno del banco (puede tardar un minuto): una base a
      // medio preparar no cuenta como lista, y la siguiente vez se hace otra.
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

/** La misma URL apuntando a otra base del servidor. */
function urlConBase(url: string, base: string): string {
  const u = new URL(url.trim().replace(/^mariadb:/i, 'mysql:'));
  u.pathname = `/${base}`;
  return u.toString();
}
