/** Doble en memoria de los conectores de tiendas y su registro de entradas. */

import type { Conector, ConectorConSecreto, ConectoresRepo, EntradaConector } from '../src/conectores/repo.js';
import { sinSecretoConector } from '../src/conectores/repo.js';

export interface FakeConectores extends ConectoresRepo {
  _conectores: ConectorConSecreto[];
  _entradas: EntradaConector[];
}

let seq = 1;

export function createFakeConectores(): FakeConectores {
  const conectores: ConectorConSecreto[] = [];
  const entradas: EntradaConector[] = [];
  const buscar = (id: string) => conectores.find((c) => c.id === id) ?? null;

  return {
    _conectores: conectores,
    _entradas: entradas,
    async crear(input) {
      const c: ConectorConSecreto = {
        id: `con-${seq++}`,
        tipo: input.tipo,
        nombre: input.nombre,
        secreto: input.secreto,
        activo: true,
        reglas: input.reglas,
        creadoPor: input.creadoPor,
        createdAt: new Date(),
        ultimoEventoAt: null,
        eventosRecibidos: 0,
      };
      conectores.push(c);
      return sinSecretoConector(c);
    },
    async listar() {
      return [...conectores].reverse().map(sinSecretoConector);
    },
    async obtener(id) {
      const c = buscar(id);
      return c ? sinSecretoConector(c) : null;
    },
    async conSecreto(id) {
      const c = buscar(id);
      return c ? { ...c } : null;
    },
    async actualizar(id, patch) {
      const c = buscar(id);
      if (!c) return null;
      if (patch.nombre !== undefined) c.nombre = patch.nombre;
      if (patch.activo !== undefined) c.activo = patch.activo;
      if (patch.reglas !== undefined) c.reglas = patch.reglas;
      return sinSecretoConector(c);
    },
    async cambiarSecreto(id, secreto) {
      const c = buscar(id);
      if (!c) return false;
      c.secreto = secreto;
      return true;
    },
    async borrar(id) {
      const i = conectores.findIndex((c) => c.id === id);
      if (i < 0) return false;
      conectores.splice(i, 1);
      return true;
    },
    async anotarEntrada(e) {
      entradas.push({ id: seq++, conectorId: e.conectorId, evento: e.evento, eventoOrigen: e.eventoOrigen, pedido: e.pedido, telefono: e.telefono, resultado: e.resultado, detalle: e.detalle, createdAt: e.at ?? new Date() });
      const c = buscar(e.conectorId);
      if (c) {
        c.ultimoEventoAt = e.at ?? new Date();
        c.eventosRecibidos += 1;
      }
    },
    async entradas(conectorId, limite) {
      return entradas
        .filter((e) => e.conectorId === conectorId)
        .sort((a, b) => b.id - a.id)
        .slice(0, limite)
        .map((e) => ({ ...e }));
    },
  };
}

export type { Conector };
