/**
 * Arranque comun del proceso: secretos locales, configuracion, base de datos,
 * ajustes en caliente y cliente de WhatsApp.
 *
 * Lo comparten el servidor y los CLIs de plantillas. Antes cada CLI leia las
 * credenciales solo del .env, asi que quien las pegaba en /setup (la via
 * recomendada) se encontraba con que `templates:push` no tenia token.
 */

import { mkdirSync } from 'node:fs';
import { loadConfig, type Config } from './config.js';
import { createPool, type Pool } from './db/pool.js';
import { openPglite, type PgliteHandle } from './db/pglite.js';
import { createRepos, createSettingsRepo, type Repos } from './db/repos.js';
import type { SettingsRepo } from './settings/service.js';
import { migrate } from './db/migrate.js';
import { bootstrapSecrets, type LocalSecrets } from './settings/crypto.js';
import { createSettingsService, type SettingsService } from './settings/service.js';
import type { WhatsAppClient } from './whatsapp/client.js';
import { createDynamicWhatsAppClient } from './whatsapp/dynamic.js';

export interface Runtime {
  config: Config;
  secrets: LocalSecrets;
  pool: Pool;
  repos: Repos;
  settings: SettingsService;
  /** La tabla settings tal cual: la usa tambien el asistente de IA para su configuracion. */
  settingsRepo: SettingsRepo;
  wa: WhatsAppClient;
  /** Migraciones aplicadas en este arranque (vacio si no habia pendientes). */
  migrated: string[];
  /** La base embebida, si DATABASE_URL era pglite:// (para la copia diaria). */
  pglite: PgliteHandle | null;
  close(): Promise<void>;
}

/**
 * Donde vive .secrets.json. Por defecto el directorio de trabajo; en Docker
 * se apunta a un volumen (SECRETS_DIR) para que sobreviva al contenedor.
 */
export function secretsDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.SECRETS_DIR?.trim() || process.cwd();
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function createRuntime(opts: { migrate?: boolean } = {}): Promise<Runtime> {
  const secrets = bootstrapSecrets(secretsDirectory());
  process.env.TRACKING_SECRET ??= secrets.trackingSecret;

  const config = loadConfig();
  // Sin Postgres: DATABASE_URL=pglite://./.wa-data abre la base embebida (aplica
  // las migraciones al abrir), igual que `npm run quick`. Para un VPS chico.
  const pglite = config.DATABASE_URL.startsWith('pglite://') ? await openPglite(config.DATABASE_URL.slice('pglite://'.length) || '.wa-data') : null;
  const migrated = pglite ? pglite.applied : opts.migrate ? await migrate(config.DATABASE_URL) : [];

  const pool = pglite ? pglite.pool : createPool(config.DATABASE_URL);
  const repos = createRepos(pool);
  const settingsRepo = createSettingsRepo(pool);
  const settings = await createSettingsService(settingsRepo, config, secrets.settingsKey);
  const wa = createDynamicWhatsAppClient(settings, {
    // WAHA no tiene plantillas: necesita el cuerpo guardado para mandarlo
    // como texto. Con la Cloud API esto no se llama nunca.
    resolveTemplateBody: async (name, language) =>
      (await repos.templates.get(name, language))?.body ?? undefined,
    nativeButtons: config.WHATSAPP_NATIVE_BUTTONS,
  });

  return {
    config,
    secrets,
    pool,
    repos,
    settings,
    settingsRepo,
    wa,
    migrated,
    pglite,
    close: () => (pglite ? pglite.db.close() : pool.end()),
  };
}
