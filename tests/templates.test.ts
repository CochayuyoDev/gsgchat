import { describe, expect, it } from 'vitest';
import { countVariables, renderTemplate, TemplateRenderError } from '../src/templates/render.js';
import { hasErrors, lintTemplate } from '../src/templates/lint.js';
import { CATALOG, findInCatalog, type CatalogTemplate } from '../src/templates/catalog.js';
import { approvedTemplate } from './fakes.js';

describe('render de plantillas', () => {
  it('cuenta variables distintas', () => {
    expect(countVariables('Hola {{1}}, tu pedido {{2}} y de nuevo {{1}}')).toBe(2);
    expect(countVariables('Sin variables')).toBe(0);
  });

  it('sustituye y arma los componentes', () => {
    const rendered = renderTemplate(approvedTemplate(), ['Ana', 'A-1024', 'https://ej.mx/t/9']);
    expect(rendered.preview).toContain('Hola Ana');
    expect(rendered.preview).toContain('A-1024');
    expect(rendered.components[0]?.parameters).toHaveLength(3);
  });

  it('rechaza si faltan variables', () => {
    expect(() => renderTemplate(approvedTemplate(), ['Ana'])).toThrow(TemplateRenderError);
  });

  it('rechaza variables vacias', () => {
    expect(() => renderTemplate(approvedTemplate(), ['Ana', '  ', 'x'])).toThrow(TemplateRenderError);
  });

  it('rechaza saltos de linea, que Meta no acepta en parametros', () => {
    expect(() => renderTemplate(approvedTemplate(), ['Ana', 'A-1\n024', 'x'])).toThrow(
      /saltos de linea/,
    );
  });

  it('una plantilla sin variables no lleva componentes', () => {
    const template = approvedTemplate({ variables: 0, body: 'Aviso sin variables.' });
    expect(renderTemplate(template, []).components).toHaveLength(0);
  });
});

describe('catalogo', () => {
  it('las cuatro plantillas del catalogo pasan el lint sin errores', () => {
    for (const template of CATALOG) {
      const issues = lintTemplate(template);
      expect(hasErrors(issues), `${template.name}: ${JSON.stringify(issues)}`).toBe(false);
    }
  });

  it('las variables documentadas cuadran con el cuerpo', () => {
    for (const template of CATALOG) {
      expect(countVariables(template.body), template.name).toBe(template.variables.length);
    }
  });

  it('se puede buscar por nombre', () => {
    expect(findInCatalog('recuperacion_carrito')?.category).toBe('MARKETING');
  });
});

function draft(overrides: Partial<CatalogTemplate>): CatalogTemplate {
  return {
    name: 'prueba',
    language: 'es_MX',
    category: 'UTILITY',
    body: 'Hola {{1}}, tu cita es el {{2}}. Gracias.',
    variables: ['nombre', 'fecha'],
    ...overrides,
  };
}

describe('lint: reglas de aprobacion de Meta', () => {
  it('marketing sin opt-out es error', () => {
    const issues = lintTemplate(
      draft({
        category: 'MARKETING',
        body: 'Hola {{1}}, tenemos novedades de {{2}} para ti.',
        variables: ['nombre', 'tienda'],
      }),
    );
    expect(issues.some((i) => i.rule === 'missing_opt_out' && i.severity === 'error')).toBe(true);
  });

  it('marketing con BAJA pasa', () => {
    const issues = lintTemplate(
      draft({
        category: 'MARKETING',
        body: 'Hola {{1}}, novedades de {{2}}. Si no deseas recibir mas avisos, responde BAJA.',
        variables: ['nombre', 'tienda'],
      }),
    );
    expect(hasErrors(issues)).toBe(false);
  });

  it('detecta marketing disfrazado de utility', () => {
    const issues = lintTemplate(
      draft({
        category: 'UTILITY',
        body: 'Hola {{1}}, tenemos un descuento en {{2}} solo para ti. Aprovecha.',
        variables: ['nombre', 'producto'],
      }),
    );
    expect(issues.some((i) => i.rule === 'category_mismatch' && i.severity === 'error')).toBe(true);
  });

  it('avisa del lexico que dispara los filtros de spam', () => {
    const issues = lintTemplate(
      draft({ body: 'Hola {{1}}, ganaste un premio. Confirma el {{2}}.', variables: ['n', 'f'] }),
    );
    expect(issues.some((i) => i.rule === 'risky_wording')).toBe(true);
  });

  it('no admite empezar ni terminar con variable', () => {
    expect(
      lintTemplate(draft({ body: '{{1}}, tu cita es el {{2}}.', variables: ['n', 'f'] })).some(
        (i) => i.rule === 'variable_at_start',
      ),
    ).toBe(true);

    expect(
      lintTemplate(draft({ body: 'Hola {{1}}, tu cita es el {{2}}', variables: ['n', 'f'] })).some(
        (i) => i.rule === 'variable_at_end',
      ),
    ).toBe(true);
  });

  it('no admite dos variables seguidas', () => {
    const issues = lintTemplate(
      draft({ body: 'Hola {{1}} {{2}}, ya tienes tu cita.', variables: ['n', 'a'] }),
    );
    expect(issues.some((i) => i.rule === 'adjacent_variables')).toBe(true);
  });

  it('exige numeracion sin saltos', () => {
    const issues = lintTemplate(
      draft({ body: 'Hola {{1}}, tu cita es el {{3}}. Gracias.', variables: ['n', 'f'] }),
    );
    expect(issues.some((i) => i.rule === 'variable_sequence')).toBe(true);
  });

  it('avisa de mayusculas sostenidas y exclamaciones', () => {
    const issues = lintTemplate(
      draft({ body: 'Hola {{1}}, OFERTA IMPERDIBLE! Confirma el {{2}}! Gracias.', variables: ['n', 'f'] }),
    );
    expect(issues.some((i) => i.rule === 'shouting')).toBe(true);
    expect(issues.some((i) => i.rule === 'exclamations')).toBe(true);
  });

  it('valida el formato del nombre', () => {
    const issues = lintTemplate(draft({ name: 'Mi Plantilla' }));
    expect(issues.some((i) => i.rule === 'name_format' && i.severity === 'error')).toBe(true);
  });
});
