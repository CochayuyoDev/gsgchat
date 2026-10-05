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
      req.on('end', () => { llegadas.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) }); res.writeHead(status); res.end('{}'); });
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
      expect(llegadas[1]).toEqual({ url: '/sendLocation', auth: 'Bearer clave-backend', body: { tracking: 'TRACK-001', latitud: PIN_LIMA.lat, longitud: PIN_LIMA.lng } });
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
      expect(llegadas).toContainEqual({ url: '/sendLocation', body: { tracking: 'TRACK-PIN-REAL', latitud: PIN_LIMA.lat, longitud: PIN_LIMA.lng } });
      expect(await esc.entrega('PIN-REAL')).toMatchObject({ ubicacionEstado: 'recibida', lat: PIN_LIMA.lat, lng: PIN_LIMA.lng });
      const antes = esc.mensajesA('987100001').length;
      esc.avanzar(90); await esc.trabajar();
      expect(esc.mensajesA('987100001')).toHaveLength(antes);
    } finally { await new Promise<void>(r => server.close(() => r())); }
  });
});
