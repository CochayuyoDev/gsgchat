/**
 * La conversacion de preventa, como funcion pura.
 *
 * Entra lo que dijo el cliente y la ficha que hay de el; sale que guardar y
 * que contestar. Sin base de datos, sin red y sin reloj propio: asi se puede
 * probar cada camino de la conversacion sin montar nada, que es lo unico que
 * evita que una charla de cinco turnos se rompa en el turno cuatro.
 *
 * Dos reglas que gobiernan todo lo de aqui:
 *
 * 1. **Un mensaje del cliente produce como mucho una respuesta.** Nada de
 *    encadenar dos o tres seguidas: el cliente escribe "hola" y recibe UNA
 *    cosa. Por eso esta funcion devuelve una respuesta, no una lista.
 * 2. **Lo que ya se sabe no se vuelve a preguntar.** El siguiente paso se
 *    deduce de los huecos de la ficha, no de un contador de turnos. Si el
 *    cliente se adelanta y lo dice todo de golpe, la conversacion salta hasta
 *    donde haga falta en vez de repetir preguntas ya contestadas.
 */

import type { Lead, LeadPatch } from '../db/leads.js';
import { mensajesVigentes, render, type Mensajes } from './mensajes.js';

export interface Respuesta {
  texto: string;
  /** Botones de respuesta rapida. WhatsApp pinta tres como mucho. */
  botones?: Array<{ id: string; title: string }>;
  /** Manda el boton nativo de compartir ubicacion en vez de texto suelto. */
  pedirUbicacion?: boolean;
}

export interface Entrada {
  /** Lo que escribio, ya sin espacios de sobra. */
  texto: string;
  /** Id del boton que pulso, si pulso alguno. */
  botonId?: string;
  /** Ubicacion compartida, ya validada contra la cobertura. */
  ubicacion?: { lat: number; lng: number };
  /**
   * Llego algo que no es texto ni ubicacion: un audio, una foto, un sticker.
   *
   * Importa distinguirlo de un texto vacio: a un audio hay que contestarle
   * -el cliente ESTA contestando, solo que en un formato que no se puede
   * leer-, y a un mensaje vacio no.
   */
  adjunto?: boolean;
  /** Su primer mensaje de siempre: solo entonces se presenta la tienda. */
  esPrimerMensaje: boolean;
}

export interface Contexto {
  /** Como se presenta la tienda. */
  negocio: string;
  /** Zona que se atiende, tal cual se le dice al cliente. */
  cobertura: string;
  /** "Buenos dias" y compañia, ya resuelto por hora local. */
  saludo: string;
  /** Horario de atencion, para la pregunta mas repetida que hay. */
  horario: string;
  /**
   * Servicios o couriers entre los que elige el cliente.
   *
   * Vacio = no se pregunta. Lo configura cada tienda; preguntar por algo que
   * no hay que elegir es una pregunta de mas en una conversacion que ya tiene
   * seis.
   */
  servicios?: string[];
  /**
   * Los textos que edita la tienda desde /panel.
   *
   * Lo que no venga aqui cae al valor de fabrica de `mensajes.ts`, asi que una
   * tienda que no toca nada sigue teniendo una conversacion completa.
   */
  mensajes?: Mensajes;
}

export interface Resultado {
  /** Que escribir en la ficha. Vacio si no hay nada que guardar. */
  patch: LeadPatch;
  /** Que contestar. Ausente = no contestar nada, a proposito. */
  respuesta?: Respuesta;
}

/** Los botones del menu. Los ids viajan de ida y vuelta, asi que son fijos. */
export const BOTON = {
  cotizar: 'pv_cotizar',
  info: 'pv_info',
  asesor: 'pv_asesor',
  siNombre: 'pv_confirmar',
  corregir: 'pv_corregir',
} as const;

const normaliza = (texto: string): string =>
  texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Palabras que delatan una intencion aunque no se pulse el boton. */
const INTENCIONES: Array<{ id: string; palabras: string[] }> = [
  { id: BOTON.cotizar, palabras: ['cotiz', 'precio', 'cuanto', 'cuesta', 'tarifa', 'enviar', 'envio', 'delivery'] },
  { id: BOTON.info, palabras: ['horario', 'atienden', 'abren', 'cierran', 'zona', 'cobertura', 'llegan', 'donde'] },
  { id: BOTON.asesor, palabras: ['asesor', 'persona', 'humano', 'hablar con', 'agente', 'ayuda'] },
];

/**
 * Que quiso decir el cliente: el boton que pulso, o lo que se deduce de lo que
 * escribio.
 *
 * Sirve para que quien escribe "cuanto cuesta" llegue al mismo sitio que quien
 * pulsa "Cotizar envio". Obligar a pulsar el boton es lo que hace que la gente
 * abandone.
 */
export function intencionDe(entrada: Entrada, ofrecidas?: string[] | null): string | null {
  if (entrada.botonId) return entrada.botonId;

  const texto = normaliza(entrada.texto);
  if (!texto) return null;

  // "2" a secas: se lee contra lo que se ofrecio en el mensaje anterior. Sin
  // esa memoria habria que adivinarlo por el estado de la conversacion, que es
  // justo como se rompen estas cosas.
  const numero = texto.match(/^([1-9])[.)]?$/);
  if (numero && ofrecidas?.length) {
    const elegida = ofrecidas[Number(numero[1]) - 1];
    if (elegida) return elegida;
  }

  for (const { id, palabras } of INTENCIONES) {
    if (palabras.some((p) => texto.includes(p))) return id;
  }
  return null;
}

/** Un "si" o un "no" sueltos, para las confirmaciones. */
function esNegacion(texto: string): boolean {
  const t = normaliza(texto);
  return t === 'no' || t.startsWith('no ') || t === 'nel' || t === 'nop';
}

/**
 * El siguiente hueco de la ficha, en el orden en que se pregunta.
 *
 * El orden importa: primero lo que decide si hay servicio (de donde a donde),
 * despues lo que decide el precio, y al final los datos personales, que es lo
 * que mas cuesta pedir y no tiene sentido pedir si resulta que no hay
 * cobertura.
 */
export type Campo =
  | 'recojo'
  | 'entrega'
  | 'contenido'
  | 'servicio'
  | 'cuando'
  | 'nombre'
  | 'documento'
  | null;

export function siguienteCampo(lead: Lead, servicios: string[] = []): Campo {
  if (!lead.recojoDistrito?.trim()) return 'recojo';
  if (!lead.entregaDistrito?.trim()) return 'entrega';
  if (!lead.contenido?.trim()) return 'contenido';
  // Solo si la tienda ofrece mas de uno: con uno solo no hay nada que elegir.
  if (servicios.length > 1 && !lead.servicio?.trim()) return 'servicio';
  if (!lead.cuando?.trim()) return 'cuando';
  if (!lead.nombre?.trim()) return 'nombre';
  if (!lead.documentoNumero?.trim()) return 'documento';
  return null;
}

/** El texto de ese mensaje, ya con las variables puestas. */
function mensaje(ctx: Contexto, clave: string): string {
  const vigentes = mensajesVigentes(ctx.mensajes ?? {});
  return render(vigentes[clave] ?? '', {
    saludo: ctx.saludo,
    negocio: ctx.negocio,
    cobertura: ctx.cobertura,
    horario: ctx.horario,
  });
}

/** Las tres opciones del menu, con las etiquetas que puso la tienda. */
function menuDe(ctx: Contexto) {
  return [
    { id: BOTON.cotizar, title: mensaje(ctx, 'botonCotizar') },
    { id: BOTON.info, title: mensaje(ctx, 'botonInfo') },
    { id: BOTON.asesor, title: mensaje(ctx, 'botonAsesor') },
  ];
}

/** Cuantas veces se repite una pregunta antes de pasar a una persona. */
export const MAX_INTENTOS = 2;

/**
 * Si lo que escribio sirve como respuesta a esa pregunta.
 *
 * Se valida poco y a proposito: el objetivo es descartar lo que claramente no
 * es una respuesta -una sola letra, puro signo de puntuacion, un numero donde
 * va un nombre- y no adivinar si "Sta Anita" es un distrito. Pasarse de
 * estricto con clientes reales es peor que guardar algo raro que el operador
 * corrige en la ficha.
 */
export function respuestaValida(campo: Exclude<Campo, null>, texto: string): boolean {
  const limpio = texto.trim();
  if (limpio.length < 2) return false;
  // Solo signos o emojis: no hay nada que guardar ahi.
  if (!/[\p{L}\p{N}]/u.test(limpio)) return false;

  switch (campo) {
    case 'recojo':
    case 'entrega':
      // Un distrito lleva letras. "12345" no es un distrito.
      return /\p{L}{3,}/u.test(limpio);
    case 'nombre':
      return /\p{L}{2,}/u.test(limpio);
    case 'documento':
      // DNI, RUC, carne de extranjeria o pasaporte; o una negativa explicita.
      return esNegacion(limpio) || /[0-9]{6,}/.test(limpio.replace(/[\s.-]/g, ''));
    default:
      return true;
  }
}

const PREGUNTAS: Record<Exclude<Campo, null>, (ctx: Contexto) => Respuesta> = {
  recojo: (ctx) => ({ texto: mensaje(ctx, 'pedirRecojo'), pedirUbicacion: true }),
  entrega: (ctx) => ({ texto: mensaje(ctx, 'pedirEntrega') }),
  contenido: (ctx) => ({ texto: mensaje(ctx, 'pedirContenido') }),
  servicio: (ctx) => ({
    texto: mensaje(ctx, 'pedirServicio'),
    // Tres es el limite de lo que se lee de un vistazo en un chat; si la
    // tienda pone mas, el cliente los ve todos pero numerados igual.
    botones: (ctx.servicios ?? []).map((nombre, i) => ({ id: `pv_serv_${i}`, title: nombre })),
  }),
  cuando: (ctx) => ({
    texto: mensaje(ctx, 'pedirCuando'),
    botones: [
      { id: 'pv_hoy', title: mensaje(ctx, 'botonHoy') },
      { id: 'pv_manana', title: mensaje(ctx, 'botonManana') },
      { id: 'pv_otro', title: mensaje(ctx, 'botonOtroDia') },
    ],
  }),
  nombre: (ctx) => ({ texto: mensaje(ctx, 'pedirNombre') }),
  documento: (ctx) => ({ texto: mensaje(ctx, 'pedirDocumento') }),
};

/**
 * El texto de una pregunta concreta, sin pasar por la conversacion.
 *
 * Lo usa quien necesita repetir la pregunta que estaba en el aire -contestar
 * un precio a mitad y dejar al cliente colgado obliga a adivinar por donde
 * iban- sin volver a escribir los textos en otro sitio.
 */
export function textoDePregunta(campo: string, ctx: Contexto): string {
  const pregunta = PREGUNTAS[campo as Exclude<Campo, null>];
  return pregunta ? pregunta(ctx).texto : '';
}

/** El resumen que cierra la preventa y se pasa al asesor. */
export function resumen(lead: Lead): string {
  const linea = (etiqueta: string, valor: string | null) =>
    valor?.trim() ? `${etiqueta}: ${valor.trim()}` : null;

  return [
    'Esto es lo que tengo:',
    '',
    linea('Recojo', lead.recojoDistrito),
    linea('Entrega', lead.entregaDistrito),
    linea('Envío', lead.contenido),
    linea('Servicio', lead.servicio),
    linea('Cuándo', lead.cuando),
    linea('A nombre de', lead.nombre),
    linea('Documento', lead.documentoNumero),
  ]
    .filter((l) => l !== null)
    .join('\n');
}

/**
 * Un turno de la conversacion.
 *
 * Devuelve `respuesta` ausente cuando NO hay que contestar: es el caso de la
 * ficha ya calificada, donde manda una persona y un robot metiendose en medio
 * solo estorba.
 */
export function responder(lead: Lead, entrada: Entrada, ctx: Contexto): Resultado {
  return conMemoria(decidir(lead, entrada, ctx));
}

function decidir(lead: Lead, entrada: Entrada, ctx: Contexto): Resultado {
  const intencion = intencionDe(entrada, lead.ultimasOpciones);

  // Ya esta en manos de un asesor: el bot se calla. Meterse aqui es lo que
  // hace que el cliente reciba dos respuestas distintas a la misma pregunta.
  if (lead.estado === 'calificado' || lead.estado === 'enviado') {
    return { patch: {} };
  }

  if (lead.estado === 'descartado') return { patch: {} };

  // --- la ubicacion vale como respuesta a "de donde" y "a donde" ---------
  if (entrada.ubicacion) {
    // La ubicacion responde a lo que se pregunto, no al primer hueco: si lo
    // pendiente era la entrega, la ubicacion es la entrega.
    const campo =
      lead.preguntaPendiente === 'entrega' || lead.recojoDistrito?.trim() ? 'entrega' : 'recojo';
    const patch: LeadPatch =
      campo === 'recojo'
        ? {
            recojoLat: entrada.ubicacion.lat,
            recojoLng: entrada.ubicacion.lng,
            estado: 'en_conversacion',
            preguntaPendiente: 'recojo',
          }
        : {
            entregaLat: entrada.ubicacion.lat,
            entregaLng: entrada.ubicacion.lng,
            estado: 'en_conversacion',
            preguntaPendiente: 'entrega',
          };

    // La ubicacion da el punto, no el nombre del distrito: se pide igual, pero
    // diciendo que ya se recibio para que no parezca que se ignoro.
    return {
      patch,
      respuesta: {
        texto: mensaje(ctx, campo === 'recojo' ? 'ubicacionRecojo' : 'ubicacionEntrega'),
      },
    };
  }

  // --- audio, foto o sticker cuando se esperaba una respuesta -----------
  //
  // El cliente ESTA contestando, solo que en un formato que no se puede leer.
  // Callarse aqui es lo que hace que crea que nadie le lee.
  if (entrada.adjunto && lead.preguntaPendiente) {
    return conIntento(lead, ctx, mensaje(ctx, 'soloTexto'));
  }

  // --- pedir asesor corta la conversacion en cualquier punto -------------
  if (intencion === BOTON.asesor) {
    return {
      patch: { estado: 'calificado' },
      respuesta: { texto: mensaje(ctx, 'asesor') },
    };
  }

  // --- informacion, sin sacar a nadie de donde estaba --------------------
  if (intencion === BOTON.info) {
    return {
      patch: {},
      respuesta: {
        texto: mensaje(ctx, 'info'),
        botones: [
          { id: BOTON.cotizar, title: mensaje(ctx, 'botonCotizar') },
          { id: BOTON.asesor, title: mensaje(ctx, 'botonAsesor') },
        ],
      },
    };
  }

  // --- primer mensaje: presentarse, y nada mas --------------------------
  //
  // Sin preguntas encima de la presentacion: al cliente le llega UNA cosa, y
  // decide el desde el menu. Encadenar el saludo y la primera pregunta es lo
  // que hace que parezca un formulario.
  if (entrada.esPrimerMensaje && lead.estado === 'nuevo' && !intencion) {
    return {
      patch: { estado: 'en_conversacion' },
      respuesta: { texto: mensaje(ctx, 'bienvenida'), botones: menuDe(ctx) },
    };
  }

  // --- cotizar: empieza (o sigue) el cuestionario -----------------------
  if (intencion === BOTON.cotizar) {
    return preguntar(lead, ctx, { estado: 'en_conversacion' });
  }

  const campo = siguienteCampo(lead, ctx.servicios);

  // Nada que preguntar y la ficha completa: se cierra y pasa a una persona.
  if (!campo) {
    return {
      patch: { estado: 'calificado' },
      respuesta: { texto: `${resumen(lead)}\n\n${mensaje(ctx, 'cierre')}` },
    };
  }

  // Fuera del cuestionario -alguien que escribe suelto sin haber pedido nada-
  // no se le interroga: se le ofrece el menu una vez.
  if (lead.estado === 'nuevo') {
    return {
      patch: { estado: 'en_conversacion' },
      respuesta: { texto: mensaje(ctx, 'menu'), botones: menuDe(ctx) },
    };
  }

  const texto = entrada.texto.trim();
  if (!texto) return { patch: {} };

  // Solo se consume lo que escribio si HABIA una pregunta esperandolo.
  //
  // Es la diferencia entre "estoy esperando tu distrito" y "todavia no te lo
  // he preguntado", y sin ella el "1" con el que elige del menu acaba guardado
  // como distrito de recojo, y toda la conversacion se corre un paso.
  const pendiente = lead.preguntaPendiente as Exclude<Campo, null> | null;
  if (!pendiente || pendiente !== campo) {
    return preguntar(lead, ctx, { estado: 'en_conversacion' });
  }

  // Si el "1" que escribio corresponde a una de las opciones que se le
  // ofrecieron, vale como si hubiera pulsado ese boton. Sin esto la ficha
  // acaba diciendo 'Cuando: 1', que no significa nada para quien la lea.
  const elegida = intencion && lead.ultimasOpciones?.includes(intencion) ? intencion : undefined;
  // Lo que no sirve como respuesta no se guarda: una ficha con "?" en el
  // distrito es peor que una ficha con el hueco vacio, porque parece rellenada.
  if (!elegida && !respuestaValida(pendiente, texto)) {
    return conIntento(lead, ctx, mensaje(ctx, 'noEntendi'));
  }

  const patch = guardarRespuesta(pendiente, texto, { ...entrada, botonId: entrada.botonId ?? elegida }, ctx.servicios);
  return cerrarOSeguir({ ...lead, ...patch } as Lead, { ...patch, intentosFallidos: 0 }, ctx);
}

/**
 * Un intento fallido: se avisa y se repite la pregunta.
 *
 * A la tercera se deja de insistir y pasa a una persona. Repetir la misma
 * pregunta indefinidamente es lo que hace que el cliente cierre el chat, y un
 * cliente perdido cuesta mas que una ficha a medias.
 */
function conIntento(lead: Lead, ctx: Contexto, aviso: string): Resultado {
  const intentos = (lead.intentosFallidos ?? 0) + 1;

  if (intentos > MAX_INTENTOS) {
    return {
      patch: { estado: 'calificado', preguntaPendiente: null, intentosFallidos: 0 },
      respuesta: { texto: mensaje(ctx, 'rendicion') },
    };
  }

  const campo = siguienteCampo(lead, ctx.servicios);
  const pregunta = campo ? PREGUNTAS[campo](ctx) : { texto: mensaje(ctx, 'menu'), botones: menuDe(ctx) };

  return {
    patch: { intentosFallidos: intentos, ...(campo ? { preguntaPendiente: campo } : {}) },
    // Aviso y pregunta en el MISMO mensaje: dos seguidos serian dos mensajes
    // por un solo entrante, que es justo lo que no puede pasar.
    respuesta: { ...pregunta, texto: `${aviso}\n\n${pregunta.texto}` },
  };
}

/** Pregunta el siguiente hueco y deja constancia de que se pregunto. */
function preguntar(lead: Lead, ctx: Contexto, extra: LeadPatch = {}): Resultado {
  const campo = siguienteCampo(lead, ctx.servicios);
  if (!campo) return cerrarOSeguir(lead, extra, ctx);
  return { patch: { ...extra, preguntaPendiente: campo }, respuesta: PREGUNTAS[campo](ctx) };
}

/** O quedan huecos y se pregunta el siguiente, o esta completa y se cierra. */
function cerrarOSeguir(lead: Lead, patch: LeadPatch, ctx: Contexto): Resultado {
  const despues = siguienteCampo(lead, ctx.servicios);

  if (!despues) {
    return {
      patch: { ...patch, estado: 'calificado', preguntaPendiente: null },
      respuesta: { texto: `${resumen(lead)}\n\n${mensaje(ctx, 'cierre')}` },
    };
  }

  return { patch: { ...patch, preguntaPendiente: despues }, respuesta: PREGUNTAS[despues](ctx) };
}

/**
 * Deja anotado en el patch que opciones se ofrecieron.
 *
 * Va en un solo sitio, a la salida, para que no se pueda mandar una lista
 * numerada sin recordar que significaba cada numero.
 */
function conMemoria(resultado: Resultado): Resultado {
  const ids = resultado.respuesta?.botones?.map((b) => b.id) ?? null;
  return { ...resultado, patch: { ...resultado.patch, ultimasOpciones: ids } };
}

/** Donde va lo que acaba de escribir el cliente. */
function guardarRespuesta(
  campo: Exclude<Campo, null>,
  texto: string,
  entrada: Entrada,
  servicios: string[] = [],
): LeadPatch {
  switch (campo) {
    case 'recojo':
      return { recojoDistrito: texto, estado: 'en_conversacion' };
    case 'entrega':
      return { entregaDistrito: texto, estado: 'en_conversacion' };
    case 'contenido':
      return { contenido: texto, estado: 'en_conversacion' };
    case 'cuando': {
      // Los botones de "cuando" traen su propio texto; si pulso uno, vale ese.
      const porBoton: Record<string, string> = {
        pv_hoy: 'Hoy',
        pv_manana: 'Mañana',
        pv_otro: texto,
      };
      return { cuando: entrada.botonId ? (porBoton[entrada.botonId] ?? texto) : texto };
    }
    case 'servicio': {
      // Si eligio por numero, vale el nombre del servicio, no el "2".
      const indice = entrada.botonId?.match(/^pv_serv_(\d+)$/);
      const elegido = indice ? servicios[Number(indice[1])] : undefined;
      return { servicio: elegido ?? texto };
    }
    case 'nombre':
      return { nombre: texto };
    case 'documento':
      // "No" es una respuesta valida: se marca para no volver a preguntar.
      return { documentoNumero: esNegacion(texto) ? 'no proporcionado' : texto };
  }
}
