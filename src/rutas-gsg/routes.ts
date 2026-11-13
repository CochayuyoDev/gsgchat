/**
 * El webhook de estados de rutas y lo que usa su pestaña en Nuestra API.
 *
 *   POST /api/v1/rutas/estado              ← el sistema de rutas de GSG (header x-webhook-secret)
 *   GET  /admin/rutas-webhook               ← la pestaña: direccion, secreto, rutas, bitacora
 *   POST /admin/rutas-webhook/secreto       ← un secreto nuevo (se ve una vez)
 *   POST /admin/rutas-webhook/probar        ← simular un aviso (cierra/abre de verdad, marcado «prueba»)
 *   POST /admin/rutas-webhook/reactivar     ← abrir a mano los chats de una ruta
 *
 * Ver src/rutas-gsg/servicio.ts para las reglas.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Repos } from '../db/repos.js';
import {
  ESTADOS_FINALES, ESTADOS_GSG, ESTADOS_QUE_CIERRAN, eventoParaPantalla, generarSecretoRutas, huellaSecreto, leerAvisos, secretoValido,
  type ServicioRutasGsg,
} from './servicio.js';

export const RUTA_WEBHOOK_RUTAS = '/api/v1/rutas/estado';
export const HEADER_SECRETO_RUTAS = 'x-webhook-secret';

export interface DepsRutasGsgRoutes {
  repos: Repos;
  servicio: ServicioRutasGsg;
  /** La direccion publica de esta tienda (con /tienda/<nombre> en la plataforma). */
  publicBase: string;
  ahora?: () => Date;
}

const error = (reply: FastifyReply, status: number, codigo: string, mensaje: string, detalles?: Array<{ campo: string; mensaje: string }>) =>
  reply.code(status).send({ ok: false, codigo, error: mensaje, ...(detalles ? { detalles } : {}) });

const esAdmin = (request: FastifyRequest) => Boolean(request.usuario && !request.usuario.porToken && request.usuario.rol === 'admin');

export async function registerRutasGsgRoutes(app: FastifyInstance, deps: DepsRutasGsgRoutes): Promise<void> {
  const { repos, servicio } = deps;
  const ahora = deps.ahora ?? (() => new Date());
  const url = () => `${deps.publicBase.replace(/\/+$/, '')}${RUTA_WEBHOOK_RUTAS}`;

  // ---- El webhook (sin clave de API: su llave es el secreto del header).
  app.post(RUTA_WEBHOOK_RUTAS, async (request, reply) => {
    const guardado = await repos.rutasGsg.secreto();
    if (!guardado) return error(reply, 503, 'SIN_CONFIGURAR', 'El webhook de rutas todavía no tiene secreto: genéralo en GSGchat → Nuestra API → Webhook de rutas.');
    const llegado = request.headers[HEADER_SECRETO_RUTAS];
    if (!secretoValido(Array.isArray(llegado) ? llegado[0] : llegado, guardado.hash)) {
      return error(reply, 401, 'SECRETO_INVALIDO', `Falta el secreto o no es el vigente: mándalo en el header «${HEADER_SECRETO_RUTAS}».`);
    }
    const leido = leerAvisos(request.body, ahora());
    if ('error' in leido) return error(reply, 400, 'VALIDACION', leido.error, [{ campo: leido.campo, mensaje: leido.error }]);
    // Se anota y se contesta al momento; el cierre/apertura de los chats va detras.
    const ids: number[] = [];
    for (const aviso of leido.avisos) {
      const r = await servicio.recibir(aviso);
      ids.push(r.id);
      void r.procesado;
    }
    return reply.code(202).send({
      ok: true,
      recibidos: ids.length,
      eventos: ids,
      detalle: `${ids.length === 1 ? 'Aviso recibido' : `${ids.length} avisos recibidos`}: se procesa${ids.length === 1 ? '' : 'n'} al momento. El resultado queda en GSGchat → Nuestra API → Webhook de rutas.`,
    });
  });

  // ---- La pestaña de Nuestra API.
  app.get('/admin/rutas-webhook', async (request, reply) => {
    if (!esAdmin(request)) return reply.code(403).send({ error: 'Solo un administrador ve el webhook de rutas.' });
    const [secreto, rutas, eventos] = await Promise.all([repos.rutasGsg.secreto(), repos.rutasGsg.rutas(200), repos.rutasGsg.eventos(50)]);
    return {
      url: url(),
      header: HEADER_SECRETO_RUTAS,
      secreto: secreto ? { configurado: true, ultimos: secreto.ultimos, creadoAt: secreto.creadoAt } : { configurado: false },
      estadosQueCierran: ESTADOS_QUE_CIERRAN,
      estadosFinales: ESTADOS_FINALES,
      estadosGsg: ESTADOS_GSG,
      rutas: rutas.map((r) => ({ ...r, rutaTexto: r.ruta })),
      eventos: eventos.map(eventoParaPantalla),
    };
  });

  app.post('/admin/rutas-webhook/secreto', async (request, reply) => {
    if (!esAdmin(request)) return reply.code(403).send({ error: 'Solo un administrador genera el secreto del webhook de rutas.' });
    const secreto = generarSecretoRutas();
    await repos.rutasGsg.guardarSecreto(huellaSecreto(secreto), secreto.slice(-4), ahora());
    return { ok: true, secreto, detalle: 'Cópialo ahora: no se vuelve a mostrar. El secreto anterior deja de valer en este momento.' };
  });

  app.post('/admin/rutas-webhook/probar', async (request, reply) => {
    if (!esAdmin(request)) return reply.code(403).send({ error: 'Solo un administrador prueba el webhook de rutas.' });
    const leido = leerAvisos(request.body, ahora());
    if ('error' in leido) return error(reply, 400, 'VALIDACION', leido.error, [{ campo: leido.campo, mensaje: leido.error }]);
    const resultados = [];
    for (const aviso of leido.avisos) {
      const r = await servicio.recibir(aviso, { prueba: true });
      resultados.push({ id: r.id, ...(await r.procesado) });
    }
    return { ok: true, resultados };
  });

  app.post('/admin/rutas-webhook/reactivar', async (request, reply) => {
    if (!esAdmin(request)) return reply.code(403).send({ error: 'Solo un administrador reactiva una ruta.' });
    const clave = String((request.body as { ruta?: unknown } | undefined)?.ruta ?? '').trim();
    if (!clave) return error(reply, 400, 'VALIDACION', 'Indica qué ruta reactivar.', [{ campo: 'ruta', mensaje: 'falta' }]);
    const ruta = await repos.rutasGsg.ruta(clave);
    if (!ruta) return error(reply, 404, 'NO_EXISTE', 'Esa ruta no está registrada.');
    // Un momento despues del ultimo cambio: un aviso viejo de GSG no la vuelve a cerrar.
    const fecha = new Date(Math.max(ahora().getTime(), ruta.cambiadoAt.getTime() + 1));
    const quien = (request.usuario?.nombre ?? 'una persona').slice(0, 30);
    const aviso = { ruta: clave, estado: `REACTIVADA A MANO (${quien})`, fecha };
    const r = await servicio.recibir(aviso, { prueba: false });
    return { ok: true, id: r.id, ...(await r.procesado) };
  });
}
