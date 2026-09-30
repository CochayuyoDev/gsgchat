/**
 * Variantes: no mandar siempre lo mismo.
 *
 * Dos problemas distintos con la misma solucion:
 *
 *  - Con Meta, una plantilla es una unidad de riesgo: si recibe quejas, Meta
 *    la pausa (3 h, luego 6 h, luego para siempre) y todo lo que dependia de
 *    ella se para con ella. Tener dos o tres plantillas aprobadas para el
 *    mismo paso, e ir alternandolas, reparte ese riesgo: una pausa deja de
 *    ser un apagon.
 *  - Con un cliente no oficial, el texto va tal cual, y doscientos mensajes
 *    identicos seguidos son la huella mas facil de detectar que existe. Cada
 *    paso tiene varias redacciones y a cada cliente le toca una.
 *
 * La eleccion es determinista a partir de una semilla (telefono + intento):
 * asi se puede probar, y un mismo cliente no ve tres redacciones distintas
 * del mismo mensaje si algo se reintenta.
 */

import type { Template } from '../db/repos.js';

/** Hash pequeno y estable (FNV-1a) para elegir sin azar. */
export function semilla(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Una de las variantes, siempre la misma para la misma semilla. */
export function elegirVariante<T>(variantes: readonly T[], clave: string): T {
  if (!variantes.length) throw new Error('no hay variantes entre las que elegir');
  return variantes[semilla(clave) % variantes.length]!;
}

export interface CriteriosPlantilla {
  ahora: Date;
  /** Envios de cada plantilla en las ultimas 24 h, para repartir. */
  uso24h: Record<string, number>;
  /** Pacing propio: una plantilla aprobada hace menos de N dias no pasa de M por dia. */
  plantillaNuevaDias: number;
  plantillaNuevaPorDia: number;
}

export interface EleccionPlantilla {
  plantilla: Template | null;
  /** Por que se descarto cada candidata que no salio. */
  descartes: Array<{ name: string; motivo: string }>;
}

const pesoCalidad = (q: Template['quality']): number => {
  if (q === 'GREEN') return 0;
  if (q === null || q === 'UNKNOWN') return 1;
  if (q === 'YELLOW') return 2;
  return 3;
};

/**
 * Elige entre varias plantillas del mismo paso.
 *
 * Quedan fuera las que no estan aprobadas, las pausadas por Meta (hasta que
 * pase la pausa), las que estan en rojo y las recien aprobadas que ya
 * gastaron su cupo del dia. De las que quedan, primero la de mejor calidad
 * y, a igual calidad, la que menos se uso en 24 h: asi se alternan.
 */
export function elegirPlantilla(candidatas: Template[], criterios: CriteriosPlantilla): EleccionPlantilla {
  const descartes: EleccionPlantilla['descartes'] = [];
  const validas: Template[] = [];
  const ahora = criterios.ahora.getTime();

  for (const t of candidatas) {
    if (t.status !== 'APPROVED') {
      descartes.push({ name: t.name, motivo: `estado ${t.status}` });
      continue;
    }
    if (t.pausadaHasta && t.pausadaHasta.getTime() > ahora) {
      descartes.push({ name: t.name, motivo: `pausada por Meta hasta ${t.pausadaHasta.toISOString()}` });
      continue;
    }
    if (t.quality === 'RED') {
      descartes.push({ name: t.name, motivo: 'calidad en ROJO' });
      continue;
    }
    if (
      criterios.plantillaNuevaDias > 0 &&
      criterios.plantillaNuevaPorDia > 0 &&
      t.aprobadaAt &&
      ahora - t.aprobadaAt.getTime() < criterios.plantillaNuevaDias * 24 * 60 * 60 * 1000 &&
      (criterios.uso24h[t.name] ?? 0) >= criterios.plantillaNuevaPorDia
    ) {
      descartes.push({
        name: t.name,
        motivo: `recien aprobada: ya salieron ${criterios.uso24h[t.name]} hoy (cupo ${criterios.plantillaNuevaPorDia})`,
      });
      continue;
    }
    validas.push(t);
  }

  validas.sort((a, b) => {
    const calidad = pesoCalidad(a.quality) - pesoCalidad(b.quality);
    if (calidad !== 0) return calidad;
    return (criterios.uso24h[a.name] ?? 0) - (criterios.uso24h[b.name] ?? 0);
  });

  return { plantilla: validas[0] ?? null, descartes };
}
