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
import { baseDeLaUrl, createPool, type Pool } from './db/pool.js';
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
  const migrated = opts.migrate ? await migrate(config.DATABASE_URL) : [];

  const pool = createPool(config.DATABASE_URL);
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
    close: () => pool.end(),
  };
}

/** Donde esta el servidor de la URL, para los mensajes: "127.0.0.1:3306". */
function servidorDe(url: string): string {
  try {
    const u = new URL(url.replace(/^mariadb:/i, 'mysql:'));
    return `${u.hostname || 'localhost'}:${u.port || '3306'}`;
  } catch {
    return 'el servidor de DATABASE_URL';
  }
}

/**
 * Un fallo de la base dicho en palabras llanas: que paso y que hacer. Lo usan
 * el arranque (main.ts, scripts/quick.ts) y la plataforma al crear o borrar
 * la base de una tienda. Si no es un fallo conocido, el mensaje tal cual.
 */
export function explicarErrorDeBase(error: unknown, url: string): string {
  const e = error as { code?: string; errno?: number; message?: string; sqlMessage?: string };
  const code = e?.code ?? '';
  const detalle = e?.sqlMessage || e?.message || String(error);
  const donde = servidorDe(url);
  let usuario = 'root';
  try {
    usuario = decodeURIComponent(new URL(url.replace(/^mariadb:/i, 'mysql:')).username) || 'root';
  } catch {
    // La URL mala ya la explica loadConfig.
  }
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'EHOSTUNREACH') {
    return (
      `No hay ningún MySQL/MariaDB escuchando en ${donde}. ` +
      'En esta PC: abre el panel de XAMPP y pulsa «Start» en MySQL. En un servidor: arranca MySQL o MariaDB, ' +
      'o pon en DATABASE_URL la dirección del tuyo (mysql://usuario:clave@host:3306/gsgchat).'
    );
  }
  if (code === 'ER_ACCESS_DENIED_ERROR' || e?.errno === 1045) {
    return `El servidor de ${donde} no acepta el usuario o la contraseña de DATABASE_URL (usuario «${usuario}»). Revisa los dos en la URL: mysql://usuario:clave@host:3306/gsgchat.`;
  }
  if (code === 'ER_DBACCESS_DENIED_ERROR' || code === 'ER_TABLEACCESS_DENIED_ERROR' || code === 'ER_SPECIFIC_ACCESS_DENIED_ERROR' || e?.errno === 1044 || e?.errno === 1142) {
    let raiz = 'gsgchat';
    try {
      raiz = baseDeLaUrl(url) ?? raiz;
    } catch {
      // idem
    }
    return (
      `El usuario «${usuario}» no tiene permiso para crear o borrar bases en ${donde}. ` +
      `Cada tienda vive en su propia base del servidor (${raiz}_t_…), así que hace falta ese permiso: ` +
      `dáselo con GRANT ALL ON \`${raiz}%\`.* TO '${usuario}'@'%'; (o usa un usuario que lo tenga). Detalle: ${detalle}`
    );
  }
  if (code === 'ER_BAD_DB_ERROR' || e?.errno === 1049) {
    return `La base de DATABASE_URL no existe en ${donde} y no se pudo crear. Créala (CREATE DATABASE …) o da permiso para crearla. Detalle: ${detalle}`;
  }
  return detalle;
}

/**
 * Comprueba que el servidor de la URL contesta antes de arrancar nada, para
 * decir que hacer en vez de fallar a mitad. Devuelve null si contesta; si no,
 * la explicacion.
 */
export async function comprobarServidorDeBase(url: string): Promise<string | null> {
  if (!baseDeLaUrl(url)) return 'DATABASE_URL no dice qué base usar: termínala con /nombre_de_la_base (por ejemplo mysql://root@127.0.0.1:3306/gsgchat).';
  const admin = createPool(url, null);
  try {
    await admin.query('select 1');
    return null;
  } catch (error) {
    return explicarErrorDeBase(error, url);
  } finally {
    await admin.end().catch(() => undefined);
  }
}
