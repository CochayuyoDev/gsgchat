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

import { mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import QRCode from 'qrcode';
import type { ChangeValue } from '../types.js';
import { guardarMedia, mediaDirectory, tipoDeAdjunto, type MediaInfo } from './media.js';

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
  sendMessage(jid: string, content: unknown): Promise<{ key?: { id?: string } } | undefined>;
  readMessages(keys: unknown[]): Promise<void>;
  requestPairingCode(phone: string): Promise<string>;
  logout(): Promise<void>;
  end(error?: Error): void;
  ev: { on(evento: string, handler: (arg: never) => void): void };
  user?: { id?: string; name?: string };
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
}

/** Que significa cada codigo de cierre de Baileys, en cristiano. */
export function explicarCierre(code: number | undefined): string {
  switch (code) {
    case 401:
      return 'La sesion se cerro desde el telefono. Vuelve a escanear.';
    case 403:
      return 'WhatsApp rechazo la sesion (403). Suele ser un baneo del numero: no se reintenta solo.';
    case 408:
      return 'Tiempo de espera agotado; se reintenta.';
    case 411:
      return 'Conflicto multidispositivo; hay que volver a vincular.';
    case 428:
      return 'La conexion se cerro; se reintenta.';
    case 440:
      return 'Otra sesion con las mismas credenciales tomo el sitio.';
    case 500:
      return 'Sesion corrupta; hay que volver a vincular.';
    case 503:
      return 'Servicio no disponible; se reintenta.';
    case 515:
      return 'WhatsApp pidio reiniciar la conexion; se reintenta.';
    default:
      return 'Se corto la conexion.';
  }
}

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

export function getLocalState(): LocalState {
  return { ...estado };
}

/** El socket vivo, o null. Lo usa el cliente para enviar. */
export function getLocalSocket(): LocalSocket | null {
  return estado.status === 'WORKING' ? socket : null;
}

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
 * Deja la sesion arrancada y devuelve el estado en cuanto se sabe algo util:
 * o el QR listo para escanear, o la conexion ya hecha.
 *
 * Es idempotente: llamar dos veces no abre dos sockets, porque dos sesiones
 * con las mismas credenciales se echan la una a la otra.
 */
export async function startLocal(opts: StartLocalOptions): Promise<LocalState> {
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
      void saveCreds();
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
        }

        if (update.connection === 'close') {
          const code = update.lastDisconnect?.error?.output?.statusCode;
          const explicacion = explicarCierre(code);
          try {
            opts.onDisconnect?.(code, update.lastDisconnect?.error?.message ?? explicacion);
          } catch {
            // El aviso no puede tumbar la reconexion.
          }
          // 401 es "te desvincularon desde el telefono": no sirve reintentar,
          // hay que escanear otra vez. 403 es que WhatsApp no quiere esta
          // sesion -casi siempre un baneo-, y reintentar en bucle es lo peor
          // que se puede hacer. Cualquier otro corte es de red.
          if (code === 401 || code === 403) {
            estado.status = 'STOPPED';
            estado.detail = explicacion;
            socket = null;
            log(`WhatsApp desconectado (${code}): ${explicacion}`);
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

    sock.ev.on('messages.upsert', (((evento: { messages?: unknown[]; type?: string }) => {
      if (!opts.onChange) return;
      void (async () => {
        for (const mensaje of evento.messages ?? []) {
          const key = (mensaje as { key?: { id?: string; remoteJid?: string; fromMe?: boolean } })
            .key;
          if (key?.fromMe) continue;

          const media = await bajarAdjunto(mensaje, key?.id ?? '', opts, log);
          const value = toChangeValue(mensaje, await resolverTelefono(sock, key), media);
          if (!value) {
            log(
              `entrante descartado (${evento.type ?? 'sin tipo'}): ${key?.remoteJid ?? 'sin jid'}`,
            );
            continue;
          }

          // Lo que no llega en vivo (historial, cola de cuando el sistema
          // estaba apagado) se guarda pero no se contesta. Ver `esMensajeViejo`.
          const m = value.messages?.[0];
          if (m && esMensajeViejo(evento.type, m.timestamp)) {
            m.viejo = true;
            log(`entrante ${m.type} de ${m.from} (${evento.type ?? 'sin tipo'}, viejo): se guarda sin contestar`);
          } else {
            log(`entrante ${m?.type ?? '?'} de ${m?.from ?? '?'}`);
          }
          await opts.onChange?.(value);
        }
      })().catch((error: unknown) => log(`fallo leyendo un entrante: ${String(error)}`));
    }) as unknown) as (arg: never) => void);

    // Si el socket ya venia vinculado no llega ningun QR: se le da un margen
    // corto para que diga "open" y, si no, se contesta con lo que haya.
    setTimeout(listo, 8000);
  });
}

/**
 * El telefono de quien escribe, resolviendo el LID si hace falta.
 *
 * Se pregunta al almacen de Baileys solo cuando el mensaje no trae ningun
 * `@s.whatsapp.net`, que es el caso que dejaba los entrantes invisibles.
 */
async function resolverTelefono(
  sock: LocalSocket,
  key: { remoteJid?: string; remoteJidAlt?: string } | undefined,
): Promise<string | null> {
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

/** Vincular con numero en vez de con la camara. */
export async function requestLocalPairingCode(phone: string): Promise<string> {
  const digitos = phone.replace(/\D+/g, '');
  if (!digitos) throw new Error('falta el numero de telefono');
  if (!socket) throw new Error('la sesion no esta abierta todavia');

  const code = await socket.requestPairingCode(digitos);
  estado.pairingCode = code;
  estado.detail = 'Teclea el codigo en el telefono.';
  return code;
}

/** Cierra la sesion y borra la vinculacion: obliga a escanear otro QR. */
export async function logoutLocal(authDir: string): Promise<void> {
  try {
    await socket?.logout();
  } catch {
    // Si el telefono ya la cerro, logout falla y da igual: lo que importa es
    // borrar las credenciales de aqui.
  }
  socket?.end();
  socket = null;
  await rm(authDir, { recursive: true, force: true });
  estado.status = 'STOPPED';
  estado.qr = null;
  estado.pairingCode = null;
  estado.phone = '';
  estado.name = '';
  estado.detail = 'Sesion cerrada.';
}

/** Solo para las pruebas: deja el modulo como recien cargado. */
export function resetLocalForTests(): void {
  socket = null;
  arrancando = null;
  opciones = null;
  Object.assign(estado, {
    status: 'STOPPED',
    qr: null,
    pairingCode: null,
    phone: '',
    name: '',
    detail: 'Sin conectar.',
  });
}

/** Donde se guarda la vinculacion por defecto. */
export function defaultAuthDir(base = process.cwd()): string {
  return join(base, '.wa-auth');
}

/**
 * Baja el adjunto del mensaje, si lo tiene.
 *
 * Nunca lanza: si la descarga falla -el enlace de WhatsApp caduca, o se corta
 * la red- el mensaje tiene que llegar al chat igual, aunque sea sin el
 * fichero. Perder la foto es molesto; perder el mensaje entero es un fallo.
 */
async function bajarAdjunto(
  mensaje: unknown,
  wamid: string,
  opts: StartLocalOptions,
  log: (mensaje: string) => void,
): Promise<MediaInfo | null> {
  const contenido = (mensaje as { message?: Record<string, unknown> }).message ?? {};
  if (!tipoDeAdjunto(contenido) || !wamid) return null;

  try {
    const baileys = await import('@whiskeysockets/baileys');
    return await guardarMedia(mensaje, wamid, {
      dir: opts.mediaDir ?? mediaDirectory(),
      descargar: async (m) =>
        (await baileys.downloadMediaMessage(m as never, 'buffer', {})) as Buffer,
    });
  } catch (error) {
    log(`no se pudo bajar el adjunto: ${String(error)}`);
    return null;
  }
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

/**
 * Un mensaje de Baileys en la forma que ya entiende `processChange`.
 *
 * Devuelve null para lo que el sistema no trata (propios, grupos, reacciones):
 * traducirlos seria inventar.
 */
export function toChangeValue(
  mensaje: unknown,
  telefonoResuelto?: string | null,
  media?: MediaInfo | null,
): ChangeValue | null {
  const m = mensaje as {
    key?: { id?: string; remoteJid?: string; remoteJidAlt?: string; fromMe?: boolean };
    message?: Record<string, unknown>;
    messageTimestamp?: number | string;
    pushName?: string;
  };

  const id = m.key?.id;
  if (!id || m.key?.fromMe) return null;

  const from = telefonoDe(m.key) ?? (telefonoResuelto || null);
  if (!from) return null;

  const contenido = m.message ?? {};
  const timestamp = String(m.messageTimestamp ?? Math.floor(Date.now() / 1000));

  const base = {
    messaging_product: 'whatsapp',
    contacts: [{ wa_id: from, profile: { name: m.pushName ?? '' } }],
  };

  const conversation = contenido.conversation as string | undefined;
  const extended = (contenido.extendedTextMessage as { text?: string } | undefined)?.text;
  const texto = conversation ?? extended;

  // Un boton pulsado llega como respuesta interactiva, no como texto. Se
  // traduce a la forma de Meta para que el flujo de confirmacion del bot -que
  // espera `button_reply`- funcione igual venga de donde venga.
  const boton = respuestaDeBoton(contenido);
  if (boton) {
    return {
      ...base,
      messages: [
        {
          id,
          from,
          timestamp,
          type: 'interactive',
          interactive: { type: 'button_reply', button_reply: boton },
        },
      ],
    };
  }

  const ubicacion = contenido.locationMessage as
    | { degreesLatitude?: number; degreesLongitude?: number; name?: string; address?: string }
    | undefined;

  if (ubicacion?.degreesLatitude != null && ubicacion.degreesLongitude != null) {
    return {
      ...base,
      messages: [
        {
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
        },
      ],
    };
  }

  if (typeof texto === 'string') {
    return { ...base, messages: [{ id, from, timestamp, type: 'text', text: { body: texto } }] };
  }

  // Fotos, audios y documentos: con el fichero ya bajado se pintan en /chat;
  // sin el, al menos se ve que llego algo.
  if (media) {
    return { ...base, messages: [{ id, from, timestamp, type: media.kind, media }] };
  }

  const tipo = Object.keys(contenido).find((k) => k.endsWith('Message'));
  if (tipo) {
    return {
      ...base,
      messages: [{ id, from, timestamp, type: tipo.replace('Message', '').toLowerCase() }],
    };
  }

  return null;
}
