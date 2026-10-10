/**
 * La pantalla Tiendas del superadministrador, y lo que preguntan las tiendas.
 *
 *  GET    /admin/tiendas                  todas, con su semaforo, su salud, el resumen,
 *                                         como se cobra y las capturas por revisar (solo super)
 *  POST   /admin/tiendas                  dar de alta: devuelve el token UNA vez (solo super)
 *  POST   /admin/tiendas/:id              cambiar nombre, direccion, contacto, notas o membresia
 *  POST   /admin/tiendas/:id/pagos        apuntar un pago
 *  POST   /admin/tiendas/:id/suspender    { suspendida: true|false }
 *  POST   /admin/tiendas/:id/token        token nuevo (se ve una vez)
 *  DELETE /admin/tiendas/:id
 *  GET    /admin/tiendas/:id/historial    lo que se hizo con esa tienda (bitacora)
 *  POST   /admin/tiendas/:id/avisar       { texto }: un WhatsApp al contacto de la tienda
 *  GET    /admin/tiendas/cobro            como me pagan (Yape/Plin + QR)
 *  POST   /admin/tiendas/cobro
 *  GET    /admin/tiendas/pagos/:pagoId    una captura de pago, con su imagen
 *  POST   /admin/tiendas/pagos/:pagoId/aceptar   { tiendaId, meses?, monto? }: apunta el pago
 *  POST   /admin/tiendas/pagos/:pagoId/rechazar  { tiendaId, motivo }
 *  GET    /admin/tiendas/avisos           textos de los avisos de vencimiento y la ultima revision
 *  POST   /admin/tiendas/avisos           guardar textos
 *  POST   /admin/tiendas/avisos/revisar   mirar ahora y mandar lo que toque
 *  POST   /admin/tiendas/avisos/previsualizar { tipo, texto }
 *
 *  GET    /api/plan/:slug                 lo que pregunta cada tienda con su token (sin sesion);
 *                                         la cabecera x-gsgchat-estado trae su parte de salud
 *  POST   /api/plan/:slug/pago            la tienda manda la captura de su pago (con su token)
 *
 * Tambien: la propia instalacion puede depender de un maestro (otra
 * instalacion con su pantalla Tiendas): se pega la URL del plan y el token
 * en Membresia → "Esta instalacion depende de un maestro".
 *
 *  POST   /admin/membresia/maestro        { url, token }  (solo super)
 *  DELETE /admin/membresia/maestro
 *  GET    /admin/membresia/pagar          lo que enseña /pagar (plan, como pagar, ultima captura)
 *  POST   /admin/membresia/pago-captura   { imagen, meses, nota }: manda la captura al maestro
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { EstadoInstancia, ServicioPlan } from '../plan/servicio.js';
import { fechaLima, type ServicioTiendas } from './servicio.js';
import type { ServicioAvisosTiendas } from './avisos.js';
import { VARIABLES_AVISOS, VARIABLES_RECIBO } from './avisos.js';
import type { UsuariosRepo } from '../auth/usuarios.js';
import { hashClave } from '../auth/usuarios.js';
import { cookieDeSesion, firmarSesion } from '../auth/sesion.js';
import { randomBytes } from 'node:crypto';

export interface TiendasRoutesDeps {
  tiendas: ServicioTiendas;
  plan?: ServicioPlan;
  /** Los avisos de vencimiento (textos, revisar ahora). Sin el, la pantalla lo dice. */
  avisos?: ServicioAvisosTiendas;
  /** Para el acceso de soporte: la cuenta temporal con la que entra el dueño. */
  usuarios?: UsuariosRepo;
  /** El secreto de las cookies y si van solo por https (lo mismo que /login). */
  sesion?: { secreto: string; segura: boolean };
}

/** La cuenta con la que el dueño del sistema entra a una tienda con acceso de soporte. */
export const USUARIO_SOPORTE = 'soporte';

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

const estadoInstanciaSchema = z.object({
  whatsapp: z.enum(['conectado', 'caido', 'sin_conectar']),
  mensajesHoy: z.coerce.number().int().min(0).max(10_000_000).default(0),
  fallosIA: z.coerce.number().int().min(0).max(10_000_000).default(0),
  entregasHoy: z.coerce.number().int().min(0).max(10_000_000).default(0),
  version: z.string().max(40).default(''),
  soporte: z.object({ hasta: z.string().max(40), enlace: z.string().max(400) }).nullable().optional(),
});

/** El parte de salud que manda la tienda en la cabecera; null si no viene o no se entiende. */
function parteDeCabecera(request: FastifyRequest): EstadoInstancia | null {
  const h = request.headers['x-gsgchat-estado'];
  const texto = Array.isArray(h) ? h[0] : h;
  if (!texto || texto.length > 2000) return null;
  try {
    return estadoInstanciaSchema.parse(JSON.parse(texto));
  } catch {
    return null;
  }
}

const tokenDe = (request: FastifyRequest): string => {
  const h = request.headers.authorization ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
};

const CUERPO_CAPTURA = 6 * 1024 * 1024;

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

  // ------------------------------------------------- como me pagan (antes de /:id)

  app.get('/admin/tiendas/cobro', async (request, reply) => {
    if (!soloSuper(request, reply, 'ver cómo se cobra')) return;
    return { ok: true, cobro: await tiendas.cobro() };
  });

  app.post('/admin/tiendas/cobro', { bodyLimit: CUERPO_CAPTURA }, async (request, reply) => {
    if (!soloSuper(request, reply, 'cambiar cómo se cobra')) return;
    const body = z.object({ activo: z.boolean().optional(), texto: z.string().max(600).optional(), numero: z.string().max(40).optional(), qr: z.string().max(1_600_000).optional() }).parse(request.body ?? {});
    return con400(reply, async () => ({ ok: true, cobro: await tiendas.guardarCobro(body), mensaje: 'Guardado: cada tienda lo verá en su pantalla Pagar.' }));
  });

  // ------------------------------------------------- capturas de pago por revisar

  app.get<{ Params: { pagoId: string } }>('/admin/tiendas/pagos/:pagoId', async (request, reply) => {
    if (!soloSuper(request, reply, 'ver las capturas de pago')) return;
    const p = await tiendas.pago(Number(request.params.pagoId));
    if (!p) return reply.code(404).send({ error: 'Esa captura no existe.' });
    return { ok: true, pago: p };
  });

  app.post<{ Params: { pagoId: string } }>('/admin/tiendas/pagos/:pagoId/aceptar', async (request, reply) => {
    if (!soloSuper(request, reply, 'apuntar pagos')) return;
    const body = z.object({ tiendaId: z.string().optional(), meses: z.coerce.number().int().min(1).max(60).optional(), monto: z.coerce.number().min(0).max(10_000_000).optional() }).parse(request.body ?? {});
    const r = await tiendas.aceptarPago(Number(request.params.pagoId), quien(request), { meses: body.meses, monto: body.monto });
    if (!r.ok) return reply.code(400).send({ error: r.error });
    const recibo = deps.avisos ? await deps.avisos.recibo(r.tienda.id, { meses: r.pago.meses, monto: r.pago.monto ?? 0, moneda: r.pago.moneda }) : null;
    return { ...r, recibo, mensaje: recibo ? `${r.mensaje} ${recibo.ok ? 'Recibo enviado por WhatsApp a la tienda.' : `Sin recibo por WhatsApp: ${recibo.detalle}.`}` : r.mensaje };
  });

  app.post<{ Params: { pagoId: string } }>('/admin/tiendas/pagos/:pagoId/rechazar', async (request, reply) => {
    if (!soloSuper(request, reply, 'rechazar pagos')) return;
    const body = z.object({ tiendaId: z.string().optional(), motivo: z.string().max(300).default('') }).parse(request.body ?? {});
    const r = await tiendas.rechazarPago(Number(request.params.pagoId), body.motivo, quien(request));
    if (!r.ok) return reply.code(400).send({ error: r.error });
    return { ...r, mensaje: 'Rechazada: la tienda verá el motivo en su pantalla Pagar.' };
  });

  // ------------------------------------------------- avisos de vencimiento

  app.get('/admin/tiendas/avisos', async (request, reply) => {
    if (!soloSuper(request, reply, 'ver los avisos de vencimiento')) return;
    if (!deps.avisos) return { ok: true, disponible: false, textos: null, ultimaRevision: null, variables: VARIABLES_AVISOS, variablesRecibo: VARIABLES_RECIBO };
    return { ok: true, disponible: true, textos: await deps.avisos.textos(), ultimaRevision: deps.avisos.ultimaRevision(), variables: VARIABLES_AVISOS, variablesRecibo: VARIABLES_RECIBO };
  });

  app.post('/admin/tiendas/avisos', async (request, reply) => {
    if (!soloSuper(request, reply, 'cambiar los avisos de vencimiento')) return;
    if (!deps.avisos) return reply.code(409).send({ error: 'Este arranque no lleva avisos de vencimiento.' });
    const body = z.object({ activo: z.boolean().optional(), aLaTienda: z.boolean().optional(), vence7: z.string().max(1000).optional(), vence1: z.string().max(1000).optional(), vencida: z.string().max(1000).optional(), alDueno: z.string().max(1000).optional(), reciboActivo: z.boolean().optional(), recibo: z.string().max(1000).optional(), sinLatidoHoras: z.coerce.number().min(0).max(48).optional(), sinLatido: z.string().max(1000).optional() }).parse(request.body ?? {});
    return { ok: true, textos: await deps.avisos.guardarTextos(body), mensaje: 'Avisos guardados.' };
  });

  app.post('/admin/tiendas/avisos/revisar', async (request, reply) => {
    if (!soloSuper(request, reply, 'mandar los avisos de vencimiento')) return;
    if (!deps.avisos) return reply.code(409).send({ error: 'Este arranque no lleva avisos de vencimiento.' });
    const r = await deps.avisos.revisar();
    const n = r.mandados.length;
    return { ok: true, revision: r, mensaje: r.apagado ? 'Los avisos están apagados: no se mandó nada.' : n ? `${n} aviso${n === 1 ? '' : 's'} mandado${n === 1 ? '' : 's'}.` : r.yaAvisadas ? 'Nada nuevo: lo que tocaba avisar ya se avisó.' : 'Ninguna tienda vence en los próximos 7 días.' };
  });

  app.post('/admin/tiendas/avisos/previsualizar', async (request, reply) => {
    if (!soloSuper(request, reply, 'ver los avisos')) return;
    if (!deps.avisos) return reply.code(409).send({ error: 'Este arranque no lleva avisos de vencimiento.' });
    const body = z.object({ tipo: z.enum(['vence7', 'vence1', 'vencida', 'recibo']), texto: z.string().max(1000) }).parse(request.body ?? {});
    return { ok: true, texto: await deps.avisos.previsualizar(body.tipo, body.texto) };
  });

  // ------------------------------------------------- por tienda

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
      const recibo = deps.avisos ? await deps.avisos.recibo(t.id, { meses: body.meses, monto: body.monto, moneda: body.moneda ?? null }) : null;
      return { ok: true, tienda: t, recibo, mensaje: `Pago apuntado: ${body.meses} mes${body.meses === 1 ? '' : 'es'}. ${t.nombre} queda pagada hasta el ${fechaLima(t.membresia.vencimiento)}.${recibo ? (recibo.ok ? ' Recibo enviado por WhatsApp a la tienda.' : ` Sin recibo por WhatsApp: ${recibo.detalle}.`) : ''}` };
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

  app.get<{ Params: { id: string } }>('/admin/tiendas/:id/historial', async (request, reply) => {
    if (!soloSuper(request, reply, 'ver el historial de una tienda')) return;
    const t = await tiendas.porId(request.params.id);
    if (!t) return reply.code(404).send({ error: 'Esa tienda no existe.' });
    return { ok: true, tienda: { id: t.id, nombre: t.nombre }, historial: await tiendas.historial(t.id) };
  });

  app.post<{ Params: { id: string } }>('/admin/tiendas/:id/avisar', async (request, reply) => {
    if (!soloSuper(request, reply, 'escribirle a una tienda')) return;
    const body = z.object({ texto: z.string().max(2000) }).parse(request.body ?? {});
    const r = await tiendas.avisar(request.params.id, body.texto);
    if (!r.ok) return reply.code(400).send({ error: r.error });
    return { ok: true, telefono: r.telefono, mensaje: `Mensaje enviado al +${r.telefono}.` };
  });

  // ------------------------------------------------- lo que preguntan las tiendas (sin sesion)

  /** Lo que pregunta cada tienda: su plan de hoy. Con su token, sin sesion. */
  app.get<{ Params: { slug: string } }>('/api/plan/:slug', async (request, reply) => {
    const plan = await tiendas.planPara(request.params.slug, tokenDe(request), request.ip || null, parteDeCabecera(request));
    if (!plan) return reply.code(401).send({ error: 'Tienda o token incorrectos.' });
    return plan;
  });

  /** La tienda manda la captura de su pago (desde su pantalla Pagar). */
  app.post<{ Params: { slug: string } }>('/api/plan/:slug/pago', { bodyLimit: CUERPO_CAPTURA }, async (request, reply) => {
    const body = z.object({ imagen: z.string().max(3_100_000), meses: z.coerce.number().int().min(1).max(60).default(1), monto: z.coerce.number().min(0).max(10_000_000).nullable().optional(), nota: z.string().max(300).nullable().optional() }).parse(request.body ?? {});
    const r = await tiendas.recibirPago(request.params.slug, tokenDe(request), body);
    if (!r.ok) return reply.code(r.codigo).send({ error: r.error });
    return { ok: true, pago: r.pago };
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

  // ------------------------------------------- acceso de soporte (esta instalacion)

  /** La cuenta "soporte" se enciende con el acceso y se apaga cuando se quita o caduca. */
  async function apagarCuentaSoporte(): Promise<void> {
    if (!deps.usuarios) return;
    const u = await deps.usuarios.porUsuario(USUARIO_SOPORTE);
    if (u && u.activo) await deps.usuarios.setActivo(u.id, false);
  }
  if (deps.plan) {
    deps.plan.alCambiarSoporte(async (acceso) => {
      if (!acceso) await apagarCuentaSoporte();
    });
  }

  app.get('/admin/membresia/soporte', async (_request, reply) => {
    if (!deps.plan) return reply.code(409).send({ error: 'Este arranque no lleva membresía.' });
    return { ok: true, soporte: deps.plan.soporte(), conMaestro: deps.plan.estado().origen === 'maestro' };
  });

  app.post('/admin/membresia/soporte', async (request, reply) => {
    if (!soloSuper(request, reply, 'dar acceso de soporte')) return;
    if (!deps.plan) return reply.code(409).send({ error: 'Este arranque no lleva membresía.' });
    if (!deps.usuarios || !deps.sesion) return reply.code(409).send({ error: 'Este arranque no puede abrir cuentas de soporte.' });
    const body = z.object({ horas: z.coerce.number().int().min(1).max(72).default(24) }).parse(request.body ?? {});
    const acceso = await deps.plan.concederSoporte(body.horas);
    return { ok: true, soporte: acceso, mensaje: `Acceso concedido hasta las ${new Date(acceso.hasta).toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false })}: el dueño del sistema podrá entrar a este panel como administrador. Se quita solo al caducar, o cuando lo quites tú.` };
  });

  app.delete('/admin/membresia/soporte', async (request, reply) => {
    if (!soloSuper(request, reply, 'quitar el acceso de soporte')) return;
    if (!deps.plan) return reply.code(409).send({ error: 'Este arranque no lleva membresía.' });
    await deps.plan.revocarSoporte();
    await apagarCuentaSoporte();
    return { ok: true, mensaje: 'Acceso de soporte quitado: el dueño del sistema ya no puede entrar a este panel.' };
  });

  // El enlace que recibe el dueño: si vale, entra como la cuenta "soporte" (administrador) y va al panel.
  app.get<{ Params: { codigo: string } }>('/soporte/:codigo', async (request, reply) => {
    const paginaCaducado = () =>
      reply
        .code(410)
        .type('text/html; charset=utf-8')
        .send('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acceso de soporte</title><body style="font-family:system-ui,sans-serif;max-width:520px;margin:60px auto;padding:0 16px;color:#1f2933"><h1 style="font-size:22px">Este enlace de soporte ya no vale</h1><p>El acceso que concedió la tienda caducó o lo quitaron. Pídele a la tienda que vuelva a concederlo desde su pantalla <b>Pagar → Acceso de soporte</b> y usa el enlace nuevo.</p><p><a href="/login">Ir a la entrada normal</a></p></body></html>');
    if (!deps.plan || !deps.usuarios || !deps.sesion) return paginaCaducado();
    if (!deps.plan.canjearSoporte(request.params.codigo)) return paginaCaducado();
    let u = await deps.usuarios.porUsuario(USUARIO_SOPORTE);
    if (!u) {
      const creado = await deps.usuarios.crear({ usuario: USUARIO_SOPORTE, nombre: 'Soporte (dueño del sistema)', clave: hashClave(randomBytes(24).toString('base64url')), rol: 'admin' });
      u = await deps.usuarios.porUsuario(creado.usuario);
    }
    if (!u) return paginaCaducado();
    if (u.rol === 'superadmin') return paginaCaducado();
    if (!u.activo) await deps.usuarios.setActivo(u.id, true);
    await deps.usuarios.tocarLogin(u.id, new Date());
    reply.header('set-cookie', cookieDeSesion(firmarSesion(deps.sesion.secreto, { u: u.id, v: u.sesionVersion }, Date.now()), deps.sesion.segura));
    return reply.redirect('/panel');
  });

  // ------------------------------------------- la pantalla Pagar de esta instalacion

  app.get('/admin/membresia/pagar', async (_request, reply) => {
    if (!deps.plan) return reply.code(409).send({ error: 'Este arranque no lleva membresía.' });
    // Con maestro, se le pregunta otra vez si lo ultimo tiene mas de medio
    // minuto: la tienda entra aqui a ver si le aceptaron la captura.
    const e = deps.plan.estado();
    if (e.origen === 'maestro' && (!e.consultadoEn || Date.now() - new Date(e.consultadoEn).getTime() > 30_000)) await deps.plan.refrescar();
    return { ok: true, ...deps.plan.paraPagar() };
  });

  app.post('/admin/membresia/pago-captura', { bodyLimit: CUERPO_CAPTURA }, async (request, reply) => {
    if (!deps.plan) return reply.code(409).send({ error: 'Este arranque no lleva membresía.' });
    const body = z.object({ imagen: z.string().max(3_100_000), meses: z.coerce.number().int().min(1).max(60).default(1), monto: z.coerce.number().min(0).max(10_000_000).optional(), nota: z.string().max(300).optional() }).parse(request.body ?? {});
    const r = await deps.plan.mandarCaptura(body);
    if (!r.ok) return reply.code(400).send({ error: r.error });
    return r;
  });
}
