import type { RutasRepo, Solicitud } from '../db/rutas.js';

export interface EsperaEnvio { codigo: string; motivo: string; hasta: Date | null }
const esperas = new WeakMap<RutasRepo, Map<number, EsperaEnvio & { visto: number; intentos: number }>>();
const esperaGlobal = new WeakMap<RutasRepo, EsperaEnvio>();

export function anotarEsperaGlobal(repo: RutasRepo, espera: EsperaEnvio | null): void {
  if (espera) esperaGlobal.set(repo, espera);
  else esperaGlobal.delete(repo);
}

/** Diagnóstico acotado en memoria: no escribe una incidencia cada cinco segundos. */
export function anotarEsperaEnvio(repo: RutasRepo, s: Solicitud, espera: EsperaEnvio, ahora: number): boolean {
  let mapa = esperas.get(repo);
  if (!mapa) { mapa = new Map(); esperas.set(repo, mapa); }
  const anterior = mapa.get(s.id);
  if (mapa.size >= 2000 && !anterior) mapa.delete(mapa.keys().next().value!);
  mapa.set(s.id, { ...espera, visto: ahora, intentos: s.intentos });
  return anterior?.codigo !== espera.codigo || anterior?.motivo !== espera.motivo;
}

export function limpiarEsperasEnvio(repo: RutasRepo, id?: number): void {
  if (id === undefined) esperas.delete(repo);
  else esperas.get(repo)?.delete(id);
}

export function esperaDeEnvio(repo: RutasRepo, s: Solicitud, ahora = Date.now()): EsperaEnvio | null {
  if (!['pendiente', 'enviado', 'respondio'].includes(s.estado)) return null;
  const global = esperaGlobal.get(repo);
  if (global) return global;
  const registrada = esperas.get(repo)?.get(s.id);
  if (registrada && registrada.intentos === s.intentos && ahora < Math.max(registrada.visto + 120_000, registrada.hasta?.getTime() ?? 0)) {
    const { codigo, motivo, hasta } = registrada;
    return { codigo, motivo, hasta };
  }
  if (s.proximoIntentoAt && s.proximoIntentoAt.getTime() > ahora) {
    return { codigo: s.incidencia ?? 'programado', motivo: s.incidenciaDetalle ?? 'Esperando el intervalo configurado desde el último envío.', hasta: s.proximoIntentoAt };
  }
  return { codigo: 'cola', motivo: 'Plazo cumplido; espera su turno en la cola de envío.', hasta: null };
}
