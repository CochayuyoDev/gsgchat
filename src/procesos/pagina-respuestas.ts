/**
 * /respuestas: lo que respondio cada persona, en una tabla por proceso (una
 * columna por paso), lista para revisar o exportar a Excel. Las ubicaciones
 * llevan su enlace al mapa y las fotos o capturas, su enlace para abrirlas.
 */

import { appShell } from '../web/shell.js';
import { COMUN_CSS, COMUN_JS } from './pagina-comun.js';

const CSS = `
  .controles { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: var(--esp-3); align-items: center; }
  .controles select, .controles input { flex: 1 1 220px; min-height: 44px; padding: 8px 14px; border: 1px solid var(--borde); border-radius: var(--radio-sm); font: inherit; background: var(--superficie); color: var(--texto); min-width: 0; }
  .tabla-scroll { overflow-x: auto; background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); box-shadow: var(--sombra); }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--borde); vertical-align: top; }
  th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--texto-suave); font-weight: 700; white-space: nowrap; }
  tr:last-child td { border-bottom: 0; }
  td .sub { color: var(--texto-suave); font-size: var(--fs-small); margin-top: 3px; overflow-wrap: anywhere; }
  td a { color: var(--primario); }
  td.mensaje { color: var(--texto-suave); text-align: center; padding: 24px; }
  td.resp { min-width: 140px; overflow-wrap: anywhere; }
  @media (max-width: 760px) {
    .tabla-scroll { overflow: visible; background: transparent; border: 0; box-shadow: none; }
    .tabla-scroll thead { display: none; }
    .tabla-scroll table, .tabla-scroll tbody, .tabla-scroll tr, .tabla-scroll td { display: block; }
    .tabla-scroll tr.fila { border: 1px solid var(--borde); border-radius: var(--radio); margin: 0 0 10px; padding: 10px 12px; background: var(--superficie); box-shadow: var(--sombra); }
    .tabla-scroll tr.fila td { border: 0; padding: 3px 0; min-width: 0; }
    .tabla-scroll td.resp::before { content: attr(data-titulo) ': '; font-weight: 600; color: var(--texto-suave); }
  }
`;

export function respuestasPage(opts: { demo: boolean; nombreNegocio: string }): string {
  const contenido = `
<div class="wrap">
${opts.demo ? '<div class="demo">Demostración: nada sale a WhatsApp de verdad.</div>' : ''}
<div class="resultado" id="resultado" role="status" aria-live="polite"></div>
<div class="controles">
  <select id="proceso" aria-label="Elegir el proceso"></select>
  <input type="search" id="buscar" placeholder="Buscar por nombre, teléfono o respuesta" aria-label="Buscar" autocomplete="off">
  <a class="btn" id="exportar" href="/admin/procesos/exportar">⬇ Exportar CSV</a>
</div>
<div class="tabla-scroll"><table><thead id="cab"></thead><tbody id="filas"><tr><td class="mensaje">Cargando…</td></tr></tbody></table></div>
</div>
`;

  const script = String.raw`
${COMUN_JS}
var datos = null;
var procesoSel = paramUrl('proceso') || '';

function pasosDe(id) {
  var p = (datos.procesos || []).filter(function (x) { return String(x.id) === String(id); })[0];
  return p ? p.pasos : [];
}
function pintar() {
  var sel = document.getElementById('proceso');
  if (!datos.procesos.length) {
    document.getElementById('cab').innerHTML = '';
    document.getElementById('filas').innerHTML = '<tr><td class="mensaje">Todavía no hay procesos. <a href="/procesos">Crea uno desde una plantilla</a>.</td></tr>';
    return;
  }
  /* Por defecto, el proceso con la respuesta más reciente. */
  if (!procesoSel) procesoSel = String(datos.personas.length ? datos.personas[0].procesoId : datos.procesos[0].id);
  sel.innerHTML = datos.procesos.map(function (p) { return '<option value="' + p.id + '"' + (String(p.id) === procesoSel ? ' selected' : '') + '>' + esc(p.nombre) + '</option>'; }).join('');
  document.getElementById('exportar').setAttribute('href', '/admin/procesos/exportar?procesoId=' + encodeURIComponent(procesoSel));
  var pasos = pasosDe(procesoSel);
  document.getElementById('cab').innerHTML = '<tr><th>Persona</th><th>Estado</th>' + pasos.map(function (p) { return '<th>' + esc(p.titulo) + '</th>'; }).join('') + '</tr>';
  var q = document.getElementById('buscar').value.trim().toLowerCase();
  var lista = datos.personas.filter(function (p) {
    if (String(p.procesoId) !== procesoSel) return false;
    if (!q) return true;
    var texto = [p.nombre, p.telefono].concat(p.respuestas.map(function (r) { return r.texto; })).join(' ').toLowerCase();
    return texto.indexOf(q) >= 0;
  });
  if (!lista.length) {
    document.getElementById('filas').innerHTML = '<tr><td colspan="' + (pasos.length + 2) + '" class="mensaje">' + (q ? 'Nadie coincide con lo que buscas.' : 'Todavía nadie respondió en este proceso.') + '</td></tr>';
    return;
  }
  document.getElementById('filas').innerHTML = lista.map(function (p) {
    var porTitulo = {};
    p.respuestas.forEach(function (r) { porTitulo[r.titulo] = r; });
    return '<tr class="fila"><td><b>' + esc(p.nombre || 'Sin nombre') + '</b><div class="sub">' + esc(telBonito(p.telefono)) + '</div></td>' +
      '<td>' + chip(p.tono, p.estadoNombre) + '</td>' +
      pasos.map(function (x) {
        var r = porTitulo[x.titulo];
        return '<td class="resp" data-titulo="' + esc(x.titulo) + '">' + (r ? esc(r.texto) + (r.enlace ? ' · <a href="' + esc(r.enlace) + '" target="_blank" rel="noopener">' + esc(r.enlaceTexto || 'Ver') + '</a>' : '') + '<div class="sub">' + esc(fechaCorta(r.en)) + '</div>' : '<span class="muted">—</span>') + '</td>';
      }).join('') + '</tr>';
  }).join('');
}
async function cargar() {
  datos = await api('/admin/procesos/personas?respuestas=1&limit=5000');
  pintar();
}
document.getElementById('proceso').addEventListener('change', function (ev) { procesoSel = ev.target.value; pintar(); });
document.getElementById('buscar').addEventListener('input', function () { if (datos) pintar(); });
cargar().catch(function (e) { document.getElementById('filas').innerHTML = '<tr><td class="mensaje">' + esc(e.message) + '</td></tr>'; });
setInterval(function () { if (!document.hidden) cargar().catch(function () {}); }, 15000);
`;

  return appShell({
    titulo: 'Respuestas',
    subtitulo: 'Lo que respondió cada persona, paso por paso',
    contenido,
    script,
    css: COMUN_CSS + CSS,
    nombreNegocio: opts.nombreNegocio,
    demo: opts.demo,
    icono: '🗂️',
  });
}
