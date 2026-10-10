/**
 * En modo "Solo lo de GSG" la preventa del courier (cotizar envío, distritos,
 * asesor) está escondida y nadie podría apagarla: no puede contestarle a un
 * cliente. Un "mi pedido llegó tardísimo" tiene que ir a la IA o a una
 * persona, nunca al menú de cotizaciones. Con "Todo el sistema", como siempre.
 */

import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import { processChange } from '../src/whatsapp/webhook.js';
import { crearServicioAjustes } from '../src/ajustes/generales.js';
import type { ChangeValue } from '../src/whatsapp/types.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp } from './fakes.js';

const config = loadConfig({
  PUBLIC_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'mysql://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'lima',
} as NodeJS.ProcessEnv);

const entrante = (texto: string, phone = '51987000123'): ChangeValue => ({
  contacts: [{ wa_id: phone, profile: { name: 'Clienta' } }],
  messages: [{ id: `wamid.in.${Math.random()}`, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: texto } }],
});

async function armar(modo: 'gsg' | 'completo' | null) {
  const repos = createFakeRepos();
  const wa = createFakeWhatsApp();
  const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
  const settings = await createFakeSettings(config);
  await repos.automation.setPrefs({ askLocationFallback: false, preventaActiva: true });
  const ajustes = modo === null ? undefined : await crearServicioAjustes({ repo: repos.ajustesGenerales, config, releerCadaMs: 0 });
  if (ajustes) await ajustes.guardar({ modo });
  const salidas = () => wa.sent.filter((m) => m.kind === 'text' || m.kind === 'buttons').map((m) => String(m.body ?? ''));
  return { repos, wa, salidas, deps: { repos, wa, sender, config, settings, ajustes } };
}

describe('la preventa del courier y el modo "Solo lo de GSG"', () => {
  it('con "Todo el sistema" la preventa contesta como siempre (el saludo del courier)', async () => {
    const { salidas, deps } = await armar('completo');
    await processChange('messages', entrante('mi pedido llegó tardísimo'), deps);
    await processChange('messages', entrante('mi pedido llegó tardísimo!!'), deps);
    const textos = salidas();
    expect(textos.length).toBeGreaterThan(0);
    expect(textos.join(' | ')).toMatch(/Soy el asistente de nuestra tienda/);
  });

  it('con "Solo lo de GSG" la preventa se calla: ni saludo del courier, ni menú de cotizar, ni "¿de qué distrito recogemos?"', async () => {
    const { salidas, deps } = await armar('gsg');
    await processChange('messages', entrante('mi pedido llegó tardísimo'), deps);
    await processChange('messages', entrante('mi pedido llegó tardísimo!!'), deps);
    expect(salidas()).toEqual([]);
    // El mensaje sí queda guardado: callarse no es dejar de escuchar.
    const contacto = await deps.repos.contacts.getByPhone('51987000123');
    expect(contacto).not.toBeNull();
  });

  it('sin ajustes (los arranques viejos y las pruebas) sigue como estaba', async () => {
    const { salidas, deps } = await armar(null);
    await processChange('messages', entrante('mi pedido llegó tardísimo'), deps);
    expect(salidas().join(' | ')).toMatch(/Soy el asistente de nuestra tienda/);
  });
});
