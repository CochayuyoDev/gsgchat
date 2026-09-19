/**
 * Los codigos de conexion: como otro sistema se conecta sin copiar claves.
 *
 * Copiar una clave `wak_…` de cuarenta caracteres de una pantalla a otra es
 * lo que mas falla en una instalacion: se pega mal, se manda por WhatsApp
 * y queda ahi para siempre, no caduca. Un codigo de conexion es corto
 * (`WA-K7M3-9QXZ`), se dicta por telefono si hace falta, **caduca solo**
 * (la fecha la elige quien lo crea), vale un numero de usos, y al canjearlo
 * el otro sistema recibe su clave de API directamente: la clave nunca pasa
 * por una persona.
 *
 * El codigo por si solo no abre nada: solo sirve para canjear. Y el canje
 * tiene tope por IP (ver routes), porque un codigo de doce letras y numeros
 * no es infinito.
 */

import { randomInt } from 'node:crypto';
import type { Pool } from '../db/pool.js';

export type EstadoCodigo = 'activo' | 'usado' | 'caducado' | 'anulado';

export interface CodigoConexion {
  id: string;
  codigo: string;
  para: string;
  permisos: string[];
  caducaAt: Date;
  usosMax: number;
  usos: number;
  /** Lo guardado: activo o anulado. El estado real se calcula con `estadoDe`. */
  estado: 'activo' | 'anulado';
  creadoPor: string | null;
  canjeadoPor: string | null;
  canjeadoDesde: string | null;
  canjeadoAt: Date | null;
  claveId: string | null;
  createdAt: Date;
}

export interface CodigosConexionRepo {
  crear(input: { codigo: string; para: string; permisos: string[]; caducaAt: Date; usosMax: number; creadoPor: string | null }): Promise<CodigoConexion>;
  porCodigo(codigo: string): Promise<CodigoConexion | null>;
  porId(id: string): Promise<CodigoConexion | null>;
  listar(limite?: number): Promise<CodigoConexion[]>;
  /**
   * Un canje: suma un uso y apunta quien fue, si aun quedaban usos y el
   * codigo estaba activo y vigente. Devuelve null si no se pudo (asi dos
   * canjes a la vez no se cuelan los dos por el mismo ultimo uso).
   */
  canjear(id: string, datos: { por: string; desde: string; claveId: string; ahora: Date }): Promise<CodigoConexion | null>;
  anular(id: string): Promise<boolean>;
}

interface Row {
  id: string;
  codigo: string;
  para: string;
  permisos: string[] | string;
  caduca_at: Date;
  usos_max: number | string;
  usos: number | string;
  estado: 'activo' | 'anulado';
  creado_por: string | null;
  canjeado_por: string | null;
  canjeado_desde: string | null;
  canjeado_at: Date | null;
  clave_id: string | null;
  created_at: Date;
}

const deFila = (r: Row): CodigoConexion => ({
  id: r.id,
  codigo: r.codigo,
  para: r.para,
  permisos: typeof r.permisos === 'string' ? (JSON.parse(r.permisos) as string[]) : r.permisos,
  caducaAt: r.caduca_at,
  usosMax: Number(r.usos_max),
  usos: Number(r.usos),
  estado: r.estado,
  creadoPor: r.creado_por,
  canjeadoPor: r.canjeado_por,
  canjeadoDesde: r.canjeado_desde,
  canjeadoAt: r.canjeado_at,
  claveId: r.clave_id,
  createdAt: r.created_at,
});

/** Sin letras que se confundan (0/O, 1/I/L): se dicta por telefono sin errores. */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generarCodigoConexion(): string {
  const trozo = () => Array.from({ length: 4 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');
  return `WA-${trozo()}-${trozo()}`;
}

/** Como lo escribe la gente (minusculas, sin guiones, con espacios) → como se guardo. */
export function normalizarCodigo(texto: string): string {
  const limpio = texto.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const sinPrefijo = limpio.startsWith('WA') ? limpio.slice(2) : limpio;
  if (sinPrefijo.length !== 8) return limpio;
  return `WA-${sinPrefijo.slice(0, 4)}-${sinPrefijo.slice(4)}`;
}

export function estadoDe(c: CodigoConexion, ahora: Date): EstadoCodigo {
  if (c.estado === 'anulado') return 'anulado';
  if (c.usos >= c.usosMax) return 'usado';
  if (c.caducaAt.getTime() <= ahora.getTime()) return 'caducado';
  return 'activo';
}

export function createCodigosConexionRepo(pool: Pool): CodigosConexionRepo {
  return {
    async crear(input) {
      const { rows } = await pool.query<Row>(
        `insert into codigos_conexion (codigo, para, permisos, caduca_at, usos_max, creado_por)
         values ($1,$2,$3,$4,$5,$6) returning *`,
        [input.codigo, input.para, JSON.stringify(input.permisos), input.caducaAt, input.usosMax, input.creadoPor],
      );
      return deFila(rows[0]!);
    },
    async porCodigo(codigo) {
      const { rows } = await pool.query<Row>('select * from codigos_conexion where codigo = $1', [codigo]);
      return rows[0] ? deFila(rows[0]) : null;
    },
    async porId(id) {
      const { rows } = await pool.query<Row>('select * from codigos_conexion where id = $1', [id]);
      return rows[0] ? deFila(rows[0]) : null;
    },
    async listar(limite = 100) {
      const { rows } = await pool.query<Row>('select * from codigos_conexion order by created_at desc limit $1', [limite]);
      return rows.map(deFila);
    },
    async canjear(id, datos) {
      const { rows } = await pool.query<Row>(
        `update codigos_conexion
            set usos = usos + 1, canjeado_por = $2, canjeado_desde = $3, canjeado_at = $4, clave_id = $5
          where id = $1 and estado = 'activo' and usos < usos_max and caduca_at > $4
          returning *`,
        [id, datos.por, datos.desde, datos.ahora, datos.claveId],
      );
      return rows[0] ? deFila(rows[0]) : null;
    },
    async anular(id) {
      const { rowCount } = await pool.query(`update codigos_conexion set estado = 'anulado' where id = $1 and estado = 'activo'`, [id]);
      return (rowCount ?? 0) > 0;
    },
  };
}
