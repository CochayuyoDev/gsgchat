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
    "que": "Revisa pedidos, ubicaciones pendientes y errores. El cliente tiene como máximo tres intentos de ubicación.",
    "preguntas": []
  },
  "chat": {
    "titulo": "Chats",
    "que": "Atiende conversaciones y consulta los mensajes de WhatsApp.",
    "preguntas": []
  },
  "guardados": {
    "titulo": "Chats guardados",
    "que": "Consulta y recupera conversaciones archivadas.",
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
  "plantillas": {
    "titulo": "Plantillas",
    "que": "Administra los mensajes aprobados de WhatsApp.",
    "preguntas": []
  },
  "setup": {
    "titulo": "Conexión con WhatsApp",
    "que": "Conecta el número por QR o configura Meta/WAHA.",
    "preguntas": []
  },
  "conexion-gsg": {
    "titulo": "API y endpoint GSG",
    "que": "Revisa las claves, campos obligatorios y recepciones. La respuesta 400 detalla lo que falta por cliente.",
    "preguntas": []
  },
  "automatizacion-gsg": {
    "titulo": "Automatización GSG",
    "que": "Configura las solicitudes de ubicación y los reintentos.",
    "preguntas": []
  },
  "salud": {
    "titulo": "Salud",
    "que": "Comprueba conexión, riesgo, cupos, pausas y copias de seguridad.",
    "preguntas": []
  },
  "mapa": {
    "titulo": "Ubicaciones",
    "que": "Consulta las coordenadas recibidas de los clientes.",
    "preguntas": []
  },
  "historial": {
    "titulo": "Historial y errores",
    "que": "Revisa mensajes fallidos y corrige pedidos desde Pedidos GSG.",
    "preguntas": []
  },
  "usuarios": {
    "titulo": "Usuarios",
    "que": "Administra accesos y roles del equipo.",
    "preguntas": []
  },
  "configuracion": {
    "titulo": "Ajustes",
    "que": "Configura el negocio, supervisor y horario.",
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
