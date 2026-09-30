/**
 * La voz del asistente, desde la pantalla (Mi asistente IA → Voz).
 *
 *  GET  /admin/voz            cómo está (sin la clave), modelos, cuenta
 *  POST /admin/voz            guardar: clave (cifrada), voz, modelo, cuándo, transcribir... (admin)
 *  POST /admin/voz/probar     comprobar la clave guardada o una pegada: plan y caracteres
 *  GET  /admin/voz/voces      las voces de la cuenta de ElevenLabs
 *  POST /admin/voz/muestra    un audio corto para escuchar la voz aquí (no sale por WhatsApp)
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ServicioVoz } from './servicio.js';

export interface VozRoutesDeps {
  voz: ServicioVoz;
}

function soloAdmin(request: FastifyRequest, reply: FastifyReply, que: string): boolean {
  if (request.usuario?.rol === 'admin' && !request.usuario.porToken) return true;
  void reply.code(403).send({ error: `Solo un administrador puede ${que}.` });
  return false;
}

const guardarSchema = z.object({
  clave: z.string().trim().max(300).nullable().optional(),
  activa: z.boolean().optional(),
  vozId: z.string().trim().max(120).optional(),
  vozNombre: z.string().trim().max(120).optional(),
  modelo: z.string().trim().max(60).optional(),
  cuando: z.enum(['nunca', 'si-manda-audio', 'siempre']).optional(),
  transcribir: z.boolean().optional(),
  maxCaracteres: z.coerce.number().int().min(50).max(5000).optional(),
  idioma: z.string().trim().min(2).max(5).optional(),
});

export async function registerVozRoutes(app: FastifyInstance, deps: VozRoutesDeps): Promise<void> {
  const { voz } = deps;
  const con400 = async (reply: FastifyReply, fn: () => Promise<unknown>) => {
    try {
      return await fn();
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  };

  app.get('/admin/voz', async () => voz.estado());

  app.post('/admin/voz', async (request, reply) => {
    if (!soloAdmin(request, reply, 'cambiar la voz del asistente')) return;
    const body = guardarSchema.parse(request.body ?? {});
    return con400(reply, async () => {
      const e = await voz.guardar(body);
      return { ok: true, estado: e, mensaje: e.lista ? `Voz guardada: el asistente ${e.cuando === 'siempre' ? 'contesta siempre con audio' : e.cuando === 'si-manda-audio' ? 'contesta con audio cuando el cliente manda un audio' : 'solo manda audio cuando otro sistema lo pide'}.` : `Guardado. ${e.motivo ?? ''}`.trim() };
    });
  });

  app.post('/admin/voz/probar', async (request, reply) => {
    if (!soloAdmin(request, reply, 'probar la clave de ElevenLabs')) return;
    const body = z.object({ clave: z.string().trim().max(300).optional() }).parse(request.body ?? {});
    return voz.probar(body.clave);
  });

  app.get('/admin/voz/voces', async (request, reply) => {
    return con400(reply, async () => ({ voces: await voz.voces() }));
  });

  app.post('/admin/voz/muestra', async (request, reply) => {
    if (!soloAdmin(request, reply, 'probar la voz')) return;
    const body = z.object({ texto: z.string().trim().max(300).optional(), vozId: z.string().trim().max(120).optional(), modelo: z.string().trim().max(60).optional() }).parse(request.body ?? {});
    return con400(reply, async () => {
      const nota = await voz.muestra(body);
      return { ok: true, mimeType: nota.mimeType, formato: nota.formato, audioBase64: nota.datos.toString('base64'), bytes: nota.datos.length };
    });
  });
}
