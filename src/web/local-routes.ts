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
import type { Config } from '../config.js';
import type { Repos } from '../db/repos.js';
import type { Sender } from '../outbound/sender.js';
import type { SettingsService } from '../settings/service.js';
import type { WhatsAppClient } from '../whatsapp/client.js';
import { createSeenCache, processChange, type WebhookDeps } from '../whatsapp/webhook.js';
import {
  defaultAuthDir,
  getLocalState,
  logoutLocal,
  requestLocalPairingCode,
  startLocal,
} from '../whatsapp/local/session.js';

export interface LocalRoutesDeps {
  config: Config;
  repos: Repos;
  sender: Sender;
  wa: WhatsAppClient;
  settings: SettingsService;
}

const codeSchema = z.object({
  phone: z.string().trim().min(6, 'hace falta el numero con codigo de pais'),
});

export async function registerLocalRoutes(
  app: FastifyInstance,
  deps: LocalRoutesDeps,
): Promise<void> {
  const { config, repos, sender, wa, settings } = deps;
  const authDir = defaultAuthDir();

  // Los entrantes van por el mismo sitio que los de Meta y los de WAHA: aqui
  // no hay webhook que firmar, pero si la misma deduplicacion por id.
  const webhookDeps: WebhookDeps = { repos, config, sender, wa, settings, seen: createSeenCache() };

  async function arrancar() {
    return startLocal({
      authDir,
      log: (mensaje) => app.log.info(mensaje),
      onChange: async (value) => {
        try {
          await processChange('messages', value, webhookDeps);
        } catch (error) {
          app.log.error({ err: error }, 'fallo procesando un mensaje local');
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

  /** Desvincula y borra las credenciales: obliga a escanear otra vez. */
  app.post('/admin/local/logout', async () => {
    await logoutLocal(authDir);
    return { ok: true };
  });
}
