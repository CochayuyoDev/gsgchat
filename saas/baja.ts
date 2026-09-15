/**
 * Baja de una tienda.
 *
 *   npm run saas:baja -- tienda1                 para el contenedor; deja los datos
 *   npm run saas:baja -- tienda1 --borrar-datos  y borra base, volumenes y ficheros
 */

import { bajaInstancia, slugValido } from './instancias.js';

const [slug, ...resto] = process.argv.slice(2);
if (!slug || slugValido(slug)) {
  console.error(slugValido(slug ?? '') ?? 'Uso: npm run saas:baja -- <nombre-corto> [--borrar-datos]');
  process.exit(1);
}
await bajaInstancia(slug, { borrarDatos: resto.includes('--borrar-datos') }, { log: (l) => console.log(`  ${l}`) });
console.log(resto.includes('--borrar-datos') ? `  ${slug}: contenedor, base y datos borrados.` : `  ${slug}: parada. Sus datos siguen; --borrar-datos los quita.`);
