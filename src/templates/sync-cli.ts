/**
 * Uso: npm run templates:sync
 *
 * Trae estado y calidad de cada plantilla desde Meta al registro local. Usa
 * las mismas credenciales que el servidor (las de /setup ganan sobre el .env).
 */
import { createRuntime } from '../runtime.js';
import { syncTemplates } from './registry.js';

const runtime = await createRuntime();

try {
  const missing = runtime.settings.missing();
  if (missing.length) {
    console.error(`WhatsApp no esta configurado (faltan: ${missing.join(', ')}). Completalo en /setup.`);
    process.exit(1);
  }

  const templates = await syncTemplates(runtime.wa, runtime.repos);
  for (const t of templates) {
    console.log(
      `${t.status.padEnd(9)} ${(t.quality ?? 'UNKNOWN').padEnd(7)} ${t.category.padEnd(14)} ${t.name} (${t.language}) - ${t.variables} vars`,
    );
  }
  console.log(`\n${templates.length} plantillas sincronizadas.`);
} finally {
  await runtime.close();
}
