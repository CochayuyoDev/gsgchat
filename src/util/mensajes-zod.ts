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
  number: 'un numero',
  boolean: 'si o no',
  date: 'una fecha',
  array: 'una lista',
  object: 'un grupo de datos',
  null: 'vacio',
  undefined: 'vacio',
  integer: 'un numero entero',
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
      return { message: `se esperaba ${tipo(String(issue.expected))} y llego ${tipo(String(issue.received))}` };

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
          ? { message: 'no puede ir vacio' }
          : { message: `necesita al menos ${unidades(minimo, 'caracter', 'caracteres')}` };
      }
      if (issue.type === 'array') {
        return minimo <= 1
          ? { message: 'la lista no puede ir vacia' }
          : { message: `la lista necesita al menos ${unidades(minimo, 'elemento', 'elementos')}` };
      }
      return { message: `tiene que ser ${issue.inclusive ? 'como minimo' : 'mayor que'} ${minimo}` };
    }

    case z.ZodIssueCode.too_big: {
      const maximo = Number(issue.maximum);
      if (issue.type === 'string') {
        return { message: `no puede pasar de ${unidades(maximo, 'caracter', 'caracteres')}` };
      }
      if (issue.type === 'array') {
        return { message: `la lista no puede pasar de ${unidades(maximo, 'elemento', 'elementos')}` };
      }
      return { message: `tiene que ser ${issue.inclusive ? 'como maximo' : 'menor que'} ${maximo}` };
    }

    case z.ZodIssueCode.invalid_string: {
      if (issue.validation === 'url') return { message: 'tiene que ser una direccion web completa (https://...)' };
      if (issue.validation === 'email') return { message: 'tiene que ser un correo valido' };
      if (issue.validation === 'uuid') return { message: 'tiene que ser un identificador valido' };
      return { message: 'el formato no es el esperado' };
    }

    case z.ZodIssueCode.not_multiple_of:
      return { message: `tiene que ser multiplo de ${String(issue.multipleOf)}` };

    case z.ZodIssueCode.invalid_date:
      return { message: 'la fecha no es valida' };

    default:
      // Los mensajes escritos a mano en los esquemas ya estan en espanol y
      // llegan por aqui: se respetan tal cual.
      return { message: ctx.defaultError };
  }
};

/** Se llama una vez al arrancar el proceso. */
export function instalarMensajesEnEspanol(): void {
  z.setErrorMap(mensajesEnEspanol);
}
