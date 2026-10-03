/**
 * «¿Está listo para GSG?»: el contrato entero, recorrido de verdad.
 *
 * La REGLA DE CONEXION es que GSG y GSGchat solo se hablan por API REST con
 * token, en las dos direcciones. Aqui se prueba cada una:
 *
 *  1. GSG → GSGchat: cada ruta de /api/v1 que usara GSG, con casos buenos y
 *     malos, llamando a la API DE ESTA TIENDA por dentro (app.inject), con
 *     claves temporales que se crean para la prueba y se borran al final.
 *     Los pedidos usan referencias PRUEBA-LISTO-… y numeros del rango
 *     reservado (numeros.ts): no salen al WhatsApp real, y todo se borra.
 *  2. GSGchat → GSG: los reportes (ubicacion, confirmacion, entrega,
 *     incidencia) salen por el MISMO codigo que en produccion (el puerto HTTP
 *     y el despachador de la cola) hacia un simulador de GSG PRIVADO de esta
 *     comprobacion, con sus modos ok / caido / rechaza / sin red. Ni la
 *     conexion de la tienda ni su cola ni su simulador se tocan: la conexion
 *     queda exactamente como estaba, y la API real de GSG no se llama nunca.
 *  3. Webhooks entrega.*: formato, firma y que se reintenta y que no.
 *  4. El contrato escrito contra el codigo, campo por campo (contrato.ts), y
 *     que la descarga del panel es ese mismo documento.
 */

import { randomBytes } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { Repos } from '../db/repos.js';
import type { RutasRepo, Reporte, TipoReporte } from '../db/rutas.js';
import { generarClaveApi, hashClaveApi, prefijoDeClave } from '../auth/claves-api.js';
import { crearGsgSimulado, type GsgSimulado } from '../entregas/gsg-simulado.js';
import { crearPuertoHttp, despacharReportes, payloadConfirmacion, payloadEntrega, payloadIncidencia, payloadUbicacion, type PuertoGsg } from '../rutas/gsg.js';
import { entregarUna } from '../webhooks/despachador.js';
import { generarSecretoWebhook, verificarFirma } from '../webhooks/firma.js';
import type { WebhookConSecreto } from '../webhooks/repo.js';
import { compararContrato, leerContrato } from './contrato.js';
import { numeroDePrueba } from './numeros.js';
import type { Lote, Solicitud } from '../db/rutas.js';

export type GrupoComprobacion = 'gsg_a_gsgchat' | 'gsgchat_a_gsg' | 'webhooks' | 'contrato';

export interface Comprobacion {
  id: string;
  grupo: GrupoComprobacion;
  titulo: string;
  ok: boolean;
  /** Que se comprobo y que paso, en palabras. */
  explicacion: string;
  /** Si fallo: que hacer. */
  queHacer?: string;
  /** La peticion y la respuesta, para «Ver lo técnico». */
  tecnico?: { peticion?: unknown; respuesta?: unknown };
}

export interface ResultadoRecorrido {
  listo: boolean;
  titular: string;
  /** Lo que falla, en una linea cada cosa. */
  faltan: string[];
  grupos: Array<{ id: GrupoComprobacion; titulo: string; ok: boolean; comprobaciones: Comprobacion[] }>;
  total: number;
  bien: number;
  duracionMs: number;
  en: string;
  /** Lo que se borro al final (pedidos, claves...). */
  limpieza: string;
}

export interface DepsRecorrido {
  app: FastifyInstance;
  repos: Repos;
  /** Si las entregas del dia estan montadas (sin ellas no hay /api/v1/entregas). */
  hayEntregas: boolean;
  /** Cabecera cookie de quien pulsa (para bajar el contrato como lo baja el panel). */
  cookie?: string;
  ahora?: () => Date;
  /** Solo para las pruebas: un simulador de GSG a medida (p. ej. uno que rechaza todo). */
  simuladorDePrueba?: GsgSimulado;
}

export const TITULOS_GRUPO: Record<GrupoComprobacion, string> = {
  gsg_a_gsgchat: 'GSG → GSGchat: lo que GSG nos manda por la API',
  gsgchat_a_gsg: 'GSGchat → GSG: los reportes que le mandamos',
  webhooks: 'Avisos a GSG (webhooks entrega.*)',
  contrato: 'El contrato escrito, campo por campo',
};

const TOKEN_SIMULADOR_PRIVADO = 'comprobacion-listo';

type Respuesta = { status: number; cuerpo: unknown; cabeceras: Record<string, unknown> };

function leerRespuesta(r: LightMyRequestResponse): Respuesta {
  let cuerpo: unknown = r.body;
  try {
    cuerpo = r.body ? JSON.parse(r.body) : null;
  } catch {
    // no era JSON: se deja el texto
  }
  return { status: r.statusCode, cuerpo, cabeceras: r.headers as Record<string, unknown> };
}

/** El fetch del puerto HTTP de produccion, contestado por un simulador privado. */
function fetchHaciaSimulador(sim: GsgSimulado): typeof fetch {
  return (async (entrada: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (sim.modo === 'sin_red') throw new TypeError('fetch failed: getaddrinfo ENOTFOUND api.gsg.pe');
    const url = new URL(typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url);
    const auth = new Headers(init?.headers).get('authorization');
    let cuerpo: unknown = null;
    try {
      cuerpo = init?.body ? JSON.parse(String(init.body)) : null;
    } catch {
      cuerpo = init?.body ?? null;
    }
    const r = sim.atender(init?.method ?? 'GET', url.pathname, auth?.startsWith('Bearer ') ? auth.slice(7) : null, cuerpo);
    const esTexto = typeof r.body === 'string';
    return new Response(esTexto ? (r.body as string) : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': esTexto ? 'text/html' : 'application/json' } });
  }) as typeof fetch;
}

/** Una cola de reportes en memoria con la forma de la de la base: la usa el despachador de siempre. */
function colaEnMemoria() {
  const filas: Reporte[] = [];
  let id = 0;
  const rutas = {
    async reportesPendientes(limite: number) {
      return filas.filter((f) => f.estado === 'pendiente').slice(0, limite).map((f) => ({ ...f }));
    },
    async marcarReporte(rid: number, estado: Reporte['estado'], extra?: { error?: string | null; externoId?: string | null }) {
      const f = filas.find((x) => x.id === rid);
      if (!f) return;
      f.estado = estado;
      f.intentos += 1;
      if (extra?.error !== undefined) f.ultimoError = extra.error ?? null;
      if (extra?.externoId !== undefined) f.externoId = extra.externoId ?? null;
      if (estado === 'enviado') f.enviadoAt = new Date();
    },
  } as unknown as RutasRepo;
  return {
    rutas,
    filas,
    encolar(tipo: TipoReporte, payload: Record<string, unknown>): Reporte {
      const f: Reporte = { id: ++id, solicitudId: null, loteId: null, tipo, payload, estado: 'pendiente', intentos: 0, ultimoError: null, externoId: null, enviadoAt: null, createdAt: new Date() };
      filas.push(f);
      return f;
    },
  };
}

export async function recorrerContrato(deps: DepsRecorrido): Promise<ResultadoRecorrido> {
  const t0 = Date.now();
  const ahora = deps.ahora ?? (() => new Date());
  const sello = randomBytes(3).toString('hex').toUpperCase();
  const pref = `PRUEBA-LISTO-${sello}`;
  const base = 95_000 + Math.floor(Math.random() * 4_000);
  const telA = numeroDePrueba('cliente', base);
  const telB = numeroDePrueba('cliente', base + 1);
  const refA = `${pref}-1`;
  const refB = `${pref}-2`;
  const refC = `${pref}-3`;
  const lista: Comprobacion[] = [];
  const poner = (c: Comprobacion) => lista.push(c);

  // --- claves temporales -----------------------------------------------------
  const clavesCreadas: string[] = [];
  const nuevaClave = async (nombre: string, permisos: string[]) => {
    const clave = generarClaveApi();
    const r = await deps.repos.claves.crear({ nombre: `Comprobación GSG (temporal) · ${nombre}`, prefijo: prefijoDeClave(clave), hash: hashClaveApi(clave), creadaPor: null, permisos });
    clavesCreadas.push(r.id);
    return { clave, id: r.id };
  };

  const llamar = async (metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, opts: { clave?: string | null; cuerpo?: unknown; crudo?: string } = {}) => {
    const headers: Record<string, string> = {};
    if (opts.clave) headers.authorization = `Bearer ${opts.clave}`;
    if (opts.cuerpo !== undefined || opts.crudo !== undefined) headers['content-type'] = 'application/json';
    const r = await deps.app.inject({ method: metodo, url, headers, payload: opts.crudo ?? (opts.cuerpo === undefined ? undefined : JSON.stringify(opts.cuerpo)), remoteAddress: '127.0.0.9' });
    const respuesta = leerRespuesta(r);
    const peticion = { metodo, ruta: url, clave: opts.clave ? 'Bearer wak_… (clave temporal de la comprobación)' : 'sin clave', cuerpo: opts.crudo ?? opts.cuerpo };
    return { ...respuesta, tecnico: { peticion, respuesta: { status: respuesta.status, cuerpo: respuesta.cuerpo } } };
  };

  let limpieza = '';
  try {
    // =================================================== 1. GSG → GSGchat
    if (!deps.hayEntregas) {
      poner({ id: 'api_montada', grupo: 'gsg_a_gsgchat', titulo: 'La API de pedidos está activa', ok: false, explicacion: 'Las entregas del día no están activas en este arranque: GSG no tendría dónde mandar sus pedidos.', queHacer: 'Arranca el sistema normal (npm run quick o npm start), no la demostración.' });
    } else {
      const completa = await nuevaClave('completa', ['entregas:gestionar', 'entregas:leer', 'webhooks:gestionar']);
      const soloLeer = await nuevaClave('solo leer', ['entregas:leer']);
      const revocada = await nuevaClave('revocada', ['entregas:gestionar', 'entregas:leer']);
      await deps.repos.claves.revocar(revocada.id);
      const paraTope = await nuevaClave('límite', ['entregas:leer']);

      // Lo que GSG manda siempre (obligatorio en el contrato): tracking, cliente, telefono, empresa, metodoPago y montoCobrar.
      const obligatorios = { empresa: { codigo: 'PRB', nombre: 'Tienda de prueba' }, metodoPago: 'Contraentrega', montoCobrar: 45.5 };
      const valido = [
        { ...obligatorios, referencia: refA, telefono: telA, nombre: 'Rosa Quispe (prueba)', direccion: 'Av. Larco 345', distrito: 'Miraflores', faltaUbicacion: true, faltaConfirmar: true },
        { ...obligatorios, referencia: refB, telefono: telB, nombre: 'Luis Huamán (prueba)', direccion: 'Jr. Unión 55', distrito: 'Cercado de Lima', lat: -12.0464, lng: -77.0308, faltaConfirmar: true },
      ];

      let r = await llamar('POST', '/api/v1/entregas', { cuerpo: { pedidos: valido } });
      poner({ id: 'sin_clave', grupo: 'gsg_a_gsgchat', titulo: 'Sin clave no entra nadie', ok: r.status === 401, explicacion: r.status === 401 ? 'Un pedido sin clave se rechaza (401) y no crea nada.' : `Un pedido sin clave respondió ${r.status}: cualquiera podría meter pedidos.`, queHacer: r.status === 401 ? undefined : 'Revisa la puerta de /api en src/auth/routes.ts.', tecnico: r.tecnico });

      r = await llamar('POST', '/api/v1/entregas', { clave: revocada.clave, cuerpo: { pedidos: valido } });
      poner({ id: 'clave_revocada', grupo: 'gsg_a_gsgchat', titulo: 'Una clave revocada deja de valer al instante', ok: r.status === 401, explicacion: r.status === 401 ? 'Con una clave revocada la API responde 401.' : `Con una clave revocada respondió ${r.status}.`, queHacer: r.status === 401 ? undefined : 'Una clave revocada tiene que dejar de entrar: revisa claves_api.', tecnico: r.tecnico });

      r = await llamar('POST', '/api/v1/entregas', { clave: soloLeer.clave, cuerpo: { pedidos: valido } });
      poner({ id: 'permiso_faltante', grupo: 'gsg_a_gsgchat', titulo: 'Una clave sin permiso para crear no crea', ok: r.status === 403, explicacion: r.status === 403 ? 'Una clave que solo puede leer recibe 403 al intentar crear pedidos, con el permiso que le falta en palabras.' : `Una clave de solo lectura respondió ${r.status} al crear.`, tecnico: r.tecnico });

      r = await llamar('POST', '/api/v1/entregas', { clave: completa.clave, crudo: '{"pedidos": [ {"referencia": "X"' });
      poner({ id: 'json_roto', grupo: 'gsg_a_gsgchat', titulo: 'Un JSON mal formado se explica', ok: r.status === 400 && typeof (r.cuerpo as { error?: unknown })?.error === 'string', explicacion: r.status === 400 ? 'Un cuerpo que no es JSON responde 400 con el motivo, sin tumbar nada.' : `Un JSON roto respondió ${r.status}.`, tecnico: r.tecnico });

      r = await llamar('POST', '/api/v1/entregas', { clave: completa.clave, cuerpo: { pedidos: [] } });
      poner({ id: 'lista_vacia', grupo: 'gsg_a_gsgchat', titulo: 'Una lista vacía no crea nada y lo dice', ok: r.status === 400, explicacion: r.status === 400 ? 'Una lista vacía responde 400 («Manda un pedido…»).' : `Una lista vacía respondió ${r.status}.`, tecnico: r.tecnico });

      r = await llamar('POST', '/api/v1/entregas', { clave: completa.clave, cuerpo: { pedidos: [{ ...obligatorios, telefono: telA, nombre: 'Sin referencia' }] } });
      const errFalta = String((r.cuerpo as { error?: string })?.error ?? '');
      poner({ id: 'campo_faltante', grupo: 'gsg_a_gsgchat', titulo: 'Un pedido sin referencia se rechaza diciendo qué falta', ok: r.status === 400 && /tracking/i.test(errFalta), explicacion: r.status === 400 ? `Responde 400: «${errFalta}».` : `Un pedido sin referencia respondió ${r.status}.`, tecnico: r.tecnico });

      r = await llamar('POST', '/api/v1/entregas', { clave: completa.clave, cuerpo: { pedidos: [...valido, { ...obligatorios, referencia: refC, telefono: '12', nombre: 'Teléfono malo (prueba)' }] } });
      const alta = (r.cuerpo ?? {}) as { creadas?: Array<{ referencia: string; estado: string }>; descartadas?: Array<{ referencia: string; motivo: string }>; repetidas?: string[] };
      const creadas = alta.creadas ?? [];
      const okCrear = r.status === 201 && creadas.some((c) => c.referencia === refA) && creadas.some((c) => c.referencia === refB);
      const estadoA = creadas.find((c) => c.referencia === refA)?.estado;
      const estadoB = creadas.find((c) => c.referencia === refB)?.estado;
      poner({ id: 'crear', grupo: 'gsg_a_gsgchat', titulo: 'Crear pedidos (con y sin ubicación)', ok: okCrear && estadoA === 'esperando_ubicacion' && estadoB === 'esperando_confirmacion', explicacion: okCrear ? `201: entran los dos. El que llega sin pin queda «${estadoA}» (se le pedirá la ubicación) y el que trae lat/lng queda «${estadoB}» (solo falta que confirme).` : `Crear respondió ${r.status}: ${String((r.cuerpo as { error?: string })?.error ?? JSON.stringify(r.cuerpo)).slice(0, 200)}.`, tecnico: r.tecnico });
      const descartada = (alta.descartadas ?? []).find((d) => d.referencia === refC);
      poner({ id: 'telefono_invalido', grupo: 'gsg_a_gsgchat', titulo: 'Un teléfono inválido descarta ese pedido, no la llamada entera', ok: Boolean(descartada) && okCrear, explicacion: descartada ? `El pedido con teléfono «12» va en «descartadas» con su motivo («${descartada.motivo}») y los demás entran igual.` : 'El pedido con teléfono inválido no aparece en «descartadas».', tecnico: r.tecnico });

      r = await llamar('POST', '/api/v1/entregas', { clave: completa.clave, cuerpo: { pedidos: valido } });
      const rep = ((r.cuerpo ?? {}) as { repetidas?: string[]; creadas?: unknown[] });
      const lista1 = await llamar('GET', '/api/v1/entregas', { clave: soloLeer.clave });
      const cuantasA = (((lista1.cuerpo ?? {}) as { entregas?: Array<{ referencia: string }> }).entregas ?? []).filter((e) => e.referencia === refA).length;
      const okIdem = r.status === 200 && (rep.repetidas ?? []).includes(refA) && (rep.repetidas ?? []).includes(refB) && (rep.creadas ?? []).length === 0 && cuantasA === 1;
      poner({ id: 'idempotencia', grupo: 'gsg_a_gsgchat', titulo: 'Mandar el mismo pedido dos veces no lo duplica', ok: okIdem, explicacion: okIdem ? 'El segundo envío responde 200 con los dos en «repetidas» y en la lista del día el pedido sigue siendo uno.' : `El segundo envío respondió ${r.status} y el pedido aparece ${cuantasA} vez/veces en la lista.`, tecnico: r.tecnico });

      r = await llamar('GET', `/api/v1/entregas/${encodeURIComponent(refA)}`, { clave: soloLeer.clave });
      const ent = ((r.cuerpo ?? {}) as { entrega?: Record<string, unknown>; eventos?: unknown[] });
      const camposB2 = ['referencia', 'estado', 'situacion', 'prioridad', 'ubicacion', 'confirmacion', 'motorizado', 'minutosMotorizado', 'minutosAviso', 'llegaAproxEn', 'avisadaEn', 'entregadaEn', 'entregadaComo', 'incidencia'];
      const faltanB2 = camposB2.filter((c) => !ent.entrega || !(c in ent.entrega));
      poner({ id: 'consultar', grupo: 'gsg_a_gsgchat', titulo: 'Consultar cómo va un pedido', ok: r.status === 200 && !faltanB2.length && Array.isArray(ent.eventos), explicacion: r.status === 200 ? (faltanB2.length ? `Responde pero le faltan campos del contrato: ${faltanB2.join(', ')}.` : `200 con el pedido («${String(ent.entrega?.situacion ?? '')}») y su bitácora (${ent.eventos?.length ?? 0} eventos).`) : `Consultar respondió ${r.status}.`, tecnico: r.tecnico });

      r = await llamar('GET', `/api/v1/entregas/${encodeURIComponent(`${pref}-NO-EXISTE`)}`, { clave: soloLeer.clave });
      poner({ id: 'no_existe', grupo: 'gsg_a_gsgchat', titulo: 'Un pedido que no existe da 404 con el motivo', ok: r.status === 404, explicacion: r.status === 404 ? 'Responde 404 («No hay ningún pedido de hoy con la referencia…»).' : `Respondió ${r.status}.`, tecnico: r.tecnico });

      const okLista = lista1.status === 200 && cuantasA === 1;
      poner({ id: 'lista_del_dia', grupo: 'gsg_a_gsgchat', titulo: 'La lista del día', ok: okLista, explicacion: okLista ? 'GET /api/v1/entregas devuelve el día con sus cifras, y el pedido de la prueba está dentro.' : `La lista respondió ${lista1.status}.`, tecnico: lista1.tecnico });

      r = await llamar('PATCH', `/api/v1/entregas/${encodeURIComponent(refA)}`, { clave: completa.clave, cuerpo: { direccion: 'Av. Prueba 123', distrito: 'San Isidro', urgente: true } });
      const cam = ((r.cuerpo ?? {}) as { cambios?: string[]; entrega?: Record<string, unknown> });
      const okCambio = r.status === 200 && (cam.cambios ?? []).length === 3 && cam.entrega?.direccion === 'Av. Prueba 123' && cam.entrega?.prioridad === 'urgente';
      poner({ id: 'cambiar', grupo: 'gsg_a_gsgchat', titulo: 'Cambiar datos de un pedido ya mandado', ok: okCambio, explicacion: okCambio ? `200: ${(cam.cambios ?? []).join('; ')}. Queda apuntado en la bitácora del pedido.` : `Cambiar respondió ${r.status}: ${JSON.stringify(r.cuerpo).slice(0, 200)}.`, tecnico: r.tecnico });

      r = await llamar('PATCH', `/api/v1/entregas/${encodeURIComponent(refA)}`, { clave: completa.clave, cuerpo: { telefono: numeroDePrueba('cliente', base + 2) } });
      poner({ id: 'cambiar_telefono', grupo: 'gsg_a_gsgchat', titulo: 'El teléfono no se cambia (es otro pedido)', ok: r.status === 400, explicacion: r.status === 400 ? 'Responde 400 y explica que hay que cancelar y crear de nuevo.' : `Respondió ${r.status}.`, tecnico: r.tecnico });

      r = await llamar('DELETE', `/api/v1/entregas/${encodeURIComponent(refB)}?motivo=${encodeURIComponent('prueba de cancelación')}`, { clave: completa.clave });
      const canc = ((r.cuerpo ?? {}) as { entrega?: { estado?: string } });
      poner({ id: 'cancelar', grupo: 'gsg_a_gsgchat', titulo: 'Cancelar un pedido', ok: r.status === 200 && canc.entrega?.estado === 'cancelada', explicacion: r.status === 200 ? `200: el pedido queda «${canc.entrega?.estado}» y al cliente no se le vuelve a escribir.` : `Cancelar respondió ${r.status}.`, tecnico: r.tecnico });

      const otra = await llamar('DELETE', `/api/v1/entregas/${encodeURIComponent(refB)}`, { clave: completa.clave });
      const cambiarCancelado = await llamar('PATCH', `/api/v1/entregas/${encodeURIComponent(refB)}`, { clave: completa.clave, cuerpo: { notas: 'x' } });
      poner({ id: 'cancelado', grupo: 'gsg_a_gsgchat', titulo: 'Un pedido cancelado ya no se cancela ni se cambia', ok: otra.status === 409 && cambiarCancelado.status === 409, explicacion: otra.status === 409 && cambiarCancelado.status === 409 ? 'Cancelarlo otra vez o cambiarlo responde 409 con el motivo.' : `Cancelar de nuevo respondió ${otra.status} y cambiarlo ${cambiarCancelado.status}.`, tecnico: otra.tecnico });

      // Límite de peticiones: con una clave aparte, hasta que diga basta.
      let tope: Awaited<ReturnType<typeof llamar>> | null = null;
      let n = 0;
      for (; n < 130; n++) {
        const x = await llamar('GET', `/api/v1/entregas/${encodeURIComponent(`${pref}-TOPE`)}`, { clave: paraTope.clave });
        if (x.status === 429) {
          tope = x;
          break;
        }
      }
      poner({ id: 'limite', grupo: 'gsg_a_gsgchat', titulo: 'Límite de peticiones por clave', ok: Boolean(tope) && Boolean(tope?.cabeceras['retry-after']), explicacion: tope ? `Tras ${n} peticiones en un minuto responde 429 con «${String((tope.cuerpo as { error?: string })?.error ?? '')}» y la cabecera Retry-After.` : 'Ni con 130 peticiones seguidas se frena: un bucle de GSG podría saturar el sistema.', queHacer: tope ? undefined : 'Pon un tope de peticiones por clave en /api/v1/entregas.', tecnico: tope?.tecnico });

      const oa = await llamar('GET', '/api/v1/openapi.json', { clave: completa.clave });
      const caminos = ((oa.cuerpo ?? {}) as { paths?: Record<string, Record<string, unknown>> }).paths ?? {};
      const tiene = (p: string, m: string) => Boolean(caminos[p]?.[m] ?? caminos[`/api/v1${p}`]?.[m]);
      const faltanOa = [['/entregas', 'post'], ['/entregas', 'get'], ['/entregas/{referencia}', 'get'], ['/entregas/{referencia}', 'patch'], ['/entregas/{referencia}', 'delete'], ['/webhooks', 'post']].filter(([p, m]) => !tiene(p!, m!)).map(([p, m]) => `${m!.toUpperCase()} ${p}`);
      poner({ id: 'openapi', grupo: 'gsg_a_gsgchat', titulo: 'El contrato formal (OpenAPI) trae todas las rutas de GSG', ok: oa.status === 200 && !faltanOa.length, explicacion: oa.status !== 200 ? `openapi.json respondió ${oa.status}.` : faltanOa.length ? `Le faltan: ${faltanOa.join(', ')}.` : 'openapi.json describe crear, consultar, cambiar, cancelar y los webhooks.', tecnico: { peticion: oa.tecnico.peticion, respuesta: { status: oa.status, rutas: Object.keys(caminos).filter((p) => p.includes('entregas') || p.includes('webhooks')) } } });

      const ev = await llamar('GET', '/api/v1/eventos', { clave: completa.clave });
      const textoEventos = JSON.stringify(ev.cuerpo ?? {});
      const faltanEventos = ['entrega.confirmada', 'entrega.avisada', 'entrega.entregada', 'entrega.incidencia'].filter((e) => !textoEventos.includes(e));
      poner({ id: 'eventos', grupo: 'webhooks', titulo: 'GSG puede suscribirse a los cuatro avisos de las entregas', ok: ev.status === 200 && !faltanEventos.length, explicacion: faltanEventos.length ? `No se ofrecen: ${faltanEventos.join(', ')}.` : 'GET /api/v1/eventos ofrece entrega.confirmada, entrega.avisada, entrega.entregada y entrega.incidencia.', tecnico: ev.tecnico });
    }

    // =================================================== 2. GSGchat → GSG
    const sim = deps.simuladorDePrueba ?? crearGsgSimulado({ token: TOKEN_SIMULADOR_PRIVADO, ahora });
    const puertoDePrueba: PuertoGsg = { ...crearPuertoHttp({ url: 'https://api.gsg.pe', token: TOKEN_SIMULADOR_PRIVADO, fetchImpl: fetchHaciaSimulador(sim), timeoutSegundos: 5 }), esSimulador: () => true };
    const cola = colaEnMemoria();
    const lote = { id: 'lote-prueba', nombre: 'Entregas GSG (prueba)', externoId: null } as unknown as Lote;
    const solicitud = (ref: string, tel: string) =>
      ({ id: 1, loteId: 'lote-prueba', referencia: ref, phone: tel, telefonoCrudo: tel.slice(2), nombre: 'Cliente de prueba', lat: -12.1211, lng: -77.0301, mapsUrl: 'https://maps.google.com/?q=-12.1211,-77.0301', precisionM: 20, ubicacionFuente: 'pin', resueltoAt: ahora(), intentos: 1, incidencia: 'sin_respuesta', incidenciaDetalle: '3 intentos sin respuesta', requiereHumano: true, ultimoEnvioAt: ahora(), primeraRespuestaAt: null }) as unknown as Solicitud;
    const payloads: Record<'ubicacion' | 'confirmacion' | 'entrega' | 'incidencia', Record<string, unknown>> = {
      ubicacion: payloadUbicacion(solicitud(`${pref}-R1`, telA), lote),
      confirmacion: payloadConfirmacion({ referencia: `${pref}-R2`, phone: telA, nombre: 'Cliente de prueba', confirmada: true, respuesta: 'sí, dale', como: 'reglas', en: ahora() }),
      entrega: payloadEntrega({ referencia: `${pref}-R3`, phone: telA, nombre: 'Cliente de prueba', lat: -12.1211, lng: -77.0301, motorizado: { phone: numeroDePrueba('motorizado', base), nombre: 'Moto de prueba', placa: 'M1A-101' }, minutosMotorizado: 35, margenMinutos: 60, minutosAviso: 95, llegaAproxAt: ahora(), avisadoAt: ahora() }),
      incidencia: payloadIncidencia(solicitud(`${pref}-R4`, telA), lote),
    };
    const nombres = { ubicacion: 'la ubicación', confirmacion: 'la confirmación', entrega: 'la entrega (motorizado y hora)', incidencia: 'la incidencia' } as const;
    const recibidas = (ref: string) => sim.recibido.filter((x) => x.cuerpo.referencia === ref);

    for (const tipo of ['ubicacion', 'confirmacion', 'entrega', 'incidencia'] as const) cola.encolar(tipo, payloads[tipo]);
    await despacharReportes({ rutas: cola.rutas }, puertoDePrueba, 25);
    for (const tipo of ['ubicacion', 'confirmacion', 'entrega', 'incidencia'] as const) {
      const fila = cola.filas.find((f) => f.tipo === tipo)!;
      const llegaron = recibidas(String(payloads[tipo].referencia));
      const igual = llegaron.length === 1 && JSON.stringify(llegaron[0]!.cuerpo) === JSON.stringify(payloads[tipo]);
      poner({ id: `reporte_${tipo}`, grupo: 'gsgchat_a_gsg', titulo: `GSG recibe ${nombres[tipo]}`, ok: fila.estado === 'enviado' && igual, explicacion: fila.estado === 'enviado' && igual ? `Sale por el mismo camino que en producción (POST con token), GSG la recibe una sola vez, tal cual, y el reporte queda como enviado (${fila.externoId}).` : `El reporte quedó «${fila.estado}» ${fila.ultimoError ? `(${fila.ultimoError})` : ''} y GSG lo recibió ${llegaron.length} vez/veces.`, tecnico: { peticion: { metodo: 'POST', tipo, cuerpo: payloads[tipo] }, respuesta: { estado: fila.estado, idDeGsg: fila.externoId, error: fila.ultimoError } } });
    }

    for (const modo of ['caido', 'sin_red'] as const) {
      const ref = `${pref}-${modo.toUpperCase()}`;
      const payload = { ...payloads.ubicacion, referencia: ref };
      sim.modo = modo;
      const fila = cola.encolar('ubicacion', payload);
      await despacharReportes({ rutas: cola.rutas }, puertoDePrueba, 25);
      const durante = fila.estado;
      const errorDurante = fila.ultimoError;
      sim.modo = 'ok';
      await despacharReportes({ rutas: cola.rutas }, puertoDePrueba, 25);
      const ok = durante === 'pendiente' && fila.estado === 'enviado' && recibidas(ref).length === 1;
      poner({ id: `reintenta_${modo}`, grupo: 'gsgchat_a_gsg', titulo: modo === 'caido' ? 'Con GSG caído no se pierde nada' : 'Sin red no se pierde nada', ok, explicacion: ok ? `Mientras GSG ${modo === 'caido' ? 'responde 502' : 'no se alcanza'}, el reporte espera en la cola («${errorDurante}»); cuando vuelve, sale solo y llega una sola vez.` : `Durante el corte quedó «${durante}» y después «${fila.estado}»; GSG lo recibió ${recibidas(ref).length} vez/veces.`, tecnico: { respuesta: { duranteElCorte: durante, error: errorDurante, alVolver: fila.estado } } });
    }

    {
      const ref = `${pref}-RECHAZA`;
      sim.modo = 'rechaza';
      const fila = cola.encolar('confirmacion', { ...payloads.confirmacion, referencia: ref });
      await despacharReportes({ rutas: cola.rutas }, puertoDePrueba, 25);
      const llamadasTras = sim.estado().llamadas;
      await despacharReportes({ rutas: cola.rutas }, puertoDePrueba, 25);
      const noInsiste = sim.estado().llamadas === llamadasTras;
      sim.modo = 'ok';
      const ok = fila.estado === 'fallido' && /422/.test(fila.ultimoError ?? '') && noInsiste;
      poner({ id: 'rechazado_visible', grupo: 'gsgchat_a_gsg', titulo: 'Lo que GSG rechaza queda a la vista y no se reintenta en bucle', ok, explicacion: ok ? `GSG respondió 422: el reporte queda como no aceptado con el motivo («${fila.ultimoError}») para verlo en Hoy y reintentarlo a mano; no se insiste solo.` : `Quedó «${fila.estado}» (${fila.ultimoError ?? 'sin motivo'}) ${noInsiste ? '' : 'y se volvió a mandar solo'}.`, tecnico: { respuesta: { estado: fila.estado, error: fila.ultimoError } } });
    }

    {
      const refs = [1, 2, 3, 4, 5].map((i) => `${pref}-DUP${i}`);
      for (const ref of refs) cola.encolar('ubicacion', { ...payloads.ubicacion, referencia: ref });
      await Promise.all([despacharReportes({ rutas: cola.rutas }, puertoDePrueba, 25), despacharReportes({ rutas: cola.rutas }, puertoDePrueba, 25), despacharReportes({ rutas: cola.rutas }, puertoDePrueba, 25)]);
      const veces = refs.map((ref) => recibidas(ref).length);
      const ok = veces.every((v) => v === 1);
      poner({ id: 'no_duplica', grupo: 'gsgchat_a_gsg', titulo: 'Tres despachos a la vez no mandan nada dos veces', ok, explicacion: ok ? 'Con tres vaciados de la cola a la vez (la pasada de cada minuto, el envío al momento y el botón «reenviar»), cada reporte llega una sola vez.' : `Veces que llegó cada uno: ${veces.join(', ')}.`, tecnico: { respuesta: { veces } } });
    }

    {
      // La API REAL (un puerto que no es el simulador): lo de prueba no sale.
      const realFalso: PuertoGsg = { ...puertoDePrueba, esSimulador: () => false };
      const ref = `${pref}-NUNCA-REAL`;
      const antes = sim.estado().llamadas;
      const fila = cola.encolar('ubicacion', { ...payloads.ubicacion, referencia: ref });
      await despacharReportes({ rutas: cola.rutas }, realFalso, 25);
      const ok = sim.estado().llamadas === antes && fila.estado === 'fallido';
      poner({ id: 'prueba_nunca_real', grupo: 'gsgchat_a_gsg', titulo: 'Lo de prueba nunca llega a la API real de GSG', ok, explicacion: ok ? 'Un reporte de un cliente de prueba, con la API real conectada, no se manda: se aparta con el motivo a la vista.' : 'Un reporte de prueba salió hacia la API real: no puede pasar.', queHacer: ok ? undefined : 'Revisa esReporteDePrueba en src/rutas/gsg.ts.' });
    }

    // =================================================== 3. Webhooks
    {
      const secreto = generarSecretoWebhook();
      let capturado: { url: string; cabeceras: Headers; cuerpo: string } | null = null;
      const webhook = { id: 'w-prueba', url: 'https://api.gsg.pe/gsgchat/avisos', secreto, activo: true, eventos: ['entrega.avisada'] } as unknown as WebhookConSecreto;
      const datos = { referencia: `${pref}-W`, telefono: telA, nombre: 'Cliente de prueba', estado: 'avisada', llegaAproxEn: ahora().toISOString() };
      const salida = await entregarUna(webhook, { id: 41, evento: 'entrega.avisada', payload: datos, createdAt: ahora(), intentos: 0 }, {
        fetchImpl: (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
          capturado = { url: String(url), cabeceras: new Headers(init?.headers), cuerpo: String(init?.body ?? '') };
          return new Response('{"ok":true}', { status: 200 });
        }) as typeof fetch,
      });
      const cap = capturado as { url: string; cabeceras: Headers; cuerpo: string } | null;
      let cuerpo: Record<string, unknown> = {};
      try {
        cuerpo = cap ? (JSON.parse(cap.cuerpo) as Record<string, unknown>) : {};
      } catch {
        cuerpo = {};
      }
      const formatoOk = ['id', 'evento', 'fecha', 'intento', 'datos'].every((k) => k in cuerpo) && cuerpo.evento === 'entrega.avisada' && cuerpo.intento === 1 && JSON.stringify(cuerpo.datos) === JSON.stringify(datos);
      poner({ id: 'webhook_formato', grupo: 'webhooks', titulo: 'Cada aviso llega con el formato del contrato', ok: salida.ok && formatoOk, explicacion: formatoOk ? 'POST JSON con id, evento, fecha, intento (1 el primero) y datos del pedido; un 2xx de GSG lo cierra.' : `El cuerpo no trae lo del contrato: ${cap?.cuerpo.slice(0, 200) ?? 'no se mandó nada'}.`, tecnico: { peticion: { url: cap?.url, cuerpo } } });
      const firma = cap?.cabeceras.get('x-firma') ?? undefined;
      const firmaOk = Boolean(cap) && verificarFirma(secreto, cap!.cuerpo, firma) && !verificarFirma(generarSecretoWebhook(), cap!.cuerpo, firma);
      poner({ id: 'webhook_firma', grupo: 'webhooks', titulo: 'La firma X-Firma se comprueba con el secreto', ok: firmaOk, explicacion: firmaOk ? 'X-Firma (t=…,v1=HMAC SHA-256 de «t.cuerpo») cuadra con el secreto del webhook y no con otro: GSG puede saber que el aviso es nuestro.' : `La firma no cuadra: ${firma ?? 'no vino la cabecera'}.`, tecnico: { peticion: { 'X-Firma': firma, 'X-Evento': cap?.cabeceras.get('x-evento'), 'X-Entrega': cap?.cabeceras.get('x-entrega') } } });

      const con = async (status: number | 'sin_red') =>
        entregarUna(webhook, { id: 42, evento: 'entrega.avisada', payload: datos, createdAt: ahora(), intentos: 0 }, {
          fetchImpl: (async () => {
            if (status === 'sin_red') throw new TypeError('fetch failed');
            return new Response('x', { status });
          }) as typeof fetch,
        });
      const [r500, r429, r408, r404, r401, rRed] = await Promise.all([con(500), con(429), con(408), con(404), con(401), con('sin_red')]);
      const reintentosOk = r500.reintentable && r429.reintentable && r408.reintentable && rRed.reintentable && !r404.reintentable && !r401.reintentable;
      poner({ id: 'webhook_reintentos', grupo: 'webhooks', titulo: 'Qué avisos se reintentan y cuáles no', ok: reintentosOk, explicacion: reintentosOk ? 'Un 5xx, un 408, un 429 o sin red se reintentan con espera creciente; un 401 o 404 (URL o firma mal del lado de GSG) no se insisten.' : `Reintenta: 500 ${r500.reintentable}, 429 ${r429.reintentable}, 408 ${r408.reintentable}, sin red ${rRed.reintentable}, 404 ${r404.reintentable}, 401 ${r401.reintentable}.` });
    }

    // =================================================== 4. Contrato escrito
    const md = await leerContrato();
    if (!md) {
      poner({ id: 'contrato_existe', grupo: 'contrato', titulo: 'El contrato está en esta instalación', ok: false, explicacion: 'No se encuentra docs/CONTRATO-GSG.md: no hay nada que darle a GSG.', queHacer: 'Copia la carpeta docs/ junto al programa.' });
    } else {
      for (const d of compararContrato(md)) {
        poner({ id: `contrato_${d.parte}`, grupo: 'contrato', titulo: d.parte, ok: d.ok, explicacion: d.explicacion, queHacer: d.ok ? undefined : 'Corrige docs/CONTRATO-GSG.md (o el código) hasta que coincidan.', tecnico: d.ok ? undefined : { respuesta: { faltanEnElContrato: d.faltanEnDocumento, sobranEnElContrato: d.sobranEnDocumento } } });
      }
      if (deps.cookie) {
        const r = await deps.app.inject({ method: 'GET', url: '/docs/contrato-gsg.md', headers: { cookie: deps.cookie } });
        const igual = r.statusCode === 200 && r.body === md;
        poner({ id: 'contrato_descarga', grupo: 'contrato', titulo: 'Lo que baja el panel es este mismo contrato', ok: igual, explicacion: igual ? '«Descargar el contrato» (Conexión) entrega exactamente este documento.' : `La descarga respondió ${r.statusCode} y no coincide con el fichero.` });
      }
    }
  } finally {
    limpieza = await limpiar(deps.repos, pref, [telA, telB], clavesCreadas).catch((error: unknown) => `No se pudo limpiar todo: ${error instanceof Error ? error.message : String(error)}`);
  }

  const bien = lista.filter((c) => c.ok).length;
  const orden: GrupoComprobacion[] = ['gsg_a_gsgchat', 'gsgchat_a_gsg', 'webhooks', 'contrato'];
  const grupos = orden
    .map((g) => ({ id: g, titulo: TITULOS_GRUPO[g], comprobaciones: lista.filter((c) => c.grupo === g) }))
    .filter((g) => g.comprobaciones.length)
    .map((g) => ({ ...g, ok: g.comprobaciones.every((c) => c.ok) }));
  const faltan = lista.filter((c) => !c.ok).map((c) => `${c.titulo}: ${c.explicacion}${c.queHacer ? ` ${c.queHacer}` : ''}`);
  const listo = faltan.length === 0;
  return {
    listo,
    titular: listo
      ? 'Listo para conectar con GSG: solo falta pegar la dirección y el token.'
      : `Todavía no está listo: ${faltan.length} de ${lista.length} comprobaciones fallan.`,
    faltan,
    grupos,
    total: lista.length,
    bien,
    duracionMs: Date.now() - t0,
    en: ahora().toISOString(),
    limpieza,
  };
}

/** Borra lo que creo la comprobacion: sus pedidos, sus clientes de prueba, su cola y sus claves temporales. */
async function limpiar(repos: Repos, pref: string, telefonos: string[], claves: string[]): Promise<string> {
  for (const id of claves) await repos.claves.revocar(id).catch(() => undefined);
  const db = repos.desarrollador;
  if (!db) return `Claves temporales revocadas (${claves.length}). Sin base de datos real no hay más que borrar.`;
  const like = `${pref}%`;
  const lotes = (await db.query<{ lote_id: string }>('select distinct lote_id from rutas_solicitudes where referencia like $1', [like])).rows.map((r) => r.lote_id);
  const reportes = (await db.query(`delete from rutas_reportes where json_unquote(json_extract(payload, '$.referencia')) like $1`, [like])).rowCount;
  await db.query(`delete from webhook_entregas where json_unquote(json_extract(payload, '$.referencia')) like $1`, [like]);
  const pedidos = (await db.query('delete from entregas where referencia like $1', [like])).rowCount;
  await db.query('delete from rutas_solicitudes where referencia like $1', [like]);
  if (lotes.length) await db.query('delete l from rutas_lotes l where l.id in ($1) and not exists (select 1 from rutas_solicitudes s where s.lote_id = l.id)', [lotes]);
  await db.query('delete from contacts where phone in ($1)', [telefonos]);
  const borradas = claves.length ? (await db.query('delete from claves_api where id in ($1)', [claves])).rowCount : 0;
  return `Se borró lo de la comprobación: ${pedidos} pedido${pedidos === 1 ? '' : 's'} de prueba, ${reportes} reporte${reportes === 1 ? '' : 's'} en cola, sus clientes de prueba y ${borradas} clave${borradas === 1 ? '' : 's'} temporal${borradas === 1 ? '' : 'es'}.`;
}
