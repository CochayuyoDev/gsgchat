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
 *
 * Los cuadros `elegirOpcion` y `pedirVarios` (CSS y JS) ya los pega el
 * armazon en todas las paginas: aqui no se vuelven a incluir.
 */

import { appShell } from './shell.js';
import { estadosVisualesJs } from './estados-visuales.js';

const CSS = `
  /* Hoy usa la paleta y la escala del armazon (--superficie, --texto, --verde...)
     y sus clases compartidas (.btn, .tarjeta, .chip, .vacio): aqui solo va lo
     que es propio de esta pantalla. */
  * { box-sizing: border-box; }
  .wrap { color: var(--texto); font: var(--fs-cuerpo)/1.5 var(--fuente); }
  .wrap a { color: var(--primario); }
  .muted { color: var(--texto-suave); }
  .hidden { display: none !important; }
  .aviso { background: var(--ambar-suave); border: 1px solid var(--ambar); border-radius: var(--radio); padding: 12px 14px; margin-bottom: var(--esp-3); font-size: var(--fs-cuerpo); }
  .aviso b { color: var(--ambar); }
  .aviso.malo { background: var(--rojo-suave); border-color: var(--rojo); }
  .aviso.malo b { color: var(--rojo); }

  /* Los botones los da .btn del armazon; aqui solo los campos. */
  select, input, textarea { font: inherit; color: var(--texto); background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio-sm); padding: 8px 11px; width: 100%; }
  textarea { min-height: 70px; resize: vertical; }
  label { display: block; font-size: var(--fs-small); color: var(--texto-suave); margin: 10px 0 4px; }
  label.linea { display: flex; align-items: flex-start; gap: 8px; margin: 8px 0; color: var(--texto); font-size: var(--fs-cuerpo); cursor: pointer; line-height: 1.4; }
  label.linea input { width: 18px; height: 18px; margin: 1px 0 0; flex: none; accent-color: var(--primario); }

  /* --- la tira de estado: WhatsApp, GSG, motorizados, cierre --------------- */
  .estado-tira { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: var(--esp-3); margin-bottom: var(--esp-3); align-items: start; }
  .estado-tira .semaforo { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); padding: 12px 14px; font-size: 13.5px; box-shadow: var(--sombra); display: flex; flex-direction: column; gap: 6px; }
  .estado-tira .semaforo b { display: block; font-size: 11.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--texto-suave); }
  .punto { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: var(--gris); margin-right: 6px; vertical-align: middle; flex: none; }
  .punto.ok { background: var(--verde); } .punto.warn { background: var(--ambar); } .punto.bad { background: var(--rojo); } .punto.info { background: var(--azul); }

  /* --- las cifras del dia: tarjetas del armazon que ademas filtran --------- */
  .tarjetas { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--esp-2); margin-bottom: var(--esp-3); }
  .cifra { padding: 10px 12px; min-height: 62px; cursor: pointer; transition: border-color .12s, box-shadow .12s; }
  .cifra:hover { border-color: var(--primario); }
  .cifra[aria-pressed="true"] { border-color: var(--primario); box-shadow: 0 0 0 2px var(--primario-suave); background: var(--primario-suave); }
  .cifra .n { font-size: 22px; font-weight: 800; line-height: 1.1; letter-spacing: -.01em; }
  .cifra .q { font-size: var(--fs-small); color: var(--texto-suave); margin-top: 2px; line-height: 1.3; }
  .cifra.ok .n { color: var(--verde); } .cifra.warn .n { color: var(--ambar); } .cifra.bad .n { color: var(--rojo); } .cifra.info .n { color: var(--azul); }
  .mas-cifras { grid-column: 1 / -1; min-width: 0; }
  .mas-cifras > summary { color: var(--texto-suave); font-size: 13px; cursor: pointer; padding: 4px 2px; }
  .mas-cifras .tarjetas { margin: 8px 0 0; }

  .explica { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); padding: 12px 16px; margin-bottom: var(--esp-3); }
  .explica > summary { color: var(--texto-suave); font-size: 13.5px; cursor: pointer; }
  .explica .texto { margin-top: 8px; }
  .explica .texto p { margin: 0 0 6px; }
  .explica .pasos { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
  .explica .paso { background: var(--superficie-2); border-radius: 999px; padding: 3px 10px; font-size: var(--fs-small); }

  /* --- las dos columnas: la tabla y lo de al lado -------------------------- */
  .cols { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: var(--esp-3); align-items: start; }
  /* Sin sitio para dos columnas: la tabla a lo ancho y, debajo, "Necesitan a alguien" y "Otros" lado a lado; lo secundario al final. */
  @media (max-width: 1500px) {
    .wrap { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0 var(--esp-3); align-items: start; }
    .wrap > *, .cols .caja { grid-column: 1 / -1; }
    .cols, .cols > div { display: contents; }
    .wrap > .aviso, .wrap > .cartel-prueba { order: 0; }
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
  /* Lo secundario del titulo (la fecha, el recuento, la ayuda) va pequeño y sin negrita. */
  .caja > h2 .muted { font-weight: 400; font-size: var(--fs-small); }
  .caja .cuerpo { padding: 14px; }
  .caja.plegable > h2 { cursor: pointer; }
  .caja.plegable > h2::after { content: ''; width: 8px; height: 8px; border-right: 2px solid var(--texto-suave); border-bottom: 2px solid var(--texto-suave); transform: rotate(45deg); margin: 0 4px 4px 2px; transition: transform .15s; }
  .caja.plegable.cerrada > h2::after { transform: rotate(-45deg); margin-bottom: 0; }
  .caja.plegable.cerrada .cuerpo { display: none; }

  /* --- la tabla de pedidos ------------------------------------------------- */
  .tabla-scroll { overflow: auto; max-height: 70vh; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .tabla-scroll table { min-width: 980px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--borde); vertical-align: top; }
  th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--texto-suave); font-weight: 700; position: sticky; top: 0; background: var(--superficie); z-index: 1; }
  tr:last-child td { border-bottom: 0; }
  #filas > tr:hover > td { background: var(--superficie-2); }
  #filas > tr > td:first-child { min-width: 230px; }
  #filas > tr > td:last-child { min-width: 250px; }
  td .sub { color: var(--texto-suave); font-size: var(--fs-small); margin-top: 3px; line-height: 1.35; }
  .chip + .sub, .chip + div.sub { margin-top: 4px; }
  /* El nombre manda; justo debajo, en que paso va; al final, sus datos. */
  .quien { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 14px; }
  .en-que-va { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 5px 0 2px; }
  .en-que-va .sub { margin: 0; }
  .telefono { white-space: nowrap; }
  .acciones { display: flex; gap: 4px; flex-wrap: wrap; }
  .acciones-detalle { display: flex; gap: 6px; flex-wrap: wrap; margin: 0 0 10px; }
  .situacion-larga { font-size: 13.5px; margin: 0 0 10px; padding: 8px 10px; background: var(--superficie); border-radius: var(--radio-sm); border: 1px solid var(--borde); }
  tr.fila-urgente > td:first-child { box-shadow: inset 3px 0 0 var(--rojo); }
  .fila-detalle td { background: var(--superficie-2); }
  .toast { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); background: var(--texto); color: var(--bg); padding: 10px 16px; border-radius: var(--radio-sm); font-size: 14px; z-index: 50; max-width: 90vw; box-shadow: var(--sombra-2); }

  /* Una linea de bitacora: lo ultimo que paso y los casos de "necesitan a alguien". */
  .mov { display: flex; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--borde); font-size: 13.5px; }
  .mov:last-child { border-bottom: 0; }
  .mov .hora { color: var(--texto-suave); min-width: 44px; font-size: var(--fs-small); font-variant-numeric: tabular-nums; }
  .mov .que { flex: 1; line-height: 1.45; }
  .mov .que b { font-weight: 600; }
  .mov-acciones { margin-top: 6px; }
  /* "Aqui no hay nada", en corto: vale dentro de una caja y como celda de tabla. */
  .nada { color: var(--texto-suave); font-size: 13.5px; text-align: center; padding: 14px 8px; }
  .celda-ancha { padding: 14px; }
  .bitacora { max-height: 40vh; overflow: auto; }

  /* --- el simulador -------------------------------------------------------- */
  .sim-lista { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px; }
  @media (max-width: 700px) { .sim-lista { grid-template-columns: 1fr; } }
  .sim-lista .col { background: var(--superficie-2); border-radius: var(--radio-sm); padding: 8px 10px; font-size: var(--fs-small); min-height: 60px; }
  .sim-lista .col b { display: block; margin-bottom: 4px; }
  .sim-lista .col div { padding: 2px 0; }
  .sim-grupo { margin-top: 10px; }
  .sim-grupo > b { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--texto-suave); margin-bottom: 6px; }
  .sim-grupo .fila { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .sim-pasos { margin: 8px 0 0; padding-left: 30px; font-size: 13px; max-height: 280px; overflow: auto; }
  .sim-pasos li { margin: 3px 0; }
  .sim-pasos li b { display: inline-block; width: 14px; }
  .sim-pasos .paso-hecho b { color: var(--verde); }
  .sim-pasos .paso-fallo b { color: var(--rojo); }
  .sim-pasos .paso-haciendo b { color: var(--ambar); }
  .sim-pasos .paso-saltado b { color: var(--texto-suave); }

  /* --- los ajustes --------------------------------------------------------- */
  .ajuste-fila { display: grid; grid-template-columns: 1fr 120px; gap: 10px; align-items: center; margin: 6px 0; font-size: var(--fs-cuerpo); }
  .ajuste-fila.ancha { grid-template-columns: 1fr 220px; }
  .grupos-aj { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  @media (max-width: 1100px) { .grupos-aj { grid-template-columns: 1fr; } }
  .grupo-aj { border: 1px solid var(--borde); border-radius: var(--radio); background: var(--superficie); padding: 12px 14px; min-width: 0; }
  .grupo-aj.ancho { margin-top: 12px; }
  .grupo-aj h3 { margin: 0 0 2px; font-size: 14px; font-weight: 700; }
  .grupo-aj .ayuda-grupo { margin: 0 0 8px; color: var(--texto-suave); font-size: 12.5px; line-height: 1.4; }
  .grupo-aj > summary { cursor: pointer; font-size: 14px; font-weight: 700; padding: 2px 0; }
  .grupo-aj > summary .muted { font-weight: 400; font-size: 12.5px; }
  .textos-para { margin: 14px 0 0; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--texto-suave); }
  .texto-editable { margin-top: 10px; }
  .guardar-aj { margin-top: 10px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .previa { margin-top: 4px; font-size: var(--fs-small); }
  .previa a { cursor: pointer; }
  .previa .resultado { display: block; margin-top: 4px; padding: 6px 8px; background: var(--superficie-2); border-radius: var(--radio-sm); color: var(--texto-suave); white-space: pre-wrap; }

  /* --- pegar la lista del dia y el modo prueba ----------------------------- */
  .cartel-prueba { background: var(--azul-suave); border: 1px solid var(--azul); border-radius: var(--radio); padding: 10px 14px; margin-bottom: var(--esp-3); font-size: var(--fs-cuerpo); display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .cartel-prueba b { color: var(--azul); }
  .cartel-prueba .sep { flex: 1; }
  #caja-pegar { padding: 0 14px 12px; }
  #caja-pegar textarea { min-height: 120px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; }
  #caja-pegar .opciones { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; margin: 8px 0; }
  .marcas { display: flex; gap: 14px; flex-wrap: wrap; }
  .marcas label { display: inline-flex; align-items: center; gap: 6px; margin: 0; color: var(--texto); font-size: 13.5px; cursor: pointer; }
  .marcas input { width: 16px; height: 16px; accent-color: var(--primario); }
  #pegar-previa { min-height: 20px; margin: 6px 0; font-size: 13px; }
  .gsg-cola { margin-top: 2px; font-size: var(--fs-small); }
  .gsg-cola.mal { color: var(--rojo); }
  #buscar { width: 240px; }

  .tira-resumen { display: none; }

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
    .tira-resumen { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; text-align: left; margin: 0 0 var(--esp-2); font-weight: 500; font-size: 13.5px; }
    .tira-resumen::after { content: ''; width: 8px; height: 8px; border-right: 2px solid var(--texto-suave); border-bottom: 2px solid var(--texto-suave); transform: rotate(45deg); flex: none; margin: 0 4px 4px; }
    .tira-resumen[aria-expanded="true"]::after { transform: rotate(-135deg); margin: 4px 4px 0; }
    #tira { display: none; }
    #tira.abierta { display: grid; }
    .estado-tira { grid-template-columns: 1fr; gap: var(--esp-2); }
    .estado-tira .semaforo { padding: 10px 12px; }
    #tarjetas { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; min-width: 0; max-width: 100%; }
    .mas-cifras .tarjetas { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
    .acciones .btn { flex: 1 1 auto; }
    .cifra { padding: 8px 10px; min-height: 0; }
    .cifra .n { font-size: 19px; }
    .cifra .q { font-size: 11.5px; }
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
    #filas > tr > td:first-child { padding-bottom: 6px; border-bottom: 1px solid var(--borde); margin-bottom: 4px; }
    #filas > tr > td:nth-child(2)::before, #filas > tr > td:nth-child(3)::before, #filas > tr > td:nth-child(4)::before, #filas > tr > td:nth-child(5)::before { display: inline-block; min-width: 96px; font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--texto-suave); font-weight: 700; vertical-align: top; margin-top: 2px; }
    #filas > tr > td:nth-child(2)::before { content: 'Ubicación'; }
    #filas > tr > td:nth-child(3)::before { content: 'Confirmación'; }
    #filas > tr > td:nth-child(4)::before { content: 'Motorizado'; }
    #filas > tr > td:nth-child(5)::before { content: 'Llega'; }
    #filas > tr > td:last-child { padding-top: 8px; }
    #filas > tr.fila-detalle { padding: 8px 12px; background: var(--superficie-2); margin-top: -6px; }
    #filas > tr.fila-detalle > td { padding: 0; border: 0; }
    td.nada, td.celda-ancha { padding: 12px; }
    .ajuste-fila, .ajuste-fila.ancha { grid-template-columns: 1fr 96px; }
  }
`;

export function entregasPage(opts: { disponible: boolean; configured: boolean; demo: boolean; nombreNegocio: string }): string {
  const { configured, demo } = opts;
  const aviso = !opts.disponible
    ? `<div class="aviso malo"><b>Las entregas del día no están disponibles en este arranque.</b> Arranca el sistema con <code>npm run quick</code> o <code>npm run dev</code>.</div>`
    : configured
      ? ''
      : `<div class="aviso"><b>Falta conectar WhatsApp.</b> Las entregas se pueden preparar y sincronizar con GSG, pero no saldrá ningún mensaje hasta conectar el número en <a href="/setup">Conexión de WhatsApp</a>.</div>`;

  const contenido = `
<div class="wrap">
${demo ? '<div class="aviso">Demostración: <b>nada sale a WhatsApp de verdad.</b></div>' : ''}
${aviso}
<div class="aviso malo hidden" id="error-carga" role="alert"></div>
<div class="cartel-prueba hidden" id="cartel-prueba"><b>EN MODO PRUEBA</b><span id="cartel-prueba-texto"></span><span class="sep"></span><button class="btn sm" id="modo-prueba-quitar" type="button">Salir del modo prueba</button><a href="/panel#configuracion" class="btn sm">Ajustes</a></div>

<button type="button" class="btn tira-resumen" id="tira-resumen" aria-expanded="false" aria-controls="tira">Estado del sistema…</button>
<div class="estado-tira" id="tira">
  <div class="semaforo"><b>WhatsApp</b><div id="wa-estado"><span class="punto"></span>Cargando…</div></div>
  <div class="semaforo"><b>GSG</b>
    <div id="gsg-estado"><span class="punto"></span>Cargando…</div>
    <div class="acciones">
      <button class="btn primario sm" id="sincronizar" type="button">Traer los pendientes de GSG</button>
      <button class="btn sm" id="gsg-probar" type="button">Probar</button>
      <button class="btn sm" id="gsg-configurar" type="button">Cambiar</button>
    </div>
    <div class="muted" id="gsg-ultima" style="font-size:12.5px"></div>
    <div class="gsg-cola hidden" id="gsg-cola"></div>
  </div>
  <div class="semaforo"><b>Motorizados</b><div id="mot-estado"><span class="punto"></span>Cargando…</div><div class="acciones"><a href="/motorizados" class="btn sm">Ver motorizados</a><a href="/mapa" class="btn sm">Ver en el mapa</a></div></div>
  <div class="semaforo"><b>Cierre del día</b><div id="cierre-estado"><span class="punto"></span>Cargando…</div><div class="acciones"><button class="btn sm hidden" id="cerrar-dia" type="button">Cerrar el día de ayer ahora</button></div></div>
</div>

<div class="tarjetas" id="tarjetas"></div>

<details class="explica" id="como-funciona">
  <summary>¿Cómo funciona? Los seis pasos de cada pedido</summary>
  <div class="texto">
    <div class="pasos"><span class="paso">1 · Ubicación</span><span class="paso">2 · Confirmación</span><span class="paso">3 · Motorizado</span><span class="paso">4 · Hora de llegada al cliente</span><span class="paso">5 · Terminada en GSG</span><span class="paso">6 · Entregado</span></div>
    <p>Cada pedido necesita tres cosas por separado: el cliente manda su <b>ubicación</b>, el cliente <b>confirma</b> que lo recibe hoy y un <b>motorizado</b> recibe el pin y dice en cuántos minutos entrega. A esos minutos se les suma el margen y al cliente se le avisa a qué hora le llega. Quién tiene cada cosa lo dice <b>GSG</b>, al que se le pregunta cada pocos minutos; lo que no se entiende lo lee la IA.</p>
    <p>Cuando el motorizado escribe <b>«entregado»</b> (o manda la foto), GSG recibe la hora y al cliente se le da las gracias. Si escribe <b>«no había nadie»</b>, al cliente se le pregunta si volvemos hoy (<b>segunda visita</b>, con botones SÍ / NO); si escribe <b>«cerca»</b>, al cliente se le avisa; si escribe <b>«me quedo sin moto»</b>, sus pedidos pasan a otros. Los <b>urgentes</b> salen primero y lo que necesita a una persona aparece en «Necesitan a alguien».</p>
  </div>
</details>

<div class="cols">
  <div>
    <div class="caja" id="caja-pedidos">
      <h2>Pedidos de hoy <span id="dia" class="muted"></span><span class="sep"></span><input id="buscar" placeholder="Buscar por nombre, pedido o número" aria-label="Buscar por nombre, pedido o número"><button class="btn sm" id="nueva" type="button">+ Pedido a mano</button><button class="btn sm" id="pegar-abrir" type="button" aria-expanded="false" aria-controls="caja-pegar">Pegar la lista del día</button></h2>
      <div id="caja-pegar" class="hidden">
        <p class="muted" style="margin:0 0 6px;font-size:13.5px">Pega la lista tal cual sale de Excel (o CSV, o una línea por cliente): <b>teléfono, nombre, pedido, dirección, distrito</b>. Con cabecera se entiende cualquier orden; si además hay columnas <b>ubicación</b> y <b>confirmar</b> con sí/no, mandan sobre las casillas de abajo.</p>
        <textarea id="pegar-texto" aria-label="La lista del día" placeholder="987654321, Juan Pérez, P-3001, Av. Larco 345, Miraflores&#10;987654322, María Torres, P-3002, Jr. Monterrey 120, Surco&#10;(una línea por cliente)"></textarea>
        <div class="muted" id="pegar-previa" aria-live="polite"></div>
        <div class="opciones marcas">
          <label><input type="checkbox" id="pegar-ubicacion" checked> Pedir ubicación a todos</label>
          <label><input type="checkbox" id="pegar-confirmacion" checked> Pedir confirmación a todos</label>
        </div>
        <div class="marcas" id="pegar-destino">
          <label><input type="radio" name="pegar-destino" value="sistema" checked> Clientes de verdad: se les empieza a escribir</label>
          <label id="pegar-destino-sim" class="hidden"><input type="radio" name="pegar-destino" value="simulador"> Solo probar (nadie recibe nada)</label>
        </div>
        <div class="opciones">
          <button class="btn primario sm" id="pegar-cargar" type="button">Cargar la lista</button>
          <button class="btn sm" id="pegar-cerrar" type="button">Cerrar</button>
        </div>
        <div class="muted" id="pegar-resultado" style="font-size:13px" aria-live="polite"></div>
      </div>
      <div class="tabla-scroll">
        <table>
          <thead><tr><th>Cliente · pedido</th><th>Ubicación</th><th>Confirmación</th><th>Motorizado</th><th>Llega</th><th aria-label="Acciones"></th></tr></thead>
          <tbody id="filas"><tr><td colspan="6" class="nada">Cargando…</td></tr></tbody>
        </table>
      </div>
    </div>

    <div class="caja plegable cerrada" id="caja-sim">
      <h2>Probar con números ficticios<span class="sep"></span><span class="muted" id="sim-resumen"></span></h2>
      <div class="cuerpo">
        <p class="muted" style="margin:0 0 8px;font-size:13.5px">El "otro sistema" de mentira: <b>10 clientes</b> (987 000 001 a 010) y <b>10 motorizados</b> (999 000 001 a 010) ficticios, sin tocar a nadie de verdad. Sus respuestas se simulan desde <a href="/panel#enviar">Enviar mensaje → simular entrante</a>.</p>
        <div class="sim-grupo"><b>Probar con clientes ficticios</b>
          <div class="fila">
            <button class="btn primario sm" id="sim-usar" type="button">Usar el simulador como GSG</button>
            <button class="btn sm" id="sim-cargar" type="button">Cargar 10 clientes de prueba</button>
            <button class="btn sm" id="mot-cargar" type="button">Cargar 10 motorizados de prueba</button>
            <button class="btn peligro sm" id="sim-reiniciar" type="button">Reiniciar simulador</button>
          </div>
        </div>
        <div class="sim-grupo"><b>Probar el día entero, solo</b>
          <div class="fila">
            <button class="btn primario sm" id="sim-dia" type="button">Probar el día entero con datos ficticios</button>
            <button class="btn peligro sm hidden" id="sim-dia-parar" type="button">Detener</button>
            <span class="muted" style="font-size:12.5px">Carga los datos de prueba y simula las respuestas de todos, paso a paso, de punta a punta.</span>
          </div>
          <ol class="sim-pasos hidden" id="sim-dia-pasos"></ol>
          <p class="muted hidden" id="sim-dia-resumen" style="font-size:13px;margin:6px 0 0"></p>
        </div>
        <div class="sim-grupo"><b>Probar con mi número</b>
          <div class="fila">
            <button class="btn sm" id="modo-prueba" type="button">Modo prueba con mi número</button>
            <span class="muted" style="font-size:12.5px">Solo se le escribe a tu número; a los demás no les llega nada.</span>
          </div>
        </div>
        <div class="sim-grupo"><b>Simular que GSG…</b>
          <div class="fila">
            <select id="sim-modo" style="width:auto" aria-label="Cómo responde el simulador de GSG"><option value="ok">responde bien</option><option value="caido">está caído</option><option value="rechaza">rechaza lo que mandamos</option></select>
          </div>
        </div>
        <div class="sim-lista" id="sim-listas"></div>
      </div>
    </div>

    <div class="caja" id="caja-eventos">
      <h2>Lo último que pasó</h2>
      <div class="cuerpo bitacora" id="eventos"><div class="nada">Cargando…</div></div>
    </div>
  </div>

  <div>
    <div class="caja" id="caja-alguien">
      <h2>Necesitan a alguien <span class="sep"></span><span class="muted" id="alguien-n"></span></h2>
      <div class="cuerpo" id="alguien" style="padding:8px 14px"><div class="nada">Cargando…</div></div>
    </div>

    <div class="caja" id="caja-otros">
      <h2>Otros clientes a los que se escribe solo <span class="sep"></span><span class="muted" id="otros-n"></span></h2>
      <div class="cuerpo" style="padding:0">
        <p class="muted" style="margin:0;padding:8px 14px;font-size:12.5px">Del reparto sin pedido de hoy en GSG, y números puestos a mano: se les pide la ubicación cada pocas horas hasta que la manden.</p>
        <table>
          <thead><tr><th>Quién</th><th>Situación</th><th aria-label="Acciones"></th></tr></thead>
          <tbody id="otros"><tr><td colspan="3" class="nada">Cargando…</td></tr></tbody>
        </table>
        <div style="padding:8px 14px"><button class="btn sm" id="otros-nuevo" type="button">+ Pedir la ubicación a un número</button></div>
      </div>
    </div>

    <div class="caja plegable cerrada" id="caja-ajustes">
      <h2>Ajustes de las entregas <span class="sep"></span><span class="muted">tiempos, qué hace solo, textos</span></h2>
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
            <label class="linea"><input type="checkbox" id="aj-sv-activa"> Preguntarle al cliente si volvemos hoy</label>
            <div class="ajuste-fila"><span>Esperar su respuesta (minutos); después pasa a una persona</span><input id="aj-sv-espera" type="number" min="5" max="1440"></div>
          </section>
          <section class="grupo-aj"><h3>Cliente recurrente</h3><p class="ayuda-grupo">Si ya mandó su ubicación hace poco, se le propone en vez de pedirle el pin otra vez.</p>
            <label class="linea"><input type="checkbox" id="aj-rec-activo"> Proponerle la dirección que ya usó</label>
            <div class="ajuste-fila"><span>Vale si su última ubicación tiene menos de (días)</span><input id="aj-rec-dias" type="number" min="1" max="365"></div>
            <div class="ajuste-fila"><span>Si no contesta en (minutos), se le pide el pin como siempre</span><input id="aj-rec-espera" type="number" min="5" max="1440"></div>
          </section>
          <section class="grupo-aj"><h3>Cierre del día</h3><p class="ayuda-grupo">Lo que quedó de ayer sin terminar pasa a "necesita una persona" y lo avisado se da por entregado, para que Hoy arranque limpio.</p>
            <label class="linea"><input type="checkbox" id="aj-cierre-activo"> Cerrar el día solo</label>
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
          <p class="ayuda-grupo">Meta solo deja escribir libremente durante 24 h desde el último mensaje del cliente; pasado eso hace falta una plantilla aprobada (<a href="/panel#plantillas">Mensajes aprobados</a>). Sin ella, la entrega se aparta y se avisa. Variables en orden: confirmación {{1}} nombre, {{2}} pedido, {{3}} negocio · motorizado {{1}} cliente, {{2}} pedido, {{3}} enlace del mapa · aviso {{1}} nombre, {{2}} pedido, {{3}} hora.</p>
          <datalist id="aj-plantillas-lista"></datalist>
          <div class="ajuste-fila ancha"><span>Pedir confirmación</span><input id="aj-pl-confirmacion" list="aj-plantillas-lista" placeholder="nombre de la plantilla"></div>
          <div class="ajuste-fila ancha"><span>Al motorizado (pin y pregunta)</span><input id="aj-pl-motorizado" list="aj-plantillas-lista" placeholder="nombre de la plantilla"></div>
          <div class="ajuste-fila ancha"><span>Aviso de llegada al cliente</span><input id="aj-pl-aviso" list="aj-plantillas-lista" placeholder="nombre de la plantilla"></div>
        </div>
        <details class="grupo-aj ancho"><summary>Textos que se mandan <span class="muted">(vacío = el de siempre)</span></summary><div id="aj-textos"></div></details>
        <div class="guardar-aj"><button class="btn primario" id="aj-guardar" type="button">Guardar ajustes</button><span class="muted" id="aj-estado" aria-live="polite"></span></div>
      </div>
    </div>
  </div>
</div>
</div>
`;

  const script = String.raw`
${estadosVisualesJs()}
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
function $(id) { return document.getElementById(id); }
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
/* "1 pedido" / "3 pedidos": el singular se escribia a mano en diez sitios. */
function plural(n, una, varias) { return n + ' ' + (n === 1 ? una : varias); }
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
/* La ficha ya pintada de cada fila abierta: al buscar o al filtrar se repinta
   la tabla muchas veces y no tiene sentido volver a pedirsela al servidor. */
var detalles = {};

var NOMBRE_INCIDENCIA = {
  no_entregado: 'no se pudo entregar', reprogramar: 'el cliente pide otro día', no_llego: 'el cliente dice que no le llegó', dia_cerrado: 'quedó de ayer', sin_confirmacion: 'no confirmó', sin_motorizado: 'sin motorizado',
  sin_pin: 'sin coordenadas', sin_plantilla: 'falta la plantilla', error_envio: 'WhatsApp rechazó el envío', cambio: 'pide un cambio', aviso_no_enviado: 'el aviso no salió', rechaza_contacto: 'se dio de baja', sin_ubicacion: 'sin ubicación'
};

/* ---------------------------------------------------- los chips de cada paso
   Mismo tono que en el resto del sistema: verde hecho, ambar esperando,
   rojo mal, azul en marcha, gris sin mas. */
function chipPaso(tono, html) { return '<span class="chip tono-' + tono + '">' + html + '</span>'; }
function raya() { return '<span class="muted">—</span>'; }

function chipUbicacion(e) {
  if (e.ubicacionEstado === 'recibida') return chipPaso('verde', e.mapsUrl ? '<a href="' + esc(e.mapsUrl) + '" target="_blank" rel="noopener" style="color:inherit">pin recibido</a>' : 'pin recibido');
  if (e.ubicacionEstado === 'no_hace_falta') return chipPaso('gris', 'GSG la tiene');
  var s = e.solicitud;
  if (!s) return chipPaso('ambar', 'por pedir');
  if (s.estado === 'pendiente') return chipPaso('ambar', 'en cola del reparto');
  if (s.estado === 'enviado') return chipPaso('ambar', 'pedida (' + s.intentos + ')');
  if (s.estado === 'respondio') return chipPaso('ambar', 'contestó otra cosa');
  return chipPaso('ambar', esc(s.estado));
}

var COMO_CONFIRMO = { ia: 'confirmó (IA)', persona: 'a mano', boton: 'confirmó (botón)' };
function chipConfirmacion(e) {
  if (e.confirmacionEstado === 'confirmada') return chipPaso('verde', esc(COMO_CONFIRMO[e.confirmacionComo] || 'confirmó'));
  if (e.confirmacionEstado === 'rechazada') return chipPaso('rojo', 'no la quiso');
  if (e.confirmacionEstado === 'no_hace_falta') return chipPaso('gris', 'ya confirmada');
  if (e.confirmacionEstado === 'pedida') return chipPaso('ambar', 'pedida (' + e.confirmacionIntentos + ')');
  return chipPaso('ambar', 'por pedir');
}

function chipMotorizado(e) {
  if (!e.motorizado) return e.estado === 'lista' ? chipPaso('azul', 'buscando…') : raya();
  var quien = esc(e.motorizado.nombre) + (e.motorizado.placa ? ' <span class="sub" style="display:inline;margin:0">' + esc(e.motorizado.placa) + '</span>' : '');
  /* El tono sale del catalogo compartido: asi "sin respuesta" se ve igual de
     mal aqui que en Motorizados y en el mapa (antes salia en gris). */
  var v = (ESTADOS_VISUALES.motorizado || {})[e.motorizadoEstado] || { tono: 'gris' };
  var detalle = e.motorizadoEstado === 'respondio' ? (minutosTexto(e.minutosMotorizado) ? 'dijo ' + minutosTexto(e.minutosMotorizado) : 'aceptó')
    : e.motorizadoEstado === 'enviado' ? 'pin enviado ' + hora(e.motorizadoEnviadoAt)
    : e.motorizadoEstado === 'sin_respuesta' ? 'no contestó al pin'
    : '';
  return chipPaso(v.tono, quien) + (detalle ? '<div class="sub">' + esc(detalle) + '</div>' : '');
}

var COMO_ENTREGO = { foto: 'con foto', persona: 'a mano', cierre: 'por el cierre del día', ia: 'lo dijo (IA)' };
function chipLlega(e) {
  if (e.estado === 'entregada') {
    var como = COMO_ENTREGO[e.entregadaComo] || 'lo dijo';
    return chipPaso('verde', 'entregado ' + (e.entregadaAt ? hora(e.entregadaAt) : '')) + '<div class="sub">' + como + (e.llegaAproxAt ? ' · se avisó ' + hora(e.llegaAproxAt) : '') + '</div>';
  }
  if (!e.llegaAproxAt) return raya();
  return '<b>' + hora(e.llegaAproxAt) + '</b><div class="sub">' + minutosTexto(e.minutosAviso) + (e.avisoEnviadoAt ? ' · avisado' : ' · sin avisar') + '</div>';
}

/* --------------------------------------------------------------- acciones
   Una sola lista: el nombre largo se usa en la ficha que abre «Ver» y el
   corto en la fila. Antes habia dos listas paralelas que se iban separando. */
var ACCIONES = [
  { clave: 'confirmar', attr: 'confirmar', largo: 'Confirmar a mano', corto: 'Confirmar' },
  { clave: 'no_confirmar', attr: 'no-confirmar', largo: 'El cliente no lo quiere' },
  { clave: 'poner_ubicacion', attr: 'ubicacion', largo: 'Poner el pin a mano', corto: 'Poner pin' },
  { clave: 'marcar_entregada', attr: 'entregada', largo: 'Marcar entregada', corto: 'Entregada' },
  { clave: 'segunda_visita', attr: 'segunda', largo: 'Segunda visita', corto: 'Segunda visita' },
  { clave: 'reintentar', attr: 'reintentar', largo: 'Reintentar', corto: 'Reintentar' },
  { clave: 'reasignar', attr: 'reasignar', largo: 'Pasar a otro motorizado' },
  { clave: 'prioridad', attr: 'prioridad', largo: function (e) { return e.prioridad === 'urgente' ? 'Quitar urgente' : 'Marcar urgente'; } },
  { clave: 'cancelar', attr: 'cancelar', largo: 'Cancelar el pedido', peligro: true }
];
/* En la fila caben pocas: estas son las que tocan hacer ahora, por orden. */
var ACCIONES_EN_FILA = ['confirmar', 'marcar_entregada', 'segunda_visita', 'reintentar'];

function accion(clave) { return ACCIONES.filter(function (a) { return a.clave === clave; })[0]; }
function botonAccion(e, a, corta) {
  var texto = corta && a.corto ? a.corto : (typeof a.largo === 'function' ? a.largo(e) : a.largo);
  var extra = a.clave === 'prioridad' ? ' data-urgente="' + (e.prioridad === 'urgente' ? '0' : '1') + '"' : '';
  return '<button class="btn sm' + (a.peligro ? ' peligro' : '') + '" data-' + a.attr + '="' + e.id + '"' + extra + ' type="button">' + texto + '</button>';
}
/** Todas las que se pueden hacer, con su nombre completo: van en la ficha. */
function botonesDeFicha(e) {
  return ACCIONES.filter(function (a) { return e.acciones.indexOf(a.clave) >= 0; }).map(function (a) { return botonAccion(e, a, false); });
}
/** En la fila: «Ver» y como mucho dos cosas de las que tocan ahora. */
function botonesDeFila(e) {
  var abierta = Boolean(abiertas[e.id]);
  var ver = '<button class="btn sm" data-ver="' + e.id + '" type="button" aria-expanded="' + abierta + '">' + (abierta ? 'Cerrar' : 'Ver') + '</button>';
  var claves = ACCIONES_EN_FILA.filter(function (k) { return e.acciones.indexOf(k) >= 0; });
  /* Si no hay nada urgente que hacer pero falta el pin, ese es el atajo util. */
  if (!claves.length && e.acciones.indexOf('poner_ubicacion') >= 0) claves = ['poner_ubicacion'];
  return '<div class="acciones">' + ver + claves.slice(0, 2).map(function (k) { return botonAccion(e, accion(k), true); }).join('') + '</div>';
}

/* --------------------------------------------------- las cifras y el filtro
   Un solo sitio decide que entra en cada cifra: la tarjeta y la lista de
   abajo no pueden contradecirse porque preguntan a la misma funcion. */
var FINAL = { entregada: 1, terminada: 1, cancelada: 1 };
/* Apartada mientras el cliente decide si volvemos hoy: todavia no necesita a nadie. */
function esperaSegunda(e) { return e.estado === 'incidencia' && Boolean(e.segundaVisitaPedidaAt) && !e.requiereHumano; }
function porEstado(x) { return function (e) { return e.estado === x; }; }
/* "Lo que un motorizado lleva encima ahora": el mismo criterio que el
   servidor (vivasDeMotorizado) — le dieron el pin y aun no esta entregada.
   Antes esta pantalla lo contaba de dos maneras distintas. */
function laLlevaUnMotorizado(e) { return Boolean(e.motorizado) && (e.estado === 'esperando_motorizado' || e.estado === 'avisada'); }
var FILTROS = {
  total: function () { return true; },
  faltaUbicacion: function (e) { return e.ubicacionEstado === 'pendiente' && e.estado !== 'cancelada'; },
  faltaConfirmacion: function (e) { return (e.confirmacionEstado === 'pendiente' || e.confirmacionEstado === 'pedida') && e.estado !== 'cancelada'; },
  enCamino: function (e) { return e.estado === 'lista' || e.estado === 'esperando_motorizado' || e.estado === 'avisada'; },
  incidencia: function (e) { return e.estado === 'incidencia' && !esperaSegunda(e); },
  esperandoSegundaVisita: esperaSegunda,
  urgente: function (e) { return e.prioridad === 'urgente' && !FINAL[e.estado]; },
  avisada: porEstado('avisada'),
  entregada: porEstado('entregada'),
  terminada: porEstado('terminada'),
  lista: porEstado('lista'),
  esperando_motorizado: porEstado('esperando_motorizado'),
  cancelada: porEstado('cancelada')
};
function cuantas(clave) { return resumen.entregas.filter(FILTROS[clave]).length; }
function pasaFiltro(e) { return !filtro || !FILTROS[filtro] ? true : FILTROS[filtro](e); }

/* Cinco cifras a la vista (las que importan a las 9 de la mañana) y el resto en "Mas cifras". */
var CIFRAS_PRINCIPALES = [
  ['total', 'pedidos hoy', ''],
  ['faltaUbicacion', 'falta ubicación', 'warn'],
  ['faltaConfirmacion', 'falta confirmar', 'warn'],
  ['enCamino', 'en camino', 'info'],
  ['incidencia', 'necesitan una persona', 'bad']
];
var CIFRAS_MAS = [
  ['avisada', 'clientes avisados', 'info'],
  ['entregada', 'entregadas', 'ok'],
  ['terminada', 'terminadas en GSG', 'ok'],
  ['urgente', 'urgentes', 'bad'],
  ['esperandoSegundaVisita', 'esperan al cliente (¿volvemos hoy?)', 'info'],
  ['lista', 'listas para motorizado', 'info'],
  ['esperando_motorizado', 'esperando al motorizado', 'info'],
  ['cancelada', 'canceladas', '']
];
function pintarTarjetas() {
  function tarjeta(x) {
    var n = cuantas(x[0]);
    /* Un cero no se pinta de rojo ni de ambar: no hay nada que mirar. */
    return '<div class="tarjeta cifra ' + (n > 0 ? x[2] : '') + '" data-filtro="' + x[0] + '" role="button" tabindex="0" aria-pressed="' + (filtro === x[0]) + '"><div class="n">' + n + '</div><div class="q">' + x[1] + '</div></div>';
  }
  var hayQueMirar = cuantas('urgente') > 0 || cuantas('esperandoSegundaVisita') > 0;
  var abierto = hayQueMirar || CIFRAS_MAS.some(function (x) { return x[0] === filtro; });
  $('tarjetas').innerHTML = CIFRAS_PRINCIPALES.map(tarjeta).join('') +
    '<details class="mas-cifras"' + (abierto ? ' open' : '') + '><summary>Más cifras (avisados, entregadas, urgentes…)</summary><div class="tarjetas">' + CIFRAS_MAS.map(tarjeta).join('') + '</div></details>';
}

/* ------------------------------------------------------------- la tabla -- */
function buscadas(lista) {
  var q = ($('buscar').value || '').trim().toLowerCase();
  if (!q) return lista;
  var digitos = q.replace(/\D/g, '');
  return lista.filter(function (e) {
    return (e.nombre || '').toLowerCase().indexOf(q) >= 0 || (digitos.length >= 3 && e.phone.indexOf(digitos) >= 0) || e.referencia.toLowerCase().indexOf(q) >= 0;
  });
}
function filaSuelta(texto) { return '<tr><td colspan="6" class="nada">' + texto + '</td></tr>'; }
function marcasDe(e) {
  return (FILTROS.urgente(e) ? '<span class="chip tono-rojo sin-punto">Urgente</span>' : '') +
    (e.segundaVisita ? '<span class="chip tono-azul sin-punto">2.ª visita</span>' : '');
}

function pintarFilas() {
  var lista = buscadas(resumen.entregas.filter(pasaFiltro));
  /* Los urgentes que siguen vivos van arriba; el resto conserva su orden
     (sort es estable, asi que no hace falta arrastrar el indice). */
  lista = lista.slice().sort(function (a, b) { return (FILTROS.urgente(a) ? 0 : 1) - (FILTROS.urgente(b) ? 0 : 1); });
  var tbody = $('filas');
  if (!lista.length) {
    tbody.innerHTML = resumen.entregas.length
      ? filaSuelta('Ninguna entrega con ese filtro.')
      : '<tr><td colspan="6" class="celda-ancha"><div class="vacio"><div class="ico">📦</div><h3>Todavía no hay pedidos hoy</h3><p>Tráelos de GSG (o carga el simulador), o pega la lista del día tal como sale de Excel.</p><div class="acciones"><button class="btn primario" type="button" data-pulsa="sincronizar">Traer los pendientes de GSG</button><button class="btn" type="button" data-pulsa="pegar-abrir">Pegar la lista del día</button></div></div></td></tr>';
    return;
  }
  tbody.innerHTML = lista.map(function (e) {
    /* El chip de situacion es el mismo que en el mapa, en Motorizados y en la
       campana (catalogo compartido). Va bajo el nombre porque es lo primero
       que hay que mirar; el detalle largo esta dentro de «Ver». */
    var enQueVa = esperaSegunda(e)
      ? '<span class="chip tono-azul" data-estado="segunda_visita">Esperando al cliente</span>'
      : chipEstado('entrega', e.estado);
    var porQue = FILTROS.incidencia(e) && NOMBRE_INCIDENCIA[e.incidencia] ? '<span class="sub">' + esc(NOMBRE_INCIDENCIA[e.incidencia]) + '</span>' : '';
    var otros = e.mismoCliente && e.mismoCliente.length
      ? ' <span class="chip tono-azul sin-punto" title="El mismo cliente tiene otro pedido hoy: su pin y su confirmación valen para los dos y van en el mismo viaje">+' + e.mismoCliente.length + ' del mismo cliente: ' + esc(e.mismoCliente.join(', ')) + '</span>'
      : '';
    var fila = '<tr' + (FILTROS.urgente(e) ? ' class="fila-urgente"' : '') + '>' +
      '<td><div class="quien"><b>' + esc(e.nombre || 'Sin nombre') + '</b>' + marcasDe(e) + '</div>' +
        '<div class="en-que-va">' + enQueVa + porQue + '</div>' +
        '<div class="sub">' + esc(e.referencia) + ' · <span class="telefono">' + esc(telefonoBonito(e.phone)) + '</span>' + (e.distrito ? '<br>' + esc(e.distrito) : '') + otros + '</div></td>' +
      '<td>' + chipUbicacion(e) + '</td>' +
      '<td>' + chipConfirmacion(e) + '</td>' +
      '<td>' + chipMotorizado(e) + '</td>' +
      '<td>' + chipLlega(e) + '</td>' +
      '<td>' + botonesDeFila(e) + '</td></tr>';
    if (abiertas[e.id]) fila += '<tr class="fila-detalle"><td colspan="6" id="detalle-' + e.id + '">' + (detalles[e.id] || 'Cargando…') + '</td></tr>';
    return fila;
  }).join('');
  Object.keys(abiertas).forEach(function (id) { if (abiertas[id] && !detalles[id]) cargarDetalle(id); });
}

async function cargarDetalle(id) {
  var td = $('detalle-' + id);
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
    /* Las acciones disponibles vienen en la lista (el resumen), no en la ficha. */
    var enLista = resumen.entregas.filter(function (x) { return String(x.id) === String(id); })[0];
    var acciones = botonesDeFicha(enLista || { id: e.id, acciones: e.acciones || [], prioridad: e.prioridad });
    var html = (e.situacion ? '<p class="situacion-larga">' + esc(e.situacion) + '</p>' : '') +
      (acciones.length ? '<div class="acciones-detalle">' + acciones.join('') + '</div>' : '') +
      datos + r.eventos.map(function (ev) {
        return '<div class="mov"><span class="hora">' + hora(ev.createdAt) + '</span><span class="que"><b>' + esc(ev.tipo.replace(/_/g, ' ')) + '</b> ' + esc(ev.detalle || '') + '</span></div>';
      }).join('');
    detalles[id] = html;
    td.innerHTML = html;
  } catch (e) {
    td.textContent = 'No se pudo abrir la ficha: ' + e.message;
  }
}
/* Tras recargar el dia, las fichas abiertas se releen encima de lo que ya
   hay (sin vaciarlas antes) para que no parpadeen. */
function refrescarDetalles() {
  Object.keys(abiertas).forEach(function (id) { if (abiertas[id]) cargarDetalle(id); });
}

/* ------------------------------------------------------ la tira de estado
   En una sola linea para el celular: "WhatsApp ✓ · GSG ✓ · 10 motorizados · cierre ✓". */
var waResumen = '';
function pintarTiraResumen() {
  if (!resumen) return;
  var partes = [];
  if (waResumen) partes.push(waResumen);
  var g = resumen.gsg;
  partes.push(!g || g.modo === 'ninguna' ? 'GSG ✕' : g.modo === 'simulador' ? 'GSG simulador' : 'GSG ✓');
  partes.push(plural(resumen.motorizados.filter(function (m) { return m.estado === 'activo'; }).length, 'motorizado', 'motorizados'));
  partes.push(resumen.cierrePendiente ? 'cierre pendiente' : 'cierre ✓');
  $('tira-resumen').textContent = partes.join(' · ');
}

function pintarMotorizadosTira() {
  var el = $('mot-estado');
  if (!resumen.motorizados.length) { el.innerHTML = '<span class="punto bad"></span>No hay ningún motorizado dado de alta: sin ellos nadie recibe los pedidos.'; return; }
  var activos = resumen.motorizados.filter(function (m) { return m.estado === 'activo'; }).length;
  if (!activos) { el.innerHTML = '<span class="punto bad"></span>' + resumen.motorizados.length + ' dados de alta, ninguno activo hoy.'; return; }
  var enCalle = resumen.entregas.filter(laLlevaUnMotorizado).length;
  var entregadas = cuantas('entregada');
  el.innerHTML = '<span class="punto ok"></span>' + plural(activos, 'activo', 'activos') +
    (enCalle ? ' · ' + plural(enCalle, 'pedido en la calle', 'pedidos en la calle') : '') +
    (entregadas ? ' · ' + plural(entregadas, 'entregado', 'entregados') : '');
}

/* El cierre del dia: que hizo el ultimo y si queda algo de ayer sin cerrar. */
function pintarCierre() {
  var el = $('cierre-estado');
  var u = resumen.ultimoCierre;
  var a = resumen.ajustes.cierreDelDia || { activo: true, hora: 0 };
  var pendiente = resumen.cierrePendiente || 0;
  var cuando = a.activo ? ' Se cierra solo a las ' + String(a.hora).padStart(2, '0') + ':00.' : ' El cierre automático está apagado.';
  if (u && u.dia === resumen.dia) {
    el.innerHTML = '<span class="punto ' + (u.sinTerminar.length ? 'warn' : 'ok') + '"></span>Ayer se cerró a las ' + hora(u.cuando) + ': ' +
      (u.sinTerminar.length ? u.sinTerminar.length + ' sin terminar → <a href="#" data-filtro-ir="incidencia">necesitan a alguien</a>' : 'nada quedó sin terminar') +
      (u.dadasPorEntregadas.length ? ', ' + plural(u.dadasPorEntregadas.length, 'dada por entregada', 'dadas por entregadas') : '') + '.';
  } else if (pendiente) {
    el.innerHTML = '<span class="punto warn"></span>' + plural(pendiente, 'pedido de ayer sigue', 'pedidos de ayer siguen') + ' sin cerrar.' + cuando;
  } else {
    el.innerHTML = '<span class="punto ok"></span>Nada pendiente de ayer.' + cuando;
  }
  $('cerrar-dia').classList.toggle('hidden', !pendiente);
}

async function pintarWhatsApp() {
  var el = $('wa-estado');
  try {
    var h = await api('/health');
    if (!h.configured) { el.innerHTML = '<span class="punto bad"></span>Sin conectar. <a href="/setup">Conectar el WhatsApp</a>.'; waResumen = 'WhatsApp ✕'; }
    else if (!h.connected) { el.innerHTML = '<span class="punto warn"></span>Configurado pero desconectado. <a href="/setup">Volver a vincular</a>.'; waResumen = 'WhatsApp caído'; }
    else {
      var pero = resumen.motor.parado ? ' <span class="muted">Ahora mismo parado: ' + esc(resumen.motor.parado) + '</span>'
        : resumen.motor.enHorario ? '' : ' <span class="muted">Fuera del horario de envío.</span>';
      el.innerHTML = '<span class="punto ok"></span>Conectado y escribiendo.' + pero;
      waResumen = 'WhatsApp ✓';
    }
  } catch (e) {
    el.innerHTML = '<span class="punto"></span>No se pudo saber: ' + esc(e.message);
    waResumen = '';
  }
  pintarTiraResumen();
}

function pintarGsg() {
  var g = resumen.gsg;
  var el = $('gsg-estado');
  if (!g) { el.innerHTML = '<span class="punto"></span>La conexión con GSG se fija al arrancar (no se cambia desde aquí).'; return; }
  var clase = g.modo === 'ninguna' ? 'bad' : g.modo === 'simulador' ? 'info' : 'ok';
  el.innerHTML = '<span class="punto ' + clase + '"></span>' + esc(g.descripcion) + (g.origen === 'env' ? ' <span class="muted">(del arranque)</span>' : '');
  var u = resumen.ultimaSincronizacion;
  $('gsg-ultima').textContent = u
    ? 'Última sincronización ' + hora(u.at) + (u.ok ? ': ' : ' falló: ') + u.detalle
    : 'Todavía no se sincronizó hoy.' + (resumen.motor.parado ? ' Motor: ' + resumen.motor.parado : '');
  $('sim-usar').classList.toggle('hidden', g.modo === 'simulador');
  $('pegar-destino-sim').classList.toggle('hidden', g.modo !== 'simulador');
  pintarColaGsg();
}
/* La cola de reportes hacia GSG: solo se enseña cuando hay algo que mirar. */
function pintarColaGsg() {
  var cola = $('gsg-cola');
  var c = resumen.gsgCola;
  if (!c || (c.fallido <= 0 && c.atascado <= 0 && c.pendiente <= 20)) { cola.classList.add('hidden'); return; }
  cola.className = 'gsg-cola' + (c.fallido > 0 || c.atascado > 0 ? ' mal' : '');
  var quePasa = c.fallido > 0 ? plural(c.fallido, 'reporte que GSG no aceptó', 'reportes que GSG no aceptó')
    : c.atascado > 0 ? plural(c.atascado, 'reporte sin respuesta de GSG', 'reportes sin respuesta de GSG')
    : plural(c.pendiente, 'reporte esperando a GSG', 'reportes esperando a GSG');
  cola.innerHTML = quePasa + ' · <a href="#" id="gsg-cola-reintentar">Reintentar</a> · <a href="/admin/rutas/cola.ndjson" target="_blank" rel="noopener">Descargar</a>';
  $('gsg-cola-reintentar').onclick = async function (ev) {
    ev.preventDefault();
    try {
      var r = await api('/admin/rutas/cola/despachar', { method: 'POST', body: {} });
      toast('Reintentado: ' + (r.enviados || 0) + ' aceptados, ' + ((r.intentados || 0) - (r.enviados || 0)) + ' siguen sin entrar.');
      await cargar();
    } catch (e) { toast(e.message); }
  };
}

/* El modo prueba (solo se escribe a ciertos numeros): un cartel arriba para que nadie se lleve un susto. */
async function pintarModoPrueba() {
  var cartel = $('cartel-prueba');
  try {
    var r = await api('/admin/ajustes');
    var nums = (r.efectivo || {}).soloNumeros || [];
    cartel.classList.toggle('hidden', !nums.length);
    if (!nums.length) return;
    $('cartel-prueba-texto').textContent = 'solo se escribe a ' + nums.map(telefonoBonito).join(', ') + '; a los demás no les llega nada.';
    $('modo-prueba-quitar').classList.toggle('hidden', Boolean(r.modoPruebaFijado));
  } catch (e) {
    /* Quien no es administrador no puede leer los ajustes: sin cartel, sin ruido. */
    cartel.classList.add('hidden');
  }
}

/* ----------------------------------------- lo que necesita a una persona --
   Los telefonos que ya tienen pedido hoy no se repiten en las otras listas. */
function telefonosConEntrega() {
  var mapa = {};
  resumen.entregas.forEach(function (e) { mapa[e.phone] = true; });
  return mapa;
}
async function pintarAlguien() {
  var filas = resumen.entregas.filter(FILTROS.incidencia).map(function (e) {
    return '<div class="mov"><span class="que"><b>' + esc(e.referencia) + '</b> ' + esc(e.nombre || telefonoBonito(e.phone)) + ': ' + esc(e.incidenciaDetalle || e.incidencia || '') + ' <a href="#" data-ir-fila="' + e.id + '">ver</a></span></div>';
  });
  var falla = '';
  try {
    var conEntrega = telefonosConEntrega();
    var r = await api('/admin/rutas/solicitudes?requiereHumano=true&limit=50');
    (r.items || []).filter(function (s) { return !conEntrega[s.phone]; }).forEach(function (s) {
      filas.push('<div class="mov"><span class="que"><b>' + esc(s.referencia || 'sin pedido') + '</b> ' + esc(s.nombre || telefonoBonito(s.phone || s.telefonoCrudo)) + ': ' + esc(s.incidenciaDetalle || s.incidencia || s.estado) +
        '<div class="acciones mov-acciones"><button class="btn sm" data-sol-reintentar="' + s.id + '" type="button">Volver a intentar</button><a class="btn sm" href="/chat?tel=' + esc(s.phone || '') + '">Abrir chat</a></div></span></div>');
    });
  } catch (e) {
    /* Los casos del reparto son un añadido: si fallan se dice, no se esconde el resto. */
    falla = '<div class="nada">No se pudieron leer los casos del reparto: ' + esc(e.message) + '</div>';
  }
  $('alguien-n').textContent = filas.length ? plural(filas.length, 'caso', 'casos') : 'nada pendiente';
  $('alguien').innerHTML = (filas.length ? filas.join('') : '<div class="nada">✓ Nadie espera a una persona ahora mismo.</div>') + falla;
}

/* Los otros: la lista de envio automatico (reparto sin pedido de hoy + numeros a mano), tal como la cuenta el sistema. */
async function pintarOtros() {
  var tbody = $('otros');
  try {
    var conEntrega = telefonosConEntrega();
    var r = await api('/admin/envio-automatico');
    var lista = (r.numeros || []).filter(function (n) { return !conEntrega[n.phone]; });
    $('otros-n').textContent = lista.length ? String(lista.length) : 'nadie';
    if (!lista.length) { tbody.innerHTML = '<tr><td colspan="3" class="nada">Ahora mismo no hay nadie más en la lista.</td></tr>'; return; }
    tbody.innerHTML = lista.map(function (n) {
      return '<tr><td><b>' + esc(n.nombre || telefonoBonito(n.phone)) + '</b><div class="sub">' + esc(telefonoBonito(n.phone)) + (n.referencia ? ' · ' + esc(n.referencia) : '') + '</div></td>' +
        '<td class="sub">' + esc(n.situacion) + (n.pausado ? ' <span class="chip tono-ambar">en pausa</span>' : '') + '</td>' +
        '<td><div class="acciones">' + (n.pausado ? '<button class="btn sm" data-otro-reanudar="' + esc(n.clave) + '" type="button">Reanudar</button>' : '<button class="btn sm" data-otro-pausar="' + esc(n.clave) + '" type="button">Pausar</button>') + '<button class="btn peligro sm" data-otro-quitar="' + esc(n.clave) + '" type="button">Quitar</button></div></td></tr>';
    }).join('');
  } catch (e) {
    $('otros-n').textContent = '';
    tbody.innerHTML = '<tr><td colspan="3" class="nada">' + esc(e.message) + '</td></tr>';
  }
}

function pintarEventos() {
  var caja = $('eventos');
  if (!resumen.eventos.length) { caja.innerHTML = '<div class="nada">Todavía no pasó nada hoy.</div>'; return; }
  caja.innerHTML = resumen.eventos.map(function (ev) {
    return '<div class="mov"><span class="hora">' + hora(ev.at) + '</span><span class="que"><b>' + esc(ev.referencia) + '</b> ' + esc(ev.nombre || ev.phone) + ': ' + esc(ev.detalle || ev.tipo) + '</span></div>';
  }).join('');
}

/* ---------------------------------------------------------------- ajustes
   El refresco cada 10 s no puede pisar lo que alguien esta cambiando: en
   cuanto se toca un campo, los ajustes dejan de repintarse hasta guardar. */
var ajustesTocados = false;
function marcarAjustesTocados() {
  if (ajustesTocados) return;
  ajustesTocados = true;
  $('aj-estado').textContent = 'Hay cambios sin guardar.';
}
$('caja-ajustes').addEventListener('input', marcarAjustesTocados);
$('caja-ajustes').addEventListener('change', marcarAjustesTocados);

function pintarAjustes() {
  if (ajustesTocados) return;
  var a = resumen.ajustes;
  var valor = function (id, v) { $(id).value = v; };
  var marca = function (id, v) { $(id).checked = v; };
  valor('aj-margen', a.margenMinutos);
  valor('aj-conf-espera', a.confirmacionEsperaMin);
  valor('aj-conf-max', a.confirmacionMaxIntentos);
  valor('aj-mot-espera', a.motorizadoEsperaMin);
  valor('aj-mot-max', a.motorizadoMaxIntentos);
  valor('aj-sync', a.sincronizarCadaMin);
  marca('aj-leer-ia', a.leerConIA);
  marca('aj-redactar-ia', a.redactarConIA);
  marca('aj-pin', a.mandarPinAlMotorizado);
  marca('aj-avisar-entregado', a.avisarEntregado !== false);
  marca('aj-donde-esta', a.responderDondeEsta !== false);
  marca('aj-botones', a.usarBotones !== false);
  marca('aj-cerca', a.avisarCerca !== false);
  var sv = a.segundaVisita || { activa: true, esperaMin: 30 };
  marca('aj-sv-activa', sv.activa !== false);
  valor('aj-sv-espera', sv.esperaMin);
  var rec = a.clienteRecurrente || { activo: true, diasMaximo: 60, esperaMin: 60 };
  marca('aj-rec-activo', rec.activo !== false);
  valor('aj-rec-dias', rec.diasMaximo);
  valor('aj-rec-espera', rec.esperaMin);
  var cd = a.cierreDelDia || { activo: true, hora: 0 };
  marca('aj-cierre-activo', cd.activo !== false);
  valor('aj-cierre-hora', String(cd.hora || 0).padStart(2, '0') + ':00');
  var he = a.horarioEntregas || {};
  valor('aj-hor-desde', he.desde || '14:00');
  valor('aj-hor-hasta', he.hasta || '20:00');
  valor('aj-hor-ext', he.extendidoHasta || '22:00');
  var sop = a.soporte || {};
  valor('aj-sop-wa', sop.whatsapp || '');
  valor('aj-sop-tel', sop.llamadas || '');
  var pl = resumen.plantillas || { hacenFalta: false, aprobadas: [] };
  $('aj-plantillas-caja').classList.toggle('hidden', !pl.hacenFalta);
  $('aj-plantillas-lista').innerHTML = pl.aprobadas.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
  ['confirmacion', 'motorizado', 'aviso'].forEach(function (k) { valor('aj-pl-' + k, (a.plantillas && a.plantillas[k]) || ''); });
  pintarTextos(a);
}

/* Los textos se arman una sola vez: llevan chips de variables y vista previa. */
function pintarTextos(a) {
  var caja = $('aj-textos');
  if (caja.children.length) return;
  var unTexto = function (k) {
    return '<div class="texto-editable"><label>' + esc(resumen.textos.descripcion[k]) + '</label><textarea data-texto="' + k + '" placeholder="' + esc(resumen.textos.porDefecto[k]) + '">' + esc(a.textos[k] || '') + '</textarea><div class="previa"><a data-previa="' + k + '">Ver cómo queda</a><span class="resultado hidden" id="previa-' + k + '"></span></div></div>';
  };
  var claves = Object.keys(resumen.textos.porDefecto);
  var alMotorizado = claves.filter(function (k) { return k.indexOf('motorizado') === 0; });
  var alCliente = claves.filter(function (k) { return k.indexOf('motorizado') !== 0; });
  caja.innerHTML = '<p class="muted" style="margin:0 0 6px;font-size:13px">Vacío = el texto de siempre (el que se ve en gris). Toca una variable para insertarla donde está el cursor.</p>' +
    '<h4 class="textos-para">Al cliente</h4>' + alCliente.map(unTexto).join('') +
    '<h4 class="textos-para">Al motorizado</h4>' + alMotorizado.map(unTexto).join('');
  claves.forEach(function (k) {
    var ta = caja.querySelector('textarea[data-texto="' + k + '"]');
    if (ta && window.chipsDeVariables) window.chipsDeVariables(ta, resumen.textos.variables[k] || []);
  });
  caja.addEventListener('click', async function (ev) {
    var enlace = ev.target.closest('[data-previa]');
    if (!enlace) return;
    ev.preventDefault();
    var k = enlace.getAttribute('data-previa');
    var salida = $('previa-' + k);
    var ta = caja.querySelector('textarea[data-texto="' + k + '"]');
    try {
      var r = await api('/admin/entregas/previsualizar', { method: 'POST', body: { clave: k, texto: ta ? ta.value : '' } });
      salida.textContent = r.texto;
      salida.classList.remove('hidden');
    } catch (e) { toast(e.message); }
  });
}

/* -------------------------------------------------------------- simulador */
async function cargarSimulador() {
  var caja = $('caja-sim');
  try {
    var r = await api('/admin/entregas/simulador');
    caja.classList.remove('hidden');
    var e = r.estado;
    $('sim-resumen').textContent = 'falta ubicación ' + e.faltaUbicacion + ' · falta confirmar ' + e.faltaConfirmacion + ' · terminados ' + e.terminados + ' · cancelados ' + e.cancelados + ' · llamadas ' + e.llamadas;
    $('sim-modo').value = r.modo;
    var p = r.pendientes;
    var col = function (titulo, lista, extra) {
      return '<div class="col"><b>' + titulo + ' (' + lista.length + ')</b>' + (lista.length ? lista.map(function (c) { return '<div>' + esc(c.referencia) + ' · ' + esc(c.nombre || c.telefono) + (extra ? extra(c) : '') + '</div>'; }).join('') : '<div class="muted">nadie</div>') + '</div>';
    };
    $('sim-listas').innerHTML =
      col('Falta pedir ubicación', p.faltaUbicacion) +
      col('Falta confirmar', p.faltaConfirmacion, function (c) { return c.lat !== undefined ? ' <span class="muted">(GSG ya tiene el pin)</span>' : ''; }) +
      col('Ya terminó el proceso', p.terminados, function (c) { return c.llegaAproxEn ? ' <span class="muted">llega ' + hora(c.llegaAproxEn) + '</span>' : ''; }) +
      (p.cancelados.length ? col('Cancelados', p.cancelados) : '');
  } catch (e) {
    /* Sin simulador montado la caja sobra; cualquier otro fallo se dice. */
    if (e.message && /no está montado/.test(e.message)) { caja.classList.add('hidden'); return; }
    caja.classList.remove('hidden');
    $('sim-resumen').textContent = 'no se pudo leer: ' + e.message;
  }
}

/* ---------------------------------------------------------------- cargar */
async function cargar() {
  var datos;
  try {
    datos = await api('/admin/entregas');
  } catch (e) {
    $('error-carga').textContent = 'No se pudieron leer los pedidos de hoy: ' + e.message + ' Se vuelve a intentar en unos segundos.';
    $('error-carga').classList.remove('hidden');
    if (!resumen) $('filas').innerHTML = filaSuelta('No se pudieron cargar los pedidos.');
    return;
  }
  $('error-carga').classList.add('hidden');
  resumen = datos;
  $('dia').textContent = '· ' + diaEnPalabras(resumen.dia);
  pintarTiraResumen();
  pintarTarjetas();
  pintarFilas();
  refrescarDetalles();
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
/** Cambiar de filtro no pide nada al servidor: solo repinta cifras y tabla. */
function repintarFiltro() {
  pintarTarjetas();
  pintarFilas();
}

/* ------------------------------------------------ las cosas que se hacen -
   Una entrada por accion, con el nombre del atributo del boton
   (data-<attr>). Si devuelve true se recarga el dia; si devuelve false no
   habia nada que cambiar (se cerro el cuadro, por ejemplo). */
var HACER = {
  pulsa: function (destino) { $(destino).click(); return false; },
  ver: function (id) {
    if (abiertas[id]) { delete abiertas[id]; delete detalles[id]; } else { abiertas[id] = true; }
    pintarFilas();
    return false;
  },
  confirmar: async function (id) {
    var si = await confirmarDialogo({ titulo: 'Confirmar a mano', texto: '¿El cliente confirmó el pedido de hoy (por teléfono o en persona)? Se le contará a GSG y, si tiene ubicación, pasa a un motorizado.', boton: 'Sí, confirmada' });
    if (!si) return false;
    await api('/admin/entregas/' + id + '/confirmar', { method: 'POST', body: { confirmada: true } });
    toast('Confirmada: pasa a un motorizado en cuanto tenga ubicación.');
    return true;
  },
  'no-confirmar': async function (id) {
    var si = await confirmarDialogo({ titulo: 'El cliente no lo quiere', texto: '¿El cliente dijo que hoy no lo recibe? El pedido se cancela y GSG se entera.', boton: 'Sí, no lo quiere', peligro: true });
    if (!si) return false;
    await api('/admin/entregas/' + id + '/confirmar', { method: 'POST', body: { confirmada: false } });
    toast('Anotado: el pedido queda cancelado y GSG ya lo sabe.');
    return true;
  },
  ubicacion: async function (id) {
    var texto = await pedirDato({ titulo: 'Poner la ubicación a mano', texto: 'Pega un enlace de Google Maps o escribe las coordenadas (lat, lng).', marcador: 'https://maps.app.goo.gl/… o -12.1211, -77.0301', boton: 'Guardar' });
    if (!texto) return false;
    await api('/admin/entregas/' + id + '/ubicacion', { method: 'POST', body: { texto: texto } });
    toast('Ubicación guardada: si ya confirmó, pasa a un motorizado.');
    return true;
  },
  entregada: async function (id) {
    var si = await confirmarDialogo({ titulo: 'Marcar como entregada', texto: '¿El motorizado ya la entregó (te lo dijo por teléfono, por ejemplo)? Se le contará a GSG y, si el ajuste está activo, al cliente se le da las gracias.', boton: 'Sí, entregada' });
    if (!si) return false;
    await api('/admin/entregas/' + id + '/entregada', { method: 'POST', body: {} });
    toast('Entregada: GSG ya lo sabe.');
    return true;
  },
  segunda: async function (id) {
    var si = await confirmarDialogo({ titulo: 'Segunda visita', texto: '¿El cliente ya está en casa (te llamó, por ejemplo)? El motorizado recibe otra vez el pin para volver a pasar hoy; al cliente no se le vuelve a preguntar. Solo hay una segunda visita por pedido.', boton: 'Sí, que vuelva a pasar' });
    if (!si) return false;
    await api('/admin/entregas/' + id + '/segunda-visita', { method: 'POST', body: {} });
    toast('Segunda visita en marcha: el motorizado vuelve a pasar.');
    return true;
  },
  reintentar: async function (id) {
    await api('/admin/entregas/' + id + '/reintentar', { method: 'POST', body: {} });
    toast('En marcha otra vez.');
    return true;
  },
  reasignar: async function (id) {
    var actual = resumen.entregas.filter(function (x) { return String(x.id) === String(id); })[0];
    var rm = await api('/admin/motorizados');
    var activos = (rm.motorizados || []).filter(function (m) { return m.estado === 'activo' && !(actual && actual.motorizado && actual.motorizado.id === m.id); });
    var lleva = {};
    resumen.entregas.forEach(function (x) { if (laLlevaUnMotorizado(x)) lleva[x.motorizado.id] = (lleva[x.motorizado.id] || 0) + 1; });
    var opciones = [{ valor: '', etiqueta: 'Que elija el sistema', detalle: 'El más cercano o, si nadie está cerca, el que menos lleva.', principal: true }].concat(activos.map(function (m) {
      return { valor: String(m.id), etiqueta: m.nombre, detalle: (m.zona ? m.zona + ' · ' : '') + 'lleva ' + (lleva[m.id] || 0) };
    }));
    var elegido = await elegirOpcion({ titulo: 'Pasar a otro motorizado', texto: actual && actual.motorizado ? 'Ahora la tiene ' + actual.motorizado.nombre + '. ¿A quién se la pasamos?' : '¿Quién la lleva?', opciones: opciones });
    if (elegido === null) return false;
    await api('/admin/entregas/' + id + '/reasignar', { method: 'POST', body: { motorizadoId: elegido ? Number(elegido) : null } });
    var nuevo = activos.filter(function (m) { return String(m.id) === elegido; })[0];
    toast(nuevo ? 'Ahora la lleva ' + nuevo.nombre + ': le llega el pin por WhatsApp.' : 'El sistema elige al motorizado: le llega el pin por WhatsApp.');
    return true;
  },
  prioridad: async function (id, boton) {
    var urgente = boton.getAttribute('data-urgente') === '1';
    await api('/admin/entregas/' + id + '/prioridad', { method: 'POST', body: { urgente: urgente } });
    toast(urgente ? 'Marcada como urgente: sale primero.' : 'Ya no es urgente.');
    return true;
  },
  cancelar: async function (id) {
    var motivo = await pedirDato({ titulo: 'Cancelar la entrega', texto: 'Se le contará a GSG y, si un motorizado la tenía, se le avisa.', etiqueta: 'Motivo', marcador: 'El cliente llamó para cancelar', boton: 'Cancelar la entrega' });
    if (!motivo) return false;
    await api('/admin/entregas/' + id + '/cancelar', { method: 'POST', body: { motivo: motivo } });
    toast('Cancelada: GSG ya lo sabe.');
    return true;
  }
};
var CLAVES_HACER = Object.keys(HACER);

$('filas').addEventListener('click', async function (ev) {
  var b = ev.target.closest('button');
  if (!b) return;
  var clave = null;
  var valor = null;
  for (var i = 0; i < CLAVES_HACER.length; i++) {
    var v = b.getAttribute('data-' + CLAVES_HACER[i]);
    if (v !== null) { clave = CLAVES_HACER[i]; valor = v; break; }
  }
  if (!clave) return;
  b.disabled = true;
  try {
    if (await HACER[clave](valor, b)) await cargar();
  } catch (e) {
    toast(e.message);
  }
  /* Al repintar la tabla el boton ya no esta en el documento; si sigue, se reactiva. */
  b.disabled = false;
});

/* ----------------------------------------------------------------- filtro
   Llegar con ?filtro=incidencia (desde el Inicio o la campana) abre esa cifra. */
try {
  var filtroUrl = new URLSearchParams(window.location.search).get('filtro');
  if (filtroUrl && FILTROS[filtroUrl]) filtro = filtroUrl;
} catch (e) { /* sin filtro */ }

$('cierre-estado').addEventListener('click', function (ev) {
  var a = ev.target.closest('[data-filtro-ir]');
  if (!a) return;
  ev.preventDefault();
  filtro = a.getAttribute('data-filtro-ir');
  repintarFiltro();
  $('filas').scrollIntoView({ block: 'start', behavior: 'smooth' });
});
$('tarjetas').addEventListener('click', function (ev) {
  var t = ev.target.closest('[data-filtro]');
  if (!t) return;
  filtro = filtro === t.getAttribute('data-filtro') ? '' : t.getAttribute('data-filtro');
  repintarFiltro();
});
/* Las cifras tambien se abren con el teclado. */
$('tarjetas').addEventListener('keydown', function (ev) {
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList.contains('cifra')) { ev.preventDefault(); ev.target.click(); }
});
$('buscar').oninput = function () { if (resumen) pintarFilas(); };

/* ------------------------------------------------------ pedidos a mano -- */
$('nueva').onclick = async function () {
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

$('cerrar-dia').onclick = async function () {
  var si = await confirmarDialogo({ titulo: 'Cerrar el día de ayer', texto: 'Lo que quedó de ayer sin terminar pasa a "necesita una persona" (y GSG se entera); lo que ya tenía hora avisada y nadie marcó como entregado se da por entregado. Los pedidos de hoy no se tocan.', boton: 'Cerrar el día' });
  if (!si) return;
  try {
    var r = await api('/admin/entregas/cerrar-dia', { method: 'POST', body: { forzar: true } });
    var res = r.resultado || { sinTerminar: [], dadasPorEntregadas: [] };
    toast(r.ok ? 'Día cerrado: ' + res.sinTerminar.length + ' sin terminar, ' + res.dadasPorEntregadas.length + ' dadas por entregadas.' : (r.motivo || 'No se pudo cerrar.'));
    await cargar();
  } catch (e) { toast(e.message); }
};

/* ------------------------------------------------------ pegar la lista -- */
$('pegar-abrir').onclick = function () {
  var abierta = !$('caja-pegar').classList.toggle('hidden');
  this.setAttribute('aria-expanded', abierta ? 'true' : 'false');
  if (abierta) $('pegar-texto').focus();
};
$('pegar-cerrar').onclick = function () {
  $('caja-pegar').classList.add('hidden');
  $('pegar-abrir').setAttribute('aria-expanded', 'false');
  $('pegar-abrir').focus();
};
/* Antes de cargar: cuantos clientes se leyeron y que lineas no tienen un telefono valido. */
function previaPegar() {
  var lineas = $('pegar-texto').value.split(/\r?\n/);
  var buenas = 0;
  var malas = [];
  lineas.forEach(function (l, i) {
    if (!l.trim()) return;
    if (i === 0 && /tel|nombre|pedido|direcc/i.test(l) && !/\d{7}/.test(l)) return; /* cabecera */
    var digitos = (l.match(/\d[\d\s-]{6,}\d/g) || []).map(function (x) { return x.replace(/\D/g, ''); });
    if (digitos.some(function (x) { return x.length >= 9 && x.length <= 12; })) buenas++; else malas.push(i + 1);
  });
  var out = $('pegar-previa');
  var b = $('pegar-cargar');
  if (!buenas && !malas.length) { out.textContent = ''; b.textContent = 'Cargar la lista'; return; }
  out.textContent = 'Se leyeron ' + plural(buenas, 'cliente', 'clientes') +
    (malas.length ? ' · ' + malas.length + ' sin teléfono válido (línea' + (malas.length === 1 ? ' ' : 's ') + malas.slice(0, 6).join(', ') + (malas.length > 6 ? '…' : '') + ')' : '');
  b.textContent = buenas ? 'Cargar ' + plural(buenas, 'cliente', 'clientes') + ' y empezar a escribirles' : 'Cargar la lista';
}
$('pegar-texto').addEventListener('input', previaPegar);
$('pegar-cargar').onclick = async function () {
  var b = this;
  var out = $('pegar-resultado');
  var texto = $('pegar-texto').value;
  if (!texto.trim()) { out.textContent = 'Pega primero la lista.'; $('pegar-texto').focus(); return; }
  b.disabled = true;
  try {
    var r = await api('/admin/entregas/cargar-lista', { method: 'POST', body: {
      texto: texto,
      faltaUbicacion: $('pegar-ubicacion').checked,
      faltaConfirmacion: $('pegar-confirmacion').checked,
      destino: (document.querySelector('input[name="pegar-destino"]:checked') || { value: 'sistema' }).value
    } });
    var partes = [r.creadas + ' ' + (r.destino === 'simulador' ? 'en la lista del simulador' : 'creada' + (r.creadas === 1 ? '' : 's'))];
    /* El simulador devuelve cuantas se repitieron; el sistema, sus referencias. */
    var rep = Array.isArray(r.repetidas) ? r.repetidas.length : (r.repetidas || 0);
    if (rep) partes.push(rep + ' ya estaba' + (rep === 1 ? '' : 'n') + ' hoy');
    if (r.lote) partes.push('lote del reparto "' + r.lote.nombre + '" con ' + r.lote.total + ' para pedir la ubicación');
    if (r.descartadas && r.descartadas.length) partes.push(plural(r.descartadas.length, 'línea sin usar', 'líneas sin usar') + ': ' + r.descartadas.slice(0, 5).map(function (d) { return 'línea ' + d.linea + ' (' + d.motivo + ')'; }).join('; '));
    out.textContent = partes.join(' · ');
    toast(r.creadas ? 'Lista cargada.' : 'No se creó ninguna: revisa las líneas.');
    if (r.creadas) { $('pegar-texto').value = ''; previaPegar(); }
    await cargar();
  } catch (e) { out.textContent = e.message; }
  b.disabled = false;
};

/* ------------------------------------------------------- el modo prueba - */
$('modo-prueba').onclick = async function () {
  try {
    var r = await api('/admin/ajustes');
    var numero = (r.efectivo && r.efectivo.supervisor) || '';
    if (!numero) {
      numero = await pedirDato({ titulo: 'Modo prueba con mi número', texto: 'Escribe tu número: mientras el modo prueba esté activo, el sistema solo le escribirá a él y a nadie más.', etiqueta: 'Tu WhatsApp', marcador: '987 654 321', boton: 'Activar' });
      if (!numero) return;
      /* Un celular peruano de 9 cifras se guarda con el 51 delante, como todo lo demas. */
      numero = String(numero).replace(/\D+/g, '');
      if (numero.length === 9 && numero.charAt(0) === '9') numero = '51' + numero;
    }
    await api('/admin/ajustes', { method: 'POST', body: { modoPrueba: { activo: true, numeros: [numero] } } });
    toast('Modo prueba activo: solo se escribe a ' + telefonoBonito(numero) + '.');
    await cargar();
  } catch (e) { toast(e.message); }
};
$('modo-prueba-quitar').onclick = async function () {
  try { await api('/admin/ajustes', { method: 'POST', body: { modoPrueba: { activo: false } } }); toast('Modo prueba apagado: se escribe a todos.'); await cargar(); } catch (e) { toast(e.message); }
};

/* ------------------------------------------------------------------ GSG - */
$('sincronizar').onclick = async function () {
  var b = this;
  b.disabled = true;
  try { var r = await api('/admin/entregas/sincronizar', { method: 'POST', body: {} }); toast(r.detalle); await cargar(); } catch (e) { toast(e.message); }
  b.disabled = false;
};
$('gsg-probar').onclick = async function () {
  try { var r = await api('/admin/entregas/gsg/probar', { method: 'POST', body: {} }); toast(r.prueba.detalle); } catch (e) { toast(e.message); }
};
$('gsg-configurar').onclick = async function () {
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

/* ------------------------------------------------ el simulador de GSG --- */
$('sim-usar').onclick = async function () {
  try { await api('/admin/entregas/gsg', { method: 'POST', body: { modo: 'simulador' } }); toast('Ahora GSG es el simulador de este servidor.'); await cargar(); } catch (e) { toast(e.message); }
};
$('sim-cargar').onclick = async function () {
  try { var r = await api('/admin/entregas/simulador/cargar', { method: 'POST', body: {} }); toast(r.nuevos + ' clientes de prueba en la lista de GSG. Pulsa «Traer los pendientes de GSG».'); await cargar(); } catch (e) { toast(e.message); }
};
$('mot-cargar').onclick = async function () {
  try { var r = await api('/admin/motorizados/de-prueba', { method: 'POST', body: {} }); toast(r.nuevos + ' motorizados de prueba dados de alta.'); await cargar(); } catch (e) { toast(e.message); }
};
$('sim-modo').onchange = async function () {
  try { await api('/admin/entregas/simulador/modo', { method: 'POST', body: { modo: this.value } }); toast('El simulador ahora: ' + this.options[this.selectedIndex].text); } catch (e) { toast(e.message); }
};
$('sim-reiniciar').onclick = async function () {
  var si = await confirmarDialogo({ titulo: 'Reiniciar el simulador', texto: 'Se vacían sus listas y lo recibido. Las entregas ya creadas aquí no se tocan.', boton: 'Reiniciar', peligro: true });
  if (!si) return;
  try { await api('/admin/entregas/simulador', { method: 'DELETE' }); toast('Simulador vacío.'); await cargar(); } catch (e) { toast(e.message); }
};

/* El dia de prueba: se sigue paso a paso mientras corre. */
var guionTimer = null;
var guionVueltas = 0;
function pintarGuion(g) {
  var ol = $('sim-dia-pasos');
  var res = $('sim-dia-resumen');
  ol.classList.toggle('hidden', !g.pasos.length);
  ol.innerHTML = g.pasos.map(function (p) {
    var ico = p.estado === 'hecho' ? '✓' : p.estado === 'fallo' ? '✗' : p.estado === 'saltado' ? '–' : '…';
    return '<li class="paso-' + p.estado + '"><b>' + ico + '</b> ' + esc(p.texto) + (p.detalle ? ' <span class="muted">· ' + esc(p.detalle) + '</span>' : '') + '</li>';
  }).join('');
  res.classList.toggle('hidden', !g.resumen);
  res.textContent = g.resumen || '';
  var corriendo = g.estado === 'corriendo';
  $('sim-dia').disabled = corriendo;
  $('sim-dia-parar').classList.toggle('hidden', !corriendo);
  if (corriendo) ol.scrollTop = ol.scrollHeight;
}
async function seguirGuion() {
  try {
    var g = await api('/admin/entregas/simulador/probar-dia');
    pintarGuion(g);
    if (g.estado !== 'corriendo') { guionTimer = null; await cargar(); return; }
    guionVueltas++;
    /* La tabla de pedidos se refresca cada tres vueltas: basta para verlo avanzar. */
    if (guionVueltas % 3 === 0) await cargar();
    guionTimer = setTimeout(seguirGuion, 1000);
  } catch (e) {
    /* Si se deja de poder preguntar, se dice: antes se quedaba mudo. */
    guionTimer = null;
    $('sim-dia').disabled = false;
    $('sim-dia-parar').classList.add('hidden');
    var res = $('sim-dia-resumen');
    res.textContent = 'Se dejó de seguir el día de prueba: ' + e.message;
    res.classList.remove('hidden');
  }
}
$('sim-dia').onclick = async function () {
  try {
    await api('/admin/entregas/simulador/probar-dia', { method: 'POST', body: {} });
    toast('Empieza el día de prueba: mira los pasos aquí abajo y la tabla de pedidos.');
    $('caja-sim').classList.remove('cerrada');
    if (!guionTimer) seguirGuion();
  } catch (e) { toast(e.message); }
};
$('sim-dia-parar').onclick = async function () {
  try { await api('/admin/entregas/simulador/probar-dia', { method: 'DELETE' }); toast('Se detiene al terminar el paso actual.'); } catch (e) { toast(e.message); }
};
/* Si el dia de prueba ya corre (o acaba de terminar) y se abre Hoy de nuevo, se sigue desde donde va. */
api('/admin/entregas/simulador/probar-dia').then(function (g) {
  if (g && g.pasos && g.pasos.length) { pintarGuion(g); if (g.estado === 'corriendo' && !guionTimer) seguirGuion(); }
}).catch(function () { /* sin simulador no hay dia de prueba */ });

/* ----------------------------------------- necesitan a alguien y otros -- */
$('alguien').addEventListener('click', async function (ev) {
  var enlace = ev.target.closest('[data-ir-fila]');
  if (enlace) {
    ev.preventDefault();
    var id = enlace.getAttribute('data-ir-fila');
    abiertas[id] = true;
    filtro = '';
    $('buscar').value = '';
    repintarFiltro();
    var td = $('detalle-' + id);
    if (td) td.scrollIntoView({ block: 'center' });
    return;
  }
  var b = ev.target.closest('button[data-sol-reintentar]');
  if (!b) return;
  b.disabled = true;
  try {
    await api('/admin/rutas/solicitudes/' + b.getAttribute('data-sol-reintentar') + '/reintentar', { method: 'POST', body: {} });
    toast('Vuelve a la cola: se le pedirá la ubicación otra vez.');
    await cargar();
  } catch (e) { toast(e.message); b.disabled = false; }
});

$('otros').addEventListener('click', async function (ev) {
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
$('otros-nuevo').onclick = async function () {
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

/* -------------------------------------------------- guardar los ajustes - */
$('aj-guardar').onclick = async function () {
  var estado = $('aj-estado');
  var b = this;
  /* Un campo vacio o con letras no debe mandar NaN al servidor: se queda el de siempre. */
  var num = function (id, porDefecto) { var n = Number($(id).value); return Number.isFinite(n) && n > 0 ? n : porDefecto; };
  b.disabled = true;
  estado.textContent = 'Guardando…';
  try {
    var textos = {};
    document.querySelectorAll('[data-texto]').forEach(function (t) { textos[t.getAttribute('data-texto')] = t.value; });
    await api('/admin/entregas/ajustes', { method: 'POST', body: {
      horarioEntregas: { desde: $('aj-hor-desde').value || '14:00', hasta: $('aj-hor-hasta').value || '20:00', extendidoHasta: $('aj-hor-ext').value || '22:00' },
      soporte: { whatsapp: $('aj-sop-wa').value.replace(/\D/g, ''), llamadas: $('aj-sop-tel').value.replace(/\D/g, '') },
      margenMinutos: Number($('aj-margen').value) || 0,
      confirmacionEsperaMin: num('aj-conf-espera', resumen.ajustes.confirmacionEsperaMin),
      confirmacionMaxIntentos: num('aj-conf-max', resumen.ajustes.confirmacionMaxIntentos),
      motorizadoEsperaMin: num('aj-mot-espera', resumen.ajustes.motorizadoEsperaMin),
      motorizadoMaxIntentos: num('aj-mot-max', resumen.ajustes.motorizadoMaxIntentos),
      sincronizarCadaMin: num('aj-sync', resumen.ajustes.sincronizarCadaMin),
      leerConIA: $('aj-leer-ia').checked,
      redactarConIA: $('aj-redactar-ia').checked,
      mandarPinAlMotorizado: $('aj-pin').checked,
      avisarEntregado: $('aj-avisar-entregado').checked,
      responderDondeEsta: $('aj-donde-esta').checked,
      cierreDelDia: { activo: $('aj-cierre-activo').checked, hora: Number(String($('aj-cierre-hora').value || '0').split(':')[0]) || 0 },
      usarBotones: $('aj-botones').checked,
      avisarCerca: $('aj-cerca').checked,
      segundaVisita: { activa: $('aj-sv-activa').checked, esperaMin: num('aj-sv-espera', 30) },
      clienteRecurrente: { activo: $('aj-rec-activo').checked, diasMaximo: num('aj-rec-dias', 60), esperaMin: num('aj-rec-espera', 60) },
      plantillas: { confirmacion: $('aj-pl-confirmacion').value.trim(), motorizado: $('aj-pl-motorizado').value.trim(), aviso: $('aj-pl-aviso').value.trim() },
      textos: textos
    } });
    ajustesTocados = false;
    estado.textContent = 'Guardado.';
    setTimeout(function () { if (!ajustesTocados) estado.textContent = ''; }, 4000);
    await cargar();
  } catch (e) {
    estado.textContent = e.message;
  }
  b.disabled = false;
};

/* ------------------------------------------------------ plegar y abrir -- */
/* Las cajas plegables se abren con el raton y con el teclado. */
document.querySelectorAll('.caja.plegable > h2').forEach(function (h) {
  var caja = h.parentElement;
  h.setAttribute('role', 'button');
  h.setAttribute('tabindex', '0');
  h.setAttribute('aria-expanded', caja.classList.contains('cerrada') ? 'false' : 'true');
  var alternar = function () { h.setAttribute('aria-expanded', caja.classList.toggle('cerrada') ? 'false' : 'true'); };
  h.onclick = alternar;
  h.onkeydown = function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); alternar(); } };
});
$('tira-resumen').onclick = function () {
  this.setAttribute('aria-expanded', $('tira').classList.toggle('abierta') ? 'true' : 'false');
};

/* --------------------------------------------------------------- refresco
   Cada 10 s, pero sin pisar a quien esta escribiendo, con un cuadro abierto
   o con la pestaña de fondo. */
document.addEventListener('ia:cambio', function () { cargar(); });
setInterval(function () {
  if (document.hidden) return;
  var activo = document.activeElement;
  if (activo && (activo.tagName === 'INPUT' || activo.tagName === 'TEXTAREA')) return;
  if (document.querySelector('.dlg-fondo')) return;
  cargar();
}, 10000);
cargar();
`;

  return appShell({
    titulo: 'Hoy',
    subtitulo: 'Cada pedido de hoy: en qué paso va, qué le falta y quién necesita a alguien',
    contenido,
    script,
    css: CSS,
    nombreNegocio: opts.nombreNegocio,
    demo,
    icono: '🛵',
  });
}
