/**
 * La ayuda de cada pantalla: "¿Qué hago si…?".
 *
 * El reparto con el manual (`ayuda-pages.ts`), para no decir dos veces lo
 * mismo:
 *
 *  - aqui: que es esta pantalla y que hacer AHORA. Una frase y unas pocas
 *    preguntas PROPIAS de ella (Hoy no explica campañas; Chats no explica
 *    motorizados). Respuestas de dos o tres lineas.
 *  - el manual: el recorrido completo, el porque y los casos raros. Cuando
 *    una respuesta de aqui se alarga, se corta y se enlaza con
 *    `ir: '/manual#m-…'`.
 *
 * El `que` tampoco repite la descripcion del modulo en el menu (shell.ts):
 * el menu dice que es, aqui se dice por donde empezar.
 *
 * El armazon (shell.ts) mete todas estas fichas en cada pagina y elige la de
 * la ruta actual; abajo del cajon, "Preguntarle a la IA" abre la IA operadora
 * con la pregunta ya escrita.
 */

export interface PreguntaAyuda {
  /** La pregunta, como la haria quien opera ("¿Qué hago si…?"). */
  p: string;
  /** La respuesta, corta y sin jerga: dos o tres lineas. Lo largo, al manual. */
  r: string;
  /** A donde se hace: otra pantalla, otro sitio de esta, o el manual. */
  ir?: string;
  irTexto?: string;
}

export interface AyudaPantalla {
  titulo: string;
  /** Una frase: que es esta pantalla y por donde se empieza. No repite el menu. */
  que: string;
  preguntas: PreguntaAyuda[];
}

const HOY: AyudaPantalla = {
  titulo: 'Hoy',
  que: 'Cada pedido de hoy, de la ubicación a la entrega. Empieza por los que dicen «necesita a alguien»: el resto avanza solo.',
  preguntas: [
    { p: '¿Qué hago si un pedido dice «necesita a alguien»?', r: 'Ábrelo con el botón de ver de su fila: la incidencia dice qué pasó (no contestó, pidió otro día, el motorizado no pudo, el cliente no estaba…). Ahí están todas las acciones: confirmar a mano, poner el pin, pasarlo a otro motorizado, reintentar o cancelar. Y el enlace al chat, si hay que llamar.', ir: '/hoy?filtro=incidencia', irTexto: 'Ver las que necesitan a alguien' },
    { p: '¿Qué hago si el cliente no manda su ubicación?', r: 'El sistema se la pide solo, con pausas y varios intentos, a lo largo del día. Si el cliente te la dio por teléfono, ponla tú a mano desde su fila: acepta el enlace de Google Maps o las coordenadas.' },
    { p: '¿Qué hago si el motorizado no contesta?', r: 'A los 10 minutos se le insiste y a la segunda vez el pedido pasa a otro motorizado activo. Si quieres cambiarlo ya, en la fila está pasarlo a otro. Si no hay ningún motorizado activo, el pedido se queda esperando: da de alta uno o reactiva a alguien.', ir: '/motorizados', irTexto: 'Ir a Motorizados' },
    { p: '¿Cómo marco un pedido como entregado?', r: 'Lo normal es que el motorizado escriba «entregado» (o mande la foto) y el pedido se cierre solo. Si avisó por teléfono, marcarlo entregado desde su fila lo cierra a mano y GSG se entera igual.' },
    { p: '¿Qué pasa con lo que quedó de ayer?', r: 'El cierre del día (a la hora de Ajustes de las entregas, o con el botón de la tira de arriba) pasa lo vivo de ayer a «necesitan a alguien», da por entregado lo avisado y avisa a GSG y al supervisor con un solo mensaje.' },
    { p: 'Hoy no tengo GSG conectado, ¿cómo cargo los pedidos?', r: 'Con «Pegar la lista del día»: una línea por cliente (teléfono, nombre, pedido, dirección) y el sistema hace lo mismo que con la lista de GSG. También hay «Pedido a mano» para uno suelto.' },
    { p: '¿Cómo pruebo sin escribirle a clientes de verdad?', r: '«Modo prueba con mi número» deja el sistema escribiéndole solo a tu número (arriba queda un cartel rojo). Y en «Probar con números ficticios» cargas 10 clientes y 10 motorizados de mentira con el simulador de GSG.' },
    { p: '¿Qué significa «N reportes que GSG no aceptó»?', r: 'Cada ubicación, confirmación y entrega se le cuenta a GSG. Si GSG rechazó alguna, aquí se ve: «Reintentar» las vuelve a mandar y «Descargar» te da el fichero para mandarlo a mano.' },
    { p: '¿Cómo pruebo todo sin molestar a nadie?', r: 'Abre «Probar con números ficticios» y pulsa «Probar el día entero con datos ficticios»: carga clientes y motorizados inventados, trae la lista y simula las respuestas de todos paso a paso (pines, síes, tiempos, «entregado»). Se ve funcionar de punta a punta y se puede detener.', ir: '/hoy', irTexto: 'Ir a la caja de pruebas' },
    { p: '¿Por qué no le pidió el pin a un cliente que ya conocemos?', r: 'Si ya mandó su ubicación hace poco (menos de 60 días, se cambia en Ajustes), primero se le propone «¿te lo llevamos a la misma dirección?» con botones. Si dice que es otra, o no contesta en una hora, se le pide el pin como siempre.', ir: '/hoy', irTexto: 'Cliente recurrente, en Ajustes de las entregas' },
    { p: '¿Un cliente tiene dos pedidos el mismo día?', r: 'Un solo pin vale para los dos; se le pregunta por cada pedido, uno por uno, y los dos van al mismo motorizado en un solo mensaje. En la lista se ve el chip «+1 del mismo cliente».' },
  ],
};

const CHAT: AyudaPantalla = {
  titulo: 'Chats',
  que: 'Atiende lo que espera respuesta. El asistente contesta lo rutinario; tú entras cuando hace falta.',
  preguntas: [
    { p: '¿Qué hago si el cliente dice que no le llegó nada?', r: 'Pasa el ratón por el mensaje y pulsa «¿qué pasó?»: dice si salió, si WhatsApp lo entregó o lo leyó, y si no salió, por qué (sin consentimiento, ventana de 24 h cerrada, cupo del día, modo prueba…).' },
    { p: '¿Cómo llamo al cliente desde el celular?', r: 'En el teléfono, el 📞 de la cabecera del chat abre el marcador con su número; en la «Ficha» hay un botón grande «Llamar» y, si mandó su ubicación, «Abrir en el mapa».' },
    { p: '¿Qué sé del cliente antes de contestarle?', r: 'Botón «Ficha» en la cabecera (o Ctrl+Shift+I): quién es, si se le puede escribir, su pedido de hoy con su estado y su motorizado, su última ubicación (con «Abrir en el mapa» y «Copiar»: las coordenadas las ves tú, el cliente no) y sus conversaciones guardadas.' },
    { p: '¿Hay atajos de teclado para atender más rápido?', r: 'Sí, y muchos. F1 los enseña todos sin salir del chat. Los de diario: «/» abre las respuestas rápidas, Alt+↑ y Alt+↓ cambian de conversación y Esc vuelve a la lista.', ir: '/manual#m-chat', irTexto: 'La lista entera, en el manual' },
    { p: '¿Cómo hago que el asistente deje de contestar en este chat?', r: 'Botón «De este me encargo yo» en la cabecera del chat (o Ctrl+Shift+B): desde ahí ni el asistente ni las reglas contestan hasta que lo sueltes.' },
    { p: '¿Cómo le pido la ubicación a un cliente?', r: 'Con el botón de ubicación de la caja de escribir (📍): le llega el botón nativo de WhatsApp; cuando la mande, el sistema la registra solo y la liga a su pedido de hoy.' },
    { p: '¿Por qué solo puedo mandar una plantilla?', r: 'Con la API de Meta, pasadas 24 h desde el último mensaje del cliente solo puede salir una plantilla aprobada; la pantalla lo dice. Con el QR (cliente local) no existe esa regla.' },
    { p: '¿Cómo guardo una conversación?', r: '«Guardar y vaciar» en la cabecera: queda en Conversaciones guardadas (con su resumen y sus adjuntos) y el hilo se vacía. Se puede devolver al chat cuando quieras.', ir: '/guardados', irTexto: 'Ver las guardadas' },
    { p: 'El asistente respondió mal, ¿cómo lo corrijo?', r: 'Desde el propio mensaje: escribes lo que debió decir y queda como lección, así que ante una pregunta parecida ya no repite lo de antes. Lo mismo sobre un mensaje del cliente, para enseñarle la respuesta buena.', ir: '/entrenamiento', irTexto: 'Ver todas las lecciones' },
    { p: '¿Puedo mandar fotos, audios o documentos?', r: 'Sí: con el clip 📎, arrastrando el archivo o pegándolo (Ctrl V). Y con la voz del asistente configurada, un texto puede salir como nota de voz.' },
    { p: '¿Dónde veo las coordenadas del pin que mandó el cliente?', r: 'En el chat, el pin sale como una tarjeta con las coordenadas, «Abrir en el mapa» y «Copiar». Al cliente nunca se le mandan las coordenadas: solo el enlace del mapa.' },
  ],
};

const GUARDADOS: AyudaPantalla = {
  titulo: 'Conversaciones guardadas',
  que: 'Lo hablado con cada cliente, ya cerrado y a salvo. Búscalo por cliente, por palabra o por fecha.',
  preguntas: [
    { p: '¿Cómo encuentro qué dijo un cliente hace un mes?', r: 'Busca por su nombre o número, o escribe una palabra en «dentro de lo que se dijo»; filtra por etiqueta (reclamo, entrega, venta…), por pedido o por fechas.' },
    { p: '¿Qué hago si GSG me pide la prueba de una conversación?', r: 'Abre la conversación y pulsa «Enlace de evidencia»: un enlace con fecha de caducidad que se abre sin cuenta. Se puede anular cuando quieras.' },
    { p: '¿Se guardan las fotos y los audios?', r: 'Sí: los adjuntos se copian junto a la conversación y se abren desde el lector.' },
    { p: '¿Cómo devuelvo una conversación al chat?', r: 'Abre la conversación y pulsa «Devolver al chat»: el hilo vuelve tal cual a Chats.' },
    { p: 'Un cliente pide que borremos sus datos', r: 'Abre su conversación y usa el botón rojo de borrar todo lo suyo: lo guardado, sus adjuntos y su chat. Hay que escribir BORRAR para confirmar; queda 30 días en la papelera y luego se va de verdad.' },
    { p: '¿Se guardan solas?', r: 'Sí: a los N días sin movimiento (se cambia aquí mismo) y de golpe con «Guardar las de los pedidos terminados hoy». Van a la papelera 30 días antes de borrarse del todo.' },
    { p: '¿Puedo enseñarle a la IA con lo que ya hablamos?', r: 'Sí: de una conversación, o de todas las de este mes de golpe. Saca las preguntas del cliente con lo que contestó una persona y las deja pendientes de aprobar en Entrenar a la IA.', ir: '/entrenamiento', irTexto: 'Ver las lecciones' },
  ],
};

const IA: AyudaPantalla = {
  titulo: 'Asistente IA',
  que: 'Con qué IA contesta y qué sabe de tu negocio. Si no contesta, la tira de tres pasos de arriba dice qué falta.',
  preguntas: [
    { p: '¿Qué hago si el asistente no contesta?', r: 'Mira la tira de tres pasos: ¿hay clave o sesión de Puter? ¿está encendido? Luego: ¿el bot está pausado en ese chat («de este me encargo yo»)? ¿el número está en modo prueba y ese cliente no está en la lista? ¿la membresía tiene tope?' },
    { p: 'Quiero usar ChatGPT, Groq o Google en vez de Puter', r: 'En «Con qué IA» elige «Una clave de API», elige el servicio (rellena la dirección y sugiere modelos), pega la clave, «Probar la conexión» y guarda.' },
    { p: '¿Cómo sé cuánto gasto?', r: 'La tarjeta «Uso de la IA» dice cuántas respuestas, lecturas y órdenes hubo hoy y en el mes, los tokens si el servicio los cuenta, los fallos y lo que queda del tope de tu membresía. Tres fallos seguidos avisan en la campana.' },
    { p: '¿Cómo le enseño algo nuevo?', r: 'Escríbelo en «Qué sabe» y guarda: se aplica al siguiente mensaje. Para muchas cosas (un Excel, los chats de meses), Entrenar a la IA.', ir: '/entrenamiento', irTexto: 'Entrenar a la IA' },
    { p: '¿Puede contestar con audio?', r: 'Sí, con una clave de ElevenLabs en la sección Voz de esta pantalla. Si algo falla, el mensaje sale por escrito: la voz nunca deja a nadie sin respuesta.', ir: '/manual#m-voz', irTexto: 'Cómo se configura la voz' },
    { p: '¿Cómo pruebo lo que va a decir?', r: 'La conversación de prueba de esta pantalla (no sale por WhatsApp) y el examen por grupos de escenarios («Ataques al asistente» incluido).' },
    { p: '¿Qué NO hace nunca?', r: 'No cobra, no confirma pagos y no inventa precios ni horas: las cifras las pone el sistema. Y no se deja sacar de su papel, aunque se lo pidan.', ir: '/manual#m-seguridad-ia', irTexto: 'Las defensas del asistente' },
    { p: '¿Qué hago con «Lo que la IA no entendió»?', r: 'Son respuestas de clientes y motorizados que ni las reglas ni la IA supieron leer. Di qué era («Era un sí», «Eran esos minutos»…) y el lector lo aprende: la próxima vez no vuelve a preguntar. Con la casilla, además queda como lección.', ir: '/panel#ia', irTexto: 'Abrir el tablero' },
    { p: '¿Cómo sé si el lector de respuestas sigue leyendo bien?', r: 'Cada mañana se examina solo con frases reales y aquí se ve cuánto acierta; si baja del umbral avisa al supervisor. «Examinar ahora» lo pasa al momento y enseña los fallos uno a uno.', ir: '/panel#ia', irTexto: 'Ver el examen' },
  ],
};

const MOTORIZADOS: AyudaPantalla = {
  titulo: 'Motorizados',
  que: 'Quiénes reparten hoy. Da de alta, pon en descanso o mándale su enlace a quien no tiene el suyo.',
  preguntas: [
    { p: '¿Cómo doy de alta a un motorizado?', r: 'Con el botón de dar de alta, arriba de la lista: nombre, su WhatsApp (con 51 delante o sin él), zona y placa. Desde ese momento el sistema le manda los pines y lee lo que contesta. Para varios de golpe, pega la lista.' },
    { p: '¿Qué hago si un motorizado se queda sin moto o se accidenta?', r: 'Ponlo en descanso desde su fila: sus pedidos vivos pasan a otros y el sistema te pregunta a quién. Si él mismo escribe «me quedo sin moto» o «accidente», lo hace solo y te avisa.' },
    { p: '¿Cómo se elige a quién le toca cada pedido?', r: 'Primero el que está a menos de 6 km según su última posición de hoy y no tiene otro pin sin contestar; si nadie está cerca, el de la zona del distrito; si no, el activo menos cargado.' },
    { p: '¿Qué significa «Última posición: hace N min»?', r: 'Es el pin del último pedido al que contestó o que entregó. Sirve para darle el siguiente pedido al más cercano.' },
    { p: '¿Cómo le doy su propia pantalla de pedidos?', r: 'En el menú de más acciones de su fila, mándale su enlace: le llega por WhatsApp uno propio (vale 7 días) que abre en el navegador del celular, sin instalar nada. Ve sus pedidos de hoy en orden, con botones grandes para el mapa, los minutos que tardará, «estoy cerca», «entregado» y «no había nadie»; cada uno hace lo mismo que si lo escribiera por WhatsApp. Cuando caduca, se le manda otro igual.' },
    { p: '¿Qué le llega por WhatsApp a un motorizado?', r: 'El nombre y el pedido del cliente, el enlace de Google Maps y el pin, y la pregunta «¿en cuántos minutos lo entregas?». Después, el sistema entiende «40», «media hora», «no puedo», «entregado», «no estaba nadie».' },
    { p: '¿Puedo borrar a uno?', r: 'Darlo de baja (en el menú de más acciones de su fila) lo quita de los activos sin perder su historial. Un motorizado de baja no recibe nada.' },
  ],
};

const EQUIPO: AyudaPantalla = {
  titulo: 'Equipo',
  que: 'Una cuenta por persona: así la bitácora dice quién hizo qué. Nadie comparte usuario.',
  preguntas: [
    { p: '¿Qué puede hacer cada rol?', r: 'Operador: atiende. Administrador: además configura el negocio y crea operadores. Superadministrador: además lleva la membresía y las tiendas.', ir: '/manual#m-cuentas', irTexto: 'Los tres roles, en detalle' },
    { p: '¿Cómo creo una cuenta para alguien del equipo?', r: '«Crear usuario»: nombre, usuario, contraseña y rol. Cada persona entra en /login con lo suyo; así la bitácora dice quién hizo qué.' },
    { p: 'Alguien olvidó su contraseña', r: 'Un administrador la cambia desde aquí. Cada uno cambia la suya en Mi cuenta.', ir: '/panel#mi-cuenta', irTexto: 'Mi cuenta' },
    { p: '¿Cómo desactivo a alguien que ya no trabaja aquí?', r: '«Desactivar» en su fila: deja de poder entrar, pero lo que hizo sigue en la bitácora. El último superadministrador no se puede desactivar.' },
  ],
};

const CONEXION: AyudaPantalla = {
  titulo: 'Conexión',
  que: 'El WhatsApp con el que trabaja el sistema y la conexión con GSG. Si algo está en rojo, se arregla desde aquí.',
  preguntas: [
    { p: '¿Qué es «¿Para qué vas a usar GSGchat?» (el paso 0)?', r: 'El perfil de la instalación: «Reparto para GSG» (lo de siempre: menú corto, entregas con botones, cierre del día), «Tienda con delivery» (menú completo con catálogo y pedidos del chat) o «Solo atención por chat» (sin reparto). Cambia el menú, qué contesta solo y los interruptores de las entregas; nunca toca tus textos, tus clientes ni tus motorizados. Se puede cambiar cuando quieras.', ir: '/setup', irTexto: 'Ver el paso 0' },
    { p: 'GSG canceló un pedido o cambió la dirección, ¿qué pasa aquí?', r: 'En la siguiente sincronización (cada 5 minutos, o trayendo los pendientes de GSG a mano desde Hoy) se refleja solo: si cambió la dirección, el distrito o el teléfono, se actualiza y se le avisa al motorizado que ya lo llevaba; si GSG lo cancela, se cancela aquí y al cliente que ya tenía hora se le avisa. Ojo: una lista vacía o GSG caído nunca cancelan nada; solo una cancelación pedido a pedido. En «Para los programadores de GSG» hay dos botones de prueba para verlo con el simulador.' },
    { p: '¿Cómo conecto el WhatsApp?', r: 'Escaneando el QR desde el teléfono (Dispositivos vinculados), como en WhatsApp Web. Conviene un número secundario. También se puede usar WAHA o la API oficial de Meta.' },
    { p: 'No me sale el QR o dice «parado»', r: 'Pulsa «Conectar» otra vez: si el teléfono cerró la sesión, el sistema borra la vinculación vieja y enseña un QR nuevo. Si sigue igual, «Desconectar la cuenta» y vuelve a vincular.' },
    { p: '¿Cómo conecto GSG?', r: 'En el bloque GSG: pega la dirección de su API y el token, «Probar» y guarda. Hasta que GSG tenga API, el simulador de este servidor sirve para probar el flujo entero con números ficticios.' },
    { p: '¿Qué pasa si GSG se cae?', r: 'Nada se pierde: las ubicaciones, confirmaciones y entregas esperan en una cola y salen enteras cuando GSG vuelve. En Hoy se ve lo que no aceptó.', ir: '/hoy', irTexto: 'Ver en Hoy' },
    { p: '¿Se desconecta solo?', r: 'Si el teléfono pierde la sesión, Hoy y la campana lo dicen y los envíos esperan. Con el teléfono encendido y con internet, la vinculación se mantiene.' },
    { p: 'Con la API de Meta, ¿qué cambia?', r: 'Hacen falta plantillas aprobadas para escribir fuera de la ventana de 24 h, y desde el 1/10/2026 Meta cobra también lo que se contesta dentro de la ventana. La pantalla lleva la cuenta de lo pendiente.' },
    { p: '¿Cómo prueban los programadores de GSG sin tocar nada real?', r: 'En «Para los programadores de GSG», crea un token del simulador (caduca solo y se puede anular) y pásaselo junto con la dirección del simulador y el contrato. Todo lo que manden se ve en «Lo que GSG nos mandó».', ir: '/setup', irTexto: 'Ir al bloque de GSG' },
    { p: 'GSG mandó pedidos que no aparecen en Hoy', r: 'Mira la caja ámbar del bloque de GSG: dice qué pedidos no se pudieron leer y por qué (teléfono inválido, sin referencia…). Avísale a GSG; en cuanto los mande bien entran solos en la siguiente consulta. «Verificar el contrato» lo revisa campo por campo.', ir: '/setup', irTexto: 'Ver los descartes' },
    { p: '¿Cómo sé que lo entregado aquí cuadra con lo de GSG?', r: '«Cuadrar el día con GSG» compara sus terminados con lo entregado o cancelado aquí y enseña las diferencias en los dos sentidos; el resumen de la tarde al supervisor lleva la misma línea.', ir: '/setup', irTexto: 'Cuadrar ahora' },
  ],
};

const AJUSTES: AyudaPantalla = {
  titulo: 'Ajustes',
  que: 'Lo que cambia cómo se comporta el sistema. Cambia una cosa y compruébala antes de tocar la siguiente.',
  preguntas: [
    { p: '¿Cómo cambio la zona horaria?', r: 'En «Horario de envío», el desplegable «Zona horaria» (Lima por defecto): con ella se escribe, se cierra el día, se mandan los resúmenes y se calcula el horario de envío.', ir: '/panel#configuracion' },
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
  que: 'El día de un vistazo. Lo que pide atención está marcado, y cada cifra lleva a su pantalla ya filtrada.',
  preguntas: [
    { p: 'Cómo ponerlo en el celular como una app', r: 'No hay que instalar nada de una tienda de aplicaciones. Android (Chrome): abre esta dirección, toca el menú ⋮ arriba a la derecha y elige «Añadir a la pantalla de inicio» (o «Instalar aplicación»); acepta y queda el icono «G». iPhone (Safari): abre la dirección, toca el botón de compartir (el cuadrado con la flecha), baja hasta «Añadir a pantalla de inicio» y confirma. Desde ese icono se abre a pantalla completa, con el pie de abajo (Hoy · Chats · Motorizados · Mapa · Más) para llevarlo con el pulgar.' },
    { p: '¿Qué me falta para empezar?', r: 'La tarjeta «Para empezar» lo dice con estado real: conectar el WhatsApp, dar de alta a los motorizados y traer los pedidos (GSG o la lista del día). Cuando está todo, se pliega a una línea.' },
    { p: '¿Qué es «Entregas de hoy»?', r: 'Las cifras del día: cuántos faltan ubicación o confirmar, en camino, entregadas y las que necesitan a alguien. Cada cifra lleva a Hoy ya filtrado.', ir: '/hoy', irTexto: 'Ir a Hoy' },
    { p: '¿Qué significa el semáforo del número?', r: 'De verde a rojo, cuánto puede mandar el número hoy: lo decide el monitor mirando fallos, bajas y bloqueos. En rojo no sale nada hasta que mejore.', ir: '/manual#m-salud', irTexto: 'Qué significa cada color' },
    { p: '¿Cómo busco a un cliente o un pedido?', r: 'Ctrl K (o la lupa de arriba): escribe un nombre, un número o una referencia y salen los pedidos de hoy, los clientes y las conversaciones guardadas.' },
  ],
};

const ENTRENAMIENTO: AyudaPantalla = {
  titulo: 'Entrenar a la IA',
  que: 'Lo que el asistente ha aprendido. Enseña una cosa a mano, importa miles o deja que aprenda de tus chats.',
  preguntas: [
    { p: '¿Cómo le enseño muchas cosas de golpe?', r: '«Importar»: acepta un Excel o CSV, un JSON o un chat exportado de WhatsApp. Antes de guardar nada, «Ver qué entendió» te enseña una muestra; las repetidas no entran dos veces.', ir: '/manual#m-entrenamiento', irTexto: 'Los formatos que acepta' },
    { p: '¿Puede aprender de lo que ya hablamos?', r: 'Sí: «Aprender de las conversaciones» recorre los chats y guarda cada pregunta con la respuesta que dio una persona. Se puede pedir revisarlas antes de usarlas.' },
    { p: '¿Cómo sé si aprendió bien?', r: '«Examinar»: se le hacen las preguntas de las lecciones y se compara; «solo las que fallaron» para repasar.' },
    { p: '¿Se usan todas las lecciones en cada mensaje?', r: 'No: en cada mensaje elige las que vienen al caso y solo esas usa (las reglas van siempre). Por eso pueden ser miles.' },
  ],
};

const ENVIO_AUTOMATICO: AyudaPantalla = {
  titulo: 'Envío automático',
  que: 'Pon un número y el sistema le escribe solo, cada pocas horas, hasta que conteste. Se quita solo cuando lo consigue.',
  preguntas: [
    { p: '¿Cómo pongo a alguien para pedirle su ubicación?', r: 'En «Poner números», arriba: teléfono, nombre y qué se le pide. Desde ahí le escribe cada 3 horas (ajustable), en horario y como una persona. Se pueden pegar cientos de golpe.' },
    { p: '¿Por qué ya no está Juan en la lista?', r: 'En «Últimos movimientos» está el motivo: mandó su ubicación, contestó, agotó los intentos, se dio de baja o lo quitó alguien.' },
    { p: '¿Puedo pausar a alguien sin quitarlo?', r: 'Sí: «Pausar» en su fila. «Reanudar» sigue donde iba.' },
  ],
};

const RUTAS: AyudaPantalla = {
  titulo: 'Ubicaciones para reparto',
  que: 'Pega la lista del día y el sistema le pide la ubicación a cada cliente. Tú solo miras lo que necesita una persona.',
  preguntas: [
    { p: '¿Cómo cargo un lote?', r: 'Pega la lista (teléfono, nombre, pedido, dirección) y créalo. Si dejas marcada la casilla de empezar a pedir en cuanto se cree, arranca solo; si no, se arranca después desde el propio lote. Cada cliente recibe su petición con su pausa, en horario y con varios intentos.' },
    { p: '¿Qué hago con «necesita una persona»?', r: 'Son los que no se resolvieron solos: sin WhatsApp, número corto, contestó sin ubicación, «no soy yo». Se llaman o se resuelven a mano desde la fila.' },
    { p: '¿GSG se entera?', r: 'Sí: cada ubicación y el resumen del lote se le reportan; si GSG está caído, esperan en la cola.' },
  ],
};

const MANUAL: AyudaPantalla = {
  titulo: 'Manual de uso',
  que: 'El recorrido completo del sistema. Busca una palabra arriba y abajo quedan solo las partes que hablan de eso.',
  preguntas: [
    { p: 'No encuentro lo que busco', r: 'Escribe tu duda en la caja del ayudante, arriba del todo: responde con el manual entero y te dice en qué pantalla se hace.' },
    { p: '¿Y la ayuda de una pantalla concreta?', r: 'Está en la propia pantalla: el botón «¿Qué hago si…?» de arriba a la derecha. El manual es el recorrido largo; ese botón, lo de ahora mismo.' },
    { p: '¿Puedo pedirle al sistema que haga cosas con palabras?', r: 'Sí: el botón «IA» de arriba abre la IA operadora y ejecuta con tu cuenta; lo delicado te lo deja para confirmar.', ir: '/manual#m-ia-operadora', irTexto: 'Qué le puedo pedir' },
  ],
};

const SOPORTE: AyudaPantalla = {
  titulo: 'Soporte',
  que: 'Lo que hay que mirar cuando algo falla, en orden. Empieza por el diagnóstico de arriba: si algo sale en rojo, es eso.',
  preguntas: [
    { p: '¿Qué mando al reportar un problema?', r: 'El diagnóstico de esta pantalla (botón «Copiar el diagnóstico»): versión, conexión, colas y últimos fallos, sin datos de clientes. Con la hora exacta y el número del cliente basta para reproducirlo.' },
    { p: '¿Por dónde empiezo si algo no funciona?', r: 'Por las listas de abajo: están puestas por síntoma («no sale ningún mensaje», «el reparto no avanza»…), con qué mirar en cada caso.' },
    { p: 'Un cliente dice que no le llegó un mensaje concreto', r: 'Eso no se ve aquí: en Chats, «¿qué pasó?» sobre ese mensaje dice cuándo salió, si WhatsApp lo entregó o lo leyó, y si no salió, por qué.', ir: '/chat', irTexto: 'Ir a Chats' },
  ],
};

const MEMBRESIA: AyudaPantalla = {
  titulo: 'Membresía',
  que: 'Hasta cuándo está pagada esta instalación y qué incluye el plan. Si vence, la IA y las campañas se paran.',
  preguntas: [
    { p: '¿Qué pasa si vence?', r: 'El asistente IA y las campañas se pausan; los chats y las entregas siguen. La campana y la franja de arriba lo dicen.' },
    { p: '¿Cómo apunto un pago?', r: '«Apuntar un pago»: la fecha de vencimiento corre según el plan. Solo el superadministrador.' },
    { p: '¿Qué es el tope de respuestas de IA?', r: 'Cuántas respuestas del asistente al mes incluye el plan. En Asistente IA se ve cuántas van y cuántas quedan.', ir: '/panel#ia', irTexto: 'Ver el uso' },
  ],
};

const TIENDAS: AyudaPantalla = {
  titulo: 'Tiendas',
  que: 'Los negocios a los que les pusiste el sistema. Empieza por «Pagos por revisar» y por las que vencen pronto.',
  preguntas: [
    { p: '¿Cómo doy de alta una tienda?', r: '«Dar de alta una tienda»: nombre, subdominio y plan. Se crea su instalación con su propio WhatsApp y su base; te da el token que su instalación usa para consultar el plan.' },
    { p: '¿Cómo suspendo a un cliente que no paga?', r: '«Suspender» en su fila: en su instalación se pausan la IA y las campañas, y su panel lo explica. «Reactivar» lo deja como estaba.' },
    { p: '¿Cómo sé si están en línea y si su WhatsApp funciona?', r: 'Cada instalación manda su parte de salud al consultar el plan: la fila dice si su WhatsApp está conectado o caído, cuántos mensajes lleva hoy, fallos de la IA y entregas; «sin noticias desde…» si lleva más de 40 minutos sin consultar. Arriba, la tarjeta de las que tienen el WhatsApp caído.' },
    { p: '¿La tienda recibe un recibo cuando apunto su pago?', r: 'Sí: al apuntar el pago le llega por WhatsApp un recibo con el monto, hasta cuándo queda pagada y cómo renovar (texto editable en «Textos de los avisos», con «Ver cómo queda»). Si la tienda no tiene número de contacto, la pantalla lo dice.' },
    { p: '¿Cómo entro al panel de una tienda para ayudarla?', r: 'Con su permiso: la tienda concede desde su pantalla «Pagar» un acceso de soporte que dura unas horas; aquí, en su fila, aparece «Entrar a su panel (acceso de soporte hasta las …)». Entras como administrador (nunca como dueño de esa tienda) y el acceso se apaga solo al vencer o cuando la tienda lo quita.' },
    { p: 'Una tienda mandó su pago, ¿dónde lo veo?', r: 'En «Pagos por revisar»: la captura que mandó desde su pantalla Pagar. «Apuntar el pago» corre su vencimiento con un clic; «Rechazar» pide un motivo que la tienda lee en su pantalla.' },
    { p: '¿Cómo cobro? ¿Dónde pongo mi Yape o Plin?', r: 'En «Cómo me pagan»: número, instrucciones y el QR. Es lo que cada tienda ve en su pantalla Pagar.' },
    { p: '¿Avisa solo cuando una tienda está por vencer?', r: 'Sí: a 7 días, 1 día y el día que vence, a la tienda (al número de su contacto) y a ti (el supervisor de Avisos). Los textos se editan en «Avisos de vencimiento», con «Ver cómo queda» y «Revisar ahora».' },
    { p: '¿Cómo veo qué pasó con una tienda (pagos, cambios, suspensiones)?', r: '«Historial» en su fila: cada alta, pago, cambio de plan, suspensión y aviso, con quién lo hizo y cuándo.' },
    { p: '¿Cómo le escribo a una tienda por WhatsApp?', r: '«Avisar por WhatsApp» en su fila: sale al número que pusiste dentro del contacto («Rosa · 987 654 321»). Sin número, lo dice.' },
  ],
};

const MAPA: AyudaPantalla = {
  titulo: 'Mapa del día',
  que: 'Dónde está ahora mismo cada pedido y cada motorizado. Se actualiza solo cada 30 segundos.',
  preguntas: [
    { p: '¿Qué significa cada color?', r: 'Los mismos tonos que los chips de Hoy, y la leyenda del propio mapa los repite: ámbar, falta confirmar con el cliente; azul, en camino con un motorizado; verde, entregada; rojo, con incidencia. Un aro rojo alrededor marca un pedido urgente.' },
    { p: '¿Dónde están los motorizados?', r: 'Cada píldora «🛵 Nombre» es su última posición conocida (el último pin al que contestó o entregó) y dice hace cuánto y cuántos pedidos lleva. Si nunca contestó un pin hoy, no sale.' },
    { p: '¿Cómo veo solo los de un motorizado o solo los urgentes?', r: 'Con los chips de arriba: por estado y por motorizado. Se pueden combinar.' },
    { p: 'Toqué un pin, ¿qué puedo hacer?', r: 'La tarjeta dice nombre, pedido, situación, motorizado y hora; «Abrir en Hoy» lleva a esa fila para confirmar, reasignar o marcar entregada, y «Google Maps» abre la ubicación.' },
    { p: 'No sale ningún pin', r: 'Todavía no hay ubicaciones hoy: los clientes aún no mandaron su pin o no se trajeron los pedidos. En Hoy se ve a quién falta la ubicación.', ir: '/hoy', irTexto: 'Ir a Hoy' },
    { p: '¿Se actualiza solo?', r: 'Sí, cada 30 segundos. Arriba dice la hora de la última carga.' },
  ],
};

const FIABILIDAD: AyudaPantalla = {
  titulo: 'Que todo funcione',
  que: 'Lo que vigila que el sistema siga en pie. Con todo en verde no hay nada que hacer aquí: solo mirarlo.',
  preguntas: [
    { p: 'Se cayó el WhatsApp, ¿me entero?', r: 'El vigilante lo mira cada 30 segundos, pide la reconexión solo y, si sigue caído pasados los minutos del ajuste, manda un correo; cuando vuelve te avisa por WhatsApp y por correo con cuánto estuvo caído. Para el correo hace falta pegar la clave de Brevo (cuenta gratuita) y el correo que lo recibe.' },
    { p: '¿Qué pasa con los pedidos mientras el WhatsApp está caído?', r: 'Nada se pierde: los motores se paran solos (no acumulan intentos), el supervisor recibe el correo a los minutos del ajuste y, cuando vuelve la conexión, todo se reanuda en orden: primero lo urgente y lo que ya tenía hora. En la demostración hay botones para provocar una caída y verlo entero.' },
    { p: 'Dice «hay que escanear el QR otra vez»', r: 'El teléfono cerró la sesión: la reconexión sola no sirve. Ve a Conexión y vincula de nuevo con el QR.', ir: '/setup', irTexto: 'Ir a Conexión' },
    { p: '¿Qué es la prueba de cada mañana?', r: 'A la hora del ajuste (07:00) manda un mensaje al supervisor y espera que WhatsApp lo dé por entregado, prueba GSG, la IA, las entregas y el espacio en disco. Si algo falla avisa una sola vez. «Probar ahora» la corre en el acto sin avisar.' },
    { p: '¿Nos alcanza el número para todos los pedidos de hoy?', r: 'La caja «Cupo de hoy» cuenta los mensajes que necesitan los pedidos vivos (ubicación, confirmación, motorizado, aviso, gracias) más el envío automático, frente a lo que el número puede mandar hoy; si no alcanza dice qué recortar.' },
    { p: '¿Hay copia de seguridad? ¿Dónde va?', r: 'Cada noche (03:00) la base y los respaldos de conversaciones a la carpeta elegida (por defecto OneDrive o Documentos\\GSGchat-copias); conserva 14. «Hacer copia ahora» y «Comprobar la carpeta» están en la caja; la vinculación del WhatsApp no se copia a propósito.' },
    { p: '¿Cómo restauro una copia?', r: '«Cómo restaurar» en la caja de la copia: los pasos, con el nombre del fichero y dónde ponerlo. Se hace con el servidor parado.' },
  ],
};

const PAGAR: AyudaPantalla = {
  titulo: 'Pagar',
  que: 'Paga por tu cuenta y manda aquí la captura. Cuando la apunten, tu vencimiento corre solo.',
  preguntas: [
    { p: '¿Cómo pago?', r: 'Arriba está tu plan y hasta cuándo está pagado; debajo, cómo paga el dueño del sistema (Yape, Plin, QR e instrucciones). Pagas por tu cuenta y mandas la captura aquí.' },
    { p: 'Ya pagué, ¿y ahora?', r: '«Ya pagué: mandar mi captura»: meses, monto, una nota si quieres y la imagen. Le llega al dueño; cuando la apunte, tu vencimiento corre solo y esta pantalla lo dice.' },
    { p: 'Me rechazaron el pago', r: 'Aquí sale el motivo que escribió el dueño. Corrige (captura equivocada, monto incompleto…) y vuelve a mandarla.' },
    { p: '¿Qué es «Acceso de soporte»?', r: 'Una llave temporal para que quien te vende el sistema pueda entrar a tu panel a ayudarte (como administrador, sin poder tocar tu cuenta de dueño). La concedes tú con un clic, dura las horas que elijas y se apaga sola; puedes quitarla antes en cualquier momento. La caja dice si nadie tiene acceso o hasta qué hora lo hay.' },
    { p: 'Dice que esta instalación no depende de un maestro', r: 'Entonces la membresía la lleva el superadministrador de aquí mismo, en Membresía; no hay a quién mandarle la captura.', ir: '/panel#membresia', irTexto: 'Ir a Membresía' },
  ],
};

const INTEGRACIONES: AyudaPantalla = {
  titulo: 'Conectar mi web y tienda',
  que: 'Conecta otros programas con este WhatsApp. Cada bloque tiene su semáforo: verde funciona, ámbar falta un paso.',
  preguntas: [
    { p: '¿Cómo conecto otro sistema sin pasarle mi clave?', r: 'Códigos de conexión: un código corto con fecha límite que el otro sistema canjea y recibe su propia clave.' },
    { p: '¿Cómo conecto Stoky?', r: 'Son dos direcciones y las dos están en el bloque Stoky de esta pantalla, cada una con su semáforo. Sigue los pasos de arriba abajo.', ir: '/manual#m-stoky', irTexto: 'Los dos sentidos, paso a paso' },
    { p: '¿Cómo pongo el chat en mi web?', r: 'Chat embebido: escribe el dominio de tu web y pega embed.js con un token en tu página.' },
  ],
};

const CONTACTOS: AyudaPantalla = {
  titulo: 'Contactos',
  que: 'Cada número con su consentimiento. Sin opt-in no sale nada iniciado por el negocio, así que aquí se arregla eso.',
  preguntas: [
    { p: '¿Por qué a este contacto no le sale nada?', r: 'Sin consentimiento (opt-in) no sale nada iniciado por el negocio; si escribió BAJA, menos. Responder a quien escribe sí se puede.' },
    { p: '¿Cómo importo muchos?', r: '«Importar»: un Excel o CSV con teléfono y nombre, marcando de dónde viene el consentimiento.' },
  ],
};

/**
 * Las pantallas que no necesitan su propia ficha larga.
 *
 * No lleva "¿dónde está el manual?": el cajon de ayuda ya tiene su boton al
 * manual en el pie, y repetirlo en la primera pregunta de veinte pantallas
 * era lo mas repetido de todo el sistema. Queda la unica pregunta que de
 * verdad se hace en cualquier pantalla, mas las propias que se le pasen.
 */
const GENERICA = (titulo: string, que: string, propias: PreguntaAyuda[] = []): AyudaPantalla => ({
  titulo,
  que,
  preguntas: [
    ...propias,
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
  pedidos: GENERICA('Pedidos del chat', 'Lo que se cerró hablando con el cliente. Repasa los que esperan: confirmar, cancelar o pasarlos a la tienda.'),
  historial: GENERICA('Historial de envíos', 'Cada mensaje que salió (o no salió) con su motivo. Es donde se comprueba lo que alguien dice que no le llegó.'),
  estado: GENERICA('Estado del número', 'Cómo está el número ahora: calidad, cupo de hoy y cola. Aquí se pausan y se reanudan los envíos a mano.'),
  salud: GENERICA('Riesgo y ritmo', 'Por qué el sistema frenó y cuándo vuelve. Lee el motivo antes de forzar nada.', [
    { p: 'Está en rojo y necesito mandar algo hoy', r: 'El rojo no se salta: es lo que evita el baneo. Lo que sí sale son las respuestas a quien escribió, y el reparto en naranja. Arregla la causa que dice la pantalla y el nivel baja solo.', ir: '/manual#m-salud', irTexto: 'Qué significa cada color' },
  ]),
  campanas: GENERICA('Campañas', 'Los envíos por goteo en marcha. Mira el canario antes de soltar el resto.', [
    { p: '¿Cómo paro una campaña que está saliendo mal?', r: '«Pausar» en su fila la detiene al momento; lo ya enviado no vuelve. Con el número en amarillo, el sistema la frena solo sin que hagas nada.' },
  ]),
  grupos: GENERICA('Enviar a un grupo', 'Elige clientes por cómo están y mándales lo mismo a todos. Pulsa «Ver quiénes son» antes de mandar nada.', [
    { p: '¿Puedo ver cómo le queda a cada uno?', r: 'Sí: «Ver cómo les quedaría» enseña el mensaje ya con los datos de cada cliente ({nombre}, {pedido}…) antes de que salga.', ir: '/manual#m-grupos', irTexto: 'Las tres formas de escribir a muchos' },
  ]),
  automatizacion: GENERICA('Respuestas automáticas', 'Lo que se contesta solo sin gastar IA: reglas, secuencias y las respuestas rápidas del chat.'),
  plantillas: GENERICA('Mensajes aprobados', 'Las plantillas que Meta deja mandar fuera de las 24 h. Sin una aprobada no se puede iniciar conversación.'),
  enviar: GENERICA('Enviar mensaje', 'Un texto, un pin o una plantilla a un número suelto, sin abrir su chat.'),
  stickers: GENERICA('Stickers', 'Los que salen solos tras el saludo, el gracias y la despedida. Súbelos y elige cuál va en cada momento.'),
  ubicaciones: GENERICA('Ubicaciones recibidas', 'Todos los pines que mandaron los clientes, con su fecha. Para buscar uno viejo.'),
  vivo: GENERICA('Rastreo en vivo', 'Enlaces para ver una posición en tiempo real. Caducan solos.'),
  extraer: GENERICA('Extraer coordenadas', 'Pega un enlace de mapa o un texto y saca las coordenadas. Útil cuando el cliente manda la dirección escrita.'),
  actividad: GENERICA('Actividad', 'Quién hizo qué y cuándo, la IA operadora incluida. Es la bitácora a la que se acude cuando algo cambió y nadie sabe quién.'),
  'mi-cuenta': GENERICA('Mi cuenta', 'Tu contraseña y tus sesiones. Cambiar la contraseña cierra las sesiones abiertas en otros aparatos.'),
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
