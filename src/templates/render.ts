/**
 * Render y validacion de plantillas de Meta.
 *
 * Meta rechaza el envio si el numero de variables no cuadra con la plantilla
 * aprobada, y una plantilla rechazada repetidamente arrastra la calidad del
 * numero. Sale mas barato validar aqui que descubrirlo en el envio 3.000.
 */

import type { Template } from '../db/repos.js';
import type { TemplateComponent } from '../whatsapp/types.js';

const VARIABLE_RE = /\{\{(\d+)\}\}/g;

/** Cuenta cuantas variables distintas usa el cuerpo de una plantilla. */
export function countVariables(body: string): number {
  const indexes = new Set<number>();
  for (const match of body.matchAll(VARIABLE_RE)) {
    indexes.add(Number.parseInt(match[1]!, 10));
  }
  return indexes.size;
}

export class TemplateRenderError extends Error {}

export interface RenderedTemplate {
  name: string;
  language: string;
  components: TemplateComponent[];
  /** Texto final, para guardar en la entrega y poder auditar que se mando. */
  preview: string;
}

/**
 * Sustituye {{1}}..{{n}} y arma los `components` del envio.
 * `variables` va en orden: la primera entrada es {{1}}.
 */
export function renderTemplate(template: Template, variables: string[] = []): RenderedTemplate {
  const expected = template.variables;

  if (variables.length !== expected) {
    throw new TemplateRenderError(
      `la plantilla "${template.name}" espera ${expected} variables y recibio ${variables.length}`,
    );
  }

  for (const [index, value] of variables.entries()) {
    if (value === undefined || value === null || value.trim() === '') {
      throw new TemplateRenderError(`la variable {{${index + 1}}} viene vacia`);
    }
    // Meta rechaza parametros con saltos de linea o tabuladores.
    if (/[\n\r\t]/.test(value)) {
      throw new TemplateRenderError(
        `la variable {{${index + 1}}} tiene saltos de linea; Meta los rechaza`,
      );
    }
    if (value.length > 1024) {
      throw new TemplateRenderError(`la variable {{${index + 1}}} supera 1024 caracteres`);
    }
  }

  const preview = (template.body ?? '').replace(VARIABLE_RE, (_match, index: string) => {
    return variables[Number.parseInt(index, 10) - 1] ?? '';
  });

  const components: TemplateComponent[] = variables.length
    ? [{ type: 'body', parameters: variables.map((text) => ({ type: 'text' as const, text })) }]
    : [];

  return { name: template.name, language: template.language, components, preview };
}
