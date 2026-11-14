/**
 * WhatsApp API junto al WhatsApp normal, desde la pantalla y el webhook:
 *  - una linea de la API se da de alta completa y comprobada con Meta;
 *  - el modo (normal / API / los dos) se guarda, no se elige sin lineas de
 *    ese tipo y deja las de fuera «en pausa» sin desconectarlas;
 *  - el reparto de clientes nuevos solo usa lineas en uso;
 *  - el webhook de Meta acepta la firma y el verify token de una linea de la
 *    API que no es la principal (otra app de Meta).
 */

import { randomBytes } from 'node:crypto';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';
import { crearServicioLineas, ID_LINEA_PRINCIPAL, type ServicioLineas } from '../src/whatsapp/lineas.js';
import { crearRegistroClientes } from '../src/whatsapp/registro.js';
import { crearSesionLocal } from '../src/whatsapp/local/session.js';
import { registerLineasRoutes } from '../src/web/lineas-routes.js';
import { crearRepartoDeLineas } from '../src/whatsapp/reparto-lineas.js';
import { admiteTipo, tipoDeProveedor } from '../src/whatsapp/modo-lineas.js';
import { registerWebhookRoutes, secretosDeMeta } from '../src/whatsapp/webhook.js';
import { signPayload } from '../src/whatsapp/signature.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { WhatsAppClient } from '../src/whatsapp/client.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp } from './fakes.js';

let b: BaseDePrueba;
let app: FastifyInstance;
let lineas: ServicioLineas;
let registro: ReturnType<typeof crearRegistroClientes>;
const probadas: Array<{ token: string; phoneNumberId: string }> = [];
const meta = { falla: null as string | null };

const TOKEN = 'EAAGtokenDePrueba' + 'A'.repeat(80);
const TOKEN_NUEVO = 'EAAGtokenNuevo' + 'B'.repeat(80);
const SECRETO = '0123456789abcdef0123456789abcdef';
const CRED_API = { token: TOKEN, phoneNumberId: '109876543210987', businessAccountId: '223344556677889', appSecret: SECRETO, verifyToken: 'palabra-api' };

beforeAll(async () => {
  b = await baseDePrueba();
  lineas = crearServicioLineas(b.pool, randomBytes(32), 'prueba_modo');
  registro = crearRegistroClientes({
    lineas,
    principal: { cliente: { conectado: () => true } as unknown as WhatsAppClient, sesion: crearSesionLocal() },
    authDir: path.join('x', 'auth'),
    graphVersion: 'v25.0',
  });
  app = Fastify();
  await registerLineasRoutes(app, {
    lineas,
    registro,
    arrancarLinea: async () => undefined,
    // La principal de esta tienda es de QR.
    tipoDe: (l) => tipoDeProveedor(l.principal ? 'local' : l.proveedor),
    probarApi: async (cred) => {
      probadas.push({ token: cred.token, phoneNumberId: cred.phoneNumberId });
      if (meta.falla) throw new Error(meta.falla);
      return { numero: '51 933 444 555'.replace(/\D+/g, ''), nombre: 'GSG API' };
    },
    webhookUrl: () => 'https://ejemplo.test/webhooks/whatsapp',
  });
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  await b?.cerrar();
});

const json = (r: { json: () => unknown }) => r.json() as Record<string, any>;

describe('linea de WhatsApp API', () => {
  it('por defecto se usan las dos y no se puede pasar a solo API sin una linea de la API', async () => {
    const r = json(await app.inject({ method: 'GET', url: '/admin/lineas' }));
    expect(r.modo).toBe('ambos');
    expect(r.webhookUrl).toBe('https://ejemplo.test/webhooks/whatsapp');
    expect(r.modos.map((m: { id: string }) => m.id)).toEqual(['normal', 'api', 'ambos']);
    expect(r.lineas[0]).toMatchObject({ id: ID_LINEA_PRINCIPAL, tipo: 'normal', enUso: true });
    const sinApi = await app.inject({ method: 'POST', url: '/admin/lineas/modo', payload: { modo: 'api' } });
    expect(sinApi.statusCode).toBe(409);
    expect(json(sinApi).error).toContain('ninguna línea de WhatsApp API');
    expect((await app.inject({ method: 'POST', url: '/admin/lineas/modo', payload: { modo: 'cualquiera' } })).statusCode).toBe(400);
  });

  it('el alta de una linea de la API pide todos los datos y dice cuales faltan', async () => {
    const r = await app.inject({ method: 'POST', url: '/admin/lineas', payload: { etiqueta: 'api-incompleta', proveedor: 'cloud', credenciales: { token: 'x' } } });
    expect(r.statusCode).toBe(400);
    expect(json(r).error).toContain('Phone number ID');
    expect(json(r).error).toContain('App secret');
  });

  it('si un dato está mal puesto dice cuál es y cómo se corrige, sin preguntarle a Meta', async () => {
    const antes = probadas.length;
    const casos: Array<[Record<string, string>, string, string]> = [
      [{ phoneNumberId: '+51 921 032 763' }, 'phoneNumberId', 'número de teléfono, no su ID'],
      [{ phoneNumberId: '921032763' }, 'phoneNumberId', 'número de teléfono, no su ID'],
      [{ token: 'abc123' }, 'token', 'EAA'],
      [{ appSecret: TOKEN }, 'appSecret', 'pegaste un token'],
      [{ appSecret: '1234567890123456' }, 'appSecret', 'identificador de la app'],
      [{ appSecret: 'zz' + SECRETO }, 'appSecret', '32'],
      [{ businessAccountId: '109876543210987' }, 'businessAccountId', 'mismo en los dos'],
      [{ verifyToken: 'corto' }, 'verifyToken', '8 caracteres'],
    ];
    for (const [cambio, campo, texto] of casos) {
      const r = await app.inject({ method: 'POST', url: '/admin/lineas', payload: { etiqueta: 'api-mal-puesta', proveedor: 'cloud', credenciales: { ...CRED_API, ...cambio } } });
      expect(r.statusCode, JSON.stringify(cambio)).toBe(400);
      expect(json(r)).toMatchObject({ codigo: 'formato', campo });
      expect(json(r).error).toContain(texto);
    }
    expect(probadas.length).toBe(antes);
    expect((await lineas.listar()).some((l) => l.etiqueta === 'api-mal-puesta')).toBe(false);
  });

  it('si Meta no encuentra el número, el error marca el Phone number ID', async () => {
    meta.falla = 'Unsupported get request. Object with ID does not exist (100)';
    const r = await app.inject({ method: 'POST', url: '/admin/lineas', payload: { etiqueta: 'api-sin-numero', proveedor: 'cloud', credenciales: CRED_API } });
    meta.falla = null;
    expect(r.statusCode).toBe(400);
    expect(json(r)).toMatchObject({ codigo: 'meta', campo: 'phoneNumberId' });
  });

  it('si Meta no acepta los datos, no se da de alta y se explica en palabras', async () => {
    meta.falla = 'Meta 401: Invalid OAuth access token (190)';
    const r = await app.inject({ method: 'POST', url: '/admin/lineas', payload: { etiqueta: 'api-mala', proveedor: 'cloud', credenciales: CRED_API } });
    meta.falla = null;
    expect(r.statusCode).toBe(400);
    expect(json(r).error).toContain('token');
    expect((await lineas.listar()).some((l) => l.etiqueta === 'api-mala')).toBe(false);
  });

  it('da de alta una linea de la API comprobada, con su numero y sin enseñar secretos', async () => {
    const r = await app.inject({ method: 'POST', url: '/admin/lineas', payload: { etiqueta: 'wsp-api', proveedor: 'cloud', credenciales: CRED_API } });
    expect(r.statusCode).toBe(200);
    const l = json(r).linea;
    expect(l).toMatchObject({ etiqueta: 'wsp-api', proveedor: 'cloud', tipo: 'api', enUso: true, numero: '51933444555' });
    expect(l.api).toMatchObject({ phoneNumberId: '109876543210987', businessAccountId: '223344556677889', conToken: true, conAppSecret: true, conVerifyToken: true, faltan: [] });
    expect(JSON.stringify(l)).not.toContain(TOKEN);
    expect(JSON.stringify(l)).not.toContain(SECRETO);
    expect(probadas.at(-1)).toEqual({ token: TOKEN, phoneNumberId: '109876543210987' });
    // Su transporte es el cliente de Meta (no un QR).
    const t = await registro.transporte(l.id);
    expect(t?.sesion).toBeNull();
    expect((await app.inject({ method: 'POST', url: `/admin/lineas/${l.id}/conectar` })).statusCode).toBe(400);
  });

  it('solo API deja la normal en pausa sin desconectarla, y se puede volver', async () => {
    const r = await app.inject({ method: 'POST', url: '/admin/lineas/modo', payload: { modo: 'api' } });
    expect(r.statusCode).toBe(200);
    expect(json(r)).toMatchObject({ ok: true, modo: 'api' });
    const vista = json(await app.inject({ method: 'GET', url: '/admin/lineas' }));
    expect(vista.modo).toBe('api');
    const principal = vista.lineas.find((l: { id: string }) => l.id === ID_LINEA_PRINCIPAL);
    const api = vista.lineas.find((l: { tipo: string }) => l.tipo === 'api');
    expect(principal).toMatchObject({ enUso: false, conectada: true });
    expect(api).toMatchObject({ enUso: true });
    // Se guarda en la base: otro servicio sobre la misma base lo lee igual.
    expect(await crearServicioLineas(b.pool, randomBytes(32), 'prueba_modo').modo!()).toBe('api');
    expect(json(await app.inject({ method: 'POST', url: '/admin/lineas/modo', payload: { modo: 'normal' } })).modo).toBe('normal');
    expect(json(await app.inject({ method: 'POST', url: '/admin/lineas/modo', payload: { modo: 'ambos' } })).modo).toBe('ambos');
  });

  it('un operador no cambia el modo', async () => {
    const otra = Fastify();
    otra.addHook('onRequest', async (req) => { (req as unknown as { usuario: unknown }).usuario = { rol: 'operador' }; });
    await registerLineasRoutes(otra, { lineas, registro, arrancarLinea: async () => undefined });
    await otra.ready();
    expect((await otra.inject({ method: 'POST', url: '/admin/lineas/modo', payload: { modo: 'normal' } })).statusCode).toBe(403);
    await otra.close();
  });

  it('cambiar los datos de la API conserva lo que se deja vacio y vuelve a comprobar con Meta', async () => {
    const api = (await lineas.listar()).find((l) => l.proveedor === 'cloud')!;
    const r = await app.inject({ method: 'PATCH', url: `/admin/lineas/${api.id}/credenciales`, payload: { token: TOKEN_NUEVO, appSecret: '' } });
    expect(r.statusCode).toBe(200);
    expect(probadas.at(-1)).toEqual({ token: TOKEN_NUEVO, phoneNumberId: '109876543210987' });
    const cred = await lineas.credenciales(api.id);
    expect(cred).toMatchObject({ token: TOKEN_NUEVO, appSecret: SECRETO, verifyToken: 'palabra-api' });
    // Una linea de QR no tiene datos de la API.
    const qr = json(await app.inject({ method: 'POST', url: '/admin/lineas', payload: { etiqueta: 'wsp-qr' } })).linea;
    expect((await app.inject({ method: 'PATCH', url: `/admin/lineas/${qr.id}/credenciales`, payload: { token: 'x' } })).statusCode).toBe(400);
  });

  it('el reparto de clientes nuevos solo usa las lineas que el modo deja en uso', async () => {
    const todas = await lineas.listar();
    const reg = { estados: async () => todas.map((linea) => ({ linea, conectada: true })) } as never;
    const repos = createFakeRepos();
    const politica = () => ({ timezone: 'America/Lima', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, soloRitmo: true }) as never;
    let modo: 'normal' | 'api' | 'ambos' = 'api';
    const reparto = crearRepartoDeLineas({
      registro: reg,
      repos,
      politica,
      identidadDe: (l) => `linea:${l.id}`,
      usoDe: async () => (l) => {
        const tipo = tipoDeProveedor(l.principal ? 'local' : l.proveedor);
        return { tipo, enUso: admiteTipo(modo, tipo) };
      },
    });
    const api = todas.find((l) => l.proveedor === 'cloud')!;
    for (let i = 0; i < 20; i++) expect(await reparto.elegir(null)).toBe(api.id);
    const cargas = await reparto.cargas();
    expect(cargas.find((c) => c.id === ID_LINEA_PRINCIPAL)).toMatchObject({ tipo: 'normal', enUso: false });
    modo = 'normal';
    for (let i = 0; i < 20; i++) expect(await reparto.elegir(null)).not.toBe(api.id);
  });
});

describe('webhook de Meta con varias lineas de la API', () => {
  const ENV = {
    PUBLIC_BASE_URL: 'https://ejemplo.test',
    DATABASE_URL: 'mysql://x/y',
    WHATSAPP_PROVIDER: 'local',
    GOOGLE_MAPS_API_KEY: 'maps-key',
    TRACKING_SECRET: 'x'.repeat(40),
    GEO_BBOX: 'lima',
  };

  async function montarWebhook() {
    const config = loadConfig(ENV as NodeJS.ProcessEnv);
    const settings = await createFakeSettings(config);
    const repos = createFakeRepos();
    const wa = createFakeWhatsApp();
    const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
    const w = Fastify();
    await registerWebhookRoutes(w, { repos, config, sender, wa, settings, lineas });
    await w.ready();
    return { w, settings };
  }

  it('reune los secretos de /setup y de cada linea de la API, sin vacios', async () => {
    const { settings } = await montarWebhook();
    const s = await secretosDeMeta(settings, lineas);
    expect(s.appSecrets).toContain(SECRETO);
    expect(s.verifyTokens).toContain('palabra-api');
    expect(s.appSecrets.every(Boolean)).toBe(true);
  });

  it('acepta el verify token y la firma de la linea de la API aunque la principal sea de QR', async () => {
    const { w } = await montarWebhook();
    const ok = await w.inject({ method: 'GET', url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=palabra-api&hub.challenge=777' });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('777');
    expect((await w.inject({ method: 'GET', url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=otra&hub.challenge=777' })).statusCode).toBe(403);

    const cuerpo = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const firmado = await w.inject({ method: 'POST', url: '/webhooks/whatsapp', payload: cuerpo, headers: { 'content-type': 'application/json', 'x-hub-signature-256': signPayload(Buffer.from(cuerpo), SECRETO) } });
    expect(firmado.statusCode).toBe(200);
    const falso = await w.inject({ method: 'POST', url: '/webhooks/whatsapp', payload: cuerpo, headers: { 'content-type': 'application/json', 'x-hub-signature-256': signPayload(Buffer.from(cuerpo), 'no-es') } });
    expect(falso.statusCode).toBe(401);
    await w.close();
  });
});
