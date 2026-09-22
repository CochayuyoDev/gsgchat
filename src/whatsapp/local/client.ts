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
import { escribirComoHumano } from '../../salud/humano.js';
import { WhatsAppApiError, type CitaSaliente, type PhoneNumberInfo, type SendResult, type WhatsAppClient } from '../client.js';
import { renderComponentsIntoBody } from '../waha/client.js';
import { botonRespuesta, botonUbicacion, enviarConBotones } from './interactive.js';
import { getLocalSocket, getLocalState, presenciaDe, suscribirPresencia, toJid } from './session.js';

export interface LocalClientOptions {
  /** Cuerpo guardado de una plantilla: aqui se manda como texto sustituido. */
  resolveTemplateBody?: (name: string, language: string) => Promise<string | undefined>;
  /**
   * Intentar botones nativos. Ver WHATSAPP_NATIVE_BUTTONS en config: apagado
   * por defecto porque una cuenta personal los entrega rotos.
   */
  nativeButtons?: boolean;
  /**
   * Escribir "como una persona": avisar de que se escribe, esperar lo que
   * tardaria en teclearse y entonces mandar. Ver src/salud/humano.ts.
   */
  humanizar?: boolean | (() => boolean);
  /** Inyectable para que las pruebas no esperen de verdad. */
  dormir?: (ms: number) => Promise<void>;
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

/**
 * La clave de un mensaje, que es lo que Baileys pide para todo lo que actua
 * SOBRE un mensaje: citarlo, reaccionar, borrarlo o editarlo.
 *
 * `participant` solo hace falta en un grupo (quien lo escribio); fuera de un
 * grupo estorba, asi que solo se pone cuando viene.
 */
function claveDe(jid: string, mensaje: CitaSaliente) {
  return {
    remoteJid: jid,
    id: mensaje.id,
    fromMe: mensaje.fromMe,
    ...(mensaje.participant ? { participant: mensaje.participant } : {}),
  };
}

/**
 * El mensaje citado tal como lo espera Baileys: su clave y algo de contenido.
 *
 * Aqui no se guarda el mensaje original entero, solo su id y un extracto, asi
 * que se arma un mensaje minimo con el texto. Es lo que WhatsApp pinta dentro
 * del bloque de la cita, y con eso basta.
 */
function citadoDe(jid: string, cita: CitaSaliente) {
  return { key: claveDe(jid, cita), message: { conversation: cita.texto || '' } };
}

export function createLocalClient(opts: LocalClientOptions = {}): WhatsAppClient {
  /**
   * Si el numero tiene WhatsApp, preguntandoselo al servidor.
   *
   * Baileys lo resuelve con la misma consulta que hace el telefono cuando
   * agregas un contacto. Un fallo aqui no puede parar un envio: se devuelve
   * `null` -no se sabe- y el sistema sigue como si no existiera la
   * comprobacion.
   */
  async function tieneWhatsApp(phone: string): Promise<boolean | null> {
    const sock = getLocalSocket();
    if (!sock?.onWhatsApp) return null;
    try {
      const respuesta = await sock.onWhatsApp(toJid(phone));
      const encontrado = respuesta?.[0];
      return encontrado ? Boolean(encontrado.exists) : false;
    } catch {
      return null;
    }
  }

  const humanizar = () => (typeof opts.humanizar === 'function' ? opts.humanizar() : opts.humanizar === true);

  /** El envio, precedido de la simulacion de escritura si esta encendida. */
  async function conTeclado<T>(to: string, texto: string, enviar: () => Promise<T>): Promise<T> {
    if (!humanizar()) return enviar();
    const sock = getLocalSocket();
    const jid = toJid(to);
    return escribirComoHumano(
      {
        escribiendo: async () => {
          await sock?.presenceSubscribe?.(jid).catch(() => undefined);
          await sock?.sendPresenceUpdate?.('composing', jid);
        },
        parado: async () => {
          await sock?.sendPresenceUpdate?.('paused', jid);
        },
      },
      texto,
      enviar,
      { dormir: opts.dormir },
    );
  }

  async function sendText(to: string, body: string, _previewUrl?: boolean, cita?: CitaSaliente): Promise<SendResult> {
    const sock = socketOrThrow();
    const jid = toJid(to);
    const opciones = cita ? { quoted: citadoDe(jid, cita) } : undefined;
    const sent = await conTeclado(to, body, () => sock.sendMessage(jid, { text: body }, opciones));
    return resultOf(sent);
  }

  return {
    sendText,

    /**
     * Una foto, un video, un audio o un documento, como lo manda el telefono.
     * El pie va en `caption`; un documento lleva su nombre para que el
     * cliente lo vea como el fichero que es.
     */
    async sendMedia(to, media) {
      const sock = socketOrThrow();
      const contenido: Record<string, unknown> =
        media.kind === 'image'
          ? { image: media.datos, mimetype: media.mimeType, caption: media.caption }
          : media.kind === 'video'
            ? { video: media.datos, mimetype: media.mimeType, caption: media.caption }
            : media.kind === 'audio'
              ? { audio: media.datos, mimetype: media.mimeType, ptt: Boolean(media.voz) }
              : { document: media.datos, mimetype: media.mimeType, fileName: media.filename ?? 'documento', caption: media.caption };
      // Una nota de voz no lleva pie: el `caption` de un audio es lo que se
      // dijo (para el hilo) y no se manda aparte; el "escribiendo..." de
      // antes se simula sobre ese texto, como si se estuviera grabando.
      const jid = toJid(to);
      const opciones = media.cita ? { quoted: citadoDe(jid, media.cita) } : undefined;
      const sent = await conTeclado(to, media.caption ?? '', () => sock.sendMessage(jid, contenido, opciones));
      return resultOf(sent);
    },

    /**
     * Reaccionar: para WhatsApp es un mensaje mas, con la clave del
     * reaccionado dentro. Un texto vacio la quita, igual que en el telefono.
     */
    async sendReaction(to, mensaje, emoji) {
      const sock = socketOrThrow();
      const jid = toJid(to);
      const sent = await sock.sendMessage(jid, { react: { text: emoji, key: claveDe(jid, mensaje) } });
      return resultOf(sent);
    },

    /** "Eliminar para todos": aqui si existe, porque no hay Meta de por medio. */
    async borrarParaTodos(to, mensaje) {
      const sock = socketOrThrow();
      const jid = toJid(to);
      await sock.sendMessage(jid, { delete: claveDe(jid, mensaje) });
    },

    /** Editar un mensaje ya enviado. El cliente lo ensena con su "editado". */
    async editarMensaje(to, mensaje, texto) {
      const sock = socketOrThrow();
      const jid = toJid(to);
      const sent = await sock.sendMessage(jid, { text: texto, edit: claveDe(jid, mensaje) });
      return resultOf(sent);
    },

    /**
     * Si esta escribiendo, en linea, o cuando se le vio.
     *
     * Hay que suscribirse una vez por chat para que WhatsApp lo mande: se hace
     * aqui mismo, y la primera consulta suele volver sin dato. No se inventa
     * nada: sin dato, null.
     */
    async presencia(to) {
      const jid = toJid(to);
      await suscribirPresencia(jid);
      const p = presenciaDe(jid);
      if (!p) return null;
      return { estado: p.estado, desde: new Date(p.ultimaVez ?? p.desde).toISOString() };
    },

    /** Un sticker de verdad: Baileys lo empaqueta como stickerMessage. */
    async sendSticker(to, sticker) {
      const sock = socketOrThrow();
      const sent = await conTeclado(to, '', () => sock.sendMessage(toJid(to), { sticker: sticker.datos, mimetype: sticker.mimeType }));
      return resultOf(sent);
      
    },

    async sendLocation(to, location) {
      const sock = socketOrThrow();
      const sent = await conTeclado(to, 'ubicacion', () =>
        sock.sendMessage(toJid(to), {
          location: {
            degreesLatitude: location.latitude,
            degreesLongitude: location.longitude,
            name: location.name,
            address: location.address,
          },
        }),
      );
      return resultOf(sent);
    },

    /**
     * Se pide la ubicacion por texto, explicando donde esta el boton.
     *
     * El boton nativo solo se intenta con `nativeButtons` encendido, que viene
     * apagado: ver WHATSAPP_NATIVE_BUTTONS en config.
     */
    async sendLocationRequest(to, body) {
      // Si el texto ya explica el clip (los de rutas lo hacen cuando no hay
      // boton), no se repite la instruccion debajo.
      const texto = /\bclip\b/i.test(body)
        ? body
        : `${body}\n\nMándamela con el clip 📎 → Ubicación → Enviar tu ubicación actual.`;

      if (opts.nativeButtons) {
        try {
          const wamid = await conTeclado(to, texto, () =>
            enviarConBotones(socketOrThrow(), toJid(to), texto, [botonUbicacion()]),
          );
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
          const wamid = await conTeclado(to, body, () =>
            enviarConBotones(
              socketOrThrow(),
              toJid(to),
              body,
              // WhatsApp no pinta mas de tres botones de respuesta rapida.
              buttons.slice(0, 3).map((b) => botonRespuesta(b.id, b.title)),
            ),
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

    tieneWhatsApp,

    conectado: () => getLocalSocket() !== null,

    /**
     * Doble check azul de verdad.
     *
     * Antes se mandaba `[{ id }]` a secas y Baileys no marcaba NADA: necesita
     * la clave entera (de que chat es, si era nuestro y, en un grupo, de
     * quien). Sin `chat` no se puede armar, y entonces se dice en el log en
     * vez de callarse: un acuse que no llega es una queja del cliente.
     */
    async markAsRead(messageId, chat) {
      const sock = getLocalSocket();
      if (!sock) return;
      if (!chat?.to) {
        console.log('[wa] no se pudo marcar como leido: hace falta saber de que chat es', messageId);
        return;
      }
      const jid = toJid(chat.to);
      try {
        await sock.readMessages([
          {
            remoteJid: jid,
            id: messageId,
            fromMe: chat.fromMe ?? false,
            ...(chat.participant ? { participant: chat.participant } : {}),
          },
        ]);
      } catch (error) {
        console.log('[wa] WhatsApp no aceptó el acuse de lectura:', String(error).slice(0, 200));
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
