/** Formas del webhook de la Cloud API que este proyecto consume. */

export interface WebhookLocation {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
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
  /** Una reaccion (el corazon, el pulgar) a un mensaje nuestro. No es texto: no se contesta. */
  reaction?: { emoji: string };
  /**
   * Un "ver una vez" que llego SIN el fichero. WhatsApp no manda la llave del
   * adjunto a los dispositivos vinculados: solo se abre en el telefono. Se
   * guarda para que el operador sepa que llego y donde mirarlo.
   */
  viewOnce?: { kind: 'image' | 'video' | 'audio' | 'document' | 'unknown' };
  /**
   * Llego del historial o de la cola de cuando el sistema estaba apagado, no
   * en vivo. Se guarda en la conversacion y NO se contesta: al reconectar,
   * WhatsApp Web reentrega los ultimos mensajes de cada chat, y contestarlos
   * como si fueran nuevos es escribirle a media libreta de golpe.
   */
  viejo?: boolean;
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
  max_daily_conversation_per_phone?: number;
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
