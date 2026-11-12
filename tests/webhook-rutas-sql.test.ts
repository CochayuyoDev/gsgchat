/**
 * El webhook de rutas contra MySQL de verdad (ver tests/mysql.ts): la
 * migracion 021 se aplica, el estado de la ruta se reescribe, un chat cerrado
 * por dos rutas, la bitacora y la huella del secreto.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRepos, type Repos } from '../src/db/repos.js';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';

let b: BaseDePrueba;
let repos: Repos;

beforeAll(async () => {
  b = await baseDePrueba();
  repos = createRepos(b.pool);
});
afterAll(async () => {
  await b?.cerrar();
});

describe('webhook de rutas (MySQL)', () => {
  it('guarda y reescribe el estado de una ruta', async () => {
    const t = new Date('2026-11-12T15:00:00.000Z');
    await repos.rutasGsg.guardarRuta({ ruta: 'R-SQL', estado: 'INACTIVA', activa: false, cambiadoAt: t, recibidoAt: t });
    expect(await repos.rutasGsg.ruta('R-SQL')).toMatchObject({ estado: 'INACTIVA', activa: false });
    await repos.rutasGsg.guardarRuta({ ruta: 'R-SQL', estado: 'EN RUTA', activa: true, cambiadoAt: new Date(t.getTime() + 1000), recibidoAt: t });
    expect(await repos.rutasGsg.ruta('R-SQL')).toMatchObject({ estado: 'EN RUTA', activa: true });
  });

  it('cierra un chat por dos rutas y lo abre cuando se abren las dos', async () => {
    const c = await repos.contacts.upsertFromInbound('51900777001');
    const t = new Date('2026-11-12T16:00:00.000Z');
    expect(await repos.rutasGsg.bloquear([c.id, c.id], 'R-1', 'INACTIVA', t)).toBe(1);
    await repos.rutasGsg.bloquear([c.id], 'R-2', 'FINALIZADA', new Date(t.getTime() + 1000));
    expect(await repos.rutasGsg.bloqueoDe(c.id)).toMatchObject({ ruta: 'R-2', estado: 'FINALIZADA' });
    expect(await repos.rutasGsg.desbloquear('R-2')).toEqual([c.id]);
    expect(await repos.rutasGsg.bloqueoDe(c.id)).toMatchObject({ ruta: 'R-1' });
    await repos.rutasGsg.desbloquear('R-1');
    expect(await repos.rutasGsg.bloqueoDe(c.id)).toBeNull();
  });

  it('lista las rutas (las cerradas primero) con cuántos chats tienen cerrados', async () => {
    const c = await repos.contacts.upsertFromInbound('51900777002');
    const t = new Date('2026-11-12T17:00:00.000Z');
    await repos.rutasGsg.guardarRuta({ ruta: 'R-LISTA', estado: 'INACTIVA', activa: false, cambiadoAt: t, recibidoAt: t });
    await repos.rutasGsg.bloquear([c.id], 'R-LISTA', 'INACTIVA', t);
    const lista = await repos.rutasGsg.rutas(50);
    expect(lista[0]).toMatchObject({ ruta: 'R-LISTA', activa: false, chatsCerrados: 1 });
  });

  it('anota y cierra los avisos en la bitácora', async () => {
    const id = await repos.rutasGsg.anotarEvento({ recibidoAt: new Date(), ruta: 'R-EV', estado: 'INACTIVA', cambiadoAt: new Date(), resultado: 'recibido', detalle: 'Recibido', chats: 0, prueba: true });
    expect(id).toBeGreaterThan(0);
    await repos.rutasGsg.cerrarEvento(id, 'aplicado', 'Cierra los chats.', 3);
    expect((await repos.rutasGsg.eventos(1))[0]).toMatchObject({ id, ruta: 'R-EV', resultado: 'aplicado', chats: 3, prueba: true });
  });

  it('guarda solo la huella del secreto y la reemplaza', async () => {
    await repos.rutasGsg.guardarSecreto('a'.repeat(64), 'abcd', new Date());
    await repos.rutasGsg.guardarSecreto('b'.repeat(64), 'wxyz', new Date());
    expect(await repos.rutasGsg.secreto()).toMatchObject({ hash: 'b'.repeat(64), ultimos: 'wxyz' });
  });
});
