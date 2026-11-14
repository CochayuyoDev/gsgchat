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

import { appShell, icono, modoVigente } from './shell.js';

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
    titulo: 'Escanear el QR (WhatsApp normal o Business)',
    resumen:
      'Escaneas el código desde tu WhatsApp, normal o Business, y queda conectado. Sin cuenta de Meta y sin instalar nada.',
    oficial: false,
    paso2: 'Este camino no pide ningún dato: la vinculación es el propio código QR.',
    paso3:
      'Pulsa el botón y sale el código. Escanéalo desde el teléfono (WhatsApp → Dispositivos vinculados). El teléfono tiene que quedarse con internet.',
    boton: 'Conectar y mostrar el QR',
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
  .wrap input:not([type=radio]):not([type=checkbox]) { width: 100%; }
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
  .nota { background: var(--superficie-2); border: 1px solid var(--borde); border-radius: var(--radio-sm); padding: 12px 14px; margin-top: var(--esp-3); font-size: 13.5px; color: var(--texto-suave); }
  .nota b { color: var(--texto); }
  .nota.riesgo { border-color: color-mix(in srgb, var(--ambar) 35%, var(--borde)); background: var(--ambar-suave); }
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
  .s-top #state { flex: none; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* --- GSG y perfiles ---------------------------------------------------- */
  .bloque { margin-top: var(--esp-4); padding-top: var(--esp-3); border-top: 1px solid var(--borde); }
  .bloque.punteado { border-top-style: dashed; }
  .acciones.pegada { margin-top: 0; }
  /* --- lineas: modo, tipo y datos de la API --------------------------------- */
  .chip-op { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--borde); border-radius: 999px; padding: 8px 14px; cursor: pointer; background: var(--superficie); min-height: 44px; }
  .chip-op input { width: 18px; height: 18px; min-height: 0; margin: 0; }
  .chip-op.elegido { border-color: var(--primario); box-shadow: 0 0 0 2px var(--primario-suave); }
  .lineas-api-campos { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: var(--esp-2); }
  .lineas-api-campos label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; min-width: 0; }
  .lineas-api-campos input { width: 100%; box-sizing: border-box; }
.lineas-api-campos input[aria-invalid="true"] { border-color: var(--rojo); box-shadow: 0 0 0 3px color-mix(in srgb, var(--rojo) 18%, transparent); }
.api-error { color: var(--rojo); font-weight: 600; font-size: 12.5px; line-height: 1.45; }
.linea-aviso { margin: 8px 0 0; padding: 9px 12px; border-radius: var(--radio-sm, 8px); font-size: 13.5px; font-weight: 600; border: 1px solid var(--borde); }
.linea-aviso.ok { color: var(--primario); border-color: color-mix(in srgb, var(--primario) 40%, transparent); background: color-mix(in srgb, var(--primario) 10%, transparent); }
.linea-aviso.mal { color: var(--rojo); border-color: color-mix(in srgb, var(--rojo) 45%, transparent); background: var(--rojo-suave); }
.check-principal { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin: var(--esp-3, 12px) 0 0; font-weight: 600; font-size: 14px; }
.check-principal input { width: auto; }
.check-principal .ayuda { font-weight: 400; margin: 0; }
.api-ejemplo { margin: var(--esp-3, 12px) 0 var(--esp-2, 8px); }
.api-ejemplo summary { cursor: pointer; font-weight: 600; color: var(--primario); }
.api-ejemplo-lista { margin: 8px 0; padding-left: 20px; font-size: 13.5px; line-height: 1.55; }
.api-ejemplo-lista li { margin: 4px 0; }
.api-ejemplo code { overflow-wrap: anywhere; }
.con-mas { margin: 0 0 var(--esp-3, 12px); }
.con-mas summary { cursor: pointer; font-weight: 600; color: var(--primario); font-size: 14px; }
  .webhook-url { font-family: ui-monospace, Consolas, monospace; overflow-wrap: anywhere; }
  .linea-fila.en-pausa { opacity: .78; }
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
  #gsg-endpoints h3, #gsg-consulta h3 { margin: 0 0 6px; }
  .ep-params { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; }
  .ep-params input { width: 100%; box-sizing: border-box; }
  #gsg-consulta .ep-form { display: grid; gap: 6px; max-width: 420px; margin: 8px 0; }
  #gsg-consulta .ep-resultado { white-space: pre-wrap; word-break: break-word; max-height: 320px; overflow: auto; padding: 10px; border-radius: 8px; background: var(--superficie-2); font-size: 12.5px; }
  #gsg-endpoints .ep { margin: 10px 0; }
  #gsg-endpoints .ep .copiar { margin-top: 4px; }
  #gsg-endpoints .ep-usos { margin: 6px 0 10px; padding-left: 18px; }
  #gsg-endpoints .ep-form { display: grid; gap: 6px; max-width: 420px; margin: 8px 0; }
  #gsg-endpoints .ep-check { display: flex; gap: 8px; align-items: center; }
  #gsg-endpoints .ep-resultado { white-space: pre-wrap; word-break: break-word; max-height: 320px; overflow: auto; padding: 10px; border-radius: 8px; background: var(--superficie-2); font-size: 12.5px; }
  #ep-llamadas { overflow-x: auto; max-width: 100%; }
  #ep-llamadas table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  #ep-llamadas th, #ep-llamadas td { text-align: left; padding: 4px 6px; vertical-align: top; }
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
#gsg-url-final { overflow-wrap: anywhere; }
#gsg-url-final.error { color: var(--rojo); font-weight: 600; }
#gsg-resultado.espera { background: var(--ambar-suave); color: var(--texto); }

/* Arriba, lo unico que importa: dos tarjetas grandes, WhatsApp y GSG. */
.wrap { max-width: var(--ancho-max, 1600px); }
.con-resumen { display: grid; gap: var(--esp-4); grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; margin-bottom: var(--esp-6); }
.con-resumen.una { grid-template-columns: minmax(0, 1fr); max-width: 560px; }
/* Conexión con GSG: la tarjeta usa el ancho y reparte sus bloques en dos columnas. */
.wrap:has(#gsg), .wrap:has(#card-wa) { max-width: 1120px; }
.con-resumen.una:has(> #card-wa) { max-width: none; }
/* WhatsApp: el estado a la izquierda y los botones a la derecha, a todo el ancho. */
@media (min-width: 900px) {
  #card-wa { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: var(--esp-5); row-gap: var(--esp-2); align-items: center; }
  #card-wa > * { grid-column: 1; }
  #card-wa > .acciones { grid-column: 2; grid-row: 1 / span 2; justify-self: end; }
  #card-wa > #qr-box { grid-column: 1 / -1; }
}
/* «Conectar con Meta, paso a paso»: una tarjeta que se despliega, con su flecha. */
#con-avanzado { border-top: none; padding-top: 0; margin-top: 16px; }
#con-avanzado > summary { list-style: none; cursor: pointer; position: relative; border: 1px solid var(--borde); border-radius: 14px; padding: 16px 56px 16px 20px; background: var(--superficie); }
#con-avanzado > summary::-webkit-details-marker { display: none; }
#con-avanzado > summary::after { content: ''; position: absolute; right: 24px; top: 50%; width: 9px; height: 9px; border-right: 2px solid var(--texto-suave); border-bottom: 2px solid var(--texto-suave); transform: translateY(-70%) rotate(45deg);  }
#con-avanzado[open] > summary::after { transform: translateY(-30%) rotate(-135deg); }
#con-avanzado > summary:hover { border-color: var(--primario); }
.con-resumen.una:has(> #gsg) { max-width: none; }
/* Secciones de la tarjeta separadas por una linea, no cajas dentro de la caja (11/11). */
#gsg .bloque.punteado { margin-top: var(--esp-5); padding: var(--esp-5) 0 0; border: 0; border-top: 1px solid var(--borde); border-radius: 0; background: transparent; }
#gsg details.bloque.punteado { padding-top: var(--esp-3); margin-top: var(--esp-3); }
#gsg .bloque.punteado .ep-form { max-width: 560px; }
#gsg .bloque.punteado h3 { margin-top: 0; }
.gsg-destinos { margin: 6px 0 10px; overflow-x: auto; font-size: 13px; color: var(--texto-suave); }
.gsg-destinos table { border: 1px solid var(--borde); border-radius: var(--radio-sm); border-collapse: separate; border-spacing: 0; overflow: hidden; margin-bottom: 8px; }
.gsg-destinos td { font-size: 13px; color: var(--texto); }
.gsg-destinos td code { background: none; border: 0; padding: 0; word-break: break-all; }
.gsg-destinos code { overflow-wrap: anywhere; }
.gsg-cuerpo summary { min-height: 0; font-size: 12.5px; font-weight: 600; color: var(--primario); }
.gsg-cuerpo code { display: block; margin-top: 6px; max-width: 420px; font-size: 11.5px; white-space: pre-wrap; }
#gsg-envios .tablewrap { margin-top: 4px; color: var(--texto); font-size: 13px; }
#gsg-envios .vacio { text-align: left; padding: 4px 0; }
#gsg-envios .vacio::before, #gsg-envios .vacio::after { display: none; }
#gsg-envios .vacio h3 { margin: 0 0 2px; font-size: 13.5px; }
#gsg-envios .vacio p { margin: 0; }
#gsg > #gsg-envios-caja:has(table) { grid-column: 1 / -1; }
@media (min-width: 1000px) {
  #gsg { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: var(--esp-5); row-gap: var(--esp-4); align-items: start; }
  #gsg > * { grid-column: 1 / -1; }
  #gsg > #gsg-consulta, #gsg > #gsg-envios-caja { grid-column: auto; }
  /* Plegada, «Lo que enviamos a GSG» es una sola línea: va debajo, no al lado de una caja alta. */
  #gsg:has(> #gsg-envios-caja:not([open])) > #gsg-consulta, #gsg > #gsg-envios-caja:not([open]) { grid-column: 1 / -1; }
}
#gsg-consulta .ep-form { max-width: 560px; }
@media (max-width: 820px) { .con-resumen { grid-template-columns: minmax(0, 1fr); } }
.con-card { padding: var(--esp-5); display: flex; flex-direction: column; gap: var(--esp-3); min-width: 0; }
@media (max-width: 640px) { .con-card { padding: var(--esp-4); } }
.con-cab { display: flex; align-items: center; gap: var(--esp-3); }
.con-ico { flex: none; width: 48px; height: 48px; border-radius: var(--radio); display: grid; place-items: center; background: var(--primario-suave); color: var(--primario); }
.con-ico .s-ico { width: 24px; height: 24px; }
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
.con-avanzado > summary { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; color: var(--texto); padding: var(--esp-3) 0; }
.con-avanzado > summary::before, #con-avanzado > summary::before { display: none; }
.con-avanzado > summary b { font-size: 15px; }
/* Lo destructivo, aparte: a la derecha y tras una linea. */
.con-pie { padding-top: var(--esp-4); border-top: 1px solid var(--borde); }
.con-pie .peligro { margin-left: auto; }
#card-wa > .acciones .peligro { margin-left: var(--esp-3); }
.con-avanzado > summary .ayuda { font-weight: 400; }
.con-avanzado[open] > summary { margin-bottom: var(--esp-3); }
`;

/* ------------------------------------------------------------------- html */

/**
 * La union URL base + ruta de GSG, para el navegador (vista previa en vivo y
 * validacion antes de guardar). Es la misma regla que `unirUrlGsg` y
 * `normalizarBaseGsg` de src/rutas/gsg.ts, con los mismos mensajes: una
 * prueba (tests/gsg-url.test.ts) corre los dos con los mismos casos y exige
 * el mismo resultado. Si se cambia una, se cambia la otra.
 */
export const UNIR_URL_GSG_JS = String.raw`function normalizarBaseGsg(base) {
  var crudo = String(base == null ? '' : base).trim();
  if (!crudo) return { ok: false, error: 'Falta la URL base de GSG.' };
  if (!/^https?:\/\/[^/\\?#]/i.test(crudo)) return { ok: false, error: 'La URL base de GSG tiene que empezar por https:// (o http://) seguido del dominio.' };
  if (/[?#]/.test(crudo)) return { ok: false, error: 'La URL base de GSG no puede llevar «?» ni «#»: pon solo la dirección, sin parámetros.' };
  if (/[\s\\]/.test(crudo)) return { ok: false, error: 'La URL base de GSG no puede llevar espacios ni barras invertidas.' };
  var u;
  try { u = new URL(crudo); } catch (e) { return { ok: false, error: 'La URL base de GSG no es una dirección válida.' }; }
  if (u.username || u.password) return { ok: false, error: 'La URL base de GSG no puede llevar usuario ni clave: la API Key va en su propio campo.' };
  var segmentos = crudo.replace(/^https?:\/\/[^/]*/i, '').split('/').filter(Boolean);
  if (segmentos.some(function (x) { return /^(%2e|\.){1,2}$/i.test(x); })) return { ok: false, error: 'La URL base de GSG no puede llevar segmentos «..».' };
  return { ok: true, url: u.protocol + '//' + u.host + (segmentos.length ? '/' + segmentos.join('/') + '/' : '/') };
}
function unirUrlGsg(base, ruta) {
  var b = normalizarBaseGsg(base);
  if (!b.ok) return b;
  var r = String(ruta == null ? '' : ruta).trim();
  if (!r) return { ok: false, error: 'Falta la ruta para enviar la ubicación (por ejemplo v1/gsgchat/location).' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(r)) return { ok: false, error: 'La ruta no puede ser una dirección completa (http://…): pon solo la parte que va después de la URL base.' };
  if (/^\/\//.test(r) || r.indexOf('\\') !== -1) return { ok: false, error: 'La ruta no puede empezar por «//» ni llevar barras invertidas: pon solo la parte que va después de la URL base.' };
  if (/[?#]/.test(r)) return { ok: false, error: 'La ruta no puede llevar «?» ni «#».' };
  if (/\s/.test(r)) return { ok: false, error: 'La ruta no puede llevar espacios.' };
  var segmentos = r.split('/').filter(Boolean);
  if (!segmentos.length) return { ok: false, error: 'Falta la ruta para enviar la ubicación (por ejemplo v1/gsgchat/location).' };
  if (segmentos.some(function (x) { return /^(%2e|\.){1,2}$/i.test(x); })) return { ok: false, error: 'La ruta no puede llevar segmentos «..» ni «.».' };
  return { ok: true, url: b.url + segmentos.join('/') };
}`;

export interface ConnectOpts {
  labels: Record<string, string>;
  nombreNegocio: string;
  demo?: boolean;
  /** Si hay modulo de entregas: se ensena tambien la conexion con GSG. */
  conGsg?: boolean;
  /**
   * Que pantalla: 'whatsapp' (Conexión WhatsApp, /setup) o 'gsg' (Conexión con
   * GSG, /conexion-gsg: lo que GSGchat le manda y le pregunta a GSG).
   */
  vista?: 'whatsapp' | 'gsg';
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
  const vista = opts.vista ?? 'whatsapp';
  const vistaWa = vista === 'whatsapp';
  const tarjetaGsg = Boolean(opts.conGsg) && vista === 'gsg';
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

<div class="con-resumen una">
${vistaWa ? `<section class="tarjeta con-card" id="card-wa">
  <div class="con-cab"><span class="con-ico" aria-hidden="true">${icono('chat')}</span><div class="con-tit"><h2>WhatsApp</h2><span id="wa-chip" class="chip tono-gris">Revisando…</span></div></div>
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
    <button class="btn peligro hidden" id="desconectar" type="button">Desvincular cuenta</button>
  </div>
</section>
<section class="tarjeta con-card" id="card-lineas">
  <div class="con-cab"><span class="con-ico" aria-hidden="true">📱</span><div class="con-tit"><h2>Líneas de WhatsApp</h2><span id="lineas-chip" class="chip tono-gris">Revisando…</span></div></div>
  <p class="con-frase">Hasta 8 números en la misma bandeja. Si una línea se cae, las demás siguen.</p>
  <details class="con-mas"><summary>¿Cómo se reparten los clientes?</summary>
    <p class="ayuda">Cada cliente nuevo entra por una línea conectada y se queda con ella: siempre se le escribe desde el mismo número. Solo cambia si su línea lleva más de 2 minutos caída o WhatsApp la bloquea, si quitas o deshabilitas la línea, si él escribe a otro de tus números o si tú eliges otra en el chat. La etiqueta (por ejemplo <b>wsp-ali</b>) aparece en cada chat para saber qué celular revisar.</p>
  </details>
  <div id="lineas-modo" class="bloque" hidden>
    <h3>¿Qué WhatsApp se usa?</h3>
    <div class="acciones" id="lineas-modo-botones" role="radiogroup" aria-label="Qué líneas se usan"></div>
    <p class="ayuda" id="lineas-modo-frase"></p>
  </div>
  <div id="lineas-lista" class="lineas-lista"></div>
  <div class="bloque punteado" id="linea-alta">
    <h3>Agregar una línea</h3>
    <div class="acciones" role="radiogroup" aria-label="Tipo de la nueva línea">
      <label class="chip-op"><input type="radio" name="linea-tipo" value="local" checked> WhatsApp normal (con QR)</label>
      <label class="chip-op"><input type="radio" name="linea-tipo" value="cloud"> WhatsApp API (Meta)</label>
    </div>
    <div class="acciones">
      <input id="linea-nueva" class="corto" maxlength="80" placeholder="Nombre de la línea (ej. wsp-kevin)" aria-label="Nombre de la nueva línea">
    </div>
    <div id="linea-api" hidden>
      <p class="ayuda">Los datos salen de <b>developers.facebook.com</b> → tu app → WhatsApp → Configuración de la API.</p>
      <div class="lineas-api-campos">
        <label class="api-campo">Token de acceso <input id="api-token" data-campo="token" type="password" autocomplete="off" maxlength="1000" placeholder="EAAG… (muy largo, unos 200 caracteres)" aria-describedby="api-token-error"><span class="api-error" id="api-token-error" hidden></span></label>
        <label class="api-campo">Phone number ID <input id="api-pnid" data-campo="phoneNumberId" inputmode="numeric" maxlength="100" placeholder="Ej. 123456789012345 (no el número de teléfono)" aria-describedby="api-pnid-error"><span class="api-error" id="api-pnid-error" hidden></span></label>
        <label class="api-campo">WhatsApp Business Account ID <input id="api-waba" data-campo="businessAccountId" inputmode="numeric" maxlength="100" placeholder="Ej. 1144600514634989" aria-describedby="api-waba-error"><span class="api-error" id="api-waba-error" hidden></span></label>
        <label class="api-campo">App secret (clave secreta de la app) <input id="api-secret" data-campo="appSecret" type="password" autocomplete="off" maxlength="300" placeholder="32 letras y números" aria-describedby="api-secret-error"><span class="api-error" id="api-secret-error" hidden></span></label>
        <label class="api-campo">Verify token (una palabra que tú inventas) <input id="api-verify" data-campo="verifyToken" maxlength="300" autocomplete="off" placeholder="Ej. gsgwhatsapp2026" aria-describedby="api-verify-error"><span class="api-error" id="api-verify-error" hidden></span></label>
      </div>
      <label class="check-principal"><input type="checkbox" id="api-principal"> Usarla como línea principal</label>
      <details class="api-ejemplo">
        <summary>Ver ejemplo y dónde sale cada dato</summary>
        <ul class="api-ejemplo-lista">
          <li><b>Token de acceso:</b> <code>EAAGm0PX4ZCpsBO7…</code> (muy largo). El <b>permanente</b>: Business Manager → Usuarios del sistema → Generar token.</li>
          <li><b>Phone number ID:</b> <code>123456789012345</code>. En Configuración de la API, debajo del número: «Identificador del número de teléfono». <b>No</b> es el <code>+51 9…</code></li>
          <li><b>WhatsApp Business Account ID:</b> <code>1144600514634989</code>. La misma pantalla, «Identificador de la cuenta de WhatsApp Business».</li>
          <li><b>App secret:</b> <code>3f9a1c0b7e2d4a6f8b1c3e5d7a9f0b2c</code> (32 caracteres). Configuración de la app → Básica → Clave secreta → Mostrar.</li>
          <li><b>Verify token:</b> <code>gsgwhatsapp2026</code>. Lo inventas tú y lo pegas igual en el webhook de Meta.</li>
        </ul>
        <p class="ayuda">Meta también pide las <a class="link" href="/legal" target="_blank" rel="noopener">páginas legales</a> (privacidad, términos y eliminación de datos).</p>
      </details>
      <p class="ayuda" id="linea-api-webhook"></p>
    </div>
    <div class="acciones">
      <button class="btn primario" id="linea-agregar" type="button">Agregar línea</button>
    </div>
  </div>
  <p class="ayuda" id="lineas-estado" role="status"></p>
  <div id="lineas-reparto" hidden>
    <h3>Cómo van repartidos los clientes</h3>
    <div class="tablewrap"><table><thead><tr><th>Línea</th><th>Clientes</th><th>Nuevos hoy</th><th>Mensajes hoy</th></tr></thead><tbody id="lineas-reparto-filas"></tbody></table></div>
    <details><summary>Últimos cambios de línea</summary><div id="lineas-cambios" class="ayuda"></div></details>
  </div>
</section>
` : ''}${tarjetaGsg ? `<section class="tarjeta con-card" id="gsg">
  <div class="con-cab"><span class="con-ico" aria-hidden="true">${icono('moto')}</span><div class="con-tit"><h2>GSG</h2><span id="gsg-chip" class="chip tono-gris">Revisando…</span></div></div>
  <p class="con-frase" id="gsg-frase">GSG nos manda los pedidos del día en cuanto los tiene, y a GSG le mandamos cada ubicación que registra el cliente. Aquí nunca se le pide nada a GSG.</p>
  <div id="gsg-estado" class="ayuda"><span class="esqueleto linea media"></span></div>
  <div class="bloque punteado" id="gsg-consulta">
    <h3>Consulta del estado de un envío en GSG</h3>
    <p class="ayuda" id="gsg-consulta-url">Sin ruta de consulta configurada: GSGchat no le pregunta nada a GSG. Configúrala en «Cambiar la URL o la API Key de GSG».</p>
    <p class="ayuda">Antes de escribirle a un cliente se pregunta por su tracking. Si GSG lo da por cancelado o con datos mal, se deja de escribir <b>solo por ese tracking</b>; si GSG no contesta, se le escribe igual.</p>
    <form id="gsg-consulta-form" class="ep-form" novalidate>
      <label class="campo" for="gsg-consulta-tracking">Tracking</label><input id="gsg-consulta-tracking" type="text" autocomplete="off" placeholder="GSG-E-205" required>
      <label class="campo" for="gsg-consulta-telefono">Teléfono (opcional)</label><input id="gsg-consulta-telefono" type="tel" autocomplete="off" placeholder="987654321">
      <div class="acciones"><button class="btn sm" id="gsg-consulta-enviar" type="submit">Consultar a GSG (solo lectura)</button></div>
    </form>
    <pre id="gsg-consulta-resultado" class="ep-resultado hidden" role="status" aria-live="polite"></pre>
  </div>
  <details class="bloque punteado" id="gsg-envios-caja">
    <summary>Lo que enviamos a GSG</summary>
    <div class="gsg-envios-contenido">
    <div id="gsg-envios-destino" class="gsg-destinos"></div>
    <div id="gsg-envios" class="ayuda"><span class="esqueleto linea"></span><span class="esqueleto linea media"></span></div>
    <p class="ayuda"><a id="gsg-envios-refrescar" href="#">Actualizar</a></p>
    </div>
  </details>
  <details><summary>Ubicación y seguimiento del cliente</summary>
    <p>Las direcciones escritas y los enlaces de Maps se confirman antes de reportar la ubicación. Los horarios y el orden de reparto proceden de GSG.</p>
    <p id="seguimiento-estado" role="status" aria-live="polite">Revisando seguimiento…</p>
    <div id="seguimiento-pedidos" class="ayuda"></div>
    <div class="acciones"><button class="btn sm" id="seguimiento-refrescar" type="button">Actualizar diagnóstico</button><span id="seguimiento-cuando" class="chip hidden" role="status"></span></div>
  </details>
  <div id="gsg-config-error" class="nota riesgo hidden" role="alert"></div>
  <details class="con-form" id="gsg-form-caja"><summary id="gsg-form-resumen">Cambiar la URL o la API Key de GSG</summary>
  <form id="gsg-form" novalidate>
    <p class="ayuda">Lo que GSGchat le manda a GSG: cada ubicación y los problemas. La API Key de aquí <b>la da GSG</b>; la que creamos para que GSG nos mande pedidos está en <a href="/api-gsgchat#t-claves">Nuestra API → Claves</a>. <a class="ver-manual" href="/manual#m-conexion-gsg">Ver instrucciones completas</a></p>
    <label class="campo" for="gsg-url">URL base de GSG
      <span class="hint">Te la dan sus programadores. Empieza por https:// y no lleva «?» ni «#». Por ejemplo https://backend.developer.gsgcorp.pe/api/</span></label>
    <input id="gsg-url" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://backend.developer.gsgcorp.pe/api/" aria-describedby="gsg-url-final">
    <label class="campo" for="gsg-ruta">Ruta para enviar la ubicación
      <span class="hint">Lo que va después de la URL base, sin http:// ni «..». Por ejemplo v1/gsgchat/location</span></label>
    <input id="gsg-ruta" type="text" autocomplete="off" spellcheck="false" placeholder="v1/gsgchat/location" aria-describedby="gsg-url-final">
    <p class="ayuda" id="gsg-url-final" role="status" aria-live="polite"></p>
    <label class="campo" for="gsg-ruta-incidencias">Ruta para reportar problemas: números mal y errores (opcional)
      <span class="hint">A donde va cada problema: número sin WhatsApp o inválido, no reconoce el pedido, rechaza… Vacía = incidencias. Por ejemplo v1/gsgchat/reported. El formato de cada aviso está en el Manual.</span></label>
    <input id="gsg-ruta-incidencias" type="text" autocomplete="off" spellcheck="false" placeholder="v1/gsgchat/reported" aria-describedby="gsg-url-incidencias">
    <p class="ayuda" id="gsg-url-incidencias" role="status" aria-live="polite"></p>
    <label class="campo" for="gsg-ruta-webhook">Ruta del webhook de GSG (opcional)
      <span class="hint">Lo que va después de la URL base, sin http:// ni «..». Vacía = sin webhook. Por ejemplo v1/gsgchat/webhook</span></label>
    <input id="gsg-ruta-webhook" type="text" autocomplete="off" spellcheck="false" placeholder="v1/gsgchat/webhook" aria-describedby="gsg-url-webhook">
    <p class="ayuda" id="gsg-url-webhook" role="status" aria-live="polite"></p>
    <label class="campo" for="gsg-ruta-estado">Ruta para consultar el estado de un envío (opcional)
      <span class="hint">El GET de GSG que dice si un tracking está cancelado, con el número o el tracking mal, o sin poder contactar. Vacía = no se le pregunta. Por ejemplo v1/gsgchat/estado</span></label>
    <input id="gsg-ruta-estado" type="text" autocomplete="off" spellcheck="false" placeholder="v1/gsgchat/estado" aria-describedby="gsg-url-estado">
    <div class="ep-params">
      <label class="campo" for="gsg-param-tracking">Parámetro del tracking<input id="gsg-param-tracking" type="text" autocomplete="off" spellcheck="false" placeholder="trackingCode"></label>
      <label class="campo" for="gsg-param-telefono">Parámetro del teléfono<input id="gsg-param-telefono" type="text" autocomplete="off" spellcheck="false" placeholder="phone"></label>
    </div>
    <p class="ayuda" id="gsg-url-estado" role="status" aria-live="polite"></p>
    <label class="campo" for="gsg-token">API Key de GSG
      <span class="hint" id="gsg-token-pista">Te la da GSG. Se manda solo en la cabecera X-API-Key, se guarda cifrada y no se vuelve a mostrar entera.</span></label>
    <div class="con-ojo">
      <input id="gsg-token" type="password" autocomplete="off" spellcheck="false">
      <button class="btn sm" id="gsg-token-ver" type="button" aria-controls="gsg-token" aria-pressed="false">Mostrar</button>
    </div>
    <div class="acciones">
      <button class="btn primario" id="gsg-guardar" type="submit">Guardar y probar</button>
    </div>
  </form>
  </details>
  <div id="gsg-resultado" class="hidden" role="status" aria-live="polite"></div>
  <div id="gsg-webhook-caja" class="bloque punteado hidden">
    <h3>Webhook de GSG</h3>
    <p class="ayuda" id="gsg-webhook-destino"></p>
    <div id="gsg-webhook-secreto-caja" class="nota hidden" role="status" aria-live="polite">
      <b>Secreto del webhook: cópialo ahora, no se vuelve a mostrar.</b>
      <p><code id="gsg-webhook-secreto" style="word-break:break-all;user-select:all"></code></p>
      <div class="acciones"><button class="btn sm" id="gsg-webhook-copiar" type="button">Copiar</button><button class="btn sm" id="gsg-webhook-ocultar" type="button">Ya lo copié</button></div>
      <p class="ayuda">Se le da a GSG: cada aviso sale firmado en la cabecera X-Firma (t=…,v1=hmac sha256 de «t.cuerpo» con este secreto).</p>
    </div>
    <div class="acciones"><button class="btn sm" id="gsg-webhook-rotar" type="button">Generar un secreto nuevo</button></div>
  </div>
  <div class="acciones con-pie">
    <button class="btn" id="gsg-probar" type="button">Probar otra vez</button>
    <span id="gsg-state" class="chip hidden" role="status"></span>
    <button class="btn peligro" id="gsg-quitar" type="button">Desconectar</button>
  </div>
  <div id="gsg-descartes" class="nota riesgo hidden">
    <b id="gsg-descartes-titulo"></b>
    <p>GSG los mandó hoy pero no se pudieron usar. Avísale para que los corrija y los vuelva a mandar; en cuanto lleguen bien, entran solos.</p>
    <ul id="gsg-descartes-lista"></ul>
  </div>
</section>
` : ''}</div>

${vistaWa ? `<details class="con-avanzado" id="con-avanzado">
  <summary><b>Conectar WhatsApp, paso a paso</b><span class="ayuda">WhatsApp Business por la API oficial, conexión por QR, prueba de envío, WAHA y datos para programadores.</span></summary>
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
      <summary>Solo para pruebas, sin Meta (WAHA)</summary>
      <p class="ayuda">WAHA emula WhatsApp Web desde un contenedor en tu servidor. Úsalo para probar.</p>
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
      <button class="btn primario hidden" id="qr-connect" type="button">Conectar y mostrar el QR</button>
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
` : ''}
</div>
</div>`;

  const scriptComun = String.raw`
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
  if (!res.ok) { var fallo = new Error(data.error || errorHttp(res.status)); fallo.datos = data; throw fallo; }
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

`;
  const scriptWa = String.raw`
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
  if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' });
}

$('wa-conectar').onclick = async function () {
  var boton = this;
  /* Sin camino elegido, el de siempre: escanear el QR con el WhatsApp del
     teléfono (normal o Business). La API de Meta se elige a mano. */
  if (!modo) {
    var opcion = document.querySelector('input[name="modo"][value="local"]');
    if (opcion) opcion.click();
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
    : modo === 'local'
      ? '<b>Conexión por QR:</b> funciona con tu WhatsApp normal o Business. No es la API oficial de Meta: ' +
        'si mandas muchos mensajes, WhatsApp puede limitar el número.'
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
  /* El código sale arriba, en la tarjeta de WhatsApp: se sube hasta ella. */
  var tarjeta = $('card-wa');
  if (tarjeta && tarjeta.scrollIntoView) tarjeta.scrollIntoView({ behavior: 'auto', block: 'start' });
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

/* Una sola acción, visible en la tarjeta principal de WhatsApp. */
$('desconectar').onclick = async function () {
  var ok = await confirmarDialogo({
    titulo: '¿Desvincular la cuenta de WhatsApp?',
    texto: 'Se cierra la sesión de este sistema y el teléfono deja de verlo entre sus dispositivos vinculados. ' +
      'No se pierde nada de lo guardado aquí (chats, contactos, historial). Para volver, se escanea otro código.',
    boton: 'Sí, desvincular',
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
    estado('fb-state', 'Cuenta desvinculada. Pulsa «' + MODOS[modo].boton + '» y escanea un QR nuevo para volver a conectar.', 'ambar');
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
      // Sin nada guardado, viene marcado escanear el QR (WhatsApp normal o Business).
      if (!modo && !guardado.provider) modo = 'local';

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

`;
  const scriptLineas = String.raw`
/* --- lineas de WhatsApp (hasta 8) ------------------------------------- */
var lineasMax = 8;
var lineasVistas = '';
var TONO_LINEA = { conectado: 'verde', esperando_qr: 'ambar', caido: 'rojo', desconectado: 'gris' };
var TEXTO_LINEA = { conectado: 'Conectada', esperando_qr: 'Escanea el QR', caido: 'Caída', desconectado: 'Sin conectar' };
function lineasMsg(t, tono) {
  var el = $('lineas-estado');
  if (!el) return;
  el.textContent = t || '';
  el.style.color = tono === 'rojo' ? '#b42318' : '';
}
/* La respuesta de cada accion sale dentro de su linea, junto a sus botones (y sobrevive al repintado). */
var avisosLinea = {};
var formsAbiertos = {};
var avisoTimers = {};
function avisoLinea(id, texto, mal) {
  avisosLinea[id] = texto ? { t: texto, mal: Boolean(mal) } : null;
  var fila = document.querySelector('[data-linea="' + id + '"]');
  if (fila) {
    var el = fila.querySelector('.linea-aviso');
    if (!el) { el = document.createElement('p'); el.setAttribute('role', 'status'); fila.appendChild(el); }
    el.textContent = texto || '';
    el.className = 'linea-aviso ' + (mal ? 'mal' : 'ok');
    el.hidden = !texto;
  }
  clearTimeout(avisoTimers[id]);
  if (texto && !mal) avisoTimers[id] = setTimeout(function () { avisoLinea(id, ''); }, 15000);
}
var puedeElegirPrincipal = false;
function filaLinea(l) {
  var tono = TONO_LINEA[l.estado] || 'gris';
  /* deSetup = la conexion de siempre (se maneja con la tarjeta de arriba); principal = la que eligio la tienda. */
  var setup = l.deSetup !== undefined ? l.deSetup : l.principal;
  var local = l.proveedor === 'local' && !setup;
  var qr = l.sesion && l.sesion.qr ? '<div class="qr-marco"><img alt="QR de ' + esc(l.etiqueta) + '" src="data:image/png;base64,' + esc(l.sesion.qr) + '"></div><p class="ayuda">En el teléfono de esta línea: WhatsApp &rarr; Dispositivos vinculados &rarr; Vincular un dispositivo.</p>' : '';
  var codigo = l.sesion && l.sesion.pairingCode ? '<div class="codigo" role="status">' + esc(l.sesion.pairingCode) + '</div>' : '';
  var botones = '';
  if (local) {
    botones += l.estado === 'conectado'
      ? '<button class="btn" type="button" data-acc="desconectar" data-id="' + esc(l.id) + '">Desvincular</button>'
      : '<button class="btn primario" type="button" data-acc="conectar" data-id="' + esc(l.id) + '">' + (l.estado === 'esperando_qr' ? 'Mostrar otro QR' : 'Conectar y mostrar el QR') + '</button>';
  }
  if (puedeElegirPrincipal && !l.principal && l.habilitada) {
    botones += '<button class="btn" type="button" data-acc="principal" data-id="' + esc(l.id) + '">Hacer principal</button>';
  }
  var datosApi = '';
  if (l.api && !setup) {
    botones += '<button class="btn" type="button" data-acc="datos-api" data-id="' + esc(l.id) + '">Cambiar datos de la API</button>';
    datosApi = (l.api.faltan && l.api.faltan.length ? '<p class="ayuda" style="color:#b42318">Le falta ' + esc(l.api.faltan.join(', ')) + ': pulsa «Cambiar datos de la API».</p>' : '') +
      '<div class="lineas-api-campos" data-form-api="' + esc(l.id) + '"' + (formsAbiertos[l.id] ? '' : ' hidden') + '>' +
        '<label>Token de acceso <input type="password" autocomplete="off" data-api="token" placeholder="' + (l.api.conToken ? 'guardado: déjalo vacío para no cambiarlo' : '') + '"></label>' +
        '<label>Phone number ID <input inputmode="numeric" data-api="phoneNumberId" value="' + esc(l.api.phoneNumberId || '') + '"></label>' +
        '<label>WhatsApp Business Account ID <input inputmode="numeric" data-api="businessAccountId" value="' + esc(l.api.businessAccountId || '') + '"></label>' +
        '<label>App secret <input type="password" autocomplete="off" data-api="appSecret" placeholder="' + (l.api.conAppSecret ? 'guardado: déjalo vacío para no cambiarlo' : '') + '"></label>' +
        '<label>Verify token <input autocomplete="off" data-api="verifyToken" placeholder="' + (l.api.conVerifyToken ? 'guardado: déjalo vacío para no cambiarlo' : '') + '"></label>' +
        '<div class="acciones"><button class="btn primario" type="button" data-acc="guardar-api" data-id="' + esc(l.id) + '">Guardar y comprobar con Meta</button></div>' +
      '</div>';
  }
  if (!setup) {
    botones += '<button class="btn" type="button" data-acc="habilitar" data-id="' + esc(l.id) + '" data-valor="' + (l.habilitada ? '0' : '1') + '">' + (l.habilitada ? 'Deshabilitar' : 'Habilitar') + '</button>';
    botones += '<button class="btn peligro" type="button" data-acc="quitar" data-id="' + esc(l.id) + '">Quitar</button>';
  }
  var esApi = l.tipo ? l.tipo === 'api' : l.proveedor === 'cloud';
  var pausa = l.enUso === false && l.habilitada;
  return '<div class="linea-fila' + (pausa ? ' en-pausa' : '') + '" data-linea="' + esc(l.id) + '" style="border:1px solid var(--borde,#d9dde3);border-radius:10px;padding:10px;margin:8px 0">' +
    '<div class="acciones" style="align-items:center">' +
      '<input class="corto" data-nombre="' + esc(l.id) + '" maxlength="80" value="' + esc(l.etiqueta) + '" aria-label="Nombre de la línea">' +
      '<button class="btn" type="button" data-acc="renombrar" data-id="' + esc(l.id) + '">Guardar nombre</button>' +
      '<span class="chip tono-' + (esApi ? 'azul' : 'gris') + '">' + (esApi ? 'API' : 'Normal') + '</span>' +
      '<span class="chip tono-' + tono + '">' + esc(l.habilitada ? (TEXTO_LINEA[l.estado] || l.estado) : 'Deshabilitada') + '</span>' +
      (pausa ? '<span class="chip tono-ambar">En pausa por el modo</span>' : '') +
      (l.principal ? '<span class="chip tono-verde">★ Principal</span>' : '') +
    '</div>' +
    '<p class="ayuda">' + (l.numero ? 'Número: +' + esc(l.numero) : (esApi ? 'Número: se completa al comprobar los datos con Meta' : 'Número: se completa al conectar')) + ' · ' + (l.proveedor === 'local' ? 'QR / sesión vinculada' : l.proveedor === 'cloud' ? 'API oficial de Meta' : 'WAHA') + (setup ? ' · se conecta con la tarjeta de WhatsApp de arriba' : '') + (l.principal && !setup ? ' · elegida como principal: si la línea de un cliente se cae, sus mensajes pasan primero por esta' : '') + (pausa ? ' · sigue conectada: no recibe clientes nuevos y solo contesta los chats que siguen abiertos' : '') + '</p>' +
    qr + codigo + datosApi +
    (botones ? '<div class="acciones">' + botones + '</div>' : '') +
    (avisosLinea[l.id] ? '<p class="linea-aviso ' + (avisosLinea[l.id].mal ? 'mal' : 'ok') + '" role="status">' + esc(avisosLinea[l.id].t) + '</p>' : '') +
  '</div>';
}
var modoLineas = '';
function pintarModo(r) {
  var caja = $('lineas-modo');
  if (!caja) return;
  /* Con una sola linea no hay nada que elegir... salvo que ya este en un modo que la deja en pausa. */
  var tipos = {};
  r.lineas.forEach(function (l) { tipos[l.tipo || (l.proveedor === 'cloud' ? 'api' : 'normal')] = true; });
  caja.hidden = !r.puedeElegirModo || (!(tipos.api && tipos.normal) && r.modo === 'ambos');
  modoLineas = r.modo;
  var elegido = null;
  $('lineas-modo-botones').innerHTML = (r.modos || []).map(function (m) {
    if (m.id === r.modo) elegido = m;
    return '<label class="chip-op' + (m.id === r.modo ? ' elegido' : '') + '"><input type="radio" name="lineas-modo" value="' + esc(m.id) + '"' + (m.id === r.modo ? ' checked' : '') + '> ' + esc(m.titulo) + '</label>';
  }).join('');
  $('lineas-modo-frase').textContent = elegido ? elegido.frase : '';
}
var webhookLineas = '';
function pintarWebhook() {
  var el = $('linea-api-webhook');
  if (!el) return;
  el.innerHTML = webhookLineas
    ? 'En Meta → WhatsApp → Configuración → Webhook pega esta dirección: <span class="webhook-url">' + esc(webhookLineas) + '</span> y el mismo verify token que escribas aquí. Después suscríbete al campo <b>messages</b>.'
    : '';
}
async function cargarLineas() {
  var lista = $('lineas-lista');
  if (!lista) return;
  try {
    var r = await api('/admin/lineas');
    lineasMax = r.max || 8;
    puedeElegirPrincipal = Boolean(r.puedeElegirPrincipal);
    webhookLineas = r.webhookUrl || '';
    pintarWebhook();
    var firma = JSON.stringify(r.lineas) + '|' + r.modo;
    /* Se repinta al cambiar el modo o las lineas (con la segunda de otro tipo aparece la eleccion). */
    if (firma !== lineasVistas) pintarModo(r);
    var chip = $('lineas-chip');
    var conectadas = r.lineas.filter(function (l) { return l.estado === 'conectado'; }).length;
    if (chip) { chip.textContent = conectadas + ' de ' + r.lineas.length + ' conectadas (máx. ' + lineasMax + ')'; chip.className = 'chip tono-' + (conectadas ? 'verde' : 'ambar'); }
    ver('linea-alta', r.lineas.length < lineasMax);
    /* No se repinta mientras alguien escribe un nombre: el cursor se perderia. */
    var escribiendo = document.activeElement && lista.contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
    if (firma !== lineasVistas && !escribiendo) { lineasVistas = firma; lista.innerHTML = r.lineas.map(filaLinea).join(''); }
  } catch (error) { lineasMsg(error.message, 'rojo'); }
}
async function accionLinea(acc, id, valor) {
  var boton = document.querySelector('[data-acc="' + acc + '"][data-id="' + id + '"]');
  var textoBoton = boton ? boton.textContent : '';
  try {
    if (acc === 'renombrar') {
      var campo = document.querySelector('[data-nombre="' + id + '"]');
      await api('/admin/lineas/' + id, { method: 'PATCH', body: { etiqueta: campo ? campo.value : '' } });
      avisoLinea(id, 'Nombre guardado. Los mensajes viejos conservan el que tenían.');
    } else if (acc === 'conectar') {
      await api('/admin/lineas/' + id + '/conectar', { method: 'POST' });
      avisoLinea(id, 'Escanea el QR con el teléfono de esta línea. Si caduca, sale otro solo.');
    } else if (acc === 'desconectar') {
      await api('/admin/lineas/' + id + '/desconectar', { method: 'POST' });
      avisoLinea(id, 'Línea desvinculada. Las demás siguen conectadas.');
    } else if (acc === 'habilitar') {
      await api('/admin/lineas/' + id, { method: 'PATCH', body: { habilitada: valor === '1' } });
      avisoLinea(id, valor === '1' ? 'Línea habilitada.' : 'Línea deshabilitada: no se enviará nada por ella.');
    } else if (acc === 'principal') {
      await api('/admin/lineas/' + id + '/principal', { method: 'POST' });
      avisoLinea(id, 'Listo: esta es ahora la línea principal. Cada cliente sigue con su número; si el suyo se cae, sus mensajes pasan primero por esta.');
    } else if (acc === 'quitar') {
      await api('/admin/lineas/' + id, { method: 'DELETE' });
      lineasMsg('Línea quitada. Sus mensajes quedan en los chats con su etiqueta.');
    } else if (acc === 'datos-api') {
      var form = document.querySelector('[data-form-api="' + id + '"]');
      formsAbiertos[id] = !formsAbiertos[id];
      if (form) form.hidden = !formsAbiertos[id];
      return;
    } else if (acc === 'guardar-api') {
      var cuerpo = {};
      document.querySelectorAll('[data-form-api="' + id + '"] [data-api]').forEach(function (i) { i.removeAttribute('aria-invalid'); if (i.value.trim()) cuerpo[i.getAttribute('data-api')] = i.value.trim(); });
      if (boton) { boton.disabled = true; boton.textContent = 'Comprobando con Meta…'; }
      avisoLinea(id, 'Comprobando los datos con Meta…');
      var r = await api('/admin/lineas/' + id + '/credenciales', { method: 'PATCH', body: cuerpo });
      formsAbiertos[id] = false;
      var numero = r && r.linea && r.linea.numero ? ' Número: +' + r.linea.numero + '.' : '';
      if (r && r.suscrita === false) avisoLinea(id, 'Meta aceptó los datos, pero no se pudo activar «Suscribir webhooks» (' + (r.suscripcionError || 'sin detalle') + '). Sin eso no te llega lo que escribe el cliente: actívalo en Meta → WhatsApp → Configuración de la API.', true);
      else avisoLinea(id, 'Listo: Meta aceptó los datos y quedaron guardados.' + numero + (r && r.suscrita ? ' Suscrita a los avisos de Meta: lo que escriba el cliente llega aquí.' : ''));
    }
    lineasVistas = '';
    await cargarLineas();
  } catch (error) {
    if (acc === 'quitar') { lineasMsg(error.message, 'rojo'); return; }
    avisoLinea(id, error.message, true);
    var campoMal = error.datos && error.datos.campo;
    var input = campoMal ? document.querySelector('[data-form-api="' + id + '"] [data-api="' + campoMal + '"]') : null;
    if (input) {
      formsAbiertos[id] = true;
      input.closest('[data-form-api]').hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    }
  } finally {
    if (boton && boton.isConnected) { boton.disabled = false; boton.textContent = textoBoton; }
  }
}
var MOTIVO_CAMBIO = { cliente_escribio: 'el cliente escribió por esa línea', persona: 'lo eligió una persona', linea_no_disponible: 'su línea se quitó o se deshabilitó', linea_caida: 'su línea se desconectó o fue bloqueada' };
async function cargarReparto() {
  var caja = $('lineas-reparto');
  if (!caja) return;
  try {
    var r = await api('/admin/lineas/reparto');
    /* Con una sola línea no hay nada que repartir. */
    caja.hidden = r.lineas.length < 2;
    $('lineas-reparto-filas').innerHTML = r.lineas.map(function (l) {
      return '<tr><td>' + esc(l.etiqueta) + (l.conectada ? '' : ' <span class="chip tono-ambar">sin conexión</span>') + (l.pausada ? ' <span class="chip tono-gris">pausada</span>' : '') + '</td><td>' + l.clientes + '</td><td>' + l.nuevosHoy + '</td><td>' + l.enviadosHoy + ' de ' + l.cupoDiario + '</td></tr>';
    }).join('');
    $('lineas-cambios').innerHTML = r.cambios.length ? r.cambios.map(function (c) {
      return '<p>' + esc(new Date(c.createdAt).toLocaleString('es-PE')) + ' · ' + esc(c.nombre || ('+' + c.telefono)) + ': de <b>' + esc(c.desdeEtiqueta || 'una línea ya quitada') + '</b> a <b>' + esc(c.aEtiqueta || 'otra línea') + '</b> (' + esc(MOTIVO_CAMBIO[c.motivo] || c.motivo) + ')</p>';
    }).join('') : '<p>Ningún cliente ha cambiado de línea.</p>';
  } catch (error) { lineasMsg(error.message, 'rojo'); }
}
(function iniciarLineas() {
  var lista = $('lineas-lista');
  if (!lista) return;
  cargarReparto();
  setInterval(cargarReparto, 30000);
  lista.addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('[data-acc]') : null;
    if (!b) return;
    if (b.getAttribute('data-acc') === 'quitar' && !window.confirm('¿Quitar esta línea? Sus mensajes viejos se quedan en los chats.')) return;
    accionLinea(b.getAttribute('data-acc'), b.getAttribute('data-id'), b.getAttribute('data-valor'));
  });
  function tipoNuevo() {
    var marcado = document.querySelector('input[name="linea-tipo"]:checked');
    return marcado ? marcado.value : 'local';
  }
  function pintarTipoNuevo() {
    var api = tipoNuevo() === 'cloud';
    $('linea-api').hidden = !api;
    document.querySelectorAll('input[name="linea-tipo"]').forEach(function (i) { i.parentNode.classList.toggle('elegido', i.checked); });
  }
  document.querySelectorAll('input[name="linea-tipo"]').forEach(function (i) { i.addEventListener('change', pintarTipoNuevo); });
  pintarTipoNuevo();
  $('lineas-modo-botones').addEventListener('change', async function (ev) {
    var elegido = ev.target && ev.target.name === 'lineas-modo' ? ev.target.value : '';
    if (!elegido || elegido === modoLineas) return;
    try {
      var r = await api('/admin/lineas/modo', { method: 'POST', body: { modo: elegido } });
      lineasMsg(r.conectadasEnUso ? 'Listo. Ninguna línea se desconectó: las que quedan fuera solo terminan sus chats abiertos.' : 'Guardado, pero ahora mismo ninguna línea de este tipo está conectada: no saldrá nada hasta que conectes una.', r.conectadasEnUso ? '' : 'rojo');
    } catch (error) { lineasMsg(error.message, 'rojo'); }
    modoLineas = '';
    lineasVistas = '';
    await cargarLineas();
  });
  /* Los campos de la API: cada uno sabe marcar su error debajo de el. */
  var CAMPO_API = { token: 'api-token', phoneNumberId: 'api-pnid', businessAccountId: 'api-waba', appSecret: 'api-secret', verifyToken: 'api-verify' };
  function limpiarErroresApi() {
    Object.keys(CAMPO_API).forEach(function (k) {
      var input = $(CAMPO_API[k]), caja = $(CAMPO_API[k] + '-error');
      if (input) input.removeAttribute('aria-invalid');
      if (caja) { caja.hidden = true; caja.textContent = ''; }
    });
  }
  function marcarErrorApi(campo, texto) {
    var id = CAMPO_API[campo]; if (!id || !$(id)) return false;
    $(id).setAttribute('aria-invalid', 'true');
    var caja = $(id + '-error'); caja.textContent = texto; caja.hidden = false;
    $(id).focus();
    return true;
  }
  /* Lo mismo que revisa el servidor, para avisar sin esperar a Meta. */
  function revisarApi(c) {
    if (!c.token) return ['token', 'Falta el token de acceso.'];
    if (!/^EAA/.test(c.token) || c.token.length < 60 || /\s/.test(c.token)) return ['token', 'No parece un token de Meta: empieza con «EAA» y es muy largo (unos 200 caracteres), sin espacios.'];
    if (!c.phoneNumberId) return ['phoneNumberId', 'Falta el Phone number ID.'];
    if (!/^\d{10,20}$/.test(c.phoneNumberId)) {
      var tel = /^\+/.test(c.phoneNumberId) || /^(51)?9\d{8}$/.test(c.phoneNumberId.replace(/[\s()-]/g, ''));
      return ['phoneNumberId', tel ? 'Eso es el número de teléfono, no su ID. En Meta → WhatsApp → Configuración de la API, elige el número en «De» y copia el «Identificador del número de teléfono» (solo cifras, ej. 123456789012345).' : 'Son solo cifras (entre 10 y 20), sin espacios ni signos. Ej. 123456789012345.'];
    }
    if (!c.businessAccountId) return ['businessAccountId', 'Falta el WhatsApp Business Account ID.'];
    if (!/^\d{10,20}$/.test(c.businessAccountId)) return ['businessAccountId', 'Son solo cifras (entre 10 y 20), sin espacios. Es el «Identificador de la cuenta de WhatsApp Business».'];
    if (c.phoneNumberId === c.businessAccountId) return ['businessAccountId', 'Es distinto del Phone number ID: pusiste el mismo en los dos.'];
    if (!c.appSecret) return ['appSecret', 'Falta la clave secreta de la app.'];
    if (!/^[a-f0-9]{32}$/i.test(c.appSecret)) return ['appSecret', /^EAA/.test(c.appSecret) ? 'Ahí pegaste un token. La clave secreta tiene 32 letras y números: Configuración de la app → Básica → Clave secreta de la app → Mostrar.' : 'La clave secreta tiene exactamente 32 letras y números; la que pusiste tiene ' + c.appSecret.length + '. Está en Configuración de la app → Básica → Mostrar.'];
    if (c.verifyToken && !/^[\x21-\x7e]{8,200}$/.test(c.verifyToken)) return ['verifyToken', 'Al menos 8 caracteres, sin espacios ni tildes. Ej. gsgwhatsapp2026.'];
    return null;
  }
  Object.keys(CAMPO_API).forEach(function (k) {
    var input = $(CAMPO_API[k]);
    if (input) input.addEventListener('input', function () { input.removeAttribute('aria-invalid'); var caja = $(CAMPO_API[k] + '-error'); if (caja) caja.hidden = true; });
  });
  $('linea-agregar').onclick = async function () {
    var nombre = val('linea-nueva');
    if (!nombre) { lineasMsg('Ponle un nombre a la línea, por ejemplo wsp-ali.', 'rojo'); $('linea-nueva').focus(); return; }
    var proveedor = tipoNuevo();
    var cuerpo = { etiqueta: nombre, proveedor: proveedor };
    limpiarErroresApi();
    if (proveedor === 'cloud') {
      cuerpo.credenciales = { token: val('api-token'), phoneNumberId: val('api-pnid'), businessAccountId: val('api-waba'), appSecret: val('api-secret'), verifyToken: val('api-verify') };
      var mal = revisarApi(cuerpo.credenciales);
      if (mal) { marcarErrorApi(mal[0], mal[1]); lineasMsg('Hay un dato mal puesto: está marcado en rojo arriba.', 'rojo'); return; }
      lineasMsg('Comprobando los datos con Meta…');
    }
    var comoPrincipal = proveedor === 'cloud' && $('api-principal') && $('api-principal').checked;
    try {
      var creada = await api('/admin/lineas', { method: 'POST', body: cuerpo });
      setVal('linea-nueva', '');
      ['api-token', 'api-pnid', 'api-waba', 'api-secret', 'api-verify'].forEach(function (c) { setVal(c, ''); });
      var principalOk = false, principalError = '';
      if (comoPrincipal && creada && creada.linea && creada.linea.id) {
        try { await api('/admin/lineas/' + encodeURIComponent(creada.linea.id) + '/principal', { method: 'POST', body: {} }); principalOk = true; $('api-principal').checked = false; }
        catch (e) { principalError = e.message; }
      }
      var suscritaTxt = creada && creada.suscrita === true ? ' Ya quedó suscrita a los avisos de Meta.' : creada && creada.suscrita === false ? ' No se pudo activar «Suscribir webhooks» (' + (creada.suscripcionError || 'sin detalle') + '): actívalo en Meta → WhatsApp → Configuración de la API.' : '';
      lineasMsg(proveedor === 'cloud'
        ? 'Línea de la API agregada y comprobada con Meta' + (principalOk ? ', y ya es la principal' : '') + '.' + suscritaTxt + ' Falta un paso: en Meta pega la dirección del webhook y el verify token (abajo de los campos) y suscríbete a «messages».' + (principalError ? ' No se pudo hacer principal: ' + principalError : '')
        : 'Línea agregada. Pulsa «Conectar y mostrar el QR» para vincularla.', principalError || (creada && creada.suscrita === false) ? 'rojo' : '');
      lineasVistas = '';
      await cargarLineas();
    } catch (error) {
      var campo = error.datos && error.datos.campo;
      if (campo && marcarErrorApi(campo, error.message)) lineasMsg('Hay un dato mal puesto: está marcado en rojo arriba.', 'rojo');
      else lineasMsg(error.message, 'rojo');
    }
  };
  cargarLineas();
  setInterval(cargarLineas, 4000);
})();
`;
  const scriptGsg = String.raw`
/* En la pantalla de GSG no hay tarjeta de WhatsApp: el armazon se enseña aqui. */
if (!document.getElementById('card-wa') && $('app')) $('app').classList.remove('hidden');

${UNIR_URL_GSG_JS}

/* La URL final (URL base + ruta) en vivo, con el mismo algoritmo que el servidor. */
function pintarUrlFinalGsg() {
  var caja = $('gsg-url-final');
  if (!caja) return null;
  var base = $('gsg-url').value.trim();
  var ruta = $('gsg-ruta').value.trim();
  if (!base && !ruta) { caja.textContent = ''; caja.className = 'ayuda'; return null; }
  var r = unirUrlGsg(base, ruta);
  caja.textContent = r.ok ? 'La ubicación se enviará con POST a: ' + r.url : 'No vale: ' + r.error;
  caja.className = r.ok ? 'ayuda' : 'ayuda error';
  return r;
}

function pintarUrlIncidenciasGsg() {
  var caja = $('gsg-url-incidencias');
  if (!caja) return;
  var ruta = $('gsg-ruta-incidencias').value.trim() || 'incidencias';
  var r = unirUrlGsg($('gsg-url').value.trim(), ruta);
  caja.textContent = r.ok ? 'Las incidencias se enviarán con POST a: ' + r.url : 'No vale: ' + r.error;
  caja.className = r.ok ? 'ayuda' : 'ayuda error';
}

function pintarUrlWebhookGsg() {
  var caja = $('gsg-url-webhook');
  if (!caja) return;
  var ruta = $('gsg-ruta-webhook').value.trim();
  if (!ruta) { caja.textContent = 'Sin ruta de webhook.'; caja.className = 'ayuda'; return; }
  var r = unirUrlGsg($('gsg-url').value.trim(), ruta);
  caja.textContent = r.ok ? 'El webhook de GSG apunta a: ' + r.url : 'No vale: ' + r.error;
  caja.className = r.ok ? 'ayuda' : 'ayuda error';
}

function pintarUrlEstadoGsg() {
  var caja = $('gsg-url-estado');
  if (!caja) return;
  var ruta = $('gsg-ruta-estado').value.trim();
  if (!ruta) { caja.textContent = 'Sin ruta de consulta: no se le pregunta a GSG por el estado.'; caja.className = 'ayuda'; return; }
  var r = unirUrlGsg($('gsg-url').value.trim(), ruta);
  var pt = $('gsg-param-tracking').value.trim() || 'trackingCode';
  var pf = $('gsg-param-telefono').value.trim() || 'phone';
  caja.textContent = r.ok ? 'El estado se consultará con GET a: ' + r.url + '?' + pt + '=…&' + pf + '=…' : 'No vale: ' + r.error;
  caja.className = r.ok ? 'ayuda' : 'ayuda error';
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
        ? 'Los pedidos del día entran solos cuando GSG los manda, y cada ubicación registrada le llega a GSG.'
        : g.modo === 'simulador'
          ? 'Estás probando con pedidos ficticios. Cuando GSG te dé su <b>dirección</b> y su <b>clave</b>, ponlas aquí.'
          : 'Falta la <b>URL base</b> de GSG, la <b>ruta</b> para enviar la ubicación y su <b>API Key</b>. Te las dan sus programadores.';
      var cajaForm = $('gsg-form-caja');
      if (cajaForm && g.modo === 'ninguna') cajaForm.open = true;
      texto('gsg-form-resumen', g.modo === 'real' ? 'Cambiar la URL o la API Key de GSG' : 'Poner la URL y la API Key de GSG');
    }
    ver('gsg-quitar', g.modo !== 'ninguna');
    ver('gsg-probar', g.modo !== 'ninguna');
    // Configuración que no vale (p. ej. una URL antigua que no se pudo partir en base + ruta): bien a la vista.
    var cajaError = $('gsg-config-error');
    if (cajaError) {
      cajaError.textContent = g.errorConfiguracion ? 'La configuración de GSG no es válida: ' + g.errorConfiguracion + ' No se envía nada a GSG hasta corregirla.' : '';
      ver('gsg-config-error', Boolean(g.errorConfiguracion));
      if (g.errorConfiguracion && $('gsg-form-caja')) $('gsg-form-caja').open = true;
    }
    // Lo guardado a la vista (la clave no: solo enmascarada).
    if (g.modo === 'real' && g.url && !$('gsg-url').value) $('gsg-url').value = g.url;
    if (g.modo === 'real' && g.rutaUbicacion && !$('gsg-ruta').value) $('gsg-ruta').value = g.rutaUbicacion;
    if (g.rutaEstado && !$('gsg-ruta-estado').value) $('gsg-ruta-estado').value = g.rutaEstado;
    if (g.rutaIncidencias && !$('gsg-ruta-incidencias').value) $('gsg-ruta-incidencias').value = g.rutaIncidencias;
    pintarUrlIncidenciasGsg();
    if (g.rutaWebhook && !$('gsg-ruta-webhook').value) $('gsg-ruta-webhook').value = g.rutaWebhook;
    pintarUrlWebhookGsg();
    ver('gsg-webhook-caja', Boolean(g.destinoWebhook));
    texto('gsg-webhook-destino', g.destinoWebhook ? 'GSGchat le manda los avisos con POST a: ' + g.destinoWebhook : '');
    if (g.paramTracking && !$('gsg-param-tracking').value) $('gsg-param-tracking').value = g.paramTracking;
    if (g.paramTelefono && !$('gsg-param-telefono').value) $('gsg-param-telefono').value = g.paramTelefono;
    pintarUrlFinalGsg();
    pintarUrlEstadoGsg();
    texto('gsg-consulta-url', g.destinoEstado
      ? 'Consulta configurada: GET ' + g.destinoEstado + '?' + (g.paramTracking || 'trackingCode') + '=…&' + (g.paramTelefono || 'phone') + '=…, con la API Key de GSG en X-API-Key.'
      : 'Sin ruta de consulta configurada: GSGchat no le pregunta nada a GSG. Configúrala en «Cambiar la URL o la API Key de GSG».');
    var hayClave = g.modo === 'real' && g.tieneToken;
    $('gsg-token').placeholder = hayClave ? (g.claveEnmascarada || '••••') + ' (guardada)' : '';
    $('gsg-token-pista').textContent = hayClave
      ? 'Guardada: ' + (g.claveEnmascarada || '••••') + '. Déjala vacía para conservarla, o pega una nueva para cambiarla.'
      : 'Te la da GSG. Se manda solo en la cabecera X-API-Key, se guarda cifrada y no se vuelve a mostrar entera.';
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
    resultadoGsg('Revisando la configuración de GSG (sin llamarle)…', 'espera');
    try {
      var r = await api('/admin/entregas/gsg/probar', { method: 'POST', body: {} });
      resultadoGsg((r.ok ? '✓ Bien configurado. ' : '✗ Hay que corregirlo. ') + r.prueba.detalle, r.ok ? 'bien' : 'mal');
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
  $('gsg-url').oninput = pintarUrlFinalGsg;
  $('gsg-ruta').oninput = pintarUrlFinalGsg;
  ['gsg-url', 'gsg-ruta-estado', 'gsg-param-tracking', 'gsg-param-telefono'].forEach(function (id) { $(id).addEventListener('input', pintarUrlEstadoGsg); });
  ['gsg-url', 'gsg-ruta-incidencias'].forEach(function (id) { $(id).addEventListener('input', pintarUrlIncidenciasGsg); });
  ['gsg-url', 'gsg-ruta-webhook'].forEach(function (id) { $(id).addEventListener('input', pintarUrlWebhookGsg); });
  $('gsg-consulta-form').onsubmit = async function (ev) {
    ev.preventDefault();
    var salida = $('gsg-consulta-resultado');
    var boton = $('gsg-consulta-enviar');
    boton.disabled = true;
    salida.textContent = 'Consultando a GSG…';
    ver('gsg-consulta-resultado', true);
    try {
      var r = await api('/admin/entregas/gsg/consultar-estado', { method: 'POST', body: { tracking: val('gsg-consulta-tracking'), telefono: val('gsg-consulta-telefono') || undefined } });
      var que = { activo: 'Activo: se sigue el flujo y se le pide la ubicación.', cancelado: 'Cancelado: se deja de escribir por este tracking.', numero_incorrecto: 'Número incorrecto: se deja de escribir por este tracking.', tracking_incorrecto: 'Tracking incorrecto: se deja de escribir por este tracking.', no_contactable: 'No se puede contactar: se deja de escribir por este tracking.', desconocido: 'Desconocido: no se toma como cancelado, se sigue.' }[r.decision] || r.decision;
      salida.textContent = (r.configurada ? '' : 'Sin ruta de consulta configurada.\n') + 'Decisión: ' + que + '\n' + (r.motivo || '') + (r.http ? '\nHTTP ' + r.http : '') + (r.url ? '\nURL: ' + r.url : '') + (r.respuesta !== undefined ? '\n\nRespuesta de GSG:\n' + JSON.stringify(r.respuesta, null, 2) : '');
    } catch (error) {
      salida.textContent = 'No se pudo consultar: ' + error.message;
    } finally {
      boton.disabled = false;
    }
  };
  $('gsg-form').onsubmit = async function (ev) {
    ev.preventDefault();
    var url = $('gsg-url').value.trim();
    var campoUrl = $('gsg-url');
    var campoRuta = $('gsg-ruta');
    campoUrl.removeAttribute('aria-invalid');
    campoRuta.removeAttribute('aria-invalid');
    var base = normalizarBaseGsg(url);
    if (!base.ok) {
      campoUrl.setAttribute('aria-invalid', 'true');
      campoUrl.focus();
      resultadoGsg('URL base de GSG: ' + base.error + ' Por ejemplo https://backend.developer.gsgcorp.pe/api/', 'mal');
      return;
    }
    var union = pintarUrlFinalGsg();
    if (!union || !union.ok) {
      campoRuta.setAttribute('aria-invalid', 'true');
      campoRuta.focus();
      resultadoGsg('Ruta para enviar la ubicación: ' + (union ? union.error : 'falta la ruta.') + ' Por ejemplo v1/gsgchat/location', 'mal');
      return;
    }
    var boton = $('gsg-guardar');
    boton.disabled = true;
    resultadoGsg('Guardando…', 'espera');
    try {
      var token = $('gsg-token').value.trim();
      var guardado = await api('/admin/entregas/gsg', { method: 'POST', body: { modo: 'real', url: url, rutaUbicacion: $('gsg-ruta').value.trim(), rutaEstado: $('gsg-ruta-estado').value.trim(), rutaIncidencias: $('gsg-ruta-incidencias').value.trim(), rutaWebhook: $('gsg-ruta-webhook').value.trim(), paramTracking: $('gsg-param-tracking').value.trim() || undefined, paramTelefono: $('gsg-param-telefono').value.trim() || undefined, apiKey: token || undefined } });
      $('gsg-token').value = '';
      if (guardado.webhookGsg && guardado.webhookGsg.secreto) mostrarSecretoWebhook(guardado.webhookGsg.secreto);
      await probarGsg();
    } catch (error) { resultadoGsg('✗ No se pudo guardar: ' + error.message, 'mal'); }
    boton.disabled = false;
  };
  /* El secreto sale una sola vez: aqui se ve, y al cerrar o recargar ya no hay forma de verlo. */
  function mostrarSecretoWebhook(secreto) {
    texto('gsg-webhook-secreto', secreto);
    ver('gsg-webhook-caja', true);
    ver('gsg-webhook-secreto-caja', true);
  }
  function ocultarSecretoWebhook() { texto('gsg-webhook-secreto', ''); ver('gsg-webhook-secreto-caja', false); }
  $('gsg-webhook-ocultar').onclick = ocultarSecretoWebhook;
  $('gsg-webhook-copiar').onclick = async function () {
    try { await navigator.clipboard.writeText($('gsg-webhook-secreto').textContent); this.textContent = 'Copiado'; }
    catch (e) { this.textContent = 'Selecciónalo y cópialo a mano'; }
  };
  $('gsg-webhook-rotar').onclick = async function () {
    var ok = await confirmarDialogo({ titulo: 'Generar un secreto nuevo', texto: 'El secreto anterior deja de valer en el acto: GSG tendrá que usar el nuevo.', boton: 'Generar', peligro: true });
    if (!ok) return;
    try { var r = await api('/admin/entregas/gsg/webhook/secreto', { method: 'POST', body: {} }); mostrarSecretoWebhook(r.secreto); }
    catch (error) { resultadoGsg('✗ ' + error.message, 'mal'); }
  };
  $('gsg-quitar').onclick = async function () {
    var ok = await confirmarDialogo({ titulo: 'Desconectar GSG', texto: 'Lo reportable se guarda en la cola y saldrá entero cuando se vuelva a conectar.', boton: 'Desconectar', peligro: true });
    if (!ok) return;
    try { await api('/admin/entregas/gsg', { method: 'DELETE' }); $('gsg-url').value = ''; $('gsg-ruta').value = ''; ocultarSecretoWebhook(); pintarUrlFinalGsg(); resultadoGsg('', ''); estado('gsg-state', 'Desconectado: lo que haya que mandarle a GSG se guarda y saldrá entero al volver a conectar.', 'verde'); cargarGsg(); }
    catch (error) { estado('gsg-state', error.message, 'rojo'); }
  };

  function pintarExtras(r) {
    var d = r.descartes || { lista: [] };
    if (d.lista && d.lista.length) {
      texto('gsg-descartes-titulo', d.lista.length + (d.lista.length === 1 ? ' pedido de hoy no se pudo leer' : ' pedidos de hoy no se pudieron leer'));
      $('gsg-descartes-lista').innerHTML = d.lista.map(function (x) {
        return '<li><b>' + esc(x.referencia) + '</b>' + (x.lista ? ' (' + esc(x.lista === 'faltaUbicacion' ? 'para pedir la ubicación' : 'para confirmar') + ')' : '') + ': ' + esc(x.motivo) + '</li>';
      }).join('');
      ver('gsg-descartes', true);
    } else ver('gsg-descartes', false);

    var llamadas = r.bitacora || [];
    if ($('gsg-bitacora')) $('gsg-bitacora').innerHTML = llamadas.length
      ? '<table><thead><tr><th>Hora</th><th>Llamada</th><th>Con qué entró</th><th>Qué pasó</th></tr></thead><tbody>' +
        llamadas.map(function (l) {
          return '<tr><td>' + esc(hora(l.en)) + '</td><td><code>' + esc(l.que) + '</code></td><td>' + esc(l.quien) +
            '</td><td><span class="chip tono-' + (l.status >= 400 ? 'rojo' : 'verde') + '">' + l.status + '</span> ' + esc(l.resultado) + '</td></tr>';
        }).join('') + '</tbody></table>'
      : 'Todavía nadie ha llamado. Cuando GSG mande pedidos, aquí se verá qué llegó y qué se les contestó.';
  }
  async function cargarExtras() {
    try { pintarExtras(await api('/admin/gsg')); } catch (error) { estado('gsg-state', error.message, 'rojo'); }
  }

  /* Lo que enviamos a GSG: cada ubicacion, con su estado. */
  async function cargarEnvios() {
    var caja = $('gsg-envios');
    if (!caja) return;
    try {
      var env = await api('/admin/gsg/envios');
      var ESTADOS = { enviado: 'Enviado a GSG', pendiente: 'Pendiente de enviar', fallido: 'Falló el envío' };
      /* A dónde va cada cosa, como tabla: qué, método y dirección. */
      var destinos = $('gsg-envios-destino');
      if (destinos) {
        if (env.aviso) destinos.textContent = env.aviso;
        else destinos.innerHTML = '<table><thead><tr><th>Qué le enviamos</th><th>Método</th><th>Dirección</th></tr></thead><tbody>' +
          '<tr><td>Ubicaciones</td><td><span class="chip tono-azul sin-punto">POST</span></td><td><code>' + esc(env.destino || '(sin dirección)') + '</code></td></tr>' +
          '<tr><td>Problemas (números mal y errores)</td><td><span class="chip tono-azul sin-punto">POST</span></td><td><code>' + esc(env.destinoProblemas || '(sin dirección)') + '</code></td></tr>' +
          '</tbody></table><p class="ayuda">Las dos llevan la cabecera <code>X-API-Key</code> con la API Key de GSG.</p>';
      }
      caja.innerHTML = (env.items || []).length
        ? '<div class="tablewrap"><table><thead><tr><th>Fecha</th><th>Qué</th><th>Cuerpo enviado</th><th>Estado</th><th class="num">Intentos</th><th>Error</th></tr></thead><tbody>' + env.items.map(function (r) {
            var tono = { enviado: 'verde', pendiente: 'ambar', fallido: 'rojo' }[r.estado] || 'gris';
            var ref = r.cuerpo && (r.cuerpo.tracking || r.cuerpo.referencia);
            return '<tr><td class="nowrap suave">' + esc(new Date(r.enviadoEn || r.en).toLocaleString('es-PE')) + '</td><td class="nowrap">' + (r.tipo === 'incidencia' ? 'Problema' : 'Ubicación') + (ref ? ' <span class="ref">' + esc(ref) + '</span>' : '') + '</td><td><details class="gsg-cuerpo"><summary>Ver cuerpo</summary><code>' + esc(JSON.stringify(r.cuerpo)) + '</code></details></td><td><span class="chip tono-' + tono + '">' + esc(ESTADOS[r.estado] || r.estado) + '</span></td><td class="num">' + esc(r.intentos) + '</td><td class="error-celda">' + esc(r.error || '') + '</td></tr>';
          }).join('') + '</tbody></table></div>'
        : '<div class="vacio compacto"><h3>Todavía no se ha enviado nada a GSG</h3><p>Cada ubicación se envía sola cuando un cliente la manda por WhatsApp.</p></div>';
      if (window.filtroDeTabla) window.filtroDeTabla(caja.querySelector('.tablewrap'));
    } catch (error) { caja.textContent = 'No se pudo consultar lo enviado a GSG: ' + error.message; }
  }
  if ($('gsg-envios-refrescar')) $('gsg-envios-refrescar').onclick = function (ev) { ev.preventDefault(); cargarEnvios(); };
  if ($('gsg-envios-caja')) $('gsg-envios-caja').addEventListener('toggle', function () { if (this.open) cargarEnvios(); });

  if ($('gsg-bitacora-refrescar')) $('gsg-bitacora-refrescar').onclick = function (ev) { ev.preventDefault(); cargarExtras(); };
  async function cargarSeguimiento() {
    var caja = $('seguimiento-estado');
    if (!caja) return;
    caja.textContent = 'Revisando…';
    try {
      var r = await api('/admin/entregas/seguimiento/estado');
      caja.textContent = (r.conectado ? 'Hay seguimiento recibido de GSG.' : 'Sin seguimiento de GSG: GSGchat no se lo pide (nunca le pide nada a GSG), así que al cliente se le contesta con el horario y la situación de su pedido.') + ' ' +
        (r.googleConfigurado ? 'Cálculo de rutas configurado.' : 'Falta configurar Google Maps para calcular kilómetros y tiempos.') + ' ' +
        (r.ultimoExito ? 'Último seguimiento válido: ' + new Date(r.ultimoExito).toLocaleString() + '.' : 'Todavía no se ha obtenido seguimiento válido.') + ' ' + (r.ultimoError || '');
      $('seguimiento-pedidos').textContent = (r.pedidos || []).map(function(p) {
        return p.tracking + ': ' + (p.fallo ? p.fallo.proveedor + ' / ' + p.fallo.codigo + ' — ' + p.fallo.detalle : 'seguimiento válido') + (p.gpsAt ? ' · GPS ' + new Date(p.gpsAt).toLocaleString() : '') + (p.versionRuta ? ' · ruta ' + p.versionRuta : '');
      }).join(' | ');
    } catch (error) { caja.textContent = 'No se pudo consultar el diagnóstico: ' + error.message; }
  }
  /* «Actualizar diagnóstico»: antes volvia a pintar el mismo texto y parecia
     que no hacia nada. Ahora revisa todo lo de GSG y dice cuando lo hizo. */
  if ($('seguimiento-refrescar')) $('seguimiento-refrescar').onclick = async function () {
    var boton = $('seguimiento-refrescar');
    boton.disabled = true;
    boton.textContent = 'Revisando…';
    sinEstado('seguimiento-cuando');
    await Promise.all([cargarSeguimiento(), cargarGsg(), cargarExtras(), $('gsg-envios-caja') && $('gsg-envios-caja').open ? cargarEnvios() : Promise.resolve()]);
    boton.disabled = false;
    boton.textContent = 'Actualizar diagnóstico';
    var ahora = new Date();
    estado('seguimiento-cuando', 'Actualizado a las ' + String(ahora.getHours()).padStart(2, '0') + ':' + String(ahora.getMinutes()).padStart(2, '0') + ':' + String(ahora.getSeconds()).padStart(2, '0'), 'verde');
  };
  cargarSeguimiento();
  cargarGsg();
  cargarExtras();
  if ($('gsg-envios-caja') && $('gsg-envios-caja').open) cargarEnvios();
}
`;
  const script = scriptComun + (vistaWa ? scriptWa + scriptLineas : '') + (tarjetaGsg ? scriptGsg : '');

  return appShell({
    titulo: vistaWa ? 'Conexión WhatsApp' : 'Conexión con GSG',
    subtitulo: vistaWa ? 'El número de WhatsApp: si está conectado y qué falta' : 'Lo que GSGchat le manda y le pregunta a GSG: URL, API Key, ubicaciones y consulta de estado',
    contenido,
    script,
    css: CSS,
    nombreNegocio: opts.nombreNegocio,
    demo: opts.demo,
    icono: '🔌',
  });
}
