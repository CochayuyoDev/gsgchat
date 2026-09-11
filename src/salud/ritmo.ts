/**
 * El marcapasos: cuando puede salir el siguiente mensaje iniciado por la
 * empresa, y cuanto hay que esperar si no.
 *
 * Antes cada modulo llevaba su propio ritmo (rutas: 15-30 s; campanas: diez
 * por segundo; secuencias: lo que venciera). El numero es uno solo y
 * WhatsApp lo mira entero, asi que el ritmo tambien tiene que ser uno solo.
 * Todo lo que inicia la empresa pasa por aqui; responder a un cliente dentro
 * de su ventana no, porque eso no es un patron de envio masivo, es una
 * conversacion.
 *
 * Cinco cosas mira, en este orden:
 *
 *  1. Horario y dia. Un mensaje comercial a las tres de la manana se
 *     contesta con "reportar".
 *  2. Techo del tier de Meta: destinatarios unicos en 24 h moviles, que es
 *     exactamente lo que Meta cuenta. Se para al 90 % para no rozar el
 *     RESTRICTED.
 *  3. Cupos por minuto y por hora, escalados por el factor de riesgo.
 *  4. Contactos nuevos por dia (no oficial): escribir a mucha gente que no
 *     te tiene agendada es la senal mas fuerte de spam en un cliente web.
 *  5. La pausa sorteada desde el ultimo envio, tambien escalada por el
 *     factor. Con factor 0.5 se espera el doble.
 *
 * Es una funcion pura sobre una foto del estado, y una clase pequena que
 * guarda lo que no esta en la base: los envios del ultimo minuto y la pausa
 * sorteada para el siguiente.
 */

import type { Politica } from './politica.js';

export interface FotoRitmo {
  ahora: Date;
  /** Multiplicador de velocidad que viene del riesgo: 1 normal, 0 parado. */
  factor: number;
  /** Envios iniciados por la empresa en el ultimo minuto y en la ultima hora. */
  ultimoMinuto: number;
  ultimaHora: number;
  /** Cuando salio el ultimo, y la pausa que se sorteo entonces. */
  ultimoEnvioAt: Date | null;
  pausaSorteadaMs: number;
  /** Destinatarios unicos en las ultimas 24 h y el techo de Meta (null = sin dato). */
  destinatariosUnicos24h: number;
  limiteTier: number | null;
  /** Contactos escritos por primera vez hoy. */
  nuevosContactosHoy: number;
  /** Si este envio va a un contacto al que nunca se le escribio. */
  esContactoNuevo: boolean;
}

export type CodigoRitmo =
  | 'fuera_de_horario'
  | 'riesgo_parado'
  | 'tier_24h'
  | 'cupo_minuto'
  | 'cupo_hora'
  | 'nuevos_contactos_dia'
  | 'pausa_entre_envios';

export type DecisionRitmo =
  | { ok: true }
  | { ok: false; codigo: CodigoRitmo; motivo: string; esperaMs: number };

const MINUTO = 60_000;
const HORA = 60 * MINUTO;

/** Hora y dia de la semana en la zona del negocio. */
export function horaLocal(fecha: Date, timezone: string): { hora: number; dia: number } {
  try {
    const partes = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
      weekday: 'short',
    }).formatToParts(fecha);
    const hora = Number(partes.find((p) => p.type === 'hour')?.value ?? fecha.getHours()) % 24;
    const dias = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dia = dias.indexOf(partes.find((p) => p.type === 'weekday')?.value ?? '');
    return { hora, dia: dia >= 0 ? dia : fecha.getDay() };
  } catch {
    return { hora: fecha.getHours(), dia: fecha.getDay() };
  }
}

export function enHorario(fecha: Date, politica: Pick<Politica, 'horaInicio' | 'horaFin' | 'diasPermitidos' | 'timezone'>): boolean {
  const { hora, dia } = horaLocal(fecha, politica.timezone);
  if (politica.diasPermitidos.length && !politica.diasPermitidos.includes(dia)) return false;
  return hora >= politica.horaInicio && hora < politica.horaFin;
}

/**
 * Milisegundos hasta la proxima apertura del horario.
 *
 * Se avanza de hora en hora hasta encontrar una que este dentro; con un
 * horario razonable son como mucho 7 dias x 24 vueltas, que no cuestan nada.
 */
export function msHastaApertura(fecha: Date, politica: Pick<Politica, 'horaInicio' | 'horaFin' | 'diasPermitidos' | 'timezone'>): number {
  if (enHorario(fecha, politica)) return 0;
  // Se redondea al inicio de la hora siguiente y se avanza desde ahi.
  const base = new Date(fecha);
  base.setMinutes(0, 0, 0);
  for (let i = 1; i <= 24 * 8; i++) {
    const candidata = new Date(base.getTime() + i * HORA);
    if (enHorario(candidata, politica)) return Math.max(MINUTO, candidata.getTime() - fecha.getTime());
  }
  return HORA;
}

/**
 * Pausa sorteada entre dos envios.
 *
 * La suma de dos uniformes se parece a una campana: la mayoria de las
 * pausas caen cerca del centro y unas pocas en los extremos, que es como
 * escribe una persona. Un uniforme plano tiene otra huella.
 */
export function sortearPausa(minMs: number, maxMs: number, azar: () => number = Math.random): number {
  const min = Math.max(0, minMs);
  const max = Math.max(min, maxMs);
  const u = (azar() + azar()) / 2;
  return Math.round(min + u * (max - min));
}

export function decidirRitmo(foto: FotoRitmo, politica: Politica): DecisionRitmo {
  const { ahora } = foto;

  if (!enHorario(ahora, politica)) {
    return {
      ok: false,
      codigo: 'fuera_de_horario',
      motivo: `fuera del horario de envio (${politica.horaInicio}:00 a ${politica.horaFin}:00)`,
      esperaMs: msHastaApertura(ahora, politica),
    };
  }

  if (foto.factor <= 0) {
    return {
      ok: false,
      codigo: 'riesgo_parado',
      motivo: 'el monitor de salud tiene el numero parado',
      esperaMs: 15 * MINUTO,
    };
  }

  if (foto.limiteTier !== null && Number.isFinite(foto.limiteTier)) {
    const techo = Math.floor(foto.limiteTier * politica.fraccionTier);
    if (foto.destinatariosUnicos24h >= techo) {
      return {
        ok: false,
        codigo: 'tier_24h',
        motivo: `${foto.destinatariosUnicos24h} destinatarios distintos en 24 h: al ${Math.round(
          politica.fraccionTier * 100,
        )} % del tier de Meta (${foto.limiteTier})`,
        esperaMs: HORA,
      };
    }
  }

  // Los cupos se escalan por el factor: en amarillo, la mitad; en naranja, un quinto.
  const cupoMinuto = Math.max(1, Math.floor(politica.maxPorMinuto * foto.factor));
  const cupoHora = Math.max(1, Math.floor(politica.maxPorHora * foto.factor));

  if (foto.ultimoMinuto >= cupoMinuto) {
    return {
      ok: false,
      codigo: 'cupo_minuto',
      motivo: `ya salieron ${foto.ultimoMinuto} en el ultimo minuto (cupo ${cupoMinuto})`,
      esperaMs: 15_000,
    };
  }
  if (foto.ultimaHora >= cupoHora) {
    return {
      ok: false,
      codigo: 'cupo_hora',
      motivo: `ya salieron ${foto.ultimaHora} en la ultima hora (cupo ${cupoHora})`,
      esperaMs: 5 * MINUTO,
    };
  }

  if (politica.nuevosContactosPorDia > 0 && foto.esContactoNuevo) {
    const cupoNuevos = Math.max(1, Math.floor(politica.nuevosContactosPorDia * Math.max(foto.factor, 0.25)));
    if (foto.nuevosContactosHoy >= cupoNuevos) {
      return {
        ok: false,
        codigo: 'nuevos_contactos_dia',
        motivo: `hoy ya se escribio a ${foto.nuevosContactosHoy} contactos nuevos (cupo ${cupoNuevos})`,
        esperaMs: HORA,
      };
    }
  }

  if (foto.ultimoEnvioAt) {
    // Con factor 0.5 la pausa dura el doble; con 0.2, cinco veces.
    const pausa = foto.pausaSorteadaMs / Math.max(foto.factor, 0.05);
    const transcurrido = ahora.getTime() - foto.ultimoEnvioAt.getTime();
    if (transcurrido < pausa) {
      return {
        ok: false,
        codigo: 'pausa_entre_envios',
        motivo: 'esperando la pausa entre mensajes',
        esperaMs: Math.max(500, Math.ceil(pausa - transcurrido)),
      };
    }
  }

  return { ok: true };
}

/**
 * Lo que el marcapasos recuerda entre envios y que no vive en la base: los
 * instantes de los ultimos envios (para el cupo por minuto) y la pausa
 * sorteada para el siguiente.
 */
export class Marcapasos {
  private envios: number[] = [];
  private ultimo: Date | null = null;
  private pausaMs: number;

  constructor(
    private politica: () => Politica,
    private azar: () => number = Math.random,
  ) {
    const p = politica();
    this.pausaMs = sortearPausa(p.pausaMinMs, p.pausaMaxMs, azar);
  }

  /** Al arrancar: el ultimo envio que consta en la base, para respetar la pausa tras un reinicio. */
  sembrar(ultimo: Date): void {
    if (!this.ultimo || ultimo > this.ultimo) this.ultimo = ultimo;
  }

  /** Un envio iniciado por la empresa acaba de salir. */
  anotar(at: Date): void {
    this.envios.push(at.getTime());
    this.ultimo = at;
    const p = this.politica();
    this.pausaMs = sortearPausa(p.pausaMinMs, p.pausaMaxMs, this.azar);
    this.podar(at);
  }

  private podar(ahora: Date): void {
    const limite = ahora.getTime() - HORA;
    while (this.envios.length && this.envios[0]! < limite) this.envios.shift();
  }

  enUltimoMinuto(ahora: Date): number {
    this.podar(ahora);
    const limite = ahora.getTime() - MINUTO;
    return this.envios.filter((t) => t >= limite).length;
  }

  enUltimaHora(ahora: Date): number {
    this.podar(ahora);
    return this.envios.length;
  }

  ultimoEnvioAt(): Date | null {
    return this.ultimo;
  }

  pausaSorteadaMs(): number {
    return this.pausaMs;
  }

  /** Cuando podra salir el proximo, para ensenarlo en pantalla. */
  proximoEnvioEn(ahora: Date, factor: number): number {
    if (!this.ultimo) return 0;
    const pausa = this.pausaMs / Math.max(factor, 0.05);
    return Math.max(0, this.ultimo.getTime() + pausa - ahora.getTime());
  }
}
