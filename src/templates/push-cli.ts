/**
 * Uso:
 *   npm run templates:lint    revisa el catalogo sin tocar nada
 *   npm run templates:push    revisa y, si no hay errores, las sube a Meta
 *
 * El push se niega a subir una plantilla con errores de lint: un rechazo de
 * Meta no es gratis, cuenta en el historial de la cuenta. Usa las mismas
 * credenciales que el servidor (las pegadas en /setup ganan sobre el .env).
 */

import { createRuntime } from '../runtime.js';
import { CATALOG } from './catalog.js';
import { hasErrors, lintTemplate } from './lint.js';
import { pushTemplates } from './push.js';

const dryRun = process.argv.includes('--lint') || !process.argv.includes('--push');

let blocking = 0;
const clean: typeof CATALOG = [];

for (const template of CATALOG) {
  const issues = lintTemplate(template);
  const label = `${template.name} (${template.category})`;

  if (!issues.length) {
    console.log(`  OK       ${label}`);
    clean.push(template);
    continue;
  }

  console.log(`  REVISAR  ${label}`);
  for (const issue of issues) {
    console.log(`             ${issue.severity === 'error' ? 'ERROR  ' : 'aviso  '} [${issue.rule}] ${issue.message}`);
  }

  if (hasErrors(issues)) blocking++;
  else clean.push(template);
}

console.log(
  `\n${CATALOG.length} plantillas revisadas, ${blocking} con errores, ${clean.length} listas para subir.`,
);

if (dryRun) {
  console.log('Modo revision. Anade --push para darlas de alta en Meta.');
  process.exit(blocking ? 1 : 0);
}

if (blocking) {
  console.error('\nHay errores de lint: no se sube nada. Corrigelos primero.');
  process.exit(1);
}

const runtime = await createRuntime();
try {
  const missing = runtime.settings.missing();
  if (missing.length) {
    console.error(`\nWhatsApp no esta configurado (faltan: ${missing.join(', ')}). Completalo en /setup.`);
    process.exit(1);
  }

  const results = await pushTemplates(runtime.wa, runtime.repos, clean);
  for (const result of results) {
    if (result.ok) console.log(`  ALTA     ${result.name} -> ${result.status} (${result.id})`);
    else console.error(`  FALLO    ${result.name}: ${result.error}`);
  }
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
} finally {
  await runtime.close();
}
