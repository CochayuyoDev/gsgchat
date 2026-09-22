/**
 * Pantalla "Envio automatico": los numeros a los que el sistema escribe solo.
 *
 * Responde tres preguntas de un vistazo, en este orden: a quien le va a
 * escribir y cuando (la tarjeta de arriba y la columna "Cuando"), que se le
 * manda (la tabla) y como pararlo (el boton de cada fila, o la pausa del
 * numero entero, que esta enlazada arriba). Por que alguien ya no esta,
 * en "Ultimos movimientos".
 *
 * Decisiones:
 *  - Los clientes del reparto aparecen en la misma tabla, marcados. La lista
 *    es UNA: quien opera no tiene por que saber que por dentro son dos motores.
 *  - Un solo sitio decide si el motor esta trabajando o parado, y esa misma
 *    respuesta manda en la columna "Cuando" de cada fila: si no puede salir
 *    nada, ninguna fila dice "ya le toca".
 *  - Nada de confirm(): el cuadro propio (dialogo.ts), que no congela la
 *    pagina mientras se refresca sola.
 *  - Se pinta con las clases del armazon (.btn, .tarjeta, .chip.tono-*,
 *    .vacio) y con sus tokens: aqui solo va el CSS propio de la pantalla.
 *  - El JS va en String.raw, con var y sin backticks, como el resto.
 */

import { appShell } from './shell.js';

const CSS = `
  /* Solo lo propio de esta pantalla: la paleta, los botones, las tarjetas y
     los chips los pone el armazon. Nunca un color a pelo: rompe el modo oscuro. */
  * { box-sizing: border-box; }
  .wrap { color: var(--texto); font: var(--fs-cuerpo)/1.5 var(--fuente); max-width: 1500px; }
  .wrap a { color: var(--primario); }
  .muted { color: var(--texto-suave); }
  .hidden { display: none !important; }
  .demo { display: flex; align-items: center; gap: var(--esp-2); font-size: var(--fs-small); color: var(--texto-suave); margin: 0 0 var(--esp-3); }

  select, input, textarea { font: inherit; color: var(--texto); background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio-sm); padding: 8px 11px; width: 100%; min-height: 38px; max-width: 100%; }
  input[type=radio] { width: auto; min-height: 0; accent-color: var(--primario); }
  input:focus, select:focus, textarea:focus { border-color: var(--primario); outline: none; box-shadow: 0 0 0 3px var(--primario-suave); }
  textarea { min-height: 80px; resize: vertical; }
  label { display: block; font-size: var(--fs-small); font-weight: 500; color: var(--texto-suave); margin: 10px 0 4px; }
  label.linea { display: flex; align-items: center; gap: var(--esp-2); color: var(--texto); font-size: var(--fs-cuerpo); font-weight: 400; cursor: pointer; }

  /* Arriba del todo: que esta haciendo el sistema ahora mismo y como pararlo. */
  .estado { margin-bottom: var(--esp-3); border-left: 4px solid var(--gris); }
  .estado.verde { border-left-color: var(--verde); }
  .estado.ambar { border-left-color: var(--ambar); }
  .estado.rojo { border-left-color: var(--rojo); }
  .estado .cabecera { display: flex; align-items: center; gap: var(--esp-2); flex-wrap: wrap; }
  .estado h2 { font-size: var(--fs-h2); font-weight: 700; margin: 0; flex: 1; min-width: 240px; }
  .estado p { margin: var(--esp-2) 0 0; font-size: var(--fs-small); }
  .estado .ritmo { margin-top: var(--esp-2); font-size: var(--fs-cuerpo); color: var(--texto); }

  .tarjetas { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: var(--esp-3); margin-bottom: var(--esp-3); }
  .tarjetas .tarjeta { padding: var(--esp-3) var(--esp-4); min-width: 0; }
  .tarjeta .n { font-size: 22px; font-weight: 700; line-height: 1.1; }
  .tarjeta .q { font-size: var(--fs-small); color: var(--texto-suave); margin-top: 2px; }
  .tarjeta.ambar .n { color: var(--ambar); }

  .cols { display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: var(--esp-3); align-items: start; }
  @media (max-width: 1100px) { .cols { grid-template-columns: 1fr; } }
  .caja { padding: 0; overflow: hidden; margin-bottom: var(--esp-3); min-width: 0; }
  .caja > h2 { font-size: var(--fs-h3); font-weight: 700; margin: 0; padding: var(--esp-3) var(--esp-4); border-bottom: 1px solid var(--borde); display: flex; align-items: center; gap: var(--esp-2); flex-wrap: wrap; }
  .caja > h2 .sep { flex: 1; }
  .caja .cuerpo { padding: var(--esp-4); }
  .caja > h2 input { width: 220px; min-height: 34px; }

  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--borde); vertical-align: top; }
  th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--texto-suave); font-weight: 600; background: var(--superficie-2); position: sticky; top: 0; z-index: 1; }
  tbody tr:hover > td { background: var(--superficie-2); }
  tr:last-child td { border-bottom: 0; }
  td .sub { color: var(--texto-suave); font-size: var(--fs-small); margin-top: 2px; }
  .tabla-scroll { max-height: 62vh; overflow: auto; }
  .acciones { display: flex; gap: var(--esp-2); flex-wrap: wrap; }

  .mov { display: flex; gap: var(--esp-3); padding: 8px 0; border-bottom: 1px solid var(--borde); font-size: 13.5px; }
  .mov:last-child { border-bottom: 0; }
  .mov .cuando { color: var(--texto-suave); font-size: var(--fs-small); white-space: nowrap; min-width: 82px; }
  .mov .que { flex: 1; min-width: 0; }
  .mov .que .sub { color: var(--texto-suave); font-size: var(--fs-small); display: block; }
  .mov .icono { width: 22px; text-align: center; flex: none; }

  .fila-ajustes { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0 var(--esp-3); }
  .ia-atajo { display: flex; gap: var(--esp-2); align-items: center; flex-wrap: wrap; font-size: 13.5px; margin-top: var(--esp-3); }
  .ia-atajo .ej { color: var(--texto-suave); font-style: italic; }
  .botones { display: flex; gap: var(--esp-2); align-items: center; flex-wrap: wrap; margin-top: var(--esp-3); }
  .toast { position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%); background: var(--texto); color: var(--bg); padding: 10px 16px; border-radius: var(--radio-sm); font-size: var(--fs-cuerpo); z-index: 50; max-width: 90vw; box-shadow: var(--sombra-2); }
`;

export interface EnvioAutomaticoPageOpts {
  configured: boolean;
  demo?: boolean;
  nombreNegocio: string;
}

export function envioAutomaticoPage(opts: EnvioAutomaticoPageOpts): string {
  const { configured, demo } = opts;

  const contenido = `
<div class="wrap" id="wrap" data-configurado="${configured ? '1' : '0'}">
${demo ? '<p class="demo"><span class="chip tono-ambar sin-punto">Demostración</span> Nada sale a WhatsApp de verdad.</p>' : ''}

<section class="tarjeta estado" id="estado" aria-live="polite">
  <div class="cabecera"><span class="chip tono-gris" id="estado-chip">…</span><h2 id="estado-titular">Mirando qué está haciendo el sistema…</h2><span id="estado-accion"></span></div>
  <p class="ritmo" id="estado-ritmo">Cargando…</p>
  <p class="muted" id="estado-parar">Para dejar de escribirle a alguien, «Pausar» o «Quitar» en su fila. Para parar todos los mensajes del número de golpe, <a href="/panel#estado">pausa el número en Estado del número</a>.</p>
  <div class="ia-atajo">También puedes pedírselo con palabras: <button class="btn sm" id="abrir-ia" type="button">Pedírselo a la IA</button> <span class="ej">«pon a Juan, el 987 654 321, para pedirle su ubicación» · «quita a María de la lista»</span></div>
</section>

<div class="tarjetas" id="tarjetas"></div>

<div class="cols">
  <div>
    <section class="tarjeta caja">
      <h2>A quién le escribe el sistema <span class="sep"></span><input id="buscar" type="search" placeholder="Buscar por nombre o número" aria-label="Buscar en la lista por nombre, número o pedido"></h2>
      <div class="tabla-scroll">
        <table>
          <thead><tr><th>Quién</th><th>Qué se le manda</th><th>Mensajes</th><th>Cuándo</th><th>Lo puso</th><th><span class="muted">Acciones</span></th></tr></thead>
          <tbody id="filas"><tr><td colspan="6" class="muted">Cargando…</td></tr></tbody>
        </table>
      </div>
    </section>

    <section class="tarjeta caja">
      <h2>Últimos movimientos <span class="sep"></span><span class="muted" style="font-weight:400;font-size:12.5px">Quién entró, quién salió y por qué</span></h2>
      <div class="cuerpo" id="movimientos"><div class="muted">Cargando…</div></div>
    </section>
  </div>

  <div>
    <section class="tarjeta caja">
      <h2>Poner números</h2>
      <div class="cuerpo">
        <label for="alta-telefonos">Uno o varios números (uno por línea o separados por comas)</label>
        <textarea id="alta-telefonos" placeholder="987 654 321&#10;51912345678, 999 888 777"></textarea>
        <label for="alta-nombre">Nombre (si es uno solo)</label>
        <input id="alta-nombre" placeholder="Juan Pérez">
        <label>Qué se le manda</label>
        <label class="linea"><input type="radio" name="alta-que" value="ubicacion" checked> Pedirle su ubicación (hasta que la mande)</label>
        <label class="linea"><input type="radio" name="alta-que" value="mensaje"> Este mensaje:</label>
        <textarea id="alta-texto" class="hidden" placeholder="Hola {nombre}, te escribimos de {negocio} por {pedido}…" aria-label="El mensaje que se le manda"></textarea>
        <div id="alta-mensaje-opciones" class="hidden">
          <label for="alta-hasta">Deja de escribirle cuando</label>
          <select id="alta-hasta">
            <option value="respuesta">conteste</option>
            <option value="envios">se hayan mandado todos los mensajes</option>
            <option value="ubicacion">mande su ubicación</option>
          </select>
        </div>
        <label for="alta-referencia">Pedido o motivo (opcional, rellena {pedido})</label>
        <input id="alta-referencia" placeholder="pedido 1234">
        <label for="alta-max">Máximo de mensajes a este número</label>
        <select id="alta-max"><option value="">el de siempre</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select>
        <div class="botones"><button class="btn primario" id="alta-boton" type="button">Poner en la lista</button><span class="muted" id="alta-resultado" role="status"></span></div>
      </div>
    </section>

    <section class="tarjeta caja">
      <h2>Ritmo y horario</h2>
      <div class="cuerpo">
        <p class="muted" style="margin:0">Vale para esta lista y para el reparto: es el mismo ritmo para todo lo que el sistema manda solo.</p>
        <div class="fila-ajustes">
          <div><label for="aj-cada">Cada cuántas horas</label><input id="aj-cada" type="number" min="0.25" max="48" step="0.25"></div>
          <div><label for="aj-max">Máximo de mensajes por número</label><input id="aj-max" type="number" min="1" max="10"></div>
          <div><label for="aj-inicio">Desde (hora)</label><input id="aj-inicio" type="number" min="0" max="23"></div>
          <div><label for="aj-fin">Hasta (hora)</label><input id="aj-fin" type="number" min="1" max="24"></div>
        </div>
        <div class="botones"><button class="btn primario" id="aj-guardar" type="button">Guardar</button><span class="muted" id="aj-resultado" role="status"></span></div>
        <p class="muted" style="margin:10px 0 0;font-size:12.5px">Los textos y plantillas de la petición de ubicación se cambian en <a href="/rutas#ajustes">Ajustes del reparto</a>.</p>
      </div>
    </section>
  </div>
</div>
</div>
`;

  const script = String.raw`
/* ------------------------------------------------------------- utiles --- */

async function api(path, options) {
  options = options || {};
  var res = await fetch(path, {
    method: options.method || 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  var data = await res.json().catch(function () { return {}; });
  if (res.status === 401) { irAlLogin(); throw new Error('Tu sesión terminó: vuelve a entrar.'); }
  if (!res.ok) { var e = new Error(data.error || errorHttp(res.status)); e.datos = data; throw e; }
  return data;
}
function $(id) { return document.getElementById(id); }
function esc(v) {
  return String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function ver(id, visible) { $(id).classList.toggle('hidden', !visible); }
function toast(texto) {
  var el = document.createElement('div');
  el.className = 'toast';
  el.textContent = texto;
  el.style.bottom = (22 + document.querySelectorAll('.toast').length * 46) + 'px';
  document.body.appendChild(el);
  setTimeout(function () { el.remove(); }, 4500);
}
function cuando(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  var hora = d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return hora;
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit' }) + ' ' + hora;
}
function enCuanto(iso) {
  if (!iso) return 'en el siguiente turno';
  var ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'ya le toca';
  var min = Math.round(ms / 60000);
  if (min < 60) return 'en ' + min + ' min';
  var h = Math.floor(min / 60);
  var m = min % 60;
  return 'en ' + h + ' h' + (m ? ' ' + m + ' min' : '');
}
function telefonoBonito(p) {
  if (!p) return '';
  if (p.length === 11 && p.indexOf('51') === 0) return '+51 ' + p.slice(2, 5) + ' ' + p.slice(5, 8) + ' ' + p.slice(8);
  return '+' + p;
}
/* Lo que se está escribiendo no se pisa con lo que llega del servidor. */
var editando = {};
document.querySelectorAll('input, textarea').forEach(function (i) {
  i.addEventListener('focus', function () { editando[i.id] = true; });
  i.addEventListener('blur', function () { delete editando[i.id]; });
});
function poner(id, valor) { if (!editando[id]) $(id).value = valor; }

var CONFIGURADO = $('wrap').dataset.configurado === '1';
var resumen = null;
var filtro = '';

var ORIGEN = { manual: 'una persona', ia: 'el asistente IA', ayudante: 'la IA del panel', api: 'otro sistema (API)', reparto: 'el reparto' };
var QUE = { ubicacion: 'Pedirle su ubicación', mensaje: 'Un mensaje' };
var HASTA = { ubicacion: 'hasta que mande su ubicación', respuesta: 'hasta que conteste', envios: 'hasta completar los envíos' };

/* ------------------------------------------------------- qué está pasando */

/**
 * Un solo sitio decide si ahora mismo puede salir un mensaje. Lo usan el
 * cartel de arriba y la columna "Cuándo" de cada fila: si el motor no puede
 * escribir, ninguna fila dice "ya le toca".
 */
function estadoDelMotor() {
  var c = resumen.cifras;
  var a = resumen.ajustes;
  var m = resumen.motor;
  if (!CONFIGURADO) return { tono: 'rojo', anda: false, titular: 'Falta conectar WhatsApp: no sale ningún mensaje.', espera: 'cuando se conecte el WhatsApp', accion: { texto: 'Conectar el número', href: '/setup' } };
  if (m.parado) return { tono: 'rojo', anda: false, titular: 'Parado: ' + m.parado + '.', espera: 'cuando se reanude el número', accion: { texto: 'Ver Riesgo y ritmo', href: '/panel#salud' } };
  if (!c.enLista) return { tono: 'gris', anda: false, titular: 'No hay nadie a quien escribirle.', espera: '' };
  if (c.enLista - c.pausados <= 0) return { tono: 'ambar', anda: false, titular: 'Todos están en pausa: no sale ningún mensaje hasta reanudarlos.', espera: 'cuando lo reanudes' };
  if (!m.enHorario) return { tono: 'ambar', anda: false, titular: 'Fuera de horario: se sigue a las ' + a.horaInicio + ':00.', espera: 'a partir de las ' + a.horaInicio + ':00' };
  return { tono: 'verde', anda: true, titular: proximoTexto(), espera: '' };
}

/** A quién le toca antes y cuándo: lo primero que quiere saber quien mira. */
function proximoTexto() {
  var siguiente = null;
  resumen.numeros.forEach(function (n) {
    if (n.pausado) return;
    // Sin fecha significa que espera turno para el primer mensaje: le toca
    // antes que a nadie, por eso vale como la fecha más pequeña.
    var cuandoN = n.proximoEnvioAt || '';
    if (!siguiente || cuandoN < (siguiente.proximoEnvioAt || '')) siguiente = n;
  });
  if (!siguiente) return 'Escribiendo a los ' + (resumen.cifras.enLista - resumen.cifras.pausados) + ' números activos.';
  return 'El próximo mensaje es para ' + (siguiente.nombre || telefonoBonito(siguiente.phone)) + ', ' + enCuanto(siguiente.proximoEnvioAt) + '.';
}

/** Cuándo le toca a este número, contando lo que hace el motor ahora mismo. */
function cuandoLeToca(motor, n) {
  if (n.pausado) return '';
  if (!motor.anda) return motor.espera ? 'cuando se reanude: ' + motor.espera : 'parado';
  return 'próximo ' + enCuanto(n.proximoEnvioAt);
}

function pintarEstado(motor) {
  var a = resumen.ajustes;
  $('estado').className = 'tarjeta estado ' + motor.tono;
  $('estado-chip').className = 'chip tono-' + motor.tono;
  $('estado-chip').textContent = motor.anda ? 'Escribiendo' : motor.tono === 'rojo' ? 'Parado' : 'En espera';
  $('estado-titular').textContent = motor.titular;
  $('estado-accion').innerHTML = motor.accion ? '<a class="btn sm" href="' + esc(motor.accion.href) + '">' + esc(motor.accion.texto) + '</a>' : '';
  $('estado-ritmo').textContent =
    'A cada número, un mensaje cada ' + (a.cadaHoras % 1 === 0 ? a.cadaHoras : a.cadaHoras.toFixed(2)) + ' h, de ' + a.horaInicio + ':00 a ' + a.horaFin + ':00, ' +
    'como mucho ' + a.maxEnvios + ' mensaje' + (a.maxEnvios === 1 ? '' : 's') + ' por número; luego sale solo de la lista.';
  // Los ajustes de la derecha son los mismos números: se rellenan de aquí.
  poner('aj-cada', a.cadaHoras);
  poner('aj-max', a.maxEnvios);
  poner('aj-inicio', a.horaInicio);
  poner('aj-fin', a.horaFin);
}

function pintarTarjetas() {
  var c = resumen.cifras;
  // El cupo es del número entero (todo lo que inicia la empresa), no solo de
  // esta lista: por eso va aparte y con su enlace, no mezclado con lo de aquí.
  var cupo = c.cupoHoy === null ? '' :
    '<a class="tarjeta ' + (c.hoyComoMucho + (c.cupoUsado || 0) > c.cupoHoy ? 'ambar' : '') + '" href="/fiabilidad" style="text-decoration:none;display:block"><div class="n">' + c.cupoUsado + ' / ' + c.cupoHoy + '</div><div class="q">cupo del número hoy · ver si alcanza</div></a>';
  $('tarjetas').innerHTML =
    '<div class="tarjeta"><div class="n">' + c.enLista + '</div><div class="q">en la lista' + (c.reparto ? ' (' + c.reparto + ' del reparto)' : '') + '</div></div>' +
    '<div class="tarjeta ' + (c.pausados ? 'ambar' : '') + '"><div class="n">' + c.pausados + '</div><div class="q">en pausa: no se les escribe</div></div>' +
    '<div class="tarjeta"><div class="n">' + c.hoyEnviados + '</div><div class="q">mensajes hoy · como mucho ' + c.hoyComoMucho + ' más</div></div>' + cupo;
}

function pintarFilas(motor) {
  var cuerpo = $('filas');
  var q = filtro.trim().toLowerCase();
  var lista = resumen.numeros.filter(function (n) {
    if (!q) return true;
    return ((n.nombre || '') + ' ' + n.phone + ' ' + (n.referencia || '')).toLowerCase().indexOf(q) >= 0;
  });
  if (!lista.length) {
    cuerpo.innerHTML = '<tr><td colspan="6"><div class="vacio">' + (resumen.numeros.length
      ? '<h3>Nadie coincide con la búsqueda</h3><p>Prueba con otro nombre, otro número o el pedido.</p>'
      : '<h3>El sistema no le está escribiendo solo a nadie</h3><p>Pon números a la derecha, o pídeselo a la IA con palabras.</p>') + '</div></td></tr>';
    return;
  }
  cuerpo.innerHTML = lista.map(function (n) {
    var que = esc(QUE[n.que] || n.que) + (n.que === 'mensaje' && n.texto ? '<div class="sub">«' + esc(n.texto.length > 90 ? n.texto.slice(0, 90) + '…' : n.texto) + '»</div>' : '') +
      '<div class="sub">' + esc(HASTA[n.hasta] || '') + (n.referencia ? ' · ' + esc(n.referencia) : '') + '</div>';
    var chip = n.pausado ? '<span class="chip tono-ambar">en pausa</span>'
      : n.respondio ? '<span class="chip tono-azul">contestó</span>'
      : motor.anda ? '<span class="chip tono-verde">esperando</span>'
      : '<span class="chip tono-gris">en espera</span>';
    var toca = cuandoLeToca(motor, n);
    var situacion = chip + '<div class="sub">' + esc(n.situacion) + (toca ? ' · ' + esc(toca) : '') + '</div>';
    var mensajes = '<b>' + n.enviados + '</b> de ' + n.maxEnvios + (n.ultimoEnvioAt ? '<div class="sub">último ' + esc(cuando(n.ultimoEnvioAt)) + '</div>' : '');
    var puso = esc(ORIGEN[n.origen] || n.origen) + (n.origenDetalle ? '<div class="sub">' + esc(n.origenDetalle) + '</div>' : '');
    // Un cliente del reparto no se pausa de uno en uno: se pausa su lote, y
    // eso se hace en su pantalla. Por eso aquí no sale ese botón.
    var acciones = n.origen === 'reparto'
      ? '<div class="acciones"><a class="btn sm" href="/rutas">Ver en reparto</a><button class="btn sm peligro" type="button" data-quitar="' + esc(n.clave) + '" data-nombre="' + esc(n.nombre || n.phone) + '" data-reparto="1">Quitar</button></div>'
      : '<div class="acciones">' +
        (n.pausado
          ? '<button class="btn sm" type="button" data-reanudar="' + esc(n.clave) + '">Reanudar</button>'
          : '<button class="btn sm" type="button" data-pausar="' + esc(n.clave) + '">Pausar</button>') +
        '<button class="btn sm peligro" type="button" data-quitar="' + esc(n.clave) + '" data-nombre="' + esc(n.nombre || n.phone) + '">Quitar</button></div>';
    return '<tr>' +
      '<td><b>' + esc(n.nombre || 'Sin nombre') + '</b><div class="sub">' + esc(telefonoBonito(n.phone)) + '</div></td>' +
      '<td>' + que + '</td><td>' + mensajes + '</td><td>' + situacion + '</td><td>' + puso + '</td><td>' + acciones + '</td></tr>';
  }).join('');
}

var ICONO_MOV = { entro: '➕', salio: '✅', envio: '💬', pausa: '⏸', reanudo: '▶', fallo: '⚠' };
var VERBO_MOV = { entro: 'entró', salio: 'salió', envio: 'mensaje', pausa: 'en pausa', reanudo: 'reanudado', fallo: 'no salió' };
function pintarMovimientos() {
  var caja = $('movimientos');
  if (!resumen.movimientos.length) { caja.innerHTML = '<div class="muted">Todavía no ha pasado nada.</div>'; return; }
  caja.innerHTML = resumen.movimientos.map(function (m) {
    return '<div class="mov"><span class="icono" aria-hidden="true">' + (ICONO_MOV[m.tipo] || '•') + '</span><span class="cuando">' + esc(cuando(m.at)) + '</span>' +
      '<span class="que"><b>' + esc(m.nombre || telefonoBonito(m.phone)) + '</b> ' + esc(VERBO_MOV[m.tipo] || m.tipo) + ': ' + esc(m.texto) + (m.origen ? '<span class="sub">' + esc(m.origen) + '</span>' : '') + '</span></div>';
  }).join('');
}

/* ------------------------------------------------------------- cargar --- */

var fallosSeguidos = 0;

async function cargar() {
  resumen = await api('/admin/envio-automatico');
  var motor = estadoDelMotor();
  pintarEstado(motor);
  pintarTarjetas();
  pintarFilas(motor);
  pintarMovimientos();
  fallosSeguidos = 0;
}

/**
 * Si no se puede leer la lista, se dice una vez y se sigue intentando: antes
 * salía un aviso cada 10 segundos, uno encima de otro.
 */
function refrescar() {
  return cargar().catch(function (e) {
    fallosSeguidos += 1;
    if (fallosSeguidos === 1) toast('No se pudo leer la lista: ' + e.message + ' Se sigue intentando.');
  });
}

/* ------------------------------------------------------------ acciones -- */

$('buscar').addEventListener('input', function () {
  filtro = this.value;
  if (resumen) pintarFilas(estadoDelMotor());
});

document.querySelectorAll('input[name=alta-que]').forEach(function (r) {
  r.addEventListener('change', function () {
    var mensaje = document.querySelector('input[name=alta-que]:checked').value === 'mensaje';
    ver('alta-texto', mensaje);
    ver('alta-mensaje-opciones', mensaje);
  });
});

$('alta-boton').onclick = async function () {
  var boton = this;
  var que = document.querySelector('input[name=alta-que]:checked').value;
  var salida = $('alta-resultado');
  var cuerpo = {
    telefonos: $('alta-telefonos').value,
    nombre: $('alta-nombre').value.trim() || undefined,
    que: que,
    texto: que === 'mensaje' ? $('alta-texto').value : undefined,
    hasta: que === 'mensaje' ? $('alta-hasta').value : undefined,
    referencia: $('alta-referencia').value.trim() || undefined,
    maxEnvios: $('alta-max').value || null
  };
  if (!cuerpo.telefonos.trim()) { salida.textContent = 'Escribe al menos un número.'; return; }
  if (que === 'mensaje' && !(cuerpo.texto || '').trim()) { salida.textContent = 'Escribe el mensaje que se les va a mandar.'; return; }
  boton.disabled = true;
  salida.textContent = 'Poniéndolos…';
  try {
    var r = await api('/admin/envio-automatico', { method: 'POST', body: cuerpo });
    var puestos = r.puestos.filter(function (p) { return p.nueva; }).length;
    var yaEstaban = r.puestos.length - puestos;
    var partes = [];
    if (puestos) partes.push('Listo: ' + puestos + ' número' + (puestos === 1 ? '' : 's') + ' en la lista.');
    if (yaEstaban) partes.push(yaEstaban + ' ya estaba' + (yaEstaban === 1 ? '' : 'n') + '.');
    if (r.rechazados.length) partes.push('No entraron: ' + r.rechazados.map(function (x) { return x.telefono + ' (' + x.motivo + ')'; }).join('; '));
    salida.textContent = partes.join(' ');
    if (puestos) { $('alta-telefonos').value = ''; $('alta-nombre').value = ''; $('alta-referencia').value = ''; }
    await cargar();
  } catch (e) {
    salida.textContent = e.message;
  } finally {
    boton.disabled = false;
  }
};

$('filas').addEventListener('click', async function (evento) {
  var b = evento.target.closest('button');
  if (!b) return;
  b.disabled = true;
  try {
    if (b.dataset.quitar) {
      var esReparto = b.dataset.reparto === '1';
      var ok = await confirmarDialogo({
        titulo: 'Quitar a ' + b.dataset.nombre,
        texto: esReparto
          ? 'Es un cliente del reparto: dejará de recibir mensajes automáticos y pasará a una persona para que lo llame.'
          : 'Dejará de recibir mensajes automáticos. Lo puedes volver a poner cuando quieras.',
        boton: 'Quitar',
        peligro: true
      });
      if (!ok) return;
      await api('/admin/envio-automatico/' + encodeURIComponent(b.dataset.quitar), { method: 'DELETE' });
      toast(esReparto ? 'Pasa a una persona.' : 'Fuera de la lista.');
    } else if (b.dataset.pausar) {
      await api('/admin/envio-automatico/' + encodeURIComponent(b.dataset.pausar) + '/pausar', { method: 'POST' });
      toast('En pausa: no se le escribe hasta reanudarlo.');
    } else if (b.dataset.reanudar) {
      await api('/admin/envio-automatico/' + encodeURIComponent(b.dataset.reanudar) + '/reanudar', { method: 'POST' });
      toast('Reanudado.');
    } else {
      return;
    }
    await cargar();
  } catch (e) {
    toast(e.message);
    // Si el servidor dice dónde se hace (los lotes del reparto se pausan en
    // su pantalla), se lleva allí en vez de dejar el botón muerto.
    if (e.datos && e.datos.ir) location.href = e.datos.ir;
  } finally {
    b.disabled = false;
  }
});

$('aj-guardar').onclick = async function () {
  var boton = this;
  var salida = $('aj-resultado');
  var inicio = Number($('aj-inicio').value);
  var fin = Number($('aj-fin').value);
  // Se avisa antes de mandarlo: el servidor lo rechaza igual, pero así se
  // entiende sin esperar al viaje de ida y vuelta.
  if (fin <= inicio) { salida.textContent = 'La hora de fin tiene que ser mayor que la de inicio.'; return; }
  boton.disabled = true;
  try {
    await api('/admin/envio-automatico/ajustes', { method: 'POST', body: {
      cadaHoras: Number($('aj-cada').value),
      maxEnvios: Number($('aj-max').value),
      horaInicio: inicio,
      horaFin: fin
    } });
    salida.textContent = 'Guardado: se aplica desde ahora.';
    await cargar();
  } catch (e) {
    salida.textContent = e.message;
  } finally {
    boton.disabled = false;
  }
};

$('abrir-ia').onclick = function () {
  if (window.abrirOperadorIA) window.abrirOperadorIA('Pon en la lista de envío automático a ');
  else location.href = '/manual#preguntar';
};

/* Cuando la IA hace algo desde el cuadro global, la lista se pone al día. */
document.addEventListener('ia:cambio', function () { refrescar(); });

setInterval(function () {
  // Mientras hay un cuadro de diálogo abierto no se refresca: cambiar lo de
  // debajo mientras alguien decide es como moverle la mesa.
  if (document.querySelector('.dlg-fondo')) return;
  refrescar();
}, 10000);
refrescar();
`;

  return appShell({
    titulo: 'Envío automático',
    subtitulo: 'A quién le escribe el sistema solo, cada pocas horas, como una persona',
    contenido,
    script,
    css: CSS,
    nombreNegocio: opts.nombreNegocio,
    demo,
    icono: '⏱',
  });
}
