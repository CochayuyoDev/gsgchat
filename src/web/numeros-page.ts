import { pedidosPage } from './pedidos-page.js';
export function numerosPage(opts: { disponible: boolean; demo: boolean; nombreNegocio: string; etapa?: string }): string {
  return pedidosPage({ ...opts, numeros: true });
}
