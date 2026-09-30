/**
 * Lo que comparten las dos pantallas del reparto: /rutas y /mapa.
 *
 * Las dos hablan con la misma API, sacan el mismo aviso flotante cuando algo
 * falla y cuentan las horas igual. Antes cada una llevaba su copia de `api`,
 * `esc`, `toast` y del formateo de horas: dos sitios donde arreglar el mismo
 * fallo, y dos maneras de escribir la misma hora. Aqui hay una sola copia.
 *
 * Solo lo usan esas dos pantallas: no es el sistema de diseno (eso vive en
 * `tokens.ts` y en el CSS del armazon), es el pegamento del modulo.
 *
 * El JS va en String.raw y con var, como el resto de paginas.
 */

/** Lo poco de CSS que las dos pantallas necesitan igual. El resto lo da el armazon. */
export const REPARTO_CSS = `
  .muted { color: var(--texto-suave); }
  /* El aviso flotante: lo unico que interrumpe, y se va solo. */
  .toast {
    position: fixed; left: 50%; transform: translateX(-50%); bottom: 24px; z-index: 60;
    background: var(--texto); color: var(--bg); padding: 10px 16px; border-radius: var(--radio-sm);
    font-size: var(--fs-cuerpo); max-width: 90vw; box-shadow: var(--sombra-2);
  }
`;

/**
 * Las funciones que usan las dos pantallas, para pegar dentro del `String.raw`
 * de cada una. `irAlLogin` y `errorHttp` las pone el armazon.
 */
export const REPARTO_JS = String.raw`
/* Se entra con la cookie de sesion (/login): si el servidor dice 401, alla. */
async function api(path, opciones) {
  opciones = opciones || {};
  var res = await fetch(path, {
    method: opciones.method || 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: opciones.body ? JSON.stringify(opciones.body) : undefined
  });
  var data = await res.json().catch(function () { return {}; });
  if (res.status === 401) { irAlLogin(); throw new Error('Tu sesión terminó: vuelve a entrar.'); }
  if (!res.ok) throw new Error(data.error || errorHttp(res.status));
  return data;
}

function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ver(id, visible) {
  var el = document.getElementById(id);
  if (el) el.classList.toggle('hidden', !visible);
}

function toast(texto) {
  var el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = texto;
  document.body.appendChild(el);
  setTimeout(function () { el.remove(); }, 4500);
}

/* La hora en reloj de 24, que es como se lee de un vistazo estando de pie. */
function hora(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/* Si es de hoy basta la hora; de otro dia, el dia delante. */
function cuando(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return hora(iso);
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit' }) + ' ' + hora(iso);
}

function haceCuanto(iso) {
  if (!iso) return '';
  var min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return 'hace ' + min + ' min';
  var h = Math.floor(min / 60);
  return 'hace ' + h + ' h' + (min % 60 ? ' ' + (min % 60) + ' min' : '');
}
`;
