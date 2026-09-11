/**
 * Dos redes contra escribirle a quien no toca:
 *
 *  - lo que WhatsApp Web reentrega al reconectar (historial, cola de cuando
 *    el sistema estaba apagado) se guarda en el hilo pero no se contesta, y
 *    un mensaje ya atendido no se atiende dos veces tras un reinicio;
 *  - en modo prueba (SOLO_NUMEROS) no sale nada a nadie fuera de la lista,
 *    venga de una campana, de rutas, del chat a mano o del asistente.
 *
 * Existe por un incidente real: al reconectar, el asistente contesto a diez
 * clientes de golpe.
 */

import { describe, expect, it } from 'vitest';
import { processChange } from '../src/whatsapp/webhook.js';
import { createSender } from '../src/outbound/sender.js';
import { loadConfig } from '../src/config.js';
import { esMensajeViejo, resetLocalForTests, startLocal, type LocalSocket } from '../src/whatsapp/local/session.js';
import { numeroPermitido } from '../src/salud/lista-blanca.js';
import { approvedTemplate, createFakeRepos, createFakeSettings, createFakeWhatsApp } from './fakes.js';
import type { ChangeValue, InboundMessage } from '../src/whatsapp/types.js';

const ENV = {
  PUBLIC_BASE_URL: 'https://ejemplo.test',
  DATABASE_URL: 'postgres://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 's',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'mexico',
};

async function build(extraEnv: Record<string, string> = {}) {
  const config = loadConfig({ ...ENV, ...extraEnv } as NodeJS.ProcessEnv);
  const settings = await createFakeSettings(config);
  const repos = createFakeRepos();
  const wa = createFakeWhatsApp();
  const sender = createSender({
    repos,
    wa,
    phoneNumberId: 'PNID',
    warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 },
    maxMarketingPerContact7d: 2,
    soloNumeros: config.soloNumeros,
  });
  return { deps: { repos, wa, sender, config, settings }, repos, wa, sender, config };
}

function entrante(overrides: Partial<InboundMessage>): ChangeValue {
  return {
    contacts: [{ wa_id: '5215599999999', profile: { name: 'Ana' } }],
    messages: [
      {
        id: 'wamid.in.1',
        from: '5215599999999',
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: 'hola' },
        ...overrides,
      } as InboundMessage,
    ],
  };
}

describe('lo reentregado no se contesta', () => {
  it('un mensaje viejo se guarda en el hilo y no dispara nada', async () => {
    const { deps, repos, wa } = await build();
    await processChange('messages', entrante({ viejo: true }), deps);
    expect(wa.sent.length).toBe(0);
    expect(repos.messages._all.length).toBe(1);
    expect(repos.messages._all[0]).toMatchObject({ direction: 'in', body: 'hola' });
    // Ni abre la ventana de 24 h: es de hace horas.
    expect((await repos.contacts.getByPhone('5215599999999'))?.lastInboundAt).toBeNull();
  });

  it('un mensaje ya atendido no se atiende otra vez tras un reinicio', async () => {
    const { deps, wa } = await build();
    await processChange('messages', entrante({}), deps);
    const enviados = wa.sent.length;
    expect(enviados).toBeGreaterThan(0);
    // El mismo id vuelve (WhatsApp Web lo reentrega): nada nuevo sale.
    await processChange('messages', entrante({}), deps);
    expect(wa.sent.length).toBe(enviados);
  });

  it('esMensajeViejo: solo notify y reciente se contesta', () => {
    const ahora = Date.now();
    const hace = (min: number) => String(Math.floor((ahora - min * 60_000) / 1000));
    expect(esMensajeViejo('notify', hace(1), ahora)).toBe(false);
    expect(esMensajeViejo('notify', hace(9), ahora)).toBe(false);
    expect(esMensajeViejo('notify', hace(11), ahora)).toBe(true);
    expect(esMensajeViejo('append', hace(0), ahora)).toBe(true);
    expect(esMensajeViejo(undefined, hace(0), ahora)).toBe(true);
    // Sin timestamp no se puede saber: se contesta si es notify.
    expect(esMensajeViejo('notify', undefined, ahora)).toBe(false);
  });

  it('la sesion local marca como viejo lo que llega como append o con horas de retraso', async () => {
    resetLocalForTests();
    const handlers = new Map<string, (arg: unknown) => void>();
    const recibidos: ChangeValue[] = [];
    const sock: LocalSocket = {
      async sendMessage() {
        return { key: { id: 'x' } };
      },
      async readMessages() {},
      async requestPairingCode() {
        return 'ABCD1234';
      },
      async logout() {},
      end() {},
      ev: { on: (evento, handler) => handlers.set(evento, handler as (arg: unknown) => void) },
      user: { id: '5215500000000:1@s.whatsapp.net', name: 'Mi Negocio' },
    };
    const promesa = startLocal({
      authDir: 'C:/x',
      createSocket: async () => ({ sock, saveCreds: async () => {} }),
      onChange: (value) => {
        recibidos.push(value);
      },
    });
    for (let i = 0; i < 100 && !handlers.has('messages.upsert'); i++) await new Promise((r) => setTimeout(r, 5));
    handlers.get('connection.update')?.({ connection: 'open' });
    await promesa;

    const ahoraSeg = Math.floor(Date.now() / 1000);
    const mensaje = (id: string, ts: number) => ({
      key: { id, remoteJid: '5215512345678@s.whatsapp.net', fromMe: false },
      messageTimestamp: ts,
      message: { conversation: 'hola' },
    });
    handlers.get('messages.upsert')?.({ type: 'append', messages: [mensaje('A', ahoraSeg)] });
    handlers.get('messages.upsert')?.({ type: 'notify', messages: [mensaje('B', ahoraSeg - 3 * 3600)] });
    handlers.get('messages.upsert')?.({ type: 'notify', messages: [mensaje('C', ahoraSeg)] });
    for (let i = 0; i < 100 && recibidos.length < 3; i++) await new Promise((r) => setTimeout(r, 5));

    const porId = Object.fromEntries(recibidos.map((v) => [v.messages![0]!.id, v.messages![0]!.viejo ?? false]));
    expect(porId).toEqual({ A: true, B: true, C: false });
  });
});

describe('sin socket no se intenta nada', () => {
  it('el sender devuelve "espera" sin crear una entrega fallida', async () => {
    const { repos, wa, sender } = await build();
    await repos.templates.upsert(approvedTemplate());
    await repos.contacts.upsertFromInbound('51912426667');
    await repos.contacts.setOptIn('51912426667', 'x');
    (wa as unknown as { conectado: () => boolean }).conectado = () => false;
    const r = await sender.send({ phone: '51912426667', kind: 'freeform', category: 'UTILITY', text: 'hola', manual: true });
    expect(r.ok).toBe(false);
    if (!r.ok && r.blocked) {
      expect(r.code).toBe('sin_conexion');
      expect(r.retryAfterMs).toBeGreaterThan(0);
    }
    expect(repos._deliveries.length).toBe(0);
    expect(wa.sent.length).toBe(0);
    // Con el socket de vuelta, sale.
    (wa as unknown as { conectado: () => boolean }).conectado = () => true;
    expect((await sender.send({ phone: '51912426667', kind: 'freeform', category: 'UTILITY', text: 'hola', manual: true })).ok).toBe(true);
  });
});

describe('modo prueba: SOLO_NUMEROS', () => {
  it('sin lista, se escribe a todos', async () => {
    const { config } = await build();
    expect(config.soloNumeros).toEqual([]);
    expect(numeroPermitido(config, '5215500000001')).toBe(true);
  });

  it('con lista, el sender bloquea a quien no este, tambien a mano, y lo anota', async () => {
    const { repos, sender, config } = await build({ SOLO_NUMEROS: '51 902 464 984, 51912426667' });
    expect(config.soloNumeros).toEqual(['51902464984', '51912426667']);
    await repos.templates.upsert(approvedTemplate());
    await repos.contacts.upsertFromInbound('51912426667');
    await repos.contacts.setOptIn('51912426667', 'x');

    const ok = await sender.send({ phone: '51912426667', kind: 'template', category: 'UTILITY', templateName: 'confirmacion_pedido', templateLanguage: 'es', variables: ['a', 'b', 'c'] });
    expect(ok.ok).toBe(true);

    const otro = await sender.send({ phone: '51999999999', kind: 'freeform', category: 'UTILITY', text: 'hola', manual: true });
    expect(otro.ok).toBe(false);
    if (!otro.ok && otro.blocked) {
      expect(otro.code).toBe('allowlist');
      expect(otro.retryAfterMs).toBeUndefined();
    }
    expect(repos._deliveries.at(-1)).toMatchObject({ status: 'blocked_by_gate' });
  });

  it('el asistente no contesta a quien no este en la lista, ni confirma la baja', async () => {
    const { deps, wa } = await build({ SOLO_NUMEROS: '51912426667' });
    await processChange('messages', entrante({ from: '5215599999999' }), deps);
    expect(wa.sent.length).toBe(0);
    await processChange('messages', entrante({ id: 'wamid.in.2', from: '5215599999999', text: { body: 'BAJA' } }), deps);
    expect(wa.sent.length).toBe(0);
    // A uno de la lista, si.
    await processChange('messages', entrante({ id: 'wamid.in.3', from: '51912426667' }), deps);
    expect(wa.sent.length).toBeGreaterThan(0);
  });
});
