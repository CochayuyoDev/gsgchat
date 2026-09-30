/**
 * Dos cuadros de dialogo mas, para las pantallas de Hoy y Motorizados:
 *
 *  - `elegirOpcion`: una pregunta y una lista de botones (elegir un
 *    motorizado, elegir que hacer). Nada de "escribe el numero interno".
 *  - `pedirVarios`: varios campos en UN solo cuadro (nombre, WhatsApp,
 *    placa, distritos...), con el prefijo +51 fijo en los telefonos,
 *    casillas para elegir de una lista y validacion campo a campo.
 *
 * Mismo aspecto que `pedirDato` (src/web/dialogo.ts): reutiliza `.dlg-fondo`
 * y `.dlg`. Se pega `DIALOGO_ELEGIR_CSS` en el <style> de la pagina y
 * `DIALOGO_ELEGIR_JS` en su script. Sin backticks ni `${` dentro del JS.
 */

export const DIALOGO_ELEGIR_CSS = `
  .dlg.elegir { width: min(480px, 100%); }
  .dlg .opciones { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; max-height: 52vh; overflow: auto; }
  .dlg .dlg-opcion { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; text-align: left; padding: 10px 14px; border: 1px solid var(--borde, #e3e5e9); border-radius: var(--radio-sm, 9px); background: var(--superficie, #fff); color: var(--texto, #111b21); font: inherit; cursor: pointer; min-height: 44px; }
  .dlg .dlg-opcion:hover, .dlg .dlg-opcion:focus-visible { border-color: var(--primario, #0a7f55); background: var(--primario-suave, #e2f4ea); }
  .dlg .dlg-opcion.destacada { border-color: var(--primario, #0a7f55); background: var(--primario-suave, #e2f4ea); }
  .dlg .dlg-opcion b { font-weight: 600; }
  .dlg .dlg-opcion small { color: var(--texto-suave, #667781); font-size: 12.5px; }
  .dlg .dlg-opcion.peligrosa { color: var(--rojo, #dc2626); }
  .dlg.varios { width: min(520px, 100%); }
  .dlg .campo { margin-top: 12px; }
  .dlg .campo:first-child { margin-top: 0; }
  .dlg .campo .opcional { font-weight: 400; color: var(--texto-suave, #667781); }
  .dlg .campo .mal { display: none; }
  .dlg .campo.con-error .mal { display: block; }
  .dlg .campo.con-error input, .dlg .campo.con-error textarea { border-color: var(--rojo, #dc2626); }
  .dlg .casillas { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 4px 10px; max-height: 190px; overflow: auto; padding: 8px 10px; border: 1px solid var(--borde, #e3e5e9); border-radius: var(--radio-sm, 9px); background: var(--superficie, #fff); }
  .dlg .casillas label { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 13.5px; color: var(--texto, #111b21); cursor: pointer; min-height: 28px; }
  .dlg .casillas input { width: 16px; height: 16px; margin: 0; accent-color: var(--primario, #0a7f55); }
  .dlg .casillas-buscar { margin-bottom: 6px; }
  .dlg select { width: 100%; font: inherit; font-size: 15px; padding: 11px 12px; border: 1px solid var(--borde, #e3e5e9); border-radius: var(--radio-sm, 9px); background: var(--superficie, #fff); color: var(--texto, #111b21); }
  @media (max-width: 640px) { .dlg .casillas { grid-template-columns: 1fr 1fr; } }
`;

export const DIALOGO_ELEGIR_JS = String.raw`
function dlgEsc(v) { return String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/**
 * Una pregunta y una lista de botones. Devuelve el valor de la opcion elegida
 * o null si se cancela. opciones: titulo, texto, opciones [{valor, etiqueta,
 * detalle, principal, peligro}], cancelar (texto del boton de cancelar).
 */
function elegirOpcion(opciones) {
  opciones = opciones || {};
  return new Promise(function (resolver) {
    var fondo = document.createElement('div');
    fondo.className = 'dlg-fondo';
    fondo.innerHTML = '<div class="dlg elegir" role="dialog" aria-modal="true"><h3></h3>' +
      (opciones.texto ? '<p></p>' : '') +
      '<div class="opciones"></div>' +
      '<div class="botones"><button type="button" id="dlg-no"></button></div></div>';
    fondo.querySelector('h3').textContent = opciones.titulo || 'Elige una opción';
    if (opciones.texto) fondo.querySelector('p').textContent = opciones.texto;
    fondo.querySelector('#dlg-no').textContent = opciones.cancelar || 'Cancelar';
    var lista = fondo.querySelector('.opciones');
    (opciones.opciones || []).forEach(function (o, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'dlg-opcion' + (o.principal ? ' destacada' : '') + (o.peligro ? ' peligrosa' : '');
      b.setAttribute('data-opcion', String(o.valor === null || o.valor === undefined ? '' : o.valor));
      b.innerHTML = '<b>' + dlgEsc(o.etiqueta) + '</b>' + (o.detalle ? '<small>' + dlgEsc(o.detalle) + '</small>' : '');
      b.onclick = function () { cerrar(o.valor); };
      lista.appendChild(b);
      if (i === 0) setTimeout(function () { b.focus(); }, 30);
    });
    function cerrar(valor) { fondo.remove(); document.removeEventListener('keydown', tecla); resolver(valor); }
    function tecla(ev) { if (ev.key === 'Escape') cerrar(null); }
    document.addEventListener('keydown', tecla);
    fondo.querySelector('#dlg-no').onclick = function () { cerrar(null); };
    fondo.addEventListener('click', function (ev) { if (ev.target === fondo) cerrar(null); });
    document.body.appendChild(fondo);
  });
}

/**
 * Varios campos en un solo cuadro. campos: [{id, etiqueta, tipo ('texto' |
 * 'tel' | 'textarea' | 'casillas' | 'select'), prefijo, marcador, valor, ayuda,
 * opcional, opciones [{valor, etiqueta}], validar(valor) -> texto de error o
 * null}]. Devuelve {id: valor} (las casillas, una lista) o null si se cancela.
 * El primer campo de texto lleva el id "dlg-campo" y el boton "dlg-si", como
 * en pedirDato.
 */
function pedirVarios(opciones) {
  opciones = opciones || {};
  var campos = opciones.campos || [];
  return new Promise(function (resolver) {
    var fondo = document.createElement('div');
    fondo.className = 'dlg-fondo';
    var html = '<div class="dlg varios" role="dialog" aria-modal="true"><h3></h3>' + (opciones.texto ? '<p></p>' : '');
    var primero = true;
    campos.forEach(function (c) {
      var idCampo = primero && c.tipo !== 'casillas' ? 'dlg-campo' : 'dlg-campo-' + c.id;
      if (c.tipo !== 'casillas') primero = false;
      html += '<div class="campo" data-campo="' + dlgEsc(c.id) + '"><label for="' + idCampo + '">' + dlgEsc(c.etiqueta) + (c.opcional ? ' <span class="opcional">(opcional)</span>' : '') + '</label>';
      if (c.tipo === 'casillas') {
        html += '<div class="casillas" id="' + idCampo + '">' + (c.opciones || []).map(function (o) {
          var marcado = (c.valor || []).indexOf(o.valor) >= 0;
          return '<label><input type="checkbox" value="' + dlgEsc(o.valor) + '"' + (marcado ? ' checked' : '') + '> ' + dlgEsc(o.etiqueta) + '</label>';
        }).join('') + '</div>';
      } else if (c.tipo === 'select') {
        html += '<select id="' + idCampo + '">' + (c.opciones || []).map(function (o) {
          return '<option value="' + dlgEsc(o.valor) + '"' + (String(c.valor) === String(o.valor) ? ' selected' : '') + '>' + dlgEsc(o.etiqueta) + '</option>';
        }).join('') + '</select>';
      } else if (c.tipo === 'textarea') {
        html += '<textarea id="' + idCampo + '" placeholder="' + dlgEsc(c.marcador || '') + '" rows="' + (c.filas || 5) + '"></textarea>';
      } else {
        html += '<div class="caja">' + (c.prefijo ? '<span class="prefijo">' + dlgEsc(c.prefijo) + '</span>' : '') +
          '<input id="' + idCampo + '" type="text"' + (c.tipo === 'tel' ? ' inputmode="tel" autocomplete="off"' : ' autocomplete="off"') + ' placeholder="' + dlgEsc(c.marcador || '') + '"></div>';
      }
      if (c.ayuda) html += '<div class="ayuda">' + dlgEsc(c.ayuda) + '</div>';
      html += '<div class="mal" aria-live="polite"></div></div>';
    });
    html += '<div class="botones"><button type="button" id="dlg-no"></button><button type="button" class="principal" id="dlg-si"></button></div></div>';
    fondo.innerHTML = html;
    fondo.querySelector('h3').textContent = opciones.titulo || 'Completa los datos';
    if (opciones.texto) fondo.querySelector('p').textContent = opciones.texto;
    fondo.querySelector('#dlg-si').textContent = opciones.boton || 'Guardar';
    fondo.querySelector('#dlg-no').textContent = opciones.cancelar || 'Cancelar';
    campos.forEach(function (c) {
      if (c.tipo === 'casillas' || c.tipo === 'select') return;
      var el = fondo.querySelector('[data-campo="' + c.id + '"] input, [data-campo="' + c.id + '"] textarea');
      if (el && c.valor !== undefined && c.valor !== null) el.value = c.valor;
    });
    function leer() {
      var datos = {};
      campos.forEach(function (c) {
        var caja = fondo.querySelector('[data-campo="' + c.id + '"]');
        if (c.tipo === 'casillas') {
          datos[c.id] = Array.prototype.map.call(caja.querySelectorAll('input:checked'), function (i) { return i.value; });
        } else if (c.tipo === 'select') {
          datos[c.id] = caja.querySelector('select').value;
        } else {
          var v = (caja.querySelector('input, textarea').value || '').trim();
          if (c.tipo === 'tel') v = v.replace(/\D/g, '');
          datos[c.id] = v;
        }
      });
      return datos;
    }
    function validar(datos) {
      var bien = true;
      campos.forEach(function (c) {
        var caja = fondo.querySelector('[data-campo="' + c.id + '"]');
        var v = datos[c.id];
        var error = null;
        var vacio = c.tipo === 'casillas' ? !v.length : !v;
        if (vacio && !c.opcional) error = c.tipo === 'casillas' ? 'Marca al menos una.' : 'Falta este dato.';
        else if (!vacio && c.tipo === 'tel' && (v.length !== 9 || v.charAt(0) !== '9')) error = 'Son los nueve dígitos del celular, empezando por 9.';
        else if (!vacio && c.validar) error = c.validar(v);
        caja.classList.toggle('con-error', Boolean(error));
        caja.querySelector('.mal').textContent = error || '';
        if (error) bien = false;
      });
      return bien;
    }
    function cerrar(valor) { fondo.remove(); document.removeEventListener('keydown', tecla); resolver(valor); }
    function aceptar() {
      var datos = leer();
      if (!validar(datos)) { var malo = fondo.querySelector('.campo.con-error input, .campo.con-error textarea'); if (malo) malo.focus(); return; }
      cerrar(datos);
    }
    function tecla(ev) {
      if (ev.key === 'Escape') cerrar(null);
      if (ev.key === 'Enter' && ev.target && ev.target.tagName === 'INPUT') { ev.preventDefault(); aceptar(); }
    }
    document.addEventListener('keydown', tecla);
    fondo.querySelector('#dlg-si').onclick = aceptar;
    fondo.querySelector('#dlg-no').onclick = function () { cerrar(null); };
    fondo.addEventListener('click', function (ev) { if (ev.target === fondo) cerrar(null); });
    document.body.appendChild(fondo);
    var foco = fondo.querySelector('input:not([type=checkbox]), textarea, select');
    if (foco) setTimeout(function () { foco.focus(); }, 30);
  });
}
`;
