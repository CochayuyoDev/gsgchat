/**
 * Los ajustes generales que se cambian desde la pantalla: como se guardan,
 * como pisan al .env, que el modo prueba del servidor no se pueda soltar, y
 * que la API los exija de un administrador de carne y hueso.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { politicaDesdeConfig } from '../src/salud/politica.js';
import { horaLocal } from '../src/salud/ritmo.js';
import { crearServicioAjustes, createAjustesGeneralesRepo, type ServicioAjustes } from '../src/ajustes/generales.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp, type FakeRepos, CLAVE_API_PRUEBA } from './fakes.js';

const ENV_BASE = {
  PUBLIC_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'mysql://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'lima',
  BUSINESS_NAME: 'La Tienda',
  RUTAS_SUPERVISOR: '51912000001',
  HORARIO_ENVIO_INICIO: '9',
  HORARIO_ENVIO_FIN: '18',
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

function cookieDe(res: { headers: Record<string, unknown> }): string {
  const set = res.headers['set-cookie'];
  const linea = Array.isArray(set) ? set[0] : (set as string | undefined);
  return (linea as string).split(';')[0]!;
}

describe('servicio de ajustes', () => {
  it('el horario de entregas amplía el del número (los pines salen hasta el horario extendido)', async () => {
    const config = loadConfig(ENV_BASE);
    const repos = createFakeRepos();
    const ajustes = await crearServicioAjustes({ repo: repos.ajustesGenerales, config, releerCadaMs: 0 });
    const base = politicaDesdeConfig(config, 'cloud');
    expect(ajustes.politica(base)).toMatchObject({ horaInicio: 9, horaFin: 18 });
    // Lo que registran las entregas del día: desde las 14:00 hasta las 22:30 → el número deja pasar hasta las 23:00.
    let franja: { desde: string; hasta: string } | null = { desde: '14:00', hasta: '22:30' };
    ajustes.ampliarHorario(() => franja);
    expect(ajustes.politica(base)).toMatchObject({ horaInicio: 9, horaFin: 23 });
    // Un horario de entregas más corto que el del número no lo recorta.
    franja = { desde: '10:00', hasta: '16:00' };
    expect(ajustes.politica(base)).toMatchObject({ horaInicio: 9, horaFin: 18 });
    // Sin franja (por ejemplo, sin el módulo de entregas) no cambia nada.
    franja = null;
    expect(ajustes.politica(base)).toMatchObject({ horaInicio: 9, horaFin: 18 });
  });

  it('la zona horaria elegida en Ajustes manda en la política de envío; una zona inventada se rechaza', async () => {
    const config = loadConfig(ENV_BASE);
    const repos = createFakeRepos();
    const ajustes = await crearServicioAjustes({ repo: repos.ajustesGenerales, config, releerCadaMs: 0 });
    const base = politicaDesdeConfig(config, 'cloud');
    expect(ajustes.zonaHoraria()).toBe(config.timezone);
    expect(ajustes.politica(base).timezone).toBe(config.timezone);
    await ajustes.guardar({ zonaHoraria: 'America/Bogota' });
    expect(ajustes.zonaHoraria()).toBe('America/Bogota');
    expect(ajustes.politica(base).timezone).toBe('America/Bogota');
    await expect(ajustes.guardar({ zonaHoraria: 'Marte/Olympus' })).rejects.toThrow(/zona horaria/i);
    await ajustes.guardar({ zonaHoraria: null });
    expect(ajustes.zonaHoraria()).toBe(config.timezone);
  });

  it('sin nada guardado manda el .env; lo guardado pisa campo a campo y null vuelve al servidor', async () => {
    const config = loadConfig(ENV_BASE);
    const repos = createFakeRepos();
    const ajustes = await crearServicioAjustes({ repo: repos.ajustesGenerales, config, releerCadaMs: 0 });
    const base = politicaDesdeConfig(config, 'cloud');

    expect(ajustes.nombreNegocio()).toBe('La Tienda');
    expect(ajustes.supervisor()).toBe('51912000001');
    expect(ajustes.soloNumeros()).toEqual([]);
    expect(ajustes.politica(base)).toMatchObject({ horaInicio: 9, horaFin: 18, avisarA: '51912000001' });

    await ajustes.guardar({
      nombreNegocio: 'GSG Reparto',
      horario: { inicio: 8, fin: 20, dias: [1, 2, 3] },
      ritmo: { maxPorMinuto: 2, pausaMinSeg: 20, pausaMaxSeg: 10 },
      avisos: { supervisor: '+51 912 426 667' },
      humanizar: false,
    });
    const p = ajustes.politica(base);
    expect(ajustes.nombreNegocio()).toBe('GSG Reparto');
    expect(ajustes.supervisor()).toBe('51912426667');
    expect(p).toMatchObject({ horaInicio: 8, horaFin: 20, diasPermitidos: [1, 2, 3], maxPorMinuto: 2, avisarA: '51912426667', humanizar: false });
    // La pausa maxima nunca queda por debajo de la minima.
    expect(p.pausaMinMs).toBe(20_000);
    expect(p.pausaMaxMs).toBe(20_000);
    // Lo que no se toco sigue siendo lo del perfil.
    expect(p.maxPorHora).toBe(base.maxPorHora);

    await ajustes.guardar({ horario: { inicio: null }, avisos: { supervisor: '' } });
    expect(ajustes.politica(base).horaInicio).toBe(9);
    expect(ajustes.supervisor()).toBe('51912000001');

    await ajustes.restablecer();
    expect(ajustes.nombreNegocio()).toBe('La Tienda');
    expect(ajustes.politica(base).horaFin).toBe(18);
  });

  it('«Enviar aunque sea domingo» deja escribir solo ese día (fecha de Lima); al siguiente vuelve la regla', async () => {
    const config = loadConfig(ENV_BASE);
    const repos = createFakeRepos();
    let reloj = Date.parse('2026-10-25T17:00:00Z'); // domingo 25/10, 12:00 en Lima
    const ajustes = await crearServicioAjustes({ repo: repos.ajustesGenerales, config, releerCadaMs: 0, ahora: () => reloj });
    const base = politicaDesdeConfig(config, 'cloud');
    expect(base.diasPermitidos).not.toContain(0);
    expect(ajustes.politica(base).diasPermitidos).not.toContain(0);
    await ajustes.guardar({ horario: { diaExtra: '2026-10-25' } });
    expect(ajustes.politica(base).diasPermitidos).toContain(0);
    // Domingo 23:59 en Lima (ya lunes en UTC): sigue valiendo.
    reloj = Date.parse('2026-10-26T04:59:00Z');
    expect(ajustes.politica(base).diasPermitidos).toContain(0);
    // El domingo siguiente ya no.
    reloj = Date.parse('2026-11-01T17:00:00Z');
    expect(ajustes.politica(base).diasPermitidos).not.toContain(0);
  });

  it('retira el modo prueba, incluso si había una lista guardada o en el servidor', async () => {
    const config = loadConfig({ ...ENV_BASE, SOLO_NUMEROS: '51902464984' });
    const repos = createFakeRepos();
    await repos.ajustesGenerales.set({ modoPrueba: { activo: true, numeros: ['51902464984'] } });
    const ajustes = await crearServicioAjustes({ repo: repos.ajustesGenerales, config, releerCadaMs: 0 });
    expect(ajustes.soloNumeros()).toEqual([]);
    expect(ajustes.actual().modoPrueba).toEqual({ activo: false, numeros: [] });
    expect(ajustes.modoPruebaFijado()).toBe(false);
    await expect(ajustes.guardar({ modoPrueba: { activo: true, numeros: ['51902464984'] } })).rejects.toThrow();
  });
});

describe('/admin/ajustes', () => {
  let app: FastifyInstance;
  let repos: FakeRepos;
  let ajustes: ServicioAjustes;
  let admin = '';
  let operador = '';

  beforeAll(async () => {
    const config = loadConfig(ENV_BASE);
    repos = createFakeRepos();
    const wa = createFakeWhatsApp();
    const settings = await createFakeSettings(config);
    ajustes = await crearServicioAjustes({ repo: repos.ajustesGenerales, config, releerCadaMs: 0 });
    const politica = () => ajustes.politica(politicaDesdeConfig(config, 'cloud'));
    const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
    app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false, politica, ajustes });
    await app.ready();
    admin = cookieDe(await app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { nombre: 'Ali', usuario: 'ali', clave: 'clave-segura-1' } }));
    await app.inject({ method: 'POST', url: '/admin/usuarios', headers: { cookie: admin }, payload: { nombre: 'Rosa', usuario: 'rosa', clave: 'rosa-clave-1' } });
    operador = cookieDe(await app.inject({ method: 'POST', url: '/login', payload: { usuario: 'rosa', clave: 'rosa-clave-1' }, remoteAddress: '10.0.0.5' }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('devuelve lo guardado, lo del servidor y lo efectivo', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/ajustes', headers: { cookie: admin } });
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.servidor).toMatchObject({ nombreNegocio: 'La Tienda', supervisor: '51912000001' });
    expect(r.efectivo).toMatchObject({ nombreNegocio: 'La Tienda', horario: { inicio: 9, fin: 18 }, ritmo: { perfil: 'cloud' } });
    expect(r.modoPruebaFijado).toBe(false);
    expect(r.guardado.horario.inicio).toBeNull();
  });

  it('un admin guarda y lo efectivo cambia en el acto; el nombre se ve en la portada', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/ajustes',
      headers: { cookie: admin },
      payload: { nombreNegocio: 'Reparto GSG', horario: { inicio: 7, fin: 21, dias: [1, 2, 3, 4, 5] } },
    });
    expect(res.statusCode).toBe(200);
    const r = (await app.inject({ method: 'GET', url: '/admin/ajustes', headers: { cookie: admin } })).json();
    expect(r.efectivo).toMatchObject({ nombreNegocio: 'Reparto GSG', horario: { inicio: 7, fin: 21, dias: [1, 2, 3, 4, 5] }, soloNumeros: [] });
    expect((await app.inject({ method: 'GET', url: '/' })).body).toContain('Reparto GSG');
    expect((await app.inject({ method: 'GET', url: '/panel', headers: { cookie: admin } })).body).toContain('Reparto GSG');
  });

  it('/admin/ajustes/hoy dice si hoy toca escribir y «escribir-hoy» lo abre solo por hoy', async () => {
    const { dia } = horaLocal(new Date(), 'America/Lima');
    // Todos los días menos hoy: hoy no toca.
    await app.inject({ method: 'POST', url: '/admin/ajustes', headers: { cookie: admin }, payload: { horario: { dias: [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== dia), diaExtra: null } } });
    const antes = (await app.inject({ method: 'GET', url: '/admin/ajustes/hoy', headers: { cookie: operador } })).json();
    expect(antes).toMatchObject({ tocaHoy: false });
    expect(typeof antes.dia).toBe('string');
    const r = await app.inject({ method: 'POST', url: '/admin/ajustes/escribir-hoy', headers: { cookie: operador }, payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json().detalle).toContain(antes.dia);
    expect((await app.inject({ method: 'GET', url: '/admin/ajustes/hoy', headers: { cookie: admin } })).json()).toMatchObject({ tocaHoy: true });
    expect(ajustes.actual().horario.diaExtra).toBe(antes.fecha);
    expect((await app.inject({ method: 'GET', url: '/admin/ajustes/hoy' })).statusCode).toBe(401);
  });

  it('rechaza un numero mal escrito y valida los rangos', async () => {
    const malo = await app.inject({ method: 'POST', url: '/admin/ajustes', headers: { cookie: admin }, payload: { avisos: { supervisor: '12' } } });
    expect(malo.statusCode).toBe(400);
    const hora = await app.inject({ method: 'POST', url: '/admin/ajustes', headers: { cookie: admin }, payload: { horario: { inicio: 30 } } });
    expect(hora.statusCode).toBe(400);
  });

  it('un operador lo ve pero no lo cambia; una clave de API tampoco', async () => {
    expect((await app.inject({ method: 'GET', url: '/admin/ajustes', headers: { cookie: operador } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/admin/ajustes', headers: { cookie: operador }, payload: { nombreNegocio: 'X' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: '/admin/ajustes', headers: { cookie: operador } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/admin/ajustes', headers: { 'x-api-key': CLAVE_API_PRUEBA }, payload: { nombreNegocio: 'X' } })).statusCode).toBe(403);
    expect(ajustes.nombreNegocio()).toBe('Reparto GSG');
  });

  it('restablecer vuelve a lo del servidor', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/admin/ajustes', headers: { cookie: admin } });
    expect(res.statusCode).toBe(200);
    expect(ajustes.nombreNegocio()).toBe('La Tienda');
    expect(ajustes.soloNumeros()).toEqual([]);
  });

  it('una sola franja de envio: la que se guarda en Automatizacion GSG es la que frena al motor', async () => {
    // El sintoma de antes: se ponia 08:00 en la pantalla y el motor seguia
    // esperando a las 09:00, porque habia dos horarios guardados en sitios
    // distintos. Ahora la pantalla del reparto escribe la franja general.
    const guardar = await app.inject({
      method: 'POST',
      url: '/admin/rutas/ajustes',
      headers: { cookie: admin },
      payload: { horaInicio: 8, horaFin: 22 },
    });
    expect(guardar.statusCode).toBe(200);
    expect(guardar.json().vigente).toMatchObject({ horaInicio: 8, horaFin: 22 });

    // 1. Los ajustes generales (la unica fuente) ya lo tienen.
    const generales = await app.inject({ method: 'GET', url: '/admin/ajustes', headers: { cookie: admin } });
    expect(generales.json().efectivo.horario).toMatchObject({ inicio: 8, fin: 22 });

    // 2. La pantalla del reparto ensena lo mismo, no otra cosa.
    const delReparto = await app.inject({ method: 'GET', url: '/admin/rutas/ajustes', headers: { cookie: admin } });
    expect(delReparto.json().ajustes).toMatchObject({ horaInicio: 8, horaFin: 22 });

    // 3. Y el estado del modulo, que es lo que mira el motor.
    const estado = await app.inject({ method: 'GET', url: '/admin/rutas', headers: { cookie: admin } });
    expect(estado.json().motor.horario).toEqual([8, 22]);

    // Un fin que no puede ser: se rechaza y no se guarda a medias.
    const malo = await app.inject({ method: 'POST', url: '/admin/rutas/ajustes', headers: { cookie: admin }, payload: { horaInicio: 20, horaFin: 20 } });
    expect(malo.statusCode).toBe(400);
    const despues = await app.inject({ method: 'GET', url: '/admin/ajustes', headers: { cookie: admin } });
    expect(despues.json().efectivo.horario).toMatchObject({ inicio: 8, fin: 22 });
  });
});
