/**
 * El compositor: lo que hay de la raya para abajo.
 *
 * El menú "+", emojis de texto, respuestas rápidas, citas y envío de pins.
 *
 * Esta aparte de `chat-page.ts` por tamano y porque es una unidad: todo lo de
 * abajo comparte la misma regla -un solo panel abierto a la vez-, y tenerlo
 * junto es lo que hace que esa regla se cumpla sola.
 *
 */

export const CHAT_JS_COMPOSITOR = String.raw`
/* -------------------------------------------- un solo panel abierto a la vez

   Antes convivian la fila de herramientas, la barra de rapidas, el popup de
   atajos y el de stickers: cuatro superficies que se tapaban entre ellas. */
var PANELES = ['panel-atajos', 'panel-emojis'];

function cerrarPaneles(menos) {
  PANELES.forEach(function (id) { if (id !== menos) ver(id, false); });
  ['boton-emoji', 'boton-mas'].forEach(function (id) {
    var b = document.getElementById(id);
    if (b) b.setAttribute('aria-expanded', 'false');
  });
}
function panelAbierto(id) { return !document.getElementById(id).classList.contains('hidden'); }
function alternarPanel(id, dueno) {
  var abierto = panelAbierto(id);
  cerrarPaneles();
  ver(id, !abierto);
  if (dueno) dueno.setAttribute('aria-expanded', abierto ? 'false' : 'true');
  return !abierto;
}

/* ------------------------------------------------------- la cita pendiente */

var citaPendiente = null;

/** Responder a un mensaje: la previa se queda encima del compositor. */
function citarMensaje(id) {
  var m = mensajePorId(id);
  if (!m) return;
  citaPendiente = id;
  var caja = document.getElementById('cita-previa');
  caja.querySelector('.quien').textContent = m.direction === 'out' ? 'Tú' : nombreDe(current || {});
  caja.querySelector('.que').textContent = resumenDeMensaje(m);
  ver('cita-previa', true);
  input.focus();
}
function quitarCita() {
  citaPendiente = null;
  ver('cita-previa', false);
}
document.getElementById('cita-quitar').onclick = function () { quitarCita(); input.focus(); };

/* ------------------------------------------------------------ el menu "+" */

document.getElementById('boton-mas').onclick = function () {
  var enGrupo = current && current.tipo === 'grupo';
  var ops = [
    { icono: '⚡', texto: 'Respuestas rápidas', accion: function () { abrirAtajos(''); } },
    { hr: true },
    { icono: '🗺', texto: 'Mandar un pin del mapa', accion: function () { pedirPin(); } },
  ];
  if (!enGrupo) {
    ops.push({ icono: '📍', texto: 'Pedirle su ubicación', accion: function () { if (!enviando) enviar({ askLocation: true }); } });
  }
  menuDeBoton(this, ops);
};

/** Mandar un pin: se pide el link o las coordenadas y se manda. */
async function pedirPin() {
  var v = await pedirDato({
    titulo: 'Mandar un pin del mapa',
    texto: 'Pega un enlace de Google Maps o unas coordenadas. Al cliente le llega el pin, no el texto.',
    etiqueta: 'Enlace o coordenadas',
    marcador: '-12.046, -77.042',
    boton: 'Mandar el pin',
  });
  if (v) enviar({ location: v });
}

/* ------------------------------------------------------ selector de emoji */

var EMOJIS = [
  { grupo: 'Caras', lista: '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤗 🤭 🤫 🤔 🤐 😐 😑 😶 😏 😒 🙄 😬 😮 😯 😲 😳 🥺 😢 😭 😤 😠 😡 🤬 😱 😨 😰 😥 😓 🤗 🤥 😴 🤤 😪 😵 🤢 🤮 🤧 😷 🤒 🤕 🥳 😎 🤓 🧐' },
  { grupo: 'Gestos', lista: '👍 👎 👌 ✌️ 🤞 🤟 🤘 👏 🙌 👐 🤝 🙏 💪 👀 🫡 🤙 ☝️ 👋 ✋ 🖐️ 🤲' },
  { grupo: 'Corazones', lista: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝' },
  { grupo: 'Trabajo', lista: '✅ ❌ ⚠️ ❗ ❓ 📌 📍 📎 📝 📄 📦 🚚 🛵 🏍️ 🏠 🏢 🕐 ⏰ 📅 💰 💵 💳 🧾 📞 📱 💬 🔔 🔕 🔒 🔑 ⭐ 🔥 ✨ 🎉 🎁 ☑️' },
  { grupo: 'Comida', lista: '🍕 🍔 🍟 🌭 🥪 🌮 🍗 🍖 🍜 🍣 🍱 🥗 🍰 🎂 🍪 🍫 🍬 ☕ 🍺 🥤 🧃 🍎 🍌 🍇 🍓' },
];

/** Los ultimos que usaste, en este navegador. Se pierde al limpiar el equipo, y no pasa nada. */
function emojisRecientes() {
  try { return JSON.parse(localStorage.getItem('chat-emojis') || '[]'); } catch (e) { return []; }
}
function apuntarEmoji(e) {
  try {
    var lista = emojisRecientes().filter(function (x) { return x !== e; });
    lista.unshift(e);
    localStorage.setItem('chat-emojis', JSON.stringify(lista.slice(0, 24)));
  } catch (error) { /* sin almacenamiento local no se guardan los recientes: nada grave */ }
}

function pintarEmojis(filtro) {
  var caja = document.getElementById('emojis-rejillas');
  var q = (filtro || '').trim().toLowerCase();
  var bloques = [];
  var recientes = emojisRecientes();
  if (!q && recientes.length) bloques.push({ grupo: 'Los últimos que usaste', lista: recientes.join(' ') });
  EMOJIS.forEach(function (g) {
    if (q && g.grupo.toLowerCase().indexOf(q) < 0) return;
    bloques.push(g);
  });
  if (q && !bloques.length) {
    caja.innerHTML = '<p class="pie">Ningún grupo se llama así. Busca por «caras», «gestos», «corazones», «trabajo» o «comida».</p>';
    return;
  }
  caja.innerHTML = bloques.map(function (g) {
    return '<h5>' + esc(g.grupo) + '</h5><div class="rejilla">' +
      g.lista.split(/\s+/).filter(Boolean).map(function (e) {
        return '<button type="button" data-emoji="' + esc(e) + '" aria-label="Poner ' + esc(e) + '">' + e + '</button>';
      }).join('') + '</div>';
  }).join('');
}

document.getElementById('boton-emoji').onclick = function () {
  if (alternarPanel('panel-emojis', this)) {
    pintarEmojis('');
    document.getElementById('emojis-buscar').value = '';
  }
};
document.getElementById('emojis-buscar').addEventListener('input', function () { pintarEmojis(this.value); });
document.getElementById('panel-emojis').addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-emoji]');
  if (!b) return;
  var e = b.getAttribute('data-emoji');
  apuntarEmoji(e);
  ponerEnElCursor(e);
});

/** Pone el emoji donde esta el cursor, sin pisar lo ya escrito. */
function ponerEnElCursor(texto) {
  var i = input.selectionStart == null ? input.value.length : input.selectionStart;
  var j = input.selectionEnd == null ? i : input.selectionEnd;
  input.value = input.value.slice(0, i) + texto + input.value.slice(j);
  input.focus();
  input.setSelectionRange(i + texto.length, i + texto.length);
  ajustarAlto();
  pintarBotonDeEnviar();
}

/**
 * Elegir un emoji para otra cosa (una reaccion, por ejemplo).
 * Reaprovecha el mismo panel en vez de tener dos selectores distintos.
 */
function elegirEmoji(alElegir) {
  var fondo = document.createElement('div');
  fondo.className = 'dlg-fondo';
  fondo.innerHTML = '<div class="dlg" role="dialog" aria-modal="true" style="width:min(420px,100%)">' +
    '<h3>Elige un emoji</h3><div class="emojis" id="ee-cuerpo"></div>' +
    '<div class="botones"><button type="button" id="dlg-no">Cancelar</button></div></div>';
  function cerrar() { document.removeEventListener('keydown', teclas); fondo.remove(); }
  function teclas(ev) { if (ev.key === 'Escape') cerrar(); }
  document.addEventListener('keydown', teclas);
  fondo.querySelector('#dlg-no').onclick = cerrar;
  fondo.onclick = function (ev) { if (ev.target === fondo) cerrar(); };
  document.body.appendChild(fondo);
  var cuerpo = fondo.querySelector('#ee-cuerpo');
  cuerpo.innerHTML = EMOJIS.map(function (g) {
    return '<h5>' + esc(g.grupo) + '</h5><div class="rejilla">' +
      g.lista.split(/\s+/).filter(Boolean).map(function (e) { return '<button type="button" data-emoji="' + esc(e) + '">' + e + '</button>'; }).join('') +
      '</div>';
  }).join('');
  cuerpo.onclick = function (ev) {
    var b = ev.target.closest('[data-emoji]');
    if (!b) return;
    var e = b.getAttribute('data-emoji');
    apuntarEmoji(e);
    cerrar();
    alElegir(e);
  };
}

function pintarBotonDeEnviar() { document.getElementById('send').classList.toggle('hidden', !input.value.trim()); }
function ajustarAlto() { input.style.height = 'auto'; input.style.height = Math.min(140, input.scrollHeight) + 'px'; }

/* ---------------------------------- respuestas rapidas: "/" o el menu "+" */

var atajos = [];
var atajoSel = 0;

async function cargarAtajos() {
  try { atajos = (await api('/admin/chat/atajos')).atajos || []; }
  catch (error) { atajos = []; console.log('[chat] no se pudieron cargar las respuestas rápidas:', error && error.message); }
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
function atajosAbierto() { return panelAbierto('panel-atajos'); }
function cerrarAtajos() { ver('panel-atajos', false); }
function abrirAtajos(filtro) { cerrarPaneles('panel-atajos'); pintarAtajos(filtro || ''); input.focus(); }

function pintarAtajos(filtro) {
  var box = document.getElementById('panel-atajos');
  var lista = atajos.filter(function (a) { return !filtro || a.atajo.indexOf(filtro) === 0 || a.texto.toLowerCase().indexOf(filtro) >= 0; });
  if (!lista.length) {
    box.innerHTML = '<div class="pie">Ninguna respuesta rápida empieza por «/' + esc(filtro) + '». Se crean en <a class="link" href="/panel#automatizacion">Panel → Automatización</a>.</div>';
    box.classList.remove('hidden');
    box._lista = [];
    return;
  }
  if (atajoSel >= lista.length) atajoSel = 0;
  box.innerHTML = '<div class="atajos">' + lista.map(function (a, i) {
    return '<div class="op' + (i === atajoSel ? ' sel' : '') + '" data-i="' + i + '"><b>/' + esc(a.atajo) + '</b><span>' + esc(rellenarAtajo(a.texto)) + '</span></div>';
  }).join('') + '</div><div class="pie">↑↓ para moverte · Enter o Tab para poner el texto · Esc para cerrar</div>';
  box._lista = lista;
  box.querySelectorAll('.op').forEach(function (el) { el.onclick = function () { atajoSel = Number(el.getAttribute('data-i')); elegirAtajo(); }; });
  box.classList.remove('hidden');
}
function atajosDesdeTexto() {
  var v = input.value;
  if (v.charAt(0) === '/' && v.indexOf(' ') < 0 && v.indexOf('\n') < 0) { atajoSel = atajosAbierto() ? atajoSel : 0; cerrarPaneles('panel-atajos'); pintarAtajos(v.slice(1).toLowerCase()); }
  else if (atajosAbierto()) cerrarAtajos();
}
function moverAtajo(d) {
  var lista = document.getElementById('panel-atajos')._lista || [];
  if (!lista.length) return;
  atajoSel = (atajoSel + d + lista.length) % lista.length;
  pintarAtajos(input.value.charAt(0) === '/' ? input.value.slice(1).toLowerCase() : '');
}
function elegirAtajo() {
  var lista = document.getElementById('panel-atajos')._lista || [];
  var a = lista[atajoSel];
  cerrarAtajos();
  if (!a) return;
  ponerTexto(rellenarAtajo(a.texto));
}
function ponerTexto(texto) {
  input.value = texto;
  ajustarAlto();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  pintarBotonDeEnviar();
}

/* La barra de pastillas: un clic manda; con Shift lo deja en el cuadro. */
function etiquetaDe(atajo) {
  var t = atajo.replace(/[_-]+/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function pintarBarraRapidas() {
  var barra = document.getElementById('rapidas-barra');
  if (!barra) return;
  /* Sin respuestas rapidas, la barra no existe: una fila vacia es ruido. */
  if (!atajos.length) { barra.classList.add('hidden'); return; }
  barra.classList.remove('hidden');
  var html = atajos.map(function (a, i) {
    return '<button class="chip" type="button" data-rapida="' + i + '" title="Manda: ' + esc(rellenarAtajo(a.texto)) + ' (Shift+clic para retocarlo antes)">' + esc(etiquetaDe(a.atajo)) + '</button>';
  }).join('') + '<a class="chip editar" href="/panel#automatizacion" title="Añadir, cambiar o quitar respuestas rápidas">✎ Editar</a>';
  if (barra.innerHTML !== html) barra.innerHTML = html;
  barra.querySelectorAll('[data-rapida]').forEach(function (b) {
    b.onclick = function (ev) {
      var a = atajos[Number(b.getAttribute('data-rapida'))];
      if (!a) return;
      if (ev.shiftKey) return ponerTexto(rellenarAtajo(a.texto));
      enviar({ text: rellenarAtajo(a.texto) });
    };
  });
}

`;
