/**
 * WhatsApp dentro de este mismo proceso: ni Docker, ni contenedor, ni Meta.
 *
 * Es el camino corto. Baileys habla el protocolo de WhatsApp Web por
 * WebSocket, sin navegador, asi que el QR y el codigo de vinculacion salen
 * aqui mismo y la sesion vive en el proceso del servidor.
 *
 * Estados, a proposito los mismos nombres que WAHA para que la pantalla de
 * /setup y sus sondeos sirvan igual para los dos:
 *
 *   STOPPED -> STARTING -> SCAN_QR_CODE -> WORKING
 *                              +- FAILED
 *
 * El precio es el mismo que el de cualquier cliente no oficial: esto emula
 * WhatsApp Web, esta fuera de los terminos de Meta y el numero se puede
 * banear. Aqui no hay gate de calidad que valga porque no hay calidad que
 * consultar: lo unico que queda es el opt-in y el cupo diario.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import QRCode from 'qrcode';
import type { AnuncioEntrada, ChangeValue, InboundMessage } from '../types.js';
import { desenvolver, guardarMedia, mediaDirectory, tipoDeAdjunto, type MediaInfo } from './media.js';

export type LocalStatus = 'STOPPED' | 'STARTING' | 'SCAN_QR_CODE' | 'WORKING' | 'FAILED';

export interface LocalState {
  status: LocalStatus;
  /** QR en base64 (PNG), listo para un <img src="data:image/png;base64,...">. */
  qr: string | null;
  /** Codigo de ocho caracteres cuando se vincula por numero. */
  pairingCode: string | null;
  /** Telefono conectado, en digitos. */
  phone: string;
  name: string;
  detail: string;
}

/** Lo minimo del socket de Baileys que usa este proyecto. */
export interface LocalSocket {
  /**
   * El tercer parametro es el de Baileys: ahi va `quoted` para responder
   * citando. Es opcional para que el socket de pega de los tests siga valiendo
   * con dos parametros.
   */
  sendMessage(jid: string, content: unknown, options?: { quoted?: unknown }): Promise<{ key?: { id?: string } } | undefined>;
  /**
   * Marca como leido. Baileys quiere la CLAVE entera de cada mensaje
   * (`remoteJid`, `id`, `fromMe` y, en un grupo, `participant`): con solo el
   * id no marca nada y no avisa.
   */
  readMessages(keys: unknown[]): Promise<void>;
  requestPairingCode(phone: string): Promise<string>;
  logout(): Promise<void>;
  end(error?: Error): void;
  ev: { on(evento: string, handler: (arg: never) => void): void };
  user?: { id?: string; name?: string; lid?: string };
  /**
   * El socket crudo, por debajo de los eventos. Emite `CB:message` con cada
   * nodo de mensaje ANTES de que Baileys decida que hacer con el; es la
   * unica forma de ver los "ver una vez" que Baileys descarta sin avisar
   * (`view_once_unavailable_fanout`).
   */
  ws?: { on(evento: string, handler: (nodo: unknown) => void): void };
  /**
   * El mapa LID -> telefono que mantiene Baileys.
   *
   * Desde la migracion a LID, un entrante puede traer SOLO el identificador
   * opaco: ni `remoteJidAlt` ni nada con el numero. El unico sitio donde esta
   * la equivalencia es este almacen, que Baileys va llenando segun conoce a
   * cada contacto.
   */
  signalRepository?: {
    lidMapping?: { getPNForLID(lid: string): Promise<string | null> };
  };
  /**
   * Le pide al telefono del remitente que vuelva a subir un adjunto.
   *
   * Es el rescate cuando el enlace directo del fichero ya caduco. Ver
   * `bajarAdjunto`: sin esto, un sticker reenviado de una conversacion vieja
   * llegaba al chat como un "(sticker)" sin imagen.
   */
  updateMediaMessage?(mensaje: unknown): Promise<unknown>;
  /** Para los mensajes con botones, que hay que armar a mano. */
  relayMessage?(jid: string, content: unknown, options: { messageId?: string }): Promise<unknown>;
  /** Pregunta al servidor si esos numeros tienen cuenta de WhatsApp. */
  onWhatsApp?(...jids: string[]): Promise<Array<{ jid: string; exists: boolean }> | undefined>;
  /**
   * Presencia: "composing" mientras se escribe, "paused" al parar. Es lo que
   * hace que el mensaje no aparezca de la nada. Ver src/salud/humano.ts.
   */
  sendPresenceUpdate?(type: 'composing' | 'paused' | 'available' | 'unavailable', jid?: string): Promise<void>;
  presenceSubscribe?(jid: string): Promise<void>;
  /**
   * Le pide al telefono que reenvie un mensaje que llego sin contenido.
   *
   * Es lo que hace WhatsApp Web con los mensajes que no pudo descifrar. Aqui
   * se usa con los "ver una vez", que llegan como un sobre vacio: si el
   * telefono lo suelta, Baileys lo vuelve a emitir por `messages.upsert`
   * con `requestId` y entonces si trae la foto.
   */
  requestPlaceholderResend?(key: unknown, datos?: unknown): Promise<string | undefined>;
  /**
   * Le pide al telefono mensajes anteriores de un chat (`count`, desde el
   * mas viejo que se conoce). Llegan por `messaging-history.set`.
   */
  fetchMessageHistory?(count: number, oldestMsgKey: { remoteJid: string; fromMe: boolean; id: string }, oldestMsgTimestampMs: number): Promise<string>;
  /** Los grupos en los que esta el numero: jid -> nombre y participantes. */
  groupFetchAllParticipating?(): Promise<Record<string, GrupoMetadata>>;
  groupMetadata?(jid: string): Promise<GrupoMetadata>;
}

/** Lo que interesa de un grupo de WhatsApp. */
export interface GrupoMetadata {
  id?: string;
  subject?: string;
  participants?: unknown[];
}

/** Un grupo tal como se le entrega al resto del sistema. */
export interface GrupoResumen {
  jid: string;
  nombre: string;
  participantes: number;
}

export interface StartLocalOptions {
  /** Carpeta donde se guarda la vinculacion. Sobrevive a los reinicios. */
  authDir: string;
  /** A donde van los mensajes entrantes ya traducidos. */
  onChange?: (value: ChangeValue) => Promise<void> | void;
  /** Donde se guardan las fotos, audios y documentos que llegan. */
  mediaDir?: string;
  /** Inyectable para las pruebas: por defecto, Baileys de verdad. */
  createSocket?: (deps: { authDir: string }) => Promise<{
    sock: LocalSocket;
    saveCreds: () => Promise<void>;
  }>;
  log?: (mensaje: string) => void;
  /**
   * Cada corte de conexion, con el codigo de Baileys (401 desvinculado, 403
   * prohibido = baneo, 428 cerrada, 440 reemplazada, 515 reinicio...). El
   * monitor de salud cuenta las desconexiones y para todo con un 403.
   */
  onDisconnect?: (code: number | undefined, detail: string) => void;
  /**
   * Los grupos del numero, al conectar y cada vez que WhatsApp avisa de uno
   * nuevo o de un cambio de nombre. Es lo que hace que un grupo aparezca en
   * el chat antes de que nadie escriba en el.
   */
  onGrupos?: (grupos: GrupoResumen[]) => Promise<void> | void;
  /**
   * Un mensaje PROPIO: lo que se mando desde el telefono (o desde otro
   * dispositivo), en vivo o del historial. Se guarda en el hilo como
   * saliente para que el chat sea el mismo que el del telefono. Los envios
   * de este sistema tambien vuelven por aqui, con el mismo id: la fila ya
   * existe y no pasa nada.
   */
  onPropio?: (propio: MensajePropio) => Promise<void> | void;
  /**
   * El telefono termino de mandar las conversaciones recientes de TODOS los
   * chats (pasa una vez, al vincular). Es el momento en que cada chat tiene
   * ya un mensaje de referencia y se le puede pedir al telefono lo anterior.
   */
  onSincronizacionInicial?: () => Promise<void> | void;
}

export interface MensajePropio {
  /** Traducido como si fuera entrante: `from` es el chat (persona o grupo). */
  mensaje: InboundMessage;
  status: 'sent' | 'delivered' | 'read' | 'failed' | null;
}

/**
 * Cierres tras los que la vinculacion guardada ya no sirve: 401 (el telefono
 * cerro la sesion), 411 (conflicto multidispositivo) y 500 (sesion corrupta).
 * Reintentar con esas credenciales solo repite el mismo rechazo.
 */
export function vinculacionMuerta(code: number | undefined): boolean {
  return code === 401 || code === 411 || code === 500;
}

/** Si hay una vinculacion guardada con la que intentar reconectar. */
export function hayVinculacion(authDir: string): boolean {
  return existsSync(join(authDir, 'creds.json'));
}

/** Que significa cada codigo de cierre de Baileys, en cristiano. */
export function explicarCierre(code: number | undefined): string {
  switch (code) {
    case 401:
      return 'La sesion se cerro desde el telefono. Pulsa "Conectar" y escanea el QR nuevo.';
    case 403:
      return 'WhatsApp rechazo la sesion (403). Suele ser un baneo del numero: no se reintenta solo.';
    case 408:
      return 'Tiempo de espera agotado; se reintenta.';
    case 411:
      return 'Conflicto multidispositivo. Pulsa "Conectar" y escanea el QR nuevo.';
    case 428:
      return 'La conexion se cerro; se reintenta.';
    case 440:
      return 'Otra sesion con las mismas credenciales tomo el sitio.';
    case 500:
      return 'La sesion guardada estaba corrupta. Pulsa "Conectar" y escanea el QR nuevo.';
    case 503:
      return 'Servicio no disponible; se reintenta.';
    case 515:
      return 'WhatsApp pidio reiniciar la conexion; se reintenta.';
    default:
      return 'Se corto la conexion.';
  }
}


export function esGrupo(jid: string | undefined): boolean {
  return typeof jid === 'string' && jid.endsWith('@g.us');
}


/** Lo que se sabe del otro lado ahora mismo (ver el listener de `presence.update`). */
export interface PresenciaChat {
  estado: 'escribiendo' | 'grabando' | 'en_linea' | 'desconectado';
  /** Cuando se supo, en ms. */
  desde: number;
  /** Ultima vez que se le vio, si el cliente lo comparte. null = no lo comparte. */
  ultimaVez: number | null;
}


/** "Escribiendo..." dura segundos; pasado esto ya no es verdad. */
const PRESENCIA_VIVA_MS = 25_000;

/** Telefono en digitos a jid de WhatsApp. */
export function toJid(phone: string): string {
  if (phone.includes('@')) return phone;
  return `${phone.replace(/\D+/g, '')}@s.whatsapp.net`;
}

/** jid a telefono en digitos. */
export function fromJid(jid: string): string {
  return (jid.split('@')[0] ?? '').split(':')[0] ?? '';
}

/** Baileys de verdad. Se carga tarde para no pagarlo si nadie usa este modo. */
async function baileysSocket(deps: { authDir: string }) {
  const baileys = await import('@whiskeysockets/baileys');
  const make = (baileys as unknown as { default?: unknown }).default ?? baileys.makeWASocket;
  const { state, saveCreds } = await baileys.useMultiFileAuthState(deps.authDir);

  const sock = (make as (config: unknown) => unknown)({
    auth: state,
    // La pantalla ya enseña el QR; pintarlo tambien en la consola solo ensucia.
    printQRInTerminal: false,
    browser: baileys.Browsers.ubuntu('Chrome'),
    syncFullHistory: false,
    markOnlineOnConnect: false,
  }) as LocalSocket;

  return { sock, saveCreds };
}


/**
 * Por que un entrante no se pudo convertir en mensaje, para el log.
 *
 * Un "descartado" a secas no dice si fue un grupo (normal), un remitente sin
 * telefono (un LID que no se pudo resolver) o un mensaje que no se pudo
 * descifrar (WhatsApp lo reenvia), y sin eso no hay forma de saber que hacer.
 */
export function porQueSeDescarta(mensaje: unknown, telefonoResuelto: string | null): string {
  const m = mensaje as {
    key?: { id?: string; remoteJid?: string; remoteJidAlt?: string; fromMe?: boolean };
    message?: Record<string, unknown>;
    messageStubType?: number;
  };
  const jid = m.key?.remoteJid ?? '';
  if (/@(broadcast|newsletter)$/.test(jid)) return 'estado o canal: no es una conversacion';
  if (!esGrupo(jid) && !telefonoDe(m.key) && !telefonoResuelto) return 'remitente sin telefono: LID sin equivalencia todavia';
  if (!m.message) {
    const stub = m.messageStubType;
    // WebMessageInfo.StubType: 20-33 son avisos de grupo (alguien entro,
    // salio, cambio el nombre...). No son mensajes: no hay nada que leer.
    if (typeof stub === 'number' && stub >= 20 && stub <= 33) return `aviso del grupo (alguien entro o salio, cambio de nombre...; stub ${stub}): no es un mensaje`;
    if (stub === 2) return 'sin contenido: no se pudo descifrar (stub 2); WhatsApp pedira el reenvio';
    return `sin contenido (stub ${stub ?? '?'})`;
  }
  const claves = (obj: Record<string, unknown>, nivel = 0): string =>
    Object.keys(obj)
      .map((k) => {
        const v = obj[k];
        const dentro = v && typeof v === 'object' && nivel < 2 ? (v as { message?: Record<string, unknown> }).message : undefined;
        return dentro ? `${k}>${claves(dentro, nivel + 1) || '{}'}` : k;
      })
      .join(',');
  return `contenido no reconocido: ${claves(m.message) || '{}'}`;
}

/**
 * El telefono de quien escribe, resolviendo el LID si hace falta.
 *
 * Se pregunta al almacen de Baileys solo cuando el mensaje no trae ningun
 * `@s.whatsapp.net`, que es el caso que dejaba los entrantes invisibles.
 *
 * En un grupo, "quien escribe" es el participante (`participant`), no el
 * grupo: es su telefono el que se resuelve.
 */
async function resolverTelefono(
  sock: LocalSocket,
  key: { remoteJid?: string; remoteJidAlt?: string; participant?: string; participantAlt?: string } | undefined,
): Promise<string | null> {
  if (esGrupo(key?.remoteJid)) {
    if (autorDeGrupo(key)) return null; // ya se sabe
    const lid = [key?.participant, key?.participantAlt].find((j) => typeof j === 'string' && j.endsWith('@lid'));
    if (!lid) return null;
    try {
      const pn = await sock.signalRepository?.lidMapping?.getPNForLID(lid);
      return pn ? fromJid(pn) : null;
    } catch {
      return null; // se ensena con su nombre y sin telefono
    }
  }

  if (telefonoDe(key)) return null; // ya se sabe; no hace falta preguntar
  const jid = key?.remoteJid;
  if (!jid || !jid.endsWith('@lid') || !esConversacionDirecta(jid)) return null;

  try {
    const pn = await sock.signalRepository?.lidMapping?.getPNForLID(jid);
    return pn ? fromJid(pn) : null;
  } catch {
    // Que el mapa no sepa de ese LID todavia no es un error: se descarta el
    // mensaje con su linea de log, como cualquier otro que no se pueda situar.
      return null;
  }
}


/** Lo que de un mensaje propio merece una fila en el hilo. */
const PROPIOS_QUE_SE_GUARDAN = new Set(['text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'reaction']);

/**
 * Engancha el socket crudo para ver los "ver una vez" que Baileys descarta.
 *
 * WhatsApp manda a los dispositivos vinculados un `<message>` con un hijo
 * `<unavailable type="view_once">` (o `view_once_unavailable_fanout`) y sin
 * nada cifrado. Con el primero Baileys emite un mensaje vacio marcado
 * `isViewOnce`; con el segundo lo da por "excluido" y NO avisa a nadie: en
 * el log solo quedaba un debug, y en la pantalla, nada. Aqui se leen los dos
 * del nodo y se atienden igual: aviso en el chat y peticion de reenvio.
 */
/** Los sobres atendidos de quien llama a `escucharSobres` sin sesion (pruebas). */
const sobresSueltos = new Set<string>();

export function escucharSobres(
  sock: LocalSocket,
  entregar: (mensaje: unknown, tipoEvento: string) => Promise<void>,
  log: (m: string) => void,
  sobresAtendidos: Set<string> = sobresSueltos,
): void {
  if (!sock.ws?.on) return;
  // Traza de lo que entra por el socket, nodo a nodo (sin contenido): es lo
  // que permite ver con que forma llega algo que "no aparece". Se enciende
  // con WA_TRAZA=1 para no llenar el log en el dia a dia.
  if (process.env.WA_TRAZA === '1') {
    sock.ws.on('frame', (nodo) => {
      const n = nodo as { tag?: string; attrs?: Record<string, string>; content?: unknown };
      if (!n?.tag || n.tag === 'ack' || n.tag === 'ib' || n.tag === 'presence' || n.tag === 'chatstate') return;
      const hijos = Array.isArray(n.content) ? (n.content as Array<{ tag?: string; attrs?: Record<string, string> }>) : [];
      const etiquetas = hijos.map((h) => `${h?.tag ?? '?'}${h?.attrs?.type ? `(${h.attrs.type})` : ''}`).join(',');
      log(`traza <${n.tag}> from=${n.attrs?.from ?? '-'} type=${n.attrs?.type ?? '-'} id=${n.attrs?.id ?? '-'} hijos=${etiquetas || '-'}`);
    });
  }
  sock.ws.on('CB:message', (nodo) => {
    // Lo que llega sin nada cifrado es raro (sobres, avisos): se deja rastro
    // de que era, porque es justo lo que "no aparece por ningun lado".
    const n = nodo as { attrs?: Record<string, string>; content?: unknown };
    const hijos = Array.isArray(n?.content) ? (n.content as Array<{ tag?: string; attrs?: Record<string, string> }>) : [];
    if (hijos.length && !hijos.some((h) => h?.tag === 'enc' || h?.tag === 'plaintext')) {
      const etiquetas = hijos.map((h) => `${h?.tag ?? '?'}${h?.attrs?.type ? `(${h.attrs.type})` : ''}`).join(',');
      log(`nodo sin contenido cifrado de ${n.attrs?.from ?? '?'} (${n.attrs?.type ?? 'sin tipo'}): ${etiquetas}`);
    }
    const sobre = sobreDeVerUnaVez(nodo);
    if (!sobre) return;
    // Se apunta ANTES de nada asincrono: Baileys emite el mismo sobre por
    // `messages.upsert` (cuando trae la marca) y hay que ganarle la carrera.
    const id = (nodo as { attrs?: Record<string, string> }).attrs?.id ?? '';
    if (!id || sobresAtendidos.has(id)) return;
    sobresAtendidos.add(id);
    if (sobresAtendidos.size > 500) sobresAtendidos.delete(sobresAtendidos.values().next().value as string);
    void (async () => {
      const baileys = await import('@whiskeysockets/baileys');
      const { fullMessage } = baileys.decodeMessageNode(nodo as never, sock.user?.id ?? '', sock.user?.lid ?? '');
      if (fullMessage.key.fromMe || !fullMessage.key.id) return;
      log(`"ver una vez" (${sobre.tipo}) de ${fullMessage.key.remoteJid}: WhatsApp no entrego el fichero; se pide al telefono`);
      await entregar(
        {
          key: { ...fullMessage.key, isViewOnce: true },
          messageTimestamp: fullMessage.messageTimestamp,
          pushName: fullMessage.pushName,
        },
        sobre.offline ? 'append' : 'notify',
      );
    })().catch((error: unknown) => log(`fallo leyendo un sobre de "ver una vez": ${String(error)}`));
  });
}

/** Si el nodo es un "ver una vez" sin contenido, y de que tipo. */
export function sobreDeVerUnaVez(nodo: unknown): { tipo: string; offline: boolean } | null {
  const n = nodo as { tag?: string; attrs?: Record<string, string>; content?: unknown };
  if (n?.tag !== 'message' || !Array.isArray(n.content)) return null;
  const hijos = n.content as Array<{ tag?: string; attrs?: Record<string, string> }>;
  const unavailable = hijos.find((h) => h?.tag === 'unavailable');
  const tipo = unavailable?.attrs?.type ?? '';
  if (!tipo.startsWith('view_once')) return null;
  // Si ademas viene algo cifrado, Baileys lo descifra y lo entrega: no es
  // un sobre vacio.
  if (hijos.some((h) => h?.tag === 'enc' || h?.tag === 'plaintext')) return null;
  return { tipo, offline: Boolean(n.attrs?.offline) };
}

/**
 * Le pide al telefono que reenvie un "ver una vez" que llego vacio.
 *
 * WhatsApp no manda ese adjunto a los dispositivos vinculados; lo unico que
 * se puede hacer es pedirselo al telefono, que es quien lo tiene. Si lo
 * suelta, llega por `messages.upsert` con `requestId` y el chat lo completa;
 * si no, el mensaje se queda como "solo se abre en el telefono", que es la
 * verdad. Un fallo aqui no es un fallo del mensaje: se apunta y ya.
 */
function pedirReenvio(sock: LocalSocket, mensaje: unknown, log: (m: string) => void): void {
  if (!sock.requestPlaceholderResend) return;
  const m = mensaje as {
    key?: { id?: string; remoteJid?: string; fromMe?: boolean; participant?: string };
    messageTimestamp?: number | string;
    pushName?: string;
  };
  if (!m.key?.id || !m.key.remoteJid) return;
  const limpia = { remoteJid: m.key.remoteJid, fromMe: false, id: m.key.id, participant: m.key.participant };
  const datos = { key: m.key, messageTimestamp: m.messageTimestamp, pushName: m.pushName };
  sock
    .requestPlaceholderResend(limpia, datos)
    .then((r) => log(`"ver una vez" de ${m.key?.remoteJid}: se le pidio al telefono que lo reenvie${r ? ` (${r})` : ''}`))
    .catch((error: unknown) => log(`no se pudo pedir el reenvio del "ver una vez": ${String(error)}`));
}


/** Donde se guarda la vinculacion por defecto. */
export function defaultAuthDir(base = process.cwd()): string {
  return join(base, '.wa-auth');
}

/**
 * Baja el adjunto de un mensaje entrante.
 *
 * `reuploadRequest` no es un adorno: WhatsApp guarda el fichero en sus
 * servidores un tiempo y cuando ese enlace caduca la descarga directa falla.
 * Pasa sobre todo con los STICKERS, que la gente reenvia de conversaciones
 * viejas, y con lo que llega mientras el sistema esta apagado. Con esa opcion
 * Baileys le pide al telefono del remitente que lo vuelva a subir y lo baja
 * del enlace nuevo; sin ella, el mensaje se guardaba sin fichero y el chat
 * enseñaba un "(sticker)" pelado que parece un fallo de la pantalla.
 *
 * Si aun asi falla, se anota y se devuelve null: perder la foto es molesto,
 * perder el mensaje entero es un fallo.
 */
/**
 * Tope por adjunto. Sin el, un pedido de resubida que el telefono nunca
 * contesta dejaba la descarga esperando para siempre y, detras de ella, todo
 * el historial sin guardar (paso el 16 de septiembre de 2026: 13.000
 * mensajes trabados detras de un sticker).
 */
const TOPE_DESCARGA_MS = 25_000;

async function bajarAdjunto(
  mensaje: unknown,
  wamid: string,
  opts: StartLocalOptions,
  log: (mensaje: string) => void,
  sock?: { updateMediaMessage?: (mensaje: unknown) => Promise<unknown> },
  ajuste: { resubida?: boolean } = {},
): Promise<MediaInfo | null> {
  const contenido = (mensaje as { message?: Record<string, unknown> }).message ?? {};
  if (!tipoDeAdjunto(contenido) || !wamid) return null;

  try {
    const baileys = await import('@whiskeysockets/baileys');
    // Pedirle al telefono que resuba el fichero solo tiene sentido en vivo:
    // en el historial son miles y el telefono no contesta a la mayoria.
    const reintento = sock?.updateMediaMessage && ajuste.resubida !== false
      ? { reuploadRequest: (m: unknown) => sock.updateMediaMessage!(m) }
      : {};

    return await guardarMedia(mensaje, wamid, {
      dir: opts.mediaDir ?? mediaDirectory(),
      descargar: (m) =>
        conTope(
          baileys.downloadMediaMessage(m as never, 'buffer', {}, reintento as never) as Promise<Buffer>,
          TOPE_DESCARGA_MS,
          'la descarga tardo demasiado',
        ),
    });
  } catch (error) {
    const { contenido: real, verUnaVez } = desenvolver(contenido);
    const clave = Object.keys(real).find((k) => k.endsWith('Message') && k !== 'messageContextInfo') ?? '?';
    const detalle = (real[clave] ?? {}) as Record<string, unknown>;
    const trae = ['url', 'directPath', 'mediaKey', 'fileSha256', 'viewOnce'].filter((k) => detalle[k] != null && detalle[k] !== '').join(',') || 'nada';
    log(`no se pudo bajar el adjunto (${clave}${verUnaVez ? ', ver una vez' : ''}; trae: ${trae}): ${String(error)}`);
    return null;
  }
}

/** Una promesa con tope: pasado el tiempo, falla en vez de esperar para siempre. */
export function conTope<T>(promesa: Promise<T>, ms: number, motivo: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(motivo)), ms);
    promesa.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * El boton que pulso el cliente, en la forma que usa Meta.
 *
 * WhatsApp tiene tres envoltorios distintos para lo mismo segun como se mando
 * el mensaje original, y los tres acaban aqui.
 */
function respuestaDeBoton(
  contenido: Record<string, unknown>,
): { id: string; title: string } | null {
  const interactivo = contenido.interactiveResponseMessage as
    | { nativeFlowResponseMessage?: { paramsJson?: string }; body?: { text?: string } }
    | undefined;
  if (interactivo) {
    try {
      const params = JSON.parse(interactivo.nativeFlowResponseMessage?.paramsJson ?? '{}') as {
        id?: string;
        display_text?: string;
      };
      const title = params.display_text ?? interactivo.body?.text ?? '';
      if (params.id || title) return { id: params.id ?? title, title };
    } catch {
      // paramsJson corrupto: se trata como si no fuera un boton.
    }
  }

  const clasico = contenido.buttonsResponseMessage as
    | { selectedButtonId?: string; selectedDisplayText?: string }
    | undefined;
  if (clasico?.selectedButtonId) {
    return { id: clasico.selectedButtonId, title: clasico.selectedDisplayText ?? '' };
  }

  const plantilla = contenido.templateButtonReplyMessage as
    | { selectedId?: string; selectedDisplayText?: string }
    | undefined;
  if (plantilla?.selectedId) {
    return { id: plantilla.selectedId, title: plantilla.selectedDisplayText ?? '' };
  }

  const lista = contenido.listResponseMessage as
    | { singleSelectReply?: { selectedRowId?: string }; title?: string }
    | undefined;
  if (lista?.singleSelectReply?.selectedRowId) {
    return { id: lista.singleSelectReply.selectedRowId, title: lista.title ?? '' };
  }

  return null;
}

/**
 * El telefono del remitente, o null si el mensaje no es una conversacion
 * uno a uno que se pueda contestar.
 *
 * WhatsApp esta migrando a LID: desde 2025 muchos mensajes llegan con
 * `remoteJid` en la forma `1234@lid`, que es un identificador opaco y NO un
 * telefono. El numero de verdad viaja aparte, en `remoteJidAlt`. Quedarse
 * solo con `@s.whatsapp.net` -que es lo que parece correcto- hace que no
 * entre ni un mensaje, y sin ruido: se descartan todos en silencio.
 */
export function esConversacionDirecta(jid: string | undefined): boolean {
  return Boolean(jid) && !/@(g.us|broadcast|newsletter)$/.test(jid as string);
}

export function telefonoDe(key: { remoteJid?: string; remoteJidAlt?: string } | undefined): string | null {
  const candidatos = [key?.remoteJid, key?.remoteJidAlt].filter(
    (j): j is string => typeof j === 'string' && j.length > 0,
  );

  // Grupos, estados y canales no son uno a uno: fuera antes de nada.
  if (candidatos.some((j) => /@(g.us|broadcast|newsletter)$/.test(j))) return null;

  const conNumero = candidatos.find((j) => j.endsWith('@s.whatsapp.net'));
  if (conNumero) return fromJid(conNumero);

  // Solo LID: no hay telefono con el que abrir la conversacion. Se descarta,
  // pero es un caso que conviene ver en el log si alguna vez pasa.
  return null;
}

/**
 * El telefono de quien escribio dentro de un grupo, si viene con numero.
 *
 * Baileys pone al participante en `participant` (que desde la migracion a
 * LID suele ser opaco) y su numero en `participantAlt`. Sin ninguno de los
 * dos con `@s.whatsapp.net` se devuelve null y el mensaje se ensena solo con
 * el nombre.
 */
export function autorDeGrupo(key: { participant?: string; participantAlt?: string } | undefined): string | null {
  const conNumero = [key?.participant, key?.participantAlt].find(
    (j): j is string => typeof j === 'string' && j.endsWith('@s.whatsapp.net'),
  );
  return conNumero ? fromJid(conNumero) : null;
}

/** Si, quitando llaves y metadatos, queda algo que leer. */
/**
 * El anuncio del que viene el mensaje, si viene de uno.
 *
 * Un "click to WhatsApp" de Facebook o Instagram llega con un
 * `contextInfo.externalAdReply` (titulo, texto, imagen, direccion y el id
 * del clic) dentro del texto o de la foto, y a veces solo con
 * `conversionSource`. Sin esto, por QR los clientes de los anuncios entraban
 * como si fueran organicos y el kit de bienvenida por anuncio no se disparaba.
 * Un enlace pegado por el cliente NO trae `sourceId` ni `ctwaClid`: no cuenta.
 */
export function anuncioDe(contenido: Record<string, unknown>): AnuncioEntrada | null {
  for (const valor of Object.values(contenido)) {
    const ctx = (valor as { contextInfo?: Record<string, unknown> } | null)?.contextInfo;
    if (!ctx) continue;
    const ad = ctx.externalAdReply as
      | { title?: string; body?: string; sourceType?: string; sourceId?: string; sourceUrl?: string; thumbnailUrl?: string; mediaUrl?: string; ctwaClid?: string; showAdAttribution?: boolean }
      | undefined;
    const conversion = typeof ctx.conversionSource === 'string' ? ctx.conversionSource : null;
    const esAnuncio = Boolean(ad && (ad.ctwaClid || ad.sourceId || ad.showAdAttribution || /ad/i.test(ad.sourceType ?? ''))) || Boolean(conversion);
    if (!esAnuncio) continue;
    return {
      id: ad?.sourceId || null,
      titulo: ad?.title || null,
      texto: ad?.body || null,
      url: ad?.sourceUrl || null,
      imagen: ad?.thumbnailUrl || ad?.mediaUrl || null,
      clid: ad?.ctwaClid || null,
      origen: ad?.sourceType ? ad.sourceType.toLowerCase() : conversion ? conversion.toLowerCase() : 'ad',
    };
  }
  return null;
}

/**
 * El id del mensaje que se esta citando, si lo hay.
 *
 * Cualquier tipo de mensaje puede llevar cita, y cada uno la cuelga de su
 * propio `contextInfo`: se mira en todos en vez de caso por caso.
 */
export function citaDe(contenido: Record<string, unknown>): string | null {
  for (const valor of Object.values(contenido)) {
    const ctx = (valor as { contextInfo?: { stanzaId?: string } } | null)?.contextInfo;
    if (ctx?.stanzaId) return ctx.stanzaId;
  }
  return null;
}

function hayContenidoAparteDeLlaves(contenido: Record<string, unknown>): boolean {
  return Object.keys(contenido).some((k) => k !== 'senderKeyDistributionMessage' && k !== 'messageContextInfo');
}

/** Mas viejo que esto, un entrante no se contesta aunque venga como `notify`. */
export const MAXIMA_EDAD_PARA_CONTESTAR_MS = 10 * 60_000;

/**
 * Si un entrante es del historial y no de ahora.
 *
 * Baileys entrega los mensajes en vivo con `type: 'notify'`; el historial y
 * lo que sincroniza al reconectar llega como `append`. Y aun con `notify`,
 * lo que se acumulo mientras el sistema estaba apagado puede tener horas: a
 * eso tampoco se le contesta en cadena. Diez minutos es el margen para un
 * reinicio normal.
 */
export function esMensajeViejo(tipoEvento: string | undefined, timestamp: string | number | undefined, ahora = Date.now()): boolean {
  if (tipoEvento !== 'notify') return true;
  const segundos = Number(timestamp);
  if (!Number.isFinite(segundos) || segundos <= 0) return false;
  return ahora - segundos * 1000 > MAXIMA_EDAD_PARA_CONTESTAR_MS;
}

/**
 * El estado de Baileys (WAMessageStatus) al de la Cloud API.
 *
 *   0 ERROR, 1 PENDING, 2 SERVER_ACK, 3 DELIVERY_ACK, 4 READ, 5 PLAYED.
 *
 * PENDING no dice nada nuevo y se ignora; PLAYED (un audio escuchado) es
 * leido a todos los efectos.
 */
export function ackToStatus(status: unknown): 'sent' | 'delivered' | 'read' | 'failed' | null {
  const n = typeof status === 'number' ? status : typeof status === 'string' ? Number(status) : Number.NaN;
  if (!Number.isFinite(n)) return null;
  if (n === 0) return 'failed';
  if (n === 2) return 'sent';
  if (n === 3) return 'delivered';
  if (n === 4 || n === 5) return 'read';
  return null;
}

type StatusTraducido = { id: string; status: 'sent' | 'delivered' | 'read' | 'failed'; timestamp: string; recipient_id: string };

/**
 * Traduce un lote de `messages.update` a los `statuses` del webhook de Meta.
 *
 * Solo los mensajes propios (`fromMe`) con un estado que signifique algo: el
 * id de Baileys es el mismo que se guardo como wamid al enviar.
 */
export function acksToStatuses(updates: unknown[]): StatusTraducido[] {
  const salida: StatusTraducido[] = [];
  for (const u of updates ?? []) {
    const item = u as { key?: { id?: string; remoteJid?: string; fromMe?: boolean }; update?: { status?: unknown } };
    const id = item.key?.id;
    if (!id || item.key?.fromMe === false) continue;
    const status = ackToStatus(item.update?.status);
    if (!status) continue;
    salida.push({
      id,
      status,
      timestamp: String(Math.floor(Date.now() / 1000)),
      recipient_id: fromJid(item.key?.remoteJid ?? ''),
    });
  }
  return salida;
}

export interface ExtrasDeTraduccion {
  /** El nombre del grupo, si el mensaje viene de uno y ya se conoce. */
  nombreGrupo?: string | null;
  /** Es la respuesta del telefono a un reenvio pedido: segunda entrega. */
  reenvio?: boolean;
}

/**
 * Un mensaje de Baileys en la forma que ya entiende `processChange`.
 *
 * Devuelve null para lo que el sistema no trata (propios, estados, canales):
 * traducirlos seria inventar. Los grupos si entran: `from` es el jid del
 * grupo y cada mensaje lleva `grupo` con quien lo escribio.
 */
export function toChangeValue(
  mensaje: unknown,
  telefonoResuelto?: string | null,
  media?: MediaInfo | null,
  extras: ExtrasDeTraduccion = {},
): ChangeValue | null {
  const m = mensaje as {
    key?: {
      id?: string;
      remoteJid?: string;
      remoteJidAlt?: string;
      fromMe?: boolean;
      participant?: string;
      participantAlt?: string;
      isViewOnce?: boolean;
    };
    message?: Record<string, unknown>;
    messageTimestamp?: number | string;
    pushName?: string;
  };

  const id = m.key?.id;
  if (!id || m.key?.fromMe) return null;

  const grupo = esGrupo(m.key?.remoteJid) ? m.key!.remoteJid! : null;
  const from = grupo ?? telefonoDe(m.key) ?? (telefonoResuelto || null);
  if (!from) return null;
  // "0" es WhatsApp mismo (avisos del sistema, verificaciones): no es un
  // cliente y no puede aparecer como contacto "0" en el chat.
  if (from === '0') return null;

  // "Ver una vez", temporales, documento con pie: el mensaje de verdad va
  // dentro de un envoltorio. Se mira dentro; si no, un texto temporal o una
  // foto de ver una vez llegaban como "mensaje de tipo viewoncemessagev2".
  const { contenido, verUnaVez } = desenvolver(m.message);
  const timestamp = String(m.messageTimestamp ?? Math.floor(Date.now() / 1000));

  const base = {
    messaging_product: 'whatsapp',
    contacts: [{ wa_id: from, profile: { name: grupo ? (extras.nombreGrupo ?? '') : (m.pushName ?? '') } }],
  };

  const traducido = traducirContenido(id, from);
  if (!traducido) return null;
  // A que mensaje esta respondiendo el cliente, si esta respondiendo a alguno.
  // Baileys lo deja en `contextInfo.stanzaId`, dentro del contenido; Meta lo
  // manda como `context.id`, y aqui se traduce a esa misma forma.
  const citado = citaDe(contenido);
  const mensajeFinal = { ...traducido, ...(citado ? { context: { id: citado } } : {}), ...(extras.reenvio ? { reenvio: true } : {}) };
  if (grupo) {
    mensajeFinal.grupo = {
      jid: grupo,
      nombre: extras.nombreGrupo ?? null,
      autor: autorDeGrupo(m.key) ?? (telefonoResuelto || null),
      autorNombre: m.pushName ?? '',
    };
  }
  return { ...base, messages: [mensajeFinal] };

  // Lo que hay dentro, ya como mensaje del webhook. Va en una funcion para
  // que el envoltorio de grupo y de reenvio se ponga en un solo sitio.
  function traducirContenido(id: string, from: string): InboundMessage | null {
    // Un "ver una vez" que WhatsApp entrego como sobre vacio: Baileys lo marca
    // en la clave (`isViewOnce`) y no trae contenido. Es el caso normal desde
    // que WhatsApp dejo de mandar estos adjuntos a los dispositivos vinculados.
    if (m.key?.isViewOnce && !Object.keys(contenido).length) {
      return { id, from, timestamp, type: 'view_once', viewOnce: { kind: 'unknown' } };
    }

    // Trafico del protocolo (llaves, acuses, el "placeholder" de un mensaje
    // que no se pudo descifrar todavia): no hay nada que leer, y en el chat
    // salia como "(mensaje de tipo placeholder)" con su globo de no leido.
    // Ojo: en un grupo, el primer mensaje de alguien trae su llave
    // (`senderKeyDistributionMessage`) JUNTO al texto o la foto; la llave
    // sobra, el mensaje no.
    // "Eliminar para todos": el remitente pide borrar un mensaje. Aqui NO se
    // borra nada: se marca el original para que se sepa que lo quiso quitar
    // y se pueda seguir leyendo. Lo demas del protocolo no es un mensaje.
    const protocolo = contenido.protocolMessage as { type?: number | string; key?: { id?: string } } | undefined;
    if (protocolo && (protocolo.type === 0 || protocolo.type === 'REVOKE') && protocolo.key?.id) {
      return { id, from, timestamp, type: 'revoke', revoca: protocolo.key.id };
    }
    if (contenido.protocolMessage || contenido.placeholderMessage) return null;
    if (contenido.senderKeyDistributionMessage && !hayContenidoAparteDeLlaves(contenido)) return null;

    // Una reaccion (el pulgar, el corazon) se ensena, pero no es texto: el bot
    // no tiene que contestar a un emoji sobre un mensaje suyo.
    const reaccion = contenido.reactionMessage as { text?: string; key?: { id?: string } } | undefined;
    if (reaccion) {
      // Sin saber SOBRE QUE mensaje es, una reaccion no se puede pintar en su
      // sitio y acabaria como un globo suelto: mejor ignorarla.
      if (!reaccion.key?.id) return null;
      // Texto vacio = la quito. Antes se descartaba, y el emoji se quedaba
      // pegado para siempre aunque el cliente lo hubiera retirado.
      return { id, from, timestamp, type: 'reaction', reaction: { emoji: reaccion.text ?? '', message_id: reaccion.key.id } };
    }

    const conversation = contenido.conversation as string | undefined;
    const extended = (contenido.extendedTextMessage as { text?: string } | undefined)?.text;
    const texto = conversation ?? extended;

    // Un boton pulsado llega como respuesta interactiva, no como texto. Se
    // traduce a la forma de Meta para que el flujo de confirmacion del bot -que
    // espera `button_reply`- funcione igual venga de donde venga.
    const boton = respuestaDeBoton(contenido);
    if (boton) {
      return {
        id,
        from,
        timestamp,
        type: 'interactive',
        interactive: { type: 'button_reply', button_reply: boton },
      };
    }

    const ubicacion = contenido.locationMessage as
      | { degreesLatitude?: number; degreesLongitude?: number; name?: string; address?: string }
      | undefined;

    if (ubicacion?.degreesLatitude != null && ubicacion.degreesLongitude != null) {
      return {
        id,
        from,
        timestamp,
        type: 'location',
        location: {
          latitude: ubicacion.degreesLatitude,
          longitude: ubicacion.degreesLongitude,
          name: ubicacion.name,
          address: ubicacion.address,
        },
      };
    }

    const anuncio = anuncioDe(contenido);
    if (typeof texto === 'string') {
      return { id, from, timestamp, type: 'text', text: { body: texto }, ...(anuncio ? { anuncio } : {}) };
    }

    // Fotos, audios y documentos: con el fichero ya bajado se pintan en /chat;
    // sin el, al menos se ve que llego algo.
    if (media) {
      return { id, from, timestamp, type: media.kind, media, ...(anuncio ? { anuncio } : {}) };
    }

    // Un "ver una vez" sin fichero. WhatsApp no le da la llave del adjunto a
    // los dispositivos vinculados (WhatsApp Web tampoco lo puede abrir): llega
    // el sobre, a veces vacio del todo. Se guarda diciendo lo que es y donde
    // se puede ver, en vez de descartarlo como si no hubiera llegado nada.
    if (verUnaVez) {
      const adjunto = tipoDeAdjunto(contenido);
      const kind = adjunto && adjunto !== 'sticker' ? adjunto : 'unknown';
      return { id, from, timestamp, type: 'view_once', viewOnce: { kind } };
    }

    // La llave de grupo nunca es "el tipo" del mensaje: si va sola ya se
    // descarto arriba, y si acompana a otra cosa, el tipo es esa otra cosa.
    const tipo = Object.keys(contenido).find((k) => k.endsWith('Message') && k !== 'senderKeyDistributionMessage');
    if (tipo) {
      return { id, from, timestamp, type: tipo.replace('Message', '').toLowerCase() };
    }

  return null;
  }
}


/**
 * Lo que una sesion de WhatsApp sabe hacer. Hay UNA por tienda: cada tienda
 * vincula su propio numero y nada de esto se comparte entre tiendas (ni el
 * socket, ni el QR, ni los nombres de grupo, ni la presencia).
 */
export interface SesionLocal {
  startLocal(opts: StartLocalOptions): Promise<LocalState>;
  getLocalState(): LocalState;
  getLocalSocket(): LocalSocket | null;
  nombreDeGrupo(jid: string | undefined): string | null;
  recordarGrupo(jid: string, nombre: string): void;
  suscribirPresencia(jid: string): Promise<void>;
  presenciaDe(jid: string): PresenciaChat | null;
  proximoHistorial(timeoutMs?: number): Promise<number | null>;
  pedirHistorial(jid: string, ancla: { id: string; fromMe: boolean; timestampMs: number }, cantidad?: number): Promise<string>;
  requestLocalPairingCode(phone: string): Promise<string>;
  logoutLocal(authDir: string): Promise<void>;
  /**
   * Cierra el socket SIN desvincular (la vinculacion se queda en su carpeta)
   * y sin reintentos: es lo que se hace al parar una tienda.
   */
  detener(): void;
  resetLocalForTests(): void;
}

/**
 * Una sesion nueva, con su propia memoria. La plataforma crea una por tienda
 * (ver src/plataforma); el arranque de una sola tienda usa la de por defecto.
 */
export function crearSesionLocal(): SesionLocal {
  const estado: LocalState = {
    status: 'STOPPED',
    qr: null,
    pairingCode: null,
    phone: '',
    name: '',
    detail: 'Sin conectar.',
  };

  let socket: LocalSocket | null = null;
  let arrancando: Promise<LocalState> | null = null;
  let opciones: StartLocalOptions | null = null;

  /**
   * Nombre de cada grupo, por jid. Un mensaje de grupo no trae el nombre del
   * grupo (solo el `pushName` de quien escribe), y sin esto el chat lo
   * ensenaria como "120363412332267099@g.us".
   */
  const nombresDeGrupo = new Map<string, string>();

  function nombreDeGrupo(jid: string | undefined): string | null {
    if (!jid) return null;
    return nombresDeGrupo.get(jid) ?? null;
  }

  /** Solo para las pruebas y para la carga inicial. */
  function recordarGrupo(jid: string, nombre: string): void {
    if (jid && nombre) nombresDeGrupo.set(jid, nombre);
  }

  function resumirGrupo(jid: string, meta: GrupoMetadata | undefined): GrupoResumen {
    const nombre = meta?.subject?.trim() || nombreDeGrupo(jid) || jid.replace(/@g\.us$/, '');
    return { jid, nombre, participantes: Array.isArray(meta?.participants) ? meta!.participants!.length : 0 };
  }

  /**
   * Trae los grupos del numero y se los entrega al sistema.
   *
   * Se hace al conectar y en segundo plano: que WhatsApp tarde en contestar, o
   * que falle, no puede retrasar ni tumbar la conexion.
   */
  async function cargarGrupos(sock: LocalSocket, opts: StartLocalOptions, log: (m: string) => void): Promise<void> {
    if (!sock.groupFetchAllParticipating) return;
    try {
      const todos = await sock.groupFetchAllParticipating();
      const lista = Object.entries(todos ?? {})
        .filter(([jid]) => esGrupo(jid))
        .map(([jid, meta]) => resumirGrupo(jid, meta));
      for (const g of lista) recordarGrupo(g.jid, g.nombre);
      log(`grupos del numero: ${lista.length}`);
      if (lista.length) await opts.onGrupos?.(lista);
    } catch (error) {
      log(`no se pudieron traer los grupos: ${String(error)}`);
    }
  }

  /** Presencia por jid. En memoria a proposito: caduca con la sesion. */
  const presencias = new Map<string, PresenciaChat>();


  /**
   * Se suscribe a la presencia de un chat. Sin esto WhatsApp no manda nada de
   * ese contacto, por mucho que la sesion este abierta.
   */
  async function suscribirPresencia(jid: string): Promise<void> {
    const sock = getLocalSocket();
    if (!sock?.presenceSubscribe) return;
    await sock.presenceSubscribe(jid).catch(() => undefined);
  }

  /**
   * La presencia de un chat, o null si no se sabe.
   *
   * `null` no es "esta desconectado": es "no hay dato". La pantalla no inventa
   * nada con un null, que es justo lo que hay que hacer con la privacidad ajena.
   */
  function presenciaDe(jid: string): PresenciaChat | null {
    const p = presencias.get(jid);
    if (!p) return null;
    // "Escribiendo" caduca; "en linea" y la ultima vez siguen valiendo.
    if ((p.estado === 'escribiendo' || p.estado === 'grabando') && Date.now() - p.desde > PRESENCIA_VIVA_MS) {
      return { ...p, estado: 'en_linea' };
    }
    return p;
  }

  function getLocalState(): LocalState {
    return { ...estado };
  }

  /** El socket vivo, o null. Lo usa el cliente para enviar. */
  function getLocalSocket(): LocalSocket | null {
    return estado.status === 'WORKING' ? socket : null;
  }

  /**
   * Deja la sesion arrancada y devuelve el estado en cuanto se sabe algo util:
   * o el QR listo para escanear, o la conexion ya hecha.
   *
   * Es idempotente: llamar dos veces no abre dos sockets, porque dos sesiones
   * con las mismas credenciales se echan la una a la otra.
   */
  async function startLocal(opts: StartLocalOptions): Promise<LocalState> {
    opciones = opts;
    if (estado.status === 'WORKING' && socket) return getLocalState();
    if (arrancando) return arrancando;

    arrancando = abrir(opts).finally(() => {
      arrancando = null;
    });
    return arrancando;
  }

  async function abrir(opts: StartLocalOptions): Promise<LocalState> {
    const log = opts.log ?? (() => {});
    mkdirSync(opts.authDir, { recursive: true });

    estado.status = 'STARTING';
    estado.detail = 'Abriendo la sesion...';
    estado.qr = null;
    estado.pairingCode = null;

    const crear = opts.createSocket ?? baileysSocket;
    const { sock, saveCreds } = await crear({ authDir: opts.authDir });
    socket = sock;

    // La promesa se resuelve en cuanto hay algo que enseñar: el QR o la
    // conexion. No se espera a WORKING porque escanear lo hace una persona.
    return new Promise<LocalState>((resolve) => {
      let resuelta = false;
      const listo = () => {
        if (resuelta) return;
        resuelta = true;
        resolve(getLocalState());
      };

      sock.ev.on('creds.update', ((() => {
        // Un socket ya cerrado no guarda nada: si se acaba de borrar la
        // vinculacion por un 401, lo ultimo que hace falta es que un acuse
        // tardio la vuelva a escribir con las mismas credenciales muertas.
        if (socket !== sock) return;
        // La carpeta puede haber desaparecido (un logout la borra): se vuelve a
        // crear. Y un fallo al escribir se apunta, no revienta el servidor:
        // era una promesa suelta y un ENOENT tumbo todo el sistema.
        try {
          mkdirSync(opts.authDir, { recursive: true });
        } catch {
          // Si ni siquiera se puede crear, lo dira el fallo de abajo.
        }
        saveCreds().catch((error: unknown) => log(`no se pudo guardar la vinculacion: ${String(error)}`));
      }) as unknown) as (arg: never) => void);

      sock.ev.on('connection.update', (((update: {
        connection?: string;
        qr?: string;
        lastDisconnect?: { error?: { output?: { statusCode?: number }; message?: string } };
      }) => {
        void (async () => {
          if (update.qr) {
            estado.status = 'SCAN_QR_CODE';
            estado.detail = 'Escanea el codigo desde el telefono.';
            // toDataURL trae el prefijo "data:image/png;base64,"; la pantalla ya
            // lo pone, asi que aqui se guarda solo el base64.
            const dataUrl = await QRCode.toDataURL(update.qr, { margin: 1, width: 512 });
            estado.qr = dataUrl.split(',')[1] ?? null;
            listo();
          }

          if (update.connection === 'open') {
            estado.status = 'WORKING';
            estado.qr = null;
            estado.pairingCode = null;
            estado.phone = fromJid(sock.user?.id ?? '');
            estado.name = sock.user?.name ?? '';
            estado.detail = 'Conectado.';
            log(`WhatsApp conectado: ${estado.phone}`);
            listo();
            void cargarGrupos(sock, opts, log);
          }

          if (update.connection === 'close') {
            const code = update.lastDisconnect?.error?.output?.statusCode;
            const explicacion = explicarCierre(code);
            // Un socket viejo que se cierra tarde (el de un logout, mientras ya
            // hay otro escaneando el QR) no puede borrar la vinculacion nueva
            // ni cambiar el estado: eso es justo lo que tumbo el servidor.
            if (socket !== sock) {
              log(`cierre tardio de una sesion anterior (${code ?? 'sin codigo'}): se ignora`);
              listo();
              return;
            }
            try {
              opts.onDisconnect?.(code, update.lastDisconnect?.error?.message ?? explicacion);
            } catch {
              // El aviso no puede tumbar la reconexion.
            }
            // 401 es "te desvincularon desde el telefono": no sirve reintentar,
            // hay que escanear otra vez. 403 es que WhatsApp no quiere esta
            // sesion -casi siempre un baneo-, y reintentar en bucle es lo peor
            // que se puede hacer. Cualquier otro corte es de red.
            if (code === 401 || code === 403 || code === 411 || code === 500) {
              estado.status = 'STOPPED';
              estado.detail = explicacion;
              socket = null;
              log(`WhatsApp desconectado (${code}): ${explicacion}`);
              // Con la vinculacion muerta (el telefono la cerro, o esta
              // corrupta) las credenciales guardadas ya no valen para nada y,
              // peor, mientras existan cada "conectar" las reutiliza: WhatsApp
              // las rechaza otra vez, la sesion vuelve a "parada" y el QR no
              // sale nunca. Se borran para que el siguiente arranque empiece
              // de cero, con su codigo. Un 403 no las toca: ahi el problema no
              // es la vinculacion, es el numero.
              if (vinculacionMuerta(code)) {
                await rm(opts.authDir, { recursive: true, force: true }).catch((error: unknown) =>
                  log(`no se pudo borrar la vinculacion vieja: ${String(error)}`),
                );
                log('vinculacion borrada: al conectar saldra un QR nuevo');
              }
            } else {
              estado.status = 'FAILED';
              estado.detail = update.lastDisconnect?.error?.message ?? 'Se corto la conexion.';
              log(`WhatsApp desconectado (${code ?? 'sin codigo'}), reintentando...`);
              socket = null;
              // Reintento suelto: el telefono se queda sin cobertura mas a
              // menudo de lo que uno cree y no hay que perder la vinculacion.
              setTimeout(() => {
                if (opciones && estado.status === 'FAILED') void startLocal(opciones).catch(() => {});
              }, 4000);
            }
            listo();
          }
        })().catch(() => {
          estado.status = 'FAILED';
          estado.detail = 'Fallo abriendo la sesion.';
          listo();
        });
      }) as unknown) as (arg: never) => void);

      /**
       * Presencia del otro lado: "escribiendo...", "en linea", "ult. vez".
       *
       * WhatsApp solo la manda de los chats a los que te has suscrito y mientras
       * dure la sesion, asi que se guarda en memoria y caduca sola: un dato de
       * presencia de hace media hora no dice nada y ensenarlo es mentir.
       */
      sock.ev.on('presence.update', (((evento: { id?: string; presences?: Record<string, { lastKnownPresence?: string; lastSeen?: number }> }) => {
        const jid = evento?.id;
        if (!jid || !evento.presences) return;
        for (const datos of Object.values(evento.presences)) {
          const bruto = datos?.lastKnownPresence;
          if (!bruto) continue;
          const estado: PresenciaChat['estado'] =
            bruto === 'composing' ? 'escribiendo'
            : bruto === 'recording' ? 'grabando'
            : bruto === 'available' ? 'en_linea'
            : 'desconectado';
          presencias.set(jid, { estado, desde: Date.now(), ultimaVez: datos.lastSeen ? datos.lastSeen * 1000 : null });
        }
      }) as unknown) as (arg: never) => void);

      // Un grupo nuevo (te agregaron, lo creaste) o un cambio de nombre: se
      // apunta para que el chat lo ensene con su nombre y no con el jid.
      const grupoCambiado = (lista: unknown[]) => {
        const resumen: GrupoResumen[] = [];
        for (const item of lista ?? []) {
          const g = item as GrupoMetadata & { id?: string };
          if (!g?.id || !esGrupo(g.id)) continue;
          // En `groups.update` solo viene lo que cambio: sin `subject` no hay
          // nada que apuntar.
          if (!g.subject?.trim()) continue;
          const r = resumirGrupo(g.id, g);
          recordarGrupo(r.jid, r.nombre);
          resumen.push(r);
        }
        if (resumen.length) {
          void Promise.resolve(opts.onGrupos?.(resumen)).catch((error: unknown) => log(`fallo apuntando un grupo: ${String(error)}`));
        }
      };
      sock.ev.on('groups.upsert', ((lista: unknown[]) => grupoCambiado(lista)) as unknown as (arg: never) => void);
      sock.ev.on('groups.update', ((lista: unknown[]) => grupoCambiado(lista)) as unknown as (arg: never) => void);

      // Los acuses de los mensajes propios: entregado, leido, fallido. Sin
      // esto el doble check del chat no se movia y, peor, el monitor de salud
      // veia que nada de lo enviado constaba entregado y frenaba el numero por
      // una senal que no existia.
      sock.ev.on('messages.update', (((updates: unknown[]) => {
        if (!opts.onChange) return;
        const statuses = acksToStatuses(updates);
        if (!statuses.length) return;
        void Promise.resolve(opts.onChange({ statuses })).catch((error: unknown) =>
          log(`fallo leyendo un acuse: ${String(error)}`),
        );
      }) as unknown) as (arg: never) => void);

      /** Un entrante, venga del evento de Baileys o del sobre crudo. */
      const procesarEntrante = async (
        mensaje: unknown,
        tipoEvento: string | undefined,
        reenvio: boolean,
        origen: 'upsert' | 'sobre' | 'historial',
      ): Promise<void> => {
        const key = (mensaje as { key?: { id?: string; remoteJid?: string; fromMe?: boolean; isViewOnce?: boolean } }).key;
        if (key?.fromMe) {
          await procesarPropio(mensaje, origen === 'historial' ? 'historial' : 'upsert');
          return;
        }
        // El sobre de un "ver una vez" ya se atendio desde el gancho crudo (ver
        // `escucharSobres`): Baileys lo vuelve a emitir cuando trae la marca.
        if (origen === 'upsert' && key?.isViewOnce && key.id && sobresAtendidos.has(key.id) && !reenvio) return;

        const media = await bajarAdjunto(mensaje, key?.id ?? '', opts, log, sock, { resubida: origen !== 'historial' });
        const telefono = await resolverTelefono(sock, key);
        // Un grupo del que no se sabia el nombre todavia: se pregunta una
        // vez y se recuerda.
        if (esGrupo(key?.remoteJid) && !nombreDeGrupo(key?.remoteJid)) await aprenderNombreDeGrupo(sock, key!.remoteJid!, opts, log);
        const value = toChangeValue(mensaje, telefono, media, {
          nombreGrupo: nombreDeGrupo(key?.remoteJid),
          // Baileys pone `requestId` cuando el mensaje es la respuesta del
          // telefono a un reenvio que se le pidio: es la segunda entrega.
          reenvio,
        });
        if (!value) {
          log(`entrante descartado (${tipoEvento ?? 'sin tipo'}): ${key?.remoteJid ?? 'sin jid'} — ${porQueSeDescarta(mensaje, telefono)}`);
          return;
        }

        // Lo que no llega en vivo (historial, cola de cuando el sistema
        // estaba apagado) se guarda pero no se contesta. Ver `esMensajeViejo`.
        const m = value.messages?.[0];
        if (m && origen === 'historial') m.historial = true;
        if (m && esMensajeViejo(tipoEvento, m.timestamp)) {
          m.viejo = true;
          log(`entrante ${m.type} de ${m.from} (${tipoEvento ?? 'sin tipo'}, viejo): se guarda sin contestar`);
        } else {
          log(`entrante ${m?.type ?? '?'} de ${m?.from ?? '?'}${m?.reenvio ? ' (reenviado por el telefono, ya con el fichero)' : ''}`);
        }
        // El sobre vacio de un "ver una vez": se le pide al telefono que lo
        // reenvie ANTES de entregar el mensaje, para que la espera del
        // manejador (que mira si llego el fichero) tenga algo que esperar.
        if (m?.type === 'view_once' && !m.reenvio) pedirReenvio(sock, mensaje, log);
        await opts.onChange?.(value);
      };

      /**
       * Un mensaje propio (mandado desde el telefono): se traduce como si
       * fuera entrante -es la misma forma- y se entrega como saliente.
       */
      const procesarPropio = async (mensaje: unknown, origen: 'upsert' | 'historial' = 'upsert'): Promise<void> => {
        if (!opts.onPropio) return;
        const m = mensaje as { key?: { id?: string; remoteJid?: string; isViewOnce?: boolean }; status?: unknown };
        const jid = m.key?.remoteJid ?? '';
        if (!m.key?.id || !jid || /@(broadcast|newsletter)$/.test(jid) || m.key.isViewOnce) return;
        const media = await bajarAdjunto(mensaje, m.key.id, opts, log, sock, { resubida: origen !== 'historial' });
        const telefono = await resolverTelefono(sock, m.key);
        if (esGrupo(jid) && !nombreDeGrupo(jid)) await aprenderNombreDeGrupo(sock, jid, opts, log);
        const value = toChangeValue({ ...(mensaje as object), key: { ...m.key, fromMe: false } }, telefono, media, { nombreGrupo: nombreDeGrupo(jid) });
        const traducido = value?.messages?.[0];
        if (!traducido) return;
        if (origen === 'historial') traducido.historial = true;
        // Borrar para todos un mensaje propio: se marca igual que el de un cliente.
        if (traducido.type === 'revoke' && value) {
          await opts.onChange?.(value);
          return;
        }
        // Lo que no se ensena de uno mismo: reacciones, botones, avisos.
        if (!PROPIOS_QUE_SE_GUARDAN.has(traducido.type)) return;
        await opts.onPropio({ mensaje: traducido, status: ackToStatus(m.status) });
      };

      // El historial: al vincular, WhatsApp manda las conversaciones recientes
      // (y bajo demanda, las anteriores de un chat). Entra por aqui, no por
      // `messages.upsert`; sin esto el chat empezaba vacio.
      sock.ev.on('messaging-history.set', (((historial: { messages?: unknown[]; syncType?: unknown; progress?: unknown }) => {
        if (!opts.onChange) return;
        const lista = historial.messages ?? [];
        log(`historial del telefono: ${lista.length} mensajes (tipo ${String(historial.syncType ?? '?')}${historial.progress != null ? `, ${String(historial.progress)}%` : ''})`);
        trozosEnProceso += 1;
        // HistorySyncType: 0 INITIAL_BOOTSTRAP, 3 RECENT (por trozos, con
        // `progress`), 6 ON_DEMAND. El ultimo trozo del RECENT marca el final
        // de la sincronizacion inicial, pero los trozos se guardan en paralelo:
        // se avisa cuando TODOS terminaron, no cuando llega el ultimo.
        if (Number(historial.syncType) === 3 && Number(historial.progress) >= 100) finDeSincronizacionPendiente = true;
        void (async () => {
          for (const mensaje of lista) {
            try {
              await procesarEntrante(mensaje, 'append', false, 'historial');
            } catch (error) {
              log(`fallo guardando un mensaje del historial: ${String(error)}`);
            }
          }
          // Se avisa DESPUES de guardar: quien espera va a mirar la base.
          const avisar = esperasHistorial;
          esperasHistorial = [];
          for (const f of avisar) f(lista.length);
          trozosEnProceso -= 1;
          if (finDeSincronizacionPendiente && trozosEnProceso === 0) {
            finDeSincronizacionPendiente = false;
            log('sincronizacion inicial completa: todos los chats tienen ya su referencia');
            await Promise.resolve(opts.onSincronizacionInicial?.()).catch((error: unknown) => log(`fallo tras la sincronizacion inicial: ${String(error)}`));
          }
        })();
      }) as unknown) as (arg: never) => void);

      sock.ev.on('messages.upsert', (((evento: { messages?: unknown[]; type?: string; requestId?: string }) => {
        if (!opts.onChange) return;
        void (async () => {
          for (const mensaje of evento.messages ?? []) {
            await procesarEntrante(mensaje, evento.type, Boolean(evento.requestId), 'upsert');
          }
        })().catch((error: unknown) => log(`fallo leyendo un entrante: ${String(error)}`));
      }) as unknown) as (arg: never) => void);

      // Los sobres de "ver una vez" que Baileys tira antes de avisar.
      escucharSobres(sock, (mensaje, tipoEvento) => procesarEntrante(mensaje, tipoEvento, false, 'sobre'), log, sobresAtendidos);

      // Si el socket ya venia vinculado no llega ningun QR: se le da un margen
      // corto para que diga "open" y, si no, se contesta con lo que haya.
      setTimeout(listo, 8000);
    });
  }

  /** El nombre de un grupo que se ve por primera vez: se pregunta y se apunta. */
  async function aprenderNombreDeGrupo(sock: LocalSocket, jid: string, opts: StartLocalOptions, log: (m: string) => void): Promise<void> {
    if (!sock.groupMetadata) return;
    try {
      const meta = await sock.groupMetadata(jid);
      const r = resumirGrupo(jid, meta);
      recordarGrupo(r.jid, r.nombre);
      await opts.onGrupos?.([r]);
    } catch (error) {
      log(`no se pudo leer el nombre del grupo ${jid}: ${String(error)}`);
    }
  }


  /** Ids de los sobres de "ver una vez" ya atendidos por el gancho crudo. */
  const sobresAtendidos = new Set<string>();

  /** Trozos del historial que todavia se estan guardando, y si ya llego el ultimo. */
  let trozosEnProceso = 0;
  let finDeSincronizacionPendiente = false;

  /** Quien espera el proximo lote de historial del telefono (ver `proximoHistorial`). */
  let esperasHistorial: Array<(n: number) => void> = [];

  /**
   * Se resuelve con el tamano del proximo lote de historial que mande el
   * telefono, o null si no llega en `timeoutMs`. Es lo que permite pedir
   * "lo anterior" una y otra vez sin pisar la peticion anterior.
   */
  function proximoHistorial(timeoutMs = 20_000): Promise<number | null> {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        esperasHistorial = esperasHistorial.filter((f) => f !== listo);
        resolve(null);
      }, timeoutMs);
      const listo = (n: number) => {
        clearTimeout(t);
        resolve(n);
      };
      esperasHistorial.push(listo);
    });
  }


  /**
   * Le pide al telefono los mensajes anteriores de un chat.
   *
   * Hace falta un mensaje ancla (el mas viejo que se tiene): el telefono manda
   * los `cantidad` anteriores a el por `messaging-history.set`. Devuelve el id
   * de la peticion; lo que llegue entra solo por el mismo camino que el resto.
   */
  async function pedirHistorial(
    jid: string,
    ancla: { id: string; fromMe: boolean; timestampMs: number },
    cantidad = 50,
  ): Promise<string> {
    const sock = getLocalSocket();
    if (!sock) throw new Error('WhatsApp no esta conectado.');
    if (!sock.fetchMessageHistory) throw new Error('Esta version del cliente no sabe pedir el historial.');
    return sock.fetchMessageHistory(cantidad, { remoteJid: jid, fromMe: ancla.fromMe, id: ancla.id }, ancla.timestampMs);
  }

  /** Vincular con numero en vez de con la camara. */
  async function requestLocalPairingCode(phone: string): Promise<string> {
    const digitos = phone.replace(/\D+/g, '');
    if (!digitos) throw new Error('falta el numero de telefono');
    if (!socket) throw new Error('la sesion no esta abierta todavia');

    const code = await socket.requestPairingCode(digitos);
    estado.pairingCode = code;
    estado.detail = 'Teclea el codigo en el telefono.';
    return code;
  }

  /** Cierra la sesion y borra la vinculacion: obliga a escanear otro QR. */
  async function logoutLocal(authDir: string): Promise<void> {
    const viejo = socket;
    // Se suelta primero: asi el "close" que provoca el logout ya no es el del
    // socket vigente y no borra nada por su cuenta (ver connection.update).
    socket = null;
    try {
      await viejo?.logout();
    } catch {
      // Si el telefono ya la cerro, logout falla y da igual: lo que importa es
      // borrar las credenciales de aqui.
    }
    try {
      viejo?.end();
    } catch {
      // Un socket ya cerrado puede quejarse al cerrarlo otra vez.
    }
    await rm(authDir, { recursive: true, force: true });
    estado.status = 'STOPPED';
    estado.qr = null;
    estado.pairingCode = null;
    estado.phone = '';
    estado.name = '';
    estado.detail = 'Sesion cerrada.';
  }

  /** Solo para las pruebas: deja el modulo como recien cargado. */
  function resetLocalForTests(): void {
    socket = null;
    arrancando = null;
    opciones = null;
    nombresDeGrupo.clear();
    sobresAtendidos.clear();
    Object.assign(estado, {
      status: 'STOPPED',
      qr: null,
      pairingCode: null,
      phone: '',
      name: '',
      detail: 'Sin conectar.',
    });
  }

  function detener(): void {
    // Sin opciones no hay reintento (ver el "close" de connection.update), y
    // con el socket soltado su cierre llega como "tardio" y no toca nada.
    opciones = null;
    const viejo = socket;
    socket = null;
    estado.status = 'STOPPED';
    estado.qr = null;
    estado.pairingCode = null;
    estado.detail = 'Sesion detenida.';
    try {
      viejo?.end();
    } catch {
      // ya estaba cerrado
    }
  }

  return {
    detener,
    startLocal,
    getLocalState,
    getLocalSocket,
    nombreDeGrupo,
    recordarGrupo,
    suscribirPresencia,
    presenciaDe,
    proximoHistorial,
    pedirHistorial,
    requestLocalPairingCode,
    logoutLocal,
    resetLocalForTests,
  };
}


/**
 * La sesion de por defecto: la de una instalacion con una sola tienda, y la
 * que usan las pruebas de siempre. Las funciones sueltas de abajo son suyas.
 */
export const sesionLocalPorDefecto: SesionLocal = crearSesionLocal();
export const startLocal = (opts: StartLocalOptions): Promise<LocalState> => sesionLocalPorDefecto.startLocal(opts);
export const getLocalState = (): LocalState => sesionLocalPorDefecto.getLocalState();
export const getLocalSocket = (): LocalSocket | null => sesionLocalPorDefecto.getLocalSocket();
export const nombreDeGrupo = (jid: string | undefined): string | null => sesionLocalPorDefecto.nombreDeGrupo(jid);
export const recordarGrupo = (jid: string, nombre: string): void => sesionLocalPorDefecto.recordarGrupo(jid, nombre);
export const suscribirPresencia = (jid: string): Promise<void> => sesionLocalPorDefecto.suscribirPresencia(jid);
export const presenciaDe = (jid: string): PresenciaChat | null => sesionLocalPorDefecto.presenciaDe(jid);
export const proximoHistorial = (timeoutMs?: number): Promise<number | null> => sesionLocalPorDefecto.proximoHistorial(timeoutMs);
export const pedirHistorial = (jid: string, ancla: { id: string; fromMe: boolean; timestampMs: number }, cantidad?: number): Promise<string> =>
  sesionLocalPorDefecto.pedirHistorial(jid, ancla, cantidad);
export const requestLocalPairingCode = (phone: string): Promise<string> => sesionLocalPorDefecto.requestLocalPairingCode(phone);
export const logoutLocal = (authDir: string): Promise<void> => sesionLocalPorDefecto.logoutLocal(authDir);
export const resetLocalForTests = (): void => sesionLocalPorDefecto.resetLocalForTests();
