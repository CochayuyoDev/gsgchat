/**
 * La pagina del motorizado, sin instalar nada: /m/<token>.
 *
 * Es lo que abre desde el enlace que le manda el coordinador por WhatsApp.
 * No hay sesion del panel: el token es la llave (uno por motorizado, caduca
 * a los 7 dias). Ensena sus pedidos de hoy en el orden de su ruta, con
 * botones grandes para el pulgar: abrir el mapa, dar los minutos, "estoy
 * cerca", "entregado", "no habia nadie", "no puedo". Cada boton entra por
 * el mismo camino que su respuesta por WhatsApp.
 *
 * Pensada para alguien en moto y con prisa: una sola columna, letra grande,
 * la parada siguiente destacada, botones de 56 px con icono y texto, minutos
 * con botones rapidos (15 · 30 · 45 · 60) ademas del campo, y "no puedo"
 * discreto y con doble toque.
 *
 * Esta pantalla NO lleva el armazon: no hay `.btn` ni `.chip` de shell.ts,
 * asi que su CSS es el de aqui (sobre los tokens, para que el modo oscuro
 * funcione igual).
 */
import { TEMA_SCRIPT, TOKENS_CSS } from './tokens.js';
import { escapeHtml } from './login-page.js';
import { estadosVisualesJs } from './estados-visuales.js';

export function motorizadoPage(opts: { token: string; nombreNegocio: string }): string {
  const negocio = opts.nombreNegocio || 'GSGchat';
  const inicial = escapeHtml((negocio.trim()[0] ?? 'G').toUpperCase());
  const script = String.raw`
var TOKEN = ${JSON.stringify(opts.token)};
var datos = null;
${estadosVisualesJs()}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function toast(t) { var el = document.createElement('div'); el.className = 'toast'; el.textContent = t; document.body.appendChild(el); setTimeout(function () { el.remove(); }, 3500); }
function aviso(texto, tono) {
  var a = document.getElementById('aviso');
  a.hidden = !texto;
  a.className = 'aviso' + (tono ? ' ' + tono : '');
  a.textContent = texto || '';
}

/* En que anda cada parada, en una sola frase. Sale de lo que de verdad falta
   hacer (las acciones que manda el servidor), no solo de la situacion: si ya
   dio su tiempo y el aviso al cliente aun no ha salido, no se le pide otra vez. */
function chipDe(p, acciones) {
  if (p.situacion === 'cerca') return '<span class="chip tono-verde">Ya avisaste que estás cerca</span>';
  if (p.situacion === 'con_hora') return '<span class="chip tono-azul">Cliente avisado: llega ' + esc(p.llega || '') + '</span>';
  if (acciones.indexOf('minutos') >= 0) return '<span class="chip tono-ambar">Falta decir en cuántos minutos</span>';
  return '<span class="chip tono-azul">Tu tiempo ya está anotado</span>';
}

function botonesDe(p, acciones) {
  var e = p.entrega;
  var ref = esc(e.referencia);
  var comun = ' data-ref="' + ref + '" data-entrega="' + e.id + '"';
  var html = '';
  if (p.mapa) html += '<a class="btn primario ancho" href="' + esc(p.mapa) + '" target="_blank" rel="noopener"><span class="ico" aria-hidden="true">🗺️</span>Abrir en Maps</a>';
  if (acciones.indexOf('minutos') >= 0) {
    html += '<div class="paso">¿En cuántos minutos lo entregas?</div><div class="rapidos">' +
      [15, 30, 45, 60].map(function (m) {
        return '<button class="btn" type="button" data-accion="minutos" data-minutos="' + m + '"' + comun + ' aria-label="Entrego en ' + m + ' minutos">' + m + '<small>min</small></button>';
      }).join('') + '</div>' +
      '<div class="minutos"><input type="number" inputmode="numeric" min="1" max="600" placeholder="Otra cantidad" data-min="' + e.id + '" aria-label="Minutos hasta entregar">' +
      '<button class="btn" type="button" data-accion="minutos"' + comun + '>Enviar</button></div>';
  }
  var cerca = acciones.indexOf('cerca') >= 0;
  var entregado = acciones.indexOf('entregado') >= 0;
  if (cerca) html += '<button class="btn ambar' + (entregado ? '' : ' ancho') + '" type="button" data-accion="cerca"' + comun + '><span class="ico" aria-hidden="true">📍</span>Estoy cerca</button>';
  if (entregado) html += '<button class="btn verde' + (cerca ? '' : ' ancho') + '" type="button" data-accion="entregado"' + comun + '><span class="ico" aria-hidden="true">✅</span>Entregado</button>';
  if (acciones.indexOf('no_estaba') >= 0) html += '<button class="btn ancho" type="button" data-accion="no_estaba"' + comun + '><span class="ico" aria-hidden="true">🚪</span>No había nadie</button>';
  if (acciones.indexOf('no_puedo') >= 0) html += '<div class="discreto"><button class="btn enlace" type="button" data-accion="no_puedo"' + comun + ' data-texto="No puedo llevarlo">No puedo llevarlo</button></div>';
  return html;
}

function tarjetaParada(p, primera) {
  var e = p.entrega;
  var acciones = (datos.acciones && datos.acciones[e.id]) || [];
  return '<div class="tarjeta' + (primera ? ' actual' : ' despues') + (e.prioridad === 'urgente' ? ' urgente' : '') + '" data-id="' + e.id + '">' +
    (primera ? '<span class="banda">Siguiente parada</span>' : '') +
    '<div class="cab"><span class="orden" aria-hidden="true">' + p.orden + '</span><span class="ref">' + esc(e.referencia) + '</span></div>' +
    '<div class="datos"><div class="quien">' + esc(e.nombre || 'Cliente') + (e.distrito ? ' <span class="muted">· ' + esc(e.distrito) + '</span>' : '') + '</div>' +
    (e.direccion ? '<div class="donde">' + esc(e.direccion) + '</div>' : '') +
    (e.notas ? '<div class="muted">Nota: ' + esc(e.notas) + '</div>' : '') +
    (p.distancia ? '<div class="muted">' + esc(p.distancia) + '</div>' : '') +
    '<div class="chips">' + chipDe(p, acciones) +
    (e.prioridad === 'urgente' ? chipEstado('entrega', 'urgente') : '') +
    (e.segundaVisita ? chipEstado('entrega', 'segunda_visita') : '') + '</div></div>' +
    '<div class="btns">' + botonesDe(p, acciones) + '</div>' +
    '<div class="respuesta" data-resp="' + e.id + '" aria-live="polite" hidden></div></div>';
}

function tarjetaSinPin(e) {
  return '<div class="tarjeta despues"><span class="banda gris">Esperando al cliente</span>' +
    '<div class="cab"><span class="ref">' + esc(e.referencia) + '</span></div>' +
    '<div class="datos"><div class="quien">' + esc(e.nombre || 'Cliente') + (e.distrito ? ' <span class="muted">· ' + esc(e.distrito) + '</span>' : '') + '</div>' +
    (e.direccion ? '<div class="donde">' + esc(e.direccion) + '</div>' : '') +
    '<div class="muted">En cuanto mande su pin te llega aquí y por WhatsApp.</div></div></div>';
}

/* Las paradas que puede hacer ya: la ruta trae tambien las que esperan el pin
   del cliente, y esas van una sola vez, abajo y sin botones. */
function paradasConPin() {
  var esperando = {};
  (datos.sinPin || []).forEach(function (e) { esperando[e.id] = true; });
  return (datos.ruta.paradas || []).filter(function (p) { return !esperando[p.entrega.id]; });
}

function pintar() {
  var lista = document.getElementById('lista');
  if (!datos) { lista.innerHTML = ''; return; }
  var paradas = paradasConPin();
  var esperan = datos.sinPin || [];
  if (!paradas.length && !esperan.length) {
    lista.innerHTML = '<div class="tarjeta vacio"><div class="ico" aria-hidden="true">🛵</div><h2>Hoy no tienes pedidos todavía</h2>Cuando el coordinador te mande uno, aparece aquí solo (y te llega por WhatsApp).</div>';
    return;
  }
  lista.innerHTML = paradas.map(function (p, i) { return tarjetaParada(p, i === 0); }).join('') + esperan.map(tarjetaSinPin).join('');
}

function pintarCabecera() {
  var n = paradasConPin().length;
  var esperan = (datos.sinPin || []).length;
  document.getElementById('titulo').textContent = 'Hola, ' + (datos.motorizado.nombre.split(' ')[0] || datos.motorizado.nombre);
  document.getElementById('sub').textContent =
    (n ? (n === 1 ? 'Te queda 1 pedido' : 'Te quedan ' + n + ' pedidos') : 'Sin pedidos en camino') +
    (esperan ? ' · ' + esperan + ' esperando ubicación' : '') + ' · ' + datos.negocio;
  // Solo se avisa del enlace cuando de verdad urge pedir uno nuevo.
  var dias = datos.venceAt ? Math.ceil((new Date(datos.venceAt).getTime() - Date.now()) / 86400000) : null;
  document.getElementById('vence').textContent = dias !== null && dias <= 2
    ? (dias <= 0 ? 'Tu enlace vence hoy: pídele uno nuevo al coordinador.' : 'Tu enlace vence en ' + dias + (dias === 1 ? ' día' : ' días') + ': pídele uno nuevo al coordinador.')
    : '';
}

async function cargar(automatico) {
  // El refresco de fondo no puede borrar lo que está escribiendo ni trabajar con la pantalla apagada.
  if (automatico && (document.hidden || (document.activeElement && document.activeElement.tagName === 'INPUT'))) return;
  try {
    var r = await fetch('/m/' + encodeURIComponent(TOKEN) + '/datos', { headers: { accept: 'application/json' }, cache: 'no-store' });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok || !j.ok) {
      datos = null;
      pintar();
      document.getElementById('sub').textContent = '';
      document.getElementById('vence').textContent = '';
      aviso(j.error || j.motivo || 'No se pudo cargar.', 'rojo');
      return;
    }
    datos = j;
    aviso('');
    pintarCabecera();
    pintar();
  } catch (e) {
    // Sin conexión se deja en pantalla lo último que se sabe: le sirve más que una pantalla en blanco.
    aviso('Sin conexión. Vuelve a intentar en un momento.', 'rojo');
  }
}

/* Los minutos que ha escrito a mano para esta parada, si el boton es el de "Enviar". */
function minutosEscritos(boton) {
  var inp = document.querySelector('[data-min="' + boton.getAttribute('data-entrega') + '"]');
  var min = Number(inp && inp.value);
  if (!min || min < 1 || min > 600) { toast('Escribe los minutos que te faltan (de 1 a 600).'); if (inp) inp.focus(); return null; }
  return min;
}

/* "No puedo" pide dos toques: es el unico boton que le quita el pedido. */
function pideConfirmar(b) {
  if (b.getAttribute('data-accion') !== 'no_puedo' || b.getAttribute('data-confirmado') === '1') return false;
  b.setAttribute('data-confirmado', '1');
  b.textContent = '¿Seguro? Toca otra vez para pasarlo a otro';
  setTimeout(function () {
    if (!b.isConnected) return;
    b.removeAttribute('data-confirmado');
    b.textContent = b.getAttribute('data-texto');
  }, 5000);
  return true;
}

function mostrarRespuesta(entregaId, texto) {
  var destino = document.querySelector('[data-resp="' + entregaId + '"]');
  if (destino) { destino.hidden = false; destino.textContent = texto; return; }
  // El pedido ya no está en la lista (entregado, pasado a otro): va arriba.
  aviso(texto, 'verde');
}

document.addEventListener('click', async function (ev) {
  var b = ev.target && ev.target.closest ? ev.target.closest('[data-accion]') : null;
  if (!b) return;
  var accion = b.getAttribute('data-accion');
  var entregaId = b.getAttribute('data-entrega');
  var cuerpo = { accion: accion, referencia: b.getAttribute('data-ref') };
  if (accion === 'minutos') {
    var rapidos = b.getAttribute('data-minutos');
    cuerpo.minutos = rapidos ? Number(rapidos) : minutosEscritos(b);
    if (!cuerpo.minutos) return;
  }
  if (pideConfirmar(b)) return;
  b.disabled = true;
  try {
    var r = await fetch('/m/' + encodeURIComponent(TOKEN) + '/accion', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(cuerpo) });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok || !j.ok) { toast(j.error || j.motivo || 'No se pudo.'); b.disabled = false; return; }
    if (!j.respuesta) toast(accion === 'minutos' ? 'Anotado: ' + cuerpo.minutos + ' minutos. Al cliente se le avisa la hora.' : 'Anotado.');
    await cargar(false);
    if (j.respuesta) mostrarRespuesta(entregaId, j.respuesta);
  } catch (e) {
    toast('Sin conexión. Vuelve a intentar.');
    b.disabled = false;
  }
});
document.getElementById('recargar').onclick = function () { cargar(false); };
cargar(false);
setInterval(function () { cargar(true); }, 60000);
`;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
${TEMA_SCRIPT}
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#0a7f55">
<title>Mis pedidos de hoy · ${escapeHtml(negocio)}</title>
<style>
${TOKENS_CSS}
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--texto); font: 17px/1.45 var(--fuente); -webkit-text-size-adjust: 100%; }
  body { padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom); }
  .wrap { max-width: 560px; margin: 0 auto; padding: var(--esp-4); }
  header { display: flex; align-items: center; gap: var(--esp-3); margin-bottom: var(--esp-4); }
  header .logo { width: 44px; height: 44px; border-radius: 12px; background: var(--primario); color: var(--primario-texto); display: grid; place-items: center; font-weight: 800; font-size: 22px; flex: none; }
  header h1 { font-size: 24px; margin: 0; line-height: 1.2; }
  header p { margin: 3px 0 0; color: var(--texto-suave); font-size: 15px; }
  .aviso { background: var(--ambar-suave); color: var(--ambar); border-radius: var(--radio-sm); padding: var(--esp-3) var(--esp-4); margin-bottom: var(--esp-4); font-weight: 600; }
  .aviso.rojo { background: var(--rojo-suave); color: var(--rojo); }
  .aviso.verde { background: var(--verde-suave); color: var(--verde); }

  .tarjeta { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); box-shadow: var(--sombra); padding: var(--esp-4); margin-bottom: var(--esp-4); }
  /* La parada siguiente se ve desde lejos; las demás quedan en segundo plano. */
  .tarjeta.actual { border-color: var(--primario); box-shadow: 0 0 0 3px var(--primario-suave), var(--sombra-2); }
  .tarjeta.urgente { border-color: var(--rojo); }
  .banda { display: inline-block; margin: -4px 0 var(--esp-2); padding: 3px 10px; border-radius: 999px; background: var(--primario-suave); color: var(--primario); font-size: 13px; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; }
  .banda.gris { background: var(--gris-suave); color: var(--gris); }
  .cab { display: flex; align-items: center; gap: var(--esp-2); flex-wrap: wrap; }
  .orden { width: 34px; height: 34px; border-radius: 50%; background: var(--primario); color: var(--primario-texto); display: inline-grid; place-items: center; font-weight: 700; flex: none; font-size: 17px; }
  .tarjeta.despues .orden { background: var(--gris-suave); color: var(--gris); }
  .ref { font-size: 24px; font-weight: 800; }
  .chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 999px; font-size: 13px; font-weight: 600; line-height: 1.5; background: var(--gris-suave); color: var(--gris); }
  .chip::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; opacity: .9; }
  .chip.tono-verde { background: var(--verde-suave); color: var(--verde); }
  .chip.tono-ambar { background: var(--ambar-suave); color: var(--ambar); }
  .chip.tono-rojo { background: var(--rojo-suave); color: var(--rojo); }
  .chip.tono-azul { background: var(--azul-suave); color: var(--azul); }
  .chip.tono-gris { background: var(--gris-suave); color: var(--gris); }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: var(--esp-2); }
  .datos { margin: var(--esp-2) 0 var(--esp-3); }
  .datos .quien { font-size: 19px; font-weight: 700; }
  .datos .donde { font-size: 17px; }
  .datos .muted { color: var(--texto-suave); font-size: 15px; }

  /* Botones para el pulgar: 56 px, icono y texto, y los de minutos a cuatro por fila. */
  .btns { display: grid; grid-template-columns: 1fr 1fr; gap: var(--esp-2); }
  .btn { min-height: 56px; border-radius: var(--radio); border: 1px solid var(--borde); background: var(--superficie); color: var(--texto); font: inherit; font-size: 17px; font-weight: 700; padding: 10px 14px; cursor: pointer; text-align: center; text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 8px; -webkit-tap-highlight-color: transparent; }
  .btn:active { transform: scale(.985); }
  .btn .ico { font-size: 22px; line-height: 1; }
  .btn.primario { background: var(--primario); border-color: var(--primario); color: var(--primario-texto); }
  .btn.verde { background: var(--verde); border-color: var(--verde); color: #fff; }
  .btn.ambar { background: var(--ambar-suave); border-color: var(--ambar); color: var(--ambar); }
  .btn.ancho { grid-column: 1 / -1; }
  .btn:disabled { opacity: .5; cursor: default; }
  .paso { grid-column: 1 / -1; font-size: 15px; color: var(--texto-suave); margin: var(--esp-2) 0 -2px; font-weight: 600; }
  .rapidos { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--esp-2); }
  .rapidos .btn { min-height: 52px; padding: 6px 4px; font-size: 18px; }
  .rapidos .btn small { font-size: 12px; font-weight: 600; color: var(--texto-suave); }
  .minutos { display: flex; gap: var(--esp-2); grid-column: 1 / -1; }
  .minutos input { flex: 1; min-width: 0; min-height: 56px; border: 1px solid var(--borde); border-radius: var(--radio); padding: 0 14px; font: inherit; font-size: 20px; background: var(--superficie); color: var(--texto); }
  .minutos .btn { min-width: 120px; }
  .discreto { grid-column: 1 / -1; display: flex; justify-content: flex-end; margin-top: var(--esp-1); }
  .btn.enlace { min-height: 44px; border: 0; background: transparent; color: var(--rojo); font-weight: 600; font-size: 15px; padding: 8px 6px; }
  .btn.enlace[data-confirmado="1"] { background: var(--rojo-suave); border-radius: var(--radio-sm); }
  .respuesta { margin-top: var(--esp-3); padding: var(--esp-3); border-radius: var(--radio-sm); background: var(--superficie-2); font-size: 15px; white-space: pre-wrap; }

  .vacio { text-align: center; padding: var(--esp-6) var(--esp-4); color: var(--texto-suave); }
  .vacio .ico { font-size: 40px; line-height: 1; margin-bottom: var(--esp-2); }
  .vacio h2 { color: var(--texto); font-size: 20px; margin: 0 0 var(--esp-2); }
  footer { color: var(--texto-suave); font-size: 14px; text-align: center; padding: var(--esp-4) 0 var(--esp-6); }
  footer button { background: none; border: none; color: var(--primario); font: inherit; font-size: 14px; font-weight: 600; text-decoration: underline; cursor: pointer; min-height: 44px; }
  footer #vence:not(:empty) { display: block; margin-top: var(--esp-2); color: var(--ambar); font-weight: 600; }
  .toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); background: var(--texto); color: var(--bg); padding: 12px 18px; border-radius: 999px; font-weight: 600; max-width: 92vw; text-align: center; z-index: 9; }
  @media (min-width: 600px) { html, body { font-size: 16px; } }
</style>
</head>
<body>
<div class="wrap">
  <header><div class="logo" aria-hidden="true">${inicial}</div><div><h1 id="titulo">Mis pedidos de hoy</h1><p id="sub">Cargando…</p></div></header>
  <div id="aviso" class="aviso" role="status" aria-live="polite" hidden></div>
  <div id="lista"></div>
  <footer>Se actualiza sola cada minuto. <button type="button" id="recargar">Actualizar ahora</button><span id="vence"></span></footer>
</div>
<script>
${script}
</script>
</body>
</html>`;
}
