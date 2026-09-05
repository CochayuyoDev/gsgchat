/** Uso: npm run extract -- "<link de mapa o texto>" */
import { extractLocation } from './geo/extract.js';

const input = process.argv.slice(2).join(' ');
if (!input) {
  console.error('Uso: npm run extract -- "<link de mapa o texto>"');
  process.exit(1);
}

const result = await extractLocation(input);
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 2);
