/**
 * Distinguir una palabra de un tecleo.
 *
 * El riesgo de esto no es dejar pasar basura: es rechazar respuestas buenas.
 * Un cliente al que le rechazan "iPhone 15" o "polos oversize" abandona, y el
 * daño es mucho peor que una ficha con una coletilla dentro. Por eso hay el
 * doble de casos que deben PASAR que de los que deben caer.
 */

import { describe, expect, it } from 'vitest';
import { esAgradecimiento, esSaludo, palabraPlausible, pareceTextoReal } from '../src/preventa/palabras.js';

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

describe('un saludo no es un mensaje incomprensible', () => {
  it('reconoce las formas de saludar', () => {
    for (const s of ['hola', 'Hola buenas', 'buenos días', 'BUENAS TARDES', 'holaaa', 'buenas noches señor', 'hola, ¿qué tal?']) {
      expect(esSaludo(s), s).toBe(true);
    }
  });

  it('no confunde un saludo con lo que viene detrás', () => {
    // "hola quiero cotizar" es una petición, no un saludo: atenderla como
    // saludo le devolvería el menú a quien ya dijo lo que quería.
    for (const s of ['hola quiero cotizar', 'buenas, cuánto cuesta a surco', 'Miraflores', '72554686', 'asdasd', '']) {
      expect(esSaludo(s), s).toBe(false);
    }
  });
});

describe('dar las gracias no es un mensaje incomprensible', () => {
  it('reconoce el cierre de turno', () => {
    for (const s of ['gracias', 'ok gracias', 'muchas gracias', 'listo', 'perfecto, gracias', 'chau', 'muy amable']) {
      expect(esAgradecimiento(s), s).toBe(true);
    }
  });

  it('no se lleva por delante lo que viene con un gracias', () => {
    // "gracias, pero quiero cotizar" pide algo: cerrarle el turno seria
    // dejarle con la petición sin atender.
    for (const s of ['gracias pero quiero cotizar a miraflores', 'ok, cuanto cuesta el arroz', 'Miraflores', 'asdasd', '']) {
      expect(esAgradecimiento(s), s).toBe(false);
    }
  });
});

describe('un nombre de pila no es tecleo al azar', () => {
  it('acepta los nombres que llevan un tramo de teclado dentro', () => {
    // "Roberto" lleva "ert" y tres vocales de siete: se rechazaba, y el
    // cliente que daba su nombre se llevaba un "no reconocí ese mensaje".
    // A partir de ahí la conversación se corría un paso y el DNI acababa
    // guardado como nombre.
    for (const n of ['Roberto', 'Alberto', 'Ernesto', 'Gilberto', 'Humberto', 'Norberto']) {
      expect(pareceTextoReal(n), n).toBe(true);
    }
  });

  it('y sigue rechazando lo que sí es un teclado', () => {
    for (const n of ['asdasd', 'qweqwe', 'asdf', 'qwerty', 'zxcvbn', 'hjkl']) {
      expect(pareceTextoReal(n), n).toBe(false);
    }
  });
});
