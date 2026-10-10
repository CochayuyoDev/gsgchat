/**
 * La pantalla "Que todo funcione" (/fiabilidad) habla con esto.
 *
 *  GET  /admin/fiabilidad                         todo: vigilante, pruebas de la manana, cupo, copia, ajustes
 *  POST /admin/fiabilidad/ajustes                 (solo admin) minutos, correo, clave de Brevo, horas, carpeta
 *  POST /admin/fiabilidad/correo/probar           (solo admin) manda un correo de prueba
 *  POST /admin/fiabilidad/vigilante/mirar         una vuelta del vigilante ahora mismo
 *  POST /admin/fiabilidad/vigilante/simular       (solo demo) { caido: true|false|null }
 *  POST /admin/fiabilidad/humo/probar             "Probar ahora": la pasada entera, sin avisar a nadie
 *  GET  /admin/fiabilidad/cupo                    el cupo previsto de hoy
 *  POST /admin/fiabilidad/copia/ahora             (solo admin) "Hacer copia ahora"
 *  POST /admin/fiabilidad/copia/carpeta           (solo admin) { carpeta } comprueba que se puede escribir
 *  GET  /admin/fiabilidad/copia/descargar/:nombre  baja una copia
 */

import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { z } from 'zod';
import type { ServicioFiabilidad } from './fiabilidad.js';

export interface FiabilidadRoutesDeps {
  fiabilidad: ServicioFiabilidad;
}

const quienEs = (u: { nombre?: string; usuario?: string } | null | undefined): string => u?.nombre || u?.usuario || 'alguien del panel';

const patchSchema = z.object({
  vigilante: z
    .object({
      minutosAntesDeAvisar: z.coerce.number().int().min(1).max(120).optional(),
      correoAviso: z.string().trim().max(200).optional(),
      remitente: z.string().trim().max(200).optional(),
      nombreRemitente: z.string().trim().max(80).optional(),
      avisarAlVolver: z.boolean().optional(),
    })
    .optional(),
  humo: z.object({ activo: z.boolean().optional(), hora: z.string().trim().optional() }).optional(),
  copia: z
    .object({
      activa: z.boolean().optional(),
      hora: z.string().trim().optional(),
      carpeta: z.string().trim().max(400).optional(),
      conservar: z.coerce.number().int().min(2).max(90).optional(),
    })
    .optional(),
  claveBrevo: z.string().trim().max(300).nullable().optional(),
});

export async function registerFiabilidadRoutes(app: FastifyInstance, deps: FiabilidadRoutesDeps): Promise<void> {
  const { fiabilidad } = deps;
  const soloAdmin = (request: { usuario?: { rol?: string; porToken?: boolean } | null }) => request.usuario?.rol === 'admin' && !request.usuario.porToken;

  app.get('/admin/fiabilidad', async () => fiabilidad.estado());

  app.post('/admin/fiabilidad/ajustes', async (request, reply) => {
    if (!soloAdmin(request)) return reply.code(403).send({ error: 'Solo un administrador cambia estos ajustes.' });
    const body = patchSchema.parse(request.body ?? {});
    const ajustes = await fiabilidad.almacen.guardar(body);
    return { ok: true, ajustes, brevo: { configurada: fiabilidad.almacen.tieneClaveBrevo() } };
  });

  app.post('/admin/fiabilidad/correo/probar', async (request, reply) => {
    if (!soloAdmin(request)) return reply.code(403).send({ error: 'Solo un administrador prueba el correo de aviso.' });
    const r = await fiabilidad.correo.probar();
    if (!r.ok) return reply.code(400).send({ error: r.detalle, resultado: r });
    return { ok: true, resultado: r };
  });

  app.post('/admin/fiabilidad/vigilante/mirar', async () => {
    await fiabilidad.vigilante.tick();
    return { ok: true, vigilante: fiabilidad.vigilante.estado() };
  });

  app.post('/admin/fiabilidad/humo/probar', async (request) => {
    const resultado = await fiabilidad.humo.correr({ quien: quienEs(request.usuario), avisar: false });
    return { ok: true, resultado };
  });

  app.get('/admin/fiabilidad/cupo', async () => fiabilidad.cupo());

  app.post('/admin/fiabilidad/copia/ahora', async (request, reply) => {
    if (!soloAdmin(request)) return reply.code(403).send({ error: 'Solo un administrador hace la copia.' });
    // Si la copia tarda (carpeta de red, muchos respaldos), la pantalla no se
    // queda colgada: a los 25 s se contesta que sigue en marcha y el estado de
    // arriba la recoge cuando termine.
    const copia = fiabilidad.respaldo.hacerCopia(quienEs(request.usuario));
    const resultado = await Promise.race([copia, new Promise<null>((r) => setTimeout(() => r(null), 25_000).unref?.())]);
    if (resultado === null) return reply.code(202).send({ ok: true, enMarcha: true, detalle: 'La copia sigue haciéndose (tarda más de lo normal). El estado de arriba se actualizará solo cuando termine.' });
    if (!resultado.ok) return reply.code(400).send({ error: resultado.error, resultado });
    return { ok: true, resultado };
  });

  app.post('/admin/fiabilidad/copia/carpeta', async (request, reply) => {
    if (!soloAdmin(request)) return reply.code(403).send({ error: 'Solo un administrador cambia la carpeta de las copias.' });
    const body = z.object({ carpeta: z.string().trim().max(400).default('') }).parse(request.body ?? {});
    const r = await fiabilidad.respaldo.comprobarCarpeta(body.carpeta);
    if (!r.ok) return reply.code(400).send({ error: r.detalle, carpeta: r.carpeta });
    return { ok: true, detalle: r.detalle, carpeta: r.carpeta };
  });

  app.get<{ Params: { nombre: string } }>('/admin/fiabilidad/copia/descargar/:nombre', async (request, reply) => {
    const r = await fiabilidad.respaldo.ficheroDeCopia(request.params.nombre);
    if (!r.ok) return reply.code(404).send({ error: r.error });
    return reply
      .type(request.params.nombre.endsWith('.dump') ? 'application/octet-stream' : 'application/gzip')
      .header('content-length', String(r.bytes))
      .header('content-disposition', `attachment; filename="${request.params.nombre}"`)
      .send(createReadStream(r.ruta));
  });
}
