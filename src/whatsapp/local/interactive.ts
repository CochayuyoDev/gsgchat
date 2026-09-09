/**
 * Botones de verdad en el chat del cliente, no instrucciones escritas.
 *
 * WhatsApp los llama "native flow": van dentro de un `interactiveMessage` y
 * hay que armarlos a mano, porque Baileys 7 ya no trae el atajo `buttons` que
 * tenian las versiones viejas.
 *
 * Dos cosas que conviene tener claras antes de tocar esto:
 *
 * 1. **El cuerpo del mensaje siempre viaja como texto.** Si el WhatsApp de
 *    quien recibe no sabe pintar los botones -pasa, sobre todo en clientes
 *    viejos-, lo que ve es el texto de siempre. Por eso este camino es seguro:
 *    lo peor que puede pasar es quedarse como estaba.
 * 2. **`send_location` es el boton nativo de compartir ubicacion.** Es el
 *    mismo que usa la Cloud API. Fuera de ella no esta garantizado que se
 *    pinte, asi que el texto del cuerpo tiene que seguir explicando el camino
 *    manual (clip, Ubicacion) para quien no lo vea.
 */

export interface NativeFlowButton {
  name: string;
  buttonParamsJson: string;
}

/** El socket, con lo justo para mandar un mensaje armado a mano. */
export interface RelayCapableSocket {
  user?: { id?: string };
  relayMessage?(jid: string, content: unknown, options: { messageId?: string }): Promise<unknown>;
}

/** Boton que abre el selector de ubicacion del telefono. */
export function botonUbicacion(): NativeFlowButton {
  return { name: 'send_location', buttonParamsJson: '' };
}

/** Boton de respuesta rapida: al pulsarlo, el cliente manda ese texto. */
export function botonRespuesta(id: string, titulo: string): NativeFlowButton {
  return {
    name: 'quick_reply',
    // WhatsApp corta los titulos largos; 20 es el limite que respeta la
    // Cloud API y aqui vale lo mismo.
    buttonParamsJson: JSON.stringify({ display_text: titulo.slice(0, 20), id }),
  };
}

/**
 * Manda un mensaje con botones y devuelve su id.
 *
 * Lanza si el socket no puede retransmitir o si WhatsApp rechaza el formato;
 * el llamador tiene que capturarlo y caer al texto plano.
 */
export async function enviarConBotones(
  sock: RelayCapableSocket,
  jid: string,
  cuerpo: string,
  botones: NativeFlowButton[],
  pie?: string,
): Promise<string> {
  if (!sock.relayMessage) throw new Error('el socket no permite mandar botones');

  const baileys = await import('@whiskeysockets/baileys');
  const mensaje = baileys.generateWAMessageFromContent(
    jid,
    {
      // El envoltorio viewOnce es lo que hace que WhatsApp pinte el
      // interactiveMessage en un chat normal; sin el se ignora en silencio.
      viewOnceMessage: {
        message: {
          interactiveMessage: {
            body: { text: cuerpo },
            ...(pie ? { footer: { text: pie } } : {}),
            nativeFlowMessage: { buttons: botones },
          },
        },
      },
    } as never,
    { userJid: sock.user?.id ?? '' } as never,
  );

  await sock.relayMessage(jid, mensaje.message, { messageId: mensaje.key.id ?? undefined });
  if (!mensaje.key.id) throw new Error('WhatsApp no devolvio id para el mensaje con botones');
  return mensaje.key.id;
}
