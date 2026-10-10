/**
 * Resolucion de acortadores de mapas siguiendo los redirects a mano.
 *
 * A mano y no con `redirect: 'follow'` porque necesitamos inspeccionar
 * cada salto: comprobar que sigue siendo https y que la IP destino es
 * publica antes de pedirla.
 */

import { TtlCache } from '../util/cache.js';
import { assertPublicHost, isAllowedHost, isShortLinkHost } from '../util/net-guard.js';

const cache = new TtlCache<string>();

export interface ResolveOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  fetchImpl?: typeof fetch;
}

export function clearResolveCache(): void {
  cache.clear();
}

export function needsResolution(url: URL): boolean {
  return isShortLinkHost(url.hostname);
}

/**
 * Sigue la cadena de redirecciones y devuelve la URL final.
 * Si algo falla (timeout, host bloqueado, sin red) devuelve la URL de
 * entrada: el parser todavia puede sacar algo del texto original.
 */
export async function resolveShortLink(input: string, opts: ResolveOptions = {}): Promise<string> {
  const { timeoutMs = 5000, maxRedirects = 5, fetchImpl = fetch } = opts;

  const cached = cache.get(input);
  if (cached) return cached;

  let current: URL;
  try {
    current = new URL(input);
  } catch {
    return input;
  }

  if (current.protocol !== 'https:' || current.username || current.password || !isAllowedHost(current.hostname)) return input;

  for (let hop = 0; hop < maxRedirects; hop++) {
    if (current.protocol !== 'https:' || !isAllowedHost(current.hostname)) return input;
    await assertPublicHost(current.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          // Sin UA de navegador Google devuelve un interstitial sin coordenadas.
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          'accept-language': 'es-MX,es;q=0.9',
        },
      });
    } finally {
      clearTimeout(timer);
    }

    const location = response.headers.get('location');
    if (!location) {
      // Sin redirect: puede ser el HTML final con la coordenada dentro.
      const finalUrl = response.url || current.toString();
      cache.set(input, finalUrl);
      return finalUrl;
    }

    const next = new URL(location, current);
    if (next.protocol !== 'https:' || next.username || next.password || !isAllowedHost(next.hostname)) return input;
    await assertPublicHost(next.hostname);
    if (next.toString() === current.toString()) break;
    current = next;

    if (!needsResolution(current)) {
      cache.set(input, current.toString());
      return current.toString();
    }
  }

  const result = current.toString();
  cache.set(input, result);
  return result;
}
