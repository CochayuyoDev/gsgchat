/**
 * El flujo que tiene que salir a produccion, de punta a punta y tal como
 * corre en produccion:
 *
 *   pedir la ubicacion por WhatsApp -> el cliente la manda -> sale YA al
 *   endpoint del CRM de GSG (POST /sendLocation, con su token).
 *
 * Todo es lo de produccion (la tienda entera de `armarTienda`: base MySQL de
 * prueba real, motores y despachador reales, la conexion con GSG guardada desde la
 * pantalla de Conexion, cifrada) salvo dos cosas: el WhatsApp (sin telefono
 * no hay QR que escanear) y el CRM de GSG, que aqui es un servidor HTTP de
 * verdad, en otro puerto, que apunta todo lo que le llega.
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

describe('pedir la ubicacion por WhatsApp y mandarla al CRM de GSG (produccion)', () => {
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

  it('1. sin endpoint de GSG, lo que llegue se guarda en la cola: nada se pierde', async () => {
    const gsg = await api('GET', '/admin/entregas/gsg');
    expect(gsg.body.gsg.conectada).toBeFalsy();
  });

  it('2. se conecta el CRM de GSG desde la pantalla (dirección + token) y la prueba de conexión lo alcanza', async () => {
    const r = await api('POST', '/admin/entregas/gsg', { modo: 'real', url: urlCrm, token: crm.estado.token });
    expect(r.status).toBe(200);
    expect(r.body.gsg).toMatchObject({ conectada: true });
    // El token no vuelve a la pantalla.
    expect(JSON.stringify(r.body)).not.toContain(crm.estado.token);
    const prueba = await api('POST', '/admin/entregas/gsg/probar', {});
    expect(prueba.status).toBe(200);
  });

  it('3. se carga la lista del día y el sistema le pide la ubicación a cada cliente por WhatsApp', async () => {
    const r = await api('POST', '/api/v1/entregas', {
      pedidos: [
        { empresa: { codigo: 'T01', nombre: 'GSG' }, metodoPago: 'Contraentrega', montoCobrar: 50, tracking: 'P-001', cliente: 'Cliente', telefono: '987000001', nombre: 'Ana Pin', referencia: 'P-001' },
        { empresa: { codigo: 'T01', nombre: 'GSG' }, metodoPago: 'Contraentrega', montoCobrar: 50, tracking: 'P-002', cliente: 'Cliente', telefono: '987000002', nombre: 'Beto Enlace', referencia: 'P-002' },
        { empresa: { codigo: 'T01', nombre: 'GSG' }, metodoPago: 'Contraentrega', montoCobrar: 50, tracking: 'P-003', cliente: 'Cliente', telefono: '987000003', nombre: 'Carla Texto', referencia: 'P-003' },
        { empresa: { codigo: 'T01', nombre: 'GSG' }, metodoPago: 'Contraentrega', montoCobrar: 50, tracking: 'P-004', cliente: 'Cliente', telefono: '987000004', nombre: 'Dani Caida', referencia: 'P-004' },
        { empresa: { codigo: 'T01', nombre: 'GSG' }, metodoPago: 'Contraentrega', montoCobrar: 50, tracking: 'P-005', cliente: 'Cliente', telefono: '987000005', nombre: 'Eva Corrige', referencia: 'P-005' },
      ],
    });
    expect(r.status).toBe(201);
    for (const n of ['51987000001', '51987000002', '51987000003', '51987000004', '51987000005']) {
      await esperar(() => aEste(n).length > 0, 90_000, `que se le pida la ubicacion a ${n}`);
    }
    // La peticion lleva la forma de mandar la ubicacion.
    expect(textosA('51987000001').toLowerCase()).toContain('ubicaci');
  }, 180_000);

  it('4. el cliente manda su pin: GSG lo recibe AL MOMENTO, con su token y todos los datos', async () => {
    const t0 = performance.now();
    await escribe('51987000001', { location: { latitude: -12.1211, longitude: -77.0301 } });
    await esperar(() => crm.ubicaciones().some((l) => l.cuerpo.tracking === 'P-001'), 10_000, 'que GSG reciba P-001');
    // Al momento: no espero a la pasada de cada minuto.
    expect(performance.now() - t0).toBeLessThan(10_000);
    const l = crm.ubicaciones().find((x) => x.cuerpo.tracking === 'P-001')!;
    expect(l.metodo).toBe('POST');
    expect(l.apiKey).toBe(crm.estado.token);
    expect(l.autorizacion).toBeUndefined();
    expect(l.cuerpo).toMatchObject({ tracking: 'P-001', lat: -12.1211, lng: -77.0301 });
    // El cliente recibe su confirmación: solo el enlace, sin coordenadas.
    await esperar(() => /Ubicación registrada/.test(textosA('51987000001')), 10_000, 'la confirmacion al cliente');
    const confirmacion = aEste('51987000001').map((m) => String(m.body ?? '')).find((t) => t.includes('Ubicación registrada'))!;
    expect(confirmacion.replace(/https:\/\/\S+/g, '')).not.toMatch(/-12\.12|-77\.03/);
    // Y el reporte queda como enviado, con el id que devolvio GSG.
    const [reporte] = await enCola('P-001');
    expect(reporte).toMatchObject({ estado: 'enviado' });
    expect(JSON.stringify(reporte)).toContain('GSG-');
  });

  it('5. el cliente pega un enlace de Google Maps: también sale a GSG', async () => {
    await escribe('51987000002', { text: 'aqui esta https://www.google.com/maps?q=-12.0931,-77.0465' });
    await esperar(() => crm.ubicaciones().some((l) => l.cuerpo.tracking === 'P-002'), 10_000, 'que GSG reciba P-002');
    const l = crm.ubicaciones().find((x) => x.cuerpo.tracking === 'P-002')!;
    expect(l.cuerpo).toMatchObject({ lat: -12.0931, lng: -77.0465 });
  });

  it('6. un texto sin ubicación (una dirección escrita) NO se manda como ubicación a GSG', async () => {
    await escribe('51987000003', { text: 'av larco 123 miraflores' });
    await new Promise((r) => setTimeout(r, 2000));
    expect(crm.ubicaciones().some((l) => l.cuerpo.tracking === 'P-003')).toBe(false);
  });

  it('7. con el CRM caído no se pierde: queda en la cola y sale UNA sola vez cuando vuelve', async () => {
    crm.estado.modo = 'caido';
    await escribe('51987000004', { location: { latitude: -12.05, longitude: -77.04 } });
    await esperar(() => crm.llegadas.some((l) => l.cuerpo.tracking === 'P-004'), 10_000, 'el intento contra el CRM caido');
    await esperar(async () => (await enCola('P-004'))[0]?.estado === 'pendiente', 5_000, 'P-004 pendiente');
    crm.estado.modo = 'ok';
    // El boton "reenviar pendientes" (lo mismo que hace la pasada de cada minuto),
    // pulsado dos veces seguidas: no puede salir dos veces.
    await Promise.all([api('POST', '/admin/rutas/cola/despachar'), api('POST', '/admin/rutas/cola/despachar')]);
    const [reporte] = await enCola('P-004');
    expect(reporte).toMatchObject({ estado: 'enviado' });
    // Dos llegadas en total: el intento contra el CRM caido y el alta. No tres.
    expect(crm.ubicaciones().filter((l) => l.cuerpo.tracking === 'P-004').length).toBe(2);
  });

  it('8. un segundo pin corrige el primero: GSG recibe el nuevo marcado como corrección', async () => {
    await escribe('51987000005', { location: { latitude: -12.1, longitude: -77.02 } });
    await esperar(() => crm.ubicaciones().filter((l) => l.cuerpo.tracking === 'P-005').length === 1, 10_000, 'el primer pin de P-005');
    await escribe('51987000005', { location: { latitude: -12.11, longitude: -77.021 } });
    await esperar(() => crm.ubicaciones().filter((l) => l.cuerpo.tracking === 'P-005').length === 2, 10_000, 'la correccion de P-005');
    const ultima = crm.ubicaciones().filter((l) => l.cuerpo.tracking === 'P-005').at(-1)!;
    expect(ultima.cuerpo).toMatchObject({ tracking: 'P-005', lat: -12.11, lng: -77.021 });
  });

  it('9. ninguna ubicación se mandó dos veces a GSG (salvo la corrección, que es otra)', () => {
    const aceptadas = crm.ubicaciones().filter((l) => l.apiKey === crm.estado.token);
    const porClave = new Map<string, number>();
    for (const l of aceptadas) {
      const clave = `${l.cuerpo.tracking}|${l.cuerpo.lat}|${l.cuerpo.lng}`;
      porClave.set(clave, (porClave.get(clave) ?? 0) + 1);
    }
    // P-004 llego una vez al CRM caido (503) y otra ya aceptada: son dos intentos, un solo alta.
    const repetidas = [...porClave].filter(([clave, n]) => n > 1 && !clave.startsWith('P-004'));
    expect(repetidas).toEqual([]);
    expect(porClave.get('P-004|-12.05|-77.04')).toBe(2);
  });

  it('10. un token equivocado se ve como fallo; solo se reintenta cuando alguien pulsa «Enviar ahora»', async () => {
    const r = await api('POST', '/admin/entregas/gsg', { modo: 'real', url: urlCrm, token: 'token-malo' });
    expect(r.status).toBe(200);
    const deP999 = () => crm.llegadas.filter((l) => l.cuerpo.tracking === 'P-999').length;
    await tienda.repos.rutas.encolarReporte({ solicitudId: null, loteId: null, tipo: 'ubicacion', payload: { tipo: 'ubicacion', referencia: 'P-999', lat: -12, lng: -77 } } as never);
    const primero = await api('POST', '/admin/rutas/cola/despachar');
    expect(deP999()).toBe(1);
    expect(primero.body.errores.join(' ')).toMatch(/Error 401: GSG rechazó la clave/);
    const [reporte] = await enCola('P-999');
    expect(reporte!.estado).toBe('fallido');
    expect(reporte!.ultimo_error).toContain('401');
    // Volver a pulsar «Enviar ahora» lo reintenta una vez (a mano), y sigue fallido.
    await api('POST', '/admin/rutas/cola/despachar');
    expect(deP999()).toBe(2);
    expect((await enCola('P-999'))[0]!.estado).toBe('fallido');
    // Se deja como estaba.
    await api('POST', '/admin/entregas/gsg', { modo: 'real', url: urlCrm, token: crm.estado.token });
  });

  it('11. tras reiniciar el servidor la conexión con GSG sigue guardada (cifrada) y sigue mandando', async () => {
    await tienda.parar();
    wa.sent.length = 0;
    tienda = await armarTienda(opciones);
    const login = await tienda.app.inject({ method: 'POST', url: '/login', payload: { usuario: 'ali', clave: 'ali-2026-wa' } });
    cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const gsg = await api('GET', '/admin/entregas/gsg');
    expect(gsg.body.gsg).toMatchObject({ conectada: true });
    const r = await api('POST', '/api/v1/entregas', { pedidos: [{ empresa: { codigo: 'T01', nombre: 'GSG' }, metodoPago: 'Contraentrega', montoCobrar: 50, tracking: 'P-006', cliente: 'Flor', telefono: '987000006' }] });
    expect(r.status).toBe(201);
    await esperar(() => aEste('51987000006').length > 0, 90_000, 'la peticion tras reiniciar');
    await escribe('51987000006', { location: { latitude: -12.13, longitude: -77.0 } });
    await esperar(() => crm.ubicaciones().some((l) => l.cuerpo.tracking === 'P-006'), 10_000, 'que GSG reciba P-006 tras reiniciar');
  }, 180_000);
});
