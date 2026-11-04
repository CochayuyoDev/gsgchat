import { afterEach, describe, expect, it } from 'vitest';
import { enlacesDeMapa, extractLocation, extractLocationSync } from '../src/geo/extract.js';
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
