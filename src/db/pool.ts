/**
 * La base de datos: MySQL 8 o MariaDB 10.4+, con el driver mysql2.
 *
 * Los repositorios hablan con una interfaz minima y propia -`query`,
 * `connect` y `end`-, la misma que tenian con Postgres, para que cambiar de
 * motor no obligara a tocar como se llama a la base en cada fichero. Lo que
 * esta capa hace por ellos:
 *
 *  - Marcadores: acepta `?` (lo de MySQL) y tambien `$1, $2...` (se traducen
 *    a `?` en orden, repitiendo el valor si el mismo `$n` sale dos veces).
 *  - Listas: un array se expande a `?, ?, ?` para `in (...)`; uno vacio se
 *    escribe `null`, asi `x in ($1)` con [] no encuentra nada en vez de
 *    reventar. OJO: `not in (null)` tampoco devuelve nada; para "no esta en
 *    la lista" con una lista que puede venir vacia, comprobar en JS antes.
 *    Para GUARDAR un array como JSON hay que pasar JSON.stringify(array).
 *  - Objetos: un objeto plano se guarda como JSON (texto).
 *  - Tipos de vuelta: tinyint(1) llega como boolean, decimal y bigint como
 *    number, datetime como Date (en UTC), date como 'AAAA-MM-DD' y las
 *    columnas JSON como objeto, tambien en MariaDB (donde JSON es un alias de
 *    longtext y el driver no lo distingue de un texto).
 *  - Cada conexion abre en UTC, con el sql_mode estricto de MySQL 8 (asi lo
 *    que pasa en local con MariaDB es lo mismo que pasa en el servidor) y con
 *    PIPES_AS_CONCAT: `a || b` concatena, como en SQL estandar, en vez de ser
 *    un OR que devuelve 0 o 1 sin avisar.
 *
 * Una expresion booleana calculada (`count(*) > 0 as hay`) llega como 1/0: no
 * es una columna tinyint(1). Quien la necesite como boolean la convierte.
 */

import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import type { FieldPacket, PoolConnection, ResultSetHeader } from 'mysql2/promise';

export interface QueryResult<R = any> {
  rows: R[];
  /** Filas devueltas (select) o afectadas (insert/update/delete). */
  rowCount: number;
  /** El id auto_increment del ultimo insert (0 si no hubo). */
  insertId: number;
}

export interface Queryable {
  query<R = any>(text: string, params?: readonly unknown[]): Promise<QueryResult<R>>;
}

/** Una conexion apartada del pool: para transacciones (`begin` ... `commit`). */
export interface PoolClient extends Queryable {
  release(): void;
}

export interface Pool extends Queryable {
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
  /** La base a la que apunta (la de la URL o la que se paso al crearlo). */
  readonly baseDeDatos: string | null;
}

/** El sql_mode por defecto de MySQL 8, mas PIPES_AS_CONCAT (ver arriba). */
const SQL_MODE =
  'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION,PIPES_AS_CONCAT';

/** Un nombre de base que se puede pegar en SQL: letras minusculas, numeros y _. */
export function nombreDeBaseSeguro(nombre: string): string {
  if (!/^[a-z_][a-z0-9_]{0,63}$/.test(nombre)) throw new Error(`nombre de base no valido: ${nombre}`);
  return nombre;
}

/** La base que nombra la URL (mysql://usuario:clave@host:3306/base), o null. */
export function baseDeLaUrl(connectionString: string): string | null {
  const url = new URL(normalizarUrl(connectionString));
  const base = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  return base || null;
}

/** mariadb:// se acepta como sinonimo de mysql://. */
function normalizarUrl(connectionString: string): string {
  const s = connectionString.trim();
  if (/^mariadb:\/\//i.test(s)) return s.replace(/^mariadb:/i, 'mysql:');
  if (!/^mysql:\/\//i.test(s)) throw new Error('DATABASE_URL tiene que empezar por mysql:// (por ejemplo mysql://usuario:clave@localhost:3306/gsgchat)');
  return s;
}

/** Un id nuevo para las columnas uuid (char(36)). */
export function nuevoId(): string {
  return randomUUID();
}

/** Si el error es "ya existe una fila con esa clave unica". */
export function esDuplicado(error: unknown): boolean {
  const e = error as { code?: string; errno?: number };
  return e?.code === 'ER_DUP_ENTRY' || e?.errno === 1062;
}

/**
 * Un valor JSON calculado en la consulta (json_object, json_extract...): en
 * MySQL llega como objeto y en MariaDB como texto. Esto lo deja siempre como
 * objeto. Las COLUMNAS json ya llegan convertidas; esto es para expresiones.
 */
export function leerJson<T = unknown>(valor: unknown): T | null {
  if (valor == null) return null;
  if (typeof valor !== 'string') return valor as T;
  try {
    return JSON.parse(valor) as T;
  } catch {
    return valor as T;
  }
}

/**
 * `baseDeDatos`: en la plataforma cada tienda vive en su propia base del
 * mismo servidor. Todas las consultas nombran las tablas sin base, asi que
 * con la conexion apuntando a la de la tienda cada una ve SOLO sus tablas.
 * `null` conecta sin base (para crear o borrar bases); sin el argumento, la
 * base de la URL.
 */
export function createPool(connectionString: string, baseDeDatos?: string | null, opciones: { multiplesSentencias?: boolean } = {}): Pool {
  const url = new URL(normalizarUrl(connectionString));
  const base = baseDeDatos === undefined ? baseDeLaUrl(connectionString) : baseDeDatos === null ? null : nombreDeBaseSeguro(baseDeDatos);

  const crudo = mysql.createPool({
    host: url.hostname || 'localhost',
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username || 'root'),
    password: decodeURIComponent(url.password || ''),
    ...(base ? { database: base } : {}),
    connectionLimit: 10,
    connectTimeout: 5_000,
    waitForConnections: true,
    charset: 'UTF8MB4_BIN',
    timezone: 'Z',
    dateStrings: ['DATE'],
    supportBigNumbers: true,
    bigNumberStrings: false,
    decimalNumbers: true,
    multipleStatements: opciones.multiplesSentencias ?? false,
    typeCast(field, next) {
      if (field.type === 'TINY' && field.length === 1) {
        const v = field.string();
        return v === null ? null : v !== '0';
      }
      return next();
    },
  });
  // mysql2 pone la zona en los valores que MANDA; la sesion tambien tiene que
  // estar en UTC para now() y current_timestamp.
  crudo.pool.on('connection', (conexion) => {
    conexion.query(`set time_zone = '+00:00', sql_mode = '${SQL_MODE}'`);
  });

  // Las columnas JSON de MariaDB llegan como texto: se leen de information_schema
  // una vez, antes de la primera consulta, y se convierten al volver.
  let columnasJson: Promise<Set<string>> | null = null;
  const cargarColumnasJson = () =>
    (columnasJson ??= base ? leerColumnasJson(crudo) : Promise.resolve(new Set<string>()));

  const ejecutar = async (destino: mysql.Pool | PoolConnection, text: string, params?: readonly unknown[]): Promise<QueryResult> => {
    const json = await cargarColumnasJson();
    const [sql, valores] = traducir(text, params ?? []);
    const [resultado, campos] = (await destino.query(sql, valores)) as [unknown, FieldPacket[] | undefined];
    return aResultado(resultado, campos, json);
  };

  return {
    baseDeDatos: base,
    query: (text, params) => ejecutar(crudo, text, params),
    async connect() {
      const conexion = await crudo.getConnection();
      return {
        query: (text, params) => ejecutar(conexion, text, params),
        release: () => conexion.release(),
      };
    },
    end: () => crudo.end(),
  };
}

async function leerColumnasJson(crudo: mysql.Pool): Promise<Set<string>> {
  const columnas = new Set<string>();
  try {
    // MariaDB: json es longtext con un check json_valid(`columna`).
    const [filas] = (await crudo.query(
      `select table_name as t, check_clause as c from information_schema.check_constraints where constraint_schema = database() and check_clause like 'json_valid(%'`,
    )) as [Array<{ t: string; c: string }>, unknown];
    for (const f of filas) {
      const m = /json_valid\(`?([^`)]+)`?\)/i.exec(f.c);
      if (m) columnas.add(`${f.t}.${m[1]}`);
    }
  } catch {
    // MySQL 8 tambien tiene la tabla; si no la hubiera, sus JSON ya llegan como objeto.
  }
  return columnas;
}

function aResultado(resultado: unknown, campos: FieldPacket[] | undefined, json: Set<string>): QueryResult {
  if (Array.isArray(resultado)) {
    // Varias sentencias (solo en el migrador): se devuelve la ultima.
    if (resultado.length && !Array.isArray(resultado[0]) && isHeader(resultado[0]) && isHeader(resultado[resultado.length - 1])) {
      const ultimo = resultado[resultado.length - 1] as ResultSetHeader;
      return { rows: [], rowCount: ultimo.affectedRows ?? 0, insertId: Number(ultimo.insertId ?? 0) };
    }
    const filas = resultado as Record<string, unknown>[];
    if (campos && json.size) {
      const convertir = campos.filter((c) => json.has(`${(c as { orgTable?: string }).orgTable}.${(c as { orgName?: string }).orgName}`)).map((c) => c.name);
      if (convertir.length) {
        for (const fila of filas) {
          for (const nombre of convertir) {
            const v = fila[nombre];
            if (typeof v === 'string') fila[nombre] = leerJson(v);
          }
        }
      }
    }
    return { rows: filas, rowCount: filas.length, insertId: 0 };
  }
  const cabecera = resultado as ResultSetHeader;
  return { rows: [], rowCount: cabecera?.affectedRows ?? 0, insertId: Number(cabecera?.insertId ?? 0) };
}

function isHeader(x: unknown): boolean {
  return !!x && typeof x === 'object' && 'affectedRows' in (x as object);
}

/**
 * Pasa `$n` a `?` (y respeta los `?` que ya vengan), expande los arrays y
 * convierte los objetos a JSON. No toca lo que va entre comillas ni los
 * comentarios.
 */
export function traducir(text: string, params: readonly unknown[]): [string, unknown[]] {
  let sql = '';
  const valores: unknown[] = [];
  let siguiente = 0;
  let i = 0;
  const poner = (v: unknown) => {
    if (Array.isArray(v)) {
      if (!v.length) {
        sql += 'null';
        return;
      }
      sql += v.map(() => '?').join(', ');
      for (const x of v) valores.push(valor(x));
      return;
    }
    sql += '?';
    valores.push(valor(v));
  };
  while (i < text.length) {
    const c = text[i]!;
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '\\' && c !== '`') {
          j += 2;
          continue;
        }
        if (text[j] === c) {
          if (text[j + 1] === c) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      sql += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '-' && text[i + 1] === '-') {
      const j = text.indexOf('\n', i);
      const fin = j === -1 ? text.length : j;
      sql += text.slice(i, fin);
      i = fin;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const j = text.indexOf('*/', i + 2);
      const fin = j === -1 ? text.length : j + 2;
      sql += text.slice(i, fin);
      i = fin;
      continue;
    }
    if (c === '$' && /[0-9]/.test(text[i + 1] ?? '')) {
      let j = i + 1;
      while (/[0-9]/.test(text[j] ?? '')) j++;
      const n = Number(text.slice(i + 1, j));
      if (n < 1 || n > params.length) throw new Error(`la consulta usa $${n} pero solo trae ${params.length} valores`);
      poner(params[n - 1]);
      i = j;
      continue;
    }
    if (c === '?') {
      if (siguiente >= params.length) throw new Error(`la consulta tiene mas ? que valores (${params.length})`);
      poner(params[siguiente++]);
      i++;
      continue;
    }
    sql += c;
    i++;
  }
  return [sql, valores];
}

function valor(v: unknown): unknown {
  if (v === undefined) return null;
  if (v === null || v instanceof Date || Buffer.isBuffer(v)) return v;
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}
