import type { FastifyInstance } from 'fastify';
import { leerCuerpo } from '../api/v1/entregas-gsg.js';
import { revisarTelefono } from '../rutas/telefono.js';
import { gsgCourierPage } from './gsg-courier-page.js';

export async function registerGsgCourierRoutes(app: FastifyInstance, opts: {
  nombreNegocio: () => string;
  disponible: boolean;
  demo?: boolean;
}): Promise<void> {
  app.get('/conexion-gsg', async (request, reply) => {
    if (!request.usuario || request.usuario.porToken || request.usuario.rol !== 'admin') {
      return reply.code(403).send({ error: 'Entra como administrador para conectar GSG Courier.' });
    }
    return reply.type('text/html; charset=utf-8').header('cache-control', 'no-store')
      .send(gsgCourierPage({ ...opts, nombreNegocio: opts.nombreNegocio() }));
  });

  // Validar no guarda pedidos, no crea contactos y no activa el reparto.
  app.post('/admin/gsg-courier/validar', async (request, reply) => {
    if (!request.usuario || request.usuario.porToken || request.usuario.rol !== 'admin') {
      return reply.code(403).send({ error: 'Solo un administrador puede validar pedidos de Courier.' });
    }
    if (!opts.disponible) return reply.code(409).send({ error: 'El módulo de entregas no está disponible en este servidor.' });
    const lectura = leerCuerpo(request.body);
    if ('error' in lectura) return reply.code(400).send(lectura);
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
