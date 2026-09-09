/**
 * Arranque corto: WhatsApp de verdad, sin montar nada.
 *
 * El servidor real, el cliente real y Postgres real, pero sin instalar nada:
 * la base corre embebida (PGlite, Postgres compilado a WebAssembly) sobre una
 * carpeta local, y la cola va en memoria en vez de en Redis.
 *
 *   npm run quick        y luego /setup, escanear el QR, listo
 *
 * Todo persiste entre reinicios: la vinculacion de WhatsApp en `.wa-auth`, y
 * los contactos, mensajes y ubicaciones en `.wa-data`. Es para probar en una
 * maquina, no para produccion: un solo proceso y sin concurrencia.
 */

import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { buildServer } from '../src/server.js';
import { createSender } from '../src/outbound/sender.js';
import { createMemoryOutboundQueue } from '../src/outbound/memory-queue.js';
import { createRepos, createSettingsRepo } from '../src/db/repos.js';
import { openPglite } from '../src/db/pglite.js';
import { bootstrapSecrets } from '../src/settings/crypto.js';
import { createSettingsService } from '../src/settings/service.js';
import { createDynamicWhatsAppClient } from '../src/whatsapp/dynamic.js';
import { defaultAuthDir } from '../src/whatsapp/local/session.js';
import { secretsDirectory } from '../src/runtime.js';
import { CATALOG } from '../src/templates/catalog.js';
import { countVariables } from '../src/templates/render.js';

const PORT = Number(process.env.PORT ?? 3000);
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = process.env.QUICK_DATA_DIR ?? path.join(process.cwd(), '.wa-data');

// El mismo .secrets.json que el arranque de verdad: asi el token de admin y la
// clave que cifra las credenciales no cambian cada vez.
const secrets = bootstrapSecrets(secretsDirectory());

const config = loadConfig({
  PORT: String(PORT),
  PUBLIC_BASE_URL: BASE,
  DATABASE_URL: `pglite://${DATA_DIR}`,
  // Ni Meta ni contenedor: el cliente corre dentro de este proceso.
  WHATSAPP_PROVIDER: 'local',
  ADMIN_TOKEN: secrets.adminToken,
  // Escucha solo en 127.0.0.1, asi que pedir el token en cada pestaña es un
  // tramite sin nada que proteger: la pagina viene con el puesto.
  ADMIN_TOKEN_AUTOFILL: 'true',
  TRACKING_SECRET: secrets.trackingSecret,
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY ?? '',
  // La zona que se atiende. Vacio o sin definir significa "no acotar": una
  // caja equivocada rechaza ubicaciones perfectamente validas, que es peor que
  // no comprobar nada. Valores: lima (Lima y Callao), mexico, none.
  GEO_BBOX: process.env.GEO_BBOX?.trim() || 'none',
} as NodeJS.ProcessEnv);

const { pool } = await openPglite(DATA_DIR);
const repos = createRepos(pool);
const settings = await createSettingsService(createSettingsRepo(pool), config, secrets.settingsKey);

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
// aprobada antes de dejar salir nada. Se refresca en cada arranque por si el
// catalogo cambio; el estado de las que ya estaban no se toca.
for (const template of CATALOG) {
  if (await repos.templates.get(template.name, template.language)) continue;
  await repos.templates.upsert({
    name: template.name,
    language: template.language,
    category: template.category,
    body: template.body,
    variables: countVariables(template.body),
    status: 'APPROVED',
    quality: null,
  });
}

const app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false });
await app.listen({ port: PORT, host: '127.0.0.1' });

console.log(`
  wa-locator - arranque corto (Postgres embebido, WhatsApp de verdad)

  1. Abre       ${BASE}/setup
  2. Pega el token cuando lo pida:  ${secrets.adminToken}
  3. Elige "Escanear el QR y ya" y dale a conectar
  4. Escanea con el telefono (o pide el codigo con tu numero)

  Chat          ${BASE}/chat
  Panel         ${BASE}/panel

  Vinculacion   ${defaultAuthDir()}
  Datos         ${DATA_DIR}

  Las dos carpetas sobreviven al reinicio: no hay que volver a escanear ni a
  escribir los numeros.
`);
