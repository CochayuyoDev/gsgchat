/**
 * Pedidos tomados en el chat: lo que el asistente (o una persona) cerro en
 * la conversacion, con sus lineas y su total.
 */

import type { Pool } from '../db/pool.js';

export type EstadoPedido = 'nuevo' | 'confirmado' | 'cancelado' | 'enviado_tienda';

export interface LineaPedido {
  sku: string;
  nombre: string;
  cantidad: number;
  precio: number | null;
  subtotal: number | null;
  url?: string | null;
}

export interface PedidoChat {
  id: number;
  contactId: string;
  estado: EstadoPedido;
  items: LineaPedido[];
  total: number;
  moneda: string;
  nombre: string | null;
  telefono: string | null;
  direccion: string | null;
  referencia: string | null;
  pago: string | null;
  notas: string | null;
  origen: string;
  externoId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NuevoPedido {
  contactId: string;
  items: LineaPedido[];
  total: number;
  moneda?: string;
  nombre?: string | null;
  telefono?: string | null;
  direccion?: string | null;
  referencia?: string | null;
  pago?: string | null;
  notas?: string | null;
  origen?: string;
}

export interface PedidoConContacto extends PedidoChat {
  contactoTelefono: string;
  contactoNombre: string | null;
}

export interface PedidosRepo {
  crear(p: NuevoPedido): Promise<PedidoChat>;
  obtener(id: number): Promise<PedidoConContacto | null>;
  listar(q: { estado?: EstadoPedido; limit: number; offset: number }): Promise<{ items: PedidoConContacto[]; total: number }>;
  porContacto(contactId: string, limit: number): Promise<PedidoChat[]>;
  cambiarEstado(id: number, estado: EstadoPedido, externoId?: string | null): Promise<PedidoChat | null>;
  contarPorEstado(): Promise<Record<string, number>>;
}

interface Row {
  id: number;
  contact_id: string;
  estado: EstadoPedido;
  items: LineaPedido[] | string;
  total: string | number;
  moneda: string;
  nombre: string | null;
  telefono: string | null;
  direccion: string | null;
  referencia: string | null;
  pago: string | null;
  notas: string | null;
  origen: string;
  externo_id: string | null;
  created_at: Date;
  updated_at: Date;
  contacto_telefono?: string;
  contacto_nombre?: string | null;
}

const deFila = (r: Row): PedidoConContacto => ({
  id: r.id,
  contactId: r.contact_id,
  estado: r.estado,
  items: typeof r.items === 'string' ? (JSON.parse(r.items) as LineaPedido[]) : r.items,
  total: Number(r.total),
  moneda: r.moneda,
  nombre: r.nombre,
  telefono: r.telefono,
  direccion: r.direccion,
  referencia: r.referencia,
  pago: r.pago,
  notas: r.notas,
  origen: r.origen,
  externoId: r.externo_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  contactoTelefono: r.contacto_telefono ?? '',
  contactoNombre: r.contacto_nombre ?? null,
});

const CON_CONTACTO = `select p.*, c.phone as contacto_telefono, c.name as contacto_nombre from pedidos_chat p join contacts c on c.id = p.contact_id`;

export function createPedidosRepo(pool: Pool): PedidosRepo {
  return {
    async crear(p) {
      const { rows } = await pool.query<Row>(
        `insert into pedidos_chat (contact_id, items, total, moneda, nombre, telefono, direccion, referencia, pago, notas, origen)
         values ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
        [p.contactId, JSON.stringify(p.items), p.total, p.moneda ?? 'PEN', p.nombre ?? null, p.telefono ?? null, p.direccion ?? null, p.referencia ?? null, p.pago ?? null, p.notas ?? null, p.origen ?? 'ia'],
      );
      return deFila(rows[0]!);
    },
    async obtener(id) {
      const { rows } = await pool.query<Row>(`${CON_CONTACTO} where p.id = $1`, [id]);
      return rows[0] ? deFila(rows[0]) : null;
    },
    async listar(q) {
      const params: unknown[] = [];
      let where = '';
      if (q.estado) {
        params.push(q.estado);
        where = `where p.estado = $${params.length}`;
      }
      const { rows: cuenta } = await pool.query<{ n: number }>(`select count(*)::int as n from pedidos_chat p ${where}`, params);
      params.push(q.limit, q.offset);
      const { rows } = await pool.query<Row>(`${CON_CONTACTO} ${where} order by p.id desc limit $${params.length - 1} offset $${params.length}`, params);
      return { items: rows.map(deFila), total: cuenta[0]?.n ?? 0 };
    },
    async porContacto(contactId, limit) {
      const { rows } = await pool.query<Row>(`select * from pedidos_chat where contact_id = $1 order by id desc limit $2`, [contactId, limit]);
      return rows.map(deFila);
    },
    async cambiarEstado(id, estado, externoId) {
      const { rows } = await pool.query<Row>(
        `update pedidos_chat set estado = $2, externo_id = coalesce($3, externo_id), updated_at = now() where id = $1 returning *`,
        [id, estado, externoId ?? null],
      );
      return rows[0] ? deFila(rows[0]) : null;
    },
    async contarPorEstado() {
      const { rows } = await pool.query<{ estado: string; n: number }>(`select estado, count(*)::int as n from pedidos_chat group by estado`);
      return Object.fromEntries(rows.map((r) => [r.estado, r.n]));
    },
  };
}
