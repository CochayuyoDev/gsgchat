/**
 * Todo lo que se hace SOBRE un mensaje: el menu del globo, las reacciones, la
 * cita, la seleccion multiple, reenviar, los destacados y buscar en el hilo.
 *
 * Vive aparte porque es la mitad del peso de la pantalla y porque antes estaba
 * desparramado: tres botones flotando encima de cada globo, cada uno con su
 * escucha de clic suelta. Ahora hay UN menu y un sitio donde arreglarlo.
 *
 * Es un trozo del mismo script que `chat-page.ts` (se concatenan), asi que
 * comparte sus ayudantes: `api`, `esc`, `toast`, `current`, `pintados`...
 */

export const CHAT_JS_MENU = String.raw`
/* ------------------------------------------------------------ menus flotantes

   Un solo componente para los cuatro menus de la pantalla (globo, fila de la
   lista, cabecera y el "+" del compositor). Asi el Esc, el clic fuera, el foco
   y el tamano del objetivo tactil se arreglan en un sitio y no en cuatro. */
var menuAbierto = null;

function cerrarMenu() {
  if (!menuAbierto) return;
  var quien = menuAbierto.dueno;
  menuAbierto.caja.remove();
  document.removeEventListener('keydown', menuAbierto.teclas, true);
  document.removeEventListener('mousedown', menuAbierto.fuera, true);
  menuAbierto = null;
  if (quien) { quien.setAttribute('aria-expanded', 'false'); if (document.body.contains(quien)) quien.focus(); }
}

/**
 * Abre un menu junto a un punto de la pantalla.
 *
 * Las opciones son una lista de {icono, texto, accion, peligro, hr}. Se devuelve
 * la caja por si alguien quiere algo mas, pero lo normal es no tocarla.
 */
function abrirMenu(opciones, x, y, dueno) {
  cerrarMenu();
  var caja = document.createElement('div');
  caja.className = 'flotante';
  caja.setAttribute('role', 'menu');
  opciones.forEach(function (op, i) {
    if (op.hr) { var hr = document.createElement('div'); hr.className = 'sep'; caja.appendChild(hr); return; }
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    if (op.peligro) b.className = 'peligro';
    b.innerHTML = '<span class="icono" aria-hidden="true">' + esc(op.icono || '') + '</span><span>' + esc(op.texto) + '</span>';
    b.onclick = function () { cerrarMenu(); op.accion(); };
    caja.appendChild(b);
  });
  document.body.appendChild(caja);

  /* Que no se salga de la pantalla: se mide despues de pintarlo porque hasta
     entonces no se sabe cuanto ocupa. */
  var ancho = caja.offsetWidth, alto = caja.offsetHeight;
  var izq = Math.max(8, Math.min(x, window.innerWidth - ancho - 8));
  var arriba = y + alto > window.innerHeight - 8 ? Math.max(8, y - alto) : y;
  caja.style.left = izq + 'px';
  caja.style.top = arriba + 'px';

  function teclas(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); cerrarMenu(); return; }
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    ev.preventDefault();
    var botones = Array.prototype.slice.call(caja.querySelectorAll('button'));
    if (!botones.length) return;
    var i = botones.indexOf(document.activeElement);
    var j = (i + (ev.key === 'ArrowDown' ? 1 : -1) + botones.length) % botones.length;
    botones[i < 0 ? 0 : j].focus();
  }
  function fuera(ev) { if (!caja.contains(ev.target)) cerrarMenu(); }
  document.addEventListener('keydown', teclas, true);
  document.addEventListener('mousedown', fuera, true);
  menuAbierto = { caja: caja, teclas: teclas, fuera: fuera, dueno: dueno || null };
  if (dueno) dueno.setAttribute('aria-expanded', 'true');
  var primero = caja.querySelector('button');
  if (primero) primero.focus();
  return caja;
}

/* Abrir el menu de un boton, justo debajo de el. */
function menuDeBoton(boton, opciones) {
  var r = boton.getBoundingClientRect();
  abrirMenu(opciones, r.right - 220, r.bottom + 4, boton);
}

/* --------------------------------------------------------- pintar el globo */

/** El mensaje del hilo con ese wamid, si sigue cargado. */
function porWamid(wamid) {
  if (!wamid) return null;
  for (var i = 0; i < hilo.mensajes.length; i++) if (hilo.mensajes[i].wamid === wamid) return hilo.mensajes[i];
  return null;
}

/**
 * El bloque de la cita dentro del globo.
 *
 * Se busca el original en el hilo: asi se pinta de quien era y lo que decia
 * de verdad, en vez de una copia congelada que puede haberse editado. Si ya
 * no esta cargado, se dice, en vez de pintar un hueco que parece un fallo.
 */
function citaHtml(m) {
  var cita = m.payload && m.payload.cita;
  if (!cita || !cita.id) return '';
  var original = porWamid(cita.id);
  var quien = original
    ? (original.direction === 'out' ? 'Tú' : nombreDe(current || {}))
    : (cita.autor || (cita.deMi ? 'Tú' : nombreDe(current || {})));
  var texto = original ? resumenDeMensaje(original) : (cita.texto || '');
  if (!original && !texto) return '';
  return '<button type="button" class="cita' + (original ? '' : ' perdida') + '"' +
    (original ? ' data-ir-a="' + original.id + '"' : ' disabled') + '>' +
    '<span class="quien">' + esc(quien) + '</span>' +
    '<span class="que">' + esc(texto || (original ? '' : 'el mensaje original ya no está cargado')) + '</span></button>';
}

/** Una linea con lo que es ese mensaje, para la cita y para la lista. */
function resumenDeMensaje(m) {
  var cuerpo = (m.body || '').trim();
  if (cuerpo) return cuerpo.slice(0, 120);
  var media = m.payload && m.payload.media;
  var kind = (media && media.kind) || m.kind;
  var nombres = { image: '📷 Foto', video: '🎬 Video', audio: '🎵 Audio', document: '📄 Documento', sticker: '🙂 Sticker', location: '📍 Ubicación' };
  return nombres[kind] || 'Mensaje';
}

/**
 * Las reacciones, como chips pegados bajo el globo.
 *
 * Se agrupan por emoji y se cuentan, igual que en el telefono: cinco pulgares
 * son un chip con un 5, no cinco chips.
 */
function reaccionesHtml(m) {
  var r = m.payload && m.payload.reacciones;
  if (!r) return '';
  var porEmoji = {};
  Object.keys(r).forEach(function (quien) {
    var emoji = r[quien] && r[quien].emoji;
    if (!emoji) return;
    if (!porEmoji[emoji]) porEmoji[emoji] = { cuantas: 0, mia: false };
    porEmoji[emoji].cuantas++;
    if (quien === 'yo') porEmoji[emoji].mia = true;
  });
  var emojis = Object.keys(porEmoji);
  if (!emojis.length) return '';
  return '<span class="reacciones">' + emojis.map(function (e) {
    var d = porEmoji[e];
    return '<button type="button" class="r' + (d.mia ? ' mia' : '') + '" data-reaccion="' + esc(e) + '" data-msg="' + m.id + '" ' +
      'title="' + (d.mia ? 'Quitar tu reacción' : 'Reaccionar igual') + '">' + esc(e) +
      (d.cuantas > 1 ? '<b>' + d.cuantas + '</b>' : '') + '</button>';
  }).join('') + '</span>';
}

/* ------------------------------------------------------------- reaccionar */

var EMOJIS_RAPIDOS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/** La barra de reacciones rapidas, encima del globo. */
function abrirReaccionesRapidas(msgEl, mensajeId) {
  cerrarReaccionesRapidas();
  var barra = document.createElement('div');
  barra.className = 'reac-rapidas';
  barra.innerHTML = EMOJIS_RAPIDOS.map(function (e) {
    return '<button type="button" data-emoji="' + esc(e) + '" aria-label="Reaccionar con ' + esc(e) + '">' + e + '</button>';
  }).join('') + '<button type="button" data-mas="1" aria-label="Elegir otro emoji">➕</button>';
  document.body.appendChild(barra);
  var r = msgEl.getBoundingClientRect();
  barra.style.left = Math.max(8, Math.min(r.left, window.innerWidth - barra.offsetWidth - 8)) + 'px';
  barra.style.top = Math.max(8, r.top - barra.offsetHeight - 6) + 'px';
  barra.onclick = function (ev) {
    var b = ev.target.closest('button');
    if (!b) return;
    cerrarReaccionesRapidas();
    if (b.hasAttribute('data-mas')) elegirEmoji(function (e) { reaccionar(mensajeId, e); });
    else reaccionar(mensajeId, b.getAttribute('data-emoji'));
  };
  document.addEventListener('keydown', cerrarConEsc, true);
}
function cerrarConEsc(ev) { if (ev.key === 'Escape') cerrarReaccionesRapidas(); }
function cerrarReaccionesRapidas() {
  var b = document.querySelector('.reac-rapidas');
  if (b) b.remove();
  document.removeEventListener('keydown', cerrarConEsc, true);
}

/**
 * Manda (o quita) una reaccion.
 *
 * Reaccionar con el mismo emoji que ya pusiste la quita, como en el telefono.
 * El hilo se refresca despues: la reaccion propia se guarda aqui, porque con
 * la Cloud API de Meta WhatsApp nunca nos la devuelve.
 */
async function reaccionar(mensajeId, emoji) {
  if (!current || !PUEDE.reaccionar) return;
  var m = mensajePorId(mensajeId);
  var mias = m && m.payload && m.payload.reacciones && m.payload.reacciones.yo;
  var quitar = mias && mias.emoji === emoji;
  try {
    await api('/admin/chat/' + current.id + '/reaccion', { method: 'POST', body: { mensajeId: mensajeId, emoji: quitar ? '' : emoji } });
    await openChat(current.id, true);
  } catch (error) {
    toast(error && error.message ? error.message : 'No se pudo reaccionar.');
  }
}

/* Clic en un chip de reaccion: la pone o la quita. */
document.addEventListener('click', function (ev) {
  var chip = ev.target.closest ? ev.target.closest('[data-reaccion]') : null;
  if (!chip) return;
  ev.preventDefault();
  reaccionar(Number(chip.getAttribute('data-msg')), chip.getAttribute('data-reaccion'));
});

/* Saltar al mensaje citado y resaltarlo un instante. */
document.addEventListener('click', function (ev) {
  var b = ev.target.closest ? ev.target.closest('[data-ir-a]') : null;
  if (!b) return;
  ev.preventDefault();
  irAlMensaje(Number(b.getAttribute('data-ir-a')));
});

function irAlMensaje(id) {
  var el = document.querySelector('[data-id="' + id + '"].msg');
  if (!el) { toast('Ese mensaje ya no está cargado. Sube para traer los anteriores.'); return; }
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('resaltado');
  void el.offsetWidth; /* reinicia la animacion aunque sea el mismo globo */
  el.classList.add('resaltado');
}

/* ------------------------------------------------------- el menu del globo */

/** El mensaje pintado con ese id de fila. */
function mensajePorId(id) {
  for (var i = 0; i < pintados.length; i++) if (pintados[i].id === id) return pintados[i];
  return null;
}

function opcionesDeMensaje(m) {
  var ops = [];
  var texto = (m.body || '').trim();
  var media = m.payload && m.payload.media;
  var enGrupo = current && current.tipo === 'grupo';
  var citable = PUEDE.citar && m.wamid && !/^(local:|web:|waha:local:)/.test(m.wamid);

  if (citable && puedeEscribir) {
    ops.push({ icono: '↩', texto: 'Responder', accion: function () { citarMensaje(m.id); } });
  }
  if (PUEDE.reaccionar && citable) {
    ops.push({ icono: '😊', texto: 'Reaccionar', accion: function () {
      var el = document.querySelector('[data-id="' + m.id + '"].msg');
      if (el) abrirReaccionesRapidas(el, m.id);
    } });
  }
  ops.push({ icono: '↪', texto: 'Reenviar', accion: function () { abrirReenviar([m.id]); } });
  if (texto) {
    ops.push({ icono: '⧉', texto: 'Copiar texto', accion: function () { copiar(texto); } });
  }
  var destacado = m.payload && m.payload.destacado;
  ops.push({ icono: destacado ? '☆' : '⭐', texto: destacado ? 'Quitar la estrella' : 'Destacar', accion: function () { destacar([m.id], !destacado); } });
  if (media && media.id) {
    ops.push({ icono: '⭳', texto: 'Descargar el adjunto', accion: function () { descargarAdjunto(media); } });
  }
  if (media && media.kind === 'sticker' && m.direction === 'in' && media.id) {
    ops.push({ icono: '🙂', texto: 'Guardar en mis stickers', accion: function () { guardarSticker(media.id); } });
  }
  if (m.direction === 'out' && PUEDE.editar && citable && texto) {
    ops.push({ icono: '✎', texto: 'Editar el mensaje', accion: function () { editarMensaje(m); } });
  }

  /* Ensenarle al asistente: en un grupo no atiende nadie automatico. */
  var esTexto = m.kind === 'text' || (m.kind === 'audio' && m.payload && m.payload.transcripcion);
  if (!enGrupo && esTexto && texto) {
    if (m.direction === 'in') ops.push({ icono: '🎓', texto: 'Enseñarle la respuesta al asistente', accion: function () { ensenarDesdeMensaje(m, false); } });
    else if (m.payload && m.payload.origen === 'ia') ops.push({ icono: '🎓', texto: 'Corregir al asistente', accion: function () { ensenarDesdeMensaje(m, true); } });
  }
  if (m.direction === 'out' && !enGrupo) {
    ops.push({ icono: 'ⓘ', texto: '¿Qué pasó con este mensaje?', accion: function () { verTraza(m); } });
  }

  ops.push({ hr: true });
  ops.push({ icono: '✓', texto: 'Seleccionar', accion: function () { entrarEnSeleccion(m.id); } });
  ops.push({ icono: '🗑', texto: 'Eliminar…', peligro: true, accion: function () { pedirEliminar([m.id]); } });
  return ops;
}

/* La flechita del globo y el clic derecho abren el mismo menu. */
document.getElementById('messages').addEventListener('click', function (ev) {
  var b = ev.target.closest ? ev.target.closest('.abrir-menu') : null;
  if (!b) return;
  ev.preventDefault();
  ev.stopPropagation();
  var m = mensajePorId(Number(b.closest('.msg').getAttribute('data-id')));
  if (m) menuDeBoton(b, opcionesDeMensaje(m));
});
document.getElementById('messages').addEventListener('contextmenu', function (ev) {
  var globo = ev.target.closest ? ev.target.closest('.msg') : null;
  if (!globo || !globo.getAttribute('data-id')) return;
  var m = mensajePorId(Number(globo.getAttribute('data-id')));
  if (!m) return;
  ev.preventDefault();
  abrirMenu(opcionesDeMensaje(m), ev.clientX, ev.clientY);
});

/**
 * Pasar por encima de un globo saca la barra de reacciones rapidas.
 *
 * Con un pequeno retardo a proposito: sin el, mover el raton por el hilo
 * disparaba una barra distinta en cada globo y el hilo parecia vivo. Y no sale
 * en modo seleccion, donde el clic sirve para otra cosa.
 */
var esperaReacciones = null;
var globoConBarra = null;
document.getElementById('messages').addEventListener('mouseover', function (ev) {
  if (!PUEDE.reaccionar || seleccion.length) return;
  var globo = ev.target.closest ? ev.target.closest('.msg') : null;
  if (!globo || !globo.getAttribute('data-id') || globo === globoConBarra) return;
  clearTimeout(esperaReacciones);
  esperaReacciones = setTimeout(function () {
    if (!document.body.contains(globo)) return;
    globoConBarra = globo;
    abrirReaccionesRapidas(globo, Number(globo.getAttribute('data-id')));
  }, 450);
});
document.getElementById('messages').addEventListener('mouseout', function (ev) {
  var haciaDonde = ev.relatedTarget;
  if (haciaDonde && haciaDonde.closest && (haciaDonde.closest('.reac-rapidas') || haciaDonde.closest('.msg') === globoConBarra)) return;
  clearTimeout(esperaReacciones);
  globoConBarra = null;
  cerrarReaccionesRapidas();
});

function copiar(texto) {
  var listo = function () { toast('Copiado.'); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(texto).then(listo, function () { window.prompt('Copia el texto:', texto); });
  else window.prompt('Copia el texto:', texto);
}

/* Bajarse el adjunto ya cargado: el blob esta en memoria, no hace falta pedirlo otra vez. */
function descargarAdjunto(media) {
  var url = mediaCache[media.id];
  if (!url) { toast('Espera a que termine de cargarse el adjunto.'); return; }
  var a = document.createElement('a');
  a.href = url;
  a.download = media.filename || media.id;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ---------------------------------------------------------------- destacar */

async function destacar(ids, destacado) {
  if (!current) return;
  try {
    await api('/admin/chat/' + current.id + '/destacar', { method: 'POST', body: { ids: ids, destacado: destacado } });
    toast(destacado ? (ids.length > 1 ? ids.length + ' mensajes destacados.' : 'Mensaje destacado.') : 'Estrella quitada.');
    salirDeSeleccion();
    await openChat(current.id, true);
  } catch (error) { toast(error && error.message ? error.message : 'No se pudo destacar.'); }
}

/** El panel de destacados: de este chat o de todos. */
async function verDestacados(soloEsteChat) {
  var fondo = document.createElement('div');
  fondo.className = 'dlg-fondo';
  fondo.innerHTML = '<div class="dlg" role="dialog" aria-modal="true" style="width:min(560px,100%)">' +
    '<h3>Mensajes destacados</h3><div id="dest-cuerpo"><p class="muted">Cargando…</p></div>' +
    '<div class="botones"><button type="button" id="dlg-si" class="principal">Cerrar</button></div></div>';
  function cerrar() { document.removeEventListener('keydown', teclas); fondo.remove(); }
  function teclas(ev) { if (ev.key === 'Escape') cerrar(); }
  fondo.querySelector('#dlg-si').onclick = cerrar;
  fondo.onclick = function (ev) { if (ev.target === fondo) cerrar(); };
  document.addEventListener('keydown', teclas);
  document.body.appendChild(fondo);

  try {
    var url = '/admin/chat/destacados?limit=100' + (soloEsteChat && current ? '&contactId=' + encodeURIComponent(current.id) : '');
    var r = await api(url);
    var cuerpo = fondo.querySelector('#dest-cuerpo');
    if (!r.items.length) {
      cuerpo.innerHTML = '<p class="muted">Todavía no hay ninguno. Se destacan desde el menú del mensaje (⌄ → Destacar).</p>';
      return;
    }
    cuerpo.innerHTML = r.items.map(function (m) {
      return '<div class="destacado-fila" data-dest="' + esc(m.contactId) + '" data-msg="' + m.id + '">' +
        '<div class="top"><span class="quien">' + esc(m.name || m.phone) + '</span>' +
        '<span class="when">' + esc(shortWhen(m.createdAt)) + '</span></div>' +
        '<div class="que">' + esc(resumenDeMensaje(m)) + '</div></div>';
    }).join('');
    cuerpo.querySelectorAll('[data-dest]').forEach(function (fila) {
      fila.onclick = async function () {
        cerrar();
        await openChat(fila.getAttribute('data-dest'));
        irAlMensaje(Number(fila.getAttribute('data-msg')));
      };
    });
  } catch (error) {
    fondo.querySelector('#dest-cuerpo').innerHTML = '<p class="muted">' + esc(error.message) + '</p>';
  }
}

/* -------------------------------------------------------------- eliminar */

/**
 * Preguntar antes de quitar, y ofrecer solo lo que de verdad se puede.
 *
 * "Para todos" no existe con la API de Meta: alli un mensaje enviado no se
 * puede retirar. Cuando no se puede, no se ensena el boton en vez de dejarlo
 * fallar (ver capacidadesDelChat en el servidor).
 */
function pedirEliminar(ids) {
  if (!current) return;
  var soloMios = ids.every(function (id) { var m = mensajePorId(id); return m && m.direction === 'out'; });
  var paraTodos = PUEDE.eliminarParaTodos && soloMios;
  var cuantos = ids.length > 1 ? ids.length + ' mensajes' : 'este mensaje';

  var fondo = document.createElement('div');
  fondo.className = 'dlg-fondo';
  fondo.innerHTML = '<div class="dlg" role="dialog" aria-modal="true">' +
    '<h3>Eliminar ' + esc(cuantos) + '</h3>' +
    '<p>«Quitar de aquí» lo saca de esta pantalla y lo deja en el respaldo; en el teléfono del cliente sigue.' +
    (paraTodos ? ' «Eliminar para todos» lo retira también de su teléfono.' : '') + '</p>' +
    '<div class="botones">' +
      '<button type="button" id="dlg-no">Cancelar</button>' +
      (paraTodos ? '<button type="button" id="dlg-todos" class="peligro">Eliminar para todos</button>' : '') +
      '<button type="button" id="dlg-si" class="peligro">Quitar de aquí</button>' +
    '</div></div>';
  function cerrar() { document.removeEventListener('keydown', teclas); fondo.remove(); }
  function teclas(ev) { if (ev.key === 'Escape') cerrar(); }
  document.addEventListener('keydown', teclas);
  fondo.querySelector('#dlg-no').onclick = cerrar;
  fondo.querySelector('#dlg-si').onclick = function () { cerrar(); eliminar(ids, false); };
  var todos = fondo.querySelector('#dlg-todos');
  if (todos) todos.onclick = function () { cerrar(); eliminar(ids, true); };
  fondo.onclick = function (ev) { if (ev.target === fondo) cerrar(); };
  document.body.appendChild(fondo);
  fondo.querySelector('#dlg-si').focus();
}

async function eliminar(ids, paraTodos) {
  if (!current) return;
  try {
    var r = await api('/admin/chat/' + current.id + '/eliminar', { method: 'POST', body: { ids: ids, paraTodos: paraTodos } });
    if (r.fallos && r.fallos.length) toast('Se quitó de aquí, pero del teléfono del cliente no: ' + r.fallos[0]);
    else toast(paraTodos ? 'Eliminado para todos.' : 'Quitado de esta pantalla.');
    salirDeSeleccion();
    await openChat(current.id, true);
    loadChats(true);
  } catch (error) { toast(error && error.message ? error.message : 'No se pudo eliminar.'); }
}

/* ---------------------------------------------------------------- editar */

async function editarMensaje(m) {
  var texto = await pedirDato({
    titulo: 'Editar el mensaje',
    texto: 'Al cliente le llegará el texto nuevo, marcado como editado. Los mensajes muy antiguos WhatsApp ya no deja cambiarlos.',
    etiqueta: 'Mensaje',
    valor: m.body || '',
    boton: 'Guardar',
    multilinea: true,
  });
  if (!texto || texto.trim() === (m.body || '').trim()) return;
  try {
    await api('/admin/chat/' + current.id + '/editar', { method: 'POST', body: { mensajeId: m.id, texto: texto.trim() } });
    toast('Mensaje editado.');
    await openChat(current.id, true);
  } catch (error) { toast(error && error.message ? error.message : 'No se pudo editar.'); }
}

/* ------------------------------------------------------- seleccion multiple */

var seleccion = [];

function entrarEnSeleccion(id) {
  seleccion = id ? [id] : [];
  document.getElementById('app').classList.add('seleccionando');
  pintarSeleccion();
}
function salirDeSeleccion() {
  if (!seleccion.length && !document.getElementById('app').classList.contains('seleccionando')) return;
  seleccion = [];
  document.getElementById('app').classList.remove('seleccionando');
  ver('seleccion', false);
  document.querySelectorAll('.msg.elegido').forEach(function (el) { el.classList.remove('elegido'); });
}
function alternarSeleccion(id) {
  var i = seleccion.indexOf(id);
  if (i >= 0) seleccion.splice(i, 1); else seleccion.push(id);
  if (!seleccion.length) return salirDeSeleccion();
  pintarSeleccion();
}
function pintarSeleccion() {
  var barra = document.getElementById('seleccion');
  barra.querySelector('.cuantos').textContent = seleccion.length + (seleccion.length === 1 ? ' mensaje' : ' mensajes');
  ver('seleccion', true);
  document.querySelectorAll('.msg').forEach(function (el) {
    el.classList.toggle('elegido', seleccion.indexOf(Number(el.getAttribute('data-id'))) >= 0);
  });
}

/* Un clic en el globo alterna la seleccion, pero solo en modo seleccion:
   fuera de el, un clic en el texto tiene que poder seleccionar letras. */
document.getElementById('messages').addEventListener('click', function (ev) {
  if (!seleccion.length) return;
  var globo = ev.target.closest ? ev.target.closest('.msg') : null;
  if (!globo || !globo.getAttribute('data-id')) return;
  if (ev.target.closest('a, button, audio, video')) return;
  ev.preventDefault();
  alternarSeleccion(Number(globo.getAttribute('data-id')));
});

/* Mantener pulsado en el movil entra en seleccion (ahi no hay clic derecho). */
var pulsacion = null;
document.getElementById('messages').addEventListener('touchstart', function (ev) {
  var globo = ev.target.closest ? ev.target.closest('.msg') : null;
  if (!globo || !globo.getAttribute('data-id')) return;
  pulsacion = setTimeout(function () {
    if (seleccion.length) alternarSeleccion(Number(globo.getAttribute('data-id')));
    else entrarEnSeleccion(Number(globo.getAttribute('data-id')));
  }, 500);
}, { passive: true });
['touchend', 'touchmove', 'touchcancel'].forEach(function (e) {
  document.getElementById('messages').addEventListener(e, function () { clearTimeout(pulsacion); }, { passive: true });
});

document.getElementById('sel-cerrar').onclick = salirDeSeleccion;
document.getElementById('sel-reenviar').onclick = function () { abrirReenviar(seleccion.slice()); };
document.getElementById('sel-copiar').onclick = function () {
  var textos = seleccion.map(mensajePorId).filter(Boolean).map(function (m) { return hhmm(m.createdAt) + ' ' + resumenDeMensaje(m); });
  copiar(textos.join('\n'));
  salirDeSeleccion();
};
document.getElementById('sel-destacar').onclick = function () { destacar(seleccion.slice(), true); };
document.getElementById('sel-eliminar').onclick = function () { pedirEliminar(seleccion.slice()); };

/* ---------------------------------------------------------------- reenviar */

/** Elegir a que conversaciones va, con buscador y varias de una vez. */
function abrirReenviar(ids) {
  if (!current || !ids.length) return;
  var elegidos = {};
  var fondo = document.createElement('div');
  fondo.className = 'dlg-fondo';
  fondo.innerHTML = '<div class="dlg" role="dialog" aria-modal="true" style="width:min(520px,100%)">' +
    '<h3>Reenviar ' + (ids.length > 1 ? ids.length + ' mensajes' : 'el mensaje') + '</h3>' +
    '<p class="muted" style="margin:0 0 8px;font-size:13px">Se vuelve a mandar el contenido y llega marcado como reenviado. Elige a quién:</p>' +
    '<input id="rv-buscar" placeholder="Buscar una conversación" autocomplete="off" style="width:100%;padding:9px 12px;border:1px solid var(--borde);border-radius:var(--radio-sm);font:inherit;background:var(--superficie);color:var(--texto)">' +
    '<div class="reenviar-lista" id="rv-lista"></div>' +
    '<div class="botones"><button type="button" id="dlg-no">Cancelar</button>' +
    '<button type="button" id="dlg-si" class="principal" disabled>Reenviar</button></div></div>';
  function cerrar() { document.removeEventListener('keydown', teclas); fondo.remove(); }
  function teclas(ev) { if (ev.key === 'Escape') cerrar(); }
  document.addEventListener('keydown', teclas);
  fondo.querySelector('#dlg-no').onclick = cerrar;
  fondo.onclick = function (ev) { if (ev.target === fondo) cerrar(); };
  document.body.appendChild(fondo);

  var boton = fondo.querySelector('#dlg-si');
  var lista = fondo.querySelector('#rv-lista');
  var buscar = fondo.querySelector('#rv-buscar');

  function pintar() {
    var q = buscar.value.trim().toLowerCase();
    var visibles = conversations.filter(function (c) {
      if (c.contactId === current.id) return false;
      if (!q) return true;
      return (nombreDe(c) + ' ' + c.phone).toLowerCase().indexOf(q) >= 0;
    }).slice(0, 80);
    lista.innerHTML = visibles.length
      ? visibles.map(function (c) {
          return '<label><input type="checkbox" value="' + esc(c.contactId) + '"' + (elegidos[c.contactId] ? ' checked' : '') + '>' +
            '<span>' + esc(nombreDe(c)) + '</span></label>';
        }).join('')
      : '<div class="pie" style="padding:12px">Ninguna conversación con ese nombre.</div>';
    lista.querySelectorAll('input').forEach(function (i) {
      i.onchange = function () {
        if (i.checked) elegidos[i.value] = true; else delete elegidos[i.value];
        boton.disabled = !Object.keys(elegidos).length;
      };
    });
  }
  buscar.addEventListener('input', pintar);
  pintar();
  buscar.focus();

  boton.onclick = async function () {
    var destinos = Object.keys(elegidos);
    boton.disabled = true;
    boton.textContent = 'Reenviando…';
    try {
      var r = await api('/admin/chat/reenviar', { method: 'POST', body: { origenId: current.id, ids: ids, destinos: destinos } });
      cerrar();
      salirDeSeleccion();
      toast(r.enviados + (r.enviados === 1 ? ' mensaje reenviado' : ' mensajes reenviados') +
        (r.fallos && r.fallos.length ? '. No salieron ' + r.fallos.length + ': ' + r.fallos[0] : '.'));
      loadChats(true);
    } catch (error) {
      boton.disabled = false;
      boton.textContent = 'Reenviar';
      toast(error && error.message ? error.message : 'No se pudo reenviar.');
    }
  };
}

/* ------------------------------------------------------ buscar en el hilo */

var busqueda = { activa: false, coincidencias: [], i: 0 };

function abrirBusqueda() {
  if (!current) return;
  busqueda.activa = true;
  ver('buscar-hilo', true);
  var campo = document.getElementById('buscar-campo');
  campo.focus();
  campo.select();
}
function cerrarBusqueda() {
  busqueda = { activa: false, coincidencias: [], i: 0 };
  ver('buscar-hilo', false);
  document.getElementById('buscar-campo').value = '';
  document.getElementById('buscar-cuenta').textContent = '';
  if (current) renderMessages(hilo.mensajes, false, true);
}

/**
 * Busca en TODO el hilo, no solo en lo que esta en pantalla.
 *
 * El servidor devuelve las coincidencias de la conversacion entera; las que
 * ya estan cargadas se resaltan y se salta a ellas, y de las que no, se dice
 * cuantas hay y desde donde traerlas. Buscar y encontrar "en la parte que
 * casualmente esta cargada" es peor que no buscar.
 */
var buscandoHilo;
document.getElementById('buscar-campo').addEventListener('input', function () {
  clearTimeout(buscandoHilo);
  var q = this.value.trim();
  if (!q) { busqueda.coincidencias = []; document.getElementById('buscar-cuenta').textContent = ''; renderMessages(hilo.mensajes, false, true); return; }
  buscandoHilo = setTimeout(function () { hacerBusqueda(q); }, 250);
});
async function hacerBusqueda(q) {
  if (!current) return;
  try {
    var r = await api('/admin/chat/' + current.id + '/buscar?q=' + encodeURIComponent(q));
    busqueda.coincidencias = r.items.map(function (m) { return m.id; });
    busqueda.i = busqueda.coincidencias.length - 1;
    busqueda.texto = q;
    renderMessages(hilo.mensajes, false, true);
    pintarCuentaBusqueda();
    if (busqueda.coincidencias.length) saltarACoincidencia(0);
  } catch (error) { toast(error && error.message ? error.message : 'No se pudo buscar.'); }
}
function pintarCuentaBusqueda() {
  var n = busqueda.coincidencias.length;
  document.getElementById('buscar-cuenta').textContent = n ? (busqueda.i + 1) + ' de ' + n : 'sin resultados';
}
function saltarACoincidencia(paso) {
  var n = busqueda.coincidencias.length;
  if (!n) return;
  busqueda.i = (busqueda.i + paso + n) % n;
  pintarCuentaBusqueda();
  var id = busqueda.coincidencias[busqueda.i];
  var el = document.querySelector('[data-id="' + id + '"].msg');
  if (el) irAlMensaje(id);
  else toast('Esa coincidencia es más antigua que lo cargado: pulsa «Ver mensajes anteriores» arriba del hilo.');
}
document.getElementById('buscar-antes').onclick = function () { saltarACoincidencia(-1); };
document.getElementById('buscar-despues').onclick = function () { saltarACoincidencia(1); };
document.getElementById('buscar-cerrar').onclick = cerrarBusqueda;
document.getElementById('buscar-campo').addEventListener('keydown', function (ev) {
  if (ev.key === 'Enter') { ev.preventDefault(); saltarACoincidencia(ev.shiftKey ? -1 : 1); }
  if (ev.key === 'Escape') { ev.preventDefault(); cerrarBusqueda(); }
});

/** Resalta lo buscado dentro del texto ya escapado del globo. */
function resaltar(html) {
  if (!busqueda.activa || !busqueda.texto) return html;
  var t = esc(busqueda.texto).replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&');
  /* Fuera de las etiquetas: si no, se rompen los href y los atributos. */
  return html.replace(new RegExp('(>|^)([^<]*)', 'g'), function (todo, antes, texto) {
    return antes + texto.replace(new RegExp(t, 'gi'), function (x) { return '<mark>' + x + '</mark>'; });
  });
}
`;
