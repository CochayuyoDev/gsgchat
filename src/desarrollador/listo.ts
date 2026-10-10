/**
 * Pestaña «¿Está listo para GSG?» del Modulo desarrollador.
 *
 * Un boton recorre el contrato entero (comprobaciones.ts) SIEMPRE contra un
 * simulador de GSG: nunca la API real, y sin tocar la conexion de la tienda
 * ni su cola. A la API real de GSG no se le pide nada nunca (ni para
 * probarla): los pedidos entran cuando GSG los empuja y GSGchat solo le
 * manda los reportes.
 *
 * Rutas (el hook de routes.ts ya exige una persona administradora):
 *  POST /admin/desarrollador/listo/comprobar   recorre el contrato
 *  GET  /admin/desarrollador/listo/ultimo      el ultimo resultado y la conexion vigente
 *  GET  /admin/desarrollador/listo/produccion  lo que falta para salir a produccion (WhatsApp, GSG real,
 *                                              https, la clave de GSG, su webhook, soporte, supervisor,
 *                                              modo prueba, agente operativo)
 */

import type { RegistrarSeccion, SeccionDesarrollador } from './seccion.js';
import { recorrerContrato, type ResultadoRecorrido } from './comprobaciones.js';
import { avisoDireccionPublica } from '../config.js';

/** Lo que hay que pedirle a GSG para conectar de verdad. Sale en la pantalla y en el informe. */
export const LO_QUE_PEDIR_A_GSG = [
  'La dirección base de su API (por ejemplo https://api.gsg.pe/v1), con https.',
  'El token con el que GSGchat les llama (va en Authorization: Bearer …).',
  'Que su API acepte POST /ubicaciones, /confirmaciones, /entregas, /incidencias y /resumenes, tal cual el contrato (docs/CONTRATO-GSG.md, en Conexión → «Descargar el contrato»). GSGchat no le pide nada a su API: solo le manda esos reportes.',
  'Que manden los pedidos del día a POST /api/v1/entregas con la clave de API de GSGchat (Conexión → «Crear la clave para GSG»): es la única forma en que entran.',
  'La URL de su webhook, para enterarse al momento de lo que pasa con cada pedido (confirmado, avisado, entregado, incidencia).',
  'Confirmar el formato de dos campos: «telefono» (9 dígitos o con 51 delante; ¿algún cliente con fijo o extranjero?) y «referencia» (¿única por día o para siempre?).',
];

/** Una cosa de la lista «Para salir a producción», en palabras. */
export interface PuntoProduccion {
  clave: string;
  ok: boolean;
  /** true = no frena la salida, pero conviene mirarlo. */
  aviso?: boolean;
  titulo: string;
  explicacion: string;
  queHacer?: string;
}

/** Lo que la tienda tiene que tener puesto para pedir ubicaciones de verdad para GSG Courier. */
export async function revisarProduccion(deps: Parameters<RegistrarSeccion>[1]): Promise<{ listo: boolean; puntos: PuntoProduccion[] }> {
  const puntos: PuntoProduccion[] = [];
  const poner = (p: PuntoProduccion) => puntos.push(p);

  const whatsapp = deps.settings.isConfigured() && (deps.wa.conectado?.() ?? true);
  poner({
    clave: 'whatsapp',
    ok: whatsapp,
    titulo: 'El WhatsApp está conectado',
    explicacion: whatsapp ? 'El número de la tienda está vinculado y en línea.' : deps.settings.isConfigured() ? 'El número está vinculado pero ahora mismo no está en línea.' : 'Todavía no hay un número de WhatsApp vinculado.',
    queHacer: whatsapp ? undefined : 'Ve a Conexión y escanea el QR con el teléfono del número de GSG Courier.',
  });

  const gsg = deps.conexionGsg?.estado();
  const gsgReal = gsg?.modo === 'real';
  poner({
    clave: 'gsg',
    ok: gsgReal && !gsg?.aviso,
    titulo: 'Conectado al sistema real de GSG',
    explicacion: !gsg
      ? 'En este arranque la conexión con GSG no se configura desde la pantalla.'
      : gsgReal
        ? gsg.aviso ?? `Conectado a ${gsg.url}.`
        : gsg.modo === 'simulador'
          ? 'Ahora se usa el simulador de GSG (números ficticios): ningún cliente real recibe nada por esta vía.'
          : 'GSG no está conectado: los pedidos solo entran si GSG los empuja por la API o si se pegan a mano en Hoy.',
    queHacer: gsgReal && !gsg?.aviso ? undefined : 'Pide a GSG la dirección de su API (con https) y su token, y pégalos en Conexión → «El sistema de GSG». Es a donde se le mandan los reportes; a GSG no se le pide nada.',
  });

  // Los pedidos solo entran si GSG los empuja: hace falta su clave de API.
  if (deps.repos?.claves) {
    const claves = (await deps.repos.claves.listar().catch(() => [])).filter((c) => !c.revocadaAt && (c.permisos.includes('*') || c.permisos.includes('entregas:gestionar')));
    poner({
      clave: 'claveGsg',
      ok: claves.length > 0,
      titulo: 'GSG tiene su clave para mandar los pedidos',
      explicacion: claves.length ? `Hay ${claves.length} clave(s) de API que pueden mandar pedidos a POST /api/v1/entregas.` : 'No hay ninguna clave de API que pueda mandar pedidos: GSG no tiene cómo hacerlos entrar (GSGchat no se los pide).',
      queHacer: claves.length ? undefined : 'Conexión → «Crear la clave para GSG» y dásela a sus programadores.',
    });
  }
  if (deps.repos?.webhooks) {
    const avisos = (await deps.repos.webhooks.listar().catch(() => [])).filter((w) => w.activo && w.eventos.some((ev) => ev === '*' || ev.startsWith('entrega.')));
    poner({
      clave: 'webhookGsg',
      ok: avisos.length > 0,
      titulo: 'GSG se entera al momento (webhook)',
      explicacion: avisos.length ? `${avisos.length} webhook(s) activo(s) con los avisos de las entregas.` : 'Ningún webhook recibe los avisos de las entregas (confirmado, avisado, entregado, incidencia).',
      queHacer: avisos.length ? undefined : 'Pide a GSG la URL de su webhook y dala de alta en Conexión → Webhooks con los eventos entrega.*.',
    });
  }

  const aviso = avisoDireccionPublica(deps.config.PUBLIC_BASE_URL);
  poner({
    clave: 'direccion',
    ok: !aviso,
    titulo: 'La dirección pública usa https',
    explicacion: aviso
      ? `Ahora los enlaces salen con ${deps.config.PUBLIC_BASE_URL || '(ninguna dirección)'}: la página del motorizado, las evidencias y los avisos a GSG no abren fuera de esta máquina, o salen sin https.`
      : `Los enlaces salen con ${deps.config.PUBLIC_BASE_URL}.`,
    queHacer: aviso ? 'Apunta el dominio al servidor, pon el certificado https y escribe esa dirección como dirección pública en la configuración del servidor. Luego reinicia.' : undefined,
  });

  const soporte = deps.entregas?.ajustes().soporte;
  const haySoporte = Boolean(soporte?.whatsapp?.trim() || soporte?.llamadas?.trim());
  poner({
    clave: 'soporte',
    ok: haySoporte,
    titulo: 'Hay número de soporte',
    explicacion: haySoporte ? 'El cliente lo recibe al registrar su ubicación y en el mensaje de cierre.' : 'Sin número de soporte, el cliente lee «este mismo número»: en el mensaje de cierre no tendrá a quién llamar.',
    queHacer: haySoporte ? undefined : 'Hoy → Ajustes → «Horario y número de soporte»: escribe el WhatsApp y el teléfono de soporte.',
  });

  const supervisor = deps.ajustes?.supervisor() ?? '';
  poner({
    clave: 'supervisor',
    ok: Boolean(supervisor),
    titulo: 'Hay a quién avisar',
    explicacion: supervisor ? 'Las incidencias, los chats que pasan a una persona y el resumen del día le llegan al supervisor.' : 'Nadie recibe los avisos: un chat que pasa a una persona no se entera nadie.',
    queHacer: supervisor ? undefined : 'Ajustes → Avisos: escribe el WhatsApp del supervisor.',
  });

  const soloNumeros = deps.ajustes ? deps.ajustes.soloNumeros() : deps.config.soloNumeros;
  poner({
    clave: 'modoPrueba',
    ok: soloNumeros.length === 0,
    titulo: 'Fuera del modo prueba',
    explicacion: soloNumeros.length ? `Ahora solo se escribe a ${soloNumeros.length} número(s) de prueba: los clientes de GSG no reciben nada.` : 'Se escribe a todos los clientes.',
    queHacer: soloNumeros.length ? (deps.ajustes?.modoPruebaFijado() ? 'El modo prueba lo fijó quien instaló el servidor: hay que quitar la lista de números de prueba de la configuración del servidor y reiniciar.' : 'Hoy → «Salir del modo prueba» (o Ajustes → Modo prueba).') : undefined,
  });

  if (deps.ia) {
    const ia = deps.ia.estado();
    poner({
      clave: 'agente',
      ok: ia.agenteOperativoEfectivo,
      titulo: 'El agente operativo atiende a los clientes',
      explicacion: ia.agenteOperativoEfectivo
        ? 'Con el cliente solo pide y registra la ubicación; ante cualquier otra consulta manda el mensaje de cierre y pasa el chat a una persona.'
        : 'El asistente no está en modo operativo: podría contestar cosas que no son de la entrega.',
      queHacer: ia.agenteOperativoEfectivo ? undefined : 'Asistente IA → enciende «Agente operativo» (o Ajustes → «Qué se enseña» → «Solo lo de GSG»).',
    });
    poner({
      clave: 'ia',
      ok: ia.tieneToken,
      aviso: true,
      titulo: 'La IA tiene su clave',
      explicacion: ia.tieneToken ? `Usa el modelo ${ia.modeloEfectivo}.` : 'Sin clave, el agente trabaja solo con sus reglas fijas (funciona, pero entiende menos respuestas raras).',
      queHacer: ia.tieneToken ? undefined : 'Asistente IA → pega la clave de OpenAI y elige gpt-4o-mini (consumo muy bajo).',
    });
  }

  if (deps.entregas) {
    const activos = (await deps.entregas.motorizados().catch(() => [])).filter((m) => m.estado === 'activo').length;
    poner({
      clave: 'motorizados',
      ok: activos > 0,
      aviso: true,
      titulo: 'Hay motorizados activos',
      explicacion: activos ? `${activos} motorizado(s) activo(s).` : 'No hay ningún motorizado activo: los pedidos con ubicación se quedarán esperando.',
      queHacer: activos ? undefined : 'Motorizados → dales de alta con su WhatsApp.',
    });
  }

  return { listo: puntos.every((p) => p.ok || p.aviso), puntos };
}

const CSS = `
  .lst-tarjeta { background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); padding: var(--esp-4); margin-bottom: var(--esp-3); }
  .lst-tarjeta h3 { margin: 0 0 6px; font-size: var(--fs-h3, 17px); }
  .lst-tarjeta p { margin: 0 0 var(--esp-2); color: var(--texto-suave); }
  .lst-botones { display: flex; flex-wrap: wrap; gap: var(--esp-2); align-items: center; }
  .lst-btn { min-height: 44px; font-weight: 700; }
  .lst-btn:disabled { opacity: .55; cursor: default; }
  .lst-titular { display: flex; gap: var(--esp-2); align-items: flex-start; padding: 18px 20px; border-radius: var(--radio); font-weight: 800; font-size: 20px; line-height: 1.3; margin-bottom: var(--esp-3); border: 1px solid transparent; }
  .lst-titular > span:first-child { font-size: 26px; line-height: 1; }
  .lst-titular.bien { border-color: var(--verde); }
  .lst-titular.mal { border-color: var(--rojo); }
  .lst-sin { color: var(--texto-suave); padding: 14px 16px; border: 1px dashed var(--borde); border-radius: var(--radio); margin-bottom: var(--esp-3); }
  .lst-grupo.falla { border-color: var(--rojo); }
  .lst-titular.bien { background: var(--verde-suave); color: var(--texto); }
  .lst-titular.mal { background: var(--rojo-suave); color: var(--texto); }
  .lst-cifra { color: var(--texto-suave); font-weight: 400; font-size: 14px; display: block; margin-top: 4px; }
  .lst-grupo { border: 1px solid var(--borde); border-radius: var(--radio); margin-bottom: var(--esp-2); background: var(--superficie); }
  .lst-grupo > summary { min-height: 44px; display: flex; align-items: center; gap: 8px; padding: 10px 14px; cursor: pointer; font-weight: 700; list-style: none; }
  .lst-grupo > summary::-webkit-details-marker { display: none; }
  .lst-items { list-style: none; margin: 0; padding: 0 14px 10px; display: grid; gap: 8px; }
  .lst-item { display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 8px; padding: 8px 0; border-top: 1px solid var(--borde); }
  .lst-marca { width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; font-size: 13px; }
  .lst-marca.bien { background: var(--verde-suave); color: var(--verde); }
  .lst-marca.mal { background: var(--rojo-suave); color: var(--rojo); }
  .lst-item b { display: block; }
  .lst-item .lst-exp { color: var(--texto-suave); font-size: 14px; overflow-wrap: anywhere; }
  .lst-item .lst-hacer { color: var(--texto); font-size: 14px; margin-top: 2px; }
  .lst-tecnico summary { cursor: pointer; font-size: 13px; color: var(--primario); min-height: 32px; display: inline-flex; align-items: center; }
  .lst-tecnico pre { white-space: pre-wrap; word-break: break-word; max-height: 260px; overflow: auto; background: var(--superficie-2); padding: 8px; border-radius: var(--radio-sm); font-size: 12px; margin: 4px 0 0; }
  .lst-pedir { margin: 0; padding-left: 20px; display: grid; gap: 6px; }
  .lst-aviso { font-size: 14px; margin-top: var(--esp-2); }
  .lst-limpieza { font-size: 13px; color: var(--texto-suave); margin-top: var(--esp-2); }
  .lst-cargando { color: var(--texto-suave); }
`;

const HTML = `
<div class="lst-tarjeta">
  <h3>Para salir a producción con GSG Courier</h3>
  <p>Lo que tiene que estar puesto para pedir las ubicaciones a los clientes de verdad. Se mira al abrir esta pestaña; «Volver a mirar» lo repite.</p>
  <div id="lst-prod" aria-live="polite"><p class="lst-cargando">Mirando…</p></div>
  <div class="lst-botones"><button class="btn lst-btn" id="lst-prod-otra" type="button">Volver a mirar</button></div>
</div>
<div class="lst-tarjeta">
  <h3>Comprobar la conexión con GSG</h3>
  <p>Recorre todo lo que GSG y GSGchat se van a decir por la API: los pedidos que GSG nos manda, los reportes que le mandamos, los avisos y el contrato escrito. Lo hace contra un simulador de GSG: no toca la conexión de tu tienda, ni la API real, ni a ningún cliente. Tarda unos segundos y al final borra todo lo que creó.</p>
  <div class="lst-botones"><button class="btn primario lst-btn" id="lst-comprobar" type="button">Comprobar la conexión con GSG</button><span class="lst-cargando" id="lst-cargando" aria-live="polite"></span></div>
</div>
<div id="lst-resultado" aria-live="polite"><p class="lst-sin">Todavía no se comprobó. Pulsa «Comprobar la conexión con GSG»: el veredicto sale aquí.</p></div>
<div class="lst-tarjeta">
  <h3>Lo que hay que pedirle a GSG</h3>
  <ol class="lst-pedir">${LO_QUE_PEDIR_A_GSG.map((t) => `<li>${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</li>`).join('')}</ol>
</div>
`;

const JS = String.raw`
  var $ = function (id) { return document.getElementById(id); };
  function esc(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  async function api(url, opts) {
    var r = await fetch(url, Object.assign({ credentials: 'same-origin', headers: { 'content-type': 'application/json' } }, opts || {}));
    var d = null;
    try { d = await r.json(); } catch (e) { d = null; }
    if (!r.ok) throw new Error((d && d.error) || ('El servidor respondió ' + r.status + '. Vuelve a intentarlo.'));
    return d;
  }

  function pintar(res) {
    var caja = $('lst-resultado');
    if (!res) { caja.innerHTML = '<p class="lst-sin">Todavía no se comprobó. Pulsa «Comprobar la conexión con GSG»: el veredicto sale aquí.</p>'; return; }
    var h = '<div class="lst-titular ' + (res.listo ? 'bien' : 'mal') + '" role="status"><span aria-hidden="true">' + (res.listo ? '✅' : '⚠️') + '</span><span>' + esc(res.titular) +
      '<span class="lst-cifra">' + res.bien + ' de ' + res.total + ' comprobaciones bien · ' + new Date(res.en).toLocaleString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) + ' · ' + Math.round(res.duracionMs / 100) / 10 + ' s</span></span></div>';
    res.grupos.forEach(function (g) {
      var malas = g.comprobaciones.filter(function (c) { return !c.ok; }).length;
      h += '<details class="lst-grupo' + (g.ok ? '' : ' falla') + '"' + (g.ok ? '' : ' open') + '><summary><span aria-hidden="true">' + (g.ok ? '✅' : '❌') + '</span>' + esc(g.titulo) +
        '<span class="lst-cifra" style="margin:0 0 0 auto">' + (g.comprobaciones.length - malas) + '/' + g.comprobaciones.length + '</span></summary><ul class="lst-items">';
      g.comprobaciones.forEach(function (c) {
        h += '<li class="lst-item"><span class="lst-marca ' + (c.ok ? 'bien' : 'mal') + '" aria-label="' + (c.ok ? 'bien' : 'falla') + '">' + (c.ok ? '✓' : '✗') + '</span><div><b>' + esc(c.titulo) + '</b><div class="lst-exp">' + esc(c.explicacion) + '</div>' +
          (c.queHacer ? '<div class="lst-hacer">Qué hacer: ' + esc(c.queHacer) + '</div>' : '') +
          (c.tecnico ? '<details class="lst-tecnico"><summary>Ver lo técnico</summary><pre>' + esc(JSON.stringify(c.tecnico, null, 2)) + '</pre></details>' : '') + '</div></li>';
      });
      h += '</ul></details>';
    });
    if (res.limpieza) h += '<div class="lst-limpieza">' + esc(res.limpieza) + '</div>';
    caja.innerHTML = h;
  }

  function pintarProduccion(d) {
    var caja = $('lst-prod');
    var h = '<div class="lst-titular ' + (d.listo ? 'bien' : 'mal') + '" role="status"><span aria-hidden="true">' + (d.listo ? '✅' : '⚠️') + '</span><span>' +
      (d.listo ? 'Todo listo para atender a los clientes de GSG Courier.' : 'Todavía falta algo antes de atender a los clientes de verdad.') + '</span></div><ul class="lst-items" style="padding:0">';
    d.puntos.forEach(function (p) {
      var bien = p.ok;
      h += '<li class="lst-item"><span class="lst-marca ' + (bien ? 'bien' : 'mal') + '" aria-label="' + (bien ? 'bien' : p.aviso ? 'conviene mirarlo' : 'falta') + '">' + (bien ? '✓' : p.aviso ? '!' : '✗') + '</span><div><b>' + esc(p.titulo) + '</b><div class="lst-exp">' + esc(p.explicacion) + '</div>' +
        (p.queHacer ? '<div class="lst-hacer">Qué hacer: ' + esc(p.queHacer) + '</div>' : '') + '</div></li>';
    });
    caja.innerHTML = h + '</ul>';
  }
  async function cargarProduccion() {
    try { pintarProduccion(await api('/admin/desarrollador/listo/produccion')); }
    catch (e) { $('lst-prod').textContent = e.message; }
  }
  $('lst-prod-otra').onclick = function () { $('lst-prod').innerHTML = '<p class="lst-cargando">Mirando…</p>'; cargarProduccion(); };

  async function cargar() {
    cargarProduccion();
    try {
      var d = await api('/admin/desarrollador/listo/ultimo');
      pintar(d.resultado);
    } catch (e) { $('lst-resultado').textContent = e.message; }
  }

  $('lst-comprobar').onclick = async function () {
    var b = this;
    b.disabled = true;
    $('lst-cargando').textContent = 'Comprobando… (unos segundos)';
    try {
      var d = await api('/admin/desarrollador/listo/comprobar', { method: 'POST', body: '{}' });
      pintar(d.resultado);
      $('lst-cargando').textContent = '';
      $('lst-resultado').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      $('lst-cargando').textContent = e.message;
    } finally { b.disabled = false; }
  };

  var cargado = false;
  function alMostrar(id) { if (id === 'listo' && !cargado) { cargado = true; cargar(); } }
  document.addEventListener('dev:pestana', function (ev) { alMostrar(ev.detail); });
  alMostrar((location.hash || '#generar').slice(1));
`;

export const seccionListo: SeccionDesarrollador = {
  id: 'listo',
  titulo: '¿Está listo para GSG?',
  resumen: 'Lo que falta para salir a producción y, con un clic, todo lo que GSG y GSGchat se van a decir por la API.',
  html: HTML,
  js: JS,
  css: CSS,
};

export const registerListo: RegistrarSeccion = async (app, deps) => {
  let ultimo: ResultadoRecorrido | null = null;
  let enMarcha = false;

  const conexion = () => {
    const e = deps.conexionGsg?.estado();
    return e ? { modo: e.modo, url: e.modo === 'real' ? e.url : '', conectada: e.conectada } : null;
  };

  app.get('/admin/desarrollador/listo/ultimo', async () => ({ resultado: ultimo, conexion: conexion() }));

  // Lo que falta para salir a produccion (solo lee: no cambia nada).
  app.get('/admin/desarrollador/listo/produccion', async () => revisarProduccion(deps));

  app.post('/admin/desarrollador/listo/comprobar', async (request, reply) => {
    if (enMarcha) return reply.code(409).send({ error: 'Ya hay una comprobación en marcha: espera a que termine.' });
    enMarcha = true;
    try {
      ultimo = await recorrerContrato({ app, repos: deps.repos, hayEntregas: Boolean(deps.entregas), cookie: request.headers.cookie });
      return { resultado: ultimo };
    } finally {
      enMarcha = false;
    }
  });
};
