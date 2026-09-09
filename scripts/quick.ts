/**
 * Arranque corto: WhatsApp de verdad, sin montar nada.
 *
 * El servidor real y el cliente real, pero con la capa de datos en memoria y
 * la cola sin Redis. Existe para el caso "quiero conectarme y probar ya", sin
 * Postgres, sin Docker y sin cuenta de Meta:
 *
 *   npm run quick        y luego /setup, escanear el QR, listo
 *
 * Lo que se pierde es la persistencia: al parar el proceso se van los
 * contactos, las ubicaciones y el historial. La vinculacion de WhatsApp NO se
 * pierde, porque vive en la carpeta .wa-auth y se reutiliza al volver.
 */

import { loadConfig } from '../src/config.js';
import { buildServer } from '../src/server.js';
import { createSender } from '../src/outbound/sender.js';
import { createMemoryOutboundQueue } from '../src/outbound/memory-queue.js';
import { createDynamicWhatsAppClient } from '../src/whatsapp/dynamic.js';
import { defaultAuthDir } from '../src/whatsapp/local/session.js';
import { CATALOG } from '../src/templates/catalog.js';
import { countVariables } from '../src/templates/render.js';
import { createFakeRepos, createFakeSettings, approvedTemplate } from '../tests/fakes.js';

const PORT = Number(process.env.PORT ?? 3000);
const BASE = `http://localhost:${PORT}`;
const ADMIN = process.env.ADMIN_TOKEN ?? 'quick-admin-token-1234';

const config = loadConfig({
  PORT: String(PORT),
  PUBLIC_BASE_URL: BASE,
  DATABASE_URL: 'memoria://quick',
  // Ni Meta ni contenedor: el cliente corre dentro de este proceso.
  WHATSAPP_PROVIDER: 'local',
  ADMIN_TOKEN: ADMIN,
  TRACKING_SECRET: 'quick'.repeat(10),
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY ?? '',
  GEO_BBOX: process.env.GEO_BBOX ?? 'mexico',
} as NodeJS.ProcessEnv);

const repos = createFakeRepos();
const settings = await createFakeSettings(config);
const wa = createDynamicWhatsAppClient(settings, {
  resolveTemplateBody: async (name, language) =>
    (await repos.templates.get(name, language))?.body ?? undefined,
});

const sender = createSender({
  repos,
  wa,
  phoneNumberId: () => settings.current().phoneNumberId || 'local',
  warmup: {
    startPerDay: config.WARMUP_START_PER_DAY,
    growth: config.WARMUP_GROWTH,
    hardCap: config.DAILY_SEND_CAP,
  },
  maxMarketingPerContact7d: config.MAX_MARKETING_PER_CONTACT_7D,
});

const queue = createMemoryOutboundQueue({ sender });

// El catalogo local hace de catalogo aprobado: sin Meta no hay a quien pedir
// permiso, pero los gates siguen exigiendo que la plantilla exista y este
// aprobada antes de dejar salir nada.
for (const template of CATALOG) {
  await repos.templates.upsert(
    approvedTemplate({
      name: template.name,
      language: template.language,
      category: template.category,
      body: template.body,
      variables: countVariables(template.body),
      status: 'APPROVED',
    }),
  );
}

const app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false });
await app.listen({ port: PORT, host: '127.0.0.1' });

console.log(`
  wa-locator - arranque corto (datos en memoria, WhatsApp de verdad)

  1. Abre       ${BASE}/setup
  2. Pega el token cuando lo pida:  ${ADMIN}
  3. Elige "Escanear el QR y ya" y dale a conectar
  4. Escanea con el telefono (o pide el codigo con tu numero)

  Chat          ${BASE}/chat
  Panel         ${BASE}/panel

  La vinculacion se guarda en ${defaultAuthDir()} y se reutiliza al reiniciar.
  Los datos NO: esto es para probar, no para produccion.
`);
