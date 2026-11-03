/**
 * El registro canal -> cliente: la principal es la conexion de siempre, las
 * demas tienen cada una su sesion y su carpeta, y una linea deshabilitada o
 * inexistente no cae en silencio a otra.
 */

import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';
import { crearServicioLineas, ID_LINEA_PRINCIPAL, type ServicioLineas } from '../src/whatsapp/lineas.js';
import { crearRegistroClientes, type RegistroClientes } from '../src/whatsapp/registro.js';
import { crearSesionLocal } from '../src/whatsapp/local/session.js';
import type { WhatsAppClient } from '../src/whatsapp/client.js';

let b: BaseDePrueba;
let lineas: ServicioLineas;
let registro: RegistroClientes;
const clientePrincipal = { conectado: () => true } as unknown as WhatsAppClient;
const sesionPrincipal = crearSesionLocal();

beforeAll(async () => {
  b = await baseDePrueba();
  lineas = crearServicioLineas(b.pool, randomBytes(32), 'prueba_registro');
  registro = crearRegistroClientes({ lineas, principal: { cliente: clientePrincipal, sesion: sesionPrincipal }, authDir: path.join('x', 'auth') });
});

afterAll(async () => {
  registro?.detener();
  await b?.cerrar();
});

describe('registro de clientes por linea', () => {
  it('sin linea indicada, o con la principal, devuelve la conexion de siempre', async () => {
    expect((await registro.transporte())?.cliente).toBe(clientePrincipal);
    expect((await registro.transporte(ID_LINEA_PRINCIPAL))?.sesion).toBe(sesionPrincipal);
  });

  it('cada linea local tiene su sesion y su carpeta, y se conserva entre llamadas', async () => {
    const a = await lineas.crear({ etiqueta: 'Ventas', proveedor: 'local' });
    const c = await lineas.crear({ etiqueta: 'Soporte', proveedor: 'local' });
    const ta = await registro.transporte(a.id);
    const tc = await registro.transporte(c.id);
    expect(ta?.sesion).not.toBe(tc?.sesion);
    expect(ta?.sesion).not.toBe(sesionPrincipal);
    expect(ta?.authDir).not.toBe(tc?.authDir);
    expect((await registro.transporte(a.id))?.sesion).toBe(ta?.sesion);
    // Sin QR escaneado, una no esta conectada pero no arrastra a la principal.
    expect(await registro.conectada(a.id)).toBe(false);
    expect(await registro.conectada()).toBe(true);
  });

  it('una linea deshabilitada o inexistente no devuelve transporte', async () => {
    const d = await lineas.crear({ etiqueta: 'Pausada', proveedor: 'local' });
    await lineas.habilitar(d.id, false);
    expect(await registro.transporte(d.id)).toBeNull();
    expect(await registro.transporte('no-existe')).toBeNull();
  });

  it('una linea oficial sin credenciales completas no se arma', async () => {
    const o = await lineas.crear({ etiqueta: 'Oficial', proveedor: 'cloud', credenciales: { token: 't', phoneNumberId: '9' } });
    expect(await registro.transporte(o.id)).toBeNull();
  });
});
