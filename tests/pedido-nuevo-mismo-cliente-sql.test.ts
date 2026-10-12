/**
 * El mismo cliente vuelve a pedir otro dia, contra la base MySQL real y la
 * tienda armada como en produccion (ver gsg-produccion.test.ts). Para que sea
 * «ayer» se corren un dia hacia atras todas las fechas guardadas en la base.
 *
 *  - lunes PED-100: se le pide la ubicacion y la manda;
 *  - martes PED-205, mismo telefono: pedido nuevo, se le vuelve a escribir;
 *  - PED-205 reenviado por error: el mismo pedido, ningun mensaje mas.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { armarTienda, type OpcionesTienda, type TiendaViva } from '../src/plataforma/tienda.js';
import { bootstrapSecrets } from '../src/settings/crypto.js';
import { createFakeWhatsApp, type FakeWhatsApp } from './fakes.js';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';

// ------------------------------------------------------ el CRM de GSG, falso

interface Llegada {
  metodo: string;
  ruta: string;
  autorizacion: string | undefined;
  apiKey: string | undefined;
  cuerpo: Record<string, unknown>;
}

function crmDeGsg() {
  const llegadas: Llegada[] = [];
  const estado = { modo: 'ok' as 'ok' | 'caido' | 'rechaza' | 'lento', token: 'tok-gsg-secreto', n: 0 };
  const server = http.createServer((req, res) => {
    let datos = '';
    req.on('data', (c) => (datos += c));
    req.on('end', () => {
      const ruta = (req.url ?? '/').split('?')[0]!.replace(/^\/api/, '');
      // Lo que el sistema consulta solo (pendientes del dia): lista vacia.
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ faltaUbicacion: [], faltaConfirmacion: [], terminados: [] }));
        return;
      }
      let cuerpo: Record<string, unknown> = {};
      try {
        cuerpo = datos ? (JSON.parse(datos) as Record<string, unknown>) : {};
      } catch {
        cuerpo = { crudo: datos };
      }
      llegadas.push({ metodo: req.method ?? '', ruta, autorizacion: req.headers.authorization, apiKey: req.headers['x-api-key'] as string | undefined, cuerpo });
      // Como la API real de GSG: la clave solo en X-API-Key.
      if (req.headers['x-api-key'] !== estado.token) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'token invalido' }));
        return;
      }
      if (estado.modo === 'caido') {
        res.writeHead(503, { 'content-type': 'text/html' });
        res.end('<html>503</html>');
        return;
      }
      if (estado.modo === 'rechaza') {
        res.writeHead(422, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'lat fuera de rango' }));
        return;
      }
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: `GSG-${++estado.n}` }));
    });
  });
  return { server, llegadas, estado, ubicaciones: () => llegadas.filter((l) => l.ruta === '/sendLocation') };
}

const esperar = async (cond: () => boolean | Promise<boolean>, ms = 60_000, que = 'la condicion'): Promise<void> => {
  const hasta = performance.now() + ms;
  while (performance.now() < hasta) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no se cumplio a tiempo: ${que}`);
};

// ---------------------------------------------------------------- la prueba

describe('el mismo cliente vuelve a pedir otro dia (MySQL real)', () => {
  let raiz: string;
  let b: BaseDePrueba;
  let crm: ReturnType<typeof crmDeGsg>;
  let urlCrm: string;
  let tienda: TiendaViva;
  let wa: FakeWhatsApp;
  let cookie: string;
  let claveGsg: string;
  let opciones: OpcionesTienda;

  const api = async (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) => {
    const r = await tienda.app.inject({ method, url, headers: { cookie, ...(url.startsWith('/api/v1/entregas') ? { 'x-api-key': claveGsg } : {}), ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) }, payload: payload === undefined ? undefined : JSON.stringify(payload) });
    return { status: r.statusCode, body: r.body ? (JSON.parse(r.body) as Record<string, any>) : {} };
  };
  const escribe = async (phone: string, datos: { text?: string; location?: { latitude: number; longitude: number } }) => {
    const r = await api('POST', '/admin/dev/inbound', { phone, name: `Cliente ${phone.slice(-3)}`, ...datos });
    if (r.status !== 200) throw new Error(`el simulador de entrantes respondio ${r.status}: ${JSON.stringify(r.body)}`);
    return r;
  };
  /** La cola hacia GSG tal como esta en la base de la tienda. */
  const cola = async () =>
    (await tienda.pool.query<{ estado: string; payload: Record<string, unknown>; ultimo_error: string | null; externo_id: string | null }>('select * from rutas_reportes order by id')).rows;
  const enCola = async (referencia: string) => (await cola()).filter((r) => r.payload?.referencia === referencia);
  const aEste = (phone: string) => wa.sent.filter((m) => m.to === phone);
  const textosA = (phone: string) => aEste(phone).map((m) => String(m.body ?? m.texto ?? '')).join('\n---\n');

  beforeAll(async () => {
    crm = crmDeGsg();
    await new Promise<void>((r) => crm.server.listen(0, '127.0.0.1', () => r()));
    urlCrm = `http://127.0.0.1:${(crm.server.address() as AddressInfo).port}/api`;

    b = await baseDePrueba();
    raiz = mkdtempSync(path.join(tmpdir(), 'gsg-produccion-'));
    const secretos = bootstrapSecrets(raiz);
    wa = createFakeWhatsApp();
    opciones = {
      id: 'gsg',
      slug: 'gsg',
      env: {
        PUBLIC_BASE_URL: 'https://chat.gsg.pe',
        DATABASE_URL: b.url,
        TRACKING_SECRET: secretos.trackingSecret,
        WHATSAPP_PROVIDER: 'local',
        BUSINESS_NAME: 'GSG',
        DEV_SIMULATE_INBOUND: 'true',
        RAFAGA_MS: '0',
        GEO_BBOX: 'lima',
        TIMEZONE: 'America/Lima',
        // Todo el dia y con pausas cortas: la prueba no puede depender de la hora.
        RUTAS_HORA_INICIO: '0',
        RUTAS_HORA_FIN: '24',
        HORARIO_ENVIO_INICIO: '0',
        HORARIO_ENVIO_FIN: '24',
        HORARIO_ENVIO_DIAS: '0,1,2,3,4,5,6',
        RUTAS_PAUSA_MIN_SEG: '1',
        RUTAS_PAUSA_MAX_SEG: '1',
        RITMO_PAUSA_MIN_SEG: '1',
        RITMO_PAUSA_MAX_SEG: '1',
      } as NodeJS.ProcessEnv,
      secretos,
      base: { url: b.url },
      authDir: path.join(raiz, 'auth'),
      mediaDir: path.join(raiz, 'medios'),
      carpetaCopias: path.join(raiz, 'copias'),
      primeraCuentaRol: 'superadmin',
      autoConectarLocal: false,
      sembrarPlantillasLocales: true,
      prefijoLog: '[prueba] ',
      waParaPruebas: wa,
    };
    tienda = await armarTienda(opciones);
    const alta = await tienda.app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { nombre: 'Ali', usuario: 'ali', clave: 'ali-2026-wa' } });
    cookie = String(alta.headers['set-cookie']).split(';')[0]!;
    const clave = await api('POST', '/admin/claves-api', { nombre: 'GSG de pruebas', permisos: ['entregas:gestionar', 'entregas:leer'] });
    expect(clave.status).toBe(200);
    claveGsg = clave.body.clave;
    // Horario del reparto abierto todo el dia (lo que se guarda desde la pantalla).
    const aj = await api('POST', '/admin/rutas/ajustes', { horaInicio: 0, horaFin: 24, pausaMinSegundos: 1, pausaMaxSegundos: 1 });
    expect(aj.status).toBe(200);
  }, 3_600_000);

  afterAll(async () => {
    await tienda?.parar();
    await b?.cerrar();
    await new Promise<void>((r) => crm?.server.close(() => r()));
    if (raiz) rmSync(raiz, { recursive: true, force: true });
  });


  /** Todo lo guardado pasa a ser de ayer: fechas, horas y el `dia` de cada pedido. */
  const pasarUnDia = async () => {
    const base = (await tienda.pool.query<{ base: string }>('select database() as base')).rows[0]!.base;
    const columnas = (await tienda.pool.query<{ tabla: string; columna: string }>(
      `select table_name as tabla, column_name as columna from information_schema.columns where table_schema = '${base}' and data_type in ('date', 'datetime', 'timestamp')`,
    )).rows;
    for (const { tabla, columna } of columnas) {
      await tienda.pool.query(`update \`${tabla}\` set \`${columna}\` = \`${columna}\` - interval 1 day where \`${columna}\` is not null`);
    }
  };

  const pedido = (tracking: string, telefono: string) => ({ empresa: { codigo: 'T01', nombre: 'GSG' }, metodoPago: 'Contraentrega', montoCobrar: 50, tracking, referencia: tracking, cliente: 'Cliente Recurrente', telefono });
  const TEL = '987000091';
  const WA = '51' + TEL;

  it('lunes PED-100: se le pide la ubicacion y la manda', async () => {
    const r = await api('POST', '/api/v1/entregas', pedido('PED-100', TEL));
    expect(r.status).toBe(201);
    await esperar(() => aEste(WA).length > 0, 90_000, 'el primer mensaje del lunes');
    await escribe(WA, { location: { latitude: -12.1211, longitude: -77.0301 } });
    await esperar(() => /Ubicación registrada/.test(textosA(WA)), 20_000, 'la confirmacion del lunes');
  }, 180_000);

  it('martes PED-205, mismo telefono: pedido nuevo y se le vuelve a escribir', async () => {
    await pasarUnDia();
    const antes = aEste(WA).length;
    const r = await api('POST', '/api/v1/entregas', pedido('PED-205', TEL));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    await esperar(() => aEste(WA).length > antes, 90_000, 'el primer mensaje del martes');
    expect(aEste(WA).slice(antes).map((m) => String(m.body ?? m.texto ?? '')).join(' ').toLowerCase()).toContain('ubicaci');
  }, 180_000);

  it('PED-205 reenviado por error: el mismo pedido, ningun mensaje mas', async () => {
    const antes = aEste(WA).length;
    const r = await api('POST', '/api/v1/entregas', pedido('PED-205', TEL));
    expect(r.status).toBeLessThan(300);
    expect(r.body.repetidas).toContain('PED-205');
    await new Promise((res) => setTimeout(res, 5_000));
    expect(aEste(WA).length).toBe(antes);
  }, 60_000);

  it('martes PED-100 otra vez (reprogramado): pedido del dia, va con PED-205 y Pedidos GSG lo marca con lo del lunes', async () => {
    const r = await api('POST', '/api/v1/entregas', pedido('PED-100', TEL));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    // Hoy ya tiene PED-205 esperando la ubicacion: un solo mensaje para los dos.
    expect(JSON.stringify(r.body.whatsapp)).toContain('PED-205');
    const hoy = await api('GET', '/admin/entregas');
    const fila = (hoy.body.entregas as any[]).find((x) => x.referencia === 'PED-100');
    expect(fila.ubicacionEstado).toBe('pendiente');
    expect(fila.reprogramado).toMatchObject({ lat: -12.1211, lng: -77.0301 });
    expect(fila.reprogramado.dia < fila.dia).toBe(true);
    expect((hoy.body.entregas as any[]).find((x) => x.referencia === 'PED-205').reprogramado).toBeNull();
  }, 180_000);
});
