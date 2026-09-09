/**
 * `WhatsAppClient` sobre la sesion local de Baileys.
 *
 * Las degradaciones son las mismas que las de WAHA y por el mismo motivo: no
 * hay Meta detras, asi que no hay plantillas aprobadas, ni boton nativo de
 * ubicacion, ni calidad del numero. Lo que cambia es el transporte: en vez de
 * un contenedor por HTTP, un socket en este mismo proceso.
 */

import { randomUUID } from 'node:crypto';
import { CATALOG } from '../../templates/catalog.js';
import { WhatsAppApiError, type PhoneNumberInfo, type SendResult, type WhatsAppClient } from '../client.js';
import { renderComponentsIntoBody } from '../waha/client.js';
import { getLocalSocket, getLocalState, toJid } from './session.js';

export interface LocalClientOptions {
  /** Cuerpo guardado de una plantilla: aqui se manda como texto sustituido. */
  resolveTemplateBody?: (name: string, language: string) => Promise<string | undefined>;
}

/** El socket, o un error que el sender entiende como transitorio. */
function socketOrThrow() {
  const sock = getLocalSocket();
  if (!sock) {
    // Que el telefono se desconecte un rato es normal: reintentable, para que
    // el mensaje se reprograme en vez de darse por perdido.
    throw new WhatsAppApiError(
      `WhatsApp no esta conectado (${getLocalState().detail}). Escanea el codigo en /setup.`,
      503,
      undefined,
      undefined,
      true,
    );
  }
  return sock;
}

/**
 * El id que devuelve Baileys hace de wamid.
 *
 * Si no viene, se inventa uno unico: `deliveries.wamid` tiene indice unico y
 * una cadena fija reventaria el segundo envio aunque hubiera salido bien.
 */
function resultOf(sent: { key?: { id?: string } } | undefined): SendResult {
  const id = sent?.key?.id;
  return { wamid: id || `local:${randomUUID()}` };
}

export function createLocalClient(opts: LocalClientOptions = {}): WhatsAppClient {
  async function sendText(to: string, body: string): Promise<SendResult> {
    const sock = socketOrThrow();
    const sent = await sock.sendMessage(toJid(to), { text: body });
    return resultOf(sent);
  }

  return {
    sendText,

    async sendLocation(to, location) {
      const sock = socketOrThrow();
      const sent = await sock.sendMessage(toJid(to), {
        location: {
          degreesLatitude: location.latitude,
          degreesLongitude: location.longitude,
          name: location.name,
          address: location.address,
        },
      });
      return resultOf(sent);
    },

    /** El boton nativo de ubicacion es de la Cloud API: se pide por texto. */
    async sendLocationRequest(to, body) {
      return sendText(to, `${body}\n\nMandamela con el clip 📎 → Ubicacion → Enviar tu ubicacion actual.`);
    },

    /** Los botones interactivos no son fiables fuera de la API: lista numerada. */
    async sendButtons(to, body, buttons) {
      const opciones = buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n');
      return sendText(to, opciones ? `${body}\n\n${opciones}\n\nResponde con el numero.` : body);
    },

    /** Sin plantillas: el cuerpo guardado, con las variables ya sustituidas. */
    async sendTemplate(to, name, language, components) {
      const body = await opts.resolveTemplateBody?.(name, language);
      if (!body) {
        throw new WhatsAppApiError(
          `la plantilla "${name}" (${language}) no esta en la base de datos y sin Meta no hay a quien pedirsela`,
          404,
        );
      }
      return sendText(to, renderComponentsIntoBody(body, components));
    },

    async markAsRead(messageId) {
      const sock = getLocalSocket();
      if (!sock) return;
      // Baileys quiere la clave entera; con solo el id no se puede marcar, asi
      // que se ignora en vez de fallar: el doble check azul es cosmetico.
      try {
        await sock.readMessages([{ id: messageId }]);
      } catch {
        // Idem: no vale la pena tumbar un envio por esto.
      }
    },

    /** Aqui no hay calidad ni tier: son conceptos de Meta. El gate se queda ciego. */
    async getPhoneNumber(): Promise<PhoneNumberInfo> {
      const estado = getLocalState();
      return {
        displayPhoneNumber: estado.phone,
        verifiedName: estado.name,
        qualityRating: 'NA',
        messagingLimitTier: '',
      };
    },

    /** No hay webhook que suscribir: los mensajes llegan por el socket. */
    async subscribeApp() {
      return { success: true };
    },

    async listSubscribedApps() {
      return [];
    },

    async registerPhone(): Promise<{ success: boolean }> {
      throw new WhatsAppApiError(
        'aqui el numero se conecta escaneando el codigo QR o con el codigo de vinculacion, no con un PIN',
        400,
      );
    },

    async createTemplate(): Promise<{ id: string; status: string }> {
      throw new WhatsAppApiError(
        'sin Meta no hay revision de plantillas: edita el catalogo local y se mandara como texto',
        400,
      );
    },

    /** El catalogo local hace de catalogo aprobado: no hay a quien pedir permiso. */
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
