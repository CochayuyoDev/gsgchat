/**
 * Por que respondio el bot: cada turno deja una decision (ver
 * src/ia/decision.ts) que el panel pinta en el chat como nota interna.
 *
 * Se prueba que se guarde (orden y recorte, igual que la tabla), que la linea
 * se lea bien y que la API la sirva por contacto con la misma puerta que el
 * resto del chat.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { crearDecisionesEnMemoria } from '../src/db/decisiones-memoria.js';
import { LARGO_DECISION } from '../src/db/repos.js';
import { resumenDecision, type NuevaDecision } from '../src/ia/decision.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp, setFakeClock, type FakeRepos, CLAVE_API_PRUEBA as ADMIN } from './fakes.js';

const decision = (cambios: Partial<NuevaDecision> = {}): NuevaDecision => ({
  contactId: 'c1',
  phone: '51987654321',
  mensajes: 3,
  intencion: 'confirmar_entrega',
  dato: 'sí',
  respuesta: 'plantilla de confirmación',
  como: 'reglas',
  esperaba: 'sí o no',
  detalle: null,
  ...cambios,
});

describe('resumenDecision', () => {
  it('dice el turno, la intencion, el dato, la respuesta y quien decidio', () => {
    expect(resumenDecision(decision())).toBe(
      'turno de 3 mensajes; intención: confirmar entrega; dato detectado: sí; respuesta: plantilla de confirmación; decidido por: reglas',
    );
  });

  it('un mensaje solo va en singular, sin dato dice «ninguno» y la IA se nombra', () => {
    expect(resumenDecision(decision({ mensajes: 1, dato: '  ', como: 'ia', intencion: 'acuse', respuesta: 'silencio' }))).toBe(
      'turno de 1 mensaje; intención: acuse (ok, gracias); dato detectado: ninguno; respuesta: silencio; decidido por: IA',
    );
  });
});

describe('repo de decisiones en memoria', () => {
  it('lista solo las del contacto, de la mas reciente a la mas vieja, con tope', async () => {
    let t = Date.parse('2026-10-06T10:00:00Z');
    const repo = crearDecisionesEnMemoria(() => new Date(t));
    await repo.registrar(decision({ respuesta: 'primera' }));
    t += 1000;
    await repo.registrar(decision({ contactId: 'otro', respuesta: 'de otro' }));
    await repo.registrar(decision({ respuesta: 'segunda' }));
    // Mismo milisegundo: desempata el orden de llegada, como el autoincremental.
    await repo.registrar(decision({ respuesta: 'tercera' }));

    const todas = await repo.listarPorContacto('c1');
    expect(todas.map((d) => d.respuesta)).toEqual(['tercera', 'segunda', 'primera']);
    expect(todas[0]!.id).toBeTypeOf('number');
    expect(todas[0]!.createdAt).toBeInstanceOf(Date);
    expect((await repo.listarPorContacto('c1', 2)).map((d) => d.respuesta)).toEqual(['tercera', 'segunda']);
    expect(await repo.listarPorContacto('nadie')).toEqual([]);
  });

  it('recorta cada texto al largo de su columna y deja null lo vacio', async () => {
    const repo = crearDecisionesEnMemoria();
    await repo.registrar(
      decision({
        dato: 'd'.repeat(300),
        respuesta: 'r'.repeat(300),
        esperaba: 'e'.repeat(100),
        detalle: 'x'.repeat(900),
      }),
    );
    await repo.registrar(decision({ dato: '', esperaba: '   ', detalle: null, mensajes: 0 }));
    const [vacia, larga] = await repo.listarPorContacto('c1');
    expect(larga!.dato).toHaveLength(LARGO_DECISION.dato);
    expect(larga!.respuesta).toHaveLength(LARGO_DECISION.respuesta);
    expect(larga!.esperaba).toHaveLength(LARGO_DECISION.esperaba);
    expect(larga!.detalle).toHaveLength(LARGO_DECISION.detalle);
    expect(vacia).toMatchObject({ dato: null, esperaba: null, detalle: null, mensajes: 1 });
  });
});

describe('GET /admin/chat/:contactId/decisiones', () => {
  const config = loadConfig({
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
  } as NodeJS.ProcessEnv);
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

  beforeAll(async () => {
    repos = createFakeRepos();
    const wa = createFakeWhatsApp();
    const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
    const settings = await createFakeSettings(config);
    app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false });
    await app.ready();
  });

  afterAll(async () => {
    setFakeClock(null);
    await app.close();
  });

  it('sirve las del contacto, mas recientes primero y con su resumen', async () => {
    const contacto = await repos.contacts.upsertFromInbound('51987654321', 'Ana');
    setFakeClock(() => new Date('2026-10-06T10:00:00Z'));
    await repos.decisiones.registrar(decision({ contactId: contacto.id, mensajes: 1, intencion: 'enviar_ubicacion', dato: 'pin', respuesta: 'plantilla de gracias' }));
    setFakeClock(() => new Date('2026-10-06T10:05:00Z'));
    await repos.decisiones.registrar(decision({ contactId: contacto.id, detalle: 'regla: sí corto tras pedir confirmación' }));
    setFakeClock(null);

    const r = await app.inject({ url: `/admin/chat/${contacto.id}/decisiones`, headers: { authorization: `Bearer ${ADMIN}` } });
    expect(r.statusCode).toBe(200);
    const { decisiones } = r.json() as { decisiones: Array<Record<string, unknown>> };
    expect(decisiones).toHaveLength(2);
    expect(decisiones[0]).toMatchObject({
      contactId: contacto.id,
      intencion: 'confirmar_entrega',
      esperaba: 'sí o no',
      detalle: 'regla: sí corto tras pedir confirmación',
      resumen: 'turno de 3 mensajes; intención: confirmar entrega; dato detectado: sí; respuesta: plantilla de confirmación; decidido por: reglas',
    });
    expect(decisiones[1]!.resumen).toContain('intención: enviar ubicación');

    const una = await app.inject({ url: `/admin/chat/${contacto.id}/decisiones?limit=1`, headers: { authorization: `Bearer ${ADMIN}` } });
    expect(una.json().decisiones).toHaveLength(1);
  });

  it('sin sesion ni clave no entra, y un contacto que no existe es 404', async () => {
    const contacto = await repos.contacts.upsertFromInbound('51911111111', 'Beto');
    expect((await app.inject({ url: `/admin/chat/${contacto.id}/decisiones` })).statusCode).toBe(401);
    const nadie = await app.inject({ url: '/admin/chat/no-existe/decisiones', headers: { authorization: `Bearer ${ADMIN}` } });
    expect(nadie.statusCode).toBe(404);
  });
});
