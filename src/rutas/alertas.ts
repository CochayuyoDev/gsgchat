/**
 * Avisar. A GSG de como va el lote, y a una persona de lo que solo una
 * persona puede resolver.
 *
 * El resumen del final no sirve para trabajar: cuando el lote termina, la
 * moto ya salio. Lo que hace falta es enterarse **mientras**: cuantos van con
 * ubicacion, cuantos no contestan y -sobre todo- cuantos casos estan parados
 * esperando a que alguien los mire.
 *
 * Dos avisos distintos, con dos destinatarios distintos:
 *
 *  - **A GSG**, cada media hora: el conteo del lote en marcha, por el mismo
 *    canal que todo lo demas (la cola de `rutas_reportes`, que sale sola en
 *    cuanto exista su API).
 *  - **Al coordinador**, por WhatsApp: "hay 3 casos que necesitan a una
 *    persona". Un aviso en una pantalla que nadie esta mirando no es un
 *    aviso; el mensaje al telefono si.
 *
 * Los dos se callan cuando no hay nada que decir, que es lo que hace que se
 * sigan leyendo el dia que digan algo.
 */

import type { Repos } from '../db/repos.js';
import type { Lote } from '../db/rutas.js';
import type { Sender } from '../outbound/sender.js';
import { INCIDENCIAS, type CodigoIncidencia } from './incidencias.js';
import { payloadResumen, type PuertoGsg } from './gsg.js';

export interface OpcionesAlertas {
  /** Cada cuanto se le manda a GSG el avance del lote, en minutos. */
  resumenCadaMin: number;
  /** Telefono del coordinador. Vacio = no se avisa a nadie por WhatsApp. Funcion: se lee en cada aviso. */
  supervisor: string | (() => string);
  /** Cuantos casos parados hacen falta para molestar a una persona. */
  minimoCasos: number;
  /** Cada cuanto, como mucho, se le escribe al coordinador. */
  avisoCadaMin: number;
}

export const ALERTAS_POR_DEFECTO: OpcionesAlertas = {
  resumenCadaMin: 30,
  supervisor: '',
  minimoCasos: 1,
  avisoCadaMin: 60,
};

export interface AlertasDeps {
  repos: Repos;
  sender: Sender;
  gsg: PuertoGsg;
  opciones: OpcionesAlertas;
  ahora?: () => Date;
  log?: (mensaje: string, detalle?: Record<string, unknown>) => void;
}

export interface AvanceLote {
  lote: Lote;
  total: number;
  conUbicacion: number;
  contestaron: number;
  sinContestar: number;
  sinEscribir: number;
  necesitanPersona: number;
  incidencias: Record<string, number>;
}

/** Como va un lote ahora mismo, en los terminos en que se pregunta. */
export async function avanceDelLote(repos: Repos, lote: Lote): Promise<AvanceLote> {
  const cifras = await repos.rutas.cifrasPorEstado(lote.id);
  const incidencias = await repos.rutas.cifrasPorIncidencia(lote.id);
  const total = Object.values(cifras).reduce((suma, n) => suma + n, 0);

  return {
    lote,
    total,
    conUbicacion: cifras.resuelto ?? 0,
    // "Contestaron" incluye a quien ya mando su ubicacion: contesto tambien.
    contestaron: (cifras.resuelto ?? 0) + (cifras.respondio ?? 0) + (cifras.supervision ?? 0),
    sinContestar: cifras.enviado ?? 0,
    sinEscribir: cifras.pendiente ?? 0,
    necesitanPersona: await repos.rutas.contarSolicitudes({ loteId: lote.id, requiereHumano: true }),
    incidencias,
  };
}

/** El texto del aviso al coordinador. Corto: se lee en la calle, en el movil. */
export function textoAviso(avance: AvanceLote): string {
  const porCodigo = Object.entries(avance.incidencias)
    .filter(([codigo]) => codigo in INCIDENCIAS)
    .map(([codigo, n]) => `${n} ${INCIDENCIAS[codigo as CodigoIncidencia].titulo.toLowerCase()}`)
    .join(', ');

  return (
    `Reparto "${avance.lote.nombre}": ${avance.conUbicacion} de ${avance.total} con ubicación. ` +
    `${avance.sinContestar} sin contestar todavía. ` +
    `${avance.necesitanPersona} ${avance.necesitanPersona === 1 ? 'caso necesita' : 'casos necesitan'} que alguien los vea` +
    (porCodigo ? ` (${porCodigo}).` : '.')
  );
}

export interface ResultadoAlertas {
  resumenes: number;
  avisos: number;
  /** Por que no se hizo nada, cuando no se hizo nada. */
  motivo?: string;
}

/**
 * Una pasada de avisos. Devuelve cuantos salieron.
 *
 * `ultimoResumen` y `ultimoAviso` viven fuera (en el ticker) para que esta
 * funcion se pueda llamar desde una prueba con el reloj en la mano.
 */
export async function revisarAlertas(
  deps: AlertasDeps,
  memoria: { ultimoResumen: Map<string, number>; ultimoAviso: Map<string, number> },
): Promise<ResultadoAlertas> {
  const ahora = (deps.ahora ?? (() => new Date()))();
  const salida: ResultadoAlertas = { resumenes: 0, avisos: 0 };

  const lotes = await deps.repos.rutas.lotesActivos();
  if (!lotes.length) return { ...salida, motivo: 'no hay ningun lote en marcha' };

  for (const lote of lotes) {
    const avance = await avanceDelLote(deps.repos, lote);

    // --- a GSG: el avance del lote ---------------------------------------
    const previoResumen = memoria.ultimoResumen.get(lote.id) ?? 0;
    if (ahora.getTime() - previoResumen >= deps.opciones.resumenCadaMin * 60_000) {
      await deps.repos.rutas.encolarReporte({
        loteId: lote.id,
        tipo: 'resumen',
        payload: {
          ...payloadResumen(
            lote,
            await deps.repos.rutas.cifrasPorEstado(lote.id),
            avance.incidencias,
          ),
          // Lo que GSG preguntaria de todas formas, ya contestado.
          enCurso: true,
          conUbicacion: avance.conUbicacion,
          contestaron: avance.contestaron,
          sinContestar: avance.sinContestar,
          sinEscribir: avance.sinEscribir,
          necesitanPersona: avance.necesitanPersona,
        },
      });
      memoria.ultimoResumen.set(lote.id, ahora.getTime());
      salida.resumenes++;
    }

    // --- al coordinador: lo que no puede resolver el bot -------------------
    const supervisor = typeof deps.opciones.supervisor === 'function' ? deps.opciones.supervisor() : deps.opciones.supervisor;
    if (!supervisor) continue;
    if (avance.necesitanPersona < deps.opciones.minimoCasos) continue;

    const previoAviso = memoria.ultimoAviso.get(lote.id) ?? 0;
    if (ahora.getTime() - previoAviso < deps.opciones.avisoCadaMin * 60_000) continue;

    const resultado = await deps.sender.send({
      phone: supervisor,
      kind: 'freeform',
      category: 'UTILITY',
      // Es un aviso interno al propio equipo, no un mensaje a un cliente: no
      // pasa por las guardas de consentimiento ni por la ventana de 24 h.
      manual: true,
      text: textoAviso(avance),
    });

    if (resultado.ok) {
      memoria.ultimoAviso.set(lote.id, ahora.getTime());
      salida.avisos++;
      deps.log?.('aviso enviado al coordinador', {
        lote: lote.nombre,
        casos: avance.necesitanPersona,
      });
    } else {
      // Que no se pueda avisar es en si mismo un problema: se apunta, pero no
      // se reintenta en bucle.
      memoria.ultimoAviso.set(lote.id, ahora.getTime());
      deps.log?.('no se pudo avisar al coordinador', {
        detalle: resultado.blocked ? resultado.reason : resultado.error,
      });
    }
  }

  return salida;
}

/** Ticker de los avisos. Devuelve la funcion para pararlo. */
export function startAlertas(deps: AlertasDeps, intervalMs = 5 * 60_000): () => void {
  const memoria = { ultimoResumen: new Map<string, number>(), ultimoAviso: new Map<string, number>() };
  let corriendo = false;

  const tick = async () => {
    if (corriendo) return;
    corriendo = true;
    try {
      await revisarAlertas(deps, memoria);
    } catch (error) {
      deps.log?.('fallo la revision de alertas', {
        detalle: error instanceof Error ? error.message : String(error),
      });
    } finally {
      corriendo = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
