/**
 * Cliente de WAHA: la misma interfaz `WhatsAppClient`, pero hablando con un
 * contenedor de WAHA (https://waha.devlike.pro) en vez de con la Cloud API.
 *
 * Por que existe: WAHA se conecta escaneando el codigo QR de WhatsApp Web, y
 * eso funciona tanto con el WhatsApp normal como con WhatsApp Business. La
 * Cloud API no permite eso.
 *
 * A cambio, WAHA emula el cliente de WhatsApp Web. Eso esta fuera de los
 * terminos de Meta y el baneo del numero es un riesgo real y permanente. La
 * decision es del que despliega; el codigo la respeta y no la esconde.
 *
 * Lo que NO tiene WAHA y aqui se degrada a proposito, sin fallar en silencio:
 *
 *  - plantillas: no existen ni hay revision de Meta. Una plantilla se manda
 *    como texto plano ya sustituido (ver `resolveTemplateBody`).
 *  - boton nativo de ubicacion: no existe. Se pide por texto.
 *  - botones interactivos: irregulares segun el motor. Se mandan como
 *    opciones numeradas.
 *  - calidad y tier del numero: no existen. `getPhoneNumber` devuelve NA, con
 *    lo que el gate de calidad se queda ciego. Los demas gates (opt-in,
 *    ventana de 24 h, cupo diario, warm-up) siguen aplicando, y con un cliente
 *    no oficial importan MAS, no menos.
 */

import { randomUUID } from 'node:crypto';
import { WhatsAppApiError, type PhoneNumberInfo, type SendResult, type WhatsAppClient } from '../client.js';
import type { TemplateComponent } from '../types.js';
import { CATALOG } from '../../templates/catalog.js';
import { escribirComoHumano } from '../../salud/humano.js';

export const DEFAULT_SESSION = 'default';

export interface WahaClientOptions {
  /** Raiz del contenedor, p. ej. http://localhost:3000 */
  baseUrl: string;
  /** X-Api-Key, si el contenedor lo exige (WAHA_API_KEY). */
  apiKey?: string;
  /** Nombre de la sesion; una por numero conectado. */
  session?: string;
  fetchImpl?: typeof fetch;
  /**
   * Cuerpo de la plantilla, para poder mandarla como texto.
   *
   * `sendTemplate` solo recibe el nombre y los `components` con los valores de
   * las variables: el texto vive en la base de datos. En vez de cambiar la
   * interfaz (que la Cloud API usa tal cual) se inyecta aqui el que la busca.
   */
  resolveTemplateBody?: (name: string, language: string) => Promise<string | undefined>;
  /**
   * Escribir "como una persona": `startTyping`, esperar lo que tardaria en
   * teclearse, `stopTyping`, y entonces mandar. Ver src/salud/humano.ts.
   */
  humanizar?: boolean | (() => boolean);
  /** Inyectable para que las pruebas no esperen de verdad. */
  dormir?: (ms: number) => Promise<void>;
}

/** `5215512345678` -> `5215512345678@c.us`. Los grupos ya vienen con @g.us. */
export function toChatId(phone: string): string {
  if (phone.includes('@')) return phone;
  return `${phone.replace(/\D/g, '')}@c.us`;
}

/** `5215512345678@c.us` -> `5215512345678`. */
export function fromChatId(chatId: string): string {
  return (chatId.split('@')[0] ?? chatId).replace(/\D/g, '');
}

/**
 * De que chat es un id de mensaje de WAHA.
 *
 * Los ids vienen como `true_5215512345678@c.us_3EB0...`, asi que el chat se
 * saca del propio id. Hace falta porque `markAsRead` solo recibe el id del
 * mensaje pero `POST /api/sendSeen` pide tambien el chat.
 */
export function chatIdFromMessageId(messageId: string): string | undefined {
  const parts = messageId.split('_');
  return parts.find((part) => part.includes('@'));
}

/** Sustituye {{1}}..{{n}} con los valores que traen los `components`. */
export function renderComponentsIntoBody(body: string, components?: TemplateComponent[]): string {
  const parameters = components?.find((c) => c.type === 'body')?.parameters ?? [];
  const values = parameters.map((p) => ('text' in p ? (p.text ?? '') : ''));
  return body.replace(/\{\{(\d+)\}\}/g, (_match, index: string) => {
    return values[Number.parseInt(index, 10) - 1] ?? '';
  });
}

export function createWahaClient(opts: WahaClientOptions): WhatsAppClient {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const session = opts.session || DEFAULT_SESSION;
  const doFetch = opts.fetchImpl ?? fetch;

  async function call<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (opts.apiKey) headers['X-Api-Key'] = opts.apiKey;

    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      // El contenedor caido es transitorio: merece reintento, no descarte.
      throw new WhatsAppApiError(
        `no se pudo contactar con WAHA en ${base}: ${error instanceof Error ? error.message : String(error)}`,
        503,
        undefined,
        undefined,
        true,
      );
    }

    const text = await response.text();
    const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};

    if (!response.ok) {
      const detail =
        (typeof payload.message === 'string' && payload.message) ||
        (typeof payload.error === 'string' && payload.error) ||
        `HTTP ${response.status}`;
      // 429 y 5xx son transitorios; un 4xx de datos, no.
      const retryable = response.status === 429 || response.status >= 500;
      throw new WhatsAppApiError(detail, response.status, undefined, undefined, retryable);
    }

    return payload as T;
  }

  /**
   * WAHA devuelve el mensaje creado; su `id` hace de wamid.
   *
   * Si no viene id (algun motor no lo devuelve en todos los casos) NO se puede
   * devolver una cadena fija: `deliveries.wamid` es unico, asi que el segundo
   * envio sin id reventaria la entrega entera con una violacion de unicidad
   * aunque el mensaje hubiera salido bien. Se inventa un id local y unico, con
   * prefijo para que se vea que no es un id de WhatsApp: la entrega queda
   * registrada, y lo unico que se pierde es poder casarla con su ack.
   */
  function resultOf(payload: { id?: unknown }): SendResult {
    const id = payload.id;
    if (typeof id === 'string' && id) return { wamid: id };
    if (id && typeof id === 'object' && '_serialized' in id) {
      const serialized = String((id as { _serialized: unknown })._serialized);
      if (serialized) return { wamid: serialized };
    }
    return { wamid: `waha:local:${randomUUID()}` };
  }

  /**
   * Funcion suelta, no metodo: las tres degradaciones de abajo mandan texto, y
   * si dependieran de `this` se romperian en cuanto alguien desestructurara el
   * cliente (`const { sendButtons } = wa`), que es exactamente lo que hace el
   * envoltorio dinamico con los metodos.
   */
  const humanizar = () => (typeof opts.humanizar === 'function' ? opts.humanizar() : opts.humanizar === true);

  /** El envio, precedido de la simulacion de escritura si esta encendida. */
  async function conTeclado<T>(to: string, texto: string, enviar: () => Promise<T>): Promise<T> {
    if (!humanizar()) return enviar();
    const chatId = toChatId(to);
    return escribirComoHumano(
      {
        escribiendo: () => call('/api/startTyping', { session, chatId }).then(() => undefined),
        parado: () => call('/api/stopTyping', { session, chatId }).then(() => undefined),
      },
      texto,
      enviar,
      { dormir: opts.dormir },
    );
  }

  async function sendText(to: string, body: string, previewUrl?: boolean): Promise<SendResult> {
    const payload = await conTeclado(to, body, () =>
      call<{ id?: unknown }>('/api/sendText', {
        session,
        chatId: toChatId(to),
        text: body,
        linkPreview: previewUrl ?? false,
      }),
    );
    return resultOf(payload);
  }

  return {
    sendText,

    /** WAHA no tiene envio de sticker en todos los motores: va como imagen WebP. */
    async sendSticker(to, sticker) {
      const payload = await call<{ id?: unknown }>('/api/sendImage', {
        session,
        chatId: toChatId(to),
        file: { mimetype: sticker.mimeType, filename: 'sticker.webp', data: sticker.datos.toString('base64') },
      });
      return resultOf(payload);
    },

    async sendLocation(to, location) {
      const payload = await call<{ id?: unknown }>('/api/sendLocation', {
        session,
        chatId: toChatId(to),
        latitude: location.latitude,
        longitude: location.longitude,
        title: location.name || location.address || '',
      });
      return resultOf(payload);
    },

    /**
     * WAHA no tiene el boton nativo que abre el selector de ubicacion: es una
     * funcion de la Cloud API. Se pide por texto explicando donde esta.
     */
    async sendLocationRequest(to, body) {
      const texto = `${body}\n\nMándamela con el clip 📎 → Ubicación → Enviar tu ubicación actual.`;
      const enviado = await sendText(to, texto);
      return { ...enviado, body: texto };
    },

    /** Los botones interactivos no son fiables en todos los motores: lista numerada. */
    async sendButtons(to, body, buttons) {
      const opciones = buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n');
      const texto = opciones ? `${body}\n\n${opciones}\n\nResponde con el número.` : body;
      const enviado = await sendText(to, texto);
      return { ...enviado, body: texto };
    },

    /**
     * No hay plantillas ni revision: se manda el cuerpo ya sustituido. Los
     * gates de arriba siguen tratandolo como envio iniciado por la empresa,
     * que es lo que decide si se puede mandar o no.
     */
    async sendTemplate(to, name, language, components) {
      const body = await opts.resolveTemplateBody?.(name, language);
      if (!body) {
        throw new WhatsAppApiError(
          `la plantilla "${name}" (${language}) no esta en la base de datos y WAHA no puede pedirsela a Meta`,
          404,
        );
      }
      return sendText(to, renderComponentsIntoBody(body, components));
    },

    /**
     * WAHA si sabe decir si un numero tiene WhatsApp: es la misma consulta
     * que hace el telefono al agregar un contacto. Si el endpoint no esta en
     * esa version del contenedor, se devuelve null (no se sabe) en vez de
     * fallar: la respuesta es una ayuda, no un requisito.
     */
    async tieneWhatsApp(phone: string): Promise<boolean | null> {
      const numero = phone.replace(/\D+/g, '');
      try {
        const respuesta = await call<{ numberExists?: boolean; exists?: boolean }>(
          `/api/contacts/check-exists?phone=${encodeURIComponent(numero)}&session=${encodeURIComponent(session)}`,
          undefined,
          'GET',
        );
        const existe = respuesta?.numberExists ?? respuesta?.exists;
        return typeof existe === 'boolean' ? existe : null;
      } catch {
        return null;
      }
    },

    async markAsRead(messageId) {
      const chatId = chatIdFromMessageId(messageId);
      if (!chatId) return;
      await call('/api/sendSeen', { session, chatId, messageId });
    },

    /**
     * WAHA no expone calidad ni tier: son conceptos de Meta. Se devuelve NA,
     * con lo que el gate de calidad no bloquea nada. El cupo diario y el
     * warm-up siguen siendo la unica proteccion, por eso conviene no tocarlos.
     */
    async getPhoneNumber(): Promise<PhoneNumberInfo> {
      const me = await call<{ id?: string; pushName?: string }>(
        `/api/sessions/${encodeURIComponent(session)}/me`,
        undefined,
        'GET',
      );
      return {
        displayPhoneNumber: me.id ? fromChatId(me.id) : '',
        verifiedName: me.pushName ?? '',
        qualityRating: 'NA',
        messagingLimitTier: '',
      };
    },

    /** En WAHA el webhook se configura en la sesion, no suscribiendo una app. */
    async subscribeApp() {
      return { success: true };
    },

    async listSubscribedApps() {
      return [];
    },

    async registerPhone(): Promise<{ success: boolean }> {
      throw new WhatsAppApiError(
        'con WAHA el numero se conecta escaneando el codigo QR, no con un PIN de seis digitos',
        400,
      );
    },

    async createTemplate(): Promise<{ id: string; status: string }> {
      throw new WhatsAppApiError(
        'WAHA no tiene plantillas ni revision de Meta: edita el catalogo local y se mandara como texto',
        400,
      );
    },

    /**
     * Sin Meta no hay nada que sincronizar, pero el sistema necesita que las
     * plantillas existan y esten aprobadas para dejarlas salir. El catalogo
     * local pasa a ser la verdad: aqui no hay a quien pedirle permiso.
     */
    async listTemplates() {
      return CATALOG.map((t) => ({
        name: t.name,
        language: t.language,
        category: t.category,
        status: 'APPROVED',
        components: [{ type: 'BODY', text: t.body }],
      }));
    },
  };
}
