/**
 * Dónde queda cada distrito de Lima y Callao, más o menos (pedido del dueño,
 * 25/09: «el pin tiene que tener sentido»).
 *
 * Para cada uno, un punto de referencia (el centro aproximado) y un radio
 * aproximado en km: Surco o San Juan de Lurigancho son enormes, Lince o La
 * Punta caben en un par de km. La distancia de un pin «al distrito» es la que
 * queda FUERA de ese radio: un pin en el borde de Surco no está lejos de
 * Surco aunque esté a 4 km de su centro.
 *
 * Son números aproximados escritos a mano: nada de APIs de pago ni llamadas
 * externas. Sirven para darse cuenta de un pin en otro lado de la ciudad
 * (el cliente mandó la ubicación de su trabajo, o un pin viejo), no para
 * medir metros.
 */

import { haversineKm, type Punto } from './geo.js';
import { distritosEnTexto, reconocerDistrito, DISTRITOS_LIMA_CALLAO } from '../preventa/distritos.js';

export interface CentroDistrito {
  lat: number;
  lng: number;
  /** Radio aproximado del distrito, en km. */
  radioKm: number;
}

/** Los 50 distritos de Lima Metropolitana y el Callao (nombres como en src/preventa/distritos.ts). */
export const CENTROS_DISTRITOS: Record<string, CentroDistrito> = {
  'Ancón': { lat: -11.773, lng: -77.176, radioKm: 8 },
  'Ate': { lat: -12.026, lng: -76.918, radioKm: 6 },
  'Barranco': { lat: -12.149, lng: -77.021, radioKm: 1.2 },
  'Breña': { lat: -12.06, lng: -77.052, radioKm: 1.2 },
  'Carabayllo': { lat: -11.87, lng: -77.03, radioKm: 7 },
  'Chaclacayo': { lat: -11.979, lng: -76.77, radioKm: 3 },
  'Chorrillos': { lat: -12.17, lng: -77.015, radioKm: 3.5 },
  'Cieneguilla': { lat: -12.075, lng: -76.78, radioKm: 6 },
  'Comas': { lat: -11.938, lng: -77.05, radioKm: 3.5 },
  'El Agustino': { lat: -12.045, lng: -76.995, radioKm: 1.8 },
  'Independencia': { lat: -11.99, lng: -77.05, radioKm: 2.5 },
  'Jesús María': { lat: -12.077, lng: -77.047, radioKm: 1.3 },
  'La Molina': { lat: -12.08, lng: -76.93, radioKm: 4 },
  'La Victoria': { lat: -12.07, lng: -77.017, radioKm: 1.8 },
  'Lima': { lat: -12.046, lng: -77.043, radioKm: 3 },
  'Lince': { lat: -12.084, lng: -77.035, radioKm: 1 },
  'Los Olivos': { lat: -11.97, lng: -77.07, radioKm: 3 },
  'Lurigancho': { lat: -11.97, lng: -76.7, radioKm: 10 },
  'Lurín': { lat: -12.275, lng: -76.87, radioKm: 6 },
  'Magdalena del Mar': { lat: -12.09, lng: -77.07, radioKm: 1.2 },
  'Miraflores': { lat: -12.121, lng: -77.03, radioKm: 2 },
  'Pachacámac': { lat: -12.23, lng: -76.86, radioKm: 8 },
  'Pucusana': { lat: -12.48, lng: -76.79, radioKm: 4 },
  'Pueblo Libre': { lat: -12.075, lng: -77.063, radioKm: 1.3 },
  'Puente Piedra': { lat: -11.865, lng: -77.075, radioKm: 5 },
  'Punta Hermosa': { lat: -12.335, lng: -76.825, radioKm: 4 },
  'Punta Negra': { lat: -12.365, lng: -76.795, radioKm: 4 },
  'Rímac': { lat: -12.03, lng: -77.03, radioKm: 2 },
  'San Bartolo': { lat: -12.39, lng: -76.78, radioKm: 4 },
  'San Borja': { lat: -12.1, lng: -76.997, radioKm: 2 },
  'San Isidro': { lat: -12.097, lng: -77.036, radioKm: 1.8 },
  'San Juan de Lurigancho': { lat: -11.98, lng: -77.0, radioKm: 6 },
  'San Juan de Miraflores': { lat: -12.16, lng: -76.97, radioKm: 3 },
  'San Luis': { lat: -12.077, lng: -76.995, radioKm: 1.2 },
  'San Martín de Porres': { lat: -12.0, lng: -77.085, radioKm: 4.5 },
  'San Miguel': { lat: -12.078, lng: -77.09, radioKm: 2 },
  'Santa Anita': { lat: -12.045, lng: -76.965, radioKm: 1.8 },
  'Santa María del Mar': { lat: -12.405, lng: -76.775, radioKm: 2 },
  'Santa Rosa': { lat: -11.8, lng: -77.165, radioKm: 3 },
  'Santiago de Surco': { lat: -12.14, lng: -76.995, radioKm: 4 },
  'Surquillo': { lat: -12.113, lng: -77.018, radioKm: 1.3 },
  'Villa El Salvador': { lat: -12.213, lng: -76.94, radioKm: 4 },
  'Villa María del Triunfo': { lat: -12.16, lng: -76.93, radioKm: 5 },
  // Callao
  'Bellavista': { lat: -12.062, lng: -77.11, radioKm: 1.5 },
  'Callao': { lat: -12.04, lng: -77.125, radioKm: 5 },
  'Carmen de la Legua Reynoso': { lat: -12.043, lng: -77.093, radioKm: 1 },
  'La Perla': { lat: -12.068, lng: -77.12, radioKm: 1 },
  'La Punta': { lat: -12.072, lng: -77.163, radioKm: 0.8 },
  'Mi Perú': { lat: -11.855, lng: -77.125, radioKm: 1.5 },
  'Ventanilla': { lat: -11.875, lng: -77.13, radioKm: 6 },
};

/** El nombre de siempre de un distrito escrito como sea («surco», «Cercado de Lima», «SJL»); null si no es uno conocido. */
export function distritoConocido(texto: string | null | undefined): string | null {
  const t = (texto ?? '').trim();
  if (!t) return null;
  const nombre = reconocerDistrito(t, DISTRITOS_LIMA_CALLAO);
  return nombre && CENTROS_DISTRITOS[nombre] ? nombre : null;
}

/**
 * El distrito que se nombra dentro de una dirección escrita, o null. Si
 * aparecen varios («Av. Lima 123, Surco»), el último: el distrito va al final.
 */
export function distritoEnDireccion(texto: string | null | undefined): string | null {
  const t = (texto ?? '').trim();
  if (!t) return null;
  const hallados = distritosEnTexto(t, DISTRITOS_LIMA_CALLAO).filter((d) => CENTROS_DISTRITOS[d.nombre]);
  return hallados.length ? hallados[hallados.length - 1]!.nombre : null;
}

/** El distrito de un pedido: el que manda GSG; si no, el que nombra su dirección. */
export function distritoDePedido(e: { distrito?: string | null; direccion?: string | null }): string | null {
  return distritoConocido(e.distrito) ?? distritoEnDireccion(e.distrito) ?? distritoEnDireccion(e.direccion);
}

export interface DistanciaAlDistrito {
  distrito: string;
  /** Km desde el punto de referencia (el centro aproximado). */
  kmCentro: number;
  /** Km fuera del distrito (0 = dentro de su radio aproximado). */
  kmFuera: number;
}

/** A cuánto queda un punto del distrito (fuera de su radio aproximado). null = distrito desconocido. */
export function distanciaAlDistrito(punto: Punto, distrito: string | null | undefined): DistanciaAlDistrito | null {
  const nombre = distritoConocido(distrito);
  if (!nombre) return null;
  const c = CENTROS_DISTRITOS[nombre]!;
  const kmCentro = haversineKm(punto, c);
  return { distrito: nombre, kmCentro, kmFuera: Math.max(0, kmCentro - c.radioKm) };
}
