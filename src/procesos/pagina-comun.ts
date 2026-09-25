/**
 * Lo que comparten las pantallas de procesos: los ayudantes de siempre (api,
 * esc, telefonoBonito) y el cuadro «Cargar personas» (pegar una tabla o subir
 * un Excel / CSV), que se abre desde la lista, el editor y la corrida.
 *
 * JS en String.raw, con var y sin backticks ni «dolar-llave», como el resto.
 */

export const COMUN_CSS = `
  * { box-sizing: border-box; }
  .wrap { color: var(--texto); font: var(--fs-cuerpo)/1.5 var(--fuente); max-width: 1180px; }
  .muted { color: var(--texto-suave); }
  .demo { display: none; background: var(--ambar-suave); color: var(--ambar); padding: 8px 14px; font-size: var(--fs-small); text-align: center; border-radius: var(--radio-sm); margin-bottom: var(--esp-3); font-weight: 600; }
  @media (max-width: 960px) { .demo { display: block; } }
  .resultado { border-radius: var(--radio-sm); padding: 10px 14px; margin-bottom: var(--esp-3); background: var(--verde-suave); color: var(--verde); font-weight: 600; overflow-wrap: anywhere; }
  .resultado.malo { background: var(--rojo-suave); color: var(--rojo); }
  .resultado a { color: inherit; }
  .resultado:empty { display: none; }
  h2.titulo-sec { font-size: var(--fs-h2); margin: var(--esp-5) 0 var(--esp-3); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  h2.titulo-sec:first-child { margin-top: 0; }
  .acciones { display: flex; gap: 8px; flex-wrap: wrap; }
  .dlg.carga { width: min(640px, 100%); max-height: calc(100dvh - 40px); overflow: auto; }
  .dlg.carga textarea { min-height: 150px; font-family: ui-monospace, Consolas, monospace; font-size: 13px; }
  .dlg.carga .fila-archivo { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 10px 0; }
  .dlg.carga .fila-archivo span { font-size: 13px; color: var(--texto-suave); overflow-wrap: anywhere; }
  .dlg.carga .pista { font-size: 12.5px; color: var(--texto-suave); margin: 6px 0 0; }
  .dlg.carga .campo + .campo { margin-top: 12px; }
  .dlg.carga .botones { flex-wrap: wrap; }
`;

export const COMUN_JS = String.raw`
async function api(path, options) {
  options = options || {};
  var res = await fetch(path, { method: options.method || 'GET', cache: 'no-store', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: options.body ? JSON.stringify(options.body) : undefined });
  var data = await res.json().catch(function () { return {}; });
  if (res.status === 401) { irAlLogin(); throw new Error('Tu sesión terminó: vuelve a entrar.'); }
  if (!res.ok) { var e = new Error(data.error || errorHttp(res.status)); e.ir = data.ir; throw e; }
  return data;
}
function esc(v) { return String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function telBonito(p) { p = String(p || ''); if (p.length === 11 && p.indexOf('51') === 0) return '+51 ' + p.slice(2, 5) + ' ' + p.slice(5, 8) + ' ' + p.slice(8); return p ? (/^\d+$/.test(p) ? '+' + p : p) : ''; }
function chip(tono, texto) { return '<span class="chip tono-' + esc(tono) + '">' + esc(texto) + '</span>'; }
function hora(iso) { if (!iso) return ''; var d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function fechaCorta(iso) { if (!iso) return ''; var d = new Date(iso); return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) + ' ' + hora(iso); }
function avisar(texto, malo, ir) {
  var r = document.getElementById('resultado');
  if (!r) return;
  r.className = 'resultado' + (malo ? ' malo' : '');
  r.innerHTML = esc(texto) + (ir ? ' <a href="' + esc(ir) + '">Ir →</a>' : '');
  try { r.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
}
function paramUrl(nombre) { try { return new URLSearchParams(location.search).get(nombre); } catch (e) { return null; } }

/* El cuadro «Cargar personas»: pegar la tabla o subir un Excel o CSV. Devuelve la respuesta de la carga (o null si se cancela). */
function abrirCarga(opciones) {
  opciones = opciones || {};
  return new Promise(function (resolver) {
    var fondo = document.createElement('div');
    fondo.className = 'dlg-fondo';
    fondo.innerHTML =
      '<div class="dlg carga" role="dialog" aria-modal="true" aria-labelledby="carga-titulo">' +
        '<h3 id="carga-titulo"></h3>' +
        '<p id="carga-texto"></p>' +
        '<div class="campo"><label for="carga-nombre">Nombre de esta corrida (opcional)</label><input id="carga-nombre" maxlength="120" autocomplete="off"></div>' +
        '<div class="campo"><label for="carga-tabla">Pega aquí la lista (copiada de Excel o de un CSV)</label><textarea id="carga-tabla" spellcheck="false"></textarea><p class="pista" id="carga-pista"></p></div>' +
        '<div class="fila-archivo"><button type="button" id="carga-archivo-btn">📎 Subir un Excel o CSV</button><input type="file" id="carga-archivo" accept=".xlsx,.csv,.txt,.tsv" hidden><span id="carga-archivo-nombre">Ningún archivo elegido</span>' +
        (opciones.motorizados ? '<button type="button" id="carga-motorizados">Traer a los motorizados</button>' : '') + '</div>' +
        '<div class="mal" id="carga-mal" role="alert"></div>' +
        '<div class="botones"><button type="button" id="carga-no">Cancelar</button><button type="button" class="principal" id="carga-si">Cargar y empezar</button></div>' +
      '</div>';
    fondo.querySelector('#carga-titulo').textContent = 'Cargar personas en «' + (opciones.nombre || 'el proceso') + '»';
    fondo.querySelector('#carga-texto').textContent = 'Una fila por persona con su teléfono y su nombre. Las demás columnas (' + ((opciones.columnas && opciones.columnas.length) ? opciones.columnas.join(', ') : 'fecha, hora, monto…') + ') se usan en los mensajes. Los mensajes salen de uno en uno, con la pausa de siempre y en el horario del proceso.';
    fondo.querySelector('#carga-pista').textContent = 'Ejemplo: ' + (opciones.ejemplo || 'telefono;nombre').split('\n').slice(0, 2).join(' / ');
    var tabla = fondo.querySelector('#carga-tabla');
    tabla.placeholder = opciones.ejemplo || 'telefono;nombre';
    var archivo = null;
    var mal = fondo.querySelector('#carga-mal');
    function cerrar(v) { document.removeEventListener('keydown', teclas); fondo.remove(); resolver(v); }
    function teclas(ev) { if (ev.key === 'Escape') cerrar(null); }
    fondo.querySelector('#carga-no').onclick = function () { cerrar(null); };
    fondo.addEventListener('click', function (ev) { if (ev.target === fondo) cerrar(null); });
    var input = fondo.querySelector('#carga-archivo');
    fondo.querySelector('#carga-archivo-btn').onclick = function () { input.click(); };
    input.onchange = function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var lector = new FileReader();
      var esXlsx = /\.xlsx$/i.test(f.name);
      lector.onload = function () {
        if (esXlsx) { var b = String(lector.result || ''); archivo = { xlsxBase64: b.slice(b.indexOf(',') + 1) }; tabla.value = ''; }
        else { archivo = null; tabla.value = String(lector.result || ''); }
        fondo.querySelector('#carga-archivo-nombre').textContent = f.name;
      };
      if (esXlsx) lector.readAsDataURL(f); else lector.readAsText(f);
    };
    var mot = fondo.querySelector('#carga-motorizados');
    if (mot) mot.onclick = async function () {
      try {
        var d = await api('/admin/motorizados');
        var activos = (d.motorizados || []).filter(function (m) { return m.estado !== 'baja'; });
        if (!activos.length) { mal.textContent = 'No hay motorizados dados de alta. Añádelos en Motorizados.'; return; }
        tabla.value = 'telefono;nombre;direccion\n' + activos.map(function (m) { return m.phone + ';' + m.nombre + ';' + (m.zona || ''); }).join('\n');
        archivo = null;
        fondo.querySelector('#carga-archivo-nombre').textContent = activos.length + ' motorizados traídos';
      } catch (e) { mal.textContent = e.message; }
    };
    fondo.querySelector('#carga-si').onclick = async function () {
      var boton = this;
      mal.textContent = '';
      var cuerpo = { nombre: fondo.querySelector('#carga-nombre').value.trim() || undefined };
      if (archivo) cuerpo.xlsxBase64 = archivo.xlsxBase64; else cuerpo.texto = tabla.value;
      if (!archivo && !tabla.value.trim()) { mal.textContent = 'Pega la lista o sube un archivo.'; return; }
      boton.disabled = true; boton.textContent = 'Cargando…';
      try {
        var r = await api('/admin/procesos/' + opciones.procesoId + '/personas', { method: 'POST', body: cuerpo });
        cerrar(r);
      } catch (e) {
        mal.textContent = e.message;
        boton.disabled = false; boton.textContent = 'Cargar y empezar';
      }
    };
    document.addEventListener('keydown', teclas);
    document.body.appendChild(fondo);
    tabla.focus();
  });
}
`;
