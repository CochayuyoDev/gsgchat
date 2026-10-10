/**
 * Las tiendas del superadministrador: solo filas.
 *
 * Quien decide plan, pagos y suspensiones es `servicio.ts`; aqui van las
 * consultas. La membresia de cada tienda se guarda como JSON con la misma
 * forma que la membresia local de una instancia (`MembresiaLocal`), asi el
 * plan que se le manda a la tienda se calcula con el mismo codigo.
 */

import type { Pool } from '../db/pool.js';
import type { EstadoInstancia, MembresiaLocal } from '../plan/servicio.js';

export interface Tienda {
  id: string;
  slug: string;
  nombre: string;
  url: string | null;
  contacto: string | null;
  notas: string | null;
  membresia: MembresiaLocal;
  tokenHash: string;
  tokenPrefijo: string;
  ultimaConsultaAt: Date | null;
  ultimaConsultaIp: string | null;
  /** El ultimo parte de salud que mando su instalacion, y cuando. */
  estado: EstadoInstancia | null;
  estadoAt: Date | null;
  creadoPor: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Un aviso de vencimiento ya mandado (para no repetirlo). */
export interface AvisoTienda {
  tipo: string;
  at: Date;
}

export type EstadoPagoTienda = 'pendiente' | 'aceptado' | 'rechazado';

/** Una captura de pago que mando la tienda desde /pagar. */
export interface PagoTienda {
  id: number;
  tiendaId: string;
  meses: number;
  monto: number | null;
  moneda: string | null;
  nota: string | null;
  /** La captura (data URL). Se omite en las listas para no cargar la pantalla. */
  imagen: string | null;
  estado: EstadoPagoTienda;
  motivo: string | null;
  at: Date;
  resueltoAt: Date | null;
  resueltoPor: string | null;
}

export interface NuevoPagoTienda {
  tiendaId: string;
  meses: number;
  monto?: number | null;
  moneda?: string | null;
  nota?: string | null;
  imagen: string;
}

export interface NuevaTienda {
  slug: string;
  nombre: string;
  url?: string | null;
  contacto?: string | null;
  notas?: string | null;
  membresia: MembresiaLocal;
  tokenHash: string;
  tokenPrefijo: string;
  creadoPor?: string | null;
}

export interface PatchTienda {
  nombre?: string;
  url?: string | null;
  contacto?: string | null;
  notas?: string | null;
  membresia?: MembresiaLocal;
  tokenHash?: string;
  tokenPrefijo?: string;
}

export interface TiendasRepo {
  crear(input: NuevaTienda): Promise<Tienda>;
  porId(id: string): Promise<Tienda | null>;
  porSlug(slug: string): Promise<Tienda | null>;
  listar(): Promise<Tienda[]>;
  actualizar(id: string, patch: PatchTienda): Promise<Tienda | null>;
  borrar(id: string): Promise<boolean>;
  /** La tienda pregunto por su plan: queda la hora y desde donde. */
  anotarConsulta(id: string, at: Date, ip: string | null): Promise<void>;
  /** El parte de salud que mando la tienda con su consulta. */
  anotarEstado(id: string, estado: EstadoInstancia, at: Date): Promise<void>;
  /** Los avisos de vencimiento ya mandados a esa tienda. */
  avisos(id: string): Promise<AvisoTienda[]>;
  anotarAviso(id: string, tipo: string, at: Date): Promise<void>;
  /** Lo que el dueño configura desde la pantalla (como me pagan, textos de avisos). */
  config<T>(clave: string): Promise<T | null>;
  guardarConfig(clave: string, valor: unknown): Promise<void>;
  /** Las capturas de pago. */
  crearPago(input: NuevoPagoTienda, at: Date): Promise<PagoTienda>;
  pago(id: number): Promise<PagoTienda | null>;
  /** Sin la imagen (para listas); con `estado`, solo los de ese estado. */
  pagos(filtro?: { tiendaId?: string; estado?: EstadoPagoTienda; limit?: number }): Promise<PagoTienda[]>;
  resolverPago(id: number, cambio: { estado: EstadoPagoTienda; motivo: string | null; por: string | null; at: Date }): Promise<PagoTienda | null>;
}

interface Row {
  id: string;
  slug: string;
  nombre: string;
  url: string | null;
  contacto: string | null;
  notas: string | null;
  membresia: MembresiaLocal | string;
  token_hash: string;
  token_prefijo: string;
  ultima_consulta_at: Date | null;
  ultima_consulta_ip: string | null;
  estado?: EstadoInstancia | string | null;
  estado_at?: Date | null;
  creado_por: string | null;
  created_at: Date;
  updated_at: Date;
}

interface PagoRow {
  id: number;
  tienda_id: string;
  meses: number;
  monto: string | number | null;
  moneda: string | null;
  nota: string | null;
  imagen: string | null;
  estado: EstadoPagoTienda;
  motivo: string | null;
  at: Date;
  resuelto_at: Date | null;
  resuelto_por: string | null;
}

const pagoDeFila = (r: PagoRow): PagoTienda => ({
  id: Number(r.id),
  tiendaId: r.tienda_id,
  meses: Number(r.meses),
  monto: r.monto === null || r.monto === undefined ? null : Number(r.monto),
  moneda: r.moneda,
  nota: r.nota,
  imagen: r.imagen ?? null,
  estado: r.estado,
  motivo: r.motivo,
  at: r.at,
  resueltoAt: r.resuelto_at,
  resueltoPor: r.resuelto_por,
});

const deFila = (r: Row): Tienda => ({
  id: r.id,
  slug: r.slug,
  nombre: r.nombre,
  url: r.url,
  contacto: r.contacto,
  notas: r.notas,
  membresia: typeof r.membresia === 'string' ? (JSON.parse(r.membresia) as MembresiaLocal) : r.membresia,
  tokenHash: r.token_hash,
  tokenPrefijo: r.token_prefijo,
  ultimaConsultaAt: r.ultima_consulta_at,
  ultimaConsultaIp: r.ultima_consulta_ip,
  estado: r.estado ? (typeof r.estado === 'string' ? (JSON.parse(r.estado) as EstadoInstancia) : r.estado) : null,
  estadoAt: r.estado_at ?? null,
  creadoPor: r.creado_por,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const COLUMNAS_PATCH: Array<[keyof PatchTienda, string, boolean]> = [
  ['nombre', 'nombre', false],
  ['url', 'url', false],
  ['contacto', 'contacto', false],
  ['notas', 'notas', false],
  ['membresia', 'membresia', true],
  ['tokenHash', 'token_hash', false],
  ['tokenPrefijo', 'token_prefijo', false],
];

export function createTiendasRepo(pool: Pool): TiendasRepo {
  return {
    async crear(input) {
      const { rows } = await pool.query<Row>(
        `insert into tiendas (slug, nombre, url, contacto, notas, membresia, token_hash, token_prefijo, creado_por)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
        [input.slug, input.nombre, input.url ?? null, input.contacto ?? null, input.notas ?? null, JSON.stringify(input.membresia), input.tokenHash, input.tokenPrefijo, input.creadoPor ?? null],
      );
      return deFila(rows[0]!);
    },
    async porId(id) {
      const { rows } = await pool.query<Row>('select * from tiendas where id = $1', [id]);
      return rows[0] ? deFila(rows[0]) : null;
    },
    async porSlug(slug) {
      const { rows } = await pool.query<Row>('select * from tiendas where slug = $1', [slug]);
      return rows[0] ? deFila(rows[0]) : null;
    },
    async listar() {
      const { rows } = await pool.query<Row>('select * from tiendas order by lower(nombre) asc');
      return rows.map(deFila);
    },
    async actualizar(id, patch) {
      const sets: string[] = [];
      const valores: unknown[] = [];
      for (const [clave, columna, json] of COLUMNAS_PATCH) {
        if (patch[clave] === undefined) continue;
        valores.push(json ? JSON.stringify(patch[clave]) : patch[clave]);
        sets.push(`${columna} = $${valores.length}`);
      }
      if (!sets.length) return this.porId(id);
      valores.push(id);
      const { rows } = await pool.query<Row>(`update tiendas set ${sets.join(', ')}, updated_at = now() where id = $${valores.length} returning *`, valores);
      return rows[0] ? deFila(rows[0]) : null;
    },
    async borrar(id) {
      const { rowCount } = await pool.query('delete from tiendas where id = $1', [id]);
      return (rowCount ?? 0) > 0;
    },
    async anotarConsulta(id, at, ip) {
      await pool.query('update tiendas set ultima_consulta_at = $2, ultima_consulta_ip = $3 where id = $1', [id, at, ip]);
    },
    async anotarEstado(id, estado, at) {
      await pool.query('update tiendas set estado = $2, estado_at = $3 where id = $1', [id, JSON.stringify(estado), at]);
    },
    async avisos(id) {
      const { rows } = await pool.query<{ tipo: string; at: Date }>('select tipo, at from tiendas_avisos where tienda_id = $1 order by at desc', [id]);
      return rows.map((r) => ({ tipo: r.tipo, at: r.at }));
    },
    async anotarAviso(id, tipo, at) {
      await pool.query('insert into tiendas_avisos (tienda_id, tipo, at) values ($1, $2, $3)', [id, tipo, at]);
    },
    async config<T>(clave: string) {
      const { rows } = await pool.query<{ valor: T | string }>('select valor from tiendas_config where clave = $1', [clave]);
      const v = rows[0]?.valor;
      if (v === undefined || v === null) return null;
      return (typeof v === 'string' ? (JSON.parse(v) as T) : v) as T;
    },
    async guardarConfig(clave, valor) {
      await pool.query(
        'insert into tiendas_config (clave, valor, updated_at) values ($1, $2, now()) on conflict (clave) do update set valor = excluded.valor, updated_at = now()',
        [clave, JSON.stringify(valor)],
      );
    },
    async crearPago(input, at) {
      const { rows } = await pool.query<PagoRow>(
        `insert into tiendas_pagos (tienda_id, meses, monto, moneda, nota, imagen, estado, at)
         values ($1,$2,$3,$4,$5,$6,'pendiente',$7) returning *`,
        [input.tiendaId, input.meses, input.monto ?? null, input.moneda ?? null, input.nota ?? null, input.imagen, at],
      );
      return pagoDeFila(rows[0]!);
    },
    async pago(id) {
      const { rows } = await pool.query<PagoRow>('select * from tiendas_pagos where id = $1', [id]);
      return rows[0] ? pagoDeFila(rows[0]) : null;
    },
    async pagos(filtro = {}) {
      const where: string[] = [];
      const valores: unknown[] = [];
      if (filtro.tiendaId) {
        valores.push(filtro.tiendaId);
        where.push(`tienda_id = $${valores.length}`);
      }
      if (filtro.estado) {
        valores.push(filtro.estado);
        where.push(`estado = $${valores.length}`);
      }
      valores.push(filtro.limit ?? 200);
      const { rows } = await pool.query<PagoRow>(
        `select id, tienda_id, meses, monto, moneda, nota, null as imagen, estado, motivo, at, resuelto_at, resuelto_por from tiendas_pagos ${where.length ? `where ${where.join(' and ')}` : ''} order by at desc, id desc limit $${valores.length}`,
        valores,
      );
      return rows.map(pagoDeFila);
    },
    async resolverPago(id, cambio) {
      const { rows } = await pool.query<PagoRow>('update tiendas_pagos set estado = $2, motivo = $3, resuelto_por = $4, resuelto_at = $5 where id = $1 returning *', [id, cambio.estado, cambio.motivo, cambio.por, cambio.at]);
      return rows[0] ? pagoDeFila(rows[0]) : null;
    },
  };
}
