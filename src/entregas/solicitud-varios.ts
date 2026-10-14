import { rellenar, type ContextoTexto } from './textos.js';

export const PLANTILLA_PEDIDOS_GSG = 'solicitud_ubicacion_pedidos_gsg';
const DETALLE = '📦 Producto: {producto}\n🏢 Empresa: {empresa}\n📝 Código: {tracking}\n🧾 Nro. de pedido: {nroPedido}\n💳 Método de Pago: {metodoPago}\n💰 Monto a Cobrar: {monto}\n🏠 Dirección: {direccionCompleta}';

/** Un bloque por tracking: cero es un monto válido, nunca implica «pagado». */
export function solicitudDePedidos(contextos: ContextoTexto[]) {
  if (!contextos.length) throw new Error('No hay pedidos para componer el mensaje.');
  const nombre = (contextos[0]!.nombre?.trim() || 'cliente').replace(/[\n\r\t]+/g, ' ');
  const bloques = contextos.map((ctx, i) => {
    const monto = ctx.envio?.monto?.trim();
    return `Pedido ${i + 1}\n${rellenar(DETALLE, {
      ...ctx,
      envio: { ...ctx.envio, tracking: ctx.envio?.tracking || ctx.pedido || '', monto: monto && /^\d+(\.\d+)?$/.test(monto) ? `S/ ${Number(monto).toFixed(2)}` : monto },
    })}`;
  });
  const detalles = bloques.join('\n\n');
  const cantidad = contextos.length;
  return {
    texto: `Hola, buenas tardes, ${nombre}. Somos GSG Courier. Tenemos ${cantidad} ${cantidad === 1 ? 'pedido' : 'pedidos'} para usted:\n\n${detalles}\n\nPor favor, ¿podría compartir su ubicación por WhatsApp para poder llegar sin problemas? ¡Gracias!`,
    // Las variables de texto de Meta no llevan saltos de línea.
    variables: [nombre, String(cantidad), bloques.map((b) => b.replace(/[\n\r\t]+/g, ' | ')).join(' / ')],
  };
}
