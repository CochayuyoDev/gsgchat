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
import { reconocerDistrito } from './distritos.js';
import { esSaludo, pareceTextoReal } from './palabras.js';
import { extraerDeMensaje } from './extraer.js';

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
   * Los distritos que se aceptan como destino.
   *
   * Vacio = texto libre, que es lo que corresponde a una tienda que no opera
   * en Lima. Con lista, lo que no se parezca a ninguno se rechaza: es la
   * unica forma de cazar un "No viejo" contestado a "¿de que distrito?", que
   * son dos palabras normales y ninguna validacion generica detecta.
   */
  distritos?: string[];
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
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');

/** Palabras que delatan una intencion aunque no se pulse el boton. */
const INTENCIONES: Array<{ id: string; palabras: string[] }> = [
  {
    id: BOTON.cotizar,
    palabras: [
      'cotiz', 'precio', 'cuanto', 'cuesta', 'tarifa', 'delivery',
      // Raices y no palabras enteras: "manden" no contiene "mandar" ni
      // "manda", y "quiero que me lo manden a Miraflores" -que es como habla
      // la gente- acababa contestado con "ese producto no esta disponible".
      'mand', 'envi', 'llev', 'recoj', 'recog', 'despach', 'traslad',
      'encomienda', 'movilidad', 'reparto', 'repartir',
    ],
  },
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


/**
 * Cual de las tres respuestas de informacion toca.
 *
 * Quien pregunta por el horario quiere leer la hora, no la cobertura; quien
 * pregunta hasta donde llegan quiere leer la zona. Si pulso el boton (no hay
 * texto que leer) o pregunto por las dos cosas a la vez, va la respuesta
 * combinada de siempre.
 */
export function claveDeInfo(entrada: Entrada): 'info' | 'infoHorario' | 'infoZona' {
  const texto = normaliza(entrada.texto ?? '');
  if (!texto) return 'info';

  const horario = ['horario', 'hora', 'atienden', 'atiende', 'abren', 'abre', 'cierran', 'cierra'];
  const zona = ['zona', 'cobertura', 'cubren', 'llegan', 'llega', 'distrito', 'donde'];

  const preguntaHorario = horario.some((p) => texto.includes(p));
  const preguntaZona = zona.some((p) => texto.includes(p));

  // Las dos, o ninguna reconocible: la combinada responde a ambas.
  if (preguntaHorario === preguntaZona) return 'info';

  return preguntaHorario ? 'infoHorario' : 'infoZona';
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
/**
 * Cortesias y muletillas: se entienden perfectamente, pero no contestan nada.
 *
 * Sin esta lista, un "gracias" a "¿de que distrito recogemos?" queda guardado
 * como el distrito. Es peor que un "???" porque nadie lo revisa: la ficha
 * parece rellenada.
 */
const CORTESIA = new Set([
  'hola', 'holi', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches',
  'gracias', 'muchas gracias', 'ok', 'oka', 'okey', 'okay', 'listo', 'ya',
  'perfecto', 'bien', 'de acuerdo', 'entiendo', 'ah', 'aja', 'mmm', 'si',
  'claro', 'por favor', 'disculpa', 'perdon', 'buen dia',
]);

/**
 * Si lo que escribio es una pregunta.
 *
 * A una pregunta no se le guarda como respuesta: quien pregunta esta pidiendo
 * algo, no contestando. Se detecta por el signo y por las palabras con las que
 * empieza una pregunta en español, que es lo que sobrevive a que nadie escriba
 * el signo de apertura.
 */
export function esPregunta(texto: string): boolean {
  const t = normaliza(texto);
  if (t.includes('?')) return true;
  return /^(que|cual|cuales|cuando|donde|como|cuanto|cuanta|quien|por que|porque|se puede|puedo|tienen|tienes|hay)\b/.test(t);
}

/**
 * Tramos de teclado seguidos. Nadie escribe "asdf" queriendo decir algo.
 */
const TECLADO = ['qwert', 'werty', 'asdf', 'sdfg', 'dfgh', 'zxcv', 'xcvb', 'hjkl', 'poiu', 'lkjh'];

/**
 * Si lo que escribió parece tecleado al azar.
 *
 * Dos señales, las dos baratas y sin falsos positivos en español:
 *
 *  - un tramo de teclado seguido ("asdfgh", "qwerty");
 *  - cuatro consonantes seguidas dentro de una misma palabra, que en español
 *    no ocurre (lo más largo son grupos de tres, y a caballo de dos sílabas).
 *
 * Se comprueba porque un "asdfgh" guardado como distrito de entrega es peor
 * que un hueco vacío: nadie lo revisa, y el reparto sale hacia un sitio que
 * no existe.
 */
export function pareceTecleoAlAzar(texto: string): boolean {
  const limpio = normaliza(texto).replace(/[^a-z\s]/g, '');
  if (!limpio) return false;

  for (const palabra of limpio.split(' ').filter((p) => p.length >= 4)) {
    if (TECLADO.some((tramo) => palabra.includes(tramo))) return true;
    if (/[bcdfghjklmnpqrstvwxyz]{4,}/.test(palabra)) return true;
  }

  return false;
}

/**
 * Si el texto dice CUANDO, de alguna forma que se pueda programar.
 *
 * "Da ternura" o "si mno" no son un momento. Un momento es hoy, manana, un
 * dia de la semana, una fecha, una hora, una parte del dia, "ahora" o "cuanto
 * antes". Cualquier otra cosa se rechaza y se vuelve a preguntar, porque una
 * ficha con "Cuando: Da ternura" sale a reparto sin que nadie la mire.
 */
export function pareceMomento(texto: string): boolean {
  const t = normaliza(texto);
  if (!t) return false;
  const patrones = [
    /\b(hoy|manana|pasado manana|ahora|ahorita|ya mismo|cuanto antes|lo antes posible|urgente)\b/,
    /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/,
    /\b(esta|la proxima|la siguiente|proxima|siguiente) (semana|tarde|manana|noche)\b/,
    /\b(en la|por la|a la|de) (manana|tarde|noche|madrugada|mediodia)\b/,
    /\b(fin de semana|finde|feriado)\b/,
    /\b\d{1,2}[\/-]\d{1,2}([\/-]\d{2,4})?\b/,
    /\b\d{1,2} de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|setiembre|septiembre|octubre|noviembre|diciembre)\b/,
    /\b(a las?|desde las?|hasta las?|tipo|como a las?) \d{1,2}(:\d{2})?\b/,
    /\b\d{1,2}(:\d{2})? ?(am|pm|hrs|h)\b/,
    /\b(en|dentro de) \d+ (minutos?|horas?|dias?)\b/,
  ];
  return patrones.some((re) => re.test(t));
}

/**
 * Si el texto puede ser un documento de identidad.
 *
 * En Peru un DNI tiene 8 digitos, un carne de extranjeria 9 y un RUC 11; un
 * pasaporte mezcla letras y numeros. "1234567" (siete) no es ninguno de
 * ellos, y un documento mal apuntado es una entrega que no se puede hacer.
 */
export function pareceDocumento(texto: string): boolean {
  const compacto = texto.replace(/[\s.-]/g, '').toUpperCase();
  if (/^\d{8,11}$/.test(compacto)) return true;
  return /^[A-Z0-9]{6,12}$/.test(compacto) && /[A-Z]/.test(compacto) && /\d/.test(compacto);
}

export function respuestaValida(campo: Exclude<Campo, null>, texto: string): boolean {
  const limpio = texto.trim();
  if (limpio.length < 2) return false;
  // Solo signos o emojis: no hay nada que guardar ahi.
  if (!/[\p{L}\p{N}]/u.test(limpio)) return false;

  const normalizado = normaliza(limpio);

  // "No" al documento significa "luego te lo doy", y es una respuesta
  // legitima: se acepta antes que cualquier otra regla, o las de longitud la
  // tumban por corta.
  if (campo === 'documento' && esNegacion(normalizado)) return true;

  // Una cortesia no contesta nada. "Ya" y "listo" incluidos: el cliente esta
  // acusando recibo, no diciendo su distrito.
  if (CORTESIA.has(normalizado)) return false;

  // Y hace falta AL MENOS una palabra de verdad. "Ya xd" son dos palabras y
  // ninguna dice nada: quedaba guardado como el contenido del envio.
  const conSustancia = normalizado
    .split(' ')
    .filter((p) => p.length >= 3 && !CORTESIA.has(p));
  if (!conSustancia.length) return false;

  // Y que esas palabras PUEDAN existir. No es un diccionario -rechazaria
  // "iPhone 15" y media tienda- sino la forma de la palabra, que es lo que
  // separa "documentos" de "asdasd" sin conocer ninguna de las dos.
  if (!pareceTextoReal(conSustancia.join(' '))) return false;

  // Una pregunta tampoco. La excepcion es "que vas a enviar": ahi el cliente
  // puede describir su envio con una pregunta ("un paquete, se puede?") y
  // rechazarlo seria pedantear.
  // Y "cuanto antes" empieza como una pregunta pero es un momento.
  if (campo !== 'contenido' && !(campo === 'cuando' && pareceMomento(limpio)) && esPregunta(limpio)) return false;

  // Y lo tecleado al azar no vale para nada, ni siquiera para describir un
  // envio: "asdfgh" no es una caja de documentos.
  if (pareceTecleoAlAzar(limpio)) return false;

  switch (campo) {
    case 'recojo':
    case 'entrega':
      // Un distrito lleva letras. "12345" no es un distrito. Que ADEMAS sea
      // un distrito de verdad lo comprueba `decidir`, que es quien tiene la
      // lista; aqui no llega.
      return /\p{L}{3,}/u.test(limpio);
    case 'nombre':
      return /\p{L}{2,}/u.test(limpio);
    case 'documento':
      // DNI, RUC, carne de extranjeria o pasaporte; o una negativa explicita.
      return esNegacion(limpio) || pareceDocumento(limpio);
    case 'cuando':
      // Un momento que se pueda programar, no una frase cualquiera.
      return pareceMomento(limpio);
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

  // Lo que el cliente ya dijo en su mensaje se guarda antes de preguntar
  // nada: "de Surco a Miraflores hoy" trae origen, destino y fecha, y
  // pedirle que empiece por el principio es hacerle repetir lo que ya dijo.
  const deducido = extraerDeMensaje(entrada.texto, lead, ctx.distritos);
  const conocido = Object.keys(deducido).length ? ({ ...lead, ...deducido } as Lead) : lead;

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
  //
  // Responder lo que se PREGUNTO, y primero. Una sola respuesta servia para
  // "¿que horario tienen?" y para "¿hasta donde llegan?", asi que a quien
  // preguntaba por el horario se le contestaba empezando por la cobertura y
  // con la hora de propina; con el menu pegado debajo, se lee como un folleto
  // que no escucho la pregunta —lo dijo el dueño mirando una conversacion—.
  if (intencion === BOTON.info) {
    return {
      patch: {},
      respuesta: {
        texto: mensaje(ctx, claveDeInfo(entrada)),
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
    return preguntar(conocido, ctx, { ...deducido, estado: 'en_conversacion' });
  }

  const campo = siguienteCampo(conocido, ctx.servicios);

  // Nada que preguntar y la ficha completa: se cierra y pasa a una persona.
  if (!campo) {
    return {
      patch: { estado: 'calificado' },
      respuesta: { texto: `${resumen(lead)}\n\n${mensaje(ctx, 'cierre')}` },
    };
  }

  // --- saluda otra vez ---------------------------------------------------
  //
  // Un "hola buenas" no es un mensaje incomprensible. Sin esto, la segunda vez
  // que alguien saluda se lleva un "no reconocí ese mensaje", que es la clase
  // de respuesta por la que un cliente deja de escribir.
  if (!intencion && !lead.preguntaPendiente && esSaludo(entrada.texto)) {
    return {
      patch: { estado: 'en_conversacion' },
      respuesta: { texto: mensaje(ctx, 'saludoDeVuelta'), botones: menuDe(ctx) },
    };
  }
  // Si el mensaje traia datos, la conversacion ya empezo: seguir preguntando
  // por donde toca es mejor que ofrecerle un menu que ya no necesita.
  if (Object.keys(deducido).length) {
    return preguntar(conocido, ctx, { ...deducido, estado: 'en_conversacion' });
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
  // Un saludo a mitad del cuestionario no es una respuesta ni un fallo: se le
  // vuelve a hacer la pregunta y no se le gasta un intento. Sin esto, quien
  // saluda cuando se le pregunta el nombre queda registrado como "Hola".
  if (!elegida && esSaludo(texto)) {
    return preguntar(lead, ctx, {});
  }

  // Lo que no sirve como respuesta no se guarda: una ficha con "?" en el
  // distrito es peor que una ficha con el hueco vacio, porque parece rellenada.
  if (!elegida && !respuestaValida(pendiente, texto)) {
    return conIntento(lead, ctx, mensaje(ctx, 'noEntendi'));
  }

  // El distrito se comprueba contra la lista de la tienda: "No viejo" son dos
  // palabras normales y ninguna validacion generica lo caza, pero no es un
  // distrito. Se guarda ademas el nombre canonico, para que la ficha se pueda
  // filtrar y contar despues.
  let reconocido: string | null = null;
  if (pendiente === 'recojo' || pendiente === 'entrega') {
    reconocido = reconocerDistrito(texto, ctx.distritos);
    if (!reconocido) return conIntento(lead, ctx, mensaje(ctx, 'distritoNoReconocido'));
  }

  const patch = guardarRespuesta(
    pendiente,
    texto,
    { ...entrada, botonId: entrada.botonId ?? elegida },
    ctx.servicios,
    { reconocido },
  );
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
  distritos: { reconocido?: string | null } = {},
): LeadPatch {
  switch (campo) {
    case 'recojo':
      return { recojoDistrito: distritos.reconocido ?? texto, estado: 'en_conversacion' };
    case 'entrega':
      return { entregaDistrito: distritos.reconocido ?? texto, estado: 'en_conversacion' };
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
