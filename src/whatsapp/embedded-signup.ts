/**
 * Conexion en una ventana, sin pegar tokens: el "registro incorporado"
 * (Embedded Signup) de Meta.
 *
 * Es lo mas parecido al codigo QR de WhatsApp Web que permite la via oficial.
 * NO existe un QR para la Cloud API: el QR es como se conecta un TELEFONO a
 * WhatsApp Web, y para usarlo desde un servidor hay que emular ese cliente
 * (Baileys, whatsapp-web.js), que esta fuera de los terminos y termina con el
 * numero baneado. Aqui el usuario pulsa un boton, se abre la ventana de Meta,
 * entra con su cuenta, elige (o crea) su numero y vuelve conectado.
 *
 * Lo que devuelve la ventana es un `code` de un solo uso. Este modulo lo
 * cambia por un token de negocio permanente:
 *
 *   GET /oauth/access_token?client_id&client_secret&code
 *
 * El id de la cuenta y del numero los manda la propia ventana en su mensaje,
 * asi que no hace falta ni descubrirlos.
 */

const GRAPH = 'https://graph.facebook.com';

export interface ExchangeInput {
  appId: string;
  appSecret: string;
  code: string;
  graphVersion?: string;
  fetchImpl?: typeof fetch;
}

export class SignupError extends Error {
  constructor(
    message: string,
    readonly step: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'SignupError';
  }
}

/**
 * Cambia el codigo de la ventana por el token de negocio.
 *
 * El token que sale de aqui no caduca mientras la empresa no revoque el
 * acceso, que es justo lo que hace falta para un sistema que manda mensajes
 * a diario.
 */
export async function exchangeCode(input: ExchangeInput): Promise<{ token: string }> {
  const { appId, appSecret, code, graphVersion = 'v21.0', fetchImpl = fetch } = input;

  const url =
    `${GRAPH}/${graphVersion}/oauth/access_token` +
    `?client_id=${encodeURIComponent(appId)}` +
    `&client_secret=${encodeURIComponent(appSecret)}` +
    `&code=${encodeURIComponent(code)}`;

  let response: Response;
  try {
    response = await fetchImpl(url, { method: 'GET' });
  } catch (error) {
    throw new SignupError(
      error instanceof Error ? error.message : 'no se pudo contactar con Meta',
      'canjear el codigo',
    );
  }

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    const error = (payload.error ?? {}) as { message?: string; code?: number };
    throw new SignupError(error.message ?? `HTTP ${response.status}`, 'canjear el codigo', error.code);
  }

  const token = payload.access_token;
  if (typeof token !== 'string' || !token) {
    throw new SignupError('Meta no devolvio ningun token', 'canjear el codigo');
  }
  return { token };
}

/**
 * Comprueba que la app tenga configurado el registro incorporado.
 *
 * `config_id` sale del panel de Meta (WhatsApp -> Configuracion -> Registro
 * incorporado). Sin el, el boton abriria una ventana que no sabe que pedir.
 */
export function signupAvailability(credentials: { appId: string; signupConfigId: string }): {
  ready: boolean;
  missing: string[];
} {
  const missing = [
    !credentials.appId && 'el id de la app',
    !credentials.signupConfigId && 'el id de la configuracion de registro incorporado',
  ].filter(Boolean) as string[];
  return { ready: missing.length === 0, missing };
}
