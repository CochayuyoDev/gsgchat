/**
 * /procesos: los procesos de la empresa y «Crear desde una plantilla».
 *
 * Cada proceso es una tarjeta con lo que hace (sus pasos en una linea), cuantas
 * personas tiene en curso y cuantas necesitan a alguien, y sus botones: editar
 * los pasos, cargar personas, ver sus corridas, pausar o archivar. La plantilla
 * de entregas de courier (GSG) lleva a Hoy y se activa o desactiva desde aqui.
 */

import { appShell } from '../web/shell.js';
import { COMUN_CSS, COMUN_JS } from './pagina-comun.js';

const CSS = `
  .plantillas { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); }
  .plantilla { display: flex; flex-direction: column; gap: 8px; }
  .plantilla .cab { display: flex; gap: 10px; align-items: center; }
  .plantilla .ico { font-size: 24px; line-height: 1; flex: none; }
  .plantilla b { font-size: 15.5px; }
  .plantilla p { margin: 0; color: var(--texto-suave); font-size: 13.5px; flex: 1; }
  .plantilla .acciones { margin-top: 4px; }
  .procesos { display: grid; gap: 12px; }
  .proceso { display: grid; gap: 8px; }
  .proceso .cab { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .proceso .cab b { font-size: 16px; overflow-wrap: anywhere; }
  .proceso .pasos { color: var(--texto-suave); font-size: 13.5px; overflow-wrap: anywhere; }
  .proceso .cifras { display: flex; gap: 8px; flex-wrap: wrap; font-size: 13.5px; }
  .proceso .corridas { border-top: 1px solid var(--borde); padding-top: 8px; display: grid; gap: 6px; }
  .proceso .corridas:empty { display: none; }
  .corrida-linea { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 13.5px; }
  .corrida-linea a { font-weight: 600; color: var(--primario); overflow-wrap: anywhere; }
  .barra-avance { flex: 1 1 120px; min-width: 80px; height: 8px; background: var(--gris-suave); border-radius: 999px; overflow: hidden; }
  .barra-avance i { display: block; height: 100%; background: var(--verde); }
  .intro { margin: 0 0 var(--esp-4); color: var(--texto-suave); max-width: 70ch; }
`;

export function procesosPage(opts: { demo: boolean; nombreNegocio: string }): string {
  const contenido = `
<div class="wrap">
${opts.demo ? '<div class="demo">Demostración: nada sale a WhatsApp de verdad.</div>' : ''}
<p class="intro">Un proceso es lo que el sistema hace solo por WhatsApp con una lista de personas: pedirles un dato y validarlo, confirmar una cita y recordarla, avisarle una tarea a tu personal o recordar un pago y recibir la captura. Lo que no puede resolver solo, lo pasa a una persona.</p>
<div class="resultado" id="resultado" role="status" aria-live="polite"></div>

<h2 class="titulo-sec">Tus procesos</h2>
<div class="procesos" id="procesos"><div class="vacio"><p>Cargando…</p></div></div>

<h2 class="titulo-sec" id="crear">Crear desde una plantilla</h2>
<div class="plantillas" id="plantillas"></div>
</div>
`;

  const script = String.raw`
${COMUN_JS}
var datos = null;
var esAdmin = true;

function avance(cifras) {
  var total = 0; Object.keys(cifras || {}).forEach(function (k) { total += cifras[k]; });
  var hechas = (cifras.completada || 0) + (cifras.rechazo || 0) + (cifras.sin_respuesta || 0) + (cifras.cancelada || 0);
  return { total: total, hechas: hechas, pct: total ? Math.round(100 * hechas / total) : 0 };
}

function pintarPlantillas() {
  var html = datos.plantillas.map(function (pl) {
    var gsg = pl.id === 'gsg';
    var activa = gsg && datos.gsgActivo;
    var boton = gsg
      ? (activa ? '<a class="btn" href="/hoy">Abrir Hoy</a>' : '<button class="btn primario" type="button" data-plantilla="gsg">Activar</button>')
      : '<button class="btn primario" type="button" data-plantilla="' + esc(pl.id) + '">Crear este proceso</button>';
    return '<div class="tarjeta plantilla"><div class="cab"><span class="ico" aria-hidden="true">' + esc(pl.icono) + '</span><b>' + esc(pl.nombre) + '</b>' + (activa ? chip('verde', 'Activa') : '') + '</div>' +
      '<p>' + esc(pl.resumen) + '</p><details><summary class="muted">¿Para qué sirve?</summary><p>' + esc(pl.descripcion) + (pl.columnas.length ? ' La lista de personas trae: teléfono, nombre, ' + esc(pl.columnas.join(', ')) + '.' : '') + '</p></details>' +
      (esAdmin ? '<div class="acciones">' + boton + '</div>' : '') + '</div>';
  }).join('');
  document.getElementById('plantillas').innerHTML = html;
}

function pintarProcesos() {
  var lista = datos.procesos;
  if (!lista.length) {
    document.getElementById('procesos').innerHTML = '<div class="vacio"><h3>Todavía no tienes procesos</h3><p>Elige una plantilla abajo: se crea en un clic y luego ajustas sus mensajes.</p><div class="acciones"><a class="btn primario" href="#crear">Ver las plantillas</a></div></div>';
    return;
  }
  document.getElementById('procesos').innerHTML = lista.map(function (p) {
    var gsg = p.plantilla === 'gsg';
    var estado = p.estado === 'activo' ? chip('verde', 'Activo') : p.estado === 'pausado' ? chip('ambar', 'En pausa') : chip('gris', 'Archivado');
    var cifras = gsg ? '' : '<div class="cifras">' +
      (p.vivas ? chip('azul', p.vivas + ' en curso') : '') +
      (p.necesitan ? '<a href="/personas?proceso=' + p.id + '&filtro=persona">' + chip('rojo', p.necesitan + ' necesitan a alguien') + '</a>' : '') +
      (p.cifras.completada ? chip('verde', p.cifras.completada + ' completadas') : '') +
      (!p.vivas && !p.necesitan && !p.cifras.completada ? '<span class="muted">Sin personas todavía.</span>' : '') + '</div>';
    var botones = [];
    if (gsg) {
      if (p.estado === 'activo') botones.push('<a class="btn primario" href="/hoy">Abrir Hoy</a>', '<a class="btn" href="/numeros">Números del día</a>');
      if (esAdmin) botones.push(p.estado === 'activo' ? '<button class="btn" type="button" data-estado="pausado" data-id="' + p.id + '">Desactivar</button>' : '<button class="btn primario" type="button" data-estado="activo" data-id="' + p.id + '">Activar</button>');
    } else {
      if (p.estado !== 'archivado') botones.push('<button class="btn primario" type="button" data-cargar="' + p.id + '">Cargar personas</button>');
      botones.push('<a class="btn" href="/procesos/editor?id=' + p.id + '">' + (esAdmin ? 'Editar pasos' : 'Ver pasos') + '</a>');
      botones.push('<a class="btn" href="/respuestas?proceso=' + p.id + '">Respuestas</a>');
      if (esAdmin) {
        if (p.estado === 'activo') botones.push('<button class="btn" type="button" data-estado="pausado" data-id="' + p.id + '">Pausar</button>');
        else botones.push('<button class="btn" type="button" data-estado="activo" data-id="' + p.id + '">Activar</button>');
        if (p.estado !== 'archivado') botones.push('<button class="btn" type="button" data-estado="archivado" data-id="' + p.id + '">Archivar</button>');
      }
    }
    return '<div class="tarjeta proceso" data-proceso="' + p.id + '"><div class="cab"><b>' + esc(p.nombre) + '</b>' + estado + '</div>' +
      '<div class="pasos">' + esc(p.resumenPasos || 'Sin pasos todavía.') + '</div>' + cifras +
      '<div class="acciones">' + botones.join('') + '</div>' +
      (gsg ? '' : '<div class="corridas" id="corridas-' + p.id + '"></div>') + '</div>';
  }).join('');
}

async function pintarCorridas() {
  try {
    var d = await api('/admin/procesos/corridas');
    var porProceso = {};
    d.corridas.forEach(function (c) { (porProceso[c.procesoId] = porProceso[c.procesoId] || []).push(c); });
    Object.keys(porProceso).forEach(function (id) {
      var caja = document.getElementById('corridas-' + id);
      if (!caja) return;
      caja.innerHTML = porProceso[id].slice(0, 5).map(function (c) {
        var a = avance(c.cifras);
        return '<div class="corrida-linea"><a href="/procesos/corrida?id=' + c.id + '">' + esc(c.nombre) + '</a>' +
          (c.estado === 'pausada' ? chip('ambar', 'En pausa') : c.estado === 'terminada' ? chip('gris', 'Terminada') : '') +
          '<span class="barra-avance" title="' + a.hechas + ' de ' + a.total + ' terminadas"><i style="width:' + a.pct + '%"></i></span><span class="muted">' + a.hechas + ' de ' + a.total + '</span>' +
          (c.cifras.persona ? chip('rojo', c.cifras.persona + ' necesitan a alguien') : '') + '</div>';
      }).join('');
    });
  } catch (e) { /* la lista se ve igual */ }
}

async function cargar() {
  datos = await api('/admin/procesos');
  pintarProcesos();
  pintarPlantillas();
  pintarCorridas();
}

document.addEventListener('yo', function (ev) {
  esAdmin = ev.detail && ev.detail.rol === 'admin';
  if (datos) { pintarProcesos(); pintarPlantillas(); pintarCorridas(); }
});

document.querySelector('.wrap').addEventListener('click', async function (ev) {
  var b = ev.target.closest('button');
  if (!b || b.disabled) return;
  try {
    if (b.hasAttribute('data-plantilla')) {
      var id = b.getAttribute('data-plantilla');
      var pl = datos.plantillas.filter(function (x) { return x.id === id; })[0];
      if (id === 'gsg') {
        var si = await confirmarDialogo({ titulo: 'Activar las entregas de courier', texto: 'Aparecen en el menú Hoy, Números del día, Motorizados y Mapa, y el sistema empieza a trabajar con los pedidos que mande GSG.', boton: 'Sí, activar' });
        if (!si) return;
      }
      b.disabled = true;
      var r = await api('/admin/procesos/desde-plantilla', { method: 'POST', body: { plantilla: id } });
      if (id === 'gsg') { location.href = '/hoy'; return; }
      location.href = r.ir || '/procesos';
      return;
    }
    if (b.hasAttribute('data-estado')) {
      var estado = b.getAttribute('data-estado');
      var pid = Number(b.getAttribute('data-id'));
      var proc = datos.procesos.filter(function (x) { return x.id === pid; })[0];
      if (proc && proc.plantilla === 'gsg' && estado !== 'activo') {
        var ok = await confirmarDialogo({ titulo: 'Desactivar las entregas de courier', texto: 'Se esconden Hoy, Números del día, Motorizados y Mapa del menú. Los pedidos y su historial se conservan; se vuelve a activar desde aquí.', boton: 'Sí, desactivar', peligro: true });
        if (!ok) return;
      }
      if (estado === 'archivado') {
        var ok2 = await confirmarDialogo({ titulo: 'Archivar «' + (proc ? proc.nombre : 'el proceso') + '»', texto: 'Deja de escribirle a las personas que tenga en curso y se va al final de la lista. Se puede reactivar.', boton: 'Sí, archivar' });
        if (!ok2) return;
      }
      b.disabled = true;
      await api('/admin/procesos/' + pid + '/estado', { method: 'POST', body: { estado: estado } });
      if (proc && proc.plantilla === 'gsg') { location.reload(); return; }
      avisar(estado === 'activo' ? 'Proceso activo: vuelve a escribir con su ritmo.' : estado === 'pausado' ? 'Proceso en pausa: no sale ningún mensaje hasta que lo actives. Lo que respondan se sigue leyendo.' : 'Proceso archivado.');
      await cargar();
      return;
    }
    if (b.hasAttribute('data-cargar')) {
      var cid = Number(b.getAttribute('data-cargar'));
      var p2 = datos.procesos.filter(function (x) { return x.id === cid; })[0];
      var det = await api('/admin/procesos/' + cid);
      var res = await abrirCarga({ procesoId: cid, nombre: p2 ? p2.nombre : '', ejemplo: det.ejemplo, columnas: det.columnasSugeridas, motorizados: false });
      if (!res) return;
      avisar(res.aviso, false, res.ir);
      await cargar();
    }
  } catch (e) {
    b.disabled = false;
    avisar(e.message, true, e.ir);
  }
});

cargar().catch(function (e) { document.getElementById('procesos').innerHTML = '<div class="vacio"><h3>No se pudieron leer los procesos</h3><p>' + esc(e.message) + '</p></div>'; });
setInterval(function () { if (!document.hidden && !document.querySelector('.dlg-fondo')) cargar().catch(function () {}); }, 20000);
`;

  return appShell({
    titulo: 'Procesos',
    subtitulo: 'Lo que el sistema hace solo por WhatsApp con tus listas de personas',
    contenido,
    script,
    css: COMUN_CSS + CSS,
    nombreNegocio: opts.nombreNegocio,
    demo: opts.demo,
    icono: '⚙️',
  });
}
