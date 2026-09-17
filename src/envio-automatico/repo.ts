/**
 * La lista de envio automatico: las filas y sus movimientos.
 *
 * Aqui no hay decisiones, solo consultas. Quien decide a quien se le escribe
 * y cuando es `motor.ts`; quien decide quien entra y quien sale (y por que)
 * es `servicio.ts`.
 */

import type { Pool } from '../db/pool.js';

/** Que se le manda a cada numero. */
export type QueEnviar = 'ubicacion' | 'mensaje';
/** Cuando deja de escribirsele solo. */
export type Hasta = 'ubicacion' | 'respuesta' | 'envios';
/** Quien lo puso en la lista. */
export type OrigenEntrada = 'manual' | 'ia' | 'ayudante' | 'api';
export type EstadoEntrada = 'activo' | 'pausado';
export type TipoMovimiento = 'entro' | 'salio' | 'envio' | 'pausa' | 'reanudo' | 'fallo';

export interface Entrada {
  id: number;
  phone: string;
  nombre: string | null;
  que: QueEnviar;
  texto: string | null;
  hasta: Hasta;
  referencia: string | null;
  origen: OrigenEntrada;
  origenDetalle: string | null;
  estado: EstadoEntrada;
  enviados: number;
  /** null = el maximo general de los ajustes. */
  maxEnvios: number | null;
  respondioAt: Date | null;
  ultimoEnvioAt: Date | null;
  proximoEnvioAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NuevaEntrada {
  phone: string;
  nombre?: string | null;
  que: QueEnviar;
  texto?: string | null;
  hasta: Hasta;
  referencia?: string | null;
  origen: OrigenEntrada;
  origenDetalle?: string | null;
  maxEnvios?: number | null;
  enviados?: number;
  ultimoEnvioAt?: Date | null;
  proximoEnvioAt?: Date | null;
}

export interface PatchEntrada {
  nombre?: string | null;
  que?: QueEnviar;
  texto?: string | null;
  hasta?: Hasta;
  referencia?: string | null;
  estado?: EstadoEntrada;
  enviados?: number;
  maxEnvios?: number | null;
  respondioAt?: Date | null;
  ultimoEnvioAt?: Date | null;
  proximoEnvioAt?: Date | null;
}

export interface Movimiento {
  id: number;
  phone: string;
  nombre: string | null;
  tipo: TipoMovimiento;
  motivo: string | null;
  origen: string | null;
  createdAt: Date;
}

export interface EnvioAutomaticoRepo {
  /** Crea la fila; si el numero ya esta, la devuelve tal cual (no se pisa). */
  agregar(input: NuevaEntrada): Promise<{ entrada: Entrada; nueva: boolean }>;
  porTelefono(phone: string): Promise<Entrada | null>;
  porId(id: number): Promise<Entrada | null>;
  listar(): Promise<Entrada[]>;
  actualizar(id: number, patch: PatchEntrada): Promise<Entrada | null>;
  quitar(id: number): Promise<Entrada | null>;
  /** Las que ya pueden recibir el siguiente mensaje, la que mas espera primero. */
  tocaEnviar(ahora: Date, limite: number): Promise<Entrada[]>;
  contar(): Promise<{ activos: number; pausados: number }>;
  anotarMovimiento(m: { phone: string; nombre?: string | null; tipo: TipoMovimiento; motivo?: string | null; origen?: string | null; at?: Date }): Promise<void>;
  movimientos(limite: number): Promise<Movimiento[]>;
  /** Cuantos mensajes salieron por la lista desde un momento. */
  enviadosDesde(desde: Date): Promise<number>;
}

interface Row {
  id: number;
  phone: string;
  nombre: string | null;
  que: QueEnviar;
  texto: string | null;
  hasta: Hasta;
  referencia: string | null;
  origen: OrigenEntrada;
  origen_detalle: string | null;
  estado: EstadoEntrada;
  enviados: number;
  max_envios: number | null;
  respondio_at: Date | null;
  ultimo_envio_at: Date | null;
  proximo_envio_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface MovimientoRow {
  id: number;
  phone: string;
  nombre: string | null;
  tipo: TipoMovimiento;
  motivo: string | null;
  origen: string | null;
  created_at: Date;
}

const deFila = (r: Row): Entrada => ({
  id: Number(r.id),
  phone: r.phone,
  nombre: r.nombre,
  que: r.que,
  texto: r.texto,
  hasta: r.hasta,
  referencia: r.referencia,
  origen: r.origen,
  origenDetalle: r.origen_detalle,
  estado: r.estado,
  enviados: Number(r.enviados),
  maxEnvios: r.max_envios === null ? null : Number(r.max_envios),
  respondioAt: r.respondio_at,
  ultimoEnvioAt: r.ultimo_envio_at,
  proximoEnvioAt: r.proximo_envio_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const movimientoDeFila = (r: MovimientoRow): Movimiento => ({
  id: Number(r.id),
  phone: r.phone,
  nombre: r.nombre,
  tipo: r.tipo,
  motivo: r.motivo,
  origen: r.origen,
  createdAt: r.created_at,
});

/** Las columnas de un patch, en el orden en que se escriben. */
const COLUMNAS_PATCH: Array<[keyof PatchEntrada, string]> = [
  ['nombre', 'nombre'],
  ['que', 'que'],
  ['texto', 'texto'],
  ['hasta', 'hasta'],
  ['referencia', 'referencia'],
  ['estado', 'estado'],
  ['enviados', 'enviados'],
  ['maxEnvios', 'max_envios'],
  ['respondioAt', 'respondio_at'],
  ['ultimoEnvioAt', 'ultimo_envio_at'],
  ['proximoEnvioAt', 'proximo_envio_at'],
];

export function createEnvioAutomaticoRepo(pool: Pool): EnvioAutomaticoRepo {
  return {
    async agregar(input) {
      const { rows } = await pool.query<Row>(
        `insert into envio_automatico
           (phone, nombre, que, texto, hasta, referencia, origen, origen_detalle, enviados, max_envios, ultimo_envio_at, proximo_envio_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         on conflict (phone) do nothing
         returning *`,
        [
          input.phone,
          input.nombre ?? null,
          input.que,
          input.texto ?? null,
          input.hasta,
          input.referencia ?? null,
          input.origen,
          input.origenDetalle ?? null,
          input.enviados ?? 0,
          input.maxEnvios ?? null,
          input.ultimoEnvioAt ?? null,
          input.proximoEnvioAt ?? null,
        ],
      );
      if (rows[0]) return { entrada: deFila(rows[0]), nueva: true };
      const existente = await this.porTelefono(input.phone);
      // Entre el insert y el select nadie la borra en la practica; si pasara,
      // se vuelve a insertar y ya.
      if (!existente) return this.agregar(input);
      return { entrada: existente, nueva: false };
    },

    async porTelefono(phone) {
      const { rows } = await pool.query<Row>('select * from envio_automatico where phone = $1', [phone]);
      return rows[0] ? deFila(rows[0]) : null;
    },

    async porId(id) {
      const { rows } = await pool.query<Row>('select * from envio_automatico where id = $1', [id]);
      return rows[0] ? deFila(rows[0]) : null;
    },

    async listar() {
      const { rows } = await pool.query<Row>(
        // Primero a quien le toca antes; los pausados, al final.
        `select * from envio_automatico
          order by (estado = 'pausado') asc, coalesce(proximo_envio_at, created_at) asc, id asc`,
      );
      return rows.map(deFila);
    },

    async actualizar(id, patch) {
      const sets: string[] = [];
      const valores: unknown[] = [];
      for (const [clave, columna] of COLUMNAS_PATCH) {
        if (patch[clave] === undefined) continue;
        valores.push(patch[clave]);
        sets.push(`${columna} = $${valores.length}`);
      }
      if (!sets.length) return this.porId(id);
      valores.push(id);
      const { rows } = await pool.query<Row>(
        `update envio_automatico set ${sets.join(', ')}, updated_at = now() where id = $${valores.length} returning *`,
        valores,
      );
      return rows[0] ? deFila(rows[0]) : null;
    },

    async quitar(id) {
      const { rows } = await pool.query<Row>('delete from envio_automatico where id = $1 returning *', [id]);
      return rows[0] ? deFila(rows[0]) : null;
    },

    async tocaEnviar(ahora, limite) {
      const { rows } = await pool.query<Row>(
        `select * from envio_automatico
          where estado = 'activo'
            and (proximo_envio_at is null or proximo_envio_at <= $1)
          -- El que lleva mas esperando, primero: un numero recien puesto no
          -- adelanta al recordatorio que ya tocaba.
          order by coalesce(proximo_envio_at, created_at) asc, id asc
          limit $2`,
        [ahora, limite],
      );
      return rows.map(deFila);
    },

    async contar() {
      const { rows } = await pool.query<{ estado: EstadoEntrada; n: number | string }>(
        'select estado, count(*)::int as n from envio_automatico group by estado',
      );
      const cifras = { activos: 0, pausados: 0 };
      for (const r of rows) {
        if (r.estado === 'activo') cifras.activos = Number(r.n);
        if (r.estado === 'pausado') cifras.pausados = Number(r.n);
      }
      return cifras;
    },

    async anotarMovimiento(m) {
      await pool.query(
        `insert into envio_automatico_movimientos (phone, nombre, tipo, motivo, origen, created_at)
         values ($1,$2,$3,$4,$5,$6)`,
        [m.phone, m.nombre ?? null, m.tipo, m.motivo ?? null, m.origen ?? null, m.at ?? new Date()],
      );
    },

    async movimientos(limite) {
      const { rows } = await pool.query<MovimientoRow>(
        'select * from envio_automatico_movimientos order by id desc limit $1',
        [limite],
      );
      return rows.map(movimientoDeFila);
    },

    async enviadosDesde(desde) {
      const { rows } = await pool.query<{ n: number | string }>(
        `select count(*)::int as n from envio_automatico_movimientos where tipo = 'envio' and created_at >= $1`,
        [desde],
      );
      return Number(rows[0]?.n ?? 0);
    },
  };
}
