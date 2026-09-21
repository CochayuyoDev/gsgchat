/**
 * El panel maestro: tus instancias, de un vistazo.
 *
 *   npm run saas:maestro          ->  http://localhost:3900  (o maestro.<dominio>)
 *
 * Es para ti, no para los clientes: lista las tiendas, dice cuales
 * responden y cuales tienen WhatsApp conectado, y da de alta o de baja
 * desde la pantalla. Corre en el host (necesita Docker a mano), detras de
 * usuario y contrasena (MAESTRO_USUARIO / MAESTRO_CLAVE en saas/.env).
 *
 * Tambien lleva los planes: que plan tiene cada tienda, hasta cuando esta
 * pagado y los pagos apuntados (ver saas/planes.ts). Las instancias le
 * preguntan por su plan en GET /api/plan/:slug con su token, sin usuario.
 */

import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { altaInstancia, bajaInstancia, dirInstancia, estadoInstancias, iniciarPlan, leerConfigSaas, listarInstancias, prepararBase, slugValido, type EstadoInstancia } from '../instancias.js';
import { cambiarPlan, estadoPlan, guardarPlan, ingresosMensuales, leerPlan, MONEDA_PLANES, PLANES, registrarPago, type NombrePlan } from '../planes.js';

const cfg = leerConfigSaas();
if (!cfg.maestroClave) {
  console.error('Pon MAESTRO_CLAVE en saas/.env: el panel maestro no arranca sin contrasena.');
  process.exit(1);
}

const app = Fastify({ logger: false });

const igual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

app.addHook('onRequest', async (request, reply) => {
  // Las instancias preguntan por su plan con su propio token, no con el usuario.
  if (request.url.startsWith('/api/plan/')) return;
  const h = request.headers.authorization ?? '';
  if (h.startsWith('Basic ')) {
    const [u, ...c] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
    if (u !== undefined && igual(u, cfg.maestroUsuario) && igual(c.join(':'), cfg.maestroClave)) return;
  }
  return reply.code(401).header('www-authenticate', 'Basic realm="GSGchat maestro"').send('Entra con el usuario y la contrasena del maestro.');
});

/** Un alta o una baja a la vez: dos `docker compose` a la vez se pisan. */
let ocupado: string | null = null;
const registro: string[] = [];
const log = (l: string) => {
  registro.push(`${new Date().toISOString().slice(11, 19)} ${l}`);
  if (registro.length > 200) registro.shift();
};

app.get('/api/instancias', async () => {
  const instancias = await estadoInstancias();
  const planes = listarInstancias().map((i) => leerPlan(dirInstancia(i.slug))).filter((p): p is NonNullable<typeof p> => Boolean(p));
  return { instancias, ocupado, registro: registro.slice(-30), planes: PLANES, moneda: MONEDA_PLANES, ingresosMes: ingresosMensuales(planes) };
});

/** Lo que pregunta cada instancia: su plan de hoy. Con su token (PLAN_TOKEN en su .env). */
app.get<{ Params: { slug: string } }>('/api/plan/:slug', async (request, reply) => {
  const mal = slugValido(request.params.slug);
  if (mal) return reply.code(400).send({ error: mal });
  const p = leerPlan(dirInstancia(request.params.slug));
  if (!p) return reply.code(404).send({ error: 'Esa tienda no tiene plan.' });
  const h = request.headers.authorization ?? '';
  if (!h.startsWith('Bearer ') || !igual(h.slice(7), p.token)) return reply.code(401).send({ error: 'Token del plan incorrecto.' });
  return estadoPlan(p);
});

/** Apuntar un pago: cambia al plan pagado y corre el vencimiento. */
app.post<{ Params: { slug: string } }>('/api/instancias/:slug/pagos', async (request, reply) => {
  const mal = slugValido(request.params.slug);
  if (mal) return reply.code(400).send({ error: mal });
  const body = z.object({ plan: z.enum(['basico', 'pro']), meses: z.coerce.number().int().min(1).max(24).default(1), monto: z.coerce.number().min(0).optional(), nota: z.string().max(200).default('') }).parse(request.body ?? {});
  const dir = dirInstancia(request.params.slug);
  const p = leerPlan(dir);
  if (!p) return reply.code(404).send({ error: 'Esa tienda no tiene plan.' });
  try {
    const nuevo = registrarPago(p, body);
    guardarPlan(dir, nuevo);
    log(`${request.params.slug}: pago de ${body.meses} mes(es) de ${PLANES[body.plan].nombre}; vence ${nuevo.vencimiento.slice(0, 10)}`);
    return { ok: true, plan: estadoPlan(nuevo), pagos: nuevo.pagos };
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
  }
});

/** El plan de una tienda a mano: otro plan, otra fecha, un contacto para renovar. */
app.patch<{ Params: { slug: string } }>('/api/instancias/:slug/plan', async (request, reply) => {
  const mal = slugValido(request.params.slug);
  if (mal) return reply.code(400).send({ error: mal });
  const body = z.object({ plan: z.enum(['prueba', 'basico', 'pro']).optional(), vencimiento: z.string().optional(), contacto: z.string().max(200).optional() }).parse(request.body ?? {});
  const dir = dirInstancia(request.params.slug);
  const p = leerPlan(dir);
  if (!p) return reply.code(404).send({ error: 'Esa tienda no tiene plan.' });
  try {
    const nuevo = cambiarPlan(p, body as { plan?: NombrePlan; vencimiento?: string; contacto?: string });
    guardarPlan(dir, nuevo);
    log(`${request.params.slug}: plan ${nuevo.plan}, vence ${nuevo.vencimiento.slice(0, 10)}`);
    return { ok: true, plan: estadoPlan(nuevo), pagos: nuevo.pagos };
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
  }
});

/** Una tienda anterior a los planes: darle la prueba y que su contenedor lo sepa. */
app.post<{ Params: { slug: string } }>('/api/instancias/:slug/plan/iniciar', async (request, reply) => {
  const mal = slugValido(request.params.slug);
  if (mal) return reply.code(400).send({ error: mal });
  if (ocupado) return reply.code(409).send({ error: `Espera: ${ocupado}` });
  ocupado = `plan de ${request.params.slug}`;
  try {
    const p = await iniciarPlan(request.params.slug, { cfg, log });
    return { ok: true, plan: estadoPlan(p) };
  } catch (error) {
    return reply.code(500).send({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    ocupado = null;
  }
});

/** Los pagos apuntados a una tienda. */
app.get<{ Params: { slug: string } }>('/api/instancias/:slug/pagos', async (request, reply) => {
  const p = leerPlan(dirInstancia(request.params.slug));
  if (!p) return reply.code(404).send({ error: 'Esa tienda no tiene plan.' });
  return { plan: estadoPlan(p), pagos: p.pagos, contacto: p.contacto ?? '' };
});

app.post('/api/instancias', async (request, reply) => {
  const body = z
    .object({
      slug: z.string().trim().toLowerCase(),
      nombre: z.string().trim().max(80).optional(),
      proveedor: z.enum(['local', 'cloud', 'waha']).default('local'),
    })
    .parse(request.body ?? {});
  const mal = slugValido(body.slug);
  if (mal) return reply.code(400).send({ error: mal });
  if (ocupado) return reply.code(409).send({ error: `Espera: ${ocupado}` });
  ocupado = `alta de ${body.slug}`;
  try {
    await prepararBase({ cfg, log });
    const i = await altaInstancia(body.slug, { nombre: body.nombre || undefined, proveedor: body.proveedor }, { cfg, log });
    log(`${body.slug}: lista en ${i.url}`);
    return { ok: true, instancia: i };
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    log(`${body.slug}: fallo el alta: ${detalle}`);
    return reply.code(500).send({ error: detalle });
  } finally {
    ocupado = null;
  }
});

app.delete<{ Params: { slug: string } }>('/api/instancias/:slug', async (request, reply) => {
  const q = z.object({ borrarDatos: z.coerce.boolean().default(false) }).parse(request.query ?? {});
  const mal = slugValido(request.params.slug);
  if (mal) return reply.code(400).send({ error: mal });
  if (ocupado) return reply.code(409).send({ error: `Espera: ${ocupado}` });
  ocupado = `baja de ${request.params.slug}`;
  try {
    await bajaInstancia(request.params.slug, { borrarDatos: q.borrarDatos }, { cfg, log });
    log(`${request.params.slug}: baja${q.borrarDatos ? ' con borrado de datos' : ''}`);
    return { ok: true };
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    log(`${request.params.slug}: fallo la baja: ${detalle}`);
    return reply.code(500).send({ error: detalle });
  } finally {
    ocupado = null;
  }
});

app.get('/', async (_request, reply) => reply.type('text/html; charset=utf-8').send(pagina()));

function pagina(): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Maestro · GSGchat</title>
<style>
  :root { color-scheme: light dark; --bg:#f4f5f7; --card:#fff; --line:#e3e5e9; --text:#111b21; --muted:#667781; --accent:#128c7e; --ok:#1a7f37; --bad:#b42318; --warn:#b45309; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f1317; --card:#171c22; --line:#2a313a; --text:#e6e9ee; --muted:#98a2b0; --accent:#2fbfa9; --ok:#4cc36d; --bad:#f0665a; --warn:#f5b04c; } }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  main { max-width:1000px; margin:0 auto; padding:24px 16px 60px; }
  h1 { font-size:22px; margin:0 0 4px; } .muted { color:var(--muted); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 18px; margin:14px 0; }
  table { width:100%; border-collapse:collapse; } th,td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--muted); font-weight:600; font-size:12px; text-transform:uppercase; }
  .pill { display:inline-block; padding:2px 9px; border-radius:999px; font-size:12px; font-weight:600; }
  .ok { background:rgba(26,127,55,.12); color:var(--ok); } .bad { background:rgba(180,35,24,.12); color:var(--bad); } .warn { background:rgba(180,83,9,.12); color:var(--warn); }
  input, select { padding:8px 10px; border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--text); font:inherit; }
  button { border:0; border-radius:8px; padding:8px 14px; background:var(--accent); color:#fff; font:inherit; font-weight:600; cursor:pointer; }
  button.ghost { background:transparent; color:var(--accent); border:1px solid var(--accent); } button.danger { background:var(--bad); } button:disabled { opacity:.5; cursor:default; }
  .fila { display:flex; gap:10px; flex-wrap:wrap; align-items:end; } .fila label { display:flex; flex-direction:column; gap:4px; font-size:12px; color:var(--muted); }
  pre { background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:10px; font:12px/1.4 ui-monospace,Consolas,monospace; max-height:220px; overflow:auto; white-space:pre-wrap; }
  a { color:var(--accent); }
</style></head><body><main>
<h1>Maestro</h1>
<p class="muted">Una instancia por tienda: su contenedor, su base, su WhatsApp, su plan. Dominio base: <b>${cfg.dominioBase}</b>. <span id="ingresos"></span></p>
<div class="card">
  <div id="tabla"></div>
</div>
<div class="card">
  <h3 style="margin-top:0">Nueva tienda</h3>
  <div class="fila">
    <label>Nombre corto (subdominio) <input id="slug" placeholder="tienda1"></label>
    <label>Nombre del negocio <input id="nombre" placeholder="Zapateria Lima"></label>
    <label>WhatsApp <select id="proveedor"><option value="local">QR (cliente local)</option><option value="cloud">API oficial de Meta</option><option value="waha">WAHA</option></select></label>
    <button id="alta">Dar de alta</button>
  </div>
  <p id="msg" class="muted"></p>
  <pre id="registro"></pre>
</div>
<div class="card" id="pago" style="display:none" data-slug="">
  <h3 style="margin-top:0">Apuntar un pago</h3>
  <p class="muted">El cobro lo haces tu (Yape, transferencia, factura); aqui solo se apunta y se corre la fecha. Planes: ${Object.entries(PLANES).map(([k, p]) => `<b>${p.nombre}</b> ${p.precioMes ? `${MONEDA_PLANES} ${p.precioMes}/mes` : `gratis ${p.diasPrueba} dias`} (${k})`).join(' · ')}.</p>
  <div class="fila">
    <label>Plan <select id="pago-plan"><option value="basico">Básico</option><option value="pro">Pro</option></select></label>
    <label>Meses <input id="pago-meses" type="number" min="1" max="24" value="1" style="width:70px"></label>
    <label>Monto cobrado (vacio = precio de lista) <input id="pago-monto" type="number" min="0" step="0.01" placeholder="49"></label>
    <label>Nota <input id="pago-nota" placeholder="Yape 15/09, op. 1234"></label>
    <button id="pago-guardar">Apuntar</button>
    <button id="pago-prorroga" class="ghost">Cambiar vencimiento sin cobrar</button>
  </div>
  <p><label style="display:block;font-size:12px" class="muted">Que ve la tienda para renovar (un WhatsApp, un correo) <input id="pago-contacto" style="width:100%;margin-top:4px" placeholder="Escríbenos al +51 999 999 999"></label></p>
  <p id="pago-msg" class="muted"></p>
  <div id="pago-hist"></div>
</div>
<script>
var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
async function api(path, opts) {
  opts = opts || {};
  var r = await fetch(path, { method: opts.method || 'GET', headers: { 'content-type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  var d = await r.json().catch(function () { return {}; });
  if (!r.ok) throw new Error(d.error || ('Error ' + r.status));
  return d;
}
async function cargar() {
  try {
    var r = await api('/api/instancias');
    var filas = r.instancias.map(function (i) {
      var pl = i.plan;
      var plan = !pl ? '<span class="muted">sin plan</span><br><button class="ghost" data-plan-iniciar="' + esc(i.slug) + '">Dar prueba de 14 días</button>' : '<span class="pill ' + (pl.vencido ? 'bad' : pl.diasRestantes <= 7 ? 'warn' : 'ok') + '">' + esc(pl.nombre) + (pl.vencido ? ' · vencido' : ' · ' + pl.diasRestantes + ' d') + '</span><br><small class="muted">hasta ' + esc(new Date(pl.vencimiento).toLocaleDateString()) + '</small><br><button class="ghost" data-pago="' + esc(i.slug) + '">Apuntar pago</button>';
      var estado = i.viva ? (i.configurado ? '<span class="pill ok">WhatsApp vinculado</span>' : '<span class="pill warn">sin WhatsApp vinculado: falta /setup</span>') : '<span class="pill bad">no responde' + (i.detalle ? ': ' + esc(i.detalle) : '') + '</span>';
      return '<tr><td><b>' + esc(i.slug) + '</b><br><small class="muted">' + esc(i.nombre) + ' · ' + esc(i.proveedor) + '</small></td>' +
        '<td><a href="' + esc(i.url) + '/panel" target="_blank">' + esc(i.dominio) + '</a></td>' +
        '<td>' + estado + '</td><td>' + plan + '</td><td><small class="muted">' + esc(new Date(i.creadaEn).toLocaleDateString()) + '</small></td>' +
        '<td><button class="ghost" data-baja="' + esc(i.slug) + '">Baja</button> <button class="danger" data-borrar="' + esc(i.slug) + '">Borrar todo</button></td></tr>';
    }).join('');
    document.getElementById('tabla').innerHTML = filas ? '<table><thead><tr><th>Tienda</th><th>URL</th><th>Estado</th><th>Plan</th><th>Alta</th><th></th></tr></thead><tbody>' + filas + '</tbody></table>' : '<p class="muted">Todavia no hay tiendas.</p>';
    document.getElementById('registro').textContent = (r.registro || []).join('\\n');
    document.getElementById('ingresos').textContent = 'Cobro mensual con los planes vigentes: ' + r.moneda + ' ' + r.ingresosMes + '.';
    document.querySelectorAll('[data-pago]').forEach(function (b) { b.onclick = function () { abrirPago(b.getAttribute('data-pago')); }; });
    document.querySelectorAll('[data-plan-iniciar]').forEach(function (b) { b.onclick = async function () { var s = b.getAttribute('data-plan-iniciar'); document.getElementById('msg').textContent = 'Dando plan a ' + s + '… (recrea su contenedor)'; try { await api('/api/instancias/' + s + '/plan/iniciar', { method: 'POST' }); document.getElementById('msg').textContent = s + ': ya tiene su prueba de 14 días.'; } catch (e) { document.getElementById('msg').textContent = e.message; } cargar(); }; });
    document.getElementById('alta').disabled = Boolean(r.ocupado);
    if (r.ocupado) document.getElementById('msg').textContent = 'En curso: ' + r.ocupado + '…';
    document.querySelectorAll('[data-baja]').forEach(function (b) { b.onclick = function () { baja(b.getAttribute('data-baja'), false); }; });
    document.querySelectorAll('[data-borrar]').forEach(function (b) { b.onclick = function () { baja(b.getAttribute('data-borrar'), true); }; });
  } catch (e) { document.getElementById('msg').textContent = e.message; }
}
async function baja(slug, borrar) {
  if (!confirm(borrar ? 'Borrar ' + slug + ' con su base, sus mensajes y su vinculacion de WhatsApp. No se puede deshacer.' : 'Parar ' + slug + '. Sus datos se conservan.')) return;
  document.getElementById('msg').textContent = 'Dando de baja ' + slug + '…';
  try { await api('/api/instancias/' + slug + (borrar ? '?borrarDatos=true' : ''), { method: 'DELETE' }); document.getElementById('msg').textContent = slug + ': hecho.'; }
  catch (e) { document.getElementById('msg').textContent = e.message; }
  cargar();
}
async function abrirPago(slug) {
  var caja = document.getElementById('pago');
  caja.style.display = 'block';
  caja.querySelector('h3').textContent = 'Apuntar un pago de ' + slug;
  caja.setAttribute('data-slug', slug);
  document.getElementById('pago-msg').textContent = '';
  try {
    var r = await api('/api/instancias/' + slug + '/pagos');
    document.getElementById('pago-hist').innerHTML = r.pagos.length
      ? '<table><thead><tr><th>Fecha</th><th>Plan</th><th>Meses</th><th>Monto</th><th>Nota</th></tr></thead><tbody>' + r.pagos.slice().reverse().map(function (p) { return '<tr><td>' + esc(new Date(p.fecha).toLocaleDateString()) + '</td><td>' + esc(p.plan) + '</td><td>' + p.meses + '</td><td>' + esc(p.moneda) + ' ' + p.monto + '</td><td>' + esc(p.nota) + '</td></tr>'; }).join('') + '</tbody></table>'
      : '<p class="muted">Sin pagos apuntados todavia. Ahora: ' + esc(r.plan.nombre) + ', hasta ' + esc(new Date(r.plan.vencimiento).toLocaleDateString()) + '.</p>';
    document.getElementById('pago-contacto').value = r.contacto || '';
  } catch (e) { document.getElementById('pago-msg').textContent = e.message; }
  caja.scrollIntoView({ behavior: 'smooth' });
}
document.getElementById('pago-guardar').onclick = async function () {
  var slug = document.getElementById('pago').getAttribute('data-slug');
  var monto = document.getElementById('pago-monto').value;
  try {
    var r = await api('/api/instancias/' + slug + '/pagos', { method: 'POST', body: { plan: document.getElementById('pago-plan').value, meses: Number(document.getElementById('pago-meses').value), monto: monto === '' ? undefined : Number(monto), nota: document.getElementById('pago-nota').value } });
    document.getElementById('pago-msg').textContent = 'Apuntado: ' + r.plan.nombre + ' hasta ' + new Date(r.plan.vencimiento).toLocaleDateString() + '. La tienda lo ve en unos minutos.';
    document.getElementById('pago-nota').value = ''; document.getElementById('pago-monto').value = '';
    abrirPago(slug); cargar();
  } catch (e) { document.getElementById('pago-msg').textContent = e.message; }
};
document.getElementById('pago-prorroga').onclick = async function () {
  var slug = document.getElementById('pago').getAttribute('data-slug');
  var fecha = prompt('Nueva fecha de vencimiento (AAAA-MM-DD), sin cobrar:');
  if (!fecha) return;
  try { await api('/api/instancias/' + slug + '/plan', { method: 'PATCH', body: { vencimiento: fecha, contacto: document.getElementById('pago-contacto').value } }); document.getElementById('pago-msg').textContent = 'Vencimiento cambiado a ' + fecha + '.'; abrirPago(slug); cargar(); }
  catch (e) { document.getElementById('pago-msg').textContent = e.message; }
};
document.getElementById('pago-contacto').onchange = async function () {
  var slug = document.getElementById('pago').getAttribute('data-slug');
  try { await api('/api/instancias/' + slug + '/plan', { method: 'PATCH', body: { contacto: document.getElementById('pago-contacto').value } }); } catch (e) { document.getElementById('pago-msg').textContent = e.message; }
};
document.getElementById('alta').onclick = async function () {
  var slug = document.getElementById('slug').value.trim().toLowerCase();
  document.getElementById('msg').textContent = 'Creando ' + slug + '… (la primera vez construye la imagen: unos minutos)';
  document.getElementById('alta').disabled = true;
  var t = setInterval(cargar, 3000);
  try {
    var r = await api('/api/instancias', { method: 'POST', body: { slug: slug, nombre: document.getElementById('nombre').value, proveedor: document.getElementById('proveedor').value } });
    document.getElementById('msg').innerHTML = 'Lista: <a href="' + esc(r.instancia.url) + '/login" target="_blank">' + esc(r.instancia.url) + '</a> — entra, crea la primera cuenta y conecta el WhatsApp en /setup.';
    document.getElementById('slug').value = ''; document.getElementById('nombre').value = '';
  } catch (e) { document.getElementById('msg').textContent = e.message; }
  clearInterval(t);
  document.getElementById('alta').disabled = false;
  cargar();
};
cargar();
setInterval(cargar, 30000);
</script></main></body></html>`;
}

await app.listen({ port: cfg.maestroPuerto, host: '0.0.0.0' });
console.log(`
  Panel maestro en http://localhost:${cfg.maestroPuerto}  (usuario: ${cfg.maestroUsuario})
  Con Caddy levantado, tambien en ${cfg.dominioBase.startsWith('localhost') ? 'http' : 'https'}://maestro.${cfg.dominioBase}
`);
