/**
 * El SaaS: una instancia por tienda.
 *
 * Docker no se toca aqui: se sustituye por un ejecutor falso que apunta lo
 * que se le pide. Lo que se prueba es que cada tienda salga con su base, su
 * contenedor, su Redis, su subdominio y sus ficheros, sin pisar a las demas,
 * y que la baja deje (o borre) exactamente lo que debe.
 */

import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  mariadbPassword: 'secreta',
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
    writeFileSync(path.join(base, '.env'), '# comentario\nDOMINIO_BASE=https://WA.Ejemplo.com/\nMARIADB_PASSWORD="clave"\nPAIS=mexico\nMAESTRO_PUERTO=4000\n');
    const cfg = leerConfigSaas(base, {});
    expect(cfg).toMatchObject({ dominioBase: 'wa.ejemplo.com', mariadbPassword: 'clave', pais: 'mexico', maestroPuerto: 4000, maestroUsuario: 'maestro', geoBbox: 'none' });
    expect(leerConfigSaas(base, { DOMINIO_BASE: 'otro.com' }).dominioBase).toBe('otro.com');
    expect(leerConfigSaas(path.join(base, 'no-existe'), {}).dominioBase).toBe('localhost');
  });
});

describe('los ficheros de una instancia', () => {
  it('el .env apunta a SU base, SU Redis y SU URL', () => {
    const env = generarEnv('tienda1', CFG, { nombre: 'Zapateria', proveedor: 'cloud', extra: { GOOGLE_MAPS_API_KEY: 'k' } });
    expect(env).toContain('PUBLIC_BASE_URL=https://tienda1.wa.tuservicio.com');
    expect(env).toContain('DATABASE_URL=mysql://wa:secreta@wa-saas-mariadb:3306/wa_tienda1');
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

    expect(llamadas.map((l) => l.slice(0, 2).join(' '))).toEqual(['docker exec', 'docker exec', 'docker compose', 'docker exec']);
    // La base y los permisos, como root dentro del MariaDB comun (la clave por el entorno).
    expect(llamadas[0]).toContain('wa-saas-mariadb');
    expect(llamadas[0]).toContain('MYSQL_PWD=secreta');
    expect(llamadas[0]!.join(' ')).toContain('create database wa_tienda1 character set utf8mb4 collate utf8mb4_bin');
    // El usuario wa puede con wa_tienda1 y con las bases de sus tiendas (wa_tienda1_*), y con nada mas.
    expect(llamadas[1]).toContain('wa-saas-mariadb');
    expect(llamadas[1]!.join(' ')).toContain("grant all privileges on `wa\\_tienda1`.* to 'wa'@'%'; grant all privileges on `wa\\_tienda1\\_%`.* to 'wa'@'%'");
    expect(llamadas[2]).toContain(path.join(dir, 'compose.yml'));
    expect(llamadas[2]).toContain('--wait');
    expect(llamadas[3]).toContain('wa-saas-caddy');
    expect(llamadas[3]).toContain('reload');

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
      if (args.join(' ').includes('create database')) throw Object.assign(new Error('mariadb'), { stderr: "ERROR 1007 (HY000) at line 1: Can't create database 'wa_tienda1'; database exists" });
      return { stdout: '', stderr: '' };
    };
    const registro: string[] = [];
    await altaInstancia('tienda1', {}, { cfg: CFG, base, ejecutar: conBase, log: (l) => registro.push(l) });
    expect(registro.join('\n')).toContain('ya existia');
    // Los permisos se dan igual.
    expect(llamadas.some((l) => l.join(' ').includes('grant all privileges'))).toBe(true);
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
    // MariaDB contesta con las bases de las tiendas registradas dentro de esa instancia.
    const conTiendas: Ejecutor = async (cmd, args) => {
      llamadas.push([cmd, ...args]);
      if (args.join(' ').includes('information_schema.schemata')) return { stdout: 'schema_name\nwa_tienda2_plataforma\nwa_tienda2_t_abc123\n', stderr: '' };
      return { stdout: '', stderr: '' };
    };
    await bajaInstancia('tienda2', { borrarDatos: true }, { cfg: CFG, base, ejecutar: conTiendas });
    expect(llamadas[1]).toContain('--volumes');
    const borradas = llamadas.map((l) => l.join(' ')).filter((l) => l.includes('drop database'));
    expect(borradas.map((l) => /drop database if exists (\S+)/.exec(l)![1])).toEqual(['wa_tienda2_plataforma', 'wa_tienda2_t_abc123', 'wa_tienda2']);
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

describe('planes y cobro', () => {
  it('una tienda nace con la prueba de 14 dias; el .env lleva donde preguntar y su token; el estado lo ensena', async () => {
    const { leerPlan, estadoPlan } = await import('../saas/planes.js');
    const ahora = () => new Date('2026-09-15T10:00:00Z');
    await altaInstancia('tienda1', {}, { cfg: CFG, base, ejecutar, ahora });
    const dir = path.join(base, 'instancias', 'tienda1');
    const p = leerPlan(dir)!;
    expect(p).toMatchObject({ plan: 'prueba', vencimiento: '2026-09-29T10:00:00.000Z', pagos: [] });
    expect(p.token).toMatch(/^plt_[A-Za-z0-9_-]{20,}$/);
    const env = readFileSync(path.join(dir, '.env'), 'utf8');
    expect(env).toContain('PLAN_URL=http://host.docker.internal:3900/api/plan/tienda1');
    expect(env).toContain(`PLAN_TOKEN=${p.token}`);
    expect(readFileSync(path.join(dir, 'compose.yml'), 'utf8')).toContain('host.docker.internal:host-gateway');

    expect(estadoPlan(p, ahora())).toMatchObject({ plan: 'prueba', nombre: 'Prueba', diasRestantes: 14, vencido: false, aviso: null, limites: { iaTurnosMes: 300, campanas: true } });
    expect(estadoPlan(p, new Date('2026-09-24T10:00:00Z')).aviso).toMatch(/termina en 5 días/);
    expect(estadoPlan(p, new Date('2026-10-01T10:00:00Z'))).toMatchObject({ vencido: true, diasRestantes: -2 });
    expect(estadoPlan(p, new Date('2026-10-01T10:00:00Z')).aviso).toMatch(/prueba gratis terminó/);

    const estado = await estadoInstancias({ base, fetchImpl: (async () => { throw new Error('x'); }) as unknown as typeof fetch, ahora });
    expect(estado[0]?.plan).toMatchObject({ plan: 'prueba', diasRestantes: 14 });
  });

  it('un pago cambia al plan pagado y corre el vencimiento desde lo que quede; vencido, desde hoy', async () => {
    const { planInicial, registrarPago, cambiarPlan, ingresosMensuales, PLANES } = await import('../saas/planes.js');
    const hoy = new Date('2026-09-15T10:00:00Z');
    const prueba = planInicial(hoy, 'prueba', 'plt_x');
    // De la prueba a basico: los meses cuentan desde hoy, no desde el fin de la prueba.
    const basico = registrarPago(prueba, { plan: 'basico', meses: 1, nota: 'Yape op. 1' }, hoy);
    expect(basico).toMatchObject({ plan: 'basico', vencimiento: '2026-10-15T10:00:00.000Z', token: 'plt_x' });
    expect(basico.pagos).toEqual([{ fecha: hoy.toISOString(), plan: 'basico', meses: 1, monto: 49, moneda: 'PEN', nota: 'Yape op. 1' }]);
    // Renovar antes de vencer suma desde el vencimiento.
    const renovado = registrarPago(basico, { plan: 'basico', meses: 2, monto: 90 }, new Date('2026-10-01T10:00:00Z'));
    expect(renovado.vencimiento).toBe('2026-12-15T10:00:00.000Z');
    expect(renovado.pagos[1]?.monto).toBe(90);
    // Renovar ya vencido cuenta desde hoy, y subir a pro cambia el plan.
    const tarde = registrarPago(renovado, { plan: 'pro', meses: 1 }, new Date('2027-01-10T10:00:00Z'));
    expect(tarde).toMatchObject({ plan: 'pro', vencimiento: '2027-02-10T10:00:00.000Z' });
    expect(() => registrarPago(prueba, { plan: 'prueba', meses: 1 })).toThrow(/plan de pago/);
    expect(() => registrarPago(prueba, { plan: 'pro', meses: 0 })).toThrow(/meses/);

    const prorroga = cambiarPlan(basico, { vencimiento: '2026-11-01', contacto: 'Escríbenos al 999' });
    expect(prorroga).toMatchObject({ plan: 'basico', vencimiento: '2026-11-01T23:59:59.000Z', contacto: 'Escríbenos al 999' });
    expect(() => cambiarPlan(basico, { vencimiento: 'ayer' })).toThrow(/fecha/);

    expect(ingresosMensuales([prueba, basico, tarde], new Date('2026-10-01T10:00:00Z'))).toBe(PLANES.basico.precioMes + PLANES.pro.precioMes);
    expect(ingresosMensuales([basico], new Date('2026-12-01T10:00:00Z'))).toBe(0);
  });
});

describe('dar plan a una tienda anterior a los planes', () => {
  it('escribe el plan.json, pone PLAN_URL y PLAN_TOKEN en el .env y recrea el contenedor; con plan, no toca nada', async () => {
    const { iniciarPlan, generarEnv } = await import('../saas/instancias.js');
    const { leerPlan } = await import('../saas/planes.js');
    // Una instancia vieja: sin plan.json y sin PLAN_* en el .env.
    const dir = path.join(base, 'instancias', 'vieja');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, '.env'), generarEnv('vieja', CFG, {}));
    writeFileSync(path.join(dir, 'compose.yml'), 'name: wa-vieja\n');
    writeFileSync(path.join(dir, 'instancia.json'), JSON.stringify({ slug: 'vieja', nombre: 'Vieja', dominio: 'x', url: 'https://vieja.wa.tuservicio.com', proveedor: 'local', creadaEn: '2026-01-01T00:00:00.000Z' }));
    expect(readFileSync(path.join(dir, '.env'), 'utf8')).not.toContain('PLAN_URL');

    const p = await iniciarPlan('vieja', { cfg: CFG, base, ejecutar, ahora: () => new Date('2026-09-15T10:00:00Z') });
    expect(p).toMatchObject({ plan: 'prueba', vencimiento: '2026-09-29T10:00:00.000Z' });
    expect(leerPlan(dir)).toEqual(p);
    const env = readFileSync(path.join(dir, '.env'), 'utf8');
    expect(env).toContain('PLAN_URL=http://host.docker.internal:3900/api/plan/vieja');
    expect(env).toContain(`PLAN_TOKEN=${p.token}`);
    expect(env).toContain('DATABASE_URL=');
    expect(llamadas).toEqual([['docker', 'compose', '-f', path.join(dir, 'compose.yml'), 'up', '-d', '--wait']]);

    expect(await iniciarPlan('vieja', { cfg: CFG, base, ejecutar })).toEqual(p);
    expect(llamadas).toHaveLength(1);
    await expect(iniciarPlan('nadie', { cfg: CFG, base, ejecutar })).rejects.toThrow(/no existe/);
  });
});
