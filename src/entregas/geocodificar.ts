/**
 * Ubicar en el mapa una dirección escrita, GRATIS y sin depender de ello
 * (pedido del dueño, 25/09).
 *
 * Se usa Nominatim, el buscador de OpenStreetMap, con sus reglas de uso: un
 * User-Agent propio que dice quién pregunta, como mucho UN pedido por segundo
 * y nada de preguntar dos veces lo mismo (la caché va en la base). Si no hay
 * red, tarda más de 5 s o no encuentra nada, se sigue sin él: la dirección se
 * guarda igual y al cliente se le pide el pin con amabilidad.
 *
 * Aquí no se decide si la dirección vale: se devuelve dónde cae y con qué
 * precisión. Lo decide el servicio de entregas (¿cae en su distrito?).
 */

import type { Pool } from '../db/pool.js';
import { distritoConocido, distritoEnDireccion } from './distritos-centro.js';

/** alta = con número de puerta; media = la calle; baja = solo la zona o el distrito. */
export type PrecisionGeo = 'alta' | 'media' | 'baja';

export interface ResultadoGeo {
  lat: number;
  lng: number;
  precision: PrecisionGeo;
  /** El distrito donde cae según el mapa (si lo dice). */
  distrito: string | null;
  /** Cómo lo nombra el mapa, para la bitácora. */
  texto: string | null;
}

export interface Geocodificador {
  /** null = no se encontró, no hay red o tardó demasiado: se sigue sin el mapa. */
  buscar(direccion: string, distrito?: string | null): Promise<ResultadoGeo | null>;
}

export interface EntradaCacheGeo {
  encontrado: boolean;
  lat: number | null;
  lng: number | null;
  precision: PrecisionGeo | null;
  distrito: string | null;
  texto: string | null;
  creadoAt: Date;
}

export interface CacheGeo {
  leer(consulta: string): Promise<EntradaCacheGeo | null>;
  guardar(consulta: string, entrada: EntradaCacheGeo): Promise<void>;
}

/** Lo que no se encontró se vuelve a preguntar pasada una semana (el mapa crece). */
const NO_ENCONTRADO_VALE_MS = 7 * 24 * 60 * 60_000;

/** La consulta tal como se guarda en la caché: minúsculas, sin tildes ni signos. */
export function claveConsulta(direccion: string, distrito?: string | null): string {
  return `${direccion} | ${distrito ?? ''}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9| ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
}

export function crearCacheGeoEnMemoria(): CacheGeo & { entradas: Map<string, EntradaCacheGeo> } {
  const entradas = new Map<string, EntradaCacheGeo>();
  return {
    entradas,
    async leer(consulta) {
      return entradas.get(consulta) ?? null;
    },
    async guardar(consulta, entrada) {
      entradas.set(consulta, entrada);
    },
  };
}

interface FilaCache {
  encontrado: boolean;
  lat: number | string | null;
  lng: number | string | null;
  precision: string | null;
  distrito: string | null;
  texto: string | null;
  created_at: Date;
}

/** La caché en la base (tabla geocodificacion_cache, migración 043). */
export function crearCacheGeoSql(pool: Pool): CacheGeo {
  return {
    async leer(consulta) {
      const { rows } = await pool.query<FilaCache>('select * from geocodificacion_cache where consulta = $1', [consulta]);
      const r = rows[0];
      if (!r) return null;
      return {
        encontrado: Boolean(r.encontrado),
        lat: r.lat == null ? null : Number(r.lat),
        lng: r.lng == null ? null : Number(r.lng),
        precision: r.precision === 'alta' || r.precision === 'media' || r.precision === 'baja' ? r.precision : null,
        distrito: r.distrito,
        texto: r.texto,
        creadoAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
      };
    },
    async guardar(consulta, e) {
      await pool.query(
        `insert into geocodificacion_cache (consulta, encontrado, lat, lng, precision, distrito, texto, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (consulta) do update set encontrado = excluded.encontrado, lat = excluded.lat, lng = excluded.lng,
           precision = excluded.precision, distrito = excluded.distrito, texto = excluded.texto, created_at = excluded.created_at`,
        [consulta, e.encontrado, e.lat, e.lng, e.precision, e.distrito, e.texto, e.creadoAt],
      );
    },
  };
}

interface LugarNominatim {
  lat?: string;
  lon?: string;
  display_name?: string;
  addresstype?: string;
  type?: string;
  class?: string;
  place_rank?: number;
  address?: Record<string, string | undefined>;
}

/** Con qué precisión ubicó Nominatim el lugar. */
export function precisionDeLugar(l: LugarNominatim): PrecisionGeo {
  if (l.address?.house_number) return 'alta';
  if (['house', 'building', 'residential_building'].includes(l.addresstype ?? '') || ['house', 'building'].includes(l.type ?? '')) return 'alta';
  if ((l.place_rank ?? 0) >= 26 || ['road', 'street', 'highway'].includes(l.addresstype ?? '') || l.class === 'highway') return 'media';
  return 'baja';
}

/** El distrito donde cae según lo que cuenta Nominatim de la dirección. */
function distritoDeLugar(l: LugarNominatim): string | null {
  const a = l.address ?? {};
  for (const clave of ['city_district', 'suburb', 'town', 'city', 'county', 'municipality']) {
    const d = distritoConocido(a[clave]);
    if (d) return d;
  }
  return distritoEnDireccion(l.display_name);
}

export interface OpcionesNominatim {
  /** El User-Agent propio que exige Nominatim (quién pregunta y cómo contactarlo). */
  userAgent: string;
  cache: CacheGeo;
  fetch?: typeof fetch;
  /** Tiempo máximo de cada búsqueda (espera de turno incluida). 5 s por defecto. */
  tiempoMaxMs?: number;
  /** Separación mínima entre dos pedidos a Nominatim. 1 s por defecto (su regla). */
  intervaloMs?: number;
  url?: string;
  ahora?: () => Date;
  log?: (m: string, d?: Record<string, unknown>) => void;
}

export function crearGeocodificadorNominatim(o: OpcionesNominatim): Geocodificador {
  const pedir = o.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
  const tiempoMax = o.tiempoMaxMs ?? 5_000;
  const intervalo = o.intervaloMs ?? 1_000;
  const base = o.url ?? 'https://nominatim.openstreetmap.org/search';
  const ahora = o.ahora ?? (() => new Date());
  const log = o.log ?? (() => undefined);
  /** Cuándo se puede hacer el siguiente pedido (uno por segundo, para todos). */
  let libreDesde = 0;

  async function turno(limite: number): Promise<boolean> {
    const ya = Date.now();
    const toca = Math.max(ya, libreDesde);
    if (toca > limite) return false;
    libreDesde = toca + intervalo;
    if (toca > ya) await new Promise((r) => setTimeout(r, toca - ya));
    return true;
  }

  return {
    async buscar(direccion, distrito) {
      const limpia = (direccion ?? '').trim();
      if (!limpia) return null;
      const clave = claveConsulta(limpia, distrito);
      const guardada = await o.cache.leer(clave).catch(() => null);
      if (guardada) {
        if (guardada.encontrado && guardada.lat != null && guardada.lng != null && guardada.precision) return { lat: guardada.lat, lng: guardada.lng, precision: guardada.precision, distrito: guardada.distrito, texto: guardada.texto };
        if (!guardada.encontrado && ahora().getTime() - guardada.creadoAt.getTime() < NO_ENCONTRADO_VALE_MS) return null;
      }
      const limite = Date.now() + tiempoMax;
      if (!(await turno(limite))) {
        log('la búsqueda de la dirección no tuvo turno a tiempo: se sigue sin el mapa');
        return null;
      }
      const q = [limpia, distrito && !distritoEnDireccion(limpia) ? distrito : '', 'Lima', 'Perú'].filter(Boolean).join(', ');
      const url = `${base}?format=jsonv2&addressdetails=1&limit=1&countrycodes=pe&accept-language=es&q=${encodeURIComponent(q)}`;
      const control = new AbortController();
      const reloj = setTimeout(() => control.abort(), Math.max(200, limite - Date.now()));
      try {
        const r = await pedir(url, { headers: { 'user-agent': o.userAgent, accept: 'application/json' }, signal: control.signal });
        if (!r.ok) {
          log('el buscador de direcciones respondió con error: se sigue sin el mapa', { estado: r.status });
          return null;
        }
        const lista = (await r.json()) as LugarNominatim[];
        const l = Array.isArray(lista) ? lista[0] : undefined;
        const lat = Number(l?.lat);
        const lng = Number(l?.lon);
        if (!l || !Number.isFinite(lat) || !Number.isFinite(lng)) {
          await o.cache.guardar(clave, { encontrado: false, lat: null, lng: null, precision: null, distrito: null, texto: null, creadoAt: ahora() }).catch(() => undefined);
          return null;
        }
        const res: ResultadoGeo = { lat, lng, precision: precisionDeLugar(l), distrito: distritoDeLugar(l), texto: (l.display_name ?? '').slice(0, 300) || null };
        await o.cache.guardar(clave, { encontrado: true, lat, lng, precision: res.precision, distrito: res.distrito, texto: res.texto, creadoAt: ahora() }).catch(() => undefined);
        return res;
      } catch (error) {
        // Sin red o más de 5 s: no se guarda en la caché (la próxima vez puede haber red).
        log('no se pudo buscar la dirección en el mapa: se sigue sin él', { detalle: error instanceof Error ? error.message : String(error) });
        return null;
      } finally {
        clearTimeout(reloj);
      }
    },
  };
}
