/**
 * Quien es el que pide, y que puede hacer.
 *
 * Dos formas de entrar:
 *  - una persona, con usuario y contrasena en /login; se lleva una cookie
 *    firmada (ver sesion.ts) y las pantallas dejan de pedir nada;
 *  - un programa (el sistema de GSG, un script), con
 *    `Authorization: Bearer wak_...`: una clave de API que un administrador
 *    creo desde el panel (ver claves-api.ts). No hay ningun token fijo.
 *
 * El hook de aqui resuelve `request.usuario` para todas las peticiones; las
 * rutas /admin exigen que exista. Cuentas y claves las gestionan solo las
 * personas con rol admin: una clave de API no crea usuarios ni otras claves.
 * Las paginas (/panel, /chat, /rutas, /setup) redirigen a /login sin sesion.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { UsuariosRepo, Rol } from './usuarios.js';
import { capacidadDe, claveAceptable, hashClave, usuarioAceptable, verificarClave, type Capacidad } from './usuarios.js';
import { cookieDeCierre, cookieDeSesion, COOKIE_SESION, firmarSesion, leerCookies, leerSesion } from './sesion.js';
import type { ClavesApiRepo } from './claves-api.js';
import { ETIQUETAS, type ActividadRepo } from './actividad.js';
import { generarClaveApi, hashClaveApi, nombreDeClaveAceptable, pareceClaveApi, prefijoDeClave } from './claves-api.js';
import { permisosAceptables, tienePermiso, type Permiso } from './permisos.js';
import { leerTokenEmbebido, pareceTokenEmbebido, secretoDeEmbebido } from '../embed/token.js';
import { loginPage } from '../web/login-page.js';
import { landingPage } from '../web/landing-page.js';
import { claveDeCabeceras, esRecepcionGsg, RECHAZOS, type RechazoRecepcion } from '../plataforma/recepcion-gsg.js';
import { cuerpoError } from '../api/errores.js';

export interface UsuarioSesion {
  id: string;
  usuario: string;
  nombre: string;
  /** Lo que puede hacer: 'admin' o 'operador'. Un superadministrador entra como admin y ademas lleva `super`. */
  rol: Capacidad;
  /** true = superadministrador: membresia, codigos de conexion y cuentas de otros superadministradores. */
  super?: boolean;
  /** true si entro con una clave de API (un programa), no con una cuenta. */
  porToken: boolean;
  /** Lo que puede hacer en /api/v1. Una persona lo puede todo; una clave, lo suyo. Ver permisos.ts. */
  permisos: string[];
  /**
   * Si entro con un token del chat embebido (ver src/embed): a que hilo se
   * limita. `telefono: null` = a todos los chats, como un operador.
   */
  embebido?: { telefono: string | null };
}

declare module 'fastify' {
  interface FastifyContextConfig {
    /** El permiso que exige una ruta de /api/v1. Sin el, basta con entrar. */
    permiso?: Permiso;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    usuario: UsuarioSesion | null;
  }
}

export interface AuthDeps {
  config: Config;
  usuarios: UsuariosRepo;
  claves: ClavesApiRepo;
  actividad: ActividadRepo;
  ahora?: () => Date;
  /** Como se llama el negocio ahora mismo (se puede cambiar desde la pantalla). */
  nombreNegocio?: () => string;
  /** El modo del sistema (gsg | completo), para /admin/yo. */
  modo?: () => 'gsg' | 'completo';
  /**
   * El secreto con el que el propio proceso se llama a si mismo (la IA
   * operadora ejecuta por `app.inject` con la identidad de quien ordena).
   * Es aleatorio por arranque y nunca sale del proceso: nadie de fuera lo
   * puede mandar. Ver src/ia/ordenes.ts y buildServer.
   */
  secretoInterno?: string;
  /** La membresia: para el tope de cuentas. Ver src/plan. */
  plan?: import('../plan/servicio.js').ServicioPlan;
  /**
   * El rol de la primera cuenta. En una instalacion suelta (y en la primera
   * tienda de una plataforma vacia) es el superadministrador; en una tienda
   * que se registra sola en la plataforma, su dueño es administrador de SU
   * tienda y nada mas. Ver src/plataforma.
   */
  primeraCuentaRol?: 'superadmin' | 'admin';
  /**
   * El directorio de usuarios de la plataforma. Se entra solo con usuario y
   * contraseña, sin decir de que tienda: por eso un usuario no puede
   * repetirse entre tiendas y se reserva aqui antes de crearlo.
   */
  directorio?: DirectorioUsuarios;
}

export interface DirectorioUsuarios {
  /** Aparta el usuario para esta tienda. false = ya lo usa alguien (de esta u otra tienda). */
  reservar(usuario: string): Promise<boolean>;
  /** Lo suelta si al final no se creo la cuenta. */
  liberar(usuario: string): Promise<void>;
}

export const CABECERA_INTERNA = 'x-wa-interno';
export const CABECERA_USUARIO_INTERNO = 'x-wa-usuario';

/** El secreto de las cookies: derivado del de rastreo, para no pedir otro. */
export function secretoDeSesion(config: Config): string {
  return createHmac('sha256', config.TRACKING_SECRET).update('sesion-de-usuario').digest('hex');
}

const PAGINAS_PRIVADAS = ['/conexion-gsg', '/panel', '/chat', '/rutas', '/setup', '/manual', '/soporte', '/entregas', '/hoy', '/numeros', '/guardados', '/envio-automatico', '/entrenamiento', '/tiendas', '/cuentas', '/mapa', '/salud', '/automatizacion-gsg', '/fiabilidad'];

/** Lo que solo toca una persona con rol admin: nunca una clave de API. */
const SOLO_ADMIN_PERSONA = ['/admin/usuarios', '/admin/claves-api', '/admin/actividad', '/admin/codigos-conexion', '/admin/membresia', '/admin/tiendas'];

/** Rutas de la API publica que no piden clave. */
const API_SIN_CLAVE = ['/api/v1/conexion/canjear'];

/** Cada cuanto se anota el "ultimo uso" de una clave: no una escritura por peticion. */
const ANOTAR_USO_CADA_MS = 60_000;

/** Intentos fallidos por IP: cinco seguidos y cinco minutos de espera. */
const MAX_FALLOS = 5;
const BLOQUEO_MS = 5 * 60_000;

export async function registerAuth(app: FastifyInstance, deps: AuthDeps): Promise<void> {
  const { config, usuarios, claves } = deps;
  const nombreNegocio = () => deps.nombreNegocio?.() ?? config.businessName;
  const ahora = deps.ahora ?? (() => new Date());
  const secreto = secretoDeSesion(config);
  const segura = config.PUBLIC_BASE_URL.startsWith('https://');
  const fallos = new Map<string, { n: number; hasta: number }>();
  const usoAnotado = new Map<string, number>();

  app.decorateRequest('usuario', null);

  const secretoEmbed = secretoDeEmbebido(config);

  async function resolver(request: FastifyRequest): Promise<UsuarioSesion | null> {
    // El bucle interno: solo con el secreto de este proceso. Trae la
    // identidad de la persona (o clave) que dio la orden, con su rol y sus
    // permisos tal cual: la IA no puede mas que ella.
    const interno = request.headers[CABECERA_INTERNA];
    if (typeof interno === 'string' && deps.secretoInterno && interno.length === deps.secretoInterno.length && timingSafeEqual(Buffer.from(interno), Buffer.from(deps.secretoInterno))) {
      const crudo = request.headers[CABECERA_USUARIO_INTERNO];
      if (typeof crudo !== 'string') return null;
      try {
        const u = JSON.parse(crudo) as UsuarioSesion;
        if (!u || typeof u.id !== 'string' || (u.rol !== 'admin' && u.rol !== 'operador')) return null;
        return { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, super: u.super === true, porToken: Boolean(u.porToken), permisos: Array.isArray(u.permisos) ? u.permisos : [], embebido: u.embebido };
      } catch {
        return null;
      }
    }
    const header = request.headers.authorization;
    // El chat embebido: un token corto que firmo este servidor. Solo abre
    // /api/v1, y solo con lo que el token dice (ver src/embed/token.ts).
    // Los EventSource no mandan cabeceras: para el flujo de eventos se
    // acepta tambien en la query, y solo ese tipo de token.
    const query = request.query as { token?: string } | undefined;
    const candidatoEmbed =
      typeof header === 'string' && header.startsWith('Bearer ') && pareceTokenEmbebido(header.slice(7).trim())
        ? header.slice(7).trim()
        : request.url.startsWith('/api/v1/eventos/stream') && typeof query?.token === 'string' && pareceTokenEmbebido(query.token)
          ? query.token
          : null;
    if (candidatoEmbed) {
      const carga = leerTokenEmbebido(secretoEmbed, candidatoEmbed, ahora().getTime());
      if (!carga) return null;
      return {
        id: `embebido:${carga.operador}`,
        usuario: 'embebido',
        nombre: carga.operador,
        rol: 'operador',
        porToken: true,
        permisos: carga.permisos,
        embebido: { telefono: carga.telefono },
      };
    }
    // La clave de API: `Authorization: Bearer` o `X-API-Key`.
    const token = claveDeCabeceras(request.headers);
    if (token) {
      if (!pareceClaveApi(token)) return null;
      const clave = await claves.porHash(hashClaveApi(token));
      if (!clave) return null;
      const t = ahora().getTime();
      if ((usoAnotado.get(clave.id) ?? 0) + ANOTAR_USO_CADA_MS <= t) {
        usoAnotado.set(clave.id, t);
        await claves.tocarUso(clave.id, ahora());
      }
      return { id: `clave:${clave.id}`, usuario: 'api', nombre: clave.nombre, rol: 'admin', porToken: true, permisos: clave.permisos };
    }
    const cookies = leerCookies(request.headers.cookie);
    const carga = leerSesion(secreto, cookies[COOKIE_SESION], ahora().getTime());
    if (!carga) return null;
    const u = await usuarios.porId(carga.u);
    if (!u || !u.activo || u.sesionVersion !== carga.v) return null;
    return sesionDe(u);
  }

  /** Por que una peticion a la recepcion no entra (o null si entra). */
  async function rechazoDeRecepcion(request: FastifyRequest): Promise<RechazoRecepcion | null> {
    const token = claveDeCabeceras(request.headers);
    if (!token) return RECHAZOS.ausente();
    if (!pareceClaveApi(token)) return RECHAZOS.invalida();
    if (!request.usuario?.porToken) {
      const registro = await claves.porHashConRevocadas?.(hashClaveApi(token));
      return registro?.revocadaAt ? RECHAZOS.revocada() : RECHAZOS.invalida();
    }
    if (!tienePermiso(request.usuario.permisos, 'entregas:gestionar')) return RECHAZOS.sinPermiso();
    return null;
  }

  app.addHook('onRequest', async (request, reply) => {
    request.usuario = await resolver(request);
    // La recepcion de pedidos de GSG: solo con una clave de API (nunca con la
    // sesion del panel) y con el codigo de cada caso: 401 sin clave o con una
    // que no vale, 403 si vale pero no puede crear pedidos.
    if (esRecepcionGsg(request.method, request.url)) {
      const rechazo = await rechazoDeRecepcion(request);
      if (rechazo) {
        for (const [k, v] of Object.entries(rechazo.cabeceras ?? {})) reply.header(k, v);
        return reply.code(rechazo.status).send(rechazo.cuerpo);
      }
      // Solo JSON: text/plain tiene parser en Fastify, pero no es el contrato
      // de Courier. Se comprueba tras autorizar y antes de leer el cuerpo.
      const contenido = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
      if (contenido !== 'application/json') {
        return reply.code(415).send(cuerpoError('TIPO_CONTENIDO_NO_SOPORTADO', 'Manda el cuerpo como JSON con Content-Type: application/json.'));
      }
      return;
    }

    if (request.url.startsWith('/admin')) {
      if (!request.usuario) return reply.code(401).send({ error: 'no autorizado: entra en /login o manda una clave de API' });
      // La API interna es para el panel y para las claves de siempre. Una
      // clave acotada tiene su puerta en /api/v1 y no entra por aqui.
      if (request.usuario.porToken && !tienePermiso(request.usuario.permisos, '*')) {
        return reply.code(403).send({ error: 'esta clave tiene permisos acotados: usa la API publica en /api/v1' });
      }
      if (SOLO_ADMIN_PERSONA.some((ruta) => request.url.startsWith(ruta))) {
        if (request.usuario.porToken) return reply.code(403).send({ error: 'una clave de API no gestiona cuentas ni claves' });
        if (request.usuario.rol !== 'admin') return reply.code(403).send({ error: 'solo un administrador gestiona cuentas y claves' });
      }
      return;
    }

    // La API publica: cada ruta dice que permiso exige (ver src/api/v1).
    if (request.url.startsWith('/api/')) {
      // El canje de un codigo de conexion entra sin clave: el codigo es la
      // autorizacion, y de ahi sale la clave (ver super-routes.ts).
      if (API_SIN_CLAVE.includes(request.url.split('?')[0] ?? '') || request.url.startsWith('/api/plan/')) return;
      if (!request.usuario) {
        const motivo = await rechazoDeRecepcion(request);
        reply.header('www-authenticate', 'Bearer realm="gsgchat"');
        return reply.code(401).send(cuerpoError(motivo?.cuerpo.codigo ?? 'CLAVE_INVALIDA', 'no autorizado: manda `Authorization: Bearer <clave de API>`'));
      }
      const permiso = request.routeOptions?.config?.permiso;
      if (permiso && !tienePermiso(request.usuario.permisos, permiso)) {
        return reply.code(403).send(cuerpoError('SIN_PERMISO', `esta clave no tiene el permiso "${permiso}"`));
      }
      return;
    }

    const ruta = request.url.split('?')[0] ?? '';
    if (PAGINAS_PRIVADAS.includes(ruta) && !request.usuario) {
      return reply.redirect(`/login?next=${encodeURIComponent(request.url)}`);
    }
  });

  const ip = (request: FastifyRequest) => request.ip || 'desconocida';
  const bloqueado = (request: FastifyRequest): number => {
    const f = fallos.get(ip(request));
    if (!f) return 0;
    if (f.hasta > ahora().getTime()) return f.hasta - ahora().getTime();
    if (f.n >= MAX_FALLOS) fallos.delete(ip(request));
    return 0;
  };
  const anotarFallo = (request: FastifyRequest) => {
    const f = fallos.get(ip(request)) ?? { n: 0, hasta: 0 };
    f.n += 1;
    if (f.n >= MAX_FALLOS) f.hasta = ahora().getTime() + BLOQUEO_MS;
    fallos.set(ip(request), f);
  };

  const siguienteSeguro = (next: unknown): string => {
    const s = typeof next === 'string' ? next : '';
    // Solo rutas propias: nada de mandar a otro sitio tras el login.
    return s.startsWith('/') && !s.startsWith('//') ? s : '/panel';
  };

  // --- portada y pantalla de entrada -------------------------------------

  app.get('/', async (request, reply) => {
    return reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(landingPage({ nombreNegocio: nombreNegocio(), conSesion: Boolean(request.usuario) }));
  });

  app.get('/login', async (request, reply) => {
    const query = request.query as { next?: string };
    if (request.usuario && !request.usuario.porToken) return reply.redirect(siguienteSeguro(query.next));
    const primeraCuenta = (await usuarios.contar()) === 0;
    return reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(loginPage({ primeraCuenta, next: siguienteSeguro(query.next), nombreNegocio: nombreNegocio() }));
  });

  const abrirSesion = (reply: FastifyReply, u: { id: string; sesionVersion: number }) => {
    reply.header('set-cookie', cookieDeSesion(firmarSesion(secreto, { u: u.id, v: u.sesionVersion }, ahora().getTime()), segura));
  };

  /** La sesion de una persona: su capacidad en el panel y si es superadministrador. */
  const sesionDe = (u: { id: string; usuario: string; nombre: string; rol: Rol }): UsuarioSesion => ({ id: u.id, usuario: u.usuario, nombre: u.nombre, rol: capacidadDe(u.rol), super: u.rol === 'superadmin', porToken: false, permisos: ['*'] });

  /**
   * Crea la cuenta apartando antes el usuario en el directorio de la
   * plataforma (si lo hay). null = el usuario ya esta tomado.
   */
  const crearConReserva = async (datos: Parameters<UsuariosRepo['crear']>[0]) => {
    if (deps.directorio && !(await deps.directorio.reservar(datos.usuario))) return null;
    try {
      return await usuarios.crear(datos);
    } catch (error) {
      await deps.directorio?.liberar(datos.usuario).catch(() => undefined);
      throw error;
    }
  };

  const loginSchema = z.object({ usuario: z.string().trim().min(1).max(60), clave: z.string().min(1).max(200), next: z.string().optional() });

  app.post('/login', async (request, reply) => {
    const espera = bloqueado(request);
    if (espera > 0) {
      return reply.code(429).send({ error: `Demasiados intentos. Espera ${Math.ceil(espera / 60_000)} minuto(s).` });
    }
    const body = loginSchema.parse(request.body ?? {});
    const u = await usuarios.porUsuario(body.usuario);
    if (!u || !u.activo || !verificarClave(body.clave, u.clave)) {
      anotarFallo(request);
      return reply.code(401).send({ error: 'Usuario o contraseña incorrectos.' });
    }
    fallos.delete(ip(request));
    await usuarios.tocarLogin(u.id, ahora());
    abrirSesion(reply, u);
    // Para la bitacora: quien acaba de entrar, con su nombre.
    request.usuario = sesionDe(u);
    return { ok: true, usuario: { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol }, next: siguienteSeguro(body.next) };
  });

  const primeraSchema = z.object({
    nombre: z.string().trim().min(1).max(80),
    usuario: z.string().trim().min(1).max(60),
    clave: z.string().min(1).max(200),
  });

  /**
   * Solo mientras no exista ningun usuario: la primera cuenta es la del
   * superadministrador, que es quien esta poniendo el sistema. Los
   * administradores del negocio los crea el despues.
   */
  app.post('/login/primera-cuenta', async (request, reply) => {
    if ((await usuarios.contar()) > 0) {
      return reply.code(409).send({ error: 'Ya hay usuarios: entra con tu cuenta o pide una al administrador.' });
    }
    const body = primeraSchema.parse(request.body ?? {});
    const usuarioNorm = body.usuario.toLowerCase();
    const malUsuario = usuarioAceptable(usuarioNorm);
    if (malUsuario) return reply.code(400).send({ error: malUsuario });
    const malClave = claveAceptable(body.clave);
    if (malClave) return reply.code(400).send({ error: malClave });
    const u = await crearConReserva({ usuario: usuarioNorm, nombre: body.nombre, clave: hashClave(body.clave), rol: deps.primeraCuentaRol ?? 'superadmin' });
    if (!u) return reply.code(400).send({ error: 'Ese usuario ya existe. Elige otro.' });
    await usuarios.tocarLogin(u.id, ahora());
    abrirSesion(reply, u);
    request.usuario = sesionDe(u);
    return { ok: true, usuario: { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol }, next: '/panel' };
  });

  app.post('/logout', async (_request, reply) => {
    reply.header('set-cookie', cookieDeCierre(segura));
    return { ok: true };
  });

  // Crear tiendas es cosa de la plataforma (src/plataforma/servidor.ts), que
  // atiende /registro antes de que llegue a ninguna tienda. Aqui solo se llega
  // en una tienda suelta sin plataforma delante (la demo): se dice claro.
  app.post('/registro', async (_request, reply) =>
    reply.code(403).send({ error: 'Esta instalación no tiene registro de tiendas. Contacta al administrador para obtener una cuenta.' }),
  );

  // --- quien soy, y usuarios (solo admin) --------------------------------

  // Con el modo del sistema (gsg | completo): el armazon decide que menu enseñar.
  // `conMaestro`: esta instalacion depende de un maestro (SaaS), asi que "Pagar" tiene a quien mandarle la captura.
  app.get('/admin/yo', async (request) => (request.usuario ? { ...request.usuario, modo: deps.modo?.() ?? 'gsg', conMaestro: deps.plan?.estado().origen === 'maestro' } : request.usuario));

  app.get('/admin/usuarios', async () => usuarios.listar());

  const nuevoSchema = z.object({
    nombre: z.string().trim().min(1).max(80),
    usuario: z.string().trim().min(1).max(60),
    clave: z.string().min(1).max(200),
    rol: z.enum(['superadmin', 'admin', 'operador']).default('operador'),
  });

  app.post('/admin/usuarios', async (request, reply) => {
    const body = nuevoSchema.parse(request.body ?? {});
    // Un superadministrador solo lo crea otro superadministrador.
    if (body.rol === 'superadmin' && !request.usuario?.super) return reply.code(403).send({ error: 'Solo un superadministrador puede crear superadministradores.' });
    const usuarioNorm = body.usuario.toLowerCase();
    const malUsuario = usuarioAceptable(usuarioNorm);
    if (malUsuario) return reply.code(400).send({ error: malUsuario });
    const malClave = claveAceptable(body.clave);
    if (malClave) return reply.code(400).send({ error: malClave });
    if (await usuarios.porUsuario(usuarioNorm)) return reply.code(400).send({ error: 'Ese usuario ya existe.' });
    // La membresia puede poner tope de cuentas (las activas cuentan).
    const tope = deps.plan?.limiteUsuarios() ?? null;
    if (tope !== null) {
      const activas = (await usuarios.listar()).filter((x) => x.activo).length;
      if (activas >= tope) return reply.code(400).send({ error: `La membresía permite ${tope} cuenta${tope === 1 ? '' : 's'} y ya hay ${activas}. Desactiva una o amplía la membresía.`, ir: '/panel#membresia' });
    }
    const u = await crearConReserva({ usuario: usuarioNorm, nombre: body.nombre, clave: hashClave(body.clave), rol: body.rol });
    if (!u) return reply.code(400).send({ error: 'Ese usuario ya lo usa otra cuenta. Elige otro.' });
    return { ok: true, usuario: u };
  });

  const cambioSchema = z.object({
    clave: z.string().max(200).optional(),
    rol: z.enum(['superadmin', 'admin', 'operador']).optional(),
    activo: z.boolean().optional(),
  });

  app.post<{ Params: { id: string } }>('/admin/usuarios/:id', async (request, reply) => {
    const body = cambioSchema.parse(request.body ?? {});
    const u = await usuarios.porId(request.params.id);
    if (!u) return reply.code(404).send({ error: 'Ese usuario no existe.' });
    const esUnoMismo = request.usuario?.id === u.id;
    // Las cuentas de superadministrador solo las toca un superadministrador
    // (ni siquiera un admin puede cambiarles la contrasena o desactivarlas).
    if ((u.rol === 'superadmin' || body.rol === 'superadmin') && !request.usuario?.super) {
      return reply.code(403).send({ error: 'Solo un superadministrador puede cambiar cuentas de superadministrador.' });
    }
    // El ultimo superadministrador no se degrada ni se desactiva: alguien tiene que poder gestionar la membresia.
    if (u.rol === 'superadmin' && ((body.rol !== undefined && body.rol !== 'superadmin') || body.activo === false)) {
      const supers = (await usuarios.listar()).filter((x) => x.rol === 'superadmin' && x.activo).length;
      if (supers <= 1) return reply.code(400).send({ error: 'Es el único superadministrador: crea otro antes de cambiarlo o desactivarlo.' });
    }

    if (body.clave !== undefined) {
      const mal = claveAceptable(body.clave);
      if (mal) return reply.code(400).send({ error: mal });
      await usuarios.cambiarClave(u.id, hashClave(body.clave));
      // Quien se cambia su propia contrasena sigue dentro con una cookie nueva.
      if (esUnoMismo && !request.usuario?.porToken) {
        const nuevo = await usuarios.porId(u.id);
        if (nuevo) abrirSesion(reply, nuevo);
      }
    }
    if (body.rol !== undefined) {
      if (esUnoMismo && body.rol === 'operador') return reply.code(400).send({ error: 'No puedes quitarte a ti mismo el rol de administrador.' });
      await usuarios.setRol(u.id, body.rol);
    }
    if (body.activo !== undefined) {
      if (esUnoMismo && !body.activo) return reply.code(400).send({ error: 'No puedes desactivar tu propia cuenta.' });
      await usuarios.setActivo(u.id, body.activo);
    }
    return { ok: true, usuario: await usuarios.porId(u.id) };
  });

  // --- claves de API (solo admin, solo personas) ---------------------------

  app.get('/admin/claves-api', async () => claves.listar());

  /** Crea una clave y la devuelve entera: es la unica vez que se ve. */
  app.post('/admin/claves-api', async (request, reply) => {
    const body = z.object({ nombre: z.string().max(120), permisos: z.array(z.string()).optional() }).parse(request.body ?? {});
    const mal = nombreDeClaveAceptable(body.nombre);
    if (mal) return reply.code(400).send({ error: mal });
    const permisos = permisosAceptables(body.permisos);
    if ('error' in permisos) return reply.code(400).send({ error: permisos.error });
    const clave = generarClaveApi();
    const registro = await claves.crear({
      nombre: body.nombre,
      prefijo: prefijoDeClave(clave),
      hash: hashClaveApi(clave),
      creadaPor: request.usuario?.id ?? null,
      permisos: permisos.permisos,
    });
    return { ok: true, clave, registro };
  });

  app.delete<{ Params: { id: string } }>('/admin/claves-api/:id', async (request, reply) => {
    const ok = await claves.revocar(request.params.id);
    if (!ok) return reply.code(404).send({ error: 'Esa clave no existe o ya estaba revocada.' });
    return { ok: true };
  });

  // --- bitacora (solo admin, solo personas) --------------------------------

  app.get('/admin/actividad', async (request) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        accion: z.string().max(60).optional(),
        usuario: z.string().max(80).optional(),
      })
      .parse(request.query ?? {});
    const [pagina, acciones] = await Promise.all([deps.actividad.listar(q), deps.actividad.acciones()]);
    return { ...pagina, acciones, etiquetas: ETIQUETAS };
  });

  /** Cambiar la propia contrasena, para cualquier rol. */
  app.post('/admin/mi-clave', async (request, reply) => {
    const body = z.object({ actual: z.string().max(200), nueva: z.string().max(200) }).parse(request.body ?? {});
    if (!request.usuario || request.usuario.porToken) return reply.code(400).send({ error: 'Solo con una cuenta.' });
    const u = await usuarios.porUsuario(request.usuario.usuario);
    if (!u || !verificarClave(body.actual, u.clave)) return reply.code(401).send({ error: 'La contraseña actual no es correcta.' });
    const mal = claveAceptable(body.nueva);
    if (mal) return reply.code(400).send({ error: mal });
    await usuarios.cambiarClave(u.id, hashClave(body.nueva));
    const nuevo = await usuarios.porId(u.id);
    if (nuevo) abrirSesion(reply, nuevo);
    return { ok: true };
  });
}
