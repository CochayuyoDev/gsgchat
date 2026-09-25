/**
 * Pantalla "Números del día": la lista que GSG pasa por la API, número por
 * número, con en qué punto va cada uno.
 *
 * Los filtros no son marcas: salen del estado de cada entrega y cambian
 * solos con cada mensaje que llega (manda su pin → pasa a «Falta
 * confirmar»; dice que sí → pasa a «Ya contactados»). Por eso la pantalla se
 * refresca sola cada pocos segundos y al volver a la pestaña.
 *
 * Con las casillas se eligen uno, varios o todos los del filtro, y la barra
 * de abajo hace la accion con todos a la vez (POST /admin/entregas/masa, ver
 * src/entregas/numeros.ts). El aviso de lo que paso llega ya en palabras.
 *
 * El JS va en String.raw, con var y sin backticks, como el resto; todo dato
 * del servidor pasa por esc() antes de ir a innerHTML.
 */

import { appShell } from './shell.js';

const CSS = `
  * { box-sizing: border-box; }
  .wrap { color: var(--texto); font: var(--fs-cuerpo)/1.5 var(--fuente); max-width: 1200px; }
  .muted { color: var(--texto-suave); }
  .demo { display: none; background: var(--ambar-suave); color: var(--ambar); padding: 8px 14px; font-size: var(--fs-small); text-align: center; border-radius: var(--radio-sm); margin-bottom: var(--esp-3); font-weight: 600; }
  @media (max-width: 960px) { .demo { display: block; } }
  .explica { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); padding: 12px 16px; margin-bottom: var(--esp-3); }
  .explica summary { color: var(--texto-suave); font-size: 13.5px; cursor: pointer; }
  .explica p { margin: 8px 0 0; }
  .aviso-fijo { background: var(--ambar-suave); color: var(--ambar); border-radius: var(--radio-sm); padding: 10px 14px; margin-bottom: var(--esp-3); font-weight: 600; }

  /* Los filtros: botones grandes con su contador. */
  .filtros { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: var(--esp-3); }
  .filtro { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 8px 14px; border: 1px solid var(--borde); border-radius: 999px; background: var(--superficie); color: var(--texto); font: inherit; font-weight: 600; cursor: pointer; }
  .filtro .n { display: inline-block; min-width: 26px; padding: 1px 8px; border-radius: 999px; background: var(--gris-suave); color: var(--texto); font-size: 13px; text-align: center; }
  .filtro[aria-pressed="true"] { background: var(--primario); border-color: var(--primario); color: var(--primario-texto); }
  .filtro[aria-pressed="true"] .n { background: rgba(255,255,255,.25); color: inherit; }
  .filtro.rojo:not([aria-pressed="true"]) .n.hay { background: var(--rojo-suave); color: var(--rojo); }

  .buscar { display: flex; gap: 8px; margin-bottom: var(--esp-3); }
  .buscar input { flex: 1; min-height: 44px; padding: 8px 14px; border: 1px solid var(--borde); border-radius: var(--radio-sm); font: inherit; background: var(--superficie); color: var(--texto); }

  /* La barra de acciones: siempre a la vista, con los botones grandes. */
  .barra { position: sticky; top: 0; z-index: 5; background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); box-shadow: var(--sombra); padding: 10px 12px; margin-bottom: var(--esp-3); }
  .barra .sel { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
  .barra .sel label { display: inline-flex; align-items: center; gap: 10px; font-weight: 600; cursor: pointer; min-height: 44px; }
  .barra .cuantos { font-weight: 700; }
  .barra .acc { display: flex; gap: 8px; flex-wrap: wrap; }
  .barra .acc .btn { min-height: 48px; padding: 10px 18px; font-size: 15px; }
  .barra .acc .btn[disabled] { opacity: .45; cursor: not-allowed; }
  .barra .pista { font-size: 13px; color: var(--texto-suave); margin-top: 8px; }
  input[type="checkbox"].casilla { width: 22px; height: 22px; accent-color: var(--primario); cursor: pointer; flex: 0 0 auto; }

  .resultado { border-radius: var(--radio-sm); padding: 10px 14px; margin-bottom: var(--esp-3); background: var(--verde-suave); color: var(--verde); font-weight: 600; }
  .resultado.malo { background: var(--rojo-suave); color: var(--rojo); }
  .resultado:empty { display: none; }

  .caja { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); overflow: hidden; box-shadow: var(--sombra); }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--borde); vertical-align: top; }
  th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--texto-suave); font-weight: 700; }
  tr:last-child td { border-bottom: 0; }
  #numeros > tr.fila { cursor: pointer; }
  #numeros > tr.fila:hover > td { background: var(--superficie-2); }
  #numeros > tr.fila.elegida > td { background: var(--primario-suave); }
  #numeros > tr.movido > td { animation: movido 2.5s ease-out; }
  @keyframes movido { from { background: var(--ambar-suave); } to { background: transparent; } }
  td.casilla-td { width: 44px; }
  td .sub { color: var(--texto-suave); font-size: var(--fs-small); margin-top: 3px; line-height: 1.35; }
  td .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
  td.mensaje { color: var(--texto-suave); text-align: center; padding: 24px; }

  /* En el celular cada número es una tarjeta con su casilla arriba. */
  @media (max-width: 760px) {
    .filtro { min-height: 42px; padding: 6px 12px; font-size: 14px; }
    .barra { padding: 10px; }
    .barra .acc .btn { flex: 1 1 calc(50% - 8px); padding: 10px 8px; font-size: 14.5px; }
    .caja { background: transparent; border: 0; box-shadow: none; }
    .caja thead { display: none; }
    .caja table, .caja tbody, .caja tr, .caja td { display: block; }
    #numeros > tr.fila { position: relative; border: 1px solid var(--borde); border-radius: var(--radio); margin: 0 0 10px; padding: 10px 12px 10px 50px; background: var(--superficie); box-shadow: var(--sombra); }
    #numeros > tr.fila.elegida { border-color: var(--primario); }
    #numeros > tr.fila > td { border: 0; padding: 3px 0; background: transparent !important; }
    #numeros > tr.fila > td.casilla-td { position: absolute; left: 14px; top: 14px; width: auto; padding: 0; }
    td.mensaje { padding: 16px; }
  }
`;

export function numerosPage(opts: { disponible: boolean; demo: boolean; nombreNegocio: string }): string {
  const contenido = `
<div class="wrap">
${opts.demo ? '<div class="demo">Demostración: nada sale a WhatsApp de verdad.</div>' : ''}
${opts.disponible ? '' : '<div class="explica"><b>Los números del día no están disponibles en este arranque del sistema.</b> Si esperabas verlos, mira en <a href="/soporte">Soporte</a> qué hacer.</div>'}

<details class="explica">
  <summary>¿Cómo se mueven los números de un filtro a otro?</summary>
  <p>Solos, con cada mensaje que llega. A quien <b>todavía no se le escribió</b> está en «Falta pedir ubicación»; cuando el sistema le pide el pin pasa a <b>«Falta su ubicación»</b>; en cuanto manda su ubicación pasa a <b>«Falta confirmar»</b>; y cuando dice que sí (o manda su ubicación cuando ya se le pedía confirmar) pasa a <b>«Ya contactados»</b>, igual que los que ya van con motorizado o están entregados.</p>
  <p class="muted" style="margin-top:6px">«Marcar como contactado» sirve para los que atendiste por otro lado (una llamada, por ejemplo). «Pausar» deja de pedirle la ubicación y la confirmación a ese número hasta que lo reanudes; lo que conteste se sigue leyendo.</p>
</details>

<div class="aviso-fijo hidden" id="fuera-horario" role="status"></div>

<div class="filtros" id="filtros" role="group" aria-label="Filtrar los números"></div>

<div class="buscar">
  <input type="search" id="buscar" placeholder="Buscar por nombre, teléfono o pedido" aria-label="Buscar por nombre, teléfono o pedido" autocomplete="off">
</div>

<div class="barra" id="barra">
  <div class="sel">
    <label><input type="checkbox" class="casilla" id="todos"> <span id="todos-txt">Marcar todos</span></label>
    <span class="cuantos" id="cuantos" aria-live="polite">Ninguno seleccionado</span>
  </div>
  <div class="acc">
    <button class="btn primario" type="button" data-accion="pedir_ubicacion" disabled>📍 Pedir ubicación ahora</button>
    <button class="btn" type="button" data-accion="pedir_confirmacion" disabled>✅ Pedir confirmación</button>
    <button class="btn" type="button" data-accion="marcar_contactado" disabled>☎️ Marcar como contactado</button>
    <button class="btn" type="button" data-accion="quitar_marca" disabled>Quitar marca</button>
    <button class="btn" type="button" data-accion="pausa" id="btn-pausa" disabled>⏸ Pausar mensajes</button>
  </div>
  <div class="pista" id="pista">Marca uno o varios números (o «Marcar todos») para usar estos botones.</div>
</div>

<div class="resultado" id="resultado" role="status" aria-live="polite"></div>

<div class="caja">
  <table>
    <thead><tr><th></th><th>Cliente</th><th>Pedido</th><th>En qué punto va</th></tr></thead>
    <tbody id="numeros"><tr><td colspan="4" class="mensaje">Cargando…</td></tr></tbody>
  </table>
</div>
</div>
`;

  const script = String.raw`
var DISPONIBLE = ${opts.disponible ? 'true' : 'false'};
var FILTROS = [
  { id: 'todos', etiqueta: 'Todos' },
  { id: 'falta_pedir', etiqueta: 'Falta pedir ubicación' },
  { id: 'falta_ubicacion', etiqueta: 'Falta su ubicación' },
  { id: 'falta_confirmar', etiqueta: 'Falta confirmar' },
  { id: 'contactados', etiqueta: 'Ya contactados' },
  { id: 'necesita', etiqueta: 'Necesitan a alguien', rojo: true }
];
var ETAPA = {
  falta_pedir: { nombre: 'Falta pedir ubicación', tono: 'gris' },
  falta_ubicacion: { nombre: 'Falta su ubicación', tono: 'ambar' },
  falta_confirmar: { nombre: 'Falta confirmar', tono: 'azul' },
  contactados: { nombre: 'Ya contactado', tono: 'verde' },
  necesita: { nombre: 'Necesita a alguien', tono: 'rojo' },
  cancelada: { nombre: 'Cancelado', tono: 'gris' }
};

var datos = null;
var filtro = 'todos';
var elegidos = {};
var etapaAnterior = {};
var ocupado = false;

async function api(path, options) {
  options = options || {};
  var res = await fetch(path, { method: options.method || 'GET', cache: 'no-store', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: options.body ? JSON.stringify(options.body) : undefined });
  var data = await res.json().catch(function () { return {}; });
  if (res.status === 401) { irAlLogin(); throw new Error('Tu sesión terminó: vuelve a entrar.'); }
  if (!res.ok) throw new Error(data.error || errorHttp(res.status));
  return data;
}
function esc(v) { return String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function telefonoBonito(p) { if (!p) return ''; p = String(p); if (p.length === 11 && p.indexOf('51') === 0) return '+51 ' + p.slice(2, 5) + ' ' + p.slice(5, 8) + ' ' + p.slice(8); return '+' + p; }
function hora(iso) { if (!iso) return ''; var d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function chip(tono, texto) { return '<span class="chip tono-' + tono + '">' + esc(texto) + '</span>'; }
function sinTildes(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

function visibles() {
  if (!datos) return [];
  var q = sinTildes(document.getElementById('buscar').value.trim());
  var qDigitos = q.replace(/\D/g, '');
  return datos.numeros.filter(function (n) {
    if (filtro !== 'todos' && n.etapa !== filtro) return false;
    if (!q) return true;
    if (sinTildes(n.nombre).indexOf(q) >= 0) return true;
    if (sinTildes(n.referencia).indexOf(q) >= 0) return true;
    if (qDigitos && String(n.telefono).indexOf(qDigitos) >= 0) return true;
    return false;
  });
}

function pintarFiltros() {
  var c = datos ? datos.cifras : {};
  document.getElementById('filtros').innerHTML = FILTROS.map(function (f) {
    var n = c[f.id] || 0;
    return '<button type="button" class="filtro' + (f.rojo ? ' rojo' : '') + '" data-filtro="' + f.id + '" aria-pressed="' + (filtro === f.id ? 'true' : 'false') + '">' +
      esc(f.etiqueta) + ' <span class="n' + (n ? ' hay' : '') + '">' + n + '</span></button>';
  }).join('');
}

function fila(n) {
  var e = ETAPA[n.etapa] || { nombre: n.etapa, tono: 'gris' };
  var marcado = Boolean(elegidos[n.id]);
  var nombre = n.nombre || 'Sin nombre';
  var chips = chip(e.tono, e.nombre);
  if (n.ubiRegistrada) chips += chip('verde', 'UBI REGISTRADA');
  if (n.urgente) chips += chip('rojo', 'Urgente');
  if (n.pausado) chips += chip('ambar', 'Mensajes en pausa');
  if (n.contactadoAt) chips += chip('verde', 'Marcado a mano');
  var extra = '';
  if (n.contactadoAt) extra += '<div class="sub">Marcado como contactado' + (n.contactadoPor ? ' por ' + esc(n.contactadoPor) : '') + ' a las ' + esc(hora(n.contactadoAt)) + '.</div>';
  if (n.pausado) extra += '<div class="sub">No se le pide la ubicación ni la confirmación hasta que lo reanudes.</div>';
  if (n.mismoCliente && n.mismoCliente.length) extra += '<div class="sub">También tiene hoy: ' + n.mismoCliente.map(esc).join(', ') + '.</div>';
  var movido = etapaAnterior[n.id] && etapaAnterior[n.id] !== n.etapa;
  return '<tr class="fila' + (marcado ? ' elegida' : '') + (movido ? ' movido' : '') + '" data-id="' + n.id + '">' +
    '<td class="casilla-td"><input type="checkbox" class="casilla" data-id="' + n.id + '"' + (marcado ? ' checked' : '') + ' aria-label="' + esc('Seleccionar a ' + nombre) + '"></td>' +
    '<td><b>' + esc(nombre) + '</b><div class="sub">' + esc(telefonoBonito(n.telefono)) + '</div></td>' +
    '<td><b>' + esc(n.referencia) + '</b>' + (n.distrito ? '<div class="sub">' + esc(n.distrito) + '</div>' : '') + (n.direccion ? '<div class="sub">' + esc(n.direccion) + '</div>' : '') +
      (n.mapa ? '<div class="sub"><a href="' + esc(n.mapa) + '" target="_blank" rel="noopener">Ver su ubicación</a></div>' : '') + '</td>' +
    '<td><div class="chips">' + chips + '</div>' + esc(n.punto) + extra + '</td>' +
    '</tr>';
}

function vacio() {
  if (!datos || !datos.numeros.length) {
    if (datos && datos.gsg && !datos.gsg.conectada) return 'Todavía no hay números de hoy y GSG no está conectado: conéctalo en Conexión o carga la lista en Hoy.';
    return 'Todavía no llegó ningún número de hoy. En cuanto GSG pase la lista, aparecen aquí.';
  }
  if (document.getElementById('buscar').value.trim()) return 'Ningún número de este filtro coincide con lo que buscas.';
  return 'No hay ningún número en este filtro ahora mismo.';
}

function pintarLista() {
  var lista = visibles();
  // Solo cuenta como seleccionado lo que se ve: un número que se movió de filtro sale de la selección.
  var ids = {};
  lista.forEach(function (n) { ids[n.id] = true; });
  Object.keys(elegidos).forEach(function (id) { if (!ids[id]) delete elegidos[id]; });
  document.getElementById('numeros').innerHTML = lista.length ? lista.map(fila).join('') : '<tr><td colspan="4" class="mensaje">' + esc(vacio()) + '</td></tr>';
  pintarBarra(lista);
}

function seleccionados() {
  if (!datos) return [];
  return datos.numeros.filter(function (n) { return elegidos[n.id]; });
}

function pintarBarra(lista) {
  lista = lista || visibles();
  var sel = seleccionados();
  var n = sel.length;
  var todos = document.getElementById('todos');
  todos.checked = lista.length > 0 && n === lista.length;
  todos.indeterminate = n > 0 && n < lista.length;
  todos.disabled = !lista.length;
  document.getElementById('todos-txt').textContent = lista.length ? 'Marcar todos (los ' + lista.length + ' de este filtro)' : 'Marcar todos';
  document.getElementById('cuantos').textContent = n ? (n === 1 ? '1 seleccionado' : n + ' seleccionados') : 'Ninguno seleccionado';
  var botones = document.querySelectorAll('#barra .acc .btn');
  for (var i = 0; i < botones.length; i++) botones[i].disabled = !n || ocupado;
  var todosPausados = n > 0 && sel.every(function (x) { return x.pausado; });
  var bp = document.getElementById('btn-pausa');
  bp.textContent = todosPausados ? '▶ Reanudar mensajes' : '⏸ Pausar mensajes';
  bp.setAttribute('data-modo', todosPausados ? 'reanudar' : 'pausar');
  document.getElementById('pista').textContent = ocupado ? 'Haciéndolo…' : (n ? 'Lo que pulses se hace con los ' + (n === 1 ? 'el número marcado' : n + ' números marcados') + '.' : 'Marca uno o varios números (o «Marcar todos») para usar estos botones.');
}

function pintarHorario() {
  var el = document.getElementById('fuera-horario');
  var fuera = datos && datos.motor && datos.motor.enHorario === false;
  el.classList.toggle('hidden', !fuera);
  el.textContent = fuera ? 'Ahora está fuera del horario de envío: lo que pidas queda en la cola y sale en cuanto empiece el horario.' : '';
}

function pintar() {
  pintarHorario();
  pintarFiltros();
  pintarLista();
}

async function cargar() {
  if (!DISPONIBLE) return;
  var antes = {};
  if (datos) datos.numeros.forEach(function (n) { antes[n.id] = n.etapa; });
  datos = await api('/admin/entregas/numeros');
  etapaAnterior = antes;
  pintar();
  etapaAnterior = {};
}

var TITULOS = {
  pedir_ubicacion: 'Pedir la ubicación',
  pedir_confirmacion: 'Pedir la confirmación'
};

async function hacer(accion) {
  var sel = seleccionados();
  if (!sel.length || ocupado) return;
  if (accion === 'pausa') accion = document.getElementById('btn-pausa').getAttribute('data-modo') || 'pausar';
  if (TITULOS[accion] && sel.length > 1) {
    var que = accion === 'pedir_ubicacion' ? 'la ubicación' : 'la confirmación';
    var si = await confirmarDialogo({ titulo: TITULOS[accion], texto: 'Se le va a pedir ' + que + ' a ' + sel.length + ' números por WhatsApp. Salen de uno en uno, con la pausa de siempre entre mensaje y mensaje. A los que ya la dieron no se les escribe.', boton: 'Sí, pedir' });
    if (!si) return;
  }
  ocupado = true;
  pintarBarra();
  var res = document.getElementById('resultado');
  try {
    var r = await api('/admin/entregas/masa', { method: 'POST', body: { accion: accion, ids: sel.map(function (x) { return x.id; }) } });
    res.className = 'resultado' + (r.hechos ? '' : ' malo');
    res.textContent = r.aviso;
    elegidos = {};
  } catch (e) {
    res.className = 'resultado malo';
    res.textContent = e.message;
  } finally {
    ocupado = false;
  }
  try { await cargar(); } catch (e) { pintarBarra(); }
}

document.getElementById('filtros').addEventListener('click', function (ev) {
  var b = ev.target.closest('button[data-filtro]');
  if (!b) return;
  filtro = b.getAttribute('data-filtro');
  elegidos = {};
  pintarFiltros();
  pintarLista();
});
document.getElementById('buscar').addEventListener('input', function () { pintarLista(); });
document.getElementById('todos').addEventListener('change', function (ev) {
  var lista = visibles();
  elegidos = {};
  if (ev.target.checked) lista.forEach(function (n) { elegidos[n.id] = true; });
  pintarLista();
});
document.getElementById('numeros').addEventListener('click', function (ev) {
  if (ev.target.closest('a')) return;
  var tr = ev.target.closest('tr.fila');
  if (!tr) return;
  var id = tr.getAttribute('data-id');
  if (elegidos[id]) delete elegidos[id]; else elegidos[id] = true;
  var cb = tr.querySelector('input.casilla');
  if (cb) cb.checked = Boolean(elegidos[id]);
  tr.classList.toggle('elegida', Boolean(elegidos[id]));
  pintarBarra();
});
document.getElementById('barra').addEventListener('click', function (ev) {
  var b = ev.target.closest('.acc button[data-accion]');
  if (!b || b.disabled) return;
  hacer(b.getAttribute('data-accion')).catch(function (e) { var r = document.getElementById('resultado'); r.className = 'resultado malo'; r.textContent = e.message; });
});

/* Los números se mueven solos con cada mensaje: se refresca cada 7 s y al volver a la pestaña (nunca con un cuadro abierto ni a mitad de una acción). */
function refrescar() {
  if (!DISPONIBLE || ocupado || document.hidden || document.querySelector('.dlg-fondo')) return;
  cargar().catch(function () { /* el refresco de fondo no molesta con avisos */ });
}
setInterval(refrescar, 7000);
document.addEventListener('visibilitychange', function () { if (!document.hidden) refrescar(); });
window.addEventListener('focus', refrescar);

if (DISPONIBLE) cargar().catch(function (e) { document.getElementById('numeros').innerHTML = '<tr><td colspan="4" class="mensaje">' + esc(e.message) + '</td></tr>'; });
else {
  pintarFiltros();
  document.getElementById('numeros').innerHTML = '<tr><td colspan="4" class="mensaje">Los números del día no están disponibles en este arranque.</td></tr>';
}
`;

  return appShell({
    titulo: 'Números del día',
    subtitulo: 'Todos los números que pasó GSG hoy y en qué punto va cada uno',
    contenido,
    script,
    css: CSS,
    nombreNegocio: opts.nombreNegocio,
    demo: opts.demo,
    icono: '📋',
  });
}
