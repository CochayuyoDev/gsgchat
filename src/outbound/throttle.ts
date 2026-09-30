/**
 * Warm-up y techo diario.
 *
 * Meta sube el tier de un numero segun aguante la calidad, pero el salto de
 * 0 a miles de mensajes en un dia es lo que dispara bloqueos y reportes.
 * Aqui el limite efectivo arranca bajo y crece solo con los dias.
 */

export interface WarmupPolicy {
  /** Envios iniciados por la empresa permitidos el primer dia. */
  startPerDay: number;
  /** Factor de crecimiento por dia. */
  growth: number;
  /** Techo duro: nunca se pasa de aqui aunque Meta permita mas. */
  hardCap: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function daysSince(start: Date, now: Date): number {
  const a = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.floor((b - a) / MS_PER_DAY));
}

/** Cupo de hoy segun cuantos dias lleva el numero calentandose. */
export function dailyCapFor(warmupStartedOn: Date, now: Date, policy: WarmupPolicy): number {
  const elapsed = daysSince(warmupStartedOn, now);
  const grown = policy.startPerDay * policy.growth ** elapsed;
  return Math.max(1, Math.min(policy.hardCap, Math.floor(grown)));
}

/** Milisegundos hasta el proximo reinicio de cupo (00:00 UTC). */
export function msUntilNextDay(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
}
