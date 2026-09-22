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
 * Sin maestro (membresia local o instancia libre) la pantalla lo dice una
 * sola vez y manda a Membresia.
 *
 * Es la otra cara de /tiendas: el estado de la membresia se dice con las
 * mismas palabras y los mismos colores que ve el dueño (al dia, vence en N
 * dias, vencida, suspendida), para que los dos hablen de lo mismo.
 *
 * El JS va en String.raw, con var y sin backticks, como el resto.
 */

import { appShell } from './shell.js';

/* Solo lo propio de esta pantalla: los botones, los chips y las tarjetas ya
   vienen de las clases compartidas del armazon (.btn, .chip.tono-*, .tarjeta). */
const CSS = `
  * { box-sizing: border-box; }
  .wrap { color: var(--texto); font-family: var(--fuente); font-size: var(--fs-cuerpo); line-height: 1.5; max-width: 760px; }
  .wrap a { color: var(--primario); }
  .muted { color: var(--texto-suave); }

  input { font: inherit; color: var(--texto); background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio-sm); padding: 8px 11px; width: 100%; max-width: 100%; min-height: 38px; }
  input[type=file] { padding: 7px 10px; font-size: 13.5px; }
  input:focus { border-color: var(--primario); outline: none; box-shadow: 0 0 0 3px var(--primario-suave); }
  label { display: block; font-size: var(--fs-small); font-weight: 500; color: var(--texto-suave); margin: 10px 0 4px; }

  .caja { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); overflow: hidden; margin-bottom: var(--esp-4); box-shadow: var(--sombra); min-width: 0; }
  .caja > h2 { font-size: var(--fs-h2); font-weight: 700; margin: 0; padding: var(--esp-3) var(--esp-4); border-bottom: 1px solid var(--borde); }
  .caja .cuerpo { padding: var(--esp-4); }
  .toast { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); background: var(--texto); color: var(--bg); padding: 10px 16px; border-radius: var(--radio-sm); font-size: 14px; z-index: 50; max-width: 90vw; box-shadow: var(--sombra-2); }
  .acciones { display: flex; gap: var(--esp-2); flex-wrap: wrap; align-items: center; margin-top: var(--esp-3); }
  .ayuda { font-size: 13.5px; color: var(--texto-suave); margin: 0 0 var(--esp-2); }

  /* El estado de la membresia: una sola banda, imposible de confundir. */
  .banda { border-radius: var(--radio-sm); padding: 10px 12px; font-size: 14px; border: 1px solid var(--borde); background: var(--superficie-2); color: var(--texto-suave); }
  .banda b { display: block; font-size: var(--fs-h2); line-height: 1.25; }
  .banda.tono-verde { background: var(--verde-suave); border-color: var(--verde); color: var(--verde); }
  .banda.tono-ambar { background: var(--ambar-suave); border-color: var(--ambar); color: var(--ambar); }
  .banda.tono-rojo { background: var(--rojo-suave); border-color: var(--rojo); color: var(--rojo); }
  .banda.tono-gris { background: var(--gris-suave); border-color: var(--gris-claro); color: var(--gris); }
  .banda + .banda, .banda + .plan, .plan + .banda { margin-top: var(--esp-3); }

  .plan { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--esp-3); }
  .plan .n { font-size: 20px; font-weight: 700; line-height: 1.15; word-break: break-word; }
  .plan .q { font-size: var(--fs-small); color: var(--texto-suave); }

  .qr { max-width: 240px; border-radius: var(--radio-sm); border: 1px solid var(--borde); display: block; margin: var(--esp-2) 0; background: #fff; }
  .numero { font-size: 24px; font-weight: 700; letter-spacing: .02em; margin: 4px 0; }
  .vista { max-width: 220px; border-radius: var(--radio-sm); border: 1px solid var(--borde); display: block; margin-top: var(--esp-2); }
  .campos { display: grid; grid-template-columns: 1fr 1fr 2fr; gap: 10px; }
  @media (max-width: 560px) { .campos { grid-template-columns: 1fr; } }
`;

export function pagarPage(opts: { demo: boolean; nombreNegocio: string }): string {
  const contenido = `
<div class="wrap">
<div class="caja">
  <h2>Mi membresía</h2>
  <div class="cuerpo">
    <div id="estado-plan" class="banda"><b>Cargando…</b></div>
    <div id="plan" class="plan hidden"></div>
    <div id="donde-pagar" class="banda hidden"></div>
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
    <div id="ultimo-pago" class="banda hidden"></div>
    <p class="ayuda" style="margin-top:var(--esp-3)">Sube la captura de tu Yape o Plin. Quien controla las tiendas la revisa y, en cuanto la apunta, tu membresía corre sola. Aquí verás si la aceptó.</p>
    <div class="campos">
      <div><label for="cp-meses">Meses pagados</label><input id="cp-meses" type="number" min="1" max="60" value="1"></div>
      <div><label for="cp-monto">Monto (opcional)</label><input id="cp-monto" type="number" min="0" step="0.01" placeholder="49"></div>
      <div><label for="cp-nota">Nota (opcional)</label><input id="cp-nota" placeholder="Número de operación, a nombre de…"></div>
    </div>
    <label for="cp-imagen">Captura</label><input id="cp-imagen" type="file" accept="image/png,image/jpeg,image/webp">
    <img id="cp-vista" class="vista hidden" alt="tu captura">
    <div class="acciones"><button class="btn primario" id="cp-mandar" type="button">Mandar la captura</button></div>
  </div>
</div>

<div class="caja hidden" id="caja-soporte">
  <h2>Acceso de soporte</h2>
  <div class="cuerpo">
    <p class="ayuda">Si necesitas que quien controla las tiendas entre a este panel a ayudarte, dale acceso por un día. Entra como administrador, no ve tus contraseñas, y el acceso se quita solo al caducar (o cuando tú lo quites).</p>
    <div id="soporte-estado" class="banda hidden"></div>
    <div class="acciones">
      <button class="btn primario" id="soporte-dar" type="button">Dar acceso por 24 horas</button>
      <button class="btn peligro hidden" id="soporte-quitar" type="button">Quitar el acceso</button>
    </div>
  </div>
</div>
</div>
`;

  /* La marca de abajo separa el JS de esta pantalla del que trae el armazon:
     asi la prueba puede correr solo este trozo con un DOM de mentira. */
  const script = String.raw`
/* === pantalla Pagar === */
async function api(path, options) {
  options = options || {};
  var res = await fetch(path, { method: options.method || 'GET', cache: 'no-store', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: options.body ? JSON.stringify(options.body) : undefined });
  var data = await res.json().catch(function () { return {}; });
  if (res.status === 401) { irAlLogin(); throw new Error('Tu sesión terminó: vuelve a entrar.'); }
  if (!res.ok) { var e = new Error(data.error || errorHttp(res.status)); e.status = res.status; throw e; }
  return data;
}
function esc(v) { return String(v === null || v === undefined ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function toast(texto) { var nodo = document.createElement('div'); nodo.className = 'toast'; nodo.setAttribute('role', 'status'); nodo.textContent = texto; document.body.appendChild(nodo); setTimeout(function () { nodo.remove(); }, 5000); }
function el(id) { return document.getElementById(id); }
function mostrar(id, visible) { el(id).classList.toggle('hidden', !visible); }
function fecha(iso) { if (!iso) return ''; return new Date(iso).toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric' }); }
function hora(iso) { if (!iso) return ''; return new Date(iso).toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false }); }
function fechaHora(iso) { return iso ? fecha(iso) + ' ' + hora(iso) : ''; }
function dinero(moneda, monto) {
  var n = Number(monto);
  if (!isFinite(n)) return '';
  return ((moneda || '') + ' ' + n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })).trim();
}
function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }
/* Una sola banda de estado para toda la pantalla: tono + titular + explicación. */
function banda(id, tono, titular, explicacion) {
  var caja = el(id);
  caja.className = 'banda' + (tono ? ' tono-' + tono : '');
  caja.innerHTML = '<b>' + esc(titular) + '</b>' + (explicacion ? esc(explicacion) : '');
  caja.classList.remove('hidden');
}

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

/**
 * El estado de la membresía, con las mismas palabras que ve el dueño en su
 * pantalla Tiendas.
 *
 * El servidor marca «vencido» también cuando la membresía está suspendida;
 * si aún quedan días por delante es que la suspendieron, no que se venció, y
 * decir "vencida" haría pagar de nuevo a quien ya pagó.
 */
function estadoPlan(p) {
  if (p.vencido && p.diasRestantes > 0) return { tono: 'gris', texto: 'Suspendida', explica: p.aviso || 'La membresía está suspendida: el asistente IA y las campañas están en pausa. Los chats siguen funcionando. Habla con quien controla las tiendas.' };
  if (p.vencido) return { tono: 'rojo', texto: 'Vencida', explica: p.aviso || 'La membresía está vencida: el asistente IA y las campañas están en pausa. Los chats siguen funcionando.' };
  if (p.diasRestantes <= 7) return { tono: 'ambar', texto: p.diasRestantes === 1 ? 'Vence mañana' : 'Vence en ' + plural(p.diasRestantes, 'día', 'días'), explica: p.aviso || 'Paga antes de esa fecha y el asistente IA y las campañas no se paran.' };
  return { tono: 'verde', texto: 'Al día', explica: p.contacto || 'No hay nada que hacer: tu membresía está pagada.' };
}

function pintarPlan(d) {
  var p = d.plan;
  if (!p) {
    /* Sin plan solo hay una cosa que decir, y se dice una vez. */
    banda('estado-plan', '', 'Sin membresía', d.motivo || 'Todavía no se supo del plan de esta instalación.');
    mostrar('plan', false);
    return;
  }
  var e = estadoPlan(p);
  banda('estado-plan', e.tono, e.texto, e.explica);
  /* Los días que faltan ya los dice la banda: aquí van los datos que no repite. */
  el('plan').innerHTML =
    '<div><div class="n">' + esc(p.nombre) + '</div><div class="q">plan</div></div>' +
    '<div><div class="n">' + esc(fecha(p.vencimiento)) + '</div><div class="q">pagada hasta</div></div>' +
    '<div><div class="n">' + esc(dinero(p.moneda, p.precioMes)) + '</div><div class="q">al mes</div></div>';
  mostrar('plan', true);
}

function pintarCobro(d) {
  var c = d.cobro;
  mostrar('caja-como', Boolean(c));
  if (!c) return;
  el('cobro-texto').textContent = c.texto || '';
  el('cobro-numero').textContent = c.numero || '';
  mostrar('cobro-qr', Boolean(c.qr));
  if (c.qr) el('cobro-qr').src = c.qr;
}

function pintarUltimoPago(d) {
  var u = d.ultimoPago;
  if (!u) { mostrar('ultimo-pago', false); return; }
  var cuando = 'Captura del ' + fechaHora(u.at) + ' · ' + plural(u.meses, 'mes', 'meses') + (u.monto ? ' · ' + dinero(u.moneda, u.monto) : '');
  if (u.estado === 'pendiente') banda('ultimo-pago', 'ambar', 'Esperando revisión', cuando + '. En cuanto la apunten, tu membresía corre sola.');
  else if (u.estado === 'aceptado') banda('ultimo-pago', 'verde', 'Captura aceptada', cuando + (u.resueltoAt ? ' · aceptada el ' + fechaHora(u.resueltoAt) : '') + '.');
  else banda('ultimo-pago', 'rojo', 'Captura rechazada', cuando + '. ' + (u.motivo ? 'Motivo: ' + u.motivo + '. ' : '') + 'Puedes mandar otra.');
}

async function pintarSoporte() {
  var r;
  try { r = await api('/admin/membresia/soporte'); }
  catch (e) {
    /* Si no se puede leer, la caja no se enseña a medias: un botón que no
       hace nada es peor que no verlo. */
    mostrar('caja-soporte', false);
    return;
  }
  mostrar('caja-soporte', true);
  if (r.soporte) {
    banda('soporte-estado', 'verde', 'Acceso concedido hasta las ' + hora(r.soporte.hasta), 'Quien controla las tiendas ya puede entrar a este panel desde su pantalla Tiendas.');
    mostrar('soporte-dar', false);
    mostrar('soporte-quitar', true);
  } else {
    banda('soporte-estado', '', 'Nadie tiene acceso ahora mismo', '');
    mostrar('soporte-dar', true);
    mostrar('soporte-quitar', false);
  }
}

async function cargar(opciones) {
  var silencioso = opciones && opciones.silencioso;
  var d;
  try { d = await api('/admin/membresia/pagar'); }
  catch (e) {
    if (e.status === 409) {
      banda('estado-plan', '', 'Sin membresía', 'Este arranque no lleva membresía: no hay nada que pagar.');
      mostrar('plan', false);
      mostrar('caja-como', false); mostrar('caja-captura', false); mostrar('caja-soporte', false);
      return;
    }
    /* El fallo se ve donde iba el plan, no solo en un aviso que se va solo. */
    banda('estado-plan', 'rojo', 'No se pudo cargar', e.message);
    mostrar('plan', false);
    if (!silencioso) toast(e.message);
    return;
  }
  pintarPlan(d);
  pintarCobro(d);
  pintarUltimoPago(d);
  /* Con plan pero sin poder mandar la captura (membresía propia): hay que
     decir dónde se paga. Sin plan, eso ya lo dijo la banda de arriba. */
  if (d.plan && !d.puedeMandarCaptura && d.motivo) {
    banda('donde-pagar', '', 'Dónde se paga', d.motivo);
    if (d.origen === 'local') el('donde-pagar').innerHTML += ' <a href="/panel#membresia">Ir a Membresía</a>';
  } else mostrar('donde-pagar', false);
  mostrar('caja-captura', Boolean(d.puedeMandarCaptura));
  /* La caja de captura es para las tiendas con maestro; el soporte también. */
  if (d.origen === 'maestro') await pintarSoporte(); else mostrar('caja-soporte', false);
  if (d.plan && d.plan.precioMes) el('cp-monto').placeholder = String(d.plan.precioMes);
}

el('soporte-dar').onclick = async function () {
  var b = el('soporte-dar');
  b.disabled = true;
  try { var r = await api('/admin/membresia/soporte', { method: 'POST', body: { horas: 24 } }); toast(r.mensaje); await pintarSoporte(); }
  catch (e) { toast(e.message); } finally { b.disabled = false; }
};
el('soporte-quitar').onclick = async function () {
  var b = el('soporte-quitar');
  if (!(await confirmarDialogo({ titulo: 'Quitar el acceso', texto: 'Quien controla las tiendas dejará de poder entrar a este panel. Puedes volver a dárselo cuando quieras.', boton: 'Quitar', peligro: true }))) return;
  b.disabled = true;
  try { var r = await api('/admin/membresia/soporte', { method: 'DELETE' }); toast(r.mensaje); await pintarSoporte(); }
  catch (e) { toast(e.message); } finally { b.disabled = false; }
};

el('cp-imagen').onchange = async function () {
  try {
    var img = await leerImagen(el('cp-imagen'));
    mostrar('cp-vista', Boolean(img));
    if (img) el('cp-vista').src = img;
  } catch (e) { toast(e.message); el('cp-imagen').value = ''; mostrar('cp-vista', false); }
};
el('cp-mandar').onclick = async function () {
  var b = el('cp-mandar');
  b.disabled = true;
  try {
    var img = await leerImagen(el('cp-imagen'));
    if (!img) throw new Error('Elige la captura de tu pago.');
    var meses = Number(el('cp-meses').value || 1);
    if (!(meses >= 1 && meses <= 60)) throw new Error('Los meses pagados tienen que ir de 1 a 60.');
    var monto = el('cp-monto').value;
    var r = await api('/admin/membresia/pago-captura', { method: 'POST', body: { imagen: img, meses: meses, monto: monto === '' ? undefined : Number(monto), nota: el('cp-nota').value } });
    toast(r.mensaje);
    el('cp-imagen').value = ''; el('cp-nota').value = '';
    mostrar('cp-vista', false);
    await cargar();
  } catch (e) { toast(e.message); } finally { b.disabled = false; }
};

cargar();
/* La tienda deja esta pantalla abierta esperando el visto bueno: el servidor
   vuelve a preguntarle al maestro en cada carga, así que basta con repetirla. */
setInterval(function () { if (!document.querySelector('.dlg-fondo')) cargar({ silencioso: true }); }, 60000);
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
