import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG, PIN_LIMA, type EscenarioEntregas } from './escenario-entregas.js';
import { crearPuertoHttp, despacharReportes } from '../src/rutas/gsg.js';
import { createFakeRepos } from './fakes.js';

let esc: EscenarioEntregas;
afterEach(async () => esc?.cerrar());
const pedido = (tracking: string, telefono = '987100001') => ({ ...OBLIGATORIOS_GSG, tracking, cliente: 'Cliente', telefono });

describe('contrato del diagrama GSG', () => {
  it('recibe 600 pedidos, devuelve IDs guardados y los muestra en la web sin duplicarlos', async () => {
    esc = await crearEscenarioEntregas({ confirmarLista: false });
    const pedidos = Array.from({ length: 600 }, (_, i) => pedido('LOTE-' + i, String(987100000 + i)));
    const alta = await esc.api.post<any>('/api/v1/entregas', { pedidos });
    expect(alta.status).toBe(201);
    expect(alta.body.creadas).toHaveLength(600);
    expect(alta.body.creadas.every((p: any) => Number.isInteger(p.id) && p.id > 0)).toBe(true);
    const hoy = await esc.api.get<any>('/admin/entregas');
    expect(hoy.body.entregas).toHaveLength(600);
    expect(hoy.body.entregas.every((p: any) => !p.envioRetenidoAt && p.confirmacionEstado === 'no_hace_falta')).toBe(true);
    const repetida = await esc.api.post<any>('/api/v1/entregas', { pedidos });
    expect(repetida.status).toBe(200);
    expect((await esc.api.get<any>('/admin/entregas')).body.entregas).toHaveLength(600);
  }, 60_000);

  it('pide ubicación tres veces por cliente y luego aparece pendiente de atención', async () => {
    esc = await crearEscenarioEntregas({ confirmarLista: false, arranque: new Date('2026-10-04T13:00:00Z') });
    expect((await esc.api.post('/api/v1/entregas', { pedidos: [pedido('SIN-RESPUESTA'), pedido('MISMO-CLIENTE')] })).status).toBe(201);
    for (let i = 0; i < 4; i++) { await esc.trabajar(); esc.avanzar(181); }
    await esc.trabajar();
    expect(esc.mensajesA('987100001')).toHaveLength(3);
    expect(await esc.entrega('SIN-RESPUESTA')).toMatchObject({ requiereHumano: true, incidencia: 'sin_respuesta' });
    esc.avanzar(90);
    await esc.trabajar();
    expect(esc.mensajesA('987100001')).toHaveLength(3);
  });

  it('manda tracking y coordenadas al endpoint HTTP sendLocation y conserva fallos para reintentar', async () => {
    const llegadas: any[] = [];
    let status = 503;
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => { llegadas.push({ url: req.url, auth: req.headers.authorization, apiKey: req.headers['x-api-key'], body: JSON.parse(body) }); res.writeHead(status); res.end('{}'); });
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    try {
      const puerto = crearPuertoHttp({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, token: 'clave-backend' });
      const payload = { tracking: 'TRACK-001', referencia: 'REF-DISTINTA', lat: PIN_LIMA.lat, lng: PIN_LIMA.lng };
      const repos = createFakeRepos();
      await repos.rutas.encolarReporte({ tipo: 'ubicacion', payload });
      expect(await despacharReportes(repos, puerto)).toMatchObject({ intentados: 1, enviados: 0 });
      expect(await repos.rutas.cifrasReportes()).toMatchObject({ pendiente: 1, enviado: 0 });
      status = 201;
      expect(await despacharReportes(repos, puerto)).toMatchObject({ intentados: 1, enviados: 1 });
      expect(await repos.rutas.cifrasReportes()).toMatchObject({ pendiente: 0, enviado: 1 });
      expect(llegadas).toHaveLength(2);
      // La clave sale SOLO en X-API-Key: sin Authorization.
      expect(llegadas[1]).toEqual({ url: '/sendLocation', auth: undefined, apiKey: 'clave-backend', body: { tracking: 'TRACK-001', lat: PIN_LIMA.lat, lng: PIN_LIMA.lng } });
    } finally { await new Promise<void>(r => server.close(() => r())); }
  });

  it('si la dirección guardada ya es la de sendLocation no la duplica, y cada fallo dice su número y su causa', async () => {
    const llegadas: Array<{ url?: string; apiKey?: string | string[]; body: unknown }> = [];
    let status = 404;
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => { llegadas.push({ url: req.url, apiKey: req.headers['x-api-key'], body: body ? JSON.parse(body) : null }); res.writeHead(status); res.end(status === 404 ? 'Not Found' : '{}'); });
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
      const puerto = crearPuertoHttp({ url: `${base}/sendLocation`, token: 'k-1' });
      expect(puerto.urlUbicacion?.()).toBe(`${base}/sendLocation`);
      const fallo = await puerto.enviar('ubicacion', { tracking: 'GSG-E-240255', lat: -12.0453, lng: -77.0311 });
      expect(fallo).toMatchObject({ ok: false, reintentable: false });
      expect(!fallo.ok && fallo.error).toMatch(/^Error 404: GSG no tiene esa ruta/);
      status = 201;
      expect((await puerto.enviar('ubicacion', { tracking: 'GSG-E-240255', lat: -12.0453, lng: -77.0311 })).ok).toBe(true);
      expect(llegadas.at(-1)).toEqual({ url: '/api/sendLocation', apiKey: 'k-1', body: { tracking: 'GSG-E-240255', lat: -12.0453, lng: -77.0311 } });
      await puerto.consultar('/reparto/pendientes');
      expect(llegadas.at(-1)!.url).toBe('/api/reparto/pendientes');
      status = 401;
      const rechazo = await puerto.enviar('ubicacion', { tracking: 'X', lat: 1, lng: 2 });
      expect(!rechazo.ok && rechazo.error).toMatch(/^Error 401: GSG rechazó la clave/);
    } finally { await new Promise<void>(r => server.close(() => r())); }
    const sinRed = await crearPuertoHttp({ url: 'http://127.0.0.1:9/api', token: 'k' }).enviar('ubicacion', { tracking: 'X', lat: 1, lng: 2 });
    expect(sinRed).toMatchObject({ ok: false, reintentable: true });
    expect(!sinRed.ok && sinRed.error).toMatch(/No se pudo conectar con GSG en http:\/\/127\.0\.0\.1:9\/api\/sendLocation/);
  });

  it('con la URL exacta de ubicación guardada en la conexión, el POST va justo ahí, sin /sendLocation', async () => {
    const llegadas: any[] = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.method === 'GET') { res.writeHead(404); res.end('{}'); return; }
        llegadas.push({ url: req.url, apiKey: req.headers['x-api-key'], body: JSON.parse(body) }); res.writeHead(req.url === '/api/v1/gsgchat/location' ? 201 : 404); res.end('{}');
      });
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      esc = await crearEscenarioEntregas({ confirmarLista: false });
      const estado = await esc.conexionGsg.conectarReal({ url: `${base}/api/v1/gsgchat`, token: 'clave-gsg', urlUbicacion: `${base}/api/v1/gsgchat/location` });
      expect(estado.destinoUbicacion).toBe(`${base}/api/v1/gsgchat/location`);
      expect((await esc.conexionGsg.probar()).ok).toBe(true);
      expect((await esc.api.post('/api/v1/entregas', { ...pedido('GSG-E-240258'), referencia: 'URL-EXACTA' })).status).toBe(201);
      await esc.trabajar();
      expect((await esc.contesta('987100001', { pin: PIN_LIMA })).status).toBe(200);
      for (let i = 0; i < 50 && !llegadas.length; i++) await new Promise(r => setTimeout(r, 20));
      expect(llegadas).toEqual([{ url: '/api/v1/gsgchat/location', apiKey: 'clave-gsg', body: { tracking: 'GSG-E-240258', lat: PIN_LIMA.lat, lng: PIN_LIMA.lng } }]);
    } finally { await new Promise<void>(r => server.close(() => r())); }
  });

  it('si el envío automático falla se ve el error, y «Enviar a GSG» del pedido lo manda con {tracking, lat, lng}', async () => {
    const llegadas: any[] = [];
    let status = 404;
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.method === 'GET') { res.end(JSON.stringify({ faltaUbicacion: [], faltaConfirmacion: [], terminados: [] })); return; }
        llegadas.push({ url: req.url, apiKey: req.headers['x-api-key'], body: JSON.parse(body) }); res.writeHead(status); res.end(status === 404 ? 'Not Found' : '{}');
      });
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    try {
      esc = await crearEscenarioEntregas({ confirmarLista: false });
      await esc.conexionGsg.conectarReal({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, token: 'clave-gsg' });
      expect((await esc.api.post('/api/v1/entregas', { ...pedido('GSG-E-240255'), referencia: 'BOTON-GSG' })).status).toBe(201);
      await esc.trabajar();
      expect((await esc.contesta('987100001', { pin: PIN_LIMA })).status).toBe(200);
      for (let i = 0; i < 50 && !llegadas.length; i++) await new Promise(r => setTimeout(r, 20));
      expect(llegadas).toHaveLength(1);
      // El automático falló: el error queda a la vista.
      let envios = (await esc.api.get<any>('/admin/gsg/envios')).body;
      for (let i = 0; i < 50 && envios.items[0]?.estado !== 'fallido'; i++) { await new Promise(r => setTimeout(r, 20)); envios = (await esc.api.get<any>('/admin/gsg/envios')).body; }
      expect(envios.items[0]).toMatchObject({ estado: 'fallido', cuerpo: { tracking: 'GSG-E-240255', lat: PIN_LIMA.lat, lng: PIN_LIMA.lng } });
      expect(envios.items[0].error).toMatch(/^Error 404/);
      const id = (await esc.entrega('BOTON-GSG'))!.id;
      const malo = await esc.api.post<any>(`/admin/entregas/${id}/enviar-gsg`, {});
      expect(malo.body).toMatchObject({ ok: false, estado: 'fallido' });
      expect(malo.body.error).toMatch(/^Error 404/);
      status = 201;
      const bueno = await esc.api.post<any>(`/admin/entregas/${id}/enviar-gsg`, {});
      expect(bueno.body).toMatchObject({ ok: true, estado: 'enviado', error: null });
      expect(llegadas.at(-1)).toEqual({ url: '/sendLocation', apiKey: 'clave-gsg', body: { tracking: 'GSG-E-240255', lat: PIN_LIMA.lat, lng: PIN_LIMA.lng } });
    } finally { await new Promise<void>(r => server.close(() => r())); }
  });

  it('completa pedido → WhatsApp → pin → web → backend GSG', async () => {
    const llegadas: any[] = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.method === 'GET') { res.end(JSON.stringify({ faltaUbicacion: [], faltaConfirmacion: [], terminados: [] })); return; }
        llegadas.push({ url: req.url, body: JSON.parse(body) }); res.writeHead(201); res.end('{}');
      });
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    try {
      esc = await crearEscenarioEntregas({ confirmarLista: false });
      await esc.conexionGsg.conectarReal({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, token: 'clave-gsg' });
      expect((await esc.api.post('/api/v1/entregas', { ...pedido('TRACK-PIN-REAL'), referencia: 'PIN-REAL' })).status).toBe(201);
      await esc.trabajar();
      expect(esc.mensajesA('987100001')).toHaveLength(1);
      expect((await esc.contesta('987100001', { pin: PIN_LIMA })).status).toBe(200);
      for (let i = 0; i < 50 && !llegadas.length; i++) await new Promise(r => setTimeout(r, 20));
      expect(llegadas).toContainEqual({ url: '/sendLocation', body: { tracking: 'TRACK-PIN-REAL', lat: PIN_LIMA.lat, lng: PIN_LIMA.lng } });
      expect(await esc.entrega('PIN-REAL')).toMatchObject({ ubicacionEstado: 'recibida', lat: PIN_LIMA.lat, lng: PIN_LIMA.lng });
      const antes = esc.mensajesA('987100001').length;
      esc.avanzar(90); await esc.trabajar();
      expect(esc.mensajesA('987100001')).toHaveLength(antes);
    } finally { await new Promise<void>(r => server.close(() => r())); }
  });
});
