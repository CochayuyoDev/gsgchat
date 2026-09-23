/**
 * Lo del Modulo desarrollador no sale a los webhooks de verdad (Stoky, GSG):
 * un cliente o motorizado de prueba, o un pedido PRUEBA-…, se queda en casa.
 */

import { describe, expect, it } from 'vitest';
import { esEventoDePrueba } from '../src/webhooks/despachador.js';
import { esNumeroDePrueba, numeroDePrueba } from '../src/desarrollador/numeros.js';

describe('eventos de prueba y webhooks', () => {
  it('reconoce los números y pedidos de prueba en cualquier forma de evento', () => {
    expect(esEventoDePrueba({ telefono: '51900012345', texto: 'hola' })).toBe(true);
    expect(esEventoDePrueba({ contacto: { telefono: '51900100002' } })).toBe(true);
    expect(esEventoDePrueba({ entrega: { referencia: 'PRUEBA-00007', telefono: '51987654321' } })).toBe(true);
    expect(esEventoDePrueba({ mensaje: { to: '+51900000001' } })).toBe(true);
  });

  it('no confunde a un cliente real', () => {
    expect(esEventoDePrueba({ telefono: '51987654321' })).toBe(false);
    expect(esEventoDePrueba({ telefono: '51911000001', referencia: 'P-1001' })).toBe(false);
    expect(esEventoDePrueba({ monto: 519000123456 })).toBe(false);
  });

  it('el rango reservado: 51 900 0xx xxx clientes, 51 900 1xx xxx motorizados', () => {
    expect(numeroDePrueba('cliente', 7)).toBe('51900000007');
    expect(numeroDePrueba('motorizado', 7)).toBe('51900100007');
    expect(esNumeroDePrueba('900000007')).toBe(true);
    expect(esNumeroDePrueba('51900200007')).toBe(false);
    expect(esNumeroDePrueba('51987000001')).toBe(false);
  });
});
