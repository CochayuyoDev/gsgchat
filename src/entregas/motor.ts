/**
 * El que mueve las entregas: cuando se sincroniza con GSG, cuando se pide
 * una confirmacion y cuando se le manda un pedido a un motorizado.
 *
 * Es hermano del motor del reparto y del de la lista, y sigue sus reglas
 * porque el numero es uno solo y WhatsApp lo mira entero:
 *
 *  1. Un envio por pasada, con la pausa sorteada del reparto entre uno y
 *     el siguiente. Los mensajes a los motorizados tambien pasan por aqui:
 *     son diez numeros de la casa, pero salen del mismo WhatsApp.
 *  2. En horario (el del reparto). Fuera de la franja no se le escribe a
 *     ningun cliente. A un motorizado que YA tiene un pedido entre manos si
 *     se le insiste fuera de horario: la entrega esta en la calle.
 *  3. Con final. Las confirmaciones sin respuesta y los motorizados que no
 *     contestan tienen su tope y pasan a otro o a una persona.
 *
 * Ademas, cada pocos minutos (ajuste "sincronizar cada"), le pide a GSG los
 * pendientes del dia, revisa lo que el reparto dio por perdido y, a la hora
 * del cierre, cierra el dia de ayer. Lo que este fichero NO hace es leer
 * respuestas: eso es de `servicio.alTexto` y `servicio.alUbicacion`, desde
 * el manejador de entrantes.
 */

import type { Repos } from '../db/repos.js';
import type { Monitor } from '../salud/monitor.js';
import type { Politica } from '../salud/politica.js';
import { decidirRitmo } from '../salud/ritmo.js';
import { ajustesPorDefecto, aplicarAjustes } from '../rutas/ajustes.js';
import { enHorario, type OpcionesMotor } from '../rutas/motor.js';
import type { ServicioEntregas } from './servicio.js';

export interface MotorEntregasDeps {
  repos: Repos;
  entregas: ServicioEntregas;
  opciones: OpcionesMotor;
  salud?: Monitor;
  politica?: () => Politica;
  ahora?: () => Date;
  azar?: () => number;
  log?: (mensaje: string, detalle?: Record<string, unknown>) => void;
}

export interface ResultadoTickEntregas {
  accion: 'nada' | 'confirmacion' | 'propuesta' | 'motorizado' | 'insistencia_motorizado' | 'aviso' | 'incidencia' | 'sincronizacion' | 'cierre';
  entregaId?: number;
  motivo?: string;
}

export interface MotorEntregas {
  tick(): Promise<ResultadoTickEntregas>;
  /** Sincroniza con GSG si toca (o si se fuerza). */
  sincronizarSiToca(forzar?: boolean): Promise<boolean>;
  proximoEnvioEn(): number;
  parado(): string | null;
  enHorario(): boolean;
}

export function crearMotorEntregas(deps: MotorEntregasDeps): MotorEntregas {
  const { repos, entregas } = deps;
  const ahora = deps.ahora ?? (() => new Date());
  const azar = deps.azar ?? Math.random;
  const log = deps.log ?? (() => undefined);

  let opciones: OpcionesMotor = deps.opciones;
  let ultimoEnvio = 0;
  let pausaActual = opciones.pausaMinSegundos * 1000;
  let ultimaSync = 0;
  let ultimaRevision = 0;
  let ultimoMotivo: string | null = null;

  function sortearPausa(): number {
    const min = Math.max(1, opciones.pausaMinSegundos);
    const max = Math.max(min, opciones.pausaMaxSegundos);
    return Math.round((min + azar() * (max - min)) * 1000);
  }

  function pausaEfectiva(): number {
    const factor = deps.salud?.factor() ?? 1;
    return pausaActual / Math.max(factor, 0.05);
  }

  async function refrescar(): Promise<void> {
    try {
      const ajustes = await repos.rutas.ajustes.get(ajustesPorDefecto(deps.opciones));
      opciones = aplicarAjustes(deps.opciones, ajustes);
    } catch (error) {
      log('no se pudieron leer los ajustes del reparto para las entregas', { detalle: String(error) });
    }
  }

  async function sincronizarSiToca(forzar = false): Promise<boolean> {
    const cada = entregas.ajustes().sincronizarCadaMin * 60_000;
    const t = ahora().getTime();
    if (!forzar && ultimaSync && t - ultimaSync < cada) return false;
    ultimaSync = t;
    try {
      const r = await entregas.sincronizar();
      if (!r.ok) log('la sincronización con GSG no salió', { detalle: r.detalle });
    } catch (error) {
      log('falló la sincronización con GSG', { detalle: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  const anotarEnvio = () => {
    ultimoEnvio = ahora().getTime();
    pausaActual = sortearPausa();
  };

  /**
   * Un envio frenado (ritmo, horario del numero, WhatsApp caido) vuelve
   * a intentarse cuando el sender dijo, no en la siguiente vuelta: si no,
   * cada 3 s se apuntaba un intento frenado en el historial.
   */
  const frenadas = new Map<number, number>();
  const frenada = (id: number) => (frenadas.get(id) ?? 0) > ahora().getTime();
  const frenar = (id: number, ms: number | undefined) => frenadas.set(id, ahora().getTime() + Math.max(15_000, ms ?? 60_000));

  /**
   * La franja en la que este motor escribe: la del reparto (variables de
   * arranque) AMPLIADA con el horario de entregas de la pantalla (desde /
   * horario extendido hasta). Sin esto, a las 19:00 el sistema dejaba de
   * mandar pines a los motorizados aunque GSG entregue hasta las 22:00.
   */
  const opcionesVigentes = (): OpcionesMotor => {
    const h = entregas.ajustes().horarioEntregas;
    const desde = Number((h?.desde ?? '').slice(0, 2));
    const hasta = Number((h?.extendidoHasta ?? h?.hasta ?? '').slice(0, 2));
    const minutosHasta = Number((h?.extendidoHasta ?? h?.hasta ?? '').slice(3, 5));
    if (!Number.isFinite(desde) || !Number.isFinite(hasta)) return opciones;
    return {
      ...opciones,
      horaInicio: Math.min(opciones.horaInicio, Math.max(0, desde)),
      horaFin: Math.max(opciones.horaFin, Math.min(24, hasta + (minutosHasta > 0 ? 1 : 0))),
    };
  };

  /** Lo que se mira cada minuto: el reparto (ubicaciones que llegaron por ahi) y las segundas visitas sin respuesta. */
  async function revisar(): Promise<void> {
    await entregas.revisarReparto().catch((error) => log('no se pudo revisar el reparto', { detalle: String(error) }));
    await entregas.revisarSegundasVisitas().catch((error) => log('no se pudieron revisar las segundas visitas', { detalle: String(error) }));
    await entregas.revisarPropuestas().catch((error) => log('no se pudieron revisar las direcciones propuestas', { detalle: String(error) }));
  }

  const motor: MotorEntregas = {
    proximoEnvioEn: () => Math.max(0, ultimoEnvio + pausaEfectiva() - Date.now()),
    parado: () => ultimoMotivo,
    enHorario: () => enHorario(ahora(), opcionesVigentes()),
    sincronizarSiToca,

    async tick() {
      const momento = ahora();
      await refrescar();

      // GSG y el reparto, cada pocos minutos: no dependen del ritmo de envio.
      if (await sincronizarSiToca()) {
        // La revision del reparto va pegada a la sincronizacion.
        ultimaRevision = momento.getTime();
        await revisar();
      } else if (momento.getTime() - ultimaRevision > 60_000) {
        ultimaRevision = momento.getTime();
        await revisar();
      }

      // El cierre del dia: una vez al dia, a la hora del ajuste. Lo que hace
      // (incidencias de ayer, entregadas por cierre) no manda mensajes a
      // clientes, asi que no cuenta como envio ni respeta la pausa.
      try {
        if (await entregas.cerrarDiaSiToca()) return { accion: 'cierre', motivo: 'se cerró el día de ayer' };
      } catch (error) {
        log('no se pudo cerrar el día', { detalle: error instanceof Error ? error.message : String(error) });
      }

      const vigentes = opcionesVigentes();
      const dentroDeHorario = enHorario(momento, vigentes);

      if (ultimoEnvio && momento.getTime() - ultimoEnvio < pausaEfectiva()) {
        ultimoMotivo = null;
        return { accion: 'nada', motivo: 'esperando la pausa entre mensajes' };
      }
      if (deps.salud && deps.salud.factor() <= 0) {
        ultimoMotivo = 'el monitor de salud tiene el número parado';
        return { accion: 'nada', motivo: ultimoMotivo };
      }

      // 1. Los motorizados: un pedido listo sale antes que una confirmacion
      //    nueva, porque ya tiene todo y el cliente espera su hora.
      for (const e of await listaMotorizado()) {
        if (frenada(e.id)) continue;
        // (una apartada por falta de motorizado se reintenta sola: si ya hay uno, sale de la incidencia)
        if (e.estado === 'lista' || (e.estado === 'incidencia' && (e.incidencia === 'sin_motorizado' || (e.incidencia === 'consulta_ajena' && Boolean(e.motorizadoSinUbicacionAt) && e.ubicacionEstado === 'pendiente')))) {
          if (!dentroDeHorario) {
            ultimoMotivo = `fuera del horario de envío (${vigentes.horaInicio}:00 a ${vigentes.horaFin}:00)`;
            continue;
          }
          const r = await entregas.mandarAMotorizado(e);
          if (r.ok) {
            anotarEnvio();
            ultimoMotivo = null;
            return { accion: 'motorizado', entregaId: e.id };
          }
          if (r.retryAfterMs) {
            ultimoMotivo = r.motivo ?? null;
            frenar(e.id, r.retryAfterMs);
            continue;
          }
          return { accion: 'incidencia', entregaId: e.id, motivo: r.motivo };
        }
        // El motorizado ya dio su tiempo pero el aviso al cliente quedo
        // esperando su turno (el ritmo del numero): se vuelve a intentar.
        if (e.motorizadoEstado === 'respondio') {
          const r = await entregas.reintentarAviso(e);
          if (r.ok) {
            anotarEnvio();
            ultimoMotivo = null;
            return { accion: 'aviso', entregaId: e.id };
          }
          if (r.retryAfterMs) {
            ultimoMotivo = r.motivo ?? null;
            frenar(e.id, r.retryAfterMs);
            continue;
          }
          return { accion: 'incidencia', entregaId: e.id, motivo: r.motivo };
        }
        // Esperando a un motorizado que no contesta: se le insiste aunque
        // sea tarde, el pedido ya esta en marcha.
        const r = await entregas.atenderMotorizadoQueNoContesta(e);
        if (r.ok) {
          anotarEnvio();
          return { accion: 'insistencia_motorizado', entregaId: e.id, motivo: r.motivo };
        }
        if (r.retryAfterMs) continue;
        return { accion: 'incidencia', entregaId: e.id, motivo: r.motivo };
      }

      // 2. Las confirmaciones que toca pedir (y, antes, las direcciones que
      //    se le proponen a un cliente recurrente: es su "pedir ubicacion").
      if (!dentroDeHorario) {
        ultimoMotivo = `fuera del horario de envío (${vigentes.horaInicio}:00 a ${vigentes.horaFin}:00)`;
        return { accion: 'nada', motivo: ultimoMotivo };
      }
      for (const e of await repos.entregas.tocaProponerUbicacion(momento, 1)) {
        const r = await entregas.proponerUbicacion(e);
        if (r.ok) {
          anotarEnvio();
          ultimoMotivo = null;
          return { accion: 'propuesta', entregaId: e.id };
        }
        if (r.retryAfterMs) ultimoMotivo = r.motivo ?? null;
      }
      const [siguiente] = await listaConfirmacion(momento);
      if (!siguiente) {
        ultimoMotivo = null;
        return { accion: 'nada', motivo: 'no hay nada pendiente' };
      }
      if (deps.salud && deps.politica) {
        const contacto = await repos.contacts.upsertFromInbound(siguiente.phone);
        const decision = decidirRitmo(await deps.salud.fotoRitmo(contacto, momento), deps.politica());
        if (!decision.ok) {
          ultimoMotivo = `${decision.codigo}: ${decision.motivo}`;
          return { accion: 'nada', motivo: ultimoMotivo };
        }
      }
      const r = await entregas.pedirConfirmacion(siguiente);
      if (r.ok) {
        anotarEnvio();
        ultimoMotivo = null;
        return { accion: 'confirmacion', entregaId: siguiente.id };
      }
      ultimoMotivo = r.motivo ?? null;
      return { accion: r.retryAfterMs ? 'nada' : 'incidencia', entregaId: siguiente.id, motivo: r.motivo };
    },
  };

  // Las consultas van por el repo del servicio: el motor no sabe de SQL.
  async function listaMotorizado() {
    return repos.entregas.tocaMotorizado(ahora(), 5);
  }
  async function listaConfirmacion(momento: Date) {
    return repos.entregas.tocaPedirConfirmacion(momento, 1);
  }

  entregas.conectarMotor(motor);
  return motor;
}

/** Ticker del motor. Devuelve la funcion para pararlo. */
export function startMotorEntregas(deps: MotorEntregasDeps, intervalMs = 5_000): () => void {
  const motor = crearMotorEntregas(deps);
  let corriendo = false;
  const tick = async () => {
    if (corriendo) return;
    corriendo = true;
    try {
      await motor.tick();
    } catch (error) {
      deps.log?.('falló el motor de entregas', { detalle: error instanceof Error ? error.message : String(error) });
    } finally {
      corriendo = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
