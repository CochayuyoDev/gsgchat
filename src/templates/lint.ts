/**
 * Linter de plantillas: las reglas de aprobacion de Meta, como codigo.
 *
 * Cada rechazo de plantilla es tiempo perdido, y una plantilla mal
 * categorizada (marketing disfrazado de utility) no solo se rechaza: baja
 * la calidad del numero. Sale mas barato fallar aqui que en el revisor.
 */

import type { CatalogTemplate } from './catalog.js';

export type LintSeverity = 'error' | 'warning';

export interface LintIssue {
  severity: LintSeverity;
  rule: string;
  message: string;
}

/**
 * Lexico que dispara los filtros de spam de Meta. No es una lista oficial;
 * es el patron que comparten los rechazos mas comunes.
 */
const RISKY_WORDS = [
  'gratis',
  'gratuito',
  'urgente',
  'premio',
  'premio mayor',
  'ganaste',
  'ganador',
  'sorteo',
  'loteria',
  'dinero facil',
  'ingresos garantizados',
  'garantizado',
  '100% seguro',
  'sin riesgo',
  'ultima oportunidad',
  'solo por hoy',
  'oferta unica',
  'haz clic aqui',
  'click aqui',
  'felicidades',
  'has sido seleccionado',
  'credito preaprobado',
  'prestamo inmediato',
];

/** Palabras que valen como baja para el usuario. */
const OPT_OUT_HINTS = ['baja', 'parar', 'stop', 'cancelar', 'no deseas recibir', 'unsubscribe'];

/** Lexico promocional: si aparece, la plantilla no es UTILITY. */
const PROMO_HINTS = [
  'descuento',
  'promocion',
  'oferta',
  'rebaja',
  'cupon',
  'compra ahora',
  'aprovecha',
  'carrito',
  '% off',
];

const VARIABLE_RE = /\{\{(\d+)\}\}/g;

const fold = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

export function lintTemplate(template: CatalogTemplate): LintIssue[] {
  const issues: LintIssue[] = [];
  const body = template.body;
  const folded = fold(body);

  const push = (severity: LintSeverity, rule: string, message: string) =>
    issues.push({ severity, rule, message });

  // --- nombre y longitud ------------------------------------------------
  if (!/^[a-z0-9_]{1,512}$/.test(template.name)) {
    push('error', 'name_format', 'el nombre solo admite minusculas, numeros y guion bajo');
  }
  if (body.length > 1024) {
    push('error', 'body_length', `el cuerpo tiene ${body.length} caracteres y el maximo es 1024`);
  }
  if (!body.trim()) {
    push('error', 'body_empty', 'el cuerpo esta vacio');
  }

  // --- variables --------------------------------------------------------
  const indexes = [...body.matchAll(VARIABLE_RE)].map((m) => Number.parseInt(m[1]!, 10));
  const unique = [...new Set(indexes)].sort((a, b) => a - b);

  for (const [position, index] of unique.entries()) {
    if (index !== position + 1) {
      push('error', 'variable_sequence', `las variables deben ir de {{1}} a {{n}} sin saltos (falta {{${position + 1}}})`);
      break;
    }
  }

  if (unique.length !== template.variables.length) {
    push(
      'error',
      'variable_docs',
      `el cuerpo usa ${unique.length} variables pero se documentaron ${template.variables.length}`,
    );
  }

  // Meta rechaza plantillas que empiezan o terminan con variable: sin texto
  // alrededor no puede juzgar el contenido.
  if (/^\s*\{\{\d+\}\}/.test(body)) {
    push('error', 'variable_at_start', 'el cuerpo no puede empezar con una variable');
  }
  if (/\{\{\d+\}\}\s*$/.test(body)) {
    push('error', 'variable_at_end', 'el cuerpo no puede terminar con una variable');
  }
  if (/\{\{\d+\}\}[\s,.;:-]*\{\{\d+\}\}/.test(body)) {
    push('error', 'adjacent_variables', 'no puede haber dos variables seguidas sin texto entre ellas');
  }

  // --- lexico -----------------------------------------------------------
  for (const word of RISKY_WORDS) {
    if (folded.includes(word)) {
      push('warning', 'risky_wording', `"${word}" es lexico que dispara los filtros de spam`);
    }
  }

  const shouty = body.match(/\b[A-ZÁÉÍÓÚÑ]{4,}\b/g)?.filter((w) => !OPT_OUT_HINTS.includes(fold(w)));
  if (shouty?.length) {
    push('warning', 'shouting', `evita mayusculas sostenidas: ${[...new Set(shouty)].join(', ')}`);
  }
  if ((body.match(/!/g) ?? []).length > 1) {
    push('warning', 'exclamations', 'demasiados signos de exclamacion');
  }

  // --- categoria y opt-out ---------------------------------------------
  const hasOptOut = OPT_OUT_HINTS.some((hint) => folded.includes(hint));

  if (template.category === 'MARKETING' && !hasOptOut) {
    push(
      'error',
      'missing_opt_out',
      'una plantilla de marketing tiene que decir como darse de baja (por ejemplo: responde BAJA)',
    );
  }

  const promo = PROMO_HINTS.filter((hint) => folded.includes(hint));
  if (template.category === 'UTILITY' && promo.length) {
    push(
      'error',
      'category_mismatch',
      `esto suena a marketing (${promo.join(', ')}) y esta declarado como UTILITY; Meta lo reclasifica y penaliza la calidad`,
    );
  }

  return issues;
}

export function hasErrors(issues: LintIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}

export function lintCatalog(templates: CatalogTemplate[]): Map<string, LintIssue[]> {
  return new Map(templates.map((t) => [`${t.name}/${t.language}`, lintTemplate(t)]));
}
