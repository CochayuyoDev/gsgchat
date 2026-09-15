/**
 * El panel maestro: tus instancias, de un vistazo.
 *
 *   npm run saas:maestro          ->  http://localhost:3900  (o maestro.<dominio>)
 *
 * Es para ti, no para los clientes: lista las tiendas, dice cuales
 * responden y cuales tienen WhatsApp conectado, y da de alta o de baja
 * desde la pantalla. Corre en el host (necesita Docker a mano), detras de
 * usuario y contrasena (MAESTRO_USUARIO / MAESTRO_CLAVE en saas/.env).
 */

import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { altaInstancia, bajaInstancia, estadoInstancias, leerConfigSaas, prepararBase, slugValido, type EstadoInstancia } from '../instancias.js';

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
  const h = request.headers.authorization ?? '';
  if (h.startsWith('Basic ')) {
    const [u, ...c] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
    if (u !== undefined && igual(u, cfg.maestroUsuario) && igual(c.join(':'), cfg.maestroClave)) return;
  }
  return reply.code(401).header('www-authenticate', 'Basic realm="wa-locator maestro"').send('Entra con el usuario y la contrasena del maestro.');
});

/** Un alta o una baja a la vez: dos `docker compose` a la vez se pisan. */
let ocupado: string | null = null;
const registro: string[] = [];
const log = (l: string) => {
  registro.push(`${new Date().toISOString().slice(11, 19)} ${l}`);
  if (registro.length > 200) registro.shift();
};

app.get('/api/instancias', async () => ({ instancias: await estadoInstancias(), ocupado, registro: registro.slice(-30) }));

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
<title>Maestro · wa-locator</title>
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
<p class="muted">Una instancia por tienda: su contenedor, su base, su WhatsApp. Dominio base: <b>${cfg.dominioBase}</b>.</p>
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
      var estado = i.viva ? (i.configurado ? '<span class="pill ok">WhatsApp vinculado</span>' : '<span class="pill warn">sin WhatsApp vinculado: falta /setup</span>') : '<span class="pill bad">no responde' + (i.detalle ? ': ' + esc(i.detalle) : '') + '</span>';
      return '<tr><td><b>' + esc(i.slug) + '</b><br><small class="muted">' + esc(i.nombre) + ' · ' + esc(i.proveedor) + '</small></td>' +
        '<td><a href="' + esc(i.url) + '/panel" target="_blank">' + esc(i.dominio) + '</a></td>' +
        '<td>' + estado + '</td><td><small class="muted">' + esc(new Date(i.creadaEn).toLocaleDateString()) + '</small></td>' +
        '<td><button class="ghost" data-baja="' + esc(i.slug) + '">Baja</button> <button class="danger" data-borrar="' + esc(i.slug) + '">Borrar todo</button></td></tr>';
    }).join('');
    document.getElementById('tabla').innerHTML = filas ? '<table><thead><tr><th>Tienda</th><th>URL</th><th>Estado</th><th>Alta</th><th></th></tr></thead><tbody>' + filas + '</tbody></table>' : '<p class="muted">Todavia no hay tiendas.</p>';
    document.getElementById('registro').textContent = (r.registro || []).join('\\n');
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
