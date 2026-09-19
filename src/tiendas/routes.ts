/**
 * La pantalla Tiendas del superadministrador, y lo que preguntan las tiendas.
 *
 *  GET    /admin/tiendas                  todas, con su semaforo y el resumen (solo super)
 *  POST   /admin/tiendas                  dar de alta: devuelve el token UNA vez (solo super)
 *  POST   /admin/tiendas/:id              cambiar nombre, direccion, contacto, notas o membresia
 *  POST   /admin/tiendas/:id/pagos        apuntar un pago
 *  POST   /admin/tiendas/:id/suspender    { suspendida: true|false }
 *  POST   /admin/tiendas/:id/token        token nuevo (se ve una vez)
 *  DELETE /admin/tiendas/:id
 *
 *  GET    /api/plan/:slug                 lo que pregunta cada tienda con su token (sin sesion)
 *
 * Tambien: la propia instalacion puede depender de un maestro (otra
 * instalacion con su pantalla Tiendas): se pega la URL del plan y el token
 * en Membresia → "Esta instalacion depende de un maestro".
 *
 *  POST   /admin/membresia/maestro        { url, token }  (solo super)
 *  DELETE /admin/membresia/maestro
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ServicioPlan } from '../plan/servicio.js';
import type { ServicioTiendas } from './servicio.js';

export interface TiendasRoutesDeps {
  tiendas: ServicioTiendas;
  plan?: ServicioPlan;
}

function soloSuper(request: FastifyRequest, reply: FastifyReply, que: string): boolean {
  if (request.usuario?.super && !request.usuario.porToken) return true;
  void reply.code(403).send({ error: `Solo un superadministrador puede ${que}.` });
  return false;
}

const quien = (request: FastifyRequest): string | null => {
  const u = request.usuario;
  if (!u) return null;
  return u.nombre ? `${u.nombre} (${u.usuario})` : u.usuario;
};

const membresiaSchema = z.object({
  plan: z.string().trim().min(1).max(30),
  nombre: z.string().trim().max(60).optional(),
  vencimiento: z.string().trim().min(4).max(40),
  limites: z
    .object({
      iaTurnosMes: z.number().int().min(0).max(10_000_000).nullable().optional(),
      campanas: z.boolean().optional(),
      conectores: z.boolean().optional(),
      usuarios: z.number().int().min(1).max(10_000).nullable().optional(),
    })
    .optional(),
  precioMes: z.number().min(0).max(1_000_000).optional(),
  moneda: z.string().trim().max(8).optional(),
  estado: z.enum(['activa', 'suspendida']).optional(),
  contacto: z.string().trim().max(300).nullable().optional(),
  aviso: z.string().trim().max(500).nullable().optional(),
});

const tiendaSchema = z.object({
  nombre: z.string().trim().min(1).max(80),
  slug: z.string().trim().max(30).optional(),
  url: z.string().trim().max(300).nullable().optional(),
  contacto: z.string().trim().max(300).nullable().optional(),
  notas: z.string().trim().max(1000).nullable().optional(),
  crearInstalacion: z.boolean().optional(),
  proveedor: z.enum(['cloud', 'local', 'waha']).optional(),
});

export async function registerTiendasRoutes(app: FastifyInstance, deps: TiendasRoutesDeps): Promise<void> {
  const { tiendas } = deps;
  const con400 = async (reply: FastifyReply, fn: () => Promise<unknown>) => {
    try {
      return await fn();
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  };

  app.get('/admin/tiendas', async (request, reply) => {
    if (!soloSuper(request, reply, 'ver las tiendas')) return;
    return tiendas.listar();
  });

  app.post('/admin/tiendas', async (request, reply) => {
    if (!soloSuper(request, reply, 'dar de alta tiendas')) return;
    const body = tiendaSchema.extend({ membresia: membresiaSchema }).parse(request.body ?? {});
    return con400(reply, async () => {
      const r = await tiendas.crear({ ...body, membresia: body.membresia as import('../plan/servicio.js').EntradaMembresia }, quien(request));
      const pasos = r.instalacion.ok
        ? [
            `Su sistema ya está en ${r.instalacion.url}: entra ahí y crea la primera cuenta (será el superadministrador de esa tienda; puedes ser tú).`,
            'Esa instalación ya toma su plan de este panel: no hay que pegar nada. En esta lista aparecerá en línea en cuanto arranque.',
            'Después, en Usuarios de esa tienda, crea la cuenta del negocio (administrador) y dásela al cliente; él conecta su WhatsApp con el QR.',
          ]
        : [
            `En el sistema de WhatsApp de "${r.tienda.nombre}", entra como superadministrador en Mi negocio → Membresía → «Esta instalación depende de un maestro».`,
            `Pega la dirección del plan: ${r.tienda.urlPlan}`,
            'Pega este token y pulsa Conectar. Desde ese momento esa tienda toma su plan de aquí, y en esta lista se verá en línea.',
          ];
      return { ok: true, ...r, pasos, mensaje: r.instalacion.intentada && !r.instalacion.ok ? `La tienda quedó registrada, pero su instalación no se pudo levantar: ${r.instalacion.error ?? ''}. Revisa Docker en el servidor y vuelve a intentarlo, o hazla a mano (npm run saas:alta).` : null };
    });
  });

  app.post<{ Params: { id: string } }>('/admin/tiendas/:id', async (request, reply) => {
    if (!soloSuper(request, reply, 'cambiar tiendas')) return;
    const body = tiendaSchema.partial().extend({ membresia: membresiaSchema.optional() }).parse(request.body ?? {});
    return con400(reply, async () => {
      const t = await tiendas.cambiar(request.params.id, { ...body, membresia: body.membresia as import('../plan/servicio.js').EntradaMembresia | undefined }, quien(request));
      if (!t) return reply.code(404).send({ error: 'Esa tienda no existe.' });
      return { ok: true, tienda: t };
    });
  });

  app.post<{ Params: { id: string } }>('/admin/tiendas/:id/pagos', async (request, reply) => {
    if (!soloSuper(request, reply, 'apuntar pagos')) return;
    const body = z.object({ meses: z.coerce.number().int().min(1).max(60), monto: z.coerce.number().min(0).max(10_000_000).default(0), moneda: z.string().trim().max(8).optional(), nota: z.string().trim().max(200).optional() }).parse(request.body ?? {});
    return con400(reply, async () => {
      const t = await tiendas.anotarPago(request.params.id, body, quien(request));
      if (!t) return reply.code(404).send({ error: 'Esa tienda no existe.' });
      return { ok: true, tienda: t, mensaje: `Pago apuntado: ${body.meses} mes${body.meses === 1 ? '' : 'es'}. ${t.nombre} queda pagada hasta el ${new Date(t.membresia.vencimiento).toLocaleDateString('es-PE')}.` };
    });
  });

  app.post<{ Params: { id: string } }>('/admin/tiendas/:id/suspender', async (request, reply) => {
    if (!soloSuper(request, reply, 'suspender tiendas')) return;
    const body = z.object({ suspendida: z.boolean() }).parse(request.body ?? {});
    const t = await tiendas.suspender(request.params.id, body.suspendida, quien(request));
    if (!t) return reply.code(404).send({ error: 'Esa tienda no existe.' });
    return { ok: true, tienda: t, mensaje: body.suspendida ? `${t.nombre} suspendida: su IA y sus campañas se paran en cuanto vuelva a preguntar por el plan (como mucho, un cuarto de hora).` : `${t.nombre} reactivada.` };
  });

  app.post<{ Params: { id: string } }>('/admin/tiendas/:id/token', async (request, reply) => {
    if (!soloSuper(request, reply, 'cambiar el token de una tienda')) return;
    const r = await tiendas.rotarToken(request.params.id);
    if (!r) return reply.code(404).send({ error: 'Esa tienda no existe.' });
    return { ok: true, ...r, mensaje: 'Token nuevo: el anterior deja de valer. Pégalo en la Membresía de esa tienda.' };
  });

  app.delete<{ Params: { id: string } }>('/admin/tiendas/:id', async (request, reply) => {
    if (!soloSuper(request, reply, 'borrar tiendas')) return;
    const q = z.object({ instalacion: z.enum(['dejar', 'parar', 'borrar']).default('dejar') }).parse(request.query ?? {});
    const r = await tiendas.borrar(request.params.id, { quitarInstalacion: q.instalacion !== 'dejar', borrarDatos: q.instalacion === 'borrar' });
    if (!r.ok) return reply.code(404).send({ error: 'Esa tienda no existe.' });
    return { ok: true, instalacion: r.instalacion, mensaje: r.instalacion.intentada ? (r.instalacion.ok ? (q.instalacion === 'borrar' ? 'Tienda borrada, con su instalación y sus datos.' : 'Tienda borrada; su instalación se paró y sus datos se conservan.') : `Tienda borrada, pero su instalación no se pudo parar: ${r.instalacion.error ?? ''}`) : 'Tienda borrada de la lista.' };
  });

  /** Lo que pregunta cada tienda: su plan de hoy. Con su token, sin sesion. */
  app.get<{ Params: { slug: string } }>('/api/plan/:slug', async (request, reply) => {
    const h = request.headers.authorization ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    const plan = await tiendas.planPara(request.params.slug, token, request.ip || null);
    if (!plan) return reply.code(401).send({ error: 'Tienda o token incorrectos.' });
    return plan;
  });

  // ------------------------------------------- esta instalacion depende de un maestro

  app.post('/admin/membresia/maestro', async (request, reply) => {
    if (!soloSuper(request, reply, 'conectar esta instalación a un maestro')) return;
    if (!deps.plan) return reply.code(409).send({ error: 'Este arranque no lleva membresía.' });
    const body = z.object({ url: z.string().trim().min(8).max(300), token: z.string().trim().min(8).max(200) }).parse(request.body ?? {});
    return con400(reply, async () => {
      const e = await deps.plan!.conectarMaestro(body);
      return { ok: true, ...e, mensaje: `Conectado: esta instalación toma su plan de ${body.url.replace(/\/api\/plan\/.*$/, '')} (${e.plan?.nombre ?? '?'}, vence el ${e.plan ? new Date(e.plan.vencimiento).toLocaleDateString('es-PE') : '?'}).` };
    });
  });

  app.delete('/admin/membresia/maestro', async (request, reply) => {
    if (!soloSuper(request, reply, 'desconectar el maestro')) return;
    if (!deps.plan) return reply.code(409).send({ error: 'Este arranque no lleva membresía.' });
    return con400(reply, async () => ({ ok: true, ...(await deps.plan!.desconectarMaestro()) }));
  });
}
