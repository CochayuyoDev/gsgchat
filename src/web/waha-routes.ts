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
  sondearWaha,
  ensureSession,
  getQrCode,
  getSession,
  logoutSession,
  requestPairingCode,
  WahaError,
} from '../whatsapp/waha/session.js';
import { fromChatId } from '../whatsapp/waha/client.js';
import {
  crearWahaGestionado,
  esLocal,
  vistaDesdeContenedor,
  type WahaGestionado,
} from '../whatsapp/waha/gestionado.js';
import { importarConversaciones, POR_DEFECTO } from '../whatsapp/waha/importar.js';
import { providerOf } from '../settings/service.js';
import type { Repos } from '../db/repos.js';

export interface WahaRoutesDeps {
  config: Config;
  settings: SettingsService;
  /** Hace falta para traerse el historial que ya vive en WAHA. */
  repos: Repos;
  /**
   * El WAHA que levanta el propio sistema si no encuentra ninguno. Sin darlo,
   * se crea uno con Docker cuando WAHA_AUTOARRANQUE esta activo.
   */
  wahaGestionado?: WahaGestionado | null;
}

type Resolucion =
  | { ok: true; url: string; apiKey: string }
  | { ok: false; code: number; error: string; step?: string; preparando?: boolean; fase?: string };

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
  const gestionado =
    deps.wahaGestionado !== undefined
      ? deps.wahaGestionado
      : config.WAHA_AUTOARRANQUE
        ? crearWahaGestionado({
            // Nunca el mismo puerto que este servidor: WAHA y el se pisarian.
            puerto: config.WAHA_PUERTO_LOCAL === config.PORT ? config.PORT + 1 : config.WAHA_PUERTO_LOCAL,
            motor: config.WAHA_ENGINE || undefined,
          })
        : null;

  /**
   * Busca un WAHA que nos deje entrar. Primero con la clave que ya se tiene;
   * si no, con la del contenedor del sistema, que solo se le pregunta a Docker
   * cuando hace falta (es lento y en las pruebas no hay Docker que valga).
   */
  async function buscarEnLosSitiosDeSiempre(
    candidatos: string[],
    apiKey: string,
  ): Promise<{ url: string; apiKey: string } | null> {
    const found = await detectWaha(candidatos, fetch, 1200, apiKey || undefined);
    if (found) return { url: found, apiKey };
    const delContenedor = gestionado ? await gestionado.claveExistente() : '';
    if (!delContenedor || delContenedor === apiKey) return null;
    const conClave = await detectWaha(candidatos, fetch, 1200, delContenedor);
    return conClave ? { url: conClave, apiKey: delContenedor } : null;
  }

  /**
   * Donde esta WAHA y con que clave se entra, en este orden: lo que escribio
   * el usuario, lo guardado, lo que se encuentre en los puertos de siempre y,
   * si no hay nada, el contenedor que levanta el sistema.
   */
  async function resolverWaha(urlPedida?: string, clavePedida?: string): Promise<Resolucion> {
    const current = settings.current();
    const url = urlPedida || current.wahaUrl;
    let apiKey = clavePedida || current.wahaApiKey || '';

    if (url) {
      let sonda = await sondearWaha(url, apiKey || undefined);
      // Un WAHA de esta maquina que pide clave: casi siempre es el nuestro y
      // la clave se perdio (la demo no guarda nada). Se lee del contenedor.
      if (sonda === 'clave' && gestionado && esLocal(url)) {
        const delContenedor = await gestionado.claveExistente();
        if (delContenedor) {
          apiKey = delContenedor;
          sonda = await sondearWaha(url, apiKey);
        }
      }
      if (sonda === 'listo') return { ok: true, url: url.replace(/\/+$/, ''), apiKey };
      if (sonda === 'clave') {
        return {
          ok: false,
          code: 400,
          error: `En ${url} hay un WAHA, pero pide una clave de API que no coincide. Pon su WAHA_API_KEY en "Clave de WAHA".`,
          step: 'entrar en WAHA',
        };
      }
      // Lo escribio el usuario y ahi no hay nada: no se le cambia por otro.
      if (urlPedida) {
        return {
          ok: false,
          code: 400,
          error:
            `En ${url} no hay ningun WAHA escuchando. ` +
            'Deja la dirección vacía y el sistema levanta su propio WAHA.',
          step: 'buscar el contenedor',
        };
      }
    }

    const encontrado = await buscarEnLosSitiosDeSiempre(CANDIDATOS_WAHA, apiKey);
    if (encontrado) return { ok: true, ...encontrado };

    if (!gestionado) {
      return {
        ok: false,
        code: 400,
        error:
          'No hay ningún WAHA en esta máquina y el arranque automático está apagado (WAHA_AUTOARRANQUE=false). ' +
          'Escribe la dirección de tu contenedor.',
        step: 'buscar el contenedor',
      };
    }

    const estado = await gestionado.asegurar();
    if (estado.fase === 'listo') return { ok: true, url: estado.url, apiKey: estado.apiKey };
    if (estado.fase === 'descargando' || estado.fase === 'arrancando') {
      return { ok: false, code: 202, error: estado.detalle, preparando: true, fase: estado.fase };
    }
    return { ok: false, code: 400, error: estado.detalle, step: 'levantar WAHA', fase: estado.fase };
  }

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

    const donde = await resolverWaha(body.wahaUrl, body.wahaApiKey);
    if (!donde.ok) {
      // 202 = todavia se esta levantando: la pantalla vuelve a llamar sola.
      return reply.code(donde.code).send(
        donde.preparando
          ? { ok: false, preparando: true, fase: donde.fase, detalle: donde.error }
          : { error: donde.error, step: donde.step },
      );
    }
    const wahaUrl = donde.url;

    // La clave del HMAC se la inventa el sistema, igual que el verify token de
    // Meta: es una cadena que solo tienen que compartir WAHA y nosotros.
    const verifyToken = current.verifyToken || randomBytes(18).toString('base64url');

    await settings.save({
      provider: 'waha',
      wahaUrl,
      verifyToken,
      ...(donde.apiKey && donde.apiKey !== current.wahaApiKey ? { wahaApiKey: donde.apiKey } : {}),
      ...(body.wahaSession ? { wahaSession: body.wahaSession } : {}),
      ...(body.wahaEngine ? { wahaEngine: body.wahaEngine } : {}),
    });
    await settings.reload();

    const base = (body.publicUrl || config.PUBLIC_BASE_URL).replace(/\/+$/, '');
    // WAHA corre en Docker: si este servidor solo escucha en esta maquina, el
    // contenedor lo alcanza por host.docker.internal, no por localhost.
    const baseWebhook = config.WAHA_WEBHOOK_BASE_URL
      ? config.WAHA_WEBHOOK_BASE_URL.replace(/\/+$/, '')
      : esLocal(wahaUrl)
        ? vistaDesdeContenedor(base)
        : base;
    const webhookUrl = `${baseWebhook}/webhooks/waha`;
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
    const encontrado = await buscarEnLosSitiosDeSiempre(
      guardada ? [guardada, ...CANDIDATOS_WAHA] : CANDIDATOS_WAHA,
      settings.current().wahaApiKey,
    );
    return { found: encontrado?.url ?? null, saved: guardada || null, autoarranque: Boolean(gestionado) };
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
