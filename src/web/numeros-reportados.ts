/**
 * «Números reportados», en Pedidos GSG junto a la bandeja de errores: los
 * teléfonos y trackings malos que GSGchat le reportó a GSG (ver
 * src/entregas/reportados.ts), con su error, cuándo se reportó y si GSG ya
 * lo corrigió. Es la misma lista que GSG lee con GET /api/v1/reportados.
 *
 * El JS va pegado en el <script> de la página (sin framework): usa `$`,
 * `esc`, `toast` y `api` de la página, y `pedirDato` del armazón si está.
 */

export const NUMEROS_REPORTADOS_CSS = `
  .numeros-reportados { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); box-shadow: var(--sombra); padding: 14px 18px; margin-top: var(--esp-3); }
  .numeros-reportados .nada { color: var(--texto-suave); font-size: 13.5px; padding: 4px 0 2px; }
  .numeros-reportados h3 { margin: 0 0 4px; font-size: 15px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .numeros-reportados .insignia { display: inline-block; min-width: 22px; padding: 1px 8px; border-radius: 999px; background: var(--rojo); color: #fff; font-size: 12px; text-align: center; }
  .numeros-reportados .insignia.cero { background: var(--gris-suave); color: var(--gris); }
  .numeros-reportados .filtro-reportados { margin-left: auto; font-weight: 400; font-size: 13px; }
  .numeros-reportados .caso { display: flex; gap: 8px 16px; align-items: center; flex-wrap: wrap; padding: 10px 0; border-bottom: 1px solid var(--borde); }
  .numeros-reportados .caso:last-child { border-bottom: 0; padding-bottom: 0; }
  .numeros-reportados .caso .que { flex: 1 1 320px; min-width: 0; font-size: 14px; }
  .numeros-reportados .caso .sub { color: var(--texto-suave); font-size: var(--fs-small); margin-top: 2px; overflow-wrap: anywhere; }
  .numeros-reportados .caso .motivo { color: var(--texto); font-size: 13.5px; margin-top: 3px; overflow-wrap: anywhere; }
  .numeros-reportados .estado-rep { font-weight: 600; }
  .numeros-reportados .estado-rep.pendiente { color: var(--rojo); }
  .numeros-reportados .estado-rep.corregido { color: var(--verde, inherit); }
  /* El reporte a GSG es otra cosa que el estado del problema: se ve aparte. */
  .numeros-reportados .rep-gsg { display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 999px; font-size: 12px; border: 1px solid var(--borde); }
  .numeros-reportados .rep-gsg.reportado { color: var(--verde, inherit); }
  .numeros-reportados .rep-gsg.fallo, .numeros-reportados .rep-gsg.sin_confirmar { color: var(--rojo, inherit); }
`;

export function numerosReportadosHtml(): string {
  return `
<section class="numeros-reportados" id="numeros-reportados" aria-labelledby="numeros-reportados-titulo">
  <h3 id="numeros-reportados-titulo">Números reportados <span class="insignia cero" id="numeros-reportados-n">0</span>
    <label class="filtro-reportados">Ver <select id="numeros-reportados-filtro"><option value="pendiente">Pendientes de corregir</option><option value="corregido">Corregidos</option><option value="">Todos</option></select></label></h3>
  <p class="muted" style="margin:0 0 6px;font-size:13px">Teléfonos y trackings de GSG que no sirven (inválido, sin WhatsApp, envío fallido, tracking que falta, repetido o de otro pedido, teléfono de un motorizado, «no soy yo»). Se le reportan a GSG una sola vez; cuando GSG los corrige, se le vuelve a pedir la ubicación al número bueno.</p>
  <div id="numeros-reportados-lista"><div class="nada">Cargando…</div></div>
</section>`;
}

export const NUMEROS_REPORTADOS_JS = String.raw`
/* ------------------------------------------------ números reportados a GSG */
var reportadosMontada = true;
var reportadosItems = [];
function fechaReportado(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso; }
}
/**
 * El estado del reporte a GSG, aparte del estado del problema.
 *
 * «Corregido» lo decide GSG cuando manda el dato bueno; esto es otra cosa: si
 * GSG se entero del error. Solo dice «reportado» cuando GSG lo confirmo, no
 * cuando se puso en la cola.
 */
function repGsg(x) {
  if (!x.gsg) return '';
  return ' · <span class="rep-gsg ' + esc(x.gsg.estado) + '" title="' +
    esc(x.gsg.error || (x.gsg.enviadoEn ? 'GSG lo confirmó el ' + fechaReportado(x.gsg.enviadoEn) : 'Todavía no hay confirmación de GSG')) +
    '">' + esc(x.gsg.etiqueta) + (x.gsg.intentos > 1 ? ' (' + x.gsg.intentos + ' intentos)' : '') + '</span>';
}
/* Mandarlo a mano: solo cuando hace falta (nada que reportar si GSG ya lo confirmó). */
function botonReportar(x) {
  if (!x.gsg || x.gsg.estado === 'reportado' || x.gsg.estado === 'sin_incidencia') return '';
  var texto = x.gsg.estado === 'fallo' || x.gsg.estado === 'sin_confirmar' ? 'Reintentar reporte' : 'Reportar error a GSG';
  return '<button class="btn sm btn-reportar-gsg" type="button" data-clave="' + esc(x.clave) + '">' + texto + '</button>';
}
function pintarNumerosReportados(r) {
  var caja = $('numeros-reportados');
  if (!caja) return;
  reportadosItems = (r && r.items) || [];
  var filtro = $('numeros-reportados-filtro').value;
  var pendientes = reportadosItems.filter(function (x) { return x.estado === 'pendiente'; }).length;
  var n = $('numeros-reportados-n');
  n.textContent = String(filtro === 'pendiente' ? pendientes : reportadosItems.length);
  n.classList.toggle('cero', (filtro === 'pendiente' ? pendientes : reportadosItems.length) === 0);
  var lista = $('numeros-reportados-lista');
  if (!reportadosItems.length) {
    lista.innerHTML = '<div class="nada">' + (filtro === 'pendiente' ? 'No hay números pendientes de corregir.' : 'No hay números reportados.') + '</div>';
    return;
  }
  lista.innerHTML = reportadosItems.map(function (x) {
    var quien = x.tracking || x.referencia || x.clave;
    return '<div class="caso" data-clave="' + esc(x.clave) + '">' +
      '<div class="que"><b>' + esc(quien) + '</b> · ' + esc(x.telefono || 'sin teléfono') + ' · ' + esc(x.titulo || x.error) +
        '<div class="sub"><span class="estado-rep ' + esc(x.estado) + '">' + (x.estado === 'corregido' ? 'Corregido ' + esc(fechaReportado(x.corregidoAt)) : 'Pendiente de GSG') + '</span>' +
          ' · Reportado: ' + esc(fechaReportado(x.reportadoAt)) + ' · Error: <code>' + esc(x.error) + '</code>' + repGsg(x) + '</div>' +
        '<div class="motivo">' + esc(x.mensaje) + '</div>' +
      '</div>' +
      (x.estado === 'pendiente' ? '<button class="btn sm btn-corregir-reportado" type="button" data-clave="' + esc(x.clave) + '">Corregir</button>' : '') +
      botonReportar(x) +
    '</div>';
  }).join('');
}
async function cargarNumerosReportados() {
  if (!reportadosMontada) return;
  var caja = $('numeros-reportados');
  if (!caja) return;
  try {
    var estado = $('numeros-reportados-filtro').value;
    pintarNumerosReportados(await api('/admin/entregas/reportados' + (estado ? '?estado=' + encodeURIComponent(estado) : '')));
  } catch (e) {
    if (e.status === 404) { reportadosMontada = false; caja.classList.add('hidden'); return; }
    $('numeros-reportados-lista').innerHTML = '<div class="nada">No se pudo leer la lista: ' + esc(e.message) + '</div>';
  }
}
async function corregirNumeroReportado(clave) {
  var item = reportadosItems.filter(function (x) { return x.clave === clave; })[0];
  if (!item) return;
  var pedir = typeof pedirDato === 'function'
    ? function (o) { return pedirDato(o); }
    : function (o) { return Promise.resolve(window.prompt(o.titulo + '\n' + o.etiqueta) || ''); };
  var esTracking = String(item.error).indexOf('tracking') === 0;
  var valor = await pedir({ titulo: 'Corregir ' + (item.tracking || item.clave), etiqueta: esTracking ? 'Tracking correcto' : 'Teléfono correcto', boton: 'Corregir' });
  if (!valor) return;
  try {
    var cuerpo = esTracking ? { tracking: String(valor).trim() } : { telefono: String(valor).trim() };
    var r = await api('/admin/entregas/reportados/' + encodeURIComponent(clave) + '/correccion', { method: 'POST', body: cuerpo });
    toast((item.tracking || item.clave) + ': ' + (r.detalle || 'corregido.'));
  } catch (e) {
    toast((item.tracking || item.clave) + ': ' + e.message);
  } finally {
    await cargarNumerosReportados();
  }
}
/**
 * «Reportar error a GSG» a mano.
 *
 * Va por la misma cola que el envio automatico. El boton se deshabilita
 * mientras procesa: dos clics seguidos no mandan dos reportes (la clave
 * idempotente es la misma y el despacho hace fila).
 */
async function reportarAGsg(boton, clave) {
  var item = reportadosItems.filter(function (x) { return x.clave === clave; })[0];
  if (!item) return;
  var quien = item.tracking || item.clave;
  var ok = typeof confirmarDialogo === 'function'
    ? await confirmarDialogo({
        titulo: '¿Reportar este error a GSG?',
        texto: quien + ' · ' + (item.titulo || item.error) + '. ' + (item.mensaje || '') + ' Se le manda a GSG por su API, igual que lo haría el sistema solo.',
        boton: 'Sí, reportar',
      })
    : true;
  if (!ok) return;
  var antes = boton.textContent;
  boton.disabled = true;
  boton.textContent = 'Reportando…';
  try {
    var r = await api('/admin/entregas/reportados/' + encodeURIComponent(clave) + '/reportar-a-gsg', { method: 'POST', body: {} });
    toast(quien + ': ' + (r.detalle || (r.ok ? 'reportado.' : 'no se pudo reportar.')));
  } catch (e) {
    toast(quien + ': ' + e.message);
  } finally {
    boton.disabled = false;
    boton.textContent = antes;
    await cargarNumerosReportados();
  }
}
(function () {
  var lista = document.getElementById('numeros-reportados-lista');
  if (!lista) return;
  lista.addEventListener('click', function (ev) {
    var rep = ev.target.closest ? ev.target.closest('.btn-reportar-gsg') : null;
    if (rep && !rep.disabled) { reportarAGsg(rep, rep.getAttribute('data-clave')); return; }
    var b = ev.target.closest ? ev.target.closest('.btn-corregir-reportado') : null;
    if (!b || b.disabled) return;
    corregirNumeroReportado(b.getAttribute('data-clave'));
  });
  var filtro = document.getElementById('numeros-reportados-filtro');
  if (filtro) filtro.addEventListener('change', cargarNumerosReportados);
})();
`;
