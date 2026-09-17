/**
 * La pantalla "Envio automatico" habla con esto.
 *
 *  GET    /admin/envio-automatico                 todo: numeros, cifras, ajustes, movimientos
 *  POST   /admin/envio-automatico                 poner uno o varios numeros
 *  POST   /admin/envio-automatico/:clave/pausar   `e:<id>` (entrada) o `s:<id>` (solicitud del reparto)
 *  POST   /admin/envio-automatico/:clave/reanudar
 *  POST   /admin/envio-automatico/:clave/editar
 *  DELETE /admin/envio-automatico/:clave          quitarlo (una solicitud del reparto pasa a una persona)
 *  POST   /admin/envio-automatico/ajustes         cada cuantas horas, maximo, horario
 *
 * Quien lo hace queda apuntado en cada movimiento (y en la bitacora, como
 * todo POST/DELETE que acaba bien).
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Repos } from '../db/repos.js';
import { payloadIncidencia } from '../rutas/gsg.js';
import type { ServicioEnvioAutomatico } from './servicio.js';

export interface EnvioAutomaticoRoutesDeps {
  repos: Repos;
  lista: ServicioEnvioAutomatico;
}

const queSchema = z.enum(['ubicacion', 'mensaje']);
const hastaSchema = z.enum(['ubicacion', 'respuesta', 'envios']);

export const altaSchema = z.object({
  /** Uno o varios: "51987654321", "987 654 321, 912345678" o uno por linea. */
  telefonos: z.string().trim().min(1).max(20_000),
  nombre: z.string().trim().max(120).optional(),
  que: queSchema.default('ubicacion'),
  texto: z.string().trim().max(1000).optional(),
  hasta: hastaSchema.optional(),
  referencia: z.string().trim().max(120).optional(),
  maxEnvios: z.coerce.number().int().min(1).max(10).nullable().optional(),
});

export const ajustesListaSchema = z.object({
  cadaHoras: z.coerce.number().min(0.25).max(48).optional(),
  maxEnvios: z.coerce.number().int().min(1).max(10).optional(),
  horaInicio: z.coerce.number().int().min(0).max(23).optional(),
  horaFin: z.coerce.number().int().min(1).max(24).optional(),
});

/** "987 654 321, 51912345678\n999888777" -> tres telefonos. */
export function partirTelefonos(texto: string): string[] {
  return texto
    .split(/[\n,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Quien hace la accion, para apuntarlo. */
export function quienPide(request: FastifyRequest): string {
  const u = request.usuario;
  if (!u) return 'alguien';
  if (u.porToken) return `clave de API "${u.nombre ?? u.usuario}"`;
  return u.nombre ? `${u.nombre} (${u.usuario})` : u.usuario;
}

export async function registerEnvioAutomaticoRoutes(app: FastifyInstance, deps: EnvioAutomaticoRoutesDeps): Promise<void> {
  const { repos, lista } = deps;

  app.get('/admin/envio-automatico', async () => lista.resumen());

  app.post('/admin/envio-automatico', async (request, reply) => {
    const body = altaSchema.parse(request.body ?? {});
    const telefonos = partirTelefonos(body.telefonos);
    if (!telefonos.length) return reply.code(400).send({ error: 'Escribe al menos un número.' });
    if (telefonos.length > 500) return reply.code(400).send({ error: 'Como mucho 500 números de una vez.' });
    if (body.que === 'mensaje' && !body.texto?.trim()) return reply.code(400).send({ error: 'Para mandarles un mensaje hay que escribir cuál.' });

    const origen = request.usuario?.porToken ? 'api' : 'manual';
    const detalle = quienPide(request);
    const puestos: Array<{ telefono: string; phone: string; nombre: string | null; nueva: boolean }> = [];
    const rechazados: Array<{ telefono: string; motivo: string }> = [];
    for (const telefono of telefonos) {
      const r = await lista.agregar({
        telefono,
        nombre: telefonos.length === 1 ? body.nombre : undefined,
        que: body.que,
        texto: body.texto,
        hasta: body.hasta,
        referencia: body.referencia,
        maxEnvios: body.maxEnvios ?? undefined,
        origen,
        origenDetalle: detalle,
      });
      if (r.ok) puestos.push({ telefono, phone: r.entrada.phone, nombre: r.entrada.nombre, nueva: r.nueva });
      else rechazados.push({ telefono, motivo: r.motivo });
    }
    if (!puestos.length && rechazados.length === 1) return reply.code(400).send({ error: rechazados[0]!.motivo, rechazados });
    return { ok: true, puestos, rechazados };
  });

  /** Una solicitud del reparto que se quita de la lista pasa a una persona: la entrega sigue existiendo. */
  async function derivarSolicitud(id: number, quien: string): Promise<boolean> {
    const solicitud = await repos.rutas.solicitud(id);
    if (!solicitud) return false;
    const actualizada = await repos.rutas.actualizarSolicitud(solicitud.id, {
      estado: 'derivado',
      requiereHumano: true,
      incidencia: solicitud.incidencia ?? (solicitud.primeraRespuestaAt ? 'respondio_sin_ubicacion' : 'sin_respuesta'),
      incidenciaDetalle: `quitado de la lista de envío automático por ${quien}`,
      proximoIntentoAt: null,
    });
    await repos.rutas.registrarEvento(solicitud.id, 'derivacion', `quitado de la lista de envío automático por ${quien}: pasa a una persona`);
    const lote = await repos.rutas.lote(solicitud.loteId);
    if (lote) await repos.rutas.encolarReporte({ solicitudId: solicitud.id, loteId: lote.id, tipo: 'incidencia', payload: payloadIncidencia(actualizada, lote) });
    return true;
  }

  const clave = (raw: string): { tipo: 'e' | 's'; id: number } | null => {
    const m = /^([es]):(\d+)$/.exec(raw);
    if (!m) return null;
    return { tipo: m[1] as 'e' | 's', id: Number(m[2]) };
  };

  app.delete<{ Params: { clave: string } }>('/admin/envio-automatico/:clave', async (request, reply) => {
    const k = clave(request.params.clave);
    if (!k) return reply.code(404).send({ error: 'Ese número ya no está en la lista.' });
    const quien = quienPide(request);
    if (k.tipo === 's') {
      const ok = await derivarSolicitud(k.id, quien);
      if (!ok) return reply.code(404).send({ error: 'Ese cliente ya no está en el reparto.' });
      return { ok: true, pasoAPersona: true };
    }
    const quitada = await lista.quitar(k.id, { origen: request.usuario?.porToken ? 'api' : 'manual', detalle: quien }, `lo quitó ${quien}`);
    if (!quitada) return reply.code(404).send({ error: 'Ese número ya no está en la lista.' });
    return { ok: true, entrada: quitada };
  });

  app.post<{ Params: { clave: string } }>('/admin/envio-automatico/:clave/pausar', async (request, reply) => {
    const k = clave(request.params.clave);
    if (!k) return reply.code(404).send({ error: 'Ese número ya no está en la lista.' });
    if (k.tipo === 's') {
      const solicitud = await repos.rutas.solicitud(k.id);
      if (!solicitud) return reply.code(404).send({ error: 'Ese cliente ya no está en el reparto.' });
      // Una solicitud suelta no se pausa: se pausa su lote entero, y eso se
      // hace desde la pantalla del reparto. Se le dice donde.
      return reply.code(409).send({ error: 'Los clientes del reparto se pausan por lote, desde Ubicaciones para reparto.', ir: `/rutas` });
    }
    const e = await lista.pausar(k.id, { origen: request.usuario?.porToken ? 'api' : 'manual', detalle: quienPide(request) });
    if (!e) return reply.code(404).send({ error: 'Ese número ya no está en la lista.' });
    return { ok: true, entrada: e };
  });

  app.post<{ Params: { clave: string } }>('/admin/envio-automatico/:clave/reanudar', async (request, reply) => {
    const k = clave(request.params.clave);
    if (!k || k.tipo === 's') return reply.code(404).send({ error: 'Ese número ya no está en la lista.' });
    const e = await lista.reanudar(k.id, { origen: request.usuario?.porToken ? 'api' : 'manual', detalle: quienPide(request) });
    if (!e) return reply.code(404).send({ error: 'Ese número ya no está en la lista.' });
    return { ok: true, entrada: e };
  });

  app.post<{ Params: { clave: string } }>('/admin/envio-automatico/:clave/editar', async (request, reply) => {
    const k = clave(request.params.clave);
    if (!k || k.tipo === 's') return reply.code(404).send({ error: 'Los datos de un cliente del reparto se corrigen desde Ubicaciones para reparto.' });
    const body = z
      .object({
        nombre: z.string().trim().max(120).nullable().optional(),
        que: queSchema.optional(),
        texto: z.string().trim().max(1000).nullable().optional(),
        hasta: hastaSchema.optional(),
        referencia: z.string().trim().max(120).nullable().optional(),
        maxEnvios: z.coerce.number().int().min(1).max(10).nullable().optional(),
      })
      .parse(request.body ?? {});
    try {
      const e = await lista.editar(k.id, body);
      if (!e) return reply.code(404).send({ error: 'Ese número ya no está en la lista.' });
      return { ok: true, entrada: e };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/admin/envio-automatico/ajustes', async (request, reply) => {
    const body = ajustesListaSchema.parse(request.body ?? {});
    if (body.horaInicio !== undefined && body.horaFin !== undefined && body.horaFin <= body.horaInicio) {
      return reply.code(400).send({ error: 'La hora de fin tiene que ser mayor que la de inicio.' });
    }
    return { ok: true, ajustes: await lista.guardarAjustes(body) };
  });
}
