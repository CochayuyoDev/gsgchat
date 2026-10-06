/**
 * Pantalla de chat: se ve y se usa como WhatsApp.
 *
 * Lista de conversaciones a la izquierda, hilo a la derecha, burbujas verdes
 * para lo que sale y blancas para lo que entra, con su hora y su doble check.
 *
 * Se refresca sola cada pocos segundos en vez de abrir un WebSocket: el
 * volumen de un chat de atencion no lo justifica y asi sobrevive a cualquier
 * proxy sin configuracion extra. El refresco tiene una regla que no se salta:
 * NO pisa lo que el usuario esta haciendo -ni lo que escribe, ni el scroll,
 * ni un menu abierto, ni una seleccion en marcha-.
 *
 * El fichero esta partido en tres para que quepa en la cabeza:
 *   - `chat-css.ts`         como se ve
 *   - `chat-menu.ts`        todo lo que se hace SOBRE un mensaje
 *   - `chat-compositor.ts`  todo lo que hay de la raya para abajo
 * Se concatenan en un solo script; nadie mas los importa.
 *
 * Nota: el JS va en String.raw y usa concatenacion, como el resto de paginas.
 */

import { appShell } from './shell.js';
import { TEXTO_VER_UNA_VEZ } from '../handlers/textos.js';
import { CHAT_CSS } from './chat-css.js';
import { CHAT_JS_MENU } from './chat-menu.js';
import { CHAT_JS_COMPOSITOR } from './chat-compositor.js';

export interface ChatOpts {
  configured: boolean;
  proveedor?: string;
  demo?: boolean;
  nombreNegocio: string;
}

export function chatPage(opts: ChatOpts): string {
  const { configured, proveedor = 'cloud', demo = false } = opts;

  /**
   * Un solo aviso arriba, y el que mas importa.
   *
   * Antes podian salir tres a la vez (demostracion, WhatsApp desconectado y
   * "todavia no conectaste") diciendo casi lo mismo con distintas palabras.
   * En demostracion, el de conexion sobra: ya se ha dicho que nada sale.
   */
  const bandaDemo = demo
    ? `<div class="aviso demo">Modo demostración: los mensajes NO salen a WhatsApp.
         Para hablar de verdad, conecta tu cuenta en <a href="/setup">Conexión</a>.</div>`
    : configured
      ? ''
      : `<div class="aviso roto">Todavía no conectaste tu WhatsApp: aquí ves las conversaciones, pero no sale ningún mensaje.
           <a href="/setup">Conectar mi WhatsApp</a></div>`;

  /**
   * Traer el historial solo tiene sentido donde hay de donde traerlo: WAHA lo
   * guarda y lo deja pedir, y con el QR lo tiene el telefono. Con la Cloud API
   * de Meta no existe esa consulta, asi que la opcion no se pinta.
   */
  const opcionHistorial =
    proveedor === 'waha'
      ? `{ icono: '⭳', texto: 'Traer las conversaciones de este WhatsApp', accion: importarDeWaha }`
      : proveedor === 'local'
        ? `{ icono: '⤒', texto: 'Traer el historial de todos los chats', accion: traerTodoElHistorial }`
        : '';

  const contenido = `
${bandaDemo}
<div class="aviso roto hidden" id="aviso-conexion"></div>
<div class="app" id="app">
  <div class="side">
    <header>
      <h1>Chats</h1>
      <span id="unread" class="badge hidden" aria-label="mensajes sin leer"></span>
      <button class="icon" id="nuevo" title="Escribir a un número nuevo" aria-label="Escribir a un número nuevo">✚</button>
      <button class="icon" id="menu-lista" title="Más opciones" aria-label="Más opciones" aria-haspopup="menu" aria-expanded="false">⋮</button>
    </header>
    <div class="search"><input id="q" placeholder="Buscar por nombre o número" autocomplete="off" aria-label="Buscar un chat por nombre o número"></div>
    <div class="filtros" id="filtros" role="tablist" aria-label="Filtrar conversaciones">
      <button class="f activo" type="button" data-filtro="todos">Todos</button>
      <button class="f" type="button" data-filtro="sin_leer">Sin leer</button>
      <button class="f" type="button" data-filtro="esperan">Esperan respuesta</button>
      <button class="f" type="button" data-filtro="ventana">Escribieron hoy</button>
      <button class="f" type="button" data-filtro="grupos">Grupos</button>
      <button class="f" type="button" data-filtro="apartados">Apartados</button>
    </div>
    <div class="chats" id="chats"></div>
  </div>

  <div class="thread">
    <header id="thread-head" class="hidden">
      <button class="icon" id="back" title="Volver a la lista" aria-label="Volver a la lista">‹</button>
      <div class="avatar" id="t-avatar" aria-hidden="true"></div>
      <div style="flex:1;min-width:0">
        <div class="name" id="t-name"></div>
        <div class="sub" id="t-sub"></div>
      </div>
      <button class="icon" id="abrir-ficha" title="Ficha del cliente: su pedido, su ubicación y el estado del chat" aria-label="Ficha del cliente">ⓘ</button>
      <button class="icon" id="abrir-busqueda" title="Buscar en esta conversación" aria-label="Buscar en esta conversación">🔍</button>
      <button class="icon" id="menu-chat" title="Más opciones" aria-label="Más opciones de esta conversación" aria-haspopup="menu" aria-expanded="false">⋮</button>
    </header>

    <div class="buscar-hilo hidden" id="buscar-hilo" role="search">
      <input id="buscar-campo" placeholder="Buscar en esta conversación" autocomplete="off" aria-label="Buscar en esta conversación">
      <span class="cuenta" id="buscar-cuenta" aria-live="polite"></span>
      <button type="button" id="buscar-antes" title="Coincidencia anterior" aria-label="Coincidencia anterior">↑</button>
      <button type="button" id="buscar-despues" title="Coincidencia siguiente" aria-label="Coincidencia siguiente">↓</button>
      <button type="button" id="buscar-cerrar" title="Cerrar la búsqueda" aria-label="Cerrar la búsqueda">✕</button>
    </div>

    <div class="seleccion hidden" id="seleccion">
      <span class="cuantos"></span>
      <button type="button" id="sel-reenviar" title="Reenviar los seleccionados">↪ Reenviar</button>
      <button type="button" id="sel-copiar" title="Copiar el texto de los seleccionados">⧉ Copiar</button>
      <button type="button" id="sel-destacar" title="Destacar los seleccionados">⭐ Destacar</button>
      <button type="button" id="sel-eliminar" title="Eliminar los seleccionados">🗑 Eliminar</button>
      <button type="button" id="sel-cerrar" title="Salir de la selección (Esc)" aria-label="Salir de la selección">✕</button>
    </div>

    <aside class="ficha hidden" id="ficha" aria-label="Ficha del cliente">
      <div class="ficha-cab"><b>Ficha del cliente</b><button type="button" class="icon" id="ficha-cerrar" aria-label="Cerrar la ficha">✕</button></div>
      <div class="ficha-cuerpo" id="ficha-cuerpo"><p class="muted">Cargando…</p></div>
    </aside>

    <div class="empty" id="placeholder">
      <div>
        <div style="font-size:44px" aria-hidden="true">💬</div>
        <p>Elige una conversación para empezar.<br>
        Los mensajes que te escriban aparecen aquí solos.</p>
      </div>
    </div>

    <div class="messages hidden" id="messages" tabindex="-1"></div>
    <button class="bajar hidden" id="bajar" title="Bajar al último mensaje" aria-label="Bajar al último mensaje">↓<span class="nuevos hidden" id="bajar-nuevos"></span></button>

    <input type="file" id="archivo" class="hidden" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip">

    <div class="cita-previa hidden" id="cita-previa">
      <div class="bloque"><span class="quien"></span><span class="que"></span></div>
      <button type="button" class="icon" id="cita-quitar" title="No responder a ese mensaje" aria-label="Quitar la cita">✕</button>
    </div>
    <div class="previa hidden" id="adjunto-previa"></div>
    <div class="panel-bajo hidden" id="panel-atajos"></div>
    <div class="panel-bajo hidden" id="panel-stickers"></div>
    <div class="panel-bajo emojis hidden" id="panel-emojis">
      <input class="buscador" id="emojis-buscar" placeholder="Buscar: caras, gestos, corazones, trabajo, comida" aria-label="Buscar emoji">
      <div id="emojis-rejillas"></div>
    </div>
    <div class="rapidas-barra hidden" id="rapidas-barra"></div>

    <div class="grabando hidden" id="grabando"></div>
    <div class="composer hidden" id="composer">
      <button class="ghost" id="boton-mas" title="Adjuntar, sticker, ubicación o respuesta rápida" aria-label="Más cosas que mandar" aria-haspopup="menu" aria-expanded="false">＋</button>
      <button class="ghost" id="boton-emoji" title="Emoji" aria-label="Elegir un emoji" aria-expanded="false">😊</button>
      <textarea id="text" rows="1" placeholder="Escribe un mensaje  ·  / para respuestas rápidas" aria-label="Escribe un mensaje"></textarea>
      <button id="grabar" title="Grabar una nota de voz" aria-label="Grabar una nota de voz">🎤</button>
      <button id="send" class="hidden" title="Enviar" aria-label="Enviar">➤</button>
    </div>

    <div class="confirmar hidden" id="confirmar-cierre"></div>
    <div class="locked hidden" id="locked"></div>
  </div>
</div>`;

  const nucleo = String.raw`
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
/** El primer enlace de un texto, para la previa. */
function primerEnlace(texto) {
  var m = String(texto || '').match(/https?:\/\/[^\s<]+/);
  return m ? m[0] : null;
}
function hhmm(iso) {
  return new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
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
function fechaCorta(v) {
  if (!v) return '';
  var d = new Date(v);
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function inicial(nombre, tel) {
  var s = (nombre || '').trim();
  if (s) return s[0].toUpperCase();
  return (tel || '?').slice(-2, -1) || '#';
}
/* Un grupo sin nombre todavia se ensena como "Grupo", no como su jid. */
function nombreDe(c) {
  if (!c) return '';
  if (c.name) return c.name;
  if (c.tipo === 'grupo') return 'Grupo de WhatsApp';
  return c.phone || '';
}
function tick(status) {
  if (status === 'read') return '<span class="tick read" title="leído">✓✓</span>';
  if (status === 'delivered') return '<span class="tick" title="entregado">✓✓</span>';
  if (status === 'sent') return '<span class="tick" title="enviado">✓</span>';
  if (status === 'failed') return '<span class="tick" title="no se pudo entregar">⚠</span>';
  return '';
}
function pesoLegible(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
/* Mostrar y ocultar sin reventar si el nodo ya no existe: el hilo se repinta
   entero y un getElementById de algo borrado devuelve null. */
function ver(id, visible) {
  var el = document.getElementById(id);
  if (el) el.classList.toggle('hidden', !visible);
}
function toast(text) {
  var el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(function () { el.remove(); }, 4200);
}
/**
 * El color del avatar, derivado del telefono.
 *
 * Que sea derivado y no aleatorio importa: el mismo contacto sale del mismo
 * color en cada recarga, o la lista deja de reconocerse de un vistazo.
 */
function colorDe(phone) {
  var suma = 0;
  for (var i = 0; i < (phone || '').length; i++) suma += phone.charCodeAt(i);
  return 'c' + (suma % 8);
}

/* ------------------------------------------------------------------ estado */

var ESTADO_REPARTO = { pendiente: 'por pedir ubicación', enviado: 'esperando su ubicación', respondio: 'contestó, sin ubicación aún', resuelto: 'ubicación recibida', supervision: 'necesita revisión', derivado: 'derivado al repartidor', incidencia: 'con incidencia', cancelado: 'cancelado' };
var current = null;      /* el contacto abierto */
/* Cual quiere ver el usuario, y en que numero de peticion vamos. El refresco
   corre cada pocos segundos: sin estos dos guardas, una respuesta pedida ANTES
   del ultimo envio llegaba despues y repintaba el hilo sin lo que acababas de
   mandar. */
var deseado = null;
var peticion = 0;
var pintado = 0;
var conversations = [];
var templates = [];
var lastCount = 0;
var pintados = [];       /* lo que hay pintado en el hilo ahora mismo */
var puedeEscribir = false;
/* Lo que este proveedor sabe hacer. Lo dice el servidor al abrir el hilo; hasta
   entonces, lo minimo que todos pueden. Nada se pinta "por si acaso". */
var PUEDE = { citar: false, reaccionar: false, eliminarParaTodos: false, editar: false, presencia: false };
var filtroLista = 'todos';
var enviando = 0;
var input = document.getElementById('text');
var nuevosSinVer = 0;
/* El id del ultimo mensaje pintado: con el se sabe que es NUEVO de verdad. */
var ultimoPintadoId = 0;

/* El hilo abierto: lo del servidor mas las paginas anteriores ya cargadas.
   El refresco trae solo lo ultimo y se funde aqui, para no perder lo viejo. */
var hilo = { contactId: null, mensajes: [], masAntiguos: false, cargando: false, decisiones: [] };

function fundirHilo(contactId, nuevos, masAntiguos) {
  if (hilo.contactId !== contactId) hilo = { contactId: contactId, mensajes: [], masAntiguos: false, cargando: false, decisiones: [] };
  var porId = {};
  hilo.mensajes.forEach(function (m) { porId[m.id] = m; });
  nuevos.forEach(function (m) { porId[m.id] = m; });
  hilo.mensajes = Object.keys(porId).map(function (k) { return porId[k]; }).sort(function (a, b) {
    var ta = new Date(a.createdAt).getTime(), tb = new Date(b.createdAt).getTime();
    return ta - tb || a.id - b.id;
  });
  if (masAntiguos !== undefined) hilo.masAntiguos = masAntiguos;
  return hilo.mensajes;
}

/* ------------------------------------------------------- lista de chats */

function pasaFiltro(c) {
  if (filtroLista === 'apartados') return Boolean(c.apartadoAt);
  if (c.apartadoAt) return false;
  if (filtroLista === 'grupos') return c.tipo === 'grupo';
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
    var data = await api('/admin/chat/conversations?limit=100&incluirApartados=true&q=' + encodeURIComponent(document.getElementById('q').value.trim()));
    conversations = data.items;
    var badge = document.getElementById('unread');
    if (data.unread) { badge.textContent = data.unread; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');

    var box = document.getElementById('chats');
    var top = box.scrollTop;
    var visibles = conversations.filter(pasaFiltro);
    if (!conversations.length) {
      pintarLista(box, '<div class="empty">Todavía no hay conversaciones.<br>En cuanto alguien te escriba, aparece aquí.</div>', top);
      return;
    }
    if (!visibles.length) {
      pintarLista(box, '<div class="empty">Ninguna conversación con ese filtro.</div>', top);
      return;
    }
    var html = visibles.map(filaDeChat).join('');
    pintarLista(box, html, keepScroll ? top : 0);
  } catch (error) { toast(error.message); }
}

function filaDeChat(c) {
  var last = c.lastMessage;
  var prefijo = last && last.direction === 'out' ? tick(last.status) + ' ' : '';
  var texto = last ? (last.body || '') : 'Sin mensajes todavía';
  var grupo = c.tipo === 'grupo';
  var marcas = (c.fijadoAt ? '<span title="fijado arriba">📌</span>' : '') +
    (c.silenciadoAt ? '<span title="silenciado">🔕</span>' : '') +
    (c.apartadoAt ? '<span title="apartado de la lista">🗂</span>' : '');
  return '<div class="chat' + (current && current.id === c.contactId ? ' active' : '') + (c.silenciadoAt ? ' silenciado' : '') + '" data-id="' + esc(c.contactId) + '">' +
    (grupo ? '<div class="avatar grupo" title="Grupo de WhatsApp">👥</div>'
           : '<div class="avatar ' + colorDe(c.phone) + '" aria-hidden="true">' + esc(inicial(c.name, c.phone)) + '</div>') +
    '<div class="body"><div class="top">' +
      '<span class="name">' + esc(nombreDe(c)) + '</span>' +
      (marcas ? '<span class="marcas">' + marcas + '</span>' : '') +
      '<span class="when">' + esc(shortWhen(last ? last.createdAt : c.lastInboundAt)) + '</span>' +
    '</div><div class="last">' + prefijo + esc(texto.slice(0, 70)) +
      (c.unread ? '<span class="badge">' + c.unread + '</span>' : '') +
    '</div></div>' +
    '<button class="icon fila-menu" data-menu-fila="' + esc(c.contactId) + '" title="Opciones de esta conversación" aria-label="Opciones de esta conversación">⋮</button>' +
    '</div>';
}

/* Solo se repinta si de verdad cambio algo: antes se reescribia la lista
   entera cada 5 s y un clic que caia justo en ese instante se perdia. */
function pintarLista(box, html, scrollTop) {
  if (box.innerHTML === html) return;
  box.innerHTML = html;
  box.scrollTop = scrollTop;
}

/* El clic se escucha en el contenedor: asi sigue funcionando aunque la fila
   se haya vuelto a pintar entre que la pulsas y la sueltas. */
document.getElementById('chats').addEventListener('click', function (event) {
  var menu = event.target.closest('[data-menu-fila]');
  if (menu) { event.stopPropagation(); return menuDeConversacion(menu, menu.getAttribute('data-menu-fila')); }
  var fila = event.target.closest('.chat');
  if (fila) openChat(fila.getAttribute('data-id'));
});
document.getElementById('chats').addEventListener('contextmenu', function (event) {
  var fila = event.target.closest('.chat');
  if (!fila) return;
  event.preventDefault();
  menuDeConversacion(null, fila.getAttribute('data-id'), event.clientX, event.clientY);
});

/** El menu de una fila: fijar, silenciar, apartar, marcar como no leído. */
function menuDeConversacion(boton, contactId, x, y) {
  var c = conversations.filter(function (v) { return v.contactId === contactId; })[0];
  if (!c) return;
  var ops = [
    { icono: '📌', texto: c.fijadoAt ? 'Quitar de arriba' : 'Fijar arriba', accion: function () { ajustarLista(contactId, { fijado: !c.fijadoAt }); } },
    { icono: c.silenciadoAt ? '🔔' : '🔕', texto: c.silenciadoAt ? 'Volver a avisar' : 'Silenciar', accion: function () { ajustarLista(contactId, { silenciado: !c.silenciadoAt }); } },
    { icono: '🗂', texto: c.apartadoAt ? 'Devolver a la lista' : 'Apartar de la lista', accion: function () { ajustarLista(contactId, { apartado: !c.apartadoAt }); } },
    { icono: '●', texto: c.unread ? 'Marcar como leído' : 'Marcar como no leído', accion: function () { ajustarLista(contactId, { noLeido: !c.unread }); } },
  ];
  if (c.tipo !== 'grupo') ops.push({ hr: true }, { icono: '⟲', texto: 'Volver a empezar', accion: function () { volverAEmpezar(contactId); } }, { icono: '🗑', texto: 'Eliminar cliente', accion: function () { eliminarUnCliente(c); } });
  if (boton) menuDeBoton(boton, ops);
  else abrirMenu(ops, x, y);
}

/* Eliminar clientes: con sus mensajes, ubicaciones y fichas. No se deshace. */
async function eliminarUnCliente(c) {
  var ok = await confirmarDialogo({ titulo: 'Eliminar cliente', texto: 'Se eliminará ' + nombreDe(c) + ' con sus mensajes, ubicaciones y ficha. No se puede deshacer.', boton: 'Eliminar' });
  if (!ok) return;
  try {
    await api('/admin/contacts/eliminar', { method: 'POST', body: { ids: [c.contactId] } });
    toast('Cliente eliminado.');
    if (current && current.id === c.contactId) location.reload();
    else await loadChats(true);
  } catch (error) { toast(error.message); }
}
async function eliminarClientes() {
  var dias = await pedirDato({
    titulo: 'Eliminar clientes',
    texto: 'Deja el campo vacío para eliminar a todos los clientes, o escribe un número de días para eliminar solo los que no escriben desde hace ese tiempo. Los grupos no se tocan.',
    etiqueta: 'Días sin escribir (opcional)',
    marcador: 'Vacío = todos',
    boton: 'Siguiente',
    validar: function (v) { return v && !/^[1-9][0-9]{0,3}$/.test(v) ? 'Escribe solo un número de días.' : null; },
  });
  if (dias === null) return;
  var filtro = dias ? { todos: true, inactivosDias: Number(dias) } : { todos: true };
  try {
    var cuenta = await api('/admin/contacts/eliminar', { method: 'POST', body: Object.assign({ soloContar: true }, filtro) });
    if (!cuenta.cuantos) { toast('No hay clientes que eliminar con ese filtro.'); return; }
    var ok = await confirmarDialogo({ titulo: 'Eliminar ' + cuenta.cuantos + ' clientes', texto: 'Se eliminarán ' + cuenta.cuantos + ' clientes' + (dias ? ' que no escriben desde hace ' + dias + ' días' : '') + ', con sus mensajes, ubicaciones y fichas. No se puede deshacer.', boton: 'Eliminar ' + cuenta.cuantos });
    if (!ok) return;
    var r = await api('/admin/contacts/eliminar', { method: 'POST', body: filtro });
    toast(r.eliminados + ' clientes eliminados.');
    location.reload();
  } catch (error) { toast(error.message); }
}

async function ajustarLista(contactId, cambios) {
  try {
    await api('/admin/chat/' + contactId + '/lista', { method: 'POST', body: cambios });
    await loadChats(true);
  } catch (error) { toast(error && error.message ? error.message : 'No se pudo cambiar.'); }
}

/* ------------------------------------------------------------ abrir un chat */

async function openChat(contactId, silent) {
  if (!contactId) return;
  if (!silent) deseado = contactId;
  var mia = ++peticion;
  try {
    var data = await api('/admin/chat/' + contactId + '?limit=80&read=' + (silent ? 'false' : 'true'));
    /* Dos guardas, en este orden: el usuario ya abrio otro chat (esta
       respuesta es de otro hilo), o ya se pinto algo mas nuevo de ESTE. */
    if (deseado && deseado !== contactId) return;
    if (mia < pintado) return;
    pintado = mia;
    var nuevo = !current || current.id !== contactId;
    var otroHilo = hilo.contactId !== contactId;
    var mensajesHilo = fundirHilo(contactId, data.messages, otroHilo ? data.hasMore : undefined);
    /* Por que respondio el bot en cada turno: nota interna que se intercala en
       el hilo. Si no llegan, el chat se pinta igual, sin ellas. */
    try {
      var dec = await api('/admin/chat/' + contactId + '/decisiones?limit=200');
      if (hilo.contactId === contactId) hilo.decisiones = (dec.decisiones || []).slice().reverse();
    } catch (e) { /* sin decisiones: no es motivo para no abrir el chat */ }
    if (deseado && deseado !== contactId) return;
    current = data.contact;
    current.pedido = data.reparto ? data.reparto.referencia : null;
    current.reparto = data.reparto || null;
    PUEDE = data.puede || PUEDE;
    puedeEscribir = Boolean(data.canWrite);
    if (nuevo) { ver('ficha', false); salirDeSeleccion(); quitarCita(); cerrarBusqueda(); cerrarPaneles(); nuevosSinVer = 0; ultimoPintadoId = 0; lastCount = 0; }
    ver('confirmar-cierre', false);
    document.getElementById('app').classList.add('open-thread');
    var sApp = document.getElementById('s-app'); if (sApp) sApp.classList.add('sin-nav-movil');
    ver('thread-head', true);
    ver('placeholder', false);
    ver('messages', true);

    var esGrupo = current.tipo === 'grupo';
    ver('abrir-ficha', !esGrupo);
    var avatar = document.getElementById('t-avatar');
    avatar.textContent = esGrupo ? '👥' : inicial(current.name, current.phone);
    avatar.classList.toggle('grupo', esGrupo);
    avatar.className = 'avatar ' + (esGrupo ? 'grupo' : colorDe(current.phone));
    document.getElementById('t-name').textContent = nombreDe(current);
    pintarSubtitulo(data);

    renderMessages(mensajesHilo, nuevo);
    renderComposer(data);
    mirarPresencia();
    if (!silent) loadChats(true);
  } catch (error) { toast(error.message); }
}

/** La linea de debajo del nombre: quien es y en que estado esta. Una sola. */
function pintarSubtitulo(data) {
  var sub = document.getElementById('t-sub');
  if (current.tipo === 'grupo') {
    sub.innerHTML = '<span class="pill ok">grupo</span> aquí no contesta ningún automatismo' +
      (data.canWrite ? '' : ' · <span class="pill warn">' + esc(data.blockedReason || 'no se puede escribir') + '</span>');
    return;
  }
  /* Arriba solo lo que importa: en que paso va su pedido y si lo tiene que atender una persona.
     Lo demas (ventana de 24 h, bot callado, baja, conversaciones anteriores) va en la ficha (ⓘ). */
  current.windowOpen = Boolean(data.windowOpen);
  sub.innerHTML = '<span id="t-presencia"></span><span class="t-tel">' + esc(telefonoBonito(current.phone)) + '</span>' +
    (current.iaCerradaAt ? '<span class="pill warn t-marca" title="El asistente ya le mandó su mensaje de cierre y no contesta en este chat: contéstale tú.">Para una persona</span>' : '') +
    (data.reparto ? '<a class="t-pedido" href="/hoy' + (data.reparto.referencia ? '?buscar=' + encodeURIComponent(data.reparto.referencia) : '') + '" title="Ver en Hoy">' + esc(data.reparto.referencia ? 'Pedido ' + data.reparto.referencia : 'Reparto') + ': ' + esc(ESTADO_REPARTO[data.reparto.estado] || data.reparto.estado) + '</a>' : '');
  /* Sus conversaciones anteriores ya guardadas se cuentan y se abren desde la ficha (ⓘ). */
}

/**
 * "En línea" y "escribiendo…", solo donde se puede saber de verdad.
 *
 * Con la Cloud API de Meta ese dato no existe. En vez de inventarlo, no se
 * pinta nada: es la unica forma honesta de contarlo.
 */
var relojPresencia = null;
function mirarPresencia() {
  clearInterval(relojPresencia);
  if (!PUEDE.presencia || !current || current.tipo === 'grupo') return;
  var idChat = current.id;
  var pedir = async function () {
    if (!current || current.id !== idChat) return clearInterval(relojPresencia);
    try {
      var r = await api('/admin/chat/' + idChat + '/presencia');
      var el = document.getElementById('t-presencia');
      if (!el || !current || current.id !== idChat) return;
      var p = r.presencia;
      el.innerHTML = !p ? ''
        : p.estado === 'escribiendo' ? '<span class="escribiendo">escribiendo…</span> · '
        : p.estado === 'grabando' ? '<span class="escribiendo">grabando un audio…</span> · '
        : p.estado === 'en_linea' ? '<span class="escribiendo">en línea</span> · '
        : 'últ. vez ' + esc(shortWhen(p.desde)) + ' · ';
    } catch (error) { /* si no se puede preguntar no se inventa: se deja como esta */ }
  };
  pedir();
  relojPresencia = setInterval(pedir, 6000);
}

/* ------------------------------------------------------------- el hilo */

/** Trae la pagina anterior a lo mas viejo que hay en pantalla, sin mover la vista. */
async function cargarMasAntiguos() {
  if (!current || hilo.cargando || !hilo.masAntiguos || hilo.contactId !== current.id) return;
  var primero = hilo.mensajes[0];
  if (!primero) return;
  hilo.cargando = true;
  var box = document.getElementById('messages');
  var altoAntes = box.scrollHeight, topAntes = box.scrollTop;
  var boton = box.querySelector('.mas-antiguos button');
  if (boton) { boton.disabled = true; boton.textContent = 'Cargando…'; }
  try {
    var data = await api('/admin/chat/' + current.id + '?limit=80&before=' + primero.id);
    if (!current || hilo.contactId !== current.id) return;
    var mensajes = fundirHilo(current.id, data.messages, data.hasMore);
    renderMessages(mensajes, false, true);
    box.scrollTop = box.scrollHeight - altoAntes + topAntes;
  } catch (error) { toast(error.message); }
  finally { hilo.cargando = false; }
}

document.getElementById('messages').addEventListener('scroll', function () {
  if (this.scrollTop < 80) cargarMasAntiguos();
  pintarBotonBajar();
});
document.getElementById('messages').addEventListener('click', function (e) {
  if (e.target.closest('[data-mas-antiguos]')) cargarMasAntiguos();
});

function estaAbajo() {
  var box = document.getElementById('messages');
  return box.scrollHeight - box.scrollTop - box.clientHeight < 120;
}
function pintarBotonBajar() {
  var abajo = estaAbajo();
  if (abajo) nuevosSinVer = 0;
  ver('bajar', !abajo && Boolean(current));
  var globo = document.getElementById('bajar-nuevos');
  globo.textContent = nuevosSinVer;
  globo.classList.toggle('hidden', !nuevosSinVer);
}
document.getElementById('bajar').onclick = function () {
  var box = document.getElementById('messages');
  box.scrollTop = box.scrollHeight;
  nuevosSinVer = 0;
  pintarBotonBajar();
};

/**
 * Pinta el hilo.
 *
 * mantenerVista es la regla que evita pisar al usuario: si esta leyendo
 * arriba, un refresco no le tira la vista al final.
 */
function renderMessages(messages, scrollToEnd, mantenerVista) {
  pintados = messages;
  var box = document.getElementById('messages');
  var cerca = estaAbajo();
  if (!messages.length) {
    var vacio = current && current.tipo === 'grupo'
      ? '<div class="empty">Todavía no hay mensajes de este grupo.<br>Lo que escriban ahí aparecerá aquí, y tú puedes escribir desde abajo.</div>'
      : '<div class="empty">Sin mensajes con este contacto todavía.<br>Escríbele tú, si su ventana está abierta.</div>';
    if (box.innerHTML !== vacio) box.innerHTML = vacio;
    lastCount = 0;
    return;
  }

  var html = '', dia = '', diaPrevio = '';
  if (hilo.masAntiguos) {
    html += '<div class="mas-antiguos"><button type="button" data-mas-antiguos="1" title="También se cargan solos al subir">↑ Ver mensajes anteriores</button></div>';
  }
  /* Las decisiones del bot van por fecha entre los mensajes. Con mensajes mas
     viejos sin cargar, las anteriores al primero pintado esperan a que se
     carguen: amontonadas arriba no dirian a que turno pertenecen. */
  var decisiones = (hilo.contactId === (current && current.id) ? hilo.decisiones || [] : []).filter(function (x) {
    return !hilo.masAntiguos || new Date(x.createdAt).getTime() >= new Date(messages[0].createdAt).getTime();
  });
  var di = 0;
  function pintarDecisionesHasta(limite) {
    while (di < decisiones.length && (limite === null || new Date(decisiones[di].createdAt).getTime() <= limite)) {
      var dd = dayLabel(decisiones[di].createdAt);
      if (dd !== dia) { dia = dd; html += '<div class="day">' + esc(dd) + '</div>'; }
      html += decisionHtml(decisiones[di]);
      di++;
    }
  }
  messages.forEach(function (m, i) {
    pintarDecisionesHasta(new Date(m.createdAt).getTime());
    var d = dayLabel(m.createdAt);
    if (d !== dia) { dia = d; html += '<div class="day">' + esc(d) + '</div>'; }
    /* El primero de cada bloque lleva pico; los siguientes se pegan a el. */
    var primero = i === 0 || messages[i - 1].direction !== m.direction || d !== diaPrevio;
    diaPrevio = d;
    var soloSticker = m.kind === 'sticker' && !(m.body || '').trim();
    /* En un grupo, quien lo dijo: en el primero del bloque o al cambiar de
       persona, que es como lo hace WhatsApp. */
    var autor = m.direction === 'in' && m.payload && m.payload.autor ? m.payload.autor : null;
    var autorPrevio = i > 0 && messages[i - 1].payload && messages[i - 1].payload.autor ? messages[i - 1].payload.autor : null;
    var cambiaAutor = autor && (!autorPrevio || autorPrevio.telefono !== autor.telefono || autorPrevio.nombre !== autor.nombre);
    if (autor && (primero || cambiaAutor)) primero = true;
    /* Una cita rompe la rafaga: pegada al globo de arriba no se lee. */
    if (m.payload && m.payload.cita) primero = true;

    html += '<div class="msg ' + (m.direction === 'out' ? 'out' : 'in') +
      (primero ? ' primero' : '') + (soloSticker ? ' solo-sticker' : '') + '" data-id="' + m.id + '">' +
      (m.payload && m.payload.destacado ? '<span class="estrella" title="destacado" aria-label="destacado">★</span>' : '') +
      (m.payload && m.payload.reenviado ? '<span class="reenviado">↪ Reenviado</span>' : '') +
      (autor && primero ? autorHtml(autor) : '') +
      citaHtml(m) +
      adjuntoHtml(m) +
      anuncioHtml(m) +
      (m.payload && m.payload.transcripcion ? '<span class="transcrito" title="Lo que dijo en el audio, transcrito">🎤 dijo:</span> ' : '') +
      (m.direction === 'out' && m.payload && m.payload.media && m.payload.media.voz ? '<span class="transcrito" title="Salió como nota de voz">🔊 nota de voz:</span> ' : '') +
      ubicacionHtml(m) +
      resaltar(withLinks(cuerpoVisible(m))) +
      enlacePreviaHtml(m) +
      verUnaVezHtml(m) +
      borradoHtml(m) +
      '<span class="meta">' +
        (m.payload && m.payload.editadoAt ? '<span class="editado" title="Se editó después de enviarlo">editado</span>' : '') +
        (m.direction === 'out' && m.payload && m.payload.origen === 'ia' ? '<span class="de-ia" title="Lo escribió el asistente IA">🤖</span>' : '') +
        esc(hhmm(m.createdAt)) + (m.direction === 'out' ? ' ' + tick(m.status) : '') +
      '</span>' +
      reaccionesHtml(m) +
      '<button type="button" class="abrir-menu" title="Opciones del mensaje" aria-label="Opciones del mensaje" aria-haspopup="menu">⌄</button>' +
      '</div>';
  });
  pintarDecisionesHasta(null);

  if (box.innerHTML !== html) box.innerHTML = html;
  void cargarMedios(box);
  void cargarPrevias(box);
  if (seleccion && seleccion.length) pintarSeleccion();

  /* Lo nuevo se cuenta por id y no por cuantos hay: cargar mensajes ANTIGUOS
     tambien aumenta el total, y contarlos como nuevos ponia un globo rojo por
     algo que llevaba meses ahi. */
  var ultimo = messages[messages.length - 1].id;
  var nuevosAbajo = ultimoPintadoId ? messages.filter(function (m) { return m.id > ultimoPintadoId; }).length : 0;
  ultimoPintadoId = ultimo;

  /* Si el usuario esta leyendo arriba, lo nuevo se anuncia con el boton de
     bajar en vez de arrastrarle la vista. */
  if (!mantenerVista && (scrollToEnd || cerca)) box.scrollTop = box.scrollHeight;
  else if (nuevosAbajo && !mantenerVista) nuevosSinVer += nuevosAbajo;
  lastCount = messages.length;
  pintarBotonBajar();
}

/* Una decision del bot: linea gris, pequena y centrada, que deja claro que es
   una nota interna. El cliente no la ve; esta para saber por que el bot dijo
   lo que dijo (o se callo) y corregir la regla si se equivoco. */
function decisionHtml(x) {
  var extra = [];
  if (x.esperaba) extra.push('esperaba: ' + x.esperaba);
  if (x.detalle) extra.push(x.detalle);
  return '<div class="decision-bot" role="note" title="Nota interna: el cliente no la ve">' +
    '<span class="decision-etq">Nota interna · el cliente no la ve</span>' +
    '<span class="decision-txt">' + esc(x.resumen || '') + '</span>' +
    (extra.length ? '<span class="decision-extra">' + esc(extra.join(' · ')) + '</span>' : '') +
    '<span class="decision-hora">' + esc(hhmm(x.createdAt)) + '</span>' +
    '</div>';
}

function autorHtml(autor) {
  var nombre = autor.nombre || autor.telefono || 'Alguien del grupo';
  return '<span class="autor ' + colorDe(autor.telefono || nombre) + '">' + esc(nombre) +
    (autor.telefono && autor.nombre ? '<span class="tel">' + esc(autor.telefono) + '</span>' : '') + '</span>';
}

function anuncioHtml(m) {
  var a = m.payload && m.payload.anuncio;
  if (!a) return '';
  return '<span class="transcrito" title="Escribió desde un anuncio de Facebook/Instagram' + (a.url ? ': ' + esc(a.url) : '') + '">📣 desde el anuncio' + (a.titulo ? ' «' + esc(a.titulo) + '»' : '') + '</span><br>';
}

/** Lo que alguien quito: aqui se conserva, y se dice de quien fue la mano. */
function borradoHtml(m) {
  if (!m.payload || !m.payload.borradoPorRemitente) return '';
  var texto = m.direction === 'out' ? '🗑 Lo eliminaste para todos · aquí se conserva' : '🗑 Lo eliminó para todos · aquí se conserva';
  return '<span class="borrado" title="' + esc(hhmm(m.payload.borradoPorRemitente)) + '">' + texto + '</span>';
}

/*
 * El "ver una vez" que WhatsApp no entrego: el cuerpo ya lo explica; aqui va
 * el boton para pedirle al cliente que lo mande normal. En un grupo no se
 * pide: seria escribirle a todos.
 */
function verUnaVezHtml(m) {
  if (m.direction !== 'in' || !m.payload || !m.payload.viewOnce) return '';
  if (current && current.tipo === 'grupo') return '';
  return '<span class="solo-telefono"><button type="button" data-pedir-normal="1">Pedirle que la mande normal</button></span>';
}

/*
 * El texto del mensaje, sin la etiqueta de relleno.
 *
 * Cuando un adjunto llega sin pie, el cuerpo que se guarda es "(foto)" o
 * "(sticker)": sirve para la lista de conversaciones, donde no hay sitio para
 * pintar nada. En el hilo sobra -o esta la imagen, o esta el aviso de que no
 * se pudo bajar- y verlo escrito debajo parece un error.
 */
function cuerpoVisible(m) {
  if (m.kind === 'location' && m.payload && m.payload.location) return '';
  var cuerpo = (m.body || '').trim();
  var relleno = ['(foto)', '(sticker)', '(audio)', '(video)', '(documento)', '(adjunto)', '(ubicacion)'];
  return relleno.indexOf(cuerpo) === -1 ? (m.body || '') : '';
}

/**
 * El pin que mando el cliente: las coordenadas se ven aqui (para el equipo)
 * con el enlace al mapa y un boton para copiarlas. Al cliente nunca se le
 * mandan las coordenadas: solo el enlace.
 */
function ubicacionHtml(m) {
  var loc = m.payload && m.payload.location;
  if (m.kind !== 'location' || !loc) return '';
  var lat = Number(loc.latitude), lng = Number(loc.longitude);
  if (!isFinite(lat) || !isFinite(lng)) return '';
  var coords = lat.toFixed(6) + ', ' + lng.toFixed(6);
  var url = 'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lng;
  return '<div class="pin-cliente"><span class="pin-titulo">📍 Ubicación' + (loc.name ? ' · ' + esc(loc.name) : '') + '</span>' +
    '<span class="pin-coords">' + coords + '</span>' +
    '<span class="pin-acciones"><a href="' + esc(url) + '" target="_blank" rel="noopener">Abrir en el mapa</a>' +
    '<button type="button" class="pin-copiar" data-copiar="' + esc(coords) + '" aria-label="Copiar las coordenadas">Copiar</button></span>' +
    '<span class="pin-nota">Las coordenadas las ves tú; al cliente solo le llega el enlace.</span></div>';
}

/**
 * El hueco del adjunto.
 *
 * Se pinta vacio y con su id: el fichero se pide despues, porque va detras de
 * la sesion de administracion y una etiqueta <img> no manda cabeceras.
 */
function adjuntoHtml(m) {
  var media = m.payload && m.payload.media;
  if (!media || !media.id) return sinFicheroHtml(m.kind);

  var kind = media.kind || m.kind;
  if (kind === 'sticker' && media.url) return '<img class="adjunto sticker" src="' + esc(media.url) + '" alt="sticker">';
  var attrs = ' class="adjunto' + (kind === 'sticker' ? ' sticker' : '') + '" data-media="' + esc(media.id) + '" data-kind="' + esc(kind) + '"';

  /* Lo que en el telefono se abre una sola vez y desaparece, aqui se queda:
     se dice para que el operador sepa que en el movil ya no lo encontrara. */
  var unaVez = media.verUnaVez
    ? '<span class="una-vez" title="El cliente la mandó como “ver una vez”: en el teléfono desaparece al abrirla, aquí queda guardada">👁 Ver una vez · guardada aquí</span>'
    : '';

  if (kind === 'image') return unaVez + '<img' + attrs + ' alt="foto">';
  if (kind === 'sticker') return unaVez + '<img' + attrs + ' alt="sticker">';
  if (kind === 'video') return unaVez + '<video' + attrs + ' controls playsinline></video>';
  if (kind === 'audio') return unaVez + '<audio' + attrs + ' controls preload="none"></audio>';

  var nombre = media.filename || 'documento';
  return unaVez + '<a' + attrs + ' class="adjunto fichero" download="' + esc(nombre) + '">' +
    '<span aria-hidden="true">📄</span><b>' + esc(nombre) + '</b>' +
    (media.bytes ? '<span class="cargando">' + esc(pesoLegible(media.bytes)) + '</span>' : '') +
    '</a>';
}

/*
 * El adjunto que nunca llego a bajarse.
 *
 * El mensaje se guarda igual -perderlo entero seria peor-, pero sin fichero el
 * hilo ensenaba un "(sticker)" suelto que se lee como un fallo de la pantalla.
 */
function sinFicheroHtml(kind) {
  var nombres = { sticker: 'un sticker', image: 'una foto', video: 'un video', audio: 'un audio', document: 'un documento' };
  if (!nombres[kind]) return '';
  return '<div class="cargando">Mandaron ' + nombres[kind] + ' y no se pudo descargar.</div>';
}

/* Un adjunto ya bajado no cambia nunca -su id sale del wamid-, asi que se
   guarda la URL y no se vuelve a pedir en cada repintado del hilo. */
var mediaCache = {};

/**
 * Rellena los huecos de adjunto que haya en pantalla.
 *
 * Se pide con fetch y no con <img src>, porque asi la sesion viaja en la
 * cookie y no en la URL, que acabaria en el historial y en los logs.
 */
async function cargarMedios(box) {
  var pendientes = box.querySelectorAll('[data-media]:not([data-listo])');
  for (var i = 0; i < pendientes.length; i++) {
    var el = pendientes[i];
    var id = el.getAttribute('data-media');
    el.setAttribute('data-listo', '1');
    try {
      if (!mediaCache[id]) {
        var res = await fetch('/admin/local/media/' + encodeURIComponent(id), { credentials: 'same-origin' });
        if (!res.ok) throw new Error('no se pudo cargar');
        mediaCache[id] = URL.createObjectURL(await res.blob());
      }
      if (el.tagName === 'A') el.setAttribute('href', mediaCache[id]);
      else el.setAttribute('src', mediaCache[id]);
    } catch (error) {
      el.removeAttribute('data-listo');
      if (el.tagName !== 'A') {
        var aviso = document.createElement('div');
        aviso.className = 'cargando';
        aviso.textContent = 'No se pudo cargar el adjunto.';
        el.replaceWith(aviso);
      }
    }
  }
}

/* ---------------------------------------------------- previa de un enlace */

var previasEnlace = {};

/** El hueco de la previa. Se rellena despues, si el otro sitio contesta. */
function enlacePreviaHtml(m) {
  var media = m.payload && m.payload.media;
  if (media && media.id) return '';
  var url = primerEnlace(cuerpoVisible(m));
  if (!url) return '';
  var p = previasEnlace[url];
  /* 'no' = ya se intento y no hay nada; 'pidiendo' = se esta trayendo. En los
     dos casos no se pinta nada: un hueco a medias parece un fallo. */
  if (p === 'no' || p === 'pidiendo') return '';
  if (!p) return '<span data-previa="' + esc(url) + '"></span>';
  return '<a class="enlace-previa" href="' + esc(url) + '" target="_blank" rel="noreferrer">' +
    (p.imagen ? '<img src="' + esc(p.imagen) + '" alt="" loading="lazy">' : '') +
    '<span class="txt">' + (p.titulo ? '<span class="t">' + esc(p.titulo) + '</span>' : '') +
    (p.descripcion ? '<span class="d">' + esc(p.descripcion) + '</span>' : '') +
    '<span class="s">' + esc(p.sitio) + '</span></span></a>';
}

/**
 * Pide las previas que falten.
 *
 * Una por enlace y para siempre: si el sitio no contesta se apunta 'no' y no
 * se vuelve a intentar, para no repetir la misma peticion en cada refresco.
 */
async function cargarPrevias(box) {
  var huecos = box.querySelectorAll('[data-previa]');
  var urls = {};
  for (var i = 0; i < huecos.length; i++) urls[huecos[i].getAttribute('data-previa')] = true;
  var pendientes = Object.keys(urls).filter(function (u) { return !previasEnlace[u]; });
  if (!pendientes.length) return;
  for (var k = 0; k < Math.min(pendientes.length, 4); k++) {
    var url = pendientes[k];
    previasEnlace[url] = 'pidiendo';
    try {
      var p = await api('/admin/chat/previa?url=' + encodeURIComponent(url));
      previasEnlace[url] = p.titulo || p.descripcion || p.imagen ? p : 'no';
    } catch (error) {
      previasEnlace[url] = 'no';
    }
  }
  if (current) renderMessages(hilo.mensajes, false, true);
}

/* ---------------------------------------------------------- acciones sueltas */

/* Copiar unas coordenadas (o cualquier cosa con data-copiar). */
document.addEventListener('click', function (ev) {
  var b = ev.target && ev.target.closest ? ev.target.closest('[data-copiar]') : null;
  if (!b) return;
  copiar(b.getAttribute('data-copiar') || '');
});

/* Pedir que manden la foto de "ver una vez" como foto normal. */
document.addEventListener('click', function (event) {
  var pedir = event.target.closest('[data-pedir-normal]');
  if (!pedir || !current) return;
  event.preventDefault();
  if (!enviando) enviar({ text: TEXTO_VER_UNA_VEZ });
});

/* Clic en una foto o un video: se ve a tamano completo. */
document.addEventListener('click', function (e) {
  var el = e.target;
  if (!el || !el.getAttribute || !el.getAttribute('data-media')) return;
  if (el.tagName !== 'IMG' && el.tagName !== 'VIDEO') return;
  if (seleccion && seleccion.length) return;
  var visor = document.createElement('div');
  visor.className = 'visor';
  var copia = el.cloneNode(true);
  copia.removeAttribute('data-media');
  if (copia.tagName === 'VIDEO') copia.setAttribute('controls', '');
  visor.appendChild(copia);
  visor.onclick = function () { visor.remove(); };
  document.body.appendChild(visor);
});

/* "¿Qué pasó con este mensaje?": la traza de punta a punta, en palabras. */
async function verTraza(m) {
  if (!current) return;
  try {
    var t = await api('/admin/mensajes/' + m.id + '/traza?contacto=' + encodeURIComponent(current.id));
    mostrarTraza(t);
  } catch (error) { toast(error && error.message ? error.message : 'No se pudo leer la traza.'); }
}
function mostrarTraza(t) {
  var fondo = document.createElement('div');
  fondo.className = 'dlg-fondo';
  var pasos = t.pasos.map(function (p) { return '<li class="' + esc(p.tono) + '"><i></i><span>' + esc(p.que) + (p.cuando ? '<small>' + esc(fechaCorta(p.cuando)) + '</small>' : '') + '</span></li>'; }).join('');
  var otros = t.otrosIntentos.length ? '<p class="traza-cab" style="margin-top:12px"><b>Cerca de esa hora tampoco salió:</b></p><ul class="traza">' + t.otrosIntentos.map(function (o) { return '<li class="bad"><i></i><span>' + esc(o.que) + ': ' + esc(o.motivo) + '<small>' + esc(fechaCorta(o.cuando)) + '</small></span></li>'; }).join('') + '</ul>' : '';
  fondo.innerHTML = '<div class="dlg" role="dialog" aria-modal="true" style="width:min(520px,100%)"><h3>Qué pasó con este mensaje</h3>' +
    '<p class="traza-cab">' + esc(t.quien) + ' ' + esc(t.como) + ' Estado: <b>' + esc(t.estado) + '</b>.</p>' +
    '<ul class="traza">' + pasos + '</ul>' + otros +
    '<div class="botones"><button type="button" id="dlg-si" class="principal">Cerrar</button></div></div>';
  function cerrar() { document.removeEventListener('keydown', teclas); fondo.remove(); }
  function teclas(ev) { if (ev.key === 'Escape' || ev.key === 'Enter') cerrar(); }
  fondo.querySelector('#dlg-si').onclick = cerrar;
  fondo.onclick = function (ev) { if (ev.target === fondo) cerrar(); };
  document.addEventListener('keydown', teclas);
  document.body.appendChild(fondo);
}

/* Lo que contesto una persona justo despues de ese mensaje, si lo hubo. */
function respuestaSiguiente(messages, i) {
  for (var k = i + 1; k < messages.length; k++) {
    var m = messages[k];
    if (m.direction === 'in') return '';
    if (m.kind === 'text' && (m.body || '').trim() && !(m.payload && m.payload.origen === 'ia')) return m.body;
  }
  return '';
}
/* Lo ultimo que dijo el cliente antes de ese mensaje. */
function preguntaAnterior(messages, i) {
  for (var k = i - 1; k >= 0; k--) {
    var m = messages[k];
    if (m.direction === 'in' && m.kind === 'text' && (m.body || '').trim()) return m.body;
  }
  return '';
}

/**
 * Ensenarle al asistente desde el globo: en lo que dijo el cliente, la
 * respuesta que debio dar; en lo que contesto el asistente, la correccion.
 */
async function ensenarDesdeMensaje(m, corrigiendo) {
  var i = pintados.indexOf(m);
  var v = corrigiendo
    ? await pedirLeccion({ titulo: 'Corregir al asistente', texto: 'Escribe lo que debió responder. Desde ahora, ante una pregunta parecida, contestará así y no repetirá lo de abajo.', pregunta: preguntaAnterior(pintados, i), respuesta: '', mala: m.body, boton: 'Corregir' })
    : await pedirLeccion({ titulo: 'Enséñale al asistente', texto: 'Cuando otro cliente pregunte algo parecido, el asistente responderá así.', pregunta: m.body, respuesta: respuestaSiguiente(pintados, i), boton: 'Enseñar' });
  if (!v) return;
  try {
    var r = await api('/admin/entrenamiento/lecciones', { method: 'POST', body: {
      tipo: 'ejemplo', pregunta: v.pregunta, respuesta: v.respuesta, tema: v.tema || null, mala: v.mala || null,
      origen: corrigiendo ? 'correccion' : 'chat', origenDetalle: (current.name ? current.name + ' (' + current.phone + ')' : current.phone)
    } });
    toast(r.nueva ? (corrigiendo ? 'Corregido: el asistente ya lo sabe.' : 'El asistente ya lo sabe.') : 'Esa lección ya la tenía.');
  } catch (error) { toast(error && error.message ? error.message : 'No se pudo guardar.'); }
}

/* ------------------------------------------------------------- la ficha */

function estadoEntregaEnPalabras(e) {
  var por = { pendiente: 'Pendiente', esperando_ubicacion: 'Falta su ubicación', esperando_confirmacion: 'Falta que confirme', lista: 'Lista para salir', esperando_motorizado: 'Ubicación y confirmación registradas', avisada: 'En camino', entregada: 'Entregada', terminada: 'Terminada', cancelada: 'Cancelada', incidencia: 'Necesita a alguien' };
  return por[e.estado] || e.estado;
}
async function abrirFicha() {
  if (!current) return;
  var panel = document.getElementById('ficha'), cuerpo = document.getElementById('ficha-cuerpo');
  panel.classList.remove('hidden');
  cuerpo.innerHTML = '<p class="muted">Cargando…</p>';
  try {
    var f = await api('/admin/chat/' + current.id + '/ficha');
    var c = f.contacto;
    /* El estado del chat: lo que antes llenaba la cabecera de pildoras. */
    var marcas = [];
    if (c.optOutAt) marcas.push('<span class="pill bad">Dado de baja</span>');
    else if (current.windowOpen) marcas.push('<span class="pill ok">Puede recibir mensajes</span>');
    else marcas.push('<span class="pill warn" title="Pasaron más de 24 horas desde su último mensaje: solo se le puede escribir con una plantilla aprobada.">Fuera de las 24 h</span>');
    if (c.botPausadoAt || current.botPausadoAt) marcas.push('<span class="pill warn">Bot callado</span>');
    if (current.iaCerradaAt) marcas.push('<span class="pill warn">Para una persona</span>');
    var html = '<div><h4>Este chat</h4><div class="fila">' + marcas.join('') + '<button class="sm" type="button" id="ficha-baja">' + (c.optOutAt ? 'Dar de alta' : 'Dar de baja') + '</button></div></div>' +
      '<div><h4>Quién es</h4><div class="fila"><b>' + esc(c.name || 'Sin nombre') + '</b><span class="muted">' + esc(telefonoBonito(c.phone)) + '</span></div>' +
      '<div class="muted" style="margin-top:4px">' + (c.optOutAt ? 'Dado de baja por el equipo: solo se le contesta si escribe.' : c.optInAt ? 'Se le puede escribir (dio su consentimiento).' : 'Sin consentimiento todavía: se le contesta cuando escribe; no se le inicia conversación.') + (c.botPausadoAt ? ' Las respuestas automáticas están calladas en este chat.' : '') + (c.lastInboundAt ? ' Último mensaje suyo: ' + hhmm(c.lastInboundAt) + '.' : '') + '</div></div>';
    if (f.entrega) {
      var e = f.entrega;
      html += '<div><h4>Su pedido de hoy</h4><div class="fila"><b>' + esc(e.referencia) + '</b><span class="chip">' + esc(estadoEntregaEnPalabras(e)) + '</span>' + (e.prioridad === 'urgente' ? '<span class="chip tono-rojo">Urgente</span>' : '') + '</div>' +
        '<div class="muted" style="margin-top:4px">' + esc((e.direccion || '') + (e.distrito ? ', ' + e.distrito : '')) + (e.llegaAproxAt ? ' · llega alrededor de las ' + hhmm(e.llegaAproxAt) : '') + (e.entregadaAt ? ' · entregado a las ' + hhmm(e.entregadaAt) : '') + '</div>' +
        '<div class="fila" style="margin-top:6px"><a class="sm" href="/hoy?buscar=' + encodeURIComponent(e.referencia) + '">Abrir en Hoy</a></div></div>';
    } else html += '<div><h4>Su pedido de hoy</h4><div class="muted">No tiene ningún pedido en la lista de hoy.</div></div>';
    if (!(current && current.tipo === 'grupo') && /^\d{8,}$/.test(String(c.phone || ''))) {
      html += '<div class="ficha-acciones"><a class="principal" href="tel:+' + esc(String(c.phone)) + '">📞 Llamar</a>' + (f.ubicacion ? '<a href="' + esc(f.ubicacion.mapa) + '" target="_blank" rel="noopener">🗺 Abrir en el mapa</a>' : '') + '</div>';
    }
    if (f.ubicacion) {
      var coords = Number(f.ubicacion.lat).toFixed(6) + ', ' + Number(f.ubicacion.lng).toFixed(6);
      html += '<div><h4>Su última ubicación</h4><div class="fila"><span class="pin-coords">' + coords + '</span></div><div class="fila" style="margin-top:6px"><a class="sm" href="' + esc(f.ubicacion.mapa) + '" target="_blank" rel="noopener">Abrir en el mapa</a><button class="sm" type="button" data-copiar="' + esc(coords) + '" aria-label="Copiar las coordenadas">Copiar</button></div><div class="muted" style="margin-top:4px;font-size:12px">Las coordenadas las ves tú; al cliente solo le llega el enlace.</div></div>';
    } else html += '<div><h4>Su última ubicación</h4><div class="muted">Todavía no ha mandado ninguna. Con «Pedirle su ubicación» (menú ＋) se le manda el botón.</div></div>';
    html += '<div><h4>Conversaciones guardadas</h4><div class="fila">' + (f.guardadas ? '<a class="sm" href="/guardados?tel=' + encodeURIComponent(c.phone) + '">Ver las ' + f.guardadas + ' guardada' + (f.guardadas === 1 ? '' : 's') + '</a>' : '<span class="muted">Ninguna todavía.</span>') + '<a class="sm" href="/panel#contactos">Ficha completa</a></div></div>';
    cuerpo.innerHTML = html;
    document.getElementById('ficha-baja').onclick = async function () {
      this.disabled = true;
      try {
        await api(c.optOutAt ? '/admin/contacts/opt-in' : '/admin/contacts/opt-out', { method: 'POST', body: c.optOutAt ? { phone: c.phone, source: 'alta desde el chat' } : { phone: c.phone } });
        toast(c.optOutAt ? 'Contacto dado de alta.' : 'Contacto dado de baja.');
        abrirFicha();
      } catch (error) { toast(error.message); this.disabled = false; }
    };
  } catch (e) { cuerpo.innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; }
}
document.getElementById('abrir-ficha').onclick = function () {
  if (!current || current.tipo === 'grupo') return;
  if (document.getElementById('ficha').classList.contains('hidden')) abrirFicha();
  else document.getElementById('ficha').classList.add('hidden');
};
document.getElementById('ficha-cerrar').onclick = function () { document.getElementById('ficha').classList.add('hidden'); };

/* --------------------------------------------------------- pausar el bot */

/**
 * "De este me encargo yo": los mensajes del cliente siguen entrando y se le
 * puede escribir a mano; lo unico que se calla es la respuesta automatica.
 */
async function alternarBot() {
  if (!current) return;
  var pausar = !current.botPausadoAt;
  try {
    await api('/admin/chat/' + current.id + '/bot', { method: 'POST', body: { pausado: pausar } });
    current.botPausadoAt = pausar ? new Date().toISOString() : null;
    toast(pausar ? 'Bot callado en este chat: lo atiendes tú.' : 'El bot vuelve a contestar en este chat.');
    openChat(current.id, true);
  } catch (e) { toast('No se pudo cambiar: ' + (e.message || e)); }
}

/**
 * El agente operativo cerró este chat (mandó su cierre o registró la
 * ubicación): una persona lo atiende. Esto lo devuelve al asistente.
 */
async function reabrirAsistente() {
  if (!current) return;
  try {
    await api('/admin/chat/' + current.id + '/asistente', { method: 'POST', body: { cerrado: false } });
    current.iaCerradaAt = null;
    toast('El asistente vuelve a atender este chat.');
    openChat(current.id, true);
  } catch (e) { toast('No se pudo cambiar: ' + (e.message || e)); }
}

/* Ya se terminó con este cliente: que su próximo pedido empiece de cero. */
async function volverAEmpezar(contactId) {
  var ok = await confirmarDialogo({ titulo: 'Volver a empezar', texto: 'El asistente y el bot vuelven a atender a este cliente desde el principio, para su próximo pedido. Sus mensajes y pedidos anteriores se quedan.', boton: 'Volver a empezar' });
  if (!ok) return;
  try {
    await api('/admin/chat/' + contactId + '/volver-a-empezar', { method: 'POST', body: {} });
    toast('Listo: este cliente empieza de nuevo.');
    if (current && current.id === contactId) { current.iaCerradaAt = null; current.botPausadoAt = null; openChat(contactId, true); }
    await loadChats(true);
  } catch (e) { toast('No se pudo: ' + (e.message || e)); }
}

/* ------------------------------------------------------ menu de la cabecera */

document.getElementById('menu-chat').onclick = function () {
  if (!current) return;
  var esGrupo = current.tipo === 'grupo';
  var c = conversations.filter(function (v) { return v.contactId === current.id; })[0] || {};
  var ops = [];
  if (!esGrupo) ops.push({ icono: 'ⓘ', texto: 'Ficha del cliente', accion: abrirFicha });
  if (!esGrupo && /^\d{8,}$/.test(String(current.phone || ''))) {
    ops.push({ icono: '📞', texto: 'Llamar', accion: function () { location.href = 'tel:+' + current.phone; } });
  }
  if (!esGrupo) ops.push({ icono: '🤖', texto: current.botPausadoAt ? 'Que el bot vuelva a contestar' : 'Callar al bot en este chat', accion: alternarBot });
  if (!esGrupo && current.iaCerradaAt) ops.push({ icono: '↩', texto: 'Que el asistente vuelva a atender este chat', accion: reabrirAsistente });
  if (!esGrupo) ops.push({ icono: '⟲', texto: 'Volver a empezar con este cliente', accion: function () { volverAEmpezar(current.id); } });
  ops.push({ icono: '⭐', texto: 'Mensajes destacados de este chat', accion: function () { verDestacados(true); } });
  ops.push({ hr: true });
  ops.push({ icono: '📌', texto: c.fijadoAt ? 'Quitar de arriba' : 'Fijar arriba', accion: function () { ajustarLista(current.id, { fijado: !c.fijadoAt }); } });
  ops.push({ icono: c.silenciadoAt ? '🔔' : '🔕', texto: c.silenciadoAt ? 'Volver a avisar' : 'Silenciar', accion: function () { ajustarLista(current.id, { silenciado: !c.silenciadoAt }); } });
  ops.push({ icono: '🗂', texto: c.apartadoAt ? 'Devolver a la lista' : 'Apartar de la lista', accion: function () { ajustarLista(current.id, { apartado: !c.apartadoAt }); } });
  if (PROVEEDOR === 'local') {
    ops.push({ hr: true });
    ops.push({ icono: '⤒', texto: 'Traer mensajes anteriores del teléfono', accion: traerHistorialDeEsteChat });
    ops.push({ icono: '⟳', texto: 'Traer lo que falta del teléfono', accion: sincronizarEsteChat });
  }
  ops.push({ hr: true });
  ops.push({ icono: '🗄', texto: 'Guardar el chat y vaciarlo', accion: pedirCierre });
  if (!esGrupo) ops.push({ icono: '🗑', texto: 'Eliminar cliente', accion: function () { eliminarUnCliente({ contactId: current.id, name: current.name, phone: current.phone }); } });
  menuDeBoton(this, ops);
};

document.getElementById('abrir-busqueda').onclick = function () {
  if (document.getElementById('buscar-hilo').classList.contains('hidden')) abrirBusqueda();
  else cerrarBusqueda();
};

/* --------------------------------------------------- menu de la columna */

document.getElementById('menu-lista').onclick = function () {
  var ops = [
    // El lector de los chats guardados vive en /guardados y es mucho mejor
    // que el que habia aqui (resumen, etiquetas, notas, adjuntos, buscador,
    // PDF, compartir). Mantener dos era pagar cada mejora dos veces.
    { icono: '📁', texto: 'Chats guardados', accion: function () { location.href = '/guardados'; } },
    { icono: '⭐', texto: 'Todos los mensajes destacados', accion: function () { verDestacados(false); } },
    ${opcionHistorial ? `${opcionHistorial},` : ''}
    { hr: true },
    { icono: '🗑', texto: 'Eliminar clientes…', accion: eliminarClientes },
    { hr: true },
    { icono: '⌨', texto: 'Atajos de teclado', accion: ayudaTeclas },
  ];
  menuDeBoton(this, ops);
};

document.getElementById('nuevo').onclick = async function () {
  var tel = await pedirCelular();
  if (!tel) return;
  try {
    var r = await api('/admin/chat/start', { method: 'POST', body: { phone: tel } });
    await loadChats();
    openChat(r.contact.id);
  } catch (error) { toast(error.message); }
};

document.getElementById('back').onclick = function () {
  document.getElementById('app').classList.remove('open-thread');
  var sApp = document.getElementById('s-app'); if (sApp) sApp.classList.remove('sin-nav-movil');
};

var buscando;
document.getElementById('q').addEventListener('input', function () {
  clearTimeout(buscando);
  buscando = setTimeout(loadChats, 250);
});

/* ------------------------------------------------------------- enviar */

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

async function enviar(payload) {
  if (!current) return;
  var pendiente = null;
  if (payload.text) pendiente = pintarPendiente((payload.voz ? '🔊 ' : '') + payload.text);
  else if (payload.askLocation) pendiente = pintarPendiente('📍 Solicitud de ubicación');
  else if (payload.location) pendiente = pintarPendiente('🗺 Pin: ' + payload.location);
  if (enviando && (payload.askLocation || payload.text)) { toast('Espera: todavía está saliendo el anterior.'); if (pendiente) pendiente.remove(); return; }
  var boton = document.getElementById('send');
  var barra = document.getElementById('rapidas-barra');
  enviando++;
  if (boton) boton.disabled = true;
  if (barra) barra.classList.add('ocupada');
  var cita = citaPendiente;
  quitarCita();
  try {
    payload.contactId = current.id;
    if (cita) payload.citaId = cita;
    var r = await api('/admin/chat/send', { method: 'POST', body: payload });
    if (r.ok === false) {
      if (pendiente) pendiente.remove();
      toast('No salió: ' + (r.reason || r.error || 'bloqueado por las guardas'));
    } else if (payload.voz && r.voz && !r.voz.enviada) {
      toast('Salió por escrito, no como audio: ' + (r.voz.motivo || 'la voz no está lista'));
    }
    await openChat(current.id, true);
    loadChats(true);
  } catch (error) { if (pendiente) pendiente.remove(); toast(error.message); }
  finally { enviando--; if (!enviando) { if (boton) boton.disabled = false; if (barra) barra.classList.remove('ocupada'); } }
}

async function mandarTexto() {
  var texto = input.value.trim();
  if (!texto) return;
  if (enviando) { toast('Espera: todavía está saliendo el anterior.'); return; }
  input.value = '';
  ajustarAlto();
  pintarBotonDeEnviar();
  await enviar({ text: texto });
}
document.getElementById('send').onclick = mandarTexto;

input.addEventListener('input', function () {
  ajustarAlto();
  pintarBotonDeEnviar();
  atajosDesdeTexto();
});
input.addEventListener('keydown', function (e) {
  if (atajosAbierto()) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moverAtajo(1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); moverAtajo(-1); return; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); elegirAtajo(); return; }
    if (e.key === 'Escape') { e.preventDefault(); cerrarAtajos(); return; }
  }
  if (e.key === 'Escape' && citaPendiente) { e.preventDefault(); quitarCita(); return; }
  /* Enter manda; Shift+Enter hace salto de linea, como en WhatsApp Web. */
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); mandarTexto(); }
});

/* --------------------------------------------------- compositor bloqueado */

function renderComposer(data) {
  var composer = document.getElementById('composer');
  var locked = document.getElementById('locked');
  var barra = document.getElementById('rapidas-barra');
  if (!composer || !locked) return;

  if (data.canWrite) {
    ver('composer', true);
    locked.classList.add('hidden');
    pintarBarraRapidas();
    pintarBotonDeEnviar();
    return;
  }

  ver('composer', false);
  ver('grabando', false);
  barra.classList.add('hidden');
  cerrarPaneles();
  locked.classList.remove('hidden');

  if (data.contact && data.contact.tipo === 'grupo') {
    locked.innerHTML = '<b>' + esc(data.blockedReason || 'En este grupo no se puede escribir.') + '</b><br>Los grupos se atienden con el WhatsApp vinculado por QR en <a class="link" href="/setup">Conectar</a>.';
    return;
  }
  if (data.contact.optOutAt) {
    locked.innerHTML = '<b>Este contacto se dio de baja.</b><br>No se le puede escribir: una baja ignorada se convierte en bloqueo, y el bloqueo sí castiga la calidad del número.';
    return;
  }

  var aprobadas = templates.filter(function (t) { return t.status === 'APPROVED'; });
  locked.innerHTML = '<b>Pasaron más de 24 horas desde su último mensaje.</b><br>' +
    'WhatsApp solo deja retomar la conversación con una plantilla aprobada. En cuanto conteste, puedes escribirle libre otra vez.' +
    '<div class="actions">' +
      (aprobadas.length
        ? '<select id="tpl" aria-label="Plantilla">' + aprobadas.map(function (t) {
            return '<option value="' + esc(t.name + '|' + t.language) + '" data-vars="' + t.variables + '">' +
              esc(t.name + ' (' + t.variables + ' variables)') + '</option>';
          }).join('') + '</select>' +
          '<input id="tpl-vars" placeholder="Variables separadas por coma" aria-label="Variables de la plantilla">' +
          '<button class="primary" id="send-tpl">Enviar plantilla</button>'
        : '<span>No tienes ninguna plantilla aprobada todavía. <a class="link" href="/panel#plantillas">Darlas de alta</a></span>') +
    '</div>';

  var boton = document.getElementById('send-tpl');
  if (boton) boton.onclick = async function () {
    var partes = document.getElementById('tpl').value.split('|');
    var vars = document.getElementById('tpl-vars').value.split(',').map(function (v) { return v.trim(); }).filter(Boolean);
    await enviar({ templateName: partes[0], templateLanguage: partes[1], variables: vars });
  };
}

async function loadTemplates() {
  try { templates = await api('/admin/templates'); }
  catch (error) { templates = []; console.log('[chat] no se pudo leer el catálogo de plantillas:', error && error.message); }
}

/* --------------------------------------------------------------- teclado */

function enCampo(el) { return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'); }
function chatVecino(d) {
  var visibles = conversations.filter(pasaFiltro);
  if (!visibles.length) return;
  var i = current ? visibles.findIndex(function (c) { return c.contactId === current.id; }) : -1;
  var j = i < 0 ? 0 : (i + d + visibles.length) % visibles.length;
  openChat(visibles[j].contactId);
}
document.addEventListener('keydown', function (e) {
  if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); chatVecino(1); return; }
  if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); chatVecino(-1); return; }
  var conCtrl = (e.ctrlKey || e.metaKey) && e.shiftKey;
  if (conCtrl && (e.key === 'U' || e.key === 'u')) { e.preventDefault(); if (current && puedeEscribir) enviar({ askLocation: true }); return; }
  if (conCtrl && (e.key === 'L' || e.key === 'l')) { e.preventDefault(); if (current && puedeEscribir) pedirPin(); return; }
  if (conCtrl && (e.key === 'I' || e.key === 'i')) { e.preventDefault(); if (current) { var f = document.getElementById('ficha'); f.classList.contains('hidden') ? abrirFicha() : f.classList.add('hidden'); } return; }
  if (conCtrl && (e.key === 'B' || e.key === 'b')) { e.preventDefault(); if (current) alternarBot(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F') && current) { e.preventDefault(); abrirBusqueda(); return; }
  if (e.key === '/' && !enCampo(document.activeElement)) {
    e.preventDefault();
    if (current && puedeEscribir) { input.focus(); input.value = '/'; atajosDesdeTexto(); }
    else document.getElementById('q').focus();
    return;
  }
  if (e.key === 'F1' || ((e.ctrlKey || e.metaKey) && e.key === '/')) { e.preventDefault(); ayudaTeclas(); return; }
  if (e.key !== 'Escape') return;
  /* Esc cierra lo mas "de encima" primero: visor, ayuda, seleccion, cita,
     busqueda, panel, campo y, al final, vuelve a la lista. */
  var visor = document.querySelector('.visor');
  if (visor) { visor.remove(); return; }
  var ayuda = document.querySelector('.ayuda-teclas');
  if (ayuda) { ayuda.remove(); return; }
  if (seleccion && seleccion.length) { salirDeSeleccion(); return; }
  if (citaPendiente) { quitarCita(); return; }
  if (!document.getElementById('buscar-hilo').classList.contains('hidden')) { cerrarBusqueda(); return; }
  if (PANELES.some(panelAbierto)) { cerrarPaneles(); return; }
  if (enCampo(document.activeElement)) { document.activeElement.blur(); return; }
  if (document.getElementById('app').classList.contains('open-thread')) document.getElementById('back').click();
});

function ayudaTeclas() {
  if (document.querySelector('.ayuda-teclas')) return;
  var caja = document.createElement('div');
  caja.className = 'ayuda-teclas';
  caja.innerHTML = '<div class="caja" role="dialog" aria-modal="true" aria-label="Atajos del chat"><h3>Atajos del chat</h3><table>' +
    '<tr><td><kbd>Enter</kbd> / <kbd>Shift</kbd>+<kbd>Enter</kbd></td><td>Enviar / salto de línea</td></tr>' +
    '<tr><td><kbd>/</kbd> en el mensaje</td><td>Respuestas rápidas (se filtran al escribir; Enter o Tab pone el texto)</td></tr>' +
    '<tr><td>Clic derecho o <kbd>⌄</kbd> en un globo</td><td>Menú del mensaje: responder, reaccionar, reenviar, destacar, eliminar…</td></tr>' +
    '<tr><td>Mantener pulsado un globo</td><td>Entrar en selección múltiple (en el móvil)</td></tr>' +
    '<tr><td><kbd>Ctrl</kbd>+<kbd>F</kbd></td><td>Buscar dentro de esta conversación (<kbd>Enter</kbd> y <kbd>Shift</kbd>+<kbd>Enter</kbd> saltan entre coincidencias)</td></tr>' +
    '<tr><td><kbd>Alt</kbd>+<kbd>↓</kbd> <kbd>Alt</kbd>+<kbd>↑</kbd></td><td>Siguiente / anterior conversación</td></tr>' +
    '<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>U</kbd></td><td>Pedirle su ubicación</td></tr>' +
    '<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd></td><td>Mandar un pin del mapa</td></tr>' +
    '<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd></td><td>Abrir o cerrar la ficha del cliente</td></tr>' +
    '<tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd></td><td>«De este me encargo yo»: callar o soltar al asistente</td></tr>' +
    '<tr><td><kbd>/</kbd> fuera del mensaje</td><td>Ir al buscador de chats</td></tr>' +
    '<tr><td><kbd>Esc</kbd></td><td>Cerrar lo que esté abierto y, al final, volver a la lista</td></tr>' +
    '<tr><td><kbd>F1</kbd> o <kbd>Ctrl</kbd>+<kbd>/</kbd></td><td>Esta ayuda</td></tr>' +
    '</table><p class="muted" style="margin:10px 0 0;font-size:12.5px">Las respuestas rápidas se editan en Panel → Automatización.</p></div>';
  caja.onclick = function (ev) { if (ev.target === caja) caja.remove(); };
  document.body.appendChild(caja);
}

/* ------------------------------------------------- historial del telefono */

async function sincronizarEsteChat() {
  if (!current) return;
  try {
    await api('/admin/local/sincronizar/' + encodeURIComponent(current.id), { method: 'POST' });
    toast('Pedido al teléfono lo último de este chat. Lo que faltaba aparece en unos segundos, si el teléfono lo manda.');
    var id = current.id;
    setTimeout(function () { if (current && current.id === id) openChat(id, true); }, 4000);
    setTimeout(function () { if (current && current.id === id) openChat(id, true); }, 9000);
  } catch (error) { toast(error.message); }
}
async function traerHistorialDeEsteChat() {
  if (!current) return;
  try {
    var r = await api('/admin/local/historial/' + encodeURIComponent(current.id), { method: 'POST' });
    toast(r.sinReferencia
      ? 'Pedido al teléfono. Si tiene mensajes de este chat, aparecen en unos segundos; si no aparece nada, escribe algo o espera a que escriban y vuelve a pulsar.'
      : 'Pedido al teléfono. Los mensajes anteriores a ' + (r.desde ? dayLabel(r.desde) : 'los de aquí') + ' aparecen arriba en unos segundos.');
    var id = current.id;
    setTimeout(function () { if (current && current.id === id) openChat(id, true); }, 4000);
    setTimeout(function () { if (current && current.id === id) openChat(id, true); }, 9000);
  } catch (error) { toast(error.message); }
}

var sondeoHistorial = null;
async function traerTodoElHistorial() {
  try {
    var r = await api('/admin/local/historial-todos', { method: 'POST' });
    toast(r.yaEnMarcha ? 'Ya se está trayendo el historial.' :
      'Trayendo TODO el historial de ' + r.chats + ' chats: va chat por chat y tarda unos minutos.' +
      (r.sinReferencia ? ' ' + r.sinReferencia + ' chats sin ningún mensaje aquí se saltan (el teléfono necesita uno de referencia).' : ''));
    sondearHistorial();
  } catch (error) { toast(error.message); }
}
async function sondearHistorial() {
  try {
    var p = await api('/admin/local/historial-todos');
    if (p.enMarcha) {
      if (!sondeoHistorial) sondeoHistorial = setInterval(sondearHistorial, 3000);
      return;
    }
    if (!sondeoHistorial) return;
    clearInterval(sondeoHistorial); sondeoHistorial = null;
    toast((p.detalle || 'Historial traído.') + (p.sinReferencia
      ? ' Quedan ' + p.sinReferencia + ' chats sin ningún mensaje aquí: el teléfono solo los manda al vincular.'
      : ''));
    loadChats(true);
    if (current) openChat(current.id, true);
  } catch (error) { /* sin sesion local no hay nada que sondear */ }
}

async function importarDeWaha() {
  toast('Trayendo las conversaciones de WhatsApp, puede tardar un poco…');
  try {
    var r = await api('/admin/waha/importar', { method: 'POST', body: {} });
    toast('Listo: ' + r.chats + ' conversaciones y ' + r.mensajes + ' mensajes.' + (r.omitidos ? ' Se omitieron ' + r.omitidos + ' grupos.' : ''));
    loadChats();
  } catch (error) { toast(error.message); }
}

/* ------------------------------------------------------------- refresco */

/**
 * Estado de la conexion con WhatsApp.
 *
 * Solo tiene sentido con los proveedores que se vinculan por QR: con la Cloud
 * API de Meta no hay sesion que se caiga. En demostracion tampoco se avisa: la
 * banda de arriba ya dice que nada sale.
 */
async function revisarConexion() {
  if (PROVEEDOR !== 'local' && PROVEEDOR !== 'waha') return;
  if (EN_DEMO) return;
  var caja = document.getElementById('aviso-conexion');
  try {
    var estado = await api('/admin/' + PROVEEDOR + '/status');
    if (estado.connected) { caja.classList.add('hidden'); return; }
    caja.innerHTML = 'WhatsApp no está conectado' + (estado.detail ? ' (' + esc(estado.detail) + ')' : '') +
      ': lo que escribas aquí no va a salir. <a href="/setup">Conectar ahora</a>';
    caja.classList.remove('hidden');
  } catch (error) {
    /* Si no se puede preguntar, no se inventa un estado: se deja como esta. */
  }
}

/**
 * El refresco no puede pisar al usuario.
 *
 * Con un menu abierto, una seleccion en marcha, la busqueda abierta o un
 * adjunto esperando a salir, se salta el turno: repintar ahi es cerrarle al
 * operador lo que estaba usando.
 */
function ocupado() {
  return Boolean(menuAbierto) || (seleccion && seleccion.length > 0) ||
    Boolean(adjuntoPendiente) || Boolean(grabadora) ||
    !document.getElementById('buscar-hilo').classList.contains('hidden') ||
    document.querySelector('.dlg-fondo, .visor, .ayuda-teclas') !== null;
}

setInterval(function () {
  if (ocupado()) return;
  loadChats(true);
  if (deseado) openChat(deseado, true);
}, 5000);

/* ------------------------------------------------------ abrir desde fuera

   /chat?phone=51999888777&text=Hola... Es la puerta por la que entra Stoky:
   la conversacion queda dentro del sistema en vez de en el WhatsApp personal
   de quien pulso el boton. El texto se deja escrito, NO se manda. */
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
      input.value = texto;
      input.focus();
      input.setSelectionRange(texto.length, texto.length);
      input.dispatchEvent(new Event('input'));
    }
    history.replaceState(null, '', '/chat');
  } catch (error) { toast(error.message); }
}

/* --------------------------------------------------- guardar y vaciar

   Guardar un chat escribe el hilo entero en un fichero y lo vacia de la base.
   Es lo que hace que el historial sobreviva a perder el numero, y de paso lo
   que evita que la base crezca sin fin. El servidor no borra nada hasta haber
   escrito el respaldo y haberlo vuelto a leer entero.

   LEER lo guardado no se hace aqui: para eso esta /guardados, que ademas trae
   resumen, etiquetas, notas, adjuntos, buscador, PDF y "devolver al chat".
   Aqui solo se guarda y se vacia, que es la accion que nace en la conversacion. */

function pedirCierre() {
  if (!current) return;
  var caja = document.getElementById('confirmar-cierre');
  caja.innerHTML =
    '<p>Se guarda <b>todo el historial</b> de ' + esc(nombreDe(current)) +
    ' en «Chats guardados» y el chat queda vacío aquí. Lo guardado se puede leer, descargar ' +
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
  boton.textContent = 'Guardando…';
  try {
    var r = await api('/admin/chat/' + current.id + '/archive', { method: 'POST' });
    ver('confirmar-cierre', false);
    toast('Guardados ' + r.archive.messageCount + ' mensajes. El chat quedó vacío; lo guardado está en Chats guardados.');
    await openChat(current.id, true);
    loadChats(true);
  } catch (error) {
    toast(error.message);
    boton.disabled = false;
    boton.textContent = 'Guardar y vaciar';
  }
}
`;

  const arranque = String.raw`
/* Se arranca al final, cuando ya existe todo lo de arriba. */
pintarGrabandoVacio();
pintarBotonDeEnviar();
cargarAtajos();
cargarStickers();
loadTemplates();
revisarConexion();
setInterval(revisarConexion, 15000);
sondearHistorial();
loadChats().then(abrirDesdeUrl);
`;

  const script =
    `var TEXTO_VER_UNA_VEZ = ${JSON.stringify(TEXTO_VER_UNA_VEZ)};\n` +
    `var PROVEEDOR = ${JSON.stringify(proveedor)};\n` +
    `var EN_DEMO = ${JSON.stringify(demo)};\n` +
    nucleo + CHAT_JS_MENU + CHAT_JS_COMPOSITOR + arranque;

  return appShell({
    titulo: 'Chats',
    subtitulo: 'Las conversaciones, como en WhatsApp',
    contenido,
    script,
    css: CHAT_CSS,
    nombreNegocio: opts.nombreNegocio,
    demo,
    lleno: true,
    icono: '💬',
  });
}
