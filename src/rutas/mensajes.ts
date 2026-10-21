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
  /** La tienda que vende, como la manda GSG en el pedido ({tienda}). */
  tienda?: string | null;
  /** El producto que manda GSG en el pedido ({producto}). */
  producto?: string | null;
  referencia?: string | null;
  /** Lo que se sabe del pedido: el cliente tiene que reconocer de que hablamos. */
  direccion?: string | null;
  distrito?: string | null;
  /** Horario vigente en Pedidos GSG, ya redactado para incluir en el mensaje. */
  horario?: string | null;
  desde?: string | null;
  hasta?: string | null;
  hastaExtendido?: string | null;
  /**
   * Si el mensaje va a llevar un boton nativo de ubicacion.
   *
   * Con la Cloud API dentro de la ventana de 24 h, si. Con el cliente no
   * oficial, no: los botones nativos llegan rotos a una cuenta personal, y
   * decirle al cliente "pulse el boton de abajo" cuando no hay ninguno es
   * la forma mas rapida de que no mande nada. Ahi se explica el clip.
   */
  conBoton?: boolean;
}

/** Como se le pide que la mande, segun haya boton o no. */
export const comoEnviar = (ctx: ContextoMensaje): string =>
  ctx.conBoton
    ? 'con el botón de aquí abajo'
    : 'desde el clip 📎 → Ubicación → Enviar tu ubicación actual';

/** El pedido con su distrito y direccion, para que el cliente lo reconozca. */
export const detallePedido = (ctx: ContextoMensaje): string => {
  const partes = [ctx.distrito, ctx.direccion].map((p) => (p ?? '').trim()).filter(Boolean);
  return partes.length ? ` (${partes.join(', ')})` : '';
};

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
 * Las redacciones de cada paso cuando se escribe libre: las del dueño
 * (17/10), con {tienda} = la tienda del pedido de GSG. Cada paso dice algo
 * distinto: el recordatorio reconoce que ya se le escribió y la insistencia
 * le da un plazo antes de que lo llame el motorizado.
 */
/** La tienda del pedido de GSG ({tienda}); sin ella, «la tienda». */
const tiendaDe = (ctx: ContextoMensaje): string => (ctx.tienda ?? '').trim() || 'la tienda';
const horarioDe = (ctx: ContextoMensaje): string => (ctx.horario ?? '').trim() || 'de 2:00 p. m. a 8:00 p. m.';
/** «¡Hola, Ana!» o, sin nombre, «¡Hola!». */
const conNombre = (antes: string, ctx: ContextoMensaje, despues: string): string => {
  const pila = (ctx.nombre ?? '').trim().split(/\s+/)[0];
  return pila ? `${antes}, ${pila}${despues}` : `${antes}${despues}`;
};

export const VARIANTES_TEXTO: Record<PasoUbicacion, Array<(ctx: ContextoMensaje) => string>> = {
  solicitud: [
    (ctx) =>
      `${conNombre('¡Hola', ctx, '!')} 👋 Somos GSG y estaremos llevando tu pedido de ${tiendaDe(ctx)}. 📦\n\n` +
      'Para llegar al punto indicado, por favor envíanos tu ubicación por WhatsApp y una referencia de tu dirección. 📍\n\n' +
      `Las entregas se realizan ${horarioDe(ctx)}. El motorizado se comunicará contigo para coordinar la hora aproximada de llegada. 🛵`,
  ],
  recordatorio: [
    (ctx) =>
      `${conNombre('¡Hola de nuevo', ctx, '!')} 👋 Aún estamos esperando tu ubicación para organizar la entrega de tu pedido de ${tiendaDe(ctx)}. 📦\n\n` +
      '📍 Por favor, compártenos tu ubicación por WhatsApp y una referencia para que nuestro motorizado pueda llegar al lugar correcto.\n\n' +
      `Recuerda que entregamos ${horarioDe(ctx)}. ¡Quedamos atentos!`,
  ],
  insistencia: [
    (ctx) =>
      `${conNombre('Hola', ctx, '.')} 👋 Aún no hemos recibido tu ubicación para la entrega de tu pedido de ${tiendaDe(ctx)}. 📦\n\n` +
      '📍 Por favor, envíanos tu ubicación por WhatsApp dentro de los próximos 10 minutos.\n\n' +
      'Si no la recibimos en ese tiempo, nuestro motorizado se comunicará contigo para coordinar la entrega.\n\n' +
      `Recuerda que nuestro horario de entrega es ${horarioDe(ctx)}. 🛵`,
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
