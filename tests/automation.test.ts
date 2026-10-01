import { describe, expect, it } from 'vitest';
import { createSender } from '../src/outbound/sender.js';
import { loadConfig } from '../src/config.js';
import { processChange } from '../src/whatsapp/webhook.js';
import { cancelEnrollment, enrollContact, matchRule, onInboundReply, renderPlaceholders, runDueMessages, saludoPorHora } from '../src/automation/engine.js';
import type { AutoReply } from '../src/db/automation.js';
import { approvedTemplate, createFakeRepos, createFakeSettings, createFakeWhatsApp } from './fakes.js';
import type { ChangeValue, InboundMessage } from '../src/whatsapp/types.js';

const ENV = {
  PUBLIC_BASE_URL: 'https://ejemplo.test',
  DATABASE_URL: 'mysql://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 's',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'mexico',
} as NodeJS.ProcessEnv;

function rule(overrides: Partial<AutoReply>): AutoReply {
  return {
    id: 'r',
    name: 'regla',
    trigger: 'keyword',
    keyword: null,
    match: 'contains',
    reply: 'hola',
    sequenceId: null,
    enabled: true,
    priority: 100,
    createdAt: new Date(),
    ...overrides,
  };
}

async function build(opts: { now?: () => Date } = {}) {
  const config = loadConfig(ENV);
  const settings = await createFakeSettings(config);
  const repos = createFakeRepos();
  const wa = createFakeWhatsApp();
  const sender = createSender({
    repos,
    wa,
    phoneNumberId: 'PNID',
    warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 },
    maxMarketingPerContact7d: 2,
    now: opts.now,
  });
  return { config, settings, repos, wa, sender, deps: { repos, wa, sender, config, settings } };
}

function inbound(overrides: Partial<InboundMessage>, phone = '5215599999999'): ChangeValue {
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

describe('marcadores de posicion', () => {
  it('sustituye nombre y telefono', () => {
    const contact = { id: 'c', phone: '5215500000001', name: 'Ana', optInAt: null, optInSource: null, optOutAt: null, lastInboundAt: null };
    expect(renderPlaceholders('Hola {nombre}, tu numero es {telefono}', contact)).toBe(
      'Hola Ana, tu numero es 5215500000001',
    );
  });

  it('sin nombre no deja huecos dobles', () => {
    const contact = { id: 'c', phone: '1', name: null, optInAt: null, optInSource: null, optOutAt: null, lastInboundAt: null };
    expect(renderPlaceholders('Hola {nombre}, gracias', contact)).toBe('Hola , gracias');
  });
});

describe('eleccion de regla', () => {
  const rules = [
    rule({ id: 'kw', trigger: 'keyword', keyword: 'precio', match: 'contains', priority: 10 }),
    rule({ id: 'exact', trigger: 'keyword', keyword: 'menu', match: 'equals' }),
    rule({ id: 'welcome', trigger: 'first_message' }),
    rule({ id: 'any', trigger: 'any' }),
  ];

  it('la palabra clave manda, sin importar acentos ni mayusculas', () => {
    expect(matchRule(rules, 'Cual es el PRECIO?', { isFirstMessage: true, hasCoordinates: false })?.id).toBe('kw');
  });

  it('equals exige el texto completo', () => {
    expect(matchRule(rules, 'menu', { isFirstMessage: false, hasCoordinates: false })?.id).toBe('exact');
    expect(matchRule(rules, 'dame el menu', { isFirstMessage: false, hasCoordinates: false })?.id).toBe('any');
  });

  it('bienvenida solo en el primer mensaje; luego el comodin', () => {
    expect(matchRule(rules, 'hola', { isFirstMessage: true, hasCoordinates: false })?.id).toBe('welcome');
    expect(matchRule(rules, 'hola', { isFirstMessage: false, hasCoordinates: false })?.id).toBe('any');
  });

  it('con coordenadas ni bienvenida ni comodin: manda el flujo de ubicacion', () => {
    expect(matchRule(rules, 'https://maps.google.com/?q=19.4,-99.1', { isFirstMessage: true, hasCoordinates: true })).toBeNull();
  });

  it('una regla apagada no cuenta', () => {
    const off = [rule({ id: 'kw', keyword: 'precio', enabled: false })];
    expect(matchRule(off, 'precio', { isFirstMessage: false, hasCoordinates: false })).toBeNull();
  });
});

describe('secuencias', () => {
  it('inscribir programa el primer paso con su retardo', async () => {
    const now = new Date('2026-03-10T12:00:00Z');
    const { repos, sender } = await build({ now: () => now });
    const sequence = await repos.automation.createSequence({
      name: 'seg',
      steps: [
        { delayMinutes: 60, kind: 'template', templateName: 'confirmacion_pedido', variables: ['{nombre}', 'A-1', 'x'] },
        { delayMinutes: 1440, kind: 'text', text: 'ultimo aviso' },
      ],
    });
    const contact = await repos.contacts.upsertFromInbound('5215500000001', 'Ana');

    const { created } = await enrollContact({ repos, sender, now: () => now }, sequence, contact, 'test');
    expect(created).toBe(true);

    const pending = await repos.automation.listScheduled({ status: 'pending', limit: 10, offset: 0 });
    expect(pending).toHaveLength(1);
    expect(pending[0]!.dueAt.toISOString()).toBe('2026-03-10T13:00:00.000Z');
    expect(pending[0]!.stepPosition).toBe(1);
  });

  it('no duplica una inscripcion activa', async () => {
    const { repos, sender } = await build();
    const sequence = await repos.automation.createSequence({
      name: 'seg',
      steps: [{ delayMinutes: 0, kind: 'text', text: 'hola' }],
    });
    const contact = await repos.contacts.upsertFromInbound('5215500000001');
    await enrollContact({ repos, sender }, sequence, contact, null);
    const second = await enrollContact({ repos, sender }, sequence, contact, null);
    expect(second.created).toBe(false);
    expect(await repos.automation.listScheduled({ limit: 10, offset: 0 })).toHaveLength(1);
  });

  it('procesar un paso vencido lo envia y programa el siguiente', async () => {
    let now = new Date('2026-03-10T12:00:00Z');
    const clock = () => now;
    const { repos, wa, sender } = await build({ now: clock });
    await repos.templates.upsert(approvedTemplate());
    const sequence = await repos.automation.createSequence({
      name: 'seg',
      steps: [
        { delayMinutes: 0, kind: 'template', templateName: 'confirmacion_pedido', variables: ['{nombre}', 'A-1', 'x'] },
        { delayMinutes: 30, kind: 'template', templateName: 'confirmacion_pedido', variables: ['{nombre}', 'A-2', 'y'] },
      ],
    });
    await repos.contacts.setOptIn('5215500000001', 'form');
    const contact = (await repos.contacts.getByPhone('5215500000001'))!;
    contact.name = 'Ana';
    await enrollContact({ repos, sender, now: clock }, sequence, contact, null);

    const report = await runDueMessages({ repos, sender, now: clock });
    expect(report).toMatchObject({ processed: 1, sent: 1 });
    // La variable {nombre} llega sustituida a la API.
    const sent = wa.sent.at(-1) as { components: Array<{ parameters: Array<{ text: string }> }> };
    expect(sent.components[0]!.parameters[0]!.text).toBe('Ana');

    const pending = await repos.automation.listScheduled({ status: 'pending', limit: 10, offset: 0 });
    expect(pending).toHaveLength(1);
    expect(pending[0]!.stepPosition).toBe(2);
    expect(pending[0]!.dueAt.toISOString()).toBe('2026-03-10T12:30:00.000Z');

    // Todavia no toca: no se procesa nada.
    expect((await runDueMessages({ repos, sender, now: clock })).processed).toBe(0);

    now = new Date('2026-03-10T12:31:00Z');
    expect((await runDueMessages({ repos, sender, now: clock })).sent).toBe(1);
    const enrollment = (await repos.automation.listEnrollments({ limit: 10, offset: 0 }))[0]!;
    expect(enrollment.status).toBe('completed');
  });

  it('un bloqueo definitivo cierra la secuencia', async () => {
    const { repos, sender } = await build();
    await repos.templates.upsert(approvedTemplate());
    const sequence = await repos.automation.createSequence({
      name: 'seg',
      steps: [
        { delayMinutes: 0, kind: 'template', templateName: 'confirmacion_pedido', variables: ['a', 'b', 'c'] },
        { delayMinutes: 10, kind: 'template', templateName: 'confirmacion_pedido', variables: ['a', 'b', 'c'] },
      ],
    });
    // Sin opt-in: el gate bloquea sin reintento.
    const contact = await repos.contacts.upsertFromInbound('5215500000002');
    await enrollContact({ repos, sender }, sequence, contact, null);

    const report = await runDueMessages({ repos, sender });
    expect(report).toMatchObject({ processed: 1, blocked: 1 });
    const enrollment = (await repos.automation.listEnrollments({ limit: 10, offset: 0 }))[0]!;
    expect(enrollment.status).toBe('cancelled');
    expect(await repos.automation.listScheduled({ status: 'pending', limit: 10, offset: 0 })).toHaveLength(0);
  });

  it('un bloqueo con espera se reprograma sin avanzar', async () => {
    const now = new Date('2026-03-10T12:00:00Z');
    const { repos, sender } = await build({ now: () => now });
    await repos.numberState.setPaused('PNID', true, 'pausa manual');
    await repos.templates.upsert(approvedTemplate());
    const sequence = await repos.automation.createSequence({
      name: 'seg',
      steps: [{ delayMinutes: 0, kind: 'template', templateName: 'confirmacion_pedido', variables: ['a', 'b', 'c'] }],
    });
    await repos.contacts.setOptIn('5215500000003', 'form');
    const contact = (await repos.contacts.getByPhone('5215500000003'))!;
    await enrollContact({ repos, sender, now: () => now }, sequence, contact, null);

    const report = await runDueMessages({ repos, sender, now: () => now });
    expect(report).toMatchObject({ processed: 1, rescheduled: 1 });
    const pending = await repos.automation.listScheduled({ status: 'pending', limit: 10, offset: 0 });
    expect(pending).toHaveLength(1);
    expect(pending[0]!.dueAt.getTime()).toBeGreaterThan(now.getTime());
    expect(pending[0]!.stepPosition).toBe(1);
  });

  it('si el contacto responde se cancelan los seguimientos pendientes', async () => {
    const { repos, sender } = await build();
    const sequence = await repos.automation.createSequence({
      name: 'seg',
      stopOnReply: true,
      steps: [{ delayMinutes: 60, kind: 'text', text: 'sigues ahi?' }],
    });
    const keep = await repos.automation.createSequence({
      name: 'no se detiene',
      stopOnReply: false,
      steps: [{ delayMinutes: 60, kind: 'text', text: 'recordatorio' }],
    });
    const contact = await repos.contacts.upsertFromInbound('5215500000004');
    await enrollContact({ repos, sender }, sequence, contact, null);
    await enrollContact({ repos, sender }, keep, contact, null);

    expect(await onInboundReply(repos, contact)).toBe(1);
    const active = await repos.automation.listEnrollments({ status: 'active', limit: 10, offset: 0 });
    expect(active.map((e) => e.sequenceName)).toEqual(['no se detiene']);
    expect(await repos.automation.listScheduled({ status: 'pending', limit: 10, offset: 0 })).toHaveLength(1);
  });

  it('cancelar a mano deja todo cancelado', async () => {
    const { repos, sender } = await build();
    const sequence = await repos.automation.createSequence({
      name: 'seg',
      steps: [{ delayMinutes: 60, kind: 'text', text: 'x' }],
    });
    const contact = await repos.contacts.upsertFromInbound('5215500000005');
    const { enrollment } = await enrollContact({ repos, sender }, sequence, contact, null);
    await cancelEnrollment(repos, enrollment.id);
    expect((await repos.automation.getEnrollment(enrollment.id))?.status).toBe('cancelled');
    expect((await repos.automation.listScheduled({ limit: 10, offset: 0 }))[0]?.status).toBe('cancelled');
  });
});

describe('mensajes programados sueltos', () => {
  it('un texto dentro de la ventana sale; fuera de ella se bloquea', async () => {
    const { repos, sender, wa } = await build();
    const inWindow = await repos.contacts.upsertFromInbound('5215500000006');
    await repos.contacts.touchInbound(inWindow.phone, new Date());
    const outside = await repos.contacts.upsertFromInbound('5215500000007');
    await repos.contacts.setOptIn(outside.phone, 'form');

    const past = new Date(Date.now() - 1000);
    await repos.automation.schedule({ contactId: inWindow.id, dueAt: past, kind: 'freeform', category: 'UTILITY', text: 'hola {nombre}' });
    await repos.automation.schedule({ contactId: outside.id, dueAt: past, kind: 'freeform', category: 'UTILITY', text: 'hola' });

    const report = await runDueMessages({ repos, sender });
    expect(report).toMatchObject({ processed: 2, sent: 1, blocked: 1 });
    expect(wa.sent.filter((m) => m.kind === 'text')).toHaveLength(1);
    const list = await repos.automation.listScheduled({ limit: 10, offset: 0 });
    expect(list.find((m) => m.status === 'blocked')?.detail).toContain('window_closed');
  });
});

describe('reglas sobre mensajes entrantes', () => {
  it('una palabra clave responde con el nombre del contacto', async () => {
    const { deps, repos, wa } = await build();
    await repos.automation.createRule({ name: 'precio', trigger: 'keyword', keyword: 'precio', reply: 'Hola {nombre}, el precio es 100.' });

    await processChange('messages', inbound({ text: { body: 'cual es el precio?' } }), deps);

    const texts = wa.sent.filter((m) => m.kind === 'text');
    expect(texts).toHaveLength(1);
    expect(texts[0]!.body).toBe('Hola Ana, el precio es 100.');
    // La regla contesto: no se pide la ubicacion.
    expect(wa.sent.some((m) => m.kind === 'location_request')).toBe(false);
  });

  it('la bienvenida sale solo con el primer mensaje', async () => {
    const { deps, repos, wa } = await build();
    await repos.automation.createRule({ name: 'bienvenida', trigger: 'first_message', reply: 'Bienvenido' });
    await repos.automation.setPrefs({ askLocationFallback: false });

    await processChange('messages', inbound({ text: { body: 'hola' } }), deps);
    await processChange('messages', inbound({ text: { body: 'hola otra vez' } }), deps);

    expect(wa.sent.filter((m) => m.kind === 'text' && m.body === 'Bienvenido')).toHaveLength(1);
  });

  it('una regla puede inscribir en una secuencia', async () => {
    const { deps, repos } = await build();
    const sequence = await repos.automation.createSequence({
      name: 'seg',
      steps: [{ delayMinutes: 1440, kind: 'text', text: 'seguimos?' }],
    });
    await repos.automation.createRule({ name: 'cotizar', trigger: 'keyword', keyword: 'cotizar', reply: 'Va', sequenceId: sequence.id });

    await processChange('messages', inbound({ text: { body: 'quiero cotizar' } }), deps);

    const enrollments = await repos.automation.listEnrollments({ status: 'active', limit: 10, offset: 0 });
    expect(enrollments).toHaveLength(1);
    expect(enrollments[0]!.source).toBe('regla: cotizar');
  });

  it('sin regla y con el fallback apagado, el bot no pide la ubicacion', async () => {
    const { deps, repos, wa } = await build();
    await repos.automation.setPrefs({ askLocationFallback: false });
    await processChange('messages', inbound({ text: { body: 'hola' } }), deps);
    expect(wa.sent.some((m) => m.kind === 'location_request')).toBe(false);
  });

  it('sin regla y con el fallback encendido, si la pide', async () => {
    const { deps, repos, wa } = await build();
    await repos.automation.setPrefs({ askLocationFallback: true, preventaActiva: false });
    await processChange('messages', inbound({ text: { body: 'hola' } }), deps);
    expect(wa.sent.some((m) => m.kind === 'location_request')).toBe(true);
  });

  it('un link con coordenadas sigue el flujo de ubicacion aunque haya bienvenida', async () => {
    const { deps, repos, wa } = await build();
    await repos.automation.createRule({ name: 'bienvenida', trigger: 'first_message', reply: 'Bienvenido' });
    await processChange(
      'messages',
      inbound({ text: { body: 'https://www.google.com/maps/place/X/data=!8m2!3d19.4352!4d-99.1412' } }),
      deps,
    );
    expect(repos._locations).toHaveLength(1);
    expect(wa.sent.some((m) => m.kind === 'text' && m.body === 'Bienvenido')).toBe(false);
  });

  it('responder cancela el seguimiento que esperaba respuesta', async () => {
    const { deps, repos, sender } = await build();
    const sequence = await repos.automation.createSequence({
      name: 'seg',
      steps: [{ delayMinutes: 1440, kind: 'text', text: 'sigues ahi?' }],
    });
    const contact = await repos.contacts.upsertFromInbound('5215599999999');
    await enrollContact({ repos, sender }, sequence, contact, null);

    await processChange('messages', inbound({ text: { body: 'si, aqui estoy' } }), deps);

    const enrollment = (await repos.automation.listEnrollments({ limit: 10, offset: 0 }))[0]!;
    expect(enrollment.status).toBe('cancelled');
  });
});

/**
 * El saludo por hora.
 *
 * La hora que decide es la del negocio, no la del servidor: este puede estar
 * en cualquier parte, y un "buenos dias" a medianoche delata al robot.
 */
describe('saludo segun la hora', () => {
  const enLima = (iso: string) => new Date(iso);

  it('de madrugada y por la mañana, buenos dias', () => {
    // 14:00 UTC son las 09:00 en Lima (UTC-5).
    expect(saludoPorHora(enLima('2026-03-10T14:00:00Z'), 'America/Lima')).toBe('Buenos días');
    expect(saludoPorHora(enLima('2026-03-10T06:00:00Z'), 'America/Lima')).toBe('Buenos días');
  });

  it('a partir del mediodia, buenas tardes', () => {
    expect(saludoPorHora(enLima('2026-03-10T17:00:00Z'), 'America/Lima')).toBe('Buenas tardes');
    expect(saludoPorHora(enLima('2026-03-10T23:30:00Z'), 'America/Lima')).toBe('Buenas tardes');
  });

  it('a partir de las siete, buenas noches', () => {
    // 00:00 UTC son las 19:00 del dia anterior en Lima.
    expect(saludoPorHora(enLima('2026-03-11T00:00:00Z'), 'America/Lima')).toBe('Buenas noches');
    expect(saludoPorHora(enLima('2026-03-11T04:00:00Z'), 'America/Lima')).toBe('Buenas noches');
  });

  it('manda la zona del negocio, no la del servidor', () => {
    // El mismo instante: las cinco de la tarde en Lima, las once de la noche
    // en Madrid. Seis horas de diferencia bastan para cambiar el saludo.
    const instante = enLima('2026-03-10T22:00:00Z');
    expect(saludoPorHora(instante, 'America/Lima')).toBe('Buenas tardes');
    expect(saludoPorHora(instante, 'Europe/Madrid')).toBe('Buenas noches');
  });

  it('una zona horaria invalida no tumba el saludo', () => {
    expect(['Buenos días', 'Buenas tardes', 'Buenas noches']).toContain(
      saludoPorHora(new Date(), 'Zona/Inventada'),
    );
  });

  it('{saludo} se sustituye en la respuesta de una regla', () => {
    const contacto = {
      id: 'c1',
      phone: '51963145055',
      name: 'Roberto',
      optInAt: null,
      optInSource: null,
      optOutAt: null,
      lastInboundAt: null,
    };

    const texto = renderPlaceholders(
      'Hola {nombre}, {saludo}. Gracias por escribir.',
      contacto,
      enLima('2026-03-10T14:00:00Z'),
      'America/Lima',
    );

    expect(texto).toBe('Hola Roberto, Buenos días. Gracias por escribir.');
  });
});
