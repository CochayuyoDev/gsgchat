/**
 * Pantalla "Motorizados": quienes reparten hoy.
 *
 * Responde de un vistazo: quien esta activo, que zona cubre, cuantos pedidos
 * lleva hoy y cuales tiene entre manos ahora mismo (con su estado). Todo lo
 * que se puede hacer con un motorizado -darlo de alta, cambiarle la zona o
 * la placa, mandarlo a descansar, darlo de baja- esta aqui.
 *
 * El JS va en String.raw, con var y sin backticks, como el resto.
 */

import { appShell } from './shell.js';
import { estadosVisualesJs } from './estados-visuales.js';
import { DIALOGO_ELEGIR_CSS, DIALOGO_ELEGIR_JS } from './dialogo-elegir.js';
import { DISTRITOS_LIMA, DISTRITOS_CALLAO } from '../preventa/distritos.js';

const CSS = `
  /* Motorizados usa la paleta y la escala del armazon: aqui solo lo propio de la pantalla. */
  * { box-sizing: border-box; }
  .wrap { color: var(--texto); font: var(--fs-cuerpo)/1.5 var(--fuente); max-width: 1300px; }
  .wrap a { color: var(--primario); }
  .muted { color: var(--texto-suave); }
  .hidden { display: none !important; }
  .demo { background: var(--ambar); color: #fff; padding: 8px 14px; font-size: var(--fs-small); text-align: center; border-radius: var(--radio-sm); margin-bottom: var(--esp-3); font-weight: 600; }
  input, select, button { font: inherit; color: var(--texto); background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio-sm); padding: 8px 11px; }
  input, select { width: 100%; }
  button { cursor: pointer; width: auto; font-weight: 600; min-height: 36px; line-height: 1.2; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
  button:hover { border-color: var(--primario); color: var(--primario); }
  button.primary { background: var(--primario); border-color: var(--primario); color: var(--primario-texto); }
  button.primary:hover { filter: brightness(1.06); color: var(--primario-texto); }
  button.sm { min-height: 30px; padding: 4px 10px; font-size: 13px; font-weight: 500; }
  button.peligro { color: var(--rojo); }
  button.peligro:hover { background: var(--rojo-suave); border-color: var(--rojo); color: var(--rojo); }
  button:disabled { opacity: .55; cursor: default; }
  label { display: block; font-size: var(--fs-small); color: var(--texto-suave); margin: 10px 0 4px; }

  .tarjetas { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--esp-2); margin-bottom: var(--esp-3); }
  .tarjeta { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); padding: 10px 12px; box-shadow: var(--sombra); min-height: 62px; }
  .tarjeta .n { font-size: 22px; font-weight: 800; line-height: 1.1; letter-spacing: -.01em; }
  .tarjeta .q { font-size: var(--fs-small); color: var(--texto-suave); margin-top: 2px; line-height: 1.3; }
  .tarjeta.ok .n { color: var(--verde); } .tarjeta.warn .n { color: var(--ambar); } .tarjeta.bad .n { color: var(--rojo); } .tarjeta.info .n { color: var(--azul); }

  .cols { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: var(--esp-3); align-items: start; }
  @media (max-width: 1100px) { .cols { grid-template-columns: 1fr; } }
  .caja { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); overflow: hidden; margin-bottom: var(--esp-3); box-shadow: var(--sombra); }
  .caja > h2 { font-size: var(--fs-h3); margin: 0; padding: 12px 14px; border-bottom: 1px solid var(--borde); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .caja > h2 .sep { flex: 1; }
  .caja .cuerpo { padding: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--borde); vertical-align: top; }
  th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--texto-suave); font-weight: 700; }
  tr:last-child td { border-bottom: 0; }
  #motorizados > tr:hover > td { background: var(--superficie-2); }
  #motorizados > tr > td:first-child { min-width: 190px; }
  #motorizados > tr > td:last-child { min-width: 330px; }
  #motorizados > tr > td:nth-child(4) { min-width: 150px; }
  td .sub { color: var(--texto-suave); font-size: var(--fs-small); margin-top: 3px; line-height: 1.35; }
  td.vacio { color: var(--texto-suave); text-align: center; padding: 24px; }
  td.vacio-td { padding: 14px; }
  .chip.estado-mot { margin-left: 6px; }
  .acciones { display: flex; flex-direction: column; gap: 6px; min-width: 250px; }
  .acciones .principales { display: flex; gap: 6px; flex-wrap: wrap; }
  .acciones .secundarias { display: flex; gap: 2px 10px; flex-wrap: wrap; }
  .acciones .secundarias button { border: 0; background: none; padding: 4px 0; min-height: 0; color: var(--texto-suave); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--borde); font-size: 12.5px; }
  .acciones .secundarias button:hover:not(:disabled) { color: var(--texto); text-decoration-color: currentColor; }
  .acciones .secundarias button:disabled { opacity: .5; text-decoration: none; }
  .acciones .secundarias button.peligro { color: var(--rojo); }
  .toast { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); background: var(--texto); color: var(--bg); padding: 10px 16px; border-radius: var(--radio-sm); font-size: 14px; z-index: 50; max-width: 90vw; box-shadow: var(--sombra-2); }
  .pedido { padding: 8px 0; border-bottom: 1px solid var(--borde); font-size: 13px; line-height: 1.45; }
  .pedido:last-child { border-bottom: 0; }
  .nada { color: var(--texto-suave); font-size: 13.5px; text-align: center; padding: 14px 8px; }
  .explica { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); padding: 12px 16px; margin-bottom: var(--esp-3); font-size: var(--fs-cuerpo); }
  .explica summary { color: var(--texto-suave); font-size: 13.5px; cursor: pointer; }
  .explica p { margin: 8px 0 0; }
  tr.fila-ruta td { background: var(--superficie-2); }
  .ruta-parada { display: flex; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--borde); font-size: 13px; align-items: flex-start; }
  .ruta-parada:last-child { border-bottom: 0; }
  .ruta-parada .n { font-weight: 700; min-width: 22px; color: var(--texto-suave); }
  .ruta-parada .urg { color: var(--rojo); font-weight: 700; font-size: 11.5px; margin-right: 4px; }
  .ruta-cab { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; font-size: 13px; }
  .ruta-cab .sep { flex: 1; }
  pre.ruta-texto { white-space: pre-wrap; font: 12.5px/1.4 ui-monospace, Menlo, Consolas, monospace; background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio-sm); padding: 8px 10px; margin: 8px 0 0; max-height: 220px; overflow: auto; }

  /* en el celular cada motorizado es una tarjeta */
  @media (max-width: 760px) {
    .tarjetas { grid-template-columns: repeat(3, 1fr); gap: 6px; }
    .tarjeta { padding: 8px 10px; min-height: 0; }
    .tarjeta .n { font-size: 19px; }
    .tarjeta .q { font-size: 11.5px; }
    .caja > h2 { padding: 10px 12px; }
    .caja thead { display: none; }
    .caja table, .caja tbody, .caja tr, .caja td { display: block; }
    #motorizados > tr { border: 1px solid var(--borde); border-radius: var(--radio); margin: 10px 12px; padding: 10px 12px; background: var(--superficie); box-shadow: var(--sombra); }
    #motorizados > tr > td { border: 0; padding: 4px 0; min-width: 0; }
    #motorizados > tr:hover > td { background: transparent; }
    #motorizados > tr > td:first-child { padding-bottom: 6px; border-bottom: 1px solid var(--borde); margin-bottom: 4px; font-size: 14.5px; }
    #motorizados > tr > td:nth-child(2)::before, #motorizados > tr > td:nth-child(3)::before, #motorizados > tr > td:nth-child(4)::before { display: inline-block; min-width: 96px; font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--texto-suave); font-weight: 700; vertical-align: top; margin-top: 2px; }
    #motorizados > tr > td:nth-child(2)::before { content: 'Zona'; }
    #motorizados > tr > td:nth-child(3)::before { content: 'Hoy'; }
    #motorizados > tr > td:nth-child(4)::before { content: 'Ahora mismo'; }
    #motorizados > tr > td:last-child { padding-top: 8px; }
    .acciones { min-width: 0; }
    .acciones .principales button { min-height: 44px; flex: 1 1 auto; }
    .acciones .secundarias { gap: 4px 8px; }
    .acciones .secundarias button { min-height: 40px; padding: 8px 10px; border: 1px solid var(--borde); border-radius: var(--radio-sm); text-decoration: none; background: var(--superficie); }
    .caja > h2 button.sm { min-height: 40px; }
    #motorizados > tr.fila-ruta { padding: 8px 12px; background: var(--superficie-2); margin-top: -6px; }
    #motorizados > tr.fila-ruta > td { padding: 0; border: 0; }
    td.vacio, td.vacio-td { padding: 12px; }
  }
`;

export function motorizadosPage(opts: { disponible: boolean; demo: boolean; nombreNegocio: string }): string {
  const contenido = `
<div class="wrap">
${opts.demo ? '<div class="demo">Demostración: nada sale a WhatsApp de verdad.</div>' : ''}
${opts.disponible ? '' : '<div class="explica"><b>Los motorizados no están disponibles en este arranque.</b> Arranca el sistema con <code>npm run quick</code>.</div>'}

<details class="explica">
  <summary>¿Cómo se reparten los pedidos entre los motorizados?</summary>
  <p><b>Cada pedido listo (con ubicación y confirmación) va al motorizado activo que anda más cerca</b> (su última posición de hoy, a menos de 6 km del pin); si nadie está cerca, al de la zona del distrito; y si no, al que menos lleva hoy. Él recibe el pin por WhatsApp y contesta en cuántos minutos entrega; a eso se le suma el margen y se le avisa al cliente. Cuando escribe <b>"entregado"</b> (o manda la foto), el pedido queda entregado y su última posición pasa a ser ese pin.</p>
  <p class="muted" style="margin:0">Un motorizado en <b>descanso</b> no recibe pedidos hoy. Si no contesta a los avisos o dice «no puedo», el pedido pasa solo a otro. Si escribe <b>«me quedo sin moto»</b> (o «accidente»), todos sus pedidos pasan a otros y él queda en descanso; con <b>«Traspasar sus pedidos»</b> lo haces tú. <b>«Mandarle su enlace»</b> le manda su página de pedidos de hoy (sin instalar nada, con botones grandes para avisar «cerca», «entregado» o los minutos); vale 7 días y cada botón hace lo mismo que su mensaje por WhatsApp. <b>«Ver su ruta de hoy»</b> ordena sus pedidos por cercanía (urgentes primero) y <b>«Mandarle su ruta»</b> se la escribe; él también puede pedirla escribiendo «ruta».</p>
</details>

<div class="tarjetas" id="tarjetas"></div>

<div class="cols">
  <div class="caja">
    <h2>Motorizados <span class="sep"></span><button class="sm primary" id="mot-nuevo" type="button">+ Dar de alta</button><button class="sm" id="mot-pegar" type="button">Pegar la lista de motorizados</button><button class="sm hidden" id="mot-cargar" type="button">Cargar 10 de prueba</button></h2>
    <div class="cuerpo" style="padding:0">
      <table>
        <thead><tr><th>Quién</th><th>Zona</th><th>Hoy</th><th>Ahora mismo</th><th></th></tr></thead>
        <tbody id="motorizados"><tr><td colspan="5" class="vacio">Cargando…</td></tr></tbody>
      </table>
    </div>
  </div>

  <div>
    <div class="caja">
      <h2>Pedidos en la calle <span class="sep"></span><span class="muted" id="calle-n" style="font-weight:400;font-size:12.5px"></span></h2>
      <div class="cuerpo" id="calle"><div class="muted">Cargando…</div></div>
    </div>
  </div>
</div>
</div>
`;

  const script = String.raw`
${estadosVisualesJs()}
${DIALOGO_ELEGIR_JS}
var DISTRITOS = ${JSON.stringify([...DISTRITOS_LIMA, ...DISTRITOS_CALLAO])};
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
function hora(iso) { if (!iso) return ''; var d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
var rutasAbiertas = {};
function telefonoBonito(p) { if (!p) return ''; if (p.length === 11 && p.indexOf('51') === 0) return '+51 ' + p.slice(2, 5) + ' ' + p.slice(5, 8) + ' ' + p.slice(8); return '+' + p; }
function minutosTexto(m) { if (m === null || m === undefined) return ''; var h = Math.floor(m / 60), r = m % 60; if (!h) return r + ' min'; if (!r) return h + ' h'; return h + ' h ' + r + ' min'; }

var resumen = null;

var FINALES = { terminada: 1, cancelada: 1, entregada: 1, incidencia: 1 };
function enManosDe(id) {
  return resumen.entregas.filter(function (e) { return e.motorizado && e.motorizado.id === id && !FINALES[e.estado] && (e.motorizadoEstado === 'enviado' || e.motorizadoEstado === 'respondio'); });
}
function entregadasDe(id) {
  return resumen.entregas.filter(function (e) { return e.motorizado && e.motorizado.id === id && e.estado === 'entregada'; });
}
function haceCuanto(iso) {
  if (!iso) return '';
  var min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return 'hace ' + min + ' min';
  var h = Math.floor(min / 60);
  if (h < 24) return 'hace ' + h + ' h' + (min % 60 ? ' ' + (min % 60) + ' min' : '');
  return 'hace ' + Math.floor(h / 24) + ' día' + (Math.floor(h / 24) === 1 ? '' : 's');
}
/* Donde estuvo por ultima vez: el pin de su ultima entrega, con el distrito de ese pedido si se sabe. */
function ultimaPosicion(m) {
  if (m.ultimaLat === null || m.ultimaLat === undefined || !m.ultimaPosicionAt) return '';
  var pedido = resumen.entregas.filter(function (e) { return e.motorizado && e.motorizado.id === m.id && e.lat === m.ultimaLat && e.lng === m.ultimaLng; })[0];
  var donde = pedido && pedido.distrito ? esc(pedido.distrito) : (Number(m.ultimaLat).toFixed(4) + ', ' + Number(m.ultimaLng).toFixed(4));
  return '<div class="sub">Última posición: ' + haceCuanto(m.ultimaPosicionAt) + ', <a href="https://maps.google.com/?q=' + esc(m.ultimaLat) + ',' + esc(m.ultimaLng) + '" target="_blank" rel="noopener">' + donde + '</a></div>';
}

function pintar() {
  var activos = resumen.motorizados.filter(function (m) { return m.estado === 'activo'; });
  var enCalle = resumen.entregas.filter(function (e) { return e.motorizado && !FINALES[e.estado] && (e.motorizadoEstado === 'enviado' || e.motorizadoEstado === 'respondio'); });
  var sinRespuesta = enCalle.filter(function (e) { return e.motorizadoEstado === 'enviado'; }).length;
  document.getElementById('tarjetas').innerHTML =
    '<div class="tarjeta ok"><div class="n">' + activos.length + '</div><div class="q">activos hoy</div></div>' +
    '<div class="tarjeta"><div class="n">' + (resumen.motorizados.length - activos.length) + '</div><div class="q">en descanso o de baja</div></div>' +
    '<div class="tarjeta info"><div class="n">' + enCalle.length + '</div><div class="q">pedidos en la calle</div></div>' +
    '<div class="tarjeta ' + (sinRespuesta ? 'warn' : '') + '"><div class="n">' + sinRespuesta + '</div><div class="q">esperando que digan en cuánto entregan</div></div>' +
    '<div class="tarjeta ok"><div class="n">' + resumen.entregas.filter(function (e) { return e.estado === 'entregada'; }).length + '</div><div class="q">entregados hoy</div></div>';

  var tbody = document.getElementById('motorizados');
  if (!resumen.motorizados.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="vacio-td"><div class="vacio"><div class="ico">🛵</div><h3>Todavía no hay motorizados</h3><p>Da de alta al primero con su WhatsApp: desde ese momento recibe los pedidos listos y contesta en cuántos minutos entrega.</p><div class="acciones"><button class="btn primario" type="button" onclick="document.getElementById(\'mot-nuevo\').click()">+ Dar de alta</button></div></div></td></tr>';
  } else {
    tbody.innerHTML = resumen.motorizados.map(function (m) {
      var ahora = enManosDe(m.id);
      var estado = ' ' + chipEstado('motorizado', m.estado, 'estado-mot');
      var quieto = m.estado === 'baja' ? '<span class="muted">de baja: no recibe pedidos</span>' : m.estado === 'descanso' ? '<span class="muted">en descanso: hoy no recibe pedidos</span>' : '<span class="muted">libre</span>';
      return '<tr><td><b>' + esc(m.nombre) + '</b>' + estado + '<div class="sub">' + esc(telefonoBonito(m.phone)) + (m.placa ? ' · ' + esc(m.placa) : '') + '</div></td>' +
        '<td class="sub">' + esc(m.zona || '—') + '</td>' +
        '<td>' + m.entregasHoy + (entregadasDe(m.id).length ? '<div class="sub">' + entregadasDe(m.id).length + ' entregad' + (entregadasDe(m.id).length === 1 ? 'o' : 'os') + '</div>' : '') + (m.puntualidad ? '<div class="sub" title="Comparando la hora que se le avisó al cliente con la hora real de cada entrega, últimos 30 días">⏱ ' + esc(m.puntualidad.texto) + '</div>' : '') + '</td>' +
        '<td>' + (ahora.length ? ahora.map(function (e) { return '<div class="sub"><b>' + esc(e.referencia) + '</b> ' + (e.motorizadoEstado === 'respondio' ? 'llega ' + hora(e.llegaAproxAt) : 'esperando su tiempo desde ' + hora(e.motorizadoEnviadoAt)) + '</div>'; }).join('') : quieto) + ultimaPosicion(m) + '</td>' +
        '<td><div class="acciones"><div class="principales">' +
        '<button class="sm" data-ruta="' + m.id + '" type="button"' + (ahora.length ? '' : ' disabled title="No lleva pedidos todavía"') + '>' + (rutasAbiertas[m.id] ? 'Cerrar la ruta' : 'Ver su ruta de hoy') + '</button>' +
        '<button class="sm" data-editar="' + m.id + '" type="button">Editar</button></div><div class="secundarias">' +
        '<button class="sm" data-mandar-ruta="' + m.id + '" type="button"' + (ahora.length ? '' : ' disabled title="No lleva pedidos todavía"') + '>Mandarle su ruta</button>' +
        (m.estado !== 'baja' ? '<button class="sm" data-enlace="' + m.id + '" type="button" title="Le manda por WhatsApp un enlace a su página de pedidos de hoy, con botones grandes; vale 7 días">Mandarle su enlace</button>' : '') +
        '<button class="sm" data-traspasar="' + m.id + '" type="button"' + (ahora.length ? '' : ' disabled title="No lleva pedidos todavía"') + '>Traspasar sus pedidos</button>' +
        (m.estado === 'activo' ? '<button class="sm" data-estado="' + m.id + '" data-valor="descanso" type="button" title="Hoy no recibe pedidos nuevos; los que ya lleva siguen">Descanso</button>' : '<button class="sm" data-estado="' + m.id + '" data-valor="activo" type="button">Activar</button>') +
        (m.estado !== 'baja' ? '<button class="sm" data-estado="' + m.id + '" data-valor="baja" type="button" title="Deja de repartir hasta que lo actives; sigue en la lista">Ya no reparte (baja)</button>' : '') +
        '<button class="sm peligro" data-quitar="' + m.id + '" type="button">Borrar de la lista</button></div></div></td></tr>' +
        (rutasAbiertas[m.id] ? '<tr class="fila-ruta"><td colspan="5" id="ruta-' + m.id + '">Cargando la ruta…</td></tr>' : '');
    }).join('');
    Object.keys(rutasAbiertas).forEach(function (id) { if (rutasAbiertas[id]) cargarRuta(id); });
  }

  document.getElementById('calle-n').textContent = enCalle.length ? enCalle.length : 'ninguno';
  document.getElementById('calle').innerHTML = enCalle.length ? enCalle.map(function (e) {
    return '<div class="pedido"><b>' + esc(e.referencia) + '</b> · ' + esc(e.nombre || telefonoBonito(e.phone)) + (e.distrito ? ' · ' + esc(e.distrito) : '') +
      '<div class="sub">' + esc(e.motorizado.nombre) + ': ' + (e.motorizadoEstado === 'respondio' ? 'dijo ' + minutosTexto(e.minutosMotorizado) + ', llega hacia las ' + hora(e.llegaAproxAt) : 'aún no dice en cuánto (aviso ' + e.motorizadoIntentos + ')') + ' · <a href="/hoy">ver en Hoy</a></div></div>';
  }).join('') : '<div class="nada">Ahora mismo no hay pedidos en la calle.</div>';

  var sim = resumen.gsg && resumen.gsg.modo === 'simulador';
  document.getElementById('mot-cargar').classList.toggle('hidden', !sim);
}

/* La ruta de un motorizado: sus paradas en orden de cercania y el mensaje tal como se le manda. */
async function cargarRuta(id) {
  var td = document.getElementById('ruta-' + id);
  if (!td) return;
  try {
    var r = await api('/admin/motorizados/' + id + '/ruta');
    var ruta = r.ruta;
    if (!ruta.paradas.length) { td.innerHTML = '<span class="muted">Ahora mismo no lleva ningún pedido.</span>'; return; }
    var desde = ruta.desde ? 'Sale de su última posición (' + haceCuanto(ruta.desde.en) + ').' : 'No se sabe dónde está: el orden empieza por el primero que se le dio.';
    var cab = '<div class="ruta-cab"><b>' + ruta.paradas.length + ' parada' + (ruta.paradas.length === 1 ? '' : 's') + '</b><span class="muted">' + esc(desde) + (ruta.totalKm ? ' Unos ' + Number(ruta.totalKm).toFixed(1).replace('.', ',') + ' km en total.' : '') + '</span><span class="sep"></span><button class="sm primary" data-mandar-ruta="' + id + '" type="button">Mandarle su ruta</button></div>';
    var paradas = ruta.paradas.map(function (p) {
      var e = p.entrega;
      var que = p.situacion === 'esperando_tiempo' ? 'esperando su tiempo' : p.situacion === 'cerca' ? 'llega ' + (p.llega || '?') + ' · ya avisó que está cerca' : 'llega ' + (p.llega || '?');
      return '<div class="ruta-parada"><span class="n">' + p.orden + ')</span><span>' + (e.prioridad === 'urgente' ? '<span class="urg">URGENTE</span>' : '') + '<b>' + esc(e.referencia) + '</b> ' + esc(e.nombre || telefonoBonito(e.phone)) + (e.distrito ? ' · ' + esc(e.distrito) : '') + (p.distancia ? ' <span class="muted">(' + esc(p.distancia) + ')</span>' : '') + (e.segundaVisita ? ' <span class="muted">· segunda visita</span>' : '') + '<div class="sub">' + esc(que) + (p.mapa ? ' · <a href="' + esc(p.mapa) + '" target="_blank" rel="noopener">mapa</a>' : '') + (e.notas ? ' · ' + esc(e.notas) : '') + '</div></span></div>';
    }).join('');
    td.innerHTML = cab + paradas + '<details><summary>Ver el mensaje tal como le llega</summary><pre class="ruta-texto">' + esc(ruta.texto) + '</pre></details>';
  } catch (e) { td.textContent = e.message; }
}

async function cargar() {
  resumen = await api('/admin/entregas');
  pintar();
}

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
document.getElementById('mot-nuevo').onclick = async function () {
  try {
    var d = await pedirVarios({ titulo: 'Nuevo motorizado', texto: 'Con su WhatsApp recibe los pedidos listos y contesta en cuántos minutos entrega.', campos: camposMotorizado(null), boton: 'Dar de alta' });
    if (!d) return;
    await api('/admin/motorizados', { method: 'POST', body: { nombre: d.nombre, telefono: d.telefono, zona: d.zona.join(', ') || undefined, placa: d.placa || undefined } });
    toast(d.nombre + ' dado de alta: ya puede recibir pedidos.');
    await cargar();
  } catch (e) { toast(e.message); }
};
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
    var partes = [(r.creados || []).length + ' dado' + ((r.creados || []).length === 1 ? '' : 's') + ' de alta'];
    if ((r.repetidos || []).length) partes.push((r.repetidos || []).length + ' ya estaba' + ((r.repetidos || []).length === 1 ? '' : 'n'));
    if ((r.descartados || []).length) partes.push((r.descartados || []).length + ' línea' + ((r.descartados || []).length === 1 ? '' : 's') + ' sin usar' + (r.descartados[0] && r.descartados[0].motivo ? ' (' + r.descartados[0].motivo + ')' : ''));
    toast(partes.join(' · ') + '.');
    await cargar();
  } catch (e) { toast(e.message); }
};
document.getElementById('mot-cargar').onclick = async function () {
  try { var r = await api('/admin/motorizados/de-prueba', { method: 'POST', body: {} }); toast(r.nuevos + ' motorizados de prueba dados de alta.'); await cargar(); } catch (e) { toast(e.message); }
};
document.getElementById('motorizados').addEventListener('click', async function (ev) {
  var b = ev.target.closest('button');
  if (!b) return;
  var id;
  try {
    if ((id = b.getAttribute('data-editar'))) {
      var m = resumen.motorizados.filter(function (x) { return String(x.id) === id; })[0];
      var campos = camposMotorizado(m).filter(function (c) { return c.id !== 'telefono'; });
      var d = await pedirVarios({ titulo: 'Editar a ' + m.nombre, texto: 'Su WhatsApp: ' + telefonoBonito(m.phone) + ' (para cambiarlo, dalo de alta de nuevo).', campos: campos, boton: 'Guardar' });
      if (!d) return;
      await api('/admin/motorizados/' + id, { method: 'POST', body: { nombre: d.nombre, zona: d.zona.join(', ') || null, placa: d.placa || null } });
      toast('Guardado.');
    } else if ((id = b.getAttribute('data-ruta'))) {
      rutasAbiertas[id] = !rutasAbiertas[id];
      pintar();
      return;
    } else if ((id = b.getAttribute('data-enlace'))) {
      var re = await api('/admin/motorizados/' + id + '/enlace', { method: 'POST', body: { mandar: true } });
      toast(re.enviado ? 'Enlace enviado por WhatsApp (vale 7 días).' : 'Enlace creado, pero no se pudo mandar por WhatsApp' + (re.motivo ? ': ' + re.motivo : '') + '. Cópialo y pásaselo: ' + re.url);
      try { if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(re.url); } catch (e) { /* sin portapapeles */ }
      return;
    } else if ((id = b.getAttribute('data-mandar-ruta'))) {
      var rr = await api('/admin/motorizados/' + id + '/ruta/mandar', { method: 'POST', body: {} });
      toast('Ruta enviada por WhatsApp: ' + rr.ruta.paradas.length + ' parada' + (rr.ruta.paradas.length === 1 ? '' : 's') + '.');
      return;
    } else if ((id = b.getAttribute('data-traspasar'))) {
      var quien = resumen.motorizados.filter(function (x) { return String(x.id) === id; })[0];
      var suyos = enManosDe(Number(id));
      var otros = resumen.motorizados.filter(function (x) { return x.estado === 'activo' && String(x.id) !== id; }).map(function (x) { return x.id + ' = ' + x.nombre; }).join('\n');
      var destino = await pedirDato({ titulo: 'Traspasar los pedidos de ' + quien.nombre, texto: 'Lleva ' + suyos.length + ' pedido' + (suyos.length === 1 ? '' : 's') + ' (' + suyos.map(function (e) { return e.referencia; }).join(', ') + '). Escribe el número del motorizado que se los queda, o déjalo vacío para que el sistema los reparta. Los clientes que ya tenían hora reciben un aviso.\n' + otros, marcador: 'vacío = el sistema reparte', boton: 'Siguiente', validar: function () { return null; } });
      if (destino === null) return;
      var aDescanso = await confirmarDialogo({ titulo: '¿Y a ' + quien.nombre.split(' ')[0] + '?', texto: 'Si ya no reparte más hoy (se quedó sin moto, se fue), pásalo a descanso para que no reciba pedidos nuevos. Si sigue activo, solo se le quitan estos.', boton: 'Pasarlo a descanso', cancelar: 'Sigue activo' });
      var rt = await api('/admin/motorizados/' + id + '/traspasar', { method: 'POST', body: { motorizadoId: destino ? Number(destino) : null, descanso: Boolean(aDescanso) } });
      toast(rt.traspasadas.length + ' pedido' + (rt.traspasadas.length === 1 ? '' : 's') + (rt.destino ? ' pasa' + (rt.traspasadas.length === 1 ? '' : 'n') + ' a ' + rt.destino.nombre : ' se reparte' + (rt.traspasadas.length === 1 ? '' : 'n') + ' entre los demás') + '.');
    } else if ((id = b.getAttribute('data-estado'))) {
      var valor = b.getAttribute('data-valor');
      var quien2 = resumen.motorizados.filter(function (x) { return String(x.id) === id; })[0];
      var nombreCorto = quien2 ? quien2.nombre.split(' ')[0] : 'El motorizado';
      await api('/admin/motorizados/' + id, { method: 'POST', body: { estado: valor } });
      toast(valor === 'descanso' ? nombreCorto + ' en descanso: no recibirá pedidos nuevos hasta que lo actives.' : valor === 'baja' ? nombreCorto + ' ya no reparte: sigue en la lista por si vuelve.' : nombreCorto + ' activo: ya puede recibir pedidos.');
    } else if ((id = b.getAttribute('data-quitar'))) {
      var si = await confirmarDialogo({ titulo: 'Borrar de la lista', texto: 'Se borra de la lista. Los pedidos que tenía quedan sin motorizado y el sistema busca otro. Si solo deja de repartir por hoy, usa "Descanso"; si es por una temporada, "Ya no reparte".', boton: 'Borrar', peligro: true });
      if (!si) return;
      await api('/admin/motorizados/' + id, { method: 'DELETE' });
    } else return;
    await cargar();
  } catch (e) { toast(e.message); }
});
document.addEventListener('ia:cambio', function () { cargar().catch(function () {}); });
setInterval(function () { if (document.querySelector('.dlg-fondo')) return; cargar().catch(function () {}); }, 15000);
cargar().catch(function (e) { toast(e.message); });
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
