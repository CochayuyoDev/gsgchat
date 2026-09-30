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
import { needsResolution, resolveShortLink } from './resolve.js';
import { precisionFromDecimals, validate } from './validate.js';

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const GEO_URI_RE = /\bgeo:-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?[^\s<>"']*/i;

/** Enlace canonico para reenviar por WhatsApp. */
export function canonicalMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

function firstUrl(text: string): URL | null {
  const matches = text.match(URL_RE) ?? [];
  for (const match of matches) {
    // Los chats suelen dejar puntuacion pegada al final del enlace.
    const cleaned = match.replace(/[.,;:)\]}>]+$/, '');
    const withScheme = cleaned.startsWith('www.') ? `https://${cleaned}` : cleaned;
    try {
      return new URL(withScheme);
    } catch {
      continue;
    }
  }
  return null;
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
): ExtractionResult | null {
  const lat = Number.parseFloat(candidate.latRaw);
  const lng = Number.parseFloat(candidate.lngRaw);

  const check = validate(lat, lng, bbox);
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
): ExtractionResult {
  const rejected: { reason?: FailureReason; warnings: string[] } = { warnings: [] };

  for (const parser of PARSERS) {
    const candidate = parser(target);
    if (!candidate) continue;
    const result = buildResult(candidate, ctx, bbox, rejected);
    if (result) return result;
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

  return runParsers({ decoded, url }, { originalUrl: url?.toString(), warnings: [] }, opts.bbox);
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

  const result = runParsers(
    { decoded, url: effectiveUrl },
    { originalUrl: url?.toString(), resolvedUrl, warnings },
    opts.bbox,
  );

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
