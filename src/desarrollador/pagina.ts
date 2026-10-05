/**
 * /desarrollador: las tres pestañas del Modulo desarrollador en una pagina.
 * Cada pestaña es su propia seccion (generar.ts, vivo.ts, listo.ts); aqui
 * solo se juntan y se elige la del ancla (#generar, #vivo, #listo).
 */

import { appShell } from '../web/shell.js';
import { escapeHtml } from '../web/login-page.js';
import { seccionGenerar } from './generar.js';
import { seccionVivo } from './vivo.js';
import { seccionListo } from './listo.js';
import { seccionProcesos } from './procesos.js';

const SECCIONES = [seccionGenerar, seccionProcesos];

const CSS = `
  .muted { color: var(--texto-suave); }
  .dev-aviso { display: flex; gap: var(--esp-2); align-items: flex-start; padding: 12px 14px; border-radius: var(--radio); background: var(--azul-suave); color: var(--texto); margin-bottom: var(--esp-3); font-size: 14px; line-height: 1.45; }
  .dev-aviso > span:first-child { font-size: 18px; line-height: 1.2; flex: none; }
  /* Las pestañas son los tres pasos del modulo: numeradas, del mismo ancho y
     sin salirse de la pantalla en un movil. */
  .dev-tabs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--esp-2); margin-bottom: var(--esp-3); }
  @media (max-width: 760px) { .dev-tabs { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .dev-tabs a { min-height: 56px; display: flex; align-items: center; gap: 10px; padding: 8px 12px; border: 1px solid var(--borde); border-radius: var(--radio); background: var(--superficie); color: var(--texto-suave); text-decoration: none; font-weight: 600; line-height: 1.25; min-width: 0; }
  .dev-tabs a:hover { border-color: var(--primario); color: var(--texto); }
  .dev-tabs a[aria-selected="true"] { color: var(--texto); border-color: var(--primario); background: var(--primario-suave); box-shadow: inset 0 -3px 0 var(--primario); }
  .dev-paso { flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; font-weight: 800; background: var(--superficie-2); color: var(--texto-suave); }
  .dev-tabs a[aria-selected="true"] .dev-paso { background: var(--primario); color: var(--primario-texto); }
  .dev-tab-txt { min-width: 0; overflow-wrap: anywhere; }
  .dev-seccion[hidden] { display: none; }
  .dev-resumen { color: var(--texto-suave); margin: 0 0 var(--esp-3); }
  @media (max-width: 560px) {
    .dev-tabs { gap: 6px; }
    .dev-tabs a { flex-direction: column; justify-content: center; text-align: center; gap: 4px; padding: 8px 6px; font-size: 12.5px; }
  }
`;

export function desarrolladorPage(opts: { nombreNegocio: string; demo: boolean; esAdmin: boolean }): string {
  const contenido = opts.esAdmin
    ? `
<div class="dev-aviso" role="note"><span aria-hidden="true">🧪</span><span><b>Todo lo de aquí es de prueba.</b> Los clientes de prueba usan números reservados (51 000 0…) que <b>nunca</b> salen al WhatsApp real, y lo que se manda a GSG va a su simulador.</span></div>
<nav class="dev-tabs" role="tablist" aria-label="Partes del módulo desarrollador">
  ${SECCIONES.map((s, i) => `<a href="#${s.id}" role="tab" id="tab-${s.id}" aria-controls="sec-${s.id}"><span class="dev-paso" aria-hidden="true">${i + 1}</span><span class="dev-tab-txt">${escapeHtml(s.titulo)}</span></a>`).join('\n  ')}
</nav>
${SECCIONES.map((s) => `<section class="dev-seccion" id="sec-${s.id}" role="tabpanel" aria-labelledby="tab-${s.id}" hidden>
  <p class="dev-resumen">${escapeHtml(s.resumen)}</p>
  ${s.html}
</section>`).join('\n')}`
    : '<div class="vacio"><b>Solo para administradores.</b> Pídele a quien administra la tienda que entre él, o que te cambie el rol en Equipo.</div>';

  const script = opts.esAdmin
    ? String.raw`
(function () {
  var ids = ['generar', 'vivo', 'listo', 'procesos'];
  function mostrar() {
    var id = (location.hash || '#generar').slice(1);
    if (ids.indexOf(id) < 0) id = 'generar';
    ids.forEach(function (x) {
      document.getElementById('sec-' + x).hidden = x !== id;
      document.getElementById('tab-' + x).setAttribute('aria-selected', x === id ? 'true' : 'false');
    });
    document.dispatchEvent(new CustomEvent('dev:pestana', { detail: id }));
  }
  window.addEventListener('hashchange', mostrar);
  mostrar();
})();
` + SECCIONES.map((s) => `\n;(function () {\n${s.js}\n})();\n`).join('')
    : '';

  return appShell({
    titulo: 'Módulo desarrollador',
    subtitulo: 'Probar todo de punta a punta, sin WhatsApp real',
    contenido: `<div class="wrap">${contenido}</div>`,
    script,
    css: CSS + SECCIONES.map((s) => s.css ?? '').join('\n'),
    nombreNegocio: opts.nombreNegocio,
    demo: opts.demo,
    icono: '🧪',
  });
}
