/** Doble en memoria de los pedidos tomados en el chat. */

import type { Contact } from '../src/db/repos.js';
import type { PedidoChat, PedidoConContacto, PedidosRepo } from '../src/pedidos/repo.js';

export interface FakePedidos extends PedidosRepo {
  _pedidos: PedidoChat[];
}

let seq = 1;

export function createFakePedidos(contactos: () => Contact[]): FakePedidos {
  const pedidos: PedidoChat[] = [];
  const conContacto = (p: PedidoChat): PedidoConContacto => {
    const c = contactos().find((x) => x.id === p.contactId);
    return { ...p, contactoTelefono: c?.phone ?? '', contactoNombre: c?.name ?? null };
  };
  return {
    _pedidos: pedidos,
    async crear(p) {
      const ahora = new Date();
      const nuevo: PedidoChat = {
        id: seq++,
        contactId: p.contactId,
        estado: 'nuevo',
        items: p.items,
        total: p.total,
        moneda: p.moneda ?? 'PEN',
        nombre: p.nombre ?? null,
        telefono: p.telefono ?? null,
        direccion: p.direccion ?? null,
        referencia: p.referencia ?? null,
        pago: p.pago ?? null,
        notas: p.notas ?? null,
        origen: p.origen ?? 'ia',
        externoId: null,
        createdAt: ahora,
        updatedAt: ahora,
      };
      pedidos.push(nuevo);
      return { ...nuevo };
    },
    async obtener(id) {
      const p = pedidos.find((x) => x.id === id);
      return p ? conContacto(p) : null;
    },
    async listar(q) {
      const todos = pedidos.filter((p) => !q.estado || p.estado === q.estado).sort((a, b) => b.id - a.id);
      return { items: todos.slice(q.offset, q.offset + q.limit).map(conContacto), total: todos.length };
    },
    async porContacto(contactId, limit) {
      return pedidos.filter((p) => p.contactId === contactId).sort((a, b) => b.id - a.id).slice(0, limit);
    },
    async cambiarEstado(id, estado, externoId) {
      const p = pedidos.find((x) => x.id === id);
      if (!p) return null;
      p.estado = estado;
      if (externoId) p.externoId = externoId;
      p.updatedAt = new Date();
      return { ...p };
    },
    async contarPorEstado() {
      const out: Record<string, number> = {};
      for (const p of pedidos) out[p.estado] = (out[p.estado] ?? 0) + 1;
      return out;
    },
  };
}
