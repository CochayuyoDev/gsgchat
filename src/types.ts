/**
 * Tipos publicos del geo core.
 *
 * Regla de oro del modulo: nunca devolvemos una coordenada "pelada".
 * Siempre viaja acompanada de su origen (`source`) y su confianza
 * (`confidence`), porque `@lat,lng` de Google es el centro de la camara
 * y NO la posicion del lugar. Quien consuma el resultado debe poder
 * decidir si pide confirmacion al usuario.
 */

/** De donde salio la coordenada, en orden aproximado de fiabilidad. */
export type CoordSource =
  | 'whatsapp_native' // mensaje nativo de ubicacion: no hay parsing de por medio
  | 'data_3d4d' // !3d/!4d dentro de /data= : coordenada real del place
  | 'path_coords' // /maps/place/19.4,-99.1/ : coords en el path
  | 'query_param' // ?q= ?query= ?destination= ?daddr=
  | 'll_param' // ?ll= ?sll= ?center= ?coordinate=
  | 'geo_uri' // geo:19.4,-99.1
  | 'osm_hash' // #map=15/19.4/-99.1
  | 'dms' // 19 grados 25' 57.4" N
  | 'plus_code' // 76F2XCJ8+9M (Open Location Code completo)
  | 'at_viewport' // @lat,lng,17z : centro del viewport, ultimo recurso
  | 'bare_text'; // "19.4326, -99.1332" suelto en el texto

export type Confidence = 'exact' | 'high' | 'medium' | 'low';

export type FailureReason =
  | 'no_input'
  | 'no_coordinates_found'
  | 'out_of_range'
  | 'null_island'
  | 'outside_bbox'
  | 'short_link_unresolved';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface ExtractionSuccess extends Coordinates {
  ok: true;
  source: CoordSource;
  confidence: Confidence;
  /** Precision implicita por numero de decimales, en metros. */
  precisionMeters: number;
  /** URL que finalmente se parseo (tras resolver acortadores). */
  resolvedUrl?: string;
  /** URL original detectada en el texto de entrada. */
  originalUrl?: string;
  /** Enlace canonico listo para reenviar por WhatsApp. */
  mapsUrl: string;
  warnings: string[];
  /** true si el llamador deberia pedir confirmacion antes de operar. */
  needsConfirmation: boolean;
}

export interface ExtractionFailure {
  ok: false;
  reason: FailureReason;
  warnings: string[];
  resolvedUrl?: string;
  originalUrl?: string;
}

export type ExtractionResult = ExtractionSuccess | ExtractionFailure;

/** Caja delimitadora opcional para descartar parseos absurdos. */
export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface ExtractOptions {
  /** Resolver acortadores (maps.app.goo.gl) haciendo peticion HTTP. Default true. */
  resolveShortLinks?: boolean;
  /** Timeout por salto de redireccion, en ms. Default 5000. */
  timeoutMs?: number;
  /** Maximo de redirecciones a seguir. Default 5. */
  maxRedirects?: number;
  /** Si se define, se rechazan coordenadas fuera de esta caja. */
  bbox?: BoundingBox;
  /** Inyectable para tests: sustituye a fetch global. */
  fetchImpl?: typeof fetch;
}

/** Candidato crudo emitido por un parser, antes de validar. */
export interface RawCandidate {
  latRaw: string;
  lngRaw: string;
  source: CoordSource;
  confidence: Confidence;
  warning?: string;
  /** Precision propia del formato (plus code, DMS); si falta se deduce de los decimales. */
  precisionMeters?: number;
}
