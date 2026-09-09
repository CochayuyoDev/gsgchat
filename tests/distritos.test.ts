/**
 * Reconocer un distrito.
 *
 * Sale de un caso real: alguien contestó "No viejo" a "¿de qué distrito
 * recogemos?" y quedó guardado como el distrito. La ficha llegó al repartidor
 * diciendo que recogiera en "No viejo".
 *
 * Ninguna validación genérica lo caza —son dos palabras normales, sin signos
 * raros ni tecleo al azar—. La única forma es saber qué distritos existen, y
 * en Lima y Callao son cincuenta, una lista que no cambia.
 */

import { describe, expect, it } from 'vitest';
import {
  DISTRITOS_LIMA_CALLAO,
  distancia,
  reconocerDistrito,
} from '../src/preventa/distritos.js';

describe('lo que NO es un distrito', () => {
  it('el caso que lo motivó', () => {
    expect(reconocerDistrito('No viejo')).toBeNull();
  });

  it('otras respuestas que no dicen un lugar', () => {
    for (const texto of ['ya te dije', 'por ahi nomas', 'cerca', 'no se', 'donde sea', 'xd']) {
      expect(reconocerDistrito(texto)).toBeNull();
    }
  });

  it('una ciudad que no atendemos tampoco', () => {
    expect(reconocerDistrito('Arequipa')).toBeNull();
    expect(reconocerDistrito('Trujillo')).toBeNull();
  });

  it('vacío no es nada', () => {
    expect(reconocerDistrito('')).toBeNull();
    expect(reconocerDistrito('   ')).toBeNull();
  });
});

describe('lo que sí es', () => {
  it('el nombre exacto', () => {
    expect(reconocerDistrito('Miraflores')).toBe('Miraflores');
    expect(reconocerDistrito('San Borja')).toBe('San Borja');
  });

  it('sin tildes y en minúsculas, como escribe la gente', () => {
    expect(reconocerDistrito('jesus maria')).toBe('Jesús María');
    expect(reconocerDistrito('RIMAC')).toBe('Rímac');
    expect(reconocerDistrito('brena')).toBe('Breña');
  });

  it('como lo llaman de verdad', () => {
    // Nadie escribe "Santiago de Surco" ni "San Martín de Porres".
    expect(reconocerDistrito('surco')).toBe('Santiago de Surco');
    expect(reconocerDistrito('SMP')).toBe('San Martín de Porres');
    expect(reconocerDistrito('sjl')).toBe('San Juan de Lurigancho');
    expect(reconocerDistrito('vitarte')).toBe('Ate');
    expect(reconocerDistrito('chosica')).toBe('Lurigancho');
    expect(reconocerDistrito('cercado de lima')).toBe('Lima');
  });

  it('dentro de una frase', () => {
    expect(reconocerDistrito('vivo en San Isidro')).toBe('San Isidro');
    expect(reconocerDistrito('el distrito de Comas')).toBe('Comas');
    expect(reconocerDistrito('estoy por La Molina')).toBe('La Molina');
  });

  it('con una errata', () => {
    expect(reconocerDistrito('mirafores')).toBe('Miraflores');
    expect(reconocerDistrito('surqillo')).toBe('Surquillo');
    expect(reconocerDistrito('chorillos')).toBe('Chorrillos');
  });

  it('el Callao también', () => {
    expect(reconocerDistrito('callao')).toBe('Callao');
    expect(reconocerDistrito('la punta')).toBe('La Punta');
    expect(reconocerDistrito('ventanilla')).toBe('Ventanilla');
  });

  it('los cincuenta se reconocen a sí mismos', () => {
    // Si alguno no se reconociera, el cliente que lo escriba bien sería
    // rechazado, que es peor que aceptar basura.
    for (const distrito of DISTRITOS_LIMA_CALLAO) {
      expect(reconocerDistrito(distrito)).toBe(distrito);
    }
  });
});

describe('una tienda fuera de Lima', () => {
  it('sin lista, se acepta lo que escriba', () => {
    // Inventarse una validación genérica rechazaría nombres legítimos de
    // sitios que no conocemos.
    expect(reconocerDistrito('Cayma', [])).toBe('Cayma');
    expect(reconocerDistrito('Cualquier Cosa', [])).toBe('Cualquier Cosa');
  });

  it('con su propia lista, la respeta', () => {
    expect(reconocerDistrito('cayma', ['Cayma', 'Yanahuara'])).toBe('Cayma');
    expect(reconocerDistrito('Miraflores', ['Cayma', 'Yanahuara'])).toBeNull();
  });
});

describe('la distancia de edición', () => {
  it('cuenta los cambios que hacen falta', () => {
    expect(distancia('surco', 'surco')).toBe(0);
    expect(distancia('surco', 'surko')).toBe(1);
    expect(distancia('', 'ate')).toBe(3);
  });

  it('no tolera tanto como para confundir dos distritos', () => {
    // "Lince" y "Lima" no pueden acabar siendo el mismo.
    expect(distancia('lince', 'lima')).toBeGreaterThan(2);
  });
});
