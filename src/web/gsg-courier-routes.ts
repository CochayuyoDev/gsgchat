import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { WebhooksRepo } from '../webhooks/repo.js';
import { DESCRIPCION_EVENTOS, NOMBRES_EVENTOS, esNombreEvento } from '../eventos/bus.js';
import { leerCuerpo } from '../api/v1/entregas-gsg.js';
import { revisarTelefono } from '../rutas/telefono.js';
import { gsgCourierPage } from './gsg-courier-page.js';
import { connectPage } from './connect-page.js';

export async function registerGsgCourierRoutes(app: FastifyInstance, opts: {
  nombreNegocio: () => string;
  disponible: boolean;
  demo?: boolean;
  /** Los webhooks que avisan a GSG: en «Nuestra API» se eligen sus eventos. */
  webhooks?: WebhooksRepo;
}): Promise<void> {
  const esAdmin = (request: FastifyRequest) => Boolean(request.usuario && !request.usuario.porToken && request.usuario.rol === 'admin');

  // «Avisos a GSG (webhooks)»: la lista con sus eventos y el catálogo para marcarlos.
  app.get('/admin/webhooks-gsg', async (request, reply) => {
    if (!esAdmin(request)) return reply.code(403).send({ error: 'Solo un administrador ve los avisos a GSG.' });
    if (!opts.webhooks) return reply.code(404).send({ error: 'Los avisos por webhook no están disponibles en este servidor.' });
    return {
      webhooks: await opts.webhooks.listar(),
      eventos: NOMBRES_EVENTOS.map((nombre) => ({ nombre, descripcion: DESCRIPCION_EVENTOS[nombre] })),
    };
  });

  // Cambia los eventos de un webhook. Vale al instante: GSG no tiene que cambiar nada.
  app.post<{ Params: { id: string } }>('/admin/webhooks-gsg/:id/eventos', async (request, reply) => {
    if (!esAdmin(request)) return reply.code(403).send({ error: 'Solo un administrador cambia los avisos a GSG.' });
    if (!opts.webhooks) return reply.code(404).send({ error: 'Los avisos por webhook no están disponibles en este servidor.' });
    const leido = z.object({ eventos: z.array(z.string()).max(50) }).safeParse(request.body ?? {});
    if (!leido.success) return reply.code(400).send({ error: 'Manda la lista de eventos marcados.' });
    const eventos = [...new Set(leido.data.eventos)];
    const desconocidos = eventos.filter((e) => e !== '*' && !esNombreEvento(e));
    if (desconocidos.length) return reply.code(400).send({ error: `Estos eventos no existen: ${desconocidos.join(', ')}.` });
    if (!eventos.length) return reply.code(400).send({ error: 'Marca al menos un evento: sin ninguno, a GSG no le llegaría nada. Si quieres pararlo, apágalo.' });
    const webhook = await opts.webhooks.actualizar(request.params.id, { eventos });
    if (!webhook) return reply.code(404).send({ error: 'Ese webhook ya no existe.' });
    return { ok: true, webhook };
  });

  // Nuestra API: el endpoint de GSGchat para GSG (direccion, claves, validar, recepciones).
  app.get('/api-gsgchat', async (request, reply) => {
    if (!request.usuario || request.usuario.porToken || request.usuario.rol !== 'admin') {
      return reply.code(403).send({ error: 'Entra como administrador para ver la API de GSGchat.' });
    }
    return reply.type('text/html; charset=utf-8').header('cache-control', 'no-store')
      .send(gsgCourierPage({ ...opts, nombreNegocio: opts.nombreNegocio() }));
  });

  // Conexión con GSG: lo que GSGchat le manda y le pregunta a GSG (su URL y su API Key).
  app.get('/conexion-gsg', async (request, reply) => {
    if (!request.usuario || request.usuario.porToken || request.usuario.rol !== 'admin') {
      return reply.code(403).send({ error: 'Entra como administrador para conectar con GSG.' });
    }
    return reply.type('text/html; charset=utf-8').header('cache-control', 'no-store')
      .send(connectPage({ labels: {}, nombreNegocio: opts.nombreNegocio(), demo: opts.demo, conGsg: opts.disponible, vista: 'gsg' }));
  });

  // Validar no guarda pedidos, no crea contactos y no activa el reparto.
  app.post('/admin/gsg-courier/validar', async (request, reply) => {
    if (!request.usuario || request.usuario.porToken || request.usuario.rol !== 'admin') {
      return reply.code(403).send({ error: 'Solo un administrador puede validar pedidos de Courier.' });
    }
    if (!opts.disponible) return reply.code(409).send({ error: 'El módulo de entregas no está disponible en este servidor.' });
    const lectura = leerCuerpo(request.body);
    if ('error' in lectura) return reply.code(400).send({ ok: false, codigo: 'VALIDACION', error: lectura.error, detalles: lectura.detalles });
    const referencias = new Set<string>();
    const repetidas: string[] = [];
    const descartadas: Array<{ referencia: string; motivo: string }> = [];
    let validos = 0;
    for (const p of lectura) {
      const ref = p.referencia.trim().toLowerCase();
      if (referencias.has(ref)) { repetidas.push(p.referencia); continue; }
      referencias.add(ref);
      const telefono = revisarTelefono(p.telefono);
      if (!telefono.ok) descartadas.push({ referencia: p.referencia, motivo: telefono.detalle });
      else validos++;
    }
    return { ok: !descartadas.length && !repetidas.length, total: lectura.length, validos, repetidas, descartadas,
      guardados: 0, detalle: 'Validación terminada. No se guardaron pedidos ni se enviaron mensajes.' };
  });
}
