/** Doble en memoria del cupo diario por linea (ver src/db/uso-lineas.ts). */

import type { ReservaDeEnvio, UsoLineasRepo } from '../src/db/uso-lineas.js';

export interface FakeUsoLineas extends UsoLineasRepo {
  _reservas: Map<string, ReservaDeEnvio>;
  _uso: Map<string, number>;
}

export function createFakeUsoLineas(entregaSalio: (id: number) => string | null = () => null): FakeUsoLineas {
  const limites = new Map<string, number>();
  const uso = new Map<string, number>();
  const reservas = new Map<string, ReservaDeEnvio>();
  const k = (linea: string, dia: string) => `${linea}|${dia}`;

  return {
    _reservas: reservas,
    _uso: uso,
    async limite(lineaId) {
      return limites.get(lineaId) ?? 0;
    },
    async fijarLimite(lineaId, limite) {
      limites.set(lineaId, limite);
    },
    async usoDelDia(dia) {
      const salida = new Map<string, number>();
      for (const [clave, n] of uso) {
        const [linea, d] = clave.split('|');
        if (d === dia) salida.set(linea!, n);
      }
      return salida;
    },
    async reservar({ clave, lineaId, dia, motivo }) {
      const previa = reservas.get(clave);
      if (previa && previa.estado !== 'liberado' && previa.estado !== 'sin_linea') return { ok: true, reserva: previa, repetida: true };
      const limite = limites.get(lineaId) ?? 0;
      const usados = uso.get(k(lineaId, dia)) ?? 0;
      if (limite > 0 && usados >= limite) return { ok: false, razon: 'sin_cupo', limite, usados };
      uso.set(k(lineaId, dia), usados + 1);
      const reserva: ReservaDeEnvio = { clave, lineaId, dia, estado: 'reservado', motivo, deliveryId: previa?.deliveryId ?? null, wamid: null };
      reservas.set(clave, reserva);
      return { ok: true, reserva, repetida: false };
    },
    async anotarEntrega(clave, deliveryId) {
      const r = reservas.get(clave);
      if (r) r.deliveryId = deliveryId;
    },
    async aceptar(clave, wamid) {
      const r = reservas.get(clave);
      if (r && (r.estado === 'reservado' || r.estado === 'incierto')) Object.assign(r, { estado: 'aceptado', wamid });
    },
    async liberar(clave) {
      const r = reservas.get(clave);
      if (!r || (r.estado !== 'reservado' && r.estado !== 'incierto') || !r.lineaId || !r.dia) return false;
      r.estado = 'liberado';
      uso.set(k(r.lineaId, r.dia), Math.max((uso.get(k(r.lineaId, r.dia)) ?? 0) - 1, 0));
      return true;
    },
    async marcarIncierto(clave) {
      const r = reservas.get(clave);
      if (r && r.estado === 'reservado') r.estado = 'incierto';
    },
    async anotarSinLinea(clave, deliveryId) {
      const r = reservas.get(clave);
      if (r && ['reservado', 'incierto', 'aceptado'].includes(r.estado)) return;
      reservas.set(clave, { clave, lineaId: null, dia: null, estado: 'sin_linea', motivo: null, deliveryId, wamid: null });
    },
    async porClave(clave) {
      return reservas.get(clave) ?? null;
    },
    async reconciliar(clave) {
      const r = reservas.get(clave) ?? null;
      if (r && (r.estado === 'reservado' || r.estado === 'incierto') && r.deliveryId !== null) {
        const wamid = entregaSalio(r.deliveryId);
        if (wamid) Object.assign(r, { estado: 'aceptado', wamid });
      }
      return r;
    },
  };
}
