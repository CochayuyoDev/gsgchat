/**
 * Conexion en una ventana, sin pegar tokens: el "registro incorporado"
 * (Embedded Signup) de Meta.
 *
 * Hay dos modos, y la diferencia entre ellos es la que le importa al usuario:
 * si su numero sigue funcionando en el movil o no. Ver `SignupMode`.
 *
 * En el modo de coexistencia la propia ventana de Meta enseña un codigo QR que
 * se escanea desde la app de WhatsApp Business. Es literalmente el QR que la
 * gente pide, y es oficial. Lo que sigue sin existir es un QR para conectar un
 * WhatsApp de consumidor (el verde): para eso habria que emular el cliente de
 * WhatsApp Web (Baileys, whatsapp-web.js), que esta fuera de los terminos y
 * termina con el numero baneado.
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

/**
 * Los dos modos de la ventana de Meta.
 *
 * - `coexistence`: el numero se queda en la app de WhatsApp Business del movil
 *   Y ademas habla por la API. El alta se hace escaneando un QR desde esa app,
 *   Meta sincroniza el historial y se puede seguir contestando a mano desde el
 *   telefono. Es lo que busca casi todo el que pide "el QR".
 * - `dedicated`: el numero pasa a ser solo de la API y deja de funcionar en la
 *   app del movil. Es el registro incorporado clasico, para un numero nuevo
 *   dedicado al sistema.
 *
 * El valor que espera Meta para la coexistencia es
 * `whatsapp_business_app_onboarding`. El `coexistence` que aparece en tutoriales
 * viejos ya no vale y hace que la ventana abra el flujo equivocado.
 */
export type SignupMode = 'coexistence' | 'dedicated';

export const SIGNUP_FEATURE_TYPE: Record<SignupMode, string> = {
  coexistence: 'whatsapp_business_app_onboarding',
  dedicated: '',
};

export interface SignupExtras {
  setup: Record<string, never>;
  featureType: string;
  sessionInfoVersion: string;
}

/** Lo que se le pasa a `FB.login` en `extras`. */
export function signupExtras(mode: SignupMode): SignupExtras {
  return {
    setup: {},
    featureType: SIGNUP_FEATURE_TYPE[mode] ?? '',
    sessionInfoVersion: '3',
  };
}
