/**
 * Los numeros del Modulo desarrollador: un rango reservado y marcado.
 *
 *   clientes de prueba     51 000 0xx xxx   (51000000000 - 51000099999)
 *   motorizados de prueba  51 000 1xx xxx   (51000100000 - 51000199999)
 *
 * Ningun numero de Peru empieza por 0 despues del 51: el rango no puede
 * coincidir con nadie real. Antes era 51 000 0/1…, que SI son celulares de
 * verdad (el 26/09 un cliente real, 900 048 813, no recibia nada porque el
 * sistema lo tomaba por uno de prueba).
 *
 * NADA dirigido a estos numeros sale por WhatsApp, este encendido o no el
 * modo prueba: el sender los trata como a un visitante de la web (el mensaje
 * se guarda en el hilo como enviado y no pasa por el proveedor ni gasta el
 * cupo ni el ritmo del numero real). Ver src/outbound/sender.ts.
 *
 * Los clientes de prueba de siempre (987 000 0xx, src/entregas/datos-de-prueba.ts)
 * no estan en este rango: los usa el simulador de GSG y las pruebas antiguas.
 */

export const PREFIJO_CLIENTE_PRUEBA = '510000';
export const PREFIJO_MOTORIZADO_PRUEBA = '510001';

/** Solo digitos, con el 51 delante si venia sin el. */
function normal(telefono: string): string {
  const d = String(telefono ?? '').replace(/\D+/g, '');
  return d.length === 9 ? `51${d}` : d;
}

export function esNumeroDePrueba(telefono: string | null | undefined): boolean {
  return esClienteDePrueba(telefono) || esMotorizadoDePrueba(telefono);
}

export function esClienteDePrueba(telefono: string | null | undefined): boolean {
  const d = normal(telefono ?? '');
  return d.length === 11 && d.startsWith(PREFIJO_CLIENTE_PRUEBA);
}

export function esMotorizadoDePrueba(telefono: string | null | undefined): boolean {
  const d = normal(telefono ?? '');
  return d.length === 11 && d.startsWith(PREFIJO_MOTORIZADO_PRUEBA);
}

/** El numero de prueba n (0..99999) de clientes o de motorizados. */
export function numeroDePrueba(tipo: 'cliente' | 'motorizado', n: number): string {
  const prefijo = tipo === 'cliente' ? PREFIJO_CLIENTE_PRUEBA : PREFIJO_MOTORIZADO_PRUEBA;
  return `${prefijo}${String(Math.max(0, Math.min(99_999, Math.floor(n)))).padStart(5, '0')}`;
}

/** Las referencias de los pedidos de prueba empiezan asi: se reconocen y se borran por aqui. */
export const PREFIJO_REFERENCIA_PRUEBA = 'PRUEBA-';
