import { expect, it } from 'vitest';
import { calcularVencimientoClave } from '../src/web/vencimiento-clave.js';
const ahora = new Date(2026, 9, 9, 10, 0);
it('sin vencimiento ignora la fecha anterior', () => {
  expect(calcularVencimientoClave('nunca', '01/01/2020', ahora)).toBeNull();
});
it('acepta fecha escrita con hora o con fin de día por defecto', () => {
  expect(calcularVencimientoClave('fecha', '10/10/2026', ahora)).toBe(new Date(2026,9,10,23,59).toISOString());
  expect(calcularVencimientoClave('fecha', '10/10/2026 15:30', ahora)).toBe(new Date(2026,9,10,15,30).toISOString());
});
it('los plazos relativos conservan la hora y avanzan los días', () => {
  for (const plazo of ['7','30','90','365']) {
    const esperada = new Date(ahora); esperada.setDate(esperada.getDate() + Number(plazo));
    expect(calcularVencimientoClave(plazo, '', ahora)).toBe(esperada.toISOString());
  }
});
it('rechaza fechas imposibles, horas inválidas, formatos y fechas pasadas', () => {
  for (const fecha of ['31/02/2027', '10/10/2026 24:00', '10/10/2026 12:70', '2026-10-10', '08/10/2026', '']) expect(() => calcularVencimientoClave('fecha', fecha, ahora)).toThrow();
});
