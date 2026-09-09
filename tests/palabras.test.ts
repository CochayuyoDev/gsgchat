/**
 * Distinguir una palabra de un tecleo.
 *
 * El riesgo de esto no es dejar pasar basura: es rechazar respuestas buenas.
 * Un cliente al que le rechazan "iPhone 15" o "polos oversize" abandona, y el
 * daño es mucho peor que una ficha con una coletilla dentro. Por eso hay el
 * doble de casos que deben PASAR que de los que deben caer.
 */

import { describe, expect, it } from 'vitest';
import { palabraPlausible, pareceTextoReal } from '../src/preventa/palabras.js';

describe('lo que NO son palabras', () => {
  it('el tecleo al azar', () => {
    for (const t of ['asdasd', 'qweqwe', 'sdfsdf', 'zxczxc']) {
      expect(pareceTextoReal(t)).toBe(false);
    }
  });

  it('las risas y las coletillas solas', () => {
    for (const t of ['jajaja', 'jeje', 'xd', 'lol', 'mmm', 'hmm']) {
      expect(pareceTextoReal(t)).toBe(false);
    }
  });

  it('una letra repetida', () => {
    for (const t of ['aaaa', 'eeeee', 'holaaaa xd']) {
      expect(palabraPlausible(t.split(' ')[0]!)).toBe(false);
    }
  });

  it('sin vocales', () => {
    expect(palabraPlausible('sdfgh')).toBe(false);
    expect(palabraPlausible('bcdfg')).toBe(false);
  });

  it('vacío', () => {
    expect(pareceTextoReal('')).toBe(false);
    expect(pareceTextoReal('   ')).toBe(false);
  });
});

describe('lo que SÍ tiene que pasar', () => {
  it('lo que la gente envía de verdad', () => {
    for (const t of [
      'una caja de documentos',
      'ropa',
      'dos bolsas de ropa',
      'una laptop en su caja',
      'medicinas',
      'un sobre manila',
      'repuestos de moto',
      'torta de cumpleaños',
      'muestras de tela',
    ]) {
      expect(pareceTextoReal(t)).toBe(true);
    }
  });

  it('marcas y modelos, con números y todo', () => {
    for (const t of ['iPhone 15', 'Samsung A54', 'cargador 65W', 'cable USB-C 2m', 'Paracetamol 500mg']) {
      expect(pareceTextoReal(t)).toBe(true);
    }
  });

  it('nombres de persona', () => {
    for (const t of ['Roberto Ramirez', 'Ana', 'Luis Fernández', 'María del Carmen', 'Ali Gomez']) {
      expect(pareceTextoReal(t)).toBe(true);
    }
  });

  it('distritos', () => {
    for (const t of ['Surco', 'San Borja', 'Villa El Salvador', 'Ate', 'Callao', 'Breña']) {
      expect(pareceTextoReal(t)).toBe(true);
    }
  });

  it('una respuesta buena con una coletilla dentro', () => {
    // Basta UNA palabra plausible: rechazar esto sería pedantear.
    expect(pareceTextoReal('una caja de documentos xd')).toBe(true);
    expect(pareceTextoReal('jaja si, ropa')).toBe(true);
  });

  it('palabras con eñe y con tilde', () => {
    expect(palabraPlausible('nino')).toBe(true);
    expect(pareceTextoReal('muñecos de peluche')).toBe(true);
    expect(pareceTextoReal('artículos de limpieza')).toBe(true);
  });
});
