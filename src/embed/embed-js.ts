/**
 * `embed.js`: lo unico que pega la otra web.
 *
 *   <div id="chat-wa" style="height:600px"></div>
 *   <script src="https://wa.negocio.com/embed.js"></script>
 *   <script>
 *     var chat = WA.montar('#chat-wa', {
 *       token: '<token de POST /api/v1/embed/token>',
 *       telefono: '51987654321',            // opcional: solo ese hilo
 *       onMensaje: function (m) {},         // llego o salio un mensaje
 *       onNoLeidos: function (n) {},        // cuantos chats esperan
 *       onTokenCaducado: function () { chat.actualizarToken(nuevo); }
 *     });
 *   </script>
 *
 * Crea el iframe apuntando a este servidor, le pasa el token por
 * postMessage (nunca por la URL) y reexpone lo que el iframe cuenta como
 * callbacks. No necesita CORS: el iframe habla con su propio origen.
 */

export function embedScript(origen: string): string {
  return String.raw`(function () {
  var ORIGEN = ${JSON.stringify(origen)};
  function montar(selector, opts) {
    opts = opts || {};
    var caja = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!caja) throw new Error('WA.montar: no existe ' + selector);
    var token = opts.token || null;
    var iframe = document.createElement('iframe');
    var url = ORIGEN + '/embed/chat' + (opts.telefono ? '?telefono=' + encodeURIComponent(opts.telefono) : '');
    iframe.src = url;
    iframe.title = 'Chat de WhatsApp';
    iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;min-height:' + (opts.altoMinimo || 420) + 'px';
    iframe.allow = 'clipboard-write';
    caja.innerHTML = '';
    caja.appendChild(iframe);

    function mandar(msg) { if (iframe.contentWindow) iframe.contentWindow.postMessage(msg, ORIGEN); }
    function escuchar(ev) {
      if (ev.origin !== ORIGEN || ev.source !== iframe.contentWindow || !ev.data || typeof ev.data !== 'object') return;
      var d = ev.data;
      if (d.tipo === 'wa:listo') { if (token) mandar({ tipo: 'wa:token', token: token }); if (opts.onListo) opts.onListo(); }
      if (d.tipo === 'wa:mensaje' && opts.onMensaje) opts.onMensaje(d);
      if (d.tipo === 'wa:no-leidos' && opts.onNoLeidos) opts.onNoLeidos(d.n);
      if (d.tipo === 'wa:token-caducado' && opts.onTokenCaducado) opts.onTokenCaducado();
    }
    window.addEventListener('message', escuchar);

    return {
      iframe: iframe,
      actualizarToken: function (nuevo) { token = nuevo; mandar({ tipo: 'wa:token', token: nuevo }); },
      abrir: function (telefono) { mandar({ tipo: 'wa:abrir', telefono: telefono }); },
      destruir: function () { window.removeEventListener('message', escuchar); if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }
    };
  }
  /**
   * La burbuja flotante: para cualquier web, sin tocar su diseno.
   *
   * Un boton abajo a la derecha (o a la izquierda) que abre el chat en un
   * panel encima de la pagina. Ensena el numero de chats sin responder.
   * Mismas opciones que montar, mas: lado ('derecha'|'izquierda'), color,
   * texto (lo que dice el boton), abierto (arranca desplegado).
   */
  function flotante(opts) {
    opts = opts || {};
    var lado = opts.lado === 'izquierda' ? 'left' : 'right';
    var color = opts.color || '#25d366';
    var raiz = document.createElement('div');
    raiz.style.cssText = 'position:fixed;bottom:20px;' + lado + ':20px;z-index:2147483000;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;';
    var boton = document.createElement('button');
    boton.type = 'button';
    boton.setAttribute('aria-label', 'Abrir chat de WhatsApp');
    boton.style.cssText = 'display:flex;align-items:center;gap:8px;border:0;border-radius:999px;padding:12px 18px;background:' + color + ';color:#fff;font:600 15px/1 inherit;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer;';
    boton.innerHTML = '<span style="font-size:20px;line-height:1">&#128172;</span><span>' + (opts.texto || 'Chat') + '</span><span data-wa-contador style="display:none;background:#fff;color:' + color + ';border-radius:999px;padding:2px 8px;font-size:12px"></span>';
    var panel = document.createElement('div');
    panel.style.cssText = 'display:none;position:absolute;bottom:60px;' + lado + ':0;width:min(400px,calc(100vw - 40px));height:min(620px,calc(100vh - 100px));border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.3);background:#fff;';
    raiz.appendChild(panel);
    raiz.appendChild(boton);
    document.body.appendChild(raiz);

    var contador = boton.querySelector('[data-wa-contador]');
    var abierto = false;
    var chat = null;
    function alternar(estado) {
      abierto = typeof estado === 'boolean' ? estado : !abierto;
      panel.style.display = abierto ? 'block' : 'none';
      if (abierto && !chat) chat = montar(panel, Object.assign({}, opts, { altoMinimo: 0, onNoLeidos: mostrarNoLeidos }));
      if (abierto) contador.style.display = 'none';
    }
    function mostrarNoLeidos(n) {
      contador.textContent = String(n);
      contador.style.display = n > 0 && !abierto ? 'inline-block' : 'none';
      if (opts.onNoLeidos) opts.onNoLeidos(n);
    }
    boton.onclick = function () { alternar(); };
    if (opts.abierto) alternar(true);

    return {
      abrir: function (telefono) { alternar(true); if (chat && telefono) chat.abrir(telefono); },
      cerrar: function () { alternar(false); },
      actualizarToken: function (t) { opts.token = t; if (chat) chat.actualizarToken(t); },
      destruir: function () { if (chat) chat.destruir(); if (raiz.parentNode) raiz.parentNode.removeChild(raiz); }
    };
  }

  window.WA = window.WA || {};
  window.WA.montar = montar;
  window.WA.flotante = flotante;
})();
`;
}
