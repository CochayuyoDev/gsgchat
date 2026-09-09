/**
 * Validacion de coordenadas ya parseadas.
 *
 * Un parser que se equivoca casi nunca devuelve basura evidente: devuelve
 * (0,0), o la lat y la lng cambiadas. Estos chequeos son los que evitan
 * mandar a alguien al Golfo de Guinea.
 */

import type { BoundingBox, FailureReason } from '../types.js';

export interface ValidationOk {
  ok: true;
  warnings: string[];
}

export interface ValidationError {
  ok: false;
  reason: FailureReason;
  warnings: string[];
}

export type ValidationResult = ValidationOk | ValidationError;

/** Metros por grado en el ecuador; sirve para traducir decimales a precision. */
const METERS_PER_DEGREE = 111_320;

const SWAPPED_WARNING = 'coordenadas posiblemente invertidas (lat/lng al reves)';

export function decimalsOf(raw: string): number {
  const dot = raw.indexOf('.');
  return dot === -1 ? 0 : raw.length - dot - 1;
}

export function precisionFromDecimals(latRaw: string, lngRaw: string): number {
  const decimals = Math.min(decimalsOf(latRaw), decimalsOf(lngRaw));
  return METERS_PER_DEGREE / 10 ** decimals;
}

export function validate(lat: number, lng: number, bbox?: BoundingBox): ValidationResult {
  const warnings: string[] = [];

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, reason: 'no_coordinates_found', warnings };
  }

  const inRange = (a: number, b: number) => a >= -90 && a <= 90 && b >= -180 && b <= 180;

  if (!inRange(lat, lng)) {
    // Una latitud de 99 casi siempre es una longitud puesta en el sitio
    // equivocado; decirlo ahorra media hora de depuracion.
    if (inRange(lng, lat)) warnings.push(SWAPPED_WARNING);
    return { ok: false, reason: 'out_of_range', warnings };
  }

  // Null Island: casi siempre es un parseo que fallo, no una coordenada real.
  if (Math.abs(lat) < 1e-9 && Math.abs(lng) < 1e-9) {
    return { ok: false, reason: 'null_island', warnings };
  }

  if (bbox) {
    const inside =
      lat >= bbox.minLat && lat <= bbox.maxLat && lng >= bbox.minLng && lng <= bbox.maxLng;
    if (!inside) {
      // Sospecha tipica: lat y lng invertidas.
      const swapped =
        lng >= bbox.minLat && lng <= bbox.maxLat && lat >= bbox.minLng && lat <= bbox.maxLng;
      if (swapped) warnings.push(SWAPPED_WARNING);
      return { ok: false, reason: 'outside_bbox', warnings };
    }
  }

  return { ok: true, warnings };
}

/** Caja de Mexico, util como bbox por defecto en operaciones locales. */
export const MEXICO_BBOX: BoundingBox = {
  minLat: 14.3,
  maxLat: 32.8,
  minLng: -118.5,
  maxLng: -86.5,
};

/**
 * Lima Metropolitana y la Provincia Constitucional del Callao.
 *
 * Los limites son los de la mancha urbana con holgura, no los politicos: de
 * Ancon por el norte a Pucusana por el sur, y de la isla San Lorenzo por el
 * oeste a Chosica por el este. Se prefiere pasarse a quedarse corto, porque un
 * falso rechazo se lo come el cliente que comparte su ubicacion y no entiende
 * por que no se la aceptan.
 */
export const LIMA_BBOX: BoundingBox = {
  minLat: -12.6,
  maxLat: -11.5,
  minLng: -77.3,
  maxLng: -76.5,
};
