/** Uso: npm run templates:sync */
import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { createRepos } from '../db/repos.js';
import { createWhatsAppClient } from '../whatsapp/client.js';
import { syncTemplates } from './registry.js';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);

try {
  const repos = createRepos(pool);
  const wa = createWhatsAppClient({
    token: config.WHATSAPP_TOKEN,
    phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: config.WHATSAPP_BUSINESS_ACCOUNT_ID,
    graphVersion: config.GRAPH_API_VERSION,
  });

  const templates = await syncTemplates(wa, repos);
  for (const t of templates) {
    console.log(
      `${t.status.padEnd(9)} ${(t.quality ?? 'UNKNOWN').padEnd(7)} ${t.category.padEnd(14)} ${t.name} (${t.language}) - ${t.variables} vars`,
    );
  }
  console.log(`\n${templates.length} plantillas sincronizadas.`);
} finally {
  await pool.end();
}
