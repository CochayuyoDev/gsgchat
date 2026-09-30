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
import type { FalloCuentaIA } from './proveedores.js';

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

/**
 * Se acabó el saldo (o la clave ya no vale): desde cuándo y por qué. Mientras
 * esté, el sistema contesta con las reglas y avisa para recargar; la primera
 * llamada buena lo borra solo.
 */
export interface SinSaldoIA {
  desde: string;
  motivo: FalloCuentaIA;
  detalle: string;
  /** La última vez que se probó el modelo estando así (para no probar en cada mensaje). */
  ultimoIntento: string;
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
  /** Se acabó el saldo o la clave no vale (null = la IA responde bien). */
  sinSaldo: SinSaldoIA | null;
}

interface Guardado {
  dias: Record<string, UsoDia>;
  ultimoFallo: FalloIA | null;
  fallosSeguidos: number;
  sinSaldo: SinSaldoIA | null;
}

export interface ContadorUsoIA {
  /** Una llamada al modelo que acabo bien. Devuelve true si con ella se apago el aviso de «sin saldo». */
  anotar(tipo: TipoUsoIA, datos?: { ms?: number; tokensEntrada?: number; tokensSalida?: number }): boolean;
  /**
   * Una llamada que fallo (la API respondio mal, no respondio, la clave no
   * vale...). Con `cuenta` (sin saldo o clave que no vale) se enciende el
   * aviso: devuelve true solo la vez que se enciende (para avisar UNA vez).
   */
  anotarFallo(tipo: TipoUsoIA, detalle: string, cuenta?: FalloCuentaIA | null): boolean;
  /** Lo mismo sin contar un fallo del día (p. ej. «Probar la conexión» dio sin saldo). */
  marcarSinSaldo(cuenta: FalloCuentaIA, detalle: string): boolean;
  /** Apaga el aviso («Probar la conexión» respondió bien). true si estaba encendido. */
  limpiarSinSaldo(): boolean;  resumen(): ResumenUsoIA;
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
  if (!valor) return { dias: {}, ultimoFallo: null, fallosSeguidos: 0, sinSaldo: null };
  try {
    const raw = JSON.parse(valor) as Partial<Guardado>;
    const dias: Record<string, UsoDia> = {};
    for (const [dia, d] of Object.entries(raw.dias ?? {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !d || typeof d !== 'object') continue;
      dias[dia] = { ...DIA_VACIO(), ...Object.fromEntries(Object.entries(d).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) } as UsoDia;
    }
    const s = raw.sinSaldo;
    const sinSaldo = s && typeof s === 'object' && (s.motivo === 'sin_saldo' || s.motivo === 'clave_invalida') ? { desde: String(s.desde ?? ''), motivo: s.motivo, detalle: String(s.detalle ?? ''), ultimoIntento: String(s.ultimoIntento ?? s.desde ?? '') } : null;
    return { dias, ultimoFallo: raw.ultimoFallo ?? null, fallosSeguidos: Number(raw.fallosSeguidos) || 0, sinSaldo };
  } catch {
    return { dias: {}, ultimoFallo: null, fallosSeguidos: 0, sinSaldo: null };
  }
}

export async function crearContadorUsoIA(deps: { settingsRepo: SettingsRepo; timezone?: string; ahora?: () => Date; log?: (m: string, d?: Record<string, unknown>) => void }): Promise<ContadorUsoIA> {
  const timezone = deps.timezone ?? 'America/Lima';
  const ahora = deps.ahora ?? (() => new Date());
  const log = deps.log ?? (() => undefined);

  let estado: Guardado = { dias: {}, ultimoFallo: null, fallosSeguidos: 0, sinSaldo: null };
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

  /** Enciende (o renueva) el aviso de «sin saldo». true = recién encendido (o cambió el motivo). */
  function marcar(cuenta: FalloCuentaIA, detalle: string): boolean {
    const cuando = ahora().toISOString();
    const antes = estado.sinSaldo;
    const nuevo = !antes || antes.motivo !== cuenta;
    estado.sinSaldo = nuevo ? { desde: cuando, motivo: cuenta, detalle: String(detalle).slice(0, 300), ultimoIntento: cuando } : { ...antes!, ultimoIntento: cuando };
    return nuevo;
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
      const volvio = estado.sinSaldo !== null;
      estado.sinSaldo = null;
      guardar();
      return volvio;
    },
    anotarFallo(tipo, detalle, cuenta) {
      const d = deHoy();
      d.fallos += 1;
      estado.fallosSeguidos += 1;
      estado.ultimoFallo = { cuando: ahora().toISOString(), tipo, detalle: String(detalle).slice(0, 300) };
      const nuevo = cuenta ? marcar(cuenta, detalle) : false;
      guardar();
      return nuevo;
    },
    marcarSinSaldo(cuenta, detalle) {
      const nuevo = marcar(cuenta, detalle);
      guardar();
      return nuevo;
    },
    limpiarSinSaldo() {
      if (!estado.sinSaldo) return false;
      estado.sinSaldo = null;
      guardar();
      return true;
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
        sinSaldo: estado.sinSaldo,
      };
    },
    guardado: () => pendiente,
  };
}
