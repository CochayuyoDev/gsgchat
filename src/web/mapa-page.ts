/**
 * Pantalla "Mapa del dia": donde esta todo, de un vistazo.
 *
 * Leaflet + OpenStreetMap, sin clave (igual que la pagina de rastreo). Un
 * pin por cada entrega de hoy que ya tiene ubicacion, con el color de su
 * estado; los motorizados en su ultima posicion conocida (el pin de su
 * ultima entrega). Filtros por estado y por motorizado; clic en un pin →
 * tarjeta con el pedido y "Abrir en Hoy". Se refresca solo cada 30 s.
 *
 * El JS va en String.raw, con var y sin backticks, como el resto. Leaflet
 * se carga desde JS (el armazon no deja meter <link> en el <head>).
 */

import { appShell } from './shell.js';

const LEAFLET_VERSION = '1.9.4';
export const LEAFLET_BASE = `https://cdnjs.cloudflare.com/ajax/libs/leaflet/${LEAFLET_VERSION}`;

/** El centro de Lima, para cuando no hay pines. */
export const CENTRO_LIMA = { lat: -12.0464, lng: -77.0428 };

const CSS = `
  /* El mapa usa la paleta del armazon: los pines llevan los mismos tonos que los chips de Hoy. */
  * { box-sizing: border-box; }
  /* La pantalla entera es el mapa: filtros arriba y el mapa ocupa lo que queda, sin que nada asome por debajo. */
  .wrap { color: var(--texto); font: var(--fs-cuerpo)/1.5 var(--fuente); display: flex; flex-direction: column; height: 100%; min-height: 420px; }
  .wrap > * { flex: none; }
  .wrap a { color: var(--primario); }
  .muted { color: var(--texto-suave); }
  .hidden { display: none !important; }
  .demo { background: var(--ambar); color: #fff; padding: 8px 14px; font-size: var(--fs-small); text-align: center; border-radius: var(--radio-sm); margin-bottom: var(--esp-2); font-weight: 600; }
  button { font: inherit; color: var(--texto); background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio-sm); padding: 6px 10px; cursor: pointer; }
  button:hover { border-color: var(--primario); }
  /* los filtros: pildoras que se encienden y apagan; el punto lleva el color del pin */
  .filtros { display: flex; flex-direction: column; gap: 6px; padding: 6px 0 10px; }
  .filtros .fila-estados, .filtros .fila-motos { display: flex; gap: 6px; flex-wrap: wrap; }
  .filtros .fila-motos::-webkit-scrollbar { height: 6px; }
  .filtros .chip { flex: none; cursor: pointer; padding: 6px 12px; font-size: 13px; font-weight: 500; background: var(--superficie); color: var(--texto); border: 1px solid var(--borde); min-height: 34px; opacity: .72; }
  .filtros .chip::before { display: none; }
  .filtros .chip:hover { border-color: var(--primario); opacity: 1; }
  .filtros .chip.activo { opacity: 1; border-color: var(--primario); background: var(--primario-suave); color: var(--primario); font-weight: 600; }
  .filtros .chip .punto { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex: none; }
  .filtros .chip .n { color: var(--texto-suave); font-size: 12px; font-weight: 600; }
  .mapa-caja { position: relative; border: 1px solid var(--borde); border-radius: var(--radio); overflow: hidden; background: var(--superficie-2); flex: 1 1 auto; min-height: 320px; box-shadow: var(--sombra); }
  #mapa { position: absolute; inset: 0; }
  .sin-pines { position: absolute; left: 12px; right: 12px; top: 12px; z-index: 500; background: var(--superficie); border: 1px dashed var(--borde); border-radius: var(--radio); padding: 12px 16px; font-size: var(--fs-cuerpo); text-align: center; color: var(--texto-suave); box-shadow: var(--sombra-2); }
  .tarjeta { position: absolute; left: 12px; right: 12px; bottom: 12px; z-index: 500; background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); padding: 14px 16px; max-width: 440px; margin: 0 auto; box-shadow: var(--sombra-2); font-size: var(--fs-cuerpo); }
  .tarjeta h3 { margin: 0 0 6px; font-size: var(--fs-h3); padding-right: 28px; }
  .tarjeta .cerrar { position: absolute; right: 6px; top: 6px; border: 0; background: transparent; font-size: 20px; color: var(--texto-suave); padding: 4px 10px; min-height: 36px; min-width: 36px; }
  .tarjeta .cerrar:hover { color: var(--texto); }
  .tarjeta .acciones { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
  .tarjeta .dato { margin-top: 3px; }
  /* la leyenda va dentro del mapa, abajo a la izquierda, para que no haya que bajar a buscarla */
  .leyenda { position: absolute; left: 12px; bottom: 12px; z-index: 500; max-width: calc(100% - 24px); display: flex; gap: 4px 12px; flex-wrap: wrap; font-size: 12px; color: var(--texto); background: color-mix(in srgb, var(--superficie) 88%, transparent); border: 1px solid var(--borde); border-radius: var(--radio-sm); padding: 6px 10px; align-items: center; box-shadow: var(--sombra); pointer-events: none; }
  .leyenda .muted { color: var(--texto-suave); }
  @media (max-width: 640px) {
    .filtros .fila-motos { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 4px; scrollbar-width: thin; -webkit-overflow-scrolling: touch; }
    .filtros .fila-motos .chip { flex: none; }
    .leyenda { font-size: 11px; gap: 2px 8px; bottom: 26px; }
  }
  .leyenda span { display: inline-flex; align-items: center; gap: 5px; }
  .leyenda .punto { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex: none; }
  .pin-moto { background: var(--texto); color: var(--bg); border-radius: 12px; padding: 2px 6px; font-size: 12px; line-height: 16px; white-space: nowrap; border: 2px solid var(--superficie); box-shadow: 0 2px 6px rgba(0,0,0,.35); text-align: center; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
  .pin-pedido { width: 20px; height: 20px; border-radius: 50%; border: 2.5px solid #fff; box-shadow: 0 2px 6px rgba(0,0,0,.35); }
  .pin-pedido.urgente { outline: 3px solid var(--rojo); outline-offset: 1px; }
  .explica { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); padding: 12px 16px; margin-bottom: 10px; font-size: var(--fs-cuerpo); }
  .toast { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); background: var(--texto); color: var(--bg); padding: 10px 16px; border-radius: var(--radio-sm); font-size: 14px; z-index: 50; max-width: 90vw; box-shadow: var(--sombra-2); }
`;

export function mapaPage(opts: { disponible: boolean; demo: boolean; nombreNegocio: string }): string {
  const contenido = `
<div class="wrap">
${opts.demo ? '<div class="demo">Demostración: nada sale a WhatsApp de verdad.</div>' : ''}
${opts.disponible ? '' : '<div class="explica"><b>Las entregas del día no están disponibles en este arranque.</b> Arranca el sistema con <code>npm run quick</code>.</div>'}
<div class="filtros" id="filtros"></div>
<div class="mapa-caja">
  <div id="mapa"></div>
  <div class="sin-pines hidden" id="sin-pines">Todavía no hay ubicaciones hoy: en cuanto un cliente mande su pin, aparece aquí.</div>
  <div class="tarjeta hidden" id="tarjeta"></div>
<div class="leyenda" aria-label="Qué significa cada color">
  <span><i class="punto" style="background:var(--ambar)"></i> falta confirmar (ya mandó su pin)</span>
  <span><i class="punto" style="background:var(--azul)"></i> en camino (lista, con motorizado o con hora)</span>
  <span><i class="punto" style="background:var(--verde)"></i> entregada</span>
  <span><i class="punto" style="background:var(--rojo)"></i> con incidencia</span>
  <span><i class="punto" style="background:transparent;width:8px;height:8px;outline:2px solid var(--rojo);outline-offset:1px"></i> aro rojo: urgente</span>
  <span><i class="punto" style="background:var(--texto);border-radius:3px"></i> motorizado (última posición)</span>
  <span class="muted" id="ultima-carga"></span>
</div>
</div>
</div>
`;

  const script = String.raw`
var LEAFLET = '${LEAFLET_BASE}';
async function api(path) {
  var res = await fetch(path, { cache: 'no-store', credentials: 'same-origin' });
  var data = await res.json().catch(function () { return {}; });
  if (res.status === 401) { irAlLogin(); throw new Error('Tu sesión terminó: vuelve a entrar.'); }
  if (!res.ok) throw new Error(data.error || errorHttp(res.status));
  return data;
}
function esc(v) { return String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function toast(texto) { var el = document.createElement('div'); el.className = 'toast'; el.textContent = texto; document.body.appendChild(el); setTimeout(function () { el.remove(); }, 4500); }
function hora(iso) { if (!iso) return ''; return new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false }); }
function haceCuanto(iso) {
  if (!iso) return '';
  var min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return 'hace ' + min + ' min';
  var h = Math.floor(min / 60);
  return 'hace ' + h + ' h' + (min % 60 ? ' ' + (min % 60) + ' min' : '');
}

/* Que color lleva cada estado. Sin pin no hay nada que pintar. */
/* Los mismos tonos que los chips de Hoy: ambar esperando al cliente, azul en marcha, verde hecho, rojo con incidencia. */
var COLORES = { ambar: 'var(--ambar)', azul: 'var(--azul)', verde: 'var(--verde)', rojo: 'var(--rojo)' };
function grupoDe(e) {
  if (e.estado === 'incidencia') return 'incidencia';
  if (e.estado === 'entregada' || e.estado === 'terminada') return 'entregada';
  if (e.estado === 'cancelada') return null;
  if (e.estado === 'pendiente' || e.estado === 'esperando_ubicacion' || e.estado === 'esperando_confirmacion') return 'falta_confirmar';
  return 'en_camino';
}
var GRUPOS = [
  { clave: 'falta_confirmar', etiqueta: 'Falta confirmar', color: COLORES.ambar, tono: 'ambar' },
  { clave: 'en_camino', etiqueta: 'En camino', color: COLORES.azul, tono: 'azul' },
  { clave: 'entregada', etiqueta: 'Entregadas', color: COLORES.verde, tono: 'verde' },
  { clave: 'incidencia', etiqueta: 'Incidencia', color: COLORES.rojo, tono: 'rojo' },
];

var filtroEstado = {};
GRUPOS.forEach(function (g) { filtroEstado[g.clave] = true; });
var filtroMotorizado = null;
var mostrarMotorizados = true;
var datos = null;
var mapa = null;
var capa = null;
var seleccion = null;

function cargarLeaflet() {
  return new Promise(function (resolver, rechazar) {
    if (window.L) return resolver();
    var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = LEAFLET + '/leaflet.min.css'; document.head.appendChild(css);
    var s = document.createElement('script'); s.src = LEAFLET + '/leaflet.min.js'; s.onload = function () { resolver(); }; s.onerror = function () { rechazar(new Error('No se pudo cargar el mapa (sin conexión a internet). Los pedidos siguen en Hoy.')); };
    document.head.appendChild(s);
  });
}

function pintarFiltros() {
  var caja = document.getElementById('filtros');
  var html = '';
  var cuenta = {};
  (datos ? datos.entregas : []).forEach(function (e) { var g = grupoDe(e); if (g && e.lat !== null && e.lat !== undefined) cuenta[g] = (cuenta[g] || 0) + 1; });
  GRUPOS.forEach(function (g) {
    html += '<button type="button" class="chip' + (filtroEstado[g.clave] ? ' activo' : '') + '" data-estado="' + g.clave + '" aria-pressed="' + (filtroEstado[g.clave] ? 'true' : 'false') + '"><i class="punto" style="background:' + g.color + '"></i>' + esc(g.etiqueta) + ' <span class="n">' + (cuenta[g.clave] || 0) + '</span></button>';
  });
  html += '<button type="button" class="chip' + (mostrarMotorizados ? ' activo' : '') + '" data-motos="1" aria-pressed="' + (mostrarMotorizados ? 'true' : 'false') + '"><i class="punto" style="background:var(--texto);border-radius:3px"></i>Motorizados <span class="n">' + ((datos && datos.motorizados) ? datos.motorizados.filter(function (m) { return m.ultimaLat !== null && m.ultimaLat !== undefined; }).length : 0) + '</span></button>';
  var motos = (datos && datos.motorizados) ? datos.motorizados.filter(function (m) { return m.estado === 'activo'; }) : [];
  var htmlMotos = '';
  motos.forEach(function (m) {
    var n = (datos.entregas || []).filter(function (e) { return e.motorizado && e.motorizado.id === m.id && e.lat !== null && grupoDe(e); }).length;
    htmlMotos += '<button type="button" class="chip' + (filtroMotorizado === m.id ? ' activo' : '') + '" data-moto="' + m.id + '" aria-pressed="' + (filtroMotorizado === m.id ? 'true' : 'false') + '">🛵 ' + esc(m.nombre) + ' <span class="n">' + n + '</span></button>';
  });
  /* dos filas: los estados (se envuelven) y, debajo, un motorizado por chip (en el celular se deslizan de lado) */
  caja.innerHTML = '<div class="fila-estados">' + html + '</div>' + (htmlMotos ? '<div class="fila-motos" aria-label="Ver solo lo de un motorizado">' + htmlMotos + '</div>' : '');
  caja.querySelectorAll('[data-estado]').forEach(function (c) { c.onclick = function () { var k = c.getAttribute('data-estado'); filtroEstado[k] = !filtroEstado[k]; pintar(); }; });
  caja.querySelectorAll('[data-motos]').forEach(function (c) { c.onclick = function () { mostrarMotorizados = !mostrarMotorizados; pintar(); }; });
  caja.querySelectorAll('[data-moto]').forEach(function (c) { c.onclick = function () { var id = Number(c.getAttribute('data-moto')); filtroMotorizado = filtroMotorizado === id ? null : id; pintar(); }; });
}

function pinPedido(e, color) {
  return L.divIcon({ className: '', html: '<div class="pin-pedido' + (e.prioridad === 'urgente' ? ' urgente' : '') + '" style="background:' + color + '"></div>', iconSize: [20, 20], iconAnchor: [10, 10] });
}
function pinMoto(m) {
  var etiqueta = esc(m.nombre.split(' ')[0]);
  var ancho = 34 + etiqueta.length * 8;
  return L.divIcon({ className: '', html: '<div class="pin-moto" style="width:' + ancho + 'px">🛵 ' + etiqueta + '</div>', iconSize: [ancho, 24], iconAnchor: [ancho / 2, 12] });
}

function abrirTarjeta(e) {
  seleccion = e.referencia;
  var t = document.getElementById('tarjeta');
  var g = GRUPOS.filter(function (x) { return x.clave === grupoDe(e); })[0];
  t.innerHTML = '<button class="cerrar" type="button" id="tarjeta-cerrar" aria-label="Cerrar">×</button>' +
    '<h3>' + esc(e.nombre || 'Sin nombre') + ' · ' + esc(e.referencia) + (e.prioridad === 'urgente' ? ' <span class="chip tono-rojo sin-punto">Urgente</span>' : '') + '</h3>' +
    '<div class="dato"><span class="chip tono-' + (g ? g.tono : 'gris') + '">' + esc(g ? g.etiqueta : e.estado) + '</span> <span class="muted">' + esc(e.situacion || '') + '</span></div>' +
    (e.direccion ? '<div class="dato muted">' + esc(e.direccion) + (e.distrito ? ' · ' + esc(e.distrito) : '') + '</div>' : '') +
    (e.motorizado ? '<div class="dato">Motorizado: <b>' + esc(e.motorizado.nombre) + '</b>' + (e.llegaAproxAt ? ' · llega alrededor de las ' + esc(hora(e.llegaAproxAt)) : '') + '</div>' : '') +
    '<div class="acciones"><a class="btn sm primario" href="/hoy?buscar=' + encodeURIComponent(e.referencia) + '">Abrir en Hoy</a>' + (e.mapsUrl ? '<a class="btn sm" href="' + esc(e.mapsUrl) + '" target="_blank" rel="noopener">Google Maps</a>' : '') + '</div>';
  t.classList.remove('hidden');
  document.getElementById('tarjeta-cerrar').onclick = function () { t.classList.add('hidden'); seleccion = null; };
}

function pintar() {
  pintarFiltros();
  if (!mapa) return;
  if (capa) capa.clearLayers(); else capa = L.layerGroup().addTo(mapa);
  var puntos = [];
  var entregas = (datos ? datos.entregas : []).filter(function (e) {
    var g = grupoDe(e);
    if (!g || e.lat === null || e.lat === undefined || e.lng === null || e.lng === undefined) return false;
    if (!filtroEstado[g]) return false;
    if (filtroMotorizado !== null && !(e.motorizado && e.motorizado.id === filtroMotorizado)) return false;
    return true;
  });
  entregas.forEach(function (e) {
    var g = GRUPOS.filter(function (x) { return x.clave === grupoDe(e); })[0];
    var m = L.marker([e.lat, e.lng], { icon: pinPedido(e, g.color), title: (e.nombre || '') + ' ' + e.referencia });
    m.on('click', function () { abrirTarjeta(e); });
    capa.addLayer(m);
    puntos.push([e.lat, e.lng]);
  });
  if (mostrarMotorizados) {
    (datos ? datos.motorizados : []).forEach(function (mo) {
      if (mo.ultimaLat === null || mo.ultimaLat === undefined || mo.ultimaLng === null || mo.ultimaLng === undefined) return;
      if (filtroMotorizado !== null && mo.id !== filtroMotorizado) return;
      var mk = L.marker([mo.ultimaLat, mo.ultimaLng], { icon: pinMoto(mo), title: mo.nombre, zIndexOffset: 1000 });
      mk.bindTooltip(esc(mo.nombre) + ' · ' + esc(haceCuanto(mo.ultimaPosicionAt)) + (mo.enManos ? ' · lleva ' + mo.enManos : ''), { direction: 'top', offset: [0, -8] });
      capa.addLayer(mk);
      puntos.push([mo.ultimaLat, mo.ultimaLng]);
    });
  }
  var conPin = (datos ? datos.entregas : []).some(function (e) { return e.lat !== null && e.lat !== undefined && grupoDe(e); });
  document.getElementById('sin-pines').classList.toggle('hidden', conPin);
  if (puntos.length && !seleccion && !pintar.encuadrado) {
    if (puntos.length === 1) mapa.setView(puntos[0], 14); else mapa.fitBounds(puntos, { padding: [30, 30], maxZoom: 15 });
    pintar.encuadrado = true;
  }
  document.getElementById('ultima-carga').textContent = 'actualizado a las ' + new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false });
}

async function cargar() {
  datos = await api('/admin/entregas');
  pintar();
}

(async function () {
  try {
    await cargar();
  } catch (e) { toast(e.message); }
  try {
    await cargarLeaflet();
    mapa = L.map('mapa', { zoomControl: true, attributionControl: true }).setView([${CENTRO_LIMA.lat}, ${CENTRO_LIMA.lng}], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; colaboradores de OpenStreetMap' }).addTo(mapa);
    pintar();
  } catch (e) {
    document.getElementById('sin-pines').textContent = e.message;
    document.getElementById('sin-pines').classList.remove('hidden');
  }
  setInterval(function () { cargar().catch(function () {}); }, 30000);
})();
`;

  return appShell({
    titulo: 'Mapa del día',
    subtitulo: 'Dónde está cada pedido de hoy y cada motorizado',
    contenido,
    script,
    css: CSS,
    nombreNegocio: opts.nombreNegocio,
    demo: opts.demo,
    icono: '🗺️',
  });
}
