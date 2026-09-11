/**
 * Traer al sistema las conversaciones que ya existen en WAHA.
 *
 * El webhook solo trae lo que pasa a partir de que se conecta. Todo lo que el
 * bot hablo antes -o lo que se hablo desde el telefono- esta en WhatsApp y no
 * aqui, asi que el operador abre `/chat` y ve la mitad de la historia.
 *
 * Esto lo arregla: WAHA expone los chats y sus mensajes, y se copian a la base
 * con el mismo formato que usa el webhook. Como cada mensaje se guarda con su
 * id, importar dos veces no duplica nada: el segundo pasa a ser una
 * actualizacion de estado y ya esta.
 *
 * Lo que NO se trae: grupos (esto es atencion uno a uno) y los ficheros
 * adjuntos, que en WAHA hay que descargar uno por uno y multiplicarian el
 * tiempo de la importacion. De un adjunto queda su marca en el hilo.
 */

import type { MessageKind } from '../../db/messages.js';
import type { Repos } from '../../db/repos.js';
import { normalizePhone } from '../../db/repos.js';
import { fromChatId } from './client.js';

export interface ConexionWaha {
  baseUrl: string;
  apiKey?: string;
  session?: string;
  fetchImpl?: typeof fetch;
}

export interface OpcionesImportacion {
  /** Cuantas conversaciones traer, de la mas reciente hacia atras. */
  limiteChats: number;
  /** Cuantos mensajes por conversacion. */
  mensajesPorChat: number;
}

export const POR_DEFECTO: OpcionesImportacion = { limiteChats: 50, mensajesPorChat: 100 };

export interface ResumenImportacion {
  chats: number;
  contactos: number;
  mensajes: number;
  /** Conversaciones que no se pudieron leer, con el motivo. */
  fallos: Array<{ chat: string; error: string }>;
  /** Grupos y difusiones que se saltaron. */
  omitidos: number;
}

interface ChatWaha {
  id?: string | { _serialized?: string };
  name?: string;
  timestamp?: number;
}

interface MensajeWaha {
  id?: string;
  timestamp?: number;
  from?: string;
  to?: string;
  fromMe?: boolean;
  body?: string;
  hasMedia?: boolean;
  type?: string;
  ack?: number;
  /** Los grupos traen el autor real aparte. */
  participant?: string;
}

/** El id de chat, que WAHA devuelve de dos formas segun la version. */
function idDe(chat: ChatWaha): string | null {
  if (typeof chat.id === 'string') return chat.id;
  const serializado = chat.id?._serialized;
  return typeof serializado === 'string' ? serializado : null;
}

/** true para grupos, difusiones y estados: aqui solo interesa el uno a uno. */
export function esConversacionDirecta(chatId: string): boolean {
  return chatId.endsWith('@c.us') || chatId.endsWith('@s.whatsapp.net');
}

/** El tipo de mensaje de WAHA con los nombres que usa la base. */
export function tipoDe(mensaje: MensajeWaha): MessageKind {
  const tipo = (mensaje.type ?? '').toLowerCase();
  if (tipo === 'image' || tipo === 'video' || tipo === 'audio' || tipo === 'document' || tipo === 'sticker') {
    return tipo as MessageKind;
  }
  if (tipo === 'ptt') return 'audio';
  if (tipo === 'location') return 'location';
  if (mensaje.hasMedia) return 'unknown';
  return 'text';
}

/** Lo que se ensena en el hilo cuando el mensaje no es texto. */
export function cuerpoDe(mensaje: MensajeWaha): string {
  const cuerpo = (mensaje.body ?? '').trim();
  if (cuerpo) return cuerpo;
  const kind = tipoDe(mensaje);
  if (kind === 'text') return '';
  const nombres: Record<string, string> = {
    image: '(foto)',
    video: '(video)',
    audio: '(audio)',
    document: '(documento)',
    sticker: '(sticker)',
    location: '(ubicacion)',
  };
  return nombres[kind] ?? '(adjunto)';
}

async function pedir<T>(conexion: ConexionWaha, ruta: string): Promise<T> {
  const base = conexion.baseUrl.replace(/\/+$/, '');
  const doFetch = conexion.fetchImpl ?? fetch;
  const respuesta = await doFetch(`${base}${ruta}`, {
    headers: conexion.apiKey ? { 'X-Api-Key': conexion.apiKey } : {},
  });
  const texto = await respuesta.text();
  if (!respuesta.ok) {
    throw new Error(`WAHA respondio ${respuesta.status}: ${texto.slice(0, 200)}`);
  }
  return (texto ? JSON.parse(texto) : []) as T;
}

/**
 * Copia a la base las conversaciones de WAHA.
 *
 * Los mensajes se guardan con el id que trae WAHA como `wamid`, que es lo que
 * hace la importacion repetible: volver a lanzarla no duplica el hilo.
 */
export async function importarConversaciones(
  deps: { repos: Repos; log?: (mensaje: string, detalle?: Record<string, unknown>) => void },
  conexion: ConexionWaha,
  opciones: OpcionesImportacion = POR_DEFECTO,
): Promise<ResumenImportacion> {
  const session = conexion.session || 'default';
  const resumen: ResumenImportacion = { chats: 0, contactos: 0, mensajes: 0, fallos: [], omitidos: 0 };

  const chats = await pedir<ChatWaha[]>(
    conexion,
    `/api/${encodeURIComponent(session)}/chats?limit=${opciones.limiteChats}`,
  );

  for (const chat of chats) {
    const chatId = idDe(chat);
    if (!chatId) continue;

    if (!esConversacionDirecta(chatId)) {
      resumen.omitidos++;
      continue;
    }

    const phone = normalizePhone(fromChatId(chatId));
    if (!phone) {
      resumen.omitidos++;
      continue;
    }

    let mensajes: MensajeWaha[];
    try {
      mensajes = await pedir<MensajeWaha[]>(
        conexion,
        `/api/${encodeURIComponent(session)}/chats/${encodeURIComponent(chatId)}/messages` +
          `?limit=${opciones.mensajesPorChat}&downloadMedia=false`,
      );
    } catch (error) {
      resumen.fallos.push({
        chat: chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const existia = await deps.repos.contacts.getByPhone(phone);
    const contacto = await deps.repos.contacts.upsertFromInbound(phone, chat.name?.trim() || undefined);
    if (!existia) resumen.contactos++;
    resumen.chats++;

    // Del mas viejo al mas nuevo, para que el hilo quede en orden aunque WAHA
    // los devuelva al reves.
    const ordenados = mensajes
      .slice()
      .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

    let ultimoEntrante: Date | null = null;

    for (const mensaje of ordenados) {
      // WAHA marca la hora en segundos, como Meta.
      const cuando = mensaje.timestamp ? new Date(mensaje.timestamp * 1000) : new Date();
      const entrante = !mensaje.fromMe;

      await deps.repos.messages.add({
        contactId: contacto.id,
        direction: entrante ? 'in' : 'out',
        wamid: mensaje.id ?? null,
        kind: tipoDe(mensaje),
        body: cuerpoDe(mensaje),
        // Se marca de donde vino: en el hilo no hay forma de distinguir un
        // mensaje importado de uno que entro por el webhook, y el dia que
        // algo no cuadre esa diferencia es lo primero que se mira.
        payload: { importado: 'waha' },
        status: mensaje.fromMe ? 'sent' : null,
        createdAt: cuando,
      });
      resumen.mensajes++;

      if (entrante && (!ultimoEntrante || cuando > ultimoEntrante)) ultimoEntrante = cuando;
    }

    // La ventana de 24 h se calcula con esto: sin actualizarlo, un cliente que
    // acaba de escribir por el telefono saldria como "fuera de la ventana".
    if (ultimoEntrante) await deps.repos.contacts.touchInbound(phone, ultimoEntrante);
  }

  deps.log?.('conversaciones importadas de WAHA', {
    chats: resumen.chats,
    mensajes: resumen.mensajes,
    omitidos: resumen.omitidos,
  });

  return resumen;
}
