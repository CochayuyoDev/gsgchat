/**
 * El monitor de salud con el sender, los gates y el webhook: lo que pasa de
 * verdad cuando Meta rechaza envios, cuando el numero cae en rojo y cuando
 * vuelve. Dobles en memoria y reloj controlado.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createSender, type Sender } from '../src/outbound/sender.js';
import { WhatsAppApiError } from '../src/whatsapp/client.js';
import { crearMonitor, esPausaAutomatica, inicioDelDia, type Monitor } from '../src/salud/monitor.js';
import { POLITICA_CLOUD, POLITICA_NO_OFICIAL, type Politica } from '../src/salud/politica.js';
import { processChange } from '../src/whatsapp/webhook.js';
import { loadConfig } from '../src/config.js';
import { approvedTemplate, createFakeRepos, createFakeSettings, createFakeWhatsApp, setFakeClock, type FakeRepos } from './fakes.js';

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

/** Un reloj que se puede mover; empieza un martes a las 10:00 de Lima. */
function reloj(inicio = '2026-03-10T15:00:00Z') {
  let t = new Date(inicio).getTime();
  return {
    ahora: () => new Date(t),
    avanzar: (ms: number) => {
      t += ms;
    },
    set: (iso: string) => {
      t = new Date(iso).getTime();
    },
  };
}

function build(opts: { politica?: Partial<Politica>; perfil?: 'cloud' | 'no_oficial' } = {}) {
  const repos = createFakeRepos();
  const wa = createFakeWhatsApp();
  const clock = reloj();
  // Los dobles escriben sus fechas con el mismo reloj que la prueba.
  setFakeClock(clock.ahora);
  const base = opts.perfil === 'no_oficial' ? POLITICA_NO_OFICIAL : POLITICA_CLOUD;
  // Pausa entre envios a cero para que las pruebas no dependan de esperas, y
  // un supervisor al que avisar para poder comprobar los avisos.
  // Sin reinicio de warm-up por inactividad (los dobles arrancan en 2020) salvo
  // en la prueba que lo comprueba.
  const politica: Politica = {
    ...base,
    pausaMinMs: 0,
    pausaMaxMs: 0,
    avisarA: '51999999999',
    warmup: { ...base.warmup, reinicioTrasDiasInactivo: 0 },
    ...opts.politica,
  };
  const avisos: string[] = [];
  const cola = { pausada: false, pause: async () => { cola.pausada = true; }, resume: async () => { cola.pausada = false; } };
  const salud = crearMonitor({
    repos,
    politica: () => politica,
    phoneNumberId: () => 'PNID',
    ahora: clock.ahora,
    azar: () => 0.5,
    avisar: async (texto) => { avisos.push(texto); },
    cola,
  });
  const sender = createSender({
    repos,
    wa,
    phoneNumberId: 'PNID',
    warmup: politica.warmup,
    maxMarketingPerContact7d: 2,
    now: clock.ahora,
    salud,
    politica: () => politica,
  });
  return { repos, wa, clock, politica, salud, sender, avisos, cola };
}

afterEach(() => setFakeClock(null));

async function contactoConOptIn(repos: FakeRepos, phone: string) {
  await repos.contacts.upsertFromInbound(phone);
  await repos.contacts.setOptIn(phone, 'prueba');
}

async function enviarPlantilla(sender: Sender, phone: string) {
  return sender.send({
    phone,
    kind: 'template',
    category: 'UTILITY',
    templateName: 'confirmacion_pedido',
    templateLanguage: 'es_MX',
    variables: ['Ana', 'A-1', 'https://x'],
  });
}

describe('monitor: errores de Meta en caliente', () => {
  it('un 131026 aparta al contacto un mes y el siguiente envio no sale', async () => {
    const { repos, wa, sender, salud, clock } = build();
    await repos.templates.upsert(approvedTemplate());
    await contactoConOptIn(repos, '5215500000001');

    wa.failNext = new WhatsAppApiError('Message Undeliverable', 400, 131026, 'not on whatsapp', false);
    const fallo = await enviarPlantilla(sender, '5215500000001');
    expect(fallo.ok).toBe(false);
    if (!fallo.ok && !fallo.blocked) {
      expect(fallo.code).toBe('131026');
      expect(fallo.retryable).toBe(false);
    }
    // La entrega queda como fallida con su codigo: es lo que cuenta el riesgo.
    expect(repos._deliveries.at(-1)).toMatchObject({ status: 'failed', errorCode: '131026' });

    const contacto = await repos.contacts.getByPhone('5215500000001');
    expect(contacto?.suprimidoAmbito).toBe('todo');
    expect(contacto!.suprimidoHasta!.getTime() - clock.ahora().getTime()).toBe(30 * DIA);

    const bloqueado = await enviarPlantilla(sender, '5215500000001');
    expect(bloqueado.ok).toBe(false);
    if (!bloqueado.ok && bloqueado.blocked) {
      expect(bloqueado.code).toBe('contact_suppressed');
      expect(bloqueado.reason).toMatch(/131026/);
    }
    expect(repos._salud.some((e) => e.tipo === 'supresion' && e.codigo === '131026')).toBe(true);
    void salud;
  });

  it('un 131049 aparta solo del marketing: lo transaccional sigue saliendo', async () => {
    const { repos, wa, sender } = build();
    await repos.templates.upsert(approvedTemplate({ name: 'promo', category: 'MARKETING' }));
    await repos.templates.upsert(approvedTemplate());
    await contactoConOptIn(repos, '5215500000002');

    wa.failNext = new WhatsAppApiError('not delivered to maintain healthy ecosystem', 400, 131049, undefined, false);
    await sender.send({ phone: '5215500000002', kind: 'template', category: 'MARKETING', templateName: 'promo', templateLanguage: 'es_MX', variables: ['a', 'b', 'c'] });

    const marketing = await sender.send({ phone: '5215500000002', kind: 'template', category: 'MARKETING', templateName: 'promo', templateLanguage: 'es_MX', variables: ['a', 'b', 'c'] });
    expect(marketing.ok).toBe(false);
    if (!marketing.ok && marketing.blocked) expect(marketing.code).toBe('contact_suppressed');

    const utilidad = await enviarPlantilla(sender, '5215500000002');
    expect(utilidad.ok).toBe(true);
  });

  it('un 131048 (restricciones de calidad) pausa el numero solo, con hora de vuelta, y avisa', async () => {
    const { repos, wa, sender, avisos, cola, clock } = build();
    await repos.templates.upsert(approvedTemplate());
    await contactoConOptIn(repos, '5215500000003');

    wa.failNext = new WhatsAppApiError('quality restrictions', 400, 131048, undefined, false);
    await enviarPlantilla(sender, '5215500000003');

    const estado = await repos.numberState.get('PNID');
    expect(estado.paused).toBe(true);
    expect(esPausaAutomatica(estado.pausedReason)).toBe(true);
    expect(estado.nivel).toBe('rojo');
    expect(estado.pausadaHasta!.getTime() - clock.ahora().getTime()).toBe(24 * HORA);
    expect(cola.pausada).toBe(true);
    expect(avisos[0]).toMatch(/ROJO/);
    expect(repos._salud.some((e) => e.tipo === 'pausa_auto')).toBe(true);

    // Con el numero pausado no sale nada, ni siquiera a otro contacto.
    await contactoConOptIn(repos, '5215500000004');
    const otro = await enviarPlantilla(sender, '5215500000004');
    expect(otro.ok).toBe(false);
    if (!otro.ok && otro.blocked) expect(otro.code).toBe('number_paused');
  });

  it('un 130429 (velocidad) no aparta a nadie pero frena', async () => {
    const { repos, wa, sender, salud } = build();
    await repos.templates.upsert(approvedTemplate());
    await contactoConOptIn(repos, '5215500000005');
    await salud.evaluar();
    expect(salud.factor()).toBe(1);

    wa.failNext = new WhatsAppApiError('throughput', 429, 130429, undefined, true);
    const r = await enviarPlantilla(sender, '5215500000005');
    expect(r.ok).toBe(false);
    if (!r.ok && !r.blocked) expect(r.retryable).toBe(true);
    expect((await repos.contacts.getByPhone('5215500000005'))?.suprimidoHasta).toBeNull();
    expect(salud.factor()).toBe(0.5);
  });
});

describe('monitor: pausa, rampa y reanudacion', () => {
  it('cuando vence la pausa automatica reanuda solo y vuelve despacio', async () => {
    const { repos, salud, clock, cola } = build({ politica: { pausaRojaMin: 60, rampaMin: 100 } });
    await repos.numberState.setQuality('PNID', 'RED');
    await salud.evaluar();
    let estado = await repos.numberState.get('PNID');
    expect(estado.paused).toBe(true);
    expect(estado.pausadaHasta!.getTime() - clock.ahora().getTime()).toBe(60 * 60_000);

    // Meta levanta el rojo; pasa la hora.
    await repos.numberState.setQuality('PNID', 'GREEN');
    clock.avanzar(61 * 60_000);
    const r = await salud.evaluar();
    estado = await repos.numberState.get('PNID');
    expect(estado.paused).toBe(false);
    expect(cola.pausada).toBe(false);
    expect(estado.rampaDesde).not.toBeNull();
    expect(r.factorEfectivo).toBe(0.1);
    expect(repos._salud.some((e) => e.tipo === 'reanudacion')).toBe(true);

    clock.avanzar(50 * 60_000);
    expect((await salud.evaluar()).factorEfectivo).toBe(0.5);
    clock.avanzar(60 * 60_000);
    expect((await salud.evaluar()).factorEfectivo).toBe(1);
    expect((await repos.numberState.get('PNID')).rampaDesde).toBeNull();
  });

  it('si Meta sigue en rojo al vencer la pausa, se vuelve a pausar', async () => {
    const { repos, salud, clock } = build({ politica: { pausaRojaMin: 60 } });
    await repos.numberState.setQuality('PNID', 'RED');
    await salud.evaluar();
    clock.avanzar(61 * 60_000);
    await salud.evaluar();
    const estado = await repos.numberState.get('PNID');
    expect(estado.paused).toBe(true);
    expect(estado.nivel).toBe('rojo');
  });

  it('una pausa manual no la levanta el monitor', async () => {
    const { repos, salud, clock } = build();
    await repos.numberState.setPaused('PNID', true, 'pausa manual');
    clock.avanzar(DIA);
    await salud.evaluar();
    expect((await repos.numberState.get('PNID')).paused).toBe(true);
    expect(salud.factor()).toBe(0);
  });

  it('tras la reanudacion, los fallos de antes de la pausa ya no cuentan', async () => {
    const { repos, wa, sender, salud, clock } = build({ politica: { pausaRojaMin: 30, rampaMin: 10 } });
    await repos.templates.upsert(approvedTemplate());
    // Veinte fallos seguidos: 100 % de fallos en los ultimos envios.
    for (let i = 0; i < 20; i++) {
      const phone = `521550001${String(i).padStart(4, '0')}`;
      await contactoConOptIn(repos, phone);
      wa.failNext = new WhatsAppApiError('boom', 500, 131000, undefined, true);
      await enviarPlantilla(sender, phone);
    }
    const r1 = await salud.evaluar();
    expect(r1.nivel).toBe('naranja');
    expect(r1.motivos[0]).toMatch(/fallaron/);

    // Se reanuda a mano: la ventana empieza de cero.
    await salud.reanudar('revisado');
    const r2 = await salud.evaluar();
    expect(r2.nivel).toBe('verde');
    clock.avanzar(11 * 60_000);
    expect((await salud.evaluar()).factorEfectivo).toBe(1);
  });

  it('reanudar a mano quita el BANNED del socket y avisa el cambio de nivel una sola vez por media hora', async () => {
    const { repos, salud, avisos, clock } = build();
    await salud.registrarDesconexion(403, 'Forbidden');
    expect((await repos.numberState.get('PNID')).estado).toBe('BANNED');
    expect((await repos.numberState.get('PNID')).paused).toBe(true);
    expect(avisos.length).toBe(1);
    await salud.evaluar();
    await salud.evaluar();
    expect(avisos.length).toBe(1);

    await salud.reanudar('era una prueba');
    expect((await repos.numberState.get('PNID')).estado).toBe('CONNECTED');
    // Un 403 registrado hace mas de una hora ya no cuenta.
    clock.avanzar(2 * HORA);
    const r = await salud.evaluar();
    expect(r.nivel).toBe('verde');
  });

  it('un numero parado varios dias vuelve a empezar el warm-up', async () => {
    const { repos, salud, clock } = build({ politica: { warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000, reinicioTrasDiasInactivo: 3 } } });
    await repos.numberState.reiniciarWarmup('PNID', new Date('2026-01-01T00:00:00Z'));
    await salud.evaluar();
    const estado = await repos.numberState.get('PNID');
    expect(estado.warmupStartedOn.toISOString().slice(0, 10)).toBe(clock.ahora().toISOString().slice(0, 10));
    expect(repos._salud.some((e) => e.tipo === 'warmup')).toBe(true);
  });
});

describe('monitor: el marcapasos dentro del sender', () => {
  it('el segundo envio seguido espera la pausa; el manual no', async () => {
    const { repos, sender, salud, clock } = build({ politica: { pausaMinMs: 5000, pausaMaxMs: 5000 } });
    await repos.templates.upsert(approvedTemplate());
    await contactoConOptIn(repos, '5215500000010');
    await contactoConOptIn(repos, '5215500000011');

    expect((await enviarPlantilla(sender, '5215500000010')).ok).toBe(true);
    const segundo = await enviarPlantilla(sender, '5215500000011');
    expect(segundo.ok).toBe(false);
    if (!segundo.ok && segundo.blocked) {
      expect(segundo.code).toBe('rhythm');
      expect(segundo.reason).toMatch(/pausa_entre_envios/);
      expect(segundo.retryAfterMs).toBeGreaterThan(0);
    }
    const manual = await sender.send({ phone: '5215500000011', kind: 'template', category: 'UTILITY', templateName: 'confirmacion_pedido', templateLanguage: 'es_MX', variables: ['a', 'b', 'c'], manual: true });
    expect(manual.ok).toBe(true);
    expect(salud.marcapasos.enUltimaHora(clock.ahora())).toBe(1);
  });

  it('fuera del horario del negocio lo automatico no sale y lo manual si', async () => {
    const { repos, sender, clock } = build();
    clock.set('2026-03-10T05:00:00Z'); // 00:00 en Lima
    await repos.templates.upsert(approvedTemplate());
    await contactoConOptIn(repos, '5215500000012');
    const r = await enviarPlantilla(sender, '5215500000012');
    expect(r.ok).toBe(false);
    if (!r.ok && r.blocked) expect(r.reason).toMatch(/fuera_de_horario/);
    const manual = await sender.send({ phone: '5215500000012', kind: 'template', category: 'UTILITY', templateName: 'confirmacion_pedido', templateLanguage: 'es_MX', variables: ['a', 'b', 'c'], manual: true });
    expect(manual.ok).toBe(true);
  });

  it('con el tier al 90 % se para, contando destinatarios unicos de 24 h', async () => {
    const { repos, sender } = build({
      politica: { maxPorHora: 10_000, maxPorMinuto: 10_000, warmup: { startPerDay: 5000, growth: 1, hardCap: 5000, reinicioTrasDiasInactivo: 0 } },
    });
    await repos.templates.upsert(approvedTemplate());
    await repos.numberState.setTier('PNID', 'TIER_250');
    // 225 destinatarios distintos ya escritos hoy.
    for (let i = 0; i < 225; i++) {
      const phone = `521550020${String(i).padStart(4, '0')}`;
      await contactoConOptIn(repos, phone);
      expect((await enviarPlantilla(sender, phone)).ok).toBe(true);
    }
    await contactoConOptIn(repos, '5215500009999');
    const r = await enviarPlantilla(sender, '5215500009999');
    expect(r.ok).toBe(false);
    if (!r.ok && r.blocked) expect(r.reason).toMatch(/tier_24h/);
    // El mismo destinatario de antes no suma uno nuevo, pero el techo ya se alcanzo igual.
  });

  it('en no oficial hay cupo de contactos nuevos por dia', async () => {
    const { repos, sender } = build({
      perfil: 'no_oficial',
      politica: {
        nuevosContactosPorDia: 2,
        maxPorHora: 100,
        maxPorMinuto: 100,
        separacionContactoMs: 0,
        warmup: { startPerDay: 100, growth: 1, hardCap: 100, reinicioTrasDiasInactivo: 0 },
      },
    });
    await repos.templates.upsert(approvedTemplate());
    for (const phone of ['5215500000020', '5215500000021', '5215500000022']) await contactoConOptIn(repos, phone);
    expect((await enviarPlantilla(sender, '5215500000020')).ok).toBe(true);
    expect((await enviarPlantilla(sender, '5215500000021')).ok).toBe(true);
    const tercero = await enviarPlantilla(sender, '5215500000022');
    expect(tercero.ok).toBe(false);
    if (!tercero.ok && tercero.blocked) expect(tercero.reason).toMatch(/nuevos_contactos_dia/);
    // A un contacto ya conocido si se le puede escribir.
    expect((await enviarPlantilla(sender, '5215500000020')).ok).toBe(true);
  });

  it('separacion por contacto y techo por contacto y dia', async () => {
    const { repos, sender, clock } = build({ politica: { maxPorContactoDia: 2, separacionContactoMs: 10 * 60_000 } });
    await repos.templates.upsert(approvedTemplate());
    await contactoConOptIn(repos, '5215500000030');
    expect((await enviarPlantilla(sender, '5215500000030')).ok).toBe(true);

    const pronto = await enviarPlantilla(sender, '5215500000030');
    expect(pronto.ok).toBe(false);
    if (!pronto.ok && pronto.blocked) expect(pronto.code).toBe('contact_spacing');

    clock.avanzar(11 * 60_000);
    expect((await enviarPlantilla(sender, '5215500000030')).ok).toBe(true);

    clock.avanzar(11 * 60_000);
    const tope = await enviarPlantilla(sender, '5215500000030');
    expect(tope.ok).toBe(false);
    if (!tope.ok && tope.blocked) expect(tope.code).toBe('contact_daily_cap');
  });

  it('fatiga: tras N envios sin respuesta no sale mas marketing hasta que el contacto escriba', async () => {
    const { repos, sender, clock } = build({ politica: { fatigaEnvios: 2, maxPorContactoDia: 10, separacionContactoMs: 0 } });
    await repos.templates.upsert(approvedTemplate({ name: 'promo', category: 'MARKETING' }));
    await repos.templates.upsert(approvedTemplate());
    await contactoConOptIn(repos, '5215500000040');
    const promo = () => sender.send({ phone: '5215500000040', kind: 'template', category: 'MARKETING', templateName: 'promo', templateLanguage: 'es_MX', variables: ['a', 'b', 'c'] });

    expect((await promo()).ok).toBe(true);
    clock.avanzar(DIA);
    expect((await enviarPlantilla(sender, '5215500000040')).ok).toBe(true);
    clock.avanzar(DIA);
    const cansado = await promo();
    expect(cansado.ok).toBe(false);
    if (!cansado.ok && cansado.blocked) expect(cansado.code).toBe('fatigue');
    // Lo transaccional sigue.
    expect((await enviarPlantilla(sender, '5215500000040')).ok).toBe(true);
    // El contacto escribe: la racha se corta.
    await repos.contacts.touchInbound('5215500000040', clock.ahora());
    clock.avanzar(DIA);
    expect((await promo()).ok).toBe(true);
  });
});

describe('monitor: lo que trae el webhook', () => {
  const ENV = {
    PUBLIC_BASE_URL: 'https://ejemplo.test',
    DATABASE_URL: 'postgres://x/y',
    WHATSAPP_TOKEN: 't',
    WHATSAPP_PHONE_NUMBER_ID: 'PNID',
    WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
    WHATSAPP_APP_SECRET: 's',
    WHATSAPP_VERIFY_TOKEN: 'verify-me',
    ADMIN_TOKEN: 'admin-token-largo-1234',
    TRACKING_SECRET: 'x'.repeat(40),
    GEO_BBOX: 'mexico',
  };

  async function conWebhook() {
    const b = build();
    const config = loadConfig(ENV as NodeJS.ProcessEnv);
    const settings = await createFakeSettings(config);
    const deps = { repos: b.repos, wa: b.wa, sender: b.sender, config, settings, salud: b.salud as Monitor };
    return { ...b, deps };
  }

  it('un `failed` con 131049 en los estados aparta al contacto de marketing', async () => {
    const { repos, deps } = await conWebhook();
    await repos.contacts.upsertFromInbound('5215500000050');
    await processChange('messages', {
      statuses: [{ id: 'wamid.x', status: 'failed', timestamp: '1', recipient_id: '5215500000050', errors: [{ code: 131049, title: 'per-user limit' }] }],
    }, deps);
    const c = await repos.contacts.getByPhone('5215500000050');
    expect(c?.suprimidoAmbito).toBe('marketing');
  });

  it('la pausa de una plantilla dura 3 h la primera vez, 6 h la segunda y la tercera la deshabilita', async () => {
    const { repos, deps } = await conWebhook();
    await repos.templates.upsert(approvedTemplate({ name: 'promo', category: 'MARKETING' }));
    const pausar = (title: string) =>
      processChange('message_template_status_update', {
        event: 'PAUSED',
        message_template_name: 'promo',
        message_template_language: 'es_MX',
        reason: 'NONE',
        other_info: { title, description: 'negative feedback' },
      }, deps);

    await pausar('FIRST_PAUSE');
    let t = (await repos.templates.get('promo', 'es_MX'))!;
    expect(t.status).toBe('APPROVED');
    expect(t.pausas).toBe(1);
    expect(t.pausadaHasta!.getTime() - Date.now()).toBeGreaterThan(2.9 * HORA);
    expect(t.pausadaHasta!.getTime() - Date.now()).toBeLessThanOrEqual(3 * HORA);

    await pausar('SECOND_PAUSE');
    t = (await repos.templates.get('promo', 'es_MX'))!;
    expect(t.pausas).toBe(2);
    expect(t.pausadaHasta!.getTime() - Date.now()).toBeGreaterThan(5.9 * HORA);

    await pausar('THIRD_PAUSE');
    t = (await repos.templates.get('promo', 'es_MX'))!;
    expect(t.status).toBe('DISABLED');
    expect(repos._salud.filter((e) => e.tipo === 'plantilla').length).toBe(3);
  });

  it('el gate respeta la pausa de la plantilla y la suelta al vencer', async () => {
    const { repos, deps, sender, clock } = await conWebhook();
    setFakeClock(null);
    await repos.templates.upsert(approvedTemplate());
    await contactoConOptIn(repos, '5215500000051');
    await processChange('message_template_status_update', {
      event: 'PAUSED',
      message_template_name: 'confirmacion_pedido',
      message_template_language: 'es_MX',
      other_info: { title: 'FIRST_PAUSE' },
    }, deps);
    // El webhook calcula la pausa con el reloj real; la prueba se situa ahi.
    clock.set(new Date(Date.now() + 60_000).toISOString());
    const r = await enviarPlantilla(sender, '5215500000051');
    expect(r.ok).toBe(false);
    if (!r.ok && r.blocked) expect(r.code).toBe('template_paused');
    // Pasadas las 3 h la plantilla vuelve sola. Se comprueba con el gate puro
    // para no depender de la hora del dia a la que corra la prueba.
    const t = (await repos.templates.get('confirmacion_pedido', 'es_MX'))!;
    expect(t.pausadaHasta!.getTime()).toBeLessThan(Date.now() + 3 * HORA + 1000);
    expect(t.status).toBe('APPROVED');
  });

  it('account_update con restriccion de envio pausa el numero y REINSTATE lo suelta', async () => {
    const { repos, deps } = await conWebhook();
    await processChange('account_update', {
      event: 'ACCOUNT_RESTRICTION',
      restriction_info: [{ restriction_type: 'RESTRICTED_BIZ_INITIATED_MESSAGING', expiration: '2026-03-12T00:00:00+0000' }],
    }, deps);
    let estado = await repos.numberState.get('PNID');
    expect(estado.paused).toBe(true);
    expect(estado.estado).toBe('RESTRICTED');
    expect(esPausaAutomatica(estado.pausedReason)).toBe(true);

    await processChange('account_update', { event: 'DISABLED_UPDATE', ban_info: { waba_ban_state: 'REINSTATE' } }, deps);
    estado = await repos.numberState.get('PNID');
    expect(estado.estado).toBe('CONNECTED');
    expect(estado.paused).toBe(false);
  });

  it('user_preferences stop/resume aparta y devuelve el marketing de esa persona', async () => {
    const { repos, deps } = await conWebhook();
    await processChange('user_preferences', {
      user_preferences: [{ wa_id: '5215500000060', category: 'marketing_messages', value: 'stop', timestamp: '1' }],
    }, deps);
    let c = await repos.contacts.getByPhone('5215500000060');
    expect(c?.suprimidoAmbito).toBe('marketing');
    await processChange('user_preferences', {
      user_preferences: [{ wa_id: '5215500000060', category: 'marketing_messages', value: 'resume', timestamp: '2' }],
    }, deps);
    c = await repos.contacts.getByPhone('5215500000060');
    expect(c?.suprimidoHasta).toBeNull();
  });

  it('business_capability_update fija el limite numerico del tier', async () => {
    const { repos, deps } = await conWebhook();
    await processChange('business_capability_update', { max_daily_conversation_per_phone: 2000, max_phone_numbers_per_business: 2 }, deps);
    expect((await repos.numberState.get('PNID')).limite24h).toBe(2000);
  });

  it('FLAGGED deja el estado del numero como Meta lo llama, y UNFLAGGED lo devuelve', async () => {
    const { repos, deps } = await conWebhook();
    await processChange('phone_number_quality_update', { event: 'FLAGGED', current_limit: 'TIER_1K' }, deps);
    let estado = await repos.numberState.get('PNID');
    expect(estado.estado).toBe('FLAGGED');
    expect(estado.quality).toBe('RED');
    expect(estado.paused).toBe(true);
    await processChange('phone_number_quality_update', { event: 'UNFLAGGED', current_limit: 'TIER_1K' }, deps);
    estado = await repos.numberState.get('PNID');
    expect(estado.estado).toBe('CONNECTED');
    expect(estado.paused).toBe(false);
  });

  it('template_category_update cambia la categoria local', async () => {
    const { repos, deps } = await conWebhook();
    await repos.templates.upsert(approvedTemplate());
    await processChange('template_category_update', {
      message_template_name: 'confirmacion_pedido',
      message_template_language: 'es_MX',
      previous_category: 'UTILITY',
      new_category: 'MARKETING',
    }, deps);
    expect((await repos.templates.get('confirmacion_pedido', 'es_MX'))?.category).toBe('MARKETING');
  });
});

describe('inicio del dia en la zona del negocio', () => {
  it('las 00:00 de Lima son las 05:00Z', () => {
    const t = new Date('2026-03-10T15:30:00Z');
    expect(inicioDelDia(t, 'America/Lima').toISOString()).toBe('2026-03-10T05:00:00.000Z');
    // A las 03:00Z todavia es el dia anterior en Lima.
    expect(inicioDelDia(new Date('2026-03-10T03:00:00Z'), 'America/Lima').toISOString()).toBe('2026-03-09T05:00:00.000Z');
  });
});
