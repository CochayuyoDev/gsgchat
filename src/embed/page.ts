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
  .burbuja .foto { display: block; max-width: 100%; max-height: 260px; border-radius: 8px; cursor: zoom-in; background: rgba(0,0,0,.06); }
  .burbuja video { display: block; max-width: 100%; max-height: 300px; border-radius: 8px; background: #000; }
  .burbuja audio { display: block; width: 240px; max-width: 100%; }
  .burbuja .pie { margin-top: 4px; }
  .burbuja .estado { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .burbuja.fallo-envio .estado { color: var(--bad); }
  .burbuja .reintentar { margin-left: 6px; padding: 1px 8px; font-size: 12px; }
  .burbuja.enviando { opacity: .75; }
  #visor { position: fixed; inset: 0; background: rgba(0,0,0,.85); display: none; align-items: center; justify-content: center; z-index: 50; cursor: zoom-out; }
  #visor.visible { display: flex; }
  #visor img { max-width: 94vw; max-height: 94vh; object-fit: contain; }
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
    headers: Object.assign({ 'content-type': 'application/json', authorization: 'Bearer ' + token }, options.headers || {}),
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

// El hilo se concilia, no se vuelve a escribir: cada burbuja es un elemento con
// una clave estable (el id de la fila). Un sondeo que no cambia nada no toca el
// DOM, y una foto, un video o un audio que ya esta en pantalla se queda tal cual
// (no se recarga, no pierde el punto de reproduccion). Solo cambian el estado
// (los checks) y lo que de verdad es nuevo.
var burbujas = {};          // clave -> elemento
var firmas = {};            // clave -> lo que se pinto, para saber si cambio
var hiloPintado = null;     // telefono del hilo que esta en pantalla
var pendientes = [];        // lo que se esta enviando (o fallo) desde esta pantalla

function claveDe(m) { return 'm' + m.id; }

function firmaMedia(a) { return a ? (a.tipo + '|' + a.mimeType + '|' + (a.bytes || '')) : ''; }

function firmaDe(m) {
  return [m.texto || '', m.tipo, m.estado || '', firmaMedia(m.archivo)].join('|');
}

function mediaDe(a, m) {
  var caja = document.createElement('div');
  caja.className = 'media';
  if (a.tipo === 'imagen' || a.tipo === 'sticker') {
    var img = document.createElement('img');
    img.className = 'foto'; img.alt = m.texto || 'foto'; img.loading = 'lazy'; img.src = a.url;
    img.onclick = function () { $('visor-img').src = img.src; $('visor').classList.add('visible'); };
    caja.appendChild(img);
  } else if (a.tipo === 'video') {
    var v = document.createElement('video');
    v.controls = true; v.preload = 'metadata'; v.playsInline = true; v.src = a.url;
    caja.appendChild(v);
  } else if (a.tipo === 'audio') {
    var au = document.createElement('audio');
    au.controls = true; au.preload = 'none'; au.src = a.url;
    caja.appendChild(au);
  } else {
    var l = document.createElement('a');
    l.href = a.url; l.target = '_blank'; l.rel = 'noopener'; l.textContent = '📄 ' + (a.nombre || 'documento');
    caja.appendChild(l);
  }
  return caja;
}

function checkDe(s) {
  return s === 'failed' ? '✕' : s === 'read' || s === 'delivered' ? '✓✓' : '✓';
}

// Solo se llama cuando la burbuja es nueva o cambio algo que se ve.
function contenidoDe(el, m) {
  var a = m.archivo;
  var cuerpo = el.querySelector('.cuerpo');
  if (!cuerpo) {
    cuerpo = document.createElement('div'); cuerpo.className = 'cuerpo';
    var meta = document.createElement('div'); meta.className = 'meta';
    el.appendChild(cuerpo); el.appendChild(meta);
  }
  // El elemento multimedia solo se rehace si el archivo es otro; el enlace firmado se ignora a proposito.
  if (el.getAttribute('data-media') !== firmaMedia(a)) {
    var viejo = el.querySelector('.media');
    if (viejo) viejo.remove();
    if (a) el.insertBefore(mediaDe(a, m), cuerpo);
    el.setAttribute('data-media', firmaMedia(a));
  }
  var texto = m.texto || '';
  cuerpo.className = 'cuerpo' + (a ? ' pie' : '');
  if (texto) { cuerpo.textContent = texto; cuerpo.style.display = ''; }
  else if (!a) { cuerpo.innerHTML = '<span class="tipo">' + esc(tipoLegible(m.tipo)) + '</span>'; cuerpo.style.display = ''; }
  else cuerpo.style.display = 'none';
  var check = '';
  if (m.direccion === 'saliente') {
    var s = m.estado;
    check = '<span class="check' + (s === 'read' ? ' leido' : s === 'failed' ? ' fallo' : '') + '">' + checkDe(s) + '</span>';
  }
  el.querySelector('.meta').innerHTML = esc(hora(m.fecha)) + check;
}

function pendienteEl(p) {
  var el = burbujas[p.clave];
  if (!el) {
    el = document.createElement('div');
    el.setAttribute('data-clave', p.clave);
    burbujas[p.clave] = el;
  }
  el.className = 'burbuja mia ' + (p.error ? 'fallo-envio' : 'enviando');
  var html = '<div class="cuerpo">' + esc(p.etiqueta) + '</div><div class="estado">' + (p.error ? esc(p.error) + ' <button class="ghost reintentar">Reintentar</button>' : 'Enviando…') + '</div>';
  if (el._html !== html) {
    el._html = html; el.innerHTML = html;
    var b = el.querySelector('.reintentar');
    if (b) b.onclick = function () { reintentar(p); };
  }
  return el;
}

function pintarHilo() {
  var c = hilo.contacto;
  var quien = '<b>' + esc(c.nombre || c.telefono) + '</b><small>' + esc(c.telefono) + (hilo.ventanaAbierta ? ' · ventana abierta' : '') + '</small>';
  if ($('quien')._html !== quien) { $('quien')._html = quien; $('quien').innerHTML = quien; }
  var caja = $('mensajes');
  var cambioHilo = hiloPintado !== c.telefono;
  if (cambioHilo) { caja.innerHTML = ''; burbujas = {}; firmas = {}; pendientes = []; hiloPintado = c.telefono; }
  // Si quien lee esta al final, el hilo sigue al ultimo mensaje; si subio a ver algo, no se le mueve.
  var pegado = cambioHilo || caja.scrollHeight - caja.scrollTop - caja.clientHeight < 80;

  // Lo que se estaba enviando desaparece cuando el mensaje ya viene del servidor.
  var enServidor = {};
  hilo.mensajes.forEach(function (m) { if (m.mensajeId) enServidor[m.mensajeId] = true; });
  pendientes = pendientes.filter(function (p) { return !(p.listo && (!p.mensajeId || enServidor[p.mensajeId])); });

  var deseados = [], vistas = {}, ultimoDia = null;
  hilo.mensajes.forEach(function (m) {
    var d = dia(m.fecha);
    if (d !== ultimoDia) {
      var kd = 'd:' + d;
      if (!burbujas[kd]) { var sep = document.createElement('div'); sep.className = 'dia'; sep.textContent = d; burbujas[kd] = sep; }
      deseados.push(burbujas[kd]); vistas[kd] = true; ultimoDia = d;
    }
    var k = claveDe(m), el = burbujas[k];
    if (!el) { el = document.createElement('div'); el.setAttribute('data-clave', k); burbujas[k] = el; }
    var f = firmaDe(m);
    if (firmas[k] !== f) {
      el.className = 'burbuja' + (m.direccion === 'saliente' ? ' mia' : '');
      if (m.mensajeId) el.setAttribute('data-id', m.mensajeId);
      contenidoDe(el, m);
      firmas[k] = f;
    }
    deseados.push(el); vistas[k] = true;
  });
  pendientes.forEach(function (p) { deseados.push(pendienteEl(p)); vistas[p.clave] = true; });

  var vacio = caja.querySelector('.vacio');
  if (!deseados.length) {
    if (!vacio) caja.innerHTML = '<div class="vacio">Todavía no hay mensajes con este contacto.</div>';
  } else if (vacio) vacio.remove();

  Object.keys(burbujas).forEach(function (k) { if (!vistas[k]) { burbujas[k].remove(); delete burbujas[k]; delete firmas[k]; } });
  // Solo se mueve lo que no esta en su sitio: reinsertar un video que suena lo reiniciaria.
  var ref = caja.firstChild;
  deseados.forEach(function (el) {
    if (el === ref) { ref = ref.nextSibling; return; }
    caja.insertBefore(el, ref);
  });

  if (pegado) caja.scrollTop = caja.scrollHeight;
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

function etiquetaDe(cuerpo) {
  return cuerpo.texto || (cuerpo.plantilla ? 'Plantilla ' + cuerpo.plantilla.nombre : cuerpo.pedirUbicacion ? 'Pedir ubicación' : cuerpo.media ? 'Archivo' : 'Mensaje');
}

function claveUnica() {
  return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(36).slice(2);
}

// Cada envio lleva su Idempotency-Key y la conserva en los reintentos: si la
// primera llamada si salio pero la respuesta se perdio, reintentar no lo manda otra vez.
// Si el servidor contesto que no salio, el reintento lleva una clave nueva (la anterior repetiria esa respuesta).
async function intentar(p) {
  p.error = null; p.listo = false;
  if (hilo && hiloPintado === p.telefono) pintarHilo();
  try {
    var r = await api('/api/v1/mensajes', { method: 'POST', headers: { 'idempotency-key': p.idem }, body: Object.assign({ telefono: p.telefono }, p.cuerpo) });
    if (r.ok) { p.listo = true; p.mensajeId = r.mensajeId || null; avisar('wa:mensaje', { telefono: p.telefono, direccion: 'saliente', mensajeId: r.mensajeId }); }
    else { p.error = r.motivo || r.error || 'No salió'; p.idem = 'i' + claveUnica(); }
  } catch (error) {
    p.error = error.message;
    // Sin respuesta (se cayo la red) el envio pudo salir: misma clave. Con una respuesta de error, no salio: clave nueva.
    if (error.name !== 'TypeError') p.idem = 'i' + claveUnica();
  }
  if (p.telefono === actual) { await abrir(actual, true); }
  cargarLista();
}

function reintentar(p) { intentar(p); }

async function enviar(cuerpo) {
  if (!actual) return;
  var p = { clave: 'p' + claveUnica(), idem: 'i' + claveUnica(), telefono: actual, cuerpo: cuerpo, etiqueta: etiquetaDe(cuerpo), error: null, listo: false, mensajeId: null };
  pendientes.push(p);
  if (cuerpo.texto) $('texto').value = '';
  await intentar(p);
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
$('visor').onclick = function () { $('visor').classList.remove('visible'); $('visor-img').removeAttribute('src'); };
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
<div id="visor"><img id="visor-img" alt="foto ampliada"></div>
<div id="velo" class="velo"><div class="caja"><b>La sesión del chat caducó o no llegó.</b><br><small>La web que muestra este chat tiene que entregar un token nuevo.</small></div></div>
<script>${script}</script>
</body>
</html>`;
}

function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
