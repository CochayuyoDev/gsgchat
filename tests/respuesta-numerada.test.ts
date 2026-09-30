/**
 * Por QR los botones salen como lista numerada: «2» es pulsar la opción 2.
 * El 26/09 un cliente contestó «2» (No) a «¿es ahí?» y nadie lo entendió.
 */

import { describe, expect, it } from 'vitest';
import { respuestaNumeradaComoBoton } from '../src/handlers/inbound.js';
import type { InboundMessage } from '../src/whatsapp/types.js';

function deps(ultimo: Record<string, unknown> | null, hace = 60_000) {
  const mensajes = ultimo ? [{ direction: 'out', payload: ultimo, createdAt: new Date(Date.now() - hace) }] : [];
  return {
    repos: {
      contacts: { getByPhone: async () => ({ id: 'c1', phone: '51900048813' }) },
      messages: { listMessages: async () => mensajes },
    },
  } as never;
}

const texto = (body: string): InboundMessage => ({ id: 'w1', from: '51900048813', timestamp: '1', type: 'text', text: { body } }) as InboundMessage;
const PREGUNTA = { origen: 'sistema', interactive: { body: '¿Es ahí?', buttons: [{ id: 'entrega:pinsi:10', title: 'Sí, es ahí' }, { id: 'entrega:pinno:10', title: 'No' }] } };

describe('respuesta numerada', () => {
  it('«2» tras una pregunta con opciones es el segundo botón', async () => {
    const m = await respuestaNumeradaComoBoton(texto('2'), deps(PREGUNTA));
    expect(m.type).toBe('interactive');
    expect(m.interactive?.button_reply).toEqual({ id: 'entrega:pinno:10', title: 'No' });
  });

  it('«1.» también vale', async () => {
    const m = await respuestaNumeradaComoBoton(texto('1.'), deps(PREGUNTA));
    expect(m.interactive?.button_reply?.id).toBe('entrega:pinsi:10');
  });

  it('un número sin pregunta con opciones sigue siendo texto', async () => {
    expect((await respuestaNumeradaComoBoton(texto('2'), deps({ origen: 'sistema' }))).type).toBe('text');
    expect((await respuestaNumeradaComoBoton(texto('3'), deps(PREGUNTA))).type).toBe('text');
  });

  it('un número dentro de una frase o una pregunta vieja no cuenta', async () => {
    expect((await respuestaNumeradaComoBoton(texto('en 2 horas'), deps(PREGUNTA))).type).toBe('text');
    expect((await respuestaNumeradaComoBoton(texto('2'), deps(PREGUNTA, 2 * 24 * 60 * 60_000))).type).toBe('text');
  });
});
