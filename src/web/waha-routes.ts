/**
 * Conexion por WAHA: crear la sesion, enseñar el QR y saber si ya esta.
 *
 * Es el equivalente de `connect-routes.ts` para el otro proveedor. La pantalla
 * llama a `POST /admin/waha/connect` una vez y luego a `GET /admin/waha/status`
 * cada pocos segundos hasta que el estado es WORKING.
 */

import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { SettingsService } from '../settings/service.js';
import { isPubliclyReachable } from '../whatsapp/onboarding.js';
import {
  CANDIDATOS_WAHA,
  detectWaha,
  ensureSession,
  getQrCode,
  getSession,
  logoutSession,
  requestPairingCode,
  WahaError,
} from '../whatsapp/waha/session.js';
import { fromChatId } from '../whatsapp/waha/client.js';
import { importarConversaciones, POR_DEFECTO } from '../whatsapp/waha/importar.js';
import { providerOf } from '../settings/service.js';
import type { Repos } from '../db/repos.js';

export interface WahaRoutesDeps {
  config: Config;
  settings: SettingsService;
  /** Hace falta para traerse el historial que ya vive en WAHA. */
  repos: Repos;
}

const connectSchema = z.object({
  wahaUrl: z.string().trim().url('la direccion de WAHA tiene que ser una URL completa').optional(),
  wahaApiKey: z.string().trim().optional(),
  wahaSession: z.string().trim().optional(),
  wahaEngine: z.string().trim().optional(),
  /** URL publica de ESTE sistema, a la que WAHA mandara los mensajes. */
  publicUrl: z.string().trim().url().optional(),
});

const codeSchema = z.object({
  phone: z.string().trim().min(6, 'hace falta el numero con codigo de pais'),
});

function connectionFrom(settings: SettingsService) {
  const current = settings.current();
  return {
    baseUrl: current.wahaUrl,
    apiKey: current.wahaApiKey || undefined,
    session: current.wahaSession || undefined,
  };
}

export async function registerWahaRoutes(app: FastifyInstance, deps: WahaRoutesDeps): Promise<void> {
  const { config, settings, repos } = deps;

  /**
   * Trae al sistema las conversaciones que ya existen en WAHA.
   *
   * El webhook solo entrega lo que pasa desde que se conecta: sin esto, el
   * operador abre el chat y no ve nada de lo que sus bots hablaron antes.
   */
  app.post('/admin/waha/importar', async (request, reply) => {
    if (providerOf(settings.current()) !== 'waha') {
      return reply.code(409).send({
        error: 'Esto solo funciona con WAHA: es el único proveedor que guarda el historial y permite pedirlo.',
      });
    }

    const conexion = connectionFrom(settings);
    if (!conexion.baseUrl) {
      return reply.code(409).send({ error: 'Falta la dirección de WAHA: conéctala en /setup.' });
    }

    const body = z
      .object({
        limiteChats: z.coerce.number().int().positive().max(500).default(POR_DEFECTO.limiteChats),
        mensajesPorChat: z.coerce.number().int().positive().max(1000).default(POR_DEFECTO.mensajesPorChat),
      })
      .parse(request.body ?? {});

    try {
      return await importarConversaciones(
        { repos, log: (mensaje, detalle) => app.log.info(detalle ?? {}, mensaje) },
        conexion,
        body,
      );
    } catch (error) {
      return reply.code(502).send({
        error: `No se pudo leer el historial de WAHA: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

  /**
   * Guarda los datos del contenedor, crea la sesion y la deja lista para
   * escanear. No devuelve el QR: eso lo pide `status`, porque WAHA tarda unos
   * segundos en generarlo y bloquear aqui solo alargaria el request.
   */
  app.post('/admin/waha/connect', async (request, reply) => {
    const body = connectSchema.parse(request.body ?? {});
    const current = settings.current();

    const wahaUrl = body.wahaUrl || current.wahaUrl;
    if (!wahaUrl) {
      return reply.code(400).send({ error: 'Falta la direccion del contenedor de WAHA.' });
    }

    // Comprobar que ahi vive un WAHA ANTES de guardar nada ni crear la sesion.
    // El fallo tipico es apuntar a este mismo servidor: entonces el POST a
    // /api/sessions se estrella contra nuestro propio router y el usuario ve
    // un "Route POST:/api/sessions not found" que no explica nada.
    if (!(await detectWaha([wahaUrl]))) {
      return reply.code(400).send({
        error:
          `En ${wahaUrl} no hay ningun WAHA escuchando. ` +
          'Arranca el contenedor con "docker run -d -p 3001:3000 devlikeapro/waha" ' +
          'y usa http://localhost:3001. Ojo: el 3000 suele ser este mismo servidor.',
        step: 'buscar el contenedor',
      });
    }

    // La clave del HMAC se la inventa el sistema, igual que el verify token de
    // Meta: es una cadena que solo tienen que compartir WAHA y nosotros.
    const verifyToken = current.verifyToken || randomBytes(18).toString('base64url');

    await settings.save({
      provider: 'waha',
      wahaUrl,
      verifyToken,
      ...(body.wahaApiKey ? { wahaApiKey: body.wahaApiKey } : {}),
      ...(body.wahaSession ? { wahaSession: body.wahaSession } : {}),
      ...(body.wahaEngine ? { wahaEngine: body.wahaEngine } : {}),
    });
    await settings.reload();

    const base = (body.publicUrl || config.PUBLIC_BASE_URL).replace(/\/+$/, '');
    const webhookUrl = `${base}/webhooks/waha`;
    const saved = settings.current();

    try {
      const session = await ensureSession({
        baseUrl: saved.wahaUrl,
        apiKey: saved.wahaApiKey || undefined,
        session: saved.wahaSession || undefined,
        webhookUrl,
        hmacKey: saved.verifyToken,
        engine: saved.wahaEngine || undefined,
      });

      return {
        ok: true,
        status: session.status,
        webhookUrl,
        // WAHA corre en tu propia maquina, asi que no necesita una URL publica
        // para funcionar; solo tiene que poder llegar a ESTE servidor.
        reachable: isPubliclyReachable(base) || /localhost|127\.0\.0\.1/.test(base),
        session: saved.wahaSession || 'default',
      };
    } catch (error) {
      const detail = error instanceof WahaError ? error.message : String(error);
      const step = error instanceof WahaError ? error.step : 'conectar con WAHA';
      return reply.code(400).send({ error: detail, step });
    }
  });

  /**
   * Estado de la sesion y, si toca escanear, el QR en base64.
   *
   * La pantalla llama a esto en bucle, asi que un contenedor apagado se
   * responde con `ok: false` y un motivo, no con un 500.
   */
  app.get('/admin/waha/status', async () => {
    const current = settings.current();
    if (!current.wahaUrl) {
      return { ok: false, configured: false, detail: 'Todavia no hay ningun contenedor guardado.' };
    }

    try {
      const session = await getSession(connectionFrom(settings));
      if (!session) {
        return { ok: false, configured: true, status: 'STOPPED', detail: 'La sesion no existe todavia.' };
      }

      const qr =
        session.status === 'SCAN_QR_CODE' ? await getQrCode(connectionFrom(settings)) : null;

      return {
        ok: true,
        configured: true,
        status: session.status,
        connected: session.status === 'WORKING',
        phone: session.me?.id ? fromChatId(session.me.id) : '',
        name: session.me?.pushName ?? '',
        qr,
      };
    } catch (error) {
      return {
        ok: false,
        configured: true,
        detail: error instanceof WahaError ? error.message : String(error),
      };
    }
  });

  /**
   * Vincular con el numero en vez de con la camara.
   *
   * Devuelve el codigo de ocho caracteres que hay que teclear en el telefono.
   * Si el motor del contenedor no lo soporta, el error de WAHA sale tal cual y
   * la pantalla se queda con el QR, que siempre funciona.
   */
  app.post('/admin/waha/request-code', async (request, reply) => {
    const body = codeSchema.parse(request.body ?? {});
    if (!settings.current().wahaUrl) {
      return reply.code(400).send({ error: 'No hay ningun contenedor de WAHA configurado.' });
    }

    try {
      const code = await requestPairingCode(connectionFrom(settings), body.phone);
      if (!code) {
        return reply.code(400).send({ error: 'WAHA no devolvio ningun codigo. Prueba con el QR.' });
      }
      return { ok: true, code };
    } catch (error) {
      const detail = error instanceof WahaError ? error.message : String(error);
      return reply.code(400).send({ error: detail });
    }
  });

  /**
   * Busca el contenedor por su cuenta.
   *
   * La pantalla lo llama al elegir el modo WAHA: si lo encuentra, rellena la
   * direccion sola y al usuario solo le queda darle a conectar.
   */
  app.get('/admin/waha/detect', async () => {
    const guardada = settings.current().wahaUrl;
    const found = await detectWaha(guardada ? [guardada, ...CANDIDATOS_WAHA] : CANDIDATOS_WAHA);
    return { found, saved: guardada || null };
  });

  /** Desvincula el telefono: obliga a escanear otro QR. */
  app.post('/admin/waha/logout', async (request, reply) => {
    if (!settings.current().wahaUrl) {
      return reply.code(400).send({ error: 'No hay ningun contenedor de WAHA configurado.' });
    }
    try {
      await logoutSession(connectionFrom(settings));
      return { ok: true };
    } catch (error) {
      const detail = error instanceof WahaError ? error.message : String(error);
      return reply.code(400).send({ error: detail });
    }
  });

  /** Vuelve a la API oficial sin perder lo guardado de WAHA. */
  app.post('/admin/waha/switch-to-cloud', async () => {
    await settings.save({ provider: 'cloud' });
    await settings.reload();
    return { ok: true, provider: 'cloud' };
  });
}
