/** Doble en memoria de la lista de envio automatico y sus movimientos. */

import type { Entrada, EnvioAutomaticoRepo, Movimiento } from '../src/envio-automatico/repo.js';

export interface FakeEnvioAutomatico extends EnvioAutomaticoRepo {
  _entradas: Entrada[];
  _movimientos: Movimiento[];
}

let seq = 1;

export function createFakeEnvioAutomatico(): FakeEnvioAutomatico {
  const entradas: Entrada[] = [];
  const movimientos: Movimiento[] = [];
  const buscar = (id: number) => entradas.find((e) => e.id === id) ?? null;
  const copia = (e: Entrada): Entrada => ({ ...e });

  return {
    _entradas: entradas,
    _movimientos: movimientos,
    async agregar(input) {
      const existente = entradas.find((e) => e.phone === input.phone);
      if (existente) return { entrada: copia(existente), nueva: false };
      const ahora = new Date();
      const e: Entrada = {
        id: seq++,
        phone: input.phone,
        nombre: input.nombre ?? null,
        que: input.que,
        texto: input.texto ?? null,
        hasta: input.hasta,
        referencia: input.referencia ?? null,
        origen: input.origen,
        origenDetalle: input.origenDetalle ?? null,
        estado: 'activo',
        enviados: input.enviados ?? 0,
        maxEnvios: input.maxEnvios ?? null,
        respondioAt: null,
        ultimoEnvioAt: input.ultimoEnvioAt ?? null,
        proximoEnvioAt: input.proximoEnvioAt ?? null,
        createdAt: ahora,
        updatedAt: ahora,
      };
      entradas.push(e);
      return { entrada: copia(e), nueva: true };
    },
    async porTelefono(phone) {
      const e = entradas.find((x) => x.phone === phone);
      return e ? copia(e) : null;
    },
    async porId(id) {
      const e = buscar(id);
      return e ? copia(e) : null;
    },
    async listar() {
      return [...entradas]
        .sort((a, b) => Number(a.estado === 'pausado') - Number(b.estado === 'pausado') || (a.proximoEnvioAt ?? a.createdAt).getTime() - (b.proximoEnvioAt ?? b.createdAt).getTime() || a.id - b.id)
        .map(copia);
    },
    async actualizar(id, patch) {
      const e = buscar(id);
      if (!e) return null;
      for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) (e as unknown as Record<string, unknown>)[k] = v;
      }
      e.updatedAt = new Date();
      return copia(e);
    },
    async quitar(id) {
      const i = entradas.findIndex((e) => e.id === id);
      if (i < 0) return null;
      const [e] = entradas.splice(i, 1);
      return copia(e!);
    },
    async tocaEnviar(ahora, limite) {
      return entradas
        .filter((e) => e.estado === 'activo' && (!e.proximoEnvioAt || e.proximoEnvioAt.getTime() <= ahora.getTime()))
        .sort((a, b) => (a.proximoEnvioAt ?? a.createdAt).getTime() - (b.proximoEnvioAt ?? b.createdAt).getTime() || a.id - b.id)
        .slice(0, limite)
        .map(copia);
    },
    async contar() {
      return { activos: entradas.filter((e) => e.estado === 'activo').length, pausados: entradas.filter((e) => e.estado === 'pausado').length };
    },
    async anotarMovimiento(m) {
      movimientos.push({ id: seq++, phone: m.phone, nombre: m.nombre ?? null, tipo: m.tipo, motivo: m.motivo ?? null, origen: m.origen ?? null, createdAt: m.at ?? new Date() });
    },
    async movimientos(limite) {
      return [...movimientos].sort((a, b) => b.id - a.id).slice(0, limite);
    },
    async enviadosDesde(desde) {
      return movimientos.filter((m) => m.tipo === 'envio' && m.createdAt.getTime() >= desde.getTime()).length;
    },
  };
}
