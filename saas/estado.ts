/**
 * Que instancias hay y si responden.
 *
 *   npm run saas:estado
 */

import { estadoInstancias } from './instancias.js';

const lista = await estadoInstancias();
if (!lista.length) {
  console.log('  No hay instancias. Crea una con: npm run saas:alta -- <nombre-corto>');
} else {
  for (const i of lista) {
    const estado = i.viva ? (i.configurado ? 'ok, WhatsApp vinculado' : 'ok, sin WhatsApp vinculado (falta /setup)') : `NO RESPONDE${i.detalle ? ': ' + i.detalle : ''}`;
    console.log(`  ${i.slug.padEnd(20)} ${i.url.padEnd(45)} ${estado}`);
  }
}
