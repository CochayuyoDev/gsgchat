/**
 * Dos cabos que dejo sueltos la revision de la plataforma:
 *
 *  - el freno de registros por conexion contaba solo los TERMINADOS, asi que
 *    varios registros simultaneos desde la misma conexion pasaban todos;
 *  - una tienda que fallaba a mitad de armarse dejaba su base abierta y sus
 *    temporizadores vivos.
 *
 * Las bases son de verdad (servidor MySQL/MariaDB de pruebas, nombres
 * gsgchat_prueba_limp_*) y vuelven al banco al terminar.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const estado = vi.hoisted(() => ({ fallarServidor: false, bases: [] as Array<{ base: string | null; cerrada: boolean }> }));

// Cada conexion a una base que se abre queda apuntada, con si se cerro.
vi.mock('../src/db/pool.js', async (original) => {
  const m = await original<typeof import('../src/db/pool.js')>();
  return {
    ...m,
    createPool: (...args: Parameters<typeof m.createPool>) => {
      const pool = m.createPool(...args);
      const registro = { base: pool.baseDeDatos, cerrada: false };
      estado.bases.push(registro);
      const cerrar = pool.end.bind(pool);
      return {
        ...pool,
        query: pool.query.bind(pool),
        connect: pool.connect.bind(pool),
        baseDeDatos: pool.baseDeDatos,
        end: async () => {
          registro.cerrada = true;
          return cerrar();
        },
      };
    },
  };
});

// El montaje del servidor puede fallar a proposito (a mitad de armar la tienda).
vi.mock('../src/server.js', async (original) => {
  const m = await original<typeof import('../src/server.js')>();
  return {
    ...m,
    buildServer: async (...args: Parameters<typeof m.buildServer>) => {
      if (estado.fallarServidor) throw new Error('fallo a mitad de armar la tienda');
      return m.buildServer(...args);
    },
  };
});

const { crearPlataforma } = await import('../src/plataforma/plataforma.js');
const { armarTienda } = await import('../src/plataforma/tienda.js');
const { bootstrapSecrets } = await import('../src/settings/crypto.js');
const { existeBase } = await import('../src/db/bases.js');
const { bancoDePrueba, devolverBasesDePrueba, URL_PRUEBAS, urlConBase } = await import('./mysql.js');

const PREFIJO = 'gsgchat_prueba_limp_';
const BANCO = bancoDePrueba(PREFIJO);
const baseDePlataforma = (nombre: string) => ({ url: urlConBase(`${PREFIJO}${nombre}`) });
const TIEMPO = 3_600_000;
beforeAll(() => devolverBasesDePrueba(BANCO), 3_600_000);
afterAll(() => devolverBasesDePrueba(BANCO), 3_600_000);

const REGISTRO = (usuario: string, tienda = `Tienda ${usuario}`) => ({ tienda, nombre: 'X', usuario, clave: 'clave-segura-123' });
const carpetas: string[] = [];
const carpeta = (nombre: string) => {
  const d = mkdtempSync(path.join(tmpdir(), nombre));
  carpetas.push(d);
  return d;
};

afterEach(() => {
  estado.fallarServidor = false;
  for (const d of carpetas.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('freno de registros con registros simultaneos', () => {
  it('con tope 1, dos registros a la vez desde la misma conexion: pasa uno y el otro se frena', async () => {
    const raiz = carpeta('freno-');
    const p = await crearPlataforma({ raiz, publicBaseUrl: 'http://localhost:0', proceso: {}, base: baseDePlataforma('freno'), banco: BANCO, principal: null, autoConectarLocal: false, sembrarPlantillasLocales: false, carpetaCopias: path.join(raiz, 'c'), registrosPorHora: 1, log: () => undefined });
    try {
      await p.arrancar();
      const [a, b] = await Promise.all([p.registrar(REGISTRO('uno-1'), '1.2.3.4'), p.registrar(REGISTRO('dos-2'), '1.2.3.4')]);
      expect([a.status, b.status].sort()).toEqual([200, 429]);
      expect(await p.cuantas()).toBe(1);
    } finally {
      await p.parar();
    }
  }, TIEMPO);

  it('un registro que no llega a crear la tienda devuelve su hueco', async () => {
    const raiz = carpeta('freno-hueco-');
    const p = await crearPlataforma({ raiz, publicBaseUrl: 'http://localhost:0', proceso: {}, base: baseDePlataforma('hueco'), banco: BANCO, principal: null, autoConectarLocal: false, sembrarPlantillasLocales: false, carpetaCopias: path.join(raiz, 'c'), registrosPorHora: 1, log: () => undefined });
    try {
      await p.arrancar();
      expect((await p.registrar(REGISTRO('ocupado'), '5.5.5.5')).status).toBe(200);
      // Desde otra conexion: el usuario ya existe -> 400, y el hueco vuelve.
      expect((await p.registrar(REGISTRO('ocupado', 'Otra'), '6.6.6.6')).status).toBe(400);
      expect((await p.registrar(REGISTRO('libre-1', 'Otra'), '6.6.6.6')).status).toBe(200);
    } finally {
      await p.parar();
    }
  }, TIEMPO);
});

describe('una tienda que falla a mitad de armarse', () => {
  it('cierra su base y no deja la tienda a medias', async () => {
    const raiz = carpeta('mitad-');
    const secretos = bootstrapSecrets(raiz);
    const nombre = `${PREFIJO}mitad`;
    const url = urlConBase(nombre);
    estado.fallarServidor = true;
    await expect(
      armarTienda({
        id: 'x',
        slug: 'x',
        env: { PUBLIC_BASE_URL: 'http://localhost:0', DATABASE_URL: url, TRACKING_SECRET: secretos.trackingSecret, WHATSAPP_PROVIDER: 'local' } as NodeJS.ProcessEnv,
        secretos,
        base: { url, banco: BANCO },
        authDir: path.join(raiz, 'auth'),
        mediaDir: path.join(raiz, 'medios'),
        carpetaCopias: path.join(raiz, 'copias'),
        primeraCuentaRol: 'admin',
        autoConectarLocal: false,
        sembrarPlantillasLocales: false,
        prefijoLog: '[x] ',
      }),
    ).rejects.toThrow('fallo a mitad');
    const base = estado.bases.filter((b) => b.base === nombre);
    expect(base.length).toBeGreaterThan(0);
    expect(base.every((b) => b.cerrada)).toBe(true);
  }, TIEMPO);

  it('en un registro, el fallo se explica, la tienda no queda en el directorio y su base se cierra', async () => {
    const raiz = carpeta('mitad-registro-');
    const p = await crearPlataforma({ raiz, publicBaseUrl: 'http://localhost:0', proceso: {}, base: baseDePlataforma('rota'), banco: BANCO, principal: null, autoConectarLocal: false, sembrarPlantillasLocales: false, carpetaCopias: path.join(raiz, 'c'), log: () => undefined });
    try {
      await p.arrancar();
      estado.fallarServidor = true;
      const r = await p.registrar(REGISTRO('rota-1'), '7.7.7.7');
      expect(r.status).toBe(500);
      expect(r.error).toContain('No se pudo crear tu tienda');
      expect(await p.cuantas()).toBe(0);
      expect(await p.usuarioLibre('rota-1')).toBe(true);
      const deTienda = estado.bases.filter((b) => b.base?.startsWith(`${PREFIJO}rota_t_`));
      expect(deTienda.length).toBeGreaterThan(0);
      expect(deTienda.every((b) => b.cerrada)).toBe(true);
      // Y la base de la tienda que no llego a nacer no se queda en el servidor.
      expect(await existeBase(URL_PRUEBAS, deTienda[0]!.base!)).toBe(false);
    } finally {
      estado.fallarServidor = false;
      await p.parar();
    }
  }, TIEMPO);
});
