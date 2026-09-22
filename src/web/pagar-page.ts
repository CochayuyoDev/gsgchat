/**
 * Pantalla "Pagar": la membresia de esta instalacion, vista por la tienda.
 *
 * Cuando esta instalacion depende de un maestro (quien controla las
 * tiendas), aqui se ve el plan de hoy, hasta cuando esta pagado, como se
 * paga (Yape/Plin + QR, lo que el dueño configuro en su pantalla Tiendas)
 * y el boton "Ya pague: mandar mi captura". La captura viaja al maestro;
 * alli un clic apunta el pago y la membresia corre sola. Si el dueño la
 * rechaza, el motivo se lee aqui.
 *
 * Sin maestro (membresia local o instancia libre) la pantalla lo dice y
 * manda a Membresia.
 *
 * El JS va en String.raw, con var y sin backticks, como el resto.
 */

import { appShell } from './shell.js';

const CSS = `

  * { box-sizing: border-box; }
  .wrap { color: var(--texto); font-family: var(--fuente); font-size: var(--fs-cuerpo); line-height: 1.5; max-width: 760px; }
  .wrap a { color: var(--primario); }
  .muted { color: var(--texto-suave); }
  .hidden { display: none !important; }
  .demo { background: var(--ambar-suave); color: var(--ambar); border: 1px solid var(--ambar); padding: 8px 14px; font-size: var(--fs-small); font-weight: 600; text-align: center; margin-bottom: var(--esp-4); border-radius: var(--radio-sm); }
  input, select, textarea, button { font: inherit; color: var(--texto); background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio-sm); padding: 8px 11px; max-width: 100%; }
  input, select, textarea { width: 100%; min-height: 38px; }
  input[type=checkbox], input[type=radio] { width: auto; min-height: 0; accent-color: var(--primario); }
  input[type=file] { padding: 7px 10px; font-size: 13.5px; }
  input:focus, select:focus, textarea:focus { border-color: var(--primario); outline: none; box-shadow: 0 0 0 3px var(--primario-suave); }
  textarea { min-height: 70px; resize: vertical; }
  button { cursor: pointer; width: auto; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 36px; padding: 7px 14px; font-weight: 600; line-height: 1.2; }
  button:hover { border-color: var(--primario); color: var(--primario); }
  button.primary { background: var(--primario); border-color: var(--primario); color: var(--primario-texto); }
  button.primary:hover { filter: brightness(1.06); color: var(--primario-texto); }
  button.sm { min-height: 30px; padding: 4px 10px; font-size: 13px; font-weight: 500; }
  button.peligro { color: var(--rojo); border-color: var(--rojo-suave); background: var(--rojo-suave); }
  button.peligro:hover { background: var(--rojo); border-color: var(--rojo); color: #fff; }
  button:disabled { opacity: .55; cursor: default; }
  a.sm { display: inline-flex; align-items: center; min-height: 30px; padding: 4px 10px; border: 1px solid var(--borde); border-radius: var(--radio-sm); font-size: 13px; font-weight: 500; text-decoration: none; color: var(--texto); background: var(--superficie); }
  a.sm:hover { border-color: var(--primario); color: var(--primario); }
  @media (max-width: 960px) { button, a.sm, button.sm { min-height: 44px; } }
  label { display: block; font-size: var(--fs-small); font-weight: 500; color: var(--texto-suave); margin: 10px 0 4px; }
  .explica { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); padding: var(--esp-3) var(--esp-4); margin-bottom: var(--esp-4); font-size: 14px; box-shadow: var(--sombra); }
  .explica p { margin: 0 0 6px; }
  .explica p:last-child { margin-bottom: 0; }
  .caja { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); overflow: hidden; margin-bottom: var(--esp-4); box-shadow: var(--sombra); min-width: 0; }
  .caja > h2 { font-size: 15px; font-weight: 700; margin: 0; padding: var(--esp-3) var(--esp-4); border-bottom: 1px solid var(--borde); display: flex; align-items: center; gap: var(--esp-2); flex-wrap: wrap; }
  .caja > h2 .sep { flex: 1; }
  .caja .cuerpo { padding: var(--esp-4); }
  .toast { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); background: var(--texto); color: var(--bg); padding: 10px 16px; border-radius: 10px; font-size: 14px; z-index: 50; max-width: 90vw; box-shadow: var(--sombra-2); }
  .chip.ok { background: var(--verde-suave); color: var(--verde); }
  .chip.warn { background: var(--ambar-suave); color: var(--ambar); }
  .chip.bad { background: var(--rojo-suave); color: var(--rojo); }
  .chip.info { background: var(--azul-suave); color: var(--azul); }
  .aviso-rojo, .aviso-amarillo, .aviso-verde { border-radius: var(--radio-sm); padding: 10px 12px; margin: 8px 0; font-size: 14px; border: 1px solid; }
  .aviso-rojo { background: var(--rojo-suave); border-color: var(--rojo); color: var(--rojo); }
  .aviso-amarillo { background: var(--ambar-suave); border-color: var(--ambar); color: var(--ambar); }
  .aviso-verde { background: var(--verde-suave); border-color: var(--verde); color: var(--verde); }
  .aviso-rojo a, .aviso-amarillo a, .aviso-verde a { color: inherit; font-weight: 600; }
  .tarjetas { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--esp-3); margin-bottom: var(--esp-4); }
  .tarjeta { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); padding: var(--esp-3) var(--esp-4); min-width: 0; box-shadow: var(--sombra); }
  .tarjeta .n { font-size: 22px; font-weight: 700; line-height: 1.1; }
  .tarjeta .q { font-size: var(--fs-small); color: var(--texto-suave); margin-top: 2px; }
  .tarjeta.ok .n { color: var(--verde); } .tarjeta.warn .n { color: var(--ambar); } .tarjeta.bad .n { color: var(--rojo); } .tarjeta.info .n { color: var(--azul); }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--borde); vertical-align: top; }
  th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--texto-suave); font-weight: 600; background: var(--superficie-2); }
  tr:last-child td { border-bottom: 0; }
  td .sub { color: var(--texto-suave); font-size: var(--fs-small); }
  .fila-datos { display: flex; gap: 10px; flex-wrap: wrap; }
  .fila-datos > div { flex: 1; min-width: 160px; }

  /* Una sola columna estrecha: es una pantalla para leer y mandar una captura, no un tablero. */
  .s-content > .wrap.pagar { max-width: 760px; margin: 0; }
  .plan { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: var(--esp-3); }
  .plan .n { font-size: 20px; font-weight: 700; line-height: 1.15; }
  .plan .q { font-size: var(--fs-small); color: var(--texto-suave); }
  .estado { border-radius: var(--radio-sm); padding: 10px 12px; font-size: 14px; margin-top: var(--esp-3); border: 1px solid transparent; }
  .estado.ok { background: var(--verde-suave); color: var(--verde); border-color: var(--verde); }
  .estado:not(.ok):not(.warn):not(.bad) { background: var(--superficie-2); color: var(--texto-suave); border-color: var(--borde); }
  .estado.warn { background: var(--ambar-suave); color: var(--ambar); border-color: var(--ambar); }
  .estado.bad { background: var(--rojo-suave); color: var(--rojo); border-color: var(--rojo); }
  .qr { max-width: 240px; border-radius: var(--radio-sm); border: 1px solid var(--borde); display: block; margin: var(--esp-2) 0; background: #fff; }
  .numero { font-size: 24px; font-weight: 700; letter-spacing: .02em; margin: 4px 0; }
  .fila { display: grid; grid-template-columns: 1fr 1fr 2fr; gap: 10px; }
  @media (max-width: 560px) { .fila { grid-template-columns: 1fr; } }
  .vista { max-width: 220px; border-radius: var(--radio-sm); border: 1px solid var(--borde); display: block; margin-top: var(--esp-2); }
  .como-ayuda { font-size: 13.5px; color: var(--texto-suave); margin: 6px 0 0; }
`;

export function pagarPage(opts: { demo: boolean; nombreNegocio: string }): string {
  const contenido = `
<div class="wrap pagar">
${opts.demo ? '<div class="demo">Demostración: nada sale a WhatsApp de verdad.</div>' : ''}
<div class="caja">
  <h2>Mi membresía</h2>
  <div class="cuerpo">
    <div id="plan" class="plan"><span class="muted">Cargando…</span></div>
    <div id="aviso-plan" class="estado hidden"></div>
  </div>
</div>

<div class="caja hidden" id="caja-como">
  <h2>Cómo pagar</h2>
  <div class="cuerpo">
    <div id="cobro-texto"></div>
    <div id="cobro-numero" class="numero"></div>
    <img id="cobro-qr" class="qr hidden" alt="QR para pagar">
  </div>
</div>

<div class="caja hidden" id="caja-captura">
  <h2>Ya pagué: mandar mi captura</h2>
  <div class="cuerpo">
    <div id="ultimo-pago" class="estado hidden"></div>
    <p class="como-ayuda">Sube la captura de tu Yape o Plin. Quien controla las tiendas la revisa y, en cuanto la apunta, tu membresía corre sola. Aquí verás si la aceptó.</p>
    <div class="fila">
      <div><label for="cp-meses">Meses pagados</label><input id="cp-meses" type="number" min="1" max="60" value="1"></div>
      <div><label for="cp-monto">Monto (opcional)</label><input id="cp-monto" type="number" min="0" step="0.01" placeholder="49"></div>
      <div style="flex:2"><label for="cp-nota">Nota (opcional)</label><input id="cp-nota" placeholder="Número de operación, a nombre de…"></div>
    </div>
    <label for="cp-imagen">Captura</label><input id="cp-imagen" type="file" accept="image/png,image/jpeg,image/webp">
    <img id="cp-vista" class="vista hidden" alt="tu captura">
    <div style="margin-top:12px"><button class="primary" id="cp-mandar" type="button">Mandar la captura</button></div>
  </div>
</div>

<div class="caja hidden" id="caja-soporte">
  <h2>Acceso de soporte</h2>
  <div class="cuerpo">
    <p class="como-ayuda">Si necesitas que quien controla las tiendas (el dueño del sistema) entre a este panel a ayudarte, dale acceso por un día. Entra como administrador, no ve tus contraseñas, y el acceso se quita solo al caducar (o cuando tú lo quites).</p>
    <div id="soporte-estado" class="estado hidden"></div>
    <div class="fila" style="margin-top:8px">
      <button class="primary" id="soporte-dar" type="button">Dar acceso por 24 horas</button>
      <button class="ghost hidden" id="soporte-quitar" type="button">Quitar el acceso</button>
    </div>
  </div>
</div>

<div class="explica hidden" id="sin-maestro"></div>
</div>
`;

  const script = String.raw`
async function api(path, options) {
  options = options || {};
  var res = await fetch(path, { method: options.method || 'GET', cache: 'no-store', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: options.body ? JSON.stringify(options.body) : undefined });
  var data = await res.json().catch(function () { return {}; });
  if (res.status === 401) { irAlLogin(); throw new Error('Tu sesión terminó: vuelve a entrar.'); }
  if (!res.ok) { var e = new Error(data.error || errorHttp(res.status)); e.status = res.status; throw e; }
  return data;
}
function esc(v) { return String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function toast(texto) { var el = document.createElement('div'); el.className = 'toast'; el.textContent = texto; document.body.appendChild(el); setTimeout(function () { el.remove(); }, 5000); }
function fecha(iso) { if (!iso) return ''; return new Date(iso).toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' }); }
function fechaHora(iso) { if (!iso) return ''; var d = new Date(iso); return fecha(iso) + ' ' + d.toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false }); }
function leerImagen(input) {
  return new Promise(function (resolver, rechazar) {
    var f = input.files && input.files[0];
    if (!f) return resolver(null);
    if (f.size > 2 * 1024 * 1024) return rechazar(new Error('La captura pesa más de 2 MB: recórtala o baja la calidad.'));
    var r = new FileReader();
    r.onload = function () { resolver(String(r.result)); };
    r.onerror = function () { rechazar(new Error('No se pudo leer la imagen.')); };
    r.readAsDataURL(f);
  });
}

function pintarPlan(d) {
  var caja = document.getElementById('plan');
  var aviso = document.getElementById('aviso-plan');
  if (!d.plan) {
    caja.innerHTML = '<span class="muted">' + (d.origen === 'libre' ? 'Esta instalación no tiene membresía: no hay nada que pagar.' : 'Todavía no se supo del plan.') + '</span>';
    aviso.classList.add('hidden');
    return;
  }
  var p = d.plan;
  caja.innerHTML =
    '<div><div class="n">' + esc(p.nombre) + '</div><div class="q">plan</div></div>' +
    '<div><div class="n">' + esc(fecha(p.vencimiento)) + '</div><div class="q">pagada hasta</div></div>' +
    '<div><div class="n">' + (p.vencido ? '0' : p.diasRestantes) + '</div><div class="q">días restantes</div></div>' +
    '<div><div class="n">' + esc(p.moneda) + ' ' + esc(p.precioMes) + '</div><div class="q">al mes</div></div>';
  if (p.vencido) { aviso.className = 'estado bad'; aviso.textContent = p.aviso || 'La membresía está vencida: el asistente IA y las campañas están en pausa. Los chats siguen funcionando.'; }
  else if (p.diasRestantes <= 7) { aviso.className = 'estado warn'; aviso.textContent = p.aviso || ('La membresía vence en ' + p.diasRestantes + ' día' + (p.diasRestantes === 1 ? '' : 's') + '.'); }
  else { aviso.className = 'estado ok'; aviso.textContent = 'Al día. ' + (p.contacto ? p.contacto : ''); }
  aviso.classList.remove('hidden');
}

function pintarCobro(d) {
  var caja = document.getElementById('caja-como');
  var c = d.cobro;
  if (!c) { caja.classList.add('hidden'); return; }
  caja.classList.remove('hidden');
  document.getElementById('cobro-texto').textContent = c.texto || '';
  document.getElementById('cobro-numero').textContent = c.numero || '';
  var qr = document.getElementById('cobro-qr');
  qr.classList.toggle('hidden', !c.qr);
  if (c.qr) qr.src = c.qr;
}

function pintarUltimoPago(d) {
  var caja = document.getElementById('ultimo-pago');
  var u = d.ultimoPago;
  if (!u) { caja.classList.add('hidden'); return; }
  caja.classList.remove('hidden');
  if (u.estado === 'pendiente') { caja.className = 'estado warn'; caja.textContent = 'Tu captura del ' + fechaHora(u.at) + ' (' + u.meses + ' mes' + (u.meses === 1 ? '' : 'es') + ') está esperando revisión. En cuanto la apunten, la membresía corre sola.'; }
  else if (u.estado === 'aceptado') { caja.className = 'estado ok'; caja.textContent = 'Tu captura del ' + fechaHora(u.at) + ' fue aceptada' + (u.resueltoAt ? ' el ' + fechaHora(u.resueltoAt) : '') + ': ' + u.meses + ' mes' + (u.meses === 1 ? '' : 'es') + ' apuntado' + (u.meses === 1 ? '' : 's') + '.'; }
  else { caja.className = 'estado bad'; caja.textContent = 'Tu captura del ' + fechaHora(u.at) + ' fue rechazada' + (u.motivo ? ': ' + u.motivo : '') + '. Puedes mandar otra.'; }
}

async function cargarSoporte(d) {
  var caja = document.getElementById('caja-soporte');
  if (!d || d.origen !== 'maestro') { caja.classList.add('hidden'); return; }
  caja.classList.remove('hidden');
  try {
    var r = await api('/admin/membresia/soporte');
    var est = document.getElementById('soporte-estado');
    var dar = document.getElementById('soporte-dar');
    var quitar = document.getElementById('soporte-quitar');
    if (r.soporte) {
      est.className = 'estado ok';
      est.textContent = 'Acceso hasta las ' + fechaHora(r.soporte.hasta) + ' · el dueño del sistema ya puede entrar a este panel desde su pantalla Tiendas.';
      est.classList.remove('hidden'); dar.classList.add('hidden'); quitar.classList.remove('hidden');
    } else {
      est.className = 'estado';
      est.textContent = 'Nadie tiene acceso ahora mismo.';
      est.classList.remove('hidden'); dar.classList.remove('hidden'); quitar.classList.add('hidden');
    }
  } catch (e) { /* sin membresia: la caja ya esta escondida */ }
}
document.getElementById('soporte-dar').onclick = async function () {
  try { var r = await api('/admin/membresia/soporte', { method: 'POST', body: { horas: 24 } }); toast(r.mensaje); cargarSoporte({ origen: 'maestro' }); } catch (e) { toast(e.message); }
};
document.getElementById('soporte-quitar').onclick = async function () {
  try { var r = await api('/admin/membresia/soporte', { method: 'DELETE' }); toast(r.mensaje); cargarSoporte({ origen: 'maestro' }); } catch (e) { toast(e.message); }
};

async function cargar() {
  var d;
  try { d = await api('/admin/membresia/pagar'); }
  catch (e) {
    if (e.status === 409) { document.getElementById('sin-maestro').textContent = 'Este arranque no lleva membresía.'; document.getElementById('sin-maestro').classList.remove('hidden'); document.getElementById('plan').innerHTML = ''; return; }
    throw e;
  }
  pintarPlan(d);
  pintarCobro(d);
  pintarUltimoPago(d);
  cargarSoporte(d);
  var puede = d.puedeMandarCaptura;
  document.getElementById('caja-captura').classList.toggle('hidden', !puede);
  var sm = document.getElementById('sin-maestro');
  if (!puede && d.motivo && d.plan) {
    sm.innerHTML = esc(d.motivo) + (d.origen === 'local' ? ' <a href="/panel#membresia">Ir a Membresía</a>' : '');
    sm.classList.remove('hidden');
  } else sm.classList.add('hidden');
  if (d.plan && d.plan.precioMes && !document.getElementById('cp-monto').value) document.getElementById('cp-monto').placeholder = String(d.plan.precioMes);
}

document.getElementById('cp-imagen').onchange = async function () {
  try { var img = await leerImagen(document.getElementById('cp-imagen')); var v = document.getElementById('cp-vista'); v.classList.toggle('hidden', !img); if (img) v.src = img; } catch (e) { toast(e.message); document.getElementById('cp-imagen').value = ''; }
};
document.getElementById('cp-mandar').onclick = async function () {
  var b = document.getElementById('cp-mandar'); b.disabled = true;
  try {
    var img = await leerImagen(document.getElementById('cp-imagen'));
    if (!img) throw new Error('Elige la captura de tu pago.');
    var meses = Number(document.getElementById('cp-meses').value || 1);
    var monto = document.getElementById('cp-monto').value;
    var r = await api('/admin/membresia/pago-captura', { method: 'POST', body: { imagen: img, meses: meses, monto: monto === '' ? undefined : Number(monto), nota: document.getElementById('cp-nota').value } });
    toast(r.mensaje);
    document.getElementById('cp-imagen').value = ''; document.getElementById('cp-vista').classList.add('hidden');
    await cargar();
  } catch (e) { toast(e.message); }
  b.disabled = false;
};

cargar().catch(function (e) { toast(e.message); });
`;

  return appShell({
    titulo: 'Pagar',
    subtitulo: 'Tu membresía: hasta cuándo está pagada y cómo renovarla',
    contenido,
    script,
    css: CSS,
    nombreNegocio: opts.nombreNegocio,
    demo: opts.demo,
    icono: '💳',
  });
}
