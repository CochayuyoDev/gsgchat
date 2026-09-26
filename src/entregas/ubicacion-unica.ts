/**
 * La ubicacion del cliente tiene UNA sola verdad (regla del dueño, 25/09).
 *
 * Llegue por donde llegue -el pin nativo, un enlace de mapa, el pin con el bot
 * en pausa, la que pone una persona desde el panel, la sincronizacion o el
 * reparto-, en cuanto un telefono tiene su ubicacion registrada:
 *
 *  - TODAS las solicitudes abiertas del reparto de ese telefono pasan a
 *    resueltas y se cortan sus recordatorios;
 *  - las entradas de la lista de envio automatico que le pedian la ubicacion
 *    salen de la lista.
 *
 * Y al reves: lo que ya no espera a nadie (un pedido cancelado, un «no soy
 * yo», el cierre del dia) suelta sus solicitudes para que el reparto no le
 * siga escribiendo.
 *
 * Aqui solo se usan los repos (ni el sender ni los servicios): lo llaman las
 * entregas, la lectura de respuestas del reparto y, como red de seguridad,
 * los dos motores antes de mandar un recordatorio.
 */

import type { Repos } from '../db/repos.js';
import type { EstadoSolicitud, Solicitud } from '../db/rutas.js';
import type { CodigoIncidencia } from '../rutas/incidencias.js';
import type { Entrega } from './repo.js';

/** Las solicitudes que todavia esperan algo del cliente (o de una persona). */
export const ESTADOS_SOLICITUD_ABIERTA: EstadoSolicitud[] = ['pendiente', 'enviado', 'respondio', 'supervision', 'derivado'];
/** Las que el motor del reparto todavia va a escribir. */
export const ESTADOS_SOLICITUD_VIVA: EstadoSolicitud[] = ['pendiente', 'enviado', 'respondio'];

export interface UbicacionRegistrada {
  lat: number;
  lng: number;
  mapsUrl?: string | null;
  fuente?: string | null;
}

/** El dia (AAAA-MM-DD) en el reloj del negocio. */
export function diaEnZona(fecha: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(fecha).slice(0, 10);
  } catch {
    return fecha.toISOString().slice(0, 10);
  }
}

/** Todas las solicitudes abiertas de ese telefono, de todos los lotes. */
export async function solicitudesAbiertasDe(repos: Repos, phone: string): Promise<Solicitud[]> {
  if (!phone) return [];
  const lista = await repos.rutas.listarSolicitudes({ q: phone, estados: ESTADOS_SOLICITUD_ABIERTA, limit: 100, offset: 0 }).catch(() => [] as Solicitud[]);
  return lista.filter((s) => s.phone === phone && ESTADOS_SOLICITUD_ABIERTA.includes(s.estado));
}

/**
 * La ubicacion que ese cliente ya dio hoy (no la que tenia GSG), o null. La
 * consultan los motores antes de pedirla: si ya esta, no se pide.
 */
export async function ubicacionYaRegistrada(repos: Repos, phone: string | null | undefined, dia: string): Promise<Entrega | null> {
  if (!phone) return null;
  const repo = repos.entregas as Partial<Repos['entregas']> | undefined;
  if (!repo || typeof repo.ubicacionDelClienteDelDia !== 'function') return null;
  return repo.ubicacionDelClienteDelDia(phone, dia).catch(() => null);
}

/**
 * La ubicacion ya esta registrada: las solicitudes abiertas de ese telefono
 * pasan a resueltas (con ese punto) y sin recordatorios, y la lista de envio
 * automatico deja de pedirsela. Devuelve cuantas solicitudes cerro.
 */
export async function resolverPorUbicacion(repos: Repos, phone: string, ubicacion: UbicacionRegistrada, opts: { ahora: Date; motivo: string; excepto?: number[]; soloVivas?: boolean }): Promise<Solicitud[]> {
  const cerradas: Solicitud[] = [];
  for (const s of await solicitudesAbiertasDe(repos, phone)) {
    if (opts.excepto?.includes(s.id)) continue;
    // `soloVivas`: lo que el motor todavia iba a escribir; lo que ya paso a una persona se deja.
    if (opts.soloVivas && !ESTADOS_SOLICITUD_VIVA.includes(s.estado)) continue;
    const actualizada = await repos.rutas
      .actualizarSolicitud(s.id, {
        estado: 'resuelto',
        lat: ubicacion.lat,
        lng: ubicacion.lng,
        mapsUrl: ubicacion.mapsUrl ?? null,
        ubicacionFuente: ubicacion.fuente ?? 'whatsapp',
        resueltoAt: opts.ahora,
        proximoIntentoAt: null,
        requiereHumano: false,
        incidencia: null,
        incidenciaDetalle: null,
      })
      .catch(() => null);
    if (!actualizada) continue;
    await repos.rutas.registrarEvento(s.id, 'ubicacion', `ubicación ya registrada (${ubicacion.fuente ?? 'whatsapp'}): ${opts.motivo}; no se le vuelve a pedir`, { lat: ubicacion.lat, lng: ubicacion.lng }).catch(() => undefined);
    cerradas.push(actualizada);
  }
  await sacarDeLaLista(repos, phone, 'mandó su ubicación', opts.ahora);
  return cerradas;
}

/**
 * Lo que ya no espera nada del cliente: sus solicitudes abiertas dejan de
 * pedirle la ubicacion. `estado`: 'cancelado' (el pedido ya no va) o
 * 'supervision' (lo ve una persona: «no soy yo»). Devuelve las que cambio.
 */
export async function soltarSolicitudes(repos: Repos, phone: string, opts: { ahora: Date; motivo: string; estado: 'cancelado' | 'supervision'; incidencia?: CodigoIncidencia | null; soloVivas?: boolean }): Promise<Solicitud[]> {
  const cambiadas: Solicitud[] = [];
  for (const s of await solicitudesAbiertasDe(repos, phone)) {
    if (opts.soloVivas && !ESTADOS_SOLICITUD_VIVA.includes(s.estado)) continue;
    const actualizada = await repos.rutas
      .actualizarSolicitud(s.id, {
        estado: opts.estado,
        proximoIntentoAt: null,
        requiereHumano: opts.estado === 'supervision',
        ...(opts.incidencia !== undefined ? { incidencia: opts.incidencia } : {}),
        incidenciaDetalle: opts.motivo.slice(0, 300),
      })
      .catch(() => null);
    if (!actualizada) continue;
    await repos.rutas.registrarEvento(s.id, opts.estado === 'cancelado' ? 'nota' : 'incidencia', `${opts.motivo}: ya no se le pide la ubicación`).catch(() => undefined);
    cambiadas.push(actualizada);
  }
  await sacarDeLaLista(repos, phone, opts.motivo, opts.ahora);
  return cambiadas;
}

/**
 * El pedido va con un motorizado aunque falte la ubicacion (el cierre le dio
 * su numero, o una persona lo asigno a mano): sus solicitudes abiertas dejan
 * de recordarle la ubicacion y ya no «necesitan a alguien» (lo coordina el
 * motorizado por telefono); la lista de envio automatico lo suelta. Si
 * despues manda el pin, `resolverPorUbicacion` las cierra como siempre.
 */
export async function apartarPorMotorizado(repos: Repos, phone: string, opts: { ahora: Date; motivo: string }): Promise<Solicitud[]> {
  const cambiadas: Solicitud[] = [];
  for (const s of await solicitudesAbiertasDe(repos, phone)) {
    const actualizada = await repos.rutas
      .actualizarSolicitud(s.id, {
        estado: 'supervision',
        proximoIntentoAt: null,
        requiereHumano: false,
        incidencia: null,
        incidenciaDetalle: opts.motivo.slice(0, 300),
      })
      .catch(() => null);
    if (!actualizada) continue;
    await repos.rutas.registrarEvento(s.id, 'nota', `${opts.motivo}: ya no se le recuerda la ubicación`).catch(() => undefined);
    cambiadas.push(actualizada);
  }
  await sacarDeLaLista(repos, phone, opts.motivo, opts.ahora);
  return cambiadas;
}

/** Las entradas de la lista de envio automatico que le pedian la ubicacion salen. */
async function sacarDeLaLista(repos: Repos, phone: string, motivo: string, ahora: Date): Promise<void> {
  const lista = repos.envioAutomatico as Partial<Repos['envioAutomatico']> | undefined;
  if (!lista || typeof lista.porTelefono !== 'function') return;
  const entrada = await lista.porTelefono(phone).catch(() => null);
  if (!entrada || (entrada.que !== 'ubicacion' && entrada.hasta !== 'ubicacion')) return;
  const quitada = await lista.quitar!(entrada.id).catch(() => null);
  if (!quitada) return;
  await lista.anotarMovimiento!({ phone, nombre: entrada.nombre, tipo: 'salio', motivo, origen: 'sistema', at: ahora }).catch(() => undefined);
}
