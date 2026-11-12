/**
 * Aviso al cliente cuando GSG cambia datos de su pedido (pedido de GSG, 12/11):
 * «Se ha cambiado su llanta Pirelli por una llanta Michelin».
 *
 * Solo dentro de la ventana de 24 h (el cliente escribio hace menos de 24 h),
 * como mucho 2 avisos por pedido y solo de lo que le importa al cliente.
 */
import { describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG, type EscenarioEntregas } from './escenario-entregas.js';
import { CLAVE_API_PRUEBA } from './fakes.js';
import { cambiosParaElCliente, textoAvisoCambio } from '../src/entregas/aviso-cambio.js';
import type { Entrega } from '../src/entregas/repo.js';

const tel = '987601444';
const pedido = (extra: Record<string, unknown> = {}) => ({ ...OBLIGATORIOS_GSG, tracking: 'CAMBIO-1', cliente: 'Carlos Acencio', telefono: tel, producto: 'llanta Pirelli', ...extra });

const patch = (e: EscenarioEntregas, cuerpo: Record<string, unknown>) =>
  e.app.inject({ method: 'PATCH', url: '/api/v1/entregas/CAMBIO-1', headers: { 'x-api-key': CLAVE_API_PRUEBA }, payload: cuerpo });

const avisos = (e: EscenarioEntregas) => e.textosA(tel).filter((t) => /le informamos un cambio/.test(t));

describe('el texto del aviso', () => {
  const base = { id: 1, referencia: 'CAMBIO-1', nombre: 'Carlos Acencio', direccion: 'Av. Lima 1', distrito: 'Lince', estado: 'pendiente', datosEnvio: { producto: 'llanta Pirelli', monto: '85.00', tracking: 'CAMBIO-1' } } as unknown as Entrega;
  it('dice qué cambió con palabras del cliente', () => {
    const despues = { ...base, datosEnvio: { ...base.datosEnvio, producto: 'llanta Michelin', monto: '90.00' } } as Entrega;
    const cambios = cambiosParaElCliente(base, despues);
    expect(cambios).toEqual(['su llanta Pirelli por llanta Michelin', 'el monto a pagar de S/ 85.00 a S/ 90.00']);
    expect(textoAvisoCambio(despues, cambios)).toBe('Hola Carlos, le informamos un cambio en su pedido CAMBIO-1: se ha cambiado su llanta Pirelli por llanta Michelin y el monto a pagar de S/ 85.00 a S/ 90.00. Si tiene alguna duda, responda este mensaje.');
  });
  it('lo que no le importa al cliente (sede, códigos, la ruta) no genera aviso', () => {
    const despues = { ...base, datosEnvio: { ...base.datosEnvio, sede: 'Norte', ruta: 'R-2', nroPedido: '99' } } as Entrega;
    expect(cambiosParaElCliente(base, despues)).toEqual([]);
  });
});

describe('PATCH /api/v1/entregas/:referencia avisa al cliente', () => {
  it('dentro de las 24 h: le llega el aviso con el cambio', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await e.api.post('/api/v1/entregas', pedido());
      await e.trabajar();
      await e.contesta(tel, { texto: 'hola, ¿a qué hora llega?' });
      const r = await patch(e, { producto: 'llanta Michelin' });
      expect(r.statusCode).toBe(200);
      expect(r.json().avisoCliente).toMatchObject({ enviado: true, cambios: ['su llanta Pirelli por llanta Michelin'] });
      expect(avisos(e)).toEqual([expect.stringContaining('se ha cambiado su llanta Pirelli por llanta Michelin')]);
    } finally {
      await e.cerrar();
    }
  });

  it('fuera de las 24 h (el cliente no ha escrito) no le escribe y dice por qué', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await e.api.post('/api/v1/entregas', pedido());
      const r = await patch(e, { producto: 'llanta Michelin' });
      expect(r.json().avisoCliente).toMatchObject({ enviado: false });
      expect(r.json().avisoCliente.motivo).toMatch(/24 h/);
      expect(r.json().detalle).toMatch(/No se le avisó al cliente/);
      expect(avisos(e)).toHaveLength(0);
      const guardado = (await e.repos.entregas.porTracking('CAMBIO-1'))!;
      const ev = await e.repos.entregas.eventos(guardado.id);
      expect(ev.some((x) => x.payload?.avisoCambio === true && x.payload?.enviado === false)).toBe(true);
    } finally {
      await e.cerrar();
    }
  });

  it('como mucho 2 avisos por pedido', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await e.api.post('/api/v1/entregas', pedido());
      await e.trabajar();
      await e.contesta(tel, { texto: 'hola' });
      await patch(e, { producto: 'llanta Michelin' });
      await patch(e, { producto: 'llanta Goodyear' });
      const tercero = await patch(e, { producto: 'llanta Bridgestone' });
      expect(tercero.json().avisoCliente).toMatchObject({ enviado: false });
      expect(tercero.json().avisoCliente.motivo).toMatch(/máximo/);
      expect(avisos(e)).toHaveLength(2);
    } finally {
      await e.cerrar();
    }
  });

  it('un cambio que no le importa al cliente no le escribe', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await e.api.post('/api/v1/entregas', pedido());
      await e.trabajar();
      await e.contesta(tel, { texto: 'hola' });
      const r = await patch(e, { sede: 'Norte' });
      expect(r.json().avisoCliente).toBeUndefined();
      expect(avisos(e)).toHaveLength(0);
    } finally {
      await e.cerrar();
    }
  });

  it('también cuando GSG vuelve a mandar el pedido con el producto cambiado', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await e.api.post('/api/v1/entregas', pedido());
      await e.trabajar();
      await e.contesta(tel, { texto: 'hola' });
      const r = await e.api.post<{ avisosCambio?: Array<{ referencia: string; enviado: boolean }> }>('/api/v1/entregas', pedido({ producto: 'llanta Michelin' }));
      expect(r.body.avisosCambio).toEqual([expect.objectContaining({ enviado: true })]);
      expect(avisos(e)).toHaveLength(1);
    } finally {
      await e.cerrar();
    }
  });
});
