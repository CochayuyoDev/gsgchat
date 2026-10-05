/**
 * La pantalla "Entregas del dia" habla con esto, y otros sistemas por /api/v1.
 *
 *  GET  /admin/entregas                      todo: cifras, entregas, motorizados, GSG, ultima sincronizacion
 *  GET  /admin/entregas/:id                  una entrega con su bitacora
 *  POST /admin/entregas/sincronizar          pedirle a GSG los pendientes ahora
 *  POST /admin/entregas/ajustes              margen, esperas, intentos, textos (solo admin)
 *  POST /admin/entregas/crear                un pedido a mano
 *  POST /admin/entregas/:id/confirmar        { confirmada: true|false }
 *  POST /admin/entregas/:id/cancelar         { motivo }
 *  POST /admin/entregas/:id/ubicacion        { lat, lng } o { texto } (un enlace de mapa)
 *  POST /admin/entregas/:id/reasignar        { motorizadoId? }
 *  POST /admin/entregas/:id/sin-ubicacion     { motorizadoId? } un motorizado para un pedido que espera la ubicacion (sin pin)
 *  POST /admin/entregas/:id/reintentar
 *  POST /admin/entregas/:id/segunda-visita   el motorizado vuelve a pasar (sin preguntarle al cliente)
 *  POST /admin/entregas/:id/prioridad        { urgente: true|false }
 *  GET  /admin/entregas/numeros, POST /admin/entregas/masa   Numeros del dia (ver numeros.ts)
 *
 *  GET/POST /admin/motorizados, POST/DELETE /admin/motorizados/:id, POST /admin/motorizados/de-prueba
 *  GET  /admin/motorizados/:id/ruta          sus pedidos de hoy en orden de cercania (y el mensaje)
 *  POST /admin/motorizados/:id/ruta/mandar   se la manda por WhatsApp
 *  POST /admin/motorizados/:id/traspasar     { motorizadoId?, descanso? } le quita todo lo que lleva y lo reparte
 *
 *  GET/POST/DELETE /admin/entregas/gsg       la conexion con GSG (real o simulador), POST .../probar
 *  GET /admin/entregas/simulador, POST .../cargar, POST .../cargar-lista, POST .../modo, DELETE /admin/entregas/simulador
 *
 *  API publica: GET /api/v1/entregas (entregas:leer), POST /api/v1/entregas/sincronizar (entregas:gestionar),
 *  GET /api/v1/motorizados (entregas:leer), POST /api/v1/motorizados (entregas:gestionar).
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { enviarError } from '../api/errores.js';
import type { ServicioConexionGsg } from '../rutas/conexion-gsg.js';
import { extractLocation } from '../geo/extract.js';
import type { Config } from '../config.js';
import { ajustesEntregasSchema } from './textos.js';
import type { ServicioEntregas } from './servicio.js';
import type { GsgSimulado } from './gsg-simulado.js';
import { MOTORIZADOS_DE_PRUEBA } from './datos-de-prueba.js';
import { crearGuionDelDia, type EntranteSimulado } from './guion-dia.js';
import { registerNumerosRoutes } from './numeros.js';

export interface EntregasRoutesDeps {
  entregas: ServicioEntregas;
  conexionGsg?: ServicioConexionGsg;
  simulador?: GsgSimulado;
  config: Pick<Config, 'bbox'>;
}

const quienEs = (u: { nombre?: string; usuario?: string } | null | undefined): string => u?.nombre || u?.usuario || 'alguien del panel';

export async function registerEntregasRoutes(app: FastifyInstance, deps: EntregasRoutesDeps): Promise<void> {
  const { entregas, conexionGsg, simulador } = deps;

  const soloAdmin = (request: { usuario?: { rol?: string; porToken?: boolean } | null }) => request.usuario?.rol === 'admin' && !request.usuario.porToken;

  app.get('/admin/entregas', async () => entregas.resumen());

  // La bandeja de errores de mensajes: los pedidos de ESTA tienda (cada tienda
  // tiene su app y su base) cuyo primer mensaje no salió. Ver src/entregas/primer-mensaje.ts.
  app.get('/admin/entregas/mensajes/errores', async () => {
    const items = await entregas.bandejaMensajes();
    return { ok: true, total: items.length, items };
  });
  app.post<{ Params: { id: string } }>('/admin/entregas/:id/mensaje/reintentar', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) return enviarError(reply, 400, 'VALIDACION', 'El id del pedido tiene que ser un número.', [{ campo: 'id', mensaje: 'no es un número' }]);
    const leido = z.object({ confirmarIncierto: z.boolean().optional() }).safeParse(request.body ?? {});
    if (!leido.success) return enviarError(reply, 400, 'VALIDACION', 'confirmarIncierto tiene que ser true o false.', [{ campo: 'confirmarIncierto', mensaje: 'tiene que ser booleano' }]);
    const r = await entregas.reintentarMensaje(id, quienEs(request.usuario), { confirmarIncierto: leido.data.confirmarIncierto });
    if (!r.ok) return enviarError(reply, r.status, r.codigo, r.motivo);
    return { ok: true, id, mensaje: r.mensaje, detalle: r.mensaje.estado === 'enviado' ? 'Mensaje enviado.' : 'Reintento en marcha: sale con el ritmo de siempre.' };
  });

  // Numeros del dia: la lista de GSG numero por numero y las acciones en masa (ver numeros.ts).
  await registerNumerosRoutes(app, { entregas });

  app.post('/admin/entregas/sincronizar', async () => entregas.sincronizar());

  app.post('/admin/entregas/ajustes', async (request, reply) => {
    if (!soloAdmin(request)) return reply.code(403).send({ error: 'Solo un administrador cambia los ajustes de las entregas.' });
    const body = ajustesEntregasSchema.deepPartial().parse(request.body ?? {});
    return { ok: true, ajustes: await entregas.guardarAjustes(body as never) };
  });

  app.post('/admin/entregas/crear', async (request, reply) => {
    const body = z
      .object({
        referencia: z.string().trim().max(60).optional(),
        telefono: z.string().trim().min(6).max(20),
        nombre: z.string().trim().max(120).optional(),
        direccion: z.string().trim().max(300).optional(),
        distrito: z.string().trim().max(120).optional(),
        notas: z.string().trim().max(300).optional(),
        faltaUbicacion: z.boolean().default(true),
        faltaConfirmacion: z.boolean().default(true),
        lat: z.coerce.number().optional(),
        lng: z.coerce.number().optional(),
        urgente: z.boolean().optional(),
      })
      .parse(request.body ?? {});
    const r = await entregas.crearAMano(body, quienEs(request.usuario));
    if (!r.ok) return reply.code(400).send({ error: r.motivo });
    return { ok: true, entrega: r.entrega };
  });

  app.get<{ Params: { id: string } }>('/admin/entregas/:id', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) return reply.code(404).send({ error: 'Esa entrega no existe.' });
    const r = await entregas.entrega(id);
    if (!r) return reply.code(404).send({ error: 'Esa entrega no existe.' });
    return r;
  });

  app.post<{ Params: { id: string } }>('/admin/entregas/:id/confirmar', async (request, reply) => {
    const body = z.object({ confirmada: z.boolean().default(true) }).parse(request.body ?? {});
    const e = await entregas.confirmarAMano(Number(request.params.id), body.confirmada, quienEs(request.usuario));
    if (!e) return reply.code(404).send({ error: 'Esa entrega no existe.' });
    return { ok: true, entrega: e };
  });

  app.post<{ Params: { id: string } }>('/admin/entregas/:id/enviar-gsg', async (request, reply) => {
    const r = await entregas.enviarUbicacionAGsg(Number(request.params.id), quienEs(request.usuario));
    if (r.estado === 'no_existe') return reply.code(404).send({ error: r.error });
    return r;
  });

  app.post<{ Params: { id: string } }>('/admin/entregas/:id/cancelar', async (request, reply) => {
    const body = z.object({ motivo: z.string().trim().max(300).default('cancelada desde la pantalla') }).parse(request.body ?? {});
    const e = await entregas.cancelar(Number(request.params.id), body.motivo, quienEs(request.usuario));
    if (!e) return reply.code(404).send({ error: 'Esa entrega no existe.' });
    return { ok: true, entrega: e };
  });

  app.post<{ Params: { id: string } }>('/admin/entregas/:id/ubicacion', async (request, reply) => {
    const body = z.object({ lat: z.coerce.number().optional(), lng: z.coerce.number().optional(), texto: z.string().max(2000).optional() }).parse(request.body ?? {});
    let lat = body.lat;
    let lng = body.lng;
    if ((lat === undefined || lng === undefined) && body.texto) {
      const r = await extractLocation(body.texto, { bbox: deps.config.bbox });
      if (!r.ok) return reply.code(400).send({ error: 'No se encontraron coordenadas en ese texto. Pega un enlace de Google Maps o escribe "lat, lng".' });
      lat = r.lat;
      lng = r.lng;
    }
    if (lat === undefined || lng === undefined) return reply.code(400).send({ error: 'Faltan las coordenadas.' });
    const e = await entregas.ponerUbicacion(Number(request.params.id), lat, lng, quienEs(request.usuario));
    if (!e) return reply.code(404).send({ error: 'Esa entrega no existe.' });
    return { ok: true, entrega: e };
  });



  // «Asignar motorizado sin ubicación» (ficha de Hoy y Números del día): el
  // motorizado recibe el pedido con el teléfono y la dirección escrita, sin pin.


  app.post<{ Params: { id: string } }>('/admin/entregas/:id/entregada', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'Falta el número de la entrega.' });
    const e = await entregas.marcarEntregada(id, quienEs(request.usuario));
    if (!e) return reply.code(404).send({ error: 'Esa entrega ya no existe.' });
    return { ok: true, entrega: e };
  });

  /** El cierre del dia a mano: lo vivo de ayer a incidencia, lo avisado a entregada. */
  app.post('/admin/entregas/cerrar-dia', async (request, reply) => {
    // Un administrador del panel o una clave de API con permiso total: cerrar el dia tambien se automatiza.
    if (request.usuario?.rol !== 'admin') return reply.code(403).send({ error: 'Solo un administrador cierra el día.' });
    const body = z.object({ forzar: z.boolean().optional() }).parse(request.body ?? {});
    const r = await entregas.cerrarDia({ forzar: body.forzar ?? true, quien: quienEs(request.usuario) });
    return { ok: r.ok, motivo: r.motivo ?? null, resultado: r.resultado ?? null };
  });

  /**
   * La lista del dia pegada (Excel, CSV o lineas), sin GSG: varias entregas
   * de golpe en este sistema o, para probar, en el simulador de GSG.
   */
  app.post('/admin/entregas/cargar-lista', async (request, reply) => {
    const body = z
      .object({
        texto: z.string().min(1).max(200_000),
        faltaUbicacion: z.boolean().default(true),
        faltaConfirmacion: z.boolean().default(true),
        destino: z.enum(['sistema']).default('sistema'),
      })
      .parse(request.body ?? {});
    const lectura = entregas.leerListaPegada(body.texto);

    const r = await entregas.crearVarias(lectura.filas, quienEs(request.usuario), { faltaUbicacion: body.faltaUbicacion, faltaConfirmacion: body.faltaConfirmacion, descartadas: lectura.descartadas });
    return { ok: true, destino: 'sistema', creadas: r.creadas.length, referencias: r.creadas.map((e) => e.referencia), repetidas: r.repetidas, descartadas: r.descartadas, lote: r.lote };
  });

  /** Como queda un texto con una entrega de hoy (o una de ejemplo). */
  app.post('/admin/entregas/previsualizar', async (request, reply) => {
    const claves = Object.keys(ajustesEntregasSchema.shape.textos.removeDefault().shape);
    const body = z.object({ clave: z.string().min(1), texto: z.string().max(2000).default('') }).parse(request.body ?? {});
    if (!claves.includes(body.clave)) return reply.code(400).send({ error: 'Ese texto no existe.' });
    return { ok: true, texto: await entregas.previsualizar(body.clave as never, body.texto) };
  });

  app.post<{ Params: { id: string } }>('/admin/entregas/:id/reintentar', async (request, reply) => {
    const e = await entregas.reintentar(Number(request.params.id), quienEs(request.usuario));
    if (!e) return reply.code(404).send({ error: 'Esa entrega no existe.' });
    return { ok: true, entrega: e };
  });

  /** La segunda visita a mano: el cliente llamo y ya esta en casa; el motorizado vuelve a pasar. */


  app.post<{ Params: { id: string } }>('/admin/entregas/:id/prioridad', async (request, reply) => {
    const body = z.object({ urgente: z.boolean() }).parse(request.body ?? {});
    const e = await entregas.marcarPrioridad(Number(request.params.id), body.urgente, quienEs(request.usuario));
    if (!e) return reply.code(404).send({ error: 'Esa entrega no existe.' });
    return { ok: true, entrega: e };
  });

  // ------------------------------------------------------------------ GSG

  app.get('/admin/entregas/gsg', async () => ({ gsg: conexionGsg?.estado() ?? null, simulador: false }));

  app.post('/admin/entregas/gsg', async (request, reply) => {
    if (!conexionGsg) return reply.code(409).send({ error: 'En este arranque la conexión con GSG no se puede cambiar desde la pantalla.' });
    if (!soloAdmin(request)) return reply.code(403).send({ error: 'Solo un administrador cambia la conexión con GSG.' });
    const body = z.object({ modo: z.enum(['real']), url: z.string().trim().max(300).optional(), token: z.string().max(500).nullable().optional() }).parse(request.body ?? {});

    try {
      return { ok: true, gsg: await conexionGsg.conectarReal({ url: body.url ?? '', token: body.token }) };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete('/admin/entregas/gsg', async (request, reply) => {
    if (!conexionGsg) return reply.code(409).send({ error: 'En este arranque la conexión con GSG no se puede cambiar desde la pantalla.' });
    if (!soloAdmin(request)) return reply.code(403).send({ error: 'Solo un administrador cambia la conexión con GSG.' });
    return { ok: true, gsg: await conexionGsg.quitar() };
  });

  app.post('/admin/entregas/gsg/probar', async (request, reply) => {
    if (!conexionGsg) return reply.code(409).send({ error: 'En este arranque la conexión con GSG no se puede probar desde la pantalla.' });
    const body = z.object({ url: z.string().trim().max(300).optional(), token: z.string().max(500).optional() }).parse(request.body ?? {});
    const prueba = body.url ? await conexionGsg.probar({ url: body.url, token: body.token ?? '' }) : await conexionGsg.probar();
    return { ok: prueba.ok, prueba };
  });

  // ------------------------------------------------------------- API v1

  app.get('/api/v1/entregas', { config: { permiso: 'entregas:leer' } }, async () => {
    const r = await entregas.resumen();
    return { dia: r.dia, cifras: r.cifras, entregas: r.entregas.map((e) => ({ id: e.id, referencia: e.referencia, telefono: e.phone, nombre: e.nombre, estado: e.estado, situacion: e.situacion, ubicacion: e.ubicacionEstado, lat: e.lat, lng: e.lng, confirmacion: e.confirmacionEstado, motorizado: e.motorizado, minutosMotorizado: e.minutosMotorizado, minutosAviso: e.minutosAviso, llegaAproxEn: e.llegaAproxAt, avisadoEn: e.avisoEnviadoAt, prioridad: e.prioridad, segundaVisita: e.segundaVisita, visitas: e.visitas, entregadoEn: e.entregadaAt })), gsg: r.gsg ? { modo: r.gsg.modo, conectada: r.gsg.conectada } : null, ultimaSincronizacion: r.ultimaSincronizacion };
  });

  app.post('/api/v1/entregas/sincronizar', { config: { permiso: 'entregas:gestionar' } }, async () => entregas.sincronizar());




}
