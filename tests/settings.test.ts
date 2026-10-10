import { describe, expect, it, vi } from 'vitest';
import { bootstrapSecrets, decrypt, encrypt, keyFromBase64 } from '../src/settings/crypto.js';
import { createSettingsService } from '../src/settings/service.js';
import { createDynamicWhatsAppClient, NotConfiguredError, checkConnection } from '../src/whatsapp/dynamic.js';
import { loadConfig } from '../src/config.js';
import { createMemorySettingsRepo, TEST_SETTINGS_KEY } from './fakes.js';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BARE_ENV = {
  PUBLIC_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'mysql://x/y',
  TRACKING_SECRET: 'x'.repeat(40),
} as NodeJS.ProcessEnv;

describe('cifrado de credenciales', () => {
  const key = keyFromBase64(TEST_SETTINGS_KEY);

  it('ida y vuelta', () => {
    const secret = 'EAAG...token-larguisimo';
    expect(decrypt(encrypt(secret, key), key)).toBe(secret);
  });

  it('dos cifrados del mismo texto no se parecen', () => {
    expect(encrypt('hola', key)).not.toBe(encrypt('hola', key));
  });

  it('un texto manipulado no descifra', () => {
    const payload = Buffer.from(encrypt('hola', key), 'base64');
    const last = payload.length - 1;
    payload.writeUInt8(payload.readUInt8(last) ^ 0xff, last);
    expect(() => decrypt(payload.toString('base64'), key)).toThrow();
  });

  it('exige una clave de 32 bytes', () => {
    expect(() => keyFromBase64(Buffer.alloc(16).toString('base64'))).toThrow();
  });
});

describe('secretos locales', () => {
  it('se generan una vez y se reutilizan', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'wa-'));
    const first = bootstrapSecrets(dir);
    const second = bootstrapSecrets(dir);

    expect(second).toEqual(first);
    expect(keyFromBase64(first.settingsKey)).toHaveLength(32);
    expect(JSON.parse(readFileSync(path.join(dir, '.secrets.json'), 'utf8')).trackingSecret).toBe(
      first.trackingSecret,
    );
  });
});

describe('servicio de ajustes', () => {
  // El sistema tiene que arrancar sin credenciales: es lo que permite pedirlas
  // por pantalla en vez de obligar a editar un .env antes del primer arranque.
  it('arranca sin credenciales y dice que falta', async () => {
    const settings = await createSettingsService(
      createMemorySettingsRepo(),
      loadConfig(BARE_ENV),
      TEST_SETTINGS_KEY,
    );

    expect(settings.isConfigured()).toBe(false);
    expect(settings.missing()).toContain('token');
    expect(settings.missing()).toContain('appSecret');
  });

  it('guarda, recarga y queda configurado', async () => {
    const settings = await createSettingsService(
      createMemorySettingsRepo(),
      loadConfig(BARE_ENV),
      TEST_SETTINGS_KEY,
    );

    await settings.save({
      token: 'EAAG-token',
      phoneNumberId: '123',
      businessAccountId: '456',
      appSecret: 'secreto',
      verifyToken: 'verifica',
    });

    expect(settings.isConfigured()).toBe(true);
    expect(settings.current().token).toBe('EAAG-token');
    expect(settings.missing()).toHaveLength(0);
  });

  it('lo guardado gana sobre el entorno', async () => {
    const config = loadConfig({ ...BARE_ENV, WHATSAPP_PHONE_NUMBER_ID: 'del-entorno' });
    const settings = await createSettingsService(
      createMemorySettingsRepo(),
      config,
      TEST_SETTINGS_KEY,
    );

    expect(settings.current().phoneNumberId).toBe('del-entorno');
    await settings.save({ phoneNumberId: 'de-la-web' });
    expect(settings.current().phoneNumberId).toBe('de-la-web');
  });

  it('el token viaja cifrado a la base', async () => {
    const repo = createMemorySettingsRepo();
    const settings = await createSettingsService(repo, loadConfig(BARE_ENV), TEST_SETTINGS_KEY);
    await settings.save({ token: 'EAAG-token-secreto' });

    const row = (await repo.getAll()).find((r) => r.key === 'whatsapp.token');
    expect(row?.encrypted).toBe(true);
    expect(row?.value).not.toContain('EAAG-token-secreto');
  });

  it('el phone number id se guarda en claro: no es un secreto', async () => {
    const repo = createMemorySettingsRepo();
    const settings = await createSettingsService(repo, loadConfig(BARE_ENV), TEST_SETTINGS_KEY);
    await settings.save({ phoneNumberId: '123456' });

    const row = (await repo.getAll()).find((r) => r.key === 'whatsapp.phoneNumberId');
    expect(row?.encrypted).toBe(false);
    expect(row?.value).toBe('123456');
  });

  it('la vista para el navegador enmascara los secretos', async () => {
    const settings = await createSettingsService(
      createMemorySettingsRepo(),
      loadConfig(BARE_ENV),
      TEST_SETTINGS_KEY,
    );
    await settings.save({ token: 'EAAG-token-secreto-1234', phoneNumberId: '999' });

    const masked = settings.masked();
    expect(masked.token).not.toContain('EAAG');
    expect(masked.token.endsWith('1234')).toBe(true);
    expect(masked.phoneNumberId).toBe('999');
  });

  it('un valor vacio borra el guardado', async () => {
    const settings = await createSettingsService(
      createMemorySettingsRepo(),
      loadConfig(BARE_ENV),
      TEST_SETTINGS_KEY,
    );
    await settings.save({ phoneNumberId: '123' });
    await settings.save({ phoneNumberId: '   ' });
    expect(settings.current().phoneNumberId).toBe('');
  });
});

describe('cliente dinamico', () => {
  it('falla con un mensaje util si aun no hay credenciales', async () => {
    const settings = await createSettingsService(
      createMemorySettingsRepo(),
      loadConfig(BARE_ENV),
      TEST_SETTINGS_KEY,
    );
    const client = createDynamicWhatsAppClient(settings);

    await expect(client.sendText('5215500000000', 'hola')).rejects.toThrow(NotConfiguredError);
    await expect(client.sendText('5215500000000', 'hola')).rejects.toThrow('/setup');
  });
});

describe('prueba de conexion', () => {
  it('avisa de los campos que faltan sin salir a la red', async () => {
    const fetchImpl = vi.fn();
    const check = await checkConnection(
      { token: '', phoneNumberId: '', businessAccountId: '', graphVersion: 'v21.0' },
      fetchImpl as unknown as typeof fetch,
    );

    expect(check.ok).toBe(false);
    expect(check.detail).toContain('faltan datos');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('devuelve el error de Meta cuando el token no vale', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'Invalid OAuth access token', code: 190 } }), {
          status: 401,
        }),
    );

    const check = await checkConnection(
      { token: 'malo', phoneNumberId: '1', businessAccountId: '2', graphVersion: 'v21.0' },
      fetchImpl as unknown as typeof fetch,
    );

    expect(check.ok).toBe(false);
    expect(check.detail).toContain('Invalid OAuth access token');
  });
});
