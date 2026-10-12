/**
 * Los errores de la API, todos con la misma forma:
 *
 *   { ok: false, codigo: 'CLAVE_INVALIDA', error: 'La clave de API no existe…', detalles?: [...] }
 *
 * `error` sigue siendo el texto (lo que ya leian el panel y los clientes de
 * la API); `codigo` es estable y es lo que conviene comparar desde otro
 * sistema; `detalles` dice que campo fallo cuando aplica. Nunca lleva SQL,
 * trazas ni secretos: un error inesperado se apunta en el log y aqui sale
 * solo un texto general.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';

export type CodigoError =
  | 'VALIDACION'
  | 'JSON_INVALIDO'
  | 'METODO_NO_PERMITIDO'
  | 'CUERPO_DEMASIADO_GRANDE'
  | 'TIPO_CONTENIDO_NO_SOPORTADO'
  | 'SESION_REQUERIDA'
  | 'PAGO_REQUERIDO'
  | 'CLAVE_AUSENTE'
  | 'CLAVE_INVALIDA'
  | 'CLAVE_REVOCADA'
  | 'SIN_PERMISO'
  | 'TIENDA_SUSPENDIDA'
  | 'RUTA_NO_EXISTE'
  | 'NO_EXISTE'
  | 'CLAVE_AMBIGUA'
  | 'CONFLICTO'
  | 'MENSAJE_EN_CURSO'
  | 'MENSAJE_YA_ENVIADO'
  | 'RESULTADO_INCIERTO'
  | 'ESPERA_CONFIRMACION'
  | 'DEMASIADAS_PETICIONES'
  | 'BASE_NO_DISPONIBLE'
  | 'ERROR_INTERNO';

export interface DetalleCampo {
  /** Ruta del campo: "pedidos[2].telefono", "cuerpo"... */
  campo: string;
  mensaje: string;
  /** Posición del pedido en la llamada, empezando en 1. */
  pedido?: number;
  cliente?: string | null;
  tracking?: string | null;
}

export interface CuerpoError {
  ok: false;
  codigo: CodigoError;
  error: string;
  detalles?: DetalleCampo[] | Record<string, unknown>;
  /** Pantalla del panel donde se arregla (p. ej. el 402 lleva a la membresía). */
  ir?: string;
}

export function cuerpoError(codigo: CodigoError, error: string, detalles?: CuerpoError['detalles'], ir?: string): CuerpoError {
  const cuerpo: CuerpoError = { ok: false, codigo, error };
  if (detalles !== undefined) cuerpo.detalles = detalles;
  if (ir) cuerpo.ir = ir;
  return cuerpo;
}

export function enviarError(reply: FastifyReply, status: number, codigo: CodigoError, error: string, detalles?: CuerpoError['detalles']): FastifyReply {
  return reply.code(status).send(cuerpoError(codigo, error, detalles));
}

/**
 * Un error que una ruta lanza y el manejador central convierte en su
 * respuesta: `throw new ErrorApi(402, 'PAGO_REQUERIDO', '...', { ir })`.
 * Asi ninguna ruta arma el cuerpo a mano.
 */
export class ErrorApi extends Error {
  constructor(
    readonly status: number,
    readonly codigo: CodigoError,
    mensaje: string,
    readonly extra: { detalles?: CuerpoError['detalles']; ir?: string } = {},
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
  }

  cuerpo(): CuerpoError {
    return cuerpoError(this.codigo, this.message, this.extra.detalles, this.extra.ir);
  }
}

export interface EntradaCatalogo {
  status: number;
  /** Que paso, en una linea. */
  significa: string;
  /** Que hacer para que salga bien. */
  queHacer: string;
}

/**
 * Todos los codigos con su HTTP y que hacer. Lo publica GET /api/v1/errores
 * para quien integra y lo usa el manejador central para elegir el codigo
 * cuando un error solo trae el status.
 */
export const CATALOGO_ERRORES: Record<CodigoError, EntradaCatalogo> = {
  VALIDACION: { status: 400, significa: 'Algún campo falta o no tiene el formato esperado.', queHacer: 'Corrige los campos que indica `detalles` y vuelve a enviar.' },
  JSON_INVALIDO: { status: 400, significa: 'El cuerpo no es un JSON válido.', queHacer: 'Revisa comillas, comas y llaves.' },
  SESION_REQUERIDA: { status: 401, significa: 'No hay sesión iniciada en el panel.', queHacer: 'Entra en /login (o manda una clave de API en X-API-Key).' },
  CLAVE_AUSENTE: { status: 401, significa: 'Falta la clave de API.', queHacer: 'Mándala en la cabecera `X-API-Key: <clave>`.' },
  CLAVE_INVALIDA: { status: 401, significa: 'La clave de API no existe o no es válida.', queHacer: 'Revisa la clave o pide una nueva a un administrador.' },
  CLAVE_REVOCADA: { status: 401, significa: 'La clave de API fue revocada.', queHacer: 'Pide una clave nueva a un administrador.' },
  PAGO_REQUERIDO: { status: 402, significa: 'La membresía está vencida o no incluye esta función.', queHacer: 'Renueva o amplía la membresía; `ir` dice dónde.' },
  SIN_PERMISO: { status: 403, significa: 'La clave o la cuenta no tiene permiso para esto.', queHacer: 'Pide a un administrador el permiso que indica el mensaje.' },
  TIENDA_SUSPENDIDA: { status: 403, significa: 'La tienda está suspendida.', queHacer: 'Habla con quien administra las tiendas.' },
  RUTA_NO_EXISTE: { status: 404, significa: 'No existe esa ruta.', queHacer: 'Revisa la dirección y el método en /api/v1/openapi.json.' },
  NO_EXISTE: { status: 404, significa: 'Lo que se pide no existe (o ya no).', queHacer: 'Revisa el identificador.' },
  METODO_NO_PERMITIDO: { status: 405, significa: 'La ruta existe pero no con ese método.', queHacer: 'Usa uno de los métodos de la cabecera Allow.' },
  CLAVE_AMBIGUA: { status: 409, significa: 'La clave coincide con más de una tienda.', queHacer: 'Indica la tienda o usa una clave propia de la tienda.' },
  CONFLICTO: { status: 409, significa: 'Choca con el estado actual.', queHacer: 'Vuelve a leer el recurso y repite la operación.' },
  MENSAJE_EN_CURSO: { status: 409, significa: 'Ese mensaje se está enviando ahora mismo.', queHacer: 'Espera y consulta su estado; no lo repitas.' },
  MENSAJE_YA_ENVIADO: { status: 409, significa: 'Ese mensaje ya se envió.', queHacer: 'Nada: no se manda dos veces.' },
  RESULTADO_INCIERTO: { status: 409, significa: 'No se sabe si el envío anterior salió.', queHacer: 'Revisa la conversación antes de repetir.' },
  ESPERA_CONFIRMACION: { status: 409, significa: 'La operación espera una confirmación.', queHacer: 'Confírmala antes de seguir.' },
  CUERPO_DEMASIADO_GRANDE: { status: 413, significa: 'El cuerpo supera el límite de 4 MiB.', queHacer: 'Divide los datos en llamadas más pequeñas.' },
  TIPO_CONTENIDO_NO_SOPORTADO: { status: 415, significa: 'El tipo de contenido no está soportado.', queHacer: 'Usa Content-Type: application/json.' },
  DEMASIADAS_PETICIONES: { status: 429, significa: 'Demasiadas peticiones seguidas.', queHacer: 'Espera lo que diga Retry-After.' },
  ERROR_INTERNO: { status: 500, significa: 'Fallo inesperado del servidor.', queHacer: 'Reintenta; si sigue, avisa con la hora exacta.' },
  BASE_NO_DISPONIBLE: { status: 503, significa: 'La base de datos no responde.', queHacer: 'Reintenta tras Retry-After.' },
};

/**
 * GET /api/v1/errores y GET /api/v1/errores/:codigo. Es igual para todas las
 * tiendas: lo monta la tienda y tambien la plataforma (que lo contesta sin
 * clave, sin tener que saber de que tienda es quien pregunta).
 */
export function registrarCatalogoErrores(app: FastifyInstance): void {
  const entrada = (codigo: CodigoError) => ({ codigo, ...CATALOGO_ERRORES[codigo] });
  app.get('/api/v1/errores', async (request) => {
    const status = Number((request.query as { status?: string }).status);
    const codigos = (Object.keys(CATALOGO_ERRORES) as CodigoError[]).filter((c) => !status || CATALOGO_ERRORES[c].status === status);
    return {
      forma: { ok: false, codigo: 'CODIGO_ESTABLE', error: 'El motivo en palabras', detalles: '[{ campo, mensaje }] (opcional)', ir: '/panel#... (opcional)' },
      errores: codigos.map(entrada),
    };
  });
  app.get<{ Params: { codigo: string } }>('/api/v1/errores/:codigo', async (request, reply) => {
    const codigo = request.params.codigo.toUpperCase() as CodigoError;
    // Lo pedido solo se repite si tiene forma de codigo: nada de devolver lo que mande cualquiera.
    if (!Object.hasOwn(CATALOGO_ERRORES, codigo)) return reply.code(404).send(cuerpoError('NO_EXISTE', `No hay ningún error con ${/^[A-Z0-9_]{1,40}$/.test(codigo) ? `el código ${codigo}` : 'ese código'}. La lista está en /api/v1/errores.`));
    return entrada(codigo);
  });
}

/** El codigo por defecto de un status 4xx que no trae el suyo. */
export function codigoPorStatus(status: number): CodigoError {
  switch (status) {
    case 401: return 'CLAVE_INVALIDA';
    case 402: return 'PAGO_REQUERIDO';
    case 403: return 'SIN_PERMISO';
    case 404: return 'NO_EXISTE';
    case 405: return 'METODO_NO_PERMITIDO';
    case 409: return 'CONFLICTO';
    case 413: return 'CUERPO_DEMASIADO_GRANDE';
    case 415: return 'TIPO_CONTENIDO_NO_SOPORTADO';
    case 429: return 'DEMASIADAS_PETICIONES';
    default: return 'VALIDACION';
  }
}

/** Codigos de mysql2/Node que significan "la base no contesta ahora", no "la consulta esta mal". */
const BASE_CAIDA = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_SEQUENCE_TIMEOUT',
  'ER_CON_COUNT_ERROR',
  'ER_SERVER_SHUTDOWN',
  'ER_LOCK_WAIT_TIMEOUT',
  'ER_LOCK_DEADLOCK',
  'ER_TOO_MANY_USER_CONNECTIONS',
  'POOL_CLOSED',
]);

/** Si el error viene de que la base de datos no esta disponible (503, reintentar), y no de un fallo propio (500). */
export function esBaseNoDisponible(error: unknown): boolean {
  const e = error as { code?: unknown; errno?: unknown; fatal?: unknown; message?: unknown } | null;
  if (!e || typeof e !== 'object') return false;
  if (typeof e.code === 'string' && BASE_CAIDA.has(e.code)) return true;
  if (e.fatal === true) return true;
  return typeof e.message === 'string' && /pool is closed|connect ETIMEDOUT|connection lost|Too many connections/i.test(e.message);
}

/** Segundos que se sugieren en Retry-After cuando la base no contesta. */
export const ESPERA_BASE_SEGUNDOS = 30;
