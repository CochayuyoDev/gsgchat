/**
 * Pantalla de ubicaciones para reparto.
 *
 * Es la pantalla de quien coordina el reparto por la manana: pega la lista
 * del dia, le da a empezar y mira dos cosas -cuanto va y que casos necesitan
 * a una persona-. Todo lo demas esta detras de esas dos.
 *
 * Decisiones de la pantalla, por si alguien las cambia sin saber por que:
 *
 *  - Un solo numero grande: "N de M con ubicacion". Es el unico dato que se
 *    mira de lejos; el resto son filtros pequenos, no cifras que compitan.
 *  - Los filtros de arriba son preguntas de la operacion ("¿a quien le falta
 *    la ubicacion?"): al pulsar uno, la tabla se queda solo con eso. Los que
 *    solo aparecen cuando hay problemas (numero mal, sin WhatsApp, para el
 *    repartidor) se esconden si estan a cero: nada que hacer, nada que ver.
 *  - Cada cosa se dice UNA vez: el chip dice el estado, la columna "Que pasa"
 *    dice el detalle (por que, desde cuando), y ninguna repite a la otra.
 *  - No hay confirm() ni alert(): un dialogo del navegador congela la pagina
 *    entera, y esta se refresca sola cada diez segundos.
 *  - El detalle se abre al lado, no encima: quien corrige un telefono
 *    necesita seguir viendo la lista.
 *
 * Los colores, las medidas y las clases comunes (.btn, .tarjeta, .chip,
 * .vacio) las pone el armazon: aqui solo va lo propio del reparto.
 *
 * El JS va en String.raw y con var, como el resto de paginas.
 */

import { appShell } from './shell.js';
import { TEXTOS_POR_DEFECTO } from '../entregas/textos.js';
import { REPARTO_CSS, REPARTO_JS } from './reparto-comun.js';
import { PESTANAS_PEDIDOS_CSS, PESTANAS_PEDIDOS_JS, pestanasPedidosHtml } from './pestanas-pedidos.js';

const CSS = `${REPARTO_CSS}
.ref-pedido { white-space: nowrap; font-weight: 600; }
/* Detalle de un cliente */
.d-cab { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 10px; }
.d-nombre { font-size: 17px; }
.d-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; margin: 0 0 10px; }
.d-meta span { display: grid; gap: 2px; padding: 8px 10px; border-radius: 8px; background: var(--gris-suave); font-size: 13.5px; overflow-wrap: anywhere; }
.d-meta small { font-size: 11.5px; color: var(--texto-suave); text-transform: none; letter-spacing: 0; }
.d-dir { margin: 0 0 10px; font-size: 13.5px; color: var(--texto-suave); }
.d-titulo { font-size: 12.5px; text-transform: none; letter-spacing: 0; color: var(--texto-suave); margin: 16px 0 8px; }
.d-bloque { margin-top: 6px; padding: 4px 12px 12px; border: 1px solid var(--borde); border-radius: 10px; }
.d-bloque .d-titulo { margin-top: 10px; }
.d-bloque .campo label { font-size: 13px; font-weight: 600; }
.d-acciones { gap: 8px; flex-wrap: wrap; }
.d-peligro { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--borde); }
/* «Ver qué pasó con este pedido» */
.qp-btn { width: 100%; margin: 10px 0 2px; font-weight: 600; }
.qp-fondo { position: fixed; inset: 0; z-index: 120; display: grid; place-items: center; padding: 16px; background: rgba(11, 20, 26, .55); }
.qp { font-family: var(--fuente, system-ui, sans-serif); background: var(--panel, #fff); color: var(--texto, #111b21); border-radius: 14px; width: min(640px, 100%); max-height: calc(100vh - 32px); overflow: auto; padding: 20px; box-shadow: 0 18px 50px rgba(0,0,0,.28); }
.qp h3 { margin: 0 0 4px; font-size: 17px; }
.qp .qp-sub { margin: 0 0 14px; font-size: 13px; color: var(--texto-suave); overflow-wrap: anywhere; }
.qp-diag { border-radius: 10px; padding: 12px 14px; margin: 0 0 12px; border: 1px solid var(--borde); }
.qp-diag b { display: block; font-size: 15.5px; margin-bottom: 4px; }
.qp-diag p { margin: 0; font-size: 13.5px; line-height: 1.45; }
.qp-diag .qp-hacer { margin-top: 8px; font-weight: 600; }
.qp-diag.bad { background: #fef2f2; border-color: #fecaca; } .qp-diag.bad b { color: #b91c1c; }
.qp-diag.warn { background: #fffbeb; border-color: #fde68a; } .qp-diag.warn b { color: #92400e; }
.qp-diag.ok { background: #f0fdf4; border-color: #bbf7d0; } .qp-diag.ok b { color: #166534; }
.qp-avisos { margin: 0 0 12px; padding: 0; list-style: none; display: grid; gap: 6px; }
.qp-avisos li { font-size: 13px; padding: 8px 10px; border-radius: 8px; background: var(--gris-suave); line-height: 1.4; }
.qp-avisos li.bad { background: #fef2f2; color: #991b1b; } .qp-avisos li.warn { background: #fffbeb; color: #92400e; }
.qp-cifras { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 6px; margin: 0 0 14px; }
.qp-cifras span { display: grid; gap: 2px; padding: 8px 10px; border-radius: 8px; background: var(--gris-suave); font-size: 15px; font-weight: 600; }
.qp-cifras small { font-size: 11.5px; font-weight: 400; color: var(--texto-suave); }
.qp-linea { list-style: none; margin: 0; padding: 0; border-left: 2px solid var(--borde); }
.qp-linea li { position: relative; padding: 0 0 10px 14px; font-size: 13.5px; line-height: 1.4; }
.qp-linea li::before { content: ''; position: absolute; left: -6px; top: 5px; width: 10px; height: 10px; border-radius: 50%; background: #9ca3af; }
.qp-linea li.ok::before { background: #16a34a; } .qp-linea li.bad::before { background: #dc2626; } .qp-linea li.warn::before { background: #d97706; }
.qp-linea small { display: block; color: var(--texto-suave); font-size: 12px; }
.qp-linea .qp-det { display: block; color: var(--texto-suave); font-size: 12.5px; margin-top: 2px; overflow-wrap: anywhere; }
.qp-pie { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
@media (prefers-color-scheme: dark) {
  .qp-diag.bad, .qp-avisos li.bad { background: rgba(220,38,38,.14); border-color: rgba(220,38,38,.4); color: inherit; }
  .qp-diag.warn, .qp-avisos li.warn { background: rgba(217,119,6,.14); border-color: rgba(217,119,6,.4); color: inherit; }
  .qp-diag.ok { background: rgba(22,163,74,.14); border-color: rgba(22,163,74,.4); }
}
.d-peligro .btn { color: var(--rojo); border-color: color-mix(in srgb, var(--rojo) 35%, transparent); }
.d-peligro .btn:hover { background: var(--rojo); border-color: var(--rojo); color: #fff; }
.d-linea { list-style: none; margin: 0 0 0 6px !important; padding: 0 0 0 16px !important; border-left: 2px solid var(--borde); display: grid; gap: 10px; }
.d-linea li { position: relative; font-size: 13.5px; padding: 0 !important; border: none !important; }
.d-linea li::before { content: ''; position: absolute; left: -23px; top: 5px; width: 10px; height: 10px; border-radius: 50%; background: var(--primario); border: 2px solid var(--superficie); }
.d-linea .cuando { font-weight: 600; color: var(--texto); }
/* Enviar a GSG */
.g-estado { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 8px; }
.g-destino { font-size: 13px; color: var(--texto-suave); overflow-wrap: anywhere; }
.g-nota { margin: 0 0 12px; font-size: 13px; }
.g-cifras { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.g-cifra { display: grid; gap: 2px; padding: 10px 12px; border-radius: 10px; background: var(--gris-suave); }
.g-cifra b { font-size: 22px; line-height: 1.1; }
.g-cifra span { font-size: 12.5px; color: var(--texto-suave); }
.g-cifra.g-verde b { color: var(--verde); }
.g-cifra.g-ambar { background: var(--ambar-suave); } .g-cifra.g-ambar b { color: var(--ambar); }
.g-cifra.g-rojo { background: var(--rojo-suave); } .g-cifra.g-rojo b { color: var(--rojo); }
.g-botones { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
.wrap.modo-ajustes > :not(.pp-pestanas):not(#caja-ajustes):not(.demo):not(.aviso) { display: none !important; }
  * { box-sizing: border-box; }
  .wrap { color: var(--texto); font: var(--fs-cuerpo)/1.5 var(--fuente); }

  /* Los dos avisos de arriba (demostración y WhatsApp sin conectar) hablan
     igual: fondo ámbar suave y texto ámbar, que pasa AA en los dos modos. */
  .demo, .aviso { margin-bottom: var(--esp-3); flex-wrap: wrap; }
  .demo a, .aviso a { font-weight: 700; }

  /* La barra de arriba: qué se mira (día y lote) a la izquierda, qué se hace
     (cargar, pausar, empezar) a la derecha, y debajo cuánto va. */
  .barra { display: grid; gap: 0; padding: 0; margin-bottom: var(--esp-3); overflow: hidden; }
  .barra-fila { display: flex; align-items: center; gap: var(--esp-3) var(--esp-4); flex-wrap: wrap; padding: 12px 16px; }
  .barra-fila .sep { flex: 1; }
  .barra-grupo { display: flex; align-items: center; gap: var(--esp-2); flex-wrap: wrap; min-width: 0; }
  .barra-etq { font-size: var(--fs-micro); font-weight: 700; text-transform: none; letter-spacing: 0; color: var(--texto-suave); }
  .barra select { min-height: var(--alto-control-sm); padding-top: 5px; padding-bottom: 5px; max-width: 260px; }
  .barra-acciones .btn { flex: none; }

  .wrap textarea { width: 100%; min-height: 150px; font-family: var(--mono); font-size: 13px; }

  /* Cuánto va y qué está haciendo el motor: la única cifra grande. */
  .progreso { display: flex; align-items: center; gap: var(--esp-2) var(--esp-4); flex-wrap: wrap; padding: 12px 16px; border-top: 1px solid var(--borde); background: var(--superficie-2); }
  .progreso:empty { display: none; }
  .cifra { border: 0; background: transparent; padding: 0; color: var(--texto-suave); font-size: var(--fs-small); text-align: left; cursor: pointer; }
  .cifra b { color: var(--texto); font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .cifra-cuando { color: var(--primario); font-weight: 600; }
  .cifra:hover b { color: var(--primario); }
  .progreso-barra { flex: 1; min-width: 180px; height: 8px; border-radius: 999px; background: var(--borde); overflow: hidden; }
  .progreso-barra > span { display: block; height: 100%; background: var(--verde);  }
  .motor { display: inline-flex; align-items: center; gap: 7px; font-size: var(--fs-small); color: var(--texto-suave); }
  .motor .punto { width: 9px; height: 9px; border-radius: 50%; background: var(--gris-claro); flex: none; }
  .motor.va .punto { background: var(--verde);  }
  .motor.espera .punto { background: var(--ambar); }

  .fallo { color: var(--rojo); font-size: var(--fs-small); }

  /* Los filtros: preguntas de la operación, no adornos. */
  .filtros { display: flex; gap: var(--esp-2); flex-wrap: wrap; margin-bottom: var(--esp-3); }
  /* Los mismos contadores que la pestaña Pedidos: texto y cifra en su pastilla. */
  .filtro {
    display: inline-flex; align-items: center; gap: 8px; min-height: 34px; padding: 5px 12px;
    border: 1px solid var(--borde); border-radius: 999px; background: var(--superficie);
    color: var(--texto); font: inherit; font-size: 13.5px; font-weight: 500; cursor: pointer;

  }
  .filtro:hover { border-color: var(--texto-suave); }
  .filtro .n { font-weight: 700; font-size: 13px; min-width: 22px; padding: 1px 7px; border-radius: 999px; background: var(--superficie-2); text-align: center; font-variant-numeric: tabular-nums; }
  .filtro[aria-pressed="true"] .n { background: var(--primario); color: var(--primario-texto); }
  .filtro.urge .n { background: var(--rojo-suave); }
  .filtro[aria-pressed="true"] { border-color: var(--primario); background: var(--primario-suave); color: var(--primario); font-weight: 600; }
  .filtro.urge { border-color: var(--rojo); color: var(--rojo); }
  .filtro.urge[aria-pressed="true"] { background: var(--rojo-suave); border-color: var(--rojo); color: var(--rojo); }

  .cols { display: grid; grid-template-columns: 1fr 380px; gap: var(--esp-3); align-items: start; }
  @media (max-width: 1100px) { .cols { grid-template-columns: minmax(0, 1fr); } }

  /* Las cajas son la .tarjeta del armazón, pero con cabecera propia: el
     relleno lo pone cada zona, no la tarjeta. */
  .panel { padding: 0; overflow: hidden; }
  .panel > h2 {
    font-size: var(--fs-h3); margin: 0; padding: 12px 16px; border-bottom: 1px solid var(--borde);
    display: flex; align-items: center; gap: var(--esp-2); background: var(--superficie);
  }
  .panel > h2 .sep { flex: 1; }
  .panel > h2 input { font-weight: 400; font-size: 13.5px; min-height: var(--alto-control-sm); padding-top: 5px; padding-bottom: 5px; }
  .panel .cuerpo { padding: var(--esp-4); }
  .panel .vacio { border: 0; background: transparent; }

  table { width: 100%; border-collapse: collapse; font-size: var(--fs-cuerpo); }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--borde); vertical-align: top; }
  th { position: sticky; top: 0; z-index: 1; }
  tbody tr { cursor: pointer; }
  tbody tr:hover { background: var(--superficie-2); }
  tbody tr.activa { background: var(--primario-suave); box-shadow: inset 3px 0 0 var(--primario); }
  td b { font-weight: 600; }
  td .sub { color: var(--texto-suave); font-size: var(--fs-small); }
  .tabla-scroll { max-height: 62vh; overflow: auto; }
  .filtro-lista { display: grid; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--borde); }
  .fd-fila { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .fd-fila #buscar { flex: 1 1 260px; min-height: var(--alto-control-sm); }
  .fd-fila #f-mas { flex: none; }
  .fd-cuantos { color: var(--primario); font-weight: 700; }
  .fd-cuantos:empty { display: none; }
  .fd-limpiar { align-self: end; justify-self: start; }
  .fd-resumen button { border: 0; background: none; color: var(--primario); font: inherit; font-weight: 600; cursor: pointer; padding: 0; text-decoration: underline; }
  .fd-campos { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px 12px; padding: 12px 16px; border-top: 1px solid var(--borde); background: var(--superficie); }
  .barra-mas[aria-expanded="true"] { border-color: var(--primario); color: var(--primario); background: var(--primario-suave); }
  .fd-campos[hidden] { display: none; }
  .fd-campos label { display: grid; gap: 4px; font-size: var(--fs-micro); color: var(--texto-suave); font-weight: 700; text-transform: none; letter-spacing: 0; min-width: 0; }
  .fd-campos input, .fd-campos select { width: 100%; min-height: var(--alto-control-sm); font-weight: 400; font-size: 13.5px; color: var(--texto); text-transform: none; letter-spacing: 0; }
  .fd-resumen { margin: 0; font-size: var(--fs-small); }
  .fd-resumen:empty { display: none; }

  .campo { margin-bottom: var(--esp-3); }
  .campo label { display: block; font-size: var(--fs-small); color: var(--texto-suave); margin-bottom: 4px; }
  .campo input { width: 100%; }
  .fila { display: flex; gap: var(--esp-2); flex-wrap: wrap; align-items: center; }
  .fila > * { flex: 1; min-width: 120px; }
  .fila > .fijo { flex: none; min-width: 0; }

  .bitacora { list-style: none; margin: 0; padding: 0; font-size: 13px; }
  .bitacora li { padding: 7px 0; border-bottom: 1px dashed var(--borde); }
  .bitacora .cuando { color: var(--texto-suave); font-size: var(--fs-small); }

  /* Los que ya escribieron y nunca mandaron el pin. */
  .contactos { margin-top: var(--esp-2); border: 1px solid var(--borde); border-radius: var(--radio-sm); max-height: 260px; overflow: auto; }
  .contactos .cab { display: flex; gap: var(--esp-2); align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--borde); position: sticky; top: 0; background: var(--superficie); font-size: var(--fs-small); }
  .contactos label.uno { display: flex; gap: var(--esp-2); align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--borde); cursor: pointer; }
  .contactos label.uno:last-child { border-bottom: 0; }
  .contactos input[type=checkbox] { width: auto; flex: none; }
  .contactos .quien { flex: 1; min-width: 0; }
  .contactos .quien b { display: block; font-size: 13.5px; }
  .contactos .quien span { color: var(--texto-suave); font-size: 12px; }

  .resumen-carga { font-size: var(--fs-cuerpo); margin-top: var(--esp-3); }
  .resumen-carga b { font-size: 16px; }
  .resumen-carga .linea { padding: 4px 0; border-bottom: 1px dashed var(--borde); }

  /* Ajustes: frases con huecos, no un formulario de casillas sueltas. */
  .aj .aj-titulo { font-size: var(--fs-h3); margin: 0 0 2px; display: flex; align-items: center; gap: 10px; }
  .aj .aj-intro { margin: 0 0 16px; padding: 12px 14px; border-radius: 10px; background: var(--primario-suave); line-height: 1.6; }
  .aj .aj-intro span { display: block; margin-top: 4px; font-size: 13.5px; color: var(--texto-suave); }
  .aj .aj-bloques { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
  .aj .aj-bloque { border: 1px solid var(--borde); border-radius: 12px; padding: 16px 18px; background: var(--superficie); min-width: 0; }
  .aj .aj-ancho { grid-column: 1 / -1; }
  .aj .aj-paso { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: var(--primario); color: var(--primario-texto); font-size: 13px; font-weight: 700; flex: none; }
  .aj .aj-que { margin: 0 0 8px 36px; font-size: 13.5px; color: var(--texto-suave); }
  /* Guardar siempre a la vista, a la derecha; «Volver a lo de siempre» es secundario. */
  .aj .aj-guardar-barra { position: sticky; bottom: 0; margin-top: 14px; padding: 12px 0; background: var(--superficie); border-top: 1px solid var(--borde); z-index: 2; justify-content: flex-end; }
  .aj .aj-guardar-barra #aj-estado { order: -1; margin-right: auto; flex: 1 1 auto; }
  .aj .aj-guardar-barra #aj-guardar { order: 2; min-width: 120px; }
  @media (max-width: 860px) { .aj .aj-bloques { grid-template-columns: minmax(0, 1fr); } .aj .aj-que { margin-left: 0; } }
  .aj .aj-frase { margin: 0; line-height: 2.1; font-size: var(--fs-cuerpo); }
  .aj .aj-num { width: 64px; padding: 4px 8px; text-align: center; font: inherit; margin: 0 2px; }
  .aj .paso { border: 1px solid var(--borde); border-radius: var(--radio-sm); padding: 12px 14px; margin-top: var(--esp-2); background: var(--superficie-2); }
  .aj .paso h4 { margin: 0 0 6px; font-size: var(--fs-h3); }
  /* Cada seguimiento: un solo texto. */
  #aj-pasos-adicionales .paso { display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px var(--esp-4); }
  #aj-pasos-adicionales .variante[hidden] { display: none; }
  #aj-pasos-adicionales .paso > h4, #aj-pasos-adicionales .paso > [data-quitar-adicional] { grid-column: 1 / -1; }
  #aj-pasos-adicionales .paso > [data-quitar-adicional] { justify-self: end; }
  #aj-pasos-adicionales .variante { display: flex; flex-direction: column; min-width: 0; padding: 10px 12px; border-radius: var(--radio-sm); background: var(--superficie); border: 1px solid var(--borde); }
  #aj-pasos-adicionales .variante h5 { margin: 0 0 6px; font-size: var(--fs-small); text-transform: none; letter-spacing: 0; color: var(--texto-suave); }
  #aj-pasos-adicionales .variante .previa { flex: 1; }
  .aj-editor-inicial { margin-top: 14px; padding: 14px 16px; border: 1px solid var(--borde); border-radius: var(--radio); background: var(--superficie); }
  .aj-editor-inicial .aj-ei-cab { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
  .aj-editor-inicial .aj-ei-cab h4 { margin: 0; font-size: 15px; }
  .aj-editor-inicial .aj-ei-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: start; margin: 8px 0 10px; }
  .aj-editor-inicial textarea { width: 100%; box-sizing: border-box; font: inherit; font-size: 14px; line-height: 1.45; }
  .aj-editor-inicial .aj-ei-previa { white-space: pre-wrap; margin-top: 6px; }
  .aj-editor-inicial .fila { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-start; }
  .aj-editor-inicial .fila .btn { flex: 0 0 auto; width: auto; }
  .aj-editor-inicial .aj-ei-ayuda { font-size: 12.5px; color: var(--texto-suave); margin: 8px 0 6px; }
  .aj-editor-inicial .aj-ei-datos { display: flex; flex-wrap: wrap; gap: 6px; }
  .aj-editor-inicial .aj-ei-datos button { border: 1px solid var(--borde); background: var(--superficie-2); color: inherit; font: inherit; font-size: 12.5px; padding: 4px 10px; border-radius: 999px; cursor: pointer; }
  .aj-editor-inicial .aj-ei-datos button:hover, .aj-editor-inicial .aj-ei-datos button:focus-visible { border-color: var(--primario); color: var(--primario); }
  @media (max-width: 760px) { .aj-editor-inicial .aj-ei-cols { grid-template-columns: minmax(0, 1fr); } }
  @media (max-width: 900px) { #aj-pasos-adicionales .paso { grid-template-columns: minmax(0, 1fr); } }
  .aj .paso .cuando { color: var(--texto-suave); font-size: var(--fs-small); margin: 0 0 8px; }
  .aj .previa { background: var(--verde-suave); color: var(--texto); border-radius: var(--radio-sm); padding: 9px 12px; font-size: 13.5px; line-height: 1.45; white-space: pre-wrap; max-width: 620px; }
  .aj .previa .previa-msg + .previa-msg { margin-top: 8px; padding-top: 8px; border-top: 1px dashed color-mix(in srgb, var(--verde) 35%, transparent); }
  .aj .previa .previa-n { display: block; font-size: 11px; font-weight: 700; letter-spacing: 0; text-transform: none; color: var(--texto-suave); margin-bottom: 2px; }
  .aj .previa small { display: block; color: var(--texto-suave); font-size: 11px; margin-top: 4px; text-align: right; }
  .aj .paso textarea { margin-top: 8px; min-height: 64px; font-family: var(--fuente); font-size: 14px; }
  .aj .marcadores { font-size: var(--fs-small); color: var(--texto-suave); margin: 6px 0 0; }
  .aj .marcadores code { background: var(--superficie); border: 1px solid var(--borde); border-radius: 5px; padding: 1px 5px; font-size: 12px; cursor: pointer; }
  .aj-intro { margin: 0; padding: 12px 14px; border-radius: var(--radio-sm); background: var(--superficie-2); color: var(--texto-suave); }
  .aj-tandas-check { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; cursor: pointer; }
  .aj-ayuda-tandas { margin: 8px 0 0; color: var(--texto-suave); font-size: var(--fs-small); line-height: 1.5; max-width: 75ch; }
  .aj-ayuda-tandas:empty { display: none; }
  #aj-tandas .aj-titulo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .aj-seccion { margin-top: 18px; padding: 16px; border: 1px solid var(--borde); border-radius: var(--radio); background: var(--superficie); }
  .aj-seccion-inicial { border-color: var(--primario); background: var(--primario-suave); }
  .aj-seccion-cab { display: flex; align-items: flex-start; gap: 11px; margin-bottom: 12px; }
  .aj-seccion-cab h3 { margin: 0; font-size: var(--fs-h3); }
  .aj-seccion-cab p { margin: 3px 0 0; color: var(--texto-suave); font-size: var(--fs-small); line-height: 1.5; }
  .aj-paso-num { display: grid; place-items: center; flex: none; width: 28px; height: 28px; border-radius: 50%; background: var(--primario); color: #fff; font-size: 13px; font-weight: 700; }
  .aj-tiempo-inicial { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; line-height: 1.6; }
  .aj-tiempo-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .aj .aj-tiempo-paso { min-width: 0; margin: 0; padding: 13px; border: 1px solid var(--borde); border-radius: var(--radio-sm); background: var(--superficie-2); }
  .aj-tiempo-paso h4 { margin: 0 0 5px; font-size: 15px; }
  .aj-tiempo-paso .cuando { min-height: 18px; margin-bottom: 8px; }
  .aj-tiempo-control { display: flex; align-items: center; gap: 7px; }
  .aj-tiempo-control select { max-width: 120px; }
  .aj-fin { margin: 13px 0 0; padding-top: 11px; border-top: 1px solid var(--borde); }
  .aj-seccion .aj-titulo { margin-top: 0; }
#aj-plantilla-meta .pm-cab { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
#aj-plantilla-meta .pm-cab .aj-titulo { margin: 0; }
#aj-plantilla-meta .pm-intro { margin: 6px 0 10px; max-width: 75ch; }
#aj-plantilla-meta .pm-usar { display: flex; align-items: center; gap: 8px; font-weight: 600; margin: 0 0 10px; }
#aj-plantilla-meta .pm-usar input { width: auto; }
#aj-plantilla-meta .pm-fila { display: grid; gap: 4px; max-width: 420px; }
#aj-plantilla-meta .pm-fila label { font-size: 13px; font-weight: 600; }
#aj-plantilla-meta .pm-fila input { font-family: var(--mono, ui-monospace, monospace); }
#aj-plantilla-meta .pm-fila + .pm-fila { margin-top: 10px; }
#aj-plantilla-meta .pm-nota { font-size: 12.5px; }
.aj-con-meta { margin: 0 0 10px; padding: 9px 12px; border-radius: var(--radio-sm, 8px); border: 1px solid var(--borde); background: var(--superficie-2); font-size: 13.5px; }
#aj-plantilla-meta .pm-acciones { margin: 10px 0 0; gap: 8px; justify-content: flex-start; }
#aj-plantilla-meta .pm-acciones .btn { flex: 0 0 auto; width: auto; }
#aj-plantilla-meta .pm-aviso { margin: 10px 0 0; padding: 9px 12px; border-radius: var(--radio-sm, 8px); font-size: 13.5px; font-weight: 600; border: 1px solid var(--borde); }
#aj-plantilla-meta .pm-aviso.ok { color: var(--primario); border-color: color-mix(in srgb, var(--primario) 40%, transparent); background: color-mix(in srgb, var(--primario) 10%, transparent); }
#aj-plantilla-meta .pm-aviso.mal { color: var(--rojo); border-color: color-mix(in srgb, var(--rojo) 45%, transparent); background: var(--rojo-suave); }
#aj-plantilla-meta .pm-orden-t { margin: 4px 0 8px; }
#aj-plantilla-meta .pm-paso { display: grid; gap: 6px; max-width: 560px; padding: 10px 12px; margin-bottom: 8px; border: 1px solid var(--borde); border-radius: var(--radio-sm, 8px); }
#aj-plantilla-meta .pm-paso-cab { display: flex; align-items: center; gap: 10px; font-size: 13.5px; }
#aj-plantilla-meta .pm-paso select { font-family: var(--mono, ui-monospace, monospace); max-width: 100%; }
#aj-plantilla-meta .pm-previa-paso { font-size: 13px; white-space: pre-wrap; max-height: 150px; overflow: auto; }
#aj-plantilla-meta .pm-vars { display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 12.5px; align-items: center; }
#aj-plantilla-meta .pm-vars select { font-family: inherit; }
#aj-plantilla-meta .pm-datos { margin-top: 12px; }
#aj-plantilla-meta .pm-datos summary { cursor: pointer; font-weight: 600; color: var(--primario); }
#aj-plantilla-meta .pm-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; margin-top: 8px; }
#aj-plantilla-meta .pm-lista { margin: 0; padding-left: 0; list-style: none; display: grid; gap: 6px; font-size: 13.5px; }
#aj-plantilla-meta .pm-lista code { font-size: 12px; padding: 1px 6px; border-radius: 6px; background: var(--superficie-2); }
#aj-plantilla-meta .previa { white-space: pre-wrap; }
@media (max-width: 760px) { #aj-plantilla-meta .pm-cols { grid-template-columns: minmax(0, 1fr); } }
  @media (max-width: 780px) { .aj-tiempo-grid { grid-template-columns: minmax(0, 1fr); } }

  /* De pie y con una mano: la tabla deja de ser tabla y cada cliente es una
     ficha que se lee de arriba abajo. */
  @media (max-width: 680px) {
    /* La barra de arriba, de pie: el día ocupa el ancho y los botones van en su fila. */
    .barra-fila { gap: 10px; padding: 12px; }
    .barra-fila .sep { display: none; }
    .barra-grupo { flex: 1 1 100%; }
    .barra-grupo select { flex: 1; max-width: none; }
    .barra-acciones .btn { flex: 1 1 auto; }
    .barra-mas { flex: 1 1 100%; }
    .fd-campos { padding: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .progreso { padding: 10px 12px; }
    .panel > h2 { flex-wrap: wrap; }
    .panel > h2 input { max-width: none; flex: 1 1 100%; order: 3; }
    .panel > h2 .btn { order: 4; }
    .tabla-scroll { max-height: none; }
    thead { display: none; }
    tbody tr { display: block; padding: 10px 12px; border-bottom: 1px solid var(--borde); }
    tbody tr.activa { box-shadow: inset 3px 0 0 var(--primario); }
    .wrap tbody td { display: block; border: 0; padding: 1px 0; }
    .wrap tbody tr:last-child { border-bottom: 0; }
    /* Los filtros, en una fila que se desliza con el dedo. */
    .filtros { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; margin-left: -16px; margin-right: -16px; padding: 0 16px 2px; }
    .filtros::-webkit-scrollbar { display: none; }
    .filtro { flex: none; }
    tbody td:empty { display: none; }
  }
`;

export interface RutasOpts {
  configured: boolean;
  demo?: boolean;
  nombreNegocio: string;
}

export function rutasPage(opts: RutasOpts): string {
  const { configured, demo = false } = opts;
  /** Ver el mismo aviso en `chat-page.ts`: aqui no sale ningun mensaje. */
  const bandaDemo = demo
    ? `<div class="demo s-alerta info">Modo demostración: no se envía nada a ningún cliente.
         Para trabajar de verdad, conecta tu cuenta en <a href="/setup">/setup</a>.</div>`
    : '';

  const aviso = configured
    ? ''
    : `<div class="aviso s-alerta warn">Todavía no conectaste tu WhatsApp: puedes cargar la lista y revisarla, pero no saldrá ningún mensaje.
         <a href="/setup">Conectar ahora</a></div>`;

  const contenido = `
<div class="wrap">
  ${pestanasPedidosHtml()}
  ${bandaDemo}
  ${aviso}

  <!-- La barra de arriba manda sobre toda la pantalla: el día y el lote
       recortan el avance, los contadores y la lista a la vez. -->
  <div class="tarjeta barra" id="barra">
    <div class="barra-fila">
      <div class="barra-grupo">
        <span class="barra-etq" id="etq-dia">Día</span>
        <div class="s-segmento" role="group" aria-labelledby="etq-dia" id="filtro-dia">
          <button type="button" class="seg activo" data-rango="hoy" aria-pressed="true">Hoy</button>
          <button type="button" class="seg" data-rango="ayer" aria-pressed="false">Ayer</button>
          <button type="button" class="seg" data-rango="semana" aria-pressed="false">7 días</button>
          <button type="button" class="seg" data-rango="todos" aria-pressed="false">Todos</button>
        </div>
      </div>
      <div class="barra-grupo">
        <label class="barra-etq" for="lote">Lote</label>
        <select id="lote" aria-label="Elegir el lote que se mira"></select>
      </div>
      <button type="button" class="btn sm barra-mas" id="f-mas" aria-expanded="false" aria-controls="f-campos">Más filtros <span class="fd-cuantos" id="f-cuantos"></span></button>
      <span class="sep"></span>
      <div class="barra-grupo barra-acciones">
        <button type="button" class="btn sm" id="nuevo">Cargar lista nueva</button>
        <button type="button" class="btn sm" id="pausar">Pausar</button>
        <button type="button" class="btn primario sm" id="arrancar">Empezar a pedir</button>
      </div>
    </div>
    <!-- Más filtros: fechas exactas (cambian todo, como el día) y hora, distrito y estado (afinan la lista). -->
    <div class="fd-campos" id="f-campos" hidden>
      <label>Fecha desde <input type="date" id="f-desde"></label>
      <label>Fecha hasta <input type="date" id="f-hasta"></label>
      <label>Hora desde <input type="time" id="f-hora-desde"></label>
      <label>Hora hasta <input type="time" id="f-hora-hasta"></label>
      <label>Distrito <select id="f-distrito"><option value="">Todos</option></select></label>
      <label>Estado <select id="f-estado"><option value="">Todos los estados</option></select></label>
      <button type="button" class="btn sm fd-limpiar" id="f-limpiar">Quitar estos filtros</button>
    </div>
    <div class="progreso" id="progreso" role="status"></div>
  </div>

  <!-- Ajustes de chat: cómo se le escribe al cliente (horario, ritmo, insistencia y textos) -->
  <div class="tarjeta panel hidden" id="caja-ajustes" style="margin-bottom:var(--esp-3)">
    <h2>Ajustes de chat <span class="sep"></span>
      <button type="button" class="btn sm" id="cerrar-ajustes">Cerrar</button>
    </h2>
    <div class="cuerpo aj">
      <p class="aj-intro">
        <b>Configura cómo GSGchat pide la ubicación.</b> La solicitud inicial tiene su propio tiempo; los recordatorios empiezan después y esperan desde el mensaje anterior. Las horas son de Lima.
        <span>El nombre del negocio, el teléfono del supervisor y los avisos están en <a href="/panel#configuracion">Ajustes</a>. <a class="ver-manual" href="/manual#m-automatizacion-gsg">Ver instrucciones completas</a></span>
      </p>

      <section class="aj-seccion">
        <h3 class="aj-titulo">Horario de escritura</h3>
        <p class="aj-frase">Solo de las <input id="aj-hora-inicio" type="number" min="0" max="23" class="aj-num" aria-label="Hora de inicio">:00 a las <input id="aj-hora-fin" type="number" min="1" max="24" class="aj-num" aria-label="Hora de fin">:00. Fuera de ese horario, los mensajes esperan al día siguiente.</p>
      </section>

      <section class="aj-seccion" id="aj-plantilla-meta">
        <div class="pm-cab"><h3 class="aj-titulo">Plantillas aprobadas por Meta</h3><span id="pm-chip" class="chip" role="status">Revisando…</span></div>
        <p class="muted pm-intro">Con WhatsApp API, Meta solo deja escribirle primero a un cliente con una plantilla aprobada. El primer mensaje de cada pedido sale con esta plantilla y sus datos; si el cliente ya escribió en las últimas 24 h, sale el texto de siempre.</p>
        <label class="pm-usar"><input type="checkbox" id="pm-usar"> Usar la plantilla aprobada por Meta en el primer mensaje</label>
        <p class="pm-orden-t"><b>Orden en que salen</b> <span class="muted">(cada mensaje usa la plantilla que elijas; si el cliente ya escribió en las últimas 24 h, sale el texto normal del bot)</span></p>
        <div class="pm-paso">
          <div class="pm-paso-cab"><span class="aj-paso-num">1</span><div><b>Primer mensaje</b><span class="muted"> · sale al llegar el pedido de GSG</span></div></div>
          <select id="pm-nombre" aria-label="Plantilla del primer mensaje"></select>
          <div class="previa pm-previa-paso" id="pm-previa-primero"></div>
        </div>
        <div id="pm-seguimientos"></div>
        <p class="muted pm-nota" id="pm-sin-aprobadas" hidden>Todavía no hay plantillas aprobadas en la lista. Pulsa «Traer el estado desde Meta» para cargarlas.</p>
        <p class="muted pm-nota">Los tiempos de los recordatorios se cambian más abajo, en «Recordatorios y seguimientos». Si hay más recordatorios que plantillas, se repite la última.</p>
        <div class="fila pm-acciones">
          <button type="button" class="btn primario sm" id="pm-guardar">Guardar</button>
          <button type="button" class="btn sm" id="pm-traer">Traer el estado desde Meta</button>
        </div>
        <p class="pm-aviso" id="pm-aviso" role="status" hidden></p>
        <details class="pm-datos" open>
          <summary>Los 8 datos que se llenan solos</summary>
          <div class="pm-cols">
            <ol class="pm-lista" id="pm-lista"></ol>
            <div><span class="muted">Así le llega (ejemplo)</span><div class="previa" id="pm-previa"></div></div>
          </div>
        </details>
      </section>

      <section class="aj-seccion aj-seccion-inicial">
        <div class="aj-seccion-cab"><span class="aj-paso-num">1</span><div><h3>Solicitud inicial de ubicación</h3><p>Plantilla «Solicitud de ubicación» que se envía al llegar un pedido nuevo de GSG. Este tiempo no es un recordatorio.</p></div></div>
        <div id="aj-tiempo-solicitud"></div>
        <div id="aj-pasos"></div>
        <div class="aj-editor-inicial" id="aj-editor-inicial"><p class="aj-con-meta" id="aj-con-meta" hidden>Con la <b>plantilla aprobada por Meta</b> activa, por WhatsApp API el primer mensaje sale con esa plantilla. Este texto se usa solo si el cliente te escribió en las últimas 24 h o si el mensaje sale por una línea de QR.</p><div class="aj-ei-cab"><h4>Primer mensaje que recibe el cliente</h4><span id="aj-estado-texto-inicial" class="chip" role="status">Cargando…</span></div><p class="muted">Es lo que le llega al cliente cuando GSG manda su pedido. Cámbialo como quieras: a la derecha ves cómo le llega.</p><div class="aj-ei-cols"><div><label for="aj-texto-inicial">Texto</label><textarea id="aj-texto-inicial" rows="13" maxlength="2000" spellcheck="true"></textarea><p class="aj-ei-ayuda">Toca un dato para ponerlo donde está el cursor. Si a un pedido le falta un dato, esa línea no sale.</p><div class="aj-ei-datos" id="aj-datos-inicial"></div></div><div><span class="muted">Así le llega</span><div class="previa aj-ei-previa" id="aj-previa-inicial"></div></div></div><div class="fila"><button type="button" class="btn primario sm" id="aj-guardar-texto-inicial">Guardar el primer mensaje</button><button type="button" class="btn sm" id="aj-fabrica-texto-inicial">Volver al texto de fábrica</button></div></div><div class="aj-editor-inicial" id="aj-editor-otros"><div class="aj-ei-cab"><h4>Los demás mensajes del sistema</h4><span id="aj-estado-otros" class="chip" role="status">Cargando…</span></div><p class="muted">Los otros mensajes fijos del bot: el mensaje final («Ubicación registrada») y los del cambio de ubicación. El mensaje inicial y los recordatorios se editan arriba. No incluye al motorizado, al asistente ni a la IA. Las variables van entre llaves. Un texto igual al de fábrica no se guarda como propio; vaciarlo lo devuelve al de fábrica.</p><div id="aj-otros-lista"></div><div class="fila"><button type="button" class="btn primario sm" id="aj-guardar-otros">Guardar los mensajes</button></div></div>
      </section>

      <section class="aj-seccion">
        <div class="aj-seccion-cab"><span class="aj-paso-num">2</span><div><h3>Recordatorios y seguimientos</h3><p>Salen después de la solicitud inicial, uno tras otro.</p></div></div>
        <p class="aj-frase" style="margin-bottom:12px">Cada espera se cuenta desde el envío anterior. Puedes configurar hasta 99 recordatorios (100 mensajes en total, incluida la solicitud inicial).</p>
        <div id="aj-secuencia" class="aj-tiempo-grid"></div>
        <button type="button" class="btn sm" id="aj-agregar-mensaje" style="margin-top:12px">Agregar recordatorio</button>
        <p class="aj-frase aj-fin">Al terminar la secuencia, esperar <input id="aj-espera-final" data-duracion type="number" min="0" max="86400" class="aj-num" aria-label="Espera tras el último recordatorio"> <select id="aj-espera-final-unidad" data-unidad-for="aj-espera-final" aria-label="Unidad de espera tras el último recordatorio"><option value="1">segundos</option><option value="60" selected>minutos</option><option value="3600">horas</option></select> para reportar a GSG si aún no llegó la ubicación. Con 0, se reporta de inmediato.</p>
      </section>

      <section class="aj-seccion">
        <h3 class="aj-titulo">Pausa entre clientes</h3>
        <p class="aj-frase">Entre un cliente y el siguiente, esperar entre <input id="aj-pausa-min" data-duracion type="number" min="1" max="86400" class="aj-num" aria-label="Pausa mínima"> <select id="aj-pausa-min-unidad" data-unidad-for="aj-pausa-min" aria-label="Unidad de pausa mínima"><option value="1" selected>segundos</option><option value="60">minutos</option><option value="3600">horas</option></select> y <input id="aj-pausa-max" data-duracion type="number" min="1" max="86400" class="aj-num" aria-label="Pausa máxima"> <select id="aj-pausa-max-unidad" data-unidad-for="aj-pausa-max" aria-label="Unidad de pausa máxima"><option value="1" selected>segundos</option><option value="60">minutos</option><option value="3600">horas</option></select>. Esta pausa es independiente de los tiempos por pedido.</p>
      </section>

      <section class="aj-seccion" id="aj-tandas">
        <h3 class="aj-titulo">Envío por tandas <span class="chip tono-azul sin-punto">Solo WhatsApp API</span></h3>
        <p class="aj-frase"><label class="aj-tandas-check"><input type="checkbox" id="aj-tandas-activo" disabled> Enviar por tandas:</label> <input id="aj-tandas-tamano" disabled type="number" min="1" max="80" step="1" class="aj-num" aria-label="Mensajes por tanda"> mensajes cada <input id="aj-tandas-min" disabled type="number" min="2" max="60" step="1" class="aj-num" aria-label="Minutos entre tandas"> minutos.</p>
        <p class="aj-ayuda-tandas">Solo para los números de <b>WhatsApp API</b>: en vez de esperar entre cada cliente, salen hasta ese número de mensajes seguidos y después se espera. Entre tanda y tanda el sistema revisa los rechazos de Meta y frena si algo va mal. Los <b>números normales (con QR)</b> no cambian: siguen con la pausa entre clientes de arriba. Recomendado: 50 mensajes cada 3 minutos.</p>
        <p class="aj-ayuda-tandas" id="aj-tandas-estado" role="status"></p>
      </section>

      <section class="aj-seccion" id="aj-cambio-ubi">
        <h3 class="aj-titulo">Cambio de ubicación</h3>
        <p class="aj-frase">El cliente puede cambiar su ubicación diciendo «Cambio de Ubicación» hasta las <input id="aj-cu-hora" type="time" aria-label="Hora límite para cambiar la ubicación"> (por defecto 15:00, hora de Lima).</p>
        <label style="display:block;margin-top:8px"><strong>Después de esa hora, el mensaje de cambio de ubicación pasa a:</strong> <span class="muted">Variables: {horaLimite} {soporte}</span>
          <textarea id="aj-cu-texto" rows="4" style="width:100%"></textarea></label>
        <label style="display:block;margin-top:12px"><strong>Números de GSG que pueden ordenar el cambio aunque haya pasado la hora:</strong>
          <textarea id="aj-cu-autorizados" rows="2" maxlength="900" placeholder="999555111, 987654321" style="width:100%;box-sizing:border-box"></textarea></label>
        <p class="muted">Si un motorizado o alguien de GSG escribe <b>proceder cambio de ubicación</b> (con o sin tilde) a este WhatsApp, se registra la última ubicación que mandó el cliente y al cliente le llega «ubicación registrada». Escriben el tracking detrás: <b>proceder cambio de ubicación GSG-123</b> (sin tracking vale si solo un cliente espera un cambio). Separa los números con comas. El motorizado que GSG manda con el pedido puede hacerlo sin estar aquí, y un cliente nunca puede.</p>
        <div class="fila" style="margin-top:8px"><button type="button" class="btn primario" id="aj-cu-guardar">Guardar cambio de ubicación</button> <button type="button" class="btn" id="aj-cu-fabrica">Texto de fábrica</button> <span class="muted" id="aj-cu-estado" role="status"></span></div>
      </section>

      <section class="aj-seccion">
        <h3 class="aj-titulo">Textos de los seguimientos</h3>
        <p class="muted" style="margin-top:4px">Escribe el texto de cada seguimiento. Puedes dejar líneas en blanco entre párrafos.</p>
        <div id="aj-pasos-adicionales"></div>
      </section>

      <div class="fila aj-guardar-barra">
        <button type="button" class="btn primario fijo" id="aj-guardar">Guardar</button>
        <button type="button" class="btn fijo hidden" id="aj-descartar">Descartar cambios</button>
        <button type="button" class="btn fijo" id="aj-reset">Restablecer valores predeterminados</button>
        <span class="muted" id="aj-estado" role="status"></span>
      </div>
    </div>
  </div>

  <!-- Cargar un lote: se abre aqui mismo, sin dialogos que bloqueen -->
  <div class="tarjeta panel hidden" id="carga" style="margin-bottom:var(--esp-3)">
    <h2>Cargar la lista del día <span class="sep"></span>
      <button type="button" class="btn sm" id="cerrar-carga">Cerrar</button>
    </h2>
    <div class="cuerpo">
      <p class="muted" style="margin-top:0">
        Pega la tabla tal como la tengas (Excel, CSV o una lista de números). Se entienden las
        columnas <b>teléfono</b>, <b>nombre</b>, <b>pedido</b>, <b>dirección</b> y <b>distrito</b>,
        en cualquier orden. En cuanto pegues se te dice qué entendió.
      </p>
      <div class="campo">
        <label for="nombre-lote">Nombre del lote</label>
        <input id="nombre-lote" placeholder="Reparto del martes">
      </div>

      <!-- Los que ya te escribieron y nunca mandaron el pin: no hay que
           pegarlos de ninguna parte, ya estan en el sistema. -->
      <div class="campo">
        <div class="fila">
          <button type="button" class="btn sm fijo" id="traer-sin-ubicacion">Traer a los que no mandaron su ubicación</button>
          <span class="muted fijo" id="sin-ubicacion-cuenta"></span>
        </div>
        <div id="sin-ubicacion" class="contactos hidden"></div>
      </div>

      <label class="muted" for="pegado">O pega aquí la lista</label>
      <textarea id="pegado" placeholder="teléfono;nombre;pedido&#10;987654321;Ana Ruiz;P-1024&#10;912345678;Luis Paz;P-1025"></textarea>
      <div id="resumen-carga" class="resumen-carga" role="status"></div>
      <div class="fila" style="margin-top:var(--esp-3)">
        <button type="button" class="btn primario fijo" id="crear" disabled>Crear el lote</button>
        <label class="muted fijo" style="display:flex;align-items:center;gap:6px">
          <input type="checkbox" id="arrancar-ya" checked style="width:auto"> empezar a pedir en cuanto se cree
        </label>
      </div>
    </div>
  </div>

  <div class="filtros" id="filtros" role="group" aria-label="Qué clientes ver"></div>

  <div class="cols">
    <div class="tarjeta panel">
      <h2>
        <span id="titulo-lista">Clientes</span>
        <span class="sep"></span>
        <button type="button" class="btn sm" id="csv">Descargar CSV</button>
      </h2>
      <div class="filtro-lista">
        <div class="fd-fila">
          <input id="buscar" type="search" placeholder="Buscar cliente, tracking o celular" aria-label="Buscar cliente, tracking o celular">
        </div>
        <p class="muted fd-resumen" id="f-resumen" role="status"></p>
      </div>
      <div class="tabla-scroll">
        <table>
          <thead><tr>
            <th>Cliente</th><th>Pedido</th><th>Estado</th><th>Qué pasa</th>
          </tr></thead>
          <tbody id="filas"></tbody>
        </table>
      </div>
      <div id="lista-vacia"></div>
    </div>

    <div>
      <div class="tarjeta panel" id="detalle">
        <h2>Detalle <span class="sep"></span><button type="button" class="btn sm hidden" id="cerrar-detalle">Cerrar</button></h2>
        <div class="cuerpo">
          <!-- Tres zonas a proposito: 'info' e 'historial' se repintan con cada
               refresco y 'acciones' NO se toca mientras siga abierto el mismo
               cliente. Reconstruir un <input> mientras alguien escribe en el es
               la forma mas facil de borrarle lo que estaba corrigiendo. -->
          <div id="detalle-info">
            <p class="muted" style="margin:0">Elige un cliente de la lista para ver su historial y arreglar lo que haga falta.</p>
          </div>
          <div id="detalle-acciones"></div>
          <div id="detalle-historial"></div>
        </div>
      </div>

      <div class="tarjeta panel" style="margin-top:var(--esp-3)">
        <h2>Enviar a GSG</h2>
        <div class="cuerpo" id="gsg" aria-busy="true">
          <span class="esqueleto linea corta"></span><span class="esqueleto linea"></span><span class="esqueleto bloque" style="height:64px;margin-top:12px"></span>
        </div>
      </div>
    </div>
  </div>
</div>
`;

  const script = String.raw`
${REPARTO_JS}

/* --- estado de la pantalla ------------------------------------------- */
var resumen = null;      /* lo que devuelve /admin/rutas */
var loteActual = '';
var vista = 'todos';
var seleccionada = null; /* id de la solicitud abierta en el detalle */
var detalleId = null;    /* que cliente esta pintado en la zona de acciones */
var peticionDetalle = 0; /* numero de la ultima peticion de detalle lanzada */
var catalogo = {};       /* incidencias: codigo -> ficha */
var nombresVista = {};
var cifrasVista = {};
var ajustesCache = null, ajustesBase = null, ajustesSucios = false;
var sinUbicacion = [];   /* contactos traidos, para el lote nuevo */
var listasPegadas = 0;   /* filas utiles que dijo la ultima revision de lo pegado */

/**
 * Los filtros, en el orden en que se miran por la manana.
 *
 * Los nombres los pone el servidor (NOMBRES_VISTA): una sola forma de llamar
 * a cada cosa en toda la aplicacion. Los marcados "soloSiHay" son problemas:
 * si estan a cero no hay nada que hacer con ellos, asi que no ocupan sitio.
 */
var FILTROS = [
  { vista: 'requieren_persona', clase: 'urge' },
  { vista: 'privacidad', clase: 'urge', soloSiHay: true },
  { vista: 'sin_ubicacion' },
  { vista: 'pendientes' },
  { vista: 'esperando' },
  { vista: 'respondieron' },
  { vista: 'numero_malo', soloSiHay: true },
  { vista: 'sin_whatsapp', soloSiHay: true },
  { vista: 'derivados', soloSiHay: true },
  { vista: 'todos' }
];

/* El estado de un cliente, en una palabra y con el tono de siempre. */
var ESTADOS = {
  pendiente:   { texto: 'Sin escribir', tono: 'gris' },
  enviado:     { texto: 'Esperando respuesta', tono: 'azul' },
  respondio:   { texto: 'Contestó sin ubicación', tono: 'ambar' },
  resuelto:    { texto: 'Ubicación recibida', tono: 'verde' },
  supervision: { texto: 'Necesita revisión', tono: 'ambar' },
  derivado:    { texto: 'Para el repartidor', tono: 'ambar' },
  incidencia:  { texto: 'No se puede escribir', tono: 'rojo' },
  cancelado:   { texto: 'Cancelado', tono: 'gris' }
};

/* Con un error, el error concreto («No es la persona», «Al número le faltan
   dígitos»...), no uno general para todos. */
function chipEstado(estado, incidencia) {
  var e = ESTADOS[estado] || { texto: String(estado || '').replace(/_/g, ' '), tono: 'gris' };
  var ficha = incidencia && (estado === 'incidencia' || estado === 'supervision') ? catalogo[incidencia] : null;
  if (ficha) e = { texto: ficha.titulo, tono: e.tono };
  return '<span class="chip tono-' + e.tono + '">' + esc(e.texto) + '</span>';
}

/* --- el resumen de arriba --------------------------------------------- */

async function cargarResumen() {
  resumen = await api('/admin/rutas');
  catalogo = resumen.catalogo || {};

  pintarLotes(resumen.lotes);
  pintarProgreso(resumen);
  pintarBotonesDeMarcha();
  pintarGsg(resumen);
}

function loteDe(id) {
  var encontrados = resumen ? resumen.lotes.filter(function (l) { return l.id === id; }) : [];
  return encontrados[0] || null;
}

function pintarLotes(lotes) {
  var select = document.getElementById('lote');
  /* Se repinta cada diez segundos con las cifras al dia: si estuviera
     desplegado, reconstruirlo lo cerraria en la cara de quien lo mira. */
  if (document.activeElement === select) return;
  var etiquetas = { enviando: ' — en marcha', pausado: ' — pausado', terminado: ' — terminado' };
  var opciones = '<option value="">Todos los lotes</option>' + lotes.map(function (l) {
    return '<option value="' + esc(l.id) + '">' + esc(l.nombre) + ' (' + l.total + ')' + (etiquetas[l.estado] || '') + '</option>';
  }).join('');
  if (select.innerHTML !== opciones) select.innerHTML = opciones;
  /* Si el lote elegido ya no existe (se borro), se vuelve a "todos". */
  if (loteActual && !loteDe(loteActual)) loteActual = '';
  select.value = loteActual;
}

/**
 * Cuánto va del lote y qué está haciendo el motor ahora mismo.
 *
 * Sin esto, un lote "en marcha" fuera del horario de envío parece averiado:
 * no sale ningún mensaje y la pantalla no da ninguna pista de por qué.
 */
function pintarProgreso(datos) {
  var lote = loteDe(loteActual);
  var cifras = lote ? lote.cifras : datos.cifras;
  var total = lote ? lote.total : Object.keys(cifras).reduce(function (suma, k) { return suma + cifras[k]; }, 0);
  var hechos = cifras.resuelto || 0;
  /* Con los contadores ya cargados, el avance cuenta lo mismo que ellos:
     el día y el lote de la barra. */
  if (cifrasVista && cifrasVista.todos !== undefined) { total = cifrasVista.todos || 0; hechos = cifrasVista.resueltos || 0; }
  var porcentaje = total ? Math.round((hechos / total) * 100) : 0;
  var cuando = textoDelRango();

  document.getElementById('progreso').innerHTML =
    '<button type="button" class="cifra" data-vista="resueltos" title="Ver a quiénes ya les llegó la ubicación">' +
      '<b>' + hechos + '</b> de ' + total + ' con ubicación' + (cuando ? ' <span class="cifra-cuando">' + esc(cuando) + '</span>' : '') + '</button>' +
    '<span class="progreso-barra"><span style="width:' + porcentaje + '%"></span></span>' +
    estadoDelMotor(datos.motor) +
    (datos.alertas.coordinador ? '' : '<span class="muted">Nadie recibe avisos por WhatsApp de los casos parados.</span>') +
    '<span class="fallo" id="fallo-refresco"></span>';
}

/* Una sola frase que explica por qué salen o no salen mensajes ahora mismo. */
function estadoDelMotor(m) {
  var clase = 'parado';
  var frase = 'En pausa: ningún lote en marcha';
  if (m.trabajando && !m.enHorario) {
    clase = 'espera';
    frase = 'Esperando al horario de envío (' + m.horario[0] + ':00 a ' + m.horario[1] + ':00)';
  } else if (m.trabajando) {
    clase = 'va';
    frase = 'Enviando, uno cada ' + m.pausa[0] + '-' + m.pausa[1] + ' segundos';
  }
  return '<span class="motor ' + clase + '"><span class="punto"></span>' + esc(frase) + '</span>';
}

/* Empezar y pausar dicen la verdad: solo se puede lo que se puede. */
function pintarBotonesDeMarcha() {
  var lote = loteDe(loteActual);
  var arrancables = resumen.lotes.filter(function (l) { return l.estado !== 'enviando' && l.estado !== 'terminado'; });
  var enMarcha = resumen.lotes.filter(function (l) { return l.estado === 'enviando'; });

  var arrancar = document.getElementById('arrancar');
  var pausar = document.getElementById('pausar');
  arrancar.disabled = lote ? (lote.estado === 'enviando' || lote.estado === 'terminado') : !arrancables.length;
  arrancar.title = arrancar.disabled ? 'No hay ningún lote que empezar' : '';
  pausar.disabled = lote ? lote.estado !== 'enviando' : !enMarcha.length;
  pausar.title = pausar.disabled ? 'No hay ningún lote en marcha' : '';
  document.getElementById('csv').disabled = !loteActual;
  document.getElementById('csv').title = loteActual ? '' : 'Elige un lote para descargar su resultado';
}

function pintarGsg(datos) {
  var gsg = datos.gsg;
  var html =
    '<div class="g-estado">' +
      (gsg.conectado ? '<span class="chip tono-verde">Conectado</span>' : '<span class="chip tono-ambar">Sin conectar</span>') +
      '<span class="g-destino">' + esc(gsg.descripcion) + '</span></div>' +
    '<p class="muted g-nota">' +
      'Cada ubicación conseguida y cada incidencia se guarda lista para GSG. ' +
      (gsg.conectado
        ? 'Se envían solas cada minuto, con un resumen del lote cada ' + datos.alertas.resumenCadaMin + ' min.'
        : 'Mientras no exista la API se acumulan aquí, y saldrán todas el día que se conecte.') +
    '</p>' +
    '<div class="g-cifras">' +
      '<div class="g-cifra' + ((gsg.cola.pendiente || 0) ? ' g-ambar' : '') + '"><b>' + (gsg.cola.pendiente || 0) + '</b><span>en cola</span></div>' +
      '<div class="g-cifra g-verde"><b>' + (gsg.cola.enviado || 0) + '</b><span>enviados</span></div>' +
      '<div class="g-cifra' + ((gsg.cola.fallido || 0) ? ' g-rojo' : '') + '"><b>' + (gsg.cola.fallido || 0) + '</b><span>fallidos</span></div>' +
    '</div>' +
    '<div class="g-botones">' +
      '<button type="button" class="btn sm" id="gsg-descargar">Descargar la cola</button>' +
      '<button type="button" class="btn sm" id="gsg-enviar"' + (gsg.conectado ? '' : ' disabled') + '>Enviar ahora</button>' +
    '</div>';

  var caja = document.getElementById('gsg');
  /* Se repinta cada diez segundos: si no ha cambiado nada, no se toca (si no,
     se pierde el foco de quien iba a pulsar "Enviar ahora"). */
  if (caja.innerHTML === html) return;
  caja.innerHTML = html;

  document.getElementById('gsg-descargar').onclick = function () {
    descargar('/admin/rutas/cola.ndjson', 'reportes-gsg.ndjson');
  };
  document.getElementById('gsg-enviar').onclick = async function () {
    try {
      var r = await api('/admin/rutas/cola/despachar', { method: 'POST' });
      toast(r.motivo && !r.intentados ? 'No se envió nada: ' + r.motivo : 'Enviados ' + r.enviados + ' de ' + r.intentados + '.' + (r.errores && r.errores.length ? ' Error: ' + r.errores.join(' · ') : (r.intentados ? '' : ' No había nada pendiente de enviar.')));
      await refrescar();
    } catch (error) { toast(error.message); }
  };
}

/* --- filtros y lista --------------------------------------------------- */

async function cargarFiltros() {
  var params = paramsDeRango();
  if (loteActual) params.push('loteId=' + encodeURIComponent(loteActual));
  var data = await api('/admin/rutas/vistas' + (params.length ? '?' + params.join('&') : ''));
  nombresVista = data.nombres;
  cifrasVista = data.cifras;
  var html = FILTROS.map(function (f) {
    var n = cifrasVista[f.vista] || 0;
    var activo = vista === f.vista;
    if (f.soloSiHay && !n && !activo) return '';
    return '<button type="button" class="filtro ' + (f.clase || '') + '" data-vista="' + f.vista + '" aria-pressed="' + (activo ? 'true' : 'false') + '">' +
      esc(nombresVista[f.vista] || f.vista) + ' <span class="n">' + n + '</span></button>';
  }).join('');
  var caja = document.getElementById('filtros');
  if (caja.innerHTML !== html) caja.innerHTML = html;
  /* El avance cuenta lo mismo que los contadores: el día y el lote elegidos. */
  if (resumen) pintarProgreso(resumen);
}

async function cargarLista() {
  var params = ['vista=' + encodeURIComponent(vista), 'limit=500'].concat(paramsDeRango());
  if (loteActual) params.push('loteId=' + encodeURIComponent(loteActual));
  var q = document.getElementById('buscar').value.trim();
  /* Un celular se busca igual escrito con espacios, guiones, «+51» o sin nada. */
  var qEnvio = /^[\d\s+()\-]+$/.test(q) ? q.replace(/\D/g, '').replace(/^51(?=\d{9}$)/, '') : q;
  if (qEnvio) params.push('q=' + encodeURIComponent(qEnvio));

  var data = await api('/admin/rutas/solicitudes?' + params.join('&'));
  /* El día lo recorta el servidor (así las cifras y la lista cuentan lo mismo);
     hora, distrito y estado se afinan aquí sobre lo que llegó. */
  var visibles = data.items.filter(pasaFiltroDia);
  llenarDistritos(data.items);
  document.getElementById('titulo-lista').textContent =
    (nombresVista[vista] || 'Clientes') + ' (' + visibles.length + (visibles.length !== data.total ? ' de ' + data.total : '') + ')';
  var ocultos = data.items.length - visibles.length;
  var aviso = document.getElementById('f-resumen');
  if (ocultos > 0) {
    aviso.innerHTML = esc(ocultos + (ocultos === 1 ? ' resultado queda' : ' resultados quedan')) + ' fuera de los filtros de hora, distrito o estado. <button type="button" id="f-ver-todos">Quitar esos filtros</button>';
    document.getElementById('f-ver-todos').onclick = function () { limpiarFiltrosFinos(); cargarLista().catch(function () {}); };
  } else aviso.textContent = '';
  data = { items: visibles, total: data.total };

  // Pidiendo la ubicación cada tantos minutos no hay tope: «intento 5», sin «de 3».
  var maxIntentos = resumen ? resumen.motor.maxIntentos : 0;
  document.getElementById('filas').innerHTML = data.items.map(function (s) {
    return '<tr data-id="' + s.id + '" tabindex="0"' + (seleccionada === s.id ? ' class="activa"' : '') + '>' +
      '<td><b>' + esc(s.nombre || 'Sin nombre') + '</b>' +
        '<div class="sub">' + esc(s.phone || s.telefonoCrudo) + '</div></td>' +
      '<td><span class="ref-pedido">' + esc(s.referencia || '') + '</span>' +
        (s.distrito ? '<div class="sub">' + esc(s.distrito) + '</div>' : '') + '</td>' +
      '<td>' + chipEstado(s.estado, s.incidencia) +
        (s.requiereHumano ? ' <span class="chip tono-rojo">persona</span>' : '') + '</td>' +
      '<td>' + esc(queLePasa(s)) +
        (intentosDe(s, maxIntentos) ? '<div class="sub">' + esc(intentosDe(s, maxIntentos)) + '</div>' : '') + '</td>' +
    '</tr>';
  }).join('');

  pintarListaVacia(data.items.length, q);
}

/* --- filtros: el día lo aplica el servidor; hora, distrito y estado, la lista --- */
function aIsoLocal(fecha) {
  var m = fecha.getMonth() + 1, d = fecha.getDate();
  return fecha.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
}
function pasaFiltroDia(s) {
  var f = new Date(s.createdAt || s.updatedAt || 0);
  if (isNaN(f.getTime())) return true;
  var hm = (f.getHours() < 10 ? '0' : '') + f.getHours() + ':' + (f.getMinutes() < 10 ? '0' : '') + f.getMinutes();
  var h1 = document.getElementById('f-hora-desde').value, h2 = document.getElementById('f-hora-hasta').value;
  if (h1 && hm < h1) return false;
  if (h2 && hm > h2) return false;
  var d = document.getElementById('f-distrito').value;
  if (d && (s.distrito || '') !== d) return false;
  var e = document.getElementById('f-estado').value;
  if (e && s.estado !== e) return false;
  return true;
}
function llenarDistritos(items) {
  var lista = document.getElementById('f-distrito'), actual = lista.value, vistos = [];
  items.forEach(function (s) { if (s.distrito && vistos.indexOf(s.distrito) < 0) vistos.push(s.distrito); });
  vistos.sort(function (a, b) { return a.localeCompare(b, 'es'); });
  if (actual && vistos.indexOf(actual) < 0) vistos.push(actual);
  var html = '<option value="">Todos</option>' + vistos.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('');
  if (lista.innerHTML !== html) { lista.innerHTML = html; lista.value = actual; }
}
/* Los filtros finos: no cambian las cifras de arriba, solo afinan la lista. */
var CAMPOS_FINOS = ['f-hora-desde', 'f-hora-hasta', 'f-distrito', 'f-estado'];
(function () {
  document.getElementById('f-estado').innerHTML = '<option value="">Todos los estados</option>' + Object.keys(ESTADOS).map(function (k) {
    return '<option value="' + k + '">' + esc(ESTADOS[k].texto) + '</option>';
  }).join('');
})();

/* El día se elige por la fecha en que entró el pedido, en la hora de este
   equipo: «hoy» va de las 00:00 de hoy a las 00:00 de mañana. */
function inicioDelDia(iso) {
  var p = iso.split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}
function paramsDeRango() {
  var desde = document.getElementById('f-desde').value, hasta = document.getElementById('f-hasta').value, params = [];
  if (desde) params.push('creadoDesde=' + encodeURIComponent(inicioDelDia(desde).toISOString()));
  if (hasta) {
    var fin = inicioDelDia(hasta);
    fin.setDate(fin.getDate() + 1);
    params.push('creadoHasta=' + encodeURIComponent(fin.toISOString()));
  }
  return params;
}
var rangoActual = 'hoy';
function textoDelRango() {
  if (rangoActual === 'hoy') return 'hoy';
  if (rangoActual === 'ayer') return 'ayer';
  if (rangoActual === 'semana') return 'en los últimos 7 días';
  if (rangoActual === 'todos') return '';
  var desde = document.getElementById('f-desde').value, hasta = document.getElementById('f-hasta').value;
  var corto = function (iso) { var p = iso.split('-'); return p[2] + '/' + p[1]; };
  if (desde && hasta) return desde === hasta ? 'el ' + corto(desde) : 'del ' + corto(desde) + ' al ' + corto(hasta);
  if (desde) return 'desde el ' + corto(desde);
  if (hasta) return 'hasta el ' + corto(hasta);
  return '';
}
function aplicarRango(rango) {
  var hoy = new Date(), desde = '', hasta = '';
  if (rango === 'hoy') { desde = hasta = aIsoLocal(hoy); }
  else if (rango === 'ayer') { var a = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1); desde = hasta = aIsoLocal(a); }
  else if (rango === 'semana') { desde = aIsoLocal(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 6)); hasta = aIsoLocal(hoy); }
  document.getElementById('f-desde').value = desde;
  document.getElementById('f-hasta').value = hasta;
  marcarRango(rango);
}
function marcarRango(rango) {
  rangoActual = rango;
  document.querySelectorAll('#filtro-dia [data-rango]').forEach(function (b) {
    var on = b.getAttribute('data-rango') === rango;
    b.classList.toggle('activo', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}
function limpiarFiltrosFinos() {
  CAMPOS_FINOS.forEach(function (id) { document.getElementById(id).value = ''; });
  contarFiltrosFinos();
}
/* «Más filtros (2)»: que se vea que hay algo puesto aunque esté plegado. */
function contarFiltrosFinos() {
  var n = CAMPOS_FINOS.filter(function (id) { return document.getElementById(id).value; }).length;
  document.getElementById('f-cuantos').textContent = n ? '(' + n + ')' : '';
}
/* Cambiar el día cambia todo: el avance, los contadores y la lista. */
function recargarPorDia() {
  return cargarFiltros().then(cargarLista).catch(function (e) { toast(e.message); });
}
aplicarRango('hoy');
document.getElementById('f-mas').onclick = function () {
  var caja = document.getElementById('f-campos'), abrir = caja.hidden;
  caja.hidden = !abrir;
  this.setAttribute('aria-expanded', abrir ? 'true' : 'false');
  this.firstChild.textContent = abrir ? 'Menos filtros ' : 'Más filtros ';
};
document.getElementById('lista-vacia').addEventListener('click', function (ev) {
  if (!ev.target.closest('[data-ver-todos-dias]')) return;
  aplicarRango('todos');
  recargarPorDia();
});
document.getElementById('f-limpiar').onclick =function () { limpiarFiltrosFinos(); cargarLista().catch(function () {}); };
CAMPOS_FINOS.forEach(function (id) {
  document.getElementById(id).addEventListener('change', function () { contarFiltrosFinos(); cargarLista().catch(function () {}); });
});
['f-desde', 'f-hasta'].forEach(function (id) {
  document.getElementById(id).addEventListener('change', function () { marcarRango(''); recargarPorDia(); });
});
document.getElementById('filtro-dia').addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-rango]');
  if (!b) return;
  aplicarRango(b.getAttribute('data-rango'));
  recargarPorDia();
});

/* El hueco cuando no hay nada: siempre dice qué hacer a continuación. */
function pintarListaVacia(cuantos, q) {
  var caja = document.getElementById('lista-vacia');
  if (cuantos) { caja.innerHTML = ''; return; }
  if (q) {
    caja.innerHTML = '<div class="vacio"><h3>Nada coincide con «' + esc(q) + '»</h3>' +
      '<p>Prueba con el número, con parte del nombre o con el pedido.</p></div>';
    return;
  }
  if (resumen && !resumen.lotes.length) {
    caja.innerHTML = '<div class="vacio"><h3>Todavía no hay ninguna lista</h3>' +
      '<p>Pega la lista del día (o trae a los clientes que nunca mandaron su ubicación) y el sistema les pedirá el pin uno a uno.</p>' +
      '<div class="acciones"><button type="button" class="btn primario" data-abrir-carga="1">Cargar la lista del día</button></div></div>';
    return;
  }
  if (vista === 'todos') {
    var cuando = textoDelRango();
    if (cuando && rangoActual !== 'todos') {
      caja.innerHTML = '<div class="vacio"><h3>No entró ningún pedido ' + esc(cuando) + '</h3>' +
        '<p>Los de otros días siguen guardados.</p>' +
        '<div class="acciones"><button type="button" class="btn" data-ver-todos-dias="1">Ver todos los días</button></div></div>';
      return;
    }
    caja.innerHTML = '<div class="vacio"><h3>Esta lista está vacía</h3>' +
      '<p>El lote elegido no tiene ningún cliente. Elige otro lote arriba o carga una lista nueva.</p></div>';
    return;
  }
  caja.innerHTML = '<div class="vacio"><h3>Nadie en «' + esc(nombresVista[vista] || vista) + '»</h3>' +
    '<p>Buena señal: aquí no queda nada por hacer. Mira otro filtro de arriba.</p></div>';
}

/**
 * La columna que de verdad se lee: por que ese cliente esta ahi.
 *
 * No repite lo que ya dice el chip de estado ("esperando respuesta" no se
 * escribe dos veces): cuenta el detalle, que es lo que el chip no cabe.
 */
function queLePasa(s) {
  if (s.estado === 'resuelto') return 'Recibida a las ' + cuando(s.resueltoAt);
  if (s.esperaEnvio) return s.esperaEnvio.motivo + (s.esperaEnvio.hasta ? ' Próxima revisión: ' + cuando(s.esperaEnvio.hasta) + '.' : '');
  if (s.incidencia && catalogo[s.incidencia]) {
    return catalogo[s.incidencia].titulo + (s.incidenciaDetalle ? ': ' + s.incidenciaDetalle : '');
  }
  if (s.incidenciaDetalle) return s.incidenciaDetalle;
  if (s.estado === 'pendiente') return s.intentos ? 'Vuelve a la cola' : 'En la cola, sin escribir todavía';
  return '';
}

/* Cuántas veces se le escribió y cuándo fue la última. */
function intentosDe(s, maxIntentos) {
  if (!s.intentos) return '';
  return (s.estado === 'resuelto' ? s.intentos + ' mensajes enviados antes de recibir la ubicación' : 'intento ' + s.intentos + (maxIntentos ? ' de ' + maxIntentos : '')) +
    (s.ultimoEnvioAt ? ' · ' + cuando(s.ultimoEnvioAt) : '');
}

/* --- detalle ---------------------------------------------------------- */

/* true si el foco esta en un campo del detalle: entonces no se repinta. */
function escribiendoEnDetalle() {
  var activo = document.activeElement;
  if (!activo || (activo.tagName !== 'INPUT' && activo.tagName !== 'TEXTAREA')) return false;
  var caja = document.getElementById('detalle');
  return Boolean(caja && caja.contains(activo));
}

/**
 * Abre (o pone al dia, si "silencioso") el detalle de un cliente.
 *
 * "peticionDetalle" numera las peticiones: sin eso, una respuesta pedida
 * antes -pero que llega despues- repinta el panel encima de lo que el
 * operador acaba de escribir, y el telefono a medio corregir desaparece.
 */
async function abrirDetalle(id, silencioso) {
  seleccionada = id;
  var mia = ++peticionDetalle;

  if (!silencioso) {
    marcarFilaActiva(id);
    /* Al cambiar de cliente, el panel se vacia ANTES de pedir los datos: si se
       dejaran los campos del anterior, quien escribe rapido empieza a corregir
       un telefono que desaparece medio segundo despues. */
    if (detalleId !== id) {
      detalleId = null;
      document.getElementById('detalle-acciones').innerHTML = '';
      document.getElementById('detalle-historial').innerHTML = '';
      document.getElementById('detalle-info').innerHTML = '<span class="esqueleto titulo"></span><span class="esqueleto linea"></span><span class="esqueleto linea media"></span>';
    }
  }

  try {
    var data = await api('/admin/rutas/solicitudes/' + id);
    if (mia !== peticionDetalle || seleccionada !== id) return;
    if (silencioso && escribiendoEnDetalle()) return;
    pintarDetalle(data);
  } catch (error) {
    if (silencioso) return;
    cerrarDetalle();
    toast(error.message);
  }
}

/* La fila marcada se cambia aqui mismo: no hace falta volver a pedir la lista. */
function marcarFilaActiva(id) {
  var filas = document.getElementById('filas').querySelectorAll('tr[data-id]');
  for (var i = 0; i < filas.length; i++) {
    filas[i].classList.toggle('activa', Number(filas[i].getAttribute('data-id')) === id);
  }
}

function pintarDetalle(data) {
  var s = data.solicitud;
  var ficha = data.incidencia;
  ver('cerrar-detalle', true);

  var mapa = s.lat !== null && s.lng !== null
    ? '<p style="margin:0 0 10px"><a href="https://www.google.com/maps?q=' + s.lat + ',' + s.lng +
      '" target="_blank" rel="noopener">Ver el punto en el mapa</a> ' +
      '<span class="muted">(' + Number(s.lat).toFixed(5) + ', ' + Number(s.lng).toFixed(5) + ')</span></p>'
    : '';

  var explicacion = ficha
    ? '<div class="aviso" style="margin:0 0 12px"><div><b>' + esc(ficha.titulo) + '</b><br>' +
      esc(ficha.explicacion) + '<br>' +
      '<b>Qué hacer:</b> ' + esc(ficha.queHacer) + '</div></div>'
    : '';

  var info =
    '<div class="d-cab"><b class="d-nombre">' + esc(s.nombre || 'Sin nombre') + '</b>' + chipEstado(s.estado) + '</div>' +
    '<div class="d-meta">' +
      '<span><small>Teléfono</small>' + esc(s.phone || s.telefonoCrudo) + '</span>' +
      (s.referencia ? '<span><small>Pedido</small>' + esc(s.referencia) + '</span>' : '') +
      (s.distrito ? '<span><small>Distrito</small>' + esc(s.distrito) + '</span>' : '') +
    '</div>' +
    (s.direccion ? '<p class="d-dir">' + esc(s.direccion) + '</p>' : '') +
    mapa +
    explicacion;

  var zonaInfo = document.getElementById('detalle-info');
  if (zonaInfo.innerHTML !== info) zonaInfo.innerHTML = info;

  var bitacora = (data.eventos || []).slice().reverse().map(function (e) {
    return '<li><span class="cuando">' + esc(cuando(e.createdAt)) + '</span> · ' + esc(e.detalle || e.tipo) + '</li>';
  }).join('') || '<li class="muted">Todavía no hay movimientos.</li>';
  var historial =
    '<h3 class="d-titulo">Historial</h3>' +
    '<ul class="bitacora d-linea">' + bitacora + '</ul>';
  var zonaHistorial = document.getElementById('detalle-historial');
  if (zonaHistorial.innerHTML !== historial) zonaHistorial.innerHTML = historial;

  // Las acciones solo se reconstruyen al cambiar de cliente: son campos que
  // el operador puede estar escribiendo ahora mismo.
  if (detalleId === s.id) return;
  detalleId = s.id;

  var sinTelefono = !s.phone;
  var puede = accionesDeEstado(s.estado);
  var enlaceChat = '<a class="btn sm fijo" href="/chat?phone=' + encodeURIComponent(s.phone || s.telefonoCrudo) + '">Abrir el chat</a>' +
    (sinTelefono ? '' : '<a href="#" class="btn sm fijo" id="d-incidencia">Enviar incidencia manual</a>');
  // Siempre a mano, en cualquier estado: la historia del pedido y el porqué.
  var botonQuePaso = '<button type="button" class="btn sm qp-btn" id="d-que-paso">🔎 Ver qué pasó con este pedido</button>';
  var abrirIncidencia = function (evento) {
    if (evento) evento.preventDefault();
    abrirIncidenciaManual({ phone: s.phone, tracking: s.referencia || '', alTerminar: function () { detalleId = null; refrescar(); } });
  };

  // Quitada de la automatizacion: nada que pueda volver a escribirle. Solo
  // se dice que esta fuera y se deja abrir el chat.
  if (puede.cancelada) {
    document.getElementById('detalle-acciones').innerHTML =
      '<div class="aviso" style="margin:12px 0 8px"><div><b>Quitada de esta automatización</b><br>' +
        'No se le volverá a escribir por esta solicitud. El chat, el contacto y el historial se conservan.</div></div>' +
      '<div class="fila" style="margin:0 0 4px">' + enlaceChat + '</div>' + botonQuePaso;
    if (!sinTelefono) document.getElementById('d-incidencia').onclick = abrirIncidencia;
    document.getElementById('d-que-paso').onclick = function () { abrirQuePaso(s.id); };
    return;
  }

  document.getElementById('detalle-acciones').innerHTML =
    botonQuePaso +
    '<div class="d-bloque"><h3 class="d-titulo">Corregir datos</h3>' +
    '<div class="campo"><label for="d-telefono">Teléfono</label>' +
      '<div class="fila"><input id="d-telefono" value="' + esc(s.telefonoCrudo) + '">' +
      '<button type="button" class="btn sm fijo" id="d-guardar-tel">Guardar y reintentar</button></div></div>' +
    '<div class="campo"><label for="d-ubicacion">Ubicación a mano <span class="muted">(enlace de mapa o «lat, lng»)</span></label>' +
      '<div class="fila"><input id="d-ubicacion" placeholder="https://maps.app.goo.gl/… o -12.09, -77.03">' +
      '<button type="button" class="btn sm fijo" id="d-guardar-ubi">Guardar</button></div></div></div>' +
    '<h3 class="d-titulo">Acciones</h3>' +
    '<div class="fila d-acciones">' +
      '<button type="button" class="btn sm fijo" id="d-derivar"' + (s.estado === 'derivado' ? ' disabled title="Ya está con el repartidor"' : '') + '>Pasar al repartidor</button>' +
      (puede.reintentar
        ? '<button type="button" class="btn sm fijo" id="d-reintentar"' + (sinTelefono ? ' disabled title="Sin un teléfono al que escribir: corrígelo primero"' : '') + '>Reintentar esta solicitud</button>'
        : '') +
      (puede.pedirOtraVez
        ? '<button type="button" class="btn sm fijo" id="d-pedir-otra-vez"' + (sinTelefono ? ' disabled title="Sin un teléfono al que escribir: corrígelo primero"' : '') + '>Pedir ubicación otra vez</button>'
        : '') +
      enlaceChat +
    '</div>' +
    (puede.quitar
      ? '<div class="fila d-peligro"><button type="button" class="btn sm fijo" id="d-quitar">Quitar de esta automatización</button></div>'
      : '');

  if (!sinTelefono) document.getElementById('d-incidencia').onclick = abrirIncidencia;
  document.getElementById('d-que-paso').onclick = function () { abrirQuePaso(s.id); };
  document.getElementById('d-guardar-tel').onclick = function () { guardarTelefono(s.id); };
  document.getElementById('d-guardar-ubi').onclick = function () { guardarUbicacion(s.id); };
  document.getElementById('d-derivar').onclick = function () { accionSobre(s.id, '/derivar', 'Pasado al repartidor.', this); };
  if (puede.reintentar) {
    document.getElementById('d-reintentar').onclick = function () { accionSobre(s.id, '/reintentar', 'Vuelve a la cola: se le escribirá en cuanto le toque.', this); };
  }
  if (puede.pedirOtraVez) {
    document.getElementById('d-pedir-otra-vez').onclick = function () { pedirUbicacionOtraVez(s, this); };
  }
  if (puede.quitar) {
    document.getElementById('d-quitar').onclick = function () { quitarDeAutomatizacion(s, this); };
  }
}

/**
 * «Ver qué pasó con este pedido»: el diagnóstico arriba (qué pasó y por qué),
 * los avisos, las cifras y la línea de tiempo. Solo lee: no cambia nada.
 */
async function abrirQuePaso(id) {
  var viejo = document.getElementById('qp-fondo');
  if (viejo) viejo.remove();
  var fondo = document.createElement('div');
  fondo.className = 'qp-fondo';
  fondo.id = 'qp-fondo';
  fondo.innerHTML = '<div class="qp" role="dialog" aria-modal="true" aria-labelledby="qp-titulo"><h3 id="qp-titulo">Qué pasó con este pedido</h3><p class="qp-sub">Leyendo todo lo que quedó guardado…</p></div>';
  var cerrar = function () { fondo.remove(); document.removeEventListener('keydown', alTeclear); };
  var alTeclear = function (ev) { if (ev.key === 'Escape') cerrar(); };
  fondo.onclick = function (ev) { if (ev.target === fondo) cerrar(); };
  document.addEventListener('keydown', alTeclear);
  document.body.appendChild(fondo);
  var caja = fondo.querySelector('.qp');
  try {
    var d = await api('/admin/rutas/solicitudes/' + id + '/que-paso');
    caja.innerHTML = pintarQuePaso(d);
  } catch (error) {
    caja.innerHTML = '<h3 id="qp-titulo">Qué pasó con este pedido</h3><div class="qp-diag bad"><b>No se pudo leer la historia</b><p>' + esc(error && error.message ? error.message : 'Error desconocido') + '</p></div><div class="qp-pie"><button type="button" class="btn sm" data-qp-cerrar>Cerrar</button></div>';
  }
  var b = caja.querySelector('[data-qp-cerrar]');
  if (b) { b.onclick = cerrar; b.focus(); }
}

function pintarQuePaso(d) {
  var s = d.solicitud || {};
  var g = d.diagnostico || {};
  var c = d.cifras || {};
  var hora = function (iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso; }
  };
  var cifra = function (n, texto) { return '<span>' + esc(n) + '<small>' + esc(texto) + '</small></span>'; };
  var html = '<h3 id="qp-titulo">Qué pasó con este pedido</h3>' +
    '<p class="qp-sub">' + esc([s.nombre, s.referencia, s.telefono].filter(Boolean).join(' · ')) + '</p>' +
    '<div class="qp-diag ' + esc(g.tono || 'muted') + '"><b>' + esc(g.titulo || '') + '</b><p>' + esc(g.porque || '') + '</p>' +
      (g.queHacer ? '<p class="qp-hacer">Qué hacer: ' + esc(g.queHacer) + '</p>' : '') + '</div>';
  if (d.avisos && d.avisos.length) {
    html += '<ul class="qp-avisos">' + d.avisos.map(function (a) { return '<li class="' + esc(a.tono) + '">' + esc(a.texto) + '</li>'; }).join('') + '</ul>';
  }
  html += '<div class="qp-cifras">' +
    cifra(c.intentosContados, 'intentos contados') +
    cifra(c.mensajesEnSuChat, 'mensajes en su chat') +
    cifra(c.leLlegaron, 'le llegaron') +
    cifra(c.leidos, 'leídos') +
    cifra(c.noLlegaron, 'no le llegaron') +
    cifra(c.envioFrenado, 'no salieron') +
    cifra(c.escribioElCliente, 'mensajes del cliente') +
    '</div>';
  html += '<h3 class="d-titulo" style="margin-top:0">Paso a paso</h3>';
  html += d.linea && d.linea.length
    ? '<ul class="qp-linea">' + d.linea.map(function (p) {
        return '<li class="' + esc(p.tono) + '">' + esc(p.que) + (p.detalle ? '<span class="qp-det">' + esc(p.detalle) + '</span>' : '') + (p.cuando ? '<small>' + esc(hora(p.cuando)) + '</small>' : '') + '</li>';
      }).join('') + '</ul>'
    : '<p class="muted" style="margin:0">No quedó nada apuntado de este pedido.</p>';
  if (d.faltan && d.faltan.length) {
    html += '<p class="muted" style="margin:12px 0 0;font-size:12.5px">No se pudo leer: ' + esc(d.faltan.join(', ')) + '.</p>';
  }
  html += '<div class="qp-pie"><button type="button" class="btn sm" data-qp-cerrar>Cerrar</button></div>';
  return html;
}

/**
 * Que acciones lleva el detalle segun el estado de la solicitud.
 *
 * Va aparte, sin tocar el DOM, para poder probarla sola. La regla que no se
 * puede romper: una solicitud cancelada no ofrece NADA que vuelva a escribir
 * al cliente (ni reintentar, ni corregir el telefono, que tambien reintenta).
 */
function accionesDeEstado(estado) {
  var cancelada = estado === 'cancelado';
  return {
    cancelada: cancelada,
    reintentar: !cancelada,
    pedirOtraVez: estado === 'resuelto',
    quitar: !cancelada
  };
}

function cerrarDetalle() {
  seleccionada = null;
  detalleId = null;
  ver('cerrar-detalle', false);
  marcarFilaActiva(null);
  document.getElementById('detalle-info').innerHTML =
    '<p class="muted" style="margin:0">Elige un cliente de la lista para ver su historial y arreglar lo que haga falta.</p>';
  document.getElementById('detalle-acciones').innerHTML = '';
  document.getElementById('detalle-historial').innerHTML = '';
}

/**
 * Deja el boton apagado mientras dura la peticion: un doble clic no puede
 * mandar dos veces lo mismo. "trabajo" devuelve true si salio bien; si falla
 * (o devuelve false) el boton vuelve a estar disponible. Si salio bien no hace
 * falta: el detalle se repinta con botones nuevos.
 */
async function conBotonOcupado(boton, trabajo) {
  if (boton && boton.disabled) return;
  if (boton) boton.disabled = true;
  var bien = false;
  try {
    bien = await trabajo();
  } catch (error) {
    toast(error.message);
  } finally {
    if (!bien && boton) boton.disabled = false;
  }
}

/* Derivar y reintentar hacen lo mismo salvo la ruta y el aviso. */
async function accionSobre(id, ruta, aviso, boton) {
  await conBotonOcupado(boton, async function () {
    await api('/admin/rutas/solicitudes/' + id + ruta, { method: 'POST', body: {} });
    toast(aviso);
    detalleId = null;
    await refrescar();
    return true;
  });
}

/**
 * Un POST que devuelve el codigo ademas de los datos.
 *
 * "api" convierte cualquier fallo en un Error con el texto y nada mas, y aqui
 * hace falta distinguir el 409 (ya hay otra abierta: se ofrece abrirla) del
 * 422 (no se puede escribirle: se dice por que). Sin cuerpo no se manda
 * content-type: el servidor rechaza un JSON vacio.
 */
async function postConEstado(ruta, cuerpo) {
  var res = await fetch(ruta, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: cuerpo ? { 'content-type': 'application/json' } : {},
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
  var data = await res.json().catch(function () { return {}; });
  if (res.status === 401) { irAlLogin(); throw new Error('Tu sesión terminó: vuelve a entrar.'); }
  return { ok: res.ok, status: res.status, data: data };
}

/* Abre otra solicitud, cambiando de lote si la lista mira otro. */
async function irASolicitud(id, loteId) {
  if (loteActual && loteId && loteActual !== loteId) loteActual = loteId;
  seleccionada = id;
  detalleId = null;
  marcarFilaActiva(id);
  // refrescar() ya abre el detalle de "seleccionada" con lo que haya en el servidor.
  await refrescar();
}

/* Solo para las ya resueltas: un flujo nuevo, sin perder lo anterior. */
async function pedirUbicacionOtraVez(s, boton) {
  var si = await confirmarDialogo({
    titulo: 'Pedir ubicación otra vez',
    texto: 'Se enviará a ' + (s.nombre || 'este cliente') + ' un nuevo flujo de solicitud de ubicación, ' +
      'respetando el horario y el ritmo de envío. El historial y la ubicación anteriores se conservan.',
    boton: 'Pedir otra vez'
  });
  if (!si) return;

  await conBotonOcupado(boton, async function () {
    var r = await postConEstado('/admin/rutas/solicitudes/' + s.id + '/volver-a-empezar');
    if (r.ok) {
      toast('Listo: se le volverá a pedir la ubicación cuando le toque, dentro del horario.');
      await irASolicitud(r.data.solicitudId, r.data.loteId);
      return true;
    }
    if (r.status === 409 && r.data.abierta) {
      var abierta = r.data.abierta;
      var abrir = await confirmarDialogo({
        titulo: 'Ya tiene una solicitud abierta',
        texto: (r.data.error || 'Este cliente ya tiene otra solicitud en marcha.') + ' No se envió nada nuevo.',
        boton: 'Abrir esa solicitud',
        cancelar: 'Cerrar'
      });
      if (abrir) await irASolicitud(abierta.id, abierta.loteId);
      return false;
    }
    if (r.status === 422) {
      toast('No se envió nada: ' + (r.data.error || r.data.motivo || 'no se le puede escribir.'));
      return false;
    }
    toast(r.data.error || errorHttp(r.status));
    return false;
  });
}

/* Detiene solo este flujo: el chat, el contacto y el historial se quedan. */
async function quitarDeAutomatizacion(s, boton) {
  var motivo = await pedirDato({
    titulo: 'Quitar de esta automatización',
    texto: 'Solo se detiene este flujo: no se le volverá a escribir por esta solicitud. ' +
      'No se borra el chat, ni el contacto, ni el historial.',
    etiqueta: 'Motivo (opcional)',
    marcador: 'Ya recogió en tienda, pidió que no le escriban…',
    boton: 'Quitar',
    validar: function () { return null; }
  });
  if (motivo === null) return;

  await conBotonOcupado(boton, async function () {
    var r = await api('/admin/rutas/solicitudes/' + s.id + '/cancelar', { method: 'POST', body: motivo ? { motivo: motivo } : {} });
    toast(r.yaEstaba
      ? 'Ya estaba quitada de esta automatización.'
      : 'Quitada de esta automatización. El chat y el historial siguen ahí.');
    detalleId = null;
    await refrescar();
    return true;
  });
}

async function guardarTelefono(id) {
  var valor = document.getElementById('d-telefono').value.trim();
  if (!valor) { toast('Escribe el teléfono corregido.'); return; }
  try {
    await api('/admin/rutas/solicitudes/' + id, { method: 'PATCH', body: { telefono: valor } });
    toast('Teléfono corregido: vuelve a la cola.');
    // El numero cambio: las acciones tienen que volver a pintarse con el
    // valor nuevo, no con el que quedo escrito.
    detalleId = null;
    await refrescar();
  } catch (error) { toast(error.message); }
}

async function guardarUbicacion(id) {
  var valor = document.getElementById('d-ubicacion').value.trim();
  if (!valor) { toast('Pega el enlace del mapa o las coordenadas.'); return; }
  var coords = valor.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  var cuerpo = coords ? { lat: Number(coords[1]), lng: Number(coords[2]) } : { enlace: valor };
  try {
    await api('/admin/rutas/solicitudes/' + id + '/resolver', { method: 'POST', body: cuerpo });
    toast('Ubicación guardada y lista para GSG.');
    detalleId = null;
    await refrescar();
  } catch (error) { toast(error.message); }
}

/* --- cargar un lote nuevo --------------------------------------------- */

function abrirCarga() {
  ver('carga', true);
  ver('caja-ajustes', false);
  sincronizarAjustes(false);
  document.getElementById('pegado').focus();
}

document.getElementById('nuevo').onclick = abrirCarga;
document.getElementById('cerrar-carga').onclick = function () { ver('carga', false); };

/* Se revisa solo al pegar: era un paso de mas pulsar "revisar" antes de crear. */
var revisando;
document.getElementById('pegado').addEventListener('input', function () {
  clearTimeout(revisando);
  revisando = setTimeout(revisarPegado, 600);
});

async function revisarPegado() {
  var texto = document.getElementById('pegado').value;
  var caja = document.getElementById('resumen-carga');
  if (!texto.trim()) {
    caja.innerHTML = '';
    listasPegadas = 0;
    actualizarCrear();
    return;
  }
  try {
    var r = await api('/admin/rutas/previsualizar', { method: 'POST', body: { texto: texto } });
    var columnas = Object.keys(r.columnas).map(function (k) { return k + ' = ' + r.columnas[k]; }).join(' · ');
    var incidencias = Object.keys(r.incidencias).map(function (c) {
      return '<div class="linea">' + (catalogo[c] ? esc(catalogo[c].titulo) : esc(c)) + ': <b>' + r.incidencias[c] + '</b></div>';
    }).join('');

    caja.innerHTML =
      '<div class="linea"><b>' + r.listas + '</b> listos para pedirles la ubicación</div>' +
      (r.conIncidencia ? '<div class="linea"><b>' + r.conIncidencia + '</b> con el número mal: no se les escribirá</div>' : '') +
      (r.duplicadas ? '<div class="linea"><b>' + r.duplicadas + '</b> repetidos (se escribe una sola vez)</div>' : '') +
      (r.descartadas.length ? '<div class="linea"><b>' + r.descartadas.length + '</b> filas sin teléfono, descartadas</div>' : '') +
      incidencias +
      '<div class="linea muted">Columnas entendidas: ' + esc(columnas || 'ninguna') + '</div>';
    listasPegadas = r.listas + r.conIncidencia;
  } catch (error) {
    caja.innerHTML = '<div class="linea fallo">' + esc(error.message) + '</div>';
    listasPegadas = 0;
  }
  actualizarCrear();
}

/* El botón de crear solo se enciende si hay a quién escribir. */
function actualizarCrear() {
  var elegidos = elegidosSinUbicacion().length;
  var etiqueta = document.getElementById('sin-elegidos');
  if (etiqueta) etiqueta.textContent = elegidos ? elegidos + ' elegidos' : '';
  document.getElementById('crear').disabled = !elegidos && !listasPegadas;
}

document.getElementById('crear').onclick = async function () {
  var boton = this;
  boton.disabled = true;
  try {
    // Lo elegido de la lista manda sobre lo pegado: si alguien marco
    // contactos, es lo que quiere mandar.
    var elegidos = elegidosSinUbicacion();
    var r = await api('/admin/rutas/lotes', {
      method: 'POST',
      body: {
        nombre: document.getElementById('nombre-lote').value.trim() || undefined,
        filas: elegidos.length ? elegidos : undefined,
        texto: elegidos.length ? undefined : document.getElementById('pegado').value,
        arrancar: document.getElementById('arrancar-ya').checked
      }
    });
    toast('Lote creado: ' + r.listas + ' clientes en cola' + (r.conIncidencia ? ', ' + r.conIncidencia + ' con el número mal' : '') + '.');
    limpiarCarga();
    loteActual = r.lote.id;
    await refrescar();
  } catch (error) {
    toast(error.message);
  } finally {
    actualizarCrear();
  }
};

/* Se vacia TODO lo de la carga, tambien las casillas marcadas: si no, el
   siguiente lote se llevaria a los contactos elegidos para el anterior. */
function limpiarCarga() {
  document.getElementById('pegado').value = '';
  document.getElementById('nombre-lote').value = '';
  document.getElementById('resumen-carga').innerHTML = '';
  document.getElementById('sin-ubicacion').innerHTML = '';
  document.getElementById('sin-ubicacion-cuenta').textContent = '';
  ver('sin-ubicacion', false);
  ver('carga', false);
  sinUbicacion = [];
  listasPegadas = 0;
}

/* --- los que nunca mandaron su ubicacion ------------------------------- */

/**
 * No se pega de ninguna parte: son los contactos que ya escribieron alguna
 * vez y de los que nunca llego un pin. En cuanto uno manda su ubicacion deja
 * de salir aqui solo -la consulta mira si tiene ubicacion guardada-, asi que
 * no hay nada que marcar ni que sacar a mano.
 */
function pintarSinUbicacion(total) {
  var caja = document.getElementById('sin-ubicacion');
  if (!sinUbicacion.length) {
    caja.innerHTML = '<div class="cab">Ninguno: a todos les llegó la ubicación.</div>';
    document.getElementById('sin-ubicacion-cuenta').textContent = '';
    actualizarCrear();
    return;
  }

  caja.innerHTML = '<div class="cab">' +
    '<label style="display:flex;gap:8px;align-items:center;flex:1"><input type="checkbox" id="sin-todos"> <b>Todos (' + sinUbicacion.length + ')</b></label>' +
    '<span id="sin-elegidos"></span>' +
    '</div>' +
    sinUbicacion.map(function (c) {
      return '<label class="uno"><input type="checkbox" class="sin-uno" value="' + esc(c.phone) + '" data-nombre="' + esc(c.name || '') + '">' +
        '<span class="quien"><b>' + esc(c.name || c.phone) + '</b><span>' + esc(c.phone) +
        (c.ultimo ? ' · escribió ' + esc(c.ultimo) : '') + '</span></span></label>';
    }).join('');

  caja.querySelector('#sin-todos').onchange = function () {
    var marcar = this.checked;
    caja.querySelectorAll('.sin-uno').forEach(function (x) { x.checked = marcar; });
    actualizarCrear();
  };
  caja.querySelectorAll('.sin-uno').forEach(function (x) { x.onchange = actualizarCrear; });
  document.getElementById('sin-ubicacion-cuenta').textContent =
    total > sinUbicacion.length ? sinUbicacion.length + ' de ' + total + ' (los más recientes)' : total + ' en total';
  actualizarCrear();
}

function elegidosSinUbicacion() {
  return [].slice.call(document.querySelectorAll('.sin-uno:checked')).map(function (x) {
    return { telefono: x.value, nombre: x.dataset.nombre || undefined };
  });
}

document.getElementById('traer-sin-ubicacion').onclick = async function () {
  var boton = this;
  boton.disabled = true;
  try {
    var r = await api('/admin/contacts?sinUbicacion=1&limit=500');
    sinUbicacion = (r.items || []).map(function (c) {
      return {
        phone: c.phone,
        name: c.name,
        ultimo: c.lastInboundAt ? new Date(c.lastInboundAt).toLocaleDateString('es-PE') : ''
      };
    });
    ver('sin-ubicacion', true);
    pintarSinUbicacion(r.total || sinUbicacion.length);
  } catch (error) { toast(error.message); }
  finally { boton.disabled = false; }
};

/* --- ajustes del reparto ----------------------------------------------- */

var PASOS_AJ = [
  ['solicitud', 'Texto inicial de respaldo', 'Se usa solo cuando el canal envía texto libre en vez de la plantilla inicial. Su espera se configura arriba.'],
  ['recordatorio', 'Texto base del recordatorio', 'Se usa en los seguimientos si el cliente no responde.'],
  ['insistencia', 'Texto base de la insistencia', 'Se usa en los seguimientos si el cliente responde, pero no manda la ubicación.']
];
/* Como le quedaria al cliente de ejemplo un texto escrito aqui. */
function previaDe(texto, ej) {
  return texto.replace(/\{nombre\}/g, ej.nombre.split(' ')[0]).replace(/\{pedido\}/g, ej.pedido).replace(/\{negocio\}/g, ej.negocio)
    .replace(/\{tienda\}/g, ej.tienda || 'la tienda')
    .replace(/\{producto\}/g, ej.producto || '')
    .replace(/\{direccion\}/g, ej.direccion).replace(/\{distrito\}/g, ej.distrito).replace(/\{como\}/g, ej.como);
}

/* Cada redaccion se ve entera, con sus parrafos; si hay varias, cada una con su rotulo. */
function previaHtml(lineas, ej, defecto) {
  if (!lineas.length) return esc(defecto);
  return lineas.map(function (t, i) {
    return '<div class="previa-msg">' + (lineas.length > 1 ? '<b class="previa-n">Redacción ' + (i + 1) + ' de ' + lineas.length + '</b>' : '') + esc(previaDe(t, ej)) + '</div>';
  }).join('');
}

function pintarPrevia(paso) {
  var d = ajustesCache;
  if (!d) return;
  var ta = document.querySelector('textarea[data-textos="' + paso + '"]');
  var lineas = ta ? lineasDeTextoMensaje(ta.value) : [];
  var caja = document.getElementById('aj-previa-' + paso);
  if (!caja) return;
  var pie = lineas.length > 1 ? 'tus ' + lineas.length + ' redacciones (se alternan)' : lineas.length ? 'tu texto' : 'texto de siempre';
  caja.innerHTML = previaHtml(lineas, d.ejemplo, d.textosDeSiempre[paso]) + '<small>' + pie + ' · para ' + esc(d.ejemplo.nombre) + ', pedido ' + esc(d.ejemplo.pedido) + '</small>';
}

/* El envio por tandas (solo lineas de la API) vive en los ajustes generales: se lee y se guarda aparte. */
/* true cuando ya se leyo lo guardado: antes, guardar no toca las tandas (si no, una
   carga lenta las apagaria sin querer: la casilla aun no muestra lo de verdad). */
var tandasCargadas = false;
function pintarTandas(t) {
  t = t || { activo: false, tamano: 50, pausaMin: 3 };
  document.getElementById('aj-tandas-activo').disabled = false;
  document.getElementById('aj-tandas-activo').checked = Boolean(t.activo);
  document.getElementById('aj-tandas-tamano').value = t.tamano || 50;
  document.getElementById('aj-tandas-min').value = t.pausaMin || 3;
  document.getElementById('aj-tandas-tamano').disabled = !t.activo;
  document.getElementById('aj-tandas-min').disabled = !t.activo;
}
async function cargarTandas() {
  try {
    var r = await api('/admin/ajustes');
    pintarTandas(r.guardado && r.guardado.tandasApi);
    tandasCargadas = true;
  } catch (e) {
    document.getElementById('aj-tandas-estado').textContent = 'No se pudo leer el envío por tandas: ' + e.message + ' Recarga la página antes de cambiarlo.';
  }
}
function leerTandas() {
  var activo = document.getElementById('aj-tandas-activo').checked;
  var tamano = Math.min(80, Math.max(1, Math.round(Number(document.getElementById('aj-tandas-tamano').value) || 50)));
  var pausaMin = Math.min(60, Math.max(2, Math.round(Number(document.getElementById('aj-tandas-min').value) || 3)));
  return { activo: activo, tamano: tamano, pausaMin: pausaMin };
}
document.getElementById('aj-tandas-activo').addEventListener('change', function () {
  document.getElementById('aj-tandas-tamano').disabled = !this.checked;
  document.getElementById('aj-tandas-min').disabled = !this.checked;
});

function pintarAjustes(d) {
  ajustesCache = d;
  if (ajustesSucios) return;
  ajustesBase = d;
  var a = d.ajustes;
  var esperas = a.esperasMensajesSegundos || (a.esperasMensajesMinutos || Array(Math.max(0, a.maxIntentos - 1)).fill(a.esperaRespuestaMinutos)).map(function (n) { return n * 60; });
  ponerDuracion('aj-pausa-min', a.pausaMinSegundos);
  ponerDuracion('aj-pausa-max', a.pausaMaxSegundos);
  cargarTandas();
  document.getElementById('aj-hora-inicio').value = a.horaInicio;
  document.getElementById('aj-hora-fin').value = a.horaFin;
  ponerDuracion('aj-espera-final', a.esperaFinalSegundos != null ? a.esperaFinalSegundos : (a.esperaFinalMinutos || 0) * 60);
  document.getElementById('aj-tiempo-solicitud').innerHTML = controlTiempoInicialHtml(a.esperaPrimerMensajeSegundos != null ? a.esperaPrimerMensajeSegundos : (a.esperaPrimerMensajeMinutos || 0) * 60);
  pintarSecuencia(esperas);

  /* El «Texto inicial de respaldo» del reparto ya no se muestra (28/10): el que de verdad recibe el
     cliente es el «Primer mensaje» de abajo. Lo guardado no se pierde: al guardar, un texto sin su caja
     conserva lo que tenía (ver textos[paso] más abajo). */
  document.getElementById('aj-pasos').innerHTML = '';
  pintarTextosAdicionales(esperas.length, textosSeguimientosDe(a, esperas.length));
  document.getElementById('aj-agregar-mensaje').disabled = esperas.length >= 99;
  document.getElementById('aj-agregar-mensaje').textContent = esperas.length >= 99 ? 'Máximo 99 recordatorios' : 'Agregar recordatorio';

  document.querySelectorAll('#aj-pasos [data-marcador]').forEach(function (c) {
    c.onclick = function () {
      var ta = c.closest('.variante, .paso').querySelector('textarea');
      var ini = ta.selectionStart || ta.value.length, fin = ta.selectionEnd || ini;
      ta.value = ta.value.slice(0, ini) + c.getAttribute('data-marcador') + ta.value.slice(fin);
      ta.focus();
      ta.dispatchEvent(new Event('input'));
    };
  });
}

/* Una redaccion puede tener varios parrafos (con lineas en blanco). Si quieres
   varias redacciones para que se alternen, sepáralas con una línea que solo diga ---. */
function lineasDeTextoMensaje(valor) {
  var bloques = [], actual = [];
  String(valor || '').replace(/\r\n?/g, '\n').split('\n').forEach(function (l) {
    if (/^\s*-{3,}\s*$/.test(l)) { bloques.push(actual); actual = []; } else actual.push(l.replace(/\s+$/, ''));
  });
  bloques.push(actual);
  return bloques.map(function (b) { return b.join('\n').replace(/\n{3,}/g, '\n\n').trim(); }).filter(Boolean);
}
/* Lo guardado vuelve al cuadro con cada redaccion separada por --- */
function textoDeLineas(lineas) { return (lineas || []).join('\n---\n'); }
var AYUDA_REDACCION = 'Puedes dejar líneas en blanco entre párrafos. Para alternar varias redacciones, sepáralas con una línea que diga ---.';

function textosSeguimientosDe(a, cantidad) {
  return Array.from({ length: cantidad }, function (_, i) {
    if (a.textosSeguimientos && a.textosSeguimientos[i]) return a.textosSeguimientos[i];
    var antiguo = i >= 2 && (a.textosAdicionales || [])[i - 2];
    return { recordatorio: antiguo && antiguo.length ? antiguo : (a.textos.recordatorio || []), insistencia: antiguo && antiguo.length ? antiguo : (a.textos.insistencia || []) };
  });
}

function leerTextosAdicionales() {
  var textos = [];
  document.querySelectorAll('#aj-pasos-adicionales textarea[data-texto-adicional]').forEach(function (ta) {
    var i = Number(ta.getAttribute('data-texto-adicional'));
    if (!textos[i]) textos[i] = { recordatorio: [], insistencia: [] };
    textos[i][ta.getAttribute('data-rama')] = lineasDeTextoMensaje(ta.value);
  });
  return textos;
}

function controlTiempoInicialHtml(segundos) {
  var d = segundosEnUnidad(segundos);
  return '<div class="aj-tiempo-inicial"><span>Después de recibir el pedido de GSG, enviar la plantilla tras</span><input id="aj-espera-primero" data-duracion type="number" min="0" max="86400" step="any" class="aj-num" aria-label="Espera antes de enviar la plantilla Solicitud de ubicación" value="' + esc(String(d.cantidad)) + '" data-unidad-actual="' + d.unidad + '"><select id="aj-espera-primero-unidad" data-unidad-for="aj-espera-primero" aria-label="Unidad de espera de Solicitud de ubicación"><option value="1" ' + (d.unidad === 1 ? 'selected' : '') + '>segundos</option><option value="60" ' + (d.unidad === 60 ? 'selected' : '') + '>minutos</option><option value="3600" ' + (d.unidad === 3600 ? 'selected' : '') + '>horas</option></select></div><p class="cuando" style="margin:8px 0 0">Con 0, no hay espera individual; se conserva la pausa entre clientes.</p>';
}

function controlTiempoSecuenciaHtml(segundos, indice) {
  var d = segundosEnUnidad(segundos);
  var antecedente = indice === 0 ? 'Después de la solicitud inicial' : 'Después del recordatorio ' + indice;
  return '<div class="aj-tiempo-paso" data-seguimiento="' + indice + '"><h4>Recordatorio ' + (indice + 1) + '</h4><p class="cuando">' + antecedente + '</p><div class="aj-tiempo-control"><input data-espera-mensaje data-duracion data-indice-espera="' + indice + '" type="number" min="1" max="86400" step="any" class="aj-num" aria-label="Espera antes del recordatorio ' + (indice + 1) + '" value="' + esc(String(d.cantidad)) + '" data-unidad-actual="' + d.unidad + '"><select data-unidad-secuencia="' + indice + '" aria-label="Unidad de espera del recordatorio ' + (indice + 1) + '"><option value="1" ' + (d.unidad === 1 ? 'selected' : '') + '>segundos</option><option value="60" ' + (d.unidad === 60 ? 'selected' : '') + '>minutos</option><option value="3600" ' + (d.unidad === 3600 ? 'selected' : '') + '>horas</option></select></div><button type="button" class="btn sm" data-quitar-seguimiento="' + indice + '">Quitar</button></div>';
}

function pintarSecuencia(esperas) {
  var caja = document.getElementById('aj-secuencia');
  caja.innerHTML = esperas.map(function (segundos, indice) { return controlTiempoSecuenciaHtml(segundos, indice); }).join('');
  document.getElementById('aj-agregar-mensaje').disabled = esperas.length >= 99;
  document.getElementById('aj-agregar-mensaje').textContent = esperas.length >= 99 ? 'Máximo 99 recordatorios' : 'Agregar recordatorio';
  if (typeof pintarSeguimientosMeta === 'function') pintarSeguimientosMeta(esperas);
}

function pintarTextosAdicionales(cantidad, textos) {
  var caja = document.getElementById('aj-pasos-adicionales');
  if (!caja) return;
  caja.innerHTML = Array.from({ length: cantidad }, function (_, i) {
    var variantes = textos[i] || { recordatorio: [], insistencia: [] };
    return '<div class="paso" data-texto-seguimiento="' + i + '"><h4>Seguimiento ' + (i + 1) + '</h4>' +
      ['recordatorio', 'insistencia'].map(function (rama) {
        var lineas = variantes[rama] || [];
        var titulo = rama === 'recordatorio' ? 'Si no respondió' : 'Si respondió sin ubicación';
        /* La variante «respondió sin ubicación» ya no se muestra; queda oculta para guardar lo que tenía. */
        return '<div class="variante"' + (rama === 'insistencia' ? ' hidden' : '') + '>' + (rama === 'insistencia' ? '' : '<h5>' + titulo + '</h5>') +
          '<div class="previa" id="aj-previa-adicional-' + i + '-' + rama + '"></div>' +
          '<textarea data-texto-adicional="' + i + '" data-rama="' + rama + '" rows="3" aria-label="Seguimiento ' + (i + 1) + ': ' + titulo + '" placeholder="Vacío: usar el texto de siempre. Puedes dejar líneas en blanco entre párrafos.">' + esc(textoDeLineas(lineas)) + '</textarea>' +
          '<p class="marcadores">Puedes usar: ' + marcadoresHtml() + ' — clic para insertar.</p><p class="marcadores">' + AYUDA_REDACCION + '</p></div>';
      }).join('') + '<button type="button" class="btn sm" data-quitar-adicional="' + i + '">Quitar seguimiento</button></div>';
  }).join('');
  caja.querySelectorAll('textarea[data-texto-adicional]').forEach(function (ta) {
    function actualizar() {
      var i = ta.getAttribute('data-texto-adicional'), rama = ta.getAttribute('data-rama');
      var lineas = lineasDeTextoMensaje(ta.value);
      document.getElementById('aj-previa-adicional-' + i + '-' + rama).innerHTML = previaHtml(lineas, ajustesCache.ejemplo, ajustesCache.textosDeSiempre[rama]);
    }
    ta.addEventListener('input', actualizar);
    actualizar();
  });
  caja.querySelectorAll('[data-marcador]').forEach(function (c) {
    c.onclick = function () {
      var ta = c.closest('.variante, .paso').querySelector('textarea');
      var ini = ta.selectionStart || ta.value.length, fin = ta.selectionEnd || ini;
      ta.value = ta.value.slice(0, ini) + c.getAttribute('data-marcador') + ta.value.slice(fin);
      ta.focus();
      ta.dispatchEvent(new Event('input'));
    };
  });
}

function segundosEnUnidad(segundos) {
  segundos = Number(segundos) || 0;
  if (segundos && segundos % 3600 === 0) return { cantidad: segundos / 3600, unidad: 3600 };
  if (segundos && segundos % 60 === 0) return { cantidad: segundos / 60, unidad: 60 };
  return { cantidad: segundos, unidad: 1 };
}
function ponerDuracion(id, segundos) {
  var campo = document.getElementById(id), unidad = document.getElementById(id + '-unidad');
  var d = segundosEnUnidad(segundos);
  campo.value = d.cantidad;
  unidad.value = String(d.unidad);
  campo.setAttribute('data-segundos', String(Number(segundos) || 0));
  campo.setAttribute('data-unidad-actual', String(d.unidad));
}
function leerDuracion(id) {
  var campo = document.getElementById(id), unidad = document.getElementById(id + '-unidad');
  var cantidad = Number(String(campo.value).trim().replace(',', '.'));
  var segundos = cantidad * Number(unidad.value);
  var minimoSegundos = id === 'aj-pausa-min' || id === 'aj-pausa-max' ? 1 : 0;
  if (!campo.value.trim() || !Number.isFinite(segundos) || !Number.isInteger(segundos) || segundos < minimoSegundos || segundos > 86400) throw new Error('Revisa ' + (campo.getAttribute('aria-label') || 'el tiempo') + ': debe representar segundos enteros entre ' + minimoSegundos + ' y 86400.');
  return segundos;
}
function duracionHumana(segundos) {
  var d = segundosEnUnidad(segundos);
  var nombre = d.unidad === 3600 ? 'h' : d.unidad === 60 ? 'min' : 's';
  return d.cantidad + ' ' + nombre;
}
document.querySelector('.cuerpo.aj').addEventListener('change', function (event) {
  var select = event.target;
  if (!select || !select.hasAttribute('data-unidad-for')) return;
  var id = select.getAttribute('data-unidad-for'), campo = document.getElementById(id);
  var segundos = Number(campo.value) * Number(campo.getAttribute('data-unidad-actual') || 1);
  var factor = Number(select.value);
  if (!Number.isInteger(segundos) || segundos < 0) { select.value = String(Number(campo.getAttribute('data-unidad-actual') || 1)); return; }
  campo.value = segundos ? (segundos / factor).toString() : '0';
  campo.setAttribute('data-segundos', String(Math.round(segundos)));
  campo.setAttribute('data-unidad-actual', String(factor));
});

document.getElementById('aj-agregar-mensaje').onclick = function () {
  var esperas = leerEsperasSecuencia();
  if (esperas.length < 99) esperas.push(esperas.length ? esperas[esperas.length - 1] : ((ajustesCache && ajustesCache.ajustes.esperaRespuestaMinutos || 1) * 60));
  var textos = leerTextosAdicionales();
  pintarSecuencia(esperas);
  pintarTextosAdicionales(esperas.length, textos);
  marcarAjustesSucios();
};
document.getElementById('aj-pasos-adicionales').onclick = function (event) {
  var indice = event.target && event.target.getAttribute('data-quitar-adicional');
  if (indice === null || indice === undefined) return;
  var esperas = leerEsperasSecuencia();
  var textos = leerTextosAdicionales();
  esperas.splice(Number(indice), 1);
  textos.splice(Number(indice), 1);
  pintarSecuencia(esperas);
  pintarTextosAdicionales(esperas.length, textos);
  marcarAjustesSucios();
};
function quitarSeguimiento(indice) {
  var esperas = leerEsperasSecuencia();
  var textos = leerTextosAdicionales();
  esperas.splice(indice, 1);
  segMeta.nombres = leerSegMeta(); segMeta.nombres.splice(indice, 1); segMeta.tocado = true; omitirLecturaSeg = true;
  if (indice >= 2) textos.splice(indice - 2, 1);
  pintarSecuencia(esperas);
  pintarTextosAdicionales(esperas.length, textos);
  marcarAjustesSucios();
}
document.getElementById('aj-secuencia').onclick = function (event) {
  var boton = event.target.closest('[data-quitar-seguimiento]');
  if (boton) quitarSeguimiento(Number(boton.getAttribute('data-quitar-seguimiento')));
};
function leerEsperasSecuencia() {
  var campos = Array.prototype.slice.call(document.querySelectorAll('[data-espera-mensaje]')).sort(function (a, b) { return Number(a.getAttribute('data-indice-espera')) - Number(b.getAttribute('data-indice-espera')); });
  return campos.map(function (campo) {
    var select = campo.parentNode.querySelector('[data-unidad-secuencia]');
    var cantidad = Number(String(campo.value).trim().replace(',', '.'));
    var segundos = cantidad * Number(select.value);
    if (!campo.value.trim() || !Number.isFinite(segundos) || !Number.isInteger(segundos) || segundos < 1 || segundos > 86400) throw new Error('El tiempo del recordatorio ' + (Number(campo.getAttribute('data-indice-espera')) + 1) + ' debe ser de 1 segundo a 24 horas.');
    return segundos;
  });
}
document.getElementById('aj-secuencia').addEventListener('change', cambiarUnidadSecuencia);
function cambiarUnidadSecuencia(event) {
  var select = event.target;
  if (!select || !select.hasAttribute('data-unidad-secuencia')) return;
  var campo = select.parentNode.querySelector('[data-espera-mensaje]');
  var segundos = Number(campo.value) * Number(campo.getAttribute('data-unidad-actual') || 60);
  var factor = Number(select.value);
  if (!Number.isInteger(segundos) || segundos < 1) { select.value = String(Number(campo.getAttribute('data-unidad-actual') || 60)); return; }
  campo.value = segundos ? String(segundos / factor) : '0';
  campo.setAttribute('data-unidad-actual', String(factor));
}

var MARCADORES = [
  ['{nombre}', 'El nombre del cliente'],
  ['{pedido}', 'El número de pedido o guía'],
  ['{negocio}', 'El nombre de tu negocio'],
  ['{tienda}', 'La tienda del pedido de GSG (por ejemplo, Mass); si no viene, «la tienda»'],
  ['{producto}', 'El producto del pedido de GSG; si no viene, no sale'],
  ['{direccion}', 'La dirección del pedido'],
  ['{distrito}', 'El distrito'],
  ['{horario}', 'Horario de entrega de Pedidos GSG'],
  ['{desde}', 'Hora de inicio de entrega'],
  ['{hasta}', 'Hora final de entrega'],
  ['{hastaExtendido}', 'Hora final del horario extendido'],
  ['{como}', 'Cómo mandar la ubicación: con el botón o desde el clip, según toque']
];
function marcadoresHtml() {
  return MARCADORES.map(function (m) {
    return '<code data-marcador="' + m[0] + '" title="' + esc(m[1]) + '">' + m[0] + '</code>';
  }).join(' ');
}

function actualizarEstadoCambios() {
  document.getElementById('aj-descartar').classList.toggle('hidden', !ajustesSucios);
  if (ajustesSucios) document.getElementById('aj-estado').textContent = 'Tienes cambios sin guardar.';
}
function marcarAjustesSucios() { ajustesSucios = true; actualizarEstadoCambios(); }
document.querySelector('.cuerpo.aj').addEventListener('input', function (event) {
  if (!event.target.closest('#aj-editor-inicial, #aj-plantilla-meta')) marcarAjustesSucios();
});
document.querySelector('.cuerpo.aj').addEventListener('change', function (event) {
  if (!event.target.closest('#aj-editor-inicial, #aj-plantilla-meta')) marcarAjustesSucios();
});
document.getElementById('aj-descartar').onclick = function () {
  if (!ajustesBase) return;
  ajustesSucios = false;
  document.getElementById('aj-estado').textContent = 'Cambios descartados.';
  pintarAjustes(ajustesBase);
  actualizarEstadoCambios();
};

/*
 * El primer mensaje que recibe el cliente (textos.solicitudUbicacion de
 * Pedidos GSG): a la vista y editable aquí. Vacío en la base = el de fábrica;
 * por eso, si se guarda igual al de fábrica, se guarda vacío (y el de fábrica
 * sigue cambiando su última frase cuando la dirección no trae número).
 */
var TEXTO_INICIAL_FABRICA = ${JSON.stringify(TEXTOS_POR_DEFECTO.solicitudUbicacion)};
var EJEMPLO_INICIAL = { nombreCompleto: 'Daniel Rufrán Méndez', nombre: 'Daniel', producto: 'PARLANTE', empresa: 'RGTECHNOLOGY', tracking: 'GSG-E-260541', nroPedido: '', metodoPago: 'YAPE', monto: '544.00', direccionCompleta: 'CARABAYLLO - Carabayllo Torreblanca', direccion: 'Carabayllo Torreblanca', distrito: 'Carabayllo', horario: 'de 2 a 8 de la noche', desde: '2:00 p. m.', hasta: '8:00 p. m.', hastaExtendido: '9:00 p. m.', negocio: 'GSG Courier', pedido: 'GSG-E-260541' };
var DATOS_INICIAL = [
  ['{nombreCompleto}', 'Nombre del cliente'], ['{nombre}', 'Solo el nombre'], ['{producto}', 'Producto'], ['{empresa}', 'Empresa'],
  ['{tracking}', 'Código'], ['{nroPedido}', 'Nro. de pedido'], ['{metodoPago}', 'Método de pago'], ['{monto}', 'Monto a cobrar'],
  ['{direccionCompleta}', 'Dirección'], ['{horario}', 'Horario de entrega']
];
document.getElementById('aj-datos-inicial').innerHTML = DATOS_INICIAL.map(function (d) {
  return '<button type="button" data-dato-inicial="' + d[0] + '" title="Pone ' + d[0] + ': en el mensaje sale el dato de cada pedido">' + esc(d[1]) + '</button>';
}).join('');
document.getElementById('aj-datos-inicial').addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-dato-inicial]');
  if (!b) return;
  var ta = document.getElementById('aj-texto-inicial');
  var ini = ta.selectionStart != null ? ta.selectionStart : ta.value.length, fin = ta.selectionEnd != null ? ta.selectionEnd : ini;
  var dato = b.getAttribute('data-dato-inicial');
  ta.value = ta.value.slice(0, ini) + dato + ta.value.slice(fin);
  ta.focus();
  ta.setSelectionRange(ini + dato.length, ini + dato.length);
  previaInicial();
});
var textoInicialGuardado = null;
function previaInicial() {
  var texto = document.getElementById('aj-texto-inicial').value;
  /* Como en el envío: una línea con un dato que no vino no sale. */
  var lineas = texto.split('\n').filter(function (l) {
    var vacia = false;
    l.replace(/\{(\w+)\}/g, function (_, k) { if (EJEMPLO_INICIAL[k] === '') vacia = true; return ''; });
    return !vacia;
  }).map(function (l) { return l.replace(/\{(\w+)\}/g, function (todo, k) { return EJEMPLO_INICIAL[k] != null ? EJEMPLO_INICIAL[k] : todo; }); });
  document.getElementById('aj-previa-inicial').innerHTML = esc(lineas.join('\n')) + '<small>para ' + esc(EJEMPLO_INICIAL.nombreCompleto) + ', pedido ' + esc(EJEMPLO_INICIAL.tracking) + '</small>';
  var estado = document.getElementById('aj-estado-texto-inicial');
  var propio = texto.trim() !== TEXTO_INICIAL_FABRICA.trim();
  var cambiado = textoInicialGuardado !== null && texto !== (textoInicialGuardado || TEXTO_INICIAL_FABRICA);
  estado.textContent = cambiado ? 'Sin guardar' : propio ? 'Texto propio' : 'Texto de fábrica';
  estado.className = 'chip ' + (cambiado ? 'tono-ambar' : propio ? 'tono-azul' : 'tono-gris');
  document.getElementById('aj-fabrica-texto-inicial').disabled = !propio;
}
async function cargarTextoInicial() {
  try {
    var d = await api('/admin/entregas');
    textoInicialGuardado = (d.ajustes && d.ajustes.textos && d.ajustes.textos.solicitudUbicacion) || '';
    document.getElementById('aj-texto-inicial').value = textoInicialGuardado || TEXTO_INICIAL_FABRICA;
    previaInicial();
  } catch (e) { document.getElementById('aj-estado-texto-inicial').textContent = e.message; }
}
async function guardarTextoInicial(valor) {
  var boton = document.getElementById('aj-guardar-texto-inicial');
  var estado = document.getElementById('aj-estado-texto-inicial');
  boton.disabled = true;
  estado.textContent = 'Guardando…';
  try {
    var guardar = valor.trim() === TEXTO_INICIAL_FABRICA.trim() ? '' : valor;
    await api('/admin/entregas/ajustes', { method: 'POST', body: { textos: { solicitudUbicacion: guardar } } });
    textoInicialGuardado = guardar;
    document.getElementById('aj-texto-inicial').value = guardar || TEXTO_INICIAL_FABRICA;
    previaInicial();
    toast(guardar ? 'Primer mensaje guardado.' : 'Se usa el texto de fábrica.');
  } catch (e) { estado.textContent = e.message; }
  finally { boton.disabled = false; }
}
document.getElementById('aj-texto-inicial').addEventListener('input', previaInicial);
document.getElementById('aj-guardar-texto-inicial').onclick = function () { guardarTextoInicial(document.getElementById('aj-texto-inicial').value); };
document.getElementById('aj-fabrica-texto-inicial').onclick = function () { guardarTextoInicial(TEXTO_INICIAL_FABRICA); };
cargarTextoInicial();

var OTROS_DEL_BOT=['ubicacionRegistrada','ubicacionCambiada','invitarCambioUbicacion','invitarOtroCambioUbicacion','cambioUbicacionAntes'];
var otrosDef = {};
async function cargarOtrosTextos() {
  var estado = document.getElementById('aj-estado-otros');
  try {
    var d = await api('/admin/entregas');
    var t = d.textos || {}, guardados = (d.ajustes && d.ajustes.textos) || {};
    otrosDef = t.porDefecto || {};
    var vars = t.variables || {}, desc = t.descripcion || {}, lista = document.getElementById('aj-otros-lista');
    lista.innerHTML = '';
    Object.keys(otrosDef).forEach(function (k) {
      if (OTROS_DEL_BOT.indexOf(k) < 0) return;
      var l = document.createElement('label');
      l.style.display = 'block';
      l.style.marginBottom = '12px';
      l.innerHTML = '<strong>' + esc(k) + '</strong> <span class="muted">' + esc(desc[k] || '') + '</span>' + (vars[k] && vars[k].length ? '<span class="muted"> Variables: ' + esc(vars[k].join(' ')) + '</span>' : '') + '<textarea data-otro="' + esc(k) + '" rows="4" maxlength="1500" style="width:100%"></textarea>';
      l.querySelector('textarea').value = (guardados[k] || '').trim() ? guardados[k] : otrosDef[k];
      lista.appendChild(l);
    });
    estado.textContent = 'Listo';
    estado.className = 'chip tono-gris';
  } catch (e) { estado.textContent = e.message; }
}
async function guardarOtrosTextos() {
  var boton = document.getElementById('aj-guardar-otros');
  var estado = document.getElementById('aj-estado-otros');
  boton.disabled = true;
  estado.textContent = 'Guardando…';
  try {
    var textos = {};
    Array.prototype.forEach.call(document.querySelectorAll('#aj-otros-lista textarea[data-otro]'), function (ta) {
      var k = ta.getAttribute('data-otro'), v = ta.value.trim();
      textos[k] = (!v || v === (otrosDef[k] || '').trim()) ? '' : ta.value;
    });
    await api('/admin/entregas/ajustes', { method: 'POST', body: { textos: textos } });
    estado.textContent = 'Guardado';
    toast('Mensajes guardados.');
    await cargarOtrosTextos();
  } catch (e) { estado.textContent = e.message; }
  finally { boton.disabled = false; }
}
document.getElementById('aj-guardar-otros').onclick = guardarOtrosTextos;
var cuFabrica = '';
async function cargarCambioUbicacion() {
  var estado = document.getElementById('aj-cu-estado');
  try {
    var d = await api('/admin/entregas');
    var aj = d.ajustes || {}, guardados = aj.textos || {};
    cuFabrica = ((d.textos || {}).porDefecto || {}).cambioUbicacionTarde || '';
    document.getElementById('aj-cu-hora').value = aj.cambioUbicacionHasta || '15:00';
    document.getElementById('aj-cu-texto').value = (guardados.cambioUbicacionTarde || '').trim() ? guardados.cambioUbicacionTarde : cuFabrica;
    document.getElementById('aj-cu-autorizados').value = (aj.autorizadosCambioUbicacion || []).join(', ');
    estado.textContent = '';
  } catch (e) { estado.textContent = e.message; }
}
async function guardarCambioUbicacion(fabrica) {
  var boton = document.getElementById('aj-cu-guardar');
  var estado = document.getElementById('aj-cu-estado');
  var hora = document.getElementById('aj-cu-hora').value;
  var texto = fabrica ? '' : document.getElementById('aj-cu-texto').value;
  if (!/^\d{2}:\d{2}$/.test(hora)) { estado.textContent = 'Pon una hora válida.'; return; }
  if (texto.trim() === cuFabrica.trim()) texto = '';
  // Los números de GSG autorizados: solo dígitos, sin repetir; uno mal escrito no se guarda a medias.
  // «51 999 777 888» y «999777888» son el mismo número: se comparan los últimos 9 dígitos.
  var autorizados = [], vistos = [], malos = [];
  document.getElementById('aj-cu-autorizados').value.split(/[,;\n]+/).forEach(function (p) {
    var t = p.trim(); if (!t) return;
    var d = t.replace(/\D/g, '');
    if (d.length < 9 || d.length > 15) { malos.push(t); return; }
    if (vistos.indexOf(d.slice(-9)) < 0) { vistos.push(d.slice(-9)); autorizados.push(d); }
  });
  if (malos.length) { estado.textContent = 'Estos números no se entienden (tienen que tener entre 9 y 15 dígitos): ' + malos.join(', '); return; }
  boton.disabled = true;
  estado.textContent = 'Guardando…';
  try {
    await api('/admin/entregas/ajustes', { method: 'POST', body: { cambioUbicacionHasta: hora, textos: { cambioUbicacionTarde: texto }, autorizadosCambioUbicacion: autorizados } });
    toast('Cambio de ubicación guardado.');
    await cargarCambioUbicacion();
  } catch (e) { estado.textContent = e.message; }
  finally { boton.disabled = false; }
}
document.getElementById('aj-cu-guardar').onclick = function () { guardarCambioUbicacion(false); };
document.getElementById('aj-cu-fabrica').onclick = function () { guardarCambioUbicacion(true); };
cargarCambioUbicacion();

/* --- Plantillas aprobadas por Meta (el primer mensaje con WhatsApp API) --- */
var ESTADO_PLANTILLA = { APPROVED: ['verde', 'Aprobada por Meta'], PENDING: ['ambar', 'En revisión en Meta'], REJECTED: ['rojo', 'Rechazada por Meta'], PAUSED: ['ambar', 'Pausada por Meta'], DISABLED: ['rojo', 'Deshabilitada por Meta'] };
function avisoPlantilla(texto, mal) {
  var el = document.getElementById('pm-aviso');
  el.textContent = String(texto || '').replace(/^HTTP \d+ · /, '');
  el.className = 'pm-aviso ' + (mal ? 'mal' : 'ok');
  el.hidden = !texto;
}
function rellenarPlantilla(cuerpo, datos) {
  return String(cuerpo || '').replace(/\{\{(\d+)\}\}/g, function (m, n) { var d = datos[Number(n) - 1]; return d ? d.ejemplo : m; });
}
function pintarPlantillaMeta(d) {
  document.getElementById('pm-usar').checked = Boolean(d.usar);
  segMeta.primero = d.nombre || '';
  var selNombre = document.getElementById('pm-nombre');
  if (document.activeElement !== selNombre) { selNombre.innerHTML = opcionesMeta(d.nombre || ''); if (d.nombre) selNombre.value = d.nombre; }
  var chip = document.getElementById('pm-chip');
  var t = d.plantilla;
  var e = t ? (ESTADO_PLANTILLA[t.estado] || ['gris', t.estado]) : ['gris', 'No está en Meta todavía'];
  chip.className = 'chip tono-' + e[0];
  chip.textContent = !d.usar ? 'Apagada' : e[1];
  document.getElementById('pm-lista').innerHTML = d.datos.map(function (x) {
    return '<li><code>{{' + x.n + '}}</code> ' + esc(x.dato) + ' <span class="muted">· ej. ' + esc(x.ejemplo) + '</span></li>';
  }).join('');
  var previa = document.getElementById('pm-previa');
  previa.textContent = t && t.cuerpo
    ? rellenarPlantilla(t.cuerpo, d.datos)
    : 'Cuando Meta apruebe la plantilla y la traigas, aquí se ve cómo le llega al cliente.';
  var nota = document.getElementById('aj-con-meta');
  if (nota) nota.hidden = !(d.usar && t && t.estado === 'APPROVED');
  if (t && t.variables > d.datos.length) avisoPlantilla('La plantilla de Meta tiene ' + t.variables + ' datos y el sistema solo sabe llenar ' + d.datos.length + ' (nombre, producto, empresa, código, método de pago, monto, dirección y horario). Revísala en Meta.', true);
  else if (t && t.variables && t.variables < d.datos.length) avisoPlantilla('Esta plantilla lleva ' + t.variables + ' datos: el sistema llena los primeros ' + t.variables + ' en este orden y deja el resto. Si algún dato no es el que esperas, cámbialo en el mensaje donde la uses.', false);
  segMeta.ejemplos = d.datos;
  pintarPrimeroMeta();
}
/* Una plantilla por mensaje, en orden: solo las aprobadas por Meta. */
var plantillasRutas = { solicitud: [], recordatorio: [], insistencia: [] };
var segMeta = { nombres: [], datos: {}, aprobadas: [], ejemplos: [], primero: '', tocado: false };
var omitirLecturaSeg = false;
function leerSegMeta() {
  var out = [];
  document.querySelectorAll('[data-seg-meta]').forEach(function (sel) { out[Number(sel.getAttribute('data-seg-meta'))] = sel.value; });
  return out.filter(function (x) { return x !== undefined; });
}
function opcionesMeta(elegida) {
  var hay = segMeta.aprobadas.some(function (t) { return t.name === elegida; });
  return (elegida && !hay ? '<option value="' + esc(elegida) + '" selected>' + esc(elegida) + ' (no está aprobada en Meta)</option>' : '') +
    segMeta.aprobadas.map(function (t) { return '<option value="' + esc(t.name) + '"' + (t.name === elegida ? ' selected' : '') + '>' + esc(t.name) + ' (' + t.variables + ' datos)</option>'; }).join('');
}
var ROTULOS_DATO = ['nombre del cliente', 'producto', 'empresa', 'código', 'método de pago', 'monto a cobrar', 'dirección', 'horario de entrega'];
var SEG_DEFECTO = ['recordatorio_inicial'];
var DATOS_DEFECTO = { seguimiento: [1, 3] };
function mapaDe(nombre, n) { var m = segMeta.datos[nombre] || DATOS_DEFECTO[nombre] || [1, 2, 3, 4, 5, 6, 7, 8]; return m.slice(0, n); }
function previaMeta(t, mapa) {
  if (!t) return '';
  var ej = segMeta.ejemplos || [];
  return String(t.body || '').replace(/[{][{](\d+)[}][}]/g, function (m, n) { var d = ej[(mapa[Number(n) - 1] || Number(n)) - 1]; return d ? d.ejemplo : m; });
}
function pintarSeguimientosMeta(esperas, soltarDom) {
  var caja = document.getElementById('pm-seguimientos');
  if (!caja || typeof segMeta === 'undefined' || !segMeta) return;
  if (!omitirLecturaSeg && soltarDom !== false && segMeta.tocado) { var leidos = leerSegMeta(); if (leidos.length) segMeta.nombres = leidos; }
  omitirLecturaSeg = false;
  if (!esperas) { try { esperas = leerEsperasSecuencia(); } catch (e) { esperas = (ajustesCache && ajustesCache.ajustes && ajustesCache.ajustes.esperasMensajesSegundos) || []; } }
  document.getElementById('pm-sin-aprobadas').hidden = segMeta.aprobadas.length > 0;
  caja.innerHTML = esperas.map(function (seg, i) {
    var nombre = segMeta.nombres[i] || segMeta.nombres[segMeta.nombres.length - 1] || '';
    return '<div class="pm-paso"><div class="pm-paso-cab"><span class="aj-paso-num">' + (i + 2) + '</span><div><b>Recordatorio ' + (i + 1) + '</b><span class="muted"> · ' + duracionHumana(seg) + ' después ' + (i === 0 ? 'del primer mensaje' : 'del recordatorio ' + i) + '</span></div></div>' +
      '<select data-seg-meta="' + i + '" aria-label="Plantilla del recordatorio ' + (i + 1) + '">' + opcionesMeta(nombre) + '</select>' +
      '<div class="pm-vars" data-seg-vars="' + i + '"></div><div class="previa pm-previa-paso" data-seg-previa="' + i + '"></div></div>';
  }).join('');
  if (segMeta.aprobadas.length) segMeta.nombres = leerSegMeta();
  pintarDatosSegMeta();
  pintarPrimeroMeta();
}
function pintarPrimeroMeta() {
  var sel = document.getElementById('pm-nombre');
  var t = segMeta.aprobadas.find(function (x) { return x.name === sel.value; });
  var caja = document.getElementById('pm-previa-primero');
  caja.textContent = t ? previaMeta(t, [1, 2, 3, 4, 5, 6, 7, 8]) : '';
  caja.hidden = !t;
}
function pintarDatosSegMeta() {
  document.querySelectorAll('[data-seg-meta]').forEach(function (sel) {
    var i = sel.getAttribute('data-seg-meta');
    var t = segMeta.aprobadas.find(function (x) { return x.name === sel.value; });
    var cajaVars = document.querySelector('[data-seg-vars="' + i + '"]');
    var cajaPrevia = document.querySelector('[data-seg-previa="' + i + '"]');
    var n = t ? t.variables : 0, mapa = t ? mapaDe(t.name, n) : [];
    cajaVars.innerHTML = Array.from({ length: n }, function (_, j) {
      return '<label>{{' + (j + 1) + '}} = <select data-seg-var="' + esc(t.name) + '|' + j + '">' + ROTULOS_DATO.map(function (r, k) { return '<option value="' + (k + 1) + '"' + (mapa[j] === k + 1 ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select></label>';
    }).join('');
    cajaPrevia.textContent = t ? previaMeta(t, mapa) : 'Elige una plantilla aprobada.';
  });
}
document.getElementById('pm-seguimientos').addEventListener('change', function (event) {
  var el = event.target;
  if (el.hasAttribute('data-seg-var')) {
    var partes = el.getAttribute('data-seg-var').split('|');
    var m = (segMeta.datos[partes[0]] || DATOS_DEFECTO[partes[0]] || [1, 2, 3, 4, 5, 6, 7, 8]).slice();
    m[Number(partes[1])] = Number(el.value);
    segMeta.datos[partes[0]] = m;
    pintarDatosSegMeta();
  } else if (el.hasAttribute('data-seg-meta')) {
    segMeta.tocado = true;
    segMeta.nombres = leerSegMeta();
    pintarDatosSegMeta();
  }
});
document.getElementById('pm-nombre').addEventListener('change', pintarPrimeroMeta);
async function cargarRecordatorioMeta() {
  try {
    var r = await Promise.all([api('/admin/templates'), api('/admin/rutas/ajustes')]);
    segMeta.aprobadas = (r[0] || []).filter(function (t) { return t.status === 'APPROVED'; });
    var a = (r[1] && r[1].ajustes) || {};
    plantillasRutas = a.plantillas || plantillasRutas;
    if (a.datosPlantillas) segMeta.datos = a.datosPlantillas;
    if (!segMeta.tocado) {
      segMeta.nombres = a.plantillasSeguimientos || [];
      /* Sin nada guardado: las dos de GSG, si la cuenta las tiene aprobadas (el servidor hace lo mismo). */
      if (!segMeta.nombres.length && SEG_DEFECTO.every(function (n) { return segMeta.aprobadas.some(function (t) { return t.name === n; }); })) segMeta.nombres = SEG_DEFECTO.slice();
    }
    /* El primer mensaje: la lista de aprobadas, con la guardada elegida. */
    var sel = document.getElementById('pm-nombre');
    var actual = sel.value || segMeta.primero || '';
    sel.innerHTML = opcionesMeta(actual);
    if (!actual && segMeta.aprobadas.length) sel.value = (segMeta.aprobadas.find(function (t) { return t.name === 'solicitud_inicial'; }) || segMeta.aprobadas[0]).name;
    pintarSeguimientosMeta(a.esperasMensajesSegundos || [], false);
  } catch (e) { /* sin plantillas no hay nada que elegir */ }
}
async function guardarRecordatorioMeta() {
  var nombres = leerSegMeta().filter(Boolean);
  var datos = {};
  nombres.forEach(function (n) { if (segMeta.datos[n]) datos[n] = segMeta.datos[n]; });
  var r = await api('/admin/rutas/ajustes', { method: 'POST', body: { plantillasSeguimientos: nombres, datosPlantillas: datos } });
  segMeta.nombres = nombres;
  return r;
}
async function cargarPlantillaMeta() {
  try { pintarPlantillaMeta(await api('/admin/entregas/plantilla-meta')); await cargarRecordatorioMeta(); }
  catch (e) { avisoPlantilla(e.message, true); }
}
async function conBotonPm(boton, texto, fn) {
  var antes = boton.textContent; boton.disabled = true; boton.textContent = texto;
  try { await fn(); } finally { boton.disabled = false; boton.textContent = antes; }
}
document.getElementById('pm-guardar').onclick = function () {
  var boton = this;
  conBotonPm(boton, 'Guardando…', async function () {
    try {
      var d = await api('/admin/entregas/plantilla-meta', { method: 'POST', body: { usar: document.getElementById('pm-usar').checked, nombre: document.getElementById('pm-nombre').value.trim() } });
      await guardarRecordatorioMeta();
      pintarPlantillaMeta(d);
      await cargarRecordatorioMeta();
      avisoPlantilla(!d.usar ? 'Guardado: el primer mensaje no usará la plantilla de Meta.' : d.plantilla && d.plantilla.estado === 'APPROVED' ? 'Guardado: el primer mensaje por WhatsApp API sale con esta plantilla.' : 'Guardado. Falta que Meta la apruebe: cuando esté aprobada, pulsa «Traer el estado desde Meta».');
    } catch (e) { avisoPlantilla(e.message, true); }
  });
};
document.getElementById('pm-traer').onclick = function () {
  var boton = this;
  conBotonPm(boton, 'Preguntando a Meta…', async function () {
    try {
      var d = await api('/admin/entregas/plantilla-meta/traer', { method: 'POST', body: {} });
      pintarPlantillaMeta(d);
      await cargarRecordatorioMeta();
      var t = d.plantilla;
      avisoPlantilla(t ? (t.estado === 'APPROVED' ? 'Listo: Meta la tiene aprobada. Se trajeron ' + d.traidas + ' plantillas.' : 'Meta la tiene como «' + (ESTADO_PLANTILLA[t.estado] || [0, t.estado])[1] + '». Hasta que esté aprobada, no se usa.') : 'Meta no tiene ninguna plantilla llamada «' + d.nombre + '». Revisa que el nombre sea exactamente el de Meta.', !t || t.estado !== 'APPROVED');
    } catch (e) { avisoPlantilla(e.message, true); }
  });
};
cargarPlantillaMeta();

cargarOtrosTextos();

/* Las plantillas de Meta solo salen si el numero las necesita (API oficial). */
async function cargarAjustes() {
  try { pintarAjustes(await api('/admin/rutas/ajustes')); }
  catch (e) { document.getElementById('aj-estado').textContent = e.message; }
}

/* La caja de ajustes y el ancla #ajustes van de la mano: asi el menu marca
   "Ajustes del reparto" mientras esta abierta y vuelve a "Ubicaciones" al cerrarla. */
function sincronizarAjustes(abierta) {
  if (abierta && location.hash !== '#ajustes') history.replaceState(null, '', '#ajustes');
  if (!abierta && location.hash === '#ajustes') history.replaceState(null, '', location.pathname);
  if (window.shellMarcarActivo) shellMarcarActivo();
  if (window.marcarPestanaPedidos) marcarPestanaPedidos();
  /* En la pestaña Ajustes solo se ven los ajustes; lo del envío queda en su pestaña. */
  var envoltura = document.querySelector('.wrap');
  if (envoltura) envoltura.classList.toggle('modo-ajustes', abierta);
  if (window.shellTitulo) {
    shellTitulo(
      'Pedidos GSG',
      abierta ? 'Ajustes de mensajes: solicitud inicial y recordatorios' : 'Solicitud de ubicación a cada cliente del día'
    );
  }
}

async function abrirAjustes() {
  ver('caja-ajustes', true);
  ver('carga', false);
  sincronizarAjustes(true);
  await cargarAjustes();
  if (window.pestanasArriba) pestanasArriba();
}

/* Los ajustes se abren desde la pestaña «Ajustes» (el ancla #ajustes). */
document.getElementById('cerrar-ajustes').onclick = function () { ver('caja-ajustes', false); sincronizarAjustes(false); };

document.getElementById('aj-guardar').onclick = async function () {
  var estado = document.getElementById('aj-estado');
  var boton = this;
  boton.disabled = true;
  try {
    var plantillas = {}, textos = {};
    PASOS_AJ.forEach(function (p) {
      var paso = p[0];
      // La elección de plantilla ya no se expone en esta pantalla; conservar
      // el valor guardado para que editar el texto/tiempos no lo borre.
      plantillas[paso] = (ajustesCache && ajustesCache.ajustes.plantillas[paso]) || [];
      var campo = document.querySelector('textarea[data-textos="' + paso + '"]');
      textos[paso] = campo ? lineasDeTextoMensaje(campo.value) : ajustesCache.ajustes.textos[paso];
    });
    var r = await api('/admin/rutas/ajustes', { method: 'POST', body: {
      pausaMinSegundos: leerDuracion('aj-pausa-min'),
      pausaMaxSegundos: leerDuracion('aj-pausa-max'),
      esperasMensajesSegundos: leerEsperasSecuencia(),
      esperaFinalSegundos: leerDuracion('aj-espera-final'),
      esperaPrimerMensajeSegundos: leerDuracion('aj-espera-primero'),
      horaInicio: Number(document.getElementById('aj-hora-inicio').value),
      horaFin: Number(document.getElementById('aj-hora-fin').value),
      plantillas: plantillas,
      textos: textos,
      textosSeguimientos: leerTextosAdicionales()
    }});
    var v = r.vigente;
    var tandas = leerTandas();
    var avisoTandas = '';
    if (!tandasCargadas) avisoTandas = ' El envío por tandas no se tocó: todavía no se había leído lo guardado.';
    else try {
      await api('/admin/ajustes', { method: 'POST', body: { tandasApi: tandas } });
      avisoTandas = tandas.activo ? ' Envío por tandas (WhatsApp API): ' + tandas.tamano + ' mensajes cada ' + tandas.pausaMin + ' min.' : ' Envío por tandas apagado.';
    } catch (e) { avisoTandas = ' El envío por tandas no se guardó: ' + e.message; }
    document.getElementById('aj-tandas-estado').textContent = avisoTandas.trim();
    ajustesSucios = false;
    actualizarEstadoCambios();
    await cargarAjustes();
    estado.textContent = 'Guardado. «Solicitud de ubicación» sale ' + duracionHumana(v.esperaPrimerMensajeSegundos || 0) + ' después de recibir el pedido de GSG; recordatorios: ' + (v.esperasMensajesSegundos || []).map(duracionHumana).join(', ') + '. Se reprogramaron ' + (r.primerosReprogramados || 0) + ' solicitudes iniciales y ' + (r.seguimientosReprogramados || 0) + ' recordatorios activos. Ritmo entre clientes: ' + duracionHumana(v.pausaMinSegundos) + '-' + duracionHumana(v.pausaMaxSegundos) + '.';
  } catch (e) { estado.textContent = e.message; }
  finally { boton.disabled = false; }
};

document.getElementById('aj-reset').onclick = async function () {
  if (!window.confirm('¿Restablecer los tiempos y textos de seguimiento? Los seguimientos activos se reprogramarán con los valores predeterminados.')) return;
  var boton = this; boton.disabled = true;
  try {
    var r = await api('/admin/rutas/ajustes', { method: 'DELETE' });
    ajustesSucios = false;
    await cargarAjustes();
    actualizarEstadoCambios();
    document.getElementById('aj-estado').textContent = 'Listo: vuelven los valores y textos de siempre. Se actualizaron ' +
      (r.seguimientosReprogramados || 0) + ' seguimientos activos.';
  } catch (e) { document.getElementById('aj-estado').textContent = e.message; }
  finally { boton.disabled = false; }
};

/* --- controles -------------------------------------------------------- */

document.getElementById('lote').onchange = function () {
  loteActual = this.value;
  cerrarDetalle();
  refrescar();
};

document.getElementById('arrancar').onclick = async function () {
  var arrancables = resumen ? resumen.lotes.filter(function (l) { return l.estado !== 'enviando' && l.estado !== 'terminado'; }) : [];
  var lote = loteDe(loteActual) || arrancables[0];
  if (!lote) { toast('Carga una lista primero.'); return; }
  try {
    await api('/admin/rutas/lotes/' + lote.id + '/estado', { method: 'POST', body: { estado: 'enviando' } });
    toast('«' + lote.nombre + '» en marcha: sale un mensaje cada ' + resumen.motor.pausa[0] + '-' + resumen.motor.pausa[1] + ' segundos.');
    await refrescar();
  } catch (error) { toast(error.message); }
};

document.getElementById('pausar').onclick = async function () {
  if (!resumen) { toast('Todavía no se pudo leer el estado del reparto.'); return; }
  var ids = loteActual
    ? [loteActual]
    : resumen.lotes.filter(function (l) { return l.estado === 'enviando'; }).map(function (l) { return l.id; });
  try {
    for (var i = 0; i < ids.length; i++) {
      await api('/admin/rutas/lotes/' + ids[i] + '/estado', { method: 'POST', body: { estado: 'pausado' } });
    }
    toast('Pausado. No sale ningún mensaje más hasta que le des a empezar.');
    await refrescar();
  } catch (error) { toast(error.message); }
};

document.getElementById('csv').onclick = function () {
  if (!loteActual) return;
  descargar('/admin/rutas/lotes/' + loteActual + '.csv', 'ubicaciones.csv');
};

/* La descarga va por fetch para que la cookie de sesion viaje igual que el resto. */
async function descargar(url, nombre) {
  try {
    var res = await fetch(url, { credentials: 'same-origin' });
    if (res.status === 401) { irAlLogin(); return; }
    if (!res.ok) throw new Error('No se pudo descargar el archivo: ' + errorHttp(res.status));
    var blob = await res.blob();
    var enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(blob);
    enlace.download = nombre;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(function () { URL.revokeObjectURL(enlace.href); }, 5000);
  } catch (error) { toast(error.message); }
}

document.getElementById('filtros').addEventListener('click', function (event) {
  var boton = event.target.closest('[data-vista]');
  if (boton) cambiarVista(boton.getAttribute('data-vista'));
});
/* El número grande del progreso también filtra: es la misma pregunta. */
document.getElementById('progreso').addEventListener('click', function (event) {
  var boton = event.target.closest('[data-vista]');
  if (boton) cambiarVista(boton.getAttribute('data-vista'));
});
document.getElementById('lista-vacia').addEventListener('click', function (event) {
  if (event.target.closest('[data-abrir-carga]')) abrirCarga();
});

function cambiarVista(nueva) {
  vista = nueva;
  cargarFiltros();
  cargarLista();
}

/* La lista se abre con el ratón o con el teclado: es una tabla, no un menú. */
document.getElementById('filas').addEventListener('click', function (event) {
  var fila = event.target.closest('tr[data-id]');
  if (fila) abrirDetalleDeFila(fila);
});
document.getElementById('filas').addEventListener('keydown', function (event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  var fila = event.target.closest('tr[data-id]');
  if (!fila) return;
  event.preventDefault();
  abrirDetalleDeFila(fila);
});

function abrirDetalleDeFila(fila) {
  abrirDetalle(Number(fila.getAttribute('data-id')));
  // En el teléfono el detalle queda debajo de la lista: sin esto, al tocar
  // una fila no pasa nada visible.
  if (window.matchMedia('(max-width: 1100px)').matches) {
    document.getElementById('detalle').scrollIntoView({ behavior: 'auto', block: 'start' });
  }
}

document.getElementById('cerrar-detalle').onclick = cerrarDetalle;

var buscando;
document.getElementById('buscar').addEventListener('input', function () {
  clearTimeout(buscando);
  buscando = setTimeout(function () { cargarLista().catch(function (e) { toast(e.message); }); }, 250);
});

/* --- refresco ---------------------------------------------------------- */

async function refrescar() {
  try {
    await cargarResumen();
    await cargarFiltros();
    await cargarLista();
    // El detalle abierto tambien se pone al dia: el historial crece solo
    // mientras se mira. No pisa lo que se este escribiendo.
    if (seleccionada) await abrirDetalle(seleccionada, true);
    marcarFalloRefresco('');
  } catch (error) {
    // Un fallo cada diez segundos no puede ser un aviso flotante cada diez
    // segundos: se dice una vez, en su sitio, hasta que vuelva a funcionar.
    marcarFalloRefresco(error.message);
  }
}

function marcarFalloRefresco(mensaje) {
  var caja = document.getElementById('fallo-refresco');
  if (caja) caja.textContent = mensaje ? 'Sin actualizar: ' + mensaje : '';
}

/* Ni pisa lo que estas escribiendo ni gasta la conexion con la pestana al fondo. */
setInterval(function () {
  if (document.hidden) return;
  if (!document.getElementById('caja-ajustes').classList.contains('hidden')) return;
  var activo = document.activeElement;
  if (activo && (activo.tagName === 'INPUT' || activo.tagName === 'TEXTAREA' || activo.tagName === 'SELECT')) return;
  refrescar();
}, 30000);

/* Llegar con #ajustes (desde el menu) abre la caja; quitar el ancla la cierra. */
function abrirSegunAncla() {
  if (location.hash === '#ajustes') abrirAjustes();
  else { ver('caja-ajustes', false); sincronizarAjustes(false); }
}
window.addEventListener('hashchange', abrirSegunAncla);
abrirSegunAncla();
if (location.hash !== '#ajustes') refrescar();
`;

  return appShell({
    titulo: 'Pedidos GSG',
    subtitulo: 'Solicitud de ubicación a cada cliente del día',
    contenido,
    script: script + PESTANAS_PEDIDOS_JS,
    css: CSS + PESTANAS_PEDIDOS_CSS,
    nombreNegocio: opts.nombreNegocio,
    demo,
    icono: '📍',
  });
}
