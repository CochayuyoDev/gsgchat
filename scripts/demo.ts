/**
 * Servidor de demostracion: el codigo real de `buildServer` pero con la capa
 * de datos en memoria y un cliente de WhatsApp falso.
 *
 * Existe para poder ver y tocar las paginas de rastreo sin Postgres, sin Redis
 * y sin credenciales de Meta. NO es un modo de produccion: no persiste nada y
 * no manda mensajes de verdad.
 *
 *   npm run demo
 */

import { loadConfig } from '../src/config.js';
import { buildServer } from '../src/server.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { buildTrackingUrls } from '../src/tracking/tokens.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp, approvedTemplate } from '../tests/fakes.js';
import { CATALOG } from '../src/templates/catalog.js';
import { countVariables } from '../src/templates/render.js';

const PORT = Number(process.env.PORT ?? 3000);
const BASE = `http://localhost:${PORT}`;

const config = loadConfig({
  PORT: String(PORT),
  PUBLIC_BASE_URL: BASE,
  DATABASE_URL: 'postgres://demo/demo',
  WHATSAPP_TOKEN: 'demo',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 'demo-app-secret',
  WHATSAPP_VERIFY_TOKEN: 'demo-verify',
  // Sin clave, la pagina cae a OpenStreetMap y se ve igual de bien.
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY ?? '',
  ADMIN_TOKEN: 'demo-admin-token-1234',
  TRACKING_SECRET: 'demo'.repeat(12),
  GEO_BBOX: 'mexico',
} as NodeJS.ProcessEnv);

const repos = createFakeRepos();
const wa = createFakeWhatsApp();
const settings = await createFakeSettings(config);

const sender = createSender({
  repos,
  wa,
  phoneNumberId: () => settings.current().phoneNumberId,
  warmup: {
    startPerDay: config.WARMUP_START_PER_DAY,
    growth: config.WARMUP_GROWTH,
    hardCap: config.DAILY_SEND_CAP,
  },
  maxMarketingPerContact7d: config.MAX_MARKETING_PER_CONTACT_7D,
});

/** Cola de pega: envia en el acto en vez de pasar por Redis. */
const queue: OutboundQueue = {
  async enqueue(job) {
    await sender.send(job);
  },
  async enqueueMany(jobs) {
    for (const job of jobs) await sender.send(job);
    return jobs.length;
  },
  async pause() {},
  async resume() {},
  async counts() {
    return { waiting: 0, active: 0, delayed: 0, completed: wa.sent.length, failed: 0, paused: 0 };
  },
  async close() {},
};

// Datos de ejemplo para que las pantallas tengan algo que enseñar.
for (const template of CATALOG) {
  await repos.templates.upsert(
    approvedTemplate({
      name: template.name,
      language: template.language,
      category: template.category,
      body: template.body,
      variables: countVariables(template.body),
    }),
  );
}
await repos.contacts.upsertFromInbound('5215512345678', 'Ana Demo');
await repos.contacts.setOptIn('5215512345678', 'demo');

const contact = await repos.contacts.getByPhone('5215512345678');
const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
const link = await repos.tracking.createLink(contact!.id, 'Pedido A-1024', expiresAt);
const urls = buildTrackingUrls(link.id, expiresAt, config.TRACKING_SECRET, BASE);

const app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false });
await app.listen({ port: PORT, host: '127.0.0.1' });

console.log(`
  wa-locator - servidor de demostracion (datos en memoria)

  Configuracion ${BASE}/setup
  Panel        ${BASE}/panel
  Salud        ${BASE}/health
  Ver en vivo  ${urls.viewUrl}
  Compartir    ${urls.publishUrl}
  Caducado     ${BASE}/t/token-invalido

  Admin (Bearer ${config.ADMIN_TOKEN}):
    curl -H "authorization: Bearer ${config.ADMIN_TOKEN}" ${BASE}/admin/health
    curl -H "authorization: Bearer ${config.ADMIN_TOKEN}" ${BASE}/admin/templates
`);
