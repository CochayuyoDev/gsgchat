import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractLocation } from '../src/geo/extract.js';
import { clearResolveCache, resolveShortLink } from '../src/geo/resolve.js';

const PLACE_URL =
  'https://www.google.com/maps/place/Palacio+de+Bellas+Artes/@19.4352,-99.1412,17z/data=!4m2!8m2!3d19.4352!4d-99.1412';

/** fetch falso: devuelve un 302 por cada salto definido en `chain`. */
function fakeFetch(chain: Record<string, string>): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    const location = chain[url];
    const headers = new Headers(location ? { location } : {});
    return new Response(null, { status: location ? 302 : 200, headers });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  clearResolveCache();
});

describe('resolucion de acortadores', () => {
  it('sigue el redirect y saca la coordenada del destino', async () => {
    const result = await extractLocation('mi ubicacion: https://maps.app.goo.gl/AbCdEf123', {
      fetchImpl: fakeFetch({ 'https://maps.app.goo.gl/AbCdEf123': PLACE_URL }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe('data_3d4d');
    expect(result.lat).toBeCloseTo(19.4352, 4);
    expect(result.resolvedUrl).toBe(PLACE_URL);
    expect(result.originalUrl).toBe('https://maps.app.goo.gl/AbCdEf123');
  });

  it('sigue cadenas de varios saltos', async () => {
    const result = await extractLocation('https://goo.gl/maps/XYZ', {
      fetchImpl: fakeFetch({
        'https://goo.gl/maps/XYZ': 'https://maps.app.goo.gl/AbC',
        'https://maps.app.goo.gl/AbC': PLACE_URL,
      }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lat).toBeCloseTo(19.4352, 4);
  });

  it('cachea: el mismo enlace corto se pide una sola vez', async () => {
    const impl = fakeFetch({ 'https://maps.app.goo.gl/Cached1': PLACE_URL });
    await extractLocation('https://maps.app.goo.gl/Cached1', { fetchImpl: impl });
    await extractLocation('https://maps.app.goo.gl/Cached1', { fetchImpl: impl });
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('respeta el limite de redirecciones sin colgarse', async () => {
    const loop = fakeFetch({
      'https://maps.app.goo.gl/A': 'https://maps.app.goo.gl/B',
      'https://maps.app.goo.gl/B': 'https://maps.app.goo.gl/A',
    });
    const final = await resolveShortLink('https://maps.app.goo.gl/A', {
      fetchImpl: loop,
      maxRedirects: 3,
    });
    expect(final).toMatch(/maps\.app\.goo\.gl/);
    expect(loop).toHaveBeenCalledTimes(3);
  });

  it('no toca la red si resolveShortLinks es false', async () => {
    const impl = fakeFetch({});
    const result = await extractLocation('https://maps.app.goo.gl/NoNet', {
      resolveShortLinks: false,
      fetchImpl: impl,
    });
    expect(impl).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('short_link_unresolved');
  });

  it('un fallo de red no lanza: devuelve resultado con warning', async () => {
    const failing = vi.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;

    const result = await extractLocation('https://maps.app.goo.gl/Broken', {
      fetchImpl: failing,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('short_link_unresolved');
    expect(result.warnings.join(' ')).toContain('no se pudo resolver');
  });

  it('no sale a la red por un host que no esta en la allowlist', async () => {
    const impl = fakeFetch({});
    const final = await resolveShortLink('https://evil.example.com/abc', { fetchImpl: impl });
    expect(impl).not.toHaveBeenCalled();
    expect(final).toBe('https://evil.example.com/abc');
  });
});
