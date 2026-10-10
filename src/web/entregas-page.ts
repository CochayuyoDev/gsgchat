import { pedidosPage } from './pedidos-page.js';
export function entregasPage(opts: { disponible: boolean; configured: boolean; demo: boolean; nombreNegocio: string }): string {
  return pedidosPage(opts);
}
