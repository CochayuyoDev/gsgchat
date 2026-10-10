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
import { REPARTO_CSS, REPARTO_JS } from './reparto-comun.js';

const CSS = `${REPARTO_CSS}
  * { box-sizing: border-box; }
  .wrap { color: var(--texto); font: var(--fs-cuerpo)/1.5 var(--fuente); }
  .wrap a { color: var(--primario); }

  /* Los dos avisos de arriba (demostración y WhatsApp sin conectar) hablan
     igual: fondo ámbar suave y texto ámbar, que pasa AA en los dos modos. */
  .demo, .aviso {
    background: var(--ambar-suave); color: var(--ambar);
    border: 1px solid var(--ambar-suave); border-radius: var(--radio-sm);
    padding: 10px 14px; margin-bottom: var(--esp-3); font-size: var(--fs-small);
    display: flex; align-items: center; gap: var(--esp-2); flex-wrap: wrap;
  }
  .demo { justify-content: center; text-align: center; }
  .demo a, .aviso a { color: inherit; font-weight: 700; }

  .barra { display: flex; align-items: center; gap: var(--esp-2); flex-wrap: wrap; padding: var(--esp-3); margin-bottom: var(--esp-3); }
  .barra .sep { flex: 1; }
  .barra label { font-size: var(--fs-small); color: var(--texto-suave); }

  .wrap select, .wrap input, .wrap textarea {
    font: inherit; color: var(--texto); background: var(--superficie);
    border: 1px solid var(--borde); border-radius: var(--radio-sm); padding: 8px 11px;
  }
  .wrap textarea { width: 100%; min-height: 150px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; }

  /* Cuánto va y qué está haciendo el motor: la única cifra grande. */
  .progreso { display: flex; align-items: center; gap: var(--esp-3); flex-wrap: wrap; margin-bottom: var(--esp-3); }
  .cifra { border: 0; background: transparent; padding: 0; color: var(--texto-suave); font-size: var(--fs-small); text-align: left; cursor: pointer; }
  .cifra b { color: var(--texto); font-size: 21px; font-weight: 700; }
  .cifra:hover b { color: var(--primario); }
  .progreso-barra { flex: 1; min-width: 180px; height: 8px; border-radius: 999px; background: var(--superficie-2); overflow: hidden; }
  .progreso-barra > span { display: block; height: 100%; background: var(--verde); transition: width .3s; }
  .motor { display: inline-flex; align-items: center; gap: 7px; font-size: var(--fs-small); color: var(--texto-suave); }
  .motor .punto { width: 9px; height: 9px; border-radius: 50%; background: var(--gris-claro); flex: none; }
  .motor.va .punto { background: var(--verde); animation: latido 1.6s ease-in-out infinite; }
  .motor.espera .punto { background: var(--ambar); }
  @keyframes latido { 0%, 100% { opacity: 1 } 50% { opacity: .35 } }
  .fallo { color: var(--rojo); font-size: var(--fs-small); }

  /* Los filtros: preguntas de la operación, no adornos. */
  .filtros { display: flex; gap: var(--esp-2); flex-wrap: wrap; margin-bottom: var(--esp-3); }
  .filtro {
    display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 6px 13px;
    border: 1px solid var(--borde); border-radius: 999px; background: var(--superficie);
    color: var(--texto); font: inherit; font-size: 13.5px; cursor: pointer;
  }
  .filtro:hover { border-color: var(--primario); }
  .filtro .n { font-weight: 700; }
  .filtro[aria-pressed="true"] { border-color: var(--primario); background: var(--primario-suave); color: var(--primario); font-weight: 600; }
  .filtro.urge { border-color: var(--rojo); color: var(--rojo); }
  .filtro.urge[aria-pressed="true"] { background: var(--rojo-suave); border-color: var(--rojo); color: var(--rojo); }

  .cols { display: grid; grid-template-columns: 1fr 380px; gap: var(--esp-3); align-items: start; }
  @media (max-width: 1100px) { .cols { grid-template-columns: 1fr; } }

  /* Las cajas son la .tarjeta del armazón, pero con cabecera propia: el
     relleno lo pone cada zona, no la tarjeta. */
  .panel { padding: 0; overflow: hidden; }
  .panel > h2 {
    font-size: var(--fs-h3); margin: 0; padding: 12px 14px; border-bottom: 1px solid var(--borde);
    display: flex; align-items: center; gap: var(--esp-2);
  }
  .panel > h2 .sep { flex: 1; }
  .panel .cuerpo { padding: var(--esp-4); }
  .panel .vacio { border: 0; background: transparent; }

  table { width: 100%; border-collapse: collapse; font-size: var(--fs-cuerpo); }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--borde); vertical-align: top; }
  th { font-size: var(--fs-small); text-transform: uppercase; letter-spacing: .03em; color: var(--texto-suave); font-weight: 600; position: sticky; top: 0; background: var(--superficie); z-index: 1; }
  tbody tr { cursor: pointer; }
  tbody tr:hover { background: var(--superficie-2); }
  tbody tr.activa { background: var(--primario-suave); box-shadow: inset 3px 0 0 var(--primario); }
  td b { font-weight: 600; }
  td .sub { color: var(--texto-suave); font-size: var(--fs-small); }
  .tabla-scroll { max-height: 62vh; overflow: auto; }

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
  .aj .aj-titulo { font-size: var(--fs-h3); margin: 18px 0 4px; }
  .aj .aj-frase { margin: 0; line-height: 2.1; font-size: var(--fs-cuerpo); }
  .aj .aj-num { width: 64px; padding: 4px 8px; text-align: center; font: inherit; margin: 0 2px; }
  .aj .paso { border: 1px solid var(--borde); border-radius: var(--radio-sm); padding: 12px 14px; margin-top: var(--esp-2); background: var(--superficie-2); }
  .aj .paso h4 { margin: 0 0 6px; font-size: var(--fs-h3); }
  .aj .paso .cuando { color: var(--texto-suave); font-size: var(--fs-small); margin: 0 0 8px; }
  .aj .previa { background: var(--verde-suave); color: var(--texto); border-radius: var(--radio-sm); padding: 9px 12px; font-size: 13.5px; line-height: 1.45; white-space: pre-wrap; max-width: 620px; }
  .aj .previa small { display: block; color: var(--texto-suave); font-size: 11px; margin-top: 4px; text-align: right; }
  .aj .paso textarea { margin-top: 8px; min-height: 64px; }
  .aj .marcadores { font-size: var(--fs-small); color: var(--texto-suave); margin: 6px 0 0; }
  .aj .marcadores code { background: var(--superficie); border: 1px solid var(--borde); border-radius: 5px; padding: 1px 5px; font-size: 12px; cursor: pointer; }
  .aj .plantillas { margin-top: var(--esp-2); font-size: 13px; }
  .aj .plantillas label { display: flex; gap: 6px; align-items: center; margin: 3px 0; }
  .aj .plantillas input { width: auto; }

  /* De pie y con una mano: la tabla deja de ser tabla y cada cliente es una
     ficha que se lee de arriba abajo. */
  @media (max-width: 680px) {
    .panel > h2 { flex-wrap: wrap; }
    .panel > h2 input { max-width: none; flex: 1 1 100%; order: 3; }
    .panel > h2 .btn { order: 4; }
    .tabla-scroll { max-height: none; }
    thead { display: none; }
    tbody tr { display: block; padding: 10px 12px; border-bottom: 1px solid var(--borde); }
    tbody tr.activa { box-shadow: inset 3px 0 0 var(--primario); }
    tbody td { display: block; border: 0; padding: 1px 0; }
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
    ? `<div class="demo">Modo demostración: no se envía nada a ningún cliente.
         Para trabajar de verdad, conecta tu cuenta en <a href="/setup">/setup</a>.</div>`
    : '';

  const aviso = configured
    ? ''
    : `<div class="aviso">Todavía no conectaste tu WhatsApp: puedes cargar la lista y revisarla, pero no saldrá ningún mensaje.
         <a href="/setup">Conectar ahora</a></div>`;

  const contenido = `
<div class="wrap">
  ${bandaDemo}
  ${aviso}

  <div class="tarjeta barra">
    <label for="lote">Lote</label>
    <select id="lote" aria-label="Elegir el lote que se mira"></select>
    <button type="button" class="btn primario sm" id="arrancar">Empezar a pedir</button>
    <button type="button" class="btn sm" id="pausar">Pausar</button>
    <span class="sep"></span>
    <button type="button" class="btn sm" id="abrir-ajustes">Ajustes</button>
    <button type="button" class="btn sm" id="nuevo">Cargar lista nueva</button>
  </div>

  <!-- Ajustes del reparto: horario, espera, intentos, ritmo y qué se dice en cada paso -->
  <div class="tarjeta panel hidden" id="ajustes" style="margin-bottom:var(--esp-3)">
    <h2>Ajustes del reparto <span class="sep"></span>
      <button type="button" class="btn sm" id="cerrar-ajustes">Cerrar</button>
    </h2>
    <div class="cuerpo aj">
      <p class="muted" style="margin-top:0">
        Todo lo de aquí se aplica en el siguiente mensaje, sin reiniciar. Las horas son de Lima.
        Por encima de esto manda siempre la salud del número: si el monitor frena, frena.
      </p>

      <h3 class="aj-titulo">¿A qué horas se escribe?</h3>
      <p class="aj-frase">Solo de las <input id="aj-hora-inicio" type="number" min="0" max="23" class="aj-num" aria-label="Hora de inicio">:00 a las <input id="aj-hora-fin" type="number" min="1" max="24" class="aj-num" aria-label="Hora de fin">:00.
        Fuera de ese horario, los mensajes esperan al día siguiente.</p>

      <h3 class="aj-titulo">¿Cómo se insiste si no contesta?</h3>
      <p class="aj-frase">Si el cliente no responde, se le vuelve a escribir a los <input id="aj-espera" type="number" min="1" class="aj-num" aria-label="Minutos de espera">
        minutos. Como máximo <input id="aj-intentos" type="number" min="1" max="10" class="aj-num" aria-label="Mensajes como máximo"> mensajes por cliente;
        si sigue sin mandar su ubicación, pasa al repartidor para que lo llame.</p>

      <h3 class="aj-titulo">¿A qué ritmo?</h3>
      <p class="aj-frase">Entre un cliente y el siguiente se espera entre <input id="aj-pausa-min" type="number" min="1" class="aj-num" aria-label="Pausa mínima en segundos">
        y <input id="aj-pausa-max" type="number" min="1" class="aj-num" aria-label="Pausa máxima en segundos"> segundos, para parecer una persona y cuidar el número.</p>

      <h3 class="aj-titulo">¿Qué se le dice?</h3>
      <p class="muted" style="margin-top:0">Tres momentos: el primer mensaje, el recordatorio si no contestó, y la insistencia si contestó pero sin ubicación.
        Debajo de cada uno ves cómo le llegaría a un cliente de ejemplo. Si no escribes nada, se usan los textos de siempre.</p>
      <div id="aj-pasos"></div>

      <div class="fila" style="margin-top:var(--esp-4)">
        <button type="button" class="btn primario fijo" id="aj-guardar">Guardar</button>
        <button type="button" class="btn fijo" id="aj-reset">Volver a lo de siempre</button>
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

  <div class="progreso" id="progreso" role="status"></div>
  <div class="filtros" id="filtros"></div>

  <div class="cols">
    <div class="tarjeta panel">
      <h2>
        <span id="titulo-lista">Clientes</span>
        <span class="sep"></span>
        <input id="buscar" placeholder="Buscar cliente o pedido" aria-label="Buscar cliente o pedido" style="max-width:230px">
        <button type="button" class="btn sm" id="csv">Descargar CSV</button>
      </h2>
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
        <div class="cuerpo" id="gsg">
          <p class="muted" style="margin:0">Cargando…</p>
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
var ajustesCache = null;
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

function chipEstado(estado) {
  var e = ESTADOS[estado] || { texto: String(estado || '').replace(/_/g, ' '), tono: 'gris' };
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
  var porcentaje = total ? Math.round((hechos / total) * 100) : 0;

  document.getElementById('progreso').innerHTML =
    '<button type="button" class="cifra" data-vista="resueltos" title="Ver a quiénes ya les llegó la ubicación">' +
      '<b>' + hechos + '</b> de ' + total + ' con ubicación</button>' +
    '<span class="progreso-barra"><span style="width:' + porcentaje + '%"></span></span>' +
    estadoDelMotor(datos.motor) +
    (datos.alertas.coordinador ? '' : '<span class="muted">Nadie recibe avisos por WhatsApp de los casos parados.</span>') +
    '<span class="fallo" id="fallo-refresco"></span>';
}

/* Una sola frase que explica por qué salen o no salen mensajes ahora mismo. */
function estadoDelMotor(m) {
  var salud = m.salud;
  var clase = 'parado';
  var frase = 'En pausa: ningún lote en marcha';
  if (m.trabajando && salud && salud.factor <= 0) {
    // El monitor de salud manda sobre el motor: parado es parado, y hay que decir por qué.
    clase = 'espera';
    frase = 'Parado por la salud del número (' + salud.nivel + ')' +
      (salud.pausadaHasta ? ', vuelve a las ' + hora(salud.pausadaHasta) : '') +
      (salud.motivos && salud.motivos.length ? ': ' + salud.motivos[0] : '');
  } else if (m.trabajando && !m.enHorario) {
    clase = 'espera';
    frase = 'Esperando al horario de envío (' + m.horario[0] + ':00 a ' + m.horario[1] + ':00)';
  } else if (m.trabajando) {
    var factor = salud ? salud.factor : 1;
    clase = 'va';
    frase = 'Enviando, uno cada ' + Math.round(m.pausa[0] / factor) + '-' + Math.round(m.pausa[1] / factor) + ' segundos' +
      (factor < 1 ? ' (salud en ' + salud.nivel + ': al ' + Math.round(factor * 100) + ' %)' : '');
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
    '<p style="margin:0 0 8px">' +
      (gsg.conectado ? '<span class="chip tono-verde">conectado</span>' : '<span class="chip tono-ambar">sin conectar</span>') +
      ' <span class="muted">' + esc(gsg.descripcion) + '</span></p>' +
    '<p class="muted" style="margin:0 0 10px;font-size:13px">' +
      'Cada ubicación conseguida y cada incidencia se guarda lista para GSG. ' +
      (gsg.conectado
        ? 'Se envían solas cada minuto, con un resumen del lote cada ' + datos.alertas.resumenCadaMin + ' min.'
        : 'Mientras no exista la API se acumulan aquí, y saldrán todas el día que se conecte.') +
    '</p>' +
    '<div class="fila">' +
      '<div><b>' + (gsg.cola.pendiente || 0) + '</b><div class="muted" style="font-size:12.5px">en cola</div></div>' +
      '<div><b>' + (gsg.cola.enviado || 0) + '</b><div class="muted" style="font-size:12.5px">enviados</div></div>' +
      '<div><b>' + (gsg.cola.fallido || 0) + '</b><div class="muted" style="font-size:12.5px">fallidos</div></div>' +
    '</div>' +
    '<div class="fila" style="margin-top:10px">' +
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
  var data = await api('/admin/rutas/vistas' + (loteActual ? '?loteId=' + encodeURIComponent(loteActual) : ''));
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
}

async function cargarLista() {
  var params = ['vista=' + encodeURIComponent(vista), 'limit=300'];
  if (loteActual) params.push('loteId=' + encodeURIComponent(loteActual));
  var q = document.getElementById('buscar').value.trim();
  if (q) params.push('q=' + encodeURIComponent(q));

  var data = await api('/admin/rutas/solicitudes?' + params.join('&'));
  document.getElementById('titulo-lista').textContent =
    (nombresVista[vista] || 'Clientes') + ' (' + data.total + ')';

  var maxIntentos = resumen ? resumen.motor.maxIntentos : 0;
  document.getElementById('filas').innerHTML = data.items.map(function (s) {
    return '<tr data-id="' + s.id + '" tabindex="0"' + (seleccionada === s.id ? ' class="activa"' : '') + '>' +
      '<td><b>' + esc(s.nombre || 'Sin nombre') + '</b>' +
        '<div class="sub">' + esc(s.phone || s.telefonoCrudo) + '</div></td>' +
      '<td>' + esc(s.referencia || '') +
        (s.distrito ? '<div class="sub">' + esc(s.distrito) + '</div>' : '') + '</td>' +
      '<td>' + chipEstado(s.estado) +
        (s.requiereHumano ? ' <span class="chip tono-rojo">persona</span>' : '') + '</td>' +
      '<td>' + esc(queLePasa(s)) +
        (intentosDe(s, maxIntentos) ? '<div class="sub">' + esc(intentosDe(s, maxIntentos)) + '</div>' : '') + '</td>' +
    '</tr>';
  }).join('');

  pintarListaVacia(data.items.length, q);
}

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
    caja.innerHTML = '<div class="vacio"><div class="ico">📍</div><h3>Todavía no hay ninguna lista</h3>' +
      '<p>Pega la lista del día (o trae a los clientes que nunca mandaron su ubicación) y el sistema les pedirá el pin uno a uno.</p>' +
      '<div class="acciones"><button type="button" class="btn primario" data-abrir-carga="1">Cargar la lista del día</button></div></div>';
    return;
  }
  if (vista === 'todos') {
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
  return 'intento ' + s.intentos + (maxIntentos ? ' de ' + maxIntentos : '') +
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
      document.getElementById('detalle-info').innerHTML = '<p class="muted" style="margin:0">Cargando…</p>';
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
    '<p style="margin:0 0 4px"><b>' + esc(s.nombre || 'Sin nombre') + '</b> ' + chipEstado(s.estado) + '</p>' +
    '<p class="muted" style="margin:0 0 12px;font-size:13px">' +
      esc(s.phone || s.telefonoCrudo) +
      (s.referencia ? ' · pedido ' + esc(s.referencia) : '') +
      (s.direccion ? '<br>' + esc(s.direccion) : '') +
      (s.distrito ? ' (' + esc(s.distrito) + ')' : '') +
    '</p>' +
    mapa +
    explicacion;

  var zonaInfo = document.getElementById('detalle-info');
  if (zonaInfo.innerHTML !== info) zonaInfo.innerHTML = info;

  var bitacora = (data.eventos || []).slice().reverse().map(function (e) {
    return '<li><span class="cuando">' + esc(cuando(e.createdAt)) + '</span> · ' + esc(e.detalle || e.tipo) + '</li>';
  }).join('') || '<li class="muted">Todavía no hay movimientos.</li>';
  var historial =
    '<h3 style="font-size:13px;margin:14px 0 6px">Historial</h3>' +
    '<ul class="bitacora">' + bitacora + '</ul>';
  var zonaHistorial = document.getElementById('detalle-historial');
  if (zonaHistorial.innerHTML !== historial) zonaHistorial.innerHTML = historial;

  // Las acciones solo se reconstruyen al cambiar de cliente: son campos que
  // el operador puede estar escribiendo ahora mismo.
  if (detalleId === s.id) return;
  detalleId = s.id;

  var sinTelefono = !s.phone;
  var puede = accionesDeEstado(s.estado);
  var enlaceChat = '<a class="fijo" href="/chat?phone=' + encodeURIComponent(s.phone || s.telefonoCrudo) + '">Abrir el chat</a>';

  // Quitada de la automatizacion: nada que pueda volver a escribirle. Solo
  // se dice que esta fuera y se deja abrir el chat.
  if (puede.cancelada) {
    document.getElementById('detalle-acciones').innerHTML =
      '<div class="aviso" style="margin:12px 0 8px"><div><b>Quitada de esta automatización</b><br>' +
        'No se le volverá a escribir por esta solicitud. El chat, el contacto y el historial se conservan.</div></div>' +
      '<div class="fila" style="margin:0 0 4px">' + enlaceChat + '</div>';
    return;
  }

  document.getElementById('detalle-acciones').innerHTML =
    '<div class="campo"><label for="d-telefono">Corregir el teléfono</label>' +
      '<div class="fila"><input id="d-telefono" value="' + esc(s.telefonoCrudo) + '">' +
      '<button type="button" class="btn sm fijo" id="d-guardar-tel">Guardar y reintentar</button></div></div>' +
    '<div class="campo"><label for="d-ubicacion">Cargar la ubicación a mano (enlace de mapa o «lat, lng»)</label>' +
      '<div class="fila"><input id="d-ubicacion" placeholder="https://maps.app.goo.gl/… o -12.09, -77.03">' +
      '<button type="button" class="btn sm fijo" id="d-guardar-ubi">Guardar</button></div></div>' +
    '<div class="fila" style="margin:12px 0 4px">' +
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
      ? '<div class="fila" style="margin:4px 0 4px"><button type="button" class="btn sm fijo" id="d-quitar">Quitar de esta automatización</button></div>'
      : '');

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
  ver('ajustes', false);
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
  ['solicitud', '1. Primer mensaje', 'Cuando se le pide la ubicación por primera vez.'],
  ['recordatorio', '2. Recordatorio', 'Si pasan los minutos de espera y no contestó nada.'],
  ['insistencia', '3. Insistencia', 'Si contestó, pero sin mandar la ubicación.']
];
var ESTADO_PLANTILLA = { APPROVED: 'aprobada', PENDING: 'pendiente de Meta', REJECTED: 'rechazada', PAUSED: 'pausada', DISABLED: 'deshabilitada' };

/* Como le quedaria al cliente de ejemplo un texto escrito aqui. */
function previaDe(texto, ej) {
  return texto.replace(/\{nombre\}/g, ej.nombre.split(' ')[0]).replace(/\{pedido\}/g, ej.pedido).replace(/\{negocio\}/g, ej.negocio)
    .replace(/\{direccion\}/g, ej.direccion).replace(/\{distrito\}/g, ej.distrito).replace(/\{como\}/g, ej.como);
}

function pintarPrevia(paso) {
  var d = ajustesCache;
  if (!d) return;
  var ta = document.querySelector('textarea[data-textos="' + paso + '"]');
  var lineas = ta ? ta.value.split('\n').map(function (l) { return l.trim(); }).filter(Boolean) : [];
  var texto = lineas.length ? previaDe(lineas[0], d.ejemplo) : d.textosDeSiempre[paso];
  var caja = document.getElementById('aj-previa-' + paso);
  if (!caja) return;
  var pie = lineas.length > 1 ? 'tu primer texto (se alternan ' + lineas.length + ')' : lineas.length ? 'tu texto' : 'texto de siempre';
  caja.innerHTML = esc(texto) + '<small>' + pie + ' · para ' + esc(d.ejemplo.nombre) + ', pedido ' + esc(d.ejemplo.pedido) + '</small>';
}

function pintarAjustes(d) {
  ajustesCache = d;
  var a = d.ajustes;
  document.getElementById('aj-pausa-min').value = a.pausaMinSegundos;
  document.getElementById('aj-pausa-max').value = a.pausaMaxSegundos;
  document.getElementById('aj-espera').value = a.esperaRespuestaMinutos;
  document.getElementById('aj-intentos').value = a.maxIntentos;
  document.getElementById('aj-hora-inicio').value = a.horaInicio;
  document.getElementById('aj-hora-fin').value = a.horaFin;

  document.getElementById('aj-pasos').innerHTML = PASOS_AJ.map(function (p) {
    var paso = p[0];
    return '<div class="paso"><h4>' + esc(p[1]) + '</h4><p class="cuando">' + esc(p[2]) + '</p>' +
      '<div class="previa" id="aj-previa-' + paso + '"></div>' +
      '<textarea data-textos="' + paso + '" rows="3" aria-label="Texto de ' + esc(p[1]) + '" placeholder="Escribe aquí si quieres decirlo a tu manera. Una redacción por línea: se van alternando.">' + esc((a.textos[paso] || []).join('\n')) + '</textarea>' +
      '<p class="marcadores">Puedes usar: ' + marcadoresHtml() + ' — clic para insertar.</p>' +
      plantillasHtml(d, paso) + '</div>';
  }).join('');

  PASOS_AJ.forEach(function (p) {
    var paso = p[0];
    pintarPrevia(paso);
    document.querySelector('textarea[data-textos="' + paso + '"]')
      .addEventListener('input', function () { pintarPrevia(paso); });
  });
  document.querySelectorAll('#aj-pasos [data-marcador]').forEach(function (c) {
    c.onclick = function () {
      var ta = c.closest('.paso').querySelector('textarea');
      var ini = ta.selectionStart || ta.value.length, fin = ta.selectionEnd || ini;
      ta.value = ta.value.slice(0, ini) + c.getAttribute('data-marcador') + ta.value.slice(fin);
      ta.focus();
      ta.dispatchEvent(new Event('input'));
    };
  });
}

var MARCADORES = [
  ['{nombre}', 'El nombre del cliente'],
  ['{pedido}', 'El número de pedido o guía'],
  ['{negocio}', 'El nombre de tu negocio'],
  ['{direccion}', 'La dirección del pedido'],
  ['{distrito}', 'El distrito'],
  ['{como}', 'Cómo mandar la ubicación: con el botón o desde el clip, según toque']
];
function marcadoresHtml() {
  return MARCADORES.map(function (m) {
    return '<code data-marcador="' + m[0] + '" title="' + esc(m[1]) + '">' + m[0] + '</code>';
  }).join(' ');
}

/* Las plantillas de Meta solo salen si el numero las necesita (API oficial). */
function plantillasHtml(d, paso) {
  if (!d.usaPlantillas) return '';
  var elegidas = d.ajustes.plantillas[paso] || [];
  var delPaso = d.catalogo[paso] || [];
  var porNombre = {};
  d.plantillas.forEach(function (t) { if (!porNombre[t.name]) porNombre[t.name] = t; });
  var opciones = Object.keys(porNombre).sort().map(function (n) {
    var t = porNombre[n];
    var marcada = elegidas.length ? elegidas.indexOf(t.name) >= 0 : delPaso.indexOf(t.name) >= 0;
    return '<label><input type="checkbox" data-paso="' + paso + '" value="' + esc(t.name) + '"' + (marcada ? ' checked' : '') + '> ' +
      esc(t.name) + ' <span class="muted">(' + esc(ESTADO_PLANTILLA[t.status] || t.status) + (t.propia ? ', propia' : '') + ')</span></label>';
  }).join('');
  return '<div class="plantillas"><b>Plantillas de Meta para este paso</b> ' +
    '<span class="muted">(fuera de las 24 h solo puede salir una plantilla aprobada; si marcas varias, se van alternando)</span>' + opciones + '</div>';
}

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
  if (window.shellTitulo) {
    shellTitulo(
      abierta ? 'Ajustes del reparto' : 'Ubicaciones para reparto',
      abierta ? 'Horario, espera, intentos, textos y plantillas' : 'Pedir la ubicación a cada cliente del día'
    );
  }
}

async function abrirAjustes() {
  ver('ajustes', true);
  ver('carga', false);
  sincronizarAjustes(true);
  await cargarAjustes();
}

document.getElementById('abrir-ajustes').onclick = abrirAjustes;
document.getElementById('cerrar-ajustes').onclick = function () { ver('ajustes', false); sincronizarAjustes(false); };

document.getElementById('aj-guardar').onclick = async function () {
  var estado = document.getElementById('aj-estado');
  try {
    var plantillas = {}, textos = {};
    PASOS_AJ.forEach(function (p) {
      var paso = p[0];
      var marcadas = Array.prototype.slice.call(document.querySelectorAll('input[data-paso="' + paso + '"]:checked')).map(function (i) { return i.value; });
      // Si lo marcado es exactamente el catalogo, se guarda vacio: "las de siempre".
      var delPaso = (ajustesCache && ajustesCache.catalogo[paso]) || [];
      var esCatalogo = marcadas.length === delPaso.length && marcadas.every(function (n) { return delPaso.indexOf(n) >= 0; });
      plantillas[paso] = esCatalogo ? [] : marcadas;
      textos[paso] = document.querySelector('textarea[data-textos="' + paso + '"]').value.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    });
    var r = await api('/admin/rutas/ajustes', { method: 'POST', body: {
      pausaMinSegundos: Number(document.getElementById('aj-pausa-min').value),
      pausaMaxSegundos: Number(document.getElementById('aj-pausa-max').value),
      esperaRespuestaMinutos: Number(document.getElementById('aj-espera').value),
      maxIntentos: Number(document.getElementById('aj-intentos').value),
      horaInicio: Number(document.getElementById('aj-hora-inicio').value),
      horaFin: Number(document.getElementById('aj-hora-fin').value),
      plantillas: plantillas,
      textos: textos
    }});
    var v = r.vigente;
    estado.textContent = 'Guardado: de ' + v.horaInicio + ':00 a ' + v.horaFin + ':00, se insiste a los ' +
      v.esperaRespuestaMinutos + ' min, máximo ' + v.maxIntentos + ' mensajes, ' +
      v.pausaMinSegundos + '-' + v.pausaMaxSegundos + ' s entre clientes. Se aplica en el siguiente mensaje.';
    await refrescar();
  } catch (e) { estado.textContent = e.message; }
};

document.getElementById('aj-reset').onclick = async function () {
  try {
    await api('/admin/rutas/ajustes', { method: 'DELETE' });
    await cargarAjustes();
    document.getElementById('aj-estado').textContent = 'Listo: vuelven los valores y textos de siempre.';
    await refrescar();
  } catch (e) { document.getElementById('aj-estado').textContent = e.message; }
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
    document.getElementById('detalle').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  var activo = document.activeElement;
  if (activo && (activo.tagName === 'INPUT' || activo.tagName === 'TEXTAREA' || activo.tagName === 'SELECT')) return;
  refrescar();
}, 10000);

/* Llegar con #ajustes (desde el menu) abre la caja; quitar el ancla la cierra. */
function abrirSegunAncla() {
  if (location.hash === '#ajustes') abrirAjustes();
  else { ver('ajustes', false); sincronizarAjustes(false); }
}
window.addEventListener('hashchange', abrirSegunAncla);
abrirSegunAncla();
refrescar();
`;

  return appShell({
    titulo: 'Automatización GSG',
    subtitulo: 'Pedir la ubicación a cada cliente del día',
    contenido,
    script,
    css: CSS,
    nombreNegocio: opts.nombreNegocio,
    demo,
    icono: '📍',
  });
}
