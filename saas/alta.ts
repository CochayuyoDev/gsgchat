/**
 * Alta de una tienda en el SaaS.
 *
 *   npm run saas:alta -- tienda1 --nombre "Zapateria Lima" --proveedor local
 *
 * Crea su base, sus ficheros, su contenedor y su subdominio. Al terminar
 * imprime la URL: ahi se entra, se crea la primera cuenta y se conecta el
 * WhatsApp en /setup, como en cualquier instalacion.
 */

import { altaInstancia, construirImagen, prepararBase, slugValido } from './instancias.js';

const [slug, ...resto] = process.argv.slice(2);
if (!slug || slug.startsWith('--')) {
  console.error('Uso: npm run saas:alta -- <nombre-corto> [--nombre "Nombre del negocio"] [--proveedor local|cloud|waha] [--pais peru|mexico|generico] [--sin-imagen]');
  process.exit(1);
}
const mal = slugValido(slug);
if (mal) {
  console.error(mal);
  process.exit(1);
}
const opcion = (k: string) => {
  const i = resto.indexOf(`--${k}`);
  return i >= 0 ? resto[i + 1] : undefined;
};
const proveedor = opcion('proveedor');
const pais = opcion('pais');

const log = (l: string) => console.log(`  ${l}`);
if (!resto.includes('--sin-imagen')) await construirImagen({ log });
await prepararBase({ log });
const instancia = await altaInstancia(
  slug,
  {
    nombre: opcion('nombre'),
    proveedor: proveedor === 'cloud' || proveedor === 'waha' ? proveedor : 'local',
    pais: pais === 'mexico' || pais === 'generico' ? pais : pais === 'peru' ? 'peru' : undefined,
  },
  { log },
);
console.log(`
  Lista: ${instancia.nombre}
  ${instancia.url}/login      crear la primera cuenta
  ${instancia.url}/setup      conectar su WhatsApp (QR, Meta o WAHA)
  ${instancia.url}/panel#integraciones   claves, webhooks, conectores y chat embebido
`);
