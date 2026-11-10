/**
 * Libro de Reclamaciones virtual: el formulario publico (/libro-de-reclamaciones),
 * la constancia que se lleva el consumidor y la pantalla donde el
 * superadministrador los lee y responde (/reclamos-recibidos).
 *
 * Usa el mismo armazon que las paginas legales (cabecera, menu y pie con
 * razon social, RUC y domicilio). El JS de cliente va en String.raw: sin
 * backticks ni ${ dentro.
 */

import { pagina, type DatosLegales } from './legal-pages.js';
import { venceEl, type Reclamo } from '../plataforma/reclamos.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const fechaLima = (d: Date) =>
  d.toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const diaLima = (d: Date) => d.toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' });

const ESTILO = `<style>
  [hidden] { display: none !important; }
  form.libro { display: grid; gap: 18px; }
  a.boton { text-decoration: none; display: inline-block; }
  fieldset { border: 1px solid var(--borde); border-radius: 10px; padding: 14px 16px 16px; margin: 0; min-width: 0; }
  legend { font-weight: 700; padding: 0 6px; }
  .campos { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: 12px 14px; }
  .campo { display: grid; gap: 4px; min-width: 0; }
  .campo.ancho { grid-column: 1 / -1; }
  label { font-size: 14px; font-weight: 600; }
  .opcional { font-weight: 400; color: var(--suave); }
  input, select, textarea { font: inherit; color: var(--texto); background: var(--papel); border: 1px solid var(--borde); border-radius: 8px; padding: 9px 10px; width: 100%; min-width: 0; }
  textarea { min-height: 110px; resize: vertical; }
  input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible { outline: 2px solid var(--primario); outline-offset: 2px; }
  .elige { display: flex; flex-wrap: wrap; gap: 8px 18px; }
  .elige label { font-weight: 500; display: inline-flex; gap: 8px; align-items: center; }
  .elige input, .check input { width: auto; }
  .check { display: flex; gap: 10px; align-items: flex-start; font-weight: 500; }
  .nota { font-size: 14px; color: var(--suave); margin: 4px 0 0; }
  .defs { font-size: 14px; color: var(--suave); background: var(--fondo); border: 1px solid var(--borde); border-radius: 8px; padding: 10px 12px; margin: 0; }
  .boton { font: inherit; font-weight: 700; border: 0; border-radius: 8px; padding: 11px 18px; background: var(--primario); color: #fff; cursor: pointer; }
  .boton.sec { background: transparent; color: var(--primario); border: 1px solid var(--borde); }
  .boton[disabled] { opacity: .6; cursor: progress; }
  .error { color: #b42318; font-weight: 600; min-height: 1.4em; margin: 0; }
  .hoja { border: 1px solid var(--borde); border-radius: 10px; padding: 4px 16px 12px; }
  .codigo { font-size: 22px; font-weight: 800; letter-spacing: .02em; }
  .acciones { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
  .reclamo { border: 1px solid var(--borde); border-radius: 10px; padding: 12px 16px; margin: 0 0 14px; }
  .reclamo h2 { margin: 0 0 4px; font-size: 17px; }
  .chip { display: inline-block; font-size: 12px; font-weight: 700; border-radius: 999px; padding: 2px 10px; border: 1px solid var(--borde); }
  .chip.pendiente { color: #b54708; border-color: #f5c58a; background: #fff6ea; }
  .chip.respondido { color: var(--primario); }
  @media (prefers-color-scheme: dark) { .chip.pendiente { background: transparent; color: #fdb022; border-color: #7a4a10; } }
  @media print { header nav, .acciones, footer { display: none; } main { border: 0; } }
</style>`;

/** La hoja que se lleva el consumidor (y la que ve el superadministrador). */
export function hojaReclamo(r: Reclamo, d: DatosLegales): string {
  const fila = (k: string, v: string | null | undefined) => (v ? `<tr><th>${k}</th><td>${esc(v)}</td></tr>` : '');
  return `<div class="hoja">
<p>Hoja de reclamación N.º <span class="codigo">${esc(r.codigo)}</span></p>
<table>
${fila('Fecha', fechaLima(r.createdAt))}
${fila('Proveedor', [d.razonSocial || d.nombreComercial, d.ruc && `RUC ${d.ruc}`, d.direccion].filter(Boolean).join(' · '))}
<tr><th colspan="2">1. Identificación del consumidor reclamante</th></tr>
${fila('Nombre', r.nombre)}
${fila('Documento', `${r.documentoTipo} ${r.documentoNumero}`)}
${fila('Domicilio', r.domicilio)}
${fila('Teléfono', r.telefono)}
${fila('Correo', r.correo)}
${r.menorDeEdad ? fila('Padre, madre o apoderado', r.apoderado) : ''}
<tr><th colspan="2">2. Identificación del bien contratado</th></tr>
${fila('Tipo', r.bienTipo === 'producto' ? 'Producto' : 'Servicio')}
${fila('Monto reclamado', r.monto)}
${fila('Descripción', r.bienDescripcion)}
<tr><th colspan="2">3. Detalle de la reclamación y pedido del consumidor</th></tr>
${fila('Tipo', r.tipo === 'reclamo' ? 'Reclamo' : 'Queja')}
${fila('Detalle', r.detalle)}
${fila('Pedido', r.pedido)}
<tr><th colspan="2">4. Observaciones y acciones adoptadas por el proveedor</th></tr>
${r.respuesta ? fila(`Respuesta (${r.respondidoAt ? diaLima(r.respondidoAt) : ''})`, r.respuesta) : fila('Estado', `Pendiente. Responderemos a tu correo a más tardar el ${diaLima(venceEl(r.createdAt))}.`)}
</table>
</div>`;
}

export function libroReclamacionesPage(d: DatosLegales): string {
  return pagina('Libro de Reclamaciones', d, `
<h1>Libro de Reclamaciones</h1>
<p class="fecha">${esc(d.razonSocial || d.nombreComercial)}${d.ruc ? ` · RUC ${esc(d.ruc)}` : ''}${d.direccion ? ` · ${esc(d.direccion)}` : ''}</p>
<p>Conforme al Código de Protección y Defensa del Consumidor (Ley N.º 29571), aquí puedes registrar un reclamo o una queja. Al enviarla recibes en pantalla tu hoja con su número, para guardarla o imprimirla. Te responderemos a tu correo en un plazo máximo de <b>15 días hábiles</b>.</p>

<form class="libro" id="libro" novalidate>
  <fieldset>
    <legend>1. Tus datos</legend>
    <div class="campos">
      <div class="campo ancho"><label for="nombre">Nombre completo</label><input id="nombre" name="nombre" autocomplete="name" required maxlength="191"></div>
      <div class="campo"><label for="documentoTipo">Tipo de documento</label>
        <select id="documentoTipo" name="documentoTipo"><option value="DNI">DNI</option><option value="CE">Carné de extranjería</option><option value="PASAPORTE">Pasaporte</option><option value="RUC">RUC</option></select></div>
      <div class="campo"><label for="documentoNumero">Número de documento</label><input id="documentoNumero" name="documentoNumero" inputmode="numeric" required maxlength="32"></div>
      <div class="campo ancho"><label for="domicilio">Domicilio</label><input id="domicilio" name="domicilio" autocomplete="street-address" required maxlength="300"></div>
      <div class="campo"><label for="telefono">Teléfono</label><input id="telefono" name="telefono" type="tel" autocomplete="tel" required maxlength="32"></div>
      <div class="campo"><label for="correo">Correo electrónico</label><input id="correo" name="correo" type="email" autocomplete="email" required maxlength="191"></div>
      <div class="campo ancho"><label class="check"><input type="checkbox" id="menorDeEdad" name="menorDeEdad"><span>Soy menor de edad</span></label></div>
      <div class="campo ancho" id="caja-apoderado" hidden><label for="apoderado">Nombre del padre, madre o apoderado</label><input id="apoderado" name="apoderado" maxlength="191"></div>
    </div>
  </fieldset>

  <fieldset>
    <legend>2. Lo que contrataste</legend>
    <div class="campos">
      <div class="campo ancho"><span class="elige" role="radiogroup" aria-label="Producto o servicio">
        <label><input type="radio" name="bienTipo" value="servicio" checked> Servicio</label>
        <label><input type="radio" name="bienTipo" value="producto"> Producto</label></span></div>
      <div class="campo"><label for="monto">Monto reclamado (S/) <span class="opcional">opcional</span></label><input id="monto" name="monto" inputmode="decimal" maxlength="32"></div>
      <div class="campo ancho"><label for="bienDescripcion">Descripción</label><input id="bienDescripcion" name="bienDescripcion" placeholder="Por ejemplo: envío del pedido N.º 12345 a Los Olivos" required maxlength="500"></div>
    </div>
  </fieldset>

  <fieldset>
    <legend>3. Tu reclamo o queja</legend>
    <div class="campos">
      <div class="campo ancho"><span class="elige" role="radiogroup" aria-label="Reclamo o queja">
        <label><input type="radio" name="tipo" value="reclamo" checked> Reclamo</label>
        <label><input type="radio" name="tipo" value="queja"> Queja</label></span>
        <p class="defs"><b>Reclamo:</b> disconformidad con el producto o servicio. <b>Queja:</b> malestar por la atención recibida, que no tiene que ver con el producto o servicio en sí.</p></div>
      <div class="campo ancho"><label for="detalle">¿Qué pasó?</label><textarea id="detalle" name="detalle" required maxlength="5000"></textarea></div>
      <div class="campo ancho"><label for="pedido">¿Qué solicitas?</label><textarea id="pedido" name="pedido" required maxlength="3000"></textarea></div>
    </div>
  </fieldset>

  <label class="check"><input type="checkbox" id="acepta" name="acepta"><span>Declaro que los datos son ciertos y acepto que se usen solo para atender este reclamo, según la <a href="/privacidad">política de privacidad</a>.</span></label>
  <p class="nota">Registrar un reclamo no impide acudir a otras vías de solución de controversias ni es requisito previo para presentar una denuncia ante el INDECOPI.</p>
  <p class="error" id="error" role="alert"></p>
  <div><button class="boton" type="submit" id="enviar">Enviar mi reclamo</button></div>
</form>

<script>${String.raw`
(function () {
  var form = document.getElementById('libro');
  var menor = document.getElementById('menorDeEdad');
  var caja = document.getElementById('caja-apoderado');
  var error = document.getElementById('error');
  var boton = document.getElementById('enviar');
  menor.addEventListener('change', function () { caja.hidden = !menor.checked; });
  function valor(n) { var el = form.elements[n]; return el ? String(el.value || '').trim() : ''; }
  function marcado(n) { var el = form.querySelector('input[name="' + n + '"]:checked'); return el ? el.value : ''; }
  form.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    error.textContent = '';
    var datos = {
      tipo: marcado('tipo'), nombre: valor('nombre'), documentoTipo: valor('documentoTipo'), documentoNumero: valor('documentoNumero'),
      domicilio: valor('domicilio'), telefono: valor('telefono'), correo: valor('correo'), menorDeEdad: menor.checked,
      apoderado: valor('apoderado') || null, bienTipo: marcado('bienTipo'), monto: valor('monto') || null,
      bienDescripcion: valor('bienDescripcion'), detalle: valor('detalle'), pedido: valor('pedido'), acepta: document.getElementById('acepta').checked
    };
    boton.disabled = true; boton.textContent = 'Enviando…';
    try {
      var r = await fetch('/libro-de-reclamaciones', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(datos) });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) {
        error.textContent = j.error || 'No se pudo registrar. Inténtalo de nuevo en un momento.';
        if (j.campo && form.elements[j.campo] && form.elements[j.campo].focus) form.elements[j.campo].focus();
        return;
      }
      var main = document.querySelector('main');
      main.innerHTML = '<h1>Reclamo registrado</h1><p>Guarda o imprime esta hoja: es tu constancia. Te responderemos al correo que indicaste.</p>' + j.hoja +
        '<div class="acciones"><button class="boton" type="button" id="imprimir">Imprimir o guardar en PDF</button><a class="boton sec" href="/libro-de-reclamaciones">Registrar otro</a></div>';
      document.getElementById('imprimir').addEventListener('click', function () { window.print(); });
      window.scrollTo(0, 0);
    } catch (e) {
      error.textContent = 'No hay conexión. Revisa tu internet e inténtalo de nuevo.';
    } finally {
      boton.disabled = false; boton.textContent = 'Enviar mi reclamo';
    }
  });
})();
`}</script>
`, '/libro-de-reclamaciones', ESTILO);
}

/** Pantalla del superadministrador: los reclamos, con lo que vence y para responder. */
export function reclamosRecibidosPage(d: DatosLegales): string {
  return pagina('Reclamos recibidos', d, `
<h1>Reclamos recibidos</h1>
<p class="fecha">Libro de Reclamaciones de ${esc(d.razonSocial || d.nombreComercial)}. Cada uno se responde al correo del consumidor en 15 días hábiles como máximo.</p>
<p class="error" id="error" role="alert"></p>
<div id="lista"><p>Cargando…</p></div>
<script>${String.raw`
(function () {
  var lista = document.getElementById('lista');
  var error = document.getElementById('error');
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  async function cargar() {
    var r = await fetch('/admin/reclamos', { headers: { accept: 'application/json' } });
    if (r.status === 401) { lista.innerHTML = '<p>Inicia sesión como superadministrador para verlos. <a href="/login?next=/reclamos-recibidos">Entrar</a></p>'; return; }
    if (r.status === 403) { lista.innerHTML = '<p>Solo un superadministrador puede ver el Libro de Reclamaciones.</p>'; return; }
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) { error.textContent = j.error || 'No se pudo cargar.'; return; }
    if (!j.reclamos.length) { lista.innerHTML = '<p>Todavía no hay reclamos registrados.</p>'; return; }
    lista.innerHTML = j.reclamos.map(function (x) {
      var asunto = encodeURIComponent('Respuesta a tu hoja de reclamación ' + x.codigo);
      var cuerpo = encodeURIComponent('Hola ' + x.nombre + ',\n\nRespuesta a tu ' + x.tipo + ' ' + x.codigo + ':\n\n' + (x.respuesta || ''));
      return '<article class="reclamo">' +
        '<h2>' + esc(x.codigo) + ' · ' + esc(x.nombre) + ' <span class="chip ' + x.estado + '">' + (x.estado === 'pendiente' ? 'Pendiente · vence el ' + esc(x.vence) : 'Respondido') + '</span></h2>' +
        '<details><summary>Ver la hoja completa</summary>' + x.hoja + '</details>' +
        '<div class="campo" style="margin-top:10px"><label for="r-' + esc(x.codigo) + '">Respuesta del proveedor</label>' +
        '<textarea id="r-' + esc(x.codigo) + '" maxlength="5000">' + esc(x.respuesta || '') + '</textarea></div>' +
        '<div class="acciones"><button class="boton" type="button" data-responder="' + esc(x.codigo) + '">Guardar respuesta</button>' +
        '<a class="boton sec" href="mailto:' + esc(x.correo) + '?subject=' + asunto + '&amp;body=' + cuerpo + '">Escribirle por correo</a></div>' +
        '</article>';
    }).join('');
  }
  lista.addEventListener('click', async function (ev) {
    var b = ev.target.closest('[data-responder]');
    if (!b) return;
    var codigo = b.getAttribute('data-responder');
    var texto = document.getElementById('r-' + codigo).value.trim();
    error.textContent = '';
    if (texto.length < 5) { error.textContent = 'Escribe la respuesta antes de guardarla.'; return; }
    b.disabled = true;
    var r = await fetch('/admin/reclamos/responder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ codigo: codigo, respuesta: texto }) });
    var j = await r.json().catch(function () { return {}; });
    b.disabled = false;
    if (!r.ok) { error.textContent = j.error || 'No se pudo guardar.'; return; }
    await cargar();
  });
  cargar().catch(function () { error.textContent = 'No hay conexión con el servidor.'; });
})();
`}</script>
`, '/reclamos-recibidos', ESTILO);
}

export { venceEl, diaLima };
