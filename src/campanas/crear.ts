/**
 * Crear una campaña por goteo: la plantilla, los destinatarios con sus
 * variables, el canario y el ritmo. Lo usan la pantalla de campañas (lista
 * pegada o todos los que tienen opt-in) y la de grupos (un criterio).
 */

import type { Repos, TemplateCategory } from '../db/repos.js';
import { canarioPorDefecto, ordenarPorCompromiso } from './goteo.js';

export interface NuevaCampana {
  name: string;
  templateName: string;
  templateLanguage: string;
  category: TemplateCategory;
  /** Sin destinatarios explicitos: todos los que tienen opt-in vigente. */
  recipients?: Array<{ phone: string; variables: string[] }>;
  ritmoPorHora?: number | null;
  canario?: number;
  canarioEsperaMin?: number;
}

export type ResultadoCrear =
  | { ok: true; campaignId: string; enqueued: number; canario: number; ritmoPorHora: number | null }
  | { ok: false; error: string };

export async function crearCampana(repos: Repos, input: NuevaCampana): Promise<ResultadoCrear> {
  const template = await repos.templates.get(input.templateName, input.templateLanguage);
  if (!template) return { ok: false, error: 'la plantilla no existe en el registro local' };
  if (template.status !== 'APPROVED') return { ok: false, error: `la plantilla esta en estado ${template.status}` };

  // Sin destinatarios explicitos se usa la lista con opt-in vigente. En
  // ningun caso se envia a quien no lo tenga: el gate lo bloquearia igual,
  // pero encolarlo solo ensucia las metricas.
  const variablesPorPhone = new Map<string, string[]>();
  const contactos: Array<{ phone: string; lastInboundAt: Date | null; optInAt: Date | null }> = [];
  if (input.recipients?.length) {
    for (const r of input.recipients) {
      if (variablesPorPhone.has(r.phone)) continue;
      variablesPorPhone.set(r.phone, r.variables);
      const c = await repos.contacts.getByPhone(r.phone);
      contactos.push({ phone: r.phone, lastInboundAt: c?.lastInboundAt ?? null, optInAt: c?.optInAt ?? null });
    }
  } else {
    for (let offset = 0; ; offset += 500) {
      const page = await repos.contacts.listOptedIn(500, offset);
      if (!page.length) break;
      for (const c of page) {
        variablesPorPhone.set(c.phone, []);
        contactos.push({ phone: c.phone, lastInboundAt: c.lastInboundAt, optInAt: c.optInAt });
      }
    }
  }

  const canario = input.canario ?? canarioPorDefecto(contactos.length);
  const campaignId = await repos.campaigns.create({
    name: input.name,
    templateName: input.templateName,
    templateLanguage: input.templateLanguage,
    category: input.category,
    ritmoPorHora: input.ritmoPorHora ?? null,
    canario,
    canarioEsperaMin: input.canarioEsperaMin ?? 60,
  });

  const ordenados = ordenarPorCompromiso(contactos);
  const enqueued = await repos.campaigns.agregarDestinatarios(
    campaignId,
    ordenados.map((c, i) => ({
      phone: c.phone,
      variables: variablesPorPhone.get(c.phone) ?? [],
      orden: i,
      canario: i < canario,
    })),
  );

  await repos.campaigns.setStatus(campaignId, !enqueued ? 'empty' : canario > 0 ? 'canary' : 'running');
  return { ok: true, campaignId, enqueued, canario, ritmoPorHora: input.ritmoPorHora ?? null };
}
