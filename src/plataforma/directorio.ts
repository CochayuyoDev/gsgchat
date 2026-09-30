/**
 * El directorio de la plataforma: que tiendas hay y de que tienda es cada
 * usuario.
 *
 * Es lo UNICO que se comparte entre tiendas, y no guarda nada de su negocio:
 * ni clientes, ni mensajes, ni contraseñas (esas viven en la base de cada
 * tienda). Existe porque se entra con usuario y contraseña, sin decir la
 * tienda: la plataforma mira aqui a que tienda va ese usuario y le pasa la
 * contraseña a ELLA, que es quien la comprueba.
 *
 * Vive en su propia base: una carpeta PGlite (`<raiz>/plataforma`) o el
 * esquema `plataforma` de Postgres.
 */

import type { Pool } from '../db/pool.js';

export interface TiendaRegistrada {
  id: string;
  slug: string;
  nombre: string;
  rubro: string | null;
  /** La tienda de siempre (la instalacion de antes de la plataforma): usa las carpetas y la base de antes. */
  principal: boolean;
  estado: 'activa' | 'suspendida';
  creadaAt: Date;
}

export const ESQUEMA_DIRECTORIO = `
create table if not exists pl_tiendas (
  id text primary key,
  slug text not null unique,
  nombre text not null,
  rubro text,
  principal boolean not null default false,
  estado text not null default 'activa' check (estado in ('activa', 'suspendida')),
  creada_at timestamptz not null default now(),
  creada_ip text
);
create table if not exists pl_accesos (
  usuario text primary key,
  tienda_id text not null references pl_tiendas(id) on delete cascade,
  creado_at timestamptz not null default now()
);
create index if not exists pl_accesos_tienda on pl_accesos (tienda_id);
`;

export interface Directorio {
  tiendas(): Promise<TiendaRegistrada[]>;
  porId(id: string): Promise<TiendaRegistrada | null>;
  porSlug(slug: string): Promise<TiendaRegistrada | null>;
  crear(t: { id: string; slug: string; nombre: string; rubro: string | null; principal?: boolean; ip?: string | null }): Promise<TiendaRegistrada>;
  /** Solo para deshacer un registro que fallo a medias. */
  borrar(id: string): Promise<void>;
  slugLibre(slug: string): Promise<boolean>;
  /** Aparta un usuario para una tienda. false = ya es de alguien (de esta o de otra). */
  reservar(usuario: string, tiendaId: string): Promise<boolean>;
  liberar(usuario: string, tiendaId: string): Promise<void>;
  tiendaDe(usuario: string): Promise<string | null>;
  /**
   * Apunta las cuentas que ya tiene una tienda (la principal al pasar a la
   * plataforma, o cualquiera tras un corte a medias). Devuelve las que no se
   * pudieron apuntar porque ese usuario ya es de otra tienda.
   */
  sincronizar(tiendaId: string, usuarios: string[]): Promise<string[]>;
}

type Fila = { id: string; slug: string; nombre: string; rubro: string | null; principal: boolean; estado: 'activa' | 'suspendida'; creada_at: Date | string };

const deFila = (f: Fila): TiendaRegistrada => ({
  id: f.id,
  slug: f.slug,
  nombre: f.nombre,
  rubro: f.rubro,
  principal: Boolean(f.principal),
  estado: f.estado,
  creadaAt: f.creada_at instanceof Date ? f.creada_at : new Date(f.creada_at),
});

export async function crearDirectorio(pool: Pool): Promise<Directorio> {
  for (const sentencia of ESQUEMA_DIRECTORIO.split(';').map((s) => s.trim()).filter(Boolean)) {
    await pool.query(sentencia);
  }

  const q = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => (await pool.query(sql, params)).rows as T[];

  return {
    tiendas: async () => (await q<Fila>('select * from pl_tiendas order by principal desc, creada_at')).map(deFila),
    porId: async (id) => {
      const [f] = await q<Fila>('select * from pl_tiendas where id = $1', [id]);
      return f ? deFila(f) : null;
    },
    porSlug: async (slug) => {
      const [f] = await q<Fila>('select * from pl_tiendas where slug = $1', [slug]);
      return f ? deFila(f) : null;
    },
    crear: async (t) => {
      const [f] = await q<Fila>(
        'insert into pl_tiendas (id, slug, nombre, rubro, principal, creada_ip) values ($1, $2, $3, $4, $5, $6) returning *',
        [t.id, t.slug, t.nombre, t.rubro, t.principal ?? false, t.ip ?? null],
      );
      return deFila(f!);
    },
    borrar: async (id) => {
      await pool.query('delete from pl_tiendas where id = $1', [id]);
    },
    slugLibre: async (slug) => (await q('select 1 from pl_tiendas where slug = $1', [slug])).length === 0,
    reservar: async (usuario, tiendaId) => {
      const filas = await q<{ tienda_id: string }>(
        'insert into pl_accesos (usuario, tienda_id) values ($1, $2) on conflict (usuario) do nothing returning tienda_id',
        [usuario.toLowerCase(), tiendaId],
      );
      return filas.length === 1;
    },
    liberar: async (usuario, tiendaId) => {
      await pool.query('delete from pl_accesos where usuario = $1 and tienda_id = $2', [usuario.toLowerCase(), tiendaId]);
    },
    tiendaDe: async (usuario) => {
      const [f] = await q<{ tienda_id: string }>('select tienda_id from pl_accesos where usuario = $1', [usuario.trim().toLowerCase()]);
      return f?.tienda_id ?? null;
    },
    sincronizar: async (tiendaId, usuarios) => {
      const ajenos: string[] = [];
      for (const u of usuarios) {
        const nombre = u.toLowerCase();
        await pool.query('insert into pl_accesos (usuario, tienda_id) values ($1, $2) on conflict (usuario) do nothing', [nombre, tiendaId]);
        const [f] = await q<{ tienda_id: string }>('select tienda_id from pl_accesos where usuario = $1', [nombre]);
        if (f && f.tienda_id !== tiendaId) ajenos.push(nombre);
      }
      return ajenos;
    },
  };
}
