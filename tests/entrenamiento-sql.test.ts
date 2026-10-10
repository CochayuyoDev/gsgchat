/**
 * El SQL del entrenamiento contra MySQL/MariaDB de verdad: el esquema,
 * la huella unica (tambien dentro de la misma tanda), los filtros y la
 * paginacion, el cambio en masa, las cifras, el recorrido de conversaciones
 * (solo personas, con el origen del payload) y los examenes con sus casos.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from '../src/db/pool.js';
import { createRepos, type Repos } from '../src/db/repos.js';
import { huellaDe } from '../src/entrenamiento/texto.js';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';

let base: BaseDePrueba;
let pool: Pool;
let repos: Repos;

beforeAll(async () => {
  base = await baseDePrueba();
  pool = base.pool;
  repos = createRepos(pool);
});

afterAll(async () => {
  await base?.cerrar();
});

beforeEach(async () => {
  await base.vaciar();
});

const nueva = (pregunta: string | null, respuesta: string, extra: Record<string, unknown> = {}) =>
  ({ tipo: pregunta ? 'ejemplo' : 'dato', pregunta, respuesta, origen: 'manual', huella: huellaDe(pregunta, respuesta), ...extra }) as Parameters<Repos['entrenamiento']['crearVarias']>[0][number];

describe('lecciones', () => {
  it('la misma leccion no entra dos veces, ni entre tandas ni dentro de la misma', async () => {
    const r = await repos.entrenamiento.crearVarias([
      nueva('¿Hacen envíos?', 'Sí, a todo el Perú.'),
      nueva('hacen envios', 'si a todo el peru'),
      nueva(null, 'Horario de 9 a 19.'),
    ]);
    expect(r).toMatchObject({ nuevas: 2, repetidas: 1 });
    expect(r.ids).toHaveLength(2);
    const otra = await repos.entrenamiento.crear(nueva('¿Hacen envíos?', 'Sí, a todo el Perú.'));
    expect(otra.nueva).toBe(false);
    expect(otra.leccion.id).toBe(r.ids[0]);
    expect((await repos.entrenamiento.cifras()).total).toBe(2);
  });

  it('mil de golpe entran en tandas y se listan paginadas con filtros', async () => {
    const lote = Array.from({ length: 1000 }, (_, i) => nueva(`¿Tienen el modelo ${i}?`, `Sí, a S/ ${100 + (i % 7)}.`, { tema: i % 2 ? 'catalogo' : 'stock', origen: i % 3 ? 'importado' : 'chat', estado: i % 5 ? 'activa' : 'pendiente' }));
    const r = await repos.entrenamiento.crearVarias(lote);
    expect(r.nuevas).toBe(1000);
    const p1 = await repos.entrenamiento.listar({ tema: 'Catalogo' }, { limite: 50, offset: 0 });
    expect(p1.total).toBe(500);
    expect(p1.items).toHaveLength(50);
    expect(p1.items[0]!.id).toBeGreaterThan(p1.items[1]!.id);
    const q = await repos.entrenamiento.listar({ q: 'modelo 77' }, { limite: 50, offset: 0 });
    expect(q.total).toBe(11); // 77 y 770..779
    const pend = await repos.entrenamiento.listar({ estado: 'pendiente', origen: 'chat' }, { limite: 500, offset: 0 });
    expect(pend.total).toBe(lote.filter((l) => l.estado === 'pendiente' && l.origen === 'chat').length);
    expect((await repos.entrenamiento.activas())).toHaveLength(800);
    const c = await repos.entrenamiento.cifras();
    expect(c.porEstado).toEqual({ activa: 800, pendiente: 200, descartada: 0 });
    expect(c.porTipo.ejemplo).toBe(800);
    expect(c.sinExaminar).toBe(800);
    const temas = await repos.entrenamiento.temas();
    expect(temas.map((t) => t.tema).sort()).toEqual(['catalogo', 'stock']);
  });

  it('cambiar en masa por filtro o por ids, borrar en masa, y anotar usos', async () => {
    const r = await repos.entrenamiento.crearVarias([
      nueva('a?', 'aa', { estado: 'pendiente' }),
      nueva('b?', 'bb', { estado: 'pendiente' }),
      nueva('c?', 'cc'),
    ]);
    expect(await repos.entrenamiento.cambiarEstadoEnMasa({ estado: 'pendiente' }, 'activa')).toBe(2);
    expect((await repos.entrenamiento.cifras()).porEstado.activa).toBe(3);
    expect(await repos.entrenamiento.cambiarEstadoEnMasa({ ids: [r.ids[0]!] }, 'descartada')).toBe(1);
    await repos.entrenamiento.anotarUsos([r.ids[1]!, r.ids[2]!], new Date('2026-09-18T10:00:00Z'));
    await repos.entrenamiento.anotarUsos([r.ids[1]!], new Date('2026-09-18T11:00:00Z'));
    const b = await repos.entrenamiento.porId(r.ids[1]!);
    expect(b).toMatchObject({ usos: 2 });
    expect(b!.ultimoUsoAt!.toISOString()).toBe('2026-09-18T11:00:00.000Z');
    expect(await repos.entrenamiento.idsPara({ estado: 'activa' }, 10, false)).toEqual([r.ids[1], r.ids[2]]);
    expect(await repos.entrenamiento.idsPara({ estado: 'activa' }, 10, true)).toHaveLength(2);
    expect(await repos.entrenamiento.borrarEnMasa({ estado: 'descartada' })).toBe(1);
    expect((await repos.entrenamiento.cifras()).total).toBe(2);
    const patch = await repos.entrenamiento.actualizar(r.ids[2]!, { respuesta: 'ccc', huella: huellaDe('c?', 'ccc'), examenOk: false, examenNota: 'faltó decir «3»', nota: 'revisar' });
    expect(patch).toMatchObject({ respuesta: 'ccc', examenOk: false, examenNota: 'faltó decir «3»', nota: 'revisar' });
    expect(await repos.entrenamiento.porHuella(huellaDe('c?', 'ccc'))).toMatchObject({ id: r.ids[2] });
  });
});

describe('recorrer las conversaciones', () => {
  it('solo personas con al menos dos textos, mensajes en orden y con el origen del payload', async () => {
    const maria = await repos.contacts.upsertFromInbound('51987654321', 'Maria');
    const grupo = await repos.contacts.upsertGrupo('123@g.us', 'Grupo');
    const solo = await repos.contacts.upsertFromInbound('51911111111', 'Uno');
    const t = (min: number) => new Date(2026, 8, 10, 10, min);
    await repos.messages.add({ contactId: maria.id, direction: 'out', kind: 'text', body: 'Sí, enviamos.', payload: { origen: 'persona' }, createdAt: t(2) });
    await repos.messages.add({ contactId: maria.id, direction: 'in', kind: 'text', body: 'hacen envios?', createdAt: t(0) });
    await repos.messages.add({ contactId: maria.id, direction: 'out', kind: 'text', body: 'Recordatorio automático', payload: { origen: 'sistema', interactive: { body: 'x' } }, createdAt: t(3) });
    await repos.messages.add({ contactId: maria.id, direction: 'in', kind: 'image', body: '(foto)', createdAt: t(4) });
    await repos.messages.add({ contactId: grupo.id, direction: 'in', kind: 'text', body: 'en el grupo', createdAt: t(0) });
    await repos.messages.add({ contactId: grupo.id, direction: 'out', kind: 'text', body: 'en el grupo 2', createdAt: t(1) });
    await repos.messages.add({ contactId: solo.id, direction: 'in', kind: 'text', body: 'solo uno', createdAt: t(0) });

    const contactos = await repos.entrenamiento.contactosConTexto(null);
    expect(contactos).toEqual([{ contactId: maria.id, phone: '51987654321', nombre: 'Maria', mensajes: 3 }]);
    const mensajes = await repos.entrenamiento.mensajesDeTexto(maria.id, null);
    expect(mensajes.map((m) => [m.direction, m.body, m.origen])).toEqual([
      ['in', 'hacen envios?', null],
      ['out', 'Sí, enviamos.', 'persona'],
      ['out', 'Recordatorio automático', 'sistema'],
    ]);
    expect(await repos.entrenamiento.contactosConTexto(t(3))).toEqual([]);
    expect(await repos.entrenamiento.mensajesDeTexto(maria.id, t(2))).toHaveLength(2);
  });
});

describe('examenes', () => {
  it('se crean, anotan casos, se cierran con cifras y se listan con los fallos primero', async () => {
    const r = await repos.entrenamiento.crearVarias([nueva('a?', 'aa aa'), nueva('b?', 'bb bb')]);
    const e = await repos.entrenamiento.crearExamen({ nombre: 'todas (2)', total: 2, creadoPor: 'Ali', detalle: { filtro: {} } });
    expect(e).toMatchObject({ estado: 'corriendo', total: 2, aprobados: 0 });
    await repos.entrenamiento.anotarCaso({ examenId: e.id, leccionId: r.ids[0]!, pregunta: 'a?', esperada: 'aa aa', respuesta: 'aa aa', ok: true, motivos: [] });
    await repos.entrenamiento.anotarCaso({ examenId: e.id, leccionId: r.ids[1]!, pregunta: 'b?', esperada: 'bb bb', respuesta: 'cc', ok: false, motivos: ['se parece poco a lo enseñado (0 %)'] });
    const cerrado = await repos.entrenamiento.cerrarExamen(e.id, 'terminado', { aprobados: 1, fallados: 1, errores: 0 }, { porcentaje: 50 });
    expect(cerrado).toMatchObject({ estado: 'terminado', aprobados: 1, fallados: 1, detalle: { porcentaje: 50 } });
    expect(cerrado!.terminadoAt).toBeInstanceOf(Date);
    const lista = await repos.entrenamiento.examenes(10);
    expect(lista).toHaveLength(1);
    const casos = await repos.entrenamiento.casosDeExamen(e.id, false, 100);
    expect(casos.map((c) => c.ok)).toEqual([false, true]);
    expect(casos[0]!.motivos).toEqual(['se parece poco a lo enseñado (0 %)']);
    expect(await repos.entrenamiento.casosDeExamen(e.id, true, 100)).toHaveLength(1);
    // Borrar la leccion no rompe el historico: el caso se queda sin leccion.
    await repos.entrenamiento.borrar(r.ids[1]!);
    expect((await repos.entrenamiento.casosDeExamen(e.id, true, 100))[0]!.leccionId).toBeNull();
  });
});
