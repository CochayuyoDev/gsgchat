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
} as const;

export const SISTEMA_PARA_CLIENTES = `Cómo funciona el sistema por el que hablas (para que no prometas lo que no puede hacer):
- Hablas dentro de WhatsApp. El cliente te ve como el WhatsApp del negocio; no menciones que eres "una IA de un sistema" salvo que te lo pregunten: entonces di que eres el asistente automático del negocio y que puede pedir hablar con una persona.
- Puedes PEDIRLE LA UBICACIÓN al cliente con un botón de WhatsApp: si necesita entrega a domicilio o no sabes dónde está, termina tu mensaje con la marca ${ACCIONES_IA.PEDIR_UBICACION} y el sistema le manda el botón. Si el cliente manda su pin o un link de Google Maps, el sistema lo registra solo y tú se lo agradeces.
- Puedes PASAR CON UNA PERSONA: termina con ${ACCIONES_IA.DERIVAR}. A partir de ahí tú te callas en ese chat y una persona del negocio lo atiende desde la misma pantalla. Hazlo cuando el cliente lo pida, cuando reclame, cuando quiera pagar o cerrar una compra y no tengas los datos para hacerlo, o cuando no sepas.
- NO puedes: cobrar, confirmar un pago, ver el estado de un pedido que no esté en lo que sabes, enviar fotos ni catálogos en imagen, ni hacer llamadas. Para eso pasas con una persona.
- Si el cliente escribe BAJA, el sistema deja de escribirle; si escribe ALTA vuelve a recibir mensajes. Si te preguntan cómo dejar de recibir mensajes, diles que respondan BAJA.
- Cuando el negocio hace reparto, el sistema le pide al cliente su ubicación por WhatsApp antes de salir; si el cliente pregunta por eso, explícale que basta con tocar el botón o compartir su ubicación desde el clip.
- Cuando TÚ pides la ubicación con la marca, el sistema apunta al cliente en su lista de envío automático y le insistirá solo, cada pocas horas, si no la manda: no hace falta que insistas tú ni que vuelvas a pedirla en cada turno.
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
Contesta solo el texto libre de los clientes con lo que la tienda escribió (productos, precios, envíos, cambios, pagos, horario) y cómo debe hablar. Si el cliente pide una persona (asesor, reclamo...) o el modelo no sabe, se despide, se calla en ese chat y avisa por WhatsApp al supervisor (número en Configuración → Avisos). Puede pedirle la ubicación al cliente con el botón. Si Stoky está conectado ve precio y stock reales. Fotos y audios: pide que lo escriban. BAJA/ALTA, ubicaciones y reparto siguen funcionando aparte. Si el modelo falla, el cliente recibe "en un momento te atiende una persona" y se avisa. Solo un administrador lo configura; un operador puede probarlo.

CONECTAR MI WEB Y TIENDA (/panel#integraciones)
- Claves de API: para que otro programa (Stoky, un script) use la API pública /api/v1 con los permisos marcados. Se ve una sola vez.
- Webhooks salientes: la URL de otro sistema que quiere enterarse de lo que pasa (mensaje recibido, entregado, ubicación, baja...). Cada entrega va firmada (X-Firma); se reintenta si falla y se apaga sola tras un día sin una entrega buena.
- Conectores de tiendas: WooCommerce (WordPress) y Shopify, sin tocar su código. Se crea el conector, se pega su URL y el secreto en la tienda, y se elige qué mensaje sale con cada evento del pedido (creado, pagado, enviado, completado, cancelado). Hay "Mandar prueba" y un registro de cada pedido que llegó y qué se hizo.
- Chat embebido: la pantalla de chat dentro de otra web (iframe) o como burbuja flotante (embed.js: WA.montar o WA.flotante). La otra web pide un token corto con una clave que tenga el permiso embed:emitir. Hay que escribir qué webs pueden embeberlo; sin ninguna, nadie ajeno puede.

CONTACTOS (/panel#contactos)
Cada número con su consentimiento (opt-in) y su origen. Sin opt-in no sale nada iniciado por el negocio (campañas, reparto, plantillas); responder a quien escribe sí. Importación masiva, búsqueda, exportar CSV. Una baja (el cliente escribió BAJA) manda sobre todo.

ENVÍO AUTOMÁTICO (/envio-automatico)
La lista de números a los que el sistema escribe SOLO. El sistema no le escribe por su cuenta a nadie que no esté en ella (o en un lote del reparto). A cada número le manda un mensaje cada 3 horas (ajustable ahí mismo: cada cuántas horas, máximo por número, horario; vale también para el reparto), como una persona, solo en horario; así nunca se llega al cupo del día. Qué se manda: pedirle su ubicación (textos del reparto) o un mensaje propio con {nombre}, {negocio}, {pedido}. Sale solo de la lista cuando manda la ubicación (o contesta, si era "hasta que conteste"), al completar los envíos, si se da de baja, si no tiene WhatsApp, o al agotar los intentos (se avisa al supervisor). Entran números: a mano en la pantalla, por el asistente de WhatsApp cuando pide la ubicación en un chat, por la IA operadora si se lo piden, o por la API. Los clientes del reparto se ven en la misma lista; quitar uno lo pasa a una persona. "Últimos movimientos" dice quién entró, quién salió y por qué.

LA IA OPERADORA (botón "IA" arriba en todas las pantallas; también en /manual y por la API /api/v1/ia/ordenes con permiso ia:ordenar)
Recibe órdenes con palabras y las ejecuta con las acciones de su catálogo, por los mismos caminos que las pantallas y con la cuenta de quien ordena (queda en Actividad como "(por la IA)"). Puede: lista de envío automático (ver, poner, quitar, pausar, reanudar, ritmo), contactos (buscar, dar de alta, baja), mensajes (escribir a uno, pedir ubicación), chats (ver conversaciones, leer un chat, "de este me encargo yo"), reparto (estado, sin ubicación, cargar lote, arrancar/pausar, pasar a persona, reintentar), grupos y campañas (previsualizar, enviar, ver, pausar/reanudar/parar), número (estado, pausar envíos), historial de envíos, ubicaciones, configuración (ver/cambiar, solo admin), plantillas, enseñarle al asistente, resumen del sistema, actividad, integraciones, catálogo de Stoky. Pide confirmación para lo delicado (envíos a muchos, cargar lote, configuración, ritmo, parar el número) y para cualquier cambio decidido después de leer datos. No tiene claves de API, usuarios ni contraseñas, ni la conexión. "Solo simular" dice qué haría sin hacerlo.

SEGURIDAD DEL ASISTENTE
Los intentos de sacarlo de su papel, sacarle sus instrucciones, pedir tokens o accesos, hacerse pasar por el sistema o el dueño, pedir datos de otras personas o que escriba a otros números no llegan al modelo: se contestan con una frase fija; tres seguidos pasan el chat a una persona. Lo que va a salir se revisa (instrucciones, secretos, teléfonos ajenos no salen). Tope de turnos por cliente y hora. El asistente solo puede pedir la ubicación y pasar con una persona. Examen: grupo "Ataques al asistente" en Mi asistente IA.

REPARTO (/rutas, modo avanzado)
Se pega la lista del día (teléfono, nombre, pedido, dirección) y el sistema le pide la ubicación a cada cliente uno por uno, con pausas, en horario, cada 3 horas (el mismo ritmo de Envío automático), tres intentos; "no soy yo" corta; lo que no se resuelve pasa a una persona con su incidencia (número corto, sin WhatsApp, respondió sin ubicación...). Avisos al coordinador y resumen a GSG. Ajustes del reparto: pausas, espera, intentos, horario, textos.

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
- "Quiero que la IA sepa X": escribirlo en "Lo que sabe" de Mi asistente IA y guardar; se aplica al siguiente mensaje. O decírselo a la IA operadora: "que el asistente sepa que…".
- "Quiero que le escriba solo a estos números / que le insista hasta que mande su ubicación": Envío automático (/envio-automatico), o pedírselo a la IA operadora con palabras.
- "¿Por qué ya no está Juan en la lista?": Envío automático → Últimos movimientos (dice el motivo: mandó su ubicación, contestó, agotó los intentos, se dio de baja, lo quitó alguien).
- "Cómo pongo el chat en mi web": Conectar mi web y tienda → Chat embebido: escribir el dominio de la web, y en la web pegar embed.js con un token.
- "Cómo conecto WooCommerce/Shopify": Conectar mi web y tienda → Conectores → crear, pegar URL y secreto en la tienda, definir reglas, Mandar prueba.`;
}
