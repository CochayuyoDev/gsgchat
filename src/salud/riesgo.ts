/**
 * El riesgo del numero, en un numero.
 *
 * Meta no publica la formula con la que decide bajar la calidad o restringir
 * una cuenta, pero si dice que mira: bloqueos y reportes de los usuarios en
 * los ultimos 7 dias, con mas peso a lo reciente. Lo que si se puede ver
 * desde aqui son las senales que preceden a eso:
 *
 *  - errores de Meta que hablan de calidad (131048), de cuenta restringida
 *    (131031, 368), de exceso hacia una persona (131049, 131056) o de
 *    velocidad (130429);
 *  - mensajes que no llegan (sin `delivered` tras horas) o a numeros que no
 *    existen (131026): una lista sucia o un numero al que ya no se le
 *    entrega, que es como empieza un baneo en un cliente no oficial;
 *  - gente dandose de baja, contestando "no soy yo" o "no me escriban";
 *  - desconexiones seguidas y codigos 403/401 del socket.
 *
 * Cada senal suma puntos. Los puntos dan un nivel y el nivel, un factor de
 * velocidad: en amarillo se va a la mitad, en naranja a un quinto y sin
 * marketing, en rojo se para y se descansa. Es una funcion pura: recibe
 * cifras y devuelve una decision, sin base de datos ni reloj.
 */

import type { NivelRiesgo } from '../db/repos.js';
import type { PerfilRitmo, Umbrales } from './politica.js';

export interface Senales {
  /** Ventana: ultimos 50 envios que salieron hacia el proveedor. */
  ultimos: { enviados: number; fallidos: number; porCodigo: Record<string, number> };
  /** Ventana: ultimas 24 h. */
  dia: {
    enviados: number;
    entregados: number;
    /** Envios con mas de `minutosParaEntregar` minutos: solo esos cuentan para la tasa de entrega. */
    enviadosMaduros: number;
    entregadosMaduros: number;
    bajas: number;
    entrantes: number;
    quejas: number;
    porCodigo: Record<string, number>;
  };
  /** Ventana: ultima hora. */
  hora: {
    fallidos: number;
    porCodigo: Record<string, number>;
    desconexiones: number;
  };
  /** Ultimos 10 minutos: para frenar por velocidad sin esperar a la hora. */
  reciente: { porCodigo: Record<string, number> };
  /** Lo que dice Meta del numero. */
  calidad: 'GREEN' | 'YELLOW' | 'RED';
  /** CONNECTED | FLAGGED | RESTRICTED | BANNED | DISCONNECTED | ... */
  estado: string;
  /** Codigos del socket (no oficial) en la ultima hora: 403, 401, 428... */
  socket: { forbidden: boolean; loggedOut: boolean };
}

export interface Riesgo {
  puntos: number;
  nivel: NivelRiesgo;
  /** Multiplicador de velocidad: 1 normal, 0.5, 0.2, 0 parado. */
  factor: number;
  /** Marketing en pausa aunque el resto siga. */
  sinMarketing: boolean;
  /** Motivos legibles, en orden de peso. */
  motivos: string[];
  /**
   * Cuanto descansar si el nivel es rojo, en ms. `null` = hasta que una
   * persona lo reanude (un baneo o una cuenta restringida no se arreglan
   * esperando).
   */
  descansoMs: number | null;
}

/** Codigos de Meta y del socket, con lo que significan para el riesgo. */
export const CODIGOS = {
  /** Meta: restricciones por calidad en el numero. Rojo, 24 h. */
  calidadNumero: '131048',
  /** Meta: cuenta restringida o deshabilitada. Rojo, hasta que se mire. */
  cuentaRestringida: ['131031', '368', '131057'],
  /** Meta: la persona ya recibio demasiado marketing. */
  porUsuario: '131049',
  /** Meta: demasiados mensajes a la misma persona en poco tiempo. */
  porPar: '131056',
  /** Meta: velocidad. */
  velocidad: ['130429', '4', '80007'],
  /** Meta: el numero no tiene WhatsApp. */
  sinWhatsapp: '131026',
  /** Socket no oficial: prohibido = baneo. */
  socketForbidden: '403',
  /** Socket no oficial: desvinculado. */
  socketLoggedOut: '401',
  /** Socket no oficial: "rate-overlimit". */
  socketRateLimit: '429',
} as const;

const suma = (porCodigo: Record<string, number>, codigos: readonly string[]): number =>
  codigos.reduce((acc, c) => acc + (porCodigo[c] ?? 0), 0);

const pct = (parte: number, total: number): number => (total > 0 ? (parte / total) * 100 : 0);

export function nivelDe(puntos: number): NivelRiesgo {
  if (puntos >= 85) return 'rojo';
  if (puntos >= 60) return 'naranja';
  if (puntos >= 30) return 'amarillo';
  return 'verde';
}

export function factorDe(nivel: NivelRiesgo): number {
  switch (nivel) {
    case 'rojo':
      return 0;
    case 'naranja':
      return 0.2;
    case 'amarillo':
      return 0.5;
    default:
      return 1;
  }
}

export function evaluarRiesgo(
  s: Senales,
  umbrales: Umbrales,
  perfil: PerfilRitmo,
  pausaRojaMs: number,
): Riesgo {
  const motivos: Array<{ puntos: number; texto: string }> = [];
  let descansoMs: number | null = pausaRojaMs;
  let manual = false;

  const anotar = (puntos: number, texto: string) => motivos.push({ puntos, texto });

  // --- lo que dice Meta del numero: manda sobre todo lo demas ---------
  if (s.estado === 'BANNED') {
    anotar(100, 'el proveedor dice que el numero esta baneado');
    manual = true;
  }
  if (s.calidad === 'RED' || s.estado === 'FLAGGED') {
    anotar(100, 'Meta tiene el numero en ROJO (flagged): esta a un paso de bajar el tier');
  } else if (s.calidad === 'YELLOW') {
    anotar(40, 'Meta tiene el numero en AMARILLO');
  }
  if (s.estado === 'RESTRICTED') {
    anotar(70, 'Meta dice RESTRICTED: se agoto el limite de conversaciones de 24 h');
  }

  // --- errores que nombran el problema -------------------------------
  const restringida = suma(s.hora.porCodigo, CODIGOS.cuentaRestringida);
  if (restringida > 0) {
    anotar(100, `Meta rechazo ${restringida} envio(s) por cuenta restringida (131031/368)`);
    manual = true;
  }
  const calidad = s.hora.porCodigo[CODIGOS.calidadNumero] ?? 0;
  if (calidad > 0) {
    anotar(100, `Meta rechazo ${calidad} envio(s) por restricciones de calidad del numero (131048)`);
    descansoMs = Math.max(pausaRojaMs, 24 * 60 * 60 * 1000);
  }
  if (s.socket.forbidden) {
    anotar(100, 'el socket recibio 403 (forbidden): WhatsApp esta rechazando la sesion');
    manual = true;
  }
  if (s.socket.loggedOut) {
    anotar(60, 'el socket recibio 401: la sesion se cerro desde el telefono');
  }

  const velocidad = suma(s.reciente.porCodigo, CODIGOS.velocidad) + (s.reciente.porCodigo[CODIGOS.socketRateLimit] ?? 0);
  if (velocidad > 0) {
    anotar(20, `${velocidad} rechazo(s) por velocidad en los ultimos 10 minutos (130429)`);
  }
  const porPar = s.hora.porCodigo[CODIGOS.porPar] ?? 0;
  if (porPar >= 3) {
    anotar(15, `${porPar} rechazos por escribir demasiado a la misma persona en una hora (131056)`);
  }
  const porUsuario = s.hora.porCodigo[CODIGOS.porUsuario] ?? 0;
  if (porUsuario > 0 && s.hora.fallidos > 0) {
    const cuota = pct(porUsuario, Math.max(s.hora.fallidos, porUsuario));
    if (porUsuario >= 5 || cuota >= 30) {
      anotar(30, `${porUsuario} personas ya no admiten mas marketing (131049): la lista esta saturada`);
    }
  }

  // --- porcentajes: solo con volumen suficiente ------------------------
  const suficiente = (n: number) => n >= umbrales.minEnviosParaJuzgar;

  if (suficiente(s.ultimos.enviados)) {
    const fallos = pct(s.ultimos.fallidos, s.ultimos.enviados);
    if (fallos >= umbrales.maxFallosPct * 2) {
      anotar(70, `${fallos.toFixed(0)} % de los ultimos ${s.ultimos.enviados} envios fallaron`);
    } else if (fallos >= umbrales.maxFallosPct) {
      anotar(40, `${fallos.toFixed(0)} % de los ultimos ${s.ultimos.enviados} envios fallaron`);
    }
    const sinWa = pct(s.ultimos.porCodigo[CODIGOS.sinWhatsapp] ?? 0, s.ultimos.enviados);
    if (sinWa >= umbrales.maxSinWhatsappPct) {
      anotar(30, `${sinWa.toFixed(0)} % de los ultimos envios fueron a numeros sin WhatsApp: la lista esta sucia`);
    }
  }

  if (suficiente(s.dia.enviados)) {
    const bajas = pct(s.dia.bajas, s.dia.enviados);
    if (bajas >= umbrales.maxBajasPct * 2.5) {
      anotar(60, `${s.dia.bajas} bajas en 24 h (${bajas.toFixed(1)} % de lo enviado)`);
    } else if (bajas >= umbrales.maxBajasPct) {
      anotar(30, `${s.dia.bajas} bajas en 24 h (${bajas.toFixed(1)} % de lo enviado)`);
    }
    const quejas = pct(s.dia.quejas, s.dia.enviados);
    if (quejas >= umbrales.maxQuejasPct) {
      anotar(20, `${s.dia.quejas} personas contestaron "no soy yo" o "no me escriban" en 24 h`);
    }
    if (perfil === 'no_oficial' && s.dia.enviados >= 50) {
      const ratio = s.dia.entrantes > 0 ? s.dia.enviados / s.dia.entrantes : Number.POSITIVE_INFINITY;
      if (ratio > umbrales.maxRatioSalidaEntrada) {
        anotar(
          15,
          `${s.dia.enviados} salientes por ${s.dia.entrantes} entrantes en 24 h: parece un robot, no una conversacion`,
        );
      }
    }
  }

  if (suficiente(s.dia.enviadosMaduros)) {
    const entrega = pct(s.dia.entregadosMaduros, s.dia.enviadosMaduros);
    if (entrega < umbrales.minEntregaPct) {
      anotar(
        40,
        `solo el ${entrega.toFixed(0)} % de lo enviado hace mas de una hora consta como entregado`,
      );
    }
  }

  if (s.hora.desconexiones >= 3) {
    anotar(20, `${s.hora.desconexiones} desconexiones en la ultima hora`);
  }

  motivos.sort((a, b) => b.puntos - a.puntos);
  const puntos = Math.min(100, motivos.reduce((acc, m) => acc + m.puntos, 0));
  const nivel = nivelDe(puntos);

  return {
    puntos,
    nivel,
    factor: factorDe(nivel),
    sinMarketing: nivel === 'naranja' || nivel === 'rojo' || s.calidad === 'YELLOW',
    motivos: motivos.map((m) => m.texto),
    descansoMs: nivel === 'rojo' ? (manual ? null : descansoMs) : null,
  };
}

/**
 * El factor durante la rampa de vuelta tras una pausa.
 *
 * Se sale despacio: 10 %, 25 %, 50 %, 75 % y 100 % del ritmo normal, en
 * cinco tramos iguales. Volver de golpe al ritmo anterior es repetir lo que
 * provoco la pausa.
 */
export function factorDeRampa(rampaDesde: Date, ahora: Date, duracionMs: number): number {
  if (duracionMs <= 0) return 1;
  const transcurrido = ahora.getTime() - rampaDesde.getTime();
  if (transcurrido >= duracionMs) return 1;
  const tramo = Math.floor((transcurrido / duracionMs) * 5);
  return [0.1, 0.25, 0.5, 0.75, 1][Math.max(0, Math.min(4, tramo))]!;
}
