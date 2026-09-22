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
 * Sustituye a la seccion Tiendas del panel viejo. El JS va en String.raw,
 * con var y sin backticks, como el resto.
 */

import { appShell } from './shell.js';

const CSS = `

  * { box-sizing: border-box; }
  .wrap { color: var(--texto); font-family: var(--fuente); font-size: var(--fs-cuerpo); line-height: 1.5; max-width: 1400px; }
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

  label.inline { display: flex; align-items: center; gap: 8px; color: var(--texto); font-size: 14px; font-weight: 400; }
  label.inline input { width: auto; }
  .cols { display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: var(--esp-4); align-items: start; }
  @media (max-width: 1100px) { .cols { grid-template-columns: 1fr; } }
  .tabla { overflow-x: auto; }
  .tabla .vacio, .tabla .cargando { margin: var(--esp-3); }
  .cargando { text-align: center; color: var(--texto-suave); padding: var(--esp-5); }
  tr.historial td { background: var(--superficie-2); padding: 8px 14px 12px; }
  .salud { display: flex; flex-direction: column; gap: 3px; font-size: var(--fs-small); min-width: 180px; }
  .salud .luz { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; background: var(--gris); vertical-align: middle; }
  .salud .luz.ok { background: var(--verde); } .salud .luz.warn { background: var(--ambar); } .salud .luz.bad { background: var(--rojo); }
  .acciones { display: flex; gap: 6px 12px; flex-wrap: wrap; align-items: center; }
  /* Dos acciones principales como boton; el resto, enlaces discretos para que la fila se lea de un vistazo. */
  .acciones .secundaria { border: 0; background: transparent; padding: 4px 2px; min-height: 30px; color: var(--primario); font-weight: 600; box-shadow: none; }
  .acciones .secundaria.peligro { color: var(--rojo); background: transparent; border: 0; }
  .acciones .secundaria:hover { text-decoration: underline; }
  @media (max-width: 960px) { .acciones .secundaria { border: 1px solid var(--borde); background: var(--superficie); padding: 6px 12px; min-height: 44px; } .acciones .secundaria.peligro { border-color: var(--rojo); } }
  tr.fila-acciones td { padding: 2px 12px 12px; border-bottom: 1px solid var(--borde); }
  tr.fila-acciones + tr td, tr.historial td { border-top: 0; }
  tbody tr:not(.fila-acciones):not(.historial) td { border-bottom: 0; padding-bottom: 4px; }
  tbody tr:not(.fila-acciones):not(.historial) td:first-child > b { font-size: 15px; }
  .fila { display: flex; gap: 10px; flex-wrap: wrap; }
  .fila > div { flex: 1; min-width: 160px; }
  .token { background: var(--primario-suave); border: 1px dashed var(--primario); border-radius: var(--radio-sm); padding: 12px 14px; margin-top: 12px; }
  .token code { display: block; word-break: break-all; margin: 6px 0; font-size: 13px; }
  .pago { border: 1px solid var(--borde); border-radius: var(--radio-sm); padding: 10px 12px; margin-bottom: 8px; background: var(--superficie-2); }
  .pago:last-child { margin-bottom: 0; }
  .pago img { max-width: 100%; max-height: 420px; border-radius: var(--radio-sm); margin-top: 8px; display: block; }
  .qr-vista { max-width: 180px; max-height: 180px; border-radius: var(--radio-sm); border: 1px solid var(--borde); display: block; margin-top: 6px; background: #fff; }
  .vista-previa { font-size: 13px; color: var(--texto-suave); white-space: pre-wrap; background: var(--superficie-2); border-radius: var(--radio-sm); padding: 8px 10px; margin-top: 6px; }
  .ver-como { font-size: var(--fs-small); }
  .soporte-tienda { display: inline-block; margin-top: 4px; font-size: 13px; }
  .ayuda { margin: 0 0 6px; font-size: 13.5px; }
  .ayuda code, label code { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; background: var(--superficie-2); padding: 1px 5px; border-radius: 4px; }
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
    .tarjeta { padding: var(--esp-2) var(--esp-3); }
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
${opts.demo ? '<div class="demo">Demostración: nada sale a WhatsApp de verdad.</div>' : ''}

<div class="explica" id="solo-super" style="display:none"><b>Solo el superadministrador ve las tiendas.</b> Si necesitas algo de aquí, pídeselo a quien puso el sistema.</div>

<div id="todo" class="hidden">
<div class="explica">
  <p><b>Cada negocio al que le pusiste el sistema tiene su propia instalación.</b> Aquí las tienes todas: su membresía (hasta cuándo está pagada), si están en línea y <b>cómo están por dentro</b> (cada instalación manda su parte al preguntar por su plan: WhatsApp conectado o caído, mensajes de hoy, fallos de la IA).</p>
  <p class="muted" style="margin:0">Las capturas de pago que mandan las tiendas desde su pantalla <b>Pagar</b> salen abajo: un clic apunta el pago y corre el vencimiento. Los avisos de vencimiento (7 días, 1 día y el mismo día) se mandan solos.</p>
</div>

<div class="tarjetas" id="tarjetas"></div>

<div class="cols">
  <div>
    <div class="caja hidden" id="caja-pagos">
      <h2>Pagos por revisar <span class="sep"></span><span class="muted" id="pagos-n" style="font-weight:400;font-size:12.5px"></span></h2>
      <div class="cuerpo" id="pagos"></div>
    </div>

    <div class="caja">
      <h2>Tiendas <span class="sep"></span><button class="sm" id="recargar" type="button">Actualizar</button><button class="sm primary" id="ir-alta" type="button">+ Dar de alta</button></h2>
      <div class="tabla">
        <table>
          <thead><tr><th>Tienda</th><th>Plan</th><th>Pagada hasta</th><th>Membresía</th><th>Salud</th><th>En línea</th></tr></thead>
          <tbody id="tiendas"><tr><td colspan="6"><div class="cargando">Cargando…</div></td></tr></tbody>
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
          <input id="ti-contacto" type="hidden">
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
        <div style="margin-top:12px"><button class="primary" id="ti-crear" type="button">Dar de alta</button></div>
        <div id="ti-nueva" class="token hidden">
          <b>Token de <span id="ti-nueva-nombre"></span>: cópialo ahora, no se volverá a mostrar.</b>
          <code id="ti-token"></code>
          <label>Dirección del plan</label><code id="ti-url-plan"></code>
          <ol id="ti-pasos" style="margin:8px 0 0;padding-left:20px;font-size:13.5px"></ol>
          <div style="margin-top:8px;display:flex;gap:6px"><button class="sm" id="ti-copiar" type="button">Copiar el token</button><button class="sm" id="ti-cerrar" type="button">Ya lo pegué</button></div>
        </div>
      </div>
    </div>
  </div>

  <div>
    <div class="caja">
      <h2>Cómo me pagan</h2>
      <div class="cuerpo">
        <p class="muted ayuda">Lo que cada tienda ve en su pantalla <b>Pagar</b>: tu Yape o Plin y el QR. Ellos mandan la captura y aquí la apuntas con un clic.</p>
        <label class="inline"><input type="checkbox" id="cb-activo"> Enseñárselo a las tiendas</label>
        <label for="cb-numero">Número de Yape / Plin</label><input id="cb-numero" placeholder="987 654 321">
        <label for="cb-texto">Instrucciones</label><textarea id="cb-texto" placeholder="Yape o Plin al 987 654 321 a nombre de … Después manda la captura aquí mismo."></textarea>
        <label for="cb-qr">QR (imagen)</label><input id="cb-qr" type="file" accept="image/png,image/jpeg,image/webp">
        <img id="cb-qr-vista" class="qr-vista hidden" alt="QR de cobro">
        <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap"><button class="primary sm" id="cb-guardar" type="button">Guardar</button><button class="sm hidden" id="cb-quitar-qr" type="button">Quitar el QR</button></div>
      </div>
    </div>

    <div class="caja">
      <h2>Avisos de vencimiento <span class="sep"></span><button class="sm" id="av-revisar" type="button">Revisar ahora</button></h2>
      <div class="cuerpo" id="av-cuerpo">
        <p class="muted ayuda">A 7 días, a 1 día y el día que vence, un WhatsApp a la tienda (al número de su contacto) y otro a ti (el supervisor de Ajustes → Avisos). Cada aviso sale una sola vez por vencimiento. Bajo cada texto, toca una variable para insertarla.<span class="hidden"> Variables: <span id="av-variables"></span>.</span></p>
        <label class="inline"><input type="checkbox" id="av-activo"> Avisar solo</label>
        <label class="inline"><input type="checkbox" id="av-tienda"> También a la tienda (si tiene WhatsApp en su contacto)</label>
        <label for="av-vence7">A 7 días</label><textarea id="av-vence7" data-tipo="vence7"></textarea><a href="#" class="ver-como" data-para="av-vence7" style="font-size:12.5px">Ver cómo queda</a><div class="vista-previa hidden" id="vp-av-vence7"></div>
        <label for="av-vence1">A 1 día</label><textarea id="av-vence1" data-tipo="vence1"></textarea><a href="#" class="ver-como" data-para="av-vence1" style="font-size:12.5px">Ver cómo queda</a><div class="vista-previa hidden" id="vp-av-vence1"></div>
        <label for="av-vencida">El día que vence</label><textarea id="av-vencida" data-tipo="vencida"></textarea><a href="#" class="ver-como" data-para="av-vencida" style="font-size:12.5px">Ver cómo queda</a><div class="vista-previa hidden" id="vp-av-vencida"></div>
        <details class="ayuda" style="margin:8px 0 0"><summary style="cursor:pointer">Qué significa cada variable</summary><p style="margin:6px 0 0"><code>{tienda}</code> su nombre · <code>{fecha}</code> hasta cuándo está pagada · <code>{dias}</code> los que faltan · <code>{plan}</code> · <code>{precio}</code> y <code>{moneda}</code> al mes · <code>{contacto}</code> cómo renovar · en el recibo, además <code>{meses}</code> y <code>{monto}</code> del pago · <code>{lineas}</code> una línea por tienda (solo en lo que recibes tú).</p></details>
        <label for="av-dueno">Lo que recibes tú <span class="muted">(<code>{lineas}</code> = una línea por tienda)</span></label><textarea id="av-dueno"></textarea>
        <h3 style="margin:16px 0 4px;font-size:14px">Recibo de pago</h3>
        <p class="muted ayuda">Al apuntar un pago (a mano o aceptando una captura), la tienda recibe por WhatsApp su recibo con hasta cuándo queda pagada.<span class="hidden"> Variables: <span id="av-variables-recibo"></span>.</span></p>
        <label class="inline"><input type="checkbox" id="av-recibo-activo"> Mandar el recibo por WhatsApp</label>
        <label for="av-recibo">El recibo</label><textarea id="av-recibo" data-tipo="recibo"></textarea><a href="#" class="ver-como" data-para="av-recibo" style="font-size:12.5px">Ver cómo queda</a><div class="vista-previa hidden" id="vp-av-recibo"></div>
        <h3 style="margin:16px 0 4px;font-size:14px">Tiendas que no dan señales</h3>
        <p class="muted ayuda">Cada instalación pregunta por su plan cada cuarto de hora. Si una lleva más de estas horas sin preguntar en horario de trabajo (9:00 a 20:00), te avisa por WhatsApp una vez al día: suele ser que su servidor está apagado o sin red.</p>
        <div class="fila"><label for="av-latido-horas">Avisar cuando lleve más de (horas) <span class="muted">0 = no avisar</span></label><input id="av-latido-horas" type="number" min="0" max="48" style="max-width:120px"></div>
        <label for="av-latido">Lo que recibes tú <span class="muted">(<code>{lineas}</code> = una línea por tienda)</span></label><textarea id="av-latido"></textarea>
        <div style="margin-top:10px"><button class="primary sm" id="av-guardar" type="button">Guardar avisos</button></div>
        <div id="av-ultima" class="muted" style="margin-top:10px;font-size:13px"></div>
      </div>
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
  if (!res.ok) { var e = new Error(data.error || errorHttp(res.status)); e.status = res.status; e.datos = data; throw e; }
  return data;
}
function esc(v) { return String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function toast(texto) { var el = document.createElement('div'); el.className = 'toast'; el.textContent = texto; document.body.appendChild(el); setTimeout(function () { el.remove(); }, 5000); }
function fecha(iso) { if (!iso) return ''; return new Date(iso).toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' }); }
function fechaHora(iso) { if (!iso) return ''; var d = new Date(iso); return fecha(iso) + ' ' + d.toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false }); }
function val(id) { return (document.getElementById(id).value || '').trim(); }
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
function setVal(id, v) { document.getElementById(id).value = v === null || v === undefined ? '' : v; }
var TONO = { ok: 'tono-verde', warn: 'tono-ambar', bad: 'tono-rojo', info: 'tono-azul' };
function chip(clase, texto) { return '<span class="chip ' + clase + ' ' + (TONO[clase] || 'tono-gris') + '">' + esc(texto) + '</span>'; }
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

function membresiaChip(t) {
  /* El color sigue a la palabra (misma regla que el catalogo de estados): suspendida gris, vencida rojo, a 7 dias ambar, al dia verde. */
  var txt = t.membresia.estado === 'suspendida' ? 'suspendida' : t.plan.vencido ? 'vencida' : t.plan.diasRestantes <= 7 ? 'vence en ' + t.plan.diasRestantes + ' d' : 'al día';
  var c = t.membresia.estado === 'suspendida' ? 'gris' : t.plan.vencido ? 'bad' : t.plan.diasRestantes <= 7 ? 'warn' : 'ok';
  return chip(c, txt);
}
function horaLima(iso) {
  try { return new Date(iso).toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false }); } catch (e) { return String(iso).slice(11, 16); }
}
function saludHtml(t) {
  var s = t.salud;
  if (!s.parteAt) return '<div class="salud"><span class="muted">Sin parte todavía</span><span class="sub">su instalación aún no preguntó por su plan</span></div>';
  var luz = function (x) { return '<span><span class="luz ' + x.nivel + '"></span>' + esc(x.texto) + '</span>'; };
  var extra = (s.entregasHoy !== null ? s.entregasHoy + ' entregas hoy · ' : '') + 'parte ' + esc(s.hace) + (s.version ? ' · v' + esc(s.version) : '');
  var soporte = s.soporte ? '<a class="soporte-tienda" href="' + esc(s.soporte.enlace) + '" target="_blank" rel="noopener" title="La tienda te dio acceso de soporte: entras como administrador hasta esa hora">🔑 Entrar a su panel (acceso de soporte hasta las ' + esc(horaLima(s.soporte.hasta)) + ')</a>' : '';
  return '<div class="salud">' + luz(s.whatsapp) + luz(s.mensajes) + luz(s.ia) + '<span class="sub' + (s.parteViejo ? '" style="color:var(--warn)' : '') + '">' + extra + (s.parteViejo ? ' · sin noticias desde entonces' : '') + '</span>' + soporte + '</div>';
}

function pintarTarjetas(r) {
  var s = r.resumen;
  var t = [
    ['', s.total, 'tiendas'],
    ['ok', s.activas - s.porVencer, 'al día'],
    ['warn', s.porVencer, 'por vencer (7 días)'],
    ['bad', s.vencidas, 'vencidas'],
    ['', s.suspendidas, 'suspendidas'],
    ['info', s.enLinea, 'en línea ahora'],
    [s.conProblemas ? 'bad' : 'ok', s.conProblemas, 'con el WhatsApp caído'],
    [s.pagosPendientes ? 'warn' : '', s.pagosPendientes, 'pagos por revisar'],
    ['ok', s.moneda + ' ' + s.ingresosMes, 'ingresos al mes'],
  ];
  document.getElementById('tarjetas').innerHTML = t.map(function (x) { return '<div class="tarjeta ' + x[0] + '"><div class="n">' + esc(x[1]) + '</div><div class="q">' + esc(x[2]) + '</div></div>'; }).join('');
}

function pintarPagos(r) {
  var caja = document.getElementById('caja-pagos');
  var lista = r.pagosPendientes || [];
  caja.classList.toggle('hidden', !lista.length);
  document.getElementById('pagos-n').textContent = lista.length ? lista.length + ' por revisar' : '';
  document.getElementById('pagos').innerHTML = lista.map(function (p) {
    return '<div class="pago" data-captura="' + p.id + '"><b>' + esc(p.tienda ? p.tienda.nombre : 'Tienda borrada') + '</b> · ' + p.meses + ' mes' + (p.meses === 1 ? '' : 'es') + (p.monto !== null && p.monto !== undefined ? ' · ' + esc(p.moneda || '') + ' ' + p.monto : '') + '<div class="sub">' + esc(fechaHora(p.at)) + (p.nota ? ' · ' + esc(p.nota) : '') + '</div>' +
      '<div class="acciones" style="margin-top:6px"><button class="sm" data-ver="' + p.id + '" type="button">Ver la captura</button><button class="sm primary" data-aceptar="' + p.id + '" data-tienda="' + esc(p.tiendaId) + '" type="button">Apuntar el pago</button><button class="sm peligro" data-rechazar="' + p.id + '" data-tienda="' + esc(p.tiendaId) + '" type="button">Rechazar</button></div><div id="captura-' + p.id + '"></div></div>';
  }).join('');
  document.querySelectorAll('[data-ver]').forEach(function (b) {
    b.onclick = async function () {
      var id = b.getAttribute('data-ver');
      var caja2 = document.getElementById('captura-' + id);
      if (caja2.innerHTML) { caja2.innerHTML = ''; b.textContent = 'Ver la captura'; return; }
      try { var r2 = await api('/admin/tiendas/pagos/' + id); caja2.innerHTML = r2.pago.imagen ? '<img src="' + r2.pago.imagen + '" alt="captura del pago">' : '<span class="muted">Sin imagen.</span>'; b.textContent = 'Ocultar'; }
      catch (e) { toast(e.message); }
    };
  });
  document.querySelectorAll('[data-aceptar]').forEach(function (b) {
    b.onclick = async function () {
      if (!(await confirmarDialogo({ titulo: 'Apuntar el pago', texto: 'Se apunta el pago con los meses que dijo la tienda y su membresía corre desde la fecha pagada (o desde hoy si ya venció).', boton: 'Apuntar' }))) return;
      try { var r2 = await api('/admin/tiendas/pagos/' + b.getAttribute('data-aceptar') + '/aceptar', { method: 'POST', body: { tiendaId: b.getAttribute('data-tienda') } }); toast(r2.mensaje); await cargar(); } catch (e) { toast(e.message); }
    };
  });
  document.querySelectorAll('[data-rechazar]').forEach(function (b) {
    b.onclick = async function () {
      var motivo = await pedirDato({ titulo: 'Rechazar la captura', texto: 'La tienda va a leer este motivo en su pantalla Pagar.', etiqueta: 'Motivo', marcador: 'La captura no se ve / el monto no coincide…', boton: 'Rechazar', validar: function (v) { return v.trim() ? null : 'Escribe el motivo.'; } });
      if (!motivo) return;
      try { var r2 = await api('/admin/tiendas/pagos/' + b.getAttribute('data-rechazar') + '/rechazar', { method: 'POST', body: { tiendaId: b.getAttribute('data-tienda'), motivo: motivo } }); toast(r2.mensaje); await cargar(); } catch (e) { toast(e.message); }
    };
  });
}

function pintarTiendas(r) {
  var tb = document.getElementById('tiendas');
  if (!r.tiendas.length) { tb.innerHTML = '<tr><td colspan="6"><div class="vacio"><div class="ico">🏪</div><h3>Todavía no hay tiendas</h3><p>Cada negocio al que le pongas el sistema aparece aquí con su plan, su salud y sus pagos. Da de alta la primera abajo: saldrá un token para conectar su instalación.</p><div class="acciones"><a class="btn sm" href="#caja-alta">Dar de alta la primera</a></div></div></td></tr>'; return; }
  var html = '';
  r.tiendas.forEach(function (t) {
    var enLinea = t.enLinea ? chip('ok', 'sí') : t.ultimaConsultaAt ? '<span class="muted">última vez ' + esc(fechaHora(t.ultimaConsultaAt)) + '</span>' : '<span class="muted">nunca se conectó</span>';
    var acciones = '<div class="acciones">' +
      '<button class="sm" data-pago="' + esc(t.id) + '" type="button">Apuntar pago</button>' +
      '<button class="sm" data-avisar="' + esc(t.id) + '" type="button"' + (t.telefonoContacto ? '' : ' title="Ponle un WhatsApp en su contacto"') + '>Avisar por WhatsApp</button>' +
      '<button class="sm secundaria" data-editar="' + esc(t.id) + '" type="button">Cambiar plan</button>' +
      '<button class="sm secundaria" data-datos="' + esc(t.id) + '" type="button">Cambiar datos</button>' +
      '<button class="sm secundaria" data-token="' + esc(t.id) + '" type="button">Token nuevo</button>' +
      '<button class="sm secundaria" data-historial="' + esc(t.id) + '" type="button">' + (historialAbierto[t.id] ? 'Ocultar historial' : 'Historial') + '</button>' +
      (t.url ? '<a class="sm secundaria" href="' + esc(t.url) + '" target="_blank" rel="noopener">Abrir su panel</a>' : '') +
      '<button class="sm secundaria ' + (t.membresia.estado === 'suspendida' ? '' : 'peligro') + '" data-susp="' + esc(t.id) + '" data-valor="' + (t.membresia.estado === 'suspendida' ? 'false' : 'true') + '" type="button">' + (t.membresia.estado === 'suspendida' ? 'Reactivar' : 'Suspender') + '</button>' +
      '<button class="sm secundaria peligro" data-borrar="' + esc(t.id) + '" type="button">Borrar</button></div>';
    html += '<tr><td><b>' + esc(t.nombre) + '</b>' + (t.instalada ? ' ' + chip('ok', 'instalada aquí') : '') + (t.pagosPendientes ? ' ' + chip('warn', t.pagosPendientes + ' pago' + (t.pagosPendientes === 1 ? '' : 's') + ' por revisar') : '') + '<div class="sub">' + esc(t.slug) + (t.url ? ' · ' + esc(t.url) : '') + (t.contacto ? '<br>' + esc(t.contacto) : '') + '</div></td>' +
      '<td data-etiqueta="Plan">' + esc(t.plan.nombre) + '<div class="sub">' + (t.membresia.precioMes ? esc(t.membresia.moneda) + ' ' + t.membresia.precioMes + '/mes' : 'gratis') + '</div></td>' +
      '<td data-etiqueta="Pagada hasta">' + esc(fecha(t.membresia.vencimiento)) + '</td>' +
      '<td data-etiqueta="Membresía">' + membresiaChip(t) + '</td>' +
      '<td data-etiqueta="Salud">' + saludHtml(t) + '</td>' +
      '<td data-etiqueta="En línea">' + enLinea + '</td></tr>' +
      '<tr class="fila-acciones"><td colspan="6">' + acciones + '</td></tr>';
    if (historialAbierto[t.id]) html += '<tr class="historial"><td colspan="6" id="hist-' + esc(t.id) + '"><span class="muted">Cargando…</span></td></tr>';
  });
  tb.innerHTML = html;
  r.tiendas.forEach(function (t) { if (historialAbierto[t.id]) cargarHistorial(t.id); });

  document.querySelectorAll('[data-pago]').forEach(function (b) {
    b.onclick = async function () {
      var meses = await pedirDato({ titulo: 'Apuntar un pago', texto: 'Cuántos meses se pagaron. Corre el vencimiento desde la fecha pagada (o desde hoy si ya venció) y reactiva la tienda.', etiqueta: 'Meses', valor: '1', boton: 'Siguiente', validar: function (v) { return /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 60 ? null : 'Entre 1 y 60 meses.'; } });
      if (!meses) return;
      var monto = await pedirDato({ titulo: 'Monto cobrado', etiqueta: 'Monto (0 si es cortesía)', valor: '0', boton: 'Apuntar', validar: function (v) { return /^\d+([.,]\d{1,2})?$/.test(v) ? null : 'Un número, por ejemplo 49 o 49.90'; } });
      if (monto === null) return;
      try { var r2 = await api('/admin/tiendas/' + b.getAttribute('data-pago') + '/pagos', { method: 'POST', body: { meses: Number(meses), monto: Number(String(monto).replace(',', '.')) } }); toast(r2.mensaje); await cargar(); } catch (e) { toast(e.message); }
    };
  });
  document.querySelectorAll('[data-editar]').forEach(function (b) {
    b.onclick = async function () {
      var id = b.getAttribute('data-editar');
      var t = datos.tiendas.filter(function (x) { return x.id === id; })[0];
      var plan = await pedirDato({ titulo: 'Cambiar el plan de ' + t.nombre, texto: 'Escribe uno: ' + planes.map(function (p) { return p.clave; }).join(', ') + '.', etiqueta: 'Plan', valor: t.membresia.plan, boton: 'Siguiente', validar: function (v) { return planes.some(function (p) { return p.clave === v.trim(); }) ? null : 'No existe ese plan.'; } });
      if (!plan) return;
      var vence = await pedirDato({ titulo: 'Pagada hasta', etiqueta: 'Fecha (AAAA-MM-DD)', valor: t.membresia.vencimiento.slice(0, 10), boton: 'Guardar', validar: function (v) { return /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : 'Formato AAAA-MM-DD.'; } });
      if (!vence) return;
      try { await api('/admin/tiendas/' + id, { method: 'POST', body: { membresia: { plan: plan.trim(), vencimiento: vence } } }); toast('Plan cambiado.'); await cargar(); } catch (e) { toast(e.message); }
    };
  });
  document.querySelectorAll('[data-datos]').forEach(function (b) {
    b.onclick = async function () {
      var id = b.getAttribute('data-datos');
      var t = datos.tiendas.filter(function (x) { return x.id === id; })[0];
      var nombre = await pedirDato({ titulo: 'Nombre de la tienda', etiqueta: 'Nombre', valor: t.nombre, boton: 'Siguiente', validar: function (v) { return v.trim() ? null : 'Escribe el nombre.'; } });
      if (nombre === null) return;
      var partes = partirContacto(t.contacto);
      var contactoNombre = await pedirDato({ titulo: 'Persona de contacto', texto: 'Quién atiende por la tienda.', etiqueta: 'Nombre', valor: partes.nombre, boton: 'Siguiente', validar: function () { return null; } });
      if (contactoNombre === null) return;
      var contactoTel = await pedirDato({ titulo: 'Su WhatsApp', texto: 'Para poder avisarle desde aquí (vencimientos, pagos). Vacío si no lo sabes.', etiqueta: 'Celular (9 cifras)', marcador: '987 654 321', valor: partes.tel, boton: 'Siguiente', validar: function (v) { var d = v.replace(/\D/g, ''); return !d || /^9\d{8}$/.test(d) || /^519\d{8}$/.test(d) ? null : 'Tiene que ser un celular de 9 cifras (empieza por 9).'; } });
      if (contactoTel === null) return;
      var contacto = componerContacto(contactoNombre.trim(), contactoTel);
      var url = await pedirDato({ titulo: 'Dirección de su sistema', texto: 'Vacío si no la sabes.', etiqueta: 'Dirección (https://…)', valor: t.url || '', boton: 'Guardar', validar: function (v) { return !v.trim() || /^https?:\/\//i.test(v.trim()) ? null : 'Tiene que empezar por http:// o https://'; } });
      if (url === null) return;
      try { await api('/admin/tiendas/' + id, { method: 'POST', body: { nombre: nombre.trim(), contacto: contacto.trim() || null, url: url.trim() || null } }); toast('Datos guardados.'); await cargar(); } catch (e) { toast(e.message); }
    };
  });
  document.querySelectorAll('[data-susp]').forEach(function (b) {
    b.onclick = async function () {
      var suspender = b.getAttribute('data-valor') === 'true';
      if (suspender && !(await confirmarDialogo({ titulo: 'Suspender la tienda', texto: 'Su asistente IA y sus campañas se paran en cuanto vuelva a preguntar por el plan (como mucho un cuarto de hora). Sus chats siguen. Se reactiva con un clic.', boton: 'Suspender', peligro: true }))) return;
      try { var r3 = await api('/admin/tiendas/' + b.getAttribute('data-susp') + '/suspender', { method: 'POST', body: { suspendida: suspender } }); toast(r3.mensaje); await cargar(); } catch (e) { toast(e.message); }
    };
  });
  document.querySelectorAll('[data-token]').forEach(function (b) {
    b.onclick = async function () {
      if (!(await confirmarDialogo({ titulo: 'Token nuevo', texto: 'El token anterior deja de valer: esa tienda dejará de recibir su plan hasta que pegues el nuevo en su Membresía.', boton: 'Crear token nuevo' }))) return;
      try { var r4 = await api('/admin/tiendas/' + b.getAttribute('data-token') + '/token', { method: 'POST', body: {} }); mostrarToken(r4.tienda, r4.token, ['Pégalo en la Membresía de esa tienda (Esta instalación depende de un maestro) junto a la dirección del plan.']); toast(r4.mensaje); await cargar(); } catch (e) { toast(e.message); }
    };
  });
  document.querySelectorAll('[data-avisar]').forEach(function (b) {
    b.onclick = async function () {
      var id = b.getAttribute('data-avisar');
      var t = datos.tiendas.filter(function (x) { return x.id === id; })[0];
      if (!t.telefonoContacto) { toast('La tienda no tiene el WhatsApp de su contacto: ponlo con «Cambiar datos».'); return; }
      var texto = await pedirDato({ titulo: 'Escribirle a ' + t.nombre, texto: 'Sale por tu WhatsApp al +' + t.telefonoContacto + '.', etiqueta: 'Mensaje', marcador: 'Hola, te escribo de GSGchat…', boton: 'Enviar', validar: function (v) { return v.trim() ? null : 'Escribe el mensaje.'; } });
      if (!texto) return;
      try { var r5 = await api('/admin/tiendas/' + id + '/avisar', { method: 'POST', body: { texto: texto } }); toast(r5.mensaje); } catch (e) { toast(e.message); }
    };
  });
  document.querySelectorAll('[data-historial]').forEach(function (b) {
    b.onclick = function () { var id = b.getAttribute('data-historial'); historialAbierto[id] = !historialAbierto[id]; pintarTiendas(datos); };
  });
  document.querySelectorAll('[data-borrar]').forEach(function (b) {
    b.onclick = async function () {
      var id = b.getAttribute('data-borrar');
      var t = datos.tiendas.filter(function (x) { return x.id === id; })[0];
      var que = 'dejar';
      if (t && t.instalada) {
        var eleccion = await pedirDato({ titulo: 'Borrar ' + t.nombre, texto: 'Esta tienda tiene su instalación en este servidor. ¿Qué hago con ella? Escribe: dejar (sigue corriendo, solo sale de la lista), parar (se apaga, sus datos se conservan) o borrar (se apaga y se borran sus datos).', etiqueta: 'dejar · parar · borrar', valor: 'parar', boton: 'Borrar la tienda', validar: function (v) { return ['dejar', 'parar', 'borrar'].indexOf(v.trim().toLowerCase()) >= 0 ? null : 'Escribe dejar, parar o borrar.'; } });
        if (!eleccion) return;
        que = eleccion.trim().toLowerCase();
      } else if (!(await confirmarDialogo({ titulo: 'Borrar la tienda', texto: 'Se borra de esta lista y su instalación dejará de recibir plan (quedará como instalación libre o con lo último que supo). No se toca nada en su servidor.', boton: 'Borrar', peligro: true }))) return;
      try { var r6 = await api('/admin/tiendas/' + id + '?instalacion=' + que, { method: 'DELETE' }); toast(r6.mensaje || 'Borrada.'); await cargar(); } catch (e) { toast(e.message); }
    };
  });
}

async function cargarHistorial(id) {
  var caja = document.getElementById('hist-' + id);
  if (!caja) return;
  try {
    var r = await api('/admin/tiendas/' + id + '/historial');
    if (!r.historial.length) { caja.innerHTML = '<span class="muted">Todavía no hay nada apuntado de esta tienda.</span>'; return; }
    caja.innerHTML = '<b style="font-size:13px">Historial de ' + esc(r.tienda.nombre) + '</b><ul class="hist">' + r.historial.map(function (h) {
      var d = h.detalle || {};
      var extra = [];
      if (d.meses) extra.push(d.meses + ' mes' + (d.meses === 1 ? '' : 'es'));
      if (d.monto !== undefined && d.monto !== null && d.monto !== '') extra.push((d.moneda || '') + ' ' + d.monto);
      if (d.suspendida !== undefined) extra.push(d.suspendida ? 'suspendida' : 'reactivada');
      if (d.nota) extra.push(d.nota);
      if (d.motivo) extra.push(d.motivo);
      return '<li>' + esc(fechaHora(h.at)) + ' · <b>' + esc(h.etiqueta) + '</b> · ' + esc(h.usuario) + (extra.length ? ' <span class="muted">(' + esc(extra.join(' · ')) + ')</span>' : '') + '</li>';
    }).join('') + '</ul>';
  } catch (e) { caja.innerHTML = '<span class="muted">' + esc(e.message) + '</span>'; }
}

function mostrarToken(tienda, token, pasos) {
  document.getElementById('ti-nueva-nombre').textContent = tienda.nombre;
  document.getElementById('ti-token').textContent = token;
  document.getElementById('ti-url-plan').textContent = tienda.urlPlan;
  document.getElementById('ti-pasos').innerHTML = pasos.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('');
  document.getElementById('ti-nueva').classList.remove('hidden');
  document.getElementById('ti-nueva').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function pintarCobro(c) {
  document.getElementById('cb-activo').checked = Boolean(c.activo);
  setVal('cb-numero', c.numero || '');
  setVal('cb-texto', c.texto || '');
  var img = document.getElementById('cb-qr-vista');
  img.classList.toggle('hidden', !c.qr);
  if (c.qr) img.src = c.qr;
  document.getElementById('cb-quitar-qr').classList.toggle('hidden', !c.qr);
}

async function cargarAvisos() {
  try {
    var r = await api('/admin/tiendas/avisos');
    document.getElementById('av-variables').textContent = (r.variables || []).join(' ');
    if (!r.disponible) { document.getElementById('av-cuerpo').innerHTML = '<span class="muted">Este arranque no lleva avisos de vencimiento.</span>'; return; }
    var t = r.textos;
    document.getElementById('av-activo').checked = Boolean(t.activo);
    document.getElementById('av-tienda').checked = Boolean(t.aLaTienda);
    setVal('av-vence7', t.vence7); setVal('av-vence1', t.vence1); setVal('av-vencida', t.vencida); setVal('av-dueno', t.alDueno);
    document.getElementById('av-recibo-activo').checked = t.reciboActivo !== false;
    setVal('av-recibo', t.recibo || ''); setVal('av-latido', t.sinLatido || '');
    document.getElementById('av-latido-horas').value = t.sinLatidoHoras === undefined ? 1 : t.sinLatidoHoras;
    document.getElementById('av-variables-recibo').textContent = (r.variablesRecibo || []).join(' ');
    var chips = function (id, vars) { if (window.chipsDeVariables) window.chipsDeVariables(document.getElementById(id), vars); };
    chips('av-vence7', r.variables || []); chips('av-vence1', r.variables || []); chips('av-vencida', r.variables || []);
    chips('av-recibo', r.variablesRecibo || []); chips('av-dueno', ['{lineas}']); chips('av-latido', ['{lineas}']);
    pintarUltimaRevision(r.ultimaRevision);
  } catch (e) { document.getElementById('av-ultima').textContent = e.message; }
}
function pintarUltimaRevision(u) {
  var caja = document.getElementById('av-ultima');
  if (!u) { caja.textContent = 'Todavía no se revisó en este arranque (se revisa solo cada hora).'; return; }
  var lineas = (u.mandados || []).map(function (m) {
    var tipo = m.tipo === 'vencida' ? 'venció' : m.tipo === 'vence1' ? 'vence mañana' : 'vence en 7 días';
    return '<div class="aviso-linea"><b>' + esc(m.tienda) + '</b> · ' + tipo + ' · ' + (m.aTienda ? 'avisada al +' + esc(m.aTienda) : m.fallo ? 'sin avisar a la tienda: ' + esc(m.fallo) : 'solo a ti') + (m.alDueno ? ' · a ti también' : '') + '</div>';
  }).join('');
  caja.innerHTML = 'Última revisión: ' + esc(fechaHora(u.cuando)) + ' · ' + u.revisadas + ' tienda' + (u.revisadas === 1 ? '' : 's') + (u.apagado ? ' · avisos apagados' : '') + (u.yaAvisadas ? ' · ' + u.yaAvisadas + ' ya avisada' + (u.yaAvisadas === 1 ? '' : 's') : '') + (lineas ? '<div style="margin-top:6px">' + lineas + '</div>' : ' · nada que avisar');
}

async function cargar() {
  var r;
  try { r = await api('/admin/tiendas'); }
  catch (e) {
    if (e.status === 403) { document.getElementById('solo-super').style.display = ''; document.getElementById('todo').classList.add('hidden'); return; }
    toast(e.message); return;
  }
  datos = r;
  document.getElementById('todo').classList.remove('hidden');
  pintarTarjetas(r);
  pintarPagos(r);
  pintarTiendas(r);
  pintarCobro(r.cobro || {});
  var al = r.alojamiento || {};
  document.getElementById('alojamiento').innerHTML = al.disponible
    ? '<b style="color:var(--ok)">Alojamiento en este servidor: listo.</b> Cada tienda nueva puede salir con su propia dirección (nombre.' + esc(al.dominioBase) + '), ya conectada a este panel.'
    : '<b>Sin alojamiento en este servidor.</b> ' + esc(al.motivo || '') + ' La tienda se registra aquí y su instalación se hace aparte; luego se pega la dirección del plan y el token en su Membresía.';
  document.getElementById('ti-instalar-caja').classList.toggle('hidden', !al.disponible);
  if (!planes.length) {
    try {
      var m = await api('/admin/membresia');
      planes = m.planes || [];
      var sel = document.getElementById('ti-plan');
      sel.innerHTML = planes.map(function (p) { return '<option value="' + esc(p.clave) + '">' + esc(p.nombre) + (p.precioMes ? ' · ' + esc(p.moneda) + ' ' + p.precioMes + '/mes' : '') + '</option>'; }).join('');
      sel.value = 'prueba';
      setVal('ti-vence', new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
      setVal('ti-precio', '0');
      sel.onchange = function () { var p = planes.filter(function (x) { return x.clave === sel.value; })[0]; if (p) setVal('ti-precio', p.precioMes); };
    } catch (e) { /* sin membresia en este arranque: el plan se escribe a mano */ }
  }
}

document.getElementById('recargar').onclick = function () { cargar().catch(function (e) { toast(e.message); }); };
document.getElementById('ir-alta').onclick = function () { document.getElementById('caja-alta').scrollIntoView({ behavior: 'smooth' }); document.getElementById('ti-nombre').focus(); };
document.getElementById('ti-crear').onclick = async function () {
  var b = document.getElementById('ti-crear'); b.disabled = true;
  try {
    var instalar = !document.getElementById('ti-instalar-caja').classList.contains('hidden') && document.getElementById('ti-instalar').checked;
    if (instalar) toast('Dando de alta y levantando su instalación… tarda un minuto.');
    var telContacto = val('ti-contacto-tel').replace(/\D/g, '');
    if (telContacto && !/^9\d{8}$/.test(telContacto) && !/^519\d{8}$/.test(telContacto)) { toast('El WhatsApp del contacto tiene que ser un celular de 9 cifras (empieza por 9).'); return; }
    setVal('ti-contacto', componerContacto(val('ti-contacto-nombre'), telContacto));
    var r = await api('/admin/tiendas', { method: 'POST', body: { nombre: val('ti-nombre'), slug: val('ti-slug') || undefined, url: val('ti-url') || null, contacto: val('ti-contacto') || null, crearInstalacion: instalar, membresia: { plan: val('ti-plan') || 'prueba', vencimiento: val('ti-vence'), precioMes: Number(val('ti-precio') || 0), contacto: val('ti-renovar') || null } } });
    mostrarToken(r.tienda, r.token, r.pasos);
    toast(r.mensaje || (r.instalacion && r.instalacion.ok ? 'Tienda dada de alta con su instalación en ' + r.instalacion.url : 'Tienda dada de alta.'));
    setVal('ti-nombre', ''); setVal('ti-slug', ''); setVal('ti-url', ''); setVal('ti-contacto', ''); setVal('ti-contacto-nombre', ''); setVal('ti-contacto-tel', '');
    await cargar();
  } catch (e) { toast(e.message); }
  b.disabled = false;
};
document.getElementById('ti-copiar').onclick = function () { navigator.clipboard.writeText(document.getElementById('ti-token').textContent).then(function () { toast('Token copiado'); }); };
document.getElementById('ti-cerrar').onclick = function () { document.getElementById('ti-nueva').classList.add('hidden'); };

document.getElementById('cb-guardar').onclick = async function () {
  try {
    var qr = await leerImagen(document.getElementById('cb-qr'));
    var body = { activo: document.getElementById('cb-activo').checked, numero: val('cb-numero'), texto: val('cb-texto') };
    if (qr) body.qr = qr;
    var r = await api('/admin/tiendas/cobro', { method: 'POST', body: body });
    toast(r.mensaje); pintarCobro(r.cobro); document.getElementById('cb-qr').value = '';
  } catch (e) { toast(e.message); }
};
document.getElementById('cb-quitar-qr').onclick = async function () {
  try { var r = await api('/admin/tiendas/cobro', { method: 'POST', body: { qr: '' } }); toast('QR quitado.'); pintarCobro(r.cobro); } catch (e) { toast(e.message); }
};

document.getElementById('av-guardar').onclick = async function () {
  try {
    var r = await api('/admin/tiendas/avisos', { method: 'POST', body: { activo: document.getElementById('av-activo').checked, aLaTienda: document.getElementById('av-tienda').checked, vence7: val('av-vence7'), vence1: val('av-vence1'), vencida: val('av-vencida'), alDueno: val('av-dueno'), reciboActivo: document.getElementById('av-recibo-activo').checked, recibo: val('av-recibo'), sinLatidoHoras: Number(document.getElementById('av-latido-horas').value || 0), sinLatido: val('av-latido') } });
    toast(r.mensaje);
  } catch (e) { toast(e.message); }
};
document.getElementById('av-revisar').onclick = async function () {
  try { var r = await api('/admin/tiendas/avisos/revisar', { method: 'POST', body: {} }); toast(r.mensaje); pintarUltimaRevision(r.revision); await cargar(); } catch (e) { toast(e.message); }
};
document.querySelectorAll('.ver-como').forEach(function (a) {
  a.onclick = async function (ev) {
    ev.preventDefault();
    var ta = document.getElementById(a.getAttribute('data-para'));
    var caja = document.getElementById('vp-' + a.getAttribute('data-para'));
    if (!caja.classList.contains('hidden')) { caja.classList.add('hidden'); return; }
    try { var r = await api('/admin/tiendas/avisos/previsualizar', { method: 'POST', body: { tipo: ta.getAttribute('data-tipo'), texto: ta.value } }); caja.textContent = r.texto; caja.classList.remove('hidden'); } catch (e) { toast(e.message); }
  };
});

cargar().then(function () { return cargarAvisos(); }).catch(function (e) { toast(e.message); });
setInterval(function () { if (document.querySelector('.dlg-fondo')) return; cargar().catch(function () {}); }, 60000);
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
