/**
 * Pantalla "Que todo funcione" (/fiabilidad): lo que el sistema vigila por
 * si mismo y, cuando algo falla, que hay que hacer.
 *
 * Arriba va el VEREDICTO: una sola frase que dice si todo esta bien y, si no,
 * lista lo que necesita atencion con el boton que lleva al sitio. Debajo, las
 * cuatro cajas con el detalle: el WhatsApp (si se cae, avisa por correo y
 * reintenta), la prueba de cada manana (WhatsApp, GSG, IA, entregas, disco),
 * el cupo de mensajes de hoy y la copia de seguridad de cada noche.
 *
 * Una regla manda en toda la pantalla: el tono (verde / ambar / rojo) de cada
 * caja lo decide UNA funcion, la misma que alimenta el veredicto de arriba.
 * Asi el resumen y el detalle no se pueden contradecir, y un semaforo nunca
 * sale verde con algo apagado o roto debajo.
 *
 * Se apoya en las clases del armazon (.btn, .tarjeta, .chip.tono-*): aqui solo
 * va el CSS propio de la pantalla. El JS va en String.raw, con var y sin
 * backticks.
 */

import { appShell } from './shell.js';

const CSS = `
  /* Solo lo propio de esta pantalla: los botones, las tarjetas y los chips
     los pone el armazon (.btn, .tarjeta, .chip.tono-*). */
  * { box-sizing: border-box; }
  .wrap { color: var(--texto); font: var(--fs-cuerpo)/1.5 var(--fuente); max-width: var(--ancho-max, 1600px); }
  .wrap a { color: var(--primario); }
  .muted { color: var(--texto-suave); }
  .hidden { display: none !important; }
  .demo { display: flex; align-items: center; gap: var(--esp-2); font-size: var(--fs-small); color: var(--texto-suave); margin: 0 0 var(--esp-3); }

  input, select { font: inherit; color: var(--texto); background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio-sm); padding: 8px 11px; width: 100%; min-height: 38px; max-width: 100%; }
  input[type=checkbox] { width: auto; min-height: 0; accent-color: var(--primario); }
  input:focus, select:focus { border-color: var(--primario); outline: none; box-shadow: 0 0 0 3px var(--primario-suave); }
  label { display: block; font-size: var(--fs-small); font-weight: 500; color: var(--texto-suave); margin: 10px 0 4px; }
  label.linea { display: flex; align-items: center; gap: var(--esp-2); font-size: var(--fs-cuerpo); color: var(--texto); font-weight: 400; }
  .espaciador { display: block; height: 22px; }

  /* Un aviso, tres tonos: el color va por variable para no repetir la regla. */
  .aviso { --t: var(--gris); --ts: var(--gris-suave); background: var(--ts); border: 1px solid var(--t); color: var(--t); border-radius: var(--radio-sm); padding: 10px 12px; margin: var(--esp-2) 0 0; font-size: var(--fs-cuerpo); }
  .aviso.rojo { --t: var(--rojo); --ts: var(--rojo-suave); }
  .aviso.ambar { --t: var(--ambar); --ts: var(--ambar-suave); }
  .aviso.verde { --t: var(--verde); --ts: var(--verde-suave); }
  .aviso a { color: inherit; font-weight: 600; }
  .aviso ul { margin: 6px 0 0; padding-left: 20px; }
  .aviso li { margin: 3px 0; }
  .aviso .botones { margin-top: 10px; }

  /* El veredicto: lo primero que se lee y lo unico que hace falta si va todo bien. */
  .veredicto { margin-bottom: var(--esp-4); border-left: 4px solid var(--gris); }
  .veredicto.verde { border-left-color: var(--verde); }
  .veredicto.ambar { border-left-color: var(--ambar); }
  .veredicto.rojo { border-left-color: var(--rojo); }
  .veredicto .cabecera { display: flex; align-items: center; gap: var(--esp-2); flex-wrap: wrap; }
  .veredicto h2 { font-size: var(--fs-h2); font-weight: 700; margin: 0; }
  .veredicto p { margin: var(--esp-2) 0 0; font-size: var(--fs-small); }
  .veredicto ul { list-style: none; margin: var(--esp-3) 0 0; padding: 0; }
  .veredicto ul:empty { display: none; }
  .veredicto li { display: flex; align-items: center; gap: var(--esp-2); flex-wrap: wrap; padding: var(--esp-2) 0; border-top: 1px solid var(--borde); }
  .veredicto li .que { flex: 1; min-width: 220px; }

  .cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--esp-4); align-items: start; }
  @media (max-width: 1000px) { .cols { grid-template-columns: 1fr; } }
  .caja { padding: 0; overflow: hidden; margin-bottom: var(--esp-4); min-width: 0; }
  .caja > h2 { font-size: var(--fs-h3); font-weight: 700; margin: 0; padding: var(--esp-3) var(--esp-4); border-bottom: 1px solid var(--borde); display: flex; align-items: center; gap: var(--esp-2); flex-wrap: wrap; }
  .caja > h2 .sep { flex: 1; }
  .caja .cuerpo { padding: var(--esp-4); }
  .titular { font-size: 15px; font-weight: 600; margin: 0; }
  .detalle { font-size: 13.5px; margin: var(--esp-1) 0 0; }
  .botones { display: flex; gap: var(--esp-2); flex-wrap: wrap; margin-top: var(--esp-3); }

  /* La prueba de la manana: un renglon por cosa probada. */
  .pasos { list-style: none; margin: var(--esp-3) 0 0; padding: 0; }
  .pasos li { display: flex; gap: 10px; align-items: flex-start; padding: 8px 0; border-bottom: 1px solid var(--borde); font-size: 13.5px; }
  .pasos li:last-child { border-bottom: 0; }
  .pasos .marca { flex: none; width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; background: var(--gris-suave); color: var(--texto-suave); }
  .pasos .marca.ok { background: var(--verde-suave); color: var(--verde); }
  .pasos .marca.bad { background: var(--rojo-suave); color: var(--rojo); }
  .pasos .nombre { font-weight: 600; min-width: 110px; }
  .pasos .detalle { color: var(--texto-suave); margin: 0; }
  .dias { display: flex; gap: 4px; flex-wrap: wrap; margin-top: var(--esp-3); }
  .dia { width: 28px; height: 28px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; background: var(--gris-suave); color: var(--texto-suave); }
  .dia.ok { background: var(--verde-suave); color: var(--verde); }
  .dia.bad { background: var(--rojo-suave); color: var(--rojo); }

  /* El cupo de hoy: lo gastado y lo que van a pedir los pedidos, sobre el total. */
  .barra { display: flex; height: 12px; border-radius: 999px; overflow: hidden; background: var(--gris-suave); margin: var(--esp-3) 0 var(--esp-1); }
  .barra span { display: block; height: 100%; }
  .barra .usados { background: var(--gris-claro); }
  .barra .previsto { background: var(--verde); }
  .barra.apretado .previsto { background: var(--ambar); }
  .barra.rojo .previsto { background: var(--rojo); }

  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--borde); vertical-align: top; }
  th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--texto-suave); font-weight: 600; background: var(--superficie-2); }
  tr:last-child td { border-bottom: 0; }
  td.num, th.num { text-align: right; white-space: nowrap; }

  .copias { list-style: none; padding: 0; margin: var(--esp-2) 0 0; }
  .copias li { display: flex; gap: var(--esp-2); align-items: center; flex-wrap: wrap; padding: 6px 0; border-bottom: 1px solid var(--borde); font-size: 13.5px; }
  .copias li:last-child { border-bottom: 0; }
  ol.pasos-restaurar { padding-left: 20px; font-size: 13.5px; }
  ol.pasos-restaurar li { margin: 4px 0; }

  details { border-top: 1px solid var(--borde); margin-top: var(--esp-3); padding-top: var(--esp-1); }
  summary { cursor: pointer; font-weight: 600; font-size: var(--fs-cuerpo); min-height: 34px; display: flex; align-items: center; gap: 6px; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  summary::before { content: '▸'; color: var(--texto-suave); font-size: 12px; }
  details[open] > summary::before { content: '▾'; }
  details.avanzado { border-top: 0; margin-top: var(--esp-2); padding-top: 0; }
  details.avanzado summary { font-weight: 500; color: var(--texto-suave); font-size: 13.5px; }
  .fila { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  @media (max-width: 560px) { .fila { grid-template-columns: 1fr; } }

  .toast { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); background: var(--texto); color: var(--bg); padding: 10px 16px; border-radius: var(--radio-sm); font-size: var(--fs-cuerpo); z-index: 50; max-width: 90vw; box-shadow: var(--sombra-2); }
`;

export function fiabilidadPage(opts: { disponible: boolean; demo: boolean; nombreNegocio: string }): string {
  // Los botones de simular una caida solo existen en la demostracion: asi no
  // hay nada en pantalla que, al pulsarlo, conteste "eso aqui no se puede".
  const simulacion = '';

  const contenido = `
<div class="wrap" id="wrap" data-disponible="${opts.disponible ? '1' : '0'}">

<section class="tarjeta"><h2>API, número y ritmo</h2><p id="api-salud-estado" role="status">Consultando…</p><div class="botones"><button class="btn" id="api-salud-evaluar" type="button">Evaluar riesgo</button><button class="btn" id="api-salud-pausa" type="button">Pausar envíos</button><button class="btn" id="api-salud-reanudar" type="button">Reanudar envíos</button><a href="/panel#historial">Historial y errores</a></div></section>
<section class="tarjeta veredicto" id="veredicto" aria-live="polite">
  <div class="cabecera"><span class="chip tono-gris" id="veredicto-chip">Comprobando</span><h2 id="veredicto-titulo">Mirando cómo está todo…</h2></div>
  <p class="muted" id="veredicto-pie">El sistema se vigila a sí mismo cada pocos segundos. Si algo falla, aquí sale qué pasa y a dónde ir.</p>
  <ul id="veredicto-acciones"></ul>
</section>

<p class="aviso ambar hidden" id="aviso-red" role="status"></p>

<div class="cols">
  <div>
    <section class="tarjeta caja" id="caja-wa">
      <h2><span class="chip tono-gris" id="wa-chip">…</span> WhatsApp <span class="sep"></span><button class="btn sm" id="wa-mirar" type="button">Mirar ahora</button></h2>
      <div class="cuerpo">
        <p class="titular" id="wa-titular">Cargando…</p>
        <p class="muted detalle" id="wa-detalle"></p>
        <div id="wa-avisos"></div>
        <details id="wa-ajustes">
          <summary>Correo de aviso: el plan B si el WhatsApp se cae</summary>
          <p class="muted detalle"><b>Brevo</b> es un servicio gratuito que manda los correos por nosotros: crea una cuenta en <a href="https://www.brevo.com" target="_blank" rel="noopener">brevo.com</a>, verifica tu correo como remitente, entra en <b>SMTP &amp; API → API keys</b> y copia la clave aquí abajo. La clave se guarda cifrada.</p>
          <div class="fila">
            <div><label for="wa-correo">Correo que recibe el aviso</label><input id="wa-correo" type="email" placeholder="tu@correo.com" autocomplete="off"></div>
            <div><label for="wa-minutos">Avisar cuando lleve caído (minutos)</label><input id="wa-minutos" type="number" min="1" max="120"></div>
          </div>
          <label for="wa-brevo">Clave de API de Brevo <span id="wa-brevo-chip" class="chip tono-gris"></span></label>
          <input id="wa-brevo" type="password" placeholder="xkeysib-…" autocomplete="new-password">
          <details class="avanzado">
            <summary>Avanzado: remitente del correo</summary>
            <div class="fila">
              <div><label for="wa-remitente">Correo remitente <span class="muted">(verificado en Brevo; vacío = el mismo que lo recibe)</span></label><input id="wa-remitente" type="email" placeholder="avisos@tunegocio.com" autocomplete="off"></div>
              <div><label for="wa-nombre">Nombre del remitente</label><input id="wa-nombre" type="text" maxlength="80"></div>
            </div>
          </details>
          <label class="linea"><input id="wa-al-volver" type="checkbox"> Avisar también cuando vuelve, con cuánto estuvo caído</label>
          <div class="botones">
            <button class="btn primario" id="wa-guardar" type="button">Guardar</button>
            <button class="btn" id="wa-probar-correo" type="button">Probar el correo</button>
            <button class="btn sm peligro hidden" id="wa-brevo-quitar" type="button">Quitar la clave</button>
          </div>
        </details>${simulacion}
      </div>
    </section>

    <section class="tarjeta caja" id="caja-humo">
      <h2><span class="chip tono-gris" id="humo-chip">…</span> La prueba de cada mañana <span class="sep"></span><button class="btn sm primario" id="humo-probar" type="button">Probar ahora</button></h2>
      <div class="cuerpo">
        <p class="titular" id="humo-titular">Cargando…</p>
        <p class="muted detalle" id="humo-detalle"></p>
        <div id="humo-avisos"></div>
        <ul class="pasos" id="humo-pasos"></ul>
        <div class="dias" id="humo-dias" role="group" aria-label="Cómo salieron las últimas pruebas, una casilla por día"></div>
        <details id="humo-ajustes">
          <summary>Cuándo se hace</summary>
          <div class="fila">
            <div><label for="humo-hora">Hora de la prueba</label><input id="humo-hora" type="time"></div>
            <div><span class="espaciador" aria-hidden="true"></span><label class="linea"><input id="humo-activo" type="checkbox"> Comprobar cada mañana</label></div>
          </div>
          <p class="muted detalle">Se manda un WhatsApp de prueba al supervisor (el de Ajustes → Avisos). Si algo falla, se le avisa a él; si lo que falla es el WhatsApp, por el correo de arriba.</p>
          <div class="botones"><button class="btn primario" id="humo-guardar" type="button">Guardar</button></div>
        </details>
      </div>
    </section>
  </div>

  <div>
    <section class="tarjeta caja" id="caja-cupo">
      <h2><span class="chip tono-gris" id="cupo-chip">…</span> Cupo de hoy <span class="sep"></span><a class="btn sm" href="/hoy">Ver los pedidos</a></h2>
      <div class="cuerpo">
        <p class="titular" id="cupo-titular">Cargando…</p>
        <div class="barra hidden" id="cupo-barra" role="img" aria-label=""><span class="usados" id="cupo-usados"></span><span class="previsto" id="cupo-previsto"></span></div>
        <p class="muted detalle" id="cupo-linea"></p>
        <div id="cupo-recortar"></div>
        <details id="cupo-detalle-caja">
          <summary>En qué se van esos mensajes</summary>
          <table><thead><tr><th>Para qué</th><th class="num">Mensajes</th></tr></thead><tbody id="cupo-detalle"></tbody></table>
          <p class="muted detalle">El cupo del día lo pone el ritmo del número: crece semana a semana para que WhatsApp no lo bloquee. Lo que necesitan los pedidos es una estimación: cada ubicación, confirmación, motorizado y aviso cuenta.</p>
        </details>
      </div>
    </section>

    <section class="tarjeta caja" id="caja-copia">
      <h2><span class="chip tono-gris" id="copia-chip">…</span> Copia de seguridad <span class="sep"></span><button class="btn sm primario" id="copia-ahora" type="button">Hacer copia ahora</button></h2>
      <div class="cuerpo">
        <p class="titular" id="copia-titular">Cargando…</p>
        <p class="muted detalle" id="copia-linea"></p>
        <div id="copia-avisos"></div>
        <details id="copia-ajustes">
          <summary>Carpeta y hora</summary>
          <p class="muted detalle" id="copia-base"></p>
          <label for="copia-carpeta">Carpeta donde se guardan las copias <span class="muted">(de este equipo o de una unidad compartida; mejor si la sincroniza OneDrive o Drive)</span></label>
          <input id="copia-carpeta" type="text" placeholder="Vacío = la de siempre" aria-describedby="copia-carpeta-ejemplo">
          <p class="muted detalle" id="copia-carpeta-ejemplo">Ejemplos: <code>C:\\Users\\Ali\\OneDrive\\GSGchat-copias</code> · <code>D:\\Copias\\GSGchat</code> · en un servidor Linux, <code>/var/backups/gsgchat</code>.</p>
          <p class="detalle" id="copia-carpeta-detalle"></p>
          <div class="fila">
            <div><label for="copia-hora">Hora (cada noche)</label><input id="copia-hora" type="time"></div>
            <div><label for="copia-conservar">Copias que se conservan</label><input id="copia-conservar" type="number" min="2" max="90"></div>
          </div>
          <label class="linea"><input id="copia-activa" type="checkbox"> Hacer la copia cada noche</label>
          <div class="botones">
            <button class="btn primario" id="copia-guardar" type="button">Guardar</button>
            <button class="btn" id="copia-comprobar" type="button">Comprobar la carpeta</button>
          </div>
        </details>
        <details>
          <summary>Copias guardadas</summary>
          <ul class="copias" id="copia-lista"></ul>
        </details>
        <details>
          <summary>Cómo restaurar una copia</summary>
          <p class="muted detalle">Solo con el servidor parado. Es para cuando el disco se rompe o hay que mudarse a otro servidor.</p>
          <ol class="pasos-restaurar" id="copia-restaurar"></ol>
        </details>
      </div>
    </section>
  </div>
</div>
</div>
`;

  const script = String.raw`
/* ------------------------------------------------------------- utiles --- */

async function api(path, options) {
  options = options || {};
  var res = await fetch(path, { method: options.method || 'GET', cache: 'no-store', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: options.body ? JSON.stringify(options.body) : undefined });
  var data = await res.json().catch(function () { return {}; });
  if (res.status === 401) { irAlLogin(); throw new Error('Tu sesión terminó: vuelve a entrar.'); }
  if (!res.ok) { var e = new Error(data.error || errorHttp(res.status)); e.datos = data; throw e; }
  return data;
}
function $(id) { return document.getElementById(id); }
function esc(v) { return String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function toast(texto) { var el = document.createElement('div'); el.className = 'toast'; el.textContent = texto; el.style.bottom = (18 + document.querySelectorAll('.toast').length * 46) + 'px'; document.body.appendChild(el); setTimeout(function () { el.remove(); }, 5000); }
function hora(iso) { return iso ? new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : ''; }
function fecha(iso) { return iso ? new Date(iso).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) + ' ' + hora(iso) : ''; }
function bytes(n) { if (n < 1024) return n + ' B'; if (n < 1048576) return Math.round(n / 1024) + ' KB'; if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB'; return (n / 1073741824).toFixed(2) + ' GB'; }

/** Un boton que se desactiva mientras trabaja y cuenta el fallo si lo hay. */
function ocupado(boton, texto, fn) {
  return async function () {
    var antes = boton.textContent;
    boton.disabled = true;
    boton.textContent = texto;
    try { await fn(); } catch (e) { toast(e.message); } finally { boton.disabled = false; boton.textContent = antes; }
  };
}

/* Lo que el usuario está escribiendo no se pisa con lo que llega del servidor. */
var editando = {};
document.querySelectorAll('input').forEach(function (i) {
  i.addEventListener('focus', function () { editando[i.id] = true; });
  i.addEventListener('blur', function () { delete editando[i.id]; });
});
function poner(id, valor) {
  var el = $(id);
  if (!el || editando[id]) return;
  if (el.type === 'checkbox') el.checked = Boolean(valor);
  else el.value = valor === null || valor === undefined ? '' : valor;
}

/* ------------------------------------------------------------- tonos ---- */
/* Tres tonos, de mejor a peor. Cada caja devuelve el suyo y el veredicto se
   queda con el peor: por eso no puede salir verde arriba con algo roto abajo. */

var ORDEN = { verde: 0, ambar: 1, rojo: 2 };
var PALABRA = { verde: 'Va bien', ambar: 'Atención', rojo: 'Falla' };
function peor(a, b) { return ORDEN[b] > ORDEN[a] ? b : a; }
function marcar(id, tono, texto) {
  var el = $(id);
  el.className = 'chip tono-' + tono;
  el.textContent = texto === undefined ? PALABRA[tono] : texto;
}
/** El HTML del boton de una acción: un enlace fuera, o un salto a una caja. */
function botonDe(accion) {
  if (!accion) return '';
  if (accion.href) return '<a class="btn sm" href="' + esc(accion.href) + '">' + esc(accion.texto) + '</a>';
  return '<button class="btn sm" type="button" data-ir="' + esc(accion.ir) + '">' + esc(accion.texto) + '</button>';
}
function avisoDe(estado) {
  if (estado.tono === 'verde') return '';
  // El botón que salta a otra parte de la pantalla solo tiene sentido arriba,
  // en el veredicto: dentro de su propia caja llevaría a donde ya estás.
  var accion = estado.accion && estado.accion.href ? estado.accion : null;
  return '<div class="aviso ' + estado.tono + '">' + esc(estado.consejo || estado.titular) + (accion ? '<div class="botones">' + botonDe(accion) + '</div>' : '') + '</div>';
}

/* ------------------------------------------------------------- cajas ---- */

/** WhatsApp: conectado, caído o sin conectar; y si hay a quién avisar. */
function pintarWa(v, brevo) {
  var estado;
  if (v.seguimiento === 'meta') estado = { tono: 'verde', titular: 'Los mensajes van por la API de Meta: no hay sesión que se pueda caer.' };
  else if (v.conectado === true) estado = { tono: 'verde', titular: 'WhatsApp conectado.' };
  else if (v.conectado === false && v.necesitaQr) estado = { tono: 'rojo', titular: 'WhatsApp caído y reintentar no sirve: hay que escanear el QR otra vez.', consejo: 'Entra en Conexión y escanea el QR con el teléfono del número. Mientras tanto nada se pierde: los mensajes esperan.', accion: { texto: 'Ir a Conexión', href: '/setup' } };
  else if (v.conectado === false) estado = { tono: 'rojo', titular: 'WhatsApp caído: se está intentando reconectar solo.', consejo: 'Nada se pierde: los mensajes esperan. Si no vuelve en unos minutos, entra en Conexión y pulsa Conectar.', accion: { texto: 'Ir a Conexión', href: '/setup' } };
  else estado = { tono: 'ambar', titular: 'Todavía no hay un WhatsApp conectado.', consejo: 'Conecta el número en Conexión: hasta entonces el sistema no puede escribir ni recibir nada.', accion: { texto: 'Ir a Conexión', href: '/setup' } };

  // El correo es el unico aviso que funciona con el WhatsApp caido: sin el,
  // una caida de madrugada no la cuenta nadie. No es un fallo, pero tampoco
  // es "todo bien".
  var correo = '';
  if (!v.correo.listo) {
    if (estado.tono === 'verde') estado = { tono: 'ambar', titular: 'WhatsApp conectado, pero si se cae no hay a quién avisar.', consejo: v.correo.falta, accion: { texto: 'Configurar el correo', ir: 'wa-ajustes' } };
    else correo = '<div class="aviso ambar">Además, si esto no se arregla solo no hay a quién avisar: ' + esc(v.correo.falta) + '</div>';
  } else if (v.correo.ultimo && !v.correo.ultimo.ok) {
    correo = '<div class="aviso ambar">El último correo de aviso no salió: ' + esc(v.correo.ultimo.detalle) + ' (' + hora(v.correo.ultimo.at) + ')</div>';
  }

  estado.nombre = 'WhatsApp';
  marcar('wa-chip', estado.tono);
  $('wa-titular').textContent = estado.titular;
  // La frase del servidor trae el detalle fino (desde cuándo, reintentos, la
  // última caída): no se repite aquí ninguno de esos datos.
  $('wa-detalle').textContent = v.frase;
  $('wa-avisos').innerHTML = avisoDe(estado) + correo;
  $('wa-brevo-chip').className = 'chip ' + (brevo.configurada ? 'tono-verde' : 'tono-ambar');
  $('wa-brevo-chip').textContent = brevo.configurada ? 'guardada' : 'sin clave';
  $('wa-brevo-quitar').classList.toggle('hidden', !brevo.configurada);
  return estado;
}

/** La prueba de cada mañana: qué salió en la última y cuándo es la próxima. */
function pintarHumo(h) {
  var u = h.ultima;
  var fallos = u ? u.pasos.filter(function (p) { return !p.ok && !p.omitido; }).map(function (p) { return p.nombre; }) : [];
  var estado;
  if (u && !u.ok) estado = { tono: 'rojo', titular: fallos.length ? 'En la última prueba falló ' + fallos.join(', ') + '.' : 'La última prueba no salió bien.', consejo: 'Mira abajo qué contestó cada cosa: ahí está el motivo exacto.' };
  else if (!h.ajustes.activo) estado = { tono: 'ambar', titular: 'Las pruebas de cada mañana están apagadas.', consejo: 'Nadie está comprobando que WhatsApp, GSG, la IA y las entregas respondan: enciéndelas en «Cuándo se hace».', accion: { texto: 'Encenderlas', ir: 'humo-ajustes' } };
  else if (!u) estado = { tono: 'ambar', titular: 'Todavía no se ha hecho ninguna prueba.', consejo: 'Pulsa «Probar ahora» para comprobarlo todo en el acto, sin avisar a nadie.' };
  else estado = { tono: 'verde', titular: 'Todo respondió bien en la última prueba.' };

  estado.nombre = 'Prueba de la mañana';
  marcar('humo-chip', estado.tono);
  $('humo-titular').textContent = estado.titular;
  var detalle = u ? 'Última: ' + fecha(u.at) + (u.quien === 'cada mañana' ? ' (automática)' : ' (la pidió ' + u.quien + ')') + '. ' : '';
  $('humo-detalle').textContent = detalle + 'Próxima: ' + h.proxima + '.';
  // Solo se cuenta el aviso al supervisor cuando NO se pudo dar: que salga
  // bien es lo normal y no hace falta decirlo.
  var mudo = u && u.aviso && !u.aviso.ok ? '<div class="aviso ambar">Falló la prueba y además no se pudo avisar: ' + esc(u.aviso.detalle) + '</div>' : '';
  $('humo-avisos').innerHTML = avisoDe(estado) + mudo;
  $('humo-pasos').innerHTML = u ? u.pasos.map(function (p) {
    var clase = p.omitido ? 'omitido' : p.ok ? 'ok' : 'bad';
    var marca = p.omitido ? '–' : p.ok ? '✓' : '✗';
    return '<li><span class="marca ' + clase + '">' + marca + '</span><span class="nombre">' + esc(p.nombre) + '</span><span class="detalle">' + esc(p.detalle) + '</span></li>';
  }).join('') : '';
  $('humo-dias').innerHTML = h.historial.slice().reverse().map(function (r) {
    var falla = r.pasos.filter(function (p) { return !p.ok && !p.omitido; }).map(function (p) { return p.nombre; }).join(', ');
    return '<span class="dia ' + (r.ok ? 'ok' : 'bad') + '" title="' + esc(fecha(r.at) + (r.ok ? ': todo bien' : ': falló ' + falla)) + '">' + new Date(r.at).getDate() + '</span>';
  }).join('');
  poner('humo-hora', h.ajustes.hora);
  poner('humo-activo', h.ajustes.activo);
  return estado;
}

/** El cupo de hoy: si alcanza para los pedidos cargados y, si no, qué recortar. */
function pintarCupo(c) {
  var estado;
  // Sin cupo conocido no se puede decir ni que alcanza ni que no: decirlo es
  // mas honesto que pintar un rojo que no significa nada.
  if (!c.cupoHoy) estado = { tono: 'ambar', titular: c.frase, consejo: 'En cuanto el número mande su primer mensaje del día se sabrá cuánto le queda.' };
  else if (!c.alcanza) estado = { tono: 'rojo', titular: c.frase, consejo: 'Si no se recorta algo, hoy se quedarán clientes sin su mensaje.' };
  else estado = { tono: 'verde', titular: c.frase };

  estado.nombre = 'Cupo de hoy';
  marcar('cupo-chip', estado.tono);
  $('cupo-titular').textContent = estado.titular;

  var barra = $('cupo-barra');
  barra.classList.toggle('hidden', !c.cupoHoy);
  if (c.cupoHoy) {
    var usados = Math.min(100, Math.round((c.usadosHoy / c.cupoHoy) * 100));
    var previsto = Math.min(100 - usados, Math.round((c.necesitan / c.cupoHoy) * 100));
    $('cupo-usados').style.width = usados + '%';
    $('cupo-previsto').style.width = previsto + '%';
    barra.className = 'barra' + (!c.alcanza ? ' rojo' : c.margen <= 5 ? ' apretado' : '');
    barra.setAttribute('aria-label', 'De los ' + c.cupoHoy + ' mensajes de hoy, ' + c.usadosHoy + ' ya salieron y los pedidos cargados necesitan unos ' + c.necesitan + '.');
  }
  $('cupo-linea').textContent = c.cupoHoy ? 'Cupo del día: ' + c.cupoHoy + ' mensajes · ya salieron ' + c.usadosHoy + '.' : '';

  $('cupo-detalle-caja').classList.toggle('hidden', !c.detalle.length);
  $('cupo-detalle').innerHTML = c.detalle.map(function (d) { return '<tr><td>' + esc(d.concepto) + '</td><td class="num">' + d.cantidad + '</td></tr>'; }).join('');
  // Qué recortar solo tiene sentido cuando de verdad no alcanza: sin cupo
  // conocido, "no alcanza" no querría decir nada.
  var recortar = c.cupoHoy && !c.alcanza && c.queRecortar.length
    ? 'Qué se puede recortar:<ul>' + c.queRecortar.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') +
      '</ul><div class="botones"><a class="btn sm" href="/panel#salud">Subir el cupo de hoy</a><a class="btn sm" href="/hoy">Pausar clientes en Hoy</a></div>'
    : '';
  $('cupo-recortar').innerHTML = estado.tono === 'verde' ? '' : '<div class="aviso ' + estado.tono + '">' + esc(estado.consejo) + recortar + '</div>';
  return estado;
}

/** La copia de cada noche: si está al día y dónde va. */
function pintarCopia(k) {
  var u = k.ultima;
  var estado;
  if (u && !u.ok) estado = { tono: 'rojo', titular: 'La última copia falló.', consejo: u.error || k.alerta || 'Comprueba la carpeta y vuelve a intentarlo.', accion: { texto: 'Ver la carpeta', ir: 'copia-ajustes' } };
  else if (k.alerta) estado = { tono: 'ambar', titular: k.alerta };
  else if (!k.ajustes.activa) estado = { tono: 'ambar', titular: 'La copia automática está apagada.', consejo: 'Hay copias hechas, pero ya no se hace ninguna sola: si el disco se rompe, se pierde todo lo de después de la última.', accion: { texto: 'Encenderla', ir: 'copia-ajustes' } };
  else estado = { tono: 'verde', titular: 'La copia está al día.' };

  estado.nombre = 'Copia de seguridad';
  marcar('copia-chip', estado.tono);
  $('copia-titular').textContent = estado.titular;
  $('copia-linea').textContent =
    (u ? 'Última: ' + fecha(u.at) + (u.quien === 'cada noche' ? ' (automática)' : ' (la hizo ' + u.quien + ')') + '. ' : '') +
    'Próxima: ' + k.proxima + '. Carpeta: ' + k.carpeta + (k.carpetaEsLaDeSiempre ? ' (la de siempre)' : '') + '.';
  var ficheros = u && u.ok && u.ficheros.length
    ? '<ul class="copias">' + u.ficheros.map(function (f) { return '<li><b>' + esc(f.nombre) + '</b> <span class="muted">' + bytes(f.bytes) + ' · ' + esc(f.que) + '</span></li>'; }).join('') + '</ul>'
    : '';
  var notas = u && u.notas && u.notas.length ? '<p class="muted detalle">' + u.notas.map(esc).join('<br>') + '</p>' : '';
  $('copia-avisos').innerHTML = avisoDe(estado) + ficheros + notas;

  $('copia-base').textContent = k.base.detalle;
  poner('copia-carpeta', k.ajustes.carpeta);
  $('copia-carpeta').placeholder = 'Vacío = ' + k.carpeta;
  $('copia-carpeta-detalle').textContent = k.carpetaComprobada.detalle;
  $('copia-carpeta-detalle').className = 'detalle ' + (k.carpetaComprobada.ok ? 'muted' : 'aviso rojo');
  poner('copia-hora', k.ajustes.hora);
  poner('copia-conservar', k.ajustes.conservar);
  poner('copia-activa', k.ajustes.activa);
  $('copia-lista').innerHTML = k.copias.length
    ? k.copias.map(function (c) { return '<li><a href="/admin/fiabilidad/copia/descargar/' + encodeURIComponent(c.nombre) + '">' + esc(c.nombre) + '</a><span class="muted">' + bytes(c.bytes) + '</span></li>'; }).join('')
    : '<li class="muted">Todavía no hay copias en la carpeta.</li>';
  $('copia-restaurar').innerHTML = k.restaurar.pasos.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('');
  return estado;
}

/** El veredicto de arriba: el peor tono de las cuatro cajas y qué hacer. */
function pintarVeredicto(estados) {
  var malas = estados.filter(function (e) { return e.tono !== 'verde'; });
  var tono = estados.reduce(function (t, e) { return peor(t, e.tono); }, 'verde');
  $('veredicto').className = 'tarjeta veredicto ' + tono;
  marcar('veredicto-chip', tono, tono === 'verde' ? 'Todo bien' : PALABRA[tono]);
  $('veredicto-titulo').textContent = !malas.length
    ? 'Todo funciona: no tienes que hacer nada.'
    : malas.length === 1
      ? 'Hay una cosa que necesita tu atención.'
      : 'Hay ' + malas.length + ' cosas que necesitan tu atención.';
  $('veredicto-acciones').innerHTML = malas.map(function (e) {
    return '<li><span class="chip tono-' + e.tono + '">' + esc(e.nombre) + '</span><span class="que">' + esc(e.titular) + '</span>' + botonDe(e.accion) + '</li>';
  }).join('');
}

/* ------------------------------------------------------------- cargar --- */

var fallosSeguidos = 0;

async function cargar() {
  var estado = await api('/admin/fiabilidad');
  pintarVeredicto([
    pintarWa(estado.vigilante, estado.brevo),
    pintarHumo(estado.humo),
    pintarCupo(estado.cupo),
    pintarCopia(estado.copia),
  ]);
  poner('wa-correo', estado.ajustes.vigilante.correoAviso);
  poner('wa-minutos', estado.ajustes.vigilante.minutosAntesDeAvisar);
  poner('wa-remitente', estado.ajustes.vigilante.remitente);
  poner('wa-nombre', estado.ajustes.vigilante.nombreRemitente);
  poner('wa-al-volver', estado.ajustes.vigilante.avisarAlVolver);
  fallosSeguidos = 0;
  $('aviso-red').classList.add('hidden');
}

/**
 * Si no se puede leer el estado, se dice: lo que hay en pantalla es de antes.
 * Callarse seria peor que no enseñar nada, porque todo seguiria en verde.
 */
function refrescar() {
  return cargar().catch(function (e) {
    fallosSeguidos += 1;
    var el = $('aviso-red');
    el.textContent = 'Lo que ves es de hace un momento: no se pudo leer el estado (' + e.message + '). Se vuelve a intentar cada 30 segundos.';
    el.classList.remove('hidden');
    if (fallosSeguidos === 1) toast(e.message);
  });
}

/* ------------------------------------------------------------ acciones -- */

$('veredicto-acciones').addEventListener('click', function (evento) {
  var boton = evento.target.closest('button[data-ir]');
  if (!boton) return;
  var destino = $(boton.dataset.ir);
  if (!destino) return;
  if (destino.tagName === 'DETAILS') destino.open = true;
  destino.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

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
  // Una copia larga contesta "sigue en marcha": se vuelve a mirar en un rato.
  if (r.enMarcha) { toast(r.detalle); setTimeout(refrescar, 15000); await cargar(); return; }
  toast(r.resultado.ficheros.length ? 'Copia hecha: ' + r.resultado.ficheros.map(function (f) { return f.nombre; }).join(', ') : 'Copia hecha (no había nada que copiar todavía).');
  await cargar();
});
$('copia-comprobar').onclick = ocupado($('copia-comprobar'), 'Comprobando…', async function () {
  var salida = $('copia-carpeta-detalle');
  try {
    var r = await api('/admin/fiabilidad/copia/carpeta', { method: 'POST', body: { carpeta: $('copia-carpeta').value.trim() } });
    salida.textContent = r.detalle;
    salida.className = 'detalle muted';
    toast(r.detalle);
  } catch (e) {
    // El servidor contesta 400 cuando no se puede escribir: el motivo va al
    // lado del campo, no solo en un aviso que se va solo.
    salida.textContent = e.message;
    salida.className = 'detalle aviso rojo';
    throw e;
  }
});
$('copia-guardar').onclick = ocupado($('copia-guardar'), 'Guardando…', async function () {
  var carpeta = $('copia-carpeta').value.trim();
  if (carpeta) {
    var c = await api('/admin/fiabilidad/copia/carpeta', { method: 'POST', body: { carpeta: carpeta } });
    if (!c.ok) throw new Error(c.detalle);
  }
  await api('/admin/fiabilidad/ajustes', { method: 'POST', body: { copia: { carpeta: carpeta, hora: $('copia-hora').value || '03:00', conservar: Number($('copia-conservar').value || 14), activa: $('copia-activa').checked } } });
  toast('Guardado.');
  await cargar();
});

function simular(boton, cuerpo, aviso) {
  boton.onclick = ocupado(boton, '…', async function () {
    await api('/admin/fiabilidad/vigilante/simular', { method: 'POST', body: cuerpo });
    if (aviso) toast(aviso);
    await cargar();
  });
}
if ($('wa-simular')) {
  simular($('wa-sim-caida'), { caido: true }, 'Caída simulada: el vigilante la ve como real.');
  simular($('wa-sim-caida5'), { caido: true, minutos: 5 }, 'Caída simulada 5 minutos: reintenta, avisa por correo si toca y vuelve solo a lo real.');
  simular($('wa-sim-vuelta'), { caido: false }, '');
  simular($('wa-sim-real'), { caido: null }, '');
}

/* ------------------------------------------------------------ arranque -- */

if ($('wrap').dataset.disponible === '1') {
  document.addEventListener('ia:cambio', function () { refrescar(); });
  // Mientras hay un cuadro de diálogo abierto no se refresca: cambiar lo de
  // debajo mientras alguien decide es como moverle la mesa.
  setInterval(function () { if (!document.querySelector('.dlg-fondo')) refrescar(); }, 30000);
  refrescar();
} else {
  // Sin el servicio de fiabilidad no hay nada que leer: se dice una vez y no
  // se pregunta cada 30 segundos.
  marcar('veredicto-chip', 'ambar', 'Sin datos');
  $('veredicto-titulo').textContent = 'Esta pantalla no está disponible en este arranque.';
  $('veredicto-pie').textContent = 'Arranca el sistema con «npm run quick» para que el vigilante, las pruebas y la copia se pongan en marcha.';
  ['wa', 'humo', 'cupo', 'copia'].forEach(function (caja) {
    marcar(caja + '-chip', 'gris', 'Sin datos');
    $(caja + '-titular').textContent = 'No se está vigilando en este arranque.';
  });
  document.querySelectorAll('.caja button').forEach(function (b) { b.disabled = true; });
}

async function saludNumero(){try{var datos=await Promise.all([api('/health'),api('/admin/health')]);var h=datos[1];$('api-salud-estado').textContent='API: '+(datos[0].ok?'disponible':'no disponible')+' · WhatsApp: '+(datos[0].connected?'conectado':'sin conexión')+' · Riesgo: '+(h.salud?h.salud.nivel:'sin datos')+' · Mensajes hoy: '+h.sentToday+' / '+h.dailyCap+' · Envíos: '+(h.number.paused?'pausados':'activos');}catch(e){$('api-salud-estado').textContent=e.message;}}
$('api-salud-evaluar').onclick=ocupado($('api-salud-evaluar'),'Evaluando…',async function(){await api('/admin/salud/evaluar',{method:'POST',body:{}});await saludNumero();});
$('api-salud-pausa').onclick=ocupado($('api-salud-pausa'),'Pausando…',async function(){await api('/admin/pause',{method:'POST',body:{paused:true,reason:'Desde Salud'}});await saludNumero();});
$('api-salud-reanudar').onclick=ocupado($('api-salud-reanudar'),'Reanudando…',async function(){await api('/admin/salud/reanudar',{method:'POST',body:{motivo:'Desde Salud'}});await saludNumero();});
saludNumero();setInterval(saludNumero,30000);
`;

  return appShell({
    titulo: 'Salud',
    subtitulo: 'API, conexión de WhatsApp, riesgo, cupo y respaldos',
    contenido,
    script,
    css: CSS,
    nombreNegocio: opts.nombreNegocio,
    demo: opts.demo,
    icono: '🛡️',
  });
}
