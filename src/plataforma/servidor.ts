/**
 * El servidor de delante: recibe TODAS las peticiones y le pasa cada una a su
 * tienda.
 *
 * Como se sabe de que tienda es una peticion, por orden:
 *
 *   0. POST /api/v1/entregas -> la clave Bearer identifica la tienda;
 *      sin cookies, Referer ni prefijo. La recepci?n prefijada se rechaza.
 *   1. /tienda/<slug>/...  -> esa tienda, y se le quita el prefijo. Es la
 *      forma de los enlaces publicos de cada tienda (su webhook, su API, la
 *      pagina del motorizado, los enlaces de rastreo): su PUBLIC_BASE_URL ya
 *      la lleva, asi que todo lo que la tienda genera sale con su prefijo;
 *   2. lo de la plataforma: /login, /registro, /logout y la portada;
 *   3. una pagina de /tienda/<slug>/... que pide algo por su cuenta (con
 *      rutas absolutas, como /m/<token>/datos): el Referer dice de que tienda;
 *   4. la cookie `gsg_tienda` que se pone al entrar: el panel de quien entro;
 *   5. la tienda principal (la de siempre), para que sus integraciones y
 *      webhooks de antes sigan llegando a donde llegaban.
 *
 * La cookie de tienda NO da acceso a nada: la sesion la firma cada tienda con
 * su propio secreto, asi que cambiar `gsg_tienda` a mano solo lleva a una
 * tienda que no reconoce la sesion y pide entrar.
 */

import http from 'node:http';
import type { Duplex } from 'node:stream';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { cookieDeCierre, leerCookies } from '../auth/sesion.js';
import { loginPage } from '../web/login-page.js';
import { enTienda } from './contexto.js';
import { pareceSlug } from './entorno.js';
import type { Plataforma } from './plataforma.js';
import type { TiendaViva } from './tienda.js';
import { esRecepcionGsg, tiendaDeClaveGsg } from './recepcion-gsg.js';

export const COOKIE_TIENDA = 'gsg_tienda';
const PREFIJO = '/tienda/';

/** Rutas que atiende la plataforma y no una tienda. */
const DE_LA_PLATAFORMA = new Set(['/', '/login', '/registro', '/registro/disponible', '/logout', '/login/primera-cuenta']);

export interface OpcionesServidor {
  plataforma: Plataforma;
  /** https:// delante: las cookies van con Secure. */
  segura: boolean;
  logger?: boolean;
}

export interface ServidorPlataforma {
  server: http.Server;
  /** Las rutas de la plataforma (para probarlas con inject). */
  web: FastifyInstance;
  escuchar(puerto: number, host: string): Promise<void>;
  cerrar(): Promise<void>;
}

function cookieDeTienda(slug: string, segura: boolean): string {
  return `${COOKIE_TIENDA}=${encodeURIComponent(slug)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}${segura ? '; Secure' : ''}`;
}

function cierreDeTienda(segura: boolean): string {
  return `${COOKIE_TIENDA}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${segura ? '; Secure' : ''}`;
}

function ipDe(req: http.IncomingMessage): string {
  const reenviada = req.headers['x-forwarded-for'];
  const primera = (Array.isArray(reenviada) ? reenviada[0] : reenviada)?.split(',')[0]?.trim();
  return primera || req.socket.remoteAddress || 'desconocida';
}

/** "/tienda/bodega-rosa/panel?x=1" -> { slug: 'bodega-rosa', resto: '/panel?x=1' }. */
export function partirPrefijo(url: string): { slug: string; resto: string } | null {
  if (!url.startsWith(PREFIJO)) return null;
  const tras = url.slice(PREFIJO.length);
  const corte = tras.search(/[/?#]/);
  const slug = corte === -1 ? tras : tras.slice(0, corte);
  if (!pareceSlug(slug)) return null;
  const resto = corte === -1 ? '/' : tras.slice(corte);
  return { slug, resto: resto.startsWith('/') ? resto : `/${resto}` };
}

function slugDelReferer(req: http.IncomingMessage): string | null {
  const ref = req.headers.referer;
  if (!ref) return null;
  try {
    const u = new URL(ref);
    if (req.headers.host && u.host !== req.headers.host) return null;
    return partirPrefijo(u.pathname)?.slug ?? null;
  } catch {
    return null;
  }
}

export async function crearServidorPlataforma(o: OpcionesServidor): Promise<ServidorPlataforma> {
  const { plataforma, segura } = o;
  const web = await rutasDeLaPlataforma(plataforma, segura, o.logger ?? false);

  type Destino = { tipo: 'tienda'; tienda: TiendaViva; url: string } | { tipo: 'plataforma'; url: string } | { tipo: 'no-existe' } | { tipo: 'sin-permiso' };

  /** A quien va esta peticion y con que URL. */
  async function resolver(req: http.IncomingMessage): Promise<Destino> {
    const url = req.url ?? '/';
    const prefijo = partirPrefijo(url);
    if (prefijo && esRecepcionGsg(req.method, prefijo.resto)) return { tipo: 'sin-permiso' };
    if (esRecepcionGsg(req.method, url)) {
      const tienda = await tiendaDeClaveGsg(plataforma, req.headers.authorization);
      return tienda ? { tipo: 'tienda', tienda, url } : { tipo: 'sin-permiso' };
    }
    if (prefijo) {
      const tienda = await plataforma.tiendaPorSlug(prefijo.slug);
      if (!tienda) return { tipo: 'no-existe' };
      // Entrar, salir y registrarse son siempre de la plataforma (sin el
      // prefijo: si no, /tienda/x/login volveria a /login en bucle).
      const ruta = prefijo.resto.split('?')[0] ?? '/';
      if (DE_LA_PLATAFORMA.has(ruta) && ruta !== '/') return { tipo: 'plataforma', url: prefijo.resto };
      return { tipo: 'tienda', tienda, url: prefijo.resto };
    }
    const ruta = url.split('?')[0] ?? '/';
    if (DE_LA_PLATAFORMA.has(ruta)) return { tipo: 'plataforma', url };
    const porReferer = slugDelReferer(req);
    if (porReferer) {
      const tienda = await plataforma.tiendaPorSlug(porReferer);
      if (tienda) return { tipo: 'tienda', tienda, url };
    }
    const deCookie = leerCookies(req.headers.cookie)[COOKIE_TIENDA];
    if (deCookie) {
      const tienda = await plataforma.tiendaPorSlug(decodeURIComponent(deCookie));
      if (tienda) return { tipo: 'tienda', tienda, url };
    }
    const principal = await plataforma.tiendaPrincipal();
    return principal ? { tipo: 'tienda', tienda: principal, url } : { tipo: 'plataforma', url };
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const destino = await resolver(req);
        if (destino.tipo === 'sin-permiso') {
          res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          res.end(JSON.stringify({ error: 'No tiene permiso' }));
          return;
        }
        if (destino.tipo === 'no-existe') {
          res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          res.end(paginaSinTienda());
          return;
        }
        req.url = destino.url;
        if (destino.tipo === 'plataforma') {
          // Lo de la plataforma, y lo que no es de ninguna tienda (sin
          // principal): la plataforma contesta o manda a /login.
          (web.routing as (q: http.IncomingMessage, r: http.ServerResponse) => void)(req, res);
          return;
        }
        enTienda(destino.tienda.contexto, () => (destino.tienda.app.routing as (q: http.IncomingMessage, r: http.ServerResponse) => void)(req, res));
      } catch (error) {
        console.error('[plataforma] fallo repartiendo una peticion:', error);
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'error interno; revisa el log del servidor' }));
      }
    })();
  });

  // Los WebSocket (el rastreo en vivo) van a la tienda igual que el resto.
  server.on('upgrade', (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    void (async () => {
      const destino = await resolver(req).catch(() => null);
      if (!destino || destino.tipo !== 'tienda') {
        socket.destroy();
        return;
      }
      req.url = destino.url;
      enTienda(destino.tienda.contexto, () => destino.tienda.app.server.emit('upgrade', req, socket, head));
    })();
  });

  return {
    server,
    web,
    escuchar: (puerto, host) =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(puerto, host, () => resolve());
      }),
    cerrar: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await web.close();
    },
  };
}

/** /login, /registro, /logout y la portada: lo unico que no es de una tienda. */
async function rutasDeLaPlataforma(plataforma: Plataforma, segura: boolean, logger: boolean): Promise<FastifyInstance> {
  const web = Fastify({ logger, trustProxy: true, bodyLimit: 64 * 1024 });

  const siguienteSeguro = (next: unknown): string => {
    const s = typeof next === 'string' ? next : '';
    return s.startsWith('/') && !s.startsWith('//') ? s : '/panel';
  };

  /** Si quien pide ya tiene una sesion valida en su tienda. */
  async function conSesion(request: FastifyRequest): Promise<boolean> {
    const slug = leerCookies(request.headers.cookie)[COOKIE_TIENDA];
    if (!slug) return false;
    const tienda = await plataforma.tiendaPorSlug(decodeURIComponent(slug));
    if (!tienda) return false;
    const yo = await enTienda(tienda.contexto, () => tienda.app.inject({ method: 'GET', url: '/admin/yo', headers: { cookie: request.headers.cookie ?? '' } }));
    return yo.statusCode === 200 && yo.body !== 'null' && yo.body !== '';
  }

  const pagina = async (request: FastifyRequest, reply: FastifyReply, vista: 'entrar' | 'tienda') => {
    const query = request.query as { next?: string };
    if (await conSesion(request)) return reply.redirect(siguienteSeguro(query.next));
    return reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(
        loginPage({
          primeraCuenta: false,
          next: siguienteSeguro(query.next),
          nombreNegocio: 'Tu tienda en WhatsApp',
          // Una plataforma recien puesta abre por "Crear mi tienda": no hay con que entrar.
          vista: vista === 'tienda' || (await plataforma.cuantas()) === 0 ? 'tienda' : 'entrar',
        }),
      );
  };

  web.get('/', async (request, reply) => reply.redirect((await conSesion(request)) ? '/panel' : '/login'));
  web.get('/login', (request, reply) => pagina(request, reply, 'entrar'));
  web.get('/registro', (request, reply) => pagina(request, reply, 'tienda'));

  const ip = (request: FastifyRequest) => ipDe(request.raw);

  web.post('/login', async (request, reply) => {
    const body = (request.body ?? {}) as { usuario?: unknown; clave?: unknown; next?: unknown };
    if (typeof body.usuario !== 'string' || typeof body.clave !== 'string' || !body.usuario.trim() || !body.clave) {
      return reply.code(400).send({ error: 'Escribe tu usuario y tu contraseña.' });
    }
    const r = await plataforma.entrar({ usuario: body.usuario, clave: body.clave, next: siguienteSeguro(body.next) }, ip(request));
    const cookies = [...(r.setCookie ?? [])];
    if (r.status === 200 && r.tienda) cookies.push(cookieDeTienda(r.tienda.slug, segura));
    if (cookies.length) reply.header('set-cookie', cookies);
    return reply.code(r.status).send(r.body);
  });

  web.post('/registro', async (request, reply) => {
    const r = await plataforma.registrar(request.body, ip(request));
    if (!r.ok || !r.tienda) return reply.code(r.status).send({ error: r.error });
    reply.header('set-cookie', [...(r.setCookie ?? []), cookieDeTienda(r.tienda.slug, segura)]);
    return { ok: true, tienda: { slug: r.tienda.slug, nombre: r.tienda.nombre }, next: r.next ?? '/panel' };
  });

  // Solo dice si esta libre; el mismo freno de siempre para quien pregunta en bucle.
  const preguntas = new Map<string, number[]>();
  web.get('/registro/disponible', async (request, reply) => {
    const t0 = Date.now();
    const lista = (preguntas.get(ip(request)) ?? []).filter((t) => t > t0 - 60_000);
    if (lista.length >= 60) return reply.code(429).send({ error: 'Demasiadas consultas seguidas.' });
    lista.push(t0);
    preguntas.set(ip(request), lista);
    const usuario = String((request.query as { usuario?: string }).usuario ?? '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(usuario)) return { libre: null };
    return { libre: await plataforma.usuarioLibre(usuario) };
  });

  web.post('/logout', async (_request, reply) => {
    reply.header('set-cookie', [cookieDeCierre(segura), cierreDeTienda(segura)]);
    return { ok: true };
  });

  // Ya no hay "primera cuenta" suelta: cada registro es una tienda nueva.
  web.all('/login/primera-cuenta', async (_request, reply) =>
    reply.code(410).send({ error: 'Ahora cada cuenta nueva es una tienda nueva: créala en /registro.', ir: '/registro' }),
  );

  web.get('/health', async () => ({ ok: true, plataforma: true, tiendas: await plataforma.cuantas() }));

  // Lo que no es de ninguna tienda: una pantalla lleva a entrar; lo demas, un 404 que se entiende.
  web.setNotFoundHandler(async (request, reply) => {
    const aceptaHtml = String(request.headers.accept ?? '').includes('text/html');
    if (request.method === 'GET' && aceptaHtml) return reply.redirect(`/login?next=${encodeURIComponent(request.url)}`);
    return reply.code(404).send({ error: 'No encontrado. Si es de una tienda, usa su dirección (/tienda/<nombre>/...) o entra en /login.' });
  });

  await web.ready();
  return web;
}

function paginaSinTienda(): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Tienda no encontrada</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#f6f7f6;color:#17201d}main{max-width:420px;padding:24px;text-align:center}a{color:#0b7a4b;font-weight:600}</style></head>
<body><main><h1>Esta tienda no existe</h1><p>La dirección no corresponde a ninguna tienda, o la tienda está suspendida.</p><p><a href="/login">Ir a entrar</a> · <a href="/registro">Crear mi tienda</a></p></main></body></html>`;
}
