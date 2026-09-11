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
  /* El alto lo da el armazon (s-content lleno): la banda de demo y el aviso
     de conexion van encima y el chat se queda con el resto. */
  .app { display: grid; grid-template-columns: 340px 1fr; flex: 1; min-height: 0; overflow: hidden;
    background: var(--bg); color: var(--text); font: 15px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  .demo {
    background: #d97706; color: #fff; padding: 9px 14px; font-size: 13.5px;
    text-align: center; line-height: 1.35;
  }
  .demo a { color: #fff; text-decoration: underline; }
  /* WhatsApp desconectado: lo que se escriba no sale. Se avisa arriba del
     todo, porque descubrirlo al pulsar enviar es descubrirlo tarde. */
  .aviso-conexion {
    background: #dc2626; color: #fff; padding: 9px 14px; font-size: 13.5px;
    text-align: center; line-height: 1.35;
  }
  .aviso-conexion a { color: #fff; text-decoration: underline; }
  .demo, .aviso-conexion { flex: none; }
  .side {
    background: var(--panel); border-right: 1px solid var(--line);
    display: flex; flex-direction: column; min-width: 0; min-height: 0;
  }
  .side header, .thread header {
    background: var(--header); padding: 10px 14px; display: flex; align-items: center; gap: 10px;
    border-bottom: 1px solid var(--line); min-height: 58px; flex: none;
  }
  .side header h1 { font-size: 17px; margin: 0; flex: 1; }
  .search { padding: 8px 12px; border-bottom: 1px solid var(--line); }
  .filtros { display: flex; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--line); overflow-x: auto; scrollbar-width: none; }
  .filtros .f { flex: none; padding: 5px 11px; border-radius: 999px; border: 1px solid var(--line); background: transparent; color: var(--muted); font: inherit; font-size: 12.5px; cursor: pointer; white-space: nowrap; }
  .filtros .f.activo { background: var(--accent); border-color: var(--accent); color: #fff; }
  .search input { width: 100%; padding: 8px 12px; border: 0; border-radius: 8px;
    background: var(--bg); color: var(--text); font: inherit; font-size: 14px; }
  .chats { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
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
  /* min-height: 0 es lo que deja que el hilo se encoja y sea .messages quien
     haga scroll, en vez de estirar la pagina entera. */
  .thread { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--bg); }
  .thread header .name { font-weight: 600; }
  .thread header .sub { font-size: 12.5px; color: var(--muted); }
  .messages {
    flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
    padding: 14px 6%; display: flex; flex-direction: column; gap: 2px;
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
  .msg.pendiente { opacity: .7; }
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
    display: flex; gap: 10px; align-items: flex-end; flex: none; }
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
    color: var(--muted); font-size: 13.5px; text-align: center; flex: none; }
  .locked b { color: var(--text); }
  .locked .actions { margin-top: 10px; display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
  .locked select, .locked button, .tools button, .tools input {
    font: inherit; font-size: 13px; padding: 7px 12px; border-radius: 8px;
    border: 1px solid var(--line); background: var(--panel); color: var(--text); cursor: pointer;
  }
  .locked button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
  /* La fila de herramientas ocupa sitio en una pantalla ya justa: se pliega y
     solo se abre cuando hace falta mandar un pin. */
  .atajos { background: var(--panel); border-top: 1px solid var(--line); max-height: 260px; overflow: auto; flex: none; box-shadow: 0 -8px 24px rgba(0,0,0,.08); }
  .atajos .op { display: flex; gap: 12px; align-items: baseline; padding: 9px 16px; cursor: pointer; border-bottom: 1px solid var(--line); font-size: 13.5px; }
  .atajos .op:last-child { border-bottom: 0; }
  .atajos .op.sel, .atajos .op:hover { background: var(--header); }
  .atajos .op b { font-family: ui-monospace, Consolas, monospace; color: var(--accent); flex: none; min-width: 90px; }
  .atajos .op span { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .atajos .pie { padding: 6px 16px; font-size: 12px; color: var(--muted); }
  .stickers-popup { background: var(--panel); border-top: 1px solid var(--line); padding: 10px 14px; display: flex; gap: 10px; flex-wrap: wrap; max-height: 220px; overflow: auto; flex: none; box-shadow: 0 -8px 24px rgba(0,0,0,.08); }
  .stickers-popup img { width: 84px; height: 84px; object-fit: contain; border-radius: 10px; cursor: pointer; border: 1px solid transparent; background: var(--header); }
  .stickers-popup img:hover { border-color: var(--accent); }
  .stickers-popup .pie { width: 100%; font-size: 12px; color: var(--muted); }
  .msg img.sticker { width: 150px; height: 150px; object-fit: contain; display: block; background: transparent; }
  .msg.solo-sticker { background: transparent; box-shadow: none; padding: 2px; }
  .ayuda-teclas { position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 60; display: grid; place-items: center; padding: 20px; }
  .ayuda-teclas .caja { background: var(--panel); color: var(--text); border-radius: 14px; padding: 20px 22px; max-width: 520px; width: 100%; box-shadow: 0 20px 60px rgba(0,0,0,.3); }
  .ayuda-teclas h3 { margin: 0 0 10px; font-size: 16px; }
  .ayuda-teclas table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .ayuda-teclas td { padding: 6px 4px; border-bottom: 1px solid var(--line); }
  .ayuda-teclas kbd { font: 600 12px ui-monospace, Consolas, monospace; background: var(--header); border: 1px solid var(--line); border-radius: 5px; padding: 2px 6px; white-space: nowrap; }
  .rapidas-barra { display: flex; gap: 8px; padding: 8px 14px 0; background: var(--header); flex: none; overflow-x: auto; scrollbar-width: thin; }
  .rapidas-barra .chip { flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel); color: var(--text); font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; white-space: nowrap; }
  .rapidas-barra .chip:hover { border-color: var(--accent); color: var(--accent); }
  .rapidas-barra .chip.accion { background: rgba(18,140,126,.10); border-color: rgba(18,140,126,.35); color: var(--accent); font-weight: 600; }
  .rapidas-barra .chip.editar { color: var(--muted); border-style: dashed; }
  .rapidas-barra.ocupada .chip { opacity: .5; pointer-events: none; }
  .tools { display: flex; gap: 8px; padding: 8px 14px 0; flex-wrap: wrap; background: var(--header); flex: none; }
  .tools.plegado { display: none; }
  .tools input { cursor: text; flex: 1; min-width: 180px; }
  .empty { flex: 1; display: grid; place-items: center; color: var(--muted); text-align: center; padding: 40px; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 600; }
  .pill.ok { background: rgba(37,211,102,.18); color: #128c7e; }
  .pill.bad { background: rgba(220,38,38,.16); color: #dc2626; }
  .pill.warn { background: rgba(217,119,6,.16); color: #d97706; }
  .link { color: var(--accent); text-decoration: none; font-size: 13px; }
  .icon { background: none; border: 0; color: var(--muted); cursor: pointer; font-size: 18px; padding: 4px 6px; }
  .hidden { display: none !important; }

  /* Respaldos: la misma columna de la izquierda, otro contenido. */
  .rb { padding: 10px 14px; border-bottom: 1px solid var(--line); cursor: pointer; }
  .rb:hover { background: var(--header); }
  .rb .top { display: flex; align-items: baseline; gap: 8px; }
  .rb .name { font-weight: 600; font-size: 14.5px; flex: 1; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
  .rb .when { font-size: 11.5px; color: var(--muted); flex: none; }
  .rb .det { font-size: 12.5px; color: var(--muted); margin-top: 2px; }
  .resumen { padding: 9px 14px; font-size: 12.5px; color: var(--muted);
    background: var(--header); border-bottom: 1px solid var(--line); }

  /* Confirmacion en la propia pantalla: un confirm() del navegador bloquea
     la pestana entera y deja el chat sin refrescar. */
  .confirmar { background: var(--header); border-top: 1px solid var(--line); padding: 14px 16px; }
  .confirmar p { margin: 0 0 10px; font-size: 13.5px; color: var(--muted); }
  .confirmar b { color: var(--text); }
  .confirmar .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .confirmar button, .lectura button {
    font: inherit; font-size: 13px; padding: 7px 12px; border-radius: 8px;
    border: 1px solid var(--line); background: var(--panel); color: var(--text); cursor: pointer;
  }
  .confirmar button.primary, .lectura button.primary {
    background: var(--accent); color: #fff; border-color: var(--accent);
  }
  .confirmar button.peligro { background: #dc2626; color: #fff; border-color: #dc2626; }
  /* Barra del respaldo abierto: se lee, no se escribe. */
  .lectura { background: var(--header); border-top: 1px solid var(--line);
    padding: 10px 14px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .lectura .que { flex: 1; min-width: 160px; font-size: 12.5px; color: var(--muted); }
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
    .msg { max-width: 85%; }
  }
`;

import { appShell } from './shell.js';

export interface ChatOpts {
  configured: boolean;
  proveedor?: string;
  demo?: boolean;
  nombreNegocio: string;
}

export function chatPage(opts: ChatOpts): string {
  const { configured, proveedor = 'cloud', demo = false } = opts;
  /**
   * En la demostracion los envios se apuntan como enviados y no salen a
   * ninguna parte. Sin decirlo, es imposible distinguirla de un sistema que
   * no entrega los mensajes.
   */
  const bandaDemo = demo
    ? `<div class="demo">Modo demostración: los mensajes NO salen a WhatsApp.
         Para hablar de verdad, arranca el sistema y conecta tu cuenta en <a href="/setup">/setup</a>.</div>`
    : '';

  /**
   * Solo con WAHA se puede traer el historial: es el unico proveedor que lo
   * guarda y lo deja pedir. Con la Cloud API de Meta no existe esa consulta,
   * asi que el boton no se pinta en vez de fallar al pulsarlo.
   */
  const importar =
    proveedor === 'waha'
      ? '<button class="icon" id="importar" title="Traer las conversaciones que ya tiene este WhatsApp">⭳</button>'
      : '';

  const aviso = configured
    ? ''
    : `<div class="locked" style="border-top:0;border-bottom:1px solid var(--line)">
         Todavia no conectaste tu WhatsApp: aqui veras las conversaciones, pero no saldra ningun mensaje.
         <div class="actions"><a class="link" href="/setup">Conectar mi WhatsApp</a></div>
       </div>`;

  const contenido = `
${bandaDemo}
<div class="aviso-conexion hidden" id="aviso-conexion"></div>
<div class="app" id="app">
  <div class="side">
    <header>
      <h1>Chats</h1>
      <span id="unread" class="badge hidden"></span>
      <button class="icon" id="new" title="Escribir a un número nuevo">✚</button>
      ${importar}
      <button class="icon" id="ver-respaldos" title="Conversaciones respaldadas">🗄</button>
      <button class="icon" id="atajos-ayuda" title="Atajos de teclado">⌨</button>
    </header>
    ${aviso}
    <div class="search"><input id="q" placeholder="Buscar por nombre o numero" autocomplete="off"></div>
    <div class="filtros" id="filtros">
      <button class="f activo" type="button" data-filtro="todos">Todos</button>
      <button class="f" type="button" data-filtro="sin_leer">Sin leer</button>
      <button class="f" type="button" data-filtro="esperan">Esperan respuesta</button>
      <button class="f" type="button" data-filtro="ventana">Escribieron hoy</button>
    </div>
    <div class="chats" id="chats"></div>
    <div class="resumen hidden" id="rb-resumen"></div>
    <div class="chats hidden" id="respaldos"></div>
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
      <button class="icon" id="cerrar-chat" title="Guardar este chat y vaciarlo">🗄</button>
    </header>
    <div class="empty" id="placeholder">
      <div>
        <div style="font-size:44px">💬</div>
        <p>Elige una conversacion para empezar.<br>
        Los mensajes que te escriban apareceran aqui solos.</p>
      </div>
    </div>
    <div class="messages hidden" id="messages"></div>
    <div class="tools hidden plegado" id="tools">
      <input id="loc" placeholder="Pega un link de mapa o coordenadas para mandar el pin">
      <button id="send-loc">Mandar pin</button>
      <button id="ask-loc">Pedir su ubicacion</button>
    </div>
    <div class="atajos hidden" id="atajos-popup"></div>
    <div class="stickers-popup hidden" id="stickers-popup"></div>
    <div class="rapidas-barra hidden" id="rapidas-barra"></div>
    <div class="composer hidden" id="composer">
      <button class="ghost" id="mas" title="Mandar o pedir ubicacion">📎</button>
      <button class="ghost" id="rapidas" title="Respuestas rápidas (escribe / en el mensaje)">⚡</button>
      <button class="ghost" id="stickers-boton" title="Mandar un sticker">🙂</button>
      <textarea id="text" rows="1" placeholder="Escribe un mensaje (/ para respuestas rápidas)"></textarea>
      <button id="send" title="Enviar">➤</button>
    </div>
    <div class="confirmar hidden" id="confirmar-cierre"></div>
    <div class="lectura hidden" id="lectura"></div>
    <div class="locked hidden" id="locked"></div>
  </div>
</div>`;

  const script = String.raw`
/* Se entra con la cookie de sesion (/login): si el servidor dice 401, alla. */
async function api(path, options) {
  options = options || {};
    var res = await fetch(path, {
    method: options.method || 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (res.status === 401) { irAlLogin(); throw new Error('Tu sesión terminó: vuelve a entrar.'); }
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(data.error || errorHttp(res.status));
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
  return d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
}
function dayLabel(iso) {
  var d = new Date(iso), hoy = new Date();
  var ayer = new Date(); ayer.setDate(hoy.getDate() - 1);
  if (d.toDateString() === hoy.toDateString()) return 'HOY';
  if (d.toDateString() === ayer.toDateString()) return 'AYER';
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' });
}
function shortWhen(iso) {
  if (!iso) return '';
  var d = new Date(iso), hoy = new Date();
  if (d.toDateString() === hoy.toDateString()) return hhmm(iso);
  var ayer = new Date(); ayer.setDate(hoy.getDate() - 1);
  if (d.toDateString() === ayer.toDateString()) return 'ayer';
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: '2-digit' });
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

var ESTADO_REPARTO = { pendiente: 'por pedir ubicación', enviado: 'esperando su ubicación', respondio: 'contestó, sin ubicación aún', resuelto: 'ubicación recibida', supervision: 'necesita revisión', derivado: 'derivado al repartidor', incidencia: 'con incidencia', cancelado: 'cancelado' };
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
/* 'chat' = conversacion viva; 'respaldo' = hilo guardado, solo lectura.
   El refresco automatico mira esto: repintar el chat vivo encima de un
   respaldo abierto lo cerraria solo cada cinco segundos. */
var modo = 'chat';
var enRespaldos = false;

/* Filtros de la lista: todo, sin leer, con el cliente esperando respuesta,
   o que escribieron en las ultimas 24 h (se les puede escribir libre). */
var filtroLista = 'todos';
function pasaFiltro(c) {
  if (filtroLista === 'sin_leer') return c.unread > 0;
  if (filtroLista === 'esperan') return c.lastMessage && c.lastMessage.direction === 'in';
  if (filtroLista === 'ventana') return c.windowOpen;
  return true;
}
document.querySelectorAll('#filtros .f').forEach(function (b) {
  b.onclick = function () {
    filtroLista = b.getAttribute('data-filtro');
    document.querySelectorAll('#filtros .f').forEach(function (x) { x.classList.toggle('activo', x === b); });
    loadChats();
  };
});
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
    var visibles = conversations.filter(pasaFiltro);
    if (!visibles.length) {
      pintarLista(box, '<div class="empty">Ninguna conversación con ese filtro.</div>', top);
      return;
    }
    var html = visibles.map(function (c) {
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
    current.pedido = data.reparto ? data.reparto.referencia : null;
    current.reparto = data.reparto || null;
    modo = 'chat';
    ver('lectura', false);
    ver('confirmar-cierre', false);
    document.getElementById('app').classList.add('open-thread');
    ver('thread-head', true);
    ver('placeholder', false);
    ver('messages', true);
    document.getElementById('t-avatar').textContent = inicial(current.name, current.phone);
    document.getElementById('t-name').textContent = current.name || current.phone;
    document.getElementById('t-sub').innerHTML = esc(current.phone) + ' · ' +
      (current.optOutAt ? '<span class="pill bad">dado de baja</span>'
        : data.windowOpen ? '<span class="pill ok">puede recibir mensajes</span>'
        : '<span class="pill warn">fuera de las 24 h</span>') +
      (data.reparto ? ' · <a class="link" href="/rutas" title="Ver en Ubicaciones para reparto">' + esc(data.reparto.referencia ? 'pedido ' + data.reparto.referencia : 'reparto') + ' · ' + esc(ESTADO_REPARTO[data.reparto.estado] || data.reparto.estado) + '</a>' : '');

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
    var soloSticker = m.kind === 'sticker' && !(m.body || '').trim();
    html += '<div class="msg ' + (m.direction === 'out' ? 'out' : 'in') +
      (primero ? ' primero' : '') + (soloSticker ? ' solo-sticker' : '') + '">' +
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
  if (kind === 'sticker' && media.url) return '<img class="adjunto sticker" src="' + esc(media.url) + '" alt="">';
  var attrs = ' class="adjunto' + (kind === 'sticker' ? ' sticker' : '') + '" data-media="' + esc(media.id) + '" data-kind="' + esc(kind) + '"';

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
          credentials: 'same-origin'
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

/* El clip abre y cierra la fila del pin. */
document.getElementById('mas').onclick = function () {
  var tools = document.getElementById('tools');
  tools.classList.toggle('plegado');
  if (!tools.classList.contains('plegado')) document.getElementById('loc').focus();
};

function renderComposer(data) {
  var composer = document.getElementById('composer');
  var tools = document.getElementById('tools');
  var locked = document.getElementById('locked');

  if (!composer || !tools || !locked) return;

  var barra = document.getElementById('rapidas-barra');
  if (data.canWrite) {
    composer.classList.remove('hidden');
    tools.classList.remove('hidden');
    locked.classList.add('hidden');
    barra.classList.remove('hidden');
    pintarBarraRapidas();
    return;
  }

  composer.classList.add('hidden');
  tools.classList.add('hidden');
  barra.classList.add('hidden');
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

/* El mensaje se pinta al instante como "enviando" y se confirma cuando el
   servidor responde: asi el boton se siente inmediato aunque WhatsApp tarde. */
function pintarPendiente(texto) {
  var box = document.getElementById('messages');
  if (!box || box.classList.contains('hidden')) return null;
  var vacio = box.querySelector('.empty');
  if (vacio) vacio.remove();
  var el = document.createElement('div');
  el.className = 'msg out primero pendiente';
  el.innerHTML = withLinks(texto) + '<span class="meta">enviando… <span class="tick">🕓</span></span>';
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}
var enviando = 0;
async function enviar(payload) {
  if (!current) return;
  var pendiente = null;
  if (payload.text) pendiente = pintarPendiente(payload.text);
  else if (payload.askLocation) pendiente = pintarPendiente('📍 Solicitud de ubicación');
  else if (payload.location) pendiente = pintarPendiente('🗺 Pin: ' + payload.location);
  if (enviando && (payload.askLocation || payload.text)) { toast('Espera: todavía está saliendo el anterior.'); if (pendiente) pendiente.remove(); return; }
  var boton = document.getElementById('send');
  var barra = document.getElementById('rapidas-barra');
  enviando++;
  if (boton) boton.disabled = true;
  if (barra) barra.classList.add('ocupada');
  try {
    payload.contactId = current.id;
    var r = await api('/admin/chat/send', { method: 'POST', body: payload });
    if (r.ok === false) {
      if (pendiente) pendiente.remove();
      toast('No salio: ' + (r.reason || r.error || 'bloqueado por las guardas'));
    }
    await openChat(current.id, true);
    loadChats(true);
  } catch (error) { if (pendiente) pendiente.remove(); toast(error.message); }
  finally { enviando--; if (!enviando) { if (boton) boton.disabled = false; if (barra) barra.classList.remove('ocupada'); } }
}

var input = document.getElementById('text');
input.addEventListener('input', function () {
  input.style.height = 'auto';
  input.style.height = Math.min(120, input.scrollHeight) + 'px';
  atajosDesdeTexto();
});
input.addEventListener('keydown', function (e) {
  if (atajosAbierto()) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moverAtajo(1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); moverAtajo(-1); return; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); elegirAtajo(); return; }
    if (e.key === 'Escape') { e.preventDefault(); cerrarAtajos(); return; }
  }
  /* Enter manda; Shift+Enter hace salto de linea, como en WhatsApp Web. */
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); mandarTexto(); }
});

/* --- respuestas rapidas: "/" en el mensaje, o el rayo ---------------------- */
var atajos = [];
var atajoSel = 0;
async function cargarAtajos() {
  try { atajos = (await api('/admin/chat/atajos')).atajos || []; } catch (e) { atajos = []; }
  pintarBarraRapidas();
}
function negocioNombre() {
  var app = document.getElementById('s-app');
  return app ? app.getAttribute('data-negocio') || '' : '';
}
function rellenarAtajo(texto) {
  var nombre = current ? ((current.name || '').trim().split(/\s+/)[0] || '') : '';
  var pedido = current && current.pedido ? current.pedido : '';
  return texto.replace(/\{nombre\}/g, nombre).replace(/\{pedido\}/g, pedido || 'su pedido').replace(/\{negocio\}/g, negocioNombre()).replace(/\s+,/g, ',').replace(/  +/g, ' ');
}
function atajosAbierto() { return !document.getElementById('atajos-popup').classList.contains('hidden'); }
function cerrarAtajos() { document.getElementById('atajos-popup').classList.add('hidden'); }
function pintarAtajos(filtro) {
  var box = document.getElementById('atajos-popup');
  var lista = atajos.filter(function (a) { return !filtro || a.atajo.indexOf(filtro) === 0 || a.texto.toLowerCase().indexOf(filtro) >= 0; });
  if (!lista.length) { box.innerHTML = '<div class="pie">Ningún atajo empieza por "/' + esc(filtro) + '". Se crean en Panel → Automatización.</div>'; box.classList.remove('hidden'); box._lista = []; return; }
  if (atajoSel >= lista.length) atajoSel = 0;
  box.innerHTML = lista.map(function (a, i) {
    return '<div class="op' + (i === atajoSel ? ' sel' : '') + '" data-i="' + i + '"><b>/' + esc(a.atajo) + '</b><span>' + esc(rellenarAtajo(a.texto)) + '</span></div>';
  }).join('') + '<div class="pie">↑↓ para moverte · Enter o Tab para poner el texto · Esc para cerrar</div>';
  box._lista = lista;
  box.querySelectorAll('.op').forEach(function (el) { el.onclick = function () { atajoSel = Number(el.getAttribute('data-i')); elegirAtajo(); }; });
  box.classList.remove('hidden');
}
function atajosDesdeTexto() {
  var v = input.value;
  if (v.charAt(0) === '/' && v.indexOf(' ') < 0 && v.indexOf('\n') < 0) { atajoSel = atajosAbierto() ? atajoSel : 0; pintarAtajos(v.slice(1).toLowerCase()); }
  else if (atajosAbierto()) cerrarAtajos();
}
function moverAtajo(d) {
  var lista = document.getElementById('atajos-popup')._lista || [];
  if (!lista.length) return;
  atajoSel = (atajoSel + d + lista.length) % lista.length;
  pintarAtajos(input.value.charAt(0) === '/' ? input.value.slice(1).toLowerCase() : '');
}
function elegirAtajo() {
  var lista = document.getElementById('atajos-popup')._lista || [];
  var a = lista[atajoSel];
  cerrarAtajos();
  if (!a) return;
  input.value = rellenarAtajo(a.texto);
  input.style.height = 'auto';
  input.style.height = Math.min(120, input.scrollHeight) + 'px';
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}
/* La barra de botones: las acciones fijas y una pastilla por respuesta rapida.
   Un clic manda el texto tal cual (con el nombre del cliente puesto); con
   Shift se deja en el cuadro para retocarlo antes. Mientras sale uno, la
   barra se bloquea: un segundo clic no manda dos veces. */
function etiquetaDe(atajo) {
  var t = atajo.replace(/[_-]+/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function ponerAtajo(a, directo) {
  var texto = rellenarAtajo(a.texto);
  if (directo) {
    enviar({ text: texto }).then(function () { if (a.sticker) return mandarSticker(a.sticker); });
    return;
  }
  input.value = texto;
  input.style.height = 'auto';
  input.style.height = Math.min(120, input.scrollHeight) + 'px';
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}
function pintarBarraRapidas() {
  var barra = document.getElementById('rapidas-barra');
  if (!barra) return;
  var html = '<button class="chip accion" type="button" data-accion="ubicacion" title="Le manda la solicitud de ubicación (Ctrl+Shift+U)">📍 Pedir ubicación</button>' +
    '<button class="chip accion" type="button" data-accion="pin" title="Mandarle un pin del mapa (Ctrl+Shift+L)">🗺 Mandar pin</button>' +
    atajos.map(function (a, i) {
      return '<button class="chip" type="button" data-rapida="' + i + '" title="Manda: ' + esc(rellenarAtajo(a.texto)) + ' (Shift+clic para retocarlo antes)">' + esc(etiquetaDe(a.atajo)) + '</button>';
    }).join('') +
    '<a class="chip editar" href="/panel#automatizacion" title="Añadir, cambiar o quitar respuestas rápidas">✎ Editar</a>';
  if (barra.innerHTML !== html) barra.innerHTML = html;
  barra.querySelectorAll('[data-rapida]').forEach(function (b) {
    b.onclick = function (ev) { var a = atajos[Number(b.getAttribute('data-rapida'))]; if (a) ponerAtajo(a, !ev.shiftKey); };
  });
  var pedir = barra.querySelector('[data-accion="ubicacion"]');
  if (pedir) pedir.onclick = function () { if (!enviando) enviar({ askLocation: true }); };
  var pin = barra.querySelector('[data-accion="pin"]');
  if (pin) pin.onclick = function () { document.getElementById('tools').classList.remove('plegado'); document.getElementById('loc').focus(); };
}
document.getElementById('rapidas').onclick = function () {
  if (atajosAbierto()) return cerrarAtajos();
  atajoSel = 0;
  pintarAtajos('');
  input.focus();
};

/* --- stickers: el boton 🙂 abre la biblioteca; un clic lo manda ------------ */
var stickers = [];
async function cargarStickers() {
  try { stickers = (await api('/admin/stickers')).stickers || []; } catch (e) { stickers = []; }
}
function stickersAbierto() { return !document.getElementById('stickers-popup').classList.contains('hidden'); }
function cerrarStickers() { document.getElementById('stickers-popup').classList.add('hidden'); }
async function mandarSticker(id) {
  if (!current) return;
  if (enviando) { toast('Espera: todavía está saliendo el anterior.'); return; }
  cerrarStickers();
  var pendiente = pintarPendiente('🙂 sticker');
  var barra = document.getElementById('rapidas-barra');
  enviando++;
  if (barra) barra.classList.add('ocupada');
  try {
    var r = await api('/admin/stickers/' + encodeURIComponent(id) + '/enviar', { method: 'POST', body: { phone: current.phone } });
    if (r.ok === false) { if (pendiente) pendiente.remove(); toast('No salió: ' + (r.reason || r.error || 'bloqueado por las guardas')); }
    await openChat(current.id, true);
  } catch (error) { if (pendiente) pendiente.remove(); toast(error.message); }
  finally { enviando--; if (!enviando && barra) barra.classList.remove('ocupada'); }
}
document.getElementById('stickers-boton').onclick = async function () {
  if (stickersAbierto()) return cerrarStickers();
  if (!stickers.length) await cargarStickers();
  var box = document.getElementById('stickers-popup');
  box.innerHTML = stickers.length
    ? stickers.map(function (s) { return '<img src="/stickers/' + esc(s.archivo) + '" title="' + esc(s.nombre) + '" data-sticker="' + esc(s.id) + '" alt="">'; }).join('') + '<div class="pie">Un clic lo manda. Se suben en Panel → Stickers.</div>'
    : '<div class="pie">Todavía no hay stickers. Súbelos en <a class="link" href="/panel#stickers">Panel → Stickers</a>.</div>';
  box.querySelectorAll('[data-sticker]').forEach(function (img) { img.onclick = function () { mandarSticker(img.getAttribute('data-sticker')); }; });
  cerrarAtajos();
  box.classList.remove('hidden');
};

/* --- teclas: moverse entre chats y pedir ubicacion sin soltar el teclado --- */
function chatVecino(d) {
  if (!conversations.length) return;
  var i = current ? conversations.findIndex(function (c) { return c.contactId === current.id; }) : -1;
  var j = i < 0 ? 0 : (i + d + conversations.length) % conversations.length;
  openChat(conversations[j].contactId);
}
function enCampo(el) { return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'); }
document.addEventListener('keydown', function (e) {
  if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); chatVecino(1); return; }
  if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); chatVecino(-1); return; }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'U' || e.key === 'u')) { e.preventDefault(); if (current && document.getElementById('composer') && !document.getElementById('composer').classList.contains('hidden')) enviar({ askLocation: true }); return; }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'L' || e.key === 'l')) { e.preventDefault(); if (current) { document.getElementById('tools').classList.remove('plegado'); document.getElementById('loc').focus(); } return; }
  if (e.key === '/' && !enCampo(document.activeElement)) {
    e.preventDefault();
    if (current && !document.getElementById('composer').classList.contains('hidden')) { input.focus(); input.value = '/'; atajosDesdeTexto(); }
    else document.getElementById('q').focus();
    return;
  }
  if (e.key === 'F1' || ((e.ctrlKey || e.metaKey) && e.key === '/')) { e.preventDefault(); ayudaTeclas(); return; }
  if (e.key === 'Escape' && !atajosAbierto()) {
    var ayuda = document.querySelector('.ayuda-teclas');
    if (ayuda) { ayuda.remove(); return; }
    if (enCampo(document.activeElement)) { document.activeElement.blur(); return; }
    if (document.getElementById('app').classList.contains('open-thread')) document.getElementById('back').click();
  }
});
function ayudaTeclas() {
  if (document.querySelector('.ayuda-teclas')) return;
  var caja = document.createElement('div');
  caja.className = 'ayuda-teclas';
  caja.innerHTML = '<div class="caja"><h3>Atajos del chat</h3><table>' +
    '<tr><td><kbd>/</kbd> en el mensaje</td><td>Respuestas rápidas (se filtran al escribir; Enter o Tab pone el texto)</td></tr>' +
    '<tr><td>Botones sobre el cuadro</td><td>Un clic manda la respuesta rápida al instante (con el nombre puesto); <kbd>Shift</kbd>+clic la deja en el cuadro para retocarla</td></tr>' +
    '<tr><td><kbd>⚡</kbd></td><td>Ver todas las respuestas rápidas</td></tr>' +
    '<tr><td><kbd>🙂</kbd></td><td>Mandar un sticker de la biblioteca</td></tr>' +
    '<tr><td><kbd>Enter</kbd> / <kbd>Shift</kbd>+<kbd>Enter</kbd></td><td>Enviar / salto de línea</td></tr>' +
    '<tr><td><kbd>Alt</kbd>+<kbd>↓</kbd> <kbd>Alt</kbd>+<kbd>↑</kbd></td><td>Siguiente / anterior conversación</td></tr>' +
    '<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>U</kbd></td><td>Pedirle su ubicación</td></tr>' +
    '<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd></td><td>Mandar un pin (abre el cuadro del mapa)</td></tr>' +
    '<tr><td><kbd>/</kbd> fuera del mensaje</td><td>Ir al buscador de chats</td></tr>' +
    '<tr><td><kbd>Ctrl</kbd>+<kbd>K</kbd></td><td>Buscar un módulo del sistema</td></tr>' +
    '<tr><td><kbd>Esc</kbd></td><td>Cerrar esto, salir del campo o volver a la lista</td></tr>' +
    '<tr><td><kbd>F1</kbd> o <kbd>Ctrl</kbd>+<kbd>/</kbd></td><td>Esta ayuda</td></tr>' +
    '</table><p class="muted" style="margin:10px 0 0;font-size:12.5px">Las respuestas rápidas se editan en Panel → Automatización.</p></div>';
  caja.onclick = function (ev) { if (ev.target === caja) caja.remove(); };
  document.body.appendChild(caja);
}
document.getElementById('atajos-ayuda').onclick = ayudaTeclas;
async function mandarTexto() {
  var texto = input.value.trim();
  if (!texto) return;
  if (enviando) { toast('Espera: todavía está saliendo el anterior.'); return; }
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
  var tel = await pedirCelular();
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
  buscando = setTimeout(function () {
    if (enRespaldos) cargarRespaldos();
    else loadChats();
  }, 250);
});

async function loadTemplates() {
  try { templates = await api('/admin/templates'); } catch (error) { templates = []; }
}

/* Refresco: la lista siempre, el hilo abierto sin marcarlo como leido de
   nuevo para no pisar el contador mientras se lee. */
/* Estado de la conexion con WhatsApp.
   Solo tiene sentido con los proveedores que se vinculan por QR (el cliente
   local y WAHA): con la Cloud API de Meta no hay sesion que se caiga. */
var PROVEEDOR = '${proveedor}';

async function revisarConexion() {
  if (PROVEEDOR !== 'local' && PROVEEDOR !== 'waha') return;
  var caja = document.getElementById('aviso-conexion');
  try {
    var estado = await api('/admin/' + PROVEEDOR + '/status');
    if (estado.connected) {
      caja.classList.add('hidden');
      return;
    }
    caja.innerHTML = 'WhatsApp no está conectado' +
      (estado.detail ? ' (' + esc(estado.detail) + ')' : '') +
      ': lo que escribas aquí no va a salir. ' +
      '<a href="/setup">Conectar ahora</a>';
    caja.classList.remove('hidden');
  } catch (error) {
    /* Si no se puede preguntar, no se inventa un estado: se deja como esta. */
  }
}

revisarConexion();
setInterval(revisarConexion, 15000);

setInterval(function () {
  if (modo !== 'chat') return;
  if (!enRespaldos) loadChats(true);
  if (deseado) openChat(deseado, true);
}, 5000);

/**
 * Abrir un chat desde fuera: /chat?phone=51999888777&text=Hola...
 *
 * Es la puerta por la que entra Stoky. Su boton de "hablar por WhatsApp" en
 * seguimiento y cobranza ya arma el mensaje con el saldo exacto y el numero de
 * pedido; lo unico que cambia es que en vez de abrir wa.me abre esto, y la
 * conversacion queda dentro del sistema en vez de en el WhatsApp personal de
 * quien pulso el boton.
 *
 * El contacto se crea si no existe: quien viene de una venta puede no haber
 * escrito nunca todavia.
 */
async function abrirDesdeUrl() {
  var params = new URLSearchParams(location.search);
  var tel = (params.get('phone') || '').replace(/\D+/g, '');
  if (!tel) return;

  try {
    var r = await api('/admin/chat/start', { method: 'POST', body: { phone: tel } });
    await loadChats();
    await openChat(r.contact.id);

    var texto = params.get('text');
    if (texto) {
      // Se deja escrito, NO se manda: quien pulso el boton tiene que poder
      // leerlo y cambiarlo antes de que le llegue al cliente.
      var caja = document.getElementById('text');
      caja.value = texto;
      caja.focus();
      caja.setSelectionRange(texto.length, texto.length);
      caja.dispatchEvent(new Event('input'));
    }

    // La URL se limpia para que recargar no vuelva a abrir lo mismo ni deje
    // el mensaje del cliente colgado en el historial del navegador.
    history.replaceState(null, '', '/chat');
  } catch (error) {
    toast(error.message);
  }
}

/* ------------------------------------------------------------ respaldos

   Cerrar un chat guarda el hilo entero en un fichero y lo vacia de la base.
   Es lo que hace que el historial sobreviva a perder el numero, y de paso lo
   que evita que la base crezca sin fin. El servidor no borra nada hasta haber
   escrito el respaldo y haberlo vuelto a leer entero. */

function motivoTexto(reason) {
  if (reason === 'lead') return 'al cerrar la ficha';
  if (reason === 'inactividad') return 'por inactividad';
  return 'cerrado a mano';
}

document.getElementById('cerrar-chat').onclick = function () { pedirCierre(); };

function pedirCierre() {
  if (!current || modo !== 'chat') return;
  var caja = document.getElementById('confirmar-cierre');
  caja.innerHTML =
    '<p>Se guarda <b>todo el historial</b> de ' + esc(current.name || current.phone) +
    ' en un respaldo y el chat queda vacío aquí. Lo guardado se puede leer, descargar ' +
    'y devolver al chat cuando quieras, aunque se pierda el número.</p>' +
    '<div class="actions">' +
      '<button class="primary" id="ok-cierre">Guardar y vaciar</button>' +
      '<button id="no-cierre">Cancelar</button>' +
    '</div>';
  ver('confirmar-cierre', true);
  document.getElementById('no-cierre').onclick = function () { ver('confirmar-cierre', false); };
  document.getElementById('ok-cierre').onclick = cerrarChat;
}

async function cerrarChat() {
  var boton = document.getElementById('ok-cierre');
  boton.disabled = true;
  boton.textContent = 'Guardando...';
  try {
    var r = await api('/admin/chat/' + current.id + '/archive', { method: 'POST' });
    ver('confirmar-cierre', false);
    toast('Guardados ' + r.archive.messageCount + ' mensajes. El chat quedó vacío.');
    await openChat(current.id, true);
    loadChats(true);
  } catch (error) {
    toast(error.message);
    boton.disabled = false;
    boton.textContent = 'Guardar y vaciar';
  }
}

/* Traer lo que ya se hablo antes de conectar el sistema (solo WAHA). */
var botonImportar = document.getElementById('importar');
if (botonImportar) {
  botonImportar.onclick = async function () {
    botonImportar.disabled = true;
    toast('Trayendo las conversaciones de WhatsApp, puede tardar un poco...');
    try {
      var r = await api('/admin/waha/importar', { method: 'POST', body: {} });
      toast('Listo: ' + r.chats + ' conversaciones y ' + r.mensajes + ' mensajes.' +
        (r.omitidos ? ' Se omitieron ' + r.omitidos + ' grupos.' : ''));
      loadChats();
    } catch (error) {
      toast(error.message);
    } finally {
      botonImportar.disabled = false;
    }
  };
}

document.getElementById('ver-respaldos').onclick = function () {
  if (enRespaldos) volverAChats();
  else abrirRespaldos();
};

function abrirRespaldos() {
  enRespaldos = true;
  ver('chats', false);
  ver('respaldos', true);
  ver('rb-resumen', true);
  document.getElementById('q').value = '';
  document.getElementById('q').placeholder = 'Buscar en los respaldos';
  cargarRespaldos();
}

function volverAChats() {
  enRespaldos = false;
  ver('chats', true);
  ver('respaldos', false);
  ver('rb-resumen', false);
  document.getElementById('q').value = '';
  document.getElementById('q').placeholder = 'Buscar por nombre o numero';
  loadChats();
}

async function cargarRespaldos() {
  try {
    var q = document.getElementById('q').value.trim();
    var data = await api('/admin/archives?limit=100&q=' + encodeURIComponent(q));
    var s = data.stats;

    document.getElementById('rb-resumen').innerHTML =
      '<b>' + s.total + '</b> respaldos \u00b7 ' + s.messages + ' mensajes \u00b7 ' + pesoLegible(s.bytes) +
      (data.inactividadDias
        ? ' \u00b7 los chats sin movimiento se cierran solos a los ' + data.inactividadDias + ' dias'
        : '') +
      ' \u2014 <a class="link" href="#" id="volver-chats">volver a los chats</a>';
    document.getElementById('volver-chats').onclick = function (e) {
      e.preventDefault();
      volverAChats();
    };

    var html = data.items.map(function (a) {
      return '<div class="rb" data-rb="' + a.id + '">' +
        '<div class="top">' +
          '<span class="name">' + esc(a.name || a.phone) + '</span>' +
          '<span class="when">' + esc(shortWhen(a.createdAt)) + '</span>' +
        '</div>' +
        '<div class="det">' + a.messageCount + ' mensajes \u00b7 ' + esc(motivoTexto(a.reason)) +
          ' \u00b7 ' + pesoLegible(a.bytes) + '</div>' +
        '</div>';
    }).join('');

    var box = document.getElementById('respaldos');
    pintarLista(box, html || '<div class="empty">Todavía no hay respaldos.<br>' +
      'Cierra un chat con el botón de la cabecera y aparecerá aquí.</div>', 0);
  } catch (error) { toast(error.message); }
}

document.getElementById('respaldos').addEventListener('click', function (event) {
  var fila = event.target.closest('[data-rb]');
  if (fila) abrirRespaldo(Number(fila.getAttribute('data-rb')));
});

async function abrirRespaldo(id) {
  try {
    var data = await api('/admin/archives/' + id);
    var a = data.archive;

    modo = 'respaldo';
    /* Se suelta el chat que hubiera abierto: si no, el refresco lo repinta. */
    deseado = null;

    document.getElementById('app').classList.add('open-thread');
    ver('thread-head', true);
    ver('placeholder', false);
    ver('messages', true);
    ver('composer', false);
    ver('tools', false);
    ver('locked', false);
    ver('confirmar-cierre', false);

    document.getElementById('t-avatar').textContent = inicial(a.name, a.phone);
    document.getElementById('t-name').textContent = a.name || a.phone;
    document.getElementById('t-sub').innerHTML = esc(a.phone) +
      ' \u00b7 <span class="pill warn">respaldo \u00b7 solo lectura</span>';

    lastCount = 0;
    renderMessages(data.messages, true);

    var caja = document.getElementById('lectura');
    caja.innerHTML =
      '<span class="que">' + a.messageCount + ' mensajes guardados el ' +
        esc(dayLabel(a.createdAt)) + ' (' + esc(motivoTexto(a.reason)) + ')</span>' +
      '<button class="primary" id="rb-restaurar">Devolver al chat</button>' +
      '<button id="rb-descargar">Descargar</button>' +
      '<button id="rb-cerrar">Cerrar</button>';
    ver('lectura', true);

    document.getElementById('rb-cerrar').onclick = function () {
      ver('lectura', false);
      ver('messages', false);
      ver('thread-head', false);
      ver('placeholder', true);
      document.getElementById('app').classList.remove('open-thread');
      modo = 'chat';
    };
    document.getElementById('rb-descargar').onclick = function () { descargarRespaldo(a); };
    document.getElementById('rb-restaurar').onclick = function () { restaurar(a); };
  } catch (error) { toast(error.message); }
}

/* La descarga va por fetch y no por un <a href>: el token viaja en la
   cabecera, no en la URL, igual que con los adjuntos. */
async function descargarRespaldo(a) {
  try {
    var res = await fetch('/admin/archives/' + a.id + '/download', {
      credentials: 'same-origin'
    });
    if (!res.ok) throw new Error('No se pudo descargar el respaldo.');
    var url = URL.createObjectURL(await res.blob());
    var enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = 'chat-' + a.phone + '-' + a.createdAt.slice(0, 10) + '.ndjson.gz';
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  } catch (error) { toast(error.message); }
}

async function restaurar(a) {
  var boton = document.getElementById('rb-restaurar');
  boton.disabled = true;
  boton.textContent = 'Devolviendo...';
  try {
    var r = await api('/admin/archives/' + a.id + '/restore', { method: 'POST' });
    toast('Devueltos ' + r.restaurados + ' mensajes al chat.');
    volverAChats();
    await openChat(a.contactId);
  } catch (error) {
    toast(error.message);
    boton.disabled = false;
    boton.textContent = 'Devolver al chat';
  }
}

cargarAtajos();
cargarStickers();
loadTemplates();
loadChats().then(abrirDesdeUrl);
`;

  return appShell({
    titulo: 'Chats',
    subtitulo: 'Las conversaciones, como en WhatsApp',
    contenido,
    script,
    css: CSS,
    nombreNegocio: opts.nombreNegocio,
    demo,
    lleno: true,
    icono: '💬',
  });
}
