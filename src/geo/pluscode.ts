/**
 * Decodificador de Open Location Code (Plus Codes) al centro del area.
 *
 * Solo se decodifican codigos COMPLETOS (8 caracteres antes del '+').
 * Un codigo corto tipo `XCJ8+9M` es relativo a una localidad y sin esa
 * referencia no se puede resolver: en ese caso devolvemos null a proposito
 * en vez de inventar una posicion.
 */

const ALPHABET = '23456789CFGHJMPQRVWX';
const SEPARATOR = '+';
const PADDING = '0';
const PAIR_LENGTH = 10;
const GRID_ROWS = 5;
const GRID_COLS = 4;

/** Codigo completo: 8 chars validos (o con padding), '+', y 2-7 chars mas. */
const FULL_CODE_RE = /\b([23456789CFGHJMPQRVWX0]{8})\+([23456789CFGHJMPQRVWX]{2,7})\b/i;

export function findPlusCode(text: string): string | null {
  const m = FULL_CODE_RE.exec(text);
  return m ? `${m[1]!}${SEPARATOR}${m[2]!}`.toUpperCase() : null;
}

export function decodePlusCode(code: string): { lat: number; lng: number } | null {
  const clean = code.toUpperCase().replace(SEPARATOR, '').replace(/0+$/, '');
  if (clean.length < 2 || clean.length % 2 !== 0) return null;
  for (const ch of clean) {
    if (!ALPHABET.includes(ch)) return null;
  }

  let lat = -90;
  let lng = -180;
  let latRes = 400;
  let lngRes = 400;

  const pairs = Math.min(clean.length, PAIR_LENGTH);
  for (let i = 0; i < pairs; i += 2) {
    latRes /= 20;
    lngRes /= 20;
    lat += ALPHABET.indexOf(clean[i]!) * latRes;
    lng += ALPHABET.indexOf(clean[i + 1]!) * lngRes;
  }

  for (let i = PAIR_LENGTH; i < clean.length; i++) {
    latRes /= GRID_ROWS;
    lngRes /= GRID_COLS;
    const digit = ALPHABET.indexOf(clean[i]!);
    lat += Math.floor(digit / GRID_COLS) * latRes;
    lng += (digit % GRID_COLS) * lngRes;
  }

  // Centro del area, no su esquina suroeste.
  return { lat: lat + latRes / 2, lng: lng + lngRes / 2 };
}
