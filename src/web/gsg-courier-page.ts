import { calcularVencimientoClave } from './vencimiento-clave.js';
import { appShell } from './shell.js';
import { escapeHtml } from './login-page.js';
import { MENSAJE_ERROR_HTTP_JS } from './bandeja-mensajes.js';

/** Los 12 campos del contrato con GSG Courier. */
export const EJEMPLO_COURIER = { pedidos: [{
  tracking: 'GSG-E-205', empresa: 'Tienda Uno', cliente: 'Ana Pérez', telefono: '987654321',
  metodoPago: 'Efectivo', montoCobrar: 85,
  distrito: 'Lince', direccion: 'Av. Lima 123', fecRuta: '2026-10-03', telefono2: '988777666',
  producto: 'Zapatos', cantBultos: 2,
}] };

/** [campo de Courier, nombre JSON, obligatorio, detalle] */
export const CAMPOS: Array<[string, string, boolean, string]> = [
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

/** Un cuerpo de ejemplo de la API 2 (el mismo tracking que el ejemplo de la API 1). */
export const EJEMPLO_FLUJO = { tracking: 'GSG-E-205', accion: 'CANCELAR', motivo: 'El cliente anuló el pedido' };

/** API 2: los campos de una orden de cancelar o reintentar. [nombre JSON, obligatorio, detalle] */
export const CAMPOS_FLUJO: Array<[string, boolean, string]> = [
  ['tracking', true, 'El tracking del pedido en curso (texto o número).'],
  ['accion', true, '"CANCELAR": el bot deja de escribirle por ese tracking. "REINTENTAR": se le vuelve a escribir.'],
  ['telefono', false, 'Solo con REINTENTAR: el teléfono corregido; se le escribe al número nuevo.'],
  ['motivo', false, 'Texto corto para la actividad del pedido (hasta 300 caracteres).'],
  ['simular', false, 'true: dice lo que haría sin cambiar nada.'],
];

/**
 * API 2: lo que contesta una orden, y como sacar cada respuesta en Postman
 * (con `codigo` entre comillas invertidas se pinta como codigo).
 */
const RESPUESTAS_FLUJO: Array<[string, string, string]> = [
  ['200', 'Hecho: «detalle» dice qué pasó. Con «simulado: true», es lo que haría.', 'Crea el pedido con la API 1 y luego `POST /api/v1/flujo` con `{ "tracking": "GSG-E-205", "accion": "CANCELAR", "simular": true }`.'],
  ['200 (sinCambios)', 'Ya estaba así: una repetición no le escribe dos veces al cliente.', 'Manda dos veces seguidas `{ "tracking": "GSG-E-205", "accion": "CANCELAR" }` (sin simular): la segunda trae `"sinCambios": true`.'],
  ['400', 'Falta el tracking, la acción no es CANCELAR o REINTENTAR, o el teléfono corregido no vale: «detalles» dice qué campo.', '`{ "tracking": "GSG-E-205", "accion": "BORRAR" }`, o `{ "accion": "CANCELAR" }` (sin tracking), o `"telefono": "12"` con REINTENTAR.'],
  ['401', 'Sin clave, o la clave no existe o fue revocada.', 'Quita la cabecera `X-API-Key`, o pon una clave inventada.'],
  ['403', 'La clave es válida pero no tiene permiso de recepción.', 'Usa una clave creada solo para leer (sin `entregas:gestionar`).'],
  ['404', 'No hay ningún pedido en curso con ese tracking (los de días anteriores se cierran con el día: mándalo como pedido nuevo).', '`{ "tracking": "NO-EXISTE-1", "accion": "CANCELAR" }`.'],
  ['405', 'Se usó GET u otro método: la API 2 solo acepta POST.', 'Cambia el método a `GET` en `/api/v1/flujo`.'],
  ['409', 'Ya está entregado, cancelado o terminado, o espera «Confirmar y enviar».', 'Cancela el pedido (`"accion": "CANCELAR"`, sin simular) y después manda `"accion": "REINTENTAR"` con el mismo tracking.'],
  ['429', 'Más de 120 llamadas por minuto con la misma clave (se cuentan junto con la API 1).', 'Con el Runner de Postman, repite la llamada 125 veces en menos de un minuto.'],
];

/** API 1: lo que contesta POST /api/v1/entregas, y como sacar cada respuesta en Postman. */
const RESPUESTAS: Array<[string, string, string]> = [
  ['201', 'Al menos un pedido quedó guardado. Cada uno trae su id real (el de GSGchat) y el estado de su primer mensaje.', '`POST /api/v1/entregas` con el JSON de ejemplo y un `tracking` nuevo (por ejemplo `GSG-E-205`).'],
  ['200', 'Todos ya estaban (repetidos): no se duplicó nada; vienen en «existentes» con su id.', 'Manda otra vez exactamente el mismo pedido, el mismo día.'],
  ['400', 'Datos faltantes o con formato incorrecto: «detalles» dice qué campo de qué pedido. No se guarda ninguno.', 'Quita `"telefono"` del pedido, pon `"telefono": "12"`, manda `{ "pedidos": [] }` o un JSON roto (sin cerrar una llave).'],
  ['400 (accion)', 'Se mandó una orden de la API 2 a la dirección de pedidos.', '`POST /api/v1/entregas` con `{ "tracking": "GSG-E-205", "accion": "CANCELAR" }`: dice que va en `/api/v1/flujo`.'],
  ['401', 'Sin clave, o la clave no es válida o fue revocada.', 'Quita la cabecera `X-API-Key`, pon una clave inventada, o usa una clave revocada.'],
  ['403', 'La clave es válida pero no tiene permiso de recepción (entregas:gestionar), o la tienda está suspendida.', 'Usa una clave creada solo para leer (sin `entregas:gestionar`).'],
  ['404', 'La ruta no existe (por ejemplo, con /tienda/<nombre> delante).', '`POST /tienda/<nombre>/api/v1/entregas` (la recepción no lleva nombre de tienda: la clave la decide).'],
  ['405', 'Método no permitido: los pedidos se mandan con POST (la cabecera Allow dice cuáles valen).', 'Cambia el método a `PUT` o `DELETE` en `/api/v1/entregas`.'],
  ['409', 'La clave está registrada en dos tiendas: no se sabe a cuál va.', 'No se provoca a propósito: solo pasa si la misma clave quedó en dos tiendas.'],
  ['413', 'El cuerpo pasa de 4 MiB: dividir los pedidos en varias llamadas (hasta 600 por llamada).', 'Manda un pedido con un campo de relleno de más de 4 MiB (más de 4 millones de letras).'],
  ['415', 'No es JSON: mandar Content-Type: application/json.', 'Cambia el Body a `Text` (o la cabecera `Content-Type: text/plain`).'],
  ['429', 'Más de 120 llamadas por minuto con la misma clave: esperar lo que dice Retry-After.', 'Con el Runner de Postman, repite la llamada 125 veces en menos de un minuto.'],
  ['503', 'La base de datos no responde: repetir la misma llamada (lo ya guardado no se duplica).', 'No se provoca desde Postman: solo pasa si la base de datos está caída.'],
  ['500', 'Error interno inesperado: repetir la misma llamada; queda en el registro del servidor.', 'No se provoca desde Postman: es un fallo del servidor.'],
];

export function gsgCourierPage(opts: { nombreNegocio: string; disponible: boolean; demo?: boolean }): string {
  const ejemplo = JSON.stringify(EJEMPLO_COURIER, null, 2);
  return appShell({ titulo: 'Nuestra API', subtitulo: 'El endpoint de GSGchat para GSG: dirección, claves, validación y recepciones',
    nombreNegocio: opts.nombreNegocio, demo: opts.demo,
    css: `.courier-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.courier-card{padding:24px;border:1px solid var(--borde);border-radius:var(--radio);background:var(--superficie);box-shadow:var(--sombra);min-width:0}.courier-card>label{display:block;margin:14px 0 6px}.courier-card h2{margin-top:0}.courier-card input,.courier-card textarea{width:100%;box-sizing:border-box}.courier-card textarea{min-height:300px;padding:14px;font:13px/1.6 var(--mono)}.clave-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.clave-field label{display:block;margin-bottom:8px;font-weight:600}.clave-field select,.clave-field input{width:100%}.clave-permisos{margin:20px 0;padding:18px;border:1px solid var(--borde);border-radius:12px}.clave-permisos-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.clave-permiso{display:flex;align-items:flex-start;gap:10px;padding:12px;background:var(--superficie-2);border-radius:8px;font-size:13px}.courier-card .clave-permiso input{width:auto;flex-shrink:0;margin-top:3px;accent-color:var(--primario)}.clave-secret-panel{background:var(--superficie-2);padding:20px;border:1px solid var(--borde);border-radius:12px;margin-bottom:18px}.courier-secret{display:block;padding:12px;background:var(--superficie);border-radius:8px}.courier-wide{grid-column:1/-1}.courier-actions{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}.courier-scroll{overflow-x:auto;border:1px solid var(--borde);border-radius:var(--radio-sm);margin:10px 0}.courier-scroll:empty{display:none}.courier-scroll:has(>p:only-child){border:0}.courier-card .na-apis{border:1px solid var(--borde);border-radius:var(--radio-sm);border-collapse:separate;border-spacing:0;overflow:hidden}.courier-card pre{white-space:pre-wrap;overflow-wrap:anywhere}.courier-secret{overflow-wrap:anywhere}.courier-card small{display:block;margin-top:8px}.api-num{display:inline-block;margin-right:8px;padding:2px 9px;border-radius:999px;background:var(--primario-suave);color:var(--primario);font-size:.78em;font-weight:700;vertical-align:middle;white-space:nowrap}.postman{margin:12px 0;padding:14px;border:1px dashed var(--borde);border-radius:12px}.postman h3{margin-top:0}.postman ol{margin:6px 0 8px;padding-left:20px}.postman li{margin:4px 0}.postman-url{overflow-wrap:anywhere}.api-json{padding:12px;border-radius:10px;background:var(--superficie-2);font:13px/1.5 monospace}.courier-status{padding:11px 14px;border-radius:var(--radio-sm);background:var(--superficie-2);border:1px solid var(--borde);margin:14px 0;font-size:13.5px}#np-flujo-form{display:grid;gap:6px}.np-check{display:flex;gap:8px;align-items:center}.courier-card .np-check input{width:auto}#np-flujo-resultado{white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px;overflow:auto}@media(max-width:800px){.courier-grid,.clave-form-grid,.clave-permisos-grid{grid-template-columns:1fr}}@media(max-width:640px){.courier-card{padding:16px}.courier-card .na-apis{display:block;overflow-x:auto}.courier-card .na-apis td:last-child{min-width:170px}.courier-card .na-apis code{white-space:nowrap}}
.na-pestanas .api-num{margin-right:0;font-size:12px}
.courier-grid{grid-template-columns:minmax(0,1fr);max-width:1100px}
.courier-grid>[data-na][hidden]{display:none}
.na-apis{margin:14px 0}.na-apis code{overflow-wrap:anywhere}
.na-clave{margin:6px 0 14px}
.courier-card h2{font-size:18px;margin-bottom:10px}.courier-cab{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;margin-bottom:14px}.courier-cab h2{margin-bottom:4px}.courier-cab p{margin:0}.courier-api{display:inline-block;font-size:11.5px;font-weight:700;padding:1px 7px;border-radius:999px;background:var(--primario-suave);color:var(--primario);margin-right:4px}@media(max-width:640px){.courier-cab{flex-direction:column}}.courier-card>h3{margin-top:22px}.courier-card>small{color:var(--texto-suave)}`,
    contenido: `<nav class="na-pestanas s-pestanas" aria-label="Nuestra API">
      <a href="#t-resumen" data-na="resumen">Resumen</a>
      <a href="#t-api1" data-na="api1"><span class="api-num">API 1</span>Pedidos</a>
      <a href="#t-api2" data-na="api2"><span class="api-num">API 2</span>Cancelar o reintentar</a>
      <a href="#t-claves" data-na="claves">Claves</a>
      <a href="#t-validar" data-na="validar">Probar y validar</a>
      <a href="#t-llamadas" data-na="llamadas">Últimas llamadas</a>
    </nav>
    <div class="courier-grid">
      <section class="courier-card courier-wide" data-na="resumen"><h2>GSG llama → GSGchat recibe → el sistema procesa</h2>
        <p>Estas son <b>nuestras dos APIs</b>, las que GSG llama: la <b>API 1</b> para mandarnos los pedidos y la <b>API 2</b> para pedirnos cancelar o reintentar uno. Cada una tiene su dirección; las dos usan la misma clave. Lo que GSGchat le manda o le pregunta a GSG está en <a href="/conexion-gsg">Conexión con GSG</a>.</p>
        ${opts.disponible ? '<p id="courier-estado" class="courier-status" role="status">Consultando claves y últimas recepciones…</p>' : '<p class="courier-status">El módulo de entregas no está disponible en este servidor.</p>'}
        <table class="na-apis"><thead><tr><th>API</th><th>Método</th><th>Dirección</th><th>Para qué</th></tr></thead><tbody>
          <tr><td><a href="#t-api1"><span class="api-num">API 1</span></a></td><td><span class="chip tono-azul sin-punto">POST</span></td><td><code>/api/v1/entregas</code></td><td>GSG nos manda los pedidos del día</td></tr>
          <tr><td><a href="#t-api2"><span class="api-num">API 2</span></a></td><td><span class="chip tono-azul sin-punto">POST</span></td><td><code>/api/v1/flujo</code></td><td>GSG nos pide cancelar o reintentar un pedido</td></tr>
        </tbody></table>
        <p class="na-clave">Las dos usan la misma clave en la cabecera <code>X-API-Key</code>. Se crea en <a href="#t-claves">Claves</a>. <a class="btn sm" href="/soporte#pruebas-api-gsg">Ver instrucciones de pruebas</a></p>
        <a href="/hoy">Ver pedidos recibidos</a> · <a href="/conexion-gsg">Conexión con GSG (lo que le enviamos)</a>
        <small>Con «Confirmar la lista de GSG» activado, los pedidos esperan aprobación en Números del día. Desactivado, el motor los procesa automáticamente.</small>
      </section>
      <section class="courier-card" id="api-1" data-na="api1"><h2><span class="api-num">API 1</span> Recibir pedidos</h2>
        <p>GSG nos manda los pedidos del día. Entrega esta dirección al programador de GSG Courier.</p>
        <label for="courier-url">Enviar pedidos con POST</label><input id="courier-url" readonly>
        <div class="courier-actions"><button class="btn" id="courier-copiar-url">Copiar dirección</button><button class="btn" id="courier-descargar">Descargar JSON de ejemplo</button></div>
        <p>Cuerpo: un pedido, una lista o <code>{ pedidos: [...] }</code>, hasta 600 por llamada. Un pedido repetido el mismo día no se duplica. <a href="#courier-campos">Campos</a> · <a href="#courier-respuestas">respuestas</a> · <a class="ver-manual" href="/soporte#pruebas-api-gsg">Ver instrucciones de pruebas</a></p>
        <a href="/api/v1/openapi.json" target="_blank" rel="noopener">Ver el OpenAPI</a> · <a href="/api/v1/openapi.json" download="contrato-gsgchat.json">Descargar el OpenAPI</a>
      </section>
      <section class="courier-card" id="api-2" data-na="api2"><h2><span class="api-num">API 2</span> Cancelar o reintentar un pedido</h2>
        <p>GSG nos pide dejar de escribirle a un tracking, o volver a escribirle porque ya corrigió los datos.</p>
        <label for="courier-url-2">Enviar con POST</label><input id="courier-url-2" readonly>
        <div class="courier-actions"><button class="btn" id="courier-copiar-url-2" type="button">Copiar dirección</button></div>
        <p>Misma clave que la API 1. <a class="ver-manual" href="/soporte#pruebas-api-gsg">Ver instrucciones de pruebas</a></p>
        <p>Para reintentar con el teléfono corregido: <code>{ "tracking": "GSG-E-205", "accion": "REINTENTAR", "telefono": "987654321" }</code></p>
        <div class="courier-scroll"><table><thead><tr><th>Campo</th><th>Obligatorio</th><th>Detalle</th></tr></thead><tbody>${CAMPOS_FLUJO.map(([json, obligatorio, detalle]) => `<tr><td><code>${escapeHtml(json)}</code></td><td>${obligatorio ? 'Sí' : 'No'}</td><td>${escapeHtml(detalle)}</td></tr>`).join('')}</tbody></table></div>
        <h3 id="respuestas-2">Respuestas</h3>
        <div class="courier-scroll"><table><thead><tr><th>HTTP</th><th>Significado</th></tr></thead><tbody>${RESPUESTAS_FLUJO.map(([c, t]) => `<tr><td><b>${escapeHtml(c)}</b></td><td>${escapeHtml(t)}</td></tr>`).join('')}</tbody></table></div>
        <h3>Probar</h3>
        <p>La misma lógica que cuando GSG llama a la API 2. Por defecto se simula: dice lo que haría sin tocar el pedido.</p>
        <form id="np-flujo-form" novalidate>
          <label for="np-tracking">Tracking</label><input id="np-tracking" autocomplete="off" placeholder="GSG-E-205" required>
          <label for="np-accion">Acción</label><select id="np-accion"><option value="REINTENTAR">REINTENTAR</option><option value="CANCELAR">CANCELAR</option></select>
          <label for="np-telefono">Teléfono corregido (opcional, solo REINTENTAR)</label><input id="np-telefono" type="tel" autocomplete="off" placeholder="987654321">
          <label class="np-check"><input id="np-simular" type="checkbox" checked> Simular: decir lo que haría sin cambiar el pedido</label>
          <div class="courier-actions"><button class="btn primario" id="np-flujo-enviar" type="submit" ${opts.disponible ? '' : 'disabled'}>Enviar</button></div>
        </form>
        <pre id="np-flujo-resultado" role="status" aria-live="polite"></pre>
      </section>
      <section class="courier-card courier-wide" data-na="claves"><h2>Claves API de GSGchat (para las dos APIs)</h2>
        <p>Administra el acceso de cada integración: la misma clave sirve para la API 1 y la API 2. El sistema guarda únicamente la huella de la clave.</p>
        <form id="courier-form"><div class="clave-form-grid"><div class="clave-field"><label for="courier-nombre">¿Para quién es esta clave?</label><input id="courier-nombre" required minlength="2" maxlength="80" autocomplete="off" placeholder="Ejemplo: GSG principal"></div>
        <div class="clave-field"><label for="courier-vigencia">Vencimiento</label><select id="courier-vigencia"><option value="nunca">No se acaba nunca</option><option value="7">En 7 días</option><option value="30">En 30 días</option><option value="90">En 90 días</option><option value="365">En 1 año (365 días)</option><option value="fecha">Digitar una fecha</option></select></div>
        <div class="clave-field" id="courier-fecha-campo" hidden><label for="courier-vence">Fecha y hora de vencimiento</label><input id="courier-vence" type="text" maxlength="16" placeholder="DD/MM/AAAA HH:mm" autocomplete="off" aria-describedby="courier-fecha-ayuda"><small id="courier-fecha-ayuda">Puedes escribir solo la fecha; vencerá a las 23:59. Se usa la hora local de tu navegador.</small></div></div>

        <div class="courier-actions"><button class="btn primario" id="courier-crear" type="submit" ${opts.disponible ? '' : 'disabled'}>Crear clave</button><button class="btn" id="courier-cancelar" type="button" hidden>Cancelar edición</button></div></form>
        <div id="courier-nueva" hidden class="clave-secret-panel"><h3 id="courier-secreto-titulo"></h3><p><strong>Guarda esta clave en un lugar seguro porque luego no la volverás a ver.</strong></p><p>Solo se muestra ahora. Si la pierdes, renueva la clave: la anterior dejará de funcionar.</p><code id="courier-secreto" class="courier-secret"></code><div class="courier-actions"><button class="btn" id="courier-copiar-clave">Copiar clave</button><button class="btn" id="courier-ocultar">Ocultar clave (ya la copié)</button></div></div>
        <div id="courier-claves" class="courier-scroll"></div><p id="courier-aviso" role="status" aria-live="polite"></p>
      </section>
      <section class="courier-card courier-wide" data-na="validar"><h2>Validar el formato de pedidos (API 1)</h2>
        <p>Pega el JSON de Courier. Esta prueba revisa campos, teléfonos y duplicados dentro del lote; no guarda pedidos ni envía WhatsApp.</p>
        <label for="courier-json">Pedidos en JSON</label><textarea id="courier-json" spellcheck="false">${escapeHtml(ejemplo)}</textarea>
        <div class="courier-actions"><button class="btn primario" id="courier-validar" ${opts.disponible ? '' : 'disabled'}>Validar sin encolar</button><button class="btn" id="courier-ejemplo">Restaurar ejemplo</button></div>
        <pre id="courier-validacion" role="status" aria-live="polite"></pre>
      </section>
      <section class="courier-card courier-wide" id="validar-2" data-na="validar"><h2>Validar el formato de órdenes (API 2)</h2>
        <p>Pega el JSON que mandaría GSG a la API 2. Revisa los campos y busca el pedido por su tracking; dice lo que haría <b>sin cambiar nada</b> (se valida siempre en modo simulado).</p>
        <label for="courier-json-2">Orden en JSON</label><textarea id="courier-json-2" spellcheck="false">${escapeHtml(JSON.stringify(EJEMPLO_FLUJO, null, 2))}</textarea>
        <div class="courier-actions"><button class="btn primario" id="courier-validar-2" type="button" ${opts.disponible ? '' : 'disabled'}>Validar sin cambiar nada</button><button class="btn" id="courier-ejemplo-2" type="button">Restaurar ejemplo</button></div>
        <pre id="courier-validacion-2" role="status" aria-live="polite"></pre>
      </section>
      <section class="courier-card courier-wide" data-na="llamadas"><div class="courier-cab"><div><h2>Últimas llamadas (API 1 y API 2)</h2><p class="muted">Lo que GSG nos envió: pedidos, órdenes de cancelar o reintentar, y las pruebas hechas desde esta pantalla.</p></div><button class="btn sm" id="courier-refrescar">Actualizar estado</button></div><div id="courier-bitacora" class="courier-scroll tablewrap"></div></section>
      <section class="courier-card courier-wide" id="courier-campos" data-na="api1"><h2>Campos que envía Courier (API 1)</h2><p>Obligatorios: tracking, empresa, cliente, telefono, metodoPago y montoCobrar. Si falta uno, la API responde 400 con el campo y el pedido. Los demás son opcionales; los textos admiten hasta 200 caracteres.</p><div class="courier-scroll"><table><thead><tr><th>Campo de Courier</th><th>Nombre JSON</th><th>Obligatorio</th><th>Detalle</th></tr></thead><tbody>${CAMPOS.map(([nombre, json, obligatorio, detalle]) => `<tr><td>${escapeHtml(nombre)}</td><td><code>${escapeHtml(json)}</code></td><td>${obligatorio ? 'Sí' : 'No'}</td><td>${escapeHtml(detalle)}</td></tr>`).join('')}</tbody></table></div><small>Campos anteriores que se siguen aceptando (fuera del contrato): ${CAMPOS_ANTERIORES.map((c) => escapeHtml(c)).join(', ')}.</small></section>
      <section class="courier-card courier-wide" id="courier-respuestas" data-na="api1"><h2>Respuestas de la recepción (API 1)</h2><p>Los errores vienen en JSON: <code>{ "ok": false, "codigo": "...", "error": "...", "detalles": [...] }</code>. Para probar respuestas concretas, sigue la guía de <a href="/soporte#pruebas-api-gsg">Soporte → Pruebas de Nuestra API</a>.</p><div class="courier-scroll"><table><thead><tr><th>HTTP</th><th>Significado</th></tr></thead><tbody>${RESPUESTAS.map(([c, t]) => `<tr><td><b>${escapeHtml(c)}</b></td><td>${escapeHtml(t)}</td></tr>`).join('')}</tbody></table></div></section>
    </div>`,
    script: String.raw`
(function () {
  var $ = function(id) { return document.getElementById(id); };
  var editando = null, ocupada = false;
  var ejemplo = $('courier-json').value;
  var endpoint = location.origin + '/api/v1/entregas';
  $('courier-url').value = endpoint;
  var endpoint2 = location.origin + '/api/v1/flujo';
  $('courier-url-2').value = endpoint2;
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
  $('courier-copiar-url-2').onclick = function() { copiar(endpoint2); };
  var ejemplo2 = $('courier-json-2').value;
  if ($('courier-descargar-2')) $('courier-descargar-2').onclick = function() {
    var url = URL.createObjectURL(new Blob([ejemplo2], {type:'application/json'}));
    var a = document.createElement('a'); a.href = url; a.download = 'orden-api2-ejemplo.json'; a.click(); URL.revokeObjectURL(url);
  };
  $('courier-ejemplo-2').onclick = function() { $('courier-json-2').value = ejemplo2; $('courier-validacion-2').textContent = ''; };
  $('courier-validar-2').onclick = async function() {
    var b = this; b.disabled = true;
    var cuerpo;
    try { cuerpo = JSON.parse($('courier-json-2').value); }
    catch(e) { $('courier-validacion-2').textContent = 'El texto no es un JSON válido: ' + e.message; b.disabled = false; return; }
    if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) { $('courier-validacion-2').textContent = 'La API 2 recibe un objeto: { "tracking": "...", "accion": "CANCELAR" | "REINTENTAR" }.'; b.disabled = false; return; }
    cuerpo.simular = true;
    try { var r = await api('/admin/entregas/flujo', 'POST', cuerpo); $('courier-validacion-2').textContent = 'Formato correcto · HTTP 200 · ' + (r.detalle || '') + '\nNo se cambió nada.\n\n' + JSON.stringify(r, null, 2); }
    catch(e) { $('courier-validacion-2').textContent = e.message + (e.datos ? '\n\n' + JSON.stringify(e.datos, null, 2) : ''); }
    finally { b.disabled = false; }
  };
  $('courier-copiar-clave').onclick = function() { copiar($('courier-secreto').textContent); };
  function ocultar() { $('courier-secreto').textContent = ''; $('courier-secreto-titulo').textContent = ''; $('courier-nueva').hidden = true; }
  $('courier-ocultar').onclick = ocultar;
  window.addEventListener('pagehide', ocultar);
  window.addEventListener('pageshow', function(e) { if (e.persisted) ocultar(); });
  function mostrar(r) { ocultar(); $('courier-secreto-titulo').textContent = 'Copia ahora la clave de «' + r.registro.nombre + '»'; $('courier-secreto').textContent = r.clave; $('courier-nueva').hidden = false; }
  function estadoClave(c) { return c.revocadaAt ? 'Revocada' : c.venceAt && new Date(c.venceAt) <= new Date() ? 'Vencida' : c.desactivadaAt ? 'Desactivada' : 'Activa'; }
  function fecha(f) { return f ? new Date(f).toLocaleString('es-PE') : 'No se acaba nunca'; }
  var calcularVencimiento = ${calcularVencimientoClave.toString()};
  function cambiarVigencia() { var manual = $('courier-vigencia').value === 'fecha'; $('courier-fecha-campo').hidden = !manual; $('courier-vence').required = manual; }
  $('courier-vigencia').onchange = cambiarVigencia;
  function cancelar() { editando = null; $('courier-form').reset(); cambiarVigencia(); $('courier-crear').textContent = 'Crear clave'; $('courier-cancelar').hidden = true; }
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
      $('courier-claves').innerHTML = claves.length ? '<table><thead><tr><th>Nombre / identificador</th><th>Creación / vencimiento</th><th>Último uso</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>' + claves.map(function(c) {
        var estado = estadoClave(c);
        return '<tr><td><b>' + esc(c.nombre) + '</b><br><small>' + esc(c.id) + '</small></td><td>' + esc(fecha(c.createdAt)) + '<br>' + esc(fecha(c.venceAt)) + '</td><td>' + esc(c.ultimoUsoAt ? fecha(c.ultimoUsoAt) : 'Nunca se usó') + '</td><td>' + estado + '</td><td>' + (c.revocadaAt ? '' : '<button class="btn sm" data-accion="estado" data-id="' + esc(c.id) + '" ' + (estado === 'Vencida' ? 'disabled' : '') + '>' + (c.desactivadaAt ? 'Activar' : 'Desactivar') + '</button> <button class="btn sm" data-accion="renovar" data-id="' + esc(c.id) + '">Renovar</button> <button class="btn sm" data-accion="editar" data-id="' + esc(c.id) + '">Editar</button> ') + '<button class="btn sm peligro" data-accion="eliminar" data-id="' + esc(c.id) + '">Eliminar</button></td></tr>';
      }).join('') + '</tbody></table>' : '<p>No hay claves creadas.</p>';
      $('courier-claves').querySelectorAll('[data-accion]').forEach(function(b) {
        b.onclick = async function() {
          if (ocupada) return;
          var c = claves.find(function(c) { return c.id === b.dataset.id; });
          if (b.dataset.accion === 'editar') {
            editando = c.id; $('courier-nombre').value = c.nombre;
            $('courier-vigencia').value = c.venceAt ? 'fecha' : 'nunca';
            var vencimiento = c.venceAt ? new Date(c.venceAt) : null;
            var dos = function(n) { return String(n).padStart(2, '0'); };
            $('courier-vence').value = vencimiento ? dos(vencimiento.getDate()) + '/' + dos(vencimiento.getMonth()+1) + '/' + vencimiento.getFullYear() + ' ' + dos(vencimiento.getHours()) + ':' + dos(vencimiento.getMinutes()) : '';
            cambiarVigencia();

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
        var llamadas = (gsg.bitacora || []).filter(function(l) { return /^POST \/api\/v1\/(entregas|flujo)(?:\?|\s|$)/.test(l.que) || /\/admin\/entregas\/flujo/.test(l.que); });
        var cualApi = function(l) { return /\/flujo/.test(l.que) ? 'API 2 · Cancelar o reintentar' : 'API 1 · Recibir pedidos'; };
        $('courier-bitacora').innerHTML = llamadas.length ? '<table><thead><tr><th>Fecha</th><th>API</th><th>Respuesta</th><th>Resultado</th><th>Origen</th></tr></thead><tbody>' + llamadas.map(function(l) { var st = Number(l.status) || 0; var tono = st >= 500 ? 'rojo' : st >= 400 ? 'ambar' : st ? 'verde' : 'gris'; var api2 = /\/flujo/.test(l.que); return '<tr><td class="nowrap suave">' + esc(new Date(l.en).toLocaleString('es-PE')) + '</td><td class="nowrap"><span class="courier-api">' + (api2 ? 'API 2' : 'API 1') + '</span> ' + esc(cualApi(l).replace(/^API \d · /, '')) + '</td><td><span class="chip tono-' + tono + '">' + esc(l.status) + '</span></td><td>' + esc(l.resultado) + '</td><td class="suave">' + esc(l.quien) + (/\/admin\//.test(l.que) ? ' <span class="chip tono-azul sin-punto">prueba</span>' : '') + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="vacio compacto"><h3>Todavía no hay llamadas</h3><p>Aparecerán aquí cuando GSG llame a la API 1 o a la API 2.</p></div>';
        if (window.filtroDeTabla) window.filtroDeTabla($('courier-bitacora'));
        if (estado && llamadas.some(function(l) { return l.status === 201; })) estado.textContent = activas.length ? 'Recepción comprobada: ya se crearon pedidos desde la API.' : 'Hay recepciones anteriores; crea una clave activa para seguir recibiendo.';
      } catch(e) { $('courier-bitacora').textContent = 'Historial no disponible: ' + e.message; }
    } catch(e) { aviso(e.message); if ($('courier-estado')) $('courier-estado').textContent = 'No se pudo consultar el estado.'; }
  }
  $('courier-form').onsubmit = async function(e) {
    e.preventDefault(); if (ocupada) return;


    var venceAt;
    try { venceAt = calcularVencimiento($('courier-vigencia').value, $('courier-vence').value); } catch(e) { aviso(e.message); return; }
    var body = {nombre:$('courier-nombre').value.trim(), venceAt:venceAt};
    if (!editando) body.permisos = ['entregas:gestionar', 'entregas:leer'];
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
  $('np-flujo-form').onsubmit = async function(e) {
    e.preventDefault();
    var cuerpo = { tracking: $('np-tracking').value.trim(), accion: $('np-accion').value, simular: $('np-simular').checked };
    if ($('np-telefono').value.trim()) cuerpo.telefono = $('np-telefono').value.trim();
    if (!cuerpo.simular && !(await confirmarDialogo({ titulo: cuerpo.accion === 'CANCELAR' ? 'Cancelar el pedido de verdad' : 'Reintentar de verdad', texto: 'No es una simulación: ' + (cuerpo.accion === 'CANCELAR' ? 'el pedido ' + cuerpo.tracking + ' se cancelará.' : 'al cliente de ' + cuerpo.tracking + ' se le volverá a escribir.'), boton: 'Enviar', peligro: cuerpo.accion === 'CANCELAR' }))) return;
    var b = $('np-flujo-enviar'); b.disabled = true;
    $('np-flujo-resultado').textContent = 'Enviando…';
    try { var r = await api('/admin/entregas/flujo', 'POST', cuerpo); $('np-flujo-resultado').textContent = 'HTTP 200 · ' + (r.detalle || '') + '\n\n' + JSON.stringify(r, null, 2); }
    catch(err) { $('np-flujo-resultado').textContent = err.message + (err.datos ? '\n\n' + JSON.stringify(err.datos, null, 2) : ''); }
    finally { b.disabled = false; cargar(); }
  };
  cargar();
  /* Pestañas: #t-<pestaña>, o el ancla de un bloque (#courier-campos) abre la suya. */
  function mostrarPestana() {
    var h = location.hash.slice(1), pestana = 'resumen', destino = null;
    if (h.indexOf('t-') === 0) pestana = h.slice(2);
    else if (h) { destino = document.getElementById(h); var dueno = destino && destino.closest('[data-na]'); if (dueno) pestana = dueno.getAttribute('data-na'); }
    if (!document.querySelector('.na-pestanas a[data-na="' + pestana + '"]')) pestana = 'resumen';
    document.querySelectorAll('.courier-grid > [data-na]').forEach(function (s) { s.hidden = s.getAttribute('data-na') !== pestana; });
    document.querySelectorAll('.na-pestanas a[data-na]').forEach(function (a) {
      var activa = a.getAttribute('data-na') === pestana;
      a.classList.toggle('activa', activa);
      if (activa) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (destino && destino.scrollIntoView) destino.scrollIntoView({ block: 'start' }); else if (window.scrollTo) window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', mostrarPestana);
  mostrarPestana();
})();`,
  });
}
