/**
 * El compositor: lo que hay de la raya para abajo.
 *
 * El menu "+", el selector de emoji, los stickers, las respuestas rapidas, la
 * previa del adjunto, la previa de la cita y la grabadora de notas de voz.
 *
 * Esta aparte de `chat-page.ts` por tamano y porque es una unidad: todo lo de
 * abajo comparte la misma regla -un solo panel abierto a la vez-, y tenerlo
 * junto es lo que hace que esa regla se cumpla sola.
 *
 * OJO: la "voz" de aqui es la del operador, grabada con el microfono. La otra
 * voz (src/voz) es texto a voz del asistente y sale por «Mandar como audio».
 */

export const CHAT_JS_COMPOSITOR = String.raw`
/* -------------------------------------------- un solo panel abierto a la vez

   Antes convivian la fila de herramientas, la barra de rapidas, el popup de
   atajos y el de stickers: cuatro superficies que se tapaban entre ellas. */
var PANELES = ['panel-atajos', 'panel-stickers', 'panel-emojis'];

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
    { icono: '📷', texto: 'Foto, video o archivo', accion: function () { document.getElementById('archivo').click(); } },
    { icono: '🙂', texto: 'Sticker', accion: function () { abrirStickers(); } },
    { icono: '⚡', texto: 'Respuestas rápidas', accion: function () { abrirAtajos(''); } },
    { hr: true },
    { icono: '🗺', texto: 'Mandar un pin del mapa', accion: function () { pedirPin(); } },
  ];
  if (!enGrupo) {
    ops.push({ icono: '📍', texto: 'Pedirle su ubicación', accion: function () { if (!enviando) enviar({ askLocation: true }); } });
    ops.push({ icono: '🔊', texto: 'Mandar lo escrito como audio', accion: function () { mandarComoAudio(); } });
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

/** La voz del asistente (texto a voz): manda lo escrito como nota de voz. */
function mandarComoAudio() {
  var texto = input.value.trim();
  if (!texto) { toast('Escribe primero lo que quieres que diga el audio.'); input.focus(); return; }
  if (enviando) return;
  input.value = '';
  ajustarAlto();
  enviar({ text: texto, voz: true });
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

/* ------------------------------------------------------- nota de voz (micro)

   Esto graba la voz de quien atiende. No confundir con «Mandar como audio»,
   que es la voz del asistente leyendo lo escrito. */

var grabadora = null;
var grabacion = { trozos: [], desde: 0, reloj: null, blob: null, url: null, medidor: null };

function puedeGrabar() {
  return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
}

/** El formato que prefiere WhatsApp es ogg/opus; si el navegador no lo tiene, webm/opus. */
function formatoDeVoz() {
  var candidatos = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'];
  for (var i = 0; i < candidatos.length; i++) {
    if (window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(candidatos[i])) return candidatos[i];
  }
  return '';
}

async function empezarAGrabar() {
  if (!current) return;
  if (!puedeGrabar()) { toast('Este navegador no puede grabar audio. Usa el clip para mandar un fichero de audio.'); return; }
  try {
    var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    var tipo = formatoDeVoz();
    grabadora = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
    grabacion = { trozos: [], desde: Date.now(), reloj: null, blob: null, url: null, medidor: null, stream: stream };
    grabadora.ondataavailable = function (ev) { if (ev.data && ev.data.size) grabacion.trozos.push(ev.data); };
    grabadora.onstop = function () {
      grabacion.blob = new Blob(grabacion.trozos, { type: grabadora.mimeType || tipo || 'audio/webm' });
      grabacion.url = URL.createObjectURL(grabacion.blob);
      pintarGrabacionLista();
    };
    grabadora.start(250);
    ver('grabando', true);
    ver('composer', false);
    grabacion.reloj = setInterval(pintarTiempo, 200);
    medirVoz(stream);
    pintarTiempo();
  } catch (error) {
    toast('No se pudo usar el micrófono: ' + (error && error.message ? error.message : 'permiso denegado') + '. Revisa el permiso del navegador.');
  }
}

/** La onda: no es decorativa, es lo que dice que el microfono de verdad oye. */
function medirVoz(stream) {
  try {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var fuente = ctx.createMediaStreamSource(stream);
    var analizador = ctx.createAnalyser();
    analizador.fftSize = 256;
    fuente.connect(analizador);
    var datos = new Uint8Array(analizador.frequencyBinCount);
    var onda = document.getElementById('grabando-onda');
    grabacion.medidor = setInterval(function () {
      analizador.getByteFrequencyData(datos);
      var suma = 0;
      for (var i = 0; i < datos.length; i++) suma += datos[i];
      var nivel = Math.min(26, 3 + (suma / datos.length) / 4);
      var barra = document.createElement('i');
      barra.style.height = nivel + 'px';
      onda.appendChild(barra);
      while (onda.childElementCount > 60) onda.removeChild(onda.firstChild);
    }, 90);
    grabacion.audioCtx = ctx;
  } catch (error) { /* sin medidor se graba igual: la onda es ayuda, no requisito */ }
}

function pintarTiempo() {
  var s = Math.floor((Date.now() - grabacion.desde) / 1000);
  document.getElementById('grabando-tiempo').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  /* WhatsApp no acepta mas de 16 MB: a los 5 minutos se corta solo y se avisa. */
  if (s >= 300 && grabadora && grabadora.state === 'recording') {
    pararDeGrabar();
    toast('La nota de voz se cortó a los 5 minutos. Escúchala y mándala, o repítela más corta.');
  }
}

function pararDeGrabar() {
  if (grabadora && grabadora.state !== 'inactive') grabadora.stop();
  clearInterval(grabacion.reloj);
  clearInterval(grabacion.medidor);
  if (grabacion.stream) grabacion.stream.getTracks().forEach(function (t) { t.stop(); });
  if (grabacion.audioCtx) grabacion.audioCtx.close().catch(function () {});
}

/** Grabada: se puede escuchar antes de mandarla, o tirarla. */
function pintarGrabacionLista() {
  var caja = document.getElementById('grabando');
  caja.innerHTML =
    '<audio controls src="' + grabacion.url + '"></audio>' +
    '<button type="button" id="voz-tirar" title="Descartar la nota de voz">🗑 Descartar</button>' +
    '<button type="button" id="voz-enviar" class="primary" style="background:var(--accent);color:var(--primario-texto);border-color:var(--accent)">Enviar nota de voz</button>';
  document.getElementById('voz-tirar').onclick = cancelarGrabacion;
  document.getElementById('voz-enviar').onclick = enviarNotaDeVoz;
}

function cancelarGrabacion() {
  pararDeGrabar();
  if (grabacion.url) URL.revokeObjectURL(grabacion.url);
  grabacion = { trozos: [], desde: 0, reloj: null, blob: null, url: null, medidor: null };
  grabadora = null;
  pintarGrabandoVacio();
  ver('grabando', false);
  ver('composer', true);
  input.focus();
}

function pintarGrabandoVacio() {
  document.getElementById('grabando').innerHTML =
    '<span class="punto" aria-hidden="true"></span>' +
    '<span class="tiempo" id="grabando-tiempo">0:00</span>' +
    '<span class="onda" id="grabando-onda" aria-hidden="true"></span>' +
    '<button type="button" id="voz-cancelar" title="Cancelar la grabación">Cancelar</button>' +
    '<button type="button" id="voz-parar" class="primary" style="background:var(--accent);color:var(--primario-texto);border-color:var(--accent)">Parar</button>';
  document.getElementById('voz-cancelar').onclick = cancelarGrabacion;
  document.getElementById('voz-parar').onclick = function () { pararDeGrabar(); };
}

async function enviarNotaDeVoz() {
  if (!grabacion.blob || !current) return;
  var boton = document.getElementById('voz-enviar');
  boton.disabled = true;
  boton.textContent = 'Enviando…';
  var lector = new FileReader();
  lector.onload = async function () {
    var pendiente = pintarPendiente('🎤 Nota de voz');
    var cita = citaPendiente;
    quitarCita();
    try {
      var r = await api('/admin/chat/adjunto', { method: 'POST', body: {
        contactId: current.id,
        datos: lector.result,
        mimeType: grabacion.blob.type || 'audio/webm',
        filename: 'nota-de-voz.' + ((grabacion.blob.type || '').indexOf('ogg') >= 0 ? 'ogg' : 'webm'),
        voz: true,
        citaId: cita || undefined,
      } });
      if (r.ok === false) { if (pendiente) pendiente.remove(); toast('No salió: ' + (r.reason || r.error || 'bloqueado por las guardas')); }
      cancelarGrabacion();
      await openChat(current.id, true);
      loadChats(true);
    } catch (error) {
      if (pendiente) pendiente.remove();
      boton.disabled = false;
      boton.textContent = 'Enviar nota de voz';
      toast(error && error.message ? error.message : 'No se pudo mandar la nota de voz.');
    }
  };
  lector.onerror = function () { boton.disabled = false; boton.textContent = 'Enviar nota de voz'; toast('No se pudo leer la grabación.'); };
  lector.readAsDataURL(grabacion.blob);
}

/* ------------------------------------- micro o avion, segun haya texto o no */

function pintarBotonDeEnviar() {
  var hayTexto = input.value.trim().length > 0;
  var avion = document.getElementById('send');
  var micro = document.getElementById('grabar');
  avion.classList.toggle('hidden', !hayTexto);
  micro.classList.toggle('hidden', hayTexto || !puedeGrabar());
}
document.getElementById('grabar').onclick = empezarAGrabar;

function ajustarAlto() {
  input.style.height = 'auto';
  input.style.height = Math.min(140, input.scrollHeight) + 'px';
}

/* ------------------------------------------------ fotos y archivos (clip) */

var MAX_ADJUNTO = 16 * 1024 * 1024;
var adjuntoPendiente = null;

function nombreDeTipo(mime) {
  if (/^image\//.test(mime)) return 'foto';
  if (/^video\//.test(mime)) return 'video';
  if (/^audio\//.test(mime)) return 'audio';
  return 'archivo';
}

/* Deja el fichero en la previa, con su pie, listo para mandar. */
function elegirAdjunto(file) {
  if (!file || !current) return;
  if (file.size > MAX_ADJUNTO) { toast('WhatsApp no acepta ficheros de más de 16 MB. Usa uno más ligero.'); return; }
  var mime = file.type || 'application/octet-stream';
  var nombre = file.name || ('pegado.' + (mime.split('/')[1] || 'bin'));
  var lector = new FileReader();
  lector.onload = function () {
    adjuntoPendiente = { datos: lector.result, mimeType: mime, filename: nombre, tipo: nombreDeTipo(mime), bytes: file.size };
    pintarPrevia();
  };
  lector.onerror = function () { toast('No se pudo leer el fichero.'); };
  lector.readAsDataURL(file);
}

function pintarPrevia() {
  var box = document.getElementById('adjunto-previa');
  var a = adjuntoPendiente;
  if (!a) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  var vista = a.tipo === 'foto' ? '<img src="' + a.datos + '" alt="">'
    : a.tipo === 'video' ? '<video src="' + a.datos + '" muted></video>'
    : '<div class="icono" aria-hidden="true">' + (a.tipo === 'audio' ? '🎵' : '📄') + '</div>';
  box.innerHTML = vista +
    '<div class="datos">' +
      '<div class="nombre">' + esc(a.filename) + ' · ' + esc(pesoLegible(a.bytes)) + '</div>' +
      (a.tipo === 'audio' ? '' : '<input id="adjunto-pie" placeholder="Pie de foto (opcional) · Enter para mandar" autocomplete="off" aria-label="Pie de foto">') +
      '<div class="acciones"><button class="primary" id="adjunto-enviar">Enviar ' + esc(a.tipo) + '</button><button id="adjunto-cancelar">Cancelar</button></div>' +
    '</div>';
  box.classList.remove('hidden');
  document.getElementById('adjunto-enviar').onclick = enviarAdjunto;
  document.getElementById('adjunto-cancelar').onclick = function () { adjuntoPendiente = null; pintarPrevia(); input.focus(); };
  var pie = document.getElementById('adjunto-pie');
  if (pie) {
    pie.focus();
    pie.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); enviarAdjunto(); }
      if (e.key === 'Escape') { e.preventDefault(); adjuntoPendiente = null; pintarPrevia(); input.focus(); }
    });
  }
}

async function enviarAdjunto() {
  var a = adjuntoPendiente;
  if (!a || !current) return;
  if (enviando) { toast('Espera: todavía está saliendo el anterior.'); return; }
  var pieEl = document.getElementById('adjunto-pie');
  var caption = pieEl ? pieEl.value.trim() : '';
  adjuntoPendiente = null;
  pintarPrevia();
  var cita = citaPendiente;
  quitarCita();
  var pendiente = pintarPendiente((a.tipo === 'foto' ? '📷 ' : a.tipo === 'video' ? '🎬 ' : a.tipo === 'audio' ? '🎵 ' : '📄 ') + (caption || a.filename));
  var boton = document.getElementById('send');
  enviando++;
  if (boton) boton.disabled = true;
  try {
    var r = await api('/admin/chat/adjunto', { method: 'POST', body: { contactId: current.id, datos: a.datos, mimeType: a.mimeType, filename: a.filename, caption: caption || undefined, citaId: cita || undefined } });
    if (r.ok === false) { if (pendiente) pendiente.remove(); toast('No salió: ' + (r.reason || r.error || 'bloqueado por las guardas')); }
    await openChat(current.id, true);
    loadChats(true);
  } catch (error) { if (pendiente) pendiente.remove(); toast(error.message); }
  finally { enviando--; if (!enviando && boton) boton.disabled = false; }
}

/* Ctrl+V con una imagen en el portapapeles: va directo a la previa. */
document.addEventListener('paste', function (e) {
  if (!current) return;
  var items = (e.clipboardData && e.clipboardData.items) || [];
  for (var i = 0; i < items.length; i++) {
    if (items[i].kind === 'file') {
      var f = items[i].getAsFile();
      if (f) { e.preventDefault(); elegirAdjunto(f); return; }
    }
  }
});

/* Arrastrar un fichero encima de la conversacion. */
var zonaHilo = document.querySelector('.thread');
var arrastres = 0;
zonaHilo.addEventListener('dragenter', function (e) { if (e.dataTransfer && e.dataTransfer.types.indexOf('Files') >= 0) { arrastres++; zonaHilo.classList.add('arrastrando'); } });
zonaHilo.addEventListener('dragleave', function () { arrastres = Math.max(0, arrastres - 1); if (!arrastres) zonaHilo.classList.remove('arrastrando'); });
zonaHilo.addEventListener('dragover', function (e) { if (e.dataTransfer && e.dataTransfer.types.indexOf('Files') >= 0) e.preventDefault(); });
zonaHilo.addEventListener('drop', function (e) {
  arrastres = 0; zonaHilo.classList.remove('arrastrando');
  if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
  e.preventDefault();
  elegirAdjunto(e.dataTransfer.files[0]);
});

document.getElementById('archivo').addEventListener('change', function () {
  if (this.files && this.files[0]) elegirAdjunto(this.files[0]);
  this.value = '';
});

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
      enviar({ text: rellenarAtajo(a.texto) }).then(function () { if (a.sticker) return mandarSticker(a.sticker); });
    };
  });
}

/* -------------------------------------------------------------- stickers */

var stickers = [];
async function cargarStickers() {
  try { stickers = (await api('/admin/stickers')).stickers || []; }
  catch (error) { stickers = []; console.log('[chat] no se pudieron cargar los stickers:', error && error.message); }
}
async function abrirStickers() {
  if (!alternarPanel('panel-stickers')) return;
  if (!stickers.length) await cargarStickers();
  var box = document.getElementById('panel-stickers');
  box.innerHTML = stickers.length
    ? '<div class="stickers">' + stickers.map(function (s) { return '<img src="/stickers/' + esc(s.archivo) + '" title="' + esc(s.nombre) + '" data-sticker="' + esc(s.id) + '" alt="' + esc(s.nombre) + '">'; }).join('') + '</div><div class="pie">Un clic lo manda. Se suben en Panel → Stickers.</div>'
    : '<div class="pie">Todavía no hay stickers. Súbelos en <a class="link" href="/panel#stickers">Panel → Stickers</a>.</div>';
  box.querySelectorAll('[data-sticker]').forEach(function (img) { img.onclick = function () { mandarSticker(img.getAttribute('data-sticker')); }; });
}

async function mandarSticker(id) {
  if (!current) return;
  if (enviando) { toast('Espera: todavía está saliendo el anterior.'); return; }
  cerrarPaneles();
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

/**
 * Quedarse con un sticker que mando el cliente.
 *
 * El cuerpo va como objeto: api() ya lo serializa por dentro. Mandarlo aqui
 * ya convertido en cadena hacia que el servidor recibiera un texto donde
 * esperaba un objeto y contestara 400 sin que se entendiera por que.
 */
async function guardarSticker(mediaId) {
  var nombre = await pedirDato({
    titulo: 'Guardar el sticker',
    texto: 'Queda en tu biblioteca y lo podrás mandar desde el menú «+».',
    etiqueta: 'Nombre',
    valor: 'Sticker de ' + (current && current.name ? current.name : 'un cliente'),
    boton: 'Guardar',
  });
  if (!nombre) return;
  try {
    await api('/admin/stickers/desde-chat', { method: 'POST', body: { mediaId: mediaId, nombre: nombre } });
    stickers = [];
    toast('Sticker guardado. Ya lo puedes mandar desde el menú «+».');
  } catch (error) {
    toast(error && error.message ? error.message : 'No se pudo guardar el sticker.');
  }
}
`;
