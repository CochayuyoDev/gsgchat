/**
 * Uso:
 *   npm run templates:lint    revisa el catalogo sin tocar nada
 *   npm run templates:push    revisa y, si no hay errores, las sube a Meta
 *
 * El push se niega a subir una plantilla con errores de lint: un rechazo de
 * Meta no es gratis, cuenta en el historial de la cuenta.
 */

import { loadConfig } from '../config.js';
import { createWhatsAppClient, WhatsAppApiError } from '../whatsapp/client.js';
import { CATALOG } from './catalog.js';
import { hasErrors, lintTemplate } from './lint.js';

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

const config = loadConfig();
const wa = createWhatsAppClient({
  token: config.WHATSAPP_TOKEN,
  phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID,
  businessAccountId: config.WHATSAPP_BUSINESS_ACCOUNT_ID,
  graphVersion: config.GRAPH_API_VERSION,
});

for (const template of clean) {
  try {
    const result = await wa.createTemplate({
      name: template.name,
      language: template.language,
      category: template.category,
      body: template.body,
      // Los ejemplos que ve el revisor de Meta salen de la documentacion
      // de cada variable del catalogo.
      examples: template.variables.map((description) => `[${description}]`),
      footer: template.footer,
    });
    console.log(`  ALTA     ${template.name} -> ${result.status} (${result.id})`);
  } catch (error) {
    const detail =
      error instanceof WhatsAppApiError ? `${error.message} (code ${error.code})` : String(error);
    console.error(`  FALLO    ${template.name}: ${detail}`);
  }
}
