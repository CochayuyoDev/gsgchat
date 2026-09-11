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
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { UsuariosRepo, Rol } from './usuarios.js';
import { claveAceptable, hashClave, usuarioAceptable, verificarClave } from './usuarios.js';
import { cookieDeCierre, cookieDeSesion, COOKIE_SESION, firmarSesion, leerCookies, leerSesion } from './sesion.js';
import type { ClavesApiRepo } from './claves-api.js';
import { ETIQUETAS, type ActividadRepo } from './actividad.js';
import { generarClaveApi, hashClaveApi, nombreDeClaveAceptable, pareceClaveApi, prefijoDeClave } from './claves-api.js';
import { loginPage } from '../web/login-page.js';
import { landingPage } from '../web/landing-page.js';

export interface UsuarioSesion {
  id: string;
  usuario: string;
  nombre: string;
  rol: Rol;
  /** true si entro con una clave de API (un programa), no con una cuenta. */
  porToken: boolean;
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
}

/** El secreto de las cookies: derivado del de rastreo, para no pedir otro. */
export function secretoDeSesion(config: Config): string {
  return createHmac('sha256', config.TRACKING_SECRET).update('sesion-de-usuario').digest('hex');
}

const PAGINAS_PRIVADAS = ['/panel', '/chat', '/rutas', '/setup', '/manual', '/soporte'];

/** Lo que solo toca una persona con rol admin: nunca una clave de API. */
const SOLO_ADMIN_PERSONA = ['/admin/usuarios', '/admin/claves-api', '/admin/actividad'];

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

  async function resolver(request: FastifyRequest): Promise<UsuarioSesion | null> {
    const header = request.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      const token = header.slice(7).trim();
      if (!pareceClaveApi(token)) return null;
      const clave = await claves.porHash(hashClaveApi(token));
      if (!clave) return null;
      const t = ahora().getTime();
      if ((usoAnotado.get(clave.id) ?? 0) + ANOTAR_USO_CADA_MS <= t) {
        usoAnotado.set(clave.id, t);
        await claves.tocarUso(clave.id, ahora());
      }
      return { id: `clave:${clave.id}`, usuario: 'api', nombre: clave.nombre, rol: 'admin', porToken: true };
    }
    const cookies = leerCookies(request.headers.cookie);
    const carga = leerSesion(secreto, cookies[COOKIE_SESION], ahora().getTime());
    if (!carga) return null;
    const u = await usuarios.porId(carga.u);
    if (!u || !u.activo || u.sesionVersion !== carga.v) return null;
    return { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, porToken: false };
  }

  app.addHook('onRequest', async (request, reply) => {
    request.usuario = await resolver(request);

    if (request.url.startsWith('/admin')) {
      if (!request.usuario) return reply.code(401).send({ error: 'no autorizado: entra en /login o manda una clave de API' });
      if (SOLO_ADMIN_PERSONA.some((ruta) => request.url.startsWith(ruta))) {
        if (request.usuario.porToken) return reply.code(403).send({ error: 'una clave de API no gestiona cuentas ni claves' });
        if (request.usuario.rol !== 'admin') return reply.code(403).send({ error: 'solo un administrador gestiona cuentas y claves' });
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
    request.usuario = { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, porToken: false };
    return { ok: true, usuario: { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol }, next: siguienteSeguro(body.next) };
  });

  const primeraSchema = z.object({
    nombre: z.string().trim().min(1).max(80),
    usuario: z.string().trim().min(1).max(60),
    clave: z.string().min(1).max(200),
  });

  /** Solo mientras no exista ningun usuario: la cuenta administradora. */
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
    const u = await usuarios.crear({ usuario: usuarioNorm, nombre: body.nombre, clave: hashClave(body.clave), rol: 'admin' });
    await usuarios.tocarLogin(u.id, ahora());
    abrirSesion(reply, u);
    request.usuario = { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, porToken: false };
    return { ok: true, usuario: { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol }, next: '/panel' };
  });

  app.post('/logout', async (_request, reply) => {
    reply.header('set-cookie', cookieDeCierre(segura));
    return { ok: true };
  });

  // --- quien soy, y usuarios (solo admin) --------------------------------

  app.get('/admin/yo', async (request) => request.usuario);

  app.get('/admin/usuarios', async () => usuarios.listar());

  const nuevoSchema = z.object({
    nombre: z.string().trim().min(1).max(80),
    usuario: z.string().trim().min(1).max(60),
    clave: z.string().min(1).max(200),
    rol: z.enum(['admin', 'operador']).default('operador'),
  });

  app.post('/admin/usuarios', async (request, reply) => {
    const body = nuevoSchema.parse(request.body ?? {});
    const usuarioNorm = body.usuario.toLowerCase();
    const malUsuario = usuarioAceptable(usuarioNorm);
    if (malUsuario) return reply.code(400).send({ error: malUsuario });
    const malClave = claveAceptable(body.clave);
    if (malClave) return reply.code(400).send({ error: malClave });
    if (await usuarios.porUsuario(usuarioNorm)) return reply.code(400).send({ error: 'Ese usuario ya existe.' });
    const u = await usuarios.crear({ usuario: usuarioNorm, nombre: body.nombre, clave: hashClave(body.clave), rol: body.rol });
    return { ok: true, usuario: u };
  });

  const cambioSchema = z.object({
    clave: z.string().max(200).optional(),
    rol: z.enum(['admin', 'operador']).optional(),
    activo: z.boolean().optional(),
  });

  app.post<{ Params: { id: string } }>('/admin/usuarios/:id', async (request, reply) => {
    const body = cambioSchema.parse(request.body ?? {});
    const u = await usuarios.porId(request.params.id);
    if (!u) return reply.code(404).send({ error: 'Ese usuario no existe.' });
    const esUnoMismo = request.usuario?.id === u.id;

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
      if (esUnoMismo && body.rol !== 'admin') return reply.code(400).send({ error: 'No puedes quitarte a ti mismo el rol de administrador.' });
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
    const body = z.object({ nombre: z.string().max(120) }).parse(request.body ?? {});
    const mal = nombreDeClaveAceptable(body.nombre);
    if (mal) return reply.code(400).send({ error: mal });
    const clave = generarClaveApi();
    const registro = await claves.crear({
      nombre: body.nombre,
      prefijo: prefijoDeClave(clave),
      hash: hashClaveApi(clave),
      creadaPor: request.usuario?.id ?? null,
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
