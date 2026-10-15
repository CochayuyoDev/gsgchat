/** Señal local para despertar el motor cuando entra o cambia trabajo. */
const suscriptores = new Set<() => void>();

export function alDespertarMotorRutas(fn: () => void): () => void {
  suscriptores.add(fn);
  return () => suscriptores.delete(fn);
}

export function despertarMotorRutas(): void {
  for (const fn of suscriptores) fn();
}
