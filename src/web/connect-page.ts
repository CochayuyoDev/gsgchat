/**
 * Pantalla de conexion.
 *
 * Dos caminos, el rapido primero:
 *
 *  1. Boton "Conectar con Facebook": abre la ventana de Meta, el usuario entra
 *     con su cuenta, elige su numero y vuelve conectado. Es el registro
 *     incorporado (Embedded Signup) y es lo mas parecido al codigo QR de
 *     WhatsApp Web que permite la via oficial.
 *  2. Pegar el token, el id de la app y su clave secreta, para quien no quiera
 *     configurar el registro incorporado.
 *
 * No hay QR y no lo va a haber: el QR es como se conecta un TELEFONO a
 * WhatsApp Web. Usarlo desde un servidor obliga a emular ese cliente, esta
 * fuera de los terminos de WhatsApp y acaba con el numero baneado, que es
 * justo lo que este sistema existe para evitar. La pantalla lo dice con esas
 * palabras en vez de dejar al usuario buscandolo.
 */

const CSS = `
  :root {
    color-scheme: light dark;
    --bg: #f5f6f8; --card: #fff; --line: #e3e5e9; --text: #16181d;
    --muted: #6b7280; --accent: #128c7e; --fb: #1877f2;
    --ok: #16a34a; --warn: #d97706; --bad: #dc2626;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #16181d; --card: #1f2229; --line: #2f333c; --text: #f2f3f5; --muted: #9aa0aa; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.55 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  .wrap { max-width: 700px; margin: 0 auto; padding: 32px 20px 80px; }
  header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 6px; flex-wrap: wrap; }
  header .right { margin-left: auto; font-size: 13.5px; }
  h1 { font-size: 25px; margin: 0; }
  h2 { font-size: 17px; margin: 0 0 6px; }
  .lead { color: var(--muted); font-size: 14.5px; margin: 0 0 4px; }
  .muted { color: var(--muted); font-size: 13.5px; margin: 0; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px;
    padding: 22px; margin-top: 16px; }
  .card.destacada { border-color: var(--accent); border-width: 2px; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 16px 0 5px; }
  label .hint { display: block; font-weight: 400; color: var(--muted); font-size: 12.5px; margin-top: 2px; }
  input, select { width: 100%; padding: 11px 12px; font: inherit; font-size: 14px; color: var(--text);
    background: var(--bg); border: 1px solid var(--line); border-radius: 9px; }
  button { padding: 12px 22px; font: inherit; font-weight: 600; border: 0; border-radius: 9px;
    background: var(--accent); color: #fff; cursor: pointer; font-size: 15px; }
  button.facebook { background: var(--fb); display: inline-flex; align-items: center; gap: 10px; font-size: 15.5px; }
  button.ghost { background: transparent; color: var(--text); border: 1px solid var(--line); font-size: 14px; padding: 9px 16px; }
  button:disabled { opacity: .5; cursor: default; }
  .actions { display: flex; gap: 10px; align-items: center; margin-top: 20px; flex-wrap: wrap; }
  ol, ul { padding-left: 20px; margin: 10px 0 0; }
  li { margin-bottom: 9px; }
  a { color: var(--accent); }
  code { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; background: var(--bg);
    padding: 1px 6px; border-radius: 5px; }
  .step { display: flex; gap: 10px; align-items: flex-start; padding: 9px 0; border-bottom: 1px solid var(--line); }
  .step:last-child { border-bottom: 0; }
  .step .mark { font-size: 15px; line-height: 1.4; }
  .step .mark.ok { color: var(--ok); } .step .mark.bad { color: var(--bad); }
  .step b { display: block; font-size: 14px; }
  .step span { font-size: 13px; color: var(--muted); }
  .pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12.5px; font-weight: 600; }
  .pill.ok { background: rgba(22,163,74,.14); color: var(--ok); }
  .pill.warn { background: rgba(217,119,6,.14); color: var(--warn); }
  .pill.bad { background: rgba(220,38,38,.14); color: var(--bad); }
  .hidden { display: none !important; }
  details { margin-top: 14px; }
  details summary { cursor: pointer; font-size: 14px; font-weight: 600; padding: 6px 0; }
  details .muted { margin-top: 8px; }
  .choice { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin-top: 10px;
    cursor: pointer; }
  .choice:hover { border-color: var(--accent); }
  .choice b { font-size: 14.5px; }
  .choice span { font-size: 12.5px; color: var(--muted); display: block; }
  .copy { display: flex; gap: 8px; margin-top: 6px; }
  .copy input { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; }
  .nota { background: var(--bg); border-left: 3px solid var(--accent); border-radius: 0 8px 8px 0;
    padding: 12px 14px; margin-top: 14px; font-size: 13.5px; color: var(--muted); }
  .nota b { color: var(--text); }
`;

const SETUP_FIELDS = [
  'token',
  'appId',
  'appSecret',
  'signupConfigId',
  'phoneNumberId',
  'businessAccountId',
  'verifyToken',
  'mapsApiKey',
] as const;

export function connectPage(labels: Record<string, string>): string {
  const avanzados = SETUP_FIELDS.map(
    (field) => `
  <label for="${field}">${labels[field] ?? field}</label>
  <input id="${field}" name="${field}" autocomplete="off" spellcheck="false">`,
  ).join('');

  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conectar WhatsApp - wa-locator</title>
<style>${CSS}</style>
</head><body>
<div class="wrap">

<header>
  <h1>Conectar tu WhatsApp</h1>
  <span id="state" class="pill hidden"></span>
  <span class="right"><a href="/chat">Chat</a> · <a href="/panel">Panel</a></span>
</header>
<p class="lead">Tu numero de WhatsApp Business se conecta por la via oficial de Meta.
Elige uno de los dos caminos: los dos terminan igual.</p>

<div class="card destacada" id="quick-card">
  <h2>Camino rapido: una ventana y listo</h2>
  <p class="muted">Pulsas el boton, entras con tu cuenta de Facebook, eliges tu numero de WhatsApp
  y vuelves aqui conectado. Es como el "conectar con Facebook" de cualquier app.</p>

  <div class="actions">
    <button class="facebook" id="fb-login">
      <span style="font-size:18px">f</span> Conectar con Facebook
    </button>
    <span id="fb-state" class="pill hidden"></span>
  </div>

  <div id="quick-missing" class="nota hidden"></div>
</div>

<div class="card">
  <h2>Camino manual: pegar tres datos</h2>
  <p class="muted">Si prefieres no usar la ventana, pega estos tres datos de tu app de Meta y el
  sistema hace el resto: busca tu cuenta y tu numero, configura el aviso de mensajes nuevos y
  comprueba que todo responde.</p>

  <label for="c-token">Token permanente
    <span class="hint">Es largo y empieza por EAA.</span></label>
  <input id="c-token" autocomplete="off" spellcheck="false" placeholder="EAAG...">

  <label for="c-appId">ID de la app
    <span class="hint">Solo numeros.</span></label>
  <input id="c-appId" autocomplete="off" spellcheck="false" placeholder="1234567890123456">

  <label for="c-appSecret">Clave secreta de la app</label>
  <input id="c-appSecret" autocomplete="off" spellcheck="false" placeholder="a1b2c3...">

  <label for="c-url">Direccion de este sistema en internet
    <span class="hint">Meta necesita poder entrar aqui para avisarte de los mensajes nuevos.</span></label>
  <input id="c-url" autocomplete="off" spellcheck="false" placeholder="https://algo.trycloudflare.com">

  <div class="actions">
    <button id="connect">Conectar</button>
    <span id="result" class="pill hidden"></span>
  </div>

  <div id="choice" class="hidden" style="margin-top:18px">
    <h2>Elige el numero</h2>
    <p class="muted">Tu cuenta tiene varios.</p>
    <div id="choice-list"></div>
  </div>

  <div id="steps" class="hidden" style="margin-top:18px"></div>

  <details>
    <summary>De donde saco esos datos</summary>
    <ol class="muted">
      <li>Entra a <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">developers.facebook.com/apps</a>
          y crea una app de tipo <b>Empresa</b>. Anadele el producto <b>WhatsApp</b>.</li>
      <li>El <b>ID de la app</b> y la <b>clave secreta</b> estan en Configuracion de la app &rarr; Basica.</li>
      <li>El <b>token permanente</b>: Configuracion del negocio &rarr; Usuarios &rarr; Usuario del sistema.
          Anade ahi la app y tu cuenta de WhatsApp, y genera el token con los permisos
          <code>whatsapp_business_messaging</code> y <code>whatsapp_business_management</code>.
          El token que sale en la pantalla de inicio tambien sirve, pero caduca en 24 horas.</li>
      <li>Para el camino rapido hace falta ademas activar <b>Registro incorporado</b> en
          WhatsApp &rarr; Configuracion, y pegar aqui abajo su ID de configuracion.</li>
    </ol>
    <div class="nota" style="margin-top:12px"><b>Tu numero no puede estar usandose en la app de WhatsApp.</b>
    Si ya lo tienes en WhatsApp o en WhatsApp Business, borra esa cuenta desde el telefono antes de conectarlo aqui.
    Meta regala un numero de prueba para empezar sin arriesgar el tuyo.</div>
  </details>
</div>

<div class="card hidden" id="after">
  <h2>Listo, ya esta conectado</h2>
  <p class="muted">Mandate un mensaje a ti mismo para verlo funcionando de punta a punta.</p>
  <label for="testPhone">Tu telefono, con codigo de pais y sin el signo mas</label>
  <input id="testPhone" placeholder="5215512345678">
  <div class="actions">
    <button id="sendTest">Enviar prueba</button>
    <a href="/chat"><button class="ghost" type="button">Ir al chat</button></a>
    <span id="test-state" class="pill hidden"></span>
  </div>
</div>

<div class="card" id="pin-card">
  <h2>Si tu numero es nuevo</h2>
  <p class="muted">Un numero recien dado de alta se activa con un PIN de seis digitos: el de la
  verificacion en dos pasos. Si no tenia ninguno, el que escribas aqui queda como suyo.</p>
  <div class="actions" style="margin-top:12px">
    <input id="pin" inputmode="numeric" maxlength="6" placeholder="123456" style="max-width:150px">
    <button class="ghost" id="register">Activar numero</button>
    <span id="reg-state" class="pill hidden"></span>
  </div>
</div>

<details>
  <summary>Ver y editar todos los datos guardados</summary>
  <div class="card">
    <p class="muted">Lo secreto se muestra tapado. Deja un campo vacio para no cambiarlo.</p>
    ${avanzados}
    <div class="actions">
      <button id="save">Guardar</button>
      <button class="ghost" id="test">Probar</button>
      <span id="manual-state" class="pill hidden"></span>
    </div>

    <label>Direccion del aviso de mensajes nuevos (webhook)</label>
    <div class="copy"><input id="hookUrl" readonly><button class="ghost" data-copy="hookUrl">Copiar</button></div>
    <label>Palabra de verificacion</label>
    <div class="copy"><input id="hookToken" readonly><button class="ghost" data-copy="hookToken">Copiar</button></div>
  </div>
</details>

<details>
  <summary>Por que no se conecta con un codigo QR</summary>
  <div class="card">
    <p class="muted">El codigo QR es como se conecta un <b>telefono</b> a WhatsApp Web. Para usarlo desde
    un servidor hay que hacerse pasar por ese telefono con librerias no oficiales (Baileys,
    whatsapp-web.js). Eso esta fuera de los terminos de WhatsApp y termina, tarde o temprano, con el
    numero baneado sin aviso y sin poder recuperarlo.</p>
    <p class="muted" style="margin-top:10px">Este sistema usa la API oficial: por eso puede mandar
    campanas, plantillas y seguimientos sin que te tumben el numero. El "conectar con Facebook" de
    arriba es el equivalente rapido que si esta permitido.</p>
  </div>
</details>

</div>
<script>
${String.raw`
function token() {
  var t = sessionStorage.getItem('adminToken');
  if (!t) { t = prompt('Token de administracion (aparece en la consola al arrancar):'); if (t) sessionStorage.setItem('adminToken', t.trim()); }
  return t || '';
}
async function api(path, options) {
  options = options || {};
  var res = await fetch(path, {
    method: options.method || 'GET',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token() },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (res.status === 401) { sessionStorage.removeItem('adminToken'); throw new Error('Token de administracion incorrecto: recarga la pagina'); }
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function show(id, text, kind) {
  var el = document.getElementById(id);
  el.textContent = text;
  el.className = 'pill ' + (kind || 'ok');
  el.classList.remove('hidden');
}
function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v == null ? '' : v; }

var FIELDS = ${JSON.stringify(SETUP_FIELDS)};
var SECRETS = ['token', 'appSecret'];
var opciones = {};

async function load() {
  try {
    var data = await api('/admin/settings');
    FIELDS.forEach(function (f) {
      var input = document.getElementById(f);
      if (!input) return;
      var value = data.masked[f] || '';
      if (SECRETS.indexOf(f) >= 0) input.placeholder = value || '';
      else input.value = value;
    });
    setVal('hookUrl', data.webhookUrl);
    setVal('hookToken', data.verifyToken || '(se crea sola al conectar)');
    if (!val('c-url')) setVal('c-url', data.webhookUrl.replace('/webhooks/whatsapp', ''));
    if (data.missing.length) show('state', 'Sin conectar', 'warn');
    else { show('state', 'Conectado', 'ok'); document.getElementById('after').classList.remove('hidden'); }

    opciones = await api('/admin/connect/options');
    prepararRapido();
  } catch (error) { show('state', error.message, 'bad'); }
}

/* --- camino rapido: la ventana de Meta ------------------------------- */
function prepararRapido() {
  var aviso = document.getElementById('quick-missing');
  var boton = document.getElementById('fb-login');

  if (!opciones.quick) {
    boton.disabled = true;
    aviso.innerHTML = '<b>Para usar este boton falta ' + esc((opciones.missingForQuick || []).join(' y ')) + '.</b><br>' +
      'Se activa en Meta: WhatsApp &rarr; Configuracion &rarr; Registro incorporado. Copia ahi el ID de la ' +
      'configuracion y pegalo abajo, en "Ver y editar todos los datos guardados". ' +
      'Mientras tanto, el camino manual funciona igual.';
    aviso.classList.remove('hidden');
    return;
  }
  aviso.classList.add('hidden');
  cargarSdk();
}

function cargarSdk() {
  if (window.FB) return;
  window.fbAsyncInit = function () {
    FB.init({ appId: opciones.appId, cookie: true, xfbml: false, version: 'v21.0' });
  };
  var s = document.createElement('script');
  s.src = 'https://connect.facebook.net/es_LA/sdk.js';
  s.async = true;
  s.defer = true;
  s.crossOrigin = 'anonymous';
  document.head.appendChild(s);
}

/* La ventana manda por postMessage el id de la cuenta y el del numero. */
var elegido = { wabaId: null, phoneNumberId: null };
window.addEventListener('message', function (event) {
  if (!/facebook\.com$/.test(new URL(event.origin).hostname)) return;
  try {
    var data = JSON.parse(event.data);
    if (data.type === 'WA_EMBEDDED_SIGNUP' && data.event === 'FINISH') {
      elegido.wabaId = data.data.waba_id;
      elegido.phoneNumberId = data.data.phone_number_id;
    }
  } catch (error) { /* la ventana manda tambien mensajes que no son JSON */ }
});

document.getElementById('fb-login').onclick = function () {
  if (!window.FB) return show('fb-state', 'La ventana de Meta todavia esta cargando, intenta en un segundo', 'warn');
  show('fb-state', 'Abriendo la ventana de Meta...', 'warn');

  FB.login(function (response) {
    var code = response && response.authResponse && response.authResponse.code;
    if (!code) return show('fb-state', 'Cerraste la ventana sin terminar', 'warn');
    terminarRapido(code);
  }, {
    config_id: opciones.signupConfigId,
    response_type: 'code',
    override_default_response_type: true,
    extras: { setup: {}, featureType: '', sessionInfoVersion: '3' }
  });
};

async function terminarRapido(code) {
  show('fb-state', 'Conectando...', 'warn');
  try {
    var r = await api('/admin/connect/signup', { method: 'POST', body: {
      code: code,
      wabaId: elegido.wabaId,
      phoneNumberId: elegido.phoneNumberId,
      publicUrl: val('c-url') || undefined
    }});
    pintarPasos(r.steps || []);
    show('fb-state', r.ok ? 'Conectado' : 'Conectado con avisos', r.ok ? 'ok' : 'warn');
    if (r.needsRegistration) show('reg-state', 'Este numero todavia no esta activado: hazlo aqui abajo', 'warn');
    load();
  } catch (error) {
    show('fb-state', error.message, 'bad');
  }
}

/* --- camino manual ---------------------------------------------------- */
function pintarPasos(steps) {
  var box = document.getElementById('steps');
  if (!steps.length) return;
  box.innerHTML = steps.map(function (s) {
    return '<div class="step"><span class="mark ' + (s.ok ? 'ok' : 'bad') + '">' + (s.ok ? '✓' : '✕') + '</span>' +
      '<div><b>' + esc(s.step) + '</b><span>' + esc(s.detail) + '</span></div></div>';
  }).join('');
  box.classList.remove('hidden');
}

async function conectar(phoneNumberId) {
  var boton = document.getElementById('connect');
  boton.disabled = true;
  show('result', 'Conectando...', 'warn');
  try {
    var body = {};
    if (phoneNumberId) body.phoneNumberId = phoneNumberId;
    if (val('c-token')) body.token = val('c-token');
    if (val('c-appId')) body.appId = val('c-appId');
    if (val('c-appSecret')) body.appSecret = val('c-appSecret');
    if (val('c-url')) body.publicUrl = val('c-url');

    var r = await api('/admin/connect', { method: 'POST', body: body });

    if (r.needsChoice) {
      var lista = document.getElementById('choice-list');
      lista.innerHTML = r.numbers.map(function (n) {
        return '<div class="choice" data-id="' + esc(n.phoneNumberId) + '">' +
          '<b>' + esc(n.displayPhoneNumber || n.phoneNumberId) + '</b>' +
          '<span>' + esc(n.verifiedName || '') + ' · ' + esc(n.accountName) + '</span></div>';
      }).join('');
      lista.querySelectorAll('.choice').forEach(function (el) {
        el.onclick = function () {
          document.getElementById('choice').classList.add('hidden');
          conectar(el.getAttribute('data-id'));
        };
      });
      document.getElementById('choice').classList.remove('hidden');
      show('result', 'Elige un numero', 'warn');
      return;
    }

    pintarPasos(r.steps);
    show('result', r.ok ? 'Conectado' : 'Conectado con avisos', r.ok ? 'ok' : 'warn');
    if (r.needsRegistration) {
      show('reg-state', 'Este numero todavia no esta activado: hazlo aqui abajo', 'warn');
      document.getElementById('pin-card').scrollIntoView({ behavior: 'smooth' });
    }
    load();
  } catch (error) {
    show('result', error.message, 'bad');
  } finally {
    boton.disabled = false;
  }
}
document.getElementById('connect').onclick = function () { conectar(); };

document.getElementById('register').onclick = async function () {
  try {
    var r = await api('/admin/settings/register', { method: 'POST', body: { pin: val('pin') } });
    show('reg-state', r.success ? 'Numero activado' : 'Meta no confirmo la activacion', r.success ? 'ok' : 'warn');
  } catch (error) { show('reg-state', error.message, 'bad'); }
};

document.getElementById('sendTest').onclick = async function () {
  var boton = document.getElementById('sendTest');
  boton.disabled = true;
  try {
    var r = await api('/admin/settings/test-message', { method: 'POST', body: { phone: val('testPhone') } });
    show('test-state', r.ok ? 'Enviado: revisa tu WhatsApp' : ('No salio: ' + (r.reason || r.error || '')), r.ok ? 'ok' : 'warn');
  } catch (error) { show('test-state', error.message, 'bad'); }
  finally { boton.disabled = false; }
};

function values() {
  var out = {};
  FIELDS.forEach(function (f) { var v = val(f); if (v) out[f] = v; });
  return out;
}
document.getElementById('save').onclick = async function () {
  try {
    var data = await api('/admin/settings', { method: 'POST', body: values() });
    show('manual-state', data.ok ? 'Guardado y conectado' : ('Guardado: ' + data.detail), data.ok ? 'ok' : 'warn');
    load();
  } catch (error) { show('manual-state', error.message, 'bad'); }
};
document.getElementById('test').onclick = async function () {
  try {
    var data = await api('/admin/settings/test', { method: 'POST', body: values() });
    show('manual-state', data.ok ? 'Conexion correcta' : data.detail, data.ok ? 'ok' : 'bad');
  } catch (error) { show('manual-state', error.message, 'bad'); }
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

load();
`}
</script>
</body></html>`;
}
