/**
 * La capa de MySQL/MariaDB (src/db/pool.ts): marcadores, listas, tipos de
 * vuelta y el banco de bases de tienda. Contra el servidor de pruebas.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { traducir, esDuplicado, nuevoId } from '../src/db/pool.js';
import { existeBase, prepararBase, borrarBase } from '../src/db/bases.js';
import { baseDePrueba, bancoDePrueba, devolverBasesDePrueba, PREFIJO_PRUEBAS, type BaseDePrueba } from './mysql.js';

describe('traducir', () => {
  it('pasa $n a ? en orden, repitiendo los que salen dos veces', () => {
    expect(traducir('select $2, $1, $2', ['a', 'b'])).toEqual(['select ?, ?, ?', ['b', 'a', 'b']]);
  });
  it('respeta los ? que ya vienen', () => {
    expect(traducir('select ? , ?', [1, 2])).toEqual(['select ? , ?', [1, 2]]);
  });
  it('expande las listas y la vacia es null', () => {
    expect(traducir('x in ($1) and y in ($2)', [[1, 2, 3], []])).toEqual(['x in (?, ?, ?) and y in (null)', [1, 2, 3]]);
  });
  it('no toca lo que va entre comillas ni en comentarios', () => {
    expect(traducir("select '$1 ?', `a?` -- $1 ?\n, $1", ['v'])).toEqual(["select '$1 ?', `a?` -- $1 ?\n, ?", ['v']]);
  });
  it('los objetos van como JSON y undefined como null', () => {
    expect(traducir('values ($1, $2)', [{ a: 1 }, undefined])).toEqual(['values (?, ?)', ['{"a":1}', null]]);
  });
  it('avisa si falta un valor', () => {
    expect(() => traducir('select $3', [1])).toThrow(/\$3/);
  });
});

describe('contra el servidor', () => {
  let b: BaseDePrueba;
  beforeAll(async () => {
    b = await baseDePrueba();
  });
  afterAll(async () => {
    await b?.cerrar();
  });

  it('devuelve boolean, JSON, fechas en UTC y numeros', async () => {
    const id = nuevoId();
    await b.pool.query(
      `insert into contacts (id, phone, created_at) values ($1, '51999000111', $2)`,
      [id, new Date('2026-01-02T03:04:05.678Z')],
    );
    await b.pool.query(`insert into salud_eventos (tipo, payload, contact_id) values ('nota', $1, $2)`, [{ x: [1, 2] }, id]);
    const { rows } = await b.pool.query(
      `select c.created_at, c.opt_in_at, e.payload as datos, e.id, (select count(*) from contacts) as n, (select sum(1.5)) as s
         from contacts c join salud_eventos e on e.contact_id = c.id where c.id = $1`,
      [id],
    );
    expect(rows[0].created_at).toEqual(new Date('2026-01-02T03:04:05.678Z'));
    expect(rows[0].opt_in_at).toBeNull();
    expect(rows[0].datos).toEqual({ x: [1, 2] });
    expect(typeof rows[0].id).toBe('number');
    expect(rows[0].n).toBe(1);
    expect(rows[0].s).toBe(1.5);
    const bool = await b.pool.query(`select paused from number_state where phone_number_id = 'x'`);
    expect(bool.rows).toEqual([]);
    await b.pool.query(`insert into number_state (phone_number_id) values ('x')`);
    const est = await b.pool.query(`select paused, warmup_started_on from number_state where phone_number_id = 'x'`);
    expect(est.rows[0].paused).toBe(false);
    expect(est.rows[0].warmup_started_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('la sesion va en UTC y || concatena', async () => {
    const { rows } = await b.pool.query(`select 'a' || 'b' as c, timestampdiff(minute, utc_timestamp(), now()) as d`);
    expect(rows[0]).toEqual({ c: 'ab', d: 0 });
  });

  it('una clave repetida se reconoce', async () => {
    await b.pool.query(`insert into settings (\`key\`, value) values ('k', 'v')`).catch(() => undefined);
    const e = await b.pool.query(`insert into settings (\`key\`, value) values ('k', 'v')`).catch((x) => x);
    expect(esDuplicado(e)).toBe(true);
  });

  it('una transaccion se deshace', async () => {
    const c = await b.pool.connect();
    await c.query('begin');
    await c.query(`insert into settings (\`key\`, value) values ('tx', 'v')`);
    await c.query('rollback');
    c.release();
    expect((await b.pool.query(`select 1 from settings where \`key\` = 'tx'`)).rowCount).toBe(0);
  });
});

describe('banco de bases de tienda', () => {
  const o = bancoDePrueba(`${PREFIJO_PRUEBAS}capa_`, 1);
  afterAll(async () => {
    await devolverBasesDePrueba(o);
  });

  it('una tienda nueva se queda con una base del banco, con sus tablas', async () => {
    const destino = `${PREFIJO_PRUEBAS}capa_t1`;
    await borrarBase(o.url, destino);
    await prepararBase(o, destino);
    expect(await existeBase(o.url, destino)).toBe(true);
  }, 900_000);
});
