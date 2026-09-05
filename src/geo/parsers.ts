/**
 * Parsers de coordenadas, uno por formato.
 *
 * Cada parser devuelve un candidato crudo o null. El orden en `PARSERS`
 * ES la politica del modulo: primero las fuentes que apuntan al lugar real,
 * al final las que solo describen la camara o el texto suelto.
 */

import type { RawCandidate } from '../types.js';
import { parseDms } from './dms.js';
import { decodePlusCode, findPlusCode } from './pluscode.js';

export interface ParseTarget {
  /** Texto completo de entrada, ya decodificado. */
  decoded: string;
  /** URL detectada dentro del texto, si la hay. */
  url: URL | null;
}

const NUM = String.raw`-?\d+(?:\.\d+)?`;
const PAIR_RE = new RegExp(String.raw`^\s*(?:loc:)?(${NUM})\s*,\s*(${NUM})`);

function pairFromValue(value: string): [string, string] | null {
  const m = PAIR_RE.exec(value);
  return m ? [m[1]!, m[2]!] : null;
}

/**
 * Los parsers de path y query solo tienen sentido sobre URLs web. En un
 * `geo:` URI el path y el `?q=` ya son la coordenada, y de eso se encarga
 * parseGeoUri, que la etiqueta con la fuente correcta.
 */
function isWebUrl(url: URL | null): url is URL {
  return url !== null && (url.protocol === 'https:' || url.protocol === 'http:');
}

/**
 * `!3d<lat>!4d<lng>` dentro de `/data=`. Es la coordenada del place, la
 * unica que sobrevive a que el usuario mueva el mapa antes de compartir.
 */
function parseData3d4d({ decoded }: ParseTarget): RawCandidate | null {
  // `!8m2!3d!4d` es el bloque canonico del place en una URL de /maps/place/.
  const canonical = new RegExp(String.raw`!8m2!3d(${NUM})!4d(${NUM})`).exec(decoded);
  if (canonical) {
    return {
      latRaw: canonical[1]!,
      lngRaw: canonical[2]!,
      source: 'data_3d4d',
      confidence: 'high',
    };
  }

  // En rutas hay un !3d/!4d por waypoint: el ultimo es el destino.
  const all = [...decoded.matchAll(new RegExp(String.raw`!3d(${NUM})!4d(${NUM})`, 'g'))];
  const last = all.at(-1);
  if (!last) return null;

  return {
    latRaw: last[1]!,
    lngRaw: last[2]!,
    source: 'data_3d4d',
    confidence: 'high',
    warning: all.length > 1 ? 'la URL tiene varios waypoints, se tomo el ultimo' : undefined,
  };
}

/** `/maps/place/19.4326,-99.1332/` o cualquier segmento que sea un par. */
function parsePathCoords({ url }: ParseTarget): RawCandidate | null {
  if (!isWebUrl(url)) return null;
  for (const segment of url.pathname.split('/')) {
    const decodedSegment = safeDecode(segment);
    const pair = pairFromValue(decodedSegment);
    if (pair && /^\s*(?:loc:)?-?\d+\.\d+\s*,\s*-?\d+\.\d+\s*$/.test(decodedSegment)) {
      return { latRaw: pair[0], lngRaw: pair[1], source: 'path_coords', confidence: 'high' };
    }
  }
  return null;
}

const QUERY_KEYS = ['q', 'query', 'destination', 'daddr', 'address', 'saddr'];
const LL_KEYS = ['ll', 'sll', 'center', 'coordinate', 'latlng', 'point', 'viewpoint'];

function parseQueryParam({ url }: ParseTarget): RawCandidate | null {
  if (!isWebUrl(url)) return null;
  for (const key of QUERY_KEYS) {
    const value = url.searchParams.get(key);
    if (!value) continue;
    const pair = pairFromValue(value);
    if (pair) {
      return {
        latRaw: pair[0],
        lngRaw: pair[1],
        source: 'query_param',
        confidence: 'high',
        warning: key === 'saddr' ? 'la coordenada es el ORIGEN de la ruta, no el destino' : undefined,
      };
    }
  }
  return null;
}

function parseLlParam({ url }: ParseTarget): RawCandidate | null {
  if (!isWebUrl(url)) return null;

  // OpenStreetMap manda lat y lng en parametros separados.
  const mlat = url.searchParams.get('mlat');
  const mlon = url.searchParams.get('mlon');
  if (mlat && mlon) {
    return { latRaw: mlat, lngRaw: mlon, source: 'll_param', confidence: 'high' };
  }

  for (const key of LL_KEYS) {
    const value = url.searchParams.get(key);
    if (!value) continue;
    const pair = pairFromValue(value);
    if (pair) {
      return { latRaw: pair[0], lngRaw: pair[1], source: 'll_param', confidence: 'high' };
    }
  }
  return null;
}

function parseGeoUri({ decoded }: ParseTarget): RawCandidate | null {
  const m = new RegExp(String.raw`geo:(${NUM}),(${NUM})`, 'i').exec(decoded);
  if (!m) return null;
  return { latRaw: m[1]!, lngRaw: m[2]!, source: 'geo_uri', confidence: 'high' };
}

/** Fragmento de OpenStreetMap: `#map=15/19.4326/-99.1332`. */
function parseOsmHash({ decoded }: ParseTarget): RawCandidate | null {
  const m = new RegExp(String.raw`#map=[\d.]+/(${NUM})/(${NUM})`, 'i').exec(decoded);
  if (!m) return null;
  return { latRaw: m[1]!, lngRaw: m[2]!, source: 'osm_hash', confidence: 'high' };
}

function parseDmsCandidate({ decoded }: ParseTarget): RawCandidate | null {
  const dms = parseDms(decoded);
  if (!dms) return null;
  return {
    latRaw: dms.lat.toFixed(7),
    lngRaw: dms.lng.toFixed(7),
    source: 'dms',
    confidence: 'high',
    // Un segundo de arco son ~31 m; con decimas de segundo bajamos a ~3 m.
    precisionMeters: 3,
  };
}

function parsePlusCodeCandidate({ decoded }: ParseTarget): RawCandidate | null {
  const code = findPlusCode(decoded);
  if (!code) return null;
  const point = decodePlusCode(code);
  if (!point) return null;

  const significant = code.replace('+', '').replace(/0+$/, '').length;
  const precisionMeters = significant >= 11 ? 3 : significant >= 10 ? 14 : 275;

  return {
    latRaw: point.lat.toFixed(7),
    lngRaw: point.lng.toFixed(7),
    source: 'plus_code',
    confidence: significant >= 10 ? 'medium' : 'low',
    precisionMeters,
  };
}

/**
 * `@lat,lng,17z`. Deliberadamente el penultimo de la lista: es el centro
 * del viewport. Si el usuario arrastro el mapa antes de compartir, esto
 * apunta a cientos de metros del sitio que queria mandar.
 */
function parseAtViewport({ decoded }: ParseTarget): RawCandidate | null {
  const m = new RegExp(String.raw`@(${NUM}),(${NUM})(?:,[\d.]+[zmayht])?`).exec(decoded);
  if (!m) return null;
  return {
    latRaw: m[1]!,
    lngRaw: m[2]!,
    source: 'at_viewport',
    confidence: 'low',
    warning: 'coordenada tomada del centro del mapa, no del lugar: confirmar con el usuario',
  };
}

/** Par pegado a pelo en el chat: "19.4326, -99.1332". */
function parseBareText({ decoded }: ParseTarget): RawCandidate | null {
  const re = /(?:^|[\s(>:=])(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})(?=$|[\s)<.,;]|$)/;
  const m = re.exec(decoded);
  if (!m) return null;
  return { latRaw: m[1]!, lngRaw: m[2]!, source: 'bare_text', confidence: 'medium' };
}

export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Orden de prioridad. Cambiarlo cambia la politica del extractor. */
export const PARSERS: Array<(t: ParseTarget) => RawCandidate | null> = [
  parseData3d4d,
  parsePathCoords,
  parseQueryParam,
  parseLlParam,
  parseGeoUri,
  parseOsmHash,
  parseDmsCandidate,
  parsePlusCodeCandidate,
  parseAtViewport,
  parseBareText,
];
