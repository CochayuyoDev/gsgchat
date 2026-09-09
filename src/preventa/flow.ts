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

const MENU = [
  { id: BOTON.cotizar, title: 'Cotizar envio' },
  { id: BOTON.info, title: 'Horarios y zona' },
  { id: BOTON.asesor, title: 'Hablar con asesor' },
];

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
export type Campo = 'recojo' | 'entrega' | 'contenido' | 'cuando' | 'nombre' | 'documento' | null;

export function siguienteCampo(lead: Lead): Campo {
  if (!lead.recojoDistrito?.trim()) return 'recojo';
  if (!lead.entregaDistrito?.trim()) return 'entrega';
  if (!lead.contenido?.trim()) return 'contenido';
  if (!lead.cuando?.trim()) return 'cuando';
  if (!lead.nombre?.trim()) return 'nombre';
  if (!lead.documentoNumero?.trim()) return 'documento';
  return null;
}

const PREGUNTAS: Record<Exclude<Campo, null>, (ctx: Contexto) => Respuesta> = {
  recojo: () => ({
    texto: '¿De que distrito recogemos el envio? Puedes escribirlo o mandarme la ubicacion.',
    pedirUbicacion: true,
  }),
  entrega: () => ({
    texto: '¿Y a que distrito lo llevamos?',
  }),
  contenido: () => ({
    texto: '¿Que vas a enviar? Cuentame que es y su tamaño aproximado.',
  }),
  cuando: () => ({
    texto: '¿Para cuando lo necesitas?',
    botones: [
      { id: 'pv_hoy', title: 'Hoy' },
      { id: 'pv_manana', title: 'Manana' },
      { id: 'pv_otro', title: 'Otro dia' },
    ],
  }),
  nombre: () => ({ texto: '¿A nombre de quien registramos el envio?' }),
  documento: () => ({
    texto: 'Por ultimo, tu DNI o RUC para el comprobante. Si prefieres darlo despues, responde NO.',
  }),
};

/** El resumen que cierra la preventa y se pasa al asesor. */
export function resumen(lead: Lead): string {
  const linea = (etiqueta: string, valor: string | null) =>
    valor?.trim() ? `${etiqueta}: ${valor.trim()}` : null;

  return [
    'Esto es lo que tengo:',
    '',
    linea('Recojo', lead.recojoDistrito),
    linea('Entrega', lead.entregaDistrito),
    linea('Envio', lead.contenido),
    linea('Cuando', lead.cuando),
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
        texto:
          campo === 'recojo'
            ? 'Recibi la ubicacion de recojo. ¿De que distrito es?'
            : 'Recibi la ubicacion de entrega. ¿De que distrito es?',
      },
    };
  }

  // --- pedir asesor corta la conversacion en cualquier punto -------------
  if (intencion === BOTON.asesor) {
    return {
      patch: { estado: 'calificado' },
      respuesta: {
        texto: 'Listo, en un momento te atiende una persona del equipo. Gracias por escribir.',
      },
    };
  }

  // --- informacion, sin sacar a nadie de donde estaba --------------------
  if (intencion === BOTON.info) {
    return {
      patch: {},
      respuesta: {
        texto: `Atendemos ${ctx.cobertura}. Horario: ${ctx.horario}.`,
        botones: [
          { id: BOTON.cotizar, title: 'Cotizar envio' },
          { id: BOTON.asesor, title: 'Hablar con asesor' },
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
      respuesta: {
        texto:
          `${ctx.saludo}. Soy el asistente de ${ctx.negocio}. ` +
          `Hacemos envios en ${ctx.cobertura}. ¿En que te ayudo?`,
        botones: MENU,
      },
    };
  }

  // --- cotizar: empieza (o sigue) el cuestionario -----------------------
  if (intencion === BOTON.cotizar) {
    return preguntar(lead, ctx, { estado: 'en_conversacion' });
  }

  const campo = siguienteCampo(lead);

  // Nada que preguntar y la ficha completa: se cierra y pasa a una persona.
  if (!campo) {
    return {
      patch: { estado: 'calificado' },
      respuesta: {
        texto: `${resumen(lead)}\n\nCon esto ya te preparamos la cotizacion. En un momento te escribe una persona del equipo.`,
      },
    };
  }

  // Fuera del cuestionario -alguien que escribe suelto sin haber pedido nada-
  // no se le interroga: se le ofrece el menu una vez.
  if (lead.estado === 'nuevo') {
    return {
      patch: { estado: 'en_conversacion' },
      respuesta: { texto: '¿En que te ayudo?', botones: MENU },
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

  const patch = guardarRespuesta(pendiente, texto, entrada);
  return cerrarOSeguir({ ...lead, ...patch } as Lead, patch, ctx);
}

/** Pregunta el siguiente hueco y deja constancia de que se pregunto. */
function preguntar(lead: Lead, ctx: Contexto, extra: LeadPatch = {}): Resultado {
  const campo = siguienteCampo(lead);
  if (!campo) return cerrarOSeguir(lead, extra, ctx);
  return { patch: { ...extra, preguntaPendiente: campo }, respuesta: PREGUNTAS[campo](ctx) };
}

/** O quedan huecos y se pregunta el siguiente, o esta completa y se cierra. */
function cerrarOSeguir(lead: Lead, patch: LeadPatch, ctx: Contexto): Resultado {
  const despues = siguienteCampo(lead);

  if (!despues) {
    return {
      patch: { ...patch, estado: 'calificado', preguntaPendiente: null },
      respuesta: {
        texto: `${resumen(lead)}\n\nCon esto ya te preparamos la cotizacion. En un momento te escribe una persona del equipo.`,
      },
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
function guardarRespuesta(campo: Exclude<Campo, null>, texto: string, entrada: Entrada): LeadPatch {
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
        pv_manana: 'Manana',
        pv_otro: texto,
      };
      return { cuando: entrada.botonId ? (porBoton[entrada.botonId] ?? texto) : texto };
    }
    case 'nombre':
      return { nombre: texto };
    case 'documento':
      // "No" es una respuesta valida: se marca para no volver a preguntar.
      return { documentoNumero: esNegacion(texto) ? 'no proporcionado' : texto };
  }
}
