/**
 * `widget.js`: la burbuja de chat para los visitantes de la web del negocio.
 *
 *   <script src="https://wa.negocio.com/web/widget.js"></script>
 *   <script>WAChat.montar({ texto: '¿Te ayudamos?', color: '#25d366', whatsapp: '51987654321' });</script>
 *
 * El visitante escribe desde la pagina, sin cuenta ni WhatsApp. Su mensaje
 * entra al sistema como un entrante mas: lo contesta el asistente de IA y
 * lo ve el equipo en Chats. Las respuestas llegan en vivo (SSE). La sesion
 * se guarda en el navegador: si vuelve, sigue su conversacion.
 *
 * Opciones: texto (del boton), color, lado ('derecha'|'izquierda'), titulo,
 * bienvenida (primer mensaje que ve), whatsapp (numero para "seguir por
 * WhatsApp"), pedirNombre (true: pregunta el nombre antes de empezar),
 * abierto (arranca desplegado). Sin CORS que configurar en la pagina: el
 * servidor solo acepta los origenes escritos en el panel.
 */

export function widgetScript(origen: string): string {
  return String.raw`(function () {
  var ORIGEN = ${JSON.stringify(origen)};
  var CLAVE = 'wa-chat-sesion';

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function leer() { try { return localStorage.getItem(CLAVE); } catch (e) { return null; } }
  function guardar(v) { try { if (v) localStorage.setItem(CLAVE, v); else localStorage.removeItem(CLAVE); } catch (e) {} }
  async function api(path, body) {
    var r;
    try {
      r = await fetch(ORIGEN + path, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      // Sin respuesta del servidor: casi siempre la web no esta en "webs que
      // pueden embeber" (el navegador corta por CORS) o no hay internet. El
      // "Failed to fetch" del navegador no le dice nada a nadie.
      throw new Error('No se pudo conectar con el chat. Si esta web es tuya, agregala en Conectar mi web y tienda; si eres cliente, intentalo de nuevo en un momento.');
    }
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(d.error || ('Error ' + r.status));
    return d;
  }
  function hora(f) { try { return new Date(f).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }

  function montar(opts) {
    opts = opts || {};
    var lado = opts.lado === 'izquierda' ? 'left' : 'right';
    var color = opts.color || '#25d366';
    var sesion = leer();
    var abierto = false, fuente = null, nombre = null, negocio = opts.titulo || 'Chat';
    var mensajes = [], vistos = {};

    var raiz = document.createElement('div');
    raiz.id = 'wa-chat-widget';
    raiz.style.cssText = 'position:fixed;bottom:20px;' + lado + ':20px;z-index:2147483000;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:14px;color:#111b21;';
    raiz.innerHTML =
      '<div data-panel style="display:none;position:absolute;bottom:64px;' + lado + ':0;width:min(380px,calc(100vw - 40px));height:min(560px,calc(100vh - 110px));border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.3);background:#efe7de;display:none;flex-direction:column;">' +
        '<div style="background:' + esc(color) + ';color:#fff;padding:12px 14px;display:flex;align-items:center;gap:10px;">' +
          '<div style="width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-size:18px;">&#128172;</div>' +
          '<div style="flex:1;min-width:0"><b data-titulo style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></b><small style="opacity:.9">Normalmente respondemos en segundos</small></div>' +
          '<button data-cerrar type="button" aria-label="Cerrar" style="border:0;background:transparent;color:#fff;font-size:22px;cursor:pointer;line-height:1">&times;</button>' +
        '</div>' +
        '<div data-nombre style="display:none;padding:16px;background:#fff;">' +
          '<p style="margin:0 0 8px">Para atenderte mejor, ¿cómo te llamas?</p>' +
          '<div style="display:flex;gap:8px"><input data-nombre-input placeholder="Tu nombre" style="flex:1;padding:9px 12px;border:1px solid #ddd;border-radius:8px;font:inherit"><button data-nombre-ok type="button" style="border:0;border-radius:8px;padding:9px 14px;background:' + esc(color) + ';color:#fff;font:inherit;font-weight:600;cursor:pointer">Empezar</button></div>' +
        '</div>' +
        '<div data-lista style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:6px;"></div>' +
        '<div data-wa style="display:none;padding:6px 12px;background:#fff;border-top:1px solid #e3e5e9;font-size:12px;text-align:center"></div>' +
        '<div style="background:#f0f2f5;padding:8px;display:flex;gap:8px;align-items:flex-end;">' +
          '<textarea data-texto rows="1" placeholder="Escribe un mensaje" style="flex:1;resize:none;min-height:38px;max-height:100px;padding:9px 12px;border:1px solid #ddd;border-radius:10px;font:inherit;background:#fff;color:#111b21"></textarea>' +
          '<button data-enviar type="button" style="border:0;border-radius:10px;padding:9px 14px;background:' + esc(color) + ';color:#fff;font:inherit;font-weight:600;cursor:pointer">Enviar</button>' +
        '</div>' +
      '</div>' +
      '<button data-boton type="button" aria-label="Abrir chat" style="display:flex;align-items:center;gap:8px;border:0;border-radius:999px;padding:12px 18px;background:' + esc(color) + ';color:#fff;font:600 15px/1 inherit;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer;">' +
        '<span style="font-size:20px;line-height:1">&#128172;</span><span>' + esc(opts.texto || '¿Te ayudamos?') + '</span><span data-contador style="display:none;background:#fff;color:' + esc(color) + ';border-radius:999px;padding:2px 8px;font-size:12px"></span>' +
      '</button>';
    document.body.appendChild(raiz);

    var $ = function (sel) { return raiz.querySelector('[data-' + sel + ']'); };
    var panel = $('panel'), lista = $('lista'), texto = $('texto'), contador = $('contador');
    $('titulo').textContent = negocio;

    function pintar() {
      lista.innerHTML = mensajes.map(function (m) {
        var mio = m.direccion === 'yo';
        var cuerpo = m.texto ? esc(m.texto).replace(/\n/g, '<br>') : '<i style="opacity:.7">' + esc(m.tipo || 'mensaje') + '</i>';
        if (m.datos && m.datos.interactive && m.datos.interactive.locationRequest) cuerpo += '<br><small style="opacity:.8">(desde WhatsApp podrías compartir tu ubicación con un botón)</small>';
        return '<div style="max-width:80%;padding:7px 10px;border-radius:10px;background:' + (mio ? '#d9fdd3' : '#fff') + ';align-self:' + (mio ? 'flex-end' : 'flex-start') + ';box-shadow:0 1px 1px rgba(0,0,0,.08);white-space:pre-wrap;word-wrap:break-word">' + cuerpo + '<div style="font-size:11px;opacity:.6;text-align:right;margin-top:2px">' + esc(hora(m.fecha)) + '</div></div>';
      }).join('') || (opts.bienvenida ? '<div style="max-width:80%;padding:7px 10px;border-radius:10px;background:#fff;align-self:flex-start">' + esc(opts.bienvenida) + '</div>' : '');
      lista.scrollTop = lista.scrollHeight;
    }
    function agregar(m) {
      if (m.id && vistos[m.id]) return;
      if (m.id) vistos[m.id] = true;
      mensajes.push(m);
      pintar();
      if (!abierto && m.direccion === 'negocio') { var n = Number(contador.textContent || 0) + 1; contador.textContent = String(n); contador.style.display = 'inline-block'; }
      if (m.direccion === 'negocio' && opts.onMensaje) opts.onMensaje(m);
    }

    async function asegurarSesion(nombreDado) {
      var d = await api('/web/sesion', { sesion: sesion || undefined, nombre: nombreDado || undefined, pagina: location.href.slice(0, 300) });
      sesion = d.sesion; guardar(sesion);
      nombre = d.nombre; negocio = opts.titulo || d.negocio || negocio;
      $('titulo').textContent = negocio;
      if (opts.whatsapp) { var wa = $('wa'); wa.style.display = 'block'; wa.innerHTML = '<a href="https://wa.me/' + esc(String(opts.whatsapp).replace(/\D/g, '')) + '" target="_blank" rel="noopener" style="color:' + esc(color) + ';text-decoration:none;font-weight:600">Seguir por WhatsApp &rarr;</a>'; }
      return d;
    }
    async function cargarHistorial() {
      try {
        var h = await api('/web/historial?sesion=' + encodeURIComponent(sesion));
        mensajes = []; vistos = {};
        (h.mensajes || []).forEach(function (m) { if (m.id) vistos[m.id] = true; mensajes.push(m); });
        pintar();
      } catch (e) { /* sesion caducada: se abre otra al escribir */ }
    }
    function conectar() {
      if (fuente || !window.EventSource || !sesion) return;
      fuente = new EventSource(ORIGEN + '/web/eventos?sesion=' + encodeURIComponent(sesion));
      fuente.addEventListener('mensaje', function (ev) { try { agregar(JSON.parse(ev.data)); } catch (e) {} });
      fuente.onerror = function () { /* el navegador reconecta solo */ };
    }
    async function empezar(nombreDado) {
      try {
        await asegurarSesion(nombreDado);
        $('nombre').style.display = 'none';
        await cargarHistorial();
        conectar();
      } catch (e) {
        lista.innerHTML = '<div style="padding:10px;background:#fff4e5;color:#b45309;border-radius:8px">' + esc(e.message) + '</div>';
      }
    }
    async function enviar() {
      var t = texto.value.trim();
      if (!t) return;
      texto.value = '';
      var id = 'local-' + Date.now();
      agregar({ id: id, direccion: 'yo', texto: t, fecha: new Date().toISOString() });
      try {
        if (!sesion) await asegurarSesion();
        conectar();
        await api('/web/mensajes', { sesion: sesion, texto: t });
      } catch (e) {
        if (/sesion|caduc/i.test(e.message)) { sesion = null; guardar(null); await asegurarSesion(); conectar(); try { await api('/web/mensajes', { sesion: sesion, texto: t }); return; } catch (e2) { e = e2; } }
        agregar({ id: id + '-err', direccion: 'negocio', texto: '⚠ ' + e.message, fecha: new Date().toISOString() });
      }
    }
    function alternar(estado) {
      abierto = typeof estado === 'boolean' ? estado : !abierto;
      panel.style.display = abierto ? 'flex' : 'none';
      if (abierto) {
        contador.style.display = 'none'; contador.textContent = '';
        if (!sesion && opts.pedirNombre) { $('nombre').style.display = 'block'; }
        else if (!fuente) { empezar(); }
        setTimeout(function () { texto.focus(); }, 50);
      }
    }
    $('boton').onclick = function () { alternar(); };
    $('cerrar').onclick = function () { alternar(false); };
    $('enviar').onclick = enviar;
    texto.onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } };
    $('nombre-ok').onclick = function () { empezar($('nombre-input').value.trim() || undefined); };
    $('nombre-input').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); $('nombre-ok').click(); } };
    pintar();
    if (sesion) { cargarHistorial(); conectar(); }
    if (opts.abierto) alternar(true);

    return {
      abrir: function () { alternar(true); },
      cerrar: function () { alternar(false); },
      enviar: function (t) { texto.value = t; return enviar(); },
      reiniciar: function () { if (fuente) { fuente.close(); fuente = null; } sesion = null; guardar(null); mensajes = []; vistos = {}; pintar(); },
      destruir: function () { if (fuente) fuente.close(); if (raiz.parentNode) raiz.parentNode.removeChild(raiz); }
    };
  }

  window.WAChat = window.WAChat || {};
  window.WAChat.montar = montar;
})();
`;
}
