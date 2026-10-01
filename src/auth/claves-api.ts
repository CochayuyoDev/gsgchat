/**
 * Claves de API: como entran los programas.
 *
 * Una integracion (el sistema de GSG, un script) no tiene usuario ni
 * contrasena: manda `Authorization: Bearer wak_...` con una clave que un
 * administrador creo desde el panel. La clave completa se ve una sola vez,
 * al crearla; en la base solo queda su sha256, asi que ni un volcado de la
 * tabla sirve para entrar. Revocarla es inmediato.
 */

import { createHash, randomBytes } from 'node:crypto';
import { nuevoId, type Pool } from '../db/pool.js';

export interface ClaveApi {
  id: string;
  nombre: string;
  prefijo: string;
  creadaPor: string | null;
  createdAt: Date;
  ultimoUsoAt: Date | null;
  revocadaAt: Date | null;
  /** Que puede hacer. ['*'] = todo, incluida la API interna. Ver permisos.ts. */
  permisos: string[];
}

export interface ClavesApiRepo {
  crear(input: { nombre: string; prefijo: string; hash: string; creadaPor: string | null; permisos?: string[] }): Promise<ClaveApi>;
  listar(): Promise<ClaveApi[]>;
  /** Solo claves vigentes: una revocada no vuelve. */
  porHash(hash: string): Promise<ClaveApi | null>;
  revocar(id: string): Promise<boolean>;
  tocarUso(id: string, at: Date): Promise<void>;
}

const PREFIJO = 'wak_';
const ALFABETO = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Una clave nueva: "wak_" y 40 caracteres al azar (unos 238 bits). */
export function generarClaveApi(): string {
  const bytes = randomBytes(40);
  let cuerpo = '';
  for (const b of bytes) cuerpo += ALFABETO[b % ALFABETO.length];
  return PREFIJO + cuerpo;
}

export function hashClaveApi(clave: string): string {
  return createHash('sha256').update(clave).digest('hex');
}

/** Lo que se enseña en la lista: "wak_3f9aK2…" */
export function prefijoDeClave(clave: string): string {
  return clave.slice(0, PREFIJO.length + 8) + '…';
}

export function pareceClaveApi(valor: string): boolean {
  return valor.startsWith(PREFIJO) && valor.length >= PREFIJO.length + 20;
}

export function nombreDeClaveAceptable(nombre: string): string | null {
  const n = nombre.trim();
  if (n.length < 2) return 'Ponle un nombre a la clave (para quién es).';
  if (n.length > 80) return 'El nombre es demasiado largo.';
  return null;
}

interface Row {
  id: string;
  nombre: string;
  prefijo: string;
  creada_por: string | null;
  created_at: Date;
  ultimo_uso_at: Date | null;
  revocada_at: Date | null;
  permisos: string[] | null;
}

const deFila = (r: Row): ClaveApi => ({
  id: r.id,
  nombre: r.nombre,
  prefijo: r.prefijo,
  creadaPor: r.creada_por,
  createdAt: r.created_at,
  ultimoUsoAt: r.ultimo_uso_at,
  revocadaAt: r.revocada_at,
  permisos: r.permisos?.length ? r.permisos : ['*'],
});

const COLUMNAS = 'id, nombre, prefijo, creada_por, created_at, ultimo_uso_at, revocada_at, permisos';

export function createClavesApiRepo(pool: Pool): ClavesApiRepo {
  return {
    async crear(input) {
      const id = nuevoId();
      await pool.query(`insert into claves_api (id, nombre, prefijo, hash, creada_por, permisos) values ($1,$2,$3,$4,$5,$6)`, [
        id,
        input.nombre.trim(),
        input.prefijo,
        input.hash,
        input.creadaPor,
        JSON.stringify(input.permisos?.length ? input.permisos : ['*']),
      ]);
      const { rows } = await pool.query<Row>(`select ${COLUMNAS} from claves_api where id = $1`, [id]);
      return deFila(rows[0]!);
    },
    async listar() {
      const { rows } = await pool.query<Row>(`select ${COLUMNAS} from claves_api order by created_at desc`);
      return rows.map(deFila);
    },
    async porHash(hash) {
      const { rows } = await pool.query<Row>(
        `select ${COLUMNAS} from claves_api where hash = $1 and revocada_at is null`,
        [hash],
      );
      return rows[0] ? deFila(rows[0]) : null;
    },
    async revocar(id) {
      const { rowCount } = await pool.query('update claves_api set revocada_at = now(3) where id = $1 and revocada_at is null', [id]);
      return (rowCount ?? 0) > 0;
    },
    async tocarUso(id, at) {
      await pool.query('update claves_api set ultimo_uso_at = $2 where id = $1', [id, at]);
    },
  };
}
