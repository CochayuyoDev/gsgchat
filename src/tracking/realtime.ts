/**
 * Hub de posiciones en vivo.
 *
 * Aqui esta la respuesta al "ubicacion en tiempo real": la Cloud API no
 * puede enviar live location (es una funcion de la app de consumidor), asi
 * que WhatsApp solo transporta un link y el mapa vivo corre en este
 * servidor. A cambio se gana caducidad controlada, varios espectadores a la
 * vez y un historico auditable.
 */

import type { TrackPoint, TrackingRepo } from '../db/repos.js';

export interface Socket {
  send(data: string): void;
  readyState?: number;
}

export interface IncomingPoint {
  lat: number;
  lng: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
}

/** Distancia aproximada en metros; suficiente para filtrar ruido de GPS. */
export function metersBetween(a: IncomingPoint, b: IncomingPoint): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface HubOptions {
  tracking: TrackingRepo;
  /** No se persiste un punto si no se movio al menos esto. */
  minDistanceMeters?: number;
  /** Ni si han pasado menos de estos ms desde el ultimo guardado. */
  minIntervalMs?: number;
  now?: () => Date;
}

interface LinkState {
  viewers: Set<Socket>;
  last?: { point: IncomingPoint; at: number };
}

export class TrackingHub {
  readonly #links = new Map<string, LinkState>();
  readonly #tracking: TrackingRepo;
  readonly #minDistance: number;
  readonly #minInterval: number;
  readonly #now: () => Date;

  constructor(opts: HubOptions) {
    this.#tracking = opts.tracking;
    this.#minDistance = opts.minDistanceMeters ?? 15;
    this.#minInterval = opts.minIntervalMs ?? 10_000;
    this.#now = opts.now ?? (() => new Date());
  }

  #state(linkId: string): LinkState {
    let state = this.#links.get(linkId);
    if (!state) {
      state = { viewers: new Set() };
      this.#links.set(linkId, state);
    }
    return state;
  }

  addViewer(linkId: string, socket: Socket): void {
    this.#state(linkId).viewers.add(socket);
  }

  removeViewer(linkId: string, socket: Socket): void {
    const state = this.#links.get(linkId);
    if (!state) return;
    state.viewers.delete(socket);
    if (state.viewers.size === 0 && !state.last) this.#links.delete(linkId);
  }

  viewerCount(linkId: string): number {
    return this.#links.get(linkId)?.viewers.size ?? 0;
  }

  /** Ultima posicion conocida, para que un espectador que llega tarde vea algo. */
  lastPoint(linkId: string): IncomingPoint | null {
    return this.#links.get(linkId)?.last?.point ?? null;
  }

  /** Recibe una posicion del publicador: persiste (filtrada) y reparte. */
  async publish(linkId: string, point: IncomingPoint): Promise<void> {
    const state = this.#state(linkId);
    const nowMs = this.#now().getTime();

    const moved = state.last ? metersBetween(state.last.point, point) : Infinity;
    const elapsed = state.last ? nowMs - state.last.at : Infinity;

    // Se reparte siempre (el mapa debe ir fluido) pero solo se guarda cuando
    // aporta: sin esto el historico se llena de puntos identicos.
    if (moved >= this.#minDistance || elapsed >= this.#minInterval) {
      await this.#tracking.addPoint(linkId, point as TrackPoint);
      state.last = { point, at: nowMs };
    } else {
      state.last = { point, at: state.last?.at ?? nowMs };
    }

    this.broadcast(linkId, { type: 'position', ...point, ts: nowMs });
  }

  broadcast(linkId: string, message: Record<string, unknown>): void {
    const state = this.#links.get(linkId);
    if (!state) return;
    const payload = JSON.stringify(message);
    for (const socket of state.viewers) {
      try {
        socket.send(payload);
      } catch {
        state.viewers.delete(socket);
      }
    }
  }

  /** Corta la sesion: avisa a los espectadores y suelta el estado. */
  close(linkId: string, reason: string): void {
    this.broadcast(linkId, { type: 'closed', reason });
    this.#links.delete(linkId);
  }
}
