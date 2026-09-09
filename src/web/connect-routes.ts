/**
 * Conexion de la cuenta en un paso.
 *
 * El usuario pega tres datos (token, id de la app y su clave secreta) y el
 * sistema hace el resto: descubre la cuenta de negocio y el numero, se
 * inventa el token de verificacion, registra el webhook en Meta, suscribe la
 * app a la cuenta y comprueba que el numero responde.
 *
 * Si el token da acceso a mas de un numero, el primer intento devuelve la
 * lista y la pantalla pregunta cual: es la unica decision que no se puede
 * tomar por el usuario.
 */

import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { SettingsService } from '../settings/service.js';
import type { WhatsAppClient } from '../whatsapp/client.js';
import {
  discoverAccounts,
  isPubliclyReachable,
  registerWebhook,
  OnboardingError,
  type DiscoveredAccount,
} from '../whatsapp/onboarding.js';
import {
  exchangeCode,
  signupAvailability,
  signupExtras,
  SignupError,
} from '../whatsapp/embedded-signup.js';

export interface ConnectDeps {
  config: Config;
  settings: SettingsService;
  wa: WhatsAppClient;
}

const connectSchema = z.object({
  token: z.string().trim().min(20, 'el token es mas largo que eso').optional(),
  appId: z.string().trim().regex(/^\d+$/, 'el id de la app son solo numeros').optional(),
  appSecret: z.string().trim().min(16, 'la clave secreta es mas larga que eso').optional(),
  /** Elegido por el usuario cuando el token llega a varios numeros. */
  phoneNumberId: z.string().trim().optional(),
  /** URL publica; si se omite se usa PUBLIC_BASE_URL. */
  publicUrl: z.string().trim().url().optional(),
});

export interface ConnectStep {
  step: string;
  ok: boolean;
  detail: string;
}

export async function registerConnectRoutes(app: FastifyInstance, deps: ConnectDeps): Promise<void> {
  const { config, settings, wa } = deps;

  app.post('/admin/connect', async (request, reply) => {
    const body = connectSchema.parse(request.body ?? {});
    const current = settings.current();

    // Lo que no venga en el formulario se toma de lo ya guardado: asi se
    // puede reintentar la conexion sin volver a pegar el token.
    const token = body.token || current.token;
    const appId = body.appId || current.appId;
    const appSecret = body.appSecret || current.appSecret;

    const faltan = [
      !token && 'el token permanente',
      !appId && 'el id de la app',
      !appSecret && 'la clave secreta de la app',
    ].filter(Boolean);
    if (faltan.length) {
      return reply.code(400).send({ error: `Falta ${faltan.join(', ')}.` });
    }

    const steps: ConnectStep[] = [];
    const base = (body.publicUrl || config.PUBLIC_BASE_URL).replace(/\/+$/, '');
    const callbackUrl = `${base}/webhooks/whatsapp`;

    // 1. Descubrir cuenta y numeros.
    let accounts: DiscoveredAccount[];
    try {
      accounts = await discoverAccounts({ token, appId, appSecret, graphVersion: current.graphVersion });
    } catch (error) {
      const detail = error instanceof OnboardingError ? error.message : String(error);
      const step = error instanceof OnboardingError ? error.step : 'conectar con Meta';
      return reply.code(400).send({ error: detail, step, steps });
    }

    const numbers = accounts.flatMap((a) =>
      a.numbers.map((n) => ({ ...n, businessAccountId: a.businessAccountId, accountName: a.name })),
    );

    if (!numbers.length) {
      return reply.code(400).send({
        error:
          'La cuenta existe pero no tiene ningun numero. Registra uno en WhatsApp Manager y vuelve a intentarlo.',
        step: 'listar los numeros',
      });
    }

    const chosen = body.phoneNumberId
      ? numbers.find((n) => n.phoneNumberId === body.phoneNumberId)
      : numbers.length === 1
        ? numbers[0]
        : undefined;

    if (!chosen) {
      // Varios numeros y ninguno elegido: se devuelve la lista, no un error.
      return {
        needsChoice: true,
        accounts,
        numbers,
        detail: 'Tu token llega a varios numeros. Elige con cual quieres trabajar.',
      };
    }

    steps.push({
      step: 'Cuenta encontrada',
      ok: true,
      detail: `${chosen.accountName} — ${chosen.displayPhoneNumber || chosen.phoneNumberId}`,
    });

    // 2. Guardar lo descubierto. El verify token se lo inventa el sistema:
    //    es una cadena que solo tienen que coincidir Meta y nosotros.
    const verifyToken = current.verifyToken || randomBytes(18).toString('base64url');
    await settings.save({
      token,
      appId,
      appSecret,
      verifyToken,
      phoneNumberId: chosen.phoneNumberId,
      businessAccountId: chosen.businessAccountId,
    });
    await settings.reload();
    steps.push({ step: 'Credenciales guardadas', ok: true, detail: 'Cifradas en la base de datos.' });

    // 3. Registrar el webhook en la app.
    if (!isPubliclyReachable(base)) {
      steps.push({
        step: 'Webhook',
        ok: false,
        detail: `${base} no es una direccion a la que Meta pueda llegar. Levanta un tunel (npx cloudflared tunnel --url http://localhost:${config.PORT}) y vuelve a conectar poniendo esa direccion.`,
      });
    } else {
      try {
        const hook = await registerWebhook({
          token,
          appId,
          appSecret,
          graphVersion: current.graphVersion,
          callbackUrl,
          verifyToken,
        });
        steps.push({
          step: 'Webhook',
          ok: hook.success,
          detail: hook.success
            ? `Registrado en Meta: ${callbackUrl}`
            : 'Meta no confirmo el registro; revisalo en el panel de la app.',
        });
      } catch (error) {
        steps.push({
          step: 'Webhook',
          ok: false,
          detail: error instanceof OnboardingError ? error.message : String(error),
        });
      }
    }

    // 4. Suscribir la app a la cuenta de negocio. Sin esto Meta no manda
    //    nada aunque el webhook este registrado.
    try {
      const sub = await wa.subscribeApp();
      steps.push({
        step: 'App suscrita a la cuenta',
        ok: sub.success,
        detail: sub.success ? 'Lista para recibir mensajes.' : 'Meta no confirmo la suscripcion.',
      });
    } catch (error) {
      steps.push({
        step: 'App suscrita a la cuenta',
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    // 5. Comprobar que el numero responde de verdad.
    try {
      const phone = await wa.getPhoneNumber();
      steps.push({
        step: 'Numero',
        ok: true,
        detail: `${phone.displayPhoneNumber} (${phone.verifiedName}) — calidad ${phone.qualityRating}${phone.messagingLimitTier ? `, ${phone.messagingLimitTier}` : ''}`,
      });
    } catch (error) {
      steps.push({
        step: 'Numero',
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      ok: steps.every((s) => s.ok),
      connected: settings.isConfigured(),
      needsRegistration: chosen.needsRegistration,
      number: {
        phoneNumberId: chosen.phoneNumberId,
        displayPhoneNumber: chosen.displayPhoneNumber,
        verifiedName: chosen.verifiedName,
      },
      webhookUrl: callbackUrl,
      steps,
    };
  });

  /**
   * Que puede ofrecer la pantalla: la ventana de Meta necesita que la app
   * tenga configurado el registro incorporado; si no, queda pegar los datos.
   */
  app.get('/admin/connect/options', async () => {
    const current = settings.current();
    const disponibilidad = signupAvailability({
      appId: current.appId,
      signupConfigId: current.signupConfigId,
    });
    return {
      quick: disponibilidad.ready,
      missingForQuick: disponibilidad.missing,
      appId: current.appId,
      signupConfigId: current.signupConfigId,
      connected: settings.isConfigured(),
      publicUrl: config.PUBLIC_BASE_URL,
      reachable: isPubliclyReachable(config.PUBLIC_BASE_URL),
      graphVersion: current.graphVersion,
      // Los `extras` de cada modo se calculan aqui y no en la pagina: el valor
      // que espera Meta ha cambiado ya una vez y no debe vivir en un string
      // suelto dentro del HTML.
      modes: {
        coexistence: signupExtras('coexistence'),
        dedicated: signupExtras('dedicated'),
      },
    };
  });

  /**
   * Vuelta de la ventana de Meta: llega un codigo de un solo uso y, ya
   * elegidos por el usuario, el id de la cuenta y el del numero.
   */
  app.post('/admin/connect/signup', async (request, reply) => {
    const body = z
      .object({
        code: z.string().trim().min(10, 'el codigo no parece valido'),
        wabaId: z.string().trim().optional(),
        phoneNumberId: z.string().trim().optional(),
        appId: z.string().trim().optional(),
        appSecret: z.string().trim().optional(),
        publicUrl: z.string().trim().url().optional(),
      })
      .parse(request.body ?? {});

    const current = settings.current();
    const appId = body.appId || current.appId;
    const appSecret = body.appSecret || current.appSecret;
    if (!appId || !appSecret) {
      return reply
        .code(400)
        .send({ error: 'Falta el id de la app o su clave secreta para canjear el codigo.' });
    }

    let token: string;
    try {
      ({ token } = await exchangeCode({
        appId,
        appSecret,
        code: body.code,
        graphVersion: current.graphVersion,
      }));
    } catch (error) {
      const detail = error instanceof SignupError ? error.message : String(error);
      return reply.code(400).send({ error: detail, step: 'canjear el codigo' });
    }

    // Guardar lo que ya vino de la ventana y dejar que el flujo normal
    // termine el trabajo (webhook, suscripcion y comprobacion del numero).
    await settings.save({
      token,
      appId,
      appSecret,
      ...(body.wabaId ? { businessAccountId: body.wabaId } : {}),
      ...(body.phoneNumberId ? { phoneNumberId: body.phoneNumberId } : {}),
    });
    await settings.reload();

    const respuesta = await app.inject({
      method: 'POST',
      url: '/admin/connect',
      headers: { authorization: request.headers.authorization ?? '' },
      payload: {
        ...(body.phoneNumberId ? { phoneNumberId: body.phoneNumberId } : {}),
        ...(body.publicUrl ? { publicUrl: body.publicUrl } : {}),
      },
    });

    return reply.code(respuesta.statusCode).send(respuesta.json());
  });
}
