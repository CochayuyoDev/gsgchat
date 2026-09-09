/**
 * Simular un mensaje entrante, para probar la conversacion de punta a punta.
 *
 * Los tests cubren el flujo como funcion pura, pero no cubren lo que pasa
 * cuando ese flujo atraviesa los repositorios, los gates, el sender y el
 * cliente de WhatsApp de verdad. Este endpoint mete un entrante por el mismo
 * sitio por el que lo mete el socket, asi que la respuesta sale por WhatsApp
 * como saldria con un cliente real.
 *
 * Va detras de una bandera propia (DEV_SIMULATE_INBOUND) y apagada por
 * defecto: un endpoint que finge mensajes de cualquier numero no tiene por que
 * existir en produccion, aunque este detras del token de admin.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { normalizePhone, type Repos } from '../db/repos.js';
import type { Sender } from '../outbound/sender.js';
import type { SettingsService } from '../settings/service.js';
import type { WhatsAppClient } from '../whatsapp/client.js';
import type { StokyClient } from '../stoky/client.js';
import { processChange, type WebhookDeps } from '../whatsapp/webhook.js';
import type { ChangeValue } from '../whatsapp/types.js';

export interface DevRoutesDeps {
  config: Config;
  catalogo?: StokyClient;
  repos: Repos;
  sender: Sender;
  wa: WhatsAppClient;
  settings: SettingsService;
}

const simularSchema = z.object({
  phone: z.string().min(6),
  text: z.string().max(4000).optional(),
  /** Ubicacion compartida, como la manda WhatsApp. */
  location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
  name: z.string().max(200).optional(),
});

export async function registerDevRoutes(app: FastifyInstance, deps: DevRoutesDeps): Promise<void> {
  const { config, repos, sender, wa, settings, catalogo } = deps;
  if (!config.DEV_SIMULATE_INBOUND) return;

  const webhookDeps: WebhookDeps = { repos, config, sender, wa, settings, catalogo };

  /**
   * Mete un entrante como si lo hubiera mandado ese numero.
   *
   * Sin deduplicacion a proposito: cada llamada es un mensaje nuevo, que es lo
   * que hace falta para encadenar los turnos de una conversacion de prueba.
   */
  app.post('/admin/dev/inbound', async (request) => {
    const body = simularSchema.parse(request.body);
    const phone = normalizePhone(body.phone);
    const id = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const value: ChangeValue = {
      messaging_product: 'whatsapp',
      contacts: [{ wa_id: phone, profile: { name: body.name ?? '' } }],
      messages: [
        body.location
          ? {
              id,
              from: phone,
              timestamp: String(Math.floor(Date.now() / 1000)),
              type: 'location',
              location: { latitude: body.location.latitude, longitude: body.location.longitude },
            }
          : {
              id,
              from: phone,
              timestamp: String(Math.floor(Date.now() / 1000)),
              type: 'text',
              text: { body: body.text ?? '' },
            },
      ],
    };

    await processChange('messages', value, webhookDeps);

    // Lo que quedo en la ficha despues del turno: es lo que se quiere ver al
    // encadenar escenarios sin abrir la pantalla.
    const contact = await repos.contacts.getByPhone(phone);
    return {
      ok: true,
      lead: contact ? await repos.leads.get(contact.id) : null,
    };
  });

  /** Deja la ficha del numero como recien llegada, para repetir un escenario. */
  app.post('/admin/dev/reset', async (request) => {
    const body = z.object({ phone: z.string().min(6) }).parse(request.body);
    const contact = await repos.contacts.getByPhone(normalizePhone(body.phone));
    if (!contact) return { ok: true, reset: false };

    await repos.leads.update(contact.id, {
      estado: 'nuevo',
      preguntaPendiente: null,
      ultimasOpciones: null,
      recojoDistrito: null,
      recojoLat: null,
      recojoLng: null,
      entregaDistrito: null,
      entregaLat: null,
      entregaLng: null,
      contenido: null,
      servicio: null,
      cuando: null,
      intentosFallidos: 0,
      nombre: null,
      documentoNumero: null,
    });
    return { ok: true, reset: true };
  });
}
