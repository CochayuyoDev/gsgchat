/**
 * Las rutas de los procesos: las pantallas, lo que ellas piden (/admin) y la
 * puerta para otros sistemas (/api/v1).
 *
 *  Pantallas: /procesos (lista y plantillas), /procesos/editor?id=,
 *             /procesos/corrida?id=, /personas, /respuestas.
 *  Panel:     /admin/procesos/... (con sesion; crear y editar, solo un administrador).
 *  API:       GET  /api/v1/procesos                     (procesos:gestionar)
 *             POST /api/v1/procesos/:id/personas        (procesos:gestionar)
 *             GET  /api/v1/procesos/corridas/:id        (procesos:gestionar)
 *
 * Todo lo que sale hacia la pantalla va en palabras: el estado con su nombre,
 * la respuesta ya legible, y cada bloqueo con lo que pasa y a donde ir.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { ESTADOS_PERSONA, ESTADOS_PERSONA_VISUALES, NOMBRE_TIPO_DATO, NOMBRE_TIPO_PASO, VARIABLES_BASE, type EstadoPersona, type PersonaProceso, type Proceso } from './modelo.js';
import { ErrorProcesos, describirPasos, type ServicioProcesos } from './servicio.js';
import { procesosPage } from './pagina-lista.js';
import { editorPage } from './pagina-editor.js';
import { personasPage } from './pagina-personas.js';
import { respuestasPage } from './pagina-respuestas.js';

export interface DepsRutasProcesos {
  procesos: ServicioProcesos;
  config: Config;
  nombreNegocio: () => string;
}

const horaLegible = (iso: string | null | undefined, tz: string): string => {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('es-PE', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
  } catch {
    return '';
  }
};

/** Una respuesta como la leeria una persona. */
export function respuestaLegible(proceso: Proceso, pasoId: string, valor: string, extra: Record<string, string | number | null> | undefined, tz: string): { texto: string; enlace?: string; enlaceTexto?: string } {
  const paso = proceso.pasos.find((p) => p.id === pasoId);
  if (paso?.tipo === 'confirmar') {
    if (valor === 'si') return { texto: 'Sí' };
    if (valor === 'no') return { texto: 'No' };
    if (valor === 'reprogramar') return { texto: 'Quiere reprogramar' };
    if (valor === 'reprogramada') return { texto: `Reprogramó: ${extra?.nuevaFecha ?? ''}`.trim() };
  }
  if (paso?.tipo === 'avance') {
    if (valor === 'llego') return { texto: `Llegó ${horaLegible(String(extra?.llego ?? ''), tz)}`.trim() };
    if (valor === 'termino') return { texto: `Terminó ${horaLegible(String(extra?.termino ?? ''), tz)}${extra?.llego ? ` (llegó ${horaLegible(String(extra.llego), tz)})` : ''}`.trim() };
    if (valor === 'no_pudo') return { texto: 'No pudo' };
  }
  if (paso?.dato === 'ubicacion' && extra?.mapa) return { texto: 'Ubicación recibida', enlace: String(extra.mapa), enlaceTexto: 'Ver en el mapa' };
  if (paso?.dato === 'documento_identidad') return { texto: `${extra?.tipo ?? 'Documento'} ${valor}` };
  if (paso?.dato === 'foto' || paso?.dato === 'documento' || paso?.dato === 'captura_pago') {
    const nombre = paso.dato === 'captura_pago' ? 'Captura recibida' : paso.dato === 'foto' ? 'Foto recibida' : 'Documento recibido';
    return extra?.mediaId ? { texto: nombre, enlace: `/admin/local/media/${encodeURIComponent(String(extra.mediaId))}`, enlaceTexto: 'Abrir' } : { texto: nombre };
  }
  if (paso?.dato === 'direccion' && extra?.distrito) return { texto: `${valor} (${extra.distrito})` };
  return { texto: valor };
}

/** Una persona tal como la pinta la pantalla. */
export function personaParaPantalla(p: PersonaProceso, proceso: Proceso | null, tz: string) {
  const v = ESTADOS_PERSONA_VISUALES[p.estado] ?? { nombre: p.estado, tono: 'gris' };
  const paso = proceso?.pasos[p.paso];
  const respuestas = proceso
    ? proceso.pasos
        .filter((x) => p.respuestas[x.id])
        .map((x) => ({ titulo: x.titulo || NOMBRE_TIPO_PASO[x.tipo], ...respuestaLegible(proceso, x.id, p.respuestas[x.id]!.valor, p.respuestas[x.id]!.extra, tz), en: p.respuestas[x.id]!.en, escribio: p.respuestas[x.id]!.texto }))
    : [];
  return {
    id: p.id,
    corridaId: p.corridaId,
    procesoId: p.procesoId,
    proceso: proceso?.nombre ?? '',
    telefono: p.phone ?? p.telefonoCrudo,
    conTelefono: Boolean(p.phone),
    nombre: p.nombre,
    datos: p.datos,
    estado: p.estado,
    estadoNombre: v.nombre,
    tono: v.tono,
    paso: p.estado === 'completada' ? 'Terminó' : paso ? paso.titulo || NOMBRE_TIPO_PASO[paso.tipo] : '',
    pasoN: Math.min(p.paso + 1, proceso?.pasos.length ?? 0),
    totalPasos: proceso?.pasos.length ?? 0,
    sub: p.sub === 'llego' ? 'Llegó al lugar' : p.sub === 'reprogramando' ? 'Eligiendo nueva fecha' : null,
    intentos: p.intentos,
    ultimo: p.ultimo,
    motivo: p.motivo,
    pausada: p.pausada,
    proximoAt: p.proximoAt?.toISOString() ?? null,
    actualizado: p.updatedAt.toISOString(),
    respuestas,
  };
}

function enviarError(reply: FastifyReply, error: unknown) {
  if (error instanceof ErrorProcesos) return reply.code(error.statusCode).send({ error: error.message, ...(error.ir ? { ir: error.ir } : {}) });
  throw error;
}

const soloAdmin = (request: FastifyRequest, reply: FastifyReply): boolean => {
  const u = request.usuario;
  if (!u || u.rol !== 'admin') {
    void reply.code(403).send({ error: 'Crear, editar o borrar procesos lo hace un administrador. Pídeselo a quien administra la cuenta (Equipo).' });
    return false;
  }
  return true;
};

const idParam = z.object({ id: z.coerce.number().int().positive() });
const cargaSchema = z
  .object({
    nombre: z.string().trim().max(120).optional(),
    texto: z.string().max(2_000_000).optional(),
    xlsxBase64: z.string().max(8_000_000).optional(),
    filas: z.array(z.record(z.string(), z.unknown())).max(5000).optional(),
    personas: z.array(z.record(z.string(), z.unknown())).max(5000).optional(),
  })
  .refine((b) => Boolean(b.texto?.trim() || b.xlsxBase64 || b.filas?.length || b.personas?.length), { message: 'Manda la lista: pega la tabla, sube un Excel o CSV, o pasa las filas.' });

export async function registerProcesosRoutes(app: FastifyInstance, deps: DepsRutasProcesos): Promise<void> {
  const { procesos, config } = deps;
  const tz = config.timezone;
  const html = (reply: FastifyReply, body: string) => reply.type('text/html; charset=utf-8').header('cache-control', 'no-store').send(body);
  const pagina = { demo: config.DEMO_MODE, nombreNegocio: deps.nombreNegocio() };

  // --- pantallas ------------------------------------------------------------------
  app.get('/procesos', async (_request, reply) => html(reply, procesosPage({ ...pagina, nombreNegocio: deps.nombreNegocio() })));
  app.get('/procesos/editor', async (_request, reply) => html(reply, editorPage({ ...pagina, nombreNegocio: deps.nombreNegocio() })));
  app.get('/procesos/corrida', async (_request, reply) => html(reply, personasPage({ ...pagina, nombreNegocio: deps.nombreNegocio(), modo: 'corrida' })));
  app.get('/personas', async (_request, reply) => html(reply, personasPage({ ...pagina, nombreNegocio: deps.nombreNegocio(), modo: 'todas' })));
  app.get('/respuestas', async (_request, reply) => html(reply, respuestasPage({ ...pagina, nombreNegocio: deps.nombreNegocio() })));

  // --- lo que piden las pantallas ---------------------------------------------------
  app.get('/admin/procesos', async () => {
    const lista = await procesos.listar();
    return {
      procesos: lista.map((p) => ({ id: p.id, nombre: p.nombre, plantilla: p.plantilla, descripcion: p.descripcion, estado: p.estado, pasos: p.pasos.length, resumenPasos: describirPasos(p), cifras: p.cifras, corridas: p.corridas, vivas: p.vivas, necesitan: p.necesitan, actualizado: p.updatedAt.toISOString() })),
      plantillas: procesos.plantillas().map((pl) => ({ id: pl.id, nombre: pl.nombre, resumen: pl.resumen, descripcion: pl.descripcion, icono: pl.icono, columnas: pl.columnas })),
      gsgActivo: procesos.gsgActivo(),
    };
  });

  app.get('/admin/procesos/resumen', async () => procesos.resumen());

  app.post('/admin/procesos/desde-plantilla', async (request, reply) => {
    if (!soloAdmin(request, reply)) return reply;
    const body = z.object({ plantilla: z.string().trim().min(1), nombre: z.string().trim().max(120).optional() }).parse(request.body ?? {});
    try {
      const p = await procesos.crearDesdePlantilla(body.plantilla, body.nombre);
      return { ok: true, proceso: { id: p.id, nombre: p.nombre, plantilla: p.plantilla }, ir: p.plantilla === 'gsg' ? '/hoy' : `/procesos/editor?id=${p.id}` };
    } catch (error) {
      return enviarError(reply, error);
    }
  });

  app.post('/admin/procesos', async (request, reply) => {
    if (!soloAdmin(request, reply)) return reply;
    try {
      const p = await procesos.crear(request.body ?? {});
      return { ok: true, proceso: { id: p.id, nombre: p.nombre } };
    } catch (error) {
      return enviarError(reply, error);
    }
  });

  app.get('/admin/procesos/corridas', async (request) => {
    const q = z.object({ procesoId: z.coerce.number().int().positive().optional() }).parse(request.query ?? {});
    const lista = await procesos.corridas(q.procesoId);
    return { corridas: lista.map((c) => ({ id: c.id, procesoId: c.procesoId, proceso: c.proceso, nombre: c.nombre, estado: c.estado, origen: c.origen, cifras: c.cifras, total: Object.values(c.cifras).reduce((s, n) => s + n, 0), creada: c.createdAt.toISOString() })) };
  });

  app.get('/admin/procesos/corridas/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    try {
      const c = await procesos.corrida(id);
      return {
        corrida: { id: c.corrida.id, nombre: c.corrida.nombre, estado: c.corrida.estado, creada: c.corrida.createdAt.toISOString(), origen: c.corrida.origen },
        proceso: { id: c.proceso.id, nombre: c.proceso.nombre, estado: c.proceso.estado, pasos: c.proceso.pasos.map((p) => ({ id: p.id, titulo: p.titulo || NOMBRE_TIPO_PASO[p.tipo], tipo: p.tipo })) },
        cifras: c.cifras,
        personas: c.personas.map((p) => personaParaPantalla(p, c.proceso, tz)),
      };
    } catch (error) {
      return enviarError(reply, error);
    }
  });

  app.post('/admin/procesos/corridas/:id/estado', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ estado: z.enum(['activa', 'pausada', 'terminada']) }).parse(request.body ?? {});
    try {
      const c = await procesos.cambiarCorrida(id, body.estado);
      return { ok: true, corrida: { id: c.id, estado: c.estado }, aviso: body.estado === 'pausada' ? 'Corrida en pausa: no sale ningún mensaje hasta que la reanudes. Lo que respondan se sigue leyendo.' : body.estado === 'activa' ? 'Corrida en marcha: los mensajes salen con la pausa de siempre.' : 'Corrida terminada: a quien seguía en curso ya no se le escribe.' };
    } catch (error) {
      return enviarError(reply, error);
    }
  });

  app.get('/admin/procesos/personas', async (request) => {
    const q = z.object({ procesoId: z.coerce.number().int().positive().optional(), estado: z.string().optional(), respuestas: z.string().optional(), limit: z.coerce.number().int().min(1).max(5000).default(1000) }).parse(request.query ?? {});
    const estados = (q.estado ?? '').split(',').filter((e): e is EstadoPersona => (ESTADOS_PERSONA as string[]).includes(e));
    const lista = await procesos.personas({ procesoId: q.procesoId, estados: estados.length ? estados : undefined, conRespuestas: q.respuestas === '1', limit: q.limit });
    const cache = new Map<number, Proceso | null>();
    const salida = [];
    for (const p of lista) {
      if (!cache.has(p.procesoId)) cache.set(p.procesoId, await procesos.proceso(p.procesoId).catch(() => null));
      salida.push(personaParaPantalla(p, cache.get(p.procesoId) ?? null, tz));
    }
    const todos = await procesos.listar();
    return { personas: salida, procesos: todos.filter((p) => p.plantilla !== 'gsg').map((p) => ({ id: p.id, nombre: p.nombre, pasos: p.pasos.filter((x) => x.tipo === 'pedir' || x.tipo === 'confirmar' || x.tipo === 'avance').map((x) => ({ id: x.id, titulo: x.titulo || NOMBRE_TIPO_PASO[x.tipo] })) })) };
  });

  app.post('/admin/procesos/personas/masa', async (request, reply) => {
    const body = z.object({ accion: z.enum(['pedir_ahora', 'pausar', 'reanudar', 'persona', 'cancelar']), ids: z.array(z.coerce.number().int().positive()).min(1, 'Marca al menos una persona.').max(5000) }).parse(request.body ?? {});
    try {
      return { ok: true, ...(await procesos.masa(body.accion, body.ids, request.usuario?.nombre ?? request.usuario?.usuario)) };
    } catch (error) {
      return enviarError(reply, error);
    }
  });

  app.get('/admin/procesos/personas/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const repo = procesos.depsNucleo().repos.procesos;
    const p = repo ? await repo.persona(id) : null;
    if (!p || !repo) return reply.code(404).send({ error: 'Esa persona ya no está en ningún proceso.' });
    const proceso = await procesos.proceso(p.procesoId).catch(() => null);
    const eventos = await repo.eventos(id, 60);
    return { persona: personaParaPantalla(p, proceso, tz), eventos: eventos.map((e) => ({ tipo: e.tipo, detalle: e.detalle, en: e.en.toISOString() })) };
  });

  app.get('/admin/procesos/exportar', async (request, reply) => {
    const q = z.object({ corridaId: z.coerce.number().int().positive().optional(), procesoId: z.coerce.number().int().positive().optional() }).parse(request.query ?? {});
    try {
      const { nombre, csv } = await procesos.exportarCsv(q);
      return reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${encodeURIComponent(nombre)}.csv"; filename*=UTF-8''${encodeURIComponent(nombre)}.csv`)
        .send(csv);
    } catch (error) {
      return enviarError(reply, error);
    }
  });

  app.get('/admin/procesos/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    try {
      const p = await procesos.proceso(id);
      const plantilla = p.plantilla ? procesos.plantillas().find((x) => x.id === p.plantilla) : null;
      return {
        proceso: { id: p.id, nombre: p.nombre, plantilla: p.plantilla, descripcion: p.descripcion, pasos: p.pasos, ritmo: p.ritmo, cierre: p.cierre, estado: p.estado },
        variables: [...new Set([...VARIABLES_BASE, ...(plantilla?.columnas ?? []).map((c) => `{${c}}`)])],
        columnasSugeridas: plantilla?.columnas ?? [],
        ejemplo: plantilla?.ejemplo ?? 'telefono;nombre\n987654321;Ana Ruiz',
        nombresPaso: NOMBRE_TIPO_PASO,
        nombresDato: NOMBRE_TIPO_DATO,
        corridas: (await procesos.corridas(id)).map((c) => ({ id: c.id, nombre: c.nombre, estado: c.estado, cifras: c.cifras, total: Object.values(c.cifras).reduce((s, n) => s + n, 0), creada: c.createdAt.toISOString() })),
      };
    } catch (error) {
      return enviarError(reply, error);
    }
  });

  app.post('/admin/procesos/:id', async (request, reply) => {
    if (!soloAdmin(request, reply)) return reply;
    const { id } = idParam.parse(request.params);
    try {
      const p = await procesos.guardar(id, request.body ?? {});
      return { ok: true, proceso: { id: p.id, nombre: p.nombre } };
    } catch (error) {
      return enviarError(reply, error);
    }
  });

  app.post('/admin/procesos/:id/estado', async (request, reply) => {
    if (!soloAdmin(request, reply)) return reply;
    const { id } = idParam.parse(request.params);
    const body = z.object({ estado: z.enum(['activo', 'pausado', 'archivado']) }).parse(request.body ?? {});
    try {
      const p = await procesos.cambiarEstado(id, body.estado);
      return { ok: true, proceso: { id: p.id, estado: p.estado }, gsgActivo: procesos.gsgActivo() };
    } catch (error) {
      return enviarError(reply, error);
    }
  });

  app.delete('/admin/procesos/:id', async (request, reply) => {
    if (!soloAdmin(request, reply)) return reply;
    const { id } = idParam.parse(request.params);
    try {
      await procesos.borrar(id);
      return { ok: true };
    } catch (error) {
      return enviarError(reply, error);
    }
  });

  app.post('/admin/procesos/:id/personas', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = cargaSchema.parse(request.body ?? {});
    try {
      const r = await procesos.cargarPersonas(id, { nombre: body.nombre, texto: body.texto, xlsxBase64: body.xlsxBase64, filas: body.filas ?? body.personas });
      return { ok: true, ...resumenCarga(r) };
    } catch (error) {
      return enviarError(reply, error);
    }
  });

  // --- la API publica -------------------------------------------------------------
  app.get('/api/v1/procesos', { config: { permiso: 'procesos:gestionar' } }, async () => {
    const lista = await procesos.listar();
    return { procesos: lista.filter((p) => p.plantilla !== 'gsg').map((p) => ({ id: p.id, nombre: p.nombre, plantilla: p.plantilla, estado: p.estado, pasos: p.pasos.map((x) => ({ id: x.id, tipo: x.tipo, titulo: x.titulo, dato: x.dato ?? null })), personas: { vivas: p.vivas, necesitanAAlguien: p.necesitan, porEstado: p.cifras } })) };
  });

  app.post('/api/v1/procesos/:id/personas', { config: { permiso: 'procesos:gestionar' } }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = cargaSchema.parse(request.body ?? {});
    try {
      const r = await procesos.cargarPersonas(id, { nombre: body.nombre, texto: body.texto, xlsxBase64: body.xlsxBase64, filas: body.filas ?? body.personas, origen: 'api' });
      return reply.code(r.listas ? 201 : 200).send({ ok: true, ...resumenCarga(r) });
    } catch (error) {
      return enviarError(reply, error);
    }
  });

  app.get('/api/v1/procesos/corridas/:id', { config: { permiso: 'procesos:gestionar' } }, async (request, reply) => {
    const { id } = idParam.parse(request.params);
    try {
      const c = await procesos.corrida(id);
      return {
        corrida: { id: c.corrida.id, nombre: c.corrida.nombre, estado: c.corrida.estado, procesoId: c.proceso.id, proceso: c.proceso.nombre },
        cifras: c.cifras,
        personas: c.personas.map((p) => ({ id: p.id, telefono: p.phone ?? p.telefonoCrudo, nombre: p.nombre, estado: p.estado, paso: p.paso, respuestas: p.respuestas, motivo: p.motivo, actualizado: p.updatedAt.toISOString() })),
      };
    } catch (error) {
      return enviarError(reply, error);
    }
  });
}

function resumenCarga(r: Awaited<ReturnType<ServicioProcesos['cargarPersonas']>>) {
  const partes = [`${r.listas} persona${r.listas === 1 ? '' : 's'} en la corrida «${r.corrida.nombre}»`];
  if (r.conError) partes.push(`${r.conError} a la${r.conError === 1 ? '' : 's'} que no se le${r.conError === 1 ? '' : 's'} puede escribir (se ve${r.conError === 1 ? '' : 'n'} en la corrida con el motivo)`);
  if (r.duplicadas) partes.push(`${r.duplicadas} repetida${r.duplicadas === 1 ? '' : 's'} (se deja una)`);
  if (r.descartadas.length) partes.push(`${r.descartadas.length} fila${r.descartadas.length === 1 ? '' : 's'} sin teléfono`);
  const faltan = r.faltan.length ? ` Ojo: los mensajes usan ${r.faltan.map((v) => `{${v}}`).join(', ')} y la lista no trae esa columna: ese hueco saldrá vacío.` : '';
  return {
    corrida: { id: r.corrida.id, nombre: r.corrida.nombre },
    total: r.total,
    listas: r.listas,
    conError: r.conError,
    duplicadas: r.duplicadas,
    descartadas: r.descartadas,
    columnas: r.columnas,
    faltan: r.faltan,
    aviso: `Listo: ${partes.join(', ')}. Los mensajes salen de uno en uno, con la pausa de siempre y en el horario del proceso.${faltan}`,
    ir: `/procesos/corrida?id=${r.corrida.id}`,
  };
}
