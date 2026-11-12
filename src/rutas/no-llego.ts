/**
 * Un mensaje del pedido que WhatsApp NO entregó, avisado después de salir.
 *
 * El caso que lo motivó (11/11): a una clienta se le mandaron tres mensajes
 * pidiendo la ubicación. Meta los aceptó al enviarlos y minutos después avisó
 * por el webhook que no los entregaba. Como al enviar todo había ido «bien»:
 *   - el reparto los contó como intentos y acabó en «no contestó a 3 mensajes»,
 *   - el primer mensaje del pedido quedó como «enviado» en la API de entregas,
 *   - y nadie supo que había que llamarla.
 *
 * Aquí se escucha `mensaje.estado` con `failed` y, si ese mensaje era de un
 * pedido del reparto:
 *   - deja de contar como intento (el cliente no recibió nada),
 *   - el pedido pasa a incidencia con el motivo en palabras (a GSG le llega como
 *     cualquier incidencia del reparto), salvo un fallo pasajero de WhatsApp,
 *     que se reintenta solo en unos minutos,
 *   - y el primer mensaje del pedido pasa a «fallido», con el botón «Reintentar».
 *
 * Nada de esto puede tumbar al que avisó: cada paso va protegido y lo que falle
 * se apunta en el log.
 */

import type { Repos } from '../db/repos.js';
import type { Bus } from '../eventos/bus.js';
import type { ErrorDeEnvio } from '../whatsapp/errores-envio.js';
import type { Solicitud } from '../db/rutas.js';
import { anotarIncidenciaDeSolicitud } from './motor.js';
import { incidenciaDeErrorDeEnvio } from './incidencias.js';
import { despertarMotorRutas } from './despertador.js';

export interface DepsNoLlego {
  repos: Repos;
  ahora?: () => Date;
  log?: (mensaje: string, detalle?: Record<string, unknown>) => void;
  /** Cuánto esperar entre búsquedas cuando el aviso llega antes que el mensaje (pruebas: 0). */
  esperasMs?: number[];
}

export type ResultadoNoLlego =
  /** No es un mensaje de un pedido del reparto (un chat, una campaña...): nada que hacer aquí. */
  | 'no_es_del_reparto'
  /** Ya se trató antes (el mismo aviso repetido). */
  | 'ya_anotado'
  /** El pedido ya se resolvió (dio su ubicación, se canceló...): solo queda anotado. */
  | 'ya_no_aplica'
  /** Fallo pasajero de WhatsApp: se vuelve a intentar solo. */
  | 'reintento'
  /** Queda en incidencia para que una persona decida (llamar, corregir el número...). */
  | 'incidencia';

const VIVAS = new Set(['pendiente', 'enviado', 'respondio']);

/** Espera de un reintento por fallo pasajero de WhatsApp. */
const ESPERA_REINTENTO_MS = 5 * 60_000;

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** La solicitud del reparto a la que pertenece ese mensaje, o null. */
async function solicitudDelMensaje(repos: Repos, wamid: string): Promise<{ solicitud: Solicitud; yaAnotado: boolean } | null> {
  const ref = await repos.messages.referenciaVisiblePorWamid(wamid, new Date(0));
  if (!ref) return null;
  const contacto = await repos.contacts.getById(ref.contactId);
  if (!contacto?.phone) return null;
  const solicitud = await repos.rutas.abiertaPorTelefono(contacto.phone);
  if (!solicitud) return null;
  const eventos = await repos.rutas.eventos(solicitud.id, 500);
  const deEsteMensaje = (e: { payload: Record<string, unknown> | null }) => e.payload?.wamid === wamid;
  if (!eventos.some((e) => e.tipo === 'envio' && deEsteMensaje(e))) return null;
  const yaAnotado = eventos.some((e) => e.tipo === 'incidencia' && deEsteMensaje(e) && e.payload?.noLlego === true);
  return { solicitud, yaAnotado };
}

/**
 * Lo que se hace con un mensaje que WhatsApp no entregó. Devuelve qué pasó,
 * para las pruebas y el log. Nunca lanza.
 */
export async function mensajeNoLlego(deps: DepsNoLlego, wamid: string, error: ErrorDeEnvio | null): Promise<ResultadoNoLlego> {
  const { repos } = deps;
  const ahora = deps.ahora ?? (() => new Date());
  const motivo = error?.motivo ?? 'WhatsApp no dio el motivo.';
  const codigo = incidenciaDeErrorDeEnvio(`${error?.titulo ?? ''} ${motivo}`, error?.codigo ?? null);
  // Un fallo pasajero de WhatsApp (error interno, servicio caído, ritmo): se reintenta solo.
  const pasajero = error?.reintentar === 'si' && codigo === 'error_envio';
  const reintentoAt = new Date(ahora().getTime() + ESPERA_REINTENTO_MS);

  // El aviso puede llegar antes de que el mensaje se guarde y el reparto apunte
  // su envío: se busca unas veces más, con esperas crecientes.
  let encontrada: Awaited<ReturnType<typeof solicitudDelMensaje>> = null;
  let primerMensajeHecho = false;
  for (const espera of [0, ...(deps.esperasMs ?? [3_000, 10_000, 30_000])]) {
    if (espera) await dormir(espera);
    // El primer mensaje del pedido (API de entregas): de «enviado» a «reintentando» o «fallido».
    // Una sola vez, en cuanto el mensaje existe (puede no ser del reparto: la confirmación también cuenta).
    if (!primerMensajeHecho) {
      try {
        primerMensajeHecho = await primerMensajeNoLlego(deps, wamid, error, pasajero ? reintentoAt : null);
      } catch (e) {
        deps.log?.('no se pudo marcar el primer mensaje como no entregado', { wamid, detalle: String(e) });
      }
    }
    try {
      encontrada = await solicitudDelMensaje(repos, wamid);
    } catch (e) {
      deps.log?.('no se pudo buscar el pedido de un mensaje no entregado', { wamid, detalle: String(e) });
      encontrada = null;
    }
    if (encontrada) break;
  }
  if (!encontrada) return 'no_es_del_reparto';
  const { solicitud, yaAnotado } = encontrada;
  if (yaAnotado) return 'ya_anotado';

  const marca = { wamid, noLlego: true, codigo: error?.codigo ?? null };
  const detalle = `WhatsApp no le entregó el mensaje (no cuenta como intento): ${motivo}`.slice(0, 300);

  if (!VIVAS.has(solicitud.estado)) {
    await repos.rutas.registrarEvento(solicitud.id, 'incidencia', detalle, marca);
    return 'ya_no_aplica';
  }

  // El cliente no recibió nada: ese intento no cuenta. Sin ningún mensaje
  // recibido, vuelve a «pendiente» (el siguiente que salga es el primero).
  const intentos = Math.max(0, solicitud.intentos - 1);
  const estado = intentos === 0 && solicitud.estado === 'enviado' ? 'pendiente' : solicitud.estado;

  if (pasajero) {
    await repos.rutas.actualizarSolicitud(solicitud.id, {
      intentos,
      estado,
      proximoIntentoAt: reintentoAt,
      incidencia: 'error_envio',
      incidenciaDetalle: detalle,
    });
    await repos.rutas.registrarEvento(solicitud.id, 'incidencia', `${detalle} Se reintenta solo en unos minutos.`, marca);
    despertarMotorRutas();
    return 'reintento';
  }

  // Lo demás no se arregla insistiendo (fuera de las 24 h, número sin WhatsApp,
  // límite de Meta, plantilla...): una persona decide. Queda en incidencia, con
  // el motivo, y a GSG le llega como cualquier incidencia del reparto.
  const actualizada = await repos.rutas.actualizarSolicitud(solicitud.id, { intentos, estado });
  await repos.rutas.registrarEvento(solicitud.id, 'incidencia', detalle, marca);
  await anotarIncidenciaDeSolicitud({ repos, ahora, log: deps.log }, actualizada ?? { ...solicitud, intentos, estado }, codigo, detalle);
  despertarMotorRutas();
  return 'incidencia';
}

/**
 * El primer mensaje de un pedido de GSG que salió con este id. Con un fallo
 * pasajero (`reintentoAt`) pasa a «reintentando» y el reparto lo vuelve a
 * mandar solo; si no, a «fallido» con su motivo y el botón «Reintentar».
 */
/** Devuelve true cuando ya no hay que volver a mirar (el mensaje existe); false si todavía no se guardó. */
async function primerMensajeNoLlego(deps: DepsNoLlego, wamid: string, error: ErrorDeEnvio | null, reintentoAt: Date | null): Promise<boolean> {
  const { repos } = deps;
  const ref = await repos.messages.referenciaVisiblePorWamid(wamid, new Date(0));
  if (!ref) return false;
  const contacto = await repos.contacts.getById(ref.contactId);
  if (!contacto?.phone || typeof repos.entregas?.vivasPorTelefono !== 'function') return true;
  const vivas = await repos.entregas.vivasPorTelefono(contacto.phone);
  const motivo = `No le llegó: ${error?.motivo ?? 'WhatsApp no dio el motivo.'}`.slice(0, 500);
  let marcado = false;
  for (const e of vivas) {
    if (e.mensajeWamid !== wamid || e.mensajeEstado !== 'enviado') continue;
    marcado = true;
    if (reintentoAt) {
      await repos.entregas.cambiarMensaje(e.id, ['enviado'], {
        mensajeEstado: 'reintentando',
        mensajeProximoAt: reintentoAt,
        mensajeErrorCodigo: error?.codigo ? `whatsapp_${error.codigo}` : 'whatsapp_temporal',
        mensajeError: motivo,
        mensajePermanente: false,
      });
      continue;
    }
    await repos.entregas.cambiarMensaje(e.id, ['enviado'], {
      mensajeEstado: 'fallido',
      mensajeProximoAt: null,
      mensajeErrorCodigo: error?.codigo ? `rechazado_${error.codigo}` : 'rechazado',
      mensajeError: motivo,
      mensajePermanente: error?.reintentar === 'no',
    });
  }
  // Un pedido que todavía está «enviando»: puede que aún no haya apuntado el id de su mensaje. Se vuelve a mirar.
  return marcado || !vivas.some((e) => e.mensajeEstado === 'enviando');
}

/**
 * Engancha el manejador al bus. Devuelve la función que lo desengancha.
 * Los avisos de un mismo mensaje se tratan uno detrás de otro.
 */
export function vigilarMensajesNoEntregados(bus: Bus, deps: DepsNoLlego): () => void {
  const enCurso = new Set<string>();
  return bus.escuchar('mensaje.estado', async (ev) => {
    if (ev.estado !== 'failed' || !ev.mensajeId || enCurso.has(ev.mensajeId)) return;
    enCurso.add(ev.mensajeId);
    try {
      const r = await mensajeNoLlego(deps, ev.mensajeId, ev.error ?? null);
      if (r !== 'no_es_del_reparto') deps.log?.('mensaje del reparto no entregado', { wamid: ev.mensajeId, resultado: r, codigo: ev.error?.codigo ?? null });
    } catch (e) {
      deps.log?.('fallo al tratar un mensaje no entregado', { wamid: ev.mensajeId, detalle: String(e) });
    } finally {
      enCurso.delete(ev.mensajeId);
    }
  });
}
