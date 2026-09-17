/**
 * Pantalla "Envio automatico": los numeros a los que el sistema escribe solo.
 *
 * Responde tres preguntas de un vistazo: a quien se le esta escribiendo, que
 * se le manda y por que alguien ya no esta. Todo lo que se puede hacer -poner
 * numeros, quitarlos, pausarlos, cambiar el ritmo- se hace aqui; y lo mismo
 * se le puede pedir con palabras al asistente del panel (el boton "Pedirselo
 * a la IA" abre el mismo cuadro que hay en todas las pantallas).
 *
 * Decisiones:
 *  - Los clientes del reparto aparecen en la misma tabla, marcados. La lista
 *    es UNA: quien opera no tiene por que saber que por dentro son dos motores.
 *  - Nada de confirm(): el cuadro propio (dialogo.ts), que no congela la
 *    pagina mientras se refresca sola.
 *  - El JS va en String.raw, con var y sin backticks, como el resto.
 */

import { appShell } from './shell.js';

const CSS = `
  :root {
    color-scheme: light dark;
    --bg: #f0f2f5; --panel: #fff; --line: #e3e5e9; --text: #111b21;
    --muted: #667781; --accent: #128c7e; --ok: #128c7e; --warn: #d97706;
    --bad: #dc2626; --info: #2563eb; --chip: #f6f7f9;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0b141a; --panel: #111b21; --line: #222d34; --text: #e9edef; --muted: #8696a0; --chip: #1c262c; }
  }
  * { box-sizing: border-box; }
  .wrap { color: var(--text); font: 15px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 1500px; }
  .wrap a { color: var(--accent); }
  .muted { color: var(--muted); }
  .demo { background: #d97706; color: #fff; padding: 9px 14px; font-size: 13.5px; text-align: center; }
  .demo a { color: #fff; text-decoration: underline; }
  .aviso { background: rgba(217,119,6,.12); border: 1px solid rgba(217,119,6,.35); border-radius: 10px; padding: 12px 14px; margin-bottom: 14px; font-size: 14px; }
  .aviso b { color: var(--warn); }

  select, input, textarea, button { font: inherit; color: var(--text); background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px 11px; }
  input, select, textarea { width: 100%; }
  textarea { min-height: 80px; resize: vertical; }
  button { cursor: pointer; width: auto; }
  button:hover { border-color: var(--accent); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.primary:hover { filter: brightness(1.08); }
  button.sm { padding: 5px 9px; font-size: 13px; }
  button.peligro { color: var(--bad); }
  button:disabled { opacity: .55; cursor: default; }
  label { display: block; font-size: 12.5px; color: var(--muted); margin: 10px 0 4px; }
  label.linea { display: flex; align-items: center; gap: 8px; margin: 6px 0; color: var(--text); font-size: 14px; cursor: pointer; }
  label.linea input { width: auto; }

  .explica { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
  .explica .texto { flex: 1; min-width: 260px; font-size: 14px; }
  .explica .texto p { margin: 0 0 6px; }
  .explica .ritmo { background: var(--chip); border-radius: 10px; padding: 10px 14px; min-width: 240px; font-size: 13.5px; }
  .explica .ritmo b { display: block; font-size: 15px; margin-bottom: 4px; }

  .tarjetas { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
  .tarjeta { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 10px 14px; min-width: 150px; }
  .tarjeta .n { font-size: 22px; font-weight: 700; line-height: 1.1; }
  .tarjeta .q { font-size: 12.5px; color: var(--muted); margin-top: 2px; }
  .tarjeta.ok .n { color: var(--ok); }
  .tarjeta.warn .n { color: var(--warn); }
  .tarjeta.bad .n { color: var(--bad); }

  .cols { display: grid; grid-template-columns: 1fr 400px; gap: 14px; align-items: start; }
  @media (max-width: 1100px) { .cols { grid-template-columns: 1fr; } }
  .caja { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; margin-bottom: 14px; }
  .caja > h2 { font-size: 14.5px; margin: 0; padding: 12px 14px; border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 8px; }
  .caja > h2 .sep { flex: 1; }
  .caja .cuerpo { padding: 14px; }
  .caja.plegable > h2 { cursor: pointer; }
  .caja.plegable.cerrada .cuerpo { display: none; }
  .caja.plegable > h2 .flecha { transition: transform .15s; }
  .caja.plegable.cerrada > h2 .flecha { transform: rotate(-90deg); }

  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: .03em; color: var(--muted); font-weight: 600; }
  tbody tr:hover { background: var(--chip); }
  td .sub { color: var(--muted); font-size: 12.5px; }
  .tabla-scroll { max-height: 62vh; overflow: auto; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 600; white-space: nowrap; }
  .pill.ok { background: rgba(18,140,126,.16); color: var(--ok); }
  .pill.warn { background: rgba(217,119,6,.16); color: var(--warn); }
  .pill.bad { background: rgba(220,38,38,.14); color: var(--bad); }
  .pill.info { background: rgba(37,99,235,.14); color: var(--info); }
  .pill.gris { background: var(--chip); color: var(--muted); }
  .acciones { display: flex; gap: 6px; flex-wrap: wrap; }
  .vacio { padding: 26px 14px; text-align: center; color: var(--muted); }

  .mov { display: flex; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 13.5px; }
  .mov:last-child { border-bottom: 0; }
  .mov .cuando { color: var(--muted); font-size: 12px; white-space: nowrap; min-width: 82px; }
  .mov .que { flex: 1; min-width: 0; }
  .mov .que b { font-weight: 600; }
  .mov .que .sub { color: var(--muted); font-size: 12.5px; display: block; }
  .mov .icono { width: 22px; text-align: center; flex: none; }

  .toast { position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%); background: #111b21; color: #fff; padding: 10px 16px; border-radius: 10px; font-size: 14px; z-index: 50; box-shadow: 0 8px 24px rgba(0,0,0,.25); }
  .fila-ajustes { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
  .motor { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; }
  .motor .punto { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); flex: none; }
  .motor.va .punto { background: var(--ok); animation: latido 1.6s ease-in-out infinite; }
  .motor.espera .punto { background: var(--warn); }
  .motor.parado .punto { background: var(--bad); }
  @keyframes latido { 0%, 100% { opacity: 1 } 50% { opacity: .35 } }
  .ia-atajo { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 13.5px; }
  .ia-atajo .ej { color: var(--muted); font-style: italic; }
`;

export interface EnvioAutomaticoPageOpts {
  configured: boolean;
  demo?: boolean;
  nombreNegocio: string;
}

export function envioAutomaticoPage(opts: EnvioAutomaticoPageOpts): string {
  const { configured, demo } = opts;
  const aviso = configured
    ? ''
    : `<div class="aviso"><b>Falta conectar WhatsApp.</b> La lista se puede preparar, pero no saldrá ningún mensaje hasta conectar el número en <a href="/setup">Conexión de WhatsApp</a>.</div>`;

  const contenido = `
<div class="wrap">
${demo ? '<div class="demo">Demostración: nada sale a WhatsApp de verdad.</div>' : ''}
${aviso}

<div class="explica">
  <div class="texto">
    <p><b>El sistema solo escribe por su cuenta a los números de esta lista</b> (y a los clientes de un lote del reparto, que se cargan en <a href="/rutas">Ubicaciones para reparto</a>).</p>
    <p>A cada número le manda <b>un mensaje cada pocas horas, como lo haría una persona</b>, en horario, hasta conseguir lo que buscaba: su ubicación o una respuesta. Cuando lo consigue —o se agotan los intentos— <b>lo saca solo de la lista</b>. Así nunca se llega al cupo del día del número ni hace falta pagar por más.</p>
    <div class="ia-atajo">También puedes pedírselo con palabras: <button class="sm" id="abrir-ia" type="button">🤖 Pedírselo a la IA</button> <span class="ej">«pon a Juan, el 987 654 321, para pedirle su ubicación» · «quita a María de la lista»</span></div>
  </div>
  <div class="ritmo" id="ritmo">
    <b>Ritmo actual</b>
    <span id="ritmo-texto">Cargando…</span>
    <div style="margin-top:8px"><span class="motor" id="motor"><i class="punto"></i><span id="motor-texto">…</span></span></div>
  </div>
</div>

<div class="tarjetas" id="tarjetas"></div>

<div class="cols">
  <div>
    <div class="caja">
      <h2>Números en la lista <span class="sep"></span><input id="buscar" placeholder="Buscar por nombre o número" style="width:220px"></h2>
      <div class="tabla-scroll">
        <table>
          <thead><tr><th>Quién</th><th>Qué se le manda</th><th>Mensajes</th><th>Situación</th><th>Lo puso</th><th></th></tr></thead>
          <tbody id="filas"><tr><td colspan="6" class="vacio">Cargando…</td></tr></tbody>
        </table>
      </div>
    </div>

    <div class="caja">
      <h2>Últimos movimientos <span class="sep"></span><span class="muted" style="font-weight:400;font-size:12.5px">Quién entró, quién salió y por qué</span></h2>
      <div class="cuerpo" id="movimientos"><div class="muted">Cargando…</div></div>
    </div>
  </div>

  <div>
    <div class="caja">
      <h2>Poner números</h2>
      <div class="cuerpo">
        <label for="alta-telefonos">Uno o varios números (uno por línea o separados por comas)</label>
        <textarea id="alta-telefonos" placeholder="987 654 321&#10;51912345678, 999 888 777"></textarea>
        <label for="alta-nombre">Nombre (si es uno solo)</label>
        <input id="alta-nombre" placeholder="Juan Pérez">
        <label>Qué se le manda</label>
        <label class="linea"><input type="radio" name="alta-que" value="ubicacion" checked> Pedirle su ubicación (hasta que la mande)</label>
        <label class="linea"><input type="radio" name="alta-que" value="mensaje"> Este mensaje:</label>
        <textarea id="alta-texto" class="hidden" placeholder="Hola {nombre}, te escribimos de {negocio} por {pedido}…"></textarea>
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
        <div style="margin-top:12px;display:flex;gap:8px;align-items:center"><button class="primary" id="alta-boton">Poner en la lista</button><span class="muted" id="alta-resultado"></span></div>
      </div>
    </div>

    <div class="caja plegable cerrada" id="caja-ajustes">
      <h2>Ritmo y horario <span class="sep"></span><span class="flecha">▾</span></h2>
      <div class="cuerpo">
        <p class="muted" style="margin:0 0 8px">Vale para la lista y para el reparto: es el mismo ritmo para todo lo que el sistema manda solo.</p>
        <div class="fila-ajustes">
          <div><label for="aj-cada">Cada cuántas horas</label><input id="aj-cada" type="number" min="0.25" max="48" step="0.25"></div>
          <div><label for="aj-max">Máximo de mensajes por número</label><input id="aj-max" type="number" min="1" max="10"></div>
          <div><label for="aj-inicio">Desde (hora)</label><input id="aj-inicio" type="number" min="0" max="23"></div>
          <div><label for="aj-fin">Hasta (hora)</label><input id="aj-fin" type="number" min="1" max="24"></div>
        </div>
        <div style="margin-top:12px;display:flex;gap:8px;align-items:center"><button class="primary" id="aj-guardar">Guardar</button><span class="muted" id="aj-resultado"></span></div>
        <p class="muted" style="margin:10px 0 0;font-size:12.5px">Los textos y plantillas de la petición de ubicación se cambian en <a href="/rutas#ajustes">Ajustes del reparto</a>.</p>
      </div>
    </div>
  </div>
</div>
</div>
`;

  const script = String.raw`
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
function esc(v) {
  return String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function ver(id, visible) { var el = document.getElementById(id); if (el) el.classList.toggle('hidden', !visible); }
function toast(texto) {
  var el = document.createElement('div');
  el.className = 'toast';
  el.textContent = texto;
  document.body.appendChild(el);
  setTimeout(function () { el.remove(); }, 4500);
}
function cuando(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  var hoy = new Date();
  var misma = d.toDateString() === hoy.toDateString();
  var hora = d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  return misma ? hora : d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit' }) + ' ' + hora;
}
function enCuanto(iso) {
  if (!iso) return 'en cuanto toque';
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

var resumen = null;
var filtro = '';

var ORIGEN = { manual: 'una persona', ia: 'el asistente IA', ayudante: 'la IA del panel', api: 'otro sistema (API)', reparto: 'el reparto' };
var QUE = { ubicacion: 'Pedirle su ubicación', mensaje: 'Un mensaje' };
var HASTA = { ubicacion: 'hasta que mande su ubicación', respuesta: 'hasta que conteste', envios: 'hasta completar los envíos' };

function pintarRitmo() {
  var a = resumen.ajustes;
  var texto = 'Un mensaje cada ' + (a.cadaHoras % 1 === 0 ? a.cadaHoras : a.cadaHoras.toFixed(2)) + ' h a cada número, de ' + a.horaInicio + ':00 a ' + a.horaFin + ':00, máximo ' + a.maxEnvios + ' mensaje' + (a.maxEnvios === 1 ? '' : 's') + ' por número.';
  document.getElementById('ritmo-texto').textContent = texto;
  var motor = document.getElementById('motor');
  var mt = document.getElementById('motor-texto');
  motor.className = 'motor';
  if (resumen.motor.parado) { motor.classList.add('parado'); mt.textContent = 'Parado: ' + resumen.motor.parado; }
  else if (!resumen.motor.enHorario) { motor.classList.add('espera'); mt.textContent = 'Fuera de horario: sigue a las ' + a.horaInicio + ':00'; }
  else if (resumen.cifras.enLista - resumen.cifras.pausados > 0) { motor.classList.add('va'); mt.textContent = 'Trabajando'; }
  else { mt.textContent = 'Sin nadie a quien escribir'; }
  document.getElementById('aj-cada').value = a.cadaHoras;
  document.getElementById('aj-max').value = a.maxEnvios;
  document.getElementById('aj-inicio').value = a.horaInicio;
  document.getElementById('aj-fin').value = a.horaFin;
}

function pintarTarjetas() {
  var c = resumen.cifras;
  var cupo = c.cupoHoy === null ? '' :
    '<div class="tarjeta ' + (c.hoyComoMucho + (c.cupoUsado || 0) > c.cupoHoy ? 'warn' : 'ok') + '"><div class="n">' + esc(c.cupoUsado) + ' / ' + esc(c.cupoHoy) + '</div><div class="q">cupo del número hoy (usado / total)</div></div>';
  document.getElementById('tarjetas').innerHTML =
    '<div class="tarjeta"><div class="n">' + c.enLista + '</div><div class="q">en la lista' + (c.reparto ? ' (' + c.reparto + ' del reparto)' : '') + '</div></div>' +
    '<div class="tarjeta ' + (c.pausados ? 'warn' : '') + '"><div class="n">' + c.pausados + '</div><div class="q">en pausa</div></div>' +
    '<div class="tarjeta ok"><div class="n">' + c.hoyEnviados + '</div><div class="q">mensajes de la lista hoy</div></div>' +
    '<div class="tarjeta"><div class="n">' + c.hoyComoMucho + '</div><div class="q">como mucho saldrán hoy</div></div>' + cupo;
}

function pintarFilas() {
  var cuerpo = document.getElementById('filas');
  var q = filtro.trim().toLowerCase();
  var lista = resumen.numeros.filter(function (n) {
    if (!q) return true;
    return ((n.nombre || '') + ' ' + n.phone + ' ' + (n.referencia || '')).toLowerCase().indexOf(q) >= 0;
  });
  if (!lista.length) {
    cuerpo.innerHTML = '<tr><td colspan="6" class="vacio">' + (resumen.numeros.length ? 'Nadie coincide con la búsqueda.' : 'La lista está vacía: el sistema no le está escribiendo solo a nadie. Pon números a la derecha, o pídeselo a la IA.') + '</td></tr>';
    return;
  }
  cuerpo.innerHTML = lista.map(function (n) {
    var que = QUE[n.que] + (n.que === 'mensaje' && n.texto ? '<div class="sub">«' + esc(n.texto.length > 90 ? n.texto.slice(0, 90) + '…' : n.texto) + '»</div>' : '') +
      '<div class="sub">' + esc(HASTA[n.hasta]) + (n.referencia ? ' · ' + esc(n.referencia) : '') + '</div>';
    var pill = n.pausado ? '<span class="pill warn">en pausa</span>' : n.respondio ? '<span class="pill info">contestó</span>' : n.enviados ? '<span class="pill ok">esperando</span>' : '<span class="pill gris">por empezar</span>';
    var situacion = pill + '<div class="sub">' + esc(n.situacion) + (!n.pausado ? ' · próximo ' + esc(enCuanto(n.proximoEnvioAt)) : '') + '</div>';
    var mensajes = '<b>' + n.enviados + '</b> de ' + n.maxEnvios + (n.ultimoEnvioAt ? '<div class="sub">último ' + esc(cuando(n.ultimoEnvioAt)) + '</div>' : '');
    var puso = esc(ORIGEN[n.origen] || n.origen) + (n.origenDetalle ? '<div class="sub">' + esc(n.origenDetalle) + '</div>' : '');
    var acciones = n.origen === 'reparto'
      ? '<div class="acciones"><a class="sm" href="/rutas" style="font-size:13px">Ver en reparto</a><button class="sm peligro" data-quitar="' + esc(n.clave) + '" data-nombre="' + esc(n.nombre || n.phone) + '" data-reparto="1">Quitar</button></div>'
      : '<div class="acciones">' +
        (n.pausado ? '<button class="sm" data-reanudar="' + esc(n.clave) + '">Reanudar</button>' : '<button class="sm" data-pausar="' + esc(n.clave) + '">Pausar</button>') +
        '<button class="sm peligro" data-quitar="' + esc(n.clave) + '" data-nombre="' + esc(n.nombre || n.phone) + '">Quitar</button></div>';
    return '<tr>' +
      '<td><b>' + esc(n.nombre || 'Sin nombre') + '</b><div class="sub">' + esc(telefonoBonito(n.phone)) + '</div></td>' +
      '<td>' + que + '</td><td>' + mensajes + '</td><td>' + situacion + '</td><td>' + puso + '</td><td>' + acciones + '</td></tr>';
  }).join('');
}

var ICONO_MOV = { entro: '➕', salio: '✅', envio: '💬', pausa: '⏸', reanudo: '▶', fallo: '⚠' };
function pintarMovimientos() {
  var caja = document.getElementById('movimientos');
  if (!resumen.movimientos.length) { caja.innerHTML = '<div class="muted">Todavía no ha pasado nada.</div>'; return; }
  caja.innerHTML = resumen.movimientos.map(function (m) {
    var verbo = m.tipo === 'entro' ? 'entró' : m.tipo === 'salio' ? 'salió' : m.tipo === 'envio' ? 'mensaje' : m.tipo === 'pausa' ? 'en pausa' : m.tipo === 'reanudo' ? 'reanudado' : 'no salió';
    return '<div class="mov"><span class="icono">' + (ICONO_MOV[m.tipo] || '•') + '</span><span class="cuando">' + esc(cuando(m.at)) + '</span>' +
      '<span class="que"><b>' + esc(m.nombre || telefonoBonito(m.phone)) + '</b> ' + esc(verbo) + ': ' + esc(m.texto) + (m.origen ? '<span class="sub">' + esc(m.origen) + '</span>' : '') + '</span></div>';
  }).join('');
}

async function cargar() {
  resumen = await api('/admin/envio-automatico');
  pintarRitmo();
  pintarTarjetas();
  pintarFilas();
  pintarMovimientos();
}

document.getElementById('buscar').addEventListener('input', function () { filtro = this.value; if (resumen) pintarFilas(); });

document.querySelectorAll('input[name=alta-que]').forEach(function (r) {
  r.addEventListener('change', function () {
    var mensaje = document.querySelector('input[name=alta-que]:checked').value === 'mensaje';
    ver('alta-texto', mensaje);
    ver('alta-mensaje-opciones', mensaje);
  });
});

document.getElementById('alta-boton').onclick = async function () {
  var boton = this;
  var que = document.querySelector('input[name=alta-que]:checked').value;
  var cuerpo = {
    telefonos: document.getElementById('alta-telefonos').value,
    nombre: document.getElementById('alta-nombre').value.trim() || undefined,
    que: que,
    texto: que === 'mensaje' ? document.getElementById('alta-texto').value : undefined,
    hasta: que === 'mensaje' ? document.getElementById('alta-hasta').value : undefined,
    referencia: document.getElementById('alta-referencia').value.trim() || undefined,
    maxEnvios: document.getElementById('alta-max').value || null
  };
  var salida = document.getElementById('alta-resultado');
  if (!cuerpo.telefonos.trim()) { salida.textContent = 'Escribe al menos un número.'; return; }
  boton.disabled = true;
  try {
    var r = await api('/admin/envio-automatico', { method: 'POST', body: cuerpo });
    var puestos = r.puestos.filter(function (p) { return p.nueva; }).length;
    var yaEstaban = r.puestos.length - puestos;
    var texto = puestos ? 'Listo: ' + puestos + ' número' + (puestos === 1 ? '' : 's') + ' en la lista.' : '';
    if (yaEstaban) texto += ' ' + yaEstaban + ' ya estaba' + (yaEstaban === 1 ? '' : 'n') + '.';
    if (r.rechazados.length) texto += ' No entraron: ' + r.rechazados.map(function (x) { return x.telefono + ' (' + x.motivo + ')'; }).join('; ');
    salida.textContent = texto;
    if (puestos) { document.getElementById('alta-telefonos').value = ''; document.getElementById('alta-nombre').value = ''; document.getElementById('alta-referencia').value = ''; }
    await cargar();
  } catch (e) { salida.textContent = e.message; }
  boton.disabled = false;
};

document.getElementById('filas').addEventListener('click', async function (event) {
  var b = event.target.closest('button');
  if (!b) return;
  try {
    if (b.dataset.quitar) {
      var esReparto = b.dataset.reparto === '1';
      var ok = await confirmarDialogo({
        titulo: 'Quitar a ' + b.dataset.nombre,
        texto: esReparto
          ? 'Es un cliente del reparto: dejará de recibir mensajes automáticos y pasará a una persona para que lo llame.'
          : 'Dejará de recibir mensajes automáticos. Lo puedes volver a poner cuando quieras.',
        boton: 'Quitar'
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
    }
    await cargar();
  } catch (e) { toast(e.message); }
});

document.getElementById('aj-guardar').onclick = async function () {
  var salida = document.getElementById('aj-resultado');
  try {
    await api('/admin/envio-automatico/ajustes', { method: 'POST', body: {
      cadaHoras: Number(document.getElementById('aj-cada').value),
      maxEnvios: Number(document.getElementById('aj-max').value),
      horaInicio: Number(document.getElementById('aj-inicio').value),
      horaFin: Number(document.getElementById('aj-fin').value)
    } });
    salida.textContent = 'Guardado: se aplica desde ahora.';
    await cargar();
  } catch (e) { salida.textContent = e.message; }
};

document.querySelector('#caja-ajustes > h2').onclick = function () { document.getElementById('caja-ajustes').classList.toggle('cerrada'); };
document.getElementById('abrir-ia').onclick = function () {
  if (window.abrirOperadorIA) window.abrirOperadorIA('Pon en la lista de envío automático a ');
  else location.href = '/manual#preguntar';
};
/* Cuando la IA hace algo desde el cuadro global, la lista se pone al dia. */
document.addEventListener('ia:cambio', function () { cargar().catch(function () {}); });

setInterval(function () {
  var activo = document.activeElement;
  if (activo && (activo.tagName === 'INPUT' || activo.tagName === 'TEXTAREA')) return;
  cargar().catch(function (e) { toast(e.message); });
}, 10000);
cargar().catch(function (e) { toast(e.message); });
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
