import { appShell } from './shell.js';
import { BANDEJA_MENSAJES_CSS, BANDEJA_MENSAJES_JS, bandejaMensajesHtml } from './bandeja-mensajes.js';
import { NUMEROS_REPORTADOS_CSS, NUMEROS_REPORTADOS_JS, numerosReportadosHtml } from './numeros-reportados.js';
import { CENTROS_DISTRITOS } from '../entregas/distritos-centro.js';
import { PESTANAS_PEDIDOS_CSS, PESTANAS_PEDIDOS_JS, pestanasPedidosHtml } from './pestanas-pedidos.js';

const escHtml = (v: string): string => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * La tabla del horario aproximado de llegada por distrito: se agregan,
 * cambian y quitan filas; se guarda con el resto de los ajustes.
 */
const HORARIOS_DISTRITO_HTML = `<fieldset class="horarios-distrito"><legend>Horario aproximado de llegada por distrito</legend><p class="muted">Al cliente se le dice, por ejemplo, «Horario aproximado de llegada para Ancón: de 6 a 8 de la noche». Manda sobre el horario general; si GSG manda una ventana para el pedido, se usa la de GSG.</p><table><thead><tr><th scope="col">Distrito</th><th scope="col">Desde</th><th scope="col">Hasta</th><th scope="col" aria-label="Quitar"></th></tr></thead><tbody id="horarios-distrito"></tbody></table><button type="button" class="btn sm" id="agregar-horario">Agregar distrito</button><datalist id="lista-distritos">${Object.keys(CENTROS_DISTRITOS).map((d) => `<option value="${escHtml(d)}">`).join('')}</datalist></fieldset>`;

/** El flujo de courier termina en la ubicación y confirmación del cliente. */
export function pedidosPage(opts: { disponible: boolean; demo: boolean; nombreNegocio: string; numeros?: boolean; etapa?: string }): string {
  const titulo = 'Pedidos GSG';
  const contenido = `<div class="pedidos">
    ${pestanasPedidosHtml()}
    <div id="pedidos-error" role="alert" class="s-alerta warn hidden"></div>
    <div id="envios-pendientes" class="tarjeta hidden"></div>
    <div class="pp-barra tarjeta"><div class="pp-contadores" id="contadores" role="group" aria-label="Filtrar por estado"></div><div class="pp-fila"><label class="pp-buscar"><span class="sr">Buscar</span><input id="buscar" type="search" placeholder="Buscar cliente, teléfono o pedido"></label><select id="filtro" class="sr" aria-label="Estado"><option value="todos">Todos</option><option value="por_confirmar_envio">Por confirmar el envío</option><option value="falta_ubicacion">Falta ubicación</option><option value="falta_confirmar">Falta confirmar</option><option value="contactados">Ubicación registrada</option><option value="necesita">Necesitan atención</option><option value="cancelada">Cancelados</option></select><span id="total" class="muted" aria-live="polite"></span><span class="pp-sep"></span><a class="btn sm" href="/chat">Abrir chats</a><button class="btn sm" id="actualizar">Actualizar</button></div></div>
    <p id="reportes-gsg" class="pp-reportes" role="status"></p>
    <div id="lista-pedidos" class="pp-lista" aria-live="polite" aria-busy="true">${'<div class="pedido pp-esqueleto" aria-hidden="true"><div><span class="esqueleto linea media"></span><span class="esqueleto linea corta"></span></div><div><span class="esqueleto linea corta"></span><span class="esqueleto linea"></span></div><div class="p-acciones"><span class="esqueleto" style="width:180px;height:30px"></span></div></div>'.repeat(4)}<span class="sr">Cargando pedidos…</span></div>
    ${bandejaMensajesHtml()}
    ${numerosReportadosHtml()}
    <details class="tarjeta" id="caja-pegar"><summary>Cargar pedidos</summary><p class="muted">Pega una lista con teléfono, nombre y referencia, una fila por cliente.</p><textarea id="lote" rows="5" placeholder="telefono;nombre;referencia"></textarea><div class="barra-guardar"><span id="resultado-lote" class="izq muted" role="status"></span><button class="btn primario" id="cargar-lote">Cargar lista</button></div></details>
    <details class="tarjeta" id="ajustes"><summary>Horarios de entrega y textos</summary><form id="ajustes-form"><div class="filtros"><label>Desde <input type="time" id="desde" required></label><label>Hasta <input type="time" id="hasta" required></label><label>Horario extendido <input type="time" id="extendido" required></label><label>WhatsApp de soporte <input id="soporte"></label></div>${HORARIOS_DISTRITO_HTML}<label>Solicitud de ubicación<textarea id="texto-ubicacion" rows="4" maxlength="1500"></textarea></label><label>Ubicación registrada<textarea id="texto-registrada" rows="4" maxlength="1500"></textarea></label><label>Solicitud de confirmación<textarea id="texto-confirmacion" rows="4" maxlength="1500"></textarea></label><div class="barra-guardar"><span id="ajustes-resultado" class="izq muted" role="status"></span><button class="btn primario" type="submit">Guardar ajustes</button></div></form></details>
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
  if (r.status === 401) { location.href = '/login?next=' + encodeURIComponent(location.pathname + location.hash); throw new Error('Inicia sesión.'); }
  var j = await r.json().catch(function(){ return {}; });
  if (!r.ok) { var e = new Error(j.error || (r.status === 404 ? 'No existe (o ya no).' : r.status === 402 ? 'Tu membresía no cubre esto.' : 'No se pudo completar la petición (' + r.status + ').')); e.status = r.status; e.codigo = j.codigo || null; e.ir = j.ir || null; throw e; }
  return j;
}
var relojAviso = null;
/* El aviso de arriba: con su botón para cerrarlo, y se va solo a los 10 s. */
function toast(texto) {
  var caja = $('pedidos-error');
  caja.innerHTML = '<span>' + esc(texto) + '</span><button type="button" class="pp-cerrar" aria-label="Cerrar el aviso">×</button>';
  caja.classList.remove('hidden');
  caja.querySelector('.pp-cerrar').onclick = function () { caja.classList.add('hidden'); };
  clearTimeout(relojAviso);
  relojAviso = setTimeout(function () { caja.classList.add('hidden'); }, 10000);
}
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
var tonos = { por_confirmar_envio:'azul', falta_ubicacion:'ambar', falta_confirmar:'ambar', contactados:'verde', necesita:'rojo', cancelada:'gris' };
var ORDEN_CONTADORES = [['todos','Todos'],['falta_ubicacion','Falta ubicación'],['contactados','Ubicación registrada'],['necesita','Necesitan atención'],['por_confirmar_envio','Por confirmar el envío'],['falta_confirmar','Falta confirmar'],['cancelada','Cancelados']];
/* Los contadores por estado son el filtro: un clic y la lista muestra solo esos. */
function pintarContadores() {
  var cuenta = { todos: filas.length };
  filas.forEach(function(e){ var k = etapa(e); cuenta[k] = (cuenta[k] || 0) + 1; });
  var actual = $('filtro').value;
  $('contadores').innerHTML = ORDEN_CONTADORES.filter(function(c){ return c[0] === 'todos' || cuenta[c[0]] || c[0] === actual; }).map(function(c){
    return '<button type="button" class="pp-contador tono-' + (tonos[c[0]] || 'neutro') + (c[0] === actual ? ' activo' : '') + '" data-etapa="' + c[0] + '" aria-pressed="' + (c[0] === actual) + '"><span>' + esc(c[1]) + '</span><b>' + (cuenta[c[0]] || 0) + '</b></button>';
  }).join('');
  document.querySelectorAll('[data-etapa]').forEach(function(b){ b.onclick = function(){ $('filtro').value = b.dataset.etapa; pintar(); }; });
}
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
function historialUbicacion(e) {
  if (!e.solicitud) return '';
  var recibida = e.ubicacionEstado === 'recibida';
  return '<p class="muted">' + (recibida ? 'Mensajes anteriores a la ubicación: ' : 'Intentos de ubicación: ') + esc(e.solicitud.intentos) +
    (!recibida && e.incidencia === 'sin_respuesta' ? ' · Pendiente sin respuesta' : '') + '</p>' +
    (!recibida && e.solicitud.esperaEnvio ? '<p class="muted">' + esc(e.solicitud.esperaEnvio.motivo) +
      (e.solicitud.esperaEnvio.hasta ? ' · ' + esc(new Date(e.solicitud.esperaEnvio.hasta).toLocaleTimeString()) : '') + '</p>' : '');
}
function marcaCambio(e) {
  if (!e.ubicacionCambiadaAt) return '';
  var texto = e.cambioUbicacion || 'cambió su ubicación';
  return '<span class="chip chip-cambio" title="El cliente pidió cambiar su ubicación y mandó otra">'+esc(texto.charAt(0).toUpperCase()+texto.slice(1))+'</span>';
}
/* El mismo tracking ya vino otro dia: es una reprogramacion. Lo de ese dia es solo un dato: el cliente vuelve a mandar o confirmar la ubicacion. */
function marcaReprogramado(e) {
  var r = e.reprogramado;
  if (!r) return '';
  var dia = String(r.dia || '').split('-').reverse().join('/');
  var antes = [r.direccion, r.distrito].filter(Boolean).join(', ');
  var mapa = r.lat != null && r.lng != null ? ' <a href="https://www.google.com/maps?q=' + encodeURIComponent(r.lat + ',' + r.lng) + '" target="_blank" rel="noopener">ubicación de ese día</a>' : '';
  return '<p class="muted reprogramado"><span class="chip chip-reprogramado" title="El mismo tracking ya llegó otro día: se le vuelve a pedir o confirmar la ubicación para hoy">Reprogramado del ' + esc(dia) + '</span> ' + (antes ? 'Antes: ' + esc(antes) + '.' : '') + mapa + ' No se reutiliza: el cliente la confirma para hoy.</p>';
}
function pintar() {
  var lista=visibles(); pintarContadores(); $('total').textContent=lista.length===1?'1 pedido':lista.length+' pedidos';
  $('lista-pedidos').innerHTML=lista.length?lista.map(function(e){
    var mapa=e.lat!=null&&e.lng!=null?'https://www.google.com/maps?q='+encodeURIComponent(e.lat+','+e.lng):null;
    var k=etapa(e);
    return '<article class="pedido tono-'+tonos[k]+'">'+
      '<div class="p-quien"><b>'+esc(e.nombre||e.phone)+'</b><span class="p-datos"><span class="p-ref">'+esc(e.referencia)+'</span>'+esc(e.phone)+(e.distrito?' · '+esc(e.distrito):'')+'</span>'+(e.direccion?'<span class="p-dir">'+esc(e.direccion)+'</span>':'')+'</div>'+
      '<div class="p-estado"><div class="p-chips"><span class="chip tono-'+tonos[k]+'">'+esc(etiquetas[k])+'</span>'+marcaCambio(e)+'</div><div class="p-nota">'+marcaReprogramado(e)+envioGsg(e)+historialUbicacion(e)+'</div></div>'+
      '<div class="p-acciones"><a class="btn sm" href="/chat?phone='+encodeURIComponent(e.phone)+'">Chat</a>'+(mapa?'<a class="btn sm" href="'+esc(mapa)+'" target="_blank" rel="noopener">Ver ubicación</a>':'')+'<button class="btn sm" data-detalle="'+e.id+'">Detalle</button>'+(e.lat!=null&&e.lng!=null?'<button class="btn sm" data-gsg="'+e.id+'">Enviar a GSG</button>':'')+(k==='por_confirmar_envio'?'<button class="btn sm primario" data-enviar="'+e.id+'">Confirmar y enviar</button>':'')+(k==='falta_confirmar'?'<button class="btn sm" data-confirmar="'+e.id+'">Confirmar</button>':'')+((e.acciones||[]).indexOf('volver_a_pedir_ubicacion')>=0?'<button class="btn sm" data-repedir="'+e.id+'" title="Volver a solicitar la ubicación">Pedir de nuevo</button>':'')+(e.estado!=='cancelada'&&e.estado!=='entregada'?'<button class="btn sm peligro p-peligro" data-cancelar="'+e.id+'">Cancelar</button>':'')+'</div>'+
      '<div id="detalle-'+e.id+'" class="detalle"></div></article>';
  }).join(''):'<div class="vacio"><h3>No hay pedidos en este filtro</h3><p>Prueba con otro estado o borra la búsqueda.</p></div>';$('lista-pedidos').removeAttribute('aria-busy');
  document.querySelectorAll('[data-gsg]').forEach(function(b){b.onclick=async function(){b.disabled=true;var caja=$('gsg-'+b.dataset.gsg);try{var r=await api('/admin/entregas/'+b.dataset.gsg+'/enviar-gsg',{method:'POST',body:{}});var txt=r.ok?'Enviado a GSG: '+JSON.stringify(r.cuerpo):'No se pudo enviar a GSG. Error: '+(r.error||'desconocido');if(caja)caja.textContent=txt;toast(txt);}catch(e){toast('No se pudo enviar a GSG. Error: '+e.message);}finally{b.disabled=false;}};});
  document.querySelectorAll('[data-enviar]').forEach(function(b){b.onclick=function(){confirmarEnvio(b,{ids:[Number(b.dataset.enviar)]});};});
  document.querySelectorAll('[data-detalle]').forEach(function(b){b.onclick=async function(){try { var d=await api('/admin/entregas/'+b.dataset.detalle); var caja=$('detalle-'+b.dataset.detalle); caja.classList.add('abierto'); caja.innerHTML='<ol>'+((d.eventos||[]).map(function(ev){return '<li>'+esc(ev.detalle)+'</li>';}).join('')||'<li>Sin actividad adicional.</li>')+'</ol>'; } catch(e){toast(e.message);} };});
  document.querySelectorAll('[data-confirmar]').forEach(function(b){b.onclick=function(){accionIndividual(b.dataset.confirmar,'confirmar',{confirmada:true});};});
  document.querySelectorAll('[data-repedir]').forEach(function(b){b.onclick=async function(){b.disabled=true;try{var r=await api('/admin/entregas/'+b.dataset.repedir+'/volver-a-pedir-ubicacion',{method:'POST',body:{}});toast(r.detalle||'Se le vuelve a pedir la ubicación.');await cargar();}catch(e){toast(e.message);b.disabled=false;}};});
  document.querySelectorAll('[data-cancelar]').forEach(function(b){b.onclick=async function(){var motivo=await pedirDato({titulo:'Cancelar pedido',etiqueta:'Motivo',boton:'Cancelar pedido'}); if(motivo)accionIndividual(b.dataset.cancelar,'cancelar',{motivo:motivo});};});
  var pendientes=resumen&&resumen.porConfirmarEnvio?resumen.porConfirmarEnvio.total:0;
  $('envios-pendientes').classList.toggle('hidden',!pendientes);
  $('envios-pendientes').innerHTML=pendientes?'<b>'+pendientes+(pendientes===1?' pedido espera':' pedidos esperan')+' autorización de envío.</b><p><button class="btn" id="enviar-todos">Confirmar y enviar a todos ('+pendientes+')</button></p>':'';
  if(pendientes)$('enviar-todos').onclick=function(){confirmarEnvio(this,{todos:true});};
}
async function confirmarEnvio(boton,body) { boton.disabled=true; try { var r=await api('/admin/entregas/confirmar-envio',{method:'POST',body:body}); toast(r.detalle||r.aviso||'Envío confirmado.'); await cargar(); }catch(e){toast(e.message); boton.disabled=false;} }
async function accionIndividual(id,accion,body) { try { await api('/admin/entregas/'+id+'/'+accion,{method:'POST',body:body}); await cargar(); }catch(e){toast(e.message);} }
function pintarReportes() { var c=resumen.gsgCola; var g=resumen.gsg; $('reportes-gsg').innerHTML = '<span class="muted">Reportes a GSG:</span> '+(c?'<span class="chip tono-verde">'+c.enviado+' enviados</span> <span class="chip tono-'+(c.pendiente?'ambar':'gris')+'">'+c.pendiente+' pendientes</span> <span class="chip tono-'+(c.fallido?'rojo':'gris')+'">'+c.fallido+' fallidos</span>':'<span class="chip tono-gris">no disponibles</span>')+(!g||!g.conectada?' <span class="muted">Configura el backend de GSG en Conexión para enviar las ubicaciones.</span>':''); }
function filaHorario(f) { var tr=document.createElement('tr'); tr.innerHTML='<td><input list="lista-distritos" class="hd-distrito" aria-label="Distrito" required maxlength="60" value="'+esc(f.distrito||'')+'"></td><td><input type="time" class="hd-desde" aria-label="Desde" required value="'+esc(f.desde||'')+'"></td><td><input type="time" class="hd-hasta" aria-label="Hasta" required value="'+esc(f.hasta||'')+'"></td><td><button type="button" class="btn sm fantasma" data-quitar-horario>Quitar</button></td>'; tr.querySelector('[data-quitar-horario]').onclick=function(){tr.remove();ajustesEditados=true;}; $('horarios-distrito').appendChild(tr); }
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
if(!DISPONIBLE)$('lista-pedidos').innerHTML='<div class="vacio"><h3>Los pedidos no están disponibles</h3><p>Este arranque no tiene el módulo de pedidos.</p></div>';
if(location.hash==='#ajustes')$('ajustes').open=true;
api('/admin/yo').then(function(yo){$('ajustes').hidden=!yo||yo.rol!=='admin';}).catch(function(){$('ajustes').hidden=true;});
cargar();setInterval(function(){if(!document.hidden&&!document.querySelector('.dlg-fondo'))cargar();},30000);
${PESTANAS_PEDIDOS_JS}
`;
  return appShell({ titulo, subtitulo: 'Pedidos del día y su ubicación', contenido, script, nombreNegocio: opts.nombreNegocio, demo: opts.demo, icono: '📋', css: `${BANDEJA_MENSAJES_CSS}\n${NUMEROS_REPORTADOS_CSS}\n.pedidos{display:grid;gap:20px;max-width:1300px;margin:auto}.acciones,.filtros{display:flex;flex-wrap:wrap;gap:12px;align-items:center}.filtros label{display:grid;gap:6px;flex:1 1 160px}.pedidos form > label{display:block;margin-top:14px}.horarios-distrito{padding:8px 18px 16px;margin:16px 0;display:grid;gap:10px;min-width:0}.horarios-distrito td{padding:6px 8px}.horarios-distrito th{padding:8px}.horarios-distrito input{width:100%;box-sizing:border-box}.horarios-distrito .btn{justify-self:start}.pedido p{margin:4px 0}.pedido .chip-cambio{background:var(--ambar-suave);color:var(--ambar)}.pedido .reprogramado .chip-reprogramado{margin-right:6px;background:var(--azul-suave);color:var(--azul)}.pedidos textarea{display:block;width:100%;margin:10px 0}.pedidos .hidden{display:none}#pedidos-error{align-items:center}.pp-cerrar{flex:none;border:none;background:transparent;font-size:20px;line-height:1;cursor:pointer;color:var(--texto-suave);padding:2px 8px;border-radius:var(--radio-xs);min-height:0!important}.pp-cerrar:hover{background:color-mix(in srgb,var(--texto) 8%,transparent);color:var(--texto)}.tarjeta{padding:16px 18px}details.tarjeta[open] summary{margin-bottom:10px}
${PESTANAS_PEDIDOS_CSS}
.pedidos{gap:14px}
.sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.pp-barra{display:grid;gap:12px;padding:12px 14px}
.pp-contadores{display:flex;flex-wrap:wrap;gap:6px}
.pp-contadores:empty{display:none}
.pp-contador{display:inline-flex;align-items:center;gap:8px;min-height:34px;padding:5px 12px;border-radius:999px;border:1px solid var(--borde);background:var(--superficie);color:var(--texto);font:inherit;font-size:13.5px;font-weight:500;cursor:pointer;transition:border-color var(--dur) ease,background-color var(--dur) ease,color var(--dur) ease}
.pp-contador b{font-size:13px;font-weight:700;min-width:22px;padding:1px 7px;border-radius:999px;background:var(--superficie-2);text-align:center;font-variant-numeric:tabular-nums}
.pp-contador:hover{border-color:var(--texto-suave)}
.pp-contador.activo{border-color:var(--primario);background:var(--primario-suave);color:var(--primario);font-weight:600}
.pp-contador.tono-ambar b{color:var(--ambar);background:var(--ambar-suave)}.pp-contador.tono-verde b{color:var(--verde);background:var(--verde-suave)}.pp-contador.tono-rojo b{color:var(--rojo);background:var(--rojo-suave)}.pp-contador.tono-azul b{color:var(--azul);background:var(--azul-suave)}.pp-contador.tono-gris b{color:var(--gris);background:var(--gris-suave)}
.pp-contador.activo b{color:var(--primario-texto);background:var(--primario)}
.pp-fila{display:flex;flex-wrap:wrap;gap:8px 10px;align-items:center}
.pp-contadores:not(:empty)+.pp-fila{padding-top:12px;border-top:1px solid var(--borde)}
.pp-buscar{flex:1 1 280px;min-width:0;position:relative}
.pp-buscar input{width:100%;box-sizing:border-box;padding-left:36px}
.pp-buscar::before{content:'';position:absolute;left:12px;top:50%;width:16px;height:16px;margin-top:-8px;background:var(--texto-suave);-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m20 20-3.5-3.5'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m20 20-3.5-3.5'/%3E%3C/svg%3E") center/contain no-repeat;pointer-events:none}
.pp-sep{flex:1 0 0}
#total{font-size:13px;white-space:nowrap}
.pp-reportes{margin:0;display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:13.5px}
.pp-reportes:empty{display:none}
.pp-lista{display:grid;gap:6px}
/* Una fila por pedido: quien, en que estado esta y que se puede hacer. */
.pedido{display:grid;grid-template-columns:minmax(200px,1fr) minmax(240px,1.5fr) auto;gap:6px 20px;align-items:center;padding:12px 16px;background:var(--superficie);border:1px solid var(--borde);border-left:3px solid var(--borde);border-radius:var(--radio-sm);transition:box-shadow var(--dur) ease,border-color var(--dur) ease}
.pedido.tono-ambar{border-left-color:var(--ambar)}.pedido.tono-verde{border-left-color:var(--verde)}.pedido.tono-rojo{border-left-color:var(--rojo)}.pedido.tono-azul{border-left-color:var(--azul)}.pedido.tono-gris{border-left-color:var(--gris)}
.pedido:hover{box-shadow:var(--sombra-hover)}
.pp-esqueleto{border-left-color:var(--superficie-2)}
.p-quien{display:grid;gap:3px;min-width:0}.p-quien b{font-size:14.5px;line-height:1.3}
.p-datos,.p-dir{font-size:12.5px;color:var(--texto-suave);overflow-wrap:anywhere}
.p-ref{font-family:var(--mono);font-size:12px;font-weight:600;color:var(--texto);background:var(--superficie-2);border-radius:var(--radio-xs);padding:1px 6px;margin-right:6px}
.p-estado{display:grid;gap:4px;min-width:0}.p-chips{display:flex;flex-wrap:wrap;gap:6px}
.p-nota{font-size:12.5px;color:var(--texto-suave);line-height:1.45}.p-nota p{margin:1px 0}.p-nota .chip{font-size:11.5px}
.p-acciones{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;align-items:center}
.p-acciones .btn.sm{box-shadow:none}
@media (min-width:961px) and (pointer:fine){.p-acciones .btn.sm{min-height:32px;padding:5px 11px}}
.p-acciones .p-peligro{margin-left:6px}
.detalle{grid-column:1/-1}.detalle.abierto{margin-top:6px;padding:10px 14px;background:var(--superficie-2);border-radius:var(--radio-sm);font-size:13px;animation:s-aparecer .2s var(--curva)}.detalle ol{margin:0;padding-left:18px;display:grid;gap:4px}
@media (max-width:680px){.pp-contadores{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin:0 -14px;padding:0 14px}.pp-contadores::-webkit-scrollbar{display:none}.pp-contador{flex:none}}
@media (max-width:900px){.pedido{grid-template-columns:1fr;gap:8px}.p-acciones{justify-content:flex-start}.p-acciones .p-peligro{margin-left:auto}.pp-sep{display:none}}
` });
}
