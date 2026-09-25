/**
 * Pantalla "Números del día" (y, filtrada con ?etapa=contactados,
 * "Ubicaciones registradas"): la lista que GSG pasa por la API, número por
 * número, con en qué paso va cada uno.
 *
 * Mismo lenguaje que Hoy: arriba la lista de GSG por confirmar (si la hay),
 * luego pestañas simples y una fila por cliente (nombre, teléfono, paso,
 * «📍 Ver en el mapa» con sus coordenadas y el motorizado).
 *
 * Los filtros no son marcas: salen del estado de cada entrega y cambian
 * solos con cada mensaje que llega (manda su pin → pasa a «Falta
 * confirmar»; dice que sí → pasa a «Ubicación registrada»). Por eso la
 * pantalla se refresca sola cada pocos segundos y al volver a la pestaña.
 *
 * Con las casillas se eligen uno, varios o todos los del filtro; la barra
 * de acciones solo aparece al marcar algo y hace la accion con todos a la
 * vez (POST /admin/entregas/masa, ver src/entregas/numeros.ts). El aviso de
 * lo que paso llega ya en palabras.
 *
 * El JS va en String.raw, con var y sin backticks, como el resto; todo dato
 * del servidor pasa por esc() antes de ir a innerHTML.
 */

import { appShell } from './shell.js';

const CSS = `
  * { box-sizing: border-box; }
  .wrap { color: var(--texto); font: var(--fs-cuerpo)/1.5 var(--fuente); max-width: 1180px; margin: 0 auto; display: flex; flex-direction: column; gap: var(--esp-4); }
  .wrap a { color: var(--primario); }
  .muted { color: var(--texto-suave); }
  .hidden { display: none !important; }
  .demo { display: none; background: var(--ambar-suave); color: var(--ambar); padding: 8px 14px; font-size: var(--fs-small); text-align: center; border-radius: var(--radio-sm); font-weight: 600; }
  @media (max-width: 960px) { .demo { display: block; } }
  .aviso-fijo { background: var(--ambar-suave); color: var(--ambar); border-radius: var(--radio-sm); padding: 10px 14px; font-weight: 600; }

  /* «Llegaron N números de GSG»: igual que en Hoy. */
  .por-confirmar { background: var(--superficie); border: 1px solid var(--borde); border-left: 5px solid var(--ambar); border-radius: var(--radio); padding: 20px 22px; display: flex; gap: 16px 24px; align-items: center; flex-wrap: wrap; box-shadow: var(--sombra-2); }
  .por-confirmar .txt { flex: 1 1 320px; min-width: 0; }
  .por-confirmar h2 { margin: 0 0 4px; font-size: 21px; line-height: 1.25; letter-spacing: -.01em; }
  .por-confirmar p { margin: 0 0 10px; color: var(--texto-suave); font-size: 13.5px; }
  .por-confirmar .grupos { display: flex; gap: 8px; flex-wrap: wrap; }
  .por-confirmar .grupo { display: inline-flex; gap: 6px; align-items: center; padding: 5px 12px; border-radius: 999px; background: var(--superficie-2); font-weight: 600; font-size: 14px; }
  .por-confirmar .acc { display: flex; flex-direction: column; gap: 8px; min-width: 240px; }
  .por-confirmar .btn.grande { min-height: 50px; padding: 12px 24px; font-size: 16px; font-weight: 700; }

  /* Las pestañas: una linea, la elegida subrayada. */
  .pestanas { display: flex; gap: 4px 2px; flex-wrap: wrap; border-bottom: 1px solid var(--borde); }
  .filtro { display: inline-flex; align-items: center; gap: 8px; min-height: 42px; padding: 8px 14px; border: 0; border-bottom: 3px solid transparent; margin-bottom: -1px; background: transparent; color: var(--texto-suave); font: inherit; font-weight: 600; font-size: 14px; cursor: pointer; }
  .filtro:hover { color: var(--texto); }
  .filtro .n { display: inline-block; min-width: 24px; padding: 0 7px; border-radius: 999px; background: var(--gris-suave); color: var(--texto-suave); font-size: 12.5px; text-align: center; }
  .filtro[aria-selected="true"] { color: var(--primario); border-bottom-color: var(--primario); }
  .filtro[aria-selected="true"] .n { background: var(--primario-suave); color: var(--primario); }
  .filtro.rojo .n.hay { background: var(--rojo-suave); color: var(--rojo); }
  .filtro.ambar .n.hay { background: var(--ambar-suave); color: var(--ambar); }

  .herramientas { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  .herramientas input[type="search"] { flex: 1 1 260px; min-height: 42px; padding: 8px 14px; border: 1px solid var(--borde); border-radius: var(--radio-sm); font: inherit; background: var(--superficie); color: var(--texto); }
  .herramientas select { min-height: 42px; padding: 8px 12px; border: 1px solid var(--borde); border-radius: var(--radio-sm); font: inherit; background: var(--superficie); color: var(--texto); }

  .resultado { border-radius: var(--radio-sm); padding: 10px 14px; background: var(--verde-suave); color: var(--verde); font-weight: 600; }
  .resultado.malo { background: var(--rojo-suave); color: var(--rojo); }
  .resultado:empty { display: none; }

  /* La lista: una fila por cliente. */
  .lista { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); box-shadow: var(--sombra); overflow: hidden; }
  .fila { display: grid; grid-template-columns: 34px minmax(0, 1.6fr) 150px 170px minmax(0, 1.5fr) minmax(0, 1fr); gap: 12px; align-items: center; padding: 13px 18px; border-bottom: 1px solid var(--borde); }
  .fila:last-child { border-bottom: 0; }
  .fila.cab { padding-top: 9px; padding-bottom: 9px; background: var(--superficie-2); font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--texto-suave); font-weight: 700; }
  .fila.cab label { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; text-transform: none; letter-spacing: 0; font-size: 13px; font-weight: 600; color: var(--texto); white-space: nowrap; }
  .fila.cab .todos-cab { grid-column: 1 / 3; }
  #numeros > .fila { cursor: pointer; }
  #numeros > .fila:hover { background: var(--superficie-2); }
  #numeros > .fila.elegida { background: var(--primario-suave); }
  #numeros > .fila.movido { animation: movido 2.5s ease-out; }
  @keyframes movido { from { background: var(--ambar-suave); } to { background: transparent; } }
  .fila b.nombre { font-size: 15px; }
  .fila .sub { color: var(--texto-suave); font-size: var(--fs-small); line-height: 1.35; margin-top: 2px; }
  .fila .tel { font-variant-numeric: tabular-nums; white-space: nowrap; font-size: 14px; }
  .fila .chip { font-size: 13px; }
  .fila .marca { margin-left: 6px; font-size: 11.5px; }
  .fila .mapa a { font-weight: 600; text-decoration: none; white-space: nowrap; }
  .fila .mapa .coords { display: block; font-size: 11.5px; color: var(--texto-suave); font-variant-numeric: tabular-nums; margin-top: 1px; }
  .fila .mot { font-size: 14px; min-width: 0; }
  input[type="checkbox"].casilla { width: 20px; height: 20px; accent-color: var(--primario); cursor: pointer; flex: 0 0 auto; margin: 0; }
  .mensaje { color: var(--texto-suave); text-align: center; padding: 28px 16px; }

  /* La barra de acciones: solo con algo marcado, pegada abajo. */
  .barra { position: sticky; bottom: 12px; z-index: 5; background: var(--superficie); border: 1px solid var(--primario); border-radius: var(--radio); box-shadow: var(--sombra-2); padding: 12px 14px; display: flex; gap: 10px 14px; align-items: center; flex-wrap: wrap; }
  .barra .cuantos { font-weight: 700; white-space: nowrap; }
  .barra .acc { display: flex; gap: 8px; flex-wrap: wrap; flex: 1; }
  .barra .acc .btn[disabled] { opacity: .45; cursor: not-allowed; }
  .barra .pista { width: 100%; font-size: 12.5px; color: var(--texto-suave); }

  .explica { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); padding: 12px 16px; }
  .explica summary { color: var(--texto-suave); font-size: 13.5px; cursor: pointer; }
  .explica p { margin: 8px 0 0; font-size: 13.5px; }

  @media (max-width: 1000px) {
    .fila { grid-template-columns: 34px minmax(0, 1.5fr) 140px 160px minmax(0, 1.3fr); }
    .fila .mot, .fila.cab .c-mot { display: none; }
    .fila .mot-movil { display: block; }
  }
  .mot-movil { display: none; }
  /* En el celular cada número es una tarjeta con su casilla a la izquierda. */
  @media (max-width: 760px) {
    .por-confirmar { padding: 16px; }
    .por-confirmar h2 { font-size: 19px; }
    .por-confirmar .acc { min-width: 0; width: 100%; }
    /* Sin sitio para una linea: las pestañas pasan a pastillas. */
    .pestanas { border-bottom: 0; gap: 6px; }
    .filtro { padding: 6px 12px; min-height: 38px; font-size: 13.5px; border: 1px solid var(--borde); border-radius: 999px; margin: 0; background: var(--superficie); }
    .filtro[aria-selected="true"] { background: var(--primario); border-color: var(--primario); color: var(--primario-texto); }
    .filtro[aria-selected="true"] .n { background: rgba(255,255,255,.25); color: inherit; }
    .barra .cuantos { width: 100%; }
    .lista { background: transparent; border: 0; box-shadow: none; overflow: visible; }
    .fila.cab { background: transparent; padding: 0 2px 8px; border: 0; display: block; }
    .fila.cab > span:not(.todos-cab) { display: none; }
    #numeros > .fila { grid-template-columns: 30px minmax(0, 1fr) auto; grid-template-areas: "casilla quien quien" "casilla tel paso" "casilla mapa mapa"; gap: 6px 10px; align-items: start; border: 1px solid var(--borde); border-radius: var(--radio); margin-bottom: 10px; background: var(--superficie); box-shadow: var(--sombra); padding: 14px 14px 14px 12px; }
    #numeros > .fila.elegida { border-color: var(--primario); background: var(--primario-suave); }
    #numeros > .fila:last-child { border-bottom: 1px solid var(--borde); }
    .fila .c-casilla { grid-area: casilla; padding-top: 2px; } .fila .quien { grid-area: quien; } .fila .tel { grid-area: tel; } .fila .c-paso { grid-area: paso; justify-self: end; } .fila .mapa { grid-area: mapa; }
    .barra { bottom: 72px; padding: 10px; }
    .barra .acc .btn { flex: 1 1 calc(50% - 8px); }
  }
`;

const TITULOS: Record<string, { titulo: string; sub: string }> = {
  contactados: { titulo: 'Ubicaciones registradas', sub: 'Clientes que ya mandaron su ubicación o confirmaron' },
};
const TITULO_BASE = { titulo: 'Números del día', sub: 'Los números que pasó GSG hoy y en qué paso va cada uno' };

export function numerosPage(opts: { disponible: boolean; demo: boolean; nombreNegocio: string; etapa?: string }): string {
  const cabecera = (opts.etapa && TITULOS[opts.etapa]) || TITULO_BASE;
  const contenido = `
<div class="wrap">
${opts.demo ? '<div class="demo">Demostración: nada sale a WhatsApp de verdad.</div>' : ''}
${opts.disponible ? '' : '<div class="explica"><b>Los números del día no están disponibles en este arranque del sistema.</b> Si esperabas verlos, mira en <a href="/soporte">Soporte</a> qué hacer.</div>'}

<div class="aviso-fijo hidden" id="fuera-horario" role="status"></div>

<section class="por-confirmar hidden" id="por-confirmar" aria-live="polite">
  <div class="txt">
    <h2 id="pc-titulo"></h2>
    <p>Todavía no se le escribió a ninguno. Salen de uno en uno, con la pausa de siempre.</p>
    <div class="grupos" id="pc-grupos"></div>
  </div>
  <div class="acc">
    <button class="btn primario grande" type="button" id="pc-todos">Confirmar y enviar a todos</button>
    <button class="btn" type="button" id="pc-ver">Ver solo los que esperan</button>
  </div>
</section>

<div class="pestanas" id="filtros" role="tablist" aria-label="Filtrar los números"></div>

<div class="herramientas">
  <input type="search" id="buscar" placeholder="Buscar por nombre, teléfono o pedido" aria-label="Buscar por nombre, teléfono o pedido" autocomplete="off">
  <span id="grupos"><select id="grupo-sel" aria-label="Qué se le manda"></select></span>
</div>

<div class="resultado" id="resultado" role="status" aria-live="polite"></div>

<div class="lista" role="table" aria-label="Números">
  <div class="fila cab" role="row">
    <span class="todos-cab"><label><input type="checkbox" class="casilla" id="todos"> <span id="todos-txt">Marcar todos</span></label></span>
    <span>Teléfono</span><span>En qué paso va</span><span>Ubicación</span><span class="c-mot">Motorizado</span>
  </div>
  <div id="numeros"><div class="mensaje">Cargando…</div></div>
</div>

<div class="barra hidden" id="barra" role="region" aria-label="Acciones con los marcados">
  <span class="cuantos" id="cuantos" aria-live="polite">Ninguno seleccionado</span>
  <div class="acc">
    <button class="btn primario" type="button" data-accion="confirmar_envio" id="btn-enviar-marcados" disabled>📤 Enviar a los marcados</button>
    <button class="btn" type="button" data-accion="pedir_ubicacion" disabled>📍 Pedir ubicación</button>
    <button class="btn" type="button" data-accion="pedir_confirmacion" disabled>✅ Pedir confirmación</button>
    <button class="btn" type="button" data-accion="marcar_contactado" disabled>☎️ Marcar como contactado</button>
    <button class="btn" type="button" data-accion="quitar_marca" id="btn-quitar-marca" disabled>Quitar marca</button>
    <button class="btn" type="button" data-accion="pausa" id="btn-pausa" disabled>⏸ Pausar mensajes</button>
    <button class="btn" type="button" id="btn-desmarcar">Desmarcar</button>
  </div>
  <div class="pista" id="pista"></div>
</div>

<details class="explica">
  <summary>¿Cómo pasan los números de una pestaña a otra?</summary>
  <p>Lo que llega de GSG <b>no sale solo</b>: queda en «Por confirmar el envío» hasta que pulsas «Confirmar y enviar». GSG manda dos grupos: a los de <b>📍 pedir ubicación</b> se les pide el pin; a los de <b>✅ confirmar SÍ/NO</b> (GSG ya tiene su dirección) solo se les pregunta si lo reciben hoy, nunca la ubicación.</p>
  <p>Después se mueven solos, con cada mensaje que llega. A quien <b>todavía no se le escribió</b> está en «Falta pedir ubicación»; cuando se le pide el pin pasa a <b>«Falta su ubicación»</b>; en cuanto manda su ubicación pasa a <b>«Falta confirmar»</b>; y cuando dice que sí (o manda su ubicación cuando ya se le pedía confirmar) pasa a <b>«Ubicación registrada»</b>, igual que los que ya van con motorizado o están entregados.</p>
  <p class="muted">«Marcar como contactado» sirve para los que atendiste por otro lado (una llamada, por ejemplo). «Pausar» deja de pedirle la ubicación y la confirmación a ese número hasta que lo reanudes; lo que conteste se sigue leyendo.</p>
</details>
</div>
`;

  const script = String.raw`
var DISPONIBLE = ${opts.disponible ? 'true' : 'false'};
var FILTROS = [
  { id: 'todos', etiqueta: 'Todos' },
  { id: 'por_confirmar_envio', etiqueta: 'Por confirmar el envío', ambar: true, soloSiHay: true },
  { id: 'falta_pedir', etiqueta: 'Falta pedir ubicación' },
  { id: 'falta_ubicacion', etiqueta: 'Falta su ubicación' },
  { id: 'falta_confirmar', etiqueta: 'Falta confirmar' },
  { id: 'contactados', etiqueta: 'Ubicación registrada' },
  { id: 'necesita', etiqueta: 'Necesitan a alguien', rojo: true }
];
var ETAPA = {
  por_confirmar_envio: { nombre: 'Por enviar', tono: 'ambar' },
  falta_pedir: { nombre: 'Falta pedir ubicación', tono: 'gris' },
  falta_ubicacion: { nombre: 'Esperando ubicación', tono: 'ambar' },
  falta_confirmar: { nombre: 'Falta confirmar', tono: 'azul' },
  contactados: { nombre: 'Ubicación registrada', tono: 'verde' },
  necesita: { nombre: 'Necesita a alguien', tono: 'rojo' },
  cancelada: { nombre: 'Cancelado', tono: 'gris' }
};
/* El titulo de arriba cambia con la pestaña: «Ubicaciones registradas» es la de los que ya la mandaron. */
var TITULOS = {
  contactados: ['Ubicaciones registradas', 'Clientes que ya mandaron su ubicación o confirmaron']
};
var TITULO_BASE = ['Números del día', 'Los números que pasó GSG hoy y en qué paso va cada uno'];

var GRUPOS = [
  { id: 'todos', etiqueta: 'Los dos grupos' },
  { id: 'ubicacion', etiqueta: '📍 Pedir ubicación' },
  { id: 'confirmar', etiqueta: '✅ Confirmar SÍ/NO' }
];
var datos = null;
// El filtro puede venir en la dirección (?etapa=contactados = «Ubicaciones registradas» del menú).
var filtro = (function () { try { return new URLSearchParams(location.search).get('etapa') || 'todos'; } catch (e) { return 'todos'; } })();
var grupo = 'todos';
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
function chip(tono, texto, clase) { return '<span class="chip tono-' + tono + (clase ? ' ' + clase : '') + '">' + esc(texto) + '</span>'; }
function sinTildes(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

function ponerTitulo() {
  var t = TITULOS[filtro] || TITULO_BASE;
  if (window.shellTitulo) window.shellTitulo(t[0], t[1]);
  /* La direccion sigue a la pestaña: recargar (o compartir el enlace) abre la misma. */
  try {
    var url = new URL(location.href);
    if (filtro === 'todos') url.searchParams.delete('etapa'); else url.searchParams.set('etapa', filtro);
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  } catch (e) { /* sin history, no pasa nada */ }
}

function visibles() {
  if (!datos) return [];
  var q = sinTildes(document.getElementById('buscar').value.trim());
  var qDigitos = q.replace(/\D/g, '');
  return datos.numeros.filter(function (n) {
    if (filtro !== 'todos' && n.etapa !== filtro) return false;
    if (grupo !== 'todos' && n.grupo !== grupo) return false;
    if (!q) return true;
    if (sinTildes(n.nombre).indexOf(q) >= 0) return true;
    if (sinTildes(n.referencia).indexOf(q) >= 0) return true;
    if (qDigitos && String(n.telefono).indexOf(qDigitos) >= 0) return true;
    return false;
  });
}

function pintarFiltros() {
  var c = datos ? datos.cifras : {};
  document.getElementById('filtros').innerHTML = FILTROS.filter(function (f) {
    return !f.soloSiHay || (c[f.id] || 0) > 0 || filtro === f.id;
  }).map(function (f) {
    var n = c[f.id] || 0;
    return '<button type="button" role="tab" class="filtro' + (f.rojo ? ' rojo' : '') + (f.ambar ? ' ambar' : '') + '" data-filtro="' + f.id + '" aria-selected="' + (filtro === f.id ? 'true' : 'false') + '">' +
      esc(f.etiqueta) + ' <span class="n' + (n ? ' hay' : '') + '">' + n + '</span></button>';
  }).join('');
  var enFiltro = datos ? datos.numeros.filter(function (x) { return filtro === 'todos' || x.etapa === filtro; }) : [];
  document.getElementById('grupo-sel').innerHTML = GRUPOS.map(function (g) {
    var n = g.id === 'todos' ? enFiltro.length : enFiltro.filter(function (x) { return x.grupo === g.id; }).length;
    return '<option value="' + g.id + '"' + (grupo === g.id ? ' selected' : '') + '>' + esc(g.etiqueta) + ' (' + n + ')</option>';
  }).join('');
}

function pintarPorConfirmar() {
  var caja = document.getElementById('por-confirmar');
  var pc = datos && datos.porConfirmar;
  var hay = pc && pc.total > 0;
  caja.classList.toggle('hidden', !hay);
  if (!hay) return;
  document.getElementById('pc-titulo').textContent = 'Llegaron ' + (pc.total === 1 ? '1 número' : pc.total + ' números') + ' de GSG';
  document.getElementById('pc-grupos').innerHTML =
    '<span class="grupo">📍 ' + pc.ubicacion + ' para pedir ubicación</span>' +
    '<span class="grupo">✅ ' + pc.confirmar + ' para confirmar SÍ/NO</span>';
  var b = document.getElementById('pc-todos');
  b.textContent = 'Confirmar y enviar a todos (' + pc.total + ')';
  b.disabled = ocupado;
}

function coordenadas(n) {
  if (n.lat === null || n.lat === undefined || n.lng === null || n.lng === undefined) return '';
  return Number(n.lat).toFixed(5) + ', ' + Number(n.lng).toFixed(5);
}

function fila(n) {
  var e = ETAPA[n.etapa] || { nombre: n.etapa, tono: 'gris' };
  var marcado = Boolean(elegidos[n.id]);
  var nombre = n.nombre || 'Sin nombre';
  var marcas = '';
  if (n.urgente) marcas += chip('rojo', 'Urgente', 'sin-punto marca');
  if (n.pausado) marcas += chip('ambar', 'En pausa', 'sin-punto marca');
  if (n.contactadoAt) marcas += chip('verde', 'Marcado a mano', 'sin-punto marca');
  var sub = esc(n.referencia) + (n.distrito ? ' · ' + esc(n.distrito) : '') + (n.grupo === 'confirmar' ? ' · ✅ confirmar SÍ/NO' : '');
  var detalle = [];
  if (n.contactadoAt) detalle.push('Marcado como contactado' + (n.contactadoPor ? ' por ' + esc(n.contactadoPor) : '') + ' a las ' + esc(hora(n.contactadoAt)) + '.');
  if (n.pausado) detalle.push('No se le pide nada hasta que lo reanudes.');
  if (n.mismoCliente && n.mismoCliente.length) detalle.push('También tiene hoy: ' + n.mismoCliente.map(esc).join(', ') + '.');
  var coords = coordenadas(n);
  var mapa = n.mapa
    ? '<a href="' + esc(n.mapa) + '" target="_blank" rel="noopener">📍 Ver en el mapa</a>' + (coords ? '<span class="coords">' + esc(coords) + '</span>' : '')
    : '<span class="muted">Sin ubicación</span>';
  var mot = n.motorizado ? esc(n.motorizado) : '<span class="muted">—</span>';
  var movido = etapaAnterior[n.id] && etapaAnterior[n.id] !== n.etapa;
  return '<div class="fila' + (marcado ? ' elegida' : '') + (movido ? ' movido' : '') + '" data-id="' + n.id + '" role="row">' +
    '<div class="c-casilla" role="cell"><input type="checkbox" class="casilla" data-id="' + n.id + '"' + (marcado ? ' checked' : '') + ' aria-label="' + esc('Seleccionar a ' + nombre) + '"></div>' +
    '<div class="quien" role="cell"><b class="nombre">' + esc(nombre) + '</b>' + marcas + '<div class="sub">' + sub + '</div>' +
      (detalle.length ? '<div class="sub">' + detalle.join(' ') + '</div>' : '') +
      (n.motorizado ? '<div class="sub mot-movil">🛵 ' + mot + '</div>' : '') + '</div>' +
    '<div class="tel" role="cell">' + esc(telefonoBonito(n.telefono)) + '</div>' +
    '<div class="c-paso" role="cell"><span class="chip tono-' + e.tono + '" title="' + esc(n.punto) + '">' + esc(e.nombre) + '</span></div>' +
    '<div class="mapa" role="cell">' + mapa + '</div>' +
    '<div class="mot" role="cell">' + mot + '</div>' +
    '</div>';
}

function vacio() {
  if (!datos || !datos.numeros.length) {
    if (datos && datos.gsg && !datos.gsg.conectada) return 'Todavía no hay números de hoy y GSG no está conectado: conéctalo en Conexión o carga la lista en Hoy.';
    return 'Todavía no llegó ningún número de hoy. En cuanto GSG pase la lista, aparecen aquí.';
  }
  if (document.getElementById('buscar').value.trim()) return 'Ningún número de esta pestaña coincide con lo que buscas.';
  if (filtro === 'contactados') return 'Todavía nadie mandó su ubicación hoy.';
  return 'Nadie en esta pestaña ahora mismo.';
}

function pintarLista() {
  var lista = visibles();
  // Solo cuenta como seleccionado lo que se ve: un número que se movió de pestaña sale de la selección.
  var ids = {};
  lista.forEach(function (n) { ids[n.id] = true; });
  Object.keys(elegidos).forEach(function (id) { if (!ids[id]) delete elegidos[id]; });
  document.getElementById('numeros').innerHTML = lista.length ? lista.map(fila).join('') : '<div class="mensaje">' + esc(vacio()) + '</div>';
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
  document.getElementById('todos-txt').textContent = lista.length ? 'Marcar todos (' + lista.length + ')' : 'Marcar todos';
  /* La barra solo existe mientras hay algo marcado (o se esta haciendo algo). */
  document.getElementById('barra').classList.toggle('hidden', !n && !ocupado);
  document.getElementById('cuantos').textContent = n ? (n === 1 ? '1 seleccionado' : n + ' seleccionados') : 'Ninguno seleccionado';
  var botones = document.querySelectorAll('#barra .acc .btn[data-accion]');
  for (var i = 0; i < botones.length; i++) botones[i].disabled = !n || ocupado;
  var esperan = sel.filter(function (x) { return x.porConfirmar; }).length;
  var be = document.getElementById('btn-enviar-marcados');
  be.disabled = !esperan || ocupado;
  be.classList.toggle('hidden', !esperan);
  be.textContent = esperan ? '📤 Enviar a los marcados (' + esperan + ')' : '📤 Enviar a los marcados';
  document.getElementById('btn-quitar-marca').classList.toggle('hidden', !sel.some(function (x) { return x.contactadoAt; }));
  var todosPausados = n > 0 && sel.every(function (x) { return x.pausado; });
  var bp = document.getElementById('btn-pausa');
  bp.textContent = todosPausados ? '▶ Reanudar mensajes' : '⏸ Pausar mensajes';
  bp.setAttribute('data-modo', todosPausados ? 'reanudar' : 'pausar');
  document.getElementById('pista').textContent = ocupado ? 'Haciéndolo…' : '';
  document.getElementById('pista').classList.toggle('hidden', !ocupado);
}

function pintarHorario() {
  var el = document.getElementById('fuera-horario');
  var fuera = datos && datos.motor && datos.motor.enHorario === false;
  el.classList.toggle('hidden', !fuera);
  el.textContent = fuera ? 'Ahora está fuera del horario de envío: lo que pidas queda en la cola y sale en cuanto empiece el horario.' : '';
}

function pintar() {
  pintarHorario();
  pintarPorConfirmar();
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

var TITULOS_ACCION = {
  confirmar_envio: 'Enviar a los marcados',
  pedir_ubicacion: 'Pedir la ubicación',
  pedir_confirmacion: 'Pedir la confirmación'
};

async function hacer(accion) {
  var sel = seleccionados();
  if (!sel.length || ocupado) return;
  if (accion === 'pausa') accion = document.getElementById('btn-pausa').getAttribute('data-modo') || 'pausar';
  if (accion === 'confirmar_envio') {
    var esperan = sel.filter(function (x) { return x.porConfirmar; });
    var ub = esperan.filter(function (x) { return x.grupo !== 'confirmar'; }).length;
    var si0 = await confirmarDialogo({ titulo: TITULOS_ACCION[accion], texto: 'Se confirma el envío a ' + (esperan.length === 1 ? '1 número' : esperan.length + ' números') + ': ' + ub + ' para pedir ubicación · ' + (esperan.length - ub) + ' para confirmar SÍ/NO. Salen de uno en uno, con la pausa de siempre entre mensaje y mensaje. Los demás siguen esperando.', boton: 'Sí, enviar' });
    if (!si0) return;
  } else if (TITULOS_ACCION[accion] && sel.length > 1) {
    var que = accion === 'pedir_ubicacion' ? 'la ubicación' : 'la confirmación';
    var si = await confirmarDialogo({ titulo: TITULOS_ACCION[accion], texto: 'Se le va a pedir ' + que + ' a ' + sel.length + ' números por WhatsApp. Salen de uno en uno, con la pausa de siempre entre mensaje y mensaje. A los que ya la dieron no se les escribe.', boton: 'Sí, pedir' });
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

function cambiarFiltro(nuevo) {
  filtro = nuevo;
  elegidos = {};
  ponerTitulo();
  pintarFiltros();
  pintarLista();
}

document.getElementById('grupo-sel').addEventListener('change', function () {
  grupo = this.value;
  elegidos = {};
  pintarFiltros();
  pintarLista();
});
document.getElementById('pc-ver').addEventListener('click', function () { cambiarFiltro('por_confirmar_envio'); });
document.getElementById('pc-todos').addEventListener('click', async function () {
  var pc = datos && datos.porConfirmar;
  if (!pc || !pc.total || ocupado) return;
  var si = await confirmarDialogo({ titulo: 'Confirmar y enviar a todos', texto: 'Se confirma el envío a ' + (pc.total === 1 ? '1 número' : pc.total + ' números') + ': ' + pc.ubicacion + ' para pedir ubicación · ' + pc.confirmar + ' para confirmar SÍ/NO. Salen de uno en uno, con la pausa de siempre entre mensaje y mensaje.', boton: 'Sí, enviar a todos' });
  if (!si) return;
  ocupado = true;
  pintarPorConfirmar();
  pintarBarra();
  var res = document.getElementById('resultado');
  try {
    var r = await api('/admin/entregas/confirmar-envio', { method: 'POST', body: { todos: true } });
    res.className = 'resultado' + (r.liberadas ? '' : ' malo');
    res.textContent = r.aviso;
    elegidos = {};
  } catch (e) {
    res.className = 'resultado malo';
    res.textContent = e.message;
  } finally {
    ocupado = false;
  }
  try { await cargar(); } catch (e) { pintarBarra(); }
});
document.getElementById('filtros').addEventListener('click', function (ev) {
  var b = ev.target.closest('button[data-filtro]');
  if (!b) return;
  cambiarFiltro(b.getAttribute('data-filtro'));
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
  var tr = ev.target.closest('.fila[data-id]');
  if (!tr) return;
  var id = tr.getAttribute('data-id');
  if (elegidos[id]) delete elegidos[id]; else elegidos[id] = true;
  var cb = tr.querySelector('input.casilla');
  if (cb) cb.checked = Boolean(elegidos[id]);
  tr.classList.toggle('elegida', Boolean(elegidos[id]));
  pintarBarra();
});
document.getElementById('btn-desmarcar').addEventListener('click', function () { elegidos = {}; pintarLista(); });
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

ponerTitulo();
if (DISPONIBLE) cargar().catch(function (e) { document.getElementById('numeros').innerHTML = '<div class="mensaje">' + esc(e.message) + '</div>'; });
else {
  pintarFiltros();
  document.getElementById('numeros').innerHTML = '<div class="mensaje">Los números del día no están disponibles en este arranque.</div>';
}
`;

  return appShell({
    titulo: cabecera.titulo,
    subtitulo: cabecera.sub,
    contenido,
    script,
    css: CSS,
    nombreNegocio: opts.nombreNegocio,
    demo: opts.demo,
    icono: '📋',
  });
}
