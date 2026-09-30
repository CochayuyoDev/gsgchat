/**
 * Campanas por goteo: el canario decide, el marcapasos manda el ritmo y cada
 * destinatario termina con un estado que explica que le paso.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { canarioPorDefecto, correrGoteo, juzgarCanario, ordenarPorCompromiso } from '../src/campanas/goteo.js';
import { createSender } from '../src/outbound/sender.js';
import { crearMonitor } from '../src/salud/monitor.js';
import { POLITICA_CLOUD, type Politica } from '../src/salud/politica.js';
import { WhatsAppApiError } from '../src/whatsapp/client.js';
import { approvedTemplate, createFakeRepos, createFakeWhatsApp, setFakeClock } from './fakes.js';

const MIN = 60_000;

function reloj(inicio = '2026-03-10T15:00:00Z') {
  let t = new Date(inicio).getTime();
  return { ahora: () => new Date(t), avanzar: (ms: number) => { t += ms; } };
}

function build(politicaExtra: Partial<Politica> = {}) {
  const repos = createFakeRepos();
  const wa = createFakeWhatsApp();
  const clock = reloj();
  setFakeClock(clock.ahora);
  const politica: Politica = {
    ...POLITICA_CLOUD,
    pausaMinMs: 0,
    pausaMaxMs: 0,
    separacionContactoMs: 0,
    warmup: { startPerDay: 5000, growth: 1, hardCap: 5000, reinicioTrasDiasInactivo: 0 },
    ...politicaExtra,
  };
  const salud = crearMonitor({ repos, politica: () => politica, phoneNumberId: () => 'PNID', ahora: clock.ahora, azar: () => 0.5 });
  const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: politica.warmup, maxMarketingPerContact7d: 5, now: clock.ahora, salud, politica: () => politica });
  const deps = { repos, sender, salud, politica: () => politica, ahora: clock.ahora };
  return { repos, wa, clock, politica, salud, sender, deps };
}

afterEach(() => setFakeClock(null));

async function campana(repos: ReturnType<typeof createFakeRepos>, n: number, canario: number, extra: { esperaMin?: number; ritmoPorHora?: number | null } = {}) {
  await repos.templates.upsert(approvedTemplate({ name: 'promo', category: 'MARKETING' }));
  const id = await repos.campaigns.create({
    name: 'Promo',
    templateName: 'promo',
    templateLanguage: 'es',
    category: 'MARKETING',
    canario,
    canarioEsperaMin: extra.esperaMin ?? 60,
    ritmoPorHora: extra.ritmoPorHora ?? null,
  });
  const entries = [];
  for (let i = 0; i < n; i++) {
    const phone = `521550030${String(i).padStart(4, '0')}`;
    await repos.contacts.upsertFromInbound(phone);
    await repos.contacts.setOptIn(phone, 'x');
    entries.push({ phone, variables: ['a', 'b', 'c'], orden: i, canario: i < canario });
  }
  await repos.campaigns.agregarDestinatarios(id, entries);
  await repos.campaigns.setStatus(id, canario > 0 ? 'canary' : 'running');
  return id;
}

describe('el canario', () => {
  it('por defecto es el 10 %, entre 5 y 20, y no existe con menos de 30', () => {
    expect(canarioPorDefecto(10)).toBe(0);
    expect(canarioPorDefecto(30)).toBe(5);
    expect(canarioPorDefecto(100)).toBe(10);
    expect(canarioPorDefecto(1000)).toBe(20);
  });

  it('juzga con lo que hay: fallos, 131049, sin WhatsApp, bajas y entrega', () => {
    const u = POLITICA_CLOUD.umbrales;
    const base = { enviados: 20, entregados: 18, leidos: 5, fallidos: 0, porCodigo: {}, destinatariosUnicos: 20, bajas: 0 };
    expect(juzgarCanario(base, u, 60).ok).toBe(true);
    expect(juzgarCanario({ ...base, enviados: 3, fallidos: 3 }, u, 60).ok).toBe(true);
    expect(juzgarCanario({ ...base, fallidos: 4 }, u, 60).motivo).toMatch(/fallo/);
    expect(juzgarCanario({ ...base, fallidos: 6, porCodigo: { '131049': 6 } }, u, 60).motivo).toMatch(/131049/);
    expect(juzgarCanario({ ...base, fallidos: 3, porCodigo: { '131026': 3 } }, u, 60).motivo).toMatch(/sin WhatsApp|lista sucia/);
    expect(juzgarCanario({ ...base, bajas: 2 }, u, 60).motivo).toMatch(/bajas/);
    expect(juzgarCanario({ ...base, entregados: 5 }, u, 60).motivo).toMatch(/entregados/);
    // Con poca espera no se juzga la entrega.
    expect(juzgarCanario({ ...base, entregados: 5 }, u, 15).ok).toBe(true);
  });

  it('ordena por compromiso: quien escribio hace poco primero', () => {
    const a = { phone: 'a', lastInboundAt: null, optInAt: new Date('2026-01-01') };
    const b = { phone: 'b', lastInboundAt: new Date('2026-03-01'), optInAt: new Date('2025-01-01') };
    const c = { phone: 'c', lastInboundAt: null, optInAt: new Date('2026-02-01') };
    expect(ordenarPorCompromiso([a, b, c]).map((x) => x.phone)).toEqual(['b', 'c', 'a']);
  });
});

describe('el goteo', () => {
  it('manda primero el canario, espera, y si sale bien sigue con el resto', async () => {
    const { repos, deps, clock, wa } = build();
    const id = await campana(repos, 12, 3, { esperaMin: 30 });

    let r = await correrGoteo(deps, 10);
    expect(r.enviados).toBe(3);
    expect(wa.sent.length).toBe(3);
    // Solo el canario: el resto espera.
    let c = (await repos.campaigns.get(id))!;
    expect(c.status).toBe('canary');
    expect(c.canarioEnviadoAt).toBeNull();

    r = await correrGoteo(deps, 10);
    expect(r.enviados).toBe(0);
    c = (await repos.campaigns.get(id))!;
    expect(c.canarioEnviadoAt).not.toBeNull();

    // Antes de la espera no se mueve nada.
    clock.avanzar(10 * MIN);
    r = await correrGoteo(deps, 10);
    expect(r.enviados).toBe(0);

    // Pasada la espera y con el canario limpio, sigue.
    clock.avanzar(25 * MIN);
    r = await correrGoteo(deps, 5);
    expect((await repos.campaigns.get(id))!.status).toBe('running');
    expect(r.enviados).toBe(5);
    r = await correrGoteo(deps, 10);
    expect(r.enviados).toBe(4);
    expect(r.terminadas).toEqual([id]);
    expect((await repos.campaigns.get(id))!.status).toBe('finished');
    expect(await repos.campaigns.cifrasDestinatarios(id)).toEqual({ enviado: 12 });
  });

  it('un canario con muchos fallos pausa la campana y explica por que', async () => {
    const { repos, deps, clock, wa } = build();
    const id = await campana(repos, 40, 5, { esperaMin: 30 });
    // Los cinco del canario fallan: numeros sin WhatsApp.
    for (let i = 0; i < 5; i++) {
      wa.failNext = new WhatsAppApiError('undeliverable', 400, 131026, undefined, false);
      await correrGoteo(deps, 1);
    }
    await correrGoteo(deps, 1); // marca canarioEnviadoAt
    clock.avanzar(31 * MIN);
    const r = await correrGoteo(deps, 10);
    expect(r.pausadas[0]?.id).toBe(id);
    const c = (await repos.campaigns.get(id))!;
    expect(c.status).toBe('paused');
    expect(c.motivoPausa).toMatch(/canario/);
    expect(r.enviados).toBe(0);
    expect(repos._salud.some((e) => e.tipo === 'campana' && e.codigo === 'CANARIO')).toBe(true);
    expect(await repos.campaigns.cifrasDestinatarios(id)).toEqual({ fallido: 5, pendiente: 35 });
  });

  it('una campana pausada no se toca hasta que alguien la reanude', async () => {
    const { repos, deps } = build();
    const id = await campana(repos, 5, 0);
    await repos.campaigns.setStatus(id, 'paused', 'a mano');
    const r = await correrGoteo(deps, 10);
    expect(r.enviados).toBe(0);
    await repos.campaigns.setStatus(id, 'running');
    expect((await correrGoteo(deps, 10)).enviados).toBe(5);
  });

  it('respeta el ritmo por hora de la campana', async () => {
    const { repos, deps, clock } = build();
    const id = await campana(repos, 10, 0, { ritmoPorHora: 3 });
    expect((await correrGoteo(deps, 10)).enviados).toBe(3);
    expect((await correrGoteo(deps, 10)).enviados).toBe(0);
    clock.avanzar(61 * MIN);
    expect((await correrGoteo(deps, 10)).enviados).toBe(3);
    expect((await repos.campaigns.get(id))!.status).toBe('running');
  });

  it('un rechazo del numero entero para el tick; uno del contacto lo pospone y sigue', async () => {
    const { repos, deps, politica } = build();
    await campana(repos, 4, 0);
    // El horario cierra: nada sale y el tick lo dice.
    const cerrada = { ...politica, horaInicio: 23, horaFin: 24 };
    const r = await correrGoteo({ ...deps, politica: () => cerrada }, 10);
    expect(r.enviados).toBe(0);
    expect(r.detenido).toMatch(/fuera_de_horario/);

    // Un contacto apartado (no tiene WhatsApp) se pospone; los demas salen.
    const phones = (await repos.campaigns.siguientesPendientes((await repos.campaigns.listarActivas())[0]!.id, 10)).map((x) => x.phone);
    await repos.contacts.suprimir(phones[0]!, new Date(deps.ahora().getTime() + 2 * 60 * MIN), 'sin whatsapp (131026)', 'todo');
    const r2 = await correrGoteo(deps, 10);
    expect(r2.enviados).toBe(3);
    expect(r2.pospuestos).toBe(1);
  });

  it('una baja se marca como bloqueado en firme, y un error del proveedor se reintenta hasta tres veces', async () => {
    // Techo por contacto alto: aqui se prueba el reintento, no ese techo.
    const { repos, deps, wa, clock } = build({ maxPorContactoDia: 10 });
    const id = await campana(repos, 2, 0);
    const pend = await repos.campaigns.siguientesPendientes(id, 10);
    await repos.contacts.setOptOut(pend[0]!.phone);

    wa.failNext = new WhatsAppApiError('server', 500, 131000, undefined, true);
    let r = await correrGoteo(deps, 10);
    expect(r.bloqueados).toBe(1);
    expect(r.pospuestos).toBe(1);

    for (let i = 0; i < 3; i++) {
      clock.avanzar(11 * MIN);
      wa.failNext = new WhatsAppApiError('server', 500, 131000, undefined, true);
      r = await correrGoteo(deps, 10);
    }
    expect(await repos.campaigns.cifrasDestinatarios(id)).toEqual({ bloqueado: 1, fallido: 1 });
    expect((await repos.campaigns.get(id))!.status).toBe('finished');
  });
});
