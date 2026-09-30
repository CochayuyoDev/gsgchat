/**
 * Revisar el numero ANTES de escribirle.
 *
 * Un lote de doscientos pedidos trae siempre unos cuantos telefonos rotos: el
 * que perdio un digito al pasarlo a mano, el fijo de la oficina, el que
 * alguien escribio con letras. Mandar contra esos numeros no solo no llega:
 * cada envio fallido cuenta para la reputacion del numero y acerca el bloqueo.
 *
 * Asi que se revisan aqui, se marcan con su incidencia exacta y no se
 * encolan. Lo que sale de este fichero es un numero marcable o un motivo.
 *
 * Por defecto, Peru: celular de 9 digitos que empieza por 9, prefijo 51. Es
 * donde opera GSG. `PAIS_GENERICO` deja pasar cualquier numero razonable para
 * cuando el mismo sistema se use fuera.
 */

import type { CodigoIncidencia } from './incidencias.js';
import { esNumeroDePrueba } from '../desarrollador/numeros.js';

export interface PlanNumeracion {
  /** Prefijo internacional, sin +. */
  pais: string;
  /**
   * Un digito que a veces viene pegado detras del prefijo de pais y sobra
   * (Mexico: el "1" de 521...). Se quita solo si asi el numero queda con
   * el largo nacional.
   */
  quitarTrasPais?: string;
  /** Cuantos digitos tiene el numero nacional (sin prefijo de pais). */
  largoNacional: number;
  /** Con que empieza un movil. Vacio = no se puede distinguir. */
  inicioMovil: string[];
  /** Con que empieza un fijo, para poder decirlo con nombre propio. */
  inicioFijo: string[];
}

export const PERU: PlanNumeracion = {
  pais: '51',
  largoNacional: 9,
  inicioMovil: ['9'],
  // 1 es Lima; el resto de provincias van con su codigo de dos digitos, que
  // en formato nacional de 9 digitos empiezan por 0 o por el codigo.
  inicioFijo: ['1', '0'],
};

export const MEXICO: PlanNumeracion = {
  pais: '52',
  largoNacional: 10,
  inicioMovil: [],
  inicioFijo: [],
  // WhatsApp identifica a los celulares mexicanos como 521 + 10 digitos (el
  // "1" de movil de antes). Se quita para quedarse con 52 + 10, que es como
  // se marca hoy y como acepta la API.
  quitarTrasPais: '1',
};

/** Sin plan: se acepta cualquier cosa que parezca un numero internacional. */
export const GENERICO: PlanNumeracion = {
  pais: '',
  largoNacional: 0,
  inicioMovil: [],
  inicioFijo: [],
};

export const PLANES: Record<string, PlanNumeracion> = {
  peru: PERU,
  mexico: MEXICO,
  generico: GENERICO,
};

export type RevisionTelefono =
  | { ok: true; phone: string; nacional: string; corregido: boolean }
  | { ok: false; incidencia: CodigoIncidencia; detalle: string };

/** Deja solo digitos y quita las formas de escribir el prefijo internacional. */
export function soloDigitos(entrada: string): string {
  const limpio = (entrada ?? '').replace(/\D+/g, '');
  // 00 delante es el prefijo internacional a la europea; sobra siempre.
  return limpio.startsWith('00') ? limpio.slice(2) : limpio;
}

/**
 * Revisa un telefono contra el plan de numeracion.
 *
 * `corregido` avisa de que el numero se toco (se le puso el prefijo de pais,
 * se le quito un 0 nacional): la pantalla lo ensena, porque un numero
 * "arreglado" solo es correcto si el original venia como se esperaba.
 */
export function revisarTelefono(entrada: string, plan: PlanNumeracion = PERU): RevisionTelefono {
  const bruto = (entrada ?? '').trim();
  if (!bruto) {
    return { ok: false, incidencia: 'numero_invalido', detalle: 'el campo del teléfono vino vacío' };
  }

  const digitos = soloDigitos(bruto);
  if (!digitos) {
    return {
      ok: false,
      incidencia: 'numero_invalido',
      detalle: `"${bruto.slice(0, 40)}" no tiene ningún dígito`,
    };
  }

  // Los del Modulo desarrollador (51 000 0/1…): su rango esta elegido para no
  // poder ser un numero real, asi que no pasan las reglas de un celular; se
  // aceptan tal cual y el sender nunca los manda a WhatsApp.
  // (Sobre los digitos tal cual: `soloDigitos` quitaria el «00» del principio.)
  const tal = bruto.replace(/\D+/g, '');
  if (esNumeroDePrueba(tal)) {
    const phone = tal.length === 9 ? `51${tal}` : tal;
    return { ok: true, phone, nacional: phone.slice(2), corregido: phone !== bruto.replace(/^\+/, '') };
  }

  // Sin plan: se acepta lo que quepa en un numero internacional.
  if (!plan.pais) {
    if (digitos.length < 8) {
      return {
        ok: false,
        incidencia: 'numero_corto',
        detalle: `${digitos.length} dígitos: "${digitos}"`,
      };
    }
    if (digitos.length > 15) {
      return {
        ok: false,
        incidencia: 'numero_largo',
        detalle: `${digitos.length} dígitos: "${digitos}"`,
      };
    }
    return { ok: true, phone: digitos, nacional: digitos, corregido: digitos !== bruto };
  }

  let nacional = digitos;
  let corregido = digitos !== bruto.replace(/^\+/, '');

  if (nacional.startsWith(plan.pais) && nacional.length > plan.largoNacional) {
    nacional = nacional.slice(plan.pais.length);
    if (plan.quitarTrasPais && nacional.startsWith(plan.quitarTrasPais) && nacional.length === plan.largoNacional + 1) {
      nacional = nacional.slice(plan.quitarTrasPais.length);
    }
  }
  // Un 0 delante es el prefijo de larga distancia nacional: "0987654321".
  if (nacional.length === plan.largoNacional + 1 && nacional.startsWith('0')) {
    nacional = nacional.slice(1);
    corregido = true;
  }

  if (nacional.length < plan.largoNacional) {
    const faltan = plan.largoNacional - nacional.length;
    return {
      ok: false,
      incidencia: 'numero_corto',
      detalle:
        `"${bruto}" tiene ${nacional.length} dígitos y un celular necesita ${plan.largoNacional}` +
        `; falta${faltan === 1 ? '' : 'n'} ${faltan}`,
    };
  }

  if (nacional.length > plan.largoNacional) {
    return {
      ok: false,
      incidencia: 'numero_largo',
      detalle: `"${bruto}" tiene ${nacional.length} dígitos y un celular tiene ${plan.largoNacional}`,
    };
  }

  if (plan.inicioFijo.length && plan.inicioFijo.some((p) => nacional.startsWith(p))) {
    return {
      ok: false,
      incidencia: 'numero_fijo',
      detalle: `"${bruto}" es un número de red fija`,
    };
  }

  if (plan.inicioMovil.length && !plan.inicioMovil.some((p) => nacional.startsWith(p))) {
    return {
      ok: false,
      incidencia: 'numero_invalido',
      detalle: `"${bruto}" no empieza como un celular (debería empezar por ${plan.inicioMovil.join(' o ')})`,
    };
  }

  return { ok: true, phone: `${plan.pais}${nacional}`, nacional, corregido };
}

/**
 * Numeros del mismo lote que se diferencian en un solo digito.
 *
 * Es la firma de "se equivocaron al escribirlo": dos pedidos distintos con el
 * mismo telefono salvo un digito, o una transposicion. No decide nada por su
 * cuenta -puede haber dos hermanos con numeros seguidos-, pero se escribe en
 * el detalle de la incidencia, que es justo lo que necesita quien lo corrige.
 */
export function parecidos(phone: string, otros: string[]): string[] {
  return otros.filter((otro) => otro !== phone && distanciaDeTipeo(phone, otro));
}

/** true si `a` y `b` se distinguen en un digito cambiado o dos intercambiados. */
export function distanciaDeTipeo(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  const diferentes: number[] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) diferentes.push(i);
    if (diferentes.length > 2) return false;
  }

  if (diferentes.length === 1) return true;
  if (diferentes.length === 2) {
    const [i, j] = diferentes as [number, number];
    // Transposicion: "987654321" y "987654312".
    return j === i + 1 && a[i] === b[j] && a[j] === b[i];
  }
  return false;
}
