/**
 * Todo lo que el bot le dice al cliente, en un solo sitio y editable.
 *
 * Antes cada texto vivia incrustado en el flujo, asi que cambiar un saludo
 * pedia tocar codigo y desplegar. Aqui estan los mensajes con su valor por
 * defecto; la tienda los reescribe desde /panel y lo que guarda manda sobre
 * este fichero.
 *
 * Las variables entre llaves se sustituyen al enviar. No son opcionales por
 * capricho: `{cobertura}` y `{horario}` salen de la configuracion del negocio,
 * asi que cambiar el horario en un sitio lo cambia en todos los mensajes que
 * lo mencionan, en vez de dejar dos versiones que se contradicen.
 */

export interface DefinicionMensaje {
  /** Cuando lo manda el bot, en una linea, para la pantalla de edicion. */
  cuando: string;
  texto: string;
  /** Variables que tienen sentido aqui, para poder avisar si se usa otra. */
  variables: string[];
}

export const VARIABLES_COMUNES = ['{saludo}', '{negocio}', '{cobertura}', '{horario}'];

export const MENSAJES: Record<string, DefinicionMensaje> = {
  bienvenida: {
    cuando: 'La primera vez que alguien escribe, y solo esa vez.',
    texto:
      '{saludo}. Soy el asistente de {negocio}. Hacemos envíos en {cobertura}. ¿En qué te ayudo?',
    variables: VARIABLES_COMUNES,
  },
  menu: {
    cuando: 'Cuando escribe algo que no se entiende y hay que reorientarlo.',
    texto: 'No reconocí ese mensaje. ¿En qué te ayudo?',
    variables: VARIABLES_COMUNES,
  },
  info: {
    cuando: 'Cuando pregunta por horarios, zona o cobertura.',
    texto: 'Atendemos {cobertura}. Horario: {horario}.',
    variables: VARIABLES_COMUNES,
  },
  asesor: {
    cuando: 'Cuando pide hablar con una persona. El bot deja de contestar.',
    texto: 'Listo, en un momento te atiende una persona del equipo. Gracias por escribir.',
    variables: VARIABLES_COMUNES,
  },
  pedirRecojo: {
    cuando: 'Primera pregunta de la cotización: de dónde se recoge.',
    texto: '¿De qué distrito recogemos el envío? Puedes escribirlo o mandarme la ubicación.',
    variables: VARIABLES_COMUNES,
  },
  pedirEntrega: {
    cuando: 'Segunda pregunta: a dónde se lleva.',
    texto: '¿Y a qué distrito lo llevamos?',
    variables: VARIABLES_COMUNES,
  },
  pedirContenido: {
    cuando: 'Qué es lo que se envía.',
    texto: '¿Qué vas a enviar? Cuéntame qué es y su tamaño aproximado.',
    variables: VARIABLES_COMUNES,
  },
  pedirServicio: {
    cuando: 'Qué servicio o courier prefiere. Solo si hay más de uno configurado.',
    texto: '¿Qué servicio prefieres?',
    variables: VARIABLES_COMUNES,
  },
  pedirCuando: {
    cuando: 'Para cuándo lo necesita.',
    texto: '¿Para cuándo lo necesitas?',
    variables: VARIABLES_COMUNES,
  },
  pedirNombre: {
    cuando: 'A nombre de quién va el envío.',
    texto: '¿A nombre de quién registramos el envío?',
    variables: VARIABLES_COMUNES,
  },
  pedirDocumento: {
    cuando: 'DNI o RUC para el comprobante. Es la última pregunta.',
    texto: 'Por último, tu DNI o RUC para el comprobante. Si prefieres darlo después, responde NO.',
    variables: VARIABLES_COMUNES,
  },
  ubicacionRecojo: {
    cuando: 'Cuando comparte su ubicación y falta saber el distrito de recojo.',
    texto: 'Recibí la ubicación de recojo. ¿De qué distrito es?',
    variables: VARIABLES_COMUNES,
  },
  ubicacionEntrega: {
    cuando: 'Cuando comparte su ubicación y falta saber el distrito de entrega.',
    texto: 'Recibí la ubicación de entrega. ¿De qué distrito es?',
    variables: VARIABLES_COMUNES,
  },
  cierre: {
    cuando: 'Cuando la ficha está completa. Va detrás del resumen del pedido.',
    texto:
      'Con esto ya te preparamos la cotización. En un momento te escribe una persona del equipo.',
    variables: VARIABLES_COMUNES,
  },
  precioEncontrado: {
    cuando: 'Cuando pregunta por un producto y se encuentra en el catálogo.',
    texto: 'Esto es lo que tenemos:',
    variables: VARIABLES_COMUNES,
  },
  precioAproximado: {
    cuando: 'Cuando lo que pidió no está, pero hay algo parecido. Evita dar por bueno un producto que no es.',
    texto: 'No tengo exactamente eso, pero sí esto:',
    variables: VARIABLES_COMUNES,
  },
  precioAgotado: {
    cuando: 'Cuando lo que pide existe en el catálogo pero no queda stock.',
    texto: 'Eso lo tenemos, pero ahora mismo estamos sin stock:',
    variables: VARIABLES_COMUNES,
  },
  precioOtrasVariantes: {
    cuando: 'Cuando la presentación que pidió está agotada pero quedan otras del mismo producto.',
    texto: 'De ese mismo sí me queda:',
    variables: VARIABLES_COMUNES,
  },
  precioSimilares: {
    cuando: 'Va delante de las alternativas, cuando las hay. Si no hay, no se manda nada.',
    texto: 'Sí tengo disponible, por si te sirve:',
    variables: VARIABLES_COMUNES,
  },
  precioSinAlternativas: {
    cuando: 'Cuando está agotado y no hay nada parecido que ofrecer.',
    texto: 'En cuanto vuelva a haber te aviso. ¿Te ayudo con algo más?',
    variables: VARIABLES_COMUNES,
  },
  precioSinResultado: {
    cuando: 'Cuando pregunta por un producto que la tienda no tiene.',
    texto:
      'Ese producto no se encuentra disponible en nuestra tienda. Si quieres, dime de otra forma lo que buscas o responde ASESOR y te atiende una persona.',
    variables: VARIABLES_COMUNES,
  },
  precioSinCatalogo: {
    cuando: 'Cuando pregunta precios y el catálogo no está conectado.',
    texto: 'Te paso con una persona del equipo para darte el precio exacto.',
    variables: VARIABLES_COMUNES,
  },
  distritoNoReconocido: {
    cuando: 'Cuando lo que dijo no es un distrito que atendamos.',
    texto: 'No reconozco ese distrito. Escríbeme solo el nombre, por ejemplo: Miraflores, Surco o San Isidro.',
    variables: VARIABLES_COMUNES,
  },
  noEntendi: {
    cuando: 'Cuando la respuesta no encaja con lo que se preguntó. Se repite la pregunta.',
    texto: 'No reconocí ese mensaje, por favor inténtalo de nuevo.',
    variables: VARIABLES_COMUNES,
  },
  soloTexto: {
    cuando: 'Cuando manda un audio, una foto o un sticker y se esperaba una respuesta.',
    texto:
      'Recibí tu mensaje, pero por aquí solo puedo leer texto. ¿Me lo escribes? Si prefieres, responde ASESOR y te atiende una persona.',
    variables: VARIABLES_COMUNES,
  },
  rendicion: {
    cuando: 'Cuando ya se intentó varias veces sin entenderse. Pasa a una persona.',
    texto:
      'Mejor te atiende una persona del equipo, que te va a entender mejor que yo. En un momento te escriben.',
    variables: VARIABLES_COMUNES,
  },
  fueraCobertura: {
    cuando: 'Cuando la ubicación que comparte cae fuera de la zona atendida.',
    texto: 'Esa ubicación queda fuera de nuestra cobertura. Atendemos {cobertura}.',
    variables: VARIABLES_COMUNES,
  },
};

/** Las etiquetas de los tres botones del menu, tambien editables. */
export const OPCIONES: Record<string, string> = {
  botonCotizar: 'Cotizar envío',
  botonInfo: 'Horarios y zona',
  botonAsesor: 'Hablar con asesor',
  botonHoy: 'Hoy',
  botonManana: 'Mañana',
  botonOtroDia: 'Otro día',
};

export type Mensajes = Record<string, string>;

/** Los textos vigentes: lo que guardo la tienda, o el valor de fabrica. */
export function mensajesVigentes(overrides: Mensajes = {}): Mensajes {
  const salida: Mensajes = {};
  for (const [clave, def] of Object.entries(MENSAJES)) {
    salida[clave] = overrides[clave]?.trim() || def.texto;
  }
  for (const [clave, valor] of Object.entries(OPCIONES)) {
    salida[clave] = overrides[clave]?.trim() || valor;
  }
  return salida;
}

export interface Sustituciones {
  saludo: string;
  negocio: string;
  cobertura: string;
  horario: string;
}

/**
 * Sustituye las variables de un mensaje.
 *
 * Lo que no se reconoce se deja tal cual: si alguien escribe `{precio}` en el
 * panel, es mejor que el cliente vea `{precio}` -y se note el error- a que le
 * llegue un hueco en blanco que nadie relaciona con nada.
 */
export function render(texto: string, valores: Sustituciones): string {
  return texto
    .replace(/\{saludo\}/gi, valores.saludo)
    .replace(/\{negocio\}/gi, valores.negocio)
    .replace(/\{cobertura\}/gi, valores.cobertura)
    .replace(/\{horario\}/gi, valores.horario)
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
