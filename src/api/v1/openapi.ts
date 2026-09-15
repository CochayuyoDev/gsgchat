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
    ],
    'x-permisos': PERMISOS,
    'x-eventos': NOMBRES_EVENTOS.map((nombre) => ({ nombre, descripcion: DESCRIPCION_EVENTOS[nombre] })),
    paths: {
      '/': { get: { summary: 'Que es esto y donde esta el contrato', responses: { 200: json({ type: 'object' }) } } },
      '/openapi.json': { get: { summary: 'Este documento', responses: { 200: json({ type: 'object' }) } } },
      '/eventos': { get: { summary: 'Los eventos que se pueden suscribir y como se firma cada entrega', responses: { 200: json({ type: 'object' }) } } },

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
          summary: 'Enviar un mensaje (texto, plantilla, pin o pedir la ubicacion)',
          description:
            'Uno de: `texto`, `plantilla`, `ubicacion`, `pedirUbicacion`. Con la API de Meta, fuera de la ventana de 24 h ' +
            'solo sale una plantilla aprobada. Si el contacto no existe se crea; con `consentimiento.origen` queda ademas con su opt-in.',
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
          },
        },
        EnvioOk: { type: 'object', properties: { ok: { type: 'boolean', enum: [true] }, estado: { type: 'string', enum: ['enviado'] }, mensajeId: { type: 'string' }, entregaId: { type: 'integer' } } },
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
            texto: { type: 'string', nullable: true },
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
