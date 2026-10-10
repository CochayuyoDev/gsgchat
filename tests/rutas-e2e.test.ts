/**
 * El día completo de reparto, de punta a punta.
 *
 * Las otras pruebas miran piezas sueltas. Esta recorre el camino entero tal
 * como pasa en la calle: se carga la lista, el motor escribe, los clientes
 * contestan (o no), y al final se comprueba lo que de verdad importa -que GSG
 * se entera de todo y que ningún caso se queda en el limbo-.
 *
 * Todo pasa por el servidor real y por el webhook real; lo único de mentira
 * es el cliente de WhatsApp, que apunta lo que le mandan en vez de enviarlo.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { crearMotor, OPCIONES_POR_DEFECTO, type Motor } from '../src/rutas/motor.js';
import { crearPuertoEnEspera, despacharReportes, crearPuertoHttp } from '../src/rutas/gsg.js';
import {
  createFakeRepos,
  createFakeSettings,
  createFakeWhatsApp,
  type FakeRepos,
  type FakeWhatsApp,
  CLAVE_API_PRUEBA as ADMIN,
} from './fakes.js';


const ENV = {
  PUBLIC_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'mysql://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'lima',
  RUTAS_PAIS: 'peru',
  // El simulador de entrantes: es lo que permite que el cliente "conteste".
  DEV_SIMULATE_INBOUND: 'true',
  BUSINESS_NAME: 'Tienda de prueba',
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

const auth = { 'x-api-key': ADMIN };

/** 10:00 en Lima: dentro del horario de envío. */
let ahora = new Date('2026-03-10T15:00:00Z');
const avanzar = (minutos: number) => {
  ahora = new Date(ahora.getTime() + minutos * 60_000);
};

let app: FastifyInstance;
let repos: FakeRepos;
let wa: FakeWhatsApp;
let motor: Motor;

beforeAll(async () => {
  const config = loadConfig(ENV);
  repos = createFakeRepos();
  wa = createFakeWhatsApp();
  const settings = await createFakeSettings(config);
  const sender = createSender({
    repos,
    wa,
    phoneNumberId: 'PNID',
    warmup: { startPerDay: 500, growth: 2, hardCap: 1000 },
    maxMarketingPerContact7d: 2,
    // Con cliente no oficial la ventana de 24 h no aplica.
    serviceWindowApplies: false,
    now: () => ahora,
  });

  app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false });
  await app.ready();

  motor = crearMotor({
    repos,
    sender,
    gsg: crearPuertoEnEspera(),
    // Espera corta a proposito: con las 3 h reales, tres intentos seguidos se salen del horario.
    opciones: { ...OPCIONES_POR_DEFECTO, esperaRespuestaMinutos: 30, negocio: 'Tienda de prueba' },
    usarPlantilla: () => false,
    ahora: () => ahora,
    // Pausa mínima siempre: la prueba controla el reloj.
    azar: () => 0,
  });
});

afterAll(async () => {
  await app.close();
});

/** Deja pasar el tiempo suficiente para que el motor pueda volver a enviar. */
async function tickTrasLaPausa() {
  avanzar(1);
  return motor.tick();
}

let loteId = '';

describe('un día de reparto, de punta a punta', () => {
  it('1. se carga la lista del día y se marca lo que no sirve', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/rutas/lotes',
      headers: auth,
      payload: {
        nombre: 'Reparto de prueba',
        arrancar: true,
        texto: [
          'telefono;nombre;pedido;distrito',
          '987000001;Ana Ruiz;P-1;Miraflores',
          '987000002;Luis Paz;P-2;Surco',
          '987000003;Marta Gil;P-3;Lince',
          '98700000;Pedro Soto;P-4;Brena',
        ].join('\n'),
      },
    });

    const cuerpo = res.json();
    loteId = cuerpo.lote.id;

    expect(cuerpo).toMatchObject({ total: 4, listas: 3, conIncidencia: 1 });
    expect(cuerpo.lote.estado).toBe('enviando');
    // El número corto ya está reportado a GSG antes de escribirle a nadie.
    expect(repos.rutas._reportes.filter((r) => r.tipo === 'incidencia')).toHaveLength(1);
  });

  it('2. el motor escribe de uno en uno, respetando la pausa', async () => {
    const primero = await motor.tick();
    expect(primero).toMatchObject({ accion: 'envio', paso: 'solicitud' });

    // Inmediatamente después no sale nada: falta la pausa.
    expect(await motor.tick()).toMatchObject({ accion: 'nada', motivo: expect.stringMatching(/pausa/) });

    await tickTrasLaPausa();
    await tickTrasLaPausa();

    // El botón nativo de ubicación: es lo que sale con cliente no oficial.
    const enviados = wa.sent.filter((m) => m.kind === 'location_request');
    expect(enviados).toHaveLength(3);

    // Al del número corto no se le escribió nunca.
    const destinos = wa.sent.map((m) => String(m.to ?? ''));
    expect(destinos).toEqual(
      expect.arrayContaining(['51987000001', '51987000002', '51987000003']),
    );
    expect(destinos.some((d) => d.endsWith('98700000'))).toBe(false);
  });

  it('3. quien manda su ubicación queda resuelto y sale hacia GSG', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/dev/inbound',
      headers: auth,
      payload: { phone: '51987000001', location: { latitude: -12.1211, longitude: -77.0301 } },
    });
    expect(res.statusCode).toBe(200);

    const lista = await app.inject({
      method: 'GET',
      url: `/admin/rutas/solicitudes?loteId=${loteId}&vista=resueltos`,
      headers: auth,
    });
    const resueltas = lista.json().items;

    expect(resueltas).toHaveLength(1);
    expect(resueltas[0]).toMatchObject({ referencia: 'P-1', estado: 'resuelto' });
    expect(resueltas[0].lat).toBeCloseTo(-12.1211);

    const reporte = repos.rutas._reportes.find((r) => r.tipo === 'ubicacion');
    expect(reporte?.payload).toMatchObject({ referencia: 'P-1', telefono: '51987000001' });

    // Y se le contesta al cliente: no se le deja hablando solo.
    expect(wa.sent.at(-1)?.body).toMatch(/recibimos su ubicación/i);
  });

  it('4. quien contesta otra cosa se aparta para que lo mire una persona', async () => {
    await app.inject({
      method: 'POST',
      url: '/admin/dev/inbound',
      headers: auth,
      payload: { phone: '51987000002', text: 'estoy por el mercado de Surco, casa de reja verde' },
    });

    const lista = await app.inject({
      method: 'GET',
      url: `/admin/rutas/solicitudes?loteId=${loteId}&vista=respondieron`,
      headers: auth,
    });
    const items = lista.json().items;

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      referencia: 'P-2',
      estado: 'respondio',
      requiereHumano: true,
      incidencia: 'respondio_sin_ubicacion',
    });
    // Lo que escribió se guarda: puede ser una dirección que sirva.
    expect(items[0].incidenciaDetalle).toContain('mercado de Surco');
  });

  it('5. a quien no contesta se le insiste y después pasa al repartidor', async () => {
    // Marta (P-3) no ha contestado. Vence la espera dos veces más.
    for (let vuelta = 0; vuelta < 2; vuelta++) {
      avanzar(30 + 1);
      let salida = await motor.tick();
      // Puede tocarle antes a Luis (que contestó): se avanza hasta que salga.
      while (salida.accion === 'nada' && salida.motivo?.includes('pausa')) {
        avanzar(1);
        salida = await motor.tick();
      }
    }

    avanzar(30 + 1);
    let salida = await motor.tick();
    while (salida.accion !== 'derivacion' && salida.accion !== 'nada') {
      avanzar(30 + 1);
      salida = await motor.tick();
    }

    const derivados = await app.inject({
      method: 'GET',
      url: `/admin/rutas/solicitudes?loteId=${loteId}&vista=derivados`,
      headers: auth,
    });
    const items = derivados.json().items;

    expect(items.length).toBeGreaterThanOrEqual(1);
    const marta = items.find((s: { referencia: string }) => s.referencia === 'P-3');
    expect(marta).toMatchObject({ estado: 'derivado', requiereHumano: true });
    expect(['sin_respuesta', 'respondio_sin_ubicacion']).toContain(marta.incidencia);
  });

  it('6. el resumen dice cuántos contestaron y cuántos no', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/rutas', headers: auth });
    const cuerpo = res.json();

    // Tres personas necesitan atención: el número corto, el que contestó sin
    // ubicación y el derivado.
    expect(cuerpo.alertas.requierenPersona).toBeGreaterThanOrEqual(3);
    expect(cuerpo.cifras.resuelto).toBe(1);

    const vistas = await app.inject({
      method: 'GET',
      url: `/admin/rutas/vistas?loteId=${loteId}`,
      headers: auth,
    });
    expect(vistas.json().cifras).toMatchObject({ resueltos: 1, numero_malo: 1, todos: 4 });
  });

  it('7. el CSV para GSG trae cada caso con su motivo', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/admin/rutas/lotes/${loteId}.csv`,
      headers: auth,
    });

    const lineas = res.body.trim().split('\r\n');
    expect(lineas).toHaveLength(5); // cabecera + 4 clientes
    expect(res.body).toContain('numero_corto');
    expect(res.body).toContain('-12.1211');
  });

  it('8. la cola hacia GSG sale entera en cuanto hay API', async () => {
    const pendientesAntes = (await repos.rutas.cifrasReportes()).pendiente;
    expect(pendientesAntes).toBeGreaterThan(0);

    const recibido: Array<{ ruta: string; cuerpo: unknown }> = [];
    const puerto = crearPuertoHttp({
      url: 'https://gsg.example/api',
      token: 'secreto',
      fetchImpl: (async (url: string, opciones: { body: string }) => {
        recibido.push({ ruta: String(url), cuerpo: JSON.parse(opciones.body) });
        return new Response(JSON.stringify({ id: `GSG-${recibido.length}` }), { status: 200 });
      }) as never,
    });

    const salida = await despacharReportes(repos, puerto, 100);

    expect(salida.enviados).toBe(pendientesAntes);
    expect((await repos.rutas.cifrasReportes()).pendiente).toBe(0);
    // Cada tipo va a su endpoint.
    expect(recibido.some((r) => r.ruta.endsWith('/ubicaciones'))).toBe(true);
    expect(recibido.some((r) => r.ruta.endsWith('/incidencias'))).toBe(true);
  });
});
