/**
 * API de las conversaciones guardadas (respaldos).
 *
 * Cerrar un chat, buscar lo guardado (por nombre, por lo que se dijo, por
 * etiqueta, por pedido, por fecha), leerlo con sus adjuntos, exportarlo en
 * algo que se pueda abrir (texto, pagina para imprimir o PDF, Excel; con o
 * sin datos personales), compartirlo como evidencia con un enlace que
 * caduca, ensenarselo a la IA, ponerle notas, volver a resumirlo, devolverlo
 * al chat, mandarlo a la papelera, borrar todo lo de un cliente, importar un
 * chat del telefono y saber si los ficheros siguen intactos. Todo detras de
 * la sesion, como el resto de /admin, salvo la copia publica de evidencia.
 *
 *  POST /admin/chat/:contactId/archive        cerrar y guardar un chat
 *  POST /admin/archives/cerrar                 cerrar varios de golpe (por contactos o por pedidos terminados hoy)
 *  GET  /admin/archives                        lista con filtros; stats (con las cifras de la caja de estadisticas)
 *  GET  /admin/archives/export.csv             todas (con los mismos filtros) para Excel (?anonimo=si sin datos personales)
 *  GET  /admin/archives/revision               los ficheros (y sus adjuntos) siguen ahi y sin tocar
 *  POST /admin/archives/barrer                 guardar ya las conversaciones sin movimiento
 *  POST /admin/archives/aprender               { desde?, hasta? } ensenar a la IA con las de un tramo (este mes por defecto)
 *  POST /admin/archives/borrar-cliente         { contactId | telefono, confirmar: 'BORRAR' } todo lo de un cliente a la papelera
 *  POST /admin/archives/importar               { texto, telefono, nombre? } un chat exportado del telefono
 *  GET  /admin/archives/:id                    el hilo guardado
 *  GET  /admin/archives/:id/download           el fichero comprimido (.ndjson.gz)
 *  GET  /admin/archives/:id/export.txt|.html   texto plano / pagina imprimible (?anonimo=si)
 *  GET  /admin/archives/:id/adjunto/:mediaId   una foto, un audio o un documento copiado junto al respaldo
 *  POST /admin/archives/:id/enlace             { dias } enlace publico de solo lectura con caducidad
 *  POST /admin/archives/:id/aprender           ensenar a la IA con esta conversacion
 *  POST /admin/archives/:id/notas              { notas, etiquetas?, pedido? }
 *  POST /admin/archives/:id/resumir            volver a pedirle el resumen a la IA
 *  POST /admin/archives/:id/restore            devolverlo al chat
 *  DELETE /admin/archives/:id                  a la papelera (?definitivo=si borra de verdad)
 *  POST /admin/archives/:id/recuperar          sacarlo de la papelera
 *  GET  /guardados/ver/:token                  (publica) la copia de solo lectura, sin telefono entero ni notas
 *  GET  /guardados/ver/:token/adjunto/:mediaId (publica) sus adjuntos
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Repos } from '../db/repos.js';
import type { ArchiveReason, ChatArchive } from '../db/archives.js';
import type { ServicioEntrenamiento } from '../entrenamiento/servicio.js';
import {
  archivarConversacion,
  barrerInactivas,
  borrarTodoDeCliente,
  ETIQUETAS,
  exportarCsv,
  exportarHtml,
  exportarTexto,
  importarChatDeWhatsApp,
  leerAdjunto,
  leerRespaldo,
  moverAPapelera,
  NOMBRE_ETIQUETA,
  paresParaAprender,
  restaurarRespaldo,
  resumirRespaldo,
  revisarRespaldos,
  sacarDePapelera,
  type ArchiveDeps,
} from '../archive/service.js';
import { crearEnlace, verificarEnlace } from '../archive/enlace.js';
import { borrarArchivo, leerCrudo } from '../archive/store.js';
import { revisarTelefono } from '../rutas/telefono.js';

export interface ArchiveRoutesDeps {
  repos: Repos;
  /** Directorio de respaldos. */
  dir: string;
  /** Dias de inactividad tras los que se cierra sola una conversacion (se cambia desde la pantalla). */
  dias: number | (() => number);
  /** La IA para resumir, si hay. */
  ia?: ArchiveDeps['ia'];
  /** El pedido de GSG de un cliente, para ligar la conversacion a su entrega. */
  pedidoDe?: ArchiveDeps['pedidoDe'];
  nombreNegocio?: () => string;
  /** Los telefonos de los pedidos terminados o avisados hoy (para "cerrar los de hoy"). */
  telefonosTerminadosHoy?: () => Promise<Array<{ phone: string; referencia: string }>>;
  /** Donde estan los ficheros del chat: sin el, los adjuntos no se copian al respaldo. */
  mediaDir?: string;
  /** La clave con la que se firman los enlaces de evidencia: sin ella no se pueden crear. */
  secreto?: string;
  /** El entrenamiento del asistente, para "ensenar a la IA con esta conversacion". */
  entrenamiento?: ServicioEntrenamiento;
  /** La URL publica del sistema para armar los enlaces; si falta se toma la de la peticion. */
  publicBase?: string;
}

const razones = ['manual', 'lead', 'inactividad', 'entrega'] as const;

const listQuery = z.object({
  contactId: z.string().optional(),
  q: z.string().max(120).optional(),
  texto: z.string().max(200).optional(),
  etiqueta: z.string().max(40).optional(),
  pedido: z.string().max(120).optional(),
  reason: z.enum(razones).optional(),
  desde: z.string().max(40).optional(),
  hasta: z.string().max(40).optional(),
  papelera: z.enum(['si', 'no']).optional(),
  anonimo: z.enum(['si', 'no']).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const anonimoQuery = z.object({ anonimo: z.enum(['si', 'no']).optional() });

function fechaONada(v?: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v.length === 10 ? `${v}T00:00:00-05:00` : v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** El "hasta" de un dia incluye el dia entero. */
function hastaFinDeDia(v?: string): Date | undefined {
  const d = fechaONada(v);
  if (!d) return undefined;
  return v && v.length === 10 ? new Date(d.getTime() + 24 * 60 * 60 * 1000) : d;
}

/** El primer dia del mes en curso, en Lima. */
function inicioDeMes(ahora = new Date()): Date {
  const lima = new Date(ahora.getTime() - 5 * 60 * 60 * 1000);
  return new Date(`${lima.toISOString().slice(0, 7)}-01T00:00:00-05:00`);
}

const quienEs = (u: { nombre?: string; usuario?: string } | null | undefined): string | null => u?.nombre || u?.usuario || null;

const escapar = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** La pagina que ve quien abre un enlace de evidencia que ya no vale. */
function paginaEnlaceRoto(titulo: string, texto: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapar(titulo)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;color:#111;background:#f0f2f5;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}.c{background:#fff;border-radius:12px;padding:24px 28px;max-width:420px;box-shadow:0 1px 3px rgba(0,0,0,.1)}h1{font-size:18px;margin:0 0 8px}p{margin:0;color:#444}</style></head>
<body><div class="c"><h1>${escapar(titulo)}</h1><p>${escapar(texto)}</p></div></body></html>`;
}

export async function registerArchiveRoutes(app: FastifyInstance, deps: ArchiveRoutesDeps): Promise<void> {
  const { repos, dir } = deps;
  const diasDe = () => (typeof deps.dias === 'function' ? deps.dias() : deps.dias);
  const service: ArchiveDeps = {
    repos,
    dir,
    mediaDir: deps.mediaDir,
    ia: deps.ia,
    pedidoDe: deps.pedidoDe,
    nombreNegocio: deps.nombreNegocio,
    log: (mensaje, detalle) => app.log.info(detalle ?? {}, mensaje),
  };
  const consulta = (q: z.infer<typeof listQuery>) => ({
    contactId: q.contactId,
    q: q.q,
    texto: q.texto,
    etiqueta: q.etiqueta,
    pedido: q.pedido,
    reason: q.reason as ArchiveReason | undefined,
    desde: fechaONada(q.desde),
    hasta: hastaFinDeDia(q.hasta),
    papelera: q.papelera === 'si',
  });
  const baseDe = (request: FastifyRequest): string => (deps.publicBase ?? `${request.protocol}://${request.host}`).replace(/\/+$/, '');
  const conAdjuntos = Boolean(deps.mediaDir);

  /** Cierra el chat: lo respalda entero y lo vacia de la base. */
  app.post<{ Params: { contactId: string } }>('/admin/chat/:contactId/archive', async (request, reply) => {
    const salida = await archivarConversacion(service, request.params.contactId, 'manual', quienEs(request.usuario));
    if (!salida.ok) return reply.code(409).send({ error: salida.motivo });
    return salida;
  });

  /** Varios de golpe: por contactos, o los de los pedidos terminados/avisados hoy. */
  app.post('/admin/archives/cerrar', async (request, reply) => {
    const body = z.object({ contactIds: z.array(z.string()).max(500).optional(), pedidosDeHoy: z.boolean().optional() }).parse(request.body ?? {});
    const quien = quienEs(request.usuario);
    const hechas: Array<{ contactId: string; phone: string; mensajes: number; pedido?: string }> = [];
    const saltadas: Array<{ contactId: string; motivo: string }> = [];
    let contactos: Array<{ id: string; referencia?: string }> = (body.contactIds ?? []).map((id) => ({ id }));
    if (body.pedidosDeHoy) {
      if (!deps.telefonosTerminadosHoy) return reply.code(409).send({ error: 'En este arranque no hay entregas: no se sabe qué pedidos terminaron hoy.' });
      for (const t of await deps.telefonosTerminadosHoy()) {
        const c = await repos.contacts.getByPhone(t.phone);
        if (c) contactos.push({ id: c.id, referencia: t.referencia });
      }
    }
    contactos = contactos.filter((c, i, todos) => todos.findIndex((x) => x.id === c.id) === i);
    for (const c of contactos) {
      try {
        const r = await archivarConversacion(service, c.id, body.pedidosDeHoy && c.referencia ? 'entrega' : 'manual', quien);
        if (r.ok) hechas.push({ contactId: c.id, phone: r.archive!.phone, mensajes: r.borrados ?? 0, pedido: c.referencia });
        else saltadas.push({ contactId: c.id, motivo: r.motivo ?? 'sin mensajes' });
      } catch (error) {
        saltadas.push({ contactId: c.id, motivo: error instanceof Error ? error.message : String(error) });
      }
    }
    return { ok: true, guardadas: hechas.length, hechas, saltadas };
  });

  app.get('/admin/archives', async (request) => {
    const query = listQuery.parse(request.query ?? {});
    const filtro = consulta(query);
    return {
      items: await repos.archives.list({ ...filtro, limit: query.limit, offset: query.offset }),
      total: await repos.archives.count(filtro),
      stats: await repos.archives.stats(),
      // Lo que el panel necesita para explicar la limpieza automatica.
      inactividadDias: diasDe(),
      etiquetas: ETIQUETAS.map((e) => ({ id: e, nombre: NOMBRE_ETIQUETA[e] })),
      conIA: Boolean(deps.ia?.()),
      conAdjuntos,
      conEnlaces: Boolean(deps.secreto),
      conEntrenamiento: Boolean(deps.entrenamiento),
    };
  });

  /** Todas (con los filtros de la lista) como CSV para Excel. */
  app.get('/admin/archives/export.csv', async (request, reply) => {
    const query = listQuery.parse(request.query ?? {});
    const anonimo = query.anonimo === 'si';
    const csv = await exportarCsv(service, consulta(query), { anonimo });
    return reply.type('text/csv; charset=utf-8').header('content-disposition', `attachment; filename="conversaciones-guardadas-${new Date().toISOString().slice(0, 10)}${anonimo ? '-sin-datos' : ''}.csv"`).send(csv);
  });

  /** Estado de salud: los ficheros siguen ahi y con el mismo contenido. */
  app.get('/admin/archives/revision', async () => {
    const items = await revisarRespaldos(service);
    return { items, revisados: items.length, rotos: items.filter((i) => !i.ok).length, adjuntosFaltan: items.reduce((s, i) => s + i.adjuntosFaltan, 0) };
  });
  // El nombre de antes, por si algo lo tenia apuntado.
  app.get('/admin/archives-revision', async () => ({ items: await revisarRespaldos(service) }));

  /** Barrido a mano de las conversaciones inactivas. */
  app.post('/admin/archives/barrer', async (request) => {
    const body = z.object({ dias: z.coerce.number().int().positive().max(3650).optional(), limite: z.coerce.number().int().positive().max(500).default(50) }).parse(request.body ?? {});
    const dias = body.dias ?? diasDe();
    if (!dias) return { revisados: 0, archivados: 0, mensajes: 0, fallos: [], aviso: 'falta el plazo en dias' };
    return barrerInactivas(service, dias, body.limite);
  });

  const SIN_ENTRENAMIENTO = 'En este arranque no hay entrenamiento de la IA: no se le puede enseñar.';

  /** Ensena a la IA con las conversaciones de un tramo (este mes por defecto). Las lecciones entran pendientes de revisar. */
  app.post('/admin/archives/aprender', async (request, reply) => {
    if (!deps.entrenamiento) return reply.code(409).send({ error: SIN_ENTRENAMIENTO, ir: '/entrenamiento' });
    const body = z.object({ desde: z.string().max(40).optional(), hasta: z.string().max(40).optional(), limite: z.coerce.number().int().positive().max(500).default(300) }).parse(request.body ?? {});
    const desde = fechaONada(body.desde) ?? inicioDeMes();
    const hasta = hastaFinDeDia(body.hasta);
    const quien = quienEs(request.usuario);
    const lista = await repos.archives.list({ desde, hasta, limit: body.limite, offset: 0 });
    let pares = 0;
    let nuevas = 0;
    let repetidas = 0;
    let conversaciones = 0;
    for (const a of lista) {
      const r = await paresParaAprender(service, a.id).catch(() => null);
      if (!r || !r.pares.length) continue;
      conversaciones++;
      pares += r.pares.length;
      const e = await deps.entrenamiento.ensenarVarias(
        r.pares.map((p) => ({ tipo: 'ejemplo' as const, pregunta: p.pregunta, respuesta: p.respuesta, tema: null, mala: null })),
        { origen: 'chat', origenDetalle: `conversación guardada #${a.id} de ${a.name ?? a.phone}`, quien, estado: 'pendiente' },
      );
      nuevas += e.nuevas;
      repetidas += e.repetidas;
    }
    return { ok: true, conversaciones, revisadas: lista.length, pares, nuevas, repetidas, desde, hasta: hasta ?? null };
  });

  /**
   * Todo lo de un cliente a la papelera: lo guardado y lo vivo del chat
   * (que primero se guarda). Se exige escribir BORRAR porque no hay vuelta
   * atras pasados los 30 dias de la papelera.
   */
  app.post('/admin/archives/borrar-cliente', async (request, reply) => {
    const body = z.object({ contactId: z.string().optional(), telefono: z.string().max(30).optional(), confirmar: z.string().max(20).optional() }).parse(request.body ?? {});
    if (body.confirmar !== 'BORRAR') return reply.code(400).send({ error: 'Para borrar todo lo de un cliente hay que escribir BORRAR en el cuadro de confirmación.' });
    let contactId = body.contactId;
    if (!contactId && body.telefono) {
      const revision = revisarTelefono(body.telefono);
      const c = await repos.contacts.getByPhone(revision.ok ? revision.phone : body.telefono.replace(/\D+/g, ''));
      contactId = c?.id;
    }
    if (!contactId) return reply.code(404).send({ error: 'No hay ningún cliente con ese número.' });
    const r = await borrarTodoDeCliente(service, contactId, quienEs(request.usuario));
    if (!r.ok) return reply.code(404).send({ error: r.motivo });
    return { ok: true, guardadas: r.guardadas, aPapelera: r.aPapelera, papeleraDias: 30 };
  });

  /** Un chat exportado del telefono (.txt pegado), como conversacion guardada. Hasta 5 MB. */
  app.post('/admin/archives/importar', { bodyLimit: 6 * 1024 * 1024 }, async (request, reply) => {
    const body = z.object({ texto: z.string().min(1).max(5 * 1024 * 1024), telefono: z.string().min(6).max(30), nombre: z.string().max(200).optional() }).parse(request.body ?? {});
    const r = await importarChatDeWhatsApp(service, { texto: body.texto, telefono: body.telefono, nombre: body.nombre ?? null, quien: quienEs(request.usuario) });
    if (!r.ok) return reply.code(400).send({ error: r.motivo, lectura: r.lectura ?? null });
    return { ok: true, archive: r.archive, mensajes: r.mensajes, desde: r.desde, hasta: r.hasta, lectura: r.lectura };
  });

  const idDe = (raw: string): number | null => {
    const id = Number(raw);
    return Number.isInteger(id) ? id : null;
  };

  /** El hilo guardado, para leerlo sin restaurarlo. */
  app.get<{ Params: { id: string } }>('/admin/archives/:id', async (request, reply) => {
    const id = idDe(request.params.id);
    if (id === null) return reply.code(400).send({ error: 'Identificador no válido.' });
    const leido = await leerRespaldo(service, id);
    if (!leido) return reply.code(404).send({ error: 'Esa conversación guardada ya no existe.' });
    return leido;
  });

  /** El fichero tal cual, comprimido. Es la copia que se lleva uno de aqui. */
  app.get<{ Params: { id: string } }>('/admin/archives/:id/download', async (request, reply) => {
    const id = idDe(request.params.id);
    const archive = id === null ? null : await repos.archives.get(id);
    if (!archive) return reply.code(404).send({ error: 'Esa conversación guardada ya no existe.' });
    const nombre = `chat-${archive.phone}-${archive.createdAt.toISOString().slice(0, 10)}.ndjson.gz`;
    return reply.type('application/gzip').header('content-disposition', `attachment; filename="${nombre}"`).send(leerCrudo(dir, archive.file));
  });

  app.get<{ Params: { id: string } }>('/admin/archives/:id/export.txt', async (request, reply) => {
    const id = idDe(request.params.id);
    const anonimo = anonimoQuery.parse(request.query ?? {}).anonimo === 'si';
    const r = id === null ? null : await exportarTexto(service, id, { anonimo });
    if (!r) return reply.code(404).send({ error: 'Esa conversación guardada ya no existe.' });
    return reply.type('text/plain; charset=utf-8').header('content-disposition', `attachment; filename="${r.nombre}"`).send(r.texto);
  });

  app.get<{ Params: { id: string } }>('/admin/archives/:id/export.html', async (request, reply) => {
    const id = idDe(request.params.id);
    const anonimo = anonimoQuery.parse(request.query ?? {}).anonimo === 'si';
    const r = id === null ? null : await exportarHtml(service, id, { anonimo });
    if (!r) return reply.code(404).send({ error: 'Esa conversación guardada ya no existe.' });
    return reply.type('text/html; charset=utf-8').send(r.html);
  });

  /** Una foto, un audio o un documento copiado junto al respaldo. */
  app.get<{ Params: { id: string; mediaId: string } }>('/admin/archives/:id/adjunto/:mediaId', async (request, reply) => {
    const id = idDe(request.params.id);
    const archive = id === null ? null : await repos.archives.get(id);
    if (!archive) return reply.code(404).send({ error: 'Esa conversación guardada ya no existe.' });
    const r = await leerAdjunto(service, archive, request.params.mediaId);
    if (!r) return reply.code(404).send({ error: 'Ese adjunto no se guardó con la conversación.' });
    // Lo guardado no cambia: se puede cachear para siempre.
    return reply.type(r.adjunto.mimeType).header('cache-control', 'private, max-age=31536000, immutable').send(r.datos);
  });

  /** Un enlace publico de solo lectura, firmado, que caduca a los `dias` dias (7 por defecto, 30 como mucho). */
  app.post<{ Params: { id: string } }>('/admin/archives/:id/enlace', async (request, reply) => {
    if (!deps.secreto) return reply.code(409).send({ error: 'En este arranque no se pueden crear enlaces: falta la clave con la que se firman.' });
    const id = idDe(request.params.id);
    const archive = id === null ? null : await repos.archives.get(id);
    if (!archive) return reply.code(404).send({ error: 'Esa conversación guardada ya no existe.' });
    if (archive.deletedAt) return reply.code(409).send({ error: 'Está en la papelera: sácala antes de compartirla.' });
    const body = z.object({ dias: z.coerce.number().int().min(1).max(30).default(7) }).parse(request.body ?? {});
    const { token, caducaEn } = crearEnlace(archive.id, body.dias, deps.secreto);
    const ruta = `/guardados/ver/${token}`;
    return { ok: true, url: `${baseDe(request)}${ruta}`, ruta, caducaEn, dias: body.dias };
  });

  /** Ensena a la IA con esta conversacion: sus pares pregunta/respuesta entran pendientes de revisar. */
  app.post<{ Params: { id: string } }>('/admin/archives/:id/aprender', async (request, reply) => {
    if (!deps.entrenamiento) return reply.code(409).send({ error: SIN_ENTRENAMIENTO, ir: '/entrenamiento' });
    const id = idDe(request.params.id);
    if (id === null) return reply.code(400).send({ error: 'Identificador no válido.' });
    const r = await paresParaAprender(service, id);
    if (!r) return reply.code(404).send({ error: 'Esa conversación guardada ya no existe.' });
    if (!r.pares.length) return { ok: true, pares: 0, nuevas: 0, repetidas: 0, aviso: 'En esta conversación no hay ninguna pregunta del cliente con una respuesta de una persona que se pueda aprender.' };
    const e = await deps.entrenamiento.ensenarVarias(
      r.pares.map((p) => ({ tipo: 'ejemplo' as const, pregunta: p.pregunta, respuesta: p.respuesta, tema: null, mala: null })),
      { origen: 'chat', origenDetalle: `conversación guardada #${r.archive.id} de ${r.archive.name ?? r.archive.phone}`, quien: quienEs(request.usuario), estado: 'pendiente' },
    );
    return { ok: true, pares: r.pares.length, nuevas: e.nuevas, repetidas: e.repetidas };
  });

  /** Notas, etiquetas y pedido puestos a mano. */
  app.post<{ Params: { id: string } }>('/admin/archives/:id/notas', async (request, reply) => {
    const id = idDe(request.params.id);
    if (id === null) return reply.code(400).send({ error: 'Identificador no válido.' });
    const body = z.object({ notas: z.string().max(2000).nullable().optional(), etiquetas: z.array(z.enum(ETIQUETAS)).max(5).optional(), pedido: z.string().trim().max(120).nullable().optional() }).parse(request.body ?? {});
    const a = await repos.archives.update(id, { notas: body.notas === undefined ? undefined : body.notas?.trim() || null, etiquetas: body.etiquetas, pedido: body.pedido === undefined ? undefined : body.pedido || null });
    if (!a) return reply.code(404).send({ error: 'Esa conversación guardada ya no existe.' });
    return { ok: true, archive: a };
  });

  /** Volver a pedirle el resumen a la IA (o a las reglas si no hay). */
  app.post<{ Params: { id: string } }>('/admin/archives/:id/resumir', async (request, reply) => {
    const id = idDe(request.params.id);
    if (id === null) return reply.code(400).send({ error: 'Identificador no válido.' });
    const a = await resumirRespaldo(service, id, { forzar: true });
    if (!a) return reply.code(404).send({ error: 'Esa conversación guardada ya no existe.' });
    return { ok: true, archive: a, conIA: Boolean(deps.ia?.()) };
  });

  app.post<{ Params: { id: string } }>('/admin/archives/:id/restore', async (request, reply) => {
    const id = idDe(request.params.id);
    if (id === null) return reply.code(400).send({ error: 'Identificador no válido.' });
    const salida = await restaurarRespaldo(service, id);
    if (!salida.ok) return reply.code(409).send({ error: salida.motivo });
    return salida;
  });

  /**
   * A la papelera (30 dias) o, con ?definitivo=si, borrado de verdad, fichero
   * incluido: es la unica operacion tras la cual esa conversacion no existe
   * en ninguna parte, por eso se pide expresamente.
   */
  app.delete<{ Params: { id: string } }>('/admin/archives/:id', async (request, reply) => {
    const query = z.object({ definitivo: z.string().optional(), confirmar: z.string().optional() }).parse(request.query ?? {});
    const id = idDe(request.params.id);
    const archive = id === null ? null : await repos.archives.get(id);
    if (!archive) return reply.code(404).send({ error: 'Esa conversación guardada ya no existe.' });
    if (query.definitivo === 'si' || query.confirmar === 'si') {
      await borrarArchivo(dir, archive.file);
      await repos.archives.remove(archive.id);
      return { ok: true, definitivo: true };
    }
    await moverAPapelera(service, archive.id);
    return { ok: true, definitivo: false, papeleraDias: 30 };
  });

  app.post<{ Params: { id: string } }>('/admin/archives/:id/recuperar', async (request, reply) => {
    const id = idDe(request.params.id);
    const a = id === null ? null : await sacarDePapelera(service, id);
    if (!a) return reply.code(404).send({ error: 'Esa conversación guardada ya no existe.' });
    return { ok: true, archive: a };
  });

  // ------------------------------------------------- la copia publica

  type Resuelto = { archive: ChatArchive; caducaEn: Date } | { codigo: number; html: string };

  /** Resuelve el token de un enlace: el respaldo, o la pagina de error que toca. */
  const respaldoDelEnlace = async (token: string): Promise<Resuelto> => {
    if (!deps.secreto) return { codigo: 404, html: paginaEnlaceRoto('Este enlace no existe', 'Este sistema no tiene enlaces de evidencia activos.') };
    const v = verificarEnlace(token, deps.secreto);
    if (!v.ok) {
      return v.motivo === 'caducado'
        ? { codigo: 410, html: paginaEnlaceRoto('Este enlace caducó', 'Pide uno nuevo a quien te lo mandó.') }
        : { codigo: 404, html: paginaEnlaceRoto('Este enlace no existe', 'Comprueba que lo copiaste entero.') };
    }
    const archive = await repos.archives.get(v.payload.a);
    if (!archive || archive.deletedAt) return { codigo: 410, html: paginaEnlaceRoto('Esta conversación ya no está disponible', 'Se retiró o se borró. Pide una copia a quien te mandó el enlace.') };
    return { archive, caducaEn: new Date(v.payload.exp * 1000) };
  };

  app.get<{ Params: { token: string } }>('/guardados/ver/:token', async (request, reply) => {
    const r = await respaldoDelEnlace(request.params.token);
    if ('codigo' in r) return reply.code(r.codigo).type('text/html; charset=utf-8').send(r.html);
    const pagina = await exportarHtml(service, r.archive.id, {
      publico: { caducaEn: r.caducaEn, adjuntoUrl: (mediaId) => `/guardados/ver/${request.params.token}/adjunto/${encodeURIComponent(mediaId)}` },
    });
    if (!pagina) return reply.code(410).type('text/html; charset=utf-8').send(paginaEnlaceRoto('Esta conversación ya no está disponible', 'Se retiró o se borró.'));
    return reply.type('text/html; charset=utf-8').header('cache-control', 'private, no-store').header('x-robots-tag', 'noindex').send(pagina.html);
  });

  app.get<{ Params: { token: string; mediaId: string } }>('/guardados/ver/:token/adjunto/:mediaId', async (request, reply) => {
    const r = await respaldoDelEnlace(request.params.token);
    if ('codigo' in r) return reply.code(r.codigo).send({ error: r.codigo === 410 ? 'Este enlace caducó o la conversación ya no está.' : 'Este enlace no existe.' });
    const adj = await leerAdjunto(service, r.archive, request.params.mediaId);
    if (!adj) return reply.code(404).send({ error: 'Ese adjunto no se guardó con la conversación.' });
    return reply.type(adj.adjunto.mimeType).header('cache-control', 'private, max-age=3600').send(adj.datos);
  });
}
