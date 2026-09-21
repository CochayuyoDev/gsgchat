/**
 * La ayuda de cada pantalla: "¿Qué hago si…?".
 *
 * Preguntas cortas con su respuesta y el enlace a donde se hace, PROPIAS de
 * la pantalla en la que se esta (Hoy no explica campañas; Chats no explica
 * motorizados). El armazon (shell.ts) las mete en todas las paginas y elige
 * las de la ruta actual; abajo del panel, "Preguntarle a la IA" abre la IA
 * operadora con la pregunta ya escrita, que contesta con el manual entero.
 *
 * Es la misma verdad que el manual (conocimiento-sistema.ts) y el README,
 * contada por pantalla. Cuando cambie una regla, se cambia aqui tambien.
 */

export interface PreguntaAyuda {
  /** La pregunta, como la haria quien opera ("¿Qué hago si…?"). */
  p: string;
  /** La respuesta, corta y sin jerga. */
  r: string;
  /** A donde se hace, si es en otra pantalla o en otro sitio de esta. */
  ir?: string;
  irTexto?: string;
}

export interface AyudaPantalla {
  titulo: string;
  /** Una linea: que es esta pantalla. */
  que: string;
  preguntas: PreguntaAyuda[];
}

const HOY: AyudaPantalla = {
  titulo: 'Hoy',
  que: 'Los pedidos del día, paso a paso: ubicación, confirmación, motorizado, hora de llegada y entrega.',
  preguntas: [
    { p: '¿Qué hago si un pedido dice «necesita a alguien»?', r: 'Abre la fila (clic en el pedido): la incidencia dice qué pasó (no contestó, pidió otro día, el motorizado no pudo, el cliente no estaba…). Desde ahí puedes confirmar a mano, poner el pin, pasarlo a otro motorizado, reintentar o cancelar. Si hay que llamar, «Abrir el chat» te lleva a la conversación.', ir: '/hoy?filtro=incidencia', irTexto: 'Ver las que necesitan a alguien' },
    { p: '¿Qué hago si el cliente no manda su ubicación?', r: 'El sistema se la pide solo, con pausas y varios intentos, a lo largo del día. Si el cliente te la dio por teléfono, ponla tú con «Poner un pin» en la fila (pega el enlace de Google Maps o las coordenadas).' },
    { p: '¿Qué hago si el motorizado no contesta?', r: 'A los 10 minutos se le insiste y a la segunda vez el pedido pasa a otro motorizado activo. Si quieres cambiarlo ya, «Otro motorizado» en la fila. Si no hay ningún motorizado activo, el pedido se queda esperando: da de alta uno o reactiva a alguien.', ir: '/motorizados', irTexto: 'Ir a Motorizados' },
    { p: '¿Cómo marco un pedido como entregado?', r: 'Lo normal es que el motorizado escriba «entregado» (o mande la foto) y el pedido se cierre solo. Si avisó por teléfono, el botón «Entregada» de la fila lo cierra a mano y GSG se entera igual.' },
    { p: '¿Qué pasa con lo que quedó de ayer?', r: 'El cierre del día (a la hora de Ajustes de las entregas, o con el botón de la tira de arriba) pasa lo vivo de ayer a «necesitan a alguien», da por entregado lo avisado y avisa a GSG y al supervisor con un solo mensaje.' },
    { p: 'Hoy no tengo GSG conectado, ¿cómo cargo los pedidos?', r: 'Con «Pegar la lista del día»: una línea por cliente (teléfono, nombre, pedido, dirección) y el sistema hace lo mismo que con la lista de GSG. También hay «Pedido a mano» para uno suelto.' },
    { p: '¿Cómo pruebo sin escribirle a clientes de verdad?', r: '«Modo prueba con mi número» deja el sistema escribiéndole solo a tu número (arriba queda un cartel rojo). Y en «Probar con números ficticios» cargas 10 clientes y 10 motorizados de mentira con el simulador de GSG.' },
    { p: '¿Qué significa «N reportes que GSG no aceptó»?', r: 'Cada ubicación, confirmación y entrega se le cuenta a GSG. Si GSG rechazó alguna, aquí se ve: «Reintentar» las vuelve a mandar y «Descargar» te da el fichero para mandarlo a mano.' },
  ],
};

const CHAT: AyudaPantalla = {
  titulo: 'Chats',
  que: 'Las conversaciones como en WhatsApp: leer, contestar, mandar o pedir la ubicación, y ver qué pasó con cada mensaje.',
  preguntas: [
    { p: '¿Qué hago si el cliente dice que no le llegó nada?', r: 'Pasa el ratón por el mensaje y pulsa «¿qué pasó?»: dice si salió, si WhatsApp lo entregó o lo leyó, y si no salió, por qué (sin consentimiento, ventana de 24 h cerrada, cupo del día, modo prueba…).' },
    { p: '¿Cómo hago que el asistente deje de contestar en este chat?', r: 'Botón «De este me encargo yo» en la cabecera del chat: desde ahí ni el asistente ni las reglas contestan hasta que lo sueltes.' },
    { p: '¿Cómo le pido la ubicación a un cliente?', r: 'Con el botón de ubicación de la caja de escribir (📍): le llega el botón nativo de WhatsApp; cuando la mande, el sistema la registra solo y la liga a su pedido de hoy.' },
    { p: '¿Por qué solo puedo mandar una plantilla?', r: 'Con la API de Meta, pasadas 24 h desde el último mensaje del cliente solo puede salir una plantilla aprobada; la pantalla lo dice. Con el QR (cliente local) no existe esa regla.' },
    { p: '¿Cómo guardo una conversación?', r: '«Guardar y vaciar» en la cabecera: queda en Conversaciones guardadas (con su resumen y sus adjuntos) y el hilo se vacía. Se puede devolver al chat cuando quieras.', ir: '/guardados', irTexto: 'Ver las guardadas' },
    { p: 'El asistente respondió mal, ¿cómo lo corrijo?', r: 'Pasa el ratón por su respuesta y pulsa «Corregir»: escribes lo que debió decir y queda como lección. Sobre lo que dijo el cliente, «Enseñar respuesta» hace lo mismo.' },
    { p: '¿Puedo mandar fotos, audios o documentos?', r: 'Sí: con el clip 📎, arrastrando el archivo o pegándolo (Ctrl V). Y con la voz del asistente configurada, un texto puede salir como nota de voz.' },
  ],
};

const GUARDADOS: AyudaPantalla = {
  titulo: 'Conversaciones guardadas',
  que: 'Lo hablado con cada cliente, cerrado y a salvo: buscar, leer, exportar, aprender de ello.',
  preguntas: [
    { p: '¿Cómo encuentro qué dijo un cliente hace un mes?', r: 'Busca por su nombre o número, o escribe una palabra en «dentro de lo que se dijo»; filtra por etiqueta (reclamo, entrega, venta…), por pedido o por fechas.' },
    { p: '¿Qué hago si GSG me pide la prueba de una conversación?', r: 'Abre la conversación y pulsa «Enlace de evidencia»: un enlace con fecha de caducidad que se abre sin cuenta. Se puede anular cuando quieras.' },
    { p: '¿Se guardan las fotos y los audios?', r: 'Sí: los adjuntos se copian junto a la conversación y se abren desde el lector.' },
    { p: '¿Cómo devuelvo una conversación al chat?', r: 'Abre la conversación y pulsa «Devolver al chat»: el hilo vuelve tal cual a Chats.' },
    { p: 'Un cliente pide que borremos sus datos', r: '«Borrar todo lo de un cliente»: lo guardado, sus adjuntos y su chat. Se escribe BORRAR para confirmar y no tiene vuelta atrás.' },
    { p: '¿Se guardan solas?', r: 'Sí: a los N días sin movimiento (se cambia aquí mismo) y de golpe con «Guardar las de los pedidos terminados hoy». Van a la papelera 30 días antes de borrarse del todo.' },
    { p: '¿Puedo enseñarle a la IA con lo que ya hablamos?', r: '«Enseñar a la IA con esta conversación» saca las preguntas y respuestas buenas y las deja como lecciones en Entrenar a la IA.', ir: '/entrenamiento', irTexto: 'Ver las lecciones' },
  ],
};

const IA: AyudaPantalla = {
  titulo: 'Asistente IA',
  que: 'Con qué IA contesta, qué sabe del negocio, si está encendido y cuánto se usa.',
  preguntas: [
    { p: '¿Qué hago si el asistente no contesta?', r: 'Mira la tira de tres pasos: ¿hay clave o sesión de Puter? ¿está encendido? Luego: ¿el bot está pausado en ese chat («de este me encargo yo»)? ¿el número está en modo prueba y ese cliente no está en la lista? ¿la membresía tiene tope?' },
    { p: 'Quiero usar ChatGPT, Groq o Google en vez de Puter', r: 'En «Con qué IA» elige «Una clave de API», elige el servicio (rellena la dirección y sugiere modelos), pega la clave, «Probar la conexión» y guarda.' },
    { p: '¿Cómo sé cuánto gasto?', r: 'La tarjeta «Uso de la IA» dice cuántas respuestas, lecturas y órdenes hubo hoy y en el mes, los tokens si el servicio los cuenta, los fallos y lo que queda del tope de tu membresía. Tres fallos seguidos avisan en la campana.' },
    { p: '¿Cómo le enseño algo nuevo?', r: 'Escríbelo en «Qué sabe» y guarda: se aplica al siguiente mensaje. Para muchas cosas (un Excel, los chats de meses), Entrenar a la IA.', ir: '/entrenamiento', irTexto: 'Entrenar a la IA' },
    { p: '¿Puede contestar con audio?', r: 'Con una clave de ElevenLabs (sección Voz) contesta con notas de voz y entiende los audios de los clientes. Si algo falla, sale por escrito: la voz nunca deja sin respuesta.' },
    { p: '¿Cómo pruebo lo que va a decir?', r: 'La conversación de prueba de esta pantalla (no sale por WhatsApp) y el examen por grupos de escenarios («Ataques al asistente» incluido).' },
    { p: '¿Qué NO hace nunca?', r: 'No cobra, no confirma pagos, no inventa precios ni horas (las cifras las pone el sistema) y no se deja sacar de su papel: ante un intento de manipulación contesta una frase fija y a la tercera pasa el chat a una persona.' },
  ],
};

const MOTORIZADOS: AyudaPantalla = {
  titulo: 'Motorizados',
  que: 'Quiénes reparten hoy, qué lleva cada uno, dónde estuvo por última vez y cuánto entregó.',
  preguntas: [
    { p: '¿Cómo doy de alta a un motorizado?', r: '«Nuevo motorizado»: nombre, su WhatsApp (con 51 delante o sin él), zona y placa. Desde ese momento el sistema le manda los pines y lee lo que contesta.' },
    { p: '¿Qué hago si un motorizado se queda sin moto o se accidenta?', r: 'Ponlo en descanso: sus pedidos vivos pasan a otros. Si él mismo escribe «me quedo sin moto» o «accidente», el sistema lo hace solo y te avisa.' },
    { p: '¿Cómo se elige a quién le toca cada pedido?', r: 'Primero el que está a menos de 6 km según su última posición de hoy y no tiene otro pin sin contestar; si nadie está cerca, el de la zona del distrito; si no, el activo menos cargado.' },
    { p: '¿Qué significa «Última posición: hace N min»?', r: 'Es el pin del último pedido al que contestó o que entregó. Sirve para darle el siguiente pedido al más cercano.' },
    { p: '¿Qué le llega por WhatsApp a un motorizado?', r: 'El nombre y el pedido del cliente, el enlace de Google Maps y el pin, y la pregunta «¿en cuántos minutos lo entregas?». Después, el sistema entiende «40», «media hora», «no puedo», «entregado», «no estaba nadie».' },
    { p: '¿Puedo borrar a uno?', r: '«Dar de baja» lo quita de los activos sin perder su historial. Un motorizado de baja no recibe nada.' },
  ],
};

const EQUIPO: AyudaPantalla = {
  titulo: 'Equipo',
  que: 'Las cuentas de quienes entran al sistema y qué puede hacer cada una.',
  preguntas: [
    { p: '¿Qué puede hacer cada rol?', r: 'Un operador atiende (chats, Hoy, motorizados). Un administrador además configura el negocio y crea operadores. El superadministrador (quien puso el sistema) lleva la membresía, los códigos de conexión y las cuentas de otros superadministradores.' },
    { p: '¿Cómo creo una cuenta para alguien del equipo?', r: '«Crear usuario»: nombre, usuario, contraseña y rol. Cada persona entra en /login con lo suyo; así la bitácora dice quién hizo qué.' },
    { p: 'Alguien olvidó su contraseña', r: 'Un administrador la cambia desde aquí. Cada uno cambia la suya en Mi cuenta.', ir: '/panel#mi-cuenta', irTexto: 'Mi cuenta' },
    { p: '¿Cómo desactivo a alguien que ya no trabaja aquí?', r: '«Desactivar» en su fila: deja de poder entrar, pero lo que hizo sigue en la bitácora. El último superadministrador no se puede desactivar.' },
  ],
};

const CONEXION: AyudaPantalla = {
  titulo: 'Conexión',
  que: 'El WhatsApp con el que trabaja el sistema y la conexión con el sistema de GSG.',
  preguntas: [
    { p: '¿Cómo conecto el WhatsApp?', r: 'Escaneando el QR desde el teléfono (Dispositivos vinculados), como en WhatsApp Web. Conviene un número secundario. También se puede usar WAHA o la API oficial de Meta.' },
    { p: 'No me sale el QR o dice «parado»', r: 'Pulsa «Conectar» otra vez: si el teléfono cerró la sesión, el sistema borra la vinculación vieja y enseña un QR nuevo. Si sigue igual, «Desconectar la cuenta» y vuelve a vincular.' },
    { p: '¿Cómo conecto GSG?', r: 'En el bloque GSG: pega la dirección de su API y el token, «Probar» y guarda. Hasta que GSG tenga API, el simulador de este servidor sirve para probar el flujo entero con números ficticios.' },
    { p: '¿Qué pasa si GSG se cae?', r: 'Nada se pierde: las ubicaciones, confirmaciones y entregas esperan en una cola y salen enteras cuando GSG vuelve. En Hoy se ve lo que no aceptó.', ir: '/hoy', irTexto: 'Ver en Hoy' },
    { p: '¿Se desconecta solo?', r: 'Si el teléfono pierde la sesión, Hoy y la campana lo dicen y los envíos esperan. Con el teléfono encendido y con internet, la vinculación se mantiene.' },
    { p: 'Con la API de Meta, ¿qué cambia?', r: 'Hacen falta plantillas aprobadas para escribir fuera de la ventana de 24 h, y desde el 1/10/2026 Meta cobra también lo que se contesta dentro de la ventana. La pantalla lleva la cuenta de lo pendiente.' },
  ],
};

const AJUSTES: AyudaPantalla = {
  titulo: 'Ajustes',
  que: 'Nombre, horario, ritmo, modo prueba, avisos, resumen del día y qué se enseña.',
  preguntas: [
    { p: '¿A quién le llegan los avisos?', r: 'Al WhatsApp del supervisor (Avisos): los casos que necesitan a alguien, el nivel del número, el cierre del día y el resumen de la mañana y de la tarde.' },
    { p: '¿Cómo apago o cambio la hora del resumen del día?', r: 'En «Resumen del día por WhatsApp»: el interruptor y las dos horas. «Mandar ahora» lo prueba al momento y «Ver cómo queda» te enseña el texto.' },
    { p: '¿Qué es el modo prueba?', r: 'Con él activo, el sistema solo escribe y solo contesta a los números de la lista. Para probar sin molestar a clientes. Desde Hoy se enciende con un clic con tu número.' },
    { p: '¿Por qué no sale nada fuera de hora?', r: 'El horario de envío frena lo iniciado por el negocio (reparto, confirmaciones, campañas). Responder a quien escribe no tiene horario.' },
    { p: 'Quiero ver todos los módulos', r: '«Qué se enseña → Todo el sistema»: campañas, grupos, plantillas, rastreo, riesgo y ritmo, integraciones. Se puede volver a «Solo lo de GSG» cuando quieras.' },
    { p: '¿Qué es el ritmo?', r: 'Cuántos mensajes por minuto y por hora salen y con qué pausas: menos es más seguro para el número. El perfil del proveedor trae valores razonables.' },
  ],
};

const INICIO: AyudaPantalla = {
  titulo: 'Inicio',
  que: 'Un vistazo a todo: cómo van las entregas de hoy, el número y lo que espera a una persona.',
  preguntas: [
    { p: '¿Qué me falta para empezar?', r: 'La tarjeta «Para empezar» lo dice con estado real: conectar el WhatsApp, dar de alta a los motorizados y traer los pedidos (GSG o la lista del día). Cuando está todo, se pliega a una línea.' },
    { p: '¿Qué es «Entregas de hoy»?', r: 'Las cifras del día: cuántos faltan ubicación o confirmar, en camino, entregadas y las que necesitan a alguien. Cada cifra lleva a Hoy ya filtrado.', ir: '/hoy', irTexto: 'Ir a Hoy' },
    { p: '¿Qué significa el semáforo del número?', r: 'Verde: todo en orden. Amarillo: el marketing va más lento. Naranja: solo sale lo imprescindible. Rojo: pausado hasta que mejore. Lo decide el monitor mirando fallos, bajas y bloqueos.' },
    { p: '¿Cómo busco a un cliente o un pedido?', r: 'Ctrl K (o la lupa de arriba): escribe un nombre, un número o una referencia y salen los pedidos de hoy, los clientes y las conversaciones guardadas.' },
  ],
};

const ENTRENAMIENTO: AyudaPantalla = {
  titulo: 'Entrenar a la IA',
  que: 'Enseñarle al asistente a gran escala: ejemplos, datos y reglas.',
  preguntas: [
    { p: '¿Cómo le enseño muchas cosas de golpe?', r: '«Importar»: un Excel o CSV con pregunta | respuesta | tema, un JSON, un chat exportado de WhatsApp o líneas «Cliente: … / Tú: …». Las repetidas no entran dos veces.' },
    { p: '¿Puede aprender de lo que ya hablamos?', r: 'Sí: «Aprender de las conversaciones» recorre los chats y guarda cada pregunta con la respuesta que dio una persona. Se puede pedir revisarlas antes de usarlas.' },
    { p: '¿Cómo sé si aprendió bien?', r: '«Examinar»: se le hacen las preguntas de las lecciones y se compara; «solo las que fallaron» para repasar.' },
    { p: '¿Se usan todas las lecciones en cada mensaje?', r: 'No: en cada mensaje elige las que vienen al caso y solo esas usa (las reglas van siempre). Por eso pueden ser miles.' },
  ],
};

const ENVIO_AUTOMATICO: AyudaPantalla = {
  titulo: 'Envío automático',
  que: 'Los números a los que el sistema escribe solo, cada pocas horas, hasta conseguir su ubicación o una respuesta.',
  preguntas: [
    { p: '¿Cómo pongo a alguien para pedirle su ubicación?', r: '«Poner un número»: teléfono, nombre y qué se le pide. Le escribe cada 3 horas (ajustable), en horario, como una persona.' },
    { p: '¿Por qué ya no está Juan en la lista?', r: 'En «Últimos movimientos» está el motivo: mandó su ubicación, contestó, agotó los intentos, se dio de baja o lo quitó alguien.' },
    { p: '¿Puedo pausar a alguien sin quitarlo?', r: 'Sí: «Pausar» en su fila. «Reanudar» sigue donde iba.' },
  ],
};

const RUTAS: AyudaPantalla = {
  titulo: 'Ubicaciones para reparto',
  que: 'Cargar la lista del día y pedirle la ubicación a cada cliente, uno por uno.',
  preguntas: [
    { p: '¿Cómo cargo un lote?', r: 'Pega la lista (teléfono, nombre, pedido, dirección) y pulsa «Empezar a pedir». Cada cliente recibe la petición con su pausa, en horario, tres intentos.' },
    { p: '¿Qué hago con «necesita una persona»?', r: 'Son los que no se resolvieron solos: sin WhatsApp, número corto, contestó sin ubicación, «no soy yo». Se llaman o se resuelven a mano desde la fila.' },
    { p: '¿GSG se entera?', r: 'Sí: cada ubicación y el resumen del lote se le reportan; si GSG está caído, esperan en la cola.' },
  ],
};

const MANUAL: AyudaPantalla = {
  titulo: 'Manual de uso',
  que: 'Qué hace cada pantalla y cómo se usa; y un ayudante que responde con el manual.',
  preguntas: [
    { p: '¿Cómo pregunto algo que no encuentro?', r: 'Escríbelo en la caja de arriba del manual: el ayudante responde con lo que dice el manual y te dice en qué pantalla se hace.' },
    { p: '¿Dónde está la ayuda de una pantalla concreta?', r: 'En cada pantalla, el botón «¿Qué hago si…?» de arriba a la derecha: preguntas propias de esa pantalla.' },
    { p: '¿Puedo pedirle al sistema que haga cosas con palabras?', r: 'Sí: el botón «IA» de arriba abre la IA operadora. Le dices «pon a Juan para pedirle su ubicación» o «¿cómo van las entregas?» y lo hace con tu misma cuenta; lo delicado te lo deja para confirmar.' },
    { p: '¿Cómo busco a un cliente o un pedido desde cualquier pantalla?', r: 'Ctrl K (o la lupa de arriba): un nombre, un número o una referencia, y salen los pedidos de hoy, los clientes, las conversaciones guardadas y las pantallas.' },
  ],
};

const SOPORTE: AyudaPantalla = {
  titulo: 'Soporte',
  que: 'Si algo falla: qué mirar y qué datos mandar.',
  preguntas: [
    { p: '¿Qué mando si algo no funciona?', r: 'El diagnóstico de esta pantalla (botón «Copiar»): versión, conexión, colas y últimos fallos, sin datos de clientes.' },
    { p: 'No sale ningún mensaje', r: 'Mira la campana (arriba) y el semáforo del número en Inicio; en Historial de envíos cada envío lleva su motivo. Lo más común: WhatsApp desconectado, modo prueba, cupo del día u horario.' },
    { p: 'Un cliente dice que no le llegó un mensaje concreto', r: 'En Chats, «¿qué pasó?» sobre ese mensaje: cuándo salió, si WhatsApp lo entregó o lo leyó, y si no salió, por qué.', ir: '/chat', irTexto: 'Ir a Chats' },
    { p: 'El asistente IA se quedó callado', r: 'En Asistente IA, «Uso de la IA» dice si hay fallos seguidos (clave vencida, cuota agotada). La campana avisa a los tres fallos.', ir: '/panel#ia', irTexto: 'Ver el uso de la IA' },
  ],
};

const MEMBRESIA: AyudaPantalla = {
  titulo: 'Membresía',
  que: 'El plan de esta instalación: hasta cuándo está pagada, sus topes y los pagos.',
  preguntas: [
    { p: '¿Qué pasa si vence?', r: 'El asistente IA y las campañas se pausan; los chats y las entregas siguen. La campana y la franja de arriba lo dicen.' },
    { p: '¿Cómo apunto un pago?', r: '«Apuntar un pago»: la fecha de vencimiento corre según el plan. Solo el superadministrador.' },
    { p: '¿Qué es el tope de respuestas de IA?', r: 'Cuántas respuestas del asistente al mes incluye el plan. En Asistente IA se ve cuántas van y cuántas quedan.', ir: '/panel#ia', irTexto: 'Ver el uso' },
  ],
};

const TIENDAS: AyudaPantalla = {
  titulo: 'Tiendas',
  que: 'Los negocios que controla el dueño del sistema: cada uno con su instalación, su plan y sus pagos.',
  preguntas: [
    { p: '¿Cómo doy de alta una tienda?', r: '«Dar de alta una tienda»: nombre, subdominio y plan. Se crea su instalación con su propio WhatsApp y su base; te da el token que su instalación usa para consultar el plan.' },
    { p: '¿Cómo suspendo a un cliente que no paga?', r: '«Suspender» en su fila: en su instalación se pausan la IA y las campañas, y su panel lo explica. «Reactivar» lo deja como estaba.' },
    { p: '¿Cómo sé si están en línea y si su WhatsApp funciona?', r: 'Cada instalación manda su parte de salud al consultar el plan: la fila dice si su WhatsApp está conectado o caído, cuántos mensajes lleva hoy, fallos de la IA y entregas; «sin noticias desde…» si lleva más de 40 minutos sin consultar. Arriba, la tarjeta de las que tienen el WhatsApp caído.' },
    { p: 'Una tienda mandó su pago, ¿dónde lo veo?', r: 'En «Pagos por revisar»: la captura que mandó desde su pantalla Pagar. «Apuntar el pago» corre su vencimiento con un clic; «Rechazar» pide un motivo que la tienda lee en su pantalla.' },
    { p: '¿Cómo cobro? ¿Dónde pongo mi Yape o Plin?', r: 'En «Cómo me pagan»: número, instrucciones y el QR. Es lo que cada tienda ve en su pantalla Pagar.' },
    { p: '¿Avisa solo cuando una tienda está por vencer?', r: 'Sí: a 7 días, 1 día y el día que vence, a la tienda (al número de su contacto) y a ti (el supervisor de Avisos). Los textos se editan en «Avisos de vencimiento», con «Ver cómo queda» y «Revisar ahora».' },
    { p: '¿Cómo veo qué pasó con una tienda (pagos, cambios, suspensiones)?', r: '«Historial» en su fila: cada alta, pago, cambio de plan, suspensión y aviso, con quién lo hizo y cuándo.' },
    { p: '¿Cómo le escribo a una tienda por WhatsApp?', r: '«Avisar por WhatsApp» en su fila: sale al número que pusiste dentro del contacto («Rosa · 987 654 321»). Sin número, lo dice.' },
  ],
};

const MAPA: AyudaPantalla = {
  titulo: 'Mapa del día',
  que: 'Dónde está cada pedido de hoy y cada motorizado, sobre el mapa.',
  preguntas: [
    { p: '¿Qué significa cada color?', r: 'Azul: tiene ubicación y espera; naranja: en camino con un motorizado; verde: entregado; rojo: con incidencia. Un aro rojo alrededor es un pedido urgente.' },
    { p: '¿Dónde están los motorizados?', r: 'Cada píldora «🛵 Nombre» es su última posición conocida (el último pin al que contestó o entregó) y dice hace cuánto y cuántos pedidos lleva. Si nunca contestó un pin hoy, no sale.' },
    { p: '¿Cómo veo solo los de un motorizado o solo los urgentes?', r: 'Con los chips de arriba: por estado y por motorizado. Se pueden combinar.' },
    { p: 'Toqué un pin, ¿qué puedo hacer?', r: 'La tarjeta dice nombre, pedido, situación, motorizado y hora; «Abrir en Hoy» lleva a esa fila para confirmar, reasignar o marcar entregada, y «Google Maps» abre la ubicación.' },
    { p: 'No sale ningún pin', r: 'Todavía no hay ubicaciones hoy: los clientes aún no mandaron su pin o no se trajeron los pedidos. En Hoy se ve a quién falta la ubicación.', ir: '/hoy', irTexto: 'Ir a Hoy' },
    { p: '¿Se actualiza solo?', r: 'Sí, cada 30 segundos. Arriba dice la hora de la última carga.' },
  ],
};

const FIABILIDAD: AyudaPantalla = {
  titulo: 'Que todo funcione',
  que: 'El WhatsApp vigilado, la prueba de cada mañana, el cupo de hoy y la copia de seguridad.',
  preguntas: [
    { p: 'Se cayó el WhatsApp, ¿me entero?', r: 'El vigilante lo mira cada 30 segundos, pide la reconexión solo y, si sigue caído pasados los minutos del ajuste, manda un correo; cuando vuelve te avisa por WhatsApp y por correo con cuánto estuvo caído. Para el correo hace falta pegar la clave de Brevo (cuenta gratuita) y el correo que lo recibe.' },
    { p: 'Dice «hay que escanear el QR otra vez»', r: 'El teléfono cerró la sesión: la reconexión sola no sirve. Ve a Conexión y vincula de nuevo con el QR.', ir: '/setup', irTexto: 'Ir a Conexión' },
    { p: '¿Qué es la prueba de cada mañana?', r: 'A la hora del ajuste (07:00) manda un mensaje al supervisor y espera que WhatsApp lo dé por entregado, prueba GSG, la IA, las entregas y el espacio en disco. Si algo falla avisa una sola vez. «Probar ahora» la corre en el acto sin avisar.' },
    { p: '¿Nos alcanza el número para todos los pedidos de hoy?', r: 'La caja «Cupo de hoy» cuenta los mensajes que necesitan los pedidos vivos (ubicación, confirmación, motorizado, aviso, gracias) más el envío automático, frente a lo que el número puede mandar hoy; si no alcanza dice qué recortar.' },
    { p: '¿Hay copia de seguridad? ¿Dónde va?', r: 'Cada noche (03:00) la base y los respaldos de conversaciones a la carpeta elegida (por defecto OneDrive o Documentos\\GSGchat-copias); conserva 14. «Hacer copia ahora» y «Comprobar la carpeta» están en la caja; la vinculación del WhatsApp no se copia a propósito.' },
    { p: '¿Cómo restauro una copia?', r: '«Cómo restaurar» en la caja de la copia: los pasos, con el nombre del fichero y dónde ponerlo. Se hace con el servidor parado.' },
  ],
};

const PAGAR: AyudaPantalla = {
  titulo: 'Pagar',
  que: 'Cómo pagar la membresía de esta instalación y mandar la captura del pago.',
  preguntas: [
    { p: '¿Cómo pago?', r: 'Arriba está tu plan y hasta cuándo está pagado; debajo, cómo paga el dueño del sistema (Yape, Plin, QR e instrucciones). Pagas por tu cuenta y mandas la captura aquí.' },
    { p: 'Ya pagué, ¿y ahora?', r: '«Ya pagué: mandar mi captura»: meses, monto, una nota si quieres y la imagen. Le llega al dueño; cuando la apunte, tu vencimiento corre solo y esta pantalla lo dice.' },
    { p: 'Me rechazaron el pago', r: 'Aquí sale el motivo que escribió el dueño. Corrige (captura equivocada, monto incompleto…) y vuelve a mandarla.' },
    { p: 'Dice que esta instalación no depende de un maestro', r: 'Entonces la membresía la lleva el superadministrador de aquí mismo, en Membresía; no hay a quién mandarle la captura.', ir: '/panel#membresia', irTexto: 'Ir a Membresía' },
  ],
};

const INTEGRACIONES: AyudaPantalla = {
  titulo: 'Conectar mi web y tienda',
  que: 'Stoky, el chat dentro de tu web, WooCommerce o Shopify, y las claves para otros programas.',
  preguntas: [
    { p: '¿Cómo conecto otro sistema sin pasarle mi clave?', r: 'Códigos de conexión: un código corto con fecha límite que el otro sistema canjea y recibe su propia clave.' },
    { p: '¿Cómo conecto Stoky?', r: 'En el bloque Stoky: «Crear la clave para Stoky» y pegarla en Stoky → CRM → WhatsApp; y para que este WhatsApp vea su catálogo, la dirección y el token de Stoky. Los dos semáforos dicen si cada dirección funciona.' },
    { p: '¿Cómo pongo el chat en mi web?', r: 'Chat embebido: escribe el dominio de tu web y pega embed.js con un token en tu página.' },
  ],
};

const CONTACTOS: AyudaPantalla = {
  titulo: 'Contactos',
  que: 'Cada número con su consentimiento y su origen.',
  preguntas: [
    { p: '¿Por qué a este contacto no le sale nada?', r: 'Sin consentimiento (opt-in) no sale nada iniciado por el negocio; si escribió BAJA, menos. Responder a quien escribe sí se puede.' },
    { p: '¿Cómo importo muchos?', r: '«Importar»: un Excel o CSV con teléfono y nombre, marcando de dónde viene el consentimiento.' },
  ],
};

const GENERICA = (titulo: string, que: string): AyudaPantalla => ({
  titulo,
  que,
  preguntas: [
    { p: '¿Dónde está el manual de esta parte?', r: 'En el manual de uso, con una entrada por módulo; y el ayudante del manual responde a lo que no encuentres.', ir: '/manual', irTexto: 'Abrir el manual' },
    { p: '¿Por qué no salió un mensaje?', r: 'En Historial de envíos cada envío lleva su motivo (sin consentimiento, ventana de 24 h, cupo del día, ritmo…). En Chats, «¿qué pasó?» sobre el mensaje lo cuenta en palabras.', ir: '/panel#historial', irTexto: 'Historial de envíos' },
  ],
});

/** La ayuda por clave de pantalla (ver `claveDeAyuda`). */
export const AYUDA_PANTALLAS: Record<string, AyudaPantalla> = {
  hoy: HOY,
  entregas: HOY,
  chat: CHAT,
  guardados: GUARDADOS,
  ia: IA,
  motorizados: MOTORIZADOS,
  usuarios: EQUIPO,
  setup: CONEXION,
  configuracion: AJUSTES,
  inicio: INICIO,
  entrenamiento: ENTRENAMIENTO,
  'envio-automatico': ENVIO_AUTOMATICO,
  rutas: RUTAS,
  manual: MANUAL,
  soporte: SOPORTE,
  membresia: MEMBRESIA,
  tiendas: TIENDAS,
  mapa: MAPA,
  fiabilidad: FIABILIDAD,
  pagar: PAGAR,
  integraciones: INTEGRACIONES,
  contactos: CONTACTOS,
  pedidos: GENERICA('Pedidos del chat', 'Lo que el asistente o una persona cerró en la conversación: confirmar, cancelar o pasarlo a la tienda.'),
  historial: GENERICA('Historial de envíos', 'Todo lo que salió, con su estado y su motivo si no salió.'),
  estado: GENERICA('Estado del número', 'Calidad, cupo del día, cola y pausa manual.'),
  salud: GENERICA('Riesgo y ritmo', 'Lo que mira el monitor: errores, bloqueos, bajas; por qué frena y cuándo.'),
  campanas: GENERICA('Campañas', 'Envíos masivos por goteo, con canario y al ritmo que el número tolera.'),
  grupos: GENERICA('Enviar a un grupo', 'Elegir clientes por cómo están y mandarles a todos un mensaje personalizado.'),
  automatizacion: GENERICA('Respuestas automáticas', 'Reglas por palabra clave y secuencias, sin IA.'),
  plantillas: GENERICA('Mensajes aprobados', 'Las plantillas de Meta y las propias.'),
  enviar: GENERICA('Enviar mensaje', 'Un texto, un pin o una plantilla a un número concreto.'),
  stickers: GENERICA('Stickers', 'Los stickers que salen solos y los que se mandan a mano.'),
  ubicaciones: GENERICA('Ubicaciones recibidas', 'Los pines que mandaron los clientes.'),
  vivo: GENERICA('Rastreo en vivo', 'Enlaces para compartir y ver una posición en tiempo real.'),
  extraer: GENERICA('Extraer coordenadas', 'Pega un enlace de mapa o un texto y saca las coordenadas.'),
  actividad: GENERICA('Actividad', 'Quién hizo qué y cuándo.'),
  'mi-cuenta': GENERICA('Mi cuenta', 'Tu contraseña y tu sesión.'),
};

/**
 * La clave de ayuda de una ruta: /hoy -> hoy, /panel#ia -> ia, /panel -> inicio,
 * /rutas#ajustes -> rutas. Lo mismo que hace el armazon en el navegador.
 */
export function claveDeAyuda(pathname: string, hash = ''): string {
  const ruta = pathname.replace(/\/+$/, '') || '/';
  const ancla = hash.replace(/^#/, '');
  if (ruta === '/panel') return ancla || 'inicio';
  if (ruta === '/entregas') return 'hoy';
  return ruta.replace(/^\//, '').split('/')[0] || 'inicio';
}

export function ayudaDe(pathname: string, hash = ''): AyudaPantalla | null {
  return AYUDA_PANTALLAS[claveDeAyuda(pathname, hash)] ?? null;
}
