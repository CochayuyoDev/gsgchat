/**
 * Los errores de validacion, en cristiano y en espanol.
 *
 * Zod trae sus mensajes en ingles ("Required", "Expected string, received
 * number", "String must contain at least 6 character(s)"). Esos textos NO se
 * quedan dentro: el servidor los devuelve en el `error` de la respuesta y la
 * pantalla los ensena tal cual, asi que quien usa el sistema acaba leyendo
 * ingles tecnico para enterarse de que se dejo un campo vacio.
 *
 * Aqui se traducen una sola vez, para todo el proceso.
 */

import { z } from 'zod';

/** Como se llama cada tipo de dato de cara a quien lee el mensaje. */
const TIPOS: Record<string, string> = {
  string: 'texto',
  number: 'un número',
  boolean: 'sí o no',
  date: 'una fecha',
  array: 'una lista',
  object: 'un grupo de datos',
  null: 'vacío',
  undefined: 'vacío',
  integer: 'un número entero',
};

const tipo = (nombre: string): string => TIPOS[nombre] ?? nombre;

/** Plural correcto sin el "(s)" de Zod. */
const unidades = (n: number, singular: string, plural: string): string =>
  `${n} ${n === 1 ? singular : plural}`;

export const mensajesEnEspanol: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') {
        return { message: 'falta este dato' };
      }
      return { message: `se esperaba ${tipo(String(issue.expected))} y llegó ${tipo(String(issue.received))}` };

    case z.ZodIssueCode.invalid_enum_value:
      return {
        message: `valor no admitido: se aceptan ${issue.options.map((o) => `"${String(o)}"`).join(', ')}`,
      };

    case z.ZodIssueCode.unrecognized_keys:
      return { message: `hay campos que sobran: ${issue.keys.join(', ')}` };

    case z.ZodIssueCode.too_small: {
      const minimo = Number(issue.minimum);
      if (issue.type === 'string') {
        return minimo <= 1
          ? { message: 'no puede ir vacío' }
          : { message: `necesita al menos ${unidades(minimo, 'carácter', 'caracteres')}` };
      }
      if (issue.type === 'array') {
        return minimo <= 1
          ? { message: 'la lista no puede ir vacía' }
          : { message: `la lista necesita al menos ${unidades(minimo, 'elemento', 'elementos')}` };
      }
      return { message: `tiene que ser ${issue.inclusive ? 'como mínimo' : 'mayor que'} ${minimo}` };
    }

    case z.ZodIssueCode.too_big: {
      const maximo = Number(issue.maximum);
      if (issue.type === 'string') {
        return { message: `no puede pasar de ${unidades(maximo, 'carácter', 'caracteres')}` };
      }
      if (issue.type === 'array') {
        return { message: `la lista no puede pasar de ${unidades(maximo, 'elemento', 'elementos')}` };
      }
      return { message: `tiene que ser ${issue.inclusive ? 'como máximo' : 'menor que'} ${maximo}` };
    }

    case z.ZodIssueCode.invalid_string: {
      if (issue.validation === 'url') return { message: 'tiene que ser una dirección web completa (https://...)' };
      if (issue.validation === 'email') return { message: 'tiene que ser un correo válido' };
      if (issue.validation === 'uuid') return { message: 'tiene que ser un identificador válido' };
      return { message: 'el formato no es el esperado' };
    }

    case z.ZodIssueCode.not_multiple_of:
      return { message: `tiene que ser múltiplo de ${String(issue.multipleOf)}` };

    case z.ZodIssueCode.invalid_date:
      return { message: 'la fecha no es válida' };

    default:
      // Los mensajes escritos a mano en los esquemas ya estan en espanol y
      // llegan por aqui: se respetan tal cual.
      return { message: ctx.defaultError };
  }
};

/**
 * Como se llama cada campo de cara a quien lee el error. La clave es el
 * nombre del campo tal como viaja en el JSON (`margenMinutos`) o la ruta
 * entera con puntos (`horario.inicio`); la ruta entera manda sobre el nombre
 * suelto. Lo que no esta aqui se "deshace" del camelCase (`pausaMinSeg` ->
 * "pausa min seg"), que sigue siendo mejor que la clave pelada.
 */
export const NOMBRES_DE_CAMPO: Record<string, string> = {
  // Ajustes generales
  nombreNegocio: 'el nombre del negocio',
  horario: 'el horario de envío',
  'horario.inicio': 'la hora de inicio del horario',
  'horario.fin': 'la hora de fin del horario',
  'horario.dias': 'los días del horario',
  ritmo: 'el ritmo de envío',
  'ritmo.maxPorMinuto': 'el máximo de mensajes por minuto',
  'ritmo.maxPorHora': 'el máximo de mensajes por hora',
  'ritmo.maxPorContactoDia': 'el máximo de mensajes por contacto al día',
  'ritmo.separacionContactoMin': 'los minutos de separación entre mensajes a un mismo contacto',
  'ritmo.pausaMinSeg': 'la pausa mínima entre mensajes (segundos)',
  'ritmo.pausaMaxSeg': 'la pausa máxima entre mensajes (segundos)',
  'ritmo.nuevosContactosPorDia': 'los contactos nuevos por día',
  modoPrueba: 'el modo prueba',
  'modoPrueba.activo': 'si el modo prueba está activo',
  'modoPrueba.numeros': 'los números del modo prueba',
  avisos: 'los avisos',
  'avisos.supervisor': 'el WhatsApp del supervisor',
  autoPausa: 'la pausa automática',
  humanizar: 'la escritura simulada',
  modo: 'qué se enseña (solo GSG o todo el sistema)',
  guardados: 'las conversaciones guardadas',
  'guardados.inactividadDias': 'los días sin movimiento para guardar una conversación',
  resumenes: 'el resumen del día',
  'resumenes.activo': 'si el resumen del día está encendido',
  'resumenes.horaManana': 'la hora del resumen de la mañana',
  'resumenes.horaTarde': 'la hora del resumen de la tarde',
  pedirVerUnaVezNormal: 'pedir que la foto de "ver una vez" se mande normal',
  // Entregas del día
  margenMinutos: 'el margen en minutos que se suma al tiempo del motorizado',
  confirmacionEsperaMin: 'los minutos de espera para volver a pedir la confirmación',
  confirmacionMaxIntentos: 'las veces que se pide la confirmación',
  motorizadoEsperaMin: 'los minutos de espera al motorizado',
  motorizadoMaxIntentos: 'las veces que se insiste al motorizado',
  sincronizarCadaMin: 'un ajuste que ya no se usa (a GSG no se le pregunta nada)',
  pinDistanciaMaxKm: 'la distancia máxima entre el pin y el distrito (km)',
  buscarDireccionEnMapa: 'si la dirección escrita se busca en el mapa',
  reasignarMotorizadoMin: 'los minutos para pasar el pedido a otro motorizado si no da sus minutos',
  alertaSinUbicacionHora: 'la hora del aviso de pedidos sin ubicación',
  alertaEnCaminoMin: 'los minutos pasada la hora estimada para avisar de un pedido en camino',
  redactarConIA: 'si la IA redacta los mensajes',
  leerConIA: 'si la IA lee las respuestas',
  mandarPinAlMotorizado: 'si al motorizado se le manda el pin',
  avisarEntregado: 'si al cliente se le avisa al entregar',
  responderDondeEsta: 'si se contesta "¿dónde está mi pedido?"',
  avisarCerca: 'si al cliente se le avisa cuando el motorizado está cerca',
  usarBotones: 'si se usan botones SÍ / NO',
  cierreDelDia: 'el cierre del día',
  'cierreDelDia.activo': 'si el cierre del día está encendido',
  'cierreDelDia.hora': 'la hora del cierre del día',
  segundaVisita: 'la segunda visita',
  'segundaVisita.activa': 'si la segunda visita está encendida',
  'segundaVisita.esperaMin': 'los minutos que se espera la respuesta del cliente a la segunda visita',
  plantillas: 'las plantillas',
  'plantillas.confirmacion': 'la plantilla de la confirmación',
  'plantillas.motorizado': 'la plantilla para el motorizado',
  'plantillas.aviso': 'la plantilla del aviso de llegada',
  textos: 'los textos',
  // Pedidos, motorizados y listas
  referencia: 'la referencia del pedido',
  telefono: 'el teléfono',
  telefonos: 'los teléfonos',
  phone: 'el teléfono',
  nombre: 'el nombre',
  direccion: 'la dirección',
  distrito: 'el distrito',
  notas: 'las notas',
  placa: 'la placa',
  zona: 'la zona',
  estado: 'el estado',
  motorizadoId: 'el motorizado',
  lat: 'la latitud',
  lng: 'la longitud',
  urgente: 'si es urgente',
  faltaUbicacion: 'si falta la ubicación',
  faltaConfirmacion: 'si falta confirmar',
  faltaConfirmar: 'si falta confirmar',
  texto: 'el texto',
  clave: 'la clave',
  usuario: 'el usuario',
  correo: 'el correo',
  url: 'la dirección web',
  token: 'el token',
  // Reparto por lotes
  horaInicio: 'la hora de inicio',
  horaFin: 'la hora de fin',
  pausaMinSegundos: 'la pausa mínima entre mensajes (segundos)',
  pausaMaxSegundos: 'la pausa máxima entre mensajes (segundos)',
  esperaRespuestaMinutos: 'los minutos de espera de la respuesta',
  maxIntentos: 'el máximo de intentos',
  // Que todo funcione
  vigilante: 'el vigilante del WhatsApp',
  'vigilante.minutos': 'los minutos caído antes de avisar',
  'vigilante.correo': 'el correo que recibe el aviso',
  humo: 'la prueba de cada mañana',
  'humo.hora': 'la hora de la prueba de cada mañana',
  'humo.activo': 'si la prueba de cada mañana está encendida',
  copia: 'la copia de seguridad',
  'copia.hora': 'la hora de la copia',
  'copia.carpeta': 'la carpeta de las copias',
  'copia.conservar': 'cuántas copias se conservan',
};

/** `pausaMinSeg` -> "pausa min seg"; `avisos.supervisor` -> "supervisor" si no esta en el diccionario. */
function deshacerCamelCase(clave: string): string {
  return clave
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
}

/** El nombre de un campo en palabras, a partir de la ruta que da Zod. */
export function nombreDeCampo(ruta: Array<string | number>): string {
  const partes = ruta.filter((p): p is string => typeof p === 'string');
  if (!partes.length) return 'los datos';
  const entera = partes.join('.');
  if (NOMBRES_DE_CAMPO[entera]) return NOMBRES_DE_CAMPO[entera]!;
  // Se prueba de la ruta mas larga a la mas corta, y al final el nombre suelto.
  for (let i = 1; i < partes.length; i++) {
    const cola = partes.slice(i).join('.');
    if (NOMBRES_DE_CAMPO[cola]) return NOMBRES_DE_CAMPO[cola]!;
  }
  const ultimo = partes[partes.length - 1]!;
  if (NOMBRES_DE_CAMPO[ultimo]) return NOMBRES_DE_CAMPO[ultimo]!;
  const indices = ruta.filter((p): p is number => typeof p === 'number');
  const posicion = indices.length ? ` (fila ${indices[indices.length - 1]! + 1})` : '';
  return `"${deshacerCamelCase(ultimo)}"${posicion}`;
}

/** Un error de Zod entero, listo para la pantalla: "Revisa los datos: el margen en minutos tiene que ser como mínimo 0; …". */
export function explicarErrorZod(error: z.ZodError): string {
  const trozos = error.issues.map((i) => `${nombreDeCampo(i.path)} ${i.message}`);
  const unicos = Array.from(new Set(trozos));
  return `Revisa los datos: ${unicos.join('; ')}.`;
}

/** Se llama una vez al arrancar el proceso. */
export function instalarMensajesEnEspanol(): void {
  z.setErrorMap(mensajesEnEspanol);
}
