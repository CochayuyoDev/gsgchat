/**
 * Orquestador del geo core.
 *
 * Entra texto libre (lo que el cliente escribio en WhatsApp) y sale una
 * coordenada anotada con su origen y su confianza, o un fallo explicito.
 * Nunca lanza por culpa de la entrada: un mensaje raro produce
 * `{ ok: false }`, no una excepcion que tumbe el worker.
 */

import type {
  ExtractOptions,
  ExtractionResult,
  FailureReason,
  RawCandidate,
} from '../types.js';
import { PARSERS, safeDecode, type ParseTarget } from './parsers.js';
import { enlacesDeLaPagina, needsResolution, resolveShortLink } from './resolve.js';
import { isAllowedHost } from '../util/net-guard.js';
import { buscarLugarSinClave, esFtid } from './lugar-sin-clave.js';
import { precisionFromDecimals, validate } from './validate.js';

const URL_RE = /\b(?:https?:\/\/|www\.|(?:maps\.app\.)?goo\.gl\/|maps\.google\.[a-z.]{2,6}\/|google\.[a-z.]{2,6}\/maps|maps\.apple\.com\/|(?:ul\.)?waze\.com\/)[^\s<>"']+/gi;
const GEO_URI_RE = /\bgeo:-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?[^\s<>"']*/i;

/** Enlace canonico para reenviar por WhatsApp. */
export function canonicalMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/** Las URLs del texto, limpias: `&amp;` como `&`, sin la puntuacion pegada al final y con esquema. */
function urlsDe(text: string): URL[] {
  const salida: URL[] = [];
  for (const match of text.replace(/&amp;/g, '&').match(URL_RE) ?? []) {
    // Los chats suelen dejar puntuacion pegada al final del enlace.
    const cleaned = match.replace(/[.,;:!?)\]}>]+$/, '');
    // Escrito a mano, sin esquema: `maps.app.goo.gl/xxx` o `www.google.com/maps…`.
    const withScheme = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
    try {
      salida.push(new URL(withScheme));
    } catch {
      continue;
    }
  }
  return salida;
}

/** El primer enlace de Google Maps, Apple Maps o Waze del texto: cualquier otro se ignora. */
function firstUrl(text: string): URL | null {
  return urlsDe(text).find((u) => isAllowedHost(u.hostname)) ?? null;
}

/**
 * Los enlaces de mapa (Google Maps, Waze, Apple Maps) que hay
 * en un mensaje, sin repetir. Lo que no es de un mapa no cuenta, ni un
 * enlace con usuario y contraseña o con un puerto que no sea el de https.
 * Sirve para saber si el cliente mando UN enlace (se lee) o varios distintos
 * (no se elige uno: se le pide el pin).
 */
export function enlacesDeMapa(text: string): string[] {
  const vistos = new Set<string>();
  for (const url of urlsDe(text ?? '')) {
    if (url.username || url.password || (url.port && url.port !== '443')) continue;
    if (!isAllowedHost(url.hostname)) continue;
    // `google.com` a secas es un buscador: solo cuenta si es de Maps.
    if (/^(?:www\.)?google\./i.test(url.hostname) && !/^\/maps/i.test(url.pathname)) continue;
    vistos.add(url.toString());
  }
  return [...vistos];
}

function matchGeoUri(input: string): URL | null {
  const m = GEO_URI_RE.exec(input);
  if (!m) return null;
  try {
    return new URL(m[0]);
  } catch {
    return null;
  }
}

interface ExtractContext {
  originalUrl?: string;
  resolvedUrl?: string;
  warnings: string[];
}

function buildResult(
  candidate: RawCandidate,
  ctx: ExtractContext,
  bbox: ExtractOptions['bbox'],
  rejected: { reason?: FailureReason; warnings: string[] },
  pais?: ExtractOptions['pais'],
): ExtractionResult | null {
  const lat = Number.parseFloat(candidate.latRaw);
  const lng = Number.parseFloat(candidate.lngRaw);

  // Primero el pais: el regex pesca numeros de cualquier parte de la URL (ids,
  // zoom, analitica), y un par que parezca coordenada pero caiga en Nueva York
  // se descarta en vez de mandarse como la casa del cliente. Despues, la zona.
  const enPais = pais ? validate(lat, lng, pais) : null;
  const check = enPais && !enPais.ok ? enPais : validate(lat, lng, bbox);
  if (!check.ok) {
    // No cortamos aqui: puede haber otro parser mas abajo con una lectura buena.
    // Nos quedamos con el motivo del PRIMER rechazo, que es el del candidato
    // de mayor prioridad y por tanto el que mejor explica el fallo.
    rejected.reason ??= check.reason;
    rejected.warnings.push(...check.warnings);
    return null;
  }

  const precisionMeters =
    candidate.precisionMeters ?? precisionFromDecimals(candidate.latRaw, candidate.lngRaw);

  const warnings = [...ctx.warnings, ...check.warnings];
  if (candidate.warning) warnings.push(candidate.warning);
  if (precisionMeters > 100) {
    warnings.push(`precision baja: ~${Math.round(precisionMeters)} m por numero de decimales`);
  }

  return {
    ok: true,
    lat,
    lng,
    source: candidate.source,
    confidence: candidate.confidence,
    precisionMeters,
    originalUrl: ctx.originalUrl,
    resolvedUrl: ctx.resolvedUrl,
    mapsUrl: canonicalMapsUrl(lat, lng),
    warnings,
    needsConfirmation: candidate.confidence === 'low' || precisionMeters > 100,
  };
}

function runParsers(
  target: ParseTarget,
  ctx: ExtractContext,
  bbox: ExtractOptions['bbox'],
  pais?: ExtractOptions['pais'],
): ExtractionResult {
  const rejected: { reason?: FailureReason; warnings: string[] } = { warnings: [] };

  // Todas las coincidencias de un patron antes de bajar al siguiente: si la
  // preferida cae fuera, otra del mismo patron es mas precisa que el `@`.
  for (const parser of PARSERS) {
    for (const candidate of parser(target)) {
      const result = buildResult(candidate, ctx, bbox, rejected, pais);
      if (result) return result;
    }
  }

  return {
    ok: false,
    reason: rejected.reason ?? 'no_coordinates_found',
    warnings: [...ctx.warnings, ...rejected.warnings],
    originalUrl: ctx.originalUrl,
    resolvedUrl: ctx.resolvedUrl,
  };
}

/** Version sin red: no resuelve acortadores. Util en tests y en el hot path. */
export function extractLocationSync(input: string, opts: ExtractOptions = {}): ExtractionResult {
  if (!input || !input.trim()) {
    return { ok: false, reason: 'no_input', warnings: [] };
  }

  const url = firstUrl(input) ?? matchGeoUri(input);
  if (!url) return { ok: false, reason: 'no_coordinates_found', warnings: [] };
  const decoded = [safeDecode(input), safeDecode(url.toString())]
    .filter(Boolean)
    .join('\n');

  return runParsers({ decoded, url }, { originalUrl: url.toString(), warnings: [] }, opts.bbox, opts.pais);
}

/**
 * Extraccion completa: resuelve acortadores (`maps.app.goo.gl`) antes de
 * parsear. Es la que debe usar el webhook.
 */
export async function extractLocation(
  input: string,
  opts: ExtractOptions = {},
): Promise<ExtractionResult> {
  if (!input || !input.trim()) {
    return { ok: false, reason: 'no_input', warnings: [] };
  }

  const url = firstUrl(input) ?? matchGeoUri(input);
  if (!url) return { ok: false, reason: 'no_coordinates_found', warnings: [] };
  const warnings: string[] = [];
  let resolvedUrl: string | undefined;
  let effectiveUrl = url;

  const shouldResolve = opts.resolveShortLinks !== false;
  if (url && shouldResolve && needsResolution(url)) {
    try {
      const resolved = await resolveShortLink(url.toString(), {
        timeoutMs: opts.timeoutMs,
        maxRedirects: opts.maxRedirects,
        fetchImpl: opts.fetchImpl,
      });
      if (resolved !== url.toString()) {
        resolvedUrl = resolved;
        effectiveUrl = new URL(resolved);
      } else {
        warnings.push('el acortador no devolvio una URL con coordenadas');
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'error desconocido';
      warnings.push(`no se pudo resolver el enlace corto: ${detail}`);
    }
  }

  const decoded = [safeDecode(input), resolvedUrl ? safeDecode(resolvedUrl) : '']
    .filter(Boolean)
    .join('\n');

  let result = runParsers(
    { decoded, url: effectiveUrl },
    { originalUrl: url?.toString(), resolvedUrl, warnings },
    opts.bbox,
    opts.pais,
  );

  // La URL final no trae coordenadas (una pagina de consentimiento o de
  // «continuar a Maps», o un lugar compartido como direccion): se miran los
  // enlaces de Google Maps que hay DENTRO de esa pagina, uno por uno y en
  // orden. Nunca el HTML entero: trae decenas de pines de negocios cercanos.
  if (!result.ok && url && shouldResolve && needsResolution(url)) {
    const paginaUrl = resolvedUrl ?? url.toString();
    const enlaces = await enlacesDeLaPagina(paginaUrl, { timeoutMs: opts.timeoutMs, maxRedirects: opts.maxRedirects, fetchImpl: opts.fetchImpl }).catch(() => [] as string[]);
    for (const enlace of enlaces) {
      // Las imagenes del mapa (staticmap) llevan el centro de la vista por defecto,
      // no el lugar: con ellas el motorizado iria a otro sitio. Fuera.
      if (/\/maps\/api\//i.test(enlace)) continue;
      let dentro: URL | null = null;
      try {
        dentro = new URL(enlace);
      } catch {
        continue;
      }
      const deEste = runParsers(
        { decoded: safeDecode(enlace), url: dentro },
        { originalUrl: url.toString(), resolvedUrl: resolvedUrl ?? enlace, warnings: [...warnings, 'coordenada sacada de un enlace de Maps dentro de la página del enlace corto'] },
        opts.bbox,
        opts.pais,
      );
      // Solo lo que apunta a un lugar: ni el centro de un mapa (`center=`) ni la camara (`@`).
      if (deEste.ok && (deEste.source === 'data_3d4d' || deEste.source === 'query_param' || deEste.source === 'path_coords')) {
        result = deEste;
        break;
      }
    }
  }

  // El enlace es un lugar de Google sin coordenadas (la ficha de un negocio,
  // una busqueda): solo trae su place_id. Google dice donde esta. Tambien
  // cuando solo se tenia la camara (`@`): el lugar es el dato bueno.
  if ((!result.ok || result.source === 'at_viewport') && opts.porLugar) {
    const placeId = placeIdDelEnlace([resolvedUrl, url.toString()]);
    const punto = placeId ? await opts.porLugar(placeId).catch(() => null) : null;
    if (punto && Number.isFinite(punto.lat) && Number.isFinite(punto.lng)) {
      // Como cualquier otro punto: primero el pais, despues la zona que se cubre.
      const enPais = opts.pais ? validate(punto.lat, punto.lng, opts.pais) : null;
      const check = enPais && !enPais.ok ? enPais : validate(punto.lat, punto.lng, opts.bbox);
      if (check.ok) {
        result = {
          ok: true,
          lat: punto.lat,
          lng: punto.lng,
          source: 'place_id',
          confidence: 'high',
          precisionMeters: 30,
          originalUrl: url.toString(),
          resolvedUrl,
          mapsUrl: canonicalMapsUrl(punto.lat, punto.lng),
          warnings: [...warnings, ...check.warnings, `lugar de Google del enlace (place_id ${placeId}) ubicado en el mapa`],
          needsConfirmation: false,
        };
      } else if (!result.ok) {
        result = { ...result, reason: check.reason, warnings: [...result.warnings, ...check.warnings] };
      }
    }
  }

  // Un lugar compartido por su nombre (el iPhone manda `?q=<nombre, direccion>&ftid=0x…`):
  // ni coordenadas ni place_id, y la pagina de Google no trae el punto (lo carga
  // despues con JavaScript). Se busca por ese nombre: con la clave de Google si
  // la tienda la tiene (Places API) y, si no, como lo hace la web de Google Maps
  // por dentro, aceptando solo el punto de ESE lugar (su mismo ftid). Va antes
  // que la direccion: el nombre del negocio lo encuentra mejor que «Mz D1 Lt 15».
  const lugar = !result.ok || result.source === 'at_viewport' ? lugarDelEnlace([resolvedUrl, url.toString()]) : null;
  if (lugar) {
    const texto = lugar.texto;
    let punto = opts.porLugarConNombre ? await opts.porLugarConNombre(texto).catch(() => null) : null;
    let como = 'por su nombre en Google';
    // En las pruebas, nunca contra el Google real: solo con un fetch falso.
    const sinClave = opts.buscarLugarSinClave ?? !(process.env.VITEST && !opts.fetchImpl);
    if (!punto && shouldResolve && sinClave) {
      punto = await buscarLugarSinClave(texto, lugar.ftid, { timeoutMs: opts.timeoutMs, fetchImpl: opts.fetchImpl }).catch(() => null);
      como = 'en la búsqueda de Google Maps, sin clave';
    }
    if (punto && Number.isFinite(punto.lat) && Number.isFinite(punto.lng)) {
      const enPais = opts.pais ? validate(punto.lat, punto.lng, opts.pais) : null;
      const check = enPais && !enPais.ok ? enPais : validate(punto.lat, punto.lng, opts.bbox);
      if (check.ok) {
        result = {
          ok: true,
          lat: punto.lat,
          lng: punto.lng,
          source: 'place_search',
          confidence: 'high',
          precisionMeters: 30,
          originalUrl: url.toString(),
          resolvedUrl,
          mapsUrl: canonicalMapsUrl(punto.lat, punto.lng),
          warnings: [...warnings, ...check.warnings, `lugar del enlace encontrado ${como}: ${texto}`],
          needsConfirmation: false,
        };
      } else if (!result.ok) {
        result = { ...result, reason: check.reason, warnings: [...result.warnings, ...check.warnings] };
      }
    }
  }

  // El enlace es un lugar compartido como direccion (?q=Av. Jorge Chavez 865,
  // Santiago de Surco), sin coordenadas: se busca esa direccion en el mapa.
  // Solo vale si quien busca la encuentra con seguridad (pedido del dueño, 29/10).
  if (!result.ok && opts.porDireccion) {
    const direccion = direccionDelEnlace(resolvedUrl ?? url?.toString());
    const punto = direccion ? await opts.porDireccion(direccion).catch(() => null) : null;
    if (punto && Number.isFinite(punto.lat) && Number.isFinite(punto.lng) && (!opts.pais || dentroDe(punto, opts.pais)) && (!opts.bbox || dentroDe(punto, opts.bbox))) {
      result = {
        ok: true,
        lat: punto.lat,
        lng: punto.lng,
        source: 'address_geocoded',
        confidence: 'high',
        precisionMeters: 30,
        originalUrl: url?.toString(),
        resolvedUrl,
        mapsUrl: canonicalMapsUrl(punto.lat, punto.lng),
        warnings: [...warnings, `direccion del enlace encontrada en el mapa: ${direccion}`],
        needsConfirmation: false,
      };
    }
  }

  // Un acortador que no se pudo abrir merece un motivo mas util que "no encontre nada".
  if (!result.ok && url && needsResolution(url) && !resolvedUrl) {
    return { ...result, reason: 'short_link_unresolved' };
  }
  return result;
}

/** Payload de ubicacion tal como llega en el webhook de la Cloud API. */
export interface WhatsAppLocation {
  latitude: number | string;
  longitude: number | string;
  name?: string;
  address?: string;
}

/**
 * Camino barato: si el cliente uso el boton de adjuntar ubicacion no hay
 * nada que parsear. Siempre preferir esto a pedirle que pegue un link.
 */
export function fromWhatsAppLocation(
  location: WhatsAppLocation,
  opts: ExtractOptions = {},
): ExtractionResult {
  const lat =
    typeof location.latitude === 'string'
      ? Number.parseFloat(location.latitude)
      : location.latitude;
  const lng =
    typeof location.longitude === 'string'
      ? Number.parseFloat(location.longitude)
      : location.longitude;

  const check = validate(lat, lng, opts.bbox);
  if (!check.ok) {
    return { ok: false, reason: check.reason, warnings: check.warnings };
  }

  return {
    ok: true,
    lat,
    lng,
    source: 'whatsapp_native',
    confidence: 'exact',
    precisionMeters: 5,
    mapsUrl: canonicalMapsUrl(lat, lng),
    warnings: check.warnings,
    needsConfirmation: false,
  };
}

const dentroDe = (p: { lat: number; lng: number }, caja: { minLat: number; maxLat: number; minLng: number; maxLng: number }): boolean =>
  p.lat >= caja.minLat && p.lat <= caja.maxLat && p.lng >= caja.minLng && p.lng <= caja.maxLng;

/**
 * La direccion que trae un enlace de lugar compartido o de «como llegar»
 * (?destination=, ?daddr=, ?query= o ?q=, en ese orden, como GSG) cuando no
 * son coordenadas: «Av. Jorge Chávez 865, Santiago de Surco 15049». Tiene que
 * llevar un numero (de puerta): «Miraflores» a secas no es una direccion.
 */
export function direccionDelEnlace(enlace: string | undefined): string | null {
  if (!enlace) return null;
  let u: URL;
  try {
    u = new URL(enlace);
  } catch {
    return null;
  }
  if (!/(^|\.)google\.[a-z.]+$|^maps\.app\.goo\.gl$|^goo\.gl$/i.test(u.hostname)) return null;
  const texto = (['destination', 'daddr', 'query', 'q'].map((k) => u.searchParams.get(k)?.trim()).find(Boolean) ?? '');
  if (!texto || /^place_id:/i.test(texto) || texto.length > 200 || !/[a-záéíóúñ]{3}/i.test(texto) || !/\d/.test(texto)) return null;
  if (/^-?\d{1,3}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?$/.test(texto)) return null;
  return texto;
}

/**
 * El nombre del lugar de un enlace compartido como lugar de Google: el `?q=`
 * (o `?query=`) de un enlace que trae `ftid=0x…:0x…`, la marca de Google de
 * que es un lugar concreto (un negocio, una casa marcada) y no una busqueda
 * suelta. Sin `ftid` no se busca por nombre: «Miraflores» no es un lugar.
 */
export function lugarConNombreDelEnlace(enlaces: Array<string | undefined>): string | null {
  return lugarDelEnlace(enlaces)?.texto ?? null;
}

/** El nombre del lugar (`?q=`) y su marca de Google (`ftid`), o null si el enlace no es un lugar. */
export function lugarDelEnlace(enlaces: Array<string | undefined>): { texto: string; ftid: string } | null {
  for (const enlace of enlaces) {
    if (!enlace) continue;
    let u: URL;
    try {
      u = new URL(enlace);
    } catch {
      continue;
    }
    if (!/(^|\.)google\.[a-z.]+$/i.test(u.hostname)) continue;
    const ftid = (u.searchParams.get('ftid') ?? '').trim();
    if (!esFtid(ftid)) continue;
    const texto = (u.searchParams.get('q') ?? u.searchParams.get('query') ?? '').replace(/\s+/g, ' ').trim();
    if (!texto || texto.length > 200 || !/[a-záéíóúñ]{3}/i.test(texto) || /^place_id:/i.test(texto)) continue;
    if (/^-?\d{1,3}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?$/.test(texto)) continue;
    return { texto, ftid };
  }
  return null;
}

/** Un place_id de Google: letras, numeros, `_` y `-` (ChIJ..., GhIJ..., Ei...). */
const PLACE_ID = /^[A-Za-z0-9_-]{10,400}$/;

/**
 * El place_id de un enlace de Google Maps que no trae coordenadas, en el
 * orden de GSG (mapsLink.js): `query_place_id=`, `destination_place_id=`,
 * `place_id=`; luego `place_id:XXXX` dentro de `destination`, `daddr`,
 * `query` o `q`; y al final `!1sChIJ...` dentro del `data=` (los `!1s0x...`
 * son otro identificador y no sirven). Solo enlaces de Google.
 */
export function placeIdDelEnlace(enlaces: Array<string | undefined>): string | null {
  for (const enlace of enlaces) {
    if (!enlace) continue;
    let u: URL;
    try {
      u = new URL(enlace);
    } catch {
      continue;
    }
    if (!/(^|\.)google\.[a-z.]+$|^maps\.app\.goo\.gl$|^goo\.gl$/i.test(u.hostname)) continue;
    for (const k of ['query_place_id', 'destination_place_id', 'place_id']) {
      const v = u.searchParams.get(k)?.trim();
      if (v && PLACE_ID.test(v)) return v;
    }
    for (const k of ['destination', 'daddr', 'query', 'q']) {
      const m = /^place_id:([A-Za-z0-9_-]+)$/i.exec(u.searchParams.get(k)?.trim() ?? '');
      if (m && PLACE_ID.test(m[1]!)) return m[1]!;
    }
    const enData = /!1s(ChIJ[A-Za-z0-9_-]+)/.exec(safeDecode(u.toString()));
    if (enData && PLACE_ID.test(enData[1]!)) return enData[1]!;
  }
  return null;
}
