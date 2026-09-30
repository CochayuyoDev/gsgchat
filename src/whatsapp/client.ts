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
  /**
   * TIER_250, TIER_1K, TIER_10K, TIER_100K, TIER_UNLIMITED o vacio.
   *
   * Desde 2026 el limite es del PORTAFOLIO de Meta (compartido por todos sus
   * numeros) y el campo es `whatsapp_business_manager_messaging_limit`; el
   * viejo `messaging_limit_tier` sigue leyendose si la version de Graph no
   * conoce el nuevo.
   */
  messagingLimitTier: string;
  /** El numero sigue en la app de WhatsApp Business del celular (coexistencia). null = no se sabe. */
  enLaApp?: boolean | null;
  /** CLOUD_API, ON_PREMISE, NOT_APPLICABLE... segun Meta. */
  plataforma?: string;
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

/**
 * El mensaje que se esta citando al responder.
 *
 * Los tres proveedores lo piden de forma distinta: Meta con el id a secas
 * (`context.message_id`), WAHA tambien (`reply_to`), y Baileys con la CLAVE
 * entera del mensaje, que necesita saber si era nuestro y de que chat. Por eso
 * aqui va todo lo que hace falta para armar cualquiera de las tres, y cada
 * cliente coge lo suyo.
 */
export interface CitaSaliente {
  /** El wamid del mensaje citado. */
  id: string;
  /** Si el citado lo mandamos nosotros: Baileys lo necesita para la clave. */
  fromMe: boolean;
  /** Un extracto del citado, para que Baileys arme la previa de la cita. */
  texto?: string;
  /** En un grupo, quien lo escribio (jid): sin esto la cita sale sin autor. */
  participant?: string;
}

export interface WhatsAppClient {
  sendText(to: string, body: string, previewUrl?: boolean, cita?: CitaSaliente): Promise<SendResult>;
  sendLocation(
    to: string,
    location: { latitude: number; longitude: number; name?: string; address?: string },
  ): Promise<SendResult>;
  /** Boton nativo que abre el selector de ubicacion del cliente. */
  sendLocationRequest(to: string, body: string): Promise<SendResult>;
  /**
   * Un sticker (WebP 512x512). El cliente local lo manda como sticker de
   * verdad; la Cloud API lo baja de `url`; WAHA lo manda como fichero.
   */
  sendSticker?(to: string, sticker: { datos: Buffer; mimeType: string; url: string }): Promise<SendResult>;
  /**
   * Una foto, un video, un audio o un documento, con el fichero ya leido.
   *
   * El cliente local lo manda tal cual por el socket; la Cloud API lo sube
   * primero a Meta y lo manda por id; WAHA lo manda en base64.
   */
  sendMedia?(to: string, media: MediaSaliente): Promise<SendResult>;
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
  /**
   * Doble check azul en el telefono del cliente.
   *
   * `chat` es opcional porque la Cloud API se apana con el id, pero los
   * clientes con sesion propia necesitan la clave entera del mensaje (de que
   * chat es y si era nuestro): sin ella no marcan nada y callan el fallo.
   */
  markAsRead(messageId: string, chat?: { to: string; fromMe?: boolean; participant?: string }): Promise<void>;
  /**
   * Reacciona a un mensaje con un emoji. Cadena vacia = quitar la reaccion.
   *
   * Opcional porque no todos pueden: con WAHA depende del motor, y por eso la
   * pantalla pregunta antes (ver `capacidadesDelChat` en el chat) en vez de
   * ensenar un boton que falla.
   */
  sendReaction?(to: string, mensaje: CitaSaliente, emoji: string): Promise<SendResult>;
  /**
   * "Eliminar para todos". NO existe en la Cloud API de Meta: un mensaje
   * enviado por ahi no se puede retirar, y fingir que si seria mentirle al
   * operador. Solo lo implementa el cliente local.
   */
  borrarParaTodos?(to: string, mensaje: CitaSaliente): Promise<void>;
  /**
   * Cambiar el texto de un mensaje ya enviado. Tampoco existe en la Cloud
   * API; en el cliente local es el `edit` de Baileys.
   */
  editarMensaje?(to: string, mensaje: CitaSaliente, texto: string): Promise<SendResult>;
  /**
   * Si el otro lado esta en linea o escribiendo, y cuando se le vio por
   * ultima vez. Solo lo saben los clientes con sesion propia; `null` = no se
   * sabe, que no es lo mismo que "esta desconectado".
   */
  presencia?(to: string): Promise<{ estado: 'escribiendo' | 'grabando' | 'en_linea' | 'desconectado'; desde: string } | null>;
  /**
   * Si ese numero tiene una cuenta de WhatsApp.
   *
   * Solo lo saben los clientes no oficiales, que hablan con el mismo servicio
   * que la aplicacion del telefono. La Cloud API de Meta no lo ofrece: ahi se
   * descubre enviando, y el envio vuelve con el error 131026. Por eso es
   * opcional y devuelve `null` cuando no se puede saber, que no es lo mismo
   * que `false`.
   *
   * Importa mas de lo que parece: mandar contra numeros que no existen es una
   * de las cosas que Meta mira para bajarle la calidad al numero.
   */
  tieneWhatsApp?(phone: string): Promise<boolean | null>;
  /**
   * Si ahora mismo se puede enviar (el socket esta abierto).
   *
   * Solo lo saben los clientes con sesion propia (el local). Sin esto, cada
   * intento contra un socket cerrado dejaba una entrega "fallida" que el
   * monitor de salud contaba como rechazo de WhatsApp, y el motor de rutas
   * gastaba un intento del cliente en un mensaje que nunca salio.
   */
  conectado?(): boolean | undefined;
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

/** Lo que hace falta para mandar un fichero por cualquiera de los tres clientes. */
export interface MediaSaliente {
  kind: 'image' | 'video' | 'audio' | 'document';
  datos: Buffer;
  mimeType: string;
  /** Nombre original: se ensena en los documentos. */
  filename?: string;
  caption?: string;
  /** Audio como nota de voz (con la onda y el play), no como fichero. */
  voz?: boolean;
  /** Si va como respuesta a otro mensaje. */
  cita?: CitaSaliente;
}

export function createWhatsAppClient(opts: WhatsAppClientOptions): WhatsAppClient {
  const {
    token,
    phoneNumberId,
    businessAccountId,
    graphVersion = 'v25.0',
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

  /**
   * Sube un fichero a Meta y devuelve su id. La Cloud API no acepta el
   * binario en el mensaje: primero se sube, luego se manda por id.
   */
  async function upload(media: MediaSaliente): Promise<string> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', media.mimeType);
    form.append('file', new Blob([media.datos], { type: media.mimeType }), media.filename ?? `archivo.${media.mimeType.split('/')[1] ?? 'bin'}`);
    const response = await fetchImpl(`${baseUrl}/${graphVersion}/${phoneNumberId}/media`, {
      method: 'POST',
      // Sin content-type a mano: fetch pone el multipart con su frontera.
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as { id?: string; error?: { code?: number; message?: string } }) : {};
    if (!response.ok || !payload.id) {
      throw new WhatsAppApiError(payload.error?.message ?? `no se pudo subir el fichero (HTTP ${response.status})`, response.status, payload.error?.code, undefined, response.status >= 500);
    }
    return payload.id;
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

  /** El bloque de cita de Meta: el id del mensaje al que se responde. */
  const contexto = (cita?: CitaSaliente) => (cita ? { context: { message_id: cita.id } } : {});

  return {
    sendText(to, body, previewUrl = true, cita) {
      return send({ to, type: 'text', text: { body, preview_url: previewUrl }, ...contexto(cita) });
    },

    /**
     * Reaccionar si se puede: es un tipo de mensaje mas de la Cloud API.
     * Un emoji vacio la quita, tal como lo define Meta.
     */
    sendReaction(to, mensaje, emoji) {
      return send({ to, type: 'reaction', reaction: { message_id: mensaje.id, emoji } });
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

    // Meta se lo baja de nuestra URL publica (/stickers/<archivo>); no hace
    // falta subirlo antes como media.
    sendSticker(to, sticker) {
      return send({ to, type: 'sticker', sticker: { link: sticker.url } });
    },

    async sendMedia(to, media) {
      const id = await upload(media);
      const cuerpo: Record<string, unknown> = { id };
      if (media.caption && media.kind !== 'audio') cuerpo.caption = media.caption;
      if (media.kind === 'document' && media.filename) cuerpo.filename = media.filename;
      return send({ to, type: media.kind, [media.kind]: cuerpo, ...contexto(media.cita) });
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
      type Numero = {
        display_phone_number?: string;
        verified_name?: string;
        quality_rating?: string;
        messaging_limit_tier?: string;
        whatsapp_business_manager_messaging_limit?: string;
        is_on_biz_app?: boolean;
        platform_type?: string;
      };
      const pedir = (campos: string) => call<Numero>(`${baseUrl}/${graphVersion}/${phoneNumberId}?fields=${campos}`, { method: 'GET' });
      let payload: Numero;
      try {
        payload = await pedir('display_phone_number,verified_name,quality_rating,whatsapp_business_manager_messaging_limit,is_on_biz_app,platform_type');
      } catch (error) {
        // Una version de Graph anterior a la 24 no conoce el campo nuevo y
        // contesta 400 "nonexisting field": se pide como antes.
        if (!(error instanceof WhatsAppApiError && error.httpStatus === 400 && /field|nonexisting|invalid/i.test(error.message))) throw error;
        payload = await pedir('display_phone_number,verified_name,quality_rating,messaging_limit_tier');
      }
      return {
        displayPhoneNumber: payload.display_phone_number ?? '',
        verifiedName: payload.verified_name ?? '',
        qualityRating: (payload.quality_rating ?? 'NA').toUpperCase(),
        messagingLimitTier: payload.whatsapp_business_manager_messaging_limit ?? payload.messaging_limit_tier ?? '',
        enLaApp: typeof payload.is_on_biz_app === 'boolean' ? payload.is_on_biz_app : null,
        plataforma: payload.platform_type ?? '',
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
