/**
 * «Nuestra API» → Webhook de WhatsApp Business API: lo que GSG pega en el panel
 * de Meta (URL y verify token), el app secret con el que se comprueba cada
 * aviso, si Meta ya verifico, lo ultimo que llego y una prueba de punta a
 * punta que llama al webhook de verdad (con la cabecera de prueba, para que
 * no cuente como si fuera Meta).
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { signPayload } from '../whatsapp/signature.js';
import { CABECERA_PRUEBA_WEBHOOK } from '../whatsapp/webhook.js';
import { CAMPOS_WEBHOOK_META, type ServicioWebhookMeta } from '../whatsapp/webhook-meta.js';
import type { SettingsService } from '../settings/service.js';
import { providerOf } from '../settings/service.js';

export interface WebhookMetaRoutesDeps {
  webhookMeta: ServicioWebhookMeta;
  settings: SettingsService;
  /** La direccion publica del sistema (PUBLIC_BASE_URL). */
  publicBase: string;
}

const guardarSchema = z.object({
  verifyToken: z.string().trim().max(200).optional(),
  appSecret: z.string().trim().max(300).optional(),
  quitarAppSecret: z.boolean().optional(),
});

const soloAdmin = (request: FastifyRequest) => !request.usuario || (request.usuario.rol === 'admin' && !request.usuario.porToken);

export async function registerWebhookMetaRoutes(app: FastifyInstance, deps: WebhookMetaRoutesDeps): Promise<void> {
  const { webhookMeta, settings } = deps;
  const url = () => `${deps.publicBase.replace(/\/+$/, '')}/webhooks/whatsapp`;

  function vista() {
    const c = webhookMeta.config();
    const setup = settings.current();
    const estado = webhookMeta.estado();
    return {
      url: url(),
      // El verify token lo tiene que copiar quien configura Meta: se enseña entero (solo a un administrador).
      verifyToken: c.verifyToken,
      conAppSecret: Boolean(c.appSecret),
      appSecretFinal: c.appSecret ? c.appSecret.slice(-4) : '',
      // Lo de /setup tambien vale: si alli ya hay app secret de Meta, el webhook funciona aunque aqui no haya.
      setup: {
        proveedor: providerOf(setup),
        conAppSecret: Boolean(setup.appSecret) && providerOf(setup) === 'cloud',
      },
      campos: CAMPOS_WEBHOOK_META,
      estado,
      // Verde: Meta verifico y hay con que comprobar la firma.
      listo: Boolean(estado.verificadoEn) && (Boolean(c.appSecret) || (Boolean(setup.appSecret) && providerOf(setup) === 'cloud')),
      eventos: webhookMeta.eventos(),
      publicoHttps: /^https:\/\//i.test(deps.publicBase),
    };
  }

  app.get('/admin/webhook-meta', async (request, reply) => {
    if (!soloAdmin(request)) return reply.code(403).send({ error: 'Solo un administrador ve la configuración del webhook de Meta.' });
    return vista();
  });

  app.post('/admin/webhook-meta', async (request, reply) => {
    if (!soloAdmin(request)) return reply.code(403).send({ error: 'Solo un administrador cambia el webhook de Meta.' });
    const body = guardarSchema.parse(request.body ?? {});
    if (body.verifyToken !== undefined && body.verifyToken !== '' && !/^[\x21-\x7e]{8,200}$/.test(body.verifyToken)) {
      return reply.code(400).send({ error: 'El verify token debe tener al menos 8 caracteres, sin espacios ni tildes.', codigo: 'verify_token' });
    }
    if (body.appSecret && !/^[a-f0-9]{32}$/i.test(body.appSecret)) {
      return reply.code(400).send({ error: 'Eso no parece la clave secreta de la app: en Meta son 32 letras y números (Configuración de la app → Básica → Clave secreta de la app).', codigo: 'app_secret' });
    }
    await webhookMeta.guardar({ verifyToken: body.verifyToken, appSecret: body.quitarAppSecret ? null : body.appSecret });
    return { ok: true, ...vista() };
  });

  /** Un verify token nuevo, guardado. Meta tendra que verificar otra vez. */
  app.post('/admin/webhook-meta/generar-token', async (request, reply) => {
    if (!soloAdmin(request)) return reply.code(403).send({ error: 'Solo un administrador cambia el webhook de Meta.' });
    await webhookMeta.guardar({ verifyToken: webhookMeta.generarVerifyToken() });
    return { ok: true, ...vista() };
  });

  /**
   * Prueba de punta a punta contra el webhook real de este servidor: el
   * apreton de manos con el verify token guardado y un aviso firmado con el
   * app secret guardado (vacio: no toca a ningun cliente).
   */
  app.post('/admin/webhook-meta/probar', async (request, reply) => {
    if (!soloAdmin(request)) return reply.code(403).send({ error: 'Solo un administrador prueba el webhook de Meta.' });
    const c = webhookMeta.config();
    const setup = settings.current();
    const token = c.verifyToken || setup.verifyToken;
    const secreto = c.appSecret || (providerOf(setup) === 'cloud' ? setup.appSecret : '');
    const pasos: Array<{ paso: string; ok: boolean; detalle: string }> = [];

    if (!token) {
      pasos.push({ paso: 'Verificación de Meta', ok: false, detalle: 'Falta el verify token: genera uno o escríbelo.' });
    } else {
      const reto = String(Date.now());
      const r = await app.inject({
        method: 'GET',
        url: `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=${reto}`,
        headers: { [CABECERA_PRUEBA_WEBHOOK]: '1' },
      });
      const ok = r.statusCode === 200 && r.body === reto;
      pasos.push({ paso: 'Verificación de Meta', ok, detalle: ok ? 'El webhook contesta el reto con el verify token guardado.' : `El webhook respondió ${r.statusCode}.` });
    }

    if (!secreto) {
      pasos.push({ paso: 'Aviso firmado', ok: false, detalle: 'Falta la clave secreta de la app (App secret): sin ella se rechaza todo lo que mande Meta.' });
    } else {
      const cuerpo = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'prueba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp' } }] }] });
      const r = await app.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
        payload: cuerpo,
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': signPayload(Buffer.from(cuerpo), secreto), [CABECERA_PRUEBA_WEBHOOK]: '1' },
      });
      const ok = r.statusCode === 200;
      pasos.push({ paso: 'Aviso firmado', ok, detalle: ok ? 'Un aviso firmado con el app secret guardado se acepta.' : `El webhook respondió ${r.statusCode}.` });
    }

    if (!/^https:\/\//i.test(deps.publicBase)) {
      pasos.push({ paso: 'Dirección pública', ok: false, detalle: `Meta solo llama a direcciones https. Esta instalación se presenta como ${deps.publicBase}.` });
    } else {
      pasos.push({ paso: 'Dirección pública', ok: true, detalle: `Meta debe llamar a ${url()}.` });
    }
    return { ok: pasos.every((p) => p.ok), pasos, ...vista() };
  });
}
