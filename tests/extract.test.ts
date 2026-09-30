import { describe, expect, it } from 'vitest';
import {
  extractLocationSync,
  fromWhatsAppLocation,
  canonicalMapsUrl,
} from '../src/geo/extract.js';
import { MEXICO_BBOX } from '../src/geo/validate.js';
import { FIXTURES } from './fixtures.js';

describe('extractLocationSync sobre URLs reales', () => {
  for (const fx of FIXTURES) {
    it(fx.name, () => {
      const result = extractLocationSync(fx.input);
      expect(result.ok, `fallo con: ${fx.input}`).toBe(true);
      if (!result.ok) return;
      expect(result.lat).toBeCloseTo(fx.lat, 4);
      expect(result.lng).toBeCloseTo(fx.lng, 4);
      expect(result.source).toBe(fx.source);
    });
  }
});

describe('prioridad de fuentes', () => {
  it('la coordenada del place (!3d!4d) gana sobre el centro del viewport (@)', () => {
    const result = extractLocationSync(
      'https://www.google.com/maps/place/X/@19.9999,-99.9999,17z/data=!4m2!8m2!3d19.4352!4d-99.1412',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe('data_3d4d');
    expect(result.lat).toBeCloseTo(19.4352, 4);
  });

  it('el viewport se marca como baja confianza y pide confirmacion', () => {
    const result = extractLocationSync('https://www.google.com/maps/@19.4326,-99.1332,15z');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confidence).toBe('low');
    expect(result.needsConfirmation).toBe(true);
    expect(result.warnings.join(' ')).toContain('centro del mapa');
  });

  it('avisa cuando la coordenada sale del ORIGEN de una ruta', () => {
    const result = extractLocationSync('https://maps.google.com/maps?saddr=19.4326,-99.1332');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.join(' ')).toContain('ORIGEN');
  });

  it('avisa cuando la ruta traia varios waypoints', () => {
    const result = extractLocationSync(
      'https://www.google.com/maps/dir/A/B/data=!3d19.1!4d-99.1!3d19.4326!4d-99.1332',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.join(' ')).toContain('waypoints');
  });
});

describe('validacion', () => {
  it('rechaza Null Island (0,0)', () => {
    const result = extractLocationSync('https://maps.google.com/?q=0,0');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('null_island');
  });

  it('rechaza latitud fuera de rango', () => {
    const result = extractLocationSync('https://maps.google.com/?q=91.5000,-99.1332');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('out_of_range');
  });

  it('rechaza coordenadas fuera del bbox configurado', () => {
    const result = extractLocationSync('https://maps.google.com/?q=48.8566,2.3522', {
      bbox: MEXICO_BBOX,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('outside_bbox');
  });

  it('detecta lat/lng invertidas cuando hay bbox', () => {
    const result = extractLocationSync('https://maps.google.com/?q=-99.1332,19.4326', {
      bbox: MEXICO_BBOX,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.warnings.join(' ')).toContain('invertidas');
  });

  it('marca precision baja con pocos decimales', () => {
    const result = extractLocationSync('https://maps.google.com/?q=19.4,-99.1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.precisionMeters).toBeGreaterThan(1000);
    expect(result.needsConfirmation).toBe(true);
  });

  it('entrada vacia', () => {
    const result = extractLocationSync('   ');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_input');
  });

  it('texto sin coordenadas', () => {
    const result = extractLocationSync('hola, quiero cotizar un envio');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_coordinates_found');
  });

  it('no confunde un precio ni una hora con coordenadas', () => {
    expect(extractLocationSync('son 1,250 pesos a las 3,30').ok).toBe(false);
  });
});

describe('mensaje nativo de ubicacion de WhatsApp', () => {
  it('no parsea nada y devuelve confianza exacta', () => {
    const result = fromWhatsAppLocation({ latitude: 19.4326, longitude: -99.1332 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe('whatsapp_native');
    expect(result.confidence).toBe('exact');
    expect(result.needsConfirmation).toBe(false);
  });

  it('acepta strings, que es como a veces llegan en el webhook', () => {
    const result = fromWhatsAppLocation({ latitude: '19.4326', longitude: '-99.1332' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lat).toBeCloseTo(19.4326, 4);
  });

  it('tambien valida contra el bbox', () => {
    const result = fromWhatsAppLocation(
      { latitude: 48.8566, longitude: 2.3522 },
      { bbox: MEXICO_BBOX },
    );
    expect(result.ok).toBe(false);
  });
});

describe('salida', () => {
  it('genera un enlace canonico reenviable', () => {
    expect(canonicalMapsUrl(19.4326, -99.1332)).toBe(
      'https://www.google.com/maps/search/?api=1&query=19.4326,-99.1332',
    );
  });
});
