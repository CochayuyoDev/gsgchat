/**
 * El plan de la tienda dentro de la instancia.
 *
 * El maestro es un fetch de mentira. Se comprueba que la instancia se
 * entere de su plan, que lo recuerde entre reinicios, que un maestro caido
 * no pare nada, y que con el plan vencido (o el tope de IA agotado) la IA y
 * las campañas se paren mientras los chats siguen y el panel lo dice.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { createSettingsService } from '../src/settings/service.js';
import { crearServicioIA } from '../src/ia/servicio.js';
import { crearServicioPlan, type PlanRemoto } from '../src/plan/servicio.js';
import type { ProveedorIA } from '../src/ia/proveedores.js';
import { createFakeRepos, createFakeWhatsApp, createMemorySettingsRepo, TEST_SETTINGS_KEY, CLAVE_API_PRUEBA as TODO } from './fakes.js';

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
  BUSINESS_NAME: 'Tienda',
  PLAN_URL: 'http://maestro/api/plan/tienda',
  PLAN_TOKEN: 'plt_secreto',
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

function planRemoto(extra: Partial<PlanRemoto> = {}): PlanRemoto {
  return {
    plan: 'prueba',
    nombre: 'Prueba',
    limites: { iaTurnosMes: 300, campanas: true, conectores: true, usuarios: 2 },
    precioMes: 0,
    moneda: 'PEN',
    vencimiento: '2026-09-29T10:00:00.000Z',
    diasRestantes: 14,
    vencido: false,
    aviso: null,
    contacto: null,
    ...extra,
  };
}

/** Un maestro de mentira: contesta lo que diga `respuesta`, o falla. */
function maestro(respuesta: () => PlanRemoto | Error) {
  const pedidos: Array<{ url: string; auth: string }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    pedidos.push({ url: String(url), auth: String((init?.headers as Record<string, string>)?.authorization ?? '') });
    const r = respuesta();
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, pedidos };
}

const cerrar: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cerrar.length) await cerrar.pop()!();
});

describe('el servicio del plan', () => {
  it('pregunta al maestro con su token, recuerda la respuesta entre reinicios y cuenta los dias desde hoy', async () => {
    const settingsRepo = createMemorySettingsRepo();
    const m = maestro(() => planRemoto());
    let ahora = new Date('2026-09-15T10:00:00Z');
    const plan = await crearServicioPlan({ settingsRepo, url: config.PLAN_URL, token: config.PLAN_TOKEN, fetchImpl: m.fetchImpl, ahora: () => ahora });
    expect(plan.estado()).toMatchObject({ origen: 'maestro', plan: null, aviso: null });
    expect(plan.permite('ia')).toBe(true); // sin noticias del maestro no se para nada

    await plan.refrescar();
    expect(m.pedidos).toEqual([{ url: 'http://maestro/api/plan/tienda', auth: 'Bearer plt_secreto' }]);
    expect(plan.estado().plan).toMatchObject({ plan: 'prueba', diasRestantes: 14, vencido: false });
    expect(plan.estado().consultadoEn).toBe('2026-09-15T10:00:00.000Z');

    // Otro arranque, con el maestro caido: sigue con lo ultimo que supo.
    const caido = maestro(() => new Error('ECONNREFUSED'));
    ahora = new Date('2026-09-27T10:00:00Z');
    const plan2 = await crearServicioPlan({ settingsRepo, url: config.PLAN_URL, token: config.PLAN_TOKEN, fetchImpl: caido.fetchImpl, ahora: () => ahora });
    expect(plan2.estado().plan).toMatchObject({ plan: 'prueba', diasRestantes: 2, vencido: false });
    await plan2.refrescar();
    expect(plan2.estado().error).toBe('ECONNREFUSED');
    expect(plan2.permite('ia')).toBe(true);
    expect(plan2.estado().aviso).toBeNull(); // el aviso "termina en X dias" lo redacta el maestro cuando toca

    // Pasa el vencimiento sin que el maestro conteste: vencido igual.
    ahora = new Date('2026-10-01T10:00:00Z');
    expect(plan2.estado().plan).toMatchObject({ vencido: true, diasRestantes: -2 });
    expect(plan2.permite('ia')).toBe(false);
    expect(plan2.motivo('campanas')).toMatch(/vencido/);
    expect(plan2.estado().aviso).toMatchObject({ nivel: 'bad' });
  });

  it('con cada consulta va el parte de salud en la cabecera x-gsgchat-estado; sin `estado`, no va nada; si falla, tampoco tumba la consulta', async () => {
    const cabeceras: Array<Record<string, string>> = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      cabeceras.push({ ...((init?.headers as Record<string, string>) ?? {}) });
      return new Response(JSON.stringify(planRemoto()), { status: 200 });
    }) as unknown as typeof fetch;
    let whatsapp: 'conectado' | 'caido' = 'caido';
    const plan = await crearServicioPlan({ settingsRepo: createMemorySettingsRepo(), url: config.PLAN_URL, token: config.PLAN_TOKEN, fetchImpl, estado: async () => ({ whatsapp, mensajesHoy: 7, fallosIA: 1, entregasHoy: 2, version: '1.0.0' }) });
    await plan.refrescar();
    expect(JSON.parse(cabeceras[0]!['x-gsgchat-estado']!)).toEqual({ whatsapp: 'caido', mensajesHoy: 7, fallosIA: 1, entregasHoy: 2, version: '1.0.0' });
    whatsapp = 'conectado';
    await plan.refrescar();
    expect(JSON.parse(cabeceras[1]!['x-gsgchat-estado']!).whatsapp).toBe('conectado');
    // Sin `estado`, la cabecera no va.
    const sinParte = await crearServicioPlan({ settingsRepo: createMemorySettingsRepo(), url: config.PLAN_URL, token: config.PLAN_TOKEN, fetchImpl });
    await sinParte.refrescar();
    expect(cabeceras[2]!['x-gsgchat-estado']).toBeUndefined();
    // Si armar el parte falla, se consulta igual (sin cabecera).
    const roto = await crearServicioPlan({ settingsRepo: createMemorySettingsRepo(), url: config.PLAN_URL, token: config.PLAN_TOKEN, fetchImpl, estado: () => { throw new Error('sin datos'); } });
    const e = await roto.refrescar();
    expect(e.error).toBeNull();
    expect(e.plan).toMatchObject({ plan: 'prueba' });
    expect(cabeceras[3]!['x-gsgchat-estado']).toBeUndefined();
  });

  it('la captura del pago va al maestro (POST .../pago con el token) y /pagar refleja lo que el maestro dice; sin maestro, se explica', async () => {
    const llamadas: Array<{ url: string; method: string; body: Record<string, unknown> | null; auth: string }> = [];
    let ultimoPago: Record<string, unknown> | null = null;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      llamadas.push({ url: String(url), method, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null, auth: String((init?.headers as Record<string, string>)?.authorization ?? '') });
      if (method === 'POST') {
        ultimoPago = { id: 7, meses: 2, monto: 98, moneda: 'PEN', nota: 'Op. 1', estado: 'pendiente', motivo: null, at: '2026-09-15T10:00:00.000Z', resueltoAt: null };
        return new Response(JSON.stringify({ ok: true, pago: ultimoPago }), { status: 200 });
      }
      return new Response(JSON.stringify({ ...planRemoto(), cobro: { texto: 'Yape a Ali', numero: '987 111 222', qr: '' }, ultimoPago }), { status: 200 });
    }) as unknown as typeof fetch;
    const plan = await crearServicioPlan({ settingsRepo: createMemorySettingsRepo(), url: config.PLAN_URL, token: config.PLAN_TOKEN, fetchImpl, ahora: () => new Date('2026-09-15T10:00:00Z') });
    await plan.refrescar();
    expect(plan.paraPagar()).toMatchObject({ origen: 'maestro', puedeMandarCaptura: true, cobro: { numero: '987 111 222' }, ultimoPago: null, motivo: null });
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    expect(await plan.mandarCaptura({ imagen: 'hola', meses: 1 })).toMatchObject({ ok: false });
    expect(await plan.mandarCaptura({ imagen: png, meses: 0 })).toMatchObject({ ok: false });
    const r = await plan.mandarCaptura({ imagen: png, meses: 2, monto: 98, nota: 'Op. 1' });
    expect(r).toMatchObject({ ok: true, pago: { id: 7, estado: 'pendiente' } });
    const post = llamadas.find((l) => l.method === 'POST')!;
    expect(post.url).toBe('http://maestro/api/plan/tienda/pago');
    expect(post.auth).toBe('Bearer plt_secreto');
    expect(post.body).toMatchObject({ imagen: png, meses: 2, monto: 98, nota: 'Op. 1' });
    // Tras mandarla se refresca: /pagar ya enseña la captura pendiente.
    expect(plan.paraPagar().ultimoPago).toMatchObject({ id: 7, estado: 'pendiente' });
    // Sin maestro: nada que mandar, y se dice por que.
    const libre = await crearServicioPlan({ settingsRepo: createMemorySettingsRepo(), url: '', token: '', fetchImpl });
    expect(libre.paraPagar()).toMatchObject({ origen: 'libre', puedeMandarCaptura: false });
    expect(libre.paraPagar().motivo).toContain('no tiene membresía');
    expect(await libre.mandarCaptura({ imagen: png, meses: 1 })).toMatchObject({ ok: false });
    await libre.guardarLocal({ plan: 'basico', vencimiento: '2026-12-31' }, 'ali');
    expect(libre.paraPagar()).toMatchObject({ origen: 'local', puedeMandarCaptura: false });
    expect(libre.paraPagar().motivo).toContain('Membresía');
  });

  it('sin PLAN_URL la instancia es libre: nada se consulta ni se limita', async () => {
    const m = maestro(() => planRemoto());
    const plan = await crearServicioPlan({ settingsRepo: createMemorySettingsRepo(), url: '', token: '', fetchImpl: m.fetchImpl });
    const parar = plan.arrancar();
    await plan.refrescar();
    parar();
    expect(m.pedidos).toHaveLength(0);
    expect(plan.estado()).toMatchObject({ origen: 'libre', plan: null });
    expect(plan.permite('ia')).toBe(true);
    expect(plan.permite('campanas')).toBe(true);
  });

  it('el tope de turnos de IA al mes se cuenta, se guarda y se reinicia con el mes', async () => {
    const settingsRepo = createMemorySettingsRepo();
    let ahora = new Date('2026-09-15T10:00:00Z');
    const m = maestro(() => planRemoto({ limites: { iaTurnosMes: 2, campanas: false, conectores: true, usuarios: 1 }, plan: 'basico', nombre: 'Básico', contacto: 'Escríbenos al 999', vencimiento: '2027-01-01T00:00:00.000Z' }));
    const plan = await crearServicioPlan({ settingsRepo, url: config.PLAN_URL, token: config.PLAN_TOKEN, fetchImpl: m.fetchImpl, ahora: () => ahora });
    await plan.refrescar();
    expect(plan.permite('campanas')).toBe(false);
    expect(plan.motivo('campanas')).toBe('El plan Básico no incluye campañas.');
    await plan.anotarTurnoIA();
    expect(plan.permite('ia')).toBe(true);
    await plan.anotarTurnoIA();
    expect(plan.permite('ia')).toBe(false);
    expect(plan.motivo('ia')).toMatch(/tope de 2 respuestas/);
    expect(plan.estado()).toMatchObject({ iaTurnosMes: 2, aviso: { nivel: 'warn' } });
    // Un reinicio no olvida el conteo.
    const plan2 = await crearServicioPlan({ settingsRepo, url: config.PLAN_URL, token: config.PLAN_TOKEN, fetchImpl: m.fetchImpl, ahora: () => ahora });
    expect(plan2.estado().iaTurnosMes).toBe(2);
    // El mes que viene, de cero.
    ahora = new Date('2026-10-01T10:00:00Z');
    expect(plan2.permite('ia')).toBe(true);
    expect(plan2.estado()).toMatchObject({ iaTurnosMes: 0, mes: '2026-10' });
  });
});

describe('el plan dentro del sistema', () => {
  async function levantar(respuesta: () => PlanRemoto | Error) {
    const repos = createFakeRepos();
    const wa = createFakeWhatsApp();
    const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
    const settingsRepo = createMemorySettingsRepo();
    const settings = await createSettingsService(settingsRepo, config, TEST_SETTINGS_KEY);
    const m = maestro(respuesta);
    const plan = await crearServicioPlan({ settingsRepo, url: config.PLAN_URL, token: config.PLAN_TOKEN, fetchImpl: m.fetchImpl });
    await plan.refrescar();
    const modelo = { llamadas: 0 };
    const proveedor: ProveedorIA = {
      nombre: 'falso',
      async chat() {
        modelo.llamadas++;
        return 'Hola, ¿en qué te ayudo?';
      },
    };
    const ia = await crearServicioIA({ settingsRepo, settingsKeyBase64: TEST_SETTINGS_KEY, repos, sender, config, nombreNegocio: () => 'Tienda', proveedor, plan, modelosGratis: ['google/gemma-4-31b-it'] });
    await ia.guardar({ activa: true, token: 'tok', conocimiento: 'Vendemos relojes.' });
    const app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false, ia, plan });
    await app.ready();
    cerrar.push(() => app.close());
    const c = await repos.contacts.upsertFromInbound('51987654321', 'Maria');
    await repos.contacts.setOptIn(c.phone, 'prueba');
    return { app, repos, wa, ia, plan, modelo, contacto: c };
  }

  it('con el plan vigente todo funciona y cada respuesta de la IA cuenta', async () => {
    // Con el reloj de verdad: el vencimiento cuenta desde hoy (con la fecha
    // fija del 29/09/2026 la prueba caducó sola el 30/09).
    const s = await levantar(() => planRemoto({ vencimiento: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString() }));
    const r = await s.ia.turno(s.contacto, 'hola');
    expect(r.resultado).toBe('respondio');
    expect(s.modelo.llamadas).toBe(1);
    expect(s.plan.estado().iaTurnosMes).toBe(1);
    const avisos = await s.app.inject({ method: 'GET', url: '/admin/avisos', headers: con(TODO) });
    expect(avisos.json().plan).toBeNull();
    const info = await s.app.inject({ method: 'GET', url: '/admin/plan', headers: con(TODO) });
    expect(info.json()).toMatchObject({ origen: 'maestro', plan: { nombre: 'Prueba' }, iaTurnosMes: 1 });
  });

  it('vencido: la IA calla sin llamar al modelo, las campañas no se crean, y el panel lo dice arriba de todo', async () => {
    const s = await levantar(() => planRemoto({ vencimiento: '2026-01-01T00:00:00.000Z', vencido: true, diasRestantes: -100, aviso: 'Tu prueba gratis terminó el 1 de enero: el asistente IA y las campañas están en pausa. Los chats siguen funcionando.', contacto: 'Escríbenos al +51 999' }));
    const r = await s.ia.turno(s.contacto, 'hola');
    expect(r).toMatchObject({ resultado: 'inactiva', detalle: 'El plan está vencido: el asistente IA está en pausa.' });
    expect(s.modelo.llamadas).toBe(0);
    expect(s.wa.sent).toHaveLength(0);

    const camp = await s.app.inject({ method: 'POST', url: '/admin/campaigns', headers: con(TODO), payload: { name: 'Promo', templateName: 'promo', recipients: [{ phone: '51987654321' }] } });
    expect(camp.statusCode).toBe(402);
    expect(camp.json().error).toMatch(/vencido/);

    // Los chats siguen: un mensaje manual sale igual.
    const msg = await s.app.inject({ method: 'POST', url: '/admin/messages/text', headers: con(TODO), payload: { phone: '51987654321', text: 'Hola Maria, te atiendo yo' } });
    expect([200, 201]).toContain(msg.statusCode);

    const avisos = await s.app.inject({ method: 'GET', url: '/admin/avisos', headers: con(TODO) });
    expect(avisos.json().avisos[0]).toMatchObject({ tipo: 'plan', nivel: 'bad', href: '/panel#configuracion' });
    expect(avisos.json().plan.texto).toBe('Tu prueba gratis terminó el 1 de enero: el asistente IA y las campañas están en pausa. Los chats siguen funcionando. Escríbenos al +51 999');
    const panel = await s.app.inject({ method: 'GET', url: '/panel', headers: con(TODO) });
    expect(panel.body).toContain('id="s-plan"');
    expect(panel.body).toContain('id="cf-plan"');
  });

  it('a punto de vencer: avisa en naranja pero no para nada', async () => {
    const s = await levantar(() => planRemoto({ vencimiento: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(), diasRestantes: 3, aviso: 'Tu prueba gratis termina en 3 días. Elige un plan para no parar.' }));
    expect((await s.ia.turno(s.contacto, 'hola')).resultado).toBe('respondio');
    const avisos = await s.app.inject({ method: 'GET', url: '/admin/avisos', headers: con(TODO) });
    expect(avisos.json().plan).toEqual({ nivel: 'warn', texto: 'Tu prueba gratis termina en 3 días. Elige un plan para no parar.' });
  });
});
