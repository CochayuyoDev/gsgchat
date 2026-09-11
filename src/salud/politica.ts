/**
 * La politica de envio: cuanto, a que ritmo, en que horario y con que
 * margen. Es un dato, no logica, para que se pueda ensenar en pantalla y
 * ajustar por variable de entorno sin tocar el codigo.
 *
 * Hay dos perfiles porque hay dos mundos:
 *
 *  - `cloud`: la API oficial de Meta. Meta ya limita por tier (destinatarios
 *    unicos por 24 h, a nivel de portafolio) y por calidad; lo que mata un
 *    numero aqui son los bloqueos y reportes, no la velocidad. Los limites
 *    propios son un colchon por debajo del tier y un ritmo que no parezca un
 *    volcado.
 *  - `no_oficial`: Baileys o WAHA emulando WhatsApp Web. Aqui no hay tier ni
 *    calidad que consultar y el baneo llega sin aviso. Lo que WhatsApp mira
 *    en un cliente web es el patron: muchos mensajes a numeros que no te
 *    tienen agendado, a ritmo de maquina, sin que nadie conteste. Los limites
 *    son bastante mas bajos y el ritmo, humano.
 *
 * Los numeros de abajo salen de la documentacion de Meta (limites, pausas de
 * plantilla, codigos de error) y, para el perfil no oficial, de lo que
 * reportan quienes operan con Baileys a volumen: nadie garantiza nada, pero
 * ir por debajo de esto es lo que separa un numero que dura meses de uno
 * que dura una tarde.
 */

import type { Config } from '../config.js';

export type PerfilRitmo = 'cloud' | 'no_oficial';

export interface Umbrales {
  /** Fallos en Meta sobre los ultimos 50 envios, en %. */
  maxFallosPct: number;
  /** "No tiene WhatsApp" (131026) sobre los ultimos 50 envios: lista sucia. */
  maxSinWhatsappPct: number;
  /** Bajas en 24 h sobre envios en 24 h. */
  maxBajasPct: number;
  /** Entregados sobre enviados en 24 h: por debajo, algo no llega. */
  minEntregaPct: number;
  /** "No soy yo" y "no me escriban" sobre envios en 24 h. */
  maxQuejasPct: number;
  /** Salientes por cada entrante en 24 h (solo no oficial). */
  maxRatioSalidaEntrada: number;
  /** Con menos envios que esto, los porcentajes no dicen nada. */
  minEnviosParaJuzgar: number;
}

export interface Politica {
  perfil: PerfilRitmo;

  /** Envios iniciados por la empresa por minuto y por hora. */
  maxPorMinuto: number;
  maxPorHora: number;
  /** Pausa entre dos envios iniciados por la empresa, en ms; se sortea. */
  pausaMinMs: number;
  pausaMaxMs: number;
  /** Contactos a los que se escribe por primera vez, por dia. 0 = sin limite. */
  nuevosContactosPorDia: number;
  /** Mensajes iniciados por la empresa al mismo contacto por dia. */
  maxPorContactoDia: number;
  /** Separacion minima entre dos mensajes automaticos al mismo contacto, en ms. */
  separacionContactoMs: number;

  /** Franja horaria (hora del negocio) para lo iniciado por la empresa. */
  horaInicio: number;
  horaFin: number;
  /** Dias permitidos, 0 = domingo. */
  diasPermitidos: number[];
  timezone: string;

  /** Fraccion del tier de Meta que se usa como techo propio (0.9 = 90 %). */
  fraccionTier: number;

  /** Envios seguidos sin respuesta a partir de los cuales el contacto descansa de marketing. */
  fatigaEnvios: number;
  fatigaDescansoDias: number;

  /** Plantilla recien aprobada: pacing propio durante sus primeros dias. */
  plantillaNuevaDias: number;
  plantillaNuevaPorDia: number;

  /** Warm-up del numero. */
  warmup: {
    startPerDay: number;
    growth: number;
    hardCap: number;
    /** Dias sin enviar nada tras los que el warm-up vuelve a empezar. */
    reinicioTrasDiasInactivo: number;
  };

  /** Simular escritura y pausas humanas (solo tiene sentido en no oficial). */
  humanizar: boolean;

  /** El monitor puede pausar solo. */
  autoPausa: boolean;
  /** Minutos de pausa automatica cuando el riesgo llega a rojo. */
  pausaRojaMin: number;
  /** Minutos que dura la rampa de vuelta despues de una pausa. */
  rampaMin: number;

  umbrales: Umbrales;

  /** A quien se avisa por WhatsApp cuando el numero cambia de nivel. Vacio = a nadie. */
  avisarA: string;
}

const UMBRALES_COMUNES: Umbrales = {
  maxFallosPct: 20,
  maxSinWhatsappPct: 15,
  maxBajasPct: 2,
  minEntregaPct: 60,
  maxQuejasPct: 5,
  maxRatioSalidaEntrada: 15,
  minEnviosParaJuzgar: 20,
};

/** Meta oficial: el tier y la calidad ya limitan; esto es el colchon. */
export const POLITICA_CLOUD: Politica = {
  perfil: 'cloud',
  maxPorMinuto: 20,
  maxPorHora: 400,
  pausaMinMs: 2_000,
  pausaMaxMs: 6_000,
  nuevosContactosPorDia: 0,
  maxPorContactoDia: 3,
  separacionContactoMs: 10 * 60_000,
  horaInicio: 9,
  horaFin: 20,
  diasPermitidos: [1, 2, 3, 4, 5, 6],
  timezone: 'America/Lima',
  fraccionTier: 0.9,
  fatigaEnvios: 3,
  fatigaDescansoDias: 14,
  plantillaNuevaDias: 3,
  plantillaNuevaPorDia: 100,
  warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000, reinicioTrasDiasInactivo: 7 },
  humanizar: false,
  autoPausa: true,
  pausaRojaMin: 240,
  rampaMin: 120,
  umbrales: UMBRALES_COMUNES,
  avisarA: '',
};

/** Baileys / WAHA: sin tier ni calidad, el patron lo es todo. */
export const POLITICA_NO_OFICIAL: Politica = {
  perfil: 'no_oficial',
  maxPorMinuto: 4,
  maxPorHora: 80,
  pausaMinMs: 15_000,
  pausaMaxMs: 45_000,
  nuevosContactosPorDia: 80,
  maxPorContactoDia: 3,
  separacionContactoMs: 10 * 60_000,
  horaInicio: 9,
  horaFin: 20,
  diasPermitidos: [1, 2, 3, 4, 5, 6],
  timezone: 'America/Lima',
  fraccionTier: 1,
  fatigaEnvios: 2,
  fatigaDescansoDias: 14,
  plantillaNuevaDias: 0,
  plantillaNuevaPorDia: 0,
  // Cuatro dias de inactividad, no tres: un fin de semana largo no puede
  // devolver el numero al primer dia de warm-up.
  warmup: { startPerDay: 20, growth: 1.6, hardCap: 400, reinicioTrasDiasInactivo: 4 },
  humanizar: true,
  autoPausa: true,
  pausaRojaMin: 720,
  rampaMin: 240,
  umbrales: { ...UMBRALES_COMUNES, maxFallosPct: 15, minEntregaPct: 70 },
  avisarA: '',
};

export function politicaBase(perfil: PerfilRitmo): Politica {
  return perfil === 'cloud' ? { ...POLITICA_CLOUD } : { ...POLITICA_NO_OFICIAL };
}

const dado = <T>(v: T | undefined | null): v is T => v !== undefined && v !== null;

/**
 * La politica vigente: el perfil que toque, con lo que el .env sobreescriba.
 *
 * `perfil` viene del proveedor (cloud = oficial; local y waha = no oficial)
 * salvo que RITMO_PERFIL lo fije a mano.
 */
export function politicaDesdeConfig(config: Config, perfilProveedor: PerfilRitmo): Politica {
  const perfil: PerfilRitmo =
    config.RITMO_PERFIL === 'cloud' || config.RITMO_PERFIL === 'no_oficial'
      ? config.RITMO_PERFIL
      : perfilProveedor;

  const base = politicaBase(perfil);
  const p: Politica = {
    ...base,
    timezone: config.timezone,
    warmup: { ...base.warmup },
    umbrales: { ...base.umbrales },
    avisarA: config.SALUD_AVISAR_A?.trim() || config.RUTAS_SUPERVISOR?.trim() || '',
  };

  if (dado(config.RITMO_MAX_POR_MINUTO)) p.maxPorMinuto = config.RITMO_MAX_POR_MINUTO;
  if (dado(config.RITMO_MAX_POR_HORA)) p.maxPorHora = config.RITMO_MAX_POR_HORA;
  if (dado(config.RITMO_PAUSA_MIN_SEG)) p.pausaMinMs = config.RITMO_PAUSA_MIN_SEG * 1000;
  if (dado(config.RITMO_PAUSA_MAX_SEG)) p.pausaMaxMs = config.RITMO_PAUSA_MAX_SEG * 1000;
  if (p.pausaMaxMs < p.pausaMinMs) p.pausaMaxMs = p.pausaMinMs;
  if (dado(config.RITMO_NUEVOS_CONTACTOS_DIA)) p.nuevosContactosPorDia = config.RITMO_NUEVOS_CONTACTOS_DIA;
  if (dado(config.RITMO_MAX_POR_CONTACTO_DIA)) p.maxPorContactoDia = config.RITMO_MAX_POR_CONTACTO_DIA;
  if (dado(config.RITMO_SEPARACION_CONTACTO_MIN)) {
    p.separacionContactoMs = config.RITMO_SEPARACION_CONTACTO_MIN * 60_000;
  }
  if (dado(config.HORARIO_ENVIO_INICIO)) p.horaInicio = config.HORARIO_ENVIO_INICIO;
  if (dado(config.HORARIO_ENVIO_FIN)) p.horaFin = config.HORARIO_ENVIO_FIN;
  if (config.horarioEnvioDias?.length) p.diasPermitidos = config.horarioEnvioDias;
  if (dado(config.RITMO_FRACCION_TIER)) p.fraccionTier = config.RITMO_FRACCION_TIER;
  if (dado(config.SALUD_FATIGA_ENVIOS)) p.fatigaEnvios = config.SALUD_FATIGA_ENVIOS;
  if (dado(config.SALUD_FATIGA_DESCANSO_DIAS)) p.fatigaDescansoDias = config.SALUD_FATIGA_DESCANSO_DIAS;
  if (dado(config.PLANTILLA_NUEVA_DIAS)) p.plantillaNuevaDias = config.PLANTILLA_NUEVA_DIAS;
  if (dado(config.PLANTILLA_NUEVA_POR_DIA)) p.plantillaNuevaPorDia = config.PLANTILLA_NUEVA_POR_DIA;

  // El warm-up ya existia con sus variables: se respetan cuando estan dadas
  // explicitamente; si no, manda el perfil (el no oficial arranca mas bajo).
  if (dado(config.WARMUP_START_PER_DAY)) p.warmup.startPerDay = config.WARMUP_START_PER_DAY;
  if (dado(config.WARMUP_GROWTH)) p.warmup.growth = config.WARMUP_GROWTH;
  if (dado(config.DAILY_SEND_CAP)) p.warmup.hardCap = config.DAILY_SEND_CAP;
  if (dado(config.WARMUP_REINICIO_DIAS)) p.warmup.reinicioTrasDiasInactivo = config.WARMUP_REINICIO_DIAS;

  if (dado(config.HUMANIZAR)) p.humanizar = config.HUMANIZAR;
  if (dado(config.SALUD_AUTO_PAUSA)) p.autoPausa = config.SALUD_AUTO_PAUSA;
  if (dado(config.SALUD_PAUSA_ROJA_MIN)) p.pausaRojaMin = config.SALUD_PAUSA_ROJA_MIN;
  if (dado(config.SALUD_RAMPA_MIN)) p.rampaMin = config.SALUD_RAMPA_MIN;

  if (dado(config.SALUD_MAX_FALLOS_PCT)) p.umbrales.maxFallosPct = config.SALUD_MAX_FALLOS_PCT;
  if (dado(config.SALUD_MAX_SIN_WHATSAPP_PCT)) p.umbrales.maxSinWhatsappPct = config.SALUD_MAX_SIN_WHATSAPP_PCT;
  if (dado(config.SALUD_MAX_BAJAS_PCT)) p.umbrales.maxBajasPct = config.SALUD_MAX_BAJAS_PCT;
  if (dado(config.SALUD_MIN_ENTREGA_PCT)) p.umbrales.minEntregaPct = config.SALUD_MIN_ENTREGA_PCT;
  if (dado(config.SALUD_MAX_QUEJAS_PCT)) p.umbrales.maxQuejasPct = config.SALUD_MAX_QUEJAS_PCT;
  if (dado(config.SALUD_MIN_ENVIOS_JUZGAR)) p.umbrales.minEnviosParaJuzgar = config.SALUD_MIN_ENVIOS_JUZGAR;

  return p;
}

/**
 * El limite numerico del tier de Meta.
 *
 * Meta lo manda como `TIER_250`, `TIER_1K`, `TIER_10K`, `TIER_100K`,
 * `TIER_UNLIMITED` (y en portafolios nuevos sin verificar, `TIER_50` o
 * `TIER_NOT_SET`). Desde 2025 el segundo escalon son 2.000 y no 1.000, pero
 * el nombre del tier no siempre lo refleja: por eso `limite24h` -el numero
 * que llega por `business_capability_update`- manda cuando existe.
 */
export function limiteDelTier(tier: string | null | undefined): number | null {
  if (!tier) return null;
  const t = tier.toUpperCase();
  if (t.includes('UNLIMITED')) return Number.POSITIVE_INFINITY;
  const m = /TIER_(\d+)(K?)/.exec(t);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] ? 1000 : 1);
  return Number.isFinite(n) && n > 0 ? n : null;
}
