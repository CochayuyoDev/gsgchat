/**
 * Bases de tienda listas de antemano.
 *
 * Crear las ~50 tablas de una tienda es DDL puro: en un disco lento son
 * decenas de segundos (en un SSD, uno o dos). Para que quien se registra no
 * espere, se tiene de reserva una base ya migrada y VACIA -el "banco"- y la
 * tienda nueva se queda con sus tablas: `rename table banco.t to tienda.t`
 * mueve cada tabla de base sin copiar nada, y todas en una sola sentencia
 * (atomica: dos registros a la vez no se llevan la misma). Despues el banco se
 * rellena en segundo plano.
 *
 * Una base del banco se reconoce por su tabla `gsgchat_banco` con la firma de
 * las migraciones: si las migraciones cambian, la firma no cuadra y esa base
 * se descarta (se borra y se rehace).
 *
 * Las pruebas tambien DEVUELVEN bases al banco al terminar (vaciadas), para
 * no pagar el DDL en cada ejecucion.
 */

import { createPool, nombreDeBaseSeguro, type Pool } from './pool.js';
import { crearBaseSiNoExiste, firmaDeMigraciones, migrate, nombresDeMigraciones } from './migrate.js';

const TABLA_BANCO = 'gsgchat_banco';

export interface OpcionesBanco {
  url: string;
  /** Prefijo de las bases del banco: `<prefijo>banco_<n>`. */
  prefijo: string;
  /** Cuantas bases listas tener de reserva. */
  reserva?: number;
}

async function conAdmin<T>(url: string, fn: (admin: Pool) => Promise<T>): Promise<T> {
  const admin = createPool(url, null);
  try {
    return await fn(admin);
  } finally {
    await admin.end();
  }
}

async function tablasDe(admin: Pool, base: string): Promise<string[]> {
  const { rows } = await admin.query<{ t: string }>(
    `select table_name as t from information_schema.tables where table_schema = ? and table_type = 'BASE TABLE'`,
    [base],
  );
  return rows.map((r) => r.t);
}

export async function existeBase(url: string, base: string): Promise<boolean> {
  return conAdmin(url, async (admin) => (await admin.query('select 1 from information_schema.schemata where schema_name = ?', [base])).rowCount > 0);
}

export async function borrarBase(url: string, base: string): Promise<void> {
  await conAdmin(url, (admin) => tirarBase(admin, base));
}

/** drop database sin que lo frene una clave foranea a medio mover (entre bases). */
async function tirarBase(admin: Pool, base: string): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('set foreign_key_checks = 0');
    await client.query(`drop database if exists \`${nombreDeBaseSeguro(base)}\``);
  } finally {
    await client.query('set foreign_key_checks = 1').catch(() => undefined);
    client.release();
  }
}

/** Las bases del banco que estan listas (con la firma de hoy). */
async function bancoListo(admin: Pool, o: OpcionesBanco, firma: string): Promise<string[]> {
  const { rows } = await admin.query<{ b: string }>(
    `select table_schema as b from information_schema.tables where table_name = ? and table_schema like ? order by table_schema`,
    [TABLA_BANCO, `${o.prefijo.replace(/_/g, '\\_')}banco\\_%`],
  );
  const listas: string[] = [];
  for (const { b } of rows) {
    const f = await admin.query<{ firma: string }>(`select firma from \`${nombreDeBaseSeguro(b)}\`.${TABLA_BANCO} limit 1`).catch(() => null);
    if (f?.rows[0]?.firma === firma) listas.push(b);
    else await tirarBase(admin, nombreDeBaseSeguro(b));
  }
  await limpiarAbandonadas(admin, o);
  return listas;
}

/**
 * Una base del banco que se empezo a crear y nunca se marco (el proceso se
 * corto a mitad) se queda sin `gsgchat_banco` para siempre. El nombre lleva
 * la hora en que se empezo: pasada una hora sin marca, ya no se va a terminar.
 */
async function limpiarAbandonadas(admin: Pool, o: OpcionesBanco): Promise<void> {
  const prefijo = `${o.prefijo}banco_`;
  const { rows } = await admin.query<{ b: string }>(
    `select s.schema_name as b from information_schema.schemata s
      where s.schema_name like ?
        and not exists (select 1 from information_schema.tables t where t.table_schema = s.schema_name and t.table_name = ?)`,
    [`${prefijo.replace(/_/g, '\\_')}%`, TABLA_BANCO],
  );
  for (const { b } of rows) {
    const empezada = Number.parseInt(b.slice(prefijo.length, prefijo.length + 8), 36);
    if (Number.isFinite(empezada) && Date.now() - empezada > 60 * 60_000) await tirarBase(admin, b);
  }
}

function nombreDeBanco(o: OpcionesBanco): string {
  // Date.now() en base 36 son 8 caracteres hasta el ano 2059: limpiarAbandonadas lo lee.
  return nombreDeBaseSeguro(`${o.prefijo}banco_${Date.now().toString(36).padStart(8, '0')}${Math.random().toString(36).slice(2, 6)}`);
}

async function marcar(admin: Pool, base: string, firma: string): Promise<void> {
  await admin.query(`create table if not exists \`${base}\`.${TABLA_BANCO} (firma varchar(64) not null) engine=InnoDB`);
  await admin.query(`delete from \`${base}\`.${TABLA_BANCO}`);
  await admin.query(`insert into \`${base}\`.${TABLA_BANCO} (firma) values (?)`, [firma]);
}

let rellenando: Promise<void> | null = null;

/** Deja `reserva` bases listas en el banco (una detras de otra; no se pisan). */
export function rellenarBanco(o: OpcionesBanco): Promise<void> {
  const tarea = (rellenando ?? Promise.resolve()).then(async () => {
    const firma = await firmaDeMigraciones();
    const faltan = await conAdmin(o.url, async (admin) => (o.reserva ?? 1) - (await bancoListo(admin, o, firma)).length);
    for (let i = 0; i < faltan; i++) {
      const base = nombreDeBanco(o);
      await migrate(o.url, base);
      await conAdmin(o.url, (admin) => marcar(admin, base, firma));
    }
  });
  rellenando = tarea.catch(() => undefined);
  return tarea;
}

/**
 * Deja lista la base `destino` de una tienda: si ya existe, solo le pasa las
 * migraciones pendientes; si no, se queda las tablas de una base del banco (y
 * si el banco esta vacio, se migra desde cero). Devuelve si salio del banco.
 */
export async function prepararBase(o: OpcionesBanco, destino: string): Promise<boolean> {
  nombreDeBaseSeguro(destino);
  if (await existeBase(o.url, destino)) {
    await migrate(o.url, destino);
    return false;
  }
  const firma = await firmaDeMigraciones();
  const tomada = await conAdmin(o.url, async (admin) => {
    for (const banco of await bancoListo(admin, o, firma)) {
      const tablas = (await tablasDe(admin, banco)).filter((t) => t !== TABLA_BANCO);
      if (!tablas.length) continue;
      await crearBaseSiNoExiste(o.url, destino);
      try {
        await admin.query(`rename table ${tablas.map((t) => `\`${banco}\`.\`${t}\` to \`${destino}\`.\`${t}\``).join(', ')}`);
      } catch {
        // Otro registro se la llevo entre medias: se prueba con la siguiente.
        continue;
      }
      await tirarBase(admin, banco);
      return true;
    }
    return false;
  });
  // Desde el banco no queda nada pendiente, salvo que las migraciones cambiaran justo ahora.
  await migrate(o.url, destino);
  return tomada;
}

/**
 * Vacia la base (todas las filas, la estructura se queda) y la devuelve al
 * banco en vez de borrarla. Lo usan las pruebas: la proxima tienda que se
 * cree no paga el DDL.
 */
export async function devolverAlBanco(o: OpcionesBanco, base: string): Promise<void> {
  nombreDeBaseSeguro(base);
  const firma = await firmaDeMigraciones();
  await conAdmin(o.url, async (admin) => {
    const tablas = await tablasDe(admin, base);
    if (!tablas.length) {
      await tirarBase(admin, base);
      return;
    }
    // Solo vuelve al banco una base con TODAS las migraciones de hoy; una a
    // medio migrar (o de otra version) se borra sin moverla.
    const hechas = await admin.query<{ name: string }>(`select name from \`${base}\`.schema_migrations order by name`).catch(() => null);
    if (!hechas || hechas.rows.map((r) => r.name).join('\n') !== (await nombresDeMigraciones()).join('\n')) {
      await tirarBase(admin, base);
      return;
    }
    await vaciar(admin, base, tablas);
    const banco = nombreDeBanco(o);
    await crearBaseSiNoExiste(o.url, banco);
    await admin.query(`rename table ${tablas.map((t) => `\`${base}\`.\`${t}\` to \`${banco}\`.\`${t}\``).join(', ')}`);
    await tirarBase(admin, base);
    await marcar(admin, banco, firma);
  });
}

/** Borra las filas de todas las tablas (menos el registro de migraciones). */
export async function vaciar(admin: Pool, base: string, tablas?: string[]): Promise<void> {
  const lista = (tablas ?? (await tablasDe(admin, base))).filter((t) => t !== 'schema_migrations' && t !== TABLA_BANCO);
  const client = await admin.connect();
  try {
    await client.query('set foreign_key_checks = 0');
    for (const t of lista) await client.query(`delete from \`${nombreDeBaseSeguro(base)}\`.\`${t}\``);
  } finally {
    await client.query('set foreign_key_checks = 1').catch(() => undefined);
    client.release();
  }
}
