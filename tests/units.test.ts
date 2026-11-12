import { LIMA_BBOX, validate } from '../src/geo/validate.js';
import { describe, expect, it } from 'vitest';
import { isAllowedHost, isPrivateAddress, isShortLinkHost } from '../src/util/net-guard.js';
import { TtlCache } from '../src/util/cache.js';

describe('guardas de red (anti SSRF)', () => {
  it('acepta los hosts de mapas conocidos', () => {
    expect(isAllowedHost('maps.app.goo.gl')).toBe(true);
    expect(isAllowedHost('www.google.com')).toBe(true);
    expect(isAllowedHost('maps.google.com.mx')).toBe(true);
  });

  it('rechaza cualquier otro host', () => {
    expect(isAllowedHost('evil.example.com')).toBe(false);
    expect(isAllowedHost('googlecom.evil.net')).toBe(false);
  });

  it('reconoce solo los acortadores como necesitados de resolucion', () => {
    expect(isShortLinkHost('maps.app.goo.gl')).toBe(true);
    expect(isShortLinkHost('www.google.com')).toBe(false);
  });

  it('bloquea rangos internos y metadata de cloud', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.169.254']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    expect(isPrivateAddress('::1')).toBe(true);
    expect(isPrivateAddress('fd00::1')).toBe(true);
    expect(isPrivateAddress('142.250.190.78')).toBe(false);
  });
});

describe('cache con TTL', () => {
  it('expira las entradas', () => {
    const cache = new TtlCache<string>(-1);
    cache.set('k', 'v');
    expect(cache.get('k')).toBeUndefined();
  });

  it('devuelve lo guardado dentro del TTL', () => {
    const cache = new TtlCache<string>(60_000);
    cache.set('k', 'v');
    expect(cache.get('k')).toBe('v');
  });
});

/**
 * La cobertura de Lima y Callao.
 *
 * Se prueba con puntos reales porque una caja mal puesta no falla: acepta o
 * rechaza en silencio, y el sintoma le llega al cliente como un "no puedo
 * atenderte" que nadie entiende.
 */
describe('cobertura de Lima y Callao', () => {
  const dentro: Array<[string, number, number]> = [
    ['Santa Anita (el pin de la primera prueba real)', -12.057708, -76.9699419],
    ['Centro de Lima', -12.0464, -77.0428],
    ['Callao, La Punta', -12.0686, -77.1653],
    ['Aeropuerto Jorge Chavez', -12.0219, -77.1143],
    ['Ancon, por el norte', -11.7756, -77.1761],
    ['Pucusana, por el sur', -12.4794, -76.7947],
    ['Chosica, por el este', -11.9404, -76.6976],
    ['Villa El Salvador', -12.2135, -76.9366],
  ];

  for (const [nombre, lat, lng] of dentro) {
    it(`${nombre} esta dentro`, () => {
      expect(validate(lat, lng, LIMA_BBOX).ok).toBe(true);
    });
  }

  const fuera: Array<[string, number, number]> = [
    ['Huacho', -11.1067, -77.6056],
    ['Canete', -13.0778, -76.3861],
    ['Arequipa', -16.409, -71.5375],
    ['Ciudad de Mexico', 19.4326, -99.1332],
  ];

  for (const [nombre, lat, lng] of fuera) {
    it(`${nombre} queda fuera`, () => {
      const resultado = validate(lat, lng, LIMA_BBOX);
      expect(resultado.ok).toBe(false);
      if (!resultado.ok) expect(resultado.reason).toBe('outside_bbox');
    });
  }

  it('la caja de Lima no se traga medio Peru', () => {
    // Un descuido tipico al ampliar margenes: que Arequipa o Trujillo entren.
    expect(LIMA_BBOX.maxLat - LIMA_BBOX.minLat).toBeLessThan(1.5);
    expect(LIMA_BBOX.maxLng - LIMA_BBOX.minLng).toBeLessThan(1.5);
  });
});
