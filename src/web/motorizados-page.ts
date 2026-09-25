/**
 * Pantalla "Motorizados": quienes reparten hoy.
 *
 * Responde de un vistazo: quien esta libre, quien va cargado y quien
 * descansa. Cada fila lleva las tres acciones del dia (ver su ruta, mandarlo
 * a descansar o activarlo, y el resto en un menu) para no llenar la tabla de
 * botones.
 *
 * El JS va en String.raw, con var y sin backticks, como el resto. Los
 * botones, chips, tarjetas y el bloque "vacio" son los del armazon
 * (src/web/shell.ts): aqui solo va lo propio de la pantalla.
 */

import { appShell } from './shell.js';
import { estadosVisualesJs } from './estados-visuales.js';
import { DIALOGO_ELEGIR_CSS, DIALOGO_ELEGIR_JS } from './dialogo-elegir.js';
import { DISTRITOS_LIMA, DISTRITOS_CALLAO } from '../preventa/distritos.js';

const CSS = `
  * { box-sizing: border-box; }
  .wrap { color: var(--texto); font: var(--fs-cuerpo)/1.5 var(--fuente); max-width: 1180px; margin: 0 auto; display: flex; flex-direction: column; gap: var(--esp-5); }
  .wrap a { color: var(--primario); }
  .muted { color: var(--texto-suave); }
  .hidden { display: none !important; }
  /* El armazon ya avisa "Demostración" en la barra de arriba, pero la esconde
     en pantalla estrecha: solo ahi lo repetimos nosotros. */
  .demo { display: none; background: var(--ambar-suave); color: var(--ambar); padding: 8px 14px; font-size: var(--fs-small); text-align: center; border-radius: var(--radio-sm); font-weight: 600; }
  @media (max-width: 960px) { .demo { display: block; } }

  /* Arriba: una linea de resumen y el unico boton principal. */
  .arriba { display: flex; align-items: center; gap: 12px 20px; flex-wrap: wrap; }
  .resumen { display: flex; gap: 6px 18px; flex-wrap: wrap; font-size: 14.5px; flex: 1 1 320px; }
  .resumen span { display: inline-flex; align-items: center; white-space: nowrap; }
  .resumen b { font-size: 18px; margin-right: 5px; }
  .punto { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: var(--gris-claro); margin-right: 8px; flex: none; }
  .punto.verde { background: var(--verde); } .punto.ambar { background: var(--ambar); } .punto.azul { background: var(--azul); }
  .arriba .btn.primario { min-height: 48px; padding: 10px 22px; font-size: 15.5px; font-weight: 700; }

  /* Una tarjeta por motorizado. */
  .motos { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: var(--esp-4); align-items: start; }
  .moto { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); box-shadow: var(--sombra); padding: 18px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
  .moto.descanso, .moto.baja { background: var(--superficie-2); }
  .moto .cab { display: flex; align-items: center; gap: 12px; }
  .moto .avatar { width: 42px; height: 42px; border-radius: 50%; background: var(--primario-suave); color: var(--primario); display: grid; place-items: center; font-weight: 800; font-size: 17px; flex: none; }
  .moto.descanso .avatar, .moto.baja .avatar { background: var(--gris-suave); color: var(--texto-suave); }
  .moto .quien { flex: 1; min-width: 0; }
  .moto .quien b { display: block; font-size: 16px; line-height: 1.25; overflow-wrap: anywhere; }
  .moto .quien .tel { color: var(--texto-suave); font-size: 13.5px; font-variant-numeric: tabular-nums; }
  .moto .datos { display: flex; flex-direction: column; gap: 4px; font-size: 13.5px; }
  .moto .datos .dato { display: flex; gap: 8px; align-items: baseline; min-width: 0; }
  .moto .datos .dato > span:first-child { flex: none; width: 18px; text-align: center; }
  .moto .datos .dato > span:last-child { min-width: 0; overflow-wrap: anywhere; }
  .moto .hoy { display: flex; align-items: baseline; gap: 8px; padding: 10px 12px; border-radius: var(--radio-sm); background: var(--superficie-2); }
  .moto.descanso .hoy, .moto.baja .hoy { background: var(--superficie); }
  .moto .hoy .n { font-size: 26px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; }
  .moto .hoy .q { font-size: 13.5px; }
  .moto .hoy .sub { display: block; color: var(--texto-suave); font-size: var(--fs-small); }
  .moto .sub { color: var(--texto-suave); font-size: var(--fs-small); line-height: 1.4; }
  .moto .acciones { display: flex; gap: 6px; flex-wrap: wrap; margin-top: auto; }
  .moto .acciones .btn { flex: 1 1 auto; }
  .moto .acciones .btn.mas { flex: 0 0 auto; min-width: 44px; }

  /* La ruta de un motorizado, desplegada dentro de su tarjeta. */
  .ruta { background: var(--superficie-2); border-radius: var(--radio-sm); padding: 10px 12px; }
  .ruta-cab { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; font-size: 13px; }
  .ruta-cab .sep { flex: 1; }
  .ruta-parada { display: flex; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--borde); font-size: 13px; align-items: flex-start; }
  .ruta-parada:last-child { border-bottom: 0; }
  .ruta-parada .n { font-weight: 700; min-width: 22px; color: var(--texto-suave); }

  .toast { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); background: var(--texto); color: var(--bg); padding: 10px 16px; border-radius: var(--radio-sm); font-size: 14px; z-index: 50; max-width: 90vw; box-shadow: var(--sombra-2); }
  .pedido { padding: 8px 0; border-bottom: 1px solid var(--borde); font-size: 13.5px; line-height: 1.45; }
  .pedido:last-child { border-bottom: 0; }
  .pedido .sub { color: var(--texto-suave); font-size: var(--fs-small); margin-top: 3px; }
  .nada { color: var(--texto-suave); font-size: 13.5px; text-align: center; padding: 14px 8px; }

  /* Lo de menos uso, plegado. */
  .plegable { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); box-shadow: var(--sombra); }
  .plegable > summary { cursor: pointer; padding: 14px 18px; font-weight: 600; font-size: 15px; list-style: none; display: flex; align-items: center; gap: 10px; }
  .plegable > summary::-webkit-details-marker { display: none; }
  .plegable > summary::after { content: ''; margin-left: auto; width: 8px; height: 8px; border-right: 2px solid var(--texto-suave); border-bottom: 2px solid var(--texto-suave); transform: rotate(45deg); transition: transform .15s; }
  .plegable[open] > summary::after { transform: rotate(-135deg); }
  .plegable > summary .muted { font-weight: 400; font-size: var(--fs-small); }
  .plegable .dentro { padding: 0 18px 16px; }
  .plegable .dentro p { margin: 0 0 8px; font-size: 13.5px; }
  .fila-botones { display: flex; gap: 8px; flex-wrap: wrap; margin: 4px 0 12px; }

  @media (max-width: 760px) {
    .wrap { gap: var(--esp-4); }
    .arriba .btn.primario { width: 100%; }
    .motos { grid-template-columns: 1fr; gap: var(--esp-3); }
    .moto { padding: 14px; }
    .plegable > summary { padding: 14px; }
    .plegable .dentro { padding: 0 14px 14px; }
  }
`;

export function motorizadosPage(opts: { disponible: boolean; demo: boolean; nombreNegocio: string }): string {
  const contenido = `
<div class="wrap">
${opts.demo ? '<div class="demo">Demostración: nada sale a WhatsApp de verdad.</div>' : ''}
${opts.disponible ? '' : '<div class="plegable" style="padding:14px 18px"><b>Los motorizados no están disponibles en este arranque.</b> Arranca el sistema con <code>npm run quick</code>.</div>'}

<div class="arriba">
  <div class="resumen" id="cifras" role="status"></div>
  <button class="btn primario" id="mot-nuevo" type="button">+ Dar de alta motorizado</button>
</div>

<div class="motos" id="motorizados"><div class="nada">Cargando…</div></div>

<details class="plegable" id="caja-calle">
  <summary>Pedidos en la calle ahora <span class="muted" id="calle-n"></span></summary>
  <div class="dentro" id="calle"><div class="muted">Cargando…</div></div>
</details>

<details class="plegable">
  <summary>Más opciones</summary>
  <div class="dentro">
    <div class="fila-botones">
      <button class="btn" id="mot-pegar" type="button">Pegar la lista de motorizados</button>
      <button class="btn hidden" id="mot-cargar" type="button">Cargar 10 de prueba</button>
    </div>
    <p><b>¿Cómo se reparten los pedidos?</b> Cada pedido listo (con ubicación y confirmación) va al motorizado activo que anda más cerca (su última posición de hoy, a menos de 6 km del pin); si nadie está cerca, al de la zona del distrito; y si no, al que menos lleva hoy. Él recibe el pin por WhatsApp y contesta en cuántos minutos entrega; a eso se le suma el margen y se le avisa al cliente. Cuando escribe «entregado» (o manda la foto), el pedido queda entregado.</p>
    <p class="muted">Si no contesta a los avisos o dice «no puedo», el pedido pasa solo a otro. Si escribe «me quedo sin moto» (o «accidente»), todos sus pedidos pasan a otros y él queda en descanso.</p>
  </div>
</details>
</div>
`;

  const script = String.raw`
${estadosVisualesJs()}
${DIALOGO_ELEGIR_JS}
var DISTRITOS = ${JSON.stringify([...DISTRITOS_LIMA, ...DISTRITOS_CALLAO])};
var DISPONIBLE = ${opts.disponible ? 'true' : 'false'};

async function api(path, options) {
  options = options || {};
  var res = await fetch(path, { method: options.method || 'GET', cache: 'no-store', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: options.body ? JSON.stringify(options.body) : undefined });
  var data = await res.json().catch(function () { return {}; });
  if (res.status === 401) { irAlLogin(); throw new Error('Tu sesión terminó: vuelve a entrar.'); }
  if (!res.ok) { var e = new Error(data.error || errorHttp(res.status)); e.datos = data; throw e; }
  return data;
}
function esc(v) { return String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function toast(texto) { var el = document.createElement('div'); el.className = 'toast'; el.textContent = texto; document.body.appendChild(el); setTimeout(function () { el.remove(); }, 4500); }
function plural(n, una, varias) { return n + ' ' + (n === 1 ? una : varias); }
function hora(iso) { if (!iso) return ''; var d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function telefonoBonito(p) { if (!p) return ''; if (p.length === 11 && p.indexOf('51') === 0) return '+51 ' + p.slice(2, 5) + ' ' + p.slice(5, 8) + ' ' + p.slice(8); return '+' + p; }
function minutosTexto(m) { if (m === null || m === undefined) return ''; var h = Math.floor(m / 60), r = m % 60; if (!h) return r + ' min'; if (!r) return h + ' h'; return h + ' h ' + r + ' min'; }
function haceCuanto(iso) {
  if (!iso) return '';
  var min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return 'hace ' + min + ' min';
  var h = Math.floor(min / 60);
  if (h < 24) return 'hace ' + h + ' h' + (min % 60 ? ' ' + (min % 60) + ' min' : '');
  return 'hace ' + plural(Math.floor(h / 24), 'día', 'días');
}

var resumen = null;
/* Rutas desplegadas y su ultimo dibujo: al refrescar se vuelve a pintar lo que ya habia (nada de parpadear "Cargando"). */
var rutasAbiertas = {};
var rutaDibujada = {};

/* Lo que lleva encima ahora: los mismos pedidos que cuentan la ruta y el traspaso en el servidor (estados vivos). */
function llevaAhora(id) {
  return resumen.entregas.filter(function (e) { return e.motorizado && e.motorizado.id === id && estaEnLaCalle(e); });
}
function estaEnLaCalle(e) {
  return e.estado === 'esperando_motorizado' || e.estado === 'avisada';
}
function entregadasDe(id) {
  return resumen.entregas.filter(function (e) { return e.motorizado && e.motorizado.id === id && e.estado === 'entregada'; }).length;
}
function motorizadoPorId(id) {
  return resumen.motorizados.filter(function (x) { return String(x.id) === String(id); })[0] || null;
}

/* Donde estuvo por ultima vez: el pin de su ultima entrega, con el distrito de ese pedido si se sabe. */
function ultimaPosicion(m) {
  if (m.ultimaLat === null || m.ultimaLat === undefined || !m.ultimaPosicionAt) return '';
  var pedido = resumen.entregas.filter(function (e) { return e.motorizado && e.motorizado.id === m.id && e.lat === m.ultimaLat && e.lng === m.ultimaLng; })[0];
  var donde = pedido && pedido.distrito ? esc(pedido.distrito) : (Number(m.ultimaLat).toFixed(4) + ', ' + Number(m.ultimaLng).toFixed(4));
  return '<div class="sub">Última posición: ' + haceCuanto(m.ultimaPosicionAt) + ', <a href="https://maps.google.com/?q=' + esc(m.ultimaLat) + ',' + esc(m.ultimaLng) + '" target="_blank" rel="noopener">' + donde + '</a></div>';
}

// ----------------------------------------------------------------- pintar

/* Arriba, una linea: cuantos estan activos, cuantos descansan y cuanto hay en la calle. */
function pintarCifras() {
  var activos = resumen.motorizados.filter(function (m) { return m.estado === 'activo'; });
  var repartiendo = activos.filter(function (m) { return llevaAhora(m.id).length > 0; }).length;
  var descansando = resumen.motorizados.filter(function (m) { return m.estado === 'descanso'; }).length;
  var bajas = resumen.motorizados.filter(function (m) { return m.estado === 'baja'; }).length;
  var entregados = resumen.entregas.filter(function (e) { return e.estado === 'entregada'; }).length;
  if (!resumen.motorizados.length) { document.getElementById('cifras').innerHTML = '<span class="muted">Todavía no hay motorizados dados de alta.</span>'; return; }
  document.getElementById('cifras').innerHTML =
    '<span><span class="punto verde"></span><b>' + activos.length + '</b>' + (activos.length === 1 ? 'activo' : 'activos') + (repartiendo ? ' <span class="muted">&nbsp;(' + repartiendo + ' repartiendo)</span>' : '') + '</span>' +
    '<span><span class="punto ' + (descansando ? 'ambar' : '') + '"></span><b>' + descansando + '</b>en descanso' + (bajas ? ' <span class="muted">&nbsp;· ' + bajas + ' ya no reparte' + (bajas === 1 ? '' : 'n') + '</span>' : '') + '</span>' +
    '<span><span class="punto azul"></span><b>' + entregados + '</b>' + (entregados === 1 ? 'entregado hoy' : 'entregados hoy') + '</span>';
}

/* Un boton de la tarjeta: siempre con el nombre en el aria-label, que "Descanso" a secas no dice de quien. */
function boton(m, accion, texto, aria, clase) {
  return '<button class="btn sm' + (clase ? ' ' + clase : '') + '" type="button" data-accion="' + accion + '" data-id="' + m.id + '" aria-label="' + esc(aria + ' ' + m.nombre) + '">' + esc(texto) + '</button>';
}

function inicial(nombre) { return esc(String(nombre || '?').trim().charAt(0).toUpperCase() || '?'); }

function tarjetaMotorizado(m) {
  var lleva = llevaAhora(m.id);
  var entregados = entregadasDe(m.id);
  var abierta = Boolean(rutasAbiertas[m.id]);
  var pedidosHoy = Math.max(m.entregasHoy || 0, entregados + lleva.length);
  var hoy = '<div class="hoy"><span class="n">' + pedidosHoy + '</span><span class="q">' + (pedidosHoy === 1 ? 'pedido hoy' : 'pedidos hoy') +
    '<span class="sub">' + (lleva.length ? plural(lleva.length, 'encima ahora', 'encima ahora') + ' · ' : '') + plural(entregados, 'entregado', 'entregados') + '</span></span></div>';
  var encima = lleva.length ? '<div class="sub">' + lleva.map(function (e) {
    return '<b>' + esc(e.referencia) + '</b> ' + (e.motorizadoEstado === 'respondio' ? 'llega ' + hora(e.llegaAproxAt) : 'esperando su tiempo');
  }).join(' · ') + '</div>' : '';
  return '<article class="moto ' + esc(m.estado) + '">' +
    '<div class="cab"><span class="avatar" aria-hidden="true">' + inicial(m.nombre) + '</span>' +
      '<div class="quien"><b>' + esc(m.nombre) + '</b><span class="tel">' + esc(telefonoBonito(m.phone)) + '</span></div>' +
      chipEstado('motorizado', m.estado) + '</div>' +
    '<div class="datos">' +
      '<div class="dato"><span aria-hidden="true">📍</span><span>' + (m.zona ? esc(m.zona) : '<span class="muted">Sin zona: recibe de cualquier distrito</span>') + '</span></div>' +
      (m.placa ? '<div class="dato"><span aria-hidden="true">🛵</span><span>' + esc(m.placa) + '</span></div>' : '') +
    '</div>' +
    hoy + encima +
    (m.puntualidad ? '<div class="sub" title="Comparando la hora que se le avisó al cliente con la hora real de cada entrega, últimos 30 días">⏱ ' + esc(m.puntualidad.texto) + '</div>' : '') +
    ultimaPosicion(m) +
    (abierta ? '<div class="ruta" id="ruta-' + m.id + '">' + (rutaDibujada[m.id] || 'Cargando la ruta…') + '</div>' : '') +
    '<div class="acciones">' +
      (m.estado === 'activo' ? boton(m, 'descanso', 'Mandar a descanso', 'Mandar a descansar a') : boton(m, 'activo', 'Activar', 'Activar a', 'primario')) +
      (lleva.length ? boton(m, 'ruta', abierta ? 'Cerrar la ruta' : 'Ver su ruta', abierta ? 'Cerrar la ruta de' : 'Ver la ruta de') : '') +
      boton(m, 'mas', '⋯', 'Más acciones de', 'mas') +
    '</div></article>';
}

function pintarTabla() {
  var caja = document.getElementById('motorizados');
  if (!resumen.motorizados.length) {
    caja.innerHTML = '<div class="vacio" style="grid-column:1/-1"><div class="ico">🛵</div><h3>Todavía no hay motorizados</h3>' +
      '<p>Da de alta al primero con su WhatsApp: desde ese momento recibe los pedidos listos y contesta en cuántos minutos entrega.</p></div>';
    return;
  }
  caja.innerHTML = resumen.motorizados.map(tarjetaMotorizado).join('');
  Object.keys(rutasAbiertas).forEach(function (id) {
    // Si el motorizado ya no está (borrado desde otra pestaña), su ruta tampoco.
    if (!motorizadoPorId(id)) { delete rutasAbiertas[id]; delete rutaDibujada[id]; return; }
    cargarRuta(id);
  });
}

function pintarCalle() {
  var enCalle = resumen.entregas.filter(function (e) { return e.motorizado && estaEnLaCalle(e); });
  var sinRespuesta = enCalle.filter(function (e) { return e.motorizadoEstado !== 'respondio'; }).length;
  document.getElementById('calle-n').textContent = enCalle.length
    ? '· ' + plural(enCalle.length, 'pedido', 'pedidos') + (sinRespuesta ? ' · ' + sinRespuesta + ' sin respuesta' : '')
    : '· ninguno';
  document.getElementById('calle').innerHTML = enCalle.length ? enCalle.map(function (e) {
    return '<div class="pedido"><b>' + esc(e.referencia) + '</b> · ' + esc(e.nombre || telefonoBonito(e.phone)) + (e.distrito ? ' · ' + esc(e.distrito) : '') +
      '<div class="sub">' + esc(e.motorizado.nombre) + ': ' + (e.motorizadoEstado === 'respondio' ? 'dijo ' + minutosTexto(e.minutosMotorizado) + ', llega hacia las ' + hora(e.llegaAproxAt) : 'aún no dice en cuánto (aviso ' + e.motorizadoIntentos + ')') + ' · <a href="/hoy">ver en Hoy</a></div></div>';
  }).join('') : '<div class="nada">Ahora mismo no hay pedidos en la calle.</div>';
}

function pintar() {
  pintarCifras();
  pintarTabla();
  pintarCalle();
  document.getElementById('mot-cargar').classList.toggle('hidden', !(resumen.gsg && resumen.gsg.modo === 'simulador'));
}

// ------------------------------------------------------------------ datos

async function cargar() {
  if (!DISPONIBLE) return;
  resumen = await api('/admin/entregas');
  pintar();
}

/* La ruta de un motorizado: sus paradas en orden de cercania, tal como se le mandan.
   Lo que falle se cuenta en el mismo sitio donde iba la ruta, no en un aviso que se repetiría en cada refresco. */
async function cargarRuta(id) {
  var td = document.getElementById('ruta-' + id);
  if (!td) return;
  var r;
  try { r = await api('/admin/motorizados/' + id + '/ruta'); } catch (e) { td.textContent = e.message; return; }
  var ruta = r.ruta;
  if (!ruta.paradas.length) {
    rutaDibujada[id] = '<span class="muted">Ahora mismo no lleva ningún pedido.</span>';
  } else {
    var desde = ruta.desde ? 'Sale de su última posición (' + haceCuanto(ruta.desde.en) + ').' : 'No se sabe dónde está: el orden empieza por el primero que se le dio.';
    var cab = '<div class="ruta-cab"><b>' + plural(ruta.paradas.length, 'parada', 'paradas') + '</b><span class="muted">' + esc(desde) +
      (ruta.totalKm ? ' Unos ' + Number(ruta.totalKm).toFixed(1).replace('.', ',') + ' km en total.' : '') + '</span><span class="sep"></span>' +
      '<button class="btn sm primario" type="button" data-accion="mandar-ruta" data-id="' + id + '">Mandarle su ruta</button></div>';
    var paradas = ruta.paradas.map(function (p) {
      var e = p.entrega;
      var que = p.situacion === 'esperando_tiempo' ? 'esperando su tiempo' : p.situacion === 'cerca' ? 'llega ' + (p.llega || '?') + ' · ya avisó que está cerca' : 'llega ' + (p.llega || '?');
      return '<div class="ruta-parada"><span class="n">' + p.orden + ')</span><span>' +
        (e.prioridad === 'urgente' ? chipEstado('entrega', 'urgente') + ' ' : '') +
        '<b>' + esc(e.referencia) + '</b> ' + esc(e.nombre || telefonoBonito(e.phone)) + (e.distrito ? ' · ' + esc(e.distrito) : '') +
        (p.distancia ? ' <span class="muted">(' + esc(p.distancia) + ')</span>' : '') + (e.segundaVisita ? ' ' + chipEstado('entrega', 'segunda_visita') : '') +
        '<div class="sub">' + esc(que) + (p.mapa ? ' · <a href="' + esc(p.mapa) + '" target="_blank" rel="noopener">mapa</a>' : '') + (e.notas ? ' · ' + esc(e.notas) : '') + '</div></span></div>';
    }).join('');
    rutaDibujada[id] = cab + paradas;
  }
  td.innerHTML = rutaDibujada[id];
}

// --------------------------------------------------------------- acciones

/* Los distritos que ya tiene un motorizado (texto "Miraflores, San Isidro") como lista, respetando lo que no este en el catalogo. */
function distritosDe(zona) {
  return String(zona || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
}
function camposMotorizado(m) {
  var conocidos = distritosDe(m ? m.zona : '');
  var extra = conocidos.filter(function (d) { return DISTRITOS.indexOf(d) < 0; });
  return [
    { id: 'nombre', etiqueta: 'Nombre', marcador: 'Carlos Rojas', valor: m ? m.nombre : '' },
    { id: 'telefono', etiqueta: 'Su WhatsApp', tipo: 'tel', prefijo: '+51', marcador: '999 000 001', valor: m ? String(m.phone || '').replace(/^51/, '') : '' },
    { id: 'placa', etiqueta: 'Placa', marcador: 'ABC-123', opcional: true, valor: m ? (m.placa || '') : '' },
    { id: 'zona', etiqueta: 'Distritos que cubre', tipo: 'casillas', opcional: true, valor: conocidos, opciones: DISTRITOS.concat(extra).map(function (d) { return { valor: d, etiqueta: d }; }), ayuda: 'Si nadie está cerca del pin, el pedido va al motorizado de la zona del distrito.' }
  ];
}

/* El alta, corta: nombre, WhatsApp y (si quieres) la zona. La placa y la
   lista de distritos con casillas estan en «Editar sus datos» (menú ⋯). */
async function altaMotorizado() {
  var d = await pedirVarios({
    titulo: 'Dar de alta motorizado',
    texto: 'Con su WhatsApp recibe los pedidos listos y contesta en cuántos minutos entrega.',
    campos: [
      { id: 'nombre', etiqueta: 'Nombre', marcador: 'Carlos Rojas' },
      { id: 'telefono', etiqueta: 'Su WhatsApp', tipo: 'tel', prefijo: '+51', marcador: '999 000 001' },
      { id: 'zona', etiqueta: 'Zona', marcador: 'Miraflores, San Isidro', opcional: true, ayuda: 'Los distritos que cubre, separados por comas.' }
    ],
    boton: 'Dar de alta'
  });
  if (!d) return;
  var zona = distritosDe(d.zona).join(', ');
  await api('/admin/motorizados', { method: 'POST', body: { nombre: d.nombre, telefono: d.telefono, zona: zona || undefined } });
  toast(d.nombre + ' dado de alta: ya puede recibir pedidos.');
  await cargar();
}

async function editar(m) {
  var campos = camposMotorizado(m).filter(function (c) { return c.id !== 'telefono'; });
  var d = await pedirVarios({ titulo: 'Editar a ' + m.nombre, texto: 'Su WhatsApp: ' + telefonoBonito(m.phone) + ' (para cambiarlo, dalo de alta de nuevo).', campos: campos, boton: 'Guardar' });
  if (!d) return false;
  await api('/admin/motorizados/' + m.id, { method: 'POST', body: { nombre: d.nombre, zona: d.zona.join(', ') || null, placa: d.placa || null } });
  toast('Guardado.');
  return true;
}

async function cambiarEstado(m, valor) {
  var nombre = m.nombre.split(' ')[0] || m.nombre;
  await api('/admin/motorizados/' + m.id, { method: 'POST', body: { estado: valor } });
  toast(valor === 'descanso' ? nombre + ' en descanso: no recibirá pedidos nuevos hasta que lo actives.'
    : valor === 'baja' ? nombre + ' ya no reparte: sigue en la lista por si vuelve.'
    : nombre + ' activo: ya puede recibir pedidos.');
}

async function mandarEnlace(m) {
  var r = await api('/admin/motorizados/' + m.id + '/enlace', { method: 'POST', body: { mandar: true } });
  var copiado = false;
  try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(r.url); copiado = true; } } catch (e) { /* sin portapapeles: el enlace va en el aviso */ }
  toast(r.enviado
    ? 'Enlace enviado por WhatsApp a ' + m.nombre + ' (vale 7 días).'
    : 'No se pudo mandar por WhatsApp' + (r.motivo ? ' (' + r.motivo + ')' : '') + '. ' + (copiado ? 'El enlace está copiado: pásaselo.' : 'Cópialo y pásaselo: ' + r.url));
}

async function mandarRuta(m) {
  var r = await api('/admin/motorizados/' + m.id + '/ruta/mandar', { method: 'POST', body: {} });
  toast('Ruta enviada por WhatsApp: ' + plural(r.ruta.paradas.length, 'parada', 'paradas') + '.');
}

/* Todo en un cuadro: a quien se los pasa y si el sigue repartiendo. Cancelar aqui no hace nada a medias. */
async function traspasar(m) {
  var suyos = llevaAhora(m.id);
  var otros = resumen.motorizados.filter(function (x) { return x.estado === 'activo' && x.id !== m.id; });
  var d = await pedirVarios({
    titulo: 'Traspasar los pedidos de ' + m.nombre,
    texto: 'Lleva ' + plural(suyos.length, 'pedido', 'pedidos') + ' (' + suyos.map(function (e) { return e.referencia; }).join(', ') + '). Los clientes que ya tenían hora reciben un aviso.',
    campos: [
      { id: 'destino', etiqueta: '¿Quién se los queda?', tipo: 'select', opcional: true, valor: '', opciones: [{ valor: '', etiqueta: 'Que el sistema los reparta' }].concat(otros.map(function (x) { return { valor: String(x.id), etiqueta: x.nombre + (x.zona ? ' · ' + x.zona : '') }; })) },
      { id: 'sigue', etiqueta: '¿Y ' + (m.nombre.split(' ')[0] || m.nombre) + '?', tipo: 'select', valor: 'si', opciones: [{ valor: 'si', etiqueta: 'Sigue activo: solo se le quitan estos' }, { valor: 'no', etiqueta: 'A descanso: hoy no recibe más pedidos' }] }
    ],
    boton: 'Traspasar'
  });
  if (!d) return false;
  var r = await api('/admin/motorizados/' + m.id + '/traspasar', { method: 'POST', body: { motorizadoId: d.destino ? Number(d.destino) : null, descanso: d.sigue === 'no' } });
  var n = r.traspasadas.length;
  toast(plural(n, 'pedido', 'pedidos') + (r.destino ? (n === 1 ? ' pasa a ' : ' pasan a ') + r.destino.nombre : (n === 1 ? ' se reparte' : ' se reparten') + ' entre los demás') + '.');
  return true;
}

async function borrar(m) {
  var si = await confirmarDialogo({ titulo: 'Borrar a ' + m.nombre, texto: 'Se borra de la lista. Los pedidos que tenía quedan sin motorizado y el sistema busca otro. Si solo deja de repartir por hoy, usa «Descanso»; si es por una temporada, «Ya no reparte».', boton: 'Borrar', peligro: true });
  if (!si) return false;
  await api('/admin/motorizados/' + m.id, { method: 'DELETE' });
  toast(m.nombre + ' borrado de la lista.');
  return true;
}

/* Lo que no se hace todos los días, en un menú: la fila se queda con tres botones. */
function menuDe(m) {
  var lleva = llevaAhora(m.id).length;
  var opciones = [{ valor: 'editar', etiqueta: 'Editar sus datos', detalle: 'Nombre, placa y distritos que cubre' }];
  if (m.estado !== 'baja') opciones.push({ valor: 'enlace', etiqueta: 'Mandarle su enlace', detalle: 'Su página de pedidos, con botones grandes; vale 7 días' });
  if (lleva) opciones.push({ valor: 'mandar-ruta', etiqueta: 'Mandarle su ruta', detalle: 'Sus ' + lleva + ' paradas por WhatsApp, en orden de cercanía' });
  if (lleva) opciones.push({ valor: 'traspasar', etiqueta: 'Traspasar sus pedidos', detalle: 'Se los queda otro o los reparte el sistema' });
  if (m.estado !== 'baja') opciones.push({ valor: 'baja', etiqueta: 'Ya no reparte', detalle: 'Sigue en la lista hasta que lo actives' });
  opciones.push({ valor: 'borrar', etiqueta: 'Borrar de la lista', detalle: 'Sus pedidos quedan sin motorizado', peligro: true });
  var estado = (ESTADOS_VISUALES.motorizado[m.estado] || { nombre: m.estado }).nombre;
  return elegirOpcion({ titulo: m.nombre, texto: estado + (lleva ? ' · ' + plural(lleva, 'pedido encima', 'pedidos encima') : ''), opciones: opciones, cancelar: 'Cerrar' });
}

async function hacer(accion, m) {
  if (accion === 'mas') { var elegida = await menuDe(m); if (elegida) await hacer(elegida, m); return; }
  if (accion === 'ruta') {
    if (rutasAbiertas[m.id]) { delete rutasAbiertas[m.id]; delete rutaDibujada[m.id]; } else rutasAbiertas[m.id] = true;
    pintar();
    return;
  }
  if (accion === 'enlace') return mandarEnlace(m);
  if (accion === 'mandar-ruta') return mandarRuta(m);
  if (accion === 'editar') { if (!(await editar(m))) return; }
  else if (accion === 'traspasar') { if (!(await traspasar(m))) return; }
  else if (accion === 'borrar') { if (!(await borrar(m))) return; }
  else if (accion === 'activo' || accion === 'descanso' || accion === 'baja') await cambiarEstado(m, accion);
  else return;
  await cargar();
}

document.getElementById('mot-nuevo').onclick = function () { altaMotorizado().catch(function (e) { toast(e.message); }); };
/* Varios de golpe: una linea por motorizado (nombre, WhatsApp, placa, distritos), tal como sale de Excel. */
document.getElementById('mot-pegar').onclick = async function () {
  try {
    var d = await pedirVarios({
      titulo: 'Pegar la lista de motorizados',
      texto: 'Una línea por motorizado: nombre, WhatsApp y, si quieres, la placa y los distritos. Vale tal como sale de Excel.',
      campos: [{ id: 'texto', etiqueta: 'La lista', tipo: 'textarea', filas: 7, marcador: 'Carlos Rojas, 999000001, M1A-101, Miraflores, San Isidro\nBruno Cárdenas, 999000006, M6F-606, Surco' }],
      boton: 'Dar de alta a todos'
    });
    if (!d) return;
    var r = await api('/admin/motorizados/lote', { method: 'POST', body: { texto: d.texto } });
    var creados = (r.creados || []).length, repetidos = (r.repetidos || []).length, descartados = (r.descartados || []).length;
    var partes = [plural(creados, 'dado de alta', 'dados de alta')];
    if (repetidos) partes.push(repetidos + (repetidos === 1 ? ' ya estaba' : ' ya estaban'));
    if (descartados) partes.push(plural(descartados, 'línea sin usar', 'líneas sin usar') + (r.descartados[0] && r.descartados[0].motivo ? ' (' + r.descartados[0].motivo + ')' : ''));
    toast(partes.join(' · ') + '.');
    await cargar();
  } catch (e) { toast(e.message); }
};
document.getElementById('mot-cargar').onclick = async function () {
  try { var r = await api('/admin/motorizados/de-prueba', { method: 'POST', body: {} }); toast(r.nuevos + ' motorizados de prueba dados de alta.'); await cargar(); } catch (e) { toast(e.message); }
};

document.getElementById('motorizados').addEventListener('click', function (ev) {
  var b = ev.target.closest('button[data-accion]');
  if (!b) return;
  var accion = b.getAttribute('data-accion');
  if (accion === 'alta') { altaMotorizado().catch(function (e) { toast(e.message); }); return; }
  var m = motorizadoPorId(b.getAttribute('data-id'));
  if (!m) return;
  hacer(accion, m).catch(function (e) { toast(e.message); });
});

document.addEventListener('ia:cambio', function () { cargar().catch(function () { /* el refresco de fondo no molesta con avisos */ }); });
/* Refresco de fondo: ni con un cuadro abierto ni con la pestaña escondida, para no pisar lo que se está haciendo. */
setInterval(function () {
  if (document.hidden || document.querySelector('.dlg-fondo')) return;
  cargar().catch(function () {});
}, 15000);
if (DISPONIBLE) cargar().catch(function (e) { toast(e.message); });
else {
  document.getElementById('motorizados').innerHTML = '<div class="nada">Los motorizados no están disponibles en este arranque.</div>';
  document.getElementById('calle').innerHTML = '<div class="nada">Sin datos en este arranque.</div>';
}
`;

  return appShell({
    titulo: 'Motorizados',
    subtitulo: 'Quiénes reparten hoy, qué zona cubren y qué llevan ahora mismo',
    contenido,
    script,
    css: CSS + DIALOGO_ELEGIR_CSS,
    nombreNegocio: opts.nombreNegocio,
    demo: opts.demo,
    icono: '🛵',
  });
}
