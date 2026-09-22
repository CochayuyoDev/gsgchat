/**
 * Pantalla "Tiendas": el panel del dueño (solo superadministrador).
 *
 * Todas las tiendas a las que les puso el sistema, de un vistazo: su
 * membresia (al dia, por vencer, vencida, suspendida), si estan en linea,
 * y la SALUD que cada una manda con su parte (WhatsApp conectado o caido,
 * mensajes de hoy, fallos de IA). Desde la misma fila: apuntar un pago,
 * cambiar el plan o los datos, suspender, token nuevo, escribirle por
 * WhatsApp, ver su historial, borrarla.
 *
 * Ademas: "Como me pagan" (Yape/Plin + QR, lo que cada tienda ve en su
 * pantalla Pagar), las capturas de pago por revisar (un clic apunta el
 * pago) y los avisos de vencimiento (textos y "Revisar ahora").
 *
 * Esta es la cara del que cobra; la del que paga es /pagar. Las dos dicen
 * el estado de la membresia con las mismas palabras y los mismos colores
 * (al dia / vence en N dias / vencida / suspendida), para que dueño y
 * tienda hablen de lo mismo.
 *
 * El JS va en String.raw, con var y sin backticks, como el resto.
 */

import { appShell } from './shell.js';

/* Solo lo que no dan ya los tokens ni las clases compartidas del armazon
   (.btn, .chip.tono-*, .tarjeta, .vacio): campos de formulario, la tabla,
   y las cuatro piezas propias de esta pantalla. */
const CSS = `
  * { box-sizing: border-box; }
  .wrap { color: var(--texto); font-family: var(--fuente); font-size: var(--fs-cuerpo); line-height: 1.5; max-width: 1400px; }
  .wrap a { color: var(--primario); }
  .muted { color: var(--texto-suave); }

  /* --- campos --------------------------------------------------------- */
  input, select, textarea { font: inherit; color: var(--texto); background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio-sm); padding: 8px 11px; width: 100%; max-width: 100%; min-height: 38px; }
  input[type=checkbox], input[type=radio] { width: auto; min-height: 0; accent-color: var(--primario); }
  input[type=file] { padding: 7px 10px; font-size: 13.5px; }
  input:focus, select:focus, textarea:focus { border-color: var(--primario); outline: none; box-shadow: 0 0 0 3px var(--primario-suave); }
  textarea { min-height: 70px; resize: vertical; }
  label { display: block; font-size: var(--fs-small); font-weight: 500; color: var(--texto-suave); margin: 10px 0 4px; }
  label.inline { display: flex; align-items: center; gap: 8px; color: var(--texto); font-size: 14px; font-weight: 400; }
  label.inline input { width: auto; }
  .fila { display: flex; gap: 10px; flex-wrap: wrap; }
  .fila > div { flex: 1; min-width: 160px; }

  /* --- cajas y avisos -------------------------------------------------- */
  .explica { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); padding: var(--esp-3) var(--esp-4); margin-bottom: var(--esp-4); font-size: 14px; box-shadow: var(--sombra); }
  .explica p { margin: 0; }
  .caja { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); overflow: hidden; margin-bottom: var(--esp-4); box-shadow: var(--sombra); min-width: 0; }
  .caja > h2 { font-size: var(--fs-h2); font-weight: 700; margin: 0; padding: var(--esp-3) var(--esp-4); border-bottom: 1px solid var(--borde); display: flex; align-items: center; gap: var(--esp-2); flex-wrap: wrap; }
  .caja > h2 .sep { flex: 1; }
  .caja .cuerpo { padding: var(--esp-4); }
  .caja.atencion { border-color: var(--ambar); }
  .toast { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); background: var(--texto); color: var(--bg); padding: 10px 16px; border-radius: var(--radio-sm); font-size: 14px; z-index: 50; max-width: 90vw; box-shadow: var(--sombra-2); }
  .cols { display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: var(--esp-4); align-items: start; }
  @media (max-width: 1100px) { .cols { grid-template-columns: 1fr; } }

  /* --- tarjetas de resumen --------------------------------------------- */
  .tarjetas { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--esp-3); margin-bottom: var(--esp-4); }
  .tarjetas .tarjeta { padding: var(--esp-3) var(--esp-4); min-width: 0; }
  .tarjeta .n { font-size: 22px; font-weight: 700; line-height: 1.1; word-break: break-word; }
  .tarjeta .q { font-size: var(--fs-small); color: var(--texto-suave); margin-top: 2px; }
  .tarjeta.verde .n { color: var(--verde); }
  .tarjeta.ambar .n { color: var(--ambar); }
  .tarjeta.rojo .n { color: var(--rojo); }
  .tarjeta.azul .n { color: var(--azul); }
  /* Lo que pide atención se ve como aviso, no como un número más. */
  .tarjeta.aviso.rojo { border-color: var(--rojo); background: var(--rojo-suave); }
  .tarjeta.aviso.ambar { border-color: var(--ambar); background: var(--ambar-suave); }
  .tarjeta.aviso.gris { border-color: var(--gris-claro); background: var(--gris-suave); }

  /* --- tabla de tiendas ------------------------------------------------- */
  .tabla { overflow-x: auto; }
  .tabla .vacio, .tabla .cargando { margin: var(--esp-3); }
  .cargando { text-align: center; color: var(--texto-suave); padding: var(--esp-5); }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--borde); vertical-align: top; }
  th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--texto-suave); font-weight: 600; background: var(--superficie-2); }
  td .sub { color: var(--texto-suave); font-size: var(--fs-small); }
  td .sub.viejo { color: var(--ambar); }
  tr.historial td { background: var(--superficie-2); padding: 8px 14px 12px; }
  tr.fila-acciones td { padding: 2px 12px 12px; border-bottom: 1px solid var(--borde); }
  tr.fila-acciones + tr td, tr.historial td { border-top: 0; }
  tbody tr:not(.fila-acciones):not(.historial) td { border-bottom: 0; padding-bottom: 4px; }
  tbody tr:not(.fila-acciones):not(.historial) td:first-child > b { font-size: 15px; }
  .salud { display: flex; flex-direction: column; gap: 3px; font-size: var(--fs-small); min-width: 180px; }
  .salud .luz { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; background: var(--gris-claro); vertical-align: middle; }
  .salud .luz.ok { background: var(--verde); }
  .salud .luz.warn { background: var(--ambar); }
  .salud .luz.bad { background: var(--rojo); }

  /* Dos acciones principales como boton; el resto, enlaces discretos para que la fila se lea de un vistazo. */
  .acciones { display: flex; gap: 6px 12px; flex-wrap: wrap; align-items: center; }
  .acciones .enlace { border: 0; background: transparent; padding: 4px 2px; min-height: 30px; color: var(--primario); font-weight: 600; box-shadow: none; }
  .acciones .enlace.peligro { color: var(--rojo); background: transparent; border: 0; }
  .acciones .enlace:hover, .acciones .enlace.peligro:hover { background: transparent; color: inherit; text-decoration: underline; }
  @media (max-width: 960px), (pointer: coarse) {
    .acciones .enlace { border: 1px solid var(--borde); background: var(--superficie); padding: 6px 12px; }
    .acciones .enlace.peligro { border-color: var(--rojo-suave); }
  }

  /* --- piezas sueltas --------------------------------------------------- */
  .token { background: var(--primario-suave); border: 1px dashed var(--primario); border-radius: var(--radio-sm); padding: 12px 14px; margin-top: 12px; }
  .token code { display: block; word-break: break-all; margin: 6px 0; font-size: 13px; }
  .pago { border: 1px solid var(--borde); border-radius: var(--radio-sm); padding: 10px 12px; margin-bottom: 8px; background: var(--superficie-2); }
  .pago:last-child { margin-bottom: 0; }
  .pago img { max-width: 100%; max-height: 420px; border-radius: var(--radio-sm); margin-top: 8px; display: block; }
  .qr-vista { max-width: 180px; max-height: 180px; border-radius: var(--radio-sm); border: 1px solid var(--borde); display: block; margin-top: 6px; background: #fff; }
  .vista-previa { font-size: 13px; color: var(--texto-suave); white-space: pre-wrap; background: var(--superficie-2); border-radius: var(--radio-sm); padding: 8px 10px; margin-top: 6px; }
  .ver-como { font-size: 12.5px; }
  .soporte-tienda { display: inline-block; margin-top: 4px; font-size: 13px; }
  .ayuda { margin: 0 0 6px; font-size: 13.5px; }
  .ayuda code, label code { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; background: var(--superficie-2); padding: 1px 5px; border-radius: 4px; }
  .listo { color: var(--verde); }
  details.avanzado { margin-top: 10px; }
  details.avanzado summary { cursor: pointer; font-size: 13.5px; color: var(--texto-suave); font-weight: 500; min-height: 34px; display: flex; align-items: center; gap: 6px; list-style: none; }
  details.avanzado summary::-webkit-details-marker { display: none; }
  details.avanzado summary::before { content: '▸'; font-size: 12px; }
  details.avanzado[open] summary::before { content: '▾'; }
  .hist { margin: 0; padding-left: 18px; font-size: 13px; }
  .hist li { margin: 2px 0; }
  .aviso-linea { font-size: 13px; padding: 4px 0; border-bottom: 1px solid var(--borde); }
  .aviso-linea:last-child { border-bottom: 0; }

  @media (max-width: 640px) {
    .tarjetas { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--esp-2); }
    .tarjetas .tarjeta { padding: var(--esp-2) var(--esp-3); }
    .tarjeta .n { font-size: 19px; }
    .tarjeta .q { font-size: 11.5px; }
  }
  /* En el celular la tabla se vuelve tarjetas: cada dato con su etiqueta y los botones debajo, sin scroll de lado. */
  @media (max-width: 720px) {
    table, tbody, tr, td { display: block; width: 100%; }
    thead { display: none; }
    tbody tr:not(.fila-acciones):not(.historial) { border-top: 1px solid var(--borde); }
    tbody tr:not(.fila-acciones):not(.historial):first-child { border-top: 0; }
    tbody tr:not(.fila-acciones):not(.historial) td { padding: 4px 12px; border: 0; }
    tbody tr:not(.fila-acciones):not(.historial) td:first-child { padding-top: 12px; }
    tbody td[data-etiqueta]::before { content: attr(data-etiqueta); display: block; color: var(--texto-suave); font-size: 11.5px; text-transform: uppercase; letter-spacing: .03em; }
    tr.fila-acciones td { padding: 8px 12px 12px; border-bottom: 0; }
    .salud { min-width: 0; }
  }
`;

export function tiendasPage(opts: { demo: boolean; nombreNegocio: string }): string {
  const contenido = `
<div class="wrap">

<div class="explica hidden" id="solo-super"><b>Solo el superadministrador ve las tiendas.</b> Si necesitas algo de aquí, pídeselo a quien puso el sistema.</div>

<div id="todo" class="hidden">
<div class="explica"><p>Cada negocio al que le pusiste el sistema tiene su propia instalación. Las capturas de pago que mandan desde su pantalla <b>Pagar</b> salen arriba: un clic apunta el pago y corre el vencimiento. Los avisos de vencimiento se mandan solos.</p></div>

<div class="tarjetas" id="tarjetas"></div>

<div class="cols">
  <div>
    <div class="caja atencion hidden" id="caja-pagos">
      <h2>Pagos por revisar <span class="sep"></span><span id="pagos-n"></span></h2>
      <div class="cuerpo" id="pagos"></div>
    </div>

    <div class="caja">
      <h2>Tiendas <span class="sep"></span><span id="aviso-carga" class="hidden"></span><button class="btn sm" id="recargar" type="button">Actualizar</button><button class="btn sm primario" id="ir-alta" type="button">+ Dar de alta</button></h2>
      <div class="tabla">
        <table>
          <thead><tr><th>Tienda</th><th>Plan</th><th>Membresía</th><th>Salud y conexión</th></tr></thead>
          <tbody id="tiendas"><tr><td colspan="4"><div class="cargando">Cargando…</div></td></tr></tbody>
        </table>
      </div>
    </div>

    <div class="caja" id="caja-alta">
      <h2>Dar de alta una tienda</h2>
      <div class="cuerpo">
        <div id="alojamiento" class="muted" style="margin-bottom:10px;font-size:13.5px"></div>
        <div class="fila">
          <div><label for="ti-nombre">Nombre del negocio</label><input id="ti-nombre" placeholder="Zapatería Lima"></div>
          <div><label for="ti-contacto-nombre">Persona de contacto</label><input id="ti-contacto-nombre" placeholder="Rosa Pérez"></div>
          <div><label for="ti-contacto-tel">Su WhatsApp <span class="muted">(9 cifras; sirve para avisarle desde aquí)</span></label><input id="ti-contacto-tel" type="tel" inputmode="tel" placeholder="987 654 321"></div>
        </div>
        <div class="fila">
          <div><label for="ti-plan">Plan</label><select id="ti-plan"></select></div>
          <div><label for="ti-vence">Pagada hasta</label><input id="ti-vence" type="date"></div>
          <div><label for="ti-precio">Precio al mes</label><input id="ti-precio" type="number" min="0" step="0.01"></div>
          <div style="flex:2"><label for="ti-renovar">Cómo renovar (lo ve la tienda)</label><input id="ti-renovar" placeholder="Escríbenos al 987 654 321"></div>
        </div>
        <details class="avanzado">
          <summary>Avanzado: identificador y dirección de su sistema</summary>
          <div class="fila">
            <div><label for="ti-slug">Identificador en las direcciones <span class="muted">(vacío = se saca del nombre)</span></label><input id="ti-slug" placeholder="zapateria-lima"></div>
            <div style="flex:2"><label for="ti-url">Dirección de su sistema de WhatsApp <span class="muted">(solo si ya está instalado en otro servidor)</span></label><input id="ti-url" placeholder="https://zapateria.wa.tuservicio.com"></div>
          </div>
        </details>
        <label class="inline hidden" id="ti-instalar-caja" style="margin-top:10px"><input type="checkbox" id="ti-instalar" checked> <b>Crear también su instalación ahora</b> <span class="muted">(su subdominio en este servidor, ya conectado a este panel; tarda un minuto)</span></label>
        <div style="margin-top:12px"><button class="btn primario" id="ti-crear" type="button">Dar de alta</button></div>
        <div id="ti-nueva" class="token hidden">
          <b>Token de <span id="ti-nueva-nombre"></span>: cópialo ahora, no se volverá a mostrar.</b>
          <code id="ti-token"></code>
          <label>Dirección del plan</label><code id="ti-url-plan"></code>
          <ol id="ti-pasos" style="margin:8px 0 0;padding-left:20px;font-size:13.5px"></ol>
          <div class="acciones" style="margin-top:8px"><button class="btn sm" id="ti-copiar" type="button">Copiar el token</button><button class="btn sm" id="ti-cerrar" type="button">Ya lo pegué</button></div>
        </div>
      </div>
    </div>
  </div>

  <div>
    <div class="caja">
      <h2>Cómo me pagan</h2>
      <div class="cuerpo">
        <p class="muted ayuda">Lo que cada tienda ve en su pantalla <b>Pagar</b>. Ellas mandan la captura y aquí la apuntas con un clic; el vencimiento corre solo.</p>
        <label class="inline"><input type="checkbox" id="cb-activo"> Enseñárselo a las tiendas</label>
        <label for="cb-numero">Número de Yape / Plin</label><input id="cb-numero" placeholder="987 654 321">
        <label for="cb-texto">Instrucciones</label><textarea id="cb-texto" placeholder="Yape o Plin al 987 654 321 a nombre de … Después manda la captura aquí mismo."></textarea>
        <label for="cb-qr">QR (imagen)</label><input id="cb-qr" type="file" accept="image/png,image/jpeg,image/webp">
        <img id="cb-qr-vista" class="qr-vista hidden" alt="QR de cobro">
        <div class="acciones" style="margin-top:10px"><button class="btn sm primario" id="cb-guardar" type="button">Guardar</button><button class="btn sm hidden" id="cb-quitar-qr" type="button">Quitar el QR</button></div>
      </div>
    </div>

    <div class="caja">
      <h2>Avisos de vencimiento <span class="sep"></span><button class="btn sm" id="av-revisar" type="button">Revisar ahora</button></h2>
      <div class="cuerpo" id="av-cuerpo">
        <p class="muted ayuda">A 7 días, a 1 día y el día que vence, un WhatsApp a la tienda (al número de su contacto) y otro a ti (el supervisor de Ajustes → Avisos). Cada aviso sale una sola vez por vencimiento. Bajo cada texto, toca una variable para insertarla.</p>
        <label class="inline"><input type="checkbox" id="av-activo"> Avisar solo</label>
        <label class="inline"><input type="checkbox" id="av-tienda"> También a la tienda (si tiene WhatsApp en su contacto)</label>
        <label for="av-vence7">A 7 días</label><textarea id="av-vence7" data-tipo="vence7"></textarea><a href="#" class="ver-como" data-para="av-vence7">Ver cómo queda</a><div class="vista-previa hidden" id="vp-av-vence7"></div>
        <label for="av-vence1">A 1 día</label><textarea id="av-vence1" data-tipo="vence1"></textarea><a href="#" class="ver-como" data-para="av-vence1">Ver cómo queda</a><div class="vista-previa hidden" id="vp-av-vence1"></div>
        <label for="av-vencida">El día que vence</label><textarea id="av-vencida" data-tipo="vencida"></textarea><a href="#" class="ver-como" data-para="av-vencida">Ver cómo queda</a><div class="vista-previa hidden" id="vp-av-vencida"></div>
        <details class="ayuda" style="margin:8px 0 0"><summary style="cursor:pointer">Qué significa cada variable</summary><p style="margin:6px 0 0"><code>{tienda}</code> su nombre · <code>{fecha}</code> hasta cuándo está pagada · <code>{dias}</code> los que faltan · <code>{plan}</code> · <code>{precio}</code> y <code>{moneda}</code> al mes · <code>{contacto}</code> cómo renovar · en el recibo, además <code>{meses}</code> y <code>{monto}</code> del pago · <code>{lineas}</code> una línea por tienda (solo en lo que recibes tú).</p></details>
        <label for="av-dueno">Lo que recibes tú <span class="muted">(<code>{lineas}</code> = una línea por tienda)</span></label><textarea id="av-dueno"></textarea>
        <h3 style="margin:16px 0 4px;font-size:var(--fs-h3)">Recibo de pago</h3>
        <p class="muted ayuda">Al apuntar un pago (a mano o aceptando una captura), la tienda recibe por WhatsApp su recibo con hasta cuándo queda pagada.</p>
        <label class="inline"><input type="checkbox" id="av-recibo-activo"> Mandar el recibo por WhatsApp</label>
        <label for="av-recibo">El recibo</label><textarea id="av-recibo" data-tipo="recibo"></textarea><a href="#" class="ver-como" data-para="av-recibo">Ver cómo queda</a><div class="vista-previa hidden" id="vp-av-recibo"></div>
        <h3 style="margin:16px 0 4px;font-size:var(--fs-h3)">Tiendas que no dan señales</h3>
        <p class="muted ayuda">Cada instalación pregunta por su plan cada cuarto de hora. Si una lleva más de estas horas sin preguntar en horario de trabajo (9:00 a 20:00), te avisa por WhatsApp una vez al día: suele ser que su servidor está apagado o sin red.</p>
        <div class="fila"><label for="av-latido-horas">Avisar cuando lleve más de (horas) <span class="muted">0 = no avisar</span></label><input id="av-latido-horas" type="number" min="0" max="48" style="max-width:120px"></div>
        <label for="av-latido">Lo que recibes tú <span class="muted">(<code>{lineas}</code> = una línea por tienda)</span></label><textarea id="av-latido"></textarea>
        <div style="margin-top:10px"><button class="btn sm primario" id="av-guardar" type="button">Guardar avisos</button></div>
        <div id="av-ultima" class="muted" style="margin-top:10px;font-size:13px"></div>
      </div>
    </div>
  </div>
</div>
</div>
</div>
`;

  /* La marca de abajo separa el JS de esta pantalla del que trae el armazon:
     asi la prueba puede correr solo este trozo con un DOM de mentira. */
  const script = String.raw`
/* === pantalla Tiendas === */
async function api(path, options) {
  options = options || {};
  var res = await fetch(path, { method: options.method || 'GET', cache: 'no-store', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: options.body ? JSON.stringify(options.body) : undefined });
  var data = await res.json().catch(function () { return {}; });
  if (res.status === 401) { irAlLogin(); throw new Error('Tu sesión terminó: vuelve a entrar.'); }
  if (!res.ok) { var e = new Error(data.error || errorHttp(res.status)); e.status = res.status; e.datos = data; throw e; }
  return data;
}
function esc(v) { return String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function toast(texto) { var nodo = document.createElement('div'); nodo.className = 'toast'; nodo.setAttribute('role', 'status'); nodo.textContent = texto; document.body.appendChild(nodo); setTimeout(function () { nodo.remove(); }, 5000); }
function el(id) { return document.getElementById(id); }
function val(id) { return (el(id).value || '').trim(); }
function setVal(id, v) { el(id).value = v === null || v === undefined ? '' : v; }
function alPulsar(id, fn) { var b = el(id); if (b) b.onclick = fn; }
function mostrar(id, visible) { var x = el(id); if (x) x.classList.toggle('hidden', !visible); }

/* Fechas y dinero: siempre la hora de Lima y siempre dos decimales, para que
   la misma cifra no salga de dos maneras en dos sitios de la pantalla. */
function fecha(iso) { if (!iso) return ''; return new Date(iso).toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' }); }
function hora(iso) { if (!iso) return ''; return new Date(iso).toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false }); }
function fechaHora(iso) { return iso ? fecha(iso) + ' ' + hora(iso) : ''; }
function dinero(moneda, monto) {
  var n = Number(monto);
  if (!isFinite(n)) return '';
  return ((moneda || '') + ' ' + n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })).trim();
}
function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }
/* tono: verde | ambar | rojo | azul | gris (las clases compartidas del armazon). */
function chip(tono, texto) { return '<span class="chip tono-' + tono + '">' + esc(texto) + '</span>'; }

/* «Rosa · 987 654 321»: el formato con el que el servidor saca el WhatsApp del contacto. */
function componerContacto(nombre, tel) {
  var d = (tel || '').replace(/\D/g, '');
  if (d.length === 11 && d.indexOf('51') === 0) d = d.slice(2);
  var bonito = d.length === 9 ? d.slice(0, 3) + ' ' + d.slice(3, 6) + ' ' + d.slice(6) : d;
  if (nombre && bonito) return nombre + ' · ' + bonito;
  return nombre || bonito || '';
}
function partirContacto(contacto) {
  var c = contacto || '';
  var m = /(\+?\s*5?1?\s*9(?:\s*\d){8})\s*$/.exec(c);
  if (!m) return { nombre: c.trim(), tel: '' };
  return { nombre: c.slice(0, m.index).replace(/[·\-–,]\s*$/, '').trim(), tel: m[1].replace(/\D/g, '') };
}
function celularValido(tel) { var d = (tel || '').replace(/\D/g, ''); return !d || /^9\d{8}$/.test(d) || /^519\d{8}$/.test(d); }

function leerImagen(input) {
  return new Promise(function (resolver, rechazar) {
    var f = input.files && input.files[0];
    if (!f) return resolver(null);
    if (f.size > 2 * 1024 * 1024) return rechazar(new Error('La imagen pesa más de 2 MB: recórtala o baja la calidad.'));
    var r = new FileReader();
    r.onload = function () { resolver(String(r.result)); };
    r.onerror = function () { rechazar(new Error('No se pudo leer la imagen.')); };
    r.readAsDataURL(f);
  });
}

var datos = null;
var planes = [];
var historialAbierto = {};
var capturaAbierta = {};

/**
 * El estado de la membresía en una palabra, un color y un detalle.
 *
 * Una sola regla para toda la pantalla (tarjetas, tabla y orden): el
 * servidor ya marca «vencido» cuando está suspendida, así que primero se
 * mira el estado y solo después la fecha; si no, una tienda suspendida se
 * leería como vencida y el dueño la cobraría dos veces.
 */
function estadoMembresia(t) {
  var hasta = fecha(t.membresia.vencimiento);
  if (t.membresia.estado === 'suspendida') return { clave: 'suspendida', tono: 'gris', texto: 'Suspendida', detalle: 'estaba pagada hasta el ' + hasta };
  if (t.plan.vencido) {
    var dias = Math.abs(t.plan.diasRestantes);
    return { clave: 'vencida', tono: 'rojo', texto: 'Vencida', detalle: 'venció el ' + hasta + (dias ? ' · hace ' + plural(dias, 'día', 'días') : ' · hoy') };
  }
  if (t.plan.diasRestantes <= 7) return { clave: 'porVencer', tono: 'ambar', texto: t.plan.diasRestantes === 1 ? 'Vence mañana' : 'Vence en ' + plural(t.plan.diasRestantes, 'día', 'días'), detalle: 'hasta el ' + hasta };
  return { clave: 'alDia', tono: 'verde', texto: 'Al día', detalle: 'hasta el ' + hasta };
}

/* Lo que necesita atención sube: primero lo que cuesta dinero, luego lo que está roto. */
var ORDEN_ESTADO = { vencida: 0, suspendida: 1, porVencer: 2, alDia: 4 };
function urgencia(t) {
  if (t.pagosPendientes) return -1;
  var base = ORDEN_ESTADO[estadoMembresia(t).clave];
  if (base === 4 && t.salud.whatsapp.nivel === 'bad') return 3;
  return base;
}

function saludHtml(t) {
  var s = t.salud;
  var luz = function (nivel, texto) { return '<span><span class="luz ' + esc(nivel) + '"></span>' + esc(texto) + '</span>'; };
  var conexion = t.enLinea
    ? luz('ok', 'En línea')
    : t.ultimaConsultaAt
      ? luz('bad', 'Sin conexión · última vez ' + fechaHora(t.ultimaConsultaAt))
      : luz('warn', 'Nunca se conectó');
  if (!s.parteAt) return '<div class="salud">' + conexion + '<span class="sub">Sin parte todavía: su instalación aún no preguntó por su plan.</span></div>';
  var pie = (s.entregasHoy !== null ? plural(s.entregasHoy, 'entrega', 'entregas') + ' hoy · ' : '') + 'parte ' + s.hace + (s.version ? ' · v' + s.version : '') + (s.parteViejo ? ' · sin noticias desde entonces' : '');
  var soporte = s.soporte
    ? '<a class="soporte-tienda" href="' + esc(s.soporte.enlace) + '" target="_blank" rel="noopener" title="La tienda te dio acceso de soporte: entras como administrador hasta esa hora">🔑 Entrar a su panel (acceso hasta las ' + esc(hora(s.soporte.hasta)) + ')</a>'
    : '';
  return '<div class="salud">' + conexion + luz(s.whatsapp.nivel, s.whatsapp.texto) + luz(s.mensajes.nivel, s.mensajes.texto) + luz(s.ia.nivel, s.ia.texto) +
    '<span class="sub' + (s.parteViejo ? ' viejo' : '') + '">' + esc(pie) + '</span>' + soporte + '</div>';
}

function pintarTarjetas(r) {
  var s = r.resumen;
  /* Lo que pide atención va primero y solo aparece cuando lo hay: si no sale
     ninguna tarjeta de color, es que todo está en orden. */
  var atencion = [
    ['rojo', s.vencidas, 'vencidas'],
    ['ambar', s.porVencer, 'por vencer (7 días)'],
    ['ambar', s.pagosPendientes, 'pagos por revisar'],
    ['rojo', s.conProblemas, 'con el WhatsApp caído'],
    ['gris', s.suspendidas, 'suspendidas'],
  ].filter(function (x) { return x[1] > 0; }).map(function (x) { return [x[0] + ' aviso', x[1], x[2]]; });
  var siempre = [
    ['', s.total, s.total === 1 ? 'tienda' : 'tiendas'],
    ['verde', s.activas - s.porVencer, 'al día'],
    ['azul', s.enLinea, 'en línea ahora'],
    ['verde', dinero(s.moneda, s.ingresosMes), 'ingresos al mes'],
  ];
  el('tarjetas').innerHTML = atencion.concat(siempre).map(function (x) {
    return '<div class="tarjeta ' + x[0] + '"><div class="n">' + esc(x[1]) + '</div><div class="q">' + esc(x[2]) + '</div></div>';
  }).join('');
}

function pintarPagos(r) {
  var lista = r.pagosPendientes || [];
  mostrar('caja-pagos', lista.length > 0);
  el('pagos-n').innerHTML = lista.length ? chip('ambar', plural(lista.length, 'captura', 'capturas')) : '';
  var caja = el('pagos');
  caja.innerHTML = lista.map(function (p) {
    var huerfano = !p.tienda;
    var abierta = capturaAbierta[p.id];
    var importe = p.monto !== null && p.monto !== undefined ? ' · ' + dinero(p.moneda, p.monto) : '';
    return '<div class="pago"><b>' + esc(p.tienda ? p.tienda.nombre : 'Tienda borrada') + '</b> · ' + esc(plural(p.meses, 'mes', 'meses')) + esc(importe) +
      '<div class="sub muted">' + esc(fechaHora(p.at)) + (p.nota ? ' · ' + esc(p.nota) : '') + '</div>' +
      (huerfano ? '<div class="sub muted">Esa tienda ya no está en la lista: no hay a quién apuntarle el pago.</div>' : '') +
      '<div class="acciones" style="margin-top:6px">' +
      '<button class="btn sm" data-ver="' + p.id + '" type="button">' + (abierta ? 'Ocultar la captura' : 'Ver la captura') + '</button>' +
      (huerfano ? '' :
        '<button class="btn sm primario" data-aceptar="' + p.id + '" type="button" aria-label="Apuntar el pago de ' + esc(p.tienda.nombre) + '">Apuntar el pago</button>' +
        '<button class="btn sm peligro" data-rechazar="' + p.id + '" type="button" aria-label="Rechazar la captura de ' + esc(p.tienda.nombre) + '">Rechazar</button>') +
      '</div><div id="captura-' + p.id + '">' + (abierta ? '<img src="' + esc(abierta) + '" alt="captura del pago">' : '') + '</div></div>';
  }).join('');

  caja.querySelectorAll('[data-ver]').forEach(function (b) {
    b.onclick = async function () {
      var id = b.getAttribute('data-ver');
      if (capturaAbierta[id]) { delete capturaAbierta[id]; el('captura-' + id).innerHTML = ''; b.textContent = 'Ver la captura'; return; }
      try {
        var r2 = await api('/admin/tiendas/pagos/' + id);
        if (!r2.pago.imagen) { el('captura-' + id).innerHTML = '<span class="muted">La tienda mandó el pago sin imagen.</span>'; return; }
        capturaAbierta[id] = r2.pago.imagen;
        el('captura-' + id).innerHTML = '<img src="' + esc(r2.pago.imagen) + '" alt="captura del pago">';
        b.textContent = 'Ocultar la captura';
      } catch (e) { toast(e.message); }
    };
  });
  caja.querySelectorAll('[data-aceptar]').forEach(function (b) {
    b.onclick = async function () {
      if (!(await confirmarDialogo({ titulo: 'Apuntar el pago', texto: 'Se apunta con los meses que dijo la tienda y su membresía corre desde la fecha pagada (o desde hoy si ya venció).', boton: 'Apuntar' }))) return;
      var id = b.getAttribute('data-aceptar');
      try { var r2 = await api('/admin/tiendas/pagos/' + id + '/aceptar', { method: 'POST', body: {} }); delete capturaAbierta[id]; toast(r2.mensaje); await cargar(); }
      catch (e) { toast(e.message); }
    };
  });
  caja.querySelectorAll('[data-rechazar]').forEach(function (b) {
    b.onclick = async function () {
      var motivo = await pedirDato({ titulo: 'Rechazar la captura', texto: 'La tienda va a leer este motivo en su pantalla Pagar.', etiqueta: 'Motivo', marcador: 'La captura no se ve / el monto no coincide…', boton: 'Rechazar', validar: function (v) { return v.trim() ? null : 'Escribe el motivo.'; } });
      if (!motivo) return;
      var id = b.getAttribute('data-rechazar');
      try { var r2 = await api('/admin/tiendas/pagos/' + id + '/rechazar', { method: 'POST', body: { motivo: motivo } }); delete capturaAbierta[id]; toast(r2.mensaje); await cargar(); }
      catch (e) { toast(e.message); }
    };
  });
}

function filaTienda(t) {
  var e = estadoMembresia(t);
  var marcas = (t.instalada ? ' ' + chip('azul', 'instalada aquí') : '') + (t.pagosPendientes ? ' ' + chip('ambar', plural(t.pagosPendientes, 'pago por revisar', 'pagos por revisar')) : '');
  var acciones = '<div class="acciones">' +
    '<button class="btn sm" data-pago="' + esc(t.id) + '" type="button" aria-label="Apuntar un pago de ' + esc(t.nombre) + '">Apuntar pago</button>' +
    '<button class="btn sm" data-avisar="' + esc(t.id) + '" type="button" aria-label="Escribirle por WhatsApp a ' + esc(t.nombre) + '"' + (t.telefonoContacto ? '' : ' title="Ponle un WhatsApp en su contacto con «Cambiar datos»"') + '>Avisar por WhatsApp</button>' +
    '<button class="btn sm enlace" data-editar="' + esc(t.id) + '" type="button">Cambiar plan</button>' +
    '<button class="btn sm enlace" data-datos="' + esc(t.id) + '" type="button">Cambiar datos</button>' +
    '<button class="btn sm enlace" data-token="' + esc(t.id) + '" type="button">Token nuevo</button>' +
    '<button class="btn sm enlace" data-historial="' + esc(t.id) + '" type="button" aria-expanded="' + (historialAbierto[t.id] ? 'true' : 'false') + '">' + (historialAbierto[t.id] ? 'Ocultar historial' : 'Historial') + '</button>' +
    (t.url ? '<a class="btn sm enlace" href="' + esc(t.url) + '" target="_blank" rel="noopener">Abrir su panel</a>' : '') +
    '<button class="btn sm enlace' + (e.clave === 'suspendida' ? '' : ' peligro') + '" data-susp="' + esc(t.id) + '" data-valor="' + (e.clave === 'suspendida' ? 'false' : 'true') + '" type="button">' + (e.clave === 'suspendida' ? 'Reactivar' : 'Suspender') + '</button>' +
    '<button class="btn sm enlace peligro" data-borrar="' + esc(t.id) + '" type="button">Borrar</button></div>';
  return '<tr><td><b>' + esc(t.nombre) + '</b>' + marcas + '<div class="sub">' + esc(t.slug) + (t.url ? ' · ' + esc(t.url) : '') + (t.contacto ? '<br>' + esc(t.contacto) : '') + '</div></td>' +
    '<td data-etiqueta="Plan">' + esc(t.plan.nombre) + '<div class="sub">' + (t.membresia.precioMes ? esc(dinero(t.membresia.moneda, t.membresia.precioMes)) + '/mes' : 'gratis') + '</div></td>' +
    '<td data-etiqueta="Membresía">' + chip(e.tono, e.texto) + '<div class="sub">' + esc(e.detalle) + '</div></td>' +
    '<td data-etiqueta="Salud y conexión">' + saludHtml(t) + '</td></tr>' +
    '<tr class="fila-acciones"><td colspan="4">' + acciones + '</td></tr>' +
    (historialAbierto[t.id] ? '<tr class="historial"><td colspan="4" id="hist-' + esc(t.id) + '"><span class="muted">Cargando…</span></td></tr>' : '');
}

function pintarTiendas(r) {
  var tb = el('tiendas');
  if (!r.tiendas.length) {
    tb.innerHTML = '<tr><td colspan="4"><div class="vacio"><div class="ico">🏪</div><h3>Todavía no hay tiendas</h3><p>Cada negocio al que le pongas el sistema aparece aquí con su plan, su salud y sus pagos. Da de alta la primera: saldrá un token para conectar su instalación.</p><div class="acciones"><button class="btn sm primario" data-ir-alta type="button">Dar de alta la primera</button></div></div></td></tr>';
    var b0 = tb.querySelector('[data-ir-alta]');
    if (b0) b0.onclick = irAlAlta;
    return;
  }
  var lista = r.tiendas.slice().sort(function (a, b) { return urgencia(a) - urgencia(b) || a.nombre.localeCompare(b.nombre, 'es'); });
  tb.innerHTML = lista.map(filaTienda).join('');
  lista.forEach(function (t) { if (historialAbierto[t.id]) cargarHistorial(t.id); });

  var tiendaDe = function (b, attr) { var id = b.getAttribute(attr); return { id: id, t: datos.tiendas.filter(function (x) { return x.id === id; })[0] }; };

  tb.querySelectorAll('[data-pago]').forEach(function (b) {
    b.onclick = async function () {
      var id = b.getAttribute('data-pago');
      var meses = await pedirDato({ titulo: 'Apuntar un pago', texto: 'Cuántos meses se pagaron. Corre el vencimiento desde la fecha pagada (o desde hoy si ya venció) y reactiva la tienda.', etiqueta: 'Meses', valor: '1', boton: 'Siguiente', validar: function (v) { return /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 60 ? null : 'Entre 1 y 60 meses.'; } });
      if (!meses) return;
      var monto = await pedirDato({ titulo: 'Monto cobrado', etiqueta: 'Monto (0 si es cortesía)', valor: '0', boton: 'Apuntar', validar: function (v) { return /^\d+([.,]\d{1,2})?$/.test(v) ? null : 'Un número, por ejemplo 49 o 49.90'; } });
      if (monto === null) return;
      try { var r2 = await api('/admin/tiendas/' + id + '/pagos', { method: 'POST', body: { meses: Number(meses), monto: Number(String(monto).replace(',', '.')) } }); toast(r2.mensaje); await cargar(); } catch (e) { toast(e.message); }
    };
  });
  tb.querySelectorAll('[data-editar]').forEach(function (b) {
    b.onclick = async function () {
      var x = tiendaDe(b, 'data-editar');
      if (!x.t) return;
      var plan = await pedirDato({ titulo: 'Cambiar el plan de ' + x.t.nombre, texto: 'Escribe uno: ' + planes.map(function (p) { return p.clave; }).join(', ') + '.', etiqueta: 'Plan', valor: x.t.membresia.plan, boton: 'Siguiente', validar: function (v) { return planes.some(function (p) { return p.clave === v.trim(); }) ? null : 'No existe ese plan.'; } });
      if (!plan) return;
      var vence = await pedirDato({ titulo: 'Pagada hasta', etiqueta: 'Fecha (AAAA-MM-DD)', valor: x.t.membresia.vencimiento.slice(0, 10), boton: 'Guardar', validar: function (v) { return /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : 'Formato AAAA-MM-DD.'; } });
      if (!vence) return;
      try { await api('/admin/tiendas/' + x.id, { method: 'POST', body: { membresia: { plan: plan.trim(), vencimiento: vence } } }); toast('Plan cambiado.'); await cargar(); } catch (e) { toast(e.message); }
    };
  });
  tb.querySelectorAll('[data-datos]').forEach(function (b) {
    b.onclick = async function () {
      var x = tiendaDe(b, 'data-datos');
      if (!x.t) return;
      var nombre = await pedirDato({ titulo: 'Nombre de la tienda', etiqueta: 'Nombre', valor: x.t.nombre, boton: 'Siguiente', validar: function (v) { return v.trim() ? null : 'Escribe el nombre.'; } });
      if (nombre === null) return;
      var partes = partirContacto(x.t.contacto);
      var contactoNombre = await pedirDato({ titulo: 'Persona de contacto', texto: 'Quién atiende por la tienda.', etiqueta: 'Nombre', valor: partes.nombre, boton: 'Siguiente', validar: function () { return null; } });
      if (contactoNombre === null) return;
      var contactoTel = await pedirDato({ titulo: 'Su WhatsApp', texto: 'Para poder avisarle desde aquí (vencimientos, pagos). Vacío si no lo sabes.', etiqueta: 'Celular (9 cifras)', marcador: '987 654 321', valor: partes.tel, boton: 'Siguiente', validar: function (v) { return celularValido(v) ? null : 'Tiene que ser un celular de 9 cifras (empieza por 9).'; } });
      if (contactoTel === null) return;
      var url = await pedirDato({ titulo: 'Dirección de su sistema', texto: 'Vacío si no la sabes.', etiqueta: 'Dirección (https://…)', valor: x.t.url || '', boton: 'Guardar', validar: function (v) { return !v.trim() || /^https?:\/\//i.test(v.trim()) ? null : 'Tiene que empezar por http:// o https://'; } });
      if (url === null) return;
      var contacto = componerContacto(contactoNombre.trim(), contactoTel);
      try { await api('/admin/tiendas/' + x.id, { method: 'POST', body: { nombre: nombre.trim(), contacto: contacto || null, url: url.trim() || null } }); toast('Datos guardados.'); await cargar(); } catch (e) { toast(e.message); }
    };
  });
  tb.querySelectorAll('[data-susp]').forEach(function (b) {
    b.onclick = async function () {
      var suspender = b.getAttribute('data-valor') === 'true';
      if (suspender && !(await confirmarDialogo({ titulo: 'Suspender la tienda', texto: 'Su asistente IA y sus campañas se paran en cuanto vuelva a preguntar por el plan (como mucho un cuarto de hora). Sus chats siguen. Se reactiva con un clic.', boton: 'Suspender', peligro: true }))) return;
      try { var r3 = await api('/admin/tiendas/' + b.getAttribute('data-susp') + '/suspender', { method: 'POST', body: { suspendida: suspender } }); toast(r3.mensaje); await cargar(); } catch (e) { toast(e.message); }
    };
  });
  tb.querySelectorAll('[data-token]').forEach(function (b) {
    b.onclick = async function () {
      if (!(await confirmarDialogo({ titulo: 'Token nuevo', texto: 'El token anterior deja de valer: esa tienda dejará de recibir su plan hasta que pegues el nuevo en su Membresía.', boton: 'Crear token nuevo' }))) return;
      try { var r4 = await api('/admin/tiendas/' + b.getAttribute('data-token') + '/token', { method: 'POST', body: {} }); mostrarToken(r4.tienda, r4.token, ['Pégalo en la Membresía de esa tienda (Esta instalación depende de un maestro) junto a la dirección del plan.']); toast(r4.mensaje); await cargar(); } catch (e) { toast(e.message); }
    };
  });
  tb.querySelectorAll('[data-avisar]').forEach(function (b) {
    b.onclick = async function () {
      var x = tiendaDe(b, 'data-avisar');
      if (!x.t) return;
      if (!x.t.telefonoContacto) { toast('La tienda no tiene el WhatsApp de su contacto: ponlo con «Cambiar datos».'); return; }
      var texto = await pedirDato({ titulo: 'Escribirle a ' + x.t.nombre, texto: 'Sale por tu WhatsApp al +' + x.t.telefonoContacto + '.', etiqueta: 'Mensaje', marcador: 'Hola, te escribo de GSGchat…', boton: 'Enviar', validar: function (v) { return v.trim() ? null : 'Escribe el mensaje.'; } });
      if (!texto) return;
      try { var r5 = await api('/admin/tiendas/' + x.id + '/avisar', { method: 'POST', body: { texto: texto } }); toast(r5.mensaje); } catch (e) { toast(e.message); }
    };
  });
  tb.querySelectorAll('[data-historial]').forEach(function (b) {
    b.onclick = function () { var id = b.getAttribute('data-historial'); historialAbierto[id] = !historialAbierto[id]; pintarTiendas(datos); };
  });
  tb.querySelectorAll('[data-borrar]').forEach(function (b) {
    b.onclick = async function () {
      var x = tiendaDe(b, 'data-borrar');
      if (!x.t) return;
      var que = 'dejar';
      if (x.t.instalada) {
        var eleccion = await pedirDato({ titulo: 'Borrar ' + x.t.nombre, texto: 'Esta tienda tiene su instalación en este servidor. ¿Qué hago con ella? Escribe: dejar (sigue corriendo, solo sale de la lista), parar (se apaga, sus datos se conservan) o borrar (se apaga y se borran sus datos).', etiqueta: 'dejar · parar · borrar', valor: 'parar', boton: 'Borrar la tienda', validar: function (v) { return ['dejar', 'parar', 'borrar'].indexOf(v.trim().toLowerCase()) >= 0 ? null : 'Escribe dejar, parar o borrar.'; } });
        if (!eleccion) return;
        que = eleccion.trim().toLowerCase();
      } else if (!(await confirmarDialogo({ titulo: 'Borrar la tienda', texto: 'Se borra de esta lista y su instalación dejará de recibir plan (quedará como instalación libre o con lo último que supo). No se toca nada en su servidor.', boton: 'Borrar', peligro: true }))) return;
      try { var r6 = await api('/admin/tiendas/' + x.id + '?instalacion=' + que, { method: 'DELETE' }); delete historialAbierto[x.id]; toast(r6.mensaje || 'Borrada.'); await cargar(); } catch (e) { toast(e.message); }
    };
  });
}

async function cargarHistorial(id) {
  var caja = el('hist-' + id);
  if (!caja) return;
  try {
    var r = await api('/admin/tiendas/' + id + '/historial');
    if (!r.historial.length) { caja.innerHTML = '<span class="muted">Todavía no hay nada apuntado de esta tienda.</span>'; return; }
    caja.innerHTML = '<b style="font-size:13px">Historial de ' + esc(r.tienda.nombre) + '</b><ul class="hist">' + r.historial.map(function (h) {
      var d = h.detalle || {};
      var extra = [];
      if (d.meses) extra.push(plural(d.meses, 'mes', 'meses'));
      if (d.monto !== undefined && d.monto !== null && d.monto !== '') extra.push(dinero(d.moneda, d.monto));
      if (d.suspendida !== undefined) extra.push(d.suspendida ? 'suspendida' : 'reactivada');
      if (d.nota) extra.push(d.nota);
      if (d.motivo) extra.push(d.motivo);
      return '<li>' + esc(fechaHora(h.at)) + ' · <b>' + esc(h.etiqueta) + '</b> · ' + esc(h.usuario) + (extra.length ? ' <span class="muted">(' + esc(extra.join(' · ')) + ')</span>' : '') + '</li>';
    }).join('') + '</ul>';
  } catch (e) { caja.innerHTML = '<span class="muted">No se pudo cargar el historial: ' + esc(e.message) + '</span>'; }
}

function mostrarToken(tienda, token, pasos) {
  el('ti-nueva-nombre').textContent = tienda.nombre;
  el('ti-token').textContent = token;
  el('ti-url-plan').textContent = tienda.urlPlan;
  el('ti-pasos').innerHTML = (pasos || []).map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('');
  el('ti-nueva').classList.remove('hidden');
  el('ti-nueva').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function pintarCobro(c) {
  el('cb-activo').checked = Boolean(c.activo);
  setVal('cb-numero', c.numero || '');
  setVal('cb-texto', c.texto || '');
  var img = el('cb-qr-vista');
  mostrar('cb-qr-vista', Boolean(c.qr));
  if (c.qr) img.src = c.qr;
  mostrar('cb-quitar-qr', Boolean(c.qr));
}

function pintarAlojamiento(al) {
  el('alojamiento').innerHTML = al.disponible
    ? '<b class="listo">Alojamiento en este servidor: listo.</b> Cada tienda nueva puede salir con su propia dirección (nombre.' + esc(al.dominioBase) + '), ya conectada a este panel.'
    : '<b>Sin alojamiento en este servidor.</b> ' + esc(al.motivo || '') + ' La tienda se registra aquí y su instalación se hace aparte; luego se pega la dirección del plan y el token en su Membresía.';
  mostrar('ti-instalar-caja', Boolean(al.disponible));
}

async function cargarPlanes() {
  if (planes.length) return;
  try {
    var m = await api('/admin/membresia');
    planes = m.planes || [];
    var sel = el('ti-plan');
    sel.innerHTML = planes.map(function (p) { return '<option value="' + esc(p.clave) + '">' + esc(p.nombre) + (p.precioMes ? ' · ' + esc(dinero(p.moneda, p.precioMes)) + '/mes' : '') + '</option>'; }).join('');
    sel.value = 'prueba';
    setVal('ti-vence', new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
    setVal('ti-precio', '0');
    sel.onchange = function () { var p = planes.filter(function (x) { return x.clave === sel.value; })[0]; if (p) setVal('ti-precio', p.precioMes); };
  } catch (e) {
    /* Sin membresia en este arranque no hay catalogo: el plan se escribe a mano y se dice, no se calla. */
    el('ti-plan').innerHTML = '<option value="prueba">prueba</option>';
    toast('No se pudo leer el catálogo de planes: ' + e.message);
  }
}

async function cargarAvisos() {
  var ultima = el('av-ultima');
  try {
    var r = await api('/admin/tiendas/avisos');
    if (!r.disponible) {
      el('av-cuerpo').innerHTML = '<p class="muted ayuda">Este arranque no lleva avisos de vencimiento: los vencimientos hay que mirarlos en la lista.</p>';
      mostrar('av-revisar', false);
      return;
    }
    var t = r.textos;
    el('av-activo').checked = Boolean(t.activo);
    el('av-tienda').checked = Boolean(t.aLaTienda);
    setVal('av-vence7', t.vence7); setVal('av-vence1', t.vence1); setVal('av-vencida', t.vencida); setVal('av-dueno', t.alDueno);
    el('av-recibo-activo').checked = t.reciboActivo !== false;
    setVal('av-recibo', t.recibo || ''); setVal('av-latido', t.sinLatido || '');
    el('av-latido-horas').value = t.sinLatidoHoras === undefined ? 1 : t.sinLatidoHoras;
    var chips = function (id, vars) { if (window.chipsDeVariables) window.chipsDeVariables(el(id), vars); };
    chips('av-vence7', r.variables || []); chips('av-vence1', r.variables || []); chips('av-vencida', r.variables || []);
    chips('av-recibo', r.variablesRecibo || []); chips('av-dueno', ['{lineas}']); chips('av-latido', ['{lineas}']);
    pintarUltimaRevision(r.ultimaRevision);
  } catch (e) {
    /* La caja puede haberse quedado sin cuerpo: se avisa donde se pueda. */
    if (ultima && document.body.contains(ultima)) ultima.textContent = 'No se pudieron leer los avisos: ' + e.message;
    else toast('No se pudieron leer los avisos: ' + e.message);
  }
}

function pintarUltimaRevision(u) {
  var caja = el('av-ultima');
  if (!caja) return;
  if (!u) { caja.textContent = 'Todavía no se revisó en este arranque (se revisa solo cada hora).'; return; }
  var lineas = (u.mandados || []).map(function (m) {
    var tipo = m.tipo === 'vencida' ? 'venció' : m.tipo === 'vence1' ? 'vence mañana' : 'vence en 7 días';
    var como = m.aTienda ? 'avisada al +' + esc(m.aTienda) : m.fallo ? 'sin avisar a la tienda: ' + esc(m.fallo) : 'solo a ti';
    return '<div class="aviso-linea"><b>' + esc(m.tienda) + '</b> · ' + tipo + ' · ' + como + (m.alDueno ? ' · a ti también' : '') + '</div>';
  }).join('');
  caja.innerHTML = 'Última revisión: ' + esc(fechaHora(u.cuando)) + ' · ' + esc(plural(u.revisadas, 'tienda', 'tiendas')) +
    (u.apagado ? ' · avisos apagados' : '') +
    (u.yaAvisadas ? ' · ' + esc(u.yaAvisadas) + ' ya avisada' + (u.yaAvisadas === 1 ? '' : 's') : '') +
    (lineas ? '<div style="margin-top:6px">' + lineas + '</div>' : ' · nada que avisar');
}

/* El fallo se ve en la pantalla, no solo en un aviso que se va solo: si la
   lista se quedo vieja, hay que saberlo antes de cobrarle a nadie. */
function marcarDesfase(mensaje) {
  var x = el('aviso-carga');
  x.innerHTML = mensaje ? chip('rojo', 'sin actualizar') : '';
  x.title = mensaje || '';
  x.classList.toggle('hidden', !mensaje);
}

function errorEnTabla(mensaje) {
  var tb = el('tiendas');
  tb.innerHTML = '<tr><td colspan="4"><div class="vacio"><div class="ico">⚠️</div><h3>No se pudo cargar la lista</h3><p>' + esc(mensaje) + '</p><div class="acciones"><button class="btn sm primario" data-reintentar type="button">Reintentar</button></div></div></td></tr>';
  var b = tb.querySelector('[data-reintentar]');
  if (b) b.onclick = function () { tb.innerHTML = '<tr><td colspan="4"><div class="cargando">Cargando…</div></td></tr>'; cargar(); };
}

/* Nunca lanza: los fallos se pintan. Asi el refresco de cada minuto no
   necesita un catch vacio que se trague lo que pasa. */
async function cargar(opciones) {
  var silencioso = opciones && opciones.silencioso;
  var r;
  try {
    r = await api('/admin/tiendas');
  } catch (e) {
    if (e.status === 403) { mostrar('solo-super', true); mostrar('todo', false); return; }
    if (!datos) errorEnTabla(e.message);
    marcarDesfase(e.message);
    if (!silencioso) toast(e.message);
    return;
  }
  datos = r;
  marcarDesfase(null);
  mostrar('solo-super', false);
  mostrar('todo', true);
  pintarTarjetas(r);
  pintarPagos(r);
  pintarTiendas(r);
  pintarCobro(r.cobro || {});
  pintarAlojamiento(r.alojamiento || {});
  await cargarPlanes();
}

function irAlAlta() {
  el('caja-alta').scrollIntoView({ behavior: 'smooth' });
  el('ti-nombre').focus();
}

alPulsar('recargar', function () { cargar(); });
alPulsar('ir-alta', irAlAlta);
alPulsar('ti-crear', async function () {
  var b = el('ti-crear');
  b.disabled = true;
  try {
    var telContacto = val('ti-contacto-tel').replace(/\D/g, '');
    if (!celularValido(telContacto)) throw new Error('El WhatsApp del contacto tiene que ser un celular de 9 cifras (empieza por 9).');
    if (!val('ti-nombre')) throw new Error('Escribe el nombre del negocio.');
    var instalar = !el('ti-instalar-caja').classList.contains('hidden') && el('ti-instalar').checked;
    if (instalar) toast('Dando de alta y levantando su instalación… tarda un minuto.');
    var r = await api('/admin/tiendas', { method: 'POST', body: {
      nombre: val('ti-nombre'),
      slug: val('ti-slug') || undefined,
      url: val('ti-url') || null,
      contacto: componerContacto(val('ti-contacto-nombre'), telContacto) || null,
      crearInstalacion: instalar,
      membresia: { plan: val('ti-plan') || 'prueba', vencimiento: val('ti-vence'), precioMes: Number(val('ti-precio') || 0), contacto: val('ti-renovar') || null },
    } });
    mostrarToken(r.tienda, r.token, r.pasos);
    toast(r.mensaje || (r.instalacion && r.instalacion.ok ? 'Tienda dada de alta con su instalación en ' + r.instalacion.url : 'Tienda dada de alta.'));
    setVal('ti-nombre', ''); setVal('ti-slug', ''); setVal('ti-url', ''); setVal('ti-contacto-nombre', ''); setVal('ti-contacto-tel', '');
    await cargar();
  } catch (e) {
    toast(e.message);
  } finally {
    /* Sin esto, cualquier salida temprana dejaba el boton inhabilitado para siempre. */
    b.disabled = false;
  }
});
alPulsar('ti-copiar', function () {
  navigator.clipboard.writeText(el('ti-token').textContent).then(function () { toast('Token copiado'); }, function () { toast('Tu navegador no dejó copiar: selecciónalo y cópialo a mano.'); });
});
alPulsar('ti-cerrar', function () { mostrar('ti-nueva', false); });

alPulsar('cb-guardar', async function () {
  var b = el('cb-guardar');
  b.disabled = true;
  try {
    var qr = await leerImagen(el('cb-qr'));
    var body = { activo: el('cb-activo').checked, numero: val('cb-numero'), texto: val('cb-texto') };
    if (qr) body.qr = qr;
    var r = await api('/admin/tiendas/cobro', { method: 'POST', body: body });
    toast(r.mensaje);
    pintarCobro(r.cobro);
    el('cb-qr').value = '';
  } catch (e) { toast(e.message); } finally { b.disabled = false; }
});
alPulsar('cb-quitar-qr', async function () {
  try { var r = await api('/admin/tiendas/cobro', { method: 'POST', body: { qr: '' } }); toast('QR quitado.'); pintarCobro(r.cobro); } catch (e) { toast(e.message); }
});

alPulsar('av-guardar', async function () {
  var b = el('av-guardar');
  b.disabled = true;
  try {
    var r = await api('/admin/tiendas/avisos', { method: 'POST', body: { activo: el('av-activo').checked, aLaTienda: el('av-tienda').checked, vence7: val('av-vence7'), vence1: val('av-vence1'), vencida: val('av-vencida'), alDueno: val('av-dueno'), reciboActivo: el('av-recibo-activo').checked, recibo: val('av-recibo'), sinLatidoHoras: Number(el('av-latido-horas').value || 0), sinLatido: val('av-latido') } });
    toast(r.mensaje);
  } catch (e) { toast(e.message); } finally { b.disabled = false; }
});
alPulsar('av-revisar', async function () {
  var b = el('av-revisar');
  b.disabled = true;
  try { var r = await api('/admin/tiendas/avisos/revisar', { method: 'POST', body: {} }); toast(r.mensaje); pintarUltimaRevision(r.revision); await cargar(); }
  catch (e) { toast(e.message); } finally { b.disabled = false; }
});
document.querySelectorAll('.ver-como').forEach(function (a) {
  a.onclick = async function (ev) {
    ev.preventDefault();
    var ta = el(a.getAttribute('data-para'));
    var caja = el('vp-' + a.getAttribute('data-para'));
    if (!caja.classList.contains('hidden')) { caja.classList.add('hidden'); a.textContent = 'Ver cómo queda'; return; }
    try { var r = await api('/admin/tiendas/avisos/previsualizar', { method: 'POST', body: { tipo: ta.getAttribute('data-tipo'), texto: ta.value } }); caja.textContent = r.texto; caja.classList.remove('hidden'); a.textContent = 'Ocultar'; } catch (e) { toast(e.message); }
  };
});

cargar().then(cargarAvisos).catch(function (e) { toast(e.message); });
/* Refresco suave: si falla, no interrumpe con un aviso; lo dice el chip «sin actualizar». */
setInterval(function () { if (!document.querySelector('.dlg-fondo')) cargar({ silencioso: true }); }, 60000);
`;

  return appShell({
    titulo: 'Tiendas',
    subtitulo: 'Los negocios que controlas: su membresía, si están en línea y cómo están por dentro',
    contenido,
    script,
    css: CSS,
    nombreNegocio: opts.nombreNegocio,
    demo: opts.demo,
    icono: '🏪',
  });
}
