import { describe, expect, it } from 'vitest';
import { parseDms } from '../src/geo/dms.js';
import { decodePlusCode, findPlusCode } from '../src/geo/pluscode.js';
import { isAllowedHost, isPrivateAddress, isShortLinkHost } from '../src/util/net-guard.js';
import { TtlCache } from '../src/util/cache.js';

describe('DMS', () => {
  it('convierte grados/minutos/segundos con hemisferios', () => {
    const r = parseDms('19°25\'57.4"N 99°07\'59.5"W');
    expect(r).not.toBeNull();
    expect(r!.lat).toBeCloseTo(19.432611, 5);
    expect(r!.lng).toBeCloseTo(-99.133194, 5);
  });

  it('acepta el orden invertido (longitud primero)', () => {
    const r = parseDms('99°07\'59.5"W 19°25\'57.4"N');
    expect(r!.lat).toBeCloseTo(19.432611, 5);
    expect(r!.lng).toBeCloseTo(-99.133194, 5);
  });

  it('acepta grados y minutos decimales sin segundos', () => {
    const r = parseDms("19°25.9567' N 99°7.9917' W");
    expect(r!.lat).toBeCloseTo(19.43261, 4);
    expect(r!.lng).toBeCloseTo(-99.13319, 4);
  });

  it('devuelve null si falta un eje', () => {
    expect(parseDms('19°25\'57.4"N')).toBeNull();
  });
});

describe('Plus Codes', () => {
  it('decodifica el vector de referencia 8FVC2222+22', () => {
    const r = decodePlusCode('8FVC2222+22');
    expect(r!.lat).toBeCloseTo(47.0000625, 6);
    expect(r!.lng).toBeCloseTo(8.0000625, 6);
  });

  it('decodifica un codigo con seccion de rejilla', () => {
    // 8FVC9G8F+6X es Zug (Suiza), el ejemplo de la documentacion de OLC.
    const r = decodePlusCode('8FVC9G8F+6X');
    expect(r!.lat).toBeCloseTo(47.3655, 3);
    expect(r!.lng).toBeCloseTo(8.5249, 3);
  });

  it('encuentra el codigo dentro de una URL', () => {
    expect(findPlusCode('https://plus.codes/8FVC2222+22')).toBe('8FVC2222+22');
  });

  it('ignora codigos cortos: sin localidad no se pueden resolver', () => {
    expect(findPlusCode('nos vemos en XCJ8+9M')).toBeNull();
  });

  it('rechaza caracteres fuera del alfabeto OLC', () => {
    expect(decodePlusCode('8FVC2A2A+22')).toBeNull();
  });
});

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
