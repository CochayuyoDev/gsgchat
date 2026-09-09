/**
 * Pantalla de conexion: un asistente de cuatro pasos.
 *
 * La pantalla anterior enseñaba todo a la vez (dos caminos, ocho campos, el
 * PIN y dos desplegables) y obligaba a decidir sin saber que se decidia. Aqui
 * solo se ve el paso en el que estas; los siguientes quedan bloqueados hasta
 * que el anterior esta hecho.
 *
 * El paso 1 es la unica decision de verdad, y no va de tecnologia sino de algo
 * que el usuario si sabe contestar: si quiere seguir usando WhatsApp en el
 * movil o no.
 *
 *  - `coexistence`: si. El numero se queda en la app de WhatsApp Business y
 *    ademas habla por la API. El alta se hace con un CODIGO QR que enseña la
 *    ventana de Meta. Es la opcion recomendada y la que casi todo el mundo
 *    quiere cuando pide "conectar con QR".
 *  - `dedicated`: no. Numero nuevo, solo para el sistema; deja de funcionar en
 *    la app del movil.
 *  - `manual`: para quien ya tiene un token permanente y prefiere pegarlo.
 *
 * Lo que sigue sin existir es un QR para el WhatsApp verde de consumidor: eso
 * obliga a emular WhatsApp Web con librerias no oficiales, esta fuera de los
 * terminos y acaba con el numero baneado.
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
  .wrap { max-width: 660px; margin: 0 auto; padding: 32px 20px 80px; }
  header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 6px; flex-wrap: wrap; }
  header .right { margin-left: auto; font-size: 13.5px; }
  h1 { font-size: 25px; margin: 0; }
  h2 { font-size: 17px; margin: 0; display: flex; align-items: center; gap: 10px; }
  .lead { color: var(--muted); font-size: 14.5px; margin: 0 0 4px; }
  .muted { color: var(--muted); font-size: 13.5px; margin: 0; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px;
    padding: 20px 22px; margin-top: 14px; }

  /* Numero del paso: hace de indice sin necesidad de una barra de progreso. */
  .num { flex: none; width: 26px; height: 26px; border-radius: 50%; background: var(--accent);
    color: #fff; font-size: 14px; display: grid; place-items: center; font-weight: 700; }
  .done .num { background: var(--ok); }
  .card.locked { opacity: .45; pointer-events: none; }
  .card.locked .num { background: var(--muted); }
  .card > .muted:first-of-type { margin-top: 8px; }

  label { display: block; font-size: 13px; font-weight: 600; margin: 16px 0 5px; }
  label .hint { display: block; font-weight: 400; color: var(--muted); font-size: 12.5px; margin-top: 2px; }
  input, select { width: 100%; padding: 11px 12px; font: inherit; font-size: 14px; color: var(--text);
    background: var(--bg); border: 1px solid var(--line); border-radius: 9px; }
  button { padding: 12px 22px; font: inherit; font-weight: 600; border: 0; border-radius: 9px;
    background: var(--accent); color: #fff; cursor: pointer; font-size: 15px; }
  button.facebook { background: var(--fb); display: inline-flex; align-items: center; gap: 10px;
    font-size: 15.5px; padding: 14px 26px; }
  button.ghost { background: transparent; color: var(--text); border: 1px solid var(--line);
    font-size: 14px; padding: 9px 16px; }
  button:disabled { opacity: .5; cursor: default; }
  .actions { display: flex; gap: 10px; align-items: center; margin-top: 18px; flex-wrap: wrap; }
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
  details summary { cursor: pointer; font-size: 14px; font-weight: 600; padding: 6px 0; color: var(--muted); }

  /* Las tres opciones del paso 1. */
  .choice { display: block; border: 1.5px solid var(--line); border-radius: 11px; padding: 14px 16px;
    margin-top: 10px; cursor: pointer; }
  .choice:hover { border-color: var(--accent); }
  .choice.sel { border-color: var(--accent); background: rgba(18,140,126,.06); }
  .choice b { font-size: 14.5px; display: block; }
  .choice span { font-size: 13px; color: var(--muted); display: block; margin-top: 3px; }
  .choice .tag { display: inline-block; margin-left: 8px; font-size: 11.5px; font-weight: 700;
    color: var(--accent); background: rgba(18,140,126,.14); padding: 2px 8px; border-radius: 999px; }
  .choice .tag.riesgo { color: var(--warn); background: rgba(217,119,6,.16); }

  /* El QR va sobre blanco siempre: en oscuro, un QR invertido no se escanea. */
  .qr-marco { display: inline-block; background: #fff; padding: 14px; border-radius: 12px;
    margin-top: 16px; border: 1px solid var(--line); }
  .qr-marco img { display: block; width: 256px; height: 256px; image-rendering: pixelated; }
  /* El codigo de vinculacion se teclea mirando la pantalla: grande y separado
     en dos mitades, que es como lo pide la app del telefono. */
  .codigo { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 30px;
            letter-spacing: 6px; font-weight: 700; margin: 12px 0 4px; }
  .pair { margin-top: 18px; border-top: 1px solid var(--linea); padding-top: 14px; }
  .copy { display: flex; gap: 8px; margin-top: 6px; }
  .copy input { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; }
  .nota { background: var(--bg); border-left: 3px solid var(--accent); border-radius: 0 8px 8px 0;
    padding: 12px 14px; margin-top: 14px; font-size: 13.5px; color: var(--muted); }
  .nota b { color: var(--text); }
  .resumen { display: flex; align-items: center; gap: 10px; margin-top: 10px; font-size: 13.5px; }
  .resumen .pill { flex: none; }
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
  'provider',
  'wahaUrl',
  'wahaApiKey',
  'wahaSession',
  'wahaEngine',
] as const;

/**
 * Que campos pide el paso 2 en cada modo. La ventana de Meta no necesita el
 * token (lo genera ella), y quien pega el token no necesita el id de la
 * configuracion de registro incorporado.
 */
const CAMPOS_POR_MODO = {
  coexistence: ['appId', 'appSecret', 'signupConfigId'],
  dedicated: ['appId', 'appSecret', 'signupConfigId'],
  manual: ['token', 'appId', 'appSecret'],
  // WAHA no tiene app de Meta: solo hay que decirle donde corre el contenedor.
  waha: ['wahaUrl'],
} as const;

const AYUDA_CAMPO: Record<string, { titulo: string; pista: string; ph: string }> = {
  token: {
    titulo: 'Token permanente',
    pista: 'Es largo y empieza por EAA.',
    ph: 'EAAG...',
  },
  appId: {
    titulo: 'ID de la app',
    pista: 'Solo numeros. Configuracion de la app -> Basica.',
    ph: '1234567890123456',
  },
  appSecret: {
    titulo: 'Clave secreta de la app',
    pista: 'Al lado del ID, en la misma pantalla de Meta.',
    ph: 'a1b2c3...',
  },
  signupConfigId: {
    titulo: 'ID de la configuracion de registro incorporado',
    pista: 'En Meta: WhatsApp -> Configuracion -> Registro incorporado.',
    ph: '9876543210987654',
  },
  wahaUrl: {
    titulo: 'Direccion del contenedor de WAHA',
    pista: 'Donde corre WAHA. Si lo levantaste aqui mismo, es http://localhost:3000.',
    ph: 'http://localhost:3000',
  },
  wahaApiKey: {
    titulo: 'Clave de la API de WAHA (opcional)',
    pista: 'Solo si arrancaste el contenedor con WAHA_API_KEY.',
    ph: '',
  },
  wahaSession: {
    titulo: 'Nombre de la sesion (opcional)',
    pista: 'Una sesion por numero conectado. Vacio = "default".',
    ph: 'default',
  },
};

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
<p class="lead">Cuatro pasos. El primero es el unico que tienes que pensar.</p>

<div class="card hidden" id="gate">
  <h2>Antes de nada</h2>
  <p class="muted">Pega el token de administracion. Aparece en la consola al arrancar el sistema
  y se pide una sola vez.</p>
  <input id="gate-token" autocomplete="off" spellcheck="false" placeholder="Token de administracion">
  <div class="actions">
    <button id="gate-ok">Entrar</button>
    <span id="gate-state" class="pill hidden"></span>
  </div>
</div>

<div id="app" class="hidden">

<section class="card" id="paso1">
  <h2><span class="num">1</span> ¿Quieres seguir usando WhatsApp en el movil?</h2>
  <p class="muted">De esto depende todo lo demas. No se puede cambiar despues sin rehacer la conexion.</p>

  <div class="choice" data-mode="coexistence">
    <b>Si, uso WhatsApp Business en mi telefono <span class="tag">con codigo QR</span></b>
    <span>Meta te enseña un QR, lo escaneas con la app y listo. El numero sigue funcionando en el
    movil para contestar a mano, el historial se sincroniza, y ademas el sistema puede mandar
    campanas y seguimientos. Es lo que casi todo el mundo quiere.</span>
  </div>

  <div class="choice" data-mode="dedicated">
    <b>No, quiero un numero nuevo solo para el sistema</b>
    <span>Ese numero deja de funcionar en la app de WhatsApp del telefono: pasa a ser solo del
    sistema. Meta regala uno de prueba para empezar sin arriesgar el tuyo.</span>
  </div>

  <div class="choice" data-mode="manual">
    <b>Ya tengo un token de Meta y prefiero pegarlo</b>
    <span>Para quien ya monto el usuario del sistema en Meta. Sin ventana ni QR.</span>
  </div>

  <div class="choice" data-mode="waha">
    <b>Conectar con WAHA <span class="tag riesgo">no oficial</span></b>
    <span>Escaneas el QR de WhatsApp Web desde un contenedor de WAHA que corre en tu servidor.
    Funciona con cualquier WhatsApp, tambien el verde de siempre, y no hace falta ninguna app de
    Meta. A cambio emula WhatsApp Web, que esta fuera de los terminos de WhatsApp: el numero
    puede acabar baneado sin aviso y sin recuperacion. Usa un numero secundario.</span>
  </div>

  <div class="nota" id="aviso-consumidor">
    <b>Ojo con cual es tu app.</b> Las tres primeras opciones son la via oficial de Meta y
    necesitan <b>WhatsApp Business</b> (el icono naranja), no el WhatsApp verde de siempre. Si
    usas el verde, instala WhatsApp Business y migra: es gratis, conservas el numero y el
    historial. Solo WAHA funciona con el verde, con el riesgo que dice ahi arriba.
  </div>
</section>

<section class="card locked" id="paso2">
  <h2><span class="num">2</span> Datos de tu app de Meta</h2>
  <p class="muted" id="paso2-lead">Se copian una vez y se guardan cifrados.</p>

  <div id="paso2-guardado" class="resumen hidden">
    <span class="pill ok">Guardados</span>
    <button class="ghost" id="paso2-editar" type="button">Cambiar</button>
  </div>

  <div id="paso2-campos"></div>

  <label for="c-url">Direccion de este sistema en internet
    <span class="hint">Meta necesita poder entrar aqui para avisarte de los mensajes nuevos.</span></label>
  <input id="c-url" autocomplete="off" spellcheck="false" placeholder="https://algo.trycloudflare.com">
  <div class="nota hidden" id="aviso-url"></div>

  <div class="actions">
    <button id="paso2-ok">Guardar y seguir</button>
    <span id="paso2-state" class="pill hidden"></span>
  </div>

  <details>
    <summary>¿De donde saco estos datos?</summary>
    <ol class="muted">
      <li>Entra a <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">developers.facebook.com/apps</a>
          y crea una app de tipo <b>Empresa</b>. Anadele el producto <b>WhatsApp</b>.</li>
      <li>El <b>ID de la app</b> y la <b>clave secreta</b> estan en Configuracion de la app &rarr; Basica.</li>
      <li>El <b>ID de la configuracion</b>: WhatsApp &rarr; Configuracion &rarr; Registro incorporado.
          Ahi se crea y se copia.</li>
      <li>Solo para el camino manual, el <b>token permanente</b>: Configuracion del negocio &rarr;
          Usuarios &rarr; Usuario del sistema, con los permisos
          <code>whatsapp_business_messaging</code> y <code>whatsapp_business_management</code>.</li>
    </ol>
  </details>
</section>

<section class="card locked" id="paso3">
  <h2><span class="num">3</span> Conectar</h2>
  <p class="muted" id="paso3-lead"></p>

  <div class="actions">
    <button class="facebook hidden" id="fb-login">
      <span style="font-size:18px">f</span> <span id="fb-label">Conectar con Facebook</span>
    </button>
    <button class="hidden" id="connect">Conectar</button>
    <button class="hidden" id="waha-connect">Conectar y mostrar el QR</button>
    <span id="fb-state" class="pill hidden"></span>
  </div>

  <div id="qr-box" class="hidden">
    <div class="qr-marco"><img id="qr-img" alt="Codigo QR de WhatsApp Web"></div>
    <p class="muted" id="qr-pasos">En el telefono: WhatsApp &rarr; Ajustes &rarr; Dispositivos
    vinculados &rarr; Vincular un dispositivo. Apunta a este codigo.</p>
    <div class="pair">
      <p class="muted">Si no puedes apuntar con la camara, <b>vincula con tu numero</b>: WhatsApp te
      pide un codigo de ocho caracteres en vez del QR.</p>
      <div class="actions">
        <input id="pair-phone" inputmode="numeric" placeholder="5215512345678" style="max-width:200px">
        <button class="ghost" id="pair-ask" type="button">Pedir codigo</button>
      </div>
      <div id="pair-code" class="codigo hidden"></div>
      <p class="muted hidden" id="pair-pasos">En el telefono: WhatsApp &rarr; Ajustes &rarr;
      Dispositivos vinculados &rarr; Vincular un dispositivo &rarr; <b>Vincular con el numero de
      telefono</b>. Teclea ese codigo.</p>
    </div>

    <div class="actions">
      <button class="ghost" id="waha-logout" type="button">Desvincular el telefono</button>
    </div>
  </div>

  <div id="choice" class="hidden" style="margin-top:18px">
    <h2 style="font-size:15px">Elige el numero</h2>
    <p class="muted">Tu cuenta tiene varios.</p>
    <div id="choice-list"></div>
  </div>

  <div id="steps" class="hidden" style="margin-top:18px"></div>

  <div class="hidden" id="pin-box" style="margin-top:18px">
    <div class="nota"><b>Este numero todavia no esta activado.</b> Se activa con un PIN de seis
    digitos: el de la verificacion en dos pasos. Si no tenia ninguno, el que escribas queda como suyo.</div>
    <div class="actions">
      <input id="pin" inputmode="numeric" maxlength="6" placeholder="123456" style="max-width:150px">
      <button class="ghost" id="register">Activar numero</button>
      <span id="reg-state" class="pill hidden"></span>
    </div>
  </div>
</section>

<section class="card locked" id="paso4">
  <h2><span class="num">4</span> Comprobar que funciona</h2>
  <p class="muted">Mandate un mensaje a ti mismo. Si te llega, esta todo bien.</p>
  <label for="testPhone">Tu telefono, con codigo de pais y sin el signo mas</label>
  <input id="testPhone" placeholder="5215512345678">
  <div class="actions">
    <button id="sendTest">Enviar prueba</button>
    <a href="/chat"><button class="ghost" type="button">Ir al chat</button></a>
    <span id="test-state" class="pill hidden"></span>
  </div>
</section>

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

</div>
</div>
<script>
${String.raw`
/* --- acceso ----------------------------------------------------------- */
function token() { return sessionStorage.getItem('adminToken') || ''; }

async function api(path, options) {
  options = options || {};
  var res = await fetch(path, {
    method: options.method || 'GET',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token() },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (res.status === 401) {
    sessionStorage.removeItem('adminToken');
    abrirPuerta('Ese token no es el correcto');
    throw new Error('Token de administracion incorrecto');
  }
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

function abrirPuerta(mensaje) {
  document.getElementById('app').classList.add('hidden');
  document.getElementById('gate').classList.remove('hidden');
  if (mensaje) show('gate-state', mensaje, 'bad');
  document.getElementById('gate-token').focus();
}
document.getElementById('gate-ok').onclick = function () {
  var v = document.getElementById('gate-token').value.trim();
  if (!v) return show('gate-state', 'Pega el token', 'warn');
  sessionStorage.setItem('adminToken', v);
  document.getElementById('gate').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  load();
};
document.getElementById('gate-token').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') document.getElementById('gate-ok').click();
});

/* --- utilidades ------------------------------------------------------- */
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function show(id, text, kind) {
  var el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'pill ' + (kind || 'ok');
  el.classList.remove('hidden');
}
function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v == null ? '' : v; }
function lock(id, locked) { document.getElementById(id).classList.toggle('locked', !!locked); }
function done(id, hecho) { document.getElementById(id).classList.toggle('done', !!hecho); }

var FIELDS = ${JSON.stringify(SETUP_FIELDS)};
var CAMPOS_POR_MODO = ${JSON.stringify(CAMPOS_POR_MODO)};
var AYUDA = ${JSON.stringify(AYUDA_CAMPO)};
var SECRETS = ['token', 'appSecret'];

var opciones = {};
var guardado = {};
var modo = localStorage.getItem('waModo') || '';

/* --- paso 1: el modo --------------------------------------------------- */
document.querySelectorAll('.choice[data-mode]').forEach(function (el) {
  el.onclick = function () { elegirModo(el.getAttribute('data-mode'), true); };
});

/**
 * "guardar" solo va a true cuando el usuario pulsa: al recargar la pagina no
 * hay que reescribir el proveedor. Importa porque "missing()" depende de el, y
 * con el proveedor equivocado la pantalla pide los datos del otro camino.
 */
function elegirModo(nuevo, guardar) {
  modo = nuevo;
  localStorage.setItem('waModo', modo);
  document.querySelectorAll('.choice[data-mode]').forEach(function (el) {
    el.classList.toggle('sel', el.getAttribute('data-mode') === modo);
  });
  done('paso1', true);
  pintarPaso2();
  pintarPaso3();

  var quiere = modo === 'waha' ? 'waha' : 'cloud';
  if (guardar && guardado.provider !== quiere) {
    api('/admin/settings', { method: 'POST', body: { provider: quiere } })
      .then(load)
      .catch(function (error) { show('paso2-state', error.message, 'bad'); });
  }
}

/* --- paso 2: los datos de la app --------------------------------------- */
function faltantes() {
  if (!modo) return [];
  return CAMPOS_POR_MODO[modo].filter(function (f) { return !guardado[f]; });
}

function pintarPaso2() {
  if (!modo) { lock('paso2', true); return; }
  lock('paso2', false);

  var faltan = faltantes();
  var caja = document.getElementById('paso2-campos');
  var resumen = document.getElementById('paso2-guardado');

  if (!faltan.length && !caja.getAttribute('data-editando')) {
    caja.innerHTML = '';
    resumen.classList.remove('hidden');
    document.getElementById('paso2-lead').textContent =
      'Ya estan guardados. Solo falta la direccion publica si la cambias.';
    done('paso2', true);
    return;
  }

  resumen.classList.add('hidden');
  done('paso2', false);
  var pendientes = caja.getAttribute('data-editando') ? CAMPOS_POR_MODO[modo] : faltan;
  document.getElementById('paso2-lead').textContent =
    modo === 'waha'
      ? 'Solo hace falta saber donde corre tu contenedor de WAHA.'
      : modo === 'manual'
        ? 'Pega el token y los datos de tu app. Se guardan cifrados.'
        : 'Copialos de tu app de Meta. Se guardan cifrados y no se vuelven a pedir.';

  caja.innerHTML = pendientes.map(function (f) {
    var a = AYUDA[f] || { titulo: f, pista: '', ph: '' };
    return '<label for="f-' + f + '">' + esc(a.titulo) +
      (a.pista ? '<span class="hint">' + esc(a.pista) + '</span>' : '') + '</label>' +
      '<input id="f-' + f + '" autocomplete="off" spellcheck="false" placeholder="' + esc(a.ph) + '">';
  }).join('');

  if (modo === 'waha' && document.getElementById('f-wahaUrl')) buscarWaha();
}

/**
 * Rellena sola la direccion del contenedor.
 *
 * Casi siempre corre en la misma maquina y en uno de dos puertos, asi que
 * preguntar por una URL que el sistema puede averiguar es pedirle al usuario
 * que haga de configurador. Si no lo encuentra, el campo se queda vacio y se
 * teclea a mano como antes.
 */
async function buscarWaha() {
  var campo = document.getElementById('f-wahaUrl');
  if (!campo || campo.value) return;
  try {
    var r = await api('/admin/waha/detect');
    if (!r.found) return;
    campo.value = r.found;
    var pista = document.createElement('span');
    pista.className = 'hint';
    pista.textContent = 'Contenedor encontrado en ' + r.found + '. Si es el tuyo, no toques nada.';
    campo.insertAdjacentElement('afterend', pista);
  } catch (error) {
    // Buscar es una comodidad: que falle no puede romper el paso.
  }
}

document.getElementById('paso2-editar').onclick = function () {
  document.getElementById('paso2-campos').setAttribute('data-editando', '1');
  pintarPaso2();
};

document.getElementById('paso2-ok').onclick = async function () {
  var boton = this;
  boton.disabled = true;
  try {
    var body = {};
    (CAMPOS_POR_MODO[modo] || []).forEach(function (f) {
      var v = val('f-' + f);
      if (v) body[f] = v;
    });
    if (Object.keys(body).length) await api('/admin/settings', { method: 'POST', body: body });
    document.getElementById('paso2-campos').removeAttribute('data-editando');
    show('paso2-state', 'Guardado', 'ok');
    await load();
  } catch (error) {
    show('paso2-state', error.message, 'bad');
  } finally {
    boton.disabled = false;
  }
};

/* --- paso 3: la conexion ----------------------------------------------- */
function pintarPaso3() {
  var listo = modo && !faltantes().length;
  lock('paso3', !listo);

  var fb = document.getElementById('fb-login');
  var manual = document.getElementById('connect');
  var waha = document.getElementById('waha-connect');
  var lead = document.getElementById('paso3-lead');

  var esMeta = modo === 'coexistence' || modo === 'dedicated';
  fb.classList.toggle('hidden', !esMeta);
  manual.classList.toggle('hidden', modo !== 'manual');
  waha.classList.toggle('hidden', modo !== 'waha');
  if (modo !== 'waha') pararSondeo();

  if (modo === 'waha') {
    lead.textContent = 'Se crea la sesion en tu contenedor de WAHA y aparece aqui el codigo QR. ' +
      'Lo escaneas desde el telefono, igual que WhatsApp Web, y el telefono tiene que seguir con ' +
      'conexion a internet para que la sesion no se caiga.';
    if (listo) sondearWaha();
  } else if (modo === 'coexistence') {
    document.getElementById('fb-label').textContent = 'Conectar y ver el codigo QR';
    lead.textContent = 'Se abre la ventana de Meta. Entras con tu cuenta de Facebook, eliges tu ' +
      'numero, y te enseña un codigo QR: escanealo con la app de WhatsApp Business del telefono. ' +
      'Meta te manda ademas un codigo de confirmacion a ese mismo WhatsApp.';
  } else if (modo === 'dedicated') {
    document.getElementById('fb-label').textContent = 'Conectar con Facebook';
    lead.textContent = 'Se abre la ventana de Meta. Entras con tu cuenta, eliges o creas el numero ' +
      'y vuelves aqui conectado.';
  } else if (modo === 'manual') {
    lead.textContent = 'Con el token guardado, el sistema busca tu cuenta, registra el webhook en ' +
      'Meta y comprueba que el numero responde.';
  }

  if (listo && esMeta && !opciones.quick) {
    lock('paso3', true);
    show('fb-state', 'Falta ' + ((opciones.missingForQuick || []).join(' y ')), 'warn');
  }
  if (listo && esMeta && opciones.quick) cargarSdk();
}

/* --- paso 3, variante WAHA: el codigo QR -------------------------------- */
var sondeo = null;

function pararSondeo() {
  if (sondeo) { clearInterval(sondeo); sondeo = null; }
}

/**
 * WAHA tarda unos segundos en generar el QR y el QR caduca solo, asi que la
 * pantalla pregunta el estado cada 3 s y repinta. Se para en cuanto conecta.
 */
function sondearWaha() {
  pararSondeo();
  void estadoWaha();
  sondeo = setInterval(function () { void estadoWaha(); }, 3000);
}

async function estadoWaha() {
  var caja = document.getElementById('qr-box');
  try {
    var r = await api('/admin/waha/status');

    if (!r.configured) { caja.classList.add('hidden'); return; }
    if (!r.ok) { show('fb-state', r.detail || 'WAHA no responde', 'bad'); return; }

    if (r.status === 'SCAN_QR_CODE' && r.qr) {
      document.getElementById('qr-img').src = 'data:image/png;base64,' + r.qr;
      caja.classList.remove('hidden');
      show('fb-state', 'Escanea el codigo', 'warn');
      return;
    }

    if (r.connected) {
      pararSondeo();
      caja.classList.add('hidden');
      show('fb-state', 'Conectado' + (r.phone ? ': ' + r.phone : ''), 'ok');
      done('paso3', true);
      load();
      return;
    }

    caja.classList.add('hidden');
    show('fb-state', 'Estado: ' + (r.status || 'desconocido'), 'warn');
  } catch (error) {
    show('fb-state', error.message, 'bad');
  }
}

document.getElementById('waha-connect').onclick = async function () {
  var boton = this;
  boton.disabled = true;
  show('fb-state', 'Creando la sesion en WAHA...', 'warn');
  try {
    await api('/admin/waha/connect', { method: 'POST', body: {
      wahaUrl: val('f-wahaUrl') || undefined,
      publicUrl: val('c-url') || undefined
    }});
    sondearWaha();
  } catch (error) {
    show('fb-state', error.message, 'bad');
  } finally {
    boton.disabled = false;
  }
};

/**
 * Pide el codigo de ocho caracteres para vincular sin camara.
 *
 * El sondeo sigue corriendo: en cuanto el usuario teclee el codigo en el
 * telefono, el estado pasa a WORKING y la pantalla se entera sola.
 */
document.getElementById('pair-ask').onclick = async function () {
  var boton = this;
  var telefono = val('pair-phone');
  if (!telefono) { show('fb-state', 'Escribe tu numero con codigo de pais', 'warn'); return; }

  boton.disabled = true;
  try {
    var r = await api('/admin/waha/request-code', { method: 'POST', body: { phone: telefono } });
    var caja = document.getElementById('pair-code');
    // WAHA lo manda de corrido; partirlo por la mitad es como lo enseña la app.
    caja.textContent = r.code.length === 8 ? r.code.slice(0, 4) + ' ' + r.code.slice(4) : r.code;
    caja.classList.remove('hidden');
    document.getElementById('pair-pasos').classList.remove('hidden');
    show('fb-state', 'Teclea el codigo en el telefono', 'warn');
  } catch (error) {
    show('fb-state', error.message, 'bad');
  } finally {
    boton.disabled = false;
  }
};

document.getElementById('waha-logout').onclick = async function () {
  try {
    await api('/admin/waha/logout', { method: 'POST', body: {} });
    show('fb-state', 'Telefono desvinculado', 'warn');
    sondearWaha();
  } catch (error) { show('fb-state', error.message, 'bad'); }
};

function cargarSdk() {
  if (modo === 'manual' || window.FB || !opciones.appId) return;
  window.fbAsyncInit = function () {
    FB.init({ appId: opciones.appId, cookie: true, xfbml: false, version: opciones.graphVersion || 'v21.0' });
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
  var host;
  try { host = new URL(event.origin).hostname; } catch (error) { return; }
  if (!/facebook\.com$/.test(host)) return;
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

  var extras = (opciones.modes || {})[modo];
  FB.login(function (response) {
    var code = response && response.authResponse && response.authResponse.code;
    if (!code) return show('fb-state', 'Cerraste la ventana sin terminar', 'warn');
    terminarRapido(code);
  }, {
    config_id: opciones.signupConfigId,
    response_type: 'code',
    override_default_response_type: true,
    extras: extras || { setup: {}, featureType: '', sessionInfoVersion: '3' }
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
    trasConectar(r, 'fb-state');
  } catch (error) {
    show('fb-state', error.message, 'bad');
  }
}

function pintarPasos(steps) {
  var box = document.getElementById('steps');
  if (!steps || !steps.length) return;
  box.innerHTML = steps.map(function (s) {
    return '<div class="step"><span class="mark ' + (s.ok ? 'ok' : 'bad') + '">' + (s.ok ? '✓' : '✕') + '</span>' +
      '<div><b>' + esc(s.step) + '</b><span>' + esc(s.detail) + '</span></div></div>';
  }).join('');
  box.classList.remove('hidden');
}

function trasConectar(r, estadoId) {
  pintarPasos(r.steps);
  show(estadoId, r.ok ? 'Conectado' : 'Conectado con avisos', r.ok ? 'ok' : 'warn');
  document.getElementById('pin-box').classList.toggle('hidden', !r.needsRegistration);
  done('paso3', true);
  load();
}

async function conectar(phoneNumberId) {
  var boton = document.getElementById('connect');
  boton.disabled = true;
  show('fb-state', 'Conectando...', 'warn');
  try {
    var body = {};
    if (phoneNumberId) body.phoneNumberId = phoneNumberId;
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
      show('fb-state', 'Elige un numero', 'warn');
      return;
    }

    trasConectar(r, 'fb-state');
  } catch (error) {
    show('fb-state', error.message, 'bad');
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

/* --- paso 4: la prueba -------------------------------------------------- */
document.getElementById('sendTest').onclick = async function () {
  var boton = this;
  boton.disabled = true;
  try {
    var r = await api('/admin/settings/test-message', { method: 'POST', body: { phone: val('testPhone') } });
    show('test-state', r.ok ? 'Enviado: revisa tu WhatsApp' : ('No salio: ' + (r.reason || r.error || '')), r.ok ? 'ok' : 'warn');
  } catch (error) { show('test-state', error.message, 'bad'); }
  finally { boton.disabled = false; }
};

/* --- avanzado ----------------------------------------------------------- */
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

/* --- carga -------------------------------------------------------------- */
async function load() {
  try {
    var data = await api('/admin/settings');
    guardado = {};
    FIELDS.forEach(function (f) {
      var input = document.getElementById(f);
      var value = data.masked[f] || '';
      guardado[f] = value;
      if (!input) return;
      if (SECRETS.indexOf(f) >= 0) input.placeholder = value || '';
      else input.value = value;
    });
    setVal('hookUrl', data.webhookUrl);
    setVal('hookToken', data.verifyToken || '(se crea sola al conectar)');
    if (!val('c-url')) setVal('c-url', data.webhookUrl.replace('/webhooks/whatsapp', ''));

    var conectado = !data.missing.length;
    show('state', conectado ? 'Conectado' : 'Sin conectar', conectado ? 'ok' : 'warn');
    lock('paso4', !conectado);
    done('paso4', conectado);

    opciones = await api('/admin/connect/options');

    // Con WAHA el tunel no hace falta: el contenedor suele correr en la misma
    // maquina y solo tiene que poder llegar a este servidor. Avisar de lo
    // contrario mandaria al usuario a montar algo que no necesita.
    var aviso = document.getElementById('aviso-url');
    if (modo !== 'waha' && !opciones.reachable && !/^https:\/\//.test(val('c-url'))) {
      aviso.innerHTML = '<b>Meta no puede entrar en una direccion local.</b> Levanta un tunel con ' +
        '<code>npx cloudflared tunnel --url http://localhost:' + esc(location.port || '3000') + '</code> ' +
        'y pega aqui la direccion que te de.';
      aviso.classList.remove('hidden');
    } else {
      aviso.classList.add('hidden');
    }

    // Sin eleccion previa, manda lo que ya este guardado en el servidor.
    if (!modo && guardado.provider === 'waha') modo = 'waha';

    if (modo) elegirModo(modo, false);
    else { pintarPaso2(); pintarPaso3(); }
  } catch (error) {
    if (token()) show('state', error.message, 'bad');
  }
}

if (token()) { document.getElementById('app').classList.remove('hidden'); load(); }
else abrirPuerta();
`}
</script>
</body></html>`;
}
