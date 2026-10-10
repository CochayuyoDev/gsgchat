/**
 * Lo que WhatsApp entrega distinto a un dispositivo vinculado: los "ver una
 * vez" (llegan como un sobre vacio, sin la llave del adjunto) y los grupos
 * (llegan con el jid del grupo y quien escribio dentro).
 *
 * Aqui se prueba el camino entero: el traductor de Baileys, la sesion (que
 * pide el reenvio al telefono y trae los grupos al conectar), el manejador
 * de entrantes (que guarda, completa y decide si contesta) y lo que ve la
 * pantalla (lista de chats, libreta).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createSender } from '../src/outbound/sender.js';
import { loadConfig } from '../src/config.js';
import { crearServicioAjustes } from '../src/ajustes/generales.js';
import { createSeenCache, processChange } from '../src/whatsapp/webhook.js';
import { readInbound } from '../src/handlers/inbound.js';
import { TEXTO_VER_UNA_VEZ } from '../src/handlers/textos.js';
import {
  autorDeGrupo,
  conTope,
  pedirHistorial,
  porQueSeDescarta,
  proximoHistorial,
  recordarGrupo,
  resetLocalForTests,
  sobreDeVerUnaVez,
  startLocal,
  toChangeValue,
  type LocalSocket,
  type MensajePropio,
} from '../src/whatsapp/local/session.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp } from './fakes.js';
import type { ChangeValue, InboundMessage } from '../src/whatsapp/types.js';

const ENV = {
  PUBLIC_BASE_URL: 'https://ejemplo.test',
  DATABASE_URL: 'mysql://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 's',
  WHATSAPP_VERIFY_TOKEN: 'v',
  GOOGLE_MAPS_API_KEY: 'k',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'lima',
};

const GRUPO = '120363412332267099@g.us';
const ahora = () => String(Math.floor(Date.now() / 1000));

beforeEach(() => {
  resetLocalForTests();
});

// ---------------------------------------------------------------- traductor

describe('traducir un "ver una vez" que llega vacio', () => {
  it('el sobre vacio con isViewOnce se convierte en un view_once, no se descarta', () => {
    // Asi llega hoy: sin `message`, con la marca en la clave. Antes salia como
    // "sin contenido" en el log y el operador no veia nada.
    const value = toChangeValue({
      key: { id: 'VO1', remoteJid: '101937156509767@lid', remoteJidAlt: '51912426667@s.whatsapp.net', isViewOnce: true },
      messageTimestamp: 1789590000,
      pushName: 'Luis',
    });
    expect(value?.messages?.[0]).toMatchObject({ id: 'VO1', from: '51912426667', type: 'view_once', viewOnce: { kind: 'unknown' } });
    expect(value?.messages?.[0]?.reenvio).toBeUndefined();
  });

  it('la segunda entrega (el telefono lo reenvio) llega marcada como reenvio y con el fichero', () => {
    const value = toChangeValue(
      { key: { id: 'VO1', remoteJid: '51912426667@s.whatsapp.net' }, message: { viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/jpeg' } } } } },
      null,
      { id: 'abc.jpg', kind: 'image', mimeType: 'image/jpeg', bytes: 10, verUnaVez: true },
      { reenvio: true },
    );
    expect(value?.messages?.[0]).toMatchObject({ type: 'image', reenvio: true, media: { verUnaVez: true } });
  });

  it('un mensaje vacio sin la marca sigue sin inventar nada', () => {
    expect(toChangeValue({ key: { id: 'A', remoteJid: '51912426667@s.whatsapp.net' }, message: {} })).toBeNull();
  });
});

describe('traducir un mensaje de grupo', () => {
  it('entra con el jid del grupo como remitente y quien escribio dentro', () => {
    recordarGrupo(GRUPO, 'Reparto Lima Norte');
    const value = toChangeValue(
      {
        key: { id: 'G1', remoteJid: GRUPO, participant: '55555@lid', participantAlt: '51987654321@s.whatsapp.net' },
        messageTimestamp: 1789590000,
        pushName: 'Carlos',
        message: { conversation: 'ya salí con los pedidos' },
      },
      null,
      null,
      { nombreGrupo: 'Reparto Lima Norte' },
    );
    const m = value!.messages![0]!;
    expect(m.from).toBe(GRUPO);
    expect(m.text?.body).toBe('ya salí con los pedidos');
    expect(m.grupo).toEqual({ jid: GRUPO, nombre: 'Reparto Lima Norte', autor: '51987654321', autorNombre: 'Carlos' });
    // El nombre del grupo va donde processChange lee el "profile name".
    expect(value!.contacts![0]).toEqual({ wa_id: GRUPO, profile: { name: 'Reparto Lima Norte' } });
  });

  it('el autor sin numero (solo LID) no impide que el mensaje entre', () => {
    const value = toChangeValue({
      key: { id: 'G2', remoteJid: GRUPO, participant: '55555@lid' },
      message: { conversation: 'hola' },
    });
    expect(value?.messages?.[0]?.grupo).toMatchObject({ jid: GRUPO, autor: null });
    // Con el telefono resuelto por el mapa de LID, se usa.
    const resuelto = toChangeValue({ key: { id: 'G3', remoteJid: GRUPO, participant: '55555@lid' }, message: { conversation: 'hola' } }, '51911111111');
    expect(resuelto?.messages?.[0]?.grupo?.autor).toBe('51911111111');
  });

  it('una foto en un grupo llega como foto, con su autor', () => {
    const value = toChangeValue(
      { key: { id: 'G4', remoteJid: GRUPO, participantAlt: '51987654321@s.whatsapp.net' }, message: { imageMessage: {} } },
      null,
      { id: 'f.jpg', kind: 'image', mimeType: 'image/jpeg', bytes: 5 },
    );
    expect(value?.messages?.[0]).toMatchObject({ type: 'image', grupo: { autor: '51987654321' } });
  });

  it('los estados y los canales siguen fuera; el log ya no llama "grupo" a lo que se descarta', () => {
    expect(toChangeValue({ key: { id: 'A', remoteJid: 'status@broadcast' }, message: { conversation: 'x' } })).toBeNull();
    expect(toChangeValue({ key: { id: 'A', remoteJid: '123@newsletter' }, message: { conversation: 'x' } })).toBeNull();
    expect(porQueSeDescarta({ key: { id: 'A', remoteJid: 'status@broadcast' }, message: {} }, null)).toMatch(/estado o canal/);
    expect(porQueSeDescarta({ key: { id: 'A', remoteJid: GRUPO }, message: {} }, null)).not.toMatch(/grupo/);
  });

  it('la llave de grupo que acompana al primer mensaje de alguien no lo tapa', () => {
    // Asi llega el primer mensaje de cada participante: su llave y el texto
    // (o la foto) en el mismo sobre. Antes se descartaba como "protocolo".
    const texto = toChangeValue({
      key: { id: 'G5', remoteJid: GRUPO, participantAlt: '51987654321@s.whatsapp.net' },
      message: { senderKeyDistributionMessage: { groupId: GRUPO }, messageContextInfo: {}, conversation: 'hola a todos' },
    });
    expect(texto?.messages?.[0]).toMatchObject({ type: 'text', text: { body: 'hola a todos' } });
    const foto = toChangeValue(
      { key: { id: 'G6', remoteJid: GRUPO, participantAlt: '51987654321@s.whatsapp.net' }, message: { senderKeyDistributionMessage: {}, imageMessage: {} } },
      null,
      { id: 'f.jpg', kind: 'image', mimeType: 'image/jpeg', bytes: 5 },
    );
    expect(foto?.messages?.[0]?.type).toBe('image');
    // Solo la llave, sin nada mas: eso si es protocolo.
    expect(toChangeValue({ key: { id: 'G7', remoteJid: GRUPO }, message: { senderKeyDistributionMessage: {}, messageContextInfo: {} } })).toBeNull();
    // La llave junto a algo raro: el tipo es lo raro, nunca la llave.
    const raro = toChangeValue({ key: { id: 'G8', remoteJid: GRUPO }, message: { senderKeyDistributionMessage: {}, pollCreationMessage: { name: 'x' } } });
    expect(raro?.messages?.[0]?.type).toBe('pollcreation');
  });

  it('los avisos del grupo (alguien entro o salio) se explican en el log como lo que son', () => {
    expect(porQueSeDescarta({ key: { id: 'A', remoteJid: GRUPO }, messageStubType: 27 }, null)).toMatch(/aviso del grupo/);
    expect(porQueSeDescarta({ key: { id: 'A', remoteJid: GRUPO }, messageStubType: 32 }, null)).toMatch(/aviso del grupo/);
    expect(porQueSeDescarta({ key: { id: 'A', remoteJid: '51987654321@s.whatsapp.net' }, messageStubType: 2 }, null)).toMatch(/descifrar/);
  });

  it('autorDeGrupo prefiere lo que trae numero', () => {
    expect(autorDeGrupo({ participant: '1@lid', participantAlt: '51912000001@s.whatsapp.net' })).toBe('51912000001');
    expect(autorDeGrupo({ participant: '51912000002:3@s.whatsapp.net' })).toBe('51912000002');
    expect(autorDeGrupo({ participant: '1@lid' })).toBeNull();
    expect(autorDeGrupo(undefined)).toBeNull();
  });
});

describe('el sobre crudo de un "ver una vez"', () => {
  const nodo = (tipo: string, extra: Record<string, string> = {}, hijos: Array<{ tag: string; attrs?: Record<string, string> }> = []) => ({
    tag: 'message',
    attrs: { from: '101937156509767@lid', sender_pn: '51912426667@s.whatsapp.net', addressing_mode: 'lid', id: 'VO-RAW', t: ahora(), notify: 'Luis', type: 'media', ...extra },
    content: [{ tag: 'unavailable', attrs: { type: tipo } }, ...hijos],
  });

  it('reconoce los dos tipos de sobre, y si llego de la cola', () => {
    expect(sobreDeVerUnaVez(nodo('view_once'))).toEqual({ tipo: 'view_once', offline: false });
    expect(sobreDeVerUnaVez(nodo('view_once_unavailable_fanout', { offline: '1' }))).toEqual({ tipo: 'view_once_unavailable_fanout', offline: true });
    // Con contenido cifrado no es un sobre vacio: lo entrega Baileys.
    expect(sobreDeVerUnaVez(nodo('view_once', {}, [{ tag: 'enc', attrs: { type: 'msg' } }]))).toBeNull();
    expect(sobreDeVerUnaVez({ tag: 'message', attrs: { id: 'x' }, content: [{ tag: 'unavailable', attrs: { type: 'bot_unavailable_fanout' } }] })).toBeNull();
    expect(sobreDeVerUnaVez({ tag: 'receipt', attrs: {} })).toBeNull();
    expect(sobreDeVerUnaVez(null)).toBeNull();
  });
});

// ------------------------------------------------------------------ sesion

function fakeSocket(extra: Partial<LocalSocket> = {}) {
  const handlers = new Map<string, (arg: unknown) => void>();
  const crudos = new Map<string, (arg: unknown) => void>();
  const sock: LocalSocket = {
    ws: { on: (evento, handler) => crudos.set(evento, handler) },
    async sendMessage() {
      return { key: { id: 'x' } };
    },
    async readMessages() {},
    async requestPairingCode() {
      return 'ABCD1234';
    },
    async logout() {},
    end() {},
    ev: { on: (evento, handler) => handlers.set(evento, handler as (arg: unknown) => void) },
    user: { id: '51902464984:1@s.whatsapp.net', name: 'GSG' },
    ...extra,
  };
  async function listo() {
    for (let i = 0; i < 100 && !handlers.has('connection.update'); i++) await new Promise((r) => setTimeout(r, 5));
  }
  return {
    sock,
    listo,
    emitir: (e: string, arg: unknown) => handlers.get(e)?.(arg),
    emitirCrudo: (e: string, arg: unknown) => crudos.get(e)?.(arg),
  };
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Lo que salio hacia el cliente, sin los acuses de lectura. */
const salidas = (wa: { sent: Array<Record<string, unknown>> }) => wa.sent.filter((m) => m.kind !== 'read');

describe('la sesion local con grupos y "ver una vez"', () => {
  it('al conectar trae los grupos del numero y se los entrega al sistema', async () => {
    const { sock, listo, emitir } = fakeSocket({
      async groupFetchAllParticipating() {
        return {
          [GRUPO]: { id: GRUPO, subject: 'Reparto Lima Norte', participants: [{}, {}, {}] },
          '999@g.us': { id: '999@g.us', subject: '  ', participants: [] },
        };
      },
    });
    const recibidos: unknown[] = [];
    const promesa = startLocal({
      authDir: 'C:/no/existe/da/igual',
      createSocket: async () => ({ sock, saveCreds: async () => {} }),
      onGrupos: (g) => {
        recibidos.push(...g);
      },
    });
    await listo();
    emitir('connection.update', { connection: 'open' });
    await promesa;
    await espera(20);
    expect(recibidos).toEqual([
      { jid: GRUPO, nombre: 'Reparto Lima Norte', participantes: 3 },
      // Sin nombre se ensena el id, nunca un jid con arroba.
      { jid: '999@g.us', nombre: '999', participantes: 0 },
    ]);
  });

  it('un cambio de nombre del grupo tambien llega', async () => {
    const { sock, listo, emitir } = fakeSocket();
    const recibidos: unknown[] = [];
    const promesa = startLocal({
      authDir: 'C:/no/existe/da/igual',
      createSocket: async () => ({ sock, saveCreds: async () => {} }),
      onGrupos: (g) => {
        recibidos.push(...g);
      },
    });
    await listo();
    emitir('connection.update', { connection: 'open' });
    await promesa;
    emitir('groups.update', [{ id: GRUPO, subject: 'Reparto Lima Sur' }, { id: GRUPO }]);
    await espera(10);
    expect(recibidos).toEqual([{ jid: GRUPO, nombre: 'Reparto Lima Sur', participantes: 0 }]);
  });

  it('un mensaje de grupo se entrega traducido, con el nombre del grupo aprendido al vuelo', async () => {
    const { sock, listo, emitir } = fakeSocket({
      async groupMetadata(jid) {
        return { id: jid, subject: 'Choferes', participants: [{}] };
      },
    });
    const valores: ChangeValue[] = [];
    const grupos: unknown[] = [];
    const promesa = startLocal({
      authDir: 'C:/no/existe/da/igual',
      createSocket: async () => ({ sock, saveCreds: async () => {} }),
      onChange: (v) => {
        valores.push(v);
      },
      onGrupos: (g) => {
        grupos.push(...g);
      },
    });
    await listo();
    emitir('connection.update', { connection: 'open' });
    await promesa;
    emitir('messages.upsert', {
      type: 'notify',
      messages: [{ key: { id: 'G9', remoteJid: '777@g.us', participantAlt: '51912000001@s.whatsapp.net' }, messageTimestamp: ahora(), pushName: 'Pepe', message: { conversation: 'hola grupo' } }],
    });
    await espera(30);
    expect(grupos).toEqual([{ jid: '777@g.us', nombre: 'Choferes', participantes: 1 }]);
    expect(valores[0]?.messages?.[0]).toMatchObject({ from: '777@g.us', grupo: { nombre: 'Choferes', autor: '51912000001', autorNombre: 'Pepe' } });
  });

  it('un "ver una vez" vacio se entrega y se le pide al telefono que lo reenvie; la respuesta llega como reenvio', async () => {
    const pedidos: unknown[] = [];
    const { sock, listo, emitir } = fakeSocket({
      async requestPlaceholderResend(key, datos) {
        pedidos.push({ key, datos });
        return 'PDO-1';
      },
    });
    const valores: ChangeValue[] = [];
    const promesa = startLocal({
      authDir: 'C:/no/existe/da/igual',
      createSocket: async () => ({ sock, saveCreds: async () => {} }),
      onChange: (v) => {
        valores.push(v);
      },
    });
    await listo();
    emitir('connection.update', { connection: 'open' });
    await promesa;

    const key = { id: 'VO7', remoteJid: '101937156509767@lid', remoteJidAlt: '51912426667@s.whatsapp.net', isViewOnce: true };
    emitir('messages.upsert', { type: 'notify', messages: [{ key, messageTimestamp: ahora(), pushName: 'Luis' }] });
    await espera(20);

    expect(valores[0]?.messages?.[0]).toMatchObject({ id: 'VO7', from: '51912426667', type: 'view_once' });
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({ key: { id: 'VO7', remoteJid: '101937156509767@lid', fromMe: false } });

    // El telefono contesta: Baileys re-emite el mismo id con `requestId`.
    emitir('messages.upsert', {
      type: 'notify',
      requestId: 'PDO-1',
      messages: [{ key, messageTimestamp: ahora(), pushName: 'Luis', message: { viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/jpeg', viewOnce: true } } } } }],
    });
    // La segunda entrega intenta bajar el fichero (y falla, sin red): tarda mas.
    for (let i = 0; i < 40 && valores.length < 2; i++) await espera(25);
    // Sin descarga real no hay fichero, pero la segunda entrega va marcada.
    expect(valores[1]?.messages?.[0]).toMatchObject({ id: 'VO7', reenvio: true });
    // Y por la segunda no se vuelve a pedir nada.
    expect(pedidos).toHaveLength(1);
  });
});

describe('el "ver una vez" que Baileys tira sin avisar', () => {
  it('se lee del socket crudo, se entrega y se pide el reenvio; el eco por upsert no lo duplica', async () => {
    const pedidos: unknown[] = [];
    const { sock, listo, emitir, emitirCrudo } = fakeSocket({
      async requestPlaceholderResend(key) {
        pedidos.push(key);
        return 'PDO-9';
      },
    });
    const valores: ChangeValue[] = [];
    const promesa = startLocal({
      authDir: 'C:/no/existe/da/igual',
      createSocket: async () => ({ sock, saveCreds: async () => {} }),
      onChange: (v) => {
        valores.push(v);
      },
    });
    await listo();
    emitir('connection.update', { connection: 'open' });
    await promesa;

    emitirCrudo('CB:message', {
      tag: 'message',
      attrs: { from: '101937156509767@lid', sender_pn: '51912426667@s.whatsapp.net', addressing_mode: 'lid', id: 'VO-FAN', t: ahora(), notify: 'Luis', type: 'media' },
      content: [{ tag: 'unavailable', attrs: { type: 'view_once_unavailable_fanout' } }],
    });
    await espera(80);
    expect(valores).toHaveLength(1);
    expect(valores[0]?.messages?.[0]).toMatchObject({ id: 'VO-FAN', from: '51912426667', type: 'view_once', viewOnce: { kind: 'unknown' } });
    expect(valores[0]?.contacts?.[0]).toMatchObject({ wa_id: '51912426667', profile: { name: 'Luis' } });
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({ id: 'VO-FAN', remoteJid: '101937156509767@lid' });

    // Con el tipo `view_once` Baileys ademas lo emite por upsert: mismo id,
    // marcado. No se entrega dos veces ni se pide dos veces.
    emitir('messages.upsert', {
      type: 'notify',
      messages: [{ key: { id: 'VO-FAN', remoteJid: '101937156509767@lid', remoteJidAlt: '51912426667@s.whatsapp.net', isViewOnce: true }, messageTimestamp: ahora(), pushName: 'Luis' }],
    });
    await espera(20);
    expect(valores).toHaveLength(1);
    expect(pedidos).toHaveLength(1);

    // Y un sobre de la cola (offline) de hace una hora entra como viejo: se guarda sin contestar.
    emitirCrudo('CB:message', {
      tag: 'message',
      attrs: { from: '51912426667@s.whatsapp.net', id: 'VO-OFF', t: String(Number(ahora()) - 3600), notify: 'Luis', type: 'media', offline: '1' },
      content: [{ tag: 'unavailable', attrs: { type: 'view_once' } }],
    });
    await espera(80);
    expect(valores[1]?.messages?.[0]).toMatchObject({ id: 'VO-OFF', type: 'view_once', viejo: true });
    // Uno de la cola pero recién mandado (cayó en el reinicio) se atiende (28/09).
    emitirCrudo('CB:message', {
      tag: 'message',
      attrs: { from: '51912426667@s.whatsapp.net', id: 'VO-OFF-2', t: ahora(), notify: 'Luis', type: 'media', offline: '1' },
      content: [{ tag: 'unavailable', attrs: { type: 'view_once' } }],
    });
    await espera(80);
    expect(valores[2]?.messages?.[0]).toMatchObject({ id: 'VO-OFF-2', type: 'view_once' });
    expect(valores[2]?.messages?.[0]?.viejo).toBeFalsy();
  });

  it('un mensaje propio de "ver una vez" (mandado desde el telefono) no entra', async () => {
    const { sock, listo, emitir, emitirCrudo } = fakeSocket();
    const valores: ChangeValue[] = [];
    const promesa = startLocal({
      authDir: 'C:/no/existe/da/igual',
      createSocket: async () => ({ sock, saveCreds: async () => {} }),
      onChange: (v) => {
        valores.push(v);
      },
    });
    await listo();
    emitir('connection.update', { connection: 'open' });
    await promesa;
    emitirCrudo('CB:message', {
      tag: 'message',
      attrs: { from: '51902464984:1@s.whatsapp.net', recipient: '51912426667@s.whatsapp.net', id: 'VO-MIO', t: ahora(), type: 'media' },
      content: [{ tag: 'unavailable', attrs: { type: 'view_once' } }],
    });
    await espera(80);
    expect(valores).toHaveLength(0);
  });
});

describe('lo que se manda desde el telefono y el historial', () => {
  async function sesion(extra: Partial<LocalSocket> = {}) {
    const f = fakeSocket(extra);
    const valores: ChangeValue[] = [];
    const propios: MensajePropio[] = [];
    const promesa = startLocal({
      authDir: 'C:/no/existe/da/igual',
      createSocket: async () => ({ sock: f.sock, saveCreds: async () => {} }),
      onChange: (v) => {
        valores.push(v);
      },
      onPropio: (p) => {
        propios.push(p);
      },
    });
    await f.listo();
    f.emitir('connection.update', { connection: 'open' });
    await promesa;
    return { ...f, valores, propios };
  }

  it('un texto mandado desde el telefono llega como propio, con su estado y hacia el chat correcto', async () => {
    const { emitir, valores, propios } = await sesion();
    emitir('messages.upsert', {
      type: 'notify',
      messages: [
        { key: { id: 'MIO1', remoteJid: '101937156509767@lid', remoteJidAlt: '51912426667@s.whatsapp.net', fromMe: true }, messageTimestamp: ahora(), status: 4, message: { conversation: 'ya salgo' } },
        // Una reaccion propia no se guarda: no es un mensaje.
        { key: { id: 'MIO2', remoteJid: '51912426667@s.whatsapp.net', fromMe: true }, messageTimestamp: ahora(), message: { reactionMessage: { text: '👍' } } },
      ],
    });
    await espera(30);
    expect(valores).toHaveLength(0);
    expect(propios).toHaveLength(1);
    expect(propios[0]).toMatchObject({ status: 'read', mensaje: { id: 'MIO1', from: '51912426667', type: 'text', text: { body: 'ya salgo' } } });
  });

  it('en un grupo, lo propio va al grupo', async () => {
    recordarGrupo(GRUPO, 'Reparto');
    const { emitir, propios } = await sesion();
    emitir('messages.upsert', {
      type: 'append',
      messages: [{ key: { id: 'MIO3', remoteJid: GRUPO, participant: '51902464984@s.whatsapp.net', fromMe: true }, messageTimestamp: ahora(), status: 2, message: { conversation: 'salimos 8am' } }],
    });
    await espera(30);
    expect(propios[0]).toMatchObject({ status: 'sent', mensaje: { from: GRUPO, grupo: { jid: GRUPO, nombre: 'Reparto' }, text: { body: 'salimos 8am' } } });
  });

  it('el historial que manda el telefono entra: lo del cliente como viejo, lo mio como propio', async () => {
    const { emitir, valores, propios } = await sesion();
    emitir('messaging-history.set', {
      syncType: 2,
      progress: 50,
      messages: [
        { key: { id: 'H1', remoteJid: '51912426667@s.whatsapp.net' }, messageTimestamp: 1789000000, pushName: 'Luis', message: { conversation: 'hola de hace dias' } },
        { key: { id: 'H2', remoteJid: '51912426667@s.whatsapp.net', fromMe: true }, messageTimestamp: 1789000100, status: 4, message: { extendedTextMessage: { text: 'que tal' } } },
        { key: { id: 'H3', remoteJid: 'status@broadcast', fromMe: true }, messageTimestamp: 1789000200, message: { conversation: 'mi estado' } },
      ],
    });
    await espera(40);
    expect(valores).toHaveLength(1);
    expect(valores[0]?.messages?.[0]).toMatchObject({ id: 'H1', type: 'text', viejo: true });
    expect(propios).toHaveLength(1);
    expect(propios[0]?.mensaje).toMatchObject({ id: 'H2', text: { body: 'que tal' } });
  });

  it('se puede esperar al proximo lote de historial, y se avisa despues de guardarlo', async () => {
    const { emitir, valores } = await sesion();
    const espera1 = proximoHistorial(2000);
    emitir('messaging-history.set', {
      syncType: 6,
      messages: [{ key: { id: 'H9', remoteJid: '51912426667@s.whatsapp.net' }, messageTimestamp: 1789000000, message: { conversation: 'viejo' } }],
    });
    expect(await espera1).toBe(1);
    // Cuando avisa, el mensaje ya se entrego.
    expect(valores.some((v) => v.messages?.[0]?.id === 'H9')).toBe(true);
    // Sin lote, se agota la espera.
    expect(await proximoHistorial(30)).toBeNull();
  });

  it('el final de la sincronizacion inicial (RECENT al 100 %) avisa una vez; los trozos y lo bajo demanda no', async () => {
    const f = fakeSocket();
    let avisos = 0;
    const promesa = startLocal({
      authDir: 'C:/no/existe/da/igual',
      createSocket: async () => ({ sock: f.sock, saveCreds: async () => {} }),
      onChange: () => {},
      onSincronizacionInicial: () => {
        avisos += 1;
      },
    });
    await f.listo();
    f.emitir('connection.update', { connection: 'open' });
    await promesa;
    f.emitir('messaging-history.set', { syncType: 3, progress: 40, messages: [] });
    f.emitir('messaging-history.set', { syncType: 6, progress: 100, messages: [] });
    await espera(20);
    expect(avisos).toBe(0);
    f.emitir('messaging-history.set', { syncType: 3, progress: 100, messages: [] });
    await espera(20);
    expect(avisos).toBe(1);
  });

  it('pedir los anteriores de un chat le pasa al telefono el ancla', async () => {
    const pedidos: unknown[] = [];
    await sesion({
      async fetchMessageHistory(count, key, ts) {
        pedidos.push({ count, key, ts });
        return 'PDO-H';
      },
    });
    const r = await pedirHistorial('51912426667@s.whatsapp.net', { id: 'H1', fromMe: false, timestampMs: 1789000000000 });
    expect(r).toBe('PDO-H');
    expect(pedidos[0]).toEqual({ count: 50, key: { remoteJid: '51912426667@s.whatsapp.net', fromMe: false, id: 'H1' }, ts: 1789000000000 });
  });

  it('sin conexion, pedir el historial lo dice claro', async () => {
    await expect(pedirHistorial('51912426667@s.whatsapp.net', { id: 'x', fromMe: false, timestampMs: 1 })).rejects.toThrow(/no esta conectado/);
  });
});

// --------------------------------------------------------------- manejador

async function build(opts: { pedirNormal?: boolean } = {}) {
  const config = loadConfig(ENV as NodeJS.ProcessEnv);
  const settings = await createFakeSettings(config);
  const repos = createFakeRepos();
  const wa = createFakeWhatsApp();
  const sender = createSender({
    repos,
    wa,
    phoneNumberId: 'PNID',
    warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 },
    maxMarketingPerContact7d: 2,
    serviceWindowApplies: false,
  });
  const ajustes = await crearServicioAjustes({ repo: repos.ajustesGenerales, config, releerCadaMs: 0 });
  if (opts.pedirNormal !== undefined) await ajustes.guardar({ pedirVerUnaVezNormal: opts.pedirNormal });
  await repos.automation.setPrefs({ askLocationFallback: true, preventaActiva: false });
  const deps = { repos, wa, sender, config, settings, ajustes, seen: createSeenCache(), verUnaVezEsperaMs: 0 };
  return { deps, repos, wa, ajustes };
}

function mensaje(overrides: Partial<InboundMessage>, contactos?: ChangeValue['contacts']): ChangeValue {
  return {
    contacts: contactos ?? [{ wa_id: '51912426667', profile: { name: 'Luis' } }],
    messages: [{ id: 'wamid.1', from: '51912426667', timestamp: ahora(), type: 'text', ...overrides } as InboundMessage],
  };
}

describe('un "ver una vez" en la conversacion', () => {
  it('se guarda explicando que solo se abre en el telefono, y se le pide al cliente que lo mande normal', async () => {
    const { deps, repos, wa } = await build();
    await processChange('messages', mensaje({ type: 'view_once', viewOnce: { kind: 'unknown' } }), deps);

    const c = await repos.contacts.getByPhone('51912426667');
    const hilo = await repos.messages.listMessages(c!.id, 10);
    expect(hilo[0]).toMatchObject({ direction: 'in', kind: 'unknown', payload: { viewOnce: { kind: 'unknown' } } });
    expect(hilo[0]!.body).toMatch(/ver una vez/);
    expect(hilo[0]!.body).toMatch(/teléfono/);
    // Y la unica respuesta es pedirle la foto normal, ni menu ni ubicacion.
    expect(salidas(wa)).toHaveLength(1);
    expect(salidas(wa)[0]).toMatchObject({ kind: 'text', body: TEXTO_VER_UNA_VEZ });
  });

  it('si el telefono la reenvia antes de que pase la espera, no se le pide nada y la foto queda en el mensaje', async () => {
    const { deps, repos, wa } = await build();
    // Mientras el manejador "espera", entra la segunda entrega con el fichero.
    const conReenvio = {
      ...deps,
      dormir: async () => {
        await processChange(
          'messages',
          mensaje({ type: 'image', reenvio: true, media: { id: 'foto.jpg', mimeType: 'image/jpeg', bytes: 100, verUnaVez: true } }),
          deps,
        );
      },
    };
    await processChange('messages', mensaje({ type: 'view_once', viewOnce: { kind: 'unknown' } }), conReenvio);

    const c = await repos.contacts.getByPhone('51912426667');
    const hilo = await repos.messages.listMessages(c!.id, 10);
    // Una sola fila, ya completa: la foto, marcada como "ver una vez".
    expect(hilo).toHaveLength(1);
    expect(hilo[0]).toMatchObject({ kind: 'image', wamid: 'wamid.1', payload: { media: { id: 'foto.jpg', verUnaVez: true } } });
    expect(hilo[0]!.body).toMatch(/ver una vez/);
    expect(salidas(wa)).toHaveLength(0);
  });

  it('el reenvio tardio completa la fila aunque ya se le haya pedido la foto', async () => {
    const { deps, repos, wa } = await build();
    await processChange('messages', mensaje({ type: 'view_once', viewOnce: { kind: 'unknown' } }), deps);
    expect(salidas(wa)).toHaveLength(1);
    await processChange('messages', mensaje({ type: 'image', reenvio: true, media: { id: 'foto.jpg', mimeType: 'image/jpeg', bytes: 100, verUnaVez: true } }), deps);
    const c = await repos.contacts.getByPhone('51912426667');
    const hilo = await repos.messages.listMessages(c!.id, 10);
    expect(hilo).toHaveLength(1);
    expect(hilo[0]).toMatchObject({ kind: 'image', payload: { media: { id: 'foto.jpg' } } });
    // Y no se contesta dos veces.
    expect(salidas(wa)).toHaveLength(1);
  });

  it('un reenvio sin sobre previo se guarda como foto normal, sin contestar', async () => {
    const { deps, repos, wa } = await build();
    await processChange('messages', mensaje({ type: 'image', reenvio: true, media: { id: 'foto.jpg', mimeType: 'image/jpeg', bytes: 100 } }), deps);
    const c = await repos.contacts.getByPhone('51912426667');
    expect(await repos.messages.listMessages(c!.id, 10)).toHaveLength(1);
    expect(salidas(wa)).toHaveLength(0);
  });

  it('con un reparto abierto tambien se le pide la foto normal: una foto que nadie ve no es una respuesta', async () => {
    const { deps, repos, wa } = await build();
    const c = await repos.contacts.upsertFromInbound('51912426667', 'Luis');
    const lote = await repos.rutas.crearLote({ nombre: 'Hoy' });
    await repos.rutas.agregarSolicitudes(lote.id, [{ telefonoCrudo: '912426667', phone: '51912426667', referencia: 'P-1', nombre: 'Luis', distrito: 'Miraflores', estado: 'enviado' }]);
    const abierta = await repos.rutas.abiertaPorTelefono(c.phone);
    expect(abierta).not.toBeNull();
    await processChange('messages', mensaje({ type: 'view_once', viewOnce: { kind: 'unknown' } }), deps);
    expect(salidas(wa)).toHaveLength(1);
    expect(salidas(wa)[0]).toMatchObject({ body: TEXTO_VER_UNA_VEZ });
    // La solicitud del reparto no se toca: sigue como estaba.
    expect((await repos.rutas.abiertaPorTelefono(c.phone))?.estado).toBe(abierta!.estado);
  });

  it('con el ajuste apagado no se le dice nada al cliente', async () => {
    const { deps, wa } = await build({ pedirNormal: false });
    await processChange('messages', mensaje({ type: 'view_once', viewOnce: { kind: 'unknown' } }), deps);
    expect(salidas(wa)).toHaveLength(0);
  });

  it('con el bot parado en ese chat tampoco', async () => {
    const { deps, repos, wa } = await build();
    const c = await repos.contacts.upsertFromInbound('51912426667', 'Luis');
    await repos.contacts.pausarBot(c.id, true, new Date());
    await processChange('messages', mensaje({ type: 'view_once', viewOnce: { kind: 'unknown' } }), deps);
    expect(salidas(wa)).toHaveLength(0);
    expect(await repos.messages.listMessages(c.id, 10)).toHaveLength(1);
  });

  it('en la lectura, el "ver una vez" se explica en cristiano', () => {
    const leido = readInbound({ id: 'x', from: '51912426667', timestamp: '1', type: 'view_once', viewOnce: { kind: 'video' } });
    expect(leido.body).toMatch(/^👁 Video de "ver una vez"/);
    expect(leido.body).toMatch(/dispositivos vinculados/);
  });
});

describe('el tope de las descargas', () => {
  it('una descarga que no termina falla con su motivo en vez de esperar para siempre', async () => {
    await expect(conTope(new Promise<never>(() => {}), 30, 'la descarga tardo demasiado')).rejects.toThrow(/tardo demasiado/);
    await expect(conTope(Promise.resolve(7), 30, 'x')).resolves.toBe(7);
    await expect(conTope(Promise.reject(new Error('sin red')), 30, 'x')).rejects.toThrow(/sin red/);
  });
});

describe('lo que el cliente "elimina para todos"', () => {
  it('se traduce como una revocacion con el id del mensaje; sin id sigue siendo protocolo', () => {
    const v = toChangeValue({ key: { id: 'R1', remoteJid: '51912426667@s.whatsapp.net' }, message: { protocolMessage: { type: 0, key: { id: 'wamid.1', remoteJid: '51912426667@s.whatsapp.net', fromMe: false } } } });
    expect(v?.messages?.[0]).toMatchObject({ type: 'revoke', revoca: 'wamid.1' });
    expect(toChangeValue({ key: { id: 'R2', remoteJid: '51912426667@s.whatsapp.net' }, message: { protocolMessage: { type: 'REVOKE', key: { id: 'wamid.2' } } } })?.messages?.[0]?.revoca).toBe('wamid.2');
    expect(toChangeValue({ key: { id: 'R3', remoteJid: '51912426667@s.whatsapp.net' }, message: { protocolMessage: { type: 3 } } })).toBeNull();
  });

  it('el mensaje se conserva, se marca, y no se contesta nada', async () => {
    const { deps, repos, wa } = await build();
    await processChange('messages', mensaje({ text: { body: 'te paso mi dirección: Av. Lima 123' } }), deps);
    const antes = salidas(wa).length;
    await processChange('messages', mensaje({ id: 'wamid.rev', type: 'revoke', revoca: 'wamid.1' }), deps);
    const c = await repos.contacts.getByPhone('51912426667');
    const hilo = await repos.messages.listMessages(c!.id, 10);
    expect(hilo).toHaveLength(1);
    expect(hilo[0]).toMatchObject({ body: 'te paso mi dirección: Av. Lima 123', payload: { borradoPorRemitente: expect.any(String) } });
    expect(salidas(wa)).toHaveLength(antes);
  });

  it('en un grupo, igual', async () => {
    const { deps, repos } = await build();
    const enGrupo = (o: Partial<InboundMessage>) => mensaje({ from: GRUPO, grupo: { jid: GRUPO, nombre: 'Reparto', autor: '51987654321', autorNombre: 'Carlos' }, ...o }, [{ wa_id: GRUPO, profile: { name: 'Reparto' } }]);
    await processChange('messages', enGrupo({ id: 'g1', text: { body: 'salgo tarde' } }), deps);
    await processChange('messages', enGrupo({ id: 'g2', type: 'revoke', revoca: 'g1', text: undefined }), deps);
    const g = await repos.contacts.getByPhone(GRUPO);
    const hilo = await repos.messages.listMessages(g!.id, 10);
    expect(hilo).toHaveLength(1);
    expect(hilo[0]).toMatchObject({ body: 'salgo tarde', payload: { borradoPorRemitente: expect.any(String) } });
  });

  it('borrar para todos un mensaje propio (desde el telefono) tambien lo marca', async () => {
    const f = fakeSocket();
    const valores: ChangeValue[] = [];
    const promesa = startLocal({
      authDir: 'C:/no/existe/da/igual',
      createSocket: async () => ({ sock: f.sock, saveCreds: async () => {} }),
      onChange: (v) => {
        valores.push(v);
      },
      onPropio: () => {},
    });
    await f.listo();
    f.emitir('connection.update', { connection: 'open' });
    await promesa;
    f.emitir('messages.upsert', {
      type: 'notify',
      messages: [{ key: { id: 'MR', remoteJid: '51912426667@s.whatsapp.net', fromMe: true }, messageTimestamp: ahora(), message: { protocolMessage: { type: 0, key: { id: 'MIO1', fromMe: true } } } }],
    });
    await espera(40);
    expect(valores[0]?.messages?.[0]).toMatchObject({ type: 'revoke', revoca: 'MIO1' });
  });
});

describe('un grupo en la conversacion', () => {
  const deGrupo = (overrides: Partial<InboundMessage> = {}) =>
    mensaje(
      {
        id: 'wamid.g1',
        from: GRUPO,
        text: { body: 'buenos días, ¿a qué hora salen?' },
        grupo: { jid: GRUPO, nombre: 'Reparto Lima Norte', autor: '51987654321', autorNombre: 'Carlos' },
        ...overrides,
      },
      [{ wa_id: GRUPO, profile: { name: 'Reparto Lima Norte' } }],
    );

  it('se guarda bajo el grupo, con quien lo dijo, y no se contesta nada', async () => {
    const { deps, repos, wa } = await build();
    await processChange('messages', deGrupo(), deps);

    const g = await repos.contacts.getByPhone(GRUPO);
    expect(g).toMatchObject({ tipo: 'grupo', name: 'Reparto Lima Norte' });
    const hilo = await repos.messages.listMessages(g!.id, 10);
    expect(hilo).toHaveLength(1);
    expect(hilo[0]).toMatchObject({
      kind: 'text',
      body: 'buenos días, ¿a qué hora salen?',
      payload: { autor: { telefono: '51987654321', nombre: 'Carlos' } },
    });
    // Ni menu, ni ubicacion, ni bienvenida: en un grupo no habla el sistema.
    expect(salidas(wa)).toHaveLength(0);
    // Y no se le creo un contacto al autor como si hubiera escrito en privado.
    expect(await repos.contacts.getByPhone('51987654321')).toBeNull();
  });

  it('aparece en la lista de chats como grupo, y no en la libreta ni entre los suscritos', async () => {
    const { deps, repos } = await build();
    await processChange('messages', deGrupo(), deps);
    await processChange('messages', mensaje({ id: 'wamid.p1', text: { body: 'hola' } }), deps);

    const chats = await repos.messages.listConversations({ limit: 10, offset: 0 });
    const fila = chats.find((c) => c.phone === GRUPO);
    expect(fila).toMatchObject({ tipo: 'grupo', name: 'Reparto Lima Norte', unread: 1 });
    expect(chats.find((c) => c.phone === '51912426667')).toMatchObject({ tipo: 'persona' });

    const libreta = await repos.contacts.list({ limit: 50, offset: 0 });
    expect(libreta.items.map((c) => c.phone)).toEqual(['51912426667']);
    expect((await repos.contacts.listOptedIn(50, 0)).map((c) => c.phone)).not.toContain(GRUPO);
  });

  it('un "ver una vez" dentro de un grupo se ensena pero no se le pide nada a nadie', async () => {
    const { deps, repos, wa } = await build();
    await processChange('messages', deGrupo({ id: 'wamid.g2', type: 'view_once', text: undefined, viewOnce: { kind: 'unknown' } }), deps);
    const g = await repos.contacts.getByPhone(GRUPO);
    const hilo = await repos.messages.listMessages(g!.id, 10);
    expect(hilo[0]!.body).toMatch(/ver una vez/);
    expect(hilo[0]!.payload).toMatchObject({ autor: { nombre: 'Carlos' } });
    expect(salidas(wa)).toHaveLength(0);
  });

  it('el mismo mensaje reentregado al reconectar no se duplica', async () => {
    const { deps, repos } = await build();
    await processChange('messages', deGrupo(), deps);
    await processChange('messages', deGrupo(), { ...deps, seen: undefined });
    const g = await repos.contacts.getByPhone(GRUPO);
    expect(await repos.messages.listMessages(g!.id, 10)).toHaveLength(1);
  });
});
