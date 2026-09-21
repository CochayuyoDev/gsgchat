/**
 * /login: iniciar sesion o registrarse, con las dos a la vista.
 *
 * Antes la pagina ensenaba UNA sola cara segun el estado de la base: sin
 * usuarios, el formulario de registro; con usuarios, el de entrar. Quien
 * pulsaba "Entrar" en la portada aterrizaba de golpe en un registro que no
 * habia pedido, sin nada en pantalla que dijera que ahi tambien se entra.
 *
 * Ahora se ofrecen las dos y el estado de la base decide cual viene marcada:
 * con la tabla vacia, Registro; con usuarios, Inicio de sesion. El registro
 * sigue siendo solo para la primera cuenta —el servidor lo rechaza en cuanto
 * hay una—, asi que en ese caso la pestana lo dice en vez de ensenar un
 * formulario que no va a funcionar.
 */

import { INICIAL_SISTEMA, LEMA_SISTEMA, NOMBRE_SISTEMA } from '../marca.js';
import { TOKENS_CSS } from './tokens.js';

const CSS = `
  ${TOKENS_CSS}
  :root { --accent-2: #25d366; --dark: #0f1a17; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; grid-template-columns: 1fr 1fr; background: var(--bg); color: var(--text); font: 15px/1.55 var(--fuente); }
  .lado { background: var(--dark); color: #e8f1ee; padding: 40px 48px; display: flex; flex-direction: column; justify-content: space-between; }
  .lado .marca { color: #fff; }
  .lado h2 { font-size: 34px; line-height: 1.12; letter-spacing: -.02em; margin: 0 0 14px; max-width: 460px; }
  .lado h2 span { color: var(--accent-2); }
  .lado p { color: #a9bbb5; margin: 0; max-width: 440px; font-size: 16px; }
  .lado ul { list-style: none; padding: 0; margin: 26px 0 0; display: grid; gap: 10px; max-width: 460px; }
  .lado li { display: flex; gap: 10px; align-items: flex-start; font-size: 14.5px; color: #d5e2dd; }
  .lado li i { flex: none; width: 20px; height: 20px; border-radius: 50%; background: rgba(37,211,102,.18); color: var(--accent-2); display: grid; place-items: center; font-style: normal; font-size: 12px; font-weight: 800; margin-top: 2px; }
  .lado small { color: #8fa39c; font-size: 12.5px; }
  .centro { display: flex; align-items: center; justify-content: center; padding: 28px 20px; }
  .caja { width: 100%; max-width: 400px; background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 28px 26px; box-shadow: var(--sombra-2); }
  h1 { font-size: 20px; margin: 0 0 4px; letter-spacing: -.01em; }
  .marca { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; text-decoration: none; color: var(--text); font-weight: 800; }
  .marca .logo { width: 36px; height: 36px; border-radius: 10px; background: var(--accent); color: var(--primario-texto); display: grid; place-items: center; font-weight: 700; }
  p.muted { color: var(--muted); font-size: 13px; margin: 0 0 14px; }
  @media (max-width: 860px) { body { grid-template-columns: 1fr; } .lado { display: none; } .centro { align-items: flex-start; padding-top: 40px; } }
  label { display: block; font-size: 13px; font-weight: 600; margin: 12px 0 5px; }
  input { width: 100%; min-height: 44px; padding: 11px 12px; font: inherit; font-size: 15px; color: var(--text); background: var(--card); border: 1px solid var(--line); border-radius: var(--radio-sm); }
  input:focus { border-color: var(--primario); outline: 2px solid var(--primario-suave); outline-offset: 0; }
  button { width: 100%; min-height: 46px; margin-top: 18px; padding: 12px; font: inherit; font-weight: 700; border: 0; border-radius: var(--radio-sm); background: var(--accent); color: var(--primario-texto); cursor: pointer; }
  button:hover { filter: brightness(1.06); }
  button:focus-visible { outline: 2px solid var(--primario); outline-offset: 2px; }
  button:disabled { opacity: .6; cursor: default; }
  .error { color: var(--bad); font-size: 13px; margin-top: 10px; min-height: 18px; }
  .error:not(:empty) { background: var(--rojo-suave); border-radius: var(--radio-sm); padding: 8px 10px; }
  a { color: var(--accent); }
  .pie { margin-top: 16px; font-size: 12.5px; color: var(--muted); text-align: center; }
  .pestanas { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; background: var(--superficie-2); border: 1px solid var(--line); border-radius: 11px; padding: 4px; margin-bottom: 18px; }
  .pestanas button { width: auto; min-height: 40px; margin: 0; padding: 9px 8px; font-size: 14px; font-weight: 600; border-radius: 8px; background: transparent; color: var(--muted); }
  .pestanas button:hover { filter: none; color: var(--text); }
  .pestanas button[aria-selected="true"] { background: var(--card); color: var(--text); box-shadow: var(--sombra); }
`;

export function loginPage(opts: { primeraCuenta: boolean; next: string; nombreNegocio: string }): string {
  const next = JSON.stringify(opts.next || '/panel');

  const entrar = `
      <h1>Inicio de sesión</h1>
      <p class="muted">Con tu usuario y contraseña.</p>
      <form id="f-entrar">
        <label for="e-usuario">Usuario</label>
        <input id="e-usuario" name="usuario" required autocomplete="username">
        <label for="e-clave">Contraseña</label>
        <input id="e-clave" name="clave" type="password" required autocomplete="current-password">
        <button>Iniciar sesión</button>
        <div class="error" id="e-error"></div>
      </form>`;

  // Con usuarios en la tabla el registro esta cerrado: el servidor devuelve un
  // 409. Se dice en la pestana en vez de ensenar un formulario que va a fallar.
  const registro = opts.primeraCuenta
    ? `
      <h1>Registro</h1>
      <p class="muted">Todavía no hay usuarios: esta primera cuenta es la administradora, y desde el panel crea las demás.</p>
      <form id="f-registro" autocomplete="off">
        <label for="r-nombre">Tu nombre</label>
        <input id="r-nombre" name="nombre" placeholder="Ali" required>
        <label for="r-usuario">Usuario</label>
        <input id="r-usuario" name="usuario" placeholder="ali" required autocomplete="username">
        <label for="r-clave">Contraseña (8 caracteres o más)</label>
        <input id="r-clave" name="clave" type="password" required autocomplete="new-password">
        <label for="r-clave2">Repite la contraseña</label>
        <input id="r-clave2" name="clave2" type="password" required autocomplete="new-password">
        <button>Registrarme</button>
        <div class="error" id="r-error"></div>
      </form>`
    : `
      <h1>Registro</h1>
      <p class="muted">El registro abierto es solo para la primera cuenta, y ya existe. Pídele la tuya a quien administra el sistema: la crea en el panel, en Usuarios.</p>`;

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Inicio de sesión - ${escapeHtml(opts.nombreNegocio)} · ${NOMBRE_SISTEMA}</title><style>${CSS}</style></head>
<body>
<aside class="lado">
  <a class="marca" href="/"><div class="logo">${INICIAL_SISTEMA}</div>${NOMBRE_SISTEMA}</a>
  <div>
    <h2>Tu WhatsApp trabajando por ti, <span>sin quemar el número</span>.</h2>
    <p>Ubicaciones para el reparto, un chat para todo el equipo y campañas al ritmo que WhatsApp tolera.</p>
    <ul>
      <li><i>✓</i>Entregas: pide la ubicación, confirma el pedido, manda el pin al motorizado y avisa la hora de llegada.</li>
      <li><i>✓</i>Salud del número: un semáforo que frena solo antes del baneo.</li>
      <li><i>✓</i>Cuentas por persona y claves de API para los programas.</li>
    </ul>
  </div>
  <small>Acceso solo para el equipo.</small>
</aside>
<div class="centro">
<div class="caja">
  <div class="marca"><div class="logo">${INICIAL_SISTEMA}</div><div><b>${escapeHtml(opts.nombreNegocio)}</b><div class="pie" style="margin:0;text-align:left;font-weight:400">${NOMBRE_SISTEMA} · ${LEMA_SISTEMA}</div></div></div>
  <div class="pestanas" role="tablist">
    <button type="button" id="tab-entrar" role="tab">Inicio de sesión</button>
    <button type="button" id="tab-registro" role="tab">${opts.primeraCuenta ? 'Registro' : '¿Primera vez?'}</button>
  </div>
  <div id="panel-entrar">${entrar}</div>
  <div id="panel-registro">${registro}</div>
  <div class="pie"><a href="/">Volver al inicio</a></div>
</div>
</div>
<script>
(function () {
  var primera = ${opts.primeraCuenta ? 'true' : 'false'};
  var next = ${next};

  // Sin usuarios no se puede entrar, asi que la pestana marcada es Registro;
  // en cuanto hay uno, la de siempre.
  var vistas = {
    entrar: { tab: document.getElementById('tab-entrar'), panel: document.getElementById('panel-entrar') },
    registro: { tab: document.getElementById('tab-registro'), panel: document.getElementById('panel-registro') }
  };

  function mostrar(cual) {
    for (var clave in vistas) {
      var v = vistas[clave];
      var activa = clave === cual;
      v.panel.hidden = !activa;
      v.tab.setAttribute('aria-selected', activa ? 'true' : 'false');
    }
    var foco = vistas[cual].panel.querySelector('input');
    if (foco) foco.focus();
  }

  vistas.entrar.tab.onclick = function () { mostrar('entrar'); };
  vistas.registro.tab.onclick = function () { mostrar('registro'); };
  mostrar(primera ? 'registro' : 'entrar');

  function enviar(form, url, error, arma) {
    if (!form) return;
    var boton = form.querySelector('button');
    form.onsubmit = async function (ev) {
      ev.preventDefault();
      error.textContent = '';
      var cuerpo = arma(error);
      if (!cuerpo) return;
      boton.disabled = true;
      try {
        var res = await fetch(url, {
          method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
          body: JSON.stringify(cuerpo)
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) { error.textContent = data.error || 'No se pudo entrar.'; boton.disabled = false; return; }
        location.href = data.next || next;
      } catch (e) {
        error.textContent = 'No se pudo conectar con el servidor.';
        boton.disabled = false;
      }
    };
  }

  var fe = document.getElementById('f-entrar');
  enviar(fe, '/login', document.getElementById('e-error'), function () {
    return { usuario: fe.usuario.value.trim(), clave: fe.clave.value };
  });

  var fr = document.getElementById('f-registro');
  if (fr) {
    enviar(fr, '/login/primera-cuenta', document.getElementById('r-error'), function (error) {
      if (fr.clave.value !== fr.clave2.value) { error.textContent = 'Las contraseñas no coinciden.'; return null; }
      return { nombre: fr.nombre.value.trim(), usuario: fr.usuario.value.trim(), clave: fr.clave.value };
    });
  }
})();
</script>
</body></html>`;
}

export function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
