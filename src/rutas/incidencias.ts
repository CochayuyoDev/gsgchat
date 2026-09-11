/**
 * El catalogo de lo que puede salir mal, con nombre y apellido.
 *
 * "No se pudo contactar" no sirve para nada: quien tiene que arreglarlo
 * necesita saber si el numero venia con ocho digitos, si existe pero no tiene
 * WhatsApp, o si contesto una persona que no es el cliente. Cada caso lleva
 * un codigo estable -que es lo que viaja a GSG-, un titulo para la pantalla y
 * que hacer con el.
 *
 * Los codigos NO se traducen ni se renombran: un informe de hace tres meses
 * tiene que seguir queriendo decir lo mismo.
 */

export type CodigoIncidencia =
  | 'numero_corto'
  | 'numero_largo'
  | 'numero_invalido'
  | 'numero_fijo'
  | 'sin_whatsapp'
  | 'numero_equivocado'
  | 'sin_respuesta'
  | 'respondio_sin_ubicacion'
  | 'ubicacion_fuera_de_zona'
  | 'rechaza_contacto'
  | 'envio_bloqueado'
  | 'error_envio';

export interface Incidencia {
  codigo: CodigoIncidencia;
  /** Como se llama en la pantalla. */
  titulo: string;
  /** Que paso, dicho para quien no ve el sistema por dentro. */
  explicacion: string;
  /** El siguiente paso, concreto. */
  queHacer: string;
  /** Si no hay nada que el bot pueda intentar ya. */
  requiereHumano: boolean;
  /** Si tiene sentido volver a intentarlo solo (mas tarde, otro dia). */
  reintentable: boolean;
  /** Si se reporta al sistema de GSG. */
  reportable: boolean;
}

export const INCIDENCIAS: Record<CodigoIncidencia, Incidencia> = {
  numero_corto: {
    codigo: 'numero_corto',
    titulo: 'Número incompleto',
    explicacion: 'El número tiene menos dígitos de los que necesita un celular. Casi siempre falta uno al copiarlo.',
    queHacer: 'Corregir el número en la ficha del cliente y volver a intentarlo.',
    requiereHumano: true,
    reintentable: false,
    reportable: true,
  },
  numero_largo: {
    codigo: 'numero_largo',
    titulo: 'Número con dígitos de más',
    explicacion: 'El número trae más dígitos de los que existen. Suele ser un pegado doble o un prefijo repetido.',
    queHacer: 'Corregir el número en la ficha del cliente y volver a intentarlo.',
    requiereHumano: true,
    reintentable: false,
    reportable: true,
  },
  numero_invalido: {
    codigo: 'numero_invalido',
    titulo: 'Número que no se puede marcar',
    explicacion: 'Lo que vino en el campo del teléfono no es un número marcable: letras, guiones sueltos o un campo vacío.',
    queHacer: 'Pedir el teléfono correcto a quien tomó el pedido.',
    requiereHumano: true,
    reintentable: false,
    reportable: true,
  },
  numero_fijo: {
    codigo: 'numero_fijo',
    titulo: 'Es un teléfono fijo',
    explicacion: 'El número es de red fija, y por WhatsApp no se le puede escribir.',
    queHacer: 'Conseguir un celular del cliente, o llamarlo por teléfono.',
    requiereHumano: true,
    reintentable: false,
    reportable: true,
  },
  sin_whatsapp: {
    codigo: 'sin_whatsapp',
    titulo: 'El número no tiene WhatsApp',
    explicacion: 'El número existe y está bien escrito, pero no hay una cuenta de WhatsApp detrás.',
    queHacer: 'El motorizado lo llama por teléfono; no hay nada que mandar por aquí.',
    requiereHumano: true,
    reintentable: false,
    reportable: true,
  },
  numero_equivocado: {
    codigo: 'numero_equivocado',
    titulo: 'Contestó alguien que no es el cliente',
    explicacion: 'Quien respondió dice que no es esa persona o que no espera ningún envío. El número está mal en el pedido.',
    queHacer: 'Avisar a GSG para que corrija el contacto del pedido. No insistir a este número.',
    requiereHumano: true,
    reintentable: false,
    reportable: true,
  },
  sin_respuesta: {
    codigo: 'sin_respuesta',
    titulo: 'No contestó',
    explicacion: 'Se le escribió las veces acordadas y no respondió nada.',
    queHacer: 'Lo llama el motorizado antes de salir a la zona.',
    requiereHumano: true,
    reintentable: true,
    reportable: true,
  },
  respondio_sin_ubicacion: {
    codigo: 'respondio_sin_ubicacion',
    titulo: 'Contestó, pero no mandó la ubicación',
    explicacion: 'El cliente está al otro lado y responde, pero lo que manda no es un pin ni un enlace de mapa.',
    queHacer: 'Revisar qué contestó: a veces es una dirección escrita que sirve igual, y a veces hay que llamarlo.',
    requiereHumano: true,
    reintentable: true,
    reportable: true,
  },
  ubicacion_fuera_de_zona: {
    codigo: 'ubicacion_fuera_de_zona',
    titulo: 'La ubicación cae fuera de la zona',
    explicacion: 'El pin llegó bien, pero apunta fuera de la cobertura configurada.',
    queHacer: 'Confirmar con el cliente la dirección, o pasar el pedido a quien cubra esa zona.',
    requiereHumano: true,
    reintentable: false,
    reportable: true,
  },
  rechaza_contacto: {
    codigo: 'rechaza_contacto',
    titulo: 'Pidió que no le escriban',
    explicacion: 'El cliente se dio de baja. Volver a escribirle es lo que hace que reporten el número.',
    queHacer: 'Coordinar la entrega por teléfono. Este número no recibe más mensajes.',
    requiereHumano: true,
    reintentable: false,
    reportable: true,
  },
  envio_bloqueado: {
    codigo: 'envio_bloqueado',
    titulo: 'El sistema no dejó enviar',
    explicacion: 'Una guarda propia paró el envío: cupo del día, calentamiento del número, ventana de 24 h o falta de consentimiento.',
    queHacer: 'Se reintenta solo cuando la guarda deje de aplicar. Si se repite, revisar el cupo diario.',
    requiereHumano: false,
    reintentable: true,
    reportable: false,
  },
  error_envio: {
    codigo: 'error_envio',
    titulo: 'WhatsApp rechazó el mensaje',
    explicacion: 'El envío salió hacia WhatsApp y volvió con error.',
    queHacer: 'Se reintenta solo. Si insiste, mirar el detalle: suele ser la plantilla o el número.',
    requiereHumano: false,
    reintentable: true,
    reportable: true,
  },
};

export const CODIGOS = Object.keys(INCIDENCIAS) as CodigoIncidencia[];

export function esCodigoIncidencia(valor: string): valor is CodigoIncidencia {
  return valor in INCIDENCIAS;
}

/** El texto que se ensena y se reporta: titulo + detalle concreto del caso. */
export function describirIncidencia(codigo: CodigoIncidencia, detalle?: string | null): string {
  const incidencia = INCIDENCIAS[codigo];
  return detalle?.trim() ? `${incidencia.titulo}: ${detalle.trim()}` : incidencia.titulo;
}

/**
 * Traduce el error de WhatsApp a una incidencia nuestra.
 *
 * Los codigos son de la Cloud API de Meta; los clientes no oficiales devuelven
 * texto, asi que tambien se mira lo que dice. 131026 y 131052 son las dos
 * formas en que Meta dice "ese numero no recibe WhatsApp", y confundirlas con
 * un error generico es lo que hace que el sistema insista contra un numero que
 * nunca va a contestar.
 */
export function incidenciaDeErrorDeEnvio(error: string, codigo?: string | number | null): CodigoIncidencia {
  const texto = `${codigo ?? ''} ${error}`.toLowerCase();
  if (/131026|131052|not.*whatsapp|no.*tiene.*whatsapp|undeliverable|not_on_whatsapp/.test(texto)) {
    return 'sin_whatsapp';
  }
  if (/131047|24.*hora|ventana|re-?engagement/.test(texto)) return 'envio_bloqueado';
  if (/invalid.*(phone|wa_id)|131021|numero.*invalido/.test(texto)) return 'numero_invalido';
  return 'error_envio';
}
