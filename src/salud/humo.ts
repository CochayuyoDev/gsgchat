/**
 * Las pruebas de humo: cada manana, antes de que empiece el reparto, se
 * comprueba que todo lo que el dia necesita responde.
 *
 *  1. WhatsApp: se manda un mensaje al supervisor y se espera a que llegue.
 *  2. GSG: se le piden los pendientes (lo mismo que "Probar" en Conexion).
 *  3. La IA: se le pide una frase corta (si esta encendida).
 *  4. Las entregas: la pantalla de Hoy responde.
 *  5. El disco: queda sitio para la base y los respaldos.
 *
 * Si algo falla, UN aviso al supervisor por WhatsApp; si lo que falla es el
 * WhatsApp, por el correo del vigilante. Lo de las ultimas dos semanas queda
 * guardado para que la pantalla lo ensene con ✓ y ✗ y una frase en cristiano.
 */

import { statfs } from 'node:fs/promises';
import type { SettingsRepo } from '../settings/service.js';
import type { Sender } from '../outbound/sender.js';
import type { DeliveriesRepo } from '../db/repos.js';
import { diaEn, minutosDe, minutosDelDia, bytesEnPalabras } from './fiabilidad.js';

export const CLAVE_HUMO_HISTORIAL = 'fiabilidad.humo.historial';
export const CLAVE_HUMO_ULTIMO_DIA = 'fiabilidad.humo.ultimoDia';
const GUARDAR_ULTIMAS = 14;
const MINIMO_LIBRE_MB = 500;
/**
 * La pasada de la manana solo se hace dentro de estas horas despues de la
 * suya: un servidor que arranca a las tres de la tarde no tiene que mandarle
 * al supervisor el mensaje de prueba "de la manana".
 */
const VENTANA_MIN = 3 * 60;

export type ClavePaso = 'whatsapp' | 'gsg' | 'ia' | 'entregas' | 'disco';

export interface PasoHumo {
  clave: ClavePaso;
  nombre: string;
  ok: boolean;
  /** No habia nada que probar (por ejemplo, la IA apagada): no cuenta como fallo. */
  omitido?: boolean;
  detalle: string;
  ms: number;
}

export interface ResultadoHumo {
  at: string;
  /** 'cada mañana' o el nombre de quien pulso "Probar ahora". */
  quien: string;
  ok: boolean;
  pasos: PasoHumo[];
  aviso: { ok: boolean; por: string; detalle: string } | null;
}

export interface AjustesHumo {
  activo: boolean;
  hora: string;
}

export interface DepsHumo {
  sender: Sender;
  supervisor: () => string;
  deliveries: Pick<DeliveriesRepo, 'listRecent'>;
  conexionGsg?: { probar(): Promise<{ ok: boolean; detalle: string }>; estado(): { modo: string } } | null;
  ia?: { estado(): { tieneToken: boolean }; probarConexion(): Promise<{ ok: boolean; detalle: string; ms?: number }> } | null;
  entregas?: { resumen(): Promise<{ cifras: { total: number } }> } | null;
  /** Carpetas cuyo disco se mira (la base, los respaldos). Las que no existan se saltan. */
  carpetas: () => string[];
  minimoLibreMB?: number;
  /** Cuanto se espera a que WhatsApp confirme la entrega del mensaje de prueba. */
  esperaEntregaMs?: number;
  ajustes: () => AjustesHumo;
  settingsRepo: SettingsRepo;
  ahora: () => Date;
  log: (m: string, d?: Record<string, unknown>) => void;
  /** Zona horaria, o una funcion que la da (la elegida en Ajustes). */
  timezone: string | (() => string);
  whatsappCaido: () => boolean;
  avisar: (texto: string) => Promise<{ ok: boolean; por: string; detalle: string }>;
  cadaMs?: number;
  dormir?: (ms: number) => Promise<void>;
  /** Como se lee en pantalla la direccion de esta pantalla. */
  rutaPantalla?: string;
}

export interface Humo {
  correr(opciones?: { quien?: string; avisar?: boolean }): Promise<ResultadoHumo>;
  /** Si a esta hora toca la pasada de la manana y no se hizo hoy, la hace. */
  tick(): Promise<boolean>;
  estado(): { ajustes: AjustesHumo; ultima: ResultadoHumo | null; historial: ResultadoHumo[]; enMarcha: boolean; proxima: string };
  recargar(): Promise<void>;
  arrancar(): () => void;
}

const NOMBRES: Record<ClavePaso, string> = {
  whatsapp: 'WhatsApp',
  gsg: 'GSG',
  ia: 'Asistente IA',
  entregas: 'Entregas del día',
  disco: 'Disco',
};

/** Los codigos de las guardas del sender, contados para el supervisor. */
export function explicarBloqueo(code: string, reason: string): string {
  const porCodigo: Record<string, string> = {
    allowlist: 'el modo prueba solo deja escribir a los números de su lista y el supervisor no está en ella',
    sin_conexion: 'WhatsApp no está conectado',
    opt_out: 'el número del supervisor se dio de baja (escribió BAJA); que escriba ALTA',
    no_opt_in: 'el número del supervisor no tiene consentimiento: dale de alta en Contactos con opt-in',
    number_paused: 'el número está en pausa (Estado del número)',
    number_quality: 'Meta tiene el número con calidad baja y se frenó todo',
    window_closed: 'la ventana de 24 h de Meta está cerrada y no hay plantilla aprobada para esto',
    template_missing: 'falta la plantilla aprobada para escribir fuera de la ventana de 24 h',
    template_not_approved: 'la plantilla todavía no está aprobada por Meta',
    frequency_cap: 'el supervisor ya recibió el máximo de mensajes por contacto',
    daily_cap: 'se agotó el cupo de mensajes de hoy (Riesgo y ritmo)',
    contact_suppressed: 'el número del supervisor está apartado por un error anterior',
    risk_marketing_paused: 'el número está en naranja o rojo y solo sale lo imprescindible',
  };
  return porCodigo[code] ?? reason ?? code;
}

export function crearHumo(deps: DepsHumo): Humo {
  const tz = (): string => (typeof deps.timezone === 'function' ? deps.timezone() : deps.timezone);
  const { ahora, log } = deps;
  const cadaMs = deps.cadaMs ?? 60_000;
  const esperaEntregaMs = deps.esperaEntregaMs ?? 60_000;
  const minimoLibre = (deps.minimoLibreMB ?? MINIMO_LIBRE_MB) * 1024 * 1024;
  const dormir = deps.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const rutaPantalla = deps.rutaPantalla ?? '/fiabilidad';

  let historial: ResultadoHumo[] = [];
  let ultimoDia = '';
  let enMarcha = false;
  let cargado = false;

  async function recargar(): Promise<void> {
    cargado = true;
    historial = [];
    ultimoDia = '';
    for (const row of await deps.settingsRepo.getAll()) {
      if (row.key === CLAVE_HUMO_HISTORIAL) {
        try {
          const v = JSON.parse(row.value);
          if (Array.isArray(v)) historial = v as ResultadoHumo[];
        } catch {
          historial = [];
        }
      } else if (row.key === CLAVE_HUMO_ULTIMO_DIA) ultimoDia = row.value;
    }
  }

  const medir = async (clave: ClavePaso, fn: () => Promise<Omit<PasoHumo, 'clave' | 'nombre' | 'ms'>>): Promise<PasoHumo> => {
    const t0 = Date.now();
    try {
      const r = await fn();
      return { clave, nombre: NOMBRES[clave], ms: Date.now() - t0, ...r };
    } catch (error) {
      return { clave, nombre: NOMBRES[clave], ms: Date.now() - t0, ok: false, detalle: `Falló sin avisar: ${error instanceof Error ? error.message : String(error)}` };
    }
  };

  async function pasoWhatsApp(): Promise<Omit<PasoHumo, 'clave' | 'nombre' | 'ms'>> {
    const phone = deps.supervisor();
    if (!phone) return { ok: false, detalle: 'No hay número del supervisor: ponlo en Ajustes → Avisos (es a quien se le manda el mensaje de prueba).' };
    if (deps.whatsappCaido()) return { ok: false, detalle: 'La sesión de WhatsApp está caída: mira el bloque WhatsApp de esta pantalla.' };
    const salida = await deps.sender.send({
      phone,
      kind: 'freeform',
      category: 'UTILITY',
      text: 'Prueba de cada mañana de GSGchat: si lees esto, el WhatsApp del sistema funciona. No hace falta contestar.',
      manual: true,
      origen: 'sistema',
    });
    if (!salida.ok) {
      if (salida.blocked) return { ok: false, detalle: `No salió: ${explicarBloqueo(salida.code, salida.reason)}.` };
      return { ok: false, detalle: `WhatsApp no aceptó el mensaje: ${(salida as { error?: string }).error ?? 'sin detalle'}.` };
    }
    const wamid = salida.wamid;
    const t0 = Date.now();
    let estado = 'sent';
    let fallo: string | null = null;
    // Al menos una mirada, aunque la espera sea cero (las pruebas).
    for (;;) {
      const filas = await deps.deliveries.listRecent({ phone, limit: 10, offset: 0 });
      const mia = filas.find((f) => f.wamid === wamid);
      if (mia) {
        estado = mia.status;
        if (mia.status === 'delivered' || mia.status === 'read') break;
        if (mia.status === 'failed') {
          fallo = mia.errorTitle ?? mia.errorCode ?? 'WhatsApp lo rechazó';
          break;
        }
      }
      if (Date.now() - t0 >= esperaEntregaMs) break;
      await dormir(Math.min(1000, Math.max(50, esperaEntregaMs - (Date.now() - t0))));
    }
    if (fallo) return { ok: false, detalle: `Salió pero WhatsApp lo rechazó: ${fallo}.` };
    if (estado === 'delivered' || estado === 'read') return { ok: true, detalle: `Salió y llegó al teléfono del supervisor en ${Math.max(1, Math.round((Date.now() - t0) / 1000))} s.` };
    return { ok: true, detalle: `Salió; WhatsApp no confirmó la entrega en ${Math.round(esperaEntregaMs / 1000)} s (puede que el teléfono del supervisor esté sin conexión).` };
  }

  async function pasoGsg(): Promise<Omit<PasoHumo, 'clave' | 'nombre' | 'ms'>> {
    if (!deps.conexionGsg) return { ok: true, omitido: true, detalle: 'No hay conexión con GSG en este arranque.' };
    if (deps.conexionGsg.estado().modo === 'ninguna') return { ok: false, detalle: 'GSG no está conectado: configura la dirección de su API en Conexión.' };
    const r = await deps.conexionGsg.probar();
    return { ok: r.ok, detalle: r.detalle };
  }

  async function pasoIa(): Promise<Omit<PasoHumo, 'clave' | 'nombre' | 'ms'>> {
    if (!deps.ia || !deps.ia.estado().tieneToken) return { ok: true, omitido: true, detalle: 'El asistente IA está apagado o sin clave: nada que probar.' };
    const r = await deps.ia.probarConexion();
    return { ok: r.ok, detalle: r.ok ? `Contestó${r.ms ? ` en ${(r.ms / 1000).toFixed(1)} s` : ''}.` : r.detalle };
  }

  async function pasoEntregas(): Promise<Omit<PasoHumo, 'clave' | 'nombre' | 'ms'>> {
    if (!deps.entregas) return { ok: true, omitido: true, detalle: 'Las entregas no están en este arranque.' };
    const r = await deps.entregas.resumen();
    return { ok: true, detalle: `Responde: ${r.cifras.total} ${r.cifras.total === 1 ? 'pedido' : 'pedidos'} de hoy.` };
  }

  async function pasoDisco(): Promise<Omit<PasoHumo, 'clave' | 'nombre' | 'ms'>> {
    const carpetas = deps.carpetas().filter(Boolean);
    let peor: { carpeta: string; libre: number } | null = null;
    for (const carpeta of carpetas) {
      try {
        const s = await statfs(carpeta);
        const libre = Number(s.bavail) * Number(s.bsize);
        if (!peor || libre < peor.libre) peor = { carpeta, libre };
      } catch {
        // No existe todavia (la carpeta de respaldos se crea con el primer respaldo).
      }
    }
    if (!peor) return { ok: true, omitido: true, detalle: 'Todavía no hay carpetas de datos que mirar.' };
    if (peor.libre < minimoLibre) return { ok: false, detalle: `Quedan solo ${bytesEnPalabras(peor.libre)} libres en el disco de ${peor.carpeta}: libera espacio o la base dejará de escribir.` };
    return { ok: true, detalle: `Quedan ${bytesEnPalabras(peor.libre)} libres.` };
  }

  async function guardar(): Promise<void> {
    await deps.settingsRepo.put(CLAVE_HUMO_HISTORIAL, JSON.stringify(historial.slice(0, GUARDAR_ULTIMAS)), false);
  }

  async function correr(opciones: { quien?: string; avisar?: boolean } = {}): Promise<ResultadoHumo> {
    if (!cargado) await recargar();
    const quien = opciones.quien ?? 'cada mañana';
    enMarcha = true;
    try {
      const pasos: PasoHumo[] = [];
      pasos.push(await medir('whatsapp', pasoWhatsApp));
      pasos.push(await medir('gsg', pasoGsg));
      pasos.push(await medir('ia', pasoIa));
      pasos.push(await medir('entregas', pasoEntregas));
      pasos.push(await medir('disco', pasoDisco));
      const fallos = pasos.filter((p) => !p.ok);
      const resultado: ResultadoHumo = { at: ahora().toISOString(), quien, ok: fallos.length === 0, pasos, aviso: null };
      if (fallos.length && opciones.avisar) {
        const texto = `Prueba de la mañana de GSGchat: ${fallos.length === 1 ? 'falló' : 'fallaron'} ${fallos.map((f) => `${f.nombre} (${f.detalle})`).join('; ')}. Míralo en Que todo funcione (${rutaPantalla}).`;
        resultado.aviso = await deps.avisar(texto).catch((error) => ({ ok: false, por: 'nadie', detalle: error instanceof Error ? error.message : String(error) }));
      }
      historial = [resultado, ...historial].slice(0, GUARDAR_ULTIMAS);
      await guardar().catch(() => undefined);
      log(resultado.ok ? 'pruebas de humo: todo bien' : 'pruebas de humo: algo falló', { quien, fallos: fallos.map((f) => f.clave) });
      return resultado;
    } finally {
      enMarcha = false;
    }
  }

  async function tick(): Promise<boolean> {
    if (!cargado) await recargar();
    const a = deps.ajustes();
    if (!a.activo || enMarcha) return false;
    const t = ahora();
    const dia = diaEn(t, tz());
    if (ultimoDia === dia) return false;
    const minutos = minutosDelDia(t, tz());
    if (minutos < minutosDe(a.hora) || minutos >= minutosDe(a.hora) + VENTANA_MIN) return false;
    ultimoDia = dia;
    await deps.settingsRepo.put(CLAVE_HUMO_ULTIMO_DIA, dia, false).catch(() => undefined);
    await correr({ quien: 'cada mañana', avisar: true });
    return true;
  }

  return {
    correr,
    tick,
    estado() {
      const a = deps.ajustes();
      const t = ahora();
      const dia = diaEn(t, tz());
      let proxima: string;
      if (!a.activo) proxima = 'apagadas: no se comprueba nada solo';
      else if (ultimoDia === dia || minutosDelDia(t, tz()) >= minutosDe(a.hora)) proxima = `mañana a las ${a.hora}`;
      else proxima = `hoy a las ${a.hora}`;
      return { ajustes: a, ultima: historial[0] ?? null, historial, enMarcha, proxima };
    },
    recargar,
    arrancar() {
      const timer = setInterval(() => {
        void tick().catch((error) => log('pruebas de humo: fallo en la vuelta', { detalle: error instanceof Error ? error.message : String(error) }));
      }, cadaMs);
      timer.unref?.();
      return () => clearInterval(timer);
    },
  };
}
