import type { CoordSource } from '../src/types.js';

export interface Fixture {
  name: string;
  input: string;
  lat: number;
  lng: number;
  source: CoordSource;
}

/** Coordenada de referencia: Palacio de Bellas Artes, CDMX. */
export const BELLAS_ARTES = { lat: 19.4352, lng: -99.1412 };

export const FIXTURES: Fixture[] = [
  {
    name: 'place con /data= (!8m2!3d!4d): gana sobre el @ del viewport',
    input:
      'https://www.google.com/maps/place/Palacio+de+Bellas+Artes/@19.4000000,-99.1000000,17z/data=!3m1!4b1!4m6!3m5!1s0x85d1f92a5a4e0b1f:0xabc!8m2!3d19.4352!4d-99.1412!16s%2Fg%2F11c1q',
    lat: 19.4352,
    lng: -99.1412,
    source: 'data_3d4d',
  },
  {
    name: 'place sin bloque 8m2, !3d!4d suelto',
    input:
      'https://www.google.com/maps/place/Zocalo/data=!4m2!3m1!1s0x0:0x0!3d19.4326!4d-99.1332',
    lat: 19.4326,
    lng: -99.1332,
    source: 'data_3d4d',
  },
  {
    name: 'ruta con varios waypoints: se toma el ultimo (el destino)',
    input:
      'https://www.google.com/maps/dir/Origen/Destino/data=!4m8!3d19.1111!4d-99.1111!3d19.4326!4d-99.1332',
    lat: 19.4326,
    lng: -99.1332,
    source: 'data_3d4d',
  },
  {
    name: 'coordenadas en el path de /maps/place/',
    input: 'https://www.google.com/maps/place/19.4326,-99.1332',
    lat: 19.4326,
    lng: -99.1332,
    source: 'path_coords',
  },
  {
    name: 'maps clasico con ?q=',
    input: 'https://maps.google.com/?q=19.4326,-99.1332',
    lat: 19.4326,
    lng: -99.1332,
    source: 'query_param',
  },
  {
    name: 'q= con prefijo loc:',
    input: 'https://www.google.com/maps?q=loc:19.4326,-99.1332',
    lat: 19.4326,
    lng: -99.1332,
    source: 'query_param',
  },
  {
    name: 'Maps URLs api=1 search (coma escapada como %2C)',
    input: 'https://www.google.com/maps/search/?api=1&query=19.4326%2C-99.1332',
    lat: 19.4326,
    lng: -99.1332,
    source: 'query_param',
  },
  {
    name: 'Maps URLs api=1 directions',
    input: 'https://www.google.com/maps/dir/?api=1&destination=19.4326,-99.1332&travelmode=driving',
    lat: 19.4326,
    lng: -99.1332,
    source: 'query_param',
  },
  {
    name: 'daddr de la app antigua',
    input: 'https://maps.google.com/maps?daddr=19.4326,-99.1332',
    lat: 19.4326,
    lng: -99.1332,
    source: 'query_param',
  },
  {
    name: 'parametro ll con zoom',
    input: 'https://maps.google.com/maps?ll=19.4326,-99.1332&z=15',
    lat: 19.4326,
    lng: -99.1332,
    source: 'll_param',
  },
  {
    name: 'api=1 map_action con center',
    input: 'https://www.google.com/maps/@?api=1&map_action=map&center=19.4326,-99.1332&zoom=17',
    lat: 19.4326,
    lng: -99.1332,
    source: 'll_param',
  },
  {
    name: 'solo viewport @lat,lng,zoom (baja confianza)',
    input: 'https://www.google.com/maps/@19.4326,-99.1332,15z',
    lat: 19.4326,
    lng: -99.1332,
    source: 'at_viewport',
  },
  {
    name: 'viewport con sufijo de camara 3a,75y',
    input: 'https://www.google.com/maps/@19.4326,-99.1332,3a,75y,90t/data=!3m6',
    lat: 19.4326,
    lng: -99.1332,
    source: 'at_viewport',
  },
  {
    name: 'geo: URI de Android',
    input: 'geo:19.4326,-99.1332?q=19.4326,-99.1332(Casa)',
    lat: 19.4326,
    lng: -99.1332,
    source: 'geo_uri',
  },
  {
    name: 'Waze',
    input: 'https://www.waze.com/ul?ll=19.4326%2C-99.1332&navigate=yes&zoom=17',
    lat: 19.4326,
    lng: -99.1332,
    source: 'll_param',
  },
  {
    name: 'Apple Maps (q= es el nombre, la coordenada esta en ll=)',
    input: 'https://maps.apple.com/?ll=19.4326,-99.1332&q=Casa&t=m',
    lat: 19.4326,
    lng: -99.1332,
    source: 'll_param',
  },
  {
    name: 'link con puntuacion pegada al final',
    input: 'aqui esta https://maps.google.com/?q=19.4326,-99.1332, nos vemos.',
    lat: 19.4326,
    lng: -99.1332,
    source: 'query_param',
  },
  {
    name: 'coordenadas en el hemisferio sur y este',
    input: 'https://maps.google.com/?q=-33.8688,151.2093',
    lat: -33.8688,
    lng: 151.2093,
    source: 'query_param',
  },
  {
    name: 'texto con emojis y el link al final',
    input: 'ya llegue 🚚📍 https://www.google.com/maps/@19.4326,-99.1332,18z',
    lat: 19.4326,
    lng: -99.1332,
    source: 'at_viewport',
  },
];
