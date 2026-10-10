/**
 * El alojamiento: "Dar de alta" en Tiendas levanta la instalacion de la
 * tienda en este servidor.
 *
 * Docker se sustituye por un ejecutor de mentira que apunta lo que se le
 * pide, y el saas/ por una carpeta temporal con su .env. Lo que importa:
 * que la instalacion nazca con PLAN_URL apuntando a ESTE panel y el
 * PLAN_TOKEN de la tienda (no al maestro antiguo), que su URL quede en la
 * tienda, que sin saas/.env no haya alojamiento (solo registro), que un
 * fallo de Docker deje la tienda registrada y lo diga, y que borrar con
 * "parar" o "borrar" apague la instalacion.
 */

import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { createSettingsService } from '../src/settings/service.js';
import { crearAlojamiento } from '../src/tiendas/alojamiento.js';
import { crearServicioTiendas } from '../src/tiendas/servicio.js';
import type { Ejecutor } from '../saas/instancias.js';
import { createFakeRepos, createFakeWhatsApp, createMemorySettingsRepo, TEST_SETTINGS_KEY, type FakeRepos } from './fakes.js';

const ENV = {
  PUBLIC_BASE_URL: 'https://panel.wa.tuservicio.com',
  DATABASE_URL: 'mysql://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'none',
  BUSINESS_NAME: 'Panel',
  RUTAS_PAIS: 'peru',
  TIENDAS_URL_PLAN_BASE: 'http://host.docker.internal:3000',
} as NodeJS.ProcessEnv;

const queue: OutboundQueue = {
  async enqueue() {},
  async enqueueMany(jobs) {
    return jobs.length;
  },
  async pause() {},
  async resume() {},
  async counts() {
    return {};
  },
  async close() {},
};

/** Un Docker que apunta todo y, si se le pide, falla al levantar el contenedor. */
function dockerFalso() {
  const llamadas: string[][] = [];
  const estado = { fallarCompose: false };
  const ejecutar: Ejecutor = async (comando, args) => {
    llamadas.push([comando, ...args]);
    if (estado.fallarCompose && args[0] === 'compose' && args.includes('up')) throw new Error('docker: Cannot connect to the Docker daemon');
    return { stdout: '', stderr: '' };
  };
  return { ejecutar, llamadas, estado };
}

let carpetaSaas: string;
let app: FastifyInstance;
let repos: FakeRepos;
let docker: ReturnType<typeof dockerFalso>;

async function build(conEnv: boolean) {
  carpetaSaas = mkdtempSync(path.join(tmpdir(), 'wa-saas-prueba-'));
  writeFileSync(path.join(carpetaSaas, 'docker-compose.yml'), '# base de prueba\n');
  if (conEnv) writeFileSync(path.join(carpetaSaas, '.env'), 'DOMINIO_BASE=wa.tuservicio.com\nMARIADB_PASSWORD=x\nMAESTRO_CLAVE=y\n');
  docker = dockerFalso();
  const config = loadConfig(ENV);
  repos = createFakeRepos();
  const wa = createFakeWhatsApp();
  const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2, serviceWindowApplies: false });
  const settingsRepo = createMemorySettingsRepo();
  const settings = await createSettingsService(settingsRepo, config, TEST_SETTINGS_KEY);
  await settings.save({ provider: 'local' });
  const alojamiento = crearAlojamiento({ base: carpetaSaas, ejecutar: docker.ejecutar, ahora: () => new Date('2026-09-18T12:00:00Z') });
  const tiendas = crearServicioTiendas({ repo: repos.tiendas, baseUrl: config.PUBLIC_BASE_URL, urlPlanInterna: config.TIENDAS_URL_PLAN_BASE, alojamiento });
  app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false, tiendas, alojamiento });
  await app.ready();
}

const galletaDe = (r: { headers: Record<string, unknown> }) => {
  const c = (r.headers['set-cookie'] as string | string[] | undefined) ?? '';
  return (Array.isArray(c) ? (c[0] ?? '') : c).split(';')[0]!;
};

async function superadmin(): Promise<Record<string, string>> {
  let r = await app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { usuario: 'ali', nombre: 'Ali', clave: 'ali-2026-wa' } });
  if (r.statusCode !== 200) r = await app.inject({ method: 'POST', url: '/login', payload: { usuario: 'ali', clave: 'ali-2026-wa' } });
  return { cookie: galletaDe(r), 'content-type': 'application/json' };
}

describe('con el SaaS preparado en el servidor', () => {
  beforeAll(async () => {
    await build(true);
  });
  afterAll(async () => {
    await app.close();
    rmSync(carpetaSaas, { recursive: true, force: true });
  });

  it('dar de alta levanta la instalacion con el plan apuntando a este panel, y borrar la para', async () => {
    const h = await superadmin();
    const lista = (await app.inject({ method: 'GET', url: '/admin/tiendas', headers: h })).json();
    expect(lista.alojamiento).toMatchObject({ disponible: true, dominioBase: 'wa.tuservicio.com' });

    const alta = await app.inject({ method: 'POST', url: '/admin/tiendas', headers: h, payload: { nombre: 'Zapatería Lima', crearInstalacion: true, membresia: { plan: 'prueba', vencimiento: '2026-10-02T23:59:59' } } });
    expect(alta.statusCode).toBe(200);
    const j = alta.json();
    expect(j.instalacion).toMatchObject({ intentada: true, ok: true, url: 'https://zapateria-lima.wa.tuservicio.com' });
    expect(j.tienda).toMatchObject({ url: 'https://zapateria-lima.wa.tuservicio.com', instalada: true });
    expect(j.pasos[0]).toContain('https://zapateria-lima.wa.tuservicio.com');
    expect(j.mensaje).toBeNull();
    // Docker hizo lo de siempre: base, contenedor, caddy.
    const comandos = docker.llamadas.map((l) => l.join(' '));
    expect(comandos.some((c) => c.includes('create database wa_zapateria_lima'))).toBe(true);
    expect(comandos.some((c) => c.includes('compose') && c.includes('up'))).toBe(true);
    expect(comandos.some((c) => c.includes('caddy reload'))).toBe(true);
    // Y el .env de la instancia apunta a ESTE panel con el token de la tienda (no al maestro antiguo).
    const env = readFileSync(path.join(carpetaSaas, 'instancias', 'zapateria-lima', '.env'), 'utf8');
    expect(env).toContain('PLAN_URL=http://host.docker.internal:3000/api/plan/zapateria-lima');
    expect(env).toContain(`PLAN_TOKEN=${j.token}`);
    expect(env).toContain('PUBLIC_BASE_URL=https://zapateria-lima.wa.tuservicio.com');
    expect(env).toContain('BUSINESS_NAME=Zapatería Lima');
    expect(env).not.toContain('maestroPuerto');
    // Con ese token, la instancia recibe su plan de aqui.
    expect((await app.inject({ method: 'GET', url: '/api/plan/zapateria-lima', headers: { authorization: `Bearer ${j.token}` } })).json()).toMatchObject({ plan: 'prueba' });

    // Borrar parando la instalacion: docker compose down sin --volumes, y la carpeta queda con BAJA.txt.
    docker.llamadas.length = 0;
    const borrar = await app.inject({ method: 'DELETE', url: `/admin/tiendas/${j.tienda.id}?instalacion=parar`, headers: h });
    expect(borrar.json()).toMatchObject({ ok: true, instalacion: { intentada: true, ok: true } });
    const down = docker.llamadas.map((l) => l.join(' ')).find((c) => c.includes('compose') && c.includes('down'));
    expect(down).toBeTruthy();
    expect(down).not.toContain('--volumes');
    expect(existsSync(path.join(carpetaSaas, 'instancias', 'zapateria-lima', 'BAJA.txt'))).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/admin/tiendas', headers: h })).json().tiendas).toEqual([]);
  });

  it('si Docker falla, la tienda queda registrada y se dice; sin pedir instalacion, solo se registra', async () => {
    const h = await superadmin();
    docker.estado.fallarCompose = true;
    const alta = await app.inject({ method: 'POST', url: '/admin/tiendas', headers: h, payload: { nombre: 'Bodega Norte', crearInstalacion: true, membresia: { plan: 'basico', vencimiento: '2026-12-01T23:59:59' } } });
    expect(alta.statusCode).toBe(200);
    expect(alta.json().instalacion).toMatchObject({ intentada: true, ok: false });
    expect(alta.json().instalacion.error).toContain('Docker daemon');
    expect(alta.json().mensaje).toContain('no se pudo levantar');
    expect(alta.json().tienda).toMatchObject({ nombre: 'Bodega Norte', instalada: false, url: null });
    expect(alta.json().pasos[0]).toContain('Membresía');
    docker.estado.fallarCompose = false;

    const sin = await app.inject({ method: 'POST', url: '/admin/tiendas', headers: h, payload: { nombre: 'Solo Registro', crearInstalacion: false, membresia: { plan: 'pro', vencimiento: '2027-01-01T23:59:59' } } });
    expect(sin.json().instalacion).toMatchObject({ intentada: false });
    expect(existsSync(path.join(carpetaSaas, 'instancias', 'solo-registro'))).toBe(false);
  });
});

describe('sin el SaaS preparado', () => {
  beforeAll(async () => {
    await build(false);
  });
  afterAll(async () => {
    await app.close();
    rmSync(carpetaSaas, { recursive: true, force: true });
  });

  it('no hay alojamiento: se registra, se dan los pasos de pegar el token, y no se llama a Docker', async () => {
    const h = await superadmin();
    const lista = (await app.inject({ method: 'GET', url: '/admin/tiendas', headers: h })).json();
    expect(lista.alojamiento.disponible).toBe(false);
    expect(lista.alojamiento.motivo).toContain('saas/.env');
    const alta = await app.inject({ method: 'POST', url: '/admin/tiendas', headers: h, payload: { nombre: 'Tienda Suelta', crearInstalacion: true, membresia: { plan: 'prueba', vencimiento: '2026-10-02T23:59:59' } } });
    expect(alta.json().instalacion).toMatchObject({ intentada: false, ok: false });
    expect(alta.json().pasos[1]).toContain('/api/plan/tienda-suelta');
    expect(docker.llamadas).toEqual([]);
  });
});
