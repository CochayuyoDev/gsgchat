/**
 * La pantalla de chat que se mete dentro de otra web.
 *
 * Es el chat de /chat reducido a lo que hace falta dentro de un iframe: la
 * lista de conversaciones (o solo una, si el token es para un telefono), el
 * hilo, y escribir. Sin menu, sin campana, sin nada del panel. Habla
 * unicamente con la API publica (/api/v1) usando el token que le pasa la web
 * que la embebe, asi que no ve mas de lo que el token permite.
 *
 * Como recibe el token: por `postMessage` desde la web padre (lo que hace
 * embed.js; el token no queda en ninguna URL ni log) o, para probar a mano,
 * en `?token=`. Lo que cuenta hacia fuera, tambien por postMessage:
 * `wa:no-leidos`, `wa:mensaje`, `wa:token-caducado`.
 *
 * Se mantiene al dia por el flujo de eventos (SSE) y, si eso no esta, por
 * un refresco cada pocos segundos.
 *
 * Nota: el JS va en String.raw y usa concatenacion, como el resto de paginas.
 */

const CSS = `
  :root {
    color-scheme: light dark;
    --bg: #eae6df; --panel: #fff; --line: #e3e5e9; --text: #111b21; --muted: #667781;
    --accent: #128c7e; --mine: #d9fdd3; --theirs: #fff; --header: #f0f2f5; --badge: #25d366;
    --wallpaper: #efe7de; --warn: #b45309; --warn-bg: #fff4e5; --bad: #b42318;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0b141a; --panel: #111b21; --line: #222d34; --text: #e9edef; --muted: #8696a0;
      --mine: #005c4b; --theirs: #202c33; --header: #202c33; --wallpaper: #0b141a; --warn-bg: #3a2a10;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body { font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--text); background: var(--bg); overflow: hidden; }
  .app { display: grid; grid-template-columns: 300px 1fr; height: 100%; }
  .app.solo { grid-template-columns: 1fr; }
  .app.solo .lista { display: none; }
  .lista { border-right: 1px solid var(--line); background: var(--panel); display: flex; flex-direction: column; min-width: 0; }
  .lista .buscar { padding: 8px; border-bottom: 1px solid var(--line); }
  .lista input { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--text); font: inherit; }
  .lista .items { overflow-y: auto; flex: 1; }
  .item { display: flex; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--line); cursor: pointer; align-items: center; }
  .item:hover, .item.activo { background: var(--header); }
  .avatar { width: 38px; height: 38px; border-radius: 50%; background: var(--accent); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 600; flex: none; }
  .item .texto { min-width: 0; flex: 1; }
  .item .nombre { font-weight: 600; display: flex; justify-content: space-between; gap: 8px; }
  .item .nombre small { color: var(--muted); font-weight: normal; white-space: nowrap; }
  .item .ultimo { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px; display: flex; gap: 6px; align-items: center; }
  .badge { background: var(--badge); color: #fff; border-radius: 999px; font-size: 11px; padding: 1px 7px; font-weight: 600; margin-left: auto; }
  .hilo { display: flex; flex-direction: column; min-width: 0; height: 100%; background: var(--wallpaper); }
  .cabecera { background: var(--header); border-bottom: 1px solid var(--line); padding: 10px 14px; display: flex; align-items: center; gap: 10px; }
  .cabecera .quien { flex: 1; min-width: 0; }
  .cabecera .quien b { display: block; }
  .cabecera .quien small { color: var(--muted); }
  .mensajes { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 4px; }
  .burbuja { max-width: 78%; padding: 7px 10px; border-radius: 10px; background: var(--theirs); box-shadow: 0 1px 1px rgba(0,0,0,.08); white-space: pre-wrap; word-wrap: break-word; position: relative; }
  .burbuja.mia { align-self: flex-end; background: var(--mine); }
  .burbuja .meta { font-size: 11px; color: var(--muted); text-align: right; margin-top: 2px; }
  .burbuja .meta .check { margin-left: 4px; }
  .burbuja .meta .check.leido { color: #53bdeb; }
  .burbuja .meta .check.fallo { color: var(--bad); }
  .burbuja .tipo { color: var(--muted); font-style: italic; }
  .dia { align-self: center; background: var(--header); color: var(--muted); font-size: 12px; padding: 3px 10px; border-radius: 8px; margin: 8px 0; }
  .escribir { background: var(--header); border-top: 1px solid var(--line); padding: 8px 10px; }
  .escribir .fila { display: flex; gap: 8px; align-items: flex-end; }
  .escribir textarea { flex: 1; resize: none; min-height: 40px; max-height: 120px; padding: 9px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); color: var(--text); font: inherit; }
  .escribir select, .escribir input { padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); color: var(--text); font: inherit; }
  button { border: 0; border-radius: 10px; padding: 9px 14px; background: var(--accent); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  button.ghost { background: transparent; color: var(--accent); border: 1px solid var(--accent); }
  button:disabled { opacity: .5; cursor: default; }
  .aviso { background: var(--warn-bg); color: var(--warn); padding: 8px 12px; border-radius: 8px; margin-bottom: 8px; font-size: 13px; }
  .aviso.mal { color: var(--bad); }
  .plantilla { display: none; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; }
  .plantilla.visible { display: flex; }
  .vacio { margin: auto; color: var(--muted); text-align: center; padding: 20px; }
  .velo { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: none; align-items: center; justify-content: center; }
  .velo.visible { display: flex; }
  .velo .caja { background: var(--panel); padding: 20px 24px; border-radius: 12px; max-width: 360px; text-align: center; }
  @media (max-width: 640px) {
    .app { grid-template-columns: 1fr; }
    .app.en-hilo .lista { display: none; }
    .app:not(.en-hilo):not(.solo) .hilo { display: none; }
    .cabecera .volver { display: inline-block; }
  }
  .cabecera .volver { display: none; }
`;

export interface EmbedPageOpts {
  nombreNegocio: string;
  /** Si viene, la pantalla es de un solo hilo. */
  telefono: string | null;
}

export function embedChatPage(opts: EmbedPageOpts): string {
  const script = String.raw`
var TELEFONO_FIJO = ${JSON.stringify(opts.telefono)};
var token = new URLSearchParams(location.search).get('token') || null;
var actual = null;          // telefono del hilo abierto
var hilo = null;            // ultimo hilo recibido
var plantillas = null;
var fuente = null;          // EventSource
var refresco = null;
var app = document.getElementById('app');

function $(id) { return document.getElementById(id); }
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function hora(f) { var d = new Date(f); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function dia(f) { var d = new Date(f); return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }); }
function avisar(tipo, datos) { try { if (window.parent !== window) window.parent.postMessage(Object.assign({ tipo: tipo }, datos || {}), '*'); } catch (e) {} }

async function api(path, options) {
  options = options || {};
  var res = await fetch(path, {
    method: options.method || 'GET',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (res.status === 401) { tokenCaducado(); throw new Error('La sesión del chat caducó.'); }
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok && res.status !== 202) throw new Error(data.error || ('Error ' + res.status));
  return data;
}

function tokenCaducado() {
  $('velo').classList.add('visible');
  avisar('wa:token-caducado');
  if (fuente) { fuente.close(); fuente = null; }
}

// --- lista ---
async function cargarLista() {
  if (TELEFONO_FIJO) return;
  var q = $('buscar').value.trim();
  var r = await api('/api/v1/conversaciones?limite=100' + (q ? '&q=' + encodeURIComponent(q) : ''));
  var total = 0;
  $('items').innerHTML = r.conversaciones.length ? r.conversaciones.map(function (c) {
    total += c.noLeidos;
    var u = c.ultimoMensaje;
    return '<div class="item' + (c.telefono === actual ? ' activo' : '') + '" data-tel="' + esc(c.telefono) + '">' +
      '<div class="avatar">' + esc((c.nombre || c.telefono).slice(0, 1).toUpperCase()) + '</div>' +
      '<div class="texto"><div class="nombre"><span>' + esc(c.nombre || c.telefono) + '</span>' + (u ? '<small>' + esc(hora(u.fecha)) + '</small>' : '') + '</div>' +
      '<div class="ultimo">' + (u ? (u.direccion === 'saliente' ? '<span>↩</span>' : '') + esc(u.texto || u.tipo) : '<i>sin mensajes</i>') + (c.noLeidos ? '<span class="badge">' + c.noLeidos + '</span>' : '') + '</div></div></div>';
  }).join('') : '<div class="vacio">No hay conversaciones todavía.</div>';
  avisar('wa:no-leidos', { n: total });
  Array.prototype.forEach.call(document.querySelectorAll('.item'), function (el) {
    el.onclick = function () { abrir(el.getAttribute('data-tel')); };
  });
}

// --- hilo ---
async function abrir(tel, silencioso) {
  actual = tel;
  app.classList.add('en-hilo');
  try {
    hilo = await api('/api/v1/conversaciones/' + encodeURIComponent(tel) + '?limite=100');
  } catch (error) {
    if (error.message.indexOf('ningun contacto') >= 0 || error.message.indexOf('ningún contacto') >= 0) {
      // Todavia no se ha hablado con este numero: se abre vacio y el primer
      // mensaje lo crea.
      hilo = { contacto: { telefono: tel, nombre: null }, mensajes: [], puedeEscribir: false, motivo: 'todavía no hay conversación: el primer mensaje tiene que ser una plantilla (o texto libre si no usas la API de Meta)', ventanaAbierta: false, nuevo: true };
    } else { mostrarError(error.message); return; }
  }
  pintarHilo();
  if (!silencioso && !hilo.nuevo && hilo.mensajes.length) {
    api('/api/v1/conversaciones/' + encodeURIComponent(tel) + '/leido', { method: 'POST' }).then(cargarLista).catch(function () {});
  }
}

function pintarHilo() {
  var c = hilo.contacto;
  $('quien').innerHTML = '<b>' + esc(c.nombre || c.telefono) + '</b><small>' + esc(c.telefono) + (hilo.ventanaAbierta ? ' · ventana abierta' : '') + '</small>';
  var html = '', ultimoDia = null;
  hilo.mensajes.forEach(function (m) {
    var d = dia(m.fecha);
    if (d !== ultimoDia) { html += '<div class="dia">' + esc(d) + '</div>'; ultimoDia = d; }
    var cuerpo = m.texto ? esc(m.texto) : '<span class="tipo">' + esc(tipoLegible(m.tipo)) + '</span>';
    var check = '';
    if (m.direccion === 'saliente') {
      var s = m.estado;
      check = '<span class="check' + (s === 'read' ? ' leido' : s === 'failed' ? ' fallo' : '') + '">' + (s === 'failed' ? '✕' : s === 'read' || s === 'delivered' ? '✓✓' : '✓') + '</span>';
    }
    html += '<div class="burbuja' + (m.direccion === 'saliente' ? ' mia' : '') + '" data-id="' + esc(m.mensajeId || m.id) + '">' + cuerpo + '<div class="meta">' + esc(hora(m.fecha)) + check + '</div></div>';
  });
  $('mensajes').innerHTML = html || '<div class="vacio">Todavía no hay mensajes con este contacto.</div>';
  $('mensajes').scrollTop = $('mensajes').scrollHeight;
  pintarEscribir();
}

function tipoLegible(t) {
  return { location: '📍 ubicación', image: '🖼 imagen', audio: '🎤 audio', video: '🎞 video', document: '📄 documento', sticker: '🙂 sticker', template: '📋 plantilla', interactive: '🔘 botón' }[t] || t;
}

async function pintarEscribir() {
  var aviso = $('aviso');
  var conPlantilla = !hilo.puedeEscribir && !(hilo.contacto && hilo.contacto.baja);
  aviso.className = 'aviso' + (hilo.puedeEscribir ? ' oculto' : '') + (hilo.contacto && hilo.contacto.baja ? ' mal' : '');
  aviso.style.display = hilo.puedeEscribir ? 'none' : 'block';
  aviso.textContent = hilo.motivo || '';
  $('texto').disabled = !hilo.puedeEscribir;
  $('pedir').disabled = !hilo.puedeEscribir;
  $('texto').placeholder = hilo.puedeEscribir ? 'Escribe un mensaje' : 'Ahora mismo solo puede salir una plantilla';
  var caja = $('plantilla');
  caja.classList.toggle('visible', conPlantilla);
  if (conPlantilla && !plantillas) {
    try { plantillas = (await api('/api/v1/plantillas')).plantillas; } catch (e) { plantillas = []; }
    $('sel-plantilla').innerHTML = '<option value="">Elegir plantilla…</option>' + plantillas.map(function (p) { return '<option value="' + esc(p.nombre) + '">' + esc(p.nombre) + ' (' + esc(p.categoria) + ')</option>'; }).join('');
  }
}

$('sel-plantilla').onchange = function () {
  var p = (plantillas || []).filter(function (x) { return x.nombre === $('sel-plantilla').value; })[0];
  var vars = $('vars'); vars.innerHTML = '';
  if (!p) return;
  for (var i = 1; i <= (p.variables || 0); i++) {
    var inp = document.createElement('input'); inp.placeholder = 'Variable ' + i; inp.setAttribute('data-var', String(i)); vars.appendChild(inp);
  }
  $('vista').textContent = p.cuerpo || '';
};

async function enviar(cuerpo) {
  if (!actual) return;
  try {
    var r = await api('/api/v1/mensajes', { method: 'POST', body: Object.assign({ telefono: actual }, cuerpo) });
    if (r.ok) { avisar('wa:mensaje', { telefono: actual, direccion: 'saliente', mensajeId: r.mensajeId }); $('texto').value = ''; }
    else mostrarError(r.motivo || r.error || 'No salió');
    await abrir(actual, true);
    cargarLista();
  } catch (error) { mostrarError(error.message); }
}

function mostrarError(texto) {
  var e = $('error'); e.textContent = texto; e.style.display = 'block';
  clearTimeout(e._t); e._t = setTimeout(function () { e.style.display = 'none'; }, 6000);
}

$('enviar').onclick = function () {
  if ($('plantilla').classList.contains('visible')) {
    var nombre = $('sel-plantilla').value;
    if (!nombre) return mostrarError('Elige una plantilla.');
    var variables = Array.prototype.map.call(document.querySelectorAll('#vars input'), function (i) { return i.value; });
    return enviar({ plantilla: { nombre: nombre, variables: variables } });
  }
  var t = $('texto').value.trim();
  if (!t) return;
  enviar({ texto: t });
};
$('texto').onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('enviar').click(); } };
$('pedir').onclick = function () { enviar({ pedirUbicacion: true }); };
$('volver').onclick = function () { app.classList.remove('en-hilo'); };
$('buscar').oninput = function () { clearTimeout($('buscar')._t); $('buscar')._t = setTimeout(cargarLista, 250); };

// --- en vivo ---
function conectarEventos() {
  if (fuente || !window.EventSource || !token || token.indexOf('emb_') !== 0) return;
  fuente = new EventSource('/api/v1/eventos/stream?token=' + encodeURIComponent(token));
  var toca = function (ev) {
    var d; try { d = JSON.parse(ev.data); } catch (e) { return; }
    var tel = d && d.contacto && d.contacto.telefono;
    if (ev.type === 'mensaje.recibido') avisar('wa:mensaje', { telefono: tel, direccion: 'entrante', texto: d.mensaje && d.mensaje.texto });
    if (tel && tel === actual) abrir(actual, ev.type !== 'mensaje.recibido');
    cargarLista();
  };
  ['mensaje.recibido', 'mensaje.enviado', 'ubicacion.recibida', 'contacto.baja'].forEach(function (n) { fuente.addEventListener(n, toca); });
  fuente.addEventListener('mensaje.estado', function (ev) {
    var d; try { d = JSON.parse(ev.data); } catch (e) { return; }
    var b = document.querySelector('.burbuja[data-id="' + d.mensajeId + '"] .check');
    if (b) { b.textContent = d.estado === 'failed' ? '✕' : d.estado === 'read' || d.estado === 'delivered' ? '✓✓' : '✓'; b.className = 'check' + (d.estado === 'read' ? ' leido' : d.estado === 'failed' ? ' fallo' : ''); }
  });
  fuente.onerror = function () { /* el navegador reconecta solo; mientras, el refresco periodico cubre */ };
}

function arrancar() {
  $('velo').classList.remove('visible');
  if (TELEFONO_FIJO) abrir(TELEFONO_FIJO); else cargarLista();
  conectarEventos();
  clearInterval(refresco);
  refresco = setInterval(function () { if (!fuente || fuente.readyState !== 1) { cargarLista(); if (actual) abrir(actual, true); } }, 10000);
}

// El token llega de la web que embebe (embed.js) o viene en la URL.
window.addEventListener('message', function (ev) {
  if (ev.source !== window.parent || !ev.data || typeof ev.data !== 'object') return;
  if (ev.data.tipo === 'wa:token' && typeof ev.data.token === 'string') { token = ev.data.token; if (fuente) { fuente.close(); fuente = null; } arrancar(); }
  if (ev.data.tipo === 'wa:abrir' && typeof ev.data.telefono === 'string' && !TELEFONO_FIJO) abrir(ev.data.telefono);
});
if (TELEFONO_FIJO) app.classList.add('solo');
if (token) arrancar(); else $('velo').classList.add('visible');
avisar('wa:listo');
`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chat · ${escapeHtml(opts.nombreNegocio)}</title>
<style>${CSS}</style>
</head>
<body>
<div id="app" class="app">
  <aside class="lista">
    <div class="buscar"><input id="buscar" placeholder="Buscar por nombre o teléfono"></div>
    <div id="items" class="items"><div class="vacio">Cargando…</div></div>
  </aside>
  <section class="hilo">
    <div class="cabecera">
      <button class="ghost volver" id="volver">‹</button>
      <div id="quien" class="quien"><b>${escapeHtml(opts.nombreNegocio)}</b><small>elige una conversación</small></div>
    </div>
    <div id="mensajes" class="mensajes"><div class="vacio">Elige una conversación para verla aquí.</div></div>
    <div class="escribir">
      <div id="error" class="aviso mal" style="display:none"></div>
      <div id="aviso" class="aviso" style="display:none"></div>
      <div id="plantilla" class="plantilla">
        <select id="sel-plantilla"></select>
        <span id="vars"></span>
        <small id="vista" style="width:100%;color:var(--muted)"></small>
      </div>
      <div class="fila">
        <button class="ghost" id="pedir" title="Pedir la ubicación al cliente" disabled>📍</button>
        <textarea id="texto" rows="1" placeholder="Escribe un mensaje" disabled></textarea>
        <button id="enviar">Enviar</button>
      </div>
    </div>
  </section>
</div>
<div id="velo" class="velo"><div class="caja"><b>La sesión del chat caducó o no llegó.</b><br><small>La web que muestra este chat tiene que entregar un token nuevo.</small></div></div>
<script>${script}</script>
</body>
</html>`;
}

function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
