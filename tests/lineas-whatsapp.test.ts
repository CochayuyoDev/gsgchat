/**
 * Las lineas de WhatsApp de una tienda contra MySQL/MariaDB de verdad:
 * la migracion deja la principal, el tope es de ocho aunque lleguen altas a la
 * vez, y la principal no se puede quitar.
 */

import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from '../src/db/pool.js';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';
import { crearServicioLineas, ID_LINEA_PRINCIPAL, LineasError, MAX_LINEAS, type ServicioLineas } from '../src/whatsapp/lineas.js';

let b: BaseDePrueba;
let pool: Pool;
let lineas: ServicioLineas;

beforeAll(async () => {
  b = await baseDePrueba();
  pool = b.pool;
  lineas = crearServicioLineas(pool, randomBytes(32), 'prueba_lineas');
});

afterAll(async () => {
  await b?.cerrar();
});

describe('lineas de WhatsApp', () => {
  it('la migracion deja la conexion actual como linea principal', async () => {
    const principal = await lineas.principal();
    expect(principal.id).toBe(ID_LINEA_PRINCIPAL);
    expect(principal.principal).toBe(true);
    expect((await lineas.listar())[0]?.id).toBe(ID_LINEA_PRINCIPAL);
  });

  it('no deja quitar la principal ni renombrar una que no existe', async () => {
    await expect(lineas.eliminar(ID_LINEA_PRINCIPAL)).rejects.toMatchObject({ codigo: 'principal' });
    await expect(lineas.renombrar('no-existe', 'X')).rejects.toMatchObject({ codigo: 'no_existe' });
  });

  it('admite ocho y rechaza la novena, incluso con altas simultaneas', async () => {
    const intentos = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => lineas.crear({ etiqueta: `Linea ${i}`, proveedor: 'local' })),
    );
    const hechas = intentos.filter((r) => r.status === 'fulfilled').length;
    const rechazadas = intentos.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(hechas).toBe(MAX_LINEAS - 1); // la principal ya ocupa una
    expect(rechazadas.every((r) => r.reason instanceof LineasError && r.reason.codigo === 'tope')).toBe(true);
    expect(await lineas.listar()).toHaveLength(MAX_LINEAS);
  });

  it('al quitar una se libera el sitio, y las credenciales se guardan cifradas', async () => {
    const otra = (await lineas.listar()).find((l) => !l.principal)!;
    await lineas.eliminar(otra.id);
    const nueva = await lineas.crear({ etiqueta: 'Oficial', proveedor: 'cloud', credenciales: { token: 'secreto-123', phoneNumberId: '555' } });
    expect(nueva.idExterno).toBe('555');
    expect(await lineas.credenciales(nueva.id)).toMatchObject({ token: 'secreto-123' });
    const { rows } = await pool.query<{ credentials: string }>('select credentials from whatsapp_numbers where id = $1', [nueva.id]);
    expect(rows[0]!.credentials).not.toContain('secreto-123');
    expect((await lineas.porIdExterno('cloud', '555'))?.id).toBe(nueva.id);
  });
});
