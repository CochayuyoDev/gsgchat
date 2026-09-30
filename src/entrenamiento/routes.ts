/**
 * La pantalla "Entrenar a la IA" habla con esto.
 *
 *  GET    /admin/entrenamiento                      cifras, trabajos en marcha, ultimo examen, temas
 *  GET    /admin/entrenamiento/lecciones            la lista, con filtros y paginada
 *  POST   /admin/entrenamiento/lecciones            ensenar una (cualquier cuenta: es lo que se hace desde el chat)
 *  PATCH  /admin/entrenamiento/lecciones/:id        cambiarla
 *  DELETE /admin/entrenamiento/lecciones/:id        borrarla (admin)
 *  POST   /admin/entrenamiento/lecciones/lote       aprobar, descartar, activar o borrar en masa (admin)
 *  POST   /admin/entrenamiento/importar/previa      leer un fichero o un texto sin guardar: que se entendio
 *  POST   /admin/entrenamiento/importar             importar en masa (admin)
 *  POST   /admin/entrenamiento/aprender             aprender de las conversaciones reales (admin; trabajo largo)
 *  POST   /admin/entrenamiento/pulir                que la IA limpie y clasifique lo pendiente (admin; trabajo largo)
 *  POST   /admin/entrenamiento/examen               examinar en masa (admin; trabajo largo)
 *  GET    /admin/entrenamiento/trabajos             como van los trabajos
 *  POST   /admin/entrenamiento/trabajos/:tipo/cancelar
 *  GET    /admin/entrenamiento/examenes             el historico
 *  GET    /admin/entrenamiento/examenes/:id         un examen con sus preguntas (?fallos=1 solo las mal)
 *  POST   /admin/entrenamiento/probar               que lecciones elegiria para un mensaje
 *
 * Y para otros programas, con el permiso `ia:entrenar`:
 *  POST   /api/v1/ia/lecciones                      ensenar una o varias
 *  GET    /api/v1/ia/lecciones                      listar
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { quienPide } from '../envio-automatico/routes.js';
import type { FiltroLecciones } from './repo.js';
import { leccionEntradaSchema, type ServicioEntrenamiento } from './servicio.js';

export interface EntrenamientoRoutesDeps {
  entrenamiento: ServicioEntrenamiento;
}

const filtroSchema = z.object({
  estado: z.enum(['activa', 'pendiente', 'descartada']).optional(),
  tipo: z.enum(['ejemplo', 'dato', 'regla']).optional(),
  tema: z.string().trim().max(60).optional(),
  origen: z.enum(['manual', 'importado', 'chat', 'correccion', 'ia', 'api']).optional(),
  origenDetalle: z.string().trim().max(200).optional(),
  q: z.string().trim().max(200).optional(),
  examen: z.enum(['ok', 'mal']).optional(),
  ids: z.union([z.array(z.coerce.number().int().positive()), z.string()]).optional(),
});

function filtroDe(q: z.infer<typeof filtroSchema>): FiltroLecciones {
  const ids = typeof q.ids === 'string' ? q.ids.split(',').map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0) : q.ids;
  return {
    estado: q.estado,
    tipo: q.tipo,
    tema: q.tema || undefined,
    origen: q.origen,
    origenDetalle: q.origenDetalle || undefined,
    q: q.q || undefined,
    examenOk: q.examen === 'ok' ? true : q.examen === 'mal' ? false : undefined,
    ids: ids?.length ? ids : undefined,
  };
}

const importarSchema = z.object({
  texto: z.string().max(20_000_000).optional(),
  /** El fichero en base64 (xlsx, csv, txt, json). */
  base64: z.string().max(30_000_000).optional(),
  nombre: z.string().trim().max(200).optional(),
  yoSoy: z.string().trim().max(80).optional(),
  tema: z.string().trim().max(60).optional(),
  /** true = entran pendientes de revisar; false = activas desde ya. */
  revisar: z.boolean().default(false),
});

function soloAdmin(request: FastifyRequest, reply: FastifyReply, que: string): boolean {
  if (request.usuario?.rol === 'admin' && !request.usuario.porToken) return true;
  void reply.code(403).send({ error: `Solo un administrador puede ${que}.` });
  return false;
}

const LIMITE_FICHERO = 24 * 1024 * 1024;

const lecciones = (n: number) => `${n} ${n === 1 ? 'lección' : 'lecciones'}`;

export async function registerEntrenamientoRoutes(app: FastifyInstance, deps: EntrenamientoRoutesDeps): Promise<void> {
  const { entrenamiento } = deps;

  const resumen = async () => {
    const [cifras, temas, examenes] = await Promise.all([entrenamiento.cifras(), entrenamiento.temas(), entrenamiento.examenes(10)]);
    return { cifras, temas, examenes, trabajos: entrenamiento.trabajos(), cargadas: entrenamiento.cargadas() };
  };

  app.get('/admin/entrenamiento', async () => resumen());

  app.get('/admin/entrenamiento/lecciones', async (request) => {
    const q = filtroSchema.extend({ pagina: z.coerce.number().int().min(1).default(1), limite: z.coerce.number().int().min(1).max(200).default(50) }).parse(request.query ?? {});
    return entrenamiento.listar(filtroDe(q), { limite: q.limite, pagina: q.pagina });
  });

  app.post('/admin/entrenamiento/lecciones', async (request, reply) => {
    const body = leccionEntradaSchema.extend({ origen: z.enum(['manual', 'chat', 'correccion']).default('manual'), origenDetalle: z.string().trim().max(200).optional() }).parse(request.body ?? {});
    const { origen, origenDetalle, ...entrada } = body;
    try {
      const r = await entrenamiento.ensenar(entrada, { origen, origenDetalle: origenDetalle ?? null, quien: quienPide(request) });
      return { ok: true, leccion: r.leccion, nueva: r.nueva, mensaje: r.nueva ? 'El asistente ya lo sabe.' : 'Esa lección ya estaba.' };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.patch<{ Params: { id: string } }>('/admin/entrenamiento/lecciones/:id', async (request, reply) => {
    const id = Number(request.params.id);
    const body = leccionEntradaSchema.partial().parse(request.body ?? {});
    try {
      const l = await entrenamiento.cambiar(id, body, quienPide(request));
      if (!l) return reply.code(404).send({ error: 'Esa lección ya no existe.' });
      return { ok: true, leccion: l };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete<{ Params: { id: string } }>('/admin/entrenamiento/lecciones/:id', async (request, reply) => {
    if (!soloAdmin(request, reply, 'borrar lecciones')) return;
    const ok = await entrenamiento.borrar(Number(request.params.id));
    if (!ok) return reply.code(404).send({ error: 'Esa lección ya no existe.' });
    return { ok: true };
  });

  app.post('/admin/entrenamiento/lecciones/lote', async (request, reply) => {
    if (!soloAdmin(request, reply, 'cambiar lecciones en masa')) return;
    const body = filtroSchema.extend({ accion: z.enum(['aprobar', 'descartar', 'activar', 'borrar']) }).parse(request.body ?? {});
    try {
      const n = await entrenamiento.enMasa(body.accion, filtroDe(body));
      const verbo = { aprobar: 'aprobadas', descartar: 'descartadas', activar: 'activadas', borrar: 'borradas' }[body.accion];
      return { ok: true, cuantas: n, mensaje: `${lecciones(n)} ${verbo}.` };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  const entradaDe = (body: z.infer<typeof importarSchema>) => ({
    texto: body.texto,
    datos: body.base64 ? Buffer.from(body.base64, 'base64') : undefined,
    nombre: body.nombre,
    yoSoy: body.yoSoy,
    temaPorDefecto: body.tema || null,
  });

  const vistaPrevia = (lectura: ReturnType<ServicioEntrenamiento['leer']>) => ({
    formato: lectura.formato,
    total: lectura.filas.length,
    porTipo: lectura.filas.reduce<Record<string, number>>((acc, f) => ((acc[f.tipo] = (acc[f.tipo] ?? 0) + 1), acc), {}),
    muestra: lectura.filas.slice(0, 20),
    descartadas: lectura.descartadas.length,
    descartadasMuestra: lectura.descartadas.slice(0, 10),
    avisos: lectura.avisos,
    autores: lectura.autores,
    negocio: lectura.negocio,
  });

  app.post('/admin/entrenamiento/importar/previa', { bodyLimit: LIMITE_FICHERO }, async (request, reply) => {
    const body = importarSchema.parse(request.body ?? {});
    if (!body.texto?.trim() && !body.base64) return reply.code(400).send({ error: 'Pega un texto o elige un fichero.' });
    try {
      return vistaPrevia(entrenamiento.leer(entradaDe(body)));
    } catch (error) {
      return reply.code(400).send({ error: `No se pudo leer el fichero: ${error instanceof Error ? error.message : String(error)}` });
    }
  });

  app.post('/admin/entrenamiento/importar', { bodyLimit: LIMITE_FICHERO }, async (request, reply) => {
    if (!soloAdmin(request, reply, 'importar lecciones')) return;
    const body = importarSchema.parse(request.body ?? {});
    if (!body.texto?.trim() && !body.base64) return reply.code(400).send({ error: 'Pega un texto o elige un fichero.' });
    try {
      const r = await entrenamiento.importar(entradaDe(body), { origen: 'importado', origenDetalle: body.nombre || 'texto pegado', estado: body.revisar ? 'pendiente' : 'activa', quien: quienPide(request) });
      return { ok: true, ...vistaPrevia(r.lectura), nuevas: r.nuevas, repetidas: r.repetidas, mensaje: r.nuevas ? `${lecciones(r.nuevas)} nueva${r.nuevas === 1 ? '' : 's'}${r.repetidas ? ` (${r.repetidas} ya estaban)` : ''}${body.revisar ? ', pendientes de revisar' : ''}.` : r.lectura.filas.length ? 'Todas esas lecciones ya estaban.' : 'No se encontró ninguna lección en lo que mandaste.' };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/admin/entrenamiento/aprender', async (request, reply) => {
    if (!soloAdmin(request, reply, 'aprender de las conversaciones')) return;
    const body = z.object({ desde: z.string().trim().max(30).optional(), revisar: z.boolean().default(true) }).parse(request.body ?? {});
    const desde = body.desde ? new Date(body.desde) : null;
    if (desde && Number.isNaN(desde.getTime())) return reply.code(400).send({ error: 'La fecha no se entiende.' });
    try {
      return { ok: true, trabajo: entrenamiento.aprenderDeChats({ desde, revisar: body.revisar, quien: quienPide(request) }) };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/admin/entrenamiento/pulir', async (request, reply) => {
    if (!soloAdmin(request, reply, 'pulir lecciones con la IA')) return;
    const body = z.object({ limite: z.coerce.number().int().min(1).max(5000).default(500), activar: z.boolean().default(false) }).parse(request.body ?? {});
    try {
      return { ok: true, trabajo: entrenamiento.pulir({ limite: body.limite, activar: body.activar, quien: quienPide(request) }) };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return reply.code(/Puter|clave/.test(msg) ? 400 : 409).send({ error: msg, ir: /Puter|clave/.test(msg) ? '/panel#ia' : undefined });
    }
  });

  app.post('/admin/entrenamiento/examen', async (request, reply) => {
    if (!soloAdmin(request, reply, 'lanzar un examen')) return;
    const body = z
      .object({
        tema: z.string().trim().max(60).optional(),
        origen: z.enum(['manual', 'importado', 'chat', 'correccion', 'ia', 'api']).optional(),
        muestra: z.coerce.number().int().min(1).max(5000).optional(),
        soloFallidas: z.boolean().default(false),
        ids: z.array(z.coerce.number().int().positive()).max(5000).optional(),
      })
      .parse(request.body ?? {});
    try {
      return { ok: true, trabajo: await entrenamiento.examinar({ tema: body.tema || undefined, origen: body.origen, muestra: body.muestra, soloFallidas: body.soloFallidas, ids: body.ids, quien: quienPide(request) }) };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return reply.code(/Puter|clave/.test(msg) ? 400 : /No hay lecciones/.test(msg) ? 404 : 409).send({ error: msg, ir: /Puter|clave/.test(msg) ? '/panel#ia' : undefined });
    }
  });

  app.get('/admin/entrenamiento/trabajos', async () => ({ trabajos: entrenamiento.trabajos() }));

  app.post<{ Params: { tipo: string } }>('/admin/entrenamiento/trabajos/:tipo/cancelar', async (request, reply) => {
    if (!soloAdmin(request, reply, 'cancelar trabajos')) return;
    const tipo = request.params.tipo;
    if (tipo !== 'aprender' && tipo !== 'pulir' && tipo !== 'examen') return reply.code(404).send({ error: 'No hay un trabajo así.' });
    return { ok: entrenamiento.cancelar(tipo) };
  });

  app.get('/admin/entrenamiento/examenes', async () => ({ examenes: await entrenamiento.examenes(50) }));

  app.get<{ Params: { id: string } }>('/admin/entrenamiento/examenes/:id', async (request, reply) => {
    const q = z.object({ fallos: z.coerce.number().int().optional() }).parse(request.query ?? {});
    const r = await entrenamiento.examen(Number(request.params.id));
    if (!r) return reply.code(404).send({ error: 'Ese examen no existe.' });
    return { examen: r.examen, casos: q.fallos ? r.casos.filter((c) => !c.ok) : r.casos };
  });

  app.post('/admin/entrenamiento/probar', async (request) => {
    const body = z.object({ texto: z.string().trim().min(1).max(2000), anterior: z.string().trim().max(2000).optional() }).parse(request.body ?? {});
    const l = entrenamiento.relevantes(body.texto, body.anterior);
    return { reglas: l.reglas, datos: l.datos, ejemplos: l.ejemplos, prompt: entrenamiento.textoParaPrompt(l) };
  });

  // ---------------------------------------------------------------- API v1

  const leccionApiSchema = leccionEntradaSchema.omit({ estado: true, nota: true });

  app.post('/api/v1/ia/lecciones', { config: { permiso: 'ia:entrenar' } }, async (request, reply) => {
    const body = z.union([leccionApiSchema, z.object({ lecciones: z.array(leccionApiSchema).min(1).max(5000), revisar: z.boolean().default(false) })]).parse(request.body ?? {});
    const quien = quienPide(request);
    try {
      if ('lecciones' in body) {
        const r = await entrenamiento.ensenarVarias(
          body.lecciones.map((l) => ({ tipo: l.tipo, pregunta: l.pregunta ?? null, respuesta: l.respuesta, tema: l.tema ?? null, mala: l.mala ?? null })),
          { origen: 'api', origenDetalle: quien, estado: body.revisar ? 'pendiente' : 'activa', quien },
        );
        return { ok: true, nuevas: r.nuevas, repetidas: r.repetidas, ids: r.ids };
      }
      const r = await entrenamiento.ensenar(body, { origen: 'api', origenDetalle: quien, quien });
      return { ok: true, leccion: r.leccion, nueva: r.nueva };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/v1/ia/lecciones', { config: { permiso: 'ia:entrenar' } }, async (request) => {
    const q = filtroSchema.extend({ pagina: z.coerce.number().int().min(1).default(1), limite: z.coerce.number().int().min(1).max(200).default(50) }).parse(request.query ?? {});
    return entrenamiento.listar(filtroDe(q), { limite: q.limite, pagina: q.pagina });
  });
}
