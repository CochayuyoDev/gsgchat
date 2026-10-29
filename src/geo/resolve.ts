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
  // Como GSG (26/10): hasta 15 saltos y 8 s por peticion.
  const { timeoutMs = 8000, maxRedirects = 15, fetchImpl = fetch } = opts;

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

/** Lo que se lee como mucho de la pagina: un cuerpo de varios MB puede reventar el regex y parecer «sin coordenadas». */
export const TOPE_PAGINA = 256 * 1024;

const cacheEnlaces = new TtlCache<string[]>();

/**
 * Los enlaces de Google Maps que hay DENTRO de la pagina a la que lleva un
 * enlace (la de consentimiento, la de «continuar a Maps» o la de un lugar
 * compartido como direccion), en el orden en que aparecen. Nunca el HTML
 * entero como coordenada: trae decenas de pines de negocios cercanos. Dentro
 * del HTML las URLs van escapadas para JSON (`https:\/\/…`, `=`): se
 * desescapan antes de buscar. Cada salto se valida contra la lista de hosts.
 */
export async function enlacesDeLaPagina(input: string, opts: ResolveOptions = {}): Promise<string[]> {
  const { timeoutMs = 8000, maxRedirects = 15, fetchImpl = fetch } = opts;
  const guardado = cacheEnlaces.get(input);
  if (guardado) return guardado;
  let current: URL;
  try {
    current = new URL(input);
  } catch {
    return [];
  }
  let cuerpo = '';
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (current.protocol !== 'https:' || current.username || current.password || !isAllowedHost(current.hostname)) return [];
    await assertPublicHost(current.hostname);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          'accept-language': 'es-PE,es;q=0.9',
        },
      });
      const location = response.headers.get('location');
      if (location) {
        current = new URL(location, current);
        continue;
      }
      cuerpo = await leerHasta(response, TOPE_PAGINA);
    } finally {
      clearTimeout(timer);
    }
    break;
  }
  const limpio = cuerpo
    .replace(/\\\//g, '/')
    .replace(/\\u003d/gi, '=')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/g, '&');
  const vistos = new Set<string>();
  const enlaces: string[] = [];
  for (const m of limpio.matchAll(/https?:\/\/(?:www\.)?(?:google\.[a-z.]{2,6}\/maps|maps\.google\.[a-z.]{2,6})[^\s"'<>\\]*/gi)) {
    const enlace = m[0];
    if (vistos.has(enlace)) continue;
    vistos.add(enlace);
    enlaces.push(enlace);
    if (enlaces.length >= 50) break;
  }
  cacheEnlaces.set(input, enlaces);
  return enlaces;
}

/** El cuerpo de la respuesta, cortado en `tope` bytes (sin leer el resto). */
async function leerHasta(response: Response, tope: number): Promise<string> {
  if (!response.body) return (await response.text()).slice(0, tope);
  const lector = response.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < tope) {
      const { done, value } = await lector.read();
      if (done || !value) break;
      partes.push(value);
      total += value.length;
    }
  } finally {
    await lector.cancel().catch(() => undefined);
  }
  const todo = new Uint8Array(Math.min(total, tope));
  let i = 0;
  for (const p of partes) {
    const cabe = Math.min(p.length, todo.length - i);
    todo.set(p.subarray(0, cabe), i);
    i += cabe;
    if (i >= todo.length) break;
  }
  return new TextDecoder().decode(todo);
}
