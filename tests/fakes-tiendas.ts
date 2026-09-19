/** Doble en memoria de las tiendas del superadministrador. */

import type { Tienda, TiendasRepo } from '../src/tiendas/repo.js';

export interface FakeTiendas extends TiendasRepo {
  _tiendas: Tienda[];
}

let seq = 1;

export function createFakeTiendas(): FakeTiendas {
  const tiendas: Tienda[] = [];
  const copia = (t: Tienda): Tienda => ({ ...t, membresia: JSON.parse(JSON.stringify(t.membresia)) });
  return {
    _tiendas: tiendas,
    async crear(input) {
      const ahora = new Date();
      const t: Tienda = { id: `tienda${seq++}`, slug: input.slug, nombre: input.nombre, url: input.url ?? null, contacto: input.contacto ?? null, notas: input.notas ?? null, membresia: input.membresia, tokenHash: input.tokenHash, tokenPrefijo: input.tokenPrefijo, ultimaConsultaAt: null, ultimaConsultaIp: null, creadoPor: input.creadoPor ?? null, createdAt: ahora, updatedAt: ahora };
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
      return true;
    },
    async anotarConsulta(id, at, ip) {
      const t = tiendas.find((x) => x.id === id);
      if (t) {
        t.ultimaConsultaAt = at;
        t.ultimaConsultaIp = ip;
      }
    },
  };
}
