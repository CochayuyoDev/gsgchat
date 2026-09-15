/**
 * Manual de uso y soporte: las dos entradas de arriba del menu.
 *
 * El manual se arma con la misma lista de modulos que el menu (shell.ts), asi
 * nunca cuenta una cosa distinta de la que se ve. Soporte no es un formulario
 * a ninguna parte: es lo que hay que mirar cuando algo falla y los datos que
 * hacen falta para contarlo, con un diagnostico en vivo del propio sistema.
 */

import { appShell, todosLosModulos, icono } from './shell.js';
import { escapeHtml } from './login-page.js';

const CSS = `
  .ay-chat { border: 1px solid var(--line, #e3e5e9); border-radius: 12px; background: var(--bg, #f4f5f7); min-height: 90px; max-height: 340px; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
  .ay-chat .b { max-width: 85%; padding: 7px 11px; border-radius: 10px; background: var(--card, #fff); white-space: pre-wrap; }
  .ay-chat .b.yo { align-self: flex-end; background: #d9fdd3; color: #111b21; }
  .ay-fila { display: flex; gap: 8px; flex-wrap: wrap; }
  .ay-fila input { flex: 1; min-width: 200px; padding: 9px 12px; border: 1px solid var(--line, #e3e5e9); border-radius: 8px; background: var(--card, #fff); color: inherit; font: inherit; }
  .ay-fila button { border: 0; border-radius: 8px; padding: 9px 14px; background: #128c7e; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  .ay-fila button.ghost { background: transparent; color: #128c7e; border: 1px solid #128c7e; }
  .ay-fila button:disabled { opacity: .5; }
  :root { --card: #fff; --line: #e6e8ec; --text: #16181d; --muted: #6b7280; --accent: #128c7e; --bg: #f4f6f8; --ok: #16a34a; --warn: #d97706; --bad: #dc2626; }
  @media (prefers-color-scheme: dark) { :root { --card: #1f2229; --line: #2f333c; --text: #f2f3f5; --muted: #9aa0aa; --bg: #16181d; } }
  .wrap { max-width: 960px; color: var(--text); }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 20px 22px; margin-top: 16px; }
  .card:first-child { margin-top: 0; }
  h2 { font-size: 17px; margin: 0 0 6px; }
  h3 { font-size: 14px; margin: 18px 0 6px; }
  p { margin: 0 0 8px; line-height: 1.55; }
  .muted { color: var(--muted); font-size: 13.5px; }
  a { color: var(--accent); }
  ol, ul { padding-left: 20px; margin: 6px 0 0; line-height: 1.6; }
  li { margin-bottom: 4px; }
  .modulos { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); margin-top: 10px; }
  .modulo { display: flex; gap: 12px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 11px; text-decoration: none; color: var(--text); background: var(--bg); }
  .modulo:hover { border-color: var(--accent); }
  .modulo:target { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(18,140,126,.18); }
  .modulo .s-ico { flex: none; color: var(--accent); margin-top: 2px; }
  .modulo b { display: block; font-size: 14px; }
  .modulo span { color: var(--muted); font-size: 13px; line-height: 1.4; }
  .grupo { text-transform: uppercase; letter-spacing: .08em; font-size: 11.5px; color: var(--muted); font-weight: 700; margin: 18px 0 2px; }
  .semaf { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); margin-top: 8px; }
  .semaf div { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; font-size: 13.5px; background: var(--bg); }
  .semaf b { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
  .luz { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
  .luz.verde { background: var(--ok); } .luz.amarillo { background: #eab308; } .luz.naranja { background: var(--warn); } .luz.rojo { background: var(--bad); }
  code { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; background: var(--bg); padding: 1px 5px; border-radius: 5px; }
  pre { background: var(--bg); border: 1px solid var(--line); border-radius: 9px; padding: 12px; overflow: auto; font-size: 12.5px; margin: 8px 0 0; }
  .diag { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin-top: 10px; }
  .diag div { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: var(--bg); }
  .diag span { display: block; color: var(--muted); font-size: 12px; }
  .diag b { font-size: 15px; }
  .diag b.ok { color: var(--ok); } .diag b.warn { color: var(--warn); } .diag b.bad { color: var(--bad); }
  button { padding: 9px 16px; font: inherit; font-weight: 600; border: 1px solid var(--line); border-radius: 9px; background: transparent; color: var(--text); cursor: pointer; }
  .pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .pill.ok { background: rgba(22,163,74,.14); color: var(--ok); } .pill.bad { background: rgba(220,38,38,.14); color: var(--bad); } .pill.warn { background: rgba(217,119,6,.14); color: var(--warn); }
`;

/** El ancla del manual para un modulo: /panel#enviar -> enviar, /rutas#ajustes -> rutas-ajustes. */
function anclaDe(href: string): string {
  return href.replace(/^\/panel#/, '').replace(/^\//, '').replace('#', '-');
}

export function manualPage(opts: { nombreNegocio: string; demo?: boolean }): string {
  const modulos = todosLosModulos()
    .map(
      (g) => `<div class="grupo">${escapeHtml(g.grupo)}</div>
  <div class="modulos">
    ${g.items
      .map(
        (i) => `<a class="modulo" id="m-${anclaDe(i.href)}" href="${i.href}">${icono(i.icono)}<div><b>${escapeHtml(i.etiqueta)}</b><span>${escapeHtml(i.descripcion)}</span></div></a>`,
      )
      .join('\n    ')}
  </div>`,
    )
    .join('\n  ');

  const contenido = `
<div class="wrap">
<section class="card" id="preguntar">
  <h2>Pregúntale al sistema</h2>
  <p class="muted">Escribe tu duda como se la dirías a alguien del soporte: "¿cómo conecto mi tienda Shopify?", "¿por qué no salió un mensaje?", "¿qué hace el modo prueba?". Responde con el manual completo y te dice en qué pantalla se hace.</p>
  <div id="ay-chat" class="ay-chat"><div class="muted" style="padding:10px">Aquí van las respuestas.</div></div>
  <div class="ay-fila">
    <input id="ay-texto" placeholder="¿Cómo pongo el chat en mi web?">
    <button id="ay-enviar" type="button">Preguntar</button>
    <button id="ay-limpiar" type="button" class="ghost">Borrar</button>
  </div>
  <p id="ay-nota" class="muted" style="margin-top:6px"></p>
</section>

<section class="card">
  <h2>Cómo empezar</h2>
  <p class="muted">Cinco pasos, en este orden. Después, el trabajo del día está en Chats y en Reparto.</p>
  <ol>
    <li><b>Conecta el número</b> en <a href="/setup">Conexión de WhatsApp</a>: escanea el QR (camino corto), o usa WAHA o la API oficial de Meta.</li>
    <li><b>Crea las cuentas del equipo</b> en <a href="/panel#usuarios">Usuarios</a>. Un administrador gestiona cuentas y claves; un operador hace todo lo demás.</li>
    <li><b>Da de alta las plantillas</b> en <a href="/panel#plantillas">Plantillas</a> y espera la aprobación de Meta (con el cliente local no hace falta).</li>
    <li><b>Carga contactos con su consentimiento</b> en <a href="/panel#contactos">Contactos</a>: sin opt-in registrado no sale ningún mensaje iniciado por la empresa.</li>
    <li><b>Mira el número antes de subir volumen</b>: <a href="/panel#estado">Estado</a> y <a href="/panel#salud">Riesgo y ritmo</a>. En amarillo el marketing se frena solo; en rojo se pausa todo.</li>
  </ol>
</section>

<section class="card">
  <h2>El reparto, paso a paso</h2>
  <p class="muted">Lo que hace el sistema con la lista del día de GSG.</p>
  <ol>
    <li>Pegas la lista (nombre, teléfono, pedido, dirección) en <a href="/rutas">Ubicaciones para reparto</a> y pulsas <b>Empezar a pedir</b>. Los números mal escritos, cortos o repetidos quedan como <b>incidencia</b> antes de mandar nada.</li>
    <li>A cada cliente le llega un mensaje pidiendo la ubicación, con pausas de 15 a 30 segundos entre uno y otro y solo dentro del horario.</li>
    <li>Si no contesta, se insiste a los minutos que digan los <a href="/rutas#ajustes">Ajustes</a> (por defecto 30), con otro texto o plantilla. Tras el número de intentos configurado, la solicitud pasa a <b>derivado</b>: el motorizado lo llama.</li>
    <li>Si contesta con la ubicación, se guarda y se cierra. Si contesta otra cosa (una foto, un "ya voy", algo sin sentido), queda en <b>supervisión</b> para que una persona lo mire.</li>
    <li>Cada incidencia se anota con nombre y se reporta al sistema de GSG cuando exista su API; mientras tanto se acumula en la cola.</li>
  </ol>
</section>

<section class="card">
  <h2>Escribirle a muchos según cómo están, sin ir uno por uno</h2>
  <p class="muted">Tres formas, según lo que quieras que pase.</p>
  <h3>1. Un mensaje ahora a un grupo → <a href="/panel#grupos">Enviar a un grupo</a></h3>
  <ol>
    <li><b>Elige a quiénes</b> con los filtros: ubicación del reparto (todavía sin ubicación, contestó sin ubicación, derivados, ya con ubicación, nunca se le pidió), ficha de pedido (sin ficha, incompleta, completa), actividad (escribió en los últimos N días, callado, escribió en las últimas 24 h), un lote concreto, o pega una lista de teléfonos.</li>
    <li>Pulsa <b>Ver quiénes son</b>: sale el total, un resumen y la tabla con lo que le pasa a cada uno.</li>
    <li><b>Qué les mandas</b>: una plantilla (las de Meta o las propias) o un texto con marcadores <code>{nombre}</code> <code>{pedido}</code> <code>{negocio}</code> <code>{direccion}</code> <code>{distrito}</code>, que se rellenan para cada cliente. <b>Ver cómo les quedaría</b> enseña el mensaje ya con sus datos.</li>
    <li><b>Enviar por goteo</b>: sale como campaña, con canario primero, al ritmo del número y solo en horario. Se sigue y se pausa en Campañas. También puedes <b>inscribirlos en una secuencia</b> o <b>descargar el CSV</b>.</li>
  </ol>
  <h3>2. Que el sistema conteste o insista solo → <a href="/panel#automatizacion">Automatización</a></h3>
  <ul>
    <li><b>Reglas</b>: responden a lo que escribe el cliente (una palabra clave, su primer mensaje, cualquier texto).</li>
    <li><b>Secuencias</b>: varios pasos con espera entre ellos (hoy el aviso, mañana el recordatorio, a los 3 días la última). Se inscribe a un cliente desde una regla, desde un grupo o pegando teléfonos.</li>
    <li><b>Programados</b>: un mensaje a una hora concreta.</li>
    <li><b>Respuestas rápidas</b>: los atajos <code>/</code> del chat, para lo que se repite a mano.</li>
  </ul>
  <h3>3. El reparto lo hace solo → <a href="/rutas">Ubicaciones para reparto</a></h3>
  <p>Pegas la lista del día y el sistema pide, insiste y deriva. Los que no contestan aparecen luego en <a href="/panel#grupos">Enviar a un grupo</a> como "todavía sin ubicación" o "derivado", por si quieres mandarles otra cosa.</p>
</section>

<section class="card">
  <h2>Atajos del chat</h2>
  <div class="semaf">
    <div><b>Botones sobre el cuadro</b>Una pastilla por respuesta rápida, más "Pedir ubicación" y "Mandar pin". Un clic <b>manda al instante</b> el texto con el nombre del cliente; Shift+clic lo deja en el cuadro para retocarlo. "Editar" lleva a Automatización.</div>
    <div><b>/</b>En el mensaje: las mismas respuestas rápidas, filtradas al escribir; Enter o Tab pone el texto.</div>
    <div><b>⚡</b>Ver todas las respuestas rápidas. Se editan en Automatización.</div>
    <div><b>🙂</b>Mandar un sticker de la biblioteca (se suben en Stickers). Una respuesta rápida puede llevar uno pegado.</div>
    <div><b>Alt + ↓ / ↑</b>Siguiente / anterior conversación.</div>
    <div><b>Ctrl + Shift + U</b>Pedirle su ubicación.</div>
    <div><b>Ctrl + Shift + L</b>Mandar un pin (abre el cuadro del mapa).</div>
    <div><b>Filtros de la lista</b>Todos · Sin leer · Esperan respuesta · Escribieron hoy, encima de las conversaciones.</div>
    <div><b>/ fuera del mensaje</b>Ir al buscador de chats.</div>
    <div><b>Esc</b>Cerrar, salir del campo o volver a la lista.</div>
    <div><b>F1</b>La lista completa, dentro del chat.</div>
  </div>
  <p class="muted" style="margin-top:10px">En la cabecera de cada chat se ve el pedido del reparto y en qué punto va ("esperando su ubicación", "derivado al repartidor"…).</p>
</section>

<section class="card">
  <h2>Stickers</h2>
  <p class="muted">Un toque humano después de un mensaje, sin que nadie tenga que acordarse.</p>
  <ol>
    <li>En <a href="/panel#stickers">Stickers</a> sube tus imágenes (PNG, JPG, GIF o WebP): se convierten solas al formato de WhatsApp. Ponles nombre y para qué son.</li>
    <li>Elige cuál sale solo <b>tras el saludo</b> del asistente a un cliente nuevo, <b>tras el "gracias"</b> (mandó su ubicación o completó su ficha) y <b>en la despedida</b> (cuando pasa al repartidor). Si quieres, también tras el primer mensaje del reparto.</li>
    <li>En el chat, el botón 🙂 manda cualquiera al momento; y en Automatización cada respuesta rápida puede llevar un sticker pegado.</li>
  </ol>
  <p class="muted">Si el número está frenado o la ventana de 24 h está cerrada (API de Meta), el sticker simplemente no sale: nunca bloquea el mensaje al que acompaña.</p>
</section>

<section class="card">
  <h2>Salud del número: qué significa cada color</h2>
  <div class="semaf">
    <div><b><i class="luz verde"></i>Verde</b>Todo en orden: ritmo normal.</div>
    <div><b><i class="luz amarillo"></i>Amarillo</b>Algún aviso (fallos, bloqueos): el marketing va más lento.</div>
    <div><b><i class="luz naranja"></i>Naranja</b>Frenado: solo lo imprescindible (reparto y respuestas).</div>
    <div><b><i class="luz rojo"></i>Rojo</b>Pausado: nada sale hasta que la situación mejore.</div>
  </div>
  <p class="muted" style="margin-top:10px">El monitor mira cada minuto errores de Meta por código, mensajes que no llegan, bajas, quejas y desconexiones. La razón exacta de cada frenada está en <a href="/panel#salud">Riesgo y ritmo</a>.</p>
</section>

<section class="card">
  <h2>Cuentas y claves</h2>
  <ul>
    <li><b>Personas</b>: entran en <code>/login</code> con usuario y contraseña. La primera cuenta se crea sola en el primer arranque y es administradora.</li>
    <li><b>Programas</b> (el sistema de GSG, un script): entran con una <b>clave de API</b> que crea un administrador en <a href="/panel#integraciones">Integraciones</a>. Se ve una sola vez; revocarla la apaga al instante.</li>
    <li>Cambiar la contraseña o desactivar una cuenta cierra sus sesiones abiertas. Cinco intentos fallidos seguidos bloquean cinco minutos.</li>
  </ul>
</section>

<section class="card">
  <h2>Todos los módulos</h2>
  <p class="muted">Lo mismo que hay en el menú, con una línea de qué hace cada uno. Con <kbd>Ctrl K</kbd> se busca cualquiera desde cualquier pantalla.</p>
  ${modulos}
</section>
</div>`;

  const script = String.raw`
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
    var res = await fetch('/admin/ia/ayuda', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texto: texto, historial: AY_HISTORIAL.slice(0, -1).slice(-10) }) });
    var d = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(d.error || ('Error ' + res.status));
    AY_HISTORIAL.push({ role: 'assistant', content: d.texto || '(sin respuesta)' });
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
    subtitulo: 'Qué hace cada módulo y cómo se usa',
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
<section class="card">
  <h2>Diagnóstico en vivo</h2>
  <p class="muted">Lo que el propio sistema dice de sí mismo ahora mismo. Si algo sale en rojo, empieza por ahí.</p>
  <div class="diag" id="diag"><div><span>Cargando…</span><b>…</b></div></div>
  <div style="margin-top:12px"><button id="diag-refrescar">Actualizar</button> <span id="diag-hora" class="muted"></span></div>
</section>

<section class="card">
  <h2>Si algo falla</h2>
  <h3>No sale ningún mensaje</h3>
  <ul>
    <li>Mira <a href="/panel#estado">Estado</a>: ¿el número está conectado y los envíos no están pausados a mano?</li>
    <li>Mira <a href="/panel#salud">Riesgo y ritmo</a>: en rojo el monitor pausa todo, y dice por qué.</li>
    <li>¿Es horario de envío? Fuera del horario configurado nada sale; se queda esperando a mañana.</li>
    <li>¿El contacto tiene consentimiento y no se dio de baja? Sin opt-in, un mensaje iniciado por la empresa no sale nunca.</li>
  </ul>
  <h3>El cliente escribió y nadie ve el mensaje</h3>
  <ul>
    <li>El globo de <a href="/chat">Chats</a> cuenta lo no leído. Si el mensaje no aparece, revisa la conexión en <a href="/setup">Conexión</a>: un WhatsApp Web desvinculado deja de recibir.</li>
  </ul>
  <h3>El reparto no avanza</h3>
  <ul>
    <li>En <a href="/rutas">Ubicaciones para reparto</a> el lote tiene que estar <b>en marcha</b> y dentro del horario de los <a href="/rutas#ajustes">Ajustes</a>.</li>
    <li>Las solicitudes en supervisión o derivadas esperan a una persona: no avanzan solas, por diseño.</li>
  </ul>
  <h3>No puedo entrar</h3>
  <ul>
    <li>Cinco fallos seguidos bloquean cinco minutos. Si olvidaste la contraseña, un administrador te pone una nueva en <a href="/panel#usuarios">Usuarios</a>.</li>
    <li>Si no queda ningún administrador que pueda entrar, hay que hacerlo desde el servidor (ver README, "Entrar: usuarios y sesiones").</li>
  </ul>
</section>

<section class="card">
  <h2>Qué mandar al reportar un problema</h2>
  <p class="muted">Con esto se puede reproducir casi todo. Sin esto, casi nada.</p>
  <ul>
    <li>La <b>hora exacta</b> y el <b>número del cliente</b> (si aplica).</li>
    <li>Qué pantalla y qué botón: una captura ayuda.</li>
    <li>Lo que dice el diagnóstico de arriba (cópialo con el botón).</li>
    <li>Las últimas líneas del registro del servidor (<code>quick.log</code> o la consola donde corre).</li>
  </ul>
  <pre id="diag-texto">…</pre>
  <div style="margin-top:8px"><button id="diag-copiar">Copiar el diagnóstico</button></div>
</section>
</div>`;

  const script = String.raw`
var VERSION = ${JSON.stringify(opts.version)};
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
  document.getElementById('diag-hora').textContent = 'a las ' + new Date().toLocaleTimeString('es-PE');
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
