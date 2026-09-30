/**
 * Que modelos de Puter son gratis de verdad.
 *
 * Puter ofrece cientos de modelos "sin llave", pero casi todos descuentan
 * de la asignacion de la cuenta de quien los usa (el modelo "user pays"). En
 * su catalogo en vivo (api.puter.com/puterai/chat/models/details) solo dos
 * tienen costo cero por token: los Gemma 4 de Google. Son los unicos que el
 * asistente usa con Puter, y el catalogo se vuelve a mirar cada hora por si
 * cambia; si no se puede consultar, vale la lista de aqui.
 */

export const MODELOS_GRATIS_PUTER = ['google/gemma-4-31b-it', 'google/gemma-4-26b-a4b-it'] as const;
export const MODELO_GRATIS_POR_DEFECTO = 'google/gemma-4-31b-it';

export const DESCRIPCION_GRATIS: Record<string, string> = {
  'google/gemma-4-31b-it': 'Gemma 4 31B: el mas capaz de los gratuitos (recomendado)',
  'google/gemma-4-26b-a4b-it': 'Gemma 4 26B: mas rapido',
};

export const URL_CATALOGO_PUTER = 'https://api.puter.com/puterai/chat/models/details';

interface EntradaCatalogo {
  puterId?: string;
  id?: string;
  name?: string;
  modalities?: { input?: string[]; output?: string[] };
  costs?: Record<string, number>;
  input_cost_key?: string;
  output_cost_key?: string;
  subscriberOnly?: boolean;
  minimumCredits?: number;
  provider?: string;
}

/** Lo que dice el catalogo de un modelo: gratis si entrada y salida cuestan 0. */
export function esGratisEnCatalogo(m: EntradaCatalogo): boolean {
  if (!(m.modalities?.output ?? []).includes('text')) return false;
  if (m.subscriberOnly || (m.minimumCredits ?? 0) > 0) return false;
  const c = m.costs ?? {};
  const entrada = c[m.input_cost_key ?? 'prompt_tokens'];
  const salida = c[m.output_cost_key ?? 'completion_tokens'];
  return entrada === 0 && salida === 0;
}

/** "google:google/gemma-4-31b-it" -> "google/gemma-4-31b-it", que es como se pide. */
export function idDeModelo(m: EntradaCatalogo): string {
  const puterId = m.puterId ?? '';
  const i = puterId.indexOf(':');
  return i >= 0 ? puterId.slice(i + 1) : puterId || m.id || '';
}

export interface ModelosGratis {
  modelos: string[];
  /** De donde salio la lista: el catalogo en vivo o la lista fija. */
  origen: 'catalogo' | 'fijo';
  consultadoEn: Date | null;
}

const CACHE_MS = 60 * 60 * 1000;
let cache: { valor: ModelosGratis; hasta: number } | null = null;

export async function modelosGratisEnVivo(opts: { fetchImpl?: typeof fetch; ahora?: () => number; sinCache?: boolean } = {}): Promise<ModelosGratis> {
  const ahora = opts.ahora?.() ?? Date.now();
  if (!opts.sinCache && cache && cache.hasta > ahora) return cache.valor;
  const doFetch = opts.fetchImpl ?? fetch;
  let valor: ModelosGratis;
  try {
    const r = await doFetch(URL_CATALOGO_PUTER, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as unknown;
    const arr = (Array.isArray(j) ? j : ((j as { models?: unknown }).models ?? Object.values(j as object))) as EntradaCatalogo[];
    const gratis = arr.filter(esGratisEnCatalogo).map(idDeModelo).filter(Boolean);
    // Si el catalogo viniera raro (vacio), mejor la lista fija que ninguna.
    valor = gratis.length ? { modelos: [...new Set(gratis)].sort(), origen: 'catalogo', consultadoEn: new Date(ahora) } : { modelos: [...MODELOS_GRATIS_PUTER], origen: 'fijo', consultadoEn: null };
  } catch {
    valor = { modelos: [...MODELOS_GRATIS_PUTER], origen: 'fijo', consultadoEn: null };
  }
  cache = { valor, hasta: ahora + CACHE_MS };
  return valor;
}

export function olvidarCacheModelos(): void {
  cache = null;
}

/** El modelo que se usa con Puter: el elegido si es gratis; si no, el gratuito por defecto. */
export function modeloGratisEfectivo(elegido: string, gratis: readonly string[]): string {
  if (gratis.includes(elegido)) return elegido;
  return gratis.includes(MODELO_GRATIS_POR_DEFECTO) ? MODELO_GRATIS_POR_DEFECTO : (gratis[0] ?? MODELO_GRATIS_POR_DEFECTO);
}
