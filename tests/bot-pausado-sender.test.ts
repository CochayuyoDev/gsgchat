import { describe, expect, it } from 'vitest';
import { createSender } from '../src/outbound/sender.js';
import { createFakeRepos, createFakeWhatsApp } from './fakes.js';

const phone = '5215500000001';

async function escenario() {
  const repos = createFakeRepos();
  const wa = createFakeWhatsApp();
  const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
  const contacto = await repos.contacts.upsertFromInbound(phone);
  await repos.contacts.setOptIn(phone, 'formulario');
  await repos.contacts.touchInbound(phone, new Date());
  await repos.contacts.pausarBot(contacto.id, true, new Date());
  return { repos, wa, sender, contacto };
}

describe('bot callado en un chat', () => {
  it('bloquea lo automatico, deja pasar lo manual y no reintenta', async () => {
    const { repos, wa, sender } = await escenario();

    const auto = await sender.send({ phone, kind: 'freeform', category: 'UTILITY', text: 'seguimiento automatico', origen: 'sistema' });
    expect(auto).toMatchObject({ ok: false, blocked: true, code: 'bot_pausado' });
    expect((auto as { retryAfterMs?: number }).retryAfterMs).toBeUndefined();
    expect(wa.sent).toHaveLength(0);

    const operador = await sender.send({ phone, kind: 'freeform', category: 'UTILITY', text: 'hola, soy una persona', origen: 'persona' });
    expect(operador.ok).toBe(true);
    expect(wa.sent).toHaveLength(1);
    expect(repos._deliveries.length).toBeGreaterThan(0);
  });

  it('al reactivarlo vuelve a salir lo automatico, sin lo que quedo pendiente', async () => {
    const { repos, wa, sender, contacto } = await escenario();
    await sender.send({ phone, kind: 'freeform', category: 'UTILITY', text: 'pendiente durante la pausa', origen: 'sistema' });
    await repos.contacts.pausarBot(contacto.id, false, new Date());
    expect(wa.sent).toHaveLength(0);
    const despues = await sender.send({ phone, kind: 'freeform', category: 'UTILITY', text: 'nuevo', origen: 'sistema' });
    expect(despues.ok).toBe(true);
    expect(wa.sent).toHaveLength(1);
  });
});
