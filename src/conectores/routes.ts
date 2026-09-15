/**
 * Las rutas de los conectores.
 *
 *  - `POST /conectores/:id`: la que se pega en WooCommerce o en Shopify. Es
 *    publica; lo que la protege es la firma de la tienda con el secreto del
 *    conector. Contesta 200 en cuanto la firma cuadra, haga lo que haga
 *    despues: las tiendas reintentan y desactivan webhooks que fallan.
 *  - `/api/v1/conectores`: crear, configurar reglas, ver que llego y probar.
 */

import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { ConectoresDeps } from './servicio.js';
import { procesarPedido } from './servicio.js';
import { CABECERA_FIRMA, DESCRIPCION_EVENTOS_TIENDA, EVENTOS_TIENDA, firmaValida, leerTienda, TIPOS_TIENDA, VARIABLES_PEDIDO, type PedidoTienda } from './tiendas.js';
import type { ReglaConector } from './repo.js';

const reglaSchema = z.object({
  evento: z.enum(EVENTOS_TIENDA as [string, ...string[]]),
  activo: z.boolean().default(true),
  plantilla: z.object({ nombre: z.string().min(1).max(120), idioma: z.string().max(10).default('es') }).nullable().default(null),
  variables: z.array(z.string().max(300)).max(20).default([]),
  texto: z.string().max(1000).nullable().default(null),
});

const reglasSchema = z
  .array(reglaSchema)
  .max(EVENTOS_TIENDA.length * 2)
  .transform((reglas) => reglas as ReglaConector[]);

/** Un secreto para WooCommerce: se genera aqui y se pega alla. */
export function generarSecretoConector(): string {
  return 'wcs_' + randomBytes(18).toString('hex');
}

export async function registerConectoresRoutes(app: FastifyInstance, deps: ConectoresDeps): Promise<void> {
  const { repos, config } = deps;
  const urlDe = (id: string) => `${config.PUBLIC_BASE_URL.replace(/\/+$/, '')}/conectores/${id}`;

  // --- la puerta por la que entra la tienda -------------------------------

  app.post<{ Params: { id: string } }>('/conectores/:id', async (request, reply) => {
    const conector = await repos.conectores.conSecreto(request.params.id);
    if (!conector) return reply.code(404).send({ error: 'ese conector no existe' });

    const cuerpoCrudo = (request as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from('');
    const firma = request.headers[CABECERA_FIRMA[conector.tipo]];
    if (!firmaValida(conector.secreto, cuerpoCrudo, typeof firma === 'string' ? firma : undefined)) {
      request.log.warn({ conector: conector.id }, 'webhook de tienda con firma invalida');
      return reply.code(401).send({ error: 'firma invalida: el secreto de la tienda no es el de este conector' });
    }

    const cabeceras = Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
    const lectura = leerTienda(conector.tipo, cabeceras, request.body);
    if (lectura.ping) return { ok: true, ping: true };
    if (!lectura.pedido) {
      await repos.conectores.anotarEntrada({ conectorId: conector.id, evento: 'otro', eventoOrigen: lectura.ignorado ?? null, pedido: null, telefono: null, resultado: 'ignorado', detalle: 'no es un evento de pedidos', at: deps.ahora?.() });
      return { ok: true, ignorado: lectura.ignorado };
    }
    if (!conector.activo) {
      await repos.conectores.anotarEntrada({ conectorId: conector.id, evento: lectura.pedido.evento, eventoOrigen: lectura.pedido.eventoOrigen, pedido: lectura.pedido.numero, telefono: lectura.pedido.telefono, resultado: 'ignorado', detalle: 'el conector esta pausado', at: deps.ahora?.() });
      return { ok: true, ignorado: 'conector pausado' };
    }

    const r = await procesarPedido(conector, lectura.pedido, deps);
    return { ok: true, evento: lectura.pedido.evento, resultado: r.resultado, detalle: r.detalle };
  });

  // --- gestion -------------------------------------------------------------

  app.get('/api/v1/conectores/opciones', { config: { permiso: 'conectores:gestionar' } }, async () => ({
    tipos: TIPOS_TIENDA,
    eventos: EVENTOS_TIENDA.map((e) => ({ nombre: e, descripcion: DESCRIPCION_EVENTOS_TIENDA[e] })),
    variables: VARIABLES_PEDIDO,
    plantillas: (await repos.templates.list()).filter((t) => t.status === 'APPROVED').map((t) => ({ nombre: t.name, idioma: t.language, variables: t.variables, cuerpo: t.body })),
  }));

  app.get('/api/v1/conectores', { config: { permiso: 'conectores:gestionar' } }, async () => ({
    conectores: (await repos.conectores.listar()).map((c) => ({ ...c, url: urlDe(c.id) })),
  }));

  /** Crea el conector. Devuelve el secreto UNA vez (WooCommerce) o el que se pego (Shopify). */
  app.post('/api/v1/conectores', { config: { permiso: 'conectores:gestionar' } }, async (request, reply) => {
    const body = z
      .object({
        tipo: z.enum(TIPOS_TIENDA as [string, ...string[]]),
        nombre: z.string().trim().min(1).max(80),
        /** Shopify da el suyo; si no viene, se genera. */
        secreto: z.string().trim().min(8).max(200).optional(),
        reglas: reglasSchema.default([]),
      })
      .parse(request.body ?? {});
    const secreto = body.secreto ?? generarSecretoConector();
    const conector = await repos.conectores.crear({
      tipo: body.tipo as 'woocommerce' | 'shopify',
      nombre: body.nombre,
      secreto,
      reglas: body.reglas,
      creadoPor: request.usuario && !request.usuario.porToken ? request.usuario.id : null,
    });
    return reply.code(201).send({ ok: true, conector: { ...conector, url: urlDe(conector.id) }, secreto });
  });

  app.get<{ Params: { id: string } }>('/api/v1/conectores/:id', { config: { permiso: 'conectores:gestionar' } }, async (request, reply) => {
    const c = await repos.conectores.obtener(request.params.id);
    if (!c) return reply.code(404).send({ error: 'ese conector no existe' });
    return { conector: { ...c, url: urlDe(c.id) } };
  });

  app.patch<{ Params: { id: string } }>('/api/v1/conectores/:id', { config: { permiso: 'conectores:gestionar' } }, async (request, reply) => {
    const body = z
      .object({ nombre: z.string().trim().min(1).max(80).optional(), activo: z.boolean().optional(), reglas: reglasSchema.optional() })
      .parse(request.body ?? {});
    const c = await repos.conectores.actualizar(request.params.id, body);
    if (!c) return reply.code(404).send({ error: 'ese conector no existe' });
    return { ok: true, conector: { ...c, url: urlDe(c.id) } };
  });

  app.delete<{ Params: { id: string } }>('/api/v1/conectores/:id', { config: { permiso: 'conectores:gestionar' } }, async (request, reply) => {
    const ok = await repos.conectores.borrar(request.params.id);
    if (!ok) return reply.code(404).send({ error: 'ese conector no existe' });
    return { ok: true };
  });

  /** Secreto nuevo: el que se pase (Shopify) o uno generado (WooCommerce). */
  app.post<{ Params: { id: string } }>('/api/v1/conectores/:id/secreto', { config: { permiso: 'conectores:gestionar' } }, async (request, reply) => {
    const body = z.object({ secreto: z.string().trim().min(8).max(200).optional() }).parse(request.body ?? {});
    const secreto = body.secreto ?? generarSecretoConector();
    const ok = await repos.conectores.cambiarSecreto(request.params.id, secreto);
    if (!ok) return reply.code(404).send({ error: 'ese conector no existe' });
    return { ok: true, secreto };
  });

  app.get<{ Params: { id: string } }>('/api/v1/conectores/:id/entradas', { config: { permiso: 'conectores:gestionar' } }, async (request, reply) => {
    const q = z.object({ limite: z.coerce.number().int().positive().max(200).default(50) }).parse(request.query ?? {});
    const c = await repos.conectores.obtener(request.params.id);
    if (!c) return reply.code(404).send({ error: 'ese conector no existe' });
    return { entradas: await repos.conectores.entradas(c.id, q.limite) };
  });

  /**
   * Probar una regla con un pedido inventado, a un telefono real. Es la
   * forma de ver el mensaje tal como le llegara al cliente antes de pegar la
   * URL en la tienda.
   */
  app.post<{ Params: { id: string } }>('/api/v1/conectores/:id/probar', { config: { permiso: 'conectores:gestionar' } }, async (request, reply) => {
    const body = z
      .object({
        evento: z.enum(EVENTOS_TIENDA as [string, ...string[]]).default('pedido.creado'),
        telefono: z.string().min(6).max(30),
        nombre: z.string().max(80).default('Cliente de prueba'),
        numero: z.string().max(40).default('1024'),
        total: z.string().max(20).default('150.00'),
      })
      .parse(request.body ?? {});
    const c = await repos.conectores.obtener(request.params.id);
    if (!c) return reply.code(404).send({ error: 'ese conector no existe' });
    const pedido: PedidoTienda = {
      evento: body.evento as PedidoTienda['evento'],
      eventoOrigen: 'prueba',
      numero: body.numero,
      estado: 'prueba',
      total: body.total,
      moneda: 'PEN',
      nombre: body.nombre,
      telefono: body.telefono,
      seguimiento: null,
      items: '1 x Articulo de prueba',
    };
    const r = await procesarPedido(c, pedido, deps);
    return { ok: r.resultado === 'enviado', ...r };
  });
}
