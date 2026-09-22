/**
 * Lo del superadministrador: la membresia y los codigos de conexion.
 *
 * Membresia (`/admin/membresia`): que plan tiene esta instalacion, hasta
 * cuando esta pagada, sus topes, los pagos apuntados y si esta suspendida.
 * Cualquier administrador la VE (es lo que explica por que la IA o las
 * campañas estan en pausa); solo un superadministrador la cambia, y solo si
 * la instancia no tiene maestro (con maestro, manda el maestro del SaaS).
 *
 * Codigos de conexion (`/admin/codigos-conexion`): un codigo corto con fecha
 * limite y usos, para que otro sistema (Stoky, una tienda) se conecte sin
 * copiar claves. Lo crea un administrador o un superadministrador; lo canjea
 * el otro sistema en `POST /api/v1/conexion/canjear` (sin clave: el codigo
 * ES la autorizacion) y recibe su clave de API. El canje tiene tope por IP.
 *
 *  GET    /admin/membresia                 estado (admin y super)
 *  POST   /admin/membresia                 plan, vencimiento, topes, aviso, contacto, estado (solo super, sin maestro)
 *  POST   /admin/membresia/pagos           apuntar un pago: corre el vencimiento (solo super)
 *  DELETE /admin/membresia                 volver a instancia libre (solo super)
 *  GET    /admin/codigos-conexion          la lista, con su estado real
 *  POST   /admin/codigos-conexion          crear: para, caduca (fecha o dias), usos, permisos
 *  DELETE /admin/codigos-conexion/:id      anular
 *  POST   /api/v1/conexion/canjear         { codigo, sistema } -> { clave, direccion, para }
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { ClavesApiRepo } from './claves-api.js';
import { generarClaveApi, hashClaveApi, prefijoDeClave } from './claves-api.js';
import { claveDeConexion, estadoDe, generarCodigoConexion, leerClaveDeConexion, normalizarCodigo, type CodigosConexionRepo } from './codigos-conexion.js';
import { permisosAceptables } from './permisos.js';
import type { ServicioPlan } from '../plan/servicio.js';
import { PLANES_ELEGIBLES } from '../plan/servicio.js';

export interface SuperRoutesDeps {
  plan?: ServicioPlan;
  codigos: CodigosConexionRepo;
  claves: ClavesApiRepo;
  config: Pick<Config, 'PUBLIC_BASE_URL'>;
  ahora?: () => Date;
  /** Canjes por IP y hora antes de frenar (por defecto 20). */
  maxCanjesPorHora?: number;
}

function soloSuper(request: FastifyRequest, reply: FastifyReply, que: string): boolean {
  if (request.usuario?.super && !request.usuario.porToken) return true;
  void reply.code(403).send({ error: `Solo un superadministrador puede ${que}.` });
  return false;
}

/** Quien hace la accion, para apuntarlo. */
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

const codigoSchema = z.object({
  para: z.string().trim().min(1).max(60),
  /** Una fecha (ISO) o cuantos dias vale desde ahora. Sin nada: 7 dias. */
  caducaAt: z.string().trim().max(40).optional(),
  dias: z.coerce.number().min(1 / 24).max(365).optional(),
  usosMax: z.coerce.number().int().min(1).max(100).default(1),
  permisos: z.array(z.string()).optional(),
});

export async function registerSuperRoutes(app: FastifyInstance, deps: SuperRoutesDeps): Promise<void> {
  const { codigos, claves } = deps;
  const ahora = deps.ahora ?? (() => new Date());
  const base = deps.config.PUBLIC_BASE_URL.replace(/\/+$/, '');
  const canjes = new Map<string, { n: number; hasta: number }>();

  const sinPlan = () => ({ origen: 'libre' as const, editable: true, local: null, plan: null, iaTurnosMes: 0, mes: '', consultadoEn: null, error: null, aviso: null });

  // ---------------------------------------------------------------- membresia

  app.get('/admin/membresia', async (request) => {
    const e = deps.plan?.estado() ?? sinPlan();
    // Un admin ve la membresia; los pagos y lo editable son cosa del superadmin.
    const local = request.usuario?.super ? e.local : e.local ? { ...e.local, pagos: [] } : null;
    return { ...e, local, planes: PLANES_ELEGIBLES, soySuper: Boolean(request.usuario?.super) };
  });

  app.post('/admin/membresia', async (request, reply) => {
    if (!soloSuper(request, reply, 'cambiar la membresía')) return;
    if (!deps.plan) return reply.code(409).send({ error: 'Este arranque no lleva membresía.' });
    const body = membresiaSchema.parse(request.body ?? {});
    try {
      const e = await deps.plan.guardarLocal({ ...body, limites: body.limites as Partial<import('../plan/servicio.js').LimitesPlan> | undefined }, quien(request));
      return { ok: true, ...e, planes: PLANES_ELEGIBLES, soySuper: true, mensaje: `Membresía ${e.plan?.nombre ?? ''} guardada: vence el ${new Date(e.plan!.vencimiento).toLocaleDateString('es-PE')}.` };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/admin/membresia/pagos', async (request, reply) => {
    if (!soloSuper(request, reply, 'apuntar pagos')) return;
    if (!deps.plan) return reply.code(409).send({ error: 'Este arranque no lleva membresía.' });
    const body = z.object({ meses: z.coerce.number().int().min(1).max(60), monto: z.coerce.number().min(0).max(10_000_000).default(0), moneda: z.string().trim().max(8).optional(), nota: z.string().trim().max(200).optional() }).parse(request.body ?? {});
    try {
      const e = await deps.plan.anotarPago(body, quien(request));
      return { ok: true, ...e, planes: PLANES_ELEGIBLES, soySuper: true, mensaje: `Pago apuntado: ${body.meses} mes${body.meses === 1 ? '' : 'es'}. Ahora vence el ${new Date(e.plan!.vencimiento).toLocaleDateString('es-PE')}.` };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete('/admin/membresia', async (request, reply) => {
    if (!soloSuper(request, reply, 'quitar la membresía')) return;
    if (!deps.plan) return reply.code(409).send({ error: 'Este arranque no lleva membresía.' });
    try {
      const e = await deps.plan.quitarLocal();
      return { ok: true, ...e, planes: PLANES_ELEGIBLES, soySuper: true };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // ------------------------------------------------------ codigos de conexion

  const conEstado = (c: import('./codigos-conexion.js').CodigoConexion) => ({ ...c, estadoReal: estadoDe(c, ahora()) });

  app.get('/admin/codigos-conexion', async () => ({ codigos: (await codigos.listar(200)).map(conEstado), miDireccion: base }));

  app.post('/admin/codigos-conexion', async (request, reply) => {
    const body = codigoSchema.parse(request.body ?? {});
    const permisos = permisosAceptables(body.permisos);
    if ('error' in permisos) return reply.code(400).send({ error: permisos.error });
    let caducaAt: Date;
    if (body.caducaAt) {
      caducaAt = new Date(body.caducaAt);
      if (Number.isNaN(caducaAt.getTime())) return reply.code(400).send({ error: 'La fecha límite no se entiende.' });
      // Una fecha sin hora vale hasta el final de ese dia.
      if (/^\d{4}-\d{2}-\d{2}$/.test(body.caducaAt)) caducaAt = new Date(`${body.caducaAt}T23:59:59`);
    } else {
      caducaAt = new Date(ahora().getTime() + (body.dias ?? 7) * 24 * 60 * 60_000);
    }
    if (caducaAt.getTime() <= ahora().getTime()) return reply.code(400).send({ error: 'La fecha límite tiene que ser futura.' });
    if (caducaAt.getTime() - ahora().getTime() > 366 * 24 * 60 * 60_000) return reply.code(400).send({ error: 'Un código no puede valer más de un año.' });
    // Por si la suerte repite un codigo, se intenta otra vez.
    for (let intento = 0; intento < 5; intento++) {
      const codigo = generarCodigoConexion();
      if (await codigos.porCodigo(codigo)) continue;
      const c = await codigos.crear({ codigo, para: body.para, permisos: permisos.permisos, caducaAt, usosMax: body.usosMax, creadoPor: quien(request) });
      return {
        ok: true,
        codigo: conEstado(c),
        miDireccion: base,
        // Una sola cosa que pegar: lleva la direccion dentro.
        claveConexion: claveDeConexion(base, c.codigo),
        pasos: [`En ${body.para}, donde pida conectarse con este WhatsApp, pega esta clave de conexión (una sola cosa: ya lleva la dirección dentro). Si te pide dirección y código por separado, son ${base} y ${c.codigo}.`, `Vale hasta el ${caducaAt.toLocaleString('es-PE')} y ${body.usosMax === 1 ? 'una sola vez' : `${body.usosMax} veces`}: al usarla, ese sistema recibe su clave de acceso y aquí aparece con quién y cuándo se usó.`, 'Si el otro sistema no sabe canjear claves de conexión, dale una clave de API a mano (más abajo).'],
      };
    }
    return reply.code(500).send({ error: 'No se pudo generar un código nuevo; inténtalo otra vez.' });
  });

  app.delete<{ Params: { id: string } }>('/admin/codigos-conexion/:id', async (request, reply) => {
    const ok = await codigos.anular(request.params.id);
    if (!ok) return reply.code(404).send({ error: 'Ese código no existe o ya no estaba activo.' });
    return { ok: true };
  });

  /**
   * El canje: sin clave, porque el codigo es la autorizacion. Tope por IP
   * para que nadie pruebe codigos a ciegas; y ni se dice si existe o no.
   */
  app.post('/api/v1/conexion/canjear', async (request, reply) => {
    const ip = request.ip || 'desconocida';
    const t = ahora().getTime();
    const cuenta = canjes.get(ip);
    if (cuenta && cuenta.hasta > t && cuenta.n >= (deps.maxCanjesPorHora ?? 20)) return reply.code(429).send({ error: 'Demasiados intentos desde esta dirección: espera una hora.' });
    canjes.set(ip, cuenta && cuenta.hasta > t ? { n: cuenta.n + 1, hasta: cuenta.hasta } : { n: 1, hasta: t + 60 * 60_000 });

    const body = z.object({ codigo: z.string().trim().min(6).max(600), sistema: z.string().trim().max(120).optional() }).parse(request.body ?? {});
    // Vale el codigo corto o la clave de conexion completa (wac_...).
    const codigoDado = leerClaveDeConexion(body.codigo)?.codigo ?? normalizarCodigo(body.codigo);
    const c = await codigos.porCodigo(codigoDado);
    if (!c || estadoDe(c, ahora()) !== 'activo') return reply.code(404).send({ error: 'Ese código no vale: no existe, ya se usó, caducó o fue anulado. Pide uno nuevo en el panel del sistema de WhatsApp.' });

    const clave = generarClaveApi();
    const registro = await claves.crear({ nombre: c.para, prefijo: prefijoDeClave(clave), hash: hashClaveApi(clave), creadaPor: null, permisos: c.permisos });
    const canjeado = await codigos.canjear(c.id, { por: (body.sistema ?? '').trim() || c.para, desde: ip, claveId: registro.id, ahora: ahora() });
    if (!canjeado) {
      // Alguien lo canjeo un instante antes: la clave que se acaba de crear no debe quedar viva.
      await claves.revocar(registro.id);
      return reply.code(409).send({ error: 'Ese código se acaba de usar. Pide uno nuevo.' });
    }
    return { ok: true, clave, direccion: base, para: c.para, permisos: c.permisos, usosRestantes: canjeado.usosMax - canjeado.usos };
  });
}
