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
}

export interface StartLocalOptions {
  /** Carpeta donde se guarda la vinculacion. Sobrevive a los reinicios. */
  authDir: string;
  /** A donde van los mensajes entrantes ya traducidos. */
  onChange?: (value: ChangeValue) => Promise<void> | void;
  /** Inyectable para las pruebas: por defecto, Baileys de verdad. */
  createSocket?: (deps: { authDir: string }) => Promise<{
    sock: LocalSocket;
    saveCreds: () => Promise<void>;
  }>;
  log?: (mensaje: string) => void;
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
          // 401 es "te desvincularon desde el telefono": no sirve reintentar,
          // hay que escanear otra vez. Cualquier otro corte es de red.
          if (code === 401) {
            estado.status = 'STOPPED';
            estado.detail = 'La sesion se cerro desde el telefono. Vuelve a escanear.';
            socket = null;
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

    sock.ev.on('messages.upsert', (((evento: { messages?: unknown[] }) => {
      if (!opts.onChange) return;
      for (const mensaje of evento.messages ?? []) {
        const value = toChangeValue(mensaje);
        if (value) void opts.onChange(value);
      }
    }) as unknown) as (arg: never) => void);

    // Si el socket ya venia vinculado no llega ningun QR: se le da un margen
    // corto para que diga "open" y, si no, se contesta con lo que haya.
    setTimeout(listo, 8000);
  });
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
 * Un mensaje de Baileys en la forma que ya entiende `processChange`.
 *
 * Devuelve null para lo que el sistema no trata (propios, grupos, reacciones):
 * traducirlos seria inventar.
 */
export function toChangeValue(mensaje: unknown): ChangeValue | null {
  const m = mensaje as {
    key?: { id?: string; remoteJid?: string; fromMe?: boolean };
    message?: Record<string, unknown>;
    messageTimestamp?: number | string;
    pushName?: string;
  };

  const id = m.key?.id;
  const jid = m.key?.remoteJid;
  if (!id || !jid || m.key?.fromMe) return null;
  // Los grupos y los estados no son conversaciones uno a uno: fuera.
  if (!jid.endsWith('@s.whatsapp.net')) return null;

  const contenido = m.message ?? {};
  const from = fromJid(jid);
  const timestamp = String(m.messageTimestamp ?? Math.floor(Date.now() / 1000));

  const conversation = contenido.conversation as string | undefined;
  const extended = (contenido.extendedTextMessage as { text?: string } | undefined)?.text;
  const texto = conversation ?? extended;

  const ubicacion = contenido.locationMessage as
    | { degreesLatitude?: number; degreesLongitude?: number; name?: string; address?: string }
    | undefined;

  const base = {
    messaging_product: 'whatsapp',
    contacts: [{ wa_id: from, profile: { name: m.pushName ?? '' } }],
  };

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

  // Fotos, audios y documentos llegan para que los vea una persona en /chat,
  // aunque el bot no sepa que hacer con ellos.
  const tipo = Object.keys(contenido).find((k) => k.endsWith('Message'));
  if (tipo) {
    return {
      ...base,
      messages: [{ id, from, timestamp, type: tipo.replace('Message', '').toLowerCase() }],
    };
  }

  return null;
}
