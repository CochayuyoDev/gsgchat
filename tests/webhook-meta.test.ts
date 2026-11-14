/**
 * El webhook de WhatsApp Business API configurable desde «Nuestra API»:
 *  - verify token y app secret propios, que NO tocan el verifyToken de /setup
 *    (con WAHA ese campo firma su webhook);
 *  - Meta verifica con el token de aqui y los avisos firmados con el secreto
 *    de aqui entran; los de /setup se siguen aceptando;
 *  - la bitacora anota verificaciones, avisos y rechazos, y las pruebas de la
 *    pantalla no cuentan como si fueran de Meta;
 *  - la prueba de punta a punta dice que falta en palabras.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import { registerWebhookRoutes } from '../src/whatsapp/webhook.js';
import { crearServicioWebhookMeta, nuevoVerifyToken, resumenDelAviso } from '../src/whatsapp/webhook-meta.js';
import { registerWebhookMetaRoutes } from '../src/web/webhook-meta-routes.js';
import { signPayload } from '../src/whatsapp/signature.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp, createMemorySettingsRepo, TEST_SETTINGS_KEY } from './fakes.js';

const SECRETO = '0123456789abcdef0123456789abcdef';

async function montar(env: Record<string, string> = {}) {
  const config = loadConfig({
    PUBLIC_BASE_URL: 'https://gsgchat.ejemplo.pe',
    DATABASE_URL: 'mysql://x/y',
    WHATSAPP_PROVIDER: 'waha',
    WHATSAPP_VERIFY_TOKEN: 'clave-de-waha',
    GOOGLE_MAPS_API_KEY: 'k',
    TRACKING_SECRET: 'x'.repeat(40),
    GEO_BBOX: 'lima',
    ...env,
  } as NodeJS.ProcessEnv);
  const settings = await createFakeSettings(config);
  const repo = createMemorySettingsRepo();
  const webhookMeta = await crearServicioWebhookMeta(repo, TEST_SETTINGS_KEY);
  const repos = createFakeRepos();
  const wa = createFakeWhatsApp();
  const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
  const app: FastifyInstance = Fastify();
  await registerWebhookRoutes(app, { repos, config, sender, wa, settings, webhookMeta });
  await registerWebhookMetaRoutes(app, { webhookMeta, settings, publicBase: config.PUBLIC_BASE_URL });
  await app.ready();
  return { app, settings, repo, webhookMeta };
}

const json = (r: { json: () => unknown }) => r.json() as Record<string, any>;
const verificar = (app: FastifyInstance, token: string) => app.inject({ method: 'GET', url: `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=4242` });
const aviso = (app: FastifyInstance, secreto: string) => {
  const cuerpo = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'W', changes: [{ field: 'messages', value: { statuses: [] } }] }] });
  return app.inject({ method: 'POST', url: '/webhooks/whatsapp', payload: cuerpo, headers: { 'content-type': 'application/json', 'x-hub-signature-256': signPayload(Buffer.from(cuerpo), secreto) } });
};

describe('webhook de WhatsApp Business API desde Nuestra API', () => {
  it('sin configurar: la pantalla lo dice y Meta no puede verificar con cualquier cosa', async () => {
    const { app } = await montar();
    const v = json(await app.inject({ method: 'GET', url: '/admin/webhook-meta' }));
    expect(v).toMatchObject({ url: 'https://gsgchat.ejemplo.pe/webhooks/whatsapp', verifyToken: '', conAppSecret: false, listo: false, publicoHttps: true });
    expect(v.campos.filter((c: { obligatorio: boolean }) => c.obligatorio).map((c: { campo: string }) => c.campo)).toEqual(['messages', 'message_template_status_update', 'phone_number_quality_update']);
    expect((await verificar(app, 'inventado')).statusCode).toBe(403);
  });

  it('el token generado verifica con Meta y no toca el verifyToken de /setup (WAHA)', async () => {
    const { app, settings } = await montar();
    const generado = json(await app.inject({ method: 'POST', url: '/admin/webhook-meta/generar-token' })).verifyToken as string;
    expect(generado).toMatch(/^gsg_[A-Za-z0-9]{20,}$/);
    const r = await verificar(app, generado);
    expect(r.statusCode).toBe(200);
    expect(r.body).toBe('4242');
    expect(settings.current().verifyToken).toBe('clave-de-waha');
    // El de /setup tambien vale.
    expect((await verificar(app, 'clave-de-waha')).statusCode).toBe(200);
    const v = json(await app.inject({ method: 'GET', url: '/admin/webhook-meta' }));
    expect(v.estado.verificadoEn).toBeTruthy();
    expect(v.eventos[0]).toMatchObject({ resultado: 'verificado' });
  });

  it('los avisos firmados con el app secret de aqui entran; con otro, 401 y queda anotado', async () => {
    const { app } = await montar();
    expect((await aviso(app, SECRETO)).statusCode).toBe(503);
    expect(json(await app.inject({ method: 'POST', url: '/admin/webhook-meta', payload: { appSecret: SECRETO } })).conAppSecret).toBe(true);
    expect((await aviso(app, SECRETO)).statusCode).toBe(200);
    expect((await aviso(app, 'f'.repeat(32))).statusCode).toBe(401);
    const v = json(await app.inject({ method: 'GET', url: '/admin/webhook-meta' }));
    expect(v.eventos.map((e: { resultado: string }) => e.resultado)).toEqual(['firma_invalida', 'recibido', 'sin_secreto']);
    expect(v.estado.ultimoAvisoCampos).toBe('messages');
    // El secreto nunca vuelve a la pantalla.
    expect(JSON.stringify(v)).not.toContain(SECRETO);
    expect(v.appSecretFinal).toBe('cdef');
  });

  it('rechaza un app secret que no tiene forma de serlo y un token corto, en palabras', async () => {
    const { app } = await montar();
    const malo = await app.inject({ method: 'POST', url: '/admin/webhook-meta', payload: { appSecret: 'hola' } });
    expect(malo.statusCode).toBe(400);
    expect(json(malo).error).toContain('32 letras y números');
    expect((await app.inject({ method: 'POST', url: '/admin/webhook-meta', payload: { verifyToken: 'corto' } })).statusCode).toBe(400);
  });

  it('la prueba de punta a punta pasa con todo puesto y no cuenta como si fuera de Meta', async () => {
    const { app } = await montar();
    let r = json(await app.inject({ method: 'POST', url: '/admin/webhook-meta/probar' }));
    expect(r.ok).toBe(false);
    // Con WAHA, el verifyToken de /setup existe pero el secreto de Meta no.
    expect(r.pasos.find((p: { paso: string }) => p.paso === 'Aviso firmado')).toMatchObject({ ok: false });
    await app.inject({ method: 'POST', url: '/admin/webhook-meta/generar-token' });
    await app.inject({ method: 'POST', url: '/admin/webhook-meta', payload: { appSecret: SECRETO } });
    r = json(await app.inject({ method: 'POST', url: '/admin/webhook-meta/probar' }));
    expect(r.pasos).toEqual([
      expect.objectContaining({ paso: 'Verificación de Meta', ok: true }),
      expect.objectContaining({ paso: 'Aviso firmado', ok: true }),
      expect.objectContaining({ paso: 'Dirección pública', ok: true }),
    ]);
    expect(r.ok).toBe(true);
    // Lo de la prueba se ve marcado y no da por verificado ni por recibido a Meta.
    expect(r.eventos.every((e: { prueba?: boolean }) => e.prueba)).toBe(true);
    expect(r.estado.verificadoEn).toBeUndefined();
    expect(r.estado.ultimoAvisoEn).toBeUndefined();
  });

  it('lo guardado sobrevive a un reinicio y cambiar el token pide verificar otra vez', async () => {
    const { app, repo } = await montar();
    const token = json(await app.inject({ method: 'POST', url: '/admin/webhook-meta/generar-token' })).verifyToken;
    await verificar(app, token);
    await app.inject({ method: 'POST', url: '/admin/webhook-meta', payload: { appSecret: SECRETO } });
    const otra = await crearServicioWebhookMeta(repo, TEST_SETTINGS_KEY);
    expect(otra.config()).toEqual({ verifyToken: token, appSecret: SECRETO });
    expect(otra.estado().verificadoEn).toBeTruthy();
    // En la base van cifrados.
    expect(JSON.stringify(await repo.getAll())).not.toContain(SECRETO);
    await otra.guardar({ verifyToken: nuevoVerifyToken() });
    expect(otra.estado().verificadoEn).toBeUndefined();
  });

  it('un operador no ve ni cambia el webhook', async () => {
    const { webhookMeta, settings } = await montar();
    const otra = Fastify();
    otra.addHook('onRequest', async (req) => { (req as unknown as { usuario: unknown }).usuario = { rol: 'operador', porToken: false }; });
    await registerWebhookMetaRoutes(otra, { webhookMeta, settings, publicBase: 'https://x.pe' });
    await otra.ready();
    expect((await otra.inject({ method: 'GET', url: '/admin/webhook-meta' })).statusCode).toBe(403);
    expect((await otra.inject({ method: 'POST', url: '/admin/webhook-meta/generar-token' })).statusCode).toBe(403);
  });

  it('resume los campos de cada aviso', () => {
    expect(resumenDelAviso({ entry: [{ changes: [{ field: 'messages', value: { messages: [{}, {}], statuses: [{}] } }, { field: 'phone_number_quality_update', value: {} }] }] }))
      .toBe('messages (2 mensajes, 1 estado) · phone_number_quality_update');
  });
});
