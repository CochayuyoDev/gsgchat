/**
 * Aviso al cliente cuando GSG cambia datos de su pedido (pedido de GSG, 12/11).
 *
 * Ejemplo: «Se ha cambiado su llanta Pirelli por una llanta Michelin».
 *
 * Reglas:
 *  - Solo dentro de la ventana de 24 h: el cliente tiene que haber escrito en
 *    las ultimas 24 horas. Fuera de ella no se le escribe (seria una plantilla
 *    de pago y su texto no dice «se cambio»): queda anotado por que no salio.
 *  - Como mucho 2 avisos por pedido.
 *  - Solo lo que al cliente le importa: producto, detalle, monto, metodo de
 *    pago, direccion, distrito y horario de entrega. El resto (codigos
 *    internos, sede, la ruta...) cambia sin avisarle.
 *  - Sale como texto por el emisor de siempre: si la ruta esta inactiva, el
 *    chat esta cerrado y no sale (ver src/rutas-gsg).
 *  - Cada intento queda en la bitacora del pedido, salga o no, con el motivo.
 */
import type { Repos } from '../db/repos.js';
import type { Sender } from '../outbound/sender.js';
import type { Entrega } from './repo.js';

export const MAX_AVISOS_CAMBIO = 2;
export const VENTANA_AVISO_MS = 24 * 60 * 60 * 1000;

export interface ResultadoAvisoCambio {
  enviado: boolean;
  /** Que cambio, en palabras (vacio si no cambio nada que le importe al cliente). */
  cambios: string[];
  motivo: string;
}

const t = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const horario = (e: Entrega): string => {
  const d = e.datosEnvio;
  return d?.horarioEntregaDesde && d?.horarioEntregaHasta ? `${d.horarioEntregaDesde} a ${d.horarioEntregaHasta}${d.horarioEntregaFechaDesde ? ` (${d.horarioEntregaFechaDesde})` : ''}` : '';
};
const corto = (s: string) => (s.length > 120 ? `${s.slice(0, 117)}…` : s);

/** Lo que cambio entre las dos versiones del pedido, dicho para el cliente. */
export function cambiosParaElCliente(antes: Entrega, despues: Entrega): string[] {
  const salida: string[] = [];
  const par = (a: string, b: string, frase: (a: string, b: string) => string) => {
    if (a !== b && b) salida.push(frase(corto(a), corto(b)));
  };
  par(t(antes.datosEnvio?.producto), t(despues.datosEnvio?.producto), (a, b) => (a ? `su ${a} por ${b}` : `el producto: ahora es ${b}`));
  par(t(antes.datosEnvio?.detalleProducto), t(despues.datosEnvio?.detalleProducto), (a, b) => (a ? `el detalle del producto de «${a}» a «${b}»` : `el detalle del producto: ${b}`));
  par(t(antes.datosEnvio?.monto), t(despues.datosEnvio?.monto), (a, b) => (a ? `el monto a pagar de S/ ${a} a S/ ${b}` : `el monto a pagar: S/ ${b}`));
  par(t(antes.datosEnvio?.metodoPago), t(despues.datosEnvio?.metodoPago), (a, b) => (a ? `el método de pago de ${a} a ${b}` : `el método de pago: ${b}`));
  par(t(antes.direccion), t(despues.direccion), (a, b) => (a ? `la dirección de entrega de «${a}» a «${b}»` : `la dirección de entrega: ${b}`));
  par(t(antes.distrito), t(despues.distrito), (a, b) => (a ? `el distrito de ${a} a ${b}` : `el distrito: ${b}`));
  par(horario(antes), horario(despues), (a, b) => (a ? `el horario de entrega de ${a} a ${b}` : `el horario de entrega: ${b}`));
  return salida;
}

/** El texto del aviso. */
export function textoAvisoCambio(e: Entrega, cambios: string[]): string {
  const nombre = t(e.nombre).split(/\s+/)[0] || '';
  const codigo = e.datosEnvio?.tracking ?? e.referencia;
  const lista = cambios.length === 1 ? cambios[0]! : `${cambios.slice(0, -1).join('; ')} y ${cambios[cambios.length - 1]!}`;
  return `Hola${nombre ? ` ${nombre}` : ''}, le informamos un cambio en su pedido ${codigo}: se ha cambiado ${lista}. Si tiene alguna duda, responda este mensaje.`;
}

const FINALES = new Set(['entregada', 'terminada', 'cancelada']);

export async function avisarCambioDePedido(
  deps: { repos: Repos; sender: Sender; ahora?: () => Date },
  antes: Entrega,
  despues: Entrega,
): Promise<ResultadoAvisoCambio> {
  const ahora = deps.ahora ?? (() => new Date());
  const cambios = cambiosParaElCliente(antes, despues);
  if (!cambios.length) return { enviado: false, cambios, motivo: 'No cambió nada que le importe al cliente (producto, monto, pago, dirección u horario): no se le avisa.' };
  const anotar = async (enviado: boolean, motivo: string, extra: Record<string, unknown> = {}) => {
    await deps.repos.entregas
      .registrarEvento(despues.id, 'nota', enviado ? `Se le avisó al cliente del cambio: ${cambios.join('; ')}.` : `No se le avisó del cambio (${cambios.join('; ')}): ${motivo}`, { avisoCambio: true, enviado, cambios, ...extra })
      .catch(() => undefined);
    return { enviado, cambios, motivo };
  };
  if (FINALES.has(despues.estado)) return anotar(false, `el pedido ya está ${despues.estado}.`);
  if (!despues.phone) return anotar(false, 'el pedido no tiene teléfono.');
  const previos = (await deps.repos.entregas.eventos(despues.id, 500).catch(() => []))
    .filter((ev) => ev.payload?.avisoCambio === true && ev.payload?.enviado === true).length;
  if (previos >= MAX_AVISOS_CAMBIO) return anotar(false, `ya se le mandaron ${MAX_AVISOS_CAMBIO} avisos de cambio por este pedido (el máximo).`);
  const contacto = await deps.repos.contacts.getByPhone(despues.phone).catch(() => null);
  const ultima = contacto?.lastInboundAt ? new Date(contacto.lastInboundAt).getTime() : null;
  if (!ultima || ahora().getTime() - ultima > VENTANA_AVISO_MS) {
    return anotar(false, ultima
      ? `el cliente escribió por última vez hace más de 24 h: fuera de la ventana no se le escribe.`
      : 'el cliente todavía no ha escrito: fuera de la ventana de 24 h no se le escribe.');
  }
  const texto = textoAvisoCambio(despues, cambios);
  try {
    const salida = await deps.sender.send({ phone: despues.phone, kind: 'freeform', category: 'UTILITY', text: texto, origen: 'sistema', respetarVentana: true });
    if (salida.ok) return anotar(true, 'Enviado.', { wamid: salida.wamid, texto });
    const motivo = 'blocked' in salida && salida.blocked ? salida.reason : 'error' in salida ? salida.error : 'el envío falló';
    return anotar(false, `no salió: ${motivo}.`, { texto });
  } catch (error) {
    return anotar(false, `no salió: ${error instanceof Error ? error.message : String(error)}.`, { texto });
  }
}
