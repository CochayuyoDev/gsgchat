/**
 * Pestaña «Clientes de prueba» del Modulo desarrollador.
 *
 * Genera clientes (y motorizados) de prueba y los mete por la MISMA puerta
 * que usara GSG: POST /api/v1/entregas con una clave de API (clave-prueba.ts).
 * Asi el generador prueba de paso el endpoint, la clave y sus permisos.
 *
 * Los dos contadores del encargo y su equivalencia con los estados reales de
 * una entrega (src/entregas/repo.ts):
 *
 *   «Contactado, falta que confirme»  -> llega CON pin (como si GSG ya tuviera
 *        la ubicacion): ubicacion 'recibida', estado 'esperando_confirmacion',
 *        y se le manda ya la pregunta de confirmar (confirmacion 'preguntada').
 *   «Falta que mande su ubicacion»     -> llega SIN pin: estado
 *        'esperando_ubicacion'; entra en el lote del reparto, que le pide la
 *        ubicacion con su ritmo (la primera peticion sale en la siguiente
 *        vuelta del motor; en la lista se ve si ya se le escribio).
 *
 * Como la lista de verdad, lo que entra por la API espera a que se confirme su
 * envío (ajuste «Confirmar la lista de GSG antes de enviar», encendido de
 * fabrica): el botón «📤 Confirmar el envío» de esta pestaña hace lo mismo que
 * «Confirmar y enviar a todos» de Números del día, solo con lo de prueba.
 *
 * Nada de esto sale al WhatsApp real: los telefonos son del rango reservado
 * (numeros.ts) y el sender los simula. «Borrar todo lo de prueba» esta en
 * limpiar.ts.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RegistrarSeccion, SeccionDesarrollador, DepsDesarrollador } from './seccion.js';
import { esNumeroDePrueba, numeroDePrueba, PREFIJO_CLIENTE_PRUEBA, PREFIJO_MOTORIZADO_PRUEBA, PREFIJO_REFERENCIA_PRUEBA } from './numeros.js';
import { clienteInventado, motorizadoInventado } from './datos-peru.js';
import { conClaveDePrueba } from './clave-prueba.js';
import { borrarTodoLoDePrueba, contarLoDePrueba } from './limpiar.js';

/** Tope por tanda: mas de esto no ayuda a probar y satura el servidor. */
export const TOPE_POR_TANDA = 500;
export const TOPE_MOTORIZADOS = 100;

export const generarSchema = z.object({
  faltaConfirmar: z.coerce.number().int().min(0).max(TOPE_POR_TANDA).default(0),
  faltaUbicacion: z.coerce.number().int().min(0).max(TOPE_POR_TANDA).default(0),
  motorizados: z.coerce.number().int().min(0).max(TOPE_MOTORIZADOS).default(0),
});

export interface ResultadoGenerar {
  ok: true;
  creados: { faltaConfirmar: number; faltaUbicacion: number; motorizados: number };
  /** A cuantos «falta que confirme» ya se les mando la pregunta. */
  preguntados: number;
  /** La regla del dueño («Solo lo de GSG»): a los de ubicación no se les pregunta SÍ/NO; a los de «falta confirmar», sí. */
  sinPreguntas?: boolean;
  /** Cuántos de los creados esperan que se confirme su envío (nada les sale hasta pulsar «Confirmar el envío»). */
  esperanEnvio: number;
  descartados: Array<{ referencia: string; motivo: string }>;
  detalle: string;
  /** Lo que se mando a la API y lo que contesto (para «Ver lo técnico»). */
  tecnico: { peticion: { metodo: string; ruta: string; pedidos: number; ejemplo: unknown }; respuesta: { status: number; detalle: string } };
}

class ErrorGenerar extends Error {
  constructor(
    readonly status: number,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

/** El siguiente numero libre del rango (clientes o motorizados), para no pisar lo que ya hay. */
async function siguienteIndice(deps: DepsDesarrollador, prefijo: string): Promise<number> {
  const db = deps.repos.desarrollador!;
  const r = await db.query<{ n: number | string | null }>(
    `select max(n) as n from (
       select cast(substring(phone, 7) as signed) as n from contacts where phone like $1 and char_length(phone) = 11
       union all select cast(substring(phone, 7) as signed) from entregas where phone like $1 and char_length(phone) = 11
       union all select cast(substring(phone, 7) as signed) from motorizados where phone like $1 and char_length(phone) = 11
     ) t`,
    [`${prefijo}%`],
  );
  const max = r.rows[0]?.n;
  return max === null || max === undefined ? 1 : Number(max) + 1;
}

export async function generarPrueba(app: FastifyInstance, deps: DepsDesarrollador, pedido: z.infer<typeof generarSchema>, quien: string | null): Promise<ResultadoGenerar> {
  const { faltaConfirmar, faltaUbicacion, motorizados } = pedido;
  if (faltaConfirmar + faltaUbicacion + motorizados === 0) throw new ErrorGenerar(400, 'Elige cuántos clientes o motorizados de prueba quieres crear (al menos uno).');
  if (faltaConfirmar + faltaUbicacion > TOPE_POR_TANDA) throw new ErrorGenerar(400, `Como mucho ${TOPE_POR_TANDA} clientes por tanda. Crea el resto en otra tanda.`);
  if (!deps.entregas) throw new ErrorGenerar(409, 'Las entregas del día no están activas en este arranque: sin ellas no hay a dónde meter los pedidos de prueba.');
  if (!deps.repos.desarrollador) throw new ErrorGenerar(409, 'Esta pantalla necesita la base de datos de la tienda (no funciona en la demostración en memoria).');
  const entregas = deps.entregas;

  const pedidos: Array<Record<string, unknown>> = [];
  let indice = faltaConfirmar + faltaUbicacion > 0 ? await siguienteIndice(deps, PREFIJO_CLIENTE_PRUEBA) : 1;
  const nuevo = (conPin: boolean) => {
    const c = clienteInventado();
    const n = indice++;
    return {
      referencia: `${PREFIJO_REFERENCIA_PRUEBA}${String(n).padStart(5, '0')}`,
      telefono: numeroDePrueba('cliente', n),
      nombre: c.nombre,
      direccion: c.direccion,
      distrito: c.distrito,
      notas: c.notas,
      // Los datos del envio, como los mandara GSG (salen en el primer mensaje al cliente).
      producto: c.producto,
      empresa: c.empresa,
      tracking: c.tracking,
      nroPedido: c.nroPedido,
      metodoPago: c.metodoPago,
      // Obligatorio en el contrato: lo ya pagado va con 0.
      monto: c.metodoPago === 'Pagado' ? 0 : c.monto,
      remitente: c.remitente,
      ...(conPin ? { lat: c.lat, lng: c.lng, faltaUbicacion: false } : { faltaUbicacion: true }),
      faltaConfirmar: true,
    };
  };
  for (let i = 0; i < faltaConfirmar; i++) pedidos.push(nuevo(true));
  for (let i = 0; i < faltaUbicacion; i++) pedidos.push(nuevo(false));

  let status = 0;
  let detalleApi = '';
  const creadas: Array<{ referencia: string; conPin: boolean }> = [];
  const descartados: Array<{ referencia: string; motivo: string }> = [];
  if (pedidos.length) {
    // Por la API, con la clave de prueba: exactamente lo que hara GSG.
    const r = await conClaveDePrueba(deps.repos.claves, quien, (clave) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/entregas',
        headers: { authorization: `Bearer ${clave}`, 'content-type': 'application/json' },
        payload: JSON.stringify({ pedidos }),
      }),
    );
    status = r.statusCode;
    let cuerpo: { creadas?: Array<{ referencia: string }>; descartadas?: Array<{ referencia: string; motivo: string }>; detalle?: string; error?: string } = {};
    try {
      cuerpo = r.json();
    } catch {
      cuerpo = { error: r.body.slice(0, 200) };
    }
    if (status >= 400) throw new ErrorGenerar(502, `La API de entregas no aceptó los pedidos de prueba (respondió ${status}): ${cuerpo.error ?? 'sin motivo'}. Es justo lo que GSG vería: revisa «¿Está listo para GSG?».`);
    detalleApi = cuerpo.detalle ?? '';
    const conPin = new Set(pedidos.filter((p) => 'lat' in p).map((p) => String(p.referencia)));
    for (const c of cuerpo.creadas ?? []) creadas.push({ referencia: c.referencia, conPin: conPin.has(c.referencia) });
    descartados.push(...(cuerpo.descartadas ?? []));
  }

  // «Contactado, falta que confirme»: si su envío no espera (ajuste apagado),
  // se le manda YA la pregunta SÍ/NO (el sender la simula: es un numero de
  // prueba), sin esperar al motor. Si espera, sale al confirmar el envío.
  let preguntados = 0;
  let esperanEnvio = 0;
  const hoy = (await entregas.resumen()).entregas;
  for (const c of creadas) {
    const fila = hoy.find((e) => e.referencia === c.referencia);
    const e = fila ? await deps.repos.entregas.entrega(fila.id) : null;
    if (!e) continue;
    if (e.envioRetenidoAt) {
      esperanEnvio++;
      continue;
    }
    if (!c.conPin || e.confirmacionEstado !== 'pendiente') continue;
    const r = await entregas.pedirConfirmacion(e).catch(() => ({ ok: false }));
    if (r.ok) preguntados++;
  }

  let motos = 0;
  if (motorizados) {
    let m = await siguienteIndice(deps, PREFIJO_MOTORIZADO_PRUEBA);
    for (let i = 0; i < motorizados; i++) {
      const d = motorizadoInventado();
      const r = await entregas.crearMotorizado({ phone: numeroDePrueba('motorizado', m++), nombre: d.nombre, placa: d.placa, zona: d.zona });
      if (r.ok && r.nuevo) motos++;
    }
  }

  const creadosConfirmar = creadas.filter((c) => c.conPin).length;
  const creadosUbicacion = creadas.length - creadosConfirmar;
  const partes = [
    creadosConfirmar ? `${creadosConfirmar} contactado${creadosConfirmar === 1 ? '' : 's'} que falta${creadosConfirmar === 1 ? '' : 'n'} confirmar` : '',
    creadosUbicacion ? `${creadosUbicacion} que falta${creadosUbicacion === 1 ? '' : 'n'} mandar su ubicación` : '',
    motos ? `${motos} motorizado${motos === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return {
    ok: true,
    creados: { faltaConfirmar: creadosConfirmar, faltaUbicacion: creadosUbicacion, motorizados: motos },
    preguntados,
    sinPreguntas: entregas.reglaGsgActiva(),
    esperanEnvio,
    descartados,
    detalle: `Listo: ${partes.join(', ') || 'nada nuevo'}.${esperanEnvio ? ` Esperan que confirmes el envío: ${esperanEnvio} (nada les sale hasta pulsar «📤 Confirmar el envío»).` : ''}${descartados.length ? ` ${descartados.length} no entraron (mira el motivo abajo).` : ''}`,
    tecnico: {
      peticion: { metodo: 'POST', ruta: '/api/v1/entregas', pedidos: pedidos.length, ejemplo: pedidos[0] ?? null },
      respuesta: { status, detalle: detalleApi },
    },
  };
}

export const registerGenerar: RegistrarSeccion = async (app, deps) => {
  app.post('/admin/desarrollador/generar', async (request, reply) => {
    const leido = generarSchema.safeParse(request.body ?? {});
    if (!leido.success) return reply.code(400).send({ error: `Los números no se entienden: cada contador va de 0 a ${TOPE_POR_TANDA} (motorizados, hasta ${TOPE_MOTORIZADOS}).` });
    try {
      // La clave la firma quien la pidio: su id de usuario (la columna es uuid).
      const id = request.usuario?.id;
      return await generarPrueba(app, deps, leido.data, id && /^[0-9a-f-]{36}$/i.test(id) ? id : null);
    } catch (error) {
      if (error instanceof ErrorGenerar) return reply.code(error.status).send({ error: error.message });
      // El arranque corto va sin logger: que el motivo quede en la consola.
      console.error('[desarrollador] fallo generando los de prueba:', error);
      throw error;
    }
  });

  /** «📤 Confirmar el envío» de lo de prueba: lo mismo que el botón de Números del día, solo con los números reservados. */
  app.post('/admin/desarrollador/confirmar-envio', async (request, reply) => {
    if (!deps.entregas) return reply.code(409).send({ error: 'Las entregas del día no están activas en este arranque.' });
    const ids = (await deps.entregas.resumen()).entregas.filter((e) => e.envioRetenidoAt && esNumeroDePrueba(e.phone)).map((e) => e.id);
    if (!ids.length) return { ok: true, liberadas: 0, ubicacion: 0, confirmar: 0, saltadas: 0, aviso: 'No hay ningún cliente de prueba esperando que confirmes el envío.' };
    return deps.entregas.liberarEnvio(ids, request.usuario?.nombre || 'Módulo desarrollador');
  });

  app.get('/admin/desarrollador/prueba', async () => {
    // Solo leer: en la demostracion en memoria no es un error, es que no hay que contar (y la pagina lo dice).
    if (!deps.repos.desarrollador) return { ok: false, sinBase: true, detalle: 'En la demostración en memoria no se crean clientes de prueba: esta parte necesita la base de datos de la tienda. «Probar un proceso» sí funciona aquí.' };
    return { ok: true, ...(await contarLoDePrueba(deps.repos.desarrollador)) };
  });

  app.delete('/admin/desarrollador/prueba', async (_request, reply) => {
    if (!deps.repos.desarrollador) return reply.code(409).send({ error: 'Esta pantalla necesita la base de datos de la tienda (no funciona en la demostración en memoria).' });
    const r = await borrarTodoLoDePrueba(deps.repos.desarrollador);
    const total = r.entregas + r.contactos + r.motorizados;
    return { ok: true, borrado: r, detalle: total ? `Borrado todo lo de prueba: ${r.entregas} pedidos, ${r.contactos} contactos con sus chats, ${r.motorizados} motorizados y ${r.reportes} reportes en cola. Lo real no se tocó.` : 'No había nada de prueba que borrar.' };
  });
};

// ------------------------------------------------------------------ pantalla

const HTML = `
<div class="gen-grid">
  <form class="tarjeta gen-form" id="gen-form" novalidate>
    <h3>Crear clientes de prueba</h3>
    <p class="muted gen-intro">Entran por la API, igual que llegarán los pedidos de GSG. Números reservados (51 000 0…): nada sale al WhatsApp real.</p>
    <div class="gen-contador">
      <label for="gen-confirmar"><b>Falta que confirme</b><span class="muted">GSG ya tiene su dirección: se le pregunta solo SÍ o NO (nunca la ubicación). En el sistema: «esperando confirmación».</span></label>
      <div class="gen-num"><button type="button" class="btn" data-menos="gen-confirmar" aria-label="Uno menos">−</button><input id="gen-confirmar" type="number" inputmode="numeric" min="0" max="${TOPE_POR_TANDA}" value="20"><button type="button" class="btn" data-mas="gen-confirmar" aria-label="Uno más">+</button></div>
    </div>
    <div class="gen-contador">
      <label for="gen-ubicacion"><b>Falta que mande su ubicación</b><span class="muted">Se le pide el pin y todavía no lo mandó. En el sistema: «esperando ubicación».</span></label>
      <div class="gen-num"><button type="button" class="btn" data-menos="gen-ubicacion" aria-label="Uno menos">−</button><input id="gen-ubicacion" type="number" inputmode="numeric" min="0" max="${TOPE_POR_TANDA}" value="20"><button type="button" class="btn" data-mas="gen-ubicacion" aria-label="Uno más">+</button></div>
    </div>
    <div class="gen-contador">
      <label for="gen-motos"><b>Motorizados de prueba</b><span class="muted">Reciben los pedidos listos y contestan desde «Ver el flujo en vivo» (51 000 1…).</span></label>
      <div class="gen-num"><button type="button" class="btn" data-menos="gen-motos" aria-label="Uno menos">−</button><input id="gen-motos" type="number" inputmode="numeric" min="0" max="${TOPE_MOTORIZADOS}" value="5"><button type="button" class="btn" data-mas="gen-motos" aria-label="Uno más">+</button></div>
    </div>
    <div class="gen-rapidos" role="group" aria-label="Cantidades rápidas"><span class="muted">Rápido:</span>
      <button type="button" class="btn sm" data-rapido="10">10 + 10</button><button type="button" class="btn sm" data-rapido="20">20 + 20</button><button type="button" class="btn sm" data-rapido="50">50 + 50</button><button type="button" class="btn sm" data-rapido="250">250 + 250</button>
    </div>
    <p class="muted gen-tope">Tope de seguridad: ${TOPE_POR_TANDA} clientes por tanda y ${TOPE_MOTORIZADOS} motorizados.</p>
    <button type="submit" class="btn primario gen-crear" id="gen-crear">Crear de prueba</button>
    <div class="gen-msg" id="gen-msg" role="status" aria-live="polite"></div>
    <div class="gen-envio" id="gen-envio">
      <p class="muted">Como la lista de GSG, lo que se crea <b>espera a que confirmes el envío</b>: a los de «falta que mande su ubicación» se les pide el pin y a los de «falta que confirme» solo SÍ o NO.</p>
      <button type="button" class="btn primario gen-crear" id="gen-enviar">📤 Confirmar el envío de los de prueba</button>
      <div class="gen-msg" id="gen-enviar-msg" role="status" aria-live="polite"></div>
    </div>
    <details class="gen-tecnico" id="gen-tecnico" hidden><summary>Ver lo técnico</summary><pre id="gen-tecnico-pre"></pre></details>
  </form>

  <section class="tarjeta gen-estado" aria-labelledby="gen-estado-t">
    <h3 id="gen-estado-t">Lo que hay de prueba ahora</h3>
    <div id="gen-cifras" class="gen-cifras"><p class="muted">Cargando…</p></div>
    <div class="gen-borrar">
      <button type="button" class="btn peligro" id="gen-borrar">Borrar todo lo de prueba</button>
      <div class="gen-confirmar-borrar" id="gen-confirmar-borrar" hidden>
        <p><b>¿Borrar todo lo de prueba?</b> Se van los clientes y motorizados de prueba, sus pedidos, chats y reportes en cola. Lo real no se toca.</p>
        <button type="button" class="btn peligro" id="gen-borrar-si">Sí, borrar</button>
        <button type="button" class="btn" id="gen-borrar-no">Cancelar</button>
      </div>
      <div class="gen-msg" id="gen-borrar-msg" role="status" aria-live="polite"></div>
    </div>
  </section>
</div>`;

const CSS = `
  .gen-grid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: var(--esp-3); align-items: start; }
  .gen-form h3, .gen-estado h3 { margin: 0 0 6px; }
  .gen-intro { margin: 0 0 var(--esp-3); }
  .gen-contador { display: flex; gap: var(--esp-2); align-items: center; justify-content: space-between; padding: 12px 0; border-top: 1px solid var(--borde); }
  .gen-contador label { display: grid; gap: 2px; min-width: 0; }
  .gen-contador label .muted { font-size: 13px; }
  .gen-num { display: flex; align-items: center; gap: 4px; flex: none; }
  .gen-num .btn { min-width: 44px; min-height: 44px; font-size: 18px; padding: 0; }
  .gen-num input { width: 76px; min-height: 44px; text-align: center; font: inherit; font-size: 16px; border: 1px solid var(--borde); border-radius: var(--radio-sm); background: var(--superficie); color: var(--texto); }
  .gen-rapidos { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding-top: 10px; border-top: 1px solid var(--borde); }
  .gen-rapidos .btn { min-height: 44px; }
  .gen-tope { font-size: 13px; margin: 10px 0; }
  .gen-crear { width: 100%; min-height: 46px; }
  .gen-envio { margin-top: var(--esp-3); padding-top: var(--esp-3); border-top: 1px solid var(--borde); }
  .gen-envio p { margin: 0 0 10px; font-size: 14px; }
  .gen-msg:not(:empty) { margin-top: 10px; padding: 10px 12px; border-radius: var(--radio-sm); background: var(--verde-suave); font-size: 14px; }
  .gen-msg.mal { background: var(--rojo-suave); color: var(--rojo); }
  .gen-tecnico { margin-top: 10px; }
  .gen-tecnico pre { white-space: pre-wrap; word-break: break-word; font-size: 12px; max-height: 260px; overflow: auto; background: var(--superficie-2); padding: 10px; border-radius: var(--radio-sm); }
  .gen-cifras { display: grid; gap: 6px; margin-bottom: var(--esp-3); }
  .gen-fila { display: flex; justify-content: space-between; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--borde); font-size: 14px; }
  .gen-fila b { font-variant-numeric: tabular-nums; }
  .gen-borrar .btn { min-height: 44px; }
  .gen-confirmar-borrar { margin-top: 10px; padding: 12px; border-radius: var(--radio-sm); background: var(--rojo-suave); }
  .gen-confirmar-borrar p { margin: 0 0 10px; }
  @media (max-width: 860px) { .gen-grid { grid-template-columns: 1fr; } }
`;

/** Como se llama cada estado de una entrega, para quien prueba. */
const JS =
  'var TOPE = ' + String(TOPE_POR_TANDA) + ';\n' +
  String.raw`
  var NOMBRES = {
    pendiente: 'Recién llegados (aún sin procesar)',
    esperando_ubicacion: 'Falta que mande su ubicación',
    esperando_confirmacion: 'Contactado, falta que confirme',
    lista: 'Listos para el motorizado',
    esperando_motorizado: 'Esperando al motorizado',
    avisada: 'Avisados con hora de llegada',
    entregada: 'Entregados',
    terminada: 'Terminados',
    cancelada: 'Cancelados',
    incidencia: 'Necesitan a una persona'
  };
  var $ = function (id) { return document.getElementById(id); };
  function escapar(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  async function pedir(url, opciones) {
    var r;
    try { r = await fetch(url, Object.assign({ credentials: 'same-origin', headers: { 'content-type': 'application/json' } }, opciones || {})); }
    catch (e) { throw new Error('No se pudo hablar con el servidor. Revisa la conexión y vuelve a intentarlo.'); }
    var d = null;
    try { d = await r.json(); } catch (e) { d = null; }
    if (!r.ok) throw new Error((d && d.error) || ('El servidor respondió ' + r.status + '.'));
    return d;
  }

  function avisar(caja, texto, mal) { caja.textContent = texto || ''; caja.classList.toggle('mal', Boolean(mal)); }

  async function pintarCifras() {
    var caja = $('gen-cifras');
    try {
      var d = await pedir('/admin/desarrollador/prueba');
      if (d.sinBase) { caja.innerHTML = '<p class="muted">' + escapar(d.detalle) + '</p>'; $('gen-borrar').disabled = true; return; }
      var filas = Object.keys(NOMBRES).filter(function (k) { return d.porEstado[k]; }).map(function (k) {
        return '<div class="gen-fila"><span>' + escapar(NOMBRES[k]) + '</span><b>' + d.porEstado[k] + '</b></div>';
      });
      filas.unshift('<div class="gen-fila"><span><b>Clientes de prueba</b> (ya se les escribió a ' + d.escritos + ')</span><b>' + d.clientes + '</b></div>');
      filas.push('<div class="gen-fila"><span>Motorizados de prueba</span><b>' + d.motorizados + '</b></div>');
      filas.push('<div class="gen-fila"><span>Reportes para GSG aún en cola</span><b>' + d.reportesPendientes + '</b></div>');
      caja.innerHTML = d.clientes || d.motorizados ? filas.join('') : '<p class="muted">No hay nada de prueba. Crea algunos a la izquierda.</p>';
      $('gen-borrar').disabled = !(d.clientes || d.motorizados || d.reportesPendientes);
    } catch (e) {
      caja.innerHTML = '<p class="gen-msg mal">' + escapar(e.message) + '</p>';
    }
  }

  function numero(id) { var v = parseInt($(id).value, 10); return isNaN(v) || v < 0 ? 0 : v; }
  document.querySelectorAll('[data-mas],[data-menos]').forEach(function (b) {
    b.addEventListener('click', function () {
      var id = b.getAttribute('data-mas') || b.getAttribute('data-menos');
      var caja = $(id);
      var max = parseInt(caja.max, 10);
      var v = numero(id) + (b.hasAttribute('data-mas') ? 1 : -1);
      caja.value = Math.max(0, Math.min(max, v));
    });
  });
  document.querySelectorAll('[data-rapido]').forEach(function (b) {
    b.addEventListener('click', function () { $('gen-confirmar').value = b.getAttribute('data-rapido'); $('gen-ubicacion').value = b.getAttribute('data-rapido'); });
  });

  $('gen-form').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var msg = $('gen-msg');
    var cuerpo = { faltaConfirmar: numero('gen-confirmar'), faltaUbicacion: numero('gen-ubicacion'), motorizados: numero('gen-motos') };
    if (cuerpo.faltaConfirmar + cuerpo.faltaUbicacion > TOPE) { avisar(msg, 'Como mucho ' + TOPE + ' clientes por tanda.', true); return; }
    if (!cuerpo.faltaConfirmar && !cuerpo.faltaUbicacion && !cuerpo.motorizados) { avisar(msg, 'Elige al menos un cliente o motorizado.', true); return; }
    var boton = $('gen-crear');
    boton.disabled = true; boton.textContent = 'Creando… (entran por la API)';
    avisar(msg, '');
    try {
      var d = await pedir('/admin/desarrollador/generar', { method: 'POST', body: JSON.stringify(cuerpo) });
      var extra = d.esperanEnvio ? '' : !d.creados.faltaConfirmar ? '' : ' Ya se le preguntó a ' + d.preguntados + ' de ' + d.creados.faltaConfirmar + ' si reciben hoy.';
      var malos = d.descartados.length ? ' No entraron: ' + d.descartados.slice(0, 3).map(function (x) { return x.referencia + ' (' + x.motivo + ')'; }).join('; ') + '.' : '';
      avisar(msg, d.detalle + extra + malos, d.descartados.length > 0);
      $('gen-tecnico').hidden = false;
      $('gen-tecnico-pre').textContent = JSON.stringify(d.tecnico, null, 2);
      document.dispatchEvent(new CustomEvent('dev:generado', { detail: d.creados }));
      await pintarCifras();
    } catch (e) {
      avisar(msg, e.message, true);
    } finally {
      boton.disabled = false; boton.textContent = 'Crear de prueba';
    }
  });

  $('gen-enviar').addEventListener('click', async function () {
    var msg = $('gen-enviar-msg');
    var boton = this;
    boton.disabled = true;
    try {
      var d = await pedir('/admin/desarrollador/confirmar-envio', { method: 'POST', body: '{}' });
      avisar(msg, d.aviso, !d.liberadas);
      document.dispatchEvent(new CustomEvent('dev:generado', { detail: { enviados: d.liberadas } }));
      await pintarCifras();
    } catch (e) {
      avisar(msg, e.message, true);
    } finally {
      boton.disabled = false;
    }
  });

  $('gen-borrar').addEventListener('click', function () { $('gen-confirmar-borrar').hidden = false; $('gen-borrar-si').focus(); });
  $('gen-borrar-no').addEventListener('click', function () { $('gen-confirmar-borrar').hidden = true; $('gen-borrar').focus(); });
  $('gen-borrar-si').addEventListener('click', async function () {
    var msg = $('gen-borrar-msg');
    this.disabled = true;
    try {
      var d = await pedir('/admin/desarrollador/prueba', { method: 'DELETE' });
      avisar(msg, d.detalle);
      document.dispatchEvent(new CustomEvent('dev:generado', { detail: { borrado: true } }));
    } catch (e) {
      avisar(msg, e.message, true);
    } finally {
      this.disabled = false;
      $('gen-confirmar-borrar').hidden = true;
      await pintarCifras();
    }
  });

  document.addEventListener('dev:pestana', function (e) { if (e.detail === 'generar') pintarCifras(); });
  document.addEventListener('dev:cambio', pintarCifras);
  pintarCifras();
`;

export const seccionGenerar: SeccionDesarrollador = {
  id: 'generar',
  titulo: 'Clientes de prueba',
  resumen: 'Crea clientes y motorizados de prueba: entran por la API como los de GSG. Nada sale al WhatsApp real.',
  html: HTML,
  js: JS,
  css: CSS,
};
