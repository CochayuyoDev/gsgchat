/** Un EventSource por documento; reconecta solo mientras una pantalla lo necesita. */
export const EVENTOS_PANEL_JS = String.raw`
(function () {
  var oyentes = new Set(), fuente = null, reloj = null, demora = 2000, detenido = false;
  window.eventosPanelConectados = false;
  function interesa() { return location.pathname === '/chat' || (location.pathname === '/panel' && location.hash === '#historial'); }
  function avisar(nombre, datos) { oyentes.forEach(function (fn) { try { fn(nombre, datos); } catch (e) {} }); }
  function cerrar() { if (fuente) { fuente.close(); fuente = null; } window.eventosPanelConectados = false; clearTimeout(reloj); reloj = null; }
  function conectar() {
    if (detenido || document.hidden || !interesa() || fuente || !window.EventSource) return;
    var es = new EventSource('/admin/panel/eventos', { withCredentials: true }); fuente = es;
    es.onopen = function () { demora = 2000; window.eventosPanelConectados = true; };
    ['panel.ready','panel.resync','chat.changed','chat.status','incidents.changed','whatsapp.changed','chat.expired'].forEach(function (nombre) {
      es.addEventListener(nombre, function (evento) {
        try { avisar(nombre, JSON.parse(evento.data || '{}')); } catch (e) { avisar('panel.resync', { motivo: 'evento inválido' }); }
      });
    });
    es.onerror = function () {
      if (fuente !== es) return;
      es.close(); fuente = null;
      window.eventosPanelConectados = false;
      if (!detenido && !document.hidden && interesa()) {
        var base = demora; demora = Math.min(60000, demora * 2);
        reloj = setTimeout(conectar, Math.round(base * (0.8 + Math.random() * 0.4)));
      }
    };
  }
  window.suscribirEventosPanel = function (fn) { oyentes.add(fn); conectar(); return function () { oyentes.delete(fn); }; };
  document.addEventListener('visibilitychange', function () { if (document.hidden) cerrar(); else conectar(); });
  window.addEventListener('hashchange', function () { cerrar(); conectar(); });
  window.addEventListener('pagehide', function () { detenido = true; cerrar(); });
  window.addEventListener('pageshow', function () { detenido = false; conectar(); });
  conectar();
})();
`;
