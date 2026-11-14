/**
 * La coleccion de Postman de las APIs que GSG llama.
 *
 * Una sola fuente: los cuerpos salen de los ejemplos de Nuestra API
 * (`EJEMPLO_COURIER`, `EJEMPLO_FLUJO`) y los errores del catalogo de la API
 * (`CATALOGO_ERRORES`). El archivo de docs/postman se genera con esto y una
 * prueba comprueba que coincide y que cada llamada existe en el OpenAPI, para
 * que la coleccion, el Manual y el contrato no se separen.
 *
 * La API Key nunca va aqui: la coleccion usa la variable `{{apiKey}}`, que
 * vive en el entorno de Postman como secreta y vacia.
 */

import { CATALOGO_ERRORES, type CodigoError } from '../api/errores.js';
import { EJEMPLO_COURIER, EJEMPLO_FLUJO } from './gsg-courier-page.js';

type Json = Record<string, unknown>;

export const ESQUEMA_POSTMAN = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

/** El servidor de ejemplo: el de `npm run quick`. En Postman se cambia en el entorno. */
export const SERVIDOR_EJEMPLO = 'http://localhost:3000';

/** El tracking de los ejemplos, como variable: se cambia una vez y vale para todas las llamadas. */
const TRACKING = EJEMPLO_FLUJO.tracking;

export interface LlamadaPostman {
  nombre: string;
  metodo: 'GET' | 'POST' | 'PATCH';
  /** Ruta bajo /api/v1, con `{{tracking}}` donde va el tracking. */
  ruta: string;
  query?: Array<[string, string]>;
  cuerpo?: unknown;
  sinClave?: boolean;
  /** Estados con los que la llamada se da por buena en la corrida; por defecto, el del primer ejemplo. */
  estados?: number[];
  descripcion: string;
  /** Respuestas de ejemplo: estado y cuerpo (en los errores, del catalogo). */
  ejemplos: Array<{ nombre: string; status: number; cuerpo: Json }>;
}

export interface CarpetaPostman {
  nombre: string;
  descripcion: string;
  llamadas: LlamadaPostman[];
}

/** Un error con la forma de siempre: `{ ok: false, codigo, error }`, con el texto del catalogo. */
function errorDe(codigo: CodigoError, error = CATALOGO_ERRORES[codigo].significa): { status: number; cuerpo: Json } {
  return { status: CATALOGO_ERRORES[codigo].status, cuerpo: { ok: false, codigo, error } };
}

const PEDIDO = { ...EJEMPLO_COURIER.pedidos[0], tracking: '{{tracking}}' };
const { telefono: _sinTelefono, ...PEDIDO_SIN_TELEFONO } = PEDIDO;

/** Orden de ejecución: lo que cancela un pedido va al final, para que lo demás corra sobre un pedido vivo. */
export const CARPETAS_POSTMAN: CarpetaPostman[] = ([
  {
    nombre: '1. Recibir pedidos (API 1)',
    descripcion: 'GSG manda los pedidos del día a POST /api/v1/entregas. Hasta 600 por llamada; un pedido repetido el mismo día no se duplica.',
    llamadas: [
      {
        nombre: 'Crear un pedido',
        estados: [200, 201],
        metodo: 'POST',
        ruta: '/entregas',
        cuerpo: PEDIDO,
        descripcion: 'Con un tracking nuevo responde 201 y el pedido con su id. Si se manda otra vez el mismo día responde 200 y lo trae en «existentes».',
        ejemplos: [
          { nombre: 'Creado', status: 201, cuerpo: { ok: true, creadas: [{ id: 1, referencia: TRACKING }], repetidas: [], descartadas: [], whatsapp: [], detalle: '1 pedido nuevo.' } },
          { nombre: 'Ya estaba (repetido)', status: 200, cuerpo: { ok: true, creadas: [], repetidas: [TRACKING], existentes: [{ referencia: TRACKING, id: 1 }], detalle: 'Nada nuevo.' } },
        ],
      },
      {
        nombre: 'Error: falta el teléfono',
        metodo: 'POST',
        ruta: '/entregas',
        cuerpo: PEDIDO_SIN_TELEFONO,
        descripcion: 'Sin un campo obligatorio responde 400 y no guarda ningún pedido de la llamada. «detalles» dice qué campo de qué pedido.',
        ejemplos: [{ nombre: 'Falta un campo', ...errorDe('VALIDACION'), cuerpo: { ...errorDe('VALIDACION').cuerpo, detalles: [{ campo: 'pedidos[0].telefono', mensaje: 'falta (es obligatorio)', pedido: 1 }] } }],
      },
      {
        nombre: 'Error: sin la API Key',
        metodo: 'POST',
        ruta: '/entregas',
        cuerpo: PEDIDO,
        sinClave: true,
        descripcion: 'Sin la cabecera X-API-Key responde 401. Con una clave inventada o revocada, también 401.',
        ejemplos: [{ nombre: 'Sin clave', ...errorDe('CLAVE_AUSENTE') }],
      },
    ],
  },
  {
    nombre: '4. Cancelar o reintentar (API 2)',
    descripcion: 'GSG pide dejar de escribirle a un tracking (CANCELAR) o volver a escribirle (REINTENTAR) en POST /api/v1/flujo. Actúa sobre un pedido que ya existe: primero se crea con la API 1. Misma clave que la API 1.',
    llamadas: [
      {
        nombre: 'Simular cancelar (no cambia nada)',
        metodo: 'POST',
        ruta: '/flujo',
        cuerpo: { tracking: '{{tracking}}', accion: 'CANCELAR', simular: true },
        descripcion: 'Con «simular: true» dice lo que haría sin tocar el pedido.',
        ejemplos: [{ nombre: 'Simulado', status: 200, cuerpo: { ok: true, simulado: true, accion: 'CANCELAR', tracking: TRACKING, detalle: 'Dejaría de escribirle por este tracking.' } }],
      },
      {
        nombre: 'Reintentar con el teléfono corregido',
        metodo: 'POST',
        ruta: '/flujo',
        cuerpo: { tracking: '{{tracking}}', accion: 'REINTENTAR', telefono: '987654321' },
        descripcion: 'Corrige el número y le escribe al nuevo. Sin «telefono», reinicia la solicitud de ese pedido.',
        ejemplos: [
          { nombre: 'Reintentado', status: 200, cuerpo: { ok: true, accion: 'REINTENTAR', tracking: TRACKING, telefonoCorregido: '51987654321', detalle: 'Se le vuelve a escribir.' } },
          { nombre: 'Ya entregado o cancelado', ...errorDe('CONFLICTO') },
        ],
      },
      {
        nombre: 'Error: acción no válida',
        metodo: 'POST',
        ruta: '/flujo',
        cuerpo: { tracking: '{{tracking}}', accion: 'BORRAR' },
        descripcion: 'La acción solo puede ser CANCELAR o REINTENTAR.',
        ejemplos: [{ nombre: 'Acción no válida', ...errorDe('VALIDACION') }],
      },
      {
        nombre: 'Cancelar',
        metodo: 'POST',
        ruta: '/flujo',
        cuerpo: { ...EJEMPLO_FLUJO, tracking: '{{tracking}}' },
        descripcion: 'El bot deja de escribirle por ese tracking. Repetirlo responde 200 con «sinCambios: true».',
        ejemplos: [
          { nombre: 'Cancelado', status: 200, cuerpo: { ok: true, accion: 'CANCELAR', tracking: TRACKING, detalle: 'Flujo cancelado.' } },
          { nombre: 'Ya estaba cancelado', status: 200, cuerpo: { ok: true, accion: 'CANCELAR', tracking: TRACKING, sinCambios: true, detalle: 'El flujo ya estaba cancelado.' } },
          { nombre: 'No hay pedido con ese tracking', ...errorDe('NO_EXISTE') },
        ],
      },
    ],
  },
  {
    nombre: '2. Consultar',
    descripcion: 'Lo que GSG puede leer cuando quiera. GSGchat nunca se lo empuja.',
    llamadas: [
      {
        nombre: 'Un pedido de hoy',
        metodo: 'GET',
        ruta: '/entregas/{{tracking}}',
        descripcion: 'Cómo va ese pedido hoy, con sus eventos. Se busca por su referencia (el tracking, si GSG no mandó otra).',
        ejemplos: [
          { nombre: 'Encontrado', status: 200, cuerpo: { ok: true, entrega: { referencia: TRACKING }, eventos: [] } },
          { nombre: 'No hay pedido hoy con esa referencia', ...errorDe('NO_EXISTE') },
        ],
      },
      {
        nombre: 'Lo hecho por WhatsApp con cada tracking',
        metodo: 'GET',
        ruta: '/trackings',
        query: [['dia', '']],
        estados: [200],
        descripcion: 'Por tracking: mensaje enviado, ubicación pedida o registrada, confirmación, agrupado y reportado. «dia» en AAAA-MM-DD; vacío, hoy.',
        ejemplos: [{ nombre: 'Hoy', status: 200, cuerpo: { ok: true, dia: '2026-10-17', total: 0, trackings: [] } }],
      },
      {
        nombre: 'Números reportados pendientes',
        metodo: 'GET',
        ruta: '/reportados',
        query: [['estado', 'pendiente']],
        descripcion: 'Los teléfonos y trackings malos que GSGchat guardó para GSG. «estado»: pendiente o corregido; vacío, todos.',
        ejemplos: [{ nombre: 'Pendientes', status: 200, cuerpo: { ok: true, total: 0, items: [] } }],
      },
    ],
  },
  {
    nombre: '3. Corregir datos',
    descripcion: 'Cambiar los datos de un pedido de hoy o corregir un número reportado.',
    llamadas: [
      {
        nombre: 'Cambiar la dirección de un pedido',
        metodo: 'PATCH',
        ruta: '/entregas/{{tracking}}',
        cuerpo: { direccion: 'Av. Arequipa 456', distrito: 'Lince' },
        descripcion: 'Se puede cambiar nombre, dirección, distrito, notas, urgente, los datos del envío o el teléfono. Un pedido entregado o cancelado responde 409.',
        ejemplos: [
          { nombre: 'Cambiado', status: 200, cuerpo: { ok: true, cambios: ['dirección'], entrega: { referencia: TRACKING }, detalle: 'Pedido actualizado.' } },
          { nombre: 'Ya entregado o cancelado', ...errorDe('CONFLICTO') },
        ],
      },
      {
        nombre: 'Corregir un número reportado',
        metodo: 'POST',
        ruta: '/reportados/{{tracking}}/correccion',
        cuerpo: { telefono: '987654321' },
        descripcion: 'Marca como corregido lo pendiente de ese tracking y, si aún falta la ubicación, se le pide al número nuevo.',
        ejemplos: [
          { nombre: 'Corregido', status: 200, cuerpo: { ok: true, tracking: TRACKING, corregidos: [], detalle: 'Número corregido.' } },
          { nombre: 'Nada reportado con ese tracking', ...errorDe('NO_EXISTE') },
        ],
      },
    ],
  },
] as CarpetaPostman[]).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));

function urlDe(l: LlamadaPostman): Json {
  const ruta = `/api/v1${l.ruta}`;
  const query = (l.query ?? []).map(([key, value]) => ({ key, value }));
  const crudo = '{{baseUrl}}' + ruta + (query.length ? '?' + query.map((q) => `${q.key}=${q.value}`).join('&') : '');
  return { raw: crudo, host: ['{{baseUrl}}'], path: ruta.split('/').filter(Boolean), ...(query.length ? { query } : {}) };
}

function peticionDe(l: LlamadaPostman): Json {
  return {
    method: l.metodo,
    ...(l.sinClave ? { auth: { type: 'noauth' } } : {}),
    header: l.cuerpo === undefined ? [] : [{ key: 'Content-Type', value: 'application/json' }],
    ...(l.cuerpo === undefined ? {} : { body: { mode: 'raw', raw: JSON.stringify(l.cuerpo, null, 2), options: { raw: { language: 'json' } } } }),
    url: urlDe(l),
    description: l.descripcion,
  };
}

const TEXTO_HTTP: Record<number, string> = { 200: 'OK', 201: 'Created', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict' };

/** La coleccion v2.1, lista para importar. */
export function coleccionPostman(): Json {
  return {
    info: {
      name: 'GSGchat: API para GSG',
      description: [
        'Las llamadas que GSG hace a GSGchat: recibir pedidos (API 1), cancelar o reintentar (API 2), consultar y corregir.',
        'Antes de usarla: importa también el entorno «GSGchat», pon en él la dirección del servidor (baseUrl) y la API Key (apiKey), y elígelo arriba a la derecha.',
        'La API Key se crea en GSGchat, Nuestra API, Claves. Va en la cabecera X-API-Key, nunca en la URL ni en el cuerpo.',
        'El contrato completo está en /api/v1/openapi.json del mismo servidor.',
      ].join('\n\n'),
      schema: ESQUEMA_POSTMAN,
    },
    auth: { type: 'apikey', apikey: [{ key: 'key', value: 'X-API-Key', type: 'string' }, { key: 'value', value: '{{apiKey}}', type: 'string' }, { key: 'in', value: 'header', type: 'string' }] },
    variable: [{ key: 'tracking', value: TRACKING, type: 'string', description: 'El tracking de los ejemplos. Cámbialo por uno nuevo para crear otro pedido.' }],
    item: CARPETAS_POSTMAN.map((c) => ({
      name: c.nombre,
      description: c.descripcion,
      item: c.llamadas.map((l) => ({
        name: l.nombre,
        event: [{ listen: 'test', script: { type: 'text/javascript', exec: [`pm.test('responde ${(l.estados ?? [l.ejemplos[0]!.status]).join(' o ')}', function () { pm.expect(pm.response.code).to.be.oneOf([${(l.estados ?? [l.ejemplos[0]!.status]).join(', ')}]); });`] } }],
        request: peticionDe(l),
        response: l.ejemplos.map((e) => ({
          name: e.nombre,
          status: TEXTO_HTTP[e.status] ?? String(e.status),
          code: e.status,
          _postman_previewlanguage: 'json',
          header: [{ key: 'Content-Type', value: 'application/json; charset=utf-8' }],
          body: JSON.stringify(e.cuerpo, null, 2),
        })),
      })),
    })),
  };
}

/** El entorno: la direccion del servidor y la API Key, secreta y vacia. */
export function entornoPostman(baseUrl = SERVIDOR_EJEMPLO): Json {
  return {
    name: 'GSGchat',
    values: [
      { key: 'baseUrl', value: baseUrl, type: 'default', enabled: true },
      { key: 'apiKey', value: '', type: 'secret', enabled: true },
    ],
    _postman_variable_scope: 'environment',
  };
}
