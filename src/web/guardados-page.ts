/**
 * Pantalla "Conversaciones guardadas": las conversaciones ya cerradas.
 *
 * A la izquierda la lista, con buscador por nombre o numero, buscador DENTRO
 * de lo que se dijo, filtros por etiqueta, motivo, pedido y fechas; a la
 * derecha, el lector de solo lectura con las fotos, audios y documentos que
 * se guardaron, el resumen de la IA, las etiquetas, las notas de una persona
 * y lo que se puede hacer: devolver al chat, descargar como texto (con o sin
 * datos personales), imprimir o guardar en PDF, compartir como evidencia con
 * un enlace que caduca, ensenarsela a la IA, volver a resumir, mandar a la
 * papelera o borrar todo lo de ese cliente. Arriba, el estado: cuantas hay,
 * cuanto ocupan, si los ficheros siguen sanos y a cuantos dias se guardan
 * solas; debajo, plegadas, las estadisticas y la caja para importar un chat
 * exportado del telefono.
 *
 * El JS va en String.raw, con var y sin backticks, como el resto.
 */

import { appShell } from './shell.js';

const CSS = `

  * { box-sizing: border-box; }
  .wrap { color: var(--texto); font-family: var(--fuente); font-size: var(--fs-cuerpo); line-height: 1.5; max-width: 1500px; }
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

  textarea { min-height: 60px; }
  label { margin: 8px 0 4px; }
  .tarjeta .acciones { margin-top: 6px; display: flex; gap: 6px; flex-wrap: wrap; }
  .tarjeta .n .et { display: inline-flex; align-items: center; gap: 5px; font-size: 16px; margin: 0 10px 4px 0; }
  .tarjeta .n .et .chip { margin: 0; }
  .tarjetas { align-items: start; }
  .tarjeta.ancha { grid-column: 1 / -1; display: flex; align-items: center; gap: var(--esp-3); flex-wrap: wrap; }
  .tarjeta.ancha .acciones { margin-top: 0; }
  @media (max-width: 640px) {
    .tarjetas { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--esp-2); }
    .tarjeta { padding: var(--esp-2) var(--esp-3); }
    .tarjeta .n { font-size: 19px; }
  }
  .cols { display: grid; grid-template-columns: 440px minmax(0, 1fr); gap: var(--esp-4); align-items: start; }
  @media (max-width: 1100px) { .cols { grid-template-columns: 1fr; } }
  .caja > summary { font-size: 15px; font-weight: 700; margin: 0; padding: var(--esp-3) var(--esp-4); border-bottom: 1px solid var(--borde); display: flex; align-items: center; gap: var(--esp-2); flex-wrap: wrap; cursor: pointer; list-style: none; min-height: 44px; }
  .caja > summary::-webkit-details-marker { display: none; }
  .caja > summary::before { content: '▸'; color: var(--texto-suave); font-size: 12px; }
  .caja[open] > summary::before { content: '▾'; }
  .caja:not([open]) > summary { border-bottom: 0; }
  .caja > summary .sep { flex: 1; }
  .caja > summary .muted { font-weight: 400; font-size: var(--fs-small); }
  .filtros { padding: 10px var(--esp-4); border-bottom: 1px solid var(--borde); display: grid; grid-template-columns: 1fr 1fr; gap: 6px 8px; background: var(--superficie-2); }
  .filtros .ancho { grid-column: 1 / -1; }
  .filtros .flt { display: block; margin: 0; font-size: 11.5px; color: var(--texto-suave); font-weight: 600; text-transform: uppercase; letter-spacing: .03em; }
  .filtros .flt span { display: block; margin: 0 0 3px 2px; }
  .filtros .flt input, .filtros .flt select { font-weight: 400; text-transform: none; letter-spacing: 0; }
  .filtros-mas { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 8px; }
  .mas-filtros-cb, .mas-filtros-boton { display: none; }
  @media (max-width: 640px) {
    .mas-filtros-boton { display: inline-flex; align-items: center; justify-content: center; min-height: 40px; border: 1px solid var(--borde); border-radius: var(--radio-sm); background: var(--superficie); font-size: 13.5px; font-weight: 600; color: var(--primario); cursor: pointer; margin: 0; text-transform: none; letter-spacing: 0; }
    .mas-filtros-boton::before { content: '▸ '; }
    .mas-filtros-cb:checked ~ .mas-filtros-boton::before { content: '▾ '; }
    .filtros-mas { display: none; }
    .mas-filtros-cb:checked ~ .filtros-mas { display: grid; }
  }
  .filtros input, .filtros select { min-height: 36px; font-size: 13.5px; }
  .lista { max-height: 70vh; overflow: auto; }
  .fila { padding: 10px var(--esp-4); border-bottom: 1px solid var(--borde); cursor: pointer; }
  .fila:hover { background: var(--superficie-2); }
  .fila.activa { background: var(--primario-suave); box-shadow: inset 3px 0 0 var(--primario); }
  .fila .top { display: flex; gap: 8px; align-items: baseline; }
  .fila .top b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fila .top .cuando { color: var(--texto-suave); font-size: 12px; white-space: nowrap; }
  .fila .det { color: var(--texto-suave); font-size: var(--fs-small); margin-top: 2px; }
  .fila .res { font-size: 13px; margin-top: 4px; color: var(--texto); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .chip { margin-right: 3px; }
  .chip.reclamo, .chip.cancelacion { background: var(--rojo-suave); color: var(--rojo); }
  .chip.entrega, .chip.venta { background: var(--verde-suave); color: var(--verde); }
  .chip.cambio, .chip.sin_respuesta { background: var(--ambar-suave); color: var(--ambar); }
  .chip.motorizado, .chip.pago, .chip.pedido, .chip.origen { background: var(--azul-suave); color: var(--azul); }
  .chip a[data-quitar-etiqueta] { color: inherit; text-decoration: none; margin-left: 2px; }
  .lista .vacio, #lector-vacio { border: 0; box-shadow: none; background: transparent; }
  .pag { display: flex; gap: 6px; align-items: center; justify-content: center; padding: 8px; font-size: 13px; color: var(--texto-suave); }
  .lector-cab { padding: var(--esp-3) var(--esp-4); border-bottom: 1px solid var(--borde); display: flex; gap: 10px; align-items: flex-start; flex-wrap: wrap; }
  .lector-cab .quien { flex: 1; min-width: 200px; }
  .lector-cab .quien b { font-size: 16px; }
  .lector-cab .quien .sub { color: var(--texto-suave); font-size: var(--fs-small); }
  .lector-cab .acciones { display: flex; gap: 6px; flex-wrap: wrap; }
  .resumen { background: var(--ambar-suave); border-bottom: 1px solid var(--borde); padding: 10px var(--esp-4); font-size: 13.5px; }
  .resumen b { color: var(--ambar); }
  .enlace { background: var(--azul-suave); border-bottom: 1px solid var(--borde); padding: 8px var(--esp-4); font-size: 13px; word-break: break-all; }
  .hilo { max-height: 60vh; overflow: auto; padding: 12px var(--esp-4); background: var(--bg); }
  .g { max-width: 78%; padding: 7px 10px; border-radius: 10px; margin: 5px 0; background: var(--superficie); font-size: 14px; white-space: pre-wrap; word-break: break-word; box-shadow: var(--sombra); }
  .g.neg { margin-left: auto; background: var(--primario-suave); }
  .g .h { font-size: 11px; color: var(--texto-suave); text-align: right; margin-top: 2px; }
  .g .k { color: var(--texto-suave); font-style: italic; }
  .g .adj { display: block; max-width: 100%; max-height: 320px; border-radius: 8px; margin-bottom: 4px; }
  .g img.adj { min-height: 40px; background: var(--superficie-2); cursor: zoom-in; }
  .g a.adj.doc { display: inline-block; max-height: none; padding: 6px 10px; background: var(--superficie-2); border-radius: 8px; text-decoration: none; }
  .notas { padding: 10px var(--esp-4); border-top: 1px solid var(--borde); }
  .est { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: var(--esp-4); }
  @media (max-width: 760px) { .est { grid-template-columns: 1fr; } }
  .est h3 { font-size: 13px; color: var(--texto-suave); margin: 0 0 8px; font-weight: 600; }
  .barras { display: flex; gap: 6px; align-items: flex-end; height: 120px; min-width: 0; }
  .barra { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
  .barra .b { width: 100%; max-width: 34px; background: var(--primario); border-radius: 6px 6px 2px 2px; min-height: 2px; }
  .barra .n { font-size: 11.5px; margin-bottom: 2px; }
  .barra .l { font-size: 10.5px; color: var(--texto-suave); margin-top: 3px; white-space: nowrap; }
  .cifras { display: flex; flex-direction: column; gap: 8px; }
  .cifra { display: flex; justify-content: space-between; gap: 10px; border-bottom: 1px dashed var(--borde); padding-bottom: 5px; font-size: 13.5px; }
  .cifra b { white-space: nowrap; }
  .imp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  @media (max-width: 760px) { .imp-grid { grid-template-columns: 1fr; } }
  .imp-grid .ancho { grid-column: 1 / -1; }
  .ayuda { font-size: 13px; color: var(--texto-suave); margin: 0 0 10px; }
`;

export function guardadosPage(opts: { demo: boolean; nombreNegocio: string; conIA: boolean }): string {
  const contenido = `
<div class="wrap">
${opts.demo ? '<div class="demo">Demostración: nada sale a WhatsApp de verdad.</div>' : ''}

<div class="tarjetas" id="tarjetas"></div>

<details class="caja" id="estadisticas">
  <summary>Estadísticas <span class="sep"></span><span class="muted" id="est-sub"></span></summary>
  <div class="cuerpo" id="est-cuerpo"></div>
</details>

<div class="cols">
  <div class="caja">
    <h2>Conversaciones <span class="sep"></span><span class="muted" id="total" style="font-weight:400;font-size:12.5px"></span></h2>
    <div class="filtros">
      <label class="flt ancho"><span>Cliente</span><input id="f-q" placeholder="Nombre o número"></label>
      <label class="flt ancho"><span>Lo que se dijo</span><input id="f-texto" placeholder="Una palabra del chat (ej. reclamo, no llegó, Yape)"></label>
      <input type="checkbox" id="mas-filtros" class="mas-filtros-cb">
      <label for="mas-filtros" class="mas-filtros-boton ancho">Más filtros</label>
      <div class="filtros-mas ancho">
      <label class="flt"><span>Etiqueta</span><select id="f-etiqueta"><option value="">Cualquier etiqueta</option></select></label>
      <label class="flt"><span>Motivo</span><select id="f-motivo"><option value="">Cualquier motivo</option><option value="manual">Cerrada a mano</option><option value="entrega">Al terminar la entrega</option><option value="inactividad">Por inactividad</option><option value="lead">Al cerrar la ficha</option></select></label>
      <label class="flt"><span>Desde</span><input id="f-desde" type="date" title="Desde"></label>
      <label class="flt"><span>Hasta</span><input id="f-hasta" type="date" title="Hasta"></label>
      <label class="flt"><span>Pedido</span><input id="f-pedido" placeholder="Ej. P-1001"></label>
      <label class="flt"><span>Ver</span><select id="f-papelera"><option value="no">Las guardadas</option><option value="si">La papelera</option></select></label>
      </div>
    </div>
    <div class="lista" id="lista"><div class="vacio">Cargando…</div></div>
    <div class="pag" id="pag"></div>
  </div>

  <div>
  <div class="caja" id="lector">
    <div class="vacio" id="lector-vacio"><div class="ico">💬</div><h3>Elige una conversación de la lista para leerla</h3><p>Se guardan desde Chats (botón «Guardar y vaciar»), solas a los días sin movimiento, o de golpe con «Guardar las de los pedidos terminados hoy».</p></div>
    <div id="lector-con" class="hidden">
      <div class="lector-cab">
        <div class="quien"><b id="l-nombre"></b><div class="sub" id="l-sub"></div><div id="l-chips" style="margin-top:4px"></div></div>
        <div class="acciones">
          <button class="sm" id="l-txt" type="button" title="Como texto plano, con todo">Descargar texto</button>
          <button class="sm" id="l-txt-anon" type="button" title="Como texto plano, con el teléfono tapado, el nombre en iniciales y los datos personales tapados dentro de los mensajes">Sin datos personales</button>
          <button class="sm" id="l-pdf" type="button">Imprimir / PDF</button>
          <button class="sm" id="l-compartir" type="button" title="Un enlace de solo lectura que caduca, para quien no tiene cuenta aquí">Compartir como evidencia</button>
          <button class="sm" id="l-aprender" type="button" title="Sus preguntas y respuestas entran en Entrenar a la IA, pendientes de revisar">Enseñar a la IA</button>
          <button class="sm" id="l-resumir" type="button">Volver a resumir</button>
          <button class="sm" id="l-restaurar" type="button">Devolver al chat</button>
          <button class="sm peligro" id="l-borrar" type="button">A la papelera</button>
          <button class="sm hidden" id="l-recuperar" type="button">Sacar de la papelera</button>
          <button class="sm peligro" id="l-borrar-cliente" type="button" title="Todo lo de este cliente, lo guardado y lo vivo del chat, a la papelera">Borrar todo lo de este cliente</button>
        </div>
      </div>
      <div class="resumen" id="l-resumen"></div>
      <div class="enlace hidden" id="l-enlace"></div>
      <div class="hilo" id="l-hilo"></div>
      <div class="notas">
        <label>Notas de quien atiende (se guardan con la conversación)</label>
        <textarea id="l-notas" placeholder="Ej.: se quejó del motorizado; se le ofreció descuento en el siguiente pedido"></textarea>
        <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap">
          <select id="l-etiqueta-add" style="width:auto"><option value="">Añadir etiqueta…</option></select>
          <button class="sm primary" id="l-guardar-notas" type="button">Guardar notas y etiquetas</button>
          <span class="muted" id="l-notas-estado" style="font-size:12.5px"></span>
        </div>
      </div>
    </div>
  </div>

  <details class="caja" id="importar">
    <summary>Importar un chat exportado del teléfono <span class="sep"></span><span class="muted">de antes de conectar el sistema</span></summary>
    <div class="cuerpo">
      <p class="ayuda">En WhatsApp, abre el chat del cliente → los tres puntos → <b>Más</b> → <b>Exportar chat</b> → <b>Sin archivos</b>. Te da un archivo .txt: elígelo aquí o pega su contenido. Queda como una conversación guardada más, con su resumen y sus etiquetas.</p>
      <div class="imp-grid">
        <div class="ancho"><label for="imp-fichero">El archivo .txt que exportó WhatsApp</label><input type="file" id="imp-fichero" accept=".txt,text/plain"></div>
        <label class="ancho" for="imp-texto" style="margin-bottom:-4px">O pega aquí el contenido del chat</label>
        <textarea class="ancho" id="imp-texto" rows="6" placeholder="12/03/26, 10:15 - Ana Quispe: hola, ¿a qué hora llega mi pedido?&#10;12/03/26, 10:17 - ${opts.nombreNegocio.replace(/"/g, '&quot;')}: Buenos días Ana, sale a las 11."></textarea>
        <div><label for="imp-tel">Teléfono del cliente</label><input id="imp-tel" placeholder="987 654 321"></div>
        <div><label for="imp-nombre">Nombre del cliente tal como sale en el chat (opcional)</label><input id="imp-nombre" placeholder="Ana Quispe"></div>
        <p class="ayuda ancho" style="margin:4px 0 0">Se creará una conversación guardada con esos mensajes, con su resumen y sus etiquetas. No se le manda nada al cliente.</p>
        <div class="ancho" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="primary" id="imp-enviar" type="button">Importar la conversación</button><span class="muted" id="imp-estado" style="font-size:12.5px"></span></div>
      </div>
    </div>
  </details>
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
function toast(texto) { var el = document.createElement('div'); el.className = 'toast'; el.textContent = texto; document.body.appendChild(el); setTimeout(function () { el.remove(); }, 4500); }
function cuando(iso) { if (!iso) return ''; var d = new Date(iso); return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' + d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }); }
function fechaCorta(iso) { if (!iso) return ''; var d = new Date(iso); return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
function telefonoBonito(p) { if (!p) return ''; if (p.length === 11 && p.indexOf('51') === 0) return '+51 ' + p.slice(2, 5) + ' ' + p.slice(5, 8) + ' ' + p.slice(8); return '+' + p; }
function peso(b) { if (b < 1024) return b + ' B'; if (b < 1024 * 1024) return Math.round(b / 1024) + ' KB'; return (b / 1024 / 1024).toFixed(1) + ' MB'; }
function motivoTexto(r) { return r === 'entrega' ? 'al terminar la entrega' : r === 'inactividad' ? 'por inactividad' : r === 'lead' ? 'al cerrar la ficha' : 'cerrada a mano'; }
function tiempoLegible(seg) { if (seg === null || seg === undefined) return '—'; if (seg < 60) return seg + ' s'; if (seg < 3600) return Math.round(seg / 60) + ' min'; var h = Math.floor(seg / 3600); var m = Math.round((seg % 3600) / 60); return h + ' h' + (m ? ' ' + m + ' min' : ''); }
function semanaCorta(lunes) { return lunes.slice(8, 10) + '/' + lunes.slice(5, 7); }
var CUERPOS_GENERICOS = ['(foto)', '(sticker)', '(audio)', '(video)', '(documento)', '(adjunto)', '(ubicacion)', '(ubicación)'];
var TIPO = { image: '🖼 foto', audio: '🎤 audio', video: '🎬 video', document: '📄 documento', sticker: 'sticker', location: '📍 ubicación' };

var ETIQUETAS = [];
var NOMBRE_ETIQUETA = {};
var datos = null;
var abierta = null;
var adjuntosPorId = {};
var pagina = 0;
var POR_PAGINA = 40;
var etiquetasEdit = [];
var ultimaRevision = null;

function chipEtiqueta(e) { return '<span class="chip ' + esc(e) + '">' + esc(NOMBRE_ETIQUETA[e] || e) + '</span>'; }

function filtrosActuales() {
  var p = new URLSearchParams();
  var v;
  if ((v = document.getElementById('f-q').value.trim())) p.set('q', v);
  if ((v = document.getElementById('f-texto').value.trim())) p.set('texto', v);
  if ((v = document.getElementById('f-etiqueta').value)) p.set('etiqueta', v);
  if ((v = document.getElementById('f-motivo').value)) p.set('reason', v);
  if ((v = document.getElementById('f-desde').value)) p.set('desde', v);
  if ((v = document.getElementById('f-hasta').value)) p.set('hasta', v);
  if ((v = document.getElementById('f-pedido').value.trim())) p.set('pedido', v);
  if (document.getElementById('f-papelera').value === 'si') p.set('papelera', 'si');
  return p;
}

async function cargar() {
  var p = filtrosActuales();
  p.set('limit', String(POR_PAGINA));
  p.set('offset', String(pagina * POR_PAGINA));
  datos = await api('/admin/archives?' + p.toString());
  if (!ETIQUETAS.length) {
    ETIQUETAS = datos.etiquetas || [];
    ETIQUETAS.forEach(function (e) { NOMBRE_ETIQUETA[e.id] = e.nombre; });
    var sel = document.getElementById('f-etiqueta');
    sel.innerHTML = '<option value="">Cualquier etiqueta</option>' + ETIQUETAS.map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(e.nombre) + '</option>'; }).join('');
    var add = document.getElementById('l-etiqueta-add');
    add.innerHTML = '<option value="">Añadir etiqueta…</option>' + ETIQUETAS.map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(e.nombre) + '</option>'; }).join('');
  }
  pintarTarjetas();
  pintarEstadisticas();
  pintarLista();
}

function pintarTarjetas() {
  var s = datos.stats;
  var top = Object.keys(s.porEtiqueta || {}).sort(function (a, b) { return s.porEtiqueta[b] - s.porEtiqueta[a]; }).slice(0, 3);
  document.getElementById('tarjetas').innerHTML =
    '<div class="tarjeta"><div class="n">' + s.total + '</div><div class="q">conversaciones guardadas · ' + s.messages + ' mensajes' + (s.bytes >= 1024 * 1024 ? ' · ' + peso(s.bytes) : '') + (s.conAdjuntos ? ' · ' + s.conAdjuntos + ' con fotos o audios' : '') + '</div></div>' +
    '<div class="tarjeta ' + (s.porEtiqueta && s.porEtiqueta.reclamo ? 'bad' : 'ok') + '"><div class="n">' + ((s.porEtiqueta && s.porEtiqueta.reclamo) || 0) + '</div><div class="q">con reclamo' + (s.total ? ' (' + s.pctReclamo + ' %)' : '') + '</div></div>' +
    '<div class="tarjeta"><div class="n">' + s.enPapelera + '</div><div class="q">en la papelera (30 días)</div></div>' +
    '<div class="tarjeta" id="t-salud"><div class="n">' + (ultimaRevision ? (ultimaRevision.rotos ? '<span style="color:var(--bad)">' + ultimaRevision.rotos + ' con problema</span>' : '<span style="color:var(--ok)">' + ultimaRevision.revisados + ' bien</span>') : '…') + '</div><div class="q">copias comprobadas</div><div class="acciones"><button class="sm" id="revisar" type="button" title="Comprueba que cada conversación guardada sigue en el disco y sin cambios">Revisar las copias</button></div></div>' +
    '<div class="tarjeta"><div class="n">' + (datos.inactividadDias ? datos.inactividadDias + ' días' : 'nunca') + '</div><div class="q">' + (datos.inactividadDias ? 'sin movimiento y un chat se guarda solo' : 'se guardan solas: nunca (solo a mano)') + '</div><div class="acciones"><button class="sm" id="cambiar-dias" type="button" title="Cada cuántos días sin mensajes se guarda un chat solo (0 = nunca)">Cambiar los días</button><button class="sm" id="barrer" type="button" title="Guarda ahora mismo los chats que llevan esos días sin movimiento">Guardar las inactivas ya</button></div></div>' +
    '<div class="tarjeta"><div class="n">' + (top.length ? top.map(function (e) { return '<span class="et">' + chipEtiqueta(e) + s.porEtiqueta[e] + '</span>'; }).join('') : '—') + '</div><div class="q">etiquetas más frecuentes</div>' + (datos.conIA ? '' : '<div class="q">las pone el sistema por palabras clave; con la IA encendida las afina</div>') + '</div>' +
    '<div class="tarjeta ancha"><div class="q">Acciones</div><div class="acciones"><button class="sm primary" id="cerrar-hoy" type="button">Guardar las de los pedidos terminados hoy</button><button class="sm" id="excel" type="button">Bajar a Excel</button><button class="sm" id="excel-anon" type="button" title="Nombres y teléfonos tapados (y los datos personales dentro de resúmenes y notas): sirve para compartir o analizar sin exponer a nadie">Bajar a Excel sin datos personales</button><button class="sm" id="aprender-mes" type="button" title="Las preguntas y respuestas de las conversaciones de este mes entran en Entrenar a la IA, pendientes de revisar">Enseñar a la IA con las de este mes</button></div></div>';
  document.getElementById('revisar').onclick = revisar;
  document.getElementById('cambiar-dias').onclick = cambiarDias;
  document.getElementById('barrer').onclick = barrer;
  document.getElementById('cerrar-hoy').onclick = cerrarHoy;
  document.getElementById('excel').onclick = function () { window.location.href = '/admin/archives/export.csv?' + filtrosActuales().toString(); };
  document.getElementById('excel-anon').onclick = function () { var p = filtrosActuales(); p.set('anonimo', 'si'); window.location.href = '/admin/archives/export.csv?' + p.toString(); };
  document.getElementById('aprender-mes').onclick = aprenderMes;
}

function pintarEstadisticas() {
  var s = datos.stats;
  var semanas = s.porSemana || [];
  var max = 1;
  semanas.forEach(function (w) { if (w.n > max) max = w.n; });
  var enOchoSemanas = semanas.reduce(function (t, w) { return t + w.n; }, 0);
  document.getElementById('est-sub').textContent = s.total ? enOchoSemanas + ' guardadas en las últimas 8 semanas · primera respuesta en ' + tiempoLegible(s.primeraRespuestaMedioSeg) + ' · ' + s.pctReclamo + ' % con reclamo' : 'todavía no hay nada que contar';
  var motivos = Object.keys(s.porMotivo || {}).sort(function (a, b) { return s.porMotivo[b] - s.porMotivo[a]; });
  var etiquetas = Object.keys(s.porEtiqueta || {}).sort(function (a, b) { return s.porEtiqueta[b] - s.porEtiqueta[a]; }).slice(0, 6);
  document.getElementById('est-cuerpo').innerHTML =
    '<div class="est">' +
      '<div><h3>Conversaciones guardadas por semana (las últimas 8)</h3><div class="barras">' +
        semanas.map(function (w) { return '<div class="barra" title="Semana del ' + esc(semanaCorta(w.semana)) + ': ' + w.n + '"><div class="n">' + w.n + '</div><div class="b" style="height:' + Math.max(2, Math.round((w.n / max) * 100)) + '%"></div><div class="l">' + esc(semanaCorta(w.semana)) + '</div></div>'; }).join('') +
      '</div></div>' +
      '<div class="cifras">' +
        '<div class="cifra"><span>Tiempo medio hasta que una persona contesta el primer mensaje</span><b>' + esc(tiempoLegible(s.primeraRespuestaMedioSeg)) + '</b></div>' +
        '<div class="cifra"><span>Con reclamo</span><b>' + s.pctReclamo + ' %</b></div>' +
        '<div class="cifra"><span>Con fotos, audios o documentos guardados</span><b>' + s.conAdjuntos + '</b></div>' +
        motivos.map(function (m) { return '<div class="cifra"><span>' + esc(motivoTexto(m).charAt(0).toUpperCase() + motivoTexto(m).slice(1)) + '</span><b>' + s.porMotivo[m] + '</b></div>'; }).join('') +
        (etiquetas.length ? '<div class="cifra"><span>Etiquetas</span><span>' + etiquetas.map(function (e) { return chipEtiqueta(e) + ' ' + s.porEtiqueta[e]; }).join(' ') + '</span></div>' : '') +
      '</div>' +
    '</div>';
}

function pintarLista() {
  var caja = document.getElementById('lista');
  document.getElementById('total').textContent = datos.total ? datos.total + ' en total' : '';
  if (!datos.items.length) {
    caja.innerHTML = datos.stats.total
      ? '<div class="vacio"><h3>Ninguna con esos filtros</h3><p>Prueba con otra palabra, otra etiqueta u otras fechas.</p><div class="acciones"><a class="btn sm" href="/guardados">Quitar los filtros</a></div></div>'
      : '<div class="vacio"><div class="ico">🗂️</div><h3>Todavía no hay conversaciones guardadas</h3><p>Cierra un chat con «Guardar y vaciar» y aparecerá aquí con su resumen y sus etiquetas.</p><div class="acciones"><a class="btn sm" href="/chat">Ir a Chats</a></div></div>';
  } else {
    caja.innerHTML = datos.items.map(function (a) {
      var adj = (a.adjuntos || []).filter(function (x) { return !x.omitido; }).length;
      return '<div class="fila' + (abierta && abierta.id === a.id ? ' activa' : '') + '" data-id="' + a.id + '">' +
        '<div class="top"><b>' + esc(a.name || telefonoBonito(a.phone)) + '</b><span class="cuando">' + esc(cuando(a.createdAt)) + '</span></div>' +
        '<div class="det">' + a.messageCount + ' mensajes' + (adj ? ' · 📎 ' + adj : '') + ' · ' + esc(a.origen === 'importado_txt' ? 'importada del teléfono' : motivoTexto(a.reason)) + (a.cerradoPor && a.origen !== 'importado_txt' ? ' por ' + esc(a.cerradoPor) : '') + '</div>' +
        '<div>' + (a.pedido ? '<span class="chip pedido">' + esc(a.pedido) + '</span>' : '') + (a.etiquetas || []).map(chipEtiqueta).join('') + '</div>' +
        (a.resumen ? '<div class="res">' + esc(a.resumen) + '</div>' : '') +
        '</div>';
    }).join('');
  }
  var paginas = Math.max(1, Math.ceil(datos.total / POR_PAGINA));
  document.getElementById('pag').innerHTML = paginas > 1 ? '<button class="sm" id="pag-antes" type="button"' + (pagina === 0 ? ' disabled' : '') + '>‹</button> página ' + (pagina + 1) + ' de ' + paginas + ' <button class="sm" id="pag-despues" type="button"' + (pagina >= paginas - 1 ? ' disabled' : '') + '>›</button>' : '';
  var antes = document.getElementById('pag-antes'), despues = document.getElementById('pag-despues');
  if (antes) antes.onclick = function () { pagina--; cargar(); };
  if (despues) despues.onclick = function () { pagina++; cargar(); };
}

/* El adjunto de un mensaje: la foto, el audio, el documento... o el aviso de que no se guardo. */
function adjuntoHtml(m) {
  var media = m.payload && m.payload.media;
  var tipo = TIPO[m.kind] || ('[' + esc(m.kind) + ']');
  var adj = media && media.id ? adjuntosPorId[media.id] : null;
  if (!adj || adj.omitido) return '<span class="k">' + tipo + ' (adjunto no guardado' + (adj && adj.omitido ? ': ' + esc(adj.omitido) : '') + ')</span>';
  var attrs = ' data-adj="' + esc(adj.id) + '" data-kind="' + esc(adj.kind) + '"';
  if (adj.kind === 'image') return '<img class="adj"' + attrs + ' alt="foto" title="Abrir en grande">';
  if (adj.kind === 'audio') return '<audio class="adj"' + attrs + ' controls preload="none"></audio>';
  if (adj.kind === 'video') return '<video class="adj"' + attrs + ' controls playsinline preload="none"></video>';
  return '<a class="adj doc"' + attrs + ' href="#" download="' + esc(adj.nombre || 'documento') + '">📄 ' + esc(adj.nombre || 'documento') + ' <span class="k">(' + peso(adj.bytes) + ')</span></a>';
}

/* Los ficheros se piden despues de pintar: van detras de la sesion (cookie), y una etiqueta <img> no la manda por si sola. */
function cargarAdjuntos() {
  if (!abierta) return;
  var id = abierta.id;
  document.querySelectorAll('#l-hilo [data-adj]').forEach(function (el) {
    var mediaId = el.getAttribute('data-adj');
    fetch('/admin/archives/' + id + '/adjunto/' + encodeURIComponent(mediaId), { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('no llegó'); return r.blob(); })
      .then(function (b) {
        var url = URL.createObjectURL(b);
        if (el.tagName === 'A') { el.href = url; el.onclick = null; }
        else el.src = url;
        if (el.tagName === 'IMG') el.onclick = function () { window.open(url, '_blank'); };
      })
      .catch(function () { el.outerHTML = '<span class="k">' + (TIPO[el.getAttribute('data-kind')] || '📎 adjunto') + ' (el fichero ya no está en el servidor)</span>'; });
  });
}

async function abrir(id) {
  try {
    var r = await api('/admin/archives/' + id);
    abierta = r.archive;
    adjuntosPorId = {};
    (abierta.adjuntos || []).forEach(function (a) { adjuntosPorId[a.id] = a; });
    etiquetasEdit = (abierta.etiquetas || []).slice();
    document.getElementById('lector-vacio').classList.add('hidden');
    document.getElementById('lector-con').classList.remove('hidden');
    document.getElementById('l-nombre').textContent = abierta.name || telefonoBonito(abierta.phone);
    var adj = (abierta.adjuntos || []).filter(function (x) { return !x.omitido; }).length;
    var omitidos = (abierta.adjuntos || []).length - adj;
    document.getElementById('l-sub').textContent = telefonoBonito(abierta.phone) + ' · ' + abierta.messageCount + ' mensajes' +
      (adj ? ' · ' + adj + ' adjunto' + (adj === 1 ? '' : 's') : '') + (omitidos ? ' (' + omitidos + ' no se pudo guardar)' : '') +
      (abierta.primeraRespuestaSeg !== null && abierta.primeraRespuestaSeg !== undefined ? ' · contestada en ' + tiempoLegible(abierta.primeraRespuestaSeg) : '') +
      ' · ' + (abierta.origen === 'importado_txt' ? 'importada del teléfono' : 'guardada') + ' el ' + cuando(abierta.createdAt) + (abierta.origen === 'importado_txt' ? '' : ' (' + motivoTexto(abierta.reason) + (abierta.cerradoPor ? ' por ' + abierta.cerradoPor : '') + ')') + (abierta.deletedAt ? ' · EN LA PAPELERA' : '');
    pintarChips();
    document.getElementById('l-resumen').innerHTML = abierta.resumen ? '<b>Resumen:</b> ' + esc(abierta.resumen) : '<span class="muted">Sin resumen todavía' + (datos.conIA ? '' : ' (conecta la IA en Asistente IA para que lo escriba sola)') + '.</span>';
    document.getElementById('l-enlace').classList.add('hidden');
    document.getElementById('l-hilo').innerHTML = r.messages.map(function (m) {
      var conFichero = m.kind !== 'text' && m.kind !== 'location' && m.kind !== 'interactive' && m.kind !== 'template' && m.kind !== 'unknown';
      var texto = m.body && CUERPOS_GENERICOS.indexOf(m.body) < 0 ? esc(m.body) : '';
      var adjunto = conFichero ? adjuntoHtml(m) : m.kind === 'location' ? '<span class="k">📍 ubicación</span>' : '';
      var cuerpo = [adjunto, texto].filter(Boolean).join('\n') || '<span class="k">(sin texto)</span>';
      return '<div class="g ' + (m.direction === 'in' ? 'cli' : 'neg') + '">' + cuerpo + '<div class="h">' + esc(cuando(m.createdAt)) + '</div></div>';
    }).join('');
    cargarAdjuntos();
    document.getElementById('l-notas').value = abierta.notas || '';
    document.getElementById('l-notas-estado').textContent = '';
    var enPapelera = Boolean(abierta.deletedAt);
    document.getElementById('l-borrar').classList.toggle('hidden', enPapelera);
    document.getElementById('l-recuperar').classList.toggle('hidden', !enPapelera);
    document.getElementById('l-restaurar').classList.toggle('hidden', enPapelera);
    document.getElementById('l-compartir').classList.toggle('hidden', enPapelera);
    document.getElementById('l-borrar-cliente').classList.toggle('hidden', enPapelera);
    document.querySelectorAll('.fila').forEach(function (f) { f.classList.toggle('activa', Number(f.getAttribute('data-id')) === id); });
    document.getElementById('lector').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { toast(e.message); }
}

function pintarChips() {
  document.getElementById('l-chips').innerHTML = (abierta.pedido ? '<span class="chip pedido">' + esc(abierta.pedido) + '</span>' : '') + (abierta.origen === 'importado_txt' ? '<span class="chip origen">importada</span>' : '') + etiquetasEdit.map(function (e) { return '<span class="chip ' + esc(e) + '">' + esc(NOMBRE_ETIQUETA[e] || e) + ' <a href="#" data-quitar-etiqueta="' + esc(e) + '" title="Quitar" aria-label="Quitar la etiqueta">✕</a></span>'; }).join('');
}

document.getElementById('lista').addEventListener('click', function (ev) {
  var f = ev.target.closest('.fila');
  if (f) abrir(Number(f.getAttribute('data-id')));
});
document.getElementById('l-chips').addEventListener('click', function (ev) {
  var a = ev.target.closest('[data-quitar-etiqueta]');
  if (!a) return;
  ev.preventDefault();
  etiquetasEdit = etiquetasEdit.filter(function (e) { return e !== a.getAttribute('data-quitar-etiqueta'); });
  pintarChips();
});
document.getElementById('l-etiqueta-add').onchange = function () {
  var v = this.value; this.value = '';
  if (v && etiquetasEdit.indexOf(v) < 0) { etiquetasEdit.push(v); pintarChips(); }
};
document.getElementById('l-guardar-notas').onclick = async function () {
  if (!abierta) return;
  var estado = document.getElementById('l-notas-estado');
  try {
    var r = await api('/admin/archives/' + abierta.id + '/notas', { method: 'POST', body: { notas: document.getElementById('l-notas').value, etiquetas: etiquetasEdit } });
    abierta = r.archive; estado.textContent = 'Guardado.';
    await cargar();
  } catch (e) { estado.textContent = e.message; }
};
document.getElementById('l-txt').onclick = function () { if (abierta) window.location.href = '/admin/archives/' + abierta.id + '/export.txt'; };
document.getElementById('l-txt-anon').onclick = function () { if (abierta) window.location.href = '/admin/archives/' + abierta.id + '/export.txt?anonimo=si'; };
document.getElementById('l-pdf').onclick = function () { if (abierta) window.open('/admin/archives/' + abierta.id + '/export.html', '_blank'); };
document.getElementById('l-compartir').onclick = async function () {
  if (!abierta) return;
  if (datos && datos.conEnlaces === false) { toast('En este arranque no se pueden crear enlaces: falta la clave con la que se firman.'); return; }
  var d = await pedirDato({ titulo: 'Compartir como evidencia', texto: 'Se crea un enlace de solo lectura para quien no tiene cuenta aquí (el cliente, el motorizado, un abogado). Quien lo abra ve la conversación con el teléfono tapado y sin las notas internas. Pasados los días, deja de funcionar.', etiqueta: 'Días que vale (1 a 30)', valor: '7', boton: 'Crear enlace', validar: function (v) { return /^\d{1,2}$/.test(v) && Number(v) >= 1 && Number(v) <= 30 ? null : 'Escribe un número de días entre 1 y 30.'; } });
  if (d === null) return;
  try {
    var r = await api('/admin/archives/' + abierta.id + '/enlace', { method: 'POST', body: { dias: Number(d) } });
    var url = location.origin + r.ruta;
    var caja = document.getElementById('l-enlace');
    caja.innerHTML = '<b>Enlace de evidencia</b> (vale hasta el ' + esc(fechaCorta(r.caducaEn)) + '): <a href="' + esc(url) + '" target="_blank" id="l-enlace-url">' + esc(url) + '</a> <button class="sm" id="l-enlace-copiar" type="button">Copiar</button>';
    caja.classList.remove('hidden');
    document.getElementById('l-enlace-copiar').onclick = function () { copiar(url); };
    copiar(url);
  } catch (e) { toast(e.message); }
};
function copiar(texto) {
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(texto).then(function () { toast('Enlace copiado. Pégalo donde quieras.'); }, function () { toast('No se pudo copiar solo: cópialo del recuadro.'); });
  else toast('Cópialo del recuadro.');
}
document.getElementById('l-aprender').onclick = async function () {
  if (!abierta) return;
  var b = this; b.disabled = true;
  try {
    var r = await api('/admin/archives/' + abierta.id + '/aprender', { method: 'POST', body: {} });
    if (r.aviso) toast(r.aviso);
    else toast('Se enseñaron ' + r.nuevas + ' respuesta' + (r.nuevas === 1 ? '' : 's') + (r.repetidas ? ' (' + r.repetidas + ' ya las sabía)' : '') + '. Quedan pendientes de revisar en Entrenar a la IA.');
  } catch (e) { toast(e.message); }
  b.disabled = false;
};
document.getElementById('l-resumir').onclick = async function () {
  if (!abierta) return;
  var b = this; b.disabled = true;
  try { var r = await api('/admin/archives/' + abierta.id + '/resumir', { method: 'POST', body: {} }); toast(r.conIA ? 'Resumen hecho con la IA.' : 'Resumen hecho con reglas (sin IA conectada).'); await cargar(); await abrir(abierta.id); } catch (e) { toast(e.message); }
  b.disabled = false;
};
document.getElementById('l-restaurar').onclick = async function () {
  if (!abierta) return;
  var si = await confirmarDialogo({ titulo: 'Devolver al chat', texto: 'Los mensajes vuelven al chat de ' + (abierta.name || abierta.phone) + '. La copia guardada se conserva.', boton: 'Devolver' });
  if (!si) return;
  try { var r = await api('/admin/archives/' + abierta.id + '/restore', { method: 'POST', body: {} }); toast('Devueltos ' + r.restaurados + ' mensajes al chat.'); } catch (e) { toast(e.message); }
};
function cerrarLector() { abierta = null; document.getElementById('lector-con').classList.add('hidden'); document.getElementById('lector-vacio').classList.remove('hidden'); }
document.getElementById('l-borrar').onclick = async function () {
  if (!abierta) return;
  var si = await confirmarDialogo({ titulo: 'Mandar a la papelera', texto: 'Se queda 30 días en la papelera por si hace falta; después se borra de verdad.', boton: 'A la papelera', peligro: true });
  if (!si) return;
  try { await api('/admin/archives/' + abierta.id, { method: 'DELETE' }); toast('En la papelera 30 días.'); cerrarLector(); await cargar(); revisar(); } catch (e) { toast(e.message); }
};
document.getElementById('l-borrar-cliente').onclick = async function () {
  if (!abierta) return;
  var quien = abierta.name || telefonoBonito(abierta.phone);
  var v = await pedirDato({ titulo: 'Borrar todo lo de ' + quien, texto: 'Es lo que se hace cuando un cliente pide que se borren sus datos. Lo que aún tenga en el chat se guarda primero, y TODO lo suyo se manda a la papelera; a los 30 días se borra de verdad. Para seguir, escribe BORRAR.', etiqueta: 'Escribe BORRAR', marcador: 'BORRAR', boton: 'Borrar todo', validar: function (x) { return x === 'BORRAR' ? null : 'Escribe BORRAR, en mayúsculas, para confirmar.'; } });
  if (v === null) return;
  try {
    var r = await api('/admin/archives/borrar-cliente', { method: 'POST', body: { contactId: abierta.contactId, confirmar: v } });
    toast('Listo: ' + r.aPapelera + ' conversación' + (r.aPapelera === 1 ? '' : 'es') + ' de ' + quien + ' en la papelera 30 días' + (r.guardadas ? ' (una se guardó del chat antes)' : '') + '.');
    cerrarLector(); await cargar(); revisar();
  } catch (e) { toast(e.message); }
};
document.getElementById('l-recuperar').onclick = async function () {
  if (!abierta) return;
  try { await api('/admin/archives/' + abierta.id + '/recuperar', { method: 'POST', body: {} }); toast('Recuperada.'); await cargar(); await abrir(abierta.id); } catch (e) { toast(e.message); }
};

async function revisar() {
  var t = document.getElementById('t-salud');
  try {
    var r = await api('/admin/archives/revision');
    ultimaRevision = r;
    t.querySelector('.n').innerHTML = r.rotos ? '<span style="color:var(--bad)">' + r.rotos + ' con problema</span>' : '<span style="color:var(--ok)">' + r.revisados + ' bien</span>';
    if (r.rotos) toast('Ficheros con problema: ' + r.items.filter(function (i) { return !i.ok; }).map(function (i) { return i.phone + ' (' + i.detalle + ')'; }).join('; '));
  } catch (e) { t.querySelector('.n').textContent = '?'; toast(e.message); }
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
  try { await api('/admin/ajustes', { method: 'POST', body: { guardados: { inactividadDias: Number(v) } } }); toast(Number(v) ? 'Listo: a los ' + v + ' días sin mensajes, cada chat se guarda solo.' : 'Listo: ya no se guarda ninguno solo; solo a mano.'); await cargar(); } catch (e) { toast(e.message); }
}
async function barrer() {
  var si = await confirmarDialogo({ titulo: 'Guardar las inactivas ya', texto: 'Se guardan y se vacían del chat las conversaciones sin movimiento desde hace ' + (datos.inactividadDias || 60) + ' días.', boton: 'Guardar' });
  if (!si) return;
  try { var r = await api('/admin/archives/barrer', { method: 'POST', body: { dias: datos.inactividadDias || 60 } }); toast('Guardadas ' + r.archivados + ' conversaciones (' + r.mensajes + ' mensajes).'); await cargar(); } catch (e) { toast(e.message); }
}
async function cerrarHoy() {
  var si = await confirmarDialogo({ titulo: 'Guardar las de los pedidos terminados hoy', texto: 'Se guardan y se vacían del chat las conversaciones de los clientes cuyo pedido de hoy ya se avisó o terminó. Quedan aquí, ligadas a su pedido.', boton: 'Guardar' });
  if (!si) return;
  try { var r = await api('/admin/archives/cerrar', { method: 'POST', body: { pedidosDeHoy: true } }); toast('Guardadas ' + r.guardadas + ' conversaciones' + (r.saltadas.length ? ' (' + r.saltadas.length + ' sin mensajes que guardar)' : '') + '.'); await cargar(); } catch (e) { toast(e.message); }
}
async function aprenderMes() {
  var si = await confirmarDialogo({ titulo: 'Enseñar a la IA con las de este mes', texto: 'De cada conversación guardada este mes se sacan las preguntas del cliente con la respuesta que dio una persona (lo que contestó la IA no cuenta). Entran en Entrenar a la IA pendientes de revisar: nada se usa hasta que alguien lo apruebe.', boton: 'Enseñar' });
  if (!si) return;
  try {
    var r = await api('/admin/archives/aprender', { method: 'POST', body: {} });
    toast(r.pares ? 'De ' + r.conversaciones + ' conversación' + (r.conversaciones === 1 ? '' : 'es') + ' salieron ' + r.nuevas + ' respuesta' + (r.nuevas === 1 ? '' : 's') + ' nueva' + (r.nuevas === 1 ? '' : 's') + (r.repetidas ? ' (' + r.repetidas + ' ya las sabía)' : '') + '. Revísalas en Entrenar a la IA.' : 'En las conversaciones de este mes no hay preguntas con respuesta de una persona que se puedan aprender.');
  } catch (e) { toast(e.message); }
}

/* Importar un chat exportado del telefono. */
var impVista = null;
var impTemporizador = null;
var impImportando = false;
/* Antes de importar se lee el texto y se dice cuantos mensajes hay y de quien. */
async function previsualizarImportacion() {
  var texto = document.getElementById('imp-texto').value;
  var estado = document.getElementById('imp-estado');
  var boton = document.getElementById('imp-enviar');
  if (impImportando) return;
  impVista = null;
  if (!texto.trim()) { boton.textContent = 'Importar la conversación'; boton.disabled = false; return; }
  try {
    var r = await api('/admin/archives/importar/vista-previa', { method: 'POST', body: { texto: texto, nombre: document.getElementById('imp-nombre').value.trim() || undefined } });
    impVista = r;
    if (!r.ok || !r.mensajes) { estado.textContent = 'No se encontraron mensajes con el formato de WhatsApp (fecha, hora - nombre: texto).' + (r.avisos && r.avisos.length ? ' ' + r.avisos.join(' ') : ''); boton.textContent = 'Importar la conversación'; boton.disabled = true; return; }
    estado.textContent = 'Se leyeron ' + r.mensajes + ' mensajes: ' + r.delCliente + ' de ' + (r.cliente || 'el cliente') + ' y ' + r.delNegocio + ' de ' + (r.negocio || 'el negocio') + (r.desde ? ', del ' + fechaCorta(r.desde) + ' al ' + fechaCorta(r.hasta) : '') + '.' + (r.descartadas ? ' ' + r.descartadas + ' líneas no se entendieron.' : '') + (r.avisos && r.avisos.length ? ' ' + r.avisos.join(' ') : '');
    boton.textContent = 'Importar ' + r.mensajes + ' mensaje' + (r.mensajes === 1 ? '' : 's');
    boton.disabled = false;
  } catch (e) { estado.textContent = e.message; boton.disabled = false; }
}
document.getElementById('imp-texto').oninput = function () { clearTimeout(impTemporizador); impTemporizador = setTimeout(previsualizarImportacion, 500); };
document.getElementById('imp-nombre').onchange = previsualizarImportacion;
document.getElementById('imp-fichero').onchange = function () {
  var f = this.files && this.files[0];
  if (!f) return;
  var lector = new FileReader();
  lector.onload = function () { document.getElementById('imp-texto').value = String(lector.result || ''); document.getElementById('imp-estado').textContent = 'Leído ' + f.name + ' (' + peso(f.size) + '). Contando mensajes…'; previsualizarImportacion(); };
  lector.readAsText(f, 'utf-8');
};
document.getElementById('imp-enviar').onclick = async function () {
  var texto = document.getElementById('imp-texto').value;
  var tel = document.getElementById('imp-tel').value.trim();
  var nombre = document.getElementById('imp-nombre').value.trim();
  var estado = document.getElementById('imp-estado');
  if (!texto.trim()) { estado.textContent = 'Pega el texto del chat o elige el archivo .txt.'; return; }
  if (tel.replace(/\D/g, '').length < 6) { estado.textContent = 'Falta el teléfono del cliente.'; return; }
  var b = this; b.disabled = true; impImportando = true; clearTimeout(impTemporizador); estado.textContent = 'Importando…';
  try {
    var r = await api('/admin/archives/importar', { method: 'POST', body: { texto: texto, telefono: tel, nombre: nombre || undefined } });
    estado.textContent = 'Importados ' + r.mensajes + ' mensajes' + (r.desde ? ' (del ' + fechaCorta(r.desde) + ' al ' + fechaCorta(r.hasta) + ')' : '') + '.' + ((r.lectura && r.lectura.avisos && r.lectura.avisos.length) ? ' ' + r.lectura.avisos.join(' ') : '');
    document.getElementById('imp-texto').value = '';
    document.getElementById('imp-fichero').value = '';
    await cargar();
    await abrir(r.archive.id);
  } catch (e) { estado.textContent = e.message; }
  impImportando = false;
  b.disabled = false;
  b.textContent = 'Importar la conversación';
};

var temporizador = null;
['f-q', 'f-texto', 'f-pedido'].forEach(function (id) { document.getElementById(id).oninput = function () { clearTimeout(temporizador); temporizador = setTimeout(function () { pagina = 0; cargar().catch(function (e) { toast(e.message); }); }, 350); }; });
['f-etiqueta', 'f-motivo', 'f-desde', 'f-hasta', 'f-papelera'].forEach(function (id) { document.getElementById(id).onchange = function () { pagina = 0; cargar().catch(function (e) { toast(e.message); }); }; });

/* Llegar con ?tel= (desde un chat) o ?pedido= (desde Hoy) ya filtra; ?abrir= abre una; ?importar=si despliega la caja. */
var params = new URLSearchParams(location.search);
if (params.get('tel')) document.getElementById('f-q').value = params.get('tel');
if (params.get('pedido')) document.getElementById('f-pedido').value = params.get('pedido');
if (params.get('importar') === 'si') document.getElementById('importar').open = true;
cargar().then(function () { revisar(); if (params.get('abrir')) abrir(Number(params.get('abrir'))); }).catch(function (e) { toast(e.message); });
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
