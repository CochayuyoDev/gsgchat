/**
 * Interfaz web: pantalla de configuracion y panel de operacion.
 *
 * Existe para que no haya que editar .env ni lanzar curl: las credenciales
 * se pegan en /setup y los envios se hacen desde /panel. El navegador guarda
 * el token de administracion en sessionStorage y lo manda como Bearer.
 *
 * El JS de estas paginas usa concatenacion en vez de plantillas para no
 * pelearse con los backticks del literal que las envuelve.
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
  .wrap { max-width: 880px; margin: 0 auto; padding: 28px 20px 80px; }
  header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 6px; }
  h1 { font-size: 22px; margin: 0; }
  h2 { font-size: 16px; margin: 0 0 4px; }
  .muted { color: var(--muted); font-size: 13px; margin: 0; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px;
    padding: 18px 20px; margin-top: 16px; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 14px 0 5px; }
  input, textarea, select {
    width: 100%; padding: 10px 12px; font: inherit; font-size: 14px; color: var(--text);
    background: var(--bg); border: 1px solid var(--line); border-radius: 9px;
  }
  textarea { min-height: 92px; resize: vertical; font-family: ui-monospace, Consolas, monospace; font-size: 13px; }
  button { padding: 10px 18px; font: inherit; font-weight: 600; border: 0; border-radius: 9px;
    background: var(--accent); color: var(--accent-ink); cursor: pointer; }
  button.ghost { background: transparent; color: var(--text); border: 1px solid var(--line); }
  button:disabled { opacity: .5; cursor: default; }
  .actions { display: flex; gap: 10px; align-items: center; margin-top: 18px; flex-wrap: wrap; }
  .tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 18px; }
  .tabs button { background: transparent; color: var(--muted); border: 1px solid transparent; }
  .tabs button.active { background: var(--card); color: var(--text); border-color: var(--line); }
  .pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .pill.ok { background: rgba(22,163,74,.14); color: var(--ok); }
  .pill.warn { background: rgba(217,119,6,.14); color: var(--warn); }
  .pill.bad { background: rgba(220,38,38,.14); color: var(--bad); }
  pre { background: var(--bg); border: 1px solid var(--line); border-radius: 9px;
    padding: 12px; overflow: auto; font-size: 12.5px; margin: 12px 0 0; }
  .copy { display: flex; gap: 8px; margin-top: 6px; }
  .copy input { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; }
  ol { padding-left: 20px; margin: 10px 0 0; }
  ol li { margin-bottom: 9px; }
  a { color: var(--accent); }
  .grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
  .stat { background: var(--bg); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
  .stat b { display: block; font-size: 20px; }
  .hidden { display: none; }
`;

const AUTH_JS = `
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
    if (res.status === 401) { sessionStorage.removeItem('adminToken'); throw new Error('Token de administracion incorrecto'); }
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || data.message || ('HTTP ' + res.status));
    return data;
  }
  function show(id, text, kind) {
    var el = document.getElementById(id);
    el.textContent = text;
    el.className = 'pill ' + (kind || 'ok');
    el.classList.remove('hidden');
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
<header><h1>Configuracion</h1><span id="state" class="pill hidden"></span></header>
<p class="muted">Pega aqui las credenciales de Meta. Se guardan cifradas y no hace falta reiniciar nada.</p>

<div class="card">
  <h2>1. Consigue las credenciales en Meta</h2>
  <ol class="muted">
    <li>Crea tu empresa en <a href="https://business.facebook.com" target="_blank" rel="noreferrer">business.facebook.com</a>.</li>
    <li>Crea una app de tipo <b>Empresa</b> en <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">developers.facebook.com</a> y anade el producto <b>WhatsApp</b>.</li>
    <li>Registra tu numero en WhatsApp Manager. <b>Ojo:</b> ese numero no puede estar activo en la app normal de WhatsApp ni en WhatsApp Business; si lo esta, borra antes esa cuenta desde la app.</li>
    <li>El token que sale en <i>API Setup</i> caduca en 24 h. Para el definitivo: Business Settings &rarr; Usuarios &rarr; <b>Usuario del sistema</b> &rarr; anadir la app y la WABA como activos &rarr; generar token con los permisos <code>whatsapp_business_messaging</code> y <code>whatsapp_business_management</code>.</li>
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
  <code>npx cloudflared tunnel --url http://localhost:3000</code> y usa la URL que te devuelva.</p>
</div>

<p class="muted" style="margin-top:18px"><a href="/panel">Ir al panel de operacion &rarr;</a></p>`;

  const script = `
var FIELDS = ${JSON.stringify(SETUP_FIELDS)};
var SECRETS = ['token', 'appSecret'];

async function load() {
  try {
    var data = await api('/admin/settings');
    FIELDS.forEach(function (f) {
      var input = document.getElementById(f);
      var value = data.masked[f] || '';
      // Un secreto ya guardado se enseña como marcador de posicion: dejarlo
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

document.getElementById('save').onclick = function () { run(true); };
document.getElementById('test').onclick = function () { run(false); };

document.querySelectorAll('[data-copy]').forEach(function (b) {
  b.onclick = function () {
    var input = document.getElementById(b.getAttribute('data-copy'));
    input.select();
    navigator.clipboard.writeText(input.value);
    b.textContent = 'Copiado';
    setTimeout(function () { b.textContent = 'Copiar'; }, 1200);
  };
});

load();
`;

  return shell('Configuracion - wa-locator', body, script);
}

export function panelPage(configured: boolean): string {
  const warning = configured
    ? ''
    : `<div class="card" style="border-color:#d97706">
         <h2>Falta configurar WhatsApp</h2>
         <p class="muted">Los envios estan desactivados hasta que pegues las credenciales en
         <a href="/setup">la pantalla de configuracion</a>. El extractor de coordenadas si funciona.</p>
       </div>`;

  const body = `
<header><h1>Panel</h1><span id="state" class="pill hidden"></span></header>
<p class="muted">Enviar mensajes, compartir ubicacion y lanzar campanas sin tocar la terminal.</p>
${warning}

<div class="tabs">
  <button data-tab="estado" class="active">Estado</button>
  <button data-tab="mensaje">Mensaje</button>
  <button data-tab="ubicacion">Ubicacion</button>
  <button data-tab="vivo">Ubicacion en vivo</button>
  <button data-tab="campana">Campana</button>
  <button data-tab="extraer">Extraer coordenadas</button>
</div>

<section id="tab-estado" class="card">
  <h2>Estado del numero</h2>
  <p class="muted">Miralo antes de subir volumen. En amarillo se frena el marketing solo.</p>
  <div class="grid" id="stats" style="margin-top:14px"></div>
  <div class="actions">
    <button class="ghost" id="refresh">Actualizar</button>
    <button class="ghost" id="pause">Pausar envios</button>
    <button class="ghost" id="resume">Reanudar</button>
  </div>
</section>

<section id="tab-mensaje" class="card hidden">
  <h2>Mensaje de texto</h2>
  <p class="muted">Solo sale si el contacto te escribio en las ultimas 24 h. Fuera de esa ventana hay que usar una plantilla.</p>
  <label>Telefono (con codigo de pais, sin + ni espacios)</label>
  <input id="m-phone" placeholder="5215512345678">
  <label>Texto</label>
  <textarea id="m-text" placeholder="Tu pedido va en camino."></textarea>
  <div class="actions"><button id="m-send">Enviar</button><span id="m-state" class="pill hidden"></span></div>
  <pre id="m-out" class="hidden"></pre>
</section>

<section id="tab-ubicacion" class="card hidden">
  <h2>Enviar una ubicacion</h2>
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
    <label style="margin:0;font-weight:400"><input type="checkbox" id="v-notify" style="width:auto"> Enviarselo por WhatsApp</label>
    <button id="v-create">Crear sesion</button>
    <span id="v-state" class="pill hidden"></span>
  </div>
  <div id="v-links" class="hidden">
    <label>Enlace para quien comparte su ubicacion</label>
    <div class="copy"><input id="v-pub" readonly><button class="ghost" data-copy="v-pub">Copiar</button></div>
    <label>Enlace para quien la mira</label>
    <div class="copy"><input id="v-view" readonly><button class="ghost" data-copy="v-view">Copiar</button></div>
  </div>
</section>

<section id="tab-campana" class="card hidden">
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
</section>

<section id="tab-extraer" class="card hidden">
  <h2>Extraer latitud y longitud</h2>
  <p class="muted">Pega cualquier enlace de mapa (Google, Waze, Apple, OSM, plus code, DMS o un acortador).</p>
  <label>Enlace o texto</label>
  <textarea id="g-input" placeholder="https://www.google.com/maps/place/.../@19.4326,-99.1332,17z/data=!3m1!4b1"></textarea>
  <div class="actions"><button id="g-run">Extraer</button><span id="g-state" class="pill hidden"></span></div>
  <pre id="g-out" class="hidden"></pre>
</section>`;

  const script = `
document.querySelectorAll('.tabs button').forEach(function (b) {
  b.onclick = function () {
    document.querySelectorAll('.tabs button').forEach(function (x) { x.classList.remove('active'); });
    b.classList.add('active');
    ['estado','mensaje','ubicacion','vivo','campana','extraer'].forEach(function (t) {
      document.getElementById('tab-' + t).classList.toggle('hidden', t !== b.getAttribute('data-tab'));
    });
  };
});

function out(id, data) {
  var el = document.getElementById(id);
  el.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  el.classList.remove('hidden');
}

function qualityKind(q) { return q === 'GREEN' ? 'ok' : q === 'YELLOW' ? 'warn' : 'bad'; }

async function loadHealth() {
  try {
    var h = await api('/admin/health');
    document.getElementById('stats').innerHTML =
      '<div class="stat"><span class="muted">Calidad</span><b class="' + qualityKind(h.number.quality) + '">' + h.number.quality + '</b></div>' +
      '<div class="stat"><span class="muted">Estado</span><b>' + (h.number.paused ? 'PAUSADO' : 'activo') + '</b></div>' +
      '<div class="stat"><span class="muted">Enviados hoy</span><b>' + h.sentToday + ' / ' + h.dailyCap + '</b></div>' +
      '<div class="stat"><span class="muted">En cola</span><b>' + ((h.queue.waiting || 0) + (h.queue.delayed || 0)) + '</b></div>';
    show('state', h.number.paused ? 'Envios pausados' : 'Operativo', h.number.paused ? 'warn' : 'ok');
  } catch (error) { show('state', error.message, 'bad'); }
}

async function loadTemplates() {
  try {
    var list = await api('/admin/templates');
    var select = document.getElementById('c-template');
    select.innerHTML = list.map(function (t) {
      return '<option value="' + t.name + '|' + t.language + '|' + t.category + '"' +
        (t.status !== 'APPROVED' ? ' disabled' : '') + '>' +
        t.name + ' (' + t.category + ', ' + t.status + ', ' + t.variables + ' vars)</option>';
    }).join('');
  } catch (error) { /* el estado ya lo reporta loadHealth */ }
}

document.getElementById('refresh').onclick = loadHealth;
document.getElementById('pause').onclick = async function () {
  await api('/admin/pause', { method: 'POST', body: { paused: true, reason: 'pausa manual' } });
  loadHealth();
};
document.getElementById('resume').onclick = async function () {
  await api('/admin/pause', { method: 'POST', body: { paused: false } });
  loadHealth();
};

document.getElementById('m-send').onclick = async function () {
  try {
    var data = await api('/admin/messages/text', { method: 'POST', body: {
      phone: document.getElementById('m-phone').value.trim(),
      text: document.getElementById('m-text').value
    }});
    show('m-state', data.ok ? 'Enviado' : 'Bloqueado', data.ok ? 'ok' : 'warn');
    out('m-out', data);
  } catch (error) { show('m-state', error.message, 'bad'); }
};

document.getElementById('u-send').onclick = async function () {
  try {
    var data = await api('/admin/messages/location', { method: 'POST', body: {
      phone: document.getElementById('u-phone').value.trim(),
      input: document.getElementById('u-input').value.trim(),
      name: document.getElementById('u-name').value.trim() || undefined
    }});
    show('u-state', data.ok ? 'Enviado' : 'Bloqueado', data.ok ? 'ok' : 'warn');
    out('u-out', data);
  } catch (error) { show('u-state', error.message, 'bad'); }
};

document.getElementById('u-ask').onclick = async function () {
  try {
    var data = await api('/admin/messages/ask-location', { method: 'POST', body: {
      phone: document.getElementById('u-phone').value.trim()
    }});
    show('u-state', data.ok ? 'Solicitud enviada' : 'Bloqueado', data.ok ? 'ok' : 'warn');
    out('u-out', data);
  } catch (error) { show('u-state', error.message, 'bad'); }
};

document.getElementById('v-create').onclick = async function () {
  try {
    var phone = document.getElementById('v-phone').value.trim();
    var data = await api('/admin/tracking', { method: 'POST', body: {
      phone: phone || undefined,
      label: document.getElementById('v-label').value.trim() || undefined,
      ttlMinutes: Number(document.getElementById('v-ttl').value) || undefined,
      notify: document.getElementById('v-notify').checked
    }});
    document.getElementById('v-pub').value = data.publishUrl;
    document.getElementById('v-view').value = data.viewUrl;
    document.getElementById('v-links').classList.remove('hidden');
    show('v-state', 'Sesion creada', 'ok');
  } catch (error) { show('v-state', error.message, 'bad'); }
};

document.getElementById('c-send').onclick = async function () {
  try {
    var parts = document.getElementById('c-template').value.split('|');
    var lines = document.getElementById('c-list').value.split('\\n')
      .map(function (l) { return l.trim(); }).filter(Boolean);
    var recipients = lines.map(function (line) {
      var cells = line.split(',').map(function (c) { return c.trim(); });
      return { phone: cells[0], variables: cells.slice(1) };
    });
    var data = await api('/admin/campaigns', { method: 'POST', body: {
      name: document.getElementById('c-name').value.trim() || 'Campana',
      templateName: parts[0], templateLanguage: parts[1], category: parts[2],
      recipients: recipients.length ? recipients : undefined
    }});
    show('c-state', 'Encolados ' + data.enqueued, 'ok');
    out('c-out', data);
  } catch (error) { show('c-state', error.message, 'bad'); }
};

document.getElementById('g-run').onclick = async function () {
  try {
    var data = await api('/admin/geo/extract', { method: 'POST', body: {
      input: document.getElementById('g-input').value
    }});
    show('g-state', data.ok ? data.source + ' / ' + data.confidence : data.reason, data.ok ? 'ok' : 'warn');
    out('g-out', data);
  } catch (error) { show('g-state', error.message, 'bad'); }
};

document.querySelectorAll('[data-copy]').forEach(function (b) {
  b.onclick = function () {
    var input = document.getElementById(b.getAttribute('data-copy'));
    input.select();
    navigator.clipboard.writeText(input.value);
    b.textContent = 'Copiado';
    setTimeout(function () { b.textContent = 'Copiar'; }, 1200);
  };
});

loadHealth();
loadTemplates();
`;

  return shell('Panel - wa-locator', body, script);
}
