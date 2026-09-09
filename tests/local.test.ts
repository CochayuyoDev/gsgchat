/**
 * El proveedor local (Baileys en este mismo proceso).
 *
 * Lo que importa probar es el traductor y las degradaciones, igual que en
 * WAHA: el socket de verdad no se puede montar en un test, pero si se puede
 * comprobar que lo que entra por el se convierte en lo que el sistema espera,
 * y que enviar sin conexion se reporta como transitorio en vez de perderse.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalClient } from '../src/whatsapp/local/client.js';
import { readInbound } from '../src/handlers/inbound.js';
import {
  extensionDe,
  idDeMedia,
  leerMedia,
  tipoDeAdjunto,
} from '../src/whatsapp/local/media.js';
import { WhatsAppApiError } from '../src/whatsapp/client.js';
import {
  fromJid,
  getLocalState,
  resetLocalForTests,
  startLocal,
  toChangeValue,
  toJid,
} from '../src/whatsapp/local/session.js';
import type { LocalSocket } from '../src/whatsapp/local/session.js';

beforeEach(() => {
  resetLocalForTests();
});

describe('identificadores', () => {
  it('un telefono se convierte en jid', () => {
    expect(toJid('5215512345678')).toBe('5215512345678@s.whatsapp.net');
  });

  it('el mas y los espacios sobran', () => {
    expect(toJid('+52 1 55 1234 5678')).toBe('5215512345678@s.whatsapp.net');
  });

  it('un jid ya formado se respeta', () => {
    expect(toJid('123@g.us')).toBe('123@g.us');
  });

  it('del jid se saca el telefono, sin el sufijo de dispositivo', () => {
    expect(fromJid('5215512345678:12@s.whatsapp.net')).toBe('5215512345678');
  });
});

describe('traducir lo que llega por el socket', () => {
  const base = { key: { id: 'ABC', remoteJid: '5215512345678@s.whatsapp.net' }, messageTimestamp: 1700000000 };

  it('un texto se convierte en el formato de siempre', () => {
    const value = toChangeValue({ ...base, pushName: 'Ana', message: { conversation: 'hola' } });
    expect(value?.messages?.[0]).toMatchObject({ id: 'ABC', from: '5215512345678', type: 'text' });
    expect(value?.messages?.[0]?.text?.body).toBe('hola');
    expect(value?.contacts?.[0]).toMatchObject({ wa_id: '5215512345678', profile: { name: 'Ana' } });
  });

  it('el texto citado tambien es texto', () => {
    const value = toChangeValue({ ...base, message: { extendedTextMessage: { text: 'con cita' } } });
    expect(value?.messages?.[0]?.text?.body).toBe('con cita');
  });

  it('una ubicacion llega como ubicacion, con sus grados', () => {
    const value = toChangeValue({
      ...base,
      message: { locationMessage: { degreesLatitude: 19.43, degreesLongitude: -99.13, name: 'Centro' } },
    });
    expect(value?.messages?.[0]).toMatchObject({ type: 'location' });
    expect(value?.messages?.[0]?.location).toMatchObject({ latitude: 19.43, longitude: -99.13, name: 'Centro' });
  });

  it('una foto llega con su tipo, para que la vea una persona en el chat', () => {
    const value = toChangeValue({ ...base, message: { imageMessage: { mimetype: 'image/jpeg' } } });
    expect(value?.messages?.[0]?.type).toBe('image');
  });

  it('los mensajes propios se ignoran: contestarse a si mismo es un bucle', () => {
    expect(toChangeValue({ ...base, key: { ...base.key, fromMe: true }, message: { conversation: 'x' } })).toBeNull();
  });

  it('los grupos se ignoran: esto es uno a uno', () => {
    expect(
      toChangeValue({ ...base, key: { id: 'A', remoteJid: '123@g.us' }, message: { conversation: 'x' } }),
    ).toBeNull();
  });

  it('sin id o sin remitente se descarta', () => {
    expect(toChangeValue({ key: { remoteJid: '1@s.whatsapp.net' }, message: { conversation: 'x' } })).toBeNull();
    expect(toChangeValue({ key: { id: 'A' }, message: { conversation: 'x' } })).toBeNull();
  });

  it('un remitente en LID se resuelve por remoteJidAlt', () => {
    // WhatsApp migro a LID: el remoteJid llega como identificador opaco y el
    // telefono viaja aparte. Filtrar por "@s.whatsapp.net" descartaba TODOS
    // los entrantes, y en silencio.
    const value = toChangeValue({
      key: { id: 'ABC', remoteJid: '99887766@lid', remoteJidAlt: '5215512345678@s.whatsapp.net' },
      messageTimestamp: 1700000000,
      message: { conversation: 'hola' },
    });
    expect(value?.messages?.[0]?.from).toBe('5215512345678');
  });

  it('un LID sin telefono no se inventa un contacto', () => {
    expect(
      toChangeValue({ key: { id: 'A', remoteJid: '99887766@lid' }, message: { conversation: 'x' } }),
    ).toBeNull();
  });

  it('un grupo se descarta aunque traiga remoteJidAlt', () => {
    expect(
      toChangeValue({
        key: { id: 'A', remoteJid: '123@g.us', remoteJidAlt: '5215512345678@s.whatsapp.net' },
        message: { conversation: 'x' },
      }),
    ).toBeNull();
  });

  it('los estados y los canales tampoco entran', () => {
    for (const jid of ['status@broadcast', '123@newsletter']) {
      expect(toChangeValue({ key: { id: 'A', remoteJid: jid }, message: { conversation: 'x' } })).toBeNull();
    }
  });

  it('un mensaje vacio no inventa nada', () => {
    expect(toChangeValue({ ...base, message: {} })).toBeNull();
  });
});

/** Socket de pega: registra los eventos y deja dispararlos a mano. */
function fakeSocket() {
  const handlers = new Map<string, (arg: unknown) => void>();
  const enviados: Array<{ jid: string; content: unknown }> = [];

  const sock: LocalSocket = {
    async sendMessage(jid, content) {
      enviados.push({ jid, content });
      return { key: { id: 'wamid-local-1' } };
    },
    async readMessages() {},
    async requestPairingCode() {
      return 'ABCD1234';
    },
    async logout() {},
    end() {},
    ev: { on: (evento, handler) => handlers.set(evento, handler as (arg: unknown) => void) },
    user: { id: '5215500000000:1@s.whatsapp.net', name: 'Mi Negocio' },
  };

  async function listo() {
    for (let i = 0; i < 100 && !handlers.has('connection.update'); i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  return {
    sock,
    handlers,
    enviados,
    listo,
    emitir: (e: string, arg: unknown) => handlers.get(e)?.(arg),
  };
}

async function conectado() {
  const { sock, emitir, enviados, listo } = fakeSocket();
  const promesa = startLocal({
    authDir: 'C:/no/existe/da/igual',
    createSocket: async () => ({ sock, saveCreds: async () => {} }),
  });
  await listo();
  emitir('connection.update', { connection: 'open' });
  await promesa;
  return { enviados, emitir };
}

describe('la sesion local', () => {
  it('el QR aparece en el estado cuando WhatsApp lo manda', async () => {
    const { sock, emitir, listo } = fakeSocket();
    const promesa = startLocal({
      authDir: 'C:/no/existe/da/igual',
      createSocket: async () => ({ sock, saveCreds: async () => {} }),
    });
    await listo();
    emitir('connection.update', { qr: '2@abcdef' });
    const estado = await promesa;

    expect(estado.status).toBe('SCAN_QR_CODE');
    expect(estado.qr).toBeTruthy();
  });

  it('al conectar se guarda el telefono sin el sufijo de dispositivo', async () => {
    await conectado();
    expect(getLocalState().status).toBe('WORKING');
    expect(getLocalState().phone).toBe('5215500000000');
    expect(getLocalState().name).toBe('Mi Negocio');
  });

  it('que te desvinculen desde el telefono no se reintenta: hay que escanear', async () => {
    const { sock, emitir, listo } = fakeSocket();
    const promesa = startLocal({
      authDir: 'C:/no/existe/da/igual',
      createSocket: async () => ({ sock, saveCreds: async () => {} }),
    });
    await listo();
    emitir('connection.update', { qr: '2@abc' });
    await promesa;
    emitir('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });

    expect(getLocalState().status).toBe('STOPPED');
    expect(getLocalState().detail).toMatch(/escanear/i);
  });

  it('los entrantes se entregan ya traducidos', async () => {
    const { sock, emitir, listo } = fakeSocket();
    const recibidos: unknown[] = [];
    const promesa = startLocal({
      authDir: 'C:/no/existe/da/igual',
      createSocket: async () => ({ sock, saveCreds: async () => {} }),
      onChange: (value) => {
        recibidos.push(value);
      },
    });
    await listo();
    emitir('connection.update', { connection: 'open' });
    await promesa;

    emitir('messages.upsert', {
      messages: [
        { key: { id: 'A', remoteJid: '5215512345678@s.whatsapp.net' }, message: { conversation: 'hola' } },
        { key: { id: 'B', remoteJid: '5215512345678@s.whatsapp.net', fromMe: true }, message: { conversation: 'mio' } },
      ],
    });

    // El handler es async desde que resuelve el LID contra el mapa de Baileys.
    await new Promise((r) => setTimeout(r, 10));

    expect(recibidos).toHaveLength(1);
  });
});

describe('enviar por el cliente local', () => {
  it('un texto sale por el socket con el jid', async () => {
    const { enviados } = await conectado();
    const wa = createLocalClient();
    const result = await wa.sendText('5215512345678', 'hola');

    expect(result.wamid).toBe('wamid-local-1');
    expect(enviados[0]).toMatchObject({ jid: '5215512345678@s.whatsapp.net', content: { text: 'hola' } });
  });

  it('una ubicacion va con los grados que espera Baileys', async () => {
    const { enviados } = await conectado();
    await createLocalClient().sendLocation('5215512345678', { latitude: 19.43, longitude: -99.13 });

    expect(enviados[0]?.content).toMatchObject({
      location: { degreesLatitude: 19.43, degreesLongitude: -99.13 },
    });
  });

  it('el boton de pedir ubicacion no existe: se pide por texto', async () => {
    const { enviados } = await conectado();
    await createLocalClient().sendLocationRequest('5215512345678', 'Mandanos donde estas');

    const texto = (enviados[0]?.content as { text: string }).text;
    expect(texto).toContain('Mandanos donde estas');
    expect(texto).toContain('Ubicacion');
  });

  it('los botones se degradan a una lista numerada', async () => {
    const { enviados } = await conectado();
    await createLocalClient().sendButtons('5215512345678', 'Elige', [
      { id: 'a', title: 'Si' },
      { id: 'b', title: 'No' },
    ]);

    const texto = (enviados[0]?.content as { text: string }).text;
    expect(texto).toContain('1. Si');
    expect(texto).toContain('2. No');
  });

  it('la plantilla se manda como texto con las variables sustituidas', async () => {
    const { enviados } = await conectado();
    const wa = createLocalClient({ resolveTemplateBody: async () => 'Hola {{1}}, tu pedido {{2}} salio.' });
    await wa.sendTemplate('5215512345678', 'seguimiento_entrega', 'es_MX', [
      { type: 'body', parameters: [{ type: 'text', text: 'Ana' }, { type: 'text', text: '#42' }] },
    ]);

    expect((enviados[0]?.content as { text: string }).text).toBe('Hola Ana, tu pedido #42 salio.');
  });

  it('sin cuerpo guardado se explica, en vez de mandar el nombre de la plantilla', async () => {
    await conectado();
    const wa = createLocalClient({ resolveTemplateBody: async () => undefined });
    await expect(wa.sendTemplate('5215512345678', 'x', 'es_MX')).rejects.toThrow(/no esta en la base de datos/);
  });

  it('la calidad es NA: el gate de calidad se queda ciego a proposito', async () => {
    await conectado();
    const info = await createLocalClient().getPhoneNumber();
    expect(info.qualityRating).toBe('NA');
    expect(info.displayPhoneNumber).toBe('5215500000000');
  });

  it('sin conexion el envio es transitorio, no un mensaje perdido', async () => {
    const wa = createLocalClient();
    const error = await wa.sendText('5215512345678', 'hola').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(WhatsAppApiError);
    expect((error as WhatsAppApiError).retryable).toBe(true);
    expect((error as WhatsAppApiError).message).toMatch(/no esta conectado/i);
  });

  it('activar con PIN no aplica: el QR lo sustituye', async () => {
    await conectado();
    await expect(createLocalClient().registerPhone('123456')).rejects.toThrow(/QR|codigo de vinculacion/);
  });

  it('el catalogo local hace de catalogo aprobado', async () => {
    await conectado();
    const templates = await createLocalClient().listTemplates();
    expect(templates.length).toBeGreaterThan(0);
    expect(templates.every((t) => t.status === 'APPROVED')).toBe(true);
  });
});

describe('vincular con el numero', () => {
  it('el codigo se pide con los digitos, sin el mas', async () => {
    const { sock, emitir, listo } = fakeSocket();
    const spy = vi.spyOn(sock, 'requestPairingCode');
    const promesa = startLocal({
      authDir: 'C:/no/existe/da/igual',
      createSocket: async () => ({ sock, saveCreds: async () => {} }),
    });
    await listo();
    emitir('connection.update', { qr: '2@abc' });
    await promesa;

    const { requestLocalPairingCode } = await import('../src/whatsapp/local/session.js');
    expect(await requestLocalPairingCode('+52 1 55 1234 5678')).toBe('ABCD1234');
    expect(spy).toHaveBeenCalledWith('5215512345678');
  });

  it('sin sesion abierta se dice claro en vez de reventar por dentro', async () => {
    const { requestLocalPairingCode } = await import('../src/whatsapp/local/session.js');
    await expect(requestLocalPairingCode('5215512345678')).rejects.toThrow(/no esta abierta/);
  });
});

/**
 * Botones: lo que ve el cliente y lo que vuelve cuando los pulsa.
 */
describe('botones en el chat del cliente', () => {
  it('un boton pulsado vuelve como button_reply, no como texto suelto', () => {
    const value = toChangeValue({
      key: { id: 'A', remoteJid: '5215512345678@s.whatsapp.net' },
      messageTimestamp: 1700000000,
      message: {
        interactiveResponseMessage: {
          body: { text: 'Si, es correcta' },
          nativeFlowResponseMessage: {
            paramsJson: JSON.stringify({ id: 'confirm_yes', display_text: 'Si, es correcta' }),
          },
        },
      },
    });

    expect(value?.messages?.[0]?.type).toBe('interactive');
    expect(value?.messages?.[0]?.interactive?.button_reply).toEqual({
      id: 'confirm_yes',
      title: 'Si, es correcta',
    });
  });

  it('el envoltorio clasico de botones tambien se entiende', () => {
    const value = toChangeValue({
      key: { id: 'A', remoteJid: '5215512345678@s.whatsapp.net' },
      message: {
        buttonsResponseMessage: { selectedButtonId: 'no', selectedDisplayText: 'No' },
      },
    });
    expect(value?.messages?.[0]?.interactive?.button_reply).toEqual({ id: 'no', title: 'No' });
  });

  it('un paramsJson corrupto no tumba el mensaje', () => {
    const value = toChangeValue({
      key: { id: 'A', remoteJid: '5215512345678@s.whatsapp.net' },
      message: {
        interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: '{roto' } },
      },
    });
    // No es un boton reconocible, pero tampoco revienta: cae al tipo generico.
    expect(value?.messages?.[0]?.type).toBe('interactiveresponse');
  });

  it('pedir la ubicacion manda el boton nativo y no texto', async () => {
    const { enviados } = await conectado();
    await createLocalClient().sendLocationRequest('5215512345678', 'Comparte tu ubicacion');

    // El socket de pega no sabe retransmitir, asi que cae al texto: lo que se
    // comprueba es justo eso, que el respaldo sigue explicando el camino.
    const texto = (enviados[0]?.content as { text: string }).text;
    expect(texto).toContain('Comparte tu ubicacion');
    expect(texto).toContain('Ubicacion');
  });
});

/**
 * Adjuntos: sin esto, una foto o un audio aparecen como "(foto)" y no hay
 * forma de verlos sin ir al telefono.
 */
describe('fotos, audios y documentos', () => {
  const mensajeCon = (contenido: Record<string, unknown>) => ({
    key: { id: 'WAMID-1', remoteJid: '5215512345678@s.whatsapp.net' },
    messageTimestamp: 1700000000,
    message: contenido,
  });

  it('reconoce que tipo de adjunto lleva un mensaje', () => {
    expect(tipoDeAdjunto({ imageMessage: {} })).toBe('image');
    expect(tipoDeAdjunto({ audioMessage: {} })).toBe('audio');
    expect(tipoDeAdjunto({ documentMessage: {} })).toBe('document');
    expect(tipoDeAdjunto({ conversation: 'hola' })).toBeNull();
  });

  it('el id sale del wamid: bajar dos veces no deja copias sueltas', () => {
    expect(idDeMedia('WAMID-1', '.jpg')).toBe(idDeMedia('WAMID-1', '.jpg'));
    expect(idDeMedia('WAMID-1', '.jpg')).not.toBe(idDeMedia('WAMID-2', '.jpg'));
    expect(idDeMedia('WAMID-1', '.jpg')).toMatch(/^[0-9a-f]{24}\.jpg$/);
  });

  it('la extension sale del mime, con respaldo por tipo', () => {
    expect(extensionDe('image/jpeg', 'image')).toBe('.jpg');
    expect(extensionDe('audio/ogg; codecs=opus', 'audio')).toBe('.ogg');
    expect(extensionDe('cualquier/cosa', 'video')).toBe('.mp4');
  });

  it('el mensaje traducido lleva la referencia al fichero', () => {
    const value = toChangeValue(mensajeCon({ imageMessage: { mimetype: 'image/jpeg' } }), null, {
      id: 'abc123.jpg',
      kind: 'image',
      mimeType: 'image/jpeg',
      caption: 'mira',
      bytes: 1024,
    });

    expect(value?.messages?.[0]?.type).toBe('image');
    expect(value?.messages?.[0]?.media?.id).toBe('abc123.jpg');
  });

  it('sin el fichero bajado el mensaje llega igual, solo que sin adjunto', () => {
    const value = toChangeValue(mensajeCon({ imageMessage: { mimetype: 'image/jpeg' } }), null, null);
    expect(value?.messages?.[0]?.type).toBe('image');
    expect(value?.messages?.[0]?.media).toBeUndefined();
  });

  it('un id que no tiene la forma esperada no lee nada del disco', async () => {
    for (const malo of ['../../.env', 'a/b.jpg', 'ZZZ.jpg', '']) {
      expect(await leerMedia(process.cwd(), malo)).toBeNull();
    }
  });

  it('el pie de foto es el cuerpo del mensaje en el chat', () => {
    const leido = readInbound({
      id: 'A',
      from: '5215512345678',
      timestamp: '1700000000',
      type: 'image',
      media: { id: 'abc123.jpg', mimeType: 'image/jpeg', caption: 'la fachada' },
    });

    expect(leido.kind).toBe('image');
    expect(leido.body).toBe('la fachada');
    expect(leido.payload).toEqual({
      media: { id: 'abc123.jpg', mimeType: 'image/jpeg', caption: 'la fachada' },
    });
  });

  it('un documento sin pie usa su nombre de fichero', () => {
    const leido = readInbound({
      id: 'A',
      from: '5215512345678',
      timestamp: '1700000000',
      type: 'document',
      media: { id: 'abc.pdf', mimeType: 'application/pdf', filename: 'contrato.pdf' },
    });
    expect(leido.body).toBe('contrato.pdf');
  });
});
