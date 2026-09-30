/**
 * La IA "facil de adaptar": los servicios compatibles con OpenAI que ofrece
 * la pantalla, el boton "Probar la conexion" (con lo de pantalla o con lo
 * guardado) y lo que el asistente sabe de la entrega de hoy del cliente.
 */

import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { crearServicioIA, construirSistema, type ServicioIA } from '../src/ia/servicio.js';
import { crearProveedorOpenAI, explicarFalloConexion, presetDe, probarProveedor, SERVICIOS_OPENAI, type ProveedorIA } from '../src/ia/proveedores.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp, createMemorySettingsRepo, TEST_SETTINGS_KEY, CLAVE_API_PRUEBA } from './fakes.js';

const cola: OutboundQueue = { async enqueue() {}, async enqueueMany(j) { return j.length; }, async pause() {}, async resume() {}, async counts() { return {}; }, async close() {} };

const config = loadConfig({
  PUBLIC_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 's',
  WHATSAPP_VERIFY_TOKEN: 'v',
  TRACKING_SECRET: 'x'.repeat(40),
  DEV_SIMULATE_INBOUND: 'true',
  BUSINESS_NAME: 'Tienda',
} as NodeJS.ProcessEnv);

/** Un servidor compatible con OpenAI de mentira: acepta una clave y un modelo. */
function fetchOpenAIFalso(opts: { clave: string; modelos: string[]; caido?: boolean }): typeof fetch & { llamadas: Array<{ url: string; modelo: string }> } {
  const llamadas: Array<{ url: string; modelo: string }> = [];
  const f = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (opts.caido) throw new TypeError('fetch failed: ECONNREFUSED');
    const body = JSON.parse(String(init?.body ?? '{}')) as { model: string };
    llamadas.push({ url, modelo: body.model });
    const auth = new Headers(init?.headers).get('authorization');
    if (auth !== `Bearer ${opts.clave}`) return new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), { status: 401 });
    if (!opts.modelos.includes(body.model)) return new Response(JSON.stringify({ error: { message: `The model ${body.model} does not exist` } }), { status: 404 });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Hola, estoy listo.' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch & { llamadas: typeof llamadas };
  f.llamadas = llamadas;
  return f;
}

describe('los servicios compatibles con OpenAI', () => {
  it('cada uno trae su URL base, sus modelos y donde se saca la clave; Ollama no pide clave', () => {
    expect(SERVICIOS_OPENAI.map((s) => s.id)).toEqual(['openai', 'groq', 'google', 'openrouter', 'together', 'deepseek', 'mistral', 'ollama', 'otro']);
    for (const s of SERVICIOS_OPENAI) {
      if (s.id === 'otro') continue;
      expect(s.baseUrl).toMatch(/^https?:\/\//);
      expect(s.modelos.length).toBeGreaterThan(0);
      expect(s.clave.length).toBeGreaterThan(5);
    }
    expect(presetDe('groq')?.baseUrl).toBe('https://api.groq.com/openai/v1');
    expect(presetDe('ollama')?.sinClave).toBe(true);
    expect(presetDe('nada')).toBeUndefined();
  });

  it('probarProveedor dice si contesta y cuanto tardo; los fallos salen en cristiano', async () => {
    const fetchImpl = fetchOpenAIFalso({ clave: 'sk-buena', modelos: ['gpt-4o-mini'] });
    const bien = await probarProveedor(crearProveedorOpenAI({ baseUrl: 'https://api.openai.com/v1', clave: 'sk-buena', fetchImpl }), 'gpt-4o-mini');
    expect(bien.ok).toBe(true);
    expect(bien.detalle).toContain('estoy listo');
    expect(bien.ms).toBeGreaterThanOrEqual(0);

    const claveMala = await probarProveedor(crearProveedorOpenAI({ baseUrl: 'https://api.openai.com/v1', clave: 'sk-mala', fetchImpl }), 'gpt-4o-mini');
    expect(claveMala.ok).toBe(false);
    expect(claveMala.detalle).toMatch(/clave no vale/);

    const modeloMalo = await probarProveedor(crearProveedorOpenAI({ baseUrl: 'https://api.openai.com/v1', clave: 'sk-buena', fetchImpl }), 'gpt-99');
    expect(modeloMalo.ok).toBe(false);
    expect(modeloMalo.detalle).toMatch(/modelo no existe/);

    const caido = await probarProveedor(crearProveedorOpenAI({ baseUrl: 'http://localhost:11434/v1', clave: '', fetchImpl: fetchOpenAIFalso({ clave: '', modelos: [], caido: true }) }), 'llama3.1');
    expect(caido.ok).toBe(false);
    expect(caido.detalle).toMatch(/No se pudo llegar/);
  });

  it('explicarFalloConexion traduce los fallos tipicos', () => {
    expect(explicarFalloConexion('429 rate limit exceeded')).toMatch(/cupo o el límite/);
    expect(explicarFalloConexion('el modelo no respondio a tiempo')).toMatch(/tardó demasiado/);
    expect(explicarFalloConexion('403 forbidden')).toMatch(/sin permiso/);
    expect(explicarFalloConexion('algo raro')).toBe('algo raro');
  });
});

describe('probar la conexion desde la pantalla', () => {
  async function armar(fetchImpl: typeof fetch) {
    const repos = createFakeRepos();
    const wa = createFakeWhatsApp();
    const settings = await createFakeSettings(config);
    const settingsRepo = createMemorySettingsRepo();
    const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 5000, growth: 2, hardCap: 10000 }, maxMarketingPerContact7d: 2, serviceWindowApplies: false, soloNumeros: () => [] });
    const ia = await crearServicioIA({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, repos, sender, config, nombreNegocio: () => 'Tienda', fetchImpl, modelosGratis: ['google/gemma-4-31b-it'] });
    const app = await buildServer({ config, repos, settings, wa, sender, queue: cola, logger: false, ia });
    await app.ready();
    const auth = { authorization: `Bearer ${CLAVE_API_PRUEBA}` };
    return { app, ia, auth, cerrar: () => app.close() };
  }

  it('con lo de pantalla (sin guardar) y con lo guardado', async () => {
    const fetchImpl = fetchOpenAIFalso({ clave: 'gsk-buena', modelos: ['llama-3.3-70b-versatile'] });
    const { app, ia, auth, cerrar } = await armar(fetchImpl);
    try {
      // La pantalla lista los servicios.
      const estado = await app.inject({ method: 'GET', url: '/admin/ia', headers: auth });
      expect((estado.json() as { servicios: unknown[] }).servicios).toHaveLength(9);

      // Sin clave, lo dice.
      let r = await app.inject({ method: 'POST', url: '/admin/ia/probar-conexion', headers: auth, payload: { proveedor: 'openai', baseUrl: 'https://api.groq.com/openai/v1', modelo: 'llama-3.3-70b-versatile' } });
      expect((r.json() as { ok: boolean; prueba: { detalle: string } }).prueba.detalle).toMatch(/Falta la clave/);

      // Con la clave escrita en pantalla, prueba sin guardar nada.
      r = await app.inject({ method: 'POST', url: '/admin/ia/probar-conexion', headers: auth, payload: { proveedor: 'openai', baseUrl: 'https://api.groq.com/openai/v1', token: 'gsk-buena', modelo: 'llama-3.3-70b-versatile' } });
      expect((r.json() as { ok: boolean }).ok).toBe(true);
      expect(ia.estado().tieneToken).toBe(false);
      expect(fetchImpl.llamadas[0]).toMatchObject({ url: 'https://api.groq.com/openai/v1/chat/completions', modelo: 'llama-3.3-70b-versatile' });

      // Guardado con el servicio elegido: la URL sale del preset si se deja vacia.
      await ia.guardar({ proveedor: 'openai', servicio: 'groq', baseUrl: '', modelo: 'llama-3.3-70b-versatile', token: 'gsk-buena' });
      r = await app.inject({ method: 'POST', url: '/admin/ia/probar-conexion', headers: auth, payload: {} });
      expect((r.json() as { ok: boolean; prueba: { modelo: string } }).ok).toBe(true);
      expect(fetchImpl.llamadas[fetchImpl.llamadas.length - 1]!.url).toBe('https://api.groq.com/openai/v1/chat/completions');

      // Un modelo que el servicio no tiene, en cristiano.
      r = await app.inject({ method: 'POST', url: '/admin/ia/probar-conexion', headers: auth, payload: { proveedor: 'openai', baseUrl: 'https://api.groq.com/openai/v1', token: 'gsk-buena', modelo: 'gpt-5' } });
      expect((r.json() as { prueba: { detalle: string } }).prueba.detalle).toMatch(/modelo no existe/);

      // Con Puter sin sesion, lo dice sin llamar a nadie.
      r = await app.inject({ method: 'POST', url: '/admin/ia/probar-conexion', headers: auth, payload: { proveedor: 'puter' } });
      expect((r.json() as { prueba: { detalle: string } }).prueba.detalle).toMatch(/Conectar con Puter/);
    } finally {
      await cerrar();
    }
  });
});

describe('lo que el asistente sabe de la entrega de hoy del cliente', () => {
  it('entra en el prompt de sistema como datos fiables', () => {
    const base = { activa: true, proveedor: 'openai' as const, modelo: 'x', baseUrl: '', nombreAsistente: 'Lucía', conocimiento: 'Vendemos zapatos.', instrucciones: '', derivarSi: '', avisarDerivacion: true, memoria: 12, catalogoUrl: '', catalogoFormato: 'auto' as const };
    const ctx = { negocio: 'Tienda', horario: '9 a 19', ahora: new Date('2026-09-21T15:00:00Z') };
    expect(construirSistema(base, ctx)).not.toContain('Sobre este cliente hoy');
    const con = construirSistema(base, { ...ctx, cliente: 'Este cliente tiene hoy el pedido P-1001. Hora aproximada de llegada: 15:40.' });
    expect(con).toContain('Sobre este cliente hoy (datos del sistema, fiables):');
    expect(con).toContain('P-1001');
  });

  it('el turno del asistente se lo pide al modulo de entregas y se lo pasa al modelo', async () => {
    const repos = createFakeRepos();
    const wa = createFakeWhatsApp();
    const settingsRepo = createMemorySettingsRepo();
    const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 5000, growth: 2, hardCap: 10000 }, maxMarketingPerContact7d: 2, serviceWindowApplies: false, soloNumeros: () => [] });
    const prompts: string[] = [];
    const proveedor: ProveedorIA = { nombre: 'falso', async chat(mensajes) { prompts.push(mensajes[0]!.content); return 'Tu pedido P-1001 llega hacia las 15:40.'; } };
    const entregas = { contextoDeCliente: async (phone: string) => (phone === '51987000001' ? 'Este cliente tiene hoy el pedido P-1001. Hora aproximada de llegada: 15:40.' : null) };
    const ia: ServicioIA = await crearServicioIA({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, repos, sender, config, nombreNegocio: () => 'Tienda', proveedor, modelosGratis: ['m'], entregas: entregas as never });
    await ia.guardar({ activa: true, proveedor: 'openai', modelo: 'm', token: 'k', conocimiento: 'Vendemos zapatos.' });
    const contact = await repos.contacts.upsertFromInbound('51987000001', 'Ana');
    const r = await ia.responder({ contact, texto: '¿dónde está mi pedido?' });
    expect(r.texto).toContain('15:40');
    expect(prompts[0]).toContain('Sobre este cliente hoy');
    expect(prompts[0]).toContain('P-1001');
    const otro = await repos.contacts.upsertFromInbound('51987000099', 'Otro');
    await ia.responder({ contact: otro, texto: 'hola' });
    expect(prompts[1]).not.toContain('Sobre este cliente hoy');
  });
});
