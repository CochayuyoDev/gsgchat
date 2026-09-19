/**
 * El contrato de /api/v1, en OpenAPI 3.
 *
 * Escrito a mano y a proposito: es lo que se le ensena a quien integra, y
 * tiene que leerse. Con esto cualquier lenguaje genera su cliente (PHP,
 * Python, Java) sin mirar el codigo de aqui. Las pruebas comprueban que
 * cada ruta registrada aparece en el documento, para que no se quede viejo.
 */

import { DESCRIPCION_EVENTOS, NOMBRES_EVENTOS } from '../../eventos/bus.js';
import { PERMISOS } from '../../auth/permisos.js';

type Json = Record<string, unknown>;

const permiso = (p: keyof typeof PERMISOS) => ({ 'x-permiso': p, security: [{ claveApi: [] }] });

const error = (descripcion: string) => ({
  description: descripcion,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

const json = (schema: Json, descripcion = 'OK') => ({
  description: descripcion,
  content: { 'application/json': { schema } },
});

const ref = (nombre: string) => ({ $ref: `#/components/schemas/${nombre}` });

export function openApi(baseUrl: string): Json {
  return {
    openapi: '3.0.3',
    info: {
      title: 'wa-locator: API publica',
      version: '1.0.0',
      description: [
        'La puerta para otros sistemas (Stoky, GSG, scripts). Se entra con una clave de API',
        'creada en el panel (Integraciones), con los permisos justos, en la cabecera',
        '`Authorization: Bearer wak_...`.',
        '',
        'Enviar nunca se salta las guardas anti-bloqueo: un mensaje frenado por un gate',
        'responde 202 con `estado: "bloqueado"` y el motivo, no 200.',
        '',
        'Para enterarse de lo que pasa (llego un mensaje, se entrego, mando su ubicacion)',
        'se registra un webhook: cada evento llega como POST firmado en `X-Firma`.',
      ].join('\n'),
    },
    servers: [{ url: `${baseUrl.replace(/\/+$/, '')}/api/v1` }],
    tags: [
      { name: 'estado' },
      { name: 'mensajes' },
      { name: 'conversaciones' },
      { name: 'contactos' },
      { name: 'plantillas' },
      { name: 'webhooks' },
      { name: 'embebido' },
      { name: 'conectores' },
      { name: 'pedidos' },
    ],
    'x-permisos': PERMISOS,
    'x-eventos': NOMBRES_EVENTOS.map((nombre) => ({ nombre, descripcion: DESCRIPCION_EVENTOS[nombre] })),
    paths: {
      '/': { get: { summary: 'Que es esto y donde esta el contrato', responses: { 200: json({ type: 'object' }) } } },
      '/openapi.json': { get: { summary: 'Este documento', responses: { 200: json({ type: 'object' }) } } },
      '/eventos': { get: { summary: 'Los eventos que se pueden suscribir y como se firma cada entrega', responses: { 200: json({ type: 'object' }) } } },

      '/ia/ordenes': {
        post: {
          tags: ['ia'],
          summary: 'Darle una orden con palabras a la IA operadora',
          description: [
            'Otro sistema (Stoky, un script) escribe lo que quiere en lenguaje natural ("pon al 987654321 en la lista',
            'de envío automático para pedirle su ubicación", "¿cómo va el reparto?") y la IA lo ejecuta con las',
            'acciones de su catálogo, SIEMPRE con los permisos de esta clave. Devuelve `texto` (la respuesta),',
            '`hechas` (lo ejecutado, con su resultado) y `pendientes` (lo delicado, que hay que confirmar con',
            '/ia/ordenes/confirmar después de que una persona lo vea). Con `simular: true` no cambia nada.',
          ].join(' '),
          ...permiso('ia:ordenar'),
          requestBody: { required: true, content: { 'application/json': { schema: ref('Orden') } } },
          responses: { 200: json(ref('RespuestaOrden')), 401: error('Sin clave'), 403: error('Sin permiso'), 409: error('La IA no esta conectada'), 429: error('Demasiadas ordenes seguidas'), 502: error('La IA no respondio'), 503: error('La IA no esta activa en este arranque') },
        },
      },
      '/ia/ordenes/confirmar': {
        post: {
          tags: ['ia'],
          summary: 'Ejecutar las acciones que quedaron pendientes de confirmar',
          ...permiso('ia:ordenar'),
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { acciones: { type: 'array', items: { type: 'object', description: 'Cada objeto `parametros` de una pendiente, con su `accion`' } } }, required: ['acciones'] } } } },
          responses: { 200: json({ type: 'object', properties: { hechas: { type: 'array', items: ref('AccionHecha') } } }), 401: error('Sin clave'), 403: error('Sin permiso'), 503: error('La IA no esta activa') },
        },
      },
      '/ia/ordenes/catalogo': {
        get: {
          tags: ['ia'],
          summary: 'Que se le puede pedir a la IA operadora (nombre, tipo, descripcion, ejemplo)',
          ...permiso('ia:ordenar'),
          responses: { 200: json({ type: 'object', properties: { acciones: { type: 'array', items: { type: 'object' } } } }), 401: error('Sin clave'), 403: error('Sin permiso') },
        },
      },
      '/ia/lecciones': {
        post: {
          tags: ['ia'],
          summary: 'Ensenarle al asistente de WhatsApp: una leccion o miles de golpe',
          description: [
            'Una leccion es un `ejemplo` (cuando el cliente diga `pregunta`, contesta `respuesta`), un `dato` (un hecho del',
            'negocio) o una `regla` (como comportarse). Se mandan una a una o en `lecciones` (hasta 5000 por llamada).',
            'Las repetidas no entran dos veces. Con `revisar: true` quedan pendientes hasta que alguien las apruebe en',
            'la pantalla Entrenar a la IA. En cada turno el asistente usa las que vienen al caso.',
          ].join(' '),
          ...permiso('ia:entrenar'),
          requestBody: { required: true, content: { 'application/json': { schema: { oneOf: [ref('Leccion'), { type: 'object', properties: { lecciones: { type: 'array', items: ref('Leccion') }, revisar: { type: 'boolean' } }, required: ['lecciones'] }] } } } },
          responses: { 200: json({ type: 'object', properties: { ok: { type: 'boolean' }, nuevas: { type: 'integer' }, repetidas: { type: 'integer' }, ids: { type: 'array', items: { type: 'integer' } } } }), 400: error('Leccion invalida'), 401: error('Sin clave'), 403: error('Sin permiso') },
        },
        get: {
          tags: ['ia'],
          summary: 'Las lecciones del asistente, con filtros (estado, tipo, tema, origen, q) y paginadas',
          ...permiso('ia:entrenar'),
          parameters: [
            { name: 'estado', in: 'query', schema: { type: 'string', enum: ['activa', 'pendiente', 'descartada'] } },
            { name: 'tipo', in: 'query', schema: { type: 'string', enum: ['ejemplo', 'dato', 'regla'] } },
            { name: 'tema', in: 'query', schema: { type: 'string' } },
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'pagina', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limite', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
          ],
          responses: { 200: json({ type: 'object', properties: { items: { type: 'array', items: { type: 'object' } }, total: { type: 'integer' }, pagina: { type: 'integer' }, paginas: { type: 'integer' } } }), 401: error('Sin clave'), 403: error('Sin permiso') },
        },
      },

      '/conexion/canjear': {
        post: {
          tags: ['conexion'],
          summary: 'Canjear un codigo de conexion por una clave de API (sin clave previa)',
          description: [
            'Un administrador crea en el panel un codigo corto (WA-XXXX-XXXX) con fecha limite, usos y permisos. El otro sistema',
            'lo manda aqui, sin Authorization, y recibe su clave `wak_` con esos permisos y la direccion de este sistema. Cada',
            'codigo vale los usos que se le dieron (normalmente uno) y hasta su fecha; despues responde 404. Hay tope de',
            'intentos por direccion (429). El codigo se acepta como lo escriba la gente: minusculas, sin guiones, con espacios.',
          ].join(' '),
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { codigo: { type: 'string', example: 'WA-K7M3-9QXZ' }, sistema: { type: 'string', description: 'Quien canjea, para la lista (opcional)', example: 'Stoky CRM' } }, required: ['codigo'] } } } },
          responses: { 200: json({ type: 'object', properties: { ok: { type: 'boolean' }, clave: { type: 'string', example: 'wak_...' }, direccion: { type: 'string' }, para: { type: 'string' }, permisos: { type: 'array', items: { type: 'string' } }, usosRestantes: { type: 'integer' } } }), 404: error('El codigo no vale: no existe, ya se uso, caduco o fue anulado'), 409: error('Se acaba de usar'), 429: error('Demasiados intentos') },
        },
      },
      '/stoky/conexion': {
        get: {
          tags: ['stoky'],
          summary: 'Como esta la conexion de este sistema hacia Stoky (catalogo y panel), sin el token',
          ...permiso('stoky:conectar'),
          responses: { 200: json({ type: 'object', properties: { configurada: { type: 'boolean' }, url: { type: 'string' }, panelUrl: { type: 'string' }, origen: { type: 'string', enum: ['pantalla', 'stoky', 'env', 'ninguna'] }, tienda: { type: 'string', nullable: true }, almacen: { type: 'string', nullable: true }, ultimaPrueba: { type: 'object', nullable: true } } }), 401: error('Sin clave'), 403: error('Sin permiso') },
        },
        post: {
          tags: ['stoky'],
          summary: 'Stoky se presenta: su direccion, su token de conexion de tienda y su panel',
          description: [
            'Es lo que hace que vincular Stoky con este WhatsApp sea un solo boton del lado de Stoky: con la clave `wak_` que',
            'la tienda pego en Stoky, Stoky manda aqui la direccion de su API, un token `stk_` de una conexion de tienda',
            '(para que el asistente consulte precios y stock y tome pedidos) y la direccion de su panel (para registrar la',
            'venta). Se guarda cifrado y se prueba en el acto; la respuesta dice si Stoky respondio y cuantos productos hay.',
          ].join(' '),
          ...permiso('stoky:conectar'),
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { url: { type: 'string', example: 'http://localhost:8102' }, token: { type: 'string', example: 'stk_...' }, panelUrl: { type: 'string', example: 'https://stoky.miempresa.com' } }, required: ['url', 'token'] } } } },
          responses: { 200: json({ type: 'object', properties: { ok: { type: 'boolean' }, configurada: { type: 'boolean' }, prueba: { type: 'object', properties: { ok: { type: 'boolean' }, tienda: { type: 'string' }, almacen: { type: 'string' }, productos: { type: 'integer' }, detalle: { type: 'string' } } } } }), 400: error('Direccion o token invalidos'), 401: error('Sin clave'), 403: error('Sin permiso') },
        },
      },

      '/estado': {
        get: {
          tags: ['estado'],
          summary: 'Proveedor, conexion, semaforo del numero, cupo y cola',
          ...permiso('estado:leer'),
          responses: { 200: json(ref('Estado')), 401: error('Sin clave'), 403: error('Sin permiso') },
        },
      },

      '/mensajes': {
        post: {
          tags: ['mensajes'],
          summary: 'Enviar un mensaje (texto, nota de voz, fichero por URL, plantilla, pin o pedir la ubicacion)',
          description:
            'Uno de: `texto`, `media`, `plantilla`, `ubicacion`, `pedirUbicacion`. Con la API de Meta, fuera de la ventana de 24 h ' +
            'solo sale una plantilla aprobada. Si el contacto no existe se crea; con `consentimiento.origen` queda ademas con su opt-in. ' +
            'Con `voz: true`, `texto` sale como nota de voz con la voz del asistente (se configura en el panel, Mi asistente IA → Voz): si no se puede ' +
            '(sin clave, texto largo, ElevenLabs caido) sale por escrito y la respuesta trae `voz: {pedida, enviada, motivo}`. ' +
            '`autor` dice quien lo manda para el hilo y el webhook: persona (un asesor), ia (una IA de tu sistema) o sistema (por defecto).',
          ...permiso('mensajes:enviar'),
          requestBody: { required: true, content: { 'application/json': { schema: ref('NuevoMensaje') } } },
          responses: {
            200: json(ref('EnvioOk'), 'Salio'),
            202: json(ref('EnvioBloqueado'), 'Una guarda lo freno; el motivo dice cual'),
            400: error('Cuerpo incompleto o plantilla desconocida'),
            502: json(ref('EnvioError'), 'El proveedor de WhatsApp lo rechazo'),
          },
        },
      },

      '/conversaciones': {
        get: {
          tags: ['conversaciones'],
          summary: 'Lista de chats, el mas reciente primero',
          ...permiso('conversaciones:leer'),
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' }, description: 'busca por telefono o nombre' },
            { name: 'limite', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
            { name: 'desde', in: 'query', schema: { type: 'integer', default: 0 }, description: 'cuantos saltar' },
          ],
          responses: { 200: json(ref('Conversaciones')) },
        },
      },
      '/conversaciones/{telefono}': {
        get: {
          tags: ['conversaciones'],
          summary: 'El hilo con un contacto, y si se le puede escribir ahora',
          ...permiso('conversaciones:leer'),
          parameters: [
            { name: 'telefono', in: 'path', required: true, schema: { type: 'string' }, description: 'con codigo de pais, sin +' },
            { name: 'limite', in: 'query', schema: { type: 'integer', default: 60, maximum: 200 } },
            { name: 'antesDe', in: 'query', schema: { type: 'integer' }, description: 'id del mensaje mas antiguo ya visto, para paginar hacia atras' },
          ],
          responses: { 200: json(ref('Hilo')), 404: error('No hay contacto con ese telefono') },
        },
      },

      '/conversaciones/{telefono}/leido': {
        post: {
          tags: ['conversaciones'],
          summary: 'Marcar lo entrante de ese chat como leido (lo hace la pantalla embebida al abrirlo)',
          ...permiso('conversaciones:leer'),
          parameters: [{ name: 'telefono', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: json(ref('Ok')), 404: error('No hay contacto con ese telefono') },
        },
      },
      '/eventos/stream': {
        get: {
          tags: ['conversaciones'],
          summary: 'Lo que pasa, en vivo (Server-Sent Events)',
          description:
            'Un `text/event-stream` con un evento por linea `event:` (los mismos nombres de /eventos) y su payload en `data:`. ' +
            'Con un token del chat embebido limitado a un telefono, solo llega lo de ese telefono. Los EventSource no mandan cabeceras: ' +
            'un token embebido puede ir en `?token=`.',
          ...permiso('conversaciones:leer'),
          responses: { 200: { description: 'Flujo de eventos', content: { 'text/event-stream': { schema: { type: 'string' } } } }, 503: error('El flujo no esta activo en este arranque') },
        },
      },
      '/embed/token': {
        post: {
          tags: ['embebido'],
          summary: 'Un token corto para la pantalla de chat embebida',
          description:
            'Lo pide el SERVIDOR de la otra web con su clave; el token es lo que viaja al navegador y se le pasa a `WA.montar` (embed.js). ' +
            'Caduca (60 min por defecto, 12 h como mucho). Con `telefono`, solo abre ese hilo. Los permisos se acotan a los del chat y a los de la propia clave.',
          ...permiso('embed:emitir'),
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['operador'],
                  properties: {
                    operador: { type: 'string', description: 'quien tiene la pantalla abierta, como lo llama el otro sistema' },
                    telefono: { type: 'string', description: 'limitar el token a este hilo' },
                    permisos: { type: 'array', items: { type: 'string' }, description: 'por defecto: mensajes:enviar, conversaciones:leer, contactos:leer, plantillas:leer, estado:leer' },
                    duracionMin: { type: 'integer', default: 60, maximum: 720 },
                  },
                },
              },
            },
          },
          responses: { 200: json({ type: 'object', properties: { token: { type: 'string' }, caduca: { type: 'string', format: 'date-time' }, permisos: { type: 'array', items: { type: 'string' } }, url: { type: 'string', description: 'la pagina que embebe el iframe' } } }) },
        },
      },

      '/contactos': {
        get: {
          tags: ['contactos'],
          summary: 'Contactos, con busqueda',
          ...permiso('contactos:leer'),
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'limite', in: 'query', schema: { type: 'integer', default: 50 } },
            { name: 'desde', in: 'query', schema: { type: 'integer', default: 0 } },
          ],
          responses: { 200: json({ type: 'object', properties: { contactos: { type: 'array', items: ref('Contacto') }, total: { type: 'integer' } } }) },
        },
        post: {
          tags: ['contactos'],
          summary: 'Crear o actualizar un contacto y registrar su consentimiento',
          description: 'El `consentimiento.origen` es la prueba de por que se le escribe ("pedido P-1024 en la web"). Sin opt-in no sale nada iniciado por la empresa.',
          ...permiso('contactos:escribir'),
          requestBody: { required: true, content: { 'application/json': { schema: ref('NuevoContacto') } } },
          responses: { 200: json({ type: 'object' }, 'Ya existia; actualizado'), 201: json({ type: 'object' }, 'Creado') },
        },
      },
      '/contactos/{telefono}': {
        get: {
          tags: ['contactos'],
          summary: 'Un contacto',
          ...permiso('contactos:leer'),
          parameters: [{ name: 'telefono', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: json({ type: 'object', properties: { contacto: ref('Contacto') } }), 404: error('No existe') },
        },
      },
      '/contactos/{telefono}/baja': {
        post: {
          tags: ['contactos'],
          summary: 'Darlo de baja: no se le vuelve a escribir',
          ...permiso('contactos:escribir'),
          parameters: [{ name: 'telefono', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: json(ref('Ok')), 404: error('No existe') },
        },
      },

      '/plantillas': {
        get: {
          tags: ['plantillas'],
          summary: 'Plantillas aprobadas, listas para enviar',
          ...permiso('plantillas:leer'),
          responses: { 200: json({ type: 'object', properties: { plantillas: { type: 'array', items: ref('Plantilla') } } }) },
        },
      },

      '/pedidos': {
        get: { tags: ['pedidos'], summary: 'Pedidos tomados en el chat, el mas nuevo primero', ...permiso('pedidos:gestionar'), parameters: [{ name: 'estado', in: 'query', schema: { type: 'string', enum: ['nuevo', 'confirmado', 'cancelado', 'enviado_tienda'] } }, { name: 'limite', in: 'query', schema: { type: 'integer', default: 50 } }, { name: 'desde', in: 'query', schema: { type: 'integer', default: 0 } }], responses: { 200: json({ type: 'object', properties: { pedidos: { type: 'array', items: ref('Pedido') }, total: { type: 'integer' } } }) } },
      },
      '/pedidos/{id}': {
        get: { tags: ['pedidos'], summary: 'Un pedido', ...permiso('pedidos:gestionar'), parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: json({ type: 'object', properties: { pedido: ref('Pedido') } }), 404: error('No existe') } },
        patch: { tags: ['pedidos'], summary: 'Cambiar el estado (confirmado, cancelado, enviado_tienda con su externoId)', ...permiso('pedidos:gestionar'), parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['estado'], properties: { estado: { type: 'string', enum: ['nuevo', 'confirmado', 'cancelado', 'enviado_tienda'] }, externoId: { type: 'string' } } } } } }, responses: { 200: json({ type: 'object' }), 404: error('No existe') } },
      },
      '/webhooks': {
        get: { tags: ['webhooks'], summary: 'Los webhooks registrados', ...permiso('webhooks:gestionar'), responses: { 200: json({ type: 'object' }) } },
        post: {
          tags: ['webhooks'],
          summary: 'Registrar un webhook. Devuelve el secreto UNA sola vez',
          ...permiso('webhooks:gestionar'),
          requestBody: { required: true, content: { 'application/json': { schema: ref('NuevoWebhook') } } },
          responses: { 201: json({ type: 'object', properties: { webhook: ref('Webhook'), secreto: { type: 'string' } } }) },
        },
      },
      '/webhooks/{id}': {
        get: { tags: ['webhooks'], summary: 'Un webhook', ...permiso('webhooks:gestionar'), parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: json({ type: 'object' }), 404: error('No existe') } },
        patch: {
          tags: ['webhooks'],
          summary: 'Cambiar URL, eventos, descripcion o activarlo/pausarlo',
          ...permiso('webhooks:gestionar'),
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { url: { type: 'string' }, descripcion: { type: 'string' }, eventos: { type: 'array', items: { type: 'string' } }, activo: { type: 'boolean' } } } } } },
          responses: { 200: json({ type: 'object' }), 404: error('No existe') },
        },
        delete: { tags: ['webhooks'], summary: 'Borrarlo con sus entregas', ...permiso('webhooks:gestionar'), parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: json(ref('Ok')), 404: error('No existe') } },
      },
      '/webhooks/{id}/secreto': {
        post: { tags: ['webhooks'], summary: 'Secreto nuevo; el anterior deja de valer', ...permiso('webhooks:gestionar'), parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: json({ type: 'object', properties: { secreto: { type: 'string' } } }) } },
      },
      '/webhooks/{id}/entregas': {
        get: { tags: ['webhooks'], summary: 'Las ultimas entregas: que se mando y que contesto el otro lado', ...permiso('webhooks:gestionar'), parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'limite', in: 'query', schema: { type: 'integer', default: 50 } }], responses: { 200: json({ type: 'object', properties: { entregas: { type: 'array', items: ref('Entrega') } } }) } },
      },
      '/webhooks/{id}/reencolar': {
        post: { tags: ['webhooks'], summary: 'Volver a intentar las entregas fallidas', ...permiso('webhooks:gestionar'), parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: json({ type: 'object', properties: { reencoladas: { type: 'integer' } } }) } },
      },
      '/conectores/opciones': {
        get: { tags: ['conectores'], summary: 'Tipos de tienda, eventos, variables y plantillas aprobadas para armar las reglas', ...permiso('conectores:gestionar'), responses: { 200: json({ type: 'object' }) } },
      },
      '/conectores': {
        get: { tags: ['conectores'], summary: 'Los conectores de tiendas, con la URL que se pega en cada una', ...permiso('conectores:gestionar'), responses: { 200: json({ type: 'object', properties: { conectores: { type: 'array', items: ref('Conector') } } }) } },
        post: {
          tags: ['conectores'],
          summary: 'Crear un conector. Devuelve la URL y el secreto',
          description:
            'WooCommerce: el secreto se genera aqui y se escribe en WooCommerce > Ajustes > Avanzado > Webhooks. ' +
            'Shopify: el secreto lo ensena Shopify en Configuracion > Notificaciones > Webhooks y se manda en `secreto`.',
          ...permiso('conectores:gestionar'),
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['tipo', 'nombre'], properties: { tipo: { type: 'string', enum: ['woocommerce', 'shopify'] }, nombre: { type: 'string' }, secreto: { type: 'string' }, reglas: { type: 'array', items: ref('ReglaConector') } } } } } },
          responses: { 201: json({ type: 'object', properties: { conector: ref('Conector'), secreto: { type: 'string' } } }) },
        },
      },
      '/conectores/{id}': {
        get: { tags: ['conectores'], summary: 'Un conector', ...permiso('conectores:gestionar'), parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: json({ type: 'object', properties: { conector: ref('Conector') } }), 404: error('No existe') } },
        patch: {
          tags: ['conectores'],
          summary: 'Cambiar nombre, reglas o pausarlo',
          ...permiso('conectores:gestionar'),
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { nombre: { type: 'string' }, activo: { type: 'boolean' }, reglas: { type: 'array', items: ref('ReglaConector') } } } } } },
          responses: { 200: json({ type: 'object' }), 404: error('No existe') },
        },
        delete: { tags: ['conectores'], summary: 'Borrarlo', ...permiso('conectores:gestionar'), parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: json(ref('Ok')), 404: error('No existe') } },
      },
      '/conectores/{id}/secreto': {
        post: { tags: ['conectores'], summary: 'Secreto nuevo: el que se pase (Shopify) o uno generado (WooCommerce)', ...permiso('conectores:gestionar'), parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { secreto: { type: 'string' } } } } } }, responses: { 200: json({ type: 'object', properties: { secreto: { type: 'string' } } }) } },
      },
      '/conectores/{id}/entradas': {
        get: { tags: ['conectores'], summary: 'Lo que llego de la tienda y que se hizo con cada pedido', ...permiso('conectores:gestionar'), parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'limite', in: 'query', schema: { type: 'integer', default: 50 } }], responses: { 200: json({ type: 'object', properties: { entradas: { type: 'array', items: ref('EntradaConector') } } }) } },
      },
      '/conectores/{id}/probar': {
        post: {
          tags: ['conectores'],
          summary: 'Simular un pedido y mandar el mensaje de la regla a un telefono real',
          ...permiso('conectores:gestionar'),
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['telefono'], properties: { evento: { type: 'string', enum: ['pedido.creado', 'pedido.pagado', 'pedido.enviado', 'pedido.completado', 'pedido.cancelado', 'pedido.actualizado'], default: 'pedido.creado' }, telefono: { type: 'string' }, nombre: { type: 'string' }, numero: { type: 'string' }, total: { type: 'string' } } } } } },
          responses: { 200: json({ type: 'object', properties: { ok: { type: 'boolean' }, resultado: { type: 'string' }, detalle: { type: 'string', nullable: true } } }) },
        },
      },
      '/webhooks/{id}/probar': {
        post: { tags: ['webhooks'], summary: 'Mandar ahora un evento `prueba.ping` y ver que contesta la URL', ...permiso('webhooks:gestionar'), parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: json({ type: 'object', properties: { ok: { type: 'boolean' }, codigo: { type: 'integer', nullable: true }, respuesta: { type: 'string', nullable: true }, error: { type: 'string', nullable: true } } }) } },
      },
    },
    components: {
      securitySchemes: { claveApi: { type: 'http', scheme: 'bearer', description: 'Clave de API `wak_...` creada en el panel, con permisos' } },
      schemas: {
        Ok: { type: 'object', properties: { ok: { type: 'boolean' } } },
        Error: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
        Leccion: {
          type: 'object',
          properties: {
            tipo: { type: 'string', enum: ['ejemplo', 'dato', 'regla'], default: 'ejemplo' },
            pregunta: { type: 'string', description: 'Lo que dice el cliente (obligatorio en un ejemplo)' },
            respuesta: { type: 'string', description: 'Lo que hay que contestar; en un dato o una regla, el texto' },
            tema: { type: 'string', description: 'envios, pagos, precios... (opcional)' },
            mala: { type: 'string', description: 'En una correccion: lo que se dijo mal (opcional)' },
          },
          required: ['respuesta'],
        },
        Orden: {
          type: 'object',
          properties: {
            texto: { type: 'string', description: 'La orden, con palabras' },
            historial: { type: 'array', description: 'Turnos anteriores de esta conversacion (user/assistant), si la hay', items: { type: 'object', properties: { role: { type: 'string', enum: ['user', 'assistant'] }, content: { type: 'string' } } } },
            simular: { type: 'boolean', description: 'true = no ejecuta ningun cambio; dice que haria' },
          },
          required: ['texto'],
        },
        AccionHecha: {
          type: 'object',
          properties: { accion: { type: 'string' }, parametros: { type: 'object' }, tipo: { type: 'string', enum: ['consulta', 'cambio'] }, ok: { type: 'boolean' }, resumen: { type: 'string' }, ir: { type: 'string', description: 'La pantalla del panel donde se ve' } },
        },
        RespuestaOrden: {
          type: 'object',
          properties: {
            texto: { type: 'string', description: 'Lo que la IA contesta a la persona' },
            hechas: { type: 'array', items: ref('AccionHecha') },
            pendientes: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, accion: { type: 'string' }, parametros: { type: 'object' }, descripcion: { type: 'string' }, motivo: { type: 'string' } } } },
            simulado: { type: 'boolean' },
          },
        },
        Estado: {
          type: 'object',
          properties: {
            proveedor: { type: 'string', enum: ['cloud', 'local', 'waha'] },
            configurado: { type: 'boolean' },
            conectado: { type: 'boolean' },
            numero: { type: 'object', properties: { calidad: { type: 'string' }, nivel: { type: 'string', enum: ['verde', 'amarillo', 'naranja', 'rojo'] }, pausado: { type: 'boolean' }, motivoPausa: { type: 'string', nullable: true }, tier: { type: 'string', nullable: true } } },
            cupoDiario: { type: 'integer' },
            enviadosHoy: { type: 'integer' },
            cola: { type: 'object' },
            ventana24hAplica: { type: 'boolean', description: 'true con la API de Meta: fuera de 24 h solo plantilla' },
          },
        },
        NuevoMensaje: {
          type: 'object',
          required: ['telefono'],
          properties: {
            telefono: { type: 'string', example: '51987654321' },
            nombre: { type: 'string' },
            texto: { type: 'string', maxLength: 4000 },
            categoria: { type: 'string', enum: ['UTILITY', 'MARKETING'], default: 'UTILITY' },
            plantilla: { type: 'object', required: ['nombre'], properties: { nombre: { type: 'string' }, idioma: { type: 'string', default: 'es' }, variables: { type: 'array', items: { type: 'string' } } } },
            ubicacion: { oneOf: [{ type: 'object', required: ['lat', 'lng'], properties: { lat: { type: 'number' }, lng: { type: 'number' }, nombre: { type: 'string' }, direccion: { type: 'string' } } }, { type: 'string', description: 'un link de mapa' }] },
            pedirUbicacion: { type: 'boolean', description: 'boton nativo (o texto con instrucciones) para que mande su ubicacion' },
            consentimiento: { type: 'object', required: ['origen'], properties: { origen: { type: 'string', example: 'pedido P-1024 en la tienda web' } } },
            media: {
              type: 'object',
              required: ['url'],
              description: 'Una foto, un video, un audio o un documento: se baja de `url` (hasta 16 MB) y se manda',
              properties: {
                url: { type: 'string', example: 'https://mitienda.com/fotos/zapato.png' },
                tipo: { type: 'string', enum: ['imagen', 'video', 'audio', 'documento'], description: 'sin el, se deduce del tipo del fichero' },
                caption: { type: 'string', maxLength: 1024 },
                nombre: { type: 'string', description: 'el nombre con el que se ensena un documento' },
                voz: { type: 'boolean', description: 'un audio como nota de voz (con la onda y el play)' },
              },
            },
            voz: { type: 'boolean', description: 'mandar `texto` como nota de voz con la voz del asistente' },
            autor: { type: 'string', enum: ['persona', 'ia', 'sistema'], default: 'sistema', description: 'quien lo manda, para el hilo y el webhook' },
            autorNombre: { type: 'string', maxLength: 80, description: 'el nombre de pila de quien lo manda (un asesor); sale en el hilo y en el webhook' },
          },
        },
        EnvioOk: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', enum: [true] },
            estado: { type: 'string', enum: ['enviado'] },
            mensajeId: { type: 'string' },
            entregaId: { type: 'integer' },
            voz: { type: 'object', nullable: true, description: 'solo si se pidio `voz: true`', properties: { pedida: { type: 'boolean' }, enviada: { type: 'boolean' }, motivo: { type: 'string', nullable: true } } },
          },
        },
        EnvioBloqueado: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', enum: [false] },
            estado: { type: 'string', enum: ['bloqueado'] },
            codigo: { type: 'string', description: 'opt_out, no_opt_in, window_closed, template_not_approved, daily_cap, rhythm...' },
            motivo: { type: 'string' },
            reintentarEnMs: { type: 'integer', nullable: true, description: 'si viene, vale la pena volver a intentar entonces' },
            entregaId: { type: 'integer' },
          },
        },
        EnvioError: { type: 'object', properties: { ok: { type: 'boolean', enum: [false] }, estado: { type: 'string', enum: ['error'] }, error: { type: 'string' }, reintentable: { type: 'boolean' } } },
        Contacto: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            telefono: { type: 'string' },
            nombre: { type: 'string', nullable: true },
            consentimiento: { type: 'object', nullable: true, properties: { desde: { type: 'string', format: 'date-time' }, origen: { type: 'string', nullable: true } } },
            baja: { type: 'string', format: 'date-time', nullable: true },
            ultimoMensajeAt: { type: 'string', format: 'date-time', nullable: true },
          },
        },
        NuevoContacto: { type: 'object', required: ['telefono'], properties: { telefono: { type: 'string' }, nombre: { type: 'string' }, consentimiento: { type: 'object', required: ['origen'], properties: { origen: { type: 'string' } } } } },
        Conversaciones: {
          type: 'object',
          properties: {
            conversaciones: { type: 'array', items: { type: 'object', properties: { contactoId: { type: 'string' }, telefono: { type: 'string' }, nombre: { type: 'string', nullable: true }, ventanaAbierta: { type: 'boolean' }, noLeidos: { type: 'integer' }, ultimoMensaje: { type: 'object', nullable: true } } } },
            hayMas: { type: 'boolean' },
          },
        },
        Hilo: {
          type: 'object',
          properties: {
            contacto: ref('Contacto'),
            ventanaAbierta: { type: 'boolean' },
            puedeEscribir: { type: 'boolean' },
            motivo: { type: 'string', nullable: true },
            mensajes: { type: 'array', items: ref('Mensaje') },
            hayMas: { type: 'boolean' },
          },
        },
        Mensaje: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            mensajeId: { type: 'string', nullable: true, description: 'el id de WhatsApp (wamid)' },
            direccion: { type: 'string', enum: ['entrante', 'saliente'] },
            tipo: { type: 'string', description: 'text, location, image, audio, document, sticker, template, interactive...' },
            texto: { type: 'string', nullable: true, description: 'en un audio entrante transcrito, lo que dijo; en una nota de voz saliente, lo que dice' },
            autor: { type: 'string', nullable: true, enum: ['persona', 'ia', 'sistema', null], description: 'solo salientes: quien lo mando' },
            autorNombre: { type: 'string', nullable: true, description: 'solo salientes: el nombre de pila de quien lo mando, si se dijo' },
            transcripcion: { type: 'string', nullable: true, description: 'solo audios entrantes con la voz configurada: lo que dijo' },
            anuncio: { type: 'object', nullable: true, description: 'solo entrantes que vienen de un anuncio de Facebook/Instagram (click to WhatsApp)', properties: { id: { type: 'string', nullable: true }, titulo: { type: 'string', nullable: true }, texto: { type: 'string', nullable: true }, url: { type: 'string', nullable: true }, imagen: { type: 'string', nullable: true }, clid: { type: 'string', nullable: true, description: 'el id del clic (ctwa_clid)' }, origen: { type: 'string', nullable: true, description: 'ad, post...' } } },
            voz: { type: 'boolean', description: 'salio o llego como nota de voz generada' },
            datos: { type: 'object', nullable: true },
            estado: { type: 'string', nullable: true, description: 'sent, delivered, read, failed' },
            fecha: { type: 'string', format: 'date-time' },
          },
        },
        Plantilla: { type: 'object', properties: { nombre: { type: 'string' }, idioma: { type: 'string' }, categoria: { type: 'string' }, variables: { type: 'integer' }, cuerpo: { type: 'string', nullable: true }, calidad: { type: 'string', nullable: true } } },
        NuevoWebhook: {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string', format: 'uri' },
            descripcion: { type: 'string' },
            eventos: { type: 'array', items: { type: 'string', enum: [...NOMBRES_EVENTOS, '*'] }, default: ['*'] },
          },
        },
        Webhook: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            url: { type: 'string' },
            descripcion: { type: 'string' },
            eventos: { type: 'array', items: { type: 'string' } },
            activo: { type: 'boolean' },
            motivoPausa: { type: 'string', nullable: true, description: 'por que se apago solo, si fue el caso' },
            ultimoOkAt: { type: 'string', format: 'date-time', nullable: true },
            ultimoFalloAt: { type: 'string', format: 'date-time', nullable: true },
            fallosSeguidos: { type: 'integer' },
          },
        },
        Entrega: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            evento: { type: 'string' },
            payload: { type: 'object' },
            estado: { type: 'string', enum: ['pendiente', 'enviada', 'fallida'] },
            intentos: { type: 'integer' },
            proximoIntentoAt: { type: 'string', format: 'date-time' },
            respuestaCodigo: { type: 'integer', nullable: true },
            respuesta: { type: 'string', nullable: true },
            error: { type: 'string', nullable: true },
          },
        },
        ReglaConector: {
          type: 'object',
          required: ['evento'],
          properties: {
            evento: { type: 'string', enum: ['pedido.creado', 'pedido.pagado', 'pedido.enviado', 'pedido.completado', 'pedido.cancelado', 'pedido.actualizado'] },
            activo: { type: 'boolean', default: true },
            plantilla: { type: 'object', nullable: true, properties: { nombre: { type: 'string' }, idioma: { type: 'string', default: 'es' } }, description: 'con la API de Meta, lo que sale' },
            variables: { type: 'array', items: { type: 'string' }, description: 'las de la plantilla, con {numero}, {nombre}, {total}, {moneda}, {estado}, {tienda}, {seguimiento}, {items}' },
            texto: { type: 'string', nullable: true, description: 'texto libre con las mismas variables (cliente no oficial, o dentro de 24 h)' },
          },
        },
        Conector: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            tipo: { type: 'string', enum: ['woocommerce', 'shopify'] },
            nombre: { type: 'string' },
            activo: { type: 'boolean' },
            reglas: { type: 'array', items: ref('ReglaConector') },
            url: { type: 'string', description: 'lo que se pega en la tienda como URL del webhook' },
            ultimoEventoAt: { type: 'string', format: 'date-time', nullable: true },
            eventosRecibidos: { type: 'integer' },
          },
        },
        EntradaConector: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            evento: { type: 'string' },
            eventoOrigen: { type: 'string', nullable: true },
            pedido: { type: 'string', nullable: true },
            telefono: { type: 'string', nullable: true },
            resultado: { type: 'string', enum: ['enviado', 'bloqueado', 'sin_regla', 'sin_telefono', 'ignorado', 'error'] },
            detalle: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Pedido: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            estado: { type: 'string', enum: ['nuevo', 'confirmado', 'cancelado', 'enviado_tienda'] },
            items: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' }, nombre: { type: 'string' }, cantidad: { type: 'integer' }, precio: { type: 'number', nullable: true }, subtotal: { type: 'number', nullable: true }, url: { type: 'string', nullable: true } } } },
            total: { type: 'number' },
            moneda: { type: 'string' },
            nombre: { type: 'string', nullable: true },
            telefono: { type: 'string', nullable: true },
            direccion: { type: 'string', nullable: true },
            referencia: { type: 'string', nullable: true },
            pago: { type: 'string', nullable: true },
            notas: { type: 'string', nullable: true },
            origen: { type: 'string', description: 'ia, o el id del usuario que lo tomo' },
            externoId: { type: 'string', nullable: true, description: 'el id que le dio la tienda al recibirlo' },
            contactoTelefono: { type: 'string' },
            contactoNombre: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        EntregaWebhook: {
          description: 'Lo que llega por POST a la URL registrada. Cabeceras: X-Firma, X-Evento, X-Entrega.',
          type: 'object',
          properties: {
            id: { type: 'string' },
            evento: { type: 'string', enum: [...NOMBRES_EVENTOS, 'prueba.ping'] },
            fecha: { type: 'string', format: 'date-time' },
            intento: { type: 'integer' },
            datos: { type: 'object', description: 'el payload del evento; ver /api/v1/eventos' },
          },
        },
      },
    },
  };
}
