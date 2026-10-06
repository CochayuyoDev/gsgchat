/**
 * El chat: conversaciones, hilo y envio.
 *
 * Lo que se prueba aqui no es la pantalla, es que la conversacion se GUARDE
 * sola: un mensaje que entra por el webhook y una respuesta que sale por el
 * sender tienen que aparecer los dos en el hilo, en orden y con su estado.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

const auth = { 'x-api-key': ADMIN };

const ENV = {
  PUBLIC_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'mysql://x/y',
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

// Los adjuntos que se mandan desde el chat se escriben a disco: en una
// carpeta temporal, no en la .wa-media de verdad.
const mediaDir = mkdtempSync(join(tmpdir(), 'wa-chat-media-'));

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
  return buildServer({ config, repos, settings, wa, sender, queue, logger: false, mediaDir });
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

  it('una foto pegada sale como foto, con su pie, y queda en el hilo como una recibida', async () => {
    await processChange('messages', inbound({ text: { body: 'hola' } }, '5215500009999'), deps);
    const contact = (await repos.contacts.getByPhone('5215500009999'))!;
    // Un PNG minimo (1x1), como lo entrega el portapapeles.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

    const respuesta = await app.inject({
      method: 'POST',
      url: '/admin/chat/adjunto',
      headers: auth,
      payload: { contactId: contact.id, datos: 'data:image/png;base64,' + png.toString('base64'), mimeType: 'image/png', filename: 'pegado.png', caption: 'la fachada' },
    });
    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json().ok).toBe(true);

    // Salio por el cliente como foto, con los bytes y el pie.
    expect(wa.sent.at(-1)).toMatchObject({ kind: 'media', tipo: 'image', bytes: png.length, mimeType: 'image/png', caption: 'la fachada' });

    // En el hilo es una foto con su fichero, igual que una recibida.
    const messages = (await app.inject({ url: `/admin/chat/${contact.id}`, headers: auth })).json().messages;
    const ultimo = messages.at(-1);
    expect(ultimo).toMatchObject({ direction: 'out', kind: 'image', body: 'la fachada', payload: { media: { kind: 'image', mimeType: 'image/png', caption: 'la fachada', bytes: png.length } } });
    expect(ultimo.payload.media.id).toMatch(/^[0-9a-f]{24}\.png$/);
    // Y el fichero esta en disco, servible por /admin/local/media/:id.
    expect(existsSync(join(mediaDir, ultimo.payload.media.id))).toBe(true);
    expect(readFileSync(join(mediaDir, ultimo.payload.media.id)).equals(png)).toBe(true);
  });

  it('un documento lleva su nombre; un GIF va como documento para que se mueva', async () => {
    await processChange('messages', inbound({ text: { body: 'hola' } }, '5215500009999'), deps);
    const contact = (await repos.contacts.getByPhone('5215500009999'))!;
    const pdf = Buffer.from('%PDF-1.4 prueba');
    const r1 = await app.inject({ method: 'POST', url: '/admin/chat/adjunto', headers: auth, payload: { contactId: contact.id, datos: pdf.toString('base64'), mimeType: 'application/pdf', filename: 'boleta.pdf' } });
    expect(r1.json().ok).toBe(true);
    expect(wa.sent.at(-1)).toMatchObject({ kind: 'media', tipo: 'document', filename: 'boleta.pdf' });
    let messages = (await app.inject({ url: `/admin/chat/${contact.id}`, headers: auth })).json().messages;
    expect(messages.at(-1)).toMatchObject({ kind: 'document', body: 'boleta.pdf', payload: { media: { filename: 'boleta.pdf' } } });
    expect(messages.at(-1).payload.media.id).toMatch(/\.pdf$/);

    const r2 = await app.inject({ method: 'POST', url: '/admin/chat/adjunto', headers: auth, payload: { contactId: contact.id, datos: Buffer.from('GIF89a').toString('base64'), mimeType: 'image/gif', filename: 'risa.gif' } });
    expect(r2.json().ok).toBe(true);
    expect(wa.sent.at(-1)).toMatchObject({ kind: 'media', tipo: 'document' });
    messages = (await app.inject({ url: `/admin/chat/${contact.id}`, headers: auth })).json().messages;
    expect(messages.at(-1).payload.media.id).toMatch(/\.gif$/);
  });

  it('un fichero vacio o de mas de 16 MB se rechaza con un motivo', async () => {
    await processChange('messages', inbound({ text: { body: 'hola' } }, '5215500009999'), deps);
    const contact = (await repos.contacts.getByPhone('5215500009999'))!;
    const vacio = await app.inject({ method: 'POST', url: '/admin/chat/adjunto', headers: auth, payload: { contactId: contact.id, datos: 'data:image/png;base64,', mimeType: 'image/png' } });
    expect(vacio.statusCode).toBe(400);
    expect(vacio.json().error).toMatch(/vacío/);
    const enorme = Buffer.alloc(16 * 1024 * 1024 + 1).toString('base64');
    const grande = await app.inject({ method: 'POST', url: '/admin/chat/adjunto', headers: auth, payload: { contactId: contact.id, datos: enorme, mimeType: 'video/mp4', filename: 'v.mp4' } });
    expect(grande.statusCode).toBe(400);
    expect(grande.json().error).toMatch(/16 MB/);
    expect(wa.sent.filter((m) => m.kind === 'media')).toHaveLength(0);
  });

  it('a un contacto que no existe no se le manda nada', async () => {
    const r = await app.inject({ method: 'POST', url: '/admin/chat/adjunto', headers: auth, payload: { contactId: 'no-existe', datos: 'aGVsbG8=', mimeType: 'image/png' } });
    expect(r.statusCode).toBe(404);
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


/**
 * Lo que se hace SOBRE un mensaje ya enviado: citarlo, reaccionar, quitarlo,
 * destacarlo, buscarlo o reenviarlo.
 *
 * La regla que se prueba aqui no es cosmetica: la pantalla solo ensena lo que
 * el proveedor sabe hacer. Con la Cloud API de Meta (la de estas pruebas) NO
 * se puede eliminar para todos ni editar, y eso tiene que decirse aqui.
 */
describe('acciones sobre un mensaje', () => {
  /** Deja un chat con un mensaje del cliente y devuelve contacto e hilo. */
  async function chatConMensaje(texto = 'hola, quiero cotizar') {
    await processChange('messages', inbound({ text: { body: texto } }), deps);
    const contact = (await repos.contacts.getByPhone('5215500001111'))!;
    const hilo = (await app.inject({ url: `/admin/chat/${contact.id}`, headers: auth })).json();
    return { contact, hilo };
  }

  it('el hilo dice lo que este WhatsApp puede hacer, para no pintar botones que fallan', async () => {
    const { hilo } = await chatConMensaje();
    // Meta deja citar y reaccionar; eliminar para todos y editar no existen
    // en su API, y la presencia tampoco.
    expect(hilo.puede).toEqual({
      citar: true,
      reaccionar: true,
      eliminarParaTodos: false,
      editar: false,
      presencia: false,
    });
  });

  it('responder citando manda la cita al proveedor y la deja en el hilo', async () => {
    const { contact, hilo } = await chatConMensaje();
    const citado = hilo.messages.find((m: { direction: string }) => m.direction === 'in');

    const r = await app.inject({
      method: 'POST',
      url: '/admin/chat/send',
      headers: auth,
      payload: { contactId: contact.id, text: 'te paso el precio', citaId: citado.id },
    });
    expect(r.statusCode).toBe(200);

    // Sale con la cita: el proveedor recibe el wamid del mensaje citado.
    const salida = wa.sent.filter((x) => x.kind === 'text').at(-1)!;
    expect(salida.cita).toMatchObject({ id: citado.wamid, fromMe: false });

    // Y queda guardada, para que el globo la pinte tambien al recargar.
    const despues = (await app.inject({ url: `/admin/chat/${contact.id}`, headers: auth })).json();
    expect(despues.messages.at(-1).payload.cita).toMatchObject({ id: citado.wamid, deMi: false });
  });

  it('no se puede citar un mensaje de otra conversacion', async () => {
    const { hilo } = await chatConMensaje();
    const citado = hilo.messages[0];
    await processChange('messages', inbound({ text: { body: 'yo tambien' } }, '5215599998888'), deps);
    const otro = (await repos.contacts.getByPhone('5215599998888'))!;

    const r = await app.inject({
      method: 'POST',
      url: '/admin/chat/send',
      headers: auth,
      payload: { contactId: otro.id, text: 'hola', citaId: citado.id },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toContain('no está en esta conversación');
  });

  it('reaccionar sale al proveedor y se cuelga del mensaje, no como globo suelto', async () => {
    const { contact, hilo } = await chatConMensaje();
    const objetivo = hilo.messages.find((m: { direction: string }) => m.direction === 'in');
    const cuantos = hilo.messages.length;

    const r = await app.inject({
      method: 'POST',
      url: `/admin/chat/${contact.id}/reaccion`,
      headers: auth,
      payload: { mensajeId: objetivo.id, emoji: '👍' },
    });
    expect(r.statusCode).toBe(200);
    expect(wa.sent.at(-1)).toMatchObject({ kind: 'reaction', messageId: objetivo.wamid, emoji: '👍' });

    const despues = (await app.inject({ url: `/admin/chat/${contact.id}`, headers: auth })).json();
    // Ni un mensaje mas: la reaccion NO es un mensaje.
    expect(despues.messages.length).toBe(cuantos);
    expect(despues.messages.find((m: { id: number }) => m.id === objetivo.id).payload.reacciones.yo).toMatchObject({ emoji: '👍' });
  });

  it('reaccionar con el emoji vacio quita la reaccion', async () => {
    const { contact, hilo } = await chatConMensaje();
    const objetivo = hilo.messages.find((m: { direction: string }) => m.direction === 'in');
    const url = `/admin/chat/${contact.id}/reaccion`;
    await app.inject({ method: 'POST', url, headers: auth, payload: { mensajeId: objetivo.id, emoji: '👍' } });
    await app.inject({ method: 'POST', url, headers: auth, payload: { mensajeId: objetivo.id, emoji: '' } });

    const despues = (await app.inject({ url: `/admin/chat/${contact.id}`, headers: auth })).json();
    expect(despues.messages.find((m: { id: number }) => m.id === objetivo.id).payload.reacciones.yo).toBeUndefined();
  });

  it('una reaccion que ENTRA se pega a su mensaje en vez de crear una fila', async () => {
    const { contact, hilo } = await chatConMensaje();
    const mio = hilo.messages.find((m: { direction: string }) => m.direction === 'out');
    const cuantos = hilo.messages.length;

    await processChange(
      'messages',
      inbound({ type: 'reaction', reaction: { emoji: '❤️', message_id: mio.wamid } }),
      deps,
    );

    const despues = (await app.inject({ url: `/admin/chat/${contact.id}`, headers: auth })).json();
    expect(despues.messages.length).toBe(cuantos);
    expect(despues.messages.find((m: { id: number }) => m.id === mio.id).payload.reacciones.cliente).toMatchObject({ emoji: '❤️' });
  });

  it('con Meta no se ofrece eliminar para todos, y decirlo no rompe nada', async () => {
    const { contact, hilo } = await chatConMensaje();
    const mio = hilo.messages.find((m: { direction: string }) => m.direction === 'out');

    const r = await app.inject({
      method: 'POST',
      url: `/admin/chat/${contact.id}/eliminar`,
      headers: auth,
      payload: { ids: [mio.id], paraTodos: true },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toContain('no puede eliminar');
  });

  it('"quitar de aquí" saca el mensaje del hilo pero no borra la fila', async () => {
    const { contact, hilo } = await chatConMensaje();
    const objetivo = hilo.messages[0];

    const r = await app.inject({
      method: 'POST',
      url: `/admin/chat/${contact.id}/eliminar`,
      headers: auth,
      payload: { ids: [objetivo.id], paraTodos: false },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().quitados).toBe(1);

    const despues = (await app.inject({ url: `/admin/chat/${contact.id}`, headers: auth })).json();
    expect(despues.messages.some((m: { id: number }) => m.id === objetivo.id)).toBe(false);
    // Sigue en la tabla: el respaldo y la traza lo necesitan.
    expect(repos.messages._all.some((m) => m.id === objetivo.id)).toBe(true);
  });

  it('con Meta tampoco se puede editar un mensaje enviado', async () => {
    const { contact, hilo } = await chatConMensaje();
    const mio = hilo.messages.find((m: { direction: string }) => m.direction === 'out');
    const r = await app.inject({
      method: 'POST',
      url: `/admin/chat/${contact.id}/editar`,
      headers: auth,
      payload: { mensajeId: mio.id, texto: 'esto queria decir' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('destacar un mensaje lo deja en la lista de destacados', async () => {
    const { contact, hilo } = await chatConMensaje('la direccion es Av. Siempre Viva 742');
    const objetivo = hilo.messages[0];

    await app.inject({
      method: 'POST',
      url: `/admin/chat/${contact.id}/destacar`,
      headers: auth,
      payload: { ids: [objetivo.id], destacado: true },
    });

    const lista = (await app.inject({ url: '/admin/chat/destacados', headers: auth })).json();
    expect(lista.items.map((m: { id: number }) => m.id)).toContain(objetivo.id);
    expect(lista.items[0]).toHaveProperty('phone');

    await app.inject({
      method: 'POST',
      url: `/admin/chat/${contact.id}/destacar`,
      headers: auth,
      payload: { ids: [objetivo.id], destacado: false },
    });
    const vacia = (await app.inject({ url: '/admin/chat/destacados', headers: auth })).json();
    expect(vacia.items.length).toBe(0);
  });

  it('buscar dentro de la conversacion devuelve las coincidencias', async () => {
    const { contact } = await chatConMensaje('mi direccion es Av. Siempre Viva 742');
    await processChange('messages', inbound({ text: { body: 'otra cosa distinta' } }), deps);

    const r = (await app.inject({ url: `/admin/chat/${contact.id}/buscar?q=siempre viva`, headers: auth })).json();
    expect(r.items.length).toBe(1);
    expect(r.items[0].body).toContain('Siempre Viva');
  });

  it('reenviar manda el contenido a otra conversacion, marcado como reenviado', async () => {
    const { contact, hilo } = await chatConMensaje('la promo vence el viernes');
    const origen = hilo.messages[0];
    await processChange('messages', inbound({ text: { body: 'hola' } }, '5215599998888'), deps);
    const destino = (await repos.contacts.getByPhone('5215599998888'))!;

    const r = await app.inject({
      method: 'POST',
      url: '/admin/chat/reenviar',
      headers: auth,
      payload: { origenId: contact.id, ids: [origen.id], destinos: [destino.id] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().enviados).toBe(1);

    const hiloDestino = (await app.inject({ url: `/admin/chat/${destino.id}`, headers: auth })).json();
    const reenviado = hiloDestino.messages.filter((m: { payload: { reenviado?: boolean } | null }) => m.payload?.reenviado);
    expect(reenviado.length).toBe(1);
    expect(reenviado[0].body).toBe('la promo vence el viernes');
  });
});

describe('la conversacion en la lista: fijar, silenciar, apartar', () => {
  async function dosChats() {
    await processChange('messages', inbound({ text: { body: 'soy el primero' } }, '5215500001111'), deps);
    await processChange('messages', inbound({ text: { body: 'soy el segundo' } }, '5215599998888'), deps);
    return {
      primero: (await repos.contacts.getByPhone('5215500001111'))!,
      segundo: (await repos.contacts.getByPhone('5215599998888'))!,
    };
  }

  it('lo fijado sube arriba del todo, por encima de lo mas reciente', async () => {
    const { primero } = await dosChats();
    const antes = (await app.inject({ url: '/admin/chat/conversations', headers: auth })).json();
    expect(antes.items[0].contactId).not.toBe(primero.id);

    await app.inject({ method: 'POST', url: `/admin/chat/${primero.id}/lista`, headers: auth, payload: { fijado: true } });

    const despues = (await app.inject({ url: '/admin/chat/conversations', headers: auth })).json();
    expect(despues.items[0].contactId).toBe(primero.id);
    expect(despues.items[0].fijadoAt).toBeTruthy();
  });

  it('un chat apartado sale de la lista, pero se puede pedir', async () => {
    const { primero } = await dosChats();
    await app.inject({ method: 'POST', url: `/admin/chat/${primero.id}/lista`, headers: auth, payload: { apartado: true } });

    const normal = (await app.inject({ url: '/admin/chat/conversations', headers: auth })).json();
    expect(normal.items.some((c: { contactId: string }) => c.contactId === primero.id)).toBe(false);

    const con = (await app.inject({ url: '/admin/chat/conversations?incluirApartados=true', headers: auth })).json();
    expect(con.items.some((c: { contactId: string }) => c.contactId === primero.id)).toBe(true);
  });

  it('marcar como no leido devuelve el globo de sin leer', async () => {
    const { primero } = await dosChats();
    // Abrirlo lo marca como leido...
    await app.inject({ url: `/admin/chat/${primero.id}?read=true`, headers: auth });
    const leido = (await app.inject({ url: '/admin/chat/conversations', headers: auth })).json();
    expect(leido.items.find((c: { contactId: string }) => c.contactId === primero.id).unread).toBe(0);

    // ...y esto lo deshace, moviendo el puntero de lectura hacia atras.
    await app.inject({ method: 'POST', url: `/admin/chat/${primero.id}/lista`, headers: auth, payload: { noLeido: true } });
    const sinLeer = (await app.inject({ url: '/admin/chat/conversations', headers: auth })).json();
    expect(sinLeer.items.find((c: { contactId: string }) => c.contactId === primero.id).unread).toBeGreaterThan(0);
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

describe('eliminar clientes', () => {
  it('cuenta antes, borra uno o todos y nunca toca los grupos', async () => {
    const ana = await repos.contacts.upsertFromInbound('5215506060601');
    await repos.contacts.upsertFromInbound('5215506060602');
    await repos.contacts.upsertGrupo('120363000000000001@g.us', 'Repartidores');

    const uno = await app.inject({ method: 'POST', url: '/admin/contacts/eliminar', headers: auth, payload: { ids: [ana.id] } });
    expect(uno.json()).toEqual({ eliminados: 1 });
    expect(await repos.contacts.getByPhone('5215506060601')).toBeNull();

    const cuenta = await app.inject({ method: 'POST', url: '/admin/contacts/eliminar', headers: auth, payload: { todos: true, soloContar: true } });
    expect(cuenta.json().cuantos).toBeGreaterThan(0);
    const todos = await app.inject({ method: 'POST', url: '/admin/contacts/eliminar', headers: auth, payload: { todos: true } });
    expect(todos.json().eliminados).toBe(cuenta.json().cuantos);
    expect(await repos.contacts.getByPhone('5215506060602')).toBeNull();
    expect(await repos.contacts.getByPhone('120363000000000001@g.us')).not.toBeNull();
  });

  it('sin decir cuáles no borra nada', async () => {
    const r = await app.inject({ method: 'POST', url: '/admin/contacts/eliminar', headers: auth, payload: {} });
    expect(r.statusCode).toBe(400);
  });
});

describe('volver a empezar con un cliente', () => {
  it('el asistente y el bot vuelven a atenderlo, sin borrar nada', async () => {
    const c = await repos.contacts.upsertFromInbound('5215507070701');
    await repos.contacts.cerrarIA(c.id, true, new Date(), 'ubicación registrada');
    await repos.contacts.pausarBot(c.id, true, new Date());
    const r = await app.inject({ method: 'POST', url: `/admin/chat/${c.id}/volver-a-empezar`, headers: auth, payload: {} });
    expect(r.json()).toEqual({ ok: true });
    const despues = (await repos.contacts.getById(c.id))!;
    expect(despues.iaCerradaAt ?? null).toBeNull();
    expect(despues.botPausadoAt ?? null).toBeNull();
    expect((await app.inject({ method: 'POST', url: '/admin/chat/no-existe/volver-a-empezar', headers: auth, payload: {} })).statusCode).toBe(404);
  });
});
