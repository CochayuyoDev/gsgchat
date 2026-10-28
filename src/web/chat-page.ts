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


  const contenido = `
${bandaDemo}
<div class="aviso roto hidden" id="aviso-conexion"></div>
<div class="app" id="app">
  <div class="side">
    <header>
      <h1>Chats</h1>
      <span id="unread" class="badge hidden" aria-label="mensajes sin leer"></span>
      <button type="button" id="etiquetar" class="etiquetar-boton" title="Clasifica con la IA los chats de hoy que aún no tienen etiqueta. GSG ve cada etiqueta como la nota del chat.">Etiquetar chats con IA</button>
      <button class="icon" id="nuevo" title="Escribir a un número nuevo" aria-label="Escribir a un número nuevo">✚</button>
      <button class="icon" id="menu-lista" title="Más opciones" aria-label="Más opciones" aria-haspopup="menu" aria-expanded="false">⋮</button>
    </header>
    <div class="search"><input id="q" placeholder="Buscar por nombre o número" autocomplete="off" aria-label="Buscar un chat por nombre o número"></div>
    <div class="selectores" id="selectores">
      <button type="button" class="selector" id="sel-lista" aria-haspopup="listbox" aria-expanded="false" title="Qué chats ver">
        <span class="sel-que">Mostrar</span><span class="sel-valor" id="sel-lista-valor">Todos</span><span class="sel-flecha" aria-hidden="true">▾</span>
      </button>
      <button type="button" class="selector" id="sel-etiqueta" aria-haspopup="listbox" aria-expanded="false" title="Ver solo los chats con una etiqueta">
        <span class="sel-que">Etiqueta</span><span class="sel-valor" id="sel-etiqueta-valor">Todas</span><span class="sel-flecha" aria-hidden="true">▾</span>
      </button>
    </div>
    <div class="etiquetado hidden" id="etiquetado" role="status" aria-live="polite"></div>
    <div class="etiquetado-chats hidden" id="etiquetado-chats" aria-label="Chats del lote"></div>
    <div class="chats" id="chats"></div>
  </div>

  <div class="thread">
    <header id="thread-head" class="hidden">
      <button class="icon" id="back" title="Volver a la lista" aria-label="Volver a la lista">‹</button>
      <div class="avatar" id="t-avatar" aria-hidden="true"></div>
      <div style="flex:1;min-width:0">
        <div class="t-nombre"><div class="name" id="t-name"></div><span id="t-etiqueta"></span></div>
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


    <div class="cita-previa hidden" id="cita-previa">
      <div class="bloque"><span class="quien"></span><span class="que"></span></div>
      <button type="button" class="icon" id="cita-quitar" title="No responder a ese mensaje" aria-label="Quitar la cita">✕</button>
    </div>
    <div class="panel-bajo hidden" id="panel-atajos"></div>
    <div class="panel-bajo emojis hidden" id="panel-emojis">
      <input class="buscador" id="emojis-buscar" placeholder="Buscar: caras, gestos, corazones, trabajo, comida" aria-label="Buscar emoji">
      <div id="emojis-rejillas"></div>
    </div>
    <div class="rapidas-barra hidden" id="rapidas-barra"></div>

    <div class="composer hidden" id="composer">
      <button class="ghost" id="boton-mas" title="Ubicación o respuesta rápida" aria-label="Más cosas que mandar" aria-haspopup="menu" aria-expanded="false">＋</button>
      <button class="ghost" id="boton-emoji" title="Emoji" aria-label="Elegir un emoji" aria-expanded="false">😊</button>
      <textarea id="text" rows="1" placeholder="Escribe un mensaje  ·  / para respuestas rápidas" aria-label="Escribe un mensaje"></textarea>
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
  if (!options.method || options.method === 'GET') return window.leerPanel(path);
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
var ultimoAviso = { texto: '', cuando: 0 };
function toast(text) {
  if (ultimoAviso.texto === text && Date.now() - ultimoAviso.cuando < 60000) return;
  ultimoAviso = { texto: text, cuando: Date.now() };
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
var cursorNuevos = '0', syncActiva = false, syncPendiente = false;
var expiryTimer = null;

/* El hilo abierto: lo del servidor mas las paginas anteriores ya cargadas.
   El refresco trae solo lo ultimo y se funde aqui, para no perder lo viejo. */
var hilo = { contactId: null, mensajes: [], masAntiguos: false, cargando: false };

function fundirHilo(contactId, nuevos, masAntiguos) {
  if (hilo.contactId !== contactId) hilo = { contactId: contactId, mensajes: [], masAntiguos: false, cargando: false };
  var porId = {};
  hilo.mensajes.forEach(function (m) { porId[m.id] = m; });
  nuevos.forEach(function (m) { porId[m.id] = m; });
  hilo.mensajes = Object.keys(porId).map(function (k) { return porId[k]; }).sort(function (a, b) {
    var ta = new Date(a.createdAt).getTime(), tb = new Date(b.createdAt).getTime();
    return ta - tb || a.id - b.id;
  });
  if (hilo.mensajes.length > 300) {
    hilo.mensajes = hilo.mensajes.slice(-300);
    hilo.masAntiguos = true;
  }
  if (masAntiguos !== undefined) hilo.masAntiguos = masAntiguos;
  return hilo.mensajes;
}

/* ------------------------------------------------------- lista de chats */

function pasaFiltro(c) {
  /* «Apartar» ya no existe: los que quedaron apartados vuelven a la lista como los demas. */
  if (filtroLista === 'sin_leer') return c.unread > 0;
  if (filtroLista === 'esperan') return c.lastMessage && c.lastMessage.direction === 'in';
  if (filtroLista === 'ventana') return c.windowOpen;
  return true;
}

var peticionLista = 0, vistaActual = null, offsetChats = 0, hasMoreChats = false, cargandoMasChats = false;
async function loadChats(keepScroll, anexar) {
  var mia = ++peticionLista;
  try {
    var offset = anexar ? offsetChats : 0;
    if (anexar) cargandoMasChats = true;
    var qs = '&incluirApartados=true&q=' + encodeURIComponent(document.getElementById('q').value.trim()) +
      (filtroEtiqueta ? '&etiqueta=' + encodeURIComponent(filtroEtiqueta) : '');
    var data = await api('/admin/chat/conversations?limit=30&offset=' + offset + qs);
    /* Al refrescar (no al anexar) se vuelve a pedir lo que ya estaba cargado: si solo
       se trajeran las primeras 30, la lista se acortaria y el scroll saltaria arriba. */
    var yaCargados = keepScroll && !anexar ? offsetChats : 0;
    while (mia === peticionLista && data.hasMore && data.items.length < yaCargados) {
      var mas = await api('/admin/chat/conversations?limit=100&offset=' + data.items.length + qs);
      data.items = data.items.concat(mas.items);
      data.hasMore = mas.hasMore;
    }
    if (mia !== peticionLista) return;
    if (vistaActual !== data.vistaDesde) {
      vistaActual = data.vistaDesde;
      current = null; deseado = null;
      hilo = { contactId: null, mensajes: [], masAntiguos: false, cargando: false };
      ver('thread-head', false); ver('messages', false); ver('composer', false); ver('placeholder', true);
    }
    if (anexar) {
      var porId = new Map(conversations.map(function (c) { return [c.contactId, c]; }));
      data.items.forEach(function (c) { porId.set(c.contactId, c); });
      conversations = Array.from(porId.values());
      offsetChats = offset + data.items.length;
    } else { conversations = data.items; offsetChats = data.items.length; }
    hasMoreChats = Boolean(data.hasMore);
    if (window.actualizarNoLeidos) window.actualizarNoLeidos(data.unread || 0);
    var badge = document.getElementById('unread');
    if (data.unread) { badge.textContent = data.unread; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');

    var box = document.getElementById('chats');
    var top = box.scrollTop;
    var visibles = conversations.filter(pasaFiltro);
    /* Los filtros de estado miran lo cargado: con uno activo, se trae el resto para no dejar chats fuera
       (tambien cuando en lo cargado aun no hay ninguno: suelen estar mas abajo). */
    var faltanPaginas = filtroLista !== 'todos' && hasMoreChats && conversations.length < 2000;
    if (faltanPaginas) setTimeout(function () { if (!cargandoMasChats) loadChats(true, true); }, 0);
    if (!conversations.length) {
      pintarLista(box, filtroEtiqueta
        ? '<div class="empty">Ningún chat con esa etiqueta.</div>'
        : '<div class="empty">Todavía no hay conversaciones.<br>En cuanto alguien te escriba, aparece aquí.</div>', top);
      return;
    }
    if (!visibles.length) {
      pintarLista(box, faltanPaginas ? '<div class="empty">Buscando…</div>' : '<div class="empty">Ninguna conversación con ese filtro.</div>', top);
      return;
    }
    var html = visibles.map(filaDeChat).join('') + (hasMoreChats ? '<button class="cargar-chats" type="button" data-cargar-chats>Ver 30 conversaciones más</button>' : '');
    pintarLista(box, html, keepScroll ? top : 0);
  } catch (error) { toast(error.message); }
  finally { cargandoMasChats = false; }
}

function filaDeChat(c) {
  var last = c.lastMessage;
  var prefijo = last && last.direction === 'out' ? tick(last.status) + ' ' : '';
  var texto = last ? (last.body || '') : 'Sin mensajes todavía';
  var grupo = c.tipo === 'grupo';
  var marcas = (c.fijadoAt ? '<span title="fijado arriba">📌</span>' : '') +
    (c.silenciadoAt ? '<span title="silenciado">🔕</span>' : '');
  return '<div class="chat' + (current && current.id === c.contactId ? ' active' : '') + (c.silenciadoAt ? ' silenciado' : '') + '" data-id="' + esc(c.contactId) + '">' +
    (grupo ? '<div class="avatar grupo" title="Grupo de WhatsApp">👥</div>'
           : '<div class="avatar ' + colorDe(c.phone) + '" aria-hidden="true">' + esc(inicial(c.name, c.phone)) + '</div>') +
    '<div class="body"><div class="top">' +
      '<span class="name">' + esc(nombreDe(c)) + '</span>' +
      (marcas ? '<span class="marcas">' + marcas + '</span>' : '') +
      '<span class="when">' + esc(shortWhen(last ? last.createdAt : c.lastInboundAt)) + '</span>' +
    '</div><div class="last"><span class="texto">' + prefijo + esc(texto.slice(0, 70)) + '</span>' + chipEtiqueta(c.etiqueta) +
      (c.unread ? '<span class="badge">' + c.unread + '</span>' : '') +
    '</div></div>' +
    '<button class="icon fila-menu" data-menu-fila="' + esc(c.contactId) + '" title="Opciones de esta conversación" aria-label="Opciones de esta conversación">⋮</button>' +
    '</div>';
}

/* ------------------------------------------------ etiquetas de la IA */

/* Los mismos tonos que la pantalla de guardados: rojo lo que se pierde, ambar lo que hay que mover, azul lo que hay que atender. */
var TONO_ETIQUETA = {
  reclamo: 'rojo', cancelar_entrega: 'rojo', pedido_no_reconocido: 'rojo',
  reagendar_entrega: 'ambar', cambiar_ubicacion: 'ambar', ubicaciones_multiples: 'ambar', fuera_de_horario: 'ambar', problema_de_pago: 'ambar',
  horario_fijo: 'azul', franja_horaria: 'azul', hora_limite: 'azul', solicitar_espera: 'azul', coordinar_con_tercero: 'azul', consultar_entrega: 'azul',
  confirmar_recepcion: 'verde', sin_novedad: 'verde', otro: 'gris'
};

/* 'AAAA-MM-DD' -> 'DD/MM' sin pasar por Date (la medianoche UTC cae el dia anterior en Lima). */
function diaCorto(dia) { return dia ? String(dia).slice(8, 10) + '/' + String(dia).slice(5, 7) : ''; }

function chipEtiqueta(e) {
  if (!e) return '';
  var clase = e.id ? (TONO_ETIQUETA[e.id] || 'gris') : 'sin';
  var manual = e.origen === 'manual';
  var titulo = e.id
    ? (manual ? 'Etiqueta puesta a mano' : 'Etiqueta puesta por la IA') + (e.hoy ? ' hoy' : ' el ' + diaCorto(e.dia)) + '. GSG la ve como la nota del chat.'
    : 'No se pudo clasificar' + (e.motivo ? ' (' + e.motivo + ')' : '') + '. Vuelve a etiquetar los chats para intentarlo de nuevo.';
  return '<span class="etq ' + clase + (e.hoy ? '' : ' vieja') + (manual ? ' manual' : '') + '" title="' + esc(titulo) + '">' + (manual ? '<span class="etq-mano" aria-hidden="true">✎</span>' : '') + esc(e.nombre) + '</span>';
}

/* --------------------------------------- etiquetar un chat a mano (cabecera) */

var catalogoCache = null;
async function catalogoEtiquetas() {
  if (!catalogoCache) catalogoCache = (await api('/admin/chat/etiquetas/catalogo')).items;
  return catalogoCache;
}

/* La etiqueta de la cabecera es un boton: abre el catalogo para ponerla o cambiarla a mano. */
function pintarEtiquetaCabecera(e) {
  var caja = document.getElementById('t-etiqueta');
  /* Con la lista abierta no se repinta (el refresco del chat la dejaria colgando). */
  if (listaAbierta && listaAbierta.boton && listaAbierta.boton.id === 'etq-cambiar') return;
  if (!current || current.tipo === 'grupo') { caja.innerHTML = ''; return; }
  caja.innerHTML = e
    ? '<button type="button" class="etq-boton" id="etq-cambiar" aria-haspopup="listbox" aria-expanded="false" title="Cambiar la etiqueta a mano">' + chipEtiqueta(e) + '<span class="sel-flecha" aria-hidden="true">▾</span></button>'
    : '<button type="button" class="etq-poner" id="etq-cambiar" aria-haspopup="listbox" aria-expanded="false" title="Ponerle una etiqueta a mano">+ Etiqueta</button>';
  document.getElementById('etq-cambiar').onclick = function () { elegirEtiquetaAMano(this, e); };
}

async function elegirEtiquetaAMano(boton, actual) {
  var cat;
  try { cat = await catalogoEtiquetas(); } catch (error) { toast(error.message); return; }
  var grupos = [{ titulo: 'Poner a mano', opciones: cat.map(function (c) { return { valor: c.codigo, texto: c.nombre, tono: TONO_ETIQUETA[c.codigo] || 'gris' }; }) }];
  if (actual) grupos.push({ opciones: [{ valor: '__quitar', texto: 'Quitar la etiqueta' }] });
  var contacto = current.id;
  abrirListaFiltro(boton, grupos, actual && actual.id && actual.origen === 'manual' ? actual.id : '', async function (valor) {
    /* Se ve al momento, antes de que conteste el servidor. */
    var elegida = cat.filter(function (c) { return c.codigo === valor; })[0];
    pintarEtiquetaCabecera(elegida ? { id: elegida.codigo, nombre: elegida.nombre, hoy: true, origen: 'manual' } : null);
    try {
      var r = await api('/admin/chat/' + encodeURIComponent(contacto) + '/etiqueta', { method: 'POST', body: { etiqueta: valor === '__quitar' ? null : valor } });
      if (current && current.id === contacto) {
        pintarEtiquetaCabecera(r.etiqueta);
        /* Un refresco que salio antes del cambio traeria la etiqueta vieja: este, mas nuevo, lo deja atras. */
        openChat(contacto, true);
      }
      toast(valor === '__quitar' ? 'Etiqueta quitada.' : 'Etiqueta puesta a mano: la IA no la cambiará.');
      loadChats(true);
      cargarConteoEtiquetas();
    } catch (error) { toast(error.message); if (current && current.id === contacto) pintarEtiquetaCabecera(actual); }
  });
}

var sondeoEtiquetado = null, hechasVistas = -1;

function pintarEtiquetado(e, error) {
  var box = document.getElementById('etiquetado');
  var boton = document.getElementById('etiquetar');
  var corriendo = Boolean(e && e.enCurso);
  boton.classList.toggle('girando', corriendo);
  boton.disabled = corriendo;
  var cerrar = '<button type="button" data-cerrar-etiquetado title="Cerrar el aviso" aria-label="Cerrar el aviso">✕</button>';
  if (!error && e && e.error) error = e.error;
  if (error) { box.className = 'etiquetado error'; box.innerHTML = '<span class="que">' + esc(error) + '</span>' + cerrar; return; }
  if (!e || (!corriendo && !e.termino)) { box.className = 'etiquetado hidden'; box.innerHTML = ''; return; }
  var texto, pct = 0;
  if (corriendo) {
    texto = e.total ? 'Etiquetando con IA: ' + e.hechas + ' de ' + e.total + ' chats de hoy…' : 'Leyendo los chats de hoy…';
    pct = e.total ? Math.round((e.hechas * 100) / e.total) : 0;
  } else if (!e.total) {
    texto = 'Hoy todavía no hay chats que etiquetar.';
  } else {
    var partes = [];
    if (e.clasificadas) partes.push(e.clasificadas + ' etiquetado' + (e.clasificadas === 1 ? '' : 's'));
    if (e.reutilizadas) partes.push(e.reutilizadas + ' ya tenían etiqueta (no se volvieron a leer)');
    if (e.sinClasificar) partes.push(e.sinClasificar + ' sin clasificar (se reintentan la próxima vez)');
    texto = 'Listo: ' + e.total + ' chat' + (e.total === 1 ? '' : 's') + ' de hoy. ' + partes.join(' · ') + '.' +
      (e.recortado ? ' Hoy hay demasiados mensajes: se miraron los primeros.' : '') +
      (e.clasificadas ? ' GSG ya las ve como la nota de cada chat.' : '');
  }
  var verChats = e.loteId ? '<button type="button" class="ver-chats" data-ver-chats aria-expanded="' + (chatsDelLoteAbierto ? 'true' : 'false') + '">' + (chatsDelLoteAbierto ? 'Ocultar chats' : 'Ver chats del lote') + '</button>' : '';
  box.className = 'etiquetado';
  box.innerHTML = '<div class="que">' + esc(texto) + (corriendo ? '<div class="barra"><i style="width:' + pct + '%"></i></div>' : '') + '</div>' + verChats + (corriendo ? '' : cerrar);
  loteMostrado = e.loteId || null;
  if (chatsDelLoteAbierto) pintarChatsDelLote();
}

/* ------------------------------------------------- filtrar por etiqueta */

/* Se filtra en el servidor, sobre toda la bandeja: no solo los chats ya cargados. */
var filtroEtiqueta = '';

async function cargarConteoEtiquetas() {
  try {
    conteoEtiquetas = await api('/admin/chat/etiquetas/conteo');
  } catch (error) { conteoEtiquetas = null; }
  pintarSelectores();
}

/* ------------------------------------------------ los dos desplegables */

var FILTROS_LISTA = [
  { valor: 'todos', texto: 'Todos los chats' },
  { valor: 'sin_leer', texto: 'Sin leer' },
  { valor: 'esperan', texto: 'Esperan respuesta' },
  { valor: 'ventana', texto: 'Escribieron hoy' },
];
var conteoEtiquetas = null;

/* Las opciones del desplegable de etiquetas: las que tienen chats (de mas a menos) y los estados. */
function opcionesEtiqueta() {
  var d = conteoEtiquetas;
  if (!d) return [];
  var con = d.etiquetas.filter(function (e) { return e.n > 0; }).sort(function (a, b) { return b.n - a.n; });
  var estados = [];
  if (d.sinEtiquetar) estados.push({ valor: 'sin_etiquetar', texto: 'Sin etiquetar', n: d.sinEtiquetar, tono: 'hueco' });
  if (d.sinClasificar) estados.push({ valor: 'sin_clasificar', texto: 'Sin clasificar', n: d.sinClasificar, tono: 'sin' });
  return [
    { opciones: [{ valor: '', texto: 'Todas las etiquetas', n: d.total }] },
    { titulo: 'Etiquetas', opciones: con.map(function (e) { return { valor: e.codigo, texto: e.nombre, n: e.n, tono: TONO_ETIQUETA[e.codigo] || 'gris' }; }) },
    estados.length ? { titulo: 'Estado', opciones: estados } : null,
  ].filter(Boolean);
}

function pintarSelectores() {
  var lista = FILTROS_LISTA.filter(function (f) { return f.valor === filtroLista; })[0];
  document.getElementById('sel-lista-valor').textContent = lista && lista.valor !== 'todos' ? lista.texto : 'Todos';
  document.getElementById('sel-lista').classList.toggle('activo', filtroLista !== 'todos');
  var elegida = null;
  opcionesEtiqueta().forEach(function (g) { g.opciones.forEach(function (o) { if (o.valor === filtroEtiqueta) elegida = o; }); });
  var valor = document.getElementById('sel-etiqueta-valor');
  valor.innerHTML = filtroEtiqueta && elegida
    ? '<i class="punto ' + esc(elegida.tono || 'gris') + '" aria-hidden="true"></i>' + esc(elegida.texto)
    : (conteoEtiquetas && (conteoEtiquetas.total - conteoEtiquetas.sinEtiquetar) > 0 ? 'Todas' : 'Sin etiquetas aún');
  document.getElementById('sel-etiqueta').classList.toggle('activo', Boolean(filtroEtiqueta));
}

/*
 * Un desplegable propio (no el <select> del navegador): un clic lo abre con
 * todas las opciones a la vista, otro elige. Con teclado: flechas, Intro, Esc.
 */
var listaAbierta = null;
function cerrarListaFiltro() {
  if (!listaAbierta) return;
  listaAbierta.panel.remove();
  listaAbierta.boton.setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', listaAbierta.fuera, true);
  document.removeEventListener('keydown', listaAbierta.teclas, true);
  window.removeEventListener('resize', cerrarListaFiltro);
  listaAbierta = null;
}
function abrirListaFiltro(boton, grupos, actual, elegir) {
  if (listaAbierta && listaAbierta.boton === boton) { cerrarListaFiltro(); return; }
  cerrarListaFiltro();
  var panel = document.createElement('div');
  panel.className = 'lista-filtro';
  /* Va colgada del body: hereda la letra del boton, no la del navegador. */
  panel.style.fontFamily = getComputedStyle(boton).fontFamily;
  panel.setAttribute('role', 'listbox');
  panel.innerHTML = grupos.map(function (g) {
    return (g.titulo ? '<div class="lf-titulo">' + esc(g.titulo) + '</div>' : '') + g.opciones.map(function (o) {
      var es = o.valor === actual;
      return '<button type="button" class="lf-op' + (es ? ' activo' : '') + '" role="option" aria-selected="' + (es ? 'true' : 'false') + '" data-valor="' + esc(o.valor) + '">' +
        '<span class="lf-marca" aria-hidden="true">' + (es ? '✓' : '') + '</span>' +
        (o.tono ? '<i class="punto ' + esc(o.tono) + '" aria-hidden="true"></i>' : '') +
        '<span class="lf-texto">' + esc(o.texto) + '</span>' +
        (o.n !== undefined ? '<span class="lf-n">' + o.n + '</span>' : '') + '</button>';
    }).join('');
  }).join('');
  document.body.appendChild(panel);
  var r = boton.getBoundingClientRect();
  var ancho = Math.min(Math.max(r.width, 290), window.innerWidth - 16);
  panel.style.width = ancho + 'px';
  panel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - ancho - 8)) + 'px';
  panel.style.top = (r.bottom + 6) + 'px';
  panel.style.maxHeight = Math.max(200, window.innerHeight - r.bottom - 20) + 'px';
  boton.setAttribute('aria-expanded', 'true');
  var ops = Array.prototype.slice.call(panel.querySelectorAll('.lf-op'));
  (panel.querySelector('.lf-op.activo') || ops[0]).focus();
  panel.addEventListener('click', function (ev) {
    var b = ev.target.closest('.lf-op');
    if (!b) return;
    cerrarListaFiltro();
    boton.focus();
    elegir(b.getAttribute('data-valor'));
  });
  var fuera = function (ev) { if (!panel.contains(ev.target) && !boton.contains(ev.target)) cerrarListaFiltro(); };
  var teclas = function (ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); cerrarListaFiltro(); boton.focus(); return; }
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    ev.preventDefault();
    var i = ops.indexOf(document.activeElement);
    var j = ev.key === 'ArrowDown' ? Math.min(ops.length - 1, i + 1) : Math.max(0, i - 1);
    ops[j].focus();
  };
  document.addEventListener('pointerdown', fuera, true);
  document.addEventListener('keydown', teclas, true);
  window.addEventListener('resize', cerrarListaFiltro);
  listaAbierta = { panel: panel, boton: boton, fuera: fuera, teclas: teclas };
}

document.getElementById('sel-lista').onclick = function () {
  abrirListaFiltro(this, [{ opciones: FILTROS_LISTA }], filtroLista, function (valor) {
    filtroLista = valor;
    pintarSelectores();
    loadChats();
  });
};
document.getElementById('sel-etiqueta').onclick = async function () {
  if (!conteoEtiquetas) await cargarConteoEtiquetas();
  var grupos = opcionesEtiqueta();
  if (!grupos.length || (conteoEtiquetas.total - conteoEtiquetas.sinEtiquetar) === 0) { toast('Aún no hay chats etiquetados: pulsa «Etiquetar chats con IA».'); return; }
  abrirListaFiltro(this, grupos, filtroEtiqueta, function (valor) {
    filtroEtiqueta = valor;
    pintarSelectores();
    loadChats();
  });
};

/* ---------------------------------------- los chats del lote, uno por uno */

var chatsDelLoteAbierto = false, loteMostrado = null, pidiendoChatsLote = false;
var ESTADO_ANALISIS = { pendiente: 'En cola', reutilizada: 'Ya etiquetado', clasificada: 'Clasificada', error: 'Error de IA', solo_envio: 'Solo envío' };

/* 51 + 9 digitos, como lo guarda el servidor: para encontrar el chat de la bandeja. */
function numeroComoServidor(tel) {
  var d = String(tel || '').replace(/\D+/g, '');
  return d.length === 9 && d.charAt(0) === '9' ? '51' + d : d;
}

async function pintarChatsDelLote() {
  var caja = document.getElementById('etiquetado-chats');
  if (!chatsDelLoteAbierto || !loteMostrado) { caja.classList.add('hidden'); caja.innerHTML = ''; return; }
  if (pidiendoChatsLote) return;
  pidiendoChatsLote = true;
  try {
    var d = await api('/admin/chat/etiquetar/lotes/' + encodeURIComponent(loteMostrado));
    if (!chatsDelLoteAbierto) return;
    caja.classList.remove('hidden');
    if (!d.chats.length) { caja.innerHTML = '<div class="nada">Este lote no tiene chats.</div>'; return; }
    caja.innerHTML = d.chats.map(function (c) {
      var detalle = c.error || '';
      return '<button type="button" class="chat-lote" data-telefono-lote="' + esc(c.phone) + '">' +
        '<span class="quien"><b>' + esc(c.nombre || telefonoBonito(c.phone)) + '</b>' + (c.nombre ? ' <span class="tel">' + esc(telefonoBonito(c.phone)) + '</span>' : '') + '</span>' +
        '<span class="estados">' +
          '<span class="est est-' + esc(c.estado) + '">' + esc(ESTADO_ANALISIS[c.estado] || c.estado) + '</span>' +
          (c.nombreEtiqueta ? chipEtiqueta({ id: c.etiqueta, nombre: c.nombreEtiqueta, hoy: true }) : '') +
        '</span>' +
        (detalle ? '<span class="detalle">' + esc(detalle) + '</span>' : '') +
        '</button>';
    }).join('');
  } catch (error) {
    caja.classList.remove('hidden');
    caja.innerHTML = '<div class="nada error">' + esc(error.message) + '</div>';
  } finally { pidiendoChatsLote = false; }
}

document.getElementById('etiquetado-chats').addEventListener('click', function (event) {
  var fila = event.target.closest('[data-telefono-lote]');
  if (!fila) return;
  var tel = fila.getAttribute('data-telefono-lote');
  var c = conversations.filter(function (x) { return numeroComoServidor(x.phone) === tel; })[0];
  if (c) openChat(c.contactId);
  else toast('Ese chat no está en la lista cargada: búscalo por su número.');
});

/* Pregunta por el avance mientras corre; al terminar, repinta la lista y la cabecera. */
async function seguirEtiquetado(alArrancar) {
  clearTimeout(sondeoEtiquetado);
  try {
    var e = await api('/admin/chat/etiquetar');
    /* Al abrir la pantalla solo interesa un lote en marcha, no el aviso de uno viejo. */
    if (alArrancar && !e.enCurso) return;
    pintarEtiquetado(e);
    if (e.enCurso) {
      if (e.hechas !== hechasVistas) { hechasVistas = e.hechas; loadChats(true); }
      sondeoEtiquetado = setTimeout(seguirEtiquetado, 1500);
      return;
    }
    hechasVistas = -1;
    await loadChats(true);
    cargarConteoEtiquetas();
    if (current) openChat(current.id, true);
  } catch (error) {
    if (!alArrancar) pintarEtiquetado(null, error.message);
  }
}

/* ------------------------------------------------ el catalogo de etiquetas */

/*
 * Los codigos, nombres y descripciones que usa la IA para etiquetar. El codigo
 * es lo que guarda el sistema y lee GSG en la nota del chat; la descripcion, lo que lee la IA.
 * «otro» siempre esta (se puede renombrar, no quitar).
 */
async function editarCatalogo() {
  var datos;
  try { datos = await api('/admin/chat/etiquetas/catalogo'); } catch (error) { toast(error.message); return; }
  var filas = datos.items.map(function (e) { return { codigo: e.codigo, nombre: e.nombre, descripcion: e.descripcion }; });
  var fondo = document.createElement('div');
  fondo.className = 'dlg-fondo';
  fondo.innerHTML = '<div class="dlg catalogo-dlg" role="dialog" aria-modal="true" aria-labelledby="cat-titulo">' +
    '<h3 id="cat-titulo">Catálogo de etiquetas</h3>' +
    '<p class="ayuda">La IA elige UNA de estas para cada chat. El <b>código</b> es lo que se guarda y lee GSG en la nota del chat (minúsculas y guion bajo); el <b>nombre</b> es lo que ves en Chats; la <b>descripción</b> es lo que lee la IA para decidir. ' +
    (datos.propio ? 'Es el catálogo de tu negocio.' : 'Ahora mismo es el de fábrica.') + ' Al cambiarlo, el siguiente lote vuelve a clasificar los chats de hoy.</p>' +
    '<div class="cat-tabla" id="cat-tabla"></div>' +
    '<button type="button" class="sm" id="cat-mas">＋ Añadir etiqueta</button>' +
    '<div class="mal" id="cat-mal" role="alert"></div>' +
    '<div class="botones">' +
      '<button type="button" id="cat-probar" title="Mide con conversaciones de prueba si la IA pone bien estas etiquetas (guarda antes los cambios)">Probar la IA…</button>' +
      '<button type="button" id="cat-fabrica"' + (datos.propio ? '' : ' disabled') + '>Volver al de fábrica</button>' +
      '<button type="button" id="cat-no">Cancelar</button>' +
      '<button type="button" class="principal" id="cat-si">Guardar</button>' +
    '</div></div>';
  document.body.appendChild(fondo);
  var tabla = fondo.querySelector('#cat-tabla');
  var mal = fondo.querySelector('#cat-mal');

  function pintar() {
    tabla.innerHTML = '<div class="cat-fila cat-cab"><span>Código</span><span>Nombre</span><span>Descripción para la IA</span><span></span></div>' +
      filas.map(function (f, i) {
        var esOtro = f.codigo === datos.codigoOtro;
        return '<div class="cat-fila">' +
          '<input aria-label="Código" data-i="' + i + '" data-campo="codigo" value="' + esc(f.codigo) + '"' + (esOtro ? ' readonly title="«otro» no se puede quitar ni cambiar de código"' : '') + ' maxlength="40" spellcheck="false">' +
          '<input aria-label="Nombre" data-i="' + i + '" data-campo="nombre" value="' + esc(f.nombre) + '" maxlength="60">' +
          '<input aria-label="Descripción para la IA" data-i="' + i + '" data-campo="descripcion" value="' + esc(f.descripcion) + '" maxlength="200">' +
          (esOtro ? '<span></span>' : '<button type="button" class="quitar" data-quitar="' + i + '" aria-label="Quitar ' + esc(f.codigo || 'esta etiqueta') + '">✕</button>') +
        '</div>';
      }).join('');
  }
  function cerrar() { fondo.remove(); document.removeEventListener('keydown', teclas); }
  function teclas(ev) { if (ev.key === 'Escape') cerrar(); }
  document.addEventListener('keydown', teclas);
  tabla.addEventListener('input', function (ev) {
    var i = ev.target.getAttribute('data-i');
    if (i !== null) filas[Number(i)][ev.target.getAttribute('data-campo')] = ev.target.value;
  });
  tabla.addEventListener('click', function (ev) {
    var q = ev.target.closest('[data-quitar]');
    if (q) { filas.splice(Number(q.getAttribute('data-quitar')), 1); pintar(); }
  });
  fondo.querySelector('#cat-mas').onclick = function () {
    if (filas.length >= datos.tope) { mal.textContent = 'Como mucho ' + datos.tope + ' etiquetas.'; return; }
    filas.push({ codigo: '', nombre: '', descripcion: '' });
    pintar();
    var nuevas = tabla.querySelectorAll('input[data-campo="codigo"]');
    nuevas[nuevas.length - 1].focus();
  };
  fondo.querySelector('#cat-no').onclick = cerrar;
  fondo.querySelector('#cat-probar').onclick = async function () {
    var original = JSON.stringify(datos.items.map(function (e) { return [e.codigo, e.nombre, e.descripcion]; }));
    var ahora = JSON.stringify(filas.map(function (e) { return [e.codigo, e.nombre, e.descripcion]; }));
    /* La prueba usa el catalogo guardado: lo que no se guardo se perderia sin avisar. */
    if (original !== ahora && !(await confirmarDialogo({ titulo: 'Hay cambios sin guardar', texto: 'La prueba usa el catálogo guardado. Si sigues, se pierden los cambios que hiciste aquí. Para probarlos, pulsa antes «Guardar».', boton: 'Seguir sin guardar' }))) return;
    cerrar();
    probarIA();
  };
  fondo.querySelector('#cat-fabrica').onclick = async function () {
    var ok = await confirmarDialogo({ titulo: 'Volver al catálogo de fábrica', texto: 'Se borra el catálogo de tu negocio y vuelven las etiquetas de fábrica. Las etiquetas ya puestas no se borran.', boton: 'Volver al de fábrica' });
    if (!ok) return;
    try { await api('/admin/chat/etiquetas/catalogo', { method: 'DELETE' }); toast('Catálogo de fábrica restablecido.'); cerrar(); }
    catch (error) { mal.textContent = error.message; }
  };
  fondo.querySelector('#cat-si').onclick = async function () {
    mal.textContent = '';
    this.disabled = true;
    try {
      await api('/admin/chat/etiquetas/catalogo', { method: 'PUT', body: { items: filas } });
      catalogoCache = null;
      toast('Catálogo guardado. Para aplicarlo a los chats ya etiquetados: ⋮ → «Volver a etiquetar todo».');
      cerrar();
    } catch (error) { mal.textContent = error.message; this.disabled = false; }
  };
  pintar();
}

/* ------------------------------------------------------ probar la IA */

/*
 * «Probar la IA»: pasa el banco de conversaciones de prueba por la IA del
 * negocio (con su catalogo) y dice cuantas etiqueta bien, como usa «Otro» y
 * en cuales falla. La otra pestaña prueba una conversacion escrita a mano. No
 * toca ningun chat ni cambia ninguna nota.
 */
var EJEMPLOS_PRUEBA = [
  { t: 'Pide otro día', c: 'negocio: ¿Nos mandas tu ubicación para llevarte tu pedido hoy?\ncliente: Hoy no voy a estar, ¿lo pueden traer mañana?' },
  { t: 'Todo va bien', c: 'negocio: ¿Nos mandas tu ubicación para llevarte tu pedido hoy?\ncliente: [ubicación]\nnegocio: Ubicación registrada correctamente.\ncliente: Gracias!' },
  { t: 'Recibe otra persona', c: 'negocio: ¿Nos mandas tu ubicación?\ncliente: [ubicación]\ncliente: No voy a estar, déjenlo con el portero por favor' },
  { t: 'Nada que ver con la entrega', c: 'negocio: ¿Nos mandas tu ubicación?\ncliente: ¿Venden también zapatillas?' },
];

function lineaDeCaso(l) {
  if (l[0] === 'ubicacion') return '<div class="m cli adj">📍 Ubicación</div>';
  if (l[0] === 'foto') return '<div class="m cli adj">📷 Foto</div>';
  if (l[0] === 'audio') return '<div class="m cli adj">🎤 Audio</div>';
  return '<div class="m' + (l[0] === 'cliente' ? ' cli' : '') + '">' + esc(l[1]) + '</div>';
}

function chipDeCodigo(codigo, nombre) {
  return codigo ? chipEtiqueta({ id: codigo, nombre: nombre || codigo, hoy: true }) : '<span class="etq sin">Sin respuesta</span>';
}

async function probarIA() {
  var fondo = document.createElement('div');
  fondo.className = 'dlg-fondo';
  fondo.innerHTML = '<div class="dlg prueba-dlg" role="dialog" aria-modal="true" aria-labelledby="pr-titulo">' +
    '<div class="pr-cab"><h3 id="pr-titulo">Probar la IA</h3><p class="sub" id="pr-sub">Comprueba si tu IA pone bien las etiquetas antes de fiarte de ella. No toca ningún chat ni cambia ninguna nota.</p></div>' +
    '<div class="pr-pestanas" role="tablist">' +
      '<button type="button" role="tab" id="pr-tab-banco" aria-selected="true">Prueba completa</button>' +
      '<button type="button" role="tab" id="pr-tab-una" aria-selected="false">Probar una conversación</button>' +
    '</div>' +
    '<div class="pr-cuerpo" id="pr-cuerpo"></div>' +
    '<div class="pr-pie" id="pr-pie"></div>' +
  '</div>';
  document.body.appendChild(fondo);
  var cuerpo = fondo.querySelector('#pr-cuerpo');
  var pie = fondo.querySelector('#pr-pie');
  var pestana = 'banco', sondeo = null, verTodos = false, ultimo = null, textoUna = '';

  function cerrar() { clearTimeout(sondeo); fondo.remove(); document.removeEventListener('keydown', teclas); }
  function teclas(ev) { if (ev.key === 'Escape' && !document.querySelector('.lista-filtro')) cerrar(); }
  document.addEventListener('keydown', teclas);
  fondo.addEventListener('click', function (ev) { if (ev.target === fondo) cerrar(); });

  function elegirPestana(p) {
    pestana = p;
    fondo.querySelector('#pr-tab-banco').setAttribute('aria-selected', p === 'banco' ? 'true' : 'false');
    fondo.querySelector('#pr-tab-una').setAttribute('aria-selected', p === 'una' ? 'true' : 'false');
    if (p === 'banco') pintarBanco(ultimo); else pintarUna();
  }
  fondo.querySelector('#pr-tab-banco').onclick = function () { elegirPestana('banco'); };
  fondo.querySelector('#pr-tab-una').onclick = function () { elegirPestana('una'); };

  function errorConEnlace(mensaje, ir) {
    return '<div class="pr-error" role="alert">' + esc(mensaje) + (ir ? ' <a href="' + esc(ir) + '">Ir a Asistente IA</a>' : '') + '</div>';
  }

  /* ---- la prueba completa */
  function pintarBanco(d) {
    if (pestana !== 'banco') return;
    ultimo = d;
    var ev = d && d.evaluacion;
    var modelo = (ev && ev.modelo) || (d && d.modelo);
    fondo.querySelector('#pr-sub').textContent = 'Comprueba si tu IA' + (modelo ? ' (' + modelo + ')' : '') + ' pone bien las etiquetas antes de fiarte de ella. No toca ningún chat ni cambia ninguna nota.';
    pie.innerHTML = '<button type="button" id="pr-cerrar">Cerrar</button>';
    if (d && !d.hayIA && !(ev && ev.enCurso)) {
      cuerpo.innerHTML = errorConEnlace('Para probar la IA hace falta su clave: guárdala en Avanzado → Asistente IA. No hace falta activar el asistente.', '/panel#ia');
    } else if (ev && ev.enCurso) {
      var pct = ev.total ? Math.round((ev.hechos * 100) / ev.total) : 0;
      cuerpo.innerHTML = '<div class="pr-avance" aria-live="polite"><div>Probando <b>' + ev.hechos + ' de ' + ev.total + '</b> conversaciones…</div><div class="barra"><i style="width:' + pct + '%"></i></div><div class="pr-intro" style="margin:0">Tarda uno o dos minutos. Puedes cerrar esta ventana: la prueba sigue y al volver verás el resultado.</div></div>';
    } else if (ev && ev.error) {
      cuerpo.innerHTML = errorConEnlace('La prueba no terminó: ' + ev.error);
      pie.insertAdjacentHTML('afterbegin', '<button type="button" class="principal" id="pr-empezar">Probar otra vez</button>');
    } else if (ev && ev.informe) {
      cuerpo.innerHTML = pintarInforme(ev.informe, ev.termino);
      pie.insertAdjacentHTML('afterbegin', '<button type="button" id="pr-catalogo">Mejorar descripciones…</button><button type="button" class="principal" id="pr-empezar">Probar otra vez</button>');
    } else {
      cuerpo.innerHTML = '<p class="pr-intro">Se le pasan a tu IA <b>' + (d && d.total ? d.total : 'unas 50') + ' conversaciones típicas</b> del reparto, cada una con la etiqueta que le toca: una o más de cada etiqueta, chats donde todo va bien, temas que no tienen que ver con la entrega (los únicos que van a «Otro»), peticiones ya resueltas seguidas de otra pendiente y mensajes que intentan engañar a la IA.</p>' +
        '<p class="pr-intro">Al terminar verás cuántas acertó, si usa «Otro» solo cuando corresponde y en cuáles se equivocó, con la conversación a la vista.</p>' +
        '<div class="pr-vacio"><b>Lista para probar</b>Usa la IA y el catálogo de etiquetas de tu negocio.</div>';
      pie.insertAdjacentHTML('afterbegin', '<button type="button" class="principal" id="pr-empezar">Empezar la prueba</button>');
    }
    var b = pie.querySelector('#pr-empezar'); if (b) b.onclick = empezar;
    var c = pie.querySelector('#pr-catalogo'); if (c) c.onclick = function () { cerrar(); editarCatalogo(); };
    pie.querySelector('#pr-cerrar').onclick = cerrar;
    var t = cuerpo.querySelector('#pr-ver-todos'); if (t) t.onclick = function () { verTodos = !verTodos; pintarBanco(ultimo); };
  }

  function pintarInforme(inf, termino) {
    var tono = inf.precision >= 90 ? 'verde' : inf.precision >= 75 ? 'ambar' : 'rojo';
    var titular = inf.precision >= 90 ? 'Tu IA etiqueta bien' : inf.precision >= 75 ? 'Tu IA etiqueta aceptable: revisa en qué falla' : 'Tu IA se equivoca demasiado';
    var consejo = inf.precision >= 90
      ? 'Puedes fiarte de las etiquetas. Si alguna etiqueta falla, mejora su descripción en el catálogo.'
      : inf.precision >= 75
        ? 'Mira los fallos de abajo: si se repiten en una etiqueta, mejora su descripción en el catálogo. Un modelo más capaz en Asistente IA también ayuda.'
        : 'Prueba un modelo más capaz en Asistente IA y mejora las descripciones del catálogo de las etiquetas que fallan.';
    var hora = termino ? new Date(termino).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : '';
    var otroTexto = inf.otro.casos ? inf.otro.bien + ' de ' + inf.otro.casos : '—';
    var html = '<div class="pr-nota ' + tono + '"><div class="cifra">' + inf.precision + '%</div><div class="que"><b>' + esc(titular) + '</b>' +
      inf.aciertos + ' de ' + inf.total + ' conversaciones bien etiquetadas' + (hora ? ' · prueba de las ' + esc(hora) : '') + '. ' + esc(consejo) + '</div></div>';
    html += '<div class="pr-kpis">' +
      '<div class="pr-kpi' + (inf.otro.deMas ? ' malo' : '') + '"><b>' + inf.otro.deMas + '</b>veces puso «Otro» cuando había una etiqueta</div>' +
      '<div class="pr-kpi' + (inf.otro.casos && inf.otro.bien < inf.otro.casos ? ' malo' : '') + '"><b>' + otroTexto + '</b>temas ajenos que sí mandó a «Otro»</div>' +
      '<div class="pr-kpi' + (inf.sinRespuesta ? ' malo' : '') + '"><b>' + inf.sinRespuesta + '</b>sin respuesta válida (código que no existe o error)</div>' +
    '</div>';
    if (inf.saltados) html += '<p class="pr-intro">' + inf.saltados + ' conversación(es) no se probaron porque su etiqueta no está en tu catálogo.</p>';
    html += '<h4>Por etiqueta</h4><div class="pr-etiquetas">' + inf.porEtiqueta.map(function (e) {
      var falla = e.aciertos < e.casos;
      return '<span class="pe' + (falla ? ' falla' : '') + '" title="' + esc(e.aciertos + ' de ' + e.casos + ' bien') + '">' + chipDeCodigo(e.codigo, e.nombre) + '<span class="n">' + e.aciertos + '/' + e.casos + '</span></span>';
    }).join('') + '</div>';
    var malos = inf.resultados.filter(function (r) { return !r.acierto; });
    var lista = verTodos ? inf.resultados : malos;
    html += '<div class="pr-conmutador"><h4>' + (verTodos ? 'Todas las conversaciones' : malos.length ? 'En qué se equivocó (' + malos.length + ')' : 'Sin fallos') + '</h4>' +
      '<button type="button" id="pr-ver-todos">' + (verTodos ? 'Ver solo los fallos' : 'Ver las ' + inf.total) + '</button></div>';
    if (!lista.length) html += '<div class="pr-vacio"><b>Acertó todas</b>Ninguna conversación quedó con una etiqueta equivocada.</div>';
    html += '<div class="pr-casos">' + lista.map(function (r) {
      return '<div class="pr-caso ' + (r.acierto ? 'bien' : 'mal') + '"><div class="t">' + (r.acierto ? '✓ ' : '✗ ') + esc(r.titulo) + '</div>' +
        '<div class="comp"><span>Tocaba ' + chipDeCodigo(r.esperada, r.esperadaNombre) + '</span>' +
        (r.acierto && r.obtenida === r.esperada ? '' : '<span>Puso ' + chipDeCodigo(r.obtenida, r.obtenidaNombre) + '</span>') +
        (r.fallo ? '<span>' + esc(r.fallo) + '</span>' : '') + '</div>' +
        '<details><summary>Ver la conversación</summary><div class="pr-conv">' + r.conversacion.map(lineaDeCaso).join('') + '</div></details></div>';
    }).join('') + '</div>';
    return html;
  }

  async function consultar() {
    clearTimeout(sondeo);
    if (!document.body.contains(fondo)) return;
    try {
      var d = await api('/admin/chat/etiquetas/evaluar');
      pintarBanco(d);
      if (d.evaluacion && d.evaluacion.enCurso) sondeo = setTimeout(consultar, 1200);
    } catch (error) { if (pestana === 'banco') cuerpo.innerHTML = errorConEnlace(error.message); }
  }

  async function empezar() {
    verTodos = false;
    var b = pie.querySelector('#pr-empezar'); if (b) b.disabled = true;
    try {
      var ev = await api('/admin/chat/etiquetas/evaluar', { method: 'POST', body: {} });
      pintarBanco({ evaluacion: ev, hayIA: true, modelo: ev.modelo });
      sondeo = setTimeout(consultar, 800);
    } catch (error) {
      cuerpo.innerHTML = errorConEnlace(error.message, error.ir || (/clave/.test(error.message) ? '/panel#ia' : ''));
      if (b) b.disabled = false;
    }
  }

  /* ---- una conversacion a mano */
  function pintarUna(resultado) {
    clearTimeout(sondeo);
    cuerpo.innerHTML = '<p class="pr-intro">Escribe o pega una conversación y mira qué etiqueta le pondría la IA. Nada se guarda.</p>' +
      '<div class="pr-ejemplos">' + EJEMPLOS_PRUEBA.map(function (e, i) { return '<button type="button" data-ejemplo="' + i + '">' + esc(e.t) + '</button>'; }).join('') + '</div>' +
      '<textarea id="pr-texto" aria-label="Conversación para probar" spellcheck="false" placeholder="negocio: ¿Nos mandas tu ubicación para llevarte tu pedido hoy?\ncliente: [ubicación]\ncliente: Que lo reciba mi mamá, por favor">' + esc(textoUna) + '</textarea>' +
      '<div class="pr-guia">Una línea por mensaje: <code>cliente:</code> o <code>negocio:</code> delante. Para un pin, una foto o un audio del cliente escribe <code>[ubicación]</code>, <code>[foto]</code> o <code>[audio]</code>.</div>' +
      '<div id="pr-resultado">' + (resultado || '') + '</div>';
    pie.innerHTML = '<button type="button" id="pr-cerrar">Cerrar</button><button type="button" class="principal" id="pr-probar">Ver qué etiqueta pone</button>';
    var area = cuerpo.querySelector('#pr-texto');
    area.addEventListener('input', function () { textoUna = area.value; });
    area.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); probarUna(); } });
    cuerpo.querySelector('.pr-ejemplos').onclick = function (ev) {
      var b = ev.target.closest('[data-ejemplo]');
      if (!b) return;
      textoUna = EJEMPLOS_PRUEBA[Number(b.getAttribute('data-ejemplo'))].c;
      area.value = textoUna;
      cuerpo.querySelector('#pr-resultado').innerHTML = '';
      area.focus();
    };
    pie.querySelector('#pr-cerrar').onclick = cerrar;
    pie.querySelector('#pr-probar').onclick = probarUna;
  }

  async function probarUna() {
    var caja = cuerpo.querySelector('#pr-resultado');
    var boton = pie.querySelector('#pr-probar');
    if (!textoUna.trim()) { caja.innerHTML = errorConEnlace('Escribe primero la conversación.'); return; }
    boton.disabled = true;
    boton.textContent = 'Preguntando a la IA…';
    caja.innerHTML = '';
    try {
      var r = await api('/admin/chat/etiquetas/probar', { method: 'POST', body: { texto: textoUna } });
      if (pestana !== 'una') return;
      caja.innerHTML = r.etiqueta
        ? '<div class="pr-resultado" aria-live="polite">La IA' + (r.modelo ? ' (' + esc(r.modelo) + ')' : '') + ' le pondría ' + chipDeCodigo(r.etiqueta, r.nombre) + (r.descripcion ? '<div class="desc">' + esc(r.descripcion.charAt(0).toUpperCase() + r.descripcion.slice(1)) + '</div>' : '') + '</div>'
        : errorConEnlace('La IA no dio una etiqueta válida: ' + (r.motivo || 'sin respuesta') + '. En los chats quedaría «Sin clasificar».');
    } catch (error) {
      caja.innerHTML = errorConEnlace(error.message, error.ir || (/clave/.test(error.message) ? '/panel#ia' : ''));
    } finally {
      boton.disabled = false;
      boton.textContent = 'Ver qué etiqueta pone';
    }
  }

  cuerpo.innerHTML = '<div class="pr-vacio">Cargando…</div>';
  consultar();
}

/* Vuelve a leer TODOS los chats de hoy, tambien los ya etiquetados (p. ej. tras cambiar el catalogo). */
async function releerTodo() {
  var ok = await confirmarDialogo({ titulo: 'Volver a etiquetar todo', texto: 'La IA vuelve a leer todos los chats de hoy, también los que ya tienen etiqueta, y les pone la que corresponda con el catálogo actual. Sirve tras cambiar el catálogo. No se le manda nada a ningún cliente.', boton: 'Volver a etiquetar' });
  if (!ok) return;
  try {
    pintarEtiquetado(await api('/admin/chat/etiquetar', { method: 'POST', body: { releer: true } }));
    seguirEtiquetado();
  } catch (error) { pintarEtiquetado(null, error.message); }
}

document.getElementById('etiquetar').onclick = async function () {
  try {
    pintarEtiquetado(await api('/admin/chat/etiquetar', { method: 'POST', body: {} }));
    seguirEtiquetado();
  } catch (error) { pintarEtiquetado(null, error.message); }
};
document.getElementById('etiquetado').addEventListener('click', async function (event) {
  if (event.target.closest('[data-cerrar-etiquetado]')) { chatsDelLoteAbierto = false; pintarChatsDelLote(); pintarEtiquetado(null); return; }
  var ver = event.target.closest('[data-ver-chats]');
  if (ver) {
    chatsDelLoteAbierto = !chatsDelLoteAbierto;
    ver.textContent = chatsDelLoteAbierto ? 'Ocultar chats' : 'Ver chats del lote';
    ver.setAttribute('aria-expanded', chatsDelLoteAbierto ? 'true' : 'false');
    pintarChatsDelLote();
    return;
  }
});

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
  if (event.target.closest('[data-cargar-chats]')) { loadChats(true, true); return; }
  var menu = event.target.closest('[data-menu-fila]');
  if (menu) { event.stopPropagation(); return menuDeConversacion(menu, menu.getAttribute('data-menu-fila')); }
  var fila = event.target.closest('.chat');
  if (fila) openChat(fila.getAttribute('data-id'));
});
document.getElementById('chats').addEventListener('scroll', function () {
  if (hasMoreChats && !cargandoMasChats && this.scrollTop + this.clientHeight >= this.scrollHeight - 100) loadChats(true, true);
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
    var data = await api('/admin/chat/' + contactId + '?limit=30&read=' + (silent ? 'false' : 'true'));
    /* Dos guardas, en este orden: el usuario ya abrio otro chat (esta
       respuesta es de otro hilo), o ya se pinto algo mas nuevo de ESTE. */
    if (deseado && deseado !== contactId) return;
    if (mia < pintado) return;
    pintado = mia;
    var nuevo = !current || current.id !== contactId;
    var otroHilo = hilo.contactId !== contactId;
    var mensajesHilo = fundirHilo(contactId, data.messages, otroHilo ? data.hasMore : undefined);
    if (otroHilo) cursorNuevos = data.messages.reduce(function (max, m) { return BigInt(String(m.id)) > BigInt(max) ? String(m.id) : max; }, '0');
    if (deseado && deseado !== contactId) return;
    current = data.contact;
    hilo.scopeId = data.scopeId;
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
    pintarEtiquetaCabecera(esGrupo ? null : data.etiqueta);
    pintarSubtitulo(data);

    renderMessages(mensajesHilo, nuevo);
    renderComposer(data);

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
    (current.iaCerradaAt && !String(current.iaCerradaMotivo || '').startsWith('ubicación registrada') ? '<span class="pill warn t-marca" title="El asistente ya le mandó su mensaje de cierre y no contesta en este chat: contéstale tú.">Para una persona</span>' : '') +
    (data.reparto ? '<a class="t-pedido" href="/hoy' + (data.reparto.referencia ? '?buscar=' + encodeURIComponent(data.reparto.referencia) : '') + '" title="Ver en Hoy">' + esc(data.reparto.referencia ? 'Pedido ' + data.reparto.referencia : 'Reparto') + ': ' + esc(ESTADO_REPARTO[data.reparto.estado] || data.reparto.estado) + '</a>' : '') +
    (data.reparto && data.reparto.esperaEnvio ? '<span class="t-tel">' + esc(data.reparto.esperaEnvio.motivo) + (data.reparto.esperaEnvio.hasta ? ' · ' + esc(new Date(data.reparto.esperaEnvio.hasta).toLocaleTimeString()) : '') + '</span>' : '');
  /* Sus conversaciones anteriores ya guardadas se cuentan y se abren desde la ficha (ⓘ). */
}

/**
 * "En línea" y "escribiendo…", solo donde se puede saber de verdad.
 *
 * Con la Cloud API de Meta ese dato no existe. En vez de inventarlo, no se
 * pinta nada: es la unica forma honesta de contarlo.
 */
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
    var data = await api('/admin/chat/' + current.id + '?limit=30&before=' + primero.id);
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
  messages = messages.filter(function (m) { return ['text', 'location', 'location_request', 'buttons', 'template', 'interactive'].indexOf(m.kind) >= 0; });
  messages = messages.filter(function (m) { return !m.expiresAt || Date.parse(m.expiresAt) > Date.now(); });
  pintados = messages;
  clearTimeout(expiryTimer);
  var proximas = messages.map(function (m) { return Date.parse(m.expiresAt || '') || Infinity; }).filter(function (t) { return t > Date.now(); });
  if (proximas.length) expiryTimer = setTimeout(function () {
    if (!current) return;
    hilo.mensajes = hilo.mensajes.filter(function (m) { return !m.expiresAt || Date.parse(m.expiresAt) > Date.now(); });
    renderMessages(hilo.mensajes, false, true);
    loadChats(true);
  }, Math.max(25, Math.min.apply(Math, proximas) - Date.now() + 20));
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
  messages.forEach(function (m, i) {
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
      anuncioHtml(m) +
      ubicacionHtml(m) +
      resaltar(withLinks(cuerpoVisible(m))) +
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

  if (box.innerHTML !== html) {
    var previo = new Map();
    Array.from(box.children).forEach(function (n) {
      var clave = n.classList.contains('msg') ? 'm:' + n.getAttribute('data-id') : n.classList.contains('day') ? 'd:' + n.getAttribute('data-day') : n.classList.contains('mas-antiguos') ? 'older' : null;
      if (clave) previo.set(clave, n);
    });
    var temporal = document.createElement('div'); temporal.innerHTML = html;
    var usados = new Set();
    var actual = box.firstChild;
    Array.from(temporal.children).forEach(function (n) {
      if (n.classList.contains('day')) n.setAttribute('data-day', n.textContent || '');
      var clave = n.classList.contains('msg') ? 'm:' + n.getAttribute('data-id') : n.classList.contains('day') ? 'd:' + n.getAttribute('data-day') : n.classList.contains('mas-antiguos') ? 'older' : null;
      var viejo = clave && previo.get(clave);
      var elegido = viejo && viejo.outerHTML === n.outerHTML ? viejo : n;
      usados.add(elegido);
      if (elegido !== actual) box.insertBefore(elegido, actual);
      actual = elegido.nextSibling;
    });
    Array.from(box.children).forEach(function (n) { if (!usados.has(n)) n.remove(); });
  }
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

/* ---------------------------------------------------------- acciones sueltas */

/* Copiar unas coordenadas (o cualquier cosa con data-copiar). */
document.addEventListener('click', function (ev) {
  var b = ev.target && ev.target.closest ? ev.target.closest('[data-copiar]') : null;
  if (!b) return;
  copiar(b.getAttribute('data-copiar') || '');
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
    if (current.iaCerradaAt && !String(current.iaCerradaMotivo || '').startsWith('ubicación registrada')) marcas.push('<span class="pill warn">Para una persona</span>');
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
  if (!esGrupo) ops.push({ icono: '🤖', texto: current.botPausadoAt ? 'Reactivar bot' : 'Callar bot', accion: alternarBot });
  if (!esGrupo) ops.push({ icono: '⚑', texto: 'Enviar incidencia manual', accion: function () { abrirIncidenciaManual({ phone: current.phone, contactId: current.id, alTerminar: function () { openChat(current.id, true); } }); } });
  if (!esGrupo && current.iaCerradaAt) ops.push({ icono: '↩', texto: 'Que el asistente vuelva a atender este chat', accion: reabrirAsistente });
  if (!esGrupo) ops.push({ icono: '⟲', texto: 'Volver a empezar con este cliente', accion: function () { volverAEmpezar(current.id); } });
  ops.push({ icono: '⭐', texto: 'Mensajes destacados de este chat', accion: function () { verDestacados(true); } });
  ops.push({ hr: true });
  ops.push({ icono: '📌', texto: c.fijadoAt ? 'Quitar de arriba' : 'Fijar arriba', accion: function () { ajustarLista(current.id, { fijado: !c.fijadoAt }); } });
  ops.push({ icono: c.silenciadoAt ? '🔔' : '🔕', texto: c.silenciadoAt ? 'Volver a avisar' : 'Silenciar', accion: function () { ajustarLista(current.id, { silenciado: !c.silenciadoAt }); } });
  ops.push({ hr: true });
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
    { icono: '⭐', texto: 'Todos los mensajes destacados', accion: function () { verDestacados(false); } },
    { icono: '🏷', texto: 'Catálogo de etiquetas…', accion: editarCatalogo },
    { icono: '🧪', texto: 'Probar la IA…', accion: probarIA },
    { icono: '↻', texto: 'Volver a etiquetar todo', accion: releerTodo },
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
  if (payload.text) pendiente = pintarPendiente(payload.text);
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
    payload.atiendePersona = true;
    if (cita) payload.citaId = cita;
    var r = await api('/admin/chat/send', { method: 'POST', body: payload });
    if (r.ok === false) {
      if (pendiente) pendiente.remove();
      toast('No salió: ' + (r.reason || r.error || 'bloqueado por las guardas'));
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

  if (!templates.length && !templatesCargando) {
    templatesCargando = true;
    loadTemplates().then(function () { templatesCargando = false; if (current && current.id === data.contact.id) renderComposer(data); });
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
        : '<span>No hay una plantilla aprobada disponible para retomar esta conversación.</span>') +
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
var templatesCargando = false;

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
    !document.getElementById('buscar-hilo').classList.contains('hidden') ||
    document.querySelector('.dlg-fondo, .visor, .ayuda-teclas') !== null;
}

async function sincronizarChat() {
  if (!current || syncActiva) { syncPendiente = Boolean(current); return; }
  syncActiva = true;
  try {
    do {
      syncPendiente = false;
      var contactId = current.id;
      var data = await api('/admin/chat/' + contactId + '/sync', { method: 'POST', body: { afterId: cursorNuevos, knownIds: hilo.mensajes.map(function (m) { return String(m.id); }).slice(-300) } });
      if (!current || current.id !== contactId || data.scopeId !== hilo.scopeId) continue;
      if (data.scopeId) hilo.scopeId = data.scopeId;
      if (data.goneIds && data.goneIds.length) {
        var vencidos = new Set(data.goneIds);
        hilo.mensajes = hilo.mensajes.filter(function (m) { return !vencidos.has(String(m.id)); });
      }
      if (data.messages && data.messages.length) {
        data.messages.forEach(function (m) { if (BigInt(String(m.id)) > BigInt(cursorNuevos)) cursorNuevos = String(m.id); });
        fundirHilo(contactId, data.messages, hilo.masAntiguos);
        if (!ocupado()) renderMessages(hilo.mensajes, false, false);
      }
      if (data.hasMoreNew) syncPendiente = true;
    } while (syncPendiente && current);
  } catch (error) { if (error.status === 409 || error.status === 401) location.href = '/login'; }
  finally { syncActiva = false; }
}
var eventosPendientes = new Set(), eventoTimer = null;
function procesarEventosChat() {
  eventoTimer = null;
  var ids = Array.from(eventosPendientes); eventosPendientes.clear();
  loadChats(true);
  if ((ids.includes('*') || (current && ids.includes(current.id))) && !ocupado()) sincronizarChat();
}
if (window.suscribirEventosPanel) window.suscribirEventosPanel(function (nombre, datos) {
  if (nombre === 'panel.ready') return;
  if (nombre === 'panel.resync') eventosPendientes.add('*');
  else if (nombre === 'chat.changed' && datos.contactId) eventosPendientes.add(datos.contactId);
  else if (nombre === 'chat.status') eventosPendientes.add('*');
  else if (nombre === 'chat.expired') eventosPendientes.add(datos.contactId || '*');
  if (eventosPendientes.size && !eventoTimer) eventoTimer = setTimeout(procesarEventosChat, 250);
});
/* El sondeo es solo respaldo cuando el stream falla; nunca reconstruye el hilo completo. */
window.sondearPanel(async function () {
  if (window.eventosPanelConectados || ocupado()) return;
  await loadChats(true);
  if (current) await sincronizarChat();
}, 60000);

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

`;

  const arranque = String.raw`
/* Se arranca al final, cuando ya existe todo lo de arriba. */
pintarBotonDeEnviar();
cargarAtajos();
window.sondearPanel(revisarConexion, 30000, true);

loadChats().then(abrirDesdeUrl);
seguirEtiquetado(true);
cargarConteoEtiquetas();
/* Los enlaces de Asistente IA y Entrenamiento IA: /chat#probar-ia y /chat#catalogo abren su ventana
   (al entrar, o si ya se estaba en Chats y solo cambia el #). */
function abrirSegunHash() {
  if (location.hash !== '#probar-ia' && location.hash !== '#catalogo') return;
  if (location.hash === '#probar-ia') probarIA(); else editarCatalogo();
  history.replaceState(null, '', location.pathname + location.search);
}
abrirSegunHash();
window.addEventListener('hashchange', abrirSegunHash);
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
