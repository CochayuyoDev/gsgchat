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
Contesta solo el texto libre de los clientes con lo que la tienda escribió (productos, precios, envíos, cambios, pagos, horario) y cómo debe hablar. Si el cliente pide una persona (asesor, reclamo...) o el modelo no sabe, se despide, se calla en ese chat y avisa por WhatsApp al supervisor (número en Configuración → Avisos). Puede pedirle la ubicación al cliente con el botón. Si Stoky está conectado ve precio y stock reales. Con "Catálogo de la tienda" (la URL de productos de la web: la API de la tienda, WooCommerce o una lista JSON simple) ve nombre, precio, stock y enlace de cada producto real y puede mandar el enlace; hay botón "Probar" que dice cuántos productos lee. Con catálogo, además TOMA PEDIDOS: pide producto, cantidad, nombre, dirección y medio de pago, resume y lo registra; el total lo calcula el sistema con los precios del catálogo, nunca el modelo. Fotos y audios: pide que lo escriban. BAJA/ALTA, ubicaciones y reparto siguen funcionando aparte. Si el modelo falla, el cliente recibe "en un momento te atiende una persona" y se avisa. Solo un administrador lo configura; un operador puede probarlo.

LO QUE META CAMBIA CON FECHA (solo API oficial; en Conexión de WhatsApp paso 3 y en Estado del número)
Método de pago antes del 30/09/2026: desde el 1/10/2026 Meta cobra también los mensajes de servicio (lo que se contesta dentro de la ventana de 24 h, sea una persona o el asistente), S/ 0,0998 por mensaje en Perú con 1 000 gratis al mes por número; sin método de pago, tras los 1 000 gratis dejan de salir. Registro incorporado v4 antes del 15/10/2026: hace falta una configuración nueva en la app de Meta (Facebook Login for Business → Configurations, variante Embedded Signup, con Cloud API y "WhatsApp Business App onboarding" para coexistencia) y pegar su ID. Graph API: el sistema usa la v25; la v21 caduca el 21/01/2027. Los dos primeros se marcan "Ya lo hice" en la pantalla. Con la API oficial, el reparto manda texto con botón (servicio, gratis dentro de los 1 000) si el cliente escribió hace menos de 24 h, y plantilla solo fuera de la ventana. El límite de mensajería es del portafolio de Meta (compartido por todos sus números). Con QR o WAHA nada de esto aplica.

VOZ DEL ASISTENTE (Mi asistente IA → Voz, /panel#ia)
Con una clave de ElevenLabs (tiene plan gratis; se guarda cifrada) el asistente contesta con NOTAS DE VOZ con la voz elegida (se escucha en la pantalla) y ENTIENDE los audios del cliente: se transcriben al llegar, el asistente los lee como texto, en Chats se ven escritos ("dijo: …") y salen por la API y el webhook como "transcripcion". "Cuándo contesta con audio": nunca por su cuenta, solo cuando el cliente mandó un audio (por defecto), o siempre. "Comprobar" dice si la clave vale y los caracteres que quedan. La voz nunca deja sin respuesta: si el mensaje pasa del tope (600 caracteres), lleva un enlace, se acabó el plan o ElevenLabs falla, sale por escrito y la pantalla dice por qué. Lo del sistema (pasar con una persona, resumen de pedido) va siempre por escrito. En Chats, "Mandar como audio" manda lo escrito como nota de voz de una persona. Otro sistema pide "voz: true" en POST /api/v1/mensajes; "media: {url, tipo, caption}" manda un fichero por URL; "autor" (persona, ia o sistema) queda en el hilo y en el webhook. Sin clave, a un audio se le pide el texto, como siempre.

ENTRENAR A LA IA (/entrenamiento)
Enseñarle al asistente a gran escala, con LECCIONES: un ejemplo (cuando el cliente diga X, contesta Y), un dato del negocio o una regla. Pueden ser miles: en cada mensaje el asistente elige las que vienen al caso y solo esas usa (las reglas van siempre). Cuatro formas de enseñarle: (1) una cosa a mano; (2) muchas de golpe: un Excel o CSV con columnas pregunta | respuesta | tema (o sin cabecera), un JSON, un chat exportado de WhatsApp (se dice quién es el negocio) o líneas "Cliente: … / Tú: …"; las repetidas no entran dos veces y se puede marcar "revisar antes de usarlas" (quedan pendientes); (3) aprender de las conversaciones reales: recorre todos los chats y guarda cada pregunta de un cliente con lo que contestó una PERSONA del negocio (lo del asistente, plantillas, reparto o campañas no cuenta), tapando teléfonos, DNI y correos; después "Pulir con la IA" limpia lo personal, descarta lo que no sirve y pone tema; (4) desde Chats, botón "Enseñar respuesta" en lo que dijo el cliente y "Corregir" en lo que contestó el asistente (lo que dijo mal queda como lo que no debe repetir); y desde la prueba de Mi asistente IA, "Corregir". Revisar: la lista filtra por estado (en uso, pendientes, descartadas), tipo, tema, de dónde vino y examen; se aprueba, descarta, edita o borra una a una o en masa ("Aprobar todas las pendientes"). EXAMEN: a cada lección se le hace su pregunta al asistente real y se comprueba que diga los mismos datos (precios, plazos) y hable de lo mismo; corre en el servidor con barra de avance; queda el histórico con su nota (%), y cada lección marca si pasó o falló; se puede repetir "solo las que fallaron". "¿Qué usaría para responder?" enseña qué lecciones elegiría para un mensaje. Por la API: POST/GET /api/v1/ia/lecciones con permiso ia:entrenar (hasta 5000 por llamada). Enseñar una lección lo puede hacer cualquier cuenta; importar, aprender, pulir, examinar y borrar, solo un administrador. Para examinar y pulir hace falta la IA conectada (Puter); para lo demás no.

PEDIDOS DEL CHAT (/panel#pedidos)
Los pedidos que el asistente tomó en la conversación: cliente, líneas con precio del catálogo, total, dirección, medio de pago y estado (nuevo → confirmado / enviado a la tienda / cancelado). Una persona los revisa y confirma; la campana avisa de los nuevos. La tienda se entera por el webhook "pedido.creado" (o los lee por la API /api/v1/pedidos con el permiso pedidos:gestionar) y puede marcarlos "enviado a la tienda" con su número de pedido. El sistema NO cobra ni confirma pagos.

ROLES Y MEMBRESÍA
Tres roles: superadministrador (quien puso el sistema; la primera cuenta: lleva la membresía, los códigos de conexión y las cuentas de otros superadministradores, más todo lo de un admin), administrador (configura el negocio, gestiona usuarios que no sean superadministradores y claves) y operador (atiende). El último superadministrador no se puede degradar ni desactivar. Membresía (/panel#membresia, "Mi negocio → Membresía"): plan (Prueba, Básico, Pro, Personalizado), pagada hasta, lo que incluye (respuestas de IA al mes, campañas, conectores, cuentas), precio, cómo renovar, aviso propio; el superadministrador la guarda, apunta pagos (corren el vencimiento) y puede suspenderla; el admin la ve. Vencida o suspendida: la IA y las campañas se paran, el panel lo avisa arriba, los chats siguen; con tope de cuentas no se crean más usuarios. Con maestro, la membresía es de solo lectura aquí. TIENDAS (/panel#tiendas, "Mi negocio → Tiendas", solo superadministrador): el control de los negocios a los que se les puso el sistema: dar de alta una tienda (nombre, identificador, dirección de su sistema, contacto, plan, pagada hasta, precio, cómo renovar) → sale un token (se ve una vez) y la dirección de su plan; el superadministrador de ESA instalación los pega en su Membresía → "Esta instalación depende de un maestro", y desde entonces toma su plan de aquí (pregunta cada cuarto de hora). La lista dice plan, pagada hasta, estado (al día / vence en N días / vencida / suspendida) y si está en línea; acciones: apuntar pago, cambiar plan, suspender/reactivar (su IA y campañas se paran en su próxima consulta, los chats siguen), token nuevo, abrir su panel, borrar; resumen con tiendas, al día, por vencer, vencidas, suspendidas, en línea e ingresos del mes. Con alojamiento (este panel en un servidor con el SaaS preparado: dominio y Docker), "Crear también su instalación ahora" levanta la instalación de la tienda con su subdominio ya conectada a este panel; el cliente entra por su URL, crea su primera cuenta y conecta su WhatsApp. Sin alojamiento, se registra y se pega la dirección del plan y el token en su instalación.

CONECTAR MI WEB Y TIENDA (/panel#integraciones)
- Códigos de conexión: para conectar otro sistema sin copiar claves: código corto WA-XXXX-XXXX con fecha límite (o 1 h / 1 / 7 / 30 / 90 días), usos y permisos; el otro sistema lo canjea en POST /api/v1/conexion/canjear (sin clave) y recibe su clave de API; la lista dice si está vigente, usado, caducado o anulado y quién lo canjeó. En el bloque Stoky, "Crear un código de conexión" lo hace de un clic.
- Stoky (arriba de todo): la conexión con Stoky en sus DOS direcciones, cada una con su semáforo. (1) Stoky escribe y lee por este WhatsApp: botón "Crear la clave para Stoky" (clave con todos los permisos; sustituye a la anterior) y la dirección de este sistema; se pegan en Stoky → CRM → WhatsApp → Conectar → "Mi sistema de WhatsApp" y Stoky hace el resto (comprueba la clave, da de alta el aviso para recibir los mensajes, enseña el QR). El semáforo dice si Stoky ya usó la clave y si recibe los mensajes (el aviso hacia Stoky y su última entrega). (2) Este WhatsApp consulta el catálogo de Stoky (precios y stock reales, pedidos, registrar la venta en el panel): dirección de la API de Stoky, dirección del panel y un token stk_ de Stoky → Integraciones → Conexiones de tienda; botones Probar, Guardar y conectar, Quitar. Si Stoky se vinculó desde su pantalla, esto llega relleno solo (POST /api/v1/stoky/conexion con permiso stoky:conectar). Ya no hace falta tocar el .env ni reiniciar; el .env solo es el valor inicial.
- Claves de API: para que otro programa (Stoky, un script) use la API pública /api/v1 con los permisos marcados. Se ve una sola vez.
- Webhooks salientes: la URL de otro sistema que quiere enterarse de lo que pasa (mensaje recibido, entregado, ubicación, baja...). Cada entrega va firmada (X-Firma); se reintenta si falla y se apaga sola tras un día sin una entrega buena.
- Conectores de tiendas: WooCommerce (WordPress) y Shopify, sin tocar su código. Se crea el conector, se pega su URL y el secreto en la tienda, y se elige qué mensaje sale con cada evento del pedido (creado, pagado, enviado, completado, cancelado). Hay "Mandar prueba" y un registro de cada pedido que llegó y qué se hizo.
- Chat embebido: la pantalla de chat dentro de otra web (iframe) o como burbuja flotante (embed.js: WA.montar o WA.flotante). La otra web pide un token corto con una clave que tenga el permiso embed:emitir. Hay que escribir qué webs pueden embeberlo; sin ninguna, nadie ajeno puede.

CONTACTOS (/panel#contactos)
Cada número con su consentimiento (opt-in) y su origen. Sin opt-in no sale nada iniciado por el negocio (campañas, reparto, plantillas); responder a quien escribe sí. Importación masiva, búsqueda, exportar CSV. Una baja (el cliente escribió BAJA) manda sobre todo.

ENVÍO AUTOMÁTICO (/envio-automatico)
La lista de números a los que el sistema escribe SOLO. El sistema no le escribe por su cuenta a nadie que no esté en ella (o en un lote del reparto). A cada número le manda un mensaje cada 3 horas (ajustable ahí mismo: cada cuántas horas, máximo por número, horario; vale también para el reparto), como una persona, solo en horario; así nunca se llega al cupo del día. Qué se manda: pedirle su ubicación (textos del reparto) o un mensaje propio con {nombre}, {negocio}, {pedido}. Sale solo de la lista cuando manda la ubicación (o contesta, si era "hasta que conteste"), al completar los envíos, si se da de baja, si no tiene WhatsApp, o al agotar los intentos (se avisa al supervisor). Entran números: a mano en la pantalla, por el asistente de WhatsApp cuando pide la ubicación en un chat, por la IA operadora si se lo piden, o por la API. Los clientes del reparto se ven en la misma lista; quitar uno lo pasa a una persona. "Últimos movimientos" dice quién entró, quién salió y por qué.

LA IA OPERADORA (botón "IA" arriba en todas las pantallas; también en /manual y por la API /api/v1/ia/ordenes con permiso ia:ordenar)
Recibe órdenes con palabras y las ejecuta con las acciones de su catálogo, por los mismos caminos que las pantallas y con la cuenta de quien ordena (queda en Actividad como "(por la IA)"). Puede: lista de envío automático (ver, poner, quitar, pausar, reanudar, ritmo), contactos (buscar, dar de alta, baja), mensajes (escribir a uno, pedir ubicación), chats (ver conversaciones, leer un chat, "de este me encargo yo"), reparto (estado, sin ubicación, cargar lote, arrancar/pausar, pasar a persona, reintentar), grupos y campañas (previsualizar, enviar, ver, pausar/reanudar/parar), número (estado, pausar envíos), historial de envíos, ubicaciones, configuración (ver/cambiar, solo admin), plantillas, enseñarle al asistente (ia.ensenar: una lección; ia.lecciones: qué sabe; ia.aprenderDeChats; ia.examinar), resumen del sistema, actividad, integraciones, catálogo de Stoky. Pide confirmación para lo delicado (envíos a muchos, cargar lote, configuración, ritmo, parar el número) y para cualquier cambio decidido después de leer datos. No tiene claves de API, usuarios ni contraseñas, ni la conexión. "Solo simular" dice qué haría sin hacerlo.

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
- "Contesta por escrito y no con audio" / "no entiende los audios": Mi asistente IA → Voz: ¿hay clave de ElevenLabs y está encendida? ¿"cuándo" está en "nunca"? ¿el mensaje pasa del tope o lleva un enlace? Mira "Último fallo" (cuota agotada, clave mala).
- "¿Cómo controlo a mis clientes / tiendas?": Tiendas (/panel#tiendas), solo superadministrador: alta con plan, pagos, suspender, ver si están en línea.
- "La IA está en pausa" / "no se pueden crear más usuarios": mirar Membresía (/panel#membresia): vencida, suspendida o con tope; el superadministrador la renueva apuntando un pago o la amplía.
- "¿Cómo conecto otro sistema sin pasarle la clave?": Conectar mi web y tienda → Códigos de conexión (o el botón del bloque Stoky): un código con fecha límite que el otro sistema canjea.
- "¿Cómo se conecta Stoky?" / "el asistente no da precios": Conectar mi web y tienda → Stoky. Si el semáforo 2 está en rojo, falta la dirección o el token de Stoky (o Stoky está apagado); si el 1 está en rojo, falta crear la clave y pegarla en Stoky.
- "Quiero que la IA sepa X": escribirlo en "Lo que sabe" de Mi asistente IA y guardar; se aplica al siguiente mensaje. O decírselo a la IA operadora: "enséñale que…" (queda como lección en Entrenar a la IA). Para muchas cosas de golpe (un Excel, los chats de meses), Entrenar a la IA (/entrenamiento).
- "La IA respondió mal a un cliente": en Chats, botón "Corregir" sobre esa respuesta; o en Entrenar a la IA, buscar la lección y editarla; después examinar "solo las que fallaron".
- "Quiero que le escriba solo a estos números / que le insista hasta que mande su ubicación": Envío automático (/envio-automatico), o pedírselo a la IA operadora con palabras.
- "¿Por qué ya no está Juan en la lista?": Envío automático → Últimos movimientos (dice el motivo: mandó su ubicación, contestó, agotó los intentos, se dio de baja, lo quitó alguien).
- "Cómo pongo el chat en mi web": Conectar mi web y tienda → Chat embebido: escribir el dominio de la web, y en la web pegar embed.js con un token.
- "Cómo conecto WooCommerce/Shopify": Conectar mi web y tienda → Conectores → crear, pegar URL y secreto en la tienda, definir reglas, Mandar prueba.`;
}
