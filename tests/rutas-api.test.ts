/**
 * La API del modulo de rutas, contra el servidor real con dobles en memoria.
 *
 * Es el camino que usa la pantalla y el que usara GSG cuando tenga API, asi
 * que lo que se prueba aqui es el contrato: que una tabla pegada acabe en
 * solicitudes marcadas, que las vistas cuenten lo que dicen y que corregir un
 * telefono devuelva el caso a la cola en vez de dejarlo colgado.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import type { OutboundQueue } from '../src/outbound/queue.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp, type FakeRepos } from './fakes.js';

const ADMIN = 'admin-token-de-prueba-1234';

const ENV = {
  PUBLIC_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  ADMIN_TOKEN: ADMIN,
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'lima',
  RUTAS_PAIS: 'peru',
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

const auth = { authorization: `Bearer ${ADMIN}` };

let app: FastifyInstance;
let repos: FakeRepos;

beforeAll(async () => {
  const config = loadConfig(ENV);
  repos = createFakeRepos();
  const wa = createFakeWhatsApp();
  const settings = await createFakeSettings(config);
  const sender = createSender({
    repos,
    wa,
    phoneNumberId: 'PNID',
    warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 },
    maxMarketingPerContact7d: 2,
  });
  app = await buildServer({ config, repos, settings, wa, sender, queue, logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  repos.rutas._lotes.length = 0;
  repos.rutas._solicitudes.length = 0;
  repos.rutas._reportes.length = 0;
  repos.rutas._eventos.length = 0;
});

const TABLA = [
  'telefono;nombre;pedido;distrito',
  '987654321;Ana Ruiz;P-1;Miraflores',
  '98765432;Pedro Soto;P-2;Surco',
  '911111111;Luis Paz;P-3;Lince',
].join('\n');

async function crearLote(extra: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/admin/rutas/lotes',
    headers: auth,
    payload: { nombre: 'Reparto de prueba', texto: TABLA, ...extra },
  });
  return { res, cuerpo: res.json() };
}

describe('cargar el lote', () => {
  it('previsualizar dice que entendio sin guardar nada', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/rutas/previsualizar',
      headers: auth,
      payload: { texto: TABLA },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      conCabecera: true,
      listas: 2,
      conIncidencia: 1,
      incidencias: { numero_corto: 1 },
    });
    expect(repos.rutas._lotes).toHaveLength(0);
  });

  it('crea el lote con los numeros malos ya marcados', async () => {
    const { res, cuerpo } = await crearLote();

    expect(res.statusCode).toBe(200);
    expect(cuerpo).toMatchObject({ total: 3, listas: 2, conIncidencia: 1 });

    const solicitudes = repos.rutas._solicitudes;
    expect(solicitudes).toHaveLength(3);
    const mala = solicitudes.find((s) => s.telefonoCrudo === '98765432');
    expect(mala).toMatchObject({ estado: 'incidencia', incidencia: 'numero_corto', requiereHumano: true });
    expect(mala?.phone).toBeNull();

    // Y GSG se entera del numero roto desde el primer minuto.
    expect(repos.rutas._reportes.some((r) => r.tipo === 'incidencia')).toBe(true);
  });

  it('arranca el envio si se le pide', async () => {
    const { cuerpo } = await crearLote({ arrancar: true });
    expect(cuerpo.lote.estado).toBe('enviando');
  });

  it('acepta las filas en JSON: es por donde entrara GSG', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/rutas/lotes',
      headers: auth,
      payload: {
        nombre: 'Desde la API',
        externoId: 'GSG-LOTE-9',
        filas: [{ telefono: '987654321', nombre: 'Ana', referencia: 'P-9' }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().lote).toMatchObject({ origen: 'api', externoId: 'GSG-LOTE-9' });
  });

  it('una tabla sin telefonos se rechaza con el motivo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/rutas/lotes',
      headers: auth,
      payload: { texto: 'nombre;pedido\nAna;P-1' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/teléfono/);
  });
});

describe('la bandeja', () => {
  it('las vistas cuentan lo que dice su nombre', async () => {
    await crearLote();

    const res = await app.inject({ method: 'GET', url: '/admin/rutas/vistas', headers: auth });
    const { cifras, nombres } = res.json();

    expect(cifras).toMatchObject({ todos: 3, pendientes: 2, numero_malo: 1, requieren_persona: 1 });
    expect(nombres.numero_malo).toBe('Número mal escrito');
  });

  it('filtra por vista', async () => {
    await crearLote();

    const res = await app.inject({
      method: 'GET',
      url: '/admin/rutas/solicitudes?vista=numero_malo',
      headers: auth,
    });

    const { items, total } = res.json();
    expect(total).toBe(1);
    expect(items[0].incidencia).toBe('numero_corto');
  });

  it('el detalle trae la bitacora y la explicacion de la incidencia', async () => {
    await crearLote();
    const mala = repos.rutas._solicitudes.find((s) => s.incidencia === 'numero_corto')!;

    const res = await app.inject({
      method: 'GET',
      url: `/admin/rutas/solicitudes/${mala.id}`,
      headers: auth,
    });

    const cuerpo = res.json();
    expect(cuerpo.incidencia).toMatchObject({ titulo: 'Número incompleto' });
    expect(cuerpo.incidencia.queHacer).toMatch(/[Cc]orregir/);
    expect(cuerpo.eventos.length).toBeGreaterThan(0);
  });
});

describe('arreglar a mano', () => {
  it('corregir el telefono devuelve el caso a la cola', async () => {
    await crearLote();
    const mala = repos.rutas._solicitudes.find((s) => s.incidencia === 'numero_corto')!;

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/rutas/solicitudes/${mala.id}`,
      headers: auth,
      payload: { telefono: '987654399' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().solicitud).toMatchObject({
      phone: '51987654399',
      telefonoCrudo: '987654399',
      estado: 'pendiente',
      incidencia: null,
      requiereHumano: false,
      intentos: 0,
    });
  });

  it('un telefono que sigue mal se rechaza explicando por que', async () => {
    await crearLote();
    const mala = repos.rutas._solicitudes.find((s) => s.incidencia === 'numero_corto')!;

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/rutas/solicitudes/${mala.id}`,
      headers: auth,
      payload: { telefono: '12345' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ incidencia: 'numero_corto' });
    // Y la solicitud se queda como estaba.
    expect(repos.rutas._solicitudes.find((s) => s.id === mala.id)?.estado).toBe('incidencia');
  });

  it('la ubicacion conseguida por telefono se carga y se reporta', async () => {
    await crearLote();
    const buena = repos.rutas._solicitudes.find((s) => s.phone === '51987654321')!;

    const res = await app.inject({
      method: 'POST',
      url: `/admin/rutas/solicitudes/${buena.id}/resolver`,
      headers: auth,
      payload: { lat: -12.09, lng: -77.03, nota: 'la dio por telefono' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().solicitud).toMatchObject({ estado: 'resuelto', ubicacionFuente: 'cargada a mano' });
    expect(repos.rutas._reportes.some((r) => r.tipo === 'ubicacion')).toBe(true);
  });

  it('derivar al repartidor lo saca de la cola y avisa a GSG', async () => {
    await crearLote();
    const buena = repos.rutas._solicitudes.find((s) => s.phone === '51987654321')!;

    const res = await app.inject({
      method: 'POST',
      url: `/admin/rutas/solicitudes/${buena.id}/derivar`,
      headers: auth,
      payload: { motivo: 'el cliente pidio que lo llamen', asignadoA: 'Motorizado 2' },
    });

    expect(res.json().solicitud).toMatchObject({
      estado: 'derivado',
      requiereHumano: true,
      asignadoA: 'Motorizado 2',
      proximoIntentoAt: null,
    });
  });

  it('no se puede devolver a la cola algo sin telefono marcable', async () => {
    await crearLote();
    const mala = repos.rutas._solicitudes.find((s) => s.incidencia === 'numero_corto')!;

    const res = await app.inject({
      method: 'POST',
      url: `/admin/rutas/solicitudes/${mala.id}/reintentar`,
      headers: auth,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/corrígelo/);
  });
});

describe('lo que se lleva GSG', () => {
  it('el CSV del lote trae lo que hace falta para trabajarlo', async () => {
    const { cuerpo } = await crearLote();

    const res = await app.inject({
      method: 'GET',
      url: `/admin/rutas/lotes/${cuerpo.lote.id}.csv`,
      headers: auth,
    });

    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const lineas = res.body.trim().split('\r\n');
    expect(lineas[0]).toContain('referencia;telefono;telefono_original');
    expect(lineas).toHaveLength(4);
    expect(res.body).toContain('numero_corto');
  });

  it('la cola se puede mirar y bajar mientras no haya API', async () => {
    await crearLote();

    const estado = await app.inject({ method: 'GET', url: '/admin/rutas/cola', headers: auth });
    expect(estado.json()).toMatchObject({ conectado: false, cifras: { pendiente: 1 } });

    const fichero = await app.inject({ method: 'GET', url: '/admin/rutas/cola.ndjson', headers: auth });
    expect(fichero.headers['content-type']).toMatch(/ndjson/);
    expect(fichero.body).toContain('numero_corto');

    // Y despachar sin API no rompe: dice por que no mando nada.
    const despacho = await app.inject({ method: 'POST', url: '/admin/rutas/cola/despachar', headers: auth });
    expect(despacho.json()).toMatchObject({ enviados: 0 });
    expect(despacho.json().motivo).toMatch(/GSG_URL/);
  });

  it('el resumen general trae las alertas y el estado del motor', async () => {
    await crearLote();

    const res = await app.inject({ method: 'GET', url: '/admin/rutas', headers: auth });
    const cuerpo = res.json();

    expect(cuerpo.alertas.requierenPersona).toBe(1);
    expect(cuerpo.motor).toMatchObject({ pausa: [15, 30], maxIntentos: 3, horario: [9, 19] });
    expect(cuerpo.gsg.conectado).toBe(false);
    expect(cuerpo.catalogo.sin_whatsapp.titulo).toBe('El número no tiene WhatsApp');
  });
});

describe('el token de admin protege el modulo', () => {
  it('sin token no se ve nada', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/rutas' });
    expect(res.statusCode).toBe(401);
  });
});
