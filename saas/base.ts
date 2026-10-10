/**
 * Levanta (o actualiza) lo comun del SaaS: Caddy y Postgres, y construye la
 * imagen de la app. Se puede repetir cuando se quiera; es idempotente.
 *
 *   npm run saas:base
 */

import { construirImagen, prepararBase } from './instancias.js';

const log = (l: string) => console.log(`  ${l}`);
if (!process.argv.includes('--sin-imagen')) await construirImagen({ log });
await prepararBase({ log });
console.log('  Base del SaaS lista. Siguiente: npm run saas:alta -- <nombre-corto>');
