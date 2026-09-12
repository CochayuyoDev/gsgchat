/**
 * La respuesta de información contesta lo que se preguntó, y primero.
 *
 * Pedido del dueño, mirando una conversación real: el cliente saludó, el bot
 * respondió bien, el cliente escribió "cuál es su horario" y recibió
 * "Atendemos todo Lima y Callao. Horario: …" con el menú pegado debajo. La
 * hora estaba, pero enterrada detrás de la cobertura y con pinta de folleto:
 * se lee como si el bot no hubiera escuchado la pregunta.
 *
 * Lo que se protege aquí: que preguntar por el horario abra con el horario,
 * que preguntar por la zona abra con la zona, y que el botón —donde no hay
 * texto que leer— siga dando la respuesta combinada de siempre.
 */
import { describe, expect, it } from 'vitest';
import { BOTON, claveDeInfo, responder, type Contexto } from '../src/preventa/flow.js';
import { nuevaFicha } from './fakes-leads.js';

const CTX: Contexto = {
  negocio: 'GSG Courier',
  cobertura: 'todo Lima y Callao',
  saludo: 'Buenos días',
  horario: 'lunes a sábado de 8:00 a 18:00',
};

/** Un turno suelto sobre una ficha ya presentada. */
function contesta(texto: string, botonId?: string) {
  const { respuesta } = responder(
    nuevaFicha('c1', { estado: 'en_conversacion' }),
    { texto, esPrimerMensaje: false, ...(botonId ? { botonId } : {}) },
    CTX,
  );
  return respuesta?.texto ?? '';
}

describe('qué respuesta de información toca', () => {
  it('preguntar por el horario abre con el horario', () => {
    for (const pregunta of [
      'cual es su horario',
      '¿a qué hora abren?',
      'hasta que hora atienden',
      'a que hora cierran',
    ]) {
      expect(claveDeInfo({ texto: pregunta, esPrimerMensaje: false })).toBe('infoHorario');
    }
  });

  it('preguntar por la zona abre con la zona', () => {
    for (const pregunta of [
      'hasta donde llegan',
      'que zonas cubren',
      'cual es su cobertura',
      'llegan a mi distrito',
    ]) {
      expect(claveDeInfo({ texto: pregunta, esPrimerMensaje: false })).toBe('infoZona');
    }
  });

  it('preguntar las dos cosas a la vez deja la respuesta combinada', () => {
    expect(
      claveDeInfo({ texto: 'que horario tienen y hasta donde llegan', esPrimerMensaje: false }),
    ).toBe('info');
  });

  it('sin texto reconocible, la combinada', () => {
    expect(claveDeInfo({ texto: '', esPrimerMensaje: false })).toBe('info');
    expect(claveDeInfo({ texto: 'informacion por favor', esPrimerMensaje: false })).toBe('info');
  });
});

describe('lo que le llega al cliente', () => {
  it('el horario va primero cuando se pregunta por el horario', () => {
    const dicho = contesta('cual es su horario');

    expect(dicho).toContain('lunes a sábado de 8:00 a 18:00');
    expect(dicho.indexOf('lunes a sábado')).toBeLessThan(dicho.indexOf('todo Lima y Callao'));
  });

  it('la zona va primero cuando se pregunta hasta dónde llegan', () => {
    const dicho = contesta('hasta donde llegan');

    expect(dicho).toContain('todo Lima y Callao');
    expect(dicho.indexOf('todo Lima y Callao')).toBeLessThan(dicho.indexOf('lunes a sábado'));
  });

  it('el botón de info sigue dando la respuesta combinada', () => {
    const dicho = contesta('', BOTON.info);

    expect(dicho).toContain('todo Lima y Callao');
    expect(dicho).toContain('lunes a sábado de 8:00 a 18:00');
  });

  it('las tres respuestas dicen la hora y la zona: ninguna deja al cliente a medias', () => {
    for (const pregunta of ['cual es su horario', 'hasta donde llegan', 'que horario tienen y hasta donde llegan']) {
      const dicho = contesta(pregunta);
      expect(dicho).toContain('lunes a sábado de 8:00 a 18:00');
      expect(dicho).toContain('todo Lima y Callao');
    }
  });
});
