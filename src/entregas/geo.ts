/**
 * Distancias sobre el mapa, para darle cada pedido al motorizado que esta
 * mas cerca. Haversine sobre la esfera: para Lima (decenas de km) el error
 * es de metros, y nadie elige motorizado por metros.
 */

const RADIO_TIERRA_KM = 6371;

export interface Punto {
  lat: number;
  lng: number;
}

const aRadianes = (grados: number): number => (grados * Math.PI) / 180;

/** Kilometros en linea recta entre dos puntos. */
export function haversineKm(a: Punto, b: Punto): number {
  const dLat = aRadianes(b.lat - a.lat);
  const dLng = aRadianes(b.lng - a.lng);
  const seno = Math.sin(dLat / 2) ** 2 + Math.cos(aRadianes(a.lat)) * Math.cos(aRadianes(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_KM * Math.asin(Math.min(1, Math.sqrt(seno)));
}

/** "ahí mismo", "a 800 m", "a 2,3 km": para la pantalla. */
export function distanciaEnPalabras(km: number): string {
  if (km < 0.05) return 'ahí mismo';
  if (km < 1) return `a ${Math.round(km * 1000)} m`;
  return `a ${km.toFixed(1).replace('.', ',')} km`;
}
