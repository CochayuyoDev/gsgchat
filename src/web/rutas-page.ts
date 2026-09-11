/**
 * Pantalla de ubicaciones para reparto.
 *
 * Es la pantalla de quien coordina el reparto por la manana: pega la lista
 * del dia, le da a empezar y mira dos cosas -cuantas ubicaciones van y que
 * casos necesitan a una persona-. Todo lo demas esta detras de esas dos.
 *
 * Decisiones de la pantalla, por si alguien las cambia sin saber por que:
 *
 *  - Las tarjetas de arriba son filtros, no adornos. Cada una responde una
 *    pregunta de la operacion ("¿a quien no le llego el mensaje?") y al
 *    pulsarla la tabla se queda solo con eso.
 *  - No hay confirm() ni alert(): un dialogo del navegador congela la pagina
 *    entera, y esta se refresca sola cada diez segundos.
 *  - El detalle se abre al lado, no encima: quien corrige un telefono
 *    necesita seguir viendo la lista.
 *
 * El JS va en String.raw y con var, como el resto de paginas.
 */

import { seedTokenJs } from './pages.js';
import { DIALOGO_CSS, DIALOGO_JS } from './dialogo.js';

const CSS = `
  :root {
    color-scheme: light dark;
    --bg: #f0f2f5; --panel: #fff; --line: #e3e5e9; --text: #111b21;
    --muted: #667781; --accent: #128c7e; --ok: #128c7e; --warn: #d97706;
    --bad: #dc2626; --info: #2563eb; --chip: #f6f7f9;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0b141a; --panel: #111b21; --line: #222d34; --text: #e9edef;
      --muted: #8696a0; --chip: #1c262c;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  }
  a { color: var(--accent); }
  header {
    background: var(--panel); border-bottom: 1px solid var(--line);
    padding: 12px 20px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    position: sticky; top: 0; z-index: 5;
  }
  header h1 { font-size: 18px; margin: 0; flex: 1; }
  header .link { font-size: 13.5px; text-decoration: none; }
  .wrap { padding: 18px 20px 60px; max-width: 1500px; margin: 0 auto; }
  .demo {
    background: #d97706; color: #fff; padding: 9px 14px; font-size: 13.5px;
    text-align: center; line-height: 1.35;
  }
  .demo a { color: #fff; text-decoration: underline; }

  .aviso {
    background: rgba(217,119,6,.12); border: 1px solid rgba(217,119,6,.35);
    border-radius: 10px; padding: 12px 14px; margin-bottom: 14px; font-size: 14px;
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  }
  .aviso b { color: var(--warn); }
  .aviso button { margin-left: auto; }

  .barra {
    background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
    padding: 12px 14px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    margin-bottom: 14px;
  }
  .barra .sep { flex: 1; }
  .barra .dato { font-size: 12.5px; color: var(--muted); }

  select, input, textarea, button {
    font: inherit; color: var(--text); background: var(--panel);
    border: 1px solid var(--line); border-radius: 8px; padding: 8px 11px;
  }
  textarea { width: 100%; min-height: 150px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; }
  button { cursor: pointer; }
  button:hover { border-color: var(--accent); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  button.primary:hover { filter: brightness(1.08); }
  button.sm { padding: 5px 9px; font-size: 13px; }
  button:disabled { opacity: .55; cursor: default; }

  /* Progreso del lote: cuánto queda, de un vistazo. */
  .progreso { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
  /* OJO: nombre propio y no ".barra" a secas, que ya es la fila de controles
     de arriba. Reutilizar ese nombre le ponia 10px de alto y la partia. */
  .progreso-barra {
    flex: 1; min-width: 200px; height: 10px; border-radius: 999px;
    background: var(--chip); overflow: hidden;
  }
  .progreso-barra > span { display: block; height: 100%; background: var(--ok); transition: width .3s; }
  .progreso .cifra { font-size: 13.5px; color: var(--muted); }
  .progreso .cifra b { color: var(--text); font-size: 15px; }
  /* El estado del motor, con su punto de color. */
  .motor { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; }
  .motor .punto { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); flex: none; }
  .motor.va .punto { background: var(--ok); animation: latido 1.6s ease-in-out infinite; }
  .motor.espera .punto { background: var(--warn); }
  .motor.parado .punto { background: var(--muted); }
  @keyframes latido { 0%, 100% { opacity: 1 } 50% { opacity: .35 } }

  .tarjetas { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
  .tarjeta {
    background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
    padding: 10px 14px; min-width: 132px; cursor: pointer; text-align: left;
  }
  .tarjeta:hover { border-color: var(--accent); }
  .tarjeta.activa { border-color: var(--accent); box-shadow: inset 0 -3px 0 var(--accent); }
  .tarjeta .n { font-size: 22px; font-weight: 700; line-height: 1.1; }
  .tarjeta .q { font-size: 12.5px; color: var(--muted); margin-top: 2px; }
  .tarjeta.ok .n { color: var(--ok); }
  .tarjeta.warn .n { color: var(--warn); }
  .tarjeta.bad .n { color: var(--bad); }

  .cols { display: grid; grid-template-columns: 1fr 380px; gap: 14px; align-items: start; }
  @media (max-width: 1100px) { .cols { grid-template-columns: 1fr; } }

  .caja { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  .caja > h2 {
    font-size: 14.5px; margin: 0; padding: 12px 14px; border-bottom: 1px solid var(--line);
    display: flex; align-items: center; gap: 8px;
  }
  .caja > h2 .sep { flex: 1; }
  .caja .cuerpo { padding: 14px; }

  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: .03em; color: var(--muted); font-weight: 600; }
  tbody tr { cursor: pointer; }
  tbody tr:hover { background: var(--chip); }
  tbody tr.activa { background: var(--chip); box-shadow: inset 3px 0 0 var(--accent); }
  td .sub { color: var(--muted); font-size: 12.5px; }
  .tabla-scroll { max-height: 62vh; overflow: auto; }

  .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 600; white-space: nowrap; }
  .pill.ok { background: rgba(18,140,126,.16); color: var(--ok); }
  .pill.warn { background: rgba(217,119,6,.16); color: var(--warn); }
  .pill.bad { background: rgba(220,38,38,.14); color: var(--bad); }
  .pill.info { background: rgba(37,99,235,.14); color: var(--info); }
  .pill.gris { background: var(--chip); color: var(--muted); }

  .campo { margin-bottom: 10px; }
  .campo label { display: block; font-size: 12.5px; color: var(--muted); margin-bottom: 4px; }
  .campo input { width: 100%; }
  .fila { display: flex; gap: 8px; flex-wrap: wrap; }
  .fila > * { flex: 1; min-width: 120px; }

  .bitacora { list-style: none; margin: 0; padding: 0; font-size: 13px; }
  .bitacora li { padding: 7px 0; border-bottom: 1px dashed var(--line); }
  .bitacora .cuando { color: var(--muted); font-size: 11.5px; }

  .muted { color: var(--muted); }
  .hidden { display: none !important; }
  .vacio { padding: 30px 14px; text-align: center; color: var(--muted); font-size: 14px; }
  .toast {
    position: fixed; left: 50%; transform: translateX(-50%); bottom: 24px; z-index: 60;
    background: #111b21; color: #fff; padding: 10px 16px; border-radius: 10px;
    font-size: 14px; max-width: 90vw; box-shadow: 0 6px 24px rgba(0,0,0,.3);
  }
  /* En el telefono, la cabecera de la tabla se apila en vez de apretarse:
     el buscador y el boton de CSV quedaban cortados por la derecha. */
  @media (max-width: 680px) {
    .wrap { padding: 14px 12px 40px; }
    .caja > h2 { flex-wrap: wrap; }
    .caja > h2 input { max-width: none; flex: 1 1 100%; order: 3; }
    .caja > h2 button { order: 4; }
    .tarjeta { flex: 1 1 calc(50% - 10px); min-width: 0; }
    .barra { gap: 8px; }
  }

  .resumen-carga { font-size: 13.5px; }
  .resumen-carga b { font-size: 16px; }
  .resumen-carga .linea { padding: 4px 0; border-bottom: 1px dashed var(--line); }
${DIALOGO_CSS}
`;

export function rutasPage(configured: boolean, adminToken = '', demo = false): string {
  /** Ver el mismo aviso en `chat-page.ts`: aqui no sale ningun mensaje. */
  const bandaDemo = demo
    ? `<div class="demo">Modo demostración: no se envía nada a ningún cliente.
         Para trabajar de verdad, conecta tu cuenta en <a href="/setup">/setup</a>.</div>`
    : '';

  const aviso = configured
    ? ''
    : `<div class="aviso">Todavía no conectaste tu WhatsApp: puedes cargar la lista y revisarla, pero no saldrá ningún mensaje.
         <a class="link" href="/setup">Conectar ahora</a></div>`;

  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ubicaciones - wa-locator</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><text y='13' font-size='13'>📍</text></svg>">
<style>${CSS}</style>
</head><body>

${bandaDemo}
<header>
  <h1>Ubicaciones para reparto</h1>
  <a class="link" href="/chat">Chat</a>
  <a class="link" href="/panel">Panel</a>
</header>

<div class="wrap">
  ${aviso}
  <div id="alerta" class="aviso hidden"></div>

  <div class="barra">
    <label for="lote" class="dato">Lote</label>
    <select id="lote"></select>
    <button class="primary sm" id="arrancar">Empezar a pedir</button>
    <button class="sm" id="pausar">Pausar</button>
    <span class="sep"></span>
    <span class="dato" id="ritmo"></span>
    <button class="sm" id="nuevo">Cargar lista nueva</button>
  </div>

  <!-- Cargar un lote: se abre aqui mismo, sin dialogos que bloqueen -->
  <div class="caja hidden" id="carga" style="margin-bottom:14px">
    <h2>Cargar la lista del día <span class="sep"></span>
      <button class="sm" id="cerrar-carga">Cerrar</button>
    </h2>
    <div class="cuerpo">
      <p class="muted" style="margin-top:0">
        Pega la tabla tal como la tengas (Excel, CSV o una lista de números). Se entienden las
        columnas <b>teléfono</b>, <b>nombre</b>, <b>pedido</b>, <b>dirección</b> y <b>distrito</b>,
        en cualquier orden. Antes de crear nada se te dice qué entendió.
      </p>
      <div class="campo">
        <label for="nombre-lote">Nombre del lote</label>
        <input id="nombre-lote" placeholder="Reparto del martes">
      </div>
      <textarea id="pegado" placeholder="teléfono;nombre;pedido&#10;987654321;Ana Ruiz;P-1024&#10;912345678;Luis Paz;P-1025"></textarea>
      <div class="fila" style="margin-top:10px">
        <button id="revisar">Revisar la lista</button>
        <button class="primary" id="crear" disabled>Crear el lote</button>
        <label class="dato" style="display:flex;align-items:center;gap:6px;flex:none">
          <input type="checkbox" id="arrancar-ya" checked style="width:auto"> empezar a pedir en cuanto se cree
        </label>
      </div>
      <div id="resumen-carga" class="resumen-carga" style="margin-top:12px"></div>
    </div>
  </div>

  <div class="progreso" id="progreso"></div>
  <div class="tarjetas" id="tarjetas"></div>

  <div class="cols">
    <div class="caja">
      <h2>
        <span id="titulo-lista">Clientes</span>
        <span class="sep"></span>
        <input id="buscar" placeholder="Buscar cliente o pedido" style="max-width:230px">
        <button class="sm" id="csv">Descargar CSV</button>
      </h2>
      <div class="tabla-scroll">
        <table>
          <thead><tr>
            <th>Cliente</th><th>Pedido</th><th>Estado</th><th>Intentos</th><th>Qué pasa</th>
          </tr></thead>
          <tbody id="filas"></tbody>
        </table>
      </div>
      <div class="vacio hidden" id="lista-vacia"></div>
    </div>

    <div>
      <div class="caja" id="detalle">
        <h2>Detalle <span class="sep"></span><button class="sm hidden" id="cerrar-detalle">Cerrar</button></h2>
        <div class="cuerpo" id="detalle-cuerpo">
          <!-- Dos zonas a proposito: 'info' se repinta con cada refresco y
               'acciones' NO se toca mientras siga abierto el mismo cliente.
               Reconstruir un <input> mientras alguien escribe en el es la
               forma mas facil de borrarle lo que estaba corrigiendo. -->
          <div id="detalle-info">
            <p class="muted" style="margin:0">Elige un cliente de la lista para ver su historial y arreglar lo que haga falta.</p>
          </div>
          <div id="detalle-acciones"></div>
          <div id="detalle-historial"></div>
        </div>
      </div>

      <div class="caja" style="margin-top:14px">
        <h2>Enviar a GSG</h2>
        <div class="cuerpo" id="gsg">
          <p class="muted" style="margin:0">Cargando...</p>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
${seedTokenJs(adminToken)}${DIALOGO_JS}${String.raw`
/* La clave se pide con el cuadro propio; ver dialogo.ts. */
function token() {
  return sessionStorage.getItem('adminToken') || '';
}
async function api(path, options) {
  options = options || {};
  var clave = await pedirToken();
  var res = await fetch(path, {
    method: options.method || 'GET',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + clave },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  var data = await res.json().catch(function () { return {}; });
  if (res.status === 401) {
    sessionStorage.removeItem('adminToken');
    throw new Error('La clave de administracion no es correcta: vuelve a escribirla.');
  }
  if (!res.ok) throw new Error(data.error || errorHttp(res.status));
  return data;
}
function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function ver(id, visible) {
  var el = document.getElementById(id);
  if (el) el.classList.toggle('hidden', !visible);
}
function toast(texto) {
  var el = document.createElement('div');
  el.className = 'toast';
  el.textContent = texto;
  document.body.appendChild(el);
  setTimeout(function () { el.remove(); }, 4500);
}
function cuando(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  var hoy = new Date();
  var mismaFecha = d.toDateString() === hoy.toDateString();
  var hora = d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  return mismaFecha ? hora : d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit' }) + ' ' + hora;
}

/* --- estado de la pantalla ------------------------------------------- */
var resumen = null;      /* lo que devuelve /admin/rutas */
var loteActual = '';
var vista = 'todos';
var seleccionada = null; /* id de la solicitud abierta en el detalle */
var catalogo = {};       /* incidencias: codigo -> ficha */
var nombresVista = {};

/* Las tarjetas, en el orden en que se miran por la manana. */
var TARJETAS = [
  { vista: 'resueltos', clase: 'ok' },
  { vista: 'esperando', clase: '' },
  { vista: 'respondieron', clase: 'warn' },
  { vista: 'pendientes', clase: '' },
  { vista: 'sin_whatsapp', clase: 'bad' },
  { vista: 'numero_malo', clase: 'bad' },
  { vista: 'derivados', clase: 'warn' },
  { vista: 'todos', clase: '' }
];

var ESTADOS = {
  pendiente:   { texto: 'Sin escribir', clase: 'gris' },
  enviado:     { texto: 'Esperando respuesta', clase: 'info' },
  respondio:   { texto: 'Contestó sin ubicación', clase: 'warn' },
  resuelto:    { texto: 'Ubicación recibida', clase: 'ok' },
  supervision: { texto: 'Necesita revisión', clase: 'warn' },
  derivado:    { texto: 'Para el repartidor', clase: 'warn' },
  incidencia:  { texto: 'No se puede escribir', clase: 'bad' },
  cancelado:   { texto: 'Cancelado', clase: 'gris' }
};

function pillEstado(estado) {
  var e = ESTADOS[estado] || { texto: estado, clase: 'gris' };
  return '<span class="pill ' + e.clase + '">' + esc(e.texto) + '</span>';
}

/* --- carga ------------------------------------------------------------ */

async function cargarResumen() {
  resumen = await api('/admin/rutas');
  catalogo = resumen.catalogo || {};

  var select = document.getElementById('lote');
  var opciones = '<option value="">Todos los lotes</option>' + resumen.lotes.map(function (l) {
    return '<option value="' + esc(l.id) + '">' + esc(l.nombre) + ' (' + l.total + ')' +
      (l.estado === 'enviando' ? ' - en marcha' : l.estado === 'pausado' ? ' - pausado' : l.estado === 'terminado' ? ' - terminado' : '') +
      '</option>';
  }).join('');
  if (select.innerHTML !== opciones) {
    select.innerHTML = opciones;
    select.value = loteActual;
  }

  var m = resumen.motor;
  document.getElementById('ritmo').textContent =
    'Un mensaje cada ' + m.pausa[0] + '-' + m.pausa[1] + ' s, de ' + m.horario[0] + ':00 a ' +
    m.horario[1] + ':00, hasta ' + m.maxIntentos + ' intentos por cliente.';

  pintarProgreso(resumen);

  var enMarcha = resumen.lotes.some(function (l) { return l.estado === 'enviando'; });
  document.getElementById('arrancar').disabled = !loteActual && !resumen.lotes.length;
  document.getElementById('pausar').disabled = !enMarcha;

  var alerta = document.getElementById('alerta');
  if (resumen.alertas.requierenPersona) {
    alerta.innerHTML = '<b>' + resumen.alertas.requierenPersona + '</b> ' +
      (resumen.alertas.requierenPersona === 1 ? 'caso necesita' : 'casos necesitan') +
      ' que lo vea una persona: números mal escritos, clientes que contestaron otra cosa ' +
      'o que hay que llamar. <button class="sm" id="ir-alerta">Verlos</button>';
    alerta.classList.remove('hidden');
    document.getElementById('ir-alerta').onclick = function () { cambiarVista('requieren_persona'); };
  } else {
    alerta.classList.add('hidden');
  }

  pintarGsg(resumen.gsg);
}

/**
 * Cuánto va del lote y qué está haciendo el motor ahora mismo.
 *
 * Sin esto, un lote "en marcha" fuera del horario de envío parece averiado:
 * no sale ningún mensaje y la pantalla no da ninguna pista de por qué.
 */
function pintarProgreso(datos) {
  var lote = loteActual
    ? datos.lotes.filter(function (l) { return l.id === loteActual; })[0]
    : null;

  var cifras = lote ? lote.cifras : datos.cifras;
  var total = lote ? lote.total : Object.keys(cifras).reduce(function (suma, k) { return suma + cifras[k]; }, 0);
  var hechos = cifras.resuelto || 0;
  var porcentaje = total ? Math.round((hechos / total) * 100) : 0;

  var m = datos.motor;
  var estado, clase;
  var salud = m.salud;
  if (!m.trabajando) { estado = 'En pausa: ningún lote en marcha'; clase = 'parado'; }
  else if (salud && salud.factor <= 0) {
    // El monitor de salud manda sobre el motor: parado es parado, y hay que decir por qué.
    estado = 'Parado por la salud del número (' + salud.nivel + ')' +
      (salud.pausadaHasta ? ', vuelve a las ' + new Date(salud.pausadaHasta).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : '') +
      (salud.motivos && salud.motivos.length ? ': ' + salud.motivos[0] : '');
    clase = 'espera';
  }
  else if (!m.enHorario) {
    estado = 'Esperando al horario de envío (' + m.horario[0] + ':00 a ' + m.horario[1] + ':00)';
    clase = 'espera';
  } else {
    var factor = salud ? salud.factor : 1;
    estado = 'Enviando, uno cada ' + Math.round(m.pausa[0] / factor) + '-' + Math.round(m.pausa[1] / factor) + ' segundos' +
      (factor < 1 ? ' (salud en ' + salud.nivel + ': al ' + Math.round(factor * 100) + ' %)' : '');
    clase = 'va';
  }

  var avisos = datos.alertas.coordinador
    ? 'Al coordinador se le avisa por WhatsApp de los casos parados.'
    : 'Nadie recibe avisos por WhatsApp (RUTAS_SUPERVISOR está vacío).';

  document.getElementById('progreso').innerHTML =
    '<span class="cifra"><b>' + hechos + '</b> de ' + total + ' con ubicación</span>' +
    '<span class="progreso-barra"><span style="width:' + porcentaje + '%"></span></span>' +
    '<span class="motor ' + clase + '"><span class="punto"></span>' + esc(estado) + '</span>' +
    '<span class="cifra" title="' + esc(avisos) + '">' +
      (datos.alertas.coordinador ? '🔔 avisos activos' : '🔕 sin avisos') +
      ' · resumen a GSG cada ' + datos.alertas.resumenCadaMin + ' min</span>';
}

function pintarGsg(gsg) {
  var caja = document.getElementById('gsg');
  var pendientes = gsg.cola.pendiente || 0;
  caja.innerHTML =
    '<p style="margin:0 0 8px">' +
      (gsg.conectado
        ? '<span class="pill ok">conectado</span>'
        : '<span class="pill warn">sin conectar</span>') +
      ' <span class="muted">' + esc(gsg.descripcion) + '</span></p>' +
    '<p class="muted" style="margin:0 0 10px;font-size:13px">' +
      'Cada ubicación conseguida y cada incidencia se guarda lista para GSG. ' +
      (gsg.conectado
        ? 'Se envían solas cada minuto.'
        : 'Mientras no exista la API se acumulan aquí, y saldrán todas el día que se conecte.') +
    '</p>' +
    '<div class="fila">' +
      '<div><b>' + pendientes + '</b><div class="muted" style="font-size:12.5px">en cola</div></div>' +
      '<div><b>' + (gsg.cola.enviado || 0) + '</b><div class="muted" style="font-size:12.5px">enviados</div></div>' +
      '<div><b>' + (gsg.cola.fallido || 0) + '</b><div class="muted" style="font-size:12.5px">fallidos</div></div>' +
    '</div>' +
    '<div class="fila" style="margin-top:10px">' +
      '<button class="sm" id="gsg-descargar">Descargar la cola</button>' +
      '<button class="sm" id="gsg-enviar"' + (gsg.conectado ? '' : ' disabled') + '>Enviar ahora</button>' +
    '</div>';

  document.getElementById('gsg-descargar').onclick = function () {
    descargar('/admin/rutas/cola.ndjson', 'reportes-gsg.ndjson');
  };
  document.getElementById('gsg-enviar').onclick = async function () {
    try {
      var r = await api('/admin/rutas/cola/despachar', { method: 'POST' });
      toast('Enviados ' + r.enviados + ' de ' + r.intentados + '.');
      cargarResumen();
    } catch (error) { toast(error.message); }
  };
}

async function cargarTarjetas() {
  var data = await api('/admin/rutas/vistas' + (loteActual ? '?loteId=' + encodeURIComponent(loteActual) : ''));
  nombresVista = data.nombres;
  var html = TARJETAS.map(function (t) {
    var n = data.cifras[t.vista] || 0;
    return '<button class="tarjeta ' + t.clase + (vista === t.vista ? ' activa' : '') + '" data-vista="' + t.vista + '">' +
      '<div class="n">' + n + '</div><div class="q">' + esc(data.nombres[t.vista] || t.vista) + '</div></button>';
  }).join('');
  var caja = document.getElementById('tarjetas');
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

  var filas = data.items.map(function (s) {
    return '<tr data-id="' + s.id + '"' + (seleccionada === s.id ? ' class="activa"' : '') + '>' +
      '<td><b>' + esc(s.nombre || 'Sin nombre') + '</b>' +
        '<div class="sub">' + esc(s.phone || s.telefonoCrudo) + '</div></td>' +
      '<td>' + esc(s.referencia || '') +
        (s.distrito ? '<div class="sub">' + esc(s.distrito) + '</div>' : '') + '</td>' +
      '<td>' + pillEstado(s.estado) +
        (s.requiereHumano ? ' <span class="pill warn">persona</span>' : '') + '</td>' +
      '<td>' + s.intentos + '<div class="sub">' + esc(cuando(s.ultimoEnvioAt)) + '</div></td>' +
      '<td>' + esc(queLePasa(s)) + '</td>' +
    '</tr>';
  }).join('');

  var cuerpo = document.getElementById('filas');
  if (cuerpo.innerHTML !== filas) cuerpo.innerHTML = filas;

  var vacia = document.getElementById('lista-vacia');
  vacia.textContent = data.items.length ? '' : (q
    ? 'Nada coincide con "' + q + '".'
    : 'No hay clientes en esta vista.');
  vacia.classList.toggle('hidden', data.items.length > 0);
}

/* La columna que de verdad se lee: por que ese cliente esta ahi. */
function queLePasa(s) {
  if (s.estado === 'resuelto') return 'Recibida a las ' + cuando(s.resueltoAt);
  if (s.incidencia && catalogo[s.incidencia]) {
    return catalogo[s.incidencia].titulo + (s.incidenciaDetalle ? ': ' + s.incidenciaDetalle : '');
  }
  if (s.estado === 'enviado') return 'Se le escribió, sin respuesta todavía';
  if (s.estado === 'pendiente') return 'En la cola';
  return '';
}

/* --- detalle ---------------------------------------------------------- */

/* Numero de la ultima peticion de detalle lanzada. Sin esto, una respuesta
   pedida antes -pero que llega despues- repinta el panel encima de lo que el
   operador acaba de escribir, y el telefono a medio corregir desaparece. */
var peticionDetalle = 0;

/* true si el foco esta en un campo del detalle: entonces no se repinta. */
function escribiendoEnDetalle() {
  var activo = document.activeElement;
  if (!activo || (activo.tagName !== 'INPUT' && activo.tagName !== 'TEXTAREA')) return false;
  var caja = document.getElementById('detalle');
  return Boolean(caja && caja.contains(activo));
}

async function abrirDetalle(id, silencioso) {
  seleccionada = id;
  var mia = ++peticionDetalle;

  /* Al cambiar de cliente, el panel se vacia ANTES de pedir los datos.
     Si se dejaran los campos del cliente anterior, quien escribe rapido
     empieza a corregir un telefono que desaparece medio segundo despues,
     cuando llega la respuesta y el panel se pinta de nuevo. */
  if (!silencioso && detalleId !== id) {
    detalleId = null;
    document.getElementById('detalle-acciones').innerHTML = '';
    document.getElementById('detalle-historial').innerHTML = '';
    document.getElementById('detalle-info').innerHTML = '<p class="muted" style="margin:0">Cargando...</p>';
  }

  try {
    var data = await api('/admin/rutas/solicitudes/' + id);
    if (mia !== peticionDetalle || seleccionada !== id) return;
    if (silencioso && escribiendoEnDetalle()) return;
    pintarDetalle(data);
    if (!silencioso) cargarLista();
  } catch (error) { if (!silencioso) toast(error.message); }
}

/* Que cliente esta pintado en la zona de acciones. Mientras no cambie, esos
   campos no se tocan: son los que el operador puede estar escribiendo. */
var detalleId = null;

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
      '<span class="muted">' + esc(ficha.explicacion) + '</span><br>' +
      '<b>Qué hacer:</b> ' + esc(ficha.queHacer) + '</div></div>'
    : '';

  var bitacora = (data.eventos || []).slice().reverse().map(function (e) {
    return '<li><span class="cuando">' + esc(cuando(e.createdAt)) + '</span> \u00b7 ' + esc(e.detalle || e.tipo) + '</li>';
  }).join('') || '<li class="muted">Todavía no hay movimientos.</li>';

  var info =
    '<p style="margin:0 0 4px"><b>' + esc(s.nombre || 'Sin nombre') + '</b> ' + pillEstado(s.estado) + '</p>' +
    '<p class="muted" style="margin:0 0 12px;font-size:13px">' +
      esc(s.phone || s.telefonoCrudo) +
      (s.referencia ? ' \u00b7 pedido ' + esc(s.referencia) : '') +
      (s.direccion ? '<br>' + esc(s.direccion) : '') +
      (s.distrito ? ' (' + esc(s.distrito) + ')' : '') +
    '</p>' +
    mapa +
    explicacion;

  var zonaInfo = document.getElementById('detalle-info');
  if (zonaInfo.innerHTML !== info) zonaInfo.innerHTML = info;

  var historial =
    '<h3 style="font-size:13px;margin:14px 0 6px">Historial</h3>' +
    '<ul class="bitacora">' + bitacora + '</ul>';
  var zonaHistorial = document.getElementById('detalle-historial');
  if (zonaHistorial.innerHTML !== historial) zonaHistorial.innerHTML = historial;

  // Las acciones solo se reconstruyen al cambiar de cliente.
  if (detalleId === s.id) return;
  detalleId = s.id;

  document.getElementById('detalle-acciones').innerHTML =
    '<div class="campo"><label for="d-telefono">Corregir el teléfono</label>' +
      '<div class="fila"><input id="d-telefono" value="' + esc(s.telefonoCrudo) + '">' +
      '<button class="sm" id="d-guardar-tel" style="flex:none">Guardar y reintentar</button></div></div>' +
    '<div class="campo"><label for="d-ubicacion">Cargar la ubicación a mano (enlace de mapa o "lat, lng")</label>' +
      '<div class="fila"><input id="d-ubicacion" placeholder="https://maps.app.goo.gl/... o -12.09, -77.03">' +
      '<button class="sm" id="d-guardar-ubi" style="flex:none">Guardar</button></div></div>' +
    '<div class="fila" style="margin:12px 0 4px">' +
      '<button class="sm" id="d-derivar">Pasar al repartidor</button>' +
      '<button class="sm" id="d-reintentar">Devolver a la cola</button>' +
      '<a class="link" href="/chat?phone=' + encodeURIComponent(s.phone || s.telefonoCrudo) + '" style="align-self:center">Abrir el chat</a>' +
    '</div>';

  document.getElementById('d-guardar-tel').onclick = function () { guardarTelefono(s.id); };
  document.getElementById('d-guardar-ubi').onclick = function () { guardarUbicacion(s.id); };
  document.getElementById('d-derivar').onclick = function () { derivar(s.id); };
  document.getElementById('d-reintentar').onclick = function () { reintentar(s.id); };
}

async function guardarTelefono(id) {
  var valor = document.getElementById('d-telefono').value.trim();
  if (!valor) return;
  try {
    await api('/admin/rutas/solicitudes/' + id, { method: 'PATCH', body: { telefono: valor } });
    toast('Teléfono corregido: vuelve a la cola.');
    // El numero cambio: las acciones tienen que volver a pintarse con el
    // valor nuevo, no con el que quedo escrito.
    detalleId = null;
    await refrescar();
    abrirDetalle(id);
  } catch (error) { toast(error.message); }
}

async function guardarUbicacion(id) {
  var valor = document.getElementById('d-ubicacion').value.trim();
  if (!valor) return;
  var cuerpo = {};
  var coords = valor.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (coords) { cuerpo.lat = Number(coords[1]); cuerpo.lng = Number(coords[2]); }
  else cuerpo.enlace = valor;

  try {
    await api('/admin/rutas/solicitudes/' + id + '/resolver', { method: 'POST', body: cuerpo });
    toast('Ubicación guardada y lista para GSG.');
    detalleId = null;
    await refrescar();
    abrirDetalle(id);
  } catch (error) { toast(error.message); }
}

async function derivar(id) {
  try {
    await api('/admin/rutas/solicitudes/' + id + '/derivar', { method: 'POST', body: {} });
    toast('Pasado al repartidor.');
    await refrescar();
    abrirDetalle(id);
  } catch (error) { toast(error.message); }
}

async function reintentar(id) {
  try {
    await api('/admin/rutas/solicitudes/' + id + '/reintentar', { method: 'POST', body: {} });
    toast('Devuelto a la cola.');
    await refrescar();
    abrirDetalle(id);
  } catch (error) { toast(error.message); }
}

/* --- cargar un lote nuevo --------------------------------------------- */

document.getElementById('nuevo').onclick = function () {
  ver('carga', true);
  document.getElementById('pegado').focus();
};
document.getElementById('cerrar-carga').onclick = function () { ver('carga', false); };

document.getElementById('revisar').onclick = async function () {
  var texto = document.getElementById('pegado').value;
  if (!texto.trim()) { toast('Pega la lista primero.'); return; }
  try {
    var r = await api('/admin/rutas/previsualizar', { method: 'POST', body: { texto: texto } });
    var columnas = Object.keys(r.columnas).map(function (k) {
      return k + ' = ' + r.columnas[k];
    }).join(' · ');

    var incidencias = Object.keys(r.incidencias).map(function (c) {
      return '<div class="linea">' + (catalogo[c] ? esc(catalogo[c].titulo) : esc(c)) + ': <b>' + r.incidencias[c] + '</b></div>';
    }).join('');

    document.getElementById('resumen-carga').innerHTML =
      '<div class="linea"><b>' + r.listas + '</b> listos para pedirles la ubicación</div>' +
      (r.conIncidencia ? '<div class="linea"><b>' + r.conIncidencia + '</b> con el número mal: no se les escribirá</div>' : '') +
      (r.duplicadas ? '<div class="linea"><b>' + r.duplicadas + '</b> repetidos (se escribe una sola vez)</div>' : '') +
      (r.descartadas.length ? '<div class="linea"><b>' + r.descartadas.length + '</b> filas sin teléfono, descartadas</div>' : '') +
      incidencias +
      '<div class="linea muted">Columnas entendidas: ' + esc(columnas || 'ninguna') + '</div>';

    document.getElementById('crear').disabled = r.listas === 0 && r.conIncidencia === 0;
  } catch (error) { toast(error.message); }
};

document.getElementById('crear').onclick = async function () {
  var boton = this;
  boton.disabled = true;
  try {
    var r = await api('/admin/rutas/lotes', {
      method: 'POST',
      body: {
        nombre: document.getElementById('nombre-lote').value.trim() || undefined,
        texto: document.getElementById('pegado').value,
        arrancar: document.getElementById('arrancar-ya').checked
      }
    });
    toast('Lote creado: ' + r.listas + ' clientes en cola' + (r.conIncidencia ? ', ' + r.conIncidencia + ' con el número mal' : '') + '.');
    document.getElementById('pegado').value = '';
    document.getElementById('nombre-lote').value = '';
    document.getElementById('resumen-carga').innerHTML = '';
    ver('carga', false);
    loteActual = r.lote.id;
    await refrescar();
    document.getElementById('lote').value = loteActual;
  } catch (error) {
    toast(error.message);
  } finally {
    boton.disabled = false;
  }
};

/* --- controles -------------------------------------------------------- */

document.getElementById('lote').onchange = function () {
  loteActual = this.value;
  seleccionada = null;
  refrescar();
};

document.getElementById('arrancar').onclick = async function () {
  var id = loteActual || (resumen && resumen.lotes[0] && resumen.lotes[0].id);
  if (!id) { toast('Carga una lista primero.'); return; }
  try {
    await api('/admin/rutas/lotes/' + id + '/estado', { method: 'POST', body: { estado: 'enviando' } });
    toast('En marcha. Sale un mensaje cada ' + resumen.motor.pausa[0] + '-' + resumen.motor.pausa[1] + ' segundos.');
    refrescar();
  } catch (error) { toast(error.message); }
};

document.getElementById('pausar').onclick = async function () {
  var ids = loteActual ? [loteActual] : (resumen ? resumen.lotes.filter(function (l) { return l.estado === 'enviando'; }).map(function (l) { return l.id; }) : []);
  try {
    for (var i = 0; i < ids.length; i++) {
      await api('/admin/rutas/lotes/' + ids[i] + '/estado', { method: 'POST', body: { estado: 'pausado' } });
    }
    toast('Pausado. No sale ningún mensaje más hasta que le des a empezar.');
    refrescar();
  } catch (error) { toast(error.message); }
};

document.getElementById('csv').onclick = function () {
  if (!loteActual) { toast('Elige un lote para descargar su resultado.'); return; }
  descargar('/admin/rutas/lotes/' + loteActual + '.csv', 'ubicaciones.csv');
};

/* La descarga va por fetch para que el token viaje en la cabecera. */
async function descargar(url, nombre) {
  try {
    var res = await fetch(url, { headers: { authorization: 'Bearer ' + (await pedirToken()) } });
    if (!res.ok) throw new Error('No se pudo descargar el archivo.');
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

document.getElementById('tarjetas').addEventListener('click', function (event) {
  var boton = event.target.closest('[data-vista]');
  if (boton) cambiarVista(boton.getAttribute('data-vista'));
});

function cambiarVista(nueva) {
  vista = nueva;
  cargarTarjetas();
  cargarLista();
}

document.getElementById('filas').addEventListener('click', function (event) {
  var fila = event.target.closest('tr[data-id]');
  if (fila) abrirDetalle(Number(fila.getAttribute('data-id')));
});

document.getElementById('cerrar-detalle').onclick = function () {
  seleccionada = null;
  detalleId = null;
  ver('cerrar-detalle', false);
  document.getElementById('detalle-info').innerHTML =
    '<p class="muted" style="margin:0">Elige un cliente de la lista para ver su historial y arreglar lo que haga falta.</p>';
  document.getElementById('detalle-acciones').innerHTML = '';
  document.getElementById('detalle-historial').innerHTML = '';
  cargarLista();
};

var buscando;
document.getElementById('buscar').addEventListener('input', function () {
  clearTimeout(buscando);
  buscando = setTimeout(cargarLista, 250);
});

async function refrescar() {
  try {
    await cargarResumen();
    await cargarTarjetas();
    await cargarLista();
    // El detalle abierto tambien se pone al dia: el historial crece solo
    // mientras se mira. No pisa lo que se este escribiendo.
    if (seleccionada) await abrirDetalle(seleccionada, true);
  } catch (error) { toast(error.message); }
}

/* Refresco automatico: no toca nada si estas escribiendo en un campo, que
   es lo que hacia que se borrara el telefono a medio corregir. */
setInterval(function () {
  var activo = document.activeElement;
  var escribiendo = activo && (activo.tagName === 'INPUT' || activo.tagName === 'TEXTAREA');
  if (escribiendo) return;
  refrescar();
}, 10000);

refrescar();
`}
</script>
</body></html>`;
}
