/**
 * Pantalla "Conversaciones guardadas": las conversaciones ya cerradas.
 *
 * Tres piezas y nada mas:
 *  - arriba, el estado de un vistazo (cuantas hay, cuantas con reclamo, que
 *    hay en la papelera, si las copias siguen sanas, cada cuantos dias se
 *    guardan solas) y las acciones que valen para todas;
 *  - a la izquierda, la lista con el buscador por cliente y por lo que se
 *    dijo, mas los filtros que se despliegan;
 *  - a la derecha, el lector de solo lectura: cabecera, resumen, buscador
 *    dentro del hilo, los mensajes con sus fotos y audios, y las notas.
 *
 * Cada dato se dice UNA vez: lo que esta en las tarjetas no se repite en las
 * estadisticas, y lo que esta en la cabecera del lector no se repite en los
 * chips. Las acciones poco frecuentes viven en el menu «Mas…» para que la
 * barra del lector no sea un muro de botones.
 *
 * El JS va en String.raw, con var y sin backticks, como el resto.
 */

import { appShell } from './shell.js';

const CSS = `
  * { box-sizing: border-box; }
  .wrap { color: var(--texto); font-family: var(--fuente); font-size: var(--fs-cuerpo); line-height: 1.5; max-width: 1500px; }
  .wrap a { color: var(--primario); }
  .muted { color: var(--texto-suave); }
  .tono-verde { color: var(--verde); }
  .tono-rojo { color: var(--rojo); }

  /* El armazon no viste los formularios: esto es lo unico propio de la pantalla. */
  input, select, textarea { font: inherit; color: var(--texto); background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio-sm); padding: 8px 11px; width: 100%; max-width: 100%; min-height: 38px; }
  input[type=checkbox] { width: auto; min-height: 0; accent-color: var(--primario); }
  input[type=file] { padding: 7px 10px; font-size: 13.5px; }
  input:focus, select:focus, textarea:focus { border-color: var(--primario); outline: none; box-shadow: 0 0 0 3px var(--primario-suave); }
  textarea { min-height: 64px; resize: vertical; }
  label { display: block; font-size: var(--fs-small); font-weight: 500; color: var(--texto-suave); margin: 8px 0 4px; }
  .ayuda { font-size: 13px; color: var(--texto-suave); margin: 0 0 10px; }

  .toast { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); background: var(--texto); color: var(--bg); padding: 10px 16px; border-radius: var(--radio-sm); font-size: 14px; z-index: 50; max-width: 90vw; box-shadow: var(--sombra-2); }

  /* --- cajas y tarjetas ------------------------------------------------- */
  .caja { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); overflow: hidden; margin-bottom: var(--esp-4); box-shadow: var(--sombra); min-width: 0; }
  /* El lector no recorta: el menú «Mas…» se despliega fuera de la caja. */
  #lector { overflow: visible; }
  .caja > h2, .caja > summary { font-size: var(--fs-h2); font-weight: 700; margin: 0; padding: var(--esp-3) var(--esp-4); border-bottom: 1px solid var(--borde); display: flex; align-items: center; gap: var(--esp-2); flex-wrap: wrap; min-height: 44px; }
  .caja > summary { cursor: pointer; list-style: none; }
  .caja > summary::-webkit-details-marker { display: none; }
  .caja > summary::before { content: '▸'; color: var(--texto-suave); font-size: 12px; }
  .caja[open] > summary::before { content: '▾'; }
  .caja:not([open]) > summary { border-bottom: 0; }
  .caja .sep { flex: 1; }
  .caja .muted { font-weight: 400; font-size: var(--fs-small); }
  .caja .cuerpo { padding: var(--esp-4); }

  .tarjetas { display: grid; grid-template-columns: repeat(auto-fill, minmax(165px, 1fr)); gap: var(--esp-3); margin-bottom: var(--esp-4); align-items: start; }
  .tarjetas .tarjeta { padding: var(--esp-3) var(--esp-4); min-width: 0; }
  .tarjeta .n { font-size: 22px; font-weight: 700; line-height: 1.15; }
  .tarjeta .q { font-size: var(--fs-small); color: var(--texto-suave); margin-top: 2px; }
  .tarjeta .acciones { margin-top: var(--esp-2); display: flex; gap: 6px; flex-wrap: wrap; }
  .tarjeta .et { display: inline-flex; align-items: center; gap: 4px; font-size: 15px; margin: 0 8px 4px 0; }
  .tarjeta.ancha { grid-column: 1 / -1; display: flex; align-items: center; gap: var(--esp-3); flex-wrap: wrap; }
  .tarjeta.ancha .acciones { margin-top: 0; }
  @media (max-width: 640px) {
    .tarjetas { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--esp-2); }
    .tarjetas .tarjeta { padding: var(--esp-2) var(--esp-3); }
    .tarjeta .n { font-size: 19px; }
  }

  /* --- las dos columnas -------------------------------------------------- */
  .cols { display: grid; grid-template-columns: 420px minmax(0, 1fr); gap: var(--esp-4); align-items: start; }
  @media (max-width: 1100px) { .cols { grid-template-columns: 1fr; } }

  /* --- filtros y lista ---------------------------------------------------- */
  .filtros { padding: 10px var(--esp-4); border-bottom: 1px solid var(--borde); display: grid; grid-template-columns: 1fr 1fr; gap: 6px 8px; background: var(--superficie-2); }
  .filtros .ancho { grid-column: 1 / -1; }
  .filtros .flt { display: block; margin: 0; font-size: 11.5px; color: var(--texto-suave); font-weight: 600; text-transform: uppercase; letter-spacing: .03em; }
  .filtros .flt span { display: block; margin: 0 0 3px 2px; }
  .filtros .flt input, .filtros .flt select { font-weight: 400; text-transform: none; letter-spacing: 0; min-height: 36px; font-size: 13.5px; }
  .filtros-mas { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 8px; }
  .mas-filtros-cb, .mas-filtros-boton { display: none; }
  @media (max-width: 640px) {
    .mas-filtros-boton { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; border: 1px solid var(--borde); border-radius: var(--radio-sm); background: var(--superficie); font-size: 13.5px; font-weight: 600; color: var(--primario); cursor: pointer; margin: 0; text-transform: none; letter-spacing: 0; }
    .mas-filtros-boton::before { content: '▸ '; }
    .mas-filtros-cb:checked ~ .mas-filtros-boton::before { content: '▾ '; }
    .filtros-mas { display: none; }
    .mas-filtros-cb:checked ~ .filtros-mas { display: grid; }
  }

  .lista { max-height: 70vh; overflow: auto; transition: opacity .15s ease; }
  .lista[aria-busy="true"] { opacity: .45; }
  @media (max-width: 1100px) { .lista { max-height: 60vh; } }
  .fila { display: block; width: 100%; text-align: left; padding: 10px var(--esp-4); border: 0; border-bottom: 1px solid var(--borde); border-radius: 0; background: none; font: inherit; color: inherit; cursor: pointer; min-height: 0; }
  .fila:hover { background: var(--superficie-2); }
  .fila[aria-current="true"] { background: var(--primario-suave); box-shadow: inset 3px 0 0 var(--primario); }
  .fila .top { display: flex; gap: 8px; align-items: baseline; }
  .fila .top b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fila .cuando { color: var(--texto-suave); font-size: 12px; white-space: nowrap; }
  .fila .det { display: block; color: var(--texto-suave); font-size: var(--fs-small); margin-top: 2px; }
  .fila .chips { margin-top: 4px; display: flex; gap: 4px; flex-wrap: wrap; }
  .fila .res { font-size: 13px; margin-top: 4px; color: var(--texto); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .lista .vacio { border: 0; box-shadow: none; background: transparent; }
  .pag { display: flex; gap: var(--esp-2); align-items: center; justify-content: center; padding: var(--esp-2); font-size: 13px; color: var(--texto-suave); }

  /* --- el lector ---------------------------------------------------------- */
  #lector-vacio { border: 0; box-shadow: none; background: transparent; }
  .lector-cab { padding: var(--esp-3) var(--esp-4); border-bottom: 1px solid var(--borde); display: flex; gap: var(--esp-3); align-items: flex-start; flex-wrap: wrap; }
  .lector-cab .quien { flex: 1; min-width: 210px; }
  .lector-cab .quien b { font-size: 16px; }
  .lector-cab .sub, .lector-cab .meta { color: var(--texto-suave); font-size: var(--fs-small); }
  .lector-cab .chips { margin-top: 5px; display: flex; gap: 4px; flex-wrap: wrap; }
  .lector-cab .acciones { display: flex; gap: 6px; flex-wrap: wrap; align-items: flex-start; }

  /* «Mas…»: lo que casi nunca se usa no ocupa la barra. */
  .menu { position: relative; }
  .menu > summary { list-style: none; }
  .menu > summary::-webkit-details-marker { display: none; }
  .menu-caja { position: absolute; right: 0; top: calc(100% + 4px); z-index: 20; background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); box-shadow: var(--sombra-2); padding: var(--esp-2); display: flex; flex-direction: column; gap: 4px; min-width: 250px; }
  .menu-caja .btn { justify-content: flex-start; width: 100%; }
  @media (max-width: 640px) { .menu { width: 100%; } .menu-caja { position: static; min-width: 0; box-shadow: none; } }

  .resumen { background: var(--ambar-suave); border-bottom: 1px solid var(--borde); padding: 10px var(--esp-4); font-size: 13.5px; }
  .resumen b { color: var(--ambar); }
  .enlace { background: var(--azul-suave); border-bottom: 1px solid var(--borde); padding: var(--esp-2) var(--esp-4); font-size: 13px; display: flex; gap: var(--esp-2); align-items: center; flex-wrap: wrap; }
  .enlace a { word-break: break-all; }

  .hilo-buscar { display: flex; gap: 6px; align-items: center; padding: var(--esp-2) var(--esp-4); border-bottom: 1px solid var(--borde); background: var(--superficie-2); }
  .hilo-buscar input { flex: 1; min-height: 34px; font-size: 13.5px; }
  .hilo-buscar .cuenta { font-size: var(--fs-small); color: var(--texto-suave); white-space: nowrap; min-width: 4.5em; text-align: right; }

  .hilo { max-height: 58vh; overflow: auto; padding: var(--esp-3) var(--esp-4); background: var(--bg); }
  .g { max-width: 78%; padding: 7px 10px; border-radius: 10px; margin: 5px 0; background: var(--superficie); font-size: 14px; white-space: pre-wrap; word-break: break-word; box-shadow: var(--sombra); }
  .g.neg { margin-left: auto; background: var(--primario-suave); }
  .g .h { font-size: 11px; color: var(--texto-suave); text-align: right; margin-top: 2px; }
  .g .k { color: var(--texto-suave); font-style: italic; }
  .g .adj { display: block; max-width: 100%; max-height: 320px; border-radius: var(--radio-sm); margin-bottom: 4px; }
  .g img.adj { min-height: 40px; background: var(--superficie-2); cursor: zoom-in; }
  .g a.adj.doc { display: inline-block; max-height: none; padding: 6px 10px; background: var(--superficie-2); border-radius: var(--radio-sm); text-decoration: none; }
  .g mark { background: var(--ambar-suave); color: var(--ambar); border-radius: 3px; padding: 0 1px; }
  .g mark.aqui { background: var(--primario); color: var(--primario-texto); }
  .notas { padding: var(--esp-3) var(--esp-4); border-top: 1px solid var(--borde); }
  .notas .pie { display: flex; gap: var(--esp-2); align-items: center; margin-top: 6px; flex-wrap: wrap; }
  .notas select { width: auto; }
  .chip .quitar { border: 0; background: none; padding: 0 0 0 2px; margin: 0; color: inherit; font: inherit; cursor: pointer; min-height: 0; line-height: 1; }

  /* --- estadisticas ------------------------------------------------------- */
  .est { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: var(--esp-4); }
  @media (max-width: 760px) { .est { grid-template-columns: 1fr; } }
  .est h3 { font-size: 13px; color: var(--texto-suave); margin: 0 0 var(--esp-2); font-weight: 600; }
  .barras { display: flex; gap: 6px; align-items: flex-end; height: 120px; min-width: 0; }
  .barra { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
  .barra .b { width: 100%; max-width: 34px; background: var(--primario); border-radius: 6px 6px 2px 2px; min-height: 2px; }
  .barra .n { font-size: 11.5px; margin-bottom: 2px; }
  .barra .l { font-size: 10.5px; color: var(--texto-suave); margin-top: 3px; white-space: nowrap; }
  .cifras { display: flex; flex-direction: column; gap: var(--esp-2); }
  .cifra { display: flex; justify-content: space-between; gap: 10px; border-bottom: 1px dashed var(--borde); padding-bottom: 5px; font-size: 13.5px; }
  .cifra b { white-space: nowrap; }

  /* --- importar ------------------------------------------------------------ */
  .imp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--esp-2); }
  @media (max-width: 760px) { .imp-grid { grid-template-columns: 1fr; } }
  .imp-grid .ancho { grid-column: 1 / -1; }
  .imp-pie { display: flex; gap: var(--esp-2); align-items: center; flex-wrap: wrap; }
`;

export function guardadosPage(opts: { demo: boolean; nombreNegocio: string; conIA: boolean }): string {
  const contenido = `
<div class="wrap">

<div class="tarjetas" id="tarjetas"></div>

<details class="caja" id="estadisticas">
  <summary>Estadísticas <span class="sep"></span><span class="muted" id="est-sub"></span></summary>
  <div class="cuerpo" id="est-cuerpo"></div>
</details>

<div class="cols">
  <div class="caja">
    <h2>Conversaciones <span id="titulo-vista"></span><span class="sep"></span><span class="muted" id="total"></span></h2>
    <div class="filtros">
      <label class="flt ancho" for="f-q"><span>Cliente</span><input id="f-q" placeholder="Nombre o número"></label>
      <label class="flt ancho" for="f-texto"><span>Lo que se dijo</span><input id="f-texto" placeholder="Una palabra del chat (ej. reclamo, no llegó, Yape)"></label>
      <input type="checkbox" id="mas-filtros" class="mas-filtros-cb">
      <label for="mas-filtros" class="mas-filtros-boton ancho">Más filtros</label>
      <div class="filtros-mas ancho">
        <label class="flt" for="f-etiqueta"><span>Etiqueta</span><select id="f-etiqueta"><option value="">Cualquier etiqueta</option></select></label>
        <label class="flt" for="f-motivo"><span>Motivo</span><select id="f-motivo"><option value="">Cualquier motivo</option><option value="manual">Cerrada a mano</option><option value="entrega">Al terminar la entrega</option><option value="inactividad">Por inactividad</option><option value="lead">Al cerrar la ficha</option></select></label>
        <label class="flt" for="f-desde"><span>Desde</span><input id="f-desde" type="date"></label>
        <label class="flt" for="f-hasta"><span>Hasta</span><input id="f-hasta" type="date"></label>
        <label class="flt ancho" for="f-pedido"><span>Pedido</span><input id="f-pedido" placeholder="Ej. P-1001"></label>
      </div>
    </div>
    <div class="lista" id="lista" aria-busy="true"><div class="vacio">Cargando…</div></div>
    <div class="pag" id="pag"></div>
  </div>

  <div>
  <div class="caja" id="lector">
    <div class="vacio" id="lector-vacio"><div class="ico">💬</div><h3>Elige una conversación de la lista para leerla</h3><p>Se guardan desde Chats (botón «Guardar y vaciar»), solas a los días sin movimiento, o de golpe con «Guardar las de los pedidos terminados hoy».</p></div>
    <div id="lector-con" class="hidden">
      <div class="lector-cab">
        <div class="quien">
          <b id="l-nombre"></b>
          <div class="sub" id="l-sub"></div>
          <div class="meta" id="l-meta"></div>
          <div class="chips" id="l-chips"></div>
        </div>
        <div class="acciones">
          <button class="btn sm primario" id="l-restaurar" type="button">Devolver al chat</button>
          <button class="btn sm hidden" id="l-recuperar" type="button">Sacar de la papelera</button>
          <button class="btn sm" id="l-txt" type="button" title="El hilo entero como texto plano">Descargar</button>
          <button class="btn sm" id="l-pdf" type="button" title="Se abre en una pestaña lista para imprimir o guardar como PDF">Imprimir o PDF</button>
          <button class="btn sm" id="l-compartir" type="button" title="Un enlace de solo lectura que caduca, para quien no tiene cuenta aquí">Compartir como evidencia</button>
          <details class="menu" id="l-mas">
            <summary class="btn sm" aria-label="Más acciones para esta conversación">Más…</summary>
            <div class="menu-caja">
              <button class="btn sm" id="l-txt-anon" type="button">Descargar sin datos personales</button>
              <button class="btn sm" id="l-aprender" type="button">Enseñar a la IA</button>
              <button class="btn sm" id="l-resumir" type="button">Volver a resumir</button>
              <button class="btn sm peligro" id="l-borrar" type="button">Mandar a la papelera</button>
              <button class="btn sm peligro" id="l-borrar-cliente" type="button">Borrar todo lo de este cliente</button>
            </div>
          </details>
        </div>
      </div>
      <div class="resumen" id="l-resumen"></div>
      <div class="enlace hidden" id="l-enlace"></div>
      <div class="hilo-buscar">
        <input id="l-buscar" placeholder="Buscar dentro de esta conversación" aria-label="Buscar dentro de esta conversación">
        <span class="cuenta" id="l-buscar-n"></span>
        <button class="btn sm" id="l-buscar-antes" type="button" aria-label="Coincidencia anterior" disabled>‹</button>
        <button class="btn sm" id="l-buscar-despues" type="button" aria-label="Coincidencia siguiente" disabled>›</button>
      </div>
      <div class="hilo" id="l-hilo"></div>
      <div class="notas">
        <label for="l-notas">Notas internas (no salen en el enlace de evidencia)</label>
        <textarea id="l-notas" placeholder="Ej.: se quejó del motorizado; se le ofreció descuento en el siguiente pedido"></textarea>
        <div class="pie">
          <select id="l-etiqueta-add" aria-label="Añadir una etiqueta"><option value="">Añadir etiqueta…</option></select>
          <button class="btn sm primario" id="l-guardar-notas" type="button">Guardar notas y etiquetas</button>
          <span class="muted" id="l-notas-estado" role="status"></span>
        </div>
      </div>
    </div>
  </div>

  <details class="caja" id="importar">
    <summary>Importar un chat exportado del teléfono <span class="sep"></span><span class="muted">de antes de conectar el sistema</span></summary>
    <div class="cuerpo">
      <p class="ayuda">En WhatsApp, abre el chat del cliente → los tres puntos → <b>Más</b> → <b>Exportar chat</b> → <b>Sin archivos</b>. Te da un archivo .txt: elígelo aquí o pega su contenido. Queda como una conversación guardada más, con su resumen y sus etiquetas; al cliente no se le manda nada.</p>
      <div class="imp-grid">
        <div class="ancho"><label for="imp-fichero">El archivo .txt que exportó WhatsApp</label><input type="file" id="imp-fichero" accept=".txt,text/plain"></div>
        <div class="ancho"><label for="imp-texto">O pega aquí el contenido del chat</label><textarea id="imp-texto" rows="6" placeholder="12/03/26, 10:15 - Ana Quispe: hola, ¿a qué hora llega mi pedido?&#10;12/03/26, 10:17 - ${opts.nombreNegocio.replace(/"/g, '&quot;')}: Buenos días Ana, sale a las 11."></textarea></div>
        <div><label for="imp-tel">Teléfono del cliente</label><input id="imp-tel" placeholder="987 654 321"></div>
        <div><label for="imp-nombre">Nombre del cliente tal como sale en el chat (opcional)</label><input id="imp-nombre" placeholder="Ana Quispe"></div>
        <div class="ancho imp-pie"><button class="btn primario" id="imp-enviar" type="button">Importar la conversación</button><span class="muted" id="imp-estado" role="status"></span></div>
      </div>
    </div>
  </details>
  </div>
</div>
</div>
`;

  const script = String.raw`
/* ---------------------------------------------------------------- utilidades */
function $(id) { return document.getElementById(id); }

async function api(path, options) {
  options = options || {};
  var res = await fetch(path, { method: options.method || 'GET', cache: 'no-store', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: options.body ? JSON.stringify(options.body) : undefined });
  var data = await res.json().catch(function () { return {}; });
  if (res.status === 401) { irAlLogin(); throw new Error('Tu sesión terminó: vuelve a entrar.'); }
  if (!res.ok) { var e = new Error(data.error || errorHttp(res.status)); e.datos = data; throw e; }
  return data;
}
function esc(v) { return String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function toast(texto) { var el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = texto; document.body.appendChild(el); setTimeout(function () { el.remove(); }, 4500); }
function fechaHora(iso) { if (!iso) return ''; var d = new Date(iso); return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' + d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }); }
function fechaCorta(iso) { if (!iso) return ''; var d = new Date(iso); return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
function telefonoBonito(p) { if (!p) return ''; if (p.length === 11 && p.indexOf('51') === 0) return '+51 ' + p.slice(2, 5) + ' ' + p.slice(5, 8) + ' ' + p.slice(8); return '+' + p; }
function peso(b) { if (!b) return '0 B'; if (b < 1024) return b + ' B'; if (b < 1024 * 1024) return Math.round(b / 1024) + ' KB'; return (b / 1024 / 1024).toFixed(1) + ' MB'; }
function motivoTexto(r) { return r === 'entrega' ? 'al terminar la entrega' : r === 'inactividad' ? 'por inactividad' : r === 'lead' ? 'al cerrar la ficha' : 'cerrada a mano'; }
function tiempoLegible(seg) { if (seg === null || seg === undefined) return '—'; if (seg < 60) return seg + ' s'; if (seg < 3600) return Math.round(seg / 60) + ' min'; var h = Math.floor(seg / 3600); var m = Math.round((seg % 3600) / 60); return h + ' h' + (m ? ' ' + m + ' min' : ''); }
function semanaCorta(lunes) { return lunes.slice(8, 10) + '/' + lunes.slice(5, 7); }
function plural(n, una, varias) { return n === 1 ? una : varias; }

/* Resalta lo buscado sin romper el escapado: se corta el texto crudo y se escapa trozo a trozo. */
function resaltar(texto, busca) {
  var crudo = String(texto === null || texto === undefined ? '' : texto);
  var aguja = String(busca || '').toLowerCase();
  if (!aguja) return esc(crudo);
  var bajo = crudo.toLowerCase();
  var salida = '';
  var i = 0;
  var p = bajo.indexOf(aguja);
  while (p >= 0) {
    salida += esc(crudo.slice(i, p)) + '<mark>' + esc(crudo.slice(p, p + aguja.length)) + '</mark>';
    i = p + aguja.length;
    p = bajo.indexOf(aguja, i);
  }
  return salida + esc(crudo.slice(i));
}

/* Cada etiqueta con el tono del armazon: nunca un color a pelo. */
var TONO_ETIQUETA = { reclamo: 'rojo', cancelacion: 'rojo', entrega: 'verde', venta: 'verde', cambio: 'ambar', sin_respuesta: 'ambar', motorizado: 'azul', pago: 'azul', consulta: 'gris', otro: 'gris' };
var TIPO = { image: '🖼 foto', audio: '🎤 audio', video: '🎬 video', document: '📄 documento', sticker: 'sticker', location: '📍 ubicación' };
/* Cuerpos que WhatsApp pone como relleno de un adjunto: no aportan nada junto al propio adjunto. */
var CUERPOS_GENERICOS = ['(foto)', '(sticker)', '(audio)', '(video)', '(documento)', '(adjunto)', '(ubicacion)', '(ubicación)'];
/* Mensajes que nunca traen un fichero al lado. */
var SIN_FICHERO = ['text', 'location', 'interactive', 'template', 'unknown'];

/* ------------------------------------------------------------------- estado */
var ETIQUETAS = [];
var NOMBRE_ETIQUETA = {};
var datos = null;
var abierta = null;
var mensajesAbiertos = [];
var adjuntosPorId = {};
var urlsAdjuntos = {};
var generacionAdjuntos = 0;
var pagina = 0;
var POR_PAGINA = 40;
var TOPE_ETIQUETAS = 5;
var etiquetasEdit = [];
var salud = null;
var verPapelera = false;
/* Dos búsquedas distintas: la de la lista (filtra en el servidor) y la del hilo abierto. */
var textoLista = '';
var buscaEnHilo = '';
var marcaActual = 0;

function chipEtiqueta(e, extra) {
  return '<span class="chip tono-' + (TONO_ETIQUETA[e] || 'gris') + '">' + esc(NOMBRE_ETIQUETA[e] || e) + (extra || '') + '</span>';
}

/* --------------------------------------------------------------- cargar todo */
function filtrosActuales() {
  var p = new URLSearchParams();
  var pon = function (clave, id) { var v = $(id).value.trim(); if (v) p.set(clave, v); };
  pon('q', 'f-q');
  pon('texto', 'f-texto');
  pon('etiqueta', 'f-etiqueta');
  pon('reason', 'f-motivo');
  pon('desde', 'f-desde');
  pon('hasta', 'f-hasta');
  pon('pedido', 'f-pedido');
  if (verPapelera) p.set('papelera', 'si');
  return p;
}

function pintarEtiquetasEnSelectores() {
  var opciones = ETIQUETAS.map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(e.nombre) + '</option>'; }).join('');
  $('f-etiqueta').innerHTML = '<option value="">Cualquier etiqueta</option>' + opciones;
  $('l-etiqueta-add').innerHTML = '<option value="">Añadir etiqueta…</option>' + opciones;
}

async function cargar() {
  var lista = $('lista');
  lista.setAttribute('aria-busy', 'true');
  var p = filtrosActuales();
  p.set('limit', String(POR_PAGINA));
  p.set('offset', String(pagina * POR_PAGINA));
  try {
    datos = await api('/admin/archives?' + p.toString());
  } catch (e) {
    lista.setAttribute('aria-busy', 'false');
    /* El error se ve donde se esperaban los resultados, no solo en un aviso que se va. */
    lista.innerHTML = '<div class="vacio"><h3>No se pudo cargar la lista</h3><p>' + esc(e.message) + '</p><div class="acciones"><button class="btn sm primario" id="reintentar" type="button">Reintentar</button></div></div>';
    $('reintentar').onclick = function () { cargar(); };
    throw e;
  }
  lista.setAttribute('aria-busy', 'false');
  if (!ETIQUETAS.length && (datos.etiquetas || []).length) {
    ETIQUETAS = datos.etiquetas;
    ETIQUETAS.forEach(function (e) { NOMBRE_ETIQUETA[e.id] = e.nombre; });
    pintarEtiquetasEnSelectores();
  }
  /* Si al borrar o al filtrar la última página se queda vacía, se retrocede en vez de enseñar un vacío falso. */
  var ultima = Math.max(0, Math.ceil(datos.total / POR_PAGINA) - 1);
  if (pagina > ultima) { pagina = ultima; return cargar(); }
  pintarTarjetas();
  pintarEstadisticas();
  pintarLista();
}

/* ------------------------------------------------------------ las tarjetas */
function saludHtml() {
  if (!salud) return '<span class="muted">…</span>';
  if (salud.fallo) return '<span class="tono-rojo">?</span>';
  if (salud.rotos) return '<span class="tono-rojo">' + salud.rotos + ' con problema</span>';
  return '<span class="tono-verde">' + salud.revisados + ' bien</span>';
}

function tarjeta(clase, numero, pie, acciones) {
  return '<div class="tarjeta' + (clase ? ' ' + clase : '') + '"><div class="n">' + numero + '</div><div class="q">' + pie + '</div>' + (acciones ? '<div class="acciones">' + acciones + '</div>' : '') + '</div>';
}

function pintarTarjetas() {
  var s = datos.stats;
  var dias = datos.inactividadDias;
  var top = Object.keys(s.porEtiqueta || {}).sort(function (a, b) { return s.porEtiqueta[b] - s.porEtiqueta[a]; }).slice(0, 3);

  var detalleTotal = s.messages + ' mensajes';
  if (s.bytes) detalleTotal += ' · ' + peso(s.bytes);
  if (s.conAdjuntos) detalleTotal += ' · ' + s.conAdjuntos + ' con fotos o audios';

  var accionesPapelera = '<button class="btn sm" id="ver-papelera" type="button">' + (verPapelera ? 'Ver las guardadas' : 'Ver la papelera') + '</button>';
  var accionesDias = '<button class="btn sm" id="cambiar-dias" type="button">' + (dias ? 'Cambiar los días' : 'Elegir los días') + '</button>' +
    (dias ? '<button class="btn sm" id="barrer" type="button" title="Guarda ahora mismo los chats que llevan esos días sin movimiento">Guardarlas ya</button>' : '');

  var acciones = '<button class="btn sm primario" id="cerrar-hoy" type="button">Guardar las de los pedidos terminados hoy</button>' +
    '<button class="btn sm" id="excel" type="button">Bajar a Excel</button>' +
    '<button class="btn sm" id="excel-anon" type="button" title="Nombres y teléfonos tapados, y los datos personales de resúmenes y notas también">Excel sin datos personales</button>' +
    (datos.conEntrenamiento === false ? '' : '<button class="btn sm" id="aprender-mes" type="button" title="Las preguntas y respuestas de las conversaciones de este mes entran en Entrenar a la IA, pendientes de revisar">Enseñar a la IA con las de este mes</button>');

  var reclamos = (s.porEtiqueta && s.porEtiqueta.reclamo) || 0;
  $('tarjetas').innerHTML =
    tarjeta('', s.total, 'conversaciones guardadas · ' + detalleTotal, '') +
    tarjeta('', reclamos ? '<span class="tono-rojo">' + reclamos + '</span>' : '0', 'con reclamo' + (s.total ? ' (' + s.pctReclamo + ' % de todas)' : ''), '') +
    tarjeta('', s.enPapelera, 'en la papelera: se borran solas a los 30 días', accionesPapelera) +
    tarjeta('', saludHtml(), 'copias comprobadas' + (salud && salud.adjuntosFaltan ? ' · faltan ' + salud.adjuntosFaltan + ' ' + plural(salud.adjuntosFaltan, 'adjunto', 'adjuntos') : ''), '<button class="btn sm" id="revisar" type="button" title="Comprueba que cada conversación guardada sigue en el disco y sin cambios">Revisar las copias</button>') +
    tarjeta('', dias ? dias + ' días' : 'A mano', dias ? 'sin movimiento y un chat se guarda solo' : 'los chats solo se guardan a mano, desde Chats', accionesDias) +
    tarjeta('', top.length ? top.map(function (e) { return '<span class="et">' + chipEtiqueta(e) + s.porEtiqueta[e] + '</span>'; }).join('') : '—', 'etiquetas más frecuentes' + (datos.conIA ? '' : ' (las pone el sistema por palabras clave; con la IA encendida las afina)'), '') +
    '<div class="tarjeta ancha"><div class="q">Todas a la vez</div><div class="acciones">' + acciones + '</div></div>';

  $('ver-papelera').onclick = function () { verPapelera = !verPapelera; pagina = 0; cerrarLector(); recargar(); };
  $('revisar').onclick = revisar;
  $('cambiar-dias').onclick = cambiarDias;
  if ($('barrer')) $('barrer').onclick = barrer;
  $('cerrar-hoy').onclick = cerrarHoy;
  $('excel').onclick = function () { window.location.href = '/admin/archives/export.csv?' + filtrosActuales().toString(); };
  $('excel-anon').onclick = function () { var p = filtrosActuales(); p.set('anonimo', 'si'); window.location.href = '/admin/archives/export.csv?' + p.toString(); };
  if ($('aprender-mes')) $('aprender-mes').onclick = aprenderMes;
}

/* Las estadisticas solo cuentan lo que NO esta ya en las tarjetas. */
function pintarEstadisticas() {
  var s = datos.stats;
  var semanas = s.porSemana || [];
  var max = 1;
  semanas.forEach(function (w) { if (w.n > max) max = w.n; });
  var enOchoSemanas = semanas.reduce(function (t, w) { return t + w.n; }, 0);
  $('est-sub').textContent = s.total ? enOchoSemanas + ' en las últimas 8 semanas' : 'todavía no hay nada que contar';
  var motivos = Object.keys(s.porMotivo || {}).sort(function (a, b) { return s.porMotivo[b] - s.porMotivo[a]; });
  $('est-cuerpo').innerHTML =
    '<div class="est">' +
      '<div><h3>Conversaciones guardadas por semana (las últimas 8)</h3><div class="barras">' +
        semanas.map(function (w) { return '<div class="barra" title="Semana del ' + esc(semanaCorta(w.semana)) + ': ' + w.n + '"><div class="n">' + w.n + '</div><div class="b" style="height:' + Math.max(2, Math.round((w.n / max) * 100)) + '%"></div><div class="l">' + esc(semanaCorta(w.semana)) + '</div></div>'; }).join('') +
      '</div></div>' +
      '<div><h3>Por qué se guardaron</h3><div class="cifras">' +
        '<div class="cifra"><span>Tiempo medio hasta que una persona contesta el primer mensaje</span><b>' + esc(tiempoLegible(s.primeraRespuestaMedioSeg)) + '</b></div>' +
        motivos.map(function (m) { var t = motivoTexto(m); return '<div class="cifra"><span>' + esc(t.charAt(0).toUpperCase() + t.slice(1)) + '</span><b>' + s.porMotivo[m] + '</b></div>'; }).join('') +
      '</div></div>' +
    '</div>';
}

/* ------------------------------------------------------------------ la lista */
function vacioHtml() {
  if (verPapelera) return '<div class="vacio"><div class="ico">🗑️</div><h3>La papelera está vacía</h3><p>Lo que mandes a la papelera se queda aquí 30 días antes de borrarse de verdad.</p><div class="acciones"><button class="btn sm primario" id="vacio-salir-papelera" type="button">Ver las guardadas</button></div></div>';
  if (datos.total === 0 && datos.stats.total > 0) return '<div class="vacio"><h3>Ninguna con esos filtros</h3><p>Prueba con otra palabra, otra etiqueta u otras fechas.</p><div class="acciones"><button class="btn sm primario" id="vacio-limpiar" type="button">Quitar los filtros</button></div></div>';
  return '<div class="vacio"><div class="ico">🗂️</div><h3>Todavía no hay conversaciones guardadas</h3><p>Cierra un chat con «Guardar y vaciar» y aparecerá aquí con su resumen y sus etiquetas.</p><div class="acciones"><a class="btn sm primario" href="/chat">Ir a Chats</a></div></div>';
}

function filaHtml(a) {
  var adj = (a.adjuntos || []).filter(function (x) { return !x.omitido; }).length;
  var quien = a.name || telefonoBonito(a.phone);
  var detalle = a.messageCount + ' ' + plural(a.messageCount, 'mensaje', 'mensajes') +
    (adj ? ' · 📎 ' + adj : '') +
    ' · ' + (a.origen === 'importado_txt' ? 'importada del teléfono' : motivoTexto(a.reason) + (a.cerradoPor ? ' por ' + a.cerradoPor : ''));
  var chips = (a.pedido ? '<span class="chip tono-azul">' + esc(a.pedido) + '</span>' : '') + (a.etiquetas || []).map(function (e) { return chipEtiqueta(e); }).join('');
  return '<button class="fila" type="button" data-id="' + a.id + '"' + (abierta && abierta.id === a.id ? ' aria-current="true"' : '') + '>' +
    '<span class="top"><b>' + esc(quien) + '</b><span class="cuando">' + esc(fechaHora(a.createdAt)) + '</span></span>' +
    '<span class="det">' + esc(detalle) + '</span>' +
    (chips ? '<span class="chips">' + chips + '</span>' : '') +
    (a.resumen ? '<span class="res">' + resaltar(a.resumen, textoLista) + '</span>' : '') +
    '</button>';
}

function pintarLista() {
  var caja = $('lista');
  $('titulo-vista').innerHTML = verPapelera ? '<span class="chip tono-ambar">Papelera</span>' : '';
  $('total').textContent = datos.total ? datos.total + ' en total' : '';
  caja.innerHTML = datos.items.length ? datos.items.map(filaHtml).join('') : vacioHtml();
  if ($('vacio-limpiar')) $('vacio-limpiar').onclick = limpiarFiltros;
  if ($('vacio-salir-papelera')) $('vacio-salir-papelera').onclick = function () { verPapelera = false; pagina = 0; cerrarLector(); recargar(); };
  pintarPaginacion();
}

function pintarPaginacion() {
  var paginas = Math.max(1, Math.ceil(datos.total / POR_PAGINA));
  if (paginas < 2) { $('pag').innerHTML = ''; return; }
  $('pag').innerHTML =
    '<button class="btn sm" id="pag-antes" type="button" aria-label="Página anterior"' + (pagina === 0 ? ' disabled' : '') + '>‹</button>' +
    '<span>página ' + (pagina + 1) + ' de ' + paginas + '</span>' +
    '<button class="btn sm" id="pag-despues" type="button" aria-label="Página siguiente"' + (pagina >= paginas - 1 ? ' disabled' : '') + '>›</button>';
  $('pag-antes').onclick = function () { pagina--; recargar(); };
  $('pag-despues').onclick = function () { pagina++; recargar(); };
}

/* Un solo sitio donde recargar y donde enseñar el fallo: nadie traga errores en silencio. */
function recargar() { return cargar().catch(function (e) { toast(e.message); }); }

function limpiarFiltros() {
  ['f-q', 'f-texto', 'f-etiqueta', 'f-motivo', 'f-desde', 'f-hasta', 'f-pedido'].forEach(function (id) { $(id).value = ''; });
  $('f-desde').removeAttribute('max');
  $('f-hasta').removeAttribute('min');
  textoLista = '';
  pagina = 0;
  recargar();
}

/* -------------------------------------------------------------- los adjuntos */
/* El adjunto de un mensaje: la foto, el audio, el documento... o por que no esta. */
function adjuntoHtml(m) {
  var media = m.payload && m.payload.media;
  var tipo = TIPO[m.kind] || ('📎 ' + esc(m.kind));
  var adj = media && media.id ? adjuntosPorId[media.id] : null;
  if (!adj) return '<span class="k">' + tipo + ' (no se guardó' + (datos && datos.conAdjuntos === false ? ': este arranque no copia ficheros' : '') + ')</span>';
  if (adj.omitido) return '<span class="k">' + tipo + ' (no se guardó: ' + esc(adj.omitido) + ')</span>';
  var attrs = ' data-adj="' + esc(adj.id) + '" data-kind="' + esc(adj.kind) + '"';
  if (adj.kind === 'image') return '<img class="adj"' + attrs + ' alt="Foto de la conversación" title="Abrir en grande">';
  if (adj.kind === 'audio') return '<audio class="adj"' + attrs + ' controls preload="none"></audio>';
  if (adj.kind === 'video') return '<video class="adj"' + attrs + ' controls playsinline preload="none"></video>';
  /* Sin href hasta que llega el fichero: asi el enlace nunca lleva a ninguna parte. */
  return '<a class="adj doc"' + attrs + ' download="' + esc(adj.nombre || 'documento') + '">📄 ' + esc(adj.nombre || 'documento') + ' <span class="k">(' + peso(adj.bytes) + ')</span></a>';
}

function ponerAdjunto(el, url) {
  if (el.tagName === 'A') el.href = url;
  else el.src = url;
  if (el.tagName === 'IMG') el.onclick = function () { window.open(url, '_blank'); };
}

/* Se sueltan los ficheros de la conversacion anterior: si no, el navegador los guarda hasta recargar. */
function olvidarAdjuntos() {
  generacionAdjuntos++;
  Object.keys(urlsAdjuntos).forEach(function (k) { URL.revokeObjectURL(urlsAdjuntos[k]); });
  urlsAdjuntos = {};
}

/* Los ficheros se piden despues de pintar: van detras de la sesion (cookie), y
   una etiqueta <img> no la manda por si sola. Se guardan por id para que
   buscar dentro del hilo (que lo repinta) no vuelva a bajarlos, y la
   "generacion" evita que la conversacion anterior escriba en el hilo nuevo. */
function cargarAdjuntos() {
  if (!abierta) return;
  var id = abierta.id;
  var mia = generacionAdjuntos;
  document.querySelectorAll('#l-hilo [data-adj]').forEach(function (el) {
    var mediaId = el.getAttribute('data-adj');
    if (urlsAdjuntos[mediaId]) { ponerAdjunto(el, urlsAdjuntos[mediaId]); return; }
    fetch('/admin/archives/' + id + '/adjunto/' + encodeURIComponent(mediaId), { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('no llegó'); return r.blob(); })
      .then(function (b) {
        if (mia !== generacionAdjuntos) return;
        urlsAdjuntos[mediaId] = URL.createObjectURL(b);
        ponerAdjunto(el, urlsAdjuntos[mediaId]);
      })
      .catch(function () {
        if (mia !== generacionAdjuntos) return;
        el.outerHTML = '<span class="k">' + (TIPO[el.getAttribute('data-kind')] || '📎 adjunto') + ' (el fichero ya no está en el servidor)</span>';
      });
  });
}

/* ------------------------------------------------------------------ el lector */
function cabeceraLector() {
  var a = abierta;
  var adjuntos = (a.adjuntos || []).filter(function (x) { return !x.omitido; }).length;
  var perdidos = (a.adjuntos || []).length - adjuntos;

  $('l-nombre').textContent = a.name || telefonoBonito(a.phone);
  /* Quien es, arriba; lo que le pasó a la conversación, debajo: dos ideas, dos líneas. */
  $('l-sub').textContent = telefonoBonito(a.phone) + ' · ' + a.messageCount + ' ' + plural(a.messageCount, 'mensaje', 'mensajes') +
    (adjuntos ? ' · ' + adjuntos + ' ' + plural(adjuntos, 'adjunto', 'adjuntos') : '') +
    (perdidos ? ' (' + perdidos + ' sin guardar)' : '');
  $('l-meta').textContent = (a.origen === 'importado_txt' ? 'Importada del teléfono' : 'Guardada ' + motivoTexto(a.reason) + (a.cerradoPor ? ' por ' + a.cerradoPor : '')) +
    ' el ' + fechaHora(a.createdAt) +
    (a.primeraRespuestaSeg !== null && a.primeraRespuestaSeg !== undefined ? ' · contestada en ' + tiempoLegible(a.primeraRespuestaSeg) : '');
  pintarChips();
  $('l-resumen').innerHTML = a.resumen
    ? '<b>Resumen:</b> ' + resaltar(a.resumen, buscaEnHilo)
    : '<span class="muted">Sin resumen todavía' + (datos.conIA ? '' : ' (conecta la IA en Asistente IA para que lo escriba sola)') + '.</span>';
}

function pintarChips() {
  var a = abierta;
  $('l-chips').innerHTML =
    (a.deletedAt ? '<span class="chip tono-ambar">En la papelera</span>' : '') +
    (a.pedido ? '<span class="chip tono-azul">' + esc(a.pedido) + '</span>' : '') +
    (a.origen === 'importado_txt' ? '<span class="chip tono-gris">Importada</span>' : '') +
    etiquetasEdit.map(function (e) { return chipEtiqueta(e, ' <button class="quitar" type="button" data-quitar-etiqueta="' + esc(e) + '" aria-label="Quitar la etiqueta ' + esc(NOMBRE_ETIQUETA[e] || e) + '">✕</button>'); }).join('');
}

/* Qué botones tienen sentido según dónde está la conversación y qué trae este arranque. */
function ajustarAcciones() {
  var enPapelera = Boolean(abierta.deletedAt);
  var ver = function (id, visible) { $(id).classList.toggle('hidden', !visible); };
  ver('l-restaurar', !enPapelera);
  ver('l-recuperar', enPapelera);
  ver('l-borrar', !enPapelera);
  ver('l-borrar-cliente', !enPapelera);
  ver('l-compartir', !enPapelera);
  ver('l-aprender', datos.conEntrenamiento !== false);
  /* Sin la clave que firma los enlaces no se puede compartir: se dice antes de pulsar, no después. */
  var sinEnlaces = datos.conEnlaces === false;
  $('l-compartir').disabled = sinEnlaces;
  if (sinEnlaces) $('l-compartir').title = 'En este arranque no se pueden crear enlaces: falta la clave con la que se firman.';
  $('l-mas').open = false;
}

function pintarHilo() {
  $('l-hilo').innerHTML = mensajesAbiertos.map(function (m) {
    var adjunto = SIN_FICHERO.indexOf(m.kind) >= 0 ? (m.kind === 'location' ? '<span class="k">📍 ubicación</span>' : '') : adjuntoHtml(m);
    var texto = m.body && CUERPOS_GENERICOS.indexOf(m.body) < 0 ? resaltar(m.body, buscaEnHilo) : '';
    var cuerpo = [adjunto, texto].filter(Boolean).join('\n') || '<span class="k">(sin texto)</span>';
    return '<div class="g ' + (m.direction === 'in' ? 'cli' : 'neg') + '">' + cuerpo + '<div class="h">' + esc(fechaHora(m.createdAt)) + '</div></div>';
  }).join('');
  cargarAdjuntos();
  actualizarBusquedaEnHilo(0);
}

async function abrir(id) {
  try {
    var r = await api('/admin/archives/' + id);
    abierta = r.archive;
    mensajesAbiertos = r.messages || [];
    adjuntosPorId = {};
    (abierta.adjuntos || []).forEach(function (a) { adjuntosPorId[a.id] = a; });
    etiquetasEdit = (abierta.etiquetas || []).slice();
    olvidarAdjuntos();
    /* Lo que se buscó en la lista ya viene escrito aquí: se sigue leyendo sin repetir la palabra. */
    buscaEnHilo = textoLista;
    $('l-buscar').value = buscaEnHilo;

    $('lector-vacio').classList.add('hidden');
    $('lector-con').classList.remove('hidden');
    cabeceraLector();
    ajustarAcciones();
    $('l-enlace').classList.add('hidden');
    $('l-notas').value = abierta.notas || '';
    $('l-notas-estado').textContent = '';
    pintarHilo();
    document.querySelectorAll('.fila').forEach(function (f) {
      if (Number(f.getAttribute('data-id')) === id) f.setAttribute('aria-current', 'true');
      else f.removeAttribute('aria-current');
    });
    $('lector').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { toast(e.message); }
}

function cerrarLector() {
  abierta = null;
  mensajesAbiertos = [];
  adjuntosPorId = {};
  olvidarAdjuntos();
  $('lector-con').classList.add('hidden');
  $('lector-vacio').classList.remove('hidden');
}

/* ------------------------------------------------------- buscar dentro del hilo */
function actualizarBusquedaEnHilo(indice) {
  var marcas = $('l-hilo').querySelectorAll('mark');
  var hay = marcas.length;
  marcaActual = hay ? ((indice % hay) + hay) % hay : 0;
  marcas.forEach(function (m, i) { m.classList.toggle('aqui', i === marcaActual); });
  $('l-buscar-n').textContent = !buscaEnHilo ? '' : hay ? (marcaActual + 1) + '/' + hay : 'nada';
  $('l-buscar-antes').disabled = hay < 2;
  $('l-buscar-despues').disabled = hay < 2;
  if (hay) marcas[marcaActual].scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function moverBusqueda(paso) { if ($('l-hilo').querySelectorAll('mark').length) actualizarBusquedaEnHilo(marcaActual + paso); }

/* ------------------------------------------------------------------- acciones */
async function conBoton(boton, trabajo) {
  boton.disabled = true;
  try { await trabajo(); } catch (e) { toast(e.message); } finally { boton.disabled = false; }
}

async function revisar() {
  if (!datos) return;
  salud = null;
  pintarTarjetas();
  try {
    var r = await api('/admin/archives/revision');
    salud = r;
    if (r.rotos) {
      var malos = r.items.filter(function (i) { return !i.ok; });
      toast('Ficheros con problema: ' + malos.slice(0, 3).map(function (i) { return telefonoBonito(i.phone) + ' (' + i.detalle + ')'; }).join('; ') + (malos.length > 3 ? ' y ' + (malos.length - 3) + ' más.' : '.'));
    }
  } catch (e) {
    salud = { fallo: true };
    toast(e.message);
  }
  if (datos) pintarTarjetas();
}

async function cambiarDias() {
  var actual = datos.inactividadDias || 0;
  var marca = function (n) { return n === actual ? ' (ahora)' : ''; };
  var v = await elegirOpcion({ titulo: 'Guardar solas las conversaciones', texto: 'Cuando un chat lleva estos días sin ningún mensaje, se guarda solo y se vacía del chat. Se puede devolver al chat cuando haga falta.', opciones: [
    { valor: 7, etiqueta: 'A los 7 días' + marca(7), detalle: 'Chats muy limpios; lo de la semana pasada ya está guardado.' },
    { valor: 15, etiqueta: 'A los 15 días' + marca(15), detalle: 'Un término medio.' },
    { valor: 30, etiqueta: 'A los 30 días' + marca(30), detalle: 'Recomendado: un mes sin escribirse.', principal: actual === 30 || !actual },
    { valor: 60, etiqueta: 'A los 60 días' + marca(60), detalle: 'Solo lo muy viejo.' },
    { valor: 0, etiqueta: 'Nunca' + marca(0), detalle: 'Solo se guardan a mano, desde Chats.' },
    { valor: 'otro', etiqueta: 'Otro número de días…', detalle: '' }
  ], cancelar: 'Dejarlo como está' });
  if (v === null) return;
  if (v === 'otro') {
    var otro = await pedirDato({ titulo: 'Otro número de días', etiqueta: 'Días sin movimiento', valor: String(actual), boton: 'Guardar', validar: function (x) { return /^\d{1,4}$/.test(x) ? null : 'Escribe un número de días.'; } });
    if (otro === null) return;
    v = Number(otro);
  }
  try {
    await api('/admin/ajustes', { method: 'POST', body: { guardados: { inactividadDias: Number(v) } } });
    toast(Number(v) ? 'Listo: a los ' + v + ' días sin mensajes, cada chat se guarda solo.' : 'Listo: ya no se guarda ninguno solo; solo a mano.');
    await recargar();
  } catch (e) { toast(e.message); }
}

async function barrer() {
  var dias = datos.inactividadDias;
  /* Sin plazo elegido no hay nada que barrer: el botón ni siquiera se pinta, pero se protege igual. */
  if (!dias) { toast('Primero elige cada cuántos días se guardan solas.'); return; }
  var si = await confirmarDialogo({ titulo: 'Guardar las inactivas ya', texto: 'Se guardan y se vacían del chat las conversaciones sin movimiento desde hace ' + dias + ' días.', boton: 'Guardar' });
  if (!si) return;
  try {
    var r = await api('/admin/archives/barrer', { method: 'POST', body: { dias: dias } });
    toast('Guardadas ' + r.archivados + ' ' + plural(r.archivados, 'conversación', 'conversaciones') + ' (' + r.mensajes + ' mensajes).');
    await recargar();
  } catch (e) { toast(e.message); }
}

async function cerrarHoy() {
  var si = await confirmarDialogo({ titulo: 'Guardar las de los pedidos terminados hoy', texto: 'Se guardan y se vacían del chat las conversaciones de los clientes cuyo pedido de hoy ya se avisó o terminó. Quedan aquí, ligadas a su pedido.', boton: 'Guardar' });
  if (!si) return;
  try {
    var r = await api('/admin/archives/cerrar', { method: 'POST', body: { pedidosDeHoy: true } });
    var saltadas = (r.saltadas || []).length;
    toast('Guardadas ' + r.guardadas + ' ' + plural(r.guardadas, 'conversación', 'conversaciones') + (saltadas ? ' (' + saltadas + ' sin mensajes que guardar)' : '') + '.');
    await recargar();
  } catch (e) { toast(e.message); }
}

async function aprenderMes() {
  var si = await confirmarDialogo({ titulo: 'Enseñar a la IA con las de este mes', texto: 'De cada conversación guardada este mes se sacan las preguntas del cliente con la respuesta que dio una persona (lo que contestó la IA no cuenta). Entran en Entrenar a la IA pendientes de revisar: nada se usa hasta que alguien lo apruebe.', boton: 'Enseñar' });
  if (!si) return;
  try {
    var r = await api('/admin/archives/aprender', { method: 'POST', body: {} });
    toast(r.pares
      ? 'De ' + r.conversaciones + ' ' + plural(r.conversaciones, 'conversación', 'conversaciones') + ' salieron ' + r.nuevas + ' ' + plural(r.nuevas, 'respuesta nueva', 'respuestas nuevas') + (r.repetidas ? ' (' + r.repetidas + ' ya las sabía)' : '') + '. Revísalas en Entrenar a la IA.'
      : 'En las conversaciones de este mes no hay preguntas con respuesta de una persona que se puedan aprender.');
  } catch (e) { toast(e.message); }
}

/* ------------------------------------------------- lo que se pulsa en la pantalla */
$('lista').addEventListener('click', function (ev) {
  var f = ev.target.closest('.fila');
  if (f) abrir(Number(f.getAttribute('data-id')));
});

$('l-chips').addEventListener('click', function (ev) {
  var boton = ev.target.closest('[data-quitar-etiqueta]');
  if (!boton) return;
  etiquetasEdit = etiquetasEdit.filter(function (e) { return e !== boton.getAttribute('data-quitar-etiqueta'); });
  pintarChips();
});

$('l-etiqueta-add').onchange = function () {
  var v = this.value;
  this.value = '';
  if (!v || etiquetasEdit.indexOf(v) >= 0) return;
  /* El servidor solo acepta cinco: mejor decirlo aquí que fallar al guardar. */
  if (etiquetasEdit.length >= TOPE_ETIQUETAS) { toast('Como mucho ' + TOPE_ETIQUETAS + ' etiquetas por conversación.'); return; }
  etiquetasEdit.push(v);
  pintarChips();
};

$('l-guardar-notas').onclick = function () {
  if (!abierta) return;
  var estado = $('l-notas-estado');
  estado.textContent = 'Guardando…';
  conBoton(this, async function () {
    try {
      var r = await api('/admin/archives/' + abierta.id + '/notas', { method: 'POST', body: { notas: $('l-notas').value, etiquetas: etiquetasEdit } });
      abierta = r.archive;
      /* Se vuelve a leer lo que el servidor guardó: si recortó algo, se ve. */
      etiquetasEdit = (abierta.etiquetas || []).slice();
      pintarChips();
      estado.textContent = 'Guardado.';
      await recargar();
    } catch (e) { estado.textContent = e.message; }
  });
};

$('l-txt').onclick = function () { if (abierta) window.location.href = '/admin/archives/' + abierta.id + '/export.txt'; };
$('l-txt-anon').onclick = function () { if (abierta) window.location.href = '/admin/archives/' + abierta.id + '/export.txt?anonimo=si'; };
$('l-pdf').onclick = function () { if (abierta) window.open('/admin/archives/' + abierta.id + '/export.html', '_blank'); };

function copiar(texto) {
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(texto).then(function () { toast('Enlace copiado. Pégalo donde quieras.'); }, function () { toast('No se pudo copiar solo: cópialo del recuadro.'); });
  else toast('Cópialo del recuadro.');
}

$('l-compartir').onclick = async function () {
  if (!abierta) return;
  /* El id se guarda antes de preguntar: mientras el cuadro está abierto se puede cambiar de conversación. */
  var id = abierta.id;
  var d = await pedirDato({ titulo: 'Compartir como evidencia', texto: 'Se crea un enlace de solo lectura para quien no tiene cuenta aquí (el cliente, el motorizado, un abogado). Quien lo abra ve la conversación con el teléfono tapado y sin las notas internas. Pasados los días, deja de funcionar.', etiqueta: 'Días que vale (1 a 30)', valor: '7', boton: 'Crear enlace', validar: function (v) { return /^\d{1,2}$/.test(v) && Number(v) >= 1 && Number(v) <= 30 ? null : 'Escribe un número de días entre 1 y 30.'; } });
  if (d === null) return;
  try {
    var r = await api('/admin/archives/' + id + '/enlace', { method: 'POST', body: { dias: Number(d) } });
    /* El servidor sabe la dirección pública mejor que el navegador (puede ir detrás de un proxy). */
    var url = r.url || (location.origin + r.ruta);
    var caja = $('l-enlace');
    caja.innerHTML = '<span><b>Enlace de evidencia</b> (vale hasta el ' + esc(fechaCorta(r.caducaEn)) + '): <a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + '</a></span> <button class="btn sm" id="l-enlace-copiar" type="button">Copiar</button>';
    caja.classList.remove('hidden');
    $('l-enlace-copiar').onclick = function () { copiar(url); };
    copiar(url);
  } catch (e) { toast(e.message); }
};

$('l-aprender').onclick = function () {
  if (!abierta) return;
  conBoton(this, async function () {
    var r = await api('/admin/archives/' + abierta.id + '/aprender', { method: 'POST', body: {} });
    toast(r.aviso || ('Se enseñaron ' + r.nuevas + ' ' + plural(r.nuevas, 'respuesta', 'respuestas') + (r.repetidas ? ' (' + r.repetidas + ' ya las sabía)' : '') + '. Quedan pendientes de revisar en Entrenar a la IA.'));
  });
};

$('l-resumir').onclick = function () {
  if (!abierta) return;
  var id = abierta.id;
  conBoton(this, async function () {
    var r = await api('/admin/archives/' + id + '/resumir', { method: 'POST', body: {} });
    toast(r.conIA ? 'Resumen hecho con la IA.' : 'Resumen hecho con reglas (sin IA conectada).');
    await recargar();
    await abrir(id);
  });
};

$('l-restaurar').onclick = function () {
  if (!abierta) return;
  var id = abierta.id;
  var quien = abierta.name || telefonoBonito(abierta.phone);
  var boton = this;
  (async function () {
    var si = await confirmarDialogo({ titulo: 'Devolver al chat', texto: 'Los mensajes vuelven al chat de ' + quien + '. La copia guardada se conserva aquí.', boton: 'Devolver' });
    if (!si) return;
    conBoton(boton, async function () {
      var r = await api('/admin/archives/' + id + '/restore', { method: 'POST', body: {} });
      toast('Devueltos ' + r.restaurados + ' mensajes al chat de ' + quien + '.');
    });
  })();
};

$('l-borrar').onclick = function () {
  if (!abierta) return;
  var id = abierta.id;
  (async function () {
    var si = await confirmarDialogo({ titulo: 'Mandar a la papelera', texto: 'Se queda 30 días en la papelera por si hace falta; después se borra de verdad.', boton: 'A la papelera', peligro: true });
    if (!si) return;
    try {
      await api('/admin/archives/' + id, { method: 'DELETE' });
      toast('En la papelera 30 días.');
      cerrarLector();
      await recargar();
      revisar();
    } catch (e) { toast(e.message); }
  })();
};

$('l-borrar-cliente').onclick = function () {
  if (!abierta) return;
  var contactId = abierta.contactId;
  var quien = abierta.name || telefonoBonito(abierta.phone);
  (async function () {
    var v = await pedirDato({ titulo: 'Borrar todo lo de ' + quien, texto: 'Es lo que se hace cuando un cliente pide que se borren sus datos. Lo que aún tenga en el chat se guarda primero, y TODO lo suyo se manda a la papelera; a los 30 días se borra de verdad.', etiqueta: 'Escribe BORRAR', marcador: 'BORRAR', boton: 'Borrar todo', validar: function (x) { return x === 'BORRAR' ? null : 'Escribe BORRAR, en mayúsculas, para confirmar.'; } });
    if (v === null) return;
    try {
      var r = await api('/admin/archives/borrar-cliente', { method: 'POST', body: { contactId: contactId, confirmar: v } });
      toast('Listo: ' + r.aPapelera + ' ' + plural(r.aPapelera, 'conversación', 'conversaciones') + ' de ' + quien + ' en la papelera 30 días' + (r.guardadas ? ' (una se guardó del chat antes)' : '') + '.');
      cerrarLector();
      await recargar();
      revisar();
    } catch (e) { toast(e.message); }
  })();
};

$('l-recuperar').onclick = function () {
  if (!abierta) return;
  var id = abierta.id;
  conBoton(this, async function () {
    await api('/admin/archives/' + id + '/recuperar', { method: 'POST', body: {} });
    toast('Recuperada: vuelve a estar entre las guardadas.');
    await recargar();
    await abrir(id);
  });
};

/* El menú «Mas…» se cierra al usarlo, al pulsar fuera y con Escape. */
$('l-mas').querySelector('.menu-caja').addEventListener('click', function () { $('l-mas').open = false; });
document.addEventListener('click', function (ev) { if ($('l-mas').open && !$('l-mas').contains(ev.target)) $('l-mas').open = false; });
document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && $('l-mas').open) $('l-mas').open = false; });

/* -------------------------------------------------------- buscar dentro del hilo */
var temporizadorHilo = null;
$('l-buscar').oninput = function () {
  var v = this.value.trim();
  clearTimeout(temporizadorHilo);
  temporizadorHilo = setTimeout(function () {
    if (v === buscaEnHilo) return;
    buscaEnHilo = v;
    if (abierta) { cabeceraLector(); pintarHilo(); }
  }, 200);
};
$('l-buscar').onkeydown = function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); moverBusqueda(ev.shiftKey ? -1 : 1); } };
$('l-buscar-antes').onclick = function () { moverBusqueda(-1); };
$('l-buscar-despues').onclick = function () { moverBusqueda(1); };

/* ------------------------------------------------------------------- importar */
var impTemporizador = null;
var impImportando = false;

/* Antes de importar se lee el texto y se dice cuantos mensajes hay y de quien. */
async function previsualizarImportacion() {
  if (impImportando) return;
  var texto = $('imp-texto').value;
  var estado = $('imp-estado');
  var boton = $('imp-enviar');
  if (!texto.trim()) { estado.textContent = ''; boton.textContent = 'Importar la conversación'; boton.disabled = false; return; }
  try {
    var r = await api('/admin/archives/importar/vista-previa', { method: 'POST', body: { texto: texto, nombre: $('imp-nombre').value.trim() || undefined } });
    var avisos = (r.avisos || []).join(' ');
    if (!r.ok || !r.mensajes) {
      estado.textContent = 'No se encontraron mensajes con el formato de WhatsApp (fecha, hora - nombre: texto). ' + avisos;
      boton.textContent = 'Importar la conversación';
      boton.disabled = true;
      return;
    }
    estado.textContent = 'Se leyeron ' + r.mensajes + ' mensajes: ' + r.delCliente + ' de ' + (r.cliente || 'el cliente') + ' y ' + r.delNegocio + ' de ' + (r.negocio || 'el negocio') +
      (r.desde ? ', del ' + fechaCorta(r.desde) + ' al ' + fechaCorta(r.hasta) : '') + '.' +
      (r.descartadas ? ' ' + r.descartadas + ' líneas no se entendieron.' : '') + (avisos ? ' ' + avisos : '');
    boton.textContent = 'Importar ' + r.mensajes + ' ' + plural(r.mensajes, 'mensaje', 'mensajes');
    boton.disabled = false;
  } catch (e) {
    estado.textContent = e.message;
    boton.disabled = false;
  }
}

function previsualizarPronto() { clearTimeout(impTemporizador); impTemporizador = setTimeout(previsualizarImportacion, 500); }
$('imp-texto').oninput = previsualizarPronto;
$('imp-nombre').oninput = previsualizarPronto;
$('imp-fichero').onchange = function () {
  var f = this.files && this.files[0];
  if (!f) return;
  var lector = new FileReader();
  lector.onload = function () {
    $('imp-texto').value = String(lector.result || '');
    $('imp-estado').textContent = 'Leído ' + f.name + ' (' + peso(f.size) + '). Contando mensajes…';
    previsualizarImportacion();
  };
  lector.onerror = function () { $('imp-estado').textContent = 'No se pudo leer ese archivo: ábrelo y pega el texto aquí.'; };
  lector.readAsText(f, 'utf-8');
};

$('imp-enviar').onclick = async function () {
  var texto = $('imp-texto').value;
  var tel = $('imp-tel').value.trim();
  var nombre = $('imp-nombre').value.trim();
  var estado = $('imp-estado');
  if (!texto.trim()) { estado.textContent = 'Pega el texto del chat o elige el archivo .txt.'; $('imp-texto').focus(); return; }
  if (tel.replace(/\D/g, '').length < 6) { estado.textContent = 'Falta el teléfono del cliente.'; $('imp-tel').focus(); return; }
  var b = this;
  b.disabled = true;
  impImportando = true;
  clearTimeout(impTemporizador);
  estado.textContent = 'Importando…';
  try {
    var r = await api('/admin/archives/importar', { method: 'POST', body: { texto: texto, telefono: tel, nombre: nombre || undefined } });
    var avisos = (r.lectura && r.lectura.avisos || []).join(' ');
    estado.textContent = 'Importados ' + r.mensajes + ' mensajes' + (r.desde ? ' (del ' + fechaCorta(r.desde) + ' al ' + fechaCorta(r.hasta) + ')' : '') + '.' + (avisos ? ' ' + avisos : '');
    $('imp-texto').value = '';
    $('imp-fichero').value = '';
    await recargar();
    await abrir(r.archive.id);
  } catch (e) { estado.textContent = e.message; }
  impImportando = false;
  b.disabled = false;
  b.textContent = 'Importar la conversación';
};

/* ------------------------------------------------------------------- filtros */
var temporizador = null;
function filtrarPronto() {
  clearTimeout(temporizador);
  temporizador = setTimeout(function () { pagina = 0; recargar(); }, 350);
}
['f-q', 'f-pedido'].forEach(function (id) { $(id).oninput = filtrarPronto; });
/* Lo que se busca en la lista es también lo que se resalta al abrir una: una sola palabra, dos usos. */
$('f-texto').oninput = function () { textoLista = this.value.trim(); filtrarPronto(); };
['f-etiqueta', 'f-motivo'].forEach(function (id) { $(id).onchange = function () { pagina = 0; recargar(); }; });
/* Un rango imposible no devuelve nada y nadie entiende por qué: el propio campo lo impide. */
$('f-desde').onchange = function () { if (this.value) $('f-hasta').min = this.value; else $('f-hasta').removeAttribute('min'); pagina = 0; recargar(); };
$('f-hasta').onchange = function () { if (this.value) $('f-desde').max = this.value; else $('f-desde').removeAttribute('max'); pagina = 0; recargar(); };

/* Llegar con ?tel= (desde un chat) o ?pedido= (desde Hoy) ya filtra; ?abrir= abre una; ?importar=si despliega la caja. */
var params = new URLSearchParams(location.search);
if (params.get('tel')) $('f-q').value = params.get('tel');
if (params.get('pedido')) $('f-pedido').value = params.get('pedido');
if (params.get('texto')) { $('f-texto').value = params.get('texto'); textoLista = params.get('texto').trim(); }
if (params.get('importar') === 'si') $('importar').open = true;

cargar()
  .then(function () {
    revisar();
    if (params.get('abrir')) abrir(Number(params.get('abrir')));
  })
  .catch(function (e) { toast(e.message); });
`;

  return appShell({
    titulo: 'Conversaciones guardadas',
    subtitulo: 'Las conversaciones ya cerradas: buscarlas, leerlas con sus fotos y audios, exportarlas, compartirlas como evidencia y devolverlas al chat',
    contenido,
    script,
    css: CSS,
    nombreNegocio: opts.nombreNegocio,
    demo: opts.demo,
    icono: '🗂',
  });
}
