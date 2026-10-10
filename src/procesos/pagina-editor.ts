/**
 * /procesos/editor?id=: los pasos de un proceso, por formulario.
 *
 * Una tarjeta por paso (subir, bajar, borrar), con los campos que ese tipo de
 * paso necesita y los chips de variables bajo cada texto. Nada de JSON: lo
 * que no cuadra (un mensaje vacio, un dato sin elegir) se dice al guardar, en
 * palabras y con el numero del paso.
 */

import { appShell } from '../web/shell.js';
import { COMUN_CSS, COMUN_JS } from './pagina-comun.js';

const CSS = `
  .editor { display: grid; gap: var(--esp-4); padding-bottom: 90px; }
  .campo { display: grid; gap: 5px; }
  .campo > label, .campo > .etiqueta { font-size: 13px; font-weight: 600; color: var(--texto); }
  .campo .ayuda { font-size: 12.5px; color: var(--texto-suave); margin: 0; }
  .campo input, .campo select, .campo textarea { width: 100%; min-height: 40px; font: inherit; font-size: 14.5px; padding: 8px 11px; border: 1px solid var(--borde); border-radius: var(--radio-sm); background: var(--superficie); color: var(--texto); }
  .campo textarea { min-height: 76px; resize: vertical; line-height: 1.45; }
  .campo input:focus, .campo select:focus, .campo textarea:focus { outline: 2px solid var(--primario); outline-offset: -1px; border-color: transparent; }
  .rejilla-2 { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
  .paso { display: grid; gap: 12px; border-left: 4px solid var(--primario); }
  .paso.tipo-aviso { border-left-color: var(--azul); }
  .paso.tipo-esperar { border-left-color: var(--gris-claro); }
  .paso.tipo-persona { border-left-color: var(--ambar); }
  .paso-cab { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .paso-cab .n { width: 28px; height: 28px; flex: none; border-radius: 50%; background: var(--primario); color: var(--primario-texto); display: grid; place-items: center; font-weight: 800; font-size: 13px; }
  .paso-cab b { flex: 1 1 160px; min-width: 0; overflow-wrap: anywhere; }
  .paso-cab .mover { display: flex; gap: 6px; flex-wrap: wrap; }
  .mas-opciones summary { cursor: pointer; color: var(--primario); font-weight: 600; font-size: 13.5px; min-height: 36px; display: flex; align-items: center; }
  .mas-opciones[open] summary { margin-bottom: 8px; }
  .mas-opciones > div { display: grid; gap: 12px; }
  .anadir { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end; }
  .anadir .campo { flex: 1 1 240px; }
  .guardar-barra { position: sticky; bottom: 0; z-index: 6; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); box-shadow: var(--sombra-2); padding: 10px 14px; }
  .guardar-barra .estado-guardado { color: var(--texto-suave); font-size: 13.5px; flex: 1 1 180px; }
  .gsg-aviso { display: grid; gap: 10px; }
  .corridas-lista { display: grid; gap: 6px; }
  .corridas-lista a { font-weight: 600; color: var(--primario); }
  .solo-lectura .solo-admin { display: none !important; }
  @media (max-width: 760px) {
    .guardar-barra { padding: 8px; gap: 8px; flex-wrap: nowrap; }
    .guardar-barra .estado-guardado { display: none; }
    .guardar-barra .btn { flex: 1 1 0; }
    .guardar-barra.con-cambios .estado-guardado { display: none; }
  }
  .guardar-barra.con-cambios #guardar { box-shadow: 0 0 0 3px var(--ambar-suave); }
`;

export function editorPage(opts: { demo: boolean; nombreNegocio: string }): string {
  const contenido = `
<div class="wrap">
${opts.demo ? '<div class="demo">Demostración: nada sale a WhatsApp de verdad.</div>' : ''}
<div class="resultado" id="resultado" role="status" aria-live="polite"></div>
<div id="editor" class="editor"><div class="vacio"><p>Cargando…</p></div></div>
</div>
`;

  const script = String.raw`
${COMUN_JS}
var ID = Number(paramUrl('id')) || 0;
var d = null;
var p = null;
var esAdmin = true;
var cambios = false;
var SALIDAS = [['siguiente', 'Seguir con el paso siguiente'], ['fin', 'Terminar el proceso'], ['persona', 'Pasar a una persona']];
var TIPOS = ['pedir', 'confirmar', 'avance', 'aviso', 'esperar', 'persona'];

function opciones(lista, actual) { return lista.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === actual ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); }
function campoTexto(i, clave, etiqueta, ayuda, filas) {
  var paso = p.pasos[i];
  return '<div class="campo"><label for="c-' + i + '-' + clave + '">' + esc(etiqueta) + '</label><textarea id="c-' + i + '-' + clave + '" data-i="' + i + '" data-campo="' + clave + '" rows="' + (filas || 3) + '" class="con-variables">' + esc(paso[clave] || '') + '</textarea>' + (ayuda ? '<p class="ayuda">' + esc(ayuda) + '</p>' : '') + '</div>';
}
function campoSelect(i, clave, etiqueta, lista, actual, ayuda) {
  return '<div class="campo"><label for="c-' + i + '-' + clave + '">' + esc(etiqueta) + '</label><select id="c-' + i + '-' + clave + '" data-i="' + i + '" data-campo="' + clave + '">' + opciones(lista, actual) + '</select>' + (ayuda ? '<p class="ayuda">' + esc(ayuda) + '</p>' : '') + '</div>';
}
function campoNumero(i, clave, etiqueta, valor, min, max, ayuda) {
  return '<div class="campo"><label for="c-' + i + '-' + clave + '">' + esc(etiqueta) + '</label><input type="number" inputmode="numeric" id="c-' + i + '-' + clave + '" data-i="' + i + '" data-campo="' + clave + '" value="' + esc(valor) + '" min="' + min + '" max="' + max + '">' + (ayuda ? '<p class="ayuda">' + esc(ayuda) + '</p>' : '') + '</div>';
}

function tarjetaPaso(paso, i) {
  var n = p.pasos.length;
  var cab = '<div class="paso-cab"><span class="n">' + (i + 1) + '</span><b>' + esc(paso.titulo || d.nombresPaso[paso.tipo]) + '</b>' +
    '<span class="mover solo-admin"><button class="btn sm" type="button" data-mover="-1" data-i="' + i + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="Subir el paso ' + (i + 1) + '">↑ Subir</button>' +
    '<button class="btn sm" type="button" data-mover="1" data-i="' + i + '"' + (i === n - 1 ? ' disabled' : '') + ' aria-label="Bajar el paso ' + (i + 1) + '">↓ Bajar</button>' +
    '<button class="btn sm peligro" type="button" data-borrar="' + i + '" aria-label="Borrar el paso ' + (i + 1) + '">Borrar</button></span></div>';
  var html = cab + '<div class="rejilla-2"><div class="campo"><label for="c-' + i + '-titulo">Nombre del paso</label><input id="c-' + i + '-titulo" data-i="' + i + '" data-campo="titulo" maxlength="120" value="' + esc(paso.titulo || '') + '"></div>' +
    campoSelect(i, 'tipo', 'Qué hace', TIPOS.map(function (t) { return [t, d.nombresPaso[t]]; }), paso.tipo) + '</div>';
  var espera = paso.tipo === 'pedir' || paso.tipo === 'confirmar' || paso.tipo === 'avance';
  if (paso.tipo === 'pedir') {
    html += campoSelect(i, 'dato', 'Qué dato se pide', Object.keys(d.nombresDato).map(function (k) { return [k, d.nombresDato[k]]; }), paso.dato, 'Se valida al llegar: lo que no vale se vuelve a pedir explicando por qué.');
  }
  if (paso.tipo !== 'esperar') html += campoTexto(i, 'texto', paso.tipo === 'persona' ? 'Lo que se le dice al pasarlo a una persona (opcional)' : 'Mensaje que se le manda', paso.tipo === 'confirmar' ? 'Salen con botones: Sí, No' + (paso.reprogramar !== 'no' ? ' y Reprogramar.' : '.') : paso.tipo === 'avance' ? 'Salen con botones: Llegué, Terminé y No pude.' : paso.tipo === 'pedir' && paso.dato === 'ubicacion' ? 'Sale con el botón para mandar la ubicación.' : '', 4);
  if (paso.tipo === 'esperar') {
    var e = paso.esperar || { como: 'antes_de_la_cita', minutos: 120 };
    html += '<div class="rejilla-2">' + campoSelect(i, 'esperar.como', 'Hasta cuándo', [['antes_de_la_cita', 'Antes de la fecha y hora de la persona'], ['minutos', 'Unos minutos después del paso anterior']], e.como, e.como === 'antes_de_la_cita' ? 'Usa las columnas fecha y hora de la lista (o vencimiento). Si la persona no las trae, no se espera.' : '') +
      campoNumero(i, 'esperar.minutos', 'Minutos', e.minutos, 0, 43200, '60 = 1 hora · 120 = 2 horas · 1440 = 1 día') + '</div>';
  }
  if (paso.tipo === 'confirmar') {
    html += '<div class="rejilla-2">' + campoSelect(i, 'si', 'Si responde SÍ', SALIDAS, paso.si || 'siguiente') + campoSelect(i, 'no', 'Si responde NO', SALIDAS, paso.no || 'fin') +
      campoSelect(i, 'reprogramar', 'Si quiere reprogramar', [['pedir_fecha', 'Pedirle la nueva fecha y hora, y seguir'], ['persona', 'Pasar a una persona'], ['no', 'No ofrecer reprogramar']], paso.reprogramar || 'pedir_fecha') + '</div>';
  }
  if (paso.tipo === 'avance') html += campoSelect(i, 'noPudo', 'Si responde NO PUDE', SALIDAS, paso.noPudo || 'persona');
  if (paso.tipo === 'pedir') html += campoSelect(i, 'alResponder', 'Cuando lo manda bien', SALIDAS, paso.alResponder || 'siguiente', 'Una captura de pago, por ejemplo, conviene pasarla a una persona para que la valide.');
  if (espera) {
    html += '<details class="mas-opciones"><summary>Más opciones: por qué, si no entiende, insistencias</summary><div>' +
      campoTexto(i, 'porQue', 'Si pregunta «¿por qué?»', 'Se le explica con este texto y se le vuelve a pedir. Vacío = una explicación general.', 2) +
      campoTexto(i, 'siNoEntiende', 'Si lo que manda no vale', 'Vacío = un aviso general según el dato. A la tercera respuesta que no vale, pasa a una persona.', 2) +
      campoTexto(i, 'gracias', 'Al recibir una respuesta válida (opcional)', 'Va pegado al siguiente mensaje: la persona recibe uno solo.', 2) +
      (paso.tipo === 'confirmar' ? campoTexto(i, 'textoNo', 'Lo que se contesta al NO (opcional)', '', 2) + (paso.reprogramar !== 'no' ? campoTexto(i, 'textoReprogramar', 'Lo que se contesta al REPROGRAMAR', '', 2) : '') : '') +
      '<div class="rejilla-2">' + campoNumero(i, 'insistir.veces', 'Veces que se insiste si no responde', (paso.insistir || {}).veces, 0, 5) + campoNumero(i, 'insistir.cadaMin', 'Cada cuántos minutos', (paso.insistir || {}).cadaMin, 5, 10080, '180 = 3 horas') +
      campoSelect(i, 'sinRespuesta', 'Si no responde después de insistir', SALIDAS, paso.sinRespuesta || 'persona') + '</div></div></details>';
  }
  return '<div class="tarjeta paso tipo-' + esc(paso.tipo) + '" id="paso-' + i + '">' + html + '</div>';
}

function pintar() {
  var caja = document.getElementById('editor');
  if (p.plantilla === 'gsg') {
    caja.innerHTML = '<div class="tarjeta gsg-aviso"><h2 class="titulo-sec">' + esc(p.nombre) + ' ' + (p.estado === 'activo' ? chip('verde', 'Activo') : chip('gris', 'Desactivado')) + '</h2>' +
      '<p>Este proceso usa el módulo de entregas: los pedidos llegan desde GSG, a cada cliente se le pide la ubicación y la confirmación, el pedido va al motorizado y se avisa la hora de llegada. Sus mensajes, horarios y motorizados se configuran en sus propias pantallas.</p>' +
      '<div class="acciones"><a class="btn primario" href="/hoy">Abrir Hoy</a><a class="btn" href="/numeros">Números del día</a><a class="btn" href="/motorizados">Motorizados</a><a class="btn" href="/mapa">Mapa</a><a class="btn" href="/procesos">Volver a Procesos</a></div></div>';
    return;
  }
  var variables = d.variables;
  caja.innerHTML =
    '<div class="tarjeta"><h2 class="titulo-sec">El proceso</h2><div class="rejilla-2">' +
      '<div class="campo"><label for="p-nombre">Nombre</label><input id="p-nombre" data-general="nombre" maxlength="120" value="' + esc(p.nombre) + '"></div>' +
      '<div class="campo"><label for="p-desde">Escribe desde</label><input id="p-desde" type="time" data-general="ritmo.desde" value="' + esc(p.ritmo.desde) + '"><p class="ayuda">Dentro del horario del número y con la pausa de siempre entre mensajes.</p></div>' +
      '<div class="campo"><label for="p-hasta">Hasta</label><input id="p-hasta" type="time" data-general="ritmo.hasta" value="' + esc(p.ritmo.hasta) + '"></div>' +
    '</div><div class="campo" style="margin-top:12px"><label for="p-descripcion">Para qué es (lo ve tu equipo)</label><textarea id="p-descripcion" data-general="descripcion" rows="2">' + esc(p.descripcion) + '</textarea></div></div>' +
    '<h2 class="titulo-sec">Pasos</h2>' +
    (p.pasos.length ? p.pasos.map(tarjetaPaso).join('') : '<div class="vacio"><p>Este proceso todavía no tiene pasos. Añade el primero abajo.</p></div>') +
    '<div class="tarjeta anadir solo-admin"><div class="campo"><label for="nuevo-tipo">Añadir un paso</label><select id="nuevo-tipo">' + opciones(TIPOS.map(function (t) { return [t, d.nombresPaso[t]]; }), 'pedir') + '</select></div><button class="btn primario" type="button" id="anadir">+ Añadir paso</button></div>' +
    '<div class="tarjeta"><h2 class="titulo-sec">Cierre</h2>' +
      '<div class="campo"><label for="p-fin">Al terminar todos los pasos (opcional)</label><textarea id="p-fin" data-general="cierre.fin" rows="2" class="con-variables">' + esc(p.cierre.fin) + '</textarea></div>' +
      '<div class="campo" style="margin-top:12px"><label for="p-ajena">Si escribe algo que no es de este proceso</label><textarea id="p-ajena" data-general="cierre.ajena" rows="2" class="con-variables">' + esc(p.cierre.ajena) + '</textarea><p class="ayuda">Se manda una sola vez y la conversación pasa a una persona. La IA solo decide si es una consulta ajena: el texto es siempre este.</p></div>' +
      '<div class="campo" style="margin-top:12px"><label for="p-persona">Al pasar la conversación a una persona</label><textarea id="p-persona" data-general="cierre.persona" rows="2" class="con-variables">' + esc(p.cierre.persona) + '</textarea></div>' +
    '</div>' +
    '<div class="tarjeta"><h2 class="titulo-sec">Corridas de este proceso</h2><div class="corridas-lista" id="corridas">' +
      (d.corridas.length ? d.corridas.map(function (c) { return '<div><a href="/procesos/corrida?id=' + c.id + '">' + esc(c.nombre) + '</a> <span class="muted">· ' + c.total + ' personas · ' + esc(fechaCorta(c.creada)) + '</span></div>'; }).join('') : '<p class="muted">Todavía no se cargó ninguna lista.</p>') +
      '</div><div class="acciones" style="margin-top:10px"><button class="btn primario" type="button" id="cargar-personas"' + (p.estado === 'archivado' ? ' disabled' : '') + '>Cargar personas</button><a class="btn" href="/respuestas?proceso=' + p.id + '">Ver respuestas</a></div></div>' +
    '<div class="guardar-barra solo-admin"><span class="estado-guardado" id="estado-guardado">Sin cambios.</span><a class="btn" href="/procesos">Volver</a><button class="btn primario" type="button" id="guardar">Guardar cambios</button></div>';
  document.querySelectorAll('textarea.con-variables').forEach(function (t) { if (window.chipsDeVariables && esAdmin) window.chipsDeVariables(t, variables, { etiqueta: 'Tocar para insertar:' }); });
  document.querySelector('.wrap').classList.toggle('solo-lectura', !esAdmin);
  document.querySelectorAll('#editor input, #editor select, #editor textarea').forEach(function (el) { el.disabled = !esAdmin; });
  var cp = document.getElementById('cargar-personas'); if (cp) cp.disabled = p.estado === 'archivado' || !p.pasos.length;
  if (cambios) marcarCambio();
}

function marcarCambio() {
  cambios = true;
  var e = document.getElementById('estado-guardado'); if (e) e.textContent = 'Hay cambios sin guardar.';
  var barra = document.querySelector('.guardar-barra'); if (barra) barra.classList.add('con-cambios');
  var g = document.getElementById('guardar'); if (g) g.textContent = 'Guardar cambios •';
}
function poner(obj, ruta, valor) { var partes = ruta.split('.'); var o = obj; for (var k = 0; k < partes.length - 1; k++) { o[partes[k]] = o[partes[k]] || {}; o = o[partes[k]]; } o[partes[partes.length - 1]] = valor; }

function nuevoPaso(tipo) {
  var id = tipo + '_' + Date.now().toString(36);
  var base = { id: id, tipo: tipo, titulo: d.nombresPaso[tipo], texto: '', insistir: { veces: 2, cadaMin: 180 }, sinRespuesta: 'persona' };
  if (tipo === 'pedir') { base.titulo = 'Pedir un dato'; base.dato = 'texto'; base.alResponder = 'siguiente'; }
  if (tipo === 'confirmar') { base.si = 'siguiente'; base.no = 'fin'; base.reprogramar = 'pedir_fecha'; }
  if (tipo === 'avance') { base.noPudo = 'persona'; base.insistir = { veces: 2, cadaMin: 60 }; }
  if (tipo === 'aviso' || tipo === 'persona') base.insistir = { veces: 0, cadaMin: 60 };
  if (tipo === 'esperar') { base.esperar = { como: 'antes_de_la_cita', minutos: 120 }; base.insistir = { veces: 0, cadaMin: 60 }; }
  return base;
}

document.getElementById('editor').addEventListener('input', function (ev) {
  var el = ev.target;
  if (el.hasAttribute('data-general')) { poner(p, el.getAttribute('data-general'), el.value); marcarCambio(); return; }
  if (!el.hasAttribute('data-campo')) return;
  var i = Number(el.getAttribute('data-i'));
  var campo = el.getAttribute('data-campo');
  var valor = el.type === 'number' ? Number(el.value) : el.value;
  if (campo === 'tipo') {
    var viejo = p.pasos[i];
    var nuevo = nuevoPaso(valor);
    nuevo.id = viejo.id; nuevo.texto = viejo.texto;
    p.pasos[i] = nuevo; marcarCambio(); pintar();
    return;
  }
  poner(p.pasos[i], campo, valor);
  marcarCambio();
  if (campo === 'titulo') { var b = document.querySelector('#paso-' + i + ' .paso-cab b'); if (b) b.textContent = valor || d.nombresPaso[p.pasos[i].tipo]; }
  if (campo === 'dato' || campo === 'reprogramar' || campo === 'esperar.como') pintar();
});

document.getElementById('editor').addEventListener('click', async function (ev) {
  var b = ev.target.closest('button');
  if (!b || b.disabled) return;
  if (b.hasAttribute('data-mover')) {
    var i = Number(b.getAttribute('data-i')); var j = i + Number(b.getAttribute('data-mover'));
    if (j < 0 || j >= p.pasos.length) return;
    var t = p.pasos[i]; p.pasos[i] = p.pasos[j]; p.pasos[j] = t;
    marcarCambio(); pintar();
    var dest = document.getElementById('paso-' + j); if (dest) dest.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (b.hasAttribute('data-borrar')) {
    var k = Number(b.getAttribute('data-borrar'));
    var si = await confirmarDialogo({ titulo: 'Borrar el paso ' + (k + 1), texto: '«' + (p.pasos[k].titulo || d.nombresPaso[p.pasos[k].tipo]) + '» sale del proceso al guardar. A quien ya esté en este paso se le sigue con el siguiente.', boton: 'Sí, borrar', peligro: true });
    if (!si) return;
    p.pasos.splice(k, 1); marcarCambio(); pintar();
    return;
  }
  if (b.id === 'anadir') {
    p.pasos.push(nuevoPaso(document.getElementById('nuevo-tipo').value));
    marcarCambio(); pintar();
    var ult = document.getElementById('paso-' + (p.pasos.length - 1)); if (ult) { ult.scrollIntoView({ block: 'center' }); var t2 = ult.querySelector('textarea, input'); if (t2) t2.focus(); }
    return;
  }
  if (b.id === 'guardar') {
    b.disabled = true; b.textContent = 'Guardando…';
    try {
      await api('/admin/procesos/' + ID, { method: 'POST', body: { nombre: p.nombre, descripcion: p.descripcion, pasos: p.pasos, ritmo: p.ritmo, cierre: p.cierre } });
      cambios = false;
      document.getElementById('estado-guardado').textContent = 'Guardado a las ' + hora(new Date().toISOString()) + '.';
      avisar('Cambios guardados. Lo que se mande desde ahora usa estos pasos y textos.');
      await cargar();
    } catch (e) { avisar(e.message, true, e.ir); }
    finally { var g = document.getElementById('guardar'); if (g) { g.disabled = false; g.textContent = 'Guardar cambios'; } }
    return;
  }
  if (b.id === 'cargar-personas') {
    if (cambios) { avisar('Primero guarda los cambios de los pasos: la lista usa lo que está guardado.', true); return; }
    var r = await abrirCarga({ procesoId: ID, nombre: p.nombre, ejemplo: d.ejemplo, columnas: d.columnasSugeridas, motorizados: p.plantilla === 'campo' });
    if (r) { avisar(r.aviso, false, r.ir); await cargar(); }
  }
});

window.addEventListener('beforeunload', function (ev) { if (cambios) { ev.preventDefault(); ev.returnValue = ''; } });
document.addEventListener('yo', function (ev) { esAdmin = ev.detail && ev.detail.rol === 'admin'; if (p) pintar(); });

async function cargar() {
  d = await api('/admin/procesos/' + ID);
  p = JSON.parse(JSON.stringify(d.proceso));
  if (window.shellTitulo) window.shellTitulo(p.nombre, p.plantilla === 'gsg' ? 'Entregas de courier' : 'Los pasos de este proceso');
  pintar();
}

if (!ID) document.getElementById('editor').innerHTML = '<div class="vacio"><h3>Elige un proceso</h3><p>Abre Procesos y pulsa «Editar pasos» en el que quieras cambiar.</p><div class="acciones"><a class="btn primario" href="/procesos">Ir a Procesos</a></div></div>';
else cargar().catch(function (e) { document.getElementById('editor').innerHTML = '<div class="vacio"><h3>No se pudo abrir el proceso</h3><p>' + esc(e.message) + '</p><div class="acciones"><a class="btn primario" href="/procesos">Ir a Procesos</a></div></div>'; });
`;

  return appShell({
    titulo: 'Editar proceso',
    subtitulo: 'Los pasos de este proceso',
    contenido,
    script,
    css: COMUN_CSS + CSS,
    nombreNegocio: opts.nombreNegocio,
    demo: opts.demo,
    icono: '⚙️',
  });
}
