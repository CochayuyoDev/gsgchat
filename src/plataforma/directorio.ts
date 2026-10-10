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
 * Vive en su propia base del mismo servidor MySQL/MariaDB: `<raiz>_plataforma`
 * (con DATABASE_URL=mysql://.../gsgchat, `gsgchat_plataforma`).
 */

import { esDuplicado, type Pool } from '../db/pool.js';

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
  id varchar(64) not null primary key,
  slug varchar(64) not null unique,
  nombre varchar(191) not null,
  rubro varchar(191),
  principal tinyint(1) not null default 0,
  estado varchar(16) not null default 'activa' check (estado in ('activa', 'suspendida')),
  creada_at datetime(3) not null default current_timestamp(3),
  creada_ip varchar(64)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;
create table if not exists pl_accesos (
  usuario varchar(191) not null primary key,
  tienda_id varchar(64) not null,
  creado_at datetime(3) not null default current_timestamp(3),
  key pl_accesos_tienda (tienda_id),
  constraint pl_accesos_tienda_fk foreign key (tienda_id) references pl_tiendas (id) on delete cascade
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;
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
      await pool.query('insert into pl_tiendas (id, slug, nombre, rubro, principal, creada_ip) values ($1, $2, $3, $4, $5, $6)', [
        t.id,
        t.slug,
        t.nombre,
        t.rubro,
        t.principal ?? false,
        t.ip ?? null,
      ]);
      const [f] = await q<Fila>('select * from pl_tiendas where id = $1', [t.id]);
      return deFila(f!);
    },
    borrar: async (id) => {
      await pool.query('delete from pl_tiendas where id = $1', [id]);
    },
    slugLibre: async (slug) => (await q('select 1 from pl_tiendas where slug = $1', [slug])).length === 0,
    reservar: async (usuario, tiendaId) => {
      // Gana quien inserta primero: el segundo choca con la clave primaria.
      try {
        await pool.query('insert into pl_accesos (usuario, tienda_id) values ($1, $2)', [usuario.toLowerCase(), tiendaId]);
        return true;
      } catch (error) {
        if (esDuplicado(error)) return false;
        throw error;
      }
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
        await pool.query('insert into pl_accesos (usuario, tienda_id) values ($1, $2) on duplicate key update usuario = usuario', [nombre, tiendaId]);
        const [f] = await q<{ tienda_id: string }>('select tienda_id from pl_accesos where usuario = $1', [nombre]);
        if (f && f.tienda_id !== tiendaId) ajenos.push(nombre);
      }
      return ajenos;
    },
  };
}
