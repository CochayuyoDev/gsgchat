/**
 * Punto de entrada: servidor HTTP + worker de la cola en el mismo proceso.
 *
 * Arranca aunque no haya credenciales de WhatsApp: en ese caso levanta igual
 * y las pide por pantalla en /setup. Los secretos propios (token de admin,
 * firma de los enlaces de rastreo) se generan solos la primera vez y quedan
 * en .secrets.json, para no obligar a editar un .env a mano.
 */

import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { createRepos, createSettingsRepo } from './db/repos.js';
import { createSettingsService } from './settings/service.js';
import { bootstrapSecrets } from './settings/crypto.js';
import { createDynamicWhatsAppClient } from './whatsapp/dynamic.js';
import { createSender } from './outbound/sender.js';
import { createOutboundQueue, createOutboundWorker } from './outbound/queue.js';
import { buildServer } from './server.js';

const secrets = bootstrapSecrets(process.cwd());
process.env.ADMIN_TOKEN ??= secrets.adminToken;
process.env.TRACKING_SECRET ??= secrets.trackingSecret;

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const repos = createRepos(pool);

const settings = await createSettingsService(
  createSettingsRepo(pool),
  config,
  secrets.settingsKey,
);

const wa = createDynamicWhatsAppClient(settings);

const sender = createSender({
  repos,
  wa,
  // Funcion, no valor: el numero puede cambiar desde /setup sin reiniciar.
  phoneNumberId: () => settings.current().phoneNumberId,
  warmup: {
    startPerDay: config.WARMUP_START_PER_DAY,
    growth: config.WARMUP_GROWTH,
    hardCap: config.DAILY_SEND_CAP,
  },
  maxMarketingPerContact7d: config.MAX_MARKETING_PER_CONTACT_7D,
});

const queue = createOutboundQueue(config.REDIS_URL);
const app = await buildServer({ config, repos, settings, wa, sender, queue });

const worker = createOutboundWorker({
  redisUrl: config.REDIS_URL,
  sender,
  queue,
  onResult: (job, outcome) => {
    if (outcome.ok) return;
    // Los bloqueos por gate no son errores del sistema: son la senal de que
    // la lista o el estado del numero no permiten ese envio.
    const detail = outcome.blocked ? `${outcome.code}: ${outcome.reason}` : outcome.error;
    app.log.warn({ phone: job.phone, detail }, 'envio no realizado');
  },
});

await app.listen({ port: config.PORT, host: '0.0.0.0' });

const missing = settings.missing();
console.log(`
  wa-locator en http://localhost:${config.PORT}

  ${missing.length ? `Configuracion pendiente  http://localhost:${config.PORT}/setup  (faltan: ${missing.join(', ')})` : `Panel  http://localhost:${config.PORT}/panel`}

  Token de administracion: ${config.ADMIN_TOKEN}
  (guardado en .secrets.json; pegalo cuando la web te lo pida)
`);

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'cerrando');
  await worker.close();
  await queue.close();
  await app.close();
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
