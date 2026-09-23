/**
 * Cliente de la Cloud API que lee las credenciales vigentes en cada llamada.
 *
 * Sin esto, cambiar el token desde /setup obligaria a reiniciar el proceso:
 * el cliente se construye una vez al arrancar y se queda con los valores de
 * entonces. Aqui se reconstruye por llamada (son solo closures, no hay coste
 * real) y se falla con un mensaje util si todavia no hay credenciales.
 */

import { providerOf, type SettingsService } from '../settings/service.js';
import { createWhatsAppClient, WhatsAppApiError, type WhatsAppClient } from './client.js';
import { createLocalClient } from './local/client.js';
import type { SesionLocal } from './local/session.js';
import { createWahaClient } from './waha/client.js';

export class NotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(
      `WhatsApp no esta configurado todavia (faltan: ${missing.join(', ')}). Completalo en /setup.`,
    );
    this.name = 'NotConfiguredError';
  }
}

export interface DynamicClientDeps {
  /**
   * Cuerpo de una plantilla guardada. Solo lo usa WAHA, que no tiene
   * plantillas y las manda como texto ya sustituido; la Cloud API se apana
   * con el nombre. Se inyecta para no meter la base de datos aqui dentro.
   */
  resolveTemplateBody?: (name: string, language: string) => Promise<string | undefined>;
  /** Ver WHATSAPP_NATIVE_BUTTONS: apagado, una cuenta personal los entrega rotos. */
  nativeButtons?: boolean;
  /** Simular escritura con los clientes no oficiales. Ver src/salud/humano.ts. */
  humanizar?: boolean | (() => boolean);
  /** La sesion de WhatsApp de esta tienda (proveedor local). Ver src/plataforma. */
  sesion?: SesionLocal;
}

export function createDynamicWhatsAppClient(
  settings: SettingsService,
  deps: DynamicClientDeps = {},
): WhatsAppClient {
  function inner(): WhatsAppClient {
    const missing = settings.missing();
    if (missing.length) throw new NotConfiguredError(missing);

    const credentials = settings.current();

    if (providerOf(credentials) === 'local') {
      return createLocalClient({
        resolveTemplateBody: deps.resolveTemplateBody,
        nativeButtons: deps.nativeButtons,
        humanizar: deps.humanizar,
        sesion: deps.sesion,
      });
    }

    if (providerOf(credentials) === 'waha') {
      return createWahaClient({
        baseUrl: credentials.wahaUrl,
        apiKey: credentials.wahaApiKey || undefined,
        session: credentials.wahaSession || undefined,
        resolveTemplateBody: deps.resolveTemplateBody,
        humanizar: deps.humanizar,
      });
    }

    return createWhatsAppClient({
      token: credentials.token,
      phoneNumberId: credentials.phoneNumberId,
      businessAccountId: credentials.businessAccountId,
      graphVersion: credentials.graphVersion,
    });
  }

  // Los metodos son async a proposito: asi la falta de credenciales llega
  // como promesa rechazada y no como excepcion sincrona, que se escaparia
  // de cualquier .catch() del llamador.
  return {
    sendText: async (...args) => inner().sendText(...args),
    sendLocation: async (...args) => inner().sendLocation(...args),
    sendLocationRequest: async (...args) => inner().sendLocationRequest(...args),
    sendSticker: async (to, sticker) => {
      const cliente = inner();
      if (!cliente.sendSticker) throw new Error('este proveedor no manda stickers');
      return cliente.sendSticker(to, sticker);
    },
    sendMedia: async (to, media) => {
      const cliente = inner();
      if (!cliente.sendMedia) throw new Error('este proveedor no manda fotos ni archivos');
      return cliente.sendMedia(to, media);
    },
    sendButtons: async (...args) => inner().sendButtons(...args),
    sendTemplate: async (...args) => inner().sendTemplate(...args),
    markAsRead: async (...args) => inner().markAsRead(...args),
    // Los tres de abajo no los tienen todos los proveedores. El chat pregunta
    // antes con `capacidadesDelChat` y esconde lo que no se puede, asi que
    // llegar aqui sin soporte ya es un error de programacion: se dice claro.
    sendReaction: async (to, mensaje, emoji) => {
      const cliente = inner();
      if (!cliente.sendReaction) throw new Error('este proveedor no manda reacciones');
      return cliente.sendReaction(to, mensaje, emoji);
    },
    borrarParaTodos: async (to, mensaje) => {
      const cliente = inner();
      if (!cliente.borrarParaTodos) throw new Error('este proveedor no puede eliminar un mensaje para todos');
      return cliente.borrarParaTodos(to, mensaje);
    },
    editarMensaje: async (to, mensaje, texto) => {
      const cliente = inner();
      if (!cliente.editarMensaje) throw new Error('este proveedor no puede editar un mensaje ya enviado');
      return cliente.editarMensaje(to, mensaje, texto);
    },
    // Aqui no se falla: no saber si esta en linea no es un error, es no saberlo.
    presencia: async (to) => (await inner().presencia?.(to)) ?? null,
    // Sincrono a proposito: es una consulta de estado, no una llamada de red.
    // Sin credenciales o sin proveedor con sesion propia, no se sabe (undefined).
    conectado: () => {
      try {
        return inner().conectado?.();
      } catch {
        return undefined;
      }
    },
    // El de Meta no lo implementa: ahi se devuelve null, que significa "no se
    // puede saber", y quien pregunta decide seguir sin la comprobacion.
    tieneWhatsApp: async (phone) => (await inner().tieneWhatsApp?.(phone)) ?? null,
    getPhoneNumber: async () => inner().getPhoneNumber(),
    subscribeApp: async () => inner().subscribeApp(),
    listSubscribedApps: async () => inner().listSubscribedApps(),
    registerPhone: async (...args) => inner().registerPhone(...args),
    createTemplate: async (...args) => inner().createTemplate(...args),
    listTemplates: async () => inner().listTemplates(),
  };
}

export interface ConnectionCheck {
  ok: boolean;
  detail: string;
  displayName?: string;
  phoneNumber?: string;
  templates?: number;
}

/**
 * Prueba las credenciales contra la Graph API antes de darlas por buenas.
 * Guardar un token invalido y descubrirlo en el primer envio masivo es
 * exactamente lo que hay que evitar.
 */
export async function checkConnection(
  credentials: {
    token: string;
    phoneNumberId: string;
    businessAccountId: string;
    graphVersion: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectionCheck> {
  const { token, phoneNumberId, businessAccountId, graphVersion } = credentials;
  const missing = [
    !token && 'token',
    !phoneNumberId && 'phoneNumberId',
    !businessAccountId && 'businessAccountId',
  ].filter(Boolean) as string[];

  if (missing.length) return { ok: false, detail: `faltan datos: ${missing.join(', ')}` };

  try {
    const url = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`;
    const response = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
    const payload = (await response.json()) as {
      display_phone_number?: string;
      verified_name?: string;
      error?: { message?: string; code?: number };
    };

    if (!response.ok) {
      return {
        ok: false,
        detail: payload.error?.message ?? `HTTP ${response.status}`,
      };
    }

    const client = createWhatsAppClient({ token, phoneNumberId, businessAccountId, graphVersion });
    let templates: number | undefined;
    try {
      templates = (await client.listTemplates()).length;
    } catch (error) {
      // El numero responde pero la WABA no: casi siempre es el ID equivocado
      // o al token le falta whatsapp_business_management.
      return {
        ok: false,
        detail:
          error instanceof WhatsAppApiError
            ? `el numero responde pero la cuenta de negocio no: ${error.message}`
            : 'el numero responde pero no se pudo leer el catalogo de plantillas',
        displayName: payload.verified_name,
        phoneNumber: payload.display_phone_number,
      };
    }

    return {
      ok: true,
      detail: 'credenciales validas',
      displayName: payload.verified_name,
      phoneNumber: payload.display_phone_number,
      templates,
    };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'error de red' };
  }
}
