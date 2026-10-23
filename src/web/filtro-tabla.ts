/** Búsqueda y filtro por estado para las tablas del panel (solo vista: no toca los datos). */
export const FILTRO_TABLA_JS = String.raw`
window.filtroDeTabla = function (caja) {
  if (!caja) return;
  var barra = caja.previousElementSibling && caja.previousElementSibling.classList.contains('filtro-tabla') ? caja.previousElementSibling : null;
  var filas = Array.prototype.slice.call(caja.querySelectorAll('tbody tr'));
  if (!filas.length) { if (barra) barra.hidden = true; return; }
  function estadoDe(fila) {
    var chip = fila.querySelector('.chip:not(.sin-punto)');
    return chip ? chip.textContent.split(' · ')[0].trim() : '';
  }
  if (!barra) {
    barra = document.createElement('div');
    barra.className = 'filtro-tabla';
    barra.innerHTML = '<input type="search" placeholder="Buscar en la tabla" aria-label="Buscar en la tabla" autocomplete="off"><select aria-label="Filtrar por estado"></select><span class="filtro-cuenta" role="status"></span>';
    caja.parentNode.insertBefore(barra, caja);
    var otra = function () { window.filtroDeTabla(caja); };
    barra.querySelector('input').addEventListener('input', otra);
    barra.querySelector('select').addEventListener('change', otra);
  }
  barra.hidden = false;
  var lista = barra.querySelector('select'), elegido = lista.value;
  var estados = [];
  filas.forEach(function (f) { var e = estadoDe(f); if (e && estados.indexOf(e) < 0) estados.push(e); });
  lista.innerHTML = '<option value="">Todos los estados</option>' + estados.map(function (e) {
    return '<option value="' + e.replace(/"/g, '&quot;') + '">' + e.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</option>';
  }).join('');
  lista.value = estados.indexOf(elegido) >= 0 ? elegido : '';
  lista.hidden = estados.length < 2;
  var q = barra.querySelector('input').value.trim().toLowerCase(), visibles = 0;
  filas.forEach(function (f) {
    var ok = (!lista.value || estadoDe(f) === lista.value) && (!q || f.textContent.toLowerCase().indexOf(q) >= 0);
    f.hidden = !ok;
    if (ok) visibles++;
  });
  barra.querySelector('.filtro-cuenta').textContent = visibles === filas.length ? filas.length + ' filas' : visibles + ' de ' + filas.length;
};
`;

export const FILTRO_TABLA_CSS = `
  .filtro-tabla { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 4px 0 8px; }
  .filtro-tabla[hidden] { display: none; }
  .filtro-tabla input[type="search"] { flex: 1 1 200px; max-width: 320px; min-height: var(--alto-control-sm); }
  .filtro-tabla select { flex: 0 0 auto; min-height: var(--alto-control-sm); }
  .filtro-tabla .filtro-cuenta { margin-left: auto; font-size: var(--fs-small); color: var(--texto-suave); }
  tbody tr[hidden] { display: none; }
`;
