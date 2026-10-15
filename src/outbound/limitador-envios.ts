/** Limita envíos efectivos por instancia de WhatsApp (FIFO, con liberación segura). */
export function crearLimitadorEnvios(opciones: { concurrencia: number; porSegundo: number; ahora?: () => number; esperar?: (ms: number) => Promise<void> }) {
  const concurrencia = Math.max(1, Math.min(10, Math.trunc(opciones.concurrencia)));
  const porSegundo = Math.max(1, Math.min(20, opciones.porSegundo));
  const ahora = opciones.ahora ?? Date.now;
  const esperar = opciones.esperar ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const cola: Array<() => void> = [];
  let activos = 0;
  let siguienteInicio = 0;

  return async function ejecutar<T>(trabajo: () => Promise<T>): Promise<T> {
    if (activos >= concurrencia) await new Promise<void>((resolve) => cola.push(resolve));
    activos++;
    const en = ahora();
    const inicio = Math.max(en, siguienteInicio);
    siguienteInicio = inicio + 1000 / porSegundo;
    try {
      if (inicio > en) await esperar(inicio - en);
      return await trabajo();
    } finally {
      activos--;
      cola.shift()?.();
    }
  };
}
