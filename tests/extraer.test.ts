/**
 * Lo que el cliente ya dijo sin que se lo preguntaran.
 *
 * Sale de un caso real: "quiero mandar una caja de documentos de Surco a
 * Miraflores hoy mismo" contestaba "no reconocí ese mensaje". El cliente había
 * dicho el origen, el destino y la fecha en una frase, y el asistente le pedía
 * que empezara por el principio.
 *
 * La regla que se prueba aquí es la de ante la duda no rellenar: hacer repetir
 * un dato molesta, pero mandar el reparto al distrito equivocado cuesta el
 * viaje entero y nadie lo revisa a tiempo.
 */

import { describe, expect, it } from 'vitest';
import { extraerCuando, extraerDeMensaje, extraerRuta } from '../src/preventa/extraer.js';

describe('el origen y el destino en una sola frase', () => {
  it('los saca de la forma "de X a Y"', () => {
    expect(extraerRuta('quiero enviar de barranco para lince')).toEqual({
      recojo: 'Barranco',
      entrega: 'Lince',
    });
  });

  it('los saca aunque la frase venga cargada', () => {
    expect(
      extraerRuta('Hola buenas, quiero mandar una caja de documentos de Surco a Miraflores hoy mismo'),
    ).toEqual({ recojo: 'Santiago de Surco', entrega: 'Miraflores' });
  });

  it('guarda el nombre completo, no el apodo', () => {
    expect(extraerRuta('un envío de SMP a La Molina')).toEqual({
      recojo: 'San Martín de Porres',
      entrega: 'La Molina',
    });
  });

  it('no adivina con un solo distrito', () => {
    // Con "estoy en Surco" no se sabe si recoge o entrega ahí.
    expect(extraerRuta('estoy en Surco')).toBeNull();
  });

  it('no adivina sin una palabra que diga cuál es cuál', () => {
    expect(extraerRuta('Surco Miraflores')).toBeNull();
  });

  it('no inventa una ruta con tres distritos sueltos', () => {
    expect(extraerRuta('trabajo en lince, vivo en surco y mi mamá en ate')).toBeNull();
  });

  it('no ve ruta donde no la hay', () => {
    expect(extraerRuta('quiero saber precios')).toBeNull();
    expect(extraerRuta('hola buenas tardes')).toBeNull();
  });
});

describe('la fecha, cuando no admite duda', () => {
  it('entiende hoy y mañana, con eñe y sin ella', () => {
    expect(extraerCuando('lo necesito hoy mismo')).toBe('Hoy');
    expect(extraerCuando('para mañana temprano')).toBe('Mañana');
    expect(extraerCuando('para manana temprano')).toBe('Mañana');
  });

  it('no se inventa una fecha con "otro día"', () => {
    expect(extraerCuando('ya te aviso otro día')).toBeNull();
  });
});

describe('lo que se guarda de un mensaje', () => {
  it('rellena lo que falta y respeta lo que ya está', () => {
    expect(
      extraerDeMensaje('de surco a miraflores hoy', { recojoDistrito: 'Ate' }),
    ).toEqual({ entregaDistrito: 'Miraflores', cuando: 'Hoy' });
  });

  it('no toca nada si el mensaje no dice nada', () => {
    expect(extraerDeMensaje('hola', {})).toEqual({});
  });

  it('respeta el catálogo de la tienda', () => {
    // Una tienda que solo reparte en dos distritos no puede acabar con una
    // ficha apuntando a un tercero.
    expect(extraerDeMensaje('de surco a miraflores', {}, ['Miraflores', 'Barranco'])).toEqual({});
  });
});
