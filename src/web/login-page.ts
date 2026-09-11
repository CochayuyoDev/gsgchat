/**
 * /login: usuario y contrasena. Y, la primera vez, crear la primera cuenta.
 *
 * Una sola pagina con dos caras: si todavia no hay usuarios ensena el
 * formulario de "primera cuenta" (el servidor solo lo acepta mientras la
 * tabla este vacia); si ya los hay, el de entrar. Sin token que pegar.
 */

const CSS = `
  :root { color-scheme: light dark; --bg: #f5f6f8; --card: #fff; --line: #e3e5e9; --text: #16181d; --muted: #6b7280; --accent: #128c7e; --accent-2: #25d366; --bad: #dc2626; --dark: #0f1a17; }
  @media (prefers-color-scheme: dark) { :root { --bg: #16181d; --card: #1f2229; --line: #2f333c; --text: #f2f3f5; --muted: #9aa0aa; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; grid-template-columns: 1fr 1fr; background: var(--bg); color: var(--text); font: 15px/1.55 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  .lado { background: var(--dark); color: #e8f1ee; padding: 40px 48px; display: flex; flex-direction: column; justify-content: space-between; }
  .lado .marca { color: #fff; }
  .lado h2 { font-size: 34px; line-height: 1.12; letter-spacing: -.02em; margin: 0 0 14px; max-width: 460px; }
  .lado h2 span { color: var(--accent-2); }
  .lado p { color: #a9bbb5; margin: 0; max-width: 440px; font-size: 16px; }
  .lado ul { list-style: none; padding: 0; margin: 26px 0 0; display: grid; gap: 10px; max-width: 460px; }
  .lado li { display: flex; gap: 10px; align-items: flex-start; font-size: 14.5px; color: #d5e2dd; }
  .lado li i { flex: none; width: 20px; height: 20px; border-radius: 50%; background: rgba(37,211,102,.18); color: var(--accent-2); display: grid; place-items: center; font-style: normal; font-size: 12px; font-weight: 800; margin-top: 2px; }
  .lado small { color: #7f958e; font-size: 12.5px; }
  .centro { display: flex; align-items: center; justify-content: center; padding: 28px 20px; }
  .caja { width: 100%; max-width: 400px; background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 28px 26px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .marca { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; text-decoration: none; color: var(--text); font-weight: 800; }
  .marca .logo { width: 36px; height: 36px; border-radius: 10px; background: var(--accent); color: #fff; display: grid; place-items: center; font-weight: 700; }
  p.muted { color: var(--muted); font-size: 13px; margin: 0 0 14px; }
  @media (max-width: 860px) { body { grid-template-columns: 1fr; } .lado { display: none; } }
  label { display: block; font-size: 13px; font-weight: 600; margin: 12px 0 5px; }
  input { width: 100%; padding: 11px 12px; font: inherit; font-size: 15px; color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 9px; }
  button { width: 100%; margin-top: 18px; padding: 12px; font: inherit; font-weight: 600; border: 0; border-radius: 9px; background: var(--accent); color: #fff; cursor: pointer; }
  button:disabled { opacity: .6; cursor: default; }
  .error { color: var(--bad); font-size: 13px; margin-top: 10px; min-height: 18px; }
  a { color: var(--accent); }
  .pie { margin-top: 16px; font-size: 12.5px; color: var(--muted); text-align: center; }
`;

export function loginPage(opts: { primeraCuenta: boolean; next: string; nombreNegocio: string }): string {
  const next = JSON.stringify(opts.next || '/panel');
  const formulario = opts.primeraCuenta
    ? `
      <h1>Crea la primera cuenta</h1>
      <p class="muted">Todavía no hay usuarios. Esta cuenta será la administradora: podrá crear las demás desde el panel.</p>
      <form id="f" autocomplete="off">
        <label for="nombre">Tu nombre</label>
        <input id="nombre" name="nombre" placeholder="Ali" required autofocus>
        <label for="usuario">Usuario</label>
        <input id="usuario" name="usuario" placeholder="ali" required autocomplete="username">
        <label for="clave">Contraseña (8 caracteres o más)</label>
        <input id="clave" name="clave" type="password" required autocomplete="new-password">
        <label for="clave2">Repite la contraseña</label>
        <input id="clave2" name="clave2" type="password" required autocomplete="new-password">
        <button id="entrar">Crear cuenta y entrar</button>
        <div class="error" id="error"></div>
      </form>`
    : `
      <h1>Entrar</h1>
      <p class="muted">Con tu usuario y contraseña. Si no tienes cuenta, pídesela a quien administra el sistema.</p>
      <form id="f">
        <label for="usuario">Usuario</label>
        <input id="usuario" name="usuario" required autofocus autocomplete="username">
        <label for="clave">Contraseña</label>
        <input id="clave" name="clave" type="password" required autocomplete="current-password">
        <button id="entrar">Entrar</button>
        <div class="error" id="error"></div>
      </form>`;

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entrar - ${escapeHtml(opts.nombreNegocio)}</title><style>${CSS}</style></head>
<body>
<aside class="lado">
  <a class="marca" href="/"><div class="logo">W</div>${escapeHtml(opts.nombreNegocio)}</a>
  <div>
    <h2>Tu WhatsApp trabajando por ti, <span>sin quemar el número</span>.</h2>
    <p>Ubicaciones para el reparto, un chat para todo el equipo y campañas al ritmo que WhatsApp tolera.</p>
    <ul>
      <li><i>✓</i>Reparto: pide la ubicación a cada cliente e insiste con criterio.</li>
      <li><i>✓</i>Salud del número: un semáforo que frena solo antes del baneo.</li>
      <li><i>✓</i>Cuentas por persona y claves de API para los programas.</li>
    </ul>
  </div>
  <small>Acceso solo para el equipo.</small>
</aside>
<div class="centro">
<div class="caja">
  <div class="marca"><div class="logo">W</div><div><b>${escapeHtml(opts.nombreNegocio)}</b><div class="pie" style="margin:0;text-align:left;font-weight:400">WhatsApp para reparto y ventas</div></div></div>
  ${formulario}
  <div class="pie"><a href="/">Volver al inicio</a></div>
</div>
</div>
<script>
(function () {
  var primera = ${opts.primeraCuenta ? 'true' : 'false'};
  var next = ${next};
  var f = document.getElementById('f');
  var boton = document.getElementById('entrar');
  var error = document.getElementById('error');
  f.onsubmit = async function (ev) {
    ev.preventDefault();
    error.textContent = '';
    var cuerpo = { usuario: f.usuario.value.trim(), clave: f.clave.value };
    if (primera) {
      cuerpo.nombre = f.nombre.value.trim();
      if (f.clave.value !== f.clave2.value) { error.textContent = 'Las contraseñas no coinciden.'; return; }
    }
    boton.disabled = true;
    try {
      var res = await fetch(primera ? '/login/primera-cuenta' : '/login', {
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
})();
</script>
</body></html>`;
}

export function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
