/** Doble en memoria de las tiendas del superadministrador. */

import type { AvisoTienda, PagoTienda, Tienda, TiendasRepo } from '../src/tiendas/repo.js';

export interface FakeTiendas extends TiendasRepo {
  _tiendas: Tienda[];
  _pagos: PagoTienda[];
  _avisos: Array<AvisoTienda & { tiendaId: string }>;
  _config: Map<string, unknown>;
}

let seq = 1;
let seqPago = 1;

export function createFakeTiendas(): FakeTiendas {
  const tiendas: Tienda[] = [];
  const pagos: PagoTienda[] = [];
  const avisos: Array<AvisoTienda & { tiendaId: string }> = [];
  const config = new Map<string, unknown>();
  const copia = (t: Tienda): Tienda => ({ ...t, membresia: JSON.parse(JSON.stringify(t.membresia)), estado: t.estado ? { ...t.estado } : null });
  const copiaPago = (p: PagoTienda, conImagen: boolean): PagoTienda => ({ ...p, imagen: conImagen ? p.imagen : null });
  return {
    _tiendas: tiendas,
    _pagos: pagos,
    _avisos: avisos,
    _config: config,
    async crear(input) {
      const ahora = new Date();
      const t: Tienda = { id: `tienda${seq++}`, slug: input.slug, nombre: input.nombre, url: input.url ?? null, contacto: input.contacto ?? null, notas: input.notas ?? null, membresia: input.membresia, tokenHash: input.tokenHash, tokenPrefijo: input.tokenPrefijo, ultimaConsultaAt: null, ultimaConsultaIp: null, estado: null, estadoAt: null, creadoPor: input.creadoPor ?? null, createdAt: ahora, updatedAt: ahora };
      tiendas.push(t);
      return copia(t);
    },
    async porId(id) {
      const t = tiendas.find((x) => x.id === id);
      return t ? copia(t) : null;
    },
    async porSlug(slug) {
      const t = tiendas.find((x) => x.slug === slug);
      return t ? copia(t) : null;
    },
    async listar() {
      return [...tiendas].sort((a, b) => a.nombre.toLowerCase().localeCompare(b.nombre.toLowerCase())).map(copia);
    },
    async actualizar(id, patch) {
      const t = tiendas.find((x) => x.id === id);
      if (!t) return null;
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) (t as unknown as Record<string, unknown>)[k] = v;
      t.updatedAt = new Date();
      return copia(t);
    },
    async borrar(id) {
      const i = tiendas.findIndex((x) => x.id === id);
      if (i < 0) return false;
      tiendas.splice(i, 1);
      for (let j = pagos.length - 1; j >= 0; j--) if (pagos[j]!.tiendaId === id) pagos.splice(j, 1);
      return true;
    },
    async anotarConsulta(id, at, ip) {
      const t = tiendas.find((x) => x.id === id);
      if (t) {
        t.ultimaConsultaAt = at;
        t.ultimaConsultaIp = ip;
      }
    },
    async anotarEstado(id, estado, at) {
      const t = tiendas.find((x) => x.id === id);
      if (t) {
        t.estado = { ...estado };
        t.estadoAt = at;
      }
    },
    async avisos(id) {
      return avisos.filter((a) => a.tiendaId === id).map((a) => ({ tipo: a.tipo, at: a.at }));
    },
    async anotarAviso(id, tipo, at) {
      avisos.push({ tiendaId: id, tipo, at });
    },
    async config<T>(clave: string) {
      return config.has(clave) ? (JSON.parse(JSON.stringify(config.get(clave))) as T) : null;
    },
    async guardarConfig(clave, valor) {
      config.set(clave, JSON.parse(JSON.stringify(valor)));
    },
    async crearPago(input, at) {
      const p: PagoTienda = { id: seqPago++, tiendaId: input.tiendaId, meses: input.meses, monto: input.monto ?? null, moneda: input.moneda ?? null, nota: input.nota ?? null, imagen: input.imagen, estado: 'pendiente', motivo: null, at, resueltoAt: null, resueltoPor: null };
      pagos.push(p);
      return copiaPago(p, true);
    },
    async pago(id) {
      const p = pagos.find((x) => x.id === id);
      return p ? copiaPago(p, true) : null;
    },
    async pagos(filtro = {}) {
      return pagos
        .filter((p) => (!filtro.tiendaId || p.tiendaId === filtro.tiendaId) && (!filtro.estado || p.estado === filtro.estado))
        .sort((a, b) => b.at.getTime() - a.at.getTime() || b.id - a.id)
        .slice(0, filtro.limit ?? 200)
        .map((p) => copiaPago(p, false));
    },
    async resolverPago(id, cambio) {
      const p = pagos.find((x) => x.id === id);
      if (!p) return null;
      p.estado = cambio.estado;
      p.motivo = cambio.motivo;
      p.resueltoPor = cambio.por;
      p.resueltoAt = cambio.at;
      return copiaPago(p, true);
    },
  };
}
