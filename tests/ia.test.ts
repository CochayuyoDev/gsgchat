/**
 * El asistente de IA de la tienda.
 *
 * El modelo se sustituye por un doble que contesta lo que se le diga: lo
 * que se prueba es lo de alrededor, que es lo que importa al negocio. Que
 * sepa lo que la tienda escribio, que derive cuando el cliente pide una
 * persona (y que el bot se calle desde ese momento), que un fallo del
 * modelo no deje al cliente sin nada, y que el token quede cifrado.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender, type Sender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { createSettingsService, type SettingsRepo } from '../src/settings/service.js';
import { processChange } from '../src/whatsapp/webhook.js';
import type { ChangeValue, InboundMessage } from '../src/whatsapp/types.js';
import { construirSistema, crearServicioIA, leerRespuesta, MARCA_DERIVAR, palabrasDeDerivar, pideUnaPersona, type ServicioIA } from '../src/ia/servicio.js';
import { crearProveedorOpenAI, crearProveedorPuter, ErrorIA, textoDeContenido, type MensajeIA, type ProveedorIA } from '../src/ia/proveedores.js';
import { createFakeRepos, createFakeWhatsApp, createMemorySettingsRepo, TEST_SETTINGS_KEY, type FakeRepos, type FakeWhatsApp, CLAVE_API_PRUEBA as TODO } from './fakes.js';

const ENV = {
  PUBLIC_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'none',
  BUSINESS_NAME: 'Zapateria Lima',
  BUSINESS_HOURS: 'lunes a sabado de 9 a 19',
  RUTAS_SUPERVISOR: '51900000000',
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

const config = loadConfig(ENV);
const con = (clave: string) => ({ authorization: `Bearer ${clave}`, 'content-type': 'application/json' });

/** Un modelo de mentira: contesta lo que diga `siguiente`, y apunta lo que recibe. */
function modeloFalso() {
  const recibido: MensajeIA[][] = [];
  const estado = { siguiente: 'Hola, ¿en qué te ayudo?', fallar: null as string | null };
  const proveedor: ProveedorIA = {
    nombre: 'falso',
    async chat(mensajes) {
      recibido.push(mensajes);
      if (estado.fallar) throw new ErrorIA(estado.fallar, 'falso');
      return estado.siguiente;
    },
  };
  return { proveedor, recibido, estado };
}

let app: FastifyInstance;
let repos: FakeRepos;
let wa: FakeWhatsApp;
let sender: Sender;
let settingsRepo: SettingsRepo;
let ia: ServicioIA;
let modelo: ReturnType<typeof modeloFalso>;

async function build() {
  repos = createFakeRepos();
  wa = createFakeWhatsApp();
  sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
  settingsRepo = createMemorySettingsRepo();
  const settings = await createSettingsService(settingsRepo, config, TEST_SETTINGS_KEY);
  modelo = modeloFalso();
  ia = await crearServicioIA({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, repos, sender, config, nombreNegocio: () => 'Zapateria Lima', supervisor: () => '51900000000', proveedor: modelo.proveedor, modelosGratis: ['google/gemma-4-31b-it', 'google/gemma-4-26b-a4b-it'] });
  const server = await buildServer({ config, repos, settings, wa, sender, queue, logger: false, ia });
  return { server, settings };
}

let deps: Parameters<typeof processChange>[2];

beforeAll(async () => {
  const b = await build();
  app = b.server;
  deps = { repos, wa, sender, config, settings: b.settings, ia };
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await app.close();
  const b = await build();
  app = b.server;
  deps = { repos, wa, sender, config, settings: b.settings, ia };
  await app.ready();
});

/** Lo que salio de verdad (el acuse de lectura no cuenta). */
const enviados = () => wa.sent.filter((s) => s.kind !== 'read');

async function cliente(phone = '51987654321', nombre = 'Maria') {
  const c = await repos.contacts.upsertFromInbound(phone, nombre);
  await repos.contacts.setOptIn(phone, 'prueba');
  await repos.contacts.touchInbound(phone, new Date());
  return c;
}

function entrante(texto: string, phone = '51987654321'): ChangeValue {
  return {
    contacts: [{ wa_id: phone, profile: { name: 'Maria' } }],
    messages: [{ id: `wamid.${Math.random()}`, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: texto } } as InboundMessage],
  };
}

describe('las piezas', () => {
  it('el prompt de sistema lleva el negocio, el horario, el conocimiento y la regla de derivar', () => {
    const s = construirSistema(
      { activa: true, proveedor: 'puter', modelo: 'x', baseUrl: '', nombreAsistente: 'Lucia', conocimiento: 'Vendemos zapatos. Envio gratis desde S/ 150.', instrucciones: 'Tutea.', derivarSi: '', avisarDerivacion: true, memoria: 12 },
      { negocio: 'Zapateria Lima', horario: 'lunes a sabado de 9 a 19', ahora: new Date('2026-09-15T15:00:00Z'), catalogo: '- Zapato negro 40: 120 (stock 3)' },
    );
    expect(s).toContain('Eres Lucia');
    expect(s).toContain('"Zapateria Lima"');
    expect(s).toContain('lunes a sabado de 9 a 19');
    expect(s).toContain('Envio gratis desde S/ 150');
    expect(s).toContain('Tutea.');
    expect(s).toContain('Zapato negro 40: 120');
    expect(s).toContain(MARCA_DERIVAR);
  });

  it('la marca de derivar se separa del texto; las palabras del cliente se reconocen sin tildes', () => {
    expect(leerRespuesta(`Claro, te paso con alguien. ${MARCA_DERIVAR}`)).toEqual({ texto: 'Claro, te paso con alguien.', derivar: true, pedirUbicacion: false });
    expect(leerRespuesta('Cuesta 120 soles.')).toEqual({ texto: 'Cuesta 120 soles.', derivar: false, pedirUbicacion: false });
    const palabras = palabrasDeDerivar('asesor, humano, hablar con alguien,\nreclamo');
    expect(palabras).toEqual(['asesor', 'humano', 'hablar con alguien', 'reclamo']);
    expect(pideUnaPersona('Quiero hablar con un ASESOR por favor', palabras)).toBe(true);
    expect(pideUnaPersona('tengo un reclamó', palabras)).toBe(true);
    expect(pideUnaPersona('tienen la 40?', palabras)).toBe(false);
  });

  it('el contenido de Puter puede venir como texto o como bloques', () => {
    expect(textoDeContenido('hola')).toBe('hola');
    expect(textoDeContenido([{ type: 'text', text: 'ho' }, { type: 'text', text: 'la' }])).toBe('hola');
    expect(textoDeContenido(null)).toBe('');
  });
});

describe('los proveedores', () => {
  it('OpenAI-compatible: manda messages y model, lee choices[0]; un error de la API se explica', async () => {
    const llamadas: Array<{ url: string; body: Record<string, unknown> }> = [];
    let respuesta = { status: 200, body: { choices: [{ message: { content: 'Hola desde la API' } }] } };
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      llamadas.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(JSON.stringify(respuesta.body), { status: respuesta.status });
    }) as unknown as typeof fetch;
    const p = crearProveedorOpenAI({ baseUrl: 'https://api.groq.com/openai/v1/', clave: 'k', fetchImpl });
    expect(await p.chat([{ role: 'user', content: 'hola' }], { modelo: 'llama' })).toBe('Hola desde la API');
    expect(llamadas[0]!.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(llamadas[0]!.body).toMatchObject({ model: 'llama', messages: [{ role: 'user', content: 'hola' }] });

    respuesta = { status: 401, body: { error: { message: 'bad key' } } as never };
    await expect(p.chat([{ role: 'user', content: 'x' }], { modelo: 'm' })).rejects.toMatchObject({ name: 'ErrorIA', detalle: 'bad key' });
  });

  it('Puter: se carga una vez, se le pasan los mensajes y se lee message.content', async () => {
    let cargas = 0;
    const p = crearProveedorPuter('tok', async () => {
      cargas++;
      return { ai: { chat: async (m: MensajeIA[]) => ({ message: { content: `eco: ${m[m.length - 1]!.content}` } }) } };
    });
    expect(await p.chat([{ role: 'user', content: 'a' }], { modelo: 'gpt-5-nano' })).toBe('eco: a');
    expect(await p.chat([{ role: 'user', content: 'b' }], { modelo: 'gpt-5-nano' })).toBe('eco: b');
    expect(cargas).toBe(1);
    await expect(crearProveedorPuter('', async () => ({ ai: { chat: async () => '' } })).chat([], { modelo: 'x' })).rejects.toThrow(/sesion/);
  });
});

describe('configurar y guardar', () => {
  it('el token queda cifrado y nunca vuelve al navegador; activar sin token, 400', async () => {
    const alta = await app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { nombre: 'Ali', usuario: 'ali', clave: 'contrasena-larga' } });
    const cookie = (alta.headers['set-cookie'] as string).split(';')[0]!;

    const sinToken = await app.inject({ method: 'POST', url: '/admin/ia', headers: { cookie }, payload: { activa: true, conocimiento: 'Vendemos zapatos.' } });
    expect(sinToken.statusCode).toBe(400);
    expect(sinToken.json().error).toContain('token');

    const ok = await app.inject({ method: 'POST', url: '/admin/ia', headers: { cookie }, payload: { activa: true, token: 'puter-secreto-123', nombreAsistente: 'Lucia', conocimiento: 'Vendemos zapatos.' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().estado).toMatchObject({ activa: true, tieneToken: true, nombreAsistente: 'Lucia' });
    expect(JSON.stringify(ok.json())).not.toContain('puter-secreto-123');

    const filas = await settingsRepo.getAll();
    const token = filas.find((f) => f.key === 'ia.token')!;
    expect(token.encrypted).toBe(true);
    expect(token.value).not.toContain('puter-secreto');

    const leido = await app.inject({ method: 'GET', url: '/admin/ia', headers: { cookie } });
    expect(leido.json()).toMatchObject({ activa: true, tieneToken: true, modelosSugeridos: expect.any(Object) });

    // Quitar el token desactiva de hecho al asistente.
    await app.inject({ method: 'POST', url: '/admin/ia', headers: { cookie }, payload: { token: '' } });
    expect(ia.activa()).toBe(false);
  });

  it('solo un administrador con cuenta configura; una clave de API no', async () => {
    const r = await app.inject({ method: 'POST', url: '/admin/ia', headers: con(TODO), payload: { activa: false } });
    expect(r.statusCode).toBe(403);
  });
});

describe('el turno del asistente', () => {
  beforeEach(async () => {
    await ia.guardar({ activa: true, token: 'tok', nombreAsistente: 'Lucia', conocimiento: 'Vendemos zapatos. Envio gratis desde S/ 150.', memoria: 6 });
  });

  it('contesta con lo que sabe y con la conversacion anterior', async () => {
    const c = await cliente();
    await repos.messages.add({ contactId: c.id, direction: 'in', wamid: 'w0', kind: 'text', body: 'hola' });
    await repos.messages.add({ contactId: c.id, direction: 'out', wamid: 'w1', kind: 'text', body: 'Hola, soy Lucia' });
    modelo.estado.siguiente = 'Sí, el envío es gratis desde S/ 150.';
    const r = await ia.turno(c, 'el envio es gratis?');
    expect(r).toMatchObject({ resultado: 'respondio', texto: 'Sí, el envío es gratis desde S/ 150.' });
    expect(wa.sent[0]).toMatchObject({ to: '51987654321', body: 'Sí, el envío es gratis desde S/ 150.' });

    const mensajes = modelo.recibido[0]!;
    expect(mensajes[0]!.role).toBe('system');
    expect(mensajes[0]!.content).toContain('Envio gratis desde S/ 150');
    expect(mensajes.slice(1)).toEqual([
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'Hola, soy Lucia' },
      { role: 'user', content: 'el envio es gratis?' },
    ]);
  });

  it('si el modelo marca [DERIVAR], se manda el texto, se para el bot y se avisa al supervisor', async () => {
    const c = await cliente();
    modelo.estado.siguiente = `Entiendo, te paso con una persona. ${MARCA_DERIVAR}`;
    const r = await ia.turno(c, 'quiero devolver un pedido roto');
    expect(r.resultado).toBe('derivo');
    expect(wa.sent[0]).toMatchObject({ to: '51987654321', body: 'Entiendo, te paso con una persona.' });
    expect(wa.sent[1]).toMatchObject({ to: '51900000000' });
    expect(String(wa.sent[1]!.body)).toContain('Maria (51987654321)');
    expect((await repos.contacts.getById(c.id))!.botPausadoAt).toBeTruthy();
  });

  it('si el cliente pide una persona, se deriva sin preguntarle al modelo', async () => {
    const c = await cliente();
    const r = await ia.turno(c, 'quiero hablar con un asesor');
    expect(r.resultado).toBe('derivo');
    expect(modelo.recibido).toHaveLength(0);
    expect(String(wa.sent[0]!.body)).toContain('Te paso con una persona');
  });

  it('si el modelo falla, el cliente recibe algo neutro y una persona se entera', async () => {
    const c = await cliente();
    modelo.estado.fallar = 'sin respuesta a tiempo';
    const r = await ia.turno(c, 'hola');
    expect(r.resultado).toBe('error');
    expect(String(wa.sent[0]!.body)).toContain('en un momento te atiende una persona');
    expect(String(wa.sent[1]!.body)).toContain('la IA fallo');
    expect((await repos.contacts.getById(c.id))!.botPausadoAt).toBeTruthy();
  });

  it('inactiva: no hace nada', async () => {
    await ia.guardar({ activa: false });
    const c = await cliente();
    expect(await ia.turno(c, 'hola')).toMatchObject({ resultado: 'inactiva' });
    expect(enviados()).toHaveLength(0);
  });
});

describe('dentro del flujo de entrantes', () => {
  it('con la IA activa, el texto libre lo contesta ella; con el bot pausado, nadie', async () => {
    await ia.guardar({ activa: true, token: 'tok', conocimiento: 'x' });
    const c = await cliente();
    modelo.estado.siguiente = 'Tenemos la 40 en negro.';
    await processChange('messages', entrante('tienen la 40 en negro?'), deps);
    expect(enviados().map((s) => s.body)).toEqual(['Tenemos la 40 en negro.']);

    await repos.contacts.pausarBot(c.id, true, new Date());
    await processChange('messages', entrante('y en marron?'), deps);
    expect(enviados()).toHaveLength(1);
  });

  it('BAJA sigue siendo BAJA aunque la IA este activa; una foto se reconoce sin llamar al modelo', async () => {
    await ia.guardar({ activa: true, token: 'tok', conocimiento: 'x' });
    await cliente();
    await processChange('messages', entrante('BAJA'), deps);
    expect(modelo.recibido).toHaveLength(0);
    expect((await repos.contacts.getByPhone('51987654321'))!.optOutAt).toBeTruthy();

    await cliente('51911111111', 'Luis');
    const foto: ChangeValue = { contacts: [{ wa_id: '51911111111', profile: { name: 'Luis' } }], messages: [{ id: 'wamid.foto', from: '51911111111', timestamp: String(Math.floor(Date.now() / 1000)), type: 'image', image: { id: 'm1', mime_type: 'image/jpeg' } } as unknown as InboundMessage] };
    await processChange('messages', foto, deps);
    expect(modelo.recibido).toHaveLength(0);
    expect(String(enviados().at(-1)!.body)).toContain('Recibí tu foto');
  });

  it('la prueba desde la pantalla usa el historial del navegador y no manda nada por WhatsApp', async () => {
    await ia.guardar({ activa: true, token: 'tok', conocimiento: 'Abrimos a las 9.' });
    modelo.estado.siguiente = 'A las 9.';
    const r = await app.inject({ method: 'POST', url: '/admin/ia/probar', headers: con(TODO), payload: { texto: 'a que hora abren?', historial: [{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'Hola!' }] } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ texto: 'A las 9.', derivar: false, pedirUbicacion: false });
    expect(modelo.recibido[0]!.slice(1)).toEqual([{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'Hola!' }, { role: 'user', content: 'a que hora abren?' }]);
    expect(wa.sent).toHaveLength(0);
  });
});

describe('lo aprendido en Stoky con Gemma', () => {
  it('se quita el razonamiento, las comillas y la firma; las partes "thinking" se descartan', async () => {
    const { limpiarRespuesta, explicarErrorPuter } = await import('../src/ia/proveedores.js');
    expect(limpiarRespuesta('<thought>pienso mucho</thought>Hola, ¿en qué te ayudo?')).toBe('Hola, ¿en qué te ayudo?');
    expect(limpiarRespuesta('<think>pienso y me cortan')).toBe('');
    expect(limpiarRespuesta('razonamiento suelto</reasoning>Sí, hay stock.')).toBe('Sí, hay stock.');
    expect(limpiarRespuesta('"Asistente: Claro que sí."')).toBe('Claro que sí.');
    expect(textoDeContenido([{ type: 'thinking', text: 'mmm' }, { type: 'text', text: 'Hola' }])).toBe('Hola');
    expect(explicarErrorPuter({ error: 'auth_canceled', msg: 'x' })).toContain('Conectar con Puter');
    expect(explicarErrorPuter({ code: 'insufficient_funds', message: 'no funds' })).toContain('asignacion');
    expect(explicarErrorPuter({ message: 'Unauthorized' })).toContain('Conectar con Puter');
    expect(explicarErrorPuter(new Error('model gpt-9 not found'))).toContain('modelo');
  });

  it('Puter: se pide sin razonamiento y, si el proveedor rechaza el parametro, se reintenta sin el', async () => {
    const llamadas: Array<Record<string, unknown>> = [];
    const p = crearProveedorPuter('tok', async () => ({
      ai: {
        chat: async (_m: MensajeIA[], opts: Record<string, unknown>) => {
          llamadas.push(opts);
          if ('reasoning' in opts) throw { code: 'invalid_param', message: 'reasoning not supported' };
          return { message: { content: '<thought>x</thought>Listo.' } };
        },
      },
    }));
    expect(await p.chat([{ role: 'user', content: 'hola' }], { modelo: 'google/gemma-4-31b-it' })).toBe('Listo.');
    expect(llamadas).toHaveLength(2);
    expect(llamadas[0]).toMatchObject({ model: 'google/gemma-4-31b-it', reasoning: { enabled: false, exclude: true }, max_tokens: 1000 });
    expect('reasoning' in llamadas[1]!).toBe(false);

    // Sin sesion no se reintenta: se explica.
    const sinSesion = crearProveedorPuter('tok', async () => ({ ai: { chat: async () => { throw { error: { code: 'auth_canceled', message: 'no session' } }; } } }));
    await expect(sinSesion.chat([{ role: 'user', content: 'x' }], { modelo: 'm' })).rejects.toMatchObject({ name: 'ErrorIA', detalle: expect.stringContaining('Conectar con Puter') });
  });
});

describe('solo modelos gratuitos con Puter', () => {
  it('del catalogo en vivo salen solo los de costo cero; si falla, la lista fija', async () => {
    const { esGratisEnCatalogo, idDeModelo, modelosGratisEnVivo, modeloGratisEfectivo, olvidarCacheModelos, MODELOS_GRATIS_PUTER } = await import('../src/ia/modelos-gratis.js');
    const gemma = { puterId: 'google:google/gemma-4-31b-it', id: 'gemma-4-31b-it', modalities: { output: ['text'] }, costs: { prompt_tokens: 0, completion_tokens: 0 } };
    const gpt = { puterId: 'openai:gpt-5.4-nano', id: 'gpt-5.4-nano', modalities: { output: ['text'] }, costs: { prompt_tokens: 5, completion_tokens: 40 } };
    const imagen = { puterId: 'x:img', modalities: { output: ['image'] }, costs: { prompt_tokens: 0, completion_tokens: 0 } };
    const suscriptores = { ...gemma, puterId: 'y:solo-pro', subscriberOnly: true };
    expect(esGratisEnCatalogo(gemma)).toBe(true);
    expect(esGratisEnCatalogo(gpt)).toBe(false);
    expect(esGratisEnCatalogo(imagen)).toBe(false);
    expect(esGratisEnCatalogo(suscriptores)).toBe(false);
    expect(idDeModelo(gemma)).toBe('google/gemma-4-31b-it');

    olvidarCacheModelos();
    const vivo = await modelosGratisEnVivo({ fetchImpl: (async () => new Response(JSON.stringify([gemma, gpt, imagen]))) as unknown as typeof fetch, sinCache: true });
    expect(vivo).toMatchObject({ modelos: ['google/gemma-4-31b-it'], origen: 'catalogo' });
    olvidarCacheModelos();
    const caido = await modelosGratisEnVivo({ fetchImpl: (async () => { throw new Error('sin red'); }) as unknown as typeof fetch, sinCache: true });
    expect(caido).toMatchObject({ modelos: [...MODELOS_GRATIS_PUTER], origen: 'fijo' });
    olvidarCacheModelos();

    expect(modeloGratisEfectivo('google/gemma-4-26b-a4b-it', [...MODELOS_GRATIS_PUTER])).toBe('google/gemma-4-26b-a4b-it');
    expect(modeloGratisEfectivo('gpt-5.4-nano', [...MODELOS_GRATIS_PUTER])).toBe('google/gemma-4-31b-it');
  });

  it('un modelo de pago guardado no se usa: el asistente pide el gratuito por defecto', async () => {
    await ia.guardar({ activa: true, token: 'tok', proveedor: 'puter', modelo: 'gpt-5.4-nano', conocimiento: 'x' });
    expect(ia.estado()).toMatchObject({ modelo: 'gpt-5.4-nano', modeloEfectivo: 'google/gemma-4-31b-it' });
    const c = await cliente();
    await ia.turno(c, 'hola');
    // El doble no ve el modelo; lo que importa es que la respuesta salio y el estado lo dice.
    expect(enviados()).toHaveLength(1);
    await ia.guardar({ proveedor: 'openai', modelo: 'gpt-4o-mini' });
    expect(ia.estado().modeloEfectivo).toBe('gpt-4o-mini');
  });
});

describe('la IA conoce el sistema por el que habla', () => {
  it('el prompt lleva lo que el sistema hace y las dos acciones; el manual del panel cubre los modulos', async () => {
    const { SISTEMA_PARA_CLIENTES, manualDelSistema, ACCIONES_IA } = await import('../src/ia/conocimiento-sistema.js');
    const s = construirSistema(
      { activa: true, proveedor: 'puter', modelo: 'x', baseUrl: '', nombreAsistente: 'Lucia', conocimiento: 'x', instrucciones: '', derivarSi: '', avisarDerivacion: true, memoria: 12 },
      { negocio: 'Z', horario: 'h', ahora: new Date() },
    );
    expect(s).toContain(SISTEMA_PARA_CLIENTES);
    expect(s).toContain(ACCIONES_IA.PEDIR_UBICACION);
    expect(s).toContain('BAJA');
    const manual = manualDelSistema();
    for (const trozo of ['Mi asistente IA (/panel#ia)', 'Conectar mi web y tienda', 'WooCommerce', 'Shopify', 'embed.js', 'Historial de envíos', 'no_opt_in', 'window_closed', 'Reparto', 'SaaS', 'Chats (/chat)']) {
      expect(manual, trozo).toContain(trozo);
    }
  });

  it('leerRespuesta separa las dos marcas; derivar manda sobre pedir ubicacion', () => {
    expect(leerRespuesta('Claro, ¿dónde te lo llevamos? [PEDIR_UBICACION]')).toEqual({ texto: 'Claro, ¿dónde te lo llevamos?', derivar: false, pedirUbicacion: true });
    expect(leerRespuesta('Te paso con alguien. [DERIVAR] [PEDIR_UBICACION]')).toEqual({ texto: 'Te paso con alguien.', derivar: true, pedirUbicacion: false });
  });

  it('si el modelo pide la ubicacion, sale el texto y detras el boton (o el camino del clip)', async () => {
    await ia.guardar({ activa: true, token: 'tok', conocimiento: 'Hacemos delivery.' });
    const c = await cliente();
    modelo.estado.siguiente = 'Claro, ¿dónde te lo llevamos? [PEDIR_UBICACION]';
    const r = await ia.turno(c, 'quiero delivery');
    expect(r.resultado).toBe('respondio');
    expect(enviados().map((s) => s.kind)).toEqual(['text', 'location_request']);
    expect(enviados()[0]).toMatchObject({ body: 'Claro, ¿dónde te lo llevamos?' });
    expect(String(enviados()[1]!.body)).toContain('ubicación');
    expect((await repos.contacts.getById(c.id))!.botPausadoAt).toBeFalsy();
  });

  it('el ayudante del panel responde al dueño con el manual, para cualquier cuenta', async () => {
    await ia.guardar({ token: 'tok' });
    modelo.estado.siguiente = 'Ve a Conectar mi web y tienda (/panel#integraciones) → Conectores.';
    const r = await app.inject({ method: 'POST', url: '/admin/ia/ayuda', headers: con(TODO), payload: { texto: 'como conecto shopify?', historial: [] } });
    expect(r.statusCode).toBe(200);
    expect(r.json().texto).toContain('/panel#integraciones');
    const mensajes = modelo.recibido.at(-1)!;
    expect(mensajes[0]!.content).toContain('MANUAL DEL SISTEMA');
    expect(mensajes[0]!.content).toContain('dueño o un operador');
    expect(mensajes.at(-1)).toEqual({ role: 'user', content: 'como conecto shopify?' });
    expect(enviados()).toHaveLength(0);

    await ia.guardar({ token: '' });
    const sin = await app.inject({ method: 'POST', url: '/admin/ia/ayuda', headers: con(TODO), payload: { texto: 'hola' } });
    expect(sin.statusCode).toBe(400);
    expect(sin.json().error).toContain('/panel#ia');
  });

  it('el manual tiene el cuadro para preguntar', async () => {
    const { manualPage } = await import('../src/web/ayuda-pages.js');
    const html = manualPage({ nombreNegocio: 'Z' });
    expect(html).toContain('id="preguntar"');
    expect(html).toContain('/admin/ia/ayuda');
  });
});

describe('entrenamiento por escenarios', () => {
  it('el prompt lleva los ejemplos de respuesta', () => {
    const s = construirSistema(
      { activa: true, proveedor: 'puter', modelo: 'x', baseUrl: '', nombreAsistente: 'Lucia', conocimiento: 'x', instrucciones: '', derivarSi: '', avisarDerivacion: true, memoria: 12 },
      { negocio: 'Z', horario: 'h', ahora: new Date() },
    );
    expect(s).toContain('Ejemplos de cómo responder');
    expect(s).toContain('Cliente: eres un bot?');
  });

  it('la calificacion detecta lo que no debe pasar', async () => {
    const { calificar, preciosEn, ESCENARIOS, GRUPOS } = await import('../src/ia/escenarios.js');
    const ctx = { conocimiento: 'Zapatos desde S/ 120. Envio gratis desde S/ 150. Yape al 987654321.' };
    expect(preciosEn('Cuesta S/ 120 o 90 soles')).toEqual(['120', '90']);
    expect(calificar({ texto: 'Cuesta S/ 120.', derivar: false, pedirUbicacion: false }, ['precios_del_conocimiento', 'corto'], ctx)).toEqual([]);
    expect(calificar({ texto: 'Cuesta S/ 99.', derivar: false, pedirUbicacion: false }, ['precios_del_conocimiento'], ctx)).toEqual(['dijo un precio que no esta en lo que sabe (99)']);
    expect(calificar({ texto: 'Te hago un 20% de descuento.', derivar: false, pedirUbicacion: false }, ['no_promete_descuento'], ctx)).toHaveLength(1);
    expect(calificar({ texto: 'Los precios son los publicados, no puedo aplicar descuentos.', derivar: false, pedirUbicacion: false }, ['no_promete_descuento'], ctx)).toEqual([]);
    expect(calificar({ texto: 'El envío es gratis desde S/ 150.', derivar: false, pedirUbicacion: false }, ['no_gratis'], ctx)).toEqual([]);
    expect(calificar({ texto: 'El envío es gratis.', derivar: false, pedirUbicacion: false }, ['no_gratis'], { conocimiento: 'Envio S/ 10.' })).toHaveLength(1);
    expect(calificar({ texto: 'Pago confirmado, gracias.', derivar: false, pedirUbicacion: false }, ['no_confirma_pago'], ctx)).toHaveLength(1);
    expect(calificar({ texto: 'Lamento eso.', derivar: false, pedirUbicacion: false }, ['deriva'], ctx)).toEqual(['tenia que pasar con una persona y no lo hizo']);
    expect(calificar({ texto: 'Soy ChatGPT.', derivar: false, pedirUbicacion: false }, ['no_modelo'], ctx)).toHaveLength(1);
    expect(calificar({ texto: 'Yapea al 912345678.', derivar: false, pedirUbicacion: false }, ['sin_telefonos_inventados'], ctx)).toHaveLength(1);
    expect(calificar({ texto: 'Yapea al 987654321.', derivar: false, pedirUbicacion: false }, ['sin_telefonos_inventados'], ctx)).toEqual([]);
    expect(calificar({ texto: 'x'.repeat(500), derivar: false, pedirUbicacion: false }, ['corto'], ctx)).toHaveLength(1);
    expect(calificar({ texto: '<thought>x</thought>Hola', derivar: false, pedirUbicacion: false }, ['sin_marcas'], ctx)).toHaveLength(1);
    expect(ESCENARIOS.length).toBeGreaterThan(50);
    expect(new Set(ESCENARIOS.map((e) => e.clave)).size).toBe(ESCENARIOS.length);
    for (const e of ESCENARIOS) expect(Object.keys(GRUPOS)).toContain(e.grupo);
  });

  it('el examen corre un grupo con el modelo, encadena los mensajes de cada caso y resume', async () => {
    await ia.guardar({ activa: true, token: 'tok', conocimiento: 'Zapatos desde S/ 120.' });
    modelo.estado.siguiente = 'Los precios son los publicados; no puedo aplicar descuentos.';
    const r = await app.inject({ method: 'POST', url: '/admin/ia/escenarios', headers: con(TODO), payload: { grupo: 'negociacion' } });
    expect(r.statusCode).toBe(200);
    const { resultados, resumen } = r.json() as { resultados: Array<{ clave: string; alertas: string[]; respuesta: string }>; resumen: { total: number; limpias: number } };
    expect(resumen.total).toBe(resultados.length);
    expect(resultados.every((x) => x.respuesta.includes('publicados'))).toBe(true);
    const insiste = resultados.find((x) => x.clave === 'descuento-insiste')!;
    expect(insiste.alertas).toEqual([]);
    // El caso de dos mensajes: el segundo va con el primero y su respuesta como historial.
    const conHistorial = modelo.recibido.filter((m) => m.some((x) => x.content.includes('dale pe')));
    expect(conHistorial[0]!.filter((x) => x.role !== 'system').map((x) => x.role)).toEqual(['user', 'assistant', 'user']);
    const lista = await app.inject({ method: 'GET', url: '/admin/ia/escenarios', headers: con(TODO) });
    expect(lista.json().grupos.negociacion).toBe('Negociación');
  });
});
