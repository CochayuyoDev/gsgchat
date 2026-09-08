/**
 * Servidor de demostracion: el codigo real de `buildServer` pero con la capa
 * de datos en memoria y un cliente de WhatsApp falso.
 *
 * Existe para poder ver y tocar el panel y las paginas de rastreo sin
 * Postgres, sin Redis y sin credenciales de Meta. NO es un modo de
 * produccion: no persiste nada y no manda mensajes de verdad.
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
import { extractLocationSync } from '../src/geo/extract.js';
import { enrollContact, startScheduler } from '../src/automation/engine.js';

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

// --- datos de ejemplo para que las pantallas tengan algo que ensenar -----
for (const template of CATALOG) {
  await repos.templates.upsert(
    approvedTemplate({
      name: template.name,
      language: template.language,
      category: template.category,
      body: template.body,
      variables: countVariables(template.body),
      // Una queda pendiente para que se vea el estado en el panel.
      status: template.name === 'recuperacion_carrito' ? 'PENDING' : 'APPROVED',
    }),
  );
}
wa.remoteTemplates = CATALOG.map((t) => ({
  name: t.name,
  language: t.language,
  category: t.category,
  status: 'APPROVED',
  quality_score: { score: 'GREEN' },
  components: [{ type: 'BODY', text: t.body }],
}));

await repos.contacts.upsertFromInbound('5215512345678', 'Ana Demo');
await repos.contacts.setOptIn('5215512345678', 'demo');
await repos.contacts.touchInbound('5215512345678', new Date());
await repos.contacts.upsertFromInbound('5215587654321', 'Luis Reparto');
await repos.contacts.setOptIn('5215587654321', 'formulario web');
await repos.contacts.upsertFromInbound('5215511112222', 'Sin consentimiento');
await repos.contacts.upsertFromInbound('5215533334444', 'Carla Baja');
await repos.contacts.setOptIn('5215533334444', 'demo');
await repos.contacts.setOptOut('5215533334444');

const contact = (await repos.contacts.getByPhone('5215512345678'))!;
for (const input of [
  'https://www.google.com/maps/place/Bellas+Artes/data=!8m2!3d19.4352!4d-99.1412',
  'https://www.google.com/maps/@19.4326,-99.1332,15z',
  '19.4284, -99.1676',
]) {
  const result = extractLocationSync(input, { bbox: config.bbox });
  if (result.ok) {
    const id = await repos.locations.save(contact.id, result, input);
    if (!result.needsConfirmation) await repos.locations.confirm(id);
  }
}

// Una campana ya lanzada: una entrega sale, otra se bloquea por falta de opt-in.
const campaignId = await repos.campaigns.create({
  name: 'Recordatorio de ejemplo',
  templateName: 'recordatorio_cita',
  templateLanguage: 'es_MX',
  category: 'UTILITY',
});
await repos.campaigns.setStatus(campaignId, 'running');
for (const phone of ['5215512345678', '5215511112222']) {
  await sender.send({
    phone,
    kind: 'template',
    category: 'UTILITY',
    campaignId,
    templateName: 'recordatorio_cita',
    templateLanguage: 'es_MX',
    variables: ['Ana', 'lunes 3', '10:00'],
  });
}

const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
const link = await repos.tracking.createLink(contact.id, 'Pedido A-1024', expiresAt);
await repos.tracking.addPoint(link.id, { lat: 19.4326, lng: -99.1332, accuracy: 12 });
const urls = buildTrackingUrls(link.id, expiresAt, config.TRACKING_SECRET, BASE);

// Automatizacion de ejemplo: una bienvenida, una regla por palabra y una
// secuencia de seguimiento con un contacto inscrito.
const followUp = await repos.automation.createSequence({
  name: 'Seguimiento de cotizacion',
  description: 'Recordatorio al dia siguiente y cierre a los tres dias si no responde.',
  stopOnReply: true,
  steps: [
    {
      delayMinutes: 24 * 60,
      kind: 'template',
      templateName: 'seguimiento_entrega',
      templateLanguage: 'es_MX',
      category: 'UTILITY',
      variables: ['{nombre}', '{fecha}'],
    },
    { delayMinutes: 48 * 60, kind: 'text', text: 'Hola {nombre}, seguimos a tus ordenes. Responde y te atendemos.' },
  ],
});
await repos.automation.createRule({
  name: 'Bienvenida',
  trigger: 'first_message',
  reply: 'Hola {nombre}, gracias por escribir. Comparte tu ubicacion o dinos en que te ayudamos.',
});
await repos.automation.createRule({
  name: 'Cotizacion',
  trigger: 'keyword',
  keyword: 'cotizar',
  match: 'contains',
  reply: 'Con gusto, {nombre}. Un asesor te contacta en breve.',
  sequenceId: followUp.id,
});
const luis = (await repos.contacts.getByPhone('5215587654321'))!;
await enrollContact({ repos, sender }, followUp, luis, 'demo');

const app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false });
startScheduler({ repos, sender }, 3_000);
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
