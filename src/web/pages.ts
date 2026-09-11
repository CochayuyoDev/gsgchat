/**
 * Interfaz web: el panel de operacion (/panel) y lo que comparten las paginas.
 *
 * Existe para que no haya que editar .env ni lanzar curl: la cuenta se conecta
 * en /setup (connect-page.ts) y todo lo demas se opera desde /panel. El navegador
 * entra con la cookie de sesion de /login (ver src/auth); sin ella, al login.
 *
 * El JS de estas paginas va en String.raw y usa concatenacion: ni backticks
 * ni "${" dentro, para no pelearse con el literal que lo envuelve. Todo dato
 * que viene del servidor (nombres de contactos, textos de reglas...) pasa por
 * esc() antes de tocar innerHTML: el nombre de perfil de WhatsApp lo escribe
 * el cliente, no nosotros.
 */

import { appShell } from './shell.js';

const CSS = `
  :root {
    color-scheme: light dark;
    --bg: #f5f6f8; --card: #fff; --line: #e3e5e9; --text: #16181d;
    --muted: #6b7280; --accent: #128c7e; --accent-ink: #fff;
    --ok: #16a34a; --warn: #d97706; --bad: #dc2626;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #16181d; --card: #1f2229; --line: #2f333c; --text: #f2f3f5; --muted: #9aa0aa; }
  }
  * { box-sizing: border-box; }
  .wrap { color: var(--text); font-size: 14.5px; line-height: 1.55; }
  h2 { font-size: 16px; margin: 0 0 4px; }
  h3 { font-size: 14px; margin: 18px 0 4px; }
  .muted { color: var(--muted); font-size: 13px; margin: 0; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px;
    padding: 18px 20px; margin-top: 16px; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 14px 0 5px; }
  label.inline { display: inline-flex; align-items: center; gap: 6px; font-weight: 400; margin: 0; }
  label.inline input { width: auto; }
  input, textarea, select {
    width: 100%; padding: 10px 12px; font: inherit; font-size: 14px; color: var(--text);
    background: var(--bg); border: 1px solid var(--line); border-radius: 9px;
  }
  textarea { min-height: 92px; resize: vertical; font-family: ui-monospace, Consolas, monospace; font-size: 13px; }
  button { padding: 10px 18px; font: inherit; font-weight: 600; border: 0; border-radius: 9px;
    background: var(--accent); color: var(--accent-ink); cursor: pointer; }
  button.ghost { background: transparent; color: var(--text); border: 1px solid var(--line); }
  button.danger { background: transparent; color: var(--bad); border: 1px solid var(--line); }
  button.sm { padding: 5px 10px; font-size: 12.5px; border-radius: 7px; }
  button:disabled { opacity: .5; cursor: default; }
  .actions { display: flex; gap: 10px; align-items: center; margin-top: 18px; flex-wrap: wrap; }
  .toolbar { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); align-items: end; margin-top: 8px; }
  .toolbar label { margin-top: 0; }
  .wrap > section.card:first-of-type, .wrap > .card { margin-top: 0; }
  .wrap > section.card + section.card { margin-top: 16px; }
  /* --- inicio --- */
  .kpis { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  .kpi { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; min-width: 0; }
  .kpi .l { color: var(--muted); font-size: 12.5px; font-weight: 600; letter-spacing: .02em; text-transform: uppercase; }
  .kpi .n { font-size: 28px; font-weight: 800; letter-spacing: -.02em; margin-top: 4px; line-height: 1.1; }
  .kpi .n.ok { color: var(--ok); } .kpi .n.warn { color: var(--warn); } .kpi .n.bad { color: var(--bad); }
  .kpi .d { color: var(--muted); font-size: 12.5px; margin-top: 6px; }
  .kpi a { text-decoration: none; }
  .dos { display: grid; gap: 14px; grid-template-columns: 1.6fr 1fr; margin-top: 14px; align-items: start; }
  .dos > .card { margin-top: 0; }
  @media (max-width: 900px) { .dos { grid-template-columns: 1fr; } }
  .grafica { margin-top: 12px; }
  .grafica svg { width: 100%; height: 190px; display: block; }
  .leyenda { display: flex; gap: 16px; font-size: 12.5px; color: var(--muted); margin-top: 6px; }
  .leyenda i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
  .accesos { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); margin-top: 12px; }
  .accesos a { display: block; padding: 12px 14px; border: 1px solid var(--line); border-radius: 11px; text-decoration: none; color: var(--text); background: var(--bg); font-weight: 600; font-size: 13.5px; }
  .accesos a small { display: block; color: var(--muted); font-weight: 400; font-size: 12px; margin-top: 2px; }
  .accesos a:hover { border-color: var(--accent); }
  .lista { margin: 10px 0 0; padding: 0; list-style: none; }
  .lista li { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid var(--line); font-size: 13.5px; }
  .lista li:first-child { border-top: 0; }
  .lista li .barra { flex: 1; margin-top: 0; }
  .lista li b { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 45%; }
  .pasos { margin: 12px 0 0; padding: 0; list-style: none; display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
  .pasos li { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--line); border-radius: 11px; background: var(--bg); font-size: 13.5px; }
  .pasos li i { flex: none; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-style: normal; font-weight: 800; font-size: 12px; margin-top: 1px; background: rgba(107,114,128,.15); color: var(--muted); }
  .pasos li.hecho i { background: rgba(22,163,74,.15); color: var(--ok); }
  .pasos li.hecho { opacity: .75; }
  .pasos li b { display: block; }
  .pasos li a { text-decoration: none; }
  .pasos li small { color: var(--muted); display: block; }
  .res { display: grid; gap: 4px; margin-top: 14px; padding: 12px 14px; border-radius: 11px; border: 1px solid var(--line); background: var(--bg); font-size: 13.5px; }
  .res b { font-size: 14px; }
  .res.ok { border-color: rgba(22,163,74,.4); } .res.ok b { color: var(--ok); }
  .res.warn { border-color: rgba(217,119,6,.45); background: rgba(217,119,6,.06); } .res.warn b { color: var(--warn); }
  .res.bad { border-color: rgba(220,38,38,.45); background: rgba(220,38,38,.06); } .res.bad b { color: var(--bad); }
  .res a { font-weight: 600; text-decoration: none; margin-top: 2px; }
  .res .muted { display: block; }
  .tecnico { margin-top: 8px; }
  .tecnico summary { cursor: pointer; color: var(--muted); font-size: 12.5px; }
  .tecnico pre { margin-top: 6px; max-height: 220px; }
  .at-fila { display: grid; grid-template-columns: 160px 1fr auto; gap: 8px; align-items: center; margin-top: 8px; }
  .at-fila input, .at-fila textarea { margin: 0; }
  .at-fila textarea { min-height: 44px; font-family: inherit; }
  .at-fila .pre { font-family: ui-monospace, Consolas, monospace; }
  @media (max-width: 700px) { .at-fila { grid-template-columns: 1fr; } }
  .cf-vigente { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .cf-vigente span { background: var(--bg); border: 1px solid var(--line); border-radius: 999px; padding: 4px 11px; font-size: 12.5px; }
  .cf-vigente b { color: var(--accent); }
  .dias { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
  .dias label { display: inline-flex; align-items: center; gap: 5px; margin: 0; padding: 6px 10px; border: 1px solid var(--line); border-radius: 8px; font-weight: 500; font-size: 13px; cursor: pointer; background: var(--bg); }
  .dias input { width: auto; }
  .dias label:has(input:checked) { border-color: var(--accent); color: var(--accent); background: rgba(18,140,126,.08); }
  .cf-aviso { margin-top: 10px; padding: 10px 12px; border-radius: 10px; background: rgba(217,119,6,.08); border: 1px solid rgba(217,119,6,.35); font-size: 13.5px; }
  .cf-nota { color: var(--muted); font-size: 12.5px; margin-top: 4px; }
  .nueva-clave { margin-top: 14px; padding: 14px 16px; border: 1px solid var(--warn); border-radius: 12px; background: rgba(217,119,6,.06); }
  .nueva-clave code { display: block; font-size: 14px; padding: 10px 12px; margin: 8px 0; background: var(--card); border: 1px solid var(--line); border-radius: 8px; word-break: break-all; }
  .pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .pill.ok { background: rgba(22,163,74,.14); color: var(--ok); }
  .pill.warn { background: rgba(217,119,6,.14); color: var(--warn); }
  .pill.bad { background: rgba(220,38,38,.14); color: var(--bad); }
  .pill.muted { background: rgba(107,114,128,.14); color: var(--muted); }
  pre { background: var(--bg); border: 1px solid var(--line); border-radius: 9px;
    padding: 12px; overflow: auto; font-size: 12.5px; margin: 12px 0 0; max-height: 320px; }
  .copy { display: flex; gap: 8px; margin-top: 6px; }
  .copy input { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; }
  ol { padding-left: 20px; margin: 10px 0 0; }
  ol li { margin-bottom: 9px; }
  a { color: var(--accent); }
  .grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
  .stat { background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
  .stat b { display: block; font-size: 20px; }
  .stat b.ok { color: var(--ok); } .stat b.warn { color: var(--warn); } .stat b.bad { color: var(--bad); }
  .hidden { display: none; }
  .tablewrap { overflow-x: auto; margin-top: 12px; border: 1px solid var(--line); border-radius: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: .03em; color: var(--muted); background: var(--bg); white-space: nowrap; }
  tr:last-child td { border-bottom: 0; }
  td .muted { display: block; }
  td.nowrap, th.nowrap { white-space: nowrap; }
  .empty { padding: 18px; color: var(--muted); text-align: center; }
  .pager { display: flex; gap: 8px; align-items: center; margin-top: 10px; font-size: 13px; color: var(--muted); }
  .steps { display: grid; gap: 8px; margin-top: 8px; }
  .step { display: grid; gap: 8px; grid-template-columns: 90px 90px 110px 1fr 1fr auto; align-items: end;
    padding: 10px; border: 1px dashed var(--line); border-radius: 10px; }
  .step label { margin: 0; font-weight: 500; font-size: 12px; }
  .step-text { grid-column: 1 / -1; }
  @media (max-width: 720px) { .step { grid-template-columns: 1fr 1fr; } }
  code { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; background: var(--bg); padding: 1px 5px; border-radius: 5px; }
  .semaforo { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 12px; border: 1px solid var(--line); background: var(--bg); margin-top: 12px; }
  .semaforo .luz { width: 22px; height: 22px; border-radius: 50%; flex: none; box-shadow: 0 0 0 4px rgba(0,0,0,.05); }
  .semaforo .luz.verde { background: var(--ok); } .semaforo .luz.amarillo { background: #eab308; }
  .semaforo .luz.naranja { background: var(--warn); } .semaforo .luz.rojo { background: var(--bad); }
  .semaforo b { font-size: 17px; }
  .motivos { margin: 8px 0 0; padding-left: 18px; font-size: 13.5px; }
  .motivos li { margin-bottom: 4px; }
  .barra { height: 8px; background: var(--line); border-radius: 999px; overflow: hidden; margin-top: 6px; }
  .barra i { display: block; height: 100%; background: var(--accent); }
  .barra i.warn { background: var(--warn); } .barra i.bad { background: var(--bad); }
  .stat small { display: block; color: var(--muted); font-size: 12px; margin-top: 2px; }
`;

const AUTH_JS = String.raw`
  /* Se entra con la cookie de sesion (ver /login); sin ella, al login. */
  function token() { return ''; }
  function irAlLogin() {
    location.href = '/login?next=' + encodeURIComponent(location.pathname + location.hash);
  }
  async function api(path, options) {
    options = options || {};
    var res = await fetch(path, {
      method: options.method || 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    if (res.status === 401) { irAlLogin(); throw new Error('Tu sesión terminó: vuelve a entrar.'); }
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || data.message || errorHttp(res.status));
    return data;
  }
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function show(id, text, kind) {
    var el = document.getElementById(id);
    el.textContent = text;
    el.className = 'pill ' + (kind || 'ok');
    el.classList.remove('hidden');
  }
  function fmt(value) {
    if (!value) return '';
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' });
  }
  function ago(value) {
    if (!value) return '';
    var secs = Math.round((Date.now() - new Date(value).getTime()) / 1000);
    if (secs < 0) return 'en ' + Math.round(-secs / 60) + ' min';
    if (secs < 60) return 'hace ' + secs + ' s';
    if (secs < 3600) return 'hace ' + Math.round(secs / 60) + ' min';
    if (secs < 86400) return 'hace ' + Math.round(secs / 3600) + ' h';
    return 'hace ' + Math.round(secs / 86400) + ' d';
  }
  function pill(kind, text) { return '<span class="pill ' + kind + '">' + esc(text) + '</span>'; }
  function mapsLink(lat, lng) {
    var url = 'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lng;
    return '<a href="' + esc(url) + '" target="_blank" rel="noreferrer">' + Number(lat).toFixed(5) + ', ' + Number(lng).toFixed(5) + '</a>';
  }
  function table(id, headers, rows, empty) {
    var el = document.getElementById(id);
    if (!rows.length) { el.innerHTML = '<div class="empty">' + esc(empty || 'Nada que mostrar') + '</div>'; return; }
    el.innerHTML = '<table><thead><tr>' + headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table>';
  }
  function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
  function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v == null ? '' : v; }
  function lines(text) { return text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean); }
  function copyButtons() {
    document.querySelectorAll('[data-copy]').forEach(function (b) {
      if (b._bound) return; b._bound = true;
      b.onclick = function () {
        var input = document.getElementById(b.getAttribute('data-copy'));
        input.select();
        navigator.clipboard.writeText(input.value);
        b.textContent = 'Copiado';
        setTimeout(function () { b.textContent = 'Copiar'; }, 1200);
      };
    });
  }
  function bindLogout() { enlazarSalir(); }
`;

/** Cada seccion del panel: id (el ancla), titulo y subtitulo de la barra superior. */
const SECCIONES: Array<[string, string, string]> = [
  ['inicio', 'Inicio', 'Un vistazo a todo lo que pasa hoy'],
  ['estado', 'Estado del número', 'Calidad, cupo del día, cola y pausa manual'],
  ['salud', 'Riesgo y ritmo', 'Lo que mira el monitor y por qué frena'],
  ['enviar', 'Enviar mensaje', 'Un texto, un pin o una plantilla a un número'],
  ['contactos', 'Contactos', 'Consentimiento, búsqueda e importación'],
  ['ubicaciones', 'Ubicaciones recibidas', 'Los pines que mandaron los clientes'],
  ['vivo', 'Rastreo en vivo', 'Enlaces para compartir y ver una posición'],
  ['grupos', 'Enviar a un grupo', 'Elegir clientes por cómo están y escribirles a todos'],
  ['campanas', 'Campañas', 'Envíos masivos por goteo, con canario'],
  ['automatizacion', 'Automatización', 'Reglas y secuencias'],
  ['plantillas', 'Plantillas', 'Las de Meta y las propias'],
  ['historial', 'Historial de envíos', 'Todo lo que salió, con su estado'],
  ['extraer', 'Extraer coordenadas', 'De un link de mapa o un texto'],
  ['configuracion', 'Configuración', 'Horario de envío, ritmo, modo prueba, avisos y nombre'],
  ['usuarios', 'Usuarios', 'Cuentas del equipo, roles y contraseñas'],
  ['integraciones', 'Integraciones', 'Claves de API para GSG y otros programas'],
  ['actividad', 'Actividad', 'Quién hizo qué y cuándo'],
  ['mi-cuenta', 'Mi cuenta', 'Tus datos y tu contraseña'],
];

export interface PanelOpts {
  configured: boolean;
  nombreNegocio: string;
  demo?: boolean;
}

export function panelPage(opts: PanelOpts): string {
  const { configured } = opts;
  const warning = configured
    ? ''
    : `<div class="card" style="border-color:#d97706">
         <h2>Falta conectar WhatsApp</h2>
         <p class="muted">Los envios estan desactivados hasta que pegues las credenciales en
         <a href="/setup">la pantalla de conexion</a>. Contactos, reglas, secuencias y el extractor de coordenadas si funcionan.</p>
       </div>`;

  const body = `
${warning}

<div id="tab-inicio" class="hidden">
  <section class="card hidden" id="in-pasos-card" style="margin-bottom:14px">
    <h2>Para empezar</h2>
    <p class="muted">Lo que falta por dejar listo. Cada punto lleva a la pantalla donde se hace; cuando esté todo, esta tarjeta desaparece.</p>
    <ul class="pasos" id="in-pasos"></ul>
  </section>
  <div class="kpis" id="in-kpis"><div class="kpi"><div class="l">Cargando</div><div class="n">…</div></div></div>
  <div class="dos">
    <section class="card">
      <h2>Últimos 7 días</h2>
      <p class="muted">Mensajes que salieron y que entraron, por día.</p>
      <div class="grafica" id="in-grafica"></div>
      <div class="leyenda"><span><i style="background:var(--accent)"></i>Salieron</span><span><i style="background:#94a3b8"></i>Entraron</span></div>
    </section>
    <section class="card">
      <h2>El número</h2>
      <div id="in-numero"><p class="muted">Cargando…</p></div>
      <div class="actions"><a href="/panel#salud">Ver el detalle</a></div>
    </section>
  </div>
  <div class="dos">
    <section class="card">
      <h2>Reparto</h2>
      <p class="muted">Solicitudes de ubicación por estado y los últimos lotes.</p>
      <div id="in-reparto"></div>
    </section>
    <section class="card">
      <h2>Accesos rápidos</h2>
      <div class="accesos">
        <a href="/chat">Abrir los chats<small>Responder a los clientes</small></a>
        <a href="/rutas">Cargar el reparto<small>Pegar la lista del día</small></a>
        <a href="/panel#campanas">Nueva campaña<small>Por goteo, con canario</small></a>
        <a href="/panel#enviar">Enviar un mensaje<small>A un número concreto</small></a>
        <a href="/panel#plantillas">Plantillas<small>Crear o sincronizar</small></a>
        <a href="/setup">Conexión<small>QR, WAHA o Meta</small></a>
      </div>
    </section>
  </div>
</div>

<section id="tab-estado" class="card hidden">
  <h2>Estado del numero</h2>
  <p class="muted">Miralo antes de subir volumen. En amarillo se frena el marketing solo; en rojo se pausa todo.</p>
  <div class="grid" id="stats" style="margin-top:14px"></div>
  <div class="actions">
    <button class="ghost" id="refresh">Actualizar</button>
    <button class="ghost" id="numsync">Sincronizar con Meta</button>
    <button class="ghost" id="pause">Pausar envios</button>
    <button class="ghost" id="resume">Reanudar</button>
    <span id="num-state" class="pill hidden"></span>
  </div>
</section>

<section id="tab-salud" class="card hidden">
  <h2>Salud del numero</h2>
  <p class="muted">Lo que mira el monitor cada minuto: errores de Meta por codigo, mensajes que no llegan, bajas, quejas y desconexiones.
  Con eso decide a que velocidad se envia, cuando frena solo y cuando para. Si algo no sale, la razon esta aqui.</p>
  <div id="sl-semaforo" class="semaforo"><span class="luz verde"></span><div><b id="sl-nivel">cargando...</b><p class="muted" id="sl-sub"></p></div></div>
  <ul id="sl-motivos" class="motivos"></ul>
  <div class="grid" id="sl-stats" style="margin-top:14px"></div>
  <div class="actions">
    <button class="ghost" id="sl-refresh">Actualizar</button>
    <button class="ghost" id="sl-evaluar">Recalcular ahora</button>
    <button id="sl-reanudar">Reanudar (con rampa)</button>
    <span id="sl-state" class="pill hidden"></span>
  </div>

  <h3>Ritmo vigente</h3>
  <p class="muted" id="sl-politica"></p>
  <div class="grid" id="sl-ritmo"></div>

  <h3>Ventanas</h3>
  <div id="sl-ventanas" class="tablewrap"></div>

  <h3>Plantillas</h3>
  <div id="sl-plantillas" class="tablewrap"></div>

  <h3>Contactos apartados</h3>
  <p class="muted">A quien Meta dijo que no tiene WhatsApp (un mes), que ya recibio demasiado marketing (un dia) o que pidio no recibirlo. Se levanta solo al vencer, o a mano aqui.</p>
  <div class="toolbar">
    <div><label>Telefono</label><input id="sl-levantar-phone" placeholder="51987654321"></div>
    <div><button class="ghost" id="sl-levantar">Levantar la supresion</button></div>
  </div>

  <h3>Ultimas senales</h3>
  <div id="sl-eventos" class="tablewrap"></div>
</section>

<section id="tab-enviar" class="card hidden">
  <h2>Mensaje de texto</h2>
  <p class="muted">Solo sale si el contacto te escribio en las ultimas 24 h. Fuera de esa ventana hay que usar una plantilla (Campañas o Automatización, en el menú).</p>
  <label>Telefono (con codigo de pais, sin + ni espacios)</label>
  <input id="m-phone" placeholder="51987654321">
  <label>Texto</label>
  <textarea id="m-text" placeholder="Tu pedido va en camino."></textarea>
  <div class="actions"><button id="m-send">Enviar</button><span id="m-state" class="pill hidden"></span></div>
  <div id="m-out" class="hidden"></div>

  <h2 style="margin-top:26px">Enviar una ubicacion</h2>
  <p class="muted">Pega un link de Google Maps o unas coordenadas: el sistema extrae la latitud y longitud y manda el pin.</p>
  <label>Telefono</label>
  <input id="u-phone" placeholder="51987654321">
  <label>Link de mapa o coordenadas</label>
  <input id="u-input" placeholder="https://maps.app.goo.gl/... o -12.0464, -77.0428">
  <label>Nombre del sitio (opcional)</label>
  <input id="u-name" placeholder="Tienda de Miraflores">
  <div class="actions">
    <button id="u-send">Enviar pin</button>
    <button class="ghost" id="u-ask">Pedirle su ubicacion</button>
    <span id="u-state" class="pill hidden"></span>
  </div>
  <div id="u-out" class="hidden"></div>
</section>

<section id="tab-contactos" class="card hidden">
  <h2>Contactos</h2>
  <p class="muted">Solo reciben mensajes iniciados por la empresa los que tienen opt-in registrado. Una baja bloquea todo, sin excepciones.</p>
  <div class="toolbar">
    <div><label for="ct-q">Buscar</label><input id="ct-q" placeholder="telefono o nombre"></div>
    <div><label for="ct-state">Estado</label>
      <select id="ct-state">
        <option value="all">Todos</option>
        <option value="opted_in">Con opt-in</option>
        <option value="pending">Sin consentimiento</option>
        <option value="opted_out">Dados de baja</option>
      </select></div>
    <div><button class="ghost" id="ct-search">Buscar</button></div>
    <div><button class="ghost" id="ct-csv" title="Descarga los contactos del filtro actual (hasta 5000)">Descargar CSV</button></div>
  </div>
  <div id="ct-table" class="tablewrap"></div>
  <div class="pager"><button class="ghost sm" id="ct-prev">Anterior</button><span id="ct-page"></span><button class="ghost sm" id="ct-next">Siguiente</button></div>

  <h3>Importar contactos con opt-in</h3>
  <p class="muted">Una linea por contacto: <code>telefono,nombre</code>. Importar registra el consentimiento con el origen que indiques; guarda de donde salio (formulario, compra, evento) porque es lo que respalda el envio.</p>
  <label>Origen del consentimiento</label>
  <input id="ct-source" placeholder="formulario web, compra en tienda, evento...">
  <label>Contactos</label>
  <textarea id="ct-import" placeholder="51987654321,Ana Perez&#10;51912345678,Luis"></textarea>
  <div class="actions"><button id="ct-do-import">Importar</button><span id="ct-state-msg" class="pill hidden"></span></div>
</section>

<section id="tab-ubicaciones" class="card hidden">
  <h2>Ubicaciones recibidas</h2>
  <p class="muted">Todo lo que el bot extrajo de mensajes y links. Las de baja confianza quedan sin confirmar hasta que el cliente responde al boton.</p>
  <div class="toolbar">
    <div><label for="lc-phone">Telefono (opcional)</label><input id="lc-phone" placeholder="51987654321"></div>
    <div><button class="ghost" id="lc-search">Actualizar</button></div>
  </div>
  <div id="lc-table" class="tablewrap"></div>
</section>

<section id="tab-vivo" class="card hidden">
  <h2>Ubicacion en vivo</h2>
  <p class="muted">Genera dos enlaces: uno para quien se mueve y otro para quien mira. La Cloud API no puede
  mandar live location, asi que WhatsApp solo transporta el enlace y el mapa corre aqui.</p>
  <label>Telefono del cliente (opcional, para enviarle el enlace)</label>
  <input id="v-phone" placeholder="51987654321">
  <label>Etiqueta</label>
  <input id="v-label" placeholder="Pedido A-1024">
  <label>Duracion (minutos)</label>
  <input id="v-ttl" type="number" value="120" min="5" max="1440">
  <div class="actions">
    <label class="inline"><input type="checkbox" id="v-notify"> Enviarselo por WhatsApp</label>
    <button id="v-create">Crear sesion</button>
    <span id="v-state" class="pill hidden"></span>
  </div>
  <div id="v-links" class="hidden">
    <label>Enlace para quien comparte su ubicacion</label>
    <div class="copy"><input id="v-pub" readonly><button class="ghost" data-copy="v-pub">Copiar</button></div>
    <label>Enlace para quien la mira</label>
    <div class="copy"><input id="v-view" readonly><button class="ghost" data-copy="v-view">Copiar</button></div>
  </div>

  <h3>Sesiones activas</h3>
  <div id="v-table" class="tablewrap"></div>
  <div class="actions"><button class="ghost sm" id="v-refresh">Actualizar</button></div>
</section>

<section id="tab-grupos" class="card hidden">
  <h2>Enviar a un grupo de clientes</h2>
  <p class="muted">Elige a quiénes por cómo están (todavía sin ubicación, ficha incompleta, callados desde hace días…), mira quiénes son y mándales a todos un mensaje <b>personalizado</b> por goteo, mételos en una secuencia o descárgalos.
  Nada sale a quien se dio de baja; el ritmo y el horario los pone el marcapasos del número.</p>

  <h3>1. ¿A quiénes?</h3>
  <div class="toolbar">
    <div><label for="gr-consent">Consentimiento</label><select id="gr-consent"><option value="opt_in">Solo con opt-in</option><option value="todos">Todos (menos bajas)</option></select></div>
    <div><label for="gr-reparto">Ubicación del reparto</label><select id="gr-reparto"></select></div>
    <div><label for="gr-lote">Lote</label><select id="gr-lote"><option value="">Cualquiera</option></select></div>
    <div><label for="gr-ficha">Ficha de pedido</label><select id="gr-ficha"></select></div>
    <div><label for="gr-actividad">Actividad</label><select id="gr-actividad"></select></div>
    <div><label for="gr-dias">Días (el N de arriba)</label><input id="gr-dias" type="number" value="7" min="1" max="365"></div>
    <div><label for="gr-q">Buscar</label><input id="gr-q" placeholder="nombre o teléfono"></div>
  </div>
  <label for="gr-telefonos">Solo estos teléfonos (opcional: pega una lista, uno por línea, y se cruza con los filtros)</label>
  <textarea id="gr-telefonos" rows="2" style="min-height:52px"></textarea>
  <div class="actions"><button id="gr-ver">Ver quiénes son</button><span id="gr-state" class="pill hidden"></span></div>
  <div id="gr-resumen" class="cf-vigente"></div>
  <div id="gr-table" class="tablewrap hidden"></div>

  <h3>2. ¿Qué les mandas?</h3>
  <div class="toolbar">
    <div><label for="gr-modo">Cómo</label><select id="gr-modo"><option value="plantilla">Una plantilla</option><option value="texto">Un texto con marcadores</option></select></div>
    <div id="gr-plantilla-wrap"><label for="gr-plantilla">Plantilla</label><select id="gr-plantilla"></select></div>
    <div><label for="gr-nombre">Nombre de la campaña (opcional)</label><input id="gr-nombre" placeholder="Recordatorio ubicación viernes"></div>
    <div><label for="gr-canario">Canario (cuántos salen primero)</label><input id="gr-canario" type="number" min="0" placeholder="automático"></div>
    <div><label for="gr-ritmo">Ritmo (por hora)</label><input id="gr-ritmo" type="number" min="1" placeholder="el general"></div>
  </div>
  <div id="gr-texto-wrap" class="hidden">
    <label for="gr-texto">Texto</label>
    <textarea id="gr-texto" placeholder="Hola {nombre}, tu pedido {pedido} sale hoy. ¿Nos compartes tu ubicación? Gracias, {negocio}."></textarea>
    <p class="cf-nota">Marcadores que se rellenan por cliente: <code>{nombre}</code> <code>{pedido}</code> <code>{negocio}</code> <code>{direccion}</code> <code>{distrito}</code>. Con la API oficial de Meta esto no está disponible: hace falta una plantilla aprobada.</p>
  </div>
  <div class="actions"><button class="ghost" id="gr-previa">Ver cómo les quedaría</button><span id="gr-previa-state" class="pill hidden"></span></div>
  <div id="gr-previa-out" class="hidden"></div>

  <h3>3. Hacer</h3>
  <div class="actions">
    <button id="gr-enviar">Enviar por goteo</button>
    <select id="gr-secuencia" style="width:auto;min-width:220px"><option value="">Inscribir en una secuencia…</option></select>
    <button class="ghost" id="gr-inscribir">Inscribir</button>
    <button class="ghost" id="gr-csv">Descargar CSV</button>
    <span id="gr-state2" class="pill hidden"></span>
  </div>
  <div id="gr-out" class="hidden"></div>
</section>

<section id="tab-campanas" class="card hidden">
  <h2>Campana con plantilla</h2>
  <p class="muted">Solo salen los contactos con opt-in registrado. Cada bloqueo queda anotado para que veas
  si la lista esta sucia antes de quemar el numero.</p>
  <label>Plantilla</label>
  <select id="c-template"></select>
  <label>Nombre de la campana</label>
  <input id="c-name" placeholder="Recordatorio marzo">
  <label>Destinatarios (uno por linea: telefono,variable1,variable2). Vacio = todos los que tienen opt-in.</label>
  <textarea id="c-list" placeholder="51987654321,Ana,A-1024,https://ej.pe/t/9"></textarea>
  <div class="toolbar">
    <div><label>Canario (cuantos salen primero)</label><input id="c-canario" placeholder="automatico: 10 %, entre 5 y 20"></div>
    <div><label>Espera del canario (min)</label><input id="c-canario-espera" value="60"></div>
    <div><label>Como mucho por hora</label><input id="c-ritmo" placeholder="vacio = ritmo general"></div>
  </div>
  <p class="muted">La campana no se vuelca: sale por goteo al ritmo del marcapasos. Primero el canario; si en la espera aparecen fallos, bajas o numeros sin WhatsApp, el resto se queda parado y la campana lo dice.</p>
  <div class="actions"><button id="c-send">Lanzar</button><span id="c-state" class="pill hidden"></span></div>
  <pre id="c-out" class="hidden"></pre>

  <h3>Campanas lanzadas</h3>
  <div id="c-table" class="tablewrap"></div>
  <div class="actions"><button class="ghost sm" id="c-refresh">Actualizar</button><button class="ghost sm" id="c-goteo">Dar una pasada ahora</button><span id="c-state2" class="pill hidden"></span></div>
</section>

<section id="tab-automatizacion" class="card hidden">
  <h2>Respuestas rápidas del chat</h2>
  <p class="muted">Atajos para escribir más rápido en <a href="/chat">Chats</a>: se escribe <code>/</code> y el nombre del atajo, y el texto aparece listo para enviar. Valen <code>{nombre}</code>, <code>{pedido}</code> y <code>{negocio}</code>.</p>
  <div id="at-lista"></div>
  <div class="actions"><button class="ghost sm" id="at-anadir">Añadir atajo</button><button class="sm" id="at-guardar">Guardar atajos</button><button class="ghost sm" id="at-fabrica">Volver a los de fábrica</button><span id="at-state" class="pill hidden"></span></div>

  <h2 style="margin-top:26px">Respuestas automaticas</h2>
  <p class="muted">Se aplican a lo que escribe el cliente, despues de BAJA/ALTA y antes de buscar coordenadas. En los textos valen
  <code>{nombre}</code>, <code>{telefono}</code> y <code>{fecha}</code>.</p>
  <div id="r-table" class="tablewrap"></div>
  <h3>Nueva regla</h3>
  <div class="toolbar">
    <div><label for="r-name">Nombre</label><input id="r-name" placeholder="Bienvenida"></div>
    <div><label for="r-trigger">Se dispara con</label>
      <select id="r-trigger">
        <option value="keyword">Una palabra clave</option>
        <option value="first_message">El primer mensaje del contacto</option>
        <option value="any">Cualquier texto sin coordenadas</option>
      </select></div>
    <div><label for="r-keyword">Palabra clave</label><input id="r-keyword" placeholder="precio"></div>
    <div><label for="r-match">Coincidencia</label>
      <select id="r-match">
        <option value="contains">Contiene</option>
        <option value="starts">Empieza por</option>
        <option value="equals">Es exactamente</option>
      </select></div>
    <div><label for="r-sequence">Inscribir en secuencia</label><select id="r-sequence"><option value="">(ninguna)</option></select></div>
  </div>
  <label>Respuesta (opcional si la regla solo inscribe)</label>
  <textarea id="r-reply" placeholder="Hola {nombre}, gracias por escribir. En un momento te atendemos."></textarea>
  <div class="actions"><button id="r-create">Guardar regla</button><span id="r-state" class="pill hidden"></span></div>
  <div class="actions">
    <label class="inline"><input type="checkbox" id="p-askloc"> Si un mensaje no trae coordenadas ni coincide con ninguna regla, pedir la ubicacion con el boton nativo</label>
  </div>

  <h2 style="margin-top:26px">Secuencias de seguimiento</h2>
  <p class="muted">Una lista de pasos con retardo. Fuera de la ventana de 24 h solo puede salir una plantilla aprobada; un paso de texto que caiga fuera se bloquea y cierra la secuencia. Si el contacto responde, se cancela lo que quedaba (configurable).</p>
  <div id="s-table" class="tablewrap"></div>
  <h3>Nueva secuencia</h3>
  <div class="toolbar">
    <div><label for="s-name">Nombre</label><input id="s-name" placeholder="Seguimiento de cotizacion"></div>
    <div><label for="s-desc">Descripcion</label><input id="s-desc" placeholder="Que hace y cuando usarla"></div>
    <div><label class="inline" style="margin-top:28px"><input type="checkbox" id="s-stop" checked> Detener si el contacto responde</label></div>
  </div>
  <div class="steps" id="s-steps"></div>
  <div class="actions"><button class="ghost sm" id="s-add-step">Anadir paso</button><button id="s-create">Guardar secuencia</button><span id="s-state" class="pill hidden"></span></div>

  <h3>Inscribir contactos</h3>
  <div class="toolbar">
    <div><label for="e-sequence">Secuencia</label><select id="e-sequence"></select></div>
    <div><label for="e-source">Origen</label><input id="e-source" placeholder="panel"></div>
  </div>
  <label>Telefonos (uno por linea)</label>
  <textarea id="e-phones" placeholder="51987654321"></textarea>
  <div class="actions"><button id="e-enroll">Inscribir</button><span id="e-state" class="pill hidden"></span></div>

  <h3>Inscripciones</h3>
  <div class="toolbar">
    <div><label for="e-status">Estado</label>
      <select id="e-status"><option value="active">Activas</option><option value="completed">Completadas</option><option value="cancelled">Canceladas</option><option value="">Todas</option></select></div>
    <div><button class="ghost" id="e-refresh">Actualizar</button></div>
  </div>
  <div id="e-table" class="tablewrap"></div>

  <h2 style="margin-top:26px">Mensajes programados</h2>
  <p class="muted">Un envio suelto a una fecha y hora. Los pasos de las secuencias tambien aparecen aqui.</p>
  <div class="toolbar">
    <div><label for="sc-phone">Telefono</label><input id="sc-phone" placeholder="51987654321"></div>
    <div><label for="sc-when">Cuando</label><input id="sc-when" type="datetime-local"></div>
    <div><label for="sc-kind">Tipo</label><select id="sc-kind"><option value="template">Plantilla</option><option value="freeform">Texto (solo dentro de 24 h)</option></select></div>
    <div><label for="sc-template">Plantilla</label><select id="sc-template"></select></div>
    <div><label for="sc-vars">Variables (separadas por coma)</label><input id="sc-vars" placeholder="{nombre},A-1024"></div>
  </div>
  <label>Texto (si es de tipo texto)</label>
  <textarea id="sc-text" placeholder="Hola {nombre}, ..."></textarea>
  <div class="actions"><button id="sc-create">Programar</button><button class="ghost" id="sc-run">Ejecutar pendientes ahora</button><span id="sc-state" class="pill hidden"></span></div>
  <div class="toolbar">
    <div><label for="sc-status">Estado</label>
      <select id="sc-status"><option value="pending">Pendientes</option><option value="sent">Enviados</option><option value="blocked">Bloqueados</option><option value="failed">Fallidos</option><option value="cancelled">Cancelados</option><option value="">Todos</option></select></div>
    <div><button class="ghost" id="sc-refresh">Actualizar</button></div>
  </div>
  <div id="sc-table" class="tablewrap"></div>
</section>

<section id="tab-plantillas" class="card hidden">
  <h2>Plantillas</h2>
  <p class="muted">El registro local es lo que consultan las guardas antes de cada envio. Sincroniza para traer estado y calidad desde Meta.</p>
  <div class="actions"><button id="t-sync">Sincronizar desde Meta</button><span id="t-state" class="pill hidden"></span></div>
  <div id="t-table" class="tablewrap"></div>

  <h3>Crear una plantilla propia</h3>
  <p class="muted">Se guarda en el registro y se puede elegir en Ubicaciones (Ajustes) o en una campana. Con la API de Meta queda pendiente hasta que la subas y la aprueben; con el cliente no oficial se manda tal cual, con las variables sustituidas.
  El nombre va en minusculas con guion bajo; cada <code>{{n}}</code> del cuerpo se describe en orden (es lo que ve el revisor de Meta).</p>
  <div class="toolbar">
    <div><label>Nombre</label><input id="tp-name" placeholder="aviso_entrega_hoy"></div>
    <div><label>Idioma</label><input id="tp-language" value="es"></div>
    <div><label>Categoria</label><select id="tp-category"><option value="UTILITY">UTILITY</option><option value="MARKETING">MARKETING</option></select></div>
  </div>
  <label>Cuerpo</label>
  <textarea id="tp-body" placeholder="Hola {{1}}, su pedido {{2}} sale hoy con {{3}}. Para entregarlo necesitamos su ubicacion: compartala desde el clip, opcion Ubicacion."></textarea>
  <label>Que es cada variable, una por linea y en orden ({{1}}, {{2}}...)</label>
  <textarea id="tp-vars" placeholder="nombre del cliente&#10;numero de pedido&#10;nombre del negocio" style="min-height:60px"></textarea>
  <div class="actions"><button id="tp-save">Guardar plantilla</button><span id="tp-state" class="pill hidden"></span></div>
  <pre id="tp-out" class="hidden"></pre>

  <h3>Catalogo y plantillas propias</h3>
  <p class="muted">Las del catalogo vienen del codigo (<code>src/templates/catalog.ts</code>); las propias se crean arriba. Todas pasan por el linter antes de subir: un rechazo de Meta cuenta en el historial de la cuenta.</p>
  <div id="t-catalog" class="tablewrap"></div>
  <div class="actions"><button id="t-push">Dar de alta en Meta las que esten limpias</button><span id="t-push-state" class="pill hidden"></span></div>
  <pre id="t-out" class="hidden"></pre>
</section>

<section id="tab-historial" class="card hidden">
  <h2>Historial de envios</h2>
  <p class="muted">Cada intento, salga o no. Los bloqueos son la senal mas util para saber si una lista esta sucia.</p>
  <div class="toolbar">
    <div><label for="h-status">Estado</label>
      <select id="h-status">
        <option value="">Todos</option>
        <option value="queued">En cola</option>
        <option value="sent">Enviados</option>
        <option value="delivered">Entregados</option>
        <option value="read">Leidos</option>
        <option value="failed">Fallidos</option>
        <option value="blocked_by_gate">Bloqueados</option>
      </select></div>
    <div><label for="h-phone">Telefono</label><input id="h-phone" placeholder="51987654321"></div>
    <div><label for="h-campaign">Campana (id)</label><input id="h-campaign" placeholder=""></div>
    <div><button class="ghost" id="h-search">Buscar</button></div>
    <div><button class="ghost" id="h-csv" title="Descarga lo que ves, con los mismos filtros (hasta 5000 filas)">Descargar CSV</button></div>
  </div>
  <div id="h-table" class="tablewrap"></div>
  <div class="pager"><button class="ghost sm" id="h-prev">Anterior</button><span id="h-page"></span><button class="ghost sm" id="h-next">Siguiente</button></div>
</section>

<section id="tab-configuracion" class="card hidden">
  <h2>Configuración general</h2>
  <p class="muted">Lo que se guarda aquí manda sobre la configuración del servidor y se aplica en el siguiente envío, sin reiniciar.
  Un campo vacío significa "lo que diga el servidor" (el valor aparece en gris). Por encima de todo esto sigue el marcapasos del número: si el monitor frena, frena.</p>
  <div class="cf-vigente" id="cf-vigente"></div>

  <h3>Negocio</h3>
  <div class="toolbar">
    <div style="grid-column: span 2"><label for="cf-nombre">Nombre del negocio</label><input id="cf-nombre" placeholder=""><div class="cf-nota">Así se presenta en los mensajes ("{negocio}") y en las pantallas.</div></div>
    <div><label>Zona horaria</label><input id="cf-tz" disabled><div class="cf-nota">La del servidor (TIMEZONE).</div></div>
  </div>

  <h3>Horario de envío</h3>
  <p class="muted">Fuera de esta franja no sale nada iniciado por ti (campañas, reparto, secuencias). Responder a quien escribe no tiene horario.</p>
  <div class="toolbar">
    <div><label for="cf-hora-inicio">Desde (hora)</label><input id="cf-hora-inicio" type="number" min="0" max="23"></div>
    <div><label for="cf-hora-fin">Hasta (hora)</label><input id="cf-hora-fin" type="number" min="1" max="24"></div>
  </div>
  <label>Días</label>
  <div class="dias" id="cf-dias"></div>

  <h3>Ritmo</h3>
  <p class="muted">Cuánto y cada cuánto. Menos es más seguro para el número; el perfil del proveedor pone unos valores razonables por defecto.</p>
  <div class="toolbar">
    <div><label for="cf-r-min">Mensajes por minuto</label><input id="cf-r-min" type="number" min="1" max="60"></div>
    <div><label for="cf-r-hora">Mensajes por hora</label><input id="cf-r-hora" type="number" min="1" max="2000"></div>
    <div><label for="cf-r-pmin">Pausa mínima (s)</label><input id="cf-r-pmin" type="number" min="0" max="600"></div>
    <div><label for="cf-r-pmax">Pausa máxima (s)</label><input id="cf-r-pmax" type="number" min="0" max="900"></div>
    <div><label for="cf-r-nuevos">Contactos nuevos por día</label><input id="cf-r-nuevos" type="number" min="0" max="5000"></div>
    <div><label for="cf-r-contacto">Mensajes por contacto y día</label><input id="cf-r-contacto" type="number" min="1" max="20"></div>
    <div><label for="cf-r-sep">Separación al mismo contacto (min)</label><input id="cf-r-sep" type="number" min="0" max="1440"></div>
  </div>

  <h3>Modo prueba</h3>
  <p class="muted">Con el modo prueba activo, el sistema <b>solo escribe y solo contesta</b> a los números de la lista. Para probar sin molestar a clientes.</p>
  <div id="cf-fijado" class="cf-aviso hidden"></div>
  <label class="inline" style="margin-top:8px"><input type="checkbox" id="cf-mp-activo"> Modo prueba activo</label>
  <label for="cf-mp-numeros">Números permitidos (uno por línea, con código de país)</label>
  <textarea id="cf-mp-numeros" placeholder="51902464984&#10;51912426667"></textarea>

  <h3>Avisos</h3>
  <div class="toolbar">
    <div style="grid-column: span 2"><label for="cf-supervisor">WhatsApp del supervisor</label><input id="cf-supervisor" placeholder="51902464984"><div class="cf-nota">Recibe los cambios de nivel del número y los casos del reparto que necesitan una persona. Vacío = nadie.</div></div>
  </div>

  <h3>Comportamiento</h3>
  <div class="toolbar">
    <div><label for="cf-humanizar">Escritura simulada</label><select id="cf-humanizar"><option value="">Según el servidor</option><option value="true">Sí</option><option value="false">No</option></select></div>
    <div><label for="cf-autopausa">Pausa automática en rojo</label><select id="cf-autopausa"><option value="">Según el servidor</option><option value="true">Sí</option><option value="false">No</option></select></div>
  </div>

  <div class="actions">
    <button id="cf-guardar">Guardar</button>
    <button class="ghost" id="cf-restablecer">Volver a lo del servidor</button>
    <span id="cf-state" class="pill hidden"></span>
  </div>
</section>

<section id="tab-usuarios" class="card hidden">
  <h2>Usuarios</h2>
  <p class="muted">Quien puede entrar al sistema. Un <b>administrador</b> gestiona usuarios y claves de API; un <b>operador</b> hace todo lo demas. Cada uno entra con su usuario y contrasena en <code>/login</code>.
  Los programas (el sistema de GSG) no tienen usuario: entran con una clave de API, ver <a href="/panel#integraciones">Integraciones</a>.</p>
  <div id="us-table" class="tablewrap"></div>

  <h3>Crear usuario</h3>
  <div class="toolbar">
    <div><label>Nombre</label><input id="us-nombre" placeholder="Rosa"></div>
    <div><label>Usuario</label><input id="us-usuario" placeholder="rosa"></div>
    <div><label>Contrasena (8+)</label><input id="us-clave" type="password"></div>
    <div><label>Rol</label><select id="us-rol"><option value="operador">operador</option><option value="admin">admin</option></select></div>
  </div>
  <div class="actions"><button id="us-crear">Crear</button><span id="us-state" class="pill hidden"></span></div>

  <p class="muted" style="margin-top:14px">Tu propia contraseña se cambia en <a href="/panel#mi-cuenta">Mi cuenta</a>.</p>
</section>

<section id="tab-actividad" class="card hidden">
  <h2>Actividad</h2>
  <p class="muted">Cada accion que cambia algo deja una fila: quien entro, quien creo un usuario, quien pauso los envios, quien cargo un lote. Se apunta sola. Sin contraseñas ni claves.</p>
  <div class="toolbar">
    <div><label for="ac-accion">Accion</label><select id="ac-accion"><option value="">Todas</option></select></div>
    <div><label for="ac-usuario">Quien</label><input id="ac-usuario" placeholder="nombre"></div>
    <div><label>&nbsp;</label><button class="ghost" id="ac-buscar">Buscar</button></div>
  </div>
  <div id="ac-table" class="tablewrap"></div>
  <div class="pager"><button class="ghost sm" id="ac-prev">Anterior</button><span id="ac-page"></span><button class="ghost sm" id="ac-next">Siguiente</button></div>
</section>

<section id="tab-mi-cuenta" class="card hidden">
  <h2>Mi cuenta</h2>
  <div class="grid" id="mc-datos" style="margin-top:10px"></div>
  <h3>Cambiar mi contrasena</h3>
  <p class="muted">Al cambiarla, tus otras sesiones abiertas se cierran; esta sigue.</p>
  <div class="toolbar">
    <div><label>Actual</label><input id="mc-actual" type="password" autocomplete="current-password"></div>
    <div><label>Nueva (8+)</label><input id="mc-nueva" type="password" autocomplete="new-password"></div>
    <div><label>Repite la nueva</label><input id="mc-nueva2" type="password" autocomplete="new-password"></div>
    <div><label>&nbsp;</label><button id="mc-cambiar">Cambiar</button></div>
  </div>
  <span id="mc-state" class="pill hidden"></span>
  <h3>Sesion</h3>
  <p class="muted">La sesion dura siete dias sin entrar. Para cerrarla en este navegador, pulsa Salir abajo del menu.</p>
  <div class="actions"><button class="ghost" id="mc-salir">Cerrar sesion</button></div>
</section>

<section id="tab-integraciones" class="card hidden">
  <h2>Claves de API</h2>
  <p class="muted">Con una clave, un programa (el sistema de GSG, un script) entra en la API sin usuario ni contrasena.
  La clave se ve entera <b>una sola vez</b>, al crearla; despues solo su comienzo. Revocarla la apaga al instante.
  Una clave no puede crear usuarios ni otras claves.</p>
  <div id="ck-table" class="tablewrap"></div>

  <h3>Nueva clave</h3>
  <div class="toolbar">
    <div><label>Para quien es</label><input id="ck-nombre" placeholder="Sistema de GSG"></div>
    <div><label>&nbsp;</label><button id="ck-crear">Crear clave</button></div>
  </div>
  <span id="ck-state" class="pill hidden"></span>
  <div id="ck-nueva" class="nueva-clave hidden">
    <b>Copia la clave ahora: no se volvera a mostrar.</b>
    <code id="ck-valor"></code>
    <div class="actions" style="margin-top:8px"><button class="ghost sm" id="ck-copiar">Copiar</button><button class="ghost sm" id="ck-cerrar">Ya la guarde</button></div>
  </div>

  <h3>Como se usa</h3>
  <p class="muted">Cabecera <code>Authorization: Bearer &lt;clave&gt;</code> en cualquier ruta <code>/admin/*</code>. Por ejemplo:</p>
  <pre id="ck-ejemplo"></pre>
  <p class="muted">Para el reparto: <code>POST /admin/rutas/lotes</code> carga la lista del dia, <code>GET /admin/rutas/solicitudes</code> devuelve el avance,
  <code>GET /admin/rutas/cola</code> los reportes pendientes para GSG. El detalle esta en el README, seccion "Conectar el sistema de GSG".</p>
</section>

<section id="tab-extraer" class="card hidden">
  <h2>Extraer latitud y longitud</h2>
  <p class="muted">Pega cualquier enlace de mapa (Google, Waze, Apple, OSM, plus code, DMS o un acortador).</p>
  <label>Enlace o texto</label>
  <textarea id="g-input" placeholder="https://www.google.com/maps/place/.../@-12.0464,-77.0428,17z/data=!3m1!4b1"></textarea>
  <div class="actions"><button id="g-run">Extraer</button><span id="g-state" class="pill hidden"></span></div>
  <pre id="g-out" class="hidden"></pre>
</section>`;

  const script = String.raw`
var SECCIONES = ${JSON.stringify(SECCIONES)};
var TAB_IDS = SECCIONES.map(function (s) { return s[0]; });
var LOADERS = {
  inicio: loadInicio, estado: loadHealth, salud: loadSalud, contactos: loadContacts, ubicaciones: loadLocations, vivo: loadSessions,
  campanas: function () { loadTemplates(); loadCampaigns(); },
  grupos: loadGrupos,
  automatizacion: loadAutomation, plantillas: loadTemplates, historial: loadDeliveries, usuarios: loadUsuarios, integraciones: loadClaves,
  configuracion: loadConfiguracion, 'mi-cuenta': loadMiCuenta, actividad: loadActividad
};
/* Lo que se refresca cada vez que se entra, no solo la primera. */
var SIEMPRE = { inicio: true, estado: true, configuracion: true, actividad: true };
var loaded = {};
var seccionActiva = '';

function activate(id) {
  if (TAB_IDS.indexOf(id) < 0) id = TAB_IDS[0];
  seccionActiva = id;
  TAB_IDS.forEach(function (t) { document.getElementById('tab-' + t).classList.toggle('hidden', t !== id); });
  if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
  var s = SECCIONES.filter(function (x) { return x[0] === id; })[0];
  if (s && window.shellTitulo) shellTitulo(s[1], s[2]);
  if (window.shellMarcarActivo) shellMarcarActivo();
  document.getElementById('s-content').scrollTop = 0;
  if (LOADERS[id] && (!loaded[id] || SIEMPRE[id])) { loaded[id] = true; LOADERS[id](); }
}
window.addEventListener('hashchange', function () { activate(location.hash.slice(1)); });

// --------------------------------------------------------------- inicio
var DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
function kpi(etiqueta, valor, detalle, clase, href) {
  var n = '<div class="n' + (clase ? ' ' + clase : '') + '">' + esc(valor) + '</div>';
  var cuerpo = '<div class="l">' + esc(etiqueta) + '</div>' + n + (detalle ? '<div class="d">' + detalle + '</div>' : '');
  return '<div class="kpi">' + (href ? '<a href="' + esc(href) + '">' + cuerpo + '</a>' : cuerpo) + '</div>';
}
function graficaSemana(semana) {
  var max = 1;
  semana.forEach(function (d) { max = Math.max(max, d.salientes, d.entrantes); });
  var W = 700, H = 190, arriba = 12, abajo = 26, izq = 30, der = 8;
  var alto = H - arriba - abajo, ancho = (W - izq - der) / semana.length;
  var out = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Mensajes por dia">';
  for (var g = 0; g <= 4; g++) {
    var y = arriba + alto - (alto * g / 4);
    out += '<line x1="' + izq + '" x2="' + (W - der) + '" y1="' + y + '" y2="' + y + '" stroke="currentColor" stroke-opacity=".12" />';
    out += '<text x="' + (izq - 6) + '" y="' + (y + 4) + '" font-size="10" text-anchor="end" fill="currentColor" fill-opacity=".55">' + Math.round(max * g / 4) + '</text>';
  }
  semana.forEach(function (d, i) {
    var x0 = izq + i * ancho, bw = Math.max(6, ancho * 0.28);
    var hs = alto * d.salientes / max, he = alto * d.entrantes / max;
    out += '<rect x="' + (x0 + ancho / 2 - bw - 2) + '" y="' + (arriba + alto - hs) + '" width="' + bw + '" height="' + hs + '" rx="3" fill="#128c7e"><title>' + d.dia + ': salieron ' + d.salientes + '</title></rect>';
    out += '<rect x="' + (x0 + ancho / 2 + 2) + '" y="' + (arriba + alto - he) + '" width="' + bw + '" height="' + he + '" rx="3" fill="#94a3b8"><title>' + d.dia + ': entraron ' + d.entrantes + '</title></rect>';
    var f = new Date(d.dia + 'T12:00:00');
    out += '<text x="' + (x0 + ancho / 2) + '" y="' + (H - 8) + '" font-size="11" text-anchor="middle" fill="currentColor" fill-opacity=".7">' + DIAS[f.getDay()] + ' ' + f.getDate() + '</text>';
  });
  return out + '</svg>';
}
function pintarPasos(p) {
  if (!p) return;
  var oficial = p.proveedor === 'cloud';
  var pasos = [
    { hecho: p.conectado, titulo: 'Conectar el WhatsApp', que: oficial ? 'La API de Meta ya responde.' : 'Escanea el QR desde el teléfono.', href: '/setup' },
    { hecho: p.usuarios > 1, titulo: 'Crear las cuentas del equipo', que: 'Una por persona, con su rol.', href: '/panel#usuarios', soloAdmin: true },
    { hecho: p.plantillas > 0, titulo: oficial ? 'Dar de alta las plantillas' : 'Crear plantillas propias (opcional)', que: oficial ? 'Meta tiene que aprobarlas.' : 'Con el QR no hacen falta; ordenan los textos.', href: '/panel#plantillas' },
    { hecho: p.contactos > 0, titulo: 'Cargar contactos con su consentimiento', que: 'Sin opt-in no sale nada iniciado por ti.', href: '/panel#contactos' },
    { hecho: p.lotes > 0, titulo: 'Cargar el primer reparto', que: 'Pega la lista del día y pulsa Empezar a pedir.', href: '/rutas' }
  ];
  var esAdmin = !window.__yo || window.__yo.rol === 'admin';
  pasos = pasos.filter(function (x) { return !x.soloAdmin || esAdmin; });
  var pendientes = pasos.filter(function (x) { return !x.hecho; });
  var card = document.getElementById('in-pasos-card');
  card.classList.toggle('hidden', pendientes.length === 0);
  if (!pendientes.length) return;
  document.getElementById('in-pasos').innerHTML = pasos.map(function (x, i) {
    return '<li class="' + (x.hecho ? 'hecho' : '') + '"><i>' + (x.hecho ? '✓' : (i + 1)) + '</i><div><b>' + (x.hecho ? esc(x.titulo) : '<a href="' + esc(x.href) + '">' + esc(x.titulo) + '</a>') + '</b><small>' + esc(x.que) + '</small></div></li>';
  }).join('');
}
var NIVEL_TXT = { verde: 'Todo en orden', amarillo: 'Con cuidado: el marketing va más lento', naranja: 'Frenado: solo lo imprescindible', rojo: 'Pausado: nada sale hasta que mejore' };
async function loadInicio() {
  try {
    var r = await api('/admin/resumen');
    var h = r.hoy, n = r.numero, c = r.chats, rp = r.reparto;
    var pct = h.cupo ? Math.min(100, Math.round(100 * h.usados / h.cupo)) : 0;
    document.getElementById('in-kpis').innerHTML =
      kpi('Enviados hoy', h.enviados, 'entregados ' + h.entregados + ' · leídos ' + h.leidos, '', '/panel#historial') +
      kpi('Recibidos hoy', h.entrantes, c.sinLeer + ' sin leer', '', '/chat') +
      kpi('Fallidos hoy', h.fallidos, h.fallidos ? 'mira el historial' : 'ninguno', h.fallidos ? 'bad' : 'ok', '/panel#historial') +
      kpi('Cupo de hoy', h.usados + ' / ' + h.cupo, '<div class="barra"><i class="' + (pct > 90 ? 'bad' : pct > 70 ? 'warn' : '') + '" style="width:' + pct + '%"></i></div><span title="Solo lo iniciado por la empresa (plantillas, campañas, reparto) gasta cupo; responder a quien escribe no.">iniciados por ti · warm-up</span>', pct > 90 ? 'warn' : '', '/panel#estado') +
      kpi('Esperan respuesta', c.esperandoRespuesta, 'conversaciones con el cliente al final', c.esperandoRespuesta ? 'warn' : 'ok', '/chat') +
      kpi('Necesitan una persona', rp.requierenPersona, 'solicitudes del reparto', rp.requierenPersona ? 'warn' : 'ok', '/rutas');
    document.getElementById('in-grafica').innerHTML = graficaSemana(r.semana);
    pintarPasos(r.primerosPasos);

    var luz = n.nivel || 'verde';
    var numero = '<div class="semaforo" style="margin-top:8px"><span class="luz ' + esc(luz) + '"></span><div><b>' + esc(luz.charAt(0).toUpperCase() + luz.slice(1)) + '</b><p class="muted">' + esc(NIVEL_TXT[luz] || '') + '</p></div></div>';
    numero += '<div class="grid" style="margin-top:12px">' +
      '<div class="stat"><span class="muted">Conexión</span><b class="' + (n.conectado ? 'ok' : 'bad') + '">' + (n.conectado ? 'conectado' : n.configurado ? 'sin conexión' : 'sin configurar') + '</b></div>' +
      '<div class="stat"><span class="muted">Calidad (Meta)</span><b class="' + qualityKind(n.calidad) + '">' + esc(n.calidad || '-') + '</b></div>' +
      '<div class="stat"><span class="muted">Envíos</span><b class="' + (n.pausado ? 'bad' : 'ok') + '">' + (n.pausado ? 'pausados' : 'activos') + '</b>' + (n.motivoPausa ? '<small>' + esc(n.motivoPausa) + '</small>' : '') + '</div>' +
      '<div class="stat"><span class="muted">Ritmo</span><b>' + Math.round((n.factor || 1) * 100) + '%</b><small>del normal</small></div>' +
      '</div>';
    if (n.motivos && n.motivos.length) numero += '<ul class="motivos">' + n.motivos.slice(0, 4).map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>';
    document.getElementById('in-numero').innerHTML = numero;

    var cifras = rp.cifras || {};
    var orden = ['pendiente', 'enviado', 'respondio', 'resuelto', 'supervision', 'derivado', 'incidencia', 'cancelado'];
    var pills = orden.filter(function (k) { return cifras[k]; }).map(function (k) {
      var kind = k === 'resuelto' || k === 'respondio' ? 'ok' : k === 'supervision' || k === 'derivado' || k === 'incidencia' ? 'warn' : 'muted';
      return pill(kind, k + ' ' + cifras[k]);
    }).join(' ');
    var lotes = (rp.lotesRecientes || []).map(function (l) {
      var hechas = (l.cifras.resuelto || 0) + (l.cifras.cancelado || 0) + (l.cifras.incidencia || 0) + (l.cifras.derivado || 0);
      var p = l.total ? Math.round(100 * hechas / l.total) : 0;
      return '<li><b title="' + esc(l.nombre) + '">' + esc(l.nombre) + '</b>' + pill(statusKind(l.estado), statusLabel(l.estado)) + '<div class="barra"><i style="width:' + p + '%"></i></div><span class="muted">' + hechas + '/' + l.total + '</span></li>';
    }).join('');
    document.getElementById('in-reparto').innerHTML = (pills || '<p class="muted">Todavía no hay solicitudes.</p>') +
      (lotes ? '<ul class="lista">' + lotes + '</ul>' : '') +
      '<div class="actions"><a href="/rutas">Ir al reparto</a>' + (rp.lotesEnMarcha ? ' <span class="pill warn">' + rp.lotesEnMarcha + ' en marcha</span>' : '') + '</div>';
  } catch (error) { show('state', error.message, 'bad'); }
}
setInterval(function () { if (seccionActiva === 'inicio' && !document.hidden) loadInicio(); }, 30000);

// --------------------------------------------------------------- configuracion
var DIAS_NOMBRE = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
var DIAS_ORDEN = [1, 2, 3, 4, 5, 6, 0];
function numOVacio(id) { var v = val(id); return v === '' ? null : Number(v); }
function ponerNum(id, guardado, efectivo) {
  var el = document.getElementById(id);
  el.value = guardado === null || guardado === undefined ? '' : guardado;
  el.placeholder = efectivo === null || efectivo === undefined ? '' : String(efectivo);
}
function pintarVigente(e) {
  var dias = (e.horario.dias || []).slice().sort(function (a, b) { return DIAS_ORDEN.indexOf(a) - DIAS_ORDEN.indexOf(b); }).map(function (d) { return DIAS_NOMBRE[d]; }).join(' ');
  var partes = [
    'Negocio: <b>' + esc(e.nombreNegocio) + '</b>',
    'Horario: <b>' + e.horario.inicio + ':00 – ' + e.horario.fin + ':00</b> ' + esc(dias),
    'Ritmo: <b>' + e.ritmo.maxPorMinuto + '/min · ' + e.ritmo.maxPorHora + '/h</b>, pausas ' + e.ritmo.pausaMinSeg + '–' + e.ritmo.pausaMaxSeg + ' s',
    'Contactos nuevos/día: <b>' + (e.ritmo.nuevosContactosPorDia || 'sin límite') + '</b>',
    e.soloNumeros.length ? 'Modo prueba: <b>' + e.soloNumeros.length + ' número(s)</b>' : 'Modo prueba: <b>apagado</b>',
    e.supervisor ? 'Avisos a <b>' + esc(e.supervisor) + '</b>' : 'Avisos: <b>nadie</b>',
    'Perfil <b>' + esc(e.ritmo.perfil) + '</b>'
  ];
  document.getElementById('cf-vigente').innerHTML = partes.map(function (t) { return '<span>' + t + '</span>'; }).join('');
}
async function loadConfiguracion() {
  try {
    var r = await api('/admin/ajustes');
    var g = r.guardado, e = r.efectivo, sv = r.servidor;
    pintarVigente(e);
    /* el nombre nuevo se ve en el menu sin recargar */
    document.querySelectorAll('.s-logo-text').forEach(function (el) { el.textContent = e.nombreNegocio; });
    document.getElementById('s-app').setAttribute('data-negocio', e.nombreNegocio);
    var nombre = document.getElementById('cf-nombre'); nombre.value = g.nombreNegocio || ''; nombre.placeholder = sv.nombreNegocio;
    document.getElementById('cf-tz').value = e.horario.timezone;
    ponerNum('cf-hora-inicio', g.horario.inicio, e.horario.inicio);
    ponerNum('cf-hora-fin', g.horario.fin, e.horario.fin);
    document.getElementById('cf-dias').innerHTML = DIAS_ORDEN.map(function (d) {
      return '<label><input type="checkbox" data-dia="' + d + '"' + (e.horario.dias.indexOf(d) >= 0 ? ' checked' : '') + '> ' + DIAS_NOMBRE[d] + '</label>';
    }).join('');
    ponerNum('cf-r-min', g.ritmo.maxPorMinuto, e.ritmo.maxPorMinuto);
    ponerNum('cf-r-hora', g.ritmo.maxPorHora, e.ritmo.maxPorHora);
    ponerNum('cf-r-pmin', g.ritmo.pausaMinSeg, e.ritmo.pausaMinSeg);
    ponerNum('cf-r-pmax', g.ritmo.pausaMaxSeg, e.ritmo.pausaMaxSeg);
    ponerNum('cf-r-nuevos', g.ritmo.nuevosContactosPorDia, e.ritmo.nuevosContactosPorDia);
    ponerNum('cf-r-contacto', g.ritmo.maxPorContactoDia, e.ritmo.maxPorContactoDia);
    ponerNum('cf-r-sep', g.ritmo.separacionContactoMin, e.ritmo.separacionContactoMin);
    document.getElementById('cf-mp-activo').checked = g.modoPrueba.activo;
    document.getElementById('cf-mp-numeros').value = g.modoPrueba.numeros.join('\n');
    var fijado = document.getElementById('cf-fijado');
    fijado.classList.toggle('hidden', !r.modoPruebaFijado);
    if (r.modoPruebaFijado) fijado.textContent = 'El servidor arrancó con SOLO_NUMEROS=' + sv.soloNumeros.join(', ') + '. Desde aquí solo puedes recortar esa lista, no ampliarla ni apagar el modo prueba: eso se cambia en el .env y se reinicia.';
    var sup = document.getElementById('cf-supervisor'); sup.value = g.avisos.supervisor || ''; sup.placeholder = sv.supervisor || 'nadie';
    document.getElementById('cf-humanizar').value = g.humanizar === null ? '' : String(g.humanizar);
    document.getElementById('cf-autopausa').value = g.autoPausa === null ? '' : String(g.autoPausa);
    var soyAdmin = !window.__yo || (window.__yo.rol === 'admin' && !window.__yo.porToken);
    document.getElementById('cf-guardar').disabled = !soyAdmin;
    document.getElementById('cf-restablecer').disabled = !soyAdmin;
    if (!soyAdmin) show('cf-state', 'Solo un administrador puede cambiar esto', 'muted');
  } catch (error) { show('cf-state', error.message, 'bad'); }
}
function triestado(id) { var v = val(id); return v === '' ? null : v === 'true'; }
document.getElementById('cf-guardar').onclick = busy('cf-guardar', async function () {
  try {
    var dias = Array.prototype.slice.call(document.querySelectorAll('#cf-dias input')).filter(function (c) { return c.checked; }).map(function (c) { return Number(c.getAttribute('data-dia')); });
    if (!dias.length) throw new Error('Marca al menos un día de envío.');
    var patch = {
      nombreNegocio: val('cf-nombre') || null,
      horario: { inicio: numOVacio('cf-hora-inicio'), fin: numOVacio('cf-hora-fin'), dias: dias },
      ritmo: {
        maxPorMinuto: numOVacio('cf-r-min'), maxPorHora: numOVacio('cf-r-hora'),
        pausaMinSeg: numOVacio('cf-r-pmin'), pausaMaxSeg: numOVacio('cf-r-pmax'),
        nuevosContactosPorDia: numOVacio('cf-r-nuevos'), maxPorContactoDia: numOVacio('cf-r-contacto'),
        separacionContactoMin: numOVacio('cf-r-sep')
      },
      modoPrueba: { activo: document.getElementById('cf-mp-activo').checked, numeros: lines(document.getElementById('cf-mp-numeros').value) },
      avisos: { supervisor: val('cf-supervisor') || null },
      humanizar: triestado('cf-humanizar'),
      autoPausa: triestado('cf-autopausa')
    };
    if (patch.horario.inicio !== null && patch.horario.fin !== null && patch.horario.fin <= patch.horario.inicio) throw new Error('La hora final tiene que ser mayor que la inicial.');
    if (patch.modoPrueba.activo && !patch.modoPrueba.numeros.length) throw new Error('Con el modo prueba activo hace falta al menos un número.');
    await api('/admin/ajustes', { method: 'POST', body: patch });
    show('cf-state', 'Guardado: se aplica en el siguiente envío', 'ok');
    loadConfiguracion();
  } catch (error) { show('cf-state', error.message, 'bad'); }
});
document.getElementById('cf-restablecer').onclick = busy('cf-restablecer', async function () {
  var ok = await confirmarDialogo({ titulo: 'Volver a lo del servidor', texto: 'Se borra todo lo guardado en esta pantalla y vuelve a mandar la configuración del servidor (.env).', boton: 'Restablecer', peligro: true });
  if (!ok) return;
  try { await api('/admin/ajustes', { method: 'DELETE' }); show('cf-state', 'Restablecido', 'ok'); loadConfiguracion(); }
  catch (error) { show('cf-state', error.message, 'bad'); }
});

// --------------------------------------------------------------- grupos
var grOpciones = null, grTelefonos = [], grTotal = 0;
function grCriterio() {
  return {
    consentimiento: val('gr-consent') || 'opt_in',
    reparto: val('gr-reparto') || 'cualquiera',
    loteId: val('gr-lote') || undefined,
    ficha: val('gr-ficha') || 'cualquiera',
    actividad: val('gr-actividad') || 'cualquiera',
    dias: Number(val('gr-dias')) || 7,
    q: val('gr-q') || undefined,
    telefonos: lines(document.getElementById('gr-telefonos').value)
  };
}
function llenarSelect(id, etiquetas) {
  var sel = document.getElementById(id);
  sel.innerHTML = Object.keys(etiquetas).map(function (k) { return '<option value="' + esc(k) + '">' + esc(etiquetas[k]) + '</option>'; }).join('');
}
async function loadGrupos() {
  try {
    grOpciones = await api('/admin/grupos/opciones');
    llenarSelect('gr-reparto', grOpciones.reparto);
    llenarSelect('gr-ficha', grOpciones.ficha);
    llenarSelect('gr-actividad', grOpciones.actividad);
    document.getElementById('gr-lote').innerHTML = '<option value="">Cualquiera</option>' + grOpciones.lotes.map(function (l) { return '<option value="' + esc(l.id) + '">' + esc(l.nombre) + ' (' + l.total + ', ' + esc(l.estado) + ')</option>'; }).join('');
    document.getElementById('gr-plantilla').innerHTML = grOpciones.plantillas.length
      ? grOpciones.plantillas.map(function (t) { return '<option value="' + esc(t.name + '|' + t.language) + '">' + esc(t.name) + (t.propia ? ' (propia)' : '') + ' · ' + t.variables + ' var.</option>'; }).join('')
      : '<option value="">No hay plantillas aprobadas</option>';
    document.getElementById('gr-secuencia').innerHTML = '<option value="">Inscribir en una secuencia…</option>' + grOpciones.secuencias.map(function (q) { return '<option value="' + esc(q.id) + '">' + esc(q.name) + ' (' + q.pasos + ' pasos)</option>'; }).join('');
    var modo = document.getElementById('gr-modo');
    modo.querySelector('option[value="texto"]').disabled = !grOpciones.textoLibre;
    if (!grOpciones.textoLibre) modo.value = 'plantilla';
    grModo();
  } catch (error) { show('gr-state', error.message, 'bad'); }
}
function grModo() {
  var texto = val('gr-modo') === 'texto';
  document.getElementById('gr-texto-wrap').classList.toggle('hidden', !texto);
  document.getElementById('gr-plantilla-wrap').classList.toggle('hidden', texto);
}
document.getElementById('gr-modo').onchange = grModo;
function repartoTexto(r) {
  if (!r) return pill('muted', 'sin solicitud');
  var kind = r.estado === 'resuelto' ? 'ok' : r.estado === 'incidencia' || r.estado === 'derivado' || r.estado === 'supervision' ? 'warn' : 'muted';
  return pill(kind, r.estado) + (r.pedido ? ' <span class="muted">' + esc(r.pedido) + '</span>' : '') + (r.incidencia ? ' <span class="muted">' + esc(r.incidencia) + '</span>' : '');
}
function fichaTexto(f) {
  if (!f) return pill('muted', 'sin ficha');
  if (f.estado === 'enviado') return pill('ok', 'enviada a ventas');
  return f.completa ? pill('ok', 'completa') : pill('warn', 'faltan: ' + f.faltan.join(', '));
}
document.getElementById('gr-ver').onclick = busy('gr-ver', async function () {
  try {
    var r = await api('/admin/grupos/previsualizar', { method: 'POST', body: grCriterio() });
    grTelefonos = r.telefonos; grTotal = r.total;
    var c = r.cifras;
    var chips = ['<span><b>' + r.total + '</b> clientes</span>', '<span>con opt-in <b>' + c.conOptIn + '</b></span>', '<span>escribieron en 24 h <b>' + c.ventanaAbierta + '</b></span>']
      .concat(Object.keys(c.reparto).map(function (k) { return '<span>' + esc(k) + ' <b>' + c.reparto[k] + '</b></span>'; }))
      .concat(Object.keys(c.ficha).map(function (k) { return '<span>ficha ' + esc(k) + ' <b>' + c.ficha[k] + '</b></span>'; }));
    document.getElementById('gr-resumen').innerHTML = chips.join('');
    document.getElementById('gr-table').classList.remove('hidden');
    table('gr-table', ['Cliente', 'Reparto', 'Ficha', 'Último mensaje', 'Opt-in'], r.clientes.map(function (x) {
      return [contactCell(x.phone, x.nombre), repartoTexto(x.reparto), fichaTexto(x.ficha), esc(x.ultimoMensajeAt ? ago(x.ultimoMensajeAt) : 'nunca') + (x.ventanaAbierta ? ' ' + pill('ok', '24 h') : ''), pill(x.optIn ? 'ok' : 'muted', x.optIn ? 'sí' : 'no')];
    }), 'Con esos filtros no hay ningún cliente.');
    show('gr-state', r.total + ' cliente(s)' + (r.total > r.clientes.length ? ' (se muestran ' + r.clientes.length + ')' : ''), r.total ? 'ok' : 'warn');
  } catch (error) { show('gr-state', error.message, 'bad'); }
});
function grEnvio(soloVistaPrevia) {
  var body = { criterio: grCriterio(), soloVistaPrevia: soloVistaPrevia };
  if (val('gr-modo') === 'texto') body.texto = document.getElementById('gr-texto').value.trim();
  else { var p = val('gr-plantilla').split('|'); body.plantilla = { name: p[0], language: p[1] || 'es' }; }
  if (val('gr-nombre')) body.nombre = val('gr-nombre');
  if (val('gr-canario') !== '') body.canario = Number(val('gr-canario'));
  if (val('gr-ritmo') !== '') body.ritmoPorHora = Number(val('gr-ritmo'));
  return body;
}
document.getElementById('gr-previa').onclick = busy('gr-previa', async function () {
  try {
    var r = await api('/admin/grupos/enviar', { method: 'POST', body: grEnvio(true) });
    var out = document.getElementById('gr-previa-out');
    out.innerHTML = '<p class="muted" style="margin-top:10px">Así les llegaría a los primeros de ' + r.total + ':</p>' + r.muestra.map(function (m) {
      return '<div class="res" style="margin-top:8px"><b>' + esc(m.nombre || m.phone) + ' <span class="muted" style="display:inline">' + esc(m.phone) + '</span></b><span style="white-space:pre-wrap">' + esc(m.texto) + '</span></div>';
    }).join('');
    out.classList.remove('hidden');
    show('gr-previa-state', 'Vista previa de ' + r.muestra.length, 'ok');
  } catch (error) { show('gr-previa-state', error.message, 'bad'); }
});
document.getElementById('gr-enviar').onclick = busy('gr-enviar', async function () {
  try {
    var previa = await api('/admin/grupos/enviar', { method: 'POST', body: grEnvio(true) });
    var ok = await confirmarDialogo({ titulo: 'Enviar a ' + previa.total + ' cliente(s)', texto: 'Saldrá por goteo, al ritmo del número y solo en horario. Primero el canario; si cae bien, el resto. Se puede pausar desde Campañas.', boton: 'Enviar' });
    if (!ok) return;
    var r = await api('/admin/grupos/enviar', { method: 'POST', body: grEnvio(false) });
    var out = document.getElementById('gr-out');
    out.innerHTML = '<div class="res ok"><b>Campaña creada: ' + r.enqueued + ' destinatario(s)' + (r.canario ? ', canario de ' + r.canario : '') + '</b><span>Van saliendo por goteo. Míralo en <a href="/panel#campanas">Campañas</a> y cada envío en el <a href="/panel#historial">Historial</a>.</span></div>';
    out.classList.remove('hidden');
    show('gr-state2', 'En marcha', 'ok');
  } catch (error) { show('gr-state2', error.message, 'bad'); }
});
document.getElementById('gr-inscribir').onclick = busy('gr-inscribir', async function () {
  try {
    var id = val('gr-secuencia');
    if (!id) throw new Error('Elige una secuencia.');
    if (!grTelefonos.length) { var r0 = await api('/admin/grupos/previsualizar', { method: 'POST', body: grCriterio() }); grTelefonos = r0.telefonos; grTotal = r0.total; }
    if (!grTelefonos.length) throw new Error('Con esos filtros no hay ningún cliente.');
    var ok = await confirmarDialogo({ titulo: 'Inscribir a ' + grTelefonos.length + ' cliente(s)', texto: 'Cada uno empezará la secuencia desde el primer paso. Quien ya esté dentro no se duplica.', boton: 'Inscribir' });
    if (!ok) return;
    var r = await api('/admin/automation/sequences/' + encodeURIComponent(id) + '/enroll', { method: 'POST', body: { phones: grTelefonos, source: 'grupo' } });
    show('gr-state2', r.enrolled + ' inscrito(s), ' + r.already + ' ya estaban', 'ok');
  } catch (error) { show('gr-state2', error.message, 'bad'); }
});
document.getElementById('gr-csv').onclick = busy('gr-csv', async function () {
  try {
    var res = await fetch('/admin/grupos/exportar', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(grCriterio()) });
    if (!res.ok) throw new Error('No se pudo exportar.');
    var blob = await res.blob();
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'grupo-clientes.csv'; document.body.appendChild(a); a.click(); a.remove();
  } catch (error) { show('gr-state2', error.message, 'bad'); }
});

// --------------------------------------------------------------- actividad
var acOffset = 0, acLimit = 50, acEtiquetas = {};
function detalleTexto(d) {
  if (!d) return '';
  return Object.keys(d).filter(function (k) { return d[k] !== null && d[k] !== undefined && d[k] !== '{...}'; }).map(function (k) { return k + ': ' + d[k]; }).join(' · ');
}
async function loadActividad() {
  try {
    var q = '?limit=' + acLimit + '&offset=' + acOffset + (val('ac-accion') ? '&accion=' + encodeURIComponent(val('ac-accion')) : '') + (val('ac-usuario') ? '&usuario=' + encodeURIComponent(val('ac-usuario')) : '');
    var r = await api('/admin/actividad' + q);
    acEtiquetas = r.etiquetas || {};
    var sel = document.getElementById('ac-accion');
    var actual = sel.value;
    sel.innerHTML = '<option value="">Todas</option>' + (r.acciones || []).map(function (a) { return '<option value="' + esc(a) + '">' + esc(acEtiquetas[a] || a) + '</option>'; }).join('');
    sel.value = actual;
    table('ac-table', ['Cuando', 'Quien', 'Que', 'Detalle', 'IP'], r.items.map(function (e) {
      var kind = /fallido|borrar|revocar|baja/.test(e.accion) ? 'bad' : /pausa|restablecer|derivar/.test(e.accion) ? 'warn' : 'muted';
      return ['<span style="white-space:nowrap">' + esc(fmt(e.at)) + '</span><span class="muted">' + esc(ago(e.at)) + '</span>', esc(e.usuario), pill(kind, acEtiquetas[e.accion] || e.accion), '<span class="muted" style="display:inline">' + esc(detalleTexto(e.detalle)) + '</span>', esc(e.ip || '')];
    }), 'Todavía no hay actividad registrada.');
    var desde = r.total ? acOffset + 1 : 0;
    document.getElementById('ac-page').textContent = desde + '–' + Math.min(acOffset + acLimit, r.total) + ' de ' + r.total;
    document.getElementById('ac-prev').disabled = acOffset === 0;
    document.getElementById('ac-next').disabled = acOffset + acLimit >= r.total;
  } catch (error) {
    document.getElementById('ac-table').innerHTML = '<div class="empty">' + esc(error.message) + '</div>';
  }
}
document.getElementById('ac-buscar').onclick = function () { acOffset = 0; loadActividad(); };
document.getElementById('ac-accion').onchange = function () { acOffset = 0; loadActividad(); };
document.getElementById('ac-prev').onclick = function () { acOffset = Math.max(0, acOffset - acLimit); loadActividad(); };
document.getElementById('ac-next').onclick = function () { acOffset += acLimit; loadActividad(); };

// --------------------------------------------------------------- integraciones
async function loadClaves() {
  document.getElementById('ck-ejemplo').textContent = 'curl -H "authorization: Bearer wak_..." ' + location.origin + '/admin/health';
  try {
    var list = await api('/admin/claves-api');
    table('ck-table', ['Para', 'Clave', 'Creada', 'Último uso', 'Estado', ''], list.map(function (k) {
      return [esc(k.nombre), '<code>' + esc(k.prefijo) + '</code>', esc(fmt(k.createdAt)), esc(fmt(k.ultimoUsoAt) || 'nunca'),
        pill(k.revocadaAt ? 'bad' : 'ok', k.revocadaAt ? 'revocada' : 'activa'),
        k.revocadaAt ? '' : '<button class="danger sm" data-ck-revocar="' + esc(k.id) + '">Revocar</button>'];
    }), 'Todavía no hay claves. Crea una para el sistema de GSG.');
    document.querySelectorAll('[data-ck-revocar]').forEach(function (b) {
      b.onclick = async function () {
        var ok = await confirmarDialogo({ titulo: 'Revocar la clave', texto: 'El programa que la use dejará de entrar en el acto. No se puede deshacer.', boton: 'Revocar', peligro: true });
        if (!ok) return;
        try { await api('/admin/claves-api/' + b.getAttribute('data-ck-revocar'), { method: 'DELETE' }); loadClaves(); }
        catch (error) { show('ck-state', error.message, 'bad'); }
      };
    });
  } catch (error) {
    document.getElementById('ck-table').innerHTML = '<div class="empty">' + esc(error.message) + '</div>';
    document.getElementById('ck-crear').disabled = true;
  }
}
document.getElementById('ck-crear').onclick = busy('ck-crear', async function () {
  try {
    var r = await api('/admin/claves-api', { method: 'POST', body: { nombre: val('ck-nombre') } });
    document.getElementById('ck-valor').textContent = r.clave;
    document.getElementById('ck-nueva').classList.remove('hidden');
    setVal('ck-nombre', '');
    show('ck-state', 'Clave creada', 'ok');
    loadClaves();
  } catch (error) { show('ck-state', error.message, 'bad'); }
});
document.getElementById('ck-copiar').onclick = function () {
  var v = document.getElementById('ck-valor').textContent;
  navigator.clipboard.writeText(v).then(function () { show('ck-state', 'Copiada', 'ok'); });
};
document.getElementById('ck-cerrar').onclick = function () {
  document.getElementById('ck-valor').textContent = '';
  document.getElementById('ck-nueva').classList.add('hidden');
};

function out(id, data) {
  var el = document.getElementById(id);
  el.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  el.classList.remove('hidden');
}
/* Por que no salio un mensaje, dicho para una persona, y a donde ir a arreglarlo. */
var PORQUE = {
  allowlist: ['Modo prueba activo: solo se escribe a los números de la lista.', 'Cambiar la lista o apagar el modo prueba', '/panel#configuracion'],
  sin_conexion: ['WhatsApp no está conectado. En cuanto vuelva la sesión se reintenta solo.', 'Ver la conexión', '/setup'],
  opt_out: ['El contacto se dio de baja: no se le vuelve a escribir. Solo si él escribe primero.', 'Ver el contacto', '/panel#contactos'],
  no_opt_in: ['El contacto no tiene consentimiento registrado: nada iniciado por ti puede salir.', 'Registrar el consentimiento', '/panel#contactos'],
  number_paused: ['Los envíos están pausados a mano.', 'Reanudar en Estado', '/panel#estado'],
  number_quality: ['La calidad del número en Meta está baja: se frena para protegerlo.', 'Ver la salud del número', '/panel#salud'],
  window_closed: ['Hace más de 24 h que el cliente no escribe: por la API de Meta solo puede salir una plantilla.', 'Enviar una plantilla', '/panel#campanas'],
  template_missing: ['Esa plantilla no está en el registro.', 'Ver las plantillas', '/panel#plantillas'],
  template_not_approved: ['Meta todavía no aprobó esa plantilla.', 'Ver las plantillas', '/panel#plantillas'],
  template_quality: ['La calidad de esa plantilla está baja: mejor otra.', 'Ver las plantillas', '/panel#plantillas'],
  template_paused: ['Meta tiene esa plantilla pausada unas horas.', 'Ver las plantillas', '/panel#plantillas'],
  frequency_cap: ['Ese contacto ya recibió bastante marketing esta semana.', 'Ver riesgo y ritmo', '/panel#salud'],
  daily_cap: ['Se alcanzó el cupo de hoy: mañana sigue solo.', 'Ver el cupo', '/panel#estado'],
  contact_suppressed: ['El contacto está apartado un tiempo (número sin WhatsApp o Meta pidió no insistir).', 'Levantar la supresión', '/panel#salud'],
  risk_marketing_paused: ['El monitor de salud tiene el marketing en pausa por el riesgo del número.', 'Ver por qué', '/panel#salud'],
  fatigue: ['Lleva varios mensajes seguidos sin contestar: descansa del marketing hasta que escriba.', 'Ver riesgo y ritmo', '/panel#salud'],
  contact_daily_cap: ['Ya recibió hoy el máximo de mensajes por contacto.', 'Cambiar el máximo', '/panel#configuracion'],
  contact_spacing: ['Hace poco que se le escribió: se respeta la separación mínima y se reintenta solo.', 'Cambiar la separación', '/panel#configuracion'],
  rhythm: ['El marcapasos del número lo frena ahora mismo (horario, cupo por hora o pausa): se reintenta solo.', 'Ver el ritmo', '/panel#configuracion']
};
function resultado(id, data, que) {
  var el = document.getElementById(id);
  var html = '';
  if (data && data.ok) {
    html = '<div class="res ok"><b>' + esc(que || 'Enviado') + '</b>' + (data.wamid ? '<span class="muted">id de WhatsApp ' + esc(data.wamid) + '</span>' : '') + (data.deliveryId ? '<span class="muted">registro nº ' + esc(data.deliveryId) + ' en el historial</span>' : '') + '</div>';
  } else if (data && data.blocked) {
    var p = PORQUE[data.code] || [data.reason || 'No salió.', 'Ver el historial', '/panel#historial'];
    html = '<div class="res warn"><b>No salió</b><span>' + esc(p[0]) + '</span>' + (data.reason && !PORQUE[data.code] ? '' : '<span class="muted">' + esc(data.reason || '') + '</span>') + (data.retryAfterMs ? '<span class="muted">Se reintenta en unos ' + Math.max(1, Math.round(data.retryAfterMs / 60000)) + ' min.</span>' : '') + '<a href="' + esc(p[2]) + '">' + esc(p[1]) + ' →</a></div>';
  } else {
    html = '<div class="res bad"><b>Falló</b><span>' + esc((data && (data.error || data.reason)) || 'Error desconocido.') + '</span><a href="/panel#historial">Ver el historial →</a></div>';
  }
  html += '<details class="tecnico"><summary>Detalles técnicos</summary><pre>' + esc(JSON.stringify(data, null, 2)) + '</pre></details>';
  el.innerHTML = html;
  el.classList.remove('hidden');
}
function busy(id, fn) {
  return async function () {
    var b = document.getElementById(id); b.disabled = true;
    try { await fn(); } finally { b.disabled = false; }
  };
}
function qualityKind(q) { return q === 'GREEN' ? 'ok' : q === 'YELLOW' ? 'warn' : 'bad'; }
function statusKind(s) {
  if (s === 'sent' || s === 'delivered' || s === 'read' || s === 'APPROVED' || s === 'active' || s === 'completed' || s === 'finished') return 'ok';
  if (s === 'queued' || s === 'pending' || s === 'PENDING' || s === 'running' || s === 'processing' || s === 'canary' || s === 'paused') return 'warn';
  if (s === 'failed' || s === 'blocked_by_gate' || s === 'blocked' || s === 'REJECTED' || s === 'DISABLED' || s === 'PAUSED' || s === 'stopped') return 'bad';
  return 'muted';
}
function statusLabel(s) {
  return ({ queued: 'en cola', sent: 'enviado', delivered: 'entregado', read: 'leido', failed: 'fallido',
    blocked_by_gate: 'bloqueado', pending: 'pendiente', processing: 'procesando', blocked: 'bloqueado',
    cancelled: 'cancelado', active: 'activa', completed: 'completada', running: 'en curso', finished: 'terminada',
    draft: 'borrador', empty: 'sin destinatarios', canary: 'canario', paused: 'pausada', stopped: 'parada' })[s] || s;
}
function contactCell(phone, name) {
  return '<b>' + esc(phone) + '</b>' + (name ? '<span class="muted">' + esc(name) + '</span>' : '');
}

// ---------------------------------------------------------------- estado
async function loadHealth() {
  try {
    var h = await api('/admin/health');
    var n = h.number;
    document.getElementById('stats').innerHTML =
      '<div class="stat"><span class="muted">Calidad</span><b class="' + qualityKind(n.quality) + '">' + esc(n.quality) + '</b><span class="muted">' + esc(n.tier || 'tier desconocido') + '</span></div>' +
      '<div class="stat"><span class="muted">Estado</span><b>' + (n.paused ? 'PAUSADO' : 'activo') + '</b><span class="muted">' + esc(n.pausedReason || '') + '</span></div>' +
      '<div class="stat"><span class="muted">Enviados hoy</span><b>' + h.sentToday + ' / ' + h.dailyCap + '</b><span class="muted">cupo de warm-up</span></div>' +
      '<div class="stat"><span class="muted">En cola</span><b>' + ((h.queue.waiting || 0) + (h.queue.delayed || 0)) + '</b><span class="muted">' + (h.queue.failed || 0) + ' fallidos</span></div>' +
      '<div class="stat"><span class="muted">WhatsApp</span><b class="' + (h.configured ? 'ok' : 'warn') + '">' + (h.configured ? 'conectado' : 'sin conectar') + '</b><span class="muted">' + esc((h.missing || []).join(', ')) + '</span></div>' +
      (h.salud ? '<div class="stat"><span class="muted">Salud</span><b class="' + nivelKind(h.salud.nivel) + '">' + esc(h.salud.nivel) + '</b><span class="muted">velocidad al ' + Math.round((h.salud.factor || 0) * 100) + ' % - <a href="#salud">ver por que</a></span></div>' : '');
    show('state', n.paused ? 'Envios pausados' : 'Operativo', n.paused ? 'warn' : 'ok');
  } catch (error) { show('state', error.message, 'bad'); }
}
document.getElementById('refresh').onclick = loadHealth;
document.getElementById('numsync').onclick = busy('numsync', async function () {
  try {
    var r = await api('/admin/number/sync', { method: 'POST' });
    show('num-state', 'Meta reporta ' + r.info.qualityRating + (r.info.messagingLimitTier ? ' / ' + r.info.messagingLimitTier : ''), qualityKind(r.info.qualityRating));
    loadHealth();
  } catch (error) { show('num-state', error.message, 'bad'); }
});
document.getElementById('pause').onclick = async function () {
  try { await api('/admin/pause', { method: 'POST', body: { paused: true, reason: 'pausa manual' } }); loadHealth(); }
  catch (error) { show('num-state', error.message, 'bad'); }
};
document.getElementById('resume').onclick = async function () {
  try { await api('/admin/pause', { method: 'POST', body: { paused: false } }); loadHealth(); }
  catch (error) { show('num-state', error.message, 'bad'); }
};

// ----------------------------------------------------------------- salud
function nivelKind(n) { return n === 'verde' ? 'ok' : n === 'amarillo' ? 'warn' : 'bad'; }
function pct(a, b) { return b ? Math.round((a / b) * 100) + ' %' : '-'; }
function minutos(ms) { if (ms == null) return '-'; var m = Math.round(ms / 60000); return m < 1 ? 'menos de 1 min' : m < 120 ? m + ' min' : Math.round(m / 60) + ' h'; }
function hastaCuando(iso) { if (!iso) return ''; var d = new Date(iso); return d.toLocaleString('es-PE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }); }
async function loadSalud() {
  try {
    var s = await api('/admin/salud');
    var luz = document.querySelector('#sl-semaforo .luz');
    luz.className = 'luz ' + s.nivel;
    var titulo = { verde: 'Verde: ritmo normal', amarillo: 'Amarillo: a la mitad de velocidad', naranja: 'Naranja: a un quinto y sin marketing', rojo: 'Rojo: envios en pausa' }[s.nivel] || s.nivel;
    document.getElementById('sl-nivel').textContent = titulo + ' (' + s.puntos + ' puntos)';
    var sub = 'Velocidad efectiva al ' + Math.round(s.factor * 100) + ' %.';
    if (s.pausadaHasta) sub += ' Pausado solo hasta las ' + hastaCuando(s.pausadaHasta) + '; despues vuelve despacio.';
    else if (s.numero && s.numero.paused) sub += ' Pausado: ' + (s.numero.pausedReason || 'a mano') + '.';
    if (s.rampaDesde) sub += ' En rampa de vuelta hasta las ' + hastaCuando(s.rampaHasta) + '.';
    if (s.ultimaEvaluacion) sub += ' Evaluado a las ' + hastaCuando(s.ultimaEvaluacion) + '.';
    document.getElementById('sl-sub').textContent = sub;
    document.getElementById('sl-motivos').innerHTML = (s.motivos || []).length
      ? s.motivos.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('')
      : '<li class="muted">Sin senales de riesgo.</li>';

    var n = s.numero || {};
    var r = s.ritmo || {};
    document.getElementById('sl-stats').innerHTML =
      '<div class="stat"><span class="muted">Meta dice</span><b class="' + qualityKind(n.quality) + '">' + esc(n.quality || '-') + '</b><small>' + esc(n.estado || '') + (n.tier ? ' - ' + esc(n.tier) : '') + '</small></div>' +
      '<div class="stat"><span class="muted">Hoy</span><b>' + r.hoy + ' / ' + r.cupoHoy + '</b><small>cupo de warm-up</small><div class="barra"><i class="' + (r.hoy >= r.cupoHoy ? 'bad' : '') + '" style="width:' + Math.min(100, Math.round((r.hoy / Math.max(1, r.cupoHoy)) * 100)) + '%"></i></div></div>' +
      '<div class="stat"><span class="muted">Ultima hora</span><b>' + r.ultimaHora + ' / ' + Math.max(1, Math.floor((s.politica.maxPorHora || 0) * s.factor)) + '</b><small>' + r.ultimoMinuto + ' en el ultimo minuto</small></div>' +
      '<div class="stat"><span class="muted">Destinatarios 24 h</span><b>' + r.destinatariosUnicos24h + (r.limiteTier ? ' / ' + (isFinite(r.limiteTier) ? r.limiteTier : 'sin limite') : '') + '</b><small>' + (r.limiteTier ? 'tier de Meta, se para al ' + Math.round(s.politica.fraccionTier * 100) + ' %' : s.politica.perfil === 'cloud' ? 'Meta no ha dicho el tier: sincroniza en Estado' : 'sin tier (cliente no oficial)') + '</small></div>' +
      '<div class="stat"><span class="muted">Contactos nuevos hoy</span><b>' + r.nuevosContactosHoy + (s.politica.nuevosContactosPorDia ? ' / ' + s.politica.nuevosContactosPorDia : '') + '</b><small>' + (s.politica.nuevosContactosPorDia ? 'cupo del perfil' : 'sin cupo en este perfil') + '</small></div>' +
      '<div class="stat"><span class="muted">Proximo envio</span><b>' + (r.enHorario ? (r.proximoEnvioMs > 0 ? Math.ceil(r.proximoEnvioMs / 1000) + ' s' : 'ya') : 'fuera de horario') + '</b><small>' + s.politica.horaInicio + ':00 a ' + s.politica.horaFin + ':00</small></div>' +
      '<div class="stat"><span class="muted">Apartados</span><b>' + s.contactosSuprimidos + '</b><small>contactos con supresion vigente</small></div>';

    var p = s.politica;
    document.getElementById('sl-politica').textContent =
      'Perfil ' + p.perfil + ': hasta ' + p.maxPorMinuto + ' por minuto y ' + p.maxPorHora + ' por hora, pausa de ' + Math.round(p.pausaMinMs / 1000) + ' a ' + Math.round(p.pausaMaxMs / 1000) + ' s entre envios, ' +
      'como mucho ' + p.maxPorContactoDia + ' al mismo contacto por dia y ' + Math.round(p.separacionContactoMs / 60000) + ' min entre dos. Warm-up desde ' + p.warmup.startPerDay + '/dia (x' + p.warmup.growth + ' cada dia, tope ' + p.warmup.hardCap + '). ' +
      'Marketing descansa tras ' + p.fatigaEnvios + ' mensajes sin respuesta. En rojo se pausa ' + Math.round(p.pausaRojaMin / 60) + ' h y se vuelve en rampa de ' + Math.round(p.rampaMin / 60) + ' h.' + (p.humanizar ? ' Escritura simulada.' : '') +
      (p.avisarA ? ' Avisos a ' + p.avisarA + '.' : ' Sin numero al que avisar (RUTAS_SUPERVISOR).');
    document.getElementById('sl-ritmo').innerHTML =
      '<div class="stat"><span class="muted">Fallos tolerados</span><b>' + p.umbrales.maxFallosPct + ' %</b><small>de los ultimos 50</small></div>' +
      '<div class="stat"><span class="muted">Sin WhatsApp</span><b>' + p.umbrales.maxSinWhatsappPct + ' %</b><small>lista sucia a partir de ahi</small></div>' +
      '<div class="stat"><span class="muted">Bajas</span><b>' + p.umbrales.maxBajasPct + ' %</b><small>en 24 h</small></div>' +
      '<div class="stat"><span class="muted">Entrega minima</span><b>' + p.umbrales.minEntregaPct + ' %</b><small>de lo enviado hace mas de 1 h</small></div>';

    var v = s.ventanas || {};
    var u = v.ultimos50 || {}, d = v.dia || {}, h = v.hora || {};
    var codigos = function (pc) { var k = Object.keys(pc || {}); return k.length ? k.map(function (c) { return c + ' x' + pc[c]; }).join(', ') : '-'; };
    table('sl-ventanas', ['Ventana', 'Enviados', 'Entregados', 'Fallidos', 'Codigos', 'Bajas', 'Entrantes', 'Quejas', 'Desconexiones'], [
      ['Ultimos 50', String(u.enviados || 0), '-', String(u.fallidos || 0), codigos(u.porCodigo), '-', '-', '-', '-'],
      ['24 h', String(d.enviados || 0), (d.entregados || 0) + ' (' + pct(d.entregadosMaduros, d.enviadosMaduros) + ' de lo maduro)', '-', codigos(d.porCodigo), String(d.bajas || 0), String(d.entrantes || 0), String(d.quejas || 0), '-'],
      ['1 h', '-', '-', String(h.fallidos || 0), codigos(h.porCodigo), '-', '-', '-', String(h.desconexiones || 0)]
    ], 'Sin datos');

    table('sl-plantillas', ['Plantilla', 'Estado', 'Calidad', 'Pausada hasta', 'Pausas'], (s.plantillas || []).map(function (t) {
      var pausada = t.pausadaHasta && new Date(t.pausadaHasta) > new Date();
      return [esc(t.name), pill(statusKind(t.status), t.status), t.quality ? pill(qualityKind(t.quality), t.quality) : '<span class="muted">-</span>',
        pausada ? pill('warn', hastaCuando(t.pausadaHasta)) : '<span class="muted">-</span>', String(t.pausas || 0) + (t.pausas >= 2 ? ' (la proxima la deshabilita)' : '')];
    }), 'Sin plantillas en el registro');

    table('sl-eventos', ['Cuando', 'Tipo', 'Codigo', 'Detalle'], (s.eventos || []).map(function (e) {
      return [esc(fmt(e.at)), esc(e.tipo), e.codigo ? '<code>' + esc(e.codigo) + '</code>' : '-', '<span class="muted">' + esc(e.detalle || '') + '</span>'];
    }), 'Todavia no hay senales: eso es buena senal');
  } catch (error) { show('sl-state', error.message, 'bad'); }
}
document.getElementById('sl-refresh').onclick = loadSalud;
document.getElementById('sl-evaluar').onclick = busy('sl-evaluar', async function () {
  try { var r = await api('/admin/salud/evaluar', { method: 'POST' }); show('sl-state', 'Recalculado: ' + r.riesgo.nivel, nivelKind(r.riesgo.nivel)); loadSalud(); loadHealth(); }
  catch (error) { show('sl-state', error.message, 'bad'); }
});
document.getElementById('sl-reanudar').onclick = busy('sl-reanudar', async function () {
  try { await api('/admin/salud/reanudar', { method: 'POST', body: { motivo: 'desde el panel' } }); show('sl-state', 'Reanudado: vuelve despacio (rampa)', 'ok'); loadSalud(); loadHealth(); }
  catch (error) { show('sl-state', error.message, 'bad'); }
});
document.getElementById('sl-levantar').onclick = busy('sl-levantar', async function () {
  try { await api('/admin/salud/contactos/levantar', { method: 'POST', body: { phone: val('sl-levantar-phone') } }); show('sl-state', 'Supresion levantada', 'ok'); loadSalud(); }
  catch (error) { show('sl-state', error.message, 'bad'); }
});

// ---------------------------------------------------------------- enviar
document.getElementById('m-send').onclick = async function () {
  try {
    var data = await api('/admin/messages/text', { method: 'POST', body: { phone: val('m-phone'), text: document.getElementById('m-text').value } });
    show('m-state', data.ok ? 'Enviado' : 'No salió', data.ok ? 'ok' : 'warn');
    resultado('m-out', data, 'Mensaje enviado');
  } catch (error) { show('m-state', error.message, 'bad'); }
};
document.getElementById('u-send').onclick = async function () {
  try {
    var data = await api('/admin/messages/location', { method: 'POST', body: { phone: val('u-phone'), input: val('u-input'), name: val('u-name') || undefined } });
    show('u-state', data.ok ? 'Enviado' : 'No salió', data.ok ? 'ok' : 'warn');
    resultado('u-out', data, 'Pin enviado');
  } catch (error) { show('u-state', error.message, 'bad'); }
};
document.getElementById('u-ask').onclick = async function () {
  try {
    var data = await api('/admin/messages/ask-location', { method: 'POST', body: { phone: val('u-phone') } });
    show('u-state', data.ok ? 'Solicitud enviada' : 'No salió', data.ok ? 'ok' : 'warn');
    resultado('u-out', data, 'Solicitud de ubicación enviada');
  } catch (error) { show('u-state', error.message, 'bad'); }
};

// ------------------------------------------------------------- contactos
var ctOffset = 0, CT_LIMIT = 50;
function contactState(c) {
  if (c.optOutAt) return pill('bad', 'baja');
  if (c.optInAt) return pill('ok', 'opt-in');
  return pill('muted', 'sin consentimiento');
}
document.getElementById('ct-csv').onclick = function () {
  location.href = '/admin/contacts.csv?state=' + encodeURIComponent(val('ct-state') || 'all') + '&q=' + encodeURIComponent(val('ct-q'));
};
async function loadContacts() {
  try {
    var q = '/admin/contacts?limit=' + CT_LIMIT + '&offset=' + ctOffset + '&state=' + encodeURIComponent(val('ct-state') || 'all') + '&q=' + encodeURIComponent(val('ct-q'));
    var data = await api(q);
    table('ct-table', ['Contacto', 'Estado', 'Origen', 'Ultimo mensaje', 'Ultima ubicacion', ''], data.items.map(function (c) {
      return [
        contactCell(c.phone, c.name),
        contactState(c),
        esc(c.optInSource || ''),
        c.lastInboundAt ? esc(ago(c.lastInboundAt)) + '<span class="muted">' + esc(fmt(c.lastInboundAt)) + '</span>' : '<span class="muted">nunca</span>',
        c.lastLocation ? mapsLink(c.lastLocation.lat, c.lastLocation.lng) + '<span class="muted">' + esc(ago(c.lastLocation.at)) + '</span>' : '',
        (c.optOutAt ? '' : '<button class="danger sm" data-optout="' + esc(c.phone) + '">Baja</button> ') +
        (c.optInAt && !c.optOutAt ? '' : '<button class="ghost sm" data-optin="' + esc(c.phone) + '">Alta</button>')
      ];
    }), 'Sin contactos');
    document.getElementById('ct-page').textContent = (data.total ? (ctOffset + 1) + '-' + Math.min(ctOffset + CT_LIMIT, data.total) + ' de ' + data.total : '0');
    document.getElementById('ct-prev').disabled = ctOffset === 0;
    document.getElementById('ct-next').disabled = ctOffset + CT_LIMIT >= data.total;
    document.querySelectorAll('[data-optout]').forEach(function (b) {
      b.onclick = async function () {
        try { await api('/admin/contacts/opt-out', { method: 'POST', body: { phone: b.getAttribute('data-optout') } }); loadContacts(); }
        catch (error) { show('ct-state-msg', error.message, 'bad'); }
      };
    });
    document.querySelectorAll('[data-optin]').forEach(function (b) {
      b.onclick = async function () {
        var source = await pedirDato({
          titulo: 'Origen del consentimiento',
          texto: 'Queda guardado con el contacto: es la prueba de que aceptó recibir mensajes.',
          etiqueta: '¿De dónde salió el consentimiento?',
          valor: 'panel',
          marcador: 'formulario web, compra en tienda, llamada...',
          boton: 'Guardar consentimiento'
        });
        if (!source) return;
        try { await api('/admin/contacts/opt-in', { method: 'POST', body: { phone: b.getAttribute('data-optin'), source: source } }); loadContacts(); }
        catch (error) { show('ct-state-msg', error.message, 'bad'); }
      };
    });
  } catch (error) { show('ct-state-msg', error.message, 'bad'); }
}
document.getElementById('ct-search').onclick = function () { ctOffset = 0; loadContacts(); };
document.getElementById('ct-q').onkeydown = function (e) { if (e.key === 'Enter') { ctOffset = 0; loadContacts(); } };
document.getElementById('ct-prev').onclick = function () { ctOffset = Math.max(0, ctOffset - CT_LIMIT); loadContacts(); };
document.getElementById('ct-next').onclick = function () { ctOffset += CT_LIMIT; loadContacts(); };
document.getElementById('ct-do-import').onclick = busy('ct-do-import', async function () {
  try {
    var data = await api('/admin/contacts/import', { method: 'POST', body: { source: val('ct-source') || 'importacion desde el panel', text: document.getElementById('ct-import').value } });
    show('ct-state-msg', 'Importados ' + data.imported + ' de ' + data.received, 'ok');
    document.getElementById('ct-import').value = '';
    ctOffset = 0; loadContacts();
  } catch (error) { show('ct-state-msg', error.message, 'bad'); }
});

// ----------------------------------------------------------- ubicaciones
async function loadLocations() {
  try {
    var phone = val('lc-phone');
    var list = await api('/admin/locations?limit=100' + (phone ? '&phone=' + encodeURIComponent(phone) : ''));
    table('lc-table', ['Fecha', 'Contacto', 'Coordenadas', 'Origen', 'Confianza', 'Precision', 'Confirmada', 'Entrada'], list.map(function (l) {
      return [
        esc(fmt(l.createdAt)),
        contactCell(l.phone, l.name),
        mapsLink(l.lat, l.lng),
        esc(l.source),
        pill(l.confidence === 'exact' || l.confidence === 'high' ? 'ok' : l.confidence === 'medium' ? 'warn' : 'bad', l.confidence),
        '~' + Math.round(l.precisionMeters) + ' m',
        l.confirmed ? pill('ok', 'si') : pill('warn', 'pendiente'),
        '<span class="muted" title="' + esc(l.rawInput || '') + '">' + esc((l.rawInput || '').slice(0, 60)) + ((l.rawInput || '').length > 60 ? '...' : '') + '</span>'
      ];
    }), 'Todavia no llego ninguna ubicacion');
  } catch (error) { show('state', error.message, 'bad'); }
}
document.getElementById('lc-search').onclick = loadLocations;

// ----------------------------------------------------------------- vivo
document.getElementById('v-create').onclick = async function () {
  try {
    var phone = val('v-phone');
    var data = await api('/admin/tracking', { method: 'POST', body: {
      phone: phone || undefined,
      label: val('v-label') || undefined,
      ttlMinutes: Number(val('v-ttl')) || undefined,
      notify: document.getElementById('v-notify').checked
    }});
    setVal('v-pub', data.publishUrl);
    setVal('v-view', data.viewUrl);
    document.getElementById('v-links').classList.remove('hidden');
    var notified = data.notified ? (data.notified.ok ? ' y enviada por WhatsApp' : ' (el aviso no salio: ' + (data.notified.reason || data.notified.error) + ')') : '';
    show('v-state', 'Sesion creada' + notified, data.notified && !data.notified.ok ? 'warn' : 'ok');
    copyButtons();
    loadSessions();
  } catch (error) { show('v-state', error.message, 'bad'); }
};
async function loadSessions() {
  try {
    var list = await api('/admin/tracking');
    table('v-table', ['Etiqueta', 'Contacto', 'Caduca', 'Puntos', 'Ultima posicion', 'Mirando', 'Enlaces', ''], list.map(function (s, i) {
      return [
        esc(s.label || ''),
        s.phone ? contactCell(s.phone, s.name) : '<span class="muted">sin contacto</span>',
        esc(fmt(s.expiresAt)),
        String(s.pointCount),
        s.lastPoint ? mapsLink(s.lastPoint.lat, s.lastPoint.lng) + '<span class="muted">' + esc(ago(s.lastPoint.at)) + '</span>' : '<span class="muted">aun nada</span>',
        String(s.viewers),
        '<input id="vs-pub-' + i + '" class="hidden" value="' + esc(s.publishUrl) + '"><input id="vs-view-' + i + '" class="hidden" value="' + esc(s.viewUrl) + '">' +
          '<button class="ghost sm" data-copy="vs-pub-' + i + '">Copiar</button> <span class="muted">compartir</span><br>' +
          '<button class="ghost sm" data-copy="vs-view-' + i + '">Copiar</button> <span class="muted">ver</span>',
        '<button class="danger sm" data-revoke="' + esc(s.id) + '">Revocar</button>'
      ];
    }), 'No hay sesiones activas');
    copyButtons();
    document.querySelectorAll('[data-revoke]').forEach(function (b) {
      b.onclick = async function () {
        try { await api('/admin/tracking/' + b.getAttribute('data-revoke'), { method: 'DELETE' }); loadSessions(); }
        catch (error) { show('v-state', error.message, 'bad'); }
      };
    });
  } catch (error) { show('v-state', error.message, 'bad'); }
}
document.getElementById('v-refresh').onclick = loadSessions;

// -------------------------------------------------------------- campanas
var templatesCache = [];
function templateOptions(select, onlyApproved) {
  select.innerHTML = templatesCache.map(function (t) {
    return '<option value="' + esc(t.name + '|' + t.language + '|' + t.category) + '"' +
      (onlyApproved && t.status !== 'APPROVED' ? ' disabled' : '') + '>' +
      esc(t.name + ' (' + t.category + ', ' + t.status + ', ' + t.variables + ' vars)') + '</option>';
  }).join('');
}
async function loadTemplates() {
  try {
    templatesCache = await api('/admin/templates');
    templateOptions(document.getElementById('c-template'), true);
    templateOptions(document.getElementById('sc-template'), true);
    document.querySelectorAll('.step select[data-template]').forEach(function (s) { templateOptions(s, true); });
    table('t-table', ['Nombre', 'Idioma', 'Categoria', 'Estado', 'Calidad', 'Variables', 'Cuerpo'], templatesCache.map(function (t) {
      var pausada = t.pausadaHasta && new Date(t.pausadaHasta) > new Date();
      return [esc(t.name), esc(t.language), esc(t.category),
        pill(statusKind(t.status), t.status) + (pausada ? '<span class="muted">pausada por Meta hasta ' + esc(hastaCuando(t.pausadaHasta)) + '</span>' : '') + (t.pausas ? '<span class="muted">' + t.pausas + ' pausa' + (t.pausas > 1 ? 's' : '') + '</span>' : ''),
        t.quality ? pill(qualityKind(t.quality), t.quality) : '<span class="muted">-</span>', String(t.variables),
        '<span class="muted">' + esc((t.body || '').slice(0, 90)) + '</span>'];
    }), 'Registro vacio: sincroniza desde Meta o da de alta el catalogo');
    loadCatalog();
  } catch (error) { show('t-state', error.message, 'bad'); }
}
async function loadCatalog() {
  try {
    var list = await api('/admin/templates/catalog');
    table('t-catalog', ['Nombre', 'Categoria', 'Variables', 'Lint', 'En Meta', 'Cuerpo', ''], list.map(function (t) {
      var errors = t.issues.filter(function (i) { return i.severity === 'error'; }).length;
      var warns = t.issues.length - errors;
      var lint = errors ? pill('bad', errors + ' error' + (errors > 1 ? 'es' : '')) : warns ? pill('warn', warns + ' aviso' + (warns > 1 ? 's' : '')) : pill('ok', 'limpia');
      var detail = t.issues.map(function (i) { return '<span class="muted">' + esc(i.severity === 'error' ? 'ERROR' : 'aviso') + ' ' + esc(i.message) + '</span>'; }).join('');
      var acciones = t.propia
        ? '<button class="ghost sm" data-tp-edit="' + esc(t.name) + '" data-tp-lang="' + esc(t.language) + '">Editar</button> <button class="danger sm" data-tp-del="' + esc(t.name) + '" data-tp-lang="' + esc(t.language) + '">Borrar</button>'
        : '<span class="muted">catalogo</span>';
      return [esc(t.name) + (t.propia ? '<span class="muted">propia</span>' : ''), esc(t.category), esc(t.variables.join(', ')), lint + detail,
        t.registry ? pill(statusKind(t.registry.status), t.registry.status) : '<span class="muted">no subida</span>',
        '<span class="muted">' + esc(t.body) + '</span>', acciones];
    }), 'Catalogo vacio');
    document.querySelectorAll('[data-tp-del]').forEach(function (b) {
      b.onclick = async function () {
        try {
          await api('/admin/templates/' + encodeURIComponent(b.getAttribute('data-tp-del')) + '/' + encodeURIComponent(b.getAttribute('data-tp-lang')), { method: 'DELETE' });
          show('tp-state', 'Borrada', 'ok'); loadTemplates();
        } catch (error) { show('tp-state', error.message, 'bad'); }
      };
    });
    document.querySelectorAll('[data-tp-edit]').forEach(function (b) {
      b.onclick = function () {
        var t = list.find(function (x) { return x.name === b.getAttribute('data-tp-edit') && x.language === b.getAttribute('data-tp-lang'); });
        if (!t) return;
        setVal('tp-name', t.name); setVal('tp-language', t.language); setVal('tp-category', t.category);
        document.getElementById('tp-body').value = t.body;
        document.getElementById('tp-vars').value = t.variables.join('\n');
        document.getElementById('tp-name').scrollIntoView({ behavior: 'smooth', block: 'center' });
      };
    });
  } catch (error) { show('t-push-state', error.message, 'bad'); }
}
document.getElementById('tp-save').onclick = busy('tp-save', async function () {
  try {
    var r = await api('/admin/templates', { method: 'POST', body: {
      name: val('tp-name'), language: val('tp-language') || 'es', category: val('tp-category'),
      body: document.getElementById('tp-body').value,
      variables: lines(document.getElementById('tp-vars').value)
    }});
    show('tp-state', r.subirAMeta ? 'Guardada: pendiente de subir a Meta (boton "Dar de alta")' : 'Guardada y lista para usar', 'ok');
    var avisos = (r.issues || []).map(function (i) { return (i.severity === 'error' ? 'ERROR ' : 'aviso ') + i.message; });
    if (avisos.length) out('tp-out', avisos.join('\n')); else document.getElementById('tp-out').classList.add('hidden');
    loadTemplates();
  } catch (error) { show('tp-state', error.message, 'bad'); }
});
document.getElementById('t-sync').onclick = busy('t-sync', async function () {
  try {
    var r = await api('/admin/templates/sync', { method: 'POST' });
    show('t-state', 'Sincronizadas ' + r.synced, 'ok');
    loadTemplates();
  } catch (error) { show('t-state', error.message, 'bad'); }
});
document.getElementById('t-push').onclick = busy('t-push', async function () {
  try {
    var r = await api('/admin/templates/push', { method: 'POST', body: {} });
    var okCount = r.results.filter(function (x) { return x.ok; }).length;
    show('t-push-state', okCount + ' de ' + r.results.length + ' dadas de alta', r.ok ? 'ok' : 'warn');
    out('t-out', r.results.map(function (x) { return (x.ok ? 'ALTA   ' : 'FALLO  ') + x.name + (x.ok ? ' -> ' + x.status : ': ' + x.error); }).join('\n'));
    loadTemplates();
  } catch (error) { show('t-push-state', error.message, 'bad'); }
});

document.getElementById('c-send').onclick = busy('c-send', async function () {
  try {
    var parts = val('c-template').split('|');
    var recipients = lines(document.getElementById('c-list').value).map(function (line) {
      var cells = line.split(',').map(function (c) { return c.trim(); });
      return { phone: cells[0], variables: cells.slice(1) };
    });
    var body = {
      name: val('c-name') || 'Campana',
      templateName: parts[0], templateLanguage: parts[1], category: parts[2],
      recipients: recipients.length ? recipients : undefined,
      canarioEsperaMin: Number(val('c-canario-espera')) || 60
    };
    if (val('c-canario') !== '') body.canario = Number(val('c-canario'));
    if (val('c-ritmo') !== '') body.ritmoPorHora = Number(val('c-ritmo'));
    var data = await api('/admin/campaigns', { method: 'POST', body: body });
    show('c-state', data.enqueued + ' destinatarios' + (data.canario ? ', canario de ' + data.canario : '') + ': saliendo por goteo', data.enqueued ? 'ok' : 'warn');
    out('c-out', data);
    loadCampaigns();
  } catch (error) { show('c-state', error.message, 'bad'); }
});
document.getElementById('c-goteo').onclick = busy('c-goteo', async function () {
  try {
    var r = await api('/admin/campaigns/goteo', { method: 'POST' });
    show('c-state2', 'Pasada: ' + r.enviados + ' enviados' + (r.detenido ? ' - parada: ' + r.detenido : ''), r.detenido ? 'warn' : 'ok');
    loadCampaigns();
  } catch (error) { show('c-state2', error.message, 'bad'); }
});
async function campanaEstado(id, accion) {
  try {
    await api('/admin/campaigns/' + id + '/estado', { method: 'POST', body: { accion: accion } });
    loadCampaigns();
  } catch (error) { show('c-state2', error.message, 'bad'); }
}
async function loadCampaigns() {
  try {
    var list = await api('/admin/campaigns');
    table('c-table', ['Campana', 'Plantilla', 'Estado', 'Pendientes', 'Enviados', 'Entregados', 'Leidos', 'Bloqueados', 'Fallidos', ''], list.map(function (c) {
      var s = c.stats || {};
      var d = c.destinatarios || {};
      var estado = pill(statusKind(c.status), statusLabel(c.status));
      if (c.status === 'canary') estado += '<span class="muted">canario de ' + (c.canario || 0) + (c.canarioEnviadoAt ? ', esperando ' + (c.canarioEsperaMin || 60) + ' min' : '') + '</span>';
      if (c.motivoPausa) estado += '<span class="muted">' + esc(c.motivoPausa) + '</span>';
      var acciones = '<button class="ghost sm" data-deliveries="' + esc(c.id) + '">Ver envios</button> ';
      if (c.status === 'running' || c.status === 'canary') acciones += '<button class="ghost sm" data-campana="' + esc(c.id) + '" data-accion="pausar">Pausar</button> ';
      if (c.status === 'paused') acciones += '<button class="sm" data-campana="' + esc(c.id) + '" data-accion="reanudar">Reanudar</button> ';
      if (c.status === 'running' || c.status === 'canary' || c.status === 'paused') acciones += '<button class="danger sm" data-campana="' + esc(c.id) + '" data-accion="parar">Parar</button>';
      return [
        '<b>' + esc(c.name) + '</b><span class="muted">' + esc(fmt(c.createdAt)) + (c.ritmoPorHora ? ' - ' + c.ritmoPorHora + '/h' : '') + '</span>',
        esc(c.templateName) + '<span class="muted">' + esc(c.category) + '</span>',
        estado,
        String(d.pendiente || 0), String(s.sent || 0) + (s.sent !== (d.enviado || 0) && d.enviado ? '<span class="muted">' + d.enviado + ' dest.</span>' : ''), String(s.delivered || 0), String(s.read || 0),
        String((s.blocked_by_gate || 0)) + (d.bloqueado ? '<span class="muted">' + d.bloqueado + ' en firme</span>' : ''), String((s.failed || 0)) + (d.cancelado ? '<span class="muted">' + d.cancelado + ' cancelados</span>' : ''),
        acciones
      ];
    }), 'Todavia no se lanzo ninguna campana');
    document.querySelectorAll('[data-campana]').forEach(function (b) {
      b.onclick = function () { campanaEstado(b.getAttribute('data-campana'), b.getAttribute('data-accion')); };
    });
    document.querySelectorAll('[data-deliveries]').forEach(function (b) {
      b.onclick = function () {
        setVal('h-campaign', b.getAttribute('data-deliveries'));
        setVal('h-status', ''); setVal('h-phone', '');
        hOffset = 0; loaded.historial = true; activate('historial'); loadDeliveries();
      };
    });
  } catch (error) { show('c-state', error.message, 'bad'); }
}
document.getElementById('c-refresh').onclick = loadCampaigns;

// --------------------------------------------------------- automatizacion
var sequencesCache = [];
function triggerLabel(r) {
  if (r.trigger === 'first_message') return 'primer mensaje';
  if (r.trigger === 'any') return 'cualquier texto';
  return ({ equals: 'es', starts: 'empieza por', contains: 'contiene' })[r.match] + ' "' + r.keyword + '"';
}
function sequenceName(id) {
  var s = sequencesCache.filter(function (x) { return x.id === id; })[0];
  return s ? s.name : '';
}
function stepSummary(s) {
  var d = s.delayMinutes;
  var when = d === 0 ? 'al momento' : d % 1440 === 0 ? '+' + (d / 1440) + ' d' : d % 60 === 0 ? '+' + (d / 60) + ' h' : '+' + d + ' min';
  return when + ': ' + (s.kind === 'template' ? 'plantilla ' + s.templateName : 'texto');
}
var atajosCache = [];
function pintarAtajos() {
  document.getElementById('at-lista').innerHTML = atajosCache.map(function (a, i) {
    return '<div class="at-fila"><input class="pre" data-at-atajo="' + i + '" value="' + esc(a.atajo) + '" placeholder="atajo"><textarea data-at-texto="' + i + '" placeholder="Texto que se manda">' + esc(a.texto) + '</textarea><button class="danger sm" data-at-borrar="' + i + '">Quitar</button></div>';
  }).join('') || '<div class="empty">Sin atajos. Añade uno.</div>';
  document.querySelectorAll('[data-at-borrar]').forEach(function (b) { b.onclick = function () { leerAtajos(); atajosCache.splice(Number(b.getAttribute('data-at-borrar')), 1); pintarAtajos(); }; });
}
function leerAtajos() {
  atajosCache = Array.prototype.slice.call(document.querySelectorAll('[data-at-atajo]')).map(function (inp) {
    var i = inp.getAttribute('data-at-atajo');
    return { atajo: inp.value.trim().replace(/^\//, ''), texto: document.querySelector('[data-at-texto="' + i + '"]').value.trim() };
  });
}
async function loadAtajos() {
  try { var r = await api('/admin/chat/atajos'); atajosCache = r.atajos; pintarAtajos(); }
  catch (error) { show('at-state', error.message, 'bad'); }
}
document.getElementById('at-anadir').onclick = function () { leerAtajos(); atajosCache.push({ atajo: '', texto: '' }); pintarAtajos(); };
document.getElementById('at-guardar').onclick = busy('at-guardar', async function () {
  try {
    leerAtajos();
    var limpios = atajosCache.filter(function (a) { return a.atajo && a.texto; });
    await api('/admin/chat/atajos', { method: 'POST', body: { atajos: limpios } });
    show('at-state', limpios.length + ' atajo(s) guardados', 'ok');
    loadAtajos();
  } catch (error) { show('at-state', error.message, 'bad'); }
});
document.getElementById('at-fabrica').onclick = busy('at-fabrica', async function () {
  try { await api('/admin/chat/atajos', { method: 'POST', body: { atajos: null } }); show('at-state', 'Atajos de fábrica', 'ok'); loadAtajos(); }
  catch (error) { show('at-state', error.message, 'bad'); }
});
async function loadAutomation() {
  loadAtajos();
  try {
    var results = await Promise.all([api('/admin/automation/sequences'), api('/admin/automation/rules'), api('/admin/automation/prefs')]);
    sequencesCache = results[0];
    var rules = results[1];
    document.getElementById('p-askloc').checked = Boolean(results[2].askLocationFallback);

    var opts = sequencesCache.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join('');
    document.getElementById('r-sequence').innerHTML = '<option value="">(ninguna)</option>' + opts;
    document.getElementById('e-sequence').innerHTML = opts || '<option value="">(crea una secuencia primero)</option>';

    table('r-table', ['Regla', 'Se dispara con', 'Respuesta', 'Secuencia', 'Activa', ''], rules.map(function (r) {
      return [
        '<b>' + esc(r.name) + '</b>',
        esc(triggerLabel(r)),
        '<span class="muted">' + esc(r.reply || '') + '</span>',
        esc(sequenceName(r.sequenceId)),
        pill(r.enabled ? 'ok' : 'muted', r.enabled ? 'si' : 'no'),
        '<button class="ghost sm" data-rule-toggle="' + esc(r.id) + '" data-enabled="' + (r.enabled ? '1' : '0') + '">' + (r.enabled ? 'Desactivar' : 'Activar') + '</button> ' +
        '<button class="danger sm" data-rule-del="' + esc(r.id) + '">Borrar</button>'
      ];
    }), 'Sin reglas: el bot solo atiende ubicaciones, BAJA y ALTA');
    document.querySelectorAll('[data-rule-toggle]').forEach(function (b) {
      b.onclick = async function () {
        try { await api('/admin/automation/rules/' + b.getAttribute('data-rule-toggle'), { method: 'PUT', body: { enabled: b.getAttribute('data-enabled') !== '1' } }); loadAutomation(); }
        catch (error) { show('r-state', error.message, 'bad'); }
      };
    });
    document.querySelectorAll('[data-rule-del]').forEach(function (b) {
      b.onclick = async function () {
        try { await api('/admin/automation/rules/' + b.getAttribute('data-rule-del'), { method: 'DELETE' }); loadAutomation(); }
        catch (error) { show('r-state', error.message, 'bad'); }
      };
    });

    table('s-table', ['Secuencia', 'Pasos', 'Detener al responder', 'Activas', 'Total', ''], sequencesCache.map(function (s) {
      return [
        '<b>' + esc(s.name) + '</b><span class="muted">' + esc(s.description || '') + '</span>',
        s.steps.map(function (st) { return '<span class="muted">' + esc(stepSummary(st)) + '</span>'; }).join(''),
        s.stopOnReply ? 'si' : 'no',
        String(s.activeEnrollments), String(s.totalEnrollments),
        '<button class="danger sm" data-seq-del="' + esc(s.id) + '">Borrar</button>'
      ];
    }), 'Sin secuencias');
    document.querySelectorAll('[data-seq-del]').forEach(function (b) {
      b.onclick = async function () {
        var seguro = await confirmarDialogo({
          titulo: '¿Borrar la secuencia?',
          texto: 'Se borra la secuencia y las inscripciones que tenga en curso. No se puede deshacer.',
          boton: 'Sí, borrar',
          peligro: true
        });
        if (!seguro) return;
        try { await api('/admin/automation/sequences/' + b.getAttribute('data-seq-del'), { method: 'DELETE' }); loadAutomation(); }
        catch (error) { show('s-state', error.message, 'bad'); }
      };
    });

    if (!document.querySelectorAll('.step').length) addStep();
    if (!templatesCache.length) await loadTemplates();
    loadEnrollments();
    loadScheduled();
  } catch (error) { show('r-state', error.message, 'bad'); }
}

document.getElementById('p-askloc').onchange = async function () {
  try { await api('/admin/automation/prefs', { method: 'POST', body: { askLocationFallback: document.getElementById('p-askloc').checked } }); }
  catch (error) { show('r-state', error.message, 'bad'); }
};

document.getElementById('r-trigger').onchange = function () {
  var kw = document.getElementById('r-trigger').value === 'keyword';
  document.getElementById('r-keyword').disabled = !kw;
  document.getElementById('r-match').disabled = !kw;
};
document.getElementById('r-create').onclick = busy('r-create', async function () {
  try {
    await api('/admin/automation/rules', { method: 'POST', body: {
      name: val('r-name'), trigger: val('r-trigger'), keyword: val('r-keyword') || null, match: val('r-match'),
      reply: document.getElementById('r-reply').value.trim() || null, sequenceId: val('r-sequence') || null
    }});
    show('r-state', 'Regla guardada', 'ok');
    setVal('r-name', ''); setVal('r-keyword', ''); setVal('r-reply', '');
    loadAutomation();
  } catch (error) { show('r-state', error.message, 'bad'); }
});

function addStep() {
  var wrap = document.getElementById('s-steps');
  var row = document.createElement('div');
  row.className = 'step';
  row.innerHTML =
    '<div><label>Esperar</label><input type="number" min="0" value="1" data-delay></div>' +
    '<div><label>Unidad</label><select data-unit><option value="1440">dias</option><option value="60">horas</option><option value="1">minutos</option></select></div>' +
    '<div><label>Tipo</label><select data-kind><option value="template">Plantilla</option><option value="text">Texto</option></select></div>' +
    '<div><label>Plantilla</label><select data-template></select></div>' +
    '<div><label>Variables (coma)</label><input data-vars placeholder="{nombre},A-1024"></div>' +
    '<div><button class="danger sm" data-remove>Quitar</button></div>' +
    '<div class="step-text hidden"><label>Texto</label><textarea data-text placeholder="Hola {nombre}, ..."></textarea></div>';
  wrap.appendChild(row);
  templateOptions(row.querySelector('[data-template]'), true);
  row.querySelector('[data-kind]').onchange = function () {
    var isText = this.value === 'text';
    row.querySelector('.step-text').classList.toggle('hidden', !isText);
  };
  row.querySelector('[data-remove]').onclick = function () { row.remove(); };
}
document.getElementById('s-add-step').onclick = addStep;
document.getElementById('s-create').onclick = busy('s-create', async function () {
  try {
    var steps = [].map.call(document.querySelectorAll('.step'), function (row) {
      var parts = (row.querySelector('[data-template]').value || '').split('|');
      var kind = row.querySelector('[data-kind]').value;
      var vars = row.querySelector('[data-vars]').value.split(',').map(function (v) { return v.trim(); }).filter(Boolean);
      return {
        delayMinutes: Math.round(Number(row.querySelector('[data-delay]').value || 0) * Number(row.querySelector('[data-unit]').value)),
        kind: kind,
        templateName: kind === 'template' ? parts[0] : null,
        templateLanguage: kind === 'template' ? (parts[1] || 'es') : 'es',
        category: kind === 'template' ? (parts[2] || 'UTILITY') : 'UTILITY',
        variables: vars,
        text: kind === 'text' ? row.querySelector('[data-text]').value.trim() : null
      };
    });
    await api('/admin/automation/sequences', { method: 'POST', body: {
      name: val('s-name'), description: val('s-desc') || null, stopOnReply: document.getElementById('s-stop').checked, steps: steps
    }});
    show('s-state', 'Secuencia guardada', 'ok');
    setVal('s-name', ''); setVal('s-desc', '');
    document.getElementById('s-steps').innerHTML = '';
    loadAutomation();
  } catch (error) { show('s-state', error.message, 'bad'); }
});

document.getElementById('e-enroll').onclick = busy('e-enroll', async function () {
  try {
    var id = val('e-sequence');
    if (!id) throw new Error('crea una secuencia primero');
    var r = await api('/admin/automation/sequences/' + id + '/enroll', { method: 'POST', body: { phones: lines(document.getElementById('e-phones').value), source: val('e-source') || 'panel' } });
    show('e-state', 'Inscritos ' + r.enrolled + (r.already ? ' (' + r.already + ' ya estaban)' : ''), 'ok');
    document.getElementById('e-phones').value = '';
    loadAutomation();
  } catch (error) { show('e-state', error.message, 'bad'); }
});
async function loadEnrollments() {
  try {
    var status = val('e-status');
    var list = await api('/admin/automation/enrollments?limit=100' + (status ? '&status=' + status : ''));
    table('e-table', ['Contacto', 'Secuencia', 'Estado', 'Paso', 'Proximo envio', 'Origen', ''], list.map(function (e) {
      return [
        contactCell(e.phone, e.name), esc(e.sequenceName), pill(statusKind(e.status), statusLabel(e.status)),
        e.currentStep + ' / ' + e.totalSteps,
        e.nextDueAt ? esc(fmt(e.nextDueAt)) + '<span class="muted">' + esc(ago(e.nextDueAt)) + '</span>' : '<span class="muted">-</span>',
        esc(e.source || ''),
        e.status === 'active' ? '<button class="danger sm" data-enr-cancel="' + esc(e.id) + '">Cancelar</button>' : ''
      ];
    }), 'Sin inscripciones');
    document.querySelectorAll('[data-enr-cancel]').forEach(function (b) {
      b.onclick = async function () {
        try { await api('/admin/automation/enrollments/' + b.getAttribute('data-enr-cancel') + '/cancel', { method: 'POST' }); loadAutomation(); }
        catch (error) { show('e-state', error.message, 'bad'); }
      };
    });
  } catch (error) { show('e-state', error.message, 'bad'); }
}
document.getElementById('e-refresh').onclick = loadEnrollments;
document.getElementById('e-status').onchange = loadEnrollments;

document.getElementById('sc-kind').onchange = function () {
  var isText = this.value === 'freeform';
  document.getElementById('sc-template').disabled = isText;
  document.getElementById('sc-vars').disabled = isText;
};
document.getElementById('sc-create').onclick = busy('sc-create', async function () {
  try {
    var kind = val('sc-kind');
    var parts = val('sc-template').split('|');
    var when = val('sc-when');
    if (!when) throw new Error('elige fecha y hora');
    await api('/admin/automation/scheduled', { method: 'POST', body: {
      phone: val('sc-phone'), dueAt: new Date(when).toISOString(), kind: kind,
      templateName: kind === 'template' ? parts[0] : null, templateLanguage: parts[1] || 'es',
      category: kind === 'template' ? (parts[2] || 'UTILITY') : 'UTILITY',
      variables: val('sc-vars').split(',').map(function (v) { return v.trim(); }).filter(Boolean),
      text: kind === 'freeform' ? document.getElementById('sc-text').value.trim() : null
    }});
    show('sc-state', 'Programado', 'ok');
    loadScheduled();
  } catch (error) { show('sc-state', error.message, 'bad'); }
});
document.getElementById('sc-run').onclick = busy('sc-run', async function () {
  try {
    var r = await api('/admin/automation/run', { method: 'POST' });
    show('sc-state', 'Procesados ' + r.processed + ': ' + r.sent + ' enviados, ' + r.blocked + ' bloqueados, ' + r.failed + ' fallidos', r.processed ? 'ok' : 'muted');
    loadScheduled(); loadEnrollments();
  } catch (error) { show('sc-state', error.message, 'bad'); }
});
async function loadScheduled() {
  try {
    var status = val('sc-status');
    var list = await api('/admin/automation/scheduled?limit=100' + (status ? '&status=' + status : ''));
    table('sc-table', ['Cuando', 'Contacto', 'Que', 'Origen', 'Estado', 'Detalle', ''], list.map(function (m) {
      return [
        esc(fmt(m.dueAt)) + '<span class="muted">' + esc(ago(m.dueAt)) + '</span>',
        contactCell(m.phone, m.name),
        m.kind === 'template' ? 'plantilla <b>' + esc(m.templateName) + '</b>' + (m.variables.length ? '<span class="muted">' + esc(m.variables.join(', ')) + '</span>' : '') : '<span class="muted">' + esc((m.text || '').slice(0, 80)) + '</span>',
        m.sequenceName ? esc(m.sequenceName) + '<span class="muted">paso ' + m.stepPosition + '</span>' : '<span class="muted">manual</span>',
        pill(statusKind(m.status), statusLabel(m.status)),
        '<span class="muted">' + esc(m.detail || '') + '</span>',
        m.status === 'pending' ? '<button class="danger sm" data-sc-cancel="' + m.id + '">Cancelar</button>' : ''
      ];
    }), 'Nada programado');
    document.querySelectorAll('[data-sc-cancel]').forEach(function (b) {
      b.onclick = async function () {
        try { await api('/admin/automation/scheduled/' + b.getAttribute('data-sc-cancel') + '/cancel', { method: 'POST' }); loadScheduled(); }
        catch (error) { show('sc-state', error.message, 'bad'); }
      };
    });
  } catch (error) { show('sc-state', error.message, 'bad'); }
}
document.getElementById('sc-refresh').onclick = loadScheduled;
document.getElementById('sc-status').onchange = loadScheduled;

// ------------------------------------------------------------- historial
var hOffset = 0, H_LIMIT = 50;
document.getElementById('h-csv').onclick = function () {
  var q = [];
  if (val('h-status')) q.push('status=' + encodeURIComponent(val('h-status')));
  if (val('h-phone')) q.push('phone=' + encodeURIComponent(val('h-phone')));
  if (val('h-campaign')) q.push('campaignId=' + encodeURIComponent(val('h-campaign')));
  location.href = '/admin/deliveries.csv' + (q.length ? '?' + q.join('&') : '');
};
async function loadDeliveries() {
  try {
    var q = '/admin/deliveries?limit=' + H_LIMIT + '&offset=' + hOffset;
    if (val('h-status')) q += '&status=' + encodeURIComponent(val('h-status'));
    if (val('h-phone')) q += '&phone=' + encodeURIComponent(val('h-phone'));
    if (val('h-campaign')) q += '&campaignId=' + encodeURIComponent(val('h-campaign'));
    var list = await api(q);
    table('h-table', ['Fecha', 'Contacto', 'Tipo', 'Plantilla', 'Categoria', 'Estado', 'Detalle', 'Campana'], list.map(function (d) {
      return [
        esc(fmt(d.queuedAt)),
        contactCell(d.phone, d.name),
        esc(d.kind),
        esc(d.templateName || ''),
        esc(d.category),
        pill(statusKind(d.status), statusLabel(d.status)),
        '<span class="muted">' + esc(d.errorTitle || '') + (d.errorCode ? ' (' + esc(d.errorCode) + ')' : '') + '</span>',
        esc(d.campaignName || '')
      ];
    }), 'Sin envios todavia');
    document.getElementById('h-page').textContent = list.length ? (hOffset + 1) + '-' + (hOffset + list.length) : '0';
    document.getElementById('h-prev').disabled = hOffset === 0;
    document.getElementById('h-next').disabled = list.length < H_LIMIT;
  } catch (error) { show('state', error.message, 'bad'); }
}
document.getElementById('h-search').onclick = function () { hOffset = 0; loadDeliveries(); };
document.getElementById('h-prev').onclick = function () { hOffset = Math.max(0, hOffset - H_LIMIT); loadDeliveries(); };
document.getElementById('h-next').onclick = function () { hOffset += H_LIMIT; loadDeliveries(); };

// -------------------------------------------------------------- usuarios
var yo = null;
async function loadUsuarios() {
  try {
    yo = yo || await api('/admin/yo');
    if (yo && yo.rol !== 'admin') {
      document.getElementById('us-table').innerHTML = '<div class="empty">Solo un administrador puede ver y crear usuarios. Aqui puedes cambiar tu contrasena.</div>';
      document.getElementById('us-crear').disabled = true;
      return;
    }
    var list = await api('/admin/usuarios');
    table('us-table', ['Usuario', 'Nombre', 'Rol', 'Estado', 'Ultimo acceso', ''], list.map(function (u) {
      var acciones = '<button class="ghost sm" data-us-clave="' + esc(u.id) + '">Nueva contrasena</button> ' +
        '<button class="ghost sm" data-us-rol="' + esc(u.id) + '" data-rol="' + (u.rol === 'admin' ? 'operador' : 'admin') + '">Hacer ' + (u.rol === 'admin' ? 'operador' : 'admin') + '</button> ' +
        '<button class="' + (u.activo ? 'danger' : 'ghost') + ' sm" data-us-activo="' + esc(u.id) + '" data-activo="' + (u.activo ? 'false' : 'true') + '">' + (u.activo ? 'Desactivar' : 'Activar') + '</button>';
      return [esc(u.usuario), esc(u.nombre), pill(u.rol === 'admin' ? 'ok' : 'muted', u.rol), pill(u.activo ? 'ok' : 'bad', u.activo ? 'activo' : 'desactivado'), esc(fmt(u.ultimoLoginAt) || 'nunca'), acciones];
    }), 'Sin usuarios');
    document.querySelectorAll('[data-us-clave]').forEach(function (b) {
      b.onclick = async function () {
        var nueva = await pedirDato({ titulo: 'Nueva contrasena', texto: 'Al menos 8 caracteres. Sus sesiones abiertas se cierran.', etiqueta: 'Contrasena', boton: 'Cambiar', validar: function (v) { return v && v.length >= 8 ? null : 'Al menos 8 caracteres.'; } });
        if (!nueva) return;
        try { await api('/admin/usuarios/' + b.getAttribute('data-us-clave'), { method: 'POST', body: { clave: nueva } }); show('us-state', 'Contrasena cambiada', 'ok'); }
        catch (error) { show('us-state', error.message, 'bad'); }
      };
    });
    document.querySelectorAll('[data-us-rol]').forEach(function (b) {
      b.onclick = async function () {
        try { await api('/admin/usuarios/' + b.getAttribute('data-us-rol'), { method: 'POST', body: { rol: b.getAttribute('data-rol') } }); loadUsuarios(); }
        catch (error) { show('us-state', error.message, 'bad'); }
      };
    });
    document.querySelectorAll('[data-us-activo]').forEach(function (b) {
      b.onclick = async function () {
        try { await api('/admin/usuarios/' + b.getAttribute('data-us-activo'), { method: 'POST', body: { activo: b.getAttribute('data-activo') === 'true' } }); loadUsuarios(); }
        catch (error) { show('us-state', error.message, 'bad'); }
      };
    });
  } catch (error) { show('us-state', error.message, 'bad'); }
}
document.getElementById('us-crear').onclick = busy('us-crear', async function () {
  try {
    await api('/admin/usuarios', { method: 'POST', body: { nombre: val('us-nombre'), usuario: val('us-usuario'), clave: document.getElementById('us-clave').value, rol: val('us-rol') } });
    show('us-state', 'Usuario creado', 'ok');
    setVal('us-nombre', ''); setVal('us-usuario', ''); document.getElementById('us-clave').value = '';
    loadUsuarios();
  } catch (error) { show('us-state', error.message, 'bad'); }
});
async function loadMiCuenta() {
  try {
    var u = await api('/admin/yo');
    yo = u;
    document.getElementById('mc-datos').innerHTML =
      '<div class="stat"><span class="muted">Nombre</span><b>' + esc(u.nombre) + '</b></div>' +
      '<div class="stat"><span class="muted">Usuario</span><b>' + esc(u.usuario) + '</b></div>' +
      '<div class="stat"><span class="muted">Rol</span><b>' + (u.rol === 'admin' ? 'Administrador' : 'Operador') + '</b><small>' + (u.rol === 'admin' ? 'gestiona cuentas, claves y configuración' : 'usa todo el sistema; no gestiona cuentas') + '</small></div>';
  } catch (error) { show('mc-state', error.message, 'bad'); }
}
document.getElementById('mc-cambiar').onclick = busy('mc-cambiar', async function () {
  try {
    var nueva = document.getElementById('mc-nueva').value;
    if (nueva !== document.getElementById('mc-nueva2').value) throw new Error('Las contraseñas nuevas no coinciden.');
    await api('/admin/mi-clave', { method: 'POST', body: { actual: document.getElementById('mc-actual').value, nueva: nueva } });
    show('mc-state', 'Contraseña cambiada', 'ok');
    document.getElementById('mc-actual').value = ''; document.getElementById('mc-nueva').value = ''; document.getElementById('mc-nueva2').value = '';
  } catch (error) { show('mc-state', error.message, 'bad'); }
});
document.getElementById('mc-salir').onclick = function () { salir(); };
api('/admin/yo').then(function (u) { yo = u; var q = document.getElementById('quien'); if (q && u) q.textContent = u.nombre; }).catch(function () {});

// --------------------------------------------------------------- extraer
document.getElementById('g-run').onclick = async function () {
  try {
    var data = await api('/admin/geo/extract', { method: 'POST', body: { input: document.getElementById('g-input').value } });
    show('g-state', data.ok ? data.source + ' / ' + data.confidence : data.reason, data.ok ? 'ok' : 'warn');
    out('g-out', data);
  } catch (error) { show('g-state', error.message, 'bad'); }
};

copyButtons();
bindLogout();
activate(location.hash.slice(1) || 'inicio');
`;

  return appShell({
    titulo: 'Inicio',
    subtitulo: 'Un vistazo a todo lo que pasa hoy',
    contenido: `<div class="wrap">${body}</div>`,
    script: AUTH_JS + script,
    css: CSS,
    nombreNegocio: opts.nombreNegocio,
    demo: opts.demo,
    icono: '📊',
  });
}
