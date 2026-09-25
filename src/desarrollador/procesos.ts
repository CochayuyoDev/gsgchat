/**
 * Pestaña «Probar un proceso» del Modulo desarrollador.
 *
 * Simula una corrida entera de una plantilla con numeros de prueba
 * (51 900 0…), que NUNCA salen al WhatsApp real: se crea (o se reutiliza) el
 * proceso de la plantilla, se cargan las personas, el motor les escribe (lo
 * de prueba no gasta el ritmo del numero) y cada persona «contesta» por el
 * MISMO camino que un mensaje de verdad (processChange → handlers/inbound.ts →
 * el gancho de procesos), con un guion que cubre los casos que importan:
 *
 *   bien          responde bien a todo
 *   mal           primero manda algo que no vale y luego lo bueno
 *   sin_respuesta no contesta: se le insiste y al final pasa lo que diga el paso
 *   ajena         pregunta otra cosa: recibe el cierre y pasa a una persona
 *   por_que       pregunta «¿para qué?»: se le explica y luego responde bien
 *
 * Devuelve, por persona, la conversacion (lo que le mando el sistema y lo que
 * contesto) y como termino.
 */

import { z } from 'zod';
import type { Paso, PersonaProceso, Proceso } from '../procesos/modelo.js';
import { ESTADOS_PERSONA_VISUALES, ESTADOS_VIVOS } from '../procesos/modelo.js';
import type { ServicioProcesos } from '../procesos/servicio.js';
import { crearSimulador, type EntranteDePrueba } from './simular.js';
import { numeroDePrueba } from './numeros.js';
import type { DepsDesarrollador, RegistrarSeccion, SeccionDesarrollador } from './seccion.js';

export const CASOS = ['bien', 'mal', 'sin_respuesta', 'ajena', 'por_que'] as const;
export type Caso = (typeof CASOS)[number];

export const simularProcesoSchema = z.object({
  plantilla: z.enum(['datos', 'confirmaciones', 'campo', 'cobranza']),
  personas: z.coerce.number().int().min(1).max(20).default(5),
  guion: z.enum(['mezcla', 'bien']).default('mezcla'),
});

export interface ConversacionSimulada {
  telefono: string;
  nombre: string;
  caso: Caso;
  casoNombre: string;
  estado: string;
  estadoNombre: string;
  tono: string;
  motivo: string | null;
  mensajes: Array<{ de: 'sistema' | 'persona'; texto: string }>;
}

export interface ResultadoSimulacion {
  ok: true;
  proceso: { id: number; nombre: string };
  corrida: { id: number; nombre: string };
  conversaciones: ConversacionSimulada[];
  resumen: string;
}

const NOMBRE_CASO: Record<Caso, string> = {
  bien: 'Responde bien',
  mal: 'Primero responde mal',
  sin_respuesta: 'No responde',
  ajena: 'Pregunta otra cosa',
  por_que: 'Pregunta «¿para qué?»',
};

const NOMBRES = ['Ana Prueba', 'Luis Prueba', 'Rosa Prueba', 'Jorge Prueba', 'Carmen Prueba', 'Pedro Prueba', 'Lucía Prueba', 'Mario Prueba', 'Elena Prueba', 'Raúl Prueba'];

/** Hoy (o mañana) como dd/mm/aaaa, en la zona del negocio. */
function fechaLocal(desfaseDias: number, tz: string): string {
  return new Date(Date.now() + desfaseDias * 86_400_000).toLocaleDateString('es-PE', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' });
}
function horaLocal(desfaseMin: number, tz: string): string {
  return new Date(Date.now() + desfaseMin * 60_000).toLocaleTimeString('es-PE', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
}

/** La respuesta buena a un paso. */
export function respuestaBuena(paso: Paso, personaId: number, telefono: string): Array<Omit<EntranteDePrueba, 'phone'>> {
  void telefono;
  if (paso.tipo === 'confirmar') return [{ boton: { id: `proc:${personaId}:si`, title: 'Sí' } }];
  if (paso.tipo === 'avance') return [{ text: 'llegué' }, { text: 'terminé' }];
  switch (paso.dato) {
    case 'ubicacion':
      return [{ location: { latitude: -12.1211, longitude: -77.0297 } }];
    case 'documento_identidad':
      return [{ text: 'mi dni es 45678912' }];
    case 'direccion':
      return [{ text: 'Av. Arequipa 1234, Lince, frente al parque' }];
    case 'numero':
      return [{ text: 'S/ 150' }];
    case 'fecha_hora':
      return [{ text: '26/09 a las 10:00' }];
    case 'foto':
    case 'documento':
    case 'captura_pago':
      return [{ adjunto: 'image' }];
    default:
      return [{ text: 'Aquí va mi respuesta completa' }];
  }
}

/** Algo que no vale para ese paso (y que no es una consulta ajena). */
export function respuestaMala(paso: Paso): Omit<EntranteDePrueba, 'phone'> {
  if (paso.tipo === 'confirmar') return { text: 'tal vez' };
  if (paso.tipo === 'avance') return { text: 'hay mucho tráfico' };
  switch (paso.dato) {
    case 'ubicacion':
      return { text: 'estoy por la iglesia' };
    case 'documento_identidad':
      return { text: '1234567' };
    case 'direccion':
      return { text: 'por ahí' };
    case 'numero':
      return { text: 'no sé' };
    case 'fecha_hora':
      return { text: 'cuando pueda' };
    default:
      return { text: 'ya te mandé' };
  }
}

/** Corre una simulacion completa. `deps` es lo de la tienda; `procesos`, su servicio. */
export async function simularCorrida(deps: DepsDesarrollador, procesos: ServicioProcesos, pedido: z.infer<typeof simularProcesoSchema>): Promise<ResultadoSimulacion> {
  const tz = deps.config.timezone;
  const inicio = new Date(Date.now() - 1000);
  const repo = deps.repos.procesos;
  if (!repo) throw Object.assign(new Error('Los procesos no están disponibles en este arranque.'), { statusCode: 409 });

  // El proceso de la plantilla, reutilizado entre pruebas (con su nombre de prueba).
  const nombre = { datos: 'Pedir y validar datos', confirmaciones: 'Confirmaciones y recordatorios', campo: 'Avisos al personal de campo', cobranza: 'Cobranza y trámites' }[pedido.plantilla] + ' (prueba)';
  let proceso: Proceso | undefined = (await procesos.listar()).find((p) => p.plantilla === pedido.plantilla && p.nombre === nombre);
  if (!proceso) proceso = await procesos.crearDesdePlantilla(pedido.plantilla, nombre);
  else if (proceso.estado !== 'activo') proceso = await procesos.cambiarEstado(proceso.id, 'activo');

  // Las personas: numeros de prueba que no esten en otra corrida viva.
  const filas: string[] = [];
  const usados = new Set((await repo.personas({ estados: ESTADOS_VIVOS, limit: 5000 })).map((p) => p.phone));
  let n = 900;
  for (let i = 0; i < pedido.personas; i++) {
    while (usados.has(numeroDePrueba('cliente', n))) n++;
    const tel = numeroDePrueba('cliente', n++);
    // La cita y el vencimiento: dentro de una hora (el recordatorio sale ya, sin esperar un dia).
    filas.push([tel.slice(2), NOMBRES[i % NOMBRES.length], fechaLocal(0, tz), horaLocal(60, tz), 'Instalación de prueba', 'Av. Arequipa 1234, Lince', 'S/ 150.00', fechaLocal(0, tz)].join(';'));
  }
  const carga = await procesos.cargarPersonas(proceso.id, { nombre: `Simulación ${new Date().toLocaleTimeString('es-PE', { timeZone: tz, hour12: false })}`, texto: `telefono;nombre;fecha;hora;tarea;direccion;monto;vencimiento\n${filas.join('\n')}`, origen: 'prueba' });

  const simulador = crearSimulador(deps);
  const trabajar = async () => {
    for (let i = 0; i < 200; i++) {
      const r = await procesos.tick();
      if (r.accion === 'nada') break;
    }
  };
  await trabajar();

  const personas = (await repo.personas({ corridaId: carga.corrida.id, limit: 100 })).sort((a, b) => a.id - b.id);
  const casoDe = (i: number): Caso => (pedido.guion === 'bien' ? 'bien' : CASOS[i % CASOS.length]!);
  const decir = (p: PersonaProceso, e: Omit<EntranteDePrueba, 'phone'>) => simulador.escribir({ phone: p.phone!, name: p.nombre ?? undefined, ...e });

  // Cada persona recorre sus pasos segun su caso (con tope, por si un paso no avanza).
  for (let i = 0; i < personas.length; i++) {
    const caso = casoDe(i);
    let yaFallo = false;
    let yaPregunto = false;
    for (let vuelta = 0; vuelta < 12; vuelta++) {
      await trabajar();
      const p = await repo.persona(personas[i]!.id);
      if (!p || !p.phone || p.estado !== 'esperando') {
        if (p && p.estado === 'programada') continue;
        break;
      }
      const paso = proceso.pasos[p.paso];
      if (!paso) break;
      if (caso === 'sin_respuesta') {
        // No contesta: se adelanta el reloj de su insistencia hasta agotarlas.
        await repo.actualizarPersona(p.id, { proximoAt: new Date(Date.now() - 1000) });
        continue;
      }
      if (caso === 'ajena') {
        await decir(p, { text: '¿Cuánto cuesta el servicio? Quiero hablar con un asesor' });
        break;
      }
      if (caso === 'por_que' && !yaPregunto) {
        yaPregunto = true;
        await decir(p, { text: '¿Para qué necesitan eso?' });
        continue;
      }
      if (caso === 'mal' && !yaFallo) {
        yaFallo = true;
        await decir(p, respuestaMala(paso));
        continue;
      }
      for (const r of respuestaBuena(paso, p.id, p.phone)) await decir(p, r);
    }
  }
  await trabajar();

  // La conversacion de cada una, tal como quedo en el chat.
  const conversaciones: ConversacionSimulada[] = [];
  for (let i = 0; i < personas.length; i++) {
    const p = (await repo.persona(personas[i]!.id))!;
    const contacto = p.phone ? await deps.repos.contacts.getByPhone(p.phone) : null;
    const mensajes = contacto ? (await deps.repos.messages.listMessages(contacto.id, 200)).filter((m) => new Date(m.createdAt).getTime() >= inicio.getTime()).sort((a, b) => Number(a.id) - Number(b.id)) : [];
    const v = ESTADOS_PERSONA_VISUALES[p.estado];
    conversaciones.push({
      telefono: p.phone ?? p.telefonoCrudo,
      nombre: p.nombre ?? '',
      caso: casoDe(i),
      casoNombre: NOMBRE_CASO[casoDe(i)],
      estado: p.estado,
      estadoNombre: v?.nombre ?? p.estado,
      tono: v?.tono ?? 'gris',
      motivo: p.motivo,
      mensajes: mensajes.map((m) => ({ de: m.direction === 'out' ? 'sistema' : 'persona', texto: String(m.body ?? '') })),
    });
  }
  const cuenta = (e: string) => conversaciones.filter((c) => c.estado === e).length;
  return {
    ok: true,
    proceso: { id: proceso.id, nombre: proceso.nombre },
    corrida: { id: carga.corrida.id, nombre: carga.corrida.nombre },
    conversaciones,
    resumen: `${conversaciones.length} personas de prueba: ${cuenta('completada')} completaron, ${cuenta('persona')} pasaron a una persona, ${cuenta('sin_respuesta') + cuenta('rechazo')} no respondieron o dijeron que no, ${ESTADOS_VIVOS.reduce((s, e) => s + cuenta(e), 0)} siguen en curso. Nada salió al WhatsApp real.`,
  };
}

export const registerProcesosDev: RegistrarSeccion = async (app, deps) => {
  app.post('/admin/desarrollador/procesos/simular', async (request, reply) => {
    const leido = simularProcesoSchema.safeParse(request.body ?? {});
    if (!leido.success) return reply.code(400).send({ error: 'Elige una plantilla y cuántas personas de prueba (de 1 a 20).' });
    if (!deps.procesos) return reply.code(409).send({ error: 'Los procesos no están disponibles en este arranque del sistema.' });
    try {
      return await simularCorrida(deps, deps.procesos, leido.data);
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status && status < 500) return reply.code(status).send({ error: (error as Error).message });
      console.error('[desarrollador] fallo simulando un proceso:', error);
      throw error;
    }
  });
};

// ------------------------------------------------------------------ pantalla

const HTML = `
<div class="pro-grid">
  <form class="tarjeta pro-form" id="pro-form" novalidate>
    <h3>Simular una corrida</h3>
    <p class="muted">Se crea (o se reutiliza) el proceso de la plantilla con «(prueba)» en el nombre, se cargan personas con números reservados (51 900 0…) y cada una contesta sola por el mismo camino que un mensaje de verdad. Nada sale al WhatsApp real.</p>
    <div class="campo"><label for="pro-plantilla">Plantilla</label>
      <select id="pro-plantilla">
        <option value="datos">Pedir y validar datos</option>
        <option value="confirmaciones">Confirmaciones y recordatorios</option>
        <option value="campo">Avisos al personal de campo</option>
        <option value="cobranza">Cobranza y trámites</option>
      </select></div>
    <div class="campo"><label for="pro-personas">Personas de prueba (1 a 20)</label><input id="pro-personas" type="number" inputmode="numeric" min="1" max="20" value="5"></div>
    <div class="campo"><label for="pro-guion">Cómo responden</label>
      <select id="pro-guion">
        <option value="mezcla">Una de cada: bien, primero mal, sin respuesta, otra consulta, «¿para qué?»</option>
        <option value="bien">Todas responden bien</option>
      </select></div>
    <button type="submit" class="btn primario pro-simular" id="pro-simular">Simular la corrida</button>
    <div class="gen-msg" id="pro-msg" role="status" aria-live="polite"></div>
  </form>
  <section class="tarjeta" aria-labelledby="pro-res-t">
    <h3 id="pro-res-t">Lo que pasó</h3>
    <div id="pro-res"><p class="muted">Todavía no simulaste nada.</p></div>
  </section>
</div>`;

const CSS = `
  .pro-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: var(--esp-3); align-items: start; }
  .pro-form { display: grid; gap: 10px; }
  .pro-form h3, .pro-grid h3 { margin: 0; }
  .pro-form .campo { display: grid; gap: 4px; }
  .pro-form label { font-size: 13px; font-weight: 600; }
  .pro-form select, .pro-form input { width: 100%; min-height: 44px; font: inherit; padding: 8px 11px; border: 1px solid var(--borde); border-radius: var(--radio-sm); background: var(--superficie); color: var(--texto); }
  .pro-simular { min-height: 46px; }
  .pro-conv { border-top: 1px solid var(--borde); padding: 10px 0; }
  .pro-conv summary { cursor: pointer; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; min-height: 40px; }
  .pro-burbujas { display: grid; gap: 6px; margin-top: 8px; }
  .pro-b { max-width: 88%; padding: 7px 10px; border-radius: 10px; font-size: 13.5px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .pro-b.sistema { background: var(--primario-suave); justify-self: end; }
  .pro-b.persona { background: var(--superficie-2); justify-self: start; }
  .pro-motivo { color: var(--rojo); font-size: 13px; margin-top: 6px; }
  @media (max-width: 860px) { .pro-grid { grid-template-columns: 1fr; } }
`;

const JS = String.raw`
  var $p = function (id) { return document.getElementById(id); };
  function escP(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  $p('pro-form').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var msg = $p('pro-msg');
    var boton = $p('pro-simular');
    var cuerpo = { plantilla: $p('pro-plantilla').value, personas: Math.max(1, Math.min(20, parseInt($p('pro-personas').value, 10) || 5)), guion: $p('pro-guion').value };
    boton.disabled = true; boton.textContent = 'Simulando…';
    msg.textContent = ''; msg.classList.remove('mal');
    try {
      var r = await fetch('/admin/desarrollador/procesos/simular', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(d.error || 'No se pudo simular (código ' + r.status + ').');
      msg.textContent = d.resumen;
      $p('pro-res').innerHTML = '<p><a class="btn sm" href="/procesos/corrida?id=' + d.corrida.id + '">Abrir la corrida «' + escP(d.corrida.nombre) + '»</a></p>' + d.conversaciones.map(function (c) {
        return '<details class="pro-conv"><summary><b>' + escP(c.nombre) + '</b> <span class="muted">' + escP(c.casoNombre) + '</span> <span class="chip tono-' + escP(c.tono) + '">' + escP(c.estadoNombre) + '</span></summary>' +
          '<div class="pro-burbujas">' + (c.mensajes.length ? c.mensajes.map(function (m) { return '<div class="pro-b ' + m.de + '">' + escP(m.texto) + '</div>'; }).join('') : '<p class="muted">Sin mensajes.</p>') + '</div>' +
          (c.motivo && (c.estado === 'persona' || c.estado === 'sin_respuesta' || c.estado === 'error') ? '<div class="pro-motivo">' + escP(c.motivo) + '</div>' : '') + '</details>';
      }).join('');
    } catch (e) {
      msg.textContent = e.message; msg.classList.add('mal');
    } finally {
      boton.disabled = false; boton.textContent = 'Simular la corrida';
    }
  });
`;

export const seccionProcesos: SeccionDesarrollador = {
  id: 'procesos',
  titulo: 'Probar un proceso',
  resumen: 'Simula una corrida de cada plantilla con números de prueba y mira, persona por persona, qué le escribió el sistema y cómo terminó.',
  html: HTML,
  js: JS,
  css: CSS,
};
