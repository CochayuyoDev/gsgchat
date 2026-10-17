/**
 * Escribe la coleccion y el entorno de Postman en docs/postman, desde el
 * mismo codigo que usan el Manual y Nuestra API (src/web/postman-coleccion.ts).
 *
 *   npx tsx scripts/generar-postman.ts
 *
 * tests/postman-coleccion.test.ts falla si el archivo y el codigo no coinciden.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { coleccionPostman, entornoPostman } from '../src/web/postman-coleccion.js';

const carpeta = new URL('../docs/postman/', import.meta.url);
mkdirSync(carpeta, { recursive: true });
writeFileSync(new URL('gsgchat.postman_collection.json', carpeta), JSON.stringify(coleccionPostman(), null, 2) + '\n');
writeFileSync(new URL('gsgchat.postman_environment.json', carpeta), JSON.stringify(entornoPostman(), null, 2) + '\n');
console.log('docs/postman: colección y entorno escritos');
