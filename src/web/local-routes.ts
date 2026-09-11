/**
 * Conexion local: el camino corto de /setup.
 *
 * Ni contenedor ni app de Meta. Se pulsa conectar, sale el QR (o un codigo de
 * ocho caracteres si se prefiere teclearlo) y ya esta. Es el equivalente de
 * `waha-routes.ts` para el proveedor que corre dentro de este proceso, y habla
 * el mismo vocabulario de estados para que la pantalla sirva para los dos.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from '../config.js';
import { providerOf } from '../settings/service.js';
import type { Monitor } from '../salud/monitor.js';
import type { Repos } from '../db/repos.js';
import type { Sender } from '../outbound/sender.js';
import type { SettingsService } from '../settings/service.js';
import type { WhatsAppClient } from '../whatsapp/client.js';
import { createSeenCache, processChange, type WebhookDeps } from '../whatsapp/webhook.js';
import type { StokyClient } from '../stoky/client.js';
import { leerMedia, mediaDirectory } from '../whatsapp/local/media.js';
import {
  defaultAuthDir,
  getLocalState,
  logoutLocal,
  requestLocalPairingCode,
  startLocal,
} from '../whatsapp/local/session.js';

export interface LocalRoutesDeps {
  config: Config;
  catalogo?: StokyClient;
  repos: Repos;
  sender: Sender;
  wa: WhatsAppClient;
  settings: SettingsService;
  /** El monitor de salud: cuenta las desconexiones y para todo con un 403. */
  salud?: Monitor;
  /**
   * Volver a abrir la sesion al arrancar si ya hay una vinculacion guardada.
   *
   * Sin esto, tras cada reinicio alguien tenia que entrar a /setup y pulsar
   * conectar; mientras tanto el motor de rutas y las secuencias intentaban
   * enviar contra un socket cerrado. Solo lo encienden los arranques reales
   * (dev y quick): en las pruebas el directorio de trabajo es el del proyecto
   * y ahi vive la vinculacion de verdad, que no se puede tocar.
   */
  autoConectar?: boolean;
}

/** El navegador necesita saber que es para decidir si lo pinta o lo baja. */
function tipoMime(id: string): string {
  const porExtension: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.3gp': 'video/3gpp',
    '.ogg': 'audio/ogg',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.pdf': 'application/pdf',
  };
  const ext = id.slice(id.lastIndexOf('.'));
  return porExtension[ext] ?? 'application/octet-stream';
}

const codeSchema = z.object({
  phone: z.string().trim().min(6, 'hace falta el numero con codigo de pais'),
});

export async function registerLocalRoutes(
  app: FastifyInstance,
  deps: LocalRoutesDeps,
): Promise<void> {
  const { config, repos, sender, wa, settings, catalogo, salud } = deps;
  const authDir = defaultAuthDir();
  const mediaDir = mediaDirectory();

  // Si el proveedor es el local y hay vinculacion guardada, se reconecta
  // sola en cuanto el servidor este escuchando (por eso el onReady).
  if (deps.autoConectar) {
    app.addHook('onReady', async () => {
      if (providerOf(settings.current()) !== 'local') return;
      if (!existsSync(join(authDir, 'creds.json'))) return;
      console.log('[wa] vinculacion guardada: reconectando la sesion local...');
      void arrancar().catch((error) => console.error('[wa] no se pudo reconectar la sesion local:', error));
    });
  }

  // Los entrantes van por el mismo sitio que los de Meta y los de WAHA: aqui
  // no hay webhook que firmar, pero si la misma deduplicacion por id.
  const webhookDeps: WebhookDeps = { repos, config, sender, wa, settings, catalogo, salud, seen: createSeenCache() };

  async function arrancar() {
    return startLocal({
      authDir,
      mediaDir,
      // console y no app.log a proposito: los arranques cortos corren con el
      // logger apagado, y con el se perdian justo las lineas que explican por
      // que un mensaje no aparece.
      log: (mensaje) => console.log(`[wa] ${mensaje}`),
      // Cada corte con su codigo: tres en una hora frenan; un 403 para todo.
      onDisconnect: (code, detail) => {
        void salud?.registrarDesconexion(code, detail).catch(() => undefined);
      },
      onChange: async (value) => {
        try {
          await processChange('messages', value, webhookDeps);
        } catch (error) {
          // Sin esto un entrante que revienta aguas abajo es indistinguible de
          // un entrante que no llego: el sintoma es el mismo, "no me llegan".
          console.error('[wa] fallo procesando un entrante:', error);
        }
      },
    });
  }

  /**
   * Deja la sesion abierta y devuelve el estado.
   *
   * Guarda `provider: 'local'` primero para que el resto del sistema deje de
   * pedir credenciales de Meta en cuanto se pulsa el boton: el modo local no
   * necesita ninguna.
   */
  app.post('/admin/local/connect', async () => {
    await settings.save({ provider: 'local' });
    await settings.reload();
    const estado = await arrancar();
    return { ok: true, ...estado };
  });

  /** Estado y, si toca escanear, el QR en base64. La pantalla lo sondea. */
  app.get('/admin/local/status', async () => {
    const estado = getLocalState();
    return {
      ok: true,
      configured: true,
      connected: estado.status === 'WORKING',
      ...estado,
    };
  });

  /** Vincular con el numero en vez de con la camara. */
  app.post('/admin/local/request-code', async (request, reply) => {
    const body = codeSchema.parse(request.body ?? {});
    try {
      // Pedir el codigo exige la sesion ya abierta: si el usuario llega aqui
      // sin haber pulsado conectar, se abre sola en vez de darle un error.
      if (getLocalState().status === 'STOPPED') await arrancar();
      const code = await requestLocalPairingCode(body.phone);
      return { ok: true, code };
    } catch (error) {
      return reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : 'no se pudo pedir el codigo' });
    }
  });

  /**
   * Sirve una foto, un audio o un documento que llego por el chat.
   *
   * Va detras del token como todo /admin, y el id se valida contra la forma
   * que genera el propio sistema, asi que no hay forma de pedir un fichero de
   * fuera de la carpeta.
   */
  app.get('/admin/local/media/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const datos = await leerMedia(mediaDir, id);
    if (!datos) return reply.code(404).send({ error: 'ese adjunto no existe' });

    return reply
      .type(tipoMime(id))
      // El contenido de un id nunca cambia -sale del wamid-, asi que se puede
      // cachear para siempre y no volver a pedirlo en cada scroll del chat.
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(datos);
  });

  /** Desvincula y borra las credenciales: obliga a escanear otra vez. */
  app.post('/admin/local/logout', async () => {
    await logoutLocal(authDir);
    return { ok: true };
  });
}
