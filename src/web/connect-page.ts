/**
 * Pantalla de conexion (/setup): un asistente de cuatro pasos.
 *
 * La pantalla anterior enseñaba todo a la vez (dos caminos, ocho campos, el
 * PIN y dos desplegables) y obligaba a decidir sin saber que se decidia. Aqui
 * solo se trabaja en el paso en el que estas; los siguientes quedan bloqueados
 * y dicen por que.
 *
 * El paso 1 es la unica decision de verdad, y no va de tecnologia sino de algo
 * que el usuario si sabe contestar: si quiere seguir usando WhatsApp en el
 * movil o no. De esa respuesta salen los cinco caminos de `MODOS`.
 *
 * En que paso estas lo decide UNA funcion, `pasoActual()`, y lo pinta UNA
 * funcion, `pintar()`. Todo lo demas (elegir modo, guardar, conectar, sondear
 * el QR) termina llamando a `pintar()`: no hay dos sitios que decidan lo mismo.
 *
 * Lo que sigue sin existir es un QR para el WhatsApp verde de consumidor por
 * la via oficial: eso obliga a emular WhatsApp Web, esta fuera de los terminos
 * y acaba con el numero baneado. Por eso los caminos `local` y `waha` avisan.
 */

import { appShell, modoVigente } from './shell.js';

/* ------------------------------------------------------------------ modos */

type Modo = 'local' | 'coexistence' | 'dedicated' | 'manual' | 'waha';

interface InfoModo {
  titulo: string;
  /** Distintivo corto al lado del titulo. */
  etiqueta?: string;
  /** La etiqueta en ambar avisa de que ese camino no es oficial. */
  riesgo?: boolean;
  /** Una linea: que es este camino. Nada de repetir el aviso comun. */
  resumen: string;
  /** Via oficial de Meta (cambia el aviso del paso 1 y los avisos con fecha). */
  oficial: boolean;
  /** Que se hace en el paso 2, en una frase. */
  paso2: string;
  /** Que va a pasar en el paso 3, en una frase. */
  paso3: string;
  /** Nombre del boton del paso 3. */
  boton: string;
  /** Va dentro de «Mas formas de conectar» cuando el menu esta en modo GSG. */
  avanzado?: boolean;
  /**
   * Solo para probar sin cuenta de Meta: va dentro de «Solo para pruebas».
   * Lo de verdad es la API oficial; el QR emula WhatsApp Web y el numero
   * puede acabar bloqueado.
   */
  pruebas?: boolean;
}

/**
 * Los cinco caminos, cada uno descrito en un solo sitio: de aqui salen las
 * opciones del paso 1 (HTML) y los textos de los pasos 2 y 3 (JS).
 */
const MODOS: Record<Modo, InfoModo> = {
  local: {
    titulo: 'Escanear el QR y ya',
    etiqueta: 'para pruebas',
    pruebas: true,
    resumen:
      'Sin cuenta de Meta y sin instalar nada: el código sale aquí mismo y sirve con cualquier WhatsApp, también el verde.',
    oficial: false,
    paso2: 'Este camino no pide ningún dato: la vinculación es el propio código QR.',
    paso3:
      'Pulsa el botón y sale el código. Escanéalo desde el teléfono (WhatsApp → Dispositivos vinculados). El teléfono tiene que quedarse con internet.',
    boton: 'Mostrar el código QR',
  },
  coexistence: {
    titulo: 'Sí, uso WhatsApp Business en mi teléfono',
    etiqueta: 'recomendado',
    resumen:
      'Meta te enseña un QR, lo escaneas con la app y el número sigue funcionando en el móvil además de por la API.',
    oficial: true,
    paso2: 'Cópialos de tu app de Meta. Se guardan cifrados y no se vuelven a pedir.',
    paso3:
      'Se abre la ventana de Meta: entras con tu cuenta de Facebook, eliges tu número y te enseña un QR para escanear con WhatsApp Business.',
    boton: 'Conectar y ver el código QR',
  },
  dedicated: {
    titulo: 'No, quiero un número nuevo solo para el sistema',
    resumen:
      'Ese número deja de funcionar en la app del teléfono. Meta regala uno de prueba para empezar sin arriesgar el tuyo.',
    oficial: true,
    paso2: 'Cópialos de tu app de Meta. Se guardan cifrados y no se vuelven a pedir.',
    paso3: 'Se abre la ventana de Meta: entras con tu cuenta, eliges o creas el número y vuelves aquí conectado.',
    boton: 'Conectar con Facebook',
    avanzado: true,
  },
  manual: {
    titulo: 'Ya tengo un token de Meta y prefiero pegarlo',
    resumen: 'Para quien ya montó el usuario del sistema en Meta. Sin ventana ni QR.',
    oficial: true,
    paso2: 'Pega el token y los datos de tu app. Se guardan cifrados.',
    paso3: 'El sistema busca tu cuenta, registra el webhook en Meta y comprueba que el número responde.',
    boton: 'Conectar',
    avanzado: true,
  },
  waha: {
    titulo: 'Conectar con WAHA',
    etiqueta: 'para pruebas',
    riesgo: true,
    pruebas: true,
    resumen:
      'El QR de WhatsApp Web desde un contenedor de WAHA que corre en tu servidor. Sirve con cualquier WhatsApp y no necesita app de Meta.',
    oficial: false,
    paso2: 'No hace falta nada: el sistema levanta su propio WAHA con Docker. Si ya tienes uno en otro servidor, pulsa Cambiar y pon su dirección.',
    paso3: 'Se crea la sesión en tu contenedor y aparece aquí el QR. El teléfono tiene que quedarse con internet.',
    boton: 'Crear la sesión y mostrar el QR',
  },
};

/** El orden en el que se ofrecen: primero la API oficial, que es la que se usa. */
const ORDEN_MODOS: Modo[] = ['coexistence', 'dedicated', 'manual', 'local', 'waha'];

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
const CAMPOS_POR_MODO: Record<Modo, readonly string[]> = {
  coexistence: ['appId', 'appSecret', 'signupConfigId'],
  dedicated: ['appId', 'appSecret', 'signupConfigId'],
  manual: ['token', 'appId', 'appSecret'],
  // WAHA no tiene app de Meta. La direccion es opcional (CAMPOS_OPCIONALES):
  // si se deja vacia, el sistema busca el contenedor o levanta el suyo.
  waha: ['wahaUrl'],
  // El camino corto no pide nada: la vinculacion ES el QR.
  local: [],
};

/** Se pueden cambiar en el paso 2, pero no hace falta rellenarlos para seguir. */
const CAMPOS_OPCIONALES: readonly string[] = ['wahaUrl'];

/** Que necesita el paso 2 de cada campo. La pista es una linea: el detalle
 *  vive una sola vez, en el desplegable «¿De dónde saco estos datos?». */
const AYUDA_CAMPO: Record<string, { titulo: string; pista: string; ph: string }> = {
  token: { titulo: 'Token permanente', pista: 'Es largo y empieza por EAA.', ph: 'EAAG...' },
  appId: { titulo: 'ID de la app', pista: 'Solo números.', ph: '1234567890123456' },
  appSecret: { titulo: 'Clave secreta de la app', pista: 'Al lado del ID, en la misma pantalla de Meta.', ph: 'a1b2c3...' },
  signupConfigId: {
    titulo: 'ID de la configuración de registro incorporado',
    pista: 'Tiene que ser una configuración v4: las v2 y v3 dejan de abrir la ventana el 15/10/2026.',
    ph: '9876543210987654',
  },
  wahaUrl: {
    titulo: 'Dirección del contenedor de WAHA (opcional)',
    pista: 'Déjala vacía y el sistema levanta su propio WAHA. Solo hace falta si ya tienes uno en otro servidor.',
    ph: 'http://localhost:3001',
  },
};

/* -------------------------------------------------------------------- css */

/**
 * Solo lo propio de esta pantalla: los botones son `.btn` del armazon, las
 * tarjetas `.tarjeta` y los estados `.chip.tono-*`. Nada de colores a pelo
 * (rompen el modo oscuro) salvo el azul de Facebook, que es marca y se
 * declara como variable para que se vea de donde sale.
 */
const CSS = `
  .wrap { --fb: #1877f2; max-width: 820px; color: var(--texto); font: var(--fs-cuerpo)/1.55 var(--fuente); }
  .wrap * { box-sizing: border-box; }
  .wrap h2 { font-size: var(--fs-h2); margin: 0; display: flex; align-items: center; gap: var(--esp-2); letter-spacing: -.01em; }
  .wrap h3 { font-size: var(--fs-h3); margin: 0 0 var(--esp-2); }
  .wrap p { margin: 0; }
  .wrap a { color: var(--primario); }
  .wrap ol, .wrap ul { padding-left: 20px; margin: var(--esp-2) 0 0; }
  .wrap li { margin-bottom: 6px; }
  .wrap code { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; background: var(--superficie-2); padding: 1px 6px; border-radius: var(--radio-sm); overflow-wrap: anywhere; }
  .ayuda { color: var(--texto-suave); font-size: var(--fs-small); }
  .wrap details { margin-top: var(--esp-3); }
  .wrap summary { cursor: pointer; font-size: var(--fs-cuerpo); font-weight: 600; color: var(--texto-suave); padding: 8px 0; min-height: 36px; }

  /* Progreso: en que paso estas y cuanto falta, sin leer nada. */
  .progreso { display: flex; flex-wrap: wrap; gap: var(--esp-2); list-style: none; margin: 0 0 var(--esp-2); padding: 0; }
  .progreso li { display: flex; align-items: center; gap: 6px; font-size: var(--fs-small); font-weight: 600; color: var(--texto-suave); }
  .progreso li::after { content: ''; width: 16px; height: 1px; background: var(--borde); margin-left: 2px; }
  .progreso li:last-child::after { display: none; }
  .progreso .n { flex: none; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: var(--superficie-2); font-size: 12px; }
  .progreso .actual { color: var(--primario); }
  .progreso .actual .n { background: var(--primario); color: var(--primario-texto); }
  .progreso .hecho .n { background: var(--verde-suave); color: var(--verde); }
  @media (max-width: 520px) { .progreso .t { display: none; } }

  /* Cada paso es una .tarjeta del armazon: aqui solo el numero y el bloqueo. */
  .paso { margin-top: var(--esp-4); padding: var(--esp-5); }
  @media (max-width: 640px) { .paso { padding: var(--esp-4) var(--esp-3); } }
  .paso .num { flex: none; width: 26px; height: 26px; border-radius: 50%; background: var(--primario); color: var(--primario-texto); font-size: 13px; display: grid; place-items: center; font-weight: 700; }
  .paso.hecho .num { background: var(--verde); color: var(--superficie); }
  .paso.bloqueado .num { background: var(--gris-suave); color: var(--texto-suave); }
  /* El motivo del bloqueo queda fuera del cuerpo apagado: si no, el usuario
     no puede leer por que no puede hacer nada. */
  .paso.bloqueado .cuerpo { opacity: .45; pointer-events: none; user-select: none; }
  .paso .motivo { margin-top: var(--esp-2); font-size: var(--fs-small); color: var(--ambar); font-weight: 600; }
  .cuerpo { margin-top: var(--esp-3); }

  /* Paso 1: radios de verdad, que se recorren con el teclado. */
  .opcion { display: flex; gap: 10px; align-items: flex-start; border: 1.5px solid var(--borde); border-radius: var(--radio); padding: 12px 14px; margin-top: var(--esp-2); cursor: pointer; background: var(--superficie); }
  .opcion:hover { border-color: var(--primario); }
  .opcion:focus-within { border-color: var(--primario); outline: 2px solid var(--primario-suave); }
  .opcion.elegida { border-color: var(--primario); background: var(--primario-suave); }
  .opcion input { flex: none; width: 20px; height: 20px; min-height: 20px; margin: 2px 0 0; accent-color: var(--primario); }
  .opcion .txt { flex: 1; min-width: 0; }
  .opcion .txt > span { display: block; font-size: var(--fs-small); color: var(--texto-suave); margin-top: 3px; }
  .etiqueta { display: inline-block; margin-left: 6px; font-size: 11.5px; font-weight: 700; color: var(--primario); background: var(--primario-suave); padding: 2px 8px; border-radius: 999px; vertical-align: middle; }
  .etiqueta.riesgo { color: var(--ambar); background: var(--ambar-suave); }

  /* Formularios. */
  .campo { display: block; font-size: 13px; font-weight: 600; margin: var(--esp-4) 0 var(--esp-1); }
  .campo .hint { display: block; font-weight: 400; color: var(--texto-suave); font-size: var(--fs-small); margin-top: 2px; }
  .wrap input:not([type=radio]) { width: 100%; padding: 10px 12px; font: inherit; font-size: 14px; color: var(--texto); background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio-sm); min-height: 42px; }
  .wrap input:focus-visible { border-color: var(--primario); }
  .acciones { display: flex; gap: var(--esp-2); align-items: center; margin-top: var(--esp-4); flex-wrap: wrap; }
  .corto { max-width: 220px; }
  .tel { display: flex; align-items: stretch; max-width: 280px; }
  .tel .prefijo { display: inline-flex; align-items: center; padding: 0 12px; border: 1px solid var(--borde); border-right: 0; border-radius: var(--radio-sm) 0 0 var(--radio-sm); background: var(--superficie-2); color: var(--texto-suave); }
  .tel input { border-radius: 0 var(--radio-sm) var(--radio-sm) 0; }
  .copiar { display: flex; gap: var(--esp-2); margin-top: var(--esp-1); flex-wrap: wrap; }
  .copiar input { flex: 1 1 200px; min-width: 0; font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; }

  .btn.facebook { background: var(--fb); border-color: var(--fb); color: #fff; }
  .btn.facebook:hover { color: #fff; filter: brightness(1.06); }

  /* Avisos y resultados. */
  .nota { background: var(--superficie-2); border-left: 3px solid var(--primario); border-radius: 0 var(--radio-sm) var(--radio-sm) 0; padding: 12px 14px; margin-top: var(--esp-3); font-size: 13.5px; color: var(--texto-suave); }
  .nota b { color: var(--texto); }
  .nota.riesgo { border-left-color: var(--ambar); }
  .paso-resultado { display: flex; gap: 10px; align-items: flex-start; padding: 9px 0; border-bottom: 1px solid var(--borde); }
  .paso-resultado:last-child { border-bottom: 0; }
  .paso-resultado b { display: block; font-size: 14px; }
  .paso-resultado span { font-size: 13px; color: var(--texto-suave); }
  .paso-resultado .marca { font-size: 15px; line-height: 1.4; }
  .paso-resultado .marca.si { color: var(--verde); }
  .paso-resultado .marca.no { color: var(--rojo); }

  /* El QR va sobre blanco siempre: en oscuro, un QR invertido no se escanea. */
  .qr-marco { display: inline-block; background: #fff; padding: 14px; border-radius: var(--radio); margin-top: var(--esp-3); border: 1px solid var(--borde); }
  .qr-marco img { display: block; width: 256px; height: 256px; image-rendering: pixelated; max-width: 100%; }
  /* El codigo de vinculacion se teclea mirando la pantalla: grande y partido
     en dos mitades, que es como lo pide la app del telefono. */
  .codigo { font-family: ui-monospace, Consolas, monospace; font-size: 30px; letter-spacing: 6px; font-weight: 700; margin: var(--esp-3) 0 var(--esp-1); }

  /* El estado de la conexion en la barra de arriba no puede empujar el titulo. */
  .s-top #state { max-width: 150px; overflow: hidden; text-overflow: ellipsis; }

  /* --- GSG y perfiles ---------------------------------------------------- */
  .bloque { margin-top: var(--esp-4); padding-top: var(--esp-3); border-top: 1px solid var(--borde); }
  .bloque.punteado { border-top-style: dashed; }
  .acciones.pegada { margin-top: 0; }
  .ayuda.separada { margin-top: var(--esp-2); }
  .perfiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--esp-2); }
  .perfiles label { display: block; border: 1px solid var(--borde); border-radius: var(--radio-sm); padding: 10px 12px; cursor: pointer; background: var(--superficie); }
  .perfiles label.elegido { border-color: var(--primario); box-shadow: 0 0 0 2px var(--primario-suave); }
  .perfiles label b { display: block; margin-bottom: 4px; }
  .perfiles label input { margin: 0 6px 6px 0; width: 18px; height: 18px; min-height: 0; vertical-align: middle; }
  .perfiles ul { margin: 6px 0 0; padding-left: 18px; font-size: 12.5px; color: var(--texto-suave); }
  .perfiles .actual { display: inline-block; margin-top: 6px; font-size: 12px; color: var(--verde); }
  /* Con un perfil ya en uso, el paso 0 no distrae: una linea y «Cambiar». */
  #perfil.plegado > p.ayuda, #perfil.plegado #perfil-lista, #perfil.plegado > .acciones { display: none; }
  #perfil-resumen { display: none; align-items: center; gap: var(--esp-2); flex-wrap: wrap; margin-top: var(--esp-2); }
  #perfil.plegado #perfil-resumen { display: flex; }
  #perfil-resumen .ok { color: var(--verde); font-weight: 600; }
  .secreto { display: block; border: 1px dashed var(--primario); border-radius: var(--radio-sm); padding: 10px 12px; margin-top: var(--esp-2); }
  .secreto code { display: block; margin: 6px 0; }
  #gsg-bitacora { overflow-x: auto; max-width: 100%; font-size: 13px; }
  #gsg-bitacora table { min-width: 520px; width: 100%; border-collapse: collapse; font-size: 12.5px; }
  #gsg-bitacora th, #gsg-bitacora td { text-align: left; padding: 4px 6px; }
  #gsg-sim-valor, #gsg-clave-valor { overflow-wrap: anywhere; }
/* Conectar el sistema de GSG: dos campos en la tarjeta, sin ventanas encadenadas. */
#gsg-form { margin: var(--esp-3) 0 0; padding: var(--esp-3); border: 1px solid var(--borde); border-radius: var(--radio); background: var(--superficie-2); }
#gsg-form input { width: 100%; }
#gsg-form .con-ojo { position: relative; }
#gsg-form .con-ojo input { padding-right: 88px; }
#gsg-form .con-ojo button { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); min-height: 36px; }
#gsg-form .campo:first-child { margin-top: 0; }
#gsg-resultado { margin-top: var(--esp-2); padding: 10px 12px; border-radius: var(--radio-sm); font-size: 14px; line-height: 1.45; }
#gsg-resultado.bien { background: var(--verde-suave); color: var(--texto); }
#gsg-resultado.mal { background: var(--rojo-suave); color: var(--texto); }
#gsg-resultado.espera { background: var(--ambar-suave); color: var(--texto); }

/* Arriba, lo unico que importa: dos tarjetas grandes, WhatsApp y GSG. */
.wrap { max-width: var(--ancho-max, 1600px); }
.con-resumen { display: grid; gap: var(--esp-4); grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; margin-bottom: var(--esp-6); }
.con-resumen.una { grid-template-columns: minmax(0, 1fr); max-width: 560px; }
@media (max-width: 820px) { .con-resumen { grid-template-columns: minmax(0, 1fr); } }
.con-card { padding: var(--esp-5); display: flex; flex-direction: column; gap: var(--esp-3); min-width: 0; }
@media (max-width: 640px) { .con-card { padding: var(--esp-4); } }
.con-cab { display: flex; align-items: center; gap: var(--esp-3); }
.con-ico { flex: none; width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; font-size: 24px; background: var(--primario-suave); }
.con-tit { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; min-width: 0; }
.con-tit h2 { font-size: 20px; }
.con-frase { font-size: 14.5px; color: var(--texto-suave); }
.con-frase b { color: var(--texto); }
.con-card .acciones { margin-top: 0; }
.con-card #qr-box { text-align: center; }
.con-card #qr-box .qr-marco { margin-top: 0; }
.con-card #qr-box .bloque { text-align: left; }
.con-card #gsg-estado .chip, .con-card #gsg-estado br { display: none; }
.con-card #gsg-estado:empty { display: none; }
.con-form { margin-top: 0; }
.con-form > summary { font-size: 13.5px; padding: 4px 0; min-height: 0; }
.con-form[open] > summary { margin-bottom: var(--esp-2); }
.con-form #gsg-form { margin-top: 0; }
.con-avanzado { margin-top: 0; border-top: 1px solid var(--borde); padding-top: var(--esp-2); }
.con-avanzado > summary { display: flex; flex-direction: column; gap: 2px; color: var(--texto); padding: var(--esp-3) 0; }
.con-avanzado > summary b { font-size: 15px; }
.con-avanzado > summary .ayuda { font-weight: 400; }
.con-avanzado[open] > summary { margin-bottom: var(--esp-3); }
`;

/* ------------------------------------------------------------------- html */

export interface ConnectOpts {
  labels: Record<string, string>;
  nombreNegocio: string;
  demo?: boolean;
  /** Si hay modulo de entregas: se ensena tambien la conexion con GSG. */
  conGsg?: boolean;
}

function opcionHtml(id: Modo): string {
  const m = MODOS[id];
  const etiqueta = m.etiqueta
    ? ` <span class="etiqueta${m.riesgo ? ' riesgo' : ''}">${m.etiqueta}</span>`
    : '';
  return `
  <label class="opcion" data-modo="${id}">
    <input type="radio" name="modo" value="${id}">
    <span class="txt"><b>${m.titulo}${etiqueta}</b><span>${m.resumen}</span></span>
  </label>`;
}

export function connectPage(opts: ConnectOpts): string {
  const { labels } = opts;
  const avanzados = SETUP_FIELDS.map(
    (field) => `
  <label class="campo" for="${field}">${labels[field] ?? field}</label>
  <input id="${field}" name="${field}" autocomplete="off" spellcheck="false">`,
  ).join('');

  // Delante, la API oficial de Meta. Los caminos por QR (sin Meta) solo sirven
  // para probar y van aparte. En modo GSG el menu es aun mas corto: las formas
  // raras de Meta tambien se esconden.
  const soloGsg = modoVigente() === 'gsg';
  const normales = ORDEN_MODOS.filter((id) => !MODOS[id].pruebas && !(soloGsg && MODOS[id].avanzado));
  const escondidos = ORDEN_MODOS.filter((id) => !MODOS[id].pruebas && soloGsg && MODOS[id].avanzado);
  const dePrueba = ORDEN_MODOS.filter((id) => MODOS[id].pruebas);

  const contenido = `
<div class="wrap">
<div id="app" class="hidden">

<div class="con-resumen${opts.conGsg ? '' : ' una'}">
<section class="tarjeta con-card" id="card-wa">
  <div class="con-cab"><span class="con-ico" aria-hidden="true">💬</span><div class="con-tit"><h2>WhatsApp</h2><span id="wa-chip" class="chip tono-gris">Revisando…</span></div></div>
  <p class="con-frase" id="wa-frase">Revisando la conexión…</p>
  <div id="qr-box" class="hidden">
      <div class="qr-marco"><img id="qr-img" alt="Código QR para vincular WhatsApp"></div>
      <p class="ayuda">En el teléfono: WhatsApp &rarr; Ajustes &rarr; Dispositivos vinculados &rarr;
        Vincular un dispositivo. Si el código caduca, aquí sale otro solo.</p>
      <div class="bloque">
        <p class="ayuda">¿Sin cámara? Pide un código de ocho caracteres y tecléalo en
          <b>Vincular con el número de teléfono</b>.</p>
        <div class="acciones">
          <input id="pair-phone" class="corto" inputmode="numeric" placeholder="51987654321"
                 aria-label="Tu número con código de país">
          <button class="btn" id="pair-ask" type="button">Pedir código</button>
        </div>
        <div id="pair-code" class="codigo hidden" role="status"></div>
      </div>
    </div>

  <p class="ayuda" id="wa-estado" role="status"></p>
  <div class="acciones">
    <button class="btn primario hidden" id="wa-conectar" type="button">Conectar y mostrar el QR</button>
    <a class="btn hidden" id="wa-chats" href="/chat">Ir a Chats</a>
  </div>
</section>
${opts.conGsg ? `<section class="tarjeta con-card" id="gsg">
  <div class="con-cab"><span class="con-ico" aria-hidden="true">📦</span><div class="con-tit"><h2>GSG</h2><span id="gsg-chip" class="chip tono-gris">Revisando…</span></div></div>
  <p class="con-frase" id="gsg-frase">De GSG llegan los pedidos del día, y a GSG le mandamos cada ubicación que registra el cliente.</p>
  <div id="gsg-estado" class="ayuda">Cargando…</div>
  <details class="con-form" id="gsg-form-caja"><summary id="gsg-form-resumen">Cambiar la dirección o la clave</summary>
  <form id="gsg-form" novalidate>
    <label class="campo" for="gsg-url">Dirección del sistema de GSG
      <span class="hint">Te la dan sus programadores. Empieza por https://</span></label>
    <input id="gsg-url" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://api.gsg.pe/v1">
    <label class="campo" for="gsg-token">Clave de acceso (token)
      <span class="hint" id="gsg-token-pista">También te la dan ellos. Se guarda cifrada y no se vuelve a mostrar.</span></label>
    <div class="con-ojo">
      <input id="gsg-token" type="password" autocomplete="off" spellcheck="false">
      <button class="btn sm" id="gsg-token-ver" type="button" aria-controls="gsg-token" aria-pressed="false">Mostrar</button>
    </div>
    <div class="acciones">
      <button class="btn secundario" id="gsg-guardar" type="submit">Guardar y probar</button>
    </div>
  </form>
  </details>
  <div id="gsg-resultado" class="hidden" role="status" aria-live="polite"></div>
  <div class="acciones">
    <button class="btn" id="gsg-probar" type="button">Probar otra vez</button>
    <button class="btn" id="gsg-simulador" type="button">Usar el simulador</button>
    <button class="btn peligro" id="gsg-quitar" type="button">Desconectar</button>
    <span id="gsg-state" class="chip hidden" role="status"></span>
  </div>
  <div id="gsg-descartes" class="nota riesgo hidden">
    <b id="gsg-descartes-titulo"></b>
    <p>GSG los mandó en su lista de hoy pero no se pudieron usar. Avísale para que los corrija; en cuanto los mande bien, entran solos.</p>
    <ul id="gsg-descartes-lista"></ul>
  </div>
</section>
` : ''}</div>

<details class="con-avanzado" id="con-avanzado">
  <summary><b>Conectar con Meta, paso a paso</b><span class="ayuda">WhatsApp Business por la API oficial, prueba de envío, conexiones de prueba (QR, WAHA) y datos para programadores.</span></summary>
<ol class="progreso" id="progreso" aria-label="Progreso de la conexión">
  <li data-paso="1"><span class="n">1</span><span class="t">Cómo</span></li>
  <li data-paso="2"><span class="n">2</span><span class="t">Datos</span></li>
  <li data-paso="3"><span class="n">3</span><span class="t">Conectar</span></li>
  <li data-paso="4"><span class="n">4</span><span class="t">Probar</span></li>
</ol>
<p class="ayuda" id="progreso-texto" role="status"></p>

<section class="tarjeta paso" id="paso1">
  <h2><span class="num">1</span> ¿Quieres seguir usando WhatsApp en el móvil?</h2>
  <p class="ayuda">Es la única decisión: cambiarla después obliga a rehacer la conexión.</p>
  <div class="cuerpo">
    ${normales.map(opcionHtml).join('')}
    ${
      escondidos.length
        ? `<details class="mas-formas" id="mas-formas">
      <summary>Más formas de conectar con Meta (número nuevo, token)</summary>
      ${escondidos.map(opcionHtml).join('')}
    </details>`
        : ''
    }
    <details class="mas-formas" id="solo-pruebas">
      <summary>Solo para pruebas, sin Meta (QR, WAHA)</summary>
      <p class="ayuda">Emulan WhatsApp Web: están fuera de las normas de Meta y el número puede acabar bloqueado. Úsalos con un número de pruebas, nunca con el del negocio.</p>
      ${dePrueba.map(opcionHtml).join('')}
    </details>
    <div class="nota hidden" id="aviso-modo"></div>
  </div>
</section>

<section class="tarjeta paso" id="paso2">
  <h2><span class="num">2</span> <span id="paso2-titulo">Datos de tu app de Meta</span></h2>
  <p class="ayuda" id="paso2-lead">Se copian una vez y se guardan cifrados.</p>
  <p class="motivo hidden" id="paso2-motivo">Elige antes cómo quieres conectar.</p>
  <div class="cuerpo">
    <div id="paso2-campos"></div>

    <div id="paso2-url">
      <label class="campo" for="c-url"><span id="c-url-titulo">Dirección de este sistema en internet</span>
        <span class="hint" id="c-url-pista">Meta necesita poder entrar aquí para avisarte de los mensajes nuevos.</span></label>
      <input id="c-url" autocomplete="off" spellcheck="false" placeholder="https://algo.trycloudflare.com">
      <div class="nota hidden" id="aviso-url"></div>
    </div>

    <div class="acciones">
      <button class="btn primario" id="paso2-ok" type="button">Guardar y seguir</button>
      <button class="btn hidden" id="paso2-editar" type="button">Cambiar los datos guardados</button>
      <span id="paso2-state" class="chip hidden" role="status"></span>
    </div>

    <details>
      <summary>¿De dónde saco estos datos?</summary>
      <ol class="ayuda">
        <li>Entra a <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">developers.facebook.com/apps</a>
            y crea una app de tipo <b>Empresa</b>. Añádele el producto <b>WhatsApp</b>.</li>
        <li>El <b>ID de la app</b> y la <b>clave secreta</b> están en Configuración de la app &rarr; Básica.</li>
        <li>El <b>ID de la configuración</b>: Facebook Login for Business &rarr; Configurations &rarr; Crear,
            variante <b>Embedded Signup</b>, con el producto <b>Cloud API</b> y, si quieres que el número siga
            en el celular, <b>WhatsApp Business App onboarding</b>. Una configuración creada antes (v2 o v3)
            deja de abrir la ventana el 15/10/2026: crea una nueva.</li>
        <li>Solo para el camino manual, el <b>token permanente</b>: Configuración del negocio &rarr;
            Usuarios &rarr; Usuario del sistema, con los permisos
            <code>whatsapp_business_messaging</code> y <code>whatsapp_business_management</code>.</li>
      </ol>
    </details>
  </div>
</section>

<section class="tarjeta paso" id="paso3">
  <h2><span class="num">3</span> Conectar</h2>
  <p class="ayuda" id="paso3-lead"></p>
  <p class="motivo hidden" id="paso3-motivo"></p>
  <div class="cuerpo">
    <div class="acciones">
      <button class="btn primario facebook hidden" id="fb-login" type="button">
        <span aria-hidden="true">f</span> <span id="fb-label">Conectar con Facebook</span>
      </button>
      <button class="btn primario hidden" id="connect" type="button">Conectar</button>
      <button class="btn primario hidden" id="qr-connect" type="button">Mostrar el código QR</button>
      <button class="btn peligro hidden" id="desconectar" type="button">Desconectar la cuenta</button>
      <span id="fb-state" class="chip hidden" role="status"></span>
    </div>

    <div id="choice" class="hidden bloque">
      <h3>Elige el número</h3>
      <p class="ayuda">Tu cuenta tiene varios.</p>
      <div id="choice-list"></div>
    </div>

    <div id="steps" class="hidden bloque"></div>
    <div id="avisos-meta" class="hidden bloque"></div>

    <div class="hidden bloque" id="pin-box">
      <div class="nota"><b>Este número todavía no está activado.</b> Se activa con el PIN de seis dígitos
        de la verificación en dos pasos. Si no tenía ninguno, el que escribas queda como suyo.</div>
      <div class="acciones">
        <input id="pin" class="corto" inputmode="numeric" maxlength="6" placeholder="123456" aria-label="PIN de seis dígitos">
        <button class="btn primario" id="register" type="button">Activar número</button>
        <span id="reg-state" class="chip hidden" role="status"></span>
      </div>
    </div>
  </div>
</section>

<section class="tarjeta paso" id="paso4">
  <h2><span class="num">4</span> Comprobar que funciona</h2>
  <p class="ayuda">Mándate un mensaje a ti mismo. Si te llega, está todo bien.</p>
  <p class="motivo hidden" id="paso4-motivo">Primero hay que conectar la cuenta.</p>
  <div class="cuerpo">
    <label class="campo" for="testPhone">Tu WhatsApp <span class="hint">Los nueve dígitos del celular; el +51 va solo.</span></label>
    <div class="tel"><span class="prefijo">+51</span><input id="testPhone" placeholder="987 654 321" inputmode="tel" autocomplete="tel-national" maxlength="14"></div>
    <div class="acciones">
      <button class="btn primario" id="sendTest" type="button">Enviar prueba</button>
      <a class="btn" href="/chat">Ir al chat</a>
      <span id="test-state" class="chip hidden" role="status"></span>
    </div>
  </div>
</section>
${
  opts.conGsg
    ? `
<section class="tarjeta paso" id="perfil">
  <h2>¿Para qué vas a usar GSGchat?</h2>
  <p class="ayuda">El perfil deja de un clic el menú, qué contesta solo y los ajustes de las entregas. Tus textos y tus datos no se tocan.</p>
  <div id="perfil-resumen"><span class="ok" id="perfil-resumen-texto"></span><button class="btn" type="button" id="perfil-cambiar">Cambiar</button></div>
  <div id="perfil-lista" class="perfiles"></div>
  <div class="acciones"><button class="btn primario" id="perfil-aplicar" type="button">Aplicar este perfil</button><span id="perfil-state" class="chip hidden" role="status"></span></div>
</section>

<section class="tarjeta paso" id="gsg-avanzado">
  <h2>GSG: herramientas</h2>
  <div class="bloque">
    <h3>Cada día</h3>
    <div class="acciones pegada">
      <button class="btn" id="gsg-cuadrar" type="button">Cuadrar el día con GSG</button>
      <button class="btn" id="gsg-verificar" type="button">Verificar el contrato</button>
      <span id="gsg-verificar-state" class="chip hidden" role="status"></span>
    </div>
    <p class="ayuda separada">«Cuadrar» compara lo que GSG tiene como terminado con lo que aquí figura entregado o cancelado. «Verificar el contrato» pide su lista del día y dice, campo por campo, qué falta o sobra; no crea ningún pedido.</p>
    <div id="gsg-verificacion" class="hidden"></div>
    <div id="gsg-cuadre" class="hidden"></div>
  </div>
  <div class="bloque">
    <h3>Para que GSG conecte su sistema</h3>
    <p class="ayuda">Con una clave, GSG nos manda cada pedido en cuanto entra y se entera de lo que pasa: confirmó, hora avisada, entregado, incidencia.</p>
    <div class="acciones"><button class="btn" id="gsg-clave" type="button">Crear la clave para GSG</button><span id="gsg-clave-state" class="chip hidden" role="status"></span></div>
    <div id="gsg-clave-nueva" class="secreto hidden">
      <b>Clave para GSG: cópiala ahora, no se volverá a mostrar.</b>
      <code id="gsg-clave-valor"></code>
      <ol id="gsg-clave-pasos" class="ayuda"></ol>
      <div class="acciones"><button class="btn sm" id="gsg-clave-copiar" type="button">Copiar la clave</button></div>
    </div>
    <details id="gsg-dev">
      <summary>Para los programadores de GSG: dirección, contrato, simulador y lo que nos mandaron</summary>
      <div class="copiar"><input id="gsg-api-url" readonly value="/api/v1/entregas" aria-label="Dirección de la API para GSG"><button class="btn" id="gsg-api-copiar" type="button">Copiar la dirección</button></div>
      <div class="acciones">
        <a class="btn" id="gsg-contrato" href="/docs/contrato-gsg.md" download="CONTRATO-GSG.md">Descargar el contrato</a>
        <a class="btn" href="/api/v1/openapi.json" download="contrato-gsgchat.json">Descargar el OpenAPI</a>
        <a class="btn" href="/api/v1/openapi.json" target="_blank" rel="noopener">Ver el OpenAPI</a>
      </div>
      <p class="ayuda separada">El contrato explica cada llamada paso a paso y cómo probar contra el simulador antes de tocar nada real: es lo que se le manda a los programadores de GSG.</p>
      <div id="gsg-sim" class="bloque punteado hidden">
        <p class="ayuda"><b>Que prueben contra el simulador desde fuera.</b> Un token propio, con caducidad, para llamar al simulador de este servidor sin tocar nada real. Se ve una sola vez.</p>
        <div class="copiar"><input id="gsg-sim-url" readonly aria-label="Dirección del simulador"><button class="btn" id="gsg-sim-url-copiar" type="button">Copiar la dirección</button></div>
        <div class="acciones"><button class="btn" id="gsg-sim-token" type="button">Crear un token del simulador</button><span id="gsg-sim-state" class="chip hidden" role="status"></span></div>
        <div id="gsg-sim-nuevo" class="secreto hidden">
          <b>Token del simulador: cópialo ahora, no se volverá a mostrar.</b>
          <code id="gsg-sim-valor"></code>
          <p class="ayuda">Lo mandan como <code>Authorization: Bearer &lt;el token&gt;</code> a la dirección de arriba.</p>
          <div class="acciones"><button class="btn sm" id="gsg-sim-copiar" type="button">Copiar el token</button></div>
        </div>
        <ul id="gsg-sim-lista" class="ayuda"></ul>
        <div class="bloque punteado">
          <p class="ayuda"><b>Probar lo que GSG puede cambiar después de mandar un pedido.</b> El simulador cancela un pedido o le cambia la dirección, y en la siguiente sincronización este sistema lo refleja.</p>
          <div class="acciones">
            <button class="btn sm" id="gsg-sim-cancelar" type="button">Cancelar uno (prueba)</button>
            <button class="btn sm" id="gsg-sim-cambiar" type="button">Cambiar la dirección de uno (prueba)</button>
            <span id="gsg-sim-prueba-state" class="chip hidden" role="status"></span>
          </div>
        </div>
      </div>
      <div class="bloque punteado">
        <p class="ayuda"><b>Lo que GSG nos mandó</b> (las últimas llamadas, con lo que se les contestó). <a id="gsg-bitacora-refrescar" href="#">Actualizar</a></p>
        <div id="gsg-bitacora" class="ayuda">Todavía nadie ha llamado.</div>
      </div>
    </details>
  </div>
</section>
`
    : ''
}

<details>
  <summary>Solo si te lo pide soporte: ver y editar todos los datos guardados</summary>
  <div class="tarjeta paso">
    <p class="ayuda">Lo secreto se muestra tapado. Deja un campo vacío para no cambiarlo.</p>
    ${avanzados}
    <div class="acciones">
      <button class="btn primario" id="save" type="button">Guardar</button>
      <button class="btn" id="test" type="button">Probar</button>
      <span id="manual-state" class="chip hidden" role="status"></span>
    </div>

    <label class="campo" for="hookUrl">Dirección del aviso de mensajes nuevos (webhook)</label>
    <div class="copiar"><input id="hookUrl" readonly><button class="btn" data-copy="hookUrl" type="button">Copiar</button></div>
    <label class="campo" for="hookToken">Palabra de verificación</label>
    <div class="copiar"><input id="hookToken" readonly><button class="btn" data-copy="hookToken" type="button">Copiar</button></div>
  </div>
</details>
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

/* --- utilidades --------------------------------------------------------- */
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function $(id) { return document.getElementById(id); }
function val(id) { var el = $(id); return el ? el.value.trim() : ''; }
function setVal(id, v) { var el = $(id); if (el) el.value = v == null ? '' : v; }
function ver(id, visible) { var el = $(id); if (el) el.classList.toggle('hidden', !visible); }
function texto(id, t) { var el = $(id); if (el) el.textContent = t; }

/* Un solo sitio para los estados: los chips del armazon, con su tono. */
function estado(id, t, tono) {
  var el = $(id);
  if (!el) return;
  el.textContent = t;
  el.className = 'chip tono-' + (tono || 'verde');
  /* Lo que pasa con la conexion se lee tambien en la tarjeta de WhatsApp de arriba. */
  if (id === 'fb-state') { var wa = $('wa-estado'); if (wa) wa.textContent = t; }
}
function sinEstado(id) { var el = $(id); if (el) el.className = 'chip hidden'; }

/* Copiar al portapapeles: lo hacian cinco botones cada uno a su manera. */
async function copiar(texto, estadoId, comoSeLlama) {
  try {
    await navigator.clipboard.writeText(texto);
    if (estadoId) estado(estadoId, (comoSeLlama || 'Texto') + ' copiado', 'verde');
  } catch (error) {
    if (estadoId) estado(estadoId, 'El navegador no dejó copiar: selecciónalo y copia a mano.', 'ambar');
  }
}
function hora(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  return isNaN(d.getTime()) ? '' : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function fecha(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

var FIELDS = ${JSON.stringify(SETUP_FIELDS)};
var CAMPOS_POR_MODO = ${JSON.stringify(CAMPOS_POR_MODO)};
var CAMPOS_OPCIONALES = ${JSON.stringify(CAMPOS_OPCIONALES)};
var AYUDA = ${JSON.stringify(AYUDA_CAMPO)};
var MODOS = ${JSON.stringify(MODOS)};
var SECRETS = ['token', 'appSecret'];

/* --- el unico estado del asistente -------------------------------------- */
var opciones = {};          /* /admin/connect/options */
var guardado = {};          /* lo que el servidor tiene guardado */
var faltanCredenciales = true;  /* settings.missing() del servidor */
var modo = localStorage.getItem('waModo') || '';
var editandoPaso2 = false;
var pruebaHecha = false;
/* Lo que sabemos de la sesion con QR (local o WAHA). */
var qr = { conectado: false, imagen: '', parado: false };

function esQr() { return modo === 'local' || modo === 'waha'; }
function esMeta() { return !!(MODOS[modo] && MODOS[modo].oficial); }
function prefijo() { return modo === 'local' ? '/admin/local' : '/admin/waha'; }

function faltantes() {
  if (!modo) return [];
  return (CAMPOS_POR_MODO[modo] || []).filter(function (f) {
    return !guardado[f] && CAMPOS_OPCIONALES.indexOf(f) < 0;
  });
}

/** Con QR manda lo que diga la sesion; con Meta, lo que el servidor tenga. */
function estaConectado() {
  return esQr() ? qr.conectado : !faltanCredenciales;
}

/**
 * EN QUE PASO ESTAS. Es el unico sitio que lo decide; todo lo demas pregunta
 * aqui. Guardas tempranas y en orden: sin modo no hay datos, sin datos no hay
 * conexion, sin conexion no hay prueba.
 */
function pasoActual() {
  if (!modo) return 1;
  if (editandoPaso2 || faltantes().length) return 2;
  if (!estaConectado()) return 3;
  return 4;
}

/* Que falta para salir del paso en el que estas, en una linea. */
function queFalta(paso) {
  if (paso === 1) return 'Elige cómo quieres conectar.';
  if (paso === 2) return modo === 'local' ? 'Nada que rellenar: sigue al paso 3.' : 'Rellena los datos y guarda.';
  if (paso === 3) return esQr() ? 'Escanea el código con el teléfono.' : 'Pulsa el botón y termina en la ventana de Meta.';
  return pruebaHecha ? 'Todo listo.' : 'Mándate un mensaje de prueba.';
}

/* --- pintar: una sola pasada por los cuatro pasos ----------------------- */
function pintar() {
  var paso = pasoActual();

  document.querySelectorAll('#progreso li').forEach(function (li) {
    var n = Number(li.getAttribute('data-paso'));
    li.classList.toggle('hecho', n < paso || (n === 4 && pruebaHecha));
    li.classList.toggle('actual', n === paso && !(n === 4 && pruebaHecha));
  });
  texto('progreso-texto', 'Paso ' + paso + ' de 4. ' + queFalta(paso));

  pintarPaso1();
  pintarPaso2(paso);
  pintarPaso3(paso);
  pintarPaso4(paso);
  pintarTarjetaWa();
  gestionarSondeo(paso);
}

/* --- la tarjeta de WhatsApp de arriba: conectado o el boton para el QR --- */
function pintarTarjetaWa() {
  var chip = $('wa-chip');
  if (!chip) return;
  var conectado = estaConectado();
  var viaQr = !!modo && esQr();
  chip.className = 'chip tono-' + (conectado ? 'verde' : 'ambar');
  chip.textContent = conectado ? 'Conectado' : 'Sin conectar';
  $('wa-frase').innerHTML = conectado
    ? 'Los mensajes de tus clientes entran y salen por tu número' + (modo === 'local' || modo === 'waha' ? ' (vinculado con el QR).' : ' (API oficial de Meta).')
    : viaQr
      ? (qr.imagen ? '<b>Escanea el código</b> con el teléfono: WhatsApp → Dispositivos vinculados → Vincular un dispositivo.' : 'Pulsa el botón y escanea el código con tu teléfono, como en WhatsApp Web.')
      : modo
        ? 'Falta terminar la conexión con la API de Meta: sigue los pasos de abajo.'
        : 'Conecta tu WhatsApp Business por la API oficial de Meta: es lo que evita bloqueos del número.';
  var boton = $('wa-conectar');
  boton.textContent = viaQr ? 'Conectar y mostrar el QR' : modo ? 'Terminar la conexión' : 'Conectar WhatsApp Business';
  ver('wa-conectar', !conectado && !(viaQr && qr.imagen));
  ver('wa-chats', conectado);
  if (conectado) { var wa = $('wa-estado'); if (wa && /Escanea|Abriendo|Esperando|Creando/.test(wa.textContent)) wa.textContent = ''; }
}

/* Abre «Opciones avanzadas» y lleva al paso que toca. */
function abrirAvanzado(id) {
  var det = $('con-avanzado');
  if (det) det.open = true;
  var el = $(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('wa-conectar').onclick = async function () {
  var boton = this;
  /* Sin camino elegido, el de verdad: WhatsApp Business por la API de Meta,
     conservando el numero en el telefono (coexistencia). Los QR son para
     probar y se eligen a mano en «Solo para pruebas». */
  if (!modo) {
    var opcion = document.querySelector('input[name="modo"][value="coexistence"]');
    if (opcion) opcion.click();
    abrirAvanzado('paso1');
    return;
  }
  if (!esQr()) { abrirAvanzado('paso' + pasoActual()); return; }
  boton.disabled = true;
  try {
    $('qr-connect').click();
  } catch (error) {
    estado('fb-state', error.message, 'rojo');
  } finally {
    boton.disabled = false;
  }
};

/** Bloquea o abre una tarjeta y dice por que, fuera del cuerpo apagado. */
function marcarPaso(id, paso, mio, motivo) {
  var sec = $(id);
  if (!sec) return;
  var bloqueado = paso < mio;
  sec.classList.toggle('bloqueado', bloqueado);
  sec.classList.toggle('hecho', paso > mio || (mio === 4 && pruebaHecha));
  sec.setAttribute('aria-disabled', bloqueado ? 'true' : 'false');
  var caja = $(id + '-motivo');
  if (caja) {
    caja.classList.toggle('hidden', !bloqueado || !motivo);
    if (motivo) caja.textContent = motivo;
  }
}

/* --- paso 1: el modo ---------------------------------------------------- */
document.querySelectorAll('.opcion input[name=modo]').forEach(function (radio) {
  radio.onchange = function () { elegirModo(radio.value, true); };
});

/**
 * "guardar" solo va a true cuando el usuario pulsa: al recargar la pagina no
 * hay que reescribir el proveedor. Importa porque faltantes() depende de el,
 * y con el proveedor equivocado la pantalla pide los datos del otro camino.
 */
function elegirModo(nuevo, guardar) {
  if (!MODOS[nuevo]) return;
  var cambio = modo !== nuevo;
  modo = nuevo;
  localStorage.setItem('waModo', modo);
  /* Cambiar de camino tira lo que sabiamos del anterior: si no, un QR viejo o
     un "conectado" de WAHA se quedaba pintado sobre el camino nuevo. */
  if (cambio) { qr = { conectado: false, imagen: '', parado: false }; editandoPaso2 = false; sinEstado('fb-state'); }
  pintar();

  var quiere = esQr() ? modo : 'cloud';
  if (guardar && guardado.provider !== quiere) {
    api('/admin/settings', { method: 'POST', body: { provider: quiere } })
      .then(cargar)
      .catch(function (error) { estado('paso2-state', error.message, 'rojo'); });
  }
}

function pintarPaso1() {
  $('paso1').classList.toggle('hecho', !!modo);
  document.querySelectorAll('.opcion').forEach(function (el) {
    var elegida = el.getAttribute('data-modo') === modo;
    el.classList.toggle('elegida', elegida);
    var radio = el.querySelector('input');
    if (radio) radio.checked = elegida;
    /* si la forma elegida esta escondida en «Mas formas», que se vea */
    var caja = el.closest('#mas-formas, #solo-pruebas');
    if (elegida && caja) caja.open = true;
  });

  /* Un solo aviso, el que toca: antes cada opcion repetia el mismo parrafo. */
  var aviso = $('aviso-modo');
  if (!modo) { aviso.classList.add('hidden'); return; }
  aviso.classList.toggle('riesgo', !esMeta());
  aviso.innerHTML = esMeta()
    ? '<b>Necesitas WhatsApp Business</b> (el icono naranja), no el WhatsApp verde de siempre. ' +
      'Si usas el verde, instala WhatsApp Business y migra: es gratis y conservas número e historial.'
    : '<b>Este camino no es oficial.</b> Emula WhatsApp Web, está fuera de los términos de Meta y el ' +
      'número puede acabar baneado sin aviso y sin recuperación. Usa un número secundario.';
  aviso.classList.remove('hidden');
}

/* --- paso 2: los datos -------------------------------------------------- */
function pintarPaso2(paso) {
  marcarPaso('paso2', paso, 2, 'Elige antes cómo quieres conectar.');
  if (!modo) return;

  var info = MODOS[modo];
  texto('paso2-titulo', modo === 'waha' ? 'Dónde corre tu WAHA' : modo === 'local' ? 'Nada que configurar' : 'Datos de tu app de Meta');

  var faltan = faltantes();
  var todos = CAMPOS_POR_MODO[modo] || [];
  var pendientes = editandoPaso2 ? todos : faltan;
  var completo = !faltan.length && !editandoPaso2;

  var algoGuardado = todos.some(function (f) { return !!guardado[f]; });
  texto('paso2-lead', completo && algoGuardado ? 'Ya están guardados: solo se vuelven a pedir si los cambias.' : info.paso2);
  ver('paso2-editar', completo && todos.length > 0);
  ver('paso2-ok', !completo);

  /* El camino corto no habla con nadie de fuera: no hay direccion publica que
     poner. WAHA si, pero solo para que el contenedor llegue a este servidor. */
  ver('paso2-url', modo !== 'local');
  texto('c-url-titulo', modo === 'waha' ? 'Dirección de este sistema' : 'Dirección de este sistema en internet');
  texto('c-url-pista', modo === 'waha'
    ? 'WAHA le manda aquí los mensajes. Con todo en la misma máquina, lo de por defecto vale.'
    : 'Meta necesita poder entrar aquí para avisarte de los mensajes nuevos.');

  /* Los campos se rehacen solo cuando cambia cuales son: repintarlos en cada
     pasada borraba lo que el usuario estaba tecleando. */
  var caja = $('paso2-campos');
  var clave = modo + ':' + pendientes.join(',');
  if (caja.getAttribute('data-clave') !== clave) {
    caja.setAttribute('data-clave', clave);
    caja.innerHTML = pendientes.map(function (f) {
      var a = AYUDA[f] || { titulo: f, pista: '', ph: '' };
      return '<label class="campo" for="f-' + f + '">' + esc(a.titulo) +
        (a.pista ? '<span class="hint">' + esc(a.pista) + '</span>' : '') + '</label>' +
        '<input id="f-' + f + '" autocomplete="off" spellcheck="false" placeholder="' + esc(a.ph) + '">';
    }).join('');
    if (modo === 'waha' && $('f-wahaUrl')) buscarWaha();
  }
  pintarAvisoUrl();
}

/**
 * Rellena sola la direccion del contenedor: casi siempre corre en la misma
 * maquina y en uno de dos puertos, asi que preguntar por una URL que el
 * sistema puede averiguar es pedirle al usuario que haga de configurador.
 */
async function buscarWaha() {
  var campo = $('f-wahaUrl');
  if (!campo || campo.value) return;
  try {
    var r = await api('/admin/waha/detect');
    if (!r.found || campo.value) return;
    campo.value = r.found;
    var pista = document.createElement('span');
    pista.className = 'hint';
    pista.textContent = 'Contenedor encontrado en ' + r.found + '. Si es el tuyo, no toques nada.';
    campo.insertAdjacentElement('afterend', pista);
  } catch (error) {
    /* Buscarlo es una comodidad: que falle no puede romper el paso, y el
       campo sigue ahi para teclearlo a mano. */
    estado('paso2-state', 'No se pudo buscar el contenedor solo: escribe su dirección.', 'ambar');
  }
}

/** Meta tiene que poder entrar; WAHA no. El aviso se recalcula al teclear. */
function pintarAvisoUrl() {
  var aviso = $('aviso-url');
  if (!aviso) return;
  var url = val('c-url');
  var malo = !esQr() && modo && !/^https:\/\//.test(url);
  aviso.innerHTML = '<b>Esta dirección no vale para Meta:</b> tiene que empezar por https y ser pública. ' +
    'Levanta un túnel (<code>npx cloudflared tunnel --url http://localhost:3000</code>) y pega aquí esa dirección, ' +
    'o elige un camino con QR, que no la necesita.';
  aviso.classList.toggle('hidden', !malo);
}
$('c-url').oninput = pintarAvisoUrl;

$('paso2-editar').onclick = function () { editandoPaso2 = true; pintar(); };

$('paso2-ok').onclick = async function () {
  var boton = this;
  var pedidos = CAMPOS_POR_MODO[modo] || [];
  var cuerpo = {};
  var vacios = [];
  pedidos.forEach(function (f) {
    var v = val('f-' + f);
    if (v) cuerpo[f] = v;
    else if (!guardado[f] && CAMPOS_OPCIONALES.indexOf(f) < 0) vacios.push((AYUDA[f] || { titulo: f }).titulo);
  });

  /* Antes el boton guardaba nada y decia "Guardado": el usuario se quedaba
     mirando el mismo paso sin entender por que no avanzaba. */
  if (vacios.length) {
    estado('paso2-state', 'Falta rellenar: ' + vacios.join(', ') + '.', 'ambar');
    var primero = $('f-' + pedidos[0]);
    if (primero) primero.focus();
    return;
  }

  boton.disabled = true;
  estado('paso2-state', 'Guardando…', 'ambar');
  try {
    if (Object.keys(cuerpo).length) await api('/admin/settings', { method: 'POST', body: cuerpo });
    editandoPaso2 = false;
    estado('paso2-state', 'Guardado', 'verde');
    await cargar();
  } catch (error) {
    estado('paso2-state', error.message, 'rojo');
  } finally {
    boton.disabled = false;
  }
};

/* --- paso 3: la conexion ------------------------------------------------ */
function pintarPaso3(paso) {
  marcarPaso('paso3', paso, 3, !modo ? 'Elige antes cómo quieres conectar.' : 'Antes hay que guardar los datos del paso 2.');
  if (!modo) return;

  var info = MODOS[modo];
  texto('paso3-lead', info.paso3);
  texto('fb-label', info.boton);
  if (esQr()) texto('qr-connect', info.boton);

  ver('fb-login', esMeta() && modo !== 'manual');
  ver('connect', modo === 'manual');
  ver('qr-connect', esQr() && !qr.conectado);
  ver('desconectar', esQr() && qr.conectado);
  ver('qr-box', esQr() && !!qr.imagen);

  /* La ventana de Meta necesita la configuracion de registro incorporado; sin
     ella el boton no puede hacer nada, asi que se dice antes de pulsarlo. */
  if (esMeta() && modo !== 'manual' && paso >= 3) {
    if (opciones.quick) {
      $('fb-login').disabled = false;
      cargarSdk();
    } else if (opciones.missingForQuick) {
      $('fb-login').disabled = true;
      estado('fb-state', 'Falta ' + opciones.missingForQuick.join(' y ') + ': vuelve al paso 2.', 'ambar');
    }
  }
}

/* --- paso 3, variantes con QR: local y WAHA ----------------------------- */

/**
 * Los dos caminos con QR hablan el mismo idioma (mismos estados, mismo QR en
 * base64), asi que la pantalla es una sola y lo unico que cambia es a quien
 * le pregunta.
 */
var sondeando = false;
var sondeoTimer = null;

function pararSondeo() {
  sondeando = false;
  if (sondeoTimer) { clearTimeout(sondeoTimer); sondeoTimer = null; }
}

/**
 * Un solo sondeo vivo, pase lo que pase.
 *
 * Antes se rearmaba con setInterval en cada repintado y, al conectar, el
 * propio sondeo llamaba a recargar, que repintaba, que volvia a sondear: la
 * pantalla se quedaba preguntando cada 3 s para siempre. Ahora hay un flag,
 * la vuelta se encadena y baja el ritmo cuando ya esta conectado (solo para
 * enterarse de una caida) o cuando la pestaña no se ve.
 */
function arrancarSondeo() {
  if (sondeando) return;
  sondeando = true;
  (function vuelta() {
    if (!sondeando) return;
    estadoQr().catch(function () {}).then(function () {
      if (!sondeando) return;
      var espera = document.hidden ? 10000 : qr.conectado ? 15000 : 3000;
      sondeoTimer = setTimeout(vuelta, espera);
    });
  })();
}

function gestionarSondeo(paso) {
  if (esQr() && !qr.parado && paso >= 3) arrancarSondeo();
  else pararSondeo();
}

/* Solo se toca el <img> cuando el codigo cambia: repintarlo cada 3 s lo hacia
   parpadear justo mientras la camara intentaba leerlo. */
function pintarQr(base64) {
  qr.imagen = base64 || '';
  var img = $('qr-img');
  if (base64 && img.getAttribute('data-qr') !== base64) {
    img.src = 'data:image/png;base64,' + base64;
    img.setAttribute('data-qr', base64);
  }
  if (!base64) img.removeAttribute('data-qr');
}

async function estadoQr() {
  if (!esQr()) return;
  var antes = qr.conectado;
  try {
    var r = await api(prefijo() + '/status');
    qr.conectado = !!r.connected;

    if (!r.configured) {
      pintarQr('');
      estado('fb-state', 'Falta decir dónde corre tu contenedor de WAHA: vuelve al paso 2.', 'ambar');
    } else if (!r.ok) {
      pintarQr('');
      estado('fb-state', (r.detail || 'El contenedor de WAHA no responde.') +
        ' Comprueba que está encendido y vuelve a pulsar «' + MODOS[modo].boton + '».', 'rojo');
    } else if (r.connected) {
      pintarQr('');
      estado('fb-state', 'Conectado' + (r.phone ? ': ' + r.phone : ''), 'verde');
    } else if (r.status === 'SCAN_QR_CODE' && r.qr) {
      pintarQr(r.qr);
      estado('fb-state', 'Escanea el código con el teléfono', 'ambar');
    } else if (r.status === 'STARTING') {
      pintarQr('');
      estado('fb-state', 'Abriendo la sesión… en unos segundos sale el código', 'ambar');
    } else if (r.status === 'STOPPED') {
      /* Parada es parada: no va a cambiar sola, asi que se deja de preguntar
         y se dice cual es el boton que saca un codigo nuevo. */
      pintarQr('');
      qr.parado = true;
      estado('fb-state', (r.detail || 'Sin conectar.') + ' Pulsa «' + MODOS[modo].boton + '».', 'ambar');
    } else if (r.status === 'FAILED') {
      pintarQr('');
      estado('fb-state', (r.detail || 'Se cortó la conexión.') + ' Reintentando solo…', 'rojo');
    } else {
      pintarQr('');
      estado('fb-state', r.detail || 'Esperando a WhatsApp…', 'ambar');
    }
  } catch (error) {
    estado('fb-state', error.message, 'rojo');
  }

  /* Recargar los ajustes solo cuando la conexion cambia de verdad: hacerlo en
     cada vuelta era pedir dos endpoints mas cada 3 segundos. */
  if (antes !== qr.conectado) await cargar();
  else pintar();
}

$('qr-connect').onclick = async function () {
  var boton = this;
  boton.disabled = true;
  qr.parado = false;
  estado('fb-state', modo === 'local'
    ? 'Abriendo la sesión… si la anterior ya no vale, se borra y sale un código nuevo'
    : 'Creando la sesión en WAHA…', 'ambar');
  try {
    /* Si no hay WAHA, el servidor lo levanta y contesta 202 mientras se
       descarga y arranca: se vuelve a pedir hasta que este listo. La primera
       descarga puede tardar varios minutos. */
    var limite = Date.now() + 30 * 60 * 1000;
    for (;;) {
      var r = await api(prefijo() + '/connect', { method: 'POST', body: modo === 'local' ? {} : {
        wahaUrl: val('f-wahaUrl') || undefined,
        publicUrl: val('c-url') || undefined
      }});
      if (!r.preparando) break;
      estado('fb-state', r.detalle || 'Preparando WAHA…', 'ambar');
      if (Date.now() > limite) throw new Error('WAHA sigue sin arrancar. Revisa Docker Desktop y vuelve a pulsar el botón.');
      await new Promise(function (ok) { setTimeout(ok, 4000); });
    }
    pararSondeo();
    arrancarSondeo();
  } catch (error) {
    estado('fb-state', error.message, 'rojo');
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
$('pair-ask').onclick = async function () {
  var boton = this;
  var telefono = val('pair-phone').replace(/\D/g, '');
  if (telefono.length < 8) {
    estado('fb-state', 'Escribe tu número completo, con código de país (por ejemplo 51987654321).', 'ambar');
    $('pair-phone').focus();
    return;
  }

  boton.disabled = true;
  try {
    var r = await api(prefijo() + '/request-code', { method: 'POST', body: { phone: telefono } });
    if (!r.code) throw new Error('Este motor de WAHA no da códigos para vincular. Escanea el QR de arriba.');
    var caja = $('pair-code');
    // WAHA lo manda de corrido; partirlo por la mitad es como lo enseña la app.
    caja.textContent = r.code.length === 8 ? r.code.slice(0, 4) + ' ' + r.code.slice(4) : r.code;
    caja.classList.remove('hidden');
    estado('fb-state', 'Teclea ese código en el teléfono, en «Vincular con el número de teléfono»', 'ambar');
  } catch (error) {
    estado('fb-state', error.message, 'rojo');
  } finally {
    boton.disabled = false;
  }
};

/* Antes habia dos botones para lo mismo ("Desconectar la cuenta" y
   "Desvincular el teléfono"): los dos llamaban al mismo /logout. Queda uno,
   con la pregunta de confirmacion del armazon. */
$('desconectar').onclick = async function () {
  var ok = await confirmarDialogo({
    titulo: '¿Desconectar la cuenta de WhatsApp?',
    texto: 'Se cierra la sesión de este sistema y el teléfono deja de verlo entre sus dispositivos vinculados. ' +
      'No se pierde nada de lo guardado aquí (chats, contactos, historial). Para volver, se escanea otro código.',
    boton: 'Sí, desconectar',
    peligro: true
  });
  if (!ok) return;

  var boton = this;
  boton.disabled = true;
  try {
    await api(prefijo() + '/logout', { method: 'POST', body: {} });
    qr.conectado = false;
    qr.parado = true;
    pintarQr('');
    estado('fb-state', 'Cuenta desconectada. Pulsa «' + MODOS[modo].boton + '» para volver a conectar.', 'ambar');
    await cargar();
  } catch (error) {
    estado('fb-state', error.message, 'rojo');
  } finally {
    boton.disabled = false;
  }
};

/* --- paso 3, variante Meta: la ventana de registro incorporado ---------- */
function cargarSdk() {
  if (window.FB || window.__sdkPedido || !opciones.appId) return;
  window.__sdkPedido = true;
  window.fbAsyncInit = function () {
    FB.init({ appId: opciones.appId, cookie: true, xfbml: false, version: opciones.graphVersion || 'v25.0' });
  };
  var s = document.createElement('script');
  s.src = 'https://connect.facebook.net/es_LA/sdk.js';
  s.async = true;
  s.defer = true;
  s.crossOrigin = 'anonymous';
  /* Sin esto, un bloqueador de anuncios dejaba el boton diciendo "todavia
     esta cargando" para siempre, sin decir nunca que hacer. */
  s.onerror = function () {
    window.__sdkPedido = false;
    estado('fb-state', 'No se pudo cargar la ventana de Meta: suele ser un bloqueador de anuncios o la red. ' +
      'Desactívalo para esta página y recarga, o usa «Ya tengo un token de Meta».', 'rojo');
  };
  document.head.appendChild(s);
}

/* La ventana manda por postMessage el id de la cuenta y el del numero.
   Registro incorporado v4: termina con FINISH (numero dedicado),
   FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING (el numero sigue en el celular:
   sin PIN) o FINISH_ONLY_WABA (no eligio numero); CANCEL dice en que
   pantalla se salio y ERROR trae el motivo. */
var elegido = { wabaId: null, phoneNumberId: null, coexistencia: false, sinNumero: false };
var PASOS_META = {
  PHONE_NUMBER_SETUP: 'la pantalla del número',
  BUSINESS_ACCOUNT_SELECTION: 'la elección de la cuenta',
  WABA_SELECTION: 'la elección de la cuenta de WhatsApp',
  PHONE_NUMBER_VERIFICATION: 'la verificación del número'
};
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
      estado('fb-state', 'Cerraste la ventana de Meta en ' + (PASOS_META[d.current_step] || 'el paso ' + (d.current_step || '?')) +
        '. Vuelve a pulsar el botón y termina hasta el final.', 'ambar');
    } else if (data.event === 'ERROR') {
      estado('fb-state', 'Meta dio un error en su ventana: ' + (d.error_message || d.error_code || 'sin detalle') +
        '. Inténtalo de nuevo; si sigue, revisa que la configuración de registro incorporado sea v4.', 'rojo');
    }
  } catch (error) { /* la ventana manda tambien mensajes que no son JSON */ }
});

$('fb-login').onclick = function () {
  if (!window.FB) {
    estado('fb-state', 'La ventana de Meta todavía está cargando: espera un segundo y vuelve a pulsar.', 'ambar');
    cargarSdk();
    return;
  }
  /* Lo que trajo un intento anterior no vale para este: sin esto, una ventana
     cerrada a medias mandaba al servidor el numero del intento de antes. */
  elegido = { wabaId: null, phoneNumberId: null, coexistencia: false, sinNumero: false };
  estado('fb-state', 'Abriendo la ventana de Meta…', 'ambar');

  FB.login(function (response) {
    var code = response && response.authResponse && response.authResponse.code;
    if (!code) return estado('fb-state', 'Cerraste la ventana sin terminar. Vuelve a pulsar el botón.', 'ambar');
    if (elegido.sinNumero) {
      return estado('fb-state', 'La ventana terminó sin elegir número (solo la cuenta). Vuelve a pulsar el botón y elige o crea el número.', 'ambar');
    }
    terminarRapido(code);
  }, {
    config_id: opciones.signupConfigId,
    response_type: 'code',
    override_default_response_type: true,
    // v4: solo setup; el flujo lo decide la configuracion en Meta.
    extras: (opciones.modes || {})[modo] || { setup: {} }
  });
};

async function terminarRapido(code) {
  estado('fb-state', 'Conectando…', 'ambar');
  try {
    var r = await api('/admin/connect/signup', { method: 'POST', body: {
      code: code,
      wabaId: elegido.wabaId,
      phoneNumberId: elegido.phoneNumberId,
      coexistencia: elegido.coexistencia || modo === 'coexistence' || undefined,
      publicUrl: val('c-url') || undefined
    }});
    await trasConectar(r);
  } catch (error) {
    estado('fb-state', error.message, 'rojo');
  }
}

/* --- paso 3, variante manual: pegar el token ---------------------------- */
async function conectar(phoneNumberId) {
  var boton = $('connect');
  boton.disabled = true;
  estado('fb-state', 'Conectando…', 'ambar');
  try {
    var cuerpo = {};
    if (phoneNumberId) cuerpo.phoneNumberId = phoneNumberId;
    if (val('c-url')) cuerpo.publicUrl = val('c-url');

    var r = await api('/admin/connect', { method: 'POST', body: cuerpo });

    if (r.needsChoice) {
      var lista = $('choice-list');
      lista.innerHTML = (r.numbers || []).map(function (n) {
        return '<label class="opcion" data-id="' + esc(n.phoneNumberId) + '" tabindex="0" role="button">' +
          '<span class="txt"><b>' + esc(n.displayPhoneNumber || n.phoneNumberId) + '</b>' +
          '<span>' + esc(n.verifiedName || '') + ' · ' + esc(n.accountName) + '</span></span></label>';
      }).join('');
      lista.querySelectorAll('.opcion').forEach(function (el) {
        var elegir = function () {
          $('choice').classList.add('hidden');
          conectar(el.getAttribute('data-id'));
        };
        el.onclick = elegir;
        el.onkeydown = function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); elegir(); } };
      });
      $('choice').classList.remove('hidden');
      estado('fb-state', 'Elige con qué número quieres trabajar', 'ambar');
      return;
    }

    await trasConectar(r);
  } catch (error) {
    estado('fb-state', error.message, 'rojo');
  } finally {
    boton.disabled = false;
  }
}
$('connect').onclick = function () { conectar(); };

/** Lo que devuelven las dos rutas de conexion, pintado igual en los dos casos. */
async function trasConectar(r) {
  var pasos = r.steps || [];
  var caja = $('steps');
  caja.innerHTML = pasos.map(function (s) {
    return '<div class="paso-resultado"><span class="marca ' + (s.ok ? 'si' : 'no') + '">' + (s.ok ? '✓' : '✕') + '</span>' +
      '<div><b>' + esc(s.step) + '</b><span>' + esc(s.detail) + '</span></div></div>';
  }).join('');
  caja.classList.toggle('hidden', !pasos.length);

  /* "Conectado con avisos" no decia cual: el que fallo esta en la lista de
     arriba, asi que se nombra para que se sepa donde mirar. */
  var mal = pasos.filter(function (s) { return !s.ok; });
  estado('fb-state', r.ok ? 'Conectado' : 'Conectado, pero falló: ' + mal.map(function (s) { return s.step; }).join(', '),
    r.ok ? 'verde' : 'ambar');

  ver('pin-box', !!r.needsRegistration);
  await cargar();
}

$('register').onclick = async function () {
  var boton = this;
  var pin = val('pin').replace(/\D/g, '');
  if (pin.length !== 6) {
    estado('reg-state', 'El PIN son seis dígitos.', 'ambar');
    $('pin').focus();
    return;
  }
  boton.disabled = true;
  try {
    var r = await api('/admin/settings/register', { method: 'POST', body: { pin: pin } });
    if (r.success) {
      estado('reg-state', 'Número activado', 'verde');
      ver('pin-box', false);
      await cargar();
    } else {
      estado('reg-state', 'Meta no confirmó la activación. Revisa que el PIN sea el de la verificación en dos pasos.', 'ambar');
    }
  } catch (error) { estado('reg-state', error.message, 'rojo'); }
  finally { boton.disabled = false; }
};

/* --- paso 4: la prueba -------------------------------------------------- */
function pintarPaso4(paso) {
  marcarPaso('paso4', paso, 4, 'Primero hay que conectar la cuenta (paso 3).');
}

$('sendTest').onclick = async function () {
  var boton = this;
  var digitos = val('testPhone').replace(/\D/g, '');
  if (digitos.length === 9) digitos = '51' + digitos;
  if (digitos.length !== 11 || digitos.indexOf('51') !== 0) {
    estado('test-state', 'Escribe los nueve dígitos de tu celular, sin el +51.', 'ambar');
    $('testPhone').focus();
    return;
  }
  boton.disabled = true;
  estado('test-state', 'Enviando…', 'ambar');
  try {
    var r = await api('/admin/settings/test-message', { method: 'POST', body: { phone: digitos } });
    pruebaHecha = !!r.ok;
    estado('test-state', r.ok ? 'Enviado: revisa tu WhatsApp' : ('No salió: ' + (r.reason || r.error || 'sin motivo')),
      r.ok ? 'verde' : 'ambar');
    pintar();
  } catch (error) { estado('test-state', error.message, 'rojo'); }
  finally { boton.disabled = false; }
};

/* --- avanzado ----------------------------------------------------------- */
function values() {
  var out = {};
  FIELDS.forEach(function (f) { var v = val(f); if (v) out[f] = v; });
  return out;
}
$('save').onclick = async function () {
  try {
    var data = await api('/admin/settings', { method: 'POST', body: values() });
    estado('manual-state', data.ok ? 'Guardado y conectado' : ('Guardado: ' + data.detail), data.ok ? 'verde' : 'ambar');
    await cargar();
  } catch (error) { estado('manual-state', error.message, 'rojo'); }
};
$('test').onclick = async function () {
  try {
    var data = await api('/admin/settings/test', { method: 'POST', body: values() });
    estado('manual-state', data.ok ? 'Conexión correcta' : data.detail, data.ok ? 'verde' : 'rojo');
  } catch (error) { estado('manual-state', error.message, 'rojo'); }
};

document.querySelectorAll('[data-copy]').forEach(function (b) {
  b.onclick = async function () {
    await copiar(val(b.getAttribute('data-copy')));
    b.textContent = 'Copiado';
    setTimeout(function () { b.textContent = 'Copiar'; }, 1200);
  };
});

/* --- los avisos con fecha de Meta (solo con la API oficial) -------------- */
function pintarAvisosMeta(avisos) {
  var caja = $('avisos-meta');
  var conMeta = esMeta() || guardado.provider === 'cloud';
  if (!avisos.length || !conMeta) { caja.classList.add('hidden'); caja.innerHTML = ''; return; }
  var TONO = { vencido: 'rojo', urgente: 'ambar', pendiente: 'gris', hecho: 'verde', ok: 'verde' };
  caja.innerHTML = '<h3>Lo que Meta cambia con fecha</h3>' + avisos.map(function (a) {
    var cuando = a.estado === 'hecho' ? 'hecho el ' + fecha(a.hechoEl)
      : a.estado === 'ok' ? 'al día'
      : a.diasRestantes < 0 ? 'venció hace ' + (-a.diasRestantes) + ' días'
      : a.diasRestantes === 0 ? 'vence hoy'
      : 'quedan ' + a.diasRestantes + ' días (hasta el ' + fecha(a.limite + 'T12:00:00') + ')';
    var terminado = a.estado === 'hecho' || a.estado === 'ok';
    return '<div class="nota' + (TONO[a.estado] === 'ambar' || TONO[a.estado] === 'rojo' ? ' riesgo' : '') + '">' +
      '<span class="chip tono-' + (TONO[a.estado] || 'gris') + '">' + esc(cuando) + '</span> <b>' + esc(a.titulo) + '</b>' +
      (terminado ? '' : '<br>' + esc(a.detalle)) +
      (a.marcable && a.estado !== 'hecho'
        ? '<div class="acciones"><button class="btn sm" type="button" data-aviso-hecho="' + esc(a.id) + '">Ya lo hice</button></div>'
        : '') +
      '</div>';
  }).join('');
  caja.classList.remove('hidden');
  caja.querySelectorAll('[data-aviso-hecho]').forEach(function (b) {
    b.onclick = async function () {
      var id = b.getAttribute('data-aviso-hecho');
      var meta = {};
      meta[id === 'metodoPago' ? 'metodoPagoEl' : 'registroV4El'] = new Date().toISOString();
      b.disabled = true;
      try {
        await api('/admin/ajustes', { method: 'POST', body: { meta: meta } });
        opciones = await api('/admin/connect/options');
        pintarAvisosMeta(opciones.avisosMeta || []);
      } catch (error) { estado('fb-state', error.message, 'rojo'); b.disabled = false; }
    };
  });
}

/* --- carga -------------------------------------------------------------- */
var cargando = null;
var proveedorArreglado = false;

/** Lee lo guardado y las opciones, y repinta. Nunca dos a la vez. */
function cargar() {
  if (cargando) return cargando;
  cargando = (async function () {
    try {
      var data = await api('/admin/settings');
      guardado = {};
      FIELDS.forEach(function (f) {
        var input = $(f);
        var value = data.masked[f] || '';
        guardado[f] = value;
        if (!input) return;
        if (SECRETS.indexOf(f) >= 0) input.placeholder = value || '';
        else input.value = value;
      });
      faltanCredenciales = !!(data.missing || []).length;
      setVal('hookUrl', data.webhookUrl);
      setVal('hookToken', data.verifyToken || '(se crea sola al conectar)');
      if (!val('c-url')) setVal('c-url', String(data.webhookUrl || '').replace('/webhooks/whatsapp', ''));

      // Sin eleccion previa manda lo que ya este guardado en el servidor.
      if (!modo && (guardado.provider === 'waha' || guardado.provider === 'local')) modo = guardado.provider;

      /* Si el navegador recuerda un camino y el servidor esta en otro (el
         guardado del proveedor fallo, o se cambio desde otra pantalla), los
         dos tienen que volver a decir lo mismo: con el proveedor equivocado
         los mensajes salen por donde no es. Se arregla una sola vez. */
      var quiere = modo ? (esQr() ? modo : 'cloud') : '';
      if (quiere && guardado.provider && guardado.provider !== quiere && !proveedorArreglado) {
        proveedorArreglado = true;
        await api('/admin/settings', { method: 'POST', body: { provider: quiere } }).catch(function () {});
        guardado.provider = quiere;
      }

      opciones = await api('/admin/connect/options');
      pintarAvisosMeta(opciones.avisosMeta || []);

      /* El "Conectado" de arriba tiene que decir la verdad: con QR, el
         servidor no echa en falta ninguna credencial (no hay ninguna que
         pedir), asi que mirar solo missing daba por conectado un sistema
         que ni siquiera habia enseñado el codigo. */
      var conectado = estaConectado();
      estado('state', conectado ? 'Conectado' : 'Sin conectar', conectado ? 'verde' : 'ambar');
      pintar();
    } catch (error) {
      estado('state', 'Sin conectar', 'rojo');
      estado('paso2-state', error.message, 'rojo');
    } finally {
      cargando = null;
    }
  })();
  return cargando;
}

$('app').classList.remove('hidden');
cargar();
/* Al volver a la pestaña, el estado del QR puede haber cambiado hace rato. */
document.addEventListener('visibilitychange', function () { if (!document.hidden && esQr()) void estadoQr(); });

/* ---------------------------------------------------------- perfil y GSG */
var perfilElegido = null;
var perfilAbierto = false;

function pintarPerfiles(r) {
  var caja = $('perfil-lista');
  if (!caja) return;
  var actual = r.actual ? r.actual.perfil : null;
  perfilElegido = perfilElegido || actual || 'reparto';
  /* Con «Solo lo de GSG» no se ofrecen los perfiles de venta (tienda, atención comercial):
     GSGchat es operativo. Siguen ahí con «Todo el sistema» (Ajustes → Qué se enseña). */
  var app = document.querySelector('.s-app');
  var modoGsg = window.__modoSistema === 'gsg' || Boolean(app && app.classList.contains('modo-gsg'));
  var visibles = (r.perfiles || []).filter(function (p) { return !(modoGsg && p.ventas && p.id !== actual && p.id !== perfilElegido); });
  caja.innerHTML = visibles.map(function (p) {
    var es = p.id === perfilElegido;
    return '<label class="' + (es ? 'elegido' : '') + '"><input type="radio" name="perfil" value="' + esc(p.id) + '"' + (es ? ' checked' : '') + '>' +
      '<b>' + esc(p.nombre) + '</b><span class="ayuda">' + esc(p.descripcion) + '</span><ul>' +
      (p.cambia || []).map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>' +
      (actual === p.id ? '<span class="actual">✓ En uso' + (r.actual && r.actual.en ? ' desde el ' + fecha(r.actual.en) : '') + '</span>' : '') +
      '</label>';
  }).join('');
  caja.querySelectorAll('input[name=perfil]').forEach(function (i) {
    i.onchange = function () { perfilElegido = i.value; pintarPerfiles(r); };
  });
  texto('perfil-aplicar', actual === perfilElegido ? 'Volver a aplicar este perfil' : 'Aplicar este perfil');

  var sec = $('perfil');
  var nombreActual = '';
  (r.perfiles || []).forEach(function (p) { if (p.id === actual) nombreActual = p.nombre; });
  if (actual && nombreActual && !perfilAbierto) {
    texto('perfil-resumen-texto', '✓ Perfil en uso: ' + nombreActual + (r.actual && r.actual.en ? ' (desde el ' + fecha(r.actual.en) + ')' : ''));
    sec.classList.add('plegado');
  } else {
    sec.classList.remove('plegado');
  }
}

async function cargarPerfil() {
  if (!$('perfil-lista')) return;
  try {
    pintarPerfiles(await api('/admin/perfil'));
  } catch (error) {
    /* Sin perfiles el boton no haria nada: mejor decirlo que dejarlo muerto. */
    $('perfil-lista').innerHTML = '<p class="ayuda">No se pudieron cargar los perfiles: ' + esc(error.message) + '</p>';
    $('perfil-aplicar').disabled = true;
  }
}

if ($('perfil')) {
  $('perfil-cambiar').onclick = function () { perfilAbierto = true; $('perfil').classList.remove('plegado'); };
  $('perfil-aplicar').onclick = async function () {
    if (!perfilElegido) return;
    var ok = await confirmarDialogo({
      titulo: 'Aplicar el perfil',
      texto: 'Se cambian el menú, qué contesta solo y los interruptores de las entregas. Tus textos, tus clientes y tus motorizados no se tocan.',
      boton: 'Aplicar'
    });
    if (!ok) return;
    try {
      var r = await api('/admin/perfil', { method: 'POST', body: { perfil: perfilElegido } });
      estado('perfil-state', r.detalle + ' La pantalla se recarga para enseñar el menú que toca.', 'verde');
      setTimeout(function () { location.reload(); }, 1800);
    } catch (error) { estado('perfil-state', error.message, 'rojo'); }
  };
  cargarPerfil();
}

async function cargarGsg() {
  var caja = $('gsg-estado');
  if (!caja) return;
  try {
    var r = await api('/admin/entregas/gsg');
    var g = r.gsg;
    if (!g) { caja.textContent = 'La conexión con GSG se fija al arrancar el servidor.'; return; }
    var tono = g.modo === 'ninguna' ? 'rojo' : g.modo === 'simulador' ? 'azul' : 'verde';
    caja.innerHTML = '<span class="chip tono-' + tono + '">' + esc(g.descripcion) + '</span>' +
      (g.ultimaPrueba ? '<br><span class="ayuda">Última prueba: ' + esc(g.ultimaPrueba.detalle) + '</span>' : '');
    /* La tarjeta de arriba: en que esta GSG, en palabras, y el formulario abierto solo si falta. */
    var chipGsg = $('gsg-chip');
    if (chipGsg) {
      caja.classList.toggle('hidden', !g.ultimaPrueba);
      chipGsg.className = 'chip tono-' + (g.modo === 'ninguna' ? 'ambar' : tono);
      chipGsg.textContent = g.modo === 'real' ? 'Conectado' : g.modo === 'simulador' ? 'Simulador (pruebas)' : 'Sin conectar';
      $('gsg-frase').innerHTML = g.modo === 'real'
        ? 'Los pedidos del día entran solos, y cada ubicación registrada le llega a GSG.'
        : g.modo === 'simulador'
          ? 'Estás probando con pedidos ficticios. Cuando GSG te dé su <b>dirección</b> y su <b>clave</b>, ponlas aquí.'
          : 'Falta la <b>dirección</b> del sistema de GSG y su <b>clave (token)</b>. Te las dan sus programadores.';
      var cajaForm = $('gsg-form-caja');
      if (cajaForm && g.modo === 'ninguna') cajaForm.open = true;
      texto('gsg-form-resumen', g.modo === 'real' ? 'Cambiar la dirección o la clave' : 'Poner la dirección y la clave de GSG');
    }
    ver('gsg-simulador', !(g.modo === 'simulador' || !r.simulador));
    ver('gsg-quitar', g.modo !== 'ninguna');
    ver('gsg-probar', g.modo !== 'ninguna');
    // Lo guardado a la vista (la clave no: solo si ya hay una).
    if (g.modo === 'real' && g.url && !$('gsg-url').value) $('gsg-url').value = g.url;
    var hayClave = g.modo === 'real' && g.tieneToken;
    $('gsg-token').placeholder = hayClave ? '•••••••• (guardada)' : '';
    $('gsg-token-pista').textContent = hayClave
      ? 'Ya hay una guardada. Déjala vacía para conservarla, o pega una nueva para cambiarla.'
      : 'También te la dan ellos. Se guarda cifrada y no se vuelve a mostrar.';
  } catch (error) { caja.textContent = error.message; }
}

if ($('gsg')) {
  /* El resultado de la prueba, en una frase que se lee sin saber de APIs. */
  function resultadoGsg(texto, tono) {
    var caja = $('gsg-resultado');
    caja.textContent = texto;
    caja.className = tono;
    ver('gsg-resultado', Boolean(texto));
  }
  async function probarGsg() {
    resultadoGsg('Probando la conexión con GSG…', 'espera');
    try {
      var r = await api('/admin/entregas/gsg/probar', { method: 'POST', body: {} });
      resultadoGsg((r.ok ? '✓ Funciona. ' : '✗ No responde bien. ') + r.prueba.detalle, r.ok ? 'bien' : 'mal');
    } catch (error) { resultadoGsg('✗ ' + error.message, 'mal'); }
    cargarGsg();
  }
  $('gsg-probar').onclick = probarGsg;
  $('gsg-token-ver').onclick = function () {
    var t = $('gsg-token');
    var visible = t.type === 'text';
    t.type = visible ? 'password' : 'text';
    this.textContent = visible ? 'Mostrar' : 'Ocultar';
    this.setAttribute('aria-pressed', visible ? 'false' : 'true');
  };
  $('gsg-form').onsubmit = async function (ev) {
    ev.preventDefault();
    var url = $('gsg-url').value.trim();
    var campoUrl = $('gsg-url');
    campoUrl.removeAttribute('aria-invalid');
    if (!/^https?:\/\/[^\s/]+/i.test(url)) {
      campoUrl.setAttribute('aria-invalid', 'true');
      campoUrl.focus();
      resultadoGsg('Escribe la dirección completa, empezando por https:// (por ejemplo https://api.gsg.pe/v1).', 'mal');
      return;
    }
    var boton = $('gsg-guardar');
    boton.disabled = true;
    resultadoGsg('Guardando…', 'espera');
    try {
      var token = $('gsg-token').value.trim();
      await api('/admin/entregas/gsg', { method: 'POST', body: { modo: 'real', url: url, token: token || undefined } });
      $('gsg-token').value = '';
      await probarGsg();
    } catch (error) { resultadoGsg('✗ No se pudo guardar: ' + error.message, 'mal'); }
    boton.disabled = false;
  };
  $('gsg-simulador').onclick = async function () {
    try { await api('/admin/entregas/gsg', { method: 'POST', body: { modo: 'simulador' } }); estado('gsg-state', 'Ahora GSG es el simulador de este servidor. Cárgalo desde Hoy → Probar con números ficticios.', 'verde'); cargarGsg(); }
    catch (error) { estado('gsg-state', error.message, 'rojo'); }
  };
  $('gsg-quitar').onclick = async function () {
    var ok = await confirmarDialogo({ titulo: 'Desconectar GSG', texto: 'Lo reportable se guarda en la cola y saldrá entero cuando se vuelva a conectar.', boton: 'Desconectar', peligro: true });
    if (!ok) return;
    try { await api('/admin/entregas/gsg', { method: 'DELETE' }); $('gsg-url').value = ''; resultadoGsg('', ''); estado('gsg-state', 'Desconectado: lo que haya que mandarle a GSG se guarda y saldrá entero al volver a conectar.', 'verde'); cargarGsg(); }
    catch (error) { estado('gsg-state', error.message, 'rojo'); }
  };

  setVal('gsg-api-url', location.origin + '/api/v1/entregas');
  $('gsg-api-copiar').onclick = function () { copiar(val('gsg-api-url'), 'gsg-clave-state', 'Dirección'); };
  $('gsg-clave-copiar').onclick = function () { copiar($('gsg-clave-valor').textContent, 'gsg-clave-state', 'Clave'); };
  $('gsg-sim-url-copiar').onclick = function () { copiar(val('gsg-sim-url'), 'gsg-sim-state', 'Dirección'); };
  $('gsg-sim-copiar').onclick = function () { copiar($('gsg-sim-valor').textContent, 'gsg-sim-state', 'Token'); };

  $('gsg-clave').onclick = async function () {
    if (!(await confirmarDialogo({ titulo: 'Crear la clave para GSG', texto: 'Se crea una clave de API llamada "GSG" con permiso para mandar y ver las entregas del día y registrar webhooks. Si ya había una clave "GSG", sigue valiendo.', boton: 'Crear la clave' }))) return;
    try {
      var r = await api('/admin/claves-api', { method: 'POST', body: { nombre: 'GSG', permisos: ['entregas:gestionar', 'entregas:leer', 'webhooks:gestionar'] } });
      $('gsg-clave-valor').textContent = r.clave;
      $('gsg-clave-pasos').innerHTML = [
        'Dásela a los programadores de GSG junto con esta dirección: ' + location.origin + '/api/v1/entregas',
        'Cada pedido nuevo lo mandan con POST y la cabecera Authorization: Bearer <la clave>.',
        'Para enterarse de lo que pasa, registran un webhook con POST ' + location.origin + '/api/v1/webhooks.',
        'Pueden probar contra el simulador antes de tocar nada real: está explicado en el contrato.',
      ].map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('');
      ver('gsg-clave-nueva', true);
      estado('gsg-clave-state', 'Clave creada.', 'verde');
    } catch (error) { estado('gsg-clave-state', error.message, 'rojo'); }
  };

  var HALLAZGO = { ok: ['verde', 'bien'], falta: ['rojo', 'falta'], formato: ['rojo', 'formato'], sobra: ['ambar', 'sobra'], aviso: ['ambar', 'aviso'] };
  function pintarHallazgos(v) {
    var caja = $('gsg-verificacion');
    if (!v) { caja.classList.add('hidden'); return; }
    var filas = (v.hallazgos || []).filter(function (h) { return h.tipo !== 'ok'; });
    var html = '<div><span class="chip tono-' + (v.ok ? 'verde' : 'rojo') + '">' + esc(v.resumen) + '</span> <span class="ayuda">' + esc(hora(v.at)) + '</span></div>';
    if (filas.length) {
      html += '<ul>' + filas.map(function (h) {
        var t = HALLAZGO[h.tipo] || ['ambar', h.tipo];
        return '<li><span class="chip tono-' + t[0] + '">' + t[1] + '</span> <b>' + esc(h.donde) + '</b>: ' + esc(h.detalle) + '</li>';
      }).join('') + '</ul>';
    } else if (v.ok) {
      html += '<p class="ayuda">Todas las listas y todos los pedidos vienen como este sistema los espera.</p>';
    }
    caja.innerHTML = html;
    caja.classList.remove('hidden');
  }
  function pintarCuadre(c) {
    var caja = $('gsg-cuadre');
    if (!c) { caja.classList.add('hidden'); return; }
    var html = '<div><span class="chip tono-' + (c.ok ? 'verde' : 'ambar') + '">' + esc(c.resumen) + '</span> <span class="ayuda">' + esc(c.dia) + ' · ' + esc(hora(c.at)) + '</span></div>';
    if (c.faltanEnGsg && c.faltanEnGsg.length) html += '<p><b>Cerrados aquí que GSG no tiene como terminados:</b> ' + esc(c.faltanEnGsg.join(', ')) + '. Suele ser que el reporte no salió: mira «reportes que GSG no aceptó» en Hoy y pulsa Reintentar.</p>';
    if (c.sobranEnGsg && c.sobranEnGsg.length) html += '<p><b>Terminados en GSG que aquí siguen abiertos:</b> ' + esc(c.sobranEnGsg.join(', ')) + '. Revísalos en Hoy: si ya se entregaron, márcalos «Entregada».</p>';
    caja.innerHTML = html;
    caja.classList.remove('hidden');
  }
  function pintarExtras(r) {
    var d = r.descartes || { lista: [] };
    if (d.lista && d.lista.length) {
      texto('gsg-descartes-titulo', d.lista.length + (d.lista.length === 1 ? ' pedido de hoy no se pudo leer' : ' pedidos de hoy no se pudieron leer'));
      $('gsg-descartes-lista').innerHTML = d.lista.map(function (x) {
        return '<li><b>' + esc(x.referencia) + '</b> (' + esc(x.lista === 'faltaUbicacion' ? 'lista de ubicación' : 'lista de confirmación') + '): ' + esc(x.motivo) + '</li>';
      }).join('');
      ver('gsg-descartes', true);
    } else ver('gsg-descartes', false);

    pintarHallazgos(r.verificacion);
    pintarCuadre(r.cuadre);

    ver('gsg-sim', !!r.conSimulador);
    if (r.conSimulador) {
      setVal('gsg-sim-url', location.origin + r.rutaSimulador);
      var tokens = r.tokens || [];
      $('gsg-sim-lista').innerHTML = tokens.length ? tokens.map(function (t) {
        var tono = t.estado === 'vigente' ? 'verde' : t.estado === 'caducado' ? 'ambar' : 'rojo';
        return '<li><span class="chip tono-' + tono + '">' + esc(t.estado) + '</span> <b>' + esc(t.nombre) + '</b> (…' + esc(t.pista) + ')' +
          ' · caduca el ' + esc(fecha(t.caducaAt)) + ' · ' + t.usos + ' llamada' + (t.usos === 1 ? '' : 's') +
          (t.ultimoUsoAt ? ', la última a las ' + esc(hora(t.ultimoUsoAt)) : '') +
          (t.estado === 'vigente' ? ' <a href="#" data-anular="' + esc(t.id) + '">Anular</a>' : '') + '</li>';
      }).join('') : '<li>Todavía no hay tokens: crea uno y pásaselo a los programadores de GSG.</li>';
      $('gsg-sim-lista').querySelectorAll('[data-anular]').forEach(function (a) {
        a.onclick = async function (ev) {
          ev.preventDefault();
          if (!(await confirmarDialogo({ titulo: 'Anular el token', texto: 'Desde ahora ese token no vale: quien lo use recibirá "token caducado o anulado". Se puede crear otro.', boton: 'Anular', peligro: true }))) return;
          try { await api('/admin/gsg/tokens-simulador/' + a.getAttribute('data-anular'), { method: 'DELETE' }); estado('gsg-sim-state', 'Token anulado.', 'verde'); cargarExtras(); }
          catch (error) { estado('gsg-sim-state', error.message, 'rojo'); }
        };
      });
    }

    var llamadas = r.bitacora || [];
    $('gsg-bitacora').innerHTML = llamadas.length
      ? '<table><thead><tr><th>Hora</th><th>Llamada</th><th>Con qué entró</th><th>Qué pasó</th></tr></thead><tbody>' +
        llamadas.map(function (l) {
          return '<tr><td>' + esc(hora(l.en)) + '</td><td><code>' + esc(l.que) + '</code></td><td>' + esc(l.quien) +
            '</td><td><span class="chip tono-' + (l.status >= 400 ? 'rojo' : 'verde') + '">' + l.status + '</span> ' + esc(l.resultado) + '</td></tr>';
        }).join('') + '</tbody></table>'
      : 'Todavía nadie ha llamado. Cuando GSG (o sus programadores, con el token del simulador) manden algo, aquí se verá qué llegó y qué se les contestó.';
  }
  async function cargarExtras() {
    try { pintarExtras(await api('/admin/gsg')); } catch (error) { estado('gsg-state', error.message, 'rojo'); }
  }

  $('gsg-verificar').onclick = async function () {
    estado('gsg-verificar-state', 'Preguntando a GSG…', 'ambar');
    try { var r = await api('/admin/gsg/verificar-contrato', { method: 'POST', body: {} }); pintarHallazgos(r.verificacion); estado('gsg-verificar-state', r.ok ? 'El contrato se cumple.' : 'Hay cosas que corregir (abajo).', r.ok ? 'verde' : 'rojo'); }
    catch (error) { estado('gsg-verificar-state', error.message, 'rojo'); }
  };
  $('gsg-cuadrar').onclick = async function () {
    estado('gsg-verificar-state', 'Cuadrando…', 'ambar');
    try { var r = await api('/admin/gsg/cuadre'); pintarCuadre(r.cuadre); estado('gsg-verificar-state', r.cuadre.ok ? 'El día cuadra.' : 'Hay diferencias (abajo).', r.cuadre.ok ? 'verde' : 'ambar'); }
    catch (error) { estado('gsg-verificar-state', error.message, 'rojo'); }
  };
  $('gsg-sim-token').onclick = async function () {
    try {
      var nombre = await pedirDato({ titulo: 'Token del simulador', texto: 'Un nombre para reconocerlo en la lista. Caduca a los 30 días; después se crea otro.', etiqueta: 'Para quién es', marcador: 'Programadores de GSG', boton: 'Crear el token', validar: function () { return null; } });
      if (nombre === null) return;
      var r = await api('/admin/gsg/tokens-simulador', { method: 'POST', body: { nombre: nombre || undefined, dias: 30 } });
      $('gsg-sim-valor').textContent = r.token;
      ver('gsg-sim-nuevo', true);
      estado('gsg-sim-state', 'Token creado: caduca en 30 días.', 'verde');
      cargarExtras();
    } catch (error) { estado('gsg-sim-state', error.message, 'rojo'); }
  };
  $('gsg-bitacora-refrescar').onclick = function (ev) { ev.preventDefault(); cargarExtras(); };
  $('gsg-sim-cancelar').onclick = async function () {
    try { var r = await api('/admin/gsg/simulador/cancelar-uno', { method: 'POST', body: {} }); estado('gsg-sim-prueba-state', r.detalle, 'verde'); cargarExtras(); }
    catch (error) { estado('gsg-sim-prueba-state', error.message, 'rojo'); }
  };
  $('gsg-sim-cambiar').onclick = async function () {
    try { var r = await api('/admin/gsg/simulador/cambiar-uno', { method: 'POST', body: {} }); estado('gsg-sim-prueba-state', r.detalle, 'verde'); cargarExtras(); }
    catch (error) { estado('gsg-sim-prueba-state', error.message, 'rojo'); }
  };
  cargarGsg();
  cargarExtras();
}
`;

  return appShell({
    titulo: opts.conGsg ? 'Conexión' : 'Conexión de WhatsApp',
    subtitulo: 'WhatsApp y GSG: si están conectados y qué falta',
    contenido,
    script,
    css: CSS,
    nombreNegocio: opts.nombreNegocio,
    demo: opts.demo,
    icono: '🔌',
  });
}
