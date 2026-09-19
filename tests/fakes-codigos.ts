/** Doble en memoria de los codigos de conexion. */

import type { CodigoConexion, CodigosConexionRepo } from '../src/auth/codigos-conexion.js';

export interface FakeCodigos extends CodigosConexionRepo {
  _codigos: CodigoConexion[];
}

let seq = 1;

export function createFakeCodigos(): FakeCodigos {
  const codigos: CodigoConexion[] = [];
  const copia = (c: CodigoConexion): CodigoConexion => ({ ...c, permisos: [...c.permisos] });
  return {
    _codigos: codigos,
    async crear(input) {
      const c: CodigoConexion = { id: `cod${seq++}`, codigo: input.codigo, para: input.para, permisos: input.permisos, caducaAt: input.caducaAt, usosMax: input.usosMax, usos: 0, estado: 'activo', creadoPor: input.creadoPor, canjeadoPor: null, canjeadoDesde: null, canjeadoAt: null, claveId: null, createdAt: new Date() };
      codigos.push(c);
      return copia(c);
    },
    async porCodigo(codigo) {
      const c = codigos.find((x) => x.codigo === codigo);
      return c ? copia(c) : null;
    },
    async porId(id) {
      const c = codigos.find((x) => x.id === id);
      return c ? copia(c) : null;
    },
    async listar(limite = 100) {
      return [...codigos].reverse().slice(0, limite).map(copia);
    },
    async canjear(id, datos) {
      const c = codigos.find((x) => x.id === id);
      if (!c || c.estado !== 'activo' || c.usos >= c.usosMax || c.caducaAt.getTime() <= datos.ahora.getTime()) return null;
      c.usos++;
      c.canjeadoPor = datos.por;
      c.canjeadoDesde = datos.desde;
      c.canjeadoAt = datos.ahora;
      c.claveId = datos.claveId;
      return copia(c);
    },
    async anular(id) {
      const c = codigos.find((x) => x.id === id);
      if (!c || c.estado !== 'activo') return false;
      c.estado = 'anulado';
      return true;
    },
  };
}
