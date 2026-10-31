/**
 * Parsers de coordenadas, uno por formato.
 *
 * Cada parser devuelve sus candidatos (todos los que encuentra, en orden de
 * preferencia) o ninguno. El orden en `PARSERS` ES la politica del modulo:
 * primero lo que apunta al lugar real, al final lo que solo describe la
 * camara o el texto suelto. Es el orden de GSG (gmaps_coords.php, 26/10) y de
 * la app Android (CoordinatesExtractorImpl.kt):
 *
 *   1 !3d!4d (pin del lugar, el ultimo)   7 ?coordinate=        (Apple iOS 18+)
 *   2 ?query=  (boton Compartir)          8 ?to=ll.             (Waze)
 *   3 ?q= / ?q=loc:                       9 ?center=            (embeds)
 *   4 ?destination=                      10 geo:                (Android)
 *   5 ?daddr=  (Apple, Maps clasico)     11 /lat,lng en /maps/dir/, /maps/search/ o /maps/place/ (el ultimo)
 *   6 ?ll=     (Apple, Waze)             12 @lat,lng            (centro de la camara: ultimo recurso)
 *
 * Entre medias van los formatos que GSGchat ya leia y GSG no (OpenStreetMap,
 * grados-minutos-segundos, Plus Codes) y, al final de todo, un par suelto en el
 * texto. Dentro de un patron se prueban TODAS sus coincidencias: si la
 * preferida cae fuera de la zona, la siguiente del mismo patron va antes que un
 * patron menos preciso (ver runParsers en extract.ts).
 *
 * Los patrones de la query se buscan sobre el texto tal cual y decodificado:
 * hay enlaces con `%2C` en vez de coma, o la URL entera codificada
 * (`maps%3Fq%3D…`). El separador puede ser `,` o `,+` (Google escribe
 * `lat,+lng` al compartir una busqueda).
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
/** El par de una query: `lat,lng`, `lat,+lng` o `lat, lng`. */
const PAR = String.raw`(${NUM})\s*,\+?\s*(${NUM})`;

/**
 * Los textos donde buscar: la URL detectada tal cual y decodificada, y el
 * texto entero (que ya viene decodificado). Sin repetir.
 */
function textos({ decoded, url }: ParseTarget): string[] {
  const salida = new Set<string>();
  if (url) {
    salida.add(url.toString());
    salida.add(safeDecode(url.toString()));
  }
  salida.add(decoded);
  return [...salida];
}

/** Todas las coincidencias de `re` (con la bandera g) en esos textos, sin repetir pares. */
function pares(target: ParseTarget, re: RegExp): Array<[string, string]> {
  const vistos = new Set<string>();
  const salida: Array<[string, string]> = [];
  for (const t of textos(target)) {
    for (const m of t.matchAll(re)) {
      const clave = `${m[1]},${m[2]}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      salida.push([m[1]!, m[2]!]);
    }
  }
  return salida;
}

/** Un parser de query: `?clave=lat,lng` (o `&clave=`), todas las coincidencias en orden. */
function deQuery(clave: string, opciones: { loc?: boolean; source?: RawCandidate['source']; warning?: string } = {}) {
  const re = new RegExp(String.raw`[?&]${clave}=${opciones.loc ? '(?:loc:)?' : ''}${PAR}`, 'gi');
  // En un `geo:` el `?q=` es la misma coordenada: la lee parseGeoUri con su fuente.
  return (target: ParseTarget): RawCandidate[] =>
    target.url?.protocol === 'geo:' ? [] : pares(target, re).map(([latRaw, lngRaw]) => ({
      latRaw,
      lngRaw,
      source: opciones.source ?? 'query_param',
      confidence: 'high',
      ...(opciones.warning ? { warning: opciones.warning } : {}),
    }));
}

/**
 * 1. `!3d<lat>!4d<lng>`: el pin del lugar compartido, el dato bueno. El bloque
 * canonico `!8m2!3d!4d` del place va primero; despues, el ultimo par (en una
 * ruta hay uno por parada y el ultimo es el destino) y luego los anteriores.
 */
function parseData3d4d(target: ParseTarget): RawCandidate[] {
  const todos = pares(target, new RegExp(String.raw`!3d(${NUM})!4d(${NUM})`, 'g'));
  if (!todos.length) return [];
  const canonico = pares(target, new RegExp(String.raw`!8m2!3d(${NUM})!4d(${NUM})`, 'g'))[0];
  const orden = [...(canonico ? [canonico] : []), ...todos.reverse().filter((p) => !canonico || p[0] !== canonico[0] || p[1] !== canonico[1])];
  const warning = todos.length > 1 ? 'la URL tiene varios waypoints, se tomo el ultimo' : undefined;
  return orden.map(([latRaw, lngRaw]) => ({ latRaw, lngRaw, source: 'data_3d4d', confidence: 'high', ...(warning ? { warning } : {}) }));
}

/** Mapa incrustado: `/maps/embed?pb=...!2d<lng>!3d<lat>` (aqui el orden es longitud, latitud). */
function parseEmbed(target: ParseTarget): RawCandidate[] {
  return pares(target, new RegExp(String.raw`!1d[\d.]+!2d(${NUM})!3d(${NUM})`, 'g')).map(([lngRaw, latRaw]) => ({ latRaw, lngRaw, source: 'data_3d4d', confidence: 'high' }));
}

/** 8. Waze live-map: `?to=ll.<lat>,<lng>`. */
function parseWazeTo(target: ParseTarget): RawCandidate[] {
  return pares(target, new RegExp(String.raw`[?&]to=ll\.${PAR}`, 'gi')).map(([latRaw, lngRaw]) => ({ latRaw, lngRaw, source: 'll_param', confidence: 'high' }));
}

/** 10. Intent de Android: `geo:<lat>,<lng>`. */
function parseGeoUri(target: ParseTarget): RawCandidate[] {
  return pares(target, new RegExp(String.raw`geo:${PAR}`, 'gi')).map(([latRaw, lngRaw]) => ({ latRaw, lngRaw, source: 'geo_uri', confidence: 'high' }));
}

/**
 * 11. `/lat,lng` en el path, SOLO en `/maps/dir/`, `/maps/search/` o
 * `/maps/place/`: el destino de «cómo llegar» y la forma a la que resuelven
 * los enlaces cortos. Sin esa condicion, cualquier `/12.34,-56.78/` del path
 * pasaria por destino. Va antes del `@`: en un /maps/dir/ el `@` es el
 * centro del recorrido, a kilometros del cliente. Gana el ultimo par.
 */
function parsePathCoords(target: ParseTarget): RawCandidate[] {
  const candidatos: Array<[string, string]> = [];
  for (const t of textos(target)) {
    const ruta = t.split(/[?#]/)[0] ?? '';
    if (!/\/maps\/(dir|search|place)\//i.test(ruta)) continue;
    for (const m of ruta.matchAll(new RegExp(String.raw`/(${NUM})\s*,\+?\s*(${NUM})(?=/|$)`, 'g'))) candidatos.push([m[1]!, m[2]!]);
  }
  const vistos = new Set<string>();
  return candidatos
    .reverse()
    .filter(([a, b]) => (vistos.has(`${a},${b}`) ? false : (vistos.add(`${a},${b}`), true)))
    .map(([latRaw, lngRaw]) => ({ latRaw, lngRaw, source: 'path_coords', confidence: 'high' }));
}

/** OpenStreetMap con lat y lng en parametros separados (`?mlat=&mlon=`). */
function parseOsmMarker({ url }: ParseTarget): RawCandidate[] {
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return [];
  const mlat = url.searchParams.get('mlat');
  const mlon = url.searchParams.get('mlon');
  return mlat && mlon ? [{ latRaw: mlat, lngRaw: mlon, source: 'll_param', confidence: 'high' }] : [];
}

/** Fragmento de OpenStreetMap: `#map=15/19.4326/-99.1332`. */
function parseOsmHash({ decoded }: ParseTarget): RawCandidate[] {
  const m = new RegExp(String.raw`#map=[\d.]+/(${NUM})/(${NUM})`, 'i').exec(decoded);
  return m ? [{ latRaw: m[1]!, lngRaw: m[2]!, source: 'osm_hash', confidence: 'high' }] : [];
}

function parseDmsCandidate({ decoded }: ParseTarget): RawCandidate[] {
  const dms = parseDms(decoded);
  if (!dms) return [];
  // Un segundo de arco son ~31 m; con decimas de segundo bajamos a ~3 m.
  return [{ latRaw: dms.lat.toFixed(7), lngRaw: dms.lng.toFixed(7), source: 'dms', confidence: 'high', precisionMeters: 3 }];
}

function parsePlusCodeCandidate({ decoded }: ParseTarget): RawCandidate[] {
  const code = findPlusCode(decoded);
  if (!code) return [];
  const point = decodePlusCode(code);
  if (!point) return [];
  const significant = code.replace('+', '').replace(/0+$/, '').length;
  const precisionMeters = significant >= 11 ? 3 : significant >= 10 ? 14 : 275;
  return [{ latRaw: point.lat.toFixed(7), lngRaw: point.lng.toFixed(7), source: 'plus_code', confidence: significant >= 10 ? 'medium' : 'low', precisionMeters }];
}

/**
 * 12. `@lat,lng,17z`: el centro de la camara. Ultimo recurso: si el usuario
 * arrastro el mapa antes de compartir, apunta a cuadras del sitio.
 */
function parseAtViewport(target: ParseTarget): RawCandidate[] {
  return pares(target, new RegExp(String.raw`@(${NUM}),(${NUM})`, 'g')).map(([latRaw, lngRaw]) => ({
    latRaw,
    lngRaw,
    source: 'at_viewport',
    confidence: 'low',
    warning: 'coordenada tomada del centro del mapa, no del lugar: confirmar con el usuario',
  }));
}

/** Par pegado a pelo en el chat: "19.4326, -99.1332". */
function parseBareText({ decoded }: ParseTarget): RawCandidate[] {
  const re = /(?:^|[\s(>:=])(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})(?=$|[\s)<.,;]|$)/;
  const m = re.exec(decoded);
  return m ? [{ latRaw: m[1]!, lngRaw: m[2]!, source: 'bare_text', confidence: 'medium' }] : [];
}

export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Orden de prioridad. Cambiarlo cambia la politica del extractor (ver la cabecera). */
export const PARSERS: Array<(t: ParseTarget) => RawCandidate[]> = [
  parseData3d4d, //                                   1
  parseEmbed,
  deQuery('query'), //                                2
  deQuery('q', { loc: true }), //                     3
  deQuery('destination'), //                          4
  deQuery('daddr'), //                                5
  deQuery('address'),
  deQuery('ll', { source: 'll_param' }), //           6
  deQuery('sll', { source: 'll_param' }),
  deQuery('coordinate', { source: 'll_param' }), //   7
  parseWazeTo, //                                     8
  deQuery('center', { source: 'll_param' }), //       9
  deQuery('latlng', { source: 'll_param' }),
  deQuery('point', { source: 'll_param' }),
  deQuery('viewpoint', { source: 'll_param' }),
  parseGeoUri, //                                    10
  parsePathCoords, //                                11
  parseOsmMarker,
  parseOsmHash,
  parseDmsCandidate,
  parsePlusCodeCandidate,
  // El origen de una ruta solo si no hay nada mejor, y avisando.
  deQuery('saddr', { warning: 'la coordenada es el ORIGEN de la ruta, no el destino' }),
  parseAtViewport, //                                12
  parseBareText,
];
