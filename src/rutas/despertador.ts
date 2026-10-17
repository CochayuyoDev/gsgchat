/** Señal local para despertar el motor cuando entra o cambia trabajo. */
const suscriptores = new Set<() => void>();

export function alDespertarMotorRutas(fn: () => void): () => void {
  suscriptores.add(fn);
  return () => suscriptores.delete(fn);
}

export function despertarMotorRutas(): void {
  for (const fn of suscriptores) fn();
}

/**
 * Cambio el horario de envio (ajustes generales, horario de entregas o la
 * pantalla del reparto). Lo que se freno «fuera de horario» quedo esperando
 * hasta la apertura VIEJA (p. ej. las 9:00) y el motor dormido hasta esa
 * hora: si el horario nuevo empieza a las 8:00, nada salia hasta las 9:00. Se
 * sueltan esos frenos internos (como al arrancar) y se despierta el motor,
 * que vuelve a mirar el horario con los ajustes nuevos.
 */
export async function alCambiarHorario(repos: { rutas: { liberarFrenosCuenta(): Promise<number> }; entregas?: { liberarFrenosCuenta(): Promise<number> } }): Promise<void> {
  await Promise.all([repos.rutas.liberarFrenosCuenta(), repos.entregas?.liberarFrenosCuenta()]).catch(() => undefined);
  despertarMotorRutas();
}
