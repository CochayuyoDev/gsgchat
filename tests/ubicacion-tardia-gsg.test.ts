import { ajustesPorDefecto } from '../src/rutas/ajustes.js';
import { OPCIONES_POR_DEFECTO } from '../src/rutas/motor.js';
import { describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG, PIN_LIMA } from './escenario-entregas.js';
import { crearPuertoHttp, despacharReportes } from '../src/rutas/gsg.js';
import { createFakeRepos } from './fakes.js';
import { estadoDelReporteAGsg } from '../src/entregas/reportados.js';

const pedido = (tracking: string) => ({ ...OBLIGATORIOS_GSG, tracking, cliente: 'Cliente de prueba', telefono: '987601234' });

describe('ubicación tardía después del máximo de intentos', () => {
  it('resuelve ambos trackings y no reenvía incidencias antiguas después del pin', async () => {
    const llegadas: Array<{ url: string; body: any }> = [];
    let aceptaProblemas = false;
    const fetchGsg = (async (url: any, init: any) => {
      llegadas.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return new Response('{}', { status: String(url).includes('reported') && !aceptaProblemas ? 503 : 200 });
    }) as typeof fetch;
    const e = await crearEscenarioEntregas({ arranque: new Date('2026-10-14T15:17:00Z'), fetchGsg });
    try {
      await e.repos.rutas.ajustes.set({ esperaRespuestaMinutos: 1, maxIntentos: 3, esperaFinalMinutos: 0 }, ajustesPorDefecto(OPCIONES_POR_DEFECTO));
      await e.api.post('/api/v1/entregas', [pedido('TARDIO-1'), pedido('TARDIO-2')]);
      for (let i = 0; i < 4; i++) { await e.trabajar(); e.avanzar(1); }
      const s = (await e.repos.rutas.listarSolicitudes({ q: '51987601234', limit: 10, offset: 0 }))[0]!;
      expect(s).toMatchObject({ estado: 'derivado', intentos: 3, requiereHumano: true });
      expect((await e.repos.rutas.reportesRecientes(100, 'incidencia')).filter(r => r.payload.codigo === 'sin_respuesta')).toHaveLength(2);
      e.avanzar(3);
      await e.contesta('987601234', { pin: PIN_LIMA });
      expect(await e.repos.rutas.solicitud(s.id)).toMatchObject({ estado: 'resuelto', intentos: 3, incidencia: null, requiereHumano: false, proximoIntentoAt: null });
      for (const tracking of ['TARDIO-1', 'TARDIO-2']) {
        expect(await e.entrega(tracking)).toMatchObject({ ubicacionEstado: 'recibida', incidencia: null, requiereHumano: false });
      }
      const desde = llegadas.length;
      aceptaProblemas = true;
      await e.despacharAGsg();
      expect(llegadas.slice(desde).filter(r => r.url.includes('reported') && r.body.codigo === 'sin_respuesta')).toHaveLength(0);
      expect((await e.repos.rutas.reportesRecientes(100, 'incidencia')).filter(r => r.payload.codigo === 'sin_respuesta').map(r => r.estado)).toEqual(['superado', 'superado']);
      const ubicaciones = llegadas.filter(r => r.url.includes('send-location')).map(r => r.body.tracking);
      expect(ubicaciones).toEqual(expect.arrayContaining(['TARDIO-1', 'TARDIO-2']));
    } finally { await e.cerrar(); }
  });

  it.each([
    { status: 200, cuerpo: { ok: false, error: 'tracking desconocido' }, estado: 'fallido' },
    { status: 401, cuerpo: { error: 'clave incorrecta' }, estado: 'fallido' },
    { status: 403, cuerpo: { error: 'sin permiso' }, estado: 'fallido' },
    { status: 400, cuerpo: { error: 'pedido inválido' }, estado: 'fallido' },
    { status: 429, cuerpo: { error: 'esperar' }, estado: 'pendiente' },
    { status: 503, cuerpo: { error: 'no disponible' }, estado: 'fallido' },
    { status: 201, cuerpo: { ok: true }, estado: 'enviado' },
  ])('distingue pin recibido de aceptación de GSG ante HTTP $status / $estado', async caso => {
    const e = await crearEscenarioEntregas({ fetchGsg: (async () => new Response(JSON.stringify(caso.cuerpo), { status: caso.status })) as typeof fetch });
    try {
      await e.api.post('/api/v1/entregas', pedido('RESPUESTA-BACKEND'));
      await e.trabajar();
      await e.contesta('987601234', { pin: PIN_LIMA });
      await e.despacharAGsg();
      expect(await e.entrega('RESPUESTA-BACKEND')).toMatchObject({ ubicacionEstado: 'recibida', requiereHumano: false });
      const reporte = (await e.repos.rutas.reportesRecientes(100, 'ubicacion')).find(r => r.payload.tracking === 'RESPUESTA-BACKEND')!;
      expect(reporte.estado).toBe(caso.estado);
      if (caso.estado !== 'enviado') { expect(reporte.enviadoAt).toBeNull(); expect(reporte.ultimoError).toBeTruthy(); }
      const pantalla = await e.api.get<any>('/admin/gsg/envios?limit=100');
      const envio = pantalla.body.items.find((r: any) => r.cuerpo?.tracking === 'RESPUESTA-BACKEND');
      expect(envio?.estado).toBe(caso.estado);
    } finally { await e.cerrar(); }
  });

  it('el pin posterior a una incidencia ya enviada también se manda para ambos pedidos', async () => {
    const estados = new Map<string, string>();
    const e = await crearEscenarioEntregas({ arranque: new Date('2026-10-14T15:17:00Z'), fetchGsg: (async (url: any, init: any) => {
      const p = JSON.parse(String(init.body));
      estados.set(p.tracking, String(url).includes('reported') ? 'sin_respuesta' : 'ubicacion_recibida');
      return new Response('{}', { status: 200 });
    }) as typeof fetch });
    try {
      await e.repos.rutas.ajustes.set({ esperaRespuestaMinutos: 1, maxIntentos: 3, esperaFinalMinutos: 0 }, ajustesPorDefecto(OPCIONES_POR_DEFECTO));
      await e.api.post('/api/v1/entregas', [pedido('YA-REPORTADO-1'), pedido('YA-REPORTADO-2')]);
      for (let i = 0; i < 4; i++) { await e.trabajar(); e.avanzar(1); }
      await e.despacharAGsg();
      expect([...estados.values()]).toEqual(['sin_respuesta', 'sin_respuesta']);
      await e.contesta('987601234', { pin: PIN_LIMA });
      await e.despacharAGsg();
      expect([...estados.values()]).toEqual(['ubicacion_recibida', 'ubicacion_recibida']);
      expect((await e.repos.rutas.reportesRecientes(100, 'incidencia')).map(r => r.estado)).toEqual(['enviado', 'enviado']);
    } finally { await e.cerrar(); }
  });

  it('conserva el reporte si el cliente aún no mandó su ubicación', async () => {
    const repos = createFakeRepos();
    const lote = await repos.rutas.crearLote({ nombre: 'Sin pin' });
    const [s] = await repos.rutas.agregarSolicitudes(lote.id, [{ telefonoCrudo: '987601234', phone: '51987601234' }]);
    await repos.rutas.actualizarSolicitud(s!.id, { estado: 'derivado', intentos: 3, incidencia: 'sin_respuesta' });
    await repos.rutas.encolarReporte({ solicitudId: s!.id, loteId: lote.id, tipo: 'incidencia', payload: { tracking: 'PENDIENTE', codigo: 'sin_respuesta' } });
    const llegadas: any[] = [];
    const puerto = crearPuertoHttp({ url: 'https://gsg.example/api/v1', token: 'clave-falsa', fetchImpl: (async (_url, init) => { llegadas.push(JSON.parse(String(init?.body))); return new Response('{}', { status: 200 }); }) as typeof fetch });
    await despacharReportes(repos, puerto);
    expect(llegadas).toHaveLength(1);
    expect(llegadas[0]).toMatchObject({ codigo: 'sin_respuesta', tipo: 'PROBLEMA' });
  });

  it('un reporte superado no se muestra como fallo ni como recibido por GSG', () => {
    expect(estadoDelReporteAGsg({ id: 1, estado: 'superado', intentos: 1, ultimoError: null, enviadoAt: null })).toMatchObject({ estado: 'superado', error: null, enviadoEn: null });
  });
});
