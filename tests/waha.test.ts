/**
 * El proveedor WAHA.
 *
 * Lo que importa probar aqui no es que se llame a una URL, sino que las
 * degradaciones sean las prometidas: WAHA no tiene plantillas, ni boton de
 * ubicacion, ni calidad de numero, y el sistema entero da por hecho que si.
 * Si alguna de esas degradaciones se rompe, el fallo aparece en produccion
 * como un mensaje que no sale, no como un error.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  chatIdFromMessageId,
  createWahaClient,
  fromChatId,
  renderComponentsIntoBody,
  toChatId,
} from '../src/whatsapp/waha/client.js';
import { ackToStatus, toChangeValue } from '../src/whatsapp/waha/webhook.js';
import {
  CANDIDATOS_WAHA,
  detectWaha,
  ensureSession,
  getSession,
  requestPairingCode,
  webhookYaApunta,
} from '../src/whatsapp/waha/session.js';
import { signWahaPayload, verifyWahaSignature } from '../src/whatsapp/signature.js';
import { WhatsAppApiError } from '../src/whatsapp/client.js';
import { CATALOG } from '../src/templates/catalog.js';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp, CLAVE_API_PRUEBA as ADMIN } from './fakes.js';

const noopQueue: OutboundQueue = {
  async enqueue() {},
  async enqueueMany(jobs) {
    return jobs.length;
  },
  async pause() {},
  async resume() {},
  async counts() {
    return {};
  },
  async close() {},
};

/** Devuelve una respuesta por URL y anota lo que se pidio. */
function fakeFetch(rutas: Array<[RegExp, unknown, number?]>) {
  const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    calls.push({
      url: href,
      method: init?.method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const match = rutas.find(([re]) => re.test(href));
    if (!match) return new Response(JSON.stringify({ message: 'ruta no simulada: ' + href }), { status: 404 });
    return new Response(JSON.stringify(match[1]), { status: match[2] ?? 200 });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const BASE = 'http://waha.local:3000';

function cliente(rutas: Array<[RegExp, unknown, number?]>, extra = {}) {
  const { impl, calls } = fakeFetch(rutas);
  const wa = createWahaClient({ baseUrl: BASE, session: 'default', fetchImpl: impl, ...extra });
  return { wa, calls };
}

describe('identificadores de chat', () => {
  it('un telefono se convierte en chatId', () => {
    expect(toChatId('5215512345678')).toBe('5215512345678@c.us');
    expect(toChatId('+52 155 1234 5678')).toBe('5215512345678@c.us');
  });

  it('un chatId ya formado se respeta, para no romper los grupos', () => {
    expect(toChatId('12312312123133@g.us')).toBe('12312312123133@g.us');
  });

  it('del chatId se saca el telefono', () => {
    expect(fromChatId('5215512345678@c.us')).toBe('5215512345678');
  });

  it('del id de un mensaje se saca su chat', () => {
    // Hace falta porque markAsRead solo recibe el id pero sendSeen pide el chat.
    expect(chatIdFromMessageId('true_5215512345678@c.us_3EB0AAA')).toBe('5215512345678@c.us');
    expect(chatIdFromMessageId('sin-chat')).toBeUndefined();
  });
});

describe('enviar por WAHA', () => {
  it('un texto va a /api/sendText con el chatId', async () => {
    const { wa, calls } = cliente([[/sendText/, { id: 'true_x@c.us_1' }]]);
    const result = await wa.sendText('5215512345678', 'hola');

    expect(result.wamid).toBe('true_x@c.us_1');
    expect(calls[0]!.url).toBe(`${BASE}/api/sendText`);
    expect(calls[0]!.body).toMatchObject({
      session: 'default',
      chatId: '5215512345678@c.us',
      text: 'hola',
    });
  });

  it('una ubicacion va a /api/sendLocation', async () => {
    const { wa, calls } = cliente([[/sendLocation/, { id: 'm1' }]]);
    await wa.sendLocation('5215512345678', { latitude: 19.43, longitude: -99.13, name: 'Centro' });

    expect(calls[0]!.body).toMatchObject({ latitude: 19.43, longitude: -99.13, title: 'Centro' });
  });

  it('el boton de pedir ubicacion no existe: se pide por texto', async () => {
    const { wa, calls } = cliente([[/sendText/, { id: 'm1' }]]);
    await wa.sendLocationRequest('5215512345678', 'Necesitamos tu ubicacion');

    expect(calls[0]!.url).toContain('/api/sendText');
    const texto = (calls[0]!.body as { text: string }).text;
    expect(texto).toContain('Necesitamos tu ubicacion');
    // Sin la instruccion, el cliente no sabe que hacer con el mensaje.
    expect(texto).toContain('Ubicación');
  });

  it('los botones se degradan a una lista numerada', async () => {
    const { wa, calls } = cliente([[/sendText/, { id: 'm1' }]]);
    await wa.sendButtons('5215512345678', 'Confirmas?', [
      { id: 'si', title: 'Si' },
      { id: 'no', title: 'No' },
    ]);

    const texto = (calls[0]!.body as { text: string }).text;
    expect(texto).toContain('1. Si');
    expect(texto).toContain('2. No');
  });

  it('marcar como leido saca el chat del id del mensaje', async () => {
    const { wa, calls } = cliente([[/sendSeen/, {}]]);
    await wa.markAsRead('true_5215512345678@c.us_3EB0');

    expect(calls[0]!.body).toMatchObject({
      chatId: '5215512345678@c.us',
      messageId: 'true_5215512345678@c.us_3EB0',
    });
  });

  it('un id sin chat no rompe: no se marca nada', async () => {
    const { wa, calls } = cliente([[/sendSeen/, {}]]);
    await expect(wa.markAsRead('id-raro')).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});

describe('plantillas sin plantillas', () => {
  it('se manda el cuerpo guardado con las variables ya sustituidas', async () => {
    const { wa, calls } = cliente([[/sendText/, { id: 'm1' }]], {
      resolveTemplateBody: async () => 'Hola {{1}}, tu pedido #{{2}} salio.',
    });

    await wa.sendTemplate('5215512345678', 'confirmacion_pedido', 'es', [
      { type: 'body', parameters: [{ type: 'text', text: 'Ana' }, { type: 'text', text: '42' }] },
    ]);

    expect((calls[0]!.body as { text: string }).text).toBe('Hola Ana, tu pedido #42 salio.');
  });

  it('sin cuerpo guardado se explica, en vez de mandar el nombre de la plantilla', async () => {
    const { wa } = cliente([[/sendText/, { id: 'm1' }]], {
      resolveTemplateBody: async () => undefined,
    });

    await expect(wa.sendTemplate('521551', 'no_existe', 'es')).rejects.toThrow(/no esta en la base de datos/);
  });

  it('el catalogo local hace de catalogo aprobado: no hay a quien pedirle permiso', async () => {
    const { wa } = cliente([]);
    const templates = await wa.listTemplates();

    expect(templates).toHaveLength(CATALOG.length);
    expect(templates.every((t) => t.status === 'APPROVED')).toBe(true);
    expect(templates[0]!.components?.[0]).toMatchObject({ type: 'BODY' });
  });

  it('dar de alta una plantilla no aplica y se dice claro', async () => {
    const { wa } = cliente([]);
    await expect(wa.createTemplate({
      name: 'x', language: 'es', category: 'UTILITY', body: 'x', examples: [],
    })).rejects.toThrow(/no tiene plantillas/);
  });

  it('sustituir variables tolera huecos sin dejar el {{n}} a la vista', () => {
    expect(renderComponentsIntoBody('Hola {{1}} y {{2}}', [
      { type: 'body', parameters: [{ type: 'text', text: 'Ana' }] },
    ])).toBe('Hola Ana y ');
  });
});

describe('lo que WAHA no sabe del numero', () => {
  it('la calidad es NA: el gate de calidad se queda ciego a proposito', async () => {
    const { wa } = cliente([[/\/me/, { id: '5215512345678@c.us', pushName: 'Tienda' }]]);
    const info = await wa.getPhoneNumber();

    expect(info).toMatchObject({
      displayPhoneNumber: '5215512345678',
      verifiedName: 'Tienda',
      qualityRating: 'NA',
      messagingLimitTier: '',
    });
  });

  it('activar con PIN no aplica: el QR lo sustituye', async () => {
    const { wa } = cliente([]);
    await expect(wa.registerPhone('123456')).rejects.toThrow(/codigo QR/);
  });

  it('suscribir la app es un no-op, no un fallo', async () => {
    const { wa } = cliente([]);
    await expect(wa.subscribeApp()).resolves.toEqual({ success: true });
  });
});

describe('errores de WAHA', () => {
  it('un 5xx se marca reintentable y un 4xx no', async () => {
    const { wa: caido } = cliente([[/sendText/, { message: 'boom' }, 500]]);
    await expect(caido.sendText('521551', 'x')).rejects.toMatchObject({ retryable: true });

    const { wa: malo } = cliente([[/sendText/, { message: 'chatId invalido' }, 422]]);
    await expect(malo.sendText('521551', 'x')).rejects.toMatchObject({ retryable: false });
  });

  it('el contenedor apagado es transitorio, no un mensaje perdido', async () => {
    const impl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const wa = createWahaClient({ baseUrl: BASE, fetchImpl: impl });

    await expect(wa.sendText('521551', 'x')).rejects.toMatchObject({
      retryable: true,
      httpStatus: 503,
    });
    await expect(wa.sendText('521551', 'x')).rejects.toBeInstanceOf(WhatsAppApiError);
  });
});

describe('traducir el webhook de WAHA', () => {
  it('un mensaje de texto se convierte en el formato de siempre', () => {
    const value = toChangeValue({
      event: 'message',
      payload: {
        id: 'false_5215512345678@c.us_AAA',
        from: '5215512345678@c.us',
        body: 'hola',
        timestamp: 1741249702,
        notifyName: 'Ana',
      },
    });

    expect(value?.messages?.[0]).toMatchObject({
      id: 'false_5215512345678@c.us_AAA',
      from: '5215512345678',
      type: 'text',
      text: { body: 'hola' },
    });
    expect(value?.contacts?.[0]?.profile?.name).toBe('Ana');
  });

  it('una ubicacion llega como ubicacion, no como texto vacio', () => {
    const value = toChangeValue({
      event: 'message',
      payload: {
        id: 'm1',
        from: '5215512345678@c.us',
        location: { latitude: 19.43, longitude: -99.13, name: 'Centro' },
      },
    });

    expect(value?.messages?.[0]?.type).toBe('location');
    expect(value?.messages?.[0]?.location).toMatchObject({ latitude: 19.43, longitude: -99.13 });
  });

  it('los mensajes propios se ignoran: contestarse a si mismo es un bucle', () => {
    expect(toChangeValue({
      event: 'message',
      payload: { id: 'm1', from: '5215512345678@c.us', body: 'hola', fromMe: true },
    })).toBeNull();
  });

  it('un mensaje sin id o sin remitente se descarta', () => {
    expect(toChangeValue({ event: 'message', payload: { body: 'hola' } })).toBeNull();
  });

  it('la respuesta citando un mensaje llega con la cita (context.id), como en Meta', () => {
    const conReplyTo = toChangeValue({
      event: 'message',
      payload: { id: 'm2', from: '51987555101@c.us', body: '30', replyTo: { id: '3EB0ABCDEF12', participant: '51999000000@c.us', body: 'Nuevo pedido' } },
    });
    expect(conReplyTo?.messages?.[0]?.context?.id).toBe('3EB0ABCDEF12');

    const conStanza = toChangeValue({
      event: 'message',
      payload: { id: 'm3', from: '51987555101@c.us', body: '30', _data: { quotedStanzaID: '3EB0FEDCBA98' } },
    });
    expect(conStanza?.messages?.[0]?.context?.id).toBe('3EB0FEDCBA98');

    const sinCita = toChangeValue({ event: 'message', payload: { id: 'm4', from: '51987555101@c.us', body: '30' } });
    expect(sinCita?.messages?.[0]?.context).toBeUndefined();
  });

  it('un remitente @lid se lee con su teléfono real, no con los dígitos del LID', () => {
    const value = toChangeValue({
      event: 'message',
      payload: {
        id: 'm5',
        from: '123456789012345@lid',
        body: 'hola',
        _data: { key: { remoteJid: '123456789012345@lid', remoteJidAlt: '51987555101@s.whatsapp.net' } },
      },
    });
    expect(value?.messages?.[0]?.from).toBe('51987555101');
    expect(value?.contacts).toBeUndefined();

    const conSenderPn = toChangeValue({
      event: 'message',
      payload: { id: 'm6', from: '123456789012345@lid', body: 'hola', notifyName: 'Ana', _data: { key: { senderPn: '51987555102@s.whatsapp.net' } } },
    });
    expect(conSenderPn?.messages?.[0]?.from).toBe('51987555102');
    expect(conSenderPn?.contacts?.[0]?.wa_id).toBe('51987555102');

    // Solo el LID, sin teléfono: se descarta (no se inventa un cliente).
    expect(toChangeValue({ event: 'message', payload: { id: 'm7', from: '123456789012345@lid', body: 'hola' } })).toBeNull();
  });

  it('los acks numericos se traducen al vocabulario de Meta', () => {
    expect(ackToStatus(1)).toBe('sent');
    expect(ackToStatus(2)).toBe('delivered');
    expect(ackToStatus(3)).toBe('read');
    expect(ackToStatus(-1)).toBe('failed');
    expect(ackToStatus(99)).toBeNull();
  });

  it('un ack se convierte en actualizacion de estado', () => {
    const value = toChangeValue({
      event: 'message.ack',
      payload: { id: 'm1', ack: 2, to: '5215512345678@c.us' },
    });

    expect(value?.statuses?.[0]).toMatchObject({
      id: 'm1',
      status: 'delivered',
      recipient_id: '5215512345678',
    });
  });

  it('lo que el sistema no trata se ignora en vez de inventarse', () => {
    expect(toChangeValue({ event: 'presence.update', payload: {} })).toBeNull();
    expect(toChangeValue({ event: 'call.received', payload: {} })).toBeNull();
  });
});

describe('firma del webhook de WAHA', () => {
  const cuerpo = '{"event":"message","session":"default"}';

  it('la firma buena pasa', () => {
    const firma = signWahaPayload(cuerpo, 'clave');
    expect(verifyWahaSignature(cuerpo, firma, 'clave')).toBe(true);
  });

  it('otra clave no pasa', () => {
    expect(verifyWahaSignature(cuerpo, signWahaPayload(cuerpo, 'otra'), 'clave')).toBe(false);
  });

  it('sin cabecera no pasa: el endpoint no es abierto', () => {
    expect(verifyWahaSignature(cuerpo, undefined, 'clave')).toBe(false);
  });

  it('es sha512, no sha256 como Meta', () => {
    expect(signWahaPayload(cuerpo, 'clave')).toHaveLength(128);
  });
});

describe('ciclo de vida de la sesion', () => {
  it('si la sesion no existe se crea arrancada y con su webhook', async () => {
    const { impl, calls } = fakeFetch([
      [/\/api\/sessions\/default$/, { message: 'not found' }, 404],
      [/\/api\/sessions$/, { name: 'default', status: 'STARTING' }],
    ]);

    const session = await ensureSession({
      baseUrl: BASE,
      fetchImpl: impl,
      webhookUrl: 'http://localhost:3000/webhooks/waha',
      hmacKey: 'secreta',
    });

    expect(session.status).toBe('STARTING');
    const creacion = calls.find((c) => c.method === 'POST')!;
    expect(creacion.body).toMatchObject({ name: 'default', start: true });
    const config = (creacion.body as { config: { webhooks: Array<Record<string, unknown>> } }).config;
    expect(config.webhooks[0]).toMatchObject({
      url: 'http://localhost:3000/webhooks/waha',
      hmac: { key: 'secreta' },
    });
    // Sin estos eventos no hay chat ni doble check.
    expect(config.webhooks[0]!.events).toEqual(['message', 'message.ack', 'session.status']);
  });

  it('una sesion que no existe se reporta como null, no como error', async () => {
    const { impl } = fakeFetch([[/\/api\/sessions\/default$/, { message: 'not found' }, 404]]);
    await expect(getSession({ baseUrl: BASE, fetchImpl: impl })).resolves.toBeNull();
  });

  it('el contenedor apagado se explica con su direccion', async () => {
    const impl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    await expect(getSession({ baseUrl: BASE, fetchImpl: impl })).rejects.toThrow(/waha\.local/);
  });
});

/**
 * El endpoint entero, montado como en produccion: firma, 200 inmediato y el
 * mensaje acabando donde acaban los de Meta. Es la prueba de que cambiar de
 * proveedor no obliga a tocar nada aguas abajo.
 */
describe('el webhook de WAHA dentro del servidor', () => {
    const HMAC = 'clave-hmac-de-waha';

  async function montar() {
    const config = loadConfig({
      PUBLIC_BASE_URL: 'http://localhost:3000',
      DATABASE_URL: 'mysql://x/y',
      WHATSAPP_PROVIDER: 'waha',
      WAHA_URL: BASE,
      WHATSAPP_VERIFY_TOKEN: HMAC,
      TRACKING_SECRET: 'x'.repeat(40),
      GEO_BBOX: 'mexico',
    } as NodeJS.ProcessEnv);

    const repos = createFakeRepos();
    const wa = createFakeWhatsApp();
    const sender = createSender({
      repos,
      wa,
      phoneNumberId: 'PNID',
      warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 },
      maxMarketingPerContact7d: 2,
    });
    const settings = await createFakeSettings(config);
    const app = await buildServer({
      config,
      repos,
      settings,
      wa,
      sender,
      queue: noopQueue,
      logger: false,
    });
    await app.ready();
    return { app, repos, config, settings };
  }

  function entrega(cuerpo: unknown) {
    const payload = JSON.stringify(cuerpo);
    return {
      payload,
      headers: {
        'content-type': 'application/json',
        'x-webhook-hmac': signWahaPayload(payload, HMAC),
      },
    };
  }

  it('con WAHA el sistema se da por configurado sin token de Meta', async () => {
    const { app, settings } = await montar();
    expect(settings.missing()).toEqual([]);
    expect(settings.isConfigured()).toBe(true);
    await app.close();
  });

  it('una firma invalida se rechaza con 401', async () => {
    const { app } = await montar();
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/waha',
      payload: JSON.stringify({ event: 'message' }),
      headers: { 'content-type': 'application/json', 'x-webhook-hmac': 'a'.repeat(128) },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('sin cabecera de firma tampoco entra', async () => {
    const { app } = await montar();
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/waha',
      payload: JSON.stringify({ event: 'message' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('un mensaje bien firmado entra y queda guardado como cualquier otro', async () => {
    const { app, repos } = await montar();

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/waha',
      ...entrega({
        event: 'message',
        session: 'default',
        payload: {
          id: 'false_5215512345678@c.us_ABC',
          from: '5215512345678@c.us',
          body: 'hola, quiero informacion',
          timestamp: Math.floor(Date.now() / 1000),
          notifyName: 'Ana',
        },
      }),
    });

    expect(response.statusCode).toBe(200);

    // El endpoint responde antes de procesar, a proposito.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const contacto = await repos.contacts.getByPhone('5215512345678');
    expect(contacto).toBeTruthy();
    await app.close();
  });

  it('el geo core funciona igual: un link de mapa deja su ubicacion', async () => {
    const { app, repos } = await montar();

    await app.inject({
      method: 'POST',
      url: '/webhooks/waha',
      ...entrega({
        event: 'message',
        payload: {
          id: 'false_5215512345678@c.us_GEO',
          from: '5215512345678@c.us',
          body: 'estoy en https://maps.google.com/?q=19.4326,-99.1332',
          timestamp: Math.floor(Date.now() / 1000),
        },
      }),
    });

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(repos._locations.length).toBeGreaterThan(0);
    expect(repos._locations[0]).toMatchObject({ lat: 19.4326, lng: -99.1332 });
    await app.close();
  });

  it('la pantalla puede pedir el codigo de vinculacion por la API', async () => {
    const { impl, calls } = fakeFetch([[/\/auth\/request-code$/, { code: 'ABCD1234' }]]);
    vi.stubGlobal('fetch', impl);
    const { app } = await montar();

    const response = await app.inject({
      method: 'POST',
      url: '/admin/waha/request-code',
      headers: { authorization: `Bearer ${ADMIN}` },
      payload: { phone: '+52 1 55 1234 5678' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, code: 'ABCD1234' });
    expect(calls[0]!.body).toEqual({ phoneNumber: '5215512345678' });

    vi.unstubAllGlobals();
    await app.close();
  });

  it('si WAHA no da codigo, la respuesta manda al QR en vez de fallar en blanco', async () => {
    const { impl } = fakeFetch([[/\/auth\/request-code$/, {}]]);
    vi.stubGlobal('fetch', impl);
    const { app } = await montar();

    const response = await app.inject({
      method: 'POST',
      url: '/admin/waha/request-code',
      headers: { authorization: `Bearer ${ADMIN}` },
      payload: { phone: '5215512345678' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/QR/);

    vi.unstubAllGlobals();
    await app.close();
  });

  it('pedir el codigo tambien esta detras del token de admin', async () => {
    const { app } = await montar();
    const response = await app.inject({
      method: 'POST',
      url: '/admin/waha/request-code',
      payload: { phone: '5215512345678' },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('la busqueda del contenedor prueba primero la direccion ya guardada', async () => {
    const vistas: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        vistas.push(String(url));
        return new Response(JSON.stringify([]), { status: 200 });
      }),
    );
    const { app } = await montar();

    const response = await app.inject({
      method: 'GET',
      url: '/admin/waha/detect',
      headers: { authorization: `Bearer ${ADMIN}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().found).toBe(BASE);
    expect(vistas[0]).toBe(`${BASE}/api/sessions`);

    vi.unstubAllGlobals();
    await app.close();
  });
});

describe('reconectar no debe tumbar una sesion que ya funciona', () => {
  const WEBHOOK = 'http://localhost:3000/webhooks/waha';

  it('si el webhook ya apunta aqui, no se manda PUT', async () => {
    // WAHA para y arranca la sesion al recibir un PUT: hacerlo cada vez que el
    // usuario pulsa "conectar" le cortaria WhatsApp sin motivo.
    const { impl, calls } = fakeFetch([
      [
        /\/api\/sessions\/default$/,
        {
          name: 'default',
          status: 'WORKING',
          config: { webhooks: [{ url: WEBHOOK, hmac: { key: 'secreta' } }] },
        },
      ],
    ]);

    await ensureSession({
      baseUrl: BASE,
      fetchImpl: impl,
      webhookUrl: WEBHOOK,
      hmacKey: 'secreta',
    });

    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    expect(calls.every((c) => c.method === 'GET' || c.method === undefined)).toBe(true);
  });

  it('si el webhook cambio de URL, si se actualiza', async () => {
    const { impl, calls } = fakeFetch([
      [
        /\/api\/sessions\/default$/,
        {
          name: 'default',
          status: 'WORKING',
          config: { webhooks: [{ url: 'https://tunel-viejo.test/webhooks/waha', hmac: { key: 'secreta' } }] },
        },
      ],
    ]);

    await ensureSession({ baseUrl: BASE, fetchImpl: impl, webhookUrl: WEBHOOK, hmacKey: 'secreta' });

    const put = calls.find((c) => c.method === 'PUT');
    expect(put).toBeTruthy();
    // WAHA exige la configuracion completa, con el nombre.
    expect(put!.body).toMatchObject({ name: 'default' });
  });

  it('si cambio la clave del HMAC, tambien se actualiza', async () => {
    const { impl, calls } = fakeFetch([
      [
        /\/api\/sessions\/default$/,
        {
          name: 'default',
          status: 'WORKING',
          config: { webhooks: [{ url: WEBHOOK, hmac: { key: 'la-de-antes' } }] },
        },
      ],
    ]);

    await ensureSession({ baseUrl: BASE, fetchImpl: impl, webhookUrl: WEBHOOK, hmacKey: 'nueva' });
    expect(calls.some((c) => c.method === 'PUT')).toBe(true);
  });

  it('una sesion parada se arranca aunque su webhook ya estuviera bien', async () => {
    const { impl, calls } = fakeFetch([
      [
        /\/api\/sessions\/default\/start$/,
        { name: 'default', status: 'STARTING' },
      ],
      [
        /\/api\/sessions\/default$/,
        {
          name: 'default',
          status: 'STOPPED',
          config: { webhooks: [{ url: WEBHOOK, hmac: { key: 'secreta' } }] },
        },
      ],
    ]);

    await ensureSession({ baseUrl: BASE, fetchImpl: impl, webhookUrl: WEBHOOK, hmacKey: 'secreta' });

    expect(calls.some((c) => c.url.endsWith('/start'))).toBe(true);
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('sin sesion autenticada, me llega nulo y no rompe', () => {
    expect(webhookYaApunta({ name: 'default', status: 'STOPPED', me: null }, WEBHOOK, 'k')).toBe(false);
  });
});

describe('el wamid nunca puede repetirse', () => {
  it('sin id, WAHA no puede tumbar la entrega con una clave duplicada', async () => {
    // `deliveries.wamid` es unico: devolver siempre la misma cadena hacia que
    // el SEGUNDO envio fallara con violacion de unicidad, aunque el mensaje
    // hubiera salido. Paso de verdad contra la base de datos real.
    const { wa } = cliente([[/sendText/, {}]]);

    const uno = await wa.sendText('5215512345678', 'a');
    const dos = await wa.sendText('5215512345678', 'b');

    expect(uno.wamid).not.toBe('');
    expect(uno.wamid).not.toBe(dos.wamid);
    expect(uno.wamid.startsWith('waha:local:')).toBe(true);
  });

  it('con id de WAHA se respeta tal cual', async () => {
    const { wa } = cliente([[/sendText/, { id: 'true_x@c.us_REAL' }]]);
    expect((await wa.sendText('521551', 'a')).wamid).toBe('true_x@c.us_REAL');
  });

  it('el id envuelto en _serialized tambien se entiende', async () => {
    const { wa } = cliente([[/sendText/, { id: { _serialized: 'true_x@c.us_SER' } }]]);
    expect((await wa.sendText('521551', 'a')).wamid).toBe('true_x@c.us_SER');
  });
});

describe('vincular con el numero en vez de con el QR', () => {
  it('el codigo se pide con el numero en digitos, sin el mas ni espacios', async () => {
    const { impl, calls } = fakeFetch([[/\/auth\/request-code$/, { code: 'ABCD1234' }]]);

    const code = await requestPairingCode({ baseUrl: BASE, session: 'default', fetchImpl: impl }, '+52 1 55 1234 5678');

    expect(code).toBe('ABCD1234');
    expect(calls[0]!.url).toBe(`${BASE}/api/default/auth/request-code`);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.body).toEqual({ phoneNumber: '5215512345678' });
  });

  it('algunas versiones lo llaman pairingCode', async () => {
    const { impl } = fakeFetch([[/\/auth\/request-code$/, { pairingCode: 'ZZZZ9999' }]]);
    const code = await requestPairingCode({ baseUrl: BASE, fetchImpl: impl }, '5215512345678');
    expect(code).toBe('ZZZZ9999');
  });

  it('un numero que no trae digitos se corta aqui, sin llamar a WAHA', async () => {
    const { impl, calls } = fakeFetch([[/\/auth\/request-code$/, { code: 'X' }]]);
    await expect(requestPairingCode({ baseUrl: BASE, fetchImpl: impl }, '+- ')).rejects.toThrow(
      /falta el numero/,
    );
    expect(calls).toHaveLength(0);
  });

  it('un motor que no lo soporta propaga el motivo, para poder ofrecer el QR', async () => {
    const { impl } = fakeFetch([[/\/auth\/request-code$/, { message: 'not supported by engine' }, 422]]);
    await expect(requestPairingCode({ baseUrl: BASE, fetchImpl: impl }, '5215512345678')).rejects.toThrow(
      /not supported by engine/,
    );
  });
});

describe('encontrar el contenedor solo', () => {
  it('se queda con el primero que conteste una lista de sesiones', async () => {
    const impl = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.startsWith('http://localhost:3001')) return new Response(JSON.stringify([]), { status: 200 });
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;

    expect(await detectWaha(['http://localhost:3000', 'http://localhost:3001'], impl)).toBe(
      'http://localhost:3001',
    );
  });

  it('otra cosa escuchando en ese puerto no cuela: se exige la lista', async () => {
    // Este mismo servidor suele estar en el 3000 y responde JSON a muchas
    // rutas; lo que no devuelve nunca es un array en /api/sessions.
    const impl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, hola: 'no soy waha' }), { status: 200 }),
    ) as unknown as typeof fetch;

    expect(await detectWaha(['http://localhost:3000'], impl)).toBeNull();
  });

  it('sin contenedor a la vista devuelve null en vez de reventar', async () => {
    const impl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    expect(await detectWaha(['http://localhost:3000'], impl)).toBeNull();
  });

  it('la direccion guardada se prueba antes que las de siempre', async () => {
    const vistas: string[] = [];
    const impl = vi.fn(async (url: string | URL | Request) => {
      vistas.push(String(url));
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch;

    await detectWaha(['http://waha.miempresa.local', ...CANDIDATOS_WAHA], impl);
    expect(vistas[0]).toBe('http://waha.miempresa.local/api/sessions');
  });

  it('la barra final no se duplica en la ruta', async () => {
    const vistas: string[] = [];
    const impl = vi.fn(async (url: string | URL | Request) => {
      vistas.push(String(url));
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch;

    expect(await detectWaha(['http://localhost:3001/'], impl)).toBe('http://localhost:3001');
    expect(vistas[0]).toBe('http://localhost:3001/api/sessions');
  });
});
