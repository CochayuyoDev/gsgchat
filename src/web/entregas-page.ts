/**
 * Pantalla "Hoy" (la portada de GSGchat): cada pedido de hoy, en que paso va
 * y que le falta; los otros clientes a los que el sistema les escribe solo
 * (reparto y lista de envio automatico, en una sola lista); lo que necesita
 * a una persona; la conexion con GSG (real o el simulador); y los ajustes
 * de las entregas (margen de una hora, esperas, intentos, textos).
 * Los motorizados tienen su propia pantalla (/motorizados).
 *
 * Responde de un vistazo: ¿a quien falta ubicacion? ¿quien falta confirmar?
 * ¿quien ya tiene motorizado y a que hora le llega? Todo lo que puede hacer
 * una persona (confirmar a mano, poner un pin, reasignar, cancelar) esta en
 * la fila. Nada de confirm(): el cuadro propio. El JS va en String.raw,
 * con var y sin backticks, como el resto.
 */

import { appShell } from './shell.js';
import { estadosVisualesJs } from './estados-visuales.js';
import { DIALOGO_ELEGIR_CSS, DIALOGO_ELEGIR_JS } from './dialogo-elegir.js';

const CSS = `
  /* Hoy usa la paleta y la escala del armazon (variables --bg, --superficie, --texto, --verde...):
     aqui solo va lo propio de la pantalla. */
  * { box-sizing: border-box; }
  .wrap { color: var(--texto); font: var(--fs-cuerpo)/1.5 var(--fuente); max-width: 1600px; }
  .wrap a { color: var(--primario); }
  .muted { color: var(--texto-suave); }
  .hidden { display: none !important; }
  .demo { background: var(--ambar); color: #fff; padding: 8px 14px; font-size: var(--fs-small); text-align: center; border-radius: var(--radio-sm); margin-bottom: var(--esp-3); font-weight: 600; }
  .aviso { background: var(--ambar-suave); border: 1px solid var(--ambar); border-radius: var(--radio); padding: 12px 14px; margin-bottom: var(--esp-3); font-size: var(--fs-cuerpo); }
  .aviso b { color: var(--ambar); }

  select, input, textarea, button { font: inherit; color: var(--texto); background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio-sm); padding: 8px 11px; }
  input, select, textarea { width: 100%; }
  input:focus-visible, select:focus-visible, textarea:focus-visible { border-color: var(--primario); outline: 2px solid var(--primario-suave); outline-offset: 0; }
  textarea { min-height: 70px; resize: vertical; }
  button { cursor: pointer; width: auto; font-weight: 600; min-height: 36px; line-height: 1.2; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
  button:hover { border-color: var(--primario); color: var(--primario); }
  button.primary { background: var(--primario); border-color: var(--primario); color: var(--primario-texto); }
  button.primary:hover { filter: brightness(1.06); color: var(--primario-texto); }
  button.sm { min-height: 30px; padding: 4px 10px; font-size: 13px; font-weight: 500; }
  button.peligro { color: var(--rojo); }
  button.peligro:hover { background: var(--rojo-suave); border-color: var(--rojo); color: var(--rojo); }
  button:disabled { opacity: .55; cursor: default; }
  a.sm { font-size: 13px; }
  label { display: block; font-size: var(--fs-small); color: var(--texto-suave); margin: 10px 0 4px; }
  label.linea { display: flex; align-items: flex-start; gap: 8px; margin: 8px 0; color: var(--texto); font-size: var(--fs-cuerpo); cursor: pointer; line-height: 1.4; }
  label.linea input { width: 18px; height: 18px; margin: 1px 0 0; flex: none; accent-color: var(--primario); }

  /* --- la tira de estado: WhatsApp, GSG, motorizados, cierre --------------- */
  .estado-tira { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: var(--esp-3); margin-bottom: var(--esp-3); align-items: start; }
  .estado-tira .semaforo { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); padding: 12px 14px; font-size: 13.5px; box-shadow: var(--sombra); display: flex; flex-direction: column; gap: 6px; }
  .estado-tira .semaforo b { display: block; font-size: 11.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--texto-suave); }
  .estado-tira .semaforo .acciones { margin-top: 2px; }
  .punto { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: var(--gris); margin-right: 6px; vertical-align: middle; flex: none; }
  .punto.ok { background: var(--verde); } .punto.warn { background: var(--ambar); } .punto.bad { background: var(--rojo); } .punto.info { background: var(--azul); }

  /* --- las cifras del dia ------------------------------------------------- */
  .tarjetas { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--esp-2); margin-bottom: var(--esp-3); }
  .tarjeta { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); padding: 10px 12px; cursor: pointer; box-shadow: var(--sombra); transition: border-color .12s, box-shadow .12s; min-height: 62px; }
  .tarjeta:hover { border-color: var(--primario); }
  .tarjeta.activa { border-color: var(--primario); box-shadow: 0 0 0 2px var(--primario-suave); background: var(--primario-suave); }
  .tarjeta .n { font-size: 22px; font-weight: 800; line-height: 1.1; letter-spacing: -.01em; }
  .tarjeta .q { font-size: var(--fs-small); color: var(--texto-suave); margin-top: 2px; line-height: 1.3; }
  .tarjeta.ok .n { color: var(--verde); } .tarjeta.warn .n { color: var(--ambar); } .tarjeta.bad .n { color: var(--rojo); } .tarjeta.info .n { color: var(--azul); }

  .explica { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); padding: 12px 16px; margin-bottom: var(--esp-3); }
  .explica summary { color: var(--texto-suave); font-size: 13.5px; cursor: pointer; }
  .explica .texto { font-size: var(--fs-cuerpo); }
  .explica .texto p { margin: 0 0 6px; }
  .explica .pasos { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
  .explica .paso { background: var(--superficie-2); border-radius: 999px; padding: 3px 10px; font-size: var(--fs-small); }

  /* --- las dos columnas: la tabla y lo de al lado ---------------------------- */
  .cols { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: var(--esp-3); align-items: start; }
  /* Sin sitio para dos columnas: la tabla a lo ancho y, debajo, "Necesitan a alguien" y "Otros" lado a lado; lo secundario al final. */
  @media (max-width: 1500px) {
    .wrap { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0 var(--esp-3); align-items: start; }
    .wrap > *, .cols .caja { grid-column: 1 / -1; }
    .cols, .cols > div { display: contents; }
    .wrap > .demo, .wrap > .aviso, .wrap > .cartel-prueba { order: 0; }
    .tira-resumen { order: 1; }
    #tira { order: 2; }
    #tarjetas { order: 3; }
    #como-funciona { order: 4; }
    #caja-pedidos { order: 5; }
    #caja-alguien { order: 6; grid-column: 1; }
    #caja-otros { order: 6; grid-column: 2; }
    #caja-ajustes { order: 7; }
    #caja-sim { order: 8; }
    #caja-eventos { order: 9; }
  }
  @media (max-width: 900px) { #caja-alguien, #caja-otros { grid-column: 1 / -1; } }
  .caja { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); overflow: hidden; margin-bottom: var(--esp-3); box-shadow: var(--sombra); }
  .caja > h2 { font-size: var(--fs-h3); margin: 0; padding: 12px 14px; border-bottom: 1px solid var(--borde); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .caja > h2 .sep { flex: 1; }
  .caja .cuerpo { padding: 14px; }
  .caja.plegable > h2 { cursor: pointer; }
  .caja.plegable > h2::after { content: ''; width: 8px; height: 8px; border-right: 2px solid var(--texto-suave); border-bottom: 2px solid var(--texto-suave); transform: rotate(45deg); margin: 0 4px 4px 2px; transition: transform .15s; }
  .caja.plegable.cerrada > h2::after { transform: rotate(-45deg); margin-bottom: 0; }
  .caja.plegable.cerrada .cuerpo { display: none; }

  /* --- la tabla de pedidos ---------------------------------------------------- */
  .tabla-scroll { overflow: auto; max-height: 70vh; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .tabla-scroll table { min-width: 1060px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--borde); vertical-align: top; }
  th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--texto-suave); font-weight: 700; position: sticky; top: 0; background: var(--superficie); z-index: 1; }
  tr:last-child td { border-bottom: 0; }
  #filas > tr:hover > td { background: var(--superficie-2); }
  #filas > tr > td:first-child { min-width: 200px; }
  #filas > tr > td:nth-child(6) { min-width: 230px; }
  #filas > tr > td:last-child { min-width: 250px; }
  td .sub { color: var(--texto-suave); font-size: var(--fs-small); margin-top: 3px; line-height: 1.35; }
  td.vacio { color: var(--texto-suave); text-align: center; padding: 24px; }
  td.vacio-td { padding: 14px; }
  .chip + .sub, .chip + div.sub { margin-top: 4px; }
  .acciones { display: flex; gap: 4px; flex-wrap: wrap; }
  .toast { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); background: var(--texto); color: var(--bg); padding: 10px 16px; border-radius: var(--radio-sm); font-size: 14px; z-index: 50; max-width: 90vw; box-shadow: var(--sombra-2); }
  tr.fila-urgente > td:first-child { box-shadow: inset 3px 0 0 var(--rojo); }
  .fila-detalle td { background: var(--superficie-2); }

  .mov { display: flex; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--borde); font-size: 13.5px; }
  .mov:last-child { border-bottom: 0; }
  .mov .hora { color: var(--texto-suave); min-width: 44px; font-size: var(--fs-small); font-variant-numeric: tabular-nums; }
  .mov .que { flex: 1; line-height: 1.45; }
  .mov .que b { font-weight: 600; }
  .mov-acciones { margin-top: 6px; }
  .nada { color: var(--texto-suave); font-size: 13.5px; text-align: center; padding: 14px 8px; }

  .sim-lista { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px; }
  @media (max-width: 700px) { .sim-lista { grid-template-columns: 1fr; } }
  .sim-lista .col { background: var(--superficie-2); border-radius: var(--radio-sm); padding: 8px 10px; font-size: var(--fs-small); min-height: 60px; }
  .sim-lista .col b { display: block; margin-bottom: 4px; }
  .sim-lista .col div { padding: 2px 0; }
  .ajuste-fila { display: grid; grid-template-columns: 1fr 120px; gap: 10px; align-items: center; margin: 6px 0; font-size: var(--fs-cuerpo); }
  .grupos-aj { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .grupo-aj { border: 1px solid var(--borde); border-radius: var(--radio); background: var(--superficie); padding: 12px 14px; min-width: 0; }
  .grupo-aj.ancho { margin-top: 12px; }
  .grupo-aj h3 { margin: 0 0 2px; font-size: 14px; font-weight: 700; }
  .grupo-aj .ayuda-grupo { margin: 0 0 8px; color: var(--texto-suave); font-size: 12.5px; line-height: 1.4; }
  .grupo-aj > summary { cursor: pointer; font-size: 14px; font-weight: 700; padding: 2px 0; }
  .grupo-aj > summary .muted { font-weight: 400; font-size: 12.5px; }
  .textos-para { margin: 14px 0 0; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--texto-suave); }
  @media (max-width: 1100px) { .grupos-aj { grid-template-columns: 1fr; } }
  .ajuste-fila input { width: 100%; }
  .texto-editable { margin-top: 10px; }
  .texto-editable .vars { font-size: 12px; color: var(--texto-suave); }
  .texto-editable .vars code { background: var(--superficie-2); border-radius: 4px; padding: 1px 5px; margin-right: 3px; }
  details > summary { cursor: pointer; color: var(--texto-suave); font-size: 13.5px; margin: 8px 0; }
  .bitacora { max-height: 40vh; overflow: auto; }
  .cartel-prueba { background: var(--azul-suave); border: 1px solid var(--azul); border-radius: var(--radio); padding: 10px 14px; margin-bottom: var(--esp-3); font-size: var(--fs-cuerpo); display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .cartel-prueba b { color: var(--azul); }
  .cartel-prueba .sep { flex: 1; }
  #caja-pegar { padding: 0 14px 12px; }
  #caja-pegar textarea { width: 100%; min-height: 120px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; }
  #caja-pegar .opciones { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; margin: 8px 0; font-size: 13.5px; }
  .previa { margin-top: 4px; font-size: var(--fs-small); }
  .previa a { cursor: pointer; }
  .previa .resultado { display: block; margin-top: 4px; padding: 6px 8px; background: var(--superficie-2); border-radius: var(--radio-sm); color: var(--texto-suave); white-space: pre-wrap; }
  .gsg-cola { margin-top: 2px; font-size: var(--fs-small); }
  .gsg-cola.mal { color: var(--rojo); }
  .urg, .sv { display: inline-flex; align-items: center; border-radius: 999px; padding: 1px 7px; font-size: 11px; font-weight: 700; margin-left: 6px; vertical-align: middle; white-space: nowrap; line-height: 1.5; }
  .urg { background: var(--rojo-suave); color: var(--rojo); }
  .sv { background: var(--azul-suave); color: var(--azul); font-weight: 600; }
  #buscar { width: 240px; }

  .tira-resumen { display: none; }
  .mas-cifras { grid-column: 1 / -1; }
  .mas-cifras > summary { color: var(--texto-suave); font-size: 13px; cursor: pointer; padding: 4px 2px; }
  .mas-cifras .tarjetas { margin: 8px 0 0; }
  .telefono { white-space: nowrap; }
  .acciones-detalle { display: flex; gap: 6px; flex-wrap: wrap; margin: 0 0 10px; }
  .acciones-detalle button { min-height: 36px; }
  .situacion-larga { font-size: 13.5px; margin: 0 0 10px; padding: 8px 10px; background: var(--superficie); border-radius: var(--radio-sm); border: 1px solid var(--borde); }
  .radios { display: flex; gap: 14px; flex-wrap: wrap; }
  .radios label { display: inline-flex; align-items: center; gap: 6px; margin: 0; color: var(--texto); font-size: 13.5px; cursor: pointer; }
  .radios input { width: 16px; height: 16px; accent-color: var(--primario); }
  #pegar-previa { min-height: 20px; margin: 6px 0; }
  .sim-grupo { margin-top: 10px; }
  .mismo { display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 999px; background: var(--azul-suave); color: var(--azul); font-size: 11.5px; font-weight: 600; vertical-align: middle; }
  .sim-pasos { margin: 8px 0 0; padding-left: 30px; font-size: 13px; max-height: 280px; overflow: auto; }
  .sim-pasos li { margin: 3px 0; }
  .sim-pasos li b { display: inline-block; width: 14px; }
  .sim-pasos .paso-hecho b { color: var(--verde); }
  .sim-pasos .paso-fallo b { color: var(--rojo); }
  .sim-pasos .paso-haciendo b { color: var(--ambar); }
  .sim-pasos .paso-saltado b { color: var(--texto-suave); }
  .sim-grupo b { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--texto-suave); margin-bottom: 6px; }
  .sim-grupo .fila { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }

  /* --- en el celular: primero lo que necesita a alguien, luego los pedidos; la tira plegada en una linea; cada pedido una tarjeta --- */
  @media (max-width: 760px) {
    .wrap { display: flex; flex-direction: column; }
    #caja-alguien { order: 1; }
    #caja-pedidos { order: 2; }
    .tira-resumen { order: 3; }
    #tira { order: 4; }
    #tarjetas { order: 5; }
    #como-funciona { order: 6; }
    #caja-otros { order: 7; }
    #caja-sim { order: 8; }
    #caja-eventos { order: 9; }
    #caja-ajustes { order: 10; }
    .tira-resumen { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; text-align: left; margin: 0 0 var(--esp-2); padding: 10px 12px; min-height: 44px; font-weight: 500; font-size: 13.5px; }
    .tira-resumen::after { content: ''; width: 8px; height: 8px; border-right: 2px solid var(--texto-suave); border-bottom: 2px solid var(--texto-suave); transform: rotate(45deg); flex: none; margin: 0 4px 4px; }
    .tira-resumen[aria-expanded="true"]::after { transform: rotate(-135deg); margin: 4px 4px 0; }
    #tira { display: none; }
    #tira.abierta { display: grid; }
    .estado-tira { grid-template-columns: 1fr; gap: var(--esp-2); }
    .estado-tira .semaforo { padding: 10px 12px; }
    #tarjetas { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; min-width: 0; max-width: 100%; }
    .mas-cifras { grid-column: 1 / -1; min-width: 0; }
    .mas-cifras .tarjetas { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
    #caja-alguien:empty { display: none; }
    .sm, button.sm { min-height: 44px; }
    .acciones button { min-height: 44px; flex: 1 1 auto; }
    .tarjeta { padding: 8px 10px; min-height: 0; }
    .tarjeta .n { font-size: 19px; }
    .tarjeta .q { font-size: 11.5px; }
    .caja > h2 { padding: 10px 12px; }
    .caja .cuerpo { padding: 12px; }
    #buscar { width: 100%; }
    .tabla-scroll { max-height: none; overflow: visible; }
    .tabla-scroll table { min-width: 0; }
    .tabla-scroll thead { display: none; }
    .tabla-scroll table, .tabla-scroll tbody, .tabla-scroll tr, .tabla-scroll td { display: block; }
    #filas > tr { border: 1px solid var(--borde); border-radius: var(--radio); margin: 10px 12px; padding: 10px 12px; background: var(--superficie); box-shadow: var(--sombra); }
    #filas > tr.fila-urgente { border-left: 3px solid var(--rojo); }
    #filas > tr.fila-urgente > td:first-child { box-shadow: none; }
    #filas > tr > td { border: 0; padding: 4px 0; min-width: 0; }
    #filas > tr:hover > td { background: transparent; }
    #filas > tr > td:first-child { padding-bottom: 6px; border-bottom: 1px solid var(--borde); margin-bottom: 4px; font-size: 14.5px; }
    #filas > tr > td:nth-child(2)::before, #filas > tr > td:nth-child(3)::before, #filas > tr > td:nth-child(4)::before, #filas > tr > td:nth-child(5)::before, #filas > tr > td:nth-child(6)::before { display: inline-block; min-width: 96px; font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--texto-suave); font-weight: 700; vertical-align: top; margin-top: 2px; }
    #filas > tr > td:nth-child(2)::before { content: 'Ubicación'; }
    #filas > tr > td:nth-child(3)::before { content: 'Confirmación'; }
    #filas > tr > td:nth-child(4)::before { content: 'Motorizado'; }
    #filas > tr > td:nth-child(5)::before { content: 'Llega'; }
    #filas > tr > td:nth-child(6)::before { content: 'Situación'; }
    #filas > tr > td:last-child { padding-top: 8px; }
    #filas > tr.fila-detalle { padding: 8px 12px; background: var(--superficie-2); margin-top: -6px; }
    #filas > tr.fila-detalle > td { padding: 0; border: 0; }
    td.vacio, td.vacio-td { padding: 12px; }
    .ajuste-fila { grid-template-columns: 1fr 96px; }
    .ajuste-fila[style] { grid-template-columns: 1fr !important; }
  }
`;

export function entregasPage(opts: { disponible: boolean; configured: boolean; demo: boolean; nombreNegocio: string }): string {
  const { configured, demo } = opts;
  const aviso = !opts.disponible
    ? `<div class="aviso"><b>Las entregas del día no están disponibles en este arranque.</b> Arranca el sistema con <code>npm run quick</code> o <code>npm run dev</code>.</div>`
    : configured
      ? ''
      : `<div class="aviso"><b>Falta conectar WhatsApp.</b> Las entregas se pueden preparar y sincronizar con GSG, pero no saldrá ningún mensaje hasta conectar el número en <a href="/setup">Conexión de WhatsApp</a>.</div>`;

  const contenido = `
<div class="wrap">
${demo ? '<div class="demo">Demostración: nada sale a WhatsApp de verdad.</div>' : ''}
${aviso}
<div class="cartel-prueba hidden" id="cartel-prueba"><b>EN MODO PRUEBA</b><span id="cartel-prueba-texto"></span><span class="sep"></span><button class="sm" id="modo-prueba-quitar" type="button">Salir del modo prueba</button><a href="/panel#configuracion" class="sm" style="font-size:13px">Ajustes</a></div>

<button type="button" class="tira-resumen" id="tira-resumen" aria-expanded="false" aria-controls="tira">Estado del sistema…</button>
<div class="estado-tira" id="tira">
  <div class="semaforo" id="wa-caja"><b>WhatsApp</b><div id="wa-estado"><span class="punto"></span>Cargando…</div></div>
  <div class="semaforo" id="gsg-caja"><b>GSG</b>
    <div id="gsg-estado"><span class="punto"></span>Cargando…</div>
    <div class="acciones" style="display:flex;gap:6px;flex-wrap:wrap">
      <button class="sm primary" id="sincronizar" type="button">Traer los pendientes de GSG</button>
      <button class="sm" id="gsg-probar" type="button">Probar</button>
      <button class="sm" id="gsg-configurar" type="button">Cambiar</button>
    </div>
    <div class="muted" id="gsg-ultima" style="margin-top:6px;font-size:12.5px"></div>
    <div class="gsg-cola hidden" id="gsg-cola"></div>
  </div>
  <div class="semaforo" id="mot-caja"><b>Motorizados</b><div id="mot-estado"><span class="punto"></span>Cargando…</div><div class="acciones" style="display:flex;gap:6px;flex-wrap:wrap"><a href="/motorizados" class="sm" style="font-size:13px">Ver motorizados</a><a href="/mapa" class="sm" id="ver-mapa" style="font-size:13px" title="Dónde está cada pedido y cada motorizado, sobre el mapa">Ver en el mapa</a></div></div>
  <div class="semaforo" id="cierre-caja"><b>Cierre del día</b><div id="cierre-estado"><span class="punto"></span>Cargando…</div><div class="acciones"><button class="sm" id="cerrar-dia" type="button">Cerrar el día de ayer ahora</button></div></div>
</div>

<div class="tarjetas" id="tarjetas"></div>

<details class="explica" style="display:block" id="como-funciona">
  <summary class="muted" style="cursor:pointer;font-size:13.5px">¿Cómo funciona? Los seis pasos de cada pedido</summary>
  <div class="texto" style="margin-top:8px">
    <p><b>Cada pedido de hoy pasa por tres cosas, cada una por separado:</b> el cliente manda su <b>ubicación</b>, el cliente <b>confirma</b> que lo recibe hoy, y un <b>motorizado</b> recibe el pin y dice en cuántos minutos entrega. A esos minutos se les suma el margen (una hora) y al cliente se le avisa a qué hora le llega.</p>
    <p>Quién falta ubicación y quién falta confirmar lo dice <b>GSG</b> (su lista del día): se le pregunta cada pocos minutos. Cuando el cliente tiene las dos cosas, GSG lo pasa a <b>terminados</b>. Lo que no se entiende lo lee la IA; lo que necesita a una persona se marca aquí y se avisa por WhatsApp.</p>
    <p>Cuando el motorizado escribe <b>"entregado"</b> (o manda la foto), el pedido queda <b>entregado</b>, GSG recibe la hora y al cliente se le da las gracias. Si el cliente pregunta "¿a qué hora llega?", se le contesta solo según el estado. Y a la hora del <b>cierre del día</b>, lo que quedó de ayer se aparta para que alguien lo mire.</p>
    <p>Si el motorizado escribe <b>"no había nadie"</b>, al cliente se le pregunta si volvemos hoy (<b>segunda visita</b>, con botones SÍ / NO): un sí lo manda otra vez al mismo motorizado; un no, o el silencio, pasa a una persona. Si escribe <b>"cerca"</b>, al cliente se le avisa que esté atento. Si escribe <b>"me quedo sin moto"</b>, todos sus pedidos pasan a otros. Los pedidos <b>urgentes</b> (los marca GSG o tú) salen primero, y cada motorizado puede pedir su <b>ruta</b> del día escribiendo "ruta".</p>
    <div class="pasos"><span class="paso">1 · Ubicación</span><span class="paso">2 · Confirmación</span><span class="paso">3 · Motorizado</span><span class="paso">4 · Hora de llegada al cliente</span><span class="paso">5 · Terminada en GSG</span><span class="paso">6 · Entregado</span></div>
  </div>
</details>

<div class="cols">
  <div>
    <div class="caja" id="caja-pedidos">
      <h2>Pedidos de hoy <span id="dia" class="muted" style="font-weight:400;font-size:12.5px"></span><span class="sep"></span><input id="buscar" placeholder="Buscar por nombre, pedido o número" aria-label="Buscar por nombre, pedido o número"><button class="sm" id="nueva" type="button">+ Pedido a mano</button><button class="sm" id="pegar-abrir" type="button">Pegar la lista del día</button></h2>
      <div id="caja-pegar" class="hidden">
        <p class="muted" style="margin:0 0 6px;font-size:13.5px">Pega aquí la lista tal cual sale de Excel (o CSV, o una línea por cliente): <b>teléfono, nombre, pedido, dirección, distrito</b>. Con cabecera se entiende cualquier orden; si además hay columnas <b>ubicación</b> y <b>confirmar</b> con sí/no, mandan sobre las casillas de abajo.</p>
        <textarea id="pegar-texto" placeholder="987654321, Juan Pérez, P-3001, Av. Larco 345, Miraflores&#10;987654322, María Torres, P-3002, Jr. Monterrey 120, Surco&#10;(una línea por cliente)"></textarea>
        <div class="muted" id="pegar-previa" style="font-size:13px" aria-live="polite"></div>
        <div class="opciones">
          <label><input type="checkbox" id="pegar-ubicacion" checked> Pedir ubicación a todos</label>
          <label><input type="checkbox" id="pegar-confirmacion" checked> Pedir confirmación a todos</label>
        </div>
        <div class="radios" id="pegar-destino">
          <label><input type="radio" name="pegar-destino" value="sistema" checked> Clientes de verdad: se les empieza a escribir</label>
          <label id="pegar-destino-sim" class="hidden"><input type="radio" name="pegar-destino" value="simulador"> Solo probar (nadie recibe nada)</label>
        </div>
        <div class="opciones">
          <button class="sm primary" id="pegar-cargar" type="button">Cargar la lista</button>
          <button class="sm" id="pegar-cerrar" type="button">Cerrar</button>
        </div>
        <div class="muted" id="pegar-resultado" style="font-size:13px"></div>
      </div>
      <div class="tabla-scroll">
        <table>
          <thead><tr><th>Cliente · pedido</th><th>Ubicación</th><th>Confirmación</th><th>Motorizado</th><th>Llega</th><th>Situación</th><th></th></tr></thead>
          <tbody id="filas"><tr><td colspan="7" class="vacio">Cargando…</td></tr></tbody>
        </table>
      </div>
    </div>

    <div class="caja plegable cerrada" id="caja-sim">
      <h2>Probar con números ficticios <span class="muted" style="font-weight:400;font-size:12.5px">el simulador de GSG: el "otro sistema", de mentira, con sus tres listas</span><span class="sep"></span><span class="muted" id="sim-resumen" style="font-weight:400;font-size:12.5px"></span></h2>
      <div class="cuerpo">
        <p class="muted" style="margin:0 0 8px;font-size:13.5px">Sirve para probar el flujo entero con <b>10 clientes ficticios</b> (987 000 001 a 010) y <b>10 motorizados ficticios</b> (999 000 001 a 010) sin tocar a nadie. Con el modo prueba de <a href="/panel#configuracion">Configuración</a> activo, ni siquiera se intenta escribirles; las respuestas se simulan desde <a href="/panel#enviar">Enviar mensaje → simular entrante</a> o desde las pruebas automáticas.</p>
        <div class="sim-grupo"><b>Probar con clientes ficticios</b>
          <div class="fila">
            <button class="sm primary" id="sim-usar" type="button">Usar el simulador como GSG</button>
            <button class="sm" id="sim-cargar" type="button">Cargar 10 clientes de prueba</button>
            <button class="sm" id="mot-cargar" type="button">Cargar 10 motorizados de prueba</button>
            <button class="sm peligro" id="sim-reiniciar" type="button">Reiniciar simulador</button>
          </div>
        </div>
        <div class="sim-grupo"><b>Probar el día entero, solo</b>
          <div class="fila">
            <button class="sm primary" id="sim-dia" type="button">Probar el día entero con datos ficticios</button>
            <button class="sm peligro hidden" id="sim-dia-parar" type="button">Detener</button>
            <span class="muted" style="font-size:12.5px">Carga los clientes y los motorizados de prueba, trae la lista de GSG y simula las respuestas de todos, paso a paso, para verlo funcionar de punta a punta.</span>
          </div>
          <ol class="sim-pasos hidden" id="sim-dia-pasos"></ol>
          <p class="muted hidden" id="sim-dia-resumen" style="font-size:13px;margin:6px 0 0"></p>
        </div>
        <div class="sim-grupo"><b>Probar con mi número</b>
          <div class="fila">
            <button class="sm" id="modo-prueba" type="button">Modo prueba con mi número</button>
            <span class="muted" style="font-size:12.5px">Solo se le escribe a tu número; a los demás no les llega nada.</span>
          </div>
        </div>
        <div class="sim-grupo"><b>Simular que GSG…</b>
          <div class="fila">
            <select id="sim-modo" style="width:auto"><option value="ok">responde bien</option><option value="caido">está caído</option><option value="rechaza">rechaza lo que mandamos</option></select>
          </div>
        </div>
        <div class="sim-lista" id="sim-listas"></div>
      </div>
    </div>

    <div class="caja" id="caja-eventos">
      <h2>Lo último que pasó <span class="sep"></span><span class="muted" style="font-weight:400;font-size:12.5px">La bitácora de todas las entregas</span></h2>
      <div class="cuerpo bitacora" id="eventos"><div class="muted">Cargando…</div></div>
    </div>
  </div>

  <div>
    <div class="caja" id="caja-alguien">
      <h2>Necesitan a alguien <span class="sep"></span><span class="muted" id="alguien-n" style="font-weight:400;font-size:12.5px"></span></h2>
      <div class="cuerpo" id="alguien" style="padding:8px 14px"><div class="muted">Cargando…</div></div>
    </div>

    <div class="caja" id="caja-otros">
      <h2>Otros clientes a los que se les escribe solo <span class="sep"></span><span class="muted" id="otros-n" style="font-weight:400;font-size:12.5px"></span></h2>
      <div class="cuerpo" style="padding:0">
        <p class="muted" style="margin:0;padding:8px 14px;font-size:12.5px">Clientes del reparto sin pedido de hoy en GSG y números puestos a mano: se les pide la ubicación cada pocas horas, como una persona, hasta que la manden.</p>
        <table>
          <thead><tr><th>Quién</th><th>Situación</th><th></th></tr></thead>
          <tbody id="otros"><tr><td colspan="3" class="vacio">Cargando…</td></tr></tbody>
        </table>
        <div style="padding:8px 14px"><button class="sm" id="otros-nuevo" type="button">+ Pedir la ubicación a un número</button></div>
      </div>
    </div>

    <div class="caja plegable cerrada" id="caja-ajustes">
      <h2>Ajustes de las entregas <span class="sep"></span><span class="muted" style="font-weight:400;font-size:12.5px">tiempos, qué hace solo, textos</span></h2>
      <div class="cuerpo">
        <div class="grupos-aj">
          <section class="grupo-aj"><h3>Tiempos</h3><p class="ayuda-grupo">Cuánto se espera y cuántas veces se insiste antes de pasar a una persona o a otro motorizado.</p>
            <div class="ajuste-fila"><span>Margen que se suma a lo que dice el motorizado (minutos)</span><input id="aj-margen" type="number" min="0" max="240"></div>
            <div class="ajuste-fila"><span>Volver a pedir la confirmación cada (minutos)</span><input id="aj-conf-espera" type="number" min="5" max="1440"></div>
            <div class="ajuste-fila"><span>Veces que se pide la confirmación</span><input id="aj-conf-max" type="number" min="1" max="6"></div>
            <div class="ajuste-fila"><span>Esperar al motorizado (minutos) antes de insistir</span><input id="aj-mot-espera" type="number" min="1" max="180"></div>
            <div class="ajuste-fila"><span>Avisos a un mismo motorizado antes de pasar a otro</span><input id="aj-mot-max" type="number" min="1" max="5"></div>
            <div class="ajuste-fila"><span>Preguntar a GSG cada (minutos)</span><input id="aj-sync" type="number" min="1" max="1440"></div>
          </section>
          <section class="grupo-aj"><h3>Qué hace solo el sistema</h3><p class="ayuda-grupo">Lo que se contesta y se manda sin que nadie toque nada.</p>
            <label class="linea"><input type="checkbox" id="aj-leer-ia"> La IA lee las respuestas que las reglas no entienden <span class="muted">(necesita <a href="/panel#ia">Mi asistente IA</a> con una clave)</span></label>
            <label class="linea"><input type="checkbox" id="aj-redactar-ia"> La IA redacta el aviso de llegada (la hora la pone el sistema)</label>
            <label class="linea"><input type="checkbox" id="aj-botones"> Preguntar con botones SÍ / NO cuando el WhatsApp lo permite (si no puede, sale como texto)</label>
            <label class="linea"><input type="checkbox" id="aj-pin"> Mandar el pin como ubicación de WhatsApp al motorizado (además del enlace)</label>
            <label class="linea"><input type="checkbox" id="aj-avisar-entregado"> Dar las gracias al cliente cuando el motorizado dice "entregado"</label>
            <label class="linea"><input type="checkbox" id="aj-donde-esta"> Contestar solo a "¿dónde está mi pedido?" según el estado (sin gastar IA)</label>
            <label class="linea"><input type="checkbox" id="aj-cerca"> Avisar al cliente cuando el motorizado escribe "cerca" o "llegando"</label>
          </section>
          <section class="grupo-aj"><h3>Segunda visita</h3><p class="ayuda-grupo">Cuando el motorizado llega y no hay nadie.</p>
            <label class="linea"><input type="checkbox" id="aj-sv-activa"> Segunda visita: si no había nadie, preguntarle al cliente si volvemos hoy</label>
            <div class="ajuste-fila"><span>Esperar la respuesta del cliente a la segunda visita (minutos); después pasa a una persona</span><input id="aj-sv-espera" type="number" min="5" max="1440"></div>
          </section>
          <section class="grupo-aj"><h3>Cliente recurrente</h3><p class="ayuda-grupo">Si ya mandó su ubicación hace poco, se le propone en vez de pedirle el pin otra vez.</p>
            <label class="linea"><input type="checkbox" id="aj-rec-activo"> Cliente recurrente: si ya mandó su ubicación hace poco, proponerle esa dirección en vez de pedirle el pin</label>
            <div class="ajuste-fila"><span>Vale si su última ubicación tiene menos de (días)</span><input id="aj-rec-dias" type="number" min="1" max="365"></div>
            <div class="ajuste-fila"><span>Si no contesta en (minutos), el reparto le pide el pin como siempre</span><input id="aj-rec-espera" type="number" min="5" max="1440"></div>
          </section>
          <section class="grupo-aj"><h3>Cierre del día</h3><p class="ayuda-grupo">Lo que quedó de ayer se aparta y lo avisado se da por entregado, para que Hoy arranque limpio.</p>
            <label class="linea"><input type="checkbox" id="aj-cierre-activo"> Cerrar el día solo: lo de ayer sin terminar pasa a "necesita una persona" y lo avisado se da por entregado</label>
            <div class="ajuste-fila"><span>Hora del cierre</span><input id="aj-cierre-hora" type="time" step="3600"></div>
          </section>
          <section class="grupo-aj"><h3>Horario y número de soporte</h3><p class="ayuda-grupo">Se los decimos al cliente al registrar su ubicación: en los textos salen como {desde}, {hasta}, {hastaExtendido} y {soporte}.</p>
            <div class="ajuste-fila"><span>Las entregas son desde las</span><input id="aj-hor-desde" type="time" step="900"></div>
            <div class="ajuste-fila"><span>hasta las</span><input id="aj-hor-hasta" type="time" step="900"></div>
            <div class="ajuste-fila"><span>Horario extendido (algunos casos) hasta las</span><input id="aj-hor-ext" type="time" step="900"></div>
            <div class="ajuste-fila"><span>Número de soporte (WhatsApp y llamadas) <span class="muted">9 cifras, ej. 987 654 321</span></span><input id="aj-sop-wa" type="tel" inputmode="tel" placeholder="987 654 321"></div>
            <div class="ajuste-fila"><span>Otro número solo para llamadas <span class="muted">(opcional; vacío = el mismo)</span></span><input id="aj-sop-tel" type="tel" inputmode="tel" placeholder="01 234 5678"></div>
          </section>
        </div>
        <div id="aj-plantillas-caja" class="grupo-aj ancho hidden"><h3>Plantillas de Meta</h3>
          <p class="ayuda-grupo">Meta solo deja escribir libremente durante 24 h desde el último mensaje del cliente; pasado eso no deja mandar texto libre: hace falta una plantilla aprobada (<a href="/panel#plantillas">Mensajes aprobados</a>). Sin ella, la entrega se aparta y se avisa. Variables en orden: confirmación {{1}} nombre, {{2}} pedido, {{3}} negocio · motorizado {{1}} cliente, {{2}} pedido, {{3}} enlace del mapa · aviso {{1}} nombre, {{2}} pedido, {{3}} hora.</p>
          <datalist id="aj-plantillas-lista"></datalist>
          <div class="ajuste-fila" style="grid-template-columns:1fr 220px"><span>Pedir confirmación</span><input id="aj-pl-confirmacion" list="aj-plantillas-lista" placeholder="nombre de la plantilla"></div>
          <div class="ajuste-fila" style="grid-template-columns:1fr 220px"><span>Al motorizado (pin y pregunta)</span><input id="aj-pl-motorizado" list="aj-plantillas-lista" placeholder="nombre de la plantilla"></div>
          <div class="ajuste-fila" style="grid-template-columns:1fr 220px"><span>Aviso de llegada al cliente</span><input id="aj-pl-aviso" list="aj-plantillas-lista" placeholder="nombre de la plantilla"></div>
        </div>
        <details class="grupo-aj ancho textos"><summary>Textos que se mandan <span class="muted">(cada uno con «Ver cómo queda»; vacío = el de siempre)</span></summary><div id="aj-textos"></div></details>
        <div style="margin-top:10px;display:flex;gap:8px;align-items:center"><button class="primary" id="aj-guardar" type="button">Guardar ajustes</button><span class="muted" id="aj-estado"></span></div>
      </div>
    </div>
  </div>
</div>
</div>
`;

  const script = String.raw`
${estadosVisualesJs()}
${DIALOGO_ELEGIR_JS}
async function api(path, options) {
  options = options || {};
  var res = await fetch(path, {
    method: options.method || 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  var data = await res.json().catch(function () { return {}; });
  if (res.status === 401) { irAlLogin(); throw new Error('Tu sesión terminó: vuelve a entrar.'); }
  if (!res.ok) { var e = new Error(data.error || errorHttp(res.status)); e.datos = data; throw e; }
  return data;
}
function esc(v) {
  return String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function toast(texto) {
  var el = document.createElement('div');
  el.className = 'toast';
  el.textContent = texto;
  document.body.appendChild(el);
  setTimeout(function () { el.remove(); }, 4500);
}
/* Siempre "14:43", como en los mensajes al cliente: nada de "01:12 p. m." en una parte y 24 h en otra. */
function hora(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function diaEnPalabras(dia) {
  try {
    var d = new Date(dia + 'T12:00:00');
    var t = d.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' });
    return t.charAt(0).toUpperCase() + t.slice(1);
  } catch (e) { return dia; }
}
/* La tira, en una sola linea para el celular: "WhatsApp ✓ · GSG ✓ · 10 motorizados · cierre ✓". */
var waResumen = '';
function pintarTiraResumen() {
  var b = document.getElementById('tira-resumen');
  if (!b || !resumen) return;
  var partes = [];
  if (waResumen) partes.push(waResumen);
  var g = resumen.gsg;
  partes.push(!g || g.modo === 'ninguna' ? 'GSG ✕' : g.modo === 'simulador' ? 'GSG simulador' : 'GSG ✓');
  var activos = resumen.motorizados.filter(function (m) { return m.estado === 'activo'; }).length;
  partes.push(activos + ' motorizado' + (activos === 1 ? '' : 's'));
  partes.push(resumen.cierrePendiente ? 'cierre pendiente' : 'cierre ✓');
  b.textContent = partes.join(' · ');
}
function telefonoBonito(p) {
  if (!p) return '';
  if (p.length === 11 && p.indexOf('51') === 0) return '+51 ' + p.slice(2, 5) + ' ' + p.slice(5, 8) + ' ' + p.slice(8);
  return '+' + p;
}
function minutosTexto(m) {
  if (m === null || m === undefined) return '';
  var h = Math.floor(m / 60), r = m % 60;
  if (!h) return r + ' min';
  if (!r) return h + ' h';
  return h + ' h ' + r + ' min';
}

var resumen = null;
var filtro = '';
var abiertas = {};

var NOMBRE_INCIDENCIA = {
  no_entregado: 'no se pudo entregar', reprogramar: 'el cliente pide otro día', no_llego: 'el cliente dice que no le llegó', dia_cerrado: 'quedó de ayer', sin_confirmacion: 'no confirmó', sin_motorizado: 'sin motorizado',
  sin_pin: 'sin coordenadas', sin_plantilla: 'falta la plantilla', error_envio: 'WhatsApp rechazó el envío', cambio: 'pide un cambio', aviso_no_enviado: 'el aviso no salió', rechaza_contacto: 'se dio de baja', sin_ubicacion: 'sin ubicación'
};

/* Los chips de cada paso llevan el mismo tono que el resto del sistema: verde hecho, ambar esperando, rojo mal, azul en marcha, gris sin mas. */
function chipPaso(tono, texto) { return '<span class="chip tono-' + tono + '">' + texto + '</span>'; }
function chipUbicacion(e) {
  if (e.ubicacionEstado === 'recibida') return chipPaso('verde', (e.mapsUrl ? '<a href="' + esc(e.mapsUrl) + '" target="_blank" rel="noopener" style="color:inherit">pin recibido</a>' : 'pin recibido'));
  if (e.ubicacionEstado === 'no_hace_falta') return chipPaso('gris', 'GSG la tiene');
  var s = e.solicitud;
  var sub = s ? (s.estado === 'pendiente' ? 'en cola del reparto' : s.estado === 'enviado' ? 'pedida (' + s.intentos + ')' : s.estado === 'respondio' ? 'contestó otra cosa' : s.estado) : 'por pedir';
  return chipPaso('ambar', esc(sub));
}
function chipConfirmacion(e) {
  if (e.confirmacionEstado === 'confirmada') return chipPaso('verde', esc(e.confirmacionComo === 'ia' ? 'confirmó (IA)' : e.confirmacionComo === 'persona' ? 'a mano' : e.confirmacionComo === 'boton' ? 'confirmó (botón)' : 'confirmó'));
  if (e.confirmacionEstado === 'rechazada') return chipPaso('rojo', 'no la quiso');
  if (e.confirmacionEstado === 'no_hace_falta') return chipPaso('gris', 'ya confirmada');
  if (e.confirmacionEstado === 'pedida') return chipPaso('ambar', 'pedida (' + e.confirmacionIntentos + ')');
  return chipPaso('ambar', 'por pedir');
}
function chipMotorizado(e) {
  if (!e.motorizado) return e.estado === 'lista' ? chipPaso('azul', 'buscando…') : '<span class="muted">—</span>';
  var quien = esc(e.motorizado.nombre) + (e.motorizado.placa ? ' <span class="sub" style="display:inline;margin:0">' + esc(e.motorizado.placa) + '</span>' : '');
  if (e.motorizadoEstado === 'respondio') return chipPaso('verde', quien) + '<div class="sub">dijo ' + minutosTexto(e.minutosMotorizado) + '</div>';
  if (e.motorizadoEstado === 'enviado') return chipPaso('ambar', quien) + '<div class="sub">pin enviado ' + hora(e.motorizadoEnviadoAt) + '</div>';
  return chipPaso('gris', quien);
}
function chipLlega(e) {
  if (e.estado === 'entregada') {
    var como = e.entregadaComo === 'foto' ? 'con foto' : e.entregadaComo === 'persona' ? 'a mano' : e.entregadaComo === 'cierre' ? 'por el cierre del día' : e.entregadaComo === 'ia' ? 'lo dijo (IA)' : 'lo dijo';
    return chipPaso('verde', 'entregado ' + (e.entregadaAt ? hora(e.entregadaAt) : '')) + '<div class="sub">' + como + (e.llegaAproxAt ? ' · se avisó ' + hora(e.llegaAproxAt) : '') + '</div>';
  }
  if (!e.llegaAproxAt) return '<span class="muted">—</span>';
  return '<b>' + hora(e.llegaAproxAt) + '</b><div class="sub">' + minutosTexto(e.minutosAviso) + (e.avisoEnviadoAt ? ' · avisado' : ' · sin avisar') + '</div>';
}
/* Todas las acciones de un pedido, con su nombre completo (van dentro de la tarjeta que abre "Ver"). */
function todasLasAcciones(e) {
  var b = [];
  if (e.acciones.indexOf('confirmar') >= 0) b.push('<button class="sm" data-confirmar="' + e.id + '" type="button">Confirmar a mano</button>');
  if (e.acciones.indexOf('poner_ubicacion') >= 0) b.push('<button class="sm" data-ubicacion="' + e.id + '" type="button">Poner el pin a mano</button>');
  if (e.acciones.indexOf('marcar_entregada') >= 0) b.push('<button class="sm" data-entregada="' + e.id + '" type="button">Marcar entregada</button>');
  if (e.acciones.indexOf('segunda_visita') >= 0) b.push('<button class="sm" data-segunda="' + e.id + '" type="button">Segunda visita</button>');
  if (e.acciones.indexOf('reintentar') >= 0) b.push('<button class="sm" data-reintentar="' + e.id + '" type="button">Reintentar</button>');
  if (e.acciones.indexOf('reasignar') >= 0) b.push('<button class="sm" data-reasignar="' + e.id + '" type="button">Pasar a otro motorizado</button>');
  if (e.acciones.indexOf('prioridad') >= 0) b.push('<button class="sm" data-prioridad="' + e.id + '" data-urgente="' + (e.prioridad === 'urgente' ? '0' : '1') + '" type="button">' + (e.prioridad === 'urgente' ? 'Quitar urgente' : 'Marcar urgente') + '</button>');
  if (e.acciones.indexOf('cancelar') >= 0) b.push('<button class="sm peligro" data-cancelar="' + e.id + '" type="button">Cancelar el pedido</button>');
  return b;
}
/* En la fila solo "Ver" y lo que toca hacer ahora (una o dos acciones); el resto, dentro de la tarjeta. */
function botones(e) {
  var b = ['<button class="sm" data-ver="' + e.id + '" type="button" aria-expanded="' + (abiertas[e.id] ? 'true' : 'false') + '">' + (abiertas[e.id] ? 'Cerrar' : 'Ver') + '</button>'];
  var principales = [];
  if (e.acciones.indexOf('confirmar') >= 0) principales.push('<button class="sm" data-confirmar="' + e.id + '" type="button">Confirmar</button>');
  if (e.acciones.indexOf('marcar_entregada') >= 0) principales.push('<button class="sm" data-entregada="' + e.id + '" type="button">Entregada</button>');
  if (e.acciones.indexOf('segunda_visita') >= 0) principales.push('<button class="sm" data-segunda="' + e.id + '" type="button">Segunda visita</button>');
  if (e.acciones.indexOf('reintentar') >= 0) principales.push('<button class="sm" data-reintentar="' + e.id + '" type="button">Reintentar</button>');
  if (!principales.length && e.acciones.indexOf('poner_ubicacion') >= 0) principales.push('<button class="sm" data-ubicacion="' + e.id + '" type="button">Poner pin</button>');
  return '<div class="acciones">' + b.concat(principales.slice(0, 2)).join('') + '</div>';
}

/* Cinco cifras a la vista (las que importan a las 9 de la mañana) y el resto en "Mas cifras". */
var CIFRAS_MAS = ['avisada', 'entregada', 'terminada', 'urgente', 'esperandoSegundaVisita', 'lista', 'esperando_motorizado', 'cancelada'];
function pintarTarjetas(c) {
  c.enCamino = (c.lista || 0) + (c.esperando_motorizado || 0) + (c.avisada || 0);
  var principales = [
    ['total', 'pedidos hoy', ''],
    ['faltaUbicacion', 'falta ubicación', 'warn'],
    ['faltaConfirmacion', 'falta confirmar', 'warn'],
    ['enCamino', 'en camino', 'info'],
    ['incidencia', 'necesitan una persona', (c.incidencia || 0) > 0 ? 'bad' : '']
  ];
  var mas = [
    ['avisada', 'clientes avisados', 'info'],
    ['entregada', 'entregadas', 'ok'],
    ['terminada', 'terminadas en GSG', 'ok'],
    ['urgente', 'urgentes', 'bad'],
    ['esperandoSegundaVisita', 'esperan al cliente (¿volvemos hoy?)', 'info'],
    ['lista', 'listas para motorizado', 'info'],
    ['esperando_motorizado', 'esperando al motorizado', 'info'],
    ['cancelada', 'canceladas', '']
  ];
  function tarjeta(x) {
    return '<div class="tarjeta ' + x[2] + (filtro === x[0] ? ' activa' : '') + '" data-filtro="' + x[0] + '" role="button" tabindex="0"><div class="n">' + (c[x[0]] || 0) + '</div><div class="q">' + x[1] + '</div></div>';
  }
  var abierto = CIFRAS_MAS.indexOf(filtro) >= 0 || (c.urgente || 0) > 0 || (c.esperandoSegundaVisita || 0) > 0;
  document.getElementById('tarjetas').innerHTML = principales.map(tarjeta).join('') +
    '<details class="mas-cifras" id="mas-cifras"' + (abierto ? ' open' : '') + '><summary>Más cifras (avisados, entregadas, urgentes…)</summary><div class="tarjetas">' + mas.map(tarjeta).join('') + '</div></details>';
}

var FINAL = { entregada: 1, terminada: 1, cancelada: 1 };
function esperaSegunda(e) { return e.estado === 'incidencia' && e.segundaVisitaPedidaAt && !e.requiereHumano; }
function pasaFiltro(e) {
  if (!filtro || filtro === 'total') return true;
  if (filtro === 'faltaUbicacion') return e.ubicacionEstado === 'pendiente' && e.estado !== 'cancelada';
  if (filtro === 'faltaConfirmacion') return (e.confirmacionEstado === 'pendiente' || e.confirmacionEstado === 'pedida') && e.estado !== 'cancelada';
  if (filtro === 'urgente') return e.prioridad === 'urgente' && !FINAL[e.estado];
  if (filtro === 'enCamino') return e.estado === 'lista' || e.estado === 'esperando_motorizado' || e.estado === 'avisada';
  if (filtro === 'esperandoSegundaVisita') return esperaSegunda(e);
  if (filtro === 'incidencia') return e.estado === 'incidencia' && !esperaSegunda(e);
  return e.estado === filtro;
}

function pintarFilas() {
  var q = (document.getElementById('buscar').value || '').trim().toLowerCase();
  var lista = resumen.entregas.filter(pasaFiltro).filter(function (e) {
    if (!q) return true;
    var digitos = q.replace(/\D/g, '');
    return (e.nombre || '').toLowerCase().indexOf(q) >= 0 || (digitos.length >= 3 && e.phone.indexOf(digitos) >= 0) || e.referencia.toLowerCase().indexOf(q) >= 0;
  });
  /* los urgentes que siguen vivos van arriba; el resto, en su orden de llegada */
  lista = lista.map(function (e, i) { return { e: e, i: i }; }).sort(function (a, b) {
    var ua = a.e.prioridad === 'urgente' && !FINAL[a.e.estado] ? 0 : 1;
    var ub = b.e.prioridad === 'urgente' && !FINAL[b.e.estado] ? 0 : 1;
    return ua - ub || a.i - b.i;
  }).map(function (x) { return x.e; });
  var tbody = document.getElementById('filas');
  if (!lista.length) {
    tbody.innerHTML = resumen.entregas.length
      ? '<tr><td colspan="7" class="vacio">Ninguna entrega con ese filtro.</td></tr>'
      : '<tr><td colspan="7" class="vacio-td"><div class="vacio"><div class="ico">📦</div><h3>Todavía no hay pedidos hoy</h3><p>Sincroniza con GSG (o carga el simulador) para traerlos, o pega la lista del día tal como sale de Excel.</p><div class="acciones"><button class="btn primario" type="button" onclick="document.getElementById(\'sincronizar\').click()">Traer los pendientes de GSG</button><button class="btn" type="button" onclick="document.getElementById(\'pegar-abrir\').click()">Pegar la lista del día</button></div></div></td></tr>';
    return;
  }
  tbody.innerHTML = lista.map(function (e) {
    var urgente = e.prioridad === 'urgente' && !FINAL[e.estado];
    /* el chip de situacion es el mismo que en el mapa, en Motorizados y en la campana (catalogo compartido) */
    var chipSituacion = esperaSegunda(e)
      ? '<span class="chip tono-azul" data-estado="segunda_visita">Esperando al cliente</span>'
      : chipEstado('entrega', e.estado);
    var fila = '<tr' + (urgente ? ' class="fila-urgente"' : '') + '>' +
      '<td><b>' + esc(e.nombre || 'Sin nombre') + '</b>' + (urgente ? '<span class="urg">URGENTE</span>' : '') + (e.segundaVisita ? '<span class="sv">2.ª visita</span>' : '') + (e.mismoCliente && e.mismoCliente.length ? '<span class="mismo" title="El mismo cliente tiene otro pedido hoy: su pin y su confirmación valen para los dos y van en el mismo viaje">+' + e.mismoCliente.length + ' del mismo cliente: ' + esc(e.mismoCliente.join(', ')) + '</span>' : '') + '<div class="sub">' + esc(e.referencia) + ' · <span class="telefono">' + esc(telefonoBonito(e.phone)) + '</span>' + (e.distrito ? '<br>' + esc(e.distrito) : '') + '</div></td>' +
      '<td>' + chipUbicacion(e) + '</td>' +
      '<td>' + chipConfirmacion(e) + '</td>' +
      '<td>' + chipMotorizado(e) + '</td>' +
      '<td>' + chipLlega(e) + '</td>' +
      '<td title="' + esc(e.situacion) + '">' + chipSituacion + (e.estado === 'incidencia' && !esperaSegunda(e) && NOMBRE_INCIDENCIA[e.incidencia] ? '<div class="sub">' + esc(NOMBRE_INCIDENCIA[e.incidencia]) + '</div>' : '') + '</td>' +
      '<td>' + botones(e) + '</td></tr>';
    if (abiertas[e.id]) fila += '<tr class="fila-detalle"><td colspan="7" id="detalle-' + e.id + '">Cargando…</td></tr>';
    return fila;
  }).join('');
  Object.keys(abiertas).forEach(function (id) { if (abiertas[id]) cargarDetalle(id); });
}

async function cargarDetalle(id) {
  var td = document.getElementById('detalle-' + id);
  if (!td) return;
  try {
    var r = await api('/admin/entregas/' + id);
    var e = r.entrega;
    var datos = '<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px;margin-bottom:8px">' +
      '<span><b>Dirección:</b> ' + esc(e.direccion || '—') + (e.distrito ? ', ' + esc(e.distrito) : '') + '</span>' +
      (e.notas ? '<span><b>Notas:</b> ' + esc(e.notas) + '</span>' : '') +
      (e.lat !== null ? '<span><b>Pin:</b> ' + e.lat.toFixed(5) + ', ' + e.lng.toFixed(5) + (e.mapsUrl ? ' <a href="' + esc(e.mapsUrl) + '" target="_blank" rel="noopener">abrir</a>' : '') + '</span>' : '') +
      (e.confirmacionRespuesta ? '<span><b>Contestó:</b> «' + esc(e.confirmacionRespuesta) + '»</span>' : '') +
      (e.motorizadoRespuesta ? '<span><b>El motorizado:</b> «' + esc(e.motorizadoRespuesta) + '»</span>' : '') +
      '</div>';
    /* las acciones disponibles vienen en la lista (resumen), no en la ficha */
    var enLista = resumen.entregas.filter(function (x) { return String(x.id) === String(id); })[0];
    var acciones = todasLasAcciones(enLista || { id: e.id, acciones: e.acciones || [], prioridad: e.prioridad });
    td.innerHTML = (e.situacion ? '<p class="situacion-larga">' + esc(e.situacion) + '</p>' : '') +
      (acciones.length ? '<div class="acciones-detalle">' + acciones.join('') + '</div>' : '') +
      datos + r.eventos.map(function (ev) {
      return '<div class="mov"><span class="hora">' + hora(ev.createdAt) + '</span><span class="que"><b>' + esc(ev.tipo.replace(/_/g, ' ')) + '</b> ' + esc(ev.detalle || '') + '</span></div>';
    }).join('');
  } catch (e) { td.textContent = e.message; }
}

function pintarMotorizadosTira() {
  var activos = resumen.motorizados.filter(function (m) { return m.estado === 'activo'; });
  var enCalle = resumen.entregas.filter(function (e) { return e.motorizado && (e.motorizadoEstado === 'enviado' || e.motorizadoEstado === 'respondio') && e.estado !== 'terminada'; }).length;
  var el = document.getElementById('mot-estado');
  if (!resumen.motorizados.length) { el.innerHTML = '<span class="punto bad"></span>No hay ningún motorizado dado de alta: sin ellos nadie recibe los pedidos.'; return; }
  if (!activos.length) { el.innerHTML = '<span class="punto bad"></span>' + resumen.motorizados.length + ' dados de alta, ninguno activo hoy.'; return; }
  var entregadas = resumen.cifras.entregada || 0;
  el.innerHTML = '<span class="punto ok"></span>' + activos.length + ' activo' + (activos.length === 1 ? '' : 's') + (enCalle ? ' · ' + enCalle + ' pedido' + (enCalle === 1 ? '' : 's') + ' en la calle' : '') + (entregadas ? ' · ' + entregadas + ' entregado' + (entregadas === 1 ? '' : 's') : '');
}

/* El cierre del dia: que hizo el ultimo y si queda algo de ayer sin cerrar. */
function pintarCierre() {
  var el = document.getElementById('cierre-estado');
  var u = resumen.ultimoCierre;
  var a = resumen.ajustes.cierreDelDia || { activo: true, hora: 0 };
  var pendiente = resumen.cierrePendiente || 0;
  var partes = [];
  if (u && u.dia === resumen.dia) {
    partes.push('<span class="punto ' + (u.sinTerminar.length ? 'warn' : 'ok') + '"></span>Ayer se cerró a las ' + hora(u.cuando) + ': ' + (u.sinTerminar.length ? u.sinTerminar.length + ' sin terminar → <a href="#" data-filtro-ir="incidencia">necesitan a alguien</a>' : 'nada quedó sin terminar') + (u.dadasPorEntregadas.length ? ', ' + u.dadasPorEntregadas.length + ' dad' + (u.dadasPorEntregadas.length === 1 ? 'a' : 'as') + ' por entregad' + (u.dadasPorEntregadas.length === 1 ? 'a' : 'as') : '') + '.');
  } else if (pendiente) {
    partes.push('<span class="punto warn"></span>' + pendiente + ' pedido' + (pendiente === 1 ? '' : 's') + ' de ayer sigue' + (pendiente === 1 ? '' : 'n') + ' sin cerrar' + (a.activo ? ' (se cierra solo a las ' + String(a.hora).padStart(2, '0') + ':00).' : ' (el cierre automático está apagado).'));
  } else {
    partes.push('<span class="punto ok"></span>Nada pendiente de ayer.' + (a.activo ? ' Se cierra solo a las ' + String(a.hora).padStart(2, '0') + ':00.' : ' El cierre automático está apagado.'));
  }
  el.innerHTML = partes.join('');
  document.getElementById('cerrar-dia').classList.toggle('hidden', !pendiente);
}

async function pintarWhatsApp() {
  var el = document.getElementById('wa-estado');
  try {
    var r = await fetch('/health', { cache: 'no-store', credentials: 'same-origin' });
    var h = await r.json();
    if (!h.configured) { el.innerHTML = '<span class="punto bad"></span>Sin conectar. <a href="/setup">Conectar el WhatsApp</a>.'; waResumen = 'WhatsApp ✕'; }
    else if (!h.connected) { el.innerHTML = '<span class="punto warn"></span>Configurado pero desconectado. <a href="/setup">Volver a vincular</a>.'; waResumen = 'WhatsApp caído'; }
    else { el.innerHTML = '<span class="punto ok"></span>Conectado y escribiendo.' + (resumen.motor.parado ? ' <span class="muted">Ahora mismo parado: ' + esc(resumen.motor.parado) + '</span>' : resumen.motor.enHorario ? '' : ' <span class="muted">Fuera del horario de envío.</span>'); waResumen = 'WhatsApp ✓'; }
  } catch (e) { el.innerHTML = '<span class="punto"></span>No se pudo saber.'; waResumen = ''; }
  pintarTiraResumen();
}

/* Lo que necesita a una persona: las entregas con incidencia y los clientes del reparto apartados que no tienen pedido de hoy. */
async function pintarAlguien() {
  var caja = document.getElementById('alguien');
  var conEntrega = {};
  resumen.entregas.forEach(function (e) { conEntrega[e.phone] = true; });
  var filas = resumen.entregas.filter(function (e) { return e.estado === 'incidencia' && !esperaSegunda(e); }).map(function (e) {
    return '<div class="mov"><span class="que"><b>' + esc(e.referencia) + '</b> ' + esc(e.nombre || telefonoBonito(e.phone)) + ': ' + esc(e.incidenciaDetalle || e.incidencia || '') + ' <a href="#" data-ir-fila="' + e.id + '">ver</a></span></div>';
  });
  try {
    var r = await api('/admin/rutas/solicitudes?requiereHumano=true&limit=50');
    (r.items || []).filter(function (s) { return !conEntrega[s.phone]; }).forEach(function (s) {
      filas.push('<div class="mov"><span class="que"><b>' + esc(s.referencia || 'sin pedido') + '</b> ' + esc(s.nombre || telefonoBonito(s.phone || s.telefonoCrudo)) + ': ' + esc(s.incidenciaDetalle || s.incidencia || s.estado) +
        '<div class="acciones mov-acciones"><button class="sm" data-sol-reintentar="' + s.id + '" type="button">Volver a intentar</button><a class="btn sm" href="/chat?tel=' + esc(s.phone || '') + '">Abrir chat</a></div></span></div>');
    });
  } catch (e) {}
  document.getElementById('alguien-n').textContent = filas.length ? filas.length + ' caso' + (filas.length === 1 ? '' : 's') : 'nada pendiente';
  caja.innerHTML = filas.length ? filas.join('') : '<div class="nada">✓ Nadie espera a una persona ahora mismo.</div>';
}

/* Los otros: la lista de envio automatico (reparto sin pedido de hoy + numeros a mano), tal como la cuenta el sistema. */
async function pintarOtros() {
  var tbody = document.getElementById('otros');
  try {
    var r = await api('/admin/envio-automatico');
    var conEntrega = {};
    resumen.entregas.forEach(function (e) { conEntrega[e.phone] = true; });
    var lista = (r.numeros || []).filter(function (n) { return !conEntrega[n.phone]; });
    document.getElementById('otros-n').textContent = lista.length ? lista.length : 'nadie';
    if (!lista.length) { tbody.innerHTML = '<tr><td colspan="3" class="vacio">Ahora mismo no hay nadie más en la lista.</td></tr>'; return; }
    tbody.innerHTML = lista.map(function (n) {
      return '<tr><td><b>' + esc(n.nombre || telefonoBonito(n.phone)) + '</b><div class="sub">' + esc(telefonoBonito(n.phone)) + (n.referencia ? ' · ' + esc(n.referencia) : '') + '</div></td>' +
        '<td class="sub">' + esc(n.situacion) + (n.pausado ? ' <span class="chip tono-ambar">en pausa</span>' : '') + '</td>' +
        '<td><div class="acciones">' + (n.pausado ? '<button class="sm" data-otro-reanudar="' + esc(n.clave) + '" type="button">Reanudar</button>' : '<button class="sm" data-otro-pausar="' + esc(n.clave) + '" type="button">Pausar</button>') + '<button class="sm peligro" data-otro-quitar="' + esc(n.clave) + '" type="button">Quitar</button></div></td></tr>';
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="3" class="vacio">' + esc(e.message) + '</td></tr>';
  }
}

function pintarEventos() {
  var caja = document.getElementById('eventos');
  if (!resumen.eventos.length) { caja.innerHTML = '<div class="nada">Todavía no pasó nada hoy.</div>'; return; }
  caja.innerHTML = resumen.eventos.map(function (ev) {
    return '<div class="mov"><span class="hora">' + hora(ev.at) + '</span><span class="que"><b>' + esc(ev.referencia) + '</b> ' + esc(ev.nombre || ev.phone) + ': ' + esc(ev.detalle || ev.tipo) + '</span></div>';
  }).join('');
}

function pintarGsg() {
  var g = resumen.gsg;
  var el = document.getElementById('gsg-estado');
  if (!g) { el.innerHTML = '<span class="punto"></span>La conexión con GSG se fija al arrancar (no se cambia desde aquí).'; return; }
  var clase = g.modo === 'ninguna' ? 'bad' : g.modo === 'simulador' ? 'info' : 'ok';
  el.innerHTML = '<span class="punto ' + clase + '"></span>' + esc(g.descripcion) + (g.origen === 'env' ? ' <span class="muted">(del arranque)</span>' : '');
  var u = resumen.ultimaSincronizacion;
  document.getElementById('gsg-ultima').textContent = u ? (u.ok ? 'Última sincronización ' + hora(u.at) + ': ' + u.detalle : 'Última sincronización ' + hora(u.at) + ' falló: ' + u.detalle) : 'Todavía no se sincronizó hoy.' + (resumen.motor.parado ? ' Motor: ' + resumen.motor.parado : '');
  document.getElementById('sim-usar').classList.toggle('hidden', g.modo === 'simulador');
  var cola = document.getElementById('gsg-cola');
  var c = resumen.gsgCola;
  if (c && (c.fallido > 0 || c.atascado > 0 || c.pendiente > 20)) {
    cola.classList.remove('hidden');
    cola.className = 'gsg-cola' + (c.fallido > 0 || c.atascado > 0 ? ' mal' : '');
    var quePasa = c.fallido > 0 ? c.fallido + ' reporte' + (c.fallido === 1 ? '' : 's') + ' que GSG no aceptó'
      : c.atascado > 0 ? c.atascado + ' reporte' + (c.atascado === 1 ? '' : 's') + ' que GSG no aceptó todavía (no respondió al mandarlos)'
      : c.pendiente + ' reportes esperando a GSG';
    cola.innerHTML = quePasa + ' · <a href="#" id="gsg-cola-reintentar">Reintentar</a> · <a href="/admin/rutas/cola.ndjson" target="_blank" rel="noopener">Descargar</a>';
    document.getElementById('gsg-cola-reintentar').onclick = async function (ev) {
      ev.preventDefault();
      try { var r = await api('/admin/rutas/cola/despachar', { method: 'POST', body: {} }); toast('Reintentado: ' + (r.enviados || 0) + ' aceptados, ' + ((r.intentados || 0) - (r.enviados || 0)) + ' siguen sin entrar.'); await cargar(); } catch (e) { toast(e.message); }
    };
  } else {
    cola.classList.add('hidden');
  }
  var simOpcion = document.getElementById('pegar-destino-sim');
  if (simOpcion) simOpcion.classList.toggle('hidden', g.modo !== 'simulador');
}

/* El modo prueba (solo se escribe a ciertos numeros): un cartel arriba para que nadie se lleve un susto. */
async function pintarModoPrueba() {
  try {
    var r = await api('/admin/ajustes');
    var e = r.efectivo || {};
    var nums = e.soloNumeros || [];
    var cartel = document.getElementById('cartel-prueba');
    if (nums.length) {
      cartel.classList.remove('hidden');
      document.getElementById('cartel-prueba-texto').textContent = 'solo se escribe a ' + nums.map(telefonoBonito).join(', ') + '; a los demás no les llega nada.';
      document.getElementById('modo-prueba-quitar').classList.toggle('hidden', Boolean(r.modoPruebaFijado));
    } else {
      cartel.classList.add('hidden');
    }
  } catch (e) { /* sin ajustes no hay cartel */ }
}

function pintarAjustes() {
  var a = resumen.ajustes;
  document.getElementById('aj-margen').value = a.margenMinutos;
  document.getElementById('aj-conf-espera').value = a.confirmacionEsperaMin;
  document.getElementById('aj-conf-max').value = a.confirmacionMaxIntentos;
  document.getElementById('aj-mot-espera').value = a.motorizadoEsperaMin;
  document.getElementById('aj-mot-max').value = a.motorizadoMaxIntentos;
  document.getElementById('aj-sync').value = a.sincronizarCadaMin;
  document.getElementById('aj-leer-ia').checked = a.leerConIA;
  document.getElementById('aj-redactar-ia').checked = a.redactarConIA;
  document.getElementById('aj-pin').checked = a.mandarPinAlMotorizado;
  document.getElementById('aj-avisar-entregado').checked = a.avisarEntregado !== false;
  document.getElementById('aj-donde-esta').checked = a.responderDondeEsta !== false;
  document.getElementById('aj-botones').checked = a.usarBotones !== false;
  document.getElementById('aj-cerca').checked = a.avisarCerca !== false;
  var sv = a.segundaVisita || { activa: true, esperaMin: 30 };
  document.getElementById('aj-sv-activa').checked = sv.activa !== false;
  if (document.activeElement !== document.getElementById('aj-sv-espera')) document.getElementById('aj-sv-espera').value = sv.esperaMin;
  var rec = a.clienteRecurrente || { activo: true, diasMaximo: 60, esperaMin: 60 };
  document.getElementById('aj-rec-activo').checked = rec.activo !== false;
  if (document.activeElement !== document.getElementById('aj-rec-dias')) document.getElementById('aj-rec-dias').value = rec.diasMaximo;
  if (document.activeElement !== document.getElementById('aj-rec-espera')) document.getElementById('aj-rec-espera').value = rec.esperaMin;
  var cd = a.cierreDelDia || { activo: true, hora: 0 };
  var he = a.horarioEntregas || {};
  document.getElementById('aj-hor-desde').value = he.desde || '14:00';
  document.getElementById('aj-hor-hasta').value = he.hasta || '20:00';
  document.getElementById('aj-hor-ext').value = he.extendidoHasta || '22:00';
  var sop = a.soporte || {};
  document.getElementById('aj-sop-wa').value = sop.whatsapp || '';
  document.getElementById('aj-sop-tel').value = sop.llamadas || '';
  document.getElementById('aj-cierre-activo').checked = cd.activo !== false;
  if (document.activeElement !== document.getElementById('aj-cierre-hora')) document.getElementById('aj-cierre-hora').value = String(cd.hora || 0).padStart(2, '0') + ':00';
  var pl = resumen.plantillas || { hacenFalta: false, aprobadas: [] };
  document.getElementById('aj-plantillas-caja').classList.toggle('hidden', !pl.hacenFalta);
  document.getElementById('aj-plantillas-lista').innerHTML = pl.aprobadas.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
  ['confirmacion', 'motorizado', 'aviso'].forEach(function (k) { var el = document.getElementById('aj-pl-' + k); if (document.activeElement !== el) el.value = (a.plantillas && a.plantillas[k]) || ''; });
  var caja = document.getElementById('aj-textos');
  if (!caja.children.length) {
    var pintaTexto = function (k) {
      return '<div class="texto-editable"><label>' + esc(resumen.textos.descripcion[k]) + '</label><textarea data-texto="' + k + '" placeholder="' + esc(resumen.textos.porDefecto[k]) + '">' + esc(a.textos[k] || '') + '</textarea><div class="previa"><a data-previa="' + k + '">Ver cómo queda</a><span class="resultado hidden" id="previa-' + k + '"></span></div></div>';
    };
    var claves = Object.keys(resumen.textos.porDefecto);
    var alMotorizado = claves.filter(function (k) { return k.indexOf('motorizado') === 0; });
    var alCliente = claves.filter(function (k) { return k.indexOf('motorizado') !== 0; });
    caja.innerHTML = '<p class="muted" style="margin:0 0 6px;font-size:13px">Vacío = el texto de siempre (el que se ve en gris). Toca una variable para insertarla donde está el cursor; «Ver cómo queda» lo rellena con un pedido de hoy.</p><h4 class="textos-para">Al cliente</h4>' + alCliente.map(pintaTexto).join('') + '<h4 class="textos-para">Al motorizado</h4>' + alMotorizado.map(pintaTexto).join('');
    claves.forEach(function (k) {
      var ta = caja.querySelector('textarea[data-texto="' + k + '"]');
      if (ta && window.chipsDeVariables) window.chipsDeVariables(ta, resumen.textos.variables[k] || []);
    });
    caja.addEventListener('click', async function (ev) {
      var a = ev.target.closest('[data-previa]');
      if (!a) return;
      ev.preventDefault();
      var k = a.getAttribute('data-previa');
      var caja2 = document.getElementById('previa-' + k);
      var ta = caja.querySelector('textarea[data-texto="' + k + '"]');
      try {
        var r = await api('/admin/entregas/previsualizar', { method: 'POST', body: { clave: k, texto: ta ? ta.value : '' } });
        caja2.textContent = r.texto;
        caja2.classList.remove('hidden');
      } catch (e) { toast(e.message); }
    });
  }
}

async function cargarSimulador() {
  var caja = document.getElementById('caja-sim');
  try {
    var r = await api('/admin/entregas/simulador');
    caja.classList.remove('hidden');
    var e = r.estado;
    document.getElementById('sim-resumen').textContent = 'falta ubicación ' + e.faltaUbicacion + ' · falta confirmar ' + e.faltaConfirmacion + ' · terminados ' + e.terminados + ' · cancelados ' + e.cancelados + ' · llamadas ' + e.llamadas;
    document.getElementById('sim-modo').value = r.modo;
    var p = r.pendientes;
    var col = function (titulo, lista, extra) {
      return '<div class="col"><b>' + titulo + ' (' + lista.length + ')</b>' + (lista.length ? lista.map(function (c) { return '<div>' + esc(c.referencia) + ' · ' + esc(c.nombre || c.telefono) + (extra ? extra(c) : '') + '</div>'; }).join('') : '<div class="muted">nadie</div>') + '</div>';
    };
    document.getElementById('sim-listas').innerHTML =
      col('Falta pedir ubicación', p.faltaUbicacion) +
      col('Falta confirmar', p.faltaConfirmacion, function (c) { return c.lat !== undefined ? ' <span class="muted">(GSG ya tiene el pin)</span>' : ''; }) +
      col('Ya terminó el proceso', p.terminados, function (c) { return c.llegaAproxEn ? ' <span class="muted">llega ' + hora(c.llegaAproxEn) + '</span>' : ''; }) +
      (p.cancelados.length ? col('Cancelados', p.cancelados) : '');
  } catch (e) {
    if (e.message && /no está montado/.test(e.message)) caja.classList.add('hidden');
  }
}

async function cargar() {
  resumen = await api('/admin/entregas');
  document.getElementById('dia').textContent = '· ' + diaEnPalabras(resumen.dia);
  pintarTiraResumen();
  pintarTarjetas(resumen.cifras);
  pintarFilas();
  pintarMotorizadosTira();
  pintarCierre();
  pintarEventos();
  pintarGsg();
  pintarAjustes();
  pintarWhatsApp();
  pintarAlguien();
  pintarOtros();
  pintarModoPrueba();
  cargarSimulador();
}
/* Llegar con ?filtro=incidencia (desde el Inicio o la campana) abre esa tarjeta. */
try {
  var filtroUrl = new URLSearchParams(window.location.search).get('filtro');
  if (filtroUrl) filtro = filtroUrl;
} catch (e) { /* sin filtro */ }
document.getElementById('cierre-estado').addEventListener('click', function (ev) {
  var a = ev.target.closest('[data-filtro-ir]');
  if (!a) return;
  ev.preventDefault();
  filtro = a.getAttribute('data-filtro-ir');
  pintarTarjetas(resumen.cifras);
  pintarFilas();
  document.getElementById('filas').scrollIntoView({ block: 'start', behavior: 'smooth' });
});

document.getElementById('tarjetas').addEventListener('click', function (ev) {
  var t = ev.target.closest('[data-filtro]');
  if (!t) return;
  filtro = filtro === t.getAttribute('data-filtro') ? '' : t.getAttribute('data-filtro');
  pintarTarjetas(resumen.cifras);
  pintarFilas();
});
document.getElementById('buscar').oninput = function () { if (resumen) pintarFilas(); };

document.getElementById('filas').addEventListener('click', async function (ev) {
  var b = ev.target.closest('button');
  if (!b) return;
  var id;
  try {
    if ((id = b.getAttribute('data-ver'))) { abiertas[id] = !abiertas[id]; pintarFilas(); return; }
    if ((id = b.getAttribute('data-entregada'))) {
      var siE = await confirmarDialogo({ titulo: 'Marcar como entregada', texto: '¿El motorizado ya la entregó (te lo dijo por teléfono, por ejemplo)? Se le contará a GSG y, si el ajuste está activo, al cliente se le da las gracias.', boton: 'Sí, entregada' });
      if (!siE) return;
      await api('/admin/entregas/' + id + '/entregada', { method: 'POST', body: {} });
      toast('Entregada: GSG ya lo sabe.');
      await cargar();
      return;
    }
    if ((id = b.getAttribute('data-segunda'))) {
      var siS = await confirmarDialogo({ titulo: 'Segunda visita', texto: '¿El cliente ya está en casa (te llamó, por ejemplo)? El motorizado recibe otra vez el pin para volver a pasar hoy; al cliente no se le vuelve a preguntar. Solo hay una segunda visita por pedido.', boton: 'Sí, que vuelva a pasar' });
      if (!siS) return;
      await api('/admin/entregas/' + id + '/segunda-visita', { method: 'POST', body: {} });
      toast('Segunda visita en marcha: el motorizado vuelve a pasar.');
      await cargar();
      return;
    }
    if ((id = b.getAttribute('data-prioridad'))) {
      var urg = b.getAttribute('data-urgente') === '1';
      await api('/admin/entregas/' + id + '/prioridad', { method: 'POST', body: { urgente: urg } });
      toast(urg ? 'Marcada como urgente: sale primero.' : 'Ya no es urgente.');
      await cargar();
      return;
    }
    if ((id = b.getAttribute('data-confirmar'))) {
      var si = await confirmarDialogo({ titulo: 'Confirmar a mano', texto: '¿El cliente confirmó el pedido de hoy (por teléfono o en persona)? Se le contará a GSG y, si tiene ubicación, pasa a un motorizado.', boton: 'Sí, confirmada' });
      if (!si) return;
      await api('/admin/entregas/' + id + '/confirmar', { method: 'POST', body: { confirmada: true } });
      toast('Confirmada: pasa a un motorizado en cuanto tenga ubicación.');
    } else if ((id = b.getAttribute('data-ubicacion'))) {
      var texto = await pedirDato({ titulo: 'Poner la ubicación a mano', texto: 'Pega un enlace de Google Maps o escribe las coordenadas (lat, lng).', marcador: 'https://maps.app.goo.gl/… o -12.1211, -77.0301', boton: 'Guardar' });
      if (!texto) return;
      await api('/admin/entregas/' + id + '/ubicacion', { method: 'POST', body: { texto: texto } });
      toast('Ubicación guardada: si ya confirmó, pasa a un motorizado.');
    } else if ((id = b.getAttribute('data-reasignar'))) {
      var actual = resumen.entregas.filter(function (x) { return String(x.id) === id; })[0];
      var rm = await api('/admin/motorizados');
      var activos = (rm.motorizados || []).filter(function (m) { return m.estado === 'activo' && !(actual && actual.motorizado && actual.motorizado.id === m.id); });
      var lleva = {};
      resumen.entregas.forEach(function (x) { if (x.motorizado && !FINAL[x.estado]) lleva[x.motorizado.id] = (lleva[x.motorizado.id] || 0) + 1; });
      var opcionesMot = [{ valor: '', etiqueta: 'Que elija el sistema', detalle: 'El más cercano o, si nadie está cerca, el que menos lleva.', principal: true }].concat(activos.map(function (m) {
        return { valor: String(m.id), etiqueta: m.nombre, detalle: (m.zona ? m.zona + ' · ' : '') + 'lleva ' + (lleva[m.id] || 0) };
      }));
      var elegido = await elegirOpcion({ titulo: 'Pasar a otro motorizado', texto: actual && actual.motorizado ? 'Ahora la tiene ' + actual.motorizado.nombre + '. ¿A quién se la pasamos?' : '¿Quién la lleva?', opciones: opcionesMot });
      if (elegido === null) return;
      await api('/admin/entregas/' + id + '/reasignar', { method: 'POST', body: { motorizadoId: elegido ? Number(elegido) : null } });
      var nuevo = activos.filter(function (m) { return String(m.id) === elegido; })[0];
      toast(nuevo ? 'Ahora la lleva ' + nuevo.nombre + ': le llega el pin por WhatsApp.' : 'El sistema elige al motorizado: le llega el pin por WhatsApp.');
    } else if ((id = b.getAttribute('data-reintentar'))) {
      await api('/admin/entregas/' + id + '/reintentar', { method: 'POST', body: {} });
      toast('En marcha otra vez.');
    } else if ((id = b.getAttribute('data-cancelar'))) {
      var motivo = await pedirDato({ titulo: 'Cancelar la entrega', texto: 'Se le contará a GSG y, si un motorizado la tenía, se le avisa.', etiqueta: 'Motivo', marcador: 'El cliente llamó para cancelar', boton: 'Cancelar la entrega' });
      if (!motivo) return;
      await api('/admin/entregas/' + id + '/cancelar', { method: 'POST', body: { motivo: motivo } });
      toast('Cancelada: GSG ya lo sabe.');
    } else return;
    await cargar();
  } catch (e) { toast(e.message); }
});

document.getElementById('nueva').onclick = async function () {
  try {
    var d = await pedirVarios({
      titulo: 'Pedido a mano',
      texto: 'Para un pedido que no viene de GSG. Se le pide la ubicación por WhatsApp y después la confirmación.',
      campos: [
        { id: 'nombre', etiqueta: 'Nombre del cliente', marcador: 'Juan Pérez' },
        { id: 'telefono', etiqueta: 'Su WhatsApp', tipo: 'tel', prefijo: '+51', marcador: '987 654 321' },
        { id: 'direccion', etiqueta: 'Dirección', marcador: 'Av. Larco 345, Miraflores', opcional: true },
        { id: 'referencia', etiqueta: 'Número de pedido', marcador: 'P-2001', opcional: true, ayuda: 'Si lo dejas vacío se pone uno solo (M-0001, M-0002…).' }
      ],
      boton: 'Crear y pedirle la ubicación'
    });
    if (!d) return;
    var body = { telefono: d.telefono, nombre: d.nombre || undefined, faltaUbicacion: true, faltaConfirmacion: true };
    if (d.referencia) body.referencia = d.referencia;
    if (d.direccion) body.direccion = d.direccion;
    var creado = await api('/admin/entregas/crear', { method: 'POST', body: body });
    toast('Creado' + (creado && creado.entrega && creado.entrega.referencia ? ' (' + creado.entrega.referencia + ')' : '') + ': se le pide la ubicación y después la confirmación.');
    await cargar();
  } catch (e) { toast(e.message); }
};

document.getElementById('cerrar-dia').onclick = async function () {
  var si = await confirmarDialogo({ titulo: 'Cerrar el día de ayer', texto: 'Lo que quedó de ayer sin terminar pasa a "necesita una persona" (y GSG se entera); lo que ya tenía hora avisada y nadie marcó como entregado se da por entregado. Los pedidos de hoy no se tocan.', boton: 'Cerrar el día' });
  if (!si) return;
  try {
    var r = await api('/admin/entregas/cerrar-dia', { method: 'POST', body: { forzar: true } });
    var res = r.resultado || { sinTerminar: [], dadasPorEntregadas: [] };
    toast(r.ok ? 'Día cerrado: ' + res.sinTerminar.length + ' sin terminar, ' + res.dadasPorEntregadas.length + ' dadas por entregadas.' : (r.motivo || 'No se pudo cerrar.'));
    await cargar();
  } catch (e) { toast(e.message); }
};

document.getElementById('pegar-abrir').onclick = function () {
  var caja = document.getElementById('caja-pegar');
  caja.classList.toggle('hidden');
  if (!caja.classList.contains('hidden')) document.getElementById('pegar-texto').focus();
};
document.getElementById('pegar-cerrar').onclick = function () { document.getElementById('caja-pegar').classList.add('hidden'); };
/* Antes de cargar: cuantos clientes se leyeron y que lineas no tienen un telefono valido. */
function previaPegar() {
  var lineas = document.getElementById('pegar-texto').value.split(/\r?\n/);
  var buenas = 0; var malas = [];
  lineas.forEach(function (l, i) {
    if (!l.trim()) return;
    if (i === 0 && /tel|nombre|pedido|direcc/i.test(l) && !/\d{7}/.test(l)) return; /* cabecera */
    var digitos = (l.match(/\d[\d\s-]{6,}\d/g) || []).map(function (x) { return x.replace(/\D/g, ''); });
    if (digitos.some(function (x) { return x.length >= 9 && x.length <= 12; })) buenas++; else malas.push(i + 1);
  });
  var out = document.getElementById('pegar-previa');
  var b = document.getElementById('pegar-cargar');
  if (!buenas && !malas.length) { out.textContent = ''; b.textContent = 'Cargar la lista'; return; }
  out.textContent = 'Se leyeron ' + buenas + ' cliente' + (buenas === 1 ? '' : 's') + (malas.length ? ' · ' + malas.length + ' sin teléfono válido (línea' + (malas.length === 1 ? ' ' : 's ') + malas.slice(0, 6).join(', ') + (malas.length > 6 ? '…' : '') + ')' : '');
  b.textContent = buenas ? 'Cargar ' + buenas + ' cliente' + (buenas === 1 ? '' : 's') + ' y empezar a escribirles' : 'Cargar la lista';
}
document.getElementById('pegar-texto').addEventListener('input', previaPegar);
document.getElementById('pegar-cargar').onclick = async function () {
  var b = this; var out = document.getElementById('pegar-resultado');
  var texto = document.getElementById('pegar-texto').value;
  if (!texto.trim()) { out.textContent = 'Pega primero la lista.'; return; }
  b.disabled = true;
  try {
    var r = await api('/admin/entregas/cargar-lista', { method: 'POST', body: {
      texto: texto,
      faltaUbicacion: document.getElementById('pegar-ubicacion').checked,
      faltaConfirmacion: document.getElementById('pegar-confirmacion').checked,
      destino: (document.querySelector('input[name="pegar-destino"]:checked') || { value: 'sistema' }).value
    } });
    var partes = [r.creadas + ' ' + (r.destino === 'simulador' ? 'en la lista del simulador' : 'creada' + (r.creadas === 1 ? '' : 's'))];
    var rep = Array.isArray(r.repetidas) ? r.repetidas.length : (r.repetidas || 0);
    if (rep) partes.push(rep + ' ya estaba' + (rep === 1 ? '' : 'n') + ' hoy');
    if (r.lote) partes.push('lote del reparto "' + r.lote.nombre + '" con ' + r.lote.total + ' para pedir la ubicación');
    if (r.descartadas && r.descartadas.length) partes.push(r.descartadas.length + ' línea' + (r.descartadas.length === 1 ? '' : 's') + ' sin usar: ' + r.descartadas.slice(0, 5).map(function (d) { return 'línea ' + d.linea + ' (' + d.motivo + ')'; }).join('; '));
    out.textContent = partes.join(' · ');
    toast(r.creadas ? 'Lista cargada.' : 'No se creó ninguna: revisa las líneas.');
    if (r.creadas) document.getElementById('pegar-texto').value = '';
    await cargar();
  } catch (e) { out.textContent = e.message; }
  b.disabled = false;
};

document.getElementById('modo-prueba').onclick = async function () {
  try {
    var r = await api('/admin/ajustes');
    var numero = (r.efectivo && r.efectivo.supervisor) || '';
    if (!numero) {
      numero = await pedirDato({ titulo: 'Modo prueba con mi número', texto: 'Escribe tu número: mientras el modo prueba esté activo, el sistema solo le escribirá a él y a nadie más.', etiqueta: 'Tu WhatsApp', marcador: '987 654 321', boton: 'Activar' });
      if (!numero) return;
      /* un celular peruano de 9 cifras se guarda con el 51 delante, como todo lo demas */
      numero = String(numero).replace(/\D+/g, '');
      if (numero.length === 9 && numero.charAt(0) === '9') numero = '51' + numero;
    }
    await api('/admin/ajustes', { method: 'POST', body: { modoPrueba: { activo: true, numeros: [numero] } } });
    toast('Modo prueba activo: solo se escribe a ' + telefonoBonito(numero) + '.');
    await cargar();
  } catch (e) { toast(e.message); }
};
document.getElementById('modo-prueba-quitar').onclick = async function () {
  try { await api('/admin/ajustes', { method: 'POST', body: { modoPrueba: { activo: false } } }); toast('Modo prueba apagado: se escribe a todos.'); await cargar(); } catch (e) { toast(e.message); }
};

document.getElementById('sincronizar').onclick = async function () {
  var b = this; b.disabled = true;
  try { var r = await api('/admin/entregas/sincronizar', { method: 'POST', body: {} }); toast(r.detalle); await cargar(); } catch (e) { toast(e.message); }
  b.disabled = false;
};
document.getElementById('gsg-probar').onclick = async function () {
  try { var r = await api('/admin/entregas/gsg/probar', { method: 'POST', body: {} }); toast(r.prueba.detalle); } catch (e) { toast(e.message); }
};
document.getElementById('gsg-configurar').onclick = async function () {
  try {
    var url = await pedirDato({ titulo: 'API real de GSG', texto: 'La dirección base de la API de GSG (la que tiene /reparto/pendientes, /ubicaciones, /confirmaciones, /entregas). Para usar el simulador, cancela y pulsa «Usar el simulador como GSG».', etiqueta: 'Dirección', marcador: 'https://api.gsg.pe/v1', boton: 'Siguiente' });
    if (!url) return;
    var token = await pedirDato({ titulo: 'API real de GSG', etiqueta: 'Token (se guarda cifrado)', marcador: 'el token que te dieron', boton: 'Conectar', validar: function () { return null; } });
    if (token === null) return;
    var r = await api('/admin/entregas/gsg', { method: 'POST', body: { modo: 'real', url: url, token: token || undefined } });
    toast('Conectado a ' + r.gsg.url + '. Prueba la conexión.');
    await cargar();
  } catch (e) { toast(e.message); }
};
document.getElementById('sim-usar').onclick = async function () {
  try { await api('/admin/entregas/gsg', { method: 'POST', body: { modo: 'simulador' } }); toast('Ahora GSG es el simulador de este servidor.'); await cargar(); } catch (e) { toast(e.message); }
};
document.getElementById('sim-cargar').onclick = async function () {
  try { var r = await api('/admin/entregas/simulador/cargar', { method: 'POST', body: {} }); toast(r.nuevos + ' clientes de prueba en la lista de GSG. Pulsa «Sincronizar ahora».'); await cargar(); } catch (e) { toast(e.message); }
};
document.getElementById('mot-cargar').onclick = async function () {
  try { var r = await api('/admin/motorizados/de-prueba', { method: 'POST', body: {} }); toast(r.nuevos + ' motorizados de prueba dados de alta.'); await cargar(); } catch (e) { toast(e.message); }
};
var guionTimer = null, guionVueltas = 0;
function pintarGuion(g) {
  var ol = document.getElementById('sim-dia-pasos');
  var res = document.getElementById('sim-dia-resumen');
  ol.classList.toggle('hidden', !g.pasos.length);
  ol.innerHTML = g.pasos.map(function (p) {
    var ico = p.estado === 'hecho' ? '✓' : p.estado === 'fallo' ? '✗' : p.estado === 'saltado' ? '–' : '…';
    return '<li class="paso-' + p.estado + '"><b>' + ico + '</b> ' + esc(p.texto) + (p.detalle ? ' <span class="muted">· ' + esc(p.detalle) + '</span>' : '') + '</li>';
  }).join('');
  res.classList.toggle('hidden', !g.resumen);
  res.textContent = g.resumen || '';
  var corriendo = g.estado === 'corriendo';
  document.getElementById('sim-dia').disabled = corriendo;
  document.getElementById('sim-dia-parar').classList.toggle('hidden', !corriendo);
  if (corriendo && ol.lastElementChild) ol.scrollTop = ol.scrollHeight;
}
async function seguirGuion() {
  try {
    var g = await api('/admin/entregas/simulador/probar-dia');
    pintarGuion(g);
    if (g.estado === 'corriendo') {
      guionVueltas++;
      if (guionVueltas % 3 === 0) { try { await cargar(); } catch (e) {} }
      guionTimer = setTimeout(seguirGuion, 1000);
    } else {
      guionTimer = null;
      await cargar();
    }
  } catch (e) { guionTimer = null; }
}
document.getElementById('sim-dia').onclick = async function () {
  try {
    await api('/admin/entregas/simulador/probar-dia', { method: 'POST', body: {} });
    toast('Empieza el día de prueba: mira los pasos aquí abajo y la tabla de pedidos.');
    document.getElementById('caja-sim').classList.remove('cerrada');
    if (!guionTimer) seguirGuion();
  } catch (e) { toast(e.message); }
};
document.getElementById('sim-dia-parar').onclick = async function () {
  try { await api('/admin/entregas/simulador/probar-dia', { method: 'DELETE' }); toast('Se detiene al terminar el paso actual.'); } catch (e) { toast(e.message); }
};
/* Si el dia de prueba ya corre (o acaba de terminar) y se abre Hoy de nuevo, se sigue desde donde va. */
api('/admin/entregas/simulador/probar-dia').then(function (g) {
  if (g && g.pasos && g.pasos.length) { pintarGuion(g); if (g.estado === 'corriendo' && !guionTimer) seguirGuion(); }
}).catch(function () {});
document.getElementById('sim-modo').onchange = async function () {
  try { await api('/admin/entregas/simulador/modo', { method: 'POST', body: { modo: this.value } }); toast('El simulador ahora: ' + this.options[this.selectedIndex].text); } catch (e) { toast(e.message); }
};
document.getElementById('sim-reiniciar').onclick = async function () {
  var si = await confirmarDialogo({ titulo: 'Reiniciar el simulador', texto: 'Se vacían sus listas y lo recibido. Las entregas ya creadas aquí no se tocan.', boton: 'Reiniciar', peligro: true });
  if (!si) return;
  try { await api('/admin/entregas/simulador', { method: 'DELETE' }); toast('Simulador vacío.'); await cargar(); } catch (e) { toast(e.message); }
};

document.getElementById('alguien').addEventListener('click', async function (ev) {
  var a = ev.target.closest('[data-ir-fila]');
  if (a) { ev.preventDefault(); abiertas[a.getAttribute('data-ir-fila')] = true; filtro = ''; document.getElementById('buscar').value = ''; pintarTarjetas(resumen.cifras); pintarFilas(); document.getElementById('detalle-' + a.getAttribute('data-ir-fila')).scrollIntoView({ block: 'center' }); return; }
  var b = ev.target.closest('button[data-sol-reintentar]');
  if (!b) return;
  try { await api('/admin/rutas/solicitudes/' + b.getAttribute('data-sol-reintentar') + '/reintentar', { method: 'POST', body: {} }); toast('Vuelve a la cola: se le pedirá la ubicación otra vez.'); await cargar(); } catch (e) { toast(e.message); }
});
document.getElementById('otros').addEventListener('click', async function (ev) {
  var b = ev.target.closest('button');
  if (!b) return;
  var clave;
  try {
    if ((clave = b.getAttribute('data-otro-pausar'))) await api('/admin/envio-automatico/' + encodeURIComponent(clave) + '/pausar', { method: 'POST', body: {} });
    else if ((clave = b.getAttribute('data-otro-reanudar'))) await api('/admin/envio-automatico/' + encodeURIComponent(clave) + '/reanudar', { method: 'POST', body: {} });
    else if ((clave = b.getAttribute('data-otro-quitar'))) {
      var si = await confirmarDialogo({ titulo: 'Dejar de escribirle', texto: 'Ya no se le pedirá la ubicación por su cuenta. Si es del reparto, pasa a una persona.', boton: 'Quitar', peligro: true });
      if (!si) return;
      await api('/admin/envio-automatico/' + encodeURIComponent(clave), { method: 'DELETE' });
    } else return;
    await cargar();
  } catch (e) { toast(e.message); }
});
document.getElementById('otros-nuevo').onclick = async function () {
  try {
    var telefono = await pedirDato({ titulo: 'Pedir la ubicación a un número', etiqueta: 'Teléfono', marcador: '987 654 321', boton: 'Siguiente' });
    if (!telefono) return;
    var nombre = await pedirDato({ titulo: 'Pedir la ubicación a un número', etiqueta: 'Nombre (opcional)', marcador: 'Juan Pérez', boton: 'Empezar a escribirle', validar: function () { return null; } });
    if (nombre === null) return;
    await api('/admin/envio-automatico', { method: 'POST', body: { telefonos: telefono, nombre: nombre || undefined, que: 'ubicacion', hasta: 'ubicacion' } });
    toast('Listo: se le pedirá la ubicación cada pocas horas hasta que la mande.');
    await cargar();
  } catch (e) { toast(e.message); }
};

document.getElementById('aj-guardar').onclick = async function () {
  var estado = document.getElementById('aj-estado');
  try {
    var textos = {};
    document.querySelectorAll('[data-texto]').forEach(function (t) { textos[t.getAttribute('data-texto')] = t.value; });
    await api('/admin/entregas/ajustes', { method: 'POST', body: {
      horarioEntregas: { desde: document.getElementById('aj-hor-desde').value || '14:00', hasta: document.getElementById('aj-hor-hasta').value || '20:00', extendidoHasta: document.getElementById('aj-hor-ext').value || '22:00' },
      soporte: { whatsapp: document.getElementById('aj-sop-wa').value.replace(/\D/g, ''), llamadas: document.getElementById('aj-sop-tel').value.replace(/\D/g, '') },
      margenMinutos: Number(document.getElementById('aj-margen').value),
      confirmacionEsperaMin: Number(document.getElementById('aj-conf-espera').value),
      confirmacionMaxIntentos: Number(document.getElementById('aj-conf-max').value),
      motorizadoEsperaMin: Number(document.getElementById('aj-mot-espera').value),
      motorizadoMaxIntentos: Number(document.getElementById('aj-mot-max').value),
      sincronizarCadaMin: Number(document.getElementById('aj-sync').value),
      leerConIA: document.getElementById('aj-leer-ia').checked,
      redactarConIA: document.getElementById('aj-redactar-ia').checked,
      mandarPinAlMotorizado: document.getElementById('aj-pin').checked,
      avisarEntregado: document.getElementById('aj-avisar-entregado').checked,
      responderDondeEsta: document.getElementById('aj-donde-esta').checked,
      cierreDelDia: { activo: document.getElementById('aj-cierre-activo').checked, hora: Number(String(document.getElementById('aj-cierre-hora').value || '0').split(':')[0]) || 0 },
      usarBotones: document.getElementById('aj-botones').checked,
      avisarCerca: document.getElementById('aj-cerca').checked,
      segundaVisita: { activa: document.getElementById('aj-sv-activa').checked, esperaMin: Number(document.getElementById('aj-sv-espera').value) || 30 },
      clienteRecurrente: { activo: document.getElementById('aj-rec-activo').checked, diasMaximo: Number(document.getElementById('aj-rec-dias').value) || 60, esperaMin: Number(document.getElementById('aj-rec-espera').value) || 60 },
      plantillas: { confirmacion: document.getElementById('aj-pl-confirmacion').value.trim(), motorizado: document.getElementById('aj-pl-motorizado').value.trim(), aviso: document.getElementById('aj-pl-aviso').value.trim() },
      textos: textos
    } });
    estado.textContent = 'Guardado.';
    await cargar();
  } catch (e) { estado.textContent = e.message; }
};
document.querySelector('#caja-ajustes > h2').onclick = function () { document.getElementById('caja-ajustes').classList.toggle('cerrada'); };
document.getElementById('tira-resumen').onclick = function () {
  var abierta = document.getElementById('tira').classList.toggle('abierta');
  this.setAttribute('aria-expanded', abierta ? 'true' : 'false');
};
/* las cifras tambien se abren con el teclado */
document.getElementById('tarjetas').addEventListener('keydown', function (ev) {
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList.contains('tarjeta')) { ev.preventDefault(); ev.target.click(); }
});
document.querySelector('#caja-sim > h2').onclick = function () { document.getElementById('caja-sim').classList.toggle('cerrada'); };

document.addEventListener('ia:cambio', function () { cargar().catch(function () {}); });
setInterval(function () {
  var activo = document.activeElement;
  if (activo && (activo.tagName === 'INPUT' || activo.tagName === 'TEXTAREA')) return;
  if (document.querySelector('.dlg-fondo')) return;
  cargar().catch(function (e) { toast(e.message); });
}, 10000);
cargar().catch(function (e) { toast(e.message); });
`;

  return appShell({
    titulo: 'Hoy',
    subtitulo: 'Los pedidos de hoy: ubicación, confirmación, motorizado y hora de llegada; y quién necesita a alguien',
    contenido,
    script,
    css: CSS + DIALOGO_ELEGIR_CSS,
    nombreNegocio: opts.nombreNegocio,
    demo,
    icono: '🛵',
  });
}
