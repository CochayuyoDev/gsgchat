/**
 * "Que todo funcione": lo que vigila el sistema por si mismo.
 *
 * Cuatro cosas, cada una en su fichero, y aqui lo que comparten:
 *
 *  - el vigilante del WhatsApp (`vigilante.ts`): si la sesion se cae, avisa
 *    por el canal que quede (correo) y reintenta conectar;
 *  - las pruebas de humo (`humo.ts`): cada manana comprueba WhatsApp, GSG,
 *    la IA, las entregas y el disco, y avisa si algo falla;
 *  - el cupo previsto (`cupo-previsto.ts`): cuantos mensajes pueden salir hoy
 *    frente a cuantos necesitan los pedidos cargados;
 *  - la copia de seguridad (`../respaldo`): la base y los respaldos, cada
 *    noche, a una carpeta que elige el dueno.
 *
 * Todo lo que se configura vive en UNA clave de settings (`fiabilidad.ajustes`)
 * que se edita desde la pantalla /fiabilidad; la clave de Brevo va cifrada
 * aparte. Nada de esto toca los ajustes generales.
 */

import { z } from 'zod';
import type { SettingsRepo } from '../settings/service.js';
import { decrypt, encrypt, keyFromBase64 } from '../settings/crypto.js';
import type { Monitor } from './monitor.js';
import { crearCorreo, type ServicioCorreo } from './correo.js';
import { crearVigilante, type DepsVigilante, type Vigilante } from './vigilante.js';
import { crearHumo, type DepsHumo, type Humo } from './humo.js';
import { cupoPrevisto, type CupoPrevisto, type DepsCupo } from './cupo-previsto.js';
import { crearRespaldo, type DepsRespaldo, type ServicioRespaldo } from '../respaldo/servicio.js';

export const CLAVE_AJUSTES_FIABILIDAD = 'fiabilidad.ajustes';
export const CLAVE_BREVO = 'fiabilidad.brevo';

// ---------------------------------------------------------------- reloj ----

const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** AAAA-MM-DD en la zona del negocio. */
export function diaEn(fecha: Date, timezone: string): string {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(fecha);
  return partes.slice(0, 10);
}

/** HH:MM en la zona del negocio. */
export function horaEn(fecha: Date, timezone: string): string {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(fecha);
  // Algunos runtimes devuelven "24:05" para medianoche.
  return h.startsWith('24') ? `00${h.slice(2)}` : h;
}

/** Minutos desde medianoche en la zona del negocio. */
export function minutosDelDia(fecha: Date, timezone: string): number {
  const [h, m] = horaEn(fecha, timezone).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function minutosDe(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** "hace 3 min", "hace 2 h 10 min", "hace 1 día"... */
export function haceCuanto(desde: Date, ahora: Date): string {
  const min = Math.max(0, Math.round((ahora.getTime() - desde.getTime()) / 60_000));
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  if (h < 24) return r ? `hace ${h} h ${r} min` : `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}

export function minutosEnPalabras(min: number): string {
  if (min < 1) return 'menos de un minuto';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function bytesEnPalabras(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// -------------------------------------------------------------- ajustes ----

const correoSchema = z
  .string()
  .trim()
  .max(200)
  .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Ese correo no tiene pinta de correo (nombre@dominio).');

export const ajustesFiabilidadSchema = z.object({
  vigilante: z
    .object({
      /** Cuantos minutos seguidos caido antes de avisar. */
      minutosAntesDeAvisar: z.coerce.number().int().min(1).max(120).default(3),
      /** A donde va el correo cuando el WhatsApp propio esta caido. */
      correoAviso: correoSchema.default(''),
      /** Desde que correo sale (Brevo exige un remitente verificado). Vacio = el mismo. */
      remitente: correoSchema.default(''),
      nombreRemitente: z.string().trim().max(80).default('GSGchat'),
      /** Avisar tambien cuando vuelve (con cuanto estuvo caido). */
      avisarAlVolver: z.boolean().default(true),
    })
    .default({}),
  humo: z
    .object({
      activo: z.boolean().default(true),
      hora: z.string().regex(HORA_RE, 'La hora va como HH:MM.').default('07:00'),
    })
    .default({}),
  copia: z
    .object({
      activa: z.boolean().default(true),
      hora: z.string().regex(HORA_RE, 'La hora va como HH:MM.').default('03:00'),
      /** Carpeta destino. Vacia = la de siempre (Documentos/GSGchat-copias o OneDrive). */
      carpeta: z.string().trim().max(400).default(''),
      /** Cuantas copias se conservan (las mas viejas se borran). */
      conservar: z.coerce.number().int().min(2).max(90).default(14),
    })
    .default({}),
});

export type AjustesFiabilidad = z.infer<typeof ajustesFiabilidadSchema>;
export const AJUSTES_FIABILIDAD_POR_DEFECTO: AjustesFiabilidad = ajustesFiabilidadSchema.parse({});

export interface PatchFiabilidad {
  vigilante?: Partial<AjustesFiabilidad['vigilante']>;
  humo?: Partial<AjustesFiabilidad['humo']>;
  copia?: Partial<AjustesFiabilidad['copia']>;
  /** La clave de Brevo: se guarda cifrada. `null` la borra; undefined la deja. */
  claveBrevo?: string | null;
}

/** El almacen compartido: los tres modulos leen de aqui y la pantalla escribe aqui. */
export interface AlmacenFiabilidad {
  ajustes(): AjustesFiabilidad;
  claveBrevo(): string;
  tieneClaveBrevo(): boolean;
  guardar(patch: PatchFiabilidad): Promise<AjustesFiabilidad>;
  recargar(): Promise<void>;
}

export async function crearAlmacenFiabilidad(deps: { settingsRepo: SettingsRepo; settingsKeyBase64: string; log?: (m: string) => void }): Promise<AlmacenFiabilidad> {
  const key = keyFromBase64(deps.settingsKeyBase64);
  const log = deps.log ?? (() => undefined);
  let ajustes: AjustesFiabilidad = AJUSTES_FIABILIDAD_POR_DEFECTO;
  let clave = '';

  async function recargar(): Promise<void> {
    ajustes = AJUSTES_FIABILIDAD_POR_DEFECTO;
    clave = '';
    for (const row of await deps.settingsRepo.getAll()) {
      if (row.key === CLAVE_AJUSTES_FIABILIDAD) {
        try {
          ajustes = ajustesFiabilidadSchema.parse(JSON.parse(row.value));
        } catch {
          log('los ajustes de fiabilidad guardados no se pudieron leer: se usan los de siempre');
        }
      } else if (row.key === CLAVE_BREVO) {
        try {
          clave = row.encrypted ? decrypt(row.value, key) : row.value;
        } catch {
          log('no se pudo descifrar la clave de Brevo: se ignora');
        }
      }
    }
  }
  await recargar();

  return {
    ajustes: () => ajustes,
    claveBrevo: () => clave,
    tieneClaveBrevo: () => clave.length > 0,
    async guardar(patch) {
      const siguiente = ajustesFiabilidadSchema.parse({
        vigilante: { ...ajustes.vigilante, ...(patch.vigilante ?? {}) },
        humo: { ...ajustes.humo, ...(patch.humo ?? {}) },
        copia: { ...ajustes.copia, ...(patch.copia ?? {}) },
      });
      await deps.settingsRepo.put(CLAVE_AJUSTES_FIABILIDAD, JSON.stringify(siguiente), false);
      ajustes = siguiente;
      if (patch.claveBrevo === null) {
        await deps.settingsRepo.remove(CLAVE_BREVO);
        clave = '';
      } else if (typeof patch.claveBrevo === 'string' && patch.claveBrevo.trim()) {
        clave = patch.claveBrevo.trim();
        await deps.settingsRepo.put(CLAVE_BREVO, encrypt(clave, key), true);
      }
      return ajustes;
    },
    recargar,
  };
}

// ------------------------------------------------------------- servicio ----

export interface DepsFiabilidad {
  settingsRepo: SettingsRepo;
  settingsKeyBase64: string;
  salud: Monitor;
  timezone: string;
  /** Si el sistema corre en modo demostracion (permite simular una caida desde la pantalla). */
  demo?: boolean;
  ahora?: () => Date;
  log?: (m: string, d?: Record<string, unknown>) => void;
  fetchImpl?: typeof fetch;
  vigilante: Omit<DepsVigilante, 'ajustes' | 'correo' | 'settingsRepo' | 'ahora' | 'log' | 'timezone' | 'permitirSimulacion'>;
  humo: Omit<DepsHumo, 'ajustes' | 'settingsRepo' | 'ahora' | 'log' | 'timezone' | 'avisar' | 'whatsappCaido'>;
  cupo: Omit<DepsCupo, 'salud' | 'ahora'>;
  respaldo: Omit<DepsRespaldo, 'ajustes' | 'settingsRepo' | 'ahora' | 'log' | 'timezone'>;
}

export interface EstadoFiabilidad {
  ajustes: AjustesFiabilidad;
  brevo: { configurada: boolean };
  vigilante: ReturnType<Vigilante['estado']>;
  humo: ReturnType<Humo['estado']>;
  cupo: CupoPrevisto;
  copia: Awaited<ReturnType<ServicioRespaldo['estado']>>;
  demo: boolean;
}

export interface ServicioFiabilidad {
  almacen: AlmacenFiabilidad;
  correo: ServicioCorreo;
  vigilante: Vigilante;
  humo: Humo;
  respaldo: ServicioRespaldo;
  cupo(): Promise<CupoPrevisto>;
  estado(): Promise<EstadoFiabilidad>;
  /** Levanta los tres tickers (vigilante, humo, copia) y devuelve la funcion que los para. */
  arrancar(): () => void;
}

export async function crearFiabilidad(deps: DepsFiabilidad): Promise<ServicioFiabilidad> {
  const ahora = deps.ahora ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  const almacen = await crearAlmacenFiabilidad({ settingsRepo: deps.settingsRepo, settingsKeyBase64: deps.settingsKeyBase64, log: (m) => log(m) });
  const correo = crearCorreo({ fetchImpl: deps.fetchImpl, clave: () => almacen.claveBrevo(), ajustes: () => almacen.ajustes().vigilante });

  const vigilante = crearVigilante({
    ...deps.vigilante,
    ajustes: () => almacen.ajustes().vigilante,
    correo,
    settingsRepo: deps.settingsRepo,
    ahora,
    log,
    timezone: deps.timezone,
    permitirSimulacion: Boolean(deps.demo),
  });

  const humo = crearHumo({
    ...deps.humo,
    ajustes: () => almacen.ajustes().humo,
    settingsRepo: deps.settingsRepo,
    ahora,
    log,
    timezone: deps.timezone,
    whatsappCaido: () => vigilante.estado().conectado === false,
    // Si algo falla, el aviso sale por WhatsApp; si lo que falla es el
    // WhatsApp, por el correo del vigilante.
    avisar: (texto) => vigilante.avisar(texto),
  });

  const respaldo = await crearRespaldo({
    ...deps.respaldo,
    ajustes: () => almacen.ajustes().copia,
    settingsRepo: deps.settingsRepo,
    ahora,
    log,
    timezone: deps.timezone,
  });

  const cupo = () => cupoPrevisto({ ...deps.cupo, salud: deps.salud, ahora });

  return {
    almacen,
    correo,
    vigilante,
    humo,
    respaldo,
    cupo,
    async estado() {
      const [c, copia] = await Promise.all([cupo(), respaldo.estado()]);
      return {
        ajustes: almacen.ajustes(),
        brevo: { configurada: almacen.tieneClaveBrevo() },
        vigilante: vigilante.estado(),
        humo: humo.estado(),
        cupo: c,
        copia,
        demo: Boolean(deps.demo),
      };
    },
    arrancar() {
      const paraVigilante = vigilante.arrancar();
      const paraHumo = humo.arrancar();
      const paraCopia = respaldo.arrancar();
      return () => {
        paraVigilante();
        paraHumo();
        paraCopia();
      };
    },
  };
}
