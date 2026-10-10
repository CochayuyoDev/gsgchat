/**
 * Los repos de cuentas y claves de API contra MySQL/MariaDB de verdad:
 * que el esquema tenga lo que el codigo espera y que revocar,
 * desactivar y cambiar la contrasena hagan en SQL lo que hacen en los fakes.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from '../src/db/pool.js';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';
import { createUsuariosRepo } from '../src/auth/usuarios.js';
import { createClavesApiRepo, generarClaveApi, hashClaveApi, prefijoDeClave } from '../src/auth/claves-api.js';
import { createActividadRepo } from '../src/auth/actividad.js';

let b: BaseDePrueba;
let pool: Pool;

beforeAll(async () => {
  b = await baseDePrueba();
  pool = b.pool;
});

afterAll(async () => {
  await b?.cerrar();
});

describe('usuarios en SQL', () => {
  it('crea, lista, cambia contrasena (sube la version) y desactiva (cierra sesiones)', async () => {
    const usuarios = createUsuariosRepo(pool);
    expect(await usuarios.contar()).toBe(0);
    const ali = await usuarios.crear({ usuario: ' Ali ', nombre: 'Ali', clave: 'scrypt$00$11', rol: 'admin' });
    expect(ali.usuario).toBe('ali');
    expect(ali.sesionVersion).toBe(1);
    expect(await usuarios.contar()).toBe(1);
    expect((await usuarios.porUsuario('ALI'))?.clave).toBe('scrypt$00$11');
    expect((await usuarios.porId(ali.id))).not.toHaveProperty('clave');

    await usuarios.cambiarClave(ali.id, 'scrypt$00$22');
    expect((await usuarios.porId(ali.id))?.sesionVersion).toBe(2);
    await usuarios.setActivo(ali.id, false);
    const apagado = await usuarios.porId(ali.id);
    expect(apagado?.activo).toBe(false);
    expect(apagado?.sesionVersion).toBe(3);
    await usuarios.setActivo(ali.id, true);
    expect((await usuarios.porId(ali.id))?.sesionVersion).toBe(3);
    await usuarios.setRol(ali.id, 'operador');
    const cuando = new Date('2026-09-11T10:00:00Z');
    await usuarios.tocarLogin(ali.id, cuando);
    const lista = await usuarios.listar();
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ rol: 'operador', ultimoLoginAt: cuando });

    await expect(usuarios.crear({ usuario: 'ali', nombre: 'Otro', clave: 'x', rol: 'operador' })).rejects.toThrow();
  });
});

describe('claves de API en SQL', () => {
  it('se encuentran por hash solo mientras no esten revocadas', async () => {
    const claves = createClavesApiRepo(pool);
    const usuarios = createUsuariosRepo(pool);
    const admin = await usuarios.porUsuario('ali');
    const clave = generarClaveApi();
    const registro = await claves.crear({ nombre: 'GSG', prefijo: prefijoDeClave(clave), hash: hashClaveApi(clave), creadaPor: admin!.id });
    expect(registro.creadaPor).toBe(admin!.id);
    expect(registro.revocadaAt).toBeNull();

    const hallada = await claves.porHash(hashClaveApi(clave));
    expect(hallada?.id).toBe(registro.id);
    expect(await claves.porHash(hashClaveApi('wak_otra'))).toBeNull();

    const cuando = new Date('2026-09-11T11:00:00Z');
    await claves.tocarUso(registro.id, cuando);
    expect((await claves.listar())[0]).toMatchObject({ nombre: 'GSG', ultimoUsoAt: cuando });

    expect(await claves.revocar(registro.id)).toBe(true);
    expect(await claves.revocar(registro.id)).toBe(false);
    expect(await claves.porHash(hashClaveApi(clave))).toBeNull();
    expect((await claves.listar())[0]?.revocadaAt).toBeInstanceOf(Date);

    // Borrar al creador no borra la clave: queda sin dueno.
    await pool.query('delete from usuarios where id = $1', [admin!.id]);
    expect((await claves.listar())[0]?.creadaPor).toBeNull();
  });
});

describe('bitacora en SQL', () => {
  it('anota, lista del mas nuevo al mas viejo, filtra y pagina', async () => {
    const actividad = createActividadRepo(pool);
    await actividad.anotar({ usuarioId: 'u1', usuario: 'Ali', accion: 'entrar', detalle: null, ip: '10.0.0.1', at: new Date('2026-09-11T10:00:00Z') });
    await actividad.anotar({ usuarioId: 'u1', usuario: 'Ali', accion: 'lote.crear', detalle: { nombre: 'Reparto' }, ip: null, at: new Date('2026-09-11T10:05:00Z') });
    await actividad.anotar({ usuarioId: null, usuario: 'rosa', accion: 'entrar.fallido', detalle: { usuario: 'rosa' }, ip: '10.0.0.2', at: new Date('2026-09-11T10:06:00Z') });
    const todo = await actividad.listar({ limit: 10, offset: 0 });
    expect(todo.total).toBe(3);
    expect(todo.items.map((i) => i.accion)).toEqual(['entrar.fallido', 'lote.crear', 'entrar']);
    expect(todo.items[1]?.detalle).toEqual({ nombre: 'Reparto' });
    expect(todo.items[0]?.usuarioId).toBeNull();
    const ali = await actividad.listar({ limit: 1, offset: 1, usuario: 'ALI' });
    expect(ali.total).toBe(2);
    expect(ali.items).toHaveLength(1);
    expect(ali.items[0]?.accion).toBe('entrar');
    expect(await actividad.acciones()).toEqual(['entrar', 'entrar.fallido', 'lote.crear']);
  });
});
