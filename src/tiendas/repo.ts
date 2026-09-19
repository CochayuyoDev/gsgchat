/**
 * Las tiendas del superadministrador: solo filas.
 *
 * Quien decide plan, pagos y suspensiones es `servicio.ts`; aqui van las
 * consultas. La membresia de cada tienda se guarda como JSON con la misma
 * forma que la membresia local de una instancia (`MembresiaLocal`), asi el
 * plan que se le manda a la tienda se calcula con el mismo codigo.
 */

import type { Pool } from '../db/pool.js';
import type { MembresiaLocal } from '../plan/servicio.js';

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
  creadoPor: string | null;
  createdAt: Date;
  updatedAt: Date;
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
  creado_por: string | null;
  created_at: Date;
  updated_at: Date;
}

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
  };
}
