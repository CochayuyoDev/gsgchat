/**
 * `WhatsAppClient` sobre la sesion local de Baileys.
 *
 * Las degradaciones son casi las de WAHA y por el mismo motivo: no hay Meta
 * detras, asi que no hay plantillas aprobadas ni calidad del numero. Lo que
 * cambia es el transporte: en vez de un contenedor por HTTP, un socket en este
 * mismo proceso.
 *
 * La excepcion son los botones. Aqui si se pueden armar a mano (ver
 * `interactive.ts`), incluido el nativo de compartir ubicacion, con el texto
 * de siempre como respaldo para el cliente que no sepa pintarlos.
 */

import { randomUUID } from 'node:crypto';
import { CATALOG } from '../../templates/catalog.js';
import { WhatsAppApiError, type PhoneNumberInfo, type SendResult, type WhatsAppClient } from '../client.js';
import { renderComponentsIntoBody } from '../waha/client.js';
import { botonRespuesta, botonUbicacion, enviarConBotones } from './interactive.js';
import { getLocalSocket, getLocalState, toJid } from './session.js';

export interface LocalClientOptions {
  /** Cuerpo guardado de una plantilla: aqui se manda como texto sustituido. */
  resolveTemplateBody?: (name: string, language: string) => Promise<string | undefined>;
  /**
   * Intentar botones nativos. Ver WHATSAPP_NATIVE_BUTTONS en config: apagado
   * por defecto porque una cuenta personal los entrega rotos.
   */
  nativeButtons?: boolean;
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

    /**
     * Se pide la ubicacion por texto, explicando donde esta el boton.
     *
     * El boton nativo solo se intenta con `nativeButtons` encendido, que viene
     * apagado: ver WHATSAPP_NATIVE_BUTTONS en config.
     */
    async sendLocationRequest(to, body) {
      const texto = `${body}\n\nMándamela con el clip 📎 → Ubicación → Enviar tu ubicación actual.`;

      if (opts.nativeButtons) {
        try {
          const wamid = await enviarConBotones(socketOrThrow(), toJid(to), texto, [botonUbicacion()]);
          return { wamid };
        } catch (error) {
          console.log('[wa] boton de ubicacion no salio, va como texto:', String(error).slice(0, 200));
        }
      }

      const enviado = await sendText(to, texto);
      return { ...enviado, body: texto };
    },

    /**
     * Opciones para el cliente, como lista numerada.
     *
     * Responder con un numero funciona en cualquier version de WhatsApp y no
     * depende de que el cliente sepa pintar nada. Los botones nativos solo se
     * intentan con `nativeButtons`: ver WHATSAPP_NATIVE_BUTTONS.
     */
    async sendButtons(to, body, buttons) {
      if (opts.nativeButtons && buttons.length) {
        try {
          const wamid = await enviarConBotones(
            socketOrThrow(),
            toJid(to),
            body,
            // WhatsApp no pinta mas de tres botones de respuesta rapida.
            buttons.slice(0, 3).map((b) => botonRespuesta(b.id, b.title)),
          );
          return { wamid };
        } catch (error) {
          console.log('[wa] botones no salieron, va como lista:', String(error).slice(0, 200));
        }
      }

      const opciones = buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n');
      const texto = opciones ? `${body}\n\n${opciones}\n\nResponde con el número.` : body;
      const enviado = await sendText(to, texto);
      return { ...enviado, body: texto };
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
