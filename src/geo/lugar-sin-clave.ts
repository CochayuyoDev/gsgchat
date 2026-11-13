/**
 * Un lugar compartido por su nombre, ubicado SIN clave de Google (pedido del
 * dueño, 13/11).
 *
 * El iPhone comparte un negocio como `maps.app.goo.gl/…` → `maps.google.com/?q=
 * <nombre, dirección>&ftid=0x…:0x…`: ni coordenadas ni place_id, y la página de
 * Google no trae el punto (lo carga después con JavaScript). Lo que hace la web
 * de Google Maps por dentro es una búsqueda (`/search?tbm=map&q=…`) que devuelve
 * cada lugar con su punto y su `ftid`: `[null,null,<lat>,<lng>],"0x…:0x…"`.
 *
 * No es una API oficial: Google puede cambiar el formato sin avisar. Por eso
 * solo se acepta el punto que viene pegado al MISMO `ftid` del enlace (el mismo
 * negocio, no uno parecido), y si algo no cuadra se devuelve null: el cliente
 * recibe el «mándame tu pin» de siempre. Probado con el enlace real del 13/11
 * (Bodega Heidi & Adrian → -12.015631, -77.0805262).
 */

import { TtlCache } from '../util/cache.js';
import { assertPublicHost } from '../util/net-guard.js';
import type { Coordinates } from '../types.js';

/** Lo que se lee como mucho de la respuesta (la real pesa ~16 KB). */
const TOPE = 512 * 1024;

/** Lo encontrado (o que no se encontró), por ftid: un mismo negocio se pregunta una vez al día. */
const cache = new TtlCache<Coordinates | null>(24 * 60 * 60 * 1000, 2000);

export function limpiarCacheLugarSinClave(): void {
  cache.clear();
}

export const esFtid = (v: string): boolean => /^0x[0-9a-f]{1,16}:0x[0-9a-f]{1,16}$/i.test(v);

export interface OpcionesLugarSinClave {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Las cookies de «ya acepté» de Google. Sin ellas, a un servidor en Europa (o a
 * uno que Google no conoce) la búsqueda lo manda a la pantalla de cookies
 * (consent.google.com) y no hay punto que leer. En una PC de Perú no hacen falta.
 */
const COOKIES_CONSENTIMIENTO = 'CONSENT=YES+cb.20240101-00-p0.es+FX+000; SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVzIAEaBgiA_LyaBg';

/** El resultado con su motivo cuando no sale: va a los avisos del enlace y al registro del servidor. */
export interface ResultadoLugarSinClave {
  punto: Coordinates | null;
  /** Por qué no salió (null si salió): Google mandó a otra página, un captcha, cambió el formato, sin red… */
  motivo: string | null;
}

/**
 * El punto del lugar `ftid` buscando `texto` (su nombre y dirección, tal como
 * venía en el enlace) en la búsqueda de Google Maps. null si no aparece ESE
 * lugar, si no hay red o si la respuesta no tiene el formato esperado.
 */
export async function buscarLugarSinClave(texto: string, ftid: string, opts: OpcionesLugarSinClave = {}): Promise<Coordinates | null> {
  return (await buscarLugarSinClaveConMotivo(texto, ftid, opts)).punto;
}

/** Igual, pero diciendo por qué no salió: sin esto un fallo en el servidor no deja rastro. */
export async function buscarLugarSinClaveConMotivo(texto: string, ftid: string, opts: OpcionesLugarSinClave = {}): Promise<ResultadoLugarSinClave> {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  if (!limpio || limpio.length > 200 || !esFtid(ftid)) return { punto: null, motivo: 'el enlace no trae un nombre o un ftid válido' };
  const clave = ftid.toLowerCase();
  const guardado = cache.get(clave);
  if (guardado !== undefined) return { punto: guardado, motivo: guardado ? null : 'Google ya dijo antes que ese lugar no aparece (se recuerda un día)' };

  const { timeoutMs = 8000, fetchImpl = fetch } = opts;
  const url = new URL('https://www.google.com/search');
  url.search = new URLSearchParams({ tbm: 'map', hl: 'es', gl: 'pe', q: limpio }).toString();
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), timeoutMs);
  let cuerpo: string;
  try {
    await assertPublicHost(url.hostname);
    const r = await fetchImpl(url.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal: control.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'accept-language': 'es-PE,es;q=0.9',
        cookie: COOKIES_CONSENTIMIENTO,
      },
    });
    // Un captcha o un redirect (consentimiento): no se sabe, y no se recuerda.
    if (r.status !== 200) {
      const destino = r.headers.get('location') ?? '';
      const motivo = /consent\./i.test(destino)
        ? 'Google mandó a la pantalla de cookies (consent)'
        : /\/sorry\//i.test(destino) || r.status === 429
          ? 'Google pidió un captcha (demasiadas búsquedas desde este servidor)'
          : `Google respondió ${r.status}${destino ? ` → ${destino.slice(0, 80)}` : ''}`;
      return { punto: null, motivo };
    }
    cuerpo = (await r.text()).slice(0, TOPE);
  } catch (error) {
    return { punto: null, motivo: `no se pudo preguntar a Google: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    clearTimeout(reloj);
  }

  const punto = puntoDelLugar(cuerpo, ftid);
  // Solo se recuerda una respuesta con el formato esperado (empieza con `)]}'`):
  // un HTML de error no dice nada sobre el lugar.
  const formatoEsperado = cuerpo.startsWith(")]}'");
  if (punto || formatoEsperado) cache.set(clave, punto);
  if (punto) return { punto, motivo: null };
  return {
    punto: null,
    motivo: formatoEsperado
      ? 'la búsqueda de Google no trae ese lugar (su ftid no aparece)'
      : /captcha|unusual traffic|tráfico inusual/i.test(cuerpo)
        ? 'Google pidió un captcha (demasiadas búsquedas desde este servidor)'
        : 'Google respondió con un formato distinto al esperado (¿cambió su búsqueda?)',
  };
}

/**
 * En la respuesta de la búsqueda, el punto que va justo antes del `ftid`:
 * `[null,null,<lat>,<lng>],"<ftid>"`. Si ese lugar no aparece, null.
 */
export function puntoDelLugar(cuerpo: string, ftid: string): Coordinates | null {
  if (!esFtid(ftid)) return null;
  const re = new RegExp(String.raw`\[null,null,(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)\],"${ftid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'i');
  const m = re.exec(cuerpo);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  // Google devuelve -12.015630999999999: 7 decimales (~1 cm) bastan.
  return { lat: Math.round(lat * 1e7) / 1e7, lng: Math.round(lng * 1e7) / 1e7 };
}
