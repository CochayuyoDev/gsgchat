/**
 * Conectar una cuenta de WhatsApp sin ir a rellenar formularios a Meta.
 *
 * Antes habia que copiar cinco datos a mano (token, id del numero, id de la
 * cuenta de negocio, clave de la app y un token de verificacion inventado) y
 * ademas pegar la URL del webhook en el panel de Meta. Tres de esos cinco los
 * puede averiguar el propio sistema, y el webhook se puede registrar por API:
 *
 *   `GET /debug_token`      dice a que cuentas de negocio da acceso el token
 *   `GET /{waba}/phone_numbers`  lista los numeros de cada cuenta
 *   `POST /{app}/subscriptions`  registra la URL del webhook y su verify token
 *   `POST /{waba}/subscribed_apps` suscribe la app a la cuenta
 *
 * Asi quedan solo tres datos que unicamente puede dar el usuario: el token,
 * el id de la app y su clave secreta.
 *
 * Estas funciones viven fuera de `createWhatsAppClient` porque corren ANTES de
 * saber el numero y la cuenta: el cliente necesita esos dos para existir.
 */

const GRAPH = 'https://graph.facebook.com';

export interface OnboardingCredentials {
  token: string;
  appId: string;
  appSecret: string;
  graphVersion?: string;
  fetchImpl?: typeof fetch;
}

export class OnboardingError extends Error {
  constructor(
    message: string,
    /** Que paso fallo, para que la pantalla diga donde mirar. */
    readonly step: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'OnboardingError';
  }
}

async function call<T>(
  url: string,
  init: RequestInit,
  step: string,
  fetchImpl: typeof fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    throw new OnboardingError(
      error instanceof Error ? error.message : 'no se pudo contactar con Meta',
      step,
    );
  }

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    const error = (payload.error ?? {}) as { message?: string; code?: number };
    throw new OnboardingError(error.message ?? `HTTP ${response.status}`, step, error.code);
  }
  return payload as T;
}

export interface DiscoveredNumber {
  phoneNumberId: string;
  displayPhoneNumber: string;
  verifiedName: string;
  qualityRating: string;
  /** true si el numero todavia no esta registrado en la Cloud API. */
  needsRegistration: boolean;
  /** El numero sigue en la app de WhatsApp Business del celular (coexistencia): ya esta registrado. */
  enLaApp: boolean;
}

export interface DiscoveredAccount {
  businessAccountId: string;
  name: string;
  numbers: DiscoveredNumber[];
}

/**
 * Cuentas de negocio y numeros a los que llega el token.
 *
 * El truco esta en `debug_token`: con el app access token (`appId|appSecret`)
 * Meta describe el token del usuario, y en `granular_scopes` viene, para el
 * permiso `whatsapp_business_messaging`, la lista de WABA que autoriza.
 */
export async function discoverAccounts(
  credentials: OnboardingCredentials,
): Promise<DiscoveredAccount[]> {
  const { token, appId, appSecret, graphVersion = 'v25.0', fetchImpl = fetch } = credentials;
  const appToken = `${appId}|${appSecret}`;

  const debug = await call<{
    data?: {
      is_valid?: boolean;
      granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
      scopes?: string[];
    };
  }>(
    `${GRAPH}/${graphVersion}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(appToken)}`,
    { method: 'GET' },
    'revisar el token',
    fetchImpl,
  );

  if (!debug.data?.is_valid) {
    throw new OnboardingError(
      'el token no es valido para esta app: revisa que sea el de tu usuario del sistema y que la app sea la misma',
      'revisar el token',
    );
  }

  const scopes = debug.data.granular_scopes ?? [];
  const wabaIds = [
    ...new Set(
      scopes
        .filter((s) => s.scope.startsWith('whatsapp_business_'))
        .flatMap((s) => s.target_ids ?? []),
    ),
  ];

  if (!wabaIds.length) {
    const otorgados = (debug.data.scopes ?? []).join(', ') || 'ninguno';
    throw new OnboardingError(
      `el token no da acceso a ninguna cuenta de WhatsApp. Permisos que trae: ${otorgados}. Genera el token con whatsapp_business_messaging y whatsapp_business_management, y anade la cuenta como activo del usuario del sistema.`,
      'revisar el token',
    );
  }

  const accounts: DiscoveredAccount[] = [];
  for (const wabaId of wabaIds) {
    const info = await call<{ name?: string }>(
      `${GRAPH}/${graphVersion}/${wabaId}?fields=name`,
      { method: 'GET', headers: { authorization: `Bearer ${token}` } },
      'leer la cuenta de negocio',
      fetchImpl,
    );

    const numbers = await call<{
      data?: Array<{
        id: string;
        display_phone_number?: string;
        verified_name?: string;
        quality_rating?: string;
        status?: string;
        platform_type?: string;
        is_on_biz_app?: boolean;
      }>;
    }>(
      `${GRAPH}/${graphVersion}/${wabaId}/phone_numbers?fields=display_phone_number,verified_name,quality_rating,status,platform_type,is_on_biz_app`,
      { method: 'GET', headers: { authorization: `Bearer ${token}` } },
      'listar los numeros',
      fetchImpl,
    );

    accounts.push({
      businessAccountId: wabaId,
      name: info.name ?? wabaId,
      numbers: (numbers.data ?? []).map((n) => ({
        phoneNumberId: n.id,
        displayPhoneNumber: n.display_phone_number ?? '',
        verifiedName: n.verified_name ?? '',
        qualityRating: (n.quality_rating ?? 'NA').toUpperCase(),
        // CONNECTED es el numero ya registrado en la Cloud API; el resto
        // (PENDING, MIGRATED, FLAGGED...) necesita el paso del PIN. Un numero
        // que sigue en la app del celular (coexistencia) ya esta registrado:
        // Meta dice que se salte ese paso.
        needsRegistration: (n.status ?? '').toUpperCase() !== 'CONNECTED' && !n.is_on_biz_app,
        enLaApp: Boolean(n.is_on_biz_app),
      })),
    });
  }

  return accounts;
}

/**
 * Registra la URL del webhook en la app y suscribe los campos que hacen
 * falta. Es el paso que antes se hacia a mano en el panel de Meta.
 */
export async function registerWebhook(
  credentials: OnboardingCredentials & { callbackUrl: string; verifyToken: string },
): Promise<{ success: boolean }> {
  const {
    appId,
    appSecret,
    callbackUrl,
    verifyToken,
    graphVersion = 'v25.0',
    fetchImpl = fetch,
  } = credentials;

  const body = new URLSearchParams({
    object: 'whatsapp_business_account',
    callback_url: callbackUrl,
    verify_token: verifyToken,
    fields: [
      'messages',
      'message_template_status_update',
      'message_template_quality_update',
      'phone_number_quality_update',
    ].join(','),
    access_token: `${appId}|${appSecret}`,
  });

  const payload = await call<{ success?: boolean }>(
    `${GRAPH}/${graphVersion}/${appId}/subscriptions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
    'registrar el webhook',
    fetchImpl,
  );

  return { success: Boolean(payload.success) };
}

/** Una URL a la que Meta no puede llegar no sirve como webhook. */
export function isPubliclyReachable(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost')) return false;
    // Una IP privada tampoco: el webhook llega desde internet.
    if (/^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}
