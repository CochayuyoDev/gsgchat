/**
 * Las personas de los procesos, en dos pantallas con la misma pieza:
 *  - /procesos/corrida?id=: una corrida (la lista que se cargo), con su avance;
 *  - /personas: todas las personas de todos los procesos.
 *
 * Toma el patron de «Números del día»: filtros por estado con su contador,
 * buscar, «Marcar todos» o una por una, y la barra de acciones (pedir ahora,
 * pausar, pasar a una persona, cancelar). Los estados cambian solos con cada
 * respuesta: la pantalla se refresca cada pocos segundos.
 */

import { appShell } from '../web/shell.js';
import { COMUN_CSS, COMUN_JS } from './pagina-comun.js';

const CSS = `
  .cabecera { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: var(--esp-3); }
  .cabecera .que { flex: 1 1 260px; min-width: 0; }
  .cabecera .que b { font-size: 16px; overflow-wrap: anywhere; }
  .cabecera .que .muted { font-size: 13.5px; }
  .avance { height: 10px; background: var(--gris-suave); border-radius: 999px; overflow: hidden; margin: 6px 0 2px; }
  .avance i { display: block; height: 100%; background: var(--verde); transition: width .4s ease; }
  .filtros { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: var(--esp-3); }
  .filtro { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 8px 14px; border: 1px solid var(--borde); border-radius: 999px; background: var(--superficie); color: var(--texto); font: inherit; font-weight: 600; cursor: pointer; }
  .filtro .n { display: inline-block; min-width: 26px; padding: 1px 8px; border-radius: 999px; background: var(--gris-suave); color: var(--texto); font-size: 13px; text-align: center; }
  .filtro[aria-pressed="true"] { background: var(--primario); border-color: var(--primario); color: var(--primario-texto); }
  .filtro[aria-pressed="true"] .n { background: rgba(255,255,255,.25); color: inherit; }
  .filtro.rojo:not([aria-pressed="true"]) .n.hay { background: var(--rojo-suave); color: var(--rojo); }
  .buscar { display: flex; gap: 8px; margin-bottom: var(--esp-3); flex-wrap: wrap; }
  .buscar input, .buscar select { flex: 1 1 220px; min-height: 44px; padding: 8px 14px; border: 1px solid var(--borde); border-radius: var(--radio-sm); font: inherit; background: var(--superficie); color: var(--texto); min-width: 0; }
  .barra { position: sticky; top: 0; z-index: 5; background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); box-shadow: var(--sombra); padding: 10px 12px; margin-bottom: var(--esp-3); }
  .barra .sel { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
  .barra .sel label { display: inline-flex; align-items: center; gap: 10px; font-weight: 600; cursor: pointer; min-height: 44px; }
  .barra .acc { display: flex; gap: 8px; flex-wrap: wrap; }
  .barra .acc .btn { min-height: 46px; }
  .barra .acc .btn[disabled] { opacity: .45; cursor: not-allowed; }
  .barra .pista { font-size: 13px; color: var(--texto-suave); margin-top: 8px; }
  input[type="checkbox"].casilla { width: 22px; height: 22px; accent-color: var(--primario); cursor: pointer; flex: 0 0 auto; }
  .caja { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); overflow: hidden; box-shadow: var(--sombra); }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--borde); vertical-align: top; }
  th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--texto-suave); font-weight: 700; }
  tr:last-child td { border-bottom: 0; }
  #personas > tr.fila { cursor: pointer; }
  #personas > tr.fila:hover > td { background: var(--superficie-2); }
  #personas > tr.fila.elegida > td { background: var(--primario-suave); }
  #personas > tr.movido > td { animation: movido 2.5s ease-out; }
  @keyframes movido { from { background: var(--ambar-suave); } to { background: transparent; } }
  td.casilla-td { width: 44px; }
  td .sub { color: var(--texto-suave); font-size: var(--fs-small); margin-top: 3px; line-height: 1.35; overflow-wrap: anywhere; }
  td .sub.motivo { color: var(--rojo); }
  td .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
  td a { color: var(--primario); }
  td.mensaje { color: var(--texto-suave); text-align: center; padding: 24px; }
  .resps { margin: 0; padding: 0; list-style: none; display: grid; gap: 3px; font-size: 13.5px; }
  .resps li { overflow-wrap: anywhere; }
  .resps b { font-weight: 600; }
  .historial { max-height: 55vh; overflow: auto; display: grid; gap: 6px; margin: 8px 0 0; padding: 0; list-style: none; font-size: 13.5px; }
  .historial li { border-left: 3px solid var(--borde); padding: 2px 0 2px 8px; overflow-wrap: anywhere; }
  .historial small { color: var(--texto-suave); display: block; }
  @media (max-width: 760px) {
    .filtro { min-height: 42px; padding: 6px 12px; font-size: 14px; }
    .barra .acc .btn { flex: 1 1 calc(50% - 8px); padding: 10px 8px; }
    .caja { background: transparent; border: 0; box-shadow: none; }
    .caja thead { display: none; }
    .caja table, .caja tbody, .caja tr, .caja td { display: block; }
    #personas > tr.fila { position: relative; border: 1px solid var(--borde); border-radius: var(--radio); margin: 0 0 10px; padding: 10px 12px 10px 50px; background: var(--superficie); box-shadow: var(--sombra); }
    #personas > tr.fila.elegida { border-color: var(--primario); }
    #personas > tr.fila > td { border: 0; padding: 3px 0; background: transparent !important; }
    #personas > tr.fila > td.casilla-td { position: absolute; left: 14px; top: 14px; width: auto; padding: 0; }
  }
`;

export function personasPage(opts: { demo: boolean; nombreNegocio: string; modo: 'corrida' | 'todas' }): string {
  const corrida = opts.modo === 'corrida';
  const contenido = `
<div class="wrap">
${opts.demo ? '<div class="demo">Demostración: nada sale a WhatsApp de verdad.</div>' : ''}
<div class="cabecera" id="cabecera"><div class="que"><b>${corrida ? 'Cargando la corrida…' : 'Todas las personas de tus procesos'}</b><div class="muted" id="cab-sub">${corrida ? '' : 'Quién va en qué paso, qué respondió y quién necesita a alguien.'}</div>${corrida ? '<div class="avance" id="avance" aria-hidden="true"><i style="width:0%"></i></div>' : ''}</div><div class="acciones" id="cab-acciones"></div></div>
<div class="resultado" id="resultado" role="status" aria-live="polite"></div>
<div class="filtros" id="filtros" role="group" aria-label="Filtrar por estado"></div>
<div class="buscar">
  <input type="search" id="buscar" placeholder="Buscar por nombre o teléfono" aria-label="Buscar por nombre o teléfono" autocomplete="off">
  ${corrida ? '' : '<select id="proceso" aria-label="Filtrar por proceso"><option value="">Todos los procesos</option></select>'}
</div>
<div class="barra" id="barra">
  <div class="sel"><label><input type="checkbox" class="casilla" id="todos"> <span id="todos-txt">Marcar todos</span></label><span class="cuantos" id="cuantos" aria-live="polite">Ninguna seleccionada</span></div>
  <div class="acc">
    <button class="btn primario" type="button" data-accion="pedir_ahora" disabled>▶ Pedir ahora</button>
    <button class="btn" type="button" data-accion="pausa" id="btn-pausa" disabled>⏸ Pausar mensajes</button>
    <button class="btn" type="button" data-accion="persona" disabled>🙋 Pasar a una persona</button>
    <button class="btn" type="button" data-accion="cancelar" disabled>Cancelar</button>
  </div>
  <div class="pista" id="pista">Marca una o varias personas (o «Marcar todos») para usar estos botones.</div>
</div>
<div class="caja">
  <table>
    <thead><tr><th></th><th>Persona</th>${corrida ? '' : '<th>Proceso</th>'}<th>En qué va</th><th>Lo que respondió</th></tr></thead>
    <tbody id="personas"><tr><td colspan="${corrida ? 4 : 5}" class="mensaje">Cargando…</td></tr></tbody>
  </table>
</div>
</div>
`;

  const script = String.raw`
${COMUN_JS}
var MODO = '${corrida ? 'corrida' : 'todas'}';
var COLS = ${corrida ? 4 : 5};
var ID = Number(paramUrl('id')) || 0;
var FILTROS = [
  { id: 'todos', etiqueta: 'Todas', estados: null },
  { id: 'pendiente', etiqueta: 'Por escribirle', estados: ['pendiente'] },
  { id: 'esperando', etiqueta: 'Esperando respuesta', estados: ['esperando'] },
  { id: 'programada', etiqueta: 'Programadas', estados: ['programada'] },
  { id: 'persona', etiqueta: 'Necesitan a alguien', estados: ['persona'], rojo: true },
  { id: 'completada', etiqueta: 'Completadas', estados: ['completada'] },
  { id: 'cerradas', etiqueta: 'No respondieron o dijeron no', estados: ['sin_respuesta', 'rechazo', 'cancelada'] },
  { id: 'error', etiqueta: 'No se les puede escribir', estados: ['error'], rojo: true }
];
var datos = null;
var filtro = paramUrl('filtro') || 'todos';
if (!FILTROS.some(function (f) { return f.id === filtro; })) filtro = 'todos';
var procesoFiltro = paramUrl('proceso') || '';
var elegidos = {};
var antes = {};
var ocupado = false;

function contar() {
  var c = {};
  FILTROS.forEach(function (f) { c[f.id] = 0; });
  (datos ? datos.personas : []).forEach(function (p) {
    c.todos++;
    FILTROS.forEach(function (f) { if (f.estados && f.estados.indexOf(p.estado) >= 0) c[f.id]++; });
  });
  return c;
}
function visibles() {
  if (!datos) return [];
  var f = FILTROS.filter(function (x) { return x.id === filtro; })[0];
  var q = document.getElementById('buscar').value.trim().toLowerCase();
  var qd = q.replace(/\D/g, '');
  return datos.personas.filter(function (p) {
    if (f && f.estados && f.estados.indexOf(p.estado) < 0) return false;
    if (procesoFiltro && String(p.procesoId) !== String(procesoFiltro)) return false;
    if (!q) return true;
    if (String(p.nombre || '').toLowerCase().indexOf(q) >= 0) return true;
    if (qd && String(p.telefono).indexOf(qd) >= 0) return true;
    return false;
  });
}
function pintarFiltros() {
  var c = contar();
  document.getElementById('filtros').innerHTML = FILTROS.map(function (f) {
    return '<button type="button" class="filtro' + (f.rojo ? ' rojo' : '') + '" data-filtro="' + f.id + '" aria-pressed="' + (filtro === f.id ? 'true' : 'false') + '">' + esc(f.etiqueta) + ' <span class="n' + (c[f.id] ? ' hay' : '') + '">' + c[f.id] + '</span></button>';
  }).join('');
}
function fila(p) {
  var marcado = Boolean(elegidos[p.id]);
  var nombre = p.nombre || 'Sin nombre';
  var chips = chip(p.tono, p.estadoNombre);
  if (p.pausada) chips += chip('ambar', 'Mensajes en pausa');
  if (p.sub) chips += chip('azul', p.sub);
  var paso = p.totalPasos && p.estado !== 'completada' && p.estado !== 'error' ? '<div class="sub">Paso ' + p.pasoN + ' de ' + p.totalPasos + ': ' + esc(p.paso) + '</div>' : '';
  var ultimo = p.ultimo ? '<div class="sub">' + esc(p.ultimo) + ' · ' + esc(hora(p.actualizado)) + '</div>' : '';
  var motivo = p.motivo && (p.estado === 'persona' || p.estado === 'error' || p.estado === 'sin_respuesta') ? '<div class="sub motivo">' + esc(p.motivo) + '</div>' : '';
  var resps = p.respuestas.length ? '<ul class="resps">' + p.respuestas.map(function (r) { return '<li><b>' + esc(r.titulo) + ':</b> ' + esc(r.texto) + (r.enlace ? ' · <a href="' + esc(r.enlace) + '" target="_blank" rel="noopener">' + esc(r.enlaceTexto || 'Ver') + '</a>' : '') + '</li>'; }).join('') + '</ul>' : '<span class="muted">Todavía nada.</span>';
  var movido = antes[p.id] && antes[p.id] !== p.estado;
  return '<tr class="fila' + (marcado ? ' elegida' : '') + (movido ? ' movido' : '') + '" data-id="' + p.id + '">' +
    '<td class="casilla-td"><input type="checkbox" class="casilla" data-id="' + p.id + '"' + (marcado ? ' checked' : '') + ' aria-label="' + esc('Seleccionar a ' + nombre) + '"></td>' +
    '<td><b>' + esc(nombre) + '</b><div class="sub">' + esc(telBonito(p.telefono)) + '</div><div class="sub">' + (p.conTelefono ? '<a href="/chat?phone=' + encodeURIComponent(p.telefono) + '">Abrir chat</a> · ' : '') + '<a href="#" data-historial="' + p.id + '">Historial</a></div></td>' +
    (MODO === 'todas' ? '<td>' + esc(p.proceso) + '<div class="sub"><a href="/procesos/corrida?id=' + p.corridaId + '">Ver su corrida</a></div></td>' : '') +
    '<td><div class="chips">' + chips + '</div>' + paso + ultimo + motivo + '</td>' +
    '<td>' + resps + '</td></tr>';
}
function vacio() {
  if (!datos || !datos.personas.length) return MODO === 'corrida' ? 'Esta corrida no tiene personas.' : 'Todavía no hay personas en ningún proceso. Carga una lista desde Procesos.';
  if (document.getElementById('buscar').value.trim()) return 'Nadie de este filtro coincide con lo que buscas.';
  return 'No hay nadie en este filtro ahora mismo.';
}
function seleccionadas() { return datos ? datos.personas.filter(function (p) { return elegidos[p.id]; }) : []; }
function pintarBarra(lista) {
  lista = lista || visibles();
  var sel = seleccionadas();
  var n = sel.length;
  var todos = document.getElementById('todos');
  todos.checked = lista.length > 0 && n === lista.length;
  todos.indeterminate = n > 0 && n < lista.length;
  todos.disabled = !lista.length;
  document.getElementById('todos-txt').textContent = lista.length ? 'Marcar todos (los ' + lista.length + ' de este filtro)' : 'Marcar todos';
  document.getElementById('cuantos').textContent = n ? (n === 1 ? '1 seleccionada' : n + ' seleccionadas') : 'Ninguna seleccionada';
  document.querySelectorAll('#barra .acc .btn').forEach(function (b) { b.disabled = !n || ocupado; });
  var pausadas = n > 0 && sel.every(function (x) { return x.pausada; });
  var bp = document.getElementById('btn-pausa');
  bp.textContent = pausadas ? '▶ Reanudar mensajes' : '⏸ Pausar mensajes';
  bp.setAttribute('data-modo', pausadas ? 'reanudar' : 'pausar');
  document.getElementById('pista').textContent = ocupado ? 'Haciéndolo…' : n ? 'Lo que pulses se hace con ' + (n === 1 ? 'la persona marcada' : 'las ' + n + ' personas marcadas') + '.' : 'Marca una o varias personas (o «Marcar todos») para usar estos botones.';
}
function pintarLista() {
  var lista = visibles();
  var ids = {};
  lista.forEach(function (p) { ids[p.id] = true; });
  Object.keys(elegidos).forEach(function (id) { if (!ids[id]) delete elegidos[id]; });
  document.getElementById('personas').innerHTML = lista.length ? lista.map(fila).join('') : '<tr><td colspan="' + COLS + '" class="mensaje">' + esc(vacio()) + '</td></tr>';
  pintarBarra(lista);
}
function pintarCabecera() {
  if (MODO !== 'corrida' || !datos || !datos.corrida) {
    document.getElementById('cab-acciones').innerHTML = '<a class="btn" href="/admin/procesos/exportar' + (procesoFiltro ? '?procesoId=' + encodeURIComponent(procesoFiltro) : '') + '" id="exportar">⬇ Exportar CSV</a>';
    return;
  }
  var c = datos.corrida;
  var total = datos.personas.length;
  var hechas = datos.personas.filter(function (p) { return ['completada', 'rechazo', 'sin_respuesta', 'cancelada'].indexOf(p.estado) >= 0; }).length;
  document.querySelector('#cabecera .que b').textContent = c.nombre;
  document.getElementById('cab-sub').innerHTML = esc(datos.proceso.nombre) + ' · ' + hechas + ' de ' + total + ' terminadas · cargada el ' + esc(fechaCorta(c.creada)) + (c.estado === 'pausada' ? ' · ' + chip('ambar', 'En pausa') : c.estado === 'terminada' ? ' · ' + chip('gris', 'Terminada') : '');
  document.querySelector('#avance i').style.width = (total ? Math.round(100 * hechas / total) : 0) + '%';
  var botones = '<a class="btn" href="/admin/procesos/exportar?corridaId=' + c.id + '" id="exportar">⬇ Exportar CSV</a>';
  if (c.estado === 'activa') botones += '<button class="btn" type="button" data-corrida="pausada">⏸ Pausar corrida</button>';
  if (c.estado === 'pausada') botones += '<button class="btn primario" type="button" data-corrida="activa">▶ Reanudar corrida</button>';
  if (c.estado !== 'terminada') botones += '<button class="btn" type="button" data-corrida="terminada">Terminar</button>';
  botones += '<a class="btn" href="/procesos/editor?id=' + datos.proceso.id + '">Ver el proceso</a>';
  document.getElementById('cab-acciones').innerHTML = botones;
  if (window.shellTitulo) window.shellTitulo(c.nombre, datos.proceso.nombre);
}
function pintar() { pintarCabecera(); pintarFiltros(); pintarLista(); }

async function cargar() {
  var viejos = {};
  if (datos) datos.personas.forEach(function (p) { viejos[p.id] = p.estado; });
  if (MODO === 'corrida') {
    if (!ID) throw new Error('Falta decir qué corrida abrir: entra desde Procesos.');
    datos = await api('/admin/procesos/corridas/' + ID);
  } else {
    datos = await api('/admin/procesos/personas?limit=3000');
    var sel = document.getElementById('proceso');
    if (sel && sel.options.length <= 1) {
      datos.procesos.forEach(function (p) { var o = document.createElement('option'); o.value = String(p.id); o.textContent = p.nombre; sel.appendChild(o); });
      sel.value = procesoFiltro;
    }
  }
  antes = viejos;
  pintar();
  antes = {};
}

async function hacer(accion) {
  var sel = seleccionadas();
  if (!sel.length || ocupado) return;
  if (accion === 'pausa') accion = document.getElementById('btn-pausa').getAttribute('data-modo') || 'pausar';
  var textos = {
    pedir_ahora: ['Pedir ahora', 'Se les escribe ahora lo que les falta a ' + sel.length + ' personas, de una en una y con la pausa de siempre. A quien estaba con una persona o no respondió, se le retoma su paso.', 'Sí, escribirles'],
    persona: ['Pasar a una persona', 'El sistema deja de escribirles a ' + sel.length + ' personas: las atiende alguien del equipo desde Chats.', 'Sí, pasarlas'],
    cancelar: ['Cancelar', 'No se les vuelve a escribir a ' + sel.length + ' personas por este proceso.', 'Sí, cancelar']
  };
  if (textos[accion] && (sel.length > 1 || accion === 'cancelar')) {
    var si = await confirmarDialogo({ titulo: textos[accion][0], texto: textos[accion][1], boton: textos[accion][2], peligro: accion === 'cancelar' });
    if (!si) return;
  }
  ocupado = true; pintarBarra();
  try {
    var r = await api('/admin/procesos/personas/masa', { method: 'POST', body: { accion: accion, ids: sel.map(function (x) { return x.id; }) } });
    avisar(r.aviso, !r.hechos);
    elegidos = {};
  } catch (e) { avisar(e.message, true, e.ir); }
  finally { ocupado = false; }
  try { await cargar(); } catch (e) { pintarBarra(); }
}

async function verHistorial(id) {
  try {
    var d = await api('/admin/procesos/personas/' + id);
    var fondo = document.createElement('div');
    fondo.className = 'dlg-fondo';
    fondo.innerHTML = '<div class="dlg" role="dialog" aria-modal="true" aria-labelledby="h-titulo"><h3 id="h-titulo"></h3><p id="h-sub"></p><ul class="historial">' +
      (d.eventos.length ? d.eventos.map(function (e) { return '<li>' + esc(e.detalle || e.tipo) + '<small>' + esc(fechaCorta(e.en)) + '</small></li>'; }).join('') : '<li>Todavía no pasó nada con esta persona.</li>') +
      '</ul><div class="botones"><button type="button" class="principal" id="h-cerrar">Cerrar</button></div></div>';
    fondo.querySelector('#h-titulo').textContent = 'Historial de ' + (d.persona.nombre || telBonito(d.persona.telefono));
    fondo.querySelector('#h-sub').textContent = d.persona.proceso + ' · ' + d.persona.estadoNombre;
    function cerrar() { fondo.remove(); document.removeEventListener('keydown', tecla); }
    function tecla(ev) { if (ev.key === 'Escape') cerrar(); }
    fondo.querySelector('#h-cerrar').onclick = cerrar;
    fondo.addEventListener('click', function (ev) { if (ev.target === fondo) cerrar(); });
    document.addEventListener('keydown', tecla);
    document.body.appendChild(fondo);
    fondo.querySelector('#h-cerrar').focus();
  } catch (e) { avisar(e.message, true); }
}

document.getElementById('filtros').addEventListener('click', function (ev) {
  var b = ev.target.closest('button[data-filtro]');
  if (!b) return;
  filtro = b.getAttribute('data-filtro'); elegidos = {};
  pintarFiltros(); pintarLista();
});
document.getElementById('buscar').addEventListener('input', function () { pintarLista(); });
var selProc = document.getElementById('proceso');
if (selProc) selProc.addEventListener('change', function () { procesoFiltro = selProc.value; elegidos = {}; pintar(); });
document.getElementById('todos').addEventListener('change', function (ev) {
  elegidos = {};
  if (ev.target.checked) visibles().forEach(function (p) { elegidos[p.id] = true; });
  pintarLista();
});
document.getElementById('personas').addEventListener('click', function (ev) {
  var h = ev.target.closest('[data-historial]');
  if (h) { ev.preventDefault(); verHistorial(h.getAttribute('data-historial')); return; }
  if (ev.target.closest('a')) return;
  var tr = ev.target.closest('tr.fila');
  if (!tr) return;
  var id = tr.getAttribute('data-id');
  if (elegidos[id]) delete elegidos[id]; else elegidos[id] = true;
  var cb = tr.querySelector('input.casilla'); if (cb) cb.checked = Boolean(elegidos[id]);
  tr.classList.toggle('elegida', Boolean(elegidos[id]));
  pintarBarra();
});
document.getElementById('barra').addEventListener('click', function (ev) {
  var b = ev.target.closest('.acc button[data-accion]');
  if (!b || b.disabled) return;
  hacer(b.getAttribute('data-accion'));
});
document.getElementById('cab-acciones').addEventListener('click', async function (ev) {
  var b = ev.target.closest('button[data-corrida]');
  if (!b) return;
  var estado = b.getAttribute('data-corrida');
  if (estado === 'terminada') {
    var si = await confirmarDialogo({ titulo: 'Terminar la corrida', texto: 'A quien seguía en curso ya no se le escribe por esta lista. Lo que ya respondieron se conserva.', boton: 'Sí, terminar', peligro: true });
    if (!si) return;
  }
  try {
    var r = await api('/admin/procesos/corridas/' + ID + '/estado', { method: 'POST', body: { estado: estado } });
    avisar(r.aviso);
    await cargar();
  } catch (e) { avisar(e.message, true, e.ir); }
});

function refrescar() {
  if (ocupado || document.hidden || document.querySelector('.dlg-fondo')) return;
  cargar().catch(function () {});
}
setInterval(refrescar, 7000);
document.addEventListener('visibilitychange', function () { if (!document.hidden) refrescar(); });
cargar().catch(function (e) {
  document.getElementById('personas').innerHTML = '<tr><td colspan="' + COLS + '" class="mensaje">' + esc(e.message) + ' <a href="/procesos">Ir a Procesos</a></td></tr>';
  pintarFiltros();
});
`;

  return appShell({
    titulo: corrida ? 'Corrida' : 'Personas',
    subtitulo: corrida ? 'Una lista de personas en un proceso' : 'Quién va en qué paso y quién necesita a alguien',
    contenido,
    script,
    css: COMUN_CSS + CSS,
    nombreNegocio: opts.nombreNegocio,
    demo: opts.demo,
    icono: corrida ? '📋' : '👥',
  });
}
