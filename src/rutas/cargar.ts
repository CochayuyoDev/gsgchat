/**
 * Cargar un lote del reparto: de las filas al trabajo del motor.
 *
 * Vivia dentro de `POST /admin/rutas/lotes` y se saco aqui porque ahora hay
 * dos caminos que cargan lotes: la pantalla /rutas (una tabla pegada o un
 * CSV) y los pedidos que GSG manda al modulo de entregas (las filas que
 * GSG dice que faltan de ubicacion). Los dos tienen que hacer exactamente
 * lo mismo con cada cliente: consentimiento, bajas, duplicados, incidencias
 * de lectura. Un lote cargado por GSG que se saltara la baja de un cliente
 * seria el mismo incidente que se evito en la pantalla.
 */

import type { Repos } from '../db/repos.js';
import type { Lote, Solicitud } from '../db/rutas.js';
import type { ServicioEnvioAutomatico } from '../envio-automatico/servicio.js';
import { INCIDENCIAS } from './incidencias.js';
import { payloadIncidencia } from './gsg.js';
import { leerLote, prepararFilas, type FilaLote } from './lote.js';
import type { PlanNumeracion } from './telefono.js';

export interface CargaLote {
  nombre?: string;
  /** La tabla pegada o el contenido del CSV. */
  texto?: string;
  /** Las filas ya estructuradas (por aqui entra GSG). */
  filas?: FilaLote[];
  notas?: string | null;
  externoId?: string | null;
  /** De donde vino: 'csv', 'api', 'gsg'... */
  origen?: string;
  arrancar?: boolean;
}

export interface ResultadoCarga {
  lote: Lote;
  total: number;
  listas: number;
  conIncidencia: number;
  duplicadas: number;
  incidencias: Record<string, number>;
  descartadas: Array<{ linea: number; texto: string; motivo: string }>;
  solicitudes: Solicitud[];
}

export interface DepsCarga {
  repos: Repos;
  plan: PlanNumeracion;
  timezone: string;
  /** La lista de envio automatico: un numero que entra en un lote sale de ella (el reparto se lo queda). */
  lista?: ServicioEnvioAutomatico;
  /** El reloj (el de la tienda; en las pruebas, uno de mentira). */
  ahora?: () => Date;
}

export class ErrorCarga extends Error {}

export async function cargarLote(deps: DepsCarga, body: CargaLote): Promise<ResultadoCarga> {
  const { repos, plan } = deps;
  let filas: FilaLote[] = [];
  let descartadas: Array<{ linea: number; texto: string; motivo: string }> = [];

  if (body.filas?.length) {
    filas = body.filas;
  } else if (body.texto?.trim()) {
    const lectura = leerLote(body.texto);
    filas = lectura.filas;
    descartadas = lectura.descartadas;
  }

  if (!filas.length) {
    throw new ErrorCarga('No se entendió ninguna fila con teléfono. Revisa que la tabla tenga una columna de teléfonos.');
  }

  const preparacion = prepararFilas(filas, plan);
  const nombre = body.nombre?.trim() || `Lote del ${new Date().toLocaleDateString('es-PE', { timeZone: deps.timezone })}`;

  const lote = await repos.rutas.crearLote({
    nombre,
    origen: body.origen ?? (body.filas?.length ? 'api' : 'csv'),
    notas: body.notas ?? null,
    externoId: body.externoId ?? null,
  });
  const creadas = await repos.rutas.agregarSolicitudes(lote.id, preparacion.solicitudes);

  /**
   * El consentimiento de cada cliente del lote.
   *
   * El sistema no deja escribirle a nadie que no haya dado su
   * consentimiento, y eso es lo correcto... salvo que aqui SI lo hay: son
   * clientes que acaban de hacer un pedido y dejaron su telefono para
   * coordinar la entrega. Ese es el consentimiento, y lo que exige la
   * politica es dejar constancia de DONDE salio, no inventarlo.
   *
   * Quien se dio de baja antes NO entra: esa baja manda sobre el pedido, y
   * la solicitud se marca para que la coordine una persona por telefono.
   */
  for (const solicitud of creadas) {
    if (!solicitud.phone) continue;

    const previo = await repos.contacts.getByPhone(solicitud.phone);
    if (previo?.optOutAt) {
      await repos.rutas.actualizarSolicitud(solicitud.id, {
        contactId: previo.id,
        estado: 'incidencia',
        incidencia: 'rechaza_contacto',
        incidenciaDetalle: 'el cliente se dio de baja antes: no se le escribe',
        requiereHumano: true,
      });
      await repos.rutas.registrarEvento(solicitud.id, 'incidencia', 'está dado de baja: la entrega se coordina por teléfono');
      continue;
    }

    // Si ya se le esta pidiendo la ubicacion en otro lote que no termino,
    // no se abre una segunda conversacion por lo mismo: se aparta para
    // que una persona decida (reintentar desde la ficha la vuelve a la cola).
    let abierta = await repos.rutas.abiertaPorTelefono(solicitud.phone, lote.id);
    // Una solicitud de OTRO DIA que quedo abierta no bloquea el pedido de hoy:
    // se cierra como reemplazada y el nuevo sale (paso con un numero real: un
    // pedido de prueba viejo apartaba cada pedido nuevo como incidencia).
    // El dia se cuenta con el MISMO reloj que fecho la solicitud (el de la
    // tienda): con el reloj de la maquina, una prueba que corre antes de las
    // 9:00 de Lima veia la solicitud de hace un momento como «de otro dia».
    const diaLocal = (d: Date | string | null | undefined) =>
      d ? new Intl.DateTimeFormat('en-CA', { timeZone: deps.timezone || 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d)) : '';
    // (Una en «supervision» —el cliente dijo «no soy yo»— sí sigue bloqueando: eso lo decide una persona.)
    if (abierta && abierta.estado !== 'supervision' && abierta.createdAt && diaLocal(abierta.createdAt) < diaLocal(deps.ahora?.() ?? new Date())) {
      await repos.rutas.actualizarSolicitud(abierta.id, { estado: 'cancelado', incidenciaDetalle: `reemplazada por un pedido nuevo${solicitud.referencia ? ` (${solicitud.referencia})` : ''}` });
      await repos.rutas.registrarEvento(abierta.id, 'incidencia', 'llegó un pedido nuevo para este número: esta solicitud de otro día se cierra').catch(() => undefined);
      abierta = null;
    }
    if (abierta && ['pendiente', 'enviado', 'respondio', 'supervision'].includes(abierta.estado)) {
      await repos.rutas.actualizarSolicitud(solicitud.id, {
        estado: 'incidencia',
        incidencia: 'ya_en_curso',
        incidenciaDetalle: `ya tiene una solicitud abierta (${abierta.referencia ? `pedido ${abierta.referencia}` : 'sin pedido'}) en otro lote`,
        requiereHumano: true,
      });
      await repos.rutas.registrarEvento(solicitud.id, 'incidencia', 'ya se le está pidiendo la ubicación en otro lote: no se le escribe dos veces');
      continue;
    }

    const contacto = await repos.contacts.upsertFromInbound(solicitud.phone, solicitud.nombre ?? undefined);
    const detalle = solicitud.referencia ? `pedido ${solicitud.referencia}` : 'pedido sin numero';
    await repos.contacts.setOptIn(solicitud.phone, `reparto: ${detalle} (${lote.nombre})`);
    await repos.rutas.actualizarSolicitud(solicitud.id, { contactId: contacto.id });
    // Si ya estaba en la lista de envio automatico, el reparto se lo queda:
    // no se le pide la ubicacion por dos caminos a la vez.
    if (deps.lista) await deps.lista.alCargarLote(solicitud.phone, { id: lote.id, nombre: lote.nombre }).catch(() => undefined);
  }

  // Las incidencias detectadas al leer el fichero se reportan ya: que un
  // numero venga con ocho digitos es informacion para GSG desde el minuto
  // cero, no cuando termine el lote.
  for (const solicitud of creadas) {
    if (!solicitud.incidencia) continue;
    await repos.rutas.registrarEvento(solicitud.id, 'incidencia', `al cargar el lote: ${solicitud.incidenciaDetalle ?? solicitud.incidencia}`);
    if (INCIDENCIAS[solicitud.incidencia].reportable) {
      await repos.rutas.encolarReporte({
        solicitudId: solicitud.id,
        loteId: lote.id,
        tipo: 'incidencia',
        payload: payloadIncidencia(solicitud, lote),
      });
    }
  }

  if (body.arrancar) await repos.rutas.cambiarEstadoLote(lote.id, 'enviando');

  return {
    lote: (await repos.rutas.lote(lote.id))!,
    total: creadas.length,
    listas: preparacion.listas,
    conIncidencia: preparacion.conIncidencia,
    duplicadas: preparacion.duplicadas,
    incidencias: preparacion.incidencias,
    descartadas,
    solicitudes: creadas,
  };
}
