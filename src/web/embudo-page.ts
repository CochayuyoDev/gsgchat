/**
 * «Embudo de chats», dentro de Pedidos GSG: los chats del dia por etiqueta.
 *
 * Arriba, cuantos hay, cuantos etiqueto la IA y cuantos una persona, los que
 * faltan y como va el envio a GSG. En medio, el embudo: una barra por
 * etiqueta, partida en lo de la IA y lo puesto a mano; al pulsarla, la lista
 * de abajo se queda con esos chats. Abajo, la lista: cada chat con su
 * etiqueta, quien la puso y su envio a GSG, con «Cambiar» para ponerla a mano
 * (solo hoy) y «Abrir chat».
 *
 * Etiquetar a mano no le escribe nada al cliente: solo apunta. Lo que se pone
 * a mano no lo cambia la IA. Datos: GET /admin/chat/etiquetas/embudo.
 *
 * El JS va en String.raw, con var y sin backticks, como el resto.
 */

import { appShell } from './shell.js';
import { PESTANAS_PEDIDOS_CSS, PESTANAS_PEDIDOS_JS, pestanasPedidosHtml } from './pestanas-pedidos.js';

const CSS = `
${PESTANAS_PEDIDOS_CSS}
.embudo { display: grid; gap: 14px; max-width: 1300px; margin: auto; }
.embudo .tarjeta { padding: 16px 18px; }
.embudo .hidden { display: none !important; }
.embudo h2 { margin: 0 0 4px; font-size: 16px; }
.em-ayuda { margin: 0 0 12px; color: var(--texto-suave); font-size: 13px; }
.em-barra { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.em-dias { display: inline-flex; padding: 3px; border-radius: 999px; border: 1px solid var(--borde); background: var(--superficie); }
.em-dias button { min-height: 32px; padding: 4px 16px; border: 0; border-radius: 999px; background: transparent; color: var(--texto-suave); font: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer; }
.em-dias button[aria-pressed="true"] { background: var(--primario); color: var(--primario-texto); }
.em-barra .em-sep { flex: 1; }
.em-fecha { color: var(--texto-suave); font-size: 13px; }

.em-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.em-kpi { padding: 14px 16px; border-radius: var(--radio, 12px); border: 1px solid var(--borde); background: var(--superficie); }
.em-kpi .n { font-size: 26px; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; }
.em-kpi .q { margin-top: 4px; color: var(--texto-suave); font-size: 13px; }
.em-kpi .d { margin-top: 2px; font-size: 12px; color: var(--texto-suave); }
.em-kpi.verde .n { color: var(--verde); } .em-kpi.ambar .n { color: var(--ambar); } .em-kpi.rojo .n { color: var(--rojo); } .em-kpi.azul .n { color: var(--azul); }

.em-etapas { display: grid; gap: 6px; }
.em-etapa { display: grid; grid-template-columns: minmax(130px, 220px) 1fr 52px; gap: 12px; align-items: center; width: 100%; padding: 6px 8px; border: 1px solid transparent; border-radius: 10px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.em-etapa:hover { background: var(--superficie-2); }
.em-etapa.activa { border-color: var(--primario); background: var(--primario-suave); }
.em-etapa .nombre { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13.5px; font-weight: 600; }
.em-etapa .nombre span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.em-etapa .pista { display: flex; height: 14px; border-radius: 999px; background: var(--superficie-2); overflow: hidden; }
.em-etapa .pista i { display: block; height: 100%; }
.em-etapa .pista i.ia { background: var(--primario); }
.em-etapa .pista i.mano { background: var(--azul); }
.em-etapa .cuantos { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
.em-leyenda { display: flex; gap: 16px; margin-top: 10px; color: var(--texto-suave); font-size: 12.5px; }
.em-leyenda i { display: inline-block; width: 10px; height: 10px; margin-right: 6px; border-radius: 3px; vertical-align: -1px; }
.em-leyenda i.ia { background: var(--primario); } .em-leyenda i.mano { background: var(--azul); }

.punto { flex: none; display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: var(--gris); }
.punto.rojo { background: var(--rojo); } .punto.ambar { background: var(--ambar); } .punto.azul { background: var(--azul); } .punto.verde { background: var(--verde); }
.punto.sin { background: transparent; border: 1px dashed currentColor; } .punto.vacio { background: transparent; border: 1px solid currentColor; }

.em-filtros { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 10px; }
.em-filtro { display: inline-flex; align-items: center; gap: 8px; min-height: 32px; padding: 3px 6px 3px 12px; border-radius: 999px; border: 1px solid var(--borde); background: var(--superficie); color: var(--texto); font: inherit; font-size: 13px; cursor: pointer; }
.em-filtro b { min-width: 22px; padding: 0 7px; border-radius: 999px; background: var(--superficie-2); font-size: 12px; text-align: center; }
.em-filtro.activo { border-color: var(--primario); background: var(--primario-suave); color: var(--primario); font-weight: 600; }
.em-buscar { flex: 1 1 220px; min-width: 0; }
.em-buscar input { width: 100%; box-sizing: border-box; min-height: 34px; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--borde); background: var(--superficie); color: var(--texto); font: inherit; }

.em-lista { display: grid; }
.em-fila { display: grid; grid-template-columns: 40px minmax(0, 1.4fr) minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 10px 4px; border-top: 1px solid var(--borde); }
.em-fila:first-child { border-top: 0; }
.em-av { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; color: #fff; background: var(--gris); }
.em-quien { min-width: 0; }
.em-quien b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.em-quien small { display: block; color: var(--texto-suave); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.em-estado { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-width: 0; }
.em-chip { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 2px 10px; border-radius: 999px; font-size: 12.5px; font-weight: 600; background: var(--gris-suave); color: var(--gris); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.em-chip.rojo { background: var(--rojo-suave); color: var(--rojo); } .em-chip.ambar { background: var(--ambar-suave); color: var(--ambar); }
.em-chip.azul { background: var(--azul-suave); color: var(--azul); } .em-chip.verde { background: var(--verde-suave); color: var(--verde); }
.em-chip.sin { background: transparent; border: 1px dashed currentColor; }
.em-mini { font-size: 12px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--borde); color: var(--texto-suave); white-space: nowrap; }
.em-mini.mano { border-color: var(--azul); color: var(--azul); }
.em-mini.gsg-ok { border-color: var(--verde); color: var(--verde); }
.em-mini.gsg-mal { border-color: var(--rojo); color: var(--rojo); }
.em-acciones { display: flex; gap: 6px; }
.em-acciones .btn { white-space: nowrap; }
.em-vacio { padding: 26px 8px; text-align: center; color: var(--texto-suave); }

.em-lista-op { position: fixed; z-index: 60; overflow-y: auto; padding: 6px; border-radius: 12px; border: 1px solid var(--borde); background: var(--superficie); box-shadow: 0 12px 32px rgba(0, 0, 0, .3); }
.em-lista-op .t { padding: 8px 10px 4px; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--texto-suave); }
.em-lista-op button { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px; padding: 6px 10px; border: 0; border-radius: 8px; background: transparent; color: var(--texto); font: inherit; font-size: 13.5px; text-align: left; cursor: pointer; }
.em-lista-op button:hover, .em-lista-op button:focus-visible { background: var(--primario-suave); outline: none; }
.em-lista-op button.activo { color: var(--primario); font-weight: 600; }
.em-lista-op .marca { width: 14px; color: var(--primario); }

@media (max-width: 760px) {
  .em-fila { grid-template-columns: 40px minmax(0, 1fr); }
  .em-estado, .em-acciones { grid-column: 2; }
  .em-etapa { grid-template-columns: minmax(0, 1fr) 40px; }
  .em-etapa .pista { grid-column: 1 / -1; grid-row: 2; }
}
`;

export function embudoPage(opts: { demo: boolean; nombreNegocio: string }): string {
  const contenido = `<div class="embudo">
    ${pestanasPedidosHtml()}
    <div id="em-error" role="alert" class="s-alerta warn hidden"></div>
    <div class="tarjeta">
      <div class="em-barra">
        <div class="em-dias" role="group" aria-label="Día">
          <button type="button" data-dia="hoy" aria-pressed="true">Hoy</button>
          <button type="button" data-dia="ayer" aria-pressed="false">Ayer</button>
        </div>
        <span class="em-fecha" id="em-fecha"></span>
        <span class="em-sep"></span>
        <a class="btn sm" href="/chat">Ir a Chats</a>
        <button class="btn sm" type="button" id="em-actualizar">Actualizar</button>
      </div>
    </div>
    <div class="em-kpis" id="em-kpis" aria-live="polite"></div>
    <section class="tarjeta" aria-labelledby="em-t1">
      <h2 id="em-t1">Embudo por etiqueta</h2>
      <p class="em-ayuda">Cuántos chats tiene cada etiqueta. Pulsa una para ver solo esos chats abajo.</p>
      <div class="em-etapas" id="em-etapas"></div>
      <div class="em-leyenda"><span><i class="ia"></i>Puesta por la IA</span><span><i class="mano"></i>Puesta a mano</span></div>
    </section>
    <section class="tarjeta" aria-labelledby="em-t2">
      <h2 id="em-t2">Chats</h2>
      <p class="em-ayuda" id="em-ayuda-lista">La IA solo lee y etiqueta: no le escribe a nadie. Lo que pongas a mano no lo cambia la IA.</p>
      <div class="em-barra">
        <div class="em-filtros" id="em-filtros" role="group" aria-label="Filtrar la lista"></div>
        <label class="em-buscar"><span class="sr">Buscar</span><input id="em-buscar" type="search" placeholder="Buscar por nombre o número"></label>
      </div>
      <div class="em-lista" id="em-lista" aria-live="polite"></div>
    </section>
  </div>`;

  const script = String.raw`
function $(id) { return document.getElementById(id); }
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
async function api(url, opciones) {
  opciones = opciones || {};
  var r = await fetch(url, { method: opciones.method || 'GET', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: opciones.body === undefined ? undefined : JSON.stringify(opciones.body) });
  if (r.status === 401) { location.href = '/login?next=' + encodeURIComponent(location.pathname); throw new Error('Inicia sesión.'); }
  var j = await r.json().catch(function () { return {}; });
  if (!r.ok) throw new Error(j.error || 'No se pudo completar la petición (' + r.status + ').');
  return j;
}
var relojAviso = null;
function aviso(texto, bien) {
  var caja = $('em-error');
  caja.className = 's-alerta ' + (bien ? 'ok' : 'warn');
  caja.innerHTML = '<span>' + esc(texto) + '</span>';
  clearTimeout(relojAviso);
  relojAviso = setTimeout(function () { caja.classList.add('hidden'); }, bien ? 4000 : 10000);
}

var TONO = {
  reclamo: 'rojo', cancelar_entrega: 'rojo', pedido_no_reconocido: 'rojo',
  reagendar_entrega: 'ambar', cambiar_ubicacion: 'ambar', ubicaciones_multiples: 'ambar', fuera_de_horario: 'ambar', problema_de_pago: 'ambar',
  horario_fijo: 'azul', franja_horaria: 'azul', hora_limite: 'azul', solicitar_espera: 'azul', coordinar_con_tercero: 'azul', consultar_entrega: 'azul',
  confirmar_recepcion: 'verde', sin_novedad: 'verde', otro: 'gris'
};
var COLORES_AV = ['#e57373', '#64b5f6', '#81c784', '#ffb74d', '#ba68c8', '#4db6ac', '#f06292', '#7986cb'];
var dia = 'hoy', datos = null, filtro = 'todas', etapa = '', texto = '', catalogo = null;

function bonito(p) { p = String(p || ''); return p.length === 11 && p.indexOf('51') === 0 ? '+51 ' + p.slice(2, 5) + ' ' + p.slice(5, 8) + ' ' + p.slice(8) : '+' + p; }
function hora(v) { return v ? new Date(v).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : ''; }

async function cargar() {
  try {
    datos = await api('/admin/chat/etiquetas/embudo?dia=' + dia);
  } catch (error) { aviso(error.message); return; }
  pintar();
}

function kpi(n, q, d, tono) { return '<div class="em-kpi ' + (tono || '') + '"><div class="n">' + n + '</div><div class="q">' + esc(q) + '</div>' + (d ? '<div class="d">' + esc(d) + '</div>' : '') + '</div>'; }

function pintar() {
  var r = datos.resumen;
  $('em-fecha').textContent = datos.dia.split('-').reverse().join('/');
  $('em-kpis').innerHTML =
    kpi(r.chats, 'chats ' + (datos.hoy ? 'de hoy' : 'de ese día'), '') +
    kpi(r.etiquetados, 'etiquetados', r.porIA + ' por la IA · ' + r.manual + ' a mano', 'verde') +
    kpi(r.sinEtiquetar, 'sin etiquetar', datos.hoy ? 'se etiquetan con «Etiquetar chats con IA»' : '', r.sinEtiquetar ? 'ambar' : '') +
    kpi(r.sinClasificar, 'sin clasificar', 'la IA no pudo', r.sinClasificar ? 'rojo' : '') +
    kpi(r.enviadosGsg, 'enviados a GSG', r.sinEnviarGsg ? r.sinEnviarGsg + ' sin enviar' : 'todo enviado', r.enviadosGsg ? 'azul' : '');

  var max = Math.max.apply(null, datos.etapas.map(function (e) { return e.total; }).concat([1]));
  var conChats = datos.etapas.filter(function (e) { return e.total > 0; });
  $('em-etapas').innerHTML = conChats.length ? conChats.map(function (e) {
    return '<button type="button" class="em-etapa' + (etapa === e.codigo ? ' activa' : '') + '" data-etapa="' + esc(e.codigo) + '" aria-pressed="' + (etapa === e.codigo ? 'true' : 'false') + '">' +
      '<span class="nombre"><i class="punto ' + (TONO[e.codigo] || 'gris') + '"></i><span>' + esc(e.nombre) + '</span></span>' +
      '<span class="pista" title="' + e.ia + ' por la IA · ' + e.manual + ' a mano"><i class="ia" style="width:' + (e.ia * 100 / max) + '%"></i><i class="mano" style="width:' + (e.manual * 100 / max) + '%"></i></span>' +
      '<span class="cuantos">' + e.total + '</span></button>';
  }).join('') : '<div class="em-vacio">' + (datos.hoy ? 'Hoy todavía no hay chats etiquetados. Etiquétalos desde Chats con «Etiquetar chats con IA».' : 'Ese día no hubo chats etiquetados.') + '</div>';

  var f = [['todas', 'Todos', r.chats], ['ia', 'Por la IA', r.porIA], ['manual', 'A mano', r.manual], ['sin_etiquetar', 'Sin etiquetar', r.sinEtiquetar], ['sin_clasificar', 'Sin clasificar', r.sinClasificar], ['sin_gsg', 'Sin enviar a GSG', r.sinEnviarGsg]];
  $('em-filtros').innerHTML = f.filter(function (x) { return x[0] === 'todas' || x[2] > 0; }).map(function (x) {
    return '<button type="button" class="em-filtro' + (filtro === x[0] ? ' activo' : '') + '" data-filtro="' + x[0] + '" aria-pressed="' + (filtro === x[0] ? 'true' : 'false') + '">' + esc(x[1]) + '<b>' + x[2] + '</b></button>';
  }).join('');
  pintarLista();
}

function filas() {
  var todos = datos.chats.map(function (c) { return Object.assign({ tipo: c.etiqueta ? 'etiquetado' : 'sin_clasificar' }, c); })
    .concat(datos.sinEtiquetar.map(function (c) { return Object.assign({ tipo: 'sin_etiquetar', etiqueta: null, origen: null, gsg: null }, c); }));
  var q = texto.trim().toLowerCase();
  return todos.filter(function (c) {
    if (etapa && c.etiqueta !== etapa) return false;
    if (filtro === 'ia' && !(c.etiqueta && c.origen !== 'manual')) return false;
    if (filtro === 'manual' && c.origen !== 'manual') return false;
    if (filtro === 'sin_etiquetar' && c.tipo !== 'sin_etiquetar') return false;
    if (filtro === 'sin_clasificar' && c.tipo !== 'sin_clasificar') return false;
    if (filtro === 'sin_gsg' && !(c.etiqueta && c.gsg && c.gsg.estado !== 'enviado')) return false;
    if (q && (String(c.nombre || '').toLowerCase().indexOf(q) < 0 && String(c.phone).indexOf(q.replace(/\D+/g, '') || '¬') < 0)) return false;
    return true;
  }).sort(function (a, b) { return new Date(b.ultimoMensaje ? b.ultimoMensaje.at : 0) - new Date(a.ultimoMensaje ? a.ultimoMensaje.at : 0); });
}

function pintarLista() {
  var lista = filas();
  if (!lista.length) { $('em-lista').innerHTML = '<div class="em-vacio">Ningún chat con ese filtro.</div>'; return; }
  $('em-lista').innerHTML = lista.map(function (c) {
    var nombre = c.nombre || bonito(c.phone);
    var color = COLORES_AV[parseInt(String(c.phone).slice(-2), 10) % COLORES_AV.length];
    var chip = c.tipo === 'sin_etiquetar' ? '<span class="em-chip sin">Sin etiquetar</span>'
      : c.tipo === 'sin_clasificar' ? '<span class="em-chip sin" title="' + esc(c.motivo || '') + '">Sin clasificar</span>'
      : '<span class="em-chip ' + (TONO[c.etiqueta] || 'gris') + '">' + esc(c.nombreEtiqueta) + '</span>';
    var origen = c.etiqueta ? (c.origen === 'manual' ? '<span class="em-mini mano" title="Puesta a mano: la IA no la cambia">✎ A mano</span>' : '<span class="em-mini">IA</span>') : '';
    var gsg = c.etiqueta && c.gsg ? (c.gsg.estado === 'enviado' ? '<span class="em-mini gsg-ok">✓ GSG</span>' : c.gsg.intentos ? '<span class="em-mini gsg-mal" title="' + esc(c.gsg.error || '') + '">No llegó a GSG</span>' : '<span class="em-mini" title="' + esc(c.gsg.error || '') + '">Sin enviar a GSG</span>') : '';
    var ultimo = c.ultimoMensaje ? (c.ultimoMensaje.direction === 'out' ? 'Tú: ' : '') + (c.ultimoMensaje.body || '(adjunto)') : '';
    return '<div class="em-fila">' +
      '<span class="em-av" style="background:' + color + '" aria-hidden="true">' + esc(String(nombre).replace(/^\+/, '').charAt(0).toUpperCase()) + '</span>' +
      '<span class="em-quien"><b>' + esc(nombre) + '</b><small>' + esc(bonito(c.phone)) + (ultimo ? ' · ' + esc(hora(c.ultimoMensaje.at)) + ' · ' + esc(ultimo) : '') + '</small></span>' +
      '<span class="em-estado">' + chip + origen + gsg + '</span>' +
      '<span class="em-acciones">' +
        (datos.hoy && c.contactId ? '<button type="button" class="btn sm" data-cambiar="' + esc(c.contactId) + '" data-actual="' + esc(c.origen === 'manual' ? c.etiqueta : '') + '" data-tiene="' + (c.etiqueta || c.tipo === 'sin_clasificar' ? '1' : '') + '" aria-haspopup="listbox">Etiquetar ▾</button>' : '') +
        '<a class="btn sm" href="/chat?phone=' + encodeURIComponent(c.phone) + '">Abrir chat</a>' +
      '</span></div>';
  }).join('');
}

/* La lista del catalogo para poner la etiqueta a mano (un clic abre, otro elige). */
var abierta = null;
function cerrarOpciones() { if (abierta) { abierta.panel.remove(); abierta.boton.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', abierta.fuera, true); document.removeEventListener('keydown', abierta.teclas, true); abierta = null; } }
async function opciones(boton) {
  if (abierta && abierta.boton === boton) { cerrarOpciones(); return; }
  cerrarOpciones();
  try { if (!catalogo) catalogo = (await api('/admin/chat/etiquetas/catalogo')).items; } catch (error) { aviso(error.message); return; }
  var actual = boton.getAttribute('data-actual');
  var panel = document.createElement('div');
  panel.className = 'em-lista-op';
  panel.style.fontFamily = getComputedStyle(boton).fontFamily;
  panel.setAttribute('role', 'listbox');
  panel.innerHTML = '<div class="t">Poner a mano</div>' + catalogo.map(function (e) {
    return '<button type="button" role="option" data-valor="' + esc(e.codigo) + '"' + (e.codigo === actual ? ' class="activo" aria-selected="true"' : '') + '><span class="marca">' + (e.codigo === actual ? '✓' : '') + '</span><i class="punto ' + (TONO[e.codigo] || 'gris') + '"></i>' + esc(e.nombre) + '</button>';
  }).join('') + (boton.getAttribute('data-tiene') ? '<div class="t"></div><button type="button" role="option" data-valor="__quitar"><span class="marca"></span>Quitar la etiqueta</button>' : '');
  document.body.appendChild(panel);
  var r = boton.getBoundingClientRect();
  var ancho = Math.min(260, window.innerWidth - 16);
  panel.style.width = ancho + 'px';
  panel.style.left = Math.max(8, Math.min(r.right - ancho, window.innerWidth - ancho - 8)) + 'px';
  var abajo = window.innerHeight - r.bottom - 16;
  if (abajo < 260 && r.top > abajo) { panel.style.bottom = (window.innerHeight - r.top + 6) + 'px'; panel.style.maxHeight = (r.top - 16) + 'px'; }
  else { panel.style.top = (r.bottom + 6) + 'px'; panel.style.maxHeight = abajo + 'px'; }
  boton.setAttribute('aria-expanded', 'true');
  var ops = Array.prototype.slice.call(panel.querySelectorAll('button'));
  (panel.querySelector('button.activo') || ops[0]).focus();
  panel.addEventListener('click', async function (ev) {
    var b = ev.target.closest('button[data-valor]');
    if (!b) return;
    var valor = b.getAttribute('data-valor');
    cerrarOpciones();
    boton.disabled = true;
    boton.textContent = 'Guardando…';
    try {
      await api('/admin/chat/' + encodeURIComponent(boton.getAttribute('data-cambiar')) + '/etiqueta', { method: 'POST', body: { etiqueta: valor === '__quitar' ? null : valor } });
      aviso(valor === '__quitar' ? 'Etiqueta quitada.' : 'Etiqueta puesta a mano: la IA no la cambiará.', true);
      cargar();
    } catch (error) { aviso(error.message); boton.disabled = false; boton.textContent = 'Etiquetar ▾'; }
  });
  var fuera = function (ev) { if (!panel.contains(ev.target) && !boton.contains(ev.target)) cerrarOpciones(); };
  var teclas = function (ev) {
    if (ev.key === 'Escape') { cerrarOpciones(); boton.focus(); return; }
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    ev.preventDefault();
    var i = ops.indexOf(document.activeElement);
    ops[ev.key === 'ArrowDown' ? Math.min(ops.length - 1, i + 1) : Math.max(0, i - 1)].focus();
  };
  document.addEventListener('pointerdown', fuera, true);
  document.addEventListener('keydown', teclas, true);
  abierta = { panel: panel, boton: boton, fuera: fuera, teclas: teclas };
}

document.querySelector('.em-dias').addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-dia]');
  if (!b) return;
  dia = b.getAttribute('data-dia');
  this.querySelectorAll('[data-dia]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
  etapa = ''; filtro = 'todas';
  cargar();
});
$('em-etapas').addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-etapa]');
  if (!b) return;
  etapa = etapa === b.getAttribute('data-etapa') ? '' : b.getAttribute('data-etapa');
  pintar();
  $('em-lista').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
$('em-filtros').addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-filtro]');
  if (!b) return;
  filtro = b.getAttribute('data-filtro');
  pintar();
});
$('em-lista').addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-cambiar]');
  if (b) opciones(b);
});
$('em-buscar').addEventListener('input', function () { texto = this.value; pintarLista(); });
$('em-actualizar').onclick = cargar;
cargar();
setInterval(function () { if (!document.hidden && !abierta) cargar(); }, 30000);
${PESTANAS_PEDIDOS_JS}
`;
  return appShell({
    titulo: 'Pedidos GSG',
    subtitulo: 'Embudo de chats: los chats del día por etiqueta',
    contenido,
    script,
    css: CSS + '\n.sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    nombreNegocio: opts.nombreNegocio,
    demo: opts.demo,
    icono: '📊',
  });
}
