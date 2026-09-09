/**
 * Pantalla de chat: se ve y se usa como WhatsApp.
 *
 * Lista de conversaciones a la izquierda, hilo a la derecha, burbujas verdes
 * para lo que sale y blancas para lo que entra, con su hora y su doble check.
 * El panel con pestanas sigue existiendo para operar (campanas, plantillas,
 * automatizacion); esto es para hablar con la gente.
 *
 * Se refresca sola cada pocos segundos en vez de abrir un WebSocket: el
 * volumen de un chat de atencion no lo justifica y asi sobrevive a cualquier
 * proxy sin configuracion extra.
 *
 * Nota: el JS va en String.raw y usa concatenacion, como el resto de paginas.
 */

const CSS = `
  :root {
    color-scheme: light dark;
    --bg: #eae6df; --panel: #fff; --line: #e3e5e9; --text: #111b21;
    --muted: #667781; --accent: #128c7e; --mine: #d9fdd3; --theirs: #fff;
    --header: #f0f2f5; --badge: #25d366;
    --wallpaper: #efe7de; --wallpaper-dot: rgba(0,0,0,.035);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0b141a; --panel: #111b21; --line: #222d34; --text: #e9edef;
      --muted: #8696a0; --mine: #005c4b; --theirs: #202c33; --header: #202c33;
      --wallpaper: #0b141a; --wallpaper-dot: rgba(255,255,255,.03);
    }
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  .app { display: grid; grid-template-columns: 340px 1fr; height: 100vh; }
  .side { background: var(--panel); border-right: 1px solid var(--line); display: flex; flex-direction: column; min-width: 0; }
  .side header, .thread header {
    background: var(--header); padding: 10px 14px; display: flex; align-items: center; gap: 10px;
    border-bottom: 1px solid var(--line); min-height: 58px;
  }
  .side header h1 { font-size: 17px; margin: 0; flex: 1; }
  .search { padding: 8px 12px; border-bottom: 1px solid var(--line); }
  .search input { width: 100%; padding: 8px 12px; border: 0; border-radius: 8px;
    background: var(--bg); color: var(--text); font: inherit; font-size: 14px; }
  .chats { flex: 1; overflow-y: auto; }
  .chat {
    display: flex; gap: 13px; padding: 10px 14px; cursor: pointer;
    border-bottom: 1px solid var(--line); transition: background .12s;
  }
  .chat:hover { background: var(--header); }
  .chat.active { background: var(--header); box-shadow: inset 4px 0 0 var(--accent); }
  .chat.active .name { color: var(--accent); }
  .avatar { width: 46px; height: 46px; border-radius: 50%; background: var(--accent); color: #fff; flex: none;
    display: grid; place-items: center; font-weight: 600; font-size: 17px; }
  /* Un color por contacto: con todos del mismo verde la lista es un muro. */
  .avatar.c0 { background: #6bcbef; } .avatar.c1 { background: #e542a3; }
  .avatar.c2 { background: #f2a63c; } .avatar.c3 { background: #7a7dd8; }
  .avatar.c4 { background: #26a69a; } .avatar.c5 { background: #ef6b6b; }
  .avatar.c6 { background: #8bc34a; } .avatar.c7 { background: #a1887f; }
  .chat .body { flex: 1; min-width: 0; }
  .chat .top { display: flex; align-items: baseline; gap: 8px; }
  .chat .name { font-weight: 600; font-size: 15px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chat .when { font-size: 11.5px; color: var(--muted); flex: none; }
  .chat .last { font-size: 13.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
  .badge { background: var(--badge); color: #06251a; border-radius: 999px; font-size: 11.5px;
    font-weight: 700; padding: 1px 7px; margin-left: 6px; }
  .thread { display: flex; flex-direction: column; min-width: 0; background: var(--bg); }
  .thread header .name { font-weight: 600; }
  .thread header .sub { font-size: 12.5px; color: var(--muted); }
  .messages {
    flex: 1; overflow-y: auto; padding: 14px 6%; display: flex; flex-direction: column; gap: 2px;
    background-color: var(--wallpaper);
    background-image:
      radial-gradient(circle at 20% 30%, var(--wallpaper-dot) 1px, transparent 1px),
      radial-gradient(circle at 70% 65%, var(--wallpaper-dot) 1px, transparent 1px);
    background-size: 42px 42px, 58px 58px;
  }
  /* La barra de scroll del hilo, discreta como la del cliente de escritorio. */
  .messages::-webkit-scrollbar, .chats::-webkit-scrollbar { width: 7px; }
  .messages::-webkit-scrollbar-thumb, .chats::-webkit-scrollbar-thumb {
    background: rgba(0,0,0,.18); border-radius: 4px;
  }
  .messages::-webkit-scrollbar-track, .chats::-webkit-scrollbar-track { background: transparent; }
  .msg {
    max-width: min(65%, 520px); padding: 6px 9px 8px; border-radius: 7.5px; position: relative;
    box-shadow: 0 1px 0.5px rgba(0,0,0,.13); white-space: pre-wrap; word-wrap: break-word;
    font-size: 14.2px; line-height: 1.4;
  }
  .msg.out { align-self: flex-end; background: var(--mine); }
  .msg.in { align-self: flex-start; background: var(--theirs); }

  /* Mensajes seguidos del mismo lado: se juntan y solo el primero lleva pico,
     que es como los agrupa WhatsApp y lo que hace legible una rafaga. */
  .msg + .msg.out, .msg + .msg.in { margin-top: 1px; }
  .msg.primero { margin-top: 10px; }
  .msg.primero.out { border-top-right-radius: 0; }
  .msg.primero.in { border-top-left-radius: 0; }
  .msg.primero::before {
    content: ''; position: absolute; top: 0; width: 8px; height: 13px;
  }
  .msg.primero.out::before {
    right: -8px;
    background: var(--mine);
    clip-path: polygon(0 0, 100% 0, 0 100%);
  }
  .msg.primero.in::before {
    left: -8px;
    background: var(--theirs);
    clip-path: polygon(0 0, 100% 0, 100% 100%);
  }
  .msg .meta {
    float: right; margin: 8px -2px -4px 10px; font-size: 11px; color: var(--muted);
    white-space: nowrap; position: relative; top: 3px;
  }
  .msg .tick { color: var(--muted); }
  .msg .tick.read { color: #53bdeb; }
  .msg a { color: var(--accent); }
  /* Los adjuntos mandan sobre el ancho de la burbuja, pero sin desbordarla. */
  .msg .adjunto { display: block; margin: 2px 0 4px; max-width: 100%; }
  .msg img.adjunto, .msg video.adjunto { border-radius: 6px; cursor: pointer; max-height: 340px; }
  .msg audio.adjunto { width: 260px; }
  .msg .fichero { display: flex; align-items: center; gap: 8px; padding: 8px 10px;
                  background: rgba(0,0,0,.05); border-radius: 6px; text-decoration: none;
                  color: inherit; }
  .msg .fichero b { font-weight: 600; }
  .msg .cargando { color: var(--muted); font-size: 12px; }
  /* Ver una foto a tamaño completo sin salir de la pantalla. */
  .visor { position: fixed; inset: 0; background: rgba(0,0,0,.85); display: flex;
           align-items: center; justify-content: center; z-index: 50; cursor: zoom-out; }
  .visor img, .visor video { max-width: 92vw; max-height: 92vh; border-radius: 6px; }
  .day {
    align-self: center; background: var(--panel); color: var(--muted); font-size: 12.5px;
    padding: 5px 12px; border-radius: 8px; margin: 14px 0 8px; position: sticky; top: 4px;
    z-index: 2; box-shadow: 0 1px 1px rgba(0,0,0,.1); text-transform: uppercase;
    letter-spacing: .3px; font-weight: 500;
  }
  .composer { background: var(--header); padding: 9px 16px; border-top: 1px solid var(--line);
    display: flex; gap: 10px; align-items: flex-end; }
  .composer textarea {
    flex: 1; resize: none; border: 0; border-radius: 22px; padding: 11px 16px;
    background: var(--panel); color: var(--text); font: inherit; font-size: 14.5px;
    max-height: 120px; outline: none;
  }
  .composer textarea:focus { box-shadow: 0 0 0 1px var(--line); }
  .composer button { border: 0; border-radius: 50%; width: 44px; height: 44px; background: var(--accent);
    color: #fff; cursor: pointer; font-size: 17px; flex: none; }
  .composer button.ghost { background: transparent; color: var(--muted); font-size: 19px; }
  .composer button:disabled { opacity: .45; cursor: default; }
  .locked { background: var(--header); border-top: 1px solid var(--line); padding: 14px;
    color: var(--muted); font-size: 13.5px; text-align: center; }
  .locked b { color: var(--text); }
  .locked .actions { margin-top: 10px; display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
  .locked select, .locked button, .tools button, .tools input {
    font: inherit; font-size: 13px; padding: 7px 12px; border-radius: 8px;
    border: 1px solid var(--line); background: var(--panel); color: var(--text); cursor: pointer;
  }
  .locked button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
  .tools { display: flex; gap: 8px; padding: 8px 14px 0; flex-wrap: wrap; background: var(--header); }
  .tools input { cursor: text; flex: 1; min-width: 180px; }
  .empty { flex: 1; display: grid; place-items: center; color: var(--muted); text-align: center; padding: 40px; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 600; }
  .pill.ok { background: rgba(37,211,102,.18); color: #128c7e; }
  .pill.bad { background: rgba(220,38,38,.16); color: #dc2626; }
  .pill.warn { background: rgba(217,119,6,.16); color: #d97706; }
  .link { color: var(--accent); text-decoration: none; font-size: 13px; }
  .icon { background: none; border: 0; color: var(--muted); cursor: pointer; font-size: 18px; padding: 4px 6px; }
  .hidden { display: none !important; }
  .toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: 26px; z-index: 50;
    background: #111b21; color: #fff; padding: 10px 18px; border-radius: 10px; font-size: 13.5px;
    box-shadow: 0 8px 30px rgba(0,0,0,.3); max-width: 80vw; }
  @media (max-width: 820px) {
    .app { grid-template-columns: 1fr; }
    .side { display: none; }
    .app.open-thread .side { display: none; }
    .app:not(.open-thread) .thread { display: none; }
    .app:not(.open-thread) .side { display: flex; }
    .messages { padding: 14px 12px; }
  }
`;

import { seedTokenJs } from './pages.js';

export function chatPage(configured: boolean, adminToken = ''): string {
  const aviso = configured
    ? ''
    : `<div class="locked" style="border-top:0;border-bottom:1px solid var(--line)">
         Todavia no conectaste tu WhatsApp: aqui veras las conversaciones, pero no saldra ningun mensaje.
         <div class="actions"><a class="link" href="/setup">Conectar mi WhatsApp</a></div>
       </div>`;

  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chat - wa-locator</title>
<style>${CSS}</style>
</head><body>
<div class="app" id="app">
  <div class="side">
    <header>
      <h1>Chats</h1>
      <span id="unread" class="badge hidden"></span>
      <button class="icon" id="new" title="Escribir a un numero nuevo">✚</button>
      <a class="link" href="/panel" title="Panel de operacion">Panel</a>
    </header>
    ${aviso}
    <div class="search"><input id="q" placeholder="Buscar por nombre o numero" autocomplete="off"></div>
    <div class="chats" id="chats"></div>
  </div>

  <div class="thread">
    <header id="thread-head" class="hidden">
      <button class="icon" id="back" title="Volver">‹</button>
      <div class="avatar" id="t-avatar"></div>
      <div style="flex:1;min-width:0">
        <div class="name" id="t-name"></div>
        <div class="sub" id="t-sub"></div>
      </div>
      <a class="link" id="t-panel" href="/panel#contactos">Ficha</a>
    </header>
    <div class="empty" id="placeholder">
      <div>
        <div style="font-size:44px">💬</div>
        <p>Elige una conversacion para empezar.<br>
        Los mensajes que te escriban apareceran aqui solos.</p>
      </div>
    </div>
    <div class="messages hidden" id="messages"></div>
    <div class="tools hidden" id="tools">
      <input id="loc" placeholder="Pega un link de mapa o coordenadas para mandar el pin">
      <button id="send-loc">Mandar pin</button>
      <button id="ask-loc">Pedir su ubicacion</button>
    </div>
    <div class="composer hidden" id="composer">
      <textarea id="text" rows="1" placeholder="Escribe un mensaje"></textarea>
      <button id="send" title="Enviar">➤</button>
    </div>
    <div class="locked hidden" id="locked"></div>
  </div>
</div>

<script>
${seedTokenJs(adminToken)}${String.raw`
function token() {
  var t = sessionStorage.getItem('adminToken');
  if (!t) { t = prompt('Token de administracion (aparece en la consola al arrancar):'); if (t) sessionStorage.setItem('adminToken', t.trim()); }
  return t || '';
}
async function api(path, options) {
  options = options || {};
  var res = await fetch(path, {
    method: options.method || 'GET',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token() },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (res.status === 401) { sessionStorage.removeItem('adminToken'); throw new Error('Token de administracion incorrecto: recarga la pagina'); }
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/* Los links se pintan pulsables, como en WhatsApp. */
function withLinks(text) {
  return esc(text).replace(/(https?:\/\/[^\s<]+)/g, function (u) {
    return '<a href="' + u + '" target="_blank" rel="noreferrer">' + u + '</a>';
  });
}
function hhmm(iso) {
  var d = new Date(iso);
  return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}
function dayLabel(iso) {
  var d = new Date(iso), hoy = new Date();
  var ayer = new Date(); ayer.setDate(hoy.getDate() - 1);
  if (d.toDateString() === hoy.toDateString()) return 'HOY';
  if (d.toDateString() === ayer.toDateString()) return 'AYER';
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
}
function shortWhen(iso) {
  if (!iso) return '';
  var d = new Date(iso), hoy = new Date();
  if (d.toDateString() === hoy.toDateString()) return hhmm(iso);
  var ayer = new Date(); ayer.setDate(hoy.getDate() - 1);
  if (d.toDateString() === ayer.toDateString()) return 'ayer';
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function inicial(nombre, tel) {
  var s = (nombre || '').trim();
  if (s) return s[0].toUpperCase();
  return (tel || '?').slice(-2, -1) || '#';
}
function tick(status) {
  if (status === 'read') return '<span class="tick read">✓✓</span>';
  if (status === 'delivered') return '<span class="tick">✓✓</span>';
  if (status === 'sent') return '<span class="tick">✓</span>';
  if (status === 'failed') return '<span class="tick" title="no se pudo entregar">⚠</span>';
  return '';
}
/* Mostrar y ocultar sin reventar si el nodo ya no existe: el hilo se
   repinta entero y un getElementById de algo borrado devuelve null. */
function ver(id, visible) {
  var el = document.getElementById(id);
  if (el) el.classList.toggle('hidden', !visible);
}
function toast(text) {
  var el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(function () { el.remove(); }, 4200);
}

var current = null;      /* contacto abierto */
/* Cual quiere ver el usuario, y en que numero de peticion vamos.
   El refresco automatico corre cada pocos segundos: sin estos dos guardas,
   una respuesta suya pedida ANTES del ultimo envio llegaba despues y volvia
   a pintar el hilo sin el mensaje que acababas de mandar. */
var deseado = null;
var peticion = 0;      /* numero de la ultima peticion lanzada */
var pintado = 0;       /* numero de la ultima que llego a pintarse */
var conversations = [];
var templates = [];
var lastCount = 0;

async function loadChats(keepScroll) {
  try {
    var data = await api('/admin/chat/conversations?limit=100&q=' + encodeURIComponent(document.getElementById('q').value.trim()));
    conversations = data.items;
    var badge = document.getElementById('unread');
    if (data.unread) { badge.textContent = data.unread; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');

    var box = document.getElementById('chats');
    var top = box.scrollTop;
    if (!conversations.length) {
      pintarLista(box, '<div class="empty">Todavia no hay conversaciones.<br>En cuanto alguien te escriba, aparece aqui.</div>', top);
      return;
    }
    var html = conversations.map(function (c) {
      var last = c.lastMessage;
      var prefijo = last && last.direction === 'out' ? tick(last.status) + ' ' : '';
      var texto = last ? (last.body || '') : 'Sin mensajes todavia';
      return '<div class="chat' + (current && current.id === c.contactId ? ' active' : '') + '" data-id="' + esc(c.contactId) + '">' +
        '<div class="avatar ' + colorDe(c.phone) + '">' + esc(inicial(c.name, c.phone)) + '</div>' +
        '<div class="body"><div class="top">' +
          '<span class="name">' + esc(c.name || c.phone) + '</span>' +
          '<span class="when">' + esc(shortWhen(last ? last.createdAt : c.lastInboundAt)) + '</span>' +
        '</div><div class="last">' + prefijo + esc(texto.slice(0, 70)) +
          (c.unread ? '<span class="badge">' + c.unread + '</span>' : '') +
        '</div></div></div>';
    }).join('');

    pintarLista(box, html, keepScroll ? top : 0);
  } catch (error) { toast(error.message); }
}

/* Solo se repinta si de verdad cambio algo.
   Antes se reescribia la lista entera cada 5 segundos, y un clic que caia
   justo en ese instante se perdia: el nodo pulsado ya no existia. */
function pintarLista(box, html, scrollTop) {
  if (box.innerHTML === html) return;
  box.innerHTML = html;
  box.scrollTop = scrollTop;
}

async function openChat(contactId, silent) {
  if (!contactId) return;
  if (!silent) deseado = contactId;
  var mia = ++peticion;
  try {
    var data = await api('/admin/chat/' + contactId + '?limit=80&read=' + (silent ? 'false' : 'true'));
    /* Dos guardas, en este orden:
       - el usuario ya abrio otro chat: esta respuesta es de otro hilo;
       - ya se pinto algo mas nuevo de ESTE hilo: pintar lo viejo encima
         borraria el mensaje que se acaba de mandar. */
    if (deseado && deseado !== contactId) return;
    if (mia < pintado) return;
    pintado = mia;
    var nuevo = !current || current.id !== contactId;
    current = data.contact;
    document.getElementById('app').classList.add('open-thread');
    ver('thread-head', true);
    ver('placeholder', false);
    ver('messages', true);
    document.getElementById('t-avatar').textContent = inicial(current.name, current.phone);
    document.getElementById('t-name').textContent = current.name || current.phone;
    document.getElementById('t-sub').innerHTML = esc(current.phone) + ' · ' +
      (current.optOutAt ? '<span class="pill bad">dado de baja</span>'
        : data.windowOpen ? '<span class="pill ok">puede recibir mensajes</span>'
        : '<span class="pill warn">fuera de las 24 h</span>');

    renderMessages(data.messages, nuevo);
    renderComposer(data);
    if (!silent) loadChats(true);
  } catch (error) { toast(error.message); }
}

function renderMessages(messages, scrollToEnd) {
  var box = document.getElementById('messages');
  var cerca = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  if (!messages.length) {
    var vacio = '<div class="empty">Sin mensajes con este contacto todavia.<br>Escribele tu, si su ventana esta abierta.</div>';
    if (box.innerHTML !== vacio) box.innerHTML = vacio;
    lastCount = 0;
    return;
  }
  var html = '', dia = '', diaPrevio = '';
  messages.forEach(function (m, i) {
    var d = dayLabel(m.createdAt);
    if (d !== dia) { dia = d; html += '<div class="day">' + esc(d) + '</div>'; }
    // El primero de cada bloque lleva pico; los siguientes se pegan a el.
    var primero = i === 0 || messages[i - 1].direction !== m.direction || d !== diaPrevio;
    diaPrevio = d;
    html += '<div class="msg ' + (m.direction === 'out' ? 'out' : 'in') +
      (primero ? ' primero' : '') + '">' +
      adjuntoHtml(m) +
      withLinks(m.body || '') +
      '<span class="meta">' + esc(hhmm(m.createdAt)) + ' ' + (m.direction === 'out' ? tick(m.status) : '') + '</span>' +
      '</div>';
  });
  if (box.innerHTML !== html) box.innerHTML = html;
  void cargarMedios(box);
  if (scrollToEnd || cerca || messages.length !== lastCount) box.scrollTop = box.scrollHeight;
  lastCount = messages.length;
}

/**
 * El hueco del adjunto.
 *
 * Se pinta vacio y con su id: el fichero se pide despues, porque va detras del
 * token de administracion y una etiqueta <img> no manda cabeceras.
 */
function adjuntoHtml(m) {
  var media = m.payload && m.payload.media;
  if (!media || !media.id) return '';

  var kind = media.kind || m.kind;
  var attrs = ' class="adjunto" data-media="' + esc(media.id) + '" data-kind="' + esc(kind) + '"';

  if (kind === 'image' || kind === 'sticker') return '<img' + attrs + ' alt="">';
  if (kind === 'video') return '<video' + attrs + ' controls playsinline></video>';
  if (kind === 'audio') return '<audio' + attrs + ' controls preload="none"></audio>';

  var nombre = media.filename || 'documento';
  return '<a' + attrs + ' class="adjunto fichero" download="' + esc(nombre) + '">' +
    '<span>📄</span><b>' + esc(nombre) + '</b>' +
    (media.bytes ? '<span class="cargando">' + esc(pesoLegible(media.bytes)) + '</span>' : '') +
    '</a>';
}

function pesoLegible(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/* Un adjunto ya bajado no cambia nunca -su id sale del wamid-, asi que se
   guarda la URL y no se vuelve a pedir en cada repintado del hilo. */
var mediaCache = {};

/**
 * Rellena los huecos de adjunto que haya en pantalla.
 *
 * Se pide con fetch y no con <img src>, porque asi el token viaja en la
 * cabecera y no en la URL, que acabaria en el historial y en los logs.
 */
async function cargarMedios(box) {
  var pendientes = box.querySelectorAll('[data-media]:not([data-listo])');
  for (var i = 0; i < pendientes.length; i++) {
    var el = pendientes[i];
    var id = el.getAttribute('data-media');
    el.setAttribute('data-listo', '1');

    try {
      if (!mediaCache[id]) {
        var res = await fetch('/admin/local/media/' + encodeURIComponent(id), {
          headers: { authorization: 'Bearer ' + token() }
        });
        if (!res.ok) throw new Error('no se pudo cargar');
        mediaCache[id] = URL.createObjectURL(await res.blob());
      }
      if (el.tagName === 'A') el.setAttribute('href', mediaCache[id]);
      else el.setAttribute('src', mediaCache[id]);
    } catch (error) {
      el.removeAttribute('data-listo');
      if (el.tagName !== 'A') el.replaceWith(cargaFallida());
    }
  }
}

function cargaFallida() {
  var aviso = document.createElement('div');
  aviso.className = 'cargando';
  aviso.textContent = 'No se pudo cargar el adjunto.';
  return aviso;
}

/* Clic en una foto o un video: se ve a tamaño completo. */
document.addEventListener('click', function (e) {
  var el = e.target;
  if (!el || !el.getAttribute || !el.getAttribute('data-media')) return;
  if (el.tagName !== 'IMG' && el.tagName !== 'VIDEO') return;

  var visor = document.createElement('div');
  visor.className = 'visor';
  var copia = el.cloneNode(true);
  copia.removeAttribute('data-media');
  if (copia.tagName === 'VIDEO') copia.setAttribute('controls', '');
  visor.appendChild(copia);
  visor.onclick = function () { visor.remove(); };
  document.body.appendChild(visor);
});

document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  var visor = document.querySelector('.visor');
  if (visor) visor.remove();
});

/**
 * El color del avatar, derivado del telefono.
 *
 * Que sea derivado y no aleatorio importa: el mismo contacto tiene que salir
 * del mismo color en cada recarga, o la lista deja de reconocerse de un
 * vistazo.
 */
function colorDe(phone) {
  var suma = 0;
  for (var i = 0; i < (phone || '').length; i++) suma += phone.charCodeAt(i);
  return 'c' + (suma % 8);
}

function renderComposer(data) {
  var composer = document.getElementById('composer');
  var tools = document.getElementById('tools');
  var locked = document.getElementById('locked');

  if (!composer || !tools || !locked) return;

  if (data.canWrite) {
    composer.classList.remove('hidden');
    tools.classList.remove('hidden');
    locked.classList.add('hidden');
    return;
  }

  composer.classList.add('hidden');
  tools.classList.add('hidden');
  locked.classList.remove('hidden');

  if (data.contact.optOutAt) {
    locked.innerHTML = '<b>Este contacto se dio de baja.</b><br>No se le puede escribir: una baja ignorada se convierte en bloqueo, y el bloqueo si castiga la calidad del numero.';
    return;
  }

  var aprobadas = templates.filter(function (t) { return t.status === 'APPROVED'; });
  locked.innerHTML = '<b>Pasaron mas de 24 horas desde su ultimo mensaje.</b><br>' +
    'WhatsApp solo deja retomar la conversacion con una plantilla aprobada. En cuanto conteste, puedes escribirle libre otra vez.' +
    '<div class="actions">' +
      (aprobadas.length
        ? '<select id="tpl">' + aprobadas.map(function (t) {
            return '<option value="' + esc(t.name + '|' + t.language) + '" data-vars="' + t.variables + '">' +
              esc(t.name + ' (' + t.variables + ' variables)') + '</option>';
          }).join('') + '</select>' +
          '<input id="tpl-vars" placeholder="Variables separadas por coma">' +
          '<button class="primary" id="send-tpl">Enviar plantilla</button>'
        : '<span>No tienes ninguna plantilla aprobada todavia. <a class="link" href="/panel#plantillas">Darlas de alta</a></span>') +
    '</div>';

  var boton = document.getElementById('send-tpl');
  if (boton) boton.onclick = enviarPlantilla;
}

async function enviarPlantilla() {
  var sel = document.getElementById('tpl');
  var partes = sel.value.split('|');
  var vars = document.getElementById('tpl-vars').value.split(',').map(function (v) { return v.trim(); }).filter(Boolean);
  await enviar({ templateName: partes[0], templateLanguage: partes[1], variables: vars });
}

async function enviar(payload) {
  if (!current) return;
  try {
    payload.contactId = current.id;
    var r = await api('/admin/chat/send', { method: 'POST', body: payload });
    if (r.ok === false) {
      toast('No salio: ' + (r.reason || r.error || 'bloqueado por las guardas'));
    }
    await openChat(current.id, true);
    loadChats(true);
  } catch (error) { toast(error.message); }
}

var input = document.getElementById('text');
input.addEventListener('input', function () {
  input.style.height = 'auto';
  input.style.height = Math.min(120, input.scrollHeight) + 'px';
});
input.addEventListener('keydown', function (e) {
  /* Enter manda; Shift+Enter hace salto de linea, como en WhatsApp Web. */
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); mandarTexto(); }
});
async function mandarTexto() {
  var texto = input.value.trim();
  if (!texto) return;
  input.value = '';
  input.style.height = 'auto';
  await enviar({ text: texto });
}
document.getElementById('send').onclick = mandarTexto;

document.getElementById('send-loc').onclick = async function () {
  var v = document.getElementById('loc').value.trim();
  if (!v) return toast('Pega primero un link de mapa o unas coordenadas.');
  document.getElementById('loc').value = '';
  await enviar({ location: v });
};
document.getElementById('ask-loc').onclick = function () { enviar({ askLocation: true }); };

document.getElementById('back').onclick = function () {
  document.getElementById('app').classList.remove('open-thread');
};
document.getElementById('new').onclick = async function () {
  var tel = prompt('Numero con codigo de pais, sin + ni espacios:');
  if (!tel) return;
  try {
    var r = await api('/admin/chat/start', { method: 'POST', body: { phone: tel } });
    await loadChats();
    openChat(r.contact.id);
  } catch (error) { toast(error.message); }
};

/* El clic se escucha en el contenedor: asi sigue funcionando aunque la fila
   se haya vuelto a pintar entre que la pulsas y la sueltas. */
document.getElementById('chats').addEventListener('click', function (event) {
  var fila = event.target.closest('.chat');
  if (fila) openChat(fila.getAttribute('data-id'));
});

var buscando;
document.getElementById('q').addEventListener('input', function () {
  clearTimeout(buscando);
  buscando = setTimeout(function () { loadChats(); }, 250);
});

async function loadTemplates() {
  try { templates = await api('/admin/templates'); } catch (error) { templates = []; }
}

/* Refresco: la lista siempre, el hilo abierto sin marcarlo como leido de
   nuevo para no pisar el contador mientras se lee. */
setInterval(function () {
  loadChats(true);
  if (deseado) openChat(deseado, true);
}, 5000);

loadTemplates();
loadChats();
`}
</script>
</body></html>`;
}
