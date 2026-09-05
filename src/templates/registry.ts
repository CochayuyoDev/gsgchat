/**
 * Sincroniza el catalogo de plantillas de Meta a la tabla local.
 *
 * El registro local es lo que consultan los gates antes de cada envio. Si
 * Meta rechaza o pausa una plantilla y el registro no se entera, el sistema
 * sigue intentando enviarla y cada rechazo empuja la calidad hacia abajo.
 */

import type { Repos, Template, TemplateCategory, TemplateQuality, TemplateStatus } from '../db/repos.js';
import type { WhatsAppClient } from '../whatsapp/client.js';
import { countVariables } from './render.js';

const STATUSES: TemplateStatus[] = ['APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED'];
const CATEGORIES: TemplateCategory[] = ['MARKETING', 'UTILITY', 'AUTHENTICATION'];

function normalizeStatus(value: string | undefined): TemplateStatus {
  const upper = (value ?? '').toUpperCase();
  if (STATUSES.includes(upper as TemplateStatus)) return upper as TemplateStatus;
  // PAUSED y DISABLED llegan a veces con sufijos; cualquier cosa que no sea
  // aprobada explicitamente se trata como no enviable.
  if (upper.includes('PAUSE')) return 'PAUSED';
  if (upper.includes('DISABLE')) return 'DISABLED';
  return 'PENDING';
}

function normalizeCategory(value: string | undefined): TemplateCategory {
  const upper = (value ?? '').toUpperCase();
  return CATEGORIES.includes(upper as TemplateCategory) ? (upper as TemplateCategory) : 'UTILITY';
}

function normalizeQuality(value: string | undefined): TemplateQuality {
  const upper = (value ?? '').toUpperCase();
  if (upper === 'GREEN' || upper === 'YELLOW' || upper === 'RED') return upper;
  return 'UNKNOWN';
}

export async function syncTemplates(wa: WhatsAppClient, repos: Repos): Promise<Template[]> {
  const remote = await wa.listTemplates();
  const synced: Template[] = [];

  for (const item of remote) {
    const body = item.components?.find((c) => c.type?.toUpperCase() === 'BODY')?.text ?? '';
    const template: Template = {
      name: item.name,
      language: item.language,
      category: normalizeCategory(item.category),
      status: normalizeStatus(item.status),
      quality: normalizeQuality(item.quality_score?.score),
      variables: countVariables(body),
      body,
    };
    await repos.templates.upsert(template);
    synced.push(template);
  }

  return synced;
}
