/** Formas del webhook de la Cloud API que este proyecto consume. */

export interface WebhookLocation {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

/**
 * El anuncio desde el que escribio el cliente ("click to WhatsApp" de
 * Facebook o Instagram). Meta lo manda como `referral`; el cliente local lo
 * saca del `externalAdReply` de Baileys. Es lo que permite el kit de
 * bienvenida por anuncio y saber que campana trae clientes.
 */
export interface AnuncioEntrada {
  /** El id del anuncio o del post (source_id). */
  id: string | null;
  titulo: string | null;
  texto: string | null;
  /** La direccion del anuncio. */
  url: string | null;
  imagen: string | null;
  /** El identificador del clic (ctwa_clid), para atribuir la conversion. */
  clid: string | null;
  /** ad | post | otro. */
  origen: string | null;
}

export interface InboundMessage {
  id: string;
  from: string;
  timestamp: string;
  type: 'text' | 'location' | 'interactive' | 'button' | 'image' | 'audio' | string;
  text?: { body: string };
  location?: WebhookLocation;
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
  button?: { text: string; payload: string };
  context?: { id?: string };
  /**
   * Una reaccion (el corazon, el pulgar) a un mensaje. No es texto: no se
   * contesta, se cuelga del mensaje reaccionado.
   *
   * `message_id` es ESE mensaje, con el nombre que le da Meta. Sin el, la
   * reaccion no se puede pintar donde va y acaba como un globo suelto.
   * `emoji` vacio significa que la quito.
   */
  reaction?: { emoji: string; message_id?: string };
  /**
   * "Eliminar para todos": el id del mensaje que el remitente quiso borrar.
   * El sistema lo conserva y lo marca; no lo borra.
   */
  revoca?: string;
  /**
   * Un "ver una vez" que llego SIN el fichero.
   *
   * WhatsApp no le entrega el adjunto a los dispositivos vinculados: manda un
   * sobre vacio (`<unavailable type="view_once">`), igual que a WhatsApp Web,
   * que dice "solo puedes abrirla en tu telefono". Se guarda para que el
   * operador sepa que llego, y aparte se le pide al telefono que la reenvie
   * (ver `reenvio`): si la suelta, el mensaje se completa con la foto.
   */
  viewOnce?: { kind: 'image' | 'video' | 'audio' | 'document' | 'unknown' };
  /**
   * Es la segunda entrega del mismo mensaje, ahora con el fichero: el
   * telefono contesto al reenvio que se le pidio. Reemplaza lo guardado con
   * ese wamid (el sobre vacio) y no se contesta otra vez.
   */
  reenvio?: boolean;
  /**
   * Llego por un grupo de WhatsApp. `jid` es el grupo (`...@g.us`), `autor`
   * el telefono de quien escribio dentro (null si solo se conoce su LID) y
   * `autorNombre` como se presenta. Los grupos se leen y se contestan a
   * mano: ningun automatismo actua en ellos.
   */
  grupo?: { jid: string; nombre?: string | null; autor: string | null; autorNombre?: string };
  /**
   * Llego del historial o de la cola de cuando el sistema estaba apagado, no
   * en vivo. Se guarda en la conversacion y NO se contesta: al reconectar,
   * WhatsApp Web reentrega los ultimos mensajes de cada chat, y contestarlos
   * como si fueran nuevos es escribirle a media libreta de golpe.
   */
  viejo?: boolean;
  /**
   * Vino del volcado de historial del telefono (`messaging-history.set` al
   * vincular), no en vivo ni de la cola de cuando el sistema estaba apagado.
   * Se guarda para ver el chat, pero no se anuncia a nadie.
   */
  historial?: boolean;
  /** Vino desde un anuncio (ver `AnuncioEntrada`): el cliente local lo rellena. */
  anuncio?: AnuncioEntrada;
  /** Lo mismo, tal como lo manda la Cloud API de Meta (`referral`). */
  referral?: { source_url?: string; source_id?: string; source_type?: string; headline?: string; body?: string; image_url?: string; thumbnail_url?: string; video_url?: string; ctwa_clid?: string };
  /**
   * Adjunto ya bajado a disco.
   *
   * La Cloud API no lo trae -ahi el fichero se pide aparte con su id-, pero el
   * proveedor local si puede, porque el socket ya tiene las llaves. Con esto
   * el chat pinta la foto en vez de un "(foto)" que no lleva a ningun sitio.
   */
  media?: {
    id: string;
    mimeType: string;
    filename?: string;
    seconds?: number;
    voice?: boolean;
    caption?: string;
    bytes?: number;
    /** Llego como "ver una vez": en el telefono desaparece al abrirla; aqui queda. */
    verUnaVez?: boolean;
    /** Lo que dijo en el audio, si la voz esta configurada (ver src/voz). */
    transcripcion?: string;
  };
}

export interface StatusUpdate {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  errors?: Array<{ code: number; title: string; message?: string }>;
}

export interface ChangeValue {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: Array<{ wa_id: string; profile?: { name?: string } }>;
  messages?: InboundMessage[];
  statuses?: StatusUpdate[];
  // message_template_status_update
  event?: string;
  message_template_id?: number | string;
  message_template_name?: string;
  message_template_language?: string;
  reason?: string;
  /** Al pausar: title FIRST_PAUSE | SECOND_PAUSE | THIRD_PAUSE, description. */
  other_info?: { title?: string; description?: string };
  disable_info?: { disable_date?: string };
  // message_template_quality_update
  previous_quality_score?: string;
  new_quality_score?: string;
  // template_category_update
  previous_category?: string;
  new_category?: string;
  // phone_number_quality_update
  display_phone_number?: string;
  current_limit?: string;
  // account_update
  phone_number?: string;
  ban_info?: { waba_ban_state?: string; waba_ban_date?: string };
  restriction_info?: Array<{ restriction_type?: string; expiration?: string }>;
  violation_info?: { violation_type?: string };
  // business_capability_update
  /** Hasta Graph v23: por telefono. */
  max_daily_conversation_per_phone?: number;
  /** Desde Graph v24: por portafolio de Meta (compartido por todos sus numeros). */
  max_daily_conversations_per_business?: number;
  max_phone_numbers_per_business?: number;
  // user_preferences
  user_preferences?: Array<{
    wa_id?: string;
    detail?: string;
    category?: string;
    value?: string;
    timestamp?: string;
  }>;
}

export interface WebhookChange {
  field: string;
  value: ChangeValue;
}

export interface WebhookEntry {
  id: string;
  changes: WebhookChange[];
}

export interface WebhookPayload {
  object?: string;
  entry?: WebhookEntry[];
}

/** Componentes de una plantilla al enviarla. */
export interface TemplateComponent {
  type: 'header' | 'body' | 'button';
  sub_type?: string;
  index?: string;
  parameters: Array<
    | { type: 'text'; text: string }
    | { type: 'currency'; currency: { fallback_value: string; code: string; amount_1000: number } }
    | { type: 'location'; location: { latitude: string; longitude: string; name?: string; address?: string } }
  >;
}
