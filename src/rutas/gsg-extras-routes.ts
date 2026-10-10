/**
 * Las rutas de lo que rodea a GSG (ver gsg-extras.ts) y los dos ganchos:
 *
 *  - Un token caducable de los programadores de GSG vale para el simulador:
 *    antes de que el simulador mire la cabecera, se cambia por el token
 *    interno si el caducable está vigente. Como en la API real, la clave va
 *    en `X-API-Key`; un `Authorization: Bearer` solo no cuenta.
 *  - Cada llamada al simulador y a /api/v1/entregas queda en la bitácora
 *    (hora, ruta, resultado en palabras, con qué entró).
 *
 * Se cuelga desde registerWebRoutes con la conexión vigente.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RUTA_SIMULADOR, TOKEN_SIMULADOR, type ServicioConexionGsg } from './conexion-gsg.js';
import type { GsgSimulado } from '../entregas/gsg-simulado.js';
import { igualSeguro } from '../util/comparar.js';

export interface DepsGsgExtrasRoutes {
  conexion: ServicioConexionGsg;
  /** Para el cuadre: las entregas del día que figuran aquí (solo lectura). */
  entregasDelDia?: (dia: string) => Promise<Array<{ referencia: string; estado: string }>>;
  /** Si el simulador está montado en este arranque (para no ofrecer tokens de nada). */
  conSimulador: () => boolean;
  /** El simulador mismo, para los botones de prueba «Cancelar uno» / «Cambiar la dirección de uno». */
  simulador?: GsgSimulado;
}

type ConUsuario = FastifyRequest & { usuario?: { rol?: string; porToken?: boolean; nombre?: string } | null; gsgQuien?: string };

const soloAdmin = (request: ConUsuario) => request.usuario?.rol === 'admin' && !request.usuario.porToken;

/** Lo que se le dice de cada llamada según el HTTP y lo que se contestó. */
export function resultadoEnPalabras(status: number, cuerpo: unknown): string {
  const c = (cuerpo && typeof cuerpo === 'object' ? (cuerpo as Record<string, unknown>) : {}) as Record<string, unknown>;
  const error = typeof c.error === 'string' ? c.error : null;
  const detalle = typeof c.detalle === 'string' ? c.detalle : null;
  if (status === 401) return `rechazada: ${error ?? 'token inválido o caducado'}`;
  if (status === 403) return `rechazada: ${error ?? 'sin permiso'}`;
  if (status === 404) return `rechazada: ${error ?? 'ruta desconocida'}`;
  if (status === 409) return `rechazada: ${error ?? 'ya estaba cerrada'}`;
  if (status >= 400) return `rechazada: ${error ?? detalle ?? `error ${status}`}`;
  const cuenta = (x: unknown) => (Array.isArray(x) ? x.length : typeof x === 'number' ? x : null);
  if (cuenta(c.creadas) !== null) return `creados ${cuenta(c.creadas)}, repetidos ${cuenta(c.repetidas) ?? 0}, descartados ${cuenta(c.descartadas) ?? 0}`;
  if (detalle) return detalle;
  if (status === 201) return 'creado';
  return 'bien';
}

/** La clave de una llamada al simulador: solo la cabecera X-API-Key. */
const tokenDe = (valor: unknown): string | null => {
  const v = Array.isArray(valor) ? valor[0] : valor;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

export async function registerGsgExtrasRoutes(app: FastifyInstance, deps: DepsGsgExtrasRoutes): Promise<void> {
  const { conexion } = deps;
  const extras = conexion.extras;
  if (deps.entregasDelDia) extras.usarEntregas(deps.entregasDelDia);

  const esLlamadaDeGsg = (url: string) => url.startsWith(`${RUTA_SIMULADOR}/`) || url === RUTA_SIMULADOR || url.startsWith('/api/v1/entregas');

  // Gancho 1: el token caducable vale para el simulador.
  app.addHook('onRequest', async (request: ConUsuario, reply: FastifyReply) => {
    const url = request.url.split('?')[0] ?? request.url;
    if (!url.startsWith(RUTA_SIMULADOR)) return;
    const token = tokenDe(request.headers['x-api-key']);
    if (!token) {
      request.gsgQuien = 'sin X-API-Key';
      return;
    }
    if (igualSeguro(token, TOKEN_SIMULADOR)) {
      request.gsgQuien = 'este servidor';
      return;
    }
    if (token.startsWith('gsgsim_')) {
      const registro = await extras.resolverTokenSimulador(token);
      if (!registro) {
        request.gsgQuien = `token del simulador caducado o anulado (…${token.slice(-4)})`;
        await extras.anotarLlamada({ que: `${request.method} ${url}`, status: 401, resultado: 'rechazada: el token del simulador caducó o fue anulado. Pide uno nuevo en Conexión → Para los programadores de GSG.', quien: request.gsgQuien });
        return reply.code(401).send({ error: 'El token del simulador caducó o fue anulado. Pide uno nuevo a quien opera GSGchat (Conexión → Para los programadores de GSG).' });
      }
      request.gsgQuien = `token del simulador «${registro.nombre}»`;
      request.headers['x-api-key'] = TOKEN_SIMULADOR;
      return;
    }
    request.gsgQuien = `token desconocido (…${token.slice(-4)})`;
  });

  // Gancho 2: la bitacora de lo que GSG nos mando.
  app.addHook('onSend', async (request: ConUsuario, reply: FastifyReply, payload: unknown) => {
    const url = request.url.split('?')[0] ?? request.url;
    if (!esLlamadaDeGsg(url)) return payload;
    let cuerpo: unknown = null;
    if (typeof payload === 'string' && payload.length < 20_000) {
      try {
        cuerpo = JSON.parse(payload);
      } catch {
        cuerpo = null;
      }
    }
    const quien = request.gsgQuien ?? (request.usuario?.porToken ? `clave de API «${request.usuario.nombre ?? 'api'}»` : request.usuario ? `una persona (${request.usuario.nombre ?? ''})` : 'sin token');
    await extras.anotarLlamada({ que: `${request.method} ${url}`, status: reply.statusCode, resultado: resultadoEnPalabras(reply.statusCode, cuerpo), quien });
    return payload;
  });

  // ---------------------------------------------------------------- rutas

  app.get('/admin/gsg', async () => ({
    estado: conexion.estado(),
    descartes: extras.descartesDeHoy(),
    tokens: [],
    conSimulador: false,
    rutaSimulador: RUTA_SIMULADOR,
    bitacora: extras.bitacora(),
    verificacion: extras.ultimaVerificacion(),
    cuadre: extras.ultimoCuadre(),
  }));

  app.post('/admin/gsg/verificar-contrato', async (request: ConUsuario, reply) => {
    if (!soloAdmin(request)) return reply.code(403).send({ error: 'Solo un administrador verifica el contrato con GSG.' });
    const v = await extras.verificarContrato();
    return { ok: v.ok, verificacion: v };
  });

  app.get<{ Querystring: { dia?: string } }>('/admin/gsg/cuadre', async (request) => {
    const dia = typeof request.query?.dia === 'string' ? request.query.dia : undefined;
    return { cuadre: await extras.cuadrar(dia) };
  });
}
