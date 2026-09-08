/**
 * Alta de plantillas en Meta, compartida por el CLI y el panel.
 *
 * Cada plantilla pasa por el linter antes de salir: un rechazo de Meta no es
 * gratis, cuenta en el historial de la cuenta. Las que se dan de alta quedan
 * en el registro local como PENDING para que el panel las muestre sin
 * esperar a la sincronizacion.
 */

import type { Repos, TemplateStatus } from '../db/repos.js';
import { WhatsAppApiError, type WhatsAppClient } from '../whatsapp/client.js';
import type { CatalogTemplate } from './catalog.js';
import { hasErrors, lintTemplate, type LintIssue } from './lint.js';
import { countVariables } from './render.js';

export interface PushResult {
  name: string;
  language: string;
  ok: boolean;
  /** Estado que devolvio Meta (normalmente PENDING). */
  status?: string;
  id?: string;
  error?: string;
  issues: LintIssue[];
}

function normalizeStatus(value: string | undefined): TemplateStatus {
  const upper = (value ?? '').toUpperCase();
  if (upper.includes('APPROVE')) return 'APPROVED';
  if (upper.includes('REJECT')) return 'REJECTED';
  if (upper.includes('PAUSE')) return 'PAUSED';
  if (upper.includes('DISABLE')) return 'DISABLED';
  return 'PENDING';
}

export async function pushTemplates(
  wa: WhatsAppClient,
  repos: Repos,
  templates: CatalogTemplate[],
): Promise<PushResult[]> {
  const results: PushResult[] = [];

  for (const template of templates) {
    const issues = lintTemplate(template);
    if (hasErrors(issues)) {
      results.push({
        name: template.name,
        language: template.language,
        ok: false,
        error: 'tiene errores de lint: no se sube',
        issues,
      });
      continue;
    }

    try {
      const created = await wa.createTemplate({
        name: template.name,
        language: template.language,
        category: template.category,
        body: template.body,
        // Los ejemplos que ve el revisor de Meta salen de la documentacion
        // de cada variable del catalogo.
        examples: template.variables.map((description) => `[${description}]`),
        footer: template.footer,
      });

      const status = normalizeStatus(created.status);
      const existing = await repos.templates.get(template.name, template.language);
      await repos.templates.upsert({
        name: template.name,
        language: template.language,
        category: template.category,
        status,
        quality: existing?.quality ?? null,
        variables: countVariables(template.body),
        body: template.body,
      });

      results.push({
        name: template.name,
        language: template.language,
        ok: true,
        status,
        id: created.id,
        issues,
      });
    } catch (error) {
      const detail =
        error instanceof WhatsAppApiError
          ? `${error.message}${error.code ? ` (code ${error.code})` : ''}`
          : error instanceof Error
            ? error.message
            : String(error);
      results.push({ name: template.name, language: template.language, ok: false, error: detail, issues });
    }
  }

  return results;
}
