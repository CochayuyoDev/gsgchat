/**
 * Visor de fotos y videos dentro de la misma pagina.
 *
 * Antes una foto del chat se abria en una pestaña nueva (y el video solo se
 * podia ver en su cajita): se perdia el hilo y habia que volver. Ahora se abre
 * encima de la pantalla, como en WhatsApp Web: fondo oscuro, la foto o el video
 * en grande, flechas para pasar a la anterior/siguiente del mismo hilo, zoom,
 * descargar y cerrar con Esc, con la ✕ o tocando fuera.
 *
 * Como se usa (sin framework):
 *  - Se mete `VISOR_CSS` en el <style> y `VISOR_JS` en el <script>. El armazon
 *    (`shell.ts`) ya lo hace en todas las pantallas; las paginas sueltas (la
 *    copia publica de una conversacion) lo pegan a mano.
 *  - Cualquier elemento con `data-visor="imagen"` o `data-visor="video"` se abre
 *    en el visor al tocarlo. La direccion sale de `data-visor-src`, o del
 *    `href` (enlace), o del `src` del propio elemento o de la <img>/<video> que
 *    lleve dentro. Si todavia no hay direccion (el fichero aun se esta bajando),
 *    no se abre nada.
 *  - Las flechas recorren los `[data-visor]` del mismo `[data-visor-grupo]`
 *    (el hilo del chat), o de toda la pagina si no hay grupo.
 *  - `data-visor-titulo` y `data-visor-nombre` (nombre al descargar) son
 *    opcionales.
 *  - Desde JS: `abrirVisor([{ tipo: 'imagen', src: '...' }], 0)`.
 *
 * Ctrl/⌘ + clic sigue abriendo la pestaña nueva en los enlaces: eso ya lo pide
 * quien lo hace a proposito.
 *
 * El JS va en String.raw y sin backticks ni "${", como el resto de paginas.
 */

export const VISOR_CSS = `
  /* Fondo opaco: el panel de detras no distrae ni se lee a medias. Sin
     backdrop-filter a proposito: obliga a repintar lo de detras (videos del
     hilo incluidos) en cada cuadro, y en un equipo modesto se nota. */
  .vis {
    position: fixed; inset: 0; z-index: 1000; display: flex; flex-direction: column;
    background: #0b0f13; color: #eef2f1;
    font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
    opacity: 0; transition: opacity .2s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .vis[hidden] { display: none; }
  .vis.abierto { opacity: 1; }
  .vis-barra {
    flex: none; display: flex; align-items: center; gap: 4px;
    padding: 10px 14px 10px 18px; padding-top: max(10px, env(safe-area-inset-top));
    border-bottom: 1px solid rgba(255,255,255,.06);
  }
  .vis-texto { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 1px; }
  .vis-tit { font-weight: 600; font-size: 14.5px; letter-spacing: .1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .vis-cont { font-size: 12px; color: rgba(238,242,241,.55); font-variant-numeric: tabular-nums; }
  .vis-grupo { display: flex; align-items: center; gap: 2px; padding: 3px; border-radius: 12px; background: rgba(255,255,255,.05); margin-right: 6px; }
  .vis-grupo[hidden] { display: none; }
  .vis-b {
    flex: none; display: inline-grid; place-items: center; min-width: 38px; height: 38px; padding: 0 9px;
    border: 0; border-radius: 9px; background: transparent; color: rgba(238,242,241,.85);
    font: inherit; font-size: 12.5px; cursor: pointer; text-decoration: none;
    transition: background-color .15s ease, color .15s ease;
  }
  .vis-b:hover { background: rgba(255,255,255,.1); color: #fff; }
  .vis-b:focus-visible, .vis-flecha:focus-visible, .vis-mini:focus-visible { outline: 2px solid #25d366; outline-offset: 2px; }
  .vis-b svg { width: 20px; height: 20px; }
  .vis-b[disabled] { opacity: .3; cursor: default; background: transparent; }
  .vis-zoom { min-width: 54px; font-variant-numeric: tabular-nums; }
  .vis-cerrar { background: rgba(255,255,255,.08); }
  .vis-escena {
    position: relative; flex: 1; min-height: 0; overflow: hidden;
    touch-action: none; user-select: none;
  }
  /* El tamaño lo pone el JS (ajustar): llena el sitio libre sin deformar ni pixelar. */
  .vis-img, .vis-vid {
    position: absolute; inset: 0; margin: auto; max-width: none; max-height: none;
    border-radius: 10px; box-shadow: 0 20px 60px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.05);
  }
  .vis-img { transform-origin: 0 0; cursor: zoom-in; will-change: transform; -webkit-user-drag: none; background: rgba(255,255,255,.03); }
  .vis-img.ampliada { cursor: grab; border-radius: 0; }
  .vis-img.arrastrando { cursor: grabbing; }
  .vis-img.animar { transition: transform .2s ease; }
  .vis-vid { background: #000; outline: none; }
  .vis-img[hidden], .vis-vid[hidden] { display: none; }
  .vis-entra { animation: vis-entrar .22s ease; }
  @keyframes vis-entrar { from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: none; } }
  .vis-estado {
    position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none;
    color: rgba(238,242,241,.75); font-size: 14px; text-align: center; padding: 24px; max-width: 420px; margin: auto;
  }
  .vis-estado[hidden] { display: none; }
  .vis-giro {
    width: 32px; height: 32px; border-radius: 50%;
    border: 3px solid rgba(255,255,255,.14); border-top-color: #25d366;
    animation: vis-girar .8s linear infinite;
  }
  @keyframes vis-girar { to { transform: rotate(360deg); } }
  .vis-flecha {
    position: absolute; top: 50%; z-index: 2; transform: translateY(-50%);
    width: 46px; height: 46px; border: 1px solid rgba(255,255,255,.1); border-radius: 50%;
    background: rgba(20, 26, 31, .75); color: #fff; cursor: pointer;
    display: grid; place-items: center; box-shadow: 0 4px 16px rgba(0,0,0,.35);
    transition: background-color .15s ease, transform .15s ease;
  }
  .vis-flecha:hover { background: rgba(45, 52, 58, .95); transform: translateY(-50%) scale(1.06); }
  .vis-flecha svg { width: 24px; height: 24px; }
  .vis-flecha[hidden] { display: none; }
  .vis-ant { left: 18px; }
  .vis-sig { right: 18px; }
  .vis-tira {
    flex: none; display: flex; gap: 8px; justify-content: center; overflow-x: auto;
    padding: 10px 16px; padding-bottom: max(12px, env(safe-area-inset-bottom));
    border-top: 1px solid rgba(255,255,255,.06);
    scrollbar-width: none;
  }
  .vis-tira::-webkit-scrollbar { display: none; }
  .vis-tira[hidden] { display: none; }
  .vis-mini {
    flex: none; position: relative; width: 50px; height: 50px; padding: 0; overflow: hidden;
    border: 0; border-radius: 9px; background: rgba(255,255,255,.08);
    cursor: pointer; opacity: .45; transition: opacity .15s ease, transform .15s ease, box-shadow .15s ease;
  }
  .vis-mini:hover { opacity: .8; }
  .vis-mini.actual { opacity: 1; transform: translateY(-2px); box-shadow: 0 0 0 2px #25d366, 0 6px 16px rgba(0,0,0,.4); }
  .vis-mini img, .vis-mini video { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
  .vis-mini.es-video::after {
    content: ''; position: absolute; inset: 0; margin: auto; width: 22px; height: 22px; border-radius: 50%;
    background: rgba(0,0,0,.55) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23fff'%3E%3Cpath d='M9 6.5v11l9-5.5z'/%3E%3C/svg%3E") center / 14px no-repeat;
  }
  .vis-solo-lector { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  @media (max-width: 640px) {
    .vis-barra { padding-left: 14px; }
    .vis-flecha { width: 38px; height: 38px; }
    .vis-ant { left: 8px; }
    .vis-sig { right: 8px; }
    .vis-img, .vis-vid { border-radius: 0; box-shadow: none; }
    .vis-grupo { display: none; }
    .vis-mini { width: 44px; height: 44px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .vis, .vis-img.animar, .vis-mini, .vis-flecha { transition: none; }
    .vis-entra { animation: none; }
  }
  @media print { .vis { display: none !important; } }

  /* Lo que abre el visor, dentro del hilo: se ve tocable. */
  [data-visor] { cursor: zoom-in; }
  [data-visor="video"] { cursor: pointer; }
  .visor-video {
    position: relative; display: block; width: 300px; max-width: 100%; padding: 0; border: 0; overflow: hidden;
    border-radius: 8px; background: #111; font: inherit; color: inherit; text-align: left;
  }
  .visor-video video { display: block; width: 100%; height: auto; max-height: 340px; min-height: 150px; object-fit: cover; pointer-events: none; }
  .visor-video::before {
    content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 44px; pointer-events: none;
    background: linear-gradient(transparent, rgba(0,0,0,.55));
  }
  .visor-video::after {
    content: ''; position: absolute; left: 50%; top: 50%; width: 54px; height: 54px; margin: -27px 0 0 -27px;
    border-radius: 50%; background: rgba(0,0,0,.5) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23fff'%3E%3Cpath d='M8.5 5.8v12.4l10.2-6.2z'/%3E%3C/svg%3E") center / 28px no-repeat;
    box-shadow: 0 2px 12px rgba(0,0,0,.35); transition: transform .15s ease, background-color .15s ease;
  }
  .visor-video:hover::after { transform: scale(1.08); background-color: rgba(0,0,0,.68); }
  .visor-video:focus-visible { outline: 2px solid #25d366; outline-offset: 2px; }
  /* La duracion abajo a la izquierda, como en WhatsApp (la pone el JS al leer el video). */
  .visor-dur {
    position: absolute; left: 8px; bottom: 6px; z-index: 1; display: inline-flex; align-items: center; gap: 4px;
    color: #fff; font-size: 11.5px; font-weight: 600; font-variant-numeric: tabular-nums;
    text-shadow: 0 1px 2px rgba(0,0,0,.6); pointer-events: none;
  }
  .visor-dur:empty { display: none; }
  .visor-dur::before {
    content: ''; width: 14px; height: 10px; flex: none;
    background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 17' fill='%23fff'%3E%3Crect x='0' y='1' width='16' height='15' rx='3'/%3E%3Cpath d='M17 6l7-4v13l-7-4z'/%3E%3C/svg%3E") center / contain no-repeat;
  }
`;

export const VISOR_JS = String.raw`
(function () {
  if (window.abrirVisor) return;

  var ICO = {
    cerrar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    ant: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    sig: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
    menos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M8 11h6M20 20l-4-4"/></svg>',
    mas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M8 11h6M11 8v6M20 20l-4-4"/></svg>',
    bajar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>'
  };
  var ZOOM_MAX = 5;

  var raiz = null, el = {};
  var lista = [], pos = 0, origen = null;
  var z = 1, tx = 0, ty = 0;
  var punteros = {}, gesto = null, movido = false;
  var esperaVideo = null;

  function crear() {
    if (raiz) return;
    raiz = document.createElement('div');
    raiz.className = 'vis';
    raiz.hidden = true;
    raiz.setAttribute('role', 'dialog');
    raiz.setAttribute('aria-modal', 'true');
    raiz.setAttribute('aria-label', 'Visor de fotos y videos');
    raiz.innerHTML =
      '<div class="vis-barra">' +
        '<div class="vis-texto"><span class="vis-tit"></span><span class="vis-cont"></span></div>' +
        '<div class="vis-grupo vis-solo-foto">' +
          '<button type="button" class="vis-b vis-menos" title="Alejar (−)" aria-label="Alejar">' + ICO.menos + '</button>' +
          '<button type="button" class="vis-b vis-zoom" title="Acercar o volver al tamaño (0)" aria-label="Restablecer el zoom">100 %</button>' +
          '<button type="button" class="vis-b vis-mas" title="Acercar (+)" aria-label="Acercar">' + ICO.mas + '</button>' +
        '</div>' +
        '<a class="vis-b vis-bajar" title="Descargar" aria-label="Descargar">' + ICO.bajar + '</a>' +
        '<button type="button" class="vis-b vis-cerrar" title="Cerrar (Esc)" aria-label="Cerrar el visor">' + ICO.cerrar + '</button>' +
      '</div>' +
      '<div class="vis-escena">' +
        '<img class="vis-img" alt="" draggable="false" hidden>' +
        '<video class="vis-vid" controls playsinline preload="auto" hidden></video>' +
        '<div class="vis-estado" hidden></div>' +
        '<button type="button" class="vis-flecha vis-ant" title="Anterior (←)" aria-label="Anterior">' + ICO.ant + '</button>' +
        '<button type="button" class="vis-flecha vis-sig" title="Siguiente (→)" aria-label="Siguiente">' + ICO.sig + '</button>' +
      '</div>' +
      '<div class="vis-tira" role="tablist" aria-label="Fotos y videos de esta conversación"></div>' +
      '<div class="vis-solo-lector" aria-live="polite"></div>';
    document.body.appendChild(raiz);
    ['tit', 'cont', 'menos', 'zoom', 'mas', 'bajar', 'cerrar', 'escena', 'img', 'vid', 'estado', 'ant', 'sig', 'tira'].forEach(function (k) {
      el[k] = raiz.querySelector('.vis-' + k);
    });
    el.vivo = raiz.querySelector('.vis-solo-lector');

    el.cerrar.onclick = cerrar;
    el.ant.onclick = function () { ir(pos - 1); };
    el.sig.onclick = function () { ir(pos + 1); };
    el.mas.onclick = function () { zoomEn(z * 1.5, null, true); };
    el.menos.onclick = function () { zoomEn(z / 1.5, null, true); };
    el.zoom.onclick = function () { zoomEn(z === 1 ? 2 : 1, null, true); };
    el.tira.addEventListener('click', function (e) {
      var b = e.target.closest('.vis-mini');
      if (b) ir(Number(b.getAttribute('data-i')));
    });
    el.img.addEventListener('load', function () { estado(''); ajustar(true); });
    el.img.addEventListener('error', function () { estado('No se pudo abrir la foto: puede que el archivo ya no esté guardado.'); });
    el.vid.addEventListener('loadedmetadata', function () { ajustar(true); });
    /* Por si el aviso de metadatos se adelanto o no llego: con datos, se ajusta igual. */
    el.vid.addEventListener('loadeddata', function () { estado(''); if (el.vid.style.visibility === 'hidden') ajustar(true); });
    el.vid.addEventListener('error', function () { if (el.vid.getAttribute('src')) estado('No se pudo reproducir el video: puede que el archivo ya no esté guardado o que el navegador no entienda su formato.'); });
    el.img.addEventListener('dblclick', function (e) { zoomEn(z > 1 ? 1 : 2.5, e, true); });
    el.escena.addEventListener('wheel', alRueda, { passive: false });
    el.escena.addEventListener('pointerdown', alBajar);
    el.escena.addEventListener('pointermove', alMover);
    el.escena.addEventListener('pointerup', alSubir);
    el.escena.addEventListener('pointercancel', alSubir);
    window.addEventListener('resize', function () { if (abierto()) { reiniciarZoom(false); ajustar(false); } });
  }

  /*
   * El tamaño en pantalla: lo mas grande que quepa sin deformar. Una foto
   * pequeña se agranda hasta 2,5 veces (mas, se pixela); un video de WhatsApp
   * suele venir chico y se agranda hasta llenar. En escritorio se deja sitio
   * a las flechas para que no tapen la foto.
   */
  function ajustar(entrar) {
    var esFoto = !el.img.hidden;
    var m = esFoto ? el.img : el.vid;
    var w = esFoto ? el.img.naturalWidth : el.vid.videoWidth;
    var h = esFoto ? el.img.naturalHeight : el.vid.videoHeight;
    /* Sin medidas todavia (o un formato raro): se enseña con su tamaño propio, nunca invisible. */
    if (!w || !h) { m.style.width = ''; m.style.height = ''; m.style.visibility = ''; return; }
    var movil = window.innerWidth <= 640;
    var margenX = movil ? 0 : (lista.length > 1 ? 160 : 64);
    var margenY = movil ? 0 : 40;
    var libreW = Math.max(80, el.escena.clientWidth - margenX);
    var libreH = Math.max(80, el.escena.clientHeight - margenY);
    var s = Math.min(libreW / w, libreH / h, esFoto ? 2.5 : 4);
    m.style.width = Math.round(w * s) + 'px';
    m.style.height = Math.round(h * s) + 'px';
    m.style.visibility = '';
    if (entrar) { m.classList.remove('vis-entra'); void m.offsetWidth; m.classList.add('vis-entra'); }
  }

  function abierto() { return Boolean(raiz && !raiz.hidden); }

  function estado(texto) {
    if (texto === 'cargando') { el.estado.innerHTML = '<div class="vis-giro" aria-label="Cargando"></div>'; el.estado.hidden = false; return; }
    el.estado.textContent = texto;
    el.estado.hidden = !texto;
  }

  /* ----------------------------------------------------------------- los items */
  function direccionDe(n) {
    var s = n.getAttribute('data-visor-src');
    if (s) return s;
    if (n.tagName === 'A' && n.getAttribute('href')) return n.href;
    if ((n.tagName === 'IMG' || n.tagName === 'VIDEO') && (n.currentSrc || n.getAttribute('src'))) return n.currentSrc || n.src;
    var dentro = n.querySelector('img[src], video[src]');
    return dentro ? (dentro.currentSrc || dentro.src) : '';
  }
  function itemDe(n) {
    var src = direccionDe(n);
    if (!src) return null;
    var tipo = n.getAttribute('data-visor') === 'video' ? 'video' : 'imagen';
    return {
      tipo: tipo,
      src: src.replace(/#t=[\d.,]*$/, ''),
      titulo: n.getAttribute('data-visor-titulo') || '',
      nombre: n.getAttribute('data-visor-nombre') || '',
      el: n
    };
  }
  function abrirDesde(n) {
    var grupo = n.closest('[data-visor-grupo]') || document;
    var items = [], i = 0;
    grupo.querySelectorAll('[data-visor]').forEach(function (x) {
      var it = itemDe(x);
      if (!it) return;
      if (x === n) i = items.length;
      items.push(it);
    });
    if (!itemDe(n)) return;
    abrirVisor(items, i);
  }

  /* ------------------------------------------------------------ abrir y cerrar */
  function abrirVisor(items, i) {
    items = (items || []).filter(function (x) { return x && x.src; });
    if (!items.length) return;
    crear();
    lista = items;
    if (!abierto()) {
      origen = document.activeElement;
      raiz.hidden = false;
      document.documentElement.style.overflow = 'hidden';
      requestAnimationFrame(function () { raiz.classList.add('abierto'); });
    }
    pintarTira();
    ir(i || 0);
    el.cerrar.focus({ preventScroll: true });
  }

  function cerrar() {
    if (!abierto()) return;
    pararVideo();
    clearTimeout(esperaVideo);
    soltarTira();
    raiz.classList.remove('abierto');
    raiz.hidden = true;
    el.img.removeAttribute('src');
    document.documentElement.style.overflow = '';
    lista = [];
    var volver = origen;
    origen = null;
    if (volver && volver.isConnected && volver.focus) volver.focus({ preventScroll: true });
  }

  function pararVideo() {
    try { el.vid.pause(); } catch (e) { /* nada */ }
    if (el.vid.getAttribute('src')) { el.vid.removeAttribute('src'); el.vid.load(); }
  }

  function ir(i) {
    if (!lista.length) return;
    if (i < 0 || i >= lista.length) return;
    pos = i;
    var it = lista[pos];
    pararVideo();
    reiniciarZoom(false);
    var esFoto = it.tipo === 'imagen';
    el.img.hidden = !esFoto;
    el.vid.hidden = esFoto;
    raiz.querySelectorAll('.vis-solo-foto').forEach(function (b) { b.hidden = !esFoto; });
    estado('cargando');
    /* Hasta saber su tamaño no se enseña: asi no da un salto al ajustarse. */
    [el.img, el.vid].forEach(function (m) { m.style.visibility = 'hidden'; m.style.width = ''; m.style.height = ''; });
    if (esFoto) {
      el.img.removeAttribute('src');
      el.img.alt = it.titulo || 'Foto';
      el.img.src = it.src;
      if (el.img.complete && el.img.naturalWidth) { estado(''); ajustar(true); }
    } else {
      el.img.removeAttribute('src');
      el.vid.src = it.src;
      /* Red lenta: a los 4 s se enseña el reproductor aunque falten las medidas. */
      clearTimeout(esperaVideo);
      esperaVideo = setTimeout(function () { if (el.vid.style.visibility === 'hidden') ajustar(false); }, 4000);
      var p = el.vid.play();
      if (p && p.catch) p.catch(function () { /* el navegador no deja sonar solo: se ve el boton de play */ });
    }
    var nombre = it.titulo || (esFoto ? 'Foto' : 'Video');
    el.tit.textContent = nombre;
    el.cont.textContent = lista.length > 1 ? (pos + 1) + ' de ' + lista.length : '';
    el.vivo.textContent = nombre + (lista.length > 1 ? ', ' + (pos + 1) + ' de ' + lista.length : '');
    el.bajar.href = it.src;
    el.bajar.setAttribute('download', it.nombre || (esFoto ? 'foto' : 'video'));
    el.ant.hidden = pos === 0;
    el.sig.hidden = pos === lista.length - 1;
    el.tira.querySelectorAll('.vis-mini').forEach(function (b, k) {
      var es = k === pos;
      b.classList.toggle('actual', es);
      b.setAttribute('aria-selected', es ? 'true' : 'false');
      if (es && b.scrollIntoView) b.scrollIntoView({ block: 'nearest', inline: 'center' });
    });
    precargar(pos + 1);
    precargar(pos - 1);
  }

  function precargar(i) {
    var it = lista[i];
    if (it && it.tipo === 'imagen') { var im = new Image(); im.src = it.src; }
  }

  function soltarTira() { el.tira.innerHTML = ''; }

  /* El cuadro que ya enseña el video del hilo, en pequeño (JPEG). Vacio si aun no cargo. */
  function fotograma(n) {
    try {
      var v = n && (n.tagName === 'VIDEO' ? n : n.querySelector && n.querySelector('video'));
      if (!v || v.readyState < 2 || !v.videoWidth) return '';
      var k = Math.min(1, 120 / Math.max(v.videoWidth, v.videoHeight));
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(v.videoWidth * k));
      c.height = Math.max(1, Math.round(v.videoHeight * k));
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.75);
    } catch (e) { return ''; }
  }

  function pintarTira() {
    soltarTira();
    el.tira.hidden = lista.length < 2;
    if (lista.length < 2) return;
    lista.forEach(function (it, k) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'vis-mini' + (it.tipo === 'video' ? ' es-video' : '');
      b.setAttribute('data-i', String(k));
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-label', (it.tipo === 'video' ? 'Video ' : 'Foto ') + (k + 1) + ' de ' + lista.length);
      if (it.tipo === 'imagen') {
        var im = document.createElement('img');
        im.alt = '';
        im.loading = 'lazy';
        im.src = it.src;
        b.appendChild(im);
      } else {
        /* Un fotograma del video del hilo (ya cargado), copiado a una imagen:
           asi la miniatura no gasta otro reproductor del navegador. */
        var foto = fotograma(it.el);
        if (foto) {
          var iv = document.createElement('img');
          iv.alt = '';
          iv.src = foto;
          b.appendChild(iv);
        }
      }
      el.tira.appendChild(b);
    });
  }

  /* ------------------------------------------------------------- zoom y arrastre */
  function aplicar(animar) {
    el.img.classList.toggle('animar', Boolean(animar));
    el.img.classList.toggle('ampliada', z > 1);
    el.img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + z + ')';
    el.zoom.textContent = Math.round(z * 100) + ' %';
    el.menos.disabled = z <= 1;
    el.mas.disabled = z >= ZOOM_MAX;
  }
  function reiniciarZoom(animar) { z = 1; tx = 0; ty = 0; aplicar(animar); }

  /* La foto no puede irse de la pantalla: como mucho, su borde llega al borde. */
  function limitar() {
    if (z <= 1) { tx = 0; ty = 0; aplicar(false); return; }
    var w = el.img.offsetWidth, h = el.img.offsetHeight;
    var ew = el.escena.clientWidth, eh = el.escena.clientHeight;
    var extraX = Math.max(0, (w * z - ew) / 2 + 16), extraY = Math.max(0, (h * z - eh) / 2 + 16);
    /* translate es relativo a la esquina con origen 0 0: el centro ampliado queda en -(z-1)*w/2. */
    var cx = -(z - 1) * w / 2, cy = -(z - 1) * h / 2;
    tx = Math.min(cx + extraX, Math.max(cx - extraX, tx));
    ty = Math.min(cy + extraY, Math.max(cy - extraY, ty));
    if (w * z <= ew) tx = cx;
    if (h * z <= eh) ty = cy;
    aplicar(false);
  }

  /* Acerca o aleja manteniendo quieto el punto bajo el raton (o el centro). */
  function zoomEn(nuevo, ev, animar) {
    if (el.img.hidden) return;
    nuevo = Math.max(1, Math.min(ZOOM_MAX, nuevo));
    var r = el.img.getBoundingClientRect();
    /* Con transform-origin 0 0, la esquina de la foto solo se mueve con el translate. */
    var base = { x: r.left - tx, y: r.top - ty };
    var px = ev && ev.clientX !== undefined ? ev.clientX : r.left + r.width / 2;
    var py = ev && ev.clientY !== undefined ? ev.clientY : r.top + r.height / 2;
    var lx = (px - base.x - tx) / z, ly = (py - base.y - ty) / z;
    tx = px - base.x - lx * nuevo;
    ty = py - base.y - ly * nuevo;
    z = nuevo;
    if (z === 1) { tx = 0; ty = 0; }
    aplicar(animar);
    if (animar) setTimeout(limitar, 190); else limitar();
  }

  function alRueda(e) {
    if (el.img.hidden) return;
    e.preventDefault();
    zoomEn(z * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e, false);
  }

  function alBajar(e) {
    if (e.target.closest('.vis-flecha, video')) return;
    punteros[e.pointerId] = { x: e.clientX, y: e.clientY };
    movido = false;
    var ids = Object.keys(punteros);
    if (ids.length === 1) {
      gesto = { tipo: 'uno', x: e.clientX, y: e.clientY, tx: tx, ty: ty, enFoto: e.target === el.img };
    } else if (ids.length === 2 && !el.img.hidden) {
      var a = punteros[ids[0]], b = punteros[ids[1]];
      gesto = { tipo: 'pinza', d: Math.hypot(a.x - b.x, a.y - b.y), z: z };
    }
    try { el.escena.setPointerCapture(e.pointerId); } catch (x) { /* nada */ }
  }

  function alMover(e) {
    if (!punteros[e.pointerId] || !gesto) return;
    punteros[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (gesto.tipo === 'pinza') {
      var ids = Object.keys(punteros);
      if (ids.length < 2) return;
      var a = punteros[ids[0]], b = punteros[ids[1]];
      var d = Math.hypot(a.x - b.x, a.y - b.y);
      movido = true;
      zoomEn(gesto.z * d / (gesto.d || 1), { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }, false);
      return;
    }
    var dx = e.clientX - gesto.x, dy = e.clientY - gesto.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) movido = true;
    if (z > 1) {
      tx = gesto.tx + dx;
      ty = gesto.ty + dy;
      el.img.classList.add('arrastrando');
      limitar();
    }
  }

  function alSubir(e) {
    var g = gesto;
    delete punteros[e.pointerId];
    el.img.classList.remove('arrastrando');
    if (Object.keys(punteros).length) return;
    gesto = null;
    if (!g || g.tipo !== 'uno') return;
    var dx = e.clientX - g.x, dy = e.clientY - g.y;
    /* Deslizar de lado (sin zoom) pasa a la siguiente o la anterior, como en el telefono. */
    if (z === 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { ir(dx < 0 ? pos + 1 : pos - 1); return; }
    /* Deslizar hacia abajo cierra. */
    if (z === 1 && dy > 110 && Math.abs(dy) > Math.abs(dx) * 1.5 && e.pointerType !== 'mouse') { cerrar(); return; }
    /* Un toque fuera de la foto (en lo oscuro) cierra; un toque en la foto no. */
    if (!movido && !g.enFoto && e.target === el.escena) cerrar();
  }

  /* -------------------------------------------------------------------- teclado */
  document.addEventListener('keydown', function (e) {
    if (!abierto()) {
      /* Una foto o video que no es boton ni enlace tambien se abre con Enter. */
      var t = e.target;
      if ((e.key === 'Enter' || e.key === ' ') && t && t.matches && t.matches('[data-visor]') && t.tagName !== 'A' && t.tagName !== 'BUTTON') {
        e.preventDefault();
        abrirDesde(t);
      }
      return;
    }
    var enVideo = e.target === el.vid;
    var hecho = true;
    if (e.key === 'Escape') cerrar();
    else if (e.key === 'ArrowLeft' && !enVideo) ir(pos - 1);
    else if (e.key === 'ArrowRight' && !enVideo) ir(pos + 1);
    else if ((e.key === '+' || e.key === '=') && !el.img.hidden) zoomEn(z * 1.5, null, true);
    else if (e.key === '-' && !el.img.hidden) zoomEn(z / 1.5, null, true);
    else if (e.key === '0' && !el.img.hidden) reiniciarZoom(true);
    else if (e.key === 'Tab') {
      /* El foco no se escapa a la pagina de detras. */
      var f = Array.prototype.filter.call(raiz.querySelectorAll('button, a[href], video'), function (x) { return !x.hidden && !x.disabled && x.offsetParent !== null; });
      if (f.length) {
        var i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { f[0].focus(); }
        else hecho = false;
        if (i === -1) { f[0].focus(); hecho = true; }
      } else hecho = false;
    } else hecho = false;
    if (hecho) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  /* ------------------------------------------------------------ abrir al tocar */
  document.addEventListener('click', function (e) {
    var n = e.target && e.target.closest ? e.target.closest('[data-visor]') : null;
    if (!n || (raiz && raiz.contains(n))) return;
    /* Ctrl/⌘/Mayus + clic en un enlace: quien lo hace quiere la pestaña nueva. */
    if (n.tagName === 'A' && (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0)) return;
    if (!itemDe(n)) return;
    e.preventDefault();
    abrirDesde(n);
  });

  /* ------------------------------------------- la duracion en el video del hilo */
  function duracion(seg) {
    if (!isFinite(seg) || seg <= 0) return '';
    seg = Math.round(seg);
    var h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = seg % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  /*
   * Se recuerda por direccion: el chat repinta el hilo cada pocos segundos y
   * solo reutiliza un globo si su HTML no cambio. Por eso el chat pinta la
   * duracion el mismo (visorDuracion) en vez de dejar que se escriba despues:
   * si no, cada repintado veria un globo "distinto", volveria a crear el video
   * y lo descargaria otra vez.
   */
  var duraciones = {};
  function clave(src) {
    try { return new URL(src, location.href).href.split('#')[0]; } catch (e) { return String(src).split('#')[0]; }
  }
  window.visorDuracion = function (src) { return duraciones[clave(src)] || ''; };
  /* loadedmetadata no sube por el DOM: se escucha en captura, asi vale tambien
     para los videos que se pintan despues (al llegar mensajes nuevos). */
  document.addEventListener('loadedmetadata', function (e) {
    var v = e.target;
    if (!v || v.tagName !== 'VIDEO' || !v.parentNode || !v.parentNode.classList || !v.parentNode.classList.contains('visor-video')) return;
    var texto = duracion(v.duration);
    if (!texto) return;
    duraciones[clave(v.currentSrc || v.src)] = texto;
    var caja = v.parentNode;
    var d = caja.querySelector('.visor-dur');
    if (!d) { d = document.createElement('span'); d.className = 'visor-dur'; caja.appendChild(d); }
    if (d.textContent !== texto) d.textContent = texto;
  }, true);

  window.abrirVisor = abrirVisor;
  window.cerrarVisor = cerrar;
})();
`;
