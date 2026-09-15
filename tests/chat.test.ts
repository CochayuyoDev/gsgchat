/**
 * El chat: conversaciones, hilo y envio.
 *
 * Lo que se prueba aqui no es la pantalla, es que la conversacion se GUARDE
 * sola: un mensaje que entra por el webhook y una respuesta que sale por el
 * sender tienen que aparecer los dos en el hilo, en orden y con su estado.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { processChange } from '../src/whatsapp/webhook.js';
import { readInbound } from '../src/handlers/inbound.js';
import {
  approvedTemplate,
  createFakeRepos,
  createFakeSettings,
  createFakeWhatsApp,
  type FakeRepos,
  type FakeWhatsApp,
  CLAVE_API_PRUEBA as ADMIN,
} from './fakes.js';
import type { ChangeValue, InboundMessage } from '../src/whatsapp/types.js';
import type { Sender } from '../src/outbound/sender.js';

const auth = { authorization: `Bearer ${ADMIN}` };

const ENV = {
  PUBLIC_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_ID: '123456',
  WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'mexico',
} as NodeJS.ProcessEnv;

const queue: OutboundQueue = {
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

let app: FastifyInstance;
let repos: FakeRepos;
let wa: FakeWhatsApp;
let sender: Sender;
let deps: Parameters<typeof processChange>[2];
const config = loadConfig(ENV);

async function build() {
  repos = createFakeRepos();
  wa = createFakeWhatsApp();
  sender = createSender({
    repos,
    wa,
    phoneNumberId: 'PNID',
    warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 },
    maxMarketingPerContact7d: 2,
  });
  const settings = await createFakeSettings(config);
  deps = { repos, wa, sender, config, settings };
  return buildServer({ config, repos, settings, wa, sender, queue, logger: false });
}

function inbound(overrides: Partial<InboundMessage>, phone = '5215500001111'): ChangeValue {
  return {
    contacts: [{ wa_id: phone, profile: { name: 'Ana' } }],
    messages: [
      {
        id: `wamid.in.${Math.random()}`,
        from: phone,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        ...overrides,
      } as InboundMessage,
    ],
  };
}

beforeAll(async () => {
  app = await build();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await app.close();
  app = await build();
  await app.ready();
});

describe('lectura de un entrante', () => {
  it('un texto se guarda tal cual', () => {
    expect(readInbound({ id: '1', from: '5', timestamp: '1', type: 'text', text: { body: 'hola' } })).toMatchObject({
      kind: 'text',
      body: 'hola',
    });
  });

  it('una ubicacion se lee con sus coordenadas', () => {
    const leido = readInbound({
      id: '1',
      from: '5',
      timestamp: '1',
      type: 'location',
      location: { latitude: 19.43, longitude: -99.13, name: 'Casa' },
    });
    expect(leido.kind).toBe('location');
    expect(leido.body).toContain('Casa');
    expect(leido.body).toContain('19.43');
  });

  it('una foto no se pierde: se anota como (foto)', () => {
    expect(readInbound({ id: '1', from: '5', timestamp: '1', type: 'image' })).toMatchObject({
      kind: 'image',
      body: '(foto)',
    });
  });

  it('un tipo desconocido tambien deja rastro', () => {
    expect(readInbound({ id: '1', from: '5', timestamp: '1', type: 'contacts' })).toMatchObject({
      kind: 'unknown',
    });
  });
});

describe('la conversacion se guarda sola', () => {
  it('el entrante y la respuesta quedan en el hilo, en orden', async () => {
    // Con el fallback encendido el bot contesta pidiendo la ubicacion, que es
    // la respuesta que este test quiere ver en el hilo.
    await repos.automation.setPrefs({ askLocationFallback: true, preventaActiva: false });
    await processChange('messages', inbound({ text: { body: 'hola, quiero cotizar' } }), deps);

    const contact = (await repos.contacts.getByPhone('5215500001111'))!;
    const hilo = await app.inject({ url: `/admin/chat/${contact.id}`, headers: auth });

    expect(hilo.statusCode).toBe(200);
    const messages = hilo.json().messages;
    expect(messages[0]).toMatchObject({ direction: 'in', body: 'hola, quiero cotizar' });
    // El bot respondio pidiendo la ubicacion: esa respuesta tambien esta.
    expect(messages.at(-1).direction).toBe('out');
    expect(hilo.json().canWrite).toBe(true);
  });

  it('una foto entra al chat aunque el bot no sepa responderla', async () => {
    await processChange('messages', inbound({ type: 'image', text: undefined }), deps);

    const contact = (await repos.contacts.getByPhone('5215500001111'))!;
    const messages = (await app.inject({ url: `/admin/chat/${contact.id}`, headers: auth })).json().messages;
    expect(messages[0]).toMatchObject({ direction: 'in', kind: 'image', body: '(foto)' });
  });

  it('el estado de entrega llega al mensaje', async () => {
    await repos.contacts.upsertFromInbound('5215500002222');
    await repos.contacts.touchInbound('5215500002222', new Date());
    const contact = (await repos.contacts.getByPhone('5215500002222'))!;

    await sender.send({ phone: contact.phone, kind: 'freeform', category: 'UTILITY', text: 'hola' });
    const wamid = (repos.messages._all.at(-1)!).wamid!;
    expect(repos.messages._all.at(-1)).toMatchObject({ direction: 'out', status: 'sent' });

    await processChange(
      'messages',
      { statuses: [{ id: wamid, status: 'read', timestamp: '1', recipient_id: contact.phone }] },
      deps,
    );
    expect(repos.messages._all.at(-1)!.status).toBe('read');
  });

  it('una plantilla se guarda ya renderizada, no con {{1}}', async () => {
    await repos.templates.upsert(approvedTemplate());
    await repos.contacts.setOptIn('5215500003333', 'formulario');

    await sender.send({
      phone: '5215500003333',
      kind: 'template',
      category: 'UTILITY',
      templateName: 'confirmacion_pedido',
      variables: ['Ana', 'A-1024', 'https://ej.mx/t/9'],
    });

    const guardado = repos.messages._all.at(-1)!;
    expect(guardado.body).toContain('Ana');
    expect(guardado.body).toContain('A-1024');
    expect(guardado.body).not.toContain('{{1}}');
  });
});

describe('lista de conversaciones', () => {
  it('ordena por lo mas reciente y cuenta los no leidos', async () => {
    await processChange('messages', inbound({ text: { body: 'primero' } }, '5215500004444'), deps);
    await processChange('messages', inbound({ text: { body: 'segundo' } }, '5215500005555'), deps);

    const lista = await app.inject({ url: '/admin/chat/conversations', headers: auth });
    expect(lista.statusCode).toBe(200);
    const items = lista.json().items;
    expect(items[0].phone).toBe('5215500005555');
    expect(items[0].unread).toBeGreaterThan(0);
    expect(lista.json().unread).toBeGreaterThan(0);
  });

  it('abrir el chat marca lo leido y baja el contador', async () => {
    await processChange('messages', inbound({ text: { body: 'hola' } }, '5215500006666'), deps);
    const contact = (await repos.contacts.getByPhone('5215500006666'))!;

    await app.inject({ url: `/admin/chat/${contact.id}?read=true`, headers: auth });

    const lista = await app.inject({ url: '/admin/chat/conversations', headers: auth });
    const fila = lista.json().items.find((c: { phone: string }) => c.phone === '5215500006666');
    expect(fila.unread).toBe(0);
  });

  it('refrescar sin abrir NO marca como leido', async () => {
    await processChange('messages', inbound({ text: { body: 'hola' } }, '5215500007777'), deps);
    const contact = (await repos.contacts.getByPhone('5215500007777'))!;

    await app.inject({ url: `/admin/chat/${contact.id}`, headers: auth });

    const lista = await app.inject({ url: '/admin/chat/conversations', headers: auth });
    const fila = lista.json().items.find((c: { phone: string }) => c.phone === '5215500007777');
    expect(fila.unread).toBeGreaterThan(0);
  });

  it('busca por nombre y por numero', async () => {
    await processChange('messages', inbound({ text: { body: 'hola' } }, '5215500008888'), deps);

    const porNumero = await app.inject({ url: '/admin/chat/conversations?q=8888', headers: auth });
    expect(porNumero.json().items).toHaveLength(1);

    const porNombre = await app.inject({ url: '/admin/chat/conversations?q=ana', headers: auth });
    expect(porNombre.json().items.length).toBeGreaterThan(0);
  });
});

describe('escribir desde el chat', () => {
  it('un texto dentro de la ventana sale y aparece en el hilo', async () => {
    await processChange('messages', inbound({ text: { body: 'hola' } }, '5215500009999'), deps);
    const contact = (await repos.contacts.getByPhone('5215500009999'))!;

    const respuesta = await app.inject({
      method: 'POST',
      url: '/admin/chat/send',
      headers: auth,
      payload: { contactId: contact.id, text: 'Claro que si, te ayudo' },
    });

    expect(respuesta.json().ok).toBe(true);
    const messages = (await app.inject({ url: `/admin/chat/${contact.id}`, headers: auth })).json().messages;
    expect(messages.at(-1)).toMatchObject({ direction: 'out', body: 'Claro que si, te ayudo' });
  });

  it('fuera de la ventana el chat se bloquea y lo explica', async () => {
    await repos.contacts.upsertFromInbound('5215501010101', 'Viejo');
    await repos.contacts.setOptIn('5215501010101', 'formulario');
    const contact = (await repos.contacts.getByPhone('5215501010101'))!;

    const hilo = await app.inject({ url: `/admin/chat/${contact.id}`, headers: auth });
    expect(hilo.json().canWrite).toBe(false);
    expect(hilo.json().blockedReason).toContain('24 h');

    const intento = await app.inject({
      method: 'POST',
      url: '/admin/chat/send',
      headers: auth,
      payload: { contactId: contact.id, text: 'hola?' },
    });
    expect(intento.json()).toMatchObject({ ok: false, code: 'window_closed' });
  });

  it('fuera de la ventana una plantilla aprobada si sale', async () => {
    await repos.templates.upsert(approvedTemplate());
    await repos.contacts.setOptIn('5215502020202', 'formulario');
    const contact = (await repos.contacts.getByPhone('5215502020202'))!;

    const respuesta = await app.inject({
      method: 'POST',
      url: '/admin/chat/send',
      headers: auth,
      payload: {
        contactId: contact.id,
        templateName: 'confirmacion_pedido',
        variables: ['Ana', 'A-1', 'x'],
      },
    });
    expect(respuesta.json().ok).toBe(true);
  });

  it('a un contacto dado de baja no se le puede escribir', async () => {
    await repos.contacts.upsertFromInbound('5215503030303');
    await repos.contacts.touchInbound('5215503030303', new Date());
    await repos.contacts.setOptOut('5215503030303');
    const contact = (await repos.contacts.getByPhone('5215503030303'))!;

    const hilo = await app.inject({ url: `/admin/chat/${contact.id}`, headers: auth });
    expect(hilo.json().canWrite).toBe(false);
    expect(hilo.json().blockedReason).toContain('baja');

    const intento = await app.inject({
      method: 'POST',
      url: '/admin/chat/send',
      headers: auth,
      payload: { contactId: contact.id, text: 'hola' },
    });
    expect(intento.json()).toMatchObject({ ok: false, code: 'opt_out' });
  });

  it('manda un pin desde un link de mapa', async () => {
    await processChange('messages', inbound({ text: { body: 'hola' } }, '5215504040404'), deps);
    const contact = (await repos.contacts.getByPhone('5215504040404'))!;

    const respuesta = await app.inject({
      method: 'POST',
      url: '/admin/chat/send',
      headers: auth,
      payload: { contactId: contact.id, location: 'https://maps.google.com/?q=19.4326,-99.1332' },
    });

    expect(respuesta.json().ok).toBe(true);
    expect(wa.sent.at(-1)).toMatchObject({ kind: 'location' });
    const messages = (await app.inject({ url: `/admin/chat/${contact.id}`, headers: auth })).json().messages;
    expect(messages.at(-1).body).toContain('19.4326');
  });

  it('pide la ubicacion con el boton nativo', async () => {
    await processChange('messages', inbound({ text: { body: 'hola' } }, '5215505050505'), deps);
    const contact = (await repos.contacts.getByPhone('5215505050505'))!;

    await app.inject({
      method: 'POST',
      url: '/admin/chat/send',
      headers: auth,
      payload: { contactId: contact.id, askLocation: true },
    });

    expect(wa.sent.at(-1)).toMatchObject({ kind: 'location_request' });
  });

  it('abre un chat con un numero que no estaba en la libreta', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/admin/chat/start',
      headers: auth,
      payload: { phone: '+52 1 55 0606 0606', name: 'Nuevo' },
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json().contact).toMatchObject({ phone: '5215506060606', name: 'Nuevo' });
  });

  it('un mensaje vacio se rechaza con un motivo', async () => {
    const contact = await repos.contacts.upsertFromInbound('5215507070707');
    const respuesta = await app.inject({
      method: 'POST',
      url: '/admin/chat/send',
      headers: auth,
      payload: { contactId: contact.id },
    });
    expect(respuesta.statusCode).toBe(400);
  });
});

describe('la pagina del chat', () => {
  // Las pantallas exigen sesion: el token de API vale para inyectarlas en
  // las pruebas, y nunca aparece en el HTML.
  it('sin sesion manda a /login; con acceso se sirve y no filtra el token de administracion', async () => {
    const sinSesion = await app.inject({ url: '/chat' });
    expect(sinSesion.statusCode).toBe(302);
    expect(sinSesion.headers.location).toBe('/login?next=%2Fchat');
    const respuesta = await app.inject({ url: '/chat', headers: auth });
    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body).toContain('Chats');
    expect(respuesta.body).not.toContain(ADMIN);
  });

  it('la raiz es la portada, con la entrada al sistema', async () => {
    const respuesta = await app.inject({ url: '/' });
    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body).toContain('/login');
  });

  /**
   * Regresion. El aviso de "elige una conversacion" vivia DENTRO del hilo, y
   * el primer repintado lo borraba: a partir de ahi, cada actualizacion
   * moria en `getElementById('placeholder').classList` y la pantalla se
   * quedaba congelada aunque el mensaje ya se hubiera enviado.
   */
  it('el aviso inicial esta fuera del hilo, para que no lo borre el repintado', async () => {
    const html = (await app.inject({ url: '/chat', headers: auth })).body;

    const hilo = html.slice(html.indexOf('id="messages"'));
    const cierre = hilo.indexOf('</div>');
    expect(hilo.slice(0, cierre)).not.toContain('placeholder');

    // Y todo lo que se oculta pasa por el ayudante que tolera un nodo ausente.
    expect(html).toContain('function ver(id, visible)');
    expect(html).not.toContain("getElementById('placeholder').classList");
  });

  it('el hilo descarta las respuestas que llegan tarde', async () => {
    // Sin esto, el refresco automatico repintaba encima del mensaje recien
    // enviado con una foto pedida antes.
    const html = (await app.inject({ url: '/chat', headers: auth })).body;
    expect(html).toContain('if (mia < pintado) return;');
    expect(html).toContain("if (deseado && deseado !== contactId) return;");
  });

  it('la lista escucha el clic en el contenedor, no en cada fila', async () => {
    // Las filas se vuelven a pintar solas: un handler por fila se pierde
    // justo cuando el usuario pulsa.
    const html = (await app.inject({ url: '/chat', headers: auth })).body;
    expect(html).toContain("document.getElementById('chats').addEventListener('click'");
  });
});

describe('parar el bot en un chat', () => {
  /** Deja el chat creado y devuelve el contacto, con el bot contestando. */
  async function chatConBot() {
    await repos.automation.setPrefs({ askLocationFallback: true, preventaActiva: true });
    await processChange('messages', inbound({ text: { body: 'hola' } }), deps);

    const contact = (await repos.contacts.getByPhone('5215500001111'))!;
    const hilo = (await app.inject({ url: `/admin/chat/${contact.id}`, headers: auth })).json();
    // De entrada contesta: es lo que se va a callar.
    expect(hilo.messages.at(-1).direction).toBe('out');
    return contact;
  }

  it('con el bot pausado el mensaje entra pero nadie contesta', async () => {
    const contact = await chatConBot();

    const pausa = await app.inject({
      method: 'POST',
      url: `/admin/chat/${contact.id}/bot`,
      headers: auth,
      payload: { pausado: true },
    });
    expect(pausa.statusCode).toBe(200);

    const salidasAntes = (await app.inject({ url: `/admin/chat/${contact.id}`, headers: auth }))
      .json()
      .messages.filter((m: { direction: string }) => m.direction === 'out').length;

    await processChange('messages', inbound({ text: { body: 'sigo aqui, quiero cotizar' } }), deps);

    const hilo = (await app.inject({ url: `/admin/chat/${contact.id}`, headers: auth })).json();
    // El mensaje del cliente SI se guarda: pararlo no es dejar de escuchar.
    expect(hilo.messages.some((m: { body: string }) => m.body === 'sigo aqui, quiero cotizar')).toBe(true);
    // Y no hay ni una respuesta mas que antes de pausarlo.
    const salidas = hilo.messages.filter((m: { direction: string }) => m.direction === 'out').length;
    expect(salidas).toBe(salidasAntes);
    // Y el chat dice en que estado esta, para que nadie lo deje solo creyendo
    // que lo atiende el sistema.
    expect(hilo.contact.botPausadoAt).toBeTruthy();
  });

  it('al soltarlo vuelve a contestar', async () => {
    const contact = await chatConBot();

    const url = `/admin/chat/${contact.id}/bot`;
    await app.inject({ method: 'POST', url, headers: auth, payload: { pausado: true } });
    await app.inject({ method: 'POST', url, headers: auth, payload: { pausado: false } });

    await processChange('messages', inbound({ text: { body: 'hola de nuevo' } }), deps);

    const hilo = (await app.inject({ url: `/admin/chat/${contact.id}`, headers: auth })).json();
    expect(hilo.contact.botPausadoAt).toBeFalsy();
    expect(hilo.messages.at(-1).direction).toBe('out');
  });

  it('un contacto que no existe da 404', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/admin/chat/00000000-0000-0000-0000-000000000000/bot',
      headers: auth,
      payload: { pausado: true },
    });
    expect(r.statusCode).toBe(404);
  });
});

describe('la página del chat se puede ejecutar', () => {
  it('el javascript que se manda al navegador no tiene errores de sintaxis', async () => {
    // Toda la pagina vive dentro de una plantilla de texto, asi que TypeScript
    // no mira lo que hay dentro: un `/**` que se pierde al editar deja el chat
    // en blanco y la suite en verde. Esto lo caza.
    const html = (await app.inject({ url: '/chat', headers: auth })).body;

    const desde = html.lastIndexOf('<script>');
    const hasta = html.lastIndexOf('</script>');
    expect(desde).toBeGreaterThan(-1);

    const js = html.slice(desde + '<script>'.length, hasta);
    expect(() => new Function(js)).not.toThrow();
  });
});
