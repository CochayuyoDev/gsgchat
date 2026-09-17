/**
 * La pantalla "Mi asistente IA" habla con esto.
 *
 *  GET  /admin/ia          la configuracion (sin el token; solo si hay uno)
 *  POST /admin/ia          guardar (solo admin); `token` se guarda cifrado, `token: ""` lo quita
 *  POST /admin/ia/probar   una conversacion de prueba desde el navegador, sin WhatsApp
 *
 * La IA operadora (ver ordenes.ts), para cualquier cuenta del panel:
 *  POST /admin/ia/ordenes            una orden con palabras; ejecuta y devuelve lo hecho y lo pendiente
 *  POST /admin/ia/ordenes/confirmar  las acciones pendientes que la persona confirmo
 *  GET  /admin/ia/ordenes/catalogo   que se le puede pedir
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ErrorIA, MODELOS_SUGERIDOS } from './proveedores.js';
import { DESCRIPCION_GRATIS } from './modelos-gratis.js';
import { ESCENARIOS, GRUPOS } from './escenarios.js';
import { configIASchema, type ServicioIA } from './servicio.js';
import { confirmacionSchema } from './ordenes.js';

export async function registerIaRoutes(app: FastifyInstance, deps: { ia: ServicioIA }): Promise<void> {
  const { ia } = deps;

  app.get('/admin/ia', async () => ({ ...(await ia.refrescarModelos()), modelosSugeridos: MODELOS_SUGERIDOS, descripcionGratis: DESCRIPCION_GRATIS }));

  app.post('/admin/ia', async (request, reply) => {
    if (request.usuario?.rol !== 'admin' || request.usuario.porToken) {
      return reply.code(403).send({ error: 'solo un administrador configura el asistente' });
    }
    const body = configIASchema.partial().extend({ token: z.string().max(500).nullable().optional() }).parse(request.body ?? {});
    const estado = await ia.guardar(body);
    if (estado.activa && !estado.tieneToken) {
      return reply.code(400).send({ error: 'Para activar el asistente hace falta el token de Puter (o la clave de la API elegida).', estado });
    }
    return { ok: true, estado };
  });

  /** Si la URL del catalogo responde: cuantos productos y un ejemplo. */
  app.post('/admin/ia/catalogo/probar', async (request) => {
    const body = z.object({ catalogoUrl: z.string().trim().max(500).optional(), catalogoFormato: z.enum(['auto', 'elysian', 'simple', 'woocommerce']).optional() }).parse(request.body ?? {});
    // Se prueba lo que hay en pantalla, sin guardarlo todavia.
    if (body.catalogoUrl !== undefined) {
      const { crearCatalogoTienda } = await import('../catalogo/tienda.js');
      if (!body.catalogoUrl) return { ok: false, total: 0, detalle: 'sin URL' };
      const cat = crearCatalogoTienda({ url: body.catalogoUrl, formato: body.catalogoFormato ?? 'auto' });
      const r = await cat.precargar();
      const primero = (await cat.productosTienda().catch(() => []))[0];
      return { ...r, ejemplo: primero ? `${primero.name}: ${primero.price ?? 'sin precio'} (stock ${primero.stock})${primero.url ? ' · ' + primero.url : ''}` : null };
    }
    return ia.probarCatalogo();
  });

  /** El banco de escenarios, para la pantalla: grupos y casos. */
  app.get('/admin/ia/escenarios', async () => ({ grupos: GRUPOS, escenarios: ESCENARIOS.map((e) => ({ clave: e.clave, grupo: e.grupo, mensajes: e.mensajes, espera: e.espera })) }));

  /** El examen con el modelo real. Un grupo por llamada: tarda un turno por caso. */
  app.post('/admin/ia/escenarios', async (request, reply) => {
    const body = z.object({ grupo: z.string().max(30).optional(), claves: z.array(z.string()).max(100).optional(), limite: z.coerce.number().int().positive().max(200).optional() }).parse(request.body ?? {});
    if (!ia.estado().tieneToken) return reply.code(400).send({ error: 'Conecta Puter (o la clave de la API) antes de correr los escenarios.' });
    const grupo = body.grupo && body.grupo in GRUPOS ? (body.grupo as keyof typeof GRUPOS) : undefined;
    return ia.simularEscenarios({ grupo, claves: body.claves, limite: body.limite });
  });

  /** El ayudante del panel: para cualquier cuenta, con el manual del sistema. */
  app.post('/admin/ia/ayuda', async (request, reply) => {
    const body = z
      .object({
        texto: z.string().trim().min(1).max(2000),
        historial: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })).max(20).default([]),
      })
      .parse(request.body ?? {});
    if (!ia.estado().tieneToken) return reply.code(400).send({ error: 'El ayudante usa la misma IA que el asistente: conecta Puter en Mi asistente IA (/panel#ia).' });
    try {
      return await ia.ayuda(body.historial, body.texto);
    } catch (error) {
      if (error instanceof ErrorIA) return reply.code(502).send({ error: `La IA no respondió: ${error.message}${error.detalle ? ` (${error.detalle})` : ''}` });
      throw error;
    }
  });

  const ordenSchema = z.object({
    texto: z.string().trim().min(1).max(4000),
    historial: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(6000) })).max(24).default([]),
    simular: z.boolean().default(false),
  });

  /** La IA operadora: una orden con palabras, con la identidad de quien la da. */
  app.post('/admin/ia/ordenes', async (request, reply) => {
    const body = ordenSchema.parse(request.body ?? {});
    if (!request.usuario) return reply.code(401).send({ error: 'Entra para dar órdenes.' });
    if (!ia.estado().tieneToken) return reply.code(400).send({ error: 'La IA operadora usa la misma IA que el asistente: conecta Puter en Mi asistente IA (/panel#ia).' });
    try {
      return await ia.ordenar(body, request.usuario);
    } catch (error) {
      if (error instanceof ErrorIA) return reply.code(error.detalle === 'operador' && /Demasiadas/.test(error.message) ? 429 : 502).send({ error: error.detalle === 'operador' ? error.message : `La IA no respondió: ${error.message}${error.detalle ? ` (${error.detalle})` : ''}` });
      throw error;
    }
  });

  app.post('/admin/ia/ordenes/confirmar', async (request, reply) => {
    const body = confirmacionSchema.parse(request.body ?? {});
    if (!request.usuario) return reply.code(401).send({ error: 'Entra para confirmar.' });
    try {
      return { hechas: await ia.ejecutarConfirmadas(body.acciones, request.usuario) };
    } catch (error) {
      if (error instanceof ErrorIA) return reply.code(502).send({ error: error.message });
      throw error;
    }
  });

  app.get('/admin/ia/ordenes/catalogo', async () => ({ acciones: ia.catalogoOperador() }));

  app.post('/admin/ia/probar', async (request, reply) => {
    const body = z
      .object({
        texto: z.string().trim().min(1).max(2000),
        historial: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })).max(40).default([]),
      })
      .parse(request.body ?? {});
    if (!ia.estado().tieneToken) return reply.code(400).send({ error: 'Guarda primero el token de Puter (o la clave de la API).' });
    try {
      return await ia.probar(body.historial, body.texto);
    } catch (error) {
      if (error instanceof ErrorIA) return reply.code(502).send({ error: `El modelo no respondió: ${error.message}${error.detalle ? ` (${error.detalle})` : ''}` });
      throw error;
    }
  });
}
