/**
 * Lo que la pantalla de Ajustes usa para el resumen del dia:
 *
 *  GET  /admin/resumenes               como esta (horas, si esta encendido, cuando salio cada uno, que toca)
 *  POST /admin/resumenes/vista-previa  { franja } el texto que saldria ahora (con IA si hay)
 *  POST /admin/resumenes/mandar        { franja } mandarlo al supervisor ya (aunque hoy ya saliera)
 *
 * Las horas y el interruptor se guardan con el resto de ajustes generales
 * (POST /admin/ajustes, rama `resumenes`).
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ServicioResumenes } from './servicio.js';

const franjaSchema = z.object({ franja: z.enum(['manana', 'tarde']) });

export async function registerResumenesRoutes(app: FastifyInstance, deps: { resumenes: ServicioResumenes }): Promise<void> {
  const { resumenes } = deps;

  app.get('/admin/resumenes', async () => resumenes.estado());

  app.post('/admin/resumenes/vista-previa', async (request) => {
    const { franja } = franjaSchema.parse(request.body ?? {});
    const r = await resumenes.redactar(franja);
    return { ok: true, franja, texto: r.texto, conIA: r.conIA, textoFijo: r.textoFijo, cifras: r.cifras };
  });

  app.post('/admin/resumenes/mandar', async (request, reply) => {
    const { franja } = franjaSchema.parse(request.body ?? {});
    const quien = request.usuario?.nombre || request.usuario?.usuario || 'panel';
    const r = await resumenes.mandar(franja, { quien, forzar: true });
    if (!r.ok) return reply.code(409).send({ error: r.motivo ?? 'No salió.', texto: r.texto ?? null });
    return { ok: true, franja, texto: r.texto, conIA: r.conIA, estado: resumenes.estado() };
  });
}
