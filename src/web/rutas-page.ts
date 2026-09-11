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

import { appShell } from './shell.js';

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
  .wrap { color: var(--text); font: 15px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 1500px; }
  .wrap a { color: var(--accent); }
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

  .aj .aj-titulo { font-size: 14px; margin: 16px 0 4px; }
  .aj .aj-frase { margin: 0; line-height: 2; font-size: 14.5px; }
  .aj .aj-num { width: 64px; padding: 4px 8px; text-align: center; font: inherit; font-size: 14px; margin: 0 2px; }
  .aj .paso { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin-top: 10px; background: var(--bg); }
  .aj .paso h4 { margin: 0 0 6px; font-size: 14px; }
  .aj .paso .cuando { color: var(--muted); font-size: 12.5px; margin: 0 0 8px; }
  .aj .previa { background: #d9fdd3; color: #111b21; border-radius: 10px; padding: 9px 12px; font-size: 13.5px; line-height: 1.45; white-space: pre-wrap; max-width: 620px; box-shadow: 0 1px 0 rgba(0,0,0,.06); }
  .aj .previa small { display: block; color: #667781; font-size: 11px; margin-top: 4px; text-align: right; }
  .aj .paso textarea { width: 100%; margin-top: 8px; min-height: 64px; }
  .aj .marcadores { font-size: 12.5px; color: var(--muted); margin: 6px 0 0; }
  .aj .marcadores code { background: var(--panel); border: 1px solid var(--line); border-radius: 5px; padding: 0 5px; font-size: 12px; cursor: pointer; }
  .aj .plantillas { margin-top: 8px; font-size: 13px; }
  .aj .plantillas label { display: flex; gap: 6px; align-items: center; margin: 3px 0; }
  .aj .plantillas input { width: auto; }
  @media (prefers-color-scheme: dark) { .aj .previa { background: #005c4b; color: #e9edef; } .aj .previa small { color: #a9bbb5; } }
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
         <a class="link" href="/setup">Conectar ahora</a></div>`;

  const contenido = `
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
    <button class="sm" id="abrir-ajustes">Ajustes</button>
    <button class="sm" id="nuevo">Cargar lista nueva</button>
  </div>

  <!-- Ajustes del reparto: pausas, espera, intentos, horario y que se dice en cada paso -->
  <div class="caja hidden" id="ajustes" style="margin-bottom:14px">
    <h2>Ajustes del reparto <span class="sep"></span>
      <button class="sm" id="cerrar-ajustes">Cerrar</button>
    </h2>
    <div class="cuerpo aj">
      <p class="muted" style="margin-top:0">
        Todo lo de aquí se aplica en el siguiente mensaje, sin reiniciar. Las horas son de Lima.
        Por encima de esto manda siempre la salud del número: si el monitor frena, frena.
      </p>

      <h3 class="aj-titulo">¿A qué horas se escribe?</h3>
      <p class="aj-frase">Solo de las <input id="aj-hora-inicio" type="number" min="0" max="23" class="aj-num">:00 a las <input id="aj-hora-fin" type="number" min="1" max="24" class="aj-num">:00.
        Fuera de ese horario, los mensajes esperan al día siguiente.</p>

      <h3 class="aj-titulo">¿Cómo se insiste si no contesta?</h3>
      <p class="aj-frase">Si el cliente no responde, se le vuelve a escribir a los <input id="aj-espera" type="number" min="1" class="aj-num">
        minutos. Como máximo <input id="aj-intentos" type="number" min="1" max="10" class="aj-num"> mensajes por cliente;
        si sigue sin mandar su ubicación, pasa al repartidor para que lo llame.</p>

      <h3 class="aj-titulo">¿A qué ritmo?</h3>
      <p class="aj-frase">Entre un cliente y el siguiente se espera entre <input id="aj-pausa-min" type="number" min="1" class="aj-num">
        y <input id="aj-pausa-max" type="number" min="1" class="aj-num"> segundos, para parecer una persona y cuidar el número.</p>

      <h3 class="aj-titulo">¿Qué se le dice?</h3>
      <p class="muted" style="margin-top:0">Tres momentos: el primer mensaje, el recordatorio si no contestó, y la insistencia si contestó pero sin ubicación.
        Debajo de cada uno ves cómo le llegaría a un cliente de ejemplo. Si no escribes nada, se usan los textos de siempre.</p>
      <div id="aj-pasos"></div>

      <div class="fila" style="margin-top:14px">
        <button class="primary" id="aj-guardar">Guardar</button>
        <button id="aj-reset">Volver a lo de siempre</button>
        <span class="dato" id="aj-estado"></span>
      </div>
    </div>
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
`;

  const script = String.raw`
/* Se entra con la cookie de sesion (/login): si el servidor dice 401, alla. */
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

// ---- ajustes del reparto ----------------------------------------------
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
  var d = ajustesCache; if (!d) return;
  var ta = document.querySelector('textarea[data-textos="' + paso + '"]');
  var lineas = ta ? ta.value.split('\n').map(function (l) { return l.trim(); }).filter(Boolean) : [];
  var texto = lineas.length ? previaDe(lineas[0], d.ejemplo) : d.textosDeSiempre[paso];
  var caja = document.getElementById('aj-previa-' + paso);
  if (caja) caja.innerHTML = esc(texto) + '<small>' + (lineas.length ? (lineas.length > 1 ? 'tu primer texto (se alternan ' + lineas.length + ')' : 'tu texto') : 'texto de siempre') + ' · para ' + esc(d.ejemplo.nombre) + ', pedido ' + esc(d.ejemplo.pedido) + '</small>';
}
var ajustesCache = null;
function pintarAjustes(d) {
  ajustesCache = d;
  var a = d.ajustes;
  document.getElementById('aj-pausa-min').value = a.pausaMinSegundos;
  document.getElementById('aj-pausa-max').value = a.pausaMaxSegundos;
  document.getElementById('aj-espera').value = a.esperaRespuestaMinutos;
  document.getElementById('aj-intentos').value = a.maxIntentos;
  document.getElementById('aj-hora-inicio').value = a.horaInicio;
  document.getElementById('aj-hora-fin').value = a.horaFin;
  var html = '';
  PASOS_AJ.forEach(function (p) {
    var paso = p[0];
    var elegidas = a.plantillas[paso] || [];
    var catalogo = d.catalogo[paso] || [];
    var plantillasHtml = '';
    if (d.usaPlantillas) {
      var porNombre = {};
      d.plantillas.forEach(function (t) {
        if (!porNombre[t.name]) porNombre[t.name] = { name: t.name, status: t.status, propia: t.propia, variables: t.variables };
      });
      var opciones = Object.keys(porNombre).sort().map(function (n) {
        var t = porNombre[n];
        var marcada = elegidas.length ? elegidas.indexOf(t.name) >= 0 : catalogo.indexOf(t.name) >= 0;
        return '<label><input type="checkbox" data-paso="' + paso + '" value="' + esc(t.name) + '"' + (marcada ? ' checked' : '') + '> ' + esc(t.name) + ' <span class="muted">(' + esc(ESTADO_PLANTILLA[t.status] || t.status) + (t.propia ? ', propia' : '') + ')</span></label>';
      }).join('');
      plantillasHtml = '<div class="plantillas"><b>Plantillas de Meta para este paso</b> <span class="muted">(fuera de las 24 h solo puede salir una plantilla aprobada; si marcas varias, se van alternando)</span>' + opciones + '</div>';
    }
    html += '<div class="paso"><h4>' + esc(p[1]) + '</h4><p class="cuando">' + esc(p[2]) + '</p>' +
      '<div class="previa" id="aj-previa-' + paso + '"></div>' +
      '<textarea data-textos="' + paso + '" rows="3" placeholder="Escribe aquí si quieres decirlo a tu manera. Una redacción por línea: se van alternando.">' + esc((a.textos[paso] || []).join('\n')) + '</textarea>' +
      '<p class="marcadores">Puedes usar: <code data-marcador="{nombre}" title="El nombre del cliente">{nombre}</code> <code data-marcador="{pedido}" title="El número de pedido o guía">{pedido}</code> <code data-marcador="{negocio}" title="El nombre de tu negocio">{negocio}</code> <code data-marcador="{direccion}" title="La dirección del pedido">{direccion}</code> <code data-marcador="{distrito}" title="El distrito">{distrito}</code> <code data-marcador="{como}" title="Cómo mandar la ubicación: con el botón o desde el clip, según toque">{como}</code> — clic para insertar.</p>' +
      plantillasHtml + '</div>';
  });
  document.getElementById('aj-pasos').innerHTML = html;
  PASOS_AJ.forEach(function (p) {
    var paso = p[0];
    pintarPrevia(paso);
    var ta = document.querySelector('textarea[data-textos="' + paso + '"]');
    ta.addEventListener('input', function () { pintarPrevia(paso); });
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
  if (window.shellTitulo) shellTitulo(abierta ? 'Ajustes del reparto' : 'Ubicaciones para reparto', abierta ? 'Horario, espera, intentos, textos y plantillas' : 'Pedir la ubicación a cada cliente del día');
}
document.getElementById('abrir-ajustes').onclick = async function () {
  ver('ajustes', true);
  ver('carga', false);
  sincronizarAjustes(true);
  await cargarAjustes();
};
document.getElementById('cerrar-ajustes').onclick = function () { ver('ajustes', false); sincronizarAjustes(false); };
document.getElementById('aj-guardar').onclick = async function () {
  var estado = document.getElementById('aj-estado');
  try {
    var plantillas = {}, textos = {};
    PASOS_AJ.forEach(function (p) {
      var paso = p[0];
      var marcadas = Array.prototype.slice.call(document.querySelectorAll('input[data-paso="' + paso + '"]:checked')).map(function (i) { return i.value; });
      // Si lo marcado es exactamente el catalogo, se guarda vacio: "las de siempre".
      var catalogo = (ajustesCache && ajustesCache.catalogo[paso]) || [];
      var esCatalogo = marcadas.length === catalogo.length && marcadas.every(function (n) { return catalogo.indexOf(n) >= 0; });
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
    estado.textContent = 'Guardado. Se aplica en el siguiente mensaje.';
    toast('Guardado: se escribe de ' + r.vigente.horaInicio + ':00 a ' + r.vigente.horaFin + ':00, se insiste a los ' + r.vigente.esperaRespuestaMinutos + ' min, máximo ' + r.vigente.maxIntentos + ' mensajes, ' + r.vigente.pausaMinSegundos + '-' + r.vigente.pausaMaxSegundos + ' s entre clientes.');
    refrescar();
  } catch (e) { estado.textContent = e.message; }
};
document.getElementById('aj-reset').onclick = async function () {
  try {
    await api('/admin/rutas/ajustes', { method: 'DELETE' });
    await cargarAjustes();
    document.getElementById('aj-estado').textContent = 'Listo: vuelven los valores y textos de siempre.';
    refrescar();
  } catch (e) { document.getElementById('aj-estado').textContent = e.message; }
};

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
    var res = await fetch(url, { credentials: 'same-origin' });
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

/* Llegar con #ajustes (desde el menu) abre la caja; quitar el ancla la cierra. */
function abrirSegunAncla() {
  if (location.hash === '#ajustes') document.getElementById('abrir-ajustes').click();
  else { ver('ajustes', false); sincronizarAjustes(false); }
}
window.addEventListener('hashchange', abrirSegunAncla);
abrirSegunAncla();
refrescar();
`;

  return appShell({
    titulo: 'Ubicaciones para reparto',
    subtitulo: 'Pedir la ubicación a cada cliente del día',
    contenido,
    script,
    css: CSS,
    nombreNegocio: opts.nombreNegocio,
    demo,
    icono: '📍',
  });
}
