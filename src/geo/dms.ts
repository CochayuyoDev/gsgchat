/**
 * Conversion de grados/minutos/segundos a decimal.
 *
 * Google reparte DMS en las URLs ya escapado
 * (`19%C2%B025%2757.4%22N`), asi que aqui siempre entra texto
 * previamente decodificado.
 */

const DMS_RE =
  /(\d{1,3})\s*[\u00b0\u00ba:]\s*(\d{1,2})\s*['\u2032\u00b4:]\s*(\d{1,2}(?:[.,]\d+)?)\s*["\u2033\u201d]?\s*([NSEWnsew])/g;

/** Grados y minutos decimales, sin segundos: 19 25.957' N */
const DM_RE = /(\d{1,3})\s*[\u00b0\u00ba]\s*(\d{1,2}(?:[.,]\d+)?)\s*['\u2032\u00b4]\s*([NSEWnsew])/g;

export interface DmsComponent {
  value: number;
  hemisphere: 'N' | 'S' | 'E' | 'W';
}

function toDecimal(deg: number, min: number, sec: number, hemi: string): DmsComponent {
  const h = hemi.toUpperCase() as 'N' | 'S' | 'E' | 'W';
  const magnitude = deg + min / 60 + sec / 3600;
  return { value: h === 'S' || h === 'W' ? -magnitude : magnitude, hemisphere: h };
}

const num = (s: string) => Number.parseFloat(s.replace(',', '.'));

/**
 * Devuelve el primer par lat/lng en formato DMS o DM que aparezca en el texto.
 * Acepta los dos ordenes (N antes que W y al reves).
 */
export function parseDms(text: string): { lat: number; lng: number } | null {
  const found: DmsComponent[] = [];

  DMS_RE.lastIndex = 0;
  for (const m of text.matchAll(DMS_RE)) {
    found.push(toDecimal(num(m[1]!), num(m[2]!), num(m[3]!), m[4]!));
  }

  if (found.length < 2) {
    DM_RE.lastIndex = 0;
    for (const m of text.matchAll(DM_RE)) {
      found.push(toDecimal(num(m[1]!), num(m[2]!), 0, m[3]!));
    }
  }

  if (found.length < 2) return null;

  const lat = found.find((c) => c.hemisphere === 'N' || c.hemisphere === 'S');
  const lng = found.find((c) => c.hemisphere === 'E' || c.hemisphere === 'W');
  if (!lat || !lng) return null;

  return { lat: lat.value, lng: lng.value };
}
