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
      title: 'GSGchat: API publica',
      version: '1.0.0',
      description: [
        'La puerta para GSG y otros sistemas autorizados. Se entra con una clave de API',
        'creada en API y endpoint GSG, con los permisos justos, en la cabecera',
        '`X-API-Key: <API Key>`.',
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
      { name: 'entregas' },
      { name: 'procesos' },
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
            '`hechas` (las consultas, que se hacen al momento, y lo que no se pudo preparar), `pendientes` (TODO',
            'cambio, ya preparado con su `tarjeta`: qué, a quién, cuántos, antes y después; no se hace nada hasta',
            'confirmarlo con /ia/ordenes/confirmar) y `elegir` (cambios con varios candidatos: se elige una opción',
            'y se prepara con /ia/ordenes/preparar). Con `simular: true` no cambia nada.',
          ].join(' '),
          ...permiso('ia:ordenar'),
          requestBody: { required: true, content: { 'application/json': { schema: ref('Orden') } } },
          responses: { 200: json(ref('RespuestaOrden')), 401: error('Sin clave'), 403: error('Sin permiso'), 409: error('La IA no esta conectada'), 429: error('Demasiadas ordenes seguidas'), 502: error('La IA no respondio'), 503: error('La IA no esta activa en este arranque') },
        },
      },
      '/ia/ordenes/preparar': {
        post: {
          tags: ['ia'],
          summary: 'Preparar la tarjeta de UNA acción (la opción elegida de `elegir`), sin cambiar nada',
          ...permiso('ia:ordenar'),
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { accion: { type: 'object', description: 'Los `parametros` de la opción elegida, con su `accion`' } }, required: ['accion'] } } } },
          responses: { 200: json({ type: 'object', properties: { pendiente: { type: 'object' }, elegir: { type: 'object' } } }), 400: error('No se puede preparar (dice por qué)'), 401: error('Sin clave'), 403: error('Sin permiso') },
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
            'lo manda aqui, sin clave (sin X-API-Key), y recibe su API Key con esos permisos y la direccion de este sistema. Cada',
            'codigo vale los usos que se le dieron (normalmente uno) y hasta su fecha; despues responde 404. Hay tope de',
            'intentos por direccion (429). El codigo se acepta como lo escriba la gente: minusculas, sin guiones, con espacios.',
          ].join(' '),
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { codigo: { type: 'string', example: 'WA-K7M3-9QXZ' }, sistema: { type: 'string', description: 'Quien canjea, para la lista (opcional)', example: 'Stoky CRM' } }, required: ['codigo'] } } } },
          responses: { 200: json({ type: 'object', properties: { ok: { type: 'boolean' }, clave: { type: 'string', example: 'Xq3f9aK2...' }, direccion: { type: 'string' }, para: { type: 'string' }, permisos: { type: 'array', items: { type: 'string' } }, usosRestantes: { type: 'integer' } } }), 404: error('El codigo no vale: no existe, ya se uso, caduco o fue anulado'), 409: error('Se acaba de usar'), 429: error('Demasiados intentos') },
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
      '/entregas': {
        get: { tags: ['entregas'], summary: 'Las entregas del dia: como va cada pedido (ubicacion y confirmacion)', ...permiso('entregas:leer'), responses: { 200: json({ type: 'object', properties: { dia: { type: 'string' }, cifras: { type: 'object' }, entregas: { type: 'array', items: { type: 'object' } }, motorizados: { type: 'array', items: { type: 'object' } } } }) } },
        post: {
          tags: ['entregas'],
          summary: 'GSG empuja: uno o varios pedidos de hoy (sin esperar a que se le pregunte)',
          description: [
            'Obligatorios en cada pedido (lo que GSG manda siempre): `tracking`, `cliente`, `telefono`, `empresa`, `metodoPago` y `montoCobrar`. Opcionales: `distrito`, `direccion`, `fecRuta`, `telefono2`, `producto` y `cantBultos`. Si falta uno, 400 con `detalles` campo por campo y no se guarda ninguno de la llamada. Con `lat`/`lng` ya no se le pide la ubicacion al cliente.',
            'La clave decide la tienda: 401 sin clave, con una que no existe o revocada; 403 si es valida pero sin `entregas:gestionar`; 404 si se usa la ruta con nombre de tienda; 409 si la clave esta en dos tiendas.',
            'Cada pedido creado vuelve con su `id` (el de este sistema, leido de la base tras guardarlo; el de GSG va en `idExterno`) y su `mensaje` (el primer mensaje al cliente: retenido, encolado, enviado, reintentando, fallido o incierto). Si el pedido se guardo pero su mensaje no salio, la respuesta sigue siendo 201 y lo cuenta en `avisosMensaje`.',
            '`faltaUbicacion` (por defecto true) y `faltaConfirmar` (por defecto true) dicen que le falta a cada uno; `urgente` lo pone primero hacia el motorizado.',
            'Se acepta un pedido suelto, una lista `[...]` o `{ pedidos: [...] }` (hasta 600). Un pedido repetido hoy no se duplica (`repetidas`); uno sin telefono valido va en `descartadas` con su motivo.',
            'Lo que pasa despues (confirmo, se le aviso la hora, se entrego, incidencia) llega por los webhooks `entrega.*`.',
          ].join(' '),
          ...permiso('entregas:gestionar'),
          requestBody: { required: true, content: { 'application/json': { schema: { oneOf: [ref('PedidoGsg'), { type: 'array', items: ref('PedidoGsg') }, { type: 'object', properties: { pedidos: { type: 'array', items: ref('PedidoGsg') } } }] } } } },
          servers: [{ url: `${new URL(baseUrl).origin}/api/v1` }],
          responses: {
            201: json({ type: 'object', properties: { ok: { type: 'boolean' }, creadas: { type: 'array', items: ref('EntregaDia') }, repetidas: { type: 'array', items: { type: 'string' } }, existentes: { type: 'array', items: { type: 'object', properties: { referencia: { type: 'string' }, id: { type: 'integer', nullable: true } } } }, descartadas: { type: 'array', items: { type: 'object', properties: { referencia: { type: 'string' }, motivo: { type: 'string' } } } }, avisosMensaje: { type: 'array', items: { type: 'object' } }, detalle: { type: 'string' } } }, 'Al menos un pedido nuevo, guardado (con su id real)'),
            200: json({ type: 'object' }, 'Nada nuevo: todo ya estaba (`existentes` trae sus ids). Repetir la misma llamada es seguro'),
            400: error('VALIDACION (faltan campos o no tienen el formato; o ningun pedido tenia un telefono valido) o JSON_INVALIDO'),
            401: error('CLAVE_AUSENTE, CLAVE_INVALIDA o CLAVE_REVOCADA (con WWW-Authenticate)'),
            403: error('SIN_PERMISO (la clave no tiene entregas:gestionar) o TIENDA_SUSPENDIDA'),
            404: error('RUTA_NO_EXISTE: la recepcion con /tienda/<nombre> no existe; se usa POST /api/v1/entregas'),
            405: { ...error('METODO_NO_PERMITIDO: método no admitido en la ruta'), headers: { Allow: { schema: { type: 'string' }, description: 'Métodos admitidos: GET, HEAD, POST' } } },
            409: error('CLAVE_AMBIGUA: la clave esta registrada en mas de una tienda'),
            413: error('CUERPO_DEMASIADO_GRANDE: más de 4 MiB; dividir la llamada'),
            415: error('TIPO_CONTENIDO_NO_SOPORTADO: se exige Content-Type: application/json'),
            429: error('DEMASIADAS_PETICIONES: mas de 120 por minuto con esta clave (con Retry-After)'),
            500: error('ERROR_INTERNO: no se guardo nada seguro; repetir la misma llamada no duplica'),
            503: error('BASE_NO_DISPONIBLE: la base no contesta (con Retry-After); repetir la misma llamada no duplica'),
          },
        },
      },
      '/entregas/{referencia}': {
        get: { tags: ['entregas'], summary: 'Como va ese pedido hoy, con sus eventos', ...permiso('entregas:leer'), parameters: [{ name: 'referencia', in: 'path', required: true, schema: { type: 'string' }, description: 'La referencia del pedido (o su id en GSG)' }], responses: { 200: json({ type: 'object', properties: { ok: { type: 'boolean' }, entrega: ref('EntregaDia'), eventos: { type: 'array', items: { type: 'object', properties: { en: { type: 'string' }, tipo: { type: 'string' }, detalle: { type: 'string', nullable: true } } } } } }), 404: error('No hay ningun pedido de hoy con esa referencia') } },
        patch: {
          tags: ['entregas'],
          summary: 'GSG cambio datos del pedido: nombre, direccion, distrito, notas, urgente o los datos del envio (producto, empresa, tracking, nroPedido, metodoPago, monto, remitente); el telefono no: es otro pedido',
          ...permiso('entregas:gestionar'),
          parameters: [{ name: 'referencia', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, properties: { nombre: { type: 'string' }, direccion: { type: 'string' }, distrito: { type: 'string' }, notas: { type: 'string' }, urgente: { type: 'boolean' }, producto: { type: 'string' }, empresa: { type: 'object', properties: { codigo: { type: 'string' }, nombre: { type: 'string' } } }, tracking: { type: 'string' }, nroPedido: { type: 'string' }, metodoPago: { type: 'string' }, monto: { oneOf: [{ type: 'number' }, { type: 'string' }] }, remitente: { type: 'string' } } } } } },
          responses: { 200: json({ type: 'object', properties: { ok: { type: 'boolean' }, cambios: { type: 'array', items: { type: 'string' } }, entrega: ref('EntregaDia'), detalle: { type: 'string' } } }), 400: error('El cambio no se entiende, o se intento cambiar el telefono'), 404: error('No existe'), 409: error('Ya estaba entregado, cancelado o terminado'), 429: error('Mas de 120 peticiones por minuto con esta clave') },
        },
        delete: { tags: ['entregas'], summary: 'Cancelar ese pedido (GSG lo dio de baja)', ...permiso('entregas:gestionar'), parameters: [{ name: 'referencia', in: 'path', required: true, schema: { type: 'string' } }, { name: 'motivo', in: 'query', schema: { type: 'string' } }], responses: { 200: json({ type: 'object', properties: { ok: { type: 'boolean' }, entrega: ref('EntregaDia'), detalle: { type: 'string' } } }), 404: error('No existe'), 409: error('Ya estaba entregado o cancelado') } },
      },
      '/seguimiento': {
        post: {
          tags: ['entregas'],
          summary: 'GSG empuja el seguimiento de un pedido (GSGchat nunca lo pide)',
          description: [
            'GSG manda, cuando quiera, la posición del motorizado y la ruta que falta de un tracking ya recibido por POST /entregas. Se valida y se guarda el último de cada tracking; con él (mientras tenga menos de 30 minutos y la posición menos de 10) se contesta al cliente que pregunta dónde está su pedido. Si no hay uno reciente, GSGchat arma el seguimiento con sus propios datos.',
            '`puntoActual` es la última parada atendida, `puntoCliente` la del cliente y `paradas` solo las que faltan, en orden, hasta la del cliente incluida (con `secuenciaCompleta: true` se aceptan huecos en la numeración).',
            'Google Maps calcula km y minutos solo cuando el cliente pregunta, y una sola vez por versión de los datos.',
          ].join(' '),
          ...permiso('entregas:gestionar'),
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['tracking'], properties: {
            tracking: { type: 'string' },
            estado: { type: 'string', enum: ['pendiente', 'en_reparto', 'llegando', 'entregado', 'cancelado', 'incidencia'], default: 'en_reparto' },
            posicion: { type: 'object', required: ['lat', 'lng', 'actualizadaAt'], properties: { lat: { type: 'number' }, lng: { type: 'number' }, actualizadaAt: { type: 'string', format: 'date-time' } } },
            puntoActual: { type: 'integer', minimum: 0 },
            puntoCliente: { type: 'integer', minimum: 1 },
            paradas: { type: 'array', maxItems: 100, items: { type: 'object', required: ['lat', 'lng', 'orden'], properties: { lat: { type: 'number' }, lng: { type: 'number' }, orden: { type: 'integer', minimum: 1 }, servicioMinutos: { type: 'number', minimum: 0, maximum: 120 } } } },
            secuenciaCompleta: { type: 'boolean', default: false },
            versionRuta: { type: 'string' },
          } } } } },
          responses: {
            201: json({ type: 'object', properties: { ok: { type: 'boolean' }, tracking: { type: 'string' }, referencia: { type: 'string' }, estado: { type: 'string' }, puntoActual: { type: 'integer', nullable: true }, puntoCliente: { type: 'integer', nullable: true }, paradas: { type: 'integer' } } }, 'Guardado: es el seguimiento vigente de ese tracking'),
            400: error('VALIDACION: falta `tracking` o el cuerpo no es un objeto'),
            401: error('CLAVE_AUSENTE, CLAVE_INVALIDA o CLAVE_REVOCADA (con WWW-Authenticate)'),
            403: error('SIN_PERMISO (la clave no tiene entregas:gestionar)'),
            404: error('NO_EXISTE: no hay ningún pedido con ese tracking'),
            422: error('VALIDACION: el seguimiento no cumple el contrato (`detalles.motivo`: contrato, ruta_incompleta, gps_antiguo, ruta_incoherente)'),
          },
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






      '/webhooks/{id}/probar': {
        post: { tags: ['webhooks'], summary: 'Mandar ahora un evento `prueba.ping` y ver que contesta la URL', ...permiso('webhooks:gestionar'), parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: json({ type: 'object', properties: { ok: { type: 'boolean' }, codigo: { type: 'integer', nullable: true }, respuesta: { type: 'string', nullable: true }, error: { type: 'string', nullable: true } } }) } },
      },
    },
    components: {
      securitySchemes: {
        claveApi: { type: 'apiKey', in: 'header', name: 'X-API-Key', description: 'API Key creada en el panel, con permisos, en la cabecera X-API-Key' },
      },
      schemas: {
        Ok: { type: 'object', properties: { ok: { type: 'boolean' } } },
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            ok: { type: 'boolean', enum: [false] },
            codigo: { type: 'string', description: 'Estable, para comparar desde otro sistema: VALIDACION, JSON_INVALIDO, METODO_NO_PERMITIDO, CUERPO_DEMASIADO_GRANDE, TIPO_CONTENIDO_NO_SOPORTADO, CLAVE_AUSENTE, CLAVE_INVALIDA, CLAVE_REVOCADA, SIN_PERMISO, TIENDA_SUSPENDIDA, RUTA_NO_EXISTE, NO_EXISTE, CLAVE_AMBIGUA, CONFLICTO, MENSAJE_EN_CURSO, MENSAJE_YA_ENVIADO, RESULTADO_INCIERTO, ESPERA_CONFIRMACION, DEMASIADAS_PETICIONES, BASE_NO_DISPONIBLE, ERROR_INTERNO' },
            error: { type: 'string', description: 'El motivo en palabras' },
            detalles: { description: 'Campo por campo cuando aplica', oneOf: [{ type: 'array', items: { type: 'object', properties: { campo: { type: 'string' }, mensaje: { type: 'string' } } } }, { type: 'object' }] },
          },
        },
        PedidoGsg: {
          type: 'object',
          description: 'Obligatorios: tracking (o codigoTracking), cliente (o nombre), telefono, empresa, metodoPago y montoCobrar (o monto). Opcionales del contrato: distrito, direccion, fecRuta, telefono2, producto, cantBultos. Los demas campos se aceptan por compatibilidad.',
          required: ['telefono', 'empresa', 'metodoPago'],
          allOf: [
            { anyOf: [{ required: ['tracking'] }, { required: ['codigoTracking'] }, { required: ['referencia'] }] },
            { anyOf: [{ required: ['cliente'] }, { required: ['nombre'] }] },
            { anyOf: [{ required: ['montoCobrar'] }, { required: ['monto'] }] },
          ],
          properties: {
            referencia: { type: 'string', description: 'El numero de pedido en GSG (P-1001)' },
            telefono: { type: 'string', description: 'El WhatsApp del cliente: 987654321 o 51987654321' },
            nombre: { type: 'string', nullable: true },
            direccion: { type: 'string', nullable: true },
            distrito: { type: 'string', nullable: true },
            notas: { type: 'string', nullable: true },
            lat: { type: 'number', nullable: true, description: 'Si GSG ya tiene la ubicacion: con lat y lng no se le pide al cliente' },
            lng: { type: 'number', nullable: true },
            id: { type: 'string', nullable: true, description: 'El id del pedido en GSG, si es distinto de la referencia' },
            faltaUbicacion: { type: 'boolean', default: true },
            faltaConfirmar: { type: 'boolean', default: true },
            urgente: { type: 'boolean', default: false },
            costServ: { oneOf: [{ type: 'string', maxLength: 200 }, { type: 'number' }], nullable: true },
            referenciaDireccion: { oneOf: [{ type: 'string', maxLength: 200 }, { type: 'number' }], nullable: true },
            fecRegistro: { oneOf: [{ type: 'string', maxLength: 200 }, { type: 'number' }], nullable: true },
            fecRuta: { oneOf: [{ type: 'string', maxLength: 200 }, { type: 'number' }], nullable: true },
            horarioEntrega: { type: 'object', nullable: true, required: ['desde', 'hasta'], description: 'Ventana aproximada de GSG. Sin fechas, desde precede a hasta. Para cruzar medianoche se requieren fechaDesde, fechaHasta y zonaHoraria.', properties: { desde: { type: 'string', example: '22:00' }, hasta: { type: 'string', example: '02:00' }, fechaDesde: { type: 'string', format: 'date', example: '2026-10-07' }, fechaHasta: { type: 'string', format: 'date', example: '2026-10-08' }, zonaHoraria: { type: 'string', example: 'America/Lima' } } },
            observacionCliente: { oneOf: [{ type: 'string', maxLength: 200 }, { type: 'number' }], nullable: true },
            detalleProducto: { oneOf: [{ type: 'string', maxLength: 200 }, { type: 'number' }], nullable: true },
            telefono2: { oneOf: [{ type: 'string', maxLength: 200 }, { type: 'number' }], nullable: true },
            tamano: { oneOf: [{ type: 'string', maxLength: 200 }, { type: 'number' }], nullable: true },
            cantBultos: { oneOf: [{ type: 'integer', minimum: 0 }, { type: 'string', pattern: '^[0-9]+$' }], nullable: true },
            clientePagaDelivery: { oneOf: [{ type: 'boolean' }, { type: 'string', maxLength: 200 }], nullable: true, description: 'Booleanos se guardan como si/no' },
            sede: { oneOf: [{ type: 'string', maxLength: 200 }, { type: 'number' }], nullable: true },
            tipoRuta: { oneOf: [{ type: 'string', maxLength: 200 }, { type: 'number' }], nullable: true },
            nroDocumento: { oneOf: [{ type: 'string', maxLength: 200 }, { type: 'number' }], nullable: true },
            agenciaNombre: { oneOf: [{ type: 'string', maxLength: 200 }, { type: 'number' }], nullable: true },
            agenciaDestino: { oneOf: [{ type: 'string', maxLength: 200 }, { type: 'number' }], nullable: true },
            pagoEnDestino: { oneOf: [{ type: 'boolean' }, { type: 'string', maxLength: 200 }], nullable: true, description: 'Booleanos se guardan como si/no' },
            cliente: { type: 'string', description: 'Alias de nombre' },
            codigoTracking: { type: 'string', description: 'Alias de tracking; se usa como referencia si se omite referencia' },
            driver: { oneOf: [{ type: 'string' }, { type: 'object', properties: { nombre: { type: 'string' }, telefono: { type: 'string' } } }] },
            montoCobrar: { oneOf: [{ type: 'number' }, { type: 'string' }], description: 'Alias de monto' },
            producto: { type: 'string', nullable: true, description: 'Lo que se entrega (sale en el primer mensaje): "Zapatillas talla 40"' },
            empresa: { type: 'object', nullable: true, description: 'La tienda que vende: {codigo: "516", nombre: "Zapatería Lima"}. Tambien se acepta empresaCodigo/empresaNombre o tiendaCodigo/tiendaNombre sueltos', properties: { codigo: { type: 'string', nullable: true }, nombre: { type: 'string', nullable: true } } },
            tracking: { type: 'string', nullable: true, description: 'El codigo de seguimiento de GSG: "GSG-A-102345"' },
            nroPedido: { type: 'string', nullable: true, description: 'El numero de pedido de la tienda: "#1042"' },
            metodoPago: { type: 'string', nullable: true, description: '"YAPE", "Efectivo", "Pagado"...' },
            monto: { oneOf: [{ type: 'number' }, { type: 'string' }], nullable: true, description: 'Lo que el motorizado cobra: 85 o "85.00" (un numero sale con 2 decimales)' },
            remitente: { type: 'string', nullable: true, description: 'Quien firma el envío ("Juan Quispe"). El primer mensaje al cliente dice "Somos GSG Courier"' },          },
        },
        EntregaDia: {
          type: 'object',
          properties: {
            id: { type: 'integer', description: 'El id del pedido en este sistema (la fila guardada)' },
            idExterno: { type: 'string', nullable: true, description: 'El id que mando GSG, si mando uno' },
            mensaje: { type: 'object', description: 'El primer mensaje al cliente, aparte del pedido', properties: { estado: { type: 'string', enum: ['no_aplica', 'retenido', 'pendiente', 'encolado', 'enviando', 'enviado', 'reintentando', 'fallido', 'incierto'] }, via: { type: 'string', nullable: true, enum: ['ubicacion', 'confirmacion', null] }, intentos: { type: 'integer' }, ultimoIntentoEn: { type: 'string', nullable: true }, proximoIntentoEn: { type: 'string', nullable: true }, enviadoEn: { type: 'string', nullable: true }, codigo: { type: 'string', nullable: true }, motivo: { type: 'string', nullable: true }, permanente: { type: 'boolean' }, puedeReintentar: { type: 'boolean' }, requiereConfirmar: { type: 'boolean' } } },
            costServ: { type: 'string', nullable: true },
            referenciaDireccion: { type: 'string', nullable: true },
            fecRegistro: { type: 'string', nullable: true },
            fecRuta: { type: 'string', nullable: true },
            horarioEntrega: { type: 'object', nullable: true, required: ['desde', 'hasta'], description: 'Ventana aproximada de GSG. Sin fechas, desde precede a hasta. Para cruzar medianoche se requieren fechaDesde, fechaHasta y zonaHoraria.', properties: { desde: { type: 'string', example: '22:00' }, hasta: { type: 'string', example: '02:00' }, fechaDesde: { type: 'string', format: 'date', example: '2026-10-07' }, fechaHasta: { type: 'string', format: 'date', example: '2026-10-08' }, zonaHoraria: { type: 'string', example: 'America/Lima' } } },
            observacionCliente: { type: 'string', nullable: true },
            detalleProducto: { type: 'string', nullable: true },
            telefono2: { type: 'string', nullable: true },
            tamano: { type: 'string', nullable: true },
            cantBultos: { type: 'string', nullable: true },
            clientePagaDelivery: { type: 'string', nullable: true },
            sede: { type: 'string', nullable: true },
            tipoRuta: { type: 'string', nullable: true },
            nroDocumento: { type: 'string', nullable: true },
            agenciaNombre: { type: 'string', nullable: true },
            agenciaDestino: { type: 'string', nullable: true },
            pagoEnDestino: { type: 'string', nullable: true },
            referencia: { type: 'string' },
            dia: { type: 'string' },
            telefono: { type: 'string' },
            nombre: { type: 'string', nullable: true },
            direccion: { type: 'string', nullable: true },
            distrito: { type: 'string', nullable: true },
            estado: { type: 'string', enum: ['pendiente', 'esperando_ubicacion', 'esperando_confirmacion', 'lista', 'esperando_motorizado', 'avisada', 'entregada', 'terminada', 'cancelada', 'incidencia'] },
            situacion: { type: 'string', description: 'Que le esta pasando ahora mismo, en palabras' },
            prioridad: { type: 'string', enum: ['normal', 'urgente'] },
            ubicacion: { type: 'object', properties: { estado: { type: 'string' }, lat: { type: 'number', nullable: true }, lng: { type: 'number', nullable: true }, mapa: { type: 'string', nullable: true }, recibidaEn: { type: 'string', nullable: true } } },
            confirmacion: { type: 'object', properties: { estado: { type: 'string' }, intentos: { type: 'integer' }, respuesta: { type: 'string', nullable: true }, como: { type: 'string', nullable: true }, en: { type: 'string', nullable: true } } },
            motorizado: { type: 'object', nullable: true, properties: { nombre: { type: 'string' }, telefono: { type: 'string' }, placa: { type: 'string', nullable: true } } },
            minutosMotorizado: { type: 'integer', nullable: true },
            minutosAviso: { type: 'integer', nullable: true, description: 'Lo que se le dijo al cliente: lo del motorizado mas el margen' },
            llegaAproxEn: { type: 'string', nullable: true },
            avisadaEn: { type: 'string', nullable: true },
            entregadaEn: { type: 'string', nullable: true },
            entregadaComo: { type: 'string', nullable: true },
            incidencia: { type: 'object', nullable: true, properties: { codigo: { type: 'string' }, detalle: { type: 'string', nullable: true } } },
          },
        },
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
