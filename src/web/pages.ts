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
  /* La paleta, la letra y los espacios vienen del armazon (shell.ts). */
  * { box-sizing: border-box; }
  .wrap { color: var(--text); font-size: var(--fs-cuerpo); line-height: 1.55; }
  h2 { font-size: var(--fs-h2); font-weight: 700; letter-spacing: -.01em; margin: 0 0 4px; }
  h3 { font-size: var(--fs-h3); font-weight: 700; margin: 18px 0 4px; }
  .muted { color: var(--muted); font-size: 13px; margin: 0; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: var(--radio);
    padding: 18px 20px; margin-top: var(--esp-4); box-shadow: var(--sombra); }
  label { display: block; font-size: 13px; font-weight: 600; margin: 14px 0 5px; }
  label.inline { display: inline-flex; align-items: center; gap: 6px; font-weight: 400; margin: 0; }
  label.inline input { width: auto; }
  input, textarea, select {
    width: 100%; min-height: 40px; padding: 9px 12px; font: inherit; font-size: 14px; color: var(--text);
    background: var(--card); border: 1px solid var(--line); border-radius: var(--radio-sm);
  }
  input:focus, textarea:focus, select:focus { border-color: var(--primario); outline: 2px solid var(--primario-suave); outline-offset: 0; }
  input[type=checkbox], input[type=radio] { min-height: 0; width: 16px; height: 16px; accent-color: var(--primario); }
  textarea { min-height: 92px; resize: vertical; font-family: ui-monospace, Consolas, monospace; font-size: 13px; }
  button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 38px; padding: 8px 16px; font: inherit; font-weight: 600; line-height: 1.2; border: 1px solid var(--accent); border-radius: var(--radio-sm);
    background: var(--accent); color: var(--accent-ink); cursor: pointer; }
  button:hover { filter: brightness(1.06); }
  button.ghost { background: var(--card); color: var(--text); border: 1px solid var(--line); }
  button.ghost:hover { filter: none; border-color: var(--primario); color: var(--primario); }
  button.danger { background: var(--rojo-suave); color: var(--rojo); border: 1px solid transparent; }
  button.danger:hover { filter: none; background: var(--rojo); color: #fff; }
  button.sm { min-height: 30px; padding: 4px 10px; font-size: 12.5px; font-weight: 500; }
  button:disabled { opacity: .5; cursor: default; filter: none; }
  @media (max-width: 960px) { button { min-height: 40px; } button.sm { min-height: 36px; } }
  .actions { display: flex; gap: 10px; align-items: center; margin-top: 18px; flex-wrap: wrap; }
  .toolbar { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); align-items: end; margin-top: 8px; }
  .toolbar label { margin-top: 0; }
  .wrap > section.card:first-of-type, .wrap > .card { margin-top: 0; }
  .wrap > section.card + section.card { margin-top: 16px; }
  /* --- inicio --- */
  .kpis { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  .kpis .linea-hoy { grid-column: 1 / -1; margin: 0; padding: 12px 16px; font-size: 14px; line-height: 1.6; }
  .kpis .linea-hoy a { color: var(--text); text-decoration: none; border-bottom: 1px dotted var(--muted); }
  .kpis .linea-hoy a:hover { color: var(--accent); border-color: var(--accent); }
  .kpis .linea-hoy .mal { color: var(--rojo); font-weight: 600; }
  .kpi { background: var(--card); border: 1px solid var(--line); border-radius: var(--radio); padding: 16px 18px; min-width: 0; box-shadow: var(--sombra); }
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
  .pasos li i { flex: none; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-style: normal; font-weight: 800; font-size: 12px; margin-top: 1px; background: var(--gris-suave); color: var(--gris); }
  .pasos li.hecho i { background: var(--verde-suave); color: var(--verde); }
  .pasos li.hecho { opacity: .75; }
  .pasos li b { display: block; }
  .pasos li a { text-decoration: none; }
  .pasos li small { color: var(--muted); display: block; }
  .pasos li .ir { display: inline-block; margin-top: 6px; font-size: 12.5px; font-weight: 600; color: var(--accent); text-decoration: none; border: 1px solid var(--accent); border-radius: 8px; padding: 3px 10px; }
  .pasos li.hecho .ir { border-color: var(--line); color: var(--muted); font-weight: 500; }
  .listo-linea { display: block; font-size: 13.5px; line-height: 1.7; }
  .listo-linea b { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--verde-suave); color: var(--ok); font-size: 13px; vertical-align: middle; margin-right: 8px; }
  .listo-linea > span { vertical-align: middle; }
  .listo-linea a { margin-left: 8px; }
  .listo-linea a { color: var(--muted); font-size: 12.5px; cursor: pointer; text-decoration: underline; }
  .uso-ia { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 8px 0 6px; }
  .uso-ia div { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: var(--bg); }
  .uso-ia span { display: block; color: var(--muted); font-size: 12px; }
  .uso-ia b { font-size: 18px; }
  .uso-ia b.bad { color: var(--bad); }
  .uso-barra { height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; margin-top: 6px; }
  .uso-barra i { display: block; height: 100%; background: var(--accent); }
  .uso-barra i.warn { background: var(--warn); } .uso-barra i.bad { background: var(--bad); }
  .res { display: grid; gap: 4px; margin-top: 14px; padding: 12px 14px; border-radius: 11px; border: 1px solid var(--line); background: var(--bg); font-size: 13.5px; }
  .res b { font-size: 14px; }
  .res.ok { border-color: var(--verde); background: var(--verde-suave); } .res.ok b { color: var(--verde); }
  .res.warn { border-color: var(--ambar); background: var(--ambar-suave); } .res.warn b { color: var(--ambar); }
  .res.bad { border-color: var(--rojo); background: var(--rojo-suave); } .res.bad b { color: var(--rojo); }
  .res a { font-weight: 600; text-decoration: none; margin-top: 2px; }
  .res .muted { display: block; }
  .tecnico { margin-top: 8px; }
  .tecnico summary { cursor: pointer; color: var(--muted); font-size: 12.5px; }
  .tecnico pre { margin-top: 6px; max-height: 220px; }
  .at-fila { display: grid; grid-template-columns: 150px 1fr 170px; gap: 8px; align-items: start; margin-top: 8px; }
  .at-fila input, .at-fila textarea { margin: 0; }
  .at-fila textarea { min-height: 44px; font-family: inherit; }
  .at-fila .pre { font-family: ui-monospace, Consolas, monospace; }
  @media (max-width: 700px) { .at-fila { grid-template-columns: 1fr; } }
  .sk-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); margin-top: 10px; }
  .sk-item { border: 1px solid var(--line); border-radius: 12px; padding: 10px; background: var(--bg); text-align: center; }
  .sk-item img { width: 110px; height: 110px; object-fit: contain; display: block; margin: 0 auto 6px; background: repeating-conic-gradient(rgba(0,0,0,.05) 0 25%, transparent 0 50%) 0 0/16px 16px; border-radius: 8px; }
  .sk-item b { display: block; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sk-item small { color: var(--muted); display: block; font-size: 11.5px; margin-bottom: 6px; }
  .cf-vigente { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .cf-vigente span { background: var(--bg); border: 1px solid var(--line); border-radius: 999px; padding: 4px 11px; font-size: 12.5px; }
  .cf-vigente b { color: var(--accent); }
  .dias { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
  .dias label { display: inline-flex; align-items: center; gap: 5px; margin: 0; padding: 6px 10px; border: 1px solid var(--line); border-radius: 8px; font-weight: 500; font-size: 13px; cursor: pointer; background: var(--bg); }
  .dias input { width: auto; }
  .dias label:has(input:checked) { border-color: var(--accent); color: var(--accent); background: var(--primario-suave); }
  .cf-aviso { margin-top: 10px; padding: 10px 12px; border-radius: 10px; background: var(--ambar-suave); border: 1px solid var(--ambar); font-size: 13.5px; }
  .cf-nota { color: var(--muted); font-size: 12.5px; margin-top: 4px; }
  .con-prefijo { display: flex; align-items: stretch; }
  .con-prefijo span { display: flex; align-items: center; padding: 0 10px; border: 1px solid var(--line); border-right: 0; border-radius: var(--radio-sm) 0 0 var(--radio-sm); background: var(--superficie-2); color: var(--muted); font-weight: 600; font-size: 13.5px; }
  .con-prefijo input { border-radius: 0 var(--radio-sm) var(--radio-sm) 0; }
  .nueva-clave { margin-top: 14px; padding: 14px 16px; border: 1px solid var(--warn); border-radius: var(--radio); background: var(--ambar-suave); }
  /* La conexion con Stoky: dos direcciones, una caja cada una. */
  .stk { display: grid; gap: 14px; grid-template-columns: 1fr 1fr; align-items: start; margin-top: 10px; }
  @media (max-width: 1000px) { .stk { grid-template-columns: 1fr; } }
  .stk .caja-stk { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: var(--chip); }
  .stk h3 { margin: 0 0 6px; }
  .stk .paso-n { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 999px; background: var(--accent); color: var(--accent-ink); font-size: 12.5px; margin-right: 6px; }
  .stk .semaforo { display: flex; flex-direction: column; gap: 6px; margin: 10px 0; font-size: 13.5px; }
  .stk .semaforo div { display: flex; gap: 8px; align-items: flex-start; }
  .stk .semaforo i { flex: none; width: 10px; height: 10px; border-radius: 50%; margin-top: 5px; background: var(--muted); }
  .stk .semaforo i.ok { background: var(--verde); } .stk .semaforo i.warn { background: var(--ambar); } .stk .semaforo i.bad { background: var(--rojo); }
  .stk .semaforo small { display: block; color: var(--muted); }
  .stk ol { margin: 6px 0 0; padding-left: 20px; font-size: 13.5px; }
  .stk ol li { margin: 3px 0; }
  .stk code.dir { display: inline-block; background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 2px 8px; }
  .nueva-clave code { display: block; font-size: 14px; padding: 10px 12px; margin: 8px 0; background: var(--card); border: 1px solid var(--line); border-radius: 8px; word-break: break-all; }
  .ia-chat { border: 1px solid var(--line); border-radius: 12px; background: var(--bg); min-height: 120px; max-height: 360px; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
  .ia-chat .b { max-width: 80%; padding: 7px 11px; border-radius: 10px; background: var(--card); white-space: pre-wrap; }
  .ia-chat .b.yo { align-self: flex-end; background: var(--primario-suave); color: var(--text); }
  .ia-chat .b.derivo { border: 1px dashed var(--warn); }
  .permisos { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 6px 14px; margin: 6px 0 10px; }
  .permisos label { display: flex; gap: 8px; align-items: flex-start; font-weight: normal; cursor: pointer; }
  .permisos label input { margin-top: 3px; }
  .permisos label small { color: var(--muted); display: block; }
  /* .pill = el mismo chip del armazon (ok/warn/bad/muted -> verde/ambar/rojo/gris) */
  .pill { display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; line-height: 1.5; white-space: nowrap; background: var(--gris-suave); color: var(--gris); vertical-align: middle; }
  .pill.ok { background: var(--verde-suave); color: var(--verde); }
  .pill.warn { background: var(--ambar-suave); color: var(--ambar); }
  .pill.bad { background: var(--rojo-suave); color: var(--rojo); }
  .pill.muted { background: var(--gris-suave); color: var(--gris); }
  pre { background: var(--bg); border: 1px solid var(--line); border-radius: 9px;
    padding: 12px; overflow: auto; font-size: 12.5px; margin: 12px 0 0; max-height: 320px; }
  .copy { display: flex; gap: 8px; margin-top: 6px; }
  .copy input { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; }
  ol { padding-left: 20px; margin: 10px 0 0; }
  ol li { margin-bottom: 9px; }
  a { color: var(--accent); }
  .grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
  .stat { background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; min-width: 0; }
  .stat b { display: block; font-size: 20px; overflow-wrap: anywhere; }
  .stat b.ok { color: var(--ok); } .stat b.warn { color: var(--warn); } .stat b.bad { color: var(--bad); }
  .hidden { display: none; }
  .tablewrap { overflow-x: auto; margin-top: 12px; border: 1px solid var(--line); border-radius: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: .03em; color: var(--muted); background: var(--bg); white-space: nowrap; }
  tr:last-child td { border-bottom: 0; }
  td .muted { display: block; }
  td.nowrap, th.nowrap { white-space: nowrap; }
  .empty { padding: var(--esp-5) var(--esp-4); color: var(--muted); text-align: center; line-height: 1.5; }
  .empty b { display: block; color: var(--text); font-size: var(--fs-h3); margin-bottom: 4px; }
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
  .semaforo .luz.verde { background: var(--verde); } .semaforo .luz.amarillo { background: #eab308; }
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
    /* Siempre «21/09/26 15:08»: la misma hora de 24 h que en Hoy y en los mensajes. */
    return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' + d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false });
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
  ['ia', 'Asistente IA', 'Con qué IA contesta, qué sabe de tu negocio y si está encendido'],
  ['pedidos', 'Pedidos del chat', 'Lo que se cerro en la conversacion: confirmar, cancelar o pasar a la tienda'],
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
  ['stickers', 'Stickers', 'Tras el saludo, el gracias o la despedida, y a mano desde el chat'],
  ['extraer', 'Extraer coordenadas', 'De un link de mapa o un texto'],
  ['configuracion', 'Configuración', 'Horario de envío, ritmo, modo prueba, avisos y nombre'],
  ['usuarios', 'Usuarios', 'Cuentas del equipo, roles y contraseñas'],
  ['membresia', 'Membresía', 'El plan de esta instalación: hasta cuándo está pagada, sus topes y los pagos'],
  ['tiendas', 'Tiendas', 'Los negocios que controlas: su plan, hasta cuándo está pagado, si están en línea'],
  ['integraciones', 'Conectar mi web y mi tienda', 'Stoky, el chat en tu web, tu tienda WooCommerce o Shopify, y las claves para otros programas'],
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
    : `<div class="card" style="border-color:var(--ambar)">
         <h2>Falta conectar WhatsApp</h2>
         <p class="muted">Los envios estan desactivados hasta que pegues las credenciales en
         <a href="/setup">la pantalla de conexion</a>. Contactos, reglas, secuencias y el extractor de coordenadas si funcionan.</p>
       </div>`;

  const body = `
${warning}

<div id="tab-inicio" class="hidden">
  <section class="card hidden" id="in-pasos-card" style="margin-bottom:14px">
    <h2 id="in-pasos-titulo">Para empezar</h2>
    <p class="muted" id="in-pasos-sub">Lo que falta por dejar listo. Cada punto lleva a la pantalla donde se hace; cuando esté todo, esta tarjeta se pliega a una línea.</p>
    <div class="listo-linea hidden" id="in-pasos-listo"></div>
    <ul class="pasos" id="in-pasos"></ul>
  </section>
  <section class="card hidden" id="in-entregas-card" style="margin-bottom:14px">
    <h2>Entregas de hoy</h2>
    <p class="muted" id="in-entregas-sub">Los pedidos del día: qué les falta, cuántos van en camino y cuáles necesitan a alguien.</p>
    <div class="kpis" id="in-entregas"></div>
    <div class="actions" id="in-entregas-acciones"><a href="/hoy">Ver los pedidos de hoy</a></div>
  </section>
  <div class="kpis" id="in-kpis"><div class="kpi"><div class="l">Cargando</div><div class="n">…</div></div></div>
  <div class="dos">
    <section class="card">
      <h2>Últimos 7 días</h2>
      <p class="muted">Mensajes que salieron y que entraron, por día.</p>
      <div class="grafica" id="in-grafica"></div>
      <div class="leyenda"><span><i style="background:var(--accent)"></i>Salieron</span><span><i style="background:var(--gris-claro)"></i>Entraron</span></div>
    </section>
    <section class="card">
      <h2>El número</h2>
      <div id="in-numero"><p class="muted">Cargando…</p></div>
      <div class="actions"><a href="/panel#salud">Ver el detalle</a></div>
    </section>
  </div>
  <div class="dos">
    <section class="card" id="in-reparto-card">
      <h2>Reparto</h2>
      <p class="muted">Solicitudes de ubicación por estado y los últimos lotes.</p>
      <div id="in-reparto"></div>
    </section>
    <section class="card">
      <h2>Accesos rápidos</h2>
      <div class="accesos" id="in-accesos">
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
  <div id="estado-avisos-meta" class="hidden" style="margin:12px 0"></div>
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
  <h2>Ajustes</h2>
  <p class="muted">Lo que se guarda aquí se aplica en el siguiente envío, sin reiniciar. Un campo vacío significa "lo de siempre" (el valor aparece en gris).</p>
  <div class="cf-vigente" id="cf-vigente"></div>

  <div id="cf-plan" class="hidden" style="margin:12px 0 18px;padding:12px 14px;border:1px solid var(--line);border-radius:10px"></div>

  <h3>Qué se enseña</h3>
  <p class="muted">GSGchat viene con lo justo para el día a día de GSG. Todo lo demás (campañas, grupos, rastreo, tiendas conectadas, ritmo del número…) sigue ahí, escondido; se puede enseñar entero cuando haga falta.</p>
  <div class="toolbar" style="align-items:flex-start">
    <label class="inline" style="flex:1;min-width:260px;align-items:flex-start;gap:10px"><input type="radio" name="cf-modo" value="gsg" style="margin-top:4px"><span><b>Solo lo de GSG</b> (recomendado)<br><span class="muted" style="font-size:12.5px">Hoy, Chats, Conversaciones guardadas, Asistente IA, Motorizados, Equipo, Conexión y Ajustes.</span></span></label>
    <label class="inline" style="flex:1;min-width:260px;align-items:flex-start;gap:10px"><input type="radio" name="cf-modo" value="completo" style="margin-top:4px"><span><b>Todo el sistema</b><br><span class="muted" style="font-size:12.5px">Además: campañas, grupos, respuestas automáticas, plantillas, rastreo, riesgo y ritmo, integraciones (Stoky, web, tiendas), reparto por lotes y envío automático como pantallas aparte.</span></span></label>
  </div>
  <div class="cf-nota" style="margin-top:4px">Se aplica a todas las cuentas al recargar la página.</div>

  <h3>¿A quién avisamos?</h3>
  <p class="muted">El número más importante del sistema: recibe las incidencias, el resumen de la mañana y de la tarde, la prueba diaria y los cambios de nivel del número.</p>
  <div class="toolbar">
    <div style="grid-column: span 2"><label for="cf-supervisor">WhatsApp del supervisor</label><div class="con-prefijo"><span>+51</span><input id="cf-supervisor" inputmode="tel" placeholder="987 654 321"></div><div class="cf-nota">Los 9 dígitos del celular; el 51 se pone solo. Vacío = nadie recibe avisos.</div></div>
  </div>

  <h3>Negocio</h3>
  <div class="toolbar">
    <div style="grid-column: span 2"><label for="cf-nombre">Nombre del negocio</label><input id="cf-nombre" placeholder=""><div class="cf-nota">Así se presenta en los mensajes ("{negocio}") y en las pantallas.</div></div>
    <div><label>Zona horaria</label><input id="cf-tz" disabled><div class="cf-nota">La hora con la que se escribe y se cierra el día. La fija quien instala el sistema.</div></div>
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
  <label for="cf-mp-numeros">Números permitidos (uno por línea)</label>
  <textarea id="cf-mp-numeros" placeholder="987 654 321&#10;912 426 667"></textarea>
  <div class="cf-nota">Los 9 dígitos del celular bastan; el 51 se pone solo.</div>


  <h3>Resumen del día por WhatsApp</h3>
  <p class="muted">Al supervisor le llega cómo arranca el día (pedidos, qué falta, motorizados, GSG) y cómo cerró (entregados, sin terminar, incidencias). Las cifras las pone el sistema; si el asistente IA está conectado, él redacta el texto alrededor de ellas.</p>
  <div class="toolbar">
    <div><label class="inline" style="margin-top:22px"><input type="checkbox" id="cf-rs-activo"> Mandar el resumen</label></div>
    <div><label for="cf-rs-manana">Por la mañana a las</label><input id="cf-rs-manana" type="time" value="08:30"></div>
    <div><label for="cf-rs-tarde">Por la tarde a las</label><input id="cf-rs-tarde" type="time" value="18:30"></div>
  </div>
  <div id="cf-rs-estado" class="cf-nota" style="margin-top:4px"></div>
  <div class="actions" style="margin-top:8px">
    <button class="ghost" id="cf-rs-ver-manana" type="button">Ver cómo queda el de la mañana</button>
    <button class="ghost" id="cf-rs-ver-tarde" type="button">Ver cómo queda el de la tarde</button>
    <button class="ghost" id="cf-rs-mandar" type="button">Mandar ahora</button>
  </div>
  <pre id="cf-rs-vista" class="hidden" style="white-space:pre-wrap;font:inherit;font-size:13px;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-top:8px"></pre>

  <h3>Comportamiento</h3>
  <div class="toolbar">
    <div><label for="cf-humanizar">Escribe como una persona (pausas al teclear)</label><select id="cf-humanizar"><option value="">Como venga de fábrica (recomendado)</option><option value="true">Sí</option><option value="false">No</option></select></div>
    <div><label for="cf-autopausa">Pausa automática en rojo</label><select id="cf-autopausa"><option value="">Como venga de fábrica (recomendado)</option><option value="true">Sí</option><option value="false">No</option></select></div>
    <div style="grid-column: span 2"><label for="cf-verunavez">Foto o video de "ver una vez"</label><select id="cf-verunavez"><option value="true">Pedirle al cliente que lo mande normal</option><option value="false">No decir nada</option></select><div class="cf-nota">WhatsApp entrega los "ver una vez" solo al teléfono, no a este sistema. Se le pide al teléfono que lo reenvíe y, si no lo suelta en unos segundos, se le escribe al cliente para que lo mande como foto normal.</div></div>
  </div>

  <div class="actions">
    <button id="cf-guardar">Guardar</button>
    <button class="ghost" id="cf-restablecer">Volver a lo del servidor</button>
    <span id="cf-state" class="pill hidden"></span>
  </div>
</section>

<section id="tab-usuarios" class="card hidden">
  <h2>Usuarios</h2>
  <p class="muted">Quien puede entrar al sistema. Un <b>superadministrador</b> es quien puso el sistema: lleva la <a href="/panel#membresia">membresía</a>, los códigos de conexión y las cuentas de los demás superadministradores. Un <b>administrador</b> configura el negocio y gestiona usuarios y claves de API. Un <b>operador</b> atiende y usa todo lo demás. Cada uno entra con su usuario y contraseña en <code>/login</code>.
  Los programas (Stoky, el sistema de GSG) no tienen usuario: entran con una clave de API o un código de conexión, ver <a href="/panel#integraciones">Conectar mi web y tienda</a>.</p>
  <div id="us-table" class="tablewrap"></div>

  <h3>Crear usuario</h3>
  <div class="toolbar">
    <div><label>Nombre</label><input id="us-nombre" placeholder="Rosa"></div>
    <div><label>Usuario</label><input id="us-usuario" placeholder="rosa"></div>
    <div><label>Contraseña (mínimo 8)</label><input id="us-clave" type="password"></div>
    <div><label>Rol</label><select id="us-rol"><option value="operador">Operador</option><option value="admin">Administrador</option><option value="superadmin" id="us-rol-super" class="hidden">Superadministrador</option></select></div>
  </div>
  <div class="cf-nota" style="margin-top:6px"><b>Operador:</b> atiende los chats y Hoy · <b>Administrador:</b> además Ajustes, Equipo y Conexión · <b>Superadministrador:</b> además Tiendas y Membresía.</div>
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

<section id="tab-membresia" class="card hidden">
  <h2>Membresía</h2>
  <p class="muted" id="mb-intro">El plan de esta instalación: hasta cuándo está pagada, qué incluye y los pagos apuntados. Cuando vence o se suspende, el asistente IA y las campañas se paran; los chats siguen funcionando.</p>
  <div id="mb-estado" style="margin:12px 0 18px;padding:12px 14px;border:1px solid var(--line);border-radius:10px"></div>
  <div id="mb-editar" class="hidden">
    <h3>Plan y vencimiento</h3>
    <div class="toolbar">
      <div><label for="mb-plan">Plan</label><select id="mb-plan"></select></div>
      <div><label for="mb-nombre">Nombre que ve el negocio</label><input id="mb-nombre" placeholder="Básico"></div>
      <div><label for="mb-vence">Pagada hasta</label><input id="mb-vence" type="date"></div>
      <div><label for="mb-estado-sel">Estado</label><select id="mb-estado-sel"><option value="activa">Activa</option><option value="suspendida">Suspendida (como vencida)</option></select></div>
    </div>
    <h3>Lo que incluye</h3>
    <div class="toolbar">
      <div><label for="mb-ia">Respuestas de IA al mes <small class="muted">(vacío = sin tope, 0 = sin IA)</small></label><input id="mb-ia" type="number" min="0" placeholder="sin tope"></div>
      <div><label for="mb-usuarios">Cuentas del panel <small class="muted">(vacío = sin tope)</small></label><input id="mb-usuarios" type="number" min="1" placeholder="sin tope"></div>
      <div><label for="mb-campanas">Campañas por goteo</label><select id="mb-campanas"><option value="true">Incluidas</option><option value="false">No incluidas</option></select></div>
      <div><label for="mb-conectores">Conectores de tiendas</label><select id="mb-conectores"><option value="true">Incluidos</option><option value="false">No incluidos</option></select></div>
      <div><label for="mb-precio">Precio al mes</label><input id="mb-precio" type="number" min="0" step="0.01" placeholder="0"></div>
      <div><label for="mb-moneda">Moneda</label><input id="mb-moneda" list="mb-monedas" placeholder="PEN" maxlength="8" title="PEN = soles, USD = dólares"><datalist id="mb-monedas"><option value="PEN">Soles</option><option value="USD">Dólares</option></datalist></div>
    </div>
    <h3>Lo que ve el negocio</h3>
    <div class="toolbar">
      <div style="flex:2"><label for="mb-contacto">Cómo renovar (se muestra junto al aviso)</label><input id="mb-contacto" placeholder="Escríbenos al 987 654 321 para renovar"></div>
      <div style="flex:2"><label for="mb-aviso">Aviso propio (opcional; vacío = ninguno)</label><input id="mb-aviso" placeholder="Tu membresía se renueva el día 1"></div>
    </div>
    <div class="actions">
      <button id="mb-guardar">Guardar membresía</button>
      <button class="ghost" id="mb-quitar">Quitar la membresía (instancia libre)</button>
      <span id="mb-state" class="pill hidden"></span>
    </div>
    <h3 style="margin-top:22px">Apuntar un pago</h3>
    <p class="muted">Corre el vencimiento tantos meses desde la fecha en que está pagada (o desde hoy, si ya venció) y deja la membresía activa.</p>
    <div class="toolbar">
      <div><label for="mb-pago-meses">Meses</label><input id="mb-pago-meses" type="number" min="1" max="60" value="1"></div>
      <div><label for="mb-pago-monto">Monto</label><input id="mb-pago-monto" type="number" min="0" step="0.01" placeholder="49"></div>
      <div style="flex:2"><label for="mb-pago-nota">Nota (Yape, transferencia, factura…)</label><input id="mb-pago-nota" placeholder="Yape 18/09"></div>
      <div><label>&nbsp;</label><button id="mb-pagar">Apuntar pago</button></div>
    </div>
    <div id="mb-pagos" class="tablewrap" style="margin-top:10px"></div>
  </div>
  <p class="muted hidden" id="mb-solo-lectura">Solo un superadministrador cambia la membresía. Si vence o hay que ampliarla, habla con quien te instaló el sistema.</p>
  <div id="mb-maestro" class="hidden" style="margin-top:22px;border-top:1px solid var(--line);padding-top:14px">
    <h3>Esta instalación depende de un maestro</h3>
    <p class="muted">Si quien te vendió el sistema controla las tiendas desde su propio panel (Tiendas), pega aquí la dirección del plan y el token que te dio: esta instalación tomará su plan de allí y aquí no se edita nada.</p>
    <div id="mb-maestro-estado" class="muted" style="margin-bottom:8px"></div>
    <div class="toolbar">
      <div style="flex:2"><label for="mb-maestro-url">Dirección del plan</label><input id="mb-maestro-url" placeholder="https://panel-del-maestro/api/plan/mi-tienda"></div>
      <div style="flex:2"><label for="mb-maestro-token">Token de la tienda</label><input id="mb-maestro-token" type="password" autocomplete="off" placeholder="plt_…"></div>
      <div><label>&nbsp;</label><button id="mb-maestro-conectar">Conectar</button></div>
      <div><label>&nbsp;</label><button class="ghost hidden" id="mb-maestro-quitar">Desconectar</button></div>
    </div>
  </div>
</section>

<section id="tab-tiendas" class="card hidden">
  <h2>Tiendas</h2>
  <p class="muted">Cada negocio al que le pusiste el sistema tiene su propia instalación. Aquí las tienes todas: su plan, hasta cuándo está pagado, si está en línea; das de alta, apuntas pagos, suspendes o reactivas. Cada tienda toma su plan de aquí (su instalación pregunta cada cuarto de hora con su token).</p>
  <div id="ti-alojamiento" class="muted" style="margin:0 0 12px;padding:10px 12px;border:1px solid var(--line);border-radius:10px"></div>
  <div id="ti-resumen" class="grid" style="margin-bottom:14px"></div>
  <div id="ti-table" class="tablewrap"></div>
  <div id="ti-nueva" class="nueva-clave hidden">
    <b>Token de <span id="ti-nueva-nombre"></span>: cópialo ahora, no se volverá a mostrar.</b>
    <code id="ti-token"></code>
    <label>Dirección del plan</label><code id="ti-url-plan"></code>
    <ol id="ti-pasos" style="margin:8px 0 0;padding-left:20px;font-size:13.5px"></ol>
    <div class="actions" style="margin-top:8px"><button class="ghost sm" id="ti-copiar">Copiar el token</button><button class="ghost sm" id="ti-cerrar">Ya lo pegué</button></div>
  </div>

  <h3>Dar de alta una tienda</h3>
  <div class="toolbar">
    <div><label for="ti-nombre">Nombre del negocio</label><input id="ti-nombre" placeholder="Zapatería Lima"></div>
    <div><label for="ti-slug">Identificador <small class="muted">(vacío = del nombre)</small></label><input id="ti-slug" placeholder="zapateria-lima"></div>
    <div style="flex:2"><label for="ti-url">Dirección de su sistema de WhatsApp (opcional)</label><input id="ti-url" placeholder="https://zapateria.wa.tuservicio.com"></div>
    <div style="flex:2"><label for="ti-contacto">Contacto del negocio (opcional)</label><input id="ti-contacto" placeholder="Rosa · 987 654 321"></div>
  </div>
  <div class="toolbar">
    <div><label for="ti-plan">Plan</label><select id="ti-plan"></select></div>
    <div><label for="ti-vence">Pagada hasta</label><input id="ti-vence" type="date"></div>
    <div><label for="ti-precio">Precio al mes</label><input id="ti-precio" type="number" min="0" step="0.01"></div>
    <div><label for="ti-renovar">Cómo renovar (lo ve la tienda)</label><input id="ti-renovar" placeholder="Escríbenos al 987 654 321"></div>
    <div><label>&nbsp;</label><button id="ti-crear">Dar de alta</button></div>
  </div>
  <label class="hidden" id="ti-instalar-caja" style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" id="ti-instalar" checked> <b>Crear también su instalación ahora</b> <span class="muted">(su subdominio en este servidor, ya conectado a este panel; tarda un minuto)</span></label>
  <span id="ti-state" class="pill hidden"></span>
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

<section id="tab-stickers" class="card hidden">
  <h2>Stickers</h2>
  <p class="muted">Un toque humano después de un mensaje. Sube tus stickers (PNG, JPG, GIF o WebP: se convierten solos al formato de WhatsApp) y elige cuál sale
  <b>solo</b> tras el saludo, tras el "gracias" o en la despedida. Desde el chat se manda cualquiera con el botón 🙂, y una respuesta rápida puede llevar uno pegado.
  Con la API oficial de Meta solo salen dentro de las 24 h desde que el cliente escribió.</p>

  <h3>Subir un sticker</h3>
  <div class="toolbar">
    <div><label for="sk-archivo">Imagen</label><input id="sk-archivo" type="file" accept="image/png,image/jpeg,image/gif,image/webp"></div>
    <div><label for="sk-nombre">Nombre</label><input id="sk-nombre" placeholder="Hola con carita"></div>
    <div><label for="sk-uso">Para qué es</label><select id="sk-uso"></select></div>
    <div><label>&nbsp;</label><button id="sk-subir">Subir</button></div>
  </div>
  <span id="sk-state" class="pill hidden"></span>

  <h3>Biblioteca</h3>
  <div id="sk-grid" class="sk-grid"></div>

  <h3>Cuándo salen solos</h3>
  <div class="toolbar">
    <div><label for="sk-auto-inicio">Tras el saludo del asistente (primer mensaje a un cliente)</label><select id="sk-auto-inicio"></select></div>
    <div><label for="sk-auto-gracias">Tras el "gracias" (mandó su ubicación / ficha completa)</label><select id="sk-auto-gracias"></select></div>
    <div><label for="sk-auto-despedida">En la despedida (pasa al repartidor)</label><select id="sk-auto-despedida"></select></div>
  </div>
  <label class="inline" style="margin-top:8px"><input type="checkbox" id="sk-auto-reparto"> También tras el primer mensaje del reparto (la solicitud de ubicación)</label>
  <div class="actions"><button id="sk-guardar-auto">Guardar</button><span id="sk-auto-state" class="pill hidden"></span></div>
</section>

<section id="tab-pedidos" class="card hidden">
  <h2>Pedidos del chat</h2>
  <p class="muted">Cuando el asistente (o una persona desde Chats) cierra una venta, queda aqui con sus lineas, el total calculado con tu catalogo y los datos de entrega. Confirma cuando lo revises; con un webhook o la API, tu tienda lo recibe sola (evento <code>pedido.creado</code>).</p>
  <div class="toolbar">
    <div><label>Estado</label><select id="pd-estado"><option value="">Todos</option><option value="nuevo">Nuevos</option><option value="confirmado">Confirmados</option><option value="enviado_tienda">Enviados a la tienda</option><option value="cancelado">Cancelados</option></select></div>
    <div><label>&nbsp;</label><button class="ghost" id="pd-refrescar">Actualizar</button></div>
    <span id="pd-state" class="pill hidden"></span>
  </div>
  <div id="pd-table" class="tablewrap"></div>
</section>

<section id="tab-ia" class="card hidden">
  <style>
    .ia-pasos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 6px 0 16px; }
    @media (max-width: 900px) { .ia-pasos { grid-template-columns: 1fr; } }
    .ia-paso { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; font-size: 13.5px; }
    .ia-paso b { display: block; margin-bottom: 2px; }
    .ia-paso .estado { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: var(--muted); margin-right: 6px; vertical-align: middle; }
    .ia-paso .estado.ok { background: var(--ok); } .ia-paso .estado.bad { background: var(--bad); }
  </style>
  <h2>Asistente IA</h2>
  <p class="muted">Contesta solo a tus clientes por WhatsApp con lo que le cuentes de tu negocio. Cuando no sepa algo o el cliente pida hablar con alguien, se calla en ese chat y te avisa.
  Funciona con la IA de <a href="https://puter.com" target="_blank" rel="noopener">Puter</a> (una sola cuenta para GPT, Claude, Gemini y más) o con cualquier servicio de IA con clave (OpenAI, Groq, Google…).</p>
  <p class="muted" style="background:var(--chip);border-radius:10px;padding:10px 12px;margin:0 0 14px">🎓 <b>¿Quieres enseñarle a gran escala?</b> En <a href="/entrenamiento"><b>Entrenar a la IA</b></a> le das miles de ejemplos, datos y reglas: importas un Excel o un chat exportado, dejas que aprenda de tus conversaciones reales, la corriges desde el chat y la examinas en masa. Lo de aquí abajo es el resumen general del negocio; lo de allí, el detalle.</p>

  <div class="ia-pasos" id="ia-pasos">
    <div class="ia-paso"><b><span class="estado" id="ia-p1"></span>1. Con qué IA</b><span class="muted" id="ia-p1-t">Sin clave ni sesión todavía.</span></div>
    <div class="ia-paso"><b><span class="estado" id="ia-p2"></span>2. Qué sabe</b><span class="muted" id="ia-p2-t">Todavía no le contaste nada del negocio.</span></div>
    <div class="ia-paso"><b><span class="estado" id="ia-p3"></span>3. Encendido</b><span class="muted" id="ia-p3-t">Apagado: no contesta a nadie.</span></div>
  </div>
  <details id="ia-uso-caja" style="margin:0 0 16px">
    <summary style="cursor:pointer;font-weight:600">Uso de la IA <span class="muted" id="ia-uso-resumen" style="font-weight:400;font-size:12.5px"></span></summary>
    <div class="uso-ia" id="ia-uso"></div>
    <p class="muted" id="ia-uso-nota" style="margin:4px 0 0;font-size:12.5px"></p>
  </details>
  <div class="dos">
    <div>
      <h3>1. Con qué IA contesta</h3>
      <p class="muted" style="margin:0 0 6px">Elige un servicio, pega su clave y pulsa «Probar la conexión». Puter no necesita clave.</p>
      <label>Proveedor</label>
      <select id="ia-proveedor"><option value="puter">Puter (recomendado: un token para todos los modelos)</option><option value="openai">Una clave de API (OpenAI, Groq, Google, OpenRouter, DeepSeek, Ollama...)</option></select>
      <div id="ia-puter-caja">
        <p class="muted" style="margin:4px 0 8px">Sin claves ni tarjeta: pulsa el botón, entra con Google, Microsoft, Apple o correo (gratis) y listo. Los modelos Gemma 4 no cuestan nada.</p>
        <div class="actions"><button id="ia-puter-conectar" type="button">Conectar con Puter</button><span id="ia-puter-estado" class="muted"></span></div>
        <details style="margin-top:8px"><summary class="muted" style="cursor:pointer">O pegar la clave a mano</summary>
          <label>Clave de Puter <small class="muted">(en puter.com → Panel → Crear clave; ellos la llaman «token»)</small></label>
          <input id="ia-token" type="password" placeholder="Pegar aqui; se guarda cifrado y no se vuelve a mostrar" autocomplete="off">
        </details>
      </div>
      <div id="ia-openai-clave" class="hidden">
        <label>Servicio</label>
        <select id="ia-servicio"></select>
        <p id="ia-servicio-nota" class="muted" style="margin:4px 0 8px"></p>
        <label>Clave de la API</label>
        <input id="ia-token-openai" type="password" placeholder="sk-…; se guarda cifrada y no se vuelve a mostrar" autocomplete="off">
      </div>
      <p id="ia-token-estado" class="muted"></p>
      <div id="ia-openai" class="hidden"><label>URL base de la API <small class="muted">(la rellena el servicio elegido; cámbiala solo si usas otro)</small></label><input id="ia-baseurl" placeholder="https://api.openai.com/v1 · https://api.groq.com/openai/v1 · http://localhost:11434/v1"></div>
      <label>Modelo</label>
      <select id="ia-modelo-gratis"></select>
      <p id="ia-modelo-nota" class="muted" style="margin-top:4px">Solo modelos <b>completamente gratuitos</b> de Puter (no cuestan nada). Se comprueba con su lista cada hora.</p>
      <input id="ia-modelo" list="ia-modelos" placeholder="gpt-4o-mini" class="hidden"><datalist id="ia-modelos"></datalist>
      <div class="actions" style="margin-top:10px"><button class="ghost" id="ia-probar-conexion" type="button">Probar la conexión</button><span id="ia-conexion-estado" class="muted"></span></div>
      <h3 style="margin-top:18px">Cuándo pasar con una persona</h3>
      <label>Si el cliente escribe alguna de estas palabras (separadas por comas)</label>
      <input id="ia-derivar" placeholder="asesor, humano, persona, hablar con alguien, reclamo">
      <label style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" id="ia-avisar"> Avisarme por WhatsApp (al numero del supervisor de Configuracion) cuando pase con una persona</label>
      <label style="margin-top:10px">Cuantos mensajes anteriores recuerda</label>
      <input id="ia-memoria" type="number" min="0" max="40" value="12" style="width:100px">
    </div>
    <div>
      <h3>2. Qué sabe de tu negocio</h3>
      <p class="muted" style="margin:0 0 6px">Escríbelo como se lo contarías a un empleado nuevo. Para enseñarle a gran escala (Excel, chats), ve a <a href="/entrenamiento">Entrenar a la IA</a>.</p>
      <label>Cómo se llama el asistente</label>
      <input id="ia-nombre" placeholder="Lucia">
      <label>Lo que sabe (escríbelo como se lo contarías a un empleado nuevo)</label>
      <textarea id="ia-conocimiento" rows="12" placeholder="Somos una zapateria en Miraflores. Vendemos zapatos de vestir y zapatillas, tallas 35 a 45.&#10;Precios: zapatos de vestir desde S/ 120, zapatillas desde S/ 90.&#10;Envio a todo Lima en 24 h, gratis desde S/ 150. Provincias 2-3 dias.&#10;Cambios dentro de 7 dias con boleta.&#10;Pagos: Yape, Plin, transferencia y tarjeta al recibir.&#10;Horario: lunes a sabado de 9 a 19."></textarea>
      <label>Cómo debe hablar (opcional)</label>
      <textarea id="ia-instrucciones" rows="3" placeholder="Tutea, se breve, usa un emoji como mucho. Si preguntan por stock exacto, di que lo confirmamos en un momento."></textarea>
      <div class="solo-completo">
      <h3 style="margin-top:18px">Tu catálogo real (opcional)</h3>
      <p class="muted">La dirección de los productos de tu tienda online: el asistente da precio, stock y enlace de productos que existen, y puede tomar pedidos. Entiende la tienda de Elysian, WooCommerce o una lista simple con código, nombre, precio, stock y enlace de cada producto.</p>
      <div class="toolbar">
        <div style="flex:2"><label>Dirección del catálogo</label><input id="ia-catalogo-url" placeholder="https://elysian.pe/api/products"></div>
        <div><label>Formato</label><select id="ia-catalogo-formato"><option value="auto">Detectar solo</option><option value="elysian">Elysian</option><option value="woocommerce">WooCommerce</option><option value="simple">Lista simple</option></select></div>
        <div><label>&nbsp;</label><button class="ghost" id="ia-catalogo-probar">Probar</button></div>
      </div>
      <p id="ia-catalogo-estado" class="muted"></p>
      </div>
    </div>
  </div>
  <h3 style="margin-top:18px">3. Encender y guardar</h3>
  <div class="actions">
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="ia-activa"> <b>Asistente encendido</b> <span class="muted" style="font-weight:400">(contesta solo a quien escribe; lo del reparto y las entregas sigue igual)</span></label>
    <button id="ia-guardar">Guardar</button>
    <span id="ia-state" class="pill hidden"></span>
  </div>

  <h3 style="margin-top:24px">Pruébalo aquí</h3>
  <p class="muted">Escribe como si fueras un cliente. No sale nada por WhatsApp; usa lo que guardaste arriba.</p>
  <div id="ia-chat" class="ia-chat"><div class="muted" style="padding:10px">Guarda primero y escribe abajo.</div></div>
  <div class="toolbar" style="margin-top:8px">
    <div style="flex:1"><input id="ia-probar-texto" placeholder="Hola, ¿tienen zapatillas talla 42?"></div>
    <div><button class="ghost" id="ia-probar">Enviar</button></div>
    <div><button class="ghost sm" id="ia-probar-limpiar">Empezar de nuevo</button></div>
  </div>

  <h3 style="margin-top:24px" id="ia-voz-titulo">🎤 Voz: contestar con audios y entender los del cliente</h3>
  <p class="muted">Con una cuenta de <a href="https://elevenlabs.io" target="_blank" rel="noopener">ElevenLabs</a> (tiene plan gratis), el asistente puede contestar con <b>notas de voz</b> con la voz que elijas, y <b>entender los audios</b> que manda el cliente (se transcriben: los lee el asistente, se ven escritos en el chat y salen por la API). Otros sistemas conectados (Stoky) solo piden «mándalo con voz»: la voz se elige aquí. Si algo falla (se acaba el plan, el mensaje es muy largo), el mensaje sale por escrito: la voz nunca deja a un cliente sin respuesta.</p>
  <div id="voz-estado-caja" class="muted" style="margin:0 0 12px;padding:10px 12px;border:1px solid var(--line);border-radius:10px"></div>
  <div class="dos">
    <div>
      <label>Clave de ElevenLabs <small class="muted">(elevenlabs.io → tu perfil → API Keys)</small></label>
      <div class="toolbar">
        <div style="flex:1"><input id="voz-clave" type="password" placeholder="Pegar aquí; se guarda cifrada y no se vuelve a mostrar" autocomplete="off"></div>
        <div><button class="ghost" id="voz-probar" type="button">Comprobar</button></div>
      </div>
      <p id="voz-clave-estado" class="muted" style="margin:4px 0 10px"></p>
      <label>Voz</label>
      <div class="toolbar">
        <div style="flex:1"><select id="voz-voz"><option value="">Guarda la clave para ver tus voces</option></select></div>
        <div><button class="ghost" id="voz-escuchar" type="button">Escuchar</button></div>
      </div>
      <p id="voz-voz-nota" class="muted" style="margin:4px 0 10px"></p>
      <label>Calidad</label>
      <select id="voz-modelo"></select>
      <p id="voz-modelo-nota" class="muted" style="margin:4px 0 10px"></p>
    </div>
    <div>
      <label>Cuándo contesta el asistente con audio</label>
      <select id="voz-cuando">
        <option value="si-manda-audio">Cuando el cliente manda un audio (recomendado)</option>
        <option value="siempre">Siempre</option>
        <option value="nunca">Nunca por su cuenta (solo si otro sistema lo pide)</option>
      </select>
      <label style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" id="voz-transcribir" checked> <b>Entender los audios del cliente</b> <span class="muted">(se transcriben al llegar)</span></label>
      <label style="margin-top:12px">Largo máximo de un audio (caracteres)</label>
      <input id="voz-max" type="number" min="50" max="5000" value="600" style="width:120px">
      <p class="muted" style="margin:4px 0 0">Un mensaje más largo sale por escrito: un audio de tres minutos no lo escucha nadie. Los mensajes con enlaces también van por escrito.</p>
    </div>
  </div>
  <div class="actions" style="margin-top:14px">
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="voz-activa"> <b>Voz encendida</b></label>
    <button id="voz-guardar">Guardar la voz</button>
    <span id="voz-state" class="pill hidden"></span>
  </div>
  <audio id="voz-player" class="hidden" controls></audio>

  <h3 style="margin-top:24px">Examen: clientes de prueba</h3>
  <p class="muted">Decenas de clientes distintos (el que regatea, el que ya pagó, el enojado, el que intenta engañar al asistente...) escritos como en la vida real. El asistente responde con lo que sabe de tu negocio y cada respuesta se revisa sola: que no invente precios, que no prometa descuentos, que pase con una persona cuando toca, que no se vaya de largo. Corre un grupo cada vez (tarda unos segundos por cliente).</p>
  <div class="toolbar">
    <div><label>Grupo</label><select id="ia-esc-grupo"></select></div>
    <div><label>&nbsp;</label><button class="ghost" id="ia-esc-correr">Correr el examen</button></div>
    <span id="ia-esc-state" class="pill hidden"></span>
  </div>
  <div id="ia-esc-resumen" class="muted" style="margin:8px 0"></div>
  <div id="ia-esc-table" class="tablewrap"></div>

  <h3 style="margin-top:24px">Seguridad: que no lo confundan ni le saquen el sistema</h3>
  <p class="muted">Hay defensas fijas alrededor del modelo, que no dependen de que "se porte bien": los intentos claros de sacarlo de su papel, de sacarle sus instrucciones, de pedir tokens o accesos, de hacerse pasar por el dueño o por el sistema, de pedir datos de otras personas o de que escriba a otros números <b>no llegan al modelo</b> (se contestan con una frase fija; tres seguidos pasan el chat a una persona). Lo que va a salir se revisa antes de salir (instrucciones, secretos, teléfonos ajenos no salen). Hay un tope de turnos por cliente y hora. Y el asistente solo puede pedir la ubicación y pasar con una persona: no tiene con qué hacer nada más. El grupo <b>Ataques al asistente</b> del examen es una muestra; el banco entero (miles de variantes) corre en las pruebas del sistema. <a href="/manual#m-seguridad-ia">Más en el manual</a>.</p>
  <p class="muted">Para darle órdenes al sistema con palabras (poner números en la lista de envío automático, escribir a un cliente, ver cómo va el reparto…) está la <b>IA operadora</b>: el botón <b>IA</b> de arriba, en todas las pantallas. Usa esta misma conexión.</p>
</section>

<section id="tab-integraciones" class="card hidden">
  <h2>Stoky: tu inventario y tus ventas</h2>
  <p class="muted">Stoky y este WhatsApp se conectan <b>en dos direcciones</b>, y las dos se configuran desde las pantallas, sin tocar código. Aquí se ve cómo está cada una y qué falta.</p>
  <div class="stk">
    <div class="caja-stk">
      <h3><span class="paso-n">1</span>Stoky escribe y lee por este WhatsApp</h3>
      <p class="muted">Desde su CRM, Stoky manda mensajes, ve la bandeja, enseña el QR para vincular el número y le da órdenes a la IA de aquí. Para eso necesita <b>la dirección de este sistema</b> y <b>una clave</b>, que se pegan en Stoky.</p>
      <div class="semaforo" id="stk-hacia-aqui"><div><i></i><span>Cargando…</span></div></div>
      <div class="actions"><button id="cc-crear-stoky">Crear un código de conexión</button><button class="ghost" id="stk-clave">O crear la clave a mano</button></div>
      <p class="muted" style="font-size:12.5px;margin:6px 0 0">El código es corto (WA-XXXX-XXXX), <b>caduca</b> en la fecha que elijas y vale una sola vez: se pega en Stoky y Stoky recibe su clave solo. La clave a mano es para sistemas que no saben canjear códigos.</p>
      <div id="cc-nuevo" class="nueva-clave hidden">
        <b>Código de conexión: <code id="cc-valor" style="display:inline;font-size:16px;padding:4px 10px"></code></b>
        <ol id="cc-pasos" style="margin:8px 0 0;padding-left:20px;font-size:13.5px"></ol>
        <div class="actions" style="margin-top:8px"><button class="ghost sm" id="cc-copiar">Copiar el código</button><button class="ghost sm" id="cc-cerrar">Listo</button></div>
      </div>
      <div id="stk-clave-nueva" class="nueva-clave hidden">
        <b>Copia la clave ahora: no se volverá a mostrar.</b>
        <code id="stk-clave-valor"></code>
        <ol id="stk-clave-pasos"></ol>
        <div class="actions" style="margin-top:8px"><button class="ghost sm" id="stk-clave-copiar">Copiar la clave</button><button class="ghost sm" id="stk-clave-cerrar">Ya la pegué en Stoky</button></div>
      </div>
    </div>
    <div class="caja-stk">
      <h3><span class="paso-n">2</span>Este WhatsApp consulta el catálogo de Stoky</h3>
      <p class="muted">El asistente da <b>precios y stock reales</b>, toma pedidos con ellos y manda a registrar la venta en el panel de Stoky. Hace falta la dirección de Stoky y un <b>token de Stoky</b> (Stoky → Integraciones → Conexiones de tienda). Si vinculaste desde la pantalla de Stoky, esto ya llega relleno solo.</p>
      <div class="semaforo" id="stk-hacia-stoky"><div><i></i><span>Cargando…</span></div></div>
      <label>Dirección de Stoky (la API que consulta este servidor)</label>
      <input id="stk-url" placeholder="http://localhost:8102">
      <label>Dirección del panel de Stoky (la que abres en el navegador; vacío = la misma)</label>
      <input id="stk-panel" placeholder="https://stoky.miempresa.com">
      <label>Token de Stoky <small class="muted">(empieza por stk_; se guarda cifrado y no se vuelve a mostrar)</small></label>
      <input id="stk-token" type="password" autocomplete="off" placeholder="Vacío = conservar el que ya hay">
      <div class="actions" style="margin-top:10px"><button class="ghost" id="stk-probar">Probar</button><button id="stk-guardar">Guardar y conectar</button><button class="ghost sm" id="stk-quitar">Quitar la conexión</button><span id="stk-state" class="pill hidden"></span></div>
    </div>
  </div>

  <h2 style="margin-top:28px">Códigos de conexión</h2>
  <p class="muted">Para conectar otro sistema sin copiar claves largas: un código corto con <b>fecha límite</b> y un número de usos. El otro sistema lo canjea (<code>POST /api/v1/conexion/canjear</code> con <code>{"codigo": "WA-…"}</code>) y recibe su clave de API con los permisos que marques. Al caducar o usarse deja de valer; la clave que salió se revoca en Claves de API.</p>
  <div id="cc-table" class="tablewrap"></div>
  <h3>Nuevo código</h3>
  <div class="toolbar">
    <div><label>Para quién es</label><input id="cc-para" placeholder="Stoky"></div>
    <div><label>Vale hasta</label><input id="cc-hasta" type="date"></div>
    <div><label>o durante</label><select id="cc-dias"><option value="">— usar la fecha —</option><option value="0.0417">1 hora</option><option value="1">1 día</option><option value="7" selected>7 días</option><option value="30">30 días</option><option value="90">90 días</option></select></div>
    <div><label>Usos</label><select id="cc-usos"><option value="1">1 (recomendado)</option><option value="2">2</option><option value="5">5</option><option value="10">10</option></select></div>
    <div><label>&nbsp;</label><button id="cc-crear">Crear código</button></div>
  </div>
  <label>Qué podrá hacer la clave que salga</label>
  <p class="muted">Sin marcar nada, todo (lo que necesita Stoky). Con permisos marcados, solo la API pública y solo lo marcado.</p>
  <div id="cc-permisos" class="permisos"></div>
  <span id="cc-state" class="pill hidden"></span>

  <h2 style="margin-top:28px">Claves de API</h2>
  <p class="muted">Con una clave, un programa (el sistema de GSG, un script) entra en la API sin usuario ni contrasena.
  La clave se ve entera <b>una sola vez</b>, al crearla; despues solo su comienzo. Revocarla la apaga al instante.
  Una clave no puede crear usuarios ni otras claves.</p>
  <div id="ck-table" class="tablewrap"></div>

  <h3>Nueva clave</h3>
  <div class="toolbar">
    <div><label>Para quien es</label><input id="ck-nombre" placeholder="Stoky"></div>
    <div><label>&nbsp;</label><button id="ck-crear">Crear clave</button></div>
  </div>
  <label>Que puede hacer</label>
  <p class="muted">Sin marcar nada, la clave lo puede todo (incluida la API interna del panel). Con permisos marcados, solo entra por la API publica <code>/api/v1</code> y solo a lo marcado.</p>
  <div id="ck-permisos" class="permisos"></div>
  <span id="ck-state" class="pill hidden"></span>
  <div id="ck-nueva" class="nueva-clave hidden">
    <b>Copia la clave ahora: no se volvera a mostrar.</b>
    <code id="ck-valor"></code>
    <div class="actions" style="margin-top:8px"><button class="ghost sm" id="ck-copiar">Copiar</button><button class="ghost sm" id="ck-cerrar">Ya la guarde</button></div>
  </div>

  <h3>Como se usa</h3>
  <p class="muted">Cabecera <code>Authorization: Bearer &lt;clave&gt;</code>. La API publica esta en <code>/api/v1</code> y su contrato en <a href="/api/v1/openapi.json" target="_blank"><code>/api/v1/openapi.json</code></a>. Por ejemplo:</p>
  <pre id="ck-ejemplo"></pre>
  <p class="muted">Una clave sin permisos acotados entra ademas en <code>/admin/*</code>. Para el reparto: <code>POST /admin/rutas/lotes</code> carga la lista del dia, <code>GET /admin/rutas/solicitudes</code> devuelve el avance,
  <code>GET /admin/rutas/cola</code> los reportes pendientes para GSG. El detalle esta en el README, secciones "Integrar otro sistema" y "Conectar el sistema de GSG".</p>

  <h2 style="margin-top:28px">Webhooks salientes</h2>
  <p class="muted">Para que otro sistema <b>se entere</b> de lo que pasa aqui: cuando llega un mensaje, se entrega, un cliente manda su ubicacion o se da de baja, se le manda un POST firmado a su URL.
  Si su servidor esta caido se reintenta (1 min, 5, 30, 2 h, 12 h); tras un dia entero sin una entrega buena, el webhook se apaga solo y avisa en la campana.</p>
  <div id="wh-table" class="tablewrap"></div>

  <h3>Nuevo webhook</h3>
  <div class="toolbar">
    <div style="flex:2"><label>URL que recibe el POST</label><input id="wh-url" placeholder="https://stoky.app/webhooks/whatsapp"></div>
    <div><label>Para quien es</label><input id="wh-descripcion" placeholder="Stoky"></div>
    <div><label>&nbsp;</label><button id="wh-crear">Registrar webhook</button></div>
  </div>
  <label>Que eventos quiere recibir</label>
  <p class="muted">Sin marcar nada, recibe todos.</p>
  <div id="wh-eventos" class="permisos"></div>
  <span id="wh-state" class="pill hidden"></span>
  <div id="wh-nuevo" class="nueva-clave hidden">
    <b>Copia el secreto ahora: no se volvera a mostrar.</b> Con el, el otro sistema comprueba la firma <code>X-Firma</code> de cada entrega.
    <code id="wh-secreto"></code>
    <div class="actions" style="margin-top:8px"><button class="ghost sm" id="wh-copiar">Copiar</button><button class="ghost sm" id="wh-cerrar">Ya lo guarde</button></div>
  </div>
  <div id="wh-entregas" class="hidden">
    <h3>Ultimas entregas de <span id="wh-entregas-de"></span></h3>
    <div id="wh-entregas-table" class="tablewrap"></div>
  </div>

  <h2 style="margin-top:28px">Conectores de tiendas (WooCommerce, Shopify)</h2>
  <p class="muted">Para tiendas que ya existen y no van a tocar su codigo: la tienda avisa sola de cada pedido (creado, pagado, enviado...) y de aqui sale el WhatsApp que diga la regla.
  Se crea el conector, se pega su URL en la tienda con el secreto, y se elige que mensaje sale con cada evento.</p>
  <div id="cn-table" class="tablewrap"></div>

  <h3>Nuevo conector</h3>
  <div class="toolbar">
    <div><label>Tienda</label><select id="cn-tipo"><option value="woocommerce">WooCommerce (WordPress)</option><option value="shopify">Shopify</option></select></div>
    <div><label>Nombre</label><input id="cn-nombre" placeholder="Tienda online"></div>
    <div id="cn-secreto-caja" class="hidden"><label>Secreto que ensena Shopify</label><input id="cn-secreto" placeholder="Configuracion → Notificaciones → Webhooks"></div>
    <div><label>&nbsp;</label><button id="cn-crear">Crear conector</button></div>
  </div>
  <span id="cn-state" class="pill hidden"></span>
  <div id="cn-nuevo" class="nueva-clave hidden">
    <b>Pega esto en la tienda.</b>
    <div id="cn-instrucciones" class="muted" style="margin-top:6px"></div>
    <label style="margin-top:8px">URL del webhook</label><code id="cn-url"></code>
    <div id="cn-secreto-bloque"><label>Secreto (se ve una sola vez)</label><code id="cn-secreto-valor"></code></div>
    <div class="actions" style="margin-top:8px"><button class="ghost sm" id="cn-cerrar">Ya lo pegue</button></div>
  </div>

  <div id="cn-reglas" class="hidden">
    <h3>Que mensaje sale con cada evento de <span id="cn-reglas-de"></span></h3>
    <p class="muted">Variables: <code>{nombre}</code> <code>{numero}</code> <code>{total}</code> <code>{moneda}</code> <code>{estado}</code> <code>{tienda}</code> <code>{seguimiento}</code> <code>{items}</code>.
    Con la API de Meta sale la plantilla (fuera de 24 h el texto no puede salir); con el QR o WAHA, el texto.</p>
    <div id="cn-reglas-table" class="tablewrap"></div>
    <div class="toolbar" style="margin-top:10px">
      <div><label>Probar con un telefono</label><input id="cn-probar-tel" placeholder="51987654321"></div>
      <div><label>Evento</label><select id="cn-probar-evento"></select></div>
      <div><label>&nbsp;</label><button class="ghost" id="cn-probar">Mandar prueba</button></div>
      <div><label>&nbsp;</label><button id="cn-guardar-reglas">Guardar reglas</button></div>
    </div>
    <span id="cn-reglas-state" class="pill hidden"></span>
  </div>
  <div id="cn-entradas" class="hidden">
    <h3>Ultimos pedidos que llegaron de <span id="cn-entradas-de"></span></h3>
    <div id="cn-entradas-table" class="tablewrap"></div>
  </div>

  <h2 style="margin-top:28px">Chat embebido en otra web</h2>
  <p class="muted">La pantalla de chat, dentro de la web de otro sistema (Stoky, una tienda, un CRM): se atiende WhatsApp sin salir de ahi.
  La otra web pega <code>embed.js</code> y le pasa un <b>token</b> que su servidor pide con una clave que tenga el permiso <code>embed:emitir</code>. La clave nunca llega al navegador; el token si, y caduca.</p>
  <label>Webs que pueden embeber el chat (una por linea, con https://)</label>
  <textarea id="em-dominios" rows="3" placeholder="https://stoky.app&#10;https://tienda.ejemplo.com"></textarea>
  <p class="muted">Sin ninguna, ningun sitio ajeno puede enmarcar el chat aunque tenga un token. Solo un administrador lo cambia.</p>
  <div class="actions"><button id="em-guardar">Guardar</button><span id="em-state" class="pill hidden"></span></div>
  <h3>Como se pega</h3>
  <pre id="em-ejemplo"></pre>
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
  configuracion: loadConfiguracion, 'mi-cuenta': loadMiCuenta, actividad: loadActividad, stickers: loadStickers, ia: loadIa, pedidos: loadPedidos,
  membresia: loadMembresia, tiendas: loadTiendas
};
/* Al cambiar entre modo sencillo y ver todo, la lista de primeros pasos cambia. */
window.__alCambiarModo = function () { if (typeof loadInicio === 'function' && (location.hash === '#inicio' || !location.hash)) loadInicio(); };
/* Lo que se refresca cada vez que se entra, no solo la primera. */
var SIEMPRE = { inicio: true, estado: true, configuracion: true, actividad: true, pedidos: true, membresia: true, usuarios: true, tiendas: true };
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
    out += '<rect x="' + (x0 + ancho / 2 - bw - 2) + '" y="' + (arriba + alto - hs) + '" width="' + bw + '" height="' + hs + '" rx="3" style="fill:var(--primario)"><title>' + d.dia + ': salieron ' + d.salientes + '</title></rect>';
    out += '<rect x="' + (x0 + ancho / 2 + 2) + '" y="' + (arriba + alto - he) + '" width="' + bw + '" height="' + he + '" rx="3" style="fill:var(--gris-claro)"><title>' + d.dia + ': entraron ' + d.entrantes + '</title></rect>';
    var f = new Date(d.dia + 'T12:00:00');
    out += '<text x="' + (x0 + ancho / 2) + '" y="' + (H - 8) + '" font-size="11" text-anchor="middle" fill="currentColor" fill-opacity=".7">' + DIAS[f.getDay()] + ' ' + f.getDate() + '</text>';
  });
  return out + '</svg>';
}
var pasosDesplegados = false;
function pintarPasosGsg(p) {
  var oficial = p.proveedor === 'cloud';
  var moto = p.motorizadosActivos;
  var pedidos = p.entregasHoy || 0;
  var pasos = [
    { hecho: p.conectado, titulo: 'Conectar el WhatsApp', que: p.conectado ? (oficial ? 'La API de Meta ya responde.' : 'El teléfono está vinculado.') : (oficial ? 'La API de Meta no responde todavía.' : 'Escanea el QR desde el teléfono, como en WhatsApp Web.'), href: '/setup', boton: p.conectado ? 'Ver la conexión' : 'Conectar' },
    { hecho: moto > 0, titulo: 'Dar de alta a los motorizados', que: moto > 0 ? moto + ' activo' + (moto === 1 ? '' : 's') + '. Son quienes reciben los pines y dicen en cuánto entregan.' : 'Ninguno todavía: sin motorizados, los pedidos listos no pueden salir.', href: '/motorizados', boton: moto > 0 ? 'Ver motorizados' : 'Dar de alta' },
    { hecho: p.supervisor === true, titulo: '¿A quién avisamos cuando algo necesita a alguien?', que: p.supervisor === true ? 'Ese WhatsApp recibe las incidencias, el resumen de la mañana y de la tarde y la prueba diaria.' : 'Sin un número, nadie se entera de las incidencias, ni llegan los resúmenes ni la prueba de la mañana.', href: '/panel#configuracion', boton: p.supervisor === true ? 'Cambiar el número' : 'Poner mi número', accion: 'supervisor', ocultar: p.supervisor === undefined },
    { hecho: p.gsg === 'real' || p.gsg === 'simulador' || pedidos > 0, titulo: 'Traer los pedidos del día', que: p.gsg === 'real' ? 'GSG está conectado: los pedidos entran solos cada 5 minutos.' : p.gsg === 'simulador' ? 'Con el simulador de GSG (para probar). Cuando GSG tenga API, se conecta en Conexión.' : pedidos > 0 ? 'Hoy hay ' + pedidos + ' pedido' + (pedidos === 1 ? '' : 's') + ' cargados a mano.' : 'Conecta GSG en Conexión, o pega la lista del día en Hoy.', href: p.gsg === 'ninguna' ? '/setup' : '/hoy', boton: p.gsg === 'ninguna' ? 'Conectar GSG' : 'Ir a Hoy', alt: p.gsg === 'ninguna' ? { href: '/hoy', boton: 'Pegar la lista en Hoy' } : null },
    { hecho: p.ia === true, titulo: 'Encender el asistente IA (opcional)', que: p.ia === true ? 'Contesta solo a los clientes y lee las respuestas dudosas.' : 'Lee las respuestas dudosas de clientes y motorizados, y contesta solo. Sin él, todo sigue funcionando por reglas.', href: '/panel#ia', boton: p.ia === true ? 'Ver el asistente' : 'Encender', opcional: true, ocultar: p.iaDisponible === false }
  ].filter(function (x) { return !x.ocultar; });
  var obligatorios = pasos.filter(function (x) { return !x.opcional; });
  var todo = obligatorios.every(function (x) { return x.hecho; });
  var card = document.getElementById('in-pasos-card');
  card.classList.remove('hidden');
  document.getElementById('in-pasos-titulo').textContent = todo ? 'Todo listo' : 'Para empezar';
  var linea = document.getElementById('in-pasos-listo');
  var sub = document.getElementById('in-pasos-sub');
  var lista = document.getElementById('in-pasos');
  if (todo && !pasosDesplegados) {
    linea.classList.remove('hidden'); sub.classList.add('hidden'); lista.classList.add('hidden');
    linea.innerHTML = '<b>✓</b><span>WhatsApp conectado · ' + moto + ' motorizado' + (moto === 1 ? '' : 's') + (p.supervisor === true ? ' · avisos al supervisor' : '') + ' · ' + esc(p.gsg === 'real' ? 'GSG conectado' : p.gsg === 'simulador' ? 'simulador de GSG' : 'pedidos cargados a mano') + (p.ia === true ? ' · asistente IA encendido' : '') + '</span><a id="in-pasos-ver">Ver los pasos</a>';
    document.getElementById('in-pasos-ver').onclick = function () { pasosDesplegados = true; pintarPasosGsg(p); };
    return;
  }
  linea.classList.add('hidden'); sub.classList.toggle('hidden', todo); lista.classList.remove('hidden');
  lista.innerHTML = pasos.map(function (x, i) {
    return '<li class="' + (x.hecho ? 'hecho' : '') + '"><i>' + (x.hecho ? '✓' : (i + 1)) + '</i><div><b>' + esc(x.titulo) + '</b><small>' + esc(x.que) + '</small><a class="ir" href="' + esc(x.href) + '"' + (x.accion ? ' data-accion="' + esc(x.accion) + '"' : '') + '>' + esc(x.boton) + '</a>' + (x.alt ? ' <a class="ir" href="' + esc(x.alt.href) + '">' + esc(x.alt.boton) + '</a>' : '') + '</div></li>';
  }).join('') + (todo ? '<li style="border-style:dashed"><i>✓</i><div><b>Todo listo</b><small><a id="in-pasos-plegar" style="cursor:pointer">Plegar</a></small></div></li>' : '');
  var plegar = document.getElementById('in-pasos-plegar');
  if (plegar) plegar.onclick = function () { pasosDesplegados = false; pintarPasosGsg(p); };
  var botonSup = lista.querySelector('[data-accion="supervisor"]');
  if (botonSup) botonSup.onclick = function (ev) { ev.preventDefault(); pedirSupervisor(); };
}
/* El WhatsApp que recibe los avisos: un cuadro con el número (9 cifras, el 51 se pone solo). */
async function pedirSupervisor() {
  var numero = await pedirDato({ titulo: 'Tu WhatsApp para los avisos', texto: 'A este número llegan las incidencias, el resumen de la mañana y de la tarde y la prueba diaria. Suele ser el del coordinador.', etiqueta: 'Número de WhatsApp', prefijo: '+51', marcador: '987 654 321', boton: 'Guardar', validar: function (v) { return /^9\d{8}$/.test(String(v || '').replace(/\D/g, '')) ? null : 'Escribe los 9 dígitos del celular (empieza por 9).'; } });
  if (!numero) return;
  try {
    await api('/admin/ajustes', { method: 'POST', body: { avisos: { supervisor: '51' + String(numero).replace(/\D/g, '') } } });
    show('state', 'Listo: los avisos van a +51 ' + String(numero).replace(/\D/g, '').replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3') + '.', 'ok');
    loadInicio();
  } catch (error) { show('state', error.message, 'bad'); }
}
function pintarPasos(p) {
  if (!p) return;
  var modoGsg = p.modo === 'gsg' || window.__modoSistema === 'gsg';
  if (modoGsg) { pintarPasosGsg(p); return; }
  var oficial = p.proveedor === 'cloud';
  var avanzado = window.__modoAvanzado === true;
  // Lo que una tienda necesita para arrancar son tres cosas; el resto es del
  // modo avanzado (reparto, campañas, equipo).
  var pasos = [
    { hecho: p.conectado, titulo: 'Conectar tu WhatsApp', que: oficial ? 'La API de Meta ya responde.' : 'Escanea el QR desde el teléfono, como en WhatsApp Web.', href: '/setup' },
    { hecho: p.ia === true, titulo: 'Enseñarle a tu asistente IA', que: 'Cuéntale qué vendes y enciéndelo: contestará solo.', href: '/panel#ia', ocultar: p.iaDisponible === false },
    { hecho: p.lecciones > 0, titulo: 'Entrenarla con tus propios ejemplos', que: 'Importa un Excel, corrígela desde el chat o deja que aprenda de tus conversaciones.', href: '/entrenamiento', ocultar: p.lecciones === null || p.lecciones === undefined || p.iaDisponible === false, opcional: true },
    { hecho: Boolean(p.stoky && p.stoky.configurada && p.stoky.claveUsada), titulo: 'Conectar Stoky (si lo usas)', que: 'Crea la clave para Stoky y pega su token: precios, stock y ventas van y vienen solos.', href: '/panel#integraciones', soloAdmin: true, opcional: true, ocultar: !p.stoky },
    { hecho: false, titulo: 'Poner el chat en tu web o conectar tu tienda', que: 'Una línea en tu web, o pega la URL en WooCommerce/Shopify.', href: '/panel#integraciones', soloAdmin: true, opcional: true },
    { hecho: p.usuarios > 1, titulo: 'Crear las cuentas del equipo', que: 'Una por persona, con su rol.', href: '/panel#usuarios', soloAdmin: true, avanzado: true },
    { hecho: p.plantillas > 0, titulo: oficial ? 'Dar de alta las plantillas' : 'Crear plantillas propias (opcional)', que: oficial ? 'Meta tiene que aprobarlas.' : 'Con el QR no hacen falta; ordenan los textos.', href: '/panel#plantillas', avanzado: true },
    { hecho: p.contactos > 0, titulo: 'Cargar contactos con su consentimiento', que: 'Sin opt-in no sale nada iniciado por ti.', href: '/panel#contactos', avanzado: true },
    { hecho: p.lotes > 0, titulo: 'Cargar el primer reparto', que: 'Pega la lista del día y pulsa Empezar a pedir.', href: '/rutas', avanzado: true }
  ];
  var esAdmin = !window.__yo || window.__yo.rol === 'admin';
  pasos = pasos.filter(function (x) { return (!x.soloAdmin || esAdmin) && !x.ocultar && (!x.avanzado || avanzado); });
  // Los opcionales no bloquean: la tarjeta desaparece cuando lo obligatorio esta.
  var obligatorios = pasos.filter(function (x) { return !x.opcional; });
  if (obligatorios.every(function (x) { return x.hecho; })) pasos = [];
  var pendientes = pasos.filter(function (x) { return !x.hecho; });
  var card = document.getElementById('in-pasos-card');
  card.classList.toggle('hidden', pendientes.length === 0);
  document.getElementById('in-pasos-titulo').textContent = 'Para empezar';
  document.getElementById('in-pasos-listo').classList.add('hidden');
  document.getElementById('in-pasos-sub').classList.remove('hidden');
  document.getElementById('in-pasos').classList.remove('hidden');
  if (!pendientes.length) return;
  document.getElementById('in-pasos').innerHTML = pasos.map(function (x, i) {
    return '<li class="' + (x.hecho ? 'hecho' : '') + '"><i>' + (x.hecho ? '✓' : (i + 1)) + '</i><div><b>' + (x.hecho ? esc(x.titulo) : '<a href="' + esc(x.href) + '">' + esc(x.titulo) + '</a>') + '</b><small>' + esc(x.que) + '</small></div></li>';
  }).join('');
}
/* Los accesos rápidos: en modo GSG solo lo que se ve en el menú; en el completo, lo de siempre. */
var ACCESOS_GSG = [
  ['/hoy', 'Ver los pedidos de hoy', 'Quién falta, quién va en camino'],
  ['/chat', 'Abrir los chats', 'Responder a los clientes'],
  ['/motorizados', 'Dar de alta un motorizado', 'Nombre, WhatsApp y zona'],
  ['/hoy#caja-pegar', 'Pegar la lista del día', 'Si GSG no está conectado'],
  ['/mapa', 'Ver el mapa del día', 'Pedidos y motorizados'],
  ['/hoy#caja-sim', 'Probar sin clientes reales', 'Con los 10 números ficticios']
];
var ACCESOS_COMPLETO = [
  ['/chat', 'Abrir los chats', 'Responder a los clientes'],
  ['/rutas', 'Cargar el reparto', 'Pegar la lista del día'],
  ['/panel#campanas', 'Nueva campaña', 'Por goteo, con canario'],
  ['/panel#enviar', 'Enviar un mensaje', 'A un número concreto'],
  ['/panel#plantillas', 'Plantillas', 'Crear o sincronizar'],
  ['/setup', 'Conexión', 'QR, WAHA o Meta']
];
function pintarAccesos(modoGsg) {
  var caja = document.getElementById('in-accesos');
  if (!caja) return;
  caja.innerHTML = (modoGsg ? ACCESOS_GSG : ACCESOS_COMPLETO).map(function (a) {
    return '<a href="' + esc(a[0]) + '">' + esc(a[1]) + '<small>' + esc(a[2]) + '</small></a>';
  }).join('');
}
var NIVEL_TXT = { verde: 'Todo en orden', amarillo: 'Con cuidado: el marketing va más lento', naranja: 'Frenado: solo lo imprescindible', rojo: 'Pausado: nada sale hasta que mejore' };
async function loadInicio() {
  try {
    var r = await api('/admin/resumen');
    var h = r.hoy, n = r.numero, c = r.chats, rp = r.reparto;
    var pct = h.cupo ? Math.min(100, Math.round(100 * h.usados / h.cupo)) : 0;
    var modoGsgInicio = window.__modoSistema === 'gsg' || (document.querySelector('.s-app') && document.querySelector('.s-app').classList.contains('modo-gsg'));
    pintarAccesos(modoGsgInicio);
    if (modoGsgInicio) {
      var quedan = Math.max(0, (h.cupo || 0) - (h.usados || 0));
      document.getElementById('in-kpis').innerHTML = '<div class="card linea-hoy"><b>Mensajes de hoy:</b> ' +
        '<a href="/panel#historial">' + esc(h.enviados) + ' enviado' + (h.enviados === 1 ? '' : 's') + '</a> · ' +
        '<a href="/chat">' + esc(h.entrantes) + ' recibido' + (h.entrantes === 1 ? '' : 's') + (c.sinLeer ? ' (' + esc(c.sinLeer) + ' sin leer)' : '') + '</a> · ' +
        '<span class="' + (h.fallidos ? 'mal' : '') + '">' + esc(h.fallidos) + ' fallido' + (h.fallidos === 1 ? '' : 's') + '</span> · ' +
        '<span title="Solo lo que inicia el sistema (pedir ubicación, confirmar, avisar) gasta cupo; responder a quien escribe no. Un número nuevo empieza con un cupo bajo que sube con los días.">quedan ' + esc(quedan) + ' de ' + esc(h.cupo) + ' del cupo' + (pct > 90 ? ' (casi agotado)' : '') + '</span>' +
        (c.esperandoRespuesta ? ' · <a href="/chat">' + esc(c.esperandoRespuesta) + ' conversación' + (c.esperandoRespuesta === 1 ? '' : 'es') + ' esperan respuesta</a>' : '') +
        '</div>';
    } else
    document.getElementById('in-kpis').innerHTML =
      kpi('Enviados hoy', h.enviados, 'entregados ' + h.entregados + ' · leídos ' + h.leidos, '', '/panel#historial') +
      kpi('Recibidos hoy', h.entrantes, c.sinLeer + ' sin leer', '', '/chat') +
      kpi('Fallidos hoy', h.fallidos, h.fallidos ? 'mira el historial' : 'ninguno', h.fallidos ? 'bad' : 'ok', '/panel#historial') +
      kpi('Cupo de hoy', h.usados + ' / ' + h.cupo, '<div class="barra"><i class="' + (pct > 90 ? 'bad' : pct > 70 ? 'warn' : '') + '" style="width:' + pct + '%"></i></div><span title="Solo lo iniciado por la empresa (plantillas, campañas, reparto) gasta cupo; responder a quien escribe no. Un número nuevo empieza con un cupo bajo que sube con los días.">iniciados por ti</span>', pct > 90 ? 'warn' : '', '/panel#estado') +
      kpi('Esperan respuesta', c.esperandoRespuesta, 'conversaciones con el cliente al final', c.esperandoRespuesta ? 'warn' : 'ok', '/chat') +
      kpi('Necesitan una persona', rp.requierenPersona, 'solicitudes del reparto', rp.requierenPersona ? 'warn' : 'ok', window.__modoSistema === 'gsg' ? '/hoy' : '/rutas');
    document.getElementById('in-grafica').innerHTML = graficaSemana(r.semana);
    pintarPasos(r.primerosPasos);
    pintarEntregasInicio(r.entregas, rp.requierenPersona || 0);

    var luz = n.nivel || 'verde';
    var numero = '<div class="semaforo" style="margin-top:8px"><span class="luz ' + esc(luz) + '"></span><div><b>' + esc(luz.charAt(0).toUpperCase() + luz.slice(1)) + '</b><p class="muted">' + esc(NIVEL_TXT[luz] || '') + '</p></div></div>';
    numero += '<div class="grid" style="margin-top:12px">' +
      '<div class="stat"><span class="muted">Conexión</span><b class="' + (n.conectado ? 'ok' : 'bad') + '">' + (n.conectado ? 'Conectado' : n.configurado ? 'Caído' : 'Sin conectar') + '</b></div>' +
      '<div class="stat"><span class="muted">Calidad (Meta)</span><b class="' + qualityKind(n.calidad) + '">' + esc(calidadEnPalabras(n.calidad)) + '</b></div>' +
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
/* Las entregas del dia (GSG): en modo gsg van primero y el reparto viejo se esconde. */
function pintarEntregasInicio(en, personasReparto) {
  var card = document.getElementById('in-entregas-card');
  var reparto = document.getElementById('in-reparto-card');
  var modoGsg = window.__modoSistema === 'gsg' || (document.querySelector('.s-app') && document.querySelector('.s-app').classList.contains('modo-gsg'));
  if (!card) return;
  if (!en) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  if (reparto) reparto.classList.toggle('hidden', Boolean(modoGsg));
  var cerrado = en.ultimoCierre && en.ultimoCierre.dia === en.dia;
  document.getElementById('in-entregas').innerHTML =
    kpi('Pedidos de hoy', en.total, en.total ? (en.gsgConectada ? 'entran solos desde GSG' : 'GSG sin conectar: se pegan a mano') : (en.gsgConectada ? 'todavía no llegó ninguno' : 'conecta GSG o pega la lista'), en.total || en.gsgConectada ? '' : 'warn', '/hoy') +
    kpi('Falta ubicación', en.faltaUbicacion, 'se les está pidiendo el pin', en.faltaUbicacion ? 'warn' : 'ok', '/hoy?filtro=faltaUbicacion') +
    kpi('Falta confirmar', en.faltaConfirmacion, 'se espera su SÍ o NO', en.faltaConfirmacion ? 'warn' : 'ok', '/hoy?filtro=faltaConfirmacion') +
    kpi('En camino', en.enCamino, 'con motorizado o hora avisada', '', '/hoy?filtro=avisada') +
    kpi('Entregadas', en.entregadas, 'el motorizado dijo entregado', en.entregadas ? 'ok' : '', '/hoy?filtro=entregada') +
    kpi('Necesitan a alguien', (en.incidencia || 0) + (personasReparto || 0), (en.incidencia || 0) + (personasReparto || 0) ? 'míralas en Hoy' : 'ninguna', (en.incidencia || 0) + (personasReparto || 0) ? 'bad' : 'ok', '/hoy?filtro=incidencia');
  var sub = 'GSG: ' + en.gsgDescripcion + '. Motorizados activos: ' + en.motorizadosActivos + '.';
  if (cerrado) sub += ' Ayer se cerró a las ' + new Date(en.ultimoCierre.cuando).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false }) + ': ' + en.ultimoCierre.sinTerminar.length + ' sin terminar, ' + en.ultimoCierre.dadasPorEntregadas.length + ' dadas por entregadas.';
  else if (en.cierrePendiente) sub += ' Quedan ' + en.cierrePendiente + ' pedido' + (en.cierrePendiente === 1 ? '' : 's') + ' de ayer sin cerrar.';
  document.getElementById('in-entregas-sub').textContent = sub;
  document.getElementById('in-entregas-acciones').innerHTML = '<a href="/hoy">Ver los pedidos de hoy</a>' +
    (!en.motorizadosActivos ? ' <a href="/motorizados" class="pill bad" style="margin-left:10px">' + (en.total ? 'No hay ningún motorizado activo: los pedidos listos no pueden salir' : 'Da de alta a tus motorizados') + '</a>' : '');
  if (modoGsg) {
    var kpis = document.getElementById('in-kpis');
    if (kpis && card.nextElementSibling !== kpis) kpis.parentNode.insertBefore(card, kpis);
  }
}
setInterval(function () { if (seccionActiva === 'inicio' && !document.hidden) loadInicio(); }, 30000);

// --------------------------------------------------------------- configuracion
var DIAS_NOMBRE = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
var DIAS_ORDEN = [1, 2, 3, 4, 5, 6, 0];
function numOVacio(id) { var v = val(id); return v === '' ? null : Number(v); }
/* Un celular peruano se escribe con sus 9 cifras; por dentro va con el 51 delante. */
function conPrefijoPeru(v) { var d = String(v || '').replace(/\D/g, ''); return d.length === 9 && d.charAt(0) === '9' ? '51' + d : d; }
function sinPrefijoPeru(v) { var d = String(v || '').replace(/\D/g, ''); return d.length === 11 && d.indexOf('519') === 0 ? d.slice(2).replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3') : String(v || ''); }
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
    'Conexión <b>' + esc(e.ritmo.perfil === 'cloud' ? 'API de Meta' : e.ritmo.perfil === 'waha' ? 'WAHA' : e.ritmo.perfil === 'local' ? 'QR en este servidor' : e.ritmo.perfil) + '</b>'
  ];
  document.getElementById('cf-vigente').innerHTML = partes.map(function (t) { return '<span>' + t + '</span>'; }).join('');
}
async function loadPlan() {
  try {
    var p = await api('/admin/plan');
    var caja = document.getElementById('cf-plan');
    if (p.origen === 'libre' || !p.plan) { caja.classList.add('hidden'); return; }
    var pl = p.plan;
    var l = pl.limites;
    var color = pl.vencido ? 'var(--rojo)' : pl.diasRestantes <= 7 ? 'var(--ambar)' : 'var(--verde)';
    caja.classList.remove('hidden');
    caja.innerHTML = '<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center"><div><b>Tu plan: ' + esc(pl.nombre) + '</b> <span style="color:' + color + ';font-weight:600">' + (pl.vencido ? '· vencido' : '· vence en ' + pl.diasRestantes + ' día' + (pl.diasRestantes === 1 ? '' : 's')) + '</span><br><small class="muted">Hasta el ' + esc(new Date(pl.vencimiento).toLocaleDateString()) + (pl.precioMes ? ' · ' + esc(pl.moneda) + ' ' + pl.precioMes + ' al mes' : ' · gratis') + '</small></div>' +
      '<div class="muted" style="font-size:13px">Asistente IA: ' + (l.iaTurnosMes === 0 ? 'no incluido' : l.iaTurnosMes == null ? 'sin límite' : p.iaTurnosMes + ' de ' + l.iaTurnosMes + ' respuestas este mes') + ' · Campañas: ' + (l.campanas ? 'sí' : 'no') + ' · Conectores: ' + (l.conectores ? 'sí' : 'no') + '</div></div>' +
      (p.aviso ? '<p style="margin:8px 0 0;color:' + color + '">' + esc(p.aviso.texto) + '</p>' : '') +
      (pl.contacto && !p.aviso ? '<p class="muted" style="margin:8px 0 0">Para cambiar de plan o renovar: ' + esc(pl.contacto) + '</p>' : '') +
      (p.error ? '<p class="muted" style="margin:8px 0 0">No se pudo consultar el plan hace un momento (' + esc(p.error) + '); se usa el último conocido.</p>' : '');
  } catch (e) { /* sin plan no pasa nada */ }
}
async function loadConfiguracion() {
  loadPlan();
  try {
    var r = await api('/admin/ajustes');
    var g = r.guardado, e = r.efectivo, sv = r.servidor;
    pintarVigente(e);
    /* el nombre nuevo se ve en el menu sin recargar */
    document.querySelectorAll('.s-logo-text').forEach(function (el) { el.textContent = e.nombreNegocio; });
    document.getElementById('s-app').setAttribute('data-negocio', e.nombreNegocio);
    var nombre = document.getElementById('cf-nombre'); nombre.value = g.nombreNegocio || ''; nombre.placeholder = sv.nombreNegocio;
    var modoActual = g.modo || 'gsg';
    document.querySelectorAll('input[name=cf-modo]').forEach(function (r) { r.checked = r.value === modoActual; });
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
    document.getElementById('cf-mp-numeros').value = g.modoPrueba.numeros.map(sinPrefijoPeru).join('\n');
    var fijado = document.getElementById('cf-fijado');
    fijado.classList.toggle('hidden', !r.modoPruebaFijado);
    if (r.modoPruebaFijado) fijado.textContent = 'El servidor arrancó con SOLO_NUMEROS=' + sv.soloNumeros.join(', ') + '. Desde aquí solo puedes recortar esa lista, no ampliarla ni apagar el modo prueba: eso se cambia en el .env y se reinicia.';
    var sup = document.getElementById('cf-supervisor'); sup.value = sinPrefijoPeru(g.avisos.supervisor || ''); sup.placeholder = sv.supervisor ? sinPrefijoPeru(sv.supervisor) : '987 654 321';
    var rs = g.resumenes || { activo: true, horaManana: '08:30', horaTarde: '18:30' };
    document.getElementById('cf-rs-activo').checked = rs.activo !== false;
    document.getElementById('cf-rs-manana').value = rs.horaManana || '08:30';
    document.getElementById('cf-rs-tarde').value = rs.horaTarde || '18:30';
    loadResumenesEstado();
    document.getElementById('cf-humanizar').value = g.humanizar === null ? '' : String(g.humanizar);
    document.getElementById('cf-autopausa').value = g.autoPausa === null ? '' : String(g.autoPausa);
    document.getElementById('cf-verunavez').value = g.pedirVerUnaVezNormal === false ? 'false' : 'true';
    var soyAdmin = !window.__yo || (window.__yo.rol === 'admin' && !window.__yo.porToken);
    document.getElementById('cf-guardar').disabled = !soyAdmin;
    document.getElementById('cf-restablecer').disabled = !soyAdmin;
    if (!soyAdmin) show('cf-state', 'Solo un administrador puede cambiar esto', 'muted');
  } catch (error) { show('cf-state', error.message, 'bad'); }
}
function triestado(id) { var v = val(id); return v === '' ? null : v === 'true'; }
/* El resumen del dia: cuando salio cada uno y que toca. */
function franjaNombre(f) { return f === 'manana' ? 'el de la mañana' : 'el de la tarde'; }
async function loadResumenesEstado() {
  var caja = document.getElementById('cf-rs-estado');
  try {
    var r = await api('/admin/resumenes');
    var partes = [];
    if (!r.supervisor) partes.push('<b style="color:var(--warn)">Falta el WhatsApp del supervisor (arriba, en Avisos): sin él no hay a quién mandarlo.</b>');
    ['manana', 'tarde'].forEach(function (f) {
      var u = r.ultimos[f];
      if (!u) partes.push('Todavía no salió ' + franjaNombre(f) + '.');
      else partes.push((u.ok ? 'Salió ' : 'No salió ') + franjaNombre(f) + ' el ' + new Date(u.cuando).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) + (u.ok ? (u.conIA ? ' (redactado por la IA)' : ' (texto fijo)') : ': ' + esc(u.motivo || '')) + (u.quien && u.quien !== 'motor' ? ' · lo mandó ' + esc(u.quien) : '') + '.');
    });
    if (r.proximo) partes.push('Próximo: ' + franjaNombre(r.proximo.franja) + ' ' + (r.proximo.hoy ? 'hoy' : 'mañana') + ' a las ' + esc(r.proximo.hora) + '.');
    else if (!r.ajustes.activo) partes.push('Está apagado.');
    caja.innerHTML = partes.join(' ');
  } catch (e) { caja.textContent = ''; }
}
async function verResumen(franja) {
  var vista = document.getElementById('cf-rs-vista');
  vista.classList.remove('hidden'); vista.textContent = 'Preparando…';
  try {
    var r = await api('/admin/resumenes/vista-previa', { method: 'POST', body: { franja: franja } });
    vista.textContent = (r.conIA ? '(redactado por la IA, cifras del sistema)\n\n' : '') + r.texto;
  } catch (e) { vista.textContent = e.message; }
}
document.getElementById('cf-rs-ver-manana').onclick = function () { verResumen('manana'); };
document.getElementById('cf-rs-ver-tarde').onclick = function () { verResumen('tarde'); };
document.getElementById('cf-rs-mandar').onclick = busy('cf-rs-mandar', async function () {
  var h = new Date().getHours();
  var franja = h < 14 ? 'manana' : 'tarde';
  var ok = await confirmarDialogo({ titulo: 'Mandar el resumen ahora', texto: 'Se manda ' + franjaNombre(franja) + ' al WhatsApp del supervisor con las cifras de este momento.', boton: 'Mandar' });
  if (!ok) return;
  try {
    var r = await api('/admin/resumenes/mandar', { method: 'POST', body: { franja: franja } });
    var vista = document.getElementById('cf-rs-vista'); vista.classList.remove('hidden'); vista.textContent = r.texto;
    show('cf-state', 'Resumen mandado al supervisor', 'ok');
    loadResumenesEstado();
  } catch (e) { show('cf-state', e.message, 'bad'); loadResumenesEstado(); }
});
document.getElementById('cf-guardar').onclick = busy('cf-guardar', async function () {
  try {
    var dias = Array.prototype.slice.call(document.querySelectorAll('#cf-dias input')).filter(function (c) { return c.checked; }).map(function (c) { return Number(c.getAttribute('data-dia')); });
    if (!dias.length) throw new Error('Marca al menos un día de envío.');
    var modoElegido = (document.querySelector('input[name=cf-modo]:checked') || {}).value || 'gsg';
    var patch = {
      nombreNegocio: val('cf-nombre') || null,
      modo: modoElegido,
      horario: { inicio: numOVacio('cf-hora-inicio'), fin: numOVacio('cf-hora-fin'), dias: dias },
      ritmo: {
        maxPorMinuto: numOVacio('cf-r-min'), maxPorHora: numOVacio('cf-r-hora'),
        pausaMinSeg: numOVacio('cf-r-pmin'), pausaMaxSeg: numOVacio('cf-r-pmax'),
        nuevosContactosPorDia: numOVacio('cf-r-nuevos'), maxPorContactoDia: numOVacio('cf-r-contacto'),
        separacionContactoMin: numOVacio('cf-r-sep')
      },
      modoPrueba: { activo: document.getElementById('cf-mp-activo').checked, numeros: lines(document.getElementById('cf-mp-numeros').value).map(conPrefijoPeru) },
      avisos: { supervisor: conPrefijoPeru(val('cf-supervisor')) || null },
      resumenes: { activo: document.getElementById('cf-rs-activo').checked, horaManana: val('cf-rs-manana') || '08:30', horaTarde: val('cf-rs-tarde') || '18:30' },
      humanizar: triestado('cf-humanizar'),
      autoPausa: triestado('cf-autopausa'),
      pedirVerUnaVezNormal: val('cf-verunavez') !== 'false'
    };
    if (patch.horario.inicio !== null && patch.horario.fin !== null && patch.horario.fin <= patch.horario.inicio) throw new Error('La hora final tiene que ser mayor que la inicial.');
    if (patch.modoPrueba.activo && !patch.modoPrueba.numeros.length) throw new Error('Con el modo prueba activo hace falta al menos un número.');
    await api('/admin/ajustes', { method: 'POST', body: patch });
    var cambioModo = window.__modoSistema && window.__modoSistema !== modoElegido;
    show('cf-state', cambioModo ? 'Guardado. El menú cambia al recargar…' : 'Guardado: se aplica en el siguiente envío', 'ok');
    if (cambioModo) { setTimeout(function () { location.reload(); }, 900); return; }
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
    var sinOptIn = r.total - c.conOptIn;
    var chips = ['<span><b>' + r.total + '</b> clientes</span>', '<span>con opt-in <b>' + c.conOptIn + '</b></span>']
      .concat(sinOptIn ? ['<span style="border-color:var(--warn);color:var(--warn)">sin consentimiento <b>' + sinOptIn + '</b>: a esos no les saldrá nada iniciado por ti</span>'] : [])
      .concat(['<span>escribieron en 24 h <b>' + c.ventanaAbierta + '</b></span>'])
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
    var previaGrupo = await api('/admin/grupos/previsualizar', { method: 'POST', body: grCriterio() });
    var sinConsentimiento = previaGrupo.total - previaGrupo.cifras.conOptIn;
    var ok = await confirmarDialogo({ titulo: 'Enviar a ' + previa.total + ' cliente(s)', texto: 'Saldrá por goteo, al ritmo del número y solo en horario. Primero el canario; si cae bien, el resto. Se puede pausar desde Campañas.' + (sinConsentimiento ? ' OJO: ' + sinConsentimiento + ' no tiene(n) consentimiento registrado y quedarán bloqueados (regístralo en Contactos).' : ''), boton: 'Enviar' });
    if (!ok) return;
    var r = await api('/admin/grupos/enviar', { method: 'POST', body: grEnvio(false) });
    var out = document.getElementById('gr-out');
    out.innerHTML = '<div class="res ok"><b>Campaña creada: ' + r.enqueued + ' destinatario(s)' + (r.canario ? ', canario de ' + r.canario : '') + '</b><span>Van saliendo por goteo, al ritmo del número: unos pocos por minuto, en horario, y nunca dos mensajes seguidos al mismo cliente en menos de la separación mínima (Configuración → Ritmo). Si a alguien se le escribió hace poco, el suyo espera su turno.</span><span>Síguelo en <a href="/panel#campanas">Campañas</a> y cada envío en el <a href="/panel#historial">Historial</a>.</span></div>';
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

// --------------------------------------------------------------- stickers
var stickersCache = [];
function leerFichero(file) {
  return new Promise(function (resolve, reject) {
    var r = new FileReader();
    r.onload = function () { resolve(String(r.result)); };
    r.onerror = function () { reject(new Error('No se pudo leer el fichero.')); };
    r.readAsDataURL(file);
  });
}
function opcionesStickers(sel, elegido) {
  sel.innerHTML = '<option value="">(ninguno)</option>' + stickersCache.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === elegido ? ' selected' : '') + '>' + esc(s.nombre) + ' (' + esc(s.uso) + ')</option>'; }).join('');
}
async function loadStickers() {
  try {
    var r = await api('/admin/stickers');
    stickersCache = r.stickers;
    document.getElementById('sk-uso').innerHTML = r.usos.map(function (u) { return '<option value="' + esc(u.id) + '">' + esc(u.etiqueta) + '</option>'; }).join('');
    document.getElementById('sk-grid').innerHTML = stickersCache.length
      ? stickersCache.map(function (s) {
          return '<div class="sk-item"><img src="/stickers/' + esc(s.archivo) + '" alt=""><b title="' + esc(s.nombre) + '">' + esc(s.nombre) + '</b><small>' + esc(s.uso) + ' · ' + Math.round(s.bytes / 1024) + ' KB</small><button class="danger sm" data-sk-borrar="' + esc(s.id) + '">Quitar</button></div>';
        }).join('')
      : '<div class="empty">Todavía no hay stickers. Sube el primero arriba.</div>';
    document.querySelectorAll('[data-sk-borrar]').forEach(function (b) {
      b.onclick = async function () {
        var ok = await confirmarDialogo({ titulo: 'Quitar el sticker', texto: 'Si estaba puesto como automático, deja de salir.', boton: 'Quitar', peligro: true });
        if (!ok) return;
        try { await api('/admin/stickers/' + b.getAttribute('data-sk-borrar'), { method: 'DELETE' }); loadStickers(); }
        catch (error) { show('sk-state', error.message, 'bad'); }
      };
    });
    var c = r.configuracion || {};
    opcionesStickers(document.getElementById('sk-auto-inicio'), c.inicio);
    opcionesStickers(document.getElementById('sk-auto-gracias'), c.gracias);
    opcionesStickers(document.getElementById('sk-auto-despedida'), c.despedida);
    document.getElementById('sk-auto-reparto').checked = Boolean(c.inicioEnReparto);
  } catch (error) { show('sk-state', error.message, 'bad'); }
}
document.getElementById('sk-subir').onclick = busy('sk-subir', async function () {
  try {
    var f = document.getElementById('sk-archivo').files[0];
    if (!f) throw new Error('Elige una imagen.');
    if (f.size > 4 * 1024 * 1024) throw new Error('La imagen pesa más de 4 MB.');
    var datos = await leerFichero(f);
    await api('/admin/stickers', { method: 'POST', body: { nombre: val('sk-nombre') || f.name.replace(/\.[^.]+$/, ''), uso: val('sk-uso'), datos: datos } });
    show('sk-state', 'Sticker listo', 'ok');
    document.getElementById('sk-archivo').value = ''; setVal('sk-nombre', '');
    loadStickers();
  } catch (error) { show('sk-state', error.message, 'bad'); }
});
document.getElementById('sk-guardar-auto').onclick = busy('sk-guardar-auto', async function () {
  try {
    await api('/admin/stickers/configuracion', { method: 'POST', body: {
      inicio: val('sk-auto-inicio') || null, gracias: val('sk-auto-gracias') || null, despedida: val('sk-auto-despedida') || null,
      inicioEnReparto: document.getElementById('sk-auto-reparto').checked
    } });
    show('sk-auto-state', 'Guardado', 'ok');
  } catch (error) { show('sk-auto-state', error.message, 'bad'); }
});

// --------------------------------------------------------------- integraciones
/* Los permisos que existen (nombre y explicacion) y los eventos de los webhooks: los dice el servidor. */
var PERMISOS_API = null;
async function cargarContratoApi() {
  if (PERMISOS_API) return PERMISOS_API;
  var raiz = await api('/api/v1');
  var eventos = await api('/api/v1/eventos');
  PERMISOS_API = { permisos: raiz.permisos || {}, eventos: eventos.eventos || [] };
  return PERMISOS_API;
}
function casillas(id, items, nombreCampo) {
  document.getElementById(id).innerHTML = items.map(function (it) {
    return '<label><input type="checkbox" name="' + nombreCampo + '" value="' + esc(it.valor) + '"><span><b>' + esc(it.valor) + '</b><small>' + esc(it.texto) + '</small></span></label>';
  }).join('');
}
function marcadas(id) {
  return Array.prototype.map.call(document.querySelectorAll('#' + id + ' input:checked'), function (i) { return i.value; });
}
async function loadClaves() {
  document.getElementById('ck-ejemplo').textContent =
    'curl -H "authorization: Bearer wak_..." ' + location.origin + '/api/v1/estado\n' +
    'curl -H "authorization: Bearer wak_..." -H "content-type: application/json" \\\n' +
    '     -d \'{"telefono":"51987654321","texto":"Tu pedido ya salio","consentimiento":{"origen":"pedido P-1024"}}\' ' + location.origin + '/api/v1/mensajes';
  try {
    var contrato = await cargarContratoApi();
    casillas('ck-permisos', Object.keys(contrato.permisos).filter(function (p) { return p !== '*'; }).map(function (p) { return { valor: p, texto: contrato.permisos[p] }; }), 'permiso');
    casillas('cc-permisos', Object.keys(contrato.permisos).filter(function (p) { return p !== '*'; }).map(function (p) { return { valor: p, texto: contrato.permisos[p] }; }), 'permiso-cc');
    casillas('wh-eventos', contrato.eventos.map(function (e) { return { valor: e.nombre, texto: e.descripcion }; }), 'evento');
  } catch (error) { show('ck-state', error.message, 'bad'); }
  loadWebhooks();
  loadEmbebido();
  loadConectores();
  loadStoky();
  loadCodigos();
  try {
    var list = await api('/admin/claves-api');
    table('ck-table', ['Para', 'Clave', 'Permisos', 'Creada', 'Último uso', 'Estado', ''], list.map(function (k) {
      var permisos = (k.permisos || ['*']).indexOf('*') >= 0 ? pill('warn', 'todo') : (k.permisos || []).map(function (p) { return '<code>' + esc(p) + '</code>'; }).join(' ');
      return [esc(k.nombre), '<code>' + esc(k.prefijo) + '</code>', permisos, esc(fmt(k.createdAt)), esc(fmt(k.ultimoUsoAt) || 'nunca'),
        pill(k.revocadaAt ? 'bad' : 'ok', k.revocadaAt ? 'revocada' : 'activa'),
        k.revocadaAt ? '' : '<button class="danger sm" data-ck-revocar="' + esc(k.id) + '">Revocar</button>'];
    }), 'Todavía no hay claves. Crea una para Stoky o para el sistema de GSG.');
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
    var r = await api('/admin/claves-api', { method: 'POST', body: { nombre: val('ck-nombre'), permisos: marcadas('ck-permisos') } });
    document.getElementById('ck-valor').textContent = r.clave;
    document.getElementById('ck-nueva').classList.remove('hidden');
    setVal('ck-nombre', '');
    document.querySelectorAll('#ck-permisos input').forEach(function (i) { i.checked = false; });
    show('ck-state', 'Clave creada', 'ok');
    loadClaves();
  } catch (error) { show('ck-state', error.message, 'bad'); }
});

// --- codigos de conexion ---
var ESTADO_CODIGO = { activo: ['ok', 'vigente'], usado: ['muted', 'usado'], caducado: ['warn', 'caducado'], anulado: ['bad', 'anulado'] };
async function loadCodigos() {
  try {
    var r = await api('/admin/codigos-conexion');
    table('cc-table', ['Código', 'Para', 'Vale hasta', 'Usos', 'Estado', 'Canjeado', ''], r.codigos.map(function (c) {
      var e = ESTADO_CODIGO[c.estadoReal] || ['muted', c.estadoReal];
      var canje = c.canjeadoAt ? esc(fmt(c.canjeadoAt)) + ' por ' + esc(c.canjeadoPor || '') + (c.canjeadoDesde ? ' <small class="muted">(' + esc(c.canjeadoDesde) + ')</small>' : '') : '<span class="muted">todavía no</span>';
      return ['<code>' + esc(c.codigo) + '</code>', esc(c.para), esc(fmt(c.caducaAt)), c.usos + ' de ' + c.usosMax, pill(e[0], e[1]), canje, c.estadoReal === 'activo' ? '<button class="danger sm" data-cc-anular="' + esc(c.id) + '">Anular</button>' : ''];
    }), 'Ningún código todavía.');
    document.querySelectorAll('[data-cc-anular]').forEach(function (b) {
      b.onclick = async function () {
        try { await api('/admin/codigos-conexion/' + b.getAttribute('data-cc-anular'), { method: 'DELETE' }); loadCodigos(); }
        catch (error) { show('cc-state', error.message, 'bad'); }
      };
    });
  } catch (error) { show('cc-state', error.message, 'bad'); }
}
async function crearCodigo(para, dias, hasta, usos, permisos) {
  var body = { para: para, usosMax: usos || 1, permisos: permisos || [] };
  if (hasta) body.caducaAt = hasta; else if (dias) body.dias = Number(dias);
  var r = await api('/admin/codigos-conexion', { method: 'POST', body: body });
  document.getElementById('cc-valor').textContent = r.codigo.codigo;
  document.getElementById('cc-pasos').innerHTML = r.pasos.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('');
  document.getElementById('cc-nuevo').classList.remove('hidden');
  loadCodigos();
  return r;
}
document.getElementById('cc-crear').onclick = busy('cc-crear', async function () {
  try {
    if (!val('cc-para')) return show('cc-state', 'Di para quién es el código.', 'bad');
    await crearCodigo(val('cc-para'), val('cc-dias'), val('cc-hasta'), Number(val('cc-usos') || 1), marcadas('cc-permisos'));
    show('cc-state', 'Código creado', 'ok');
    setVal('cc-para', '');
  } catch (error) { show('cc-state', error.message, 'bad'); }
});
document.getElementById('cc-crear-stoky').onclick = busy('cc-crear-stoky', async function () {
  try {
    var dias = await pedirDato({ titulo: 'Código de conexión para Stoky', texto: 'Cuántos días vale el código antes de caducar. Vale una sola vez: al canjearlo, Stoky recibe su clave con todos los permisos.', etiqueta: 'Días', valor: '7', boton: 'Crear código', validar: function (v) { return /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 365 ? null : 'Entre 1 y 365 días.'; } });
    if (!dias) return;
    await crearCodigo('Stoky', dias, '', 1, []);
    show('stk-state', 'Código creado: pégalo en Stoky.', 'ok');
    document.getElementById('cc-nuevo').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) { show('stk-state', error.message, 'bad'); }
});
document.getElementById('cc-copiar').onclick = function () {
  navigator.clipboard.writeText(document.getElementById('cc-valor').textContent).then(function () { show('cc-state', 'Código copiado', 'ok'); });
};
document.getElementById('cc-cerrar').onclick = function () { document.getElementById('cc-nuevo').classList.add('hidden'); };

// --- Stoky: las dos direcciones ---
function luz(clase, texto, sub) {
  return '<div><i class="' + clase + '"></i><span>' + texto + (sub ? '<small>' + sub + '</small>' : '') + '</span></div>';
}
async function loadStoky() {
  var aqui = document.getElementById('stk-hacia-aqui');
  var alla = document.getElementById('stk-hacia-stoky');
  try {
    var r = await api('/admin/integraciones/stoky');
    var h = r.haciaAqui;
    var html = '';
    html += luz('', 'Dirección de este sistema para pegar en Stoky: <code class="dir">' + esc(r.miDireccion) + '</code>');
    if (!h.claves.length) html += luz('bad', 'Todavía no hay una clave para Stoky.', 'Créala con el botón de abajo y pégala en Stoky.');
    else if (h.claveUsada) html += luz('ok', 'Stoky tiene su clave y la está usando.', 'Último uso: ' + esc(fmt(h.ultimoUsoClaveAt)) + ' · clave ' + esc(h.claves[0].prefijo) + '…');
    else html += luz('warn', 'La clave para Stoky existe pero Stoky aún no la ha usado.', 'Pégala en Stoky (CRM → WhatsApp → Conectar → Mi sistema de WhatsApp) y pulsa Conectar allí.');
    if (!h.webhook) html += luz(h.claveUsada ? 'warn' : '', 'Stoky todavía no recibe los mensajes que llegan aquí.', 'Al pulsar Conectar en Stoky, él mismo da de alta el aviso. Si ya lo hiciste y esto sigue así, revisa que Stoky esté encendido.');
    else if (h.recibeMensajes) html += luz('ok', 'Stoky recibe los mensajes que llegan a este WhatsApp.', 'Último aviso entregado ' + esc(fmt(h.webhook.ultimoOkAt)) + ' en ' + esc(h.webhook.url));
    else if (!h.webhook.activo) html += luz('bad', 'El aviso hacia Stoky está apagado' + (h.webhook.motivoPausa ? ': ' + esc(h.webhook.motivoPausa) : '.'), 'Se apaga solo tras un día fallando. Comprueba que Stoky esté encendido y actívalo en Webhooks salientes, más abajo.');
    else html += luz('warn', 'El aviso hacia Stoky está dado de alta, pero aún no se entregó ninguno.', esc(h.webhook.url) + (h.webhook.fallosSeguidos ? ' · ' + h.webhook.fallosSeguidos + ' fallos seguidos' : ''));
    aqui.innerHTML = html;

    var e = r.haciaStoky;
    var html2 = '';
    if (!e.configurada) html2 += luz('bad', 'Sin conexión con Stoky: el asistente no puede dar precios ni stock.', e.url ? 'Hay dirección (' + esc(e.url) + ') pero falta el token.' : 'Pon la dirección y el token de Stoky aquí abajo, o pulsa Conectar en la pantalla de Stoky.');
    else {
      var p = e.ultimaPrueba;
      var de = e.origen === 'stoky' ? 'lo mandó Stoky al vincularse' : e.origen === 'env' ? 'viene del arranque (.env)' : 'se puso en esta pantalla';
      if (!p) html2 += luz('warn', 'Conexión guardada (' + esc(e.url) + '), sin probar todavía.', de + ' · pulsa Probar');
      else if (p.ok) html2 += luz('ok', 'Conectado con Stoky' + (p.tienda ? ': ' + esc(p.tienda) : '') + (p.almacen ? ' · almacén ' + esc(p.almacen) : '') + '.', (p.productos || 0) + ' productos en el catálogo · probado ' + esc(fmt(p.at)) + ' · ' + de);
      else html2 += luz('bad', 'Stoky no responde: ' + esc(p.detalle || ''), esc(e.url) + ' · probado ' + esc(fmt(p.at)));
      html2 += luz(e.panelUrl ? 'ok' : 'warn', e.panelUrl ? 'Las ventas se registran en el panel: <code class="dir">' + esc(e.panelUrl) + '</code>' : 'Falta la dirección del panel de Stoky: el botón «Registrar venta» del chat no sabrá a dónde ir.');
    }
    alla.innerHTML = html2;
    if (!document.activeElement || document.activeElement.id !== 'stk-url') setVal('stk-url', e.url || '');
    if (!document.activeElement || document.activeElement.id !== 'stk-panel') setVal('stk-panel', e.panelUrl && e.panelUrl !== e.url ? e.panelUrl : '');
    document.getElementById('stk-token').placeholder = e.tieneToken ? 'Ya hay un token guardado; escribe uno solo para cambiarlo' : 'stk_…';
    document.getElementById('stk-quitar').classList.toggle('hidden', !e.configurada || e.origen === 'env');
  } catch (error) {
    aqui.innerHTML = luz('bad', esc(error.message));
    alla.innerHTML = '';
  }
}
document.getElementById('stk-clave').onclick = busy('stk-clave', async function () {
  if (!(await confirmarDialogo({ titulo: 'Crear la clave para Stoky', texto: 'Se crea una clave con todos los permisos (Stoky la necesita para el QR, el chat, los avisos y la IA). Si ya había una clave "Stoky", deja de valer y Stoky tendrá que usar la nueva.', boton: 'Crear la clave' }))) return;
  try {
    var r = await api('/admin/integraciones/stoky/clave', { method: 'POST', body: {} });
    document.getElementById('stk-clave-valor').textContent = r.clave;
    document.getElementById('stk-clave-pasos').innerHTML = r.pasos.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('');
    document.getElementById('stk-clave-nueva').classList.remove('hidden');
    loadStoky();
    loadClaves();
  } catch (error) { show('stk-state', error.message, 'bad'); }
});
document.getElementById('stk-clave-copiar').onclick = function () {
  navigator.clipboard.writeText(document.getElementById('stk-clave-valor').textContent).then(function () { show('stk-state', 'Clave copiada', 'ok'); });
};
document.getElementById('stk-clave-cerrar').onclick = function () { document.getElementById('stk-clave-nueva').classList.add('hidden'); };
document.getElementById('stk-probar').onclick = busy('stk-probar', async function () {
  show('stk-state', 'Preguntando a Stoky…', 'warn');
  try {
    var body = val('stk-token') ? { url: val('stk-url'), token: val('stk-token') } : {};
    var r = await api('/admin/integraciones/stoky/probar', { method: 'POST', body: body });
    show('stk-state', r.ok ? 'Stoky responde' + (r.tienda ? ' (' + r.tienda + ')' : '') + ': ' + (r.productos || 0) + ' productos.' : (r.detalle || 'Stoky no respondió.'), r.ok ? 'ok' : 'bad');
    loadStoky();
  } catch (error) { show('stk-state', error.message, 'bad'); }
});
document.getElementById('stk-guardar').onclick = busy('stk-guardar', async function () {
  try {
    var r = await api('/admin/integraciones/stoky', { method: 'POST', body: { url: val('stk-url'), panelUrl: val('stk-panel') || undefined, token: val('stk-token') || undefined } });
    show('stk-state', r.mensaje, r.prueba && r.prueba.ok ? 'ok' : 'warn');
    setVal('stk-token', '');
    loadStoky();
  } catch (error) { show('stk-state', error.message, 'bad'); }
});
document.getElementById('stk-quitar').onclick = busy('stk-quitar', async function () {
  if (!(await confirmarDialogo({ titulo: 'Quitar la conexión con Stoky', texto: 'El asistente dejará de dar precios y stock de Stoky y de registrar ventas allí. Stoky seguirá pudiendo escribir por aquí con su clave.', boton: 'Quitar', peligro: true }))) return;
  try {
    await api('/admin/integraciones/stoky', { method: 'DELETE' });
    show('stk-state', 'Conexión quitada.', 'ok');
    setVal('stk-url', ''); setVal('stk-panel', ''); setVal('stk-token', '');
    loadStoky();
  } catch (error) { show('stk-state', error.message, 'bad'); }
});

// --- webhooks salientes ---
async function loadWebhooks() {
  try {
    var r = await api('/api/v1/webhooks');
    table('wh-table', ['Para', 'URL', 'Eventos', 'Última entrega', 'Estado', ''], r.webhooks.map(function (w) {
      var eventos = w.eventos.indexOf('*') >= 0 ? pill('ok', 'todos') : w.eventos.map(function (e) { return '<code>' + esc(e) + '</code>'; }).join(' ');
      var ultima = w.ultimoOkAt ? 'bien ' + esc(fmt(w.ultimoOkAt)) : 'ninguna buena';
      if (w.fallosSeguidos) ultima += '<br><small class="muted">' + w.fallosSeguidos + ' fallo' + (w.fallosSeguidos === 1 ? '' : 's') + ' seguido' + (w.fallosSeguidos === 1 ? '' : 's') + (w.ultimoFalloAt ? ', el último ' + esc(fmt(w.ultimoFalloAt)) : '') + '</small>';
      var estado = w.activo ? pill('ok', 'activo') : pill(w.motivoPausa ? 'bad' : 'warn', w.motivoPausa ? 'apagado por fallos' : 'pausado');
      if (w.motivoPausa) estado += '<br><small class="muted">' + esc(w.motivoPausa) + '</small>';
      var botones =
        '<button class="ghost sm" data-wh-probar="' + esc(w.id) + '">Probar</button> ' +
        '<button class="ghost sm" data-wh-entregas="' + esc(w.id) + '" data-wh-nombre="' + esc(w.descripcion || w.url) + '">Entregas</button> ' +
        '<button class="ghost sm" data-wh-activo="' + esc(w.id) + '" data-wh-valor="' + (w.activo ? '0' : '1') + '">' + (w.activo ? 'Pausar' : 'Activar') + '</button> ' +
        (w.activo ? '' : '<button class="ghost sm" data-wh-reencolar="' + esc(w.id) + '">Reintentar fallidas</button> ') +
        '<button class="danger sm" data-wh-borrar="' + esc(w.id) + '">Borrar</button>';
      return [esc(w.descripcion || '—'), '<code>' + esc(w.url) + '</code>', eventos, ultima, estado, botones];
    }), 'Todavía no hay webhooks. Registra la URL del sistema que quiera enterarse de lo que pasa aquí.');

    document.querySelectorAll('[data-wh-probar]').forEach(function (b) {
      b.onclick = busy(b, async function () {
        try {
          var p = await api('/api/v1/webhooks/' + b.getAttribute('data-wh-probar') + '/probar', { method: 'POST' });
          show('wh-state', p.ok ? 'La URL contestó ' + p.codigo + ': el webhook funciona.' : 'La URL no contestó bien: ' + (p.error || p.codigo) + (p.respuesta ? ' — ' + p.respuesta : ''), p.ok ? 'ok' : 'bad');
        } catch (error) { show('wh-state', error.message, 'bad'); }
      });
    });
    document.querySelectorAll('[data-wh-entregas]').forEach(function (b) {
      b.onclick = async function () {
        try {
          var e = await api('/api/v1/webhooks/' + b.getAttribute('data-wh-entregas') + '/entregas?limite=50');
          document.getElementById('wh-entregas-de').textContent = b.getAttribute('data-wh-nombre');
          document.getElementById('wh-entregas').classList.remove('hidden');
          table('wh-entregas-table', ['Cuándo', 'Evento', 'Estado', 'Intentos', 'Respuesta', 'Próximo intento'], e.entregas.map(function (x) {
            var estado = x.estado === 'enviada' ? pill('ok', 'entregada') : x.estado === 'fallida' ? pill('bad', 'fallida') : pill('warn', 'pendiente');
            var respuesta = (x.respuestaCodigo ? 'HTTP ' + x.respuestaCodigo + ' ' : '') + (x.error && x.estado !== 'enviada' ? esc(x.error) : '') + (x.respuesta ? '<br><small class="muted">' + esc(String(x.respuesta).slice(0, 120)) + '</small>' : '');
            return [esc(fmt(x.createdAt)), '<code>' + esc(x.evento) + '</code>', estado, String(x.intentos), respuesta || '—', x.estado === 'pendiente' ? esc(fmt(x.proximoIntentoAt)) : '—'];
          }), 'Todavía no se ha entregado nada a este webhook.');
          document.getElementById('wh-entregas').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch (error) { show('wh-state', error.message, 'bad'); }
      };
    });
    document.querySelectorAll('[data-wh-activo]').forEach(function (b) {
      b.onclick = async function () {
        try {
          await api('/api/v1/webhooks/' + b.getAttribute('data-wh-activo'), { method: 'PATCH', body: { activo: b.getAttribute('data-wh-valor') === '1' } });
          loadWebhooks();
        } catch (error) { show('wh-state', error.message, 'bad'); }
      };
    });
    document.querySelectorAll('[data-wh-reencolar]').forEach(function (b) {
      b.onclick = async function () {
        try {
          var x = await api('/api/v1/webhooks/' + b.getAttribute('data-wh-reencolar') + '/reencolar', { method: 'POST' });
          show('wh-state', x.reencoladas + ' entrega' + (x.reencoladas === 1 ? '' : 's') + ' de vuelta en la cola. Actívalo para que salgan.', 'ok');
          loadWebhooks();
        } catch (error) { show('wh-state', error.message, 'bad'); }
      };
    });
    document.querySelectorAll('[data-wh-borrar]').forEach(function (b) {
      b.onclick = async function () {
        var ok = await confirmarDialogo({ titulo: 'Borrar el webhook', texto: 'Ese sistema dejará de recibir avisos y se borra el historial de entregas. No se puede deshacer.', boton: 'Borrar', peligro: true });
        if (!ok) return;
        try { await api('/api/v1/webhooks/' + b.getAttribute('data-wh-borrar'), { method: 'DELETE' }); loadWebhooks(); }
        catch (error) { show('wh-state', error.message, 'bad'); }
      };
    });
  } catch (error) {
    document.getElementById('wh-table').innerHTML = '<div class="empty">' + esc(error.message) + '</div>';
  }
}
document.getElementById('wh-crear').onclick = busy('wh-crear', async function () {
  try {
    var r = await api('/api/v1/webhooks', { method: 'POST', body: { url: val('wh-url'), descripcion: val('wh-descripcion'), eventos: marcadas('wh-eventos') } });
    document.getElementById('wh-secreto').textContent = r.secreto;
    document.getElementById('wh-nuevo').classList.remove('hidden');
    setVal('wh-url', ''); setVal('wh-descripcion', '');
    document.querySelectorAll('#wh-eventos input').forEach(function (i) { i.checked = false; });
    show('wh-state', 'Webhook registrado. Pulsa "Probar" para comprobar que la URL contesta.', 'ok');
    loadWebhooks();
  } catch (error) { show('wh-state', error.message, 'bad'); }
});
document.getElementById('wh-copiar').onclick = function () {
  navigator.clipboard.writeText(document.getElementById('wh-secreto').textContent).then(function () { show('wh-state', 'Copiado', 'ok'); });
};
document.getElementById('wh-cerrar').onclick = function () {
  document.getElementById('wh-secreto').textContent = '';
  document.getElementById('wh-nuevo').classList.add('hidden');
};

// --- conectores de tiendas ---
var CN_OPCIONES = null;
var CN_ABIERTO = null;
var INSTRUCCIONES_TIENDA = {
  woocommerce: 'En WordPress: WooCommerce → Ajustes → Avanzado → Webhooks → Añadir. Estado "Activo", tema "Pedido creado" (y otro webhook con "Pedido actualizado" si quieres avisar de pagos y entregas), URL de entrega la de abajo, secreto el de abajo, versión de API v3.',
  shopify: 'En Shopify: Configuración → Notificaciones → Webhooks → Crear webhook. Evento "Creación de pedidos" (y otros: pago, preparación, cancelación), formato JSON, URL la de abajo. El secreto lo enseña Shopify al pie de esa pantalla: es el que pegaste al crear el conector.'
};
document.getElementById('cn-tipo').onchange = function () {
  document.getElementById('cn-secreto-caja').classList.toggle('hidden', val('cn-tipo') !== 'shopify');
};
async function loadConectores() {
  try {
    if (!CN_OPCIONES) {
      CN_OPCIONES = await api('/api/v1/conectores/opciones');
      document.getElementById('cn-probar-evento').innerHTML = CN_OPCIONES.eventos.map(function (e) { return '<option value="' + esc(e.nombre) + '">' + esc(e.nombre) + '</option>'; }).join('');
    }
    var r = await api('/api/v1/conectores');
    table('cn-table', ['Tienda', 'Nombre', 'URL', 'Reglas', 'Recibidos', 'Estado', ''], r.conectores.map(function (c) {
      var activas = c.reglas.filter(function (x) { return x.activo; }).map(function (x) { return '<code>' + esc(x.evento) + '</code>'; }).join(' ') || '<span class="muted">ninguna: no sale nada</span>';
      var botones =
        '<button class="ghost sm" data-cn-reglas="' + esc(c.id) + '">Reglas</button> ' +
        '<button class="ghost sm" data-cn-entradas="' + esc(c.id) + '">Pedidos</button> ' +
        '<button class="ghost sm" data-cn-activo="' + esc(c.id) + '" data-cn-valor="' + (c.activo ? '0' : '1') + '">' + (c.activo ? 'Pausar' : 'Activar') + '</button> ' +
        '<button class="danger sm" data-cn-borrar="' + esc(c.id) + '">Borrar</button>';
      return [esc(c.tipo), esc(c.nombre), '<code>' + esc(c.url) + '</code>', activas, String(c.eventosRecibidos) + (c.ultimoEventoAt ? '<br><small class="muted">' + esc(fmt(c.ultimoEventoAt)) + '</small>' : ''), pill(c.activo ? 'ok' : 'warn', c.activo ? 'activo' : 'pausado'), botones];
    }), 'Todavía no hay conectores. Crea uno para tu tienda WooCommerce o Shopify.');
    document.querySelectorAll('[data-cn-reglas]').forEach(function (b) { b.onclick = function () { abrirReglas(b.getAttribute('data-cn-reglas'), r.conectores); }; });
    document.querySelectorAll('[data-cn-entradas]').forEach(function (b) { b.onclick = function () { verEntradas(b.getAttribute('data-cn-entradas'), r.conectores); }; });
    document.querySelectorAll('[data-cn-activo]').forEach(function (b) {
      b.onclick = async function () {
        try { await api('/api/v1/conectores/' + b.getAttribute('data-cn-activo'), { method: 'PATCH', body: { activo: b.getAttribute('data-cn-valor') === '1' } }); loadConectores(); }
        catch (error) { show('cn-state', error.message, 'bad'); }
      };
    });
    document.querySelectorAll('[data-cn-borrar]').forEach(function (b) {
      b.onclick = async function () {
        var ok = await confirmarDialogo({ titulo: 'Borrar el conector', texto: 'La tienda seguirá mandando sus webhooks a una URL que ya no existe. Bórralo también allí.', boton: 'Borrar', peligro: true });
        if (!ok) return;
        try { await api('/api/v1/conectores/' + b.getAttribute('data-cn-borrar'), { method: 'DELETE' }); document.getElementById('cn-reglas').classList.add('hidden'); loadConectores(); }
        catch (error) { show('cn-state', error.message, 'bad'); }
      };
    });
  } catch (error) {
    document.getElementById('cn-table').innerHTML = '<div class="empty">' + esc(error.message) + '</div>';
  }
}
document.getElementById('cn-crear').onclick = busy('cn-crear', async function () {
  try {
    var tipo = val('cn-tipo');
    var body = { tipo: tipo, nombre: val('cn-nombre') };
    if (tipo === 'shopify') {
      if (!val('cn-secreto')) return show('cn-state', 'Pega el secreto que enseña Shopify en la pantalla de webhooks.', 'bad');
      body.secreto = val('cn-secreto');
    }
    var r = await api('/api/v1/conectores', { method: 'POST', body: body });
    document.getElementById('cn-instrucciones').textContent = INSTRUCCIONES_TIENDA[tipo];
    document.getElementById('cn-url').textContent = r.conector.url;
    document.getElementById('cn-secreto-valor').textContent = r.secreto;
    document.getElementById('cn-secreto-bloque').classList.toggle('hidden', tipo === 'shopify');
    document.getElementById('cn-nuevo').classList.remove('hidden');
    setVal('cn-nombre', ''); setVal('cn-secreto', '');
    show('cn-state', 'Conector creado. Ahora define las reglas (botón "Reglas").', 'ok');
    loadConectores();
  } catch (error) { show('cn-state', error.message, 'bad'); }
});
document.getElementById('cn-cerrar').onclick = function () {
  document.getElementById('cn-secreto-valor').textContent = '';
  document.getElementById('cn-nuevo').classList.add('hidden');
};
function abrirReglas(id, conectores) {
  var c = conectores.filter(function (x) { return x.id === id; })[0];
  if (!c) return;
  CN_ABIERTO = c;
  document.getElementById('cn-reglas-de').textContent = c.nombre;
  document.getElementById('cn-reglas').classList.remove('hidden');
  var opcionesPlantilla = '<option value="">— sin plantilla —</option>' + CN_OPCIONES.plantillas.map(function (p) { return '<option value="' + esc(p.nombre) + '">' + esc(p.nombre) + ' (' + p.variables + ' var.)</option>'; }).join('');
  var filas = CN_OPCIONES.eventos.map(function (e) {
    var r = c.reglas.filter(function (x) { return x.evento === e.nombre; })[0] || { activo: false, plantilla: null, variables: [], texto: '' };
    return [
      '<label title="' + esc(e.descripcion) + '"><input type="checkbox" data-cn-activo-regla="' + esc(e.nombre) + '"' + (r.activo ? ' checked' : '') + '> <code>' + esc(e.nombre) + '</code><br><small class="muted">' + esc(e.descripcion) + '</small></label>',
      '<select data-cn-plantilla="' + esc(e.nombre) + '">' + opcionesPlantilla + '</select>',
      '<input data-cn-variables="' + esc(e.nombre) + '" placeholder="{nombre}, {numero}" value="' + esc((r.variables || []).join(', ')) + '">',
      '<textarea data-cn-texto="' + esc(e.nombre) + '" rows="2" placeholder="Hola {nombre}, tu pedido {numero} ya está confirmado.">' + esc(r.texto || '') + '</textarea>'
    ];
  });
  table('cn-reglas-table', ['Evento', 'Plantilla (API de Meta)', 'Variables de la plantilla', 'Texto (QR / WAHA, o dentro de 24 h)'], filas, '');
  c.reglas.forEach(function (r) {
    var sel = document.querySelector('[data-cn-plantilla="' + r.evento + '"]');
    if (sel && r.plantilla) sel.value = r.plantilla.nombre;
  });
  document.getElementById('cn-reglas').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function leerReglas() {
  return CN_OPCIONES.eventos.map(function (e) {
    var n = e.nombre;
    var plantilla = document.querySelector('[data-cn-plantilla="' + n + '"]').value;
    var variables = document.querySelector('[data-cn-variables="' + n + '"]').value.split(',').map(function (v) { return v.trim(); }).filter(Boolean);
    var texto = document.querySelector('[data-cn-texto="' + n + '"]').value.trim();
    return { evento: n, activo: document.querySelector('[data-cn-activo-regla="' + n + '"]').checked, plantilla: plantilla ? { nombre: plantilla, idioma: 'es' } : null, variables: variables, texto: texto || null };
  }).filter(function (r) { return r.activo || r.plantilla || r.texto; });
}
document.getElementById('cn-guardar-reglas').onclick = busy('cn-guardar-reglas', async function () {
  if (!CN_ABIERTO) return;
  try {
    var reglas = leerReglas();
    var vacias = reglas.filter(function (r) { return r.activo && !r.plantilla && !r.texto; });
    if (vacias.length) return show('cn-reglas-state', 'Cada evento activo necesita una plantilla o un texto: ' + vacias.map(function (r) { return r.evento; }).join(', '), 'bad');
    var r = await api('/api/v1/conectores/' + CN_ABIERTO.id, { method: 'PATCH', body: { reglas: reglas } });
    CN_ABIERTO = r.conector;
    show('cn-reglas-state', 'Reglas guardadas.', 'ok');
    loadConectores();
  } catch (error) { show('cn-reglas-state', error.message, 'bad'); }
});
document.getElementById('cn-probar').onclick = busy('cn-probar', async function () {
  if (!CN_ABIERTO) return;
  try {
    var r = await api('/api/v1/conectores/' + CN_ABIERTO.id + '/probar', { method: 'POST', body: { telefono: val('cn-probar-tel'), evento: val('cn-probar-evento') } });
    show('cn-reglas-state', r.ok ? 'Enviado a ' + r.telefono + '. Mira el chat.' : 'No salió (' + r.resultado + '): ' + (r.detalle || ''), r.ok ? 'ok' : 'bad');
  } catch (error) { show('cn-reglas-state', error.message, 'bad'); }
});
async function verEntradas(id, conectores) {
  var c = conectores.filter(function (x) { return x.id === id; })[0];
  try {
    var r = await api('/api/v1/conectores/' + id + '/entradas?limite=50');
    document.getElementById('cn-entradas-de').textContent = c ? c.nombre : '';
    document.getElementById('cn-entradas').classList.remove('hidden');
    table('cn-entradas-table', ['Cuándo', 'Evento', 'Pedido', 'Teléfono', 'Resultado', 'Detalle'], r.entradas.map(function (e) {
      var kind = e.resultado === 'enviado' ? 'ok' : e.resultado === 'bloqueado' || e.resultado === 'error' ? 'bad' : 'warn';
      return [esc(fmt(e.createdAt)), '<code>' + esc(e.evento) + '</code>' + (e.eventoOrigen ? '<br><small class="muted">' + esc(e.eventoOrigen) + '</small>' : ''), esc(e.pedido || '—'), esc(e.telefono || '—'), pill(kind, e.resultado), esc(e.detalle || '')];
    }), 'Todavía no ha llegado ningún pedido de esta tienda.');
    document.getElementById('cn-entradas').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) { show('cn-state', error.message, 'bad'); }
}


// --------------------------------------------------------------- pedidos del chat
var PD_ESTADOS = { nuevo: ['warn', 'nuevo'], confirmado: ['ok', 'confirmado'], enviado_tienda: ['ok', 'en la tienda'], cancelado: ['bad', 'cancelado'] };
async function loadPedidos() {
  try {
    var estado = val('pd-estado');
    var r = await api('/api/v1/pedidos?limite=100' + (estado ? '&estado=' + estado : ''));
    table('pd-table', ['#', 'Cliente', 'Pedido', 'Total', 'Entrega y pago', 'Estado', ''], r.pedidos.map(function (p) {
      var lineas = p.items.map(function (l) { return l.cantidad + ' x ' + esc(l.nombre) + (l.subtotal != null ? ' <small class="muted">' + esc(p.moneda) + ' ' + Number(l.subtotal).toFixed(2) + '</small>' : ''); }).join('<br>');
      var datos = [p.direccion ? 'Entrega: ' + esc(p.direccion) : null, p.pago ? 'Pago: ' + esc(p.pago) : null, p.notas ? '<small class="muted">' + esc(p.notas) + '</small>' : null].filter(Boolean).join('<br>');
      var e = PD_ESTADOS[p.estado] || ['warn', p.estado];
      var botones = '';
      if (p.estado === 'nuevo') botones += '<button class="sm" data-pd-estado="confirmado" data-pd-id="' + p.id + '">Confirmar</button> ';
      if (p.estado !== 'cancelado') botones += '<button class="ghost sm" data-pd-estado="enviado_tienda" data-pd-id="' + p.id + '">Ya en la tienda</button> <button class="danger sm" data-pd-estado="cancelado" data-pd-id="' + p.id + '">Cancelar</button>';
      var cliente = esc(p.nombre || p.contactoNombre || p.contactoTelefono) + '<br><small class="muted">' + esc(p.contactoTelefono) + ' · ' + esc(fmt(p.createdAt)) + (p.origen === 'ia' ? ' · lo tomó la IA' : '') + '</small>';
      return ['<b>' + p.id + '</b>', cliente, lineas, '<b>' + esc(p.moneda) + ' ' + Number(p.total).toFixed(2) + '</b>', datos || '—', pill(e[0], e[1]) + (p.externoId ? '<br><small class="muted">tienda #' + esc(p.externoId) + '</small>' : ''), botones];
    }), 'Todavía no hay pedidos tomados en el chat. Cuando el asistente tenga tu catálogo (Mi asistente IA → Tu catálogo real) podrá cerrarlos solo.');
    document.querySelectorAll('[data-pd-estado]').forEach(function (b) {
      b.onclick = async function () {
        var estadoNuevo = b.getAttribute('data-pd-estado');
        if (estadoNuevo === 'cancelado' && !(await confirmarDialogo({ titulo: 'Cancelar el pedido', texto: 'El pedido queda como cancelado. Avísale al cliente por el chat.', boton: 'Cancelar pedido', peligro: true }))) return;
        try { await api('/api/v1/pedidos/' + b.getAttribute('data-pd-id'), { method: 'PATCH', body: { estado: estadoNuevo } }); loadPedidos(); }
        catch (error) { show('pd-state', error.message, 'bad'); }
      };
    });
  } catch (error) {
    document.getElementById('pd-table').innerHTML = '<div class="empty">' + esc(error.message) + '</div>';
  }
}
document.getElementById('pd-refrescar').onclick = loadPedidos;
document.getElementById('pd-estado').onchange = loadPedidos;

// --------------------------------------------------------------- asistente IA
var IA_HISTORIAL = [];
function iaPintarProveedor() {
  var p = val('ia-proveedor');
  document.getElementById('ia-openai').classList.toggle('hidden', p !== 'openai');
  document.getElementById('ia-openai-clave').classList.toggle('hidden', p !== 'openai');
  document.getElementById('ia-puter-caja').classList.toggle('hidden', p === 'openai');
  document.getElementById('ia-modelo-gratis').classList.toggle('hidden', p === 'openai');
  document.getElementById('ia-modelo-nota').classList.toggle('hidden', p === 'openai');
  document.getElementById('ia-modelo').classList.toggle('hidden', p !== 'openai');
  var lista = (window.__iaModelos && window.__iaModelos[p]) || [];
  if (p === 'openai') {
    var s = iaServicioActual();
    if (s && s.modelos.length) lista = s.modelos;
  }
  document.getElementById('ia-modelos').innerHTML = lista.map(function (m) { return '<option value="' + esc(m) + '">'; }).join('');
}
/* Los servicios compatibles con OpenAI: elegir uno rellena la URL y sugiere modelos. */
var IA_SERVICIOS = [];
function iaServicioActual() {
  var id = val('ia-servicio');
  for (var i = 0; i < IA_SERVICIOS.length; i++) if (IA_SERVICIOS[i].id === id) return IA_SERVICIOS[i];
  return null;
}
function iaPintarServicio(rellenar) {
  var s = iaServicioActual();
  var nota = document.getElementById('ia-servicio-nota');
  if (!s) { nota.textContent = ''; return; }
  nota.textContent = (s.sinClave ? 'Sin clave. ' : 'La clave: ' + s.clave + '. ') + (s.modelos.length ? 'Modelos sugeridos: ' + s.modelos.join(', ') + '.' : '');
  document.getElementById('ia-token-openai').placeholder = s.sinClave ? 'no hace falta' : 'pega aquí la clave; se guarda cifrada y no se vuelve a mostrar';
  if (rellenar) {
    if (s.baseUrl) setVal('ia-baseurl', s.baseUrl);
    /* Al cambiar de servicio, el modelo que habia (de otro servicio, o de Puter) ya no vale: se sugiere el primero de este. */
    if (s.modelos.length && s.modelos.indexOf(val('ia-modelo')) < 0) setVal('ia-modelo', s.modelos[0]);
  }
  iaPintarProveedor();
}
document.getElementById('ia-servicio').onchange = function () { iaPintarServicio(true); };
document.getElementById('ia-probar-conexion').onclick = async function () {
  var estado = document.getElementById('ia-conexion-estado');
  var boton = this;
  boton.disabled = true;
  estado.textContent = 'Probando…';
  try {
    var p = val('ia-proveedor');
    var body = { proveedor: p };
    if (p === 'openai') {
      body.baseUrl = val('ia-baseurl');
      body.modelo = val('ia-modelo');
      var clave = val('ia-token-openai');
      if (clave) body.token = clave;
    } else {
      body.modelo = val('ia-modelo-gratis');
      var tokenPuter = val('ia-token');
      if (tokenPuter) body.token = tokenPuter;
    }
    var r = await api('/admin/ia/probar-conexion', { method: 'POST', body: body });
    estado.innerHTML = r.ok ? '<b style="color:var(--ok)">Funciona</b> (' + Math.round(r.prueba.ms / 100) / 10 + ' s, ' + esc(r.prueba.modelo) + '). ' + esc(r.prueba.detalle) : '<b style="color:var(--bad)">No responde:</b> ' + esc(r.prueba.detalle);
  } catch (e) { estado.textContent = e.message; }
  boton.disabled = false;
};
/* Puter.js se carga solo en esta pantalla y solo la primera vez que hace falta. */
var IA_PUTER_CARGA = null;
function iaCargarPuter() {
  if (window.puter) return Promise.resolve();
  if (IA_PUTER_CARGA) return IA_PUTER_CARGA;
  IA_PUTER_CARGA = new Promise(function (resolve, reject) {
    var sc = document.createElement('script');
    sc.src = 'https://js.puter.com/v2/';
    sc.onload = function () { resolve(); };
    sc.onerror = function () { IA_PUTER_CARGA = null; reject(new Error('No se pudo cargar Puter.js. Revisa la conexión a internet o si un bloqueador lo está frenando.')); };
    document.head.appendChild(sc);
  });
  return IA_PUTER_CARGA;
}
/* Los errores de Puter llegan en inglés y con tres formas; se traducen los que se van a ver. */
function iaErrorPuter(e) {
  var code = (e && (e.code || (typeof e.error === 'string' ? e.error : (e.error && e.error.code)))) || '';
  var msg = (e && (e.message || e.msg || (e.error && e.error.message))) || '';
  if (code === 'popup_blocked') return 'El navegador bloqueó la ventana de Puter. Permite las ventanas emergentes de este sitio (el icono a la derecha de la barra de direcciones) y vuelve a pulsar.';
  if (code === 'auth_canceled' || code === 'auth_window_closed' || /cancelled the authentication/i.test(msg)) return 'Se cerró la ventana sin entrar. Pulsa «Conectar con Puter» y entra con Google, Microsoft, Apple o correo (gratis, sin tarjeta).';
  if (typeof e === 'string') return e;
  return msg || 'No se pudo conectar con Puter.';
}
/* Tiene que llamarse DIRECTO desde el clic: si se abre después de esperar, Chrome bloquea la ventana. */
document.getElementById('ia-puter-conectar').onclick = async function () {
  var estado = document.getElementById('ia-puter-estado');
  var boton = document.getElementById('ia-puter-conectar');
  boton.disabled = true;
  estado.textContent = 'Abriendo Puter…';
  try {
    await iaCargarPuter();
    if (!window.puter || !puter.auth) throw new Error('No se pudo cargar Puter.js.');
    if (!puter.authToken) await puter.auth.signIn();
    if (!puter.authToken) throw new Error('No se obtuvo la sesión de Puter.');
    var quien = 'tu cuenta';
    try { var u = await puter.auth.getUser(); quien = (u && (u.username || u.email)) || quien; } catch (e) {}
    // El token de la sesión va al servidor (cifrado): es el que usa para
    // contestar por WhatsApp cuando nadie tiene el panel abierto.
    await api('/admin/ia', { method: 'POST', body: { token: puter.authToken, proveedor: 'puter' } });
    estado.textContent = 'Conectado como ' + quien + '. Ya puedes guardar y probar.';
    setVal('ia-proveedor', 'puter'); iaPintarProveedor();
    document.getElementById('ia-token-estado').textContent = 'Sesión de Puter guardada en el servidor.';
  } catch (e) {
    estado.textContent = iaErrorPuter(e);
  }
  boton.disabled = false;
};
document.getElementById('ia-proveedor').onchange = iaPintarProveedor;
var VOZ_VOCES = [];
async function loadVoz() {
  try {
    var e = await api('/admin/voz');
    var caja = document.getElementById('voz-estado-caja');
    var cuenta = e.cuenta ? ' Plan ' + esc(e.cuenta.plan || 'free') + ': quedan ' + esc(Math.max(0, e.cuenta.caracteresLimite - e.cuenta.caracteresUsados).toLocaleString('es-PE')) + ' caracteres este mes.' : '';
    caja.innerHTML = e.lista
      ? '<b style="color:var(--ok)">Voz lista.</b> ' + (e.cuando === 'siempre' ? 'El asistente contesta siempre con audio.' : e.cuando === 'si-manda-audio' ? 'El asistente contesta con audio cuando el cliente manda un audio.' : 'El asistente solo manda audio cuando otro sistema lo pide.') + (e.transcribir ? ' Los audios del cliente se transcriben.' : '') + cuenta
      : '<b>La voz no está lista:</b> ' + esc(e.motivo || '') + (e.tieneClave && e.transcribir ? ' Aun así, con la clave guardada los audios del cliente ya se transcriben.' : '') + cuenta;
    if (e.ultimoError) caja.innerHTML += '<br><span style="color:var(--bad)">Último fallo (' + esc(fmt(e.ultimoError.at)) + '): ' + esc(e.ultimoError.detalle) + '</span>';
    document.getElementById('voz-clave-estado').textContent = e.tieneClave ? 'Hay una clave guardada' + (e.claveTermina ? ' (termina en …' + e.claveTermina + ')' : '') + '. Deja el campo vacío para conservarla; pega otra para cambiarla.' : 'Todavía no hay clave: sin ella no hay audios ni transcripción.';
    var selModelo = document.getElementById('voz-modelo');
    selModelo.innerHTML = (e.modelos || []).map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.nombre) + '</option>'; }).join('');
    selModelo.value = e.modelo;
    selModelo.onchange = function () { var m = (e.modelos || []).filter(function (x) { return x.id === selModelo.value; })[0]; document.getElementById('voz-modelo-nota').textContent = m ? m.nota : ''; };
    selModelo.onchange();
    setVal('voz-cuando', e.cuando); setVal('voz-max', e.maxCaracteres);
    document.getElementById('voz-transcribir').checked = e.transcribir;
    document.getElementById('voz-activa').checked = e.activa;
    setVal('voz-clave', '');
    var sel = document.getElementById('voz-voz');
    if (e.tieneClave) {
      try {
        var v = await api('/admin/voz/voces');
        VOZ_VOCES = v.voces || [];
        sel.innerHTML = '<option value="">Elige una voz</option>' + VOZ_VOCES.map(function (x) {
          var et = x.etiquetas || {};
          var detalle = [et.gender, et.accent, et.age, et.use_case || et.description].filter(Boolean).join(' · ');
          return '<option value="' + esc(x.id) + '">' + esc(x.nombre) + (detalle ? ' — ' + esc(detalle) : '') + '</option>';
        }).join('');
        sel.value = e.vozId || '';
        if (e.vozId && !sel.value) sel.innerHTML += '<option value="' + esc(e.vozId) + '" selected>' + esc(e.vozNombre || e.vozId) + ' (ya no está en tu cuenta)</option>';
        document.getElementById('voz-voz-nota').textContent = VOZ_VOCES.length ? VOZ_VOCES.length + ' voces en tu cuenta. En elevenlabs.io → Voices puedes añadir más (hay cientos en español, o clona la tuya).' : 'Tu cuenta no tiene voces todavía: añade alguna en elevenlabs.io → Voices.';
      } catch (error) {
        sel.innerHTML = '<option value="' + esc(e.vozId) + '">' + esc(e.vozNombre || e.vozId || 'Sin voz') + '</option>';
        document.getElementById('voz-voz-nota').textContent = 'No se pudieron traer las voces: ' + error.message;
      }
    }
    var esAdmin = !window.__yo || window.__yo.rol === 'admin';
    document.getElementById('voz-guardar').disabled = !esAdmin;
  } catch (error) { show('voz-state', error.message, 'bad'); }
}
document.getElementById('voz-probar').onclick = busy('voz-probar', async function () {
  var estado = document.getElementById('voz-clave-estado');
  estado.textContent = 'Comprobando con ElevenLabs…';
  try {
    var r = await api('/admin/voz/probar', { method: 'POST', body: val('voz-clave') ? { clave: val('voz-clave') } : {} });
    estado.textContent = r.detalle;
    estado.style.color = r.ok ? 'var(--ok)' : 'var(--bad)';
  } catch (error) { estado.textContent = error.message; estado.style.color = 'var(--bad)'; }
});
document.getElementById('voz-escuchar').onclick = busy('voz-escuchar', async function () {
  var nota = document.getElementById('voz-voz-nota');
  if (!val('voz-voz')) { nota.textContent = 'Elige una voz primero.'; return; }
  nota.textContent = 'Generando la muestra…';
  try {
    var r = await api('/admin/voz/muestra', { method: 'POST', body: { vozId: val('voz-voz'), modelo: val('voz-modelo') } });
    var player = document.getElementById('voz-player');
    player.src = 'data:' + r.mimeType + ';base64,' + r.audioBase64;
    player.classList.remove('hidden');
    await player.play().catch(function () {});
    nota.textContent = 'Así suena (' + (r.formato === 'opus' ? 'nota de voz' : 'MP3: tu plan no permite Opus, llegará como audio normal') + ', ' + Math.round(r.bytes / 1024) + ' KB).';
  } catch (error) { nota.textContent = error.message; }
});
document.getElementById('voz-guardar').onclick = busy('voz-guardar', async function () {
  try {
    var sel = document.getElementById('voz-voz');
    var body = {
      activa: document.getElementById('voz-activa').checked,
      vozId: val('voz-voz'), vozNombre: sel.selectedIndex >= 0 ? (sel.options[sel.selectedIndex].text || '').split(' — ')[0] : '',
      modelo: val('voz-modelo'), cuando: val('voz-cuando'),
      transcribir: document.getElementById('voz-transcribir').checked,
      maxCaracteres: Number(val('voz-max') || 600)
    };
    if (val('voz-clave')) body.clave = val('voz-clave');
    var r = await api('/admin/voz', { method: 'POST', body: body });
    show('voz-state', r.mensaje, r.estado.lista ? 'ok' : 'warn');
    loadVoz();
  } catch (error) { show('voz-state', error.message, 'bad'); }
});
async function loadIaUso() {
  try {
    var u = await api('/admin/ia/uso');
    var h = u.hoy, m = u.mes;
    var caja = document.getElementById('ia-uso');
    var tarjetas = [
      ['Respuestas a clientes hoy', h.respuestas, 'este mes: ' + m.respuestas],
      ['Lecturas para el sistema hoy', h.lecturas, 'entregas, guardadas, resúmenes · este mes: ' + m.lecturas],
      ['Órdenes y ayuda hoy', h.ordenes, 'IA operadora · este mes: ' + m.ordenes],
      ['Fallos hoy', h.fallos, m.fallos ? 'este mes: ' + m.fallos : 'ninguno este mes', h.fallos ? 'bad' : '']
    ];
    if (u.cuentaTokens) tarjetas.push(['Tokens este mes', (m.tokensEntrada + m.tokensSalida).toLocaleString('es-PE'), 'hoy: ' + (h.tokensEntrada + h.tokensSalida).toLocaleString('es-PE') + ' (' + h.tokensEntrada.toLocaleString('es-PE') + ' de entrada, ' + h.tokensSalida.toLocaleString('es-PE') + ' de salida)']);
    if (u.msMedioHoy != null) tarjetas.push(['Tarda de media', (u.msMedioHoy / 1000).toFixed(1) + ' s', 'por respuesta, hoy']);
    var html = tarjetas.map(function (t) { return '<div><span>' + esc(t[0]) + '</span><b class="' + (t[3] || '') + '">' + esc(String(t[1])) + '</b><span>' + esc(t[2]) + '</span></div>'; }).join('');
    if (u.membresia) {
      var mb = u.membresia;
      if (mb.tope == null) html += '<div><span>Tope de tu membresía</span><b>sin límite</b><span>plan ' + esc(mb.plan) + '</span></div>';
      else {
        var pct = mb.tope ? Math.min(100, Math.round(100 * mb.gastadas / mb.tope)) : 100;
        html += '<div><span>Tope de tu membresía</span><b class="' + (pct >= 100 ? 'bad' : '') + '">' + mb.gastadas + ' de ' + mb.tope + '</b><span>respuestas este mes · te quedan ' + mb.quedan + '</span><div class="uso-barra"><i class="' + (pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : '') + '" style="width:' + pct + '%"></i></div></div>';
      }
    }
    caja.innerHTML = html;
    var total = h.respuestas + h.lecturas + h.ordenes + h.pruebas;
    document.getElementById('ia-uso-resumen').textContent = '· hoy ' + total + ' llamada' + (total === 1 ? '' : 's') + (h.fallos ? ', ' + h.fallos + ' fallo' + (h.fallos === 1 ? '' : 's') : '') + (u.membresia && u.membresia.tope != null ? ' · quedan ' + u.membresia.quedan + ' respuestas del plan' : '');
    var nota = document.getElementById('ia-uso-nota');
    if (u.fallosSeguidos >= 3) { nota.innerHTML = '<b style="color:var(--bad)">El asistente lleva ' + u.fallosSeguidos + ' fallos seguidos</b>: ' + esc(u.ultimoFallo ? u.ultimoFallo.detalle : '') + '. Revisa la clave o el servicio y pulsa «Probar la conexión».'; document.getElementById('ia-uso-caja').open = true; }
    else if (u.ultimoFallo) nota.textContent = 'Último fallo: ' + fmt(u.ultimoFallo.cuando) + ' — ' + u.ultimoFallo.detalle;
    else nota.textContent = u.cuentaTokens ? 'Los tokens los dice el servicio en cada respuesta; el costo depende de tu plan con ' + esc(u.servicio || 'ese servicio') + '.' : 'Con Puter no hay tokens que contar aquí: los modelos gratuitos no cuestan nada.';
  } catch (e) { /* sin uso no pasa nada */ }
}
async function loadIa() {
  loadIaUso();
  loadVoz();
  try {
    var e = await api('/admin/ia');
    window.__iaModelos = e.modelosSugeridos;
    IA_SERVICIOS = e.servicios || [];
    var selServicio = document.getElementById('ia-servicio');
    selServicio.innerHTML = IA_SERVICIOS.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.nombre) + '</option>'; }).join('');
    selServicio.value = e.servicio || 'openai';
    var gratis = e.modelosGratis || [];
    var selGratis = document.getElementById('ia-modelo-gratis');
    selGratis.innerHTML = gratis.map(function (m) { var d = (e.descripcionGratis && e.descripcionGratis[m]) || ''; return '<option value="' + esc(m) + '" title="' + esc(m) + '">' + esc(d ? d : m) + '</option>'; }).join('');
    selGratis.value = gratis.indexOf(e.modelo) >= 0 ? e.modelo : e.modeloEfectivo;
    document.getElementById('ia-modelo-nota').innerHTML = 'Solo modelos <b>completamente gratuitos</b> de Puter (no cuestan nada). ' + (e.modelosGratisOrigen === 'catalogo' ? 'Comprobado con su lista en vivo.' : 'Lista fija (no se pudo consultar la suya).') + (e.proveedor === 'puter' && e.modelo !== e.modeloEfectivo ? ' <b>El modelo guardado ya no es gratuito: se usa ' + esc(e.modeloEfectivo) + '.</b>' : '');
    setVal('ia-nombre', e.nombreAsistente); setVal('ia-conocimiento', e.conocimiento); setVal('ia-instrucciones', e.instrucciones);
    setVal('ia-proveedor', e.proveedor); setVal('ia-baseurl', e.baseUrl); setVal('ia-modelo', e.modelo); setVal('ia-derivar', e.derivarSi); setVal('ia-memoria', e.memoria);
    iaPintarServicio(false);
    setVal('ia-catalogo-url', e.catalogoUrl || ''); setVal('ia-catalogo-formato', e.catalogoFormato || 'auto');
    document.getElementById('ia-avisar').checked = e.avisarDerivacion;
    document.getElementById('ia-activa').checked = e.activa;
    /* la tira de pasos: que falta, de un vistazo */
    var p1 = document.getElementById('ia-p1'), p2 = document.getElementById('ia-p2'), p3 = document.getElementById('ia-p3');
    p1.className = 'estado ' + (e.tieneToken ? 'ok' : 'bad');
    document.getElementById('ia-p1-t').textContent = e.tieneToken ? (e.proveedor === 'puter' ? 'Puter conectado, modelo ' + e.modeloEfectivo + '.' : 'Clave guardada (' + (e.servicio || 'openai') + '), modelo ' + e.modelo + '.') : 'Sin clave ni sesión todavía.';
    p2.className = 'estado ' + (e.conocimiento && e.conocimiento.trim() ? 'ok' : 'bad');
    document.getElementById('ia-p2-t').textContent = e.conocimiento && e.conocimiento.trim() ? 'Sabe ' + e.conocimiento.trim().length + ' caracteres sobre el negocio.' : 'Todavía no le contaste nada del negocio.';
    p3.className = 'estado ' + (e.activa && e.tieneToken ? 'ok' : 'bad');
    document.getElementById('ia-p3-t').textContent = e.activa && e.tieneToken ? 'Encendido: contesta solo.' : e.activa ? 'Marcado como encendido, pero sin clave no puede contestar.' : 'Apagado: no contesta a nadie.';
    document.getElementById('ia-token-estado').textContent = e.tieneToken ? 'Hay una sesión o clave guardada. Deja el campo vacío para conservarla; escribe otra para cambiarla.' : 'Todavía no hay sesión ni clave: sin eso el asistente no puede contestar.';
    setVal('ia-token', ''); setVal('ia-token-openai', '');
    document.getElementById('ia-puter-estado').textContent = e.tieneToken && e.proveedor === 'puter' ? 'Hay una sesión de Puter guardada.' : '';
    iaPintarProveedor();
    iaCargarEscenarios();
    var esAdmin = !window.__yo || window.__yo.rol === 'admin';
    document.getElementById('ia-guardar').disabled = !esAdmin;
    if (!esAdmin) show('ia-state', 'Solo un administrador cambia el asistente; tú puedes probarlo abajo.', 'warn');
  } catch (error) { show('ia-state', error.message, 'bad'); }
}
document.getElementById('ia-guardar').onclick = busy('ia-guardar', async function () {
  try {
    var body = {
      activa: document.getElementById('ia-activa').checked,
      proveedor: val('ia-proveedor'), servicio: val('ia-servicio') || 'openai', modelo: val('ia-proveedor') === 'openai' ? (val('ia-modelo') || 'gpt-4o-mini') : val('ia-modelo-gratis'), baseUrl: val('ia-baseurl'),
      nombreAsistente: val('ia-nombre') || 'Asistente', conocimiento: document.getElementById('ia-conocimiento').value, instrucciones: document.getElementById('ia-instrucciones').value,
      derivarSi: val('ia-derivar'), avisarDerivacion: document.getElementById('ia-avisar').checked, memoria: Number(val('ia-memoria') || 12),
      catalogoUrl: val('ia-catalogo-url'), catalogoFormato: val('ia-catalogo-formato') || 'auto'
    };
    var tokenManual = val('ia-proveedor') === 'openai' ? val('ia-token-openai') : val('ia-token');
    if (tokenManual) body.token = tokenManual;
    var r = await api('/admin/ia', { method: 'POST', body: body });
    show('ia-state', r.estado.activa ? 'Guardado. El asistente está encendido y contestará a quien escriba.' : 'Guardado. El asistente está apagado.', 'ok');
    loadIa();
    if (typeof loadInicio === 'function') loaded.inicio = false;
  } catch (error) { show('ia-state', error.message, 'bad'); }
});
function iaPintarChat() {
  var caja = document.getElementById('ia-chat');
  caja.innerHTML = IA_HISTORIAL.length ? IA_HISTORIAL.map(function (m, i) {
    var corregir = m.role !== 'user' && !m.error ? ' <a href="#" class="muted" data-ia-corregir="' + i + '" style="font-size:12px;white-space:nowrap">✎ Corregir</a>' : '';
    return '<div class="b' + (m.role === 'user' ? ' yo' : '') + (m.derivo ? ' derivo' : '') + '">' + esc(m.content) + corregir + (m.derivo ? '<br><small class="muted">→ aquí pasaría la conversación a una persona</small>' : '') + '</div>';
  }).join('') : '<div class="muted" style="padding:10px">Escribe abajo como si fueras un cliente.</div>';
  caja.scrollTop = caja.scrollHeight;
}
/* Corregir una respuesta de la prueba: queda como leccion (ver /entrenamiento). */
document.getElementById('ia-chat').addEventListener('click', async function (ev) {
  var a = ev.target.closest('[data-ia-corregir]');
  if (!a) return;
  ev.preventDefault();
  var i = Number(a.getAttribute('data-ia-corregir'));
  var m = IA_HISTORIAL[i];
  var pregunta = '';
  for (var k = i - 1; k >= 0; k--) if (IA_HISTORIAL[k].role === 'user') { pregunta = IA_HISTORIAL[k].content; break; }
  var v = await pedirLeccion({ titulo: 'Corregir al asistente', texto: 'Escribe lo que debió responder. Ante una pregunta parecida contestará así y no repetirá lo de abajo.', pregunta: pregunta, respuesta: '', mala: m.content, boton: 'Corregir' });
  if (!v) return;
  try {
    var r = await api('/admin/entrenamiento/lecciones', { method: 'POST', body: { tipo: 'ejemplo', pregunta: v.pregunta, respuesta: v.respuesta, tema: v.tema || null, mala: v.mala || null, origen: 'correccion', origenDetalle: 'prueba en Mi asistente IA' } });
    show('ia-state', r.nueva ? 'Corregido: el asistente ya lo sabe (se ve en Entrenar a la IA).' : 'Esa lección ya la tenía.', 'ok');
  } catch (error) { show('ia-state', error.message, 'bad'); }
});
document.getElementById('ia-probar').onclick = busy('ia-probar', async function () {
  var texto = val('ia-probar-texto');
  if (!texto) return;
  IA_HISTORIAL.push({ role: 'user', content: texto });
  setVal('ia-probar-texto', '');
  iaPintarChat();
  try {
    var r = await api('/admin/ia/probar', { method: 'POST', body: { texto: texto, historial: IA_HISTORIAL.slice(0, -1).map(function (m) { return { role: m.role, content: m.content }; }) } });
    IA_HISTORIAL.push({ role: 'assistant', content: r.texto || '(sin texto)', derivo: r.derivar });
  } catch (error) {
    IA_HISTORIAL.push({ role: 'assistant', content: '⚠ ' + error.message, error: true });
  }
  iaPintarChat();
});
document.getElementById('ia-probar-texto').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('ia-probar').click(); } };
document.getElementById('ia-probar-limpiar').onclick = function () { IA_HISTORIAL = []; iaPintarChat(); };
document.getElementById('ia-catalogo-probar').onclick = busy('ia-catalogo-probar', async function () {
  var est = document.getElementById('ia-catalogo-estado');
  est.textContent = 'Leyendo el catálogo…';
  try {
    var r = await api('/admin/ia/catalogo/probar', { method: 'POST', body: { catalogoUrl: val('ia-catalogo-url'), catalogoFormato: val('ia-catalogo-formato') || 'auto' } });
    est.textContent = r.ok ? 'Responde: ' + r.total + ' productos. Ejemplo: ' + (r.ejemplo || '—') : 'No se pudo leer: ' + (r.detalle || 'sin detalle');
  } catch (error) { est.textContent = error.message; }
});

// --- el examen de escenarios ---
async function iaCargarEscenarios() {
  try {
    var e = await api('/admin/ia/escenarios');
    var sel = document.getElementById('ia-esc-grupo');
    var cuenta = {};
    e.escenarios.forEach(function (x) { cuenta[x.grupo] = (cuenta[x.grupo] || 0) + 1; });
    sel.innerHTML = Object.keys(e.grupos).map(function (g) { return '<option value="' + esc(g) + '">' + esc(e.grupos[g]) + ' (' + (cuenta[g] || 0) + ')</option>'; }).join('');
  } catch (error) { /* sin IA en este arranque */ }
}
document.getElementById('ia-esc-correr').onclick = busy('ia-esc-correr', async function () {
  var grupo = val('ia-esc-grupo');
  show('ia-esc-state', 'Corriendo… cada cliente tarda unos segundos.', 'warn');
  document.getElementById('ia-esc-resumen').textContent = '';
  try {
    var r = await api('/admin/ia/escenarios', { method: 'POST', body: { grupo: grupo } });
    var s = r.resumen;
    document.getElementById('ia-esc-resumen').innerHTML = '<b>' + s.limpias + ' de ' + s.total + '</b> sin observaciones' + (s.conAlertas ? ' · ' + s.conAlertas + ' con observaciones' : '') + (s.conError ? ' · ' + s.conError + ' sin respuesta (error del modelo)' : '');
    table('ia-esc-table', ['Cliente escribe', 'Responde', 'Observaciones'], r.resultados.map(function (x) {
      var obs = x.error ? pill('bad', 'error') + ' <small class="muted">' + esc(x.error) + '</small>' : x.alertas.length ? x.alertas.map(function (a) { return pill('warn', a); }).join(' ') : pill('ok', 'bien');
      var acc = (x.derivo ? ' <small class="muted">→ pasa con una persona</small>' : '') + (x.pidioUbicacion ? ' <small class="muted">→ pide la ubicación</small>' : '');
      return [x.mensajes.map(esc).join('<br><i class="muted">luego:</i> '), esc(x.respuesta || '(sin texto)') + acc, obs];
    }), 'Sin resultados.');
    show('ia-esc-state', 'Listo.', 'ok');
  } catch (error) { show('ia-esc-state', error.message, 'bad'); }
});

// --- chat embebido ---
async function loadEmbebido() {
  document.getElementById('em-ejemplo').textContent =
    '<!-- 1. En el servidor de la otra web, con su clave (permiso embed:emitir): -->\n' +
    'POST ' + location.origin + '/api/v1/embed/token   {"operador":"ana","telefono":"51987654321"}   → {"token":"emb_..."}\n\n' +
    '<!-- 2. En su pagina: -->\n' +
    '<div id="chat-wa" style="height:600px"></div>\n' +
    '<script src="' + location.origin + '/embed.js"><\/script>\n' +
    '<script>\n' +
    '  var chat = WA.montar("#chat-wa", {\n' +
    '    token: "emb_...",                 // el del paso 1\n' +
    '    telefono: "51987654321",          // opcional: solo ese hilo; sin el, la bandeja completa\n' +
    '    onNoLeidos: function (n) {},      // cuantos chats esperan respuesta\n' +
    '    onMensaje: function (m) {},       // llego o salio un mensaje\n' +
    '    onTokenCaducado: function () { /* pedir otro y chat.actualizarToken(nuevo) */ }\n' +
    '  });\n' +
    '<\/script>';
  try {
    var a = await api('/admin/ajustes');
    var dominios = (a.guardado && a.guardado.embebido && a.guardado.embebido.dominios) || [];
    setVal('em-dominios', dominios.join('\n'));
  } catch (error) { show('em-state', error.message, 'bad'); }
}
document.getElementById('em-guardar').onclick = busy('em-guardar', async function () {
  try {
    var dominios = val('em-dominios').split(/\r?\n/).map(function (d) { return d.trim(); }).filter(Boolean);
    var malos = dominios.filter(function (d) { return !/^https?:\/\/[^\s/]+$/i.test(d); });
    if (malos.length) return show('em-state', 'Solo el origen, sin ruta: https://stoky.app (revisa: ' + malos.join(', ') + ')', 'bad');
    await api('/admin/ajustes', { method: 'POST', body: { embebido: { dominios: dominios } } });
    show('em-state', dominios.length ? 'Guardado: ' + dominios.length + ' web' + (dominios.length === 1 ? '' : 's') + ' pueden embeber el chat.' : 'Guardado: ninguna web ajena puede embeber el chat.', 'ok');
  } catch (error) { show('em-state', error.message, 'bad'); }
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
    var b = typeof id === 'string' ? document.getElementById(id) : id; b.disabled = true;
    try { await fn(); } finally { b.disabled = false; }
  };
}
function qualityKind(q) { return q === 'GREEN' ? 'ok' : q === 'YELLOW' ? 'warn' : 'bad'; }
/* Meta contesta GREEN / YELLOW / RED: en pantalla va en palabras. */
function calidadEnPalabras(q) { return q === 'GREEN' ? 'Verde' : q === 'YELLOW' ? 'Amarilla' : q === 'RED' ? 'Roja' : q === 'UNKNOWN' || !q ? '—' : String(q); }
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
      '<div class="stat"><span class="muted">Calidad</span><b class="' + qualityKind(n.quality) + '">' + esc(calidadEnPalabras(n.quality)) + '</b><span class="muted">' + esc(n.tier || 'tier desconocido') + '</span></div>' +
      '<div class="stat"><span class="muted">Estado</span><b>' + (n.paused ? 'PAUSADO' : 'activo') + '</b><span class="muted">' + esc(n.pausedReason || '') + '</span></div>' +
      '<div class="stat"><span class="muted">Enviados hoy</span><b>' + h.sentToday + ' / ' + h.dailyCap + '</b><span class="muted">cupo de warm-up</span></div>' +
      '<div class="stat"><span class="muted">En cola</span><b>' + ((h.queue.waiting || 0) + (h.queue.delayed || 0)) + '</b><span class="muted">' + (h.queue.failed || 0) + ' fallidos</span></div>' +
      '<div class="stat"><span class="muted">WhatsApp</span><b class="' + (h.configured ? 'ok' : 'warn') + '">' + (h.configured ? 'Conectado' : 'Sin conectar') + '</b><span class="muted">' + esc((h.missing || []).join(', ')) + '</span></div>' +
      (h.salud ? '<div class="stat"><span class="muted">Salud</span><b class="' + nivelKind(h.salud.nivel) + '">' + esc(h.salud.nivel) + '</b><span class="muted">velocidad al ' + Math.round((h.salud.factor || 0) * 100) + ' % - <a href="#salud">ver por que</a></span></div>' : '');
    show('state', n.paused ? 'Envios pausados' : 'Operativo', n.paused ? 'warn' : 'ok');
    // Lo que Meta cambia con fecha (solo con la API oficial): se marca como hecho en Conexion de WhatsApp.
    var avisos = (h.avisosMeta || []).filter(function (a) { return a.estado !== 'ok'; });
    var cajaAvisos = document.getElementById('estado-avisos-meta');
    if (avisos.length) {
      var COLOR = { vencido: 'bad', urgente: 'warn', pendiente: '', hecho: 'ok' };
      cajaAvisos.innerHTML = avisos.map(function (a) {
        var cuando = a.estado === 'hecho' ? 'hecho el ' + fmt(a.hechoEl).split(',')[0] : a.diasRestantes < 0 ? 'venció hace ' + (-a.diasRestantes) + ' días' : a.diasRestantes === 0 ? 'vence hoy' : 'quedan ' + a.diasRestantes + ' días';
        return '<div style="padding:8px 12px;border:1px solid var(--line);border-radius:10px;margin-bottom:6px">' + pill(COLOR[a.estado] || 'warn', cuando) + ' <b>' + esc(a.titulo) + '</b>' + (a.estado === 'hecho' ? '' : '<br><span class="muted">' + esc(a.detalle) + ' <a href="/setup">Marcar como hecho en Conexión de WhatsApp</a>.</span>') + '</div>';
      }).join('');
      cajaAvisos.classList.remove('hidden');
    } else { cajaAvisos.classList.add('hidden'); cajaAvisos.innerHTML = ''; }
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
function hastaCuando(iso) { if (!iso) return ''; var d = new Date(iso); return d.toLocaleString('es-PE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', hour12: false }); }
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
      '<div class="stat"><span class="muted">Meta dice</span><b class="' + qualityKind(n.quality) + '">' + esc(calidadEnPalabras(n.quality)) + '</b><small>' + esc(n.estado || '') + (n.tier ? ' - ' + esc(n.tier) : '') + '</small></div>' +
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
  var opcionesSk = function (elegido) {
    return '<option value="">sin sticker</option>' + (atajosStickers || []).map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === elegido ? ' selected' : '') + '>' + esc(s.nombre) + '</option>'; }).join('');
  };
  document.getElementById('at-lista').innerHTML = atajosCache.map(function (a, i) {
    return '<div class="at-fila"><input class="pre" data-at-atajo="' + i + '" value="' + esc(a.atajo) + '" placeholder="atajo"><textarea data-at-texto="' + i + '" placeholder="Texto que se manda">' + esc(a.texto) + '</textarea><div><select data-at-sticker="' + i + '" title="Sticker que sale después del texto">' + opcionesSk(a.sticker || '') + '</select><button class="danger sm" data-at-borrar="' + i + '" style="margin-top:6px;width:100%">Quitar</button></div></div>';
  }).join('') || '<div class="empty">Sin atajos. Añade uno.</div>';
  document.querySelectorAll('[data-at-borrar]').forEach(function (b) { b.onclick = function () { leerAtajos(); atajosCache.splice(Number(b.getAttribute('data-at-borrar')), 1); pintarAtajos(); }; });
}
function leerAtajos() {
  atajosCache = Array.prototype.slice.call(document.querySelectorAll('[data-at-atajo]')).map(function (inp) {
    var i = inp.getAttribute('data-at-atajo');
    return { atajo: inp.value.trim().replace(/^\//, ''), texto: document.querySelector('[data-at-texto="' + i + '"]').value.trim(), sticker: (document.querySelector('[data-at-sticker="' + i + '"]') || {}).value || null };
  });
}
var atajosStickers = [];
async function loadAtajos() {
  try { var r = await api('/admin/chat/atajos'); atajosCache = r.atajos; try { atajosStickers = (await api('/admin/stickers')).stickers; } catch (e) { atajosStickers = []; } pintarAtajos(); }
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
    var soySuper = Boolean(yo && yo.super);
    document.getElementById('us-rol-super').classList.toggle('hidden', !soySuper);
    var ROLES = { superadmin: ['ok', 'Superadministrador'], admin: ['ok', 'Administrador'], operador: ['muted', 'Operador'] };
    var list = await api('/admin/usuarios');
    table('us-table', ['Usuario', 'Nombre', 'Rol', 'Estado', 'Ultimo acceso', ''], list.map(function (u) {
      // Una cuenta de superadministrador solo la toca otro superadministrador.
      var intocable = u.rol === 'superadmin' && !soySuper;
      var opcionesRol = (soySuper ? ['superadmin', 'admin', 'operador'] : ['admin', 'operador']).filter(function (r) { return r !== u.rol; });
      var acciones = intocable ? '<span class="muted">solo un superadministrador</span>' :
        '<button class="ghost sm" data-us-clave="' + esc(u.id) + '">Nueva contrasena</button> ' +
        opcionesRol.map(function (r) { return '<button class="ghost sm" data-us-rol="' + esc(u.id) + '" data-rol="' + r + '">Hacer ' + ROLES[r][1].toLowerCase() + '</button> '; }).join('') +
        '<button class="' + (u.activo ? 'danger' : 'ghost') + ' sm" data-us-activo="' + esc(u.id) + '" data-activo="' + (u.activo ? 'false' : 'true') + '">' + (u.activo ? 'Desactivar' : 'Activar') + '</button>';
      var rol = ROLES[u.rol] || ['muted', u.rol];
      return [esc(u.usuario), esc(u.nombre), pill(rol[0], rol[1]), pill(u.activo ? 'ok' : 'bad', u.activo ? 'activo' : 'desactivado'), esc(fmt(u.ultimoLoginAt) || 'nunca'), acciones];
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
// -------------------------------------------------------------- membresia
var mbPlanes = [];
function mbPintarEstado(m) {
  var caja = document.getElementById('mb-estado');
  var p = m.plan;
  if (!p) {
    caja.innerHTML = '<b>Instancia libre:</b> <span class="muted">sin membresía, todo está permitido sin tope.' + (m.editable ? ' Elige un plan abajo si quieres ponerle vencimiento y topes.' : '') + '</span>';
    return;
  }
  var l = p.limites;
  var color = p.vencido ? 'var(--rojo)' : p.diasRestantes <= 7 ? 'var(--ambar)' : 'var(--verde)';
  var suspendida = m.local && m.local.estado === 'suspendida';
  caja.innerHTML = '<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center"><div><b>Plan ' + esc(p.nombre) + '</b> <span style="color:' + color + ';font-weight:600">' + (suspendida ? '· suspendida' : p.vencido ? '· vencida' : '· vence en ' + p.diasRestantes + ' día' + (p.diasRestantes === 1 ? '' : 's')) + '</span><br><small class="muted">Pagada hasta el ' + esc(new Date(p.vencimiento).toLocaleDateString('es-PE')) + (p.precioMes ? ' · ' + esc(p.moneda) + ' ' + p.precioMes + ' al mes' : ' · gratis') + ' · ' + (m.origen === 'maestro' ? 'la lleva el maestro del SaaS' : 'la lleva el superadministrador de esta instalación') + '</small></div>' +
    '<div class="muted" style="font-size:13px">Asistente IA: ' + (l.iaTurnosMes === 0 ? 'no incluido' : l.iaTurnosMes == null ? 'sin límite' : m.iaTurnosMes + ' de ' + l.iaTurnosMes + ' respuestas este mes') + ' · Campañas: ' + (l.campanas ? 'sí' : 'no') + ' · Conectores: ' + (l.conectores ? 'sí' : 'no') + ' · Cuentas: ' + (l.usuarios == null ? 'sin límite' : l.usuarios) + '</div></div>' +
    (m.aviso ? '<p style="margin:8px 0 0;color:' + color + '">' + esc(m.aviso.texto) + '</p>' : '') +
    (p.contacto && !m.aviso ? '<p class="muted" style="margin:8px 0 0">Para renovar: ' + esc(p.contacto) + '</p>' : '');
}
function mbRellenar(m) {
  var sel = document.getElementById('mb-plan');
  sel.innerHTML = mbPlanes.map(function (p) { return '<option value="' + esc(p.clave) + '">' + esc(p.nombre) + (p.precioMes ? ' · ' + esc(p.moneda) + ' ' + p.precioMes + '/mes' : '') + '</option>'; }).join('');
  var l = m.local;
  var base = mbPlanes.filter(function (p) { return p.clave === (l ? l.plan : 'prueba'); })[0] || mbPlanes[0];
  sel.value = l ? l.plan : base.clave;
  setVal('mb-nombre', l ? l.nombre : base.nombre);
  var vence = l ? new Date(l.vencimiento) : new Date(Date.now() + 14 * 86400000);
  /* El dia en Lima, no el de UTC: un vencimiento a las 23:59 de Lima es la madrugada siguiente en UTC. */
  setVal('mb-vence', vence.toLocaleDateString('en-CA', { timeZone: 'America/Lima' }).slice(0, 10));
  setVal('mb-estado-sel', l ? l.estado : 'activa');
  var lim = l ? l.limites : base.limites;
  setVal('mb-ia', lim.iaTurnosMes == null ? '' : lim.iaTurnosMes);
  setVal('mb-usuarios', lim.usuarios == null ? '' : lim.usuarios);
  setVal('mb-campanas', lim.campanas ? 'true' : 'false');
  setVal('mb-conectores', lim.conectores ? 'true' : 'false');
  setVal('mb-precio', l ? l.precioMes : base.precioMes);
  setVal('mb-moneda', l ? l.moneda : base.moneda);
  setVal('mb-contacto', l && l.contacto ? l.contacto : '');
  setVal('mb-aviso', l && l.aviso ? l.aviso : '');
  document.getElementById('mb-quitar').classList.toggle('hidden', !l);
  var pagos = (l && l.pagos) || [];
  table('mb-pagos', ['Fecha', 'Meses', 'Monto', 'Nota', 'Lo apuntó'], pagos.slice().reverse().map(function (pg) {
    return [esc(fmt(pg.fecha)), pg.meses, esc(pg.moneda) + ' ' + pg.monto, esc(pg.nota || ''), esc(pg.por || '')];
  }), 'Sin pagos apuntados.');
}
document.getElementById('mb-plan').onchange = function () {
  var p = mbPlanes.filter(function (x) { return x.clave === val('mb-plan'); })[0];
  if (!p) return;
  setVal('mb-nombre', p.nombre);
  setVal('mb-ia', p.limites.iaTurnosMes == null ? '' : p.limites.iaTurnosMes);
  setVal('mb-usuarios', p.limites.usuarios == null ? '' : p.limites.usuarios);
  setVal('mb-campanas', p.limites.campanas ? 'true' : 'false');
  setVal('mb-conectores', p.limites.conectores ? 'true' : 'false');
  setVal('mb-precio', p.precioMes);
  setVal('mb-moneda', p.moneda);
};
async function loadMembresia() {
  try {
    var m = await api('/admin/membresia');
    mbPlanes = m.planes || [];
    mbPintarEstado(m);
    var puede = m.soySuper && m.editable;
    document.getElementById('mb-editar').classList.toggle('hidden', !puede);
    var sl = document.getElementById('mb-solo-lectura');
    sl.classList.toggle('hidden', puede);
    if (!puede) sl.textContent = m.editable ? 'Solo un superadministrador cambia la membresía. Si vence o hay que ampliarla, habla con quien te instaló el sistema.' : 'Esta instalación depende de un maestro: la membresía y los pagos se gestionan desde el panel de quien controla las tiendas.';
    if (puede) mbRellenar(m);
    mbPintarMaestro(m);
  } catch (error) { show('mb-state', error.message, 'bad'); }
}
function mbCuerpo() {
  var ia = val('mb-ia'), us = val('mb-usuarios');
  return {
    plan: val('mb-plan'), nombre: val('mb-nombre'), vencimiento: val('mb-vence'), estado: val('mb-estado-sel'),
    limites: { iaTurnosMes: ia === '' ? null : Number(ia), usuarios: us === '' ? null : Number(us), campanas: val('mb-campanas') === 'true', conectores: val('mb-conectores') === 'true' },
    precioMes: Number(val('mb-precio') || 0), moneda: val('mb-moneda') || 'PEN', contacto: val('mb-contacto') || null, aviso: val('mb-aviso') || null
  };
}
document.getElementById('mb-guardar').onclick = busy('mb-guardar', async function () {
  try {
    var r = await api('/admin/membresia', { method: 'POST', body: mbCuerpo() });
    show('mb-state', r.mensaje, 'ok');
    mbPintarEstado(r); mbRellenar(r);
    loadPlan();
  } catch (error) { show('mb-state', error.message, 'bad'); }
});
document.getElementById('mb-pagar').onclick = busy('mb-pagar', async function () {
  try {
    var r = await api('/admin/membresia/pagos', { method: 'POST', body: { meses: Number(val('mb-pago-meses') || 1), monto: Number(val('mb-pago-monto') || 0), nota: val('mb-pago-nota') } });
    show('mb-state', r.mensaje, 'ok');
    setVal('mb-pago-monto', ''); setVal('mb-pago-nota', '');
    mbPintarEstado(r); mbRellenar(r);
    loadPlan();
  } catch (error) { show('mb-state', error.message, 'bad'); }
});
document.getElementById('mb-quitar').onclick = busy('mb-quitar', async function () {
  if (!(await confirmarDialogo({ titulo: 'Quitar la membresía', texto: 'La instalación queda libre: sin vencimiento ni topes. Los pagos apuntados se pierden.', boton: 'Quitar', peligro: true }))) return;
  try {
    var r = await api('/admin/membresia', { method: 'DELETE' });
    show('mb-state', 'Membresía quitada: instancia libre.', 'ok');
    mbPintarEstado(r); mbRellenar(r);
    loadPlan();
  } catch (error) { show('mb-state', error.message, 'bad'); }
});

// ---------------------------------------------------------------- tiendas
var tiPlanes = [];
function tiSemaforo(t) {
  var c = t.semaforo === 'verde' ? 'ok' : t.semaforo === 'ambar' ? 'warn' : 'bad';
  var txt = t.membresia.estado === 'suspendida' ? 'suspendida' : t.plan.vencido ? 'vencida' : t.plan.diasRestantes <= 7 ? 'vence en ' + t.plan.diasRestantes + ' d' : 'al día';
  return pill(c, txt);
}
async function loadTiendas() {
  try {
    var r = await api('/admin/tiendas');
    var s = r.resumen;
    var al = r.alojamiento || {};
    document.getElementById('ti-alojamiento').innerHTML = al.disponible
      ? '<b style="color:var(--ok)">Alojamiento en este servidor: listo.</b> Cada tienda nueva puede salir con su propia dirección <code>nombre.' + esc(al.dominioBase) + '</code>, ya conectada a este panel: el cliente entra por su URL y listo.'
      : '<b>Sin alojamiento en este servidor.</b> ' + esc(al.motivo || '') + ' La tienda se registra aquí y su instalación se hace aparte (en un servidor con el SaaS preparado, <code>npm run saas:alta</code>); luego se pega la dirección del plan y el token en su Membresía.';
    document.getElementById('ti-instalar-caja').classList.toggle('hidden', !al.disponible);
    document.getElementById('ti-resumen').innerHTML =
      '<div class="stat"><span class="muted">Tiendas</span><b>' + s.total + '</b></div>' +
      '<div class="stat"><span class="muted">Al día</span><b>' + (s.activas - s.porVencer) + '</b></div>' +
      '<div class="stat"><span class="muted">Por vencer (7 días)</span><b>' + s.porVencer + '</b></div>' +
      '<div class="stat"><span class="muted">Vencidas</span><b>' + s.vencidas + '</b></div>' +
      '<div class="stat"><span class="muted">Suspendidas</span><b>' + s.suspendidas + '</b></div>' +
      '<div class="stat"><span class="muted">En línea ahora</span><b>' + s.enLinea + '</b><small>preguntaron por su plan hace menos de 20 min</small></div>' +
      '<div class="stat"><span class="muted">Ingresos al mes</span><b>' + esc(s.moneda) + ' ' + s.ingresosMes + '</b><small>tiendas pagadas y vigentes</small></div>';
    table('ti-table', ['Tienda', 'Plan', 'Pagada hasta', 'Estado', 'En línea', 'Contacto', ''], r.tiendas.map(function (t) {
      var enLinea = t.enLinea ? pill('ok', 'sí') : t.ultimaConsultaAt ? '<span class="muted">última vez ' + esc(fmt(t.ultimaConsultaAt)) + '</span>' : '<span class="muted">nunca se conectó</span>';
      var acciones = '<button class="ghost sm" data-ti-pago="' + esc(t.id) + '">Apuntar pago</button> ' +
        '<button class="ghost sm" data-ti-editar="' + esc(t.id) + '">Cambiar plan</button> ' +
        '<button class="' + (t.membresia.estado === 'suspendida' ? 'ghost' : 'danger') + ' sm" data-ti-susp="' + esc(t.id) + '" data-valor="' + (t.membresia.estado === 'suspendida' ? 'false' : 'true') + '">' + (t.membresia.estado === 'suspendida' ? 'Reactivar' : 'Suspender') + '</button> ' +
        '<button class="ghost sm" data-ti-token="' + esc(t.id) + '">Token nuevo</button> ' +
        (t.url ? '<a class="ghost sm" href="' + esc(t.url) + '" target="_blank" rel="noopener" style="display:inline-block;padding:4px 8px">Abrir</a> ' : '') +
        '<button class="ghost sm" data-ti-borrar="' + esc(t.id) + '">Borrar</button>';
      return ['<b>' + esc(t.nombre) + '</b>' + (t.instalada ? ' ' + pill('ok', 'instalada aquí') : '') + '<br><small class="muted">' + esc(t.slug) + (t.url ? ' · ' + esc(t.url) : '') + '</small>',
        esc(t.plan.nombre) + '<br><small class="muted">' + (t.membresia.precioMes ? esc(t.membresia.moneda) + ' ' + t.membresia.precioMes + '/mes' : 'gratis') + '</small>',
        esc(new Date(t.membresia.vencimiento).toLocaleDateString('es-PE')),
        tiSemaforo(t), enLinea, esc(t.contacto || ''), acciones];
    }), 'Todavía no hay tiendas. Da de alta la primera abajo.');
    if (!tiPlanes.length) {
      var m = await api('/admin/membresia');
      tiPlanes = m.planes || [];
      var sel = document.getElementById('ti-plan');
      sel.innerHTML = tiPlanes.map(function (p) { return '<option value="' + esc(p.clave) + '">' + esc(p.nombre) + (p.precioMes ? ' · ' + esc(p.moneda) + ' ' + p.precioMes + '/mes' : '') + '</option>'; }).join('');
      sel.value = 'prueba';
      setVal('ti-vence', new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
      setVal('ti-precio', '0');
      sel.onchange = function () { var p = tiPlanes.filter(function (x) { return x.clave === sel.value; })[0]; if (p) setVal('ti-precio', p.precioMes); };
    }
    document.querySelectorAll('[data-ti-pago]').forEach(function (b) {
      b.onclick = async function () {
        var meses = await pedirDato({ titulo: 'Apuntar un pago', texto: 'Cuántos meses se pagaron. Corre el vencimiento desde la fecha pagada (o desde hoy si ya venció) y reactiva la tienda.', etiqueta: 'Meses', valor: '1', boton: 'Siguiente', validar: function (v) { return /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 60 ? null : 'Entre 1 y 60 meses.'; } });
        if (!meses) return;
        var monto = await pedirDato({ titulo: 'Monto cobrado', etiqueta: 'Monto (0 si es cortesía)', valor: '0', boton: 'Apuntar', validar: function (v) { return /^\d+([.,]\d{1,2})?$/.test(v) ? null : 'Un número, por ejemplo 49 o 49.90'; } });
        if (monto === null) return;
        try { var r2 = await api('/admin/tiendas/' + b.getAttribute('data-ti-pago') + '/pagos', { method: 'POST', body: { meses: Number(meses), monto: Number(String(monto).replace(',', '.')) } }); show('ti-state', r2.mensaje, 'ok'); loadTiendas(); }
        catch (error) { show('ti-state', error.message, 'bad'); }
      };
    });
    document.querySelectorAll('[data-ti-editar]').forEach(function (b) {
      b.onclick = async function () {
        var id = b.getAttribute('data-ti-editar');
        var t = r.tiendas.filter(function (x) { return x.id === id; })[0];
        var plan = await pedirDato({ titulo: 'Cambiar el plan de ' + t.nombre, texto: 'Escribe uno: ' + tiPlanes.map(function (p) { return p.clave; }).join(', ') + '.', etiqueta: 'Plan', valor: t.membresia.plan, boton: 'Siguiente', validar: function (v) { return tiPlanes.some(function (p) { return p.clave === v.trim(); }) ? null : 'No existe ese plan.'; } });
        if (!plan) return;
        var vence = await pedirDato({ titulo: 'Pagada hasta', etiqueta: 'Fecha (AAAA-MM-DD)', valor: t.membresia.vencimiento.slice(0, 10), boton: 'Guardar', validar: function (v) { return /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : 'Formato AAAA-MM-DD.'; } });
        if (!vence) return;
        try { await api('/admin/tiendas/' + id, { method: 'POST', body: { membresia: { plan: plan.trim(), vencimiento: vence } } }); show('ti-state', 'Plan cambiado.', 'ok'); loadTiendas(); }
        catch (error) { show('ti-state', error.message, 'bad'); }
      };
    });
    document.querySelectorAll('[data-ti-susp]').forEach(function (b) {
      b.onclick = async function () {
        var suspender = b.getAttribute('data-valor') === 'true';
        if (suspender && !(await confirmarDialogo({ titulo: 'Suspender la tienda', texto: 'Su asistente IA y sus campañas se paran en cuanto vuelva a preguntar por el plan (como mucho un cuarto de hora). Sus chats siguen. Se reactiva con un clic.', boton: 'Suspender', peligro: true }))) return;
        try { var r3 = await api('/admin/tiendas/' + b.getAttribute('data-ti-susp') + '/suspender', { method: 'POST', body: { suspendida: suspender } }); show('ti-state', r3.mensaje, 'ok'); loadTiendas(); }
        catch (error) { show('ti-state', error.message, 'bad'); }
      };
    });
    document.querySelectorAll('[data-ti-token]').forEach(function (b) {
      b.onclick = async function () {
        if (!(await confirmarDialogo({ titulo: 'Token nuevo', texto: 'El token anterior deja de valer: esa tienda dejará de recibir su plan hasta que pegues el nuevo en su Membresía.', boton: 'Crear token nuevo' }))) return;
        try { var r4 = await api('/admin/tiendas/' + b.getAttribute('data-ti-token') + '/token', { method: 'POST', body: {} }); tiMostrarToken(r4.tienda, r4.token, ['Pégalo en la Membresía de esa tienda (Esta instalación depende de un maestro) junto a la dirección del plan.']); show('ti-state', r4.mensaje, 'ok'); loadTiendas(); }
        catch (error) { show('ti-state', error.message, 'bad'); }
      };
    });
    document.querySelectorAll('[data-ti-borrar]').forEach(function (b) {
      b.onclick = async function () {
        var id = b.getAttribute('data-ti-borrar');
        var t = r.tiendas.filter(function (x) { return x.id === id; })[0];
        var que = 'dejar';
        if (t && t.instalada) {
          var eleccion = await pedirDato({ titulo: 'Borrar ' + t.nombre, texto: 'Esta tienda tiene su instalación en este servidor. ¿Qué hago con ella? Escribe: dejar (sigue corriendo, solo sale de la lista), parar (se apaga, sus datos se conservan) o borrar (se apaga y se borran sus datos).', etiqueta: 'dejar · parar · borrar', valor: 'parar', boton: 'Borrar la tienda', validar: function (v) { return ['dejar', 'parar', 'borrar'].indexOf(v.trim().toLowerCase()) >= 0 ? null : 'Escribe dejar, parar o borrar.'; } });
          if (!eleccion) return;
          que = eleccion.trim().toLowerCase();
        } else if (!(await confirmarDialogo({ titulo: 'Borrar la tienda', texto: 'Se borra de esta lista y su instalación dejará de recibir plan (quedará como instalación libre o con lo último que supo). No se toca nada en su servidor.', boton: 'Borrar', peligro: true }))) return;
        try { var r5 = await api('/admin/tiendas/' + id + '?instalacion=' + que, { method: 'DELETE' }); show('ti-state', r5.mensaje || 'Borrada.', r5.instalacion && r5.instalacion.intentada && !r5.instalacion.ok ? 'warn' : 'ok'); loadTiendas(); }
        catch (error) { show('ti-state', error.message, 'bad'); }
      };
    });
  } catch (error) { show('ti-state', error.message, 'bad'); }
}
function tiMostrarToken(tienda, token, pasos) {
  document.getElementById('ti-nueva-nombre').textContent = tienda.nombre;
  document.getElementById('ti-token').textContent = token;
  document.getElementById('ti-url-plan').textContent = tienda.urlPlan;
  document.getElementById('ti-pasos').innerHTML = pasos.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('');
  document.getElementById('ti-nueva').classList.remove('hidden');
  document.getElementById('ti-nueva').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
document.getElementById('ti-crear').onclick = busy('ti-crear', async function () {
  try {
    var instalar = !document.getElementById('ti-instalar-caja').classList.contains('hidden') && document.getElementById('ti-instalar').checked;
    if (instalar) show('ti-state', 'Dando de alta y levantando su instalación… tarda un minuto.', 'warn');
    var r = await api('/admin/tiendas', { method: 'POST', body: { nombre: val('ti-nombre'), slug: val('ti-slug') || undefined, url: val('ti-url') || null, contacto: val('ti-contacto') || null, crearInstalacion: instalar, membresia: { plan: val('ti-plan'), vencimiento: val('ti-vence'), precioMes: Number(val('ti-precio') || 0), contacto: val('ti-renovar') || null } } });
    tiMostrarToken(r.tienda, r.token, r.pasos);
    show('ti-state', r.mensaje || (r.instalacion && r.instalacion.ok ? 'Tienda dada de alta con su instalación en ' + r.instalacion.url : 'Tienda dada de alta.'), r.mensaje ? 'warn' : 'ok');
    setVal('ti-nombre', ''); setVal('ti-slug', ''); setVal('ti-url', ''); setVal('ti-contacto', '');
    loadTiendas();
  } catch (error) { show('ti-state', error.message, 'bad'); }
});
document.getElementById('ti-copiar').onclick = function () { navigator.clipboard.writeText(document.getElementById('ti-token').textContent).then(function () { show('ti-state', 'Token copiado', 'ok'); }); };
document.getElementById('ti-cerrar').onclick = function () { document.getElementById('ti-nueva').classList.add('hidden'); };

// --- esta instalacion depende de un maestro ---
function mbPintarMaestro(m) {
  var caja = document.getElementById('mb-maestro');
  caja.classList.toggle('hidden', !m.soySuper);
  var est = document.getElementById('mb-maestro-estado');
  if (m.maestro) {
    est.innerHTML = '<b>Conectada a un maestro:</b> ' + esc(m.maestro.url) + (m.maestro.origen === 'env' ? ' <small>(viene del arranque)</small>' : '') + (m.error ? ' · <span style="color:#b42318">no responde ahora: ' + esc(m.error) + ' (se usa lo último que dijo)</span>' : m.consultadoEn ? ' · última consulta ' + esc(fmt(m.consultadoEn)) : '');
    setVal('mb-maestro-url', m.maestro.url);
  } else {
    est.textContent = 'No depende de ningún maestro: la membresía se lleva aquí.';
  }
  document.getElementById('mb-maestro-quitar').classList.toggle('hidden', !(m.maestro && m.maestro.origen === 'pantalla'));
}
document.getElementById('mb-maestro-conectar').onclick = busy('mb-maestro-conectar', async function () {
  try {
    var r = await api('/admin/membresia/maestro', { method: 'POST', body: { url: val('mb-maestro-url'), token: val('mb-maestro-token') } });
    show('mb-state', r.mensaje, 'ok');
    setVal('mb-maestro-token', '');
    loadMembresia(); loadPlan();
  } catch (error) { show('mb-state', error.message, 'bad'); }
});
document.getElementById('mb-maestro-quitar').onclick = busy('mb-maestro-quitar', async function () {
  if (!(await confirmarDialogo({ titulo: 'Desconectar del maestro', texto: 'Esta instalación dejará de tomar su plan de allí y volverá a llevar su membresía aquí (o a ser libre).', boton: 'Desconectar' }))) return;
  try { await api('/admin/membresia/maestro', { method: 'DELETE' }); show('mb-state', 'Desconectada del maestro.', 'ok'); loadMembresia(); loadPlan(); }
  catch (error) { show('mb-state', error.message, 'bad'); }
});

async function loadMiCuenta() {
  try {
    var u = await api('/admin/yo');
    yo = u;
    document.getElementById('mc-datos').innerHTML =
      '<div class="stat"><span class="muted">Nombre</span><b>' + esc(u.nombre) + '</b></div>' +
      '<div class="stat"><span class="muted">Usuario</span><b>' + esc(u.usuario) + '</b></div>' +
      '<div class="stat"><span class="muted">Rol</span><b>' + (u.super ? 'Superadministrador' : u.rol === 'admin' ? 'Administrador' : 'Operador') + '</b><small>' + (u.super ? 'lleva la membresía, los códigos de conexión y las cuentas de superadministrador, además de todo lo de un administrador' : u.rol === 'admin' ? 'gestiona cuentas, claves y configuración' : 'usa todo el sistema; no gestiona cuentas') + '</small></div>';
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
