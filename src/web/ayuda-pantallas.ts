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

export const AYUDA_PANTALLAS: Record<string, AyudaPantalla> = {
  "inicio": {
    "titulo": "Inicio",
    "que": "Consulta el estado de la API, WhatsApp y los pedidos.",
    "preguntas": []
  },
  "hoy": {
    "titulo": "Pedidos GSG",
    "que": "Revisa los pedidos del día, las ubicaciones pendientes y los errores. Las esperas y los intentos están en Ajustes de chat.",
    "preguntas": [
      {
        "p": "¿Cómo llegan los pedidos?",
        "r": "GSG los manda a Nuestra API (POST /api/v1/entregas). Si no aparece ninguno, mira en Nuestra API las últimas llamadas y su respuesta.",
        "ir": "/api-gsgchat#t-llamadas",
        "irTexto": "Últimas llamadas"
      },
      {
        "p": "¿Qué hago con un pedido marcado en rojo?",
        "r": "Necesita a una persona: abre su detalle, corrige el dato o vuelve a pedir la ubicación desde ahí.",
        "ir": "/manual#m-hoy",
        "irTexto": "Ver instrucciones completas"
      }
    ]
  },
  "chat": {
    "titulo": "Chats",
    "que": "Atiende conversaciones y consulta los mensajes de WhatsApp.",
    "preguntas": []
  },
  "ia": {
    "titulo": "IA",
    "que": "Configura el modelo, sus instrucciones y la ficha de productos.",
    "preguntas": []
  },
  "entrenamiento": {
    "titulo": "Entrenamiento",
    "que": "Ajusta el conocimiento y las respuestas del asistente.",
    "preguntas": []
  },
  "setup": {
    "titulo": "Conexión con WhatsApp",
    "que": "Conecta el número por QR o configura Meta/WAHA.",
    "preguntas": []
  },
  "conexion-gsg": {
    "titulo": "Conexión con GSG",
    "que": "Configura a dónde le mandamos a GSG las ubicaciones y los problemas: URL base, ruta y la API Key que da GSG.",
    "preguntas": [
      {
        "p": "¿Qué va en la URL base y qué en la ruta?",
        "r": "La base es la dirección de la API de GSG (https://…/api/); la ruta, lo que va después (v1/gsgchat/location). La pantalla enseña la URL final antes de guardar.",
        "ir": "/manual#m-conexion-gsg",
        "irTexto": "Ver instrucciones completas"
      },
      {
        "p": "¿Qué API Key va aquí?",
        "r": "La que te da GSG. La que creamos nosotros para que GSG nos mande pedidos está en Nuestra API, Claves.",
        "ir": "/api-gsgchat#t-claves",
        "irTexto": "Nuestra API, Claves"
      }
    ]
  },
  "automatizacion-gsg": {
    "titulo": "Solicitud de ubicación",
    "que": "Sigue a quién se le está pidiendo la ubicación. El horario, las esperas y los textos están en la pestaña Ajustes de chat.",
    "preguntas": [
      {
        "p": "¿Por qué no sale ningún mensaje?",
        "r": "Fuera del horario de Ajustes de chat no se le escribe a nadie; sigue solo a la hora de inicio.",
        "ir": "/automatizacion-gsg#ajustes",
        "irTexto": "Ajustes de chat"
      },
      {
        "p": "¿Cómo cambio lo que se le dice al cliente?",
        "r": "En Ajustes de chat, en los textos. Los datos entre llaves se rellenan con lo que mandó GSG.",
        "ir": "/manual#m-automatizacion-gsg",
        "irTexto": "Ver instrucciones completas"
      }
    ]
  },
  "salud": {
    "titulo": "Salud",
    "que": "Comprueba conexión, riesgo, cupos, pausas y copias de seguridad.",
    "preguntas": []
  },
  "historial": {
    "titulo": "Historial",
    "que": "Revisa las recepciones del API de GSG con sus errores y, si eres administrador, quién cambió qué en el panel.",
    "preguntas": []
  },
  "usuarios": {
    "titulo": "Usuarios",
    "que": "Administra accesos y roles del equipo.",
    "preguntas": []
  },
  "configuracion": {
    "titulo": "Ajustes",
    "que": "Configura el nombre del negocio y a quién se avisa. El horario y los mensajes al cliente están en Pedidos GSG → Ajustes de chat.",
    "preguntas": []
  },
  "actividad": {
    "titulo": "Actividad",
    "que": "Consulta quién cambió la configuración.",
    "preguntas": []
  },
  "mi-cuenta": {
    "titulo": "Mi cuenta",
    "que": "Actualiza tu contraseña.",
    "preguntas": []
  },
  "cuentas": {
    "titulo": "Cuentas",
    "que": "El superadministrador administra cuentas independientes.",
    "preguntas": []
  },
  "api-gsgchat": {
    "titulo": "Nuestra API",
    "que": "Las dos direcciones por las que GSG nos llama (pedidos y cancelar o reintentar) y la clave que usan.",
    "preguntas": [
      {
        "p": "¿Cómo lo pruebo en Postman?",
        "r": "Descarga la colección y el entorno del Manual, pega la clave en apiKey y lanza las llamadas en orden.",
        "ir": "/manual#m-postman",
        "irTexto": "Ver instrucciones completas"
      },
      {
        "p": "¿Por qué responde 400?",
        "r": "Falta un campo obligatorio o no tiene el formato. «detalles» dice qué campo de qué pedido; no se guarda ninguno de esa llamada.",
        "ir": "/manual#m-gsg-courier",
        "irTexto": "Ver los campos"
      }
    ]
  }
};

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
