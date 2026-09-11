/**
 * La biblioteca de stickers y su configuracion. Ver src/stickers/stickers.ts.
 *
 * `/stickers/<archivo>` es publico a proposito: la API de Meta se baja de ahi
 * el fichero para mandarlo, y un sticker no es un secreto.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ServicioAjustes } from '../ajustes/generales.js';
import { archivoValido, CONFIG_STICKERS_VACIA, ETIQUETA_USO, USOS, type ServicioStickers } from '../stickers/stickers.js';

export interface StickersRoutesDeps {
  stickers: ServicioStickers;
  ajustes?: ServicioAjustes;
}

export async function registerStickersRoutes(app: FastifyInstance, deps: StickersRoutesDeps): Promise<void> {
  const { stickers } = deps;

  app.get<{ Params: { archivo: string } }>('/stickers/:archivo', async (request, reply) => {
    if (!archivoValido(request.params.archivo)) return reply.code(404).send({ error: 'no existe' });
    const datos = await stickers.leer(request.params.archivo);
    if (!datos) return reply.code(404).send({ error: 'no existe' });
    return reply.type('image/webp').header('cache-control', 'public, max-age=31536000, immutable').send(datos);
  });

  app.get('/admin/stickers', async () => ({
    stickers: await stickers.listar(),
    configuracion: stickers.configuracion(),
    usos: USOS.map((u) => ({ id: u, etiqueta: ETIQUETA_USO[u] })),
  }));

  const subidaSchema = z.object({
    nombre: z.string().trim().min(1).max(60),
    uso: z.enum(['inicio', 'gracias', 'despedida', 'otro']).default('otro'),
    /** La imagen en base64 (con o sin el prefijo data:...). */
    datos: z.string().min(10).max(6 * 1024 * 1024),
  });

  app.post('/admin/stickers', async (request, reply) => {
    const body = subidaSchema.parse(request.body ?? {});
    try {
      const s = await stickers.subir({ nombre: body.nombre, uso: body.uso, datosBase64: body.datos });
      return { ok: true, sticker: s };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete<{ Params: { id: string } }>('/admin/stickers/:id', async (request, reply) => {
    const ok = await stickers.borrar(request.params.id);
    if (!ok) return reply.code(404).send({ error: 'Ese sticker no existe.' });
    // Si estaba puesto como automatico, deja de estarlo.
    if (deps.ajustes) {
      const cfg = { ...CONFIG_STICKERS_VACIA, ...(deps.ajustes.actual().stickers ?? {}) };
      const limpio = {
        ...cfg,
        inicio: cfg.inicio === request.params.id ? null : cfg.inicio,
        gracias: cfg.gracias === request.params.id ? null : cfg.gracias,
        despedida: cfg.despedida === request.params.id ? null : cfg.despedida,
      };
      await deps.ajustes.guardar({ stickers: limpio });
    }
    return { ok: true };
  });

  /** Que sticker sale solo en cada momento. Solo admin. */
  app.post('/admin/stickers/configuracion', async (request, reply) => {
    if (!deps.ajustes) return reply.code(404).send({ error: 'los ajustes generales no estan activos en este arranque' });
    if (request.usuario?.rol !== 'admin' || request.usuario.porToken) return reply.code(403).send({ error: 'solo un administrador cambia los stickers automáticos' });
    const body = z
      .object({
        inicio: z.string().max(40).nullable().optional(),
        inicioEnReparto: z.boolean().optional(),
        gracias: z.string().max(40).nullable().optional(),
        despedida: z.string().max(40).nullable().optional(),
      })
      .parse(request.body ?? {});
    for (const id of [body.inicio, body.gracias, body.despedida]) {
      if (id && !(await stickers.listar()).some((s) => s.id === id)) return reply.code(400).send({ error: 'Uno de los stickers elegidos ya no existe.' });
    }
    const actual = { ...CONFIG_STICKERS_VACIA, ...(deps.ajustes.actual().stickers ?? {}) };
    const guardado = await deps.ajustes.guardar({ stickers: { ...actual, ...body } });
    return { ok: true, configuracion: guardado.stickers ?? CONFIG_STICKERS_VACIA };
  });

  /** Mandar uno a mano, desde el chat. */
  app.post<{ Params: { id: string } }>('/admin/stickers/:id/enviar', async (request, reply) => {
    const body = z.object({ phone: z.string().min(6) }).parse(request.body ?? {});
    const r = await stickers.enviar(body.phone.replace(/\D+/g, ''), request.params.id, { manual: true });
    if ('error' in r) return reply.code(400).send({ error: r.error });
    return r;
  });
}
