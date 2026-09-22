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
  /* Conexion usa la paleta y la escala del armazon: aqui solo lo propio de la pantalla. */
  * { box-sizing: border-box; }
  .wrap { color: var(--texto); font: var(--fs-cuerpo)/1.55 var(--fuente); max-width: 760px; }
  .wrap h2 { font-size: var(--fs-h2); margin: 0; display: flex; align-items: center; gap: 10px; letter-spacing: -.01em; }
  .lead { color: var(--texto-suave); font-size: var(--fs-cuerpo); margin: 0 0 4px; }
  .muted { color: var(--texto-suave); font-size: 13.5px; margin: 0; }
  .card { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); padding: 20px 22px; margin-top: var(--esp-3); box-shadow: var(--sombra); }
  @media (max-width: 640px) { .card { padding: 16px 14px; } }

  /* Numero del paso: hace de indice sin necesidad de una barra de progreso. */
  .num { flex: none; width: 28px; height: 28px; border-radius: 50%; background: var(--primario); color: var(--primario-texto); font-size: 14px; display: grid; place-items: center; font-weight: 700; }
  .done .num { background: var(--verde); color: #fff; }
  .card.locked { opacity: .5; pointer-events: none; }
  .card.locked .num { background: var(--gris); }
  .card > .muted:first-of-type { margin-top: 8px; }

  label { display: block; font-size: 13px; font-weight: 600; margin: 16px 0 5px; }
  label .hint { display: block; font-weight: 400; color: var(--texto-suave); font-size: var(--fs-small); margin-top: 2px; }
  input, select { width: 100%; padding: 11px 12px; font: inherit; font-size: 14px; color: var(--texto); background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio-sm); min-height: 42px; }
  input:focus-visible, select:focus-visible { border-color: var(--primario); outline: 2px solid var(--primario-suave); outline-offset: 0; }
  button { padding: 10px 20px; font: inherit; font-weight: 600; border: 1px solid var(--primario); border-radius: var(--radio-sm); background: var(--primario); color: var(--primario-texto); cursor: pointer; font-size: 14.5px; min-height: 40px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; line-height: 1.2; }
  button:hover { filter: brightness(1.06); }
  button.facebook { background: #1877f2; border-color: #1877f2; color: #fff; font-size: 15px; padding: 12px 24px; }
  button.ghost { background: var(--superficie); color: var(--texto); border: 1px solid var(--borde); font-size: 14px; padding: 8px 14px; min-height: 36px; }
  button.ghost:hover { border-color: var(--primario); color: var(--primario); filter: none; }
  button:disabled { opacity: .5; cursor: default; }
  .actions { display: flex; gap: 8px; align-items: center; margin-top: 16px; flex-wrap: wrap; }
  ol, ul { padding-left: 20px; margin: 10px 0 0; }
  li { margin-bottom: 9px; }
  a { color: var(--primario); }
  code { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; background: var(--superficie-2); padding: 1px 6px; border-radius: 5px; word-break: break-all; }

  .step { display: flex; gap: 10px; align-items: flex-start; padding: 9px 0; border-bottom: 1px solid var(--borde); }
  .step:last-child { border-bottom: 0; }
  .step .mark { font-size: 15px; line-height: 1.4; }
  .step .mark.ok { color: var(--verde); } .step .mark.bad { color: var(--rojo); }
  .step b { display: block; font-size: 14px; }
  .step span { font-size: 13px; color: var(--texto-suave); }
  .pill { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px; font-size: 12.5px; font-weight: 600; line-height: 1.5; }
  .pill.ok { background: var(--verde-suave); color: var(--verde); }
  .pill.warn { background: var(--ambar-suave); color: var(--ambar); }
  .pill.bad { background: var(--rojo-suave); color: var(--rojo); }
  .hidden { display: none !important; }
  details { margin-top: 14px; }
  details summary { cursor: pointer; font-size: 14px; font-weight: 600; padding: 6px 0; color: var(--texto-suave); }

  /* Las opciones del paso 1. */
  .choice { display: block; border: 1.5px solid var(--borde); border-radius: var(--radio); padding: 14px 16px; margin-top: 10px; cursor: pointer; background: var(--superficie); transition: border-color .12s, background .12s; }
  .choice:hover { border-color: var(--primario); }
  .choice.sel { border-color: var(--primario); background: var(--primario-suave); }
  .choice > b { font-size: 14.5px; display: block; }
  .choice span b { display: inline; }
  .choice span { font-size: 13px; color: var(--texto-suave); display: block; margin-top: 3px; }
  .choice .tag { display: inline-block; margin-left: 8px; font-size: 11.5px; font-weight: 700; color: var(--primario); background: var(--primario-suave); padding: 2px 8px; border-radius: 999px; vertical-align: middle; }
  .choice.sel .tag { background: var(--superficie); }
  .choice .tag.riesgo { color: var(--ambar); background: var(--ambar-suave); }

  /* El QR va sobre blanco siempre: en oscuro, un QR invertido no se escanea. */
  .qr-marco { display: inline-block; background: #fff; padding: 14px; border-radius: var(--radio); margin-top: 16px; border: 1px solid var(--borde); }
  .qr-marco img { display: block; width: 256px; height: 256px; image-rendering: pixelated; max-width: 100%; }
  /* El codigo de vinculacion se teclea mirando la pantalla: grande y separado
     en dos mitades, que es como lo pide la app del telefono. */
  .codigo { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 30px; letter-spacing: 6px; font-weight: 700; margin: 12px 0 4px; }
  .pair { margin-top: 18px; border-top: 1px solid var(--borde); padding-top: 14px; }
  .copy { display: flex; gap: 8px; margin-top: 6px; flex-wrap: wrap; }
  .copy input { flex: 1 1 200px; min-width: 0; }
  #gsg-bitacora { overflow-x: auto; max-width: 100%; }
  #gsg-bitacora table { min-width: 520px; }
  #gsg-sim-valor, #gsg-clave-valor { overflow-wrap: anywhere; }
  .copy input { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; }
  .nota { background: var(--superficie-2); border-left: 3px solid var(--primario); border-radius: 0 var(--radio-sm) var(--radio-sm) 0; padding: 12px 14px; margin-top: 14px; font-size: 13.5px; color: var(--texto-suave); }
  .nota b { color: var(--texto); }
  .resumen { display: flex; align-items: center; gap: 10px; margin-top: 10px; font-size: 13.5px; }
  .resumen .pill { flex: none; }
  .tel { display: flex; align-items: stretch; }
  .tel .prefijo { display: inline-flex; align-items: center; padding: 0 12px; border: 1px solid var(--borde); border-right: 0; border-radius: var(--radio-sm) 0 0 var(--radio-sm); background: var(--superficie-2); color: var(--texto-suave); font-size: 14px; }
  .tel input { border-radius: 0 var(--radio-sm) var(--radio-sm) 0; }
  .gsg-bloque { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
  .perfiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
  .perfiles label { display: block; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; cursor: pointer; background: var(--card); }
  .perfiles label.elegido { border-color: var(--accent); box-shadow: 0 0 0 2px var(--primario-suave); }
  .perfiles label b { display: block; margin-bottom: 4px; }
  .perfiles label input { margin: 0 6px 6px 0; width: 18px; height: 18px; min-height: 0; vertical-align: middle; }
  .perfiles ul { margin: 6px 0 0; padding-left: 18px; font-size: 12.5px; color: var(--muted); }
  .perfiles .actual { display: inline-block; margin-top: 6px; font-size: 12px; color: var(--ok); }
  /* Con un perfil ya en uso, el paso 0 no distrae: una linea con el nombre y «Cambiar». */
  #perfil.plegado > p.muted, #perfil.plegado #perfil-lista, #perfil.plegado .actions { display: none; }
  #perfil-resumen { display: none; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 4px; }
  #perfil.plegado #perfil-resumen { display: flex; }
  #perfil-resumen .ok { color: var(--ok); font-weight: 600; }
  #perfil-resumen button { min-height: 36px; }
  .gsg-bloque h3 { margin: 0 0 6px; font-size: 14px; }
  .dev > summary .muted { font-weight: 400; font-size: 12.5px; margin-left: 4px; }
  .dev, .mas-formas { margin-top: 12px; }
  .dev .copy input { background: var(--superficie-2); }
  .boton-enlace { display: inline-flex; align-items: center; min-height: 36px; padding: 8px 14px; border: 1px solid var(--borde); border-radius: var(--radio-sm); background: var(--superficie); color: var(--texto); font-weight: 600; font-size: 14px; text-decoration: none; }
  .boton-enlace:hover { border-color: var(--primario); color: var(--primario); }
  .mas-formas summary { font-weight: 600; color: var(--texto-suave); }
  .mas-formas .choice { margin-top: 10px; }
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
  // El camino corto no pide nada: la vinculacion ES el QR.
  local: [],
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
    titulo: 'ID de la configuracion de registro incorporado (v4)',
    pista: 'En tu app de Meta: Facebook Login for Business -> Configurations -> Crear, variante "Embedded Signup", con el producto Cloud API (y "WhatsApp Business App onboarding" si el numero sigue en el celular). Las configuraciones viejas (v2/v3) dejan de abrir el 15/10/2026.',
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

import { appShell, modoVigente } from './shell.js';

export interface ConnectOpts {
  labels: Record<string, string>;
  nombreNegocio: string;
  demo?: boolean;
  /** Si hay modulo de entregas: se ensena tambien la conexion con GSG. */
  conGsg?: boolean;
}

export function connectPage(opts: ConnectOpts): string {
  const { labels } = opts;
  const avanzados = SETUP_FIELDS.map(
    (field) => `
  <label for="${field}">${labels[field] ?? field}</label>
  <input id="${field}" name="${field}" autocomplete="off" spellcheck="false">`,
  ).join('');

  const contenido = `
<div class="wrap">
<p class="lead">${opts.conGsg ? 'Dos cosas: el sistema de GSG (de ahí salen los pedidos) y tu WhatsApp (cuatro pasos; el primero es el único que tienes que pensar).' : 'Cuatro pasos. El primero es el único que tienes que pensar.'}</p>


<div id="app" class="hidden">
<section class="card" id="perfil">
  <h2><span class="num">0</span> ¿Para qué vas a usar GSGchat?</h2>
  <p class="muted">Elige el perfil que más se parece a tu negocio: deja de un clic el menú, qué contesta solo y los ajustes de las entregas con valores sensatos. Tus textos y tus datos no se tocan; se puede cambiar cuando quieras.</p>
  <div id="perfil-resumen"><span class="ok" id="perfil-resumen-texto"></span><button class="ghost" type="button" id="perfil-cambiar">Cambiar</button></div>
  <div id="perfil-lista" class="perfiles"></div>
  <div class="actions" style="margin-top:10px"><button class="primary" id="perfil-aplicar" type="button">Aplicar este perfil</button><span id="perfil-state" class="pill hidden"></span></div>
</section>
${opts.conGsg ? `
<section class="card" id="gsg">
  <h2><span class="num">G</span> El sistema de GSG</h2>
  <p class="muted">De ahí salen cada día los pedidos: a quién falta pedirle la ubicación y a quién falta que confirme. Puede ser su API de verdad o el simulador de este servidor (para probar con números ficticios).</p>
  <div id="gsg-estado" class="muted">Cargando…</div>
  <div class="actions" style="margin-top:8px">
    <button class="ghost" id="gsg-probar" type="button">Probar</button>
    <button class="ghost" id="gsg-simulador" type="button">Usar el simulador</button>
    <button class="ghost" id="gsg-real" type="button">Conectar la API real</button>
    <button class="ghost" id="gsg-quitar" type="button">Desconectar</button>
    <span id="gsg-state" class="pill hidden"></span>
  </div>
  <div id="gsg-descartes" class="hidden" style="margin-top:12px;padding:10px 12px;border:1px solid var(--ambar);background:var(--ambar-suave);border-radius:10px">
    <b id="gsg-descartes-titulo"></b>
    <p class="muted" style="margin:4px 0 6px">GSG los mandó en su lista de hoy pero no se pudieron usar. Avísale a GSG para que los corrija; en cuanto los mande bien, entran solos en la siguiente consulta.</p>
    <ul id="gsg-descartes-lista" style="margin:0;padding-left:20px;font-size:13.5px"></ul>
  </div>
  <div class="gsg-bloque">
    <h3>Cada día</h3>
    <div class="actions">
      <button class="ghost" id="gsg-cuadrar" type="button">Cuadrar el día con GSG</button>
      <button class="ghost" id="gsg-verificar" type="button">Verificar el contrato</button>
      <span id="gsg-verificar-state" class="pill hidden"></span>
    </div>
    <p class="muted" style="margin:6px 0 0;font-size:13px">«Cuadrar» compara lo que GSG tiene como terminado con lo que aquí figura entregado o cancelado. «Verificar el contrato» le pide a GSG su lista del día y dice, campo por campo, qué falta o sobra; no crea ningún pedido.</p>
    <div id="gsg-verificacion" class="hidden" style="margin-top:8px"></div>
    <div id="gsg-cuadre" class="hidden" style="margin-top:8px"></div>
  </div>
  <div class="gsg-bloque">
    <h3>Para que GSG conecte su sistema</h3>
    <p class="muted" style="margin:0 0 8px">Con una clave, GSG nos manda cada pedido en cuanto entra (sin esperar a que se le pregunte cada cinco minutos) y se entera de lo que pasa: confirmó, hora avisada, entregado, incidencia. Crea la clave y pásasela a sus programadores junto con el contrato.</p>
    <div class="actions"><button class="ghost" id="gsg-clave" type="button">Crear la clave para GSG</button><span id="gsg-clave-state" class="pill hidden"></span></div>
    <details class="dev" id="gsg-dev">
      <summary>Para los programadores de GSG <span class="muted">dirección, contrato, simulador de pruebas y lo que nos mandaron</span></summary>
      <p class="muted" style="margin:8px 0 6px">Lo que necesitan: la dirección a la que mandan los pedidos, la clave (se crea arriba) y el contrato con el JSON de cada llamada.</p>
      <div class="copy"><input id="gsg-api-url" readonly value="/api/v1/entregas" aria-label="Dirección de la API para GSG"><button class="ghost" id="gsg-api-copiar" type="button">Copiar la dirección</button></div>
      <div class="actions" style="margin-top:8px">
        <a class="ghost boton-enlace" id="gsg-contrato" href="/docs/contrato-gsg.md" download="CONTRATO-GSG.md">Descargar el contrato</a>
        <a class="ghost boton-enlace" href="/api/v1/openapi.json" download="contrato-gsgchat.json">Descargar el OpenAPI</a>
        <a class="ghost boton-enlace" href="/api/v1/openapi.json" target="_blank" rel="noopener">Ver el OpenAPI en el navegador</a>
      </div>
      <p class="muted" style="margin:8px 0 0">«Descargar el contrato» baja el documento explicado paso a paso, con ejemplos de cada llamada y cómo probar contra el simulador antes de tocar nada real: es lo que se le manda a los programadores de GSG.</p>
      <div id="gsg-sim" class="hidden" style="margin-top:12px;padding-top:10px;border-top:1px dashed var(--line)">
        <p class="muted" style="margin:0 0 6px"><b>Que prueben contra el simulador desde fuera.</b> Un token propio, con fecha de caducidad, para que los programadores de GSG llamen al simulador de este servidor (la copia de mentira del sistema de GSG) sin tocar nada real. Se ve una sola vez.</p>
        <div class="copy"><input id="gsg-sim-url" readonly aria-label="Dirección del simulador"><button class="ghost" id="gsg-sim-url-copiar" type="button">Copiar la dirección</button></div>
        <div class="actions" style="margin-top:8px"><button class="ghost" id="gsg-sim-token" type="button">Crear un token del simulador</button><span id="gsg-sim-state" class="pill hidden"></span></div>
        <div id="gsg-sim-nuevo" class="hidden" style="margin-top:8px;padding:10px 12px;border:1px dashed var(--accent);border-radius:10px">
          <b>Token del simulador: cópialo ahora, no se volverá a mostrar.</b>
          <code id="gsg-sim-valor" style="display:block;word-break:break-all;margin:6px 0"></code>
          <p class="muted" style="margin:4px 0 0;font-size:13px">Lo mandan como <code>Authorization: Bearer &lt;el token&gt;</code> a la dirección de arriba. Caduca solo; también se puede anular aquí.</p>
          <div class="actions" style="margin-top:8px"><button class="ghost sm" id="gsg-sim-copiar" type="button">Copiar el token</button></div>
        </div>
        <ul id="gsg-sim-lista" style="margin:8px 0 0;padding-left:20px;font-size:13.5px"></ul>
        <div style="margin-top:12px;padding-top:10px;border-top:1px dashed var(--line)">
          <p class="muted" style="margin:0 0 6px"><b>Probar lo que GSG puede cambiar después de mandar un pedido.</b> Con un clic, el simulador hace lo que haría GSG: cancelar un pedido por su cuenta o cambiarle la dirección. En la siguiente sincronización (o con «Sincronizar ahora» en Hoy) este sistema lo refleja.</p>
          <div class="actions">
            <button class="ghost sm" id="gsg-sim-cancelar" type="button">Cancelar uno (prueba)</button>
            <button class="ghost sm" id="gsg-sim-cambiar" type="button">Cambiar la dirección de uno (prueba)</button>
            <span id="gsg-sim-prueba-state" class="pill hidden"></span>
          </div>
        </div>
      </div>
      <div style="margin-top:12px;padding-top:10px;border-top:1px dashed var(--line)">
        <p class="muted" style="margin:0 0 6px"><b>Lo que GSG nos mandó</b> (las últimas llamadas al simulador y a la API de pedidos, con lo que se les contestó). <a id="gsg-bitacora-refrescar" href="#" >Actualizar</a></p>
        <div id="gsg-bitacora" class="muted" style="font-size:13px">Todavía nadie ha llamado.</div>
      </div>
    </details>
    <div id="gsg-clave-nueva" class="hidden" style="margin-top:10px;padding:10px 12px;border:1px dashed var(--accent);border-radius:10px">
      <b>Clave para GSG: cópiala ahora, no se volverá a mostrar.</b>
      <code id="gsg-clave-valor" style="display:block;word-break:break-all;margin:6px 0"></code>
      <ol id="gsg-clave-pasos" style="margin:6px 0 0;padding-left:20px;font-size:13.5px"></ol>
      <div class="actions" style="margin-top:8px"><button class="ghost sm" id="gsg-clave-copiar" type="button">Copiar la clave</button></div>
    </div>
  </div>
</section>
` : ''}

<section class="card" id="paso1">
  <h2><span class="num">1</span> ¿Quieres seguir usando WhatsApp en el móvil?</h2>
  <p class="muted">De esto depende todo lo demás. No se puede cambiar después sin rehacer la conexión.</p>

  <div class="choice" data-mode="local">
    <b>Escanear el QR y ya <span class="tag">lo más rápido</span></b>
    <span>Sin cuenta de Meta, sin contenedor y sin instalar nada: sale el código aquí mismo, lo
    escaneas con el teléfono (o lo tecleas) y quedas conectado. Funciona con cualquier WhatsApp,
    también el verde. <b>No es oficial</b>: emula WhatsApp Web, está fuera de los términos de Meta
    y el número se puede banear. Para probar, usa un número secundario.</span>
  </div>

  <div class="choice" data-mode="coexistence">
    <b>Sí, uso WhatsApp Business en mi teléfono <span class="tag">con código QR</span></b>
    <span>Meta te enseña un QR, lo escaneas con la app y listo. El número sigue funcionando en el
    móvil para contestar a mano, el historial se sincroniza, y además el sistema puede mandar
    campañas y seguimientos. Es lo que casi todo el mundo quiere.</span>
  </div>

  ${modoVigente() === 'gsg' ? '<details class="mas-formas" id="mas-formas"><summary>Más formas de conectar (número nuevo, token de Meta, WAHA)</summary>' : ''}
  <div class="choice" data-mode="dedicated">
    <b>No, quiero un número nuevo solo para el sistema</b>
    <span>Ese número deja de funcionar en la app de WhatsApp del teléfono: pasa a ser solo del
    sistema. Meta regala uno de prueba para empezar sin arriesgar el tuyo.</span>
  </div>

  <div class="choice" data-mode="manual">
    <b>Ya tengo un token de Meta y prefiero pegarlo</b>
    <span>Para quien ya montó el usuario del sistema en Meta. Sin ventana ni QR.</span>
  </div>

  <div class="choice" data-mode="waha">
    <b>Conectar con WAHA <span class="tag riesgo">no oficial</span></b>
    <span>Escaneas el QR de WhatsApp Web desde un contenedor de WAHA que corre en tu servidor.
    Funciona con cualquier WhatsApp, también el verde de siempre, y no hace falta ninguna app de
    Meta. A cambio emula WhatsApp Web, que está fuera de los términos de WhatsApp: el número
    puede acabar baneado sin aviso y sin recuperación. Usa un número secundario.</span>
  </div>
  ${modoVigente() === 'gsg' ? '</details>' : ''}

  <div class="nota" id="aviso-consumidor">
    <b>Ojo con cuál es tu app.</b> Las tres primeras opciones son la vía oficial de Meta y
    necesitan <b>WhatsApp Business</b> (el icono naranja), no el WhatsApp verde de siempre. Si
    usas el verde, instala WhatsApp Business y migra: es gratis, conservas el número y el
    historial. Solo WAHA funciona con el verde, con el riesgo que dice ahí arriba.
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

  <label for="c-url">Dirección de este sistema en internet
    <span class="hint">Meta necesita poder entrar aquí para avisarte de los mensajes nuevos.</span></label>
  <input id="c-url" autocomplete="off" spellcheck="false" placeholder="https://algo.trycloudflare.com">
  <div class="nota hidden" id="aviso-url"></div>

  <div class="actions">
    <button id="paso2-ok">Guardar y seguir</button>
    <span id="paso2-state" class="pill hidden"></span>
  </div>

  <details>
    <summary>¿De dónde saco estos datos?</summary>
    <ol class="muted">
      <li>Entra a <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">developers.facebook.com/apps</a>
          y crea una app de tipo <b>Empresa</b>. Añádele el producto <b>WhatsApp</b>.</li>
      <li>El <b>ID de la app</b> y la <b>clave secreta</b> están en Configuración de la app &rarr; Básica.</li>
      <li>El <b>ID de la configuración</b> (registro incorporado <b>v4</b>): Facebook Login for Business &rarr;
          Configurations &rarr; Crear, variante <b>Embedded Signup</b>, y marca los productos: <b>Cloud API</b>
          y, si quieres que el número siga en el celular, <b>WhatsApp Business App onboarding</b>. Copia su ID.
          Una configuración creada antes (v2 o v3) deja de abrir la ventana el 15/10/2026: crea una nueva.</li>
      <li>Solo para el camino manual, el <b>token permanente</b>: Configuración del negocio &rarr;
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
    <button class="ghost hidden" id="desconectar" type="button" title="Cierra la sesión de WhatsApp en este sistema. Para volver, se escanea el QR otra vez.">Desconectar la cuenta</button>
    <span id="fb-state" class="pill hidden"></span>
  </div>
  <div id="desconectar-confirmar" class="hidden" style="margin-top:10px;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:var(--panel)">
    <p style="margin:0 0 10px"><b>¿Desconectar la cuenta de WhatsApp?</b><br>
    Se cierra la sesión de este sistema y el teléfono deja de verlo entre sus dispositivos vinculados. No se pierde nada de lo guardado aquí (chats, contactos, historial).
    Para volver a conectar, pulsa "Conectar y mostrar el QR" y escanea: al vincular, el teléfono manda lo reciente de <b>todos</b> los chats y el sistema trae solo lo anterior.</p>
    <div class="actions">
      <button id="desconectar-si" type="button">Sí, desconectar</button>
      <button class="ghost" id="desconectar-no" type="button">Cancelar</button>
    </div>
  </div>

  <div id="qr-box" class="hidden">
    <div class="qr-marco"><img id="qr-img" alt="Codigo QR de WhatsApp Web"></div>
    <p class="muted" id="qr-pasos">En el teléfono: WhatsApp &rarr; Ajustes &rarr; Dispositivos
    vinculados &rarr; Vincular un dispositivo. Apunta a este código.</p>
    <div class="pair">
      <p class="muted">Si no puedes apuntar con la cámara, <b>vincula con tu número</b>: WhatsApp te
      pide un código de ocho caracteres en vez del QR.</p>
      <div class="actions">
        <input id="pair-phone" inputmode="numeric" placeholder="51987654321" style="max-width:200px">
        <button class="ghost" id="pair-ask" type="button">Pedir código</button>
      </div>
      <div id="pair-code" class="codigo hidden"></div>
      <p class="muted hidden" id="pair-pasos">En el teléfono: WhatsApp &rarr; Ajustes &rarr;
      Dispositivos vinculados &rarr; Vincular un dispositivo &rarr; <b>Vincular con el número de
      teléfono</b>. Teclea ese código.</p>
    </div>

    <div class="actions">
      <button class="ghost" id="waha-logout" type="button">Desvincular el teléfono</button>
    </div>
  </div>

  <div id="choice" class="hidden" style="margin-top:18px">
    <h2 style="font-size:15px">Elige el número</h2>
    <p class="muted">Tu cuenta tiene varios.</p>
    <div id="choice-list"></div>
  </div>

  <div id="steps" class="hidden" style="margin-top:18px"></div>

  <div id="avisos-meta" class="hidden" style="margin-top:18px"></div>

  <div class="hidden" id="pin-box" style="margin-top:18px">
    <div class="nota"><b>Este número todavía no está activado.</b> Se activa con un PIN de seis
    digitos: el de la verificacion en dos pasos. Si no tenia ninguno, el que escribas queda como suyo.</div>
    <div class="actions">
      <input id="pin" inputmode="numeric" maxlength="6" placeholder="123456" style="max-width:150px">
      <button class="ghost" id="register">Activar número</button>
      <span id="reg-state" class="pill hidden"></span>
    </div>
  </div>
</section>

<section class="card locked" id="paso4">
  <h2><span class="num">4</span> Comprobar que funciona</h2>
  <p class="muted">Mándate un mensaje a ti mismo. Si te llega, está todo bien.</p>
  <label for="testPhone">Tu WhatsApp <span class="hint">Los nueve dígitos del celular; el +51 va solo.</span></label>
  <div class="tel"><span class="prefijo">+51</span><input id="testPhone" placeholder="987 654 321" inputmode="tel" autocomplete="tel-national" maxlength="14"></div>
  <div class="actions">
    <button id="sendTest">Enviar prueba</button>
    <a href="/chat"><button class="ghost" type="button">Ir al chat</button></a>
    <span id="test-state" class="pill hidden"></span>
  </div>
</section>

<details>
  <summary>Solo si te lo pide soporte: ver y editar todos los datos guardados</summary>
  <div class="card">
    <p class="muted">Lo secreto se muestra tapado. Deja un campo vacio para no cambiarlo.</p>
    ${avanzados}
    <div class="actions">
      <button id="save">Guardar</button>
      <button class="ghost" id="test">Probar</button>
      <span id="manual-state" class="pill hidden"></span>
    </div>

    <label>Dirección del aviso de mensajes nuevos (webhook)</label>
    <div class="copy"><input id="hookUrl" readonly><button class="ghost" data-copy="hookUrl">Copiar</button></div>
    <label>Palabra de verificacion</label>
    <div class="copy"><input id="hookToken" readonly><button class="ghost" data-copy="hookToken">Copiar</button></div>
  </div>
</details>

</div>
</div>`;

  const script = String.raw`
/* --- acceso ----------------------------------------------------------- */
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
  if (res.status === 401) {
    irAlLogin();
    throw new Error('Tu sesión terminó: vuelve a entrar.');
  }
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(data.error || errorHttp(res.status));
  return data;
}

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
    /* si la forma elegida esta en "Mas formas de conectar", que se vea */
    if (el.getAttribute('data-mode') === modo && el.closest('#mas-formas')) el.closest('#mas-formas').open = true;
  });
  done('paso1', true);
  pintarPaso2();
  pintarPaso3();

  var quiere = modo === 'waha' ? 'waha' : modo === 'local' ? 'local' : 'cloud';
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
      'Ya están guardados. Solo falta la dirección pública si la cambias.';
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
  waha.classList.toggle('hidden', !conQr());
  if (!conQr()) pararSondeo();

  if (conQr()) {
    waha.textContent = modo === 'local' ? 'Conectar y mostrar el QR' : 'Crear la sesión y mostrar el QR';
    lead.textContent = modo === 'local'
      ? 'Sale el codigo QR aqui mismo. Lo escaneas desde el telefono (WhatsApp, Dispositivos ' +
        'vinculados) y ya estas dentro. El telefono tiene que seguir con conexion a internet para ' +
        'que la sesión no se caiga.'
      : 'Se crea la sesión en tu contenedor de WAHA y aparece aquí el código QR. ' +
        'Lo escaneas desde el teléfono, igual que WhatsApp Web, y el teléfono tiene que seguir con ' +
        'conexión a internet para que la sesión no se caiga.';
    if (listo) sondearQr();
  } else if (modo === 'coexistence') {
    document.getElementById('fb-label').textContent = 'Conectar y ver el código QR';
    lead.textContent = 'Se abre la ventana de Meta. Entras con tu cuenta de Facebook, eliges tu ' +
      'número, y te enseña un código QR: escanéalo con la app de WhatsApp Business del teléfono. ' +
      'Meta te manda además un código de confirmación a ese mismo WhatsApp.';
  } else if (modo === 'dedicated') {
    document.getElementById('fb-label').textContent = 'Conectar con Facebook';
    lead.textContent = 'Se abre la ventana de Meta. Entras con tu cuenta, eliges o creas el número ' +
      'y vuelves aquí conectado.';
  } else if (modo === 'manual') {
    lead.textContent = 'Con el token guardado, el sistema busca tu cuenta, registra el webhook en ' +
      'Meta y comprueba que el número responde.';
  }

  if (listo && esMeta && !opciones.quick) {
    lock('paso3', true);
    show('fb-state', 'Falta ' + ((opciones.missingForQuick || []).join(' y ')), 'warn');
  }
  if (listo && esMeta && opciones.quick) cargarSdk();
}

/* --- paso 3, variantes con QR: local y WAHA ----------------------------- */

/**
 * Los dos caminos con QR hablan el mismo idioma (mismos estados, mismo QR en
 * base64), asi que la pantalla es una sola y lo unico que cambia es a quien
 * le pregunta.
 */
function conQr() { return modo === 'local' || modo === 'waha'; }
function prefijo() { return modo === 'local' ? '/admin/local' : '/admin/waha'; }

var sondeo = null;

function pararSondeo() {
  if (sondeo) { clearInterval(sondeo); sondeo = null; }
}

/**
 * WAHA tarda unos segundos en generar el QR y el QR caduca solo, asi que la
 * pantalla pregunta el estado cada 3 s y repinta. Se para en cuanto conecta.
 */
function sondearQr() {
  pararSondeo();
  void estadoQr();
  sondeo = setInterval(function () { void estadoQr(); }, 3000);
}

async function estadoQr() {
  var caja = document.getElementById('qr-box');
  try {
    var r = await api(prefijo() + '/status');

    if (!r.configured) { caja.classList.add('hidden'); return; }
    if (!r.ok) { show('fb-state', r.detail || 'WAHA no responde', 'bad'); return; }

    if (r.status === 'SCAN_QR_CODE' && r.qr) {
      document.getElementById('qr-img').src = 'data:image/png;base64,' + r.qr;
      caja.classList.remove('hidden');
      show('fb-state', 'Escanea el código', 'warn');
      return;
    }

    if (r.connected) {
      pararSondeo();
      caja.classList.add('hidden');
      document.getElementById('desconectar').classList.remove('hidden');
      show('fb-state', 'Conectado' + (r.phone ? ': ' + r.phone : ''), 'ok');
      done('paso3', true);
      load();
      return;
    }

    caja.classList.add('hidden');
    document.getElementById('desconectar').classList.add('hidden');
    document.getElementById('desconectar-confirmar').classList.add('hidden');
    // Nada de "STOPPED" a secas: se dice que pasa y que hay que hacer.
    if (r.status === 'STARTING') {
      show('fb-state', 'Abriendo la sesión... en unos segundos sale el código', 'warn');
    } else if (r.status === 'STOPPED') {
      // Parada es parada: no va a cambiar sola. Se deja de preguntar y se
      // explica que el boton de conectar saca un QR nuevo.
      pararSondeo();
      var texto = r.detail || 'Sin conectar.';
      if (texto.indexOf('Conectar') < 0) texto += ' Pulsa "Conectar y mostrar el QR".';
      show('fb-state', texto, 'warn');
    } else if (r.status === 'FAILED') {
      show('fb-state', (r.detail || 'Se cortó la conexión.') + ' Reintentando...', 'bad');
    } else {
      show('fb-state', r.detail || 'Esperando a WhatsApp...', 'warn');
    }
  } catch (error) {
    show('fb-state', error.message, 'bad');
  }
}

document.getElementById('waha-connect').onclick = async function () {
  var boton = this;
  boton.disabled = true;
  show('fb-state', modo === 'local' ? 'Abriendo la sesión... si la anterior ya no vale, se borra y sale un QR nuevo' : 'Creando la sesión en WAHA...', 'warn');
  try {
    await api(prefijo() + '/connect', { method: 'POST', body: modo === 'local' ? {} : {
      wahaUrl: val('f-wahaUrl') || undefined,
      publicUrl: val('c-url') || undefined
    }});
    sondearQr();
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
  if (!telefono) { show('fb-state', 'Escribe tu número con código de país', 'warn'); return; }

  boton.disabled = true;
  try {
    var r = await api(prefijo() + '/request-code', { method: 'POST', body: { phone: telefono } });
    var caja = document.getElementById('pair-code');
    // WAHA lo manda de corrido; partirlo por la mitad es como lo enseña la app.
    caja.textContent = r.code.length === 8 ? r.code.slice(0, 4) + ' ' + r.code.slice(4) : r.code;
    caja.classList.remove('hidden');
    document.getElementById('pair-pasos').classList.remove('hidden');
    show('fb-state', 'Teclea el código en el teléfono', 'warn');
  } catch (error) {
    show('fb-state', error.message, 'bad');
  } finally {
    boton.disabled = false;
  }
};

document.getElementById('desconectar').onclick = function () {
  document.getElementById('desconectar-confirmar').classList.remove('hidden');
};
document.getElementById('desconectar-no').onclick = function () {
  document.getElementById('desconectar-confirmar').classList.add('hidden');
};
document.getElementById('desconectar-si').onclick = async function () {
  var boton = this;
  boton.disabled = true;
  boton.textContent = 'Desconectando...';
  try {
    await api(prefijo() + '/logout', { method: 'POST', body: {} });
    document.getElementById('desconectar-confirmar').classList.add('hidden');
    document.getElementById('desconectar').classList.add('hidden');
    show('fb-state', 'Cuenta desconectada. Para volver a conectar, pulsa "Conectar y mostrar el QR" y escanea.', 'warn');
    pararSondeo();
    load();
  } catch (error) { show('fb-state', error.message, 'bad'); }
  finally { boton.disabled = false; boton.textContent = 'Sí, desconectar'; }
};

document.getElementById('waha-logout').onclick = async function () {
  try {
    await api(prefijo() + '/logout', { method: 'POST', body: {} });
    show('fb-state', 'Telefono desvinculado', 'warn');
    sondearQr();
  } catch (error) { show('fb-state', error.message, 'bad'); }
};

function cargarSdk() {
  if (modo === 'manual' || window.FB || !opciones.appId) return;
  window.fbAsyncInit = function () {
    FB.init({ appId: opciones.appId, cookie: true, xfbml: false, version: opciones.graphVersion || 'v25.0' });
  };
  var s = document.createElement('script');
  s.src = 'https://connect.facebook.net/es_LA/sdk.js';
  s.async = true;
  s.defer = true;
  s.crossOrigin = 'anonymous';
  document.head.appendChild(s);
}

/* La ventana manda por postMessage el id de la cuenta y el del numero.
   Registro incorporado v4: termina con FINISH (numero dedicado),
   FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING (el numero sigue en el celular:
   sin PIN) o FINISH_ONLY_WABA (no eligio numero); CANCEL dice en que
   pantalla se salio y ERROR trae el motivo. */
var elegido = { wabaId: null, phoneNumberId: null, coexistencia: false, sinNumero: false };
var PASOS_META = { PHONE_NUMBER_SETUP: 'la pantalla del número', BUSINESS_ACCOUNT_SELECTION: 'la elección de la cuenta', WABA_SELECTION: 'la elección de la cuenta de WhatsApp', PHONE_NUMBER_VERIFICATION: 'la verificacion del número' };
window.addEventListener('message', function (event) {
  var host;
  try { host = new URL(event.origin).hostname; } catch (error) { return; }
  if (!/facebook\.com$/.test(host)) return;
  try {
    var data = JSON.parse(event.data);
    if (data.type !== 'WA_EMBEDDED_SIGNUP') return;
    var d = data.data || {};
    if (data.event === 'FINISH' || data.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {
      elegido.wabaId = d.waba_id || null;
      elegido.phoneNumberId = d.phone_number_id || null;
      elegido.coexistencia = data.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING';
      elegido.sinNumero = false;
    } else if (data.event === 'FINISH_ONLY_WABA') {
      elegido.wabaId = d.waba_id || null;
      elegido.phoneNumberId = null;
      elegido.sinNumero = true;
    } else if (data.event === 'CANCEL') {
      show('fb-state', 'Cerraste la ventana de Meta en ' + (PASOS_META[d.current_step] || 'el paso ' + (d.current_step || '?')) + '. Vuelve a pulsar el boton para terminar.', 'warn');
    } else if (data.event === 'ERROR') {
      show('fb-state', 'Meta dio un error en su ventana: ' + (d.error_message || d.error_code || 'sin detalle') + '. Intentalo de nuevo; si sigue, revisa la configuracion (v4) en tu app de Meta.', 'bad');
    }
  } catch (error) { /* la ventana manda tambien mensajes que no son JSON */ }
});

document.getElementById('fb-login').onclick = function () {
  if (!window.FB) return show('fb-state', 'La ventana de Meta todavía está cargando, intenta en un segundo', 'warn');
  show('fb-state', 'Abriendo la ventana de Meta...', 'warn');

  var extras = (opciones.modes || {})[modo];
  FB.login(function (response) {
    var code = response && response.authResponse && response.authResponse.code;
    if (!code) return show('fb-state', 'Cerraste la ventana sin terminar', 'warn');
    if (elegido.sinNumero) return show('fb-state', 'La ventana termino sin elegir un numero (solo la cuenta). Vuelve a pulsar el boton y elige o crea el numero.', 'warn');
    terminarRapido(code);
  }, {
    config_id: opciones.signupConfigId,
    response_type: 'code',
    override_default_response_type: true,
    // v4: solo setup; el flujo lo decide la configuracion en Meta.
    extras: extras || { setup: {} }
  });
};

async function terminarRapido(code) {
  show('fb-state', 'Conectando...', 'warn');
  try {
    var r = await api('/admin/connect/signup', { method: 'POST', body: {
      code: code,
      wabaId: elegido.wabaId,
      phoneNumberId: elegido.phoneNumberId,
      coexistencia: elegido.coexistencia || modo === 'coexistence' || undefined,
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
      show('fb-state', 'Elige un número', 'warn');
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
    var digitos = val('testPhone').replace(/\D/g, '');
    if (digitos.length === 9) digitos = '51' + digitos;
    if (digitos.length !== 11 || digitos.indexOf('51') !== 0) { show('test-state', 'Escribe los nueve dígitos de tu celular (sin el +51).', 'warn'); boton.disabled = false; return; }
    var r = await api('/admin/settings/test-message', { method: 'POST', body: { phone: digitos } });
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
    show('manual-state', data.ok ? 'Conexión correcta' : data.detail, data.ok ? 'ok' : 'bad');
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

/* --- los avisos con fecha de Meta (solo con la API oficial) ---------------- */
function pintarAvisosMeta(avisos) {
  var caja = document.getElementById('avisos-meta');
  var esMeta = modo === 'coexistence' || modo === 'dedicated' || modo === 'manual' || guardado.provider === 'cloud';
  if (!avisos.length || !esMeta) { caja.classList.add('hidden'); caja.innerHTML = ''; return; }
  var COLOR = { vencido: 'var(--bad)', urgente: 'var(--warn, #b45309)', pendiente: 'var(--muted)', hecho: 'var(--ok)', ok: 'var(--ok)' };
  var ICONO = { vencido: '⛔', urgente: '⏰', pendiente: '📅', hecho: '✓', ok: '✓' };
  caja.innerHTML = '<h2 style="font-size:15px">Lo que Meta cambia con fecha</h2>' + avisos.map(function (a) {
    var cuando = a.estado === 'hecho' ? 'hecho el ' + new Date(a.hechoEl).toLocaleDateString('es-PE')
      : a.estado === 'ok' ? 'al día'
      : a.diasRestantes < 0 ? 'venció hace ' + (-a.diasRestantes) + ' días'
      : a.diasRestantes === 0 ? 'vence hoy' : 'quedan ' + a.diasRestantes + ' dias (hasta el ' + new Date(a.limite + 'T12:00:00').toLocaleDateString('es-PE') + ')';
    return '<div class="nota" style="border-left:4px solid ' + COLOR[a.estado] + ';margin-top:8px">' +
      '<b>' + ICONO[a.estado] + ' ' + esc(a.titulo) + '</b> <span class="muted">· ' + esc(cuando) + '</span>' +
      (a.estado === 'hecho' || a.estado === 'ok' ? '' : '<br><span class="muted">' + esc(a.detalle) + '</span>') +
      (a.marcable && a.estado !== 'hecho' ? '<div class="actions" style="margin-top:6px"><button class="ghost" type="button" data-aviso-hecho="' + esc(a.id) + '">Ya lo hice</button></div>' : '') +
      '</div>';
  }).join('');
  caja.classList.remove('hidden');
  caja.querySelectorAll('[data-aviso-hecho]').forEach(function (b) {
    b.onclick = async function () {
      var id = b.getAttribute('data-aviso-hecho');
      var meta = {};
      meta[id === 'metodoPago' ? 'metodoPagoEl' : 'registroV4El'] = new Date().toISOString();
      try {
        await api('/admin/ajustes', { method: 'POST', body: { meta: meta } });
        opciones = await api('/admin/connect/options');
        pintarAvisosMeta(opciones.avisosMeta || []);
      } catch (error) { show('fb-state', error.message, 'bad'); }
    };
  });
}

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
    pintarAvisosMeta(opciones.avisosMeta || []);

    // Con WAHA el tunel no hace falta: el contenedor suele correr en la misma
    // maquina y solo tiene que poder llegar a este servidor. Avisar de lo
    // contrario mandaria al usuario a montar algo que no necesita.
    var aviso = document.getElementById('aviso-url');
    if (!conQr() && !opciones.reachable && !/^https:\/\//.test(val('c-url'))) {
      aviso.innerHTML = '<b>Esta dirección es local: Meta no puede entrar.</b> Pídele a quien instaló el sistema una dirección pública ' +
        'y pégala aquí (o usa el QR, que no la necesita).';
      aviso.classList.remove('hidden');
    } else {
      aviso.classList.add('hidden');
    }

    // Sin eleccion previa, manda lo que ya este guardado en el servidor.
    if (!modo && guardado.provider === 'waha') modo = 'waha';
    if (!modo && guardado.provider === 'local') modo = 'local';

    if (modo) elegirModo(modo, false);
    else { pintarPaso2(); pintarPaso3(); }
  } catch (error) {
    show('state', error.message, 'bad');
  }
}

document.getElementById('app').classList.remove('hidden');
load();

/* ---------------------------------------------------------- GSG */
var perfilElegido = null;
var perfilAbierto = false;
function pintarPerfiles(r) {
  var caja = document.getElementById('perfil-lista');
  if (!caja) return;
  var actual = r.actual ? r.actual.perfil : null;
  perfilElegido = perfilElegido || actual || 'reparto';
  caja.innerHTML = (r.perfiles || []).map(function (p) {
    var es = p.id === perfilElegido;
    return '<label class="' + (es ? 'elegido' : '') + '"><input type="radio" name="perfil" value="' + esc(p.id) + '"' + (es ? ' checked' : '') + '><b>' + esc(p.nombre) + '</b><span class="muted" style="font-size:13px">' + esc(p.descripcion) + '</span><ul>' + p.cambia.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>' + (actual === p.id ? '<span class="actual">✓ En uso' + (r.actual && r.actual.en ? ' desde el ' + new Date(r.actual.en).toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' }) : '') + '</span>' : '') + '</label>';
  }).join('');
  caja.querySelectorAll('input[name=perfil]').forEach(function (i) {
    i.onchange = function () { perfilElegido = i.value; pintarPerfiles(r); };
  });
  var boton = document.getElementById('perfil-aplicar');
  if (boton) boton.textContent = actual === perfilElegido ? 'Volver a aplicar este perfil' : 'Aplicar este perfil';
  var sec = document.getElementById('perfil');
  var resumen = document.getElementById('perfil-resumen-texto');
  if (sec && resumen) {
    var nombreActual = '';
    (r.perfiles || []).forEach(function (p) { if (p.id === actual) nombreActual = p.nombre; });
    if (actual && nombreActual && !perfilAbierto) {
      resumen.textContent = '✓ Perfil en uso: ' + nombreActual + (r.actual && r.actual.en ? ' (desde el ' + new Date(r.actual.en).toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' }) + ')' : '');
      sec.classList.add('plegado');
    } else {
      sec.classList.remove('plegado');
    }
  }
}
async function cargarPerfil() {
  try { var r = await api('/admin/perfil'); pintarPerfiles(r); } catch (e) { /* sin perfiles en este arranque */ }
}
var perfilCambiar = document.getElementById('perfil-cambiar');
if (perfilCambiar) perfilCambiar.onclick = function () { perfilAbierto = true; var sec = document.getElementById('perfil'); if (sec) sec.classList.remove('plegado'); };
document.getElementById('perfil-aplicar').onclick = async function () {
  if (!perfilElegido) return;
  var ok = await confirmarDialogo({ titulo: 'Aplicar el perfil', texto: 'Se cambian el menú, qué contesta solo y los interruptores de las entregas según el perfil elegido. Tus textos, tus clientes y tus motorizados no se tocan. Puedes volver a cambiarlo cuando quieras.', boton: 'Aplicar' });
  if (!ok) return;
  try {
    var r = await api('/admin/perfil', { method: 'POST', body: { perfil: perfilElegido } });
    show('perfil-state', r.detalle + ' La pantalla se recarga para enseñar el menú que toca.', 'ok');
    setTimeout(function () { location.reload(); }, 1800);
  } catch (e) { show('perfil-state', e.message, 'bad'); }
};

async function cargarGsg() {
  var caja = document.getElementById('gsg-estado');
  if (!caja) return;
  try {
    var r = await api('/admin/entregas/gsg');
    var g = r.gsg;
    if (!g) { caja.textContent = 'La conexión con GSG se fija al arrancar el servidor.'; return; }
    var color = g.modo === 'ninguna' ? 'var(--rojo)' : g.modo === 'simulador' ? 'var(--azul)' : 'var(--verde)';
    caja.innerHTML = '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + color + ';margin-right:6px"></span>' + esc(g.descripcion) + (g.url && g.modo === 'real' ? ' <span class="muted">(' + esc(g.url) + ')</span>' : '') + (g.ultimaPrueba ? '<br><span class="muted">Última prueba: ' + esc(g.ultimaPrueba.detalle) + '</span>' : '');
    document.getElementById('gsg-simulador').classList.toggle('hidden', g.modo === 'simulador' || !r.simulador);
    document.getElementById('gsg-quitar').classList.toggle('hidden', g.modo === 'ninguna');
  } catch (error) { caja.textContent = error.message; }
}
cargarPerfil();
if (document.getElementById('gsg')) {
  document.getElementById('gsg-probar').onclick = async function () {
    try { var r = await api('/admin/entregas/gsg/probar', { method: 'POST', body: {} }); show('gsg-state', r.prueba.detalle, r.ok ? 'ok' : 'bad'); cargarGsg(); } catch (error) { show('gsg-state', error.message, 'bad'); }
  };
  document.getElementById('gsg-simulador').onclick = async function () {
    try { await api('/admin/entregas/gsg', { method: 'POST', body: { modo: 'simulador' } }); show('gsg-state', 'Ahora GSG es el simulador de este servidor. Cárgalo desde Hoy → Probar con números ficticios.', 'ok'); cargarGsg(); } catch (error) { show('gsg-state', error.message, 'bad'); }
  };
  document.getElementById('gsg-real').onclick = async function () {
    try {
      var url = await pedirDato({ titulo: 'API real de GSG', texto: 'La dirección base de la API de GSG (la que tiene /reparto/pendientes, /ubicaciones, /confirmaciones y /entregas).', etiqueta: 'Dirección', marcador: 'https://api.gsg.pe/v1', boton: 'Siguiente' });
      if (!url) return;
      var token = await pedirDato({ titulo: 'API real de GSG', etiqueta: 'Token (se guarda cifrado)', marcador: 'el token que te dieron', boton: 'Conectar', validar: function () { return null; } });
      if (token === null) return;
      await api('/admin/entregas/gsg', { method: 'POST', body: { modo: 'real', url: url, token: token || undefined } });
      show('gsg-state', 'Conectado. Pulsa «Probar» para comprobarlo.', 'ok');
      cargarGsg();
    } catch (error) { show('gsg-state', error.message, 'bad'); }
  };
  document.getElementById('gsg-api-url').value = location.origin + '/api/v1/entregas';
  document.getElementById('gsg-api-copiar').onclick = function () {
    navigator.clipboard.writeText(document.getElementById('gsg-api-url').value).then(function () { show('gsg-clave-state', 'Dirección copiada', 'ok'); });
  };
  document.getElementById('gsg-clave').onclick = async function () {
    if (!(await confirmarDialogo({ titulo: 'Crear la clave para GSG', texto: 'Se crea una clave de API llamada "GSG" con permiso para mandar y ver las entregas del día y registrar webhooks. Si ya había una clave "GSG", sigue valiendo: revócala en Conectar mi web y tienda → Claves de API si quieres que solo valga la nueva.', boton: 'Crear la clave' }))) return;
    try {
      var r = await api('/admin/claves-api', { method: 'POST', body: { nombre: 'GSG', permisos: ['entregas:gestionar', 'entregas:leer', 'webhooks:gestionar'] } });
      document.getElementById('gsg-clave-valor').textContent = r.clave;
      document.getElementById('gsg-clave-pasos').innerHTML = [
        'Dásela a los programadores de GSG junto con esta dirección: ' + location.origin + '/api/v1/entregas',
        'Cada pedido nuevo lo mandan con POST y la cabecera Authorization: Bearer <la clave> (uno, una lista o {pedidos: [...]}).',
        'Para enterarse de lo que pasa, registran un webhook con POST ' + location.origin + '/api/v1/webhooks (eventos entrega.confirmada, entrega.avisada, entrega.entregada, entrega.incidencia).',
        'Pueden probar contra el simulador de este servidor antes de tocar nada real: está explicado en el contrato (abajo, en "Para los programadores de GSG").',
      ].map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('');
      document.getElementById('gsg-clave-nueva').classList.remove('hidden');
      show('gsg-clave-state', 'Clave creada.', 'ok');
    } catch (error) { show('gsg-clave-state', error.message, 'bad'); }
  };
  document.getElementById('gsg-clave-copiar').onclick = function () {
    navigator.clipboard.writeText(document.getElementById('gsg-clave-valor').textContent).then(function () { show('gsg-clave-state', 'Clave copiada', 'ok'); });
  };
  document.getElementById('gsg-quitar').onclick = async function () {
    var ok = await confirmarDialogo({ titulo: 'Desconectar GSG', texto: 'Lo reportable se guarda en la cola y saldrá entero cuando se vuelva a conectar.', boton: 'Desconectar', peligro: true });
    if (!ok) return;
    try { await api('/admin/entregas/gsg', { method: 'DELETE' }); show('gsg-state', 'Desconectado.', 'ok'); cargarGsg(); } catch (error) { show('gsg-state', error.message, 'bad'); }
  };
  var HALLAZGO = { ok: ['ok', 'bien'], falta: ['bad', 'falta'], formato: ['bad', 'formato'], sobra: ['warn', 'sobra'], aviso: ['warn', 'aviso'] };
  function pintarHallazgos(v) {
    var caja = document.getElementById('gsg-verificacion');
    if (!v) { caja.classList.add('hidden'); return; }
    var filas = (v.hallazgos || []).filter(function (h) { return h.tipo !== 'ok'; });
    var html = '<div><span class="pill ' + (v.ok ? 'ok' : 'bad') + '">' + esc(v.resumen) + '</span> <span class="muted" style="font-size:12px">' + esc(hora(v.at)) + '</span></div>';
    if (filas.length) {
      html += '<ul style="margin:6px 0 0;padding-left:20px;font-size:13.5px">' + filas.map(function (h) {
        var t = HALLAZGO[h.tipo] || ['warn', h.tipo];
        return '<li><span class="pill ' + t[0] + '" style="margin-right:6px">' + esc(t[1]) + '</span><b>' + esc(h.donde) + '</b>: ' + esc(h.detalle) + '</li>';
      }).join('') + '</ul>';
    } else if (v.ok) {
      html += '<p class="muted" style="margin:4px 0 0;font-size:13px">Todas las listas y todos los pedidos vienen como este sistema los espera.</p>';
    }
    caja.innerHTML = html; caja.classList.remove('hidden');
  }
  function pintarCuadre(c) {
    var caja = document.getElementById('gsg-cuadre');
    if (!c) { caja.classList.add('hidden'); return; }
    var html = '<div><span class="pill ' + (c.ok ? 'ok' : 'warn') + '">' + esc(c.resumen) + '</span> <span class="muted" style="font-size:12px">' + esc(c.dia) + ' · ' + esc(hora(c.at)) + '</span></div>';
    if (c.faltanEnGsg && c.faltanEnGsg.length) html += '<p style="margin:6px 0 0;font-size:13.5px"><b>Cerrados aquí que GSG no tiene como terminados:</b> ' + esc(c.faltanEnGsg.join(', ')) + '. Suele ser que el reporte a GSG no salió: mira «reportes que GSG no aceptó» en Hoy y pulsa Reintentar.</p>';
    if (c.sobranEnGsg && c.sobranEnGsg.length) html += '<p style="margin:6px 0 0;font-size:13.5px"><b>Terminados en GSG que aquí siguen abiertos:</b> ' + esc(c.sobranEnGsg.join(', ')) + '. Revísalos en Hoy: si ya se entregaron, márcalos «Entregada».</p>';
    caja.innerHTML = html; caja.classList.remove('hidden');
  }
  function hora(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '' : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function pintarExtras(r) {
    var d = r.descartes || { lista: [] };
    var caja = document.getElementById('gsg-descartes');
    if (d.lista && d.lista.length) {
      document.getElementById('gsg-descartes-titulo').textContent = d.lista.length + (d.lista.length === 1 ? ' pedido de hoy no se pudo leer' : ' pedidos de hoy no se pudieron leer');
      document.getElementById('gsg-descartes-lista').innerHTML = d.lista.map(function (x) {
        return '<li><b>' + esc(x.referencia) + '</b> (' + esc(x.lista === 'faltaUbicacion' ? 'lista de ubicación' : 'lista de confirmación') + '): ' + esc(x.motivo) + '</li>';
      }).join('');
      caja.classList.remove('hidden');
    } else caja.classList.add('hidden');
    pintarHallazgos(r.verificacion);
    pintarCuadre(r.cuadre);
    var sim = document.getElementById('gsg-sim');
    sim.classList.toggle('hidden', !r.conSimulador);
    if (r.conSimulador) {
      document.getElementById('gsg-sim-url').value = location.origin + r.rutaSimulador;
      var lista = document.getElementById('gsg-sim-lista');
      var tokens = r.tokens || [];
      lista.innerHTML = tokens.length ? tokens.map(function (t) {
        var estado = t.estado === 'vigente' ? '<span class="pill ok">vigente</span>' : t.estado === 'caducado' ? '<span class="pill warn">caducado</span>' : '<span class="pill bad">anulado</span>';
        var caduca = new Date(t.caducaAt);
        return '<li>' + estado + ' <b>' + esc(t.nombre) + '</b> (…' + esc(t.pista) + ') · caduca el ' + esc(isNaN(caduca.getTime()) ? '' : caduca.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })) + ' · ' + t.usos + ' llamada' + (t.usos === 1 ? '' : 's') + (t.ultimoUsoAt ? ', la última a las ' + esc(hora(t.ultimoUsoAt)) : '') + (t.estado === 'vigente' ? ' <a href="#" data-anular="' + esc(t.id) + '">Anular</a>' : '') + '</li>';
      }).join('') : '<li class="muted">Todavía no hay tokens: crea uno y pásaselo a los programadores de GSG.</li>';
      lista.querySelectorAll('[data-anular]').forEach(function (a) {
        a.onclick = async function (ev) {
          ev.preventDefault();
          if (!(await confirmarDialogo({ titulo: 'Anular el token', texto: 'Desde ahora ese token no vale: quien lo use recibirá "token caducado o anulado". Se puede crear otro.', boton: 'Anular', peligro: true }))) return;
          try { await api('/admin/gsg/tokens-simulador/' + a.getAttribute('data-anular'), { method: 'DELETE' }); show('gsg-sim-state', 'Token anulado.', 'ok'); cargarExtras(); } catch (error) { show('gsg-sim-state', error.message, 'bad'); }
        };
      });
    }
    var b = document.getElementById('gsg-bitacora');
    var llamadas = r.bitacora || [];
    b.innerHTML = llamadas.length ? '<table style="width:100%;border-collapse:collapse;font-size:12.5px"><thead><tr><th style="text-align:left;padding:4px 6px">Hora</th><th style="text-align:left;padding:4px 6px">Llamada</th><th style="text-align:left;padding:4px 6px">Con qué entró</th><th style="text-align:left;padding:4px 6px">Qué pasó</th></tr></thead><tbody>' + llamadas.map(function (l) {
      var mal = l.status >= 400;
      return '<tr><td style="padding:4px 6px;white-space:nowrap">' + esc(hora(l.en)) + '</td><td style="padding:4px 6px;font-family:ui-monospace,Consolas,monospace">' + esc(l.que) + '</td><td style="padding:4px 6px">' + esc(l.quien) + '</td><td style="padding:4px 6px"><span class="pill ' + (mal ? 'bad' : 'ok') + '">' + l.status + '</span> ' + esc(l.resultado) + '</td></tr>';
    }).join('') + '</tbody></table>' : 'Todavía nadie ha llamado. Cuando GSG (o sus programadores, con el token del simulador) manden algo, aquí se verá qué llegó y qué se les contestó.';
  }
  async function cargarExtras() {
    try { pintarExtras(await api('/admin/gsg')); } catch (error) { show('gsg-state', error.message, 'bad'); }
  }
  document.getElementById('gsg-verificar').onclick = async function () {
    show('gsg-verificar-state', 'Preguntando a GSG…', 'warn');
    try { var r = await api('/admin/gsg/verificar-contrato', { method: 'POST', body: {} }); pintarHallazgos(r.verificacion); show('gsg-verificar-state', r.ok ? 'El contrato se cumple.' : 'Hay cosas que corregir (abajo).', r.ok ? 'ok' : 'bad'); } catch (error) { show('gsg-verificar-state', error.message, 'bad'); }
  };
  document.getElementById('gsg-cuadrar').onclick = async function () {
    show('gsg-verificar-state', 'Cuadrando…', 'warn');
    try { var r = await api('/admin/gsg/cuadre'); pintarCuadre(r.cuadre); show('gsg-verificar-state', r.cuadre.ok ? 'El día cuadra.' : 'Hay diferencias (abajo).', r.cuadre.ok ? 'ok' : 'warn'); } catch (error) { show('gsg-verificar-state', error.message, 'bad'); }
  };
  document.getElementById('gsg-sim-url-copiar').onclick = function () {
    navigator.clipboard.writeText(document.getElementById('gsg-sim-url').value).then(function () { show('gsg-sim-state', 'Dirección copiada', 'ok'); });
  };
  document.getElementById('gsg-sim-token').onclick = async function () {
    try {
      var nombre = await pedirDato({ titulo: 'Token del simulador', texto: 'Un nombre para reconocerlo en la lista (por ejemplo, el del programador o el equipo de GSG). Caduca a los 30 días; después se crea otro.', etiqueta: 'Para quién es', marcador: 'Programadores de GSG', boton: 'Crear el token', validar: function () { return null; } });
      if (nombre === null) return;
      var r = await api('/admin/gsg/tokens-simulador', { method: 'POST', body: { nombre: nombre || undefined, dias: 30 } });
      document.getElementById('gsg-sim-valor').textContent = r.token;
      document.getElementById('gsg-sim-nuevo').classList.remove('hidden');
      show('gsg-sim-state', 'Token creado: caduca en 30 días.', 'ok');
      cargarExtras();
    } catch (error) { show('gsg-sim-state', error.message, 'bad'); }
  };
  document.getElementById('gsg-sim-copiar').onclick = function () {
    navigator.clipboard.writeText(document.getElementById('gsg-sim-valor').textContent).then(function () { show('gsg-sim-state', 'Token copiado', 'ok'); });
  };
  document.getElementById('gsg-bitacora-refrescar').onclick = function (ev) { ev.preventDefault(); cargarExtras(); };
  document.getElementById('gsg-sim-cancelar').onclick = async function () {
    try { var r = await api('/admin/gsg/simulador/cancelar-uno', { method: 'POST', body: {} }); show('gsg-sim-prueba-state', r.detalle, 'ok'); cargarExtras(); } catch (error) { show('gsg-sim-prueba-state', error.message, 'bad'); }
  };
  document.getElementById('gsg-sim-cambiar').onclick = async function () {
    try { var r = await api('/admin/gsg/simulador/cambiar-uno', { method: 'POST', body: {} }); show('gsg-sim-prueba-state', r.detalle, 'ok'); cargarExtras(); } catch (error) { show('gsg-sim-prueba-state', error.message, 'bad'); }
  };
  cargarGsg();
  cargarExtras();
}
`;

  return appShell({
    titulo: opts.conGsg ? 'Conexión' : 'Conexión de WhatsApp',
    subtitulo: opts.conGsg ? 'El WhatsApp (QR, WAHA o la API de Meta) y el sistema de GSG' : 'QR, WAHA o la API oficial de Meta',
    contenido,
    script,
    css: CSS,
    nombreNegocio: opts.nombreNegocio,
    demo: opts.demo,
    icono: '🔌',
  });
}
