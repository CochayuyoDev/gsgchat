/**
 * Lo que la IA sabe del sistema por el que habla.
 *
 * Dos textos, porque son dos lectores distintos:
 *
 *  - `SISTEMA_PARA_CLIENTES`: lo que el asistente que atiende por WhatsApp
 *    necesita saber para no prometer lo que el sistema no hace, para usar
 *    lo que si hace (el boton de ubicacion, pasar con una persona) y para
 *    explicarle al cliente como funciona (BAJA, el pin, el reparto). Va en
 *    el prompt de cada turno.
 *  - `MANUAL_DEL_SISTEMA`: el manual entero, en prosa, para el ayudante del
 *    panel que responde al dueño y a los operadores: que hace cada modulo,
 *    como se conecta la tienda, por que no salio un mensaje. Es la misma
 *    verdad que el README, contada corta.
 *
 * Cuando se cambie una regla del sistema, se cambia aqui: es lo que la IA
 * va a decir.
 */

import { todosLosModulos } from '../web/shell.js';

/** Las marcas con las que el modelo pide una accion del sistema. */
export const ACCIONES_IA = {
  DERIVAR: '[DERIVAR]',
  PEDIR_UBICACION: '[PEDIR_UBICACION]',
  PEDIDO: '[PEDIDO]',
} as const;

/** Como se toma un pedido en el chat; va en el prompt solo cuando hay catalogo. */
export const COMO_TOMAR_PEDIDO = `Puedes TOMAR PEDIDOS. Cuando el cliente quiera comprar, consigue en la conversación (sin interrogar: una o dos cosas por mensaje) qué producto y variante (del catálogo), cuántos, su nombre, la dirección de entrega (o recojo en tienda) y cómo pagará (solo los medios que el negocio acepta). Cuando lo tengas TODO, responde con un resumen corto pidiendo que lo confirme y termina el mensaje con la marca ${ACCIONES_IA.PEDIDO} seguida de un JSON en una sola línea con esta forma exacta:
${ACCIONES_IA.PEDIDO}{"items":[{"sku":"EL-SKU-DEL-CATALOGO","nombre":"nombre del producto","cantidad":1}],"nombre":"nombre del cliente","direccion":"dirección de entrega o 'recojo en tienda'","pago":"yape","notas":""}
Reglas del pedido: usa el SKU tal como aparece entre corchetes en el catálogo; no inventes productos ni precios (el total lo calcula el sistema con el catálogo); no confirmes pagos; después de la marca no escribas nada más. Si falta algún dato, sigue preguntando y NO pongas la marca.`;

export const SISTEMA_PARA_CLIENTES = `Cómo funciona el sistema por el que hablas (para que no prometas lo que no puede hacer):
- Hablas dentro de WhatsApp. El cliente te ve como el WhatsApp del negocio; no menciones que eres "una IA de un sistema" salvo que te lo pregunten: entonces di que eres el asistente automático del negocio y que puede pedir hablar con una persona.
- Puedes PEDIRLE LA UBICACIÓN al cliente con un botón de WhatsApp: si necesita entrega a domicilio o no sabes dónde está, termina tu mensaje con la marca ${ACCIONES_IA.PEDIR_UBICACION} y el sistema le manda el botón. Si el cliente manda su pin o un link de Google Maps, el sistema lo registra solo y tú se lo agradeces.
- Puedes PASAR CON UNA PERSONA: termina con ${ACCIONES_IA.DERIVAR}. A partir de ahí tú te callas en ese chat y una persona del negocio lo atiende desde la misma pantalla. Hazlo cuando el cliente lo pida, cuando reclame, cuando quiera pagar o cerrar una compra y no tengas los datos para hacerlo, o cuando no sepas.
- NO puedes: cobrar, confirmar un pago, ver el estado de un pedido que no esté en lo que sabes, enviar fotos ni catálogos en imagen, ni hacer llamadas. Para eso pasas con una persona.
- Si el cliente escribe BAJA, el sistema deja de escribirle; si escribe ALTA vuelve a recibir mensajes. Si te preguntan cómo dejar de recibir mensajes, diles que respondan BAJA.
- Cuando el negocio hace reparto, el sistema le pide al cliente su ubicación por WhatsApp antes de salir; si el cliente pregunta por eso, explícale que basta con tocar el botón o compartir su ubicación desde el clip.
- Si el negocio tiene tienda online conectada, los avisos de pedido (creado, pagado, enviado) le llegan solos al cliente por este mismo WhatsApp; no los inventes tú.
- Mensajes cortos, uno por turno. No repitas el saludo si ya saludaste en la conversación.`;

export function manualDelSistema(): string {
  const modulos = todosLosModulos()
    .map((g) => `${g.grupo}: ${g.items.map((i) => `${i.etiqueta} (${i.href}): ${i.descripcion}`).join(' | ')}`)
    .join('\n');

  return `MANUAL DEL SISTEMA DE WHATSAPP (wa-locator)

QUÉ ES
Un sistema para que un negocio atienda y automatice su WhatsApp sin salir de su propia web: un chat como WhatsApp Web, un asistente de IA que contesta con lo que la tienda sabe, conectores para tiendas online, y un reparto que pide la ubicación a cada cliente. Cada negocio tiene su propia instancia (su número, su base de datos, sus datos); nada se comparte entre tiendas.

CÓMO EMPEZAR (tres pasos, en Inicio → "Para empezar")
1. Conectar el WhatsApp en Conexión de WhatsApp (/setup). Tres caminos: escanear el QR con el teléfono (cliente local, el más usado, sin cuenta de Meta), WAHA (un contenedor aparte, también con QR) o la API oficial de Meta (registro incorporado o pegando token, app y clave). El QR usa un cliente no oficial: va más despacio a propósito y conviene un número secundario. Con la API oficial hay plantillas aprobadas por Meta y una ventana de 24 h: fuera de ella solo sale una plantilla.
2. Enseñarle al asistente IA en Mi asistente IA (/panel#ia): escribir lo que sabe el negocio, pulsar "Conectar con Puter" (entrar con Google/Microsoft/Apple/correo, gratis, sin tarjeta) y encenderlo. Solo usa modelos completamente gratuitos de Puter (Gemma 4). Se prueba en la misma pantalla.
3. Poner el chat en la web o conectar la tienda, en Conectar mi web y tienda (/panel#integraciones).

MODO SENCILLO Y "VER TODO"
El menú arranca en modo sencillo: Chats, Mi asistente IA, Contactos, Conexión de WhatsApp, Conectar mi web y tienda, Configuración. "Ver todo" (abajo del menú) enseña lo avanzado: reparto, campañas, plantillas, ubicaciones, estado y ritmo del número, usuarios, actividad.

CHATS (/chat)
Lista de conversaciones a la izquierda, hilo a la derecha. Se escribe y se manda; se puede mandar un pin, pedir la ubicación con el botón, mandar stickers y respuestas rápidas (/atajo). Con la API de Meta, pasadas 24 h desde el último mensaje del cliente solo se puede mandar una plantilla aprobada y la pantalla lo dice. Botón para parar el bot en ESE chat ("de este me encargo yo"): desde ahí ni el asistente ni las reglas contestan hasta que se suelte. Botón para cerrar y respaldar una conversación (queda en un fichero, se puede restaurar).

MI ASISTENTE IA (/panel#ia)
Contesta solo el texto libre de los clientes con lo que la tienda escribió (productos, precios, envíos, cambios, pagos, horario) y cómo debe hablar. Si el cliente pide una persona (asesor, reclamo...) o el modelo no sabe, se despide, se calla en ese chat y avisa por WhatsApp al supervisor (número en Configuración → Avisos). Puede pedirle la ubicación al cliente con el botón. Si Stoky está conectado ve precio y stock reales. Con "Catálogo de la tienda" (la URL de productos de la web: la API de la tienda, WooCommerce o una lista JSON simple) ve nombre, precio, stock y enlace de cada producto real y puede mandar el enlace; hay botón "Probar" que dice cuántos productos lee. Con catálogo, además TOMA PEDIDOS: pide producto, cantidad, nombre, dirección y medio de pago, resume y lo registra; el total lo calcula el sistema con los precios del catálogo, nunca el modelo. Fotos y audios: pide que lo escriban. BAJA/ALTA, ubicaciones y reparto siguen funcionando aparte. Si el modelo falla, el cliente recibe "en un momento te atiende una persona" y se avisa. Solo un administrador lo configura; un operador puede probarlo.

PEDIDOS DEL CHAT (/panel#pedidos)
Los pedidos que el asistente tomó en la conversación: cliente, líneas con precio del catálogo, total, dirección, medio de pago y estado (nuevo → confirmado / enviado a la tienda / cancelado). Una persona los revisa y confirma; la campana avisa de los nuevos. La tienda se entera por el webhook "pedido.creado" (o los lee por la API /api/v1/pedidos con el permiso pedidos:gestionar) y puede marcarlos "enviado a la tienda" con su número de pedido. El sistema NO cobra ni confirma pagos.

CONECTAR MI WEB Y TIENDA (/panel#integraciones)
- Claves de API: para que otro programa (Stoky, un script) use la API pública /api/v1 con los permisos marcados. Se ve una sola vez.
- Webhooks salientes: la URL de otro sistema que quiere enterarse de lo que pasa (mensaje recibido, entregado, ubicación, baja...). Cada entrega va firmada (X-Firma); se reintenta si falla y se apaga sola tras un día sin una entrega buena.
- Conectores de tiendas: WooCommerce (WordPress) y Shopify, sin tocar su código. Se crea el conector, se pega su URL y el secreto en la tienda, y se elige qué mensaje sale con cada evento del pedido (creado, pagado, enviado, completado, cancelado). Hay "Mandar prueba" y un registro de cada pedido que llegó y qué se hizo.
- Chat embebido: la pantalla de chat dentro de otra web (iframe) o como burbuja flotante (embed.js: WA.montar o WA.flotante). La otra web pide un token corto con una clave que tenga el permiso embed:emitir. Hay que escribir qué webs pueden embeberlo; sin ninguna, nadie ajeno puede.

CONTACTOS (/panel#contactos)
Cada número con su consentimiento (opt-in) y su origen. Sin opt-in no sale nada iniciado por el negocio (campañas, reparto, plantillas); responder a quien escribe sí. Importación masiva, búsqueda, exportar CSV. Una baja (el cliente escribió BAJA) manda sobre todo.

REPARTO (/rutas, modo avanzado)
Se pega la lista del día (teléfono, nombre, pedido, dirección) y el sistema le pide la ubicación a cada cliente uno por uno, con pausas, en horario, tres intentos; "no soy yo" corta; lo que no se resuelve pasa a una persona con su incidencia (número corto, sin WhatsApp, respondió sin ubicación...). Avisos al coordinador y resumen a GSG. Ajustes del reparto: pausas, espera, intentos, horario, textos.

CAMPAÑAS Y AUTOMATIZACIÓN (modo avanzado)
Enviar a un grupo (elegir clientes por cómo están), Campañas por goteo con canario (primero un 10 %, se mira cómo cae, luego el resto al ritmo del número), Respuestas automáticas (reglas por palabra clave y secuencias de seguimiento, sin IA), Mensajes aprobados (plantillas de Meta y propias, con revisor de reglas de aprobación).

SALUD DEL NÚMERO (modo avanzado)
El sistema protege el número para que Meta o WhatsApp no lo bloqueen: guardas que no se pueden apagar (baja, sin consentimiento, ventana de 24 h, plantilla no aprobada, cupo diario con warm-up, máximo por contacto y separación), un marcapasos único para todo lo iniciado por la empresa (por minuto, por hora, horario, pausas), y un monitor que mira fallos, bajas, entregas y desconexiones, y frena o pausa solo: verde normal, amarillo mitad, naranja solo lo imprescindible, rojo pausado. "Por qué no salió un mensaje" se ve en Historial de envíos con su motivo (opt_out, no_opt_in, window_closed, daily_cap, rhythm, contact_suppressed...). Modo prueba (SOLO_NUMEROS): solo se escribe a los números de la lista.

CONFIGURACIÓN (/panel#configuracion)
Nombre del negocio, horario de envío, ritmo, modo prueba, avisos (WhatsApp del supervisor), escritura simulada, pausa automática. Solo un administrador.

USUARIOS Y CLAVES
Personas: entran en /login con usuario y contraseña; la primera cuenta es administradora. Dos roles: admin (todo) y operador (todo menos usuarios, claves, configuración, asistente). Programas: clave de API. Actividad: bitácora de quién hizo qué.

API PÚBLICA (/api/v1, contrato en /api/v1/openapi.json)
mensajes (enviar), conversaciones, contactos, plantillas, webhooks, conectores, embed/token, eventos/stream (tiempo real). Un envío frenado por una guarda responde 202 "bloqueado" con el motivo.

VARIAS TIENDAS (SaaS)
Cada tienda tiene su instancia: su subdominio (tienda1.dominio), su contenedor, su base y su WhatsApp. Se dan de alta y de baja desde el panel maestro o con npm run saas:alta / saas:baja.

MÓDULOS DEL MENÚ
${modulos}

PREGUNTAS FRECUENTES
- "No me llega el QR / no conecta": Conexión de WhatsApp, escanear de nuevo; con el cliente local a veces hay que volver a vincular tras un reinicio. Soporte (/soporte) tiene un diagnóstico para copiar.
- "No salió un mensaje": Historial de envíos → columna motivo. Los más comunes: el contacto no tiene consentimiento (no_opt_in), se dio de baja (opt_out), ventana de 24 h cerrada con la API de Meta (window_closed), cupo del día (daily_cap), el número está en amarillo/naranja/rojo (Estado del número).
- "El asistente no contesta": Mi asistente IA → ¿está encendido? ¿hay sesión de Puter? ¿el bot está pausado en ese chat (botón en Chats)? ¿el número está en modo prueba y ese cliente no está en la lista?
- "Quiero que la IA sepa X": escribirlo en "Lo que sabe" de Mi asistente IA y guardar; se aplica al siguiente mensaje.
- "Cómo pongo el chat en mi web": Conectar mi web y tienda → Chat embebido: escribir el dominio de la web, y en la web pegar embed.js con un token.
- "Cómo conecto WooCommerce/Shopify": Conectar mi web y tienda → Conectores → crear, pegar URL y secreto en la tienda, definir reglas, Mandar prueba.`;
}
