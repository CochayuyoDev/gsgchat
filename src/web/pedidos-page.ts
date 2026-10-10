import { appShell } from './shell.js';
import { BANDEJA_MENSAJES_CSS, BANDEJA_MENSAJES_JS, bandejaMensajesHtml } from './bandeja-mensajes.js';
import { NUMEROS_REPORTADOS_CSS, NUMEROS_REPORTADOS_JS, numerosReportadosHtml } from './numeros-reportados.js';
import { CENTROS_DISTRITOS } from '../entregas/distritos-centro.js';

const escHtml = (v: string): string => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * La tabla del horario aproximado de llegada por distrito: se agregan,
 * cambian y quitan filas; se guarda con el resto de los ajustes.
 */
const HORARIOS_DISTRITO_HTML = `<fieldset class="horarios-distrito"><legend>Horario aproximado de llegada por distrito</legend><p class="muted">Al cliente se le dice, por ejemplo, «Horario aproximado de llegada para Ancón: de 6 a 8 de la noche». Manda sobre el horario general; si GSG manda una ventana para el pedido, se usa la de GSG.</p><table><thead><tr><th scope="col">Distrito</th><th scope="col">Desde</th><th scope="col">Hasta</th><th scope="col" aria-label="Quitar"></th></tr></thead><tbody id="horarios-distrito"></tbody></table><button type="button" class="btn" id="agregar-horario">Agregar distrito</button><datalist id="lista-distritos">${Object.keys(CENTROS_DISTRITOS).map((d) => `<option value="${escHtml(d)}">`).join('')}</datalist></fieldset>`;

/** El flujo de courier termina en la ubicación y confirmación del cliente. */
export function pedidosPage(opts: { disponible: boolean; demo: boolean; nombreNegocio: string; numeros?: boolean; etapa?: string }): string {
  const titulo = 'Pedidos GSG';
  const contenido = `<div class="pedidos">
    <p class="muted">Recibe los pedidos, solicita la ubicación y confirma con el cliente.</p>
    <div id="pedidos-error" role="alert" class="hidden"></div>
    <div id="reportes-gsg" class="tarjeta" role="status"></div>
    <div id="envios-pendientes" class="tarjeta hidden"></div>
    <div class="acciones"><button class="btn" id="actualizar">Actualizar</button><a class="btn" href="/mapa">Ver ubicaciones</a><a class="btn" href="/chat">Abrir chats</a></div>
    <div class="filtros"><label>Buscar <input id="buscar" type="search" placeholder="Cliente, teléfono o pedido"></label><label>Estado <select id="filtro"><option value="todos">Todos</option><option value="por_confirmar_envio">Por confirmar el envío</option><option value="falta_ubicacion">Falta ubicación</option><option value="falta_confirmar">Falta confirmar</option><option value="contactados">Ubicación registrada</option><option value="necesita">Necesitan atención</option><option value="cancelada">Cancelados</option></select></label><span id="total" class="muted" aria-live="polite"></span></div>
    <div id="lista-pedidos" aria-live="polite">Cargando pedidos…</div>
    ${bandejaMensajesHtml()}
    ${numerosReportadosHtml()}
    <details class="tarjeta" id="caja-pegar"><summary>Cargar pedidos</summary><p class="muted">Pega una lista con teléfono, nombre y referencia, una fila por cliente.</p><textarea id="lote" rows="5" placeholder="telefono;nombre;referencia"></textarea><button class="btn" id="cargar-lote">Cargar lista</button><span id="resultado-lote" role="status"></span></details>
    <details class="tarjeta" id="ajustes"><summary>Ajustes de ubicación y confirmación</summary><form id="ajustes-form"><div class="filtros"><label>Desde <input type="time" id="desde" required></label><label>Hasta <input type="time" id="hasta" required></label><label>Horario extendido <input type="time" id="extendido" required></label><label>WhatsApp de soporte <input id="soporte"></label></div>${HORARIOS_DISTRITO_HTML}<label>Solicitud de ubicación<textarea id="texto-ubicacion" rows="4" maxlength="1500"></textarea></label><label>Ubicación registrada<textarea id="texto-registrada" rows="4" maxlength="1500"></textarea></label><label>Solicitud de confirmación<textarea id="texto-confirmacion" rows="4" maxlength="1500"></textarea></label><button class="btn" type="submit">Guardar ajustes</button><span id="ajustes-resultado" role="status"></span></form></details>
  </div>`;
  const script = String.raw`
var DISPONIBLE = ${JSON.stringify(opts.disponible)};
var ETAPA = ${JSON.stringify(opts.etapa ?? 'todos')};
var filas = [], envios = {}, resumen = null, ocupada = false, ajustesEditados = false;
function $(id) { return document.getElementById(id); }
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
async function api(url, opciones) {
  opciones = opciones || {};
  var r = await fetch(url, { method: opciones.method || 'GET', credentials: 'same-origin', headers: {'content-type':'application/json'}, body: opciones.body === undefined ? undefined : JSON.stringify(opciones.body) });
  var j = await r.json().catch(function(){ return {}; });
  if (!r.ok) throw new Error(j.error || ('No se pudo completar la petición (' + r.status + ').'));
  return j;
}
function toast(texto) { $('pedidos-error').textContent = texto; $('pedidos-error').classList.remove('hidden'); }
function etapa(e) {
  if (e.estado === 'cancelada') return 'cancelada';
  if (e.envioRetenidoAt) return 'por_confirmar_envio';
  if (e.requiereHumano || e.estado === 'incidencia') return 'necesita';
  if (e.ubicacionEstado === 'pendiente') return 'falta_ubicacion';
  if (e.confirmacionEstado === 'pendiente' || e.confirmacionEstado === 'pedida') return 'falta_confirmar';
  return 'contactados';
}
function visibles() { var q=$('buscar').value.trim().toLowerCase(), f=$('filtro').value; return filas.filter(function(e) { return (f==='todos'||etapa(e)===f) && (!q||[e.nombre,e.phone,e.referencia,e.distrito].join(' ').toLowerCase().includes(q)); }); }
var etiquetas = { por_confirmar_envio:'Por confirmar el envío', falta_ubicacion:'Falta ubicación', falta_confirmar:'Falta confirmar', contactados:'Ubicación registrada', necesita:'Necesita atención', cancelada:'Cancelado' };
/* Si la ubicación ya salió hacia GSG: el estado del último envío de su tracking. */
function envioGsg(e) {
  if (e.lat == null || e.lng == null) return '';
  var r = envios[(e.datosEnvio && e.datosEnvio.tracking) || e.referencia];
  var linea = !r ? '<span class="chip">Sin enviar a GSG</span> <span class="muted">Tiene ubicación pero no salió hacia GSG: usa «Enviar a GSG».</span>'
    : r.estado === 'enviado' ? '<span class="chip">Enviado a GSG</span> <span class="muted">'+esc(new Date(r.enviadoEn||r.en).toLocaleString('es-PE'))+'</span>'
    : '<span class="chip">'+(r.estado === 'fallido' ? 'Falló el envío a GSG' : 'Pendiente de enviar a GSG')+'</span>'+(r.error?' <span class="muted">Error: '+esc(r.error)+'</span>':'');
  return '<p id="gsg-'+e.id+'">'+linea+'</p>';
}
/* El cliente cambió su ubicación: «Ubicación registrada» con la marca y la hora. */
function marcaCambio(e) {
  if (!e.ubicacionCambiadaAt) return '';
  var texto = e.cambioUbicacion || 'cambió su ubicación';
  return '<span class="chip chip-cambio" title="El cliente pidió cambiar su ubicación y mandó otra">'+esc(texto.charAt(0).toUpperCase()+texto.slice(1))+'</span>';
}
function pintar() {
  var lista=visibles(); $('total').textContent=lista.length+' pedidos';
  $('lista-pedidos').innerHTML=lista.length?lista.map(function(e){
    var mapa=e.lat!=null&&e.lng!=null?'https://www.google.com/maps?q='+encodeURIComponent(e.lat+','+e.lng):null;
    return '<article class="pedido tarjeta"><b>'+esc(e.nombre||e.phone)+'</b><span class="chip">'+esc(etiquetas[etapa(e)])+'</span>'+marcaCambio(e)+'<p>'+esc(e.referencia)+' · '+esc(e.phone)+(e.distrito?' · '+esc(e.distrito):'')+'</p>'+(e.direccion?'<p class="muted">'+esc(e.direccion)+'</p>':'')+envioGsg(e)+(e.solicitud?'<p class="muted">Intentos de ubicación: '+esc(e.solicitud.intentos)+' / 3'+(e.incidencia==='sin_respuesta'?' · Pendiente sin respuesta':'')+'</p>':'')+'<div class="acciones"><a class="btn" href="/chat?phone='+encodeURIComponent(e.phone)+'">Chat</a>'+(mapa?'<a class="btn" href="'+esc(mapa)+'" target="_blank" rel="noopener">Ver ubicación</a>':'')+'<button class="btn" data-detalle="'+e.id+'">Detalle</button>'+(e.lat!=null&&e.lng!=null?'<button class="btn" data-gsg="'+e.id+'">Enviar a GSG</button>':'')+(etapa(e)==='por_confirmar_envio'?'<button class="btn" data-enviar="'+e.id+'">Confirmar y enviar</button>':'')+(etapa(e)==='falta_confirmar'?'<button class="btn" data-confirmar="'+e.id+'">Confirmar</button>':'')+(e.estado!=='cancelada'&&e.estado!=='entregada'?'<button class="btn" data-cancelar="'+e.id+'">Cancelar</button>':'')+'</div><div id="detalle-'+e.id+'" class="detalle"></div></article>';
  }).join(''):'<div class="tarjeta muted">No hay pedidos en este filtro.</div>';
  document.querySelectorAll('[data-gsg]').forEach(function(b){b.onclick=async function(){b.disabled=true;var caja=$('gsg-'+b.dataset.gsg);try{var r=await api('/admin/entregas/'+b.dataset.gsg+'/enviar-gsg',{method:'POST',body:{}});var txt=r.ok?'Enviado a GSG: '+JSON.stringify(r.cuerpo):'No se pudo enviar a GSG. Error: '+(r.error||'desconocido');if(caja)caja.textContent=txt;toast(txt);}catch(e){toast('No se pudo enviar a GSG. Error: '+e.message);}finally{b.disabled=false;}};});
  document.querySelectorAll('[data-enviar]').forEach(function(b){b.onclick=function(){confirmarEnvio(b,{ids:[Number(b.dataset.enviar)]});};});
  document.querySelectorAll('[data-detalle]').forEach(function(b){b.onclick=async function(){try { var d=await api('/admin/entregas/'+b.dataset.detalle); $('detalle-'+b.dataset.detalle).innerHTML=(d.eventos||[]).map(function(ev){return '<p>'+esc(ev.detalle)+'</p>';}).join('')||'<p>Sin actividad adicional.</p>'; } catch(e){toast(e.message);} };});
  document.querySelectorAll('[data-confirmar]').forEach(function(b){b.onclick=function(){accionIndividual(b.dataset.confirmar,'confirmar',{confirmada:true});};});
  document.querySelectorAll('[data-cancelar]').forEach(function(b){b.onclick=async function(){var motivo=await pedirDato({titulo:'Cancelar pedido',etiqueta:'Motivo',boton:'Cancelar pedido'}); if(motivo)accionIndividual(b.dataset.cancelar,'cancelar',{motivo:motivo});};});
  var pendientes=resumen&&resumen.porConfirmarEnvio?resumen.porConfirmarEnvio.total:0;
  $('envios-pendientes').classList.toggle('hidden',!pendientes);
  $('envios-pendientes').innerHTML=pendientes?'<b>'+pendientes+(pendientes===1?' pedido espera':' pedidos esperan')+' autorización de envío.</b><p><button class="btn" id="enviar-todos">Confirmar y enviar a todos ('+pendientes+')</button></p>':'';
  if(pendientes)$('enviar-todos').onclick=function(){confirmarEnvio(this,{todos:true});};
}
async function confirmarEnvio(boton,body) { boton.disabled=true; try { var r=await api('/admin/entregas/confirmar-envio',{method:'POST',body:body}); toast(r.detalle||r.aviso||'Envío confirmado.'); await cargar(); }catch(e){toast(e.message); boton.disabled=false;} }
async function accionIndividual(id,accion,body) { try { await api('/admin/entregas/'+id+'/'+accion,{method:'POST',body:body}); await cargar(); }catch(e){toast(e.message);} }
function pintarReportes() { var c=resumen.gsgCola; var g=resumen.gsg; $('reportes-gsg').textContent = 'Reportes a GSG: '+(c?c.enviado+' enviados · '+c.pendiente+' pendientes · '+c.fallido+' fallidos':'no disponibles')+(!g||!g.conectada?' · Configura el backend de GSG en Conexión para enviar las ubicaciones.':''); }
function filaHorario(f) { var tr=document.createElement('tr'); tr.innerHTML='<td><input list="lista-distritos" class="hd-distrito" aria-label="Distrito" required maxlength="60" value="'+esc(f.distrito||'')+'"></td><td><input type="time" class="hd-desde" aria-label="Desde" required value="'+esc(f.desde||'')+'"></td><td><input type="time" class="hd-hasta" aria-label="Hasta" required value="'+esc(f.hasta||'')+'"></td><td><button type="button" class="btn" data-quitar-horario>Quitar</button></td>'; tr.querySelector('[data-quitar-horario]').onclick=function(){tr.remove();ajustesEditados=true;}; $('horarios-distrito').appendChild(tr); }
function pintarHorarios(lista) { $('horarios-distrito').innerHTML=''; (lista||[]).forEach(filaHorario); }
function leerHorarios() { return Array.prototype.map.call($('horarios-distrito').querySelectorAll('tr'),function(tr){return {distrito:tr.querySelector('.hd-distrito').value.trim(),desde:tr.querySelector('.hd-desde').value,hasta:tr.querySelector('.hd-hasta').value};}); }
function pintarAjustes(a) { if(ajustesEditados||!a)return; var defecto=resumen.textos?resumen.textos.porDefecto:{}; $('desde').value=a.horarioEntregas.desde; $('hasta').value=a.horarioEntregas.hasta; $('extendido').value=a.horarioEntregas.extendidoHasta; pintarHorarios(a.horariosPorDistrito); $('soporte').value=a.soporte.whatsapp||''; $('texto-ubicacion').value=a.textos.solicitudUbicacion||defecto.solicitudUbicacion||''; $('texto-registrada').value=a.textos.ubicacionRegistrada||defecto.ubicacionRegistrada||''; $('texto-confirmacion').value=a.textos.confirmacion||defecto.confirmacion||''; }
async function cargar(){if(ocupada||!DISPONIBLE)return; ocupada=true; try{resumen=await api('/admin/entregas');filas=resumen.entregas||[];envios={};try{(await api('/admin/gsg/envios?limit=500')).items.slice().reverse().forEach(function(r){if(r.cuerpo&&r.cuerpo.tracking)envios[r.cuerpo.tracking]=r;});}catch(e){}pintar();pintarReportes();pintarAjustes(resumen.ajustes);if(typeof cargarBandejaMensajes==='function')await cargarBandejaMensajes();if(typeof cargarNumerosReportados==='function')await cargarNumerosReportados();}catch(e){toast(e.message);}finally{ocupada=false;}}
$('buscar').value=new URLSearchParams(location.search).get('buscar')||'';
var filtroViejo = new URLSearchParams(location.search).get('filtro');
$('filtro').value = ({ faltaUbicacion: 'falta_ubicacion', faltaConfirmacion: 'falta_confirmar', incidencia: 'necesita' })[filtroViejo] || ETAPA;
if(!$('filtro').value)$('filtro').value='todos';
$('buscar').oninput=pintar; $('filtro').onchange=pintar; $('actualizar').onclick=cargar;
$('cargar-lote').onclick=async function(){this.disabled=true;try{var r=await api('/admin/entregas/cargar-lista',{method:'POST',body:{texto:$('lote').value}});$('resultado-lote').textContent=(r.creadas||0)+' pedidos cargados';await cargar();}catch(e){toast(e.message);}finally{this.disabled=false;}};
$('ajustes-form').oninput=function(){ajustesEditados=true;};
$('agregar-horario').onclick=function(){filaHorario({});ajustesEditados=true;};
$('ajustes-form').onsubmit=async function(ev){ev.preventDefault();var b=this.querySelector('button[type=submit]');b.disabled=true;try{await api('/admin/entregas/ajustes',{method:'POST',body:{horarioEntregas:{desde:$('desde').value,hasta:$('hasta').value,extendidoHasta:$('extendido').value},horariosPorDistrito:leerHorarios(),soporte:{whatsapp:$('soporte').value},textos:{solicitudUbicacion:$('texto-ubicacion').value,ubicacionRegistrada:$('texto-registrada').value,confirmacion:$('texto-confirmacion').value}}});ajustesEditados=false;$('ajustes-resultado').textContent='Ajustes guardados';await cargar();}catch(e){toast(e.message);}finally{b.disabled=false;}};
${BANDEJA_MENSAJES_JS}
${NUMEROS_REPORTADOS_JS}
if(!DISPONIBLE)$('lista-pedidos').textContent='Los pedidos no están disponibles en este arranque.';
if(location.hash==='#ajustes')$('ajustes').open=true;
api('/admin/yo').then(function(yo){$('ajustes').hidden=!yo||yo.rol!=='admin';}).catch(function(){$('ajustes').hidden=true;});
cargar();setInterval(function(){if(!document.hidden&&!document.querySelector('.dlg-fondo'))cargar();},10000);
`;
  return appShell({ titulo, subtitulo: 'Pedidos, ubicación y confirmación', contenido, script, nombreNegocio: opts.nombreNegocio, demo: opts.demo, icono: '📋', css: `${BANDEJA_MENSAJES_CSS}\n${NUMEROS_REPORTADOS_CSS}\n.pedidos{display:grid;gap:20px;max-width:1300px;margin:auto}.acciones,.filtros{display:flex;flex-wrap:wrap;gap:12px;align-items:center}.filtros label{display:grid;gap:6px}.horarios-distrito{border:1px solid var(--borde);border-radius:8px;padding:12px;margin:12px 0;display:grid;gap:8px;min-width:0}.horarios-distrito table{width:100%;border-collapse:collapse}.horarios-distrito th{text-align:left;font-weight:600;padding:4px}.horarios-distrito td{padding:4px}.horarios-distrito input{width:100%;box-sizing:border-box}.horarios-distrito .btn{justify-self:start}.pedido p{margin:8px 0}.pedido .chip{float:right}.pedido .chip-cambio{margin-right:8px;background:var(--ambar-suave)}.pedidos input:not([type=checkbox]),.pedidos select,.pedidos textarea{padding:10px;border:1px solid var(--borde);border-radius:8px;background:var(--superficie);color:var(--texto)}.pedidos textarea{display:block;width:100%;margin:10px 0}.pedidos .hidden{display:none}#pedidos-error{padding:12px;background:var(--ambar-suave);border-radius:8px}.tarjeta{padding:18px}.detalle{margin-top:10px}summary{cursor:pointer;font-weight:600}#lista-pedidos{display:grid;gap:12px}` });
}
