/**
 * El SaaS: una instancia por tienda.
 *
 * Docker no se toca aqui: se sustituye por un ejecutor falso que apunta lo
 * que se le pide. Lo que se prueba es que cada tienda salga con su base, su
 * contenedor, su Redis, su subdominio y sus ficheros, sin pisar a las demas,
 * y que la baja deje (o borre) exactamente lo que debe.
 */

import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  altaInstancia,
  bajaInstancia,
  baseDe,
  contenedorDe,
  esLocal,
  estadoInstancias,
  generarCaddy,
  generarCaddyfile,
  generarCompose,
  generarEnv,
  leerConfigSaas,
  listarInstancias,
  prepararBase,
  puertoHttp,
  slugValido,
  urlDe,
  type ConfigSaas,
  type Ejecutor,
} from '../saas/instancias.js';

const CFG: ConfigSaas = {
  dominioBase: 'wa.tuservicio.com',
  postgresPassword: 'secreta',
  pais: 'peru',
  zonaHoraria: 'America/Lima',
  geoBbox: 'none',
  maestroUsuario: 'maestro',
  maestroClave: 'x',
  maestroPuerto: 3900,
};

let base: string;
let llamadas: string[][];
const ejecutar: Ejecutor = async (cmd, args) => {
  llamadas.push([cmd, ...args]);
  return { stdout: '', stderr: '' };
};

beforeEach(() => {
  base = mkdtempSync(path.join(tmpdir(), 'wa-saas-'));
  writeFileSync(path.join(base, 'docker-compose.yml'), 'name: wa-saas\n');
  writeFileSync(path.join(base, '.env'), 'DOMINIO_BASE=wa.tuservicio.com\n');
  llamadas = [];
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('nombres y configuracion', () => {
  it('el slug: minusculas, numeros y guiones; nada reservado', () => {
    expect(slugValido('tienda1')).toBeNull();
    expect(slugValido('zapateria-lima')).toBeNull();
    expect(slugValido('Tienda')).toMatch(/minusculas/);
    expect(slugValido('-tienda')).toMatch(/guion/);
    expect(slugValido('a')).toMatch(/2 a 30/);
    expect(slugValido('maestro')).toMatch(/reservado/);
    expect(slugValido('tienda_1')).toBeTruthy();
  });

  it('de un slug salen el contenedor, la base y la URL', () => {
    expect(contenedorDe('zapateria-lima')).toBe('wa-zapateria-lima');
    expect(baseDe('zapateria-lima')).toBe('wa_zapateria_lima');
    expect(urlDe('zapateria-lima', CFG)).toBe('https://zapateria-lima.wa.tuservicio.com');
    expect(urlDe('t1', { ...CFG, dominioBase: 'localhost' })).toBe('http://t1.localhost');
    expect(urlDe('t1', { ...CFG, dominioBase: 'localhost:8080' })).toBe('http://t1.localhost:8080');
  });

  it('localhost y las IP van sin TLS; el puerto sale del dominio base', () => {
    expect(esLocal('localhost')).toBe(true);
    expect(esLocal('localhost:8080')).toBe(true);
    expect(esLocal('127.0.0.1')).toBe(true);
    expect(esLocal('wa.tuservicio.com')).toBe(false);
    expect(puertoHttp('localhost:8080')).toBe(8080);
    expect(puertoHttp('wa.tuservicio.com')).toBe(80);
  });

  it('saas/.env se lee con valores por defecto y lo del entorno manda', () => {
    writeFileSync(path.join(base, '.env'), '# comentario\nDOMINIO_BASE=https://WA.Ejemplo.com/\nPOSTGRES_PASSWORD="clave"\nPAIS=mexico\nMAESTRO_PUERTO=4000\n');
    const cfg = leerConfigSaas(base, {});
    expect(cfg).toMatchObject({ dominioBase: 'wa.ejemplo.com', postgresPassword: 'clave', pais: 'mexico', maestroPuerto: 4000, maestroUsuario: 'maestro', geoBbox: 'none' });
    expect(leerConfigSaas(base, { DOMINIO_BASE: 'otro.com' }).dominioBase).toBe('otro.com');
    expect(leerConfigSaas(path.join(base, 'no-existe'), {}).dominioBase).toBe('localhost');
  });
});

describe('los ficheros de una instancia', () => {
  it('el .env apunta a SU base, SU Redis y SU URL', () => {
    const env = generarEnv('tienda1', CFG, { nombre: 'Zapateria', proveedor: 'cloud', extra: { GOOGLE_MAPS_API_KEY: 'k' } });
    expect(env).toContain('PUBLIC_BASE_URL=https://tienda1.wa.tuservicio.com');
    expect(env).toContain('DATABASE_URL=postgres://wa:secreta@wa-saas-postgres:5432/wa_tienda1');
    expect(env).toContain('REDIS_URL=redis://wa-tienda1-redis:6379');
    expect(env).toContain('WHATSAPP_PROVIDER=cloud');
    expect(env).toContain('BUSINESS_NAME=Zapateria');
    expect(env).toContain('RUTAS_PAIS=peru');
    expect(env).toContain('GOOGLE_MAPS_API_KEY=k');
    expect(env).toContain('SECRETS_DIR=/app/data');
  });

  it('el compose: app + redis propios, volumenes propios, red comun', () => {
    const c = generarCompose('tienda1');
    expect(c).toContain('name: wa-tienda1');
    expect(c).toContain('container_name: wa-tienda1\n');
    expect(c).toContain('container_name: wa-tienda1-redis');
    expect(c).toContain('image: wa-locator:latest');
    for (const v of ['datos:/app/data', 'wa-auth:/app/.wa-auth', 'wa-media:/app/.wa-media', 'respaldos:/app/respaldos']) expect(c).toContain(v);
    expect(c).toContain('wa-saas:\n    external: true');
    expect(c).not.toContain('ports:');
  });

  it('el trozo de Caddy: HTTPS con dominio real, http en local', () => {
    expect(generarCaddy('tienda1', CFG)).toContain('tienda1.wa.tuservicio.com {\n\treverse_proxy wa-tienda1:3000');
    expect(generarCaddy('tienda1', { ...CFG, dominioBase: 'localhost:8080' })).toContain('http://tienda1.localhost:8080 {');
    const cf = generarCaddyfile(CFG);
    expect(cf).toContain('import instancias/*.caddy');
    expect(cf).toContain('maestro.wa.tuservicio.com {\n\treverse_proxy host.docker.internal:3900');
  });
});

describe('alta y baja', () => {
  it('el alta crea la base, los ficheros, el contenedor y el subdominio, en ese orden', async () => {
    const i = await altaInstancia('tienda1', { nombre: 'Zapateria', proveedor: 'local' }, { cfg: CFG, base, ejecutar, ahora: () => new Date('2026-09-15T10:00:00Z') });
    expect(i).toEqual({ slug: 'tienda1', nombre: 'Zapateria', dominio: 'tienda1.wa.tuservicio.com', url: 'https://tienda1.wa.tuservicio.com', proveedor: 'local', creadaEn: '2026-09-15T10:00:00.000Z' });

    const dir = path.join(base, 'instancias', 'tienda1');
    expect(existsSync(path.join(dir, '.env'))).toBe(true);
    expect(existsSync(path.join(dir, 'compose.yml'))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(dir, 'instancia.json'), 'utf8'))).toMatchObject({ slug: 'tienda1' });
    expect(readFileSync(path.join(base, 'caddy', 'instancias', 'tienda1.caddy'), 'utf8')).toContain('reverse_proxy wa-tienda1:3000');

    expect(llamadas.map((l) => l.slice(0, 3).join(' '))).toEqual(['docker exec wa-saas-postgres', 'docker compose -f', 'docker exec wa-saas-caddy']);
    expect(llamadas[0]).toContain('create database wa_tienda1');
    expect(llamadas[1]).toContain(path.join(dir, 'compose.yml'));
    expect(llamadas[1]).toContain('--wait');
    expect(llamadas[2]).toContain('reload');

    expect(listarInstancias(base).map((x) => x.slug)).toEqual(['tienda1']);
    await expect(altaInstancia('tienda1', {}, { cfg: CFG, base, ejecutar })).rejects.toThrow(/ya existe/);
    await expect(altaInstancia('Mal Slug', {}, { cfg: CFG, base, ejecutar })).rejects.toThrow(/minusculas/);
  });

  it('dos tiendas no comparten nada', async () => {
    await altaInstancia('tienda1', {}, { cfg: CFG, base, ejecutar });
    await altaInstancia('tienda2', {}, { cfg: CFG, base, ejecutar });
    const env1 = readFileSync(path.join(base, 'instancias', 'tienda1', '.env'), 'utf8');
    const env2 = readFileSync(path.join(base, 'instancias', 'tienda2', '.env'), 'utf8');
    for (const clave of ['PUBLIC_BASE_URL', 'DATABASE_URL', 'REDIS_URL']) {
      const v1 = /^(?:.*\n)*?PUBLIC_BASE_URL=(.*)$/m.exec(env1);
      expect(v1).toBeTruthy();
      expect(env1.match(new RegExp(`^${clave}=(.*)$`, 'm'))![1]).not.toBe(env2.match(new RegExp(`^${clave}=(.*)$`, 'm'))![1]);
    }
    expect(listarInstancias(base).map((x) => x.slug)).toEqual(['tienda1', 'tienda2']);
  });

  it('si la base ya existia (de una baja anterior) se reutiliza', async () => {
    const conBase: Ejecutor = async (cmd, args) => {
      llamadas.push([cmd, ...args]);
      if (args.join(' ').includes('create database')) throw Object.assign(new Error('psql'), { stderr: 'ERROR:  database "wa_tienda1" already exists' });
      return { stdout: '', stderr: '' };
    };
    const registro: string[] = [];
    await altaInstancia('tienda1', {}, { cfg: CFG, base, ejecutar: conBase, log: (l) => registro.push(l) });
    expect(registro.join('\n')).toContain('ya existia');
  });

  it('la baja normal para el contenedor y conserva los datos; con --borrar-datos se lleva todo', async () => {
    await altaInstancia('tienda1', {}, { cfg: CFG, base, ejecutar });
    llamadas = [];
    await bajaInstancia('tienda1', {}, { cfg: CFG, base, ejecutar, ahora: () => new Date('2026-09-16T10:00:00Z') });
    expect(existsSync(path.join(base, 'caddy', 'instancias', 'tienda1.caddy'))).toBe(false);
    expect(llamadas[0]![2]).toBe('wa-saas-caddy');
    expect(llamadas[1]).toContain('down');
    expect(llamadas[1]).not.toContain('--volumes');
    expect(llamadas.some((l) => l.join(' ').includes('drop database'))).toBe(false);
    expect(existsSync(path.join(base, 'instancias', 'tienda1', 'BAJA.txt'))).toBe(true);
    expect(existsSync(path.join(base, 'instancias', 'tienda1', 'instancia.json'))).toBe(false);
    expect(listarInstancias(base)).toEqual([]);

    await altaInstancia('tienda2', {}, { cfg: CFG, base, ejecutar });
    llamadas = [];
    await bajaInstancia('tienda2', { borrarDatos: true }, { cfg: CFG, base, ejecutar });
    expect(llamadas[1]).toContain('--volumes');
    expect(llamadas.some((l) => l.join(' ').includes('drop database if exists wa_tienda2'))).toBe(true);
    expect(existsSync(path.join(base, 'instancias', 'tienda2'))).toBe(false);

    await expect(bajaInstancia('no-existe', {}, { cfg: CFG, base, ejecutar })).rejects.toThrow(/no existe/);
  });

  it('prepararBase escribe el Caddyfile, el import vacio y levanta lo comun', async () => {
    await prepararBase({ cfg: CFG, base, ejecutar });
    expect(readFileSync(path.join(base, 'Caddyfile'), 'utf8')).toContain('import instancias/*.caddy');
    expect(existsSync(path.join(base, 'caddy', 'instancias', '_vacio.caddy'))).toBe(true);
    expect(llamadas[0]!.slice(0, 3)).toEqual(['docker', 'compose', '-f']);
    expect(llamadas[0]).toContain('--wait');
  });

  it('el estado pregunta a cada instancia por /health a traves de su URL', async () => {
    await altaInstancia('viva', {}, { cfg: CFG, base, ejecutar });
    await altaInstancia('caida', {}, { cfg: CFG, base, ejecutar });
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).startsWith('https://viva.')) return new Response(JSON.stringify({ ok: true, configured: false }), { status: 200 });
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const estado = await estadoInstancias({ base, fetchImpl });
    expect(estado.find((e) => e.slug === 'viva')).toMatchObject({ viva: true, configurado: false });
    expect(estado.find((e) => e.slug === 'caida')).toMatchObject({ viva: false, detalle: 'ECONNREFUSED' });
  });
});
