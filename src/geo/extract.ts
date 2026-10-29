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
import { precisionFromDecimals, validate } from './validate.js';

const URL_RE = /\b(?:https?:\/\/|www\.|(?:maps\.app\.)?goo\.gl\/|maps\.google\.[a-z.]{2,6}\/)[^\s<>"']+/gi;
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

function firstUrl(text: string): URL | null {
  return urlsDe(text)[0] ?? null;
}

/**
 * Los enlaces de mapa (Google Maps, Waze, Apple Maps, OpenStreetMap) que hay
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
  const decoded = [safeDecode(input), url ? safeDecode(url.toString()) : '']
    .filter(Boolean)
    .join('\n');

  return runParsers({ decoded, url }, { originalUrl: url?.toString(), warnings: [] }, opts.bbox, opts.pais);
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
 * La direccion que trae un enlace de lugar compartido (?q= o ?query=) cuando no
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
  const texto = (u.searchParams.get('q') ?? u.searchParams.get('query') ?? '').trim();
  if (!texto || texto.length > 200 || !/[a-záéíóúñ]{3}/i.test(texto) || !/\d/.test(texto)) return null;
  if (/^-?\d{1,3}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?$/.test(texto)) return null;
  return texto;
}
