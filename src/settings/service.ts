/**
 * Credenciales en caliente.
 *
 * El sistema arranca sin credenciales y las pide por pantalla en /setup.
 * Este servicio las guarda cifradas, las cachea en memoria y deja que el
 * webhook y el cliente de la API lean siempre las vigentes: cambiar un token
 * no obliga a reiniciar el proceso ni a tocar un fichero.
 *
 * Precedencia: lo guardado desde la web gana sobre las variables de entorno.
 * El .env sigue funcionando para quien prefiera desplegar con secretos
 * inyectados.
 */

import type { Config } from '../config.js';
import { decrypt, encrypt, keyFromBase64 } from './crypto.js';

export interface WhatsAppCredentials {
  token: string;
  phoneNumberId: string;
  businessAccountId: string;
  /** Id de la app de Meta: con el y la clave secreta se registra el webhook. */
  appId: string;
  /** Configuracion de registro incorporado: habilita el boton de conexion rapida. */
  signupConfigId: string;
  appSecret: string;
  verifyToken: string;
  graphVersion: string;
  mapsApiKey: string;
}

export type CredentialField = Exclude<keyof WhatsAppCredentials, 'graphVersion'>;

/** Campos que nunca se devuelven al navegador en claro. */
export const SECRET_FIELDS: CredentialField[] = ['token', 'appSecret'];

export const FIELD_LABELS: Record<CredentialField, string> = {
  token: 'Token permanente',
  phoneNumberId: 'Phone number ID',
  businessAccountId: 'WhatsApp Business Account ID',
  appId: 'ID de la app',
  signupConfigId: 'ID de la configuracion de registro incorporado',
  appSecret: 'Clave secreta de la app',
  verifyToken: 'Token de verificacion del webhook',
  mapsApiKey: 'Clave de Google Maps (opcional)',
};

const KEY_PREFIX = 'whatsapp.';

export interface SettingsRepo {
  getAll(): Promise<Array<{ key: string; value: string; encrypted: boolean }>>;
  put(key: string, value: string, encrypted: boolean): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface SettingsService {
  /** Credenciales vigentes: base de datos por encima de entorno. */
  current(): WhatsAppCredentials;
  reload(): Promise<void>;
  save(values: Partial<Record<CredentialField, string>>): Promise<void>;
  /** Que falta para poder enviar. Vacio = listo. */
  missing(): CredentialField[];
  isConfigured(): boolean;
  /** Vista segura para el navegador: los secretos van enmascarados. */
  masked(): Record<CredentialField, string>;
}

const REQUIRED: CredentialField[] = [
  'token',
  'phoneNumberId',
  'businessAccountId',
  'appSecret',
  'verifyToken',
];

export async function createSettingsService(
  repo: SettingsRepo,
  config: Config,
  settingsKeyBase64: string,
): Promise<SettingsService> {
  const key = keyFromBase64(settingsKeyBase64);

  const fromEnv = (): WhatsAppCredentials => ({
    token: config.WHATSAPP_TOKEN,
    phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: config.WHATSAPP_BUSINESS_ACCOUNT_ID,
    appId: config.WHATSAPP_APP_ID,
    signupConfigId: config.WHATSAPP_SIGNUP_CONFIG_ID,
    appSecret: config.WHATSAPP_APP_SECRET,
    verifyToken: config.WHATSAPP_VERIFY_TOKEN,
    graphVersion: config.GRAPH_API_VERSION,
    mapsApiKey: config.GOOGLE_MAPS_API_KEY,
  });

  let cache: WhatsAppCredentials = fromEnv();

  async function load(): Promise<void> {
    const merged = fromEnv();
    for (const row of await repo.getAll()) {
      if (!row.key.startsWith(KEY_PREFIX)) continue;
      const field = row.key.slice(KEY_PREFIX.length) as CredentialField;
      if (!(field in merged)) continue;
      try {
        const value = row.encrypted ? decrypt(row.value, key) : row.value;
        if (value) merged[field] = value;
      } catch {
        // Un valor que no descifra (clave rotada) se ignora en vez de tumbar
        // el arranque: /setup lo mostrara como pendiente.
      }
    }
    cache = merged;
  }

  await load();

  return {
    current: () => cache,
    reload: load,

    async save(values) {
      for (const [field, value] of Object.entries(values) as Array<[CredentialField, string]>) {
        if (value === undefined) continue;
        const trimmed = value.trim();
        if (!trimmed) {
          await repo.remove(KEY_PREFIX + field);
          continue;
        }
        const secret = SECRET_FIELDS.includes(field);
        await repo.put(KEY_PREFIX + field, secret ? encrypt(trimmed, key) : trimmed, secret);
      }
      await load();
    },

    missing: () => REQUIRED.filter((field) => !cache[field]),
    isConfigured: () => REQUIRED.every((field) => Boolean(cache[field])),

    masked() {
      const out = {} as Record<CredentialField, string>;
      for (const field of Object.keys(FIELD_LABELS) as CredentialField[]) {
        const value = cache[field];
        if (!value) out[field] = '';
        else if (SECRET_FIELDS.includes(field)) out[field] = `${'•'.repeat(12)}${value.slice(-4)}`;
        else out[field] = value;
      }
      return out;
    },
  };
}
