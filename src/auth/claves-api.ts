/**
 * Claves de API: como entran los programas.
 *
 * Una integracion (el sistema de GSG, un script) no tiene usuario ni
 * contrasena: manda la cabecera `X-API-Key: wak_...` con una clave que un
 * administrador creo desde el panel. Solo en esa cabecera: con
 * `Authorization: Bearer wak_...` se responde 401 (ver recepcion-gsg.ts). La clave completa se ve una sola vez,
 * al crearla; en la base solo queda su sha256, asi que ni un volcado de la
 * tabla sirve para entrar. Revocarla es inmediato.
 */

import { createHash, randomInt } from 'node:crypto';
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
  desactivadaAt?: Date | null;
  venceAt?: Date | null;
  eliminadaAt?: Date | null;
}

export interface ClavesApiRepo {
  crear(input: { nombre: string; prefijo: string; hash: string; creadaPor: string | null; permisos?: string[]; venceAt?: Date | null }): Promise<ClaveApi>;
  listar(): Promise<ClaveApi[]>;
  /** Solo claves vigentes: una revocada no vuelve. */
  porHash(hash: string): Promise<ClaveApi | null>;
  /** Tambien las revocadas: solo para contestar «revocada» (401) en vez de «no existe». Nunca para dejar entrar. */
  porHashConRevocadas?(hash: string): Promise<ClaveApi | null>;
  revocar(id: string): Promise<boolean>;
  actualizar(id: string, patch: { nombre?: string; permisos?: string[]; activo?: boolean; venceAt?: Date | null }): Promise<ClaveApi | null>;
  renovar(id: string, hash: string, prefijo: string): Promise<ClaveApi | null>;
  eliminar(id: string, nombre: string): Promise<boolean>;
  tocarUso(id: string, at: Date): Promise<void>;
}

/**
 * El prefijo de las claves de antes. Las claves nuevas no llevan prefijo
 * (pedido del dueño, 06/10: es una API Key, sin formato «wak_»), pero las
 * que ya se entregaron con él siguen valiendo hasta que se revoquen.
 */
export const PREFIJO_CLAVE_API = 'wak_';
const PREFIJO_ANTIGUO = PREFIJO_CLAVE_API;
const ALFABETO = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
/** Largo de una clave nueva: 48 caracteres al azar (unos 285 bits). */
export const LARGO_CLAVE_API = 48;

/** Una clave nueva: 48 caracteres al azar, sin prefijo. */
export function generarClaveApi(): string {

  let cuerpo = '';
  for (let i = 0; i < LARGO_CLAVE_API; i++) cuerpo += ALFABETO[randomInt(ALFABETO.length)];
  return cuerpo;
}

export function hashClaveApi(clave: string): string {
  return createHash('sha256').update(clave).digest('hex');
}

/** Lo que se enseña en la lista: los primeros 8 caracteres, «3f9aK2xQ…». */
export function prefijoDeClave(clave: string): string {
  return clave.slice(0, 8) + '…';
}

/** Una clave nueva (48 caracteres al azar) o una de antes («wak_» y al menos 20). */
export function pareceClaveApi(valor: string): boolean {
  if (valor.startsWith(PREFIJO_ANTIGUO)) return valor.length >= PREFIJO_ANTIGUO.length + 20;
  return /^[A-Za-z0-9]{40,64}$/.test(valor);
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
  desactivada_at: Date | null;
  vence_at: Date | null;
  eliminada_at: Date | null;
}

const deFila = (r: Row): ClaveApi => ({
  id: r.id,
  nombre: r.nombre,
  prefijo: r.prefijo,
  creadaPor: r.creada_por,
  createdAt: r.created_at,
  ultimoUsoAt: r.ultimo_uso_at,
  revocadaAt: r.revocada_at,
  desactivadaAt: r.desactivada_at, venceAt: r.vence_at, eliminadaAt: r.eliminada_at,
  permisos: r.permisos?.length ? r.permisos : ['*'],
});

const COLUMNAS = 'id, nombre, prefijo, creada_por, created_at, ultimo_uso_at, revocada_at, permisos, desactivada_at, vence_at, eliminada_at';

export function createClavesApiRepo(pool: Pool): ClavesApiRepo {
  return {
    async crear(input) {
      const id = nuevoId();
      await pool.query(`insert into claves_api (id, nombre, prefijo, hash, creada_por, permisos, vence_at) values ($1,$2,$3,$4,$5,$6,$7)`, [
        id,
        input.nombre.trim(),
        input.prefijo,
        input.hash,
        input.creadaPor,
        JSON.stringify(input.permisos?.length ? input.permisos : ['*']),
        input.venceAt ?? null,
      ]);
      const { rows } = await pool.query<Row>(`select ${COLUMNAS} from claves_api where id = $1`, [id]);
      return deFila(rows[0]!);
    },
    async listar() {
      const { rows } = await pool.query<Row>(`select ${COLUMNAS} from claves_api where eliminada_at is null order by created_at desc`);
      return rows.map(deFila);
    },
    async porHash(hash) {
      const { rows } = await pool.query<Row>(
        `select ${COLUMNAS} from claves_api where hash = $1 and revocada_at is null and desactivada_at is null and eliminada_at is null and (vence_at is null or vence_at > now(3))`,
        [hash],
      );
      return rows[0] ? deFila(rows[0]) : null;
    },
    async porHashConRevocadas(hash) {
      const { rows } = await pool.query<Row>(`select ${COLUMNAS} from claves_api where hash = $1 order by (revocada_at is null) desc limit 1`, [hash]);
      return rows[0] ? deFila(rows[0]) : null;
    },
    async revocar(id) {
      const { rowCount } = await pool.query('update claves_api set revocada_at = now(3) where id = $1 and revocada_at is null', [id]);
      return (rowCount ?? 0) > 0;
    },
    async actualizar(id, patch) {
      const campos: string[] = [], valores: unknown[] = [id];
      const agregar = (col: string, valor: unknown) => { valores.push(valor); campos.push(col + ' = $' + valores.length); };
      if (patch.nombre !== undefined) agregar('nombre', patch.nombre.trim());
      if (patch.permisos !== undefined) agregar('permisos', JSON.stringify(patch.permisos));
      if (patch.activo !== undefined) agregar('desactivada_at', patch.activo ? null : new Date());
      if (patch.venceAt !== undefined) agregar('vence_at', patch.venceAt);
      if (!campos.length) return null;
      const { rowCount } = await pool.query('update claves_api set ' + campos.join(', ') + ' where id = $1 and eliminada_at is null and revocada_at is null' + (patch.activo === true ? ' and (vence_at is null or vence_at > now(3))' : ''), valores);
      if (!rowCount) return null;
      const { rows } = await pool.query<Row>('select ' + COLUMNAS + ' from claves_api where id = $1', [id]);
      return rows[0] ? deFila(rows[0]) : null;
    },
    async renovar(id, hash, prefijo) {
      const { rowCount } = await pool.query('update claves_api set hash = $2, prefijo = $3, ultimo_uso_at = null where id = $1 and eliminada_at is null and revocada_at is null', [id, hash, prefijo]);
      if (!rowCount) return null;
      const { rows } = await pool.query<Row>('select ' + COLUMNAS + ' from claves_api where id = $1', [id]);
      return rows[0] ? deFila(rows[0]) : null;
    },
    async eliminar(id, nombre) {
      const { rowCount } = await pool.query('update claves_api set eliminada_at = now(3), revocada_at = coalesce(revocada_at, now(3)), hash = $3 where id = $1 and nombre = $2 and eliminada_at is null', [id, nombre, hashClaveApi(generarClaveApi())]);
      return Boolean(rowCount);
    },
    async tocarUso(id, at) {
      await pool.query('update claves_api set ultimo_uso_at = $2 where id = $1', [id, at]);
    },
  };
}

export function claveApiVigente(c: ClaveApi, ahora = new Date()): boolean {
  return !c.revocadaAt && !c.desactivadaAt && !c.eliminadaAt && (!c.venceAt || new Date(c.venceAt).getTime() > ahora.getTime());
}
