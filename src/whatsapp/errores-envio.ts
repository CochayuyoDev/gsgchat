/**
 * Por que no salio un mensaje, en un formato que otro sistema (GSG) pueda
 * usar: codigo, motivo en palabras, que hacer y si tiene sentido reintentar.
 *
 * Dos familias:
 *  - `meta`: WhatsApp acepto el envio y despues lo rechazo (llega por el
 *    webhook con `failed` + codigo numerico de la tabla de errores de Meta), o
 *    lo rechazo al momento de mandarlo.
 *  - `interno`: GSGchat no lo dejo salir antes de mandarlo (modo prueba, sin
 *    conexion, ventana de 24 h cerrada, cupos...). Son los codigos del
 *    sender (`blocked_by_gate`) y sus textos los mismos de la traza del panel.
 *
 * Este catalogo es la fuente de la API (`error` en cada mensaje), del evento
 * `mensaje.estado` y de la documentacion para los sistemas que nos usan.
 */


/** Los bloqueos internos del sender (`blocked_by_gate`) en palabras: los mismos de la traza del panel. */
export const MOTIVOS_EN_PALABRAS: Record<string, string> = {
  allowlist: 'El sistema está en modo prueba y este número no está en la lista de permitidos.',
  sin_conexion: 'WhatsApp no estaba conectado en ese momento.',
  sin_lineas_disponibles: 'No había números vinculados habilitados con cupo disponible.',
  limite_diario: 'La línea elegida había llegado a su máximo de mensajes por día.',
  linea_fuera_de_modo: 'La línea elegida estaba en pausa por el modo de Conexión (solo WhatsApp normal o solo API) y el chat ya estaba cerrado.',
  opt_out: 'El equipo lo dio de baja: no recibe más mensajes.',
  no_opt_in: 'El cliente no dio su consentimiento para recibir mensajes iniciados por el negocio.',
  number_paused: 'Los envíos del número estaban pausados.',
  number_quality: 'La calidad del número estaba baja y Meta no deja mandar más.',
  window_closed: 'Habían pasado más de 24 h desde el último mensaje del cliente: con la API de Meta solo puede salir una plantilla aprobada.',
  template_missing: 'La plantilla que hacía falta no existe.',
  template_not_approved: 'La plantilla todavía no está aprobada por Meta.',
  template_quality: 'Meta marcó esa plantilla con calidad baja.',
  template_paused: 'Meta tiene esa plantilla en pausa.',
  frequency_cap: 'Ese cliente ya recibió el máximo de mensajes de marketing de la semana.',
  daily_cap: 'Se llegó al cupo de mensajes del día del número.',
  contact_suppressed: 'El monitor apartó a ese contacto (rebotes, quejas o silencio).',
  risk_marketing_paused: 'El número estaba en riesgo y el marketing estaba frenado.',
  fatigue: 'Ese cliente ya había recibido demasiados mensajes seguidos.',
  contact_daily_cap: 'Ese cliente ya recibió el máximo de mensajes del día.',
  contact_spacing: 'Hacía muy poco que se le había escrito a ese cliente.',
  rhythm: 'El marcapasos del número lo dejó para más tarde (ritmo, horario o pausa).',
  ruta_inactiva: 'El chat está cerrado porque GSG avisó que la ruta del cliente está inactiva o finalizada.',
};

/** Si conviene volver a mandar: nunca, despues de esperar, o ya (fallo pasajero). */
export type Reintento = 'no' | 'esperar' | 'si';

export interface ErrorDeEnvio {
  codigo: string;
  tipo: 'meta' | 'interno';
  /** El texto original (de Meta, en ingles) cuando lo hay. */
  titulo: string | null;
  /** Que paso, para leerlo una persona. */
  motivo: string;
  /** Que hacer para que el siguiente si llegue. */
  queHacer: string;
  reintentar: Reintento;
}

interface Entrada { motivo: string; queHacer: string; reintentar: Reintento }

/** Errores de Meta (Cloud API). Fuente: tabla de codigos de error de WhatsApp Business Platform. */
export const ERRORES_META: Record<string, Entrada> = {
  '131047': {
    motivo: 'Pasaron más de 24 horas desde el último mensaje del cliente (o nunca escribió): fuera de esa ventana WhatsApp solo deja mandar plantillas aprobadas, no texto libre.',
    queHacer: 'Mandar una plantilla aprobada. Cuando el cliente conteste, se abre la ventana de 24 h y ya se le puede escribir libre.',
    reintentar: 'no',
  },
  '131049': {
    motivo: 'Meta no lo entregó para cuidar la experiencia del cliente: ya recibió demasiados mensajes de marketing (de todas las empresas) o no suele interactuar con ellos.',
    queHacer: 'No reintentar antes de 24 horas. Si es un aviso del pedido, usar una plantilla de categoría Utilidad, no Marketing.',
    reintentar: 'esperar',
  },
  '131026': {
    motivo: 'El número no tiene WhatsApp, no aceptó los términos nuevos o usa una versión muy antigua.',
    queHacer: 'Confirmar el número con el cliente por otro medio (llamada o SMS).',
    reintentar: 'no',
  },
  '131050': {
    motivo: 'El cliente pidió no recibir mensajes de marketing de este negocio.',
    queHacer: 'No mandarle marketing. Los avisos del pedido (plantillas de Utilidad) sí pueden salir.',
    reintentar: 'no',
  },
  '131056': {
    motivo: 'Se le mandaron demasiados mensajes a este cliente en muy poco tiempo.',
    queHacer: 'Esperar unos minutos antes de volver a escribirle.',
    reintentar: 'esperar',
  },
  '131048': {
    motivo: 'Meta limitó los envíos del número por calidad (muchos bloqueos o reportes).',
    queHacer: 'Bajar el ritmo y revisar el contenido de los mensajes. Ver la calidad del número en el administrador de Meta.',
    reintentar: 'esperar',
  },
  '131031': {
    motivo: 'La cuenta de WhatsApp Business está restringida o bloqueada.',
    queHacer: 'Revisar el estado de la cuenta en el administrador de Meta (Business Support).',
    reintentar: 'no',
  },
  '368': {
    motivo: 'La cuenta está bloqueada temporalmente por incumplir las políticas de WhatsApp.',
    queHacer: 'Revisar el aviso de Meta en el administrador de la cuenta. No enviar hasta que se levante.',
    reintentar: 'no',
  },
  '130403': {
    motivo: 'Este cliente está bloqueado desde la cuenta del negocio.',
    queHacer: 'Desbloquearlo en el administrador de Meta si se le quiere escribir.',
    reintentar: 'no',
  },
  '130429': {
    motivo: 'Se superó el límite de velocidad de envío de la API.',
    queHacer: 'GSGchat baja el ritmo solo; el mensaje puede volver a salir en unos minutos.',
    reintentar: 'si',
  },
  '131021': {
    motivo: 'El remitente y el destinatario son el mismo número.',
    queHacer: 'Corregir el teléfono del cliente.',
    reintentar: 'no',
  },
  '131009': {
    motivo: 'Meta rechazó un dato del mensaje como no válido (a menudo, el número).',
    queHacer: 'Revisar el teléfono del cliente y el contenido del mensaje.',
    reintentar: 'no',
  },
  '131051': {
    motivo: 'Ese tipo de mensaje no está admitido.',
    queHacer: 'Mandarlo como texto o como otro tipo de archivo.',
    reintentar: 'no',
  },
  '131052': {
    motivo: 'No se pudo descargar el archivo que mandó el cliente.',
    queHacer: 'Pedirle que lo vuelva a mandar.',
    reintentar: 'no',
  },
  '131053': {
    motivo: 'No se pudo subir el archivo (formato o tamaño no admitido).',
    queHacer: 'Mandarlo en otro formato o más liviano (fotos JPG/PNG, video MP4, máximo 16 MB).',
    reintentar: 'no',
  },
  '131000': {
    motivo: 'Error interno de WhatsApp, sin más detalle.',
    queHacer: 'Volver a intentarlo en unos minutos.',
    reintentar: 'si',
  },
  '131016': {
    motivo: 'El servicio de WhatsApp no está disponible en este momento.',
    queHacer: 'Volver a intentarlo en unos minutos.',
    reintentar: 'si',
  },
  '132000': {
    motivo: 'La plantilla no recibió la cantidad de datos que espera (variables).',
    queHacer: 'Revisar las variables de la plantilla en GSGchat.',
    reintentar: 'no',
  },
  '132001': {
    motivo: 'La plantilla no existe, o no existe en ese idioma.',
    queHacer: 'Revisar el nombre y el idioma de la plantilla en el administrador de Meta.',
    reintentar: 'no',
  },
  '132005': {
    motivo: 'El texto de la plantilla con sus datos es demasiado largo.',
    queHacer: 'Acortar los datos que se ponen en las variables.',
    reintentar: 'no',
  },
  '132007': {
    motivo: 'La plantilla incumple las políticas de contenido de WhatsApp.',
    queHacer: 'Cambiar el texto de la plantilla y volver a aprobarla.',
    reintentar: 'no',
  },
  '132012': {
    motivo: 'Algún dato de la plantilla tiene un formato que no corresponde.',
    queHacer: 'Revisar las variables de la plantilla.',
    reintentar: 'no',
  },
  '132015': {
    motivo: 'Meta pausó la plantilla por baja calidad.',
    queHacer: 'Usar otra plantilla o esperar a que Meta la reactive.',
    reintentar: 'esperar',
  },
  '132016': {
    motivo: 'Meta desactivó la plantilla definitivamente por baja calidad.',
    queHacer: 'Crear una plantilla nueva.',
    reintentar: 'no',
  },
  '133010': {
    motivo: 'El número del negocio no está registrado en la plataforma de WhatsApp.',
    queHacer: 'Completar el registro del número en Conexión WhatsApp.',
    reintentar: 'no',
  },
  '190': {
    motivo: 'El token de acceso de Meta caducó o no es válido.',
    queHacer: 'Volver a conectar la API de WhatsApp en Conexión WhatsApp.',
    reintentar: 'no',
  },
  '100': {
    motivo: 'Meta rechazó un parámetro de la petición.',
    queHacer: 'Revisar el teléfono y el contenido del mensaje.',
    reintentar: 'no',
  },
};

/** Que hacer con cada bloqueo interno (el motivo sale de MOTIVOS_EN_PALABRAS, el mismo del panel). */
const QUE_HACER_INTERNO: Record<string, { queHacer: string; reintentar: Reintento }> = {
  allowlist: { queHacer: 'Agregar el número a la lista de prueba o sacar el sistema del modo prueba (Ajustes).', reintentar: 'no' },
  sin_conexion: { queHacer: 'Conectar WhatsApp en Conexión WhatsApp y volver a mandarlo.', reintentar: 'si' },
  sin_lineas_disponibles: { queHacer: 'Conectar otra línea o subir el máximo diario de una en Estado del sistema.', reintentar: 'esperar' },
  limite_diario: { queHacer: 'Esperar al día siguiente o subir el máximo diario de la línea.', reintentar: 'esperar' },
  linea_fuera_de_modo: { queHacer: 'Cambiar el modo en Conexión WhatsApp o escribir por una línea en uso.', reintentar: 'no' },
  opt_out: { queHacer: 'No escribirle: el cliente fue dado de baja.', reintentar: 'no' },
  no_opt_in: { queHacer: 'Esperar a que el cliente escriba primero o dé su consentimiento.', reintentar: 'no' },
  number_paused: { queHacer: 'Reanudar los envíos en Estado del sistema.', reintentar: 'esperar' },
  number_quality: { queHacer: 'Bajar el ritmo y revisar la calidad del número en Meta.', reintentar: 'esperar' },
  window_closed: { queHacer: 'Mandar una plantilla aprobada; cuando el cliente conteste ya se le puede escribir libre.', reintentar: 'no' },
  template_missing: { queHacer: 'Crear la plantilla y ponerla en Pedidos GSG → Ajustes de chat.', reintentar: 'no' },
  template_not_approved: { queHacer: 'Esperar a que Meta apruebe la plantilla.', reintentar: 'esperar' },
  template_quality: { queHacer: 'Cambiar el texto de la plantilla o usar otra.', reintentar: 'no' },
  template_paused: { queHacer: 'Usar otra plantilla o esperar a que Meta la reactive.', reintentar: 'esperar' },
  frequency_cap: { queHacer: 'Esperar a la semana siguiente o usar una plantilla de Utilidad.', reintentar: 'esperar' },
  daily_cap: { queHacer: 'Esperar al día siguiente o subir el cupo del número.', reintentar: 'esperar' },
  contact_suppressed: { queHacer: 'El contacto está apartado un tiempo; ver su ficha en Chats.', reintentar: 'esperar' },
  risk_marketing_paused: { queHacer: 'Esperar a que el número salga de riesgo (Estado del sistema).', reintentar: 'esperar' },
  fatigue: { queHacer: 'Esperar antes de volver a escribirle.', reintentar: 'esperar' },
  contact_daily_cap: { queHacer: 'Esperar al día siguiente.', reintentar: 'esperar' },
  contact_spacing: { queHacer: 'Esperar unos minutos antes de volver a escribirle.', reintentar: 'esperar' },
  rhythm: { queHacer: 'Nada: sale solo más tarde, con el ritmo del número.', reintentar: 'si' },
  ruta_inactiva: { queHacer: 'Nada: el chat se abre solo cuando GSG avise que la ruta vuelve a estar activa (o reactívala a mano en Nuestra API → Webhook de rutas).', reintentar: 'esperar' },
};

/**
 * El error explicado a partir de lo que quedo apuntado en el envio: el codigo
 * de Meta (numerico) o el bloqueo interno (texto que empieza por su codigo).
 */
export function errorDeEnvio(codigo: string | null | undefined, titulo: string | null | undefined): ErrorDeEnvio | null {
  const c = (codigo ?? '').trim();
  const t = (titulo ?? '').trim() || null;
  if (c && ERRORES_META[c]) return { codigo: c, tipo: 'meta', titulo: t, ...ERRORES_META[c]! };
  // Bloqueo interno: el sender lo guarda como "codigo: detalle".
  const interno = (t ?? c).split(':')[0]!.trim();
  if (interno && MOTIVOS_EN_PALABRAS[interno]) {
    const extra = QUE_HACER_INTERNO[interno] ?? { queHacer: 'Ver el motivo en GSGchat (Chats → Qué pasó con este mensaje).', reintentar: 'no' as Reintento };
    return { codigo: interno, tipo: 'interno', titulo: t, motivo: MOTIVOS_EN_PALABRAS[interno]!, ...extra };
  }
  if (!c && !t) return null;
  // Un codigo que el catalogo no conoce: se entrega tal cual, con el texto de Meta.
  return {
    codigo: c || 'desconocido',
    tipo: /^\d+$/.test(c) ? 'meta' : 'interno',
    titulo: t,
    motivo: t ?? 'No salió y no quedó apuntado el motivo.',
    queHacer: 'Ver el detalle en GSGchat (Chats → Qué pasó con este mensaje).',
    reintentar: 'no',
  };
}

/** Todo el catalogo, para la documentacion y el endpoint que la publica. */
export function catalogoDeErrores(): Array<ErrorDeEnvio> {
  const meta = Object.entries(ERRORES_META).map(([codigo, e]) => ({ codigo, tipo: 'meta' as const, titulo: null, ...e }));
  const internos = Object.keys(MOTIVOS_EN_PALABRAS).map((codigo) => errorDeEnvio(null, codigo)!);
  return [...meta, ...internos];
}
