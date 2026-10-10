/**
 * La bandeja de errores de mensajes, dentro de Hoy: los pedidos de ESTA
 * tienda cuyo primer mensaje al cliente no salio (ver
 * src/entregas/primer-mensaje.ts), con su motivo y el boton «Reintentar
 * mensaje». Y el formato de los errores HTTP que ensenan las pantallas: el
 * codigo y el mensaje del servidor tal cual, nunca un «error» generico.
 *
 * El JS va pegado en el <script> de la pagina (sin framework): usa `$`,
 * `esc`, `toast` y `api` de la pagina, y `confirmarDialogo` del armazon.
 */

/**
 * `mensajeDeErrorHttp(status, statusText, body)`: «HTTP 409 · <error del
 * servidor>» y, si trae `detalles` [{campo, mensaje}] que el texto aun no
 * dice, « · campo: mensaje». Sin cuerpo JSON, el statusText.
 */
export const MENSAJE_ERROR_HTTP_JS = String.raw`
function mensajeDeErrorHttp(status, statusText, body) {
  var texto = body && typeof body === 'object' && typeof body.error === 'string' && body.error ? body.error : (statusText || 'sin detalle');
  var extra = '';
  if (body && typeof body === 'object' && Array.isArray(body.detalles)) {
    extra = body.detalles.slice(0, 5).filter(function (d) {
      return d && d.campo && texto.indexOf(d.campo) < 0;
    }).map(function (d) { return ' · ' + d.campo + ': ' + (d.mensaje || ''); }).join('');
  }
  return 'HTTP ' + status + ' · ' + texto + extra;
}
`;

/** La misma funcion que se pega en las paginas, para usarla (y probarla) desde TS. */
export const mensajeDeErrorHttp = new Function(`${MENSAJE_ERROR_HTTP_JS}\nreturn mensajeDeErrorHttp;`)() as (status: number, statusText: string, body: unknown) => string;

export const BANDEJA_MENSAJES_CSS = `
  .bandeja-mensajes { background: var(--superficie); border: 1px solid var(--ambar); border-radius: var(--radio); padding: 14px 18px; margin-top: var(--esp-3); }
  .bandeja-mensajes h3 { margin: 0 0 4px; font-size: 15px; display: flex; align-items: center; gap: 8px; }
  .bandeja-mensajes .insignia { display: inline-block; min-width: 22px; padding: 1px 8px; border-radius: 999px; background: var(--rojo); color: #fff; font-size: 12px; text-align: center; }
  .bandeja-mensajes .insignia.cero { background: var(--gris-claro); color: var(--texto); }
  .bandeja-mensajes .caso { display: flex; gap: 8px 16px; align-items: center; flex-wrap: wrap; padding: 10px 0; border-bottom: 1px solid var(--borde); }
  .bandeja-mensajes .caso:last-child { border-bottom: 0; padding-bottom: 0; }
  .bandeja-mensajes .caso .que { flex: 1 1 320px; min-width: 0; font-size: 14px; }
  .bandeja-mensajes .caso .sub { color: var(--texto-suave); font-size: var(--fs-small); margin-top: 2px; overflow-wrap: anywhere; }
  .bandeja-mensajes .caso .motivo { color: var(--texto); font-size: 13.5px; margin-top: 3px; overflow-wrap: anywhere; }
  .bandeja-mensajes .estado-msg { font-weight: 600; }
  .bandeja-mensajes .estado-msg.fallido { color: var(--rojo); }
  .bandeja-mensajes .estado-msg.incierto { color: var(--ambar); }
  .bandeja-mensajes .estado-msg.en-curso { color: var(--azul); }
`;

export function bandejaMensajesHtml(): string {
  return `
<section class="bandeja-mensajes hidden" id="bandeja-mensajes" aria-labelledby="bandeja-mensajes-titulo">
  <h3 id="bandeja-mensajes-titulo">Mensajes que no salieron <span class="insignia cero" id="bandeja-mensajes-n">0</span></h3>
  <p class="muted" style="margin:0 0 6px;font-size:13px">Pedidos guardados cuyo primer mensaje al cliente falló. El pedido sigue en Hoy; aquí se reintenta solo el mensaje.</p>
  <div id="bandeja-mensajes-lista"><div class="nada">Cargando…</div></div>
</section>`;
}

export const BANDEJA_MENSAJES_JS = String.raw`
/* ------------------------------------------------ bandeja de errores de mensajes */
var bandejaMontada = true;
var bandejaEnVuelo = {};
var bandejaItems = [];
var MENSAJE_EN_CURSO = { pendiente: 1, encolado: 1, enviando: 1, reintentando: 1 };

function fechaCorta(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return iso; }
}
function estadoMensajeEnPalabras(m) {
  if (m.estado === 'fallido') return { texto: m.permanente ? 'Falló (no se reintenta solo)' : 'Falló', clase: 'fallido' };
  if (m.estado === 'incierto') return { texto: 'Incierto: no se sabe si le llegó', clase: 'incierto' };
  if (m.estado === 'reintentando') return { texto: 'Reintentando automáticamente' + (m.proximoIntentoEn ? ' (próximo intento ' + hora(m.proximoIntentoEn) + ')' : ''), clase: 'en-curso' };
  if (m.estado === 'pendiente') return { texto: 'Pendiente de enviar', clase: 'en-curso' };
  if (m.estado === 'encolado') return { texto: 'En cola', clase: 'en-curso' };
  if (m.estado === 'enviando') return { texto: 'Enviando', clase: 'en-curso' };
  if (m.estado === 'enviado') return { texto: 'Enviado', clase: '' };
  return { texto: m.estado, clase: '' };
}
function botonBandeja(item) {
  var m = item.mensaje;
  var enVuelo = Boolean(bandejaEnVuelo[item.id]);
  var enCurso = Boolean(MENSAJE_EN_CURSO[m.estado]);
  var activo = m.puedeReintentar && !enVuelo && !enCurso;
  var texto = enVuelo ? 'Reintentando…' : enCurso ? 'En curso…' : 'Reintentar mensaje';
  return '<button class="btn sm btn-reintentar-mensaje" type="button" data-id="' + esc(item.id) + '"' + (activo ? '' : ' disabled aria-disabled="true"') + '>' + texto + '</button>';
}
function pintarBandejaMensajes(r) {
  var caja = $('bandeja-mensajes');
  if (!caja) return;
  bandejaItems = (r && r.items) || [];
  var n = $('bandeja-mensajes-n');
  n.textContent = String(bandejaItems.length);
  n.classList.toggle('cero', bandejaItems.length === 0);
  caja.classList.remove('hidden');
  var lista = $('bandeja-mensajes-lista');
  if (!bandejaItems.length) {
    lista.innerHTML = '<div class="nada">Todos los primeros mensajes salieron: no hay nada que reintentar.</div>';
    return;
  }
  lista.innerHTML = bandejaItems.map(function (item) {
    var m = item.mensaje;
    var est = estadoMensajeEnPalabras(m);
    return '<div class="caso" data-id="' + esc(item.id) + '">' +
      '<div class="que"><b>' + esc(item.referencia) + '</b> · ' + esc(item.nombre || 'Sin nombre') + ' · ' + esc(telefonoBonito(item.telefono)) +
        '<div class="sub"><span class="estado-msg ' + est.clase + '">' + esc(est.texto) + '</span>' +
          ' · Último intento: ' + esc(fechaCorta(m.ultimoIntentoEn)) + ' · Intentos: ' + esc(m.intentos) + '</div>' +
        (m.motivo ? '<div class="motivo">' + esc(m.motivo) + '</div>' : '') +
      '</div>' +
      botonBandeja(item) +
    '</div>';
  }).join('');
}
async function cargarBandejaMensajes() {
  if (!bandejaMontada) return;
  var caja = $('bandeja-mensajes');
  if (!caja) return;
  try {
    pintarBandejaMensajes(await api('/admin/entregas/mensajes/errores'));
  } catch (e) {
    if (e.status === 404) { bandejaMontada = false; caja.classList.add('hidden'); return; }
    caja.classList.remove('hidden');
    $('bandeja-mensajes-lista').innerHTML = '<div class="nada">No se pudo leer la bandeja: ' + esc(e.message) + '</div>';
  }
}
async function reintentarMensajeBandeja(id) {
  var item = bandejaItems.filter(function (x) { return String(x.id) === String(id); })[0];
  if (!item || bandejaEnVuelo[id]) return;
  var cuerpo = {};
  if (item.mensaje.requiereConfirmar) {
    var si = await confirmarDialogo({
      titulo: '¿Reintentar el mensaje de ' + item.referencia + '?',
      texto: 'No se sabe si el mensaje anterior le llegó a ' + (item.nombre || item.telefono) + '. Revisa su chat antes: si ya lo tiene, reintentar se lo mandaría dos veces.',
      boton: 'No lo tiene: reintentar',
      cancelar: 'Revisar primero'
    });
    if (!si) return;
    cuerpo.confirmarIncierto = true;
  }
  bandejaEnVuelo[id] = true;
  pintarBandejaMensajes({ items: bandejaItems });
  try {
    var r = await api('/admin/entregas/' + encodeURIComponent(id) + '/mensaje/reintentar', { method: 'POST', body: cuerpo });
    toast(item.referencia + ': ' + (r.detalle || 'reintento en marcha.'));
  } catch (e) {
    toast(item.referencia + ': ' + e.message);
  } finally {
    delete bandejaEnVuelo[id];
    await cargarBandejaMensajes();
  }
}
(function () {
  var lista = document.getElementById('bandeja-mensajes-lista');
  if (!lista) return;
  lista.addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('.btn-reintentar-mensaje') : null;
    if (!b || b.disabled) return;
    b.disabled = true;
    reintentarMensajeBandeja(b.getAttribute('data-id'));
  });
})();
`;
