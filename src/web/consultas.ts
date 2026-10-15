/** Lecturas del panel: una petición por URL, espera ante errores y sondeo visible. */
export const CONSULTAS_JS = String.raw`
(function () {
  var pendientes = new Map(), fallos = new Map(), copias = new Map(), sesionTerminada = null;
  window.leerPanel = function (url) {
    if (sesionTerminada) return Promise.reject(sesionTerminada);
    if (pendientes.has(url)) return pendientes.get(url);
    var anterior = fallos.get(url);
    if (anterior && Date.now() < anterior.hasta) return Promise.reject(anterior.error);
    var controller = new AbortController();
    var reloj = setTimeout(function () { controller.abort(); }, 20000);
    var consulta = Promise.resolve().then(function () {
      var copia = copias.get(url);
      return fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: copia ? { 'if-none-match': copia.etag } : {} });
    }).then(async function (r) {
      if (r.status === 304 && copias.has(url)) { fallos.delete(url); return copias.get(url).data; }
      var data = await r.json().catch(function () { return {}; });
      if (!r.ok) {
        var e = new Error(data.error || 'No se pudo consultar (' + r.status + ').');
        e.status = r.status; e.codigo = data.codigo || null; e.ir = data.ir || null;
        var segundos = Number(r.headers.get('retry-after'));
        if (segundos > 0) e.retryAfterMs = segundos * 1000;
        if (r.status === 401) {
          copias.clear();
          sesionTerminada = e;
          location.href = '/login?next=' + encodeURIComponent(location.pathname + location.hash);
        }
        throw e;
      }
      fallos.delete(url);
      var etag = r.headers.get('etag');
      if (etag) {
        if (copias.size >= 8 && !copias.has(url)) copias.delete(copias.keys().next().value);
        copias.set(url, { etag: etag, data: data });
      }
      return data;
    }).catch(function (error) {
      if (error.name === 'AbortError') error = new Error('La consulta tardó demasiado. Se volverá a intentar más adelante.');
      var veces = (anterior ? anterior.veces : 0) + 1;
      var espera = Math.max(Math.min(15000 * Math.pow(2, veces - 1), 120000), error.retryAfterMs || 0);
      if (fallos.size >= 100 && !fallos.has(url)) fallos.delete(fallos.keys().next().value);
      fallos.set(url, { veces: veces, hasta: Date.now() + espera, error: error });
      throw error;
    }).finally(function () { clearTimeout(reloj); pendientes.delete(url); });
    pendientes.set(url, consulta);
    return consulta;
  };
  window.sondearPanel = function (tarea, intervalo, inmediato) {
    var reloj = null, trabajando = false, detenido = false;
    function programar() {
      clearTimeout(reloj);
      if (!detenido && !document.hidden && !sesionTerminada) reloj = setTimeout(ejecutar, intervalo);
    }
    async function ejecutar() {
      if (detenido || document.hidden || sesionTerminada || trabajando) return;
      trabajando = true;
      try { await tarea(); } catch (e) { /* cada pantalla presenta su propio estado */ }
      finally { trabajando = false; programar(); }
    }
    function visibilidad() { clearTimeout(reloj); if (!document.hidden) ejecutar(); }
    document.addEventListener('visibilitychange', visibilidad);
    if (inmediato) ejecutar(); else programar();
    return function () { detenido = true; clearTimeout(reloj); document.removeEventListener('visibilitychange', visibilidad); };
  };
})();
`;
