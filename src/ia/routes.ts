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
import { ErrorIA, MODELOS_SUGERIDOS, SERVICIOS_OPENAI } from './proveedores.js';
import { DESCRIPCION_GRATIS } from './modelos-gratis.js';
import { ESCENARIOS, GRUPOS } from './escenarios.js';
import { BANCO_EXAMEN, UMBRAL_EXAMEN } from './examen-lector.js';
import { configIASchema, type ServicioIA } from './servicio.js';
import { confirmacionSchema } from './ordenes.js';

export async function registerIaRoutes(app: FastifyInstance, deps: { ia: ServicioIA; plan?: import('../plan/servicio.js').ServicioPlan }): Promise<void> {
  const { ia } = deps;

  // Lo que la IA (y las reglas) no entendieron, y el examen del lector de respuestas.
  app.get('/admin/ia/no-entendido', async (request) => {
    const q = z.object({ dias: z.coerce.number().int().min(1).max(60).default(7) }).parse(request.query ?? {});
    return ia.noEntendido({ dias: q.dias });
  });
  app.post('/admin/ia/no-entendido/corregir', async (request, reply) => {
    const body = z.object({ id: z.coerce.number().int().positive(), era: z.enum(['si', 'no', 'duda', 'minutos', 'entregado', 'no_entregado', 'ignorar']), minutos: z.coerce.number().min(1).max(600).nullable().optional(), leccion: z.boolean().optional() }).parse(request.body ?? {});
    try {
      return await ia.corregirNoEntendido(body, request.usuario?.usuario ?? null);
    } catch (e) {
      if (e instanceof ErrorIA) return reply.code(400).send({ error: e.message });
      throw e;
    }
  });
  app.get('/admin/ia/examen-lector', async () => ({ examen: await ia.examenLector(), umbral: UMBRAL_EXAMEN, total: BANCO_EXAMEN.length }));
  app.post('/admin/ia/examen-lector', async () => ({ examen: await ia.examinarLector(), umbral: UMBRAL_EXAMEN }));

  app.get('/admin/ia', async () => ({ ...(await ia.refrescarModelos()), modelosSugeridos: MODELOS_SUGERIDOS, descripcionGratis: DESCRIPCION_GRATIS, servicios: SERVICIOS_OPENAI }));

  /**
   * Cuanto se uso la IA: hoy y en los ultimos 30 dias, por tipo de llamada,
   * con tokens si el proveedor los dice, fallos y el tope de la membresia.
   * Es lo que ensena la tarjeta "Uso de la IA" de Mi asistente IA.
   */
  app.get('/admin/ia/uso', async () => {
    const uso = ia.uso();
    const plan = deps.plan?.estado() ?? null;
    const tope = plan?.plan?.limites.iaTurnosMes ?? null;
    return {
      ...uso,
      membresia: plan && plan.origen !== 'libre' && plan.plan ? { plan: plan.plan.nombre, tope, gastadas: plan.iaTurnosMes, quedan: tope == null ? null : Math.max(0, tope - plan.iaTurnosMes), mes: plan.mes } : null,
      proveedor: ia.estado().proveedor,
      servicio: ia.estado().servicio,
      modelo: ia.estado().modeloEfectivo,
      /** Con Puter no hay tokens que contar: la cuenta de Puter lleva la suya. */
      cuentaTokens: ia.estado().proveedor === 'openai',
    };
  });

  /**
   * Probar la conexion con el modelo: con lo que hay en pantalla (sin
   * guardarlo) o con lo guardado. Dice si contesta, cuanto tarda y, si no,
   * por que en cristiano.
   */
  app.post('/admin/ia/probar-conexion', async (request) => {
    const body = z
      .object({
        proveedor: z.enum(['puter', 'openai']).optional(),
        baseUrl: z.string().trim().max(300).optional(),
        token: z.string().max(500).optional(),
        modelo: z.string().trim().max(80).optional(),
      })
      .parse(request.body ?? {});
    const hayCandidata = body.proveedor !== undefined || body.baseUrl !== undefined || body.token !== undefined || body.modelo !== undefined;
    const prueba = await ia.probarConexion(hayCandidata ? body : undefined);
    return { ok: prueba.ok, prueba };
  });

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
