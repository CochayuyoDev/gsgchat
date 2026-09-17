/**
 * Cerrar la venta en el chat.
 *
 * Cuando el asistente tiene todo (que, cuantos, quien, a donde, como paga),
 * termina su mensaje con la marca `[PEDIDO]` y un JSON. Aqui se lee ese
 * JSON, se comprueba contra el catalogo real (el precio lo pone el catalogo,
 * nunca el modelo; un SKU que no existe se busca por nombre y si no aparece
 * se rechaza), se guarda el pedido, se anuncia (`pedido.creado`, que los
 * webhooks reparten a la tienda) y se le confirma al cliente con el resumen
 * y el total. Una persona lo ve en "Pedidos" y lo confirma o cancela.
 */

import type { Contact, Repos } from '../db/repos.js';
import type { Bus } from '../eventos/bus.js';
import type { StokyClient } from '../stoky/client.js';
import type { CatalogoTienda } from '../catalogo/tienda.js';
import type { LineaPedido, PedidoChat, PedidosRepo } from './repo.js';

export const MARCA_PEDIDO = '[PEDIDO]';

export interface PedidoDelModelo {
  items: Array<{ sku?: string; nombre?: string; cantidad?: number }>;
  nombre?: string;
  telefono?: string;
  direccion?: string;
  referencia?: string;
  pago?: string;
  notas?: string;
}

/** Saca el JSON que sigue a la marca. Devuelve el texto sin la marca ni el JSON. */
export function extraerPedido(cruda: string): { texto: string; pedido: PedidoDelModelo | null; error?: string } {
  const i = cruda.indexOf(MARCA_PEDIDO);
  if (i < 0) return { texto: cruda, pedido: null };
  const antes = cruda.slice(0, i);
  const resto = cruda.slice(i + MARCA_PEDIDO.length);
  const inicio = resto.indexOf('{');
  if (inicio < 0) return { texto: antes.trim(), pedido: null, error: 'la marca de pedido no trae datos' };
  // El primer objeto balanceado: el modelo a veces escribe algo despues.
  let nivel = 0;
  let fin = -1;
  for (let k = inicio; k < resto.length; k++) {
    const ch = resto[k];
    if (ch === '{') nivel++;
    else if (ch === '}') {
      nivel--;
      if (nivel === 0) {
        fin = k;
        break;
      }
    }
  }
  if (fin < 0) return { texto: antes.trim(), pedido: null, error: 'el JSON del pedido esta cortado' };
  const despues = resto.slice(fin + 1);
  try {
    const p = JSON.parse(resto.slice(inicio, fin + 1)) as PedidoDelModelo;
    if (!p || !Array.isArray(p.items)) return { texto: antes.trim(), pedido: null, error: 'el pedido no trae items' };
    return { texto: `${antes}${despues}`.replace(/\s+$/g, '').trim(), pedido: p };
  } catch {
    return { texto: antes.trim(), pedido: null, error: 'el JSON del pedido no se pudo leer' };
  }
}

export interface DepsPedidos {
  repos: Repos & { pedidos: PedidosRepo };
  bus?: Bus;
  catalogo?: () => CatalogoTienda | StokyClient | undefined;
  moneda?: string;
}

export interface ResultadoPedido {
  ok: boolean;
  pedido?: PedidoChat;
  /** Lo que se le dice al cliente. */
  resumen: string;
  /** Lineas que no se encontraron en el catalogo. */
  noEncontrados: string[];
}

const dinero = (n: number, moneda: string) => `${moneda === 'PEN' ? 'S/' : moneda} ${n.toFixed(2)}`;

/** Convierte lo que dijo el modelo en lineas con precios del catalogo. */
export async function resolverLineas(
  items: PedidoDelModelo['items'],
  catalogo: CatalogoTienda | StokyClient | undefined,
): Promise<{ lineas: LineaPedido[]; noEncontrados: string[] }> {
  const lineas: LineaPedido[] = [];
  const noEncontrados: string[] = [];
  for (const it of items) {
    const cantidad = Math.max(1, Math.min(99, Math.round(Number(it.cantidad ?? 1) || 1)));
    const sku = (it.sku ?? '').trim();
    const nombre = (it.nombre ?? '').trim();
    let producto: { sku: string; name: string; price: number | null; url?: string | null } | null = null;
    if (catalogo) {
      if (sku && 'porSku' in catalogo) producto = await catalogo.porSku(sku).catch(() => null);
      if (!producto && (nombre || sku)) {
        const encontrados = await catalogo.buscar(nombre || sku, 1).catch(() => []);
        producto = encontrados[0] ?? null;
      }
    }
    if (!producto) {
      // Sin catalogo, se acepta lo que dijo el cliente pero sin precio: lo pone una persona.
      if (!catalogo && (nombre || sku)) {
        lineas.push({ sku: sku || nombre, nombre: nombre || sku, cantidad, precio: null, subtotal: null });
      } else {
        noEncontrados.push(nombre || sku || '(sin nombre)');
      }
      continue;
    }
    const precio = producto.price;
    lineas.push({ sku: producto.sku, nombre: producto.name, cantidad, precio, subtotal: precio != null ? precio * cantidad : null, url: producto.url ?? null });
  }
  return { lineas, noEncontrados };
}

export function resumenDePedido(p: Pick<PedidoChat, 'items' | 'total' | 'moneda' | 'nombre' | 'direccion' | 'pago'>): string {
  const lineas = p.items.map((l) => `• ${l.cantidad} x ${l.nombre}${l.subtotal != null ? ` — ${dinero(l.subtotal, p.moneda)}` : ''}`).join('\n');
  const total = p.items.every((l) => l.subtotal != null) ? `Total: ${dinero(p.total, p.moneda)}` : 'Total: te lo confirmamos en un momento';
  const datos = [p.nombre ? `A nombre de ${p.nombre}` : null, p.direccion ? `Entrega: ${p.direccion}` : null, p.pago ? `Pago: ${p.pago}` : null].filter(Boolean).join(' · ');
  return `Tu pedido quedó registrado:\n${lineas}\n${total}${datos ? `\n${datos}` : ''}\nEn un momento una persona del equipo te confirma.`;
}

export async function registrarPedido(contact: Contact, pedido: PedidoDelModelo, deps: DepsPedidos, origen = 'ia'): Promise<ResultadoPedido> {
  const catalogo = deps.catalogo?.();
  const { lineas, noEncontrados } = await resolverLineas(pedido.items, catalogo);
  if (!lineas.length) {
    return { ok: false, resumen: 'No encontré esos productos en nuestro catálogo. ¿Me dices el nombre tal como aparece en la web?', noEncontrados };
  }
  const moneda = deps.moneda ?? 'PEN';
  const total = lineas.reduce((s, l) => s + (l.subtotal ?? 0), 0);
  const creado = await deps.repos.pedidos.crear({
    contactId: contact.id,
    items: lineas,
    total,
    moneda,
    nombre: (pedido.nombre ?? contact.name ?? '').trim() || null,
    telefono: (pedido.telefono ?? '').trim() || (contact.phone.startsWith('web-') ? null : contact.phone),
    direccion: (pedido.direccion ?? '').trim() || null,
    referencia: (pedido.referencia ?? '').trim() || null,
    pago: (pedido.pago ?? '').trim() || null,
    notas: [pedido.notas?.trim(), noEncontrados.length ? `No encontrados en el catálogo: ${noEncontrados.join(', ')}` : null].filter(Boolean).join(' · ') || null,
    origen,
  });
  deps.bus?.emitir('pedido.creado', {
    pedido: { id: creado.id, estado: creado.estado, items: creado.items, total: creado.total, moneda: creado.moneda, nombre: creado.nombre, telefono: creado.telefono, direccion: creado.direccion, referencia: creado.referencia, pago: creado.pago, notas: creado.notas, origen: creado.origen },
    contacto: { id: contact.id, telefono: contact.phone, nombre: contact.name },
    fecha: creado.createdAt.toISOString(),
  });
  let resumen = resumenDePedido(creado);
  if (noEncontrados.length) resumen += `\n(No encontré: ${noEncontrados.join(', ')}; lo revisa una persona.)`;
  return { ok: true, pedido: creado, resumen, noEncontrados };
}
