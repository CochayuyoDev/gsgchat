/**
 * Hotfix «números de WhatsApp de GSG».
 *
 * 1) Con la principal caída y otra línea viva, el sistema NO está «desconectado»:
 *    cada chat sale por la línea de su cliente (o por otra viva).
 * 2) Cualquier línea habilitada puede ser la principal («Hacer principal»); la
 *    conexión de /setup no se mueve y vuelve a mandar si la elegida se deshabilita.
 */

import { randomBytes } from 'node:crypto';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';
import { crearServicioLineas, ID_LINEA_PRINCIPAL, type Linea, type ServicioLineas } from '../src/whatsapp/lineas.js';
import { crearRegistroClientes } from '../src/whatsapp/registro.js';
import { crearSesionLocal } from '../src/whatsapp/local/session.js';
import { registerLineasRoutes } from '../src/web/lineas-routes.js';
import type { WhatsAppClient } from '../src/whatsapp/client.js';
import { algunaLineaConectada, estadoConexion, nombrarLineas } from '../src/whatsapp/estado-conexion.js';

const linea = (id: string, etiqueta: string, principal = false): Linea => ({
  id,
  etiqueta,
  telefono: '',
  proveedor: 'local',
  idExterno: null,
  estado: 'conectado',
  principal,
  habilitada: true,
  posicion: principal ? 0 : 1,
  limiteDiario: 0,
});

describe('estado de conexión con varias líneas', () => {
  const settings = { isConfigured: () => true };
  const caida = { conectado: () => false } as Pick<WhatsAppClient, 'conectado'>;

  it('principal caída + WhatsApp 2 vivo = conectado (no «WhatsApp desconectado»)', async () => {
    const registro = {
      algunaConectada: () => true,
      estados: async () => [
        { linea: linea(ID_LINEA_PRINCIPAL, 'WhatsApp 1', true), conectada: false },
        { linea: linea('l2', 'WhatsApp 2'), conectada: true },
        { linea: linea('l3', 'WhatsApp 3'), conectada: false },
      ],
    };
    expect(algunaLineaConectada({ settings, wa: caida, registro })).toBe(true);
    const e = await estadoConexion({ settings, wa: caida, registro });
    expect(e).toMatchObject({ configurado: true, conectado: true, principalConectada: false });
    expect(e.lineas.filter((l) => l.conectada).map((l) => l.id)).toEqual(['l2']);
    expect(nombrarLineas(e.lineas.filter((l) => !l.conectada))).toBe('«WhatsApp 1» y «WhatsApp 3»');
  });

  it('todas caídas = desconectado', async () => {
    const registro = { algunaConectada: () => false, estados: async () => [{ linea: linea(ID_LINEA_PRINCIPAL, 'WhatsApp 1', true), conectada: false }] };
    expect(algunaLineaConectada({ settings, wa: caida, registro })).toBe(false);
    expect((await estadoConexion({ settings, wa: caida, registro })).conectado).toBe(false);
  });

  it('sin registro de líneas se comporta como antes (solo la principal)', async () => {
    expect(algunaLineaConectada({ settings, wa: caida })).toBe(false);
    expect(algunaLineaConectada({ settings, wa: { conectado: () => true } })).toBe(true);
    expect(algunaLineaConectada({ settings: { isConfigured: () => false }, wa: { conectado: () => true } })).toBe(false);
  });

  it('la principal de uso manda en «principal» y en «principalConectada»', async () => {
    const registro = {
      algunaConectada: () => true,
      estados: async () => [
        { linea: linea(ID_LINEA_PRINCIPAL, 'WhatsApp 1', true), conectada: false },
        { linea: linea('l2', 'WhatsApp 2'), conectada: true },
      ],
    };
    const e = await estadoConexion({ settings, wa: caida, registro, preferida: async () => 'l2' });
    expect(e.principalConectada).toBe(true);
    expect(e.lineas.find((l) => l.principal)?.id).toBe('l2');
  });
});

describe('«Hacer principal»', () => {
  let b: BaseDePrueba;
  let app: FastifyInstance;
  let lineas: ServicioLineas;

  beforeAll(async () => {
    b = await baseDePrueba();
    lineas = crearServicioLineas(b.pool, randomBytes(32), 'prueba_principal_de_uso');
    const registro = crearRegistroClientes({
      lineas,
      principal: { cliente: { conectado: () => false } as unknown as WhatsAppClient, sesion: crearSesionLocal() },
      authDir: path.join('x', 'auth'),
    });
    app = Fastify();
    await registerLineasRoutes(app, { lineas, registro, arrancarLinea: async () => undefined });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    await b?.cerrar();
  });

  const json = (r: { json: () => unknown }) => r.json() as Record<string, any>;
  const listar = async () => json(await app.inject({ method: 'GET', url: '/admin/lineas' }));

  it('sin elegir, la principal es la de /setup y se puede elegir otra', async () => {
    const r = await listar();
    expect(r.puedeElegirPrincipal).toBe(true);
    expect(r.lineas[0]).toMatchObject({ id: ID_LINEA_PRINCIPAL, principal: true, deSetup: true });
    expect(await lineas.preferida!()).toBe(ID_LINEA_PRINCIPAL);
  });

  it('WhatsApp 2 pasa a principal; la de /setup sigue siendo la de /setup', async () => {
    const dos = json(await app.inject({ method: 'POST', url: '/admin/lineas', payload: { etiqueta: 'WhatsApp 2' } })).linea;
    const r = await app.inject({ method: 'POST', url: `/admin/lineas/${dos.id}/principal` });
    expect(r.statusCode).toBe(200);
    expect(json(r).linea).toMatchObject({ id: dos.id, principal: true, deSetup: false });
    const todas = (await listar()).lineas as Array<{ id: string; principal: boolean; deSetup: boolean }>;
    expect(todas.filter((l) => l.principal).map((l) => l.id)).toEqual([dos.id]);
    expect(todas.find((l) => l.id === ID_LINEA_PRINCIPAL)).toMatchObject({ principal: false, deSetup: true });
    expect(await lineas.preferida!()).toBe(dos.id);
    // La de /setup sigue sin poder quitarse.
    expect((await app.inject({ method: 'DELETE', url: `/admin/lineas/${ID_LINEA_PRINCIPAL}` })).statusCode).toBe(400);
  });

  it('si la elegida se deshabilita, vuelve a mandar la de /setup; una deshabilitada no se puede elegir', async () => {
    const dos = ((await listar()).lineas as Array<{ id: string; principal: boolean }>).find((l) => l.principal)!;
    await app.inject({ method: 'PATCH', url: `/admin/lineas/${dos.id}`, payload: { habilitada: false } });
    expect(await lineas.preferida!()).toBe(ID_LINEA_PRINCIPAL);
    const r = await app.inject({ method: 'POST', url: `/admin/lineas/${dos.id}/principal` });
    expect(r.statusCode).toBe(400);
  });

  it('volver a elegir la de /setup limpia la elección', async () => {
    const tres = json(await app.inject({ method: 'POST', url: '/admin/lineas', payload: { etiqueta: 'WhatsApp 3' } })).linea;
    await app.inject({ method: 'POST', url: `/admin/lineas/${tres.id}/principal` });
    expect(await lineas.preferida!()).toBe(tres.id);
    expect((await app.inject({ method: 'POST', url: `/admin/lineas/${ID_LINEA_PRINCIPAL}/principal` })).statusCode).toBe(200);
    expect(await lineas.preferida!()).toBe(ID_LINEA_PRINCIPAL);
  });

  it('una línea que no existe da 404', async () => {
    expect((await app.inject({ method: 'POST', url: '/admin/lineas/00000000-0000-0000-0000-00000000ffff/principal' })).statusCode).toBe(404);
  });
});
