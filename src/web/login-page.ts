/**
 * /login: entrar, y crear la primera cuenta si el sistema esta recien puesto.
 *
 * La pagina ofrece las dos cosas a la vez y el estado de la base decide cual
 * viene marcada: con la tabla vacia, "Crear la primera cuenta"; con usuarios,
 * "Entrar". El registro abierto es SOLO para esa primera cuenta -el servidor
 * devuelve 409 en cuanto hay una-, asi que cuando ya existe no se enseña un
 * formulario que iba a fallar: se dice a quien pedirle la cuenta.
 *
 * Lo que valida el navegador es exactamente lo que valida el servidor
 * (`usuarioAceptable` y `claveAceptable` en auth/usuarios.ts): las reglas
 * estan copiadas abajo en REGLAS con los mismos textos, para que nadie vea
 * dos mensajes distintos por el mismo fallo.
 *
 * Aqui vive tambien `escapeHtml` (la usan el armazon, la portada, el manual y
 * la pantalla del motorizado) y `PROMESA`, la frase con la que se presenta el
 * sistema. La portada la importa de aqui para que no haya dos versiones del
 * mismo texto en dos pantallas.
 */

import { INICIAL_SISTEMA, LEMA_SISTEMA, NOMBRE_SISTEMA } from '../marca.js';
import { TOKENS_CSS } from './tokens.js';

/**
 * Como se presenta el sistema, en un solo sitio.
 *
 * La portada y el login son la misma primera impresion; antes cada una tenia
 * su copia del titular y se fueron separando. Se escribe una vez.
 */
export const PROMESA = {
  titular: 'Tu WhatsApp trabajando por ti,',
  remate: 'sin quemar el número',
  bajada:
    'Pide la ubicación a cada cliente del reparto, atiende y cotiza desde un solo chat, y manda campañas al ritmo que WhatsApp tolera.',
  puntos: [
    'Entregas: pide la ubicación, confirma el pedido, manda el pin al motorizado y avisa la hora de llegada.',
    'Salud del número: un semáforo que frena solo antes del baneo.',
    'Cuentas por persona y claves de API para los programas.',
  ],
} as const;

/**
 * Las mismas reglas que aplica el servidor, para avisar sin ir y volver.
 * Si cambian en `auth/usuarios.ts`, cambian aqui.
 */
const REGLAS = {
  usuario: {
    patron: '^[a-z0-9._-]{3,40}$',
    ayuda: 'Entre 3 y 40 caracteres: minúsculas, números, punto, guion o guion bajo.',
    error: 'El usuario lleva entre 3 y 40 caracteres: minúsculas, números, punto, guion o guion bajo.',
  },
  clave: {
    minimo: 8,
    ayuda: 'Ocho caracteres o más.',
    error: 'La contraseña necesita al menos 8 caracteres.',
  },
};

const CSS = `
  ${TOKENS_CSS}
  /* El panel de la izquierda es una franja de marca: oscura siempre, en modo
     claro y en oscuro. Por eso tiene sus propios tonos con nombre en vez de
     los del sistema, que se dan la vuelta con el tema. */
  :root { --marca-fondo: #0f1a17; --marca-texto: #e8f1ee; --marca-suave: #a9bbb5; --marca-tenue: #8fa39c; --marca-acento: #25d366; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; grid-template-columns: 1.05fr 1fr; background: var(--bg); color: var(--texto); font: var(--fs-cuerpo)/1.55 var(--fuente); }

  /* --- franja de marca --- */
  .marca-lado { background: var(--marca-fondo); color: var(--marca-texto); padding: var(--esp-6) 48px; display: flex; flex-direction: column; justify-content: space-between; gap: var(--esp-5); }
  .marca-lado .logotipo { color: #fff; }
  .marca-lado h2 { font-size: 34px; line-height: 1.12; letter-spacing: -.02em; margin: 0 0 14px; max-width: 460px; }
  .marca-lado h2 span { color: var(--marca-acento); }
  .marca-lado p { color: var(--marca-suave); margin: 0; max-width: 440px; font-size: 16px; }
  .marca-lado ul { list-style: none; padding: 0; margin: var(--esp-5) 0 0; display: grid; gap: var(--esp-2); max-width: 460px; }
  .marca-lado li { display: flex; gap: var(--esp-2); align-items: flex-start; font-size: 14.5px; color: var(--marca-texto); }
  .marca-lado li::before { content: '✓'; flex: none; width: 20px; height: 20px; border-radius: 50%; background: rgba(37,211,102,.18); color: var(--marca-acento); display: grid; place-items: center; font-size: 12px; font-weight: 800; margin-top: 2px; }
  .marca-lado small { color: var(--marca-tenue); font-size: var(--fs-small); }

  /* --- logotipo, en las dos columnas --- */
  .logotipo { display: flex; align-items: center; gap: var(--esp-2); text-decoration: none; color: inherit; font-weight: 800; }
  .logotipo .sello { width: 36px; height: 36px; flex: none; border-radius: 10px; background: var(--primario); color: var(--primario-texto); display: grid; place-items: center; font-weight: 700; }

  /* --- columna del formulario --- */
  .centro { display: flex; align-items: center; justify-content: center; padding: var(--esp-5) var(--esp-4); }
  .caja { width: 100%; max-width: 400px; background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); padding: var(--esp-5) var(--esp-5) var(--esp-4); box-shadow: var(--sombra-2); }
  .caja > .logotipo { color: var(--texto); margin-bottom: var(--esp-4); }
  .caja > .logotipo small { display: block; font-weight: 400; font-size: var(--fs-small); color: var(--texto-suave); }
  h1 { font-size: var(--fs-h1); margin: 0 0 4px; letter-spacing: -.01em; }
  .entradilla { color: var(--texto-suave); font-size: 13px; margin: 0 0 var(--esp-3); }

  /* --- pestañas --- */
  .pestanas { display: grid; grid-template-columns: 1fr 1fr; gap: var(--esp-1); background: var(--superficie-2); border: 1px solid var(--borde); border-radius: 11px; padding: var(--esp-1); margin-bottom: var(--esp-4); }
  .pestanas button { min-height: 44px; padding: 9px 8px; font: inherit; font-size: 14px; font-weight: 600; border: 0; border-radius: var(--radio-sm); background: transparent; color: var(--texto-suave); cursor: pointer; }
  .pestanas button:hover { color: var(--texto); }
  .pestanas button[aria-selected="true"] { background: var(--superficie); color: var(--texto); box-shadow: var(--sombra); }
  .pestanas button:focus-visible { outline: 2px solid var(--primario); outline-offset: 2px; }

  /* --- campos --- */
  label { display: block; font-size: 13px; font-weight: 600; margin: var(--esp-3) 0 5px; }
  input { width: 100%; min-height: 44px; padding: 11px 12px; font: inherit; font-size: 15px; color: var(--texto); background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio-sm); }
  input:focus { border-color: var(--primario); outline: 2px solid var(--primario-suave); outline-offset: 0; }
  .pista { display: block; margin-top: 5px; font-size: var(--fs-small); color: var(--texto-suave); }
  button[type="submit"] { width: 100%; min-height: 46px; margin-top: var(--esp-4); padding: 12px; font: inherit; font-weight: 700; border: 0; border-radius: var(--radio-sm); background: var(--primario); color: var(--primario-texto); cursor: pointer; }
  button[type="submit"]:hover { filter: brightness(1.06); }
  button[type="submit"]:focus-visible { outline: 2px solid var(--primario); outline-offset: 2px; }
  button[type="submit"]:disabled { opacity: .6; cursor: default; }

  /* Vacio no ocupa sitio: el formulario no da un salto cuando aparece. */
  .aviso { color: var(--rojo); font-size: 13px; margin-top: var(--esp-2); }
  .aviso:not(:empty) { background: var(--rojo-suave); border-radius: var(--radio-sm); padding: 8px 10px; }

  .pie { margin-top: var(--esp-4); font-size: var(--fs-small); color: var(--texto-suave); text-align: center; }
  a { color: var(--primario); }

  @media (max-width: 860px) {
    body { grid-template-columns: 1fr; }
    .marca-lado { display: none; }
    .centro { align-items: flex-start; padding-top: var(--esp-6); }
  }
`;

/** El formulario de entrar: siempre esta, con o sin usuarios en la base. */
const FORM_ENTRAR = `
      <h1>Entrar</h1>
      <p class="entradilla">Con el usuario y la contraseña de tu cuenta.</p>
      <form id="f-entrar" novalidate>
        <label for="e-usuario">Usuario</label>
        <input id="e-usuario" name="usuario" required autocomplete="username" autocapitalize="none" spellcheck="false">
        <label for="e-clave">Contraseña</label>
        <input id="e-clave" name="clave" type="password" required autocomplete="current-password">
        <button type="submit">Entrar</button>
        <div class="aviso" id="e-aviso" role="alert" aria-live="polite"></div>
      </form>`;

/**
 * La primera cuenta. Solo se ofrece con la tabla vacia; despues, el servidor
 * responde 409 y aqui se dice a quien pedirle una en vez de enseñar un
 * formulario condenado a fallar.
 */
const FORM_PRIMERA = `
      <h1>Crear la primera cuenta</h1>
      <p class="entradilla">Todavía no hay ninguna. Esta será la del dueño del sistema: desde el panel crea las cuentas del resto del equipo.</p>
      <form id="f-registro" novalidate>
        <label for="r-nombre">Tu nombre</label>
        <input id="r-nombre" name="nombre" placeholder="Ali" required maxlength="80">
        <label for="r-usuario">Usuario</label>
        <input id="r-usuario" name="usuario" placeholder="ali" required autocomplete="username" autocapitalize="none" spellcheck="false" pattern="${REGLAS.usuario.patron}">
        <span class="pista">${REGLAS.usuario.ayuda}</span>
        <label for="r-clave">Contraseña</label>
        <input id="r-clave" name="clave" type="password" required autocomplete="new-password" minlength="${REGLAS.clave.minimo}">
        <span class="pista">${REGLAS.clave.ayuda}</span>
        <label for="r-clave2">Repite la contraseña</label>
        <input id="r-clave2" name="clave2" type="password" required autocomplete="new-password">
        <button type="submit">Crear la cuenta y entrar</button>
        <div class="aviso" id="r-aviso" role="alert" aria-live="polite"></div>
      </form>`;

const REGISTRO_CERRADO = `
      <h1>Pídele tu cuenta al administrador</h1>
      <p class="entradilla">El registro abierto es solo para la primera cuenta del sistema, y ya existe. Quien administra el sistema crea la tuya desde el panel, en Usuarios; después entras por esta misma pantalla.</p>`;

export function loginPage(opts: { primeraCuenta: boolean; next: string; nombreNegocio: string }): string {
  const negocio = escapeHtml(opts.nombreNegocio);
  // El `next` viene de la URL: si trajera un "</script>" cerraria la etiqueta
  // y lo de despues correria como HTML. Escapado, no hay tal cosa.
  const config = JSON.stringify({
    primera: opts.primeraCuenta,
    next: opts.next || '/panel',
    reglas: { usuario: REGLAS.usuario, clave: REGLAS.clave },
  }).replace(/</g, '\\u003c');

  const script =
    String.raw`
(function () {
  var CFG = ` +
    config +
    String.raw`;

  // --- las dos caras: entrar y crear la primera cuenta -------------------
  var VISTAS = {
    entrar: { tab: document.getElementById('tab-entrar'), panel: document.getElementById('panel-entrar') },
    registro: { tab: document.getElementById('tab-registro'), panel: document.getElementById('panel-registro') }
  };

  function mostrar(cual) {
    for (var clave in VISTAS) {
      var vista = VISTAS[clave];
      var activa = clave === cual;
      vista.panel.hidden = !activa;
      vista.tab.setAttribute('aria-selected', activa ? 'true' : 'false');
      vista.tab.setAttribute('tabindex', activa ? '0' : '-1');
    }
    var primero = VISTAS[cual].panel.querySelector('input');
    if (primero) primero.focus();
  }

  VISTAS.entrar.tab.onclick = function () { mostrar('entrar'); };
  VISTAS.registro.tab.onclick = function () { mostrar('registro'); };
  // Sin usuarios no hay con que entrar: se abre por la de crear la cuenta.
  mostrar(CFG.primera ? 'registro' : 'entrar');

  // --- mandar un formulario ---------------------------------------------
  function avisar(caja, texto) { caja.textContent = texto || ''; }

  /** Manda el cuerpo y devuelve a donde hay que ir; si falla, lanza el motivo ya escrito para leer. */
  async function mandar(url, cuerpo) {
    var res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(cuerpo)
      });
    } catch (fallo) {
      throw new Error('No se pudo conectar con el servidor. Revisa tu conexión y vuelve a intentarlo.');
    }
    // El cuerpo puede no ser JSON (un 502 del proxy, una pagina de error):
    // entonces se enseña el codigo en vez de un "no se pudo" sin pistas.
    var datos = null;
    try { datos = JSON.parse(await res.text()); } catch (fallo) { datos = null; }
    if (!res.ok) {
      throw new Error((datos && datos.error) || ('El servidor respondió ' + res.status + '. Inténtalo otra vez; si sigue igual, avisa a quien administra el sistema.'));
    }
    return (datos && datos.next) || CFG.next;
  }

  /**
   * "leer" devuelve el cuerpo a mandar, o un texto si algo esta mal escrito:
   * asi la comprobacion del navegador y la del servidor salen por el mismo
   * sitio y con el mismo aspecto.
   */
  function conectar(form, url, leer) {
    if (!form) return;
    var boton = form.querySelector('button[type="submit"]');
    var caja = form.querySelector('.aviso');
    var etiqueta = boton.textContent;
    form.onsubmit = async function (ev) {
      ev.preventDefault();
      avisar(caja, '');
      var cuerpo = leer();
      if (typeof cuerpo === 'string') { avisar(caja, cuerpo); return; }
      boton.disabled = true;
      boton.textContent = 'Un momento…';
      try {
        location.href = await mandar(url, cuerpo);
      } catch (fallo) {
        avisar(caja, fallo.message);
        boton.disabled = false;
        boton.textContent = etiqueta;
      }
    };
  }

  var entrar = document.getElementById('f-entrar');
  conectar(entrar, '/login', function () {
    var usuario = entrar.usuario.value.trim();
    if (!usuario) return 'Escribe tu usuario.';
    if (!entrar.clave.value) return 'Escribe tu contraseña.';
    // El servidor decide a donde se va; se le manda para no perder el
    // ?next= con el que llego quien iba a otra pantalla.
    return { usuario: usuario, clave: entrar.clave.value, next: CFG.next };
  });

  var registro = document.getElementById('f-registro');
  conectar(registro, '/login/primera-cuenta', function () {
    var nombre = registro.nombre.value.trim();
    // El servidor guarda el usuario en minusculas: se enseña ya convertido
    // para que nadie crea que entrara con mayusculas.
    var usuario = registro.usuario.value.trim().toLowerCase();
    registro.usuario.value = usuario;
    var clave = registro.clave.value;
    if (!nombre) return 'Escribe tu nombre: es el que aparece en la bitácora.';
    if (!new RegExp(CFG.reglas.usuario.patron).test(usuario)) return CFG.reglas.usuario.error;
    if (clave.length < CFG.reglas.clave.minimo) return CFG.reglas.clave.error;
    if (clave !== registro.clave2.value) return 'Las dos contraseñas no coinciden.';
    return { nombre: nombre, usuario: usuario, clave: clave };
  });
})();
`;

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Acceso al sistema de ${negocio}.">
<title>Entrar - ${negocio} · ${NOMBRE_SISTEMA}</title><style>${CSS}</style></head>
<body>
<aside class="marca-lado">
  <a class="logotipo" href="/"><span class="sello">${INICIAL_SISTEMA}</span>${NOMBRE_SISTEMA}</a>
  <div>
    <h2>${PROMESA.titular} <span>${PROMESA.remate}</span>.</h2>
    <p>${PROMESA.bajada}</p>
    <ul>${PROMESA.puntos.map((p) => `<li>${p}</li>`).join('')}</ul>
  </div>
  <small>Acceso solo para el equipo.</small>
</aside>
<main class="centro">
<div class="caja">
  <div class="logotipo"><span class="sello">${INICIAL_SISTEMA}</span><span>${negocio}<small>${NOMBRE_SISTEMA} · ${LEMA_SISTEMA}</small></span></div>
  <div class="pestanas" role="tablist" aria-label="Entrar o crear la primera cuenta">
    <button type="button" id="tab-entrar" role="tab" aria-controls="panel-entrar">Entrar</button>
    <button type="button" id="tab-registro" role="tab" aria-controls="panel-registro">${opts.primeraCuenta ? 'Primera cuenta' : '¿No tienes cuenta?'}</button>
  </div>
  <div id="panel-entrar" role="tabpanel" aria-labelledby="tab-entrar">${FORM_ENTRAR}</div>
  <div id="panel-registro" role="tabpanel" aria-labelledby="tab-registro">${opts.primeraCuenta ? FORM_PRIMERA : REGISTRO_CERRADO}</div>
  <p class="pie"><a href="/">Volver al inicio</a></p>
</div>
</main>
<script>${script}</script>
</body></html>`;
}

/** Texto dentro de HTML. La usan el armazon, la portada, el manual y la pantalla del motorizado. */
export function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
