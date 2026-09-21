/**
 * Cuanto se usa la IA, contado por dia: para que quien paga la clave vea
 * cuanto gasta y para que un proveedor que empieza a fallar (clave vencida,
 * cuota agotada, 429 seguidos) no deje al asistente callado sin que nadie
 * se entere.
 *
 * Se cuenta cada llamada al modelo por lo que era:
 *  - `respuestas`: el asistente contestando a un cliente de verdad;
 *  - `lecturas`: leer o redactar para el sistema (las respuestas de las
 *    entregas, los resumenes de las conversaciones guardadas, el resumen
 *    del dia);
 *  - `ordenes`: la IA operadora y el ayudante del panel;
 *  - `pruebas`: lo que se prueba desde la pantalla (conversacion de prueba,
 *    examen, probar la conexion).
 * Y los tokens, si el proveedor los devuelve (la API de OpenAI y las
 * compatibles los traen en `usage`; Puter no).
 *
 * Se guarda en `settings` (`ia.uso`) con los ultimos 31 dias: sin tablas
 * nuevas, y se sobrevive a los reinicios.
 */

import type { SettingsRepo } from '../settings/service.js';

export const CLAVE_USO_IA = 'ia.uso';

export type TipoUsoIA = 'respuestas' | 'lecturas' | 'ordenes' | 'pruebas';

export interface UsoDia {
  respuestas: number;
  lecturas: number;
  ordenes: number;
  pruebas: number;
  fallos: number;
  tokensEntrada: number;
  tokensSalida: number;
  /** Suma de milisegundos de las llamadas que acabaron bien (para el tiempo medio). */
  ms: number;
  /** Llamadas que acabaron bien (para el tiempo medio). */
  ok: number;
}

export interface FalloIA {
  cuando: string;
  tipo: TipoUsoIA;
  detalle: string;
}

export interface ResumenUsoIA {
  hoy: UsoDia & { dia: string };
  /** Los ultimos 30 dias, hoy incluido. */
  mes: UsoDia & { desde: string; hasta: string; diasConUso: number };
  /** Dia a dia, del mas viejo al mas nuevo (solo los que tienen algo). */
  dias: Array<UsoDia & { dia: string }>;
  ultimoFallo: FalloIA | null;
  /** Fallos seguidos sin ninguna llamada buena en medio: tres o mas es que el proveedor esta caido o la clave no vale. */
  fallosSeguidos: number;
  /** Tiempo medio de una llamada buena hoy, en milisegundos (null si no hubo). */
  msMedioHoy: number | null;
}

interface Guardado {
  dias: Record<string, UsoDia>;
  ultimoFallo: FalloIA | null;
  fallosSeguidos: number;
}

export interface ContadorUsoIA {
  /** Una llamada al modelo que acabo bien. */
  anotar(tipo: TipoUsoIA, datos?: { ms?: number; tokensEntrada?: number; tokensSalida?: number }): void;
  /** Una llamada que fallo (la API respondio mal, no respondio, la clave no vale...). */
  anotarFallo(tipo: TipoUsoIA, detalle: string): void;
  resumen(): ResumenUsoIA;
  /** Espera a que lo pendiente de guardar este en la base (pruebas). */
  guardado(): Promise<void>;
}

const DIA_VACIO = (): UsoDia => ({ respuestas: 0, lecturas: 0, ordenes: 0, pruebas: 0, fallos: 0, tokensEntrada: 0, tokensSalida: 0, ms: 0, ok: 0 });

/** AAAA-MM-DD en la zona horaria del negocio. */
export function diaEn(fecha: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(fecha);
  } catch {
    return fecha.toISOString().slice(0, 10);
  }
}

function sumar(a: UsoDia, b: UsoDia): UsoDia {
  return {
    respuestas: a.respuestas + b.respuestas,
    lecturas: a.lecturas + b.lecturas,
    ordenes: a.ordenes + b.ordenes,
    pruebas: a.pruebas + b.pruebas,
    fallos: a.fallos + b.fallos,
    tokensEntrada: a.tokensEntrada + b.tokensEntrada,
    tokensSalida: a.tokensSalida + b.tokensSalida,
    ms: a.ms + b.ms,
    ok: a.ok + b.ok,
  };
}

function leerGuardado(valor: string | undefined): Guardado {
  if (!valor) return { dias: {}, ultimoFallo: null, fallosSeguidos: 0 };
  try {
    const raw = JSON.parse(valor) as Partial<Guardado>;
    const dias: Record<string, UsoDia> = {};
    for (const [dia, d] of Object.entries(raw.dias ?? {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !d || typeof d !== 'object') continue;
      dias[dia] = { ...DIA_VACIO(), ...Object.fromEntries(Object.entries(d).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) } as UsoDia;
    }
    return { dias, ultimoFallo: raw.ultimoFallo ?? null, fallosSeguidos: Number(raw.fallosSeguidos) || 0 };
  } catch {
    return { dias: {}, ultimoFallo: null, fallosSeguidos: 0 };
  }
}

export async function crearContadorUsoIA(deps: { settingsRepo: SettingsRepo; timezone?: string; ahora?: () => Date; log?: (m: string, d?: Record<string, unknown>) => void }): Promise<ContadorUsoIA> {
  const timezone = deps.timezone ?? 'America/Lima';
  const ahora = deps.ahora ?? (() => new Date());
  const log = deps.log ?? (() => undefined);

  let estado: Guardado = { dias: {}, ultimoFallo: null, fallosSeguidos: 0 };
  for (const row of await deps.settingsRepo.getAll()) {
    if (row.key === CLAVE_USO_IA) estado = leerGuardado(row.value);
  }

  // Los guardados se encadenan: nunca dos escrituras a la vez, y `guardado()`
  // espera a la ultima (las pruebas lo necesitan; el panel no).
  let pendiente: Promise<void> = Promise.resolve();
  function guardar(): void {
    const foto = JSON.stringify(estado);
    pendiente = pendiente.then(() => deps.settingsRepo.put(CLAVE_USO_IA, foto, false)).catch((e) => log('no se pudo guardar el uso de la IA', { detalle: e instanceof Error ? e.message : String(e) }));
  }

  /** Solo los ultimos 31 dias se conservan. */
  function podar(hoy: string): void {
    const limite = new Date(`${hoy}T00:00:00Z`).getTime() - 31 * 24 * 60 * 60 * 1000;
    for (const dia of Object.keys(estado.dias)) {
      if (new Date(`${dia}T00:00:00Z`).getTime() < limite) delete estado.dias[dia];
    }
  }

  function deHoy(): UsoDia {
    const hoy = diaEn(ahora(), timezone);
    if (!estado.dias[hoy]) {
      estado.dias[hoy] = DIA_VACIO();
      podar(hoy);
    }
    return estado.dias[hoy]!;
  }

  return {
    anotar(tipo, datos = {}) {
      const d = deHoy();
      d[tipo] += 1;
      d.ok += 1;
      d.ms += Math.max(0, Math.round(datos.ms ?? 0));
      d.tokensEntrada += Math.max(0, Math.round(datos.tokensEntrada ?? 0));
      d.tokensSalida += Math.max(0, Math.round(datos.tokensSalida ?? 0));
      estado.fallosSeguidos = 0;
      guardar();
    },
    anotarFallo(tipo, detalle) {
      const d = deHoy();
      d.fallos += 1;
      estado.fallosSeguidos += 1;
      estado.ultimoFallo = { cuando: ahora().toISOString(), tipo, detalle: String(detalle).slice(0, 300) };
      guardar();
    },
    resumen() {
      const hoy = diaEn(ahora(), timezone);
      const desde = diaEn(new Date(ahora().getTime() - 29 * 24 * 60 * 60 * 1000), timezone);
      const dias = Object.entries(estado.dias)
        .filter(([dia]) => dia >= desde && dia <= hoy)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([dia, d]) => ({ dia, ...d }));
      const mes = dias.reduce((acc, d) => sumar(acc, d), DIA_VACIO());
      const deHoyLeido = estado.dias[hoy] ?? DIA_VACIO();
      return {
        hoy: { dia: hoy, ...deHoyLeido },
        mes: { ...mes, desde, hasta: hoy, diasConUso: dias.filter((d) => d.ok + d.fallos > 0).length },
        dias,
        ultimoFallo: estado.ultimoFallo,
        fallosSeguidos: estado.fallosSeguidos,
        msMedioHoy: deHoyLeido.ok ? Math.round(deHoyLeido.ms / deHoyLeido.ok) : null,
      };
    },
    guardado: () => pendiente,
  };
}
