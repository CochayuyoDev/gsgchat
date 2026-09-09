/**
 * Configuracion del proceso. Se valida al arrancar y no despues: un token
 * de WhatsApp ausente debe reventar en el arranque, no a mitad de una
 * campana con la cola llena.
 */

import 'dotenv/config';
import { z } from 'zod';
import { LIMA_BBOX, MEXICO_BBOX } from './geo/validate.js';
import type { BoundingBox } from './types.js';

const csv = (value: string) =>
  value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url(),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  // Por donde sale y entra WhatsApp. `cloud` es la API oficial de Meta;
  // `waha` es un contenedor de WAHA, que se conecta con codigo QR y funciona
  // con cualquier WhatsApp, a cambio de emular WhatsApp Web (fuera de los
  // terminos de Meta, con riesgo real de baneo del numero).
  WHATSAPP_PROVIDER: z.enum(['cloud', 'waha', 'local']).default('cloud'),

  /**
   * Mete el token de administracion en las paginas para no tener que pegarlo.
   *
   * Solo tiene sentido cuando el servidor escucha unicamente en 127.0.0.1: ahi
   * cualquiera que pueda abrir la pagina ya esta dentro de la maquina, asi que
   * pedirle el token no protege de nada y se cobra un tramite en cada pestaña.
   * En cuanto el servidor sea accesible desde fuera, esto tiene que estar en
   * false: seria repartir la llave con la puerta.
   */
  ADMIN_TOKEN_AUTOFILL: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  WAHA_URL: z.string().default(''),
  WAHA_API_KEY: z.string().default(''),
  WAHA_SESSION: z.string().default('default'),
  /** WEBJS | NOWEB | GOWS | WPP. Vacio = el que traiga el contenedor. */
  WAHA_ENGINE: z.string().default(''),

  // Las credenciales de Meta son opcionales a proposito: el sistema arranca
  // sin ellas y las pide por pantalla en /setup. Lo que se guarde ahi tiene
  // precedencia sobre estas variables.
  GRAPH_API_VERSION: z.string().default('v21.0'),
  WHATSAPP_TOKEN: z.string().default(''),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().default(''),
  // Id de la app de Meta: hace falta para registrar el webhook por API.
  WHATSAPP_APP_ID: z.string().default(''),
  // Configuracion de registro incorporado: habilita conectar en una ventana.
  WHATSAPP_SIGNUP_CONFIG_ID: z.string().default(''),
  WHATSAPP_APP_SECRET: z.string().default(''),
  WHATSAPP_VERIFY_TOKEN: z.string().default(''),

  // Vacia = la pagina de rastreo cae a Leaflet + OpenStreetMap, sin clave.
  GOOGLE_MAPS_API_KEY: z.string().default(''),

  /** Bearer token de la API /admin. */
  ADMIN_TOKEN: z.string().min(16, 'ADMIN_TOKEN necesita 16 caracteres o mas'),

  TRACKING_SECRET: z.string().min(32, 'TRACKING_SECRET necesita 32 caracteres o mas'),
  TRACKING_TTL_MINUTES: z.coerce.number().int().positive().default(120),

  WARMUP_START_PER_DAY: z.coerce.number().int().positive().default(50),
  WARMUP_GROWTH: z.coerce.number().positive().default(1.5),
  DAILY_SEND_CAP: z.coerce.number().int().positive().default(1000),
  MAX_MARKETING_PER_CONTACT_7D: z.coerce.number().int().nonnegative().default(2),

  OPT_OUT_KEYWORDS: z.string().default('baja,stop,cancelar,unsubscribe'),
  OPT_IN_KEYWORDS: z.string().default('alta,acepto'),

  GEO_BBOX: z.enum(['lima', 'mexico', 'none']).default('none'),

  /**
   * Como se llama la zona que se atiende, para decirselo al cliente.
   *
   * Un "queda fuera de la zona que atendemos" a secas obliga a preguntar cual
   * es. Con el nombre puesto, quien esta fuera lo sabe en el mismo mensaje y
   * quien esta dentro no vuelve a preguntar.
   */
  COVERAGE_NAME: z.string().default(''),
});

export type RawConfig = z.infer<typeof schema>;

export interface Config extends RawConfig {
  optOutKeywords: string[];
  optInKeywords: string[];
  bbox?: BoundingBox;
  /** Nombre de la zona atendida, para los mensajes al cliente. */
  coverageName: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuracion invalida:\n${detail}`);
  }

  const raw = parsed.data;
  return {
    ...raw,
    optOutKeywords: csv(raw.OPT_OUT_KEYWORDS),
    optInKeywords: csv(raw.OPT_IN_KEYWORDS),
    bbox: raw.GEO_BBOX === 'lima' ? LIMA_BBOX : raw.GEO_BBOX === 'mexico' ? MEXICO_BBOX : undefined,
    coverageName:
      raw.COVERAGE_NAME.trim() ||
      (raw.GEO_BBOX === 'lima' ? 'todo Lima y Callao' : raw.GEO_BBOX === 'mexico' ? 'Mexico' : ''),
  };
}
