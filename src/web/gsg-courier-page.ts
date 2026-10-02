import { appShell } from './shell.js';
import { escapeHtml } from './login-page.js';

export const EJEMPLO_COURIER = { pedidos: [{
  tracking: 'GSG-000001', driver: { nombre: 'Luis', telefono: '999888777' }, distrito: 'Lince',
  costServ: 12.5, empresa: 'Tienda Uno', cliente: 'Ana Pérez', telefono: '987654321',
  direccion: 'Av. Lima 123', referenciaDireccion: 'Frente al parque',
  fecRegistro: '2026-10-02T08:00:00-05:00', fecRuta: '2026-10-03',
  observacionCliente: 'Llamar antes de llegar', detalleProducto: 'Caja sellada', telefono2: '988777666',
  producto: 'Zapatos', tamano: '40', cantBultos: 2, metodoPago: 'Efectivo', montoCobrar: 85,
  clientePagaDelivery: false, sede: 'Lima', tipoRuta: 'Agencia', nroDocumento: '00123456',
  agenciaNombre: 'Agencia Uno', agenciaDestino: 'Huancayo - Av. Uno 123', pagoEnDestino: true,
}] };

const CAMPOS = [
  ['Código de tracking', 'tracking', 'Identifica el pedido si se omite referencia.'],
  ['Driver', 'driver', 'Nombre o {nombre, telefono}.'], ['Distrito', 'distrito', ''],
  ['Cost Serv', 'costServ', 'Costo del servicio.'], ['Empresa', 'empresa', 'Nombre o {codigo, nombre}.'],
  ['Cliente', 'cliente', ''], ['Teléfono', 'telefono', 'WhatsApp del cliente.'], ['Dirección', 'direccion', ''],
  ['Referencia de dirección', 'referenciaDireccion', 'Opcional; indicaciones para llegar.'],
  ['Fec Registro', 'fecRegistro', 'Fecha enviada por Courier.'], ['Fec Ruta', 'fecRuta', 'Dato del pedido; no programa mensajes.'],
  ['Observación del cliente', 'observacionCliente', ''], ['Detalle del producto', 'detalleProducto', ''],
  ['Teléfono 2', 'telefono2', ''], ['Producto', 'producto', ''], ['Tamaño', 'tamano', ''],
  ['Cant Bultos', 'cantBultos', 'Entero no negativo.'], ['Método de pago', 'metodoPago', ''],
  ['Monto Cobrar', 'montoCobrar', ''], ['Cliente Paga Delivery', 'clientePagaDelivery', 'true o false.'],
  ['SEDE', 'sede', ''], ['Tipo de Ruta', 'tipoRuta', ''], ['Nro de documento', 'nroDocumento', 'Texto para conservar ceros.'],
  ['Agencia (nombre)', 'agenciaNombre', ''], ['Agencia (dirección / destino)', 'agenciaDestino', ''],
  ['Pago en destino', 'pagoEnDestino', 'true o false.'],
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
        <p><code>Content-Type: application/json</code><br><code>Authorization: Bearer CLAVE_DE_GSG</code></p>
        <small>La clave identifica esta tienda y debe tener permiso de recepción. Sin una clave válida: 404, «No tiene permiso».</small>
        <small>Hasta 500 pedidos por llamada. Para 600, enviar 500 + 100. Máximo 120 llamadas por minuto y clave.</small>
        <small>El tracking evita duplicados por referencia y día. La respuesta distingue creadas, repetidas y descartadas.</small>
        <a href="/docs/contrato-gsg.md">Descargar contrato completo</a>
      </section>
      <section class="courier-card"><h2>2. Clave de GSG Courier</h2>
        <p>Crea una clave exclusiva para los pedidos de Courier. La clave completa se muestra una sola vez.</p>
        <button class="btn primario" id="courier-crear" ${opts.disponible ? '' : 'disabled'}>Crear clave para GSG Courier</button>
        <div id="courier-nueva" hidden><p>Guárdala y entrégala a Courier:</p><code id="courier-secreto" class="courier-secret"></code><div class="courier-actions"><button class="btn" id="courier-copiar-clave">Copiar clave</button><button class="btn" id="courier-ocultar">Ocultar clave</button></div></div>
        <div id="courier-claves"></div><p id="courier-aviso" role="status" aria-live="polite"></p>
      </section>
      <section class="courier-card courier-wide"><h2>3. Validar el formato de pedidos</h2>
        <p>Pega el JSON de Courier. Esta prueba revisa campos, teléfonos y duplicados dentro del lote; no guarda pedidos ni envía WhatsApp.</p>
        <label for="courier-json">Pedidos en JSON</label><textarea id="courier-json" spellcheck="false">${escapeHtml(ejemplo)}</textarea>
        <div class="courier-actions"><button class="btn primario" id="courier-validar" ${opts.disponible ? '' : 'disabled'}>Validar sin encolar</button><button class="btn" id="courier-ejemplo">Restaurar ejemplo</button></div>
        <pre id="courier-validacion" role="status" aria-live="polite"></pre>
      </section>
      <section class="courier-card courier-wide"><h2>Últimas llamadas de recepción</h2><button class="btn" id="courier-refrescar">Actualizar estado</button><div id="courier-bitacora" class="courier-scroll"></div></section>
      <section class="courier-card courier-wide"><h2>Campos que envía Courier</h2><p>Envía tracking (o referencia) y teléfono. Los demás campos son opcionales; los textos adicionales admiten hasta 200 caracteres.</p><div class="courier-scroll"><table><thead><tr><th>Campo de Courier</th><th>Nombre JSON</th><th>Detalle</th></tr></thead><tbody>${CAMPOS.map(c => `<tr>${c.map(v => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>
    </div>`,
    script: String.raw`
(function () {
  var $ = function(id) { return document.getElementById(id); };
  var ejemplo = $('courier-json').value;
  var endpoint = location.origin + '/api/v1/entregas';
  $('courier-url').value = endpoint;
  function aviso(t) { $('courier-aviso').textContent = t; }
  function esc(t) { var el = document.createElement('span'); el.textContent = String(t == null ? '' : t); return el.innerHTML; }
  async function api(url, method, body) {
    var r = await fetch(url, { method: method || 'GET', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    var data = await r.json(); if (!r.ok) throw new Error(data.error || 'No se pudo completar la solicitud'); return data;
  }
  async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); aviso('Copiado.'); }
    catch(e) { aviso('Selecciona y copia el texto manualmente; el navegador no permitió copiar.'); }
  }
  $('courier-copiar-url').onclick = function() { copiar(endpoint); };
  $('courier-copiar-clave').onclick = function() { copiar($('courier-secreto').textContent); };
  $('courier-ocultar').onclick = function() { $('courier-secreto').textContent = ''; $('courier-nueva').hidden = true; };
  $('courier-descargar').onclick = function() {
    var url = URL.createObjectURL(new Blob([ejemplo], {type:'application/json'}));
    var a = document.createElement('a'); a.href = url; a.download = 'pedido-gsg-ejemplo.json'; a.click(); URL.revokeObjectURL(url);
  };
  $('courier-ejemplo').onclick = function() { $('courier-json').value = ejemplo; $('courier-validacion').textContent = ''; };
  async function cargar() {
    try {
      var claves = await api('/admin/claves-api');
      claves = claves.filter(function(c) { return c.nombre === 'GSG Courier' || c.nombre === 'GSG'; });
      var activas = claves.filter(function(c) { return !c.revocadaAt && (c.permisos || []).some(function(p) { return p === '*' || p === 'entregas:gestionar'; }); });
      $('courier-claves').innerHTML = claves.length ? claves.map(function(c) {
        return '<p><b>' + esc(c.nombre) + '</b> ' + esc(c.prefijo) + ' · ' + (c.revocadaAt ? 'Revocada' : 'Activa') + (c.revocadaAt ? '' : ' <button class="btn sm peligro" data-revocar="' + esc(c.id) + '">Revocar</button>') + '</p>';
      }).join('') : '<p>No hay claves de GSG creadas.</p>';
      $('courier-claves').querySelectorAll('[data-revocar]').forEach(function(b) {
        b.onclick = async function() {
          if (!(await confirmarDialogo({titulo:'Revocar clave de Courier',texto:'Courier dejará de poder enviar pedidos con esta clave.',boton:'Revocar',peligro:true}))) return;
          b.disabled = true;
          try { await api('/admin/claves-api/' + encodeURIComponent(b.dataset.revocar), 'DELETE'); $('courier-ocultar').click(); aviso('Clave revocada.'); await cargar(); }
          catch(e) { aviso(e.message); b.disabled = false; }
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
    } catch(e) { aviso(e.message); if ($('courier-estado')) $('courier-estado').textContent = 'No se pudo consultar el estado.'; }
  }
  $('courier-crear').onclick = async function() {
    var b = this; b.disabled = true;
    try {
      var r = await api('/admin/claves-api', 'POST', {nombre:'GSG Courier',permisos:['entregas:gestionar']});
      $('courier-secreto').textContent = r.clave; $('courier-nueva').hidden = false;
      aviso('Clave creada. Solo se mostrará aquí hasta ocultarla o salir de la página.'); await cargar();
    } catch(e) { aviso(e.message); } finally { b.disabled = false; }
  };
  $('courier-validar').onclick = async function() {
    var b = this; b.disabled = true;
    try { var body = JSON.parse($('courier-json').value); var r = await api('/admin/gsg-courier/validar', 'POST', body); $('courier-validacion').textContent = JSON.stringify(r, null, 2); }
    catch(e) { $('courier-validacion').textContent = e.message; } finally { b.disabled = false; }
  };
  $('courier-refrescar').onclick = cargar;
  cargar();
})();`,
  });
}
