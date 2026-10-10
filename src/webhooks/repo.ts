/**
 * Webhooks salientes: las suscripciones y la cola de entregas.
 *
 * Una fila en `webhooks` por sistema suscrito; una en `webhook_entregas`
 * por evento que le toca recibir. La entrega sigue el patron de la cola a
 * GSG: pendiente hasta que el otro lado conteste 2xx, con reintentos y con
 * constancia de lo que contesto.
 */

import { toleranteAlUuid, type Pool } from '../db/pool.js';
import type { NombreEvento } from '../eventos/bus.js';

export interface Webhook {
  id: string;
  url: string;
  descripcion: string;
  /** Eventos suscritos, o ['*'] para todos. */
  eventos: string[];
  activo: boolean;
  motivoPausa: string | null;
  creadoPor: string | null;
  createdAt: Date;
  ultimoOkAt: Date | null;
  ultimoFalloAt: Date | null;
  fallosSeguidos: number;
}

/** El webhook con su secreto: solo para firmar, nunca para listar. */
export interface WebhookConSecreto extends Webhook {
  secreto: string;
}

export type EstadoEntrega = 'pendiente' | 'enviada' | 'fallida';

export interface Entrega {
  id: number;
  webhookId: string;
  evento: string;
  payload: Record<string, unknown>;
  estado: EstadoEntrega;
  intentos: number;
  proximoIntentoAt: Date;
  respuestaCodigo: number | null;
  respuesta: string | null;
  error: string | null;
  createdAt: Date;
  enviadaAt: Date | null;
}

export interface WebhooksRepo {
  crear(input: { url: string; descripcion: string; secreto: string; eventos: string[]; creadoPor: string | null }): Promise<Webhook>;
  listar(): Promise<Webhook[]>;
  obtener(id: string): Promise<Webhook | null>;
  /** Los activos que quieren ese evento, con su secreto para firmar. */
  activosPara(evento: NombreEvento): Promise<WebhookConSecreto[]>;
  conSecreto(id: string): Promise<WebhookConSecreto | null>;
  actualizar(id: string, patch: { url?: string; descripcion?: string; eventos?: string[]; activo?: boolean }): Promise<Webhook | null>;
  rotarSecreto(id: string, secreto: string): Promise<boolean>;
  borrar(id: string): Promise<boolean>;

  encolar(webhookId: string, evento: string, payload: Record<string, unknown>, at?: Date): Promise<number>;
  /** Lo que toca intentar ahora, mas antiguo primero. */
  pendientes(ahora: Date, limite: number): Promise<Entrega[]>;
  /** Como fue el intento: exito, reintento mas tarde, o se da por perdida. */
  marcarEntrega(
    id: number,
    resultado:
      | { estado: 'enviada'; codigo: number; respuesta: string | null; at: Date }
      | { estado: 'pendiente'; codigo: number | null; respuesta: string | null; error: string; proximoIntentoAt: Date }
      | { estado: 'fallida'; codigo: number | null; respuesta: string | null; error: string },
  ): Promise<void>;
  /** Un exito o un fallo del webhook entero, para el panel y para apagarlo solo. */
  anotarResultado(webhookId: string, ok: boolean, at: Date): Promise<{ fallosSeguidos: number; ultimoOkAt: Date | null }>;
  pausar(webhookId: string, motivo: string): Promise<void>;
  entregas(webhookId: string, limite: number): Promise<Entrega[]>;
  /** Devuelve a la cola las fallidas de un webhook (tras arreglar el otro lado). */
  reencolarFallidas(webhookId: string, at: Date): Promise<number>;
  contarPendientes(): Promise<number>;
}

interface WebhookRow {
  id: string;
  url: string;
  descripcion: string;
  secreto: string;
  eventos: string[];
  activo: boolean;
  motivo_pausa: string | null;
  creado_por: string | null;
  created_at: Date;
  ultimo_ok_at: Date | null;
  ultimo_fallo_at: Date | null;
  fallos_seguidos: number;
}

interface EntregaRow {
  id: number;
  webhook_id: string;
  evento: string;
  payload: Record<string, unknown> | string;
  estado: EstadoEntrega;
  intentos: number;
  proximo_intento_at: Date;
  respuesta_codigo: number | null;
  respuesta: string | null;
  error: string | null;
  created_at: Date;
  enviada_at: Date | null;
}

const COLUMNAS = `id, url, descripcion, secreto, eventos, activo, motivo_pausa, creado_por, created_at, ultimo_ok_at, ultimo_fallo_at, fallos_seguidos`;

const deFila = (r: WebhookRow): WebhookConSecreto => ({
  id: r.id,
  url: r.url,
  descripcion: r.descripcion,
  secreto: r.secreto,
  eventos: r.eventos,
  activo: r.activo,
  motivoPausa: r.motivo_pausa,
  creadoPor: r.creado_por,
  createdAt: r.created_at,
  ultimoOkAt: r.ultimo_ok_at,
  ultimoFalloAt: r.ultimo_fallo_at,
  fallosSeguidos: r.fallos_seguidos,
});

/** Sin el secreto: lo que se lista y se devuelve por la API. */
export const sinSecreto = ({ secreto: _s, ...resto }: WebhookConSecreto): Webhook => resto;

const entregaDeFila = (r: EntregaRow): Entrega => ({
  id: r.id,
  webhookId: r.webhook_id,
  evento: r.evento,
  payload: typeof r.payload === 'string' ? (JSON.parse(r.payload) as Record<string, unknown>) : r.payload,
  estado: r.estado,
  intentos: r.intentos,
  proximoIntentoAt: r.proximo_intento_at,
  respuestaCodigo: r.respuesta_codigo,
  respuesta: r.respuesta,
  error: r.error,
  createdAt: r.created_at,
  enviadaAt: r.enviada_at,
});

export function createWebhooksRepo(poolCrudo: Pool): WebhooksRepo {
  // Los ids son uuid: uno mal pegado es un 404, no un 500 (ver toleranteAlUuid).
  const pool = toleranteAlUuid(poolCrudo);
  return {
    async crear(input) {
      const { rows } = await pool.query<WebhookRow>(
        `insert into webhooks (url, descripcion, secreto, eventos, creado_por)
         values ($1,$2,$3,$4,$5) returning ${COLUMNAS}`,
        [input.url, input.descripcion, input.secreto, input.eventos, input.creadoPor],
      );
      return sinSecreto(deFila(rows[0]!));
    },
    async listar() {
      const { rows } = await pool.query<WebhookRow>(`select ${COLUMNAS} from webhooks order by created_at desc`);
      return rows.map((r) => sinSecreto(deFila(r)));
    },
    async obtener(id) {
      const { rows } = await pool.query<WebhookRow>(`select ${COLUMNAS} from webhooks where id = $1`, [id]);
      return rows[0] ? sinSecreto(deFila(rows[0])) : null;
    },
    async conSecreto(id) {
      const { rows } = await pool.query<WebhookRow>(`select ${COLUMNAS} from webhooks where id = $1`, [id]);
      return rows[0] ? deFila(rows[0]) : null;
    },
    async activosPara(evento) {
      const { rows } = await pool.query<WebhookRow>(
        `select ${COLUMNAS} from webhooks where activo and ($1 = any(eventos) or '*' = any(eventos)) order by created_at`,
        [evento],
      );
      return rows.map(deFila);
    },
    async actualizar(id, patch) {
      const { rows } = await pool.query<WebhookRow>(
        `update webhooks
            set url = coalesce($2, url),
                descripcion = coalesce($3, descripcion),
                eventos = coalesce($4, eventos),
                activo = coalesce($5, activo),
                -- Activarlo a mano borra el motivo de la pausa y el contador.
                motivo_pausa = case when $5 = true then null else motivo_pausa end,
                fallos_seguidos = case when $5 = true then 0 else fallos_seguidos end
          where id = $1 returning ${COLUMNAS}`,
        [id, patch.url ?? null, patch.descripcion ?? null, patch.eventos ?? null, patch.activo ?? null],
      );
      return rows[0] ? sinSecreto(deFila(rows[0])) : null;
    },
    async rotarSecreto(id, secreto) {
      const { rowCount } = await pool.query('update webhooks set secreto = $2 where id = $1', [id, secreto]);
      return (rowCount ?? 0) > 0;
    },
    async borrar(id) {
      const { rowCount } = await pool.query('delete from webhooks where id = $1', [id]);
      return (rowCount ?? 0) > 0;
    },

    async encolar(webhookId, evento, payload, at) {
      const { rows } = await pool.query<{ id: number }>(
        `insert into webhook_entregas (webhook_id, evento, payload, proximo_intento_at, created_at)
         values ($1,$2,$3, coalesce($4, now()), coalesce($4, now())) returning id`,
        [webhookId, evento, JSON.stringify(payload), at ?? null],
      );
      return rows[0]!.id;
    },
    async pendientes(ahora, limite) {
      const { rows } = await pool.query<EntregaRow>(
        `select e.* from webhook_entregas e
           join webhooks w on w.id = e.webhook_id
          where e.estado = 'pendiente' and e.proximo_intento_at <= $1 and w.activo
          order by e.proximo_intento_at, e.id
          limit $2`,
        [ahora, limite],
      );
      return rows.map(entregaDeFila);
    },
    async marcarEntrega(id, resultado) {
      if (resultado.estado === 'enviada') {
        await pool.query(
          `update webhook_entregas
              set estado = 'enviada', intentos = intentos + 1, respuesta_codigo = $2, respuesta = $3, error = null, enviada_at = $4
            where id = $1`,
          [id, resultado.codigo, resultado.respuesta, resultado.at],
        );
        return;
      }
      if (resultado.estado === 'pendiente') {
        await pool.query(
          `update webhook_entregas
              set intentos = intentos + 1, respuesta_codigo = $2, respuesta = $3, error = $4, proximo_intento_at = $5
            where id = $1`,
          [id, resultado.codigo, resultado.respuesta, resultado.error, resultado.proximoIntentoAt],
        );
        return;
      }
      await pool.query(
        `update webhook_entregas
            set estado = 'fallida', intentos = intentos + 1, respuesta_codigo = $2, respuesta = $3, error = $4
          where id = $1`,
        [id, resultado.codigo, resultado.respuesta, resultado.error],
      );
    },
    async anotarResultado(webhookId, ok, at) {
      const { rows } = await pool.query<{ fallos_seguidos: number; ultimo_ok_at: Date | null }>(
        ok
          ? `update webhooks set ultimo_ok_at = $2, fallos_seguidos = 0 where id = $1 returning fallos_seguidos, ultimo_ok_at`
          : `update webhooks set ultimo_fallo_at = $2, fallos_seguidos = fallos_seguidos + 1 where id = $1 returning fallos_seguidos, ultimo_ok_at`,
        [webhookId, at],
      );
      return { fallosSeguidos: rows[0]?.fallos_seguidos ?? 0, ultimoOkAt: rows[0]?.ultimo_ok_at ?? null };
    },
    async pausar(webhookId, motivo) {
      await pool.query('update webhooks set activo = false, motivo_pausa = $2 where id = $1', [webhookId, motivo]);
    },
    async entregas(webhookId, limite) {
      const { rows } = await pool.query<EntregaRow>(
        `select * from webhook_entregas where webhook_id = $1 order by id desc limit $2`,
        [webhookId, limite],
      );
      return rows.map(entregaDeFila);
    },
    async reencolarFallidas(webhookId, at) {
      const { rowCount } = await pool.query(
        `update webhook_entregas set estado = 'pendiente', proximo_intento_at = $2, error = null
          where webhook_id = $1 and estado = 'fallida'`,
        [webhookId, at],
      );
      return rowCount ?? 0;
    },
    async contarPendientes() {
      const { rows } = await pool.query<{ n: number }>(`select count(*)::int as n from webhook_entregas where estado = 'pendiente'`);
      return rows[0]?.n ?? 0;
    },
  };
}
