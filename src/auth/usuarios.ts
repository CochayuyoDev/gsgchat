/**
 * Usuarios del sistema y sus contrasenas.
 *
 * Las contrasenas se guardan con scrypt (viene con Node, sin dependencias)
 * y una sal distinta por usuario. Comparar es en tiempo constante. Cambiar
 * la contrasena sube `sesionVersion`, y con eso las cookies firmadas con la
 * version anterior dejan de valer: cerrar sesion en todos lados sin tabla de
 * sesiones.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Pool } from '../db/pool.js';

export type Rol = 'admin' | 'operador';

export interface Usuario {
  id: string;
  usuario: string;
  nombre: string;
  rol: Rol;
  activo: boolean;
  sesionVersion: number;
  ultimoLoginAt: Date | null;
  createdAt: Date;
}

export interface UsuarioConClave extends Usuario {
  clave: string;
}

export interface UsuariosRepo {
  contar(): Promise<number>;
  porUsuario(usuario: string): Promise<UsuarioConClave | null>;
  porId(id: string): Promise<Usuario | null>;
  crear(input: { usuario: string; nombre: string; clave: string; rol: Rol }): Promise<Usuario>;
  listar(): Promise<Usuario[]>;
  /** Cambia la contrasena y sube la version de sesion. */
  cambiarClave(id: string, clave: string): Promise<void>;
  setActivo(id: string, activo: boolean): Promise<void>;
  setRol(id: string, rol: Rol): Promise<void>;
  tocarLogin(id: string, at: Date): Promise<void>;
}

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashClave(clave: string): string {
  const sal = randomBytes(16);
  const hash = scryptSync(clave, sal, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${sal.toString('hex')}$${hash.toString('hex')}`;
}

export function verificarClave(clave: string, guardada: string): boolean {
  const [algoritmo, salHex, hashHex] = guardada.split('$');
  if (algoritmo !== 'scrypt' || !salHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const calculado = scryptSync(clave, Buffer.from(salHex, 'hex'), esperado.length, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
}

/** Lo minimo para no aceptar "1234": ocho caracteres. */
export function claveAceptable(clave: string): string | null {
  if (clave.length < 8) return 'La contraseña necesita al menos 8 caracteres.';
  if (clave.length > 200) return 'La contraseña es demasiado larga.';
  return null;
}

export function usuarioAceptable(usuario: string): string | null {
  if (!/^[a-z0-9._-]{3,40}$/.test(usuario)) {
    return 'El usuario lleva entre 3 y 40 caracteres: minúsculas, números, punto, guion o guion bajo.';
  }
  return null;
}

interface Row {
  id: string;
  usuario: string;
  nombre: string;
  clave: string;
  rol: Rol;
  activo: boolean;
  sesion_version: number;
  ultimo_login_at: Date | null;
  created_at: Date;
}

const sinClave = (r: Row): Usuario => ({
  id: r.id,
  usuario: r.usuario,
  nombre: r.nombre,
  rol: r.rol,
  activo: r.activo,
  sesionVersion: r.sesion_version,
  ultimoLoginAt: r.ultimo_login_at,
  createdAt: r.created_at,
});

export function createUsuariosRepo(pool: Pool): UsuariosRepo {
  return {
    async contar() {
      const { rows } = await pool.query<{ total: number }>('select count(*)::int as total from usuarios');
      return rows[0]?.total ?? 0;
    },
    async porUsuario(usuario) {
      const { rows } = await pool.query<Row>('select * from usuarios where usuario = $1', [usuario.trim().toLowerCase()]);
      return rows[0] ? { ...sinClave(rows[0]), clave: rows[0].clave } : null;
    },
    async porId(id) {
      const { rows } = await pool.query<Row>('select * from usuarios where id = $1', [id]);
      return rows[0] ? sinClave(rows[0]) : null;
    },
    async crear(input) {
      const { rows } = await pool.query<Row>(
        `insert into usuarios (usuario, nombre, clave, rol) values ($1,$2,$3,$4) returning *`,
        [input.usuario.trim().toLowerCase(), input.nombre.trim(), input.clave, input.rol],
      );
      return sinClave(rows[0]!);
    },
    async listar() {
      const { rows } = await pool.query<Row>('select * from usuarios order by created_at');
      return rows.map(sinClave);
    },
    async cambiarClave(id, clave) {
      await pool.query('update usuarios set clave = $2, sesion_version = sesion_version + 1 where id = $1', [id, clave]);
    },
    async setActivo(id, activo) {
      // Desactivar tambien cierra sus sesiones.
      await pool.query(
        'update usuarios set activo = $2, sesion_version = sesion_version + case when $2 then 0 else 1 end where id = $1',
        [id, activo],
      );
    },
    async setRol(id, rol) {
      await pool.query('update usuarios set rol = $2 where id = $1', [id, rol]);
    },
    async tocarLogin(id, at) {
      await pool.query('update usuarios set ultimo_login_at = $2 where id = $1', [id, at]);
    },
  };
}
