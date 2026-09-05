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
  // message_template_quality_update
  previous_quality_score?: string;
  new_quality_score?: string;
  // phone_number_quality_update
  display_phone_number?: string;
  current_limit?: string;
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
