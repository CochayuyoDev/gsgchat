/**
 * Conectar la cuenta en un paso.
 *
 * Lo que hace este modulo es hablar con Meta, asi que aqui se prueba contra
 * un `fetch` de mentira que devuelve las respuestas reales de la Graph API:
 * lo que importa es que se pidan las URLs correctas y que un token sin
 * permisos se explique en vez de fallar con un HTTP a secas.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  discoverAccounts,
  isPubliclyReachable,
  registerWebhook,
  OnboardingError,
} from '../src/whatsapp/onboarding.js';

const CREDENCIALES = { token: 'EAAG-token', appId: '123456', appSecret: 'secreto' };

/** Devuelve una respuesta por URL, y anota lo que se pidio. */
function fakeFetch(rutas: Array<[RegExp, unknown, number?]>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    calls.push({ url: href, init });
    const match = rutas.find(([re]) => re.test(href));
    if (!match) return new Response(JSON.stringify({ error: { message: 'ruta no simulada: ' + href } }), { status: 404 });
    return new Response(JSON.stringify(match[1]), { status: match[2] ?? 200 });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const TOKEN_VALIDO = {
  data: {
    is_valid: true,
    scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'],
    granular_scopes: [
      { scope: 'whatsapp_business_messaging', target_ids: ['WABA1'] },
      { scope: 'whatsapp_business_management', target_ids: ['WABA1'] },
    ],
  },
};

describe('descubrir la cuenta', () => {
  it('encuentra la cuenta y sus numeros con solo el token y la app', async () => {
    const { impl, calls } = fakeFetch([
      [/debug_token/, TOKEN_VALIDO],
      [/\/WABA1\?fields=name/, { name: 'Mi Tienda' }],
      [
        /\/WABA1\/phone_numbers/,
        {
          data: [
            {
              id: 'PN1',
              display_phone_number: '+52 1 55 1234 5678',
              verified_name: 'Mi Tienda',
              quality_rating: 'GREEN',
              status: 'CONNECTED',
            },
          ],
        },
      ],
    ]);

    const accounts = await discoverAccounts({ ...CREDENCIALES, fetchImpl: impl });

    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ businessAccountId: 'WABA1', name: 'Mi Tienda' });
    expect(accounts[0]!.numbers[0]).toMatchObject({
      phoneNumberId: 'PN1',
      displayPhoneNumber: '+52 1 55 1234 5678',
      needsRegistration: false,
    });

    // El token de la app es el que autoriza debug_token, no el del usuario.
    expect(calls[0]!.url).toContain('access_token=123456%7Csecreto');
  });

  it('un numero sin registrar se marca como tal', async () => {
    const { impl } = fakeFetch([
      [/debug_token/, TOKEN_VALIDO],
      [/\/WABA1\?fields=name/, { name: 'Mi Tienda' }],
      [/phone_numbers/, { data: [{ id: 'PN1', status: 'PENDING' }] }],
    ]);

    const accounts = await discoverAccounts({ ...CREDENCIALES, fetchImpl: impl });
    expect(accounts[0]!.numbers[0]!.needsRegistration).toBe(true);
  });

  it('un token de otra app se explica en castellano', async () => {
    const { impl } = fakeFetch([[/debug_token/, { data: { is_valid: false } }]]);

    await expect(discoverAccounts({ ...CREDENCIALES, fetchImpl: impl })).rejects.toThrow(
      /no es valido para esta app/,
    );
  });

  it('un token sin permisos de WhatsApp dice que permisos trae', async () => {
    const { impl } = fakeFetch([
      [/debug_token/, { data: { is_valid: true, scopes: ['email', 'public_profile'], granular_scopes: [] } }],
    ]);

    await expect(discoverAccounts({ ...CREDENCIALES, fetchImpl: impl })).rejects.toThrow(
      /email, public_profile/,
    );
  });

  it('un error de Meta llega con su mensaje y el paso donde ocurrio', async () => {
    const { impl } = fakeFetch([
      [/debug_token/, { error: { message: 'Invalid OAuth access token', code: 190 } }, 401],
    ]);

    await expect(discoverAccounts({ ...CREDENCIALES, fetchImpl: impl })).rejects.toMatchObject({
      name: 'OnboardingError',
      message: 'Invalid OAuth access token',
      step: 'revisar el token',
      code: 190,
    });
  });

  it('varias cuentas devuelven varias opciones', async () => {
    const { impl } = fakeFetch([
      [
        /debug_token/,
        {
          data: {
            is_valid: true,
            granular_scopes: [{ scope: 'whatsapp_business_messaging', target_ids: ['WABA1', 'WABA2'] }],
          },
        },
      ],
      [/\/WABA1\?fields=name/, { name: 'Tienda A' }],
      [/\/WABA2\?fields=name/, { name: 'Tienda B' }],
      [/phone_numbers/, { data: [{ id: 'PN', status: 'CONNECTED' }] }],
    ]);

    const accounts = await discoverAccounts({ ...CREDENCIALES, fetchImpl: impl });
    expect(accounts.map((a) => a.name)).toEqual(['Tienda A', 'Tienda B']);
  });
});

describe('registrar el webhook', () => {
  it('manda la URL, el verify token y los cuatro campos que hacen falta', async () => {
    const { impl, calls } = fakeFetch([[/\/123456\/subscriptions/, { success: true }]]);

    const result = await registerWebhook({
      ...CREDENCIALES,
      callbackUrl: 'https://mi.tienda/webhooks/whatsapp',
      verifyToken: 'secreto-generado',
      fetchImpl: impl,
    });

    expect(result.success).toBe(true);
    const body = String(calls[0]!.init!.body);
    expect(body).toContain('object=whatsapp_business_account');
    expect(body).toContain(encodeURIComponent('https://mi.tienda/webhooks/whatsapp'));
    expect(body).toContain('verify_token=secreto-generado');
    for (const field of [
      'messages',
      'message_template_status_update',
      'message_template_quality_update',
      'phone_number_quality_update',
    ]) {
      expect(decodeURIComponent(body)).toContain(field);
    }
  });

  it('si Meta rechaza, el error dice en que paso fue', async () => {
    const { impl } = fakeFetch([
      [/subscriptions/, { error: { message: 'URL no verificable', code: 2200 } }, 400],
    ]);

    await expect(
      registerWebhook({
        ...CREDENCIALES,
        callbackUrl: 'https://mi.tienda/webhooks/whatsapp',
        verifyToken: 'x',
        fetchImpl: impl,
      }),
    ).rejects.toMatchObject({ step: 'registrar el webhook', message: 'URL no verificable' });
  });
});

describe('direcciones a las que Meta puede llegar', () => {
  it('acepta un dominio publico con https', () => {
    expect(isPubliclyReachable('https://mi.tienda')).toBe(true);
    expect(isPubliclyReachable('https://algo.trycloudflare.com')).toBe(true);
  });

  it('rechaza localhost, http y direcciones internas', () => {
    for (const url of [
      'http://localhost:3000',
      'https://localhost:3000',
      'http://mi.tienda',
      'https://192.168.1.10',
      'https://127.0.0.1',
      'https://10.0.0.5',
      'no-es-una-url',
    ]) {
      expect(isPubliclyReachable(url), url).toBe(false);
    }
  });
});

describe('OnboardingError', () => {
  it('lleva el paso para que la pantalla diga donde mirar', () => {
    const error = new OnboardingError('algo', 'listar los numeros', 100);
    expect(error).toMatchObject({ step: 'listar los numeros', code: 100 });
  });
});
