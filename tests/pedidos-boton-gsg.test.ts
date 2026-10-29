import { describe, expect, it } from 'vitest';
import { pedidosPage } from '../src/web/pedidos-page.js';

// El marco de la app lleva data-gsg="1" con GSG conectado (src/web/shell.ts). Si
// Pedidos enganchaba «Enviar a GSG» a cualquier [data-gsg], ese marco recibía el
// clic: pulsar «Detalle» (o cualquier cosa) mandaba a GSG el pedido «1».
describe('«Enviar a GSG» en Pedidos', () => {
  it('solo lo tienen los botones de cada pedido, no el marco de la app', () => {
    const html = pedidosPage({ disponible: true, demo: false, nombreNegocio: 'Prueba' });
    expect(html).toContain("querySelectorAll('button[data-gsg]')");
    expect(html).not.toContain("querySelectorAll('[data-gsg]')");
  });
});
