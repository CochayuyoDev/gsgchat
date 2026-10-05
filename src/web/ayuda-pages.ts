/**
 * Manual de uso y soporte: las dos entradas de arriba del menu.
 *
 * Reparto con la ayuda de cada pantalla (`ayuda-pantallas.ts`), para no
 * contar dos veces lo mismo:
 *
 *  - la ayuda contextual ("¿Qué hago si…?") = una frase de que es la pantalla
 *    y que hacer AHORA, sin explicar el sistema entero;
 *  - el manual = el recorrido completo, con el porque y los casos raros. Es
 *    donde se cuenta una cosa una sola vez, y a donde apunta la ayuda cuando
 *    hace falta mas.
 *
 * El listado final de modulos se arma con la misma lista que el menu
 * (shell.ts), asi el manual nunca enseña un modulo que ya no existe.
 *
 * Soporte no es un formulario a ninguna parte: es que mirar cuando algo falla
 * y que datos hacen falta para contarlo, con un diagnostico en vivo.
 */

import { appShell, todosLosModulos, icono } from './shell.js';
import { escapeHtml } from './login-page.js';

const CSS = `
  /* La paleta y las clases compartidas (.tarjeta, .btn, .chip) vienen del
     armazon (shell.ts / tokens.ts); aqui solo lo propio de estas dos paginas. */
  .wrap { max-width: 960px; color: var(--texto); }
  .tarjeta { padding: 20px 22px; margin-top: var(--esp-4); }
  .tarjeta:first-child { margin-top: 0; }
  h2 { font-size: var(--fs-h2); font-weight: 700; letter-spacing: -.01em; margin: 0 0 6px; }
  h3 { font-size: var(--fs-h3); font-weight: 700; margin: 18px 0 6px; }
  p { margin: 0 0 8px; line-height: 1.55; }
  .muted { color: var(--texto-suave); font-size: 13.5px; }
  a { color: var(--primario); }
  ol, ul { padding-left: 20px; margin: 6px 0 0; line-height: 1.6; }
  li { margin-bottom: 4px; }
  code { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; background: var(--superficie-2); padding: 1px 5px; border-radius: 5px; }
  pre { background: var(--superficie-2); border: 1px solid var(--borde); border-radius: var(--radio-sm); padding: 12px; overflow: auto; font-size: 12.5px; margin: 8px 0 0; }

  /* --- el indice y el buscador del manual --- */
  .buscador { display: flex; gap: var(--esp-2); flex-wrap: wrap; align-items: center; }
  .buscador input { flex: 1; min-width: 220px; min-height: 44px; padding: 10px 12px; border: 1px solid var(--borde); border-radius: var(--radio-sm); background: var(--superficie); color: inherit; font: inherit; }
  .buscador input:focus { border-color: var(--primario); outline: 2px solid var(--primario-suave); outline-offset: 0; }
  .indice { display: grid; gap: var(--esp-3); grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); margin-top: var(--esp-3); }
  .indice h3 { margin: 0 0 4px; font-size: 11.5px; text-transform: uppercase; letter-spacing: .08em; color: var(--texto-suave); }
  .indice ul { list-style: none; padding: 0; margin: 0; }
  .indice li { margin: 0; }
  .indice a { display: block; padding: 5px 0; font-size: 13.5px; text-decoration: none; }
  .indice a:hover { text-decoration: underline; }
  .tarjeta:target { box-shadow: 0 0 0 3px var(--primario-suave), var(--sombra); }
  .sin-resultados { display: none; }

  /* --- el ayudante que responde con el manual --- */
  .ay-chat { border: 1px solid var(--borde); border-radius: var(--radio); background: var(--bg); min-height: 90px; max-height: 340px; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
  .ay-chat .b { max-width: 85%; padding: 7px 11px; border-radius: 10px; background: var(--superficie); white-space: pre-wrap; }
  .ay-chat .b.yo { align-self: flex-end; background: var(--primario-suave); color: var(--texto); }

  /* --- la lista de modulos --- */
  .modulos { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); margin-top: 10px; }
  .modulo { display: flex; gap: 12px; padding: 12px 14px; border: 1px solid var(--borde); border-radius: 11px; text-decoration: none; color: var(--texto); background: var(--bg); }
  .modulo:hover { border-color: var(--primario); }
  .modulo .s-ico { flex: none; color: var(--primario); margin-top: 2px; }
  .modulo b { display: block; font-size: 14px; }
  .modulo span { color: var(--texto-suave); font-size: 13px; line-height: 1.4; }
  .grupo { text-transform: uppercase; letter-spacing: .08em; font-size: 11.5px; color: var(--texto-suave); font-weight: 700; margin: 18px 0 2px; }

  /* --- cuadriculas de dos columnas (atajos, semaforo, diagnostico) --- */
  .cuadros { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); margin-top: 8px; }
  .cuadros > div { border: 1px solid var(--borde); border-radius: 10px; padding: 10px 12px; font-size: 13.5px; background: var(--bg); }
  .cuadros b { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
  .luz { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
  /* Los cuatro niveles salen de los tonos del sistema: el naranja es la
     mezcla de ambar y rojo, asi el modo oscuro tambien los da la vuelta. */
  .luz.verde { background: var(--verde); }
  .luz.amarillo { background: var(--ambar); }
  .luz.naranja { background: color-mix(in srgb, var(--ambar), var(--rojo)); }
  .luz.rojo { background: var(--rojo); }
  .diag span { display: block; color: var(--texto-suave); font-size: 12px; }
  .diag b { font-size: 15px; display: block; }
  .diag b.ok { color: var(--verde); } .diag b.warn { color: var(--ambar); } .diag b.bad { color: var(--rojo); }
`;

/** Una parte del manual: su ancla, su titulo y su cuerpo ya en HTML. */
interface Seccion {
  /** El ancla, sin el `m-` de delante: la ayuda de cada pantalla enlaza `/manual#m-<clave>`. */
  clave: string;
  titulo: string;
  cuerpo: string;
  /** De ventas (Stoky, campañas): con «Solo lo de GSG» no se enseña. */
  ventas?: boolean;
}

interface Capitulo {
  titulo: string;
  secciones: Seccion[];
}

/**
 * El manual, por capitulos. El orden es el del recorrido de quien acaba de
 * llegar: primero poner el sistema en marcha, luego el dia a dia, y al final
 * lo que se toca una vez (la IA, el numero, las conexiones y las cuentas).
 */
const MANUAL: Capitulo[] = [
 { titulo: 'API y WhatsApp', secciones: [
  { clave: 'empezar', titulo: 'Puesta en marcha', cuerpo: '<p>Conecta WhatsApp en Conexión, configura la IA y revisa Salud. Cada cuenta tiene sus datos y su número independientes.</p>' },
  { clave: 'gsg-courier', titulo: 'Recibir pedidos de GSG', cuerpo: '<p>GSG envía hasta 600 pedidos a POST /api/v1/entregas con su clave (Authorization: Bearer o X-API-Key). Tracking, empresa, cliente, teléfono, método de pago y monto a cobrar son obligatorios. El 400 identifica al cliente y detalla los campos faltantes. Los pedidos guardados aparecen en Pedidos GSG.</p>' },
  { clave: 'hoy', titulo: 'Pedidos y ubicación', cuerpo: '<p>Se solicita ubicación hasta tres veces por cliente. Un pin o enlace válido se registra y se devuelve a GSG con tracking, latitud y longitud. Los errores y pedidos sin respuesta quedan visibles para atención humana. Se puede corregir o reintentar desde Pedidos GSG.</p>' },
  { clave: 'chat', titulo: 'Chats', cuerpo: '<p>Lee y responde conversaciones, envía adjuntos y solicita ubicación. Las conversaciones cerradas se conservan en Chats guardados.</p>' },
  { clave: 'ia', titulo: 'IA y ficha de productos', cuerpo: '<p>Configura el modelo y su clave. En Conocimiento carga productos, precios, stock y condiciones. Entrenamiento conserva ejemplos y reglas. Cuando se requiere una persona, el bot deja la conversación al equipo.</p>' },
  { clave: 'plantillas', titulo: 'Plantillas de WhatsApp', cuerpo: '<p>Crea o edita plantillas propias, sincroniza su aprobación y súbelas a Meta. Fuera de la ventana de atención de Meta se necesita una plantilla aprobada.</p>' },
  { clave: 'salud', titulo: 'Salud y errores', cuerpo: '<p>Revisa conexión, reconexión, riesgo, cupo, ritmo, alertas y respaldos. Historial y errores muestra si cada mensaje se envió, se entregó o falló. Un pedido guardado no significa que WhatsApp ya lo haya entregado.</p>' },
  { clave: 'cuentas', titulo: 'Usuarios y cuentas', cuerpo: '<p>El superadministrador gestiona cuentas independientes; cada administrador configura su cuenta y crea operadores. Usuarios conserva roles y contraseñas, y Actividad registra cambios.</p>' },
 ] }
];

/** El ancla del manual para un modulo: /panel#enviar -> enviar, /rutas#ajustes -> rutas-ajustes. */
function anclaDe(href: string): string {
  return href.replace(/^\/panel#/, '').replace(/^\//, '').replace('#', '-');
}

/** Lo que se busca de una seccion: su titulo y su texto, sin etiquetas ni tildes. */
function textoBuscable(...partes: string[]): string {
  return partes
    .join(' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function manualPage(opts: { nombreNegocio: string; demo?: boolean }): string {
  // Las anclas de las secciones mandan: si un modulo del menu cae en la misma
  // (`/entrenamiento` y la seccion "entrenamiento"), la tarjeta del modulo se
  // queda sin id para no repetirlo en la pagina y que `#m-...` sea ambiguo.
  const anclasUsadas = new Set(MANUAL.flatMap((c) => c.secciones.map((s) => s.clave)));

  const modulos = todosLosModulos()
    .map((g) => {
      const items = g.items
        .map((i) => {
          const ancla = anclaDe(i.href);
          const id = anclasUsadas.has(ancla) ? '' : ` id="m-${ancla}"`;
          return `<a class="modulo"${id} href="${i.href}">${icono(i.icono)}<div><b>${escapeHtml(i.etiqueta)}</b><span>${escapeHtml(i.descripcion)}</span></div></a>`;
        })
        .join('\n      ');
      return `<div class="grupo">${escapeHtml(g.grupo)}</div>\n    <div class="modulos">\n      ${items}\n    </div>`;
    })
    .join('\n    ');

  const indice = MANUAL.map(
    (c) => `<div><h3>${escapeHtml(c.titulo)}</h3><ul>${c.secciones
      .map((s) => `<li${s.ventas ? ' class="solo-completo"' : ''}><a href="#m-${s.clave}">${escapeHtml(s.titulo)}</a></li>`)
      .join('')}</ul></div>`,
  ).join('\n      ');

  const secciones = MANUAL.flatMap((c) => c.secciones)
    .map(
      (s) => `<section class="tarjeta${s.ventas ? ' solo-completo' : ''}" id="m-${s.clave}" data-buscar="${escapeHtml(textoBuscable(s.titulo, s.cuerpo))}">
  <h2>${escapeHtml(s.titulo)}</h2>${s.cuerpo}
</section>`,
    )
    .join('\n\n');

  const contenido = `
<div class="wrap">
<section class="tarjeta" id="preguntar">
  <h2>Pregúntale al sistema, o dale órdenes</h2>
  <p class="muted">Escribe tu duda como se la dirías a alguien del soporte («¿cómo conecto mi tienda Shopify?», «¿por qué no salió un mensaje?») o una orden («pon a Juan, el 987 654 321, para pedirle su ubicación»). Es la misma IA operadora del botón <b>IA</b> de arriba: ejecuta con tu cuenta y tus permisos, lo delicado te lo deja para confirmar y todo queda en Actividad.</p>
  <div id="ay-chat" class="ay-chat"><div class="muted" style="padding:10px">Aquí van las respuestas.</div></div>
  <div class="buscador">
    <input id="ay-texto" placeholder="¿Cómo pongo el chat en mi web?" aria-label="Pregúntale al sistema">
    <button id="ay-enviar" type="button" class="btn primario">Preguntar</button>
    <button id="ay-limpiar" type="button" class="btn">Borrar</button>
  </div>
  <p id="ay-nota" class="muted" style="margin-top:6px"></p>
</section>

<section class="tarjeta">
  <h2>Qué hay en el manual</h2>
  <p class="muted">Busca una palabra y abajo quedan solo las partes que hablan de eso. Para la ayuda de una pantalla concreta, el botón «¿Qué hago si…?» de esa pantalla.</p>
  <div class="buscador">
    <input id="buscar" type="search" placeholder="Buscar en el manual: plantilla, ubicación, clave…" aria-label="Buscar en el manual">
    <button id="buscar-limpiar" type="button" class="btn">Ver todo</button>
  </div>
  <nav class="indice" id="indice">
      ${indice}
  </nav>
</section>

${secciones}

<p class="muted sin-resultados" id="sin-resultados">Nada en el manual habla de eso. Pruébalo en el ayudante de arriba: responde con el manual entero y te dice en qué pantalla se hace.</p>

<section class="tarjeta" id="modulos" data-buscar="todos los modulos menu pantallas">
  <h2>Todos los módulos</h2>
  <p class="muted">Lo mismo que hay en el menú, con una línea de qué hace cada uno. Con <kbd>Ctrl K</kbd> se busca cualquiera desde cualquier pantalla.</p>
    ${modulos}
</section>
</div>`;

  const script = String.raw`
/* --- el buscador: esconde las secciones que no hablan de lo buscado ------ */
var SECCIONES = [].slice.call(document.querySelectorAll('[data-buscar]'));
var SIN = document.getElementById('sin-resultados');
var INDICE = document.getElementById('indice');

function sinTildes(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
function filtrar(texto) {
  var buscado = sinTildes(texto);
  var visibles = 0;
  SECCIONES.forEach(function (sec) {
    var vale = !buscado || sec.getAttribute('data-buscar').indexOf(buscado) >= 0;
    sec.hidden = !vale;
    if (vale) visibles++;
  });
  // Con una busqueda en marcha, el indice estorba: lleva a secciones ocultas.
  INDICE.hidden = Boolean(buscado);
  SIN.style.display = visibles ? 'none' : 'block';
}
var buscar = document.getElementById('buscar');
buscar.oninput = function () { filtrar(buscar.value); };
document.getElementById('buscar-limpiar').onclick = function () { buscar.value = ''; filtrar(''); buscar.focus(); };
// Un enlace del indice (o /manual#m-chat) tiene que enseñar su seccion aunque
// haya un filtro puesto.
window.addEventListener('hashchange', function () { if (buscar.value) { buscar.value = ''; filtrar(''); } });

/* --- el ayudante que responde con el manual ------------------------------ */
var AY_HISTORIAL = [];
function ayEsc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function ayPintar() {
  var caja = document.getElementById('ay-chat');
  caja.innerHTML = AY_HISTORIAL.length ? AY_HISTORIAL.map(function (m) {
    return '<div class="b' + (m.role === 'user' ? ' yo' : '') + '">' + ayEsc(m.content).replace(/\n/g, '<br>') + '</div>';
  }).join('') : '<div class="muted" style="padding:10px">Aquí van las respuestas.</div>';
  caja.scrollTop = caja.scrollHeight;
}
async function ayPreguntar() {
  var input = document.getElementById('ay-texto');
  var texto = input.value.trim();
  if (!texto) return;
  var boton = document.getElementById('ay-enviar');
  boton.disabled = true;
  AY_HISTORIAL.push({ role: 'user', content: texto });
  input.value = '';
  ayPintar();
  try {
    var res = await fetch('/admin/ia/ordenes', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texto: texto, historial: AY_HISTORIAL.slice(0, -1).slice(-10).map(function (m) { return { role: m.role, content: m.content }; }) }) });
    var d = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(d.error || ('Error ' + res.status));
    var extra = (d.hechas || []).map(function (h) { return (h.ok ? '✅ ' : '⚠ ') + h.resumen; }).concat((d.pendientes || []).map(function (p) { return '⏸ Pendiente de confirmar (ábrelo en el botón IA de arriba): ' + p.descripcion; }));
    AY_HISTORIAL.push({ role: 'assistant', content: (d.texto || '(sin respuesta)') + (extra.length ? '\n' + extra.join('\n') : '') });
    if ((d.hechas || []).some(function (h) { return h.ok && h.tipo === 'cambio'; })) document.dispatchEvent(new CustomEvent('ia:cambio'));
  } catch (e) {
    AY_HISTORIAL.push({ role: 'assistant', content: '⚠ ' + e.message });
    if (/Puter|conecta/i.test(e.message)) document.getElementById('ay-nota').innerHTML = 'El ayudante usa la misma IA que el asistente: conéctala en <a href="/panel#ia">Mi asistente IA</a>.';
  }
  boton.disabled = false;
  ayPintar();
}
document.getElementById('ay-enviar').onclick = ayPreguntar;
document.getElementById('ay-texto').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); ayPreguntar(); } };
document.getElementById('ay-limpiar').onclick = function () { AY_HISTORIAL = []; ayPintar(); };
`;

  return appShell({
    titulo: 'Manual de uso',
    subtitulo: 'El recorrido completo, pantalla por pantalla',
    contenido,
    script,
    css: CSS,
    nombreNegocio: opts.nombreNegocio,
    demo: opts.demo,
    icono: '📘',
  });
}

export function soportePage(opts: { nombreNegocio: string; demo?: boolean; version: string }): string {
  const contenido = `
<div class="wrap">
<section class="tarjeta">
  <h2>Diagnóstico en vivo</h2>
  <p class="muted">Lo que el propio sistema dice de sí mismo ahora mismo. Si algo sale en rojo, empieza por ahí.</p>
  <div class="cuadros diag" id="diag"><div><span>Cargando…</span><b>…</b></div></div>
  <div style="margin-top:12px"><button id="diag-refrescar" class="btn">Actualizar</button> <span id="diag-hora" class="muted"></span></div>
</section>

<section class="tarjeta">
  <h2>Si algo falla, por dónde empezar</h2>
  <h3>No sale ningún mensaje</h3>
  <ul>
    <li><a href="/panel#estado">Estado</a>: ¿el número está conectado y los envíos no están pausados a mano?</li>
    <li><a href="/panel#salud">Riesgo y ritmo</a>: en rojo el monitor pausa todo, y dice por qué.</li>
    <li>¿Es horario de envío? Fuera del horario configurado nada sale; se queda esperando a mañana.</li>
    <li>¿El contacto tiene consentimiento y no se dio de baja? Sin opt-in, un mensaje iniciado por la empresa no sale nunca.</li>
  </ul>
  <h3>El cliente escribió y nadie ve el mensaje</h3>
  <ul>
    <li>El globo de <a href="/chat">Chats</a> cuenta lo no leído. Si el mensaje no aparece, revisa la conexión en <a href="/setup">Conexión</a>: un WhatsApp Web desvinculado deja de recibir.</li>
  </ul>
  <h3>No le escribe a alguien de la lista de envío automático</h3>
  <ul>
    <li>En <a href="/envio-automatico">Envío automático</a>, la columna <b>Situación</b> dice si espera turno, si le tocan sus horas, si está en pausa, si una persona atiende ese chat o si ya agotó los mensajes.</li>
    <li>Fuera del horario no sale nada; sigue solo a la hora de inicio. Y si el número está en rojo o pausado, la lista espera igual que el reparto.</li>
  </ul>
  <h3>El reparto no avanza</h3>
  <ul>
    <li>En <a href="/rutas">Ubicaciones para reparto</a> el lote tiene que estar <b>en marcha</b> y dentro del horario de los <a href="/rutas#ajustes">Ajustes</a>.</li>
    <li>Las solicitudes en supervisión o derivadas esperan a una persona: no avanzan solas, por diseño.</li>
  </ul>
  <h3>No puedo entrar</h3>
  <ul>
    <li>Cinco fallos seguidos bloquean cinco minutos: espera y vuelve a intentarlo.</li>
    <li>Si olvidaste la contraseña, un administrador te pone una nueva en <a href="/panel#usuarios">Usuarios</a>. Lo demás sobre cuentas está en <a href="/manual#m-cuentas">el manual</a>.</li>
  </ul>
</section>

<section class="tarjeta">
  <h2>Qué mandar al reportar un problema</h2>
  <p class="muted">Con esto se puede reproducir casi todo. Sin esto, casi nada.</p>
  <ul>
    <li>La <b>hora exacta</b> y el <b>número del cliente</b> (si aplica).</li>
    <li>Qué pantalla y qué botón: una captura ayuda.</li>
    <li>Lo que dice el diagnóstico de arriba (cópialo con el botón).</li>
    <li>Las últimas líneas del registro del servidor (<code>quick.log</code> o la consola donde corre).</li>
  </ul>
  <pre id="diag-texto">…</pre>
  <div style="margin-top:8px"><button id="diag-copiar" class="btn">Copiar el diagnóstico</button></div>
</section>
</div>`;

  const script =
    String.raw`
var VERSION = ` +
    JSON.stringify(opts.version) +
    String.raw`;
function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function caja(etiqueta, valor, clase) { return '<div><span>' + esc(etiqueta) + '</span><b class="' + (clase || '') + '">' + esc(valor) + '</b></div>'; }
var ultimo = null;
async function diag() {
  var out = '', datos = { version: VERSION, hora: new Date().toISOString(), pagina: location.href };
  try {
    var r = await fetch('/admin/health', { credentials: 'same-origin', cache: 'no-store' });
    if (r.status === 401) { irAlLogin(); return; }
    var h = await r.json();
    datos.salud = h;
    var n = h.number || {};
    out += caja('Servidor', 'responde', 'ok');
    out += caja('Número', h.configured ? 'configurado' : 'sin configurar', h.configured ? 'ok' : 'bad');
    out += caja('Envíos', n.paused ? 'pausados' : 'activos', n.paused ? 'bad' : 'ok');
    out += caja('Calidad (Meta)', n.quality || '-', n.quality === 'GREEN' ? 'ok' : n.quality === 'YELLOW' ? 'warn' : n.quality ? 'bad' : '');
    out += caja('Riesgo', h.salud ? h.salud.nivel : '-', h.salud && h.salud.nivel === 'verde' ? 'ok' : h.salud && h.salud.nivel === 'amarillo' ? 'warn' : h.salud ? 'bad' : '');
    out += caja('Enviados hoy', (h.sentToday || 0) + ' / ' + (h.dailyCap || 0), '');
    var cola = h.queue || {};
    out += caja('Cola', (cola.waiting || 0) + ' esperando · ' + (cola.failed || 0) + ' fallidos', cola.failed ? 'warn' : '');
    if (h.missing && h.missing.length) out += caja('Falta', h.missing.join(', '), 'warn');
  } catch (e) {
    out += caja('Servidor', 'no responde: ' + e.message, 'bad');
    datos.error = String(e && e.message);
  }
  out += caja('Versión', VERSION, '');
  document.getElementById('diag').innerHTML = out;
  document.getElementById('diag-hora').textContent = 'a las ' + new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false });
  ultimo = datos;
  document.getElementById('diag-texto').textContent = JSON.stringify(datos, null, 2);
}
document.getElementById('diag-refrescar').onclick = diag;
document.getElementById('diag-copiar').onclick = function () {
  navigator.clipboard.writeText(document.getElementById('diag-texto').textContent).then(function () {
    document.getElementById('diag-copiar').textContent = 'Copiado';
    setTimeout(function () { document.getElementById('diag-copiar').textContent = 'Copiar el diagnóstico'; }, 1500);
  });
};
diag();
`;

  return appShell({
    titulo: 'Soporte',
    subtitulo: 'Si algo falla: qué mirar y qué datos mandar',
    contenido,
    script,
    css: CSS,
    nombreNegocio: opts.nombreNegocio,
    demo: opts.demo,
    icono: '🛟',
  });
}
