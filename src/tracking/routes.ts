/**
 * Rutas de rastreo: la pagina HTML y el WebSocket que la alimenta.
 */

import type { FastifyInstance } from 'fastify';
import type { Repos } from '../db/repos.js';
import type { Config } from '../config.js';
import { verifyTrackToken, buildTrackingUrls, type TrackingUrls } from './tokens.js';
import { TrackingHub, type Socket } from './realtime.js';
import { expiredPage, publisherPage, viewerPage } from './page.js';
import type { SettingsService } from '../settings/service.js';

export interface TrackingDeps {
  repos: Repos;
  config: Config;
  hub: TrackingHub;
  settings: SettingsService;
}

/** Crea una sesion de rastreo y devuelve los dos enlaces. */
export async function createTrackingSession(
  deps: Pick<TrackingDeps, 'repos' | 'config'>,
  input: { contactId?: string | null; label?: string; ttlMinutes?: number },
): Promise<TrackingUrls> {
  const ttl = input.ttlMinutes ?? deps.config.TRACKING_TTL_MINUTES;
  const expiresAt = new Date(Date.now() + ttl * 60_000);
  const link = await deps.repos.tracking.createLink(
    input.contactId ?? null,
    input.label ?? null,
    expiresAt,
  );
  return buildTrackingUrls(
    link.id,
    expiresAt,
    deps.config.TRACKING_SECRET,
    deps.config.PUBLIC_BASE_URL,
  );
}

export async function registerTrackingRoutes(
  app: FastifyInstance,
  deps: TrackingDeps,
): Promise<void> {
  const { repos, config, hub, settings } = deps;

  /** Valida token + estado del enlace en la base. Los dos deben cuadrar. */
  async function resolve(token: string) {
    const payload = verifyTrackToken(token, config.TRACKING_SECRET);
    if (!payload) return null;
    const link = await repos.tracking.getLink(payload.linkId);
    if (!link || link.revokedAt || link.expiresAt.getTime() <= Date.now()) return null;
    return { payload, link };
  }

  app.get<{ Params: { token: string } }>('/t/:token', async (request, reply) => {
    const resolved = await resolve(request.params.token);
    if (!resolved) {
      return reply.code(410).type('text/html; charset=utf-8').send(expiredPage());
    }

    const label = resolved.link.label ?? 'Ubicacion en vivo';
    const html =
      resolved.payload.role === 'publish'
        ? publisherPage(request.params.token, settings.current().mapsApiKey, label)
        : viewerPage(request.params.token, settings.current().mapsApiKey, label);

    return reply
      .type('text/html; charset=utf-8')
      // La pagina lleva token y clave dentro: no debe quedar en caches.
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .send(html);
  });

  app.get<{ Params: { token: string } }>(
    '/ws/track/:token',
    { websocket: true },
    async (socket: Socket & { on: (event: string, cb: (data: unknown) => void) => void; close: () => void }, request) => {
      const resolved = await resolve(request.params.token);
      if (!resolved) {
        socket.send(JSON.stringify({ type: 'closed', reason: 'enlace no valido o caducado' }));
        socket.close();
        return;
      }

      const { payload, link } = resolved;
      const linkId = link.id;

      if (payload.role === 'view') {
        hub.addViewer(linkId, socket);

        // Un espectador que entra tarde debe ver el recorrido, no un mapa vacio.
        const history = await repos.tracking.listPoints(linkId, 200);
        if (history.length) {
          socket.send(JSON.stringify({ type: 'history', points: history }));
        }

        socket.on('close', () => hub.removeViewer(linkId, socket));
        return;
      }

      // Rol publicador: solo acepta posiciones, nunca las reparte.
      socket.on('message', (raw: unknown) => {
        void (async () => {
          try {
            const message = JSON.parse(String(raw)) as Record<string, unknown>;
            if (message.type === 'stop') {
              hub.close(linkId, 'el emisor dejo de compartir');
              await repos.tracking.revoke(linkId);
              socket.close();
              return;
            }
            if (message.type !== 'position') return;

            const lat = Number(message.lat);
            const lng = Number(message.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
            if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

            await hub.publish(linkId, {
              lat,
              lng,
              accuracy: Number.isFinite(Number(message.accuracy)) ? Number(message.accuracy) : undefined,
              heading: Number.isFinite(Number(message.heading)) ? Number(message.heading) : undefined,
              speed: Number.isFinite(Number(message.speed)) ? Number(message.speed) : undefined,
            });
          } catch (error) {
            request.log.warn({ err: error }, 'punto de rastreo invalido');
          }
        })();
      });
    },
  );
}
