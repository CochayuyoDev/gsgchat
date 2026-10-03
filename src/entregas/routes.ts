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
import { motorizadoPage } from '../web/motorizado-page.js';
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

  // «Probar el día entero»: las respuestas de clientes y motorizados entran
  // por el simulador de entrantes de la demostracion, con la sesion de quien
  // pulso el boton; fuera de la demostracion no existe y se dice por que.
  let cabecerasGuion: Record<string, string> = {};
  const hayEntrantes = () => app.hasRoute({ method: 'POST', url: '/admin/dev/inbound' });
  const inyectar = async (phone: string, contenido: EntranteSimulado, nombre?: string): Promise<boolean> => {
    if (!hayEntrantes()) return false;
    const r = await app.inject({ method: 'POST', url: '/admin/dev/inbound', headers: { ...cabecerasGuion, 'content-type': 'application/json' }, payload: { phone, name: nombre, ...contenido } });
    return r.statusCode < 400;
  };
  const despachar = async (): Promise<{ enviados: number; fallidos: number } | null> => {
    if (!app.hasRoute({ method: 'POST', url: '/admin/rutas/cola/despachar' })) return null;
    const r = await app.inject({ method: 'POST', url: '/admin/rutas/cola/despachar', headers: cabecerasGuion });
    if (r.statusCode >= 400) return null;
    const j = r.json() as { enviados?: number; fallidos?: number };
    return { enviados: j.enviados ?? 0, fallidos: j.fallidos ?? 0 };
  };
  const guion = simulador ? crearGuionDelDia({ entregas, simulador, conexionGsg, inyectar, despachar, log: (m, d) => app.log.warn(d ?? {}, m) }) : null;

  app.post('/admin/entregas/simulador/probar-dia', async (request, reply) => {
    if (!simulador || !guion) return reply.code(404).send({ error: 'El simulador de GSG no está montado en este arranque.' });
    // Un administrador del panel o una clave de API con permiso total (las pruebas automáticas).
    if (request.usuario?.rol !== 'admin') return reply.code(403).send({ error: 'Solo un administrador lanza el día de prueba.' });
    if (!hayEntrantes()) return reply.code(409).send({ error: 'Esta prueba automática solo funciona en la demostración (npm run demo), donde nadie recibe WhatsApp de verdad. Con el WhatsApp real usa «Modo prueba con mi número» y responde tú desde el teléfono.' });
    const body = z.object({ pausaMs: z.number().int().min(200).max(10_000).optional() }).parse(request.body ?? {});
    cabecerasGuion = { ...(request.headers.cookie ? { cookie: request.headers.cookie } : {}), ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}) };
    const r = guion.empezar(body);
    if (!r.ok) return reply.code(409).send({ error: r.motivo });
    return { ok: true, estado: guion.estado() };
  });
  app.get('/admin/entregas/simulador/probar-dia', async (_request, reply) => {
    if (!guion) return reply.code(404).send({ error: 'El simulador de GSG no está montado en este arranque.' });
    return guion.estado();
  });
  app.delete('/admin/entregas/simulador/probar-dia', async (_request, reply) => {
    if (!guion) return reply.code(404).send({ error: 'El simulador de GSG no está montado en este arranque.' });
    return { ok: guion.parar() };
  });
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

  app.post<{ Params: { id: string } }>('/admin/entregas/:id/reasignar', async (request, reply) => {
    const body = z.object({ motorizadoId: z.coerce.number().int().positive().nullable().optional() }).parse(request.body ?? {});
    const e = await entregas.reasignar(Number(request.params.id), body.motorizadoId ?? null, quienEs(request.usuario));
    if (!e) return reply.code(404).send({ error: 'Esa entrega no existe.' });
    if ('error' in e) return reply.code(400).send({ error: e.error });
    return { ok: true, entrega: e };
  });

  // «Asignar motorizado sin ubicación» (ficha de Hoy y Números del día): el
  // motorizado recibe el pedido con el teléfono y la dirección escrita, sin pin.
  app.post<{ Params: { id: string } }>('/admin/entregas/:id/sin-ubicacion', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isFinite(id) || id <= 0) return reply.code(400).send({ error: 'Falta el número del pedido.' });
    const body = z.object({ motorizadoId: z.coerce.number().int().positive().nullable().optional() }).safeParse(request.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'El motorizado elegido no se entiende: elige uno de la lista.' });
    const r = await entregas.asignarSinUbicacionAMano(id, body.data.motorizadoId ?? null, quienEs(request.usuario));
    if (!r.ok) return reply.code(r.motivo.startsWith('Ese pedido ya no existe') ? 404 : 400).send({ error: r.motivo });
    return { ok: true, entrega: r.entrega, motorizado: { id: r.motorizado.id, nombre: r.motorizado.nombre } };
  });

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
        destino: z.enum(['sistema', 'simulador']).default('sistema'),
      })
      .parse(request.body ?? {});
    const lectura = entregas.leerListaPegada(body.texto);
    if (body.destino === 'simulador') {
      if (!simulador) return reply.code(404).send({ error: 'El simulador de GSG no está montado en este arranque.' });
      const clientes = lectura.filas.map((f, i) => ({
        referencia: (f.referencia ?? '').trim() || `S/N-${String(f.telefono).replace(/\D/g, '').slice(-9) || i + 1}`,
        telefono: f.telefono,
        nombre: f.nombre,
        direccion: f.direccion,
        distrito: f.distrito,
        notas: f.notas,
        faltaUbicacion: f.faltaUbicacion ?? body.faltaUbicacion,
        faltaConfirmacion: f.faltaConfirmacion ?? body.faltaConfirmacion,
      }));
      const nuevos = clientes.length ? simulador.cargar(clientes as never) : 0;
      return { ok: true, destino: 'simulador', creadas: nuevos, repetidas: Math.max(0, clientes.length - nuevos), descartadas: lectura.descartadas, lote: null, estado: simulador.estado() };
    }
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
  app.post<{ Params: { id: string } }>('/admin/entregas/:id/segunda-visita', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'Falta el número de la entrega.' });
    const r = await entregas.segundaVisitaAMano(id, quienEs(request.usuario));
    if (!r.ok) return reply.code(400).send({ error: r.motivo });
    return { ok: true, entrega: r.entrega };
  });

  app.post<{ Params: { id: string } }>('/admin/entregas/:id/prioridad', async (request, reply) => {
    const body = z.object({ urgente: z.boolean() }).parse(request.body ?? {});
    const e = await entregas.marcarPrioridad(Number(request.params.id), body.urgente, quienEs(request.usuario));
    if (!e) return reply.code(404).send({ error: 'Esa entrega no existe.' });
    return { ok: true, entrega: e };
  });

  // ------------------------------------------------------------ motorizados

  const motorizadoSchema = z.object({
    telefono: z.string().trim().min(6).max(20),
    nombre: z.string().trim().min(1).max(120),
    placa: z.string().trim().max(20).optional().nullable(),
    zona: z.string().trim().max(300).optional().nullable(),
    estado: z.enum(['activo', 'descanso', 'baja']).optional(),
  });

  app.get('/admin/motorizados', async () => ({ motorizados: await entregas.motorizados() }));

  app.post('/admin/motorizados', async (request, reply) => {
    const body = motorizadoSchema.parse(request.body ?? {});
    const r = await entregas.crearMotorizado({ phone: body.telefono, nombre: body.nombre, placa: body.placa ?? null, zona: body.zona ?? null, estado: body.estado });
    if (!r.ok) return reply.code(400).send({ error: r.motivo });
    return { ok: true, motorizado: r.motorizado, nuevo: r.nuevo };
  });

  // Varios de golpe: el texto pegado de una hoja o un chat, una linea por motorizado.
  app.post('/admin/motorizados/lote', async (request, reply) => {
    const body = z.object({ texto: z.string().max(200_000) }).parse(request.body ?? {});
    if (!body.texto.trim()) return reply.code(400).send({ error: 'Pega la lista: una línea por motorizado con su nombre, su WhatsApp y, si quieres, la placa y la zona.' });
    const r = await entregas.crearMotorizadosDesdeTexto(body.texto);
    return { ok: true, ...r, motorizados: await entregas.motorizados() };
  });

  app.post('/admin/motorizados/de-prueba', async () => {
    let nuevos = 0;
    for (const m of MOTORIZADOS_DE_PRUEBA) {
      const r = await entregas.crearMotorizado({ phone: m.telefono, nombre: m.nombre, placa: m.placa, zona: m.zona });
      if (r.ok && r.nuevo) nuevos++;
    }
    return { ok: true, nuevos, motorizados: await entregas.motorizados() };
  });

  app.post<{ Params: { id: string } }>('/admin/motorizados/:id', async (request, reply) => {
    const body = motorizadoSchema.partial().parse(request.body ?? {});
    const m = await entregas.editarMotorizado(Number(request.params.id), { nombre: body.nombre, placa: body.placa, zona: body.zona, estado: body.estado });
    if (!m) return reply.code(404).send({ error: 'Ese motorizado no existe.' });
    return { ok: true, motorizado: m };
  });

  app.delete<{ Params: { id: string } }>('/admin/motorizados/:id', async (request, reply) => {
    const m = await entregas.quitarMotorizado(Number(request.params.id));
    if (!m) return reply.code(404).send({ error: 'Ese motorizado no existe.' });
    return { ok: true, motorizado: m };
  });

  app.get<{ Params: { id: string } }>('/admin/motorizados/:id/ruta', async (request, reply) => {
    const ruta = await entregas.rutaDeMotorizado(Number(request.params.id));
    if (!ruta) return reply.code(404).send({ error: 'Ese motorizado no existe.' });
    return { ok: true, ruta };
  });

  app.post<{ Params: { id: string } }>('/admin/motorizados/:id/ruta/mandar', async (request, reply) => {
    const r = await entregas.mandarRuta(Number(request.params.id), quienEs(request.usuario));
    if (!r.ok) return reply.code(r.ruta ? 400 : 404).send({ error: r.motivo ?? 'No se pudo mandar la ruta.' });
    return { ok: true, ruta: r.ruta };
  });

  // El enlace del motorizado (su pagina sin instalar nada): crear/renovar y mandarselo.
  app.post<{ Params: { id: string } }>('/admin/motorizados/:id/enlace', async (request, reply) => {
    const body = z.object({ mandar: z.boolean().default(true) }).parse(request.body ?? {});
    const r = await entregas.crearEnlaceMotorizado(Number(request.params.id), { mandar: body.mandar, quien: quienEs(request.usuario) });
    if (!r.ok) return reply.code(400).send({ error: r.motivo });
    return { ok: true, url: r.url, venceAt: r.venceAt, enviado: r.enviado, ...(r.motivo ? { motivo: r.motivo } : {}) };
  });

  // ------------------------------------ la pagina del motorizado (publica, con token)

  const tokenLimpio = (t: string): string => String(t ?? '').trim().slice(0, 80);
  app.get<{ Params: { token: string } }>('/m/:token', async (request, reply) => {
    const html = motorizadoPage({ token: tokenLimpio(request.params.token), nombreNegocio: entregas.nombreNegocio?.() ?? 'GSGchat' });
    return reply.type('text/html; charset=utf-8').header('cache-control', 'no-store').header('x-robots-tag', 'noindex').send(html);
  });
  app.get<{ Params: { token: string } }>('/m/:token/datos', async (request, reply) => {
    const r = await entregas.paginaDeMotorizado(tokenLimpio(request.params.token));
    if (!r.ok) return reply.code(404).send({ ok: false, error: r.motivo });
    return r;
  });
  app.post<{ Params: { token: string } }>('/m/:token/accion', async (request, reply) => {
    const body = z.object({ accion: z.enum(['minutos', 'cerca', 'entregado', 'no_estaba', 'no_puedo']), referencia: z.string().trim().min(1).max(60), minutos: z.coerce.number().optional() }).parse(request.body ?? {});
    const r = await entregas.accionDesdeEnlace(tokenLimpio(request.params.token), body.accion, { referencia: body.referencia, minutos: body.minutos });
    if (!r.ok) return reply.code(400).send({ ok: false, error: r.motivo });
    return r;
  });

  app.post<{ Params: { id: string } }>('/admin/motorizados/:id/traspasar', async (request, reply) => {
    const body = z.object({ motorizadoId: z.coerce.number().int().positive().nullable().optional(), descanso: z.boolean().default(false), motivo: z.string().trim().max(200).optional() }).parse(request.body ?? {});
    const r = await entregas.traspasarPedidos(Number(request.params.id), { destino: body.motorizadoId ?? null, descanso: body.descanso, quien: quienEs(request.usuario), motivo: body.motivo });
    if (!r.ok) return reply.code(400).send({ error: r.motivo });
    return { ok: true, ...r.resultado };
  });

  // ------------------------------------------------------------------ GSG

  app.get('/admin/entregas/gsg', async () => ({ gsg: conexionGsg?.estado() ?? null, simulador: Boolean(simulador) }));

  app.post('/admin/entregas/gsg', async (request, reply) => {
    if (!conexionGsg) return reply.code(409).send({ error: 'En este arranque la conexión con GSG no se puede cambiar desde la pantalla.' });
    if (!soloAdmin(request)) return reply.code(403).send({ error: 'Solo un administrador cambia la conexión con GSG.' });
    const body = z.object({ modo: z.enum(['real', 'simulador']), url: z.string().trim().max(300).optional(), token: z.string().max(500).nullable().optional() }).parse(request.body ?? {});
    if (body.modo === 'simulador') {
      if (!simulador) return reply.code(409).send({ error: 'El simulador de GSG no está montado en este arranque.' });
      return { ok: true, gsg: await conexionGsg.usarSimulador() };
    }
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

  // ------------------------------------------------------------ simulador

  app.get('/admin/entregas/simulador', async (_request, reply) => {
    if (!simulador) return reply.code(404).send({ error: 'El simulador de GSG no está montado en este arranque.' });
    return { estado: simulador.estado(), pendientes: simulador.pendientes(), recibido: simulador.recibido.slice(-50), modo: simulador.modo };
  });

  app.post('/admin/entregas/simulador/cargar', async (_request, reply) => {
    if (!simulador) return reply.code(404).send({ error: 'El simulador de GSG no está montado en este arranque.' });
    const nuevos = simulador.cargarDePrueba();
    return { ok: true, nuevos, estado: simulador.estado() };
  });

  app.post('/admin/entregas/simulador/cargar-lista', async (request, reply) => {
    if (!simulador) return reply.code(404).send({ error: 'El simulador de GSG no está montado en este arranque.' });
    const body = z.object({ clientes: z.array(z.object({ referencia: z.string().min(1), telefono: z.string().min(6) }).passthrough()).min(1).max(500) }).parse(request.body ?? {});
    const nuevos = simulador.cargar(body.clientes as never);
    return { ok: true, nuevos, estado: simulador.estado() };
  });

  app.post('/admin/entregas/simulador/modo', async (request, reply) => {
    if (!simulador) return reply.code(404).send({ error: 'El simulador de GSG no está montado en este arranque.' });
    const body = z.object({ modo: z.enum(['ok', 'caido', 'rechaza']) }).parse(request.body ?? {});
    simulador.modo = body.modo;
    return { ok: true, modo: simulador.modo };
  });

  app.delete('/admin/entregas/simulador', async (_request, reply) => {
    if (!simulador) return reply.code(404).send({ error: 'El simulador de GSG no está montado en este arranque.' });
    simulador.reiniciar();
    return { ok: true, estado: simulador.estado() };
  });

  // ------------------------------------------------------------- API v1

  app.get('/api/v1/entregas', { config: { permiso: 'entregas:leer' } }, async () => {
    const r = await entregas.resumen();
    return { dia: r.dia, cifras: r.cifras, entregas: r.entregas.map((e) => ({ id: e.id, referencia: e.referencia, telefono: e.phone, nombre: e.nombre, estado: e.estado, situacion: e.situacion, ubicacion: e.ubicacionEstado, lat: e.lat, lng: e.lng, confirmacion: e.confirmacionEstado, motorizado: e.motorizado, minutosMotorizado: e.minutosMotorizado, minutosAviso: e.minutosAviso, llegaAproxEn: e.llegaAproxAt, avisadoEn: e.avisoEnviadoAt, prioridad: e.prioridad, segundaVisita: e.segundaVisita, visitas: e.visitas, entregadoEn: e.entregadaAt })), gsg: r.gsg ? { modo: r.gsg.modo, conectada: r.gsg.conectada } : null, ultimaSincronizacion: r.ultimaSincronizacion };
  });

  app.post('/api/v1/entregas/sincronizar', { config: { permiso: 'entregas:gestionar' } }, async () => entregas.sincronizar());

  app.get('/api/v1/motorizados', { config: { permiso: 'entregas:leer' } }, async () => ({ motorizados: await entregas.motorizados() }));

  app.post('/api/v1/motorizados', { config: { permiso: 'entregas:gestionar' } }, async (request, reply) => {
    const body = motorizadoSchema.parse(request.body ?? {});
    const r = await entregas.crearMotorizado({ phone: body.telefono, nombre: body.nombre, placa: body.placa ?? null, zona: body.zona ?? null, estado: body.estado });
    if (!r.ok) return reply.code(400).send({ error: r.motivo });
    return { ok: true, motorizado: r.motorizado, nuevo: r.nuevo };
  });
}
