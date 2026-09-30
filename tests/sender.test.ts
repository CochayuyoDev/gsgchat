import { describe, expect, it } from 'vitest';
import { createSender } from '../src/outbound/sender.js';
import { WhatsAppApiError } from '../src/whatsapp/client.js';
import { approvedTemplate, createFakeRepos, createFakeWhatsApp } from './fakes.js';

const WARMUP = { startPerDay: 50, growth: 1.5, hardCap: 1000 };

function build(overrides: Parameters<typeof createFakeRepos>[0] = {}) {
  const repos = createFakeRepos(overrides);
  const wa = createFakeWhatsApp();
  const sender = createSender({
    repos,
    wa,
    phoneNumberId: 'PNID',
    warmup: WARMUP,
    maxMarketingPerContact7d: 2,
  });
  return { repos, wa, sender };
}

describe('sender', () => {
  it('envia una plantilla a un contacto con opt-in y registra la entrega', async () => {
    const { repos, wa, sender } = build();
    await repos.templates.upsert(approvedTemplate());
    await repos.contacts.upsertFromInbound('5215500000001');
    await repos.contacts.setOptIn('5215500000001', 'formulario');

    const outcome = await sender.send({
      phone: '5215500000001',
      kind: 'template',
      category: 'UTILITY',
      templateName: 'confirmacion_pedido',
      templateLanguage: 'es',
      variables: ['Ana', 'A-1024', 'https://ej.mx/t/9'],
    });

    expect(outcome.ok).toBe(true);
    expect(wa.sent.at(-1)).toMatchObject({ kind: 'template', name: 'confirmacion_pedido' });
    expect(repos._deliveries.at(-1)).toMatchObject({ status: 'sent' });
  });

  it('no envia a un contacto sin opt-in y deja rastro del bloqueo', async () => {
    const { repos, wa, sender } = build();
    await repos.templates.upsert(approvedTemplate());

    const outcome = await sender.send({
      phone: '5215500000002',
      kind: 'template',
      category: 'UTILITY',
      templateName: 'confirmacion_pedido',
      variables: ['Ana', 'A-1', 'x'],
    });

    expect(outcome).toMatchObject({ ok: false, blocked: true, code: 'no_opt_in' });
    expect(wa.sent).toHaveLength(0);
    // El intento queda registrado: los bloqueos son la senal de lista sucia.
    expect(repos._deliveries.at(-1)).toMatchObject({ status: 'blocked_by_gate' });
  });

  it('un contacto dado de baja no recibe nada', async () => {
    const { repos, wa, sender } = build();
    await repos.templates.upsert(approvedTemplate());
    await repos.contacts.setOptIn('5215500000003', 'formulario');
    await repos.contacts.setOptOut('5215500000003');

    const outcome = await sender.send({
      phone: '5215500000003',
      kind: 'template',
      category: 'UTILITY',
      templateName: 'confirmacion_pedido',
      variables: ['Ana', 'A-1', 'x'],
    });

    expect(outcome).toMatchObject({ ok: false, blocked: true, code: 'opt_out' });
    expect(wa.sent).toHaveLength(0);
  });

  it('el numero pausado bloquea con reintento', async () => {
    const { repos, sender } = build({ paused: true, pausedReason: 'calidad en ROJO' });
    await repos.templates.upsert(approvedTemplate());
    await repos.contacts.setOptIn('5215500000004', 'formulario');

    const outcome = await sender.send({
      phone: '5215500000004',
      kind: 'template',
      category: 'UTILITY',
      templateName: 'confirmacion_pedido',
      variables: ['Ana', 'A-1', 'x'],
    });

    expect(outcome).toMatchObject({ ok: false, blocked: true, code: 'number_paused' });
    expect(outcome.ok === false && outcome.blocked && outcome.retryAfterMs).toBeGreaterThan(0);
  });

  it('responder dentro de la ventana no consume cupo diario', async () => {
    const { repos, sender } = build();
    await repos.contacts.upsertFromInbound('5215500000005');
    await repos.contacts.touchInbound('5215500000005', new Date());

    const outcome = await sender.send({
      phone: '5215500000005',
      kind: 'freeform',
      category: 'UTILITY',
      text: 'Ubicacion registrada.',
    });

    expect(outcome.ok).toBe(true);
    expect(await repos.counters.totalForDay('PNID', new Date())).toBe(0);
  });

  it('un envio iniciado por la empresa si consume cupo', async () => {
    const { repos, sender } = build();
    await repos.templates.upsert(approvedTemplate());
    await repos.contacts.setOptIn('5215500000006', 'formulario');

    await sender.send({
      phone: '5215500000006',
      kind: 'template',
      category: 'UTILITY',
      templateName: 'confirmacion_pedido',
      variables: ['Ana', 'A-1', 'x'],
    });

    expect(await repos.counters.totalForDay('PNID', new Date())).toBe(1);
  });

  it('marca como reintentable un rate limit de Meta', async () => {
    const { repos, wa, sender } = build();
    await repos.contacts.upsertFromInbound('5215500000007');
    await repos.contacts.touchInbound('5215500000007', new Date());
    wa.failNext = new WhatsAppApiError('throughput limit', 429, 130429, undefined, true);

    const outcome = await sender.send({
      phone: '5215500000007',
      kind: 'freeform',
      category: 'UTILITY',
      text: 'hola',
    });

    expect(outcome).toMatchObject({ ok: false, blocked: false, retryable: true });
  });

  it('un error de plantilla no es reintentable', async () => {
    const { repos, sender } = build();
    await repos.templates.upsert(approvedTemplate());
    await repos.contacts.setOptIn('5215500000008', 'formulario');

    const outcome = await sender.send({
      phone: '5215500000008',
      kind: 'template',
      category: 'UTILITY',
      templateName: 'confirmacion_pedido',
      variables: ['solo una'],
    });

    expect(outcome).toMatchObject({ ok: false, blocked: false, retryable: false });
  });
});
