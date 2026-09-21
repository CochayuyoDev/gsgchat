/**
 * Pantalla "Que todo funcione" (/fiabilidad): lo que el sistema vigila por
 * si mismo y lo que hace cuando algo falla.
 *
 * Cuatro cajas: el WhatsApp (si se cae, avisa por correo y reintenta), la
 * prueba de cada manana (WhatsApp, GSG, IA, entregas, disco), los mensajes
 * de hoy (cupo frente a lo que necesitan los pedidos) y la copia de
 * seguridad (la base y los respaldos, cada noche, a una carpeta).
 *
 * Todo se configura aqui. Nada de codigos en pantalla: cada fallo dice que
 * pasa y a donde ir. El JS va en String.raw, con var y sin backticks.
 */

import { appShell } from './shell.js';

const CSS = `

  * { box-sizing: border-box; }
  .wrap { color: var(--texto); font-family: var(--fuente); font-size: var(--fs-cuerpo); line-height: 1.5; max-width: 1300px; }
  .wrap a { color: var(--primario); }
  .muted { color: var(--texto-suave); }
  .hidden { display: none !important; }
  .demo { background: var(--ambar-suave); color: var(--ambar); border: 1px solid var(--ambar); padding: 8px 14px; font-size: var(--fs-small); font-weight: 600; text-align: center; margin-bottom: var(--esp-4); border-radius: var(--radio-sm); }
  input, select, textarea, button { font: inherit; color: var(--texto); background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio-sm); padding: 8px 11px; max-width: 100%; }
  input, select, textarea { width: 100%; min-height: 38px; }
  input[type=checkbox], input[type=radio] { width: auto; min-height: 0; accent-color: var(--primario); }
  input[type=file] { padding: 7px 10px; font-size: 13.5px; }
  input:focus, select:focus, textarea:focus { border-color: var(--primario); outline: none; box-shadow: 0 0 0 3px var(--primario-suave); }
  textarea { min-height: 70px; resize: vertical; }
  button { cursor: pointer; width: auto; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 36px; padding: 7px 14px; font-weight: 600; line-height: 1.2; }
  button:hover { border-color: var(--primario); color: var(--primario); }
  button.primary { background: var(--primario); border-color: var(--primario); color: var(--primario-texto); }
  button.primary:hover { filter: brightness(1.06); color: var(--primario-texto); }
  button.sm { min-height: 30px; padding: 4px 10px; font-size: 13px; font-weight: 500; }
  button.peligro { color: var(--rojo); border-color: var(--rojo-suave); background: var(--rojo-suave); }
  button.peligro:hover { background: var(--rojo); border-color: var(--rojo); color: #fff; }
  button:disabled { opacity: .55; cursor: default; }
  a.sm { display: inline-flex; align-items: center; min-height: 30px; padding: 4px 10px; border: 1px solid var(--borde); border-radius: var(--radio-sm); font-size: 13px; font-weight: 500; text-decoration: none; color: var(--texto); background: var(--superficie); }
  a.sm:hover { border-color: var(--primario); color: var(--primario); }
  @media (max-width: 960px) { button, a.sm, button.sm { min-height: 44px; } }
  label { display: block; font-size: var(--fs-small); font-weight: 500; color: var(--texto-suave); margin: 10px 0 4px; }
  .explica { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); padding: var(--esp-3) var(--esp-4); margin-bottom: var(--esp-4); font-size: 14px; box-shadow: var(--sombra); }
  .explica p { margin: 0 0 6px; }
  .explica p:last-child { margin-bottom: 0; }
  .caja { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); overflow: hidden; margin-bottom: var(--esp-4); box-shadow: var(--sombra); min-width: 0; }
  .caja > h2 { font-size: 15px; font-weight: 700; margin: 0; padding: var(--esp-3) var(--esp-4); border-bottom: 1px solid var(--borde); display: flex; align-items: center; gap: var(--esp-2); flex-wrap: wrap; }
  .caja > h2 .sep { flex: 1; }
  .caja .cuerpo { padding: var(--esp-4); }
  .toast { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); background: var(--texto); color: var(--bg); padding: 10px 16px; border-radius: 10px; font-size: 14px; z-index: 50; max-width: 90vw; box-shadow: var(--sombra-2); }
  .chip.ok { background: var(--verde-suave); color: var(--verde); }
  .chip.warn { background: var(--ambar-suave); color: var(--ambar); }
  .chip.bad { background: var(--rojo-suave); color: var(--rojo); }
  .chip.info { background: var(--azul-suave); color: var(--azul); }
  .aviso-rojo, .aviso-amarillo, .aviso-verde { border-radius: var(--radio-sm); padding: 10px 12px; margin: 8px 0; font-size: 14px; border: 1px solid; }
  .aviso-rojo { background: var(--rojo-suave); border-color: var(--rojo); color: var(--rojo); }
  .aviso-amarillo { background: var(--ambar-suave); border-color: var(--ambar); color: var(--ambar); }
  .aviso-verde { background: var(--verde-suave); border-color: var(--verde); color: var(--verde); }
  .aviso-rojo a, .aviso-amarillo a, .aviso-verde a { color: inherit; font-weight: 600; }
  .tarjetas { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--esp-3); margin-bottom: var(--esp-4); }
  .tarjeta { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); padding: var(--esp-3) var(--esp-4); min-width: 0; box-shadow: var(--sombra); }
  .tarjeta .n { font-size: 22px; font-weight: 700; line-height: 1.1; }
  .tarjeta .q { font-size: var(--fs-small); color: var(--texto-suave); margin-top: 2px; }
  .tarjeta.ok .n { color: var(--verde); } .tarjeta.warn .n { color: var(--ambar); } .tarjeta.bad .n { color: var(--rojo); } .tarjeta.info .n { color: var(--azul); }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--borde); vertical-align: top; }
  th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--texto-suave); font-weight: 600; background: var(--superficie-2); }
  tr:last-child td { border-bottom: 0; }
  td .sub { color: var(--texto-suave); font-size: var(--fs-small); }
  .fila-datos { display: flex; gap: 10px; flex-wrap: wrap; }
  .fila-datos > div { flex: 1; min-width: 160px; }

  label.linea { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--texto); font-weight: 400; }
  .cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--esp-4); align-items: start; }
  @media (max-width: 1000px) { .cols { grid-template-columns: 1fr; } }
  .semaforo { display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: var(--gris); box-shadow: 0 0 0 3px var(--gris-suave); flex: none; }
  .semaforo.ok { background: var(--verde); box-shadow: 0 0 0 3px var(--verde-suave); }
  .semaforo.warn { background: var(--ambar); box-shadow: 0 0 0 3px var(--ambar-suave); }
  .semaforo.bad { background: var(--rojo); box-shadow: 0 0 0 3px var(--rojo-suave); }
  .frase { font-size: 15px; margin: 0 0 8px; }
  .frase.bad { color: var(--rojo); font-weight: 600; }
  .frase.ok { color: var(--verde); }
  .pasos { list-style: none; margin: 8px 0; padding: 0; }
  .pasos li { display: flex; gap: 10px; align-items: flex-start; padding: 8px 0; border-bottom: 1px solid var(--borde); font-size: 14px; }
  .pasos li:last-child { border-bottom: 0; }
  .pasos .marca { flex: none; width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; background: var(--superficie-2); color: var(--texto-suave); }
  .pasos .marca.ok { background: var(--verde-suave); color: var(--verde); }
  .pasos .marca.bad { background: var(--rojo-suave); color: var(--rojo); }
  .pasos .marca.omitido { color: var(--texto-suave); }
  .pasos .nombre { font-weight: 600; min-width: 110px; }
  .pasos .detalle { color: var(--texto-suave); }
  .dias { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 8px; }
  .dia { width: 28px; height: 28px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; background: var(--superficie-2); color: var(--texto-suave); }
  .dia.ok { background: var(--verde-suave); color: var(--verde); }
  .dia.bad { background: var(--rojo-suave); color: var(--rojo); }
  .cifras { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin: 6px 0 12px; }
  .cifra { background: var(--superficie-2); border-radius: var(--radio-sm); padding: 8px 12px; }
  .cifra .n { font-size: 22px; font-weight: 700; line-height: 1.1; }
  .cifra .q { font-size: var(--fs-small); color: var(--texto-suave); }
  .cifra.bad .n { color: var(--rojo); }
  .cifra.ok .n { color: var(--verde); }
  td.num, th.num { text-align: right; white-space: nowrap; }
  details { border-top: 1px solid var(--borde); margin-top: 12px; padding-top: 6px; }
  summary { cursor: pointer; font-weight: 600; font-size: 14px; min-height: 34px; display: flex; align-items: center; gap: 6px; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  summary::before { content: '▸'; color: var(--texto-suave); font-size: 12px; }
  details[open] > summary::before { content: '▾'; }
  .fila { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  @media (max-width: 560px) { .fila { grid-template-columns: 1fr; } }
  .botones { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
  ol.pasos-restaurar { padding-left: 20px; font-size: 14px; }
  ol.pasos-restaurar li { margin: 4px 0; }
  .copias { list-style: none; padding: 0; margin: 8px 0 0; }
  .copias li { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 6px 0; border-bottom: 1px solid var(--borde); font-size: 13.5px; }
  .copias li:last-child { border-bottom: 0; }
  .recortar { margin: 6px 0 0; padding-left: 20px; font-size: 14px; }
  .recortar li { margin: 3px 0; }
  .solo-demo { font-size: var(--fs-small); align-self: center; }
  details.avanzado { border-top: 0; margin-top: 8px; padding-top: 0; }
  details.avanzado summary { font-weight: 500; color: var(--texto-suave); font-size: 13.5px; }
`;

export function fiabilidadPage(opts: { disponible: boolean; demo: boolean; nombreNegocio: string }): string {
  const contenido = `
<div class="wrap">
${opts.demo ? '<div class="demo">Demostración: nada sale a WhatsApp de verdad y la base está en memoria.</div>' : ''}
${opts.disponible ? '' : '<div class="explica"><b>Esta pantalla no está disponible en este arranque.</b> Arranca el sistema con <code>npm run quick</code>.</div>'}

<div class="explica">
  <p><b>Aquí el sistema se vigila a sí mismo.</b> Si el WhatsApp se cae, lo intenta volver a conectar y avisa por correo (por WhatsApp no puede, está caído). Cada mañana comprueba que WhatsApp, GSG, la IA y las entregas responden. Cuenta por adelantado si el cupo de mensajes de hoy alcanza para los pedidos cargados. Y cada noche guarda una copia de la base y de las conversaciones en una carpeta que eliges tú.</p>
  <p class="muted" style="margin:0">Todo lo que ves en rojo dice qué pasa y a dónde ir. Los ajustes de cada cosa están dentro de su caja.</p>
</div>

<div class="cols">
  <div>
    <div class="caja" id="caja-wa">
      <h2><span class="semaforo" id="wa-semaforo"></span> WhatsApp <span class="sep"></span><button class="sm" id="wa-mirar" type="button">Mirar ahora</button></h2>
      <div class="cuerpo">
        <p class="frase" id="wa-frase">Cargando…</p>
        <div id="wa-detalle" class="muted" style="font-size:13.5px"></div>
        <div id="wa-correo-estado"></div>
        <div class="botones hidden" id="wa-sim-botones">
          <span class="muted solo-demo">Solo en la demostración:</span>
          <button class="sm" id="wa-sim-caida" type="button">Simular una caída</button>
          <button class="sm" id="wa-sim-vuelta" type="button">Simular que vuelve</button>
          <button class="sm" id="wa-sim-real" type="button">Volver a lo real</button>
        </div>
        <details id="wa-ajustes">
          <summary>Correo de aviso y ajustes</summary>
          <p class="muted" style="font-size:13.5px;margin:8px 0"><b>Brevo</b> es un servicio gratuito que manda los correos por nosotros: crea una cuenta en <a href="https://www.brevo.com" target="_blank" rel="noopener">brevo.com</a>, verifica tu correo como remitente, entra en <b>SMTP &amp; API → API keys</b> y copia la clave aquí abajo. La clave se guarda cifrada. No hay un segundo número de WhatsApp de respaldo: el sistema lleva una sola sesión.</p>
          <div class="fila">
            <div><label for="wa-correo">Correo que recibe el aviso</label><input id="wa-correo" type="email" placeholder="tu@correo.com" autocomplete="off"></div>
            <div><label for="wa-minutos">Avisar cuando lleve caído (minutos)</label><input id="wa-minutos" type="number" min="1" max="120"></div>
          </div>
          <label for="wa-brevo">Clave de API de Brevo <span id="wa-brevo-chip" class="chip"></span></label>
          <input id="wa-brevo" type="password" placeholder="xkeysib-…" autocomplete="new-password">
          <details class="avanzado">
            <summary>Avanzado: remitente del correo</summary>
            <div class="fila">
              <div><label for="wa-remitente">Correo remitente <span class="muted">(verificado en Brevo; vacío = el mismo correo que lo recibe)</span></label><input id="wa-remitente" type="email" placeholder="avisos@tunegocio.com" autocomplete="off"></div>
              <div><label for="wa-nombre">Nombre del remitente</label><input id="wa-nombre" type="text" maxlength="80"></div>
            </div>
          </details>
          <label class="linea" style="margin-top:10px"><input id="wa-al-volver" type="checkbox"> Avisar también cuando vuelve (con cuánto estuvo caído)</label>
          <div class="botones">
            <button class="primary" id="wa-guardar" type="button">Guardar</button>
            <button id="wa-probar-correo" type="button">Probar el correo</button>
            <button class="sm" id="wa-brevo-quitar" type="button">Quitar la clave</button>
          </div>
        </details>
      </div>
    </div>

    <div class="caja" id="caja-humo">
      <h2><span class="semaforo" id="humo-semaforo"></span> Cada mañana se comprueba que todo funciona <span class="sep"></span><button class="sm primary" id="humo-probar" type="button">Probar ahora</button></h2>
      <div class="cuerpo">
        <p class="frase" id="humo-frase">Cargando…</p>
        <ul class="pasos" id="humo-pasos"></ul>
        <div id="humo-aviso" class="muted" style="font-size:13px"></div>
        <div class="dias" id="humo-dias"></div>
        <details>
          <summary>Cuándo</summary>
          <div class="fila">
            <div><label>Hora de la prueba</label><input id="humo-hora" type="time"></div>
            <div><label>&nbsp;</label><label class="linea"><input id="humo-activo" type="checkbox"> Comprobar cada mañana</label></div>
          </div>
          <p class="muted" style="font-size:13px">Se manda un WhatsApp de prueba al supervisor (el de Ajustes → Avisos). Si algo falla, se le avisa a él; si lo que falla es el WhatsApp, por el correo de arriba.</p>
          <div class="botones"><button class="primary" id="humo-guardar" type="button">Guardar</button></div>
        </details>
      </div>
    </div>
  </div>

  <div>
    <div class="caja" id="caja-cupo">
      <h2><span class="semaforo" id="cupo-semaforo"></span> Mensajes de hoy <span class="sep"></span><a href="/hoy" class="sm" style="font-size:13px">Ver los pedidos</a></h2>
      <div class="cuerpo">
        <p class="frase" id="cupo-frase">Cargando…</p>
        <div class="cifras" id="cupo-cifras"></div>
        <table id="cupo-tabla" class="hidden"><thead><tr><th>Para qué</th><th class="num">Mensajes</th></tr></thead><tbody id="cupo-detalle"></tbody></table>
        <div id="cupo-recortar"></div>
        <div class="botones"><a class="sm" href="/panel#salud">Subir el cupo de hoy (Riesgo y ritmo)</a><a class="sm" href="/hoy">Pausar o quitar clientes en Hoy</a></div>
        <p class="muted" style="font-size:13px;margin:10px 0 0">El cupo del día lo pone el ritmo del número (crece semana a semana para que WhatsApp no lo bloquee). Lo que necesitan los pedidos es una estimación: cada ubicación, confirmación, motorizado y aviso cuenta.</p>
      </div>
    </div>

    <div class="caja" id="caja-copia">
      <h2><span class="semaforo" id="copia-semaforo"></span> Copia de seguridad <span class="sep"></span><button class="sm primary" id="copia-ahora" type="button">Hacer copia ahora</button></h2>
      <div class="cuerpo">
        <div id="copia-alerta"></div>
        <p class="frase" id="copia-frase">Cargando…</p>
        <div id="copia-ultima" style="font-size:13.5px"></div>
        <details>
          <summary>Carpeta y hora</summary>
          <p class="muted" style="font-size:13px" id="copia-base"></p>
          <label>Carpeta donde se guardan las copias</label>
          <input id="copia-carpeta" type="text" placeholder="Vacío = la de siempre">
          <div class="muted" style="font-size:12.5px;margin-top:4px" id="copia-carpeta-detalle"></div>
          <div class="fila">
            <div><label>Hora (cada noche)</label><input id="copia-hora" type="time"></div>
            <div><label>Copias que se conservan</label><input id="copia-conservar" type="number" min="2" max="90"></div>
          </div>
          <label class="linea" style="margin-top:10px"><input id="copia-activa" type="checkbox"> Hacer la copia cada noche</label>
          <div class="botones">
            <button class="primary" id="copia-guardar" type="button">Guardar</button>
            <button id="copia-comprobar" type="button">Comprobar la carpeta</button>
          </div>
        </details>
        <details>
          <summary>Copias guardadas</summary>
          <ul class="copias" id="copia-lista"></ul>
        </details>
        <details>
          <summary>Cómo restaurar una copia</summary>
          <p class="muted" style="font-size:13px;margin:8px 0">Solo con el servidor parado. Es para cuando el disco se rompe o hay que mudarse a otro servidor.</p>
          <ol class="pasos-restaurar" id="copia-restaurar"></ol>
        </details>
      </div>
    </div>
  </div>
</div>
</div>
`;

  const script = String.raw`
async function api(path, options) {
  options = options || {};
  var res = await fetch(path, { method: options.method || 'GET', cache: 'no-store', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: options.body ? JSON.stringify(options.body) : undefined });
  var data = await res.json().catch(function () { return {}; });
  if (res.status === 401) { irAlLogin(); throw new Error('Tu sesión terminó: vuelve a entrar.'); }
  if (!res.ok) { var e = new Error(data.error || errorHttp(res.status)); e.datos = data; throw e; }
  return data;
}
function esc(v) { return String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function toast(texto) { var el = document.createElement('div'); el.className = 'toast'; el.textContent = texto; el.style.bottom = (18 + document.querySelectorAll('.toast').length * 46) + 'px'; document.body.appendChild(el); setTimeout(function () { el.remove(); }, 5000); }
function hora(iso) { if (!iso) return ''; return new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }); }
function fecha(iso) { if (!iso) return ''; var d = new Date(iso); return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) + ' ' + hora(iso); }
function bytes(n) { if (n < 1024) return n + ' B'; if (n < 1048576) return Math.round(n / 1024) + ' KB'; if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB'; return (n / 1073741824).toFixed(2) + ' GB'; }
function $(id) { return document.getElementById(id); }
function ocupado(boton, texto, fn) {
  return async function () {
    var antes = boton.textContent; boton.disabled = true; boton.textContent = texto;
    try { await fn(); } catch (e) { toast(e.message); } finally { boton.disabled = false; boton.textContent = antes; }
  };
}

var estado = null;
var editando = {};
document.querySelectorAll('input').forEach(function (i) {
  i.addEventListener('focus', function () { editando[i.id] = true; });
  i.addEventListener('blur', function () { delete editando[i.id]; });
});
function poner(id, valor) { if (editando[id]) return; var el = $(id); if (el.type === 'checkbox') el.checked = Boolean(valor); else el.value = valor === null || valor === undefined ? '' : valor; }

function pintarWa(v, brevo, demo) {
  var sem = $('wa-semaforo'); sem.className = 'semaforo';
  var frase = $('wa-frase'); frase.className = 'frase';
  if (v.seguimiento === 'sesion' && v.conectado === true) { sem.classList.add('ok'); frase.classList.add('ok'); }
  else if (v.seguimiento === 'sesion' && v.conectado === false) { sem.classList.add(v.necesitaQr ? 'bad' : 'warn'); frase.classList.add('bad'); }
  else if (v.seguimiento === 'meta') { sem.classList.add('ok'); }
  else { sem.classList.add('warn'); }
  frase.textContent = v.frase;
  var partes = [];
  if (v.seguimiento === 'sesion' && v.conectado === false) {
    if (v.necesitaQr) partes.push('<div class="aviso-rojo">Reintentar no sirve: <a href="/setup">entra en Conexión</a> y escanea el QR con el teléfono del número.</div>');
    else partes.push('<div class="aviso-amarillo">Se está intentando volver a conectar sola. Si no vuelve en unos minutos, <a href="/setup">entra en Conexión</a> y pulsa Conectar.</div>');
    if (v.aviso) partes.push('<div>' + esc(v.aviso.detalle) + '</div>');
  }
  if (v.ultimaCaida && v.conectado === true) partes.push('<div>Última caída: de ' + hora(v.ultimaCaida.desde) + ' a ' + hora(v.ultimaCaida.hasta) + ' (' + v.ultimaCaida.minutos + ' min)' + (v.ultimaCaida.avisadoPor === 'correo' ? ', se avisó por correo' : '') + '.</div>');
  $('wa-detalle').innerHTML = partes.join('');
  var c = $('wa-correo-estado');
  if (v.correo.listo) c.innerHTML = '<div class="aviso-verde">Correo de aviso listo' + (v.correo.ultimo ? ' · último: ' + esc(v.correo.ultimo.detalle) + ' (' + hora(v.correo.ultimo.at) + ')' : '') + '</div>';
  else c.innerHTML = '<div class="aviso-amarillo">Si el WhatsApp se cae, ahora mismo no hay a quién avisar: ' + esc(v.correo.falta) + '</div>';
  $('wa-sim-botones').classList.toggle('hidden', !demo);
  $('wa-brevo-chip').className = 'chip ' + (brevo.configurada ? 'ok' : 'warn');
  $('wa-brevo-chip').textContent = brevo.configurada ? 'guardada' : 'sin clave';
  $('wa-brevo-quitar').classList.toggle('hidden', !brevo.configurada);
}

function pintarHumo(h) {
  var sem = $('humo-semaforo'); sem.className = 'semaforo';
  var u = h.ultima;
  var frase = $('humo-frase'); frase.className = 'frase';
  if (!u) { sem.classList.add('warn'); frase.textContent = 'Todavía no se ha hecho ninguna prueba. Próxima: ' + h.proxima + '.'; }
  else if (u.ok) { sem.classList.add('ok'); frase.classList.add('ok'); frase.textContent = 'Todo respondió bien ' + (u.quien === 'cada mañana' ? 'esta mañana' : 'en la prueba de ' + u.quien) + ' (' + fecha(u.at) + '). Próxima: ' + h.proxima + '.'; }
  else { sem.classList.add('bad'); frase.classList.add('bad'); frase.textContent = 'Algo falló en la última prueba (' + fecha(u.at) + '). Próxima: ' + h.proxima + '.'; }
  $('humo-pasos').innerHTML = u ? u.pasos.map(function (p) {
    var clase = p.omitido ? 'omitido' : p.ok ? 'ok' : 'bad';
    var marca = p.omitido ? '–' : p.ok ? '✓' : '✗';
    return '<li><span class="marca ' + clase + '">' + marca + '</span><span class="nombre">' + esc(p.nombre) + '</span><span class="detalle">' + esc(p.detalle) + '</span></li>';
  }).join('') : '';
  $('humo-aviso').textContent = u && u.aviso ? (u.aviso.ok ? 'Se avisó: ' + u.aviso.detalle : 'No se pudo avisar: ' + u.aviso.detalle) : '';
  $('humo-dias').innerHTML = h.historial.slice().reverse().map(function (r) {
    var d = new Date(r.at);
    return '<span class="dia ' + (r.ok ? 'ok' : 'bad') + '" title="' + esc(fecha(r.at) + (r.ok ? ': todo bien' : ': falló ' + r.pasos.filter(function (p) { return !p.ok; }).map(function (p) { return p.nombre; }).join(', '))) + '">' + d.getDate() + '</span>';
  }).join('');
  poner('humo-hora', h.ajustes.hora);
  poner('humo-activo', h.ajustes.activo);
}

function pintarCupo(c) {
  var sem = $('cupo-semaforo'); sem.className = 'semaforo ' + (!c.cupoHoy ? 'warn' : c.alcanza ? 'ok' : 'bad');
  var frase = $('cupo-frase'); frase.className = 'frase ' + (!c.cupoHoy ? '' : c.alcanza ? 'ok' : 'bad');
  frase.textContent = c.frase;
  $('cupo-cifras').innerHTML =
    '<div class="cifra ' + (c.alcanza ? 'ok' : 'bad') + '"><div class="n">' + c.puedenSalir + '</div><div class="q">pueden salir hoy</div></div>' +
    '<div class="cifra"><div class="n">' + c.necesitan + '</div><div class="q">necesitan los pedidos</div></div>' +
    '<div class="cifra"><div class="n">' + c.usadosHoy + '</div><div class="q">ya salieron hoy (de ' + c.cupoHoy + ')</div></div>';
  $('cupo-tabla').classList.toggle('hidden', !c.detalle.length);
  $('cupo-detalle').innerHTML = c.detalle.map(function (d) { return '<tr><td>' + esc(d.concepto) + '</td><td class="num">' + d.cantidad + '</td></tr>'; }).join('');
  $('cupo-recortar').innerHTML = c.alcanza ? '' : '<div class="aviso-rojo">No alcanza. Qué recortar:<ul class="recortar">' + c.queRecortar.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ul></div>';
}

function pintarCopia(k) {
  var sem = $('copia-semaforo'); sem.className = 'semaforo ' + (k.alerta ? (k.ultima && !k.ultima.ok ? 'bad' : 'warn') : 'ok');
  $('copia-alerta').innerHTML = k.alerta ? '<div class="' + (k.ultima && !k.ultima.ok ? 'aviso-rojo' : 'aviso-amarillo') + '">' + esc(k.alerta) + '</div>' : '';
  var frase = $('copia-frase'); frase.className = 'frase';
  frase.textContent = (k.ajustes.activa ? 'Cada noche a las ' + k.ajustes.hora : 'La copia automática está apagada') + ' · carpeta: ' + k.carpeta + (k.carpetaEsLaDeSiempre ? ' (la de siempre)' : '') + ' · próxima: ' + k.proxima + '.';
  var u = k.ultima;
  $('copia-ultima').innerHTML = u
    ? '<div><b>Última copia:</b> ' + fecha(u.at) + (u.quien === 'cada noche' ? ' (automática)' : ' (la hizo ' + esc(u.quien) + ')') + (u.ok ? '' : ' · <span class="chip bad">falló</span>') + '</div>' +
      '<ul class="copias">' + u.ficheros.map(function (f) { return '<li><b>' + esc(f.nombre) + '</b> <span class="muted">' + bytes(f.bytes) + ' · ' + esc(f.que) + '</span></li>'; }).join('') + '</ul>' +
      (u.notas.length ? '<div class="muted" style="margin-top:6px">' + u.notas.map(esc).join('<br>') + '</div>' : '')
    : '';
  $('copia-base').textContent = k.base.detalle;
  poner('copia-carpeta', k.ajustes.carpeta);
  $('copia-carpeta').placeholder = 'Vacío = ' + k.carpeta;
  $('copia-carpeta-detalle').textContent = k.carpetaComprobada.detalle;
  $('copia-carpeta-detalle').style.color = k.carpetaComprobada.ok ? '' : 'var(--bad)';
  poner('copia-hora', k.ajustes.hora);
  poner('copia-conservar', k.ajustes.conservar);
  poner('copia-activa', k.ajustes.activa);
  $('copia-lista').innerHTML = k.copias.length
    ? k.copias.map(function (c) { return '<li><a href="/admin/fiabilidad/copia/descargar/' + encodeURIComponent(c.nombre) + '">' + esc(c.nombre) + '</a><span class="muted">' + bytes(c.bytes) + '</span></li>'; }).join('')
    : '<li class="muted">Todavía no hay copias en la carpeta.</li>';
  $('copia-restaurar').innerHTML = k.restaurar.pasos.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('');
}

async function cargar() {
  estado = await api('/admin/fiabilidad');
  pintarWa(estado.vigilante, estado.brevo, estado.demo);
  pintarHumo(estado.humo);
  pintarCupo(estado.cupo);
  pintarCopia(estado.copia);
  poner('wa-correo', estado.ajustes.vigilante.correoAviso);
  poner('wa-minutos', estado.ajustes.vigilante.minutosAntesDeAvisar);
  poner('wa-remitente', estado.ajustes.vigilante.remitente);
  poner('wa-nombre', estado.ajustes.vigilante.nombreRemitente);
  poner('wa-al-volver', estado.ajustes.vigilante.avisarAlVolver);
}

$('wa-mirar').onclick = ocupado($('wa-mirar'), 'Mirando…', async function () { await api('/admin/fiabilidad/vigilante/mirar', { method: 'POST', body: {} }); await cargar(); });
$('wa-guardar').onclick = ocupado($('wa-guardar'), 'Guardando…', async function () {
  var body = { vigilante: { correoAviso: $('wa-correo').value.trim(), minutosAntesDeAvisar: Number($('wa-minutos').value || 3), remitente: $('wa-remitente').value.trim(), nombreRemitente: $('wa-nombre').value.trim() || 'GSGchat', avisarAlVolver: $('wa-al-volver').checked } };
  if ($('wa-brevo').value.trim()) body.claveBrevo = $('wa-brevo').value.trim();
  await api('/admin/fiabilidad/ajustes', { method: 'POST', body: body });
  $('wa-brevo').value = '';
  toast('Guardado.');
  await cargar();
});
$('wa-brevo-quitar').onclick = ocupado($('wa-brevo-quitar'), 'Quitando…', async function () {
  var si = await confirmarDialogo({ titulo: 'Quitar la clave de Brevo', texto: 'Sin clave no se puede avisar por correo cuando el WhatsApp se caiga.', boton: 'Quitar', peligro: true });
  if (!si) return;
  await api('/admin/fiabilidad/ajustes', { method: 'POST', body: { claveBrevo: null } });
  await cargar();
});
$('wa-probar-correo').onclick = ocupado($('wa-probar-correo'), 'Mandando…', async function () {
  var r = await api('/admin/fiabilidad/correo/probar', { method: 'POST', body: {} });
  toast(r.resultado.detalle);
  await cargar();
});
$('wa-sim-caida').onclick = ocupado($('wa-sim-caida'), '…', async function () { await api('/admin/fiabilidad/vigilante/simular', { method: 'POST', body: { caido: true } }); toast('Caída simulada: el vigilante la ve como real.'); await cargar(); });
$('wa-sim-vuelta').onclick = ocupado($('wa-sim-vuelta'), '…', async function () { await api('/admin/fiabilidad/vigilante/simular', { method: 'POST', body: { caido: false } }); await cargar(); });
$('wa-sim-real').onclick = ocupado($('wa-sim-real'), '…', async function () { await api('/admin/fiabilidad/vigilante/simular', { method: 'POST', body: { caido: null } }); await cargar(); });

$('humo-probar').onclick = ocupado($('humo-probar'), 'Probando…', async function () {
  var r = await api('/admin/fiabilidad/humo/probar', { method: 'POST', body: {} });
  toast(r.resultado.ok ? 'Todo respondió bien.' : 'Algo falló: mira la lista.');
  await cargar();
});
$('humo-guardar').onclick = ocupado($('humo-guardar'), 'Guardando…', async function () {
  await api('/admin/fiabilidad/ajustes', { method: 'POST', body: { humo: { hora: $('humo-hora').value || '07:00', activo: $('humo-activo').checked } } });
  toast('Guardado.');
  await cargar();
});

$('copia-ahora').onclick = ocupado($('copia-ahora'), 'Copiando…', async function () {
  var r = await api('/admin/fiabilidad/copia/ahora', { method: 'POST', body: {} });
  toast(r.resultado.ficheros.length ? 'Copia hecha: ' + r.resultado.ficheros.map(function (f) { return f.nombre; }).join(', ') : 'Copia hecha (no había nada que copiar todavía).');
  await cargar();
});
$('copia-comprobar').onclick = ocupado($('copia-comprobar'), 'Comprobando…', async function () {
  var r = await api('/admin/fiabilidad/copia/carpeta', { method: 'POST', body: { carpeta: $('copia-carpeta').value.trim() } });
  $('copia-carpeta-detalle').textContent = r.detalle; $('copia-carpeta-detalle').style.color = '';
  toast(r.detalle);
});
$('copia-guardar').onclick = ocupado($('copia-guardar'), 'Guardando…', async function () {
  var carpeta = $('copia-carpeta').value.trim();
  if (carpeta) { var c = await api('/admin/fiabilidad/copia/carpeta', { method: 'POST', body: { carpeta: carpeta } }); if (!c.ok) throw new Error(c.detalle); }
  await api('/admin/fiabilidad/ajustes', { method: 'POST', body: { copia: { carpeta: carpeta, hora: $('copia-hora').value || '03:00', conservar: Number($('copia-conservar').value || 14), activa: $('copia-activa').checked } } });
  toast('Guardado.');
  await cargar();
});

document.addEventListener('ia:cambio', function () { cargar().catch(function () {}); });
setInterval(function () { if (document.querySelector('.dlg-fondo')) return; cargar().catch(function () {}); }, 30000);
cargar().catch(function (e) { toast(e.message); });
`;

  return appShell({
    titulo: 'Que todo funcione',
    subtitulo: 'El WhatsApp vigilado, la prueba de cada mañana, el cupo de hoy y la copia de seguridad',
    contenido,
    script,
    css: CSS,
    nombreNegocio: opts.nombreNegocio,
    demo: opts.demo,
    icono: '🛡️',
  });
}
