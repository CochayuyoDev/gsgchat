import { PERMISOS } from '../auth/permisos.js';
import { appShell } from './shell.js';
import { escapeHtml } from './login-page.js';
import { MENSAJE_ERROR_HTTP_JS } from './bandeja-mensajes.js';

/** Los 12 campos del contrato con GSG Courier. */
export const EJEMPLO_COURIER = { pedidos: [{
  tracking: 'GSG-000001', empresa: 'Tienda Uno', cliente: 'Ana Pérez', telefono: '987654321',
  metodoPago: 'Efectivo', montoCobrar: 85,
  distrito: 'Lince', direccion: 'Av. Lima 123', fecRuta: '2026-10-03', telefono2: '988777666',
  producto: 'Zapatos', cantBultos: 2,
}] };

/** [campo de Courier, nombre JSON, obligatorio, detalle] */
const CAMPOS: Array<[string, string, boolean, string]> = [
  ['Código de tracking', 'tracking', true, 'El que manda GSG; identifica el pedido (no se duplica en el día).'],
  ['Empresa', 'empresa', true, 'Nombre o {codigo, nombre}.'],
  ['Cliente', 'cliente', true, 'Nombre del cliente.'],
  ['Teléfono', 'telefono', true, 'WhatsApp del cliente.'],
  ['Método de pago', 'metodoPago', true, ''],
  ['Monto Cobrar', 'montoCobrar', true, 'Número (por ejemplo 45.50); 0 si ya está pagado.'],
  ['Distrito', 'distrito', false, ''],
  ['Dirección', 'direccion', false, ''],
  ['Fec Ruta', 'fecRuta', false, 'Dato del pedido; no programa mensajes.'],
  ['Teléfono 2', 'telefono2', false, ''],
  ['Producto', 'producto', false, ''],
  ['Cant Bultos', 'cantBultos', false, 'Entero no negativo.'],
];

/** Los campos de antes: se siguen aceptando para no romper envíos anteriores, pero no son parte del contrato. */
const CAMPOS_ANTERIORES = ['driver', 'costServ', 'referenciaDireccion', 'fecRegistro', 'observacionCliente', 'detalleProducto', 'tamano', 'clientePagaDelivery', 'sede', 'tipoRuta', 'nroDocumento', 'agenciaNombre', 'agenciaDestino', 'pagoEnDestino'];

/** Lo que contesta POST /api/v1/entregas, código por código. */
const RESPUESTAS: Array<[string, string]> = [
  ['201', 'Al menos un pedido quedó guardado. Cada uno trae su id real (el de GSGchat) y el estado de su primer mensaje.'],
  ['200', 'Todos ya estaban (repetidos): no se duplicó nada; vienen en «existentes» con su id.'],
  ['400', 'Datos faltantes o con formato incorrecto: «detalles» dice qué campo de qué pedido. No se guarda ninguno.'],
  ['401', 'Sin clave, o la clave no es válida o fue revocada.'],
  ['403', 'La clave es válida pero no tiene permiso de recepción (entregas:gestionar), o la tienda está suspendida.'],
  ['404', 'La ruta no existe (por ejemplo, con /tienda/<nombre> delante).'],
  ['409', 'La clave está registrada en dos tiendas: no se sabe a cuál va.'],
  ['429', 'Más de 120 llamadas por minuto con la misma clave: esperar lo que dice Retry-After.'],
  ['503', 'La base de datos no responde: repetir la misma llamada (lo ya guardado no se duplica).'],
  ['500', 'Error interno inesperado: repetir la misma llamada; queda en el registro del servidor.'],
];

export function gsgCourierPage(opts: { nombreNegocio: string; disponible: boolean; demo?: boolean }): string {
  const ejemplo = JSON.stringify(EJEMPLO_COURIER, null, 2);
  return appShell({ titulo: 'GSG Courier', subtitulo: 'Conexión para recibir y encolar pedidos',
    nombreNegocio: opts.nombreNegocio, demo: opts.demo,
    css: `.courier-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.courier-card{padding:22px;border:1px solid var(--borde);border-radius:16px;background:var(--superficie)}.courier-card h2{margin-top:0}.courier-card input,.courier-card textarea{width:100%;box-sizing:border-box}.courier-card input{padding:12px}.courier-card textarea{min-height:300px;padding:14px;font:13px/1.6 monospace}.courier-wide{grid-column:1/-1}.courier-actions{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}.courier-scroll{overflow:auto}.courier-card table{width:100%;border-collapse:collapse}.courier-card td,.courier-card th{padding:10px;text-align:left;border-bottom:1px solid var(--borde)}.courier-card pre{white-space:pre-wrap;overflow-wrap:anywhere}.courier-secret{overflow-wrap:anywhere}.courier-card small{display:block;margin-top:8px}.courier-status{padding:12px;border-radius:10px;background:var(--superficie-2);margin:12px 0}@media(max-width:800px){.courier-grid{grid-template-columns:1fr}}`,
    contenido: `<div class="courier-grid">
      <section class="courier-card courier-wide"><h2>Courier envía → GSGchat recibe → el sistema procesa</h2>
        <p>Esta conexión recibe y encola los pedidos. El motor de GSGchat se encarga de los mensajes y sus intentos.</p>
        ${opts.disponible ? '<p id="courier-estado" class="courier-status" role="status">Consultando claves y últimas recepciones…</p>' : '<p class="courier-status">El módulo de entregas no está disponible en este servidor.</p>'}
        <a href="/numeros">Ver pedidos recibidos</a> · <a href="/setup#gsg">Configurar los reportes hacia Courier</a>
        <small>Con «Confirmar la lista de GSG» activado, los pedidos esperan aprobación en Números del día. Desactivado, el motor los procesa automáticamente.</small>
      </section>
      <section class="courier-card"><h2>1. Dirección de recepción</h2>
        <p>Entrega esta dirección al programador de GSG Courier.</p>
        <label for="courier-url">Enviar pedidos con POST</label><input id="courier-url" readonly>
        <div class="courier-actions"><button class="btn" id="courier-copiar-url">Copiar dirección</button><button class="btn" id="courier-descargar">Descargar JSON de ejemplo</button></div>
        <p><code>Content-Type: application/json</code><br><code>X-API-Key: CLAVE_DE_GSG</code></p>
        <small>La clave identifica esta tienda y debe tener permiso de recepción. Sin clave, o con una clave inválida o revocada: 401. Con una clave sin permiso: 403.</small>
        <small>Hasta 600 pedidos por llamada. Máximo 120 llamadas por minuto y clave.</small>
        <small>El tracking evita duplicados por referencia y día. La respuesta distingue creadas, repetidas y descartadas.</small>
        <a href="/api/v1/openapi.json" target="_blank" rel="noopener">Ver el OpenAPI</a>
      </section>
      <section class="courier-card courier-wide"><h2>2. Claves API de GSGchat</h2>
        <p>Administra el acceso de cada integración. El sistema guarda únicamente la huella de la clave.</p>
        <form id="courier-form"><label for="courier-nombre">¿Para quién es esta clave?</label><input id="courier-nombre" required minlength="2" maxlength="80" autocomplete="off" placeholder="Ejemplo: GSG principal">
        <label for="courier-vence">Vencimiento opcional</label><input id="courier-vence" type="datetime-local">
        <fieldset><legend>Permisos</legend>${Object.entries(PERMISOS).map(([valor, texto]) => `<label style="display:block"><input style="width:auto" type="checkbox" name="clave-permiso" value="${escapeHtml(valor)}" ${valor === 'entregas:leer' ? 'checked' : ''}> ${escapeHtml(texto)}</label>`).join('')}</fieldset>
        <div class="courier-actions"><button class="btn primario" id="courier-crear" type="submit" ${opts.disponible ? '' : 'disabled'}>Crear clave</button><button class="btn" id="courier-cancelar" type="button" hidden>Cancelar edición</button></div></form>
        <div id="courier-nueva" hidden style="background:var(--superficie-2);padding:18px;border:1px solid #d9a441;border-radius:12px"><h3 id="courier-secreto-titulo"></h3><p><strong>Guarda esta clave en un lugar seguro porque luego no la volverás a ver.</strong></p><p>Solo se muestra ahora. Si la pierdes, renueva la clave: la anterior dejará de funcionar.</p><code id="courier-secreto" class="courier-secret"></code><div class="courier-actions"><button class="btn" id="courier-copiar-clave">Copiar clave</button><button class="btn" id="courier-ocultar">Ocultar clave (ya la copié)</button></div></div>
        <div id="courier-claves" class="courier-scroll"></div><p id="courier-aviso" role="status" aria-live="polite"></p>
      </section>
      <section class="courier-card courier-wide"><h2>3. Validar el formato de pedidos</h2>
        <p>Pega el JSON de Courier. Esta prueba revisa campos, teléfonos y duplicados dentro del lote; no guarda pedidos ni envía WhatsApp.</p>
        <label for="courier-json">Pedidos en JSON</label><textarea id="courier-json" spellcheck="false">${escapeHtml(ejemplo)}</textarea>
        <div class="courier-actions"><button class="btn primario" id="courier-validar" ${opts.disponible ? '' : 'disabled'}>Validar sin encolar</button><button class="btn" id="courier-ejemplo">Restaurar ejemplo</button></div>
        <pre id="courier-validacion" role="status" aria-live="polite"></pre>
      </section>
      <section class="courier-card courier-wide"><h2>Últimas llamadas de recepción</h2><button class="btn" id="courier-refrescar">Actualizar estado</button><h3>Lo que GSG nos envió</h3><div id="courier-bitacora" class="courier-scroll"></div><h3>Lo que enviamos a GSG</h3><p id="courier-envios-destino" class="courier-status"></p><div id="courier-envios" class="courier-scroll"></div></section>
      <section class="courier-card courier-wide"><h2>Campos que envía Courier</h2><p>Obligatorios: tracking, empresa, cliente, telefono, metodoPago y montoCobrar. Si falta uno, la API responde 400 con el campo y el pedido. Los demás son opcionales; los textos admiten hasta 200 caracteres.</p><div class="courier-scroll"><table><thead><tr><th>Campo de Courier</th><th>Nombre JSON</th><th>Obligatorio</th><th>Detalle</th></tr></thead><tbody>${CAMPOS.map(([nombre, json, obligatorio, detalle]) => `<tr><td>${escapeHtml(nombre)}</td><td><code>${escapeHtml(json)}</code></td><td>${obligatorio ? 'Sí' : 'No'}</td><td>${escapeHtml(detalle)}</td></tr>`).join('')}</tbody></table></div><small>Campos anteriores que se siguen aceptando (fuera del contrato): ${CAMPOS_ANTERIORES.map((c) => escapeHtml(c)).join(', ')}.</small></section>
      <section class="courier-card courier-wide" id="courier-respuestas"><h2>Respuestas de la recepción</h2><p>Los errores vienen en JSON: <code>{ "ok": false, "codigo": "...", "error": "...", "detalles": [...] }</code>.</p><div class="courier-scroll"><table><thead><tr><th>HTTP</th><th>Significado</th></tr></thead><tbody>${RESPUESTAS.map(([c, t]) => `<tr><td><b>${c}</b></td><td>${escapeHtml(t)}</td></tr>`).join('')}</tbody></table></div></section>
    </div>`,
    script: String.raw`
(function () {
  var $ = function(id) { return document.getElementById(id); };
  var editando = null, ocupada = false;
  var ejemplo = $('courier-json').value;
  var endpoint = location.origin + '/api/v1/entregas';
  $('courier-url').value = endpoint;
  function aviso(t) { $('courier-aviso').textContent = t; }
  function esc(t) { var el = document.createElement('span'); el.textContent = String(t == null ? '' : t); return el.innerHTML; }
${MENSAJE_ERROR_HTTP_JS}
  /* El error tal como lo dijo el servidor: «HTTP 400 · <su mensaje> · campo: detalle». */
  async function api(url, method, body) {
    var r;
    try {
      r = await fetch(url, { method: method || 'GET', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (fallo) { var sinRed = new Error('Sin conexión con el servidor'); sinRed.status = 0; throw sinRed; }
    var data = await r.json().catch(function () { return null; });
    if (!r.ok) {
      var e = new Error(mensajeDeErrorHttp(r.status, r.statusText, data));
      e.status = r.status; e.codigo = data && data.codigo; e.detalles = data && data.detalles; e.datos = data;
      throw e;
    }
    return data || {};
  }
  async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); aviso('Copiado.'); }
    catch(e) { aviso('Selecciona y copia el texto manualmente; el navegador no permitió copiar.'); }
  }
  $('courier-copiar-url').onclick = function() { copiar(endpoint); };
  $('courier-copiar-clave').onclick = function() { copiar($('courier-secreto').textContent); };
  function ocultar() { $('courier-secreto').textContent = ''; $('courier-secreto-titulo').textContent = ''; $('courier-nueva').hidden = true; }
  $('courier-ocultar').onclick = ocultar;
  window.addEventListener('pagehide', ocultar);
  window.addEventListener('pageshow', function(e) { if (e.persisted) ocultar(); });
  function mostrar(r) { ocultar(); $('courier-secreto-titulo').textContent = 'Copia ahora la clave de «' + r.registro.nombre + '»'; $('courier-secreto').textContent = r.clave; $('courier-nueva').hidden = false; }
  function estadoClave(c) { return c.revocadaAt ? 'Revocada' : c.venceAt && new Date(c.venceAt) <= new Date() ? 'Vencida' : c.desactivadaAt ? 'Desactivada' : 'Activa'; }
  function fecha(f) { return f ? new Date(f).toLocaleString('es-PE') : '—'; }
  function cancelar() { editando = null; $('courier-form').reset(); $('courier-crear').textContent = 'Crear clave'; $('courier-cancelar').hidden = true; }
  $('courier-cancelar').onclick = cancelar;
  $('courier-descargar').onclick = function() {
    var url = URL.createObjectURL(new Blob([ejemplo], {type:'application/json'}));
    var a = document.createElement('a'); a.href = url; a.download = 'pedido-gsg-ejemplo.json'; a.click(); URL.revokeObjectURL(url);
  };
  $('courier-ejemplo').onclick = function() { $('courier-json').value = ejemplo; $('courier-validacion').textContent = ''; };
  async function cargar() {
    try {
      var claves = await api('/admin/claves-api');
      var activas = claves.filter(function(c) { return estadoClave(c) === 'Activa' && (c.permisos || []).some(function(p) { return p === '*' || p === 'entregas:gestionar'; }); });
      $('courier-claves').innerHTML = claves.length ? '<table><thead><tr><th>Nombre / identificador</th><th>Permisos</th><th>Creación / vencimiento</th><th>Último uso</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>' + claves.map(function(c) {
        var estado = estadoClave(c);
        return '<tr><td><b>' + esc(c.nombre) + '</b><br><small>' + esc(c.id) + '</small></td><td>' + esc(c.permisos.join(', ')) + '</td><td>' + esc(fecha(c.createdAt)) + '<br>' + esc(fecha(c.venceAt)) + '</td><td>' + esc(c.ultimoUsoAt ? fecha(c.ultimoUsoAt) : 'Nunca se usó') + '</td><td>' + estado + '</td><td>' + (c.revocadaAt ? '' : '<button class="btn sm" data-accion="estado" data-id="' + esc(c.id) + '" ' + (estado === 'Vencida' ? 'disabled' : '') + '>' + (c.desactivadaAt ? 'Activar' : 'Desactivar') + '</button> <button class="btn sm" data-accion="renovar" data-id="' + esc(c.id) + '">Renovar</button> <button class="btn sm" data-accion="editar" data-id="' + esc(c.id) + '">Editar</button> ') + '<button class="btn sm peligro" data-accion="eliminar" data-id="' + esc(c.id) + '">Eliminar</button></td></tr>';
      }).join('') + '</tbody></table>' : '<p>No hay claves creadas.</p>';
      $('courier-claves').querySelectorAll('[data-accion]').forEach(function(b) {
        b.onclick = async function() {
          if (ocupada) return;
          var c = claves.find(function(c) { return c.id === b.dataset.id; });
          if (b.dataset.accion === 'editar') {
            editando = c.id; $('courier-nombre').value = c.nombre;
            $('courier-vence').value = c.venceAt ? new Date(new Date(c.venceAt).getTime() - new Date(c.venceAt).getTimezoneOffset() * 60000).toISOString().slice(0,16) : '';
            document.querySelectorAll('[name="clave-permiso"]').forEach(function(x) { x.checked = c.permisos.includes(x.value); });
            $('courier-crear').textContent = 'Guardar cambios'; $('courier-cancelar').hidden = false; $('courier-nombre').focus(); return;
          }
          var accion = b.dataset.accion;
          var nombre;
          if (accion === 'eliminar') { nombre = window.prompt('Eliminar definitivamente «' + c.nombre + '». Escribe su nombre exacto para confirmar.'); if (nombre !== c.nombre) { aviso('Eliminación cancelada: el nombre no coincide.'); return; } }
          else if (!(await confirmarDialogo({titulo:accion === 'renovar' ? 'Renovar clave' : c.desactivadaAt ? 'Activar clave' : 'Desactivar clave',texto:accion === 'renovar' ? 'La clave anterior dejará de funcionar. Guarda la nueva y actualízala en el sistema externo.' : c.desactivadaAt ? 'Esta integración recuperará sus permisos.' : 'Las próximas peticiones con esta clave serán rechazadas.',boton:'Confirmar',peligro:true}))) return;
          ocupada = true; b.disabled = true;
          try {
            ocultar();
            if (accion === 'renovar') mostrar(await api('/admin/claves-api/' + encodeURIComponent(c.id) + '/renovar', 'POST', {}));
            else if (accion === 'eliminar') await api('/admin/claves-api/' + encodeURIComponent(c.id) + '/eliminar', 'POST', {nombre:nombre});
            else await api('/admin/claves-api/' + encodeURIComponent(c.id), 'PATCH', {activo:!!c.desactivadaAt});
            cancelar(); aviso('Cambio guardado.'); await cargar();
          } catch(e) { aviso(e.message); } finally { ocupada = false; b.disabled = false; }
        };
      });
      var estado = $('courier-estado');
      if (estado) estado.textContent = activas.length ? 'Clave activa: listo para recibir pedidos. Falta comprobar una llamada de Courier.' : 'Pendiente: crea una clave y compártela con Courier.';
      try {
        var gsg = await api('/admin/gsg');
        var llamadas = (gsg.bitacora || []).filter(function(l) { return /^POST \/api\/v1\/entregas(?:\?|$)/.test(l.que); });
        $('courier-bitacora').innerHTML = llamadas.length ? '<table><thead><tr><th>Fecha</th><th>Respuesta</th><th>Resultado</th><th>Origen</th></tr></thead><tbody>' + llamadas.map(function(l) { return '<tr><td>' + esc(new Date(l.en).toLocaleString('es-PE')) + '</td><td>' + esc(l.status) + '</td><td>' + esc(l.resultado) + '</td><td>' + esc(l.quien) + '</td></tr>'; }).join('') + '</tbody></table>' : '<p>Todavía no hay llamadas de recepción registradas.</p>';
        if (estado && llamadas.some(function(l) { return l.status === 201; })) estado.textContent = activas.length ? 'Recepción comprobada: ya se crearon pedidos desde la API.' : 'Hay recepciones anteriores; crea una clave activa para seguir recibiendo.';
      } catch(e) { $('courier-bitacora').textContent = 'Historial no disponible: ' + e.message; }
      try {
        var env = await api('/admin/gsg/envios');
        var ESTADOS = { enviado: 'Enviado a GSG', pendiente: 'Pendiente de enviar', fallido: 'Falló el envío' };
        $('courier-envios-destino').textContent = env.aviso ? env.aviso : 'Se envía con POST a ' + (env.destino || '(sin dirección)') + ' con la cabecera x-api-key.';
        $('courier-envios').innerHTML = env.items.length ? '<table><thead><tr><th>Fecha</th><th>Cuerpo enviado</th><th>Estado</th><th>Intentos</th><th>Error</th></tr></thead><tbody>' + env.items.map(function(r) {
          return '<tr><td>' + esc(new Date(r.enviadoEn || r.en).toLocaleString('es-PE')) + '</td><td><code>' + esc(JSON.stringify(r.cuerpo)) + '</code></td><td><b>' + esc(ESTADOS[r.estado] || r.estado) + '</b></td><td>' + esc(r.intentos) + '</td><td>' + esc(r.error || '') + '</td></tr>';
        }).join('') + '</tbody></table>' : '<p>Todavía no se ha enviado ninguna ubicación a GSG. Se envía sola cuando un cliente manda su ubicación por WhatsApp.</p>';
      } catch(e) { $('courier-envios').textContent = 'No se pudo consultar lo enviado a GSG: ' + e.message; }
    } catch(e) { aviso(e.message); if ($('courier-estado')) $('courier-estado').textContent = 'No se pudo consultar el estado.'; }
  }
  $('courier-form').onsubmit = async function(e) {
    e.preventDefault(); if (ocupada) return;
    var permisos = Array.from(document.querySelectorAll('[name="clave-permiso"]:checked')).map(function(x) { return x.value; });
    if (!permisos.length) { aviso('Selecciona al menos un permiso.'); return; }
    var body = {nombre:$('courier-nombre').value.trim(), permisos:permisos, venceAt:$('courier-vence').value ? new Date($('courier-vence').value).toISOString() : null};
    ocupada = true; $('courier-crear').disabled = true;
    try {
      ocultar();
      var r = await api('/admin/claves-api' + (editando ? '/' + encodeURIComponent(editando) : ''), editando ? 'PATCH' : 'POST', body);
      if (r.clave) mostrar(r);
      cancelar(); aviso('Guardado.'); await cargar();
    } catch(e) { aviso(e.message); } finally { ocupada = false; $('courier-crear').disabled = false; }
  };
  $('courier-validar').onclick = async function() {
    var b = this; b.disabled = true;
    var body;
    try { body = JSON.parse($('courier-json').value); }
    catch(e) { $('courier-validacion').textContent = 'El texto no es un JSON válido: ' + e.message; b.disabled = false; return; }
    try { var r = await api('/admin/gsg-courier/validar', 'POST', body); $('courier-validacion').textContent = 'HTTP 200 · ' + (r.detalle || '') + '\n' + JSON.stringify(r, null, 2); }
    catch(e) {
      var lineas = [e.message];
      if (e.datos) lineas.push(JSON.stringify(e.datos, null, 2));
      $('courier-validacion').textContent = lineas.join('\n');
    } finally { b.disabled = false; }
  };
  $('courier-refrescar').onclick = cargar;
  cargar();
})();`,
  });
}
