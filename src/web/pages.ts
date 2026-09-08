/**
 * Interfaz web: pantalla de configuracion y panel de operacion.
 *
 * Existe para que no haya que editar .env ni lanzar curl: las credenciales
 * se pegan en /setup y todo lo demas se opera desde /panel. El navegador
 * guarda el token de administracion en sessionStorage y lo manda como Bearer.
 *
 * El JS de estas paginas va en String.raw y usa concatenacion: ni backticks
 * ni "${" dentro, para no pelearse con el literal que lo envuelve. Todo dato
 * que viene del servidor (nombres de contactos, textos de reglas...) pasa por
 * esc() antes de tocar innerHTML: el nombre de perfil de WhatsApp lo escribe
 * el cliente, no nosotros.
 */

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
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.55 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 28px 20px 80px; }
  header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 6px; flex-wrap: wrap; }
  header .right { margin-left: auto; }
  h1 { font-size: 22px; margin: 0; }
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
  .tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 18px; }
  .tabs button { background: transparent; color: var(--muted); border: 1px solid transparent; padding: 8px 14px; }
  .tabs button.active { background: var(--card); color: var(--text); border-color: var(--line); }
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
`;

const AUTH_JS = String.raw`
  function token() {
    var t = sessionStorage.getItem('adminToken');
    if (!t) { t = prompt('Token de administracion (aparece en la consola al arrancar):'); if (t) sessionStorage.setItem('adminToken', t.trim()); }
    return t || '';
  }
  async function api(path, options) {
    options = options || {};
    var res = await fetch(path, {
      method: options.method || 'GET',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token() },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    if (res.status === 401) { sessionStorage.removeItem('adminToken'); throw new Error('Token de administracion incorrecto: recarga la pagina y vuelve a pegarlo'); }
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || data.message || ('HTTP ' + res.status));
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
    return d.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
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
  function bindLogout() {
    var b = document.getElementById('logout');
    if (b) b.onclick = function () { sessionStorage.removeItem('adminToken'); location.reload(); };
  }
`;

function shell(title: string, body: string, script: string): string {
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${CSS}</style>
</head><body>
<div class="wrap">${body}</div>
<script>
${AUTH_JS}
${script}
</script>
</body></html>`;
}

const SETUP_FIELDS = [
  'token',
  'phoneNumberId',
  'businessAccountId',
  'appSecret',
  'verifyToken',
  'mapsApiKey',
] as const;

/**
 * La pagina se sirve vacia: los valores guardados (aunque vayan
 * enmascarados) los pide el navegador a /admin/settings con el token de
 * administracion. Asi el HTML no expone nada a quien solo conoce la URL.
 */
export function setupPage(labels: Record<string, string>): string {
  const fields = SETUP_FIELDS.map(
    (field) => `
  <label for="${field}">${labels[field] ?? field}</label>
  <input id="${field}" name="${field}" autocomplete="off" spellcheck="false">`,
  ).join('');

  const body = `
<header><h1>Conectar WhatsApp</h1><span id="state" class="pill hidden"></span>
  <span class="right"><button class="ghost sm" id="logout">Cambiar token</button></span></header>
<p class="muted">Conecta tu numero de WhatsApp Business a traves de la API oficial de Meta. Las credenciales se guardan cifradas y no hace falta reiniciar nada.</p>

<div class="card">
  <h2>1. Consigue las credenciales en Meta</h2>
  <ol class="muted">
    <li>Crea tu empresa en <a href="https://business.facebook.com" target="_blank" rel="noreferrer">business.facebook.com</a>.</li>
    <li>Crea una app de tipo <b>Empresa</b> en <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">developers.facebook.com</a> y anade el producto <b>WhatsApp</b>.</li>
    <li>Registra tu numero en WhatsApp Manager. <b>Ojo:</b> ese numero no puede estar activo en la app normal de WhatsApp ni en WhatsApp Business; si lo esta, borra antes esa cuenta desde la app (Ajustes &rarr; Cuenta &rarr; Eliminar cuenta). Meta da un numero de prueba gratuito para empezar.</li>
    <li>El token que sale en <i>API Setup</i> caduca en 24 h. Para el definitivo: Business Settings &rarr; Usuarios &rarr; <b>Usuario del sistema</b> &rarr; anadir la app y la WABA como activos &rarr; generar token con los permisos <code>whatsapp_business_messaging</code> y <code>whatsapp_business_management</code>.</li>
    <li>La <b>clave secreta de la app</b> esta en App &rarr; Configuracion de la app &rarr; Basica.</li>
  </ol>
</div>

<div class="card">
  <h2>2. Pegalas aqui</h2>
  <p class="muted">Los campos secretos se muestran enmascarados; dejalos vacios para conservar el valor guardado.</p>
  ${fields}
  <div class="actions">
    <button id="save">Guardar y probar conexion</button>
    <button class="ghost" id="test">Solo probar</button>
    <span id="result" class="pill hidden"></span>
  </div>
  <pre id="detail" class="hidden"></pre>
</div>

<div class="card">
  <h2>3. Configura el webhook en Meta</h2>
  <p class="muted">App &rarr; WhatsApp &rarr; Configuracion &rarr; Webhooks &rarr; Editar. Suscribe los campos
  <code>messages</code>, <code>message_template_status_update</code>,
  <code>message_template_quality_update</code> y <code>phone_number_quality_update</code>.</p>

  <label>URL de devolucion de llamada</label>
  <div class="copy"><input id="hookUrl" readonly><button class="ghost" data-copy="hookUrl">Copiar</button></div>

  <label>Token de verificacion</label>
  <div class="copy"><input id="hookToken" readonly><button class="ghost" data-copy="hookToken">Copiar</button></div>

  <p class="muted" style="margin-top:14px">Si trabajas en local, Meta necesita una URL publica. Levanta un tunel con
  <code>npx cloudflared tunnel --url http://localhost:3000</code>, pon esa URL en <code>PUBLIC_BASE_URL</code> y usala aqui.</p>
</div>

<div class="card">
  <h2>4. Activa la cuenta y prueba</h2>
  <p class="muted">Tres cosas que suelen faltar cuando "no llegan los mensajes": la app no esta suscrita a la cuenta de negocio,
  el numero no esta registrado en la Cloud API, o nunca se mando un primer mensaje.</p>
  <div class="actions">
    <button class="ghost" id="status">Comprobar estado</button>
    <span id="st-state" class="pill hidden"></span>
  </div>
  <div id="st-grid" class="grid hidden" style="margin-top:14px"></div>

  <h3>Suscribir la app a la cuenta de negocio</h3>
  <p class="muted">Sin esto Meta no envia ningun webhook aunque la URL este bien.</p>
  <div class="actions"><button id="subscribe">Suscribir app</button><span id="sub-state" class="pill hidden"></span></div>

  <h3>Registrar el numero</h3>
  <p class="muted">Solo la primera vez, o tras migrar el numero desde la app. Es el PIN de verificacion en dos pasos (6 digitos); si el numero no lo tenia, el que pongas aqui queda como PIN.</p>
  <div class="toolbar">
    <div><label for="pin">PIN</label><input id="pin" inputmode="numeric" maxlength="6" placeholder="123456"></div>
    <div><button id="register">Registrar numero</button></div>
  </div>
  <span id="reg-state" class="pill hidden" style="margin-top:8px"></span>

  <h3>Enviar un mensaje de prueba</h3>
  <p class="muted">Manda la plantilla <code>hello_world</code> (la crea Meta en toda cuenta nueva) a tu propio telefono. Pasa por las mismas guardas que cualquier envio.</p>
  <div class="toolbar">
    <div><label for="testPhone">Tu telefono (con codigo de pais, sin +)</label><input id="testPhone" placeholder="5215512345678"></div>
    <div><button id="sendTest">Enviar prueba</button></div>
  </div>
  <span id="test-state" class="pill hidden" style="margin-top:8px"></span>
  <pre id="test-detail" class="hidden"></pre>
</div>

<p class="muted" style="margin-top:18px"><a href="/panel">Ir al panel de operacion &rarr;</a></p>`;

  const script = String.raw`
var FIELDS = ${JSON.stringify(SETUP_FIELDS)};
var SECRETS = ['token', 'appSecret'];

async function load() {
  try {
    var data = await api('/admin/settings');
    FIELDS.forEach(function (f) {
      var input = document.getElementById(f);
      var value = data.masked[f] || '';
      // Un secreto ya guardado se ensena como marcador de posicion: dejarlo
      // vacio conserva el valor, escribir encima lo sustituye.
      if (SECRETS.indexOf(f) >= 0) input.placeholder = value || '';
      else input.value = value;
    });
    document.getElementById('hookUrl').value = data.webhookUrl;
    document.getElementById('hookToken').value = data.verifyToken || '(define primero el token de verificacion)';
    if (data.missing.length) show('state', 'Faltan ' + data.missing.length + ' datos', 'warn');
    else show('state', 'Configurado', 'ok');
  } catch (error) {
    show('state', error.message, 'bad');
  }
}

function values() {
  var out = {};
  FIELDS.forEach(function (f) {
    var v = document.getElementById(f).value.trim();
    if (v) out[f] = v;
  });
  return out;
}

async function run(save) {
  var button = document.getElementById(save ? 'save' : 'test');
  button.disabled = true;
  try {
    var data = await api(save ? '/admin/settings' : '/admin/settings/test', { method: 'POST', body: values() });
    show('result', data.ok ? 'Conexion correcta' : 'Sin conexion', data.ok ? 'ok' : 'bad');
    var detail = document.getElementById('detail');
    detail.textContent = JSON.stringify(data, null, 2);
    detail.classList.remove('hidden');
    if (save) load();
  } catch (error) {
    show('result', error.message, 'bad');
  } finally {
    button.disabled = false;
  }
}

async function status() {
  var button = document.getElementById('status');
  button.disabled = true;
  try {
    var s = await api('/admin/settings/status');
    var grid = document.getElementById('st-grid');
    var cells = [];
    cells.push('<div class="stat"><span class="muted">Credenciales</span><b class="' + (s.ok ? 'ok' : 'bad') + '">' + (s.ok ? 'validas' : 'fallan') + '</b><span class="muted">' + esc(s.detail) + '</span></div>');
    if (s.phone) {
      var q = s.phone.qualityRating || 'NA';
      cells.push('<div class="stat"><span class="muted">Numero</span><b>' + esc(s.phone.displayPhoneNumber) + '</b><span class="muted">' + esc(s.phone.verifiedName) + '</span></div>');
      cells.push('<div class="stat"><span class="muted">Calidad</span><b class="' + (q === 'GREEN' ? 'ok' : q === 'RED' ? 'bad' : 'warn') + '">' + esc(q) + '</b><span class="muted">' + esc(s.phone.messagingLimitTier || 'sin tier') + '</span></div>');
    } else if (s.phoneError) {
      cells.push('<div class="stat"><span class="muted">Numero</span><b class="bad">error</b><span class="muted">' + esc(s.phoneError) + '</span></div>');
    }
    if (s.subscribed !== null) {
      cells.push('<div class="stat"><span class="muted">App suscrita a la WABA</span><b class="' + (s.subscribed ? 'ok' : 'warn') + '">' + (s.subscribed ? 'si' : 'no') + '</b><span class="muted">' + esc((s.apps || []).map(function (a) { return a.name; }).join(', ')) + '</span></div>');
    } else if (s.subscribedError) {
      cells.push('<div class="stat"><span class="muted">App suscrita</span><b class="bad">error</b><span class="muted">' + esc(s.subscribedError) + '</span></div>');
    }
    cells.push('<div class="stat"><span class="muted">Webhook</span><b class="' + (s.appSecretSet && s.verifyTokenSet ? 'ok' : 'warn') + '">' + (s.appSecretSet && s.verifyTokenSet ? 'listo' : 'incompleto') + '</b><span class="muted">' + esc(s.webhookUrl) + '</span></div>');
    grid.innerHTML = cells.join('');
    grid.classList.remove('hidden');
    show('st-state', s.ok ? 'Estado actualizado' : 'Revisa las credenciales', s.ok ? 'ok' : 'bad');
  } catch (error) {
    show('st-state', error.message, 'bad');
  } finally {
    button.disabled = false;
  }
}

document.getElementById('save').onclick = function () { run(true); };
document.getElementById('test').onclick = function () { run(false); };
document.getElementById('status').onclick = status;

document.getElementById('subscribe').onclick = async function () {
  try {
    var r = await api('/admin/settings/subscribe', { method: 'POST' });
    show('sub-state', r.subscribed ? 'App suscrita' : 'Meta no confirmo la suscripcion', r.subscribed ? 'ok' : 'warn');
    status();
  } catch (error) { show('sub-state', error.message, 'bad'); }
};

document.getElementById('register').onclick = async function () {
  try {
    var r = await api('/admin/settings/register', { method: 'POST', body: { pin: val('pin') } });
    show('reg-state', r.success ? 'Numero registrado' : 'Meta no confirmo el registro', r.success ? 'ok' : 'warn');
  } catch (error) { show('reg-state', error.message, 'bad'); }
};

document.getElementById('sendTest').onclick = async function () {
  var button = document.getElementById('sendTest');
  button.disabled = true;
  try {
    var r = await api('/admin/settings/test-message', { method: 'POST', body: { phone: val('testPhone') } });
    show('test-state', r.ok ? 'Enviado: revisa tu WhatsApp' : ('No salio: ' + (r.reason || r.error || '')), r.ok ? 'ok' : 'warn');
    var detail = document.getElementById('test-detail');
    detail.textContent = JSON.stringify(r, null, 2);
    detail.classList.remove('hidden');
  } catch (error) {
    show('test-state', error.message, 'bad');
  } finally {
    button.disabled = false;
  }
};

copyButtons();
bindLogout();
load();
`;

  return shell('Conectar WhatsApp - wa-locator', body, script);
}

const TABS: Array<[string, string]> = [
  ['estado', 'Estado'],
  ['enviar', 'Enviar'],
  ['contactos', 'Contactos'],
  ['ubicaciones', 'Ubicaciones'],
  ['vivo', 'En vivo'],
  ['campanas', 'Campanas'],
  ['automatizacion', 'Automatizacion'],
  ['plantillas', 'Plantillas'],
  ['historial', 'Historial'],
  ['extraer', 'Extraer'],
];

export function panelPage(configured: boolean): string {
  const warning = configured
    ? ''
    : `<div class="card" style="border-color:#d97706">
         <h2>Falta conectar WhatsApp</h2>
         <p class="muted">Los envios estan desactivados hasta que pegues las credenciales en
         <a href="/setup">la pantalla de conexion</a>. Contactos, reglas, secuencias y el extractor de coordenadas si funcionan.</p>
       </div>`;

  const tabs = TABS.map(
    ([id, label], index) =>
      `<button data-tab="${id}"${index === 0 ? ' class="active"' : ''}>${label}</button>`,
  ).join('\n  ');

  const body = `
<header><h1>Panel</h1><span id="state" class="pill hidden"></span>
  <span class="right"><a href="/setup" class="muted">Conexion</a> &nbsp; <button class="ghost sm" id="logout">Cambiar token</button></span></header>
<p class="muted">Enviar mensajes, compartir ubicacion, automatizar seguimientos y lanzar campanas sin tocar la terminal.</p>
${warning}

<div class="tabs">
  ${tabs}
</div>

<section id="tab-estado" class="card">
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

<section id="tab-enviar" class="card hidden">
  <h2>Mensaje de texto</h2>
  <p class="muted">Solo sale si el contacto te escribio en las ultimas 24 h. Fuera de esa ventana hay que usar una plantilla (pestana Campanas o Automatizacion).</p>
  <label>Telefono (con codigo de pais, sin + ni espacios)</label>
  <input id="m-phone" placeholder="5215512345678">
  <label>Texto</label>
  <textarea id="m-text" placeholder="Tu pedido va en camino."></textarea>
  <div class="actions"><button id="m-send">Enviar</button><span id="m-state" class="pill hidden"></span></div>
  <pre id="m-out" class="hidden"></pre>

  <h2 style="margin-top:26px">Enviar una ubicacion</h2>
  <p class="muted">Pega un link de Google Maps o unas coordenadas: el sistema extrae la latitud y longitud y manda el pin.</p>
  <label>Telefono</label>
  <input id="u-phone" placeholder="5215512345678">
  <label>Link de mapa o coordenadas</label>
  <input id="u-input" placeholder="https://maps.app.goo.gl/... o 19.4326, -99.1332">
  <label>Nombre del sitio (opcional)</label>
  <input id="u-name" placeholder="Sucursal Centro">
  <div class="actions">
    <button id="u-send">Enviar pin</button>
    <button class="ghost" id="u-ask">Pedirle su ubicacion</button>
    <span id="u-state" class="pill hidden"></span>
  </div>
  <pre id="u-out" class="hidden"></pre>
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
  </div>
  <div id="ct-table" class="tablewrap"></div>
  <div class="pager"><button class="ghost sm" id="ct-prev">Anterior</button><span id="ct-page"></span><button class="ghost sm" id="ct-next">Siguiente</button></div>

  <h3>Importar contactos con opt-in</h3>
  <p class="muted">Una linea por contacto: <code>telefono,nombre</code>. Importar registra el consentimiento con el origen que indiques; guarda de donde salio (formulario, compra, evento) porque es lo que respalda el envio.</p>
  <label>Origen del consentimiento</label>
  <input id="ct-source" placeholder="formulario web, compra en tienda, evento...">
  <label>Contactos</label>
  <textarea id="ct-import" placeholder="5215512345678,Ana Perez&#10;5215587654321,Luis"></textarea>
  <div class="actions"><button id="ct-do-import">Importar</button><span id="ct-state-msg" class="pill hidden"></span></div>
</section>

<section id="tab-ubicaciones" class="card hidden">
  <h2>Ubicaciones recibidas</h2>
  <p class="muted">Todo lo que el bot extrajo de mensajes y links. Las de baja confianza quedan sin confirmar hasta que el cliente responde al boton.</p>
  <div class="toolbar">
    <div><label for="lc-phone">Telefono (opcional)</label><input id="lc-phone" placeholder="5215512345678"></div>
    <div><button class="ghost" id="lc-search">Actualizar</button></div>
  </div>
  <div id="lc-table" class="tablewrap"></div>
</section>

<section id="tab-vivo" class="card hidden">
  <h2>Ubicacion en vivo</h2>
  <p class="muted">Genera dos enlaces: uno para quien se mueve y otro para quien mira. La Cloud API no puede
  mandar live location, asi que WhatsApp solo transporta el enlace y el mapa corre aqui.</p>
  <label>Telefono del cliente (opcional, para enviarle el enlace)</label>
  <input id="v-phone" placeholder="5215512345678">
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

<section id="tab-campanas" class="card hidden">
  <h2>Campana con plantilla</h2>
  <p class="muted">Solo salen los contactos con opt-in registrado. Cada bloqueo queda anotado para que veas
  si la lista esta sucia antes de quemar el numero.</p>
  <label>Plantilla</label>
  <select id="c-template"></select>
  <label>Nombre de la campana</label>
  <input id="c-name" placeholder="Recordatorio marzo">
  <label>Destinatarios (uno por linea: telefono,variable1,variable2). Vacio = todos los que tienen opt-in.</label>
  <textarea id="c-list" placeholder="5215512345678,Ana,A-1024,https://ej.mx/t/9"></textarea>
  <div class="actions"><button id="c-send">Lanzar</button><span id="c-state" class="pill hidden"></span></div>
  <pre id="c-out" class="hidden"></pre>

  <h3>Campanas lanzadas</h3>
  <div id="c-table" class="tablewrap"></div>
  <div class="actions"><button class="ghost sm" id="c-refresh">Actualizar</button></div>
</section>

<section id="tab-automatizacion" class="card hidden">
  <h2>Respuestas automaticas</h2>
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
  <textarea id="e-phones" placeholder="5215512345678"></textarea>
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
    <div><label for="sc-phone">Telefono</label><input id="sc-phone" placeholder="5215512345678"></div>
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

  <h3>Catalogo propio</h3>
  <p class="muted">Las plantillas definidas en el codigo (<code>src/templates/catalog.ts</code>) pasan por el linter antes de subir. Un rechazo de Meta cuenta en el historial de la cuenta.</p>
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
    <div><label for="h-phone">Telefono</label><input id="h-phone" placeholder="5215512345678"></div>
    <div><label for="h-campaign">Campana (id)</label><input id="h-campaign" placeholder=""></div>
    <div><button class="ghost" id="h-search">Buscar</button></div>
  </div>
  <div id="h-table" class="tablewrap"></div>
  <div class="pager"><button class="ghost sm" id="h-prev">Anterior</button><span id="h-page"></span><button class="ghost sm" id="h-next">Siguiente</button></div>
</section>

<section id="tab-extraer" class="card hidden">
  <h2>Extraer latitud y longitud</h2>
  <p class="muted">Pega cualquier enlace de mapa (Google, Waze, Apple, OSM, plus code, DMS o un acortador).</p>
  <label>Enlace o texto</label>
  <textarea id="g-input" placeholder="https://www.google.com/maps/place/.../@19.4326,-99.1332,17z/data=!3m1!4b1"></textarea>
  <div class="actions"><button id="g-run">Extraer</button><span id="g-state" class="pill hidden"></span></div>
  <pre id="g-out" class="hidden"></pre>
</section>`;

  const script = String.raw`
var TAB_IDS = ${JSON.stringify(TABS.map(([id]) => id))};
var LOADERS = {
  estado: loadHealth, contactos: loadContacts, ubicaciones: loadLocations, vivo: loadSessions,
  campanas: function () { loadTemplates(); loadCampaigns(); },
  automatizacion: loadAutomation, plantillas: loadTemplates, historial: loadDeliveries
};
var loaded = {};

function activate(id) {
  if (TAB_IDS.indexOf(id) < 0) id = TAB_IDS[0];
  document.querySelectorAll('.tabs button').forEach(function (x) { x.classList.toggle('active', x.getAttribute('data-tab') === id); });
  TAB_IDS.forEach(function (t) { document.getElementById('tab-' + t).classList.toggle('hidden', t !== id); });
  if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
  if (LOADERS[id] && !loaded[id]) { loaded[id] = true; LOADERS[id](); }
}
document.querySelectorAll('.tabs button').forEach(function (b) {
  b.onclick = function () { activate(b.getAttribute('data-tab')); };
});
window.addEventListener('hashchange', function () { activate(location.hash.slice(1)); });

function out(id, data) {
  var el = document.getElementById(id);
  el.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
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
  if (s === 'queued' || s === 'pending' || s === 'PENDING' || s === 'running' || s === 'processing') return 'warn';
  if (s === 'failed' || s === 'blocked_by_gate' || s === 'blocked' || s === 'REJECTED' || s === 'DISABLED' || s === 'PAUSED') return 'bad';
  return 'muted';
}
function statusLabel(s) {
  return ({ queued: 'en cola', sent: 'enviado', delivered: 'entregado', read: 'leido', failed: 'fallido',
    blocked_by_gate: 'bloqueado', pending: 'pendiente', processing: 'procesando', blocked: 'bloqueado',
    cancelled: 'cancelado', active: 'activa', completed: 'completada', running: 'en curso', finished: 'terminada',
    draft: 'borrador', empty: 'sin destinatarios' })[s] || s;
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
      '<div class="stat"><span class="muted">WhatsApp</span><b class="' + (h.configured ? 'ok' : 'warn') + '">' + (h.configured ? 'conectado' : 'sin conectar') + '</b><span class="muted">' + esc((h.missing || []).join(', ')) + '</span></div>';
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

// ---------------------------------------------------------------- enviar
document.getElementById('m-send').onclick = async function () {
  try {
    var data = await api('/admin/messages/text', { method: 'POST', body: { phone: val('m-phone'), text: document.getElementById('m-text').value } });
    show('m-state', data.ok ? 'Enviado' : ('Bloqueado: ' + (data.reason || data.error || '')), data.ok ? 'ok' : 'warn');
    out('m-out', data);
  } catch (error) { show('m-state', error.message, 'bad'); }
};
document.getElementById('u-send').onclick = async function () {
  try {
    var data = await api('/admin/messages/location', { method: 'POST', body: { phone: val('u-phone'), input: val('u-input'), name: val('u-name') || undefined } });
    show('u-state', data.ok ? 'Enviado' : ('Bloqueado: ' + (data.reason || data.error || '')), data.ok ? 'ok' : 'warn');
    out('u-out', data);
  } catch (error) { show('u-state', error.message, 'bad'); }
};
document.getElementById('u-ask').onclick = async function () {
  try {
    var data = await api('/admin/messages/ask-location', { method: 'POST', body: { phone: val('u-phone') } });
    show('u-state', data.ok ? 'Solicitud enviada' : ('Bloqueado: ' + (data.reason || data.error || '')), data.ok ? 'ok' : 'warn');
    out('u-out', data);
  } catch (error) { show('u-state', error.message, 'bad'); }
};

// ------------------------------------------------------------- contactos
var ctOffset = 0, CT_LIMIT = 50;
function contactState(c) {
  if (c.optOutAt) return pill('bad', 'baja');
  if (c.optInAt) return pill('ok', 'opt-in');
  return pill('muted', 'sin consentimiento');
}
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
        var source = prompt('Origen del consentimiento (formulario, compra, llamada...):', 'panel');
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
      return [esc(t.name), esc(t.language), esc(t.category), pill(statusKind(t.status), t.status),
        t.quality ? pill(qualityKind(t.quality), t.quality) : '<span class="muted">-</span>', String(t.variables),
        '<span class="muted">' + esc((t.body || '').slice(0, 90)) + '</span>'];
    }), 'Registro vacio: sincroniza desde Meta o da de alta el catalogo');
    loadCatalog();
  } catch (error) { show('t-state', error.message, 'bad'); }
}
async function loadCatalog() {
  try {
    var list = await api('/admin/templates/catalog');
    table('t-catalog', ['Nombre', 'Categoria', 'Variables', 'Lint', 'En Meta', 'Cuerpo'], list.map(function (t) {
      var errors = t.issues.filter(function (i) { return i.severity === 'error'; }).length;
      var warns = t.issues.length - errors;
      var lint = errors ? pill('bad', errors + ' error' + (errors > 1 ? 'es' : '')) : warns ? pill('warn', warns + ' aviso' + (warns > 1 ? 's' : '')) : pill('ok', 'limpia');
      var detail = t.issues.map(function (i) { return '<span class="muted">' + esc(i.severity === 'error' ? 'ERROR' : 'aviso') + ' ' + esc(i.message) + '</span>'; }).join('');
      return [esc(t.name), esc(t.category), esc(t.variables.join(', ')), lint + detail,
        t.registry ? pill(statusKind(t.registry.status), t.registry.status) : '<span class="muted">no subida</span>',
        '<span class="muted">' + esc(t.body) + '</span>'];
    }), 'Catalogo vacio');
  } catch (error) { show('t-push-state', error.message, 'bad'); }
}
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
    var data = await api('/admin/campaigns', { method: 'POST', body: {
      name: val('c-name') || 'Campana',
      templateName: parts[0], templateLanguage: parts[1], category: parts[2],
      recipients: recipients.length ? recipients : undefined
    }});
    show('c-state', 'Encolados ' + data.enqueued, data.enqueued ? 'ok' : 'warn');
    out('c-out', data);
    loadCampaigns();
  } catch (error) { show('c-state', error.message, 'bad'); }
});
async function loadCampaigns() {
  try {
    var list = await api('/admin/campaigns');
    table('c-table', ['Campana', 'Plantilla', 'Estado', 'En cola', 'Enviados', 'Entregados', 'Leidos', 'Bloqueados', 'Fallidos', ''], list.map(function (c) {
      var s = c.stats || {};
      return [
        '<b>' + esc(c.name) + '</b><span class="muted">' + esc(fmt(c.createdAt)) + '</span>',
        esc(c.templateName) + '<span class="muted">' + esc(c.category) + '</span>',
        pill(statusKind(c.status), statusLabel(c.status)),
        String(s.queued || 0), String(s.sent || 0), String(s.delivered || 0), String(s.read || 0),
        String(s.blocked_by_gate || 0), String(s.failed || 0),
        '<button class="ghost sm" data-deliveries="' + esc(c.id) + '">Ver envios</button>'
      ];
    }), 'Todavia no se lanzo ninguna campana');
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
async function loadAutomation() {
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
        if (!confirm('Borrar la secuencia y sus inscripciones?')) return;
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
        templateLanguage: kind === 'template' ? (parts[1] || 'es_MX') : 'es_MX',
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
      templateName: kind === 'template' ? parts[0] : null, templateLanguage: parts[1] || 'es_MX',
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
loadHealth();
loaded.estado = true;
activate(location.hash.slice(1) || 'estado');
`;

  return shell('Panel - wa-locator', body, script);
}
