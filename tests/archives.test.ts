/**
 * Respaldo y limpieza de conversaciones.
 *
 * Se prueba contra Postgres de verdad (PGlite) y con ficheros de verdad en un
 * directorio temporal, porque lo que hay que demostrar no es que las funciones
 * se llamen: es que despues de borrar el hilo, lo hablado sigue existiendo y
 * se puede volver a leer. Eso solo se ve con el fichero delante.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from '../src/db/pool.js';
import { createRepos, type Repos } from '../src/db/repos.js';
import {
  archivarConversacion,
  barrerInactivas,
  leerRespaldo,
  restaurarRespaldo,
  revisarRespaldos,
} from '../src/archive/service.js';
import { rutaDe } from '../src/archive/store.js';

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');

function asPool(db: PGlite): Pool {
  const query = async (text: string, params?: unknown[]) => {
    const result = await db.query(text, params as never[], {
      parsers: { 20: (v: string) => Number.parseInt(v, 10) },
    });
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  };
  const client = { query, release: () => undefined };
  return { query, connect: async () => client, end: async () => db.close() } as unknown as Pool;
}

let db: PGlite;
let pool: Pool;
let repos: Repos;
let dir: string;

beforeAll(async () => {
  db = new PGlite();
  pool = asPool(db);
  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) await db.exec(await readFile(path.join(MIGRATIONS, file), 'utf8'));
  repos = createRepos(pool);
  dir = await mkdtemp(path.join(tmpdir(), 'wa-respaldos-'));
});

afterAll(async () => {
  await pool.end();
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.exec('delete from chat_archives; delete from messages; delete from contacts;');
});

/** Un contacto con `cuantos` mensajes alternando entrada y salida. */
async function conversacion(phone: string, cuantos: number, desde = new Date('2026-01-10T10:00:00Z')) {
  const contacto = await repos.contacts.upsertFromInbound(phone, 'Cliente de prueba');
  for (let i = 0; i < cuantos; i++) {
    await repos.messages.add({
      contactId: contacto.id,
      direction: i % 2 === 0 ? 'in' : 'out',
      wamid: `wamid.${phone}.${i}`,
      kind: 'text',
      body: `mensaje ${i}`,
      createdAt: new Date(desde.getTime() + i * 60_000),
    });
  }
  return contacto;
}

describe('archivar una conversacion', () => {
  it('guarda el hilo en un fichero y lo borra de la base', async () => {
    const contacto = await conversacion('51999111222', 5);

    const salida = await archivarConversacion({ repos, dir }, contacto.id, 'manual');

    expect(salida.ok).toBe(true);
    expect(salida.borrados).toBe(5);
    expect(salida.archive?.messageCount).toBe(5);
    // El hilo ya no ocupa sitio en la base.
    expect(await repos.messages.listMessages(contacto.id, 50)).toHaveLength(0);
    // Y el fichero existe de verdad.
    expect(existsSync(rutaDe(dir, salida.archive!.file))).toBe(true);
  });

  it('el contacto y su ficha sobreviven al borrado del hilo', async () => {
    const contacto = await conversacion('51999111333', 3);
    await repos.leads.update(contacto.id, { nombre: 'Ana', entregaDistrito: 'Miraflores' });

    await archivarConversacion({ repos, dir }, contacto.id, 'manual');

    expect(await repos.contacts.getById(contacto.id)).not.toBeNull();
    expect((await repos.leads.get(contacto.id))?.entregaDistrito).toBe('Miraflores');
  });

  it('lo respaldado se vuelve a leer entero y en orden', async () => {
    const contacto = await conversacion('51999111444', 4);
    const salida = await archivarConversacion({ repos, dir }, contacto.id, 'manual');

    const leido = await leerRespaldo({ repos, dir }, salida.archive!.id);

    expect(leido?.messages.map((m) => m.body)).toEqual([
      'mensaje 0',
      'mensaje 1',
      'mensaje 2',
      'mensaje 3',
    ]);
    expect(leido?.header.contacto.phone).toBe('51999111444');
    expect(leido?.messages[0]?.createdAt).toBeInstanceOf(Date);
  });

  it('no archiva una conversacion vacia', async () => {
    const contacto = await repos.contacts.upsertFromInbound('51999111555', undefined);
    const salida = await archivarConversacion({ repos, dir }, contacto.id, 'manual');

    expect(salida.ok).toBe(false);
    expect(salida.motivo).toMatch(/no tiene mensajes/);
    expect((await repos.archives.list({ limit: 10, offset: 0 })).length).toBe(0);
  });

  it('un mensaje que entra despues de leer el hilo no se pierde', async () => {
    const contacto = await conversacion('51999111666', 3);

    // Se simula la carrera: el respaldo ya calculo su tope y llega uno nuevo.
    const resumen = await repos.messages.summaryByContact(contacto.id);
    await repos.messages.add({
      contactId: contacto.id,
      direction: 'in',
      wamid: 'wamid.tardio',
      kind: 'text',
      body: 'llegue tarde',
    });

    const borrados = await repos.messages.deleteByContact(contacto.id, resumen.lastId);
    expect(borrados).toBe(3);

    const quedan = await repos.messages.listMessages(contacto.id, 50);
    expect(quedan.map((m) => m.body)).toEqual(['llegue tarde']);
  });

  it('varios respaldos del mismo contacto conviven', async () => {
    const contacto = await conversacion('51999111777', 2);
    await archivarConversacion({ repos, dir }, contacto.id, 'manual');
    await conversacion('51999111777', 3, new Date('2026-02-01T10:00:00Z'));
    await archivarConversacion({ repos, dir }, contacto.id, 'lead');

    const suyos = await repos.archives.byContact(contacto.id);
    expect(suyos).toHaveLength(2);
    expect(suyos.map((a) => a.reason)).toContain('lead');
    expect(suyos.map((a) => a.messageCount).sort()).toEqual([2, 3]);
  });
});

describe('restaurar', () => {
  it('devuelve el hilo a la base sin tocar el fichero', async () => {
    const contacto = await conversacion('51999222111', 4);
    const salida = await archivarConversacion({ repos, dir }, contacto.id, 'manual');

    const vuelta = await restaurarRespaldo({ repos, dir }, salida.archive!.id);

    expect(vuelta.ok).toBe(true);
    expect(vuelta.restaurados).toBe(4);
    const hilo = await repos.messages.listMessages(contacto.id, 50);
    expect(hilo.map((m) => m.body)).toEqual(['mensaje 0', 'mensaje 1', 'mensaje 2', 'mensaje 3']);
    // El respaldo sigue existiendo: restaurar no es mover.
    expect(await repos.archives.get(salida.archive!.id)).not.toBeNull();
  });

  it('restaurar dos veces no duplica el hilo', async () => {
    const contacto = await conversacion('51999222222', 3);
    const salida = await archivarConversacion({ repos, dir }, contacto.id, 'manual');

    await restaurarRespaldo({ repos, dir }, salida.archive!.id);
    await restaurarRespaldo({ repos, dir }, salida.archive!.id);

    // El wamid es unico: la segunda pasada actualiza, no inserta.
    expect(await repos.messages.listMessages(contacto.id, 50)).toHaveLength(3);
  });
});

describe('barrido por inactividad', () => {
  it('cierra las conversaciones sin movimiento y respeta las vivas', async () => {
    const vieja = await conversacion('51999333111', 3, new Date('2025-01-01T10:00:00Z'));
    const reciente = await conversacion('51999333222', 2, new Date());

    const resumen = await barrerInactivas({ repos, dir }, 30);

    expect(resumen.archivados).toBe(1);
    expect(await repos.messages.listMessages(vieja.id, 10)).toHaveLength(0);
    expect(await repos.messages.listMessages(reciente.id, 10)).toHaveLength(2);
  });

  it('con 0 dias no hace nada', async () => {
    await conversacion('51999333333', 3, new Date('2020-01-01T10:00:00Z'));
    const resumen = await barrerInactivas({ repos, dir }, 0);
    expect(resumen).toMatchObject({ revisados: 0, archivados: 0 });
  });
});

describe('integridad', () => {
  it('avisa cuando el fichero se toco o desaparecio', async () => {
    const contacto = await conversacion('51999444111', 2);
    const salida = await archivarConversacion({ repos, dir }, contacto.id, 'manual');

    let revision = await revisarRespaldos({ repos, dir });
    expect(revision[0]?.ok).toBe(true);

    await writeFile(rutaDe(dir, salida.archive!.file), 'ya no soy el mismo fichero');
    revision = await revisarRespaldos({ repos, dir });
    expect(revision[0]?.ok).toBe(false);
    expect(revision[0]?.detalle).toMatch(/cambio/);
  });

  it('una ruta que se sale del directorio se rechaza', () => {
    expect(() => rutaDe(dir, '../../etc/passwd')).toThrow(/fuera del directorio/);
  });
});
