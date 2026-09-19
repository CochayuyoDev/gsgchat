import { describe, expect, it } from 'vitest';
import { payloadDeMensajePropio } from '../src/web/local-routes.js';

/**
 * Lo que se escribe desde el telefono es de una persona: sale al webhook
 * como `autor: persona` («Teléfono») y el otro sistema lo pinta como una
 * respuesta del equipo, no como un aviso del sistema.
 */
describe('mensajes escritos desde el telefono', () => {
  it('se guardan como de una persona llamada «Teléfono»', () => {
    expect(payloadDeMensajePropio(null, false)).toEqual({ origen: 'persona', autorNombre: 'Teléfono' });
    expect(payloadDeMensajePropio(undefined, false)).toEqual({ origen: 'persona', autorNombre: 'Teléfono' });
  });

  it('conservan el adjunto y quitan el autor del grupo', () => {
    const media = { id: 'm1', kind: 'image', mimeType: 'image/jpeg' };
    expect(payloadDeMensajePropio({ media, autor: '51912426667' }, false)).toEqual({ media, origen: 'persona', autorNombre: 'Teléfono' });
  });

  it('lo que vino del historial queda marcado', () => {
    expect(payloadDeMensajePropio({}, true)).toEqual({ origen: 'persona', autorNombre: 'Teléfono', historial: true });
  });
});
