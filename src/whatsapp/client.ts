/**
 * Cliente de la WhatsApp Cloud API.
 *
 * Solo API oficial. Las librerias no oficiales (Baileys, whatsapp-web.js)
 * violan los terminos y el baneo del numero es cuestion de tiempo, que es
 * justo el problema que este proyecto intenta evitar.
 */

import type { TemplateComponent } from './types.js';

export interface SendResult {
  wamid: string;
  /**
   * El texto que de verdad le llego al cliente.
   *
   * Existe porque cada proveedor arma el mensaje a su manera: la Cloud API
   * manda un boton nativo y el cliente local manda ese mismo texto con las
   * instrucciones del clip pegadas debajo. Sin esto, el chat del operador
   * mostraba una cosa y al cliente le llegaba otra, que es la peor forma de
   * atender: se contesta a un mensaje que nadie mando.
   *
   * Ausente = lo que se mando es lo que se pidio mandar.
   */
  body?: string;
}

export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly code?: number,
    readonly title?: string,
    /** true si reintentar tiene sentido (rate limit o fallo transitorio). */
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'WhatsAppApiError';
  }
}

export interface PhoneNumberInfo {
  displayPhoneNumber: string;
  verifiedName: string;
  /** GREEN | YELLOW | RED | NA (sin datos todavia). */
  qualityRating: string;
  /** TIER_250, TIER_1K, TIER_10K, TIER_100K, TIER_UNLIMITED o vacio. */
  messagingLimitTier: string;
}

export interface WhatsAppClientOptions {
  token: string;
  phoneNumberId: string;
  businessAccountId: string;
  graphVersion?: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

/** Codigos de Meta que merecen reintento en vez de darse por perdidos. */
const RETRYABLE_CODES = new Set([
  4, // demasiadas llamadas
  80007, // rate limit
  130429, // throughput limit
  131048, // spam rate limit
  131056, // pair rate limit
  133016, // servicio temporalmente no disponible
  1, // error desconocido de la API
]);

export interface WhatsAppClient {
  sendText(to: string, body: string, previewUrl?: boolean): Promise<SendResult>;
  sendLocation(
    to: string,
    location: { latitude: number; longitude: number; name?: string; address?: string },
  ): Promise<SendResult>;
  /** Boton nativo que abre el selector de ubicacion del cliente. */
  sendLocationRequest(to: string, body: string): Promise<SendResult>;
  sendButtons(
    to: string,
    body: string,
    buttons: Array<{ id: string; title: string }>,
  ): Promise<SendResult>;
  sendTemplate(
    to: string,
    name: string,
    language: string,
    components?: TemplateComponent[],
  ): Promise<SendResult>;
  markAsRead(messageId: string): Promise<void>;
  /** Estado del numero segun Meta: calidad y tier de envio. */
  getPhoneNumber(): Promise<PhoneNumberInfo>;
  /**
   * Suscribe la app a la cuenta de negocio. Sin este paso Meta no manda
   * ningun webhook aunque la URL este bien configurada: es el olvido mas
   * comun al conectar una cuenta.
   */
  subscribeApp(): Promise<{ success: boolean }>;
  /** Apps ya suscritas a la cuenta de negocio. */
  listSubscribedApps(): Promise<Array<{ id: string; name: string }>>;
  /**
   * Registra el numero en la Cloud API con el PIN de verificacion en dos
   * pasos. Hace falta una vez por numero (o tras migrarlo desde la app).
   */
  registerPhone(pin: string): Promise<{ success: boolean }>;
  /** Da de alta una plantilla para revision de Meta. */
  createTemplate(input: {
    name: string;
    language: string;
    category: string;
    body: string;
    /** Un valor de ejemplo por variable; Meta los exige para revisar. */
    examples: string[];
    footer?: string;
  }): Promise<{ id: string; status: string }>;
  listTemplates(): Promise<
    Array<{
      name: string;
      language: string;
      category: string;
      status: string;
      quality_score?: { score?: string };
      components?: Array<{ type: string; text?: string }>;
    }>
  >;
}

export function createWhatsAppClient(opts: WhatsAppClientOptions): WhatsAppClient {
  const {
    token,
    phoneNumberId,
    businessAccountId,
    graphVersion = 'v21.0',
    fetchImpl = fetch,
    baseUrl = 'https://graph.facebook.com',
  } = opts;

  const messagesUrl = `${baseUrl}/${graphVersion}/${phoneNumberId}/messages`;

  async function call<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetchImpl(url, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    const text = await response.text();
    const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};

    if (!response.ok) {
      const error = (payload.error ?? {}) as { code?: number; message?: string; error_data?: { details?: string } };
      const retryable = response.status >= 500 || RETRYABLE_CODES.has(error.code ?? -1);
      throw new WhatsAppApiError(
        error.message ?? `HTTP ${response.status}`,
        response.status,
        error.code,
        error.error_data?.details,
        retryable,
      );
    }

    return payload as T;
  }

  async function send(body: Record<string, unknown>): Promise<SendResult> {
    const payload = await call<{ messages?: Array<{ id: string }> }>(messagesUrl, {
      method: 'POST',
      body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
    });
    const wamid = payload.messages?.[0]?.id;
    if (!wamid) throw new WhatsAppApiError('la API no devolvio wamid', 200);
    return { wamid };
  }

  return {
    sendText(to, body, previewUrl = true) {
      return send({ to, type: 'text', text: { body, preview_url: previewUrl } });
    },

    sendLocation(to, location) {
      return send({
        to,
        type: 'location',
        location: {
          latitude: String(location.latitude),
          longitude: String(location.longitude),
          name: location.name,
          address: location.address,
        },
      });
    },

    sendLocationRequest(to, body) {
      return send({
        to,
        type: 'interactive',
        interactive: {
          type: 'location_request_message',
          body: { text: body },
          action: { name: 'send_location' },
        },
      });
    },

    sendButtons(to, body, buttons) {
      return send({
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: body },
          action: {
            buttons: buttons.slice(0, 3).map((b) => ({
              type: 'reply',
              reply: { id: b.id, title: b.title.slice(0, 20) },
            })),
          },
        },
      });
    },

    sendTemplate(to, name, language, components) {
      return send({
        to,
        type: 'template',
        template: {
          name,
          language: { code: language },
          ...(components?.length ? { components } : {}),
        },
      });
    },

    async markAsRead(messageId) {
      await call(messagesUrl, {
        method: 'POST',
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        }),
      });
    },

    async getPhoneNumber() {
      const url = `${baseUrl}/${graphVersion}/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier`;
      const payload = await call<{
        display_phone_number?: string;
        verified_name?: string;
        quality_rating?: string;
        messaging_limit_tier?: string;
      }>(url, { method: 'GET' });
      return {
        displayPhoneNumber: payload.display_phone_number ?? '',
        verifiedName: payload.verified_name ?? '',
        qualityRating: (payload.quality_rating ?? 'NA').toUpperCase(),
        messagingLimitTier: payload.messaging_limit_tier ?? '',
      };
    },

    async subscribeApp() {
      const url = `${baseUrl}/${graphVersion}/${businessAccountId}/subscribed_apps`;
      const payload = await call<{ success?: boolean }>(url, { method: 'POST', body: '{}' });
      return { success: Boolean(payload.success) };
    },

    async listSubscribedApps() {
      const url = `${baseUrl}/${graphVersion}/${businessAccountId}/subscribed_apps`;
      const payload = await call<{
        data?: Array<{ whatsapp_business_api_data?: { id?: string; name?: string } }>;
      }>(url, { method: 'GET' });
      return (payload.data ?? []).map((row) => ({
        id: row.whatsapp_business_api_data?.id ?? '',
        name: row.whatsapp_business_api_data?.name ?? '',
      }));
    },

    async registerPhone(pin) {
      const url = `${baseUrl}/${graphVersion}/${phoneNumberId}/register`;
      const payload = await call<{ success?: boolean }>(url, {
        method: 'POST',
        body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
      });
      return { success: Boolean(payload.success) };
    },

    async createTemplate(input) {
      const components: Array<Record<string, unknown>> = [
        {
          type: 'BODY',
          text: input.body,
          // `example` solo va si hay variables; mandarlo vacio da error 100.
          ...(input.examples.length ? { example: { body_text: [input.examples] } } : {}),
        },
      ];
      if (input.footer) components.push({ type: 'FOOTER', text: input.footer });

      const url = `${baseUrl}/${graphVersion}/${businessAccountId}/message_templates`;
      const payload = await call<{ id: string; status: string }>(url, {
        method: 'POST',
        body: JSON.stringify({
          name: input.name,
          language: input.language,
          category: input.category,
          components,
        }),
      });
      return { id: payload.id, status: payload.status };
    },

    async listTemplates() {
      const url = `${baseUrl}/${graphVersion}/${businessAccountId}/message_templates?limit=200`;
      const payload = await call<{ data?: unknown[] }>(url, { method: 'GET' });
      return (payload.data ?? []) as Awaited<ReturnType<WhatsAppClient['listTemplates']>>;
    },
  };
}
