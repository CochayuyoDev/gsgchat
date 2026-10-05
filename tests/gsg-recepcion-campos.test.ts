import { describe, it, expect } from 'vitest';
import { crearEscenarioEntregas } from './escenario-entregas.js';

describe('recepcion completa de pedidos GSG', () => {
  it('guarda todos los campos, no envia WhatsApp en la recepcion y no duplica el tracking', async () => {
    const esc = await crearEscenarioEntregas();
    try {
      const pedido = { tracking: 'GSG-COMPLETO-1', cliente: 'Ana', telefono: '987654321',
        direccion: 'Av. Lima 123', distrito: 'Lince', empresa: 'Tienda Uno',
        driver: { nombre: 'Luis', telefono: '999888777' }, costServ: 12.5,
        referenciaDireccion: 'Frente al parque', fecRegistro: '2026-10-02T08:00:00-05:00',
        fecRuta: '2026-10-03', observacionCliente: 'Llamar antes', detalleProducto: 'Caja sellada',
        telefono2: '988777666', producto: 'Zapatos', tamano: '40', cantBultos: 2,
        metodoPago: 'Efectivo', montoCobrar: 85, clientePagaDelivery: false,
        sede: 'Lima', tipoRuta: 'Agencia', nroDocumento: '00123456',
        agenciaNombre: 'Agencia Uno', agenciaDestino: 'Huancayo, Av. Uno 123', pagoEnDestino: true };
      const antes = esc.wa.sent.length;
      const r = await esc.api.post<{ creadas: Array<Record<string, unknown>> }>('/api/v1/entregas', pedido);
      expect(r.status).toBe(201);
      expect(r.body.creadas[0]).toMatchObject({ referencia: pedido.tracking, nombre: 'Ana',
        costServ: '12.50', monto: '85.00', clientePagaDelivery: 'no', pagoEnDestino: 'si',
        nroDocumento: '00123456', cantBultos: '2', agenciaDestino: pedido.agenciaDestino });
      const e = await esc.entrega(pedido.tracking);
      expect(e?.datosEnvio).toMatchObject({ referenciaDireccion: pedido.referenciaDireccion, fecRegistro: pedido.fecRegistro, fecRuta: pedido.fecRuta, observacionCliente: pedido.observacionCliente, detalleProducto: pedido.detalleProducto, telefono2: pedido.telefono2, tamano: pedido.tamano, sede: pedido.sede, tipoRuta: pedido.tipoRuta, nroDocumento: pedido.nroDocumento, agenciaNombre: pedido.agenciaNombre, agenciaDestino: pedido.agenciaDestino, motorizadoNombre: 'Luis' });
      expect(esc.wa.sent.length).toBe(antes);
      const otra = await esc.api.post<{ repetidas: string[] }>('/api/v1/entregas', pedido);
      expect(otra.body.repetidas).toContain(pedido.tracking);
      expect(esc.wa.sent.length).toBe(antes);
    } finally { await esc.cerrar(); }
  });
});
