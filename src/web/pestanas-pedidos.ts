/**
 * Las pestañas de «Pedidos GSG»: una sola entrada del menú para los pedidos
 * del día, la solicitud de ubicación (el antiguo «Automatización GSG») y sus
 * ajustes. Cada pestaña sigue siendo su propia página (/hoy y
 * /automatizacion-gsg): solo cambia cómo se llega a ellas.
 *
 * La solicitud de ubicación y los ajustes son de administradores, como antes:
 * para el resto del equipo esas pestañas no se ven.
 */

export const PESTANAS_PEDIDOS_CSS = `
.pp-pestanas { display: flex; gap: 4px; flex-wrap: wrap; border-bottom: 1px solid var(--borde); margin: 0 0 18px; }
.pp-pestanas a { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 10px 10px 0 0; color: var(--texto-suave); text-decoration: none; font-weight: 600; font-size: 14.5px; border: 1px solid transparent; border-bottom: none; margin-bottom: -1px; }
.pp-pestanas a:hover { color: var(--texto); background: var(--gris-suave); }
.pp-pestanas a.activa { color: var(--primario); background: var(--superficie); border-color: var(--borde); }
.pp-pestanas a:focus-visible { outline: 2px solid var(--primario); outline-offset: 2px; }
.pp-pestanas .pp-num { font-size: 12px; font-weight: 700; padding: 1px 8px; border-radius: 999px; background: var(--gris-suave); color: var(--gris); }
.pp-pestanas a.activa .pp-num { background: var(--primario-suave); color: var(--primario); }
@media (max-width: 640px) { .pp-pestanas a { padding: 10px 12px; font-size: 14px; } }
`;

export function pestanasPedidosHtml(): string {
  return `<nav class="pp-pestanas" aria-label="Pedidos GSG">
  <a href="/hoy" data-pp="pedidos">Pedidos</a>
  <a href="/automatizacion-gsg" data-pp="solicitud" data-pp-admin hidden>Solicitud de ubicación</a>
  <a href="/automatizacion-gsg#ajustes" data-pp="ajustes" data-pp-admin hidden>Ajustes de chat</a>
</nav>`;
}

export const PESTANAS_PEDIDOS_JS = String.raw`
(function () {
  function pestanaActual() {
    if (location.pathname === '/automatizacion-gsg') return location.hash === '#ajustes' ? 'ajustes' : 'solicitud';
    return 'pedidos';
  }
  window.marcarPestanaPedidos = function () {
    var actual = pestanaActual();
    document.querySelectorAll('.pp-pestanas a[data-pp]').forEach(function (a) {
      var activa = a.getAttribute('data-pp') === actual;
      a.classList.toggle('activa', activa);
      if (activa) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  };
  /* En la misma página, cambiar de pestaña es cambiar el ancla (abre o cierra los ajustes). */
  document.querySelectorAll('.pp-pestanas a[data-pp]').forEach(function (a) {
    a.addEventListener('click', function (ev) {
      var destino = new URL(a.href, location.href);
      if (destino.pathname !== location.pathname) return;
      ev.preventDefault();
      if (destino.hash) location.hash = destino.hash;
      else if (location.hash) location.hash = '';
      window.marcarPestanaPedidos();
    });
  });
  /* Al abrir Ajustes por el ancla, el navegador baja hasta la caja: las pestañas quedan a la vista. */
  window.pestanasArriba = function () { setTimeout(function () { if (window.scrollTo) window.scrollTo(0, 0); }, 30); };
  window.addEventListener('hashchange', window.marcarPestanaPedidos);
  window.marcarPestanaPedidos();
  fetch('/admin/yo', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (yo) {
    if (yo && yo.rol === 'admin') document.querySelectorAll('[data-pp-admin]').forEach(function (a) { a.hidden = false; });
  }).catch(function () {});
})();
`;
