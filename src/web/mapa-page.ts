/**
 * Pantalla "Mapa del dia": donde esta todo, de un vistazo.
 *
 * Leaflet + OpenStreetMap, sin clave (igual que la pagina de rastreo). Un
 * pin por cada entrega de hoy que ya tiene ubicacion, con el color de su
 * estado; los motorizados en su ultima posicion conocida (el pin de su
 * ultima entrega). Filtros por estado y por motorizado; clic en un pin ->
 * ficha con el pedido y "Abrir en Hoy". Se refresca solo cada 30 s.
 *
 * Decisiones de la pantalla:
 *
 *  - Los chips de arriba ya dicen que color es cada estado y cuantos hay: la
 *    leyenda de dentro del mapa solo explica lo que ningun chip cuenta (el
 *    aro rojo de urgente y la pildora del motorizado). Cada cosa, una vez.
 *  - Lo que comparte con /rutas (api, esc, toast, horas) vive en
 *    `reparto-comun.ts`: una sola copia para las dos pantallas.
 *
 * El JS va en String.raw, con var y sin backticks, como el resto. Leaflet
 * se carga desde JS (el armazon no deja meter <link> en el <head>).
 */

import { appShell } from './shell.js';
import { REPARTO_CSS, REPARTO_JS } from './reparto-comun.js';

const LEAFLET_VERSION = '1.9.4';
export const LEAFLET_BASE = `https://cdnjs.cloudflare.com/ajax/libs/leaflet/${LEAFLET_VERSION}`;

/** El centro de Lima, para cuando no hay pines. */
export const CENTRO_LIMA = { lat: -12.0464, lng: -77.0428 };

const CSS = `${REPARTO_CSS}
  /* El mapa usa la paleta del armazon: los pines llevan los mismos tonos que los chips de Hoy. */
  * { box-sizing: border-box; }
  /* La pantalla entera es el mapa: filtros arriba y el mapa ocupa lo que queda, sin que nada asome por debajo. */
  .wrap { color: var(--texto); font: var(--fs-cuerpo)/1.5 var(--fuente); display: flex; flex-direction: column; height: 100%; min-height: 420px; }
  .wrap > * { flex: none; }
  .wrap a { color: var(--primario); }
  .demo, .explica {
    background: var(--ambar-suave); color: var(--ambar); border: 1px solid var(--ambar-suave);
    border-radius: var(--radio-sm); padding: 10px 14px; margin-bottom: var(--esp-2);
    font-size: var(--fs-small); text-align: center; font-weight: 600;
  }
  .explica { text-align: left; }

  /* los filtros: pildoras que se encienden y apagan; el punto lleva el color del pin */
  .filtros { display: flex; flex-direction: column; gap: 6px; padding: 6px 0 10px; }
  .filtros .fila-estados, .filtros .fila-motos { display: flex; gap: 6px; flex-wrap: wrap; }
  .filtros .fila-motos::-webkit-scrollbar { height: 6px; }
  .filtros .chip { flex: none; cursor: pointer; padding: 6px 12px; font-size: 13px; font-weight: 500; background: var(--superficie); color: var(--texto); border: 1px solid var(--borde); min-height: 34px; opacity: .72; }
  .filtros .chip::before { display: none; }
  .filtros .chip:hover { border-color: var(--primario); opacity: 1; }
  .filtros .chip[aria-pressed="true"] { opacity: 1; border-color: var(--primario); background: var(--primario-suave); color: var(--primario); font-weight: 600; }
  .filtros .chip .punto { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex: none; }
  .filtros .chip .n { color: var(--texto-suave); font-size: 12px; font-weight: 600; }

  .mapa-caja { position: relative; border: 1px solid var(--borde); border-radius: var(--radio); overflow: hidden; background: var(--superficie-2); flex: 1 1 auto; min-height: 320px; box-shadow: var(--sombra); }
  #mapa { position: absolute; inset: 0; }
  .aviso-mapa { position: absolute; left: 12px; right: 12px; top: 12px; z-index: 500; max-width: 520px; margin: 0 auto; box-shadow: var(--sombra-2); }
  .aviso-mapa .acciones { margin-top: var(--esp-2); }

  /* La ficha del pin tocado: abajo, al alcance del pulgar. */
  .ficha { position: absolute; left: 12px; right: 12px; bottom: 12px; z-index: 500; background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); padding: 14px 16px; max-width: 440px; margin: 0 auto; box-shadow: var(--sombra-2); font-size: var(--fs-cuerpo); }
  .ficha h3 { margin: 0 0 6px; font-size: var(--fs-h3); padding-right: 28px; }
  .ficha .cerrar { position: absolute; right: 6px; top: 6px; border: 0; background: transparent; font-size: 20px; color: var(--texto-suave); padding: 4px 10px; min-height: 36px; min-width: 36px; cursor: pointer; }
  .ficha .cerrar:hover { color: var(--texto); }
  .ficha .acciones { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
  .ficha .dato { margin-top: 3px; }

  /* la leyenda va dentro del mapa, abajo a la izquierda: solo lo que los chips de arriba no dicen */
  .leyenda { position: absolute; left: 12px; bottom: 12px; z-index: 500; max-width: calc(100% - 24px); display: flex; gap: 4px 12px; flex-wrap: wrap; font-size: 12px; color: var(--texto); background: color-mix(in srgb, var(--superficie) 88%, transparent); border: 1px solid var(--borde); border-radius: var(--radio-sm); padding: 6px 10px; align-items: center; box-shadow: var(--sombra); pointer-events: none; }
  .leyenda span { display: inline-flex; align-items: center; gap: 5px; }
  .leyenda .punto { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex: none; }
  .leyenda .fallo { color: var(--rojo); font-weight: 600; }
  @media (max-width: 640px) {
    .filtros .fila-motos { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 4px; scrollbar-width: thin; -webkit-overflow-scrolling: touch; }
    .filtros .fila-motos .chip { flex: none; }
    .leyenda { font-size: 11px; gap: 2px 8px; bottom: 26px; }
  }

  .pin-moto { background: var(--texto); color: var(--bg); border-radius: 12px; padding: 2px 6px; font-size: 12px; line-height: 16px; white-space: nowrap; border: 2px solid var(--superficie); box-shadow: var(--sombra-2); text-align: center; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
  .pin-pedido { width: 20px; height: 20px; border-radius: 50%; border: 2.5px solid var(--superficie); box-shadow: var(--sombra-2); }
  .pin-pedido.urgente { outline: 3px solid var(--rojo); outline-offset: 1px; }
`;

export function mapaPage(opts: { disponible: boolean; demo: boolean; nombreNegocio: string }): string {
  const contenido = `
<div class="wrap">
${opts.demo ? '<div class="demo">Demostración: nada sale a WhatsApp de verdad.</div>' : ''}
${opts.disponible ? '' : '<div class="explica"><b>Las entregas del día no están disponibles en este arranque.</b> Arranca el sistema con <code>npm run quick</code>.</div>'}
<div class="filtros" id="filtros"></div>
<div class="mapa-caja">
  <div id="mapa"></div>
  <div class="vacio aviso-mapa hidden" id="sin-pines">
    <h3>Todavía no hay ubicaciones hoy</h3>
    <p>En cuanto un cliente mande su pin, aparece aquí. En «Hoy» ves a quién le falta.</p>
    <div class="acciones"><a class="btn sm" href="/hoy">Ir a Hoy</a></div>
  </div>
  <div class="ficha hidden" id="ficha" tabindex="-1"></div>
  <div class="leyenda" aria-label="Qué significa cada marca del mapa">
    <span><i class="punto" style="background:transparent;width:8px;height:8px;outline:2px solid var(--rojo);outline-offset:1px"></i> aro rojo: urgente</span>
    <span class="muted" id="ultima-carga"></span>
  </div>
</div>
</div>
`;

  const script = String.raw`
${REPARTO_JS}

var LEAFLET = '${LEAFLET_BASE}';

/* Los mismos tonos que los chips de Hoy: ambar esperando al cliente, azul en
   marcha, verde hecho, rojo con incidencia. */
var GRUPOS = [
  { clave: 'falta_confirmar', etiqueta: 'Falta confirmar', color: 'var(--ambar)', tono: 'ambar' },
  { clave: 'en_camino', etiqueta: 'Ubicación registrada', color: 'var(--azul)', tono: 'azul' },
  { clave: 'entregada', etiqueta: 'Entregadas', color: 'var(--verde)', tono: 'verde' },
  { clave: 'incidencia', etiqueta: 'Incidencia', color: 'var(--rojo)', tono: 'rojo' }
];
var GRUPO_POR_CLAVE = {};
GRUPOS.forEach(function (g) { GRUPO_POR_CLAVE[g.clave] = g; });

/* En que monton cae cada entrega. Las canceladas no se pintan: ya no hay nada que repartir. */
function grupoDe(e) {
  if (e.estado === 'cancelada') return null;
  if (e.estado === 'incidencia') return 'incidencia';
  if (e.estado === 'entregada' || e.estado === 'terminada') return 'entregada';
  if (e.estado === 'pendiente' || e.estado === 'esperando_ubicacion' || e.estado === 'esperando_confirmacion') return 'falta_confirmar';
  return 'en_camino';
}

/* Sin pin no hay nada que pintar. */
function tienePin(e) {
  return e && e.lat !== null && e.lat !== undefined && e.lng !== null && e.lng !== undefined;
}
function motoTienePin(m) {
  return m.ultimaLat !== null && m.ultimaLat !== undefined && m.ultimaLng !== null && m.ultimaLng !== undefined;
}

var filtroEstado = {};
GRUPOS.forEach(function (g) { filtroEstado[g.clave] = true; });
var datos = null;
var mapa = null;
var capa = null;
var seleccion = null;      /* referencia de la entrega con la ficha abierta */
var yaEncuadrado = false;  /* el mapa se encuadra una vez, no cada 30 s */

function cargarLeaflet() {
  return new Promise(function (resolver, rechazar) {
    if (window.L) return resolver();
    var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = LEAFLET + '/leaflet.min.css'; document.head.appendChild(css);
    var s = document.createElement('script');
    s.src = LEAFLET + '/leaflet.min.js';
    s.onload = function () { resolver(); };
    s.onerror = function () { rechazar(new Error('No se pudo cargar el mapa (sin conexión a internet). Los pedidos siguen en Hoy.')); };
    document.head.appendChild(s);
  });
}

/* Las entregas que se ven ahora mismo: con pin, de un grupo encendido y, si
   se eligió un motorizado, solo las suyas. */
function entregasVisibles() {
  return (datos ? datos.entregas : []).filter(function (e) {
    var g = grupoDe(e);
    if (!g || !tienePin(e) || !filtroEstado[g]) return false;
    return true;
  });
}

function chipFiltro(atributo, valor, activo, interior) {
  return '<button type="button" class="chip" ' + atributo + '="' + valor + '" aria-pressed="' + (activo ? 'true' : 'false') + '">' + interior + '</button>';
}

function pintarFiltros() {
  var entregas = datos ? datos.entregas : [];
  var motorizados = (datos && datos.motorizados) ? datos.motorizados : [];

  var cuenta = {};
  entregas.forEach(function (e) {
    var g = grupoDe(e);
    if (g && tienePin(e)) cuenta[g] = (cuenta[g] || 0) + 1;
  });

  var estados = GRUPOS.map(function (g) {
    return chipFiltro('data-estado', g.clave, filtroEstado[g.clave],
      '<i class="punto" style="background:' + g.color + '"></i>' + esc(g.etiqueta) + ' <span class="n">' + (cuenta[g.clave] || 0) + '</span>');
  }).join('');
  var caja = document.getElementById('filtros');
  caja.innerHTML = '<div class="fila-estados">' + estados + '</div>';
  caja.querySelectorAll('[data-estado]').forEach(function (c) {
    c.onclick = function () { var k = c.getAttribute('data-estado'); filtroEstado[k] = !filtroEstado[k]; pintar(); };
  });

}

function pinPedido(e, color) {
  return L.divIcon({ className: '', html: '<div class="pin-pedido' + (e.prioridad === 'urgente' ? ' urgente' : '') + '" style="background:' + color + '"></div>', iconSize: [20, 20], iconAnchor: [10, 10] });
}

function pinMoto(m) {
  var etiqueta = esc(String(m.nombre || 'Moto').split(' ')[0]);
  var ancho = 34 + etiqueta.length * 8;
  return L.divIcon({ className: '', html: '<div class="pin-moto" style="width:' + ancho + 'px">🛵 ' + etiqueta + '</div>', iconSize: [ancho, 24], iconAnchor: [ancho / 2, 12] });
}

function abrirFicha(e) {
  seleccion = e.referencia;
  var t = document.getElementById('ficha');
  var g = GRUPO_POR_CLAVE[grupoDe(e)];
  t.innerHTML = '<button class="cerrar" type="button" id="ficha-cerrar" aria-label="Cerrar">×</button>' +
    '<h3>' + esc(e.nombre || 'Sin nombre') + ' · ' + esc(e.referencia) + (e.prioridad === 'urgente' ? ' <span class="chip tono-rojo sin-punto">Urgente</span>' : '') + '</h3>' +
    '<div class="dato"><span class="chip tono-' + (g ? g.tono : 'gris') + '">' + esc(g ? g.etiqueta : e.estado) + '</span> <span class="muted">' + esc(e.situacion || '') + '</span></div>' +
    (e.direccion ? '<div class="dato muted">' + esc(e.direccion) + (e.distrito ? ' · ' + esc(e.distrito) : '') + '</div>' : '') +
    '<div class="acciones"><a class="btn sm primario" href="/hoy?buscar=' + encodeURIComponent(e.referencia) + '">Abrir en Hoy</a>' +
      (e.mapsUrl ? '<a class="btn sm" href="' + esc(e.mapsUrl) + '" target="_blank" rel="noopener">Google Maps</a>' : '') + '</div>';
  t.classList.remove('hidden');
  document.getElementById('ficha-cerrar').onclick = cerrarFicha;
}

function cerrarFicha() {
  seleccion = null;
  document.getElementById('ficha').classList.add('hidden');
}

/* Con la ficha abierta, Escape la cierra: es lo que espera cualquiera. */
document.addEventListener('keydown', function (ev) {
  if (ev.key === 'Escape' && seleccion) cerrarFicha();
});

function pintar() {
  pintarFiltros();
  if (!mapa) return;
  if (capa) capa.clearLayers(); else capa = L.layerGroup().addTo(mapa);

  var puntos = [];
  entregasVisibles().forEach(function (e) {
    var g = GRUPO_POR_CLAVE[grupoDe(e)];
    var m = L.marker([e.lat, e.lng], { icon: pinPedido(e, g.color), title: (e.nombre || '') + ' ' + e.referencia });
    m.on('click', function () { abrirFicha(e); });
    capa.addLayer(m);
    puntos.push([e.lat, e.lng]);
  });



  var conPin = (datos ? datos.entregas : []).some(function (e) { return tienePin(e) && grupoDe(e); });
  document.getElementById('sin-pines').classList.toggle('hidden', conPin);

  if (puntos.length && !seleccion && !yaEncuadrado) {
    if (puntos.length === 1) mapa.setView(puntos[0], 14); else mapa.fitBounds(puntos, { padding: [30, 30], maxZoom: 15 });
    yaEncuadrado = true;
  }
}

/* La ficha abierta se pone al dia con los datos nuevos; si el pedido ya no
   esta (se cerro el dia, lo cancelaron), se cierra en vez de mentir. */
function refrescarFicha() {
  if (!seleccion) return;
  var iguales = (datos ? datos.entregas : []).filter(function (e) { return e.referencia === seleccion; });
  if (iguales.length && tienePin(iguales[0])) abrirFicha(iguales[0]);
  else cerrarFicha();
}

function marcarCarga(error) {
  var caja = document.getElementById('ultima-carga');
  caja.classList.toggle('fallo', Boolean(error));
  caja.textContent = error
    ? 'sin actualizar: ' + error
    : 'actualizado a las ' + hora(new Date().toISOString());
}

async function cargar() {
  datos = await api('/admin/entregas');
  pintar();
  refrescarFicha();
  marcarCarga(null);
}

/* El aviso del centro del mapa sirve para las dos malas noticias: no hay
   pines todavia, o el mapa no se pudo cargar. Solo cambia lo que dice. */
function avisoDelMapa(titulo, explicacion) {
  var caja = document.getElementById('sin-pines');
  caja.innerHTML = '<h3>' + esc(titulo) + '</h3><p>' + esc(explicacion) + '</p>' +
    '<div class="acciones"><button type="button" class="btn sm primario" id="reintentar-mapa">Reintentar</button></div>';
  caja.classList.remove('hidden');
  document.getElementById('reintentar-mapa').onclick = function () { location.reload(); };
}

(async function () {
  try {
    await cargar();
  } catch (e) {
    marcarCarga(e.message);
    toast(e.message);
  }
  try {
    await cargarLeaflet();
    mapa = L.map('mapa', { zoomControl: true, attributionControl: true }).setView([${CENTRO_LIMA.lat}, ${CENTRO_LIMA.lng}], 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; colaboradores de OpenStreetMap' }).addTo(mapa);
    pintar();
  } catch (e) {
    avisoDelMapa('No se pudo cargar el mapa', e.message);
    return;
  }
  /* Cada 30 s. Si falla, se dice en la esquina y se sigue intentando: antes
     el error se tragaba y la pantalla ensenaba pines viejos como si nada. */
  setInterval(function () {
    if (document.hidden) return;
    cargar().catch(function (e) { marcarCarga(e.message); });
  }, 30000);
})();
`;

  return appShell({
    titulo: 'Ubicaciones',
    subtitulo: 'Ubicaciones registradas y coordenadas de los pedidos GSG',
    contenido,
    script,
    css: CSS,
    nombreNegocio: opts.nombreNegocio,
    demo: opts.demo,
    icono: '🗺️',
  });
}
