/**
 * El número conectado registrado como motorizado (pruebas del dueño, 25/09):
 * lo que el dueño escribe a mano en su chat «Tú» cuenta como respuesta del
 * motorizado. Con las guardas contra el bucle.
 */

import { describe, expect, it } from 'vitest';
import { propioComoMotorizado } from '../src/web/local-routes.js';
import type { SendJob } from '../src/outbound/sender.js';

const PROPIO = '51987111222';

function armar(opts: { esMotorizado?: boolean; mensajes?: Array<{ direction: 'in' | 'out'; wamid: string | null; body: string }>; atiende?: boolean } = {}) {
  const textos: string[] = [];
  const enviados: SendJob[] = [];
  const d = {
    esperaMs: 0,
    repos: { messages: { listMessages: async () => (opts.mensajes ?? []) as never } } as never,
    entregas: {
      esMotorizado: async () => opts.esMotorizado ?? true,
      alTexto: async (_c: unknown, texto: string) => {
        textos.push(texto);
        return opts.atiende === false ? { atendida: false } : { atendida: true, responder: 'Anotado: 40 min' };
      },
    } as never,
    sender: { send: async (job: SendJob) => (enviados.push(job), { ok: true as const, wamid: 'w', deliveryId: 1 }) },
  };
  return { d, textos, enviados };
}

const contacto = { id: 'c1', phone: PROPIO, name: 'Yo' };

describe('lo escrito en el chat «Tú» cuando el número propio es motorizado', () => {
  it('cuenta como respuesta del motorizado y se le contesta lo que diga el sistema', async () => {
    const { d, textos, enviados } = armar();
    expect(await propioComoMotorizado(d, contacto, { id: 'm1', texto: '40' }, PROPIO)).toBe('atendido');
    expect(textos).toEqual(['40']);
    expect(enviados.map((j) => j.text)).toEqual(['Anotado: 40 min']);
    expect(enviados[0]!.origen).toBe('sistema');
  });

  it('otro chat (no el propio) no cuenta', async () => {
    const { d, textos } = armar();
    expect(await propioComoMotorizado(d, { ...contacto, phone: '51999000001' }, { id: 'm1', texto: '40' }, PROPIO)).toBe('no_es_propio');
    expect(await propioComoMotorizado(d, contacto, { id: 'm1', texto: '40' }, '')).toBe('no_es_propio');
    expect(textos).toEqual([]);
  });

  it('guardas contra el bucle: vacío, más de 120 caracteres o igual a algo que el sistema ya mandó a ese chat', async () => {
    const { d, textos } = armar({ mensajes: [{ direction: 'out', wamid: 'sis-1', body: 'Nuevo pedido P-1001: ¿en cuánto lo entregas?' }, { direction: 'out', wamid: 'm2', body: 'entregado' }] });
    expect(await propioComoMotorizado(d, contacto, { id: 'm1', texto: '   ' }, PROPIO)).toBe('descartado');
    expect(await propioComoMotorizado(d, contacto, { id: 'm1', texto: 'x'.repeat(121) }, PROPIO)).toBe('descartado');
    expect(await propioComoMotorizado(d, contacto, { id: 'm1', texto: 'Nuevo pedido P-1001: ¿en cuánto lo entregas?' }, PROPIO)).toBe('descartado');
    expect(textos).toEqual([]);
    // El propio mensaje (mismo wamid) guardado en el hilo no cuenta como «ya lo mandó el sistema».
    expect(await propioComoMotorizado(d, contacto, { id: 'm2', texto: 'entregado' }, PROPIO)).toBe('atendido');
    expect(textos).toEqual(['entregado']);
  });

  it('si el número propio no está registrado como motorizado, no pasa nada', async () => {
    const { d, textos, enviados } = armar({ esMotorizado: false });
    expect(await propioComoMotorizado(d, contacto, { id: 'm1', texto: '40' }, PROPIO)).toBe('no_es_motorizado');
    expect(textos).toEqual([]);
    expect(enviados).toEqual([]);
  });

  it('si las entregas no lo entienden, no se le contesta nada', async () => {
    const { d, enviados } = armar({ atiende: false });
    expect(await propioComoMotorizado(d, contacto, { id: 'm1', texto: 'hola' }, PROPIO)).toBe('no_atendido');
    expect(enviados).toEqual([]);
  });
});
