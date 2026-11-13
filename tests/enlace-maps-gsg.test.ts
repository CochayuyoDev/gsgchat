import { afterEach, describe, expect, it } from 'vitest';
import { direccionDelEnlace, enlacesDeMapa, extractLocation, extractLocationSync, lugarConNombreDelEnlace, placeIdDelEnlace } from '../src/geo/extract.js';
import { crearGeocodificadorGoogle } from '../src/entregas/geocodificar.js';
import { buscarLugarSinClave, puntoDelLugar } from '../src/geo/lugar-sin-clave.js';
import { clearResolveCache, enlacesDeLaPagina } from '../src/geo/resolve.js';
import { PERU_BBOX } from '../src/geo/validate.js';

// Los casos del self-check de GSG (gmaps_coords_selftest.php, 26/10), tal cual.
const opts = { pais: PERU_BBOX };

describe('enlaces de mapa: los casos de GSG', () => {
  it.each([
    'https://www.google.com/maps/place/Miraflores/@-12.1211000,-77.0296000,15z/data=!3m1!4b1!4m6!3m5!1s0x9105c8!8m2!3d-12.1191000!4d-77.0286000!16zL20v',
    'https://www.google.com/maps/dir/-12.0464000,-77.0428000/-12.1191000,-77.0286000/@-12.0827000,-77.0357000,13z/data=!4m2!4m1!3e0',
    'https://www.google.com/maps/dir//-12.1191000,-77.0286000/@-12.0827000,-77.0357000,13z',
  ])('el pin del lugar o el destino, nunca la cámara: %s', (url) => {
    const r = extractLocationSync(url, opts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lat).toBeCloseTo(-12.1191, 4);
    expect(r.lng).toBeCloseTo(-77.0286, 4);
  });

  it.each([
    'https://www.google.com/maps?q=-12.0464000,-77.0428000',
    'https://www.google.com/maps/search/?api=1&q=-12.0464000,+-77.0428000',
    'https://www.google.com/maps/search/?api=1&query=-12.0464000%2C-77.0428000',
    'https://maps.google.com/?q=loc:-12.0464000,-77.0428000',
    'https://maps.apple.com/?daddr=-12.0464000,-77.0428000',
    'https://maps.apple.com/?ll=-12.0464000,-77.0428000&q=Lima',
    'https://maps.apple.com/place?place-id=IABCD&coordinate=-12.0464000,-77.0428000',
    'https://www.waze.com/live-map/directions?to=ll.-12.0464000%2C-77.0428000',
    'https://waze.com/ul?ll=-12.0464000,-77.0428000&navigate=yes',
    'https://www.google.com/maps/dir/?api=1&destination=-12.0464000,-77.0428000',
    'geo:-12.0464000,-77.0428000?q=Cliente',
    'https://www.google.com/maps/@-12.0464000,-77.0428000,17z',
    'https://www.google.com/maps%3Fq%3D-12.0464000%2C-77.0428000',
  ])('%s', (url) => {
    const r = extractLocationSync(url, opts);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.lat).toBeCloseTo(-12.0464, 4);
    expect(r.lng).toBeCloseTo(-77.0428, 4);
  });

  it('con varios pines gana el último', () => {
    const r = extractLocationSync('https://maps.google.com/x!3d-12.0100000!4d-77.0100000!y!3d-12.0900000!4d-77.0900000', opts);
    expect(r.ok && [r.lat, r.lng]).toEqual([-12.09, -77.09]);
  });

  it('si el último pin cae fuera de Perú se usa el anterior, antes que bajar a un patrón peor', () => {
    const r = extractLocationSync('https://maps.google.com/x!3d-12.0500000!4d-77.0500000!y!3d40.7128000!4d-74.0060000', opts);
    expect(r.ok && [r.lat, r.lng]).toEqual([-12.05, -77.05]);
  });

  it.each([
    'https://www.google.com/maps/@40.7128000,-74.0060000,15z',
    'https://www.google.com/maps?q=40.4168000,-3.7038000',
    'https://maps.app.goo.gl/aBcDeF123456',
    'https://www.google.com/maps/place/Av+Larco+123+Miraflores',
  ])('no da nada: %s', (url) => {
    expect(extractLocationSync(url, opts).ok).toBe(false);
  });

  it('el enlace dentro de una frase, con puntuación pegada y sin esquema', () => {
    const r = extractLocationSync('mi casa es esta maps.google.com/?q=-12.0464,-77.0428. gracias', opts);
    expect(r.ok && [r.lat, r.lng]).toEqual([-12.0464, -77.0428]);
  });
});

describe('los enlaces de mapa de un mensaje', () => {
  it('saca solo los de mapas, sin repetir y aunque vengan sin esquema', () => {
    expect(enlacesDeMapa('mi casa https://maps.app.goo.gl/ZEkNG9qkYtoAVx1u5?g_st=iw gracias')).toEqual(['https://maps.app.goo.gl/ZEkNG9qkYtoAVx1u5?g_st=iw']);
    expect(enlacesDeMapa('maps.app.goo.gl/abc123, y otra vez maps.app.goo.gl/abc123')).toEqual(['https://maps.app.goo.gl/abc123']);
    expect(enlacesDeMapa('mira https://www.youtube.com/watch?v=1 o https://www.google.com/search?q=x')).toEqual([]);
  });

  it('dos enlaces distintos se cuentan como dos (no se elige uno)', () => {
    expect(enlacesDeMapa('https://maps.app.goo.gl/aaa o https://maps.app.goo.gl/bbb')).toHaveLength(2);
  });

  it('descarta usuario y contraseña o un puerto raro', () => {
    expect(enlacesDeMapa('https://x:y@maps.app.goo.gl/aaa https://maps.app.goo.gl:8080/bbb')).toEqual([]);
  });

  it('&amp; se lee como &', () => {
    const r = extractLocationSync('https://www.google.com/maps/search/?api=1&amp;query=-12.0464,-77.0428', opts);
    expect(r.ok && [r.lat, r.lng]).toEqual([-12.0464, -77.0428]);
  });
});

/** Un fetch falso: cada URL devuelve una redirección o una página. */
function fetchFalso(rutas: Record<string, { location?: string; cuerpo?: string }>): typeof fetch {
  return (async (url: string | URL) => {
    const r = rutas[String(url)];
    if (!r) return new Response('no', { status: 404 });
    if (r.location) return new Response(null, { status: 302, headers: { location: r.location } });
    return new Response(r.cuerpo ?? '', { status: 200 });
  }) as typeof fetch;
}

describe('enlaces cortos: la URL final y, si no trae coordenadas, los enlaces de la página', () => {
  afterEach(() => clearResolveCache());

  it('el enlace corto que resuelve a /maps/search/lat,+lng', async () => {
    const r = await extractLocation('https://maps.app.goo.gl/corto1', {
      ...opts,
      fetchImpl: fetchFalso({
        'https://maps.app.goo.gl/corto1': { location: 'https://www.google.com/maps/search/-12.1191,+-77.0286?entry=tts' },
        'https://www.google.com/maps/search/-12.1191,+-77.0286?entry=tts': { cuerpo: '<html></html>' },
      }),
    });
    expect(r.ok && [r.lat, r.lng]).toEqual([-12.1191, -77.0286]);
  });

  it('página de consentimiento: se leen las URLs de Maps escapadas de adentro, no el HTML entero', async () => {
    const cuerpo =
      // Pines de negocios cercanos sueltos en el HTML: no cuentan.
      '<script>var x="!3d-12.2000!4d-77.2000";</script>' +
      '<a href="https:\\/\\/maps.google.com\\/maps\\/api\\/staticmap?center=-11.94%2C-77.06&zoom=12">mapa</a>' +
      '<script>window.u="https:\\/\\/www.google.com\\/maps\\/place\\/Casa\\/data=!8m2!3d-12.1191!4d-77.0286\\u0026hl=es";</script>';
    const r = await extractLocation('https://maps.app.goo.gl/corto2', {
      ...opts,
      fetchImpl: fetchFalso({
        'https://maps.app.goo.gl/corto2': { location: 'https://consent.google.com/ml?continue=x' },
        'https://consent.google.com/ml?continue=x': { cuerpo },
      }),
    });
    expect(r.ok && [r.lat, r.lng]).toEqual([-12.1191, -77.0286]);
  });

  it('un lugar compartido como dirección (sin coordenadas en ningún enlace) no da nada: la imagen del mapa no cuenta', async () => {
    const final = 'https://maps.google.com/?q=Av.+Jorge+Ch%C3%A1vez+865,+Santiago+de+Surco+15049&ftid=0x9105b7f5dd68e5b3:0x9e9a29ecf747c400';
    const r = await extractLocation('https://maps.app.goo.gl/corto3?g_st=iw', {
      ...opts,
      fetchImpl: fetchFalso({
        'https://maps.app.goo.gl/corto3?g_st=iw': { location: final },
        [final]: { cuerpo: '"https:\\/\\/maps.google.com\\/maps\\/api\\/staticmap?center=-11.943936%2C-77.0637824&zoom=12" "https://www.google.com/maps?q=Av.+Jorge+Ch%C3%A1vez+865"' },
      }),
    });
    expect(r.ok).toBe(false);
  });

  it('la página se corta en 256 KB y un host fuera de la lista no se pide', async () => {
    const largo = 'x'.repeat(300 * 1024) + 'https://www.google.com/maps/place/@-12.1,-77.1/data=!3d-12.1!4d-77.1';
    expect(await enlacesDeLaPagina('https://maps.app.goo.gl/largo', { fetchImpl: fetchFalso({ 'https://maps.app.goo.gl/largo': { cuerpo: largo } }) })).toEqual([]);
    let pedidas = 0;
    const contar = (async () => {
      pedidas++;
      return new Response('');
    }) as unknown as typeof fetch;
    expect(await enlacesDeLaPagina('https://evil.example.com/x', { fetchImpl: contar })).toEqual([]);
    expect(pedidas).toBe(0);
  });
});

// Los casos de RECONOCER-ENLACES-GOOGLE-MAPS.md (11/11), sacados del parser.check.js
// de GSG (mapsLink.js de Kevin), con lo que GSGchat hace distinto a proposito
// (la camara `@` y `center=` siguen aceptandose, con su confianza; ver 3.3).
describe('enlaces de mapa: los casos de la versión Node de GSG', () => {
  afterEach(() => clearResolveCache());

  it('solo cuentan los enlaces de Google: el de evil.example no', () => {
    expect(enlacesDeMapa('Ver https://maps.app.goo.gl/ejemplo https://evil.example/maps?q=-12,-77')).toEqual(['https://maps.app.goo.gl/ejemplo']);
    expect(extractLocationSync('https://evil.example/maps?q=-12.1,-77.1', opts).ok).toBe(false);
    expect(enlacesDeMapa('https://maps.google.com.evil.example/?q=-12,-77')).toEqual([]);
  });

  it('sin esquema y con el punto final pegado; http pasa a https', () => {
    expect(enlacesDeMapa('Mi ubicación: maps.app.goo.gl/ejemplo.')).toEqual(['https://maps.app.goo.gl/ejemplo']);
    const r = extractLocationSync('http://maps.google.com/?q=-12.12,-77.03', opts);
    expect(r.ok && [r.lat, r.lng]).toEqual([-12.12, -77.03]);
  });

  it('solo la cámara (@): GSGchat la acepta, pero con confianza baja y pidiendo confirmar', () => {
    const r = extractLocationSync('https://www.google.com/maps/@-12.1,-77.1,17z', opts);
    expect(r.ok && [r.confidence, r.needsConfirmation]).toEqual(['low', true]);
  });

  it.each([
    ['https://www.google.com/maps/@-12,-77,17z/data=!3d-12.12!4d-77.03', 'el pin, no la cámara'],
    ['https://www.google.com/maps/search/?api=1&query=-12.12%2C-77.03', 'query codificada'],
    ['https://www.google.com/maps/dir/-12.0,-77.0/-12.12,-77.03/@-12.2,-77.2,15z', 'el destino de la ruta, no el @'],
    ['https://www.google.com/maps/dir/?destination=-12.12,-77.03&data=!3d-12.0!4d-77.0', 'C: destination antes que !3d!4d'],
    ['https://www.google.com/maps/dir/?api=1&daddr=-12.12,-77.03&data=!3d-12.0!4d-77.0', 'C: daddr antes que !3d!4d'],
  ])('%s → -12.12, -77.03 (%s)', (url) => {
    const r = extractLocationSync(url, opts);
    expect(r.ok && [r.lat, r.lng]).toEqual([-12.12, -77.03]);
  });

  it('D: /maps/dir/ con un solo tramo no toma ese tramo como destino', () => {
    expect(extractLocationSync('https://www.google.com/maps/dir/-12.12,-77.03', opts).ok).toBe(false);
    // Con la cámara, se queda en la cámara (confianza baja), nunca en el tramo suelto.
    const r = extractLocationSync('https://www.google.com/maps/dir/-12.0,-77.0/@-12.2,-77.2,15z', opts);
    expect(r.ok && [r.lat, r.lng, r.source]).toEqual([-12.2, -77.2, 'at_viewport']);
  });

  it('D: si el destino de la ruta es una dirección escrita, no se toma el origen en su lugar', () => {
    const r = extractLocationSync('https://www.google.com/maps/dir/-12.0,-77.0/Av.+Larco+123,+Miraflores/@-12.2,-77.2,15z', opts);
    expect(r.ok && [r.lat, r.lng, r.source]).toEqual([-12.2, -77.2, 'at_viewport']);
  });

  it('el origen vacío (/dir//destino, «desde donde estoy») sigue valiendo', () => {
    const r = extractLocationSync('https://www.google.com/maps/dir//-12.12,-77.03/@-12.2,-77.2,15z', opts);
    expect(r.ok && [r.lat, r.lng]).toEqual([-12.12, -77.03]);
  });

  it('enlace corto que redirige a ?q=lat,lng', async () => {
    const r = await extractLocation('https://maps.app.goo.gl/test', {
      ...opts,
      fetchImpl: fetchFalso({ 'https://maps.app.goo.gl/test': { location: 'https://www.google.com/maps?q=-12.12,-77.03' } }),
    });
    expect(r.ok && [r.lat, r.lng]).toEqual([-12.12, -77.03]);
  });

  it('enlace corto que redirige a 127.0.0.1: no da nada y nunca se pide esa dirección', async () => {
    const pedidas: string[] = [];
    const base = fetchFalso({ 'https://maps.app.goo.gl/privado': { location: 'http://127.0.0.1/private' } });
    const r = await extractLocation('https://maps.app.goo.gl/privado', {
      ...opts,
      fetchImpl: (async (u: string | URL, i?: RequestInit) => {
        pedidas.push(String(u));
        return base(u, i);
      }) as typeof fetch,
    });
    expect(r.ok).toBe(false);
    expect(pedidas.some((u) => u.includes('127.0.0.1'))).toBe(false);
  });
});

describe('A: lugares de Google (place_id) sin coordenadas', () => {
  afterEach(() => clearResolveCache());

  it.each([
    ['https://www.google.com/maps/place/test/data=!1sChIJtest123456', 'ChIJtest123456'],
    ['https://www.google.com/maps/search/?api=1&query=Lugar&query_place_id=ChIJabc1234567', 'ChIJabc1234567'],
    ['https://www.google.com/maps/dir/?api=1&destination=Casa&destination_place_id=ChIJdest123456', 'ChIJdest123456'],
    ['https://www.google.com/maps?q=place_id:ChIJabc1234567', 'ChIJabc1234567'],
    ['https://www.google.com/maps/dir/?api=1&destination=place_id:ChIJabc1234567', 'ChIJabc1234567'],
  ])('%s → %s', (url, id) => {
    expect(placeIdDelEnlace([url])).toBe(id);
  });

  it('no lee place_id de otros sitios, ni el !1s0x… (no es un place_id)', () => {
    expect(placeIdDelEnlace(['https://evil.example/maps?query_place_id=ChIJabc1234567'])).toBeNull();
    expect(placeIdDelEnlace(['https://www.google.com/maps/place/x/data=!1s0x9105c8:0x1234'])).toBeNull();
    expect(placeIdDelEnlace(['https://www.google.com/maps?q=place_id:'])).toBeNull();
  });

  it('el lugar se ubica con Google y queda como fuente place_id', async () => {
    const pedidos: string[] = [];
    const r = await extractLocation('mi casa https://www.google.com/maps/search/?api=1&query=Casa&query_place_id=ChIJabc1234567', {
      ...opts,
      porLugar: async (id) => (pedidos.push(id), { lat: -12.12, lng: -77.03 }),
    });
    expect(pedidos).toEqual(['ChIJabc1234567']);
    expect(r.ok && [r.lat, r.lng, r.source, r.confidence, r.needsConfirmation]).toEqual([-12.12, -77.03, 'place_id', 'high', false]);
  });

  it('el lugar le gana a la cámara (@), pero no a un pin de verdad', async () => {
    const porLugar = async () => ({ lat: -12.12, lng: -77.03 });
    const conCamara = await extractLocation('https://www.google.com/maps/place/Casa/@-12.2,-77.2,15z/data=!4m2!3m1!1sChIJcasa1234567', { ...opts, porLugar });
    expect(conCamara.ok && [conCamara.lat, conCamara.source]).toEqual([-12.12, 'place_id']);
    let preguntas = 0;
    const conPin = await extractLocation('https://www.google.com/maps/place/Casa/data=!3d-12.05!4d-77.05!1sChIJcasa1234567', { ...opts, porLugar: async () => (preguntas++, { lat: -12.12, lng: -77.03 }) });
    expect(conPin.ok && [conPin.lat, conPin.source]).toEqual([-12.05, 'data_3d4d']);
    expect(preguntas).toBe(0);
  });

  it('un lugar fuera del país no vale; sin quien lo ubique no da nada', async () => {
    const url = 'https://www.google.com/maps?q=place_id:ChIJabc1234567';
    const fuera = await extractLocation(url, { ...opts, porLugar: async () => ({ lat: 40.71, lng: -74.0 }) });
    expect(fuera.ok).toBe(false);
    expect((await extractLocation(url, opts)).ok).toBe(false);
  });

  it('un enlace corto que lleva a un lugar sin coordenadas', async () => {
    const final = 'https://www.google.com/maps/place/Tienda/data=!4m2!3m1!1sChIJtienda123456';
    const r = await extractLocation('https://maps.app.goo.gl/lugar', {
      ...opts,
      fetchImpl: fetchFalso({ 'https://maps.app.goo.gl/lugar': { location: final }, [final]: { cuerpo: '<html></html>' } }),
      porLugar: async (id) => (id === 'ChIJtienda123456' ? { lat: -12.12, lng: -77.03 } : null),
    });
    expect(r.ok && [r.lat, r.lng, r.source]).toEqual([-12.12, -77.03, 'place_id']);
  });

  it('Google: geocode por place_id, y el mismo lugar no se pregunta dos veces', async () => {
    const pedidas: string[] = [];
    const google = crearGeocodificadorGoogle('CLAVE', (async (u: string | URL) => {
      pedidas.push(String(u));
      return new Response(JSON.stringify({ status: 'OK', results: [{ formatted_address: 'Av. Larco 123, Miraflores', geometry: { location: { lat: -12.12, lng: -77.03 } } }] }));
    }) as typeof fetch);
    expect(await google.lugar!('ChIJabc1234567')).toEqual({ lat: -12.12, lng: -77.03, texto: 'Av. Larco 123, Miraflores' });
    expect(await google.lugar!('ChIJabc1234567')).toEqual({ lat: -12.12, lng: -77.03, texto: 'Av. Larco 123, Miraflores' });
    expect(pedidas).toHaveLength(1);
    expect(new URL(pedidas[0]!).searchParams.get('place_id')).toBe('ChIJabc1234567');
  });

  it('Google: ZERO_RESULTS da null, y un id raro ni se pregunta', async () => {
    let pedidas = 0;
    const google = crearGeocodificadorGoogle('CLAVE', (async () => (pedidas++, new Response(JSON.stringify({ status: 'ZERO_RESULTS', results: [] })))) as unknown as typeof fetch);
    expect(await google.lugar!('ChIJnoexiste123')).toBeNull();
    expect(await google.lugar!('no válido')).toBeNull();
    expect(pedidas).toBe(1);
  });
});

describe('B: la dirección escrita de un enlace de «cómo llegar»', () => {
  it('lee destination y daddr, además de query y q', () => {
    expect(direccionDelEnlace('https://www.google.com/maps/dir/?api=1&destination=Av.+Larco+123,+Miraflores')).toBe('Av. Larco 123, Miraflores');
    expect(direccionDelEnlace('https://maps.google.com/?saddr=Casa&daddr=Jr.+Cusco+456,+Lima')).toBe('Jr. Cusco 456, Lima');
    expect(direccionDelEnlace('https://www.google.com/maps?q=Av.+Arequipa+2450,+Lince')).toBe('Av. Arequipa 2450, Lince');
  });

  it('un place_id no es una dirección', () => {
    expect(direccionDelEnlace('https://www.google.com/maps?q=place_id:ChIJabc1234567')).toBeNull();
  });

  it('el enlace de «cómo llegar» con la dirección del destino se ubica en el mapa', async () => {
    const buscadas: string[] = [];
    const r = await extractLocation('https://www.google.com/maps/dir/?api=1&destination=Av.+Larco+123,+Miraflores', {
      ...opts,
      porDireccion: async (d) => (buscadas.push(d), { lat: -12.12, lng: -77.03 }),
    });
    expect(buscadas).toEqual(['Av. Larco 123, Miraflores']);
    expect(r.ok && r.source).toBe('address_geocoded');
  });
});

// El enlace real del 13/11 (iPhone): maps.app.goo.gl/yTDuALE63dyWjyHw9 lleva a
// ?q=<nombre del negocio, Mz y Lt>&ftid=0x…:0x…, sin coordenadas ni place_id, y la
// pagina de Google solo trae el centro por defecto del mapa (-11.943936, -77.053952).
describe('lugares compartidos por su nombre (iPhone: ?q=…&ftid=…)', () => {
  afterEach(() => clearResolveCache());
  const FINAL = 'https://maps.google.com/?q=Bodega+Heidi+%26+Adrian,+MZ+D1+Lt+15+COOP,+San+Mart%C3%ADn+de+Porres&ftid=0x9105cf0c22565673:0xdd17f9a075206a93&entry=gps&g_st=iw';
  const PAGINA = '<script>APP_INITIALIZATION_STATE=[[[124910.1,-77.053952,-11.943936]]]</script>' +
    '"https:\\/\\/maps.google.com\\/maps\\/api\\/staticmap?center=-11.943936%2C-77.053952&zoom=12"' +
    '"https://www.google.com/maps?q=Bodega+Heidi+%26+Adrian,+MZ+D1+Lt+15+COOP,+San+Mart%C3%ADn+de+Porres"';
  const corto = () => fetchFalso({ 'https://maps.app.goo.gl/yTDuALE63dyWjyHw9?g_st=iw': { location: FINAL }, [FINAL]: { cuerpo: PAGINA } });

  it('saca el nombre del lugar solo si el enlace es un lugar (trae ftid)', () => {
    expect(lugarConNombreDelEnlace([FINAL])).toBe('Bodega Heidi & Adrian, MZ D1 Lt 15 COOP, San Martín de Porres');
    expect(lugarConNombreDelEnlace(['https://maps.google.com/?q=Miraflores'])).toBeNull();
    expect(lugarConNombreDelEnlace(['https://evil.example/?q=Bodega&ftid=0x1:0x2'])).toBeNull();
  });

  it('el enlace corto del cliente se ubica buscando el lugar por su nombre', async () => {
    const buscados: string[] = [];
    const r = await extractLocation('https://maps.app.goo.gl/yTDuALE63dyWjyHw9?g_st=iw', {
      ...opts,
      fetchImpl: corto(),
      porLugarConNombre: async (t) => (buscados.push(t), { lat: -11.9876543, lng: -77.0812345 }),
      porDireccion: async () => ({ lat: -12.5, lng: -77.5 }),
    });
    expect(buscados).toEqual(['Bodega Heidi & Adrian, MZ D1 Lt 15 COOP, San Martín de Porres']);
    expect(r.ok && [r.lat, r.lng, r.source, r.needsConfirmation]).toEqual([-11.9876543, -77.0812345, 'place_search', false]);
  });

  it('sin clave de Google (o si no lo encuentra) no inventa: ni el centro por defecto del mapa', async () => {
    const r = await extractLocation('https://maps.app.goo.gl/yTDuALE63dyWjyHw9?g_st=iw', { ...opts, fetchImpl: corto(), porLugarConNombre: async () => null });
    expect(r.ok).toBe(false);
  });

  it('Google Find Place: un solo candidato vale; varios no; se pregunta una vez', async () => {
    const pedidas: string[] = [];
    let respuesta: unknown = { status: 'OK', candidates: [{ name: 'Bodega Heidi & Adrian', formatted_address: 'Mz D1 Lt 15, San Martín de Porres', geometry: { location: { lat: -11.98, lng: -77.08 } } }] };
    const google = crearGeocodificadorGoogle('CLAVE', (async (u: string | URL) => (pedidas.push(String(u)), new Response(JSON.stringify(respuesta)))) as typeof fetch);
    expect(await google.lugarPorNombre!('Bodega Heidi & Adrian, MZ D1 Lt 15')).toEqual({ lat: -11.98, lng: -77.08, texto: 'Bodega Heidi & Adrian, Mz D1 Lt 15, San Martín de Porres' });
    expect(await google.lugarPorNombre!('Bodega Heidi & Adrian, MZ D1 Lt 15')).not.toBeNull();
    expect(pedidas).toHaveLength(1);
    const q = new URL(pedidas[0]!);
    expect([q.pathname, q.searchParams.get('input'), q.searchParams.get('inputtype')]).toEqual(['/maps/api/place/findplacefromtext/json', 'Bodega Heidi & Adrian, MZ D1 Lt 15', 'textquery']);
    respuesta = { status: 'OK', candidates: [{ geometry: { location: { lat: -12, lng: -77 } } }, { geometry: { location: { lat: -12.1, lng: -77.1 } } }] };
    expect(await google.lugarPorNombre!('Bodega')).toBeNull();
    respuesta = { status: 'REQUEST_DENIED', candidates: [] };
    expect(await google.lugarPorNombre!('Otra bodega')).toBeNull();
  });
});

// Camino 2 (13/11): sin clave de Google, la búsqueda que hace la web de Google
// Maps por dentro. La respuesta de abajo es la forma real que devolvió Google
// para el enlace del cliente (recortada): el punto va pegado al ftid del lugar.
describe('lugar compartido por su nombre, sin clave de Google', () => {
  afterEach(() => clearResolveCache());
  const FTID = '0x9105cf0c22565673:0xdd17f9a075206a93';
  const FINAL = `https://maps.google.com/?q=Bodega+Heidi+%26+Adrian,+MZ+D1+Lt+15+COOP,+San+Mart%C3%ADn+de+Porres&ftid=${FTID}&entry=gps&g_st=iw`;
  const CORTO = 'https://maps.app.goo.gl/yTDuALE63dyWjyHw9?g_st=iw';
  const BUSQUEDA = 'https://www.google.com/search?tbm=map&hl=es&gl=pe&q=Bodega+Heidi+%26+Adrian%2C+MZ+D1+Lt+15+COOP%2C+San+Mart%C3%ADn+de+Porres';
  const RESPUESTA =
    ")]}'\n[[\"Bodega Heidi \\u0026 Adrian, MZ D1 Lt 15 COOP, San Martín de Porres\",[[null,null,null,null,\"dTf3\"," +
    // Otro negocio de la misma búsqueda, con otro ftid: no cuenta.
    '[null,null,-12.0201,-77.0799],"0x9105cf0c11111111:0xaaaaaaaaaaaaaaaa","Otra bodega",' +
    // El punto de la entrada del local (sin ftid pegado): no cuenta.
    '[null,null,-12.0156583,-77.0805354],null,' +
    `[null,null,-12.015630999999999,-77.0805262],"${FTID}","Bodega Heidi \\u0026 Adrian",null]]]]`;
  const PAGINA = '<script>APP_INITIALIZATION_STATE=[[[124910.1,-77.053952,-11.943936]]]</script>';

  function google(rutas: Record<string, { status?: number; cuerpo?: string; location?: string }>, pedidas: string[] = []): typeof fetch {
    return (async (u: string | URL) => {
      pedidas.push(String(u));
      const r = rutas[String(u)];
      if (!r) return new Response('no', { status: 404 });
      if (r.location) return new Response(null, { status: 302, headers: { location: r.location } });
      return new Response(r.cuerpo ?? '', { status: r.status ?? 200 });
    }) as typeof fetch;
  }

  it('toma el punto pegado al MISMO ftid, no el de otro negocio ni el de la entrada', () => {
    expect(puntoDelLugar(RESPUESTA, FTID)).toEqual({ lat: -12.015631, lng: -77.0805262 });
    expect(puntoDelLugar(RESPUESTA, '0x9105cf0c22565673:0x0000000000000001')).toBeNull();
    expect(puntoDelLugar('<html>captcha</html>', FTID)).toBeNull();
  });

  it('el enlace real del cliente da -12.015631, -77.0805262 sin clave', async () => {
    const pedidas: string[] = [];
    const r = await extractLocation(CORTO, {
      ...opts,
      fetchImpl: google({ [CORTO]: { location: FINAL }, [FINAL]: { cuerpo: PAGINA }, [BUSQUEDA]: { cuerpo: RESPUESTA } }, pedidas),
    });
    expect(pedidas).toContain(BUSQUEDA);
    expect(r.ok && [r.lat, r.lng, r.source, r.needsConfirmation]).toEqual([-12.015631, -77.0805262, 'place_search', false]);
    expect(r.ok && r.warnings.some((w) => w.includes('sin clave'))).toBe(true);
  });

  it('con clave de Google se usa la clave y no la búsqueda sin clave', async () => {
    const pedidas: string[] = [];
    const r = await extractLocation(CORTO, {
      ...opts,
      fetchImpl: google({ [CORTO]: { location: FINAL }, [FINAL]: { cuerpo: PAGINA }, [BUSQUEDA]: { cuerpo: RESPUESTA } }, pedidas),
      porLugarConNombre: async () => ({ lat: -12.0157, lng: -77.0806 }),
    });
    expect(r.ok && [r.lat, r.lng]).toEqual([-12.0157, -77.0806]);
    expect(pedidas).not.toContain(BUSQUEDA);
  });

  it('si Google cambia el formato, pide captcha o no hay red: no inventa (se pide el pin)', async () => {
    for (const busqueda of [{ cuerpo: ")]}'\n[[\"otro formato\"]]" }, { status: 429, cuerpo: 'captcha' }, { location: 'https://www.google.com/sorry/index' }]) {
      clearResolveCache();
      const r = await extractLocation(CORTO, { ...opts, fetchImpl: google({ [CORTO]: { location: FINAL }, [FINAL]: { cuerpo: PAGINA }, [BUSQUEDA]: busqueda }) });
      expect(r.ok).toBe(false);
    }
  });

  it('un punto fuera del Perú no vale', async () => {
    const lejos = RESPUESTA.replace('-12.015630999999999,-77.0805262', '40.7128,-74.006');
    const r = await extractLocation(CORTO, { ...opts, fetchImpl: google({ [CORTO]: { location: FINAL }, [FINAL]: { cuerpo: PAGINA }, [BUSQUEDA]: { cuerpo: lejos } }) });
    expect(r.ok).toBe(false);
  });

  it('se puede apagar, y sin resolver enlaces no sale a internet', async () => {
    const pedidas: string[] = [];
    const rutas = { [CORTO]: { location: FINAL }, [FINAL]: { cuerpo: PAGINA }, [BUSQUEDA]: { cuerpo: RESPUESTA } };
    expect((await extractLocation(CORTO, { ...opts, buscarLugarSinClave: false, fetchImpl: google(rutas, pedidas) })).ok).toBe(false);
    expect((await extractLocation(FINAL, { ...opts, resolveShortLinks: false, fetchImpl: google(rutas, pedidas) })).ok).toBe(false);
    expect(pedidas).not.toContain(BUSQUEDA);
  });

  it('el mismo negocio se pregunta una sola vez (también lo que no se encontró)', async () => {
    const pedidas: string[] = [];
    const f = google({ [BUSQUEDA]: { cuerpo: RESPUESTA } }, pedidas);
    const texto = 'Bodega Heidi & Adrian, MZ D1 Lt 15 COOP, San Martín de Porres';
    expect(await buscarLugarSinClave(texto, FTID, { fetchImpl: f })).toEqual({ lat: -12.015631, lng: -77.0805262 });
    expect(await buscarLugarSinClave(texto, FTID, { fetchImpl: f })).toEqual({ lat: -12.015631, lng: -77.0805262 });
    expect(pedidas.filter((u) => u === BUSQUEDA)).toHaveLength(1);
    expect(await buscarLugarSinClave(texto, 'no es un ftid', { fetchImpl: f })).toBeNull();
  });
});
