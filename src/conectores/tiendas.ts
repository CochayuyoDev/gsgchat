/**
 * Lo que manda cada tienda, traducido a una sola forma.
 *
 * WooCommerce y Shopify avisan de un pedido con JSON distintos, cabeceras
 * distintas y firmas distintas. Aqui se lee cada uno y sale lo mismo: que
 * paso (`pedido.creado`, `pedido.enviado`...), el numero del pedido, el
 * total, el nombre y el telefono del cliente. El resto del sistema (las
 * reglas, el envio) no sabe de que tienda vino.
 *
 * Las firmas: las dos son HMAC sha256 del cuerpo crudo, en base64.
 *  - WooCommerce: `X-WC-Webhook-Signature`, con el secreto que se escribe al
 *    crear el webhook en WooCommerce > Ajustes > Avanzado > Webhooks.
 *  - Shopify: `X-Shopify-Hmac-Sha256`, con el secreto que Shopify ensena en
 *    Configuracion > Notificaciones > Webhooks.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export type TipoTienda = 'woocommerce' | 'shopify';
export const TIPOS_TIENDA: TipoTienda[] = ['woocommerce', 'shopify'];

export type EventoTienda =
  | 'pedido.creado'
  | 'pedido.pagado'
  | 'pedido.enviado'
  | 'pedido.completado'
  | 'pedido.cancelado'
  | 'pedido.actualizado';

export const EVENTOS_TIENDA: EventoTienda[] = ['pedido.creado', 'pedido.pagado', 'pedido.enviado', 'pedido.completado', 'pedido.cancelado', 'pedido.actualizado'];

export const DESCRIPCION_EVENTOS_TIENDA: Record<EventoTienda, string> = {
  'pedido.creado': 'Entro un pedido nuevo',
  'pedido.pagado': 'El pedido quedo pagado (WooCommerce: pasa a "procesando"; Shopify: orders/paid)',
  'pedido.enviado': 'El pedido salio (Shopify: orders/fulfilled; WooCommerce no lo distingue del completado)',
  'pedido.completado': 'El pedido se dio por terminado',
  'pedido.cancelado': 'El pedido se cancelo',
  'pedido.actualizado': 'Cualquier otro cambio del pedido (se usa poco: avisar de todo cansa al cliente)',
};

/** Un pedido tal como lo ve el resto del sistema. */
export interface PedidoTienda {
  evento: EventoTienda;
  /** El evento tal como lo llamo la tienda: "order.updated", "orders/paid". */
  eventoOrigen: string;
  numero: string;
  estado: string;
  total: string;
  moneda: string;
  nombre: string | null;
  /** Tal como vino: se normaliza despues con el plan de numeracion. */
  telefono: string | null;
  /** Numero o enlace de seguimiento, si la tienda lo dio. */
  seguimiento: string | null;
  /** "2 x Zapato negro 40, 1 x Correa" */
  items: string;
}

export interface LecturaTienda {
  /** Un ping de prueba de la tienda: se contesta 200 y no hay nada que hacer. */
  ping?: boolean;
  pedido?: PedidoTienda;
  /** Un evento que no es de pedidos (un producto, un cliente): se ignora. */
  ignorado?: string;
}

// ------------------------------------------------------------------ firma

export function firmaBase64(secreto: string, cuerpo: string | Buffer): string {
  return createHmac('sha256', secreto).update(cuerpo).digest('base64');
}

export function firmaValida(secreto: string, cuerpo: string | Buffer, dada: string | undefined): boolean {
  if (!dada || !secreto) return false;
  const esperada = Buffer.from(firmaBase64(secreto, cuerpo));
  const recibida = Buffer.from(dada.trim());
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

/** La cabecera donde cada tienda pone su firma, en minusculas (asi las da Fastify). */
export const CABECERA_FIRMA: Record<TipoTienda, string> = {
  woocommerce: 'x-wc-webhook-signature',
  shopify: 'x-shopify-hmac-sha256',
};

// ------------------------------------------------------------ utilidades

const texto = (v: unknown): string => (v == null ? '' : String(v)).trim();
const primero = (...valores: unknown[]): string | null => {
  for (const v of valores) {
    const t = texto(v);
    if (t) return t;
  }
  return null;
};

function resumenItems(items: unknown, nombre: 'name' | 'title'): string {
  if (!Array.isArray(items)) return '';
  return items
    .slice(0, 6)
    .map((it) => {
      const o = (it ?? {}) as Record<string, unknown>;
      const q = Number(o.quantity ?? 1) || 1;
      return `${q} x ${texto(o[nombre]) || 'articulo'}`;
    })
    .join(', ');
}

// ---------------------------------------------------------- WooCommerce

/**
 * WooCommerce manda `X-WC-Webhook-Topic` (order.created, order.updated,
 * order.deleted...) y el pedido entero. Al crear el webhook manda ademas un
 * ping con `webhook_id` y nada mas.
 */
export function leerWooCommerce(cabeceras: Record<string, string | undefined>, cuerpo: unknown): LecturaTienda {
  const o = (cuerpo ?? {}) as Record<string, unknown>;
  const topic = texto(cabeceras['x-wc-webhook-topic']);
  if (!topic && o.webhook_id != null && o.id == null) return { ping: true };
  if (!topic.startsWith('order.')) return { ignorado: topic || 'sin topic' };
  if (topic === 'order.deleted') return { ignorado: topic };

  const estado = texto(o.status).toLowerCase();
  let evento: EventoTienda;
  if (topic === 'order.created') evento = 'pedido.creado';
  else if (estado === 'processing') evento = 'pedido.pagado';
  else if (estado === 'completed') evento = 'pedido.completado';
  else if (estado === 'cancelled' || estado === 'refunded' || estado === 'failed') evento = 'pedido.cancelado';
  else evento = 'pedido.actualizado';

  const billing = (o.billing ?? {}) as Record<string, unknown>;
  const shipping = (o.shipping ?? {}) as Record<string, unknown>;
  const nombre = [texto(billing.first_name), texto(billing.last_name)].filter(Boolean).join(' ') || null;
  // El numero de seguimiento lo ponen plugins, en meta_data; se mira lo mas comun.
  const meta = Array.isArray(o.meta_data) ? (o.meta_data as Array<Record<string, unknown>>) : [];
  const seguimiento = primero(...meta.filter((m) => /tracking/i.test(texto(m.key))).map((m) => m.value));

  return {
    pedido: {
      evento,
      eventoOrigen: topic,
      numero: primero(o.number, o.id) ?? '',
      estado,
      total: texto(o.total),
      moneda: texto(o.currency),
      nombre,
      telefono: primero(billing.phone, shipping.phone),
      seguimiento,
      items: resumenItems(o.line_items, 'name'),
    },
  };
}

// -------------------------------------------------------------- Shopify

/**
 * Shopify manda `X-Shopify-Topic` (orders/create, orders/paid,
 * orders/fulfilled, orders/cancelled, orders/updated...) y el pedido.
 */
export function leerShopify(cabeceras: Record<string, string | undefined>, cuerpo: unknown): LecturaTienda {
  const o = (cuerpo ?? {}) as Record<string, unknown>;
  const topic = texto(cabeceras['x-shopify-topic']);
  if (!topic.startsWith('orders/')) return { ignorado: topic || 'sin topic' };
  if (topic === 'orders/delete') return { ignorado: topic };

  const porTopic: Record<string, EventoTienda> = {
    'orders/create': 'pedido.creado',
    'orders/paid': 'pedido.pagado',
    'orders/fulfilled': 'pedido.enviado',
    'orders/cancelled': 'pedido.cancelado',
  };
  const evento = porTopic[topic] ?? 'pedido.actualizado';

  const cliente = (o.customer ?? {}) as Record<string, unknown>;
  const facturacion = (o.billing_address ?? {}) as Record<string, unknown>;
  const envio = (o.shipping_address ?? {}) as Record<string, unknown>;
  const nombre =
    [texto(cliente.first_name), texto(cliente.last_name)].filter(Boolean).join(' ') ||
    [texto(envio.first_name), texto(envio.last_name)].filter(Boolean).join(' ') ||
    null;
  const fulfillments = Array.isArray(o.fulfillments) ? (o.fulfillments as Array<Record<string, unknown>>) : [];
  const seguimiento = primero(...fulfillments.flatMap((f) => [f.tracking_url, f.tracking_number]));

  return {
    pedido: {
      evento,
      eventoOrigen: topic,
      numero: (primero(o.name, o.order_number, o.id) ?? '').replace(/^#/, ''),
      estado: [texto(o.financial_status), texto(o.fulfillment_status)].filter(Boolean).join('/'),
      total: texto(o.total_price),
      moneda: texto(o.currency),
      nombre,
      telefono: primero(o.phone, envio.phone, facturacion.phone, cliente.phone),
      seguimiento,
      items: resumenItems(o.line_items, 'title'),
    },
  };
}

export function leerTienda(tipo: TipoTienda, cabeceras: Record<string, string | undefined>, cuerpo: unknown): LecturaTienda {
  return tipo === 'woocommerce' ? leerWooCommerce(cabeceras, cuerpo) : leerShopify(cabeceras, cuerpo);
}

// --------------------------------------------------------- las variables

/** Lo que se puede escribir en una regla: `{numero}`, `{nombre}`... */
export const VARIABLES_PEDIDO = ['numero', 'nombre', 'total', 'moneda', 'estado', 'tienda', 'seguimiento', 'items'] as const;

export function rellenar(texto: string, pedido: PedidoTienda, tienda: string): string {
  const valores: Record<string, string> = {
    numero: pedido.numero,
    nombre: pedido.nombre ?? '',
    total: pedido.total,
    moneda: pedido.moneda,
    estado: pedido.estado,
    tienda,
    seguimiento: pedido.seguimiento ?? '',
    items: pedido.items,
  };
  return texto.replace(/\{(\w+)\}/g, (todo, clave: string) => (clave in valores ? valores[clave]! : todo));
}
