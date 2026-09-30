import { describe, expect, it } from 'vitest';
import { signPayload, verifyChallenge, verifySignature } from '../src/whatsapp/signature.js';
import { createSeenCache, processChange } from '../src/whatsapp/webhook.js';
import { createSender } from '../src/outbound/sender.js';
import { loadConfig } from '../src/config.js';
import { approvedTemplate, createFakeRepos, createFakeSettings, createFakeWhatsApp } from './fakes.js';
import type { ChangeValue, InboundMessage } from '../src/whatsapp/types.js';

const SECRET = 'app-secret-de-prueba';

const ENV = {
  PUBLIC_BASE_URL: 'https://ejemplo.test',
  DATABASE_URL: 'postgres://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: SECRET,
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  GOOGLE_MAPS_API_KEY: 'maps-key',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'mexico',
};

describe('firma del webhook', () => {
  it('acepta una firma correcta', () => {
    const body = Buffer.from(JSON.stringify({ hola: 'mundo' }));
    expect(verifySignature(body, signPayload(body, SECRET), SECRET)).toBe(true);
  });

  it('rechaza cuerpo alterado, secreto distinto y cabecera ausente', () => {
    const body = Buffer.from('{"a":1}');
    const signature = signPayload(body, SECRET);
    expect(verifySignature(Buffer.from('{"a":2}'), signature, SECRET)).toBe(false);
    expect(verifySignature(body, signature, 'otro-secreto')).toBe(false);
    expect(verifySignature(body, undefined, SECRET)).toBe(false);
    expect(verifySignature(body, 'sha1=abc', SECRET)).toBe(false);
  });

  it('responde el challenge de verificacion solo con el token correcto', () => {
    const query = { 'hub.mode': 'subscribe', 'hub.verify_token': 'v', 'hub.challenge': '12345' };
    expect(verifyChallenge(query, 'v')).toBe('12345');
    expect(verifyChallenge(query, 'otro')).toBeNull();
  });
});

async function build() {
  const config = loadConfig(ENV as NodeJS.ProcessEnv);
  const settings = await createFakeSettings(config);
  const repos = createFakeRepos();
  const wa = createFakeWhatsApp();
  const sender = createSender({
    repos,
    wa,
    phoneNumberId: 'PNID',
    warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 },
    maxMarketingPerContact7d: 2,
  });
  return { deps: { repos, wa, sender, config, settings }, repos, wa };
}

function inbound(overrides: Partial<InboundMessage>): ChangeValue {
  return {
    contacts: [{ wa_id: '5215599999999', profile: { name: 'Ana' } }],
    messages: [
      {
        id: 'wamid.in.1',
        from: '5215599999999',
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        ...overrides,
      } as InboundMessage,
    ],
  };
}

describe('mensajes entrantes', () => {
  it('una ubicacion nativa se guarda confirmada y se responde', async () => {
    const { deps, repos, wa } = await build();
    await processChange(
      'messages',
      inbound({ type: 'location', location: { latitude: 19.4326, longitude: -99.1332 } }),
      deps,
    );

    expect(repos._locations).toHaveLength(1);
    expect(repos._locations[0]).toMatchObject({ source: 'whatsapp_native', confirmed: true });
    expect(wa.sent.some((m) => m.kind === 'text')).toBe(true);
  });

  it('un link de Google Maps se convierte en coordenadas', async () => {
    const { deps, repos } = await build();
    await processChange(
      'messages',
      inbound({
        type: 'text',
        text: { body: 'aqui estoy https://www.google.com/maps/place/X/data=!8m2!3d19.4352!4d-99.1412' },
      }),
      deps,
    );

    expect(repos._locations[0]).toMatchObject({ source: 'data_3d4d', confirmed: true });
  });

  it('un link con solo @lat,lng pide confirmacion con botones', async () => {
    const { deps, repos, wa } = await build();
    await processChange(
      'messages',
      inbound({ type: 'text', text: { body: 'https://www.google.com/maps/@19.4326,-99.1332,15z' } }),
      deps,
    );

    expect(repos._locations[0]).toMatchObject({ source: 'at_viewport', confirmed: false });
    expect(wa.sent.some((m) => m.kind === 'buttons')).toBe(true);
  });

  it('un texto sin coordenadas dispara el boton nativo de ubicacion', async () => {
    const { deps, repos, wa } = await build();
    await repos.automation.setPrefs({ askLocationFallback: true, preventaActiva: false });
    await processChange('messages', inbound({ text: { body: 'hola, quiero cotizar' } }), deps);
    expect(wa.sent.some((m) => m.kind === 'location_request')).toBe(true);
  });

  it('BAJA da de baja al contacto de inmediato', async () => {
    const { deps, repos } = await build();
    await processChange('messages', inbound({ text: { body: 'BAJA' } }), deps);
    expect((await repos.contacts.getByPhone('5215599999999'))?.optOutAt).toBeInstanceOf(Date);
  });

  it('reconoce la baja con acentos y espacios', async () => {
    const { deps, repos } = await build();
    await processChange('messages', inbound({ text: { body: '  Bajá  ' } }), deps);
    expect((await repos.contacts.getByPhone('5215599999999'))?.optOutAt).toBeInstanceOf(Date);
  });

  it('ALTA registra el opt-in y borra la baja previa', async () => {
    const { deps, repos } = await build();
    await repos.contacts.setOptOut('5215599999999');
    await processChange('messages', inbound({ text: { body: 'alta' } }), deps);

    const contact = await repos.contacts.getByPhone('5215599999999');
    expect(contact?.optInAt).toBeInstanceOf(Date);
    expect(contact?.optOutAt).toBeNull();
  });

  it('el entrante abre la ventana de 24 h', async () => {
    const { deps, repos } = await build();
    await processChange('messages', inbound({ text: { body: 'hola' } }), deps);
    expect((await repos.contacts.getByPhone('5215599999999'))?.lastInboundAt).toBeInstanceOf(Date);
  });
});

describe('eventos de estado y calidad', () => {
  it('actualiza el estado de una entrega por wamid', async () => {
    const { deps, repos } = await build();
    await repos.contacts.upsertFromInbound('5215500000010');
    const id = await repos.deliveries.create({
      contactId: 'c1',
      kind: 'template',
      category: 'UTILITY',
    });
    await repos.deliveries.markSent(id, 'wamid.out.1');

    await processChange(
      'messages',
      {
        statuses: [
          {
            id: 'wamid.out.1',
            status: 'read',
            timestamp: '1',
            recipient_id: '5215500000010',
          },
        ],
      },
      deps,
    );

    expect(repos._deliveries.at(-1)).toMatchObject({ status: 'read' });
  });

  it('una plantilla rechazada sale de circulacion', async () => {
    const { deps, repos } = await build();
    await repos.templates.upsert(approvedTemplate());

    await processChange(
      'message_template_status_update',
      {
        event: 'REJECTED',
        message_template_name: 'confirmacion_pedido',
        message_template_language: 'es',
      },
      deps,
    );

    expect((await repos.templates.get('confirmacion_pedido', 'es'))?.status).toBe('REJECTED');
  });

  it('la calidad de una plantilla se propaga al registro', async () => {
    const { deps, repos } = await build();
    await repos.templates.upsert(approvedTemplate());

    await processChange(
      'message_template_quality_update',
      {
        message_template_name: 'confirmacion_pedido',
        message_template_language: 'es',
        new_quality_score: 'YELLOW',
      },
      deps,
    );

    expect((await repos.templates.get('confirmacion_pedido', 'es'))?.quality).toBe('YELLOW');
  });

  it('calidad del numero en ROJO pausa el envio', async () => {
    const { deps, repos } = await build();
    await processChange('phone_number_quality_update', { event: 'FLAGGED_RED' }, deps);

    const state = await repos.numberState.get('PNID');
    expect(state.quality).toBe('RED');
    expect(state.paused).toBe(true);
  });
});

describe('eventos reales de calidad del numero', () => {
  it('FLAGGED pone el numero en rojo y lo pausa; UNFLAGGED lo reanuda', async () => {
    const { deps, repos } = await build();
    await processChange('phone_number_quality_update', { event: 'FLAGGED', current_limit: 'TIER_1K' }, deps);

    let state = await repos.numberState.get('PNID');
    expect(state).toMatchObject({ quality: 'RED', paused: true, tier: 'TIER_1K' });

    await processChange('phone_number_quality_update', { event: 'UNFLAGGED', current_limit: 'TIER_1K' }, deps);
    state = await repos.numberState.get('PNID');
    expect(state).toMatchObject({ quality: 'GREEN', paused: false });
  });

  it('UNFLAGGED no levanta una pausa manual', async () => {
    const { deps, repos } = await build();
    await repos.numberState.setPaused('PNID', true, 'pausa manual');
    await processChange('phone_number_quality_update', { event: 'UNFLAGGED' }, deps);
    expect((await repos.numberState.get('PNID')).paused).toBe(true);
  });

  it('DOWNGRADE deja el numero en amarillo y guarda el tier', async () => {
    const { deps, repos } = await build();
    await processChange('phone_number_quality_update', { event: 'DOWNGRADE', current_limit: 'TIER_250' }, deps);
    expect(await repos.numberState.get('PNID')).toMatchObject({ quality: 'YELLOW', paused: false, tier: 'TIER_250' });
  });

  it('ONBOARDING no toca la calidad', async () => {
    const { deps, repos } = await build();
    await processChange('phone_number_quality_update', { event: 'ONBOARDING', current_limit: 'TIER_250' }, deps);
    expect(await repos.numberState.get('PNID')).toMatchObject({ quality: 'GREEN', tier: 'TIER_250' });
  });
});

describe('deduplicacion de entrantes', () => {
  it('el mismo mensaje reintentado por Meta se procesa una sola vez', async () => {
    const { deps, repos, wa } = await build();
    await repos.automation.setPrefs({ askLocationFallback: true, preventaActiva: false });
    const withSeen = { ...deps, seen: createSeenCache() };
    const payload = inbound({ text: { body: 'hola' } });

    await processChange('messages', payload, withSeen);
    await processChange('messages', payload, withSeen);

    expect(wa.sent.filter((m) => m.kind === 'location_request')).toHaveLength(1);
  });

  it('sin cache, el hilo guardado sigue deduplicando por id: dos ids distintos son dos mensajes', async () => {
    const { deps, repos, wa } = await build();
    await repos.automation.setPrefs({ askLocationFallback: true, preventaActiva: false });
    // El mismo id dos veces (reentrega tras un reinicio) se atiende una vez...
    const payload = inbound({ text: { body: 'hola' } });
    await processChange('messages', payload, deps);
    await processChange('messages', payload, deps);
    expect(wa.sent.filter((m) => m.kind === 'location_request')).toHaveLength(1);
    // ...y otro id es otro mensaje.
    await processChange('messages', inbound({ id: 'wamid.in.2', text: { body: 'hola' } }), deps);
    expect(wa.sent.filter((m) => m.kind === 'location_request')).toHaveLength(2);
  });
});
