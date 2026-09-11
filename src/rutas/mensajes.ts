/**
 * Que se le dice al cliente en cada paso, y con que.
 *
 * Hay dos formas de escribirle y no son intercambiables:
 *
 *  - Plantilla aprobada por Meta. Es la unica que sale cuando el cliente no
 *    ha escrito en las ultimas 24 h, que es el caso normal aqui: al cliente
 *    de un reparto se le escribe primero, no responde el.
 *  - Texto libre con el boton nativo de ubicacion. Sale dentro de la ventana
 *    de 24 h, y siempre con los clientes no oficiales. Es mejor cuando se
 *    puede: el boton abre el selector de ubicacion de un toque, sin explicarle
 *    al cliente donde esta el clip.
 *
 * El texto de las tres plantillas esta escrito para que Meta lo apruebe como
 * UTILITY: sin promocion, sin mayusculas sostenidas, sin exclamaciones, y
 * dejando claro de que pedido se habla. Ver `npm run templates:lint`.
 */

import { elegirVariante } from '../salud/variantes.js';

export type PasoUbicacion = 'solicitud' | 'recordatorio' | 'insistencia';

export interface ContextoMensaje {
  nombre?: string | null;
  negocio: string;
  referencia?: string | null;
}

/** Como se llama a alguien de quien no se sabe el nombre. */
const tratamiento = (nombre?: string | null): string => {
  const limpio = (nombre ?? '').trim().split(/\s+/)[0] ?? '';
  return limpio || 'buenas tardes';
};

/** El pedido, dicho de forma que no quede un hueco raro si no hay numero. */
const pedido = (referencia?: string | null): string => {
  const limpio = (referencia ?? '').trim();
  return limpio || 'tu pedido';
};

export interface PlantillaPaso {
  /** La plantilla principal; se usa si no hay ninguna variante aprobada. */
  name: string;
  language: string;
  /**
   * Todas las plantillas que sirven para este paso, la principal incluida.
   * El motor alterna entre las aprobadas y deja fuera las que Meta tenga
   * pausadas: ver src/salud/variantes.ts.
   */
  variantes: string[];
  /** En el orden en que las espera la plantilla (el mismo en todas las variantes). */
  variables: (ctx: ContextoMensaje) => string[];
}

export const PLANTILLAS: Record<PasoUbicacion, PlantillaPaso> = {
  solicitud: {
    name: 'solicitud_ubicacion',
    language: 'es',
    variantes: ['solicitud_ubicacion', 'solicitud_ubicacion_b'],
    variables: (ctx) => [tratamiento(ctx.nombre), ctx.negocio, pedido(ctx.referencia)],
  },
  recordatorio: {
    name: 'recordatorio_ubicacion',
    language: 'es',
    variantes: ['recordatorio_ubicacion', 'recordatorio_ubicacion_b'],
    variables: (ctx) => [tratamiento(ctx.nombre), pedido(ctx.referencia)],
  },
  insistencia: {
    name: 'ubicacion_pendiente',
    language: 'es',
    variantes: ['ubicacion_pendiente', 'ubicacion_pendiente_b'],
    variables: (ctx) => [tratamiento(ctx.nombre), pedido(ctx.referencia)],
  },
};

/**
 * Las redacciones de cada paso cuando se escribe libre.
 *
 * Varias por paso, y no por gusto: con un cliente no oficial el texto sale
 * tal cual, y doscientos mensajes identicos seguidos son la huella mas facil
 * de detectar que existe. A cada cliente le toca una (por su telefono y el
 * intento), asi que el mismo cliente no ve tres redacciones distintas del
 * mismo mensaje si algo se reintenta.
 *
 * Cada paso dice algo distinto a proposito. Mandarle el mismo mensaje tres
 * veces a alguien que ya contesto es lo que hace que la gente bloquee el
 * numero: la tercera vez tiene que reconocer que contesto y ofrecer la
 * salida (que le llamen), no repetir la peticion como si nadie leyera.
 */
export const VARIANTES_TEXTO: Record<PasoUbicacion, Array<(ctx: ContextoMensaje) => string>> = {
  solicitud: [
    (ctx) =>
      `Hola ${tratamiento(ctx.nombre)}, le escribimos de ${ctx.negocio} por ${pedido(ctx.referencia)}. ` +
      'Para llegar exacto a su dirección necesitamos su ubicación. ' +
      'Puede enviarla con el botón de aquí abajo.',
    (ctx) =>
      `Buen día ${tratamiento(ctx.nombre)}, somos ${ctx.negocio} y tenemos ${pedido(ctx.referencia)} listo para entregar. ` +
      '¿Nos comparte su ubicación con el botón de abajo? Así el repartidor llega sin dar vueltas.',
    (ctx) =>
      `${tratamiento(ctx.nombre)}, le saluda ${ctx.negocio}. Vamos a entregarle ${pedido(ctx.referencia)} y ` +
      'necesitamos el punto exacto: toque el botón de abajo y envíe su ubicación, por favor.',
  ],
  recordatorio: [
    (ctx) =>
      `Hola ${tratamiento(ctx.nombre)}, seguimos pendientes de su ubicación para entregar ${pedido(ctx.referencia)}. ` +
      'Con el botón de abajo la envía en un toque. Si prefiere, responda este ' +
      'mensaje y le llamamos.',
    (ctx) =>
      `${tratamiento(ctx.nombre)}, todavía no recibimos su ubicación para ${pedido(ctx.referencia)}. ` +
      'Cuando pueda, envíela con el botón de abajo. Si le viene mejor por teléfono, responda y le llamamos.',
    (ctx) =>
      `Le escribimos otra vez por ${pedido(ctx.referencia)}, ${tratamiento(ctx.nombre)}: nos falta su ubicación ` +
      'para poder salir a entregar. Está en el botón de abajo. También podemos llamarle si responde este mensaje.',
  ],
  insistencia: [
    (ctx) =>
      `Gracias por responder, ${tratamiento(ctx.nombre)}. Para ${pedido(ctx.referencia)} nos falta el punto exacto: ` +
      'use el botón de abajo para compartir su ubicación. Si le resulta más ' +
      'cómodo, respóndanos y le llamamos.',
    (ctx) =>
      `Recibimos su mensaje, ${tratamiento(ctx.nombre)}, gracias. Lo que nos falta para entregar ${pedido(ctx.referencia)} ` +
      'es el punto en el mapa: toque el botón de abajo y envíe su ubicación. O respóndanos y le llamamos.',
    (ctx) =>
      `${tratamiento(ctx.nombre)}, gracias por escribirnos. Para ${pedido(ctx.referencia)} necesitamos su ubicación exacta, ` +
      'no solo la dirección: el botón de abajo la envía en un toque. Si prefiere, le llamamos.',
  ],
};

/**
 * El texto cuando se puede escribir libre.
 *
 * Sin `clave`, la primera redaccion (la de siempre); con clave -telefono e
 * intento-, la variante que le toca a ese cliente.
 */
export function textoLibre(paso: PasoUbicacion, ctx: ContextoMensaje, clave?: string): string {
  const variantes = VARIANTES_TEXTO[paso];
  const elegida = clave ? elegirVariante(variantes, clave) : variantes[0]!;
  return elegida(ctx);
}

/** Lo que se apunta en la bitacora para cada paso. */
export const DESCRIPCION_PASO: Record<PasoUbicacion, string> = {
  solicitud: 'primera solicitud de ubicación',
  recordatorio: 'recordatorio: no había respondido',
  insistencia: 'respondió sin ubicación: se le vuelve a pedir el punto',
};

/** Confirmacion cuando el cliente manda por fin su ubicacion. */
export function textoGracias(ctx: ContextoMensaje): string {
  return (
    `Gracias, recibimos su ubicación para ${pedido(ctx.referencia)}. ` +
    'El repartidor la usará para llegar. Que tenga buen día.'
  );
}

/** Cuando la ubicacion llega pero cae fuera de la zona que se atiende. */
export function textoFueraDeZona(cobertura: string): string {
  return (
    `Recibimos su ubicación, pero queda fuera de la zona que cubrimos${
      cobertura ? ` (${cobertura})` : ''
    }. Un compañero se comunicará con usted para coordinar la entrega.`
  );
}

/** Cuando pasa a una persona: hay que decirlo, no dejar la conversacion muda. */
export function textoDerivacion(ctx: ContextoMensaje): string {
  return (
    `Gracias por su tiempo. Para ${pedido(ctx.referencia)} le va a llamar el ` +
    'repartidor para coordinar la entrega directamente.'
  );
}
