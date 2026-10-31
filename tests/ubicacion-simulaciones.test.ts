import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/util/net-guard.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/util/net-guard.js')>()),
  assertPublicHost: async () => undefined,
}));

import { extractLocation, fromWhatsAppLocation } from '../src/geo/extract.js';
import { clearResolveCache } from '../src/geo/resolve.js';
import { LIMA_BBOX_AMPLIADA } from '../src/geo/validate.js';

const bbox = LIMA_BBOX_AMPLIADA;
const DESTINO = { lat: -12.046374, lng: -77.042793 };
const cerca = (n: number | undefined, esperado: number) =>
  expect(Math.abs((n ?? 99) - esperado)).toBeLessThan(0.0005);

/** Fetch falso: cada acortador redirige a la URL larga que Google le daria. */
function fetchConAcortadores(destinos: Record<string, string>): typeof fetch {
  return (async (url: string) => {
    const destino = destinos[url];
    if (!destino) return new Response('', { status: 404 });
    return new Response('', { status: 302, headers: { location: destino } });
  }) as unknown as typeof fetch;
}

const CHATS: Array<{ metodo: string; cliente: string; fuente: string }> = [
  { metodo: 'enlace largo de compartir (place con !3d!4d)', fuente: 'data_3d4d',
    cliente: 'Hola, aqui esta https://www.google.com/maps/place/Casa/@-12.0470,-77.0440,17z/data=!3m1!4b1!4m6!8m2!3d-12.046374!4d-77.042793 gracias' },
  { metodo: 'enlace con ?q=lat,lng', fuente: 'query_param',
    cliente: 'https://maps.google.com/?q=-12.046374,-77.042793' },
  { metodo: 'enlace api=1&query= con coma codificada', fuente: 'query_param',
    cliente: 'https://www.google.com/maps/search/?api=1&query=-12.046374%2C-77.042793' },
  { metodo: 'enlace /maps/search/ con + en la ruta', fuente: 'path_coords',
    cliente: 'Es en https://www.google.com/maps/search/-12.046374,+-77.042793' },
  { metodo: 'ruta /maps/dir/ origen y destino', fuente: 'path_coords',
    cliente: 'https://www.google.com/maps/dir/-12.01,-77.01/-12.046374,-77.042793' },
  { metodo: 'dir api=1&destination=', fuente: 'query_param',
    cliente: 'https://www.google.com/maps/dir/?api=1&destination=-12.046374,-77.042793' },
  { metodo: 'embed pb (longitud antes que latitud)', fuente: 'data_3d4d',
    cliente: 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3900.0!2d-77.042793!3d-12.046374' },
  { metodo: 'Apple Maps ll=', fuente: 'll_param',
    cliente: 'https://maps.apple.com/?ll=-12.046374,-77.042793&q=Casa' },
  { metodo: 'Apple Maps coordinate= (iOS 18)', fuente: 'll_param',
    cliente: 'https://maps.apple.com/place?coordinate=-12.046374,-77.042793&name=Casa' },
  { metodo: 'Waze ul.waze.com ll=', fuente: 'll_param',
    cliente: 'https://ul.waze.com/ul?ll=-12.046374%2C-77.042793&navigate=yes' },
  { metodo: 'Waze ruta to=ll.', fuente: 'll_param',
    cliente: 'https://www.waze.com/live-map/directions?to=ll.-12.046374%2C-77.042793' },
  { metodo: 'Apple Maps sin https', fuente: 'll_param',
    cliente: 'maps.apple.com/?ll=-12.046374,-77.042793&q=Casa' },
  { metodo: 'Waze sin https', fuente: 'll_param',
    cliente: 'waze.com/ul?ll=-12.046374%2C-77.042793&navigate=yes' },
  { metodo: 'enlace con puntuacion pegada al final', fuente: 'query_param',
    cliente: '(https://maps.google.com/?q=-12.046374,-77.042793).' },
];

describe('simulaciones de chat: el cliente manda su ubicacion y sale lat/lng exactas', () => {
  beforeEach(() => clearResolveCache());

  for (const chat of CHATS) {
    it(chat.metodo, async () => {
      const r = await extractLocation(chat.cliente, { bbox });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      cerca(r.lat, DESTINO.lat);
      cerca(r.lng, DESTINO.lng);
      expect(r.source).toBe(chat.fuente);
      expect(r.mapsUrl).toContain(`${r.lat},${r.lng}`);
    });
  }

  it('boton nativo de WhatsApp: el pin llega como numeros', () => {
    const r = fromWhatsAppLocation({ latitude: DESTINO.lat, longitude: DESTINO.lng, name: 'Casa' }, { bbox });
    expect(r).toMatchObject({ ok: true, lat: DESTINO.lat, lng: DESTINO.lng, source: 'whatsapp_native', confidence: 'exact' });
  });

  it('enlace corto maps.app.goo.gl: se abre y se lee el lugar real', async () => {
    const largo = 'https://www.google.com/maps/place/Casa/@-12.0470,-77.0440,17z/data=!3d-12.046374!4d-77.042793';
    const fetchImpl = fetchConAcortadores({ 'https://maps.app.goo.gl/AbC123xyz': largo });
    const r = await extractLocation('Mira: https://maps.app.goo.gl/AbC123xyz', { bbox, fetchImpl });
    expect(r).toMatchObject({ ok: true, lat: DESTINO.lat, lng: DESTINO.lng, source: 'data_3d4d' });
  });

  it('enlace corto en dos saltos (goo.gl -> maps.app.goo.gl -> google.com)', async () => {
    const fetchImpl = fetchConAcortadores({
      'https://goo.gl/maps/Zz9': 'https://maps.app.goo.gl/Zz9',
      'https://maps.app.goo.gl/Zz9': 'https://www.google.com/maps?q=-12.046374,-77.042793',
    });
    const r = await extractLocation('https://goo.gl/maps/Zz9', { bbox, fetchImpl });
    expect(r).toMatchObject({ ok: true, lat: DESTINO.lat, lng: DESTINO.lng });
  });

  it('enlace corto que no abre: falla sin inventar coordenadas', async () => {
    const r = await extractLocation('https://maps.app.goo.gl/muerto', { bbox, fetchImpl: fetchConAcortadores({}) });
    expect(r.ok).toBe(false);
  });

  it('solo el centro del mapa (@lat,lng): se lee pero queda marcado para confirmar', async () => {
    const r = await extractLocation('https://www.google.com/maps/@-12.046374,-77.042793,15z', { bbox });
    expect(r).toMatchObject({ ok: true, source: 'at_viewport', needsConfirmation: true });
  });

  it('place con nombre: la coordenada del lugar gana al centro del mapa', async () => {
    const r = await extractLocation(
      'https://www.google.com/maps/place/Casa/@-12.0600,-77.0600,15z/data=!8m2!3d-12.046374!4d-77.042793',
      { bbox },
    );
    expect(r).toMatchObject({ ok: true, lat: DESTINO.lat, lng: DESTINO.lng, source: 'data_3d4d' });
  });

  it('direccion escrita sin coordenadas: no se inventa un punto', async () => {
    const r = await extractLocation('Av. Arequipa 1234, Lince, al lado del grifo', { bbox });
    expect(r).toMatchObject({ ok: false, reason: 'no_coordinates_found' });
  });

  it('mensaje vacio o sin ubicacion: falla sin lanzar', async () => {
    expect((await extractLocation('   ', { bbox })).ok).toBe(false);
    expect((await extractLocation('ok', { bbox })).ok).toBe(false);
  });
});
