/**
 * Cifrado de las credenciales que se guardan en la base.
 *
 * El token de WhatsApp permite mandar mensajes en nombre del negocio: en
 * claro dentro de una tabla, cualquier volcado de la base lo expone. Se
 * cifra con AES-256-GCM y la clave vive fuera de la base, en un fichero
 * local que se genera solo la primera vez.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  // iv | tag | ciphertext, todo en un base64 para que quepa en una columna text.
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

export function decrypt(payload: string, key: Buffer): string {
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
  const data = raw.subarray(IV_LENGTH + 16);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export interface LocalSecrets {
  settingsKey: string;
  adminToken: string;
  trackingSecret: string;
}

/**
 * Genera los secretos locales la primera vez y los reutiliza despues.
 *
 * Es lo que permite arrancar sin editar un `.env` a mano: el sistema se
 * inventa sus propias claves y solo pide por pantalla lo que unicamente
 * puede dar Meta.
 */
export function bootstrapSecrets(directory: string): LocalSecrets {
  const file = path.join(directory, '.secrets.json');

  if (existsSync(file)) {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<LocalSecrets>;
    if (parsed.settingsKey && parsed.adminToken && parsed.trackingSecret) {
      return parsed as LocalSecrets;
    }
  }

  const secrets: LocalSecrets = {
    settingsKey: randomBytes(32).toString('base64'),
    adminToken: randomBytes(24).toString('base64url'),
    trackingSecret: randomBytes(32).toString('base64url'),
  };

  writeFileSync(file, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // En Windows chmod es simbolico; el fichero queda igual bajo el perfil.
  }
  return secrets;
}

export function keyFromBase64(value: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('la clave de cifrado debe tener 32 bytes');
  return key;
}
